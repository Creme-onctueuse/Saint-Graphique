# Contribuer

## Installation
```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1   # Windows
```
Sous Linux ou macOS : installer `uv`, Node 22+ et `pnpm`, puis lancer `uv sync --all-extras` et `cd web && pnpm install`.

Pour vérifier l'ensemble : `scripts/check.ps1`, qui enchaîne ruff, pytest, la validation des schémas, eslint, vitest et le build.

### Cache des téléchargements
Les fichiers sources bruts (INSEE, sondages) sont mis en cache **hors du dépôt** :
- sous Windows : `%LOCALAPPDATA%\saint-graphique\cache` ;
- ailleurs : `$XDG_CACHE_HOME/saint-graphique`, ou à défaut `~/.cache/saint-graphique`.

On peut choisir un autre emplacement avec la variable d'environnement `SG_CACHE_DIR`.

### Windows : chemins longs et dossiers synchronisés
- Évitez de cloner le dépôt dans un dossier synchronisé (OneDrive, Dropbox…) : `web/node_modules` et `.venv` contiennent des dizaines de milliers de fichiers. Un chemin court, comme `C:\dev\saint-graphique`, est préférable.
- `web/.npmrc` limite la longueur des noms de dossiers pnpm (`virtual-store-dir-max-length`). Pour les autres outils, activez si possible les chemins longs de Windows, en administrateur : `New-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force`.

## Architecture
Les étapes communiquent **uniquement par des fichiers dont le format est fixé par un schéma**, dans `schemas/` :

```
pipeline/sources/*  ──►  data/pcs.json, data/elections/*.json   (données ouvertes, sourcées)
scripts/analyze/build_positions.py ──► data/positions_chris.json (positions lues, citées ; relevés locaux requis)
pipeline/methods/*  ──►  data/computed/<méthode>/<élection>.json (coordonnées)
web/                ──►  dist/index.html                         (application autonome)
```

## Ajouter une élection
1. Ajouter une ligne dans `config/elections.yaml`.
2. Ajouter la source dans `pipeline/sources/sondages.py`. Si la source est un PDF, transcrire le tableau dans `pipeline/sources/manual/<id>.csv`, avec l'URL en en-tête.
3. Lancer `uv run python scripts/build_data.py`, puis `uv run python -m pipeline.build`, puis `uv run python scripts/validate.py`.

## Ajouter une méthode de placement
1. Créer `pipeline/methods/ma_methode.py` avec une classe décorée par `@register`, qui implémente `compute()`.
2. Déclarer ses paramètres dans `config/methods.yaml`.
3. Facultatif : porter la méthode côté client dans `web/src/core/methods.ts` pour la rendre réglable en direct, avec un cas de parité dans les fixtures.

## Règles
- **Aucun chiffre sans source.** Toute donnée doit être référencée dans `data/SOURCES.md`.
- `research/` (vidéos, transcriptions, captures) est local et ne doit **jamais** être commité, pour des raisons de droit d'auteur.
- Le code est documenté en français, les messages de commit suivent la convention Conventional Commits.
