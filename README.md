# Saint-Graphique : reconstruction ouverte

Reconstruction **open source, sourcée et vérifiable** du « Saint-Graphique », le graphique de sociologie électorale présenté par Chris (revue *Positions*) dans les vidéos de la PaduTeam.

> **Projet non officiel.** Il n'a aucun lien avec Positions Revue ni avec la PaduTeam. L'algorithme original n'a pas été publié : ce dépôt en propose une **reconstruction**, calée sur les vidéos publiques et documentée, sans prétendre à l'identité exacte.

**Statut :** en construction (v0.x). Voir la [feuille de route](#feuille-de-route).

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
- sondages de sortie des urnes publiés : composition sociale des électorats.

Les vidéos, transcriptions et captures servent uniquement à l'analyse locale. Elles ne sont **pas redistribuées**. Seuls des chiffres dérivés sont publiés, chacun cité avec l'identifiant de la vidéo et l'horodatage.

## Feuille de route

- **v1 : réplique.** Méthode `ranks_chris_v1`, calée sur les captures des vidéos ; écart mesuré et documenté.
- **v2 : rigueur.** Valeurs continues, ACM, incertitudes (ellipses par bootstrap), sources affichées dans l'application.
- **v3 : exploration.** Évolution animée d'une élection à l'autre, comparaison des méthodes côte à côte, sous-groupes (âge, territoire), version anglaise.

## Publication sur GitHub Pages

1. Pousser le dépôt sur GitHub.
2. Dans *Settings → Pages → Build and deployment*, choisir *Source* = **GitHub Actions**.
3. Le workflow `.github/workflows/pages.yml` publie `web/dist/index.html` à chaque push sur `main`.

## Contribuer

Voir [CONTRIBUTING.md](CONTRIBUTING.md) : comment ajouter une élection, une méthode ou une source.

## Crédits

- **Chris (revue *Positions*)** : idée, principe et graphique original, présentés dans les vidéos de la PaduTeam.
- **JnthnBS** : première reproduction indépendante ([github.com/JnthnBS/saint-graphique](https://github.com/JnthnBS/saint-graphique)), qui a documenté une méthode par rangs. Son code et ses données, publiés sans licence, ne sont **pas réutilisés** ici. La méthode est réimplémentée à partir de sa description.
- **INSEE** et les **instituts de sondage** cités dans `data/SOURCES.md`.

## Licence

Le code est sous [MIT](LICENSE). Les données de `data/` restent soumises à la licence de leur source (voir `data/SOURCES.md`).
