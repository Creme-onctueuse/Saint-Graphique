"""Méthode « espace_social » : volume et structure du capital (Bourdieu, *La Distinction*, 1979).

Axe vertical : volume du capital. Axe horizontal : structure du capital, du culturel (à gauche) à
l'économique (à droite). Ni l'un ni l'autre n'est l'axe « exploitation » ou « domination ».

Construction, à partir de ``data/pcs.json`` seul :

1. Capital économique : ``E = z(z(ln patrimoine) + z(ln niveau de vie))``. Le patrimoine et le
   niveau de vie comptent à parts égales. Le logarithme répond à l'asymétrie des montants : le
   patrimoine médian va de 32 à 1 532 k€, et les chefs d'entreprise tireraient sinon toute l'échelle
   à eux seuls (asymétrie pondérée sur les PCS actives : de 2,69 à -0,71 pour le patrimoine, de 1,07
   à 0,67 pour le niveau de vie). Il compare aussi des rapports plutôt que des écarts : 100 k€ de
   plus ne pèsent pas pareil à 30 k€ et à 1 500 k€.
2. Capital culturel : ``C = z(Σ poids[k] · part[k])``, les poids ``y_weights`` étant la durée
   théorique des études, en années par rapport au bac (bac+5 : 5 ; bac+3 ou +4 : 3,5 ; bac+2 : 2 ;
   bac : 0 ; CAP, BEP : -1 ; brevet : -3 ; certificat ou aucun diplôme : -4). Cette échelle est
   fixée a priori : elle n'est ni la pondération de ``ranks``, ni ajustée sur le graphique de Chris.
   Seuls ses écarts comptent, car les parts somment à 100.
3. ``z`` centre et réduit avec les poids de population : ``(v - m) / s``, où ``m`` et ``s`` sont la
   moyenne et l'écart-type pondérés. E et C ont ainsi la même dispersion avant d'être combinés.
4. Volume ``V = E + C``, structure ``S = E - C``, puis ``y = minmax(z(V))`` et ``x = minmax(z(S))``
   sur [-10, 10], comme ``continuous`` (z-score non pondéré, absorbé par la mise à l'échelle).

Retraités : ils gardent leurs propres valeurs, sans score imposé ni correction, mais n'entrent pas
dans ``m`` et ``s`` (échelle de référence calculée sur les 29 PCS actives). Leurs diplômes reflètent
leur génération plus que leur position : un point unique qui pèse un tiers de la population fixerait
sinon le zéro et la dispersion du capital culturel, et ce biais déformerait toute la carte. Ainsi
contenu, il reste visible sur leur seul point : à droite et bas, parce que peu diplômés. Ce point ne
dit donc pas que les retraités détiennent surtout un capital économique. Voir
``docs/methodologie.md`` pour la mesure de ce biais.

Le capital culturel n'est mesuré ici que par les titres scolaires, et le capital économique par deux
médianes : ni le capital culturel incorporé, ni le capital social de Bourdieu ne figurent dans ces
données. Portage navigateur : ``web/src/core/methods.ts`` (voir ``PARITY_METHODS``).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np

from pipeline.methods.base import assemble_result, effective_params, register
from pipeline.methods.scores import minmax_coordinates, y_scores, zscores
from pipeline.model import Election, Pcs, Result

#: PCS placée sans entrer dans l'échelle de référence (voir l'en-tête du module).
RETIRED_CODE = "7"
#: Durée théorique des études, en années par rapport au bac (copie de ``config/methods.yaml``).
STUDY_YEARS = {"bac5": 5, "bac3": 3.5, "bac2": 2, "bac": 0, "cap": -1, "brevet": -3,
               "certif_aucun": -4}


def weighted_zscores(
    values: Sequence[float] | np.ndarray, weights: Sequence[float] | np.ndarray
) -> np.ndarray:
    """Centre et réduit ``values`` avec la moyenne et l'écart-type pondérés par ``weights``.

    Un poids nul exclut la valeur de la référence, pas du résultat : elle reçoit son z-score
    sur l'échelle des autres. Une référence sans dispersion donne des zéros.
    """
    v = np.asarray(values, dtype=float)
    w = np.asarray(weights, dtype=float)
    if not np.all(np.isfinite(v)):
        raise ValueError("valeurs non finies")
    total = np.sum(w)
    if total <= 0:
        raise ValueError("poids total nul")
    mean = np.sum(w * v) / total
    sd = np.sqrt(np.sum(w * (v - mean) ** 2) / total)
    return np.zeros_like(v) if sd == 0 else (v - mean) / sd


def reference_weights(pcs: Sequence[Pcs]) -> np.ndarray:
    """Poids de l'échelle de référence : la population, nulle pour les retraités."""
    population = np.array([p.population for p in pcs], dtype=float)
    return np.where(np.array([p.code == RETIRED_CODE for p in pcs]), 0.0, population)


def capital_scores(
    pcs: Sequence[Pcs], y_weights: Mapping[str, float]
) -> tuple[np.ndarray, np.ndarray]:
    """Capital économique et capital culturel standardisés, dans l'ordre de ``pcs``."""
    for p in pcs:
        if p.patrimoine_keur <= 0 or p.niveau_vie_mensuel_eur <= 0:
            raise ValueError(f"PCS {p.code} : patrimoine ou niveau de vie nul, logarithme indéfini")
    weights = reference_weights(pcs)
    wealth = weighted_zscores(np.log([p.patrimoine_keur for p in pcs]), weights)
    living = weighted_zscores(np.log([p.niveau_vie_mensuel_eur for p in pcs]), weights)
    economic = weighted_zscores(wealth + living, weights)
    cultural = weighted_zscores(y_scores(pcs, y_weights), weights)
    return economic, cultural


@register
class EspaceSocial:
    """Volume et structure du capital, sur [-10, 10]."""

    name = "espace_social"
    label = "Espace social (Bourdieu)"
    bootstrap = True
    default_params: Mapping[str, Any] = {
        "y_weights": STUDY_YEARS,
        "retired_y_override": None,
        "candidate_pcs_level": 1,
        "range": [-10, 10],
    }

    def compute(
        self, pcs: Sequence[Pcs], election: Election | None, params: Mapping[str, Any]
    ) -> Result:
        """Coordonnées ; ``election=None`` pour la population seule."""
        p = effective_params(self.default_params, params)
        lo, hi = p["range"]
        economic, cultural = capital_scores(pcs, p["y_weights"])
        xs = minmax_coordinates(zscores(economic - cultural), lo, hi)
        ys = minmax_coordinates(zscores(economic + cultural), lo, hi)
        return assemble_result(self.name, p, pcs, xs, ys, election)
