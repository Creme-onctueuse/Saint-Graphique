/**
 * Frise des élections, sur une vraie échelle de temps : une étape par année, un bouton par scrutin,
 * et la projection 2027 en dernier. Boutons radio natifs : Tab et les flèches du clavier fonctionnent
 * sans code. Sur la carte, ←, → et Espace parcourent la frise ; Échap arrête la lecture.
 *
 * La lecture cadre les électorats, puisque ce sont eux qui bougent, et avance d'une étape à la fois.
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
  timelineStops,
  type TimelineStop,
} from '../../core/timeline.ts';
import { POPULATION_ID, PROJECTION_ID, type Point } from '../../core/types.ts';
import { computedKey, type Dataset } from '../../data/dataset.ts';
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

/** Temps passé sur chaque étape pendant la lecture (ms). */
const STEP_MS = 1700;
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
    const years = new Map<number, TimelineStop[]>();
    for (const s of this.stops) {
      const list = years.get(s.year);
      if (list) list.push(s);
      else years.set(s.year, [s]);
    }
    const sorted = [...years.keys()].sort((a, b) => a - b);
    const first = sorted[0] ?? 0;
    const span = Math.max(1, (sorted.at(-1) ?? 0) - first);
    const position = (year: number): number => (100 * (year - first)) / span;

    const track = el('div', { class: 'sg-timeline__track' });
    const lastReal = this.stops.filter((s) => !s.projection).at(-1);
    const hasProjection = this.stops.some((s) => s.projection);
    if (hasProjection && lastReal) {
      track.classList.add('sg-timeline__track--future');
      track.style.setProperty('--sg-future-start', `${position(lastReal.year)}%`);
    }
    for (const year of sorted) {
      const stops = (years.get(year) ?? []).map((s) => {
        const letter = s.projection ? '◇' : (TYPE_LETTER[s.type ?? ''] ?? '•');
        const label = this.stop(s.id, letter, s.label);
        if (s.projection) label.classList.add('sg-stop--projection');
        return label;
      });
      const group = el(
        'div',
        { class: 'sg-year' },
        el('div', { class: 'sg-year__stops' }, ...stops),
        el('span', { class: 'sg-year__label', text: String(year) }),
      );
      group.style.left = `${position(year)}%`;
      track.append(group);
    }
    return track;
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
    return this.timer !== undefined;
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
    const delay = this.reducedMotion?.matches ? STEP_REDUCED_MS : STEP_MS;
    this.timer = window.setInterval(() => this.tick(), delay);
    this.syncPlay();
  }

  private tick(): void {
    const next = nextStopId(this.filtered(), this.view?.electionId ?? '');
    if (next) this.choose(next);
    if (!next || !nextStopId(this.filtered(), next)) this.stopPlaying();
  }

  private stopPlaying(): void {
    if (this.timer === undefined) return;
    window.clearInterval(this.timer);
    this.timer = undefined;
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
