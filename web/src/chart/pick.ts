/** Repère visé par le pointeur. */
import type { ChartGeometry, Scale } from './geometry.ts';
import { barycenterRing, bubbleRadius, dotRadius, pcsRadius } from './marks.ts';
import { CHART_STYLE } from './style.ts';
import type { ChartModel, ChartView } from './types.ts';

export interface PickContext {
  model: ChartModel;
  view: Pick<ChartView, 'hiddenGroups' | 'hiddenCandidates'>;
  geom: Pick<ChartGeometry, 'plot' | 'unit'>;
  x: Scale;
  y: Scale;
}

/**
 * Clé du repère sous le point (px, py), en coordonnées du SVG : à moins de hoverRadius px, le plus
 * proche, puis le plus petit ; sinon la plus petite bulle qui le contient, car les bulles se
 * chevauchent ; sinon l'anneau du barycentre. Null hors de tout repère.
 */
export function pickKey(px: number, py: number, ctx: PickContext): string | null {
  const { model, view, geom, x, y } = ctx;
  const { plot, unit } = geom;
  // Dans la bande des axes, la carte ne réagit pas : ses repères y sont masqués.
  if (px < plot.x || py < plot.y || px > plot.x + plot.w || py > plot.y + plot.h) return null;

  let near: string | null = null;
  let nearGap = Number.POSITIVE_INFINITY;
  let nearSize = Number.POSITIVE_INFINITY;
  const consider = (key: string, cx: number, cy: number, r: number): void => {
    const gap = Math.max(0, Math.hypot(px - cx, py - cy) - r);
    if (gap > CHART_STYLE.hoverRadius) return;
    if (gap < nearGap || (gap === nearGap && r < nearSize)) {
      near = key;
      nearGap = gap;
      nearSize = r;
    }
  };
  for (const p of model.pcs) {
    if (!view.hiddenGroups.has(p.group)) {
      consider(`p:${p.code}`, x(p.x), y(p.y), pcsRadius(p, unit));
    }
  }
  const shown = model.candidates.filter((c) => !view.hiddenCandidates.has(c.id));
  for (const c of shown) consider(`c:${c.id}`, x(c.x), y(c.y), dotRadius(c, unit));
  if (near !== null) return near;

  let bubble: string | null = null;
  let smallest = Number.POSITIVE_INFINITY;
  for (const c of shown) {
    const radius = bubbleRadius(c, unit);
    if (radius < smallest && Math.hypot(px - x(c.x), py - y(c.y)) <= radius) {
      bubble = `c:${c.id}`;
      smallest = radius;
    }
  }
  if (bubble !== null) return bubble;

  if (!model.barycenter) return null;
  const distance = Math.hypot(px - x(model.barycenter.x), py - y(model.barycenter.y));
  return Math.abs(distance - barycenterRing(unit)) <= 4 ? 'bary' : null;
}
