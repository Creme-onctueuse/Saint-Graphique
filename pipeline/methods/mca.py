"""Méthode « mca » : analyse des correspondances multiples (ACM) avec prince.

Utilise le score diplôme de ``ranks_chris_v1``. Algorithme reconstruit par JnthnBS
(https://github.com/JnthnBS/saint-graphique), réimplémenté à partir de sa description, sans
copie de code. Saint-Graphique original : Chris et la PaduTeam.

Construction (choix documentés) :

1. Variables : chaque PCS est décrite par trois variables catégorielles en ``n_bins`` classes
   (terciles par défaut) : patrimoine, niveau de vie et score diplôme (poids ``y_weights``,
   sans forçage des retraités). Les classes sont des quantiles sur les N PCS (N/3 PCS par
   tercile, ex æquo départagés par code). Elles ne sont pas calculées sur la population :
   pondérées, elles seraient écrasées par les retraités, qui forment une seule PCS mais un
   tiers des effectifs.
2. Pondération par la population : une ACM est l'AFC du tableau disjonctif complet. On fournit
   à prince (``MCA(one_hot=False)``) ce tableau, chaque ligne étant multipliée par l'effectif
   de la PCS. Les masses des lignes deviennent ainsi proportionnelles à la population sans que
   leurs profils changent : c'est exactement une ACM pondérée par la population.
3. Axes : coordonnées principales des lignes, dimension 1 → x, dimension 2 → y. La SVD est
   exacte (moteur ``scipy``), donc le calcul est déterministe.
4. Orientation : le signe d'un axe factoriel étant arbitraire, x est retourné si les chefs
   d'entreprise (``orientation.right_pcs`` = "23") sont à gauche du barycentre de la
   population, et y si les cadres (groupe ``orientation.up_group`` = "3", moyenne pondérée)
   sont en dessous. Si le repère est absent ou tombe sur le barycentre, le signe suit la
   corrélation pondérée avec le score brut de l'axe (patrimoine / niveau de vie pour x,
   diplôme pour y).
5. Échelle : min/max vers [-10, 10] sur chaque axe, comme ``continuous``.

Limites, constatées sur les données 2022 de la reproduction JnthnBS (test local) : les trois
variables étant très corrélées, la dimension 1 (≈ 40 % de l'inertie) mesure surtout le volume
de capital, et la dimension 2 relève largement de l'effet Guttman (« fer à cheval » : profils
moyens opposés aux extrêmes). En terciles, les PCS de même profil se superposent : les six PCS
de cadres et les chefs d'entreprise partagent le profil haut/haut/haut. ``n_bins: 5`` donne un
découpage plus fin. La méthode est exploratoire et ne prétend pas reproduire le graphique de
Chris.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
import pandas as pd

from pipeline.methods.base import assemble_result, effective_params, register
from pipeline.methods.scores import minmax_coordinates, x_scores, y_scores
from pipeline.model import Election, Pcs, Result

_EPS = 1e-12


def quantile_bins(values: np.ndarray, codes: Sequence[str], n_bins: int) -> np.ndarray:
    """Classe 0..n_bins-1 de chaque élément : quantiles à effectifs égaux sur les éléments."""
    n = len(values)
    order = sorted(range(n), key=lambda i: (values[i], codes[i]))
    bins = np.empty(n, dtype=np.int64)
    for position, i in enumerate(order):
        bins[i] = position * n_bins // n
    return bins


def _weighted_mean(values: np.ndarray, weights: np.ndarray) -> float:
    return float(np.sum(weights * values) / np.sum(weights))


def _orient(
    axis: np.ndarray, anchor: float | None, reference: np.ndarray, weights: np.ndarray
) -> np.ndarray:
    """Renvoie ``axis`` ou ``-axis`` pour que le repère soit du côté positif."""
    if anchor is not None and abs(anchor) > _EPS:
        return axis if anchor > 0 else -axis
    covariance = _weighted_mean(
        (axis - _weighted_mean(axis, weights)) * (reference - _weighted_mean(reference, weights)),
        weights,
    )
    return axis if covariance >= 0 else -axis


@register
class Mca:
    """ACM pondérée par la population sur des variables en quantiles."""

    name = "mca"
    label = "ACM (terciles)"
    bootstrap = False
    default_params: Mapping[str, Any] = {
        "n_components": 2,
        "n_bins": 3,
        "y_weights": {"bac5": 5, "bac3": 3, "bac2": 2, "bac": 1, "cap": -1, "brevet": -2,
                      "certif_aucun": -3},
        "orientation": {"right_pcs": "23", "up_group": "3"},
        "candidate_pcs_level": 1,
        "range": [-10, 10],
    }

    def compute(
        self, pcs: Sequence[Pcs], election: Election | None, params: Mapping[str, Any]
    ) -> Result:
        """Coordonnées issues des deux premières dimensions de l'ACM."""
        import prince  # import différé : prince charge altair, long à importer

        p = effective_params(self.default_params, params)
        n_bins = int(p["n_bins"])
        if len(pcs) < 3 or n_bins < 2:
            raise ValueError("ACM : au moins 3 PCS et 2 classes sont nécessaires")
        weights = np.array([q.population for q in pcs], dtype=float)
        if np.any(weights <= 0):
            raise ValueError("ACM : chaque PCS doit avoir une population strictement positive")
        codes = [q.code for q in pcs]
        diplome = y_scores(pcs, p["y_weights"])
        variables = {
            "patrimoine": np.array([q.patrimoine_keur for q in pcs], dtype=float),
            "niveau_vie": np.array([q.niveau_vie_mensuel_eur for q in pcs], dtype=float),
            "diplome": diplome,
        }
        columns: dict[str, np.ndarray] = {}
        for var, values in variables.items():
            bins = quantile_bins(values, codes, n_bins)
            for b in range(n_bins):
                if np.any(bins == b):
                    columns[f"{var}_{b + 1}"] = np.where(bins == b, weights, 0.0)
        table = pd.DataFrame(columns, index=codes)

        mca = prince.MCA(n_components=max(2, int(p["n_components"])), one_hot=False,
                         engine="scipy")
        coords = mca.fit(table).row_coordinates(table).to_numpy()[:, :2]

        orientation = p.get("orientation") or {}
        cx, cy = _weighted_mean(coords[:, 0], weights), _weighted_mean(coords[:, 1], weights)
        right = orientation.get("right_pcs")
        x_anchor = coords[codes.index(right), 0] - cx if right in codes else None
        up = np.array([q.group == orientation.get("up_group") for q in pcs])
        y_anchor = _weighted_mean(coords[up, 1], weights[up]) - cy if up.any() else None
        x_raw = _orient(coords[:, 0], x_anchor, x_scores(pcs), weights)
        y_raw = _orient(coords[:, 1], y_anchor, diplome, weights)

        lo, hi = p["range"]
        return assemble_result(
            self.name, p, pcs, minmax_coordinates(x_raw, lo, hi),
            minmax_coordinates(y_raw, lo, hi), election,
        )
