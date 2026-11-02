/**
 * Réglages géométriques de la carte (hors couleurs, qui sont dans src/theme/tokens.css).
 */
export const CHART_STYLE = {
  /** Bande des graduations et des titres d'axes (px), en plus des marges de l'interface. */
  axisBand: { left: 38, bottom: 34 },
  axisBandSmall: { left: 26, bottom: 30 },
  /** Plus petit côté accepté pour la zone de tracé (px). */
  minPlot: 160,
  /** En dessous de cette largeur (px), marges et polices réduites. */
  smallWidth: 560,
  /** Marge autour de l'intervalle des axes, en fraction de son étendue. */
  domainPadding: 0.06,
  /** Nombre indicatif de graduations par axe. */
  ticks: 5,
  /** Rayon d'un disque PCS = k · unité · √(part de population en %). */
  pcsRadiusPerSqrtPct: 0.0125,
  pcsMinRadius: 2.5,
  /** Point qui marque la position exacte d'un électorat, au centre de sa bulle (px). */
  candidateDotRadius: 3.5,
  /** Le même, sans bulle : un électorat sans taille connue (projection 2027). */
  candidateDotRadiusAlone: 5.5,
  /** Rayon du cercle ouvert du barycentre de la population (fraction de l'unité). */
  barycenterRadius: 0.028,
  labelFont: 11.5,
  labelFontSmall: 10,
  candidateLabelFont: 12.5,
  candidateLabelFontSmall: 10.5,
  /** Éloignement maximal des libellés, avec ligne de rappel (px). */
  candidateLabelReach: 152,
  candidateLabelReachSmall: 106,
  pcsLabelReach: 26,
  pcsLabelReachSmall: 16,
  /**
   * Moins d'encombrement : une catégorie n'est nommée que si elle est grande (part de la population,
   * en %) ou si elle a de la place autour d'elle (écart en px avec le repère le plus proche). Le zoom
   * écarte les repères, et les noms apparaissent d'eux-mêmes.
   */
  pcsLabelMinWeight: 3,
  pcsLabelMinGap: 14,
  pcsLabelMinWeightSmall: 6,
  pcsLabelMinGapSmall: 22,
  /** Passes de déplacement itératif des libellés (0 pendant un zoom, pour rester fluide). */
  labelPasses: 2,
  /** Distance (px) à laquelle le pointeur « attrape » un repère. */
  hoverRadius: 12,
  zoomExtent: [1, 12] as [number, number],
  /** Marge (en unités de données) autour d'une zone cadrée par le bouton dédié. */
  fitPadding: 0.6,
  /** Temps passé entre deux scrutins pendant la lecture de la frise (ms). */
  playSegmentMs: 1500,
  /** Durée du glissement de la carte quand un panneau s'ouvre (ms). */
  slideDuration: 180,
  /** Durées des transitions (ms). */
  durations: { normal: 650, fast: 170 },
} as const;

/** Textes fixes du graphique. */
export const CHART_TEXT = {
  xLow: 'travail',
  xHigh: 'capital',
  yLow: 'dominé',
  yHigh: 'dominant',
} as const;
