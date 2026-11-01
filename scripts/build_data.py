"""Construit les données sourcées : data/pcs.json, data/elections/<id>.json, data/SOURCES.md.

Usage : uv run python scripts/build_data.py [--offline]

Les fichiers bruts sont téléchargés une fois dans le cache (voir pipeline/sources/_cache.py).
``--offline`` ne cherche pas à récupérer les PDF de sondages, qui ne servent qu'à vérifier les
transcriptions de pipeline/sources/manual/.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from pipeline.sources import (  # noqa: E402
    insee_diplomes,
    insee_population,
    insee_revenus_patrimoine,
    sondages,
)
from pipeline.sources._common import (  # noqa: E402
    DIPLOMA_KEYS,
    load_pcs_config,
)

DATA = ROOT / "data"
NOMENCLATURE = "PCS2020-N2"
REFERENCE_YEAR = 2022
RP_SOURCE_ID = "insee_rp2022_fd_indreg"

STATUS_LABELS = {
    insee_revenus_patrimoine.PUBLIE: "publié par l'Insee pour cette PCS",
    insee_revenus_patrimoine.PUBLIE_MENAGE: "publié pour les ménages de cette catégorie",
    insee_revenus_patrimoine.IMPUTE: "**imputé**",
    insee_revenus_patrimoine.CALCULE: "**calculé**",
}


def write_json(path: Path, document: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
    path.write_text(text, encoding="utf-8", newline="\n")


def build_pcs(
    population: pd.DataFrame, diplomes: pd.DataFrame, revenus: pd.DataFrame
) -> dict[str, Any]:
    """Assemble data/pcs.json, dans l'ordre de config/pcs.yaml."""
    by_code = population.merge(diplomes, on="code", validate="one_to_one").merge(
        revenus.drop(columns=["group"]), on="code", validate="one_to_one"
    )
    by_code = by_code.set_index("code")
    config = load_pcs_config()
    expected = [str(item["code"]) for item in config["items"]]
    if sorted(expected) != sorted(by_code.index):
        raise ValueError("Les PCS calculées ne correspondent pas à config/pcs.yaml")
    items: list[dict[str, Any]] = []
    for item in config["items"]:
        code = str(item["code"])
        row = by_code.loc[code]
        notes = str(row["notes"]) + " Effectif et diplômes : recensement 2022, fichier détail."
        if code == "7":
            notes += (
                " Diplômes réels des retraités ; la méthode ranks_chris_v1 les remplace par un "
                "score fixe."
            )
        items.append(
            {
                "code": code,
                "group": str(item["group"]),
                "population": round(float(row["population"])),
                "niveau_vie_mensuel_eur": round(float(row["niveau_vie_mensuel_eur"]), 1),
                "patrimoine_keur": round(float(row["patrimoine_keur"]), 1),
                "diplomes": {k: round(float(row[k]), 2) for k in DIPLOMA_KEYS},
                "source_refs": [
                    RP_SOURCE_ID,
                    insee_revenus_patrimoine.SOURCE_ID_ERFS,
                    insee_revenus_patrimoine.SOURCE_ID_HVP,
                ],
                "notes": notes,
            }
        )
    return {
        "nomenclature": NOMENCLATURE,
        "reference_year": REFERENCE_YEAR,
        "sources": [*insee_population.sources(), *insee_revenus_patrimoine.sources()],
        "items": items,
    }


def _cell(text: Any) -> str:
    """Contenu sûr pour une cellule de tableau Markdown."""
    return str(text).replace("|", "\\|").replace("\n", " ")


def _table(header: list[str], rows: list[list[Any]]) -> list[str]:
    lines = ["| " + " | ".join(header) + " |", "|" + " --- |" * len(header)]
    lines += ["| " + " | ".join(_cell(c) for c in row) + " |" for row in rows]
    return lines


def render_sources(
    pcs: dict[str, Any],
    revenus: pd.DataFrame,
    elections: list[dict[str, Any]],
    control: pd.DataFrame,
    missing: list[dict[str, Any]],
) -> str:
    """Rédige data/SOURCES.md à partir des références réellement utilisées."""
    rp, erfs, hvp = pcs["sources"]
    labels = {str(i["code"]): i["label"] for i in load_pcs_config()["items"]}
    by_code = revenus.set_index("code")
    n_nv_pub = int((revenus["niveau_vie_statut"] == insee_revenus_patrimoine.PUBLIE).sum())
    n_pa_pub = int((revenus["patrimoine_statut"] == insee_revenus_patrimoine.PUBLIE_MENAGE).sum())
    retired = by_code.loc["7"]
    retired_value = f"{retired['patrimoine_keur']:.1f}".replace(".", ",")

    lines = [
        "# Sources des données",
        "",
        "Fichier généré par `scripts/build_data.py`, à ne pas modifier à la main.",
        "",
        "`data/` ne contient que des chiffres issus de publications primaires (Insee, Ifop), ou "
        "calculés à partir d'elles par une méthode décrite ici. Aucune donnée de la reproduction "
        "JnthnBS n'y figure : son dépôt, sans licence, n'a servi que de contrôle local.",
        "",
        "## À régler avant toute publication : la mention de l'Ifop",
        "",
        "Les 7 fichiers d'élections reposent sur des rapports Ifop, et chacun indique : « Aucune "
        "publication totale ou partielle ne peut être faite sans l'accord exprès de l'Ifop. » "
        "Aucun accord n'est documenté dans ce dépôt. Cette mention concerne `data/elections/` et "
        "`pipeline/sources/manual/`. La question reste à trancher : demander l'accord de l'Ifop, "
        "ou ne pas publier ces fichiers.",
        "",
        "## Jeux de données",
        "",
    ]
    rows: list[list[Any]] = [
        [
            "`pcs.json` : population",
            rp["title"],
            rp["url"],
            rp["accessed"],
            rp["license"],
            "France hors Mayotte, 15 ans ou plus. PCS 2020 : mêmes codes que `config/pcs.yaml`, "
            "mais certains périmètres ont changé (par exemple 53 inclut pompiers et sécurité "
            "privée). Personnes en emploi et chômeurs ayant travaillé, classés selon leur CS.",
        ],
        [
            "`pcs.json` : diplômes",
            rp["title"],
            rp["url"],
            rp["accessed"],
            rp["license"],
            "Population non scolarisée (`ETUD = 2`). Calcul à partir du fichier détail : aucun "
            "tableau agrégé de l'Insee ne croise le diplôme et les 29 postes.",
        ],
        [
            "`pcs.json` : niveau de vie",
            erfs["title"],
            erfs["url"],
            erfs["accessed"],
            erfs["license"],
            f"Médiane annuelle / 12. {n_nv_pub} PCS sur 30 publiées à leur niveau, les autres "
            "imputées (voir plus bas). France métropolitaine, individus selon leur propre CS.",
        ],
        [
            "`pcs.json` : patrimoine",
            hvp["title"],
            hvp["url"],
            hvp["accessed"],
            hvp["license"],
            f"Patrimoine brut médian, début 2024. Seules {n_pa_pub} PCS correspondent à une "
            "catégorie publiée : **le reste est imputé ou calculé** (voir plus bas). Ménages "
            "selon la personne de référence, pas individus.",
        ],
    ]
    for election in elections:
        source = election["sources"][0]
        rows.append(
            [
                f"`elections/{election['id']}.json`",
                source["title"],
                source["url"],
                source["accessed"],
                source.get("license", "non indiquée"),
                "Parts ramenées à 100 sans « Autre inactif » ; agriculteurs non publiés (clé "
                "« 1 » absente) ; petits électorats très imprécis. Détails dans `sources[].notes`.",
            ]
        )
    lines += _table(
        ["Jeu de données", "Source", "URL", "Accès", "Licence ou mention", "Limites"], rows
    )

    lines += [
        "",
        "## Ce que l'Insee publie, ce qui est imputé",
        "",
        "Les valeurs marquées **imputé** ou **calculé** ne sont pas des données Insee : elles "
        "résultent d'un choix de ce projet à partir de chiffres Insee d'un niveau plus agrégé. "
        "Chaque item de `pcs.json` le rappelle dans son champ `notes`.",
        "",
        "- **Niveau de vie imputé.** L'ERFS 2022 publie une seule ligne pour les agriculteurs, "
        "artisans, commerçants et chefs d'entreprise : elle est appliquée aux PCS 10, 21, 22 et "
        "23. Elle publie « ns » pour la PCS 44 : la médiane du groupe Professions intermédiaires "
        "lui est appliquée à défaut, sans garantie de représentativité.",
        "- **Patrimoine imputé.** L'enquête HVP 2023-2024 ne publie que 12 catégories de ménages. "
        "La médiane d'une catégorie est appliquée à toutes ses PCS.",
        f"- **Patrimoine calculé.** Pour les retraités (7), l'Insee publie 4 catégories sans "
        f"ensemble. Leur médiane commune est estimée par interpolation linéaire à partir de leur "
        f"répartition dans les déciles de patrimoine : {retired_value} k€, "
        f"{retired['patrimoine_base']}, bornes certaines car ce sont des seuils publiés.",
        "- **Médianes plutôt que moyennes.** Statistique de référence de l'Insee, peu sensible aux "
        "très hauts patrimoines. Les moyennes restent disponibles dans "
        "`insee_revenus_patrimoine.load()`.",
        "",
        "**Conséquence sur l'axe Exploitation.** À l'intérieur d'une catégorie HVP, le patrimoine "
        "est constant : l'ordre du ratio patrimoine / niveau de vie y va donc mécaniquement à "
        "l'inverse du niveau de vie (le plus faible niveau de vie obtient le ratio le plus élevé). "
        "Cet ordre interne est un effet de l'imputation et ne mesure aucun écart de patrimoine. "
        "Les PCS 21, 22 et 23 ont même patrimoine et même niveau de vie : elles sont strictement "
        "ex æquo. Seules les différences entre catégories reposent sur des patrimoines publiés. "
        "La position des retraités pèse beaucoup sur celle des électorats, et dépend de la valeur "
        "calculée ci-dessus.",
        "",
    ]
    rows = []
    for item in pcs["items"]:
        code = item["code"]
        row = by_code.loc[code]
        rows.append(
            [
                code,
                labels[code],
                item["niveau_vie_mensuel_eur"],
                STATUS_LABELS[row["niveau_vie_statut"]],
                item["patrimoine_keur"],
                STATUS_LABELS[row["patrimoine_statut"]],
            ]
        )
    lines += _table(
        ["PCS", "Libellé", "Niveau de vie (€/mois)", "Statut", "Patrimoine (k€)", "Statut"], rows
    )

    lines += [
        "",
        "## Composition des électorats",
        "",
        "- Les rapports Ifop publient directement la composition de chaque électorat : aucune "
        "conversion de Bayes n'entre dans `data/`. Les tableaux sont transcrits dans "
        "`pipeline/sources/manual/`, avec les pages et l'empreinte SHA-256 du PDF.",
        "- « Autre inactif » (étudiants, personnes au foyer...) est hors des 30 PCS : il est "
        "retiré et les parts sont ramenées à 100 sur les groupes restants. Les parts publiées "
        "restent dans les CSV.",
        "- La ligne « Artisan ou commerçant » (« Travailleur indépendant » en 2017) est rattachée "
        "au groupe 2. Le tiret des rapports est lu comme 0. Aucun rapport ne dit où sont comptés "
        "les agriculteurs. Parmi les inscrits, cette ligne pèse environ 4,5 à 5 %, plus proche des "
        "groupes 1 et 2 réunis du recensement (4,5 %) que du groupe 2 seul (3,7 %) : ils y sont "
        "peut-être inclus, sans certitude.",
        "- `national_share_pct` reprend la ligne ensemble du sondage, pas le résultat officiel.",
        "- `margin_pts` n'est pas renseigné. Les méthodes l'utilisent comme marge de chaque "
        "électorat, or la marge de l'échantillon total la sous-estimerait fortement : un électorat "
        "ne représente qu'une fraction de l'échantillon. La taille d'échantillon est dans "
        "`sources[].notes`.",
        "- Européennes 2019 : pour quelques listes, « Catégorie supérieure » dépasse la somme de "
        "ses deux sous-lignes, sans explication dans le rapport. Cette part n'est rattachée à "
        "aucun groupe. Cette année-là, « Artisan ou commerçant » ne pèse que 3,4 % des inscrits : "
        "l'écart correspond peut-être aux agriculteurs, sans certitude.",
        "- Législatives 2024 : enquête réalisée du 26 au 29 juin, avant le scrutin, puis redressée "
        "sur les résultats officiels. Ce n'est pas un sondage du jour du vote.",
        "",
        "## Contrôle de la conversion de Bayes",
        "",
        "La conversion (`sondages.bayes_composition`) est contrôlée sur la présidentielle 2022 : "
        "le vote par profession publié par Ipsos, converti avec les effectifs du recensement "
        "(Français de 18 ans ou plus) et l'abstention par groupe, est comparé à la composition "
        "publiée par l'Ifop, sur les 5 groupes communs ramenés à 100. Ipsos ne sert qu'à ce "
        "contrôle.",
        "",
    ]
    lines += _table(
        ["Électorat", "Écart moyen (points)", "Écart maximal (points)"],
        [
            [cid, f"{row['ecart_moyen_pts']:.1f}", f"{row['ecart_max_pts']:.1f}"]
            for cid, row in control.iterrows()
        ],
    )

    lines += [
        "",
        "## Données manquantes / TODO",
        "",
    ]
    for election in missing:
        lines.append(f"- Élection sans source transcrite, fichier non produit : {election['id']}.")
    lines += [
        "- **Patrimoine par PCS de niveau 2.** Introuvable en source primaire. Consultés : HVP "
        "2023-2024 (Insee Résultats, 12 catégories), Les revenus et le patrimoine des ménages "
        "édition 2024 (fiche Patrimoine, 11 catégories), enquête Patrimoine 2017-2018 (Insee "
        "Résultats, 13 catégories). Aucun fichier détail de ces enquêtes trouvé en accès libre.",
        "- **Niveau de vie des PCS 10, 21, 22, 23 séparées, et de la PCS 44.** L'ERFS ne les "
        "publie pas séparément (éditions 2019, 2022 et 2023 consultées).",
        "- **Vote des agriculteurs (groupe 1).** Non isolé dans les rapports Ifop et Ipsos "
        "consultés. Elabe, Harris Interactive et OpinionWay n'ont pas été consultés.",
        "- **Scores nationaux officiels.** Remplacer la ligne ensemble des sondages par les "
        "résultats du ministère de l'Intérieur, en tenant compte des agrégats propres à l'Ifop "
        "aux législatives.",
        "- **Libellés.** `config/pcs.yaml` porte les libellés PCS 2003, les données suivent la "
        "PCS 2020.",
        "",
        "## Reproduire",
        "",
        "`uv run python scripts/build_data.py` télécharge les fichiers absents dans le cache, hors "
        "du dépôt (`SG_CACHE_DIR`, sinon `%LOCALAPPDATA%\\saint-graphique\\cache` sous Windows et "
        "`$XDG_CACHE_HOME/saint-graphique` ou `~/.cache/saint-graphique` ailleurs). Le fichier "
        "détail du recensement pèse environ 760 Mo. Les PDF ne servent qu'à vérifier les "
        "transcriptions, dont l'empreinte SHA-256 figure dans chaque CSV. `www.ifop.com` peut "
        "échouer avec `requests` (chaîne de certificats incomplète) : la construction aboutit "
        "quand même, et ces PDF se récupèrent à la main depuis les URL citées, par exemple avec "
        "curl ou un navigateur.",
        "",
    ]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="ne cherche pas les PDF manquants")
    args = parser.parse_args(argv)

    population = insee_population.load()
    diplomes = insee_diplomes.load()
    revenus = insee_revenus_patrimoine.load()
    pcs = build_pcs(population, diplomes, revenus)
    write_json(DATA / "pcs.json", pcs)
    print(f"data/pcs.json : {len(pcs['items'])} PCS")

    if not args.offline:
        failures = sondages.fetch()
        if failures:
            print(f"{len(failures)} PDF non récupérés, sans effet sur les données :")
            for failure in failures:
                print(f"  {failure}")

    elections: list[dict[str, Any]] = []
    produced: set[str] = set()
    for config in sondages.available_elections():
        document = sondages.election_document(config, sondages.load_table(config["id"]))
        write_json(DATA / "elections" / f"{config['id']}.json", document)
        elections.append(document)
        produced.add(config["id"])
        print(f"data/elections/{config['id']}.json : {len(document['candidates'])} candidats")
    for stale in sorted((DATA / "elections").glob("*.json")):
        if stale.stem not in produced:
            stale.unlink()
            print(f"Retiré, plus de source : {stale.name}")
    missing = sondages.missing_elections()

    control = sondages.compare_with_bayes(
        sondages.control_table(),
        sondages.load_table("2022_presidentielle_t1"),
        insee_population.load_electorate(),
    )
    text = render_sources(pcs, revenus, elections, control, missing)
    (DATA / "SOURCES.md").write_text(text, encoding="utf-8", newline="\n")
    print(f"data/SOURCES.md : {len(elections)} élections, {len(missing)} manquante(s)")
    print(
        "Contrôle Bayes (Ipsos converti / Ifop publié), écart moyen par électorat : "
        f"{control['ecart_moyen_pts'].mean():.1f} points, maximum "
        f"{control['ecart_max_pts'].max():.1f} points"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
