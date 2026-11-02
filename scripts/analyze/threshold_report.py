"""Confronte chaque méthode au seuil d'écart documenté dans ``docs/methodologie.md``.

Le seuil vaut un demi-pas de la grille de Chris : sous 0,25, un point calculé tombe en moyenne
dans la bonne case de la grille. Seuls les candidats forment un contrôle pour ``read_positions``,
dont les catégories coïncident par construction avec les lectures.

Usage :
    uv run python scripts/analyze/threshold_report.py
"""

from __future__ import annotations

import json
import sys
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.analyze.compare import match_candidates, match_pcs  # noqa: E402
from scripts.analyze.pure import rmse  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
DIGITIZED = ROOT / "research" / "digitized"
COMPUTED = ROOT / "data" / "computed"

THRESHOLD = 0.25
METHODS = ("read_positions", "ranks", "continuous", "mca")
#: Relevés du tableau, candidats que le contrôle doit retrouver.
CONTROL = (
    ("powerbi_2025_03_27__2022_presidentielle_t1", "2022_presidentielle_t1"),
    ("powerbi_2025_03_27__2024_legislatives_t1", "2024_legislatives_t1"),
    ("powerbi_2025_01_26__2017_presidentielle_t1", "2017_presidentielle_t1"),
    ("powerbi_2025_01_26__2024_europeennes", "2024_europeennes"),
)
#: Candidats que Chris a déplacés entre janvier et mars 2025 : comptés à part, jamais masqués.
MOVED = ("powerbi_2025_01_26__2022_presidentielle_t1", "2022_presidentielle_t1")
MATRIX = (
    ("matrice_v11_2026_09__2022_presidentielle_t1", "2022_presidentielle_t1"),
    ("matrice_v11_2026_09__2017_presidentielle_t1", "2017_presidentielle_t1"),
)
PCS_VERSION = "powerbi_2026_02_28"


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def pooled_gaps(pairs: Sequence[tuple[Mapping[str, Any], Mapping[str, Any]]]) -> dict[str, Any]:
    """RMSE par axe sur toutes les paires, et verdict au seuil."""
    if not pairs:
        return {"n": 0, "rmse_x": None, "rmse_y": None, "meets": False}
    x = rmse([float(a["x"]) for a, _ in pairs], [float(b["x"]) for _, b in pairs])
    y = rmse([float(a["y"]) for a, _ in pairs], [float(b["y"]) for _, b in pairs])
    return {
        "n": len(pairs),
        "rmse_x": round(x, 2),
        "rmse_y": round(y, 2),
        "meets": x < THRESHOLD and y < THRESHOLD,
    }


def candidate_pairs(method: str, sets: Iterable[tuple[str, str]]) -> list[tuple[Any, Any]]:
    """Paires (candidat lu, candidat calculé) réunies sur plusieurs relevés."""
    pairs: list[tuple[Any, Any]] = []
    for version, election in sets:
        computed = read_json(COMPUTED / method / f"{election}.json")["candidates"]
        points = read_json(DIGITIZED / f"{version}.json")["points"]
        found, _ = match_candidates([p for p in points if p["kind"] == "candidate"], computed)
        pairs.extend(found)
    return pairs


def report_line(label: str, block: Mapping[str, Any]) -> str:
    verdict = "atteint" if block["meets"] else "non atteint"
    return f"  {label:<34} n={block['n']:<3} X={block['rmse_x']} Y={block['rmse_y']} : {verdict}"


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    if not DIGITIZED.exists():
        print("relevés locaux absents : rien à mesurer")
        return 1
    print(f"Seuil : RMSE sous {THRESHOLD} sur chaque axe")
    pcs_points = [
        p for p in read_json(DIGITIZED / f"{PCS_VERSION}.json")["points"] if p["kind"] == "pcs"
    ]
    for method in METHODS:
        print(method)
        control = pooled_gaps(candidate_pairs(method, CONTROL))
        print(report_line("candidats du tableau", control))
        everything = pooled_gaps(candidate_pairs(method, (*CONTROL, MOVED)))
        print(report_line("avec janvier 2025 pour 2022", everything))
        print(report_line("matrice v11", pooled_gaps(candidate_pairs(method, MATRIX))))
        computed = read_json(COMPUTED / method / "population.json")["pcs"]
        pairs, _ = match_pcs(pcs_points, computed)
        label = "catégories (par construction)" if method == "read_positions" else "catégories"
        print(report_line(label, pooled_gaps(pairs)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
