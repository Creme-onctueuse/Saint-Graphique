"""Compare plusieurs définitions de l'axe X aux positions lues, sans toucher aux méthodes.

Pour chaque variable de ``data/pcs.json`` : rangs des PCS ramenés sur [-10, 10], moyenne des
groupes par population, puis barycentre linéaire des électorats avec nos compositions. Mesure
l'accord avec les PCS et les candidats numérisés. La variante « ratio » reproduit le X de
``ranks`` et sert de contrôle.

Usage :
    uv run python scripts/analyze/x_variants.py --json research/digitized/compare/_x_variants.json
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.analyze.compare import HYPOTHESES, candidate_key  # noqa: E402
from scripts.analyze.pure import rmse, spearman, to_ranks_scale, weighted_mean  # noqa: E402

DIGITIZED = Path("research/digitized")
ELECTIONS = Path("data/elections")
VARIABLES = (
    "ratio patrimoine / niveau de vie",
    "patrimoine médian",
    "niveau de vie",
    "part du patrimoine professionnel",
    "part du capital d'entreprise",
    "part des valeurs mobilières",
    "part du patrimoine financier",
    "part de l'immobilier",
)
PCS_VERSIONS = (
    "diapo_2025_01_07",
    "powerbi_2025_03_27",
    "powerbi_2026_02_14",
    "powerbi_2026_02_28",
)
CANDIDATE_SETS = {
    "Power BI 2025": (
        ("powerbi_2025_01_26__2017_presidentielle_t1", "2017_presidentielle_t1"),
        ("powerbi_2025_01_26__2022_presidentielle_t1", "2022_presidentielle_t1"),
        ("powerbi_2025_01_26__2024_europeennes", "2024_europeennes"),
        ("powerbi_2025_03_27__2022_presidentielle_t1", "2022_presidentielle_t1"),
        ("powerbi_2025_03_27__2024_legislatives_t1", "2024_legislatives_t1"),
    ),
    "matrice v11": (
        ("matrice_v11_2026_09__2017_presidentielle_t1", "2017_presidentielle_t1"),
        ("matrice_v11_2026_09__2022_presidentielle_t1", "2022_presidentielle_t1"),
    ),
}


def rank_axis(items: Sequence[Mapping[str, Any]], variable: str) -> dict[str, float] | None:
    """Rangs de la variable sur [-10, 10], par code. ``None`` si une valeur manque."""
    read = HYPOTHESES[variable]
    values = [read(item) for item in items]
    if any(v is None for v in values):
        return None
    scaled = to_ranks_scale([float(v) for v in values])
    return {item["code"]: value for item, value in zip(items, scaled, strict=True)}


def group_axis(items: Sequence[Mapping[str, Any]], axis: Mapping[str, float]) -> dict[str, float]:
    """Moyenne des coordonnées de chaque groupe, pondérée par la population."""
    groups: dict[str, list[Mapping[str, Any]]] = {}
    for item in items:
        groups.setdefault(str(item["group"]), []).append(item)
    return {
        group: weighted_mean(
            [axis[m["code"]] for m in members], [float(m["population"]) for m in members]
        )
        for group, members in groups.items()
    }


def candidate_x(election: Mapping[str, Any], groups: Mapping[str, float]) -> dict[str, float]:
    """Barycentre linéaire en X de chaque électorat, sur les groupes qu'il mentionne."""
    result = {}
    for identifier, composition in election["composition"].items():
        keys = [k for k in groups if float(composition.get(k) or 0) > 0]
        if keys:
            result[identifier] = weighted_mean(
                [groups[k] for k in keys], [float(composition[k]) for k in keys]
            )
    return result


def read_candidate_pairs(
    document: Mapping[str, Any],
    election: Mapping[str, Any],
    predicted: Mapping[str, float],
) -> list[tuple[float, float]]:
    """Paires (X lu, X calculé) des candidats trouvés dans l'élection."""
    identifiers = {candidate_key(c["label"]): c["id"] for c in election["candidates"]}
    identifiers.update({c["id"]: c["id"] for c in election["candidates"]})
    pairs = []
    for point in document["points"]:
        if point["kind"] != "candidate":
            continue
        identifier = identifiers.get(point.get("code") or "") or identifiers.get(
            candidate_key(point["label"])
        )
        if identifier in predicted:
            pairs.append((float(point["x"]), predicted[identifier]))
    return pairs


def agreement(pairs: Sequence[tuple[float, float]]) -> dict[str, Any]:
    """Effectif, RMSE et Spearman d'une liste de paires."""
    if len(pairs) < 2:
        return {"n": len(pairs)}
    read = [a for a, _ in pairs]
    ours = [b for _, b in pairs]
    correlation = spearman(read, ours)
    return {
        "n": len(pairs),
        "rmse": round(rmse(read, ours), 3),
        "spearman": None if correlation is None else round(correlation, 3),
    }


def within_groups(
    points: Sequence[Mapping[str, Any]],
    items: Sequence[Mapping[str, Any]],
    axis: Mapping[str, float],
    *,
    min_size: int = 3,
) -> dict[str, dict[str, Any]]:
    """Spearman entre X lu et variable à l'intérieur de chaque groupe de PCS."""
    group_of = {item["code"]: str(item["group"]) for item in items}
    groups: dict[str, list[Mapping[str, Any]]] = {}
    for point in points:
        code = point.get("code")
        if code in axis and code in group_of:
            groups.setdefault(group_of[code], []).append(point)
    result = {}
    for group, members in sorted(groups.items()):
        if len(members) < min_size:
            continue
        correlation = spearman([float(m["x"]) for m in members], [axis[m["code"]] for m in members])
        result[group] = {
            "n": len(members),
            "spearman": None if correlation is None else round(correlation, 2),
        }
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", type=Path)
    args = parser.parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8")

    def load(path: Path) -> dict[str, Any]:
        return json.loads(path.read_text(encoding="utf-8"))

    items = load(Path("data/pcs.json"))["items"]
    documents = {v: load(DIGITIZED / f"{v}.json") for v in PCS_VERSIONS}
    report = []
    for variable in VARIABLES:
        axis = rank_axis(items, variable)
        if axis is None:
            continue
        groups = group_axis(items, axis)
        row: dict[str, Any] = {"variable": variable, "distinct": len(set(axis.values()))}
        for version, document in documents.items():
            pairs = [
                (float(p["x"]), axis[p["code"]])
                for p in document["points"]
                if p.get("code") in axis
            ]
            row[version] = agreement(pairs)
            row[version]["within_groups"] = within_groups(document["points"], items, axis)
        for name, sets in CANDIDATE_SETS.items():
            pairs = []
            for digitized, election_id in sets:
                election = load(ELECTIONS / f"{election_id}.json")
                pairs += read_candidate_pairs(
                    load(DIGITIZED / f"{digitized}.json"), election, candidate_x(election, groups)
                )
            row[name] = agreement(pairs)
        report.append(row)
        print(
            f"{variable:<34} valeurs={row['distinct']:<3} "
            + " | ".join(
                f"{key}: n={row[key]['n']} RMSE {row[key].get('rmse')} S {row[key].get('spearman')}"
                for key in ("powerbi_2026_02_28", "Power BI 2025", "matrice v11")
            )
        )
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
