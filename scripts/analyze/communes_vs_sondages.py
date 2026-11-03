"""Peut-on estimer un électorat par les communes, faute de sondage ? Mesure, sans rien publier.

Pour les présidentielles qui ont un sondage, régresse le score d'un candidat dans chaque commune sur
la part de chaque groupe dans la commune (données de Julia Cagé et Thomas Piketty), puis compare la
position obtenue à celle du sondage. Le projet ne garde une étape estimée que si cette erreur
moyenne passe sous ``MAX_MEAN_ERROR``. Elle en reste loin : voir docs/methodologie.md, section 7.

Ce script n'alimente pas ``data/`` et demande des fichiers absents du dépôt :
https://www.unehistoireduconflitpolitique.fr/download.html (``CSP_csv.zip``, ``Age_csp.zip``,
``pres<année>_csv.zip``, gratuits, à citer : Cagé et Piketty, Une histoire du conflit politique,
Seuil, 2023). Le groupe 7 y est approché par les 60 ans ou plus, faute de retraités par commune.

Usage :
    uv run python scripts/analyze/communes_vs_sondages.py DOSSIER_DES_ZIP
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import zipfile
from collections.abc import Mapping, Sequence
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import nnls

ROOT = Path(__file__).resolve().parents[2]
COMPUTED = ROOT / "data" / "computed" / "read_positions"
#: Règle du projet : au-delà, une étape estimée n'est pas conservée.
MAX_MEAN_ERROR = 0.45
YEARS = (1995, 2002, 2007, 2012, 2017, 2022)
CATEGORIES = {"1": "agri", "2": "indp", "3": "cadr", "4": "pint", "5": "empl", "6": "ouvr"}
KEYS = ("1", "2", "3", "4", "5", "6", "7")
ADULT_AGES = ("poph1539", "popf1539", "poph4059", "popf4059", "poph60p", "popf60p")
#: Colonnes ``voix<NOM>`` dont l'identifiant du projet diffère du nom en minuscules.
SPECIAL_IDS = {
    "LEPEN": "le-pen",
    "MLEPEN": "le-pen",
    "VILLIERS": "de-villiers",
    "DUPONTAIGNAN": "dupont-aignan",
    "SAINTJOSSE": "saint-josse",
}


def candidate_id(column: str) -> str:
    """Identifiant du projet d'une colonne ``voixNOM``."""
    name = column.removeprefix("voix")
    return SPECIAL_IDS.get(name, name.lower())


def composition_from_votes(votes: np.ndarray, totals: np.ndarray) -> np.ndarray:
    """Composition d'un électorat : vote estimé de chaque groupe multiplié par son effectif."""
    weights = votes[: len(KEYS)] * totals[: len(KEYS)]
    return weights / weights.sum() if weights.sum() > 0 else weights


def position(composition: np.ndarray, anchors: Mapping[str, tuple[float, float]]) -> np.ndarray:
    """Barycentre des groupes, pondéré par la composition."""
    points = np.array([anchors[key] for key in KEYS])
    return composition @ points


def regress_votes(shares: np.ndarray, groups: np.ndarray, voters: np.ndarray) -> np.ndarray:
    """Vote de chaque groupe : moindres carrés non négatifs, pondérés par les exprimés."""
    root = np.sqrt(voters)
    return nnls(groups * root[:, None], shares * root)[0]


def regress_votes_within_departments(
    shares: np.ndarray,
    groups: np.ndarray,
    voters: np.ndarray,
    departments: Sequence[str],
    totals: np.ndarray,
) -> np.ndarray:
    """Variante : écarts à la moyenne du département, puis votes ramenés au score national."""

    def centered(values: np.ndarray) -> np.ndarray:
        frame = pd.DataFrame(values)
        total = frame.multiply(voters, axis=0).groupby(np.asarray(departments)).transform("sum")
        return values - total.to_numpy() / (
            pd.Series(voters).groupby(np.asarray(departments)).transform("sum").to_numpy()[:, None]
        )

    root = np.sqrt(voters)
    slopes = np.linalg.lstsq(
        centered(groups) * root[:, None],
        centered(shares[:, None])[:, 0] * root,
        rcond=None,
    )[0]
    national = (shares * voters).sum() / voters.sum()
    return np.clip(national + slopes - (slopes * totals).sum() / totals.sum(), 0, None)


def read_columns(archive: Path, member: str, columns: Sequence[str]) -> pd.DataFrame:
    """Colonnes choisies d'un CSV zippé, par morceaux : certains dépassent le gigaoctet."""
    with zipfile.ZipFile(archive) as zipped, zipped.open(member) as handle:
        chunks = pd.read_csv(
            io.TextIOWrapper(handle, encoding="latin-1"),
            usecols=list(columns),
            dtype={"codecommune": str, "dep": str},
            chunksize=4000,
        )
        return pd.concat(chunks, ignore_index=True)


def read_header(archive: Path, member: str) -> list[str]:
    with zipfile.ZipFile(archive) as zipped, zipped.open(member) as handle:
        return handle.readline().decode("latin-1").strip().split(",")


def evaluate_year(year: int, folder: Path) -> pd.DataFrame:
    """Erreur de position de chaque candidat placé par le sondage, pour les deux régressions."""
    archive = folder / f"pres{year}_csv.zip"
    member = f"pres{year}_csv/pres{year}comm.csv"
    voix = [
        c
        for c in read_header(archive, member)
        if c.startswith("voix") and not c.startswith("voixT2")
    ]
    votes = read_columns(archive, member, ["dep", "codecommune", "exprimes", *voix])
    votes = votes[votes["exprimes"] > 0].set_index("codecommune")

    columns = [f"{name}{year}" for name in CATEGORIES.values()]
    census = read_columns(
        folder / "CSP_csv.zip", "CSP_csv/cspcommunes.csv", ["codecommune", *columns]
    ).set_index("codecommune")
    ages = read_columns(
        folder / "Age_csp.zip",
        "Age_csp/agesexcommunes.csv",
        ["codecommune", *(f"{age}{year}" for age in ADULT_AGES)],
    ).set_index("codecommune")

    groups = pd.DataFrame(index=votes.index)
    for key, name in CATEGORIES.items():
        groups[key] = census[f"{name}{year}"].reindex(votes.index)
    groups["7"] = ages[[f"poph60p{year}", f"popf60p{year}"]].sum(axis=1).reindex(votes.index)
    adults = ages[[f"{age}{year}" for age in ADULT_AGES]].sum(axis=1).reindex(votes.index)
    groups["8"] = (adults - groups[list(KEYS)].sum(axis=1)).clip(lower=0)
    total = groups.sum(axis=1)
    usable = (total > 0) & groups.notna().all(axis=1)
    matrix = groups[usable].div(total[usable], axis=0).to_numpy()
    totals = groups[usable].sum(axis=0).to_numpy()
    voters = votes.loc[usable, "exprimes"].to_numpy(dtype=float)
    departments = votes.loc[usable, "dep"].astype(str).tolist()

    computed = json.loads((COMPUTED / f"{year}_presidentielle_t1.json").read_text(encoding="utf-8"))
    anchors = {g["code"]: (g["x"], g["y"]) for g in computed["groups"]}
    polls = {c["id"]: c for c in computed["candidates"]}
    rows = []
    for column in voix:
        poll = polls.get(candidate_id(column))
        if poll is None:
            continue
        shares = votes.loc[usable, column].to_numpy(dtype=float) / voters
        target = np.array([poll["x"], poll["y"]])
        plain = regress_votes(shares, matrix, voters)
        within = regress_votes_within_departments(shares, matrix, voters, departments, totals)
        rows.append(
            {
                "candidat": poll["id"],
                "score": poll.get("national_share_pct", 0.0),
                "nnls": float(
                    np.linalg.norm(
                        position(composition_from_votes(plain, totals), anchors) - target
                    )
                ),
                "departement": float(
                    np.linalg.norm(
                        position(composition_from_votes(within, totals), anchors) - target
                    )
                ),
            }
        )
    return pd.DataFrame(rows)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dossier", type=Path, help="dossier des archives de Cagé et Piketty")
    args = parser.parse_args(argv)
    means = {}
    for year in YEARS:
        table = evaluate_year(year, args.dossier)
        means[year] = table[["nnls", "departement"]].mean()
        print(f"{year} :\n{table.round(2).to_string(index=False)}")
    summary = pd.DataFrame(means).T
    print(summary.round(2).to_string())
    print("Moyenne sur les années :", summary.mean().round(2).to_dict())
    print(f"Règle : sous {MAX_MEAN_ERROR}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
