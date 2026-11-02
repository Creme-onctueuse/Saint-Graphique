# Changelog

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versionnage [SemVer](https://semver.org/lang/fr/).

## [Unreleased]

### Corrigé

- Chronologie : la vue stylisée sur fond noir apparaît dès le 12 janvier 2025. Ajout des limites du relevé, une fois la collecte terminée.
- Validation de `research/` : les axes sans libellé d'une diapositive sont admis, et les fichiers de travail préfixés par `_` ne relèvent plus du contrat.

## [1.0.0] - 2026-11-02

Première version complète : réplique du tableau de Chris de février 2026, à usage personnel et non commercial.

### Ajouté

- Méthode `read_positions`, méthode par défaut : les 41 catégories sont placées là où le tableau de Chris les affiche, d'après `data/positions_chris.json`, et les électorats sont des barycentres. Sur 19 candidats lus dans le tableau de 2025, l'écart est de 0,18 en X et 0,21 en Y, sous le seuil documenté de 0,25.
- `docs/methodologie.md` et `docs/chronologie-versions.md` : ce qui est énoncé, lu à l'écran, supposé et reconstruit, avec les écarts mesurés.
- Socle du projet : contrats JSON Schema, configuration déclarative, script d'installation, script de vérification, CI aux actions épinglées, Dependabot.
- Méthodes calculées : `ranks_jnthnbs` (reconstruction de JnthnBS), `continuous`, `mca` (exploratoire), incertitude par bootstrap. Une nouvelle méthode s'ajoute par une classe et une entrée de `config/methods.yaml`.
- Données ouvertes : 30 points PCS (nomenclature PCS 2020, niveau 2, plus les retraités) tirés de sources Insee, et 7 élections de 2017 à 2024 tirées de rapports Ifop, avec registre généré `data/SOURCES.md`.
- Application web autonome en un seul fichier HTML (Vite, TypeScript, D3) : choix de l'élection et de la méthode, zoom, infobulles, ellipses d'incertitude, poids modifiables, état dans l'URL, thèmes clair et sombre, export SVG et PNG, affichage à 400 px, réserves et sources sur la page.
- Test navigateur sans dépendance (`web/scripts/smoke.mjs`) et parité des calculs entre Python et TypeScript.
- Scripts de collecte (`scripts/collect/`) et d'analyse (`scripts/analyze/`) : index des vidéos, transcriptions, captures, regroupement des versions, numérisation et comparaison aux méthodes. Leurs résultats restent locaux dans `research/`.

### Modifié

- L'axe X s'appuie sur une table Insee publiée par PCS (2020-2021) au lieu de valeurs imputées. Seul le patrimoine des retraités, absent de cette table, reste calculé par le projet.

### Corrigé

- Dans les groupes denses, les libellés d'électorats évitent de se poser contre un disque qui n'est pas le leur, et leurs lignes de rappel évitent de traverser les disques. Avec 41 disques, le centre reste dense : un nom long peut mordre un disque voisin (jusqu'à 11,7 px) et une ligne de rappel en traverser un (jusqu'à 4 par élection).

### Limites connues

- La formule des axes de Chris reste inconnue : `read_positions` reprend ses positions sans les recalculer, et ne réplique pas la matrice v11 de septembre 2026, contre laquelle aucune méthode n'atteint le seuil.
- `ranks_jnthnbs` s'écarte du graphique de Chris : 3,75 en X et 4,04 en Y sur 24 PCS.
- Les données tirées de rapports Ifop sont réservées à un usage personnel et non commercial : le dépôt et sa page ne doivent pas être publiés en l'état (voir le README, « Publication »). Les positions lues ne sont ni sous licence libre, ni publiées.
