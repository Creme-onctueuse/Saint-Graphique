"""Fonctions pures de l'analyse (sans OpenCV ni Pillow, testables en CI).

Regroupe le calcul sur les hash perceptuels, le calibrage des axes, l'appariement
des points et les métriques de comparaison. Aucun accès à ``research/`` ici.
"""

from __future__ import annotations

import math
import re
import unicodedata
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date

# --- Hash perceptuels et regroupement ------------------------------------------------


def hamming_hex(a: str, b: str) -> int:
    """Distance de Hamming entre deux hash hexadécimaux de même longueur."""
    if len(a) != len(b):
        raise ValueError(f"hash de longueurs différentes : {len(a)} et {len(b)}")
    return (int(a, 16) ^ int(b, 16)).bit_count()


def parse_yyyymmdd(value: str) -> date:
    """Convertit ``YYYYMMDD`` en date."""
    return date(int(value[:4]), int(value[4:6]), int(value[6:8]))


def cluster_by_hash(
    items: Sequence[Mapping[str, str]],
    *,
    max_distance: int = 12,
    max_days: int | None = None,
) -> list[list[int]]:
    """Regroupe des captures par lien simple sur le pHash (composantes connexes).

    Chaque élément porte ``phash`` et, si ``max_days`` est donné, ``upload_date``.
    Deux captures sont liées si leur distance est au plus ``max_distance`` et si
    leurs dates ne s'écartent pas de plus de ``max_days`` jours. Rend des listes
    d'indices, les plus grands groupes d'abord, en ordre stable.
    """
    parent = list(range(len(items)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    hashes = [int(it["phash"], 16) for it in items]
    dates = [parse_yyyymmdd(it["upload_date"]) for it in items] if max_days is not None else None
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            if (hashes[i] ^ hashes[j]).bit_count() > max_distance:
                continue
            if dates is not None and abs((dates[i] - dates[j]).days) > max_days:
                continue
            parent[find(j)] = find(i)
    groups: dict[int, list[int]] = {}
    for i in range(len(items)):
        groups.setdefault(find(i), []).append(i)
    return sorted(groups.values(), key=lambda g: (-len(g), g[0]))


def medoid(hashes: Sequence[str]) -> int:
    """Indice du hash le plus proche de tous les autres (somme des distances minimale)."""
    if not hashes:
        raise ValueError("liste vide")
    values = [int(h, 16) for h in hashes]
    totals = [sum((v ^ w).bit_count() for w in values) for v in values]
    return totals.index(min(totals))


# --- Calibrage pixel vers coordonnées ------------------------------------------------


@dataclass(frozen=True)
class AxisCalibration:
    """Transformation affine ``valeur = a * pixel + b`` pour un axe."""

    a: float
    b: float

    def to_value(self, pixel: float) -> float:
        return self.a * pixel + self.b

    def to_pixel(self, value: float) -> float:
        return (value - self.b) / self.a


def calibrate_axis(p1: float, v1: float, p2: float, v2: float) -> AxisCalibration:
    """Calibre un axe à partir de deux repères (pixel, valeur)."""
    if p1 == p2:
        raise ValueError("les deux repères ont le même pixel")
    if v1 == v2:
        raise ValueError("les deux repères ont la même valeur")
    a = (v2 - v1) / (p2 - p1)
    return AxisCalibration(a=a, b=v1 - a * p1)


def fit_axis(pairs: Sequence[tuple[float, float]]) -> tuple[AxisCalibration, float]:
    """Calibre un axe par moindres carrés sur au moins deux repères (pixel, valeur).

    Rend la calibration et l'erreur résiduelle maximale, en unités de l'axe : avec
    plus de deux repères, elle signale une graduation mal relevée.
    """
    if len(pairs) < 2:
        raise ValueError("il faut au moins deux repères")
    n = len(pairs)
    mx = sum(p for p, _ in pairs) / n
    my = sum(v for _, v in pairs) / n
    sxx = sum((p - mx) ** 2 for p, _ in pairs)
    if sxx == 0:
        raise ValueError("tous les repères ont le même pixel")
    a = sum((p - mx) * (v - my) for p, v in pairs) / sxx
    if a == 0:
        raise ValueError("tous les repères ont la même valeur")
    b = my - a * mx
    residual = max(abs(a * p + b - v) for p, v in pairs)
    return AxisCalibration(a=a, b=b), residual


# --- Appariement des libellés --------------------------------------------------------


def normalize_label(text: str) -> str:
    """Réduit un libellé : minuscules, sans accents, ni ponctuation, ni espaces multiples."""
    decomposed = unicodedata.normalize("NFKD", text)
    no_accents = "".join(c for c in decomposed if not unicodedata.combining(c))
    cleaned = re.sub(r"[^a-z0-9]+", " ", no_accents.lower())
    return cleaned.strip()


def label_tokens(text: str) -> set[str]:
    """Mots significatifs d'un libellé (sans mots vides ni nombres isolés)."""
    stop = {"de", "des", "du", "la", "le", "les", "et", "ou", "en", "a", "au", "aux", "d", "l", "y"}
    return {w for w in normalize_label(text).split() if w not in stop and not w.isdigit()}


def jaccard(a: set[str], b: set[str]) -> float:
    """Indice de Jaccard entre deux ensembles (0 si les deux sont vides)."""
    return len(a & b) / len(a | b) if a | b else 0.0


def best_label_match(
    label: str,
    candidates: Mapping[str, Iterable[str]],
    *,
    min_score: float = 0.5,
) -> tuple[str, float] | None:
    """Cherche la clé dont l'un des libellés ressemble le plus à ``label``.

    ``candidates`` associe une clé (code PCS, identifiant de candidat) à ses
    libellés. Égalité exacte après normalisation : score 1. Sinon Jaccard sur les
    mots. Rend ``None`` sous ``min_score``, ou si deux clés sont à égalité (ambigu).
    """
    wanted = normalize_label(label)
    tokens = label_tokens(label)
    scored: list[tuple[float, str]] = []
    for key, labels in candidates.items():
        best = 0.0
        for option in labels:
            if normalize_label(option) == wanted:
                best = 1.0
                break
            best = max(best, jaccard(tokens, label_tokens(option)))
        scored.append((best, key))
    scored.sort(key=lambda s: (-s[0], s[1]))
    if not scored or scored[0][0] < min_score:
        return None
    if len(scored) > 1 and scored[0][0] == scored[1][0]:
        return None
    return scored[0][1], scored[0][0]


# --- Métriques -----------------------------------------------------------------------


def rmse(a: Sequence[float], b: Sequence[float]) -> float:
    """Racine de l'erreur quadratique moyenne entre deux séries de même longueur."""
    if len(a) != len(b):
        raise ValueError("séries de longueurs différentes")
    if not a:
        raise ValueError("séries vides")
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b, strict=True)) / len(a))


def average_ranks(values: Sequence[float]) -> list[float]:
    """Rangs à partir de 1, avec le rang moyen pour les ex aequo."""
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        average = (i + j) / 2 + 1
        for k in range(i, j + 1):
            ranks[order[k]] = average
        i = j + 1
    return ranks


def pearson(a: Sequence[float], b: Sequence[float]) -> float | None:
    """Corrélation de Pearson, ``None`` si une série est constante ou trop courte."""
    if len(a) != len(b):
        raise ValueError("séries de longueurs différentes")
    n = len(a)
    if n < 2:
        return None
    ma = sum(a) / n
    mb = sum(b) / n
    sa = sum((x - ma) ** 2 for x in a)
    sb = sum((y - mb) ** 2 for y in b)
    if sa == 0 or sb == 0:
        return None
    cov = sum((x - ma) * (y - mb) for x, y in zip(a, b, strict=True))
    return cov / math.sqrt(sa * sb)


def spearman(a: Sequence[float], b: Sequence[float]) -> float | None:
    """Corrélation de Spearman (Pearson sur les rangs, ex aequo au rang moyen)."""
    return pearson(average_ranks(a), average_ranks(b))


def weighted_mean(values: Sequence[float], weights: Sequence[float]) -> float:
    """Moyenne pondérée : le barycentre d'un électorat sur un axe."""
    total = sum(weights)
    if total <= 0:
        raise ValueError("somme des poids nulle")
    return sum(v * w for v, w in zip(values, weights, strict=True)) / total


def fit_barycenter_coordinates(
    compositions: Sequence[Sequence[float]],
    observed: Sequence[float],
) -> tuple[list[float], float]:
    """Retrouve les coordonnées des PCS à partir d'électorats et de leurs barycentres.

    Résout par moindres carrés ``observé = composition (normée à 1) . coordonnées``. Rend
    les coordonnées et l'erreur absolue maximale, qui mesure si le barycentre simple
    explique les valeurs observées.
    """
    import numpy as np

    matrix = np.asarray(compositions, dtype=float)
    matrix = matrix / matrix.sum(axis=1, keepdims=True)
    target = np.asarray(observed, dtype=float)
    solution, *_ = np.linalg.lstsq(matrix, target, rcond=None)
    residual = float(np.max(np.abs(matrix @ solution - target)))
    return [float(v) for v in solution], residual


def to_ranks_scale(values: Sequence[float]) -> list[float]:
    """Rangs ramenés sur [-10, 10], croissants avec la valeur (ex aequo au rang moyen)."""
    n = len(values)
    if n < 2:
        raise ValueError("il faut au moins deux valeurs")
    return [-10 + 20 * (r - 1) / (n - 1) for r in average_ranks(values)]
