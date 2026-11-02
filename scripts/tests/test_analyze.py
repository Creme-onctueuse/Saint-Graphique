"""Tests des fonctions pures de l'analyse : sans réseau, sans research/, sans OpenCV."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from scripts.analyze import build_positions, methods_report, overlay, threshold_report
from scripts.analyze.check_barycenter import (
    collect_group_positions,
    composition_vector,
    linear_check,
    rows_from_election,
)
from scripts.analyze.compare import (
    aggregate_points,
    candidate_key,
    evaluate_hypotheses,
    grid_report,
    match_candidates,
    match_groups,
    match_pcs,
    metrics,
)
from scripts.analyze.digitize import build_document, resolve_point, snap_to_discs
from scripts.analyze.pure import (
    average_ranks,
    best_label_match,
    calibrate_axis,
    cluster_by_hash,
    fit_axis,
    fit_barycenter_coordinates,
    hamming_hex,
    medoid,
    normalize_label,
    pearson,
    rmse,
    spearman,
    to_ranks_scale,
    weighted_mean,
)
from scripts.analyze.summarize_compare import summary_rows
from scripts.analyze.x_variants import (
    agreement,
    candidate_x,
    group_axis,
    rank_axis,
    read_candidate_pairs,
    within_groups,
)


def test_hamming() -> None:
    assert hamming_hex("00", "ff") == 8
    assert hamming_hex("0f", "0f") == 0
    with pytest.raises(ValueError):
        hamming_hex("00", "000")


def test_cluster_links_close_hashes_only_within_dates() -> None:
    items = [
        {"phash": "0000000000000000", "upload_date": "20250101"},
        {"phash": "0000000000000001", "upload_date": "20250102"},
        {"phash": "ffffffffffffffff", "upload_date": "20250103"},
        {"phash": "0000000000000003", "upload_date": "20260101"},
    ]
    assert cluster_by_hash(items, max_distance=2, max_days=30) == [[0, 1], [2], [3]]
    assert cluster_by_hash(items, max_distance=2) == [[0, 1, 3], [2]]


def test_medoid_picks_central_hash() -> None:
    assert medoid(["00", "01", "03"]) == 1


def test_calibrate_axis_two_marks() -> None:
    cal = calibrate_axis(100, -10, 300, 10)
    assert cal.to_value(200) == pytest.approx(0)
    assert cal.to_value(100) == pytest.approx(-10)
    assert cal.to_pixel(10) == pytest.approx(300)


def test_calibrate_axis_inverted_pixels() -> None:
    cal = calibrate_axis(909, -10, 136, 10)
    assert cal.to_value(522) == pytest.approx(0, abs=0.02)


@pytest.mark.parametrize("marks", [(5, 1, 5, 2), (1, 5, 2, 5)])
def test_calibrate_axis_rejects_degenerate(marks: tuple[int, int, int, int]) -> None:
    with pytest.raises(ValueError):
        calibrate_axis(*marks)


def test_fit_axis_reports_residual() -> None:
    cal, residual = fit_axis([(0, 0), (10, 1), (20, 2)])
    assert cal.a == pytest.approx(0.1)
    assert residual == pytest.approx(0)
    _, bad = fit_axis([(0, 0), (10, 2), (20, 2)])
    assert bad > 0.1
    with pytest.raises(ValueError):
        fit_axis([(0, 0)])


def test_normalize_label() -> None:
    assert normalize_label("Employés  civils, d'entreprise") == "employes civils d entreprise"


def test_best_label_match_exact_fuzzy_ambiguous() -> None:
    options = {"38": ["Ingénieurs et cadres techniques"], "37": ["Cadres administratifs"]}
    assert best_label_match("ingenieurs et cadres techniques", options) == ("38", 1.0)
    fuzzy = best_label_match("Ingénieurs et cadres techniques d'entreprise", options)
    assert fuzzy is not None and fuzzy[0] == "38"
    assert best_label_match("Chauffeurs", options) is None
    assert best_label_match("cadres", {"a": ["cadres alpha"], "b": ["cadres beta"]}) is None


def test_rmse() -> None:
    assert rmse([0, 0], [3, 4]) == pytest.approx((12.5) ** 0.5)
    with pytest.raises(ValueError):
        rmse([1], [1, 2])
    with pytest.raises(ValueError):
        rmse([], [])


def test_average_ranks_ties() -> None:
    assert average_ranks([10, 20, 20, 30]) == [1, 2.5, 2.5, 4]


def test_correlations() -> None:
    assert pearson([1, 2, 3], [2, 4, 6]) == pytest.approx(1)
    assert pearson([1, 1, 1], [1, 2, 3]) is None
    assert spearman([1, 2, 3, 4], [1, 4, 9, 16]) == pytest.approx(1)
    assert spearman([1, 2, 3], [3, 2, 1]) == pytest.approx(-1)


def test_to_ranks_scale() -> None:
    assert to_ranks_scale([5, 1, 9]) == [0, -10, 10]
    with pytest.raises(ValueError):
        to_ranks_scale([1])


def test_weighted_mean() -> None:
    assert weighted_mean([0, 10], [1, 3]) == pytest.approx(7.5)
    with pytest.raises(ValueError):
        weighted_mean([1], [0])


def test_fit_barycenter_coordinates_recovers_positions() -> None:
    truth = [-5.0, 0.0, 5.0]
    weights = [[50, 50, 0], [0, 50, 50], [25, 50, 25], [100, 0, 0], [0, 0, 100]]
    observed = [sum(w * t for w, t in zip(row, truth, strict=True)) / 100 for row in weights]
    fitted, residual = fit_barycenter_coordinates(weights, observed)
    assert fitted == pytest.approx(truth)
    assert residual == pytest.approx(0, abs=1e-9)


def test_match_pcs_by_code_then_label() -> None:
    computed = [
        {"code": "23", "label": "Chefs d'entreprise de 10 salariés ou plus", "x": 1, "y": 1},
        {
            "code": "38",
            "label": "Ingénieurs et cadres techniques",
            "short": "Ingénieurs",
            "x": 2,
            "y": 2,
        },
    ]
    read = [
        {"code": "23", "label": "Chefs", "x": 0, "y": 0},
        {"label": "Ingénieurs", "x": 0, "y": 0},
        {"label": "Inconnus du bataillon", "x": 0, "y": 0},
    ]
    pairs, missing = match_pcs(read, computed)
    assert [b["code"] for _, b in pairs] == ["23", "38"]
    assert missing == ["Inconnus du bataillon"]


def test_aggregate_points_uses_weights() -> None:
    merged = aggregate_points(
        [
            {"code": "71", "label": "a", "x": 0, "y": 0, "weight": 1},
            {"code": "78", "label": "b", "x": 4, "y": 8, "weight": 3},
            {"code": "21", "label": "c", "x": 9, "y": 9},
        ]
    )
    retired = next(p for p in merged if p["code"] == "7")
    assert retired["x"] == pytest.approx(3)
    assert retired["y"] == pytest.approx(6)
    assert any(p["code"] == "21" for p in merged)


def test_candidate_matching() -> None:
    assert candidate_key("E. Macron") == "macron"
    assert candidate_key("Marine Le Pen") == "le pen"
    pairs, missing = match_candidates(
        [{"label": "M. Le Pen", "x": 0, "y": 0}, {"label": "J. Personne", "x": 0, "y": 0}],
        [{"id": "lepen", "label": "Marine Le Pen", "x": 1, "y": 1}],
    )
    assert len(pairs) == 1
    assert missing == ["J. Personne"]


def test_candidate_key_ignores_parenthesis() -> None:
    assert candidate_key("Le Pen (M)") == "le pen"


def test_match_groups_merges_codes_by_weight() -> None:
    groups = [
        {"code": "1", "x": 0.0, "y": 0.0, "weight": 1.0},
        {"code": "2", "x": 4.0, "y": 8.0, "weight": 3.0},
        {"code": "3", "x": 1.0, "y": 1.0, "weight": 5.0},
    ]
    pairs, missing = match_groups(
        [
            {"label": "indep", "code": "1+2", "x": 0, "y": 0},
            {"label": "cadres", "code": "3", "x": 0, "y": 0},
            {"label": "inconnu", "code": "9", "x": 0, "y": 0},
        ],
        groups,
    )
    assert pairs[0][1]["x"] == pytest.approx(3)
    assert pairs[0][1]["y"] == pytest.approx(6)
    assert pairs[1][1]["x"] == 1
    assert missing == ["inconnu"]


def test_group_level_hypotheses_average_by_population() -> None:
    items = [
        {
            "code": "10",
            "group": "1",
            "population": 1,
            "patrimoine_keur": 10,
            "niveau_vie_mensuel_eur": 10,
        },
        {
            "code": "21",
            "group": "2",
            "population": 3,
            "patrimoine_keur": 50,
            "niveau_vie_mensuel_eur": 10,
        },
        {
            "code": "33",
            "group": "3",
            "population": 1,
            "patrimoine_keur": 1,
            "niveau_vie_mensuel_eur": 10,
        },
        {
            "code": "42",
            "group": "4",
            "population": 1,
            "patrimoine_keur": 100,
            "niveau_vie_mensuel_eur": 10,
        },
    ]
    read = [
        {"code": "1+2", "label": "a", "x": 2, "y": 0},
        {"code": "3", "label": "b", "x": 1, "y": 0},
        {"code": "4", "label": "c", "x": 3, "y": 1},
    ]
    rows = {r["variable"]: r for r in evaluate_hypotheses(read, items, level="group")}
    assert rows["patrimoine médian"]["n"] == 3
    assert rows["patrimoine médian"]["spearman_x"] == pytest.approx(1)


def test_match_candidates_prefers_explicit_code() -> None:
    pairs, _ = match_candidates(
        [{"label": "Jordan Bardella", "code": "rn", "x": 0, "y": 0}],
        [{"id": "rn", "label": "Rassemblement national (J. Bardella)", "x": 1, "y": 2}],
    )
    assert pairs[0][1]["id"] == "rn"


def test_linear_barycenter_check() -> None:
    positions = collect_group_positions(
        [
            {
                "points": [
                    {"level": "group", "code": "3", "x": 4.0, "y": 6.0},
                    {"level": "group", "code": "1+2", "x": 2.0, "y": -2.0},
                    {"level": "group", "code": "6", "x": -2.0, "y": -6.0},
                    {"code": "9", "x": 0, "y": 0},
                ]
            }
        ]
    )
    assert set(positions) == {"3", "1+2", "6"}
    codes = ["1+2", "3", "6"]
    assert composition_vector({"1": 1, "2": 2, "3": 5}, codes) == [3, 5, 0]
    election = {
        "candidates": [
            {"id": "a", "label": "Alice Martin"},
            {"id": "b", "label": "Bob Durand"},
            {"id": "c", "label": "Carla Petit"},
            {"id": "d", "label": "Dan Roux"},
        ],
        "composition": {
            "a": {"1": 25, "2": 25, "3": 50},
            "b": {"3": 100},
            "c": {"6": 100},
            "d": {"1": 50, "6": 50},
        },
    }
    document = {
        "points": [
            {"kind": "candidate", "label": "A. Martin", "x": 3.0, "y": 2.0},
            {"kind": "candidate", "label": "B. Durand", "x": 4.0, "y": 6.0},
            {"kind": "candidate", "label": "C. Petit", "x": -2.0, "y": -6.0},
            {"kind": "candidate", "label": "D. Roux", "x": 0.0, "y": -4.0},
            {"kind": "candidate", "label": "E. Absent", "x": 0.0, "y": 0.0},
        ]
    }
    rows, missing = rows_from_election(document, election, codes)
    assert missing == ["E. Absent"]
    report = linear_check(rows, positions, codes)
    assert report["n"] == 4
    assert report["rmse_y_linear"] == 0
    assert report["rmse_x_linear"] == 0
    assert report["free_fit_max_residual_x"] == pytest.approx(0, abs=1e-6)
    assert linear_check([], positions, codes) == {"n": 0}


def test_summary_rows_skip_empty_blocks() -> None:
    report = {
        "version_id": "v",
        "computed": "data/computed/ranks/population.json",
        "pcs": {"n": 2, "rmse_x": 1, "rmse_y": 2, "spearman_x": 0.5, "spearman_y": 0.6},
        "candidates": {"n": 0},
    }
    rows = summary_rows([report])
    assert len(rows) == 1
    assert rows[0]["method"] == "ranks"
    assert rows[0]["election"] == "population"


def test_x_variant_pipeline_is_a_rank_then_barycenter() -> None:
    items = [
        {
            "code": "a",
            "group": "1",
            "population": 1,
            "patrimoine_keur": 10,
            "niveau_vie_mensuel_eur": 10,
        },
        {
            "code": "b",
            "group": "1",
            "population": 3,
            "patrimoine_keur": 20,
            "niveau_vie_mensuel_eur": 10,
        },
        {
            "code": "c",
            "group": "2",
            "population": 1,
            "patrimoine_keur": 30,
            "niveau_vie_mensuel_eur": 10,
        },
    ]
    axis = rank_axis(items, "patrimoine médian")
    assert axis == {"a": -10, "b": 0, "c": 10}
    groups = group_axis(items, axis)
    assert groups["1"] == pytest.approx(-2.5)
    assert rank_axis(items, "part de l'immobilier") is None
    election = {
        "candidates": [{"id": "x", "label": "Xavier Lebrun"}, {"id": "y", "label": "Yves Noir"}],
        "composition": {"x": {"1": 50, "2": 50}, "y": {"2": 100}},
    }
    predicted = candidate_x(election, groups)
    assert predicted["x"] == pytest.approx(3.75)
    document = {
        "points": [
            {"kind": "candidate", "label": "X. Lebrun", "x": 4.0, "y": 0},
            {"kind": "candidate", "label": "Autre", "code": "y", "x": 9.0, "y": 0},
            {"kind": "pcs", "label": "ignoré", "x": 0, "y": 0},
        ]
    }
    pairs = read_candidate_pairs(document, election, predicted)
    assert pairs == [(4.0, predicted["x"]), (9.0, 10.0)]
    assert agreement(pairs)["n"] == 2
    assert agreement([]) == {"n": 0}


def test_within_groups_skips_small_groups() -> None:
    items = [{"code": c, "group": g} for c, g in [("a", "1"), ("b", "1"), ("c", "1"), ("d", "2")]]
    axis = {"a": 1.0, "b": 2.0, "c": 3.0, "d": 4.0}
    points = [
        {"code": "a", "x": 3.0},
        {"code": "b", "x": 2.0},
        {"code": "c", "x": 1.0},
        {"code": "d", "x": 0.0},
    ]
    result = within_groups(points, items, axis)
    assert result == {"1": {"n": 3, "spearman": -1.0}}


def test_metrics_lists_largest_gap_first() -> None:
    pairs = [
        ({"label": "a", "x": 0, "y": 0}, {"code": "1", "x": 0, "y": 0}),
        ({"label": "b", "x": 1, "y": 1}, {"code": "2", "x": 4, "y": 1}),
        ({"label": "c", "x": 2, "y": 2}, {"code": "3", "x": 2, "y": 3}),
    ]
    result = metrics(pairs)
    assert result["n"] == 3
    assert result["largest_gaps"][0]["label"] == "b"
    assert result["largest_gaps"][0]["dx"] == 3
    assert metrics([]) == {"n": 0}


def test_grid_report() -> None:
    report = grid_report([0.5, 1.0, 0.7, -8.5])
    assert report["on_grid"] == 3
    assert report["share"] == 0.75
    assert grid_report([]) == {"n": 0}


def test_hypotheses_correlate_on_common_codes() -> None:
    read = [
        {"code": "1", "label": "a", "x": 1, "y": 3},
        {"code": "2", "label": "b", "x": 2, "y": 2},
        {"code": "3", "label": "c", "x": 3, "y": 1},
    ]
    items = [
        {"code": "1", "patrimoine_keur": 10, "niveau_vie_mensuel_eur": 10},
        {"code": "2", "patrimoine_keur": 40, "niveau_vie_mensuel_eur": 20},
        {"code": "3", "patrimoine_keur": 90, "niveau_vie_mensuel_eur": 30},
    ]
    results = {row["variable"]: row for row in evaluate_hypotheses(read, items)}
    assert results["ratio patrimoine / niveau de vie"]["spearman_x"] == pytest.approx(1)
    assert results["ratio patrimoine / niveau de vie"]["spearman_y"] == pytest.approx(-1)
    assert results["part de l'immobilier"]["n"] == 0


def test_resolve_point_prefers_read_values_over_pixels() -> None:
    x_cal = calibrate_axis(0, 0, 10, 1)
    y_cal = calibrate_axis(0, 0, 10, 1)
    tooltip = resolve_point({"label": "a", "x": 1.5, "y": 2, "px": 99, "py": 99}, x_cal, y_cal)
    assert tooltip["x"] == 1.5
    assert tooltip["method"] == "tooltip"
    pixel = resolve_point({"label": "b", "px": 50, "py": 20, "confidence": 0.4}, x_cal, y_cal)
    assert pixel["x"] == 5
    assert pixel["y"] == 2
    assert pixel["method"] == "pixel"
    assert pixel["confidence"] == 0.4


def test_resolve_point_without_calibration_fails_on_pixels() -> None:
    with pytest.raises(ValueError):
        resolve_point({"label": "a", "px": 1, "py": 1}, None, None)


def test_snap_to_discs() -> None:
    discs = [{"px": 100.0, "py": 100.0, "r": 5.0}, {"px": 200.0, "py": 200.0, "r": 5.0}]
    snapped = snap_to_discs({"label": "a", "px": 102, "py": 99}, discs)
    assert (snapped["px"], snapped["py"]) == (100.0, 100.0)
    assert snapped["method"] == "pixel_detected"
    far = snap_to_discs({"label": "b", "px": 150, "py": 150}, discs)
    assert far["px"] == 150
    assert far["method"] == "pixel_manual"
    read = snap_to_discs({"label": "c", "x": 1, "y": 2}, discs)
    assert "method" not in read


def test_build_document_named_calibrations_keep_provenance() -> None:
    document = build_document(
        {
            "version_id": "v",
            "date": "2026-09-16",
            "source": {"video_id": "abc", "timestamp_s": 10, "capture": "a.png"},
            "calibrations": {
                "zoom": {
                    "x": [{"pixel": 0, "value": 0}, {"pixel": 10, "value": 1}],
                    "y": [{"pixel": 10, "value": 0}, {"pixel": 0, "value": 1}],
                    "timestamp_s": 20,
                    "capture": "b.png",
                }
            },
            "points": [
                {"label": "lu", "x": 1.0, "y": 2.0, "timestamp_s": 30},
                {"label": "zoom", "px": 5, "py": 5, "calibration": "zoom"},
            ],
        }
    )
    read, zoomed = document["points"]
    assert read["timestamp_s"] == 30
    assert read["capture"] == "a.png"
    assert zoomed["x"] == pytest.approx(0.5)
    assert zoomed["timestamp_s"] == 20
    assert zoomed["capture"] == "b.png"
    assert document["calibrations"]["zoom"]["x_max_residual"] == 0


def test_build_document_matches_schema_shape() -> None:
    document = build_document(
        {
            "version_id": "v",
            "date": "2025-03-27",
            "source": {"video_id": "abc", "timestamp_s": 1},
            "axes": {"x_label": "X", "y_label": "Y", "range": [-10, 10]},
            "calibration": {
                "x": [{"pixel": 0, "value": 0}, {"pixel": 10, "value": 10}],
                "y": [{"pixel": 10, "value": 0}, {"pixel": 0, "value": 10}],
            },
            "points": [{"label": "a", "code": 23, "px": 5, "py": 5}],
        }
    )
    assert document["points"][0]["code"] == "23"
    assert document["points"][0]["x"] == 5
    assert document["calibration"]["x_max_residual"] == 0


def test_detect_discs_on_synthetic_image(tmp_path: Path) -> None:
    cv2 = pytest.importorskip("cv2")
    np = pytest.importorskip("numpy")
    from scripts.analyze.digitize import detect_discs

    image = np.full((200, 300, 3), 255, dtype=np.uint8)
    cv2.circle(image, (60, 50), 12, (160, 60, 30), -1)
    cv2.circle(image, (220, 140), 20, (40, 40, 40), -1)
    path = tmp_path / "synthetique.png"
    cv2.imwrite(str(path), image)
    discs = detect_discs(path, (0, 0, 300, 200))
    assert any(abs(d["px"] - 60) < 2 and abs(d["py"] - 50) < 2 for d in discs)
    assert any(abs(d["px"] - 220) < 2 and abs(d["py"] - 140) < 2 for d in discs)


# --- build_positions -------------------------------------------------------------------


def test_snap_goes_to_the_half_unit_grid() -> None:
    assert build_positions.snap(-2.97) == -3.0
    assert build_positions.snap(5.49) == 5.5


def test_retained_position_uses_the_median_of_agreeing_readings() -> None:
    position = build_positions.retained_position([(1.02, -3.01), (0.98, -2.99), (1.0, -3.0)])
    assert position == (1.0, -3.0, 3)


def test_retained_position_keeps_only_the_last_revision() -> None:
    readings = [(-8.01, -9.0), (-7.99, -8.98), (-7.52, -7.0)]
    assert build_positions.retained_position(readings) == (-7.5, -7.0, 1)


def test_retained_position_needs_a_reading() -> None:
    with pytest.raises(ValueError, match="aucune lecture"):
        build_positions.retained_position([])


def test_linear_scale_reads_an_axis() -> None:
    slope, intercept = build_positions.linear_scale(
        [{"pixel": 100, "value": -10}, {"pixel": 200, "value": 0}, {"pixel": 300, "value": 10}]
    )
    assert slope * 250 + intercept == pytest.approx(5)


def test_match_radii_ignores_distant_discs() -> None:
    calibration = {
        "x_marks": [{"pixel": 0, "value": 0}, {"pixel": 100, "value": 10}],
        "y_marks": [{"pixel": 0, "value": 0}, {"pixel": 100, "value": 10}],
    }
    radii = build_positions.match_radii(
        {"a": (5.0, 5.0), "b": (1.0, 1.0)}, [{"px": 50.5, "py": 50, "r": 7}], calibration
    )
    assert radii == {"a": 7.0}


def test_choose_weights_prefers_tooltips_then_census_then_discs() -> None:
    weights = build_positions.choose_weights(
        ["a", "b", "c"],
        tooltips={"a": 2.0},
        census_shares={"a": 4.0, "b": 10.0},
        radii={"a": 10.0, "c": 20.0},
    )
    assert weights == {"a": (2.0, "read"), "b": (5.0, "census"), "c": (8.0, "disc")}


def test_choose_weights_refuses_an_unknown_weight() -> None:
    with pytest.raises(ValueError, match="aucun poids"):
        build_positions.choose_weights(
            ["z"], tooltips={"a": 1.0}, census_shares={"a": 1.0}, radii={"a": 1.0}
        )


# --- threshold_report et overlay -------------------------------------------------------


def test_pooled_gaps_meets_the_threshold_on_both_axes_only() -> None:
    near = ({"x": 1.0, "y": 1.0}, {"x": 1.1, "y": 0.9})
    far_on_y = ({"x": 1.0, "y": 1.0}, {"x": 1.1, "y": 2.0})
    assert threshold_report.pooled_gaps([near])["meets"] is True
    assert threshold_report.pooled_gaps([far_on_y])["meets"] is False


def test_pooled_gaps_without_pairs_does_not_pass() -> None:
    assert threshold_report.pooled_gaps([]) == {
        "n": 0,
        "rmse_x": None,
        "rmse_y": None,
        "meets": False,
    }


def test_threshold_is_half_a_grid_step() -> None:
    assert threshold_report.THRESHOLD == build_positions.GRID / 2


def test_overlay_converts_values_to_pixels() -> None:
    to_pixel = overlay.value_to_pixel([{"pixel": 100, "value": -10}, {"pixel": 300, "value": 10}])
    assert to_pixel(0) == pytest.approx(200)


def test_overlay_radius_grows_with_the_square_root_of_the_weight() -> None:
    assert overlay.disc_radius(4.0, area_factor=1.0) == 2 * overlay.disc_radius(
        1.0, area_factor=1.0
    )


# --- Mesures des méthodes espace_social et acm_individus ---------------------------------------


def test_weighted_skewness_by_hand() -> None:
    # Valeurs symétriques : 0. Puis 0 et 3 de poids 2 et 1 : moyenne 1, variance 2, moment 2.
    assert methods_report.weighted_skewness(np.array([1.0, 2.0, 3.0]), np.ones(3)) == 0
    skew = methods_report.weighted_skewness(np.array([0.0, 3.0]), np.array([2.0, 1.0]))
    assert skew == pytest.approx(2 / 2**1.5)


def test_weighted_correlation_by_hand() -> None:
    a = np.array([1.0, 2.0, 3.0])
    assert methods_report.weighted_correlation(a, 2 * a + 1, np.ones(3)) == pytest.approx(1)
    weights = np.array([1.0, 5.0, 1.0])
    assert methods_report.weighted_correlation(a, -a, weights) == pytest.approx(-1)


def test_methods_report_runs_on_the_committed_data(capsys: pytest.CaptureFixture[str]) -> None:
    assert methods_report.main() == 0
    out = capsys.readouterr().out
    assert "espace_social" in out and "acm_individus" in out
    assert "taux modifiés" in out and "variante écartée" in out
