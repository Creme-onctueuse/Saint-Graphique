"""Test sur le passé et projection 2027 des électorats.

Principe : les catégories ne bougent pas d'une élection à l'autre, seuls les électorats se
déplacent. Une trajectoire est la suite des positions et des scores d'une famille ou d'un bloc
(``config/families.yaml``). Deux scénarios sont comparés :

- « rien ne bouge » : le dernier point connu ;
- « la tendance continue » : le dernier point, prolongé par la pente des moindres carrés.

``phi`` dose la tendance : 0 pour « rien ne bouge », 1 pour la tendance entière.

Le test est un test glissant : chaque point est prédit depuis les points antérieurs, à condition
d'en avoir au moins ``MIN_HISTORY``. Il dit ce que vaut chaque scénario sur le passé : c'est le
résultat à afficher avec la projection, quel qu'il soit. Les paramètres ne sont pas ajustés sur ce
test.

Seuls les scrutins connus par un sondage y entrent : une étape marquée ``estimated`` dans
``data/elections/`` en est écartée, comme de la pente et du dernier point connu.

Usage :
    uv run python scripts/analyze/projection.py           # écrit data/computed/_projection/
    uv run python scripts/analyze/projection.py --check   # échoue si les fichiers sont périmés
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any, NamedTuple

import yaml

ROOT = Path(__file__).resolve().parents[2]
COMPUTED = ROOT / "data" / "computed"
ELECTIONS = ROOT / "data" / "elections"
CONFIG = ROOT / "config" / "families.yaml"
OUT_DIR = COMPUTED / "_projection"

METHODS = ("read_positions", "ranks", "continuous", "mca", "espace_social", "acm_individus")
#: Nombre minimal de points antérieurs pour qu'un point soit prédit dans le test.
MIN_HISTORY = 3
#: Doses de tendance du tableau : 0 = rien ne bouge, 1 = tendance entière.
PHIS = (0.0, 0.25, 0.5, 1.0)
#: Le premier tour de 2027 est attendu au printemps.
TARGET_DATE = 2027.30
TARGET_LABEL = "Présidentielle 2027"
#: Dernier scrutin couvert par les données.
DATA_END = "2024-07"
ABSTENTION = "abstention"


class Point(NamedTuple):
    election: str
    date: float
    x: float
    y: float
    score: float


class Errors(NamedTuple):
    position: float
    score: float


def read_config(path: Path = CONFIG) -> dict[str, Any]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def read_documents(
    method: str, dates: Mapping[str, float], computed: Path = COMPUTED
) -> dict[str, dict[str, Any]]:
    """Fichiers calculés de la méthode, un par élection datée. Fichier manquant : une erreur."""
    docs = {}
    for election in dates:
        path = computed / method / f"{election}.json"
        docs[election] = json.loads(path.read_text(encoding="utf-8"))
    return docs


def read_elections(
    dates: Mapping[str, float], directory: Path = ELECTIONS
) -> dict[str, dict[str, Any]]:
    """Fichiers bruts des élections datées : ils portent tous les scores, placés ou non."""
    return {
        election: json.loads((directory / f"{election}.json").read_text(encoding="utf-8"))
        for election in dates
    }


def poll_based(
    dates: Mapping[str, float], elections: Mapping[str, Mapping[str, Any]]
) -> dict[str, float]:
    """Dates des seuls scrutins connus par un sondage, sans les étapes estimées."""
    return {e: d for e, d in dates.items() if elections[e].get("estimated") is not True}


def raw_scores(elections: Mapping[str, Mapping[str, Any]]) -> dict[str, dict[str, float]]:
    """Score de chaque candidat, y compris ceux qui n'ont pas de composition."""
    return {
        election: {
            c["id"]: c["national_share_pct"]
            for c in document["candidates"]
            if "national_share_pct" in c
        }
        for election, document in elections.items()
    }


def _candidates(doc: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    return {c["id"]: c for c in doc["candidates"]}


def family_series(
    family: Mapping[str, Any],
    docs: Mapping[str, Mapping[str, Any]],
    dates: Mapping[str, float],
) -> list[Point]:
    """Trajectoire d'une famille. Une élection sans électorat de la famille n'y figure pas."""
    points = []
    for election, candidate_id in family["candidates"].items():
        if election not in docs:
            continue
        c = _candidates(docs[election])[candidate_id]
        points.append(
            Point(election, dates[election], c["x"], c["y"], c["national_share_pct"])
        )
    return sorted(points, key=lambda p: p.date)


def bloc_series(
    bloc: Mapping[str, Any],
    docs: Mapping[str, Mapping[str, Any]],
    dates: Mapping[str, float],
    scores: Mapping[str, Mapping[str, float]] | None = None,
) -> list[Point]:
    """Trajectoire d'un bloc : barycentre de ses électorats, pondéré par leurs scores.

    ``scores`` compte aussi les candidats sans composition, trop petits pour être placés : ils
    pèsent dans le score du bloc, pas dans sa position.
    """
    members = set(bloc["candidates"])
    points = []
    for election, doc in docs.items():
        rows = [c for c in doc["candidates"] if c["id"] in members]
        placed = sum(c["national_share_pct"] for c in rows)
        if placed <= 0:
            continue
        x = sum(c["x"] * c["national_share_pct"] for c in rows) / placed
        y = sum(c["y"] * c["national_share_pct"] for c in rows) / placed
        score = placed
        if scores is not None:
            score = sum(v for k, v in scores[election].items() if k in members)
        points.append(Point(election, dates[election], x, y, score))
    return sorted(points, key=lambda p: p.date)


def ols_slope(ts: Sequence[float], vs: Sequence[float]) -> float:
    """Pente des moindres carrés ; nulle si toutes les dates coïncident."""
    n = len(ts)
    mean_t = sum(ts) / n
    mean_v = sum(vs) / n
    spread = sum((t - mean_t) ** 2 for t in ts)
    if spread == 0:
        return 0.0
    return sum((t - mean_t) * (v - mean_v) for t, v in zip(ts, vs, strict=True)) / spread


def predict(history: Sequence[Point], date: float, phi: float) -> tuple[float, float, float]:
    """Dernier point, prolongé jusqu'à ``date`` par ``phi`` fois la pente de l'historique."""
    ts = [p.date for p in history]
    last = history[-1]
    elapsed = date - last.date

    def extend(values: Sequence[float]) -> float:
        return values[-1] + phi * ols_slope(ts, values) * elapsed

    return (
        extend([p.x for p in history]),
        extend([p.y for p in history]),
        extend([p.score for p in history]),
    )


def rolling_errors(series: Sequence[Point], phi: float) -> list[Errors]:
    """Erreurs du test glissant : chaque point prédit depuis les points antérieurs."""
    out = []
    for k in range(MIN_HISTORY, len(series)):
        target = series[k]
        x, y, score = predict(series[:k], target.date, phi)
        out.append(Errors(math.hypot(x - target.x, y - target.y), abs(score - target.score)))
    return out


def summarize(errors: Sequence[Errors]) -> dict[str, float | int]:
    """Erreur moyenne (typique) et pire erreur, en unités de la carte et en points de score."""
    if not errors:
        return {
            "n": 0,
            "position_mean": 0.0,
            "position_worst": 0.0,
            "score_mean": 0.0,
            "score_worst": 0.0,
        }
    return {
        "n": len(errors),
        "position_mean": round(sum(e.position for e in errors) / len(errors), 4),
        "position_worst": round(max(e.position for e in errors), 4),
        "score_mean": round(sum(e.score for e in errors) / len(errors), 4),
        "score_worst": round(max(e.score for e in errors), 4),
    }


def backtest_rows(series_by_key: Mapping[str, Sequence[Point]]) -> list[dict[str, float | int]]:
    """Une ligne par dose de tendance, toutes trajectoires confondues."""
    rows = []
    for phi in PHIS:
        pooled: list[Errors] = []
        for series in series_by_key.values():
            pooled.extend(rolling_errors(series, phi))
        rows.append({"phi": phi, **summarize(pooled)})
    return rows


def _row(rows: Iterable[Mapping[str, float | int]], phi: float) -> Mapping[str, float | int]:
    return next(r for r in rows if r["phi"] == phi)


def verdict(
    parties: Sequence[Mapping[str, float | int]], blocs: Sequence[Mapping[str, float | int]]
) -> dict[str, bool]:
    """La tendance entière fait-elle pire que « rien ne bouge » ?"""

    def worse(rows: Sequence[Mapping[str, float | int]], key: str) -> bool:
        return _row(rows, 1.0)[key] > _row(rows, 0.0)[key]

    position = worse(parties, "position_mean") and worse(blocs, "position_mean")
    score = worse(parties, "score_mean") and worse(blocs, "score_mean")
    return {"trend_worse_position": position, "trend_worse_score": score}


def _scenario_errors(
    series: Sequence[Point], fallback: Mapping[str, float | int], phi: float
) -> dict[str, float | int]:
    """Erreur propre à la trajectoire ; celle de l'ensemble si elle est trop courte pour le test."""
    own = summarize(rolling_errors(series, phi))
    if own["n"] > 0:
        return own
    return {**fallback, "n": 0}


def _position(point: tuple[float, float, float]) -> dict[str, float]:
    return {"x": round(point[0], 4), "y": round(point[1], 4)}


def _projected(
    series: Sequence[Point],
    still_pool: Mapping[str, float | int],
    trend_pool: Mapping[str, float | int],
) -> dict[str, Any]:
    still = predict(series, TARGET_DATE, 0.0)
    trend = predict(series, TARGET_DATE, 1.0)
    return {
        "last_election": series[-1].election,
        "points": len(series),
        "still": _position(still),
        "trend": _position(trend),
        "error": {
            "still": _scenario_errors(series, still_pool, 0.0),
            "trend": _scenario_errors(series, trend_pool, 1.0),
        },
    }


def _score_range(score: float, typical: float) -> list[float]:
    return [round(max(0.0, score - typical), 1), round(score + typical, 1)]


def _last_color(family: Mapping[str, Any], docs: Mapping[str, Mapping[str, Any]], last: str) -> str:
    return _candidates(docs[last])[family["candidates"][last]]["color"]


def build_document(
    method: str,
    config: Mapping[str, Any],
    docs: Mapping[str, Mapping[str, Any]],
    scores: Mapping[str, Mapping[str, float]] | None = None,
) -> dict[str, Any]:
    """Document ``schemas/projection.schema.json`` d'une méthode."""
    dates = {e: d for e, d in config["dates"].items() if e in docs}
    families = {k: v for k, v in config["families"].items() if v.get("projection") is True}
    party_series = {k: family_series(v, docs, dates) for k, v in families.items()}
    all_blocs = {k: bloc_series(v, docs, dates, scores) for k, v in config["blocs"].items()}
    # L'abstention est projetée, mais hors du tableau : elle suit le type d'élection, pas le temps.
    tested_blocs = {k: v for k, v in all_blocs.items() if k != ABSTENTION}

    party_rows = backtest_rows(party_series)
    bloc_rows = backtest_rows(tested_blocs)

    party_docs = []
    for key, series in party_series.items():
        party_docs.append(
            {
                "id": key,
                "label": families[key]["label"],
                "color": _last_color(families[key], docs, series[-1].election),
                **_projected(series, _row(party_rows, 0.0), _row(party_rows, 1.0)),
            }
        )

    bloc_docs = []
    for key, series in all_blocs.items():
        projected = _projected(series, _row(bloc_rows, 0.0), _row(bloc_rows, 1.0))
        still_score = predict(series, TARGET_DATE, 0.0)[2]
        trend_score = predict(series, TARGET_DATE, 1.0)[2]
        errors = projected["error"]
        bloc_docs.append(
            {
                "id": key,
                "label": config["blocs"][key]["label"],
                "tested": key != ABSTENTION,
                **projected,
                "score_range": {
                    "still": _score_range(still_score, float(errors["still"]["score_mean"])),
                    "trend": _score_range(trend_score, float(errors["trend"]["score_mean"])),
                },
            }
        )

    return {
        "method": method,
        "target": {"label": TARGET_LABEL, "date": TARGET_DATE},
        "data_end": DATA_END,
        "min_history": MIN_HISTORY,
        "backtest": {
            "parties": party_rows,
            "blocs": bloc_rows,
            "verdict": verdict(party_rows, bloc_rows),
        },
        "families": party_docs,
        "blocs": bloc_docs,
    }


def serialized(doc: Mapping[str, Any]) -> str:
    return json.dumps(doc, ensure_ascii=False, indent=2) + "\n"


def print_table(method: str, doc: Mapping[str, Any]) -> None:
    print(f"{method} : erreur moyenne (pire erreur), position en unités de carte, score en points")
    for scope, title in (("parties", "Partis"), ("blocs", "Blocs")):
        for row in doc["backtest"][scope]:
            print(
                f"  {title:6s} phi={row['phi']:<4} n={row['n']:<2} "
                f"position {row['position_mean']:.2f} ({row['position_worst']:.2f}) "
                f"score {row['score_mean']:.1f} ({row['score_worst']:.1f})"
            )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="vérifie sans écrire")
    args = parser.parse_args(argv)
    config = read_config()
    elections = read_elections(config["dates"])
    dates = poll_based(config["dates"], elections)
    scores = raw_scores(elections)
    stale = []
    for method in METHODS:
        doc = build_document(method, config, read_documents(method, dates), scores)
        path = OUT_DIR / f"{method}.json"
        text = serialized(doc)
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != text:
                stale.append(path.name)
        else:
            OUT_DIR.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8", newline="\n")
            print_table(method, doc)
    if stale:
        print(f"Fichiers à régénérer : {', '.join(stale)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
