"""Recensement de la population 2022 (Insee), fichier détail « Individus localisés à la région ».

Fichier partagé par ``insee_population`` (effectifs par PCS) et ``insee_diplomes`` (plus haut
diplôme par PCS). Le zip national (≈ 760 Mo, 17,5 millions d'individus pondérés par
``IPONDI``) est lu une seule fois par morceaux ; seul un petit agrégat est conservé :

    pcs × diplome7 × etud × adulte18 × francais -> somme des poids

Variables utilisées (dictionnaire : ``contenu_RP2022_indreg.pdf``) :

- ``STAT_CS`` : statut × catégorie socioprofessionnelle (PCS 2020, 29 postes) actuelle
  (1xx, personnes en emploi) ou antérieure (2xx, chômeurs ayant travaillé) ;
- ``TACT`` : type d'activité (21 = retraités ou préretraités) ;
- ``DIPL`` : diplôme le plus élevé (01-03, 11-19) ;
- ``ETUD`` : inscription dans un établissement d'enseignement (2 = non) ;
- ``AGEREV`` : âge en années révolues ; ``INAT`` : nationalité (11, 12 = Français) ;
- ``IPONDI`` : poids de l'individu.

Règles de classement (les 30 points du graphique) :

- PCS active ``cc`` si ``STAT_CS`` vaut ``1cc`` ou ``2cc`` (emploi ou chômage, CS actuelle ou
  ancienne ; convention Insee « population de 15 ans ou plus selon la CS ») ;
- « 7 » (retraités) si ``TACT = 21`` ;
- « 8 » sinon (élèves, étudiants, autres inactifs, chômeurs n'ayant jamais travaillé,
  CS indéterminée) : hors des 30 PCS, gardé pour les poids du corps électoral.
"""

from __future__ import annotations

import zipfile
from pathlib import Path

import pandas as pd

from pipeline.sources._common import (
    ACTIVE_PCS_CODES,
    LICENCE_INSEE,
    RETIRED_CODE,
    cache_dir,
    download,
    file_meta,
    source_ref,
    write_meta,
)

PAGE_URL = "https://www.insee.fr/fr/statistiques/8590183"
ZIP_URL = "https://www.insee.fr/fr/statistiques/fichier/8590183/RP2022_indreg.zip"
DOC_URL = "https://www.insee.fr/fr/statistiques/fichier/8590183/contenu_RP2022_indreg.pdf"
SUBDIR = "insee_rp2022_indreg"
ZIP_NAME = "RP2022_indreg.zip"
AGG_NAME = "agregat_pcs_diplome.csv"
MEMBER = "FD_INDREG_2022.csv"


def zip_path() -> Path:
    """Chemin du zip national dans le cache (hors dépôt)."""
    return cache_dir(SUBDIR) / ZIP_NAME


def agg_path() -> Path:
    """Chemin de l'agrégat (quelques centaines de lignes) dans le cache."""
    return cache_dir(SUBDIR) / AGG_NAME

USECOLS = ["AGEREV", "DIPL", "ETUD", "INAT", "IPONDI", "STAT_CS", "TACT"]
OTHER_CODE = "8"

#: DIPL (RP 2022) -> catégorie du score de diplôme.
DIPL_TO_KEY: dict[str, str] = {
    "01": "certif_aucun",  # pas de scolarité ou arrêt avant la fin du primaire
    "02": "certif_aucun",  # aucun diplôme, scolarité jusqu'à la fin du primaire / avant le collège
    "03": "certif_aucun",  # aucun diplôme, scolarité jusqu'à la fin du collège ou au-delà
    "11": "certif_aucun",  # CEP
    "12": "brevet",        # BEPC, brevet élémentaire, brevet des collèges, DNB
    "13": "cap",           # CAP, BEP ou équivalent
    "14": "bac",           # bac général ou technologique, brevet supérieur, DAEU...
    "15": "bac",           # bac professionnel, brevet professionnel / de technicien...
    "16": "bac2",          # BTS, DUT, Deug, Deust, bac+2 santé-social
    "17": "bac3",          # licence, licence pro, maîtrise, bac+3 ou bac+4
    "18": "bac5",          # master, DEA, DESS, grande école bac+5, doctorat de santé
    "19": "bac5",          # doctorat de recherche
}

SOURCE = source_ref(
    "insee_rp2022_fd_indreg",
    "Recensement de la population 2022 — Fichier détail « Individus localisés à la région »",
    PAGE_URL,
    None,
    publisher="Insee",
    license=LICENCE_INSEE,
    notes=(
        f"Zip national {ZIP_URL} (France hors Mayotte, exploitation complémentaire, "
        "pondération IPONDI). Dictionnaire des variables : " + DOC_URL
    ),
)


def classify(stat_cs: pd.Series, tact: pd.Series) -> pd.Series:
    """Code des 30 PCS (``'10'``…``'69'``, ``'7'``) ou ``'8'`` (hors champ) par individu."""
    stat_cs = stat_cs.astype("string").fillna("")
    tact = tact.astype("string").fillna("")
    sub = stat_cs.str.slice(1, 3)
    active = stat_cs.str.slice(0, 1).isin(["1", "2"]) & sub.isin(ACTIVE_PCS_CODES)
    out = pd.Series(OTHER_CODE, index=stat_cs.index, dtype="string")
    out = out.mask(tact == "21", RETIRED_CODE)
    out = out.mask(active, sub)
    return out


def aggregate_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Agrège un morceau du fichier détail (colonnes ``USECOLS``)."""
    age = pd.to_numeric(df["AGEREV"], errors="coerce")
    df = df.loc[age >= 15].copy()
    age = age.loc[df.index]
    out = pd.DataFrame(
        {
            "pcs": classify(df["STAT_CS"], df["TACT"]),
            "diplome": df["DIPL"].astype("string").map(DIPL_TO_KEY).fillna("inconnu"),
            "etud": df["ETUD"].astype("string").fillna(""),
            "adulte18": (age >= 18).map({True: "1", False: "0"}),
            "francais": df["INAT"].astype("string").isin(["11", "12"]).map({True: "1", False: "0"}),
            "poids": pd.to_numeric(df["IPONDI"], errors="coerce").fillna(0.0),
        }
    )
    keys = ["pcs", "diplome", "etud", "adulte18", "francais"]
    return out.groupby(keys, as_index=False, observed=True)["poids"].sum()


def aggregate_zip(path: Path, chunksize: int = 1_000_000) -> pd.DataFrame:
    """Lit le fichier détail par morceaux et renvoie l'agrégat complet."""
    parts: list[pd.DataFrame] = []
    with zipfile.ZipFile(path) as zf, zf.open(MEMBER) as fh:
        reader = pd.read_csv(
            fh,
            sep=";",
            usecols=USECOLS,
            dtype={c: "string" for c in USECOLS if c != "IPONDI"} | {"IPONDI": "float64"},
            chunksize=chunksize,
            encoding="utf-8",
        )
        for chunk in reader:
            parts.append(aggregate_frame(chunk))
    agg = pd.concat(parts, ignore_index=True)
    keys = ["pcs", "diplome", "etud", "adulte18", "francais"]
    return agg.groupby(keys, as_index=False, observed=True)["poids"].sum()


def fetch(force: bool = False) -> Path:
    """Télécharge le zip (si absent) et calcule l'agrégat (si absent ou ``force``).

    Le zip (≈ 760 Mo) reste dans le cache hors dépôt pour permettre un recalcul ; il peut être
    supprimé sans risque une fois l'agrégat produit (il sera retéléchargé au besoin).
    """
    out = agg_path()
    if out.exists() and not force:
        return out
    raw = download(ZIP_URL, zip_path())
    agg = aggregate_zip(raw)
    tmp = out.with_name(out.name + ".part")
    agg.to_csv(tmp, index=False, encoding="utf-8")
    tmp.replace(out)
    write_meta(out, ZIP_URL, file_meta(raw).get("accessed"))
    return out


def load_aggregate() -> pd.DataFrame:
    """Agrégat en cache (``fetch()`` le produit au besoin)."""
    path = fetch()
    return pd.read_csv(
        path,
        dtype={"pcs": "string", "diplome": "string", "etud": "string",
               "adulte18": "string", "francais": "string", "poids": "float64"},
    )


def source() -> dict[str, str]:
    """Référence de source avec la date d'accès réelle du fichier téléchargé."""
    ref = dict(SOURCE)
    for path in (agg_path(), zip_path()):
        accessed = file_meta(path).get("accessed") if path.exists() else None
        if accessed:
            ref["accessed"] = accessed
            break
    return ref
