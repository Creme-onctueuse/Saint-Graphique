/**
 * Lignes de croisement : de l'électorat sélectionné vers chaque groupe social, d'autant plus épaisses
 * que ce groupe pèse dans cet électorat. Un duel relie les deux électorats comparés.
 *
 * La clé « 2 » des sondages couvre les groupes 1 et 2 : ses lignes vont au centre de ces deux groupes.
 */
import { select, type Selection } from 'd3-selection';
import { weightedBarycenter } from '../../core/barycenter.ts';
import { compositionByGroup, compositionGap, pollGroupOf } from '../../core/crossing.ts';
import { formatNumber, formatPct, NBSP } from '../../core/format.ts';
import { GROUP_SHORT_NAMES } from '../../core/groups.ts';
import type { Point } from '../../core/types.ts';
import type { ResolvedView } from '../../view.ts';
import type { SaintChart } from '../chart.ts';
import type { ChartPcs } from '../types.ts';

/** Épaisseur d'une ligne (px) = base + k · part de l'électorat (%). */
const WIDTH_BASE = 1.2;
const WIDTH_PER_PCT = 0.2;
/** En dessous de cette part (%), la ligne reste sans nom : il y en aurait trop. */
const LABEL_MIN_SHARE = 5;
/** En dessous de cet écart à l'écran (px), les losanges se touchent : le lien ne montrerait rien. */
const LINK_MIN_PX = 44;

export interface Spoke {
  group: string;
  /** Centre du groupe, en coordonnées de données. */
  to: Point;
  /** Part de ce groupe dans l'électorat (%). */
  share: number;
  width: number;
  label: string;
}

export function spokeWidth(share: number): number {
  return WIDTH_BASE + WIDTH_PER_PCT * Math.max(0, share);
}

/** Lignes d'un électorat vers les groupes présents sur la carte. */
export function spokesOf(
  pcs: readonly ChartPcs[],
  shares: Readonly<Record<string, number>>,
): Spoke[] {
  const available = new Set(Object.keys(shares));
  const byKey = new Map<string, ChartPcs[]>();
  for (const p of pcs) {
    const key = pollGroupOf(p.group, available);
    if (key === null) continue;
    const list = byKey.get(key);
    if (list) list.push(p);
    else byKey.set(key, [p]);
  }
  const out: Spoke[] = [];
  for (const [group, share] of Object.entries(shares)) {
    const to = weightedBarycenter(byKey.get(group) ?? []);
    if (!to || !(share > 0)) continue;
    const merged = group === '2' && !available.has('1');
    const name = merged
      ? 'Indépendants, agriculteurs'
      : (GROUP_SHORT_NAMES[group] ?? `Groupe ${group}`);
    out.push({
      group,
      to,
      share,
      width: spokeWidth(share),
      label: `${name} ${formatPct(share, 0)}`,
    });
  }
  return out.sort((a, b) => b.share - a.share);
}

interface Link {
  a: Point;
  b: Point;
  label: string;
}

export class Spokes {
  private readonly chart: SaintChart;
  private readonly layer: Selection<SVGGElement, unknown, null, undefined>;
  private from: Point | null = null;
  private spokes: Spoke[] = [];
  private link: Link | null = null;

  constructor(chart: SaintChart) {
    this.chart = chart;
    this.layer = select(chart.layerOver).append('g').attr('class', 'sg-spokes');
    chart.onRender(() => this.draw());
  }

  sync(view: ResolvedView): void {
    const crossing = view.crossing;
    const selected = crossing?.selected;
    const compared = crossing?.compared;
    const election = view.rawElection;
    this.from = null;
    this.spokes = [];
    this.link = null;
    if (crossing && selected?.kind === 'candidate' && election) {
      const a = selected.candidate;
      if (compared?.kind === 'candidate') {
        const gap = compositionGap(
          compositionByGroup(election, a.id, crossing.groupOf),
          compositionByGroup(election, compared.candidate.id, crossing.groupOf),
        );
        this.link = {
          a: { x: a.x, y: a.y },
          b: { x: compared.candidate.x, y: compared.candidate.y },
          label: `écart ${formatNumber(gap, 1)}${NBSP}pts`,
        };
      } else {
        this.from = { x: a.x, y: a.y };
        this.spokes = spokesOf(
          view.model.pcs,
          compositionByGroup(election, a.id, crossing.groupOf),
        );
      }
    }
    this.draw();
  }

  private draw(): void {
    const { x, y } = this.chart.scales();
    const from = this.from;
    const spokes = from ? this.spokes : [];
    this.layer
      .selectAll<SVGLineElement, Spoke>('line.sg-spoke')
      .data(spokes, (d) => d.group)
      .join('line')
      .attr('class', 'sg-spoke')
      .attr('x1', from ? x(from.x) : 0)
      .attr('y1', from ? y(from.y) : 0)
      .attr('x2', (d) => x(d.to.x))
      .attr('y2', (d) => y(d.to.y))
      .style('stroke', (d) => `var(--sg-group-${d.group}, currentColor)`)
      .style('stroke-width', (d) => `${d.width}px`);
    this.layer
      .selectAll<SVGTextElement, Spoke>('text.sg-spoke-label')
      .data(
        spokes.filter((s) => s.share >= LABEL_MIN_SHARE),
        (d) => d.group,
      )
      .join('text')
      .attr('class', 'sg-spoke-label')
      .attr('x', (d) => x(d.to.x))
      .attr('y', (d) => y(d.to.y))
      .attr('dy', '0.35em')
      .attr('text-anchor', 'middle')
      .text((d) => d.label);

    const links = (this.link ? [this.link] : []).filter(
      (d) => Math.hypot(x(d.a.x) - x(d.b.x), y(d.a.y) - y(d.b.y)) >= LINK_MIN_PX,
    );
    this.layer
      .selectAll<SVGLineElement, Link>('line.sg-duel-link')
      .data(links)
      .join('line')
      .attr('class', 'sg-duel-link')
      .attr('x1', (d) => x(d.a.x))
      .attr('y1', (d) => y(d.a.y))
      .attr('x2', (d) => x(d.b.x))
      .attr('y2', (d) => y(d.b.y));
    this.layer
      .selectAll<SVGTextElement, Link>('text.sg-duel-label')
      .data(links)
      .join('text')
      .attr('class', 'sg-duel-label')
      .attr('x', (d) => (x(d.a.x) + x(d.b.x)) / 2)
      .attr('y', (d) => (y(d.a.y) + y(d.b.y)) / 2 - 8)
      .attr('text-anchor', 'middle')
      .text((d) => d.label);
  }
}
