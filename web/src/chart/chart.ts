/**
 * Carte plein écran du Saint-Graphique, en SVG avec D3 : décor (frame.ts), territoires, ellipses de
 * confiance, disques PCS, barycentre de la population, losanges des électorats et libellés.
 *
 * - Les échelles X et Y sont indépendantes : la carte remplit l'écran (geometry.ts).
 * - Navigation de carte : molette, glisser, pincement, double-clic, boutons et cadrage.
 * - Zoom « sémantique » : les positions sont recalculées, la taille des repères est conservée.
 * - Transitions animées, désactivées si l'utilisateur préfère réduire les animations.
 * - Infobulle au survol, au toucher et au focus ; flèches du clavier entre les repères (tabindex
 *   itinérant) ; un clic ou Entrée sélectionne un repère (onSelect).
 *
 * Les fonctions de l'application dessinent leurs propres calques dans `layerUnder` et `layerOver`,
 * à l'aide de `scales()` et `onRender()` : ce fichier n'a pas à les connaître.
 */
import { select, type BaseType, type Selection } from 'd3-selection';
import 'd3-transition';
import {
  zoom,
  zoomIdentity,
  type D3ZoomEvent,
  type ZoomBehavior,
  type ZoomTransform,
} from 'd3-zoom';
import { formatPct } from '../core/format.ts';
import { formatStatus } from '../core/reserves.ts';
import type { Point } from '../core/types.ts';
import { drawFrame, type FrameLayers } from './frame.ts';
import {
  baseScales,
  computeGeometry,
  fitTransform,
  type ChartGeometry,
  type Insets,
  type Scale,
} from './geometry.ts';
import { drawTerritories } from './layers/territories.ts';
import { placeLabels, type Anchor, type LabelItem, type Obstacle, type Segment } from './labels.ts';
import { clamp, diamondPath } from './shapes.ts';
import { CHART_STYLE } from './style.ts';
import { baryTip, candTip, coordinatesText, pcsTip } from './tips.ts';
import { Tooltip, type TooltipContent } from './tooltip.ts';
import type { Animation, ChartCandidate, ChartModel, ChartPcs, ChartView } from './types.ts';

export type { Animation, ChartCandidate, ChartModel, ChartPcs, ChartView } from './types.ts';
export type { ChartGeometry, Insets, Scale } from './geometry.ts';

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

/** Zone en coordonnées de données. */
export interface DataBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

type G = Selection<SVGGElement, unknown, null, undefined>;
type SelectListener = (key: string | null, additive: boolean) => void;

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

let instances = 0;

export class SaintChart {
  readonly element: HTMLDivElement;
  readonly svg: SVGSVGElement;
  private readonly svgSel: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly titleEl: SVGTitleElement;
  private readonly descEl: SVGDescElement;
  private readonly plot: G;
  private readonly frameLayers: FrameLayers;
  private readonly below: G;
  private readonly territoryLayer: G;
  private readonly under: G;
  private readonly ellipseLayer: G;
  private readonly pcsLayer: G;
  private readonly baryLayer: G;
  private readonly candLayer: G;
  private readonly over: G;
  private readonly leaderLayer: G;
  private readonly labelLayer: G;
  private readonly above: G;
  private readonly tooltip: Tooltip;
  private readonly zoomBehavior: ZoomBehavior<SVGGElement, unknown>;
  private readonly listeners = new Set<() => void>();
  private readonly selectListeners = new Set<SelectListener>();
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
    showTerritories: true,
    focus: null,
    selected: new Set(),
    square: false,
  };
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private geom: ChartGeometry;
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

    this.plot = this.svgSel.append('g').attr('class', 'sg-plot');
    const bg = this.plot.append('rect').attr('class', 'sg-plot-bg');
    const quads = this.plot.append('g').attr('class', 'sg-quadrants');
    const grid = this.plot.append('g').attr('class', 'sg-grid');
    const diagonal = this.plot
      .append('line')
      .attr('class', 'sg-diagonal')
      .attr('aria-hidden', 'true');
    const regions = this.plot.append('g').attr('class', 'sg-regions').attr('aria-hidden', 'true');
    this.below = this.plot.append('g').attr('class', 'sg-layer-below');
    const marks = this.plot.append('g').attr('class', 'sg-marks');
    this.territoryLayer = marks
      .append('g')
      .attr('class', 'sg-territories')
      .attr('aria-hidden', 'true');
    this.under = marks.append('g').attr('class', 'sg-under').attr('aria-hidden', 'true');
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
    this.over = marks.append('g').attr('class', 'sg-over').attr('aria-hidden', 'true');
    this.leaderLayer = this.plot
      .append('g')
      .attr('class', 'sg-leaders')
      .attr('aria-hidden', 'true');
    this.labelLayer = this.plot.append('g').attr('class', 'sg-labels').attr('aria-hidden', 'true');
    const axes = this.plot.append('g').attr('class', 'sg-axes').attr('aria-hidden', 'true');
    this.above = this.plot.append('g').attr('class', 'sg-layer-above');
    this.frameLayers = { bg, quads, grid, diagonal, axes, regions };

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
    this.geom = this.measureGeometry();
    this.applyGeometry();
  }

  /** Met à jour la carte. */
  update(model: ChartModel, view: ChartView, animation: Animation = 'normal'): void {
    const rangeChanged =
      this.model !== null &&
      (this.model.range[0] !== model.range[0] || this.model.range[1] !== model.range[1]);
    const shapeChanged = view.square !== this.view.square;
    this.model = model;
    this.view = view;
    if (rangeChanged) {
      this.transform = zoomIdentity;
      this.plot.property('__zoom', zoomIdentity);
    }
    if (shapeChanged) {
      this.geom = this.measureGeometry();
      this.applyGeometry();
    }
    this.clearHover();
    this.draw(animation);
  }

  /** Marges réservées par l'interface flottante. La carte glisse pour rester entièrement visible. */
  setInsets(insets: Insets, animation: Animation = 'fast'): void {
    const a = this.insets;
    if (
      a.top === insets.top &&
      a.right === insets.right &&
      a.bottom === insets.bottom &&
      a.left === insets.left
    ) {
      return;
    }
    this.insets = insets;
    this.tooltip.setBounds(insets);
    this.geom = this.measureGeometry();
    this.applyGeometry();
    this.draw(animation);
  }

  /** Échelles courantes (zoom compris), données → px dans le SVG. */
  scales(): { x: Scale; y: Scale } {
    const { x, y } = this.base();
    return { x: this.transform.rescaleX(x), y: this.transform.rescaleY(y) };
  }

  /** Échelles sans le zoom. */
  base(): { x: Scale; y: Scale } {
    return baseScales(this.geom, this.model?.range ?? [-10, 10], CHART_STYLE.domainPadding);
  }

  get geometry(): ChartGeometry {
    return { ...this.geom, plot: { ...this.geom.plot } };
  }

  get currentModel(): ChartModel | null {
    return this.model;
  }

  get zoomLevel(): number {
    return this.transform.k;
  }

  /** Calque de développement sous les repères. */
  get layerBelow(): SVGGElement {
    return this.below.node()!;
  }

  /** Calque de développement au-dessus de tout. */
  get layerAbove(): SVGGElement {
    return this.above.node()!;
  }

  /** Calque de l'application, sous les repères (exporté avec la carte). */
  get layerUnder(): SVGGElement {
    return this.under.node()!;
  }

  /** Calque de l'application, au-dessus des repères (exporté avec la carte). */
  get layerOver(): SVGGElement {
    return this.over.node()!;
  }

  /** Appelé après chaque rendu (zoom, redimensionnement, mise à jour). */
  onRender(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Appelé quand l'utilisateur clique un repère (clé) ou le fond de la carte (null). */
  onSelect(cb: SelectListener): () => void {
    this.selectListeners.add(cb);
    return () => this.selectListeners.delete(cb);
  }

  zoomBy(factor: number): void {
    const d = this.duration('fast');
    if (d > 0) this.zoomBehavior.scaleBy(this.plot.transition().duration(d * 1.5), factor);
    else this.zoomBehavior.scaleBy(this.plot, factor);
  }

  resetZoom(animated = true): void {
    const d = animated ? this.duration('fast') : 0;
    if (d > 0) {
      this.zoomBehavior.transform(this.plot.transition().duration(d * 2), zoomIdentity);
    } else {
      this.transform = zoomIdentity;
      this.zoomBehavior.transform(this.plot, zoomIdentity);
    }
  }

  /** Cadre une zone de données. */
  fitTo(box: DataBox, animated = true): void {
    const { x, y } = this.base();
    const [minK, maxK] = CHART_STYLE.zoomExtent;
    const t = fitTransform(this.geom, x, y, box, minK, maxK);
    const target = zoomIdentity.translate(t.tx, t.ty).scale(t.k);
    const d = animated ? this.duration('normal') : 0;
    if (d > 0) this.zoomBehavior.transform(this.plot.transition().duration(d), target);
    else this.zoomBehavior.transform(this.plot, target);
  }

  /** Cadre les électorats affichés : ils se serrent au centre, et c'est eux qui se déplacent. */
  fitElectorates(animated = true): void {
    const shown = (this.model?.candidates ?? []).filter(
      (c) => !this.view.hiddenCandidates.has(c.id),
    );
    if (shown.length === 0) {
      this.resetZoom(animated);
      return;
    }
    const pad = CHART_STYLE.fitPadding;
    this.fitTo(
      {
        x0: Math.min(...shown.map((c) => c.x)) - pad,
        x1: Math.max(...shown.map((c) => c.x)) + pad,
        y0: Math.min(...shown.map((c) => c.y)) - pad,
        y1: Math.max(...shown.map((c) => c.y)) + pad,
      },
      animated,
    );
  }

  /** Recentre la carte sur un point de données, sans changer le zoom. */
  panTo(point: Point): void {
    const { x, y } = this.base();
    const { plot } = this.geom;
    const k = this.transform.k;
    const target = zoomIdentity
      .translate(plot.x + plot.w / 2 - k * x(point.x), plot.y + plot.h / 2 - k * y(point.y))
      .scale(k);
    const d = this.duration('fast');
    if (d > 0) this.zoomBehavior.transform(this.plot.transition().duration(d * 1.5), target);
    else this.zoomBehavior.transform(this.plot, target);
  }

  /** Coordonnées de données d'un point écran ; null hors de la zone de tracé. */
  clientToData(clientX: number, clientY: number): Point | null {
    const ctm = this.plot.node()?.getScreenCTM();
    if (!ctm) return null;
    const px = (clientX - ctm.e) / ctm.a;
    const py = (clientY - ctm.f) / ctm.d;
    const { plot } = this.geom;
    if (px < plot.x || py < plot.y || px > plot.x + plot.w || py > plot.y + plot.h) return null;
    const { x, y } = this.scales();
    return { x: x.invert(px), y: y.invert(py) };
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.listeners.clear();
    this.selectListeners.clear();
    this.element.remove();
  }

  // --- Géométrie --------------------------------------------------------------------------

  private measureGeometry(): ChartGeometry {
    const width = Math.max(260, Math.round(this.element.clientWidth || 640));
    const height = Math.max(260, Math.round(this.element.clientHeight || 480));
    return computeGeometry(width, height, this.insets, this.view.square, CHART_STYLE);
  }

  private applyGeometry(): void {
    const { width, height } = this.geom;
    this.svgSel
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`);
    this.zoomBehavior
      .extent([
        [0, 0],
        [width, height],
      ])
      .translateExtent([
        [0, 0],
        [width, height],
      ]);
  }

  private onResize(): void {
    const width = Math.round(this.element.clientWidth);
    const height = Math.round(this.element.clientHeight);
    if (width === 0 || height === 0) return;
    if (Math.abs(width - this.geom.width) < 1 && Math.abs(height - this.geom.height) < 1) return;
    this.geom = this.measureGeometry();
    this.applyGeometry();
    this.clearHover();
    this.resetZoom(false);
    this.draw('none');
  }

  private duration(animation: Animation): number {
    if (animation === 'none' || this.reducedMotion?.matches) return 0;
    return CHART_STYLE.durations[animation];
  }

  private zoomFilter(event: Event): boolean {
    if (event.type === 'wheel' || event.type === 'touchstart') return true;
    return !(event as MouseEvent).button;
  }

  private pcsRadius(d: ChartPcs): number {
    const r = CHART_STYLE.pcsRadiusPerSqrtPct * this.geom.unit * Math.sqrt(Math.max(0, d.weight));
    return Math.max(CHART_STYLE.pcsMinRadius, r);
  }

  private candHalf(d: ChartCandidate): number {
    const share = d.sizeShare ?? d.share ?? CHART_STYLE.candidateDefaultShare;
    const h =
      CHART_STYLE.candidateHalfDiagonalPerSqrtPct * this.geom.unit * Math.sqrt(Math.max(0, share));
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

    drawFrame(this.frameLayers, this.geom, x, y, model, this.view.showTerritories);
    drawTerritories(
      this.territoryLayer,
      this.view.showTerritories && model.axes?.halos !== false ? pcs : [],
      x,
      y,
      (p) => this.pcsRadius(p),
      this.geom.unit,
    );
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
    this.applyEmphasis();
    for (const cb of this.listeners) cb();
  }

  private drawEllipses(data: ChartCandidate[], x: Scale, y: Scale, duration: number): void {
    // Rotation dans le repère des données, puis mise à l'échelle : l'ellipse reste juste quand la
    // carte est étirée. L'axe Y de l'écran descend, d'où le facteur négatif.
    const kx = Math.abs(x(1) - x(0));
    const ky = Math.abs(y(1) - y(0));
    const transform = (d: ChartCandidate): string =>
      `translate(${x(d.x)},${y(d.y)}) scale(${kx},${-ky}) rotate(${d.ellipse?.angle_deg ?? 0})`;
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
    all
      .attr('data-key', (d) => `c:${d.id}`)
      .style('stroke', (d) => this.candidateFill(d))
      .style('fill', (d) => this.candidateFill(d));
    setAttrs(all, duration, {
      transform,
      rx: (d) => d.ellipse?.rx ?? 0,
      ry: (d) => d.ellipse?.ry ?? 0,
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
    all.attr('aria-label', (d) => `Barycentre de la population : ${coordinatesText(model, d)}`);
    all
      .select('circle.sg-bary__ring')
      .attr('r', Math.max(8, this.geom.unit * CHART_STYLE.barycenterRadius));
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
          coordinatesText(model, d),
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

  /** Une catégorie est nommée si elle est grande, mise en avant, ou si elle a de la place. */
  private pcsLabelled(
    p: ChartPcs,
    cx: number,
    cy: number,
    r: number,
    obstacles: readonly Obstacle[],
  ): boolean {
    const key = `p:${p.code}`;
    const { focus, selected } = this.view;
    if (selected.has(key)) return true;
    if (focus) return focus.has(key);
    const small = this.geom.small;
    if (p.weight >= (small ? CHART_STYLE.pcsLabelMinWeightSmall : CHART_STYLE.pcsLabelMinWeight)) {
      return true;
    }
    const minGap = small ? CHART_STYLE.pcsLabelMinGapSmall : CHART_STYLE.pcsLabelMinGap;
    return obstacles.every(
      (o) => o.key === key || Math.hypot(o.cx - cx, o.cy - cy) - o.r - r >= minGap,
    );
  }

  private drawLabels(
    pcs: ChartPcs[],
    cands: ChartCandidate[],
    x: Scale,
    y: Scale,
    duration: number,
  ): void {
    const { plot, small } = this.geom;
    const inPlot = (px: number, py: number): boolean =>
      px >= plot.x && px <= plot.x + plot.w && py >= plot.y && py <= plot.y + plot.h;
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
      const r = this.pcsRadius(p);
      if (!inPlot(cx, cy) || !this.pcsLabelled(p, cx, cy, r, obstacles)) continue;
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
    const placed = placeLabels(items, obstacles, plot, this.measure, {
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
    const allLeaders = enteredLeaders.merge(leaders);
    allLeaders.attr('data-key', (d) => d.key);
    setAttrs(allLeaders, duration, {
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

  /** Estompe ce qui n'est pas mis en avant et marque les repères sélectionnés. */
  private applyEmphasis(): void {
    const { focus, selected } = this.view;
    const dim = (key: string | null): boolean => focus !== null && !focus.has(key ?? '');
    for (const [key, el] of this.pointEls) {
      el.classList.toggle('sg-dim', key !== 'bary' && dim(key));
      el.classList.toggle('sg-point--selected', selected.has(key));
    }
    const follow = this.plot.selectAll<SVGElement, unknown>(
      '.sg-label:not(.sg-exiting), .sg-leader:not(.sg-exiting), .sg-ellipse:not(.sg-exiting)',
    );
    follow.classed('sg-dim', function () {
      return dim(this.getAttribute('data-key'));
    });
  }

  // --- Interaction ------------------------------------------------------------------------

  /**
   * Écouteurs natifs délégués sur la carte : le survol vise le repère le plus proche (zone utile
   * bien plus grande que les petits disques), le clavier passe par le focus natif.
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
      this.emitSelect(key, e.shiftKey);
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
      if (e.key === 'Escape') {
        this.clearHover();
        this.emitSelect(null, false);
      } else if (key && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        this.emitSelect(key, e.shiftKey);
      } else if (key) {
        this.onPointKey(e, key);
      }
    });
  }

  private emitSelect(key: string | null, additive: boolean): void {
    const selectable = key !== null && key !== 'bary' ? key : null;
    for (const cb of this.selectListeners) cb(selectable, additive);
  }

  /** Repère visé par le pointeur : à moins de hoverRadius px, le plus proche, puis le plus petit. */
  private keyNearPointer(e: MouseEvent): string | null {
    const model = this.model;
    const ctm = this.plot.node()?.getScreenCTM();
    if (!model || !ctm) return null;
    const px = (e.clientX - ctm.e) / ctm.a;
    const py = (e.clientY - ctm.f) / ctm.d;
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
      const ring = Math.max(8, this.geom.unit * CHART_STYLE.barycenterRadius);
      const d = Math.hypot(px - x(model.barycenter.x), py - y(model.barycenter.y));
      if (Math.abs(d - ring) <= 4) best = 'bary';
    }
    return best;
  }

  private tipFor(key: string): TooltipContent | null {
    const model = this.model;
    if (!model) return null;
    if (key === 'bary') return model.barycenter ? baryTip(model.barycenter, model) : null;
    if (key.startsWith('p:')) {
      const d = model.pcs.find((p) => `p:${p.code}` === key);
      return d ? pcsTip(d, model) : null;
    }
    const d = model.candidates.find((c) => `c:${c.id}` === key);
    return d ? candTip(d, model, this.view.showEllipses) : null;
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
}
