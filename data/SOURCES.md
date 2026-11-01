# Sources des données

Fichier généré par `scripts/build_data.py`, à ne pas modifier à la main.

`data/` ne contient que des chiffres issus de publications primaires (Insee, Ifop), ou calculés à partir d'elles par une méthode décrite ici. Aucune donnée de la reproduction JnthnBS n'y figure : son dépôt, sans licence, n'a servi que de contrôle local.

## À régler avant toute publication : la mention de l'Ifop

Les 7 fichiers d'élections reposent sur des rapports Ifop, et chacun indique : « Aucune publication totale ou partielle ne peut être faite sans l'accord exprès de l'Ifop. » Aucun accord n'est documenté dans ce dépôt. Cette mention concerne `data/elections/` et `pipeline/sources/manual/`. La question reste à trancher : demander l'accord de l'Ifop, ou ne pas publier ces fichiers.

## Jeux de données

| Jeu de données | Source | URL | Accès | Licence ou mention | Limites |
| --- | --- | --- | --- | --- | --- |
| `pcs.json` : population | Recensement de la population 2022 — Fichier détail « Individus localisés à la région » | https://www.insee.fr/fr/statistiques/8590183 | 2026-10-31 | Licence Ouverte / Open Licence 2.0 (Etalab), citer « Source : Insee » et la date de mise à jour, sans altérer le sens des informations ni induire en erreur sur leur interprétation | France hors Mayotte, 15 ans ou plus. PCS 2020 : mêmes codes que `config/pcs.yaml`, mais certains périmètres ont changé (par exemple 53 inclut pompiers et sécurité privée). Personnes en emploi et chômeurs ayant travaillé, classés selon leur CS. |
| `pcs.json` : diplômes | Recensement de la population 2022 — Fichier détail « Individus localisés à la région » | https://www.insee.fr/fr/statistiques/8590183 | 2026-10-31 | Licence Ouverte / Open Licence 2.0 (Etalab), citer « Source : Insee » et la date de mise à jour, sans altérer le sens des informations ni induire en erreur sur leur interprétation | Population non scolarisée (`ETUD = 2`). Calcul à partir du fichier détail : aucun tableau agrégé de l'Insee ne croise le diplôme et les 29 postes. |
| `pcs.json` : niveau de vie | Niveau de vie et revenu annuel des individus en 2022, ERFS, Insee Résultats, tableaux TI02D et TI02C | https://www.insee.fr/fr/statistiques/8278900 | 2026-11-01 | Licence Ouverte / Open Licence 2.0 (Etalab), citer « Source : Insee » et la date de mise à jour, sans altérer le sens des informations ni induire en erreur sur leur interprétation | Médiane annuelle / 12. 25 PCS sur 30 publiées à leur niveau, les autres imputées (voir plus bas). France métropolitaine, individus selon leur propre CS. |
| `pcs.json` : patrimoine | Patrimoine et endettement des ménages en 2024, enquête Histoire de vie et Patrimoine 2023-2024, Insee Résultats | https://www.insee.fr/fr/statistiques/8736842 | 2026-11-01 | Licence Ouverte / Open Licence 2.0 (Etalab), citer « Source : Insee » et la date de mise à jour, sans altérer le sens des informations ni induire en erreur sur leur interprétation | Patrimoine brut médian, début 2024. Seules 2 PCS correspondent à une catégorie publiée : **le reste est imputé ou calculé** (voir plus bas). Ménages selon la personne de référence, pas individus. |
| `elections/2017_presidentielle_t1.json` | Ifop et Fiducial pour Paris Match, CNews et Sud Radio, Le profil des électeurs et les clefs du premier tour de l'élection présidentielle, 23 avril 2017 | https://www.ifop.com/wp-content/uploads/2018/03/3749-1-study_file.pdf | 2026-10-31 | Rapport © Ifop. Il indique : « Aucune publication totale ou partielle ne peut être faite sans l'accord exprès de l'Ifop. » Aucun accord n'est documenté dans ce dépôt, voir data/SOURCES.md. | Parts ramenées à 100 sans « Autre inactif » ; agriculteurs non publiés (clé « 1 » absente) ; petits électorats très imprécis. Détails dans `sources[].notes`. |
| `elections/2017_legislatives_t1.json` | Ifop et Fiducial pour Paris Match, CNews et Sud Radio, Le profil des électeurs et les clefs du premier tour des élections législatives, 11 juin 2017 | https://www.ifop.com/wp-content/uploads/2018/03/3791-1-study_file.pdf | 2026-10-31 | Rapport © Ifop. Il indique : « Aucune publication totale ou partielle ne peut être faite sans l'accord exprès de l'Ifop. » Aucun accord n'est documenté dans ce dépôt, voir data/SOURCES.md. | Parts ramenées à 100 sans « Autre inactif » ; agriculteurs non publiés (clé « 1 » absente) ; petits électorats très imprécis. Détails dans `sources[].notes`. |
| `elections/2019_europeennes.json` | Ifop-Fiducial pour Paris Match, CNEWS et Sud Radio, Européennes 2019 : profil des électeurs et clefs du scrutin, 27 mai 2019 | https://www.ifop.com/wp-content/uploads/2019/05/116339-rapport-jdv-complet-detaille_2019_05.27.pdf | 2026-10-31 | Rapport © Ifop. Il indique : « Aucune publication totale ou partielle ne peut être faite sans l'accord exprès de l'Ifop. » Aucun accord n'est documenté dans ce dépôt, voir data/SOURCES.md. | Parts ramenées à 100 sans « Autre inactif » ; agriculteurs non publiés (clé « 1 » absente) ; petits électorats très imprécis. Détails dans `sources[].notes`. |
| `elections/2022_presidentielle_t1.json` | Ifop-Fiducial pour TF1 & LCI, Présidentielle 2022, sondage jour du vote : profil des électeurs et clés du scrutin (1er tour), 10 avril 2022 | https://www.ifop.com/wp-content/uploads/2022/04/118997-Rapport-JDV-PRE22-T1-DET-11.04-1.pdf | 2026-10-31 | Rapport © Ifop. Il indique : « Aucune publication totale ou partielle ne peut être faite sans l'accord exprès de l'Ifop. » Aucun accord n'est documenté dans ce dépôt, voir data/SOURCES.md. | Parts ramenées à 100 sans « Autre inactif » ; agriculteurs non publiés (clé « 1 » absente) ; petits électorats très imprécis. Détails dans `sources[].notes`. |
| `elections/2022_legislatives_t1.json` | Ifop-Fiducial pour TF1, LCI, Paris Match et Sud Radio, Législatives 2022, sondage jour du vote : profil des électeurs et clés du scrutin (1er tour), 12 juin 2022 | https://www.ifop.com/wp-content/uploads/2022/06/119150-Rapport-JDV-LEG22-T1-v1-12.06.2022-22h25-COMPLET.pdf | 2026-10-31 | Rapport © Ifop. Il indique : « Aucune publication totale ou partielle ne peut être faite sans l'accord exprès de l'Ifop. » Aucun accord n'est documenté dans ce dépôt, voir data/SOURCES.md. | Parts ramenées à 100 sans « Autre inactif » ; agriculteurs non publiés (clé « 1 » absente) ; petits électorats très imprécis. Détails dans `sources[].notes`. |
| `elections/2024_europeennes.json` | Ifop-Fiducial pour LCI, Le Figaro et Sud Radio, Européennes 2024, sondage jour du vote : profil des électeurs et clés du scrutin, 9 juin 2024 | https://www.ifop.com/wp-content/uploads/2024/06/DET-120537-Rapport-JDV-EUR24-10.06.2024.pdf | 2026-10-31 | Rapport © Ifop. Il indique : « Aucune publication totale ou partielle ne peut être faite sans l'accord exprès de l'Ifop. » Aucun accord n'est documenté dans ce dépôt, voir data/SOURCES.md. | Parts ramenées à 100 sans « Autre inactif » ; agriculteurs non publiés (clé « 1 » absente) ; petits électorats très imprécis. Détails dans `sources[].notes`. |
| `elections/2024_legislatives_t1.json` | Ifop pour TF1 et LCI, Analyse du premier tour des élections législatives 2024 : participation et structuration des électorats, juin 2024 (n° 120976) | https://www.ifop.com/wp-content/uploads/2024/07/120976-Resultats.pdf | 2026-10-31 | Rapport © Ifop. Il indique : « Aucune publication totale ou partielle ne peut être faite sans l'accord exprès de l'Ifop. » Aucun accord n'est documenté dans ce dépôt, voir data/SOURCES.md. | Parts ramenées à 100 sans « Autre inactif » ; agriculteurs non publiés (clé « 1 » absente) ; petits électorats très imprécis. Détails dans `sources[].notes`. |

## Ce que l'Insee publie, ce qui est imputé

Les valeurs marquées **imputé** ou **calculé** ne sont pas des données Insee : elles résultent d'un choix de ce projet à partir de chiffres Insee d'un niveau plus agrégé. Chaque item de `pcs.json` le rappelle dans son champ `notes`.

- **Niveau de vie imputé.** L'ERFS 2022 publie une seule ligne pour les agriculteurs, artisans, commerçants et chefs d'entreprise : elle est appliquée aux PCS 10, 21, 22 et 23. Elle publie « ns » pour la PCS 44 : la médiane du groupe Professions intermédiaires lui est appliquée à défaut, sans garantie de représentativité.
- **Patrimoine imputé.** L'enquête HVP 2023-2024 ne publie que 12 catégories de ménages. La médiane d'une catégorie est appliquée à toutes ses PCS.
- **Patrimoine calculé.** Pour les retraités (7), l'Insee publie 4 catégories sans ensemble. Leur médiane commune est estimée par interpolation linéaire à partir de leur répartition dans les déciles de patrimoine : 263,5 k€, 4 catégories de retraités réunies, entre 205,1 et 283,2 k€, bornes certaines car ce sont des seuils publiés.
- **Médianes plutôt que moyennes.** Statistique de référence de l'Insee, peu sensible aux très hauts patrimoines. Les moyennes restent disponibles dans `insee_revenus_patrimoine.load()`.

**Conséquence sur l'axe Exploitation.** À l'intérieur d'une catégorie HVP, le patrimoine est constant : l'ordre du ratio patrimoine / niveau de vie y va donc mécaniquement à l'inverse du niveau de vie (le plus faible niveau de vie obtient le ratio le plus élevé). Cet ordre interne est un effet de l'imputation et ne mesure aucun écart de patrimoine. Les PCS 21, 22 et 23 ont même patrimoine et même niveau de vie : elles sont strictement ex æquo. Seules les différences entre catégories reposent sur des patrimoines publiés. La position des retraités pèse beaucoup sur celle des électorats, et dépend de la valeur calculée ci-dessus.

| PCS | Libellé | Niveau de vie (€/mois) | Statut | Patrimoine (k€) | Statut |
| --- | --- | --- | --- | --- | --- |
| 10 | Agriculteurs exploitants | 1981.7 | **imputé** | 903.1 | publié pour les ménages de cette catégorie |
| 21 | Artisans | 1981.7 | **imputé** | 436.9 | **imputé** |
| 22 | Commerçants et assimilés | 1981.7 | **imputé** | 436.9 | **imputé** |
| 23 | Chefs d'entreprise de 10 salariés ou plus | 1981.7 | **imputé** | 436.9 | **imputé** |
| 31 | Professions libérales | 3448.3 | publié par l'Insee pour cette PCS | 772.0 | publié pour les ménages de cette catégorie |
| 33 | Cadres de la fonction publique | 3088.3 | publié par l'Insee pour cette PCS | 416.2 | **imputé** |
| 34 | Professeurs, professions scientifiques | 3030.0 | publié par l'Insee pour cette PCS | 416.2 | **imputé** |
| 35 | Professions de l'information, des arts et du spectacle | 2387.5 | publié par l'Insee pour cette PCS | 416.2 | **imputé** |
| 37 | Cadres administratifs et commerciaux d'entreprise | 3323.3 | publié par l'Insee pour cette PCS | 416.2 | **imputé** |
| 38 | Ingénieurs et cadres techniques d'entreprise | 3160.0 | publié par l'Insee pour cette PCS | 416.2 | **imputé** |
| 42 | Professeurs des écoles, instituteurs et assimilés | 2248.3 | publié par l'Insee pour cette PCS | 226.1 | **imputé** |
| 43 | Professions intermédiaires de la santé et du travail social | 2429.2 | publié par l'Insee pour cette PCS | 226.1 | **imputé** |
| 44 | Clergé, religieux | 2364.2 | **imputé** | 226.1 | **imputé** |
| 45 | Professions intermédiaires administratives de la fonction publique | 2446.7 | publié par l'Insee pour cette PCS | 226.1 | **imputé** |
| 46 | Professions intermédiaires administratives et commerciales des entreprises | 2330.8 | publié par l'Insee pour cette PCS | 226.1 | **imputé** |
| 47 | Techniciens | 2341.7 | publié par l'Insee pour cette PCS | 226.1 | **imputé** |
| 48 | Contremaîtres, agents de maîtrise | 2449.2 | publié par l'Insee pour cette PCS | 226.1 | **imputé** |
| 52 | Employés civils et agents de service de la fonction publique | 1980.0 | publié par l'Insee pour cette PCS | 46.2 | **imputé** |
| 53 | Policiers et militaires | 2176.7 | publié par l'Insee pour cette PCS | 46.2 | **imputé** |
| 54 | Employés administratifs d'entreprise | 2190.0 | publié par l'Insee pour cette PCS | 46.2 | **imputé** |
| 55 | Employés de commerce | 1853.3 | publié par l'Insee pour cette PCS | 46.2 | **imputé** |
| 56 | Personnels des services directs aux particuliers | 1677.5 | publié par l'Insee pour cette PCS | 46.2 | **imputé** |
| 62 | Ouvriers qualifiés de type industriel | 2044.2 | publié par l'Insee pour cette PCS | 44.4 | **imputé** |
| 63 | Ouvriers qualifiés de type artisanal | 1880.8 | publié par l'Insee pour cette PCS | 44.4 | **imputé** |
| 64 | Chauffeurs | 1945.0 | publié par l'Insee pour cette PCS | 44.4 | **imputé** |
| 65 | Ouvriers qualifiés de la manutention, du magasinage et du transport | 1933.3 | publié par l'Insee pour cette PCS | 44.4 | **imputé** |
| 67 | Ouvriers non qualifiés de type industriel | 1773.3 | publié par l'Insee pour cette PCS | 44.4 | **imputé** |
| 68 | Ouvriers non qualifiés de type artisanal | 1604.2 | publié par l'Insee pour cette PCS | 44.4 | **imputé** |
| 69 | Ouvriers agricoles | 1822.5 | publié par l'Insee pour cette PCS | 44.4 | **imputé** |
| 7 | Retraités | 1994.2 | publié par l'Insee pour cette PCS | 263.5 | **calculé** |

## Composition des électorats

- Les rapports Ifop publient directement la composition de chaque électorat : aucune conversion de Bayes n'entre dans `data/`. Les tableaux sont transcrits dans `pipeline/sources/manual/`, avec les pages et l'empreinte SHA-256 du PDF.
- « Autre inactif » (étudiants, personnes au foyer...) est hors des 30 PCS : il est retiré et les parts sont ramenées à 100 sur les groupes restants. Les parts publiées restent dans les CSV.
- La ligne « Artisan ou commerçant » (« Travailleur indépendant » en 2017) est rattachée au groupe 2. Le tiret des rapports est lu comme 0. Aucun rapport ne dit où sont comptés les agriculteurs. Parmi les inscrits, cette ligne pèse environ 4,5 à 5 %, plus proche des groupes 1 et 2 réunis du recensement (4,5 %) que du groupe 2 seul (3,7 %) : ils y sont peut-être inclus, sans certitude.
- `national_share_pct` reprend la ligne ensemble du sondage, pas le résultat officiel.
- `margin_pts` n'est pas renseigné. Les méthodes l'utilisent comme marge de chaque électorat, or la marge de l'échantillon total la sous-estimerait fortement : un électorat ne représente qu'une fraction de l'échantillon. La taille d'échantillon est dans `sources[].notes`.
- Européennes 2019 : pour quelques listes, « Catégorie supérieure » dépasse la somme de ses deux sous-lignes, sans explication dans le rapport. Cette part n'est rattachée à aucun groupe. Cette année-là, « Artisan ou commerçant » ne pèse que 3,4 % des inscrits : l'écart correspond peut-être aux agriculteurs, sans certitude.
- Législatives 2024 : enquête réalisée du 26 au 29 juin, avant le scrutin, puis redressée sur les résultats officiels. Ce n'est pas un sondage du jour du vote.

## Contrôle de la conversion de Bayes

La conversion (`sondages.bayes_composition`) est contrôlée sur la présidentielle 2022 : le vote par profession publié par Ipsos, converti avec les effectifs du recensement (Français de 18 ans ou plus) et l'abstention par groupe, est comparé à la composition publiée par l'Ifop, sur les 5 groupes communs ramenés à 100. Ipsos ne sert qu'à ce contrôle.

| Électorat | Écart moyen (points) | Écart maximal (points) |
| --- | --- | --- |
| melenchon | 3.0 | 4.1 |
| roussel | 3.6 | 6.6 |
| jadot | 6.6 | 14.7 |
| hidalgo | 10.6 | 14.9 |
| macron | 1.1 | 1.9 |
| pecresse | 1.5 | 3.4 |
| lassalle | 10.6 | 17.3 |
| dupont-aignan | 3.8 | 9.4 |
| le-pen | 1.2 | 2.1 |
| zemmour | 3.7 | 5.4 |
| abstention | 3.4 | 8.3 |

## Données manquantes / TODO

- **Patrimoine par PCS de niveau 2.** Introuvable en source primaire. Consultés : HVP 2023-2024 (Insee Résultats, 12 catégories), Les revenus et le patrimoine des ménages édition 2024 (fiche Patrimoine, 11 catégories), enquête Patrimoine 2017-2018 (Insee Résultats, 13 catégories). Aucun fichier détail de ces enquêtes trouvé en accès libre.
- **Niveau de vie des PCS 10, 21, 22, 23 séparées, et de la PCS 44.** L'ERFS ne les publie pas séparément (éditions 2019, 2022 et 2023 consultées).
- **Vote des agriculteurs (groupe 1).** Non isolé dans les rapports Ifop et Ipsos consultés. Elabe, Harris Interactive et OpinionWay n'ont pas été consultés.
- **Scores nationaux officiels.** Remplacer la ligne ensemble des sondages par les résultats du ministère de l'Intérieur, en tenant compte des agrégats propres à l'Ifop aux législatives.
- **Libellés.** `config/pcs.yaml` porte les libellés PCS 2003, les données suivent la PCS 2020.

## Reproduire

`uv run python scripts/build_data.py` télécharge les fichiers absents dans le cache, hors du dépôt (`SG_CACHE_DIR`, sinon `%LOCALAPPDATA%\saint-graphique\cache` sous Windows et `$XDG_CACHE_HOME/saint-graphique` ou `~/.cache/saint-graphique` ailleurs). Le fichier détail du recensement pèse environ 760 Mo. Les PDF ne servent qu'à vérifier les transcriptions, dont l'empreinte SHA-256 figure dans chaque CSV. `www.ifop.com` peut échouer avec `requests` (chaîne de certificats incomplète) : la construction aboutit quand même, et ces PDF se récupèrent à la main depuis les URL citées, par exemple avec curl ou un navigateur.
