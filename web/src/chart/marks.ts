/** Repères de la carte : ellipses de confiance, disques des catégories, barycentre, bulles. */
import { formatPct } from '../core/format.ts';
import { formatStatus } from '../core/reserves.ts';
import type { Point } from '../core/types.ts';
import type { ChartGeometry, Scale } from './geometry.ts';
import { exitSel, setAttrs, type G } from './motion.ts';
import { CHART_STYLE } from './style.ts';
import { coordinatesText } from './tips.ts';
import type { ChartCandidate, ChartModel, ChartPcs } from './types.ts';

export interface MarkContext {
  x: Scale;
  y: Scale;
  duration: number;
  geom: ChartGeometry;
  model: ChartModel;
}

export function pcsRadius(d: ChartPcs, unit: number): number {
  const r = CHART_STYLE.pcsRadiusPerSqrtPct * unit * Math.sqrt(Math.max(0, d.weight));
  return Math.max(CHART_STYLE.pcsMinRadius, r);
}

/** Rayon de la bulle : même échelle que les disques, pour que les aires se comparent. */
export function bubbleRadius(d: ChartCandidate, unit: number): number {
  const share = d.sizeShare ?? d.registeredShare ?? d.share;
  if (share === null || share === undefined) return 0;
  return CHART_STYLE.pcsRadiusPerSqrtPct * unit * Math.sqrt(Math.max(0, share));
}

export function dotRadius(d: ChartCandidate, unit: number): number {
  return bubbleRadius(d, unit) > 0
    ? CHART_STYLE.candidateDotRadius
    : CHART_STYLE.candidateDotRadiusAlone;
}

/** Rayon de l'anneau du barycentre de la population. */
export function barycenterRing(unit: number): number {
  return Math.max(8, unit * CHART_STYLE.barycenterRadius);
}

function candidateFill(d: ChartCandidate): string {
  return d.isAbstention ? `var(--sg-abstention, ${d.color})` : d.color;
}

export function drawEllipses(layer: G, data: ChartCandidate[], ctx: MarkContext): void {
  const { x, y, duration } = ctx;
  // Rotation dans le repère des données, puis mise à l'échelle : l'ellipse reste juste quand la
  // carte est étirée. L'axe Y de l'écran descend, d'où le facteur négatif.
  const kx = Math.abs(x(1) - x(0));
  const ky = Math.abs(y(1) - y(0));
  const transform = (d: ChartCandidate): string =>
    `translate(${x(d.x)},${y(d.y)}) scale(${kx},${-ky}) rotate(${d.ellipse?.angle_deg ?? 0})`;
  const sel = layer
    .selectAll<SVGEllipseElement, ChartCandidate>('ellipse.sg-ellipse')
    .data(data, (d) => d.id);
  exitSel(sel.exit<ChartCandidate>(), 'sg-ellipse', duration);
  const entered = sel
    .enter()
    .append('ellipse')
    .attr('class', 'sg-ellipse')
    .attr('transform', transform)
    .attr('rx', 0)
    .attr('ry', 0);
  const all = entered.merge(sel);
  all
    .attr('data-key', (d) => `c:${d.id}`)
    .style('stroke', candidateFill)
    .style('fill', candidateFill);
  setAttrs(all, duration, {
    transform,
    rx: (d) => d.ellipse?.rx ?? 0,
    ry: (d) => d.ellipse?.ry ?? 0,
  });
}

export function drawPcs(layer: G, data: ChartPcs[], ctx: MarkContext): void {
  const { x, y, duration, model } = ctx;
  const sel = layer
    .selectAll<SVGCircleElement, ChartPcs>('circle.sg-pcs')
    .data(data, (d) => d.code);
  exitSel(sel.exit<ChartPcs>(), 'sg-pcs', duration);
  const entered = sel
    .enter()
    .append('circle')
    .attr('class', 'sg-pcs sg-point')
    .attr('role', 'img')
    .attr('tabindex', -1)
    .attr('cx', (d) => x(d.x))
    .attr('cy', (d) => y(d.y))
    .attr('r', 0);
  const all = entered.merge(sel).order();
  all
    .attr('data-key', (d) => `p:${d.code}`)
    .attr(
      'aria-label',
      (d) =>
        `${d.label} (${d.groupLabel}) : ${formatPct(d.weight)} de la population, ` +
        coordinatesText(model, d) +
        (d.status
          ? `, patrimoine : ${formatStatus(d.status.patrimoine)}` +
            `, niveau de vie : ${formatStatus(d.status.niveauVie)}`
          : ''),
    )
    .style('fill', (d) => d.fill ?? `var(--sg-group-${d.group}, ${d.color})`);
  setAttrs(all, duration, {
    cx: (d) => x(d.x),
    cy: (d) => y(d.y),
    r: (d) => pcsRadius(d, ctx.geom.unit),
  });
}

export function drawBarycenter(layer: G, b: Point | null, ctx: MarkContext): void {
  const { x, y, duration, model } = ctx;
  const sel = layer.selectAll<SVGGElement, Point>('g.sg-bary').data(b ? [b] : []);
  exitSel(sel.exit<Point>(), 'sg-bary', duration);
  const transform = (d: Point): string => `translate(${x(d.x)},${y(d.y)})`;
  const entered = sel
    .enter()
    .append('g')
    .attr('class', 'sg-bary sg-point')
    .attr('role', 'img')
    .attr('tabindex', 0)
    .attr('data-key', 'bary')
    .attr('transform', transform);
  entered.append('circle').attr('class', 'sg-bary__ring');
  entered.append('circle').attr('class', 'sg-bary__dot').attr('r', 2.5);
  const all = entered.merge(sel);
  all.attr('aria-label', (d) => `Barycentre de la population : ${coordinatesText(model, d)}`);
  all.select('circle.sg-bary__ring').attr('r', barycenterRing(ctx.geom.unit));
  setAttrs(all, duration, { transform });
}

/**
 * Bulles des électorats. `resize` est faux pendant un glissement de la carte : seule la position
 * suit, et la taille finit sa propre transition.
 */
export function drawCandidates(
  layer: G,
  data: ChartCandidate[],
  ctx: MarkContext,
  resize: boolean,
): void {
  const { x, y, duration, model } = ctx;
  const transform = (d: ChartCandidate): string => `translate(${x(d.x)},${y(d.y)})`;
  const sel = layer
    .selectAll<SVGGElement, ChartCandidate>('g.sg-cand')
    .data(data, (d) => d.trackKey ?? d.id);
  exitSel(sel.exit<ChartCandidate>(), 'sg-cand', duration);
  const entered = sel
    .enter()
    .append('g')
    .attr('class', 'sg-cand sg-point')
    .attr('role', 'img')
    .attr('tabindex', -1)
    .attr('transform', transform);
  entered.append('circle').attr('class', 'sg-cand__area').attr('r', 0);
  entered.append('circle').attr('class', 'sg-cand__dot').attr('r', 0);
  const all = entered.merge(sel).order();
  all
    .attr('data-key', (d) => `c:${d.id}`)
    .attr(
      'aria-label',
      (d) =>
        `${d.label}${d.share !== null ? ` : ${formatPct(d.share)}` : ''}, ` +
        coordinatesText(model, d),
    )
    .classed('sg-cand--abstention', (d) => d.isAbstention);
  all
    .style('--sg-cand-color', candidateFill)
    .style('opacity', (d) => (d.alpha === undefined || d.alpha === 1 ? null : String(d.alpha)));
  setAttrs(all, duration, { transform });
  if (resize) {
    const { unit } = ctx.geom;
    setAttrs(all.select<SVGCircleElement>('circle.sg-cand__area'), duration, {
      r: (d) => bubbleRadius(d, unit),
    });
    setAttrs(all.select<SVGCircleElement>('circle.sg-cand__dot'), duration, {
      r: (d) => dotRadius(d, unit),
    });
  }
}
