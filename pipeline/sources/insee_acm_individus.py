"""Agrégat du recensement 2022 pour la méthode ``acm_individus``.

Le fichier détail « Individus localisés à la région » (voir ``_rp2022_indreg``) est lu par morceaux
et réduit à un tableau croisé pondéré. Seul ce tableau est commité (``data/acm_individus.json``),
jamais les microdonnées.

Usage : ``uv run python -m pipeline.sources.insee_acm_individus [--force]``

Champ : 15 ans ou plus, hors personnes inscrites dans un établissement d'enseignement (``ETUD = 2``,
dont le diplôme n'est pas définitif, même convention que ``insee_diplomes``), classées dans les
30 PCS (``_rp2022_indreg.classify``).

Colonnes du fichier (dictionnaire : ``varmod_indreg_2022.csv``) et recodages :

- ``DIPL`` → ``diplome`` : les 7 catégories du reste du projet (``DIPL_TO_KEY``) ;
- ``STOCD`` → ``logement`` : ``proprietaire`` (10), ``locataire_prive`` (21, loué vide hors HLM ;
  23, meublé), ``hlm`` (22), ``autre`` (30, logé gratuitement ; ZZ, hors logement ordinaire). Les
  deux derniers codes sont réunis parce que chacun est rare et qu'aucun ne dit un statut de
  propriété ;
- ``EMPL``, ``TP`` et ``TACT`` → ``emploi`` : ``employeur`` (22), ``independant`` (21 ; 23, aide
  familial), ``stable_complet`` et ``stable_partiel`` (16, CDI ou titulaire, selon ``TP``),
  ``duree_limitee`` (11 à 15 : apprentissage, intérim, emplois aidés, stages, CDD), ``chomage``
  (``TACT = 12``). Les retraités (``TACT = 21``) n'ont pas de modalité : voir ci-dessous.
- ``AGEREV`` → classe d'âge, pour lire les axes après coup (variable non active).
- ``IPONDI`` : poids de l'individu, sommé puis arrondi à l'unité. ``STAT_CS`` : la PCS.

Trois choix sur l'emploi, pris pour éviter un artefact de codage et non pour orienter le résultat :

- ``STAT`` n'est pas retenu : il est entièrement contenu dans ``EMPL`` (salariés 11 à 16, puis 21,
  22, 23, et ZZ partout ailleurs). Le garder compterait deux fois la même information.
  ``aggregate_frame`` vérifie cette inclusion à chaque lecture ;
- ``TP`` est fondu dans ``emploi`` plutôt que gardé à part : il vaut « sans objet » pour tous les
  chômeurs, et deux variables portant le même « sans objet » créeraient un axe du seul fait du
  codage. Il ne distingue que les emplois stables : temps complet et partiel se comptent ailleurs
  en trop faibles effectifs ;
- les retraités n'ont ni ``EMPL`` ni ``TP`` : leur donner une modalité ferait de l'axe 1 une
  opposition entre générations (vérifié, voir ``docs/methodologie.md``). Ils restent donc hors du
  calcul des axes.

Le recensement ne donne ni revenu ni patrimoine : le capital économique n'y est approché que par la
propriété du logement et le statut d'emploi.
"""

from __future__ import annotations

import argparse
import json
import zipfile
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pandas as pd

from pipeline.sources import _rp2022_indreg as rp
from pipeline.sources._common import (
    DIPLOMA_KEYS,
    PCS_CODES,
    file_meta,
    write_meta,
)

OUTPUT = Path(__file__).resolve().parents[2] / "data" / "acm_individus.json"
AGG_NAME = "agregat_acm_individus.csv"
USECOLS = ["AGEREV", "DIPL", "EMPL", "ETUD", "IPONDI", "STAT", "STAT_CS", "STOCD", "TACT", "TP"]
KEYS = ["pcs", "diplome", "logement", "emploi", "age"]
TEXT = {key: "string" for key in KEYS}

LOGEMENTS = ("proprietaire", "locataire_prive", "hlm", "autre")
EMPLOIS = ("employeur", "independant", "stable_complet", "stable_partiel", "duree_limitee",
           "chomage")
#: Personnes sans modalité d'emploi : elles ne participent pas au calcul des axes.
RETRAITE = "retraite"
AGES = ("15-29", "30-44", "45-59", "60+")
AGE_BINS = (14, 29, 44, 59, 200)

#: STOCD (RP 2022) -> ``logement``.
STOCD_TO_LOGEMENT: dict[str, str] = {
    "10": "proprietaire",
    "21": "locataire_prive",
    "23": "locataire_prive",
    "22": "hlm",
    "30": "autre",
    "ZZ": "autre",
}
#: EMPL (RP 2022) -> STAT : ``STAT`` se déduit de ``EMPL``, il n'apporte rien de plus.
EMPL_TO_STAT: dict[str, str] = {
    **dict.fromkeys(("11", "12", "13", "14", "15", "16"), "10"),
    "21": "21",
    "22": "22",
    "23": "23",
    "ZZ": "ZZ",
}

VARIABLES: dict[str, dict[str, Any]] = {
    "diplome": {
        "label": "Plus haut diplôme",
        "columns": ["DIPL"],
        "modalities": list(DIPLOMA_KEYS),
    },
    "logement": {
        "label": "Statut d'occupation du logement",
        "columns": ["STOCD"],
        "modalities": list(LOGEMENTS),
    },
    "emploi": {
        "label": "Statut et condition d'emploi",
        "columns": ["EMPL", "TP", "TACT"],
        "modalities": list(EMPLOIS),
    },
}


def employment(empl: pd.Series, tp: pd.Series, tact: pd.Series) -> pd.Series:
    """Modalité d'emploi de chaque individu ; ``retraite`` si ``TACT = 21``, vide hors champ."""
    out = pd.Series(pd.NA, index=empl.index, dtype="string")
    out = out.mask(empl == "22", "employeur")
    out = out.mask(empl.isin(["21", "23"]), "independant")
    out = out.mask(empl == "16", "stable_partiel")
    out = out.mask((empl == "16") & (tp == "1"), "stable_complet")
    out = out.mask(empl.isin(["11", "12", "13", "14", "15"]), "duree_limitee")
    out = out.mask(tact == "12", "chomage")
    return out.mask(tact == "21", RETRAITE)


def aggregate_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Réduit un morceau du fichier détail à ``pcs × diplome × logement × emploi × age``."""
    empl = df["EMPL"].astype("string")
    if not (df["STAT"].astype("string") == empl.map(EMPL_TO_STAT)).all():
        raise ValueError("STAT n'est plus contenu dans EMPL : revoir le choix des variables")
    age = pd.to_numeric(df["AGEREV"], errors="coerce")
    pcs = rp.classify(df["STAT_CS"], df["TACT"])
    keep = (age >= 15) & (df["ETUD"].astype("string") == "2") & (pcs != rp.OTHER_CODE)
    out = pd.DataFrame(
        {
            "pcs": pcs[keep],
            "diplome": df.loc[keep, "DIPL"].astype("string").map(rp.DIPL_TO_KEY),
            "logement": df.loc[keep, "STOCD"].astype("string").map(STOCD_TO_LOGEMENT),
            "emploi": employment(empl[keep], df.loc[keep, "TP"].astype("string"),
                                 df.loc[keep, "TACT"].astype("string")),
            "age": pd.cut(age[keep], list(AGE_BINS), labels=list(AGES)).astype("string"),
            "poids": pd.to_numeric(df.loc[keep, "IPONDI"], errors="coerce").fillna(0.0),
        }
    )
    unknown = out[KEYS].isna().any(axis=1)
    if unknown.any():
        sample = out.loc[unknown, KEYS].drop_duplicates().head(5).to_dict("records")
        raise ValueError(f"Individus du champ sans modalité : {sample}")
    return out.groupby(KEYS, as_index=False, observed=True, sort=False)["poids"].sum()


def aggregate_zip(path: Path, chunksize: int = 500_000) -> pd.DataFrame:
    """Lit le fichier détail par morceaux, en ne gardant que l'agrégat en mémoire."""
    total: pd.DataFrame | None = None
    with zipfile.ZipFile(path) as zf, zf.open(rp.MEMBER) as fh:
        reader = pd.read_csv(
            fh,
            sep=";",
            usecols=USECOLS,
            dtype={c: "string" for c in USECOLS if c != "IPONDI"} | {"IPONDI": "float64"},
            chunksize=chunksize,
            encoding="utf-8",
            keep_default_na=False,
        )
        for chunk in reader:
            part = aggregate_frame(chunk)
            merged = part if total is None else pd.concat([total, part], ignore_index=True)
            total = merged.groupby(KEYS, as_index=False, observed=True, sort=False)["poids"].sum()
    if total is None:
        raise ValueError(f"{path} : fichier détail vide")
    return total


def agg_path() -> Path:
    """Chemin de l'agrégat dans le cache (hors dépôt)."""
    return rp.cache_dir(rp.SUBDIR) / AGG_NAME


def fetch(force: bool = False) -> pd.DataFrame:
    """Agrégat complet : calculé une fois depuis le zip (téléchargé s'il manque), puis en cache."""
    path = agg_path()
    if force or not path.exists():
        raw = rp.download(rp.ZIP_URL, rp.zip_path())
        agg = aggregate_zip(raw)
        tmp = path.with_name(path.name + ".part")
        agg.to_csv(tmp, index=False, encoding="utf-8")
        tmp.replace(path)
        write_meta(path, rp.ZIP_URL, file_meta(raw).get("accessed"))
    return pd.read_csv(path, dtype=TEXT | {"poids": "float64"}, keep_default_na=False)


def _index(values: pd.Series, modalities: list[str]) -> pd.Series:
    return values.map({m: i for i, m in enumerate(modalities)})


def document(agg: pd.DataFrame, source: Mapping[str, str]) -> dict[str, Any]:
    """Contenu de ``data/acm_individus.json``, stable d'une exécution à l'autre.

    Une ligne de ``rows`` : code PCS, indice du diplôme, du logement, de l'emploi (``null`` pour un
    retraité), poids arrondi à l'unité. ``age_rows`` a la même forme, avec la classe d'âge à la
    place de la PCS, pour les seuls individus actifs de l'ACM.
    """
    order = {code: i for i, code in enumerate(PCS_CODES)}
    frame = agg.assign(
        d=_index(agg["diplome"], VARIABLES["diplome"]["modalities"]),
        l=_index(agg["logement"], VARIABLES["logement"]["modalities"]),
        e=_index(agg["emploi"], VARIABLES["emploi"]["modalities"]),
    )
    if frame["d"].isna().any() or frame["l"].isna().any():
        raise ValueError("Diplôme ou logement hors des modalités déclarées")
    if frame.loc[frame["emploi"] != RETRAITE, "e"].isna().any():
        raise ValueError("Emploi hors des modalités déclarées")

    def rows(source_frame: pd.DataFrame, key: str, rank: Mapping[str, int]) -> list[list[Any]]:
        grouped = source_frame.groupby([key, "d", "l", "e"], dropna=False, as_index=False)[
            "poids"
        ].sum()
        grouped = grouped[grouped["poids"].round() > 0]
        keys = grouped[key].map(rank).to_numpy()
        table = grouped.assign(_rank=keys, e=grouped["e"].fillna(-1)).sort_values(
            ["_rank", "d", "l", "e"]
        )
        return [
            [str(r[key]), int(r["d"]), int(r["l"]), None if r["e"] < 0 else int(r["e"]),
             int(round(r["poids"]))]
            for _, r in table.iterrows()
        ]

    pcs_rows = rows(frame, "pcs", order)
    if {r[0] for r in pcs_rows} != set(PCS_CODES):
        raise ValueError("PCS absente du tableau croisé")
    age_rows = rows(frame[frame["emploi"] != RETRAITE], "age", {a: i for i, a in enumerate(AGES)})
    return {
        "description": (
            "Tableau croisé pondéré du recensement 2022 pour la méthode acm_individus (voir "
            "pipeline/sources/insee_acm_individus.py). Fichier généré, sans microdonnées."
        ),
        "reference_year": 2022,
        "field": (
            "France hors Mayotte, 15 ans ou plus, hors personnes inscrites dans un établissement "
            "d'enseignement (ETUD = 2), classées dans les 30 PCS. Poids : somme de IPONDI, "
            "arrondie."
        ),
        "sources": [dict(source)],
        "weights_column": "IPONDI",
        "variables": VARIABLES,
        "ages": list(AGES),
        "row_format": ["groupe", "diplome", "logement", "emploi", "poids"],
        "rows": pcs_rows,
        "age_rows": age_rows,
    }


def dumps(doc: Mapping[str, Any]) -> str:
    """JSON lisible : une ligne du tableau croisé par ligne de fichier."""
    head = {k: v for k, v in doc.items() if k not in ("rows", "age_rows")}
    text = json.dumps(head, ensure_ascii=False, indent=2)
    blocks = [text[: text.rindex("}")].rstrip()]
    for key in ("rows", "age_rows"):
        lines = ",\n".join(
            "    " + json.dumps(row, separators=(",", ":"), ensure_ascii=False) for row in doc[key]
        )
        blocks.append(f',\n  "{key}": [\n{lines}\n  ]')
    return "".join(blocks) + "\n}\n"


def write_data(path: Path = OUTPUT, force: bool = False) -> Path:
    """Écrit le tableau croisé à commiter ; ``force`` relit le fichier détail."""
    text = dumps(document(fetch(force=force), rp.source()))
    path.write_text(text, encoding="utf-8", newline="\n")
    return path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="relit le fichier détail")
    args = parser.parse_args(argv)
    path = write_data(force=args.force)
    print(f"{path.name} : {path.stat().st_size} octets")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
