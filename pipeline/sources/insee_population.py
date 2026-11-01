"""Effectifs par PCS de niveau 2, France entière (hors Mayotte) — Insee, recensement 2022.

Source : fichier détail du recensement 2022 « Individus localisés à la région » (voir
``_rp2022_indreg``). Les tableaux détaillés communaux de 2022 ne donnent la catégorie
socioprofessionnelle qu'en 8 groupes (POP6, ``STAT_GSEC``) ; seul le fichier détail porte la
CS en 29 postes (``STAT_CS``) et permet aussi le croisement avec le diplôme.

Champ des 30 points :

- 29 PCS actives : personnes de 15 ans ou plus en emploi (CS actuelle) ou au chômage ayant déjà
  travaillé (CS antérieure), selon la PCS 2020 de niveau 2 (mêmes codes que ``config/pcs.yaml``) ;
- « 7 » : retraités ou préretraités (``TACT = 21``), quelle que soit leur ancienne CS.

``load_electorate()`` donne en plus les effectifs de 18 ans ou plus de nationalité française
par groupe 1..8 : approximation du corps électoral (inscrits) pour la conversion de Bayes.
"""

from __future__ import annotations

import pandas as pd

from pipeline.sources import _rp2022_indreg as rp
from pipeline.sources._common import PCS_CODES, group_of

REFERENCE_YEAR = 2022


def fetch(force: bool = False) -> None:
    """Télécharge le fichier détail (≈ 760 Mo, une fois) et calcule l'agrégat en cache."""
    rp.fetch(force=force)


def population_from_aggregate(agg: pd.DataFrame) -> pd.DataFrame:
    """Effectifs pondérés par code PCS (30 lignes, ordre de la nomenclature)."""
    pop = agg.groupby("pcs")["poids"].sum()
    missing = [c for c in PCS_CODES if c not in pop.index]
    if missing:
        raise ValueError(f"PCS absentes du recensement : {missing}")
    return pd.DataFrame(
        {
            "code": list(PCS_CODES),
            "group": [group_of(c) for c in PCS_CODES],
            "population": [float(pop[c]) for c in PCS_CODES],
        }
    )


def electorate_from_aggregate(agg: pd.DataFrame) -> pd.Series:
    """Effectifs de 18 ans ou plus, de nationalité française, par groupe ``'1'``..``'8'``."""
    sel = agg[(agg["adulte18"] == "1") & (agg["francais"] == "1")]
    groups = sel["pcs"].map(lambda c: "8" if c == "8" else group_of(str(c)))
    out = sel["poids"].groupby(groups).sum()
    out.index = out.index.astype(str)
    return out.reindex([str(g) for g in range(1, 9)], fill_value=0.0).rename("inscrits_proxy")


def load() -> pd.DataFrame:
    """DataFrame ``code, group, population`` (personnes, France hors Mayotte, RP 2022)."""
    return population_from_aggregate(rp.load_aggregate())


def load_electorate() -> pd.Series:
    """Proxy du corps électoral par groupe (Français de 18 ans ou plus, RP 2022)."""
    return electorate_from_aggregate(rp.load_aggregate())


def sources() -> list[dict[str, str]]:
    """Références avec date d'accès réelle."""
    return [rp.source()]
