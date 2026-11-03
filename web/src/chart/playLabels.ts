/**
 * Noms des électorats pendant la lecture de la frise : ils suivent leur repère et glissent vers leur
 * place à l'arrivée, sans le placement complet, trop coûteux à chaque image.
 */
import type { ChartGeometry, Scale } from './geometry.ts';
import type { Measure } from './labelLayer.ts';
import { placeLabels, type LabelItem, type Obstacle } from './labels.ts';
import { dotRadius } from './marks.ts';
import type { G } from './motion.ts';
import { CHART_STYLE } from './style.ts';
import type { ChartCandidate } from './types.ts';

/** Position d'un libellé par rapport à son repère (px, texte aligné à gauche). */
interface LabelOffset {
  dx: number;
  dy: number;
  visible: boolean;
}

const LABEL_WEIGHT = 650;
const FALLBACK: LabelOffset = { dx: 8, dy: 0, visible: true };

export class PlayLabels {
  private readonly layer: G;
  private from = new Map<string, LabelOffset>();
  private to = new Map<string, LabelOffset>();
  private now = new Map<string, LabelOffset>();

  constructor(layer: G) {
    this.layer = layer;
  }

  reset(): void {
    this.now = new Map();
  }

  /** Nouveau segment : les libellés glisseront vers leur place à l'arrivée, sans se chevaucher. */
  beginSegment(
    target: readonly ChartCandidate[],
    x: Scale,
    y: Scale,
    geom: ChartGeometry,
    measure: Measure,
  ): void {
    this.from = this.now;
    const { plot, small, unit } = geom;
    const font = small ? CHART_STYLE.candidateLabelFontSmall : CHART_STYLE.candidateLabelFont;
    const reach = small ? CHART_STYLE.candidateLabelReachSmall : CHART_STYLE.candidateLabelReach;
    const items: LabelItem[] = target.map((c) => ({
      key: c.trackKey ?? c.id,
      text: c.label,
      cx: x(c.x),
      cy: y(c.y),
      r: dotRadius(c, unit),
      priority: 1000 + (c.share ?? 0),
      font,
      weight: LABEL_WEIGHT,
      reach: Math.min(reach, 40),
    }));
    const obstacles: Obstacle[] = items.map((it) => ({
      key: it.key,
      cx: it.cx,
      cy: it.cy,
      r: it.r,
      strong: true,
    }));
    const placed = placeLabels(items, obstacles, plot, measure, { passes: 0 });
    const next = new Map<string, LabelOffset>();
    for (const it of items) {
      const p = placed.get(it.key);
      if (!p) continue;
      const width = measure(it.text, font, LABEL_WEIGHT);
      const left = p.anchor === 'start' ? p.x : p.anchor === 'end' ? p.x - width : p.x - width / 2;
      next.set(it.key, { dx: left - it.cx, dy: p.y - it.cy, visible: p.visible });
    }
    this.to = next;
  }

  /** Une image. `progress` : avancement du segment, de 0 à 1. */
  draw(
    cands: readonly ChartCandidate[],
    progress: number,
    x: Scale,
    y: Scale,
    small: boolean,
  ): void {
    const now = new Map<string, LabelOffset>();
    const data = cands.map((c) => {
      const key = c.trackKey ?? c.id;
      const a = this.from.get(key);
      const b = this.to.get(key) ?? a ?? FALLBACK;
      const from = a ?? b;
      const offset: LabelOffset = {
        dx: from.dx + (b.dx - from.dx) * progress,
        dy: from.dy + (b.dy - from.dy) * progress,
        visible: from.visible || b.visible,
      };
      now.set(key, offset);
      return { key, c, offset };
    });
    this.now = now;
    const font = small ? CHART_STYLE.candidateLabelFontSmall : CHART_STYLE.candidateLabelFont;
    this.layer
      .selectAll<SVGTextElement, (typeof data)[number]>('text')
      .data(data, (d) => d.key)
      .join('text')
      .attr('class', 'sg-label sg-play-label')
      .attr('dy', '0.35em')
      .attr('x', (d) => x(d.c.x) + d.offset.dx)
      .attr('y', (d) => y(d.c.y) + d.offset.dy)
      .attr('opacity', (d) => (d.offset.visible ? (d.c.alpha ?? 1) : 0))
      .style('font-size', `${font}px`)
      .text((d) => d.c.label);
  }

  clear(): void {
    this.layer.selectAll('text').remove();
  }
}
