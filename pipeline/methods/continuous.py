"""Méthode « continuous » : scores bruts → z-scores → min/max vers [-10, 10], sans rangs.

Dérivée de ``ranks_chris_v1``. Algorithme reconstruit par JnthnBS
(https://github.com/JnthnBS/saint-graphique), réimplémenté
sans copie de code, d'après sa description et la lecture de son implémentation.
Saint-Graphique original : Chris et la PaduTeam.

Mêmes scores que ``ranks_chris_v1`` (x : patrimoine / niveau de vie × 100 ; y : diplômes
pondérés), mais sans forçage des retraités par défaut (``retired_y_override: null``) : leur
répartition de diplômes est utilisée telle quelle. Chaque score est standardisé
(z = (s - moyenne) / écart-type, non pondéré, sur les N PCS) puis ramené linéairement sur
[-10, 10] : le minimum va en -10, le maximum en +10.

À la différence des rangs, les écarts entre PCS sont conservés : une PCS très atypique
(ex. les chefs d'entreprise en x) repousse les autres vers l'extrémité opposée.

Remarque : la mise à l'échelle min/max est affine, elle absorbe donc la standardisation. Les
coordonnées finales ne dépendent que des scores bruts. Les z-scores restent l'étape intermédiaire
documentée.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from pipeline.methods.base import assemble_result, effective_params, register
from pipeline.methods.scores import minmax_coordinates, x_scores, y_scores, zscores
from pipeline.model import Election, Pcs, Result


@register
class Continuous:
    """Valeurs continues standardisées, remises à l'échelle [-10, 10]."""

    name = "continuous"
    label = "Valeurs continues"
    bootstrap = True
    default_params: Mapping[str, Any] = {
        "x_score": "patrimoine_over_niveau_vie",
        "y_weights": {"bac5": 5, "bac3": 3, "bac2": 2, "bac": 1, "cap": -1, "brevet": -2,
                      "certif_aucun": -3},
        "retired_y_override": None,
        "candidate_pcs_level": 1,
        "range": [-10, 10],
    }

    def compute(
        self, pcs: Sequence[Pcs], election: Election | None, params: Mapping[str, Any]
    ) -> Result:
        """Coordonnées continues ; ``election=None`` pour la population seule."""
        p = effective_params(self.default_params, params)
        lo, hi = p["range"]
        zx = zscores(x_scores(pcs, p["x_score"]))
        zy = zscores(y_scores(pcs, p["y_weights"], p["retired_y_override"]))
        xs = minmax_coordinates(zx, lo, hi)
        ys = minmax_coordinates(zy, lo, hi)
        return assemble_result(self.name, p, pcs, xs, ys, election)
