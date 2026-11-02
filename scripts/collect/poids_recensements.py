"""Poids des groupes dans le corps électoral, à chaque recensement depuis 1968.

Lit le fichier détail « Données harmonisées des recensements de la population 1968-2022 » de
l'Insee et écrit ``pipeline/sources/manual/poids_recensements.csv``, le seul fichier que le pipeline
utilise : le parquet pèse 255 Mo et n'est pas nécessaire à la construction.

Champ : Français de 18 ans ou plus, comme ``insee_population.load_electorate`` pour le recensement
de 2022, dont ce calcul retrouve les effectifs (voir pipeline/tests/test_sources.py).

Usage :
    uv run --with pyarrow python scripts/collect/poids_recensements.py CHEMIN/RP1968-2022.parquet
"""

from __future__ import annotations

import argparse
import hashlib
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "pipeline" / "sources" / "manual" / "poids_recensements.csv"
GROUPS = ("1", "2", "3", "4", "5", "6", "7", "8")
FRENCH = {"000", "001"}
COLUMNS = ["AN_RECENS", "AGE_REV", "NATIO", "CSP", "POND"]
HEADER = """\
# source_id: insee_rp_harmonises_1968_2022
# title: Données harmonisées des recensements de la population 1968-2022, fichier détail
# publisher: Insee
# url: https://www.insee.fr/fr/statistiques/8672621?sommaire=2414232
# data_url: https://www.insee.fr/fr/statistiques/fichier/8672621/RP1968-2022.parquet
# accessed: {accessed}
# sha256: {sha256}
# champ: Français de 18 ans ou plus (NATIO 000 ou 001, AGE_REV d'au moins 18), somme de POND. France métropolitaine, et DOM à partir de 1990.
# groupes: 1 à 6 = CSP 1 à 6, personnes en emploi ou au chômage ayant déjà travaillé ; 7 = CSP 8, anciens actifs ; 8 = CSP 9, inactifs et chômeurs n'ayant jamais travaillé
# produit par: scripts/collect/poids_recensements.py
"""  # noqa: E501


def group_of_csp(csp: str) -> str:
    """Groupe du projet d'une modalité de ``CSP`` : 8 anciens actifs -> 7, 9 inactifs -> 8."""
    if csp in ("1", "2", "3", "4", "5", "6"):
        return csp
    if csp == "8":
        return "7"
    if csp == "9":
        return "8"
    raise ValueError(f"CSP inconnue : {csp!r}")


def is_elector_proxy(age: int, nationality: str) -> bool:
    """Approximation du corps électoral : nationalité française et 18 ans ou plus."""
    return age >= 18 and nationality in FRENCH


def add_rows(
    totals: Counter[tuple[str, str]],
    years: list[object],
    ages: list[object],
    nationalities: list[object],
    categories: list[object],
    weights: list[object],
) -> None:
    """Ajoute des colonnes du fichier aux effectifs par année et par groupe."""
    for year, age, nationality, csp, weight in zip(
        years, ages, nationalities, categories, weights, strict=True
    ):
        if is_elector_proxy(int(str(age)), str(nationality)):
            totals[(str(year), group_of_csp(str(csp)))] += float(str(weight))


def render(totals: Counter[tuple[str, str]], accessed: str, sha256: str) -> str:
    """Texte du fichier : en-tête de source, puis une ligne d'effectifs par recensement."""
    years = sorted({year for year, _ in totals})
    lines = [HEADER.format(accessed=accessed, sha256=sha256).rstrip("\n")]
    lines.append("annee," + ",".join(GROUPS))
    for year in years:
        lines.append(year + "," + ",".join(str(round(totals[(year, g)])) for g in GROUPS))
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("parquet", type=Path)
    parser.add_argument("--accessed", default="2026-11-02", help="date de téléchargement")
    args = parser.parse_args(argv)

    # Dépendance ponctuelle : le pipeline lui-même n'a pas besoin de lire ce fichier.
    import pyarrow.parquet as pq

    digest = hashlib.sha256()
    with args.parquet.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)

    totals: Counter[tuple[str, str]] = Counter()
    file = pq.ParquetFile(args.parquet)
    # Par groupe de lignes : le fichier compte 55,8 millions d'observations.
    for index in range(file.metadata.num_row_groups):
        columns = file.read_row_group(index, columns=COLUMNS).to_pydict()
        add_rows(totals, *(columns[name] for name in COLUMNS))
    text = render(totals, args.accessed, digest.hexdigest())
    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(f"{OUT.relative_to(ROOT).as_posix()} : {len({y for y, _ in totals})} recensements")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
