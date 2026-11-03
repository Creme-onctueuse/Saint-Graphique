# Méthodologie du graphique : ce qui est établi, supposé, reconstruit

Ce document sépare ce que Chris et la PaduTeam disent, ce qui se lit à l'écran dans leurs vidéos, ce que nous supposons, et ce que d'autres ont reconstruit. L'algorithme de Chris n'est pas publié à ce jour : aucun résultat ci-dessous ne prétend le remplacer.

Les citations viennent de sous-titres automatiques, qui n'identifient pas les voix. Elles sont brèves et légèrement corrigées (« INC » devient « Insee », « -100 » devient « -10 »). Elles sont attribuées à Chris quand la personne se désigne ou répond à une question sur sa construction, sinon à « l'équipe ». Les captures et les transcriptions restent locales : ce dépôt ne les publie pas.

## 1. Principes énoncés

### Axe X : exploitation, rapport à la propriété

| Énoncé | Source | Attribution |
|---|---|---|
| « on a mis derrière les PCS leur niveau de capital » | [MJsGgEA_Slw 18:21](https://youtu.be/MJsGgEA_Slw?t=1101) | Chris |
| « une pondération entre les niveaux de salaire, les niveaux de patrimoine et les niveaux de détention des moyens de production » | [oquHE4YCMXA 02:59](https://youtu.be/oquHE4YCMXA?t=179) | Chris |
| « l'axe horizontal, la composition du patrimoine » | [GTN2rUgOdFo 03:12](https://youtu.be/GTN2rUgOdFo?t=192) | Chris |
| L'Insee « fait des statistiques sur la composition du patrimoine des PCS » | [GTN2rUgOdFo 04:09](https://youtu.be/GTN2rUgOdFo?t=249) | Chris |
| « on va considérer par exemple le statut social » (fonctionnaire, annoncé comme donnée à venir) | [GTN2rUgOdFo 05:11](https://youtu.be/GTN2rUgOdFo?t=311) | Chris |
| « en fonction du taux de propriété, du niveau de diplôme sur l'axe Y » | [nBPS8I4ioRs 05:21](https://youtu.be/nBPS8I4ioRs?t=321) | Équipe |

Les formulations varient donc : niveau de capital, pondération salaire, patrimoine et moyens de production, composition du patrimoine, taux de propriété. À 18:21, l'orateur dit « l'axe de la domination », mais décrit le capital et traite juste après du placement à gauche ou à droite : nous y lisons un lapsus pour l'axe X.

### Axe Y : domination, division du travail

| Énoncé | Source | Attribution |
|---|---|---|
| « il suffit de reprendre la nomenclature PCS » | [MJsGgEA_Slw 17:42](https://youtu.be/MJsGgEA_Slw?t=1062) | Chris |
| « pondéré aussi avec le niveau d'éducation » | [oquHE4YCMXA 03:44](https://youtu.be/oquHE4YCMXA?t=224) | Chris |
| « les études, ça fait partie de l'algo pour placer sur l'axe vertical » | [X0tXWZsjENQ 02:58](https://youtu.be/X0tXWZsjENQ?t=178) | Équipe |
| « leur hiérarchie dans la nomenclature PCS de l'Insee » | [GTN2rUgOdFo 06:05](https://youtu.be/GTN2rUgOdFo?t=365) | Chris |
| « plus vous allez être haut, plus vous avez de capital scolaire » | [GTN2rUgOdFo 24:32](https://youtu.be/GTN2rUgOdFo?t=1472) | Chris |

### Échelle, données, électorats, publication

| Énoncé | Source | Attribution |
|---|---|---|
| Unités produites par « l'algorithme », de -10 à +10 sur les deux axes | [GTN2rUgOdFo 03:28](https://youtu.be/GTN2rUgOdFo?t=208) | Chris |
| « une matrice ACM », « une note, un ranking » | [nBPS8I4ioRs 05:07](https://youtu.be/nBPS8I4ioRs?t=307) | Équipe |
| « les deux infos qui font le ranking » | [fOEEjSA7QZk 52:01](https://youtu.be/fOEEjSA7QZk?t=3121) | Équipe |
| PCS de niveau 2, faute de données plus fines : « de prendre des niveaux 2 » | [GTN2rUgOdFo 13:01](https://youtu.be/GTN2rUgOdFo?t=781) | Chris |
| « la taille des cercles est proportionnelle à la masse des PCS » | [MJsGgEA_Slw 15:01](https://youtu.be/MJsGgEA_Slw?t=901) | Chris |
| Barycentre : « on va prendre le poids de chacune des PCS » | [MJsGgEA_Slw 40:05](https://youtu.be/MJsGgEA_Slw?t=2405) | Chris |
| Retraités d'un sondage ventilés par la structure connue des anciens actifs | [CnBY7MaHo04 48:35](https://youtu.be/CnBY7MaHo04?t=2915) | Équipe |
| « on repondère avec beaucoup plus de sondages », Ipsos et Ifop moyennés en sortie des urnes | [ns7qtJdHAm4 44:33](https://youtu.be/ns7qtJdHAm4?t=2673) | Équipe |
| « c'est moi qui l'ai codé, il va être rendu public » | [GTN2rUgOdFo 04:48](https://youtu.be/GTN2rUgOdFo?t=288) | Chris |
| Accès annoncé à « quelles données de l'Insee », « quels calculs » | [ns7qtJdHAm4 42:05](https://youtu.be/ns7qtJdHAm4?t=2525) | Équipe |

Une recherche par mots-clés dans les transcriptions des 38 autres vidéos centrales n'a fait ressortir aucun nouvel énoncé sur la formule. Seules les occurrences ont été relues, pas ces vidéos en entier. La vidéo la plus riche en occurrences ([bSERpJcmCso](https://youtu.be/bSERpJcmCso?t=474)) rediffuse et commente la séquence de mars 2025 déjà citée.

## 2. Établi par lecture de l'écran

Ces faits viennent de valeurs affichées ou de mesures reproductibles sur des images, pas d'une déclaration.

**Tableau de 2025 à février 2026.**

- Le graphique affiche trois champs dans ses infobulles : `Somme de EXPLOITEUR`, `Somme de DOMINANT`, `Somme de POIDS` ([GTN2rUgOdFo 06:00](https://youtu.be/GTN2rUgOdFo?t=360)).
- Les 18 PCS lues en infobulle tombent toutes sur une grille de pas 0,5. Sur les 40 points de la première version, l'écart maximal à cette grille est de 0,05 : c'est l'erreur de lecture, sans point hors grille.
- Les coordonnées ont beaucoup d'ex æquo : 19 valeurs de X et 24 de Y pour 40 points, et jusqu'à 6 points au même X. Un classement strict ne produit pas cela.
- Les postes affichés suivent la liste en 42 postes de la PCS 2003 : agriculteurs par taille d'exploitation, retraités par ancienne catégorie, inactifs. 41 sont lisibles, dont Clergé, absent de la première diapositive. Elle est plus fine que nos 30 codes.
- Les retraités occupent six positions, de Y = +5 à Y = -8,5, et non une seule.
- La diapositive du 7 janvier 2025, le tableau du 27 mars 2025 et celui du 14 février 2026 portent les mêmes valeurs. Sur les seules mesures indépendantes (infobulle ou disque détecté), l'écart maximal est de 0,05 sur 20 points entre janvier et mars 2025, de 0,04 sur 17 points entre mars 2025 et février 2026, de 0,07 sur 15 points entre janvier 2025 et février 2026. La diapositive n'ayant pas de graduation, son échelle vient des infobulles : l'accord porte sur la forme, et le calibrage laisse 0,02 de résidu.
- Le 28 février 2026, deux points ont bougé : Employés administratifs d'entreprise et Employés de commerce.

**Matrice v11, 16 septembre 2026.**

- Le titre des axes est « rapport à la propriété (capital) » pour X et « position dans la division du travail » pour Y, sur [-10 ; +10].
- Sept lignes agrégées remplacent le détail : « coordonnées canoniques de la matrice v11 (agrégation pondérée) » ([gw8ni0WM5Zw 18:10](https://youtu.be/gw8ni0WM5Zw?t=1090)).
- **Y est un barycentre linéaire.** Avec les positions lues et nos compositions, 21 candidats de 2017 et 2022 sont reproduits avec un RMSE de 0,009 et un écart maximal de 0,018.
- **X n'est pas un barycentre linéaire.** Le panneau affiche à part une « moyenne linéaire des positions » ([gw8ni0WM5Zw 19:28](https://youtu.be/gw8ni0WM5Zw?t=1168)), et le barycentre affiché la dépasse de +0,38 à +1,26 (moyenne +0,77). Même en laissant les six positions libres, un ajustement linéaire laisse un résidu de 0,33.
- Le panneau affiche un « vecteur patrimonial moyen » à quatre composantes (rés, fin, immo, pro), marqué comme estimé, un « centre d'influence », des dispersions et une distance. Cette distance est bien l'écart euclidien entre barycentre et centre d'influence (à 0,01 près sur 8 panneaux).

Nos compositions de 2017 et 2022 coïncident avec celles affichées dans ces panneaux : le contrôle ci-dessus porte donc sur les positions, pas sur les données d'électorat.

## 3. Supposé ou non établi

- **La formule des coordonnées de PCS.** Seules ses sorties sont visibles. La grille de 0,5 et les ex æquo évoquent des classes ou une saisie arrondie, sans le prouver.
- **Le « ranking ».** Le mot est employé par l'équipe, mais un rang strict contredit les ex æquo observés. Un rang sur des classes reste possible.
- **L'« ACM ».** Le terme est cité une fois dans nos relevés. Aucune sortie vue ne permet de l'attester : les deux axes gardent un sens fixé d'avance, alors qu'une ACM produit ses axes à partir des données.
- **La fonction qui donne X en 2026.** Deux électorats aux vecteurs proches ont des X écartés de 0,7 selon l'onglet : le vecteur seul ne suffit pas à l'expliquer.
- **Le sens de « rés ».** L'abréviation n'est pas développée à l'écran. La colonne « ratio » n'a pas non plus été élucidée.
- **La nomenclature.** Les énoncés divergent : PCS 2020 ([MJsGgEA_Slw 17:55](https://youtu.be/MJsGgEA_Slw?t=1075)) et « classification de 2003 » ([81kznHfk78k 12:04](https://youtu.be/81kznHfk78k?t=724)). Les libellés lus sont ceux de 2003, mais l'outil d'avril 2026 s'intitule « matrice PCS 2020 ».
- **Le logiciel.** L'interface (« Retour au rapport », champs « Somme de », filtres « PCS LEVEL 2 » et « Année ») évoque Power BI. Aucune source ne le dit.
- **La date des fichiers montrés.** Une vidéo peut montrer un fichier plus ancien : une date de version est une borne, pas une date de création.

## 4. Reconstruction tierce

Le dépôt [JnthnBS/saint-graphique](https://github.com/JnthnBS/saint-graphique), sans lien avec la PaduTeam, propose une reconstruction déclarée comme telle : X par le rang du ratio patrimoine / niveau de vie, Y par le rang d'un score de diplômes, un score fixe pour les retraités, et un barycentre des groupes de niveau 1. Notre méthode `ranks` suit cette description.

Ce ratio ne figure dans aucun énoncé relevé de Chris. Un accord avec cette reconstruction n'est donc pas une preuve indépendante : elle a été conçue pour ressembler au graphique, et l'accord de `ranks` avec les candidats lui doit une partie de sa qualité.

Des commentateurs proposent d'autres lectures, non vérifiées ici. Ventre Presse lit X comme la part des revenus du capital ([71NMMwmEfsg 08:05](https://youtu.be/71NMMwmEfsg?t=485)), puis rapporte une discussion avec Chris : « ça raisonne plus en termes de patrimoine que de revenus » ([z-phWkqNqyg 14:31](https://youtu.be/z-phWkqNqyg?t=871)).

## 5. Écarts mesurés

Reproduction : `scripts/analyze/compare.py`, `check_barycenter.py`, `x_variants.py`, `threshold_report.py`, `methods_report.py` et `overlay.py`. Les chiffres dépendent de `data/pcs.json` à la date du calcul.

### Seuil et verdict

**Seuil retenu : RMSE sous 0,25 sur chaque axe**, soit un demi-pas de la grille de Chris. Sous cette valeur, un point calculé tombe en moyenne dans la bonne case. Ce seuil a été fixé après les mesures, et non avant : il décrit une précision utile, il ne constitue pas un test en aveugle.

| Méthode | Candidats du tableau (19) | Avec janvier 2025 pour 2022 (27) | Matrice v11 (21) | Catégories lues |
|---|---|---|---|---|
| `read_positions` | 0,18 / 0,21 : **atteint** | 0,44 / 0,28 : non atteint | 2,74 / 2,15 : non atteint | sans valeur de preuve (voir ci-dessous) |
| `ranks` | 0,22 / 1,01 : non atteint | 0,43 / 1,02 : non atteint | 2,53 / 2,39 : non atteint | 3,75 / 4,04 : non atteint |
| `continuous` | 5,18 / 0,80 : non atteint | 5,26 / 0,92 : non atteint | 7,48 / 2,86 : non atteint | 4,80 / 3,24 : non atteint |
| `mca` | 3,15 / 1,86 : non atteint | 3,32 / 1,80 : non atteint | 5,49 / 2,61 : non atteint | 5,74 / 10,21 : non atteint |
| `espace_social` | 1,13 / 0,79 : non atteint | 1,15 / 0,73 : non atteint | 3,40 / 1,65 : non atteint | 5,27 / 2,50 : non atteint |
| `acm_individus` | 1,81 / 3,23 : non atteint | 1,94 / 3,34 : non atteint | 4,07 / 5,47 : non atteint | 3,52 / 6,21 : non atteint |

Chaque case donne le RMSE en X puis en Y. Lecture :

- **Seuls les candidats mettent `read_positions` à l'épreuve.** Ses catégories coïncident avec les lectures par construction (0,01 et 0,02 sur 32 points) : cet accord ne prouve rien.
- **Le seuil est atteint contre le tableau de 2025 à février 2026,** la dernière version détaillée par PCS, et par `read_positions` seule.
- **Il n'est pas atteint contre la matrice v11,** la dernière version montrée, ni par aucune méthode. La v1 réplique donc le tableau, pas la matrice.
- **`espace_social` et `acm_individus` ne cherchent pas à l'atteindre.** Leurs axes ont un autre sens que ceux de Chris : ces écarts mesurent une distance entre deux lectures, pas une erreur (section 8).

**Calque.** `overlay.py` dessine les postes sur la capture plein écran du 14 février 2026 ([iXImwyHjrwM 10:56](https://youtu.be/iXImwyHjrwM?t=656)). Vérifié à l'œil, 39 cercles sur 41 recouvrent leur disque en position et en taille. Les deux autres sont les catégories déplacées le 28 février 2026, postérieures à cette capture. Ce contrôle confirme la lecture et les poids, sans mesure chiffrée.

### Positions lues contre candidats lus

La méthode `read_positions` place les catégories aux positions lues, puis calcule les électorats. Les candidats lus n'entrent pas dans ce calcul : ils forment donc un contrôle.

| Version lue | Candidats | Points | RMSE X | RMSE Y | Spearman X | Spearman Y |
|---|---|---|---|---|---|---|
| Tableau du 27 mars 2025 | 2022 | 7 | 0,16 | 0,20 | 1,00 | 1,00 |
| Tableau du 27 mars 2025 | Législatives 2024 | 3 | 0,22 | 0,18 | 0,87 | 1,00 |
| Tableau du 26 janvier 2025 | 2017 | 5 | 0,21 | 0,23 | 1,00 | 0,98 |
| Tableau du 26 janvier 2025 | Européennes 2024 | 4 | 0,15 | 0,24 | 1,00 | 1,00 |
| Tableau du 26 janvier 2025 | 2022 | 8 | 0,75 | 0,39 | 0,71 | 0,43 |
| Matrice v11 | 2022 | 12 | 2,60 | 2,23 | 0,86 | 0,95 |
| Matrice v11 | 2017 | 9 | 2,91 | 2,03 | 0,93 | 0,93 |

Sans la ligne de janvier 2025 pour 2022, les 19 candidats du tableau donnent 0,18 en X et 0,21 en Y. Cette ligne fait exception car Chris a déplacé ces candidats entre janvier et mars 2025, alors que ses catégories n'ont pas bougé : nous retrouvons sa version de mars. Nos compositions venant de sondages Ifop, cet accord suppose que Chris utilise les mêmes, ce que les panneaux de la matrice v11 confirment pour 2017 et 2022.

### Nos méthodes contre les positions lues

| Version lue | Méthode | Points | RMSE X | RMSE Y | Spearman X | Spearman Y |
|---|---|---|---|---|---|---|
| Tableau du 28 février 2026, PCS | `ranks` | 24 | 3,75 | 4,04 | 0,84 | 0,83 |
| | `continuous` | 24 | 4,80 | 3,24 | 0,84 | 0,83 |
| | `mca` | 24 | 5,74 | 10,21 | 0,74 | -0,31 |
| Tableau du 27 mars 2025, candidats 2022 | `ranks` | 7 | 0,16 | 0,91 | 0,96 | 0,29 |
| | `continuous` | 7 | 5,19 | 0,78 | 0,93 | 0,89 |
| Tableau du 26 janvier 2025, candidats 2017 | `ranks` | 5 | 0,26 | 1,23 | 1,00 | 0,67 |
| Matrice v11, 7 lignes agrégées | `ranks` | 5 | 2,73 | 2,03 | 1,00 | 1,00 |
| Matrice v11, candidats 2022 | `ranks` | 12 | 2,49 | 2,57 | 0,93 | 0,03 |
| | `continuous` | 12 | 7,51 | 3,03 | 0,91 | 0,38 |
| Matrice v11, candidats 2017 | `ranks` | 9 | 2,58 | 2,14 | 0,93 | 0,13 |

Les plus grands écarts de PCS, avec `ranks` : Employés administratifs d'entreprise, Clergé, professions de santé et du travail social, Professeurs et professions scientifiques.

Le plus grand écart sur les électorats vient des retraités. Nous les plaçons en un seul point à Y = -10, là où la matrice v11 affiche Y = -0,69. Comme ils pèsent lourd, cela explique que l'ordre des candidats en Y soit presque perdu (Spearman 0,03 et 0,13) alors que les 5 groupes d'actifs sont bien ordonnés.

### Définitions possibles de X

Chaque variable de `data/pcs.json` est classée, ramenée sur [-10 ; +10], puis agrégée en groupes et en barycentres. La variante du ratio reproduit exactement `ranks`, ce qui valide le calcul.

| Variable | Valeurs distinctes | PCS, février 2026 (24) RMSE / Spearman | Candidats, tableau 2025 (27) RMSE / Spearman | Candidats, matrice v11 (21) RMSE / Spearman |
|---|---|---|---|---|
| Ratio patrimoine / niveau de vie | 30 | 3,75 / 0,84 | 0,43 / 0,84 | 2,53 / 0,93 |
| Patrimoine médian | 30 | 3,80 / 0,81 | 1,01 / 0,66 | 3,17 / 0,81 |
| Niveau de vie | 30 | 5,27 / 0,62 | 0,98 / 0,57 | 2,87 / 0,57 |
| Part des valeurs mobilières | 8 | 3,56 / 0,82 | 3,44 / 0,90 | 1,49 / 0,90 |
| Part du patrimoine financier | 8 | 6,72 / 0,24 | 4,05 / 0,91 | 1,70 / 0,89 |
| Part du patrimoine professionnel | 8 | 7,22 / 0,22 | 2,56 / -0,70 | 4,15 / -0,71 |
| Part du capital d'entreprise | 8 | 7,05 / 0,22 | 3,69 / -0,68 | 5,23 / -0,78 |
| Part de l'immobilier | 8 | 7,85 / -0,01 | 2,25 / -0,36 | 3,97 / -0,50 |

Ces chiffres ne tranchent pas entre ratio et composition, pour trois raisons.

1. **Composition connue par groupe seulement.** `patrimoine_composition` figure dans `data/pcs.json`, mais 27 lignes sur 30 sont imputées depuis leur groupe. Le test au niveau PCS ne compare alors que quelques classes.
2. **Ordre entre groupes commun aux variables.** Le fort Spearman global vient surtout de l'écart entre groupes. Dans un groupe, le ratio prédit mal l'ordre chez les cadres (de -0,10 à 0,26, 5 ou 6 PCS), les professions intermédiaires (de -0,12 à 0,35, 6 ou 7) et les employés (0,20, 5), mieux chez les ouvriers (de 0,63 à 0,87, 5).
3. **Pas d'accord direct.** Aucune variable ne reproduit la grille de 0,5, et la part du capital d'entreprise, proche de la formule de Chris, s'oppose ici à l'ordre des candidats. Le vecteur qu'affiche la matrice v11 semble d'ailleurs différer du découpage publié par l'Insee. Cette impression vient d'un ajustement mal conditionné et reste à confirmer.

## 6. Choix de la v1

La formule des coordonnées reste inconnue : la v1 ne la devine pas. `read_positions` reprend les positions lues et sert de réplique. `ranks` reste la méthode calculée sur données ouvertes.

- **Positions.** 41 postes, lus sur quatre versions du tableau, de janvier 2025 à février 2026, puis ramenés sur la grille de 0,5. Une lecture qui change de case ouvre une révision et seule la dernière compte : cela garde le déplacement des deux catégories d'employés. `scripts/analyze/build_positions.py` écrit `data/positions_chris.json`.
- **Poids.** 18 sont lus en infobulle, 16 viennent du recensement 2022 multiplié par le rapport médian avec les infobulles (0,79), 7 de l'aire du disque calibrée sur les infobulles. Leur somme atteint 99,2 sans contrainte imposée, ce qui les conforte sans les prouver.
- **Électorats.** Barycentre des groupes de niveau 1. La plupart des sondages n'isolent pas les agriculteurs : la clé 2 réunit donc agriculteurs et indépendants, comme la ligne « Agriculteurs et prof. indépendantes » de la matrice v11. Ceux de 1995 et 2002 les publient à part : ce regroupement ne s'y applique pas. L'effet mesuré est faible : de 0,28 à 0,25 en Y sur mars 2025.
- **Règle de poids.** Elle a été retenue pour sa cohérence, pas pour son score. Une variante fondée sur les seuls disques donnait un écart un peu plus faible (0,12 et 0,21 sur mars 2025), mais attribuait un rayon médian à 20 postes, dont certains très petits.
- **Axe X.** Aucun choix n'est fait entre ratio et composition, car les données testées ne tranchent pas (section 5).
- **Matrice v11.** Elle n'est pas répliquée : ses positions et son calcul de X diffèrent, et seules 7 lignes en sont lisibles.

Limites des lectures : certaines attributions reposent sur des libellés déplacés et sur la couleur, surtout Employés de commerce (confiance 0,75) et les ouvriers non qualifiés (0,65 à 0,7). Neuf postes n'ont pas pu être relus dans la version du 28 février 2026 : ils gardent leur position de la version précédente.

### Pistes pour une méthode calculée

- **Retraités.** Une position unique très basse est incompatible avec les versions lues. Les distinguer par ancienne catégorie retire le plus gros écart en Y de `ranks`.
- **Grain.** Une méthode en 30 codes ne peut pas représenter les 41 postes, en particulier les trois tailles d'exploitation agricole et les six catégories de retraités.
- **Barycentre.** Pour Y, le barycentre linéaire suffit, y compris dans la matrice v11. Pour X, il reproduit le tableau de 2025 mais pas la matrice v11.
- **Cible.** Le tableau de 2025 à février 2026 reste la seule source détaillée par PCS.

## 7. Frise et projection 2027

**Ce qui bouge.** Toutes les méthodes placent les catégories une seule fois : leurs positions et le barycentre de la population sont identiques aux 12 élections. Seuls les électorats se déplacent, et uniquement parce que leur composition change d'un sondage à l'autre. Sur la méthode `read_positions`, un électorat se déplace d'environ 0,47 unité d'une élection à l'autre depuis 2017 (médiane), soit à peu près la taille des ellipses de confiance, et de 0,86 unité avant 2017, où l'institut change presque à chaque étape : une partie de cet écart peut venir de la source. Sur les 12 élections, la médiane est de 0,62.

**Familles et blocs.** `config/families.yaml` relie les électorats entre élections. Ce classement est un choix de ce projet : une famille réunit des candidats et des listes qui ne se confondent pas, et suit une lignée malgré les changements de nom (RPR, UMP, Les Républicains ; FN, RN ; UDF, MoDem). Les coalitions Front de gauche (2014), NUPES et NFP ne sont attribuées à aucun parti : elles laissent un trou dans les trajectoires et comptent dans le bloc de gauche.

**Élections avant 2017.** Cinq scrutins s'ajoutent aux rapports Ifop de 2017 à 2024. Les catégories y gardent leurs positions de 2026 : un électorat ancien est placé sur la carte sociale d'aujourd'hui, ce que la page rappelle à ces étapes.

| Scrutin | Source | Échantillon | Tableau | Abstention | Poids |
|---|---|---|---|---|---|
| Présidentielle 1995 | [CSA, sortie des urnes](https://www.ipsos.com/fr-fr/sondage-sortie-des-urnes-0) | 3 765 votants | Vote de chaque groupe, questions 8 et 9 | [Taux officiel](https://www.conseil-constitutionnel.fr/decision/1995/9579pdr.htm) | Recensement 1999 |
| Présidentielle 2002 | [Ipsos, jour du vote](https://www.ipsos.com/fr-fr/1er-tour-presidentielle-2002comprendre-le-vote-des-francais-qui-vote-quoi-les-motivations-de-vote) | 4 044 inscrits | Vote de chaque groupe | Sondage, par groupe | Recensement 1999 |
| Présidentielle 2007 | [CSA-Cisco, sortie des urnes](https://www.cisco.com/web/FR/csa/sondage_sortie_urnes.pdf) | 5 009 votants | Composition publiée, p. 6 | [Taux officiel](https://www.conseil-constitutionnel.fr/decision/2007/2007139PDR.htm) | Aucun |
| Présidentielle 2012 | [Ifop-Fiducial, jour du vote](https://www.ifop.com/wp-content/uploads/2018/03/1848-1-study_file.pdf) | 3 509 inscrits | Vote de chaque groupe, p. 9 et 10 | [Taux officiel](https://www.conseil-constitutionnel.fr/decision/2012/2012152PDR.htm) | Recensement 2011 |
| Européennes 2014 | [Ifop-Fiducial, jour du vote](https://www.ifop.com/wp-content/uploads/2018/03/2670-1-study_file.pdf) | 3 373 inscrits | Vote de chaque groupe, p. 24 et 25 | Sondage, par groupe | Recensement 2016 |

- **Conversion.** Quand le sondage publie le vote de chaque groupe, la composition vient de la règle de Bayes, avec les Français de 18 ans ou plus par groupe, au recensement le plus proche (données harmonisées de l'Insee, 1968-2022). Ce calcul retrouve les effectifs de 2022 tirés par ailleurs du fichier détail. Si le sondage publie l'abstention par groupe, le poids tient compte de la participation.
- **Contrôle sur les scores nationaux.** Le vote des groupes, pondéré par ces effectifs, redonne le score national à 0,48 point près en moyenne en 1995 (écart maximal 1,56), 0,31 en 2002 (0,92), 0,32 en 2012 (1,06) et 0,14 en 2014 (0,53). Un test impose au plus 0,6 point en moyenne et 1,75 au maximum.
- **Contrôle sur une composition publiée.** CSA publie les deux tableaux en 2007. La composition convertie s'écarte de la composition publiée de 0,8 point en moyenne pour les six candidats à 2 % ou plus (écart maximal 4,0), et de moins d'un point pour Royal, Bayrou et Sarkozy. Les petits électorats s'en écartent bien plus : chez G. Schivardi, jusqu'à 28 points.
- **Ce que ces tableaux ne disent pas.** En 1995, retraités et inactifs forment une seule ligne, rattachée ici aux retraités, comme si les autres inactifs votaient comme eux. Sans abstention par groupe (1995, 2007, 2012), les parts se lisent parmi les votants, et l'abstention garde son taux officiel, sans point sur la carte. Sous 1 % du score, un candidat de ces tableaux garde son score mais n'a pas de composition : en entiers, ses parts ne sont que des arrondis. La fiche technique de 2002 ne nomme pas l'institut : la page est publiée par Ipsos.
- **Changement de source.** Une trajectoire est en pointillés là où l'institut change entre deux étapes : l'écart peut venir de la source.

**Scrutins écartés.** Aucun tableau complet du vote par profession au premier tour n'a été trouvé pour ces scrutins :

- **1988.** Le sondage de sortie des urnes archivé par [Ipsos](https://www.ipsos.com/fr-fr/sondage-sortie-des-urnes-88-qui-vote-quoi-et-pourquoi) ne donne que les ouvriers, les commerçants et les fonctionnaires. [Pouvoirs n° 47](https://revue-pouvoirs.fr/wp-content/uploads/pdfs_articles/Pouvoirs47_p157-181_victoires_socialistes.pdf) cite le sondage postélectoral de la Sofres, sans tableau complet du premier tour. Le [Cahier du Cevipof n° 1](https://www.sciencespo.fr/cevipof/sites/sciencespo.fr.cevipof/files/Cahier01.pdf) donne des intentions de vote de 1987.
- **1981 et 1974.** Les tableaux trouvés, de la Sofres ([Cahier du Cevipof n° 1](https://www.sciencespo.fr/cevipof/sites/sciencespo.fr.cevipof/files/Cahier01.pdf), [Pouvoirs n° 20](https://revue-pouvoirs.fr/wp-content/uploads/pdfs_articles/POUVOIRS_20-1982_81%20La_gauche_au%20pouvoir.pdf)), portent sur le second tour.
- **1969.** Aucun tableau trouvé dans les sources consultées.
- **1965.** Un tableau complet existe dans la [rétrospective de l'Ifop](https://www.ifop.com/wp-content/uploads/2018/03/439-1-document_file.pdf), tableau 3, mais il n'a pas été retenu : ce sont des intentions de vote des 1er et 2 décembre, avant le scrutin, selon la profession du chef de ménage et non de la personne interrogée, avec les cadres moyens et les employés sur une seule ligne, et les retraités avec les personnes sans profession. Il reste 30 ans sans autre point entre ce tableau et le suivant.
- **Législatives de 2012.** La [page d'Ipsos](https://www.ipsos.com/fr-fr/legislatives-2012-sociologie-et-motivations-de-lelectorat-au-1er-tour-des-elections) ne donne que quelques chiffres dans son texte. Le [rapport Ifop trouvé](https://www.ifop.com/wp-content/uploads/2018/03/1900-1-study_file.pdf) porte sur des intentions de vote du 31 mai et du 1er juin 2012, avant le scrutin.

**Estimation par les communes, essayée et écartée.** Pour les années sans sondage, une régression du score de chaque candidat sur la part de chaque groupe dans chaque commune aurait pu servir, avec les [données de Cagé et Piketty](https://www.unehistoireduconflitpolitique.fr/download.html). La règle fixée d'avance était une erreur de position moyenne sous 0,45 unité par rapport aux sondages, sur les années qui ont les deux. Mesurée sur les six présidentielles de 1995 à 2022 (`scripts/analyze/communes_vs_sondages.py`), elle atteint 1,95 unité avec des moindres carrés non négatifs et 1,66 unité en raisonnant à l'intérieur de chaque département. Aucune étape estimée n'entre donc dans les données, et le test sur le passé ne repose que sur des sondages.

**Le vote de chaque groupe.** Les sondages donnent la composition de chaque électorat. Multipliée par le score rapporté aux inscrits, elle donne le vote de chaque groupe, affiché par les anneaux de la frise. Ces tableaux ne détaillent que six groupes : les agriculteurs y sont réunis avec les artisans et commerçants, et les autres inactifs n'y figurent pas. Les tableaux de 1995 et 2002 en détaillent sept, avec les agriculteurs.

**Deux scénarios.** Pour la présidentielle de 2027, `scripts/analyze/projection.py` compare « rien ne bouge », le dernier point connu, et « la tendance continue », ce point prolongé par la pente des moindres carrés. Le fichier `data/computed/_projection/<méthode>.json` se régénère après `pipeline.build`.

**Test sur le passé.** Chaque point ayant au moins 3 points antérieurs est prédit depuis ceux-ci, sur `read_positions`. Seuls des scrutins connus par un sondage y entrent :

| Erreur moyenne | Rien ne bouge | Quart de tendance | Demi-tendance | Tendance entière |
|---|---|---|---|---|
| Partis, position (38 prédictions) | **0,74** | 0,75 | 0,76 | 0,78 |
| Partis, score en points | **6,0** | 6,1 | 6,2 | 6,5 (pire erreur : 16,6) |
| Blocs, position (35 prédictions) | **0,56** | 0,56 | 0,57 | 0,57 |
| Blocs, score en points | 5,9 | 5,9 | 5,9 | **5,8** |

Lecture :

- **Le mouvement passé ne prédit pas mieux le mouvement suivant, mais l'écart s'est réduit.** Sur la position, la tendance entière fait un peu moins bien que « rien ne bouge », pour les partis (0,78 contre 0,74) comme pour les blocs (0,57 contre 0,56). Sur le score, elle fait moins bien pour les partis (6,5 contre 6,0) et un peu mieux pour les blocs (5,8 contre 5,9). Le verdict de la page change donc : il ne dit plus que la tendance prédit moins bien sur les deux mesures, mais qu'elle place moins bien les électorats. Ces écarts restent faibles.
- **Pourquoi ces chiffres ont changé.** De 2017 à 2024 seuls, sur 17 et 16 prédictions, la tendance entière faisait nettement pire sur les quatre lignes (partis : 0,81 contre 0,62, et 8,4 contre 6,2 points). Avec une histoire plus longue, la pente varie moins d'un scrutin à l'autre et la tendance se rapproche de « rien ne bouge » : sur les seules cibles depuis 2017, 0,73 contre 0,69 pour les partis, 0,49 des deux côtés pour les blocs.
- **Les étapes anciennes pèsent sur l'erreur.** Sur les cibles d'avant 2017, « rien ne bouge » se trompe de 0,93 unité pour les partis et 0,84 pour les blocs, contre 0,69 et 0,49 depuis 2017. L'institut y change presque à chaque étape : ce test ne permet pas de séparer ce qui vient de la source de ce qui vient de l'électorat.
- **Les types d'élection pèsent lourd.** Le score d'une famille varie plus d'un type d'élection à l'autre que dans le temps : la France insoumise fait 22 % à la présidentielle de 2022 et 10 % aux européennes de 2024. Le dernier point d'une famille peut donc être une élection d'un autre type que celle que l'on projette.
- **Ce test ne mesure pas 2027.** Il dit ce que ces deux scénarios ont valu de 1995 à 2024. Les données s'arrêtent en juillet 2024 : rien de ce qui s'est passé depuis n'y figure.

**Affichage.** La carte montre une position pour chaque parti, sans score ; les scores ne sont donnés qu'en fourchette, pour cinq blocs. Le cercle en pointillés a pour rayon l'erreur moyenne du test de ce parti dans le scénario affiché, sur peu de prédictions : 3 à 9 selon le parti. La fourchette d'un bloc est son score projeté, plus ou moins son erreur moyenne dans le même scénario. L'abstention est projetée sur le même principe, mais hors du tableau, car elle dépend surtout du type d'élection. La page affiche toujours le résultat du test à côté de la projection, qui n'est pas une prévision du résultat.

## 8. Deux méthodes tirées des sciences sociales

`espace_social` et `acm_individus` ne reconstruisent pas le graphique de Chris. Elles posent une autre question : quelle carte obtient-on en partant d'un cadre publié, et non de ses positions ? Leurs choix, formule, échelle de diplômes, variables et recodages, ont été fixés avant le premier calcul de `threshold_report.py`. Seuls des libellés ont changé ensuite. Reproduction : `scripts/analyze/methods_report.py`.

### `espace_social` : volume et structure du capital

D'après Bourdieu (*La Distinction*, Minuit, 1979). En hauteur le volume du capital, en largeur sa structure, du culturel à gauche à l'économique à droite. Tout vient de `data/pcs.json` :

- capital économique : `E = z(z(ln patrimoine) + z(ln niveau de vie))` ;
- capital culturel : `C = z(5·bac+5 + 3,5·bac+3/4 + 2·bac+2 + 0·bac − CAP − 3·brevet − 4·certificat ou aucun)`, soit la durée théorique des études en années par rapport au bac. Cette échelle est fixée a priori, ce n'est pas celle de `ranks` ;
- `z` centre et réduit avec les poids de population, pour que E et C aient la même dispersion ;
- `x = minmax(z(E − C))` et `y = minmax(z(E + C))` sur [-10 ; +10], comme `continuous`.

**Logarithme.** Le patrimoine médian va de 32 à 1 532 k€ : en euros, une seule catégorie, celle des chefs d'entreprise, tirerait toute l'échelle. Le logarithme réduit l'asymétrie pondérée, de 2,69 à -0,71 pour le patrimoine et de 1,07 à 0,67 pour le niveau de vie, sans l'annuler.

**Réglage.** Dans le navigateur, les curseurs du panneau Méthode règlent les poids de diplômes, donc le capital culturel. Le capital économique n'a pas de réglage, et l'option de score imposé aux retraités est retirée. La fixture de parité vérifie le portage TypeScript.

**Retraités.** Leurs propres valeurs sont conservées, sans score imposé ni correction, mais restent hors de la moyenne et de l'écart-type de référence, calculés sur les 29 PCS actives. Un point unique qui pèse 33 % de la population fixerait sinon le zéro et la dispersion du capital culturel : le déplacement moyen des PCS actives serait de 1,03 unité, 1,92 au plus.

Le biais reste donc visible sur leur point, et il est fort. Leurs diplômes reflètent leur génération : 34,5 % n'ont qu'un certificat ou aucun diplôme, contre 9,6 % dans les PCS actives, et 5,6 % ont un bac+5, contre 16,8 %. Leur point se trouve à (+3,18 ; -5,28). Avec les diplômes moyens des PCS actives, ce point serait à (-4,39 ; -1,70). Ce calcul donne un ordre de grandeur, pas une correction : il faudrait pour cela les diplômes à âge égal, par ancienne catégorie. Leur position à droite ne dit donc pas que leur capital est surtout économique, et cette position entraîne les électorats âgés.

**Ce que le résultat veut dire.**

- **La carte se lit comme attendu en haut.** Professeurs et professions de l'information et des arts à gauche, chefs d'entreprise et agriculteurs à droite, professions libérales au sommet. Cet ordre vient des données, sans ajustement.
- **Le volume écrase la structure.** E et C sont corrélés à 0,87 sur les PCS actives : le volume porte 93,5 % de la variance, la structure 6,5 %. La mise à l'échelle donne pourtant la même étendue aux deux axes : la largeur de la carte grossit donc un écart bien plus faible que sa hauteur.
- **La structure ne vaut pas en bas de la carte.** Employés de commerce et services aux particuliers sont à gauche parce que leur patrimoine est très faible (57 et 63 k€), pas parce que leur capital culturel est élevé.
- **Une petite PCS fixe la borne gauche.** Le clergé, dont les valeurs sont fragiles (voir `data/SOURCES.md`), est à -10.
- **Ces mesures sont pauvres.** Pas de capital culturel incorporé, pas de capital social : seulement des titres scolaires et deux médianes.

**Contre les positions lues.** Le seuil n'est atteint nulle part. En Y, l'ordre des catégories est bien retrouvé (Spearman 0,90 sur 24 points), comme celui des candidats de mars 2025 (1,00 sur 7) et de la matrice v11 pour 2022 (0,81 sur 12), ce que `ranks` ne fait pas (0,29, et presque zéro sur la matrice). C'est un résultat, pas une validation : tout indicateur de hiérarchie sociale classe ainsi les catégories, le diplôme entre dans les deux calculs, et les retraités n'y sont pas forcés à -10. En X, l'ordre des catégories n'est pas le même (Spearman 0,42, RMSE 5,27) : la structure du capital n'est pas l'exploitation. Le RMSE de 1,13 sur les candidats ne dit rien de plus : les électorats sont resserrés (écart-type de 0,8 en 2022).

### `acm_individus` : une ACM sur les individus du recensement

Analyse géométrique des données (Le Roux et Rouanet, *Multiple Correspondence Analysis*, SAGE, 2010) : les axes viennent des individus, et les PCS sont projetées ensuite. Le fichier détail du recensement 2022 (17,5 millions de lignes) est lu par morceaux et réduit à un tableau croisé de 116 Ko, sans microdonnées : `data/acm_individus.json`, avec sa source et sa licence.

**Le recensement ne donne ni revenu ni patrimoine.** Le capital économique n'y est approché que par la propriété du logement et le statut d'emploi, le capital culturel que par le diplôme. Le statut d'occupation est celui du ménage : un jeune adulte chez ses parents propriétaires compte comme propriétaire.

**Individus actifs.** Les 30,0 millions de personnes des 29 PCS actives, en emploi ou au chômage, hors scolarisés (`ETUD = 2`), de 15 ans ou plus, pondérées par `IPONDI`.

| Variable active | Colonnes | Modalités |
|---|---|---|
| Diplôme | `DIPL` | les 7 catégories du projet : bac+5, bac+3/4, bac+2, bac, CAP, brevet, certificat ou aucun |
| Logement | `STOCD` | propriétaire (10) ; locataire du privé (21, 23) ; HLM (22) ; autre (30, ZZ) |
| Emploi | `EMPL`, `TP`, `TACT` | employeur (22) ; indépendant (21, 23) ; CDI ou titulaire à temps complet, à temps partiel (16 selon `TP`) ; durée limitée (11 à 15) ; chômage (`TACT = 12`) |

Trois choix tiennent au codage. `STAT` n'est pas retenu : il est entièrement contenu dans `EMPL`, ce que la lecture vérifie, et le garder compterait deux fois la même information. `TP` est fondu dans l'emploi : il vaut « sans objet » pour tous les chômeurs, et deux variables de même « sans objet » créeraient un axe du seul fait du codage. Enfin, les retraités n'ont aucune condition d'emploi : ce sont des individus supplémentaires. Leur variable manquante compte pour zéro, et leur point ne dépend que de leur diplôme et de leur logement. Leur donner une modalité ferait de l'axe 1 une opposition entre générations : la modalité « retraité » y contribuerait à 25,6 %, « certificat ou aucun » à 23,9 %.

**Calcul.** ACM de `prince` sur les 168 profils de réponses pondérés, comme `mca`. Chaque PCS est le barycentre de ses individus, orienté comme `mca` (chefs d'entreprise à droite, cadres en haut), puis mis à l'échelle sur [-10 ; +10].

| Axe | Valeur propre | Inertie brute | Taux modifié | Contribution du diplôme | du logement | de l'emploi |
|---|---|---|---|---|---|---|
| 1 | 0,467 | 10,0 % | 91,4 % | 30,8 % | 37,2 % | 32,0 % |
| 2 | 0,368 | 7,9 % | 6,1 % | 27,1 % | 43,6 % | 29,3 % |
| 3 | 0,351 | 7,5 % | 1,6 % | | | |

Le taux brut d'une ACM est toujours faible, et sous-estime l'axe : le taux modifié de Benzécri ne garde que l'écart à la moyenne des axes, ici 1/3. Les deux mesures se complètent.

**Ce que disent les axes, d'après les contributions.**

- **Axe 1 : une échelle de ressources, plus qu'un volume de capital.** À gauche, logement HLM (24,9 % de l'axe), chômage (16,9 %), certificat ou aucun diplôme (14,6 %) et durée limitée (6,1 %). À droite, propriété (10,5 %), bac+5 (7,2 %), emploi stable à temps complet (3,6 %) et employeur (3,2 %). Le côté gauche pèse le plus : cet axe dit d'abord la précarité. Au niveau des PCS actives, il suit les diplômes (corrélation pondérée de 0,89), qui entrent dans le calcul, mais aussi le patrimoine (0,88) et le niveau de vie (0,90), qui n'y entrent pas : c'est ce qui le rapproche du volume, sans l'établir au niveau des individus.
- **Axe 2 : pas la structure du capital, et une lecture fragile.** En haut, locataires du privé (27,1 %), bac+5 (14,7 %) et durée limitée (12,6 %). En bas, temps partiel stable (14,3 %), propriété (6,7 %), bac+2 (6,4 %) et HLM (6,1 %). Les employeurs sont au centre (-0,11) : capital économique et capital culturel ne s'y opposent pas. Les 15-29 ans sont en haut (+0,28), les 45-59 ans en bas (-0,14) : l'axe mêle âge, logement et stabilité de l'emploi. Sa valeur propre dépasse à peine la moyenne (0,368 contre 0,333) et les axes suivants la talonnent : un autre choix de variables pourrait le changer.

Le nuage est donc presque à une dimension. La méthode reste **exploratoire** : l'axe vertical de la carte n'a pas le statut de l'axe horizontal.

**Limites.** Les retraités sont à (-3,97 ; -8,84) : leur logement et leur diplôme, seuls pris en compte, reflètent leur génération. Le clergé fixe la borne haute de l'axe 2 (logés gratuitement), sur un très petit effectif. Le recensement de 2022 sert pour toutes les élections.

**Contre les positions lues.** Le seuil n'est atteint nulle part. En X, l'ordre des catégories est proche de celui de Chris (Spearman 0,81, RMSE 3,52 sur 24 points) : une échelle de ressources et l'axe de l'exploitation classent les catégories dans un ordre voisin, sans que l'un valide l'autre. En Y, l'écart est grand (RMSE 6,21, Spearman 0,46), et c'est attendu : l'axe 2 ne mesure pas la division du travail.

**Une méthode non mise en œuvre.** Wright (*Classes*, Verso, 1985) définit les classes par l'exploitation et la domination, d'où l'intérêt de sa grille pour ce graphique. Cette grille demande l'autorité exercée au travail, que le recensement ne renseigne pas : Wright n'est donc cité qu'en arrière-plan.
