"""Bootstrap des compositions et ellipses de confiance (jeu FICTIF).

Référence théorique : pour ``ranks`` et ``continuous``, les PCS ne dépendent pas de
l'élection. Le barycentre d'un candidat, B = Σ p_g·G_g, est donc linéaire dans sa composition
normalisée p, d'où Cov(B) = Gᵀ·(diag(p) - p·pᵀ)/n·G, avec n = (1,96 × 50 / margin_pts)². Les
ellipses simulées (graine fixée) doivent retrouver ces demi-axes à l'erreur Monte-Carlo près :
environ 1/√(2·n_boot), soit 1,6 % pour 2 000 tirages.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from pipeline.methods import METHODS
from pipeline.methods.bootstrap import (
    DEFAULT_MARGIN_PTS,
    Z_975,
    bootstrap_ellipses,
    effective_sample_size,
    ellipse_from_samples,
    perturb_composition,
)
from pipeline.model import ROOT, Election, PcsData, Result, load_elections, load_pcs

FAKE = ROOT / "pipeline" / "tests" / "fixtures" / "fake"
BOOTSTRAPPED = ("ranks", "continuous", "espace_social")
CHI2_95 = -2 * math.log(0.05)


@pytest.fixture(scope="module")
def pcs_data() -> PcsData:
    return load_pcs(FAKE / "pcs.json")


@pytest.fixture(scope="module")
def elections() -> dict[str, Election]:
    return {e.id: e for e in load_elections(FAKE / "elections")}


def expected_axes(
    result: Result, election: Election, cid: str, margin_pts: float, pcs_data: PcsData
) -> tuple[float, float]:
    """Demi-axes théoriques (rx, ry) de l'ellipse à 95 % du candidat ``cid``."""
    group_of = {p.code: p.group for p in pcs_data.items}
    shares: dict[str, float] = {}
    for code, share in election.composition[cid].items():
        group = code if election.pcs_level == 1 else group_of.get(code)
        if group in result.groups and share > 0:
            shares[group] = shares.get(group, 0.0) + share
    positive_total = sum(s for s in election.composition[cid].values() if s > 0)
    p = np.array(list(shares.values())) / sum(shares.values())
    points = np.array([result.groups[g] for g in shares])
    # Les clés ignorées (ex. « 81 ») réduisent la taille effective : n·(part conservée).
    n = effective_sample_size(margin_pts) * sum(shares.values()) / positive_total
    covariance = points.T @ ((np.diag(p) - np.outer(p, p)) / n) @ points
    small, large = np.linalg.eigvalsh(covariance)
    return math.sqrt(CHI2_95 * large), math.sqrt(CHI2_95 * small)


@pytest.mark.parametrize("name", BOOTSTRAPPED)
@pytest.mark.parametrize("election_id", ["2099_presidentielle_t1", "2099_europeennes"])
def test_methods_bootstrap_deterministic_with_seed(
    name: str, election_id: str, pcs_data: PcsData, elections: dict[str, Election]
) -> None:
    method, election = METHODS[name], elections[election_id]
    a = bootstrap_ellipses(method, pcs_data.items, election, {}, n_boot=200, seed=7)
    b = bootstrap_ellipses(method, pcs_data.items, election, {}, n_boot=200, seed=7)
    c = bootstrap_ellipses(method, pcs_data.items, election, {}, n_boot=200, seed=8)
    assert a == b
    assert a != c
    assert set(a) == set(method.compute(pcs_data.items, election, {}).candidates)
    for e in a.values():
        assert e.rx >= e.ry > 0 and -90 < e.angle_deg <= 90


@pytest.mark.parametrize("kind", ["dirichlet", "normal"])
@pytest.mark.parametrize("name", BOOTSTRAPPED)
def test_methods_bootstrap_matches_theory(
    name: str, kind: str, pcs_data: PcsData, elections: dict[str, Election]
) -> None:
    """Ordre de grandeur attendu : demi-axes théoriques à 10 % près (≈ 6 erreurs-types)."""
    method = METHODS[name]
    for election in elections.values():
        margin = election.margin_pts or DEFAULT_MARGIN_PTS
        result = method.compute(pcs_data.items, election, {})
        ellipses = bootstrap_ellipses(method, pcs_data.items, election, {}, n_boot=2000,
                                      seed=0, kind=kind)
        for cid, e in ellipses.items():
            rx, ry = expected_axes(result, election, cid, margin, pcs_data)
            assert e.rx == pytest.approx(rx, rel=0.1), (election.id, cid)
            assert e.ry == pytest.approx(ry, rel=0.1), (election.id, cid)


def test_methods_bootstrap_margin(pcs_data: PcsData, elections: dict[str, Election]) -> None:
    method = METHODS["ranks"]
    pres, euro = elections["2099_presidentielle_t1"], elections["2099_europeennes"]
    assert pres.margin_pts == 3.0 and euro.margin_pts is None
    # Sans marge dans l'élection : 3 points par défaut.
    default = bootstrap_ellipses(method, pcs_data.items, euro, {}, n_boot=100, seed=1)
    explicit = bootstrap_ellipses(method, pcs_data.items, euro, {}, n_boot=100, seed=1,
                                  margin_pts=3.0)
    assert default == explicit
    # Une marge double double les demi-axes, toujours conformément à la théorie.
    result = method.compute(pcs_data.items, pres, {})
    large = bootstrap_ellipses(method, pcs_data.items, pres, {}, n_boot=2000, seed=0,
                               margin_pts=6.0)
    for cid, e in large.items():
        rx3, ry3 = expected_axes(result, pres, cid, 3.0, pcs_data)
        rx6, ry6 = expected_axes(result, pres, cid, 6.0, pcs_data)
        assert (rx6, ry6) == pytest.approx((2 * rx3, 2 * ry3))
        assert (e.rx, e.ry) == pytest.approx((rx6, ry6), rel=0.1)
    # Marge nulle : aucune dispersion, ellipses exactement nulles.
    flat = bootstrap_ellipses(method, pcs_data.items, pres, {}, n_boot=10, margin_pts=0.0)
    assert set(flat) == set(result.candidates)
    assert all(e == (0.0, 0.0, 0.0) for e in flat.values())
    with pytest.raises(ValueError):
        bootstrap_ellipses(method, pcs_data.items, pres, {}, n_boot=1)


@pytest.mark.parametrize("kind", ["dirichlet", "normal"])
def test_methods_bootstrap_perturbation(kind: str, elections: dict[str, Election]) -> None:
    """Parts positives, zéros conservés, total conservé, écart-type √(p(1-p)/n) par part."""
    composition = elections["2099_presidentielle_t1"].composition
    rng = np.random.default_rng(0)
    draws = [perturb_composition(composition, 3.0, rng, kind) for _ in range(4000)]
    for cid, shares in composition.items():
        for draw in draws[:50]:
            assert draw[cid].keys() == shares.keys()
            assert sum(draw[cid].values()) == pytest.approx(sum(shares.values()))
            for k, v in shares.items():
                assert draw[cid][k] >= 0 and (v > 0 or draw[cid][k] == 0)
    n = effective_sample_size(3.0)
    assert n == pytest.approx((Z_975 * 50 / 3) ** 2)
    for cid, key in (("candidat-a", "7"), ("candidate-b", "3"), ("candidat-c", "2")):
        total = sum(composition[cid].values())
        p = composition[cid][key] / total
        observed = np.std([d[cid][key] for d in draws]) / total
        assert observed == pytest.approx(math.sqrt(p * (1 - p) / n), rel=0.1), (cid, key)
    with pytest.raises(ValueError):
        perturb_composition(composition, 3.0, rng, "uniforme")  # type: ignore[arg-type]


def test_methods_bootstrap_ellipse_geometry() -> None:
    """Covariance connue : demi-axes √(5,991·λ) et angle du grand axe."""
    rng = np.random.default_rng(3)
    base = rng.standard_normal((200_000, 2)) * [2.0, 1.0]  # variances 4 et 1
    e = ellipse_from_samples(base)
    assert e.rx == pytest.approx(math.sqrt(CHI2_95 * 4), rel=0.02)
    assert e.ry == pytest.approx(math.sqrt(CHI2_95 * 1), rel=0.02)
    assert abs(e.angle_deg) < 1.5
    theta = math.radians(30)
    rotation = np.array([[math.cos(theta), -math.sin(theta)], [math.sin(theta), math.cos(theta)]])
    assert ellipse_from_samples(base @ rotation.T).angle_deg == pytest.approx(30, abs=1.5)
    assert ellipse_from_samples(base @ rotation).angle_deg == pytest.approx(-30, abs=1.5)
    # Grand axe vertical : angle 90 (et non -90).
    assert ellipse_from_samples(base[:, ::-1]).angle_deg == pytest.approx(90, abs=1.5)
    # Points identiques (même non représentables exactement) : ellipse nulle.
    assert ellipse_from_samples(np.full((10, 2), 0.1)) == (0.0, 0.0, 0.0)
    with pytest.raises(ValueError):
        ellipse_from_samples(np.zeros((1, 2)))
