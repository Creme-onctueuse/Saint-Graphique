/** Libellés de la carte hors lecture : choix de ce qui est nommé, placement et dessin. */
import { placeLabels, type Anchor, type LabelItem, type Obstacle, type Segment } from './labels.ts';
import { dotRadius, pcsRadius, type MarkContext } from './marks.ts';
import { exitSel, setAttrs, type G } from './motion.ts';
import { CHART_STYLE } from './style.ts';
import type { ChartCandidate, ChartPcs, ChartView } from './types.ts';

export type Measure = (text: string, font: number, weight: number) => number;

interface LabelDatum {
  key: string;
  text: string;
  x: number;
  y: number;
  anchor: Anchor;
  visible: boolean;
  font: number;
  candidate: boolean;
  leader: Segment | null;
}

export interface LabelContext extends MarkContext {
  view: ChartView;
  measure: Measure;
  /** Geste en cours : un placement rapide suffit, le complet vient à la fin. */
  quick: boolean;
}

/** Mesure la largeur des textes et la garde en mémoire : un même nom revient à chaque image. */
export class TextMeasurer {
  family = 'sans-serif';
  private context: CanvasRenderingContext2D | null | undefined;
  private readonly widths = new Map<string, number>();

  measure: Measure = (text, font, weight) => {
    const key = `${weight}|${font}|${this.family}|${text}`;
    const known = this.widths.get(key);
    if (known !== undefined) return known;
    const width = this.width(text, font, weight);
    this.widths.set(key, width);
    return width;
  };

  private width(text: string, font: number, weight: number): number {
    if (this.context === undefined) {
      try {
        this.context = document.createElement('canvas').getContext('2d');
      } catch {
        this.context = null;
      }
    }
    if (!this.context) return text.length * font * (weight >= 600 ? 0.6 : 0.55);
    this.context.font = `${weight} ${font}px ${this.family}`;
    return this.context.measureText(text).width;
  }
}

/** Une catégorie est nommée si elle est grande, mise en avant, ou si elle a de la place. */
function pcsLabelled(
  p: ChartPcs,
  cx: number,
  cy: number,
  r: number,
  obstacles: readonly Obstacle[],
  view: ChartView,
  small: boolean,
): boolean {
  const key = `p:${p.code}`;
  if (view.selected.has(key)) return true;
  if (view.focus) return view.focus.has(key);
  if (p.weight >= (small ? CHART_STYLE.pcsLabelMinWeightSmall : CHART_STYLE.pcsLabelMinWeight)) {
    return true;
  }
  const minGap = small ? CHART_STYLE.pcsLabelMinGapSmall : CHART_STYLE.pcsLabelMinGap;
  return obstacles.every(
    (o) => o.key === key || Math.hypot(o.cx - cx, o.cy - cy) - o.r - r >= minGap,
  );
}

/** Tous les repères affichés, même sans libellé : aucun nom ne doit les recouvrir. */
function obstaclesOf(ctx: LabelContext): Obstacle[] {
  const { x, y, model, view, geom } = ctx;
  return [
    ...model.pcs
      .filter((p) => !view.hiddenGroups.has(p.group))
      .map((p) => ({
        key: `p:${p.code}`,
        cx: x(p.x),
        cy: y(p.y),
        r: pcsRadius(p, geom.unit),
      })),
    ...model.candidates
      .filter((c) => !view.hiddenCandidates.has(c.id))
      .map((c) => ({
        key: `c:${c.id}`,
        cx: x(c.x),
        cy: y(c.y),
        r: dotRadius(c, geom.unit),
        strong: true,
      })),
  ];
}

export function drawMapLabels(
  leaderLayer: G,
  labelLayer: G,
  pcs: ChartPcs[],
  cands: ChartCandidate[],
  ctx: LabelContext,
): void {
  const { x, y, duration, geom, view } = ctx;
  const { plot, small, unit } = geom;
  const inPlot = (px: number, py: number): boolean =>
    px >= plot.x && px <= plot.x + plot.w && py >= plot.y && py <= plot.y + plot.h;
  const candFont = small ? CHART_STYLE.candidateLabelFontSmall : CHART_STYLE.candidateLabelFont;
  const pcsFont = small ? CHART_STYLE.labelFontSmall : CHART_STYLE.labelFont;

  const obstacles = obstaclesOf(ctx);
  const items: LabelItem[] = [];
  for (const c of cands) {
    const cx = x(c.x);
    const cy = y(c.y);
    if (!inPlot(cx, cy)) continue;
    items.push({
      key: `c:${c.id}`,
      text: c.label,
      cx,
      cy,
      r: dotRadius(c, unit),
      priority: 1000 + (c.share ?? 0),
      font: candFont,
      weight: 650,
      reach: small ? CHART_STYLE.candidateLabelReachSmall : CHART_STYLE.candidateLabelReach,
    });
  }
  for (const p of pcs) {
    const cx = x(p.x);
    const cy = y(p.y);
    const r = pcsRadius(p, unit);
    if (!inPlot(cx, cy) || !pcsLabelled(p, cx, cy, r, obstacles, view, small)) continue;
    items.push({
      key: `p:${p.code}`,
      text: p.short,
      cx,
      cy,
      r,
      priority: p.weight,
      font: pcsFont,
      weight: 400,
      reach: small ? CHART_STYLE.pcsLabelReachSmall : CHART_STYLE.pcsLabelReach,
    });
  }
  const placed = placeLabels(items, obstacles, plot, ctx.measure, {
    passes: ctx.quick ? 0 : CHART_STYLE.labelPasses,
  });
  const data: LabelDatum[] = items.map((it) => {
    const p = placed.get(it.key);
    return {
      key: it.key,
      text: it.text,
      x: p?.x ?? it.cx,
      y: p?.y ?? it.cy,
      anchor: p?.anchor ?? 'middle',
      visible: p?.visible ?? false,
      font: it.font,
      candidate: it.key.startsWith('c:'),
      leader: p?.visible ? p.leader : null,
    };
  });

  const leaders = leaderLayer.selectAll<SVGLineElement, LabelDatum>('line.sg-leader').data(
    data.filter((d) => d.leader !== null),
    (d) => d.key,
  );
  exitSel(leaders.exit<LabelDatum>(), 'sg-leader', duration);
  const enteredLeaders = leaders
    .enter()
    .append('line')
    .attr('class', 'sg-leader')
    .attr('x1', (d) => d.leader?.x1 ?? 0)
    .attr('y1', (d) => d.leader?.y1 ?? 0)
    .attr('x2', (d) => d.leader?.x1 ?? 0)
    .attr('y2', (d) => d.leader?.y1 ?? 0);
  const allLeaders = enteredLeaders.merge(leaders);
  allLeaders.attr('data-key', (d) => d.key);
  setAttrs(allLeaders, duration, {
    x1: (d) => d.leader?.x1 ?? 0,
    y1: (d) => d.leader?.y1 ?? 0,
    x2: (d) => d.leader?.x2 ?? 0,
    y2: (d) => d.leader?.y2 ?? 0,
  });

  const sel = labelLayer
    .selectAll<SVGTextElement, LabelDatum>('text.sg-label')
    .data(data, (d) => d.key);
  exitSel(sel.exit<LabelDatum>(), 'sg-label', duration);
  const entered = sel
    .enter()
    .append('text')
    .attr('class', 'sg-label')
    .attr('x', (d) => d.x)
    .attr('y', (d) => d.y)
    .attr('dy', '0.35em')
    .attr('opacity', 0);
  const all = entered.merge(sel);
  all
    .attr('data-key', (d) => d.key)
    .classed('sg-label--cand', (d) => d.candidate)
    .attr('text-anchor', (d) => d.anchor)
    .style('font-size', (d) => `${d.font}px`)
    .text((d) => d.text);
  setAttrs(all, duration, {
    x: (d) => d.x,
    y: (d) => d.y,
    opacity: (d) => (d.visible ? 1 : 0),
  });
}
