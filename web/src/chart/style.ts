/**
 * Réglages géométriques du graphique (hors couleurs, qui sont dans src/theme/tokens.css).
 * À ajuster lors du calage visuel sur les captures (mode calque).
 */
export const CHART_STYLE = {
  /** Côté maximal de la zone de tracé (px). */
  maxPlot: 760,
  margin: { top: 16, right: 18, bottom: 56, left: 62 },
  marginSmall: { top: 10, right: 10, bottom: 50, left: 46 },
  /** En dessous de cette largeur de conteneur (px), marges et polices réduites. */
  smallWidth: 520,
  /** Marge autour de l'intervalle des axes, en fraction de son étendue. */
  domainPadding: 0.09,
  /** Nombre indicatif de graduations par axe. */
  ticks: 5,
  /** Rayon d'un disque PCS = k · côté · √(part de population en %). */
  pcsRadiusPerSqrtPct: 0.0125,
  pcsMinRadius: 2.5,
  /** Demi-diagonale d'un losange = k · côté · √(score en %). */
  candidateHalfDiagonalPerSqrtPct: 0.0062,
  candidateMinHalfDiagonal: 4.5,
  /** Score utilisé quand un candidat n'a pas de score national. */
  candidateDefaultShare: 5,
  /** Rayon du cercle ouvert du barycentre de la population (fraction du côté). */
  barycenterRadius: 0.035,
  labelFont: 11.5,
  labelFontSmall: 10,
  candidateLabelFont: 12,
  candidateLabelFontSmall: 10.5,
  axisFont: 11,
  axisTitleFont: 13,
  /** Distance (px) à laquelle le pointeur « attrape » un repère. */
  hoverRadius: 12,
  zoomExtent: [1, 12] as [number, number],
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
