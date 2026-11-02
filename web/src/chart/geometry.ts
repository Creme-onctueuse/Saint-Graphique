/**
 * Géométrie de la carte plein écran. Le SVG occupe toute la fenêtre ; les éléments d'interface
 * flottent au-dessus et réservent des marges (`Insets`). La zone de tracé est ce qui reste, moins
 * la bande des axes. Les échelles X et Y sont indépendantes : la carte s'étire pour remplir l'écran,
 * sauf en mode « proportions d'origine », où la zone de tracé est un carré centré.
 *
 * Module pur (sans DOM), testé dans geometry.test.ts.
 */
import { scaleLinear, type ScaleLinear } from 'd3-scale';

export type Scale = ScaleLinear<number, number>;

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PlotRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ChartGeometry {
  /** Dimensions du SVG (px). */
  width: number;
  height: number;
  /** Zone de tracé : les données sont placées dedans, le fond et la grille la débordent. */
  plot: PlotRect;
  /** Plus petit côté de la zone de tracé : la taille des repères en dépend. */
  unit: number;
  small: boolean;
  square: boolean;
}

export interface GeometryStyle {
  smallWidth: number;
  /** Bande réservée aux graduations et aux titres des axes. */
  axisBand: { left: number; bottom: number };
  axisBandSmall: { left: number; bottom: number };
  minPlot: number;
}

export function computeGeometry(
  width: number,
  height: number,
  insets: Insets,
  square: boolean,
  style: GeometryStyle,
): ChartGeometry {
  const small = width < style.smallWidth;
  const band = small ? style.axisBandSmall : style.axisBand;
  const left = insets.left + band.left;
  const top = insets.top;
  const w = Math.max(style.minPlot, width - left - insets.right);
  const h = Math.max(style.minPlot, height - top - insets.bottom - band.bottom);
  const unit = Math.min(w, h);
  const plot: PlotRect = square
    ? { x: left + (w - unit) / 2, y: top + (h - unit) / 2, w: unit, h: unit }
    : { x: left, y: top, w, h };
  return { width, height, plot, unit, small, square };
}

/** Échelles de base (sans zoom) : le domaine [lo, hi], élargi de `padding`, remplit la zone de tracé. */
export function baseScales(
  geom: ChartGeometry,
  range: readonly [number, number],
  padding: number,
): { x: Scale; y: Scale } {
  const [lo, hi] = range;
  const pad = (hi - lo) * padding;
  const { x, y, w, h } = geom.plot;
  return {
    x: scaleLinear()
      .domain([lo - pad, hi + pad])
      .range([x, x + w]),
    y: scaleLinear()
      .domain([lo - pad, hi + pad])
      .range([y + h, y]),
  };
}

export interface FitTransform {
  k: number;
  tx: number;
  ty: number;
}

/**
 * Zoom qui cadre une zone de données dans la zone de tracé. Le facteur est le même sur les deux axes
 * (d3-zoom n'en a qu'un) et borné par [minK, maxK].
 */
export function fitTransform(
  geom: ChartGeometry,
  x: Scale,
  y: Scale,
  box: { x0: number; x1: number; y0: number; y1: number },
  minK: number,
  maxK: number,
): FitTransform {
  const px0 = x(box.x0);
  const px1 = x(box.x1);
  const py0 = y(box.y0);
  const py1 = y(box.y1);
  const spanX = Math.max(1, Math.abs(px1 - px0));
  const spanY = Math.max(1, Math.abs(py1 - py0));
  const k = Math.max(minK, Math.min(maxK, Math.min(geom.plot.w / spanX, geom.plot.h / spanY)));
  const cx = (px0 + px1) / 2;
  const cy = (py0 + py1) / 2;
  return {
    k,
    tx: geom.plot.x + geom.plot.w / 2 - k * cx,
    ty: geom.plot.y + geom.plot.h / 2 - k * cy,
  };
}
