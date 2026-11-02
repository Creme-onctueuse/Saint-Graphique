"""Méthodes de placement : registre, formules et invariants, sur le jeu FICTIF (CI publique).

Le jeu ``pipeline/tests/fixtures/fake/`` est produit par ``scripts/fake_data.py``.
L'exactitude par rapport à la reproduction de référence est testée localement par
``test_methods_reference.py``.
"""

from __future__ import annotations

import math
from dataclasses import replace

import numpy as np
import pytest

from pipeline.methods import METHODS, Method, assemble_result, get_method, register
from pipeline.methods.mca import indicator_table, quantile_bins
from pipeline.methods.scores import minmax_coordinates, rank_coordinates, x_scores, y_scores
from pipeline.model import (
    POPULATION_ID,
    ROOT,
    Candidate,
    Election,
    PcsData,
    Result,
    load_elections,
    load_pcs,
)

FAKE = ROOT / "pipeline" / "tests" / "fixtures" / "fake"
ALL_METHODS = ("ranks_jnthnbs", "continuous", "mca")
PRES = "2099_presidentielle_t1"
EURO = "2099_europeennes"
TOL = 1e-12


@pytest.fixture(scope="module")
def pcs_data() -> PcsData:
    return load_pcs(FAKE / "pcs.json")


@pytest.fixture(scope="module")
def elections() -> dict[str, Election]:
    return {e.id: e for e in load_elections(FAKE / "elections")}


@pytest.fixture(scope="module")
def results(pcs_data: PcsData, elections: dict[str, Election]) -> dict[tuple[str, str], Result]:
    """Résultat (paramètres par défaut) de chaque méthode, par élection et pour la population."""
    out = {}
    for name in ALL_METHODS:
        for election in [None, *elections.values()]:
            result = METHODS[name].compute(pcs_data.items, election, {})
            out[(name, result.election_id)] = result
    return out


def _single(election: Election, composition: dict[str, float], level: int = 1) -> Election:
    """Élection à un seul candidat, de composition donnée."""
    return replace(
        election,
        pcs_level=level,
        candidates=(Candidate("solo", "Solo", "#123456"),),
        composition={"solo": composition},
    )


def _weighted(points: list[tuple[float, float, float]]) -> tuple[float, float]:
    """Barycentre de (poids, x, y), calcul indépendant (sommes exactes)."""
    total = math.fsum(w for w, _, _ in points)
    return (math.fsum(w * x for w, x, _ in points) / total,
            math.fsum(w * y for w, _, y in points) / total)


# --- Registre --------------------------------------------------------------------------------


def test_methods_registry_contains_all_methods() -> None:
    assert set(ALL_METHODS) <= set(METHODS)
    for name in ALL_METHODS:
        method = get_method(name)
        assert isinstance(method, Method)
        assert method.name == name and method.label
    assert METHODS["ranks_jnthnbs"].bootstrap and METHODS["continuous"].bootstrap
    assert not METHODS["mca"].bootstrap


def test_methods_get_unknown_method_lists_available() -> None:
    with pytest.raises(KeyError, match="disponibles"):
        get_method("inexistante")


def test_methods_register_new_method_without_touching_the_rest(pcs_data: PcsData) -> None:
    @register
    class Diagonale:
        name = "test_diagonale"
        label = "Diagonale (test)"
        bootstrap = False

        def compute(self, pcs, election, params):
            xs = np.linspace(-10, 10, len(pcs))
            return assemble_result(self.name, params, pcs, xs, xs, election)

    try:
        result = get_method("test_diagonale").compute(pcs_data.items, None, {})
        assert result.method == "test_diagonale"
        assert result.election_id == POPULATION_ID
        assert all(p.x == p.y for p in result.pcs.values())
    finally:
        METHODS.pop("test_diagonale", None)


def test_methods_register_rejects_duplicates_and_non_methods() -> None:
    class Imposteur:
        name = "ranks_jnthnbs"
        label = "Imposteur"
        bootstrap = False

        def compute(self, pcs, election, params): ...

    class Incomplete:
        name = "incomplete"

    with pytest.raises(ValueError, match="déjà enregistrée"):
        register(Imposteur)
    with pytest.raises(TypeError):
        register(Incomplete)
    assert type(METHODS["ranks_jnthnbs"]).__name__ == "RanksJnthnbs"
    assert "incomplete" not in METHODS


# --- Invariants communs ----------------------------------------------------------------------


@pytest.mark.parametrize("name", ALL_METHODS)
def test_methods_coordinates_within_bounds(name: str, results: dict) -> None:
    for (method, _), result in results.items():
        if method != name:
            continue
        points = [*result.pcs.values(), *result.groups.values(), *result.candidates.values(),
                  result.population]
        for p in points:
            assert math.isfinite(p.x) and math.isfinite(p.y)
            assert -10 - TOL <= p.x <= 10 + TOL and -10 - TOL <= p.y <= 10 + TOL


@pytest.mark.parametrize("name", ALL_METHODS)
def test_methods_barycenters(name: str, results: dict, pcs_data: PcsData,
                             elections: dict[str, Election]) -> None:
    """Groupes et population pondérés par la population ; candidats par leur composition."""
    result = results[(name, PRES)]
    items = pcs_data.items
    for code, point in result.groups.items():
        expected = _weighted([(p.population, *result.pcs[p.code]) for p in items
                              if p.group == code])
        assert point == pytest.approx(expected, abs=TOL)
    expected = _weighted([(p.population, *result.pcs[p.code]) for p in items])
    assert result.population == pytest.approx(expected, abs=TOL)
    election = elections[PRES]
    for c in election.candidates:
        shares = election.composition[c.id]
        expected = _weighted([(s, *result.groups[g]) for g, s in shares.items() if s > 0])
        assert result.candidates[c.id] == pytest.approx(expected, abs=TOL)


@pytest.mark.parametrize("name", ALL_METHODS)
def test_methods_population_only_has_no_candidates(name: str, results: dict) -> None:
    result = results[(name, POPULATION_ID)]
    assert result.election_id == POPULATION_ID and result.candidates == {}
    assert result.pcs == results[(name, PRES)].pcs


@pytest.mark.parametrize("name", ALL_METHODS)
def test_methods_are_deterministic_and_independent_of_input_order(
    name: str, pcs_data: PcsData, elections: dict[str, Election]
) -> None:
    method = METHODS[name]
    a = method.compute(pcs_data.items, elections[PRES], {})
    b = method.compute(pcs_data.items, elections[PRES], {})
    assert a == b
    shuffled = method.compute(tuple(reversed(pcs_data.items)), elections[PRES], {})
    for code, point in a.pcs.items():
        assert shuffled.pcs[code] == pytest.approx(point, abs=1e-9)


@pytest.mark.parametrize("name", ALL_METHODS)
def test_methods_level2_composition(name: str, pcs_data: PcsData,
                                    elections: dict[str, Election]) -> None:
    """Niveau 2 : sommé par groupe par défaut, ou PCS par PCS ; la clé « 81 » est ignorée."""
    election = elections[EURO]
    assert "81" in election.composition["liste-e"]
    group_of = {p.code: p.group for p in pcs_data.items}
    by_group = METHODS[name].compute(pcs_data.items, election, {})
    by_pcs = METHODS[name].compute(pcs_data.items, election, {"candidate_pcs_level": 2})
    for c in election.candidates:
        shares = election.composition[c.id]
        totals: dict[str, float] = {}
        for code, s in shares.items():
            if code in group_of:
                totals[group_of[code]] = totals.get(group_of[code], 0.0) + s
        expected = _weighted([(s, *by_group.groups[g]) for g, s in totals.items()])
        assert by_group.candidates[c.id] == pytest.approx(expected, abs=TOL)
        expected = _weighted([(s, *by_pcs.pcs[k]) for k, s in shares.items() if k in group_of])
        assert by_pcs.candidates[c.id] == pytest.approx(expected, abs=TOL)


def test_methods_candidate_edge_cases(pcs_data: PcsData, elections: dict[str, Election]) -> None:
    method = METHODS["ranks_jnthnbs"]
    base = method.compute(pcs_data.items, None, {})
    solo = method.compute(pcs_data.items, _single(elections[PRES], {"3": 100.0}), {})
    assert solo.candidates["solo"] == pytest.approx(base.groups["3"], abs=TOL)
    nobody = method.compute(pcs_data.items, _single(elections[PRES], {"81": 100.0, "1": 0}), {})
    assert nobody.candidates == {}
    level2_falls_back = method.compute(
        pcs_data.items, _single(elections[PRES], {"3": 50.0, "5": 50.0}),
        {"candidate_pcs_level": 2},
    )
    assert level2_falls_back.candidates["solo"] == pytest.approx(
        _weighted([(50, *base.groups["3"]), (50, *base.groups["5"])]), abs=TOL
    )


# --- ranks_jnthnbs --------------------------------------------------------------------------


def test_methods_ranks_grid_and_formula(results: dict, pcs_data: PcsData) -> None:
    """Coordonnées = -10 + (20/29)·(30 - rang), rangs décroissants des scores."""
    result = results[("ranks_jnthnbs", PRES)]
    n = len(pcs_data.items)
    grid = sorted(-10 + (20 / (n - 1)) * (n - r) for r in range(1, n + 1))
    assert sorted(p.x for p in result.pcs.values()) == grid
    assert sorted(p.y for p in result.pcs.values()) == grid
    codes = [p.code for p in pcs_data.items]
    sx = x_scores(pcs_data.items)
    weights = {"bac5": 5, "bac3": 3, "bac2": 2, "bac": 1, "cap": -1, "brevet": -2,
               "certif_aucun": -3}
    sy = y_scores(pcs_data.items, weights, {"code": "7", "score": -180})
    for scores, axis in ((sx, 0), (sy, 1)):
        order = sorted(range(n), key=lambda i: (-scores[i], codes[i]))
        for rank, i in enumerate(order, start=1):
            assert result.pcs[codes[i]][axis] == -10 + (20 / (n - 1)) * (n - rank)


def test_methods_ranks_tie_break_by_code(results: dict, pcs_data: PcsData) -> None:
    """Ex æquo volontaires du jeu fictif : le plus petit code reçoit le meilleur rang."""
    by_code = {p.code: p for p in pcs_data.items}
    assert x_scores([by_code["62"]])[0] == x_scores([by_code["63"]])[0]
    assert by_code["67"].diplomes == by_code["68"].diplomes
    pcs = results[("ranks_jnthnbs", PRES)].pcs
    step = 20 / (len(by_code) - 1)
    assert pcs["62"].x - pcs["63"].x == pytest.approx(step)
    assert pcs["67"].y - pcs["68"].y == pytest.approx(step)
    xs = rank_coordinates([1.0, 1.0, 0.0], ["7", "10", "21"])
    assert xs.tolist() == [0.0, 10.0, -10.0]  # "10" < "7" (ordre lexicographique)


def test_methods_ranks_retired_override(pcs_data: PcsData) -> None:
    """Le score forcé des retraités ne dépend pas de leurs diplômes (sauf pour continuous)."""
    learned = {k: 0.0 for k in ("bac3", "bac2", "bac", "cap", "brevet", "certif_aucun")}
    items = tuple(replace(p, diplomes={"bac5": 100.0, **learned}) if p.code == "7" else p
                  for p in pcs_data.items)
    ranks = METHODS["ranks_jnthnbs"]
    forced = ranks.compute(pcs_data.items, None, {}).pcs["7"].y
    assert ranks.compute(items, None, {}).pcs["7"].y == forced == -10
    assert ranks.compute(items, None, {"retired_y_override": None}).pcs["7"].y == 10
    continuous = METHODS["continuous"]
    assert continuous.compute(items, None, {}).pcs["7"].y == 10


def test_methods_y_score_is_a_left_to_right_sum(pcs_data: PcsData) -> None:
    """Mêmes opérations flottantes que le portage TypeScript (voir ``scores.py``)."""
    keys = ("bac5", "bac3", "bac2", "bac", "cap", "brevet", "certif_aucun")
    weights = dict(zip(keys, (5, 3, 2, 1, -1, -2, -3), strict=True))
    sequential = []
    for p in pcs_data.items:
        score = 0.0
        for key in keys:
            score += weights[key] * p.diplomes[key]
        sequential.append(score)
    assert y_scores(pcs_data.items, weights).tolist() == sequential
    # Indépendant de l'ordre des clés du fichier de configuration.
    reordered = dict(reversed(list(weights.items())))
    assert y_scores(pcs_data.items, reordered).tolist() == sequential
    # Le test a du pouvoir : sum() (compensé depuis Python 3.12) donnerait d'autres valeurs.
    compensated = [sum(weights[k] * p.diplomes[k] for k in keys) for p in pcs_data.items]
    assert compensated != sequential


def test_methods_params_override(pcs_data: PcsData) -> None:
    result = METHODS["ranks_jnthnbs"].compute(
        pcs_data.items, None, {"y_weights": {"bac5": 1}, "retired_y_override": None,
                               "description": "ignorée"}
    )
    assert "description" not in result.params and result.params["y_weights"] == {"bac5": 1}
    best = sorted(pcs_data.items, key=lambda p: (-p.diplomes["bac5"], p.code))[0]
    assert result.pcs[best.code].y == 10
    with pytest.raises(ValueError, match="x_score inconnu"):
        METHODS["continuous"].compute(pcs_data.items, None, {"x_score": "nimporte"})
    with pytest.raises(ValueError, match="diplômes inconnus"):
        METHODS["continuous"].compute(pcs_data.items, None, {"y_weights": {"doctorat": 8}})


# --- continuous ------------------------------------------------------------------------------


def test_methods_continuous_minmax_preserves_order(results: dict, pcs_data: PcsData) -> None:
    result = results[("continuous", PRES)]
    xs = np.array([result.pcs[p.code].x for p in pcs_data.items])
    ys = np.array([result.pcs[p.code].y for p in pcs_data.items])
    for values in (xs, ys):
        assert values.min() == -10 and values.max() == 10  # bornes exactes
    sx = x_scores(pcs_data.items)
    expected = -10 + 20 * (sx - sx.min()) / (sx.max() - sx.min())
    assert xs == pytest.approx(expected, abs=1e-9)
    assert minmax_coordinates([3.0, 3.0]).tolist() == [0.0, 0.0]


# --- mca -------------------------------------------------------------------------------------


def test_methods_mca_orientation(results: dict, pcs_data: PcsData) -> None:
    """Chefs d'entreprise à droite du barycentre, cadres au-dessus."""
    result = results[("mca", POPULATION_ID)]
    assert result.pcs["23"].x > result.population.x
    assert result.groups["3"].y > result.population.y
    for axis in (0, 1):
        values = [p[axis] for p in result.pcs.values()]
        assert min(values) == -10 and max(values) == 10


def test_methods_mca_equal_values_stay_in_the_same_class(pcs_data: PcsData) -> None:
    assert quantile_bins(np.arange(6.0), 3).tolist() == [0, 0, 1, 1, 2, 2]
    assert quantile_bins(np.array([1.0, 2.0, 2.0, 2.0, 2.0, 3.0]), 3).tolist() == [0, 1, 1, 1, 1, 2]
    assert quantile_bins(np.full(4, 7.0), 3).tolist() == [1, 1, 1, 1]
    # Les PCS 62 et 63 du jeu fictif ont les mêmes revenus : mêmes classes de revenus.
    weights = {"bac5": 5, "bac3": 3, "bac2": 2, "bac": 1, "cap": -1, "brevet": -2,
               "certif_aucun": -3}
    table = indicator_table(pcs_data.items, weights, 3)
    income = [c for c in table.columns if not c.startswith("diplome")]
    assert table.loc["62", income].tolist() == table.loc["63", income].tolist()
    # Une variable constante laisse une seule colonne, sans empêcher le calcul.
    flat = tuple(replace(p, patrimoine_keur=100.0) for p in pcs_data.items)
    assert [c for c in indicator_table(flat, weights, 3) if c.startswith("patrimoine")] == [
        "patrimoine_2"
    ]
    result = METHODS["mca"].compute(flat, None, {})
    assert all(math.isfinite(p.x) and math.isfinite(p.y) for p in result.pcs.values())


def test_methods_mca_quintiles_and_validation(pcs_data: PcsData) -> None:
    result = METHODS["mca"].compute(pcs_data.items, None, {"n_bins": 5})
    assert len(set(result.pcs.values())) > len(set(
        METHODS["mca"].compute(pcs_data.items, None, {}).pcs.values()))
    zero = tuple(replace(p, population=0.0) if p.code == "44" else p for p in pcs_data.items)
    with pytest.raises(ValueError, match="population"):
        METHODS["mca"].compute(zero, None, {})
