"""Calque de contrôle : dessine les positions et les poids de la page sur une capture de Chris.

Chaque poste de ``data/positions_chris.json`` devient un cercle, dont l'aire suit son poids. Un
disque de la capture recouvert par son cercle confirme la position et le poids. La capture
restant locale, l'image produite l'est aussi.

Usage :
    uv run python scripts/analyze/overlay.py --version powerbi_2026_02_14 \
        --frame iXImwyHjrwM_00656.png --revised 54 55 --out research/digitized/calque.png
"""

from __future__ import annotations

import argparse
import json
import math
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIGITIZED = ROOT / "research" / "digitized"
POSITIONS = ROOT / "data" / "positions_chris.json"
#: Poids par pixel carré, calibré sur les infobulles de la capture plein écran.
DEFAULT_AREA_FACTOR = 0.00447
NORMAL_COLOR = (0, 0, 255)
REVISED_COLOR = (0, 165, 255)


def value_to_pixel(marks: Sequence[Mapping[str, float]]) -> Callable[[float], float]:
    """Conversion d'une valeur d'axe en pixel, à partir des repères extrêmes du calibrage."""
    first, last = marks[0], marks[-1]
    slope = (last["pixel"] - first["pixel"]) / (last["value"] - first["value"])
    return lambda value: first["pixel"] + slope * (value - first["value"])


def disc_radius(weight_pct: float, area_factor: float = DEFAULT_AREA_FACTOR) -> int:
    """Rayon en pixels d'un disque de ce poids."""
    return round(math.sqrt(weight_pct / area_factor))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True, help="relevé qui porte le calibrage")
    parser.add_argument("--frame", required=True, help="capture dans research/digitized/frames")
    parser.add_argument("--revised", nargs="*", default=[], help="postes déplacés après la capture")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)

    import cv2

    version = json.loads((DIGITIZED / f"{args.version}.json").read_text(encoding="utf-8"))
    positions = json.loads(POSITIONS.read_text(encoding="utf-8"))["items"]
    image = cv2.imread(str(DIGITIZED / "frames" / args.frame))
    to_x = value_to_pixel(version["calibration"]["x_marks"])
    to_y = value_to_pixel(version["calibration"]["y_marks"])
    for item in positions:
        color = REVISED_COLOR if item["code"] in args.revised else NORMAL_COLOR
        center = (round(to_x(item["x"])), round(to_y(item["y"])))
        radius = disc_radius(item["weight_pct"])
        cv2.circle(image, center, radius, color, 2, cv2.LINE_AA)
        cv2.drawMarker(image, center, color, cv2.MARKER_CROSS, 10, 2)
        label_at = (center[0] + radius + 2, center[1] + 5)
        cv2.putText(
            image, item["code"], label_at, cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1, cv2.LINE_AA
        )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(args.out), image)
    print(f"{args.out} : {len(positions)} postes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
