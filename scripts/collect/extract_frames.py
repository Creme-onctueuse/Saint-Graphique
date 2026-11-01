"""Étape 4 : captures du graphique dans les vidéos core.

Pour chaque vidéo ``core`` de l'index :

1. télécharge la vidéo seule (≤ 480p, sans audio) dans un dossier temporaire ;
2. extrait avec ffmpeg une frame toutes les 2 s dans ses ``chart_segments``
   (toutes les 10 s sur toute la vidéo si elle n'a aucun segment) ;
3. calcule un ``chart_score`` (0..1) par heuristique OpenCV :
   - cercles creux (ou points) sombres sur fond clair peu saturé, détectés par
     HoughCircles puis vérifiés (anneau sombre, extérieur clair) ;
   - axes orthogonaux : longs traits fins horizontaux et verticaux (ouverture
     morphologique du « black-hat »), qui se croisent loin de leurs extrémités ;
   - panneau clair et rectangulaire (le fond du graphique) ;
4. garde les frames dont le score atteint le seuil, dédoublonnées par hash
   perceptuel (pHash de la zone du graphique, distance ≤ 6 : on garde la
   meilleure), écrites en ``research/captures/<id>_<t>.png`` (t en secondes,
   sur 5 chiffres) et décrites dans ``research/captures/manifest.jsonl`` ;
5. supprime la vidéo.

Reprise : chaque vidéo traitée laisse ``research/captures/state/<id>.json``
(paramètres, scores de toutes les frames échantillonnées) et n'est pas
retraitée, sauf ``--force``.

Usage :
    uv run python scripts/collect/extract_frames.py [--limit N] [--ids ID ...] [--workers 2]
    uv run python scripts/collect/extract_frames.py --score-images a.png b.png   # diagnostic
"""

from __future__ import annotations

import argparse
import json
import logging
import subprocess
import sys
import tempfile
import time
from collections.abc import Iterator, Sequence
from concurrent.futures import as_completed
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import cv2
import imagehash
import numpy as np
from PIL import Image

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.collect.common import (  # noqa: E402
    CAPTURE_STATE_DIR,
    CAPTURES_DIR,
    Video,
    YouTubeBlocked,
    load_index,
    process_pool,
    rel,
    replace_manifest_rows,
    select_videos,
    setup_logging,
    stderr_tail,
    video_url,
    write_bytes_atomic,
    write_json_atomic,
    ytdlp,
)
from scripts.collect.pure import axes_kind, nearest_duplicate, sampling_plan  # noqa: E402

log = logging.getLogger("collect.frames")

VIDEO_FORMAT = "bv*[height<=480][vcodec^=avc1]/bv*[height<=480]/b[height<=480]/wv*/w"
# Seuil étalonné à la main (planches annotées) : axes en croix + panneau + au moins un
# cercle, ou une dizaine de cercles sur panneau clair. Le gabarit vide est écarté.
DEFAULT_THRESHOLD = 0.6
PHASH_MAX_DIST = 6
SEGMENT_STEP = 2.0
FULL_STEP = 10.0

# Paramètres de l'heuristique (images ramenées à 854 px de large, comme du 480p).
ANALYSIS_WIDTH = 854
LIGHT_MIN = 150  # niveau de gris minimal du fond clair
SAT_MAX = 50  # saturation maximale du fond (exclut le jaune des incrustations)
THIN_MIN = 35  # contraste minimal d'un trait fin (black-hat)
AXIS_MIN_FRAC = 0.22  # longueur minimale d'un axe, en fraction de la largeur / hauteur
CIRCLES_FULL = 8  # nombre de cercles valant un score « cercles » de 1
WEIGHTS = {"circles": 0.45, "axes": 0.35, "panel": 0.20}

_ANGLES = np.linspace(0.0, 2.0 * np.pi, 32, endpoint=False)
_COS, _SIN = np.cos(_ANGLES), np.sin(_ANGLES)


# --------------------------------------------------------------------------- score


@dataclass(frozen=True)
class ChartFeatures:
    """Indices de présence du graphique dans une frame."""

    score: float
    n_circles: int
    axes: str | None
    panel_frac: float
    panel_fill: float
    bbox: tuple[int, int, int, int]  # zone du graphique (x, y, l, h) en pixels de la frame


def _segments(mask: np.ndarray, horizontal: bool) -> list[tuple[float, float, float]]:
    """Composantes d'un masque de traits : ``(début, fin, position)`` des traits fins."""
    _, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    out: list[tuple[float, float, float]] = []
    for x, y, w, h, _area in stats[1:]:
        if horizontal and h <= 6:
            out.append((float(x), float(x + w - 1), y + (h - 1) / 2.0))
        elif not horizontal and w <= 6:
            out.append((float(y), float(y + h - 1), x + (w - 1) / 2.0))
    return out


def _ring(img: np.ndarray, x: float, y: float, r: float) -> np.ndarray:
    h, w = img.shape[:2]
    xs = np.clip(np.rint(x + r * _COS).astype(int), 0, w - 1)
    ys = np.clip(np.rint(y + r * _SIN).astype(int), 0, h - 1)
    return img[ys, xs]


def _valid_circles(gray: np.ndarray, sat: np.ndarray) -> list[tuple[float, float, float]]:
    """Cercles creux (ou petits disques pleins) sombres sur fond clair peu saturé.

    Les candidats de HoughCircles sont vérifiés : contour sombre sur au moins
    85 % du tour (rayon ±1 px), extérieur majoritairement clair et peu saturé,
    intérieur clair (cercle creux) ou franchement sombre (disque plein de rayon
    ≤ 10 px), mesuré près du centre pour les petits cercles. Cela écarte la
    plupart des lettres, les lunettes et les visages des webcams.
    """
    found = cv2.HoughCircles(
        cv2.GaussianBlur(gray, (3, 3), 0), cv2.HOUGH_GRADIENT, dp=1, minDist=5,
        param1=120, param2=13, minRadius=4, maxRadius=60,
    )
    if found is None:
        return []
    keep: list[tuple[float, float, float]] = []
    for x, y, r in found[0]:
        out_r = r + max(3.0, 0.3 * r)
        outside = _ring(gray, x, y, out_r)
        bg = float(np.median(outside))
        if bg < LIGHT_MIN or float(np.median(_ring(sat, x, y, out_r))) > SAT_MAX:
            continue
        if np.mean(outside >= LIGHT_MIN) < 0.5:
            continue
        ring = np.min(np.stack([_ring(gray, x, y, r + d) for d in (-1.0, 0.0, 1.0)]), axis=0)
        if np.mean(ring <= bg - 45) < 0.85:
            continue
        radii = (0.25 * r,) if r < 8 else (0.3 * r, 0.55 * r)
        inside = np.concatenate([_ring(gray, x, y, rr) for rr in radii])
        hollow = np.mean(inside >= bg - 35) >= 0.75
        filled = r <= 10 and np.mean(inside <= bg - 45) >= 0.75
        if not (hollow or filled):
            continue
        if any(abs(x - kx) <= 3 and abs(y - ky) <= 3 for kx, ky, _ in keep):
            continue
        keep.append((float(x), float(y), float(r)))
    return keep


def chart_features(frame: np.ndarray) -> ChartFeatures:
    """Calcule les indices et le ``chart_score`` (0..1) d'une frame BGR."""
    h0, w0 = frame.shape[:2]
    scale = ANALYSIS_WIDTH / w0
    img = frame if abs(scale - 1.0) < 1e-3 else cv2.resize(
        frame, (ANALYSIS_WIDTH, max(1, round(h0 * scale))), interpolation=cv2.INTER_AREA)
    H, W = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    sat = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)[:, :, 1]

    # Panneau clair et peu saturé (fond du graphique).
    light = ((gray >= LIGHT_MIN) & (sat <= SAT_MAX)).astype(np.uint8)
    light = cv2.morphologyEx(light, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    n, _, stats, _ = cv2.connectedComponentsWithStats(light, connectivity=8)
    panel: tuple[int, int, int, int] | None = None
    panel_frac = panel_fill = 0.0
    if n > 1:
        i = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        x, y, w, h, area = (int(v) for v in stats[i])
        panel_frac, panel_fill = area / (W * H), area / max(1, w * h)
        panel = (x, y, w, h)

    # Axes : longs traits fins et sombres, horizontaux et verticaux.
    blackhat = cv2.morphologyEx(
        gray, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15)))
    thin = np.where(blackhat >= THIN_MIN, 255, 0).astype(np.uint8)
    hlen, vlen = max(40, int(AXIS_MIN_FRAC * W)), max(30, int(AXIS_MIN_FRAC * H))
    hmask = cv2.morphologyEx(thin, cv2.MORPH_OPEN,
                             cv2.getStructuringElement(cv2.MORPH_RECT, (hlen, 1)))
    vmask = cv2.morphologyEx(thin, cv2.MORPH_OPEN,
                             cv2.getStructuringElement(cv2.MORPH_RECT, (1, vlen)))
    hsegs, vsegs = _segments(hmask, True), _segments(vmask, False)
    axes = axes_kind(hsegs, vsegs)

    circles = _valid_circles(gray, sat)

    c_term = min(1.0, len(circles) / CIRCLES_FULL)
    a_term = {"cross": 1.0, "corner": 0.3}.get(axes or "", 0.0)
    if panel_frac >= 0.12 and panel_fill >= 0.75:
        p_term = 1.0
    elif panel_frac >= 0.06 and panel_fill >= 0.6:
        p_term = 0.5
    else:
        p_term = 0.0
    score = (WEIGHTS["circles"] * c_term + WEIGHTS["axes"] * a_term
             + WEIGHTS["panel"] * p_term)

    # Zone du graphique : le panneau clair, sinon l'enveloppe des cercles et des axes.
    if panel is not None and p_term > 0:
        bx, by, bw, bh = panel
    else:
        xs = [c[0] for c in circles] + [s[0] for s in hsegs] + [s[1] for s in hsegs] \
            + [s[2] for s in vsegs]
        ys = [c[1] for c in circles] + [s[2] for s in hsegs] + [s[0] for s in vsegs] \
            + [s[1] for s in vsegs]
        if xs and ys and score > 0:
            x1, x2 = max(0, int(min(xs)) - 20), min(W, int(max(xs)) + 20)
            y1, y2 = max(0, int(min(ys)) - 20), min(H, int(max(ys)) + 20)
            bx, by, bw, bh = x1, y1, max(1, x2 - x1), max(1, y2 - y1)
        else:
            bx, by, bw, bh = 0, 0, W, H
    inv = 1.0 / scale
    bbox = (int(bx * inv), int(by * inv), max(1, int(bw * inv)), max(1, int(bh * inv)))
    return ChartFeatures(round(score, 3), len(circles), axes, round(panel_frac, 3),
                         round(panel_fill, 3), bbox)


def region_phash(frame: np.ndarray, bbox: tuple[int, int, int, int]) -> str:
    """pHash (16 caractères hexadécimaux) de la zone du graphique."""
    x, y, w, h = bbox
    crop = frame[y:y + h, x:x + w]
    if crop.size == 0:
        crop = frame
    return str(imagehash.phash(Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))))


# --------------------------------------------------------------------------- vidéo


def probe(path: Path) -> tuple[int, int, float]:
    """Largeur, hauteur et durée (s) du flux vidéo."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height:format=duration", "-of", "json", str(path)],
        capture_output=True, check=True,
    )
    data = json.loads(out.stdout.decode("utf-8"))
    stream = data["streams"][0]
    return int(stream["width"]), int(stream["height"]), float(data["format"]["duration"])


def iter_frames(
    path: Path, start: float, end: float, step: float, width: int, height: int
) -> Iterator[tuple[float, np.ndarray]]:
    """Frames BGR toutes les ``step`` secondes entre ``start`` et ``end`` (ffmpeg)."""
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
        "-ss", f"{start:.3f}", "-t", f"{max(0.0, end - start):.3f}", "-i", str(path),
        "-vf", f"fps=1/{step:g},scale={width}:{height}",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "pipe:1",
    ]
    size = width * height * 3
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    assert proc.stdout is not None
    try:
        k = 0
        while True:
            buf = proc.stdout.read(size)
            if len(buf) < size:
                break
            yield start + k * step, np.frombuffer(buf, np.uint8).reshape(height, width, 3)
            k += 1
    finally:
        proc.stdout.close()
        if proc.poll() is None:
            proc.kill()
        proc.wait()


def download_video(video_id: str, dest: Path) -> Path:
    """Télécharge la vidéo seule (≤ 480p) dans ``dest``."""
    proc = ytdlp(
        ["-f", VIDEO_FORMAT, "--no-part", "--no-playlist",
         "-o", str(dest / "%(id)s.%(ext)s"), video_url(video_id)],
        timeout=7200, max_wait=1800,
    )
    files = [p for p in dest.glob(f"{video_id}.*") if p.suffix not in (".part", ".ytdl")]
    if proc.returncode != 0 or not files:
        raise RuntimeError(f"téléchargement impossible : {stderr_tail(proc)}")
    return files[0]


# --------------------------------------------------------------------------- traitement


@dataclass
class Kept:
    """Frame retenue (encodée en PNG en mémoire jusqu'à l'écriture)."""

    t: float
    score: float
    phash: str
    png: bytes
    features: ChartFeatures


def capture_path(video_id: str, t: float) -> Path:
    """Chemin de la capture d'une vidéo à l'instant ``t``."""
    return CAPTURES_DIR / f"{video_id}_{int(round(t)):05d}.png"


def analyse_video(
    path: Path,
    plan: Sequence[tuple[float, float, float]],
    width: int,
    height: int,
    threshold: float,
    max_dist: int,
) -> tuple[list[Kept], list[list[float]]]:
    """Échantillonne, note et dédoublonne les frames d'un fichier vidéo."""
    kept: list[Kept] = []
    hashes: list[str] = []
    scores: list[list[float]] = []
    for start, end, step in plan:
        for t, frame in iter_frames(path, start, end, step, width, height):
            feats = chart_features(frame)
            scores.append([round(t, 1), feats.score])
            if feats.score < threshold:
                continue
            ph = region_phash(frame, feats.bbox)
            j = nearest_duplicate(ph, hashes, max_dist)
            if j is not None and feats.score <= kept[j].score + 0.05:
                continue
            ok, png = cv2.imencode(".png", frame)
            if not ok:
                continue
            item = Kept(t, feats.score, ph, png.tobytes(), feats)
            if j is None:
                kept.append(item)
                hashes.append(ph)
            else:  # doublon de meilleure qualité : il remplace le précédent
                kept[j], hashes[j] = item, ph
    kept.sort(key=lambda k: k.t)
    return kept, scores


def process_video(
    video: Video,
    threshold: float = DEFAULT_THRESHOLD,
    max_dist: int = PHASH_MAX_DIST,
    segment_step: float = SEGMENT_STEP,
    full_step: float = FULL_STEP,
    full_scan: bool = False,
    force: bool = False,
) -> dict[str, Any] | None:
    """Traite une vidéo core : téléchargement, échantillonnage, captures, manifeste.

    Renvoie l'état enregistré, ou ``None`` si la vidéo était déjà traitée.
    """
    vid = video["id"]
    state_path = CAPTURE_STATE_DIR / f"{vid}.json"
    if state_path.exists() and not force:
        return None
    t0 = time.monotonic()
    segments = video.get("chart_segments") or []
    with tempfile.TemporaryDirectory(prefix="sg_video_", ignore_cleanup_errors=True) as tmp:
        log.info("%s : téléchargement (%s)", vid, video.get("title", "")[:60])
        path = download_video(vid, Path(tmp))
        width, height, duration = probe(path)
        plan = sampling_plan(segments, duration, segment_step, full_step)
        if full_scan and segments:
            plan = plan + [(0.0, duration, full_step)]
        log.info("%s : %dx%d, %.0f s, %d fenêtre(s) d'échantillonnage", vid, width, height,
                 duration, len(plan))
        kept, scores = analyse_video(path, plan, width, height, threshold, max_dist)
    # Le dossier temporaire (et la vidéo) est supprimé à la sortie du bloc.
    if full_scan and segments:  # doublons d'instants entre segments et balayage complet
        seen: set[int] = set()
        kept = [k for k in kept if not (int(round(k.t)) in seen or seen.add(int(round(k.t))))]

    for old in CAPTURES_DIR.glob(f"{vid}_*.png"):
        if old not in {capture_path(vid, k.t) for k in kept}:
            old.unlink(missing_ok=True)
    rows = []
    for k in kept:
        png_path = capture_path(vid, k.t)
        write_bytes_atomic(png_path, k.png)
        x, y, w, h = k.features.bbox
        rows.append({
            "video_id": vid,
            "timestamp_s": round(k.t, 1),
            "file": rel(png_path),
            "phash": k.phash,
            "chart_score": k.score,
            "version_id": None,
            "upload_date": video.get("upload_date"),
            "chart_bbox": [x, y, w, h],
            "n_circles": k.features.n_circles,
            "axes": k.features.axes,
        })
    replace_manifest_rows(vid, rows)
    state = {
        "video_id": vid,
        "processed_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "params": {"threshold": threshold, "phash_max_dist": max_dist,
                   "segment_step": segment_step, "full_step": full_step,
                   "full_scan": full_scan, "video_format": VIDEO_FORMAT},
        "frame_size": [width, height],
        "duration_s": duration,
        "plan": [[round(s, 1), round(e, 1), st] for s, e, st in plan],
        "n_sampled": len(scores),
        "n_above_threshold": sum(1 for _, s in scores if s >= threshold),
        "n_kept": len(rows),
        "elapsed_s": round(time.monotonic() - t0, 1),
        "scores": scores,
    }
    write_json_atomic(state_path, state)
    log.info("%s : %d frames notées, %d au-dessus du seuil, %d captures gardées (%.0f s)",
             vid, state["n_sampled"], state["n_above_threshold"], len(rows), state["elapsed_s"])
    return state


def run_batch(videos: Sequence[Video], workers: int, verbose: bool = False,
              **kwargs: Any) -> int:
    """Traite des vidéos dans un pool de processus ; renvoie le nombre traité."""
    n_ok = 0
    with process_pool(workers, verbose) as pool:
        futures = {pool.submit(process_video, v, **kwargs): v["id"] for v in videos}
        for fut in as_completed(futures):
            try:
                if fut.result() is not None:
                    n_ok += 1
            except YouTubeBlocked as exc:
                log.error("%s : remis à plus tard (%s)", futures[fut], exc)
            except Exception:
                log.exception("%s : échec de l'extraction", futures[fut])
    return n_ok


def score_images(paths: Sequence[str]) -> None:
    """Affiche les indices de chaque image (diagnostic du seuil)."""
    for p in paths:
        frame = cv2.imread(p)
        if frame is None:
            print(f"{p}\tillisible")
            continue
        print(f"{p}\t{json.dumps(asdict(chart_features(frame)))}")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ids", nargs="*", help="restreint à ces identifiants de vidéo")
    ap.add_argument("--limit", type=int, default=None,
                    help="au plus N vidéos (« graphique » dans le titre d'abord)")
    ap.add_argument("--relevance", nargs="+", default=["core"], choices=["core", "mention"],
                    help="pertinences traitées (core)")
    ap.add_argument("--workers", type=int, default=2, help="processus parallèles (2)")
    ap.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD,
                    help=f"chart_score minimal ({DEFAULT_THRESHOLD})")
    ap.add_argument("--phash-dist", type=int, default=PHASH_MAX_DIST,
                    help=f"distance pHash en deçà de laquelle deux frames sont des doublons "
                         f"({PHASH_MAX_DIST})")
    ap.add_argument("--segment-step", type=float, default=SEGMENT_STEP)
    ap.add_argument("--full-step", type=float, default=FULL_STEP)
    ap.add_argument("--full-scan", action="store_true",
                    help="balaye aussi toute la vidéo (pas --full-step) en plus des segments")
    ap.add_argument("--force", action="store_true", help="retraite les vidéos déjà traitées")
    ap.add_argument("--score-images", nargs="+", metavar="PNG",
                    help="affiche seulement les indices de ces images")
    ap.add_argument("-v", "--verbose", action="store_true")
    return ap.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.score_images:
        score_images(args.score_images)
        return 0
    setup_logging(args.verbose)
    videos = select_videos(load_index(), args.relevance, args.ids, args.limit)
    if "mention" in args.relevance:  # une vidéo « mention » sans segment n'est pas balayée
        videos = [v for v in videos if v["relevance"] == "core" or v.get("chart_segments")]
    todo = [v for v in videos if args.force or not (CAPTURE_STATE_DIR / f"{v['id']}.json").exists()]
    log.info("captures : %d vidéos retenues, %d à traiter", len(videos), len(todo))
    n_ok = run_batch(todo, args.workers, args.verbose, threshold=args.threshold,
                     max_dist=args.phash_dist, segment_step=args.segment_step,
                     full_step=args.full_step, full_scan=args.full_scan, force=args.force)
    log.info("captures : %d vidéo(s) traitée(s)", n_ok)
    return 0


if __name__ == "__main__":
    sys.exit(main())
