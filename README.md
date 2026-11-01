# Saint-Graphique : reconstruction ouverte

Reconstruction **open source, sourcée et vérifiable** du « Saint-Graphique », le graphique de sociologie électorale présenté par Chris (revue *Positions*) dans les vidéos de la PaduTeam.

Le Saint-Graphique a été créé par **Chris et la PaduTeam**. Ce projet est directement **inspiré de [JnthnBS/saint-graphique](https://github.com/JnthnBS/saint-graphique)**, dont il réimplémente l'algorithme reconstruit. Voir [Crédits et inspiration](#crédits-et-inspiration).

> **Projet non officiel.** Il n'a aucun lien avec Positions Revue ni avec la PaduTeam. L'algorithme original n'a pas été publié : ce dépôt en propose une **reconstruction**, calée sur les vidéos publiques et documentée, sans prétendre à l'identité exacte.

**Statut :** en construction (v0.x). Voir la [feuille de route](#feuille-de-route). **À régler avant toute publication :** [la mention de l'Ifop](#question-ouverte--la-mention-de-lifop).

## Le principe

Chaque **catégorie socioprofessionnelle** (PCS INSEE, 29 postes de niveau 2 et les retraités) est placée sur deux axes :

| Axe | Sens | Mesure (méthode de réplique) |
|---|---|---|
| **X : Exploitation** | plus à droite = revenus tirés du capital plutôt que du travail | rang du ratio patrimoine / niveau de vie |
| **Y : Domination** | plus haut = position dominante | rang d'un score de diplômes : `5·bac+5 + 3·bac+3 + 2·bac+2 + bac − CAP − 2·brevet − 3·certificat/aucun` |

Les rangs sont ramenés sur [−10, 10]. Chaque **électorat** (candidat, liste, abstention) est ensuite placé au **barycentre** des PCS qui le composent, pondérées par sa composition sociale (sondages sortie des urnes).

Plusieurs **méthodes** coexistent et sont comparables dans l'interface :

- `ranks_chris_v1` : réplique par rangs, la plus proche du graphique original ;
- `continuous` : valeurs continues standardisées au lieu des rangs, ce qui supprime l'effet « escalier » ;
- `mca` : une véritable analyse des correspondances multiples ;
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
data/        données publiées : pcs.json, elections/, computed/, SOURCES.md
web/         application Vite + TypeScript + D3 (build en un seul index.html)
scripts/     outillage : installation, validation, collecte et analyse des vidéos
docs/        méthodologie, chronologie des versions du graphique
research/    matériel local NON publié (vidéos, transcriptions, captures) : gitignoré
```

## Données et sources

Toutes les données publiées proviennent de **sources primaires citées**, recensées dans [`data/SOURCES.md`](data/SOURCES.md) :

- INSEE / data.gouv.fr (Licence Ouverte Etalab 2.0) : effectifs, diplômes, revenus et patrimoine ;
- rapports de sondage Ifop du jour du vote : composition sociale des électorats.

Les vidéos, transcriptions et captures servent uniquement à l'analyse locale. Elles ne sont **pas redistribuées**. Seuls des chiffres dérivés sont publiés, chacun cité avec l'identifiant de la vidéo et l'horodatage.

### Question ouverte : la mention de l'Ifop

Les rapports Ifop dont sont tirées les 7 élections indiquent : « Aucune publication totale ou partielle ne peut être faite sans l'accord exprès de l'Ifop. » **Aucun accord n'est documenté à ce jour.** Sont concernés `data/elections/`, `pipeline/sources/manual/` et les coordonnées d'électorats de `data/computed/`, donc aussi la page construite.

Le code reste sous licence MIT, mais ces données n'y sont pas soumises. La question reste à trancher avant toute publication : obtenir l'accord de l'Ifop, s'appuyer sur d'autres sources, ou ne publier que le code et les données INSEE. Pour cette raison, le déploiement sur GitHub Pages n'est lancé que manuellement.

### Limite actuelle de l'axe X

Le patrimoine et une partie du niveau de vie ne sont pas toujours publiés au niveau de détail des 30 PCS. Quand une valeur est imputée ou calculée, `data/SOURCES.md` et la page l'indiquent, et l'ordre des PCS concernées sur l'axe X ne doit pas être lu comme une mesure.

## Feuille de route

- **v1 : réplique.** Méthode `ranks_chris_v1`, calée sur les captures des vidéos ; écart mesuré et documenté.
- **v2 : rigueur.** Valeurs continues, ACM, incertitudes (ellipses par bootstrap), sources affichées dans l'application.
- **v3 : exploration.** Évolution animée d'une élection à l'autre, comparaison des méthodes côte à côte, sous-groupes (âge, territoire), version anglaise.

## Publication sur GitHub Pages

1. Pousser le dépôt sur GitHub.
2. Dans *Settings → Pages → Build and deployment*, choisir *Source* = **GitHub Actions**.
3. Une fois [la question de l'Ifop](#question-ouverte--la-mention-de-lifop) réglée, lancer manuellement le workflow `.github/workflows/pages.yml` (onglet *Actions*). Il publie `web/dist/index.html`.

## Contribuer

Voir [CONTRIBUTING.md](CONTRIBUTING.md) : comment ajouter une élection, une méthode ou une source.

## Crédits et inspiration

- **Chris et la PaduTeam : à l'origine du Saint-Graphique.** L'idée, le principe (PCS placées selon l'exploitation et la domination, électorats en barycentres) et le graphique original viennent de Chris, de la revue [*Positions*](https://positions-revue.fr), et ont été présentés sur les chaînes YouTube [PaduTeam](https://www.youtube.com/@PaduTeam) et [Positions Revue](https://www.youtube.com/@Positions_revue).
- **[JnthnBS/saint-graphique](https://github.com/JnthnBS/saint-graphique) : inspiration de ce projet et source de l'algorithme reconstruit.** JnthnBS a le premier publié une reproduction du Saint-Graphique et documenté la méthode qu'il en a reconstruite :
  - rang du ratio patrimoine / niveau de vie ;
  - rang d'un score de diplômes ;
  - normalisation sur [−10, 10] ;
  - barycentres des électorats.

  C'est cette méthode que réimplémente `ranks_chris_v1`. Ce dépôt étant publié sans licence, son code, ses données et ses éléments graphiques **ne sont pas copiés** : la méthode est réécrite d'après sa description et la lecture de son code, sans en reprendre une ligne. L'exactitude est vérifiée par un test local, non publié, qui s'exécute contre sa version. Toutes les données sont reprises aux sources primaires.
- **INSEE** et **instituts de sondage** : données citées dans [`data/SOURCES.md`](data/SOURCES.md).

Ce projet n'est pas affilié à ces auteurs. S'ils souhaitent une modification de ces mentions, une issue suffit.

## Licence

Le code est sous [MIT](LICENSE). Les données de `data/` restent soumises à la licence de leur source (voir `data/SOURCES.md`).
