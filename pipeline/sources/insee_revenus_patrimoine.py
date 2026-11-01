"""Niveau de vie et patrimoine brut médians par PCS de niveau 2.

**29 PCS actives** : table « Situation financière des ménages … en 2020-2021 », feuilles
« Ensemble », publiée sur nomenclature-pcs.fr (site détenu par l'Insee, Progedo, le Cnam-CEET et le
laboratoire Printemps ; source indiquée : Insee, enquête Revenus fiscaux et sociaux 2021 et
Patrimoine histoire de vie 2020-2021). Champ : personnes actives ayant déjà travaillé. Cette table
n'a pas été trouvée sur insee.fr, dont les tableaux s'arrêtent à 12 catégories pour le patrimoine.

**Retraités**, absents de cette table :

- niveau de vie : médiane publiée par l'Insee pour les retraités, ERFS 2021 (tableau TI02D) ;
- patrimoine : valeur CALCULÉE. L'Insee publie plusieurs catégories de retraités, sans ensemble.
  La médiane des ménages de retraités est estimée début 2024 par interpolation linéaire, à partir
  de leur répartition dans les déciles de patrimoine de HVP 2023-2024, puis ramenée à début 2021
  par le rapport des médianes de l'ensemble des ménages (HVP 2020-2021 / HVP 2023-2024). Les
  seuils des déciles encadrent avec certitude la médiane de 2024.
"""

from __future__ import annotations

import zipfile
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

from pipeline.sources import _nomenclature_pcs as portraits
from pipeline.sources._common import (
    ACTIVE_PCS_CODES,
    LICENCE_INSEE,
    PCS_CODES,
    RETIRED_CODE,
    cache_dir,
    download,
    file_meta,
    group_of,
    source_ref,
)
from pipeline.sources._tables import normalize_label, number, xlsx_rows

PORTRAIT_FILE = "DEC_POR_8.xls"

ERFS_PAGE = "https://www.insee.fr/fr/statistiques/7766291"
ERFS_ZIP_URL = "https://www.insee.fr/fr/statistiques/fichier/7766291/irsocerfs2021_dd2_excel.zip"
ERFS_ZIP = "irsocerfs2021_dd2_excel.zip"
HVP2024_PAGE = "https://www.insee.fr/fr/statistiques/8736842"
HVP2024_MONTANTS_URL = (
    "https://www.insee.fr/fr/statistiques/fichier/8736842/hvp_mtmoymed_patbrut_patnet.xlsx"
)
HVP2024_PROFIL_URL = "https://www.insee.fr/fr/statistiques/fichier/8736842/hvp_profil_menages.xlsx"
HVP2024_MONTANTS = "hvp_mtmoymed_patbrut_patnet.xlsx"
HVP2024_PROFIL = "hvp_profil_menages.xlsx"
HVP2021_PAGE = "https://www.insee.fr/fr/statistiques/8262352"
HVP2021_MONTANTS_URL = (
    "https://www.insee.fr/fr/statistiques/fichier/8262352/hvp_mtmoymed_patbrut_patnet_fr.xlsx"
)
HVP2021_MONTANTS = "hvp_mtmoymed_patbrut_patnet_fr.xlsx"

SOURCE_ID_PORTRAIT = "nomenclature_pcs_dec_por_8"
SOURCE_ID_ERFS = "insee_erfs2021_ti02d"
SOURCE_ID_HVP2024 = "insee_hvp2023_2024"
SOURCE_ID_HVP2021 = "insee_hvp2020_2021"

# Valeurs de ``niveau_vie_status`` et ``patrimoine_status`` (schemas/pcs.schema.json).
PUBLISHED = "published"
CALCULATED = "calculated"

HVP_RETRAITES: tuple[str, ...] = (
    "retraites anciens agriculteurs, artisans, commercants, chefs d'entreprise",
    "retraites anciens cadres ou professions liberales",
    "retraites anciennes professions intermediaires",
    "retraites anciens employes et ouvriers",
)


@dataclass(frozen=True)
class RetiredWealth:
    """Patrimoine brut médian des ménages de retraités, en k€, et les éléments de son calcul."""

    value_keur: float
    median_2024_keur: float
    low_2024_keur: float
    high_2024_keur: float
    all_2021_keur: float
    all_2024_keur: float
    age_60_69_2021_keur: float
    age_70_plus_2021_keur: float

    @property
    def low_keur(self) -> float:
        return self.low_2024_keur * self.all_2021_keur / self.all_2024_keur

    @property
    def high_keur(self) -> float:
        return self.high_2024_keur * self.all_2021_keur / self.all_2024_keur


def french(value: float) -> str:
    """Nombre à une décimale, avec virgule, pour un texte en français."""
    return f"{value:.1f}".replace(".", ",")


def portrait_values(
    sheets: Mapping[str, Sequence[Sequence[Any]]],
) -> dict[str, tuple[float, float]]:
    """Feuilles de ``DEC_POR_8`` -> ``{PCS : (niveau de vie mensuel, patrimoine en k€)}``.

    Colonnes : libellé, niveau de vie médian (euros), patrimoine brut médian (milliers d'euros),
    taux de pauvreté, taux de richesse.
    """
    values = portraits.values_by_pcs(sheets, [1, 2])
    missing = sorted(set(ACTIVE_PCS_CODES) - set(values))
    if missing:
        raise ValueError(f"PCS absentes de {PORTRAIT_FILE} : {missing}")
    return {code: (v[0], v[1]) for code, v in values.items()}


def parse_erfs_rows(rows: Iterable[Sequence[Any]]) -> dict[str, tuple[float | None, float | None]]:
    """Lignes d'un tableau TI02 -> ``{libellé normalisé : (moyenne, médiane) annuelles}``."""
    table: dict[str, tuple[float | None, float | None]] = {}
    for row in rows:
        cells = list(row) + [None] * 5
        label, effectif, moyenne, mediane = cells[0], cells[1], cells[3], cells[4]
        is_data = isinstance(effectif, int | float) or effectif == "ns"
        if label is None or not is_data:
            continue
        table[normalize_label(label)] = (number(moyenne), number(mediane))
    return table


def retired_niveau_vie(table: Mapping[str, tuple[float | None, float | None]]) -> float:
    """Niveau de vie mensuel médian des retraités (médiane annuelle publiée / 12)."""
    median = table["retraites"][1]
    if median is None:
        raise ValueError("Médiane des retraités manquante dans l'ERFS")
    return median / 12.0


def parse_hvp_profil(rows: Iterable[Sequence[Any]]) -> dict[str, dict[str, float]]:
    """Feuille « PCS » du profil -> ``{ligne : {catégorie : part (%)}}``, dans l'ordre publié.

    Chaque ligne décrit une tranche de patrimoine (ou l'ensemble des ménages).
    """
    header: list[str] | None = None
    table: dict[str, dict[str, float]] = {}
    for row in rows:
        if row and row[0] is None and any(isinstance(c, str) for c in row[1:]):
            header = [normalize_label(c) if c is not None else "" for c in row]
        elif header and row and row[0] is not None:
            shares = {
                name: float(value)
                for name, value in zip(header, row, strict=False)
                if name and isinstance(value, int | float)
            }
            if shares:
                table[normalize_label(row[0])] = shares
    if "ensemble" not in table:
        raise ValueError("Ligne « Ensemble » introuvable dans le profil des ménages")
    return table


def parse_hvp_seuils(rows: Iterable[Sequence[Any]]) -> list[float]:
    """Feuille « AGE » des montants 2023-2024 -> seuils D1 à D9 du patrimoine brut, tous ménages.

    Première ligne « Ensemble » (le patrimoine net vient ensuite) ; colonnes : libellé, moyenne,
    D1, D2, D3, D4, médiane, D6, D7, D8, D9.
    """
    for row in rows:
        if row and row[0] is not None and normalize_label(row[0]) == "ensemble":
            seuils = [number(c) for c in list(row)[2:11]]
            if len(seuils) != 9 or None in seuils or seuils != sorted(seuils):
                raise ValueError(f"Seuils de déciles invalides : {seuils}")
            return [float(c) for c in seuils if c is not None]
    raise ValueError("Ligne « Ensemble » introuvable dans les montants par âge")


def median_from_bands(
    shares: Sequence[float], seuils: Sequence[float]
) -> tuple[float, float, float]:
    """Médiane d'un sous-groupe réparti dans les 10 tranches de déciles de l'ensemble.

    Chaque tranche contient le même nombre de ménages : ``shares[i]``, la part (%) du sous-groupe
    dans la tranche i, est donc proportionnelle à son effectif dans cette tranche. La médiane est
    interpolée linéairement dans la tranche qui la contient. Renvoie ``(médiane, borne basse,
    borne haute)`` ; les bornes, seuils publiés, encadrent la vraie médiane avec certitude.
    """
    if len(shares) != 10 or len(seuils) != 9:
        raise ValueError("10 tranches et 9 seuils attendus")
    half = sum(shares) / 2.0
    cumulative = 0.0
    for index, share in enumerate(shares):
        if cumulative + share >= half and share > 0:
            if index in (0, 9):
                raise ValueError("Médiane dans une tranche extrême, sans borne publiée")
            low, high = seuils[index - 1], seuils[index]
            return low + (half - cumulative) / share * (high - low), low, high
        cumulative += share
    raise ValueError("Répartition vide")


def retired_median(
    profil: Mapping[str, Mapping[str, float]], seuils: Sequence[float]
) -> tuple[float, float, float]:
    """Médiane estimée du patrimoine brut des ménages de retraités, début 2024 (4 catégories)."""
    bands = [key for key in profil if key != "ensemble"][:10]
    if not (bands[0].startswith("inferieur au 1") and bands[9].startswith("superieur au 9")):
        raise ValueError(f"Tranches de déciles inattendues : {bands}")
    shares = [sum(profil[band][label] for label in HVP_RETRAITES) for band in bands]
    return median_from_bands(shares, seuils)


def parse_hvp2021_medians(rows: Iterable[Sequence[Any]]) -> dict[str, float]:
    """Feuille « AGE » des montants 2020-2021 -> ``{ligne : médiane brute}``.

    Colonnes : libellé, moyenne brute, médiane brute, moyenne nette, médiane nette.
    """
    medians: dict[str, float] = {}
    for row in rows:
        if not row or not isinstance(row[0], str) or len(row) < 3:
            continue
        median = number(row[2])
        if median is not None:
            medians[normalize_label(row[0])] = median
    return medians


def retired_wealth_from(
    profil: Mapping[str, Mapping[str, float]],
    seuils: Sequence[float],
    medians_2021: Mapping[str, float],
) -> RetiredWealth:
    """Calcule le patrimoine des retraités et conserve les repères publiés."""
    median, low, high = retired_median(profil, seuils)
    all_2024 = seuils[4]  # D5 de l'ensemble des ménages
    all_2021 = medians_2021["total"]
    return RetiredWealth(
        value_keur=median * all_2021 / all_2024 / 1000.0,
        median_2024_keur=median / 1000.0,
        low_2024_keur=low / 1000.0,
        high_2024_keur=high / 1000.0,
        all_2021_keur=all_2021 / 1000.0,
        all_2024_keur=all_2024 / 1000.0,
        age_60_69_2021_keur=medians_2021["de 60 a 69 ans"] / 1000.0,
        age_70_plus_2021_keur=medians_2021["70 ans ou plus"] / 1000.0,
    )


def retired_note(retired: RetiredWealth) -> str:
    return (
        "Niveau de vie : médiane publiée par l'Insee pour les retraités (ERFS 2021). Patrimoine "
        "CALCULÉ, non publié par l'Insee : médiane des ménages de retraités estimée à "
        f"{french(retired.median_2024_keur)} k€ début 2024 par interpolation dans les déciles de "
        f"HVP 2023-2024 (entre {french(retired.low_2024_keur)} et "
        f"{french(retired.high_2024_keur)} k€), ramenée à début 2021 par le rapport des "
        f"médianes de l'ensemble des ménages ({french(retired.all_2021_keur)} / "
        f"{french(retired.all_2024_keur)})."
    )


ACTIVE_NOTE = (
    "Niveau de vie et patrimoine : médianes publiées pour cette PCS, situation financière "
    "2020-2021 (source indiquée : Insee, ERFS 2021 et HVP 2020-2021 ; publication : "
    "nomenclature-pcs.fr), pour les personnes actives ayant déjà travaillé."
)


def combine(
    values: Mapping[str, tuple[float, float]], niveau_vie_retraites: float, retired: RetiredWealth
) -> pd.DataFrame:
    """Une ligne par PCS (30), dans l'ordre de la nomenclature, avec statuts et notes."""
    records: list[dict[str, Any]] = []
    for code in PCS_CODES:
        if code == RETIRED_CODE:
            nv, pa = niveau_vie_retraites, retired.value_keur
            status, note = CALCULATED, retired_note(retired)
        else:
            nv, pa = values[code]
            status, note = PUBLISHED, ACTIVE_NOTE
        records.append(
            {
                "code": code,
                "group": group_of(code),
                "niveau_vie_mensuel_eur": nv,
                "patrimoine_keur": pa,
                "niveau_vie_status": PUBLISHED,
                "patrimoine_status": status,
                "notes": note,
            }
        )
    return pd.DataFrame(records)


def _erfs_member(zip_path: Path, table: str) -> bytes:
    """Contenu du tableau ``table`` (ex. ``ti02d``) du zip ERFS, sans tenir compte de la casse."""
    with zipfile.ZipFile(zip_path) as archive:
        for name in archive.namelist():
            if name.lower().endswith(f"_{table}.xlsx"):
                return archive.read(name)
    raise FileNotFoundError(f"{table} absent de {zip_path}")


def _paths() -> dict[str, Path]:
    return {
        "erfs": cache_dir("insee_erfs2021") / ERFS_ZIP,
        "montants2024": cache_dir("insee_hvp2023_2024") / HVP2024_MONTANTS,
        "profil2024": cache_dir("insee_hvp2023_2024") / HVP2024_PROFIL,
        "montants2021": cache_dir("insee_hvp2020_2021") / HVP2021_MONTANTS,
    }


def fetch(force: bool = False) -> None:
    """Télécharge les tableaux dans le cache (quelques centaines de Ko)."""
    portraits.fetch(PORTRAIT_FILE, force=force)
    paths = _paths()
    download(ERFS_ZIP_URL, paths["erfs"], force=force)
    download(HVP2024_MONTANTS_URL, paths["montants2024"], force=force)
    download(HVP2024_PROFIL_URL, paths["profil2024"], force=force)
    download(HVP2021_MONTANTS_URL, paths["montants2021"], force=force)


def retired_wealth() -> RetiredWealth:
    """Patrimoine des retraités, à partir des fichiers en cache."""
    paths = _paths()
    return retired_wealth_from(
        parse_hvp_profil(xlsx_rows(paths["profil2024"], "PCS")),
        parse_hvp_seuils(xlsx_rows(paths["montants2024"], "AGE")),
        parse_hvp2021_medians(xlsx_rows(paths["montants2021"], "AGE")),
    )


def household_shares() -> dict[str, float]:
    """Part (%) de chaque catégorie dans l'ensemble des ménages, HVP 2023-2024."""
    return parse_hvp_profil(xlsx_rows(_paths()["profil2024"], "PCS"))["ensemble"]


def load() -> pd.DataFrame:
    """DataFrame par PCS : niveau de vie, patrimoine, statuts et notes."""
    fetch()
    values = portrait_values(portraits.read_book(portraits.path_of(PORTRAIT_FILE)))
    erfs = parse_erfs_rows(xlsx_rows(_erfs_member(_paths()["erfs"], "ti02d"), max_col=5))
    return combine(values, retired_niveau_vie(erfs), retired_wealth())


def sources() -> list[dict[str, str]]:
    """Références avec date d'accès réelle."""
    paths = _paths()
    return [
        source_ref(
            SOURCE_ID_PORTRAIT,
            "Situation financière des ménages en 2020-2021, Portraits des six groupes "
            "socioprofessionnels, feuilles Ensemble",
            portraits.url_of(PORTRAIT_FILE),
            portraits.accessed(PORTRAIT_FILE),
            publisher=portraits.PUBLISHER,
            license=portraits.REUSE,
            notes=(
                "Source indiquée par le fichier : Insee, enquête Revenus fiscaux et sociaux 2021 "
                "et Patrimoine histoire de vie, 2020-2021. Médianes pour les 29 PCS actives. "
                "Champ : France hors Mayotte, personnes vivant en logement ordinaire, actives "
                "ayant déjà travaillé (ménage au revenu positif en 2021 et dont la personne de "
                f"référence n'est pas étudiante pour le niveau de vie). Page : "
                f"{portraits.PORTRAITS_PAGE}."
            ),
        ),
        source_ref(
            SOURCE_ID_ERFS,
            "Niveau de vie et revenu annuel des individus en 2021, ERFS, Insee Résultats, "
            "tableau TI02D",
            ERFS_PAGE,
            file_meta(paths["erfs"]).get("accessed"),
            publisher="Insee-DGFiP-Cnaf-Cnav-CCMSA",
            license=LICENCE_INSEE,
            notes=(
                f"Fichier : {ERFS_ZIP_URL}. Ligne Retraités, médiane annuelle divisée par 12. "
                "Données 2021 provisoires selon l'Insee. Champ : individus de 15 ans ou plus, "
                "ménages ordinaires de France métropolitaine."
            ),
        ),
        source_ref(
            SOURCE_ID_HVP2024,
            "Patrimoine et endettement des ménages en 2024, enquête Histoire de vie et "
            "Patrimoine 2023-2024, Insee Résultats",
            HVP2024_PAGE,
            file_meta(paths["montants2024"]).get("accessed"),
            publisher="Insee",
            license=LICENCE_INSEE,
            notes=(
                f"Fichiers : {HVP2024_MONTANTS_URL} (feuille AGE) et {HVP2024_PROFIL_URL} (feuille "
                "PCS). Sert au calcul du patrimoine des retraités et aux poids de ménages de la "
                "composition des retraités."
            ),
        ),
        source_ref(
            SOURCE_ID_HVP2021,
            "Patrimoine et endettement des ménages en 2021, enquête Histoire de vie et "
            "Patrimoine 2020-2021, Insee Résultats",
            HVP2021_PAGE,
            file_meta(paths["montants2021"]).get("accessed"),
            publisher="Insee",
            license=LICENCE_INSEE,
            notes=(
                f"Fichier : {HVP2021_MONTANTS_URL} (feuille AGE, médiane de l'ensemble des "
                "ménages), et tableaux de composition du patrimoine et de taux de détention par "
                "catégorie de la personne de référence."
            ),
        ),
    ]
