/**
 * Anneaux de vote : pour chaque groupe du sondage, comment il se partage entre les blocs. L'anneau est
 * au centre des catégories du groupe, son rayon suit son poids, et ses parts glissent d'une élection à
 * l'autre : les catégories ne bougent pas, mais leur vote, si.
 *
 * Les parts gardent toujours le même ordre, séparées par un fin espace : avec la légende et le tableau
 * (RingsKey), elles ne dépendent pas de la seule couleur.
 */
import { select, type Selection } from 'd3-selection';
import 'd3-transition';
import { GROUP_SHORT_NAMES } from '../../core/groups.ts';
import { formatPct } from '../../core/format.ts';
import type { AppState } from '../../core/state.ts';
import { blocVotes, ringCenter, usesMapAxes, type RingDatum } from '../../core/timeline.ts';
import type { Point } from '../../core/types.ts';
import type { Dataset } from '../../data/dataset.ts';
import type { Feature } from '../../ui/actions.ts';
import type { ResolvedView } from '../../view.ts';
import type { SaintChart } from '../chart.ts';
import { CHART_STYLE } from '../style.ts';
import { arcAngles, arcPath, lerpAngles, type ArcAngles } from './arc.ts';

/** Rayon extérieur = k · unité · √(poids du groupe en %). */
const RING_RADIUS_PER_SQRT_PCT = 0.0125;
const RING_MIN_RADIUS = 18;
/** Épaisseur de l'anneau, en fraction de l'unité. */
const RING_THICKNESS = 0.012;
const RING_MIN_THICKNESS = 7;

/** Nom d'un groupe du sondage : le groupe « 2 » réunit aussi les agriculteurs. */
export function ringName(group: string, merged: boolean): string {
  const name = GROUP_SHORT_NAMES[group] ?? group;
  return group === '2' && merged ? `${name} et agriculteurs` : name;
}

interface Ring extends RingDatum {
  center: Point;
  name: string;
}

interface PartDatum {
  bloc: string;
  label: string;
  share: number;
  angles: ArcAngles;
  inner: number;
  outer: number;
  name: string;
}

export class RingsLayer implements Feature {
  private readonly chart: SaintChart;
  private readonly ds: Dataset;
  private readonly layer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly reducedMotion: MediaQueryList | null;
  private readonly previous = new WeakMap<SVGPathElement, ArcAngles>();
  private rings: Ring[] = [];

  constructor(chart: SaintChart, ds: Dataset) {
    this.chart = chart;
    this.ds = ds;
    this.layer = select(chart.layerUnder).append('g').attr('class', 'sg-rings');
    this.reducedMotion =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    chart.onRender(() => this.place());
  }

  private compute(view: ResolvedView, state: AppState): Ring[] {
    const families = this.ds.families;
    const election = view.rawElection;
    if (!families || !election || !state.showRings || !usesMapAxes(state)) return [];
    const groupOf = (code: string): string => this.ds.pcsMeta.get(code)?.group ?? code.charAt(0);
    const data = blocVotes(election, families, groupOf);
    const available = new Set(data.map((d) => d.group));
    const merged = view.model.pcs.some((p) => p.group === '1') && !available.has('1');
    return data.flatMap((d) => {
      const center = ringCenter(d.group, view.model.pcs, available);
      return center ? [{ ...d, center, name: ringName(d.group, merged) }] : [];
    });
  }

  private outerRadius(weight: number): number {
    const r = RING_RADIUS_PER_SQRT_PCT * this.chart.geometry.unit * Math.sqrt(Math.max(0, weight));
    return Math.max(RING_MIN_RADIUS, r);
  }

  sync(view: ResolvedView, state: AppState): void {
    this.rings = this.compute(view, state);
    // Les anneaux parlent des groupes : les catégories passent au second plan et se taisent.
    this.chart.svg.classList.toggle('sg-rings-on', this.rings.length > 0);
    const unit = this.chart.geometry.unit;
    const thickness = Math.max(RING_MIN_THICKNESS, RING_THICKNESS * unit);

    const groups = this.layer
      .selectAll<SVGGElement, Ring>('g.sg-ring')
      .data(this.rings, (d) => d.group)
      .join((enter) => {
        const g = enter.append('g').attr('class', 'sg-ring');
        g.append('text').attr('class', 'sg-ring__name').attr('text-anchor', 'middle');
        return g;
      })
      .attr('data-group', (d) => d.group);

    const parts = groups
      .selectAll<SVGPathElement, PartDatum>('path.sg-ring__part')
      .data(
        (d) => {
          const outer = this.outerRadius(d.weight);
          const angles = arcAngles(d.parts.map((p) => p.share));
          return d.parts.map((p, i) => ({
            ...p,
            angles: angles[i] ?? { start: 0, end: 0 },
            inner: Math.max(4, outer - thickness),
            outer,
            name: d.name,
          }));
        },
        (d) => d.bloc,
      )
      .join((enter) => {
        const path = enter.insert('path', 'text').attr('class', 'sg-ring__part');
        path.append('title');
        return path;
      })
      .attr('data-bloc', (d) => d.bloc)
      .style('fill', (d) => `var(--sg-bloc-${d.bloc.replace('_', '-')})`);
    parts.select('title').text((d) => `${d.name} : ${d.label} ${formatPct(d.share, 0)}`);

    const duration = this.reducedMotion?.matches ? 0 : CHART_STYLE.durations.normal;
    const previous = this.previous;
    if (duration > 0) {
      parts
        .transition('sg-ring')
        .duration(duration)
        .attrTween('d', function (d) {
          const from = previous.get(this) ?? d.angles;
          previous.set(this, d.angles);
          return (t) => {
            const a = lerpAngles([from], [d.angles], t)[0] ?? d.angles;
            return arcPath(d.inner, d.outer, a.start, a.end);
          };
        });
    } else {
      parts.interrupt('sg-ring').each(function (d) {
        previous.set(this, d.angles);
        this.setAttribute('d', arcPath(d.inner, d.outer, d.angles.start, d.angles.end));
      });
    }
    groups
      .select('text.sg-ring__name')
      .attr('y', (d) => this.outerRadius(d.weight) + 13)
      .text((d) => d.name);
    this.place();
  }

  /** Suit le zoom : les anneaux gardent leur taille, seuls leurs centres se déplacent. */
  private place(): void {
    const { x, y } = this.chart.scales();
    this.layer
      .selectAll<SVGGElement, Ring>('g.sg-ring')
      .attr('transform', (d) => `translate(${x(d.center.x)},${y(d.center.y)})`);
  }
}
