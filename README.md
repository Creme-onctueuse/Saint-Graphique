# Saint-Graphique : reconstruction ouverte

Reconstruction **open source, sourcée et vérifiable** du « Saint-Graphique », le graphique de sociologie électorale présenté par Chris (revue *Positions*) dans les vidéos de la PaduTeam.

Le Saint-Graphique a été créé par **Chris et la PaduTeam**. Ce projet est directement **inspiré de [JnthnBS/saint-graphique](https://github.com/JnthnBS/saint-graphique)**, dont il réimplémente l'algorithme reconstruit comme méthode de calcul. Voir [Crédits et inspiration](#crédits-et-inspiration).

> **Projet non officiel.** Il n'a aucun lien avec Positions Revue ni avec la PaduTeam. L'algorithme original n'a pas été publié : ce dépôt reprend les **positions lues** sur les vidéos publiques et propose des méthodes de calcul ouvertes, sans prétendre à l'identité exacte.

**Statut :** v1.0.0, réplique du tableau de Chris de février 2026 ([fidélité mesurée](#fidélité-de-la-réplique), [feuille de route](#feuille-de-route)). **Usage personnel et non commercial :** les données tirées des rapports Ifop ne sont pas publiées ([détails](#données-ifop--usage-personnel-et-non-commercial)).

## Le principe

Chaque **catégorie socioprofessionnelle** (PCS de l'Insee) est placée sur deux axes, de −10 à +10 :

| Axe | Sens |
|---|---|
| **X : Exploitation** | plus à droite = revenus tirés du capital plutôt que du travail |
| **Y : Domination** | plus haut = position dominante |

Chaque **électorat** (candidat, liste, abstention) est ensuite placé au **barycentre** des groupes sociaux qui le composent, pondérés par sa composition sociale (sondages du jour du vote).

Plusieurs **méthodes** coexistent et se choisissent dans l'interface :

- `read_positions` (par défaut) : la réplique. Les 41 catégories sont placées là où le tableau de Chris les affiche, sur sa grille de 0,5. Sa formule n'étant pas publiée, ces positions sont lues et non recalculées ;
- `ranks_jnthnbs` : la reconstruction de JnthnBS, calculée sur 30 points de données ouvertes. X est le rang du ratio patrimoine / niveau de vie, Y le rang du score de diplômes `5·bac+5 + 3·bac+3 + 2·bac+2 + bac − CAP − 2·brevet − 3·certificat/aucun` ;
- `continuous` : les mêmes scores en valeurs continues, sans l'effet « escalier » des rangs ;
- `mca` : une analyse des correspondances multiples, à titre exploratoire ;
- ellipses de confiance par bootstrap sur les marges d'erreur des sondages.

## Démarrage rapide

```powershell
# Windows : installe Git, Node, Python 3.12, uv, FFmpeg, VS Code et les dépendances
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1

uv run python scripts/build_data.py     # données ouvertes -> data/pcs.json, data/elections/*.json
uv run python -m pipeline.build         # méthodes -> data/computed/**
cd web; pnpm dev                        # application en développement
pnpm build                              # -> web/dist/index.html (fichier unique, autonome)
```

Sous Linux ou macOS : `uv sync --all-extras`, puis `cd web && pnpm install`.

Pour la vérification complète (identique à la CI) : `scripts/check.ps1`.

## Organisation du dépôt

```
config/      configuration déclarative (PCS, élections, paramètres des méthodes)
schemas/     JSON Schemas des fichiers échangés entre étapes (contrats)
pipeline/    Python : sources/ (collecte des données ouvertes), methods/ (placement), build.py
data/        données : pcs.json, positions_chris.json, elections/, computed/, SOURCES.md
web/         application Vite + TypeScript + D3 (build en un seul index.html)
scripts/     outillage : installation, validation, collecte et analyse des vidéos
docs/        méthodologie, chronologie des versions du graphique
research/    matériel local NON publié (vidéos, transcriptions, captures) : gitignoré
```

## Données et sources

Toutes les données proviennent de **sources citées**, recensées dans [`data/SOURCES.md`](data/SOURCES.md) :

- INSEE / data.gouv.fr (Licence Ouverte Etalab 2.0) : effectifs, diplômes, revenus et patrimoine ;
- rapports de sondage Ifop du jour du vote : composition sociale des électorats.

- `data/positions_chris.json` : positions et poids lus sur les vidéos de la PaduTeam, chaque poste étant cité par vidéo et horodatage. Le graphique étant l'œuvre de Chris, ce fichier n'est ni placé sous licence libre, ni publié.

Les vidéos, transcriptions et captures servent uniquement à l'analyse locale. Elles ne sont **pas redistribuées**. Seuls des chiffres dérivés figurent dans la documentation, chacun cité avec l'identifiant de la vidéo et l'horodatage.

### Données Ifop : usage personnel et non commercial

Les rapports Ifop dont sont tirées les 7 élections indiquent : « Aucune publication totale ou partielle ne peut être faite sans l'accord exprès de l'Ifop. » Aucun accord n'a été demandé ni obtenu.

Ce projet a donc un usage **personnel et non commercial**, et les données tirées de ces rapports **ne sont pas publiées**. Sont concernés `data/elections/`, `pipeline/sources/manual/`, les coordonnées d'électorats de `data/computed/`, et donc la page construite à partir d'elles. La source Ifop reste citée sur la page et dans `data/SOURCES.md`.

Le code reste sous licence MIT, mais ces données n'y sont pas soumises. Le dépôt n'a pas de dépôt distant public, et le workflow GitHub Pages n'est pas lancé.

## Fidélité de la réplique

Écarts quadratiques moyens entre les positions lues sur les vidéos et celles de cette page, en unités d'axe. Détail et reproduction : [`docs/methodologie.md`](docs/methodologie.md).

| Comparaison | Points | `read_positions` X / Y | `ranks_jnthnbs` X / Y |
|---|---|---|---|
| Candidats 2022, tableau de mars 2025 | 7 | 0,16 / 0,20 | 0,16 / 0,91 |
| Candidats législatives 2024, tableau de mars 2025 | 3 | 0,22 / 0,18 | 0,06 / 0,53 |
| Candidats 2017, tableau de janvier 2025 | 5 | 0,21 / 0,23 | 0,26 / 1,23 |
| Listes européennes 2024, tableau de janvier 2025 | 4 | 0,15 / 0,24 | 0,30 / 1,14 |
| Candidats 2022, tableau de janvier 2025 | 8 | 0,75 / 0,39 | 0,71 / 1,03 |
| Candidats 2022, matrice v11 de septembre 2026 | 12 | 2,60 / 2,23 | 2,49 / 2,57 |
| Candidats 2017, matrice v11 de septembre 2026 | 9 | 2,91 / 2,03 | 2,58 / 2,14 |

**Seuil : RMSE sous 0,25 sur chaque axe**, soit un demi-pas de la grille de Chris, fixé après les mesures.

- Sur les 19 candidats du tableau, hors janvier 2025 pour 2022, `read_positions` l'atteint (0,18 et 0,21). Aucune autre méthode ne l'atteint.
- Avec cette lecture, soit 27 candidats, `read_positions` ne l'atteint plus (0,44 et 0,28).
- Contre la matrice v11, la dernière version montrée, aucune méthode ne l'atteint (`read_positions` : 2,74 et 2,15).

Ce que ces chiffres disent, et ne disent pas :

- **Les catégories coïncident par construction**, puisqu'elles sont lues : ce n'est pas une preuve. `ranks_jnthnbs` s'en écarte de 3,75 en X et 4,04 en Y sur 24 PCS.
- **Les candidats sont un vrai contrôle** : ces relevés n'entrent pas dans le calcul. Ils dépendent en revanche de nos compositions Ifop.
- **Janvier 2025, candidats 2022 :** Chris les a ensuite déplacés, alors que ses catégories n'ont pas bougé. Nous retrouvons sa version de mars.
- **La matrice v11 n'est pas répliquée.** C'est un autre modèle, à 7 lignes agrégées, dont le calcul de X n'est pas linéaire.
- **Une partie des poids est estimée :** sur 41, 18 sont lus, 16 tirés du recensement et 7 de la taille des disques.
- **L'axe X reste non élucidé.** Chris parle de niveau de capital, de composition du patrimoine et de taux de propriété, sans publier de formule. Les données testées ne tranchent pas, et la composition du patrimoine n'est publiée que pour 11 ou 12 catégories de ménages. `read_positions` n'a pas besoin de ce choix ; `ranks_jnthnbs` garde le ratio de JnthnBS, qui ne figure dans aucun énoncé relevé de Chris.
- **La réplique porte sur les positions et les calculs,** pas sur l'habillage du logiciel de Chris.

## Feuille de route

- **v1 : réplique (faite).** Méthode `read_positions`, écart mesuré et documenté.
- **v2 : rigueur.** Une méthode calculée sur données ouvertes qui se rapproche de ces positions : retraités par ancienne catégorie, 41 postes, définition de X confrontée aux lectures. Sont déjà en place les valeurs continues, l'ACM exploratoire, les ellipses et les sources affichées.
- **v3 : exploration.** Évolution animée d'une élection à l'autre, comparaison des méthodes côte à côte, sous-groupes (âge, territoire), version anglaise.

## Publication

**En l'état, ce dépôt et sa page ne doivent pas être publiés**, car ils contiennent des données tirées des rapports Ifop. Publier plus tard supposerait d'abord de retirer ces fichiers de tout l'historique git, pas seulement du dernier commit, ou d'obtenir l'accord de l'Ifop.

Les positions lues suivent la même règle : `data/positions_chris.json` et `data/computed/read_positions/` ne sont pas publiés non plus, sauf décision contraire. Ces chiffres sont cités, mais relevés sur le travail de Chris. Publier plus tard supposerait de les retirer aussi de l'historique, ou d'obtenir l'accord de Chris.

Le workflow `.github/workflows/pages.yml` ne se lance que manuellement. S'il est lancé un jour, il faut choisir *Settings → Pages → Source* = **GitHub Actions**.

## Contribuer

Voir [CONTRIBUTING.md](CONTRIBUTING.md) : comment ajouter une élection, une méthode ou une source.

## Crédits et inspiration

- **Chris et la PaduTeam : à l'origine du Saint-Graphique.** L'idée, le principe (PCS placées selon l'exploitation et la domination, électorats en barycentres), le graphique original et les positions reprises par `read_positions` viennent de Chris, de la revue [*Positions*](https://positions-revue.fr), et ont été présentés sur les chaînes YouTube [PaduTeam](https://www.youtube.com/@PaduTeam) et [Positions Revue](https://www.youtube.com/@Positions_revue).
- **[JnthnBS/saint-graphique](https://github.com/JnthnBS/saint-graphique) : inspiration de ce projet et source de l'algorithme reconstruit.** JnthnBS a le premier publié une reproduction du Saint-Graphique et documenté la méthode qu'il en a reconstruite :
  - rang du ratio patrimoine / niveau de vie ;
  - rang d'un score de diplômes ;
  - normalisation sur [−10, 10] ;
  - barycentres des électorats.

  C'est cette méthode que réimplémente `ranks_jnthnbs`. Ce dépôt étant publié sans licence, son code, ses données et ses éléments graphiques **ne sont pas copiés** : la méthode est réécrite d'après sa description et la lecture de son code, sans en reprendre une ligne. L'exactitude est vérifiée par un test local, non publié, qui s'exécute contre sa version. Toutes les données sont reprises aux sources primaires.
- **INSEE** et **instituts de sondage** : données citées dans [`data/SOURCES.md`](data/SOURCES.md).

Ce projet n'est pas affilié à ces auteurs. S'ils souhaitent une modification de ces mentions, une issue suffit.

## Licence

Le code est sous [MIT](LICENSE). Les données de `data/` restent soumises à la licence de leur source (voir `data/SOURCES.md`).
