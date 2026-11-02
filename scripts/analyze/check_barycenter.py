"""Vérifie si les candidats lus sont le barycentre linéaire des positions de PCS lues.

Prend les positions de groupes dans des fichiers numérisés, les compositions dans
``data/elections``, puis compare le barycentre calculé aux candidats lus. Un second calcul
laisse les positions de groupes libres (moindres carrés) : un résidu fort dit alors
qu'aucune moyenne linéaire des groupes n'explique l'axe, quelles que soient les positions.

Usage :
    uv run python scripts/analyze/check_barycenter.py \
        --positions research/digitized/matrice_v11_2026_09.json \
        --pair research/digitized/v__2022.json data/elections/2022.json --json sortie.json
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.analyze.compare import candidate_key  # noqa: E402
from scripts.analyze.pure import fit_barycenter_coordinates, rmse, weighted_mean  # noqa: E402


def collect_group_positions(
    documents: Iterable[Mapping[str, Any]],
) -> dict[str, tuple[float, float]]:
    """Réunit les positions de groupes par code, le premier document lu ayant priorité."""
    positions: dict[str, tuple[float, float]] = {}
    for document in documents:
        for point in document["points"]:
            code = point.get("code")
            if point.get("level") == "group" and code and code not in positions:
                positions[code] = (float(point["x"]), float(point["y"]))
    return positions


def composition_vector(composition: Mapping[str, float], codes: Sequence[str]) -> list[float]:
    """Parts d'un électorat sur des lignes de groupes (``1+2`` additionne deux groupes)."""
    return [sum(float(composition.get(part) or 0) for part in code.split("+")) for code in codes]


def rows_from_election(
    document: Mapping[str, Any],
    election: Mapping[str, Any],
    codes: Sequence[str],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Associe à chaque candidat lu sa composition. Rend aussi les candidats sans composition."""
    identifiers = {candidate_key(c["label"]): c["id"] for c in election["candidates"]}
    rows, missing = [], []
    for point in document["points"]:
        if point["kind"] != "candidate":
            continue
        identifier = identifiers.get(candidate_key(point["label"]))
        composition = election["composition"].get(identifier) if identifier else None
        if not composition:
            missing.append(point["label"])
            continue
        rows.append(
            {
                "election": election.get("id", ""),
                "label": point["label"],
                "weights": composition_vector(composition, codes),
                "x": float(point["x"]),
                "y": float(point["y"]),
            }
        )
    return rows, missing


def linear_check(
    rows: Sequence[Mapping[str, Any]],
    positions: Mapping[str, tuple[float, float]],
    codes: Sequence[str],
) -> dict[str, Any]:
    """Compare les candidats lus au barycentre linéaire, puis à un ajustement libre."""
    if not rows:
        return {"n": 0}
    predicted_x = [weighted_mean([positions[c][0] for c in codes], row["weights"]) for row in rows]
    predicted_y = [weighted_mean([positions[c][1] for c in codes], row["weights"]) for row in rows]
    read_x = [row["x"] for row in rows]
    read_y = [row["y"] for row in rows]
    shift = [a - b for a, b in zip(read_x, predicted_x, strict=True)]
    report: dict[str, Any] = {
        "n": len(rows),
        "lines": list(codes),
        "rmse_x_linear": round(rmse(read_x, predicted_x), 3),
        "rmse_y_linear": round(rmse(read_y, predicted_y), 3),
        "max_gap_y_linear": round(
            max(abs(a - b) for a, b in zip(read_y, predicted_y, strict=True)), 3
        ),
        "x_shift_mean": round(sum(shift) / len(shift), 3),
        "x_shift_min": round(min(shift), 3),
        "x_shift_max": round(max(shift), 3),
    }
    if len(rows) > len(codes):
        weights = [row["weights"] for row in rows]
        free_x, residual_x = fit_barycenter_coordinates(weights, read_x)
        free_y, residual_y = fit_barycenter_coordinates(weights, read_y)
        report["free_fit_x"] = dict(zip(codes, [round(v, 2) for v in free_x], strict=True))
        report["free_fit_y"] = dict(zip(codes, [round(v, 2) for v in free_y], strict=True))
        report["free_fit_max_residual_x"] = round(residual_x, 3)
        report["free_fit_max_residual_y"] = round(residual_y, 3)
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--positions", type=Path, nargs="+", required=True)
    parser.add_argument(
        "--pair",
        type=Path,
        nargs=2,
        action="append",
        required=True,
        metavar=("NUMERISE", "ELECTION"),
    )
    parser.add_argument("--json", type=Path)
    args = parser.parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8")

    def load(path: Path) -> dict[str, Any]:
        return json.loads(path.read_text(encoding="utf-8"))

    positions = collect_group_positions(load(p) for p in args.positions)
    rows: list[dict[str, Any]] = []
    missing: list[str] = []
    composition_keys: set[str] = set()
    pairs = [(load(a), load(b)) for a, b in args.pair]
    for _, election in pairs:
        for composition in election["composition"].values():
            composition_keys |= set(composition)
    codes = [
        code for code in positions if any(part in composition_keys for part in code.split("+"))
    ]
    for document, election in pairs:
        found, absent = rows_from_election(document, election, codes)
        rows += found
        missing += absent
    report = linear_check(rows, positions, codes)
    report["without_composition"] = missing
    print(json.dumps(report, ensure_ascii=False, indent=1))
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
