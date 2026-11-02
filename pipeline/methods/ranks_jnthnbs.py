"""Méthode « ranks_jnthnbs » : rangs normalisés (méthode de Chris reconstruite par JnthnBS).

Algorithme reconstruit par JnthnBS (https://github.com/JnthnBS/saint-graphique), réimplémenté
sans copie de code, d'après sa description et la lecture de son implémentation.
Saint-Graphique original : Chris et la PaduTeam.

- x : score = patrimoine / niveau de vie × 100, classé par ordre décroissant (rang 1..N),
  puis x = -10 + 20/(N-1) · (N - rang), soit -10 + (20/29)·(30 - rang) pour N = 30 ;
- y : score = 5·bac5 + 3·bac3 + 2·bac2 + bac - cap - 2·brevet - 3·certif_aucun (``y_weights``),
  même normalisation par rang. Les retraités (code "7") reçoivent le score -180
  (``retired_y_override``) quelle que soit leur répartition de diplômes ;
- ex æquo : départage stable par code PCS (voir ``scores.rank_coordinates``) ;
- groupes, électorats et population : barycentres (voir ``base.assemble_result``).

L'exactitude par rapport à la reproduction de référence est vérifiée localement par
``pipeline/tests/test_methods_reference.py``. Ce test est ignoré quand ``research/`` est absent.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from pipeline.methods.base import assemble_result, effective_params, register
from pipeline.methods.scores import rank_coordinates, x_scores, y_scores
from pipeline.model import Election, Pcs, Result


@register
class RanksJnthnbs:
    """Rangs 1..N normalisés sur [-10, 10]."""

    name = "ranks_jnthnbs"
    label = "Rangs (reconstruction JnthnBS)"
    bootstrap = True
    default_params: Mapping[str, Any] = {
        "x_score": "patrimoine_over_niveau_vie",
        "y_weights": {"bac5": 5, "bac3": 3, "bac2": 2, "bac": 1, "cap": -1, "brevet": -2,
                      "certif_aucun": -3},
        "retired_y_override": {"code": "7", "score": -180},
        "candidate_pcs_level": 1,
        "range": [-10, 10],
    }

    def compute(
        self, pcs: Sequence[Pcs], election: Election | None, params: Mapping[str, Any]
    ) -> Result:
        """Coordonnées par rangs ; ``election=None`` pour la population seule."""
        p = effective_params(self.default_params, params)
        lo, hi = p["range"]
        codes = [q.code for q in pcs]
        xs = rank_coordinates(x_scores(pcs, p["x_score"]), codes, lo, hi)
        ys = rank_coordinates(
            y_scores(pcs, p["y_weights"], p["retired_y_override"]), codes, lo, hi
        )
        return assemble_result(self.name, p, pcs, xs, ys, election)
