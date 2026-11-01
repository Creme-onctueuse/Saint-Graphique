"""Méthode « mca » : analyse des correspondances multiples (ACM) avec prince.

Utilise le score diplôme de ``ranks_chris_v1``. Algorithme reconstruit par JnthnBS
(https://github.com/JnthnBS/saint-graphique), réimplémenté
sans copie de code, d'après sa description et la lecture de son implémentation.
Saint-Graphique original : Chris et la PaduTeam.

Construction (choix documentés) :

1. Variables : chaque PCS est décrite par trois variables catégorielles en ``n_bins`` classes
   (terciles par défaut) : patrimoine, niveau de vie et score diplôme (poids ``y_weights``,
   sans forçage des retraités). Les classes sont des quantiles sur les N PCS (N/3 PCS par
   tercile, et des valeurs égales restent dans la même classe). Elles ne sont pas calculées sur
   la population : pondérées, elles seraient écrasées par les retraités, qui forment une seule
   PCS mais un tiers des effectifs.
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

Limites, constatées en terciles sur les données 2022 de la reproduction JnthnBS et vérifiées par
le test local ``test_methods_reference.py`` (à revérifier sur les données définitives, ce jeu
encodant les retraités par 180 % de CAP) :

- les trois variables sont fortement liées (Spearman de 0,72 à 0,80 sur les 30 PCS) : la
  dimension 1 (≈ 40 % de l'inertie brute) mesure donc surtout le volume de capital (corrélation
  pondérée ≈ 0,95 avec la somme des trois classes) ;
- la dimension 2 (≈ 28 %) oppose surtout les bas patrimoines et bas niveaux de vie aux profils
  moyens et ne suit pas le diplôme (corrélation pondérée ≈ 0,15). L'effet d'arche n'est que
  partiel : les profils moyens sont sous les deux extrêmes, mais une parabole de x n'explique
  qu'un tiers de la variance pondérée de y ;
- l'orientation n'est donc garantie que par rapport au barycentre : les chefs d'entreprise sont
  bien à l'extrême droite, mais les cadres (y ≈ -0,2), s'ils dépassent le barycentre (≈ -3,6),
  restent au milieu de l'axe, loin sous les PCS de profil bas/bas/bas (≈ +10), surtout ouvrières ;
- les PCS de même profil se superposent exactement : les six PCS de cadres et les chefs
  d'entreprise (haut/haut/haut), six PCS d'ouvriers et les services aux particuliers
  (bas/bas/bas). ``n_bins: 5`` donne un découpage plus fin.

La méthode est exploratoire et ne prétend pas reproduire le graphique de Chris.
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


def quantile_bins(values: np.ndarray, n_bins: int) -> np.ndarray:
    """Classe 0..n_bins-1 de chaque élément : rang moyen (0..N-1) × n_bins // N.

    Sans ex æquo, les classes ont le même effectif. Des valeurs égales ont le même rang moyen,
    donc la même classe : les séparer selon leur code n'aurait aucun sens, or les sources donnent
    souvent un même patrimoine à toutes les PCS d'un groupe.
    """
    ranks = pd.Series(values).rank(method="average").to_numpy() - 1
    return (ranks * n_bins // len(values)).astype(np.int64)


def indicator_table(
    pcs: Sequence[Pcs], y_weights: Mapping[str, float], n_bins: int
) -> pd.DataFrame:
    """Tableau disjonctif complet (0/1) : une ligne par PCS, une colonne par classe non vide."""
    variables = {
        "patrimoine": np.array([q.patrimoine_keur for q in pcs], dtype=float),
        "niveau_vie": np.array([q.niveau_vie_mensuel_eur for q in pcs], dtype=float),
        "diplome": y_scores(pcs, y_weights),
    }
    columns: dict[str, np.ndarray] = {}
    for variable, values in variables.items():
        bins = quantile_bins(values, n_bins)
        for b in range(n_bins):
            if np.any(bins == b):
                columns[f"{variable}_{b + 1}"] = (bins == b).astype(float)
    return pd.DataFrame(columns, index=[q.code for q in pcs])


def fit_weighted_mca(indicator: pd.DataFrame, weights: np.ndarray, n_components: int = 2) -> Any:
    """ACM du tableau disjonctif pondéré par ``weights`` (modèle ``prince.MCA`` ajusté)."""
    import prince  # import différé : prince charge altair, long à importer

    model = prince.MCA(n_components=n_components, one_hot=False, engine="scipy")
    return model.fit(indicator.mul(weights, axis=0))


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
        p = effective_params(self.default_params, params)
        n_bins = int(p["n_bins"])
        if len(pcs) < 3 or n_bins < 2:
            raise ValueError("ACM : au moins 3 PCS et 2 classes sont nécessaires")
        weights = np.array([q.population for q in pcs], dtype=float)
        if np.any(weights <= 0):
            raise ValueError("ACM : chaque PCS doit avoir une population strictement positive")
        codes = [q.code for q in pcs]
        indicator = indicator_table(pcs, p["y_weights"], n_bins)
        model = fit_weighted_mca(indicator, weights, max(2, int(p["n_components"])))
        # Profils lus sur le tableau 0/1 : deux PCS de même profil ont des coordonnées identiques.
        coords = model.row_coordinates(indicator).to_numpy()[:, :2]

        orientation = p.get("orientation") or {}
        cx, cy = _weighted_mean(coords[:, 0], weights), _weighted_mean(coords[:, 1], weights)
        right = orientation.get("right_pcs")
        x_anchor = coords[codes.index(right), 0] - cx if right in codes else None
        up = np.array([q.group == orientation.get("up_group") for q in pcs])
        y_anchor = _weighted_mean(coords[up, 1], weights[up]) - cy if up.any() else None
        x_raw = _orient(coords[:, 0], x_anchor, x_scores(pcs), weights)
        y_raw = _orient(coords[:, 1], y_anchor, y_scores(pcs, p["y_weights"]), weights)

        lo, hi = p["range"]
        return assemble_result(
            self.name, p, pcs, minmax_coordinates(x_raw, lo, hi),
            minmax_coordinates(y_raw, lo, hi), election,
        )
