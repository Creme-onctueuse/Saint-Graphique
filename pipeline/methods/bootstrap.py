"""Ellipses de confiance des électorats par bootstrap paramétrique des compositions.

Les compositions viennent de sondages et portent une marge d'erreur ``margin_pts``
(3 points par défaut, ou valeur de l'élection). On la convertit en taille d'échantillon
effective n : à 95 %, la marge sur une proportion p vaut 1,96·√(p(1-p)/n), maximale pour
p = 50 %. D'où n = (1,96 × 50 / margin_pts)², soit ≈ 1 067 pour 3 points.

À chaque tirage, la composition de chaque candidat (normalisée en proportions p) est
perturbée selon l'une des deux lois suivantes, qui ont la covariance d'un sondage multinomial,
(diag(p) - p·pᵀ)/n, et donc l'écart-type √(p_i(1-p_i)/n) par part :
- ``dirichlet`` (défaut) : p* ~ Dirichlet(n·p), ce qui garde des parts positives de somme 1 ;
- ``normal`` : p* = p + ε, avec ε ~ N(0, (diag(p) - p·pᵀ)/n) de somme nulle, obtenu par
  ε = (√p ⊙ z - p·Σ(√p ⊙ z)) / √n pour z ~ N(0, I). Les parts négatives (rares) sont
  tronquées à 0, puis le vecteur est renormalisé. Un bruit indépendant de même écart-type
  suivi d'une renormalisation sous-estimerait la dispersion.
Dans les deux cas, les parts nulles restent nulles (catégorie absente de la source) et la
somme initiale est conservée.

La méthode est recalculée pour chaque tirage (500 par défaut). L'ellipse à 95 % d'un candidat
vient de la covariance Σ de ses positions simulées : ses demi-axes valent √(χ²₂(0,95)·λ), où
λ sont les valeurs propres de Σ et χ²₂(0,95) = -2·ln(0,05) ≈ 5,991. Elle est centrée sur le
point estimé sans perturbation. Avec une graine fixée (``seed``), le résultat est déterministe.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any, Literal

import numpy as np

from pipeline.methods.base import Method
from pipeline.model import Election, Ellipse, Pcs

DEFAULT_MARGIN_PTS = 3.0
DEFAULT_N_BOOT = 500
DEFAULT_LEVEL = 0.95
Z_975 = 1.959963984540054  # quantile 97,5 % de la loi normale centrée réduite

Kind = Literal["dirichlet", "normal"]


def effective_sample_size(margin_pts: float) -> float:
    """Taille d'échantillon dont la marge maximale à 95 % vaut ``margin_pts`` points."""
    if margin_pts <= 0:
        raise ValueError("margin_pts doit être strictement positif")
    return (Z_975 * 50.0 / margin_pts) ** 2


def perturb_composition(
    composition: Mapping[str, Mapping[str, float]],
    margin_pts: float,
    rng: np.random.Generator,
    kind: Kind = "dirichlet",
) -> dict[str, dict[str, float]]:
    """Tire une composition perturbée pour chaque candidat (voir l'en-tête du module)."""
    if margin_pts == 0:
        return {cid: dict(shares) for cid, shares in composition.items()}
    n = effective_sample_size(margin_pts)
    perturbed: dict[str, dict[str, float]] = {}
    for cid, shares in composition.items():
        keys = list(shares)
        values = np.array([shares[k] for k in keys], dtype=float)
        total = values.sum()
        positive = values > 0
        if total <= 0 or positive.sum() < 2:
            perturbed[cid] = dict(shares)
            continue
        p = values[positive] / total
        if kind == "dirichlet":
            draw = rng.dirichlet(n * p)
        elif kind == "normal":
            u = np.sqrt(p) * rng.standard_normal(len(p))
            draw = np.clip(p + (u - p * u.sum()) / math.sqrt(n), 0.0, None)
            draw = draw / draw.sum() if draw.sum() > 0 else p
        else:
            raise ValueError(f"loi de perturbation inconnue : {kind!r}")
        out = np.zeros_like(values)
        out[positive] = draw * total
        perturbed[cid] = dict(zip(keys, out.tolist(), strict=True))
    return perturbed


def ellipse_from_samples(points: np.ndarray, level: float = DEFAULT_LEVEL) -> Ellipse:
    """Ellipse de confiance (loi normale bivariée) des points simulés, de forme (m, 2).

    La covariance est calculée sur les écarts au premier point (elle est invariante par
    translation). C'est plus précis numériquement, et des points tous identiques donnent une
    ellipse exactement nulle.
    """
    xy = np.asarray(points, dtype=float)
    if xy.ndim != 2 or xy.shape[1] != 2 or len(xy) < 2:
        raise ValueError("au moins deux points (x, y) sont nécessaires")
    eigenvalues, eigenvectors = np.linalg.eigh(np.cov(xy - xy[0], rowvar=False))
    k = -2.0 * math.log(1.0 - level)  # quantile du χ² à 2 degrés de liberté
    rx = math.sqrt(k * max(float(eigenvalues[1]), 0.0))
    ry = math.sqrt(k * max(float(eigenvalues[0]), 0.0))
    if rx - ry <= 1e-12 * max(rx, 1.0):
        return Ellipse(rx, ry, 0.0)  # cercle : angle sans objet
    vx, vy = eigenvectors[:, 1]
    angle = math.degrees(math.atan2(vy, vx))
    if angle <= -90.0:
        angle += 180.0
    elif angle > 90.0:
        angle -= 180.0
    return Ellipse(rx, ry, angle)


def bootstrap_ellipses(
    method: Method,
    pcs: Sequence[Pcs],
    election: Election,
    params: Mapping[str, Any],
    *,
    n_boot: int = DEFAULT_N_BOOT,
    margin_pts: float | None = None,
    kind: Kind = "dirichlet",
    seed: int = 0,
    level: float = DEFAULT_LEVEL,
) -> dict[str, Ellipse]:
    """Ellipse de confiance de chaque candidat placé par ``method`` pour ``election``.

    ``margin_pts`` : marge en points (défaut : celle de l'élection, sinon 3). La méthode est
    recalculée ``n_boot`` fois sur des compositions perturbées ; ``seed`` rend le tirage
    reproductible.
    """
    if n_boot < 2:
        raise ValueError("n_boot doit valoir au moins 2")
    if margin_pts is None:
        margin_pts = election.margin_pts if election.margin_pts is not None else DEFAULT_MARGIN_PTS
    if margin_pts < 0:
        raise ValueError("margin_pts doit être positif ou nul")
    rng = np.random.default_rng(seed)
    samples: dict[str, list[tuple[float, float]]] = {}
    for _ in range(n_boot):
        composition = perturb_composition(election.composition, margin_pts, rng, kind)
        result = method.compute(pcs, election.with_composition(composition), params)
        for cid, point in result.candidates.items():
            samples.setdefault(cid, []).append((point.x, point.y))
    return {
        cid: ellipse_from_samples(np.array(points), level)
        for cid, points in samples.items()
        if len(points) >= 2
    }
