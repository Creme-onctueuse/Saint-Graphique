"""Tests des fonctions pures de l'analyse : sans réseau, sans research/, sans OpenCV."""

from __future__ import annotations

from pathlib import Path

import pytest

from scripts.analyze.compare import (
    aggregate_points,
    candidate_key,
    evaluate_hypotheses,
    grid_report,
    match_candidates,
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
