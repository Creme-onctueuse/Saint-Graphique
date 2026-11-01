"""Convertit les CSV de la reproduction JnthnBS en jeu de données local conforme aux schémas.

Usage (depuis la racine) :
    uv run python -m pipeline.tests.fixtures.convert_jnthnbs [SOURCE] [DESTINATION]
    (défauts : research/ref/jnthnbs/data -> research/fixtures/jnthnbs_2022)

Le dépôt JnthnBS/saint-graphique n'a pas de licence : ses données restent dans ``research/``
(gitignoré), et la sortie de ce script aussi. Ce fichier est du code du projet, il ne contient
aucune donnée de la référence. La sortie sert au test local ``test_methods_reference.py`` et à
``python -m pipeline.build --data-dir research/fixtures/jnthnbs_2022``.

Conversion :
- PCS : ``2022_population/{revenus,diplomes}.csv``, valeurs recopiées telles quelles, y compris
  l'encodage des retraités par la référence (CAP = 180 %, soit un score diplôme de -180) ;
- effectifs : somme de ``NB`` de ``2022_population/PCS.csv``, France entière, tous sexes ;
- élection : ``2022_presidentielles/{compositions,couleurs,communes}.csv``. Les compositions sont
  recopiées telles quelles (leurs sommes valent moins de 100). Scores nationaux : ligne « France
  entière » de ``communes.csv``, en % des exprimés ; l'abstention est en % de (abstentions +
  exprimés), car les blancs et nuls ne sont pas fournis.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import unicodedata
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pandas as pd

from pipeline.model import ROOT, validate_instance

DEFAULT_SOURCE = ROOT / "research" / "ref" / "jnthnbs" / "data"
DEFAULT_DEST = ROOT / "research" / "fixtures" / "jnthnbs_2022"
ELECTION_ID = "2022_presidentielle_t1"
REPOSITORY = "https://github.com/JnthnBS/saint-graphique"
ACCESSED = "2026-10-31"  # date de lecture de la copie locale
ABSTENTION = "Abstention"
FRANCE_ENTIERE = "100"
#: Clé de ``schemas/pcs.schema.json`` -> colonne de ``diplomes.csv``.
DIPLOMA_COLUMNS = {
    "bac5": "5", "bac3": "3", "bac2": "2", "bac": "BAC", "cap": "CAP", "brevet": "BREVET",
    "certif_aucun": "CERTIF",
}


def slug(label: str) -> str:
    """Identifiant conforme au schéma : « Le Pen » -> ``le-pen``, « Pécresse » -> ``pecresse``."""
    ascii_label = unicodedata.normalize("NFKD", label).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_label.lower()).strip("-")


def _reference_commit(source: Path) -> str | None:
    """Commit de la copie locale de la référence, si elle est elle-même un clone git."""
    if not (source.parent / ".git").exists():
        return None  # sinon git remonterait jusqu'au dépôt englobant
    try:
        done = subprocess.run(
            ["git", "-C", str(source), "rev-parse", "HEAD"],
            capture_output=True, text=True, check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return done.stdout.strip() or None


def build_documents(source: Path = DEFAULT_SOURCE) -> tuple[dict[str, Any], dict[str, Any]]:
    """Documents ``pcs.json`` et ``elections/<id>.json``, validés contre les schémas."""
    population_dir, election_dir = source / "2022_population", source / "2022_presidentielles"
    revenus = pd.read_csv(population_dir / "revenus.csv", sep=";", dtype={"PCS": str})
    diplomes = pd.read_csv(population_dir / "diplomes.csv", sep=";", dtype={"PCS": str})
    effectifs = (
        pd.read_csv(population_dir / "PCS.csv", sep=";", low_memory=False,
                    dtype={"PCS": str, "NB": float, "SEXE": str})
        .groupby("PCS")["NB"]
        .sum()
    )
    merged = revenus.merge(diplomes, on="PCS", how="inner", validate="one_to_one")
    if set(merged["PCS"]) != set(effectifs.index):
        raise ValueError("revenus, diplomes et PCS.csv ne couvrent pas les mêmes codes")

    commit = _reference_commit(source)
    provenance = f"Commit {commit}. " if commit else ""
    usage = "Usage local uniquement : dépôt sans licence, ne pas publier."
    population_source = "jnthnbs-2022-population"
    items = []
    for record in merged.to_dict("records"):
        code = record["PCS"]
        diplomas = {key: float(record[column]) for key, column in DIPLOMA_COLUMNS.items()}
        item: dict[str, Any] = {
            "code": code,
            "group": code[0],
            "population": float(effectifs[code]),
            "niveau_vie_mensuel_eur": float(record["Niveau de vie"]),
            "patrimoine_keur": float(record["Patrimoine"]),
            "diplomes": diplomas,
            "source_refs": [population_source],
        }
        total = sum(diplomas.values())
        if diplomas["cap"] > 100:
            item["notes"] = "Encodage de la référence : score diplôme forcé via CAP > 100 %."
        elif abs(total - 100) > 1:
            item["notes"] = f"Répartition incomplète dans la source (somme {total:g} %)."
        items.append(item)
    pcs_document = {
        "nomenclature": "PCS2003-N2",
        "reference_year": 2022,
        "sources": [{
            "id": population_source,
            "title": "Saint-Graphique, reproduction JnthnBS : data/2022_population",
            "publisher": "JnthnBS",
            "url": REPOSITORY,
            "accessed": ACCESSED,
            "notes": f"{provenance}{usage} Effectifs : somme de NB, France entière, tous sexes.",
        }],
        "items": items,
    }

    compositions = pd.read_csv(election_dir / "compositions.csv", sep=";", dtype={"PCS": str})
    couleurs = pd.read_csv(election_dir / "couleurs.csv", sep=";")
    communes = pd.read_csv(election_dir / "communes.csv", sep=";", low_memory=False,
                           dtype={"CODGEO": str})
    france = communes.loc[communes["CODGEO"] == FRANCE_ENTIERE].iloc[0]
    colors = dict(zip(couleurs["Labels"], couleurs["Couleurs"], strict=True))
    labels = [str(column) for column in compositions.columns[1:]]
    exprimes = sum(float(france[label]) for label in labels if label != ABSTENTION)
    candidates = []
    for label in labels:
        votes = float(france[label])
        abstention = label == ABSTENTION
        base = votes + exprimes if abstention else exprimes
        candidate: dict[str, Any] = {
            "id": slug(label),
            "label": label,
            "color": colors[label],
            "national_share_pct": round(100 * votes / base, 2),
        }
        if abstention:
            candidate["is_abstention"] = True
        candidates.append(candidate)
    election_document = {
        "id": ELECTION_ID,
        "type": "presidentielle",
        "year": 2022,
        "round": 1,
        "label": "Présidentielle 2022 (1er tour)",
        "pcs_level": 1,
        "sources": [{
            "id": "jnthnbs-2022-presidentielles",
            "title": "Saint-Graphique, reproduction JnthnBS : data/2022_presidentielles",
            "publisher": "JnthnBS",
            "url": REPOSITORY,
            "accessed": ACCESSED,
            "notes": f"{provenance}{usage} Compositions recopiées telles quelles (sommes < 100). "
                     "Abstention en % de (abstentions + exprimés), blancs et nuls non fournis.",
        }],
        "candidates": candidates,
        "composition": {
            slug(label): dict(zip(compositions["PCS"], compositions[label].astype(float).tolist(),
                                  strict=True))
            for label in labels
        },
    }
    validate_instance(pcs_document, "pcs.schema.json", "pcs.json (JnthnBS)")
    validate_instance(election_document, "election.schema.json", f"{ELECTION_ID} (JnthnBS)")
    return pcs_document, election_document


def _write_json(path: Path, document: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
    path.write_text(text, encoding="utf-8", newline="\n")


def convert(source: Path = DEFAULT_SOURCE, destination: Path = DEFAULT_DEST) -> None:
    """Écrit ``pcs.json`` et ``elections/<id>.json`` dans ``destination``."""
    pcs_document, election_document = build_documents(source)
    _write_json(destination / "pcs.json", pcs_document)
    _write_json(destination / "elections" / f"{ELECTION_ID}.json", election_document)


def main(argv: Sequence[str] | None = None) -> int:
    """Point d'entrée ; renvoie le code de sortie."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("source", nargs="?", type=Path, default=DEFAULT_SOURCE,
                        help="dossier data/ de la référence")
    parser.add_argument("destination", nargs="?", type=Path, default=DEFAULT_DEST,
                        help="dossier de sortie (à garder hors du dépôt publié)")
    args = parser.parse_args(argv)
    if not args.source.is_dir():
        print(f"[x] {args.source} introuvable", file=sys.stderr)
        return 1
    convert(args.source, args.destination)
    print(f"[ok] {args.destination}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
