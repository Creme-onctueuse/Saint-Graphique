"""Modèle de données typé et chargeurs validés.

Les fichiers ``data/pcs.json`` et ``data/elections/<id>.json`` sont validés contre leurs JSON
Schemas (``schemas/``) au chargement. Les libellés et couleurs des PCS et des groupes viennent
de ``config/pcs.yaml`` : les fichiers de données ne portent que des chiffres sourcés.
"""

from __future__ import annotations

import json
import warnings
from collections.abc import Mapping
from dataclasses import dataclass, replace
from functools import cache
from pathlib import Path
from typing import Any, NamedTuple

import yaml
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"
SCHEMAS_DIR = ROOT / "schemas"
DATA_DIR = ROOT / "data"

#: Clés de la répartition des diplômes, du plus élevé au plus faible.
DIPLOMA_KEYS: tuple[str, ...] = ("bac5", "bac3", "bac2", "bac", "cap", "brevet", "certif_aucun")
#: Identifiant réservé au calcul sans élection (population seule).
POPULATION_ID = "population"


class DataValidationError(ValueError):
    """Un fichier ne respecte pas son schéma ou une règle de cohérence."""


class Point(NamedTuple):
    """Position dans le plan : x = exploitation, y = domination."""

    x: float
    y: float


class Ellipse(NamedTuple):
    """Ellipse de confiance centrée sur le point estimé.

    ``rx`` est le demi-grand axe, ``ry`` le demi-petit axe (mêmes unités que x et y).
    ``angle_deg`` est l'angle de ``rx`` par rapport à l'axe des x, en degrés, compté dans le sens
    trigonométrique dans le repère des données (y vers le haut), normalisé dans ]-90, 90].
    En SVG (y vers le bas), il faut tracer avec ``-angle_deg``.
    """

    rx: float
    ry: float
    angle_deg: float


@dataclass(frozen=True)
class Group:
    """PCS de niveau 1 (groupe socioprofessionnel)."""

    code: str
    label: str
    color: str


@dataclass(frozen=True)
class Pcs:
    """PCS de niveau 2 et ses indicateurs socio-économiques."""

    code: str
    group: str
    label: str
    short: str
    population: float
    niveau_vie_mensuel_eur: float
    patrimoine_keur: float
    diplomes: Mapping[str, float]


@dataclass(frozen=True)
class PcsData:
    """Contenu de ``pcs.json``, enrichi des libellés de ``config/pcs.yaml``."""

    nomenclature: str
    reference_year: int
    items: tuple[Pcs, ...]
    groups: Mapping[str, Group]
    sources: tuple[Mapping[str, Any], ...] = ()


@dataclass(frozen=True)
class Candidate:
    """Candidat, liste ou abstention."""

    id: str
    label: str
    color: str
    national_share_pct: float | None = None
    is_abstention: bool = False


@dataclass(frozen=True)
class Election:
    """Composition sociale des électorats d'une élection.

    ``composition[candidat][code]`` est la part (%) de l'électorat du candidat issue de la PCS
    ``code``, de niveau ``pcs_level`` (1 : groupes, 2 : PCS détaillées).
    """

    id: str
    type: str
    year: int
    label: str
    pcs_level: int
    candidates: tuple[Candidate, ...]
    composition: Mapping[str, Mapping[str, float]]
    round: int | None = None
    margin_pts: float | None = None
    sources: tuple[Mapping[str, Any], ...] = ()

    def with_composition(self, composition: Mapping[str, Mapping[str, float]]) -> Election:
        """Copie de l'élection avec d'autres compositions (utilisé par le bootstrap)."""
        return replace(self, composition=composition)


@dataclass(frozen=True)
class Result:
    """Sortie d'une méthode de placement.

    - ``pcs`` : coordonnées des PCS de niveau 2, par code ;
    - ``groups`` : barycentres des groupes de niveau 1, pondérés par la population ;
    - ``candidates`` : barycentres des électorats par identifiant (vide sans élection) ;
    - ``population`` : barycentre de toutes les PCS, pondéré par la population ;
    - ``params`` : paramètres effectivement utilisés (défauts de la méthode + configuration).
    """

    method: str
    params: Mapping[str, Any]
    election_id: str
    pcs: Mapping[str, Point]
    groups: Mapping[str, Point]
    candidates: Mapping[str, Point]
    population: Point


# --- Lecture et validation -------------------------------------------------------------------


def read_json(path: Path) -> Any:
    """Lit un fichier JSON en UTF-8."""
    return json.loads(Path(path).read_text(encoding="utf-8"))


def read_yaml(path: Path) -> Any:
    """Lit un fichier YAML en UTF-8."""
    with Path(path).open(encoding="utf-8") as f:
        return yaml.safe_load(f)


@cache
def _registry() -> Registry:
    """Registre des schémas, pour résoudre les ``$ref`` (ex. ``source.schema.json``)."""
    resources = [
        (p.name, Resource.from_contents(read_json(p)))
        for p in sorted(SCHEMAS_DIR.glob("*.schema.json"))
    ]
    return Registry().with_resources(resources)


@cache
def _validator(schema_name: str) -> Draft202012Validator:
    return Draft202012Validator(read_json(SCHEMAS_DIR / schema_name), registry=_registry())


def validate_instance(instance: Any, schema_name: str, label: str = "") -> None:
    """Valide ``instance`` contre ``schemas/<schema_name>``.

    Lève ``DataValidationError`` en listant toutes les erreurs trouvées.
    """
    errors = sorted(
        _validator(schema_name).iter_errors(instance), key=lambda e: [str(p) for p in e.path]
    )
    if errors:
        lines = [f"{'/'.join(str(p) for p in e.path) or '<racine>'} : {e.message}" for e in errors]
        raise DataValidationError(
            f"{label or 'document'} non conforme à {schema_name} :\n  " + "\n  ".join(lines)
        )


# --- Configuration ---------------------------------------------------------------------------


def load_pcs_config(path: Path = CONFIG_DIR / "pcs.yaml") -> dict[str, Any]:
    """Nomenclature, groupes (libellé, couleur) et libellés des PCS."""
    cfg = read_yaml(path)
    if not isinstance(cfg, dict) or "items" not in cfg or "groups" not in cfg:
        raise DataValidationError(f"{path} : clés 'groups' et 'items' attendues")
    return cfg


def load_methods_config(path: Path = CONFIG_DIR / "methods.yaml") -> dict[str, Any]:
    """Axes (libellés, bornes) et paramètres des méthodes."""
    cfg = read_yaml(path)
    if not isinstance(cfg, dict) or "axes" not in cfg or "methods" not in cfg:
        raise DataValidationError(f"{path} : clés 'axes' et 'methods' attendues")
    return cfg


def load_elections_config(path: Path = CONFIG_DIR / "elections.yaml") -> list[dict[str, Any]]:
    """Liste déclarative des élections couvertes (id, type, année, tour, libellé)."""
    cfg = read_yaml(path) or {}
    return list(cfg.get("elections", []))


# --- Données ---------------------------------------------------------------------------------


def load_pcs(
    path: Path = DATA_DIR / "pcs.json", pcs_config: Mapping[str, Any] | None = None
) -> PcsData:
    """Charge et valide ``pcs.json`` ; ajoute libellés et groupes depuis ``config/pcs.yaml``."""
    path = Path(path)
    raw = read_json(path)
    validate_instance(raw, "pcs.schema.json", str(path))
    cfg = pcs_config if pcs_config is not None else load_pcs_config()
    meta = {str(it["code"]): it for it in cfg["items"]}
    groups = {
        str(code): Group(str(code), str(g["label"]), str(g["color"]))
        for code, g in cfg["groups"].items()
    }

    items: list[Pcs] = []
    seen: set[str] = set()
    for it in raw["items"]:
        code = it["code"]
        if code in seen:
            raise DataValidationError(f"{path} : code PCS en double : {code}")
        seen.add(code)
        m = meta.get(code, {})
        if m and str(m.get("group")) != it["group"]:
            warnings.warn(
                f"{path} : PCS {code} rattachée au groupe {it['group']} "
                f"(config/pcs.yaml : {m.get('group')})",
                stacklevel=2,
            )
        items.append(
            Pcs(
                code=code,
                group=it["group"],
                label=str(m.get("label", code)),
                short=str(m.get("short", m.get("label", code))),
                population=float(it["population"]),
                niveau_vie_mensuel_eur=float(it["niveau_vie_mensuel_eur"]),
                patrimoine_keur=float(it["patrimoine_keur"]),
                diplomes={k: float(it["diplomes"][k]) for k in DIPLOMA_KEYS},
            )
        )
    if sum(p.population for p in items) <= 0:
        raise DataValidationError(f"{path} : population totale nulle")
    for code in sorted({p.group for p in items} - groups.keys()):
        groups[code] = Group(code, f"Groupe {code}", "#7f7f7f")
    return PcsData(
        nomenclature=raw["nomenclature"],
        reference_year=raw["reference_year"],
        items=tuple(items),
        groups=groups,
        sources=tuple(raw["sources"]),
    )


def load_election(path: Path) -> Election:
    """Charge et valide ``elections/<id>.json``."""
    path = Path(path)
    raw = read_json(path)
    validate_instance(raw, "election.schema.json", str(path))
    candidates = tuple(
        Candidate(
            id=c["id"],
            label=c["label"],
            color=c["color"],
            national_share_pct=c.get("national_share_pct"),
            is_abstention=bool(c.get("is_abstention", False)),
        )
        for c in raw["candidates"]
    )
    ids = [c.id for c in candidates]
    if len(set(ids)) != len(ids):
        raise DataValidationError(f"{path} : identifiants de candidats en double")
    unknown = sorted(set(raw["composition"]) - set(ids))
    if unknown:
        raise DataValidationError(f"{path} : composition pour des candidats inconnus : {unknown}")
    composition = {
        cid: {str(code): float(share) for code, share in shares.items()}
        for cid, shares in raw["composition"].items()
    }
    return Election(
        id=raw["id"],
        type=raw["type"],
        year=raw["year"],
        label=raw["label"],
        pcs_level=raw["pcs_level"],
        candidates=candidates,
        composition=composition,
        round=raw.get("round"),
        margin_pts=raw.get("margin_pts"),
        sources=tuple(raw["sources"]),
    )


def load_elections(directory: Path = DATA_DIR / "elections") -> list[Election]:
    """Charge toutes les élections d'un dossier (``<id>.json``), triées par nom de fichier."""
    elections = []
    for path in sorted(Path(directory).glob("*.json")):
        election = load_election(path)
        if election.id != path.stem:
            raise DataValidationError(f"{path} : l'id {election.id!r} ne correspond pas au nom")
        elections.append(election)
    return elections
