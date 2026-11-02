/**
 * Rendu SVG du Saint-Graphique avec D3 : quadrants, grille, axes, diagonale, disques PCS,
 * barycentre de la population, ellipses de confiance, losanges des électorats et libellés.
 *
 * - Transitions animées entre deux états (élection, méthode, poids), désactivées si
 *   l'utilisateur préfère réduire les animations.
 * - Zoom et déplacement « sémantiques » : les positions sont recalculées, la taille des repères
 *   est conservée (Ctrl + molette, pincement, double-clic, ou boutons de l'interface).
 * - Infobulle accessible au survol, au toucher et au focus ; navigation au clavier entre les
 *   repères avec les flèches (tabindex itinérant).
 */
import { scaleLinear, type ScaleLinear } from 'd3-scale';
import { select, type BaseType, type Selection } from 'd3-selection';
import 'd3-transition';
import {
  zoom,
  zoomIdentity,
  type D3ZoomEvent,
  type ZoomBehavior,
  type ZoomTransform,
} from 'd3-zoom';
import { formatNumber, formatPct } from '../core/format.ts';
import { formatStatus, type ValueStatus } from '../core/reserves.ts';
import type { Ellipse, Point } from '../core/types.ts';
import { placeLabels, type Anchor, type LabelItem, type Obstacle, type Segment } from './labels.ts';
import { clamp, diamondPath } from './shapes.ts';
import { CHART_STYLE, CHART_TEXT } from './style.ts';
import { Tooltip, type TooltipContent } from './tooltip.ts';

export interface ChartPcs {
  code: string;
  group: string;
  label: string;
  short: string;
  groupLabel: string;
  /** Couleur de repli si le thème ne définit pas --sg-group-<groupe>. */
  color: string;
  x: number;
  y: number;
  /** Part de la population (%). */
  weight: number;
  /** Statut des valeurs qui fondent l'axe X ; null si la position n'en dépend pas (position lue). */
  status: { patrimoine: ValueStatus; niveauVie: ValueStatus } | null;
  /** Réserves propres à cette PCS (ex æquo), affichées dans l'infobulle. */
  notes: string[];
}

export interface ChartCandidate {
  id: string;
  label: string;
  color: string;
  x: number;
  y: number;
  /** Score national (%), ou null s'il est inconnu. */
  share: number | null;
  isAbstention: boolean;
  ellipse: Ellipse | null;
  /** Composition sociale de l'électorat, si les données brutes sont disponibles. */
  composition: { label: string; share: number }[] | null;
}

export interface ChartModel {
  /** Titre accessible du graphique. */
  title: string;
  description: string;
  xLabel: string;
  yLabel: string;
  range: [number, number];
  pcs: ChartPcs[];
  candidates: ChartCandidate[];
  barycenter: Point | null;
}

export interface ChartView {
  hiddenGroups: ReadonlySet<string>;
  hiddenCandidates: ReadonlySet<string>;
  showLabels: boolean;
  showEllipses: boolean;
}

export type Animation = 'none' | 'fast' | 'normal';
export type Scale = ScaleLinear<number, number>;

export interface ChartGeometry {
  width: number;
  height: number;
  /** Côté de la zone de tracé carrée (px). */
  side: number;
  /** Position de la zone de tracé dans le SVG. */
  left: number;
  top: number;
  small: boolean;
}

interface Quadrant {
  k: 'tl' | 'tr' | 'bl' | 'br';
  x: number;
  y: number;
  w: number;
  h: number;
}

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

interface Tick {
  key: string;
  value: number;
  pos: number;
  text: string;
}

type G = Selection<SVGGElement, unknown, null, undefined>;

/** Applique des attributs, en transition si `duration` > 0, immédiatement sinon. */
function setAttrs<E extends BaseType, D, P extends BaseType, PD>(
  sel: Selection<E, D, P, PD>,
  duration: number,
  attrs: Record<string, (d: D) => string | number>,
): void {
  if (duration > 0) {
    const t = sel.transition('sg-move').duration(duration);
    for (const [name, value] of Object.entries(attrs)) t.attr(name, value);
  } else {
    sel.interrupt('sg-move');
    for (const [name, value] of Object.entries(attrs)) sel.attr(name, value);
  }
}

/** Fait disparaître des éléments sortants (ils ne sont plus sélectionnés pendant le fondu). */
function exitSel<E extends Element, D, P extends BaseType, PD>(
  sel: Selection<E, D, P, PD>,
  cls: string,
  duration: number,
): void {
  sel.classed(cls, false).classed('sg-exiting', true).attr('tabindex', null);
  if (duration > 0) {
    sel
      .interrupt('sg-move')
      .transition('sg-exit')
      .duration(duration * 0.6)
      .attr('opacity', 0)
      .remove();
  } else {
    sel.remove();
  }
}

function tickDigits(ticks: readonly number[]): number {
  if (ticks.length < 2) return 0;
  const step = Math.abs((ticks[1] ?? 0) - (ticks[0] ?? 0));
  return step >= 1 || step === 0 ? 0 : Math.ceil(-Math.log10(step) - 1e-9);
}

let instances = 0;

export class SaintChart {
  readonly element: HTMLDivElement;
  readonly svg: SVGSVGElement;
  private readonly svgSel: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly titleEl: SVGTitleElement;
  private readonly descEl: SVGDescElement;
  private readonly clipRect: Selection<SVGRectElement, unknown, null, undefined>;
  private readonly plot: G;
  private readonly bg: Selection<SVGRectElement, unknown, null, undefined>;
  private readonly frame: Selection<SVGRectElement, unknown, null, undefined>;
  private readonly quads: G;
  private readonly grid: G;
  private readonly diagonal: Selection<SVGLineElement, unknown, null, undefined>;
  private readonly below: G;
  private readonly ellipseLayer: G;
  private readonly pcsLayer: G;
  private readonly baryLayer: G;
  private readonly candLayer: G;
  private readonly leaderLayer: G;
  private readonly labelLayer: G;
  private readonly axes: G;
  private readonly above: G;
  private readonly tooltip: Tooltip;
  private readonly zoomBehavior: ZoomBehavior<SVGGElement, unknown>;
  private readonly listeners = new Set<() => void>();
  private readonly pointEls = new Map<string, SVGElement>();
  private readonly resizeObserver: ResizeObserver | null = null;
  private readonly reducedMotion: MediaQueryList | null;
  private transform: ZoomTransform = zoomIdentity;
  private model: ChartModel | null = null;
  private view: ChartView = {
    hiddenGroups: new Set(),
    hiddenCandidates: new Set(),
    showLabels: true,
    showEllipses: true,
  };
  private geom: ChartGeometry = { width: 0, height: 0, side: 0, left: 0, top: 0, small: false };
  private pcsOrder: string[] = [];
  private candOrder: string[] = [];
  private focusedKey: string | null = null;
  private hoverKey: string | null = null;
  private measureCtx: CanvasRenderingContext2D | null | undefined;
  private readonly textWidths = new Map<string, number>();
  private zooming = false;
  private fontFamily = 'sans-serif';

  constructor(host: HTMLElement) {
    const id = ++instances;
    this.element = document.createElement('div');
    this.element.className = 'sg-chart';
    host.append(this.element);

    this.svgSel = select(this.element)
      .append('svg')
      .attr('class', 'sg-svg')
      .attr('role', 'group')
      .attr('aria-labelledby', `sg-chart-title-${id}`)
      .attr('aria-describedby', `sg-chart-desc-${id}`);
    const svg = this.svgSel.node();
    if (!svg) throw new Error('Création du SVG impossible');
    this.svg = svg;
    this.titleEl = this.svgSel
      .append<SVGTitleElement>('title')
      .attr('id', `sg-chart-title-${id}`)
      .node()!;
    this.descEl = this.svgSel
      .append<SVGDescElement>('desc')
      .attr('id', `sg-chart-desc-${id}`)
      .node()!;
    const clipId = `sg-clip-${id}`;
    this.clipRect = this.svgSel.append('defs').append('clipPath').attr('id', clipId).append('rect');

    const clip = `url(#${clipId})`;
    this.plot = this.svgSel.append('g').attr('class', 'sg-plot');
    this.bg = this.plot.append('rect').attr('class', 'sg-plot-bg');
    this.quads = this.plot.append('g').attr('class', 'sg-quadrants').attr('clip-path', clip);
    this.grid = this.plot.append('g').attr('class', 'sg-grid').attr('clip-path', clip);
    this.diagonal = this.plot
      .append('line')
      .attr('class', 'sg-diagonal')
      .attr('clip-path', clip)
      .attr('aria-hidden', 'true');
    this.below = this.plot.append('g').attr('class', 'sg-layer-below').attr('clip-path', clip);
    const marks = this.plot.append('g').attr('class', 'sg-marks').attr('clip-path', clip);
    this.ellipseLayer = marks.append('g').attr('class', 'sg-ellipses').attr('aria-hidden', 'true');
    this.pcsLayer = marks
      .append('g')
      .attr('class', 'sg-pcs-layer')
      .attr('role', 'group')
      .attr('aria-label', 'Catégories socioprofessionnelles');
    this.baryLayer = marks.append('g').attr('class', 'sg-bary-layer');
    this.candLayer = marks
      .append('g')
      .attr('class', 'sg-cand-layer')
      .attr('role', 'group')
      .attr('aria-label', 'Électorats');
    this.leaderLayer = this.plot
      .append('g')
      .attr('class', 'sg-leaders')
      .attr('clip-path', clip)
      .attr('aria-hidden', 'true');
    this.labelLayer = this.plot
      .append('g')
      .attr('class', 'sg-labels')
      .attr('clip-path', clip)
      .attr('aria-hidden', 'true');
    this.frame = this.plot
      .append('rect')
      .attr('class', 'sg-plot-frame')
      .attr('aria-hidden', 'true');
    this.axes = this.plot.append('g').attr('class', 'sg-axes').attr('aria-hidden', 'true');
    this.above = this.plot.append('g').attr('class', 'sg-layer-above');

    this.tooltip = new Tooltip(this.element);
    this.bindInteractions();

    this.zoomBehavior = zoom<SVGGElement, unknown>()
      .scaleExtent(CHART_STYLE.zoomExtent)
      .filter((event: Event) => this.zoomFilter(event))
      .on('start', () => {
        this.zooming = true;
      })
      .on('end', () => {
        // Le placement complet des libellés est refait quand le geste est fini.
        this.zooming = false;
        this.draw('fast');
      })
      .on('zoom', (event: D3ZoomEvent<SVGGElement, unknown>) => {
        this.transform = event.transform;
        // Une fois zoomé, un doigt déplace le graphique ; sinon il fait défiler la page.
        this.svgSel.style('touch-action', event.transform.k > 1 ? 'none' : 'pan-y');
        this.clearHover();
        this.draw('none');
      });
    this.plot.call(this.zoomBehavior);

    this.reducedMotion =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.onResize());
      this.resizeObserver.observe(this.element);
    }
    this.computeGeometry();
  }

  /** Met à jour le graphique. */
  update(model: ChartModel, view: ChartView, animation: Animation = 'normal'): void {
    const rangeChanged =
      this.model !== null &&
      (this.model.range[0] !== model.range[0] || this.model.range[1] !== model.range[1]);
    this.model = model;
    this.view = view;
    if (rangeChanged) {
      this.transform = zoomIdentity;
      this.plot.property('__zoom', zoomIdentity);
    }
    this.clearHover();
    this.draw(animation);
  }

  /** Échelles courantes (zoom compris), données → px dans la zone de tracé. */
  scales(): { x: Scale; y: Scale } {
    const [lo, hi] = this.model?.range ?? [-10, 10];
    const pad = (hi - lo) * CHART_STYLE.domainPadding;
    const side = this.geom.side;
    const x = scaleLinear()
      .domain([lo - pad, hi + pad])
      .range([0, side]);
    const y = scaleLinear()
      .domain([lo - pad, hi + pad])
      .range([side, 0]);
    return { x: this.transform.rescaleX(x), y: this.transform.rescaleY(y) };
  }

  get geometry(): ChartGeometry {
    return { ...this.geom };
  }

  get zoomLevel(): number {
    return this.transform.k;
  }

  /** Calque SVG sous les repères (coordonnées de la zone de tracé, découpé). */
  get layerBelow(): SVGGElement {
    return this.below.node()!;
  }

  /** Calque SVG au-dessus de tout (coordonnées de la zone de tracé, non découpé). */
  get layerAbove(): SVGGElement {
    return this.above.node()!;
  }

  /** Appelé après chaque rendu (zoom, redimensionnement, mise à jour). */
  onRender(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  zoomBy(factor: number): void {
    const d = this.duration('fast');
    if (d > 0) this.zoomBehavior.scaleBy(this.plot.transition().duration(d * 1.5), factor);
    else this.zoomBehavior.scaleBy(this.plot, factor);
  }

  resetZoom(animated = true): void {
    const d = animated ? this.duration('fast') : 0;
    if (d > 0) {
      this.zoomBehavior.transform(this.plot.transition().duration(d * 1.5), zoomIdentity);
    } else {
      this.transform = zoomIdentity;
      this.zoomBehavior.transform(this.plot, zoomIdentity);
    }
  }

  /** Coordonnées de données d'un point écran ; null hors de la zone de tracé. */
  clientToData(clientX: number, clientY: number): Point | null {
    const ctm = this.plot.node()?.getScreenCTM();
    if (!ctm) return null;
    const px = (clientX - ctm.e) / ctm.a;
    const py = (clientY - ctm.f) / ctm.d;
    const { side } = this.geom;
    if (px < 0 || py < 0 || px > side || py > side) return null;
    const { x, y } = this.scales();
    return { x: x.invert(px), y: y.invert(py) };
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.listeners.clear();
    this.element.remove();
  }

  // --- Géométrie --------------------------------------------------------------------------

  private computeGeometry(): void {
    const width = Math.max(260, Math.round(this.element.clientWidth || 640));
    const small = width < CHART_STYLE.smallWidth;
    const m = small ? CHART_STYLE.marginSmall : CHART_STYLE.margin;
    const side = Math.max(180, Math.min(CHART_STYLE.maxPlot, width - m.left - m.right));
    const left = m.left + Math.max(0, (width - m.left - m.right - side) / 2);
    const height = side + m.top + m.bottom;
    this.geom = { width, height, side, left, top: m.top, small };
    this.svgSel
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`);
    this.plot.attr('transform', `translate(${left},${m.top})`);
    this.clipRect.attr('width', side).attr('height', side);
    this.zoomBehavior
      .extent([
        [0, 0],
        [side, side],
      ])
      .translateExtent([
        [0, 0],
        [side, side],
      ]);
  }

  private onResize(): void {
    const width = Math.round(this.element.clientWidth);
    if (width === 0 || Math.abs(width - this.geom.width) < 1) return;
    this.computeGeometry();
    this.clearHover();
    this.resetZoom(false);
  }

  private duration(animation: Animation): number {
    if (animation === 'none' || this.reducedMotion?.matches) return 0;
    return CHART_STYLE.durations[animation];
  }

  private zoomFilter(event: Event): boolean {
    if (event.type === 'wheel') {
      const w = event as WheelEvent;
      return w.ctrlKey || w.metaKey;
    }
    if (event.type === 'touchstart') {
      return (event as TouchEvent).touches.length > 1 || this.transform.k > 1;
    }
    return !(event as MouseEvent).button;
  }

  private pcsRadius(d: ChartPcs): number {
    const r = CHART_STYLE.pcsRadiusPerSqrtPct * this.geom.side * Math.sqrt(Math.max(0, d.weight));
    return Math.max(CHART_STYLE.pcsMinRadius, r);
  }

  private candHalf(d: ChartCandidate): number {
    const share = d.share ?? CHART_STYLE.candidateDefaultShare;
    const h =
      CHART_STYLE.candidateHalfDiagonalPerSqrtPct * this.geom.side * Math.sqrt(Math.max(0, share));
    return Math.max(CHART_STYLE.candidateMinHalfDiagonal, h);
  }

  // --- Rendu --------------------------------------------------------------------------------

  private draw(animation: Animation): void {
    const model = this.model;
    if (!model) return;
    const { x, y } = this.scales();
    const duration = this.duration(animation);
    this.titleEl.textContent = model.title;
    this.descEl.textContent = model.description;
    this.fontFamily = getComputedStyle(this.svg).fontFamily || 'sans-serif';

    const pcs = model.pcs
      .filter((p) => !this.view.hiddenGroups.has(p.group))
      .sort((a, b) => b.weight - a.weight);
    const cands = model.candidates
      .filter((c) => !this.view.hiddenCandidates.has(c.id))
      .sort((a, b) => (b.share ?? 0) - (a.share ?? 0));

    this.drawFrame(x, y, model);
    this.drawEllipses(this.view.showEllipses ? cands.filter((c) => c.ellipse) : [], x, y, duration);
    this.drawPcs(pcs, x, y, duration);
    this.drawBarycenter(model.barycenter, x, y, duration);
    this.drawCandidates(cands, x, y, duration);
    this.drawLabels(
      this.view.showLabels ? pcs : [],
      this.view.showLabels ? cands : [],
      x,
      y,
      duration,
    );
    this.updateFocusOrder(pcs, cands);
    for (const cb of this.listeners) cb();
  }

  private drawFrame(x: Scale, y: Scale, model: ChartModel): void {
    const { side, small } = this.geom;
    this.bg.attr('width', side).attr('height', side);
    this.frame.attr('width', side).attr('height', side);

    const cx = clamp(x(0), 0, side);
    const cy = clamp(y(0), 0, side);
    const quads: Quadrant[] = [
      { k: 'tl', x: 0, y: 0, w: cx, h: cy },
      { k: 'tr', x: cx, y: 0, w: side - cx, h: cy },
      { k: 'bl', x: 0, y: cy, w: cx, h: side - cy },
      { k: 'br', x: cx, y: cy, w: side - cx, h: side - cy },
    ];
    this.quads
      .selectAll<SVGRectElement, Quadrant>('rect')
      .data(quads, (d) => d.k)
      .join('rect')
      .attr('class', (d) => `sg-quadrant sg-quadrant--${d.k}`)
      .attr('x', (d) => d.x)
      .attr('y', (d) => d.y)
      .attr('width', (d) => Math.max(0, d.w))
      .attr('height', (d) => Math.max(0, d.h));

    const count = small ? 4 : CHART_STYLE.ticks;
    const xv = x.ticks(count);
    const yv = y.ticks(count);
    const xd = tickDigits(xv);
    const yd = tickDigits(yv);
    const xt: Tick[] = xv.map((v) => ({
      key: String(v),
      value: v,
      pos: x(v),
      text: formatNumber(v, xd),
    }));
    const yt: Tick[] = yv.map((v) => ({
      key: String(v),
      value: v,
      pos: y(v),
      text: formatNumber(v, yd),
    }));

    this.grid
      .selectAll<SVGLineElement, Tick>('line.sg-grid-x')
      .data(xt, (d) => d.key)
      .join('line')
      .attr('class', (d) => (d.value === 0 ? 'sg-grid-x sg-zero' : 'sg-grid-x'))
      .attr('x1', (d) => d.pos)
      .attr('x2', (d) => d.pos)
      .attr('y1', 0)
      .attr('y2', side);
    this.grid
      .selectAll<SVGLineElement, Tick>('line.sg-grid-y')
      .data(yt, (d) => d.key)
      .join('line')
      .attr('class', (d) => (d.value === 0 ? 'sg-grid-y sg-zero' : 'sg-grid-y'))
      .attr('x1', 0)
      .attr('x2', side)
      .attr('y1', (d) => d.pos)
      .attr('y2', (d) => d.pos);

    const [lo, hi] = model.range;
    this.diagonal.attr('x1', x(lo)).attr('y1', y(lo)).attr('x2', x(hi)).attr('y2', y(hi));

    // Graduations et titres des axes
    const inside = (p: number): boolean => p >= -0.5 && p <= side + 0.5;
    this.axes
      .selectAll<SVGTextElement, Tick>('text.sg-tick-x')
      .data(
        xt.filter((t) => inside(t.pos)),
        (d) => d.key,
      )
      .join('text')
      .attr('class', 'sg-tick sg-tick-x')
      .attr('x', (d) => d.pos)
      .attr('y', side + 16)
      .attr('text-anchor', 'middle')
      .text((d) => d.text);
    this.axes
      .selectAll<SVGTextElement, Tick>('text.sg-tick-y')
      .data(
        yt.filter((t) => inside(t.pos)),
        (d) => d.key,
      )
      .join('text')
      .attr('class', 'sg-tick sg-tick-y')
      .attr('x', -8)
      .attr('y', (d) => d.pos)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .text((d) => d.text);

    const titleY = side + (small ? 38 : 44);
    const yTitleX = small ? -34 : -46;
    const titles = [
      {
        key: 'x',
        cls: 'sg-axis-title',
        x: side / 2,
        y: titleY,
        rotate: 0,
        anchor: 'middle',
        text: model.xLabel,
      },
      {
        key: 'x-lo',
        cls: 'sg-axis-end',
        x: 0,
        y: titleY,
        rotate: 0,
        anchor: 'start',
        text: `← ${CHART_TEXT.xLow}`,
      },
      {
        key: 'x-hi',
        cls: 'sg-axis-end',
        x: side,
        y: titleY,
        rotate: 0,
        anchor: 'end',
        text: `${CHART_TEXT.xHigh} →`,
      },
      {
        key: 'y',
        cls: 'sg-axis-title',
        x: yTitleX,
        y: side / 2,
        rotate: -90,
        anchor: 'middle',
        text: model.yLabel,
      },
      {
        key: 'y-lo',
        cls: 'sg-axis-end',
        x: yTitleX,
        y: side,
        rotate: -90,
        anchor: 'start',
        text: `← ${CHART_TEXT.yLow}`,
      },
      {
        key: 'y-hi',
        cls: 'sg-axis-end',
        x: yTitleX,
        y: 0,
        rotate: -90,
        anchor: 'end',
        text: `${CHART_TEXT.yHigh} →`,
      },
    ];
    this.axes
      .selectAll<SVGTextElement, (typeof titles)[number]>('text.sg-axis-label')
      .data(titles, (d) => d.key)
      .join('text')
      .attr('class', (d) => `sg-axis-label ${d.cls}`)
      .attr('text-anchor', (d) => d.anchor)
      .attr('transform', (d) => `translate(${d.x},${d.y}) rotate(${d.rotate})`)
      .attr('dy', (d) => (d.rotate === 0 ? '0' : '0.35em'))
      .text((d) => d.text);
  }

  private drawEllipses(data: ChartCandidate[], x: Scale, y: Scale, duration: number): void {
    const k = Math.abs(x(1) - x(0));
    const transform = (d: ChartCandidate): string =>
      `translate(${x(d.x)},${y(d.y)}) rotate(${-(d.ellipse?.angle_deg ?? 0)})`;
    const sel = this.ellipseLayer
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
    all.style('stroke', (d) => this.candidateFill(d)).style('fill', (d) => this.candidateFill(d));
    setAttrs(all, duration, {
      transform,
      rx: (d) => (d.ellipse?.rx ?? 0) * k,
      ry: (d) => (d.ellipse?.ry ?? 0) * k,
    });
  }

  private drawPcs(data: ChartPcs[], x: Scale, y: Scale, duration: number): void {
    const sel = this.pcsLayer
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
    const model = this.model;
    all
      .attr('data-key', (d) => `p:${d.code}`)
      .attr(
        'aria-label',
        (d) =>
          `${d.label} (${d.groupLabel}) : ${formatPct(d.weight)} de la population, ` +
          `${model?.xLabel ?? 'x'} ${formatNumber(d.x)}, ${model?.yLabel ?? 'y'} ${formatNumber(d.y)}` +
          (d.status
            ? `, patrimoine : ${formatStatus(d.status.patrimoine)}` +
              `, niveau de vie : ${formatStatus(d.status.niveauVie)}`
            : ''),
      )
      .style('fill', (d) => `var(--sg-group-${d.group}, ${d.color})`);
    setAttrs(all, duration, {
      cx: (d) => x(d.x),
      cy: (d) => y(d.y),
      r: (d) => this.pcsRadius(d),
    });
  }

  private drawBarycenter(b: Point | null, x: Scale, y: Scale, duration: number): void {
    const sel = this.baryLayer.selectAll<SVGGElement, Point>('g.sg-bary').data(b ? [b] : []);
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
    const model = this.model;
    all.attr(
      'aria-label',
      (d) =>
        `Barycentre de la population : ${model?.xLabel ?? 'x'} ${formatNumber(d.x)}, ` +
        `${model?.yLabel ?? 'y'} ${formatNumber(d.y)}`,
    );
    all
      .select('circle.sg-bary__ring')
      .attr('r', Math.max(8, this.geom.side * CHART_STYLE.barycenterRadius));
    setAttrs(all, duration, { transform });
  }

  private candidateFill(d: ChartCandidate): string {
    return d.isAbstention ? `var(--sg-abstention, ${d.color})` : d.color;
  }

  private drawCandidates(data: ChartCandidate[], x: Scale, y: Scale, duration: number): void {
    const transform = (d: ChartCandidate): string => `translate(${x(d.x)},${y(d.y)})`;
    const sel = this.candLayer
      .selectAll<SVGPathElement, ChartCandidate>('path.sg-cand')
      .data(data, (d) => d.id);
    exitSel(sel.exit<ChartCandidate>(), 'sg-cand', duration);
    const entered = sel
      .enter()
      .append('path')
      .attr('class', 'sg-cand sg-point')
      .attr('role', 'img')
      .attr('tabindex', -1)
      .attr('transform', transform)
      .attr('d', diamondPath(0));
    const all = entered.merge(sel).order();
    const model = this.model;
    all
      .attr('data-key', (d) => `c:${d.id}`)
      .attr(
        'aria-label',
        (d) =>
          `${d.label}${d.share !== null ? ` : ${formatPct(d.share)}` : ''}, ` +
          `${model?.xLabel ?? 'x'} ${formatNumber(d.x)}, ${model?.yLabel ?? 'y'} ${formatNumber(d.y)}`,
      )
      .classed('sg-cand--abstention', (d) => d.isAbstention)
      .style('fill', (d) => this.candidateFill(d));
    setAttrs(all, duration, {
      transform,
      d: (d) => diamondPath(this.candHalf(d)),
    });
  }

  private measure = (text: string, font: number, weight: number): number => {
    const key = `${weight}|${font}|${this.fontFamily}|${text}`;
    const known = this.textWidths.get(key);
    if (known !== undefined) return known;
    const width = this.measureText(text, font, weight);
    this.textWidths.set(key, width);
    return width;
  };

  private measureText(text: string, font: number, weight: number): number {
    if (this.measureCtx === undefined) {
      try {
        this.measureCtx = document.createElement('canvas').getContext('2d');
      } catch {
        this.measureCtx = null;
      }
    }
    const ctx = this.measureCtx;
    if (!ctx) return text.length * font * (weight >= 600 ? 0.6 : 0.55);
    ctx.font = `${weight} ${font}px ${this.fontFamily}`;
    return ctx.measureText(text).width;
  }

  private drawLabels(
    pcs: ChartPcs[],
    cands: ChartCandidate[],
    x: Scale,
    y: Scale,
    duration: number,
  ): void {
    const { side, small } = this.geom;
    const inPlot = (px: number, py: number): boolean =>
      px >= 0 && px <= side && py >= 0 && py <= side;
    const candFont = small ? CHART_STYLE.candidateLabelFontSmall : CHART_STYLE.candidateLabelFont;
    const pcsFont = small ? CHART_STYLE.labelFontSmall : CHART_STYLE.labelFont;

    const obstacles: Obstacle[] = [
      ...this.model!.pcs.filter((p) => !this.view.hiddenGroups.has(p.group)).map((p) => ({
        key: `p:${p.code}`,
        cx: x(p.x),
        cy: y(p.y),
        r: this.pcsRadius(p),
      })),
      ...this.model!.candidates.filter((c) => !this.view.hiddenCandidates.has(c.id)).map((c) => ({
        key: `c:${c.id}`,
        cx: x(c.x),
        cy: y(c.y),
        r: this.candHalf(c) * 0.85,
        strong: true,
      })),
    ];
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
        r: this.candHalf(c) * 0.85,
        priority: 1000 + (c.share ?? 0),
        font: candFont,
        weight: 650,
        reach: small ? CHART_STYLE.candidateLabelReachSmall : CHART_STYLE.candidateLabelReach,
      });
    }
    for (const p of pcs) {
      const cx = x(p.x);
      const cy = y(p.y);
      if (!inPlot(cx, cy)) continue;
      items.push({
        key: `p:${p.code}`,
        text: p.short,
        cx,
        cy,
        r: this.pcsRadius(p),
        priority: p.weight,
        font: pcsFont,
        weight: 400,
        reach: small ? CHART_STYLE.pcsLabelReachSmall : CHART_STYLE.pcsLabelReach,
      });
    }
    const placed = placeLabels(items, obstacles, { x: 0, y: 0, w: side, h: side }, this.measure, {
      passes: this.zooming ? 0 : CHART_STYLE.labelPasses,
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

    const leaders = this.leaderLayer.selectAll<SVGLineElement, LabelDatum>('line.sg-leader').data(
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
    setAttrs(enteredLeaders.merge(leaders), duration, {
      x1: (d) => d.leader?.x1 ?? 0,
      y1: (d) => d.leader?.y1 ?? 0,
      x2: (d) => d.leader?.x2 ?? 0,
      y2: (d) => d.leader?.y2 ?? 0,
    });

    const sel = this.labelLayer
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

  // --- Interaction ------------------------------------------------------------------------

  /**
   * Écouteurs natifs délégués sur la zone de tracé : le survol vise le repère le plus proche
   * (zone utile bien plus grande que les petits disques), le clavier passe par le focus natif.
   */
  private bindInteractions(): void {
    const root = this.plot.node();
    if (!root) return;
    root.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || e.buttons !== 0) return;
      const key = this.keyNearPointer(e);
      if (key) this.showKey(key);
      else if (this.hoverKey) this.clearHover();
    });
    root.addEventListener('pointerleave', () => this.clearHover());
    root.addEventListener('click', (e) => {
      const key = this.keyNearPointer(e);
      if (key) this.showKey(key);
      else this.clearHover();
    });
    root.addEventListener('focusin', (e) => {
      const el = e.target instanceof Element ? e.target.closest<SVGElement>('[data-key]') : null;
      const key = el?.getAttribute('data-key');
      if (!key) return;
      this.focusedKey = key;
      this.applyRoving();
      this.showKey(key);
    });
    root.addEventListener('focusout', () => this.clearHover());
    root.addEventListener('keydown', (e) => {
      const el = e.target instanceof Element ? e.target.closest<SVGElement>('[data-key]') : null;
      const key = el?.getAttribute('data-key');
      if (e.key === 'Escape') this.clearHover();
      else if (key) this.onPointKey(e, key);
    });
  }

  /** Repère visé par le pointeur : à moins de hoverRadius px, le plus proche, puis le plus petit. */
  private keyNearPointer(e: MouseEvent): string | null {
    const model = this.model;
    const ctm = this.plot.node()?.getScreenCTM();
    if (!model || !ctm) return null;
    const px = (e.clientX - ctm.e) / ctm.a;
    const py = (e.clientY - ctm.f) / ctm.d;
    const { side } = this.geom;
    if (px < 0 || py < 0 || px > side || py > side) return null;
    const { x, y } = this.scales();
    let best: string | null = null;
    let bestGap = Number.POSITIVE_INFINITY;
    let bestSize = Number.POSITIVE_INFINITY;
    const consider = (key: string, cx: number, cy: number, r: number): void => {
      const gap = Math.max(0, Math.hypot(px - cx, py - cy) - r);
      if (gap > CHART_STYLE.hoverRadius) return;
      if (gap < bestGap || (gap === bestGap && r < bestSize)) {
        best = key;
        bestGap = gap;
        bestSize = r;
      }
    };
    for (const p of model.pcs) {
      if (!this.view.hiddenGroups.has(p.group)) {
        consider(`p:${p.code}`, x(p.x), y(p.y), this.pcsRadius(p));
      }
    }
    for (const c of model.candidates) {
      if (!this.view.hiddenCandidates.has(c.id)) {
        consider(`c:${c.id}`, x(c.x), y(c.y), this.candHalf(c) * 0.75);
      }
    }
    if (best === null && model.barycenter) {
      const ring = Math.max(8, side * CHART_STYLE.barycenterRadius);
      const d = Math.hypot(px - x(model.barycenter.x), py - y(model.barycenter.y));
      if (Math.abs(d - ring) <= 4) best = 'bary';
    }
    return best;
  }

  private tipFor(key: string): TooltipContent | null {
    const model = this.model;
    if (!model) return null;
    if (key === 'bary') return model.barycenter ? this.baryTip(model.barycenter) : null;
    if (key.startsWith('p:')) {
      const d = model.pcs.find((p) => `p:${p.code}` === key);
      return d ? this.pcsTip(d) : null;
    }
    const d = model.candidates.find((c) => `c:${c.id}` === key);
    return d ? this.candTip(d) : null;
  }

  private showKey(key: string): void {
    if (key === this.hoverKey && this.tooltip.visible) return;
    const el = this.pointEls.get(key);
    const content = this.tipFor(key);
    if (!el || !content) return;
    this.pointEls.get(this.hoverKey ?? '')?.classList.remove('sg-point--active');
    el.classList.add('sg-point--active');
    this.hoverKey = key;
    const host = this.element.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    this.tooltip.show(
      content,
      {
        left: r.left - host.left,
        right: r.right - host.left,
        top: r.top - host.top,
        bottom: r.bottom - host.top,
      },
      el,
    );
  }

  /** Masque l'infobulle et la surbrillance. */
  clearHover(): void {
    this.pointEls.get(this.hoverKey ?? '')?.classList.remove('sg-point--active');
    this.hoverKey = null;
    this.tooltip.hide();
  }

  private onPointKey(event: KeyboardEvent, key: string): void {
    const order = key.startsWith('p:') ? this.pcsOrder : key.startsWith('c:') ? this.candOrder : [];
    const i = order.indexOf(key);
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = i + 1;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = i - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = order.length - 1;
        break;
      default:
        return;
    }
    if (order.length === 0) return;
    event.preventDefault();
    const target = order[clamp(next, 0, order.length - 1)];
    if (target) this.pointEls.get(target)?.focus();
  }

  private updateFocusOrder(pcs: ChartPcs[], cands: ChartCandidate[]): void {
    this.pointEls.clear();
    this.plot.selectAll<SVGElement, unknown>('.sg-point').each((_d, i, nodes) => {
      const el = nodes[i];
      const key = el?.getAttribute('data-key');
      if (el && key && !el.classList.contains('sg-exiting')) this.pointEls.set(key, el);
    });
    const byXY = (a: Point, b: Point): number => a.x - b.x || b.y - a.y;
    this.pcsOrder = [...pcs].sort(byXY).map((p) => `p:${p.code}`);
    this.candOrder = [...cands].sort(byXY).map((c) => `c:${c.id}`);
    this.applyRoving();
  }

  /** Un seul repère par groupe est atteignable par Tab ; les flèches parcourent le groupe. */
  private applyRoving(): void {
    for (const order of [this.pcsOrder, this.candOrder]) {
      const current =
        this.focusedKey && order.includes(this.focusedKey) ? this.focusedKey : order[0];
      for (const key of order) {
        this.pointEls.get(key)?.setAttribute('tabindex', key === current ? '0' : '-1');
      }
    }
  }

  private pcsTip(d: ChartPcs): TooltipContent {
    const m = this.model;
    return {
      title: d.label,
      subtitle: `${d.groupLabel} · code ${d.code}`,
      rows: [
        ['Part de la population', formatPct(d.weight)],
        [m?.xLabel ?? 'x', formatNumber(d.x)],
        [m?.yLabel ?? 'y', formatNumber(d.y)],
        ...(d.status
          ? ([
              ['Patrimoine', formatStatus(d.status.patrimoine)],
              ['Niveau de vie', formatStatus(d.status.niveauVie)],
            ] as [string, string][])
          : []),
      ],
      notes: d.notes,
    };
  }

  private candTip(d: ChartCandidate): TooltipContent {
    const m = this.model;
    const content: TooltipContent = {
      title: d.label,
      rows: [
        ...(d.share !== null
          ? [
              [d.isAbstention ? 'Part des inscrits' : 'Score', formatPct(d.share)] as [
                string,
                string,
              ],
            ]
          : []),
        [m?.xLabel ?? 'x', formatNumber(d.x)],
        [m?.yLabel ?? 'y', formatNumber(d.y)],
      ],
    };
    if (d.ellipse && this.view.showEllipses) {
      content.subtitle = 'Ellipse : intervalle de confiance à 95 %';
    }
    if (d.composition && d.composition.length > 0) {
      content.barsTitle = 'Composition de l’électorat';
      content.bars = d.composition.map((c) => ({
        label: c.label,
        value: c.share,
        display: formatPct(c.share, 0),
      }));
    }
    return content;
  }

  private baryTip(d: Point): TooltipContent {
    const m = this.model;
    return {
      title: 'Barycentre de la population',
      subtitle: 'Moyenne des PCS pondérée par leurs effectifs',
      rows: [
        [m?.xLabel ?? 'x', formatNumber(d.x)],
        [m?.yLabel ?? 'y', formatNumber(d.y)],
      ],
    };
  }
}
