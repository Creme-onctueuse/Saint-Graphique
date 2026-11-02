"""Construit les données sourcées : data/pcs.json, data/elections/<id>.json, data/SOURCES.md.

Usage : uv run python scripts/build_data.py [--offline]

Les fichiers bruts sont téléchargés une fois dans le cache (voir pipeline/sources/_cache.py).
``--offline`` ne cherche pas à récupérer les PDF de sondages, qui ne servent qu'à vérifier les
transcriptions de pipeline/sources/manual/.
"""

from __future__ import annotations

import argparse
import collections
import json
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from pipeline.sources import (  # noqa: E402
    _nomenclature_pcs,
    insee_composition_patrimoine,
    insee_diplomes,
    insee_population,
    insee_revenus_patrimoine,
    sondages,
)
from pipeline.sources._common import (  # noqa: E402
    DIPLOMA_KEYS,
    RETIRED_CODE,
    load_pcs_config,
)
from pipeline.sources.insee_revenus_patrimoine import RetiredWealth, french  # noqa: E402

DATA = ROOT / "data"
NOMENCLATURE = "PCS2020-N2"
REFERENCE_YEAR = 2022
RP_SOURCE_ID = "insee_rp2022_fd_indreg"

STATUS_LABELS = {
    "published": "publié",
    "imputed": "**imputé**",
    "calculated": "**calculé**",
}


def write_json(path: Path, document: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
    path.write_text(text, encoding="utf-8", newline="\n")


def source_refs(code: str, has_owners: bool) -> list[str]:
    """Identifiants des sources réellement utilisées pour une PCS."""
    composition = f"{insee_revenus_patrimoine.SOURCE_ID_HVP2021}_composition"
    if code == RETIRED_CODE:
        return [
            RP_SOURCE_ID,
            insee_revenus_patrimoine.SOURCE_ID_ERFS,
            insee_revenus_patrimoine.SOURCE_ID_HVP2024,
            insee_revenus_patrimoine.SOURCE_ID_HVP2021,
            composition,
        ]
    refs = [RP_SOURCE_ID, insee_revenus_patrimoine.SOURCE_ID_PORTRAIT, composition]
    if has_owners:
        refs.append(insee_composition_patrimoine.SOURCE_ID_HOUSING)
    return refs


def build_pcs(
    population: pd.DataFrame,
    diplomes: pd.DataFrame,
    revenus: pd.DataFrame,
    composition: Mapping[str, Mapping[str, Any]],
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
        shares = composition[code]
        notes = (
            f"{row['notes']} {shares['note']} Effectif et diplômes : recensement 2022, fichier "
            "détail."
        )
        if code == RETIRED_CODE:
            notes += (
                " Diplômes réels des retraités ; la méthode ranks_jnthnbs les remplace par un "
                "score fixe."
            )
        items.append(
            {
                "code": code,
                "group": str(item["group"]),
                "population": round(float(row["population"])),
                "niveau_vie_mensuel_eur": round(float(row["niveau_vie_mensuel_eur"]), 2),
                "patrimoine_keur": round(float(row["patrimoine_keur"]), 3),
                "diplomes": {k: round(float(row[k]), 2) for k in DIPLOMA_KEYS},
                "niveau_vie_status": str(row["niveau_vie_status"]),
                "patrimoine_status": str(row["patrimoine_status"]),
                "patrimoine_composition": {
                    key: round(float(value), 2) for key, value in shares["composition"].items()
                },
                "patrimoine_composition_status": shares["status"],
                "source_refs": source_refs(code, "proprietaire_pct" in shares["composition"]),
                "notes": notes,
            }
        )
    return {
        "nomenclature": NOMENCLATURE,
        "reference_year": REFERENCE_YEAR,
        "sources": [
            *insee_population.sources(),
            *insee_revenus_patrimoine.sources(),
            *insee_composition_patrimoine.sources(),
        ],
        "items": items,
    }


def ties_on_ratio(items: list[dict[str, Any]]) -> list[list[str]]:
    """Groupes de PCS strictement ex æquo sur le ratio patrimoine / niveau de vie."""
    by_ratio: dict[float, list[str]] = collections.defaultdict(list)
    for item in items:
        ratio = round(item["patrimoine_keur"] / item["niveau_vie_mensuel_eur"], 9)
        by_ratio[ratio].append(item["code"])
    return [codes for codes in by_ratio.values() if len(codes) > 1]


def _cell(text: Any) -> str:
    """Contenu sûr pour une cellule de tableau Markdown."""
    return str(text).replace("|", "\\|").replace("\n", " ")


def _table(header: list[str], rows: list[list[Any]]) -> list[str]:
    lines = ["| " + " | ".join(header) + " |", "|" + " --- |" * len(header)]
    lines += ["| " + " | ".join(_cell(c) for c in row) + " |" for row in rows]
    return lines


def _status_counts(items: list[dict[str, Any]], field: str) -> str:
    counts = collections.Counter(item[field] for item in items)
    statuses = ("published", "imputed", "calculated")
    return ", ".join(f"{counts[s]} {s}" for s in statuses if counts[s])


def positions_source_lines() -> list[str]:
    """Vidéos dont viennent les positions lues, sous forme de liste Markdown."""
    path = DATA / "positions_chris.json"
    if not path.exists():
        return ["Fichier absent de ce dépôt."]
    document = json.loads(path.read_text(encoding="utf-8"))
    return [
        f"- [{source['title']}]({source['url']})"
        for source in document["sources"]
        if source.get("publisher") == "PaduTeam"
    ]


def render_sources(
    pcs: dict[str, Any],
    retired: RetiredWealth,
    elections: list[dict[str, Any]],
    control: pd.DataFrame,
    missing: list[dict[str, Any]],
) -> str:
    """Rédige data/SOURCES.md à partir des références réellement utilisées."""
    refs = {source["id"]: source for source in pcs["sources"]}
    rp = refs[RP_SOURCE_ID]
    portrait = refs[insee_revenus_patrimoine.SOURCE_ID_PORTRAIT]
    erfs = refs[insee_revenus_patrimoine.SOURCE_ID_ERFS]
    hvp2024 = refs[insee_revenus_patrimoine.SOURCE_ID_HVP2024]
    composition = refs[f"{insee_revenus_patrimoine.SOURCE_ID_HVP2021}_composition"]
    housing = refs[insee_composition_patrimoine.SOURCE_ID_HOUSING]
    labels = {str(i["code"]): i["label"] for i in load_pcs_config()["items"]}
    items = pcs["items"]
    n_distinct = len({i["patrimoine_composition"]["professionnel_pct"] for i in items})
    ties = ties_on_ratio(items)
    portrait_url = _nomenclature_pcs.url_of(insee_revenus_patrimoine.PORTRAIT_FILE)

    lines = [
        "# Sources des données",
        "",
        "Fichier généré par `scripts/build_data.py`, à ne pas modifier à la main.",
        "",
        "`data/` contient des chiffres issus de publications primaires (Insee, "
        "nomenclature-pcs.fr, Ifop) ou calculés à partir d'elles par une méthode décrite ici, et "
        "les positions lues sur les vidéos de la PaduTeam (`data/positions_chris.json`). "
        "Aucune donnée de la reproduction JnthnBS n'y figure : son dépôt, sans licence, n'a servi "
        "que de contrôle local.",
        "",
        "## Données Ifop : usage personnel et non commercial",
        "",
        "Les 7 fichiers d'élections reposent sur des rapports Ifop, et chacun indique : « Aucune "
        "publication totale ou partielle ne peut être faite sans l'accord exprès de l'Ifop. » "
        "Aucun accord n'a été demandé ni obtenu.",
        "",
        "Ce projet est à usage personnel et non commercial, et les données tirées de ces rapports "
        "ne sont pas publiées : `data/elections/`, `pipeline/sources/manual/` et les coordonnées "
        "d'électorats de `data/computed/`. Ces lignes décrivent un usage, ce n'est pas un avis "
        "juridique.",
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
            "France hors Mayotte, 15 ans ou plus. PCS 2020 : mêmes codes qu'en PCS 2003 ; selon "
            "l'Insee, les 30 catégories sont inchangées dans leur contenu et certains intitulés "
            "ont été revus (https://www.insee.fr/fr/statistiques/4506075). Personnes en emploi et "
            "chômeurs ayant travaillé, classés selon leur CS.",
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
            "`pcs.json` : niveau de vie et patrimoine, 29 PCS actives",
            portrait["title"],
            portrait["url"],
            portrait["accessed"],
            portrait["license"],
            "Médianes, 2020-2021. Publié sur nomenclature-pcs.fr, pas sur insee.fr. Échantillon "
            "de l'enquête Patrimoine limité (environ 10 250 ménages), aucune marge publiée par "
            "PCS : valeurs fragiles pour les petites PCS, surtout 44.",
        ],
        [
            "`pcs.json` : niveau de vie des retraités",
            erfs["title"],
            erfs["url"],
            erfs["accessed"],
            erfs["license"],
            "Médiane 2021, données provisoires selon l'Insee, France métropolitaine.",
        ],
        [
            "`pcs.json` : patrimoine des retraités",
            hvp2024["title"],
            hvp2024["url"],
            hvp2024["accessed"],
            hvp2024["license"],
            "Valeur calculée, non publiée : voir plus bas.",
        ],
        [
            "`pcs.json` : composition du patrimoine",
            composition["title"],
            composition["url"],
            composition["accessed"],
            composition["license"],
            "11 catégories de ménages, pas le niveau 2 : voir plus bas.",
        ],
        [
            "`pcs.json` : part de propriétaires",
            housing["title"],
            housing["url"],
            housing["accessed"],
            housing["license"],
            "Seul indicateur de détention publié en 29 postes. Enquête Emploi 2024. Ni la PCS 44 "
            "ni les retraités.",
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
        "## Niveau de vie et patrimoine",
        "",
        f"- **Statuts.** `niveau_vie_status` : {_status_counts(items, 'niveau_vie_status')}. "
        f"`patrimoine_status` : {_status_counts(items, 'patrimoine_status')}. Ex æquo stricts sur "
        f"le ratio patrimoine / niveau de vie : {sum(len(t) for t in ties)}.",
        "- **29 PCS actives.** Table « Situation financière des ménages … en 2020-2021 », "
        f"feuilles Ensemble : {portrait_url}. Source "
        "indiquée par le fichier : Insee, enquête Revenus fiscaux et sociaux 2021 et Patrimoine "
        "histoire de vie, 2020-2021. Le site appartient conjointement à l'Insee, à Progedo (CNRS), "
        "au Cnam-CEET et au laboratoire Printemps. Ses mentions légales "
        f"({_nomenclature_pcs.LEGAL_URL}) autorisent la réutilisation « sans licence », "
        "« subordonnée au respect de l'intégrité de l'information et des données et à la mention "
        "précise des sources ». Seules les colonnes de niveau de vie et de patrimoine sont lues, "
        "sans modification.",
        "- **Champ.** Personnes actives ayant déjà travaillé, comme les effectifs retenus ici pour "
        "le recensement. Le patrimoine est celui du ménage où elles vivent.",
        "- **Millésimes.** Les effectifs et les diplômes datent de 2022, le niveau de vie et le "
        "patrimoine de 2020-2021.",
        "- **Niveau de vie des retraités.** Publié par l'Insee (ERFS 2021, ligne Retraités).",
        "- **Patrimoine des retraités : calculé, non publié.** L'Insee publie plusieurs "
        "catégories de retraités, sans ensemble, et n'en donne la répartition dans les déciles de "
        f"patrimoine que pour 2023-2024. Leur médiane commune y est estimée à "
        f"{french(retired.median_2024_keur)} k€ par interpolation linéaire, entre les seuils "
        f"publiés {french(retired.low_2024_keur)} et {french(retired.high_2024_keur)} k€. Elle est "
        f"ramenée à début 2021 par le rapport des médianes de l'ensemble des ménages "
        f"({french(retired.all_2021_keur)} / {french(retired.all_2024_keur)}), soit "
        f"**{french(retired.value_keur)} k€**, entre {french(retired.low_keur)} et "
        f"{french(retired.high_keur)} k€ si ce rapport s'applique aux retraités. Repères publiés "
        f"en 2020-2021 : {french(retired.age_60_69_2021_keur)} k€ pour les ménages de 60 à 69 ans, "
        f"{french(retired.age_70_plus_2021_keur)} k€ pour ceux de 70 ans ou plus.",
        "- **Comparaison avec la reproduction JnthnBS.** Pour les 29 PCS actives, les valeurs "
        "coïncident avec les siennes parce que c'est la même table. Cet accord n'est donc pas une "
        "validation indépendante.",
        "",
    ]
    lines += _table(
        ["PCS", "Libellé", "Niveau de vie (€/mois)", "Statut", "Patrimoine (k€)", "Statut",
         "Patrimoine professionnel (%)", "Statut de la composition"],
        [
            [
                item["code"],
                labels[item["code"]],
                item["niveau_vie_mensuel_eur"],
                STATUS_LABELS[item["niveau_vie_status"]],
                item["patrimoine_keur"],
                STATUS_LABELS[item["patrimoine_status"]],
                item["patrimoine_composition"]["professionnel_pct"],
                STATUS_LABELS[item["patrimoine_composition_status"]],
            ]
            for item in items
        ],
    )

    lines += [
        "",
        "## Composition du patrimoine : ce qui existe, et à quel niveau",
        "",
        "Chris définit l'axe Exploitation par la composition du patrimoine des PCS : de l'absence "
        "de patrimoine jusqu'au capital d'entreprise. Le ratio patrimoine / niveau de vie vient de "
        "la reconstruction JnthnBS. Cette composition n'est pas publiée au niveau 2 des PCS dans "
        "les sources consultées :",
        "",
        "- **Insee, HVP 2020-2021 et 2023-2024.** Parts de la masse du patrimoine (immobilier, "
        "financier, professionnel, résiduel, et leur détail) et taux de détention : 11 catégories "
        "de ménages en 2020-2021, 12 en 2023-2024, selon la personne de référence. "
        "C'est le niveau le plus fin trouvé.",
        "- **nomenclature-pcs.fr, portraits de groupes.** Aucune composition du patrimoine. Les "
        "fichiers DEC_POR_1 à 10 portent sur l'âge, la famille, la santé, la migration et le "
        "logement, "
        "l'origine sociale, le diplôme, l'emploi, la situation financière, le mode de vie et la "
        "participation sociale. Seule la part de propriétaires concerne la détention, en 29 "
        "postes. Les tableaux par thème (DEC_THEM_8) donnent des patrimoines immobilier et "
        "financier médians, mais par groupe de niveau 1 et sans patrimoine professionnel.",
        "",
        "`patrimoine_composition_status` : "
        f"{_status_counts(items, 'patrimoine_composition_status')}.",
        "",
        "- **published** (10, 31) : la catégorie correspond à une seule PCS, mais pour le ménage, "
        "pas pour l'individu.",
        "- **imputed** : la valeur de la catégorie est appliquée à toutes ses PCS. Ce n'est pas "
        f"une donnée Insee à ce niveau : `professionnel_pct` ne prend que {n_distinct} valeurs "
        "distinctes sur 30 PCS, et ne peut pas ordonner les PCS d'une même catégorie.",
        "- **calculated** (7) : agrégation des 3 catégories de retraités de 2020-2021, avec les "
        "parts de ménages de 2023-2024, faute de publication en 2020-2021.",
        "- **Clés.** `immobilier_pct`, `financier_pct`, `professionnel_pct`, `autre_pct` : parts "
        "de la masse du patrimoine brut (somme proche de 100). `professionnel_entreprises_pct`, "
        "`valeurs_mobilieres_pct` : parts de la masse, comprises dans les précédentes. "
        "`detention_immobilier_pct`, `detention_financier_pct`, `detention_professionnel_pct`, "
        "`detention_entreprise_pct` : taux de détention, en % des ménages. `proprietaire_pct` : "
        "part de propriétaires de leur logement, publiée pour la PCS (enquête Emploi 2024).",
        "- **Vague retenue.** 2020-2021, comme le patrimoine ci-dessus. D'une vague à l'autre, les "
        "parts bougent fortement (patrimoine professionnel des agriculteurs : 71,3 % en 2020-2021, "
        "59,3 % en 2023-2024) : ces écarts donnent un ordre de grandeur de leur imprécision.",
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
        "- **Composition du patrimoine par PCS de niveau 2.** Introuvable : voir plus haut. Aucun "
        "fichier détail de l'enquête Patrimoine trouvé en accès libre.",
        "- **Patrimoine et niveau de vie des retraités en 2020-2021.** Aucun ensemble publié ; le "
        "patrimoine reste un calcul.",
        "- **Vote des agriculteurs (groupe 1).** Non isolé dans les rapports Ifop et Ipsos "
        "consultés. Elabe, Harris Interactive et OpinionWay n'ont pas été consultés.",
        "- **Scores nationaux officiels.** Remplacer la ligne ensemble des sondages par les "
        "résultats du ministère de l'Intérieur, en tenant compte des agrégats propres à l'Ifop "
        "aux législatives.",
        "",
        "## Positions lues sur le graphique de Chris",
        "",
        "`data/positions_chris.json` reprend les positions et une partie des poids affichés par "
        "le tableau de Chris, lus sur ces vidéos de la PaduTeam. Chaque poste y cite sa vidéo et "
        "son horodatage. Ces chiffres ne sont pas placés sous licence libre. Le fichier est écrit "
        "par `scripts/analyze/build_positions.py` à partir de relevés locaux.",
        "",
        *positions_source_lines(),
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
    composition = insee_composition_patrimoine.load()
    pcs = build_pcs(population, diplomes, revenus, composition)
    write_json(DATA / "pcs.json", pcs)
    print(f"data/pcs.json : {len(pcs['items'])} PCS")
    for field in ("niveau_vie_status", "patrimoine_status", "patrimoine_composition_status"):
        print(f"  {field} : {_status_counts(pcs['items'], field)}")
    ties = ties_on_ratio(pcs["items"])
    print(f"  ex æquo stricts sur le ratio patrimoine / niveau de vie : {ties}")

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
    text = render_sources(
        pcs, insee_revenus_patrimoine.retired_wealth(), elections, control, missing
    )
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
