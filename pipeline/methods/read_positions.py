"""Méthode « read_positions » : les PCS sont placées là où le graphique de Chris les affiche.

La formule des axes de Chris n'est pas publiée. Cette méthode ne la reconstruit pas : elle
reprend les 41 positions lues sur ses vidéos (``data/positions_chris.json``, chaque valeur
citée par vidéo et horodatage), puis calcule les électorats comme lui, par barycentre des
groupes de niveau 1.

La plupart des sondages utilisés n'isolent pas les agriculteurs : la clé « 2 » couvre alors
les agriculteurs et les indépendants, comme la ligne « Agriculteurs et prof. indépendantes »
de la matrice v11. ``merge_groups`` fixe ce regroupement, qui ne s'applique pas à un sondage
publiant les agriculteurs à part (1995, 2002).

Saint-Graphique original : Chris et la PaduTeam.
"""

from __future__ import annotations

import dataclasses
import functools
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import numpy as np

from pipeline.methods.base import (
    _barycenter,
    assemble_result,
    candidate_points,
    effective_params,
    register,
)
from pipeline.model import Election, Pcs, PcsData, Point, Result

POSITIONS_FILE = Path(__file__).resolve().parents[2] / "data" / "positions_chris.json"
WEIGHT_NOTES = {
    "read": "Position et poids lus sur le graphique de Chris.",
    "census": "Position lue sur le graphique de Chris, poids estimé d'après le recensement.",
    "disc": "Position lue sur le graphique de Chris, poids estimé d'après la taille du disque.",
}


@functools.lru_cache(maxsize=1)
def load_positions(path: Path = POSITIONS_FILE) -> dict[str, Any]:
    """Contenu de ``data/positions_chris.json``."""
    return json.loads(path.read_text(encoding="utf-8"))


def read_items(path: Path = POSITIONS_FILE) -> tuple[Pcs, ...]:
    """Postes lus, sous forme de ``Pcs`` dont la population vaut le poids lu.

    Ces postes n'ont ni niveau de vie, ni patrimoine, ni diplômes : ``nan`` et un dictionnaire
    vide feront échouer tout calcul qui les utiliserait par erreur.
    """
    return tuple(
        Pcs(
            code=item["code"],
            group=item["group"],
            label=item["label"],
            short=item["short"],
            population=float(item["weight_pct"]),
            niveau_vie_mensuel_eur=float("nan"),
            patrimoine_keur=float("nan"),
            diplomes={},
        )
        for item in load_positions(path)["items"]
    )


def _merged_anchors(
    groups: Mapping[str, Point],
    items: Sequence[Pcs],
    merge_groups: Mapping[str, Sequence[str]],
) -> dict[str, Point]:
    """Points d'ancrage des électorats : groupes, avec les regroupements demandés."""
    anchors = dict(groups)
    for target, members in merge_groups.items():
        kept = [p for p in items if p.group in members]
        point = _barycenter(
            np.array([p.population for p in kept], dtype=float),
            np.array([groups[p.group].x for p in kept]),
            np.array([groups[p.group].y for p in kept]),
        )
        if point is not None:
            anchors[target] = point
    return anchors


def _needed_merges(
    election: Election, merge_groups: Mapping[str, Sequence[str]]
) -> dict[str, Sequence[str]]:
    """Regroupements utiles à cette élection : aucun si le sondage publie ces groupes à part."""
    published = {key for shares in election.composition.values() for key in shares}
    return {
        target: members
        for target, members in merge_groups.items()
        if not published & (set(members) - {target})
    }


def _by_group(election: Election, pcs: Sequence[Pcs]) -> Election:
    """Élection ramenée au niveau 1, avec les codes de la nomenclature des données."""
    group_of = {p.code: p.group for p in pcs}
    composition: dict[str, dict[str, float]] = {}
    for candidate, shares in election.composition.items():
        totals: dict[str, float] = {}
        for code, share in shares.items():
            if code in group_of:
                totals[group_of[code]] = totals.get(group_of[code], 0.0) + share
        composition[candidate] = totals
    return dataclasses.replace(election, pcs_level=1, composition=composition)


@register
class ReadPositions:
    """Positions lues sur le graphique de Chris, électorats par barycentre."""

    name = "read_positions"
    label = "Positions lues (Chris)"
    bootstrap = True
    #: Les poids lus sont des parts en pourcentage : ils ne sont pas renormalisés à l'affichage.
    weight_total = 100.0
    default_params: Mapping[str, Any] = {"merge_groups": {"2": ["1", "2"]}, "range": [-10, 10]}

    @property
    def sources(self) -> list[dict[str, Any]]:
        """Vidéos dont viennent les positions, et recensement utilisé pour une partie des poids."""
        return load_positions()["sources"]

    @property
    def pcs_notes(self) -> dict[str, str]:
        """Provenance du poids de chaque poste, affichée dans son infobulle."""
        return {
            item["code"]: WEIGHT_NOTES[item["weight_status"]] for item in load_positions()["items"]
        }

    def display_data(self, pcs_data: PcsData) -> PcsData:
        """Données à écrire dans les fichiers calculés : les postes lus, pas les 30 PCS."""
        return dataclasses.replace(pcs_data, items=read_items())

    def compute(
        self, pcs: Sequence[Pcs], election: Election | None, params: Mapping[str, Any]
    ) -> Result:
        """Coordonnées lues ; ``pcs`` ne sert qu'à lire une élection de niveau 2."""
        p = effective_params(self.default_params, params)
        positions = load_positions()["items"]
        items = read_items()
        result = assemble_result(
            self.name,
            p,
            items,
            [float(i["x"]) for i in positions],
            [float(i["y"]) for i in positions],
            None,
        )
        if election is None:
            return result
        level_one = _by_group(election, pcs) if election.pcs_level == 2 else election
        merges = _needed_merges(level_one, p["merge_groups"])
        anchors = _merged_anchors(result.groups, items, merges)
        candidates = candidate_points(level_one, items, result.pcs, anchors, 1)
        return dataclasses.replace(result, election_id=election.id, candidates=candidates)
