"""Tests du test sur le passé et de la projection 2027.

Les calculs sont vérifiés sur des trajectoires inventées. Les chiffres réels ne sont contrôlés que
si les données issues de sondages sont présentes.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml
from jsonschema import Draft202012Validator

from scripts.analyze import projection as proj
from scripts.analyze.projection import Point

ROOT = Path(__file__).resolve().parents[2]
REAL = ROOT / "data" / "computed" / "read_positions" / "2022_presidentielle_t1.json"
needs_data = pytest.mark.skipif(not REAL.exists(), reason="données issues de sondages absentes")


def line(*values: float) -> list[Point]:
    """Trajectoire sur une droite, un point par an."""
    return [
        Point(f"e{i}", 2000.0 + i, v, 2 * v, 10 * v) for i, v in enumerate(values)
    ]


# --- Calculs -------------------------------------------------------------------------------------


def test_ols_slope_of_a_line() -> None:
    assert proj.ols_slope([0, 1, 2], [1, 3, 5]) == pytest.approx(2)


def test_ols_slope_is_zero_when_dates_coincide() -> None:
    assert proj.ols_slope([1, 1], [0, 5]) == 0


def test_phi_zero_keeps_the_last_point() -> None:
    assert proj.predict(line(1, 2, 3), 2010, 0.0) == (3, 6, 30)


def test_full_trend_extends_a_line_exactly() -> None:
    x, y, score = proj.predict(line(1, 2, 3), 2004, 1.0)
    assert (x, y, score) == pytest.approx((5, 10, 50))


def test_trend_is_anchored_at_the_last_point_not_the_fit() -> None:
    # La droite ajustée passe sous le dernier point : la prédiction part quand même de ce point.
    history = [Point("a", 2000, 0, 0, 0), Point("b", 2001, 0, 0, 0), Point("c", 2002, 3, 0, 0)]
    x, _, _ = proj.predict(history, 2003, 1.0)
    assert x == pytest.approx(3 + 1.5)


def test_half_trend_goes_half_way() -> None:
    x, _, _ = proj.predict(line(1, 2, 3), 2004, 0.5)
    assert x == pytest.approx(4)


def test_rolling_errors_need_enough_history() -> None:
    assert proj.rolling_errors(line(1, 2, 3), 0.0) == []
    assert len(proj.rolling_errors(line(1, 2, 3, 4), 0.0)) == 1
    assert len(proj.rolling_errors(line(1, 2, 3, 4, 5), 0.0)) == 2


def test_rolling_errors_measure_position_and_score() -> None:
    errors = proj.rolling_errors(line(1, 2, 3, 4), 0.0)
    assert errors[0].position == pytest.approx((1 + 4) ** 0.5)
    assert errors[0].score == pytest.approx(10)


def test_full_trend_has_no_error_on_a_line() -> None:
    errors = proj.rolling_errors(line(1, 2, 3, 4, 5), 1.0)
    assert all(e.position == pytest.approx(0, abs=1e-9) for e in errors)


def test_summarize_without_tests_is_empty() -> None:
    assert proj.summarize([])["n"] == 0


def test_family_series_skips_elections_without_the_family() -> None:
    docs = {
        "a": {"candidates": [{"id": "x", "x": 1, "y": 2, "national_share_pct": 3}]},
        "b": {"candidates": [{"id": "coalition", "x": 9, "y": 9, "national_share_pct": 9}]},
    }
    series = proj.family_series({"candidates": {"a": "x"}}, docs, {"a": 2000.0, "b": 2001.0})
    assert [p.election for p in series] == ["a"]


def test_bloc_series_is_weighted_by_score() -> None:
    docs = {
        "a": {
            "candidates": [
                {"id": "x", "x": 0, "y": 0, "national_share_pct": 30},
                {"id": "y", "x": 4, "y": 8, "national_share_pct": 10},
                {"id": "z", "x": 100, "y": 100, "national_share_pct": 60},
            ]
        }
    }
    series = proj.bloc_series({"candidates": ["x", "y"]}, docs, {"a": 2000.0})
    assert series[0].x == pytest.approx(1)
    assert series[0].y == pytest.approx(2)
    assert series[0].score == 40


def test_family_series_leaves_out_elections_without_a_document() -> None:
    family = {"candidates": {"e1": "a", "e2": "a"}}
    docs = {"e1": {"candidates": [{"id": "a", "x": 1, "y": 2, "national_share_pct": 3}]}}
    points = proj.family_series(family, docs, {"e1": 2000.0, "e2": 2005.0})
    assert [p.election for p in points] == ["e1"]


def test_bloc_score_counts_candidates_too_small_to_be_placed() -> None:
    docs = {"e": {"candidates": [{"id": "a", "x": 2, "y": 4, "national_share_pct": 10}]}}
    bloc = {"candidates": ["a", "petit"]}
    point = proj.bloc_series(bloc, docs, {"e": 2000.0}, {"e": {"a": 10, "petit": 1, "autre": 5}})[0]
    # La position vient du seul candidat placé, le score compte les deux.
    assert (point.x, point.y, point.score) == (2, 4, 11)


def test_bloc_without_placed_candidate_has_no_point() -> None:
    docs = {"e": {"candidates": [{"id": "a", "x": 2, "y": 4, "national_share_pct": 10}]}}
    bloc = {"candidates": ["abstention"]}
    assert proj.bloc_series(bloc, docs, {"e": 2000.0}, {"e": {"abstention": 20}}) == []


def test_estimated_stops_stay_out_of_the_test() -> None:
    dates = {"sondage": 2000.0, "estime": 2005.0}
    elections = {"sondage": {"candidates": []}, "estime": {"estimated": True, "candidates": []}}
    assert proj.poll_based(dates, elections) == {"sondage": 2000.0}


def test_build_document_uses_only_the_documents_it_receives() -> None:
    config = {
        "dates": {"e1": 2000.0, "e2": 2005.0},
        "families": {"f": {"label": "F", "projection": True, "candidates": {"e1": "a", "e2": "a"}}},
        "blocs": {},
    }
    candidate = {"id": "a", "x": 1, "y": 1, "national_share_pct": 5, "color": "#000000"}
    doc = proj.build_document("m", config, {"e1": {"candidates": [candidate]}})
    assert doc["families"][0]["last_election"] == "e1"
    assert doc["families"][0]["points"] == 1


def test_verdict_compares_full_trend_with_no_movement() -> None:
    def rows(still: float, trend: float) -> list[dict[str, float]]:
        return [
            {"phi": 0.0, "position_mean": still, "score_mean": still},
            {"phi": 1.0, "position_mean": trend, "score_mean": trend},
        ]

    assert proj.verdict(rows(1, 2), rows(1, 2)) == {
        "trend_worse_position": True,
        "trend_worse_score": True,
    }
    assert proj.verdict(rows(2, 1), rows(1, 2))["trend_worse_position"] is False


def test_score_range_never_goes_below_zero() -> None:
    assert proj._score_range(3, 5) == [0.0, 8.0]
    assert proj._score_range(30, 5) == [25.0, 35.0]


# --- Document ------------------------------------------------------------------------------------


def _schema() -> Draft202012Validator:
    schema = json.loads((ROOT / "schemas" / "projection.schema.json").read_text(encoding="utf-8"))
    return Draft202012Validator(schema)


def _fake_config() -> dict:
    dates = {f"e{i}": 2000.0 + i for i in range(5)}
    return {
        "dates": dates,
        "families": {
            "a": {"label": "A", "projection": True, "candidates": {e: "a" for e in dates}},
            "short": {"label": "Court", "projection": True, "candidates": {"e4": "a"}},
            "hidden": {"label": "Sans projection", "projection": False, "candidates": {"e0": "a"}},
        },
        "blocs": {
            "gauche": {"label": "Gauche", "candidates": ["a"]},
            "abstention": {"label": "Abstention", "candidates": ["abstention"]},
        },
    }


def _fake_docs(config: dict) -> dict:
    return {
        e: {
            "candidates": [
                {"id": "a", "color": "#111111", "x": i, "y": -i, "national_share_pct": 20 + i},
                {"id": "abstention", "color": "#222222", "x": 0, "y": 0, "national_share_pct": 40},
            ]
        }
        for i, e in enumerate(config["dates"])
    }


def test_document_follows_the_schema() -> None:
    config = _fake_config()
    doc = proj.build_document("m", config, _fake_docs(config))
    assert list(_schema().iter_errors(doc)) == []


def test_document_keeps_only_projected_families() -> None:
    config = _fake_config()
    doc = proj.build_document("m", config, _fake_docs(config))
    assert [f["id"] for f in doc["families"]] == ["a", "short"]


def test_short_series_borrows_the_pooled_error_and_says_so() -> None:
    config = _fake_config()
    doc = proj.build_document("m", config, _fake_docs(config))
    short = next(f for f in doc["families"] if f["id"] == "short")
    assert short["error"]["still"]["n"] == 0
    assert short["error"]["still"]["position_mean"] > 0


def test_abstention_is_projected_but_left_out_of_the_table() -> None:
    config = _fake_config()
    doc = proj.build_document("m", config, _fake_docs(config))
    abstention = next(b for b in doc["blocs"] if b["id"] == "abstention")
    assert abstention["tested"] is False
    assert abstention["score_range"]["still"] == [40.0, 40.0]
    # Une seule trajectoire testée (5 points, donc 2 prédictions) : celle du bloc de gauche.
    assert doc["backtest"]["blocs"][0]["n"] == 2


def test_parties_have_no_score_range() -> None:
    config = _fake_config()
    doc = proj.build_document("m", config, _fake_docs(config))
    assert all("score_range" not in f for f in doc["families"])


# --- Chiffres réels -------------------------------------------------------------------------------


@needs_data
def test_backtest_reproduces_the_published_table() -> None:
    config = proj.read_config()
    elections = proj.read_elections(config["dates"])
    docs = proj.read_documents("read_positions", proj.poll_based(config["dates"], elections))
    doc = proj.build_document("read_positions", config, docs, proj.raw_scores(elections))

    def table(scope: str, key: str) -> dict[float, float]:
        return {r["phi"]: r[key] for r in doc["backtest"][scope]}

    parties = doc["backtest"]["parties"]
    blocs = doc["backtest"]["blocs"]
    assert {r["n"] for r in parties} == {38}
    assert {r["n"] for r in blocs} == {35}

    position = table("parties", "position_mean")
    assert round(position[0.0], 2) == 0.74
    assert round(position[0.5], 2) == 0.76
    assert round(position[1.0], 2) == 0.78
    score = table("parties", "score_mean")
    assert round(score[0.0], 1) == 6.0
    assert round(score[0.5], 1) == 6.2
    assert round(score[1.0], 1) == 6.5
    assert round(table("parties", "score_worst")[1.0]) == 17

    position = table("blocs", "position_mean")
    assert round(position[0.0], 2) == 0.56
    assert round(position[0.5], 2) == 0.57
    assert round(position[1.0], 2) == 0.57
    score = table("blocs", "score_mean")
    assert round(score[0.0], 1) == 5.9
    assert round(score[0.25], 1) == 5.9
    assert round(score[0.5], 1) == 5.9
    assert round(score[1.0], 1) == 5.8

    # Depuis l'ajout de 1995 à 2014, la tendance ne fait plus pire sur le score des blocs.
    assert doc["backtest"]["verdict"] == {"trend_worse_position": True, "trend_worse_score": False}
    assert doc["data_end"] == "2024-07"


@needs_data
def test_every_candidate_is_classified_once() -> None:
    config = proj.read_config()
    blocs = {k: set(v["candidates"]) for k, v in config["blocs"].items()}
    unclassified = set(config["unclassified"])
    for path in sorted((ROOT / "data" / "elections").glob("*.json")):
        election = json.loads(path.read_text(encoding="utf-8"))
        for candidate in election["candidates"]:
            homes = [k for k, ids in blocs.items() if candidate["id"] in ids]
            if candidate["id"] in unclassified:
                homes.append("unclassified")
            assert len(homes) == 1, f"{path.name} : {candidate['id']} rangé dans {homes}"


@needs_data
def test_families_name_real_candidates() -> None:
    config = proj.read_config()
    for family in config["families"].values():
        for election, candidate in family["candidates"].items():
            path = ROOT / "data" / "elections" / f"{election}.json"
            ids = {c["id"] for c in json.loads(path.read_text(encoding="utf-8"))["candidates"]}
            assert candidate in ids, f"{election} : {candidate}"


@needs_data
def test_coalitions_belong_to_no_family() -> None:
    config = proj.read_config()
    coalitions = {"front-de-gauche", "nupes", "nfp"}
    for family in config["families"].values():
        assert not coalitions & set(family["candidates"].values())
    assert coalitions <= set(config["blocs"]["gauche"]["candidates"])


@needs_data
def test_families_have_a_point_at_each_of_their_elections() -> None:
    config = proj.read_config()
    for family in config["families"].values():
        for election, candidate in family["candidates"].items():
            path = ROOT / "data" / "computed" / "read_positions" / f"{election}.json"
            ids = {c["id"] for c in json.loads(path.read_text(encoding="utf-8"))["candidates"]}
            assert candidate in ids, f"{election} : {candidate} sans composition"


@needs_data
def test_dates_cover_the_configured_elections_in_order() -> None:
    config = proj.read_config()
    elections = yaml.safe_load((ROOT / "config" / "elections.yaml").read_text(encoding="utf-8"))
    ids = [e["id"] for e in elections["elections"]]
    assert list(config["dates"]) == ids
    assert list(config["dates"].values()) == sorted(config["dates"].values())


@needs_data
def test_written_files_are_current() -> None:
    if not proj.OUT_DIR.exists():
        pytest.skip("projection non générée")
    assert proj.main(["--check"]) == 0
