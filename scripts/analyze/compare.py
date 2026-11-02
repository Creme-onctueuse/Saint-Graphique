"""Compare une version numérisée du graphique aux coordonnées calculées par nos méthodes.

Apparie les points par code PCS ou par libellé, puis mesure RMSE et Spearman sur X et Y
et liste les plus grands écarts. Mêmes mesures pour les candidats si possible. Avec
``--hypotheses``, corrèle aussi les coordonnées lues aux variables de ``data/pcs.json``
(ratio patrimoine / niveau de vie, etc.), sans rien modifier aux méthodes.

Usage :
    uv run python scripts/analyze/compare.py research/digitized/v.json --method ranks \
        --election 2022_presidentielle_t1 --hypotheses
    uv run python scripts/analyze/compare.py research/digitized/v.json --computed fichier.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Callable, Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.analyze.pure import (  # noqa: E402
    best_label_match,
    normalize_label,
    pearson,
    rmse,
    spearman,
)

COMPUTED_DIR = Path("data/computed")
PCS_FILE = Path("data/pcs.json")

# Nomenclature du graphique lu (42 postes de la PCS 2003) vers nos 30 codes : ces postes
# n'existent chez nous qu'agrégés. Les inactifs 81 à 86 n'ont pas d'équivalent.
AGGREGATED_CODES = {
    "11": "10",
    "12": "10",
    "13": "10",
    "71": "7",
    "72": "7",
    "74": "7",
    "75": "7",
    "77": "7",
    "78": "7",
}


Point = Mapping[str, Any]


def round_or_none(value: float | None, digits: int = 3) -> float | None:
    """Arrondit une mesure sans perdre ``None`` (corrélation indéfinie)."""
    return None if value is None else round(value, digits)


def metrics(pairs: Sequence[tuple[Point, Point]], top: int = 8) -> dict[str, Any]:
    """Mesure l'accord entre points lus et points calculés, appariés deux à deux."""
    if not pairs:
        return {"n": 0}
    read_x = [float(a["x"]) for a, _ in pairs]
    read_y = [float(a["y"]) for a, _ in pairs]
    ours_x = [float(b["x"]) for _, b in pairs]
    ours_y = [float(b["y"]) for _, b in pairs]
    gaps = []
    for a, b in pairs:
        dx = float(b["x"]) - float(a["x"])
        dy = float(b["y"]) - float(a["y"])
        gaps.append(
            {
                "label": a["label"],
                "key": b.get("code") or b.get("id"),
                "read": [a["x"], a["y"]],
                "ours": [round(float(b["x"]), 2), round(float(b["y"]), 2)],
                "dx": round(dx, 2),
                "dy": round(dy, 2),
            }
        )
    gaps.sort(key=lambda g: -(g["dx"] ** 2 + g["dy"] ** 2))
    return {
        "n": len(pairs),
        "rmse_x": round(rmse(read_x, ours_x), 3),
        "rmse_y": round(rmse(read_y, ours_y), 3),
        "spearman_x": round_or_none(spearman(read_x, ours_x)),
        "spearman_y": round_or_none(spearman(read_y, ours_y)),
        "largest_gaps": gaps[:top],
    }


def match_pcs(
    read: Iterable[Point],
    computed: Iterable[Point],
    *,
    aggregate: bool = False,
) -> tuple[list[tuple[Point, Point]], list[str]]:
    """Apparie les PCS par code, puis par libellé. Rend les paires et les non appariés.

    Avec ``aggregate``, les postes détaillés (11-13, 71-78) sont d'abord rassemblés en
    un point pondéré sur leur code agrégé (10, 7) : pondération par ``weight`` si tous
    l'ont, sinon moyenne simple.
    """
    by_code = {p["code"]: p for p in computed}
    labels = {p["code"]: [p.get("label", ""), p.get("short", "")] for p in computed}
    source = aggregate_points(read) if aggregate else list(read)
    pairs: list[tuple[Point, Point]] = []
    missing: list[str] = []
    for point in source:
        code = point.get("code")
        if code in by_code:
            pairs.append((point, by_code[code]))
            continue
        found = None if code else best_label_match(point["label"], labels, min_score=0.6)
        if found:
            pairs.append((point, by_code[found[0]]))
        else:
            missing.append(point["label"])
    return pairs, missing


def aggregate_points(points: Iterable[Point]) -> list[dict[str, Any]]:
    """Rassemble les postes détaillés sur leur code agrégé (voir ``AGGREGATED_CODES``)."""
    kept: list[dict[str, Any]] = []
    groups: dict[str, list[Point]] = {}
    for point in points:
        target = AGGREGATED_CODES.get(point.get("code"))
        if target:
            groups.setdefault(target, []).append(point)
        else:
            kept.append(dict(point))
    for code, members in groups.items():
        use_weight = all(m.get("weight") for m in members)
        weights = [float(m["weight"]) if use_weight else 1.0 for m in members]
        total = sum(weights)
        kept.append(
            {
                "kind": "pcs",
                "code": code,
                "label": "+".join(m["label"] for m in members),
                "x": sum(w * float(m["x"]) for w, m in zip(weights, members, strict=True)) / total,
                "y": sum(w * float(m["y"]) for w, m in zip(weights, members, strict=True)) / total,
            }
        )
    return kept


def candidate_key(label: str) -> str:
    """Dernier mot significatif d'un nom de candidat (« E. Macron » devient « macron »)."""
    words = normalize_label(re.sub(r"\(.*?\)", " ", label)).split()
    if len(words) >= 2 and words[-2] in {"le", "de", "la"}:
        return " ".join(words[-2:])
    return words[-1] if words else ""


def match_candidates(
    read: Iterable[Point], computed: Iterable[Point]
) -> tuple[list[tuple[Point, Point]], list[str]]:
    """Apparie les candidats sur le nom de famille, ou sur l'identifiant."""
    table: dict[str, Point] = {}
    for candidate in computed:
        table[candidate_key(candidate.get("label", ""))] = candidate
        table[normalize_label(candidate.get("id", ""))] = candidate
    pairs: list[tuple[Point, Point]] = []
    missing: list[str] = []
    for point in read:
        found = table.get(normalize_label(str(point.get("code") or "")))
        if found is None:
            found = table.get(candidate_key(point["label"]))
        if found is None:
            found = table.get(normalize_label(point["label"]))
        if found is None:
            missing.append(point["label"])
        else:
            pairs.append((point, found))
    return pairs, missing


def match_groups(
    read: Iterable[Point], groups: Iterable[Point]
) -> tuple[list[tuple[Point, Point]], list[str]]:
    """Apparie des points de niveau groupe, un code ``1+2`` fusionnant plusieurs groupes.

    La fusion est le barycentre de nos groupes, pondéré par leur poids.
    """
    by_code = {g["code"]: g for g in groups}
    pairs: list[tuple[Point, Point]] = []
    missing: list[str] = []
    for point in read:
        codes = str(point.get("code", "")).split("+")
        members = [by_code[c] for c in codes if c in by_code]
        if len(members) != len(codes) or not members:
            missing.append(point["label"])
            continue
        total = sum(float(m.get("weight") or 0) for m in members) or float(len(members))
        share = [(float(m.get("weight") or 0) or total / len(members)) / total for m in members]
        pairs.append(
            (
                point,
                {
                    "code": "+".join(codes),
                    "x": sum(w * float(m["x"]) for w, m in zip(share, members, strict=True)),
                    "y": sum(w * float(m["y"]) for w, m in zip(share, members, strict=True)),
                },
            )
        )
    return pairs, missing


# --- Hypothèses testées sur les variables de data/pcs.json -----------------------------


def ratio(item: Mapping[str, Any]) -> float | None:
    """Patrimoine rapporté au niveau de vie annuel, ``None`` si une donnée manque."""
    wealth = item.get("patrimoine_keur")
    living = item.get("niveau_vie_mensuel_eur")
    return wealth / living if wealth is not None and living else None


def diploma_score(item: Mapping[str, Any]) -> float | None:
    """Score de diplôme de la méthode des rangs, avec les poids 5, 3, 2, 1, -1, -2, -3."""
    diplomas = item.get("diplomes")
    if not diplomas:
        return None
    weights = {"bac5": 5, "bac3": 3, "bac2": 2, "bac": 1, "cap": -1, "brevet": -2}
    weights["certif_aucun"] = -3
    return sum(w * float(diplomas.get(k) or 0) for k, w in weights.items())


def composition(field: str) -> Callable[[Mapping[str, Any]], float | None]:
    """Lit un champ de ``patrimoine_composition`` (absent des anciennes versions du fichier)."""

    def read(item: Mapping[str, Any]) -> float | None:
        return (item.get("patrimoine_composition") or {}).get(field)

    return read


HYPOTHESES: dict[str, Callable[[Mapping[str, Any]], float | None]] = {
    "ratio patrimoine / niveau de vie": ratio,
    "patrimoine médian": lambda item: item.get("patrimoine_keur"),
    "niveau de vie": lambda item: item.get("niveau_vie_mensuel_eur"),
    "score de diplôme": diploma_score,
    "part du patrimoine professionnel": composition("professionnel_pct"),
    "part du capital d'entreprise": composition("professionnel_entreprises_pct"),
    "part des valeurs mobilières": composition("valeurs_mobilieres_pct"),
    "part du patrimoine financier": composition("financier_pct"),
    "part de l'immobilier": composition("immobilier_pct"),
}


def merge_items(items: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Moyenne pondérée par la population des variables de plusieurs lignes de PCS."""
    weights = [float(i.get("population") or 0) for i in items]
    total = sum(weights)
    weights = [w / total for w in weights] if total else [1 / len(items)] * len(items)

    def mean(read: Callable[[Mapping[str, Any]], Any]) -> float | None:
        pairs = [(read(i), w) for i, w in zip(items, weights, strict=True)]
        pairs = [(float(v), w) for v, w in pairs if v is not None]
        weight = sum(w for _, w in pairs)
        return sum(v * w for v, w in pairs) / weight if weight else None

    merged: dict[str, Any] = {
        "patrimoine_keur": mean(lambda i: i.get("patrimoine_keur")),
        "niveau_vie_mensuel_eur": mean(lambda i: i.get("niveau_vie_mensuel_eur")),
    }
    for field in ("diplomes", "patrimoine_composition"):
        keys = {k for i in items for k in (i.get(field) or {})}
        merged[field] = {
            k: mean(lambda i, name=k, f=field: (i.get(f) or {}).get(name)) for k in keys
        }
    return merged


def evaluate_hypotheses(
    read_pcs: Iterable[Point],
    pcs_items: Iterable[Mapping[str, Any]],
    *,
    level: str = "pcs",
) -> list[dict[str, Any]]:
    """Corrèle (Spearman, Pearson) X et Y lus à chaque variable, sur les codes communs.

    Au niveau ``group``, le code d'un point désigne des groupes (``3``, ``1+2``) et les
    variables sont moyennées par population. ``distinct`` compte les valeurs différentes :
    une variable connue seulement par groupe a beaucoup d'ex aequo, et son rang dit peu.
    """
    catalog = list(pcs_items)
    if level == "group":
        rows_by_point = []
        for point in read_pcs:
            codes = str(point.get("code", "")).split("+")
            members = [i for i in catalog if str(i.get("group")) in codes]
            if members:
                rows_by_point.append((point, merge_items(members)))
    else:
        items = {item["code"]: item for item in catalog}
        rows_by_point = [(p, items[p["code"]]) for p in read_pcs if p.get("code") in items]
    results = []
    for name, variable in HYPOTHESES.items():
        rows = [(p, variable(item)) for p, item in rows_by_point]
        rows = [(p, v) for p, v in rows if v is not None]
        values = [float(v) for _, v in rows]
        xs = [float(p["x"]) for p, _ in rows]
        ys = [float(p["y"]) for p, _ in rows]
        results.append(
            {
                "variable": name,
                "n": len(rows),
                "distinct": len({round(v, 6) for v in values}),
                "spearman_x": round_or_none(spearman(xs, values)),
                "spearman_y": round_or_none(spearman(ys, values)),
                "pearson_x": round_or_none(pearson(xs, values)),
                "pearson_y": round_or_none(pearson(ys, values)),
            }
        )
    return results


def grid_report(values: Sequence[float], *, step: float = 0.5, tolerance: float = 0.01) -> dict:
    """Part des valeurs situées sur une grille de pas ``step`` et valeurs distinctes."""
    if not values:
        return {"n": 0}
    on_grid = sum(abs(v / step - round(v / step)) * step <= tolerance for v in values)
    return {
        "n": len(values),
        "on_grid": on_grid,
        "share": round(on_grid / len(values), 3),
        "distinct": len({round(v, 2) for v in values}),
    }


# --- Sortie ---------------------------------------------------------------------------


def load_computed(args: argparse.Namespace) -> tuple[dict[str, Any], str]:
    """Charge le fichier calculé demandé et rend son contenu et son nom."""
    path = args.computed or COMPUTED_DIR / args.method / f"{args.election}.json"
    return json.loads(Path(path).read_text(encoding="utf-8")), str(path)


def print_metrics(title: str, block: Mapping[str, Any]) -> None:
    """Imprime un bloc de mesures lisible en console."""
    if not block.get("n"):
        print(f"{title} : aucun point apparié")
        return
    print(
        f"{title} : n={block['n']} RMSE X={block['rmse_x']} Y={block['rmse_y']} "
        f"Spearman X={block['spearman_x']} Y={block['spearman_y']}"
    )
    for gap in block["largest_gaps"]:
        print(
            f"    {gap['label'][:46]:<46} lu {gap['read']} nous {gap['ours']} "
            f"dx {gap['dx']:+} dy {gap['dy']:+}"
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("digitized", type=Path)
    parser.add_argument("--method", default="ranks")
    parser.add_argument("--election", default="population")
    parser.add_argument("--computed", type=Path, help="fichier calculé à la place de la méthode")
    parser.add_argument("--min-confidence", type=float, default=0.0)
    parser.add_argument("--hypotheses", action="store_true")
    parser.add_argument("--top", type=int, default=8)
    parser.add_argument("--json", type=Path, help="sortie JSON")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8")

    document = json.loads(args.digitized.read_text(encoding="utf-8"))
    computed, computed_name = load_computed(args)
    points = [p for p in document["points"] if p.get("confidence", 1) >= args.min_confidence]
    read_groups = [p for p in points if p.get("level") == "group"]
    read_pcs = [p for p in points if p["kind"] == "pcs" and p.get("level") != "group"]
    read_candidates = [p for p in points if p["kind"] == "candidate"]

    exact_pairs, exact_missing = match_pcs(read_pcs, computed.get("pcs", []))
    merged_pairs, _ = match_pcs(read_pcs, computed.get("pcs", []), aggregate=True)
    candidate_pairs, candidate_missing = match_candidates(
        read_candidates, computed.get("candidates", [])
    )
    group_pairs, group_missing = match_groups(read_groups, computed.get("groups", []))
    report: dict[str, Any] = {
        "version_id": document["version_id"],
        "computed": computed_name,
        "groups": metrics(group_pairs, args.top),
        "groups_unmatched": group_missing,
        "pcs": metrics(exact_pairs, args.top),
        "pcs_unmatched": exact_missing,
        "pcs_with_aggregates": metrics(merged_pairs, args.top),
        "candidates": metrics(candidate_pairs, args.top),
        "candidates_unmatched": candidate_missing,
        "grid_x": grid_report([float(p["x"]) for p in read_pcs if p.get("method") == "tooltip"]),
        "grid_y": grid_report([float(p["y"]) for p in read_pcs if p.get("method") == "tooltip"]),
    }

    pcs_data = json.loads(PCS_FILE.read_text(encoding="utf-8")) if PCS_FILE.exists() else {}
    items = pcs_data.get("items", [])
    report["patrimoine_composition_in_pcs_json"] = any(
        "patrimoine_composition" in item for item in items
    )
    if args.hypotheses:
        report["hypotheses"] = evaluate_hypotheses(read_pcs, items)
        report["hypotheses_groups"] = evaluate_hypotheses(read_groups, items, level="group")

    if not args.quiet:
        print(f"{document['version_id']} contre {computed_name}")
        print_metrics("Groupes", report["groups"])
        print_metrics("PCS, codes communs", report["pcs"])
        print_metrics("PCS, postes détaillés agrégés", report["pcs_with_aggregates"])
        print_metrics("Candidats", report["candidates"])
        if exact_missing:
            print(f"PCS sans équivalent ({len(exact_missing)}) : " + " ; ".join(exact_missing))
        if candidate_missing:
            print("Candidats sans équivalent : " + " ; ".join(candidate_missing))
        print(f"Grille 0,5 sur les infobulles : X {report['grid_x']} Y {report['grid_y']}")
        for title, key in (("PCS", "hypotheses"), ("groupes", "hypotheses_groups")):
            for row in report.get(key, []):
                if not row["n"]:
                    continue
                print(
                    f"  {title} : {row['variable']:<34} n={row['n']:<3} "
                    f"valeurs={row['distinct']:<3} "
                    f"Spearman X={row['spearman_x']} Y={row['spearman_y']}"
                )
        if report["patrimoine_composition_in_pcs_json"]:
            print("SIGNAL : patrimoine_composition figure dans data/pcs.json (méthodes inchangées)")
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
