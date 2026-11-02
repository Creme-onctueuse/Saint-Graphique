"""Scores bruts et mises à l'échelle communs aux méthodes.

- score x (« exploitation ») : patrimoine / niveau de vie × 100 (``patrimoine_over_niveau_vie``) ;
- score y (« domination ») : somme pondérée de la répartition des diplômes (``y_weights``).

Origine de l'algorithme : voir ``ranks``.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import Any

import numpy as np

from pipeline.model import DIPLOMA_KEYS, Pcs

#: Scores x disponibles (valeur de ``x_score`` dans ``config/methods.yaml``).
X_SCORES: dict[str, Callable[[Pcs], float]] = {
    "patrimoine_over_niveau_vie": lambda p: (p.patrimoine_keur / p.niveau_vie_mensuel_eur) * 100,
}


def x_scores(pcs: Sequence[Pcs], kind: str = "patrimoine_over_niveau_vie") -> np.ndarray:
    """Score x de chaque PCS (même ordre que ``pcs``)."""
    if kind not in X_SCORES:
        raise ValueError(f"x_score inconnu : {kind!r} (disponibles : {', '.join(X_SCORES)})")
    for p in pcs:
        if p.niveau_vie_mensuel_eur <= 0:
            raise ValueError(f"PCS {p.code} : niveau de vie nul, score x indéfini")
    return np.array([X_SCORES[kind](p) for p in pcs], dtype=float)


def _weighted_diplomas(p: Pcs, weights: Mapping[str, float]) -> float:
    """Somme pondérée, de gauche à droite, dans l'ordre fixe de ``DIPLOMA_KEYS``.

    Surtout pas ``sum()`` : depuis Python 3.12, il compense les arrondis sur les flottants, alors
    que la référence et le portage TypeScript additionnent pas à pas. Un écart au dernier chiffre
    suffirait à inverser deux scores quasi égaux, donc deux rangs.
    """
    score = 0.0
    for key in DIPLOMA_KEYS:
        if key in weights:
            score += weights[key] * p.diplomes[key]
    return score


def y_scores(
    pcs: Sequence[Pcs],
    weights: Mapping[str, float],
    retired_override: Mapping[str, Any] | None = None,
) -> np.ndarray:
    """Score y : somme des parts de diplômes (%) pondérées par ``weights``.

    ``retired_override`` (``{"code": "7", "score": -180}``) force le score d'une PCS : c'est ainsi
    que la référence traite les retraités, dont la répartition des diplômes n'est pas utilisée.
    """
    unknown = set(weights) - set(DIPLOMA_KEYS)
    if unknown:
        raise ValueError(f"y_weights : diplômes inconnus {sorted(unknown)}")
    scores = np.array([_weighted_diplomas(p, weights) for p in pcs], dtype=float)
    if retired_override:
        code, score = str(retired_override["code"]), float(retired_override["score"])
        for i, p in enumerate(pcs):
            if p.code == code:
                scores[i] = score
    return scores


def rank_coordinates(
    scores: Sequence[float] | np.ndarray,
    codes: Sequence[str],
    lo: float = -10.0,
    hi: float = 10.0,
) -> np.ndarray:
    """Rangs décroissants 1..N ramenés sur [lo, hi] : ``lo + (hi - lo)/(N - 1) · (N - rang)``.

    Le score le plus élevé reçoit le rang 1, donc la coordonnée ``hi`` ; le plus faible ``lo``.
    Pour N = 30 et [-10, 10], c'est la formule de la référence : -10 + (20/29)·(30 - rang).

    Ex æquo : départage stable par code PCS en ordre lexicographique, qui suit la nomenclature
    ("10" < "21" < … < "69" < "7"). À score égal, le plus petit code reçoit le meilleur rang.
    La référence (``sort_values`` de pandas, tri non stable) ne fixe aucune règle ; ses données
    2022 n'ont d'ailleurs aucun ex æquo.
    """
    s = np.asarray(scores, dtype=float)
    if len(codes) != len(s):
        raise ValueError("un code par score est attendu")
    if not np.all(np.isfinite(s)):
        raise ValueError("scores non finis")
    n = len(s)
    if n == 1:
        return np.array([(lo + hi) / 2])
    order = sorted(range(n), key=lambda i: (-s[i], codes[i]))
    ranks = np.empty(n, dtype=np.int64)
    ranks[order] = np.arange(1, n + 1)
    return lo + (hi - lo) / (n - 1) * (n - ranks)


def zscores(values: Sequence[float] | np.ndarray) -> np.ndarray:
    """Standardisation non pondérée (moyenne 0, écart-type 1, ddof = 0) sur les N PCS."""
    v = np.asarray(values, dtype=float)
    sd = v.std()
    return np.zeros_like(v) if sd == 0 else (v - v.mean()) / sd


def minmax_coordinates(
    values: Sequence[float] | np.ndarray, lo: float = -10.0, hi: float = 10.0
) -> np.ndarray:
    """Mise à l'échelle linéaire : minimum → ``lo``, maximum → ``hi`` (centre si constant).

    Calcul ``lo + (hi - lo) · ((v - min) / (max - min))`` : le rapport est formé d'abord, il vaut
    exactement 0 au minimum et 1 au maximum, donc les extrêmes tombent exactement sur les bornes.
    """
    v = np.asarray(values, dtype=float)
    if not np.all(np.isfinite(v)):
        raise ValueError("valeurs non finies")
    vmin, vmax = v.min(), v.max()
    if vmax == vmin:
        return np.full(v.shape, (lo + hi) / 2)
    return lo + (hi - lo) * ((v - vmin) / (vmax - vmin))
