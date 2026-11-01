"""Niveau de vie et patrimoine par PCS — Insee (ERFS 2022, enquête HVP 2023-2024).

Ce que l'Insee publie réellement, et ce qui est calculé ici :

**Niveau de vie** (ERFS 2022, tableaux TI02D et TI02C, individus de 15 ans ou plus selon leur
propre CS, France métropolitaine) :

- 25 des 30 PCS ont une valeur publiée à leur niveau ;
- 10, 21, 22, 23 : l'Insee ne publie qu'une ligne commune ; cette valeur leur est appliquée
  (IMPUTATION : ce n'est pas une donnée Insee à ce niveau) ;
- 44 (ministres du culte) : l'Insee publie « ns » (non significatif) ; la valeur du groupe
  « Professions intermédiaires » est appliquée à défaut (IMPUTATION).

**Patrimoine brut** (enquête Histoire de vie et Patrimoine 2023-2024, ménages selon la CS de la
personne de référence, France hors Mayotte) : l'Insee ne publie que 12 catégories, jamais les
29 postes. Aucune source primaire en accès libre trouvée au niveau 2.

- 10 et 31 : catégorie publiée équivalente (mais pour le ménage, pas pour l'individu) ;
- 21-23, 33-38, 42-48, 52-56, 62-69 : valeur de la catégorie appliquée à toutes ses PCS
  (IMPUTATION) ;
- 7 : l'Insee publie 4 catégories de retraités, sans ensemble. Leur médiane commune est estimée
  par interpolation linéaire à partir de leur répartition dans les déciles de patrimoine et des
  seuils de ces déciles (CALCUL). Elle se situe avec certitude entre les deux seuils encadrants.

Conséquence à garder en tête : à l'intérieur d'une catégorie, le patrimoine est constant ; le
classement du ratio patrimoine / niveau de vie n'y dépend donc que du niveau de vie, et il va à
l'inverse de celui-ci. Cet ordre interne est un effet de l'imputation.

Les médianes sont retenues pour les deux variables : statistique de référence de l'Insee, peu
sensible aux très hauts patrimoines, elle décrit mieux un membre typique d'une PCS. Les moyennes
publiées restent disponibles dans le DataFrame renvoyé par ``load()``.
"""

from __future__ import annotations

import io
import re
import unicodedata
import zipfile
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any

import openpyxl
import pandas as pd

from pipeline.sources._common import (
    LICENCE_INSEE,
    PCS_CODES,
    cache_dir,
    download,
    file_meta,
    group_of,
    source_ref,
)

REFERENCE_YEAR_NIVEAU_VIE = 2022
REFERENCE_YEAR_PATRIMOINE = 2024

ERFS_PAGE = "https://www.insee.fr/fr/statistiques/8278900"
ERFS_ZIP_URL = "https://www.insee.fr/fr/statistiques/fichier/8278900/irsocerfs2022_dd2_excel.zip"
ERFS_ZIP = "irsocerfs2022_dd2_excel.zip"
HVP_PAGE = "https://www.insee.fr/fr/statistiques/8736842"
HVP_MONTANTS_URL = (
    "https://www.insee.fr/fr/statistiques/fichier/8736842/hvp_mtmoymed_patbrut_patnet.xlsx"
)
HVP_PROFIL_URL = "https://www.insee.fr/fr/statistiques/fichier/8736842/hvp_profil_menages.xlsx"
HVP_MONTANTS = "hvp_mtmoymed_patbrut_patnet.xlsx"
HVP_PROFIL = "hvp_profil_menages.xlsx"

SOURCE_ID_ERFS = "insee_erfs2022_ti02"
SOURCE_ID_HVP = "insee_hvp2023_2024"

# Statuts d'une valeur.
PUBLIE = "publie"  # publié par l'Insee au niveau de cette PCS
PUBLIE_MENAGE = "publie_menage"  # catégorie équivalente publiée, mais pour le ménage
IMPUTE = "impute"  # valeur d'un agrégat appliquée à la PCS : pas une donnée Insee à ce niveau
CALCULE = "calcule"  # combinaison arithmétique de valeurs publiées

#: PCS -> début du libellé normalisé de sa ligne dans TI02D.
ERFS_LABELS: dict[str, str] = {
    "31": "professions liberales",
    "33": "cadres de la fonction publique",
    "34": "professeurs et professions scientifiques superieures",
    "35": "professions de l'information, des arts et des spectacles",
    "37": "cadres administratifs et commerciaux d'entreprise",
    "38": "ingenieurs et cadres techniques d'entreprise",
    "42": "professions de l'enseignement primaire et professionnel",
    "43": "professions intermediaires de la sante et du travail social",
    "44": "ministres du culte et religieux consacres",
    "45": "professions intermediaires de la fonction publique",
    "46": "professions intermediaires administratives et commerciales",
    "47": "techniciens",
    "48": "agents de maitrise",
    "52": "employes administratifs de la fonction publique",
    "53": "policiers, militaires, pompiers",
    "54": "employes administratifs d'entreprise",
    "55": "employes de commerce",
    "56": "personnels des services directs aux particuliers",
    "62": "ouvriers qualifies de type industriel",
    "63": "ouvriers qualifies de type artisanal",
    "64": "conducteurs de vehicules de transport",
    "65": "conducteurs d'engins",
    "67": "ouvriers peu qualifies de type industriel",
    "68": "ouvriers peu qualifies de type artisanal",
    "69": "ouvriers agricoles",
    "7": "retraites",
}
ERFS_INDEPENDANTS_CODES = ("10", "21", "22", "23")
ERFS_INDEPENDANTS_LABEL = "agriculteurs exploitants"
ERFS_GROUP4_LABEL = "professions intermediaires"

#: Catégorie HVP (libellé normalisé) -> PCS rattachées.
HVP_CATEGORIES: dict[str, tuple[str, ...]] = {
    "agriculteurs": ("10",),
    "artisans, commercants et chefs d'entreprise": ("21", "22", "23"),
    "professions liberales": ("31",),
    "cadres (autre que professions liberales)": ("33", "34", "35", "37", "38"),
    "professions intermediaires": ("42", "43", "44", "45", "46", "47", "48"),
    "employes": ("52", "53", "54", "55", "56"),
    "ouvriers": ("62", "63", "64", "65", "67", "68", "69"),
}
#: Libellés de ces catégories tels que publiés, pour les notes.
HVP_LABELS: dict[str, str] = {
    "agriculteurs": "Agriculteurs",
    "artisans, commercants et chefs d'entreprise": "Artisans, commerçants et chefs d'entreprise",
    "professions liberales": "Professions libérales",
    "cadres (autre que professions liberales)": "Cadres (autre que professions libérales)",
    "professions intermediaires": "Professions intermédiaires",
    "employes": "Employés",
    "ouvriers": "Ouvriers",
}
HVP_RETRAITES: tuple[str, ...] = (
    "retraites anciens agriculteurs, artisans, commercants, chefs d'entreprise",
    "retraites anciens cadres ou professions liberales",
    "retraites anciennes professions intermediaires",
    "retraites anciens employes et ouvriers",
)


def normalize_label(text: Any) -> str:
    """Libellé sans accents, en minuscules, sans renvoi de note ni préfixe « dont : »."""
    s = unicodedata.normalize("NFKD", str(text))
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.replace("’", "'").lower()
    s = re.sub(r"^\s*dont\s*:\s*", "", s)
    s = re.sub(r"\(\d+\)", "", s)
    return re.sub(r"\s+", " ", s).strip()


def _number(value: Any) -> float | None:
    return float(value) if isinstance(value, int | float) else None


def _sheet_rows(
    source: Path | bytes, sheet: str | None = None, max_row: int = 60, max_col: int = 16
) -> list[tuple[Any, ...]]:
    """Premières lignes d'une feuille Excel (certaines déclarent 1 048 576 lignes vides)."""
    handle = io.BytesIO(source) if isinstance(source, bytes) else source
    workbook = openpyxl.load_workbook(handle, read_only=True, data_only=True)
    try:
        worksheet = workbook[sheet] if sheet else workbook.worksheets[0]
        return list(worksheet.iter_rows(max_row=max_row, max_col=max_col, values_only=True))
    finally:
        workbook.close()


def _erfs_member(zip_path: Path, table: str) -> bytes:
    """Contenu du tableau ``table`` (ex. ``ti02d``) du zip ERFS, sans tenir compte de la casse."""
    with zipfile.ZipFile(zip_path) as archive:
        for name in archive.namelist():
            if name.lower().endswith(f"_{table}.xlsx"):
                return archive.read(name)
    raise FileNotFoundError(f"{table} absent de {zip_path}")


def parse_erfs_rows(rows: Iterable[Sequence[Any]]) -> dict[str, tuple[float | None, float | None]]:
    """Lignes d'un tableau TI02 -> ``{libellé normalisé : (moyenne, médiane) annuelles}``.

    ``None`` pour une valeur non significative (« ns »).
    """
    table: dict[str, tuple[float | None, float | None]] = {}
    for row in rows:
        cells = list(row) + [None] * 5
        label, effectif, moyenne, mediane = cells[0], cells[1], cells[3], cells[4]
        is_data = isinstance(effectif, int | float) or effectif == "ns"
        if label is None or not is_data:
            continue
        table[normalize_label(label)] = (_number(moyenne), _number(mediane))
    return table


def _one_row(table: Mapping[str, Any], prefix: str) -> Any:
    matches = [key for key in table if key.startswith(prefix)]
    if len(matches) != 1:
        raise ValueError(f"Ligne {prefix!r} : {len(matches)} correspondance(s) dans {list(table)}")
    return table[matches[0]]


def niveau_vie_table(
    detail: Mapping[str, tuple[float | None, float | None]],
    aggregate: Mapping[str, tuple[float | None, float | None]],
) -> pd.DataFrame:
    """Niveau de vie annuel par PCS, avec le statut de chaque valeur."""
    records: list[dict[str, Any]] = []
    independants = _one_row(detail, ERFS_INDEPENDANTS_LABEL)
    group4 = aggregate[ERFS_GROUP4_LABEL]
    for code in PCS_CODES:
        if code in ERFS_INDEPENDANTS_CODES:
            moyenne, mediane = independants
            statut, base = IMPUTE, "ligne commune agriculteurs, artisans, commerçants, chefs"
        else:
            moyenne, mediane = _one_row(detail, ERFS_LABELS[code])
            statut, base = PUBLIE, "ligne de la PCS"
            if moyenne is None:  # « ns » dans TI02D
                moyenne, mediane = group4
                statut, base = IMPUTE, "groupe Professions intermédiaires (TI02C), PCS « ns »"
        if moyenne is None or mediane is None:
            raise ValueError(f"Niveau de vie manquant pour la PCS {code}")
        records.append(
            {
                "code": code,
                "niveau_vie_annuel_moyen_eur": moyenne,
                "niveau_vie_annuel_median_eur": mediane,
                "niveau_vie_statut": statut,
                "niveau_vie_base": base,
            }
        )
    return pd.DataFrame(records)


def parse_hvp_montants(rows: Iterable[Sequence[Any]]) -> dict[str, tuple[float, float]]:
    """Feuille « PCS » des montants -> ``{catégorie : (moyenne, médiane) du patrimoine brut}``.

    Colonnes : libellé, moyenne brute, 1er décile, médiane brute, 9e décile, vide, puis le net.
    """
    table: dict[str, tuple[float, float]] = {}
    for row in rows:
        cells = list(row) + [None] * 4
        moyenne, mediane = _number(cells[1]), _number(cells[3])
        if cells[0] is not None and moyenne is not None and mediane is not None:
            table[normalize_label(cells[0])] = (moyenne, mediane)
    return table


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
    """Feuille « AGE » des montants -> seuils D1 à D9 du patrimoine brut, tous ménages.

    Première ligne « Ensemble » (le patrimoine net vient ensuite) ; colonnes : libellé, moyenne,
    D1, D2, D3, D4, médiane, D6, D7, D8, D9.
    """
    for row in rows:
        if row and row[0] is not None and normalize_label(row[0]) == "ensemble":
            seuils = [_number(c) for c in list(row)[2:11]]
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
    """Médiane estimée du patrimoine brut des ménages de retraités (4 catégories réunies)."""
    bands = [key for key in profil if key != "ensemble"][:10]
    if not (bands[0].startswith("inferieur au 1") and bands[9].startswith("superieur au 9")):
        raise ValueError(f"Tranches de déciles inattendues : {bands}")
    shares = [sum(profil[band][label] for label in HVP_RETRAITES) for band in bands]
    return median_from_bands(shares, seuils)


def _keur(euros: float) -> str:
    """Montant en k€ pour un texte en français : 205100 -> « 205,1 »."""
    return f"{euros / 1000:.1f}".replace(".", ",")


def patrimoine_table(
    montants: Mapping[str, tuple[float, float]],
    profil: Mapping[str, Mapping[str, float]],
    seuils: Sequence[float],
) -> pd.DataFrame:
    """Patrimoine brut (euros) par PCS, avec le statut de chaque valeur."""
    records: list[dict[str, Any]] = []
    for label, codes in HVP_CATEGORIES.items():
        moyenne, mediane = montants[label]
        for code in codes:
            records.append(
                {
                    "code": code,
                    "patrimoine_moyen_eur": moyenne,
                    "patrimoine_median_eur": mediane,
                    "patrimoine_statut": PUBLIE_MENAGE if len(codes) == 1 else IMPUTE,
                    "patrimoine_base": HVP_LABELS[label],
                }
            )
    shares = [profil["ensemble"][label] for label in HVP_RETRAITES]
    means = [montants[label][0] for label in HVP_RETRAITES]
    moyenne_retraites = sum(s * m for s, m in zip(shares, means, strict=True)) / sum(shares)
    mediane, borne_basse, borne_haute = retired_median(profil, seuils)
    records.append(
        {
            "code": "7",
            "patrimoine_moyen_eur": moyenne_retraites,
            "patrimoine_median_eur": mediane,
            "patrimoine_statut": CALCULE,
            "patrimoine_base": (
                f"4 catégories de retraités réunies, entre {_keur(borne_basse)} et "
                f"{_keur(borne_haute)} k€"
            ),
        }
    )
    return pd.DataFrame(records)


def item_note(row: Mapping[str, Any]) -> str:
    """Note explicite d'une PCS : ce qui est publié, ce qui est imputé ou calculé."""
    parts: list[str] = []
    statut_nv = row["niveau_vie_statut"]
    if statut_nv == PUBLIE:
        parts.append("Niveau de vie : médiane publiée par l'Insee pour cette PCS (ERFS 2022).")
    elif row["code"] in ERFS_INDEPENDANTS_CODES:
        parts.append(
            "Niveau de vie IMPUTÉ, pas une donnée Insee à ce niveau : l'ERFS 2022 ne publie "
            "qu'une ligne commune aux agriculteurs, artisans, commerçants et chefs d'entreprise, "
            "appliquée ici à cette PCS."
        )
    else:
        parts.append(
            "Niveau de vie IMPUTÉ, pas une donnée Insee à ce niveau : l'ERFS 2022 publie « ns » "
            "pour cette PCS ; la médiane du groupe Professions intermédiaires lui est appliquée "
            "à défaut, sans garantie de représentativité."
        )
    statut_pa = row["patrimoine_statut"]
    if statut_pa == PUBLIE_MENAGE:
        parts.append(
            "Patrimoine : médiane publiée par l'Insee pour les ménages dont la personne de "
            "référence relève de cette catégorie (HVP 2023-2024), pas pour les individus."
        )
    elif statut_pa == CALCULE:
        parts.append(
            "Patrimoine CALCULÉ, non publié par l'Insee : médiane des ménages de retraités "
            "estimée par interpolation linéaire à partir de leur répartition dans les déciles de "
            f"patrimoine de HVP 2023-2024 ({row['patrimoine_base']})."
        )
    else:
        parts.append(
            "Patrimoine IMPUTÉ, pas une donnée Insee à ce niveau : médiane de la catégorie "
            f"« {row['patrimoine_base']} » (ménages selon la personne de référence, HVP "
            "2023-2024), appliquée à toutes les PCS de cette catégorie."
        )
    return " ".join(parts)


def combine(niveau_vie: pd.DataFrame, patrimoine: pd.DataFrame) -> pd.DataFrame:
    """Assemble les deux tables en unités du schéma (30 lignes, ordre de la nomenclature)."""
    df = niveau_vie.merge(patrimoine, on="code", how="outer", validate="one_to_one")
    df = df.set_index("code").loc[list(PCS_CODES)].reset_index()
    df["group"] = df["code"].map(group_of)
    df["niveau_vie_mensuel_eur"] = df["niveau_vie_annuel_median_eur"] / 12.0
    df["niveau_vie_moyen_mensuel_eur"] = df["niveau_vie_annuel_moyen_eur"] / 12.0
    df["patrimoine_keur"] = df["patrimoine_median_eur"] / 1000.0
    df["patrimoine_moyen_keur"] = df["patrimoine_moyen_eur"] / 1000.0
    df["notes"] = [item_note(row) for row in df.to_dict("records")]
    return df


def _paths() -> dict[str, Path]:
    return {
        "erfs": cache_dir("insee_erfs2022") / ERFS_ZIP,
        "montants": cache_dir("insee_hvp2023_2024") / HVP_MONTANTS,
        "profil": cache_dir("insee_hvp2023_2024") / HVP_PROFIL,
    }


def fetch(force: bool = False) -> None:
    """Télécharge les tableaux ERFS et HVP dans le cache (quelques centaines de Ko)."""
    paths = _paths()
    download(ERFS_ZIP_URL, paths["erfs"], force=force)
    download(HVP_MONTANTS_URL, paths["montants"], force=force)
    download(HVP_PROFIL_URL, paths["profil"], force=force)


def load() -> pd.DataFrame:
    """DataFrame par PCS : médianes retenues, moyennes publiées, statuts et notes."""
    fetch()
    paths = _paths()
    detail = parse_erfs_rows(_sheet_rows(_erfs_member(paths["erfs"], "ti02d"), max_col=5))
    aggregate = parse_erfs_rows(_sheet_rows(_erfs_member(paths["erfs"], "ti02c"), max_col=5))
    montants = parse_hvp_montants(_sheet_rows(paths["montants"], "PCS"))
    seuils = parse_hvp_seuils(_sheet_rows(paths["montants"], "AGE"))
    profil = parse_hvp_profil(_sheet_rows(paths["profil"], "PCS"))
    return combine(niveau_vie_table(detail, aggregate), patrimoine_table(montants, profil, seuils))


def sources() -> list[dict[str, str]]:
    """Références avec date d'accès réelle."""
    paths = _paths()
    return [
        source_ref(
            SOURCE_ID_ERFS,
            "Niveau de vie et revenu annuel des individus en 2022, ERFS, Insee Résultats, "
            "tableaux TI02D et TI02C",
            ERFS_PAGE,
            file_meta(paths["erfs"]).get("accessed"),
            publisher="Insee-DGFiP-Cnaf-Cnav-CCMSA",
            license=LICENCE_INSEE,
            notes=(
                f"Fichier : {ERFS_ZIP_URL}. Médianes annuelles divisées par 12. Champ : individus "
                "de 15 ans ou plus, ménages ordinaires de France métropolitaine dont la personne "
                "de référence n'est pas étudiante, selon leur propre CS."
            ),
        ),
        source_ref(
            SOURCE_ID_HVP,
            "Patrimoine et endettement des ménages en 2024, enquête Histoire de vie et "
            "Patrimoine 2023-2024, Insee Résultats",
            HVP_PAGE,
            file_meta(paths["montants"]).get("accessed"),
            publisher="Insee",
            license=LICENCE_INSEE,
            notes=(
                f"Fichiers : {HVP_MONTANTS_URL} (feuilles « PCS » et « AGE ») et {HVP_PROFIL_URL} "
                "(feuille « PCS »). Patrimoine brut médian, début 2024. Champ : ménages en "
                "logement ordinaire, France hors Mayotte, selon la CS de la personne de référence "
                "(12 catégories, jamais les 29 postes) : la plupart des valeurs par PCS sont donc "
                "imputées, voir notes."
            ),
        ),
    ]
