/**
 * Carte plein écran du Saint-Graphique, en SVG avec D3. Ce fichier tient la carte : zoom, géométrie,
 * lecture de la frise et interactions. Le dessin est ailleurs : décor (frame.ts), repères (marks.ts),
 * libellés (labelLayer.ts, playLabels.ts).
 *
 * - Les échelles X et Y sont indépendantes : la carte remplit l'écran (geometry.ts).
 * - Navigation de carte : molette, glisser, pincement, double-clic, boutons et cadrage.
 * - Zoom « sémantique » : les positions sont recalculées, la taille des repères est conservée.
 * - Transitions animées, désactivées si l'utilisateur préfère réduire les animations.
 * - Infobulle au survol, au toucher et au focus ; flèches du clavier entre les repères
 *   (pointFocus.ts) ; un clic ou Entrée sélectionne un repère (onSelect).
 *
 * Les fonctions de l'application dessinent leurs propres calques dans `layerUnder` et `layerOver`,
 * à l'aide de `scales()` et `onRender()` : ce fichier n'a pas à les connaître.
 */
import { select, type Selection } from 'd3-selection';
import 'd3-transition';
import {
  zoom,
  zoomIdentity,
  type D3ZoomEvent,
  type ZoomBehavior,
  type ZoomTransform,
} from 'd3-zoom';
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
import { drawMapLabels, TextMeasurer } from './labelLayer.ts';
import {
  bubbleRadius,
  drawBarycenter,
  drawCandidates,
  drawEllipses,
  drawPcs,
  type MarkContext,
} from './marks.ts';
import type { G } from './motion.ts';
import { pickKey } from './pick.ts';
import { PlayLabels } from './playLabels.ts';
import { PointFocus } from './pointFocus.ts';
import { CHART_STYLE } from './style.ts';
import { baryTip, candTip, pcsTip } from './tips.ts';
import { Tooltip, type TooltipContent } from './tooltip.ts';
import type { Animation, ChartCandidate, ChartModel, ChartView } from './types.ts';

export type { Animation, ChartCandidate, ChartModel, ChartPcs, ChartView } from './types.ts';
export type { ChartGeometry, Insets, Scale } from './geometry.ts';

/** Zone en coordonnées de données. */
export interface DataBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

type SelectListener = (key: string | null, additive: boolean) => void;

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
  private readonly clipRect: Selection<SVGRectElement, unknown, null, undefined>;
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
  private readonly points: PointFocus;
  private readonly resizeObserver: ResizeObserver | null = null;
  private readonly reducedMotion: MediaQueryList | null;
  private transform: ZoomTransform = zoomIdentity;
  private model: ChartModel | null = null;
  private view: ChartView = {
    hiddenGroups: new Set(),
    hiddenCandidates: new Set(),
    showLabels: true,
    showEllipses: false,
    focus: null,
    selected: new Set(),
    square: false,
  };
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private geom: ChartGeometry;
  private hoverKey: string | null = null;
  private readonly measurer = new TextMeasurer();
  private zooming = false;
  /** Glissement de la carte en cours (panneau qui s'ouvre) : les tailles poursuivent leur transition. */
  private sliding = false;
  private slideFrame: number | null = null;
  /** Cadre demandé pendant que la carte glisse : il se calcule sur sa géométrie d'arrivée. */
  private deferredFit: { box: DataBox; animated: boolean } | null = null;
  /** Lecture de la frise en cours : les électorats suivent `frameCandidates`. */
  private frameCandidates: ChartCandidate[] | null = null;
  private frameProgress = 0;
  private readonly playLabels: PlayLabels;
  /** Scrutin de départ pendant la lecture : les trajectoires s'y arrêtent, puis suivent le repère. */
  playhead: { election: string; date: number } | null = null;

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

    // La carte ne déborde pas de la zone de tracé : les axes restent à son bord.
    const clipId = `sg-plot-clip-${id}`;
    this.clipRect = this.svgSel.append('defs').append('clipPath').attr('id', clipId).append('rect');
    const clip = `url(#${clipId})`;
    this.plot = this.svgSel.append('g').attr('class', 'sg-plot');
    const bg = this.plot.append('rect').attr('class', 'sg-plot-bg');
    const clipped = this.plot.append('g').attr('class', 'sg-clipped').attr('clip-path', clip);
    const quads = clipped.append('g').attr('class', 'sg-quadrants');
    const grid = clipped.append('g').attr('class', 'sg-grid');
    const diagonal = clipped
      .append('line')
      .attr('class', 'sg-diagonal')
      .attr('aria-hidden', 'true');
    const regions = clipped.append('g').attr('class', 'sg-regions').attr('aria-hidden', 'true');
    this.below = clipped.append('g').attr('class', 'sg-layer-below');
    const marks = clipped.append('g').attr('class', 'sg-marks');
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
    this.leaderLayer = clipped.append('g').attr('class', 'sg-leaders').attr('aria-hidden', 'true');
    this.labelLayer = clipped.append('g').attr('class', 'sg-labels').attr('aria-hidden', 'true');
    this.playLabels = new PlayLabels(
      clipped.append('g').attr('class', 'sg-play-labels').attr('aria-hidden', 'true'),
    );
    const axes = this.plot.append('g').attr('class', 'sg-axes').attr('aria-hidden', 'true');
    this.above = this.plot.append('g').attr('class', 'sg-layer-above');
    this.frameLayers = { bg, quads, grid, diagonal, axes, regions };

    this.points = new PointFocus(this.plot);
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
    if (shapeChanged) this.replot();
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
    this.tooltip.setBounds(insets);
    this.slideTo(insets, animation);
  }

  /**
   * Fait glisser la carte image par image : axes, grille et repères bougent ensemble. Sans animation
   * possible (mouvement réduit, onglet masqué), elle saute directement à sa place.
   */
  private slideTo(target: Insets, animation: Animation): void {
    if (this.slideFrame !== null) cancelAnimationFrame(this.slideFrame);
    this.slideFrame = null;
    this.sliding = false;
    const animated = this.duration(animation) > 0 && !document.hidden && this.model !== null;
    if (!animated) {
      this.insets = target;
      this.replot();
      this.draw(animation);
      this.runDeferredFit();
      return;
    }
    const from = this.insets;
    const start = performance.now();
    const mix = (a: number, b: number, u: number): number => a + (b - a) * u;
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / CHART_STYLE.slideDuration);
      const u = t * (2 - t);
      this.insets = {
        top: mix(from.top, target.top, u),
        right: mix(from.right, target.right, u),
        bottom: mix(from.bottom, target.bottom, u),
        left: mix(from.left, target.left, u),
      };
      this.replot();
      this.sliding = t < 1;
      this.zooming = t < 1;
      this.draw(t < 1 ? 'none' : 'fast');
      this.slideFrame = t < 1 ? requestAnimationFrame(step) : null;
      if (t >= 1) this.runDeferredFit();
    };
    this.slideFrame = requestAnimationFrame(step);
  }

  private runDeferredFit(): void {
    const fit = this.deferredFit;
    this.deferredFit = null;
    if (fit) this.fitTo(fit.box, fit.animated);
  }

  /** Recalcule la zone de tracé en gardant au centre ce qu'on y regardait. */
  private replot(): void {
    const k = this.transform.k;
    const previous = this.geom.plot;
    const { x, y } = this.scales();
    const centerX = x.invert(previous.x + previous.w / 2);
    const centerY = y.invert(previous.y + previous.h / 2);
    this.geom = this.measureGeometry();
    this.applyGeometry();
    const { plot } = this.geom;
    const base = this.base();
    const target =
      k <= 1
        ? zoomIdentity
        : zoomIdentity
            .translate(
              plot.x + plot.w / 2 - k * base.x(centerX),
              plot.y + plot.h / 2 - k * base.y(centerY),
            )
            .scale(k);
    const bounds: [[number, number], [number, number]] = [
      [plot.x, plot.y],
      [plot.x + plot.w, plot.y + plot.h],
    ];
    this.transform = this.zoomBehavior.constrain()(target, bounds, bounds);
    this.plot.property('__zoom', this.transform);
  }

  get playing(): boolean {
    return this.frameCandidates !== null;
  }

  /** Position courante d'un repère pendant la lecture, pour que sa trajectoire le suive. */
  trackPosition(key: string): Point | null {
    const c = this.frameCandidates?.find((m) => (m.trackKey ?? m.id) === key);
    return c ? { x: c.x, y: c.y } : null;
  }

  /** Démarre la lecture de la frise : les électorats ne suivent plus que `playFrame`. */
  startPlayback(candidates: readonly ChartCandidate[]): void {
    this.frameCandidates = [...candidates];
    this.frameProgress = 0;
    this.playLabels.reset();
    this.svg.classList.add('sg-playing');
  }

  /** Nouveau segment : les libellés glisseront vers leur place à l'arrivée, sans se chevaucher. */
  beginPlaySegment(target: readonly ChartCandidate[]): void {
    const { x, y } = this.scales();
    const shown = target.filter((c) => !this.view.hiddenCandidates.has(c.id));
    this.playLabels.beginSegment(shown, x, y, this.geom, this.measurer.measure);
  }

  /** Une image de la lecture. `progress` : avancement du segment, de 0 à 1. */
  playFrame(candidates: ChartCandidate[], progress: number): void {
    this.frameCandidates = candidates;
    this.frameProgress = progress;
    this.draw('none');
  }

  /** Fin de la lecture : les repères rejoignent leur place, et les libellés sont replacés. */
  stopPlayback(): void {
    this.frameCandidates = null;
    this.playhead = null;
    this.svg.classList.remove('sg-playing');
    this.playLabels.clear();
    this.draw('fast');
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
    this.deferredFit = null;
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
    if (this.slideFrame !== null) {
      this.deferredFit = { box, animated };
      return;
    }
    const { x, y } = this.base();
    const [minK, maxK] = CHART_STYLE.zoomExtent;
    const t = fitTransform(this.geom, x, y, box, minK, maxK);
    const target = zoomIdentity.translate(t.tx, t.ty).scale(t.k);
    const d = animated ? this.duration('normal') : 0;
    if (d > 0) this.zoomBehavior.transform(this.plot.transition().duration(d), target);
    else this.zoomBehavior.transform(this.plot, target);
  }

  /**
   * Cadre les électorats affichés : ils se serrent au centre, et c'est eux qui se déplacent.
   * `points` élargit le cadre à des positions à venir, pour qu'il ne change pas pendant la lecture.
   */
  fitElectorates(animated = true, points?: readonly Point[]): void {
    const shown: readonly Point[] =
      points && points.length > 0
        ? points
        : (this.model?.candidates ?? []).filter((c) => !this.view.hiddenCandidates.has(c.id));
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
    const { width, height, plot } = this.geom;
    this.svgSel
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`);
    this.clipRect.attr('x', plot.x).attr('y', plot.y).attr('width', plot.w).attr('height', plot.h);
    const bounds: [[number, number], [number, number]] = [
      [plot.x, plot.y],
      [plot.x + plot.w, plot.y + plot.h],
    ];
    this.zoomBehavior.extent(bounds).translateExtent(bounds);
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

  // --- Rendu --------------------------------------------------------------------------------

  private draw(animation: Animation): void {
    const model = this.model;
    if (!model) return;
    const { x, y } = this.scales();
    const duration = this.duration(animation);
    this.titleEl.textContent = model.title;
    this.descEl.textContent = model.description;
    // Lire le style force un recalcul : pas à chaque image.
    if (!this.zooming && !this.frameCandidates) {
      this.measurer.family = getComputedStyle(this.svg).fontFamily || 'sans-serif';
    }

    const pcs = model.pcs
      .filter((p) => !this.view.hiddenGroups.has(p.group))
      .sort((a, b) => b.weight - a.weight);
    const cands = (this.frameCandidates ?? model.candidates)
      .filter((c) => !this.view.hiddenCandidates.has(c.id))
      .sort((a, b) => bubbleRadius(b, this.geom.unit) - bubbleRadius(a, this.geom.unit));

    drawFrame(this.frameLayers, this.geom, x, y, model);
    const ctx: MarkContext = { x, y, duration, geom: this.geom, model };
    const { showEllipses, showLabels } = this.view;
    drawEllipses(this.ellipseLayer, showEllipses ? cands.filter((c) => c.ellipse) : [], ctx);
    drawPcs(this.pcsLayer, pcs, ctx);
    drawBarycenter(this.baryLayer, model.barycenter, ctx);
    drawCandidates(this.candLayer, cands, ctx, !this.sliding);
    // Pendant la lecture, seuls les noms des électorats suivent : les catégories ne bougent pas.
    if (this.frameCandidates) {
      if (showLabels) this.playLabels.draw(cands, this.frameProgress, x, y, this.geom.small);
    } else {
      drawMapLabels(
        this.leaderLayer,
        this.labelLayer,
        showLabels ? pcs : [],
        showLabels ? cands : [],
        {
          ...ctx,
          view: this.view,
          measure: this.measurer.measure,
          quick: this.zooming,
        },
      );
    }
    this.points.refresh(pcs, cands);
    this.applyEmphasis();
    for (const cb of this.listeners) cb();
  }

  /** Estompe ce qui n'est pas mis en avant et marque les repères sélectionnés. */
  private applyEmphasis(): void {
    const { focus, selected } = this.view;
    const dim = (key: string | null): boolean => focus !== null && !focus.has(key ?? '');
    for (const [key, el] of this.points.elements) {
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
      this.points.setFocused(key);
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
        this.points.onKey(e, key);
      }
    });
  }

  private emitSelect(key: string | null, additive: boolean): void {
    const selectable = key !== null && key !== 'bary' ? key : null;
    for (const cb of this.selectListeners) cb(selectable, additive);
  }

  private keyNearPointer(e: MouseEvent): string | null {
    const model = this.model;
    const ctm = this.plot.node()?.getScreenCTM();
    if (!model || !ctm) return null;
    const { x, y } = this.scales();
    return pickKey((e.clientX - ctm.e) / ctm.a, (e.clientY - ctm.f) / ctm.d, {
      model,
      view: this.view,
      geom: this.geom,
      x,
      y,
    });
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
    const el = this.points.elements.get(key);
    const content = this.tipFor(key);
    if (!el || !content) return;
    this.points.elements.get(this.hoverKey ?? '')?.classList.remove('sg-point--active');
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
    this.points.elements.get(this.hoverKey ?? '')?.classList.remove('sg-point--active');
    this.hoverKey = null;
    this.tooltip.hide();
  }
}
