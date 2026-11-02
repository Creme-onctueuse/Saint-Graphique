"""Numérise un graphique à partir d'une capture et d'un fichier de points relu à la main.

Trois sous-commandes :

``detect``  détecte les disques ou cercles d'une zone (OpenCV) et écrit une image annotée
            et numérotée, pour aider à relever les pixels et les libellés.
``build``   lit un fichier de points (YAML) et écrit ``research/digitized/<version_id>.json``.
            Le calibrage utilise au moins 2 repères par axe. Un point porte soit des
            valeurs lues directement (infobulle), soit des pixels convertis.
``tooltips`` balaie une vidéo locale à la recherche d'infobulles (corrélation sur un
            gabarit) et écrit les images retenues, une par infobulle distincte.

Les libellés ne sont jamais devinés : ils viennent du fichier de points, saisi en lisant
l'image. Un point illisible n'y figure pas.

Usage :
    uv run python scripts/analyze/digitize.py detect --image a.png --bbox 0 50 560 380 --out b.png
    uv run python scripts/analyze/digitize.py build --points research/digitized/points/v.yaml
    uv run python scripts/analyze/digitize.py tooltips --video v.mp4 --template t.png --out dir
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.analyze.pure import AxisCalibration, fit_axis  # noqa: E402

OUTPUT_DIR = Path("research/digitized")
TOOLTIP_CONFIDENCE = 0.98
DEFAULT_PIXEL_CONFIDENCE = 0.7


def calibration_from_marks(
    marks: Iterable[Mapping[str, float]],
) -> tuple[AxisCalibration, float]:
    """Calibre un axe à partir de repères ``{pixel, value}`` relus sur l'image."""
    pairs = [(float(m["pixel"]), float(m["value"])) for m in marks]
    return fit_axis(pairs)


def resolve_point(
    point: Mapping[str, Any],
    x_cal: AxisCalibration | None,
    y_cal: AxisCalibration | None,
    *,
    decimals: int = 2,
) -> dict[str, Any]:
    """Transforme une ligne du fichier de points en point du schéma ``digitized``.

    Une valeur lue (``x``, ``y``) prime sur un pixel (``px``, ``py``) : c'est le cas des
    infobulles. La provenance est conservée dans ``method``.
    """
    result: dict[str, Any] = {"kind": point.get("kind", "pcs"), "label": point["label"]}
    if point.get("code") is not None:
        result["code"] = str(point["code"])
    if point.get("x") is not None and point.get("y") is not None:
        result["x"], result["y"] = float(point["x"]), float(point["y"])
        result["method"] = point.get("method", "tooltip")
        default_confidence = TOOLTIP_CONFIDENCE
    else:
        if x_cal is None or y_cal is None:
            raise ValueError(f"pas de calibrage pour le point en pixels : {point['label']}")
        result["x"] = round(x_cal.to_value(float(point["px"])), decimals)
        result["y"] = round(y_cal.to_value(float(point["py"])), decimals)
        result["method"] = point.get("method", "pixel")
        default_confidence = DEFAULT_PIXEL_CONFIDENCE
    result["confidence"] = float(point.get("confidence", default_confidence))
    for key in ("weight", "note", "capture"):
        if point.get(key) is not None:
            result[key] = point[key]
    return result


def snap_to_discs(
    point: Mapping[str, Any],
    discs: Iterable[Mapping[str, float]],
    *,
    tolerance: float = 6.0,
) -> dict[str, Any]:
    """Recale un point saisi en pixels sur le centre détecté le plus proche.

    Sans disque à moins de ``tolerance`` pixels, le point garde sa saisie et le marque
    dans ``method``. Les points lus (infobulle) ne sont pas touchés.
    """
    result = dict(point)
    if point.get("x") is not None or point.get("px") is None:
        return result
    best = None
    best_distance = tolerance
    for disc in discs:
        distance = ((disc["px"] - point["px"]) ** 2 + (disc["py"] - point["py"]) ** 2) ** 0.5
        if distance <= best_distance:
            best, best_distance = disc, distance
    if best is None:
        result.setdefault("method", "pixel_manual")
        return result
    result["px"], result["py"] = best["px"], best["py"]
    result.setdefault("method", "pixel_detected")
    return result


def build_document(spec: Mapping[str, Any]) -> dict[str, Any]:
    """Assemble le document ``digitized`` à partir d'un fichier de points chargé."""
    calibration = spec.get("calibration") or {}
    x_cal = y_cal = None
    report: dict[str, Any] = {}
    if calibration.get("x") and calibration.get("y"):
        x_cal, x_residual = calibration_from_marks(calibration["x"])
        y_cal, y_residual = calibration_from_marks(calibration["y"])
        report = {
            "x_marks": calibration["x"],
            "y_marks": calibration["y"],
            "x_units_per_pixel": round(x_cal.a, 5),
            "y_units_per_pixel": round(y_cal.a, 5),
            "x_max_residual": round(x_residual, 3),
            "y_max_residual": round(y_residual, 3),
        }
    document: dict[str, Any] = {
        "version_id": spec["version_id"],
        "date": str(spec["date"]),
        "source": spec.get("source", {}),
        "axes": spec.get("axes", {}),
        "election_id": spec.get("election_id"),
        "points": [resolve_point(p, x_cal, y_cal) for p in spec.get("points", [])],
    }
    if report:
        document["calibration"] = report
    if spec.get("notes"):
        document["notes"] = spec["notes"]
    return document


# --- Parties dépendantes d'OpenCV, importé à la demande --------------------------------


def detect_discs(
    image_path: Path, bbox: tuple[int, int, int, int], *, hollow: bool = False
) -> list[dict[str, float]]:
    """Détecte les disques pleins d'une zone claire, ou les cercles creux avec ``hollow``.

    Les disques pleins passent par un masque (pixels saturés ou sombres) débarrassé du
    texte par ouverture morphologique. Les cercles creux, style des premières diapositives,
    passent par une transformée de Hough exigeante, pour ne pas prendre le texte.
    """
    import cv2
    import numpy as np

    image = cv2.imread(str(image_path))
    x, y, w, h = bbox
    zone = image[y : y + h, x : x + w]
    gray = cv2.cvtColor(zone, cv2.COLOR_BGR2GRAY)
    scale = max(1.0, image.shape[1] / 854)
    min_radius = max(3, round(3 * scale))
    max_radius = round(32 * scale)
    found: list[dict[str, float]] = []
    if hollow:
        circles = cv2.HoughCircles(
            cv2.medianBlur(gray, 3),
            cv2.HOUGH_GRADIENT,
            dp=1,
            minDist=2 * min_radius,
            param1=140,
            param2=22,
            minRadius=min_radius,
            maxRadius=max_radius,
        )
        for cx, cy, radius in [] if circles is None else circles[0]:
            angles = np.linspace(0, 2 * np.pi, 48, endpoint=False)
            darkest = np.full(angles.shape, 255.0)
            for offset in (-2.0, -1.0, 0.0, 1.0, 2.0):
                rows = np.clip((cy + (radius + offset) * np.sin(angles)).astype(int), 0, h - 1)
                cols = np.clip((cx + (radius + offset) * np.cos(angles)).astype(int), 0, w - 1)
                darkest = np.minimum(darkest, gray[rows, cols])
            if np.mean(darkest < 150) < 0.85:  # anneau sombre continu, pas du texte
                continue
            found.append(
                {
                    "px": round(float(cx) + x, 1),
                    "py": round(float(cy) + y, 1),
                    "r": round(float(radius), 1),
                }
            )
        return sorted(found, key=lambda f: (f["py"], f["px"]))

    hsv = cv2.cvtColor(zone, cv2.COLOR_BGR2HSV)
    mask = ((hsv[:, :, 1] > 30) | (gray < 150)).astype(np.uint8) * 255
    size = max(3, round(3 * scale)) | 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for contour in contours:
        (cx, cy), radius = cv2.minEnclosingCircle(contour)
        if not min_radius <= radius <= max_radius:
            continue
        fill = cv2.contourArea(contour) / (np.pi * radius * radius)
        if fill < 0.75:
            continue
        found.append({"px": round(cx + x, 1), "py": round(cy + y, 1), "r": round(radius, 1)})
    return sorted(found, key=lambda f: (f["py"], f["px"]))


def annotate(
    image_path: Path, discs: list[dict[str, float]], out: Path, *, scale: float = 2.0
) -> None:
    """Écrit une image agrandie où chaque disque détecté porte son numéro."""
    import cv2

    image = cv2.imread(str(image_path))
    big = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    for index, disc in enumerate(discs):
        center = (int(disc["px"] * scale), int(disc["py"] * scale))
        cv2.circle(big, center, 2, (0, 0, 255), -1)
        cv2.putText(
            big,
            str(index),
            (center[0] + 3, center[1] - 3),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            (0, 0, 255),
            1,
            cv2.LINE_AA,
        )
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), big)


def scan_tooltips(
    video: Path,
    template: Path,
    out_dir: Path,
    *,
    step_s: float = 0.5,
    threshold: float = 0.72,
    scales: tuple[float, ...] = (1.0,),
    start_s: float = 0.0,
    end_s: float | None = None,
    margin: tuple[int, int, int, int] = (-20, -24, 420, 96),
) -> list[dict[str, Any]]:
    """Balaie une vidéo et garde une image par infobulle distincte (position du gabarit).

    Le gabarit est une petite image du texte fixe de l'infobulle. Une nouvelle infobulle
    est retenue quand le gabarit change de place, ou quand son contenu change.
    """
    import cv2
    import numpy as np

    pattern = cv2.imread(str(template), cv2.IMREAD_GRAYSCALE)
    capture = cv2.VideoCapture(str(video))
    fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
    total = capture.get(cv2.CAP_PROP_FRAME_COUNT) / fps
    stop = min(total, end_s) if end_s else total
    out_dir.mkdir(parents=True, exist_ok=True)
    kept: list[dict[str, Any]] = []
    previous_crop = None
    frame_step = max(1, round(step_s * fps))
    capture.set(cv2.CAP_PROP_POS_MSEC, start_s * 1000)
    index = round(start_s * fps)
    while index / fps <= stop:
        if not capture.grab():
            break
        if index % frame_step == 0:
            ok, frame = capture.retrieve()
            if ok:
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                best = (0.0, (0, 0), 1.0)
                for scale in scales:
                    sized = cv2.resize(pattern, None, fx=scale, fy=scale)
                    _, value, _, location = cv2.minMaxLoc(
                        cv2.matchTemplate(gray, sized, cv2.TM_CCOEFF_NORMED)
                    )
                    if value > best[0]:
                        best = (value, location, scale)
                if best[0] >= threshold:
                    x, y = best[1]
                    left, top, width, height = margin
                    x0, y0 = max(0, x + left), max(0, y + top)
                    crop = gray[y0 : y0 + height, x0 : x0 + width]
                    is_new = (
                        previous_crop is None
                        or previous_crop.shape != crop.shape
                        or float(np.mean(cv2.absdiff(previous_crop, crop))) > 4.0
                    )
                    if is_new:
                        t = index / fps
                        name = f"{video.parent.name}_{int(t * 10):06d}.png"
                        cv2.imwrite(str(out_dir / name), frame)
                        kept.append(
                            {
                                "t": round(t, 1),
                                "score": round(best[0], 3),
                                "at": [x, y],
                                "scale": best[2],
                                "file": name,
                            }
                        )
                        previous_crop = crop
        index += 1
    capture.release()
    return kept


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    detect = commands.add_parser("detect", help="détecter et numéroter les disques")
    detect.add_argument("--image", type=Path, required=True)
    detect.add_argument("--bbox", type=int, nargs=4, required=True, metavar=("X", "Y", "W", "H"))
    detect.add_argument("--out", type=Path, required=True)
    detect.add_argument("--json", type=Path)
    detect.add_argument("--hollow", action="store_true", help="cercles creux (diapositives)")

    build = commands.add_parser("build", help="écrire le JSON de numérisation")
    build.add_argument("--points", type=Path, required=True)
    build.add_argument("--out-dir", type=Path, default=OUTPUT_DIR)
    build.add_argument("--snap", type=Path, help="JSON de détection pour recaler les pixels")
    build.add_argument("--snap-tolerance", type=float, default=6.0)

    tooltips = commands.add_parser("tooltips", help="repérer les infobulles dans une vidéo")
    tooltips.add_argument("--video", type=Path, required=True)
    tooltips.add_argument("--template", type=Path, required=True)
    tooltips.add_argument("--out", type=Path, required=True)
    tooltips.add_argument("--step", type=float, default=0.5)
    tooltips.add_argument("--threshold", type=float, default=0.72)
    tooltips.add_argument("--scales", type=float, nargs="+", default=[1.0])
    tooltips.add_argument("--start", type=float, default=0.0)
    tooltips.add_argument("--end", type=float)
    tooltips.add_argument(
        "--margin",
        type=int,
        nargs=4,
        default=[-20, -24, 420, 96],
        metavar=("GAUCHE", "HAUT", "LARGEUR", "HAUTEUR"),
        help="zone comparée autour du gabarit pour décider qu'une infobulle est nouvelle",
    )

    args = parser.parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8")

    if args.command == "detect":
        discs = detect_discs(args.image, tuple(args.bbox), hollow=args.hollow)
        annotate(args.image, discs, args.out)
        if args.json:
            args.json.write_text(json.dumps(discs, indent=0), encoding="utf-8")
        for index, disc in enumerate(discs):
            print(index, disc["px"], disc["py"], disc["r"])
        return 0

    if args.command == "build":
        import yaml

        spec = yaml.safe_load(args.points.read_text(encoding="utf-8"))
        if args.snap:
            discs = json.loads(args.snap.read_text(encoding="utf-8"))
            spec["points"] = [
                snap_to_discs(p, discs, tolerance=args.snap_tolerance) for p in spec["points"]
            ]
        document = build_document(spec)
        args.out_dir.mkdir(parents=True, exist_ok=True)
        out = args.out_dir / f"{document['version_id']}.json"
        out.write_text(json.dumps(document, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{out} : {len(document['points'])} points")
        if "calibration" in document:
            calibration = document["calibration"]
            print(
                f"résidus de calibrage : x {calibration['x_max_residual']} "
                f"y {calibration['y_max_residual']}"
            )
        return 0

    kept = scan_tooltips(
        args.video,
        args.template,
        args.out,
        step_s=args.step,
        threshold=args.threshold,
        scales=tuple(args.scales),
        start_s=args.start,
        end_s=args.end,
        margin=tuple(args.margin),
    )
    (args.out / "index.json").write_text(json.dumps(kept, indent=0), encoding="utf-8")
    print(f"{len(kept)} infobulles retenues")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
