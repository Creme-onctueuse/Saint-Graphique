"""Méthode ``acm_individus`` : cas vérifiable à la main, invariants, agrégat commité.

Les PCS viennent du jeu FICTIF, mais le tableau croisé est le vrai : ``data/acm_individus.json``.
"""

from __future__ import annotations

import math
from dataclasses import replace

import numpy as np
import pandas as pd
import pytest

from pipeline.methods import METHODS
from pipeline.methods.acm_individus import (
    AGGREGATE_FILE,
    analysis,
    indicator_table,
    load_aggregate,
    load_table,
    modified_rates,
    run_analysis,
    variables_of,
)
from pipeline.methods.mca import orient_axes
from pipeline.model import ROOT, PcsData, load_elections, load_methods_config, load_pcs

FAKE = ROOT / "pipeline" / "tests" / "fixtures" / "fake"
METHOD = METHODS["acm_individus"]

#: Deux variables binaires, de masses égales, et de corrélation 0,6 : λ₁ = 0,8 et λ₂ = 0,2.
#: Coordonnées standard de l'axe 1 : ±1 pour chaque modalité, donc ±1 ou 0 pour un profil.
VARIABLES = {"a": ["a1", "a2"], "b": ["b1", "b2"]}
HAND = pd.DataFrame(
    [
        ("g1", "a1", "b1", 40.0),
        ("g2", "a1", "b2", 10.0),
        ("g3", "a2", "b1", 10.0),
        ("g4", "a2", "b2", 40.0),
    ],
    columns=["groupe", "a", "b", "poids"],
)


@pytest.fixture(scope="module")
def fake() -> PcsData:
    return load_pcs(FAKE / "pcs.json")


def _axis(fit, group: str) -> float:
    """Coordonnée sur l'axe 1, orientée pour que ``g1`` soit du côté positif."""
    sign = math.copysign(1.0, fit.groups["g1"][0])
    return sign * fit.groups[group][0]


# --- Cas vérifiable à la main ------------------------------------------------------------------


def test_acm_hand_checked_eigenvalues_and_inertia() -> None:
    fit = run_analysis(HAND, VARIABLES)
    assert len(fit.eigenvalues) == 2
    assert fit.eigenvalues == pytest.approx([0.8, 0.2])
    assert fit.raw_rates == pytest.approx([80.0, 20.0])
    # Inertie totale d'une ACM : (J - Q) / Q = (4 - 2) / 2.
    assert fit.eigenvalues.sum() == pytest.approx(1.0)


def test_acm_hand_checked_profile_coordinates() -> None:
    fit = run_analysis(HAND, VARIABLES)
    assert _axis(fit, "g1") == pytest.approx(1.0)
    assert _axis(fit, "g2") == pytest.approx(0.0, abs=1e-9)
    assert _axis(fit, "g3") == pytest.approx(0.0, abs=1e-9)
    assert _axis(fit, "g4") == pytest.approx(-1.0)


def test_acm_hand_checked_modalities_and_contributions() -> None:
    fit = run_analysis(HAND, VARIABLES)
    modalities = fit.modalities
    assert modalities["masse"].to_numpy() == pytest.approx([50.0] * 4)
    # Principale = standard × √λ₁, et chaque modalité contribue pour un quart de l'axe.
    assert np.abs(modalities["c1"].to_numpy()) == pytest.approx([math.sqrt(0.8)] * 4)
    assert modalities["ctr1"].to_numpy() == pytest.approx([25.0] * 4)


def test_acm_group_is_the_barycentre_of_its_individuals() -> None:
    """Un groupe à cheval sur deux profils est à mi-chemin, selon les poids de ses individus."""
    table = pd.concat(
        [
            HAND.assign(groupe="fond"),
            pd.DataFrame(
                [("g1", "a1", "b1", 30.0), ("g1", "a1", "b2", 10.0)],
                columns=["groupe", "a", "b", "poids"],
            ),
        ],
        ignore_index=True,
    )
    # Le groupe suivi entre aussi dans les axes : on le compare au calcul direct.
    fit = run_analysis(table, VARIABLES)
    coords = run_analysis(table.assign(groupe=table["a"] + table["b"]), VARIABLES).groups
    expected = (30 * coords["a1b1"][0] + 10 * coords["a1b2"][0]) / 40
    assert fit.groups["g1"][0] == pytest.approx(expected)


def test_acm_incomplete_profile_counts_the_missing_variable_as_neutral() -> None:
    """Un retraité sans ``b`` : (y_a1 + 0) / 2, soit 0,5, là où un profil complet atteint 1."""
    retired = pd.DataFrame(
        [("retraites", "a1", None, 1000.0)], columns=["groupe", "a", "b", "poids"]
    )
    fit = run_analysis(pd.concat([HAND, retired], ignore_index=True), VARIABLES)
    assert _axis(fit, "retraites") == pytest.approx(0.5)


# --- Invariants --------------------------------------------------------------------------------


def test_acm_only_complete_profiles_set_the_axes() -> None:
    base = run_analysis(HAND, VARIABLES)
    retired = pd.DataFrame(
        [("retraites", "a1", None, 1e6)], columns=["groupe", "a", "b", "poids"]
    )
    with_retired = run_analysis(pd.concat([HAND, retired], ignore_index=True), VARIABLES)
    assert with_retired.eigenvalues == pytest.approx(base.eigenvalues)
    for group in ("g1", "g2", "g3", "g4"):
        assert _axis(with_retired, group) == pytest.approx(_axis(base, group), abs=1e-9)


def test_acm_groups_are_not_active_variables() -> None:
    """Répartir autrement les mêmes individus entre groupes ne change pas les axes."""
    base = run_analysis(HAND, VARIABLES)
    other = run_analysis(HAND.assign(groupe=["x", "x", "y", "y"]), VARIABLES)
    assert other.eigenvalues == pytest.approx(base.eigenvalues)
    assert np.abs(other.modalities["c1"].to_numpy()) == pytest.approx(
        np.abs(base.modalities["c1"].to_numpy())
    )


def test_acm_weights_scale_does_not_matter() -> None:
    base = run_analysis(HAND, VARIABLES)
    other = run_analysis(HAND.assign(poids=HAND["poids"] * 1234.5), VARIABLES)
    assert other.eigenvalues == pytest.approx(base.eigenvalues)
    for group in ("g1", "g2", "g3", "g4"):
        assert _axis(other, group) == pytest.approx(_axis(base, group), abs=1e-9)


def test_acm_splitting_a_profile_changes_nothing() -> None:
    """Un profil coupé en deux lignes de mêmes réponses : c'est le même individu pondéré."""
    split = pd.DataFrame(
        [("g1", "a1", "b1", 15.0), ("g1", "a1", "b1", 25.0), ("g2", "a1", "b2", 10.0),
         ("g3", "a2", "b1", 10.0), ("g4", "a2", "b2", 40.0)],
        columns=["groupe", "a", "b", "poids"],
    )
    base = run_analysis(HAND, VARIABLES)
    assert run_analysis(split, VARIABLES).eigenvalues == pytest.approx(base.eigenvalues)


def test_acm_refuses_a_modality_without_active_individuals() -> None:
    with pytest.raises(ValueError, match="a3"):
        run_analysis(HAND, {"a": ["a1", "a2", "a3"], "b": ["b1", "b2"]})


def test_indicator_table_leaves_a_missing_variable_empty() -> None:
    table = indicator_table(
        pd.DataFrame({"a": ["a1", "a2"], "b": ["b2", None]}), VARIABLES
    )
    assert table.to_numpy().tolist() == [[1, 0, 0, 1], [0, 1, 0, 0]]


def test_modified_rates_by_hand() -> None:
    # Q = 2 : (2 × (0,8 - 0,5))² = 0,36 ; 0,2 est sous la moyenne 1/Q et ne compte pas.
    assert modified_rates(np.array([0.8, 0.2]), 2) == pytest.approx([100.0, 0.0])
    assert modified_rates(np.array([0.2, 0.1]), 2).tolist() == [0.0, 0.0]


# --- Sur le vrai tableau croisé ----------------------------------------------------------------


def test_acm_real_table_inertia_and_rates() -> None:
    fit = analysis()
    document = load_aggregate()
    q = len(document["variables"])
    j = sum(len(v["modalities"]) for v in document["variables"].values())
    assert fit.eigenvalues.sum() == pytest.approx((j - q) / q)
    assert fit.raw_rates.sum() == pytest.approx(100.0)
    assert fit.modified_rates.sum() == pytest.approx(100.0)
    assert list(fit.eigenvalues) == sorted(fit.eigenvalues, reverse=True)
    assert fit.modalities[["ctr1", "ctr2"]].sum().to_numpy() == pytest.approx([100.0, 100.0])


def test_acm_active_individuals_are_centred_and_retired_are_not_active() -> None:
    fit = analysis()
    table = load_table(load_aggregate())
    weights = table.groupby("groupe")["poids"].sum()
    active = [code for code in fit.groups if code != "7"]
    for axis in (0, 1):
        mean = sum(weights[c] * fit.groups[c][axis] for c in active) / weights[active].sum()
        assert mean == pytest.approx(0.0, abs=1e-9)
    assert table.loc[table["groupe"] == "7", "emploi"].isna().all()
    assert table.loc[table["groupe"] != "7", "emploi"].notna().all()


def test_acm_map_bounds_and_orientation(fake: PcsData) -> None:
    result = METHOD.compute(fake.items, None, {})
    xs = [p.x for p in result.pcs.values()]
    ys = [p.y for p in result.pcs.values()]
    assert (min(xs), max(xs), min(ys), max(ys)) == (-10, 10, -10, 10)
    assert result.pcs["23"].x > result.population.x
    assert result.groups["3"].y > result.population.y
    for election in load_elections(FAKE / "elections"):
        candidates = METHOD.compute(fake.items, election, {}).candidates
        assert candidates
        assert all(-10 <= c.x <= 10 and -10 <= c.y <= 10 for c in candidates.values())


def test_acm_orientation_does_not_depend_on_the_sign_of_the_axes(fake: PcsData) -> None:
    pcs = fake.items
    weights = np.array([p.population for p in pcs], dtype=float)
    coords = np.array([analysis().groups[p.code] for p in pcs])
    orientation = {"right_pcs": "23", "up_group": "3"}
    a = orient_axes(coords, pcs, weights, orientation, {"bac5": 1})
    b = orient_axes(-coords, pcs, weights, orientation, {"bac5": 1})
    assert a[0] == pytest.approx(b[0])
    assert a[1] == pytest.approx(b[1])


def test_acm_validation(fake: PcsData) -> None:
    unknown = (*fake.items[:-1], replace(fake.items[-1], code="99"))
    with pytest.raises(ValueError, match="99"):
        METHOD.compute(unknown, None, {})
    empty = (*fake.items[:-1], replace(fake.items[-1], population=0.0))
    with pytest.raises(ValueError, match="population"):
        METHOD.compute(empty, None, {})


def test_acm_description_quotes_the_measured_rates() -> None:
    """La description affichée cite les taux : un nouveau calcul doit la mettre à jour."""
    description = load_methods_config()["methods"]["acm_individus"]["description"]
    fit = analysis()
    for value in (fit.raw_rates[0], fit.raw_rates[1], fit.modified_rates[0], fit.modified_rates[1]):
        assert f"{value:.1f}".replace(".", ",") in description
    assert "ni revenu ni patrimoine" in description


def test_acm_file_stays_a_small_aggregate() -> None:
    assert AGGREGATE_FILE.stat().st_size < 200_000
    assert variables_of(load_aggregate()) == {
        "diplome": ["bac5", "bac3", "bac2", "bac", "cap", "brevet", "certif_aucun"],
        "logement": ["proprietaire", "locataire_prive", "hlm", "autre"],
        "emploi": ["employeur", "independant", "stable_complet", "stable_partiel",
                   "duree_limitee", "chomage"],
    }
