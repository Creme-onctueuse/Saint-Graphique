"""Tableaux des « Portraits des six groupes socioprofessionnels » de nomenclature-pcs.fr.

Le site appartient conjointement à l'Insee, à Progedo (CNRS), au Cnam-CEET et au laboratoire
Printemps (UVSQ, CNRS). Chaque tableau y est publié en un classeur, à raison de trois feuilles par
groupe socioprofessionnel (femmes, hommes, ensemble). Seules les feuilles « Ensemble » sont lues.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import xlrd

from pipeline.sources._common import cache_dir, download, file_meta
from pipeline.sources._tables import normalize_label, number

BASE_URL = "https://www.nomenclature-pcs.fr/uploads/tableaux/groupes/"
PORTRAITS_PAGE = "https://www.nomenclature-pcs.fr/decrire/portraits-des-six-groupes-soci"
LEGAL_URL = "https://www.nomenclature-pcs.fr/informations-pratiques/mentions-legales"
PUBLISHER = "Insee, Progedo (CNRS), Cnam-CEET, laboratoire Printemps (UVSQ, CNRS)"
#: Conditions citées telles quelles depuis les mentions légales du site.
REUSE = (
    "Mentions légales du site : données réutilisables « sans licence », réutilisation "
    "« subordonnée au respect de l'intégrité de l'information et des données et à la mention "
    f"précise des sources » ({LEGAL_URL})"
)

#: Feuille « Ensemble » -> début du libellé normalisé d'une ligne -> code PCS.
SHEETS: dict[str, dict[str, str]] = {
    "Agriculteurs_E": {"agriculteurs": "10"},
    "Artis-Comm_E": {"artisans": "21", "commercants": "22", "chefs d'entreprise": "23"},
    "Cadres_E": {
        "professions liberales": "31",
        "cadres de la fonction publique": "33",
        "professeurs": "34",
        "professions de l'information": "35",
        "cadres administratifs": "37",
        "cadres techniques": "38",
    },
    "PInterm_E": {
        "professions de l'enseignement": "42",
        "intermediaires de la sante": "43",
        "religieux": "44",
        "intermediaires de la fonction publique": "45",
        "intermediaires des entreprises": "46",
        "techniciens": "47",
        "agents de maitrise": "48",
    },
    "Employés_E": {
        "employes de la fonction publique": "52",
        "policiers": "53",
        "employes administratifs": "54",
        "employes de commerce": "55",
        "employes des services": "56",
    },
    "Ouvriers_E": {
        "ouvriers qualifies de type industriel": "62",
        "ouvriers qualifies de type artisanal": "63",
        "conducteurs du transport": "64",
        "conducteurs d'engins": "65",
        "ouvriers peu qualifies de type industriel": "67",
        "ouvriers peu qualifies de type artisanal": "68",
        "ouvriers agricoles": "69",
    },
}


def url_of(name: str) -> str:
    return BASE_URL + name


def path_of(name: str) -> Path:
    return cache_dir("nomenclature_pcs") / name


def fetch(name: str, force: bool = False) -> Path:
    """Télécharge un classeur (ex. ``DEC_POR_8.xls``) dans le cache."""
    return download(url_of(name), path_of(name), force=force)


def accessed(name: str) -> str | None:
    return file_meta(path_of(name)).get("accessed")


def read_book(path: Path) -> dict[str, list[list[Any]]]:
    """Feuilles « Ensemble » d'un classeur .xls : ``{feuille : lignes}``."""
    book = xlrd.open_workbook(str(path))
    return {
        name: [
            [sheet.cell_value(r, c) for c in range(sheet.ncols)] for r in range(sheet.nrows)
        ]
        for name in SHEETS
        for sheet in [book.sheet_by_name(name)]
    }


def code_of(sheet: str, label: Any) -> str | None:
    """Code PCS d'une ligne de la feuille, ``None`` pour une ligne « Ensemble … »."""
    normalized = normalize_label(label)
    if normalized.startswith("ensemble"):
        return None
    matches = [code for prefix, code in SHEETS[sheet].items() if normalized.startswith(prefix)]
    if len(matches) != 1:
        raise ValueError(f"{sheet} : ligne non reconnue : {label!r}")
    return matches[0]


def values_by_pcs(
    sheets: Mapping[str, Sequence[Sequence[Any]]], columns: Sequence[int]
) -> dict[str, list[float]]:
    """Valeurs des colonnes ``columns`` pour chaque PCS présente dans les feuilles.

    Une ligne sans valeur numérique dans la première colonne demandée n'est pas une ligne de
    données (titre, lecture, champ, source). Une PCS peut manquer : à l'appelant de le vérifier.
    """
    found: dict[str, list[float]] = {}
    for sheet, rows in sheets.items():
        for row in rows:
            if len(row) <= max(columns) or number(row[columns[0]]) is None:
                continue
            if not isinstance(row[0], str) or not row[0].strip():
                continue
            code = code_of(sheet, row[0])
            if code is None:
                continue
            values = [number(row[c]) for c in columns]
            if any(v is None for v in values):
                raise ValueError(f"{sheet} : valeur manquante pour la PCS {code}")
            if code in found:
                raise ValueError(f"{sheet} : PCS {code} en double")
            found[code] = [float(v) for v in values if v is not None]
    return found


def find_column(sheets: Mapping[str, Sequence[Sequence[Any]]], title: str) -> int:
    """Indice de la colonne dont l'en-tête est ``title``, le même dans toutes les feuilles."""
    wanted = normalize_label(title)
    indices = set()
    for rows in sheets.values():
        for row in rows:
            for index, cell in enumerate(row):
                if isinstance(cell, str) and normalize_label(cell) == wanted:
                    indices.add(index)
    if len(indices) != 1:
        raise ValueError(f"Colonne {title!r} : {sorted(indices)}")
    return indices.pop()
