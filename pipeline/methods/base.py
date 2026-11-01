"""Protocole commun des méthodes de placement, registre et barycentres.

Une méthode ne fait que placer les PCS de niveau 2 dans le plan. Le reste (groupes de
niveau 1, électorats, population) s'en déduit par barycentres, via ``assemble_result``.

Ajouter une méthode :
1. créer ``pipeline/methods/<nom>.py`` avec une classe décorée par ``@register`` qui définit
   ``name``, ``label``, ``bootstrap`` et ``compute`` (le module est importé automatiquement) ;
2. déclarer ses paramètres sous ``methods.<nom>`` dans ``config/methods.yaml``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, Protocol, runtime_checkable

import numpy as np

from pipeline.model import POPULATION_ID, Election, Pcs, Point, Result

#: Clés de configuration qui ne sont pas des paramètres de calcul.
METADATA_KEYS = frozenset({"description"})


@runtime_checkable
class Method(Protocol):
    """Méthode de placement.

    - ``name`` : identifiant (clé dans ``config/methods.yaml``, dossier de sortie) ;
    - ``label`` : libellé court pour le front ;
    - ``bootstrap`` : ``True`` si ``pipeline.build`` doit calculer les ellipses de confiance ;
    - ``compute(pcs, election, params)`` : coordonnées des PCS, des groupes, des candidats et
      de la population. ``election=None`` pour la population seule. ``params`` complète les
      valeurs par défaut de la méthode.
    """

    name: str
    label: str
    bootstrap: bool

    def compute(
        self, pcs: Sequence[Pcs], election: Election | None, params: Mapping[str, Any]
    ) -> Result: ...


#: Registre des méthodes disponibles, par nom.
METHODS: dict[str, Method] = {}

def register[C: type](cls: C) -> C:
    """Décorateur de classe : instancie la méthode et l'inscrit dans ``METHODS``."""
    instance = cls()
    if not isinstance(instance, Method):
        raise TypeError(f"{cls.__name__} n'implémente pas le protocole Method")
    current = METHODS.get(instance.name)
    if current is not None and _qualname(type(current)) != _qualname(cls):
        raise ValueError(f"Une méthode nommée {instance.name!r} est déjà enregistrée")
    METHODS[instance.name] = instance
    return cls


def _qualname(cls: type) -> str:
    return f"{cls.__module__}.{cls.__qualname__}"


def get_method(name: str) -> Method:
    """Méthode enregistrée sous ``name`` ; ``KeyError`` explicite sinon."""
    try:
        return METHODS[name]
    except KeyError:
        known = ", ".join(sorted(METHODS))
        raise KeyError(f"Méthode inconnue : {name!r} (disponibles : {known})") from None


def effective_params(defaults: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    """Paramètres par défaut complétés par ``params`` (sans les clés descriptives)."""
    merged = dict(defaults)
    merged.update({k: v for k, v in params.items() if k not in METADATA_KEYS})
    return merged


def _barycenter(weights: np.ndarray, xs: np.ndarray, ys: np.ndarray) -> Point | None:
    """Barycentre pondéré ; ``None`` si le poids total est nul."""
    total = np.sum(weights)
    if total <= 0:
        return None
    return Point(float(np.sum(weights * xs) / total), float(np.sum(weights * ys) / total))


def candidate_points(
    election: Election,
    pcs: Sequence[Pcs],
    pcs_points: Mapping[str, Point],
    group_points: Mapping[str, Point],
    candidate_pcs_level: int = 1,
) -> dict[str, Point]:
    """Barycentre de chaque électorat, pondéré par sa composition.

    Niveau 1 (référence) : barycentre des groupes. Niveau 2 : barycentre des PCS détaillées,
    possible seulement si l'élection est ventilée au niveau 2 ; une composition de niveau 2
    est sinon agrégée par groupe. Les clés sans point correspondant sont ignorées (comme la
    jointure de la référence) et un candidat de poids total nul est omis.
    """
    use_pcs = candidate_pcs_level == 2 and election.pcs_level == 2
    anchors = pcs_points if use_pcs else group_points
    group_of = {p.code: p.group for p in pcs}
    points: dict[str, Point] = {}
    for candidate in election.candidates:
        shares = dict(election.composition.get(candidate.id, {}))
        if election.pcs_level == 2 and not use_pcs:
            by_group: dict[str, float] = {}
            for code, share in shares.items():
                if code in group_of:
                    by_group[group_of[code]] = by_group.get(group_of[code], 0.0) + share
            shares = by_group
        keys = [k for k in anchors if k in shares]
        if not keys:
            continue
        point = _barycenter(
            np.array([shares[k] for k in keys], dtype=float),
            np.array([anchors[k].x for k in keys]),
            np.array([anchors[k].y for k in keys]),
        )
        if point is not None:
            points[candidate.id] = point
    return points


def assemble_result(
    method: str,
    params: Mapping[str, Any],
    pcs: Sequence[Pcs],
    xs: Sequence[float] | np.ndarray,
    ys: Sequence[float] | np.ndarray,
    election: Election | None,
) -> Result:
    """Construit le ``Result`` à partir des coordonnées des PCS de niveau 2.

    - groupe de niveau 1 : barycentre de ses PCS, pondéré par leur population ;
    - population : barycentre de toutes les PCS, pondéré par leur population ;
    - candidat : voir ``candidate_points`` (niveau ``params["candidate_pcs_level"]``, 1 par
      défaut).
    """
    x = np.asarray(xs, dtype=float)
    y = np.asarray(ys, dtype=float)
    if x.shape != (len(pcs),) or y.shape != (len(pcs),):
        raise ValueError("une coordonnée x et une coordonnée y par PCS sont attendues")
    population = np.array([p.population for p in pcs], dtype=float)
    pcs_points = {p.code: Point(float(xi), float(yi)) for p, xi, yi in zip(pcs, x, y, strict=True)}

    groups = np.array([p.group for p in pcs])
    group_points: dict[str, Point] = {}
    for code in dict.fromkeys(groups.tolist()):
        mask = groups == code
        point = _barycenter(population[mask], x[mask], y[mask])
        if point is not None:
            group_points[code] = point

    overall = _barycenter(population, x, y)
    if overall is None:
        raise ValueError("population totale nulle")
    candidates = (
        {}
        if election is None
        else candidate_points(
            election, pcs, pcs_points, group_points, int(params.get("candidate_pcs_level", 1))
        )
    )
    return Result(
        method=method,
        params=dict(params),
        election_id=POPULATION_ID if election is None else election.id,
        pcs=pcs_points,
        groups=group_points,
        candidates=candidates,
        population=overall,
    )
