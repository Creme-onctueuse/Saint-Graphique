"""Composition sociale des électorats, d'après des sondages publiés.

Les rapports étant des PDF, leurs tableaux sont transcrits à la main dans
``pipeline/sources/manual/<election>.csv``, avec la source, les pages et l'empreinte du PDF en
en-tête. Deux formes de tableaux coexistent, indiquées par ``# kind:`` :

- ``composition`` : le sondage publie directement la part de chaque groupe dans l'électorat
  (Ifop, « en composition »). Aucune conversion : c'est la source retenue pour ``data/`` ;
- ``vote`` : le sondage publie le vote de chaque groupe (Ipsos). La conversion de Bayes donne
  ``composition[c][g] = vote[g][c]·poids[g] / Σ_g vote[g][c]·poids[g]``, où ``poids`` est
  l'effectif du groupe parmi les inscrits, multiplié par sa participation pour un candidat.

Les parts publiées incluent « Autre inactif » (groupe 8), hors des 30 PCS : il est retiré et les
parts sont ramenées à 100 sur les groupes restants. Aucun sondage consulté n'isole les
agriculteurs : la clé « 1 » est absente plutôt que fixée à une valeur fictive.
"""

from __future__ import annotations

import io
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

from pipeline.sources._common import (
    MANUAL_DIR,
    cache_dir,
    download,
    load_elections_config,
    source_ref,
)

GROUPS_IN_CHART: tuple[str, ...] = ("1", "2", "3", "4", "5", "6", "7")
ALL_GROUPS: tuple[str, ...] = (*GROUPS_IN_CHART, "8")
CONTROL_DIR = MANUAL_DIR / "controle"

#: Couleurs partisanes usuelles, choisies pour ce projet (repères visuels, pas des données).
FAMILY_COLORS: dict[str, str] = {
    "exg": "#7b1113",
    "npa": "#b3261e",
    "pcf": "#c8102e",
    "lfi": "#e5383b",
    "generation": "#d81b8c",
    "ps": "#f06292",
    "dvg": "#ef9a9a",
    "ecologie": "#2e9e4f",
    "animaliste": "#7cb342",
    "majorite": "#f9a825",
    "centre": "#ffcc80",
    "udi": "#4fa3d1",
    "lr": "#1565c0",
    "dvd": "#6f9fd8",
    "dlf": "#303f9f",
    "patriotes": "#283593",
    "rn": "#0d1b4c",
    "reconquete": "#3e2723",
    "lassalle": "#8d8d5a",
    "upr": "#00897b",
    "alliance_jaune": "#fdd835",
    "divers": "#8e8e8e",
    "abstention": "#000000",
}


#: Mention de réutilisation figurant dans les rapports, par institut (début de ``publisher``).
REUSE_NOTICE: dict[str, str] = {
    "Ifop": (
        "Rapport © Ifop. Il indique : « Aucune publication totale ou partielle ne peut être "
        "faite sans l'accord exprès de l'Ifop. » Aucun accord n'est documenté dans ce dépôt, "
        "voir data/SOURCES.md."
    ),
    "Ipsos": "Rapport © Ipsos, aucune licence de réutilisation indiquée.",
}


@dataclass(frozen=True)
class PollTable:
    """Tableau transcrit : ``rows`` est indexé par candidat, ``groups`` liste ses colonnes."""

    election_id: str
    meta: Mapping[str, str]
    rows: pd.DataFrame
    groups: tuple[str, ...]

    @property
    def kind(self) -> str:
        return self.meta["kind"]


def parse_manual_csv(path: Path, election_id: str | None = None) -> PollTable:
    """Lit un CSV manuel : en-tête ``# clé: valeur``, puis une ligne par candidat.

    Le tiret des rapports (« - ») est lu comme 0.
    """
    path = Path(path)
    meta: dict[str, str] = {}
    body: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("#"):
            key, _, value = line[1:].partition(":")
            meta[key.strip()] = value.strip()
        elif line.strip():
            body.append(line)
    for key in ("source_id", "title", "url", "accessed", "kind", "cache_file", "group_labels"):
        if key not in meta:
            raise ValueError(f"{path} : en-tête « {key} » manquant")
    if meta["kind"] not in ("composition", "vote"):
        raise ValueError(f"{path} : kind inconnu : {meta['kind']!r}")
    raw = pd.read_csv(io.StringIO("\n".join(body)), dtype=str, keep_default_na=False)
    groups = tuple(c for c in raw.columns if c in ALL_GROUPS)
    if not groups:
        raise ValueError(f"{path} : aucune colonne de groupe")
    rows = pd.DataFrame(index=pd.Index(raw["candidate_id"], name="candidate_id"))
    rows["label"] = raw["label"].to_numpy()
    rows["famille"] = raw["famille"].to_numpy()
    rows["national_share_pct"] = pd.to_numeric(raw["national_share_pct"]).to_numpy()
    rows["is_abstention"] = (raw["is_abstention"] == "true").to_numpy()
    for group in groups:
        rows[group] = pd.to_numeric(raw[group].replace("-", "0")).to_numpy(dtype=float)
    if rows.index.has_duplicates:
        raise ValueError(f"{path} : candidat en double")
    unknown = sorted(set(rows["famille"]) - FAMILY_COLORS.keys())
    if unknown:
        raise ValueError(f"{path} : familles sans couleur : {unknown}")
    return PollTable(election_id or path.stem, meta, rows, groups)


def bayes_composition(vote: pd.DataFrame, weights: pd.Series) -> pd.DataFrame:
    """Vote par groupe -> composition des électorats (en %, somme 100 par candidat).

    ``vote`` : candidats en lignes, groupes en colonnes, % de chaque groupe votant pour chaque
    candidat. ``weights`` : poids de chaque groupe. Un candidat sans voix lève ``ValueError``.
    """
    aligned = weights.reindex(vote.columns)
    if aligned.isna().any():
        raise ValueError(f"Poids manquants : {list(aligned[aligned.isna()].index)}")
    joint = vote.mul(aligned, axis=1)
    totals = joint.sum(axis=1)
    if (totals <= 0).any():
        raise ValueError(f"Candidats sans voix : {list(totals[totals <= 0].index)}")
    return joint.div(totals, axis=0) * 100.0


def implied_national_shares(vote: pd.DataFrame, weights: pd.Series) -> pd.Series:
    """Score national impliqué : ``Σ_g vote[g][c]·poids[g] / Σ_g poids[g]`` (contrôle)."""
    aligned = weights.reindex(vote.columns)
    return vote.mul(aligned, axis=1).sum(axis=1) / aligned.sum()


def composition_from_vote(table: PollTable, inscrits: pd.Series) -> pd.DataFrame:
    """Conversion de Bayes d'un tableau ``vote``, l'abstention par groupe pondérant les votants.

    Le vote d'un groupe porte sur ses votants et l'abstention sur ses inscrits : le poids d'un
    candidat est ``inscrits[g]·(1 - abstention[g])``, celui de l'abstention ``inscrits[g]``.
    """
    groups = list(table.groups)
    matrix = table.rows[groups].astype(float)
    is_abstention = table.rows["is_abstention"]
    out = []
    if is_abstention.any():
        abstention = matrix[is_abstention].iloc[0]
        votants = inscrits.reindex(groups) * (1.0 - abstention / 100.0)
        out.append(bayes_composition(matrix[~is_abstention], votants))
        out.append(bayes_composition(matrix[is_abstention], inscrits))
    else:
        out.append(bayes_composition(matrix, inscrits))
    return pd.concat(out).loc[table.rows.index]


def published_composition(table: PollTable) -> pd.DataFrame:
    """Parts publiées, ramenées à 100 sur les groupes du graphique (sans « Autre inactif »)."""
    groups = [g for g in table.groups if g in GROUPS_IN_CHART]
    matrix = table.rows[groups].astype(float)
    return matrix.div(matrix.sum(axis=1), axis=0) * 100.0


def table_composition(table: PollTable, inscrits: pd.Series | None = None) -> pd.DataFrame:
    """Composition en % d'un tableau, quelle que soit sa forme."""
    if table.kind == "composition":
        return published_composition(table)
    if inscrits is None:
        raise ValueError("Un tableau « vote » demande les effectifs d'inscrits par groupe")
    result = composition_from_vote(table, inscrits)
    return result[[g for g in table.groups if g in GROUPS_IN_CHART]]


def manual_path(election_id: str) -> Path:
    return MANUAL_DIR / f"{election_id}.csv"


def load_table(election_id: str) -> PollTable:
    return parse_manual_csv(manual_path(election_id), election_id)


def available_elections() -> list[dict[str, Any]]:
    """Élections de la configuration qui ont un tableau transcrit."""
    return [e for e in load_elections_config() if manual_path(e["id"]).exists()]


def missing_elections() -> list[dict[str, Any]]:
    """Élections de la configuration sans tableau transcrit (fichier non produit)."""
    return [e for e in load_elections_config() if not manual_path(e["id"]).exists()]


def _reuse_notice(publisher: str) -> str | None:
    return next((text for name, text in REUSE_NOTICE.items() if publisher.startswith(name)), None)


def source_of(table: PollTable) -> dict[str, str]:
    """Référence de source de l'élection : traitement appliqué, mention de l'institut."""
    meta = table.meta
    notes = [
        f"Échantillon : {meta.get('sample', 'non précisé')}.",
        f"Terrain : {meta.get('fieldwork', 'non précisé')}.",
        f"Tableaux : {meta.get('tables', 'non précisés')}.",
        f"Groupes : {meta['group_labels']}.",
        "Le rapport n'isole pas les agriculteurs : la clé « 1 » est absente, et on ignore s'ils "
        "sont comptés dans le groupe 2.",
        "« Autre inactif » (groupe 8) est retiré et les parts ramenées à 100 sur les groupes "
        "restants ; les parts publiées sont dans pipeline/sources/manual.",
        "national_share_pct : ligne ensemble du sondage (abstention en % des inscrits), pas le "
        "résultat officiel.",
    ]
    if meta.get("notes"):
        notes.append(meta["notes"])
    return source_ref(
        meta["source_id"],
        meta["title"],
        meta["url"],
        meta["accessed"],
        publisher=meta.get("publisher"),
        license=_reuse_notice(meta.get("publisher", "")),
        notes=" ".join(notes),
    )


def election_document(
    config: Mapping[str, Any], table: PollTable, inscrits: pd.Series | None = None
) -> dict[str, Any]:
    """Contenu de ``data/elections/<id>.json`` (format ``schemas/election.schema.json``)."""
    composition = table_composition(table, inscrits)
    candidates: list[dict[str, Any]] = []
    for candidate_id, row in table.rows.iterrows():
        entry: dict[str, Any] = {
            "id": str(candidate_id),
            "label": str(row["label"]),
            "color": FAMILY_COLORS[str(row["famille"])],
            "national_share_pct": float(row["national_share_pct"]),
        }
        if bool(row["is_abstention"]):
            entry["is_abstention"] = True
        candidates.append(entry)
    document: dict[str, Any] = {
        "id": config["id"],
        "type": config["type"],
        "year": config["year"],
        "round": config.get("round", 1),
        "label": config["label"],
        "pcs_level": 1,
        "sources": [source_of(table)],
        "candidates": candidates,
        "composition": {
            str(candidate_id): {g: round(float(v), 2) for g, v in shares.items()}
            for candidate_id, shares in composition.iterrows()
        },
    }
    return document


def compare_with_bayes(
    vote_table: PollTable, composition_table: PollTable, inscrits: pd.Series
) -> pd.DataFrame:
    """Écarts (points) entre un sondage converti par Bayes et un sondage « en composition ».

    La comparaison se fait sur les groupes communs, ramenés à 100 des deux côtés, pour les
    candidats communs.
    """
    bayes = composition_from_vote(vote_table, inscrits)
    published = composition_table.rows[list(composition_table.groups)].astype(float)
    groups = [g for g in bayes.columns if g in published.columns]
    candidates = [c for c in bayes.index if c in published.index]
    left = bayes.loc[candidates, groups]
    right = published.loc[candidates, groups]
    left = left.div(left.sum(axis=1), axis=0) * 100.0
    right = right.div(right.sum(axis=1), axis=0) * 100.0
    gaps = (left - right).abs()
    return pd.DataFrame({"ecart_moyen_pts": gaps.mean(axis=1), "ecart_max_pts": gaps.max(axis=1)})


def load() -> pd.DataFrame:
    """Compositions publiées, format long : ``election_id, candidate_id, group, share_pct``."""
    frames = []
    for election in available_elections():
        table = load_table(election["id"])
        long = table_composition(table).rename_axis(index="candidate_id", columns="group")
        long = long.stack().rename("share_pct").reset_index()
        long.insert(0, "election_id", election["id"])
        frames.append(long)
    return pd.concat(frames, ignore_index=True)


def control_table() -> PollTable:
    """Tableau Ipsos 2022 servant uniquement à contrôler la conversion de Bayes."""
    return parse_manual_csv(
        CONTROL_DIR / "ipsos_2022_presidentielle_t1.csv", "2022_presidentielle_t1"
    )


def fetch(force: bool = False) -> list[str]:
    """Met en cache les PDF cités, pour vérifier les transcriptions ; renvoie les échecs.

    Les données viennent des CSV transcrits : un PDF indisponible n'empêche pas la construction.
    La vérification TLS reste active, même si ``www.ifop.com`` sert une chaîne de certificats que
    ``requests`` ne sait pas toujours compléter : le PDF se récupère alors à la main.
    """
    import requests

    tables = [load_table(e["id"]) for e in available_elections()]
    tables.append(control_table())
    failures: list[str] = []
    for table in tables:
        dest = cache_dir("sondages", table.election_id) / table.meta["cache_file"]
        try:
            download(table.meta["url"], dest, force=force)
        except requests.RequestException as exc:
            failures.append(f"{table.meta['url']} ({type(exc).__name__})")
    return failures
