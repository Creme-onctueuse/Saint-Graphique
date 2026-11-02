"""Exactitude de ``ranks`` par rapport à la reproduction JnthnBS : test LOCAL.

JnthnBS/saint-graphique (https://github.com/JnthnBS/saint-graphique) n'a pas de licence : son code
et ses données ne sont pas dans ce dépôt, seulement dans ``research/`` (gitignoré). Ce module est
donc ignoré quand ``research/ref/jnthnbs`` est absent, notamment en CI.

Les valeurs de référence sont recalculées à chaque exécution : ``load_reference_functions`` extrait
de l'arbre syntaxique de ``webapp.py`` les seules fonctions de calcul, sans exécuter le reste du
module (Dash, Flask, Plotly), et les applique à ses CSV d'origine. Rien n'en est recopié ici.

Le jeu comparé est celui de notre convertisseur (``fixtures/convert_jnthnbs.py``), dont la sortie
locale est ``research/fixtures/jnthnbs_2022/``. Ce module vérifie aussi les constats sur ces données
cités par les docstrings de ``mca.py``, ``scores.py`` et ``continuous.py``.
"""

from __future__ import annotations

import ast
import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import pytest

from pipeline import build
from pipeline.methods import METHODS
from pipeline.methods.mca import fit_weighted_mca, indicator_table
from pipeline.methods.scores import x_scores, y_scores
from pipeline.model import (
    ROOT,
    Election,
    PcsData,
    Result,
    load_election,
    load_methods_config,
    load_pcs,
    read_json,
    validate_instance,
)
from pipeline.tests.fixtures.convert_jnthnbs import (
    DEFAULT_DEST,
    DEFAULT_SOURCE,
    ELECTION_ID,
    convert,
)

REFERENCE_DIR = ROOT / "research" / "ref" / "jnthnbs"
WEBAPP = REFERENCE_DIR / "backend" / "webapp.py"
REFERENCE_FUNCTIONS = (
    "donnees_pop", "donnees_elec", "effectifs", "abscisses", "ordonnees",
    "coordonnees_population", "simplification_pcs", "barycentres_votes",
)
# Coordonnées des PCS : égalité stricte. Barycentres : la référence somme par groupe avec un
# algorithme propre à pandas, seul le dernier chiffre flottant peut donc différer.
BARYCENTER_TOLERANCE = 1e-12
Y_WEIGHTS = {"bac5": 5, "bac3": 3, "bac2": 2, "bac": 1, "cap": -1, "brevet": -2, "certif_aucun": -3}
HIGH_PROFILE = {"23", "31", "33", "34", "35", "37", "38"}
LOW_PROFILE = {"56", "63", "64", "65", "67", "68", "69"}
MIDDLE_PROFILE = {"47", "48", "53", "54"}

pytestmark = pytest.mark.skipif(
    not WEBAPP.exists(), reason="research/ref/jnthnbs absent : référence locale, jamais publiée"
)


def load_reference_functions() -> dict[str, Callable[..., Any]]:
    """Charge les fonctions de calcul de ``webapp.py`` sans exécuter le reste du module."""
    tree = ast.parse(WEBAPP.read_text(encoding="utf-8"), filename=str(WEBAPP))
    definitions = [
        node for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name in REFERENCE_FUNCTIONS
    ]
    namespace: dict[str, Any] = {"os": os, "pd": pd}
    module = ast.Module(body=definitions, type_ignores=[])
    exec(compile(module, str(WEBAPP), "exec"), namespace)
    return {name: namespace[name] for name in REFERENCE_FUNCTIONS}


@dataclass(frozen=True)
class Reference:
    """Valeurs calculées par les fonctions de la référence sur ses CSV d'origine."""

    x_scores: dict[str, float]
    y_scores: dict[str, float]
    effectifs: dict[str, float]
    parts: dict[str, float]
    pcs: dict[str, tuple[float, float]]
    groups: dict[str, tuple[float, float]]
    candidates: dict[str, tuple[float, float]]
    population: tuple[float, float]


def _points(frame: pd.DataFrame) -> dict[str, tuple[float, float]]:
    keys, xs, ys = frame["PCS"].tolist(), frame["X"].tolist(), frame["Y"].tolist()
    return {key: (x, y) for key, x, y in zip(keys, xs, ys, strict=True)}


def _column(frame: pd.DataFrame, name: str) -> dict[str, float]:
    return dict(zip(frame["PCS"].tolist(), frame[name].tolist(), strict=True))


@pytest.fixture(scope="module")
def reference() -> Reference:
    functions = load_reference_functions()
    with pytest.MonkeyPatch.context() as patch:
        patch.chdir(REFERENCE_DIR)  # webapp.py lit ses CSV par chemins relatifs
        pcs, revenus, diplomes, labels_2 = functions["donnees_pop"]("2022")
        _, compositions, _, labels_1 = functions["donnees_elec"]("2022", "presidentielles")
        communes = pd.read_csv(Path("data") / "communes.csv", sep=";", dtype=str)
    ensemble = functions["effectifs"](pcs, "100", 1, communes)
    # abscisses et ordonnees ajoutent en outre la colonne Score au tableau reçu.
    abscisses, ordonnees = functions["abscisses"](revenus), functions["ordonnees"](diplomes)
    population, barycenter = functions["coordonnees_population"](
        labels_2, ensemble, abscisses, ordonnees
    )
    pcs_points = _points(population)
    groups = functions["simplification_pcs"](population.copy(), labels_1)
    votes = functions["barycentres_votes"](groups, compositions)
    return Reference(
        x_scores=_column(revenus, "Score"),
        y_scores=_column(diplomes, "Score"),
        effectifs=_column(ensemble, "NB"),
        parts=_column(ensemble, "Part"),
        pcs=pcs_points,
        groups=_points(groups),
        candidates=_points(votes),
        population=_points(barycenter)["100"],
    )


@pytest.fixture(scope="module")
def converted(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Sortie fraîche du convertisseur, dans un dossier temporaire."""
    destination = tmp_path_factory.mktemp("jnthnbs_2022")
    convert(DEFAULT_SOURCE, destination)
    return destination


@pytest.fixture(scope="module")
def dataset(converted: Path) -> tuple[PcsData, Election]:
    return (load_pcs(converted / "pcs.json"),
            load_election(converted / "elections" / f"{ELECTION_ID}.json"))


@pytest.fixture(scope="module")
def ranks(dataset: tuple[PcsData, Election]) -> Result:
    """``ranks`` avec les paramètres réels de ``config/methods.yaml``."""
    pcs_data, election = dataset
    params = build.method_params("ranks", load_methods_config())
    return METHODS["ranks"].compute(pcs_data.items, election, params)


# --- Exactitude ------------------------------------------------------------------------------


def test_methods_reference_pcs_coordinates_are_exact(reference: Reference, ranks: Result) -> None:
    """Les X et Y des 30 PCS sont identiques au bit près."""
    assert len(reference.pcs) == 30
    assert set(ranks.pcs) == set(reference.pcs)
    different = {
        code: (tuple(ranks.pcs[code]), expected)
        for code, expected in reference.pcs.items()
        if tuple(ranks.pcs[code]) != expected
    }
    assert different == {}


def test_methods_reference_barycenters(
    reference: Reference, ranks: Result, dataset: tuple[PcsData, Election]
) -> None:
    """Groupes, électorats et population : mêmes valeurs, au dernier chiffre flottant près."""
    assert ranks.population == pytest.approx(reference.population, abs=BARYCENTER_TOLERANCE)
    assert set(ranks.groups) == set(reference.groups)
    for code, expected in reference.groups.items():
        assert ranks.groups[code] == pytest.approx(expected, abs=BARYCENTER_TOLERANCE), code
    _, election = dataset
    ids = {c.label: c.id for c in election.candidates}
    assert set(ids) == set(reference.candidates)
    assert len(ranks.candidates) == len(reference.candidates) == 13
    for label, expected in reference.candidates.items():
        point = ranks.candidates[ids[label]]
        assert point == pytest.approx(expected, abs=BARYCENTER_TOLERANCE), label


def test_methods_reference_scores_are_exact(
    reference: Reference, dataset: tuple[PcsData, Election]
) -> None:
    items = dataset[0].items
    codes = [p.code for p in items]
    assert dict(zip(codes, x_scores(items).tolist(), strict=True)) == reference.x_scores
    assert dict(zip(codes, y_scores(items, Y_WEIGHTS).tolist(), strict=True)) == reference.y_scores
    # La référence encode par 180 % de CAP le score que retired_y_override force à -180.
    assert reference.y_scores["7"] == -180
    forced = y_scores(items, Y_WEIGHTS, {"code": "7", "score": -180})
    assert dict(zip(codes, forced.tolist(), strict=True)) == reference.y_scores


def test_methods_reference_population_is_exact(
    reference: Reference, dataset: tuple[PcsData, Election]
) -> None:
    items = dataset[0].items
    assert {p.code: p.population for p in items} == reference.effectifs
    total = sum(p.population for p in items)
    for p in items:
        assert 100 * p.population / total == pytest.approx(reference.parts[p.code], abs=1e-12)


def test_methods_reference_has_no_ties(reference: Reference) -> None:
    """Constat de ``scores.rank_coordinates`` : le départage n'intervient pas sur ces données."""
    assert len(set(reference.x_scores.values())) == 30
    assert len(set(reference.y_scores.values())) == 30


# --- Fixture locale et chaîne complète -------------------------------------------------------


def test_methods_reference_local_fixture_is_current(converted: Path) -> None:
    """``research/fixtures/jnthnbs_2022`` correspond à la sortie du convertisseur."""
    if not (DEFAULT_DEST / "pcs.json").exists():
        pytest.skip("uv run python -m pipeline.tests.fixtures.convert_jnthnbs pour la générer")
    for relative in ("pcs.json", f"elections/{ELECTION_ID}.json"):
        assert read_json(DEFAULT_DEST / relative) == read_json(converted / relative), relative


def test_methods_reference_build_end_to_end(
    converted: Path, reference: Reference, tmp_path: Path
) -> None:
    """La CLI publie les mêmes coordonnées, arrondies, avec des ellipses plausibles."""
    argv = ["--data-dir", str(converted), "--out-dir", str(tmp_path), "--n-boot", "200"]
    assert build.main(argv) == 0
    for method in ("ranks", "continuous", "mca"):
        for election_id in ("population", ELECTION_ID):
            validate_instance(read_json(tmp_path / method / f"{election_id}.json"),
                              "computed.schema.json", f"{method}/{election_id}")
    document = read_json(tmp_path / "ranks" / f"{ELECTION_ID}.json")
    for item in document["pcs"]:
        assert (item["x"], item["y"]) == pytest.approx(reference.pcs[item["code"]], abs=1e-6)
    for candidate in document["candidates"]:
        expected = reference.candidates[candidate["label"]]
        assert (candidate["x"], candidate["y"]) == pytest.approx(expected, abs=1e-6)
        assert 0 < candidate["ellipse"]["ry"] <= candidate["ellipse"]["rx"] < 2


# --- Constats cités par les docstrings ---------------------------------------------------------


def _weighted_correlation(a: np.ndarray, b: np.ndarray, weights: np.ndarray) -> float:
    w = weights / weights.sum()
    da, db = a - np.sum(w * a), b - np.sum(w * b)
    return float(np.sum(w * da * db) / np.sqrt(np.sum(w * da * da) * np.sum(w * db * db)))


def _mca_axes(pcs_data: PcsData) -> tuple[Result, np.ndarray, np.ndarray, np.ndarray]:
    result = METHODS["mca"].compute(pcs_data.items, None, {})
    xs = np.array([result.pcs[p.code].x for p in pcs_data.items])
    ys = np.array([result.pcs[p.code].y for p in pcs_data.items])
    weights = np.array([p.population for p in pcs_data.items])
    return result, xs, ys, weights


def test_methods_reference_mca_first_dimension_is_capital_volume(
    dataset: tuple[PcsData, Election],
) -> None:
    pcs_data = dataset[0]
    items = pcs_data.items
    frame = pd.DataFrame({
        "patrimoine": [p.patrimoine_keur for p in items],
        "niveau_vie": [p.niveau_vie_mensuel_eur for p in items],
        "diplome": y_scores(items, Y_WEIGHTS),
    })
    spearman = frame.corr(method="spearman").to_numpy()[np.triu_indices(3, k=1)]
    assert spearman.min() == pytest.approx(0.72, abs=0.01)
    assert spearman.max() == pytest.approx(0.80, abs=0.01)

    _, xs, _, weights = _mca_axes(pcs_data)
    indicator = indicator_table(items, Y_WEIGHTS, 3)
    inertia = fit_weighted_mca(indicator, weights).percentage_of_variance_
    assert inertia[0] == pytest.approx(40, abs=1)
    assert inertia[1] == pytest.approx(28, abs=1)
    classes = np.arange(3.0)
    volume = sum(
        indicator[[f"{variable}_{k + 1}" for k in range(3)]].to_numpy() @ classes
        for variable in ("patrimoine", "niveau_vie", "diplome")
    )
    assert _weighted_correlation(xs, volume, weights) == pytest.approx(0.95, abs=0.01)


def test_methods_reference_mca_second_dimension_is_a_partial_arch(
    dataset: tuple[PcsData, Election],
) -> None:
    pcs_data = dataset[0]
    items = pcs_data.items
    _, xs, ys, weights = _mca_axes(pcs_data)
    diploma = y_scores(items, Y_WEIGHTS)
    assert _weighted_correlation(ys, diploma, weights) == pytest.approx(0.15, abs=0.02)

    # Profils moyens sous les deux extrêmes, mais parabole de x loin d'expliquer tout y.
    by_code = dict(zip([p.code for p in items], ys.tolist(), strict=True))
    middle = max(by_code[c] for c in MIDDLE_PROFILE)
    assert middle < by_code["23"] < by_code["67"]
    sqrt_w = np.sqrt(weights / weights.sum())
    design = np.column_stack([np.ones_like(xs), xs, xs * xs])
    beta, *_ = np.linalg.lstsq(design * sqrt_w[:, None], ys * sqrt_w, rcond=None)
    residual = np.sum(weights * (ys - design @ beta) ** 2)
    total = np.sum(weights * (ys - np.sum(weights * ys) / weights.sum()) ** 2)
    assert 1 - residual / total == pytest.approx(1 / 3, abs=0.02)

    # L'axe oppose les classes basses aux classes moyennes de revenus, sans le diplôme.
    indicator = indicator_table(items, Y_WEIGHTS, 3)
    model = fit_weighted_mca(indicator, weights)
    columns = model.column_coordinates(indicator.mul(weights, axis=0))[1]
    for variable in ("patrimoine", "niveau_vie"):
        assert abs(columns[f"{variable}_1"]) > 1
        assert columns[f"{variable}_1"] * columns[f"{variable}_2"] < 0
    assert max(abs(columns[f"diplome_{k}"]) for k in (1, 2, 3)) < 0.25


def test_methods_reference_mca_orientation_and_overlaps(
    dataset: tuple[PcsData, Election],
) -> None:
    pcs_data = dataset[0]
    result, xs, ys, weights = _mca_axes(pcs_data)
    assert result.pcs["23"].x == 10 == xs.max()
    assert result.population.y == pytest.approx(-3.6, abs=0.05)
    assert result.groups["3"].y == pytest.approx(-0.2, abs=0.05)
    assert result.groups["3"].y > result.population.y
    assert result.pcs["67"].y == pytest.approx(10, abs=0.05)
    assert result.pcs["67"].y > result.groups["3"].y

    # Même profil de terciles, même point : égalité stricte.
    indicator = indicator_table(pcs_data.items, Y_WEIGHTS, 3)
    profile = {code: tuple(row) for code, row in zip(indicator.index, indicator.to_numpy().tolist(),
                                                     strict=True)}
    for codes in (HIGH_PROFILE, LOW_PROFILE, MIDDLE_PROFILE):
        assert len({profile[code] for code in codes}) == 1
        assert len({result.pcs[code] for code in codes}) == 1
    assert sum(profile[code] == profile["23"] for code in profile) == len(HIGH_PROFILE)
    assert sum(profile[code] == profile["67"] for code in profile) == len(LOW_PROFILE)
    assert len(set(result.pcs.values())) == len(set(profile.values()))
    fine = METHODS["mca"].compute(pcs_data.items, None, {"n_bins": 5})
    assert len(set(fine.pcs.values())) > len(set(result.pcs.values()))

    # Les retraités : une seule PCS, un tiers des effectifs.
    retired = next(p.population for p in pcs_data.items if p.code == "7")
    assert retired / weights.sum() == pytest.approx(1 / 3, abs=0.01)


def test_methods_reference_continuous_outlier(dataset: tuple[PcsData, Election]) -> None:
    """Les chefs d'entreprise, atypiques en x, repoussent les autres PCS vers la gauche."""
    result = METHODS["continuous"].compute(dataset[0].items, None, {})
    xs = sorted(point.x for point in result.pcs.values())
    assert result.pcs["23"].x == 10
    assert xs[len(xs) // 2] < -4


def test_methods_reference_is_not_published() -> None:
    """Garde-fou : la fixture locale reste dans un dossier ignoré par git."""
    gitignore = (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
    assert "research/" in gitignore
    assert DEFAULT_DEST.is_relative_to(ROOT / "research")
