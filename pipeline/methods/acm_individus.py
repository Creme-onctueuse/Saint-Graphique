"""Méthode « acm_individus » : ACM sur les individus du recensement 2022, PCS en supplémentaire.

Analyse géométrique des données au sens de Le Roux et Rouanet (*Multiple Correspondence Analysis*,
SAGE, 2010) : les axes viennent des individus, et les catégories sont projetées ensuite, sans
participer à leur calcul. La méthode ``mca``, elle, décrit 30 PCS par des terciles.

Construction (``data/acm_individus.json``, voir ``pipeline/sources/insee_acm_individus.py``) :

1. Individus actifs : les personnes des 29 PCS actives (en emploi ou au chômage, hors scolarisés).
2. Variables actives : diplôme, statut d'occupation du logement, statut et condition d'emploi.
   Chaque profil de réponses (168 au plus) est une ligne du tableau disjonctif, de poids la somme
   des ``IPONDI``. L'ACM est celle de ``mca.fit_weighted_mca`` : exacte, donc déterministe.
3. Supplémentaire : chaque PCS est le barycentre de ses individus, pondérés par ``IPONDI``.
4. Retraités : individus supplémentaires, faute de condition d'emploi. Leur variable manquante
   compte pour zéro, c'est-à-dire qu'elle ne les pousse d'aucun côté : la coordonnée d'un individu
   est la moyenne des coordonnées standard de ses modalités, divisée par les 3 variables actives
   même s'il n'en renseigne que 2. Leur diplôme et leur logement reflètent leur génération.
5. Orientation et échelle : celles de ``mca`` (chefs d'entreprise à droite du barycentre de la
   population, cadres au-dessus), puis min/max sur [-10, 10].

Le recensement ne donne ni revenu ni patrimoine : le capital économique n'est approché que par la
propriété du logement et le statut d'emploi. Le capital culturel n'est mesuré que par le diplôme.

Les axes ne sont pas fixés d'avance et ne valent pas volume et structure : ``analysis`` donne
valeurs propres et contributions, et ``scripts/analyze/methods_report.py`` les lit.
"""

from __future__ import annotations

import functools
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from pipeline.methods.base import assemble_result, effective_params, register
from pipeline.methods.mca import Mca, fit_weighted_mca, orient_axes
from pipeline.methods.scores import minmax_coordinates
from pipeline.model import Election, Pcs, Result

AGGREGATE_FILE = Path(__file__).resolve().parents[2] / "data" / "acm_individus.json"
_POIDS = "poids"
_GROUPE = "groupe"


@dataclass(frozen=True)
class Analysis:
    """Résultat de l'ACM, dans le repère brut (signes arbitraires, avant orientation).

    - ``eigenvalues`` : toutes les valeurs propres ; ``raw_rates`` et ``modified_rates`` : leur part
      de l'inertie, brute et selon le taux modifié de Benzécri (en %) ;
    - ``modalities`` : une ligne par modalité, masse (en % de sa variable), coordonnées principales
      ``c1``, ``c2`` et contributions ``ctr1``, ``ctr2`` (en %) ;
    - ``groups`` : barycentre de chaque groupe (colonne ``groupe``) sur les axes 1 et 2.
    """

    eigenvalues: np.ndarray
    raw_rates: np.ndarray
    modified_rates: np.ndarray
    n_variables: int
    n_active_rows: int
    modalities: pd.DataFrame
    groups: Mapping[str, tuple[float, float]]
    model: Any
    columns: tuple[str, ...]


def indicator_table(profiles: pd.DataFrame, variables: Mapping[str, Sequence[str]]) -> pd.DataFrame:
    """Tableau disjonctif (0/1) : une colonne ``variable=modalité``, une ligne par profil.

    Une valeur manquante ne coche aucune modalité de sa variable : la ligne reste alors incomplète.
    """
    columns = {
        f"{variable}={modality}": (profiles[variable] == modality).fillna(False).astype(float)
        for variable, modalities in variables.items()
        for modality in modalities
    }
    return pd.DataFrame(columns).set_axis(profiles.index)


def profile_coordinates(model: Any, indicator: pd.DataFrame, n_variables: int) -> np.ndarray:
    """Coordonnées principales des profils. Une variable non renseignée compte pour zéro.

    ``row_coordinates`` de prince divise par le nombre de modalités cochées : les profils
    incomplets sont donc ramenés à la division par le nombre de variables actives.
    """
    coords = model.row_coordinates(indicator).to_numpy()
    answered = indicator.sum(axis=1).to_numpy()
    return coords * (answered / n_variables)[:, None]


def modified_rates(eigenvalues: np.ndarray, n_variables: int) -> np.ndarray:
    """Taux modifiés de Benzécri (%) : seules les valeurs propres au-dessus de 1/Q comptent."""
    q = n_variables
    kept = np.where(eigenvalues > 1 / q, (q / (q - 1) * (eigenvalues - 1 / q)) ** 2, 0.0)
    total = kept.sum()
    return np.zeros_like(kept) if total == 0 else 100 * kept / total


def run_analysis(table: pd.DataFrame, variables: Mapping[str, Sequence[str]]) -> Analysis:
    """ACM des lignes complètes de ``table``, tous les groupes étant projetés en supplémentaire.

    ``table`` a une colonne par variable, une colonne ``groupe`` et une colonne ``poids``. Les
    lignes à modalité manquante n'entrent pas dans les axes, ni ``groupe`` : il ne sert qu'à la
    projection.
    """
    names = list(variables)
    q = len(names)
    active = table.dropna(subset=names)
    profiles = active.groupby(names, as_index=False, sort=False)[_POIDS].sum()
    indicator = indicator_table(profiles, variables)
    weights = profiles[_POIDS].to_numpy(dtype=float)
    if np.any((indicator.mul(weights, axis=0)).sum(axis=0) <= 0):
        empty = indicator.columns[(indicator.mul(weights, axis=0)).sum(axis=0) <= 0].tolist()
        raise ValueError(f"ACM : modalités sans effectif actif : {empty}")
    j = indicator.shape[1]
    model = fit_weighted_mca(indicator, weights, j - q)

    eigenvalues = np.asarray(model.eigenvalues_, dtype=float)
    raw = 100 * eigenvalues / eigenvalues.sum()
    standard = model.svd_.V.T / np.sqrt(model.col_masses_.to_numpy())[:, None]
    principal = standard * np.sqrt(eigenvalues)
    modalities = pd.DataFrame(
        {
            "masse": 100 * q * model.col_masses_.to_numpy(),
            "c1": principal[:, 0],
            "c2": principal[:, 1],
            "ctr1": 100 * model.column_contributions_[0].to_numpy(),
            "ctr2": 100 * model.column_contributions_[1].to_numpy(),
        },
        index=indicator.columns,
    )

    coords = profile_coordinates(model, indicator_table(table, variables), q)[:, :2]
    masses = table[_POIDS].to_numpy(dtype=float)
    groups: dict[str, tuple[float, float]] = {}
    labels = table[_GROUPE].to_numpy()
    for group in dict.fromkeys(labels.tolist()):
        mask = labels == group
        total = masses[mask].sum()
        groups[str(group)] = (
            float(np.sum(masses[mask] * coords[mask, 0]) / total),
            float(np.sum(masses[mask] * coords[mask, 1]) / total),
        )
    return Analysis(
        eigenvalues=eigenvalues,
        raw_rates=raw,
        modified_rates=modified_rates(eigenvalues, q),
        n_variables=q,
        n_active_rows=len(profiles),
        modalities=modalities,
        groups=groups,
        model=model,
        columns=tuple(indicator.columns),
    )


def load_table(document: Mapping[str, Any], key: str = "rows") -> pd.DataFrame:
    """Tableau ``groupe, <variables>, poids`` d'après ``data/acm_individus.json``."""
    variables = document["variables"]
    names = list(variables)
    rows = document[key]
    data: dict[str, Any] = {_GROUPE: [r[0] for r in rows]}
    for position, name in enumerate(names, start=1):
        modalities = variables[name]["modalities"]
        data[name] = [None if r[position] is None else modalities[r[position]] for r in rows]
    data[_POIDS] = np.array([r[-1] for r in rows], dtype=float)
    return pd.DataFrame(data)


def variables_of(document: Mapping[str, Any]) -> dict[str, list[str]]:
    """Modalités déclarées, par variable active."""
    return {name: list(v["modalities"]) for name, v in document["variables"].items()}


@functools.lru_cache(maxsize=1)
def load_aggregate(path: Path = AGGREGATE_FILE) -> dict[str, Any]:
    """Contenu de ``data/acm_individus.json``."""
    return json.loads(path.read_text(encoding="utf-8"))


@functools.lru_cache(maxsize=1)
def analysis(path: Path = AGGREGATE_FILE) -> Analysis:
    """ACM du recensement, calculée une fois : elle ne dépend d'aucune élection."""
    document = load_aggregate(path)
    return run_analysis(load_table(document), variables_of(document))


@register
class AcmIndividus:
    """ACM sur les individus du recensement, PCS en points supplémentaires."""

    name = "acm_individus"
    label = "ACM sur les individus"
    bootstrap = True
    default_params: Mapping[str, Any] = {
        "orientation": Mca.default_params["orientation"],
        "candidate_pcs_level": 1,
        "range": [-10, 10],
    }

    def compute(
        self, pcs: Sequence[Pcs], election: Election | None, params: Mapping[str, Any]
    ) -> Result:
        """Barycentres des PCS sur les deux premiers axes de l'ACM."""
        p = effective_params(self.default_params, params)
        groups = analysis().groups
        missing = [q.code for q in pcs if q.code not in groups]
        if missing:
            raise ValueError(f"ACM : PCS absentes de l'agrégat du recensement : {missing}")
        weights = np.array([q.population for q in pcs], dtype=float)
        if np.any(weights <= 0):
            raise ValueError("ACM : chaque PCS doit avoir une population strictement positive")
        coords = np.array([groups[q.code] for q in pcs], dtype=float)
        x_raw, y_raw = orient_axes(
            coords, pcs, weights, p.get("orientation") or {}, Mca.default_params["y_weights"]
        )
        lo, hi = p["range"]
        return assemble_result(
            self.name, p, pcs, minmax_coordinates(x_raw, lo, hi),
            minmax_coordinates(y_raw, lo, hi), election,
        )
