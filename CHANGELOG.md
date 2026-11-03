# Changelog

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versionnage [SemVer](https://semver.org/lang/fr/).

## [Unreleased]

### Ajouté

- Carte plein écran, sans défilement : échelles X et Y indépendantes, option « Proportions d'origine », navigation à la molette et au glisser, cadrage des électorats, mini-carte, légende toujours visible.
- Croisements : détail d'un électorat ou d'une catégorie, vue depuis un groupe, duel, axes libres sur les variables de l'Insee, carte de proximité par écart de composition.
- Présidentielles de 1995, 2002, 2007 et 2012 et européennes de 2014 (CSA, Ipsos, Ifop), avec une conversion du vote par groupe contrôlée sur les scores nationaux. Avant 2017, la page rappelle que les catégories gardent leurs positions de 2026.
- Frise : lecture de 1995 à 2024, filtre par type de scrutin, trajectoires des familles politiques (`config/families.yaml`), anneaux de vote par groupe, historique d'une famille.
- Projection 2027 à deux scénarios (`scripts/analyze/projection.py`), avec le résultat du test sur le passé : la tendance place moins bien les électorats que « rien ne bouge », avec un écart faible.
- « Le saviez-vous ? » : des constats calculés sur les données, soumis à des règles testées. Jeu « Qui est-ce ? ».
- Logo rouge et or et jeu d'icônes dessinés pour le projet.
- Méthodes `espace_social` (Bourdieu) et `acm_individus` (ACM sur les individus du recensement), mesurées face au seuil, qu'elles n'atteignent pas : voir `docs/methodologie.md`.
- Recherche d'un métier, d'une catégorie ou d'un électorat (touche `/`), et visite guidée en cinq étapes.
- Panneau Croiser : l'aire des bulles peut montrer le score, le poids d'un groupe, son vote ou la part d'un total.
- Balises de partage et image d'aperçu pour le site, avec l'adresse fixée au build.
- `saint-graphique.html` à la racine du dépôt : la page s'ouvre d'un double-clic après un clone, sans rien installer. La CI vérifie qu'elle correspond au build.

### Modifié

- Un électorat est une seule bulle, dont l'aire donne la part des inscrits, à la même échelle que les disques des catégories. Les halos des groupes disparaissent, et les ellipses de confiance deviennent une option.
- La lecture de la frise est continue, image par image : chaque famille glisse d'une élection à l'autre, sans pause ni fondu.
- La page passe de 815 à 570 Kio à données égales, car les valeurs répétées d'un fichier à l'autre ne sont embarquées qu'une fois. `data/computed/` reste complet.
- Les tableaux de données ne se construisent que dans leur panneau ouvert.
- `chart.ts`, `dataset.ts` et `inspector.ts` sont séparés par responsabilité.
- Le dépôt devient public : les chiffres de l'Ifop et les positions lues sur les vidéos de Chris sont publiés avec leurs sources, et retirés sur demande. Le déploiement sur GitHub Pages suit chaque poussée dès que la variable `PAGES_ENABLED` est définie.
- La réserve se résume en une ligne toujours visible et les sources tiennent sur une ligne en fin de page ; chacune s'ouvre sur son détail. Les catégories ne sont nommées que si elles sont grandes ou ont de la place, et le zoom fait apparaître les autres.

- La méthode des rangs s'appelle désormais `ranks` et s'affiche sous le libellé « Rangs reconstruits » : l'auteur de la reconstruction n'est plus cité que dans les crédits.

### Corrigé

- Les axes restent au bord de la carte, panneau ouvert, en zoomant et en se déplaçant : la carte est découpée à sa zone de tracé et ses axes glissent avec elle.
- Un clic vise le point le plus proche, puis la plus petite bulle : il ne tombe plus sur un électorat voisin qui recouvre le premier.
- Chronologie : la vue stylisée sur fond noir apparaît dès le 12 janvier 2025. Ajout des limites du relevé, une fois la collecte terminée.
- Validation de `research/` : les axes sans libellé d'une diapositive sont admis, et les fichiers de travail préfixés par `_` ne relèvent plus du contrat.

## [1.0.0] - 2026-11-02

Première version complète : réplique du tableau de Chris de février 2026, à usage personnel et non commercial.

### Ajouté

- Méthode `read_positions`, méthode par défaut : les 41 catégories sont placées là où le tableau de Chris les affiche, d'après `data/positions_chris.json`, et les électorats sont des barycentres. Sur 19 candidats lus dans le tableau de 2025, l'écart est de 0,18 en X et 0,21 en Y, sous le seuil documenté de 0,25.
- `docs/methodologie.md` et `docs/chronologie-versions.md` : ce qui est énoncé, lu à l'écran, supposé et reconstruit, avec les écarts mesurés.
- Socle du projet : contrats JSON Schema, configuration déclarative, script d'installation, script de vérification, CI aux actions épinglées, Dependabot.
- Méthodes calculées : `ranks` (reconstruction publiée par un tiers, voir les crédits), `continuous`, `mca` (exploratoire), incertitude par bootstrap. Une nouvelle méthode s'ajoute par une classe et une entrée de `config/methods.yaml`.
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
- `ranks` s'écarte du graphique de Chris : 3,75 en X et 4,04 en Y sur 24 PCS.
- Les données tirées de rapports Ifop sont réservées à un usage personnel et non commercial : le dépôt et sa page ne doivent pas être publiés en l'état (voir le README, « Publication »). Les positions lues ne sont ni sous licence libre, ni publiées.
