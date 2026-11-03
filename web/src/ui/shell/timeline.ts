/**
 * Frise des élections : un groupe par année, un bouton par scrutin, et la projection 2027 en dernier.
 * Les groupes gardent leur largeur et les intervalles se partagent le reste, à proportion des années :
 * les étapes ne se chevauchent jamais, et la frise défile quand elle dépasse (sur téléphone). Boutons
 * radio natifs : Tab et les flèches du clavier fonctionnent sans code. Sur la carte, ←, → et Espace
 * parcourent la frise ; Échap arrête la lecture.
 *
 * La lecture cadre les électorats, puisque ce sont eux qui bougent, et avance à vitesse constante, sans
 * pause : l'état passe au scrutin suivant au début de chaque segment, et une boucle d'animation amène
 * les repères à leur place (core/playback.ts). Avec les animations réduites, elle avance par étapes.
 */
import './timeline.css';
import type { SaintChart } from '../../chart/chart.ts';
import type { AppState, TypeFilter } from '../../core/state.ts';
import { TYPE_FILTERS } from '../../core/state.ts';
import {
  carrySelection,
  nearestStopId,
  nextStopId,
  playStartId,
  previousStopId,
  stopsForFilter,
  stopTitle,
  timelineStops,
  yearGroups,
  type TimelineStop,
} from '../../core/timeline.ts';
import { POPULATION_ID, PROJECTION_ID, type Point } from '../../core/types.ts';
import { interpolateMarks } from '../../core/playback.ts';
import { computedKey, type Dataset } from '../../data/dataset.ts';
import type { ChartCandidate } from '../../chart/types.ts';
import { CHART_STYLE } from '../../chart/style.ts';
import type { ResolvedView } from '../../view.ts';
import type { AppActions, Feature } from '../actions.ts';
import { byId, el } from '../dom.ts';
import { icon, type IconName } from '../icons.ts';

const TYPE_LETTER: Record<string, string> = {
  presidentielle: 'P',
  legislatives: 'L',
  europeennes: 'E',
};

const FILTER_LABELS: Record<TypeFilter, string> = {
  all: 'Toutes',
  presidentielle: 'Présidentielles',
  legislatives: 'Législatives',
  europeennes: 'Européennes',
};

/** Temps passé sur chaque étape quand les animations sont réduites (ms). */
const STEP_REDUCED_MS = 2600;
/** En dessous de ce zoom, l'arrivée sur la projection cadre les électorats : c'est eux qu'elle montre. */
const FRAME_BELOW_ZOOM = 1.05;

function iconButton(id: string, name: IconName, label: string): HTMLButtonElement {
  return el(
    'button',
    {
      class: 'sg-iconbtn',
      attrs: { id, type: 'button', 'aria-label': label, title: label, 'aria-pressed': 'false' },
    },
    el('span', { class: 'sg-icon' }, icon(name)),
  );
}

function filterSelect(id: string): HTMLSelectElement {
  return el(
    'select',
    { class: 'sg-tl-select', attrs: { id, 'aria-label': 'Type d’élection affiché' } },
    ...TYPE_FILTERS.map((f) => el('option', { text: FILTER_LABELS[f], attrs: { value: f } })),
  );
}

function isTypeFilter(v: string): v is TypeFilter {
  return TYPE_FILTERS.some((f) => f === v);
}

export class Timeline implements Feature {
  private readonly ds: Dataset;
  private readonly actions: AppActions;
  private readonly chart: SaintChart;
  private readonly stops: TimelineStop[];
  private readonly inputs: HTMLInputElement[];
  private readonly playButton = iconButton('sg-timeline-play', 'play', 'Lire la frise (Espace)');
  private readonly trailsButton = iconButton(
    'sg-toggle-trails',
    'trails',
    'Afficher les trajectoires des familles',
  );
  private readonly ringsButton = iconButton(
    'sg-toggle-rings',
    'rings',
    'Afficher le vote de chaque groupe',
  );
  private readonly filterTop = filterSelect('sg-type-filter');
  private readonly filterPanel = filterSelect('sg-type-filter-panel');
  private readonly trailsCheck = el('input', {
    attrs: { type: 'checkbox', id: 'sg-check-trails' },
  });
  private readonly ringsCheck = el('input', { attrs: { type: 'checkbox', id: 'sg-check-rings' } });
  private readonly reducedMotion: MediaQueryList | null;
  private timer: number | undefined;
  private frame: number | null = null;
  private segment: {
    from: ChartCandidate[];
    to: ChartCandidate[];
    start: number;
    fromPosition: number;
    toPosition: number;
  } | null = null;
  /** Ce qui avance sur la frise pendant la lecture. */
  private readonly head = el('span', {
    class: 'sg-timeline__head',
    attrs: { id: 'sg-timeline-head', 'aria-hidden': 'true' },
  });
  /** Ce qui défile sur téléphone, et ce qu'il contient : les positions s'y mesurent. */
  private readonly rail = el('div', { class: 'sg-timeline__rail' }, this.head);
  private readonly track = el('div', { class: 'sg-timeline__track' }, this.rail);
  private revealed: string | null = null;
  private view: ResolvedView | null = null;
  private state: AppState | null = null;

  constructor(host: HTMLElement, ds: Dataset, actions: AppActions, chart: SaintChart) {
    this.ds = ds;
    this.actions = actions;
    this.chart = chart;
    this.stops = timelineStops(ds);
    this.reducedMotion =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    const controls = el('div', { class: 'sg-tl-controls' }, this.playButton, this.filterTop);
    const hasFamilies = ds.families !== null;
    if (hasFamilies) controls.append(this.trailsButton, this.ringsButton);

    const none = this.stop(POPULATION_ID, '∅', ds.populationLabel);
    none.classList.add('sg-stop--none');
    host.append(
      controls,
      el(
        'div',
        { class: 'sg-timeline__none' },
        none,
        el('span', { class: 'sg-year__label', text: 'Aucune' }),
      ),
      this.buildTrack(),
    );
    this.inputs = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')];

    this.buildPanelOptions(hasFamilies);
    this.playButton.addEventListener('click', () => this.togglePlay());
    this.trailsButton.addEventListener('click', () => this.toggleTrails());
    this.ringsButton.addEventListener('click', () => this.toggleRings());
    for (const select of [this.filterTop, this.filterPanel]) {
      select.addEventListener('change', () => {
        if (isTypeFilter(select.value)) this.setFilter(select.value);
      });
    }
    document.addEventListener('keydown', (e) => this.onKey(e));
  }

  private buildTrack(): HTMLElement {
    this.head.hidden = true;
    for (const group of yearGroups(this.stops)) {
      if (group.gap > 0) {
        const gap = el('span', { class: 'sg-year__gap', attrs: { 'aria-hidden': 'true' } });
        gap.style.flexGrow = String(group.gap);
        // Après le dernier scrutin, la ligne devient pointillée : c'est l'avenir.
        if (group.stops.every((s) => s.projection)) gap.classList.add('sg-year__gap--future');
        this.rail.append(gap);
      }
      const stops = group.stops.map((s) => {
        const letter = s.projection ? '◇' : (TYPE_LETTER[s.type ?? ''] ?? '•');
        const label = this.stop(s.id, letter, stopTitle(s));
        if (s.projection) label.classList.add('sg-stop--projection');
        return label;
      });
      this.rail.append(
        el(
          'div',
          { class: 'sg-year' },
          el('div', { class: 'sg-year__stops' }, ...stops),
          el('span', { class: 'sg-year__label', text: String(group.year) }),
        ),
      );
    }
    return this.track;
  }

  /** Abscisse du centre d'une étape, en pixels depuis le début de la frise. */
  private stopCenter(id: string): number {
    const stop = this.inputs.find((i) => i.value === id)?.closest('.sg-stop');
    if (!stop) return 0;
    const box = stop.getBoundingClientRect();
    return box.left + box.width / 2 - this.rail.getBoundingClientRect().left;
  }

  /** Sur téléphone, garde l'étape affichée dans la partie visible de la frise. */
  private reveal(id: string): void {
    const room = this.track.scrollWidth - this.track.clientWidth;
    if (room <= 0) return;
    const left = this.stopCenter(id) - this.track.clientWidth / 2;
    this.track.scrollLeft = Math.max(0, Math.min(room, left));
  }

  private stop(id: string, letter: string, label: string): HTMLLabelElement {
    const input = el('input', {
      class: 'sg-sr-only',
      attrs: { type: 'radio', name: 'sg-election', value: id, 'aria-label': label },
    });
    input.addEventListener('change', () => {
      if (!input.checked) return;
      this.stopPlaying();
      this.choose(id);
    });
    return el(
      'label',
      { class: 'sg-stop', attrs: { title: label } },
      input,
      el('span', { class: 'sg-stop__dot', text: letter, attrs: { 'aria-hidden': 'true' } }),
    );
  }

  /** Sur téléphone, la barre du haut n'a pas la place : tout reste accessible dans le panneau. */
  private buildPanelOptions(hasFamilies: boolean): void {
    const host = byId('sg-options-electorates');
    host.append(el('label', { class: 'sg-field' }, 'Élections de la frise', this.filterPanel));
    if (!hasFamilies) return;
    host.append(
      el('label', { class: 'sg-check' }, this.trailsCheck, 'Trajectoires des familles'),
      el('label', { class: 'sg-check' }, this.ringsCheck, 'Anneaux : le vote de chaque groupe'),
    );
    this.trailsCheck.addEventListener('change', () => this.toggleTrails());
    this.ringsCheck.addEventListener('change', () => this.toggleRings());
  }

  private toggleTrails(): void {
    if (this.state) this.actions.patch({ showTrails: !this.state.showTrails }, 'fast');
  }

  private toggleRings(): void {
    if (this.state) this.actions.patch({ showRings: !this.state.showRings }, 'fast');
  }

  /** Change d'élection : la sélection suit sa famille. */
  private choose(id: string): void {
    const selected = carrySelection(this.ds.families, id, this.state?.selected ?? null);
    this.actions.patch({ election: id, selected }, 'normal');
    if (id === PROJECTION_ID && this.chart.zoomLevel < FRAME_BELOW_ZOOM) {
      this.chart.fitElectorates(true, this.framePoints(this.filtered()));
    }
  }

  private filtered(): TimelineStop[] {
    return stopsForFilter(this.stops, this.state?.typeFilter ?? 'all');
  }

  private setFilter(filter: TypeFilter): void {
    const allowed = stopsForFilter(this.stops, filter);
    const current = this.view?.electionId ?? '';
    const stop = this.stops.find((s) => s.id === current);
    const keep = !stop || allowed.some((s) => s.id === current);
    const target = keep ? current : nearestStopId(allowed, stop.date);
    this.stopPlaying();
    if (target && target !== current) {
      const selected = carrySelection(this.ds.families, target, this.state?.selected ?? null);
      this.actions.patch({ typeFilter: filter, election: target, selected }, 'normal');
    } else {
      this.actions.patch({ typeFilter: filter }, 'fast');
    }
  }

  private get playing(): boolean {
    return this.timer !== undefined || this.frame !== null;
  }

  private togglePlay(): void {
    if (this.playing) this.stopPlaying();
    else this.startPlaying();
  }

  /** Tous les électorats que la lecture va montrer : le cadre ne change plus ensuite. */
  private framePoints(stops: readonly TimelineStop[]): Point[] {
    const method = this.view?.method.id;
    if (!method) return [];
    const points: Point[] = [];
    for (const s of stops) {
      if (s.projection) {
        for (const f of this.ds.projections.get(method)?.families ?? []) {
          points.push(f.still, f.trend);
        }
      } else {
        points.push(...(this.ds.computed.get(computedKey(method, s.id))?.candidates ?? []));
      }
    }
    return points;
  }

  private startPlaying(): void {
    const stops = this.filtered();
    const start = playStartId(stops, this.view?.electionId ?? '');
    if (!start) return;
    this.chart.fitElectorates(true, this.framePoints(stops));
    if (start !== this.view?.electionId) this.choose(start);
    if (this.reducedMotion?.matches) {
      this.timer = window.setInterval(() => this.tick(), STEP_REDUCED_MS);
    } else {
      this.chart.startPlayback(this.view?.model.candidates ?? []);
      this.beginSegment(performance.now());
      this.frame = requestAnimationFrame((now) => this.step(now));
    }
    this.syncPlay();
  }

  private tick(): void {
    const next = nextStopId(this.filtered(), this.view?.electionId ?? '');
    if (next) this.choose(next);
    if (!next || !nextStopId(this.filtered(), next)) this.stopPlaying();
  }

  /** Passe au scrutin suivant : l'état y est déjà, les repères y arrivent pendant le segment. */
  private beginSegment(start: number): boolean {
    const fromId = this.view?.electionId ?? '';
    const next = nextStopId(this.filtered(), fromId);
    const fromStop = this.stops.find((s) => s.id === fromId);
    if (!next || !this.view) {
      this.segment = null;
      return false;
    }
    const from = this.view.model.candidates;
    this.chart.playhead = fromStop ? { election: fromStop.id, date: fromStop.date } : null;
    const selected = carrySelection(this.ds.families, next, this.state?.selected ?? null);
    this.actions.patch({ election: next, selected }, 'none');
    const to = this.view?.model.candidates ?? [];
    const toStop = this.stops.find((s) => s.id === next);
    this.segment = {
      from,
      to,
      start,
      fromPosition: fromStop ? this.stopCenter(fromStop.id) : 0,
      toPosition: toStop ? this.stopCenter(toStop.id) : 0,
    };
    this.chart.beginPlaySegment(interpolateMarks(from, to, 1));
    return true;
  }

  private step(now: number): void {
    const segment = this.segment;
    if (!segment) {
      this.stopPlaying();
      return;
    }
    const u = (now - segment.start) / CHART_STYLE.playSegmentMs;
    this.head.hidden = false;
    const t = Math.min(1, u);
    this.head.style.left = `${segment.fromPosition + (segment.toPosition - segment.fromPosition) * t}px`;
    if (u < 1) {
      this.chart.playFrame(interpolateMarks(segment.from, segment.to, u), u);
    } else {
      this.chart.playFrame(interpolateMarks(segment.from, segment.to, 1), 1);
      if (!this.beginSegment(segment.start + CHART_STYLE.playSegmentMs)) {
        this.stopPlaying();
        return;
      }
    }
    this.frame = requestAnimationFrame((t) => this.step(t));
  }

  private stopPlaying(): void {
    if (this.timer !== undefined) {
      window.clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    this.head.hidden = true;
    if (this.chart.playing) {
      this.segment = null;
      this.chart.stopPlayback();
      // Les trajectoires reprennent jusqu'au scrutin affiché.
      this.actions.patch({}, 'fast');
    }
    this.syncPlay();
  }

  private syncPlay(): void {
    const playing = this.playing;
    const label = playing ? 'Arrêter la lecture (Espace)' : 'Lire la frise (Espace)';
    this.playButton.replaceChildren(
      el('span', { class: 'sg-icon' }, icon(playing ? 'pause' : 'play')),
    );
    this.playButton.setAttribute('aria-label', label);
    this.playButton.title = label;
    this.playButton.setAttribute('aria-pressed', String(playing));
  }

  private onKey(e: KeyboardEvent): void {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape' && this.playing) {
      this.stopPlaying();
      return;
    }
    // Les champs, les boutons et les repères de la carte ont leur propre usage de ces touches.
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('input, select, textarea, button, a, dialog, [data-key]')) return;
    if (e.key === ' ') {
      e.preventDefault();
      this.togglePlay();
      return;
    }
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    this.stopPlaying();
    const current = this.view?.electionId ?? '';
    const stops = this.filtered();
    const next =
      e.key === 'ArrowRight' ? nextStopId(stops, current) : previousStopId(stops, current);
    if (next) this.choose(next);
  }

  sync(view: ResolvedView, state: AppState): void {
    this.view = view;
    this.state = state;
    const allowed = new Set(this.filtered().map((s) => s.id));
    for (const input of this.inputs) {
      input.checked = input.value === view.electionId;
      const off = input.value !== POPULATION_ID && !allowed.has(input.value);
      input.disabled = off;
      input.closest('.sg-stop')?.classList.toggle('sg-stop--off', off);
    }
    if (view.electionId !== this.revealed) {
      this.revealed = view.electionId;
      this.reveal(view.electionId);
    }
    this.filterTop.value = state.typeFilter;
    this.filterPanel.value = state.typeFilter;
    this.trailsButton.setAttribute('aria-pressed', String(state.showTrails));
    this.ringsButton.setAttribute('aria-pressed', String(state.showRings));
    this.trailsCheck.checked = state.showTrails;
    this.ringsCheck.checked = state.showRings;
    // Pas d'anneau sans sondage : ni sur la carte de la population, ni sur la projection.
    const noPoll = view.isPopulation || view.electionId === PROJECTION_ID;
    this.ringsButton.disabled = noPoll;
    this.ringsCheck.disabled = noPoll;
  }
}
