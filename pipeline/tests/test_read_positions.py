"""Méthode ``read_positions`` : données lues, barycentres et accord avec les candidats lus."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pipeline.methods import get_method
from pipeline.methods.read_positions import WEIGHT_NOTES, load_positions, read_items
from pipeline.model import Candidate, Election, PcsData

ROOT = Path(__file__).resolve().parents[2]
DIGITIZED = ROOT / "research" / "digitized"
METHOD = get_method("read_positions")
PARAMS = {"merge_groups": {"2": ["1", "2"]}, "range": [-10, 10]}


def election(composition: dict[str, float], level: int = 1) -> Election:
    return Election(
        id="essai",
        type="presidentielle",
        year=2022,
        label="Essai",
        pcs_level=level,
        candidates=(Candidate("a", "A", "#000000"),),
        composition={"a": composition},
    )


def test_positions_are_complete_and_on_the_grid() -> None:
    document = load_positions()
    items = document["items"]
    assert len(items) == 41
    assert len({i["code"] for i in items}) == 41
    for item in items:
        assert item["group"] == item["code"][0]
        assert item["x"] / document["grid"] == int(item["x"] / document["grid"])
        assert item["y"] / document["grid"] == int(item["y"] / document["grid"])


def test_weights_add_up_to_about_100() -> None:
    # Infobulles, recensement et disques sont trois origines : leur somme est un contrôle.
    assert sum(i["weight_pct"] for i in load_positions()["items"]) == pytest.approx(100, abs=3)


def test_retired_people_occupy_six_positions() -> None:
    retired = {(i["x"], i["y"]) for i in load_positions()["items"] if i["group"] == "7"}
    assert len(retired) == 6


def test_every_position_cites_a_video() -> None:
    for item in load_positions()["items"]:
        assert item["video_id"]
        assert item["timestamp_s"] >= 0


def test_every_weight_has_a_provenance_note() -> None:
    notes = METHOD.pcs_notes
    for item in load_positions()["items"]:
        assert notes[item["code"]] == WEIGHT_NOTES[item["weight_status"]]


def test_compute_keeps_the_read_positions() -> None:
    result = METHOD.compute((), None, PARAMS)
    for item in load_positions()["items"]:
        assert result.pcs[item["code"]] == (item["x"], item["y"])
    assert result.candidates == {}


def test_candidate_is_the_barycenter_of_its_groups() -> None:
    result = METHOD.compute((), election({"5": 25.0, "7": 75.0}), PARAMS)
    expected_x = 0.25 * result.groups["5"].x + 0.75 * result.groups["7"].x
    expected_y = 0.25 * result.groups["5"].y + 0.75 * result.groups["7"].y
    assert result.candidates["a"].x == pytest.approx(expected_x)
    assert result.candidates["a"].y == pytest.approx(expected_y)


def test_key_2_covers_farmers_and_self_employed() -> None:
    result = METHOD.compute((), election({"2": 100.0}), PARAMS)
    kept = [p for p in read_items() if p.group in {"1", "2"}]
    total = sum(p.population for p in kept)
    expected = sum(p.population * result.pcs[p.code].x for p in kept) / total
    assert result.candidates["a"].x == pytest.approx(expected)
    assert result.groups["2"].x != pytest.approx(expected)


def test_key_2_is_the_self_employed_alone_when_farmers_are_published() -> None:
    result = METHOD.compute((), election({"1": 10.0, "2": 90.0}), PARAMS)
    expected_x = 0.1 * result.groups["1"].x + 0.9 * result.groups["2"].x
    expected_y = 0.1 * result.groups["1"].y + 0.9 * result.groups["2"].y
    assert result.candidates["a"].x == pytest.approx(expected_x)
    assert result.candidates["a"].y == pytest.approx(expected_y)


def test_level_two_election_is_read_with_the_data_codes() -> None:
    fake = read_items()[:3]  # 11, 12, 13 : groupe 1 dans la nomenclature fournie
    result = METHOD.compute(fake, election({"11": 40.0, "12": 60.0}, level=2), {"merge_groups": {}})
    assert result.candidates["a"].x == pytest.approx(result.groups["1"].x)
    assert result.candidates["a"].y == pytest.approx(result.groups["1"].y)


def test_display_data_replaces_the_points_but_keeps_the_groups() -> None:
    data = PcsData(nomenclature="N", reference_year=2022, items=(), groups={"1": "g"})
    shown = METHOD.display_data(data)
    assert len(shown.items) == 41
    assert shown.groups == {"1": "g"}


@pytest.mark.parametrize(
    ("version", "election_id"),
    [
        ("powerbi_2025_03_27__2022_presidentielle_t1", "2022_presidentielle_t1"),
        ("powerbi_2025_03_27__2024_legislatives_t1", "2024_legislatives_t1"),
        ("powerbi_2025_01_26__2017_presidentielle_t1", "2017_presidentielle_t1"),
        ("powerbi_2025_01_26__2024_europeennes", "2024_europeennes"),
    ],
)
def test_candidates_match_the_chart_within_the_documented_gap(
    version: str, election_id: str
) -> None:
    """Contrôle local : ces relevés ne sont pas versionnés, et n'ont pas servi aux positions."""
    read_file = DIGITIZED / f"{version}.json"
    computed_file = ROOT / "data" / "computed" / "read_positions" / f"{election_id}.json"
    if not read_file.exists() or not computed_file.exists():
        pytest.skip("relevés locaux absents")
    from scripts.analyze.compare import match_candidates, metrics
    from scripts.analyze.threshold_report import THRESHOLD

    document = json.loads(read_file.read_text(encoding="utf-8"))
    computed = json.loads(computed_file.read_text(encoding="utf-8"))
    read = [p for p in document["points"] if p["kind"] == "candidate"]
    pairs, _ = match_candidates(read, computed["candidates"])
    measured = metrics(pairs)
    assert measured["n"] >= 3
    assert measured["rmse_x"] < THRESHOLD
    assert measured["rmse_y"] < THRESHOLD
