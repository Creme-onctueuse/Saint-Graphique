/**
 * Projection 2027 sur la carte : pour chaque famille, une flèche de « rien ne bouge » à « la tendance
 * continue » et un petit losange vide sur le scénario non affiché. Le cercle en pointillés, de rayon
 * égal à son erreur moyenne dans le test sur le passé, n'apparaît qu'à la demande ou pour le parti
 * sélectionné : à côté d'une bulle, une zone se lirait comme une taille. L'étirement de la carte en
 * fait une ellipse : son rayon reste exact sur chaque axe.
 */
import { select, type Selection } from 'd3-selection';
import 'd3-transition';
import {
  scenarioError,
  scenarioPoint,
  type ProjectedFamily,
  type ProjectionFile,
} from '../../core/projection.ts';
import type { AppState, Scenario } from '../../core/state.ts';
import type { Feature } from '../../ui/actions.ts';
import type { ResolvedView } from '../../view.ts';
import type { SaintChart } from '../chart.ts';
import { diamondPath } from '../shapes.ts';
import { CHART_STYLE } from '../style.ts';

const ARROW_HEAD = 7;
const GHOST_SIZE = 5;

function arrowPath(x1: number, y1: number, x2: number, y2: number): string {
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (length < 1) return '';
  return `M${x1},${y1}L${x2},${y2}`;
}

function arrowHead(x1: number, y1: number, x2: number, y2: number): string {
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (length < ARROW_HEAD) return '';
  const ux = (x2 - x1) / length;
  const uy = (y2 - y1) / length;
  const bx = x2 - ux * ARROW_HEAD;
  const by = y2 - uy * ARROW_HEAD;
  const half = ARROW_HEAD * 0.55;
  return `M${x2},${y2}L${bx - uy * half},${by + ux * half}L${bx + uy * half},${by - ux * half}Z`;
}

export class ProjectionLayer implements Feature {
  private readonly chart: SaintChart;
  private readonly layer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly reducedMotion: MediaQueryList | null;
  private file: ProjectionFile | null = null;
  private scenario: Scenario = 'still';
  private hidden: ReadonlySet<string> = new Set();
  private showErrors = false;
  private selected: ReadonlySet<string> = new Set();

  constructor(chart: SaintChart) {
    this.chart = chart;
    this.layer = select(chart.layerUnder).append('g').attr('class', 'sg-projection');
    this.reducedMotion =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    chart.onRender(() => this.render(0));
  }

  sync(view: ResolvedView, state: AppState): void {
    const changed = this.scenario !== state.scenario;
    this.file = view.projection;
    this.scenario = state.scenario;
    this.hidden = new Set(state.hiddenCandidates);
    this.showErrors = state.showEllipses;
    this.selected = new Set(view.crossing?.keys ?? []);
    const animate = changed && !this.reducedMotion?.matches;
    this.render(animate ? CHART_STYLE.durations.normal : 0);
  }

  private render(duration: number): void {
    const { x, y } = this.chart.scales();
    const kx = Math.abs(x(1) - x(0));
    const ky = Math.abs(y(1) - y(0));
    const scenario = this.scenario;
    const other: Scenario = scenario === 'still' ? 'trend' : 'still';
    const data = (this.file?.families ?? []).filter((f) => !this.hidden.has(f.id));

    const items = this.layer
      .selectAll<SVGGElement, ProjectedFamily>('g.sg-projection-item')
      .data(data, (d) => d.id)
      .join((enter) => {
        const g = enter.append('g').attr('class', 'sg-projection-item');
        g.append('ellipse').attr('class', 'sg-projection-error');
        g.append('path').attr('class', 'sg-projection-arrow');
        g.append('path').attr('class', 'sg-projection-head');
        g.append('path').attr('class', 'sg-projection-ghost');
        return g;
      })
      .attr('data-family', (d) => d.id)
      .style('color', (d) => d.color);

    items
      .select<SVGPathElement>('path.sg-projection-arrow')
      .attr('d', (d) => arrowPath(x(d.still.x), y(d.still.y), x(d.trend.x), y(d.trend.y)));
    items
      .select<SVGPathElement>('path.sg-projection-head')
      .attr('d', (d) => arrowHead(x(d.still.x), y(d.still.y), x(d.trend.x), y(d.trend.y)));
    items
      .select<SVGPathElement>('path.sg-projection-ghost')
      .attr('d', diamondPath(GHOST_SIZE))
      .attr('transform', (d) => {
        const p = scenarioPoint(d, other);
        return `translate(${x(p.x)},${y(p.y)})`;
      });

    const ellipses = items
      .select<SVGEllipseElement>('ellipse.sg-projection-error')
      .style('display', (d) => (this.showErrors || this.selected.has(`c:${d.id}`) ? null : 'none'));
    const cx = (d: ProjectedFamily): number => x(scenarioPoint(d, scenario).x);
    const cy = (d: ProjectedFamily): number => y(scenarioPoint(d, scenario).y);
    const rx = (d: ProjectedFamily): number => kx * scenarioError(d, scenario).position_mean;
    const ry = (d: ProjectedFamily): number => ky * scenarioError(d, scenario).position_mean;
    if (duration > 0) {
      ellipses
        .transition('sg-move')
        .duration(duration)
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('rx', rx)
        .attr('ry', ry);
    } else {
      ellipses.interrupt('sg-move').attr('cx', cx).attr('cy', cy).attr('rx', rx).attr('ry', ry);
    }
  }
}
