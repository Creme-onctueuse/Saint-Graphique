"""Mesures citées dans ``docs/methodologie.md`` pour ``espace_social`` et ``acm_individus``.

Rien n'est lu sur le graphique de Chris : ce script décrit les méthodes elles-mêmes. La comparaison
aux positions lues est dans ``threshold_report.py``.

Usage :
    uv run python scripts/analyze/methods_report.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.methods import METHODS  # noqa: E402
from pipeline.methods.acm_individus import (  # noqa: E402
    Analysis,
    analysis,
    indicator_table,
    load_aggregate,
    load_table,
    profile_coordinates,
    run_analysis,
    variables_of,
)
from pipeline.methods.espace_social import (  # noqa: E402
    RETIRED_CODE,
    STUDY_YEARS,
    capital_scores,
    reference_weights,
    weighted_zscores,
)
from pipeline.methods.scores import minmax_coordinates, y_scores  # noqa: E402
from pipeline.model import Pcs, load_pcs  # noqa: E402


def weighted_skewness(values: np.ndarray, weights: np.ndarray) -> float:
    """Asymétrie pondérée (moment centré d'ordre 3, réduit)."""
    mean = np.average(values, weights=weights)
    sd = np.sqrt(np.average((values - mean) ** 2, weights=weights))
    return float(np.average(((values - mean) / sd) ** 3, weights=weights))


def weighted_correlation(a: np.ndarray, b: np.ndarray, weights: np.ndarray) -> float:
    """Corrélation de Pearson pondérée."""
    ma, mb = np.average(a, weights=weights), np.average(b, weights=weights)
    cov = np.average((a - ma) * (b - mb), weights=weights)
    return float(cov / np.sqrt(np.average((a - ma) ** 2, weights=weights)
                               * np.average((b - mb) ** 2, weights=weights)))


def scale_with_retired(pcs: tuple[Pcs, ...]) -> tuple[np.ndarray, np.ndarray]:
    """Variante écartée : les retraités entrent dans la moyenne et l'écart-type de référence."""
    weights = np.array([p.population for p in pcs], dtype=float)
    wealth = weighted_zscores(np.log([p.patrimoine_keur for p in pcs]), weights)
    living = weighted_zscores(np.log([p.niveau_vie_mensuel_eur for p in pcs]), weights)
    economic = weighted_zscores(wealth + living, weights)
    cultural = weighted_zscores(y_scores(pcs, STUDY_YEARS), weights)
    return minmax_coordinates(economic - cultural), minmax_coordinates(economic + cultural)


def report_espace_social() -> None:
    pcs = load_pcs().items
    population = np.array([p.population for p in pcs], dtype=float)
    reference = reference_weights(pcs)
    active = reference > 0
    print("== espace_social")
    for name, values in (
        ("patrimoine", np.array([p.patrimoine_keur for p in pcs])),
        ("niveau de vie", np.array([p.niveau_vie_mensuel_eur for p in pcs])),
    ):
        print(f"  asymétrie {name} : {weighted_skewness(values[active], reference[active]):.2f} "
              f"en euros, {weighted_skewness(np.log(values[active]), reference[active]):.2f} "
              "en logarithme (PCS actives)")

    economic, cultural = capital_scores(pcs, STUDY_YEARS)
    r = weighted_correlation(economic[active], cultural[active], reference[active])
    print(f"  corrélation E, C (PCS actives) : {r:.3f}")
    print(f"  part de la variance : volume {100 * (1 + r) / 2:.1f} %, "
          f"structure {100 * (1 - r) / 2:.1f} %")

    x, y = minmax_coordinates(economic - cultural), minmax_coordinates(economic + cultural)
    x2, y2 = scale_with_retired(pcs)
    moved = np.hypot(x - x2, y - y2)
    print(f"  retraités dans l'échelle : déplacement moyen pondéré "
          f"{np.average(moved[active], weights=reference[active]):.2f}, "
          f"maximal {moved[active].max():.2f} (PCS actives)")

    i = [p.code for p in pcs].index(RETIRED_CODE)
    print(f"  retraités : E = {economic[i]:+.2f}, C = {cultural[i]:+.2f}, "
          f"x = {x[i]:+.2f}, y = {y[i]:+.2f}, part de la population "
          f"{100 * population[i] / population.sum():.1f} %")
    shares = {k: float(np.average([p.diplomes[k] for p in pcs], weights=reference))
              for k in STUDY_YEARS}
    print("  certificat ou aucun diplôme : retraités "
          f"{pcs[i].diplomes['certif_aucun']:.1f} %, PCS actives {shares['certif_aucun']:.1f} % ; "
          f"bac+5 : retraités {pcs[i].diplomes['bac5']:.1f} %, PCS actives {shares['bac5']:.1f} %")
    without = cultural.copy()
    without[i] = 0.0  # diplômes moyens des PCS actives
    print("  retraités avec les diplômes moyens des PCS actives : "
          f"x = {minmax_coordinates(economic - without)[i]:+.2f}, "
          f"y = {minmax_coordinates(economic + without)[i]:+.2f}")

    result = METHODS["espace_social"].compute(pcs, None, {})
    for label, key in (("gauche", "x"), ("bas", "y")):
        ordered = sorted(pcs, key=lambda p: getattr(result.pcs[p.code], key))
        print(f"  plus à {label} : " + ", ".join(p.short for p in ordered[:4])
              + " ; à l'opposé : " + ", ".join(p.short for p in ordered[-4:]))


def _signs(fit: Analysis) -> tuple[float, float]:
    """Signes de l'orientation de la carte, déduits des coordonnées publiées."""
    pcs = load_pcs().items
    result = METHODS["acm_individus"].compute(pcs, None, {})
    codes = [p.code for p in pcs]
    raw = np.array([fit.groups[c] for c in codes])
    x = np.array([result.pcs[c].x for c in codes])
    y = np.array([result.pcs[c].y for c in codes])
    return (float(np.sign(np.corrcoef(raw[:, 0], x)[0, 1])),
            float(np.sign(np.corrcoef(raw[:, 1], y)[0, 1])))


def report_acm() -> None:
    fit = analysis()
    document = load_aggregate()
    sx, sy = _signs(fit)
    print("== acm_individus")
    print(f"  {fit.n_active_rows} profils actifs, {len(fit.columns)} modalités, "
          f"{fit.n_variables} variables")
    print("  valeurs propres : " + ", ".join(f"{v:.3f}" for v in fit.eigenvalues[:5])
          + f" ; moyenne {1 / fit.n_variables:.3f} ; inertie totale {fit.eigenvalues.sum():.3f}")
    print("  taux bruts : " + ", ".join(f"{v:.1f} %" for v in fit.raw_rates[:5]))
    print("  taux modifiés : " + ", ".join(f"{v:.1f} %" for v in fit.modified_rates[:5]))
    table = fit.modalities.copy()
    table["c1"] *= sx
    table["c2"] *= sy
    by_variable = table.assign(variable=[i.split("=")[0] for i in table.index]).groupby(
        "variable", sort=False
    )[["ctr1", "ctr2"]].sum()
    print("  contributions par variable (axe 1, axe 2) :")
    for name, row in by_variable.iterrows():
        print(f"    {name:<10} {row['ctr1']:5.1f} {row['ctr2']:5.1f}")
    print("  modalités, orientées comme la carte (masse %, c1, ctr1 %, c2, ctr2 %) :")
    for name, row in table.iterrows():
        print(f"    {name:<26} {row['masse']:5.1f} {row['c1']:+.2f} {row['ctr1']:5.1f} "
              f"{row['c2']:+.2f} {row['ctr2']:5.1f}")

    ages = load_table(document, "age_rows")
    coords = profile_coordinates(
        fit.model, indicator_table(ages, variables_of(document)), fit.n_variables
    )[:, :2]
    print("  classes d'âge, en supplémentaire (axe 1, axe 2) :")
    for age in document["ages"]:
        mask = (ages["groupe"] == age).to_numpy()
        weights = ages["poids"].to_numpy()[mask]
        print(f"    {age:<6} {sx * np.average(coords[mask, 0], weights=weights):+.3f} "
              f"{sy * np.average(coords[mask, 1], weights=weights):+.3f}")

    pcs = load_pcs().items
    reference = reference_weights(pcs)
    active = reference > 0
    raw = np.array([fit.groups[p.code] for p in pcs]) * np.array([sx, sy])
    indicators = {
        "ln patrimoine": np.log([p.patrimoine_keur for p in pcs]),
        "ln niveau de vie": np.log([p.niveau_vie_mensuel_eur for p in pcs]),
        "diplômes": y_scores(pcs, STUDY_YEARS),
    }
    print("  corrélation pondérée avec les données de pcs.json, 29 PCS actives (axe 1, axe 2) :")
    for name, values in indicators.items():
        print(f"    {name:<18} "
              f"{weighted_correlation(raw[active, 0], values[active], reference[active]):+.2f} "
              f"{weighted_correlation(raw[active, 1], values[active], reference[active]):+.2f}")

    result = METHODS["acm_individus"].compute(pcs, None, {})
    for label, key in (("gauche", "x"), ("bas", "y")):
        ordered = sorted(pcs, key=lambda p: getattr(result.pcs[p.code], key))
        print(f"  plus à {label} : " + ", ".join(p.short for p in ordered[:4])
              + " ; à l'opposé : " + ", ".join(p.short for p in ordered[-4:]))
    retired = result.pcs[RETIRED_CODE]
    print(f"  retraités : x = {retired.x:+.2f}, y = {retired.y:+.2f}")
    report_retired_as_active()


def report_retired_as_active() -> None:
    """Variante écartée : les retraités participent au calcul des axes, avec leur modalité."""
    document = load_aggregate()
    variables = variables_of(document)
    variables["emploi"] = [*variables["emploi"], "retraite"]
    table = load_table(document)
    table["emploi"] = table["emploi"].fillna("retraite")
    fit = run_analysis(table, variables)
    top = fit.modalities["ctr1"].sort_values(ascending=False).head(3)
    print("  variante écartée, retraités actifs : taux "
          + ", ".join(f"{v:.1f} %" for v in fit.raw_rates[:2]) + " ; modifiés "
          + ", ".join(f"{v:.1f} %" for v in fit.modified_rates[:2]) + " ; axe 1 : "
          + ", ".join(f"{name} {value:.1f} %" for name, value in top.items()))


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    report_espace_social()
    report_acm()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
