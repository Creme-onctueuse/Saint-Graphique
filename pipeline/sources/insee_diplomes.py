"""Répartition du plus haut diplôme par PCS de niveau 2 — Insee, recensement 2022.

Même source que ``insee_population`` (fichier détail « Individus localisés à la région »,
variable ``DIPL``). Aucun tableau détaillé agrégé ne croise le diplôme et la CS en 29 postes
(le tableau FOR2 ne croise le diplôme qu'avec le sexe et l'âge), d'où le recours au fichier
détail.

Champ : personnes de 15 ans ou plus non inscrites dans un établissement d'enseignement
(``ETUD = 2``, convention Insee « population non scolarisée »), classées dans les 30 PCS.

Correspondance ``DIPL`` -> catégories du score de diplôme :

- ``certif_aucun`` : 01, 02, 03 (aucun diplôme) et 11 (CEP) ;
- ``brevet`` : 12 (BEPC, brevet des collèges, DNB) ;
- ``cap`` : 13 (CAP, BEP) ;
- ``bac`` : 14 (bac général ou technologique) et 15 (bac professionnel, BP, BT) ;
- ``bac2`` : 16 ; ``bac3`` : 17 (bac+3 ou bac+4) ; ``bac5`` : 18 et 19 (bac+5, doctorats).
"""

from __future__ import annotations

import pandas as pd

from pipeline.sources import _rp2022_indreg as rp
from pipeline.sources._common import DIPLOMA_KEYS, PCS_CODES

REFERENCE_YEAR = 2022
SOURCES = [rp.SOURCE]


def fetch(force: bool = False) -> None:
    """Télécharge le fichier détail (une fois) et calcule l'agrégat en cache."""
    rp.fetch(force=force)


def diplomas_from_aggregate(agg: pd.DataFrame) -> pd.DataFrame:
    """Parts (%) des 7 catégories de diplôme par PCS, parmi les non-scolarisés."""
    sel = agg[(agg["etud"] == "2") & agg["diplome"].isin(DIPLOMA_KEYS)]
    table = sel.pivot_table(
        index="pcs", columns="diplome", values="poids", aggfunc="sum", fill_value=0.0
    )
    table = table.reindex(index=list(PCS_CODES), columns=list(DIPLOMA_KEYS), fill_value=0.0)
    totals = table.sum(axis=1)
    if (totals <= 0).any():
        raise ValueError(f"PCS sans effectif diplômé : {list(totals[totals <= 0].index)}")
    shares = table.div(totals, axis=0) * 100.0
    shares.index.name = "code"
    return shares.reset_index()


def load() -> pd.DataFrame:
    """DataFrame ``code, bac5, bac3, bac2, bac, cap, brevet, certif_aucun`` (en %, somme 100)."""
    return diplomas_from_aggregate(rp.load_aggregate())


def sources() -> list[dict[str, str]]:
    """Références avec date d'accès réelle."""
    return [rp.source()]
