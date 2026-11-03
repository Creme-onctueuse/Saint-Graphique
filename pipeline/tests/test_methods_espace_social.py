"""Méthode ``espace_social`` : cas vérifiable à la main et invariants, sur le jeu FICTIF."""

from __future__ import annotations

import math
from dataclasses import replace

import numpy as np
import pytest

from pipeline.methods import METHODS
from pipeline.methods.espace_social import (
    RETIRED_CODE,
    STUDY_YEARS,
    capital_scores,
    reference_weights,
    weighted_zscores,
)
from pipeline.model import ROOT, Pcs, PcsData, load_elections, load_methods_config, load_pcs

FAKE = ROOT / "pipeline" / "tests" / "fixtures" / "fake"
METHOD = METHODS["espace_social"]
NOTHING = {"bac5": 0.0, "bac3": 0.0, "bac2": 0.0, "bac": 0.0, "cap": 0.0, "brevet": 0.0,
           "certif_aucun": 0.0}


def _pcs(code: str, group: str, population: float, money: float, diploma: str) -> Pcs:
    """PCS dont le patrimoine et le niveau de vie valent e^money, tous diplômés de ``diploma``."""
    return Pcs(
        code=code, group=group, label=code, short=code, population=population,
        niveau_vie_mensuel_eur=math.exp(money), patrimoine_keur=math.exp(money),
        diplomes={**NOTHING, diploma: 100.0},
    )


#: E vaut -1 ou +1 (ln à -1 ou +1), C aussi (score -100 pour le CAP, +500 pour le bac+5).
SQUARE = (
    _pcs("61", "6", 10, -1, "cap"),    # E = -1, C = -1 : peu des deux
    _pcs("34", "3", 10, -1, "bac5"),   # E = -1, C = +1 : surtout culturel
    _pcs("23", "2", 10, +1, "cap"),    # E = +1, C = -1 : surtout économique
    _pcs("31", "3", 10, +1, "bac5"),   # E = +1, C = +1 : beaucoup des deux
)


@pytest.fixture(scope="module")
def fake() -> PcsData:
    return load_pcs(FAKE / "pcs.json")


# --- Cas vérifiable à la main ---------------------------------------------------------------


def test_espace_social_hand_checked_square() -> None:
    """Quatre PCS de même poids, aux quatre coins du plan (E, C)."""
    result = METHOD.compute(SQUARE, None, {})
    expected = {"61": (0, -10), "34": (-10, 0), "23": (10, 0), "31": (0, 10)}
    for code, (x, y) in expected.items():
        assert result.pcs[code].x == pytest.approx(x, abs=1e-12), code
        assert result.pcs[code].y == pytest.approx(y, abs=1e-12), code
    assert result.population.x == pytest.approx(0, abs=1e-12)
    assert result.population.y == pytest.approx(0, abs=1e-12)


def test_espace_social_retired_are_placed_but_stay_out_of_the_scale() -> None:
    """Un point retraité de très grand poids garde ses valeurs, sans déplacer les autres."""
    base = METHOD.compute(SQUARE, None, {})
    retired = _pcs(RETIRED_CODE, RETIRED_CODE, 1e6, -1, "cap")
    result = METHOD.compute((*SQUARE, retired), None, {})
    for code in ("61", "34", "23", "31"):
        assert result.pcs[code].x == pytest.approx(base.pcs[code].x, abs=1e-12)
        assert result.pcs[code].y == pytest.approx(base.pcs[code].y, abs=1e-12)
    # Mêmes valeurs que « 61 », donc même point.
    assert result.pcs[RETIRED_CODE].x == pytest.approx(result.pcs["61"].x, abs=1e-12)
    assert result.pcs[RETIRED_CODE].y == pytest.approx(result.pcs["61"].y, abs=1e-12)
    # Leur poids compte quand même dans le barycentre de la population.
    assert result.population.y == pytest.approx(-10, abs=1e-3)


def test_espace_social_retired_diplomas_are_used_as_they_are() -> None:
    """Aucun score imposé : changer leurs diplômes déplace leur seul point."""
    low = _pcs(RETIRED_CODE, RETIRED_CODE, 100, 0, "brevet")
    high = _pcs(RETIRED_CODE, RETIRED_CODE, 100, 0, "bac")
    a = METHOD.compute((*SQUARE, low), None, {})
    b = METHOD.compute((*SQUARE, high), None, {})
    assert a.pcs[RETIRED_CODE].x > b.pcs[RETIRED_CODE].x  # moins diplômés : plus à droite
    assert a.pcs[RETIRED_CODE].y < b.pcs[RETIRED_CODE].y  # moins diplômés : plus bas
    assert a.pcs["31"].x == pytest.approx(b.pcs["31"].x, abs=1e-12)
    assert a.pcs["31"].y == pytest.approx(b.pcs["31"].y, abs=1e-12)


# --- Standardisation pondérée -----------------------------------------------------------------


def test_weighted_zscores_by_hand() -> None:
    # Moyenne (3·1 + 1·5) / 4 = 2 ; variance (3·1 + 1·9) / 4 = 3.
    z = weighted_zscores([1.0, 5.0], [3.0, 1.0])
    assert z == pytest.approx([-1 / math.sqrt(3), 3 / math.sqrt(3)])


def test_weighted_zscores_mean_zero_variance_one(fake: PcsData) -> None:
    weights = reference_weights(fake.items)
    for score in capital_scores(fake.items, STUDY_YEARS):
        assert np.average(score, weights=weights) == pytest.approx(0, abs=1e-12)
        assert np.average(score**2, weights=weights) == pytest.approx(1, abs=1e-12)


def test_weighted_zscores_zero_weight_is_placed_on_the_scale_of_the_others() -> None:
    z = weighted_zscores([0.0, 2.0, 5.0], [1.0, 1.0, 0.0])
    assert z == pytest.approx([-1.0, 1.0, 4.0])


def test_weighted_zscores_degenerate_inputs() -> None:
    assert weighted_zscores([3.0, 3.0], [1.0, 2.0]).tolist() == [0.0, 0.0]
    with pytest.raises(ValueError, match="poids total nul"):
        weighted_zscores([1.0, 2.0], [0.0, 0.0])
    with pytest.raises(ValueError, match="non finies"):
        weighted_zscores([1.0, float("nan")], [1.0, 1.0])


# --- Invariants --------------------------------------------------------------------------------


def test_espace_social_bounds_on_both_axes(fake: PcsData) -> None:
    result = METHOD.compute(fake.items, None, {})
    xs = [p.x for p in result.pcs.values()]
    ys = [p.y for p in result.pcs.values()]
    assert (min(xs), max(xs), min(ys), max(ys)) == (-10, 10, -10, 10)
    assert all(-10 <= g.x <= 10 and -10 <= g.y <= 10 for g in result.groups.values())


def test_espace_social_candidates_stay_inside_the_map(fake: PcsData) -> None:
    for election in load_elections(FAKE / "elections"):
        result = METHOD.compute(fake.items, election, {})
        assert result.candidates
        assert all(-10 <= c.x <= 10 and -10 <= c.y <= 10 for c in result.candidates.values())


def test_espace_social_ignores_units_and_population_scale(fake: PcsData) -> None:
    """Logarithme puis z-score : une unité monétaire ou un effectif différents ne changent rien."""
    base = METHOD.compute(fake.items, None, {})
    scaled = tuple(
        replace(p, population=p.population * 7, patrimoine_keur=p.patrimoine_keur * 1000,
                niveau_vie_mensuel_eur=p.niveau_vie_mensuel_eur * 12)
        for p in fake.items
    )
    other = METHOD.compute(scaled, None, {})
    for code, point in base.pcs.items():
        assert other.pcs[code].x == pytest.approx(point.x, abs=1e-9)
        assert other.pcs[code].y == pytest.approx(point.y, abs=1e-9)


def test_espace_social_only_the_gaps_between_weights_matter(fake: PcsData) -> None:
    """Les parts somment à 100 : ajouter une constante aux poids ne déplace aucun point."""
    base = METHOD.compute(fake.items, None, {})
    shifted = {key: value + 4 for key, value in STUDY_YEARS.items()}
    other = METHOD.compute(fake.items, None, {"y_weights": shifted})
    for code, point in base.pcs.items():
        assert other.pcs[code].x == pytest.approx(point.x, abs=1e-9)
        assert other.pcs[code].y == pytest.approx(point.y, abs=1e-9)


def test_espace_social_more_money_moves_up_and_right(fake: PcsData) -> None:
    richer = tuple(
        replace(p, patrimoine_keur=p.patrimoine_keur * 1.5) if p.code == "47" else p
        for p in fake.items
    )
    # À échelle commune : les scores bruts, avant la mise à l'échelle min/max.
    e0, c0 = capital_scores(fake.items, STUDY_YEARS)
    e1, c1 = capital_scores(richer, STUDY_YEARS)
    i = [p.code for p in fake.items].index("47")
    assert e1[i] > e0[i]
    assert c1[i] == pytest.approx(c0[i])


def test_espace_social_rejects_what_a_logarithm_cannot_take(fake: PcsData) -> None:
    broke = tuple(replace(p, patrimoine_keur=0.0) if p.code == "47" else p for p in fake.items)
    with pytest.raises(ValueError, match="PCS 47"):
        METHOD.compute(broke, None, {})
    with pytest.raises(ValueError, match="diplômes inconnus"):
        METHOD.compute(fake.items, None, {"y_weights": {"doctorat": 8}})


def test_espace_social_weights_are_those_of_the_configuration() -> None:
    declared = load_methods_config()["methods"]["espace_social"]
    assert declared["y_weights"] == STUDY_YEARS
    assert declared["axes"]["x"]["label"] == "Structure du capital"
    assert declared["axes"]["y"]["label"] == "Volume du capital"
