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

## 4. Reconstruction tierce : JnthnBS

Le dépôt [JnthnBS/saint-graphique](https://github.com/JnthnBS/saint-graphique), sans lien avec la PaduTeam, propose une reconstruction déclarée comme telle : X par le rang du ratio patrimoine / niveau de vie, Y par le rang d'un score de diplômes, un score fixe pour les retraités, et un barycentre des groupes de niveau 1. Notre méthode `ranks_jnthnbs` suit cette description.

Ce ratio ne figure dans aucun énoncé relevé de Chris. Un accord avec cette reconstruction n'est donc pas une preuve indépendante : elle a été conçue pour ressembler au graphique, et l'accord de `ranks_jnthnbs` avec les candidats lui doit une partie de sa qualité.

Des commentateurs proposent d'autres lectures, non vérifiées ici. Ventre Presse lit X comme la part des revenus du capital ([71NMMwmEfsg 08:05](https://youtu.be/71NMMwmEfsg?t=485)), puis rapporte une discussion avec Chris : « ça raisonne plus en termes de patrimoine que de revenus » ([z-phWkqNqyg 14:31](https://youtu.be/z-phWkqNqyg?t=871)).

## 5. Écarts mesurés

Reproduction : `scripts/analyze/compare.py`, `check_barycenter.py`, `x_variants.py`, `threshold_report.py` et `overlay.py`. Les chiffres dépendent de `data/pcs.json` à la date du calcul.

### Seuil et verdict

**Seuil retenu : RMSE sous 0,25 sur chaque axe**, soit un demi-pas de la grille de Chris. Sous cette valeur, un point calculé tombe en moyenne dans la bonne case. Ce seuil a été fixé après les mesures, et non avant : il décrit une précision utile, il ne constitue pas un test en aveugle.

| Méthode | Candidats du tableau (19) | Avec janvier 2025 pour 2022 (27) | Matrice v11 (21) | Catégories lues |
|---|---|---|---|---|
| `read_positions` | 0,18 / 0,21 : **atteint** | 0,44 / 0,28 : non atteint | 2,74 / 2,15 : non atteint | sans valeur de preuve (voir ci-dessous) |
| `ranks_jnthnbs` | 0,22 / 1,01 : non atteint | 0,43 / 1,02 : non atteint | 2,53 / 2,39 : non atteint | 3,75 / 4,04 : non atteint |
| `continuous` | 5,18 / 0,80 : non atteint | 5,26 / 0,92 : non atteint | 7,48 / 2,86 : non atteint | 4,80 / 3,24 : non atteint |
| `mca` | 3,15 / 1,86 : non atteint | 3,32 / 1,80 : non atteint | 5,49 / 2,61 : non atteint | 5,74 / 10,21 : non atteint |

Chaque case donne le RMSE en X puis en Y. Lecture :

- **Seuls les candidats mettent `read_positions` à l'épreuve.** Ses catégories coïncident avec les lectures par construction (0,01 et 0,02 sur 32 points) : cet accord ne prouve rien.
- **Le seuil est atteint contre le tableau de 2025 à février 2026,** la dernière version détaillée par PCS, et par `read_positions` seule.
- **Il n'est pas atteint contre la matrice v11,** la dernière version montrée, ni par aucune méthode. La v1 réplique donc le tableau, pas la matrice.

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
| Tableau du 28 février 2026, PCS | `ranks_jnthnbs` | 24 | 3,75 | 4,04 | 0,84 | 0,83 |
| | `continuous` | 24 | 4,80 | 3,24 | 0,84 | 0,83 |
| | `mca` | 24 | 5,74 | 10,21 | 0,74 | -0,31 |
| Tableau du 27 mars 2025, candidats 2022 | `ranks_jnthnbs` | 7 | 0,16 | 0,91 | 0,96 | 0,29 |
| | `continuous` | 7 | 5,19 | 0,78 | 0,93 | 0,89 |
| Tableau du 26 janvier 2025, candidats 2017 | `ranks_jnthnbs` | 5 | 0,26 | 1,23 | 1,00 | 0,67 |
| Matrice v11, 7 lignes agrégées | `ranks_jnthnbs` | 5 | 2,73 | 2,03 | 1,00 | 1,00 |
| Matrice v11, candidats 2022 | `ranks_jnthnbs` | 12 | 2,49 | 2,57 | 0,93 | 0,03 |
| | `continuous` | 12 | 7,51 | 3,03 | 0,91 | 0,38 |
| Matrice v11, candidats 2017 | `ranks_jnthnbs` | 9 | 2,58 | 2,14 | 0,93 | 0,13 |

Les plus grands écarts de PCS, avec `ranks_jnthnbs` : Employés administratifs d'entreprise, Clergé, professions de santé et du travail social, Professeurs et professions scientifiques.

Le plus grand écart sur les électorats vient des retraités. Nous les plaçons en un seul point à Y = -10, là où la matrice v11 affiche Y = -0,69. Comme ils pèsent lourd, cela explique que l'ordre des candidats en Y soit presque perdu (Spearman 0,03 et 0,13) alors que les 5 groupes d'actifs sont bien ordonnés.

### Définitions possibles de X

Chaque variable de `data/pcs.json` est classée, ramenée sur [-10 ; +10], puis agrégée en groupes et en barycentres. La variante du ratio reproduit exactement `ranks_jnthnbs`, ce qui valide le calcul.

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

La formule des coordonnées reste inconnue : la v1 ne la devine pas. `read_positions` reprend les positions lues et sert de réplique. `ranks_jnthnbs` reste la méthode calculée sur données ouvertes.

- **Positions.** 41 postes, lus sur quatre versions du tableau, de janvier 2025 à février 2026, puis ramenés sur la grille de 0,5. Une lecture qui change de case ouvre une révision et seule la dernière compte : cela garde le déplacement des deux catégories d'employés. `scripts/analyze/build_positions.py` écrit `data/positions_chris.json`.
- **Poids.** 18 sont lus en infobulle, 16 viennent du recensement 2022 multiplié par le rapport médian avec les infobulles (0,79), 7 de l'aire du disque calibrée sur les infobulles. Leur somme atteint 99,2 sans contrainte imposée, ce qui les conforte sans les prouver.
- **Électorats.** Barycentre des groupes de niveau 1. Les sondages n'isolent pas les agriculteurs : la clé 2 réunit donc agriculteurs et indépendants, comme la ligne « Agriculteurs et prof. indépendantes » de la matrice v11. L'effet mesuré est faible : de 0,28 à 0,25 en Y sur mars 2025.
- **Règle de poids.** Elle a été retenue pour sa cohérence, pas pour son score. Une variante fondée sur les seuls disques donnait un écart un peu plus faible (0,12 et 0,21 sur mars 2025), mais attribuait un rayon médian à 20 postes, dont certains très petits.
- **Axe X.** Aucun choix n'est fait entre ratio et composition, car les données testées ne tranchent pas (section 5).
- **Matrice v11.** Elle n'est pas répliquée : ses positions et son calcul de X diffèrent, et seules 7 lignes en sont lisibles.

Limites des lectures : certaines attributions reposent sur des libellés déplacés et sur la couleur, surtout Employés de commerce (confiance 0,75) et les ouvriers non qualifiés (0,65 à 0,7). Neuf postes n'ont pas pu être relus dans la version du 28 février 2026 : ils gardent leur position de la version précédente.

### Pistes pour une méthode calculée

- **Retraités.** Une position unique très basse est incompatible avec les versions lues. Les distinguer par ancienne catégorie retire le plus gros écart en Y de `ranks_jnthnbs`.
- **Grain.** Une méthode en 30 codes ne peut pas représenter les 41 postes, en particulier les trois tailles d'exploitation agricole et les six catégories de retraités.
- **Barycentre.** Pour Y, le barycentre linéaire suffit, y compris dans la matrice v11. Pour X, il reproduit le tableau de 2025 mais pas la matrice v11.
- **Cible.** Le tableau de 2025 à février 2026 reste la seule source détaillée par PCS.
