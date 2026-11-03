# Sources des données

Fichier généré par `scripts/build_data.py`, à ne pas modifier à la main.

`data/` contient des chiffres issus de publications primaires (Insee, nomenclature-pcs.fr, Conseil constitutionnel, Ifop, Ipsos, CSA) ou calculés à partir d'elles par une méthode décrite ici, et les positions lues sur les vidéos de la PaduTeam (`data/positions_chris.json`). Aucune donnée de la reproduction citée dans les crédits n'y figure : son dépôt, sans licence, n'a servi que de contrôle local.

## Données Ifop : projet libre et non commercial

9 fichiers d'élections reposent sur des rapports Ifop, et chacun indique : « Aucune publication totale ou partielle ne peut être faite sans l'accord exprès de l'Ifop. » Aucun accord n'a été demandé ni obtenu.

Ce projet est libre et non commercial. Il publie les chiffres tirés de ces rapports en citant chacun d'eux : `data/elections/`, `pipeline/sources/manual/` et les coordonnées d'électorats de `data/computed/`. Si l'Ifop demande leur retrait, ils seront retirés. Ces lignes décrivent un usage, ce n'est pas un avis juridique.

## Autres instituts

Les autres élections ont une mention propre, reprise dans le champ `license` de leur source et dans le tableau ci-dessous. Les sondages du site d'Ipsos sont réutilisables avec attribution, d'après ses mentions légales : c'est aussi le cas de la page d'archive du sondage CSA de 1995. Le rapport CSA-Cisco de 2007 ne porte aucune mention de réutilisation.

## Jeux de données

| Jeu de données | Source | URL | Accès | Licence ou mention | Limites |
| --- | --- | --- | --- | --- | --- |
| `pcs.json` : population | Recensement de la population 2022 — Fichier détail « Individus localisés à la région » | https://www.insee.fr/fr/statistiques/8590183 | 2026-10-31 | Licence Ouverte / Open Licence 2.0 (Etalab), citer « Source : Insee » et la date de mise à jour, sans altérer le sens des informations ni induire en erreur sur leur interprétation | France hors Mayotte, 15 ans ou plus. PCS 2020 : mêmes codes qu'en PCS 2003 ; selon l'Insee, les 30 catégories sont inchangées dans leur contenu et certains intitulés ont été revus (https://www.insee.fr/fr/statistiques/4506075). Personnes en emploi et chômeurs ayant travaillé, classés selon leur CS. |
| `pcs.json` : diplômes | Recensement de la population 2022 — Fichier détail « Individus localisés à la région » | https://www.insee.fr/fr/statistiques/8590183 | 2026-10-31 | Licence Ouverte / Open Licence 2.0 (Etalab), citer « Source : Insee » et la date de mise à jour, sans altérer le sens des informations ni induire en erreur sur leur interprétation | Population non scolarisée (`ETUD = 2`). Calcul à partir du fichier détail : aucun tableau agrégé de l'Insee ne croise le diplôme et les 29 postes. |
| `acm_individus.json` : tableau croisé PCS, diplôme, logement, emploi | Recensement de la population 2022 — Fichier détail « Individus localisés à la région » | https://www.insee.fr/fr/statistiques/8590183 | 2026-10-31 | Licence Ouverte / Open Licence 2.0 (Etalab), citer « Source : Insee » et la date de mise à jour, sans altérer le sens des informations ni induire en erreur sur leur interprétation | Population non scolarisée (`ETUD = 2`) des 30 PCS, 15 ans ou plus. Poids sommés et arrondis, sans microdonnées. Colonnes `DIPL`, `STOCD`, `EMPL`, `TP`, `TACT`, `STAT_CS`, `AGEREV`, `IPONDI` : recodages dans `pipeline/sources/insee_acm_individus.py`. Le recensement ne donne ni revenu ni patrimoine. |
| `pcs.json` : niveau de vie et patrimoine, 29 PCS actives | Situation financière des ménages en 2020-2021, Portraits des six groupes socioprofessionnels, feuilles Ensemble | https://www.nomenclature-pcs.fr/uploads/tableaux/groupes/DEC_POR_8.xls | 2026-11-01 | Mentions légales du site : données réutilisables « sans licence », réutilisation « subordonnée au respect de l'intégrité de l'information et des données et à la mention précise des sources » (https://www.nomenclature-pcs.fr/informations-pratiques/mentions-legales) | Médianes, 2020-2021. Publié sur nomenclature-pcs.fr, pas sur insee.fr. Échantillon de l'enquête Patrimoine limité (environ 10 250 ménages), aucune marge publiée par PCS : valeurs fragiles pour les petites PCS, surtout 44. |
| `pcs.json` : niveau de vie des retraités | Niveau de vie et revenu annuel des individus en 2021, ERFS, Insee Résultats, tableau TI02D | https://www.insee.fr/fr/statistiques/7766291 | 2026-11-01 | Licence Ouverte / Open Licence 2.0 (Etalab), citer « Source : Insee » et la date de mise à jour, sans altérer le sens des informations ni induire en erreur sur leur interprétation | Médiane 2021, données provisoires selon l'Insee, France métropolitaine. |
| `pcs.json` : patrimoine des retraités | Patrimoine et endettement des ménages en 2024, enquête Histoire de vie et Patrimoine 2023-2024, Insee Résultats | https://www.insee.fr/fr/statistiques/8736842 | 2026-11-01 | Licence Ouverte / Open Licence 2.0 (Etalab), citer « Source : Insee » et la date de mise à jour, sans altérer le sens des informations ni induire en erreur sur leur interprétation | Valeur calculée, non publiée : voir plus bas. |
| `pcs.json` : composition du patrimoine | Composition du patrimoine brut et taux de détention selon la catégorie de la personne de référence, enquête Histoire de vie et Patrimoine 2020-2021, Insee Résultats | https://www.insee.fr/fr/statistiques/8262352 | 2026-11-01 | Licence Ouverte / Open Licence 2.0 (Etalab), citer « Source : Insee » et la date de mise à jour, sans altérer le sens des informations ni induire en erreur sur leur interprétation | 11 catégories de ménages, pas le niveau 2 : voir plus bas. |
| `pcs.json` : part de propriétaires | Lien à la migration, taille d'unité urbaine et statut d'occupation du logement, Portraits des six groupes socioprofessionnels, feuilles Ensemble | https://www.nomenclature-pcs.fr/uploads/tableaux/groupes/DEC_POR_4.xls | 2026-11-01 | Mentions légales du site : données réutilisables « sans licence », réutilisation « subordonnée au respect de l'intégrité de l'information et des données et à la mention précise des sources » (https://www.nomenclature-pcs.fr/informations-pratiques/mentions-legales) | Seul indicateur de détention publié en 29 postes. Enquête Emploi 2024. Ni la PCS 44 ni les retraités. |
| `elections/1995_presidentielle_t1.json` | CSA pour Le Parisien-Aujourd'hui, France 3, Radio France et L'Express, Sondage sortie des urnes, 23 avril 1995 | https://www.ipsos.com/fr-fr/sondage-sortie-des-urnes-0 | 2026-11-02 | Mentions légales d'Ipsos (https://www.ipsos.com/fr-fr/mentions-legales) : les sondages du site sont réputés dans le domaine public et réutilisables en tout ou partie, avec attribution, en notant si possible la date, le commanditaire, la méthode et un lien vers le site d'Ipsos. Page d'archive d'un sondage CSA. | Composition calculée, pas publiée : vote de chaque groupe, en entiers, converti avec le recensement de 1999 ; agriculteurs publiés (clé « 1 ») ; retraités et inactifs réunis par le sondage (colonne 7), rattachés aux retraités ; candidats sous 1 % sans composition ; abstention officielle, sans détail par groupe ; petits électorats très imprécis. Détails dans `sources[].notes`. |
| `elections/2002_presidentielle_t1.json` | Ipsos pour Vizzavi, Le Figaro, France 2, Europe 1 et Le Point, 1er tour présidentielle 2002 : comprendre le vote des Français, qui a voté quoi ?, 22 avril 2002 | https://www.ipsos.com/fr-fr/1er-tour-presidentielle-2002comprendre-le-vote-des-francais-qui-vote-quoi-les-motivations-de-vote | 2026-11-02 | Mentions légales d'Ipsos (https://www.ipsos.com/fr-fr/mentions-legales) : les sondages du site sont réputés dans le domaine public et réutilisables en tout ou partie, avec attribution, en notant si possible la date, le commanditaire, la méthode et un lien vers le site d'Ipsos. | Composition calculée, pas publiée : vote de chaque groupe, en entiers, converti avec le recensement de 1999 ; agriculteurs publiés (clé « 1 ») ; candidats sous 1 % sans composition ; petits électorats très imprécis. Détails dans `sources[].notes`. |
| `elections/2007_presidentielle_t1.json` | CSA-Cisco pour France 3, France Inter, France Info, Le Parisien et Aujourd'hui en France, L'élection présidentielle : explication du vote et perspectives politiques, sondage sortie des urnes, avril 2007 | https://www.cisco.com/web/FR/csa/sondage_sortie_urnes.pdf | 2026-11-02 | Rapport publié sur cisco.com, sans mention de réutilisation. Chiffres cités, projet libre et non commercial, retirés sur demande. | Parts ramenées à 100 sans « Autre inactif » ; agriculteurs non publiés (clé « 1 » absente) ; candidats sous 1 % sans composition ; abstention officielle, sans détail par groupe ; petits électorats très imprécis. Détails dans `sources[].notes`. |
| `elections/2012_presidentielle_t1.json` | Ifop-Fiducial pour Europe 1, Paris Match et Public Sénat, Premier tour de l'élection présidentielle 2012 : profil des électeurs et clés du scrutin, 22 avril 2012 | https://www.ifop.com/wp-content/uploads/2018/03/1848-1-study_file.pdf | 2026-11-02 | Rapport © Ifop. Il indique : « Aucune publication totale ou partielle ne peut être faite sans l'accord exprès de l'Ifop. » Aucun accord n'a été demandé ni obtenu : projet libre et non commercial, chiffres cités et retirés sur demande, voir data/SOURCES.md. | Composition calculée, pas publiée : vote de chaque groupe, en entiers, converti avec le recensement de 2011 ; Parts ramenées à 100 sans « Autre inactif » ; agriculteurs non publiés (clé « 1 » absente) ; candidats sous 1 % sans composition ; abstention officielle, sans détail par groupe ; petits électorats très imprécis. Détails dans `sources[].notes`. |
| `elections/2014_europeennes.json` | Ifop-Fiducial pour i>TELE, Paris Match et Sud Radio, Sondage Jour du Vote : profil des électeurs et clefs du scrutin européen, 25 mai 2014 | https://www.ifop.com/wp-content/uploads/2018/03/2670-1-study_file.pdf | 2026-11-02 | Rapport © Ifop. Il indique : « Aucune publication totale ou partielle ne peut être faite sans l'accord exprès de l'Ifop. » Aucun accord n'a été demandé ni obtenu : projet libre et non commercial, chiffres cités et retirés sur demande, voir data/SOURCES.md. | Composition calculée, pas publiée : vote de chaque groupe, en entiers, converti avec le recensement de 2016 ; Parts ramenées à 100 sans « Autre inactif » ; agriculteurs non publiés (clé « 1 » absente) ; candidats sous 1 % sans composition ; petits électorats très imprécis. Détails dans `sources[].notes`. |
| `elections/2017_presidentielle_t1.json` | Ifop et Fiducial pour Paris Match, CNews et Sud Radio, Le profil des électeurs et les clefs du premier tour de l'élection présidentielle, 23 avril 2017 | https://www.ifop.com/wp-content/uploads/2018/03/3749-1-study_file.pdf | 2026-10-31 | Rapport © Ifop. Il indique : « Aucune publication totale ou partielle ne peut être faite sans l'accord exprès de l'Ifop. » Aucun accord n'a été demandé ni obtenu : projet libre et non commercial, chiffres cités et retirés sur demande, voir data/SOURCES.md. | Parts ramenées à 100 sans « Autre inactif » ; agriculteurs non publiés (clé « 1 » absente) ; petits électorats très imprécis. Détails dans `sources[].notes`. |
| `elections/2017_legislatives_t1.json` | Ifop et Fiducial pour Paris Match, CNews et Sud Radio, Le profil des électeurs et les clefs du premier tour des élections législatives, 11 juin 2017 | https://www.ifop.com/wp-content/uploads/2018/03/3791-1-study_file.pdf | 2026-10-31 | Rapport © Ifop. Il indique : « Aucune publication totale ou partielle ne peut être faite sans l'accord exprès de l'Ifop. » Aucun accord n'a été demandé ni obtenu : projet libre et non commercial, chiffres cités et retirés sur demande, voir data/SOURCES.md. | Parts ramenées à 100 sans « Autre inactif » ; agriculteurs non publiés (clé « 1 » absente) ; petits électorats très imprécis. Détails dans `sources[].notes`. |
| `elections/2019_europeennes.json` | Ifop-Fiducial pour Paris Match, CNEWS et Sud Radio, Européennes 2019 : profil des électeurs et clefs du scrutin, 27 mai 2019 | https://www.ifop.com/wp-content/uploads/2019/05/116339-rapport-jdv-complet-detaille_2019_05.27.pdf | 2026-10-31 | Rapport © Ifop. Il indique : « Aucune publication totale ou partielle ne peut être faite sans l'accord exprès de l'Ifop. » Aucun accord n'a été demandé ni obtenu : projet libre et non commercial, chiffres cités et retirés sur demande, voir data/SOURCES.md. | Parts ramenées à 100 sans « Autre inactif » ; agriculteurs non publiés (clé « 1 » absente) ; petits électorats très imprécis. Détails dans `sources[].notes`. |
| `elections/2022_presidentielle_t1.json` | Ifop-Fiducial pour TF1 & LCI, Présidentielle 2022, sondage jour du vote : profil des électeurs et clés du scrutin (1er tour), 10 avril 2022 | https://www.ifop.com/wp-content/uploads/2022/04/118997-Rapport-JDV-PRE22-T1-DET-11.04-1.pdf | 2026-10-31 | Rapport © Ifop. Il indique : « Aucune publication totale ou partielle ne peut être faite sans l'accord exprès de l'Ifop. » Aucun accord n'a été demandé ni obtenu : projet libre et non commercial, chiffres cités et retirés sur demande, voir data/SOURCES.md. | Parts ramenées à 100 sans « Autre inactif » ; agriculteurs non publiés (clé « 1 » absente) ; petits électorats très imprécis. Détails dans `sources[].notes`. |
| `elections/2022_legislatives_t1.json` | Ifop-Fiducial pour TF1, LCI, Paris Match et Sud Radio, Législatives 2022, sondage jour du vote : profil des électeurs et clés du scrutin (1er tour), 12 juin 2022 | https://www.ifop.com/wp-content/uploads/2022/06/119150-Rapport-JDV-LEG22-T1-v1-12.06.2022-22h25-COMPLET.pdf | 2026-10-31 | Rapport © Ifop. Il indique : « Aucune publication totale ou partielle ne peut être faite sans l'accord exprès de l'Ifop. » Aucun accord n'a été demandé ni obtenu : projet libre et non commercial, chiffres cités et retirés sur demande, voir data/SOURCES.md. | Parts ramenées à 100 sans « Autre inactif » ; agriculteurs non publiés (clé « 1 » absente) ; petits électorats très imprécis. Détails dans `sources[].notes`. |
| `elections/2024_europeennes.json` | Ifop-Fiducial pour LCI, Le Figaro et Sud Radio, Européennes 2024, sondage jour du vote : profil des électeurs et clés du scrutin, 9 juin 2024 | https://www.ifop.com/wp-content/uploads/2024/06/DET-120537-Rapport-JDV-EUR24-10.06.2024.pdf | 2026-10-31 | Rapport © Ifop. Il indique : « Aucune publication totale ou partielle ne peut être faite sans l'accord exprès de l'Ifop. » Aucun accord n'a été demandé ni obtenu : projet libre et non commercial, chiffres cités et retirés sur demande, voir data/SOURCES.md. | Parts ramenées à 100 sans « Autre inactif » ; agriculteurs non publiés (clé « 1 » absente) ; petits électorats très imprécis. Détails dans `sources[].notes`. |
| `elections/2024_legislatives_t1.json` | Ifop pour TF1 et LCI, Analyse du premier tour des élections législatives 2024 : participation et structuration des électorats, juin 2024 (n° 120976) | https://www.ifop.com/wp-content/uploads/2024/07/120976-Resultats.pdf | 2026-10-31 | Rapport © Ifop. Il indique : « Aucune publication totale ou partielle ne peut être faite sans l'accord exprès de l'Ifop. » Aucun accord n'a été demandé ni obtenu : projet libre et non commercial, chiffres cités et retirés sur demande, voir data/SOURCES.md. | Parts ramenées à 100 sans « Autre inactif » ; agriculteurs non publiés (clé « 1 » absente) ; petits électorats très imprécis. Détails dans `sources[].notes`. |
| `elections/` : `1995_presidentielle_t1` | Conseil constitutionnel, décision n° 95-79 PDR du 26 avril 1995, résultats du premier tour | https://www.conseil-constitutionnel.fr/decision/1995/9579pdr.htm | 2026-11-02 | non indiquée | Résultats officiels du scrutin. |
| `elections/` : `1995_presidentielle_t1`, `2002_presidentielle_t1`, `2012_presidentielle_t1`, `2014_europeennes` | Données harmonisées des recensements de la population 1968-2022, fichier détail | https://www.insee.fr/fr/statistiques/8672621?sommaire=2414232 | 2026-11-02 | Licence Ouverte / Open Licence 2.0 (Etalab), citer « Source : Insee » et la date de mise à jour, sans altérer le sens des informations ni induire en erreur sur leur interprétation | Effectifs par groupe, pour la conversion : voir plus bas. |
| `elections/` : `2007_presidentielle_t1` | Conseil constitutionnel, décision n° 2007-139 PDR du 25 avril 2007, résultats du premier tour | https://www.conseil-constitutionnel.fr/decision/2007/2007139PDR.htm | 2026-11-02 | non indiquée | Résultats officiels du scrutin. |
| `elections/` : `2012_presidentielle_t1` | Conseil constitutionnel, décision n° 2012-152 PDR du 25 avril 2012, résultats du premier tour | https://www.conseil-constitutionnel.fr/decision/2012/2012152PDR.htm | 2026-11-02 | non indiquée | Résultats officiels du scrutin. |

## Niveau de vie et patrimoine

- **Statuts.** `niveau_vie_status` : 30 published. `patrimoine_status` : 29 published, 1 calculated. Ex æquo stricts sur le ratio patrimoine / niveau de vie : 0.
- **29 PCS actives.** Table « Situation financière des ménages … en 2020-2021 », feuilles Ensemble : https://www.nomenclature-pcs.fr/uploads/tableaux/groupes/DEC_POR_8.xls. Source indiquée par le fichier : Insee, enquête Revenus fiscaux et sociaux 2021 et Patrimoine histoire de vie, 2020-2021. Le site appartient conjointement à l'Insee, à Progedo (CNRS), au Cnam-CEET et au laboratoire Printemps. Ses mentions légales (https://www.nomenclature-pcs.fr/informations-pratiques/mentions-legales) autorisent la réutilisation « sans licence », « subordonnée au respect de l'intégrité de l'information et des données et à la mention précise des sources ». Seules les colonnes de niveau de vie et de patrimoine sont lues, sans modification.
- **Champ.** Personnes actives ayant déjà travaillé, comme les effectifs retenus ici pour le recensement. Le patrimoine est celui du ménage où elles vivent.
- **Millésimes.** Les effectifs et les diplômes datent de 2022, le niveau de vie et le patrimoine de 2020-2021.
- **Niveau de vie des retraités.** Publié par l'Insee (ERFS 2021, ligne Retraités).
- **Patrimoine des retraités : calculé, non publié.** L'Insee publie plusieurs catégories de retraités, sans ensemble, et n'en donne la répartition dans les déciles de patrimoine que pour 2023-2024. Leur médiane commune y est estimée à 263,5 k€ par interpolation linéaire, entre les seuils publiés 205,1 et 283,2 k€. Elle est ramenée à début 2021 par le rapport des médianes de l'ensemble des ménages (177,2 / 205,1), soit **227,7 k€**, entre 177,2 et 244,7 k€ si ce rapport s'applique aux retraités. Repères publiés en 2020-2021 : 232,8 k€ pour les ménages de 60 à 69 ans, 211,5 k€ pour ceux de 70 ans ou plus.
- **Comparaison avec la reproduction de référence.** Pour les 29 PCS actives, les valeurs coïncident avec les siennes parce que c'est la même table. Cet accord n'est donc pas une validation indépendante.

| PCS | Libellé | Niveau de vie (€/mois) | Statut | Patrimoine (k€) | Statut | Patrimoine professionnel (%) | Statut de la composition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10 | Exploitants de l'agriculture, sylviculture, pêche et aquaculture | 2172.33 | publié | 668.272 | publié | 71.3 | publié |
| 21 | Artisans | 1786.33 | publié | 359.551 | publié | 32.9 | **imputé** |
| 22 | Commerçants et assimilés | 2085.92 | publié | 444.831 | publié | 32.9 | **imputé** |
| 23 | Chefs d'entreprise de plus de 10 personnes | 3503.83 | publié | 1532.262 | publié | 32.9 | **imputé** |
| 31 | Professions libérales | 3566.92 | publié | 583.019 | publié | 14.3 | publié |
| 33 | Cadres administratifs et techniques de la fonction publique | 2918.83 | publié | 449.187 | publié | 3.0 | **imputé** |
| 34 | Professeurs et professions scientifiques supérieures | 2853.83 | publié | 405.544 | publié | 3.0 | **imputé** |
| 35 | Professions de l'information, de l'art et des spectacles | 2238.25 | publié | 278.415 | publié | 3.0 | **imputé** |
| 37 | Cadres des services administratifs et commerciaux d'entreprise | 3135.08 | publié | 551.005 | publié | 3.0 | **imputé** |
| 38 | Ingénieurs et cadres techniques d'entreprise | 2987.75 | publié | 385.945 | publié | 3.0 | **imputé** |
| 42 | Professions de l'enseignement primaire et professionnel, de la formation continue et du sport | 2177.92 | publié | 270.103 | publié | 6.1 | **imputé** |
| 43 | Professions intermédiaires de la santé et du travail social | 2321.75 | publié | 255.3 | publié | 6.1 | **imputé** |
| 44 | Ministres du culte et religieux consacrés | 1448.92 | publié | 213.52 | publié | 6.1 | **imputé** |
| 45 | Professions intermédiaires de la fonction publique (administration, sécurité) | 2285.42 | publié | 267.53 | publié | 6.1 | **imputé** |
| 46 | Professions intermédiaires administratives et commerciales des entreprises | 2239.5 | publié | 263.879 | publié | 6.1 | **imputé** |
| 47 | Techniciens | 2223.0 | publié | 247.872 | publié | 6.1 | **imputé** |
| 48 | Agents de maîtrise (hors maîtrise administrative) | 2226.67 | publié | 246.633 | publié | 6.1 | **imputé** |
| 52 | Employés administratifs de la fonction publique, agents de service et auxiliaires de santé | 1859.0 | publié | 159.12 | publié | 8.1 | **imputé** |
| 53 | Policiers, militaires, pompiers, agents de sécurité privée | 1970.42 | publié | 205.555 | publié | 8.1 | **imputé** |
| 54 | Employés administratifs d'entreprise | 2083.33 | publié | 265.127 | publié | 8.1 | **imputé** |
| 55 | Employés de commerce | 1770.08 | publié | 56.68 | publié | 8.1 | **imputé** |
| 56 | Personnels des services directs aux particuliers | 1585.33 | publié | 62.821 | publié | 8.1 | **imputé** |
| 62 | Ouvriers qualifiés de type industriel | 1933.17 | publié | 177.196 | publié | 3.7 | **imputé** |
| 63 | Ouvriers qualifiés de type artisanal | 1790.0 | publié | 190.4 | publié | 3.7 | **imputé** |
| 64 | Conducteurs de véhicules de transport, chauffeurs-livreurs, coursiers | 1815.5 | publié | 199.676 | publié | 3.7 | **imputé** |
| 65 | Conducteurs d'engins, caristes, magasiniers et ouvriers du transport (non routier) | 1819.0 | publié | 55.484 | publié | 3.7 | **imputé** |
| 67 | Ouvriers peu qualifiés de type industriel | 1742.58 | publié | 31.917 | publié | 3.7 | **imputé** |
| 68 | Ouvriers peu qualifiés de type artisanal | 1498.5 | publié | 102.265 | publié | 3.7 | **imputé** |
| 69 | Ouvriers agricoles, des travaux forestiers, de la pêche et de l'aquaculture | 1764.75 | publié | 87.202 | publié | 3.7 | **imputé** |
| 7 | Retraités | 1930.0 | publié | 227.658 | **calculé** | 3.19 | **calculé** |

## Composition du patrimoine : ce qui existe, et à quel niveau

Chris définit l'axe Exploitation par la composition du patrimoine des PCS : de l'absence de patrimoine jusqu'au capital d'entreprise. Le ratio patrimoine / niveau de vie vient de la méthode des rangs reconstruite. Cette composition n'est pas publiée au niveau 2 des PCS dans les sources consultées :

- **Insee, HVP 2020-2021 et 2023-2024.** Parts de la masse du patrimoine (immobilier, financier, professionnel, résiduel, et leur détail) et taux de détention : 11 catégories de ménages en 2020-2021, 12 en 2023-2024, selon la personne de référence. C'est le niveau le plus fin trouvé.
- **nomenclature-pcs.fr, portraits de groupes.** Aucune composition du patrimoine. Les fichiers DEC_POR_1 à 10 portent sur l'âge, la famille, la santé, la migration et le logement, l'origine sociale, le diplôme, l'emploi, la situation financière, le mode de vie et la participation sociale. Seule la part de propriétaires concerne la détention, en 29 postes. Les tableaux par thème (DEC_THEM_8) donnent des patrimoines immobilier et financier médians, mais par groupe de niveau 1 et sans patrimoine professionnel.

`patrimoine_composition_status` : 2 published, 27 imputed, 1 calculated.

- **published** (10, 31) : la catégorie correspond à une seule PCS, mais pour le ménage, pas pour l'individu.
- **imputed** : la valeur de la catégorie est appliquée à toutes ses PCS. Ce n'est pas une donnée Insee à ce niveau : `professionnel_pct` ne prend que 8 valeurs distinctes sur 30 PCS, et ne peut pas ordonner les PCS d'une même catégorie.
- **calculated** (7) : agrégation des 3 catégories de retraités de 2020-2021, avec les parts de ménages de 2023-2024, faute de publication en 2020-2021.
- **Clés.** `immobilier_pct`, `financier_pct`, `professionnel_pct`, `autre_pct` : parts de la masse du patrimoine brut (somme proche de 100). `professionnel_entreprises_pct`, `valeurs_mobilieres_pct` : parts de la masse, comprises dans les précédentes. `detention_immobilier_pct`, `detention_financier_pct`, `detention_professionnel_pct`, `detention_entreprise_pct` : taux de détention, en % des ménages. `proprietaire_pct` : part de propriétaires de leur logement, publiée pour la PCS (enquête Emploi 2024).
- **Vague retenue.** 2020-2021, comme le patrimoine ci-dessus. D'une vague à l'autre, les parts bougent fortement (patrimoine professionnel des agriculteurs : 71,3 % en 2020-2021, 59,3 % en 2023-2024) : ces écarts donnent un ordre de grandeur de leur imprécision.

## Composition des électorats

- De 2017 à 2024, les rapports Ifop publient directement la composition de chaque électorat, et CSA aussi en 2007 : aucune conversion n'entre dans ces fichiers. En 1995, 2002, 2012 et 2014, le sondage publie le vote de chaque groupe : la composition de `data/` est alors calculée (voir plus bas). Les tableaux sont transcrits dans `pipeline/sources/manual/`, avec les pages et l'empreinte SHA-256 du PDF.
- « Autre inactif » (étudiants, personnes au foyer...) est hors des 30 PCS : il est retiré et les parts sont ramenées à 100 sur les groupes restants. Les parts publiées restent dans les CSV.
- En 1995 et 2002, le sondage isole les agriculteurs : ils ont leur clé « 1 ». En 1995, il réunit retraités et inactifs sur une ligne, rattachée ici aux retraités.
- Une abstention sans détail par groupe (1995, 2007, 2012) garde le taux officiel, sans composition : elle n'a pas de point sur la carte. Les candidats sous 1 % de ces tableaux non plus : dans un tableau en entiers, leurs parts ne sont que des arrondis.
- La ligne « Artisan ou commerçant » (« Travailleur indépendant » en 2017) est rattachée au groupe 2. Le tiret des rapports est lu comme 0. Aucun rapport ne dit où sont comptés les agriculteurs. Parmi les inscrits, cette ligne pèse environ 4,5 à 5 %, plus proche des groupes 1 et 2 réunis du recensement (4,5 %) que du groupe 2 seul (3,7 %) : ils y sont peut-être inclus, sans certitude.
- `national_share_pct` reprend la ligne ensemble du sondage, pas le résultat officiel, sauf en 1995 où la page n'en publie pas : les scores y sont ceux du Conseil constitutionnel.
- `margin_pts` n'est pas renseigné. Les méthodes l'utilisent comme marge de chaque électorat, or la marge de l'échantillon total la sous-estimerait fortement : un électorat ne représente qu'une fraction de l'échantillon. La taille d'échantillon est dans `sources[].notes`.
- Européennes 2019 : pour quelques listes, « Catégorie supérieure » dépasse la somme de ses deux sous-lignes, sans explication dans le rapport. Cette part n'est rattachée à aucun groupe. Cette année-là, « Artisan ou commerçant » ne pèse que 3,4 % des inscrits : l'écart correspond peut-être aux agriculteurs, sans certitude.
- Législatives 2024 : enquête réalisée du 26 au 29 juin, avant le scrutin, puis redressée sur les résultats officiels. Ce n'est pas un sondage du jour du vote.

## Conversion du vote par groupe en composition

**Poids.** `pipeline/sources/manual/poids_recensements.csv` donne les Français de 18 ans ou plus par groupe, à chaque recensement, d'après les données harmonisées de l'Insee (fichier de 255 Mo, lu par `scripts/collect/poids_recensements.py`, non nécessaire à la construction). Chaque tableau utilise le recensement le plus proche : 1999 pour 1995 et 2002, 2011 pour 2012, 2016 pour 2014. Ce calcul retrouve les effectifs de 2022 obtenus par ailleurs à partir du fichier détail du recensement. Quand le sondage publie l'abstention par groupe (2002, 2014), le poids d'un groupe parmi les votants tient compte de sa participation.

**Contrôle sur les scores nationaux.** Le vote des groupes, pondéré par ces effectifs, doit redonner le score national du tableau (`sondages.national_check`, en points) :

| Élection | Candidats | Écart moyen (points) | Écart maximal (points) |
| --- | --- | --- | --- |
| 1995_presidentielle_t1 | 9 | 0.48 | 1.56 |
| 2002_presidentielle_t1 | 16 | 0.31 | 0.92 |
| 2012_presidentielle_t1 | 10 | 0.32 | 1.06 |
| 2014_europeennes | 15 | 0.14 | 0.53 |

**Contrôle sur une composition publiée.** CSA publie les deux tableaux en 2007 : la composition convertie depuis le vote, avec le recensement de 2006, est comparée à la composition publiée, sur les groupes communs ramenés à 100.

| Électorat | Écart moyen (points) | Écart maximal (points) |
| --- | --- | --- |
| schivardi | 10.0 | 28.3 |
| laguiller | 3.0 | 10.3 |
| besancenot | 1.0 | 2.4 |
| bove | 2.3 | 4.7 |
| buffet | 2.8 | 6.3 |
| voynet | 2.1 | 5.3 |
| royal | 0.6 | 1.2 |
| nihous | 3.5 | 7.1 |
| bayrou | 0.3 | 0.7 |
| sarkozy | 0.3 | 0.6 |
| de-villiers | 2.1 | 4.0 |
| le-pen | 0.5 | 1.2 |

## Contrôle de la conversion de Bayes

La conversion (`sondages.bayes_composition`) est aussi contrôlée sur la présidentielle 2022 : le vote par profession publié par Ipsos, converti avec les effectifs du recensement (Français de 18 ans ou plus) et l'abstention par groupe, est comparé à la composition publiée par l'Ifop, sur les 5 groupes communs ramenés à 100. Ipsos 2022 ne sert qu'à ce contrôle.

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

- **Composition du patrimoine par PCS de niveau 2.** Introuvable : voir plus haut. Aucun fichier détail de l'enquête Patrimoine trouvé en accès libre.
- **Patrimoine et niveau de vie des retraités en 2020-2021.** Aucun ensemble publié ; le patrimoine reste un calcul.
- **Vote des agriculteurs (groupe 1).** Isolé seulement en 1995 (CSA) et en 2002 (Ipsos), pas dans les rapports Ifop et CSA 2007. Elabe, Harris Interactive et OpinionWay n'ont pas été consultés.
- **Avant 1995 et législatives de 2012.** Aucun tableau complet du vote par profession trouvé au premier tour : voir docs/methodologie.md, section 7.
- **Scores nationaux officiels.** Remplacer la ligne ensemble des sondages par les résultats du ministère de l'Intérieur, en tenant compte des agrégats propres à l'Ifop aux législatives.

## Positions lues sur le graphique de Chris

`data/positions_chris.json` reprend les positions et une partie des poids affichés par le tableau de Chris, lus sur ces vidéos de la PaduTeam. Chaque poste y cite sa vidéo et son horodatage. Ces chiffres ne sont pas placés sous licence libre. Le fichier est écrit par `scripts/analyze/build_positions.py` à partir de relevés locaux.

- [PaduTeam, Première présentation du graphique (diapositive), 2025-01-07](https://youtu.be/MJsGgEA_Slw?t=421)
- [PaduTeam, Tableau interactif, infobulles lues, 2025-03-27](https://youtu.be/GTN2rUgOdFo?t=345)
- [PaduTeam, Tableau en plein écran, 2026-02-14](https://youtu.be/iXImwyHjrwM?t=656)
- [PaduTeam, Tableau révisé : deux catégories d'employés déplacées, 2026-02-28](https://youtu.be/81kznHfk78k?t=700)

## Reproduire

`uv run python scripts/build_data.py` télécharge les fichiers absents dans le cache, hors du dépôt (`SG_CACHE_DIR`, sinon `%LOCALAPPDATA%\saint-graphique\cache` sous Windows et `$XDG_CACHE_HOME/saint-graphique` ou `~/.cache/saint-graphique` ailleurs). Le fichier détail du recensement pèse environ 760 Mo. Les PDF ne servent qu'à vérifier les transcriptions, dont l'empreinte SHA-256 figure dans chaque CSV. `www.ifop.com` peut échouer avec `requests` (chaîne de certificats incomplète) : la construction aboutit quand même, et ces PDF se récupèrent à la main depuis les URL citées, par exemple avec curl ou un navigateur.
