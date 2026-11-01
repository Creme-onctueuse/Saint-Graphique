"""Composition du patrimoine par PCS : ce qui existe, et à quel niveau.

Chris définit l'axe X par la composition du patrimoine des PCS. Ce qui est publié :

- **Composition et taux de détention** : Insee, HVP 2020-2021 (même vague que le patrimoine de
  ``pcs.json``), 11 catégories de ménages selon la personne de référence. Pas de niveau 2.
  Seuls « Agriculteurs » et « Professions libérales » correspondent à une seule PCS (statut
  ``published``). Pour les autres PCS actives, la valeur de la catégorie est appliquée à toutes ses
  PCS (statut ``imputed``, ce n'est pas une donnée Insee à ce niveau). Les retraités, publiés en 3
  catégories sans ensemble, sont agrégés par ce projet (statut ``calculated``).
- **Part de propriétaires** : seul indicateur de détention publié en 29 postes, sur
  nomenclature-pcs.fr (enquête Emploi 2024, statut d'occupation du logement). Il manque la PCS 44
  et les retraités. Il concerne le logement occupé, pas la composition du patrimoine.

Clés de ``patrimoine_composition`` :

- parts de la masse du patrimoine brut (somme proche de 100) : ``immobilier_pct``,
  ``financier_pct``, ``professionnel_pct``, ``autre_pct`` (patrimoine résiduel) ;
- dont, parts de la masse : ``professionnel_entreprises_pct`` (entreprises du ménage),
  ``valeurs_mobilieres_pct`` ;
- taux de détention, en % des ménages : ``detention_immobilier_pct``,
  ``detention_financier_pct``, ``detention_professionnel_pct``, ``detention_entreprise_pct``
  (entreprise dont le dirigeant est membre du ménage) ;
- ``proprietaire_pct`` : part des personnes de la PCS qui sont propriétaires de leur logement.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from pipeline.sources import _nomenclature_pcs as portraits
from pipeline.sources._common import (
    LICENCE_INSEE,
    PCS_CODES,
    RETIRED_CODE,
    cache_dir,
    download,
    file_meta,
    source_ref,
)
from pipeline.sources._tables import normalize_label, table_by_label, xlsx_rows
from pipeline.sources.insee_revenus_patrimoine import (
    CALCULATED,
    HVP2021_PAGE,
    PUBLISHED,
    SOURCE_ID_HVP2021,
    household_shares,
)

IMPUTED = "imputed"
HOUSING_FILE = "DEC_POR_4.xls"
SOURCE_ID_HOUSING = "nomenclature_pcs_dec_por_4"

BASE_URL = "https://www.insee.fr/fr/statistiques/fichier/8262352/"
COMPOSITION_FILE = "hvp_mtpatbrut_composante_fr.xlsx"
DETAIL_FILE = "hvp_mtpatbrut_composante_det_fr.xlsx"
DETENTION_FILE = "hvp_txdetention_fr.xlsx"

MEAN_COLUMN = normalize_label("Montant moyen du patrimoine brut (en euros)")
#: Clé -> colonne du tableau de composition : parts de la masse du patrimoine brut.
COMPOSITION_COLUMNS: dict[str, str] = {
    "immobilier_pct": "Part du patrimoine immobilier dans le patrimoine brut",
    "financier_pct": "Part du patrimoine financier dans le patrimoine brut",
    "professionnel_pct": "Part du patrimoine professionnel dans le patrimoine brut",
    "autre_pct": "Part du patrimoine résiduel dans le patrimoine brut",
}
DETAIL_COLUMNS: dict[str, str] = {
    "professionnel_entreprises_pct": (
        "Part du patrimoine professionnel lié aux entreprises du ménage dans le patrimoine brut"
    ),
    "valeurs_mobilieres_pct": "Part des valeurs mobilières dans le patrimoine brut",
}
DETENTION_COLUMNS: dict[str, str] = {
    "detention_immobilier_pct": "Taux de détention de patrimoine immobilier",
    "detention_financier_pct": "Taux de détention de patrimoine financier",
    "detention_professionnel_pct": "Taux de détention de patrimoine professionnel",
    "detention_entreprise_pct": (
        "Taux de détention de patrimoine professionnel : Entreprise(s) dont le dirigeant est "
        "membre du ménage"
    ),
}

#: Catégorie de HVP 2020-2021 (libellé normalisé) -> PCS rattachées, et libellé publié.
CATEGORIES: dict[str, tuple[str, tuple[str, ...]]] = {
    "agriculteurs": ("Agriculteurs", ("10",)),
    "artisans, commercants et chefs d'entreprise": (
        "Artisans, commerçants et chefs d'entreprise",
        ("21", "22", "23"),
    ),
    "professions liberales": ("Professions libérales", ("31",)),
    "cadres (autre que professions liberales)": (
        "Cadres (autre que professions libérales)",
        ("33", "34", "35", "37", "38"),
    ),
    "professions intermediaires": (
        "Professions intermédiaires",
        ("42", "43", "44", "45", "46", "47", "48"),
    ),
    "employes": ("Employés", ("52", "53", "54", "55", "56")),
    "ouvriers": ("Ouvriers", ("62", "63", "64", "65", "67", "68", "69")),
}
#: Catégories de retraités de 2020-2021 -> catégories de 2023-2024 donnant les parts de ménages.
RETIRED_CATEGORIES: dict[str, tuple[str, ...]] = {
    "retraites ancien agriculteur, artisan, commercant, chef d'entreprise": (
        "retraites anciens agriculteurs, artisans, commercants, chefs d'entreprise",
    ),
    "retraites ancien cadre ou prof. liberale": (
        "retraites anciens cadres ou professions liberales",
    ),
    "retraites ancien autre salarie": (
        "retraites anciennes professions intermediaires",
        "retraites anciens employes et ouvriers",
    ),
}

KEYS_NOTE = (
    "professionnel_pct, immobilier_pct, financier_pct, autre_pct, professionnel_entreprises_pct et "
    "valeurs_mobilieres_pct : parts de la masse du patrimoine brut ; detention_*_pct : taux de "
    "détention, en % des ménages."
)
HOUSING_NOTE = (
    " proprietaire_pct : part de propriétaires de leur logement, publiée pour cette PCS (enquête "
    "Emploi 2024, nomenclature-pcs.fr)."
)


def _select(
    table: Mapping[str, Mapping[str, float | None]], label: str, columns: Mapping[str, str]
) -> dict[str, float]:
    """Valeurs d'une ligne, sans les « ns ». Une colonne absente du tableau est une erreur."""
    row = table[label]
    selected: dict[str, float] = {}
    for key, column in columns.items():
        name = normalize_label(column)
        if name not in row and not any(name in r for r in table.values()):
            raise ValueError(f"Colonne absente : {column!r}")
        value = row.get(name)
        if value is not None:
            selected[key] = value
    return selected


def retired_composition(
    composition: Mapping[str, Mapping[str, float | None]],
    detail: Mapping[str, Mapping[str, float | None]],
    detention: Mapping[str, Mapping[str, float | None]],
    households: Mapping[str, float],
) -> dict[str, float]:
    """Agrège les 3 catégories de retraités.

    Une part de masse se pondère par les ménages × le patrimoine moyen ; un taux de détention par
    les ménages. Les parts de ménages viennent de HVP 2023-2024, faute de publication en 2020-2021.
    """
    weights = {
        label: sum(households[k] for k in parts) for label, parts in RETIRED_CATEGORIES.items()
    }
    masses: dict[str, float] = {}
    for label, weight in weights.items():
        mean = composition[label].get(MEAN_COLUMN)
        if mean is None:
            raise ValueError(f"Patrimoine moyen manquant : {label}")
        masses[label] = weight * mean

    def weighted(
        table: Mapping[str, Mapping[str, float | None]],
        columns: Mapping[str, str],
        by: Mapping[str, float],
    ) -> dict[str, float]:
        out: dict[str, float] = {}
        for key, column in columns.items():
            values = [table[label].get(normalize_label(column)) for label in by]
            if all(v is not None for v in values):
                total = sum(by.values())
                out[key] = sum(
                    b * float(v) for b, v in zip(by.values(), values, strict=True) if v is not None
                ) / total
        return out

    return (
        weighted(composition, COMPOSITION_COLUMNS, masses)
        | weighted(detail, DETAIL_COLUMNS, masses)
        | weighted(detention, DETENTION_COLUMNS, weights)
    )


def build(
    composition: Mapping[str, Mapping[str, float | None]],
    detail: Mapping[str, Mapping[str, float | None]],
    detention: Mapping[str, Mapping[str, float | None]],
    households: Mapping[str, float],
    owners: Mapping[str, float],
) -> dict[str, dict[str, Any]]:
    """``{PCS : {composition, status, note}}`` pour les 30 PCS."""
    result: dict[str, dict[str, Any]] = {}
    for label, (published_label, codes) in CATEGORIES.items():
        values = (
            _select(composition, label, COMPOSITION_COLUMNS)
            | _select(detail, label, DETAIL_COLUMNS)
            | _select(detention, label, DETENTION_COLUMNS)
        )
        for code in codes:
            shares = dict(values)
            if code in owners:
                shares["proprietaire_pct"] = owners[code]
            housing = HOUSING_NOTE if code in owners else ""
            if len(codes) == 1:
                status = PUBLISHED
                note = (
                    "Composition du patrimoine : publiée par l'Insee pour les ménages dont la "
                    f"personne de référence relève de la catégorie « {published_label} » (HVP "
                    f"2020-2021), pas pour les individus. {KEYS_NOTE}{housing}"
                )
            else:
                status = IMPUTED
                note = (
                    "Composition du patrimoine IMPUTÉE, pas une donnée Insee à ce niveau : valeurs "
                    f"de la catégorie « {published_label} » (ménages selon la personne de "
                    f"référence, HVP 2020-2021), appliquées à toutes ses PCS. {KEYS_NOTE}{housing}"
                )
            result[code] = {"composition": shares, "status": status, "note": note}
    result[RETIRED_CODE] = {
        "composition": retired_composition(composition, detail, detention, households),
        "status": CALCULATED,
        "note": (
            "Composition du patrimoine CALCULÉE, non publiée par l'Insee : agrégation des 3 "
            "catégories de retraités de HVP 2020-2021, avec les parts de ménages de HVP 2023-2024, "
            f"faute de publication en 2020-2021. {KEYS_NOTE}"
        ),
    }
    missing = sorted(set(PCS_CODES) - set(result))
    if missing:
        raise ValueError(f"PCS sans composition : {missing}")
    return result


def _path(name: str) -> Path:
    return cache_dir("insee_hvp2020_2021") / name


def owners_from(sheets: Mapping[str, Sequence[Sequence[Any]]]) -> dict[str, float]:
    """Feuilles de ``DEC_POR_4`` -> ``{PCS : part de propriétaires (%)}``."""
    column = portraits.find_column(sheets, "Propriétaire")
    return {code: v[0] for code, v in portraits.values_by_pcs(sheets, [column]).items()}


def fetch(force: bool = False) -> None:
    """Télécharge les tableaux dans le cache (quelques dizaines de Ko)."""
    for name in (COMPOSITION_FILE, DETAIL_FILE, DETENTION_FILE):
        download(BASE_URL + name, _path(name), force=force)
    portraits.fetch(HOUSING_FILE, force=force)


def load() -> dict[str, dict[str, Any]]:
    """Composition par PCS : ``{code : {composition, status, note}}``."""
    fetch()
    return build(
        table_by_label(xlsx_rows(_path(COMPOSITION_FILE), "PCS", max_col=8)),
        table_by_label(xlsx_rows(_path(DETAIL_FILE), "PCS", max_col=18)),
        table_by_label(xlsx_rows(_path(DETENTION_FILE), "PCS", max_col=22)),
        household_shares(),
        owners_from(portraits.read_book(portraits.path_of(HOUSING_FILE))),
    )


def sources() -> list[dict[str, str]]:
    """Références avec date d'accès réelle."""
    return [
        source_ref(
            f"{SOURCE_ID_HVP2021}_composition",
            "Composition du patrimoine brut et taux de détention selon la catégorie de la personne "
            "de référence, enquête Histoire de vie et Patrimoine 2020-2021, Insee Résultats",
            HVP2021_PAGE,
            file_meta(_path(COMPOSITION_FILE)).get("accessed"),
            publisher="Insee",
            license=LICENCE_INSEE,
            notes=(
                f"Fichiers : {BASE_URL}{COMPOSITION_FILE}, {BASE_URL}{DETAIL_FILE} et "
                f"{BASE_URL}{DETENTION_FILE} (feuilles PCS). Le niveau le plus fin publié est de "
                "11 catégories de ménages, pas le niveau 2 des PCS. Champ : ménages ordinaires "
                "résidant en France hors Mayotte."
            ),
        ),
        source_ref(
            SOURCE_ID_HOUSING,
            "Lien à la migration, taille d'unité urbaine et statut d'occupation du logement, "
            "Portraits des six groupes socioprofessionnels, feuilles Ensemble",
            portraits.url_of(HOUSING_FILE),
            portraits.accessed(HOUSING_FILE),
            publisher=portraits.PUBLISHER,
            license=portraits.REUSE,
            notes=(
                "Source indiquée par le fichier : Insee, enquête Emploi 2024. Colonne Propriétaire "
                "pour 28 PCS (ni la PCS 44 ni les retraités). Champ : France hors Mayotte, "
                "personnes vivant en logement ordinaire, actives ayant déjà travaillé."
            ),
        ),
    ]
