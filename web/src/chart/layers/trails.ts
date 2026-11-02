/**
 * Trajectoires : le chemin de chaque famille d'une élection à l'autre, jusqu'à l'élection affichée.
 * Discrètes par défaut, appuyées pour la famille sélectionnée, avec ses étapes nommées. Les années de
 * coalition les coupent. Les catégories, elles, ne bougent pas : voir docs/methodologie.md.
 */
import { select, type Selection } from 'd3-selection';
import type { AppState } from '../../core/state.ts';
import {
  familyOfCandidate,
  familyTrails,
  stopsForFilter,
  timelineStops,
  usesMapAxes,
  type CandidatePosition,
  type Trail,
  type TrailPoint,
} from '../../core/timeline.ts';
import { computedKey, type Dataset } from '../../data/dataset.ts';
import type { Feature } from '../../ui/actions.ts';
import type { ResolvedView } from '../../view.ts';
import type { SaintChart } from '../chart.ts';

const TYPE_LETTER: Record<string, string> = {
  presidentielle: 'P',
  legislatives: 'L',
  europeennes: 'E',
};

interface SegmentDatum {
  key: string;
  family: string;
  color: string;
  strong: boolean;
  points: TrailPoint[];
}

interface DotDatum extends TrailPoint {
  key: string;
  color: string;
  tag: string;
}

/** Écart minimal entre deux noms d'étapes (px) : assez pour lire « 2022 P » sans chevauchement. */
const TAG_GAP_X = 38;
const TAG_GAP_Y = 13;

/**
 * Noms d'étapes à afficher : sans zoom, les étapes se serrent et leurs noms se recouvrent. Les plus
 * récentes passent d'abord. Le point reste visible ; seul son nom disparaît.
 */
export function thinTags<T extends { px: number; py: number }>(
  items: readonly T[],
  gapX = TAG_GAP_X,
  gapY = TAG_GAP_Y,
): T[] {
  const kept: T[] = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (!item) continue;
    const free = kept.every(
      (o) => Math.abs(o.px - item.px) >= gapX || Math.abs(o.py - item.py) >= gapY,
    );
    if (free) kept.push(item);
  }
  return kept;
}

export class TrailsLayer implements Feature {
  private readonly chart: SaintChart;
  private readonly ds: Dataset;
  private readonly layer: Selection<SVGGElement, unknown, null, undefined>;
  // Trois niveaux, pour que le tracé d'une trajectoire ne passe jamais sur le nom d'une étape.
  private readonly lines: Selection<SVGGElement, unknown, null, undefined>;
  private readonly dots: Selection<SVGGElement, unknown, null, undefined>;
  private readonly tags: Selection<SVGGElement, unknown, null, undefined>;
  private trails: Trail[] = [];
  private strong = new Set<string>();

  constructor(chart: SaintChart, ds: Dataset) {
    this.chart = chart;
    this.ds = ds;
    this.layer = select(chart.layerUnder).append('g').attr('class', 'sg-trails');
    this.lines = this.layer.append('g');
    this.dots = this.layer.append('g');
    this.tags = this.layer.append('g');
    chart.onRender(() => this.render());
  }

  private colorOf(trail: Trail): string {
    return trail.isAbstention ? `var(--sg-abstention, ${trail.color})` : trail.color;
  }

  private tagOf(election: string): string {
    const info = this.ds.elections.find((e) => e.id === election);
    return `${info?.year ?? ''} ${TYPE_LETTER[info?.type ?? ''] ?? ''}`.trim();
  }

  private position(method: string, election: string, id: string): CandidatePosition | null {
    const file = this.ds.computed.get(computedKey(method, election));
    const c = file?.candidates.find((v) => v.id === id);
    if (!c) return null;
    return {
      x: c.x,
      y: c.y,
      color: c.color,
      share: c.national_share_pct ?? null,
      isAbstention: c.is_abstention === true,
    };
  }

  sync(view: ResolvedView, state: AppState): void {
    const families = this.ds.families;
    const hidden =
      !families || !state.showTrails || view.isPopulation || view.customized || !usesMapAxes(state);
    if (hidden) {
      this.trails = [];
      this.strong = new Set();
      this.render();
      return;
    }
    const all = timelineStops(this.ds);
    const current = all.find((s) => s.id === view.electionId);
    this.trails = familyTrails(
      families,
      stopsForFilter(all, state.typeFilter),
      (election, id) => this.position(view.method.id, election, id),
      this.chart.playhead?.date ?? current?.date ?? Number.POSITIVE_INFINITY,
    );
    this.strong = new Set(
      [state.selected, state.compared].flatMap((key) => {
        if (!key?.startsWith('c:')) return [];
        const family = familyOfCandidate(families, key.slice(2));
        return family ? [family.id] : [];
      }),
    );
    // Sur la projection, flèches et cercles disent déjà le mouvement : seule la famille choisie garde
    // sa trajectoire.
    if (view.projection) this.trails = this.trails.filter((t) => this.strong.has(t.family));
    this.render();
  }

  private render(): void {
    const { x, y } = this.chart.scales();
    const start = this.chart.playhead?.election;
    const segments: SegmentDatum[] = this.trails.flatMap((t) =>
      t.segments
        .map((points) => {
          // Pendant la lecture, le dernier tronçon va jusqu'au repère : la trajectoire pousse avec lui.
          const last = points.at(-1);
          const tip = start && last?.election === start ? this.chart.trackPosition(t.family) : null;
          return tip && last ? [...points, { ...last, x: tip.x, y: tip.y }] : points;
        })
        .filter((points) => points.length > 1)
        .map((points, i) => ({
          key: `${t.family}:${i}`,
          family: t.family,
          color: this.colorOf(t),
          strong: this.strong.has(t.family),
          points,
        })),
    );
    const line = (d: SegmentDatum): string =>
      `M${d.points.map((p) => `${x(p.x)},${y(p.y)}`).join('L')}`;
    this.layer.classed('sg-trails--focused', this.strong.size > 0);
    // Un liseré clair sous la trajectoire choisie : certaines couleurs de partis sont très sombres.
    this.lines
      .selectAll<SVGPathElement, SegmentDatum>('path.sg-trail-casing')
      .data(
        segments.filter((d) => d.strong),
        (d) => d.key,
      )
      .join('path')
      .attr('class', 'sg-trail-casing')
      .attr('d', line);
    this.lines
      .selectAll<SVGPathElement, SegmentDatum>('path.sg-trail')
      .data(segments, (d) => d.key)
      .join('path')
      .attr('class', 'sg-trail')
      .attr('data-family', (d) => d.family)
      .classed('sg-trail--strong', (d) => d.strong)
      .style('stroke', (d) => d.color)
      .attr('d', line);
    this.lines.selectAll<SVGPathElement, SegmentDatum>('path.sg-trail--strong').raise();

    const dots: DotDatum[] = this.trails
      .filter((t) => this.strong.has(t.family))
      .flatMap((t) =>
        t.segments.flat().map((p) => ({
          ...p,
          key: `${t.family}:${p.election}`,
          color: this.colorOf(t),
          tag: this.tagOf(p.election),
        })),
      );
    this.dots
      .selectAll<SVGCircleElement, DotDatum>('circle.sg-trail-dot')
      .data(dots, (d) => d.key)
      .join('circle')
      .attr('class', 'sg-trail-dot')
      .attr('r', 4)
      .attr('cx', (d) => x(d.x))
      .attr('cy', (d) => y(d.y))
      .style('fill', (d) => d.color);
    this.tags
      .selectAll<SVGTextElement, DotDatum>('text.sg-trail-tag')
      .data(thinTags(dots.map((d) => ({ ...d, px: x(d.x), py: y(d.y) }))), (d) => d.key)
      .join('text')
      .attr('class', 'sg-trail-tag')
      .attr('x', (d) => d.px)
      .attr('y', (d) => d.py - 8)
      .attr('text-anchor', 'middle')
      .text((d) => d.tag);
  }
}
