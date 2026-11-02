# Changelog

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versionnage [SemVer](https://semver.org/lang/fr/).

## [Unreleased]

### Ajouté

- Socle du projet : contrats JSON Schema, configuration déclarative, script d'installation, script de vérification, CI aux actions épinglées, Dependabot.
- Méthodes de placement : `ranks_chris_v1` (réplique, d'après la reconstruction de JnthnBS), `continuous`, `mca` (exploratoire), incertitude par bootstrap. Une nouvelle méthode s'ajoute par une classe et une entrée de `config/methods.yaml`.
- Données : 30 points PCS (nomenclature PCS 2020, niveau 2, plus les retraités) tirés de sources Insee, et 7 élections de 2017 à 2024 tirées de rapports Ifop, avec registre généré `data/SOURCES.md`.
- Application web autonome en un seul fichier HTML (Vite, TypeScript, D3) : choix de l'élection et de la méthode, zoom, infobulles, ellipses d'incertitude, poids modifiables, état dans l'URL, thèmes clair et sombre, export SVG et PNG, affichage à 400 px, réserves et sources sur la page.
- Test navigateur sans dépendance (`web/scripts/smoke.mjs`) et parité des calculs entre Python et TypeScript.
- Scripts de collecte (`scripts/collect/`) et d'analyse (`scripts/analyze/`) : index des vidéos, transcriptions, captures, regroupement des versions, numérisation et comparaison aux méthodes. Leurs résultats restent locaux dans `research/`.

### Modifié

- L'axe X s'appuie sur une table Insee publiée par PCS (2020-2021) au lieu de valeurs imputées. Seul le patrimoine des retraités, absent de cette table, reste calculé par le projet.

### Corrigé

- Dans les groupes denses, les libellés d'électorats ne se posent plus contre un disque qui n'est pas le leur, et leurs lignes de rappel évitent de traverser les disques. Deux noms longs effleurent encore un disque voisin (François Asselineau en 2017, Union populaire républicaine en 2019).

### Limites connues

- Chris définit l'axe X par la composition du patrimoine, que les sources consultées ne publient pas pour ces 30 PCS. `ranks_chris_v1` peut donc s'écarter de son graphique sur cet axe.
- Les données tirées de rapports Ifop sont réservées à un usage personnel et non commercial : le dépôt et sa page ne doivent pas être publiés en l'état (voir le README, « Publication »).
