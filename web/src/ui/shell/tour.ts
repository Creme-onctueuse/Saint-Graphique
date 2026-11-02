/**
 * Visite guidée : une carte en bas de l'écran, cinq étapes, et la carte qui bouge à chacune. En
 * quittant, on retrouve la vue d'avant.
 */
import './tour.css';
import type { SaintChart } from '../../chart/chart.ts';
import type { AppState } from '../../core/state.ts';
import { TOUR_STEPS, tourPatch, type TourStep } from '../../core/tour.ts';
import type { ResolvedView } from '../../view.ts';
import type { AppActions, Feature } from '../actions.ts';
import { byId, el } from '../dom.ts';

/** Le cadrage attend que la nouvelle vue soit en place (ms). */
const FRAME_DELAY_MS = 60;

export class Tour implements Feature {
  private readonly actions: AppActions;
  private readonly chart: SaintChart;
  private readonly card: HTMLElement;
  private readonly title = el('h2', { attrs: { id: 'sg-tour-title' } });
  private readonly text = el('p', { attrs: { id: 'sg-tour-text' } });
  private readonly progress = el('p', {
    class: 'sg-tour__progress',
    attrs: { id: 'sg-tour-step' },
  });
  private readonly previous = el('button', {
    class: 'sg-btn',
    text: 'Précédent',
    attrs: { type: 'button', id: 'sg-tour-previous' },
  });
  private readonly next = el('button', {
    class: 'sg-btn sg-tour__next',
    text: 'Suivant',
    attrs: { type: 'button', id: 'sg-tour-next' },
  });
  private index = -1;
  private state: AppState | null = null;
  private before: AppState | null = null;

  constructor(actions: AppActions, chart: SaintChart) {
    this.actions = actions;
    this.chart = chart;
    const quit = el('button', {
      class: 'sg-btn',
      text: 'Quitter',
      attrs: { type: 'button', id: 'sg-tour-quit' },
    });
    this.card = el(
      'aside',
      {
        class: 'sg-tour sg-float',
        attrs: {
          id: 'sg-tour',
          role: 'dialog',
          'aria-labelledby': 'sg-tour-title',
          // La carte glisse à côté : la visite ne cache rien de ce qu'elle montre.
          'data-sg-reserve': '',
        },
      },
      this.progress,
      this.title,
      this.text,
      el('div', { class: 'sg-tour__actions' }, quit, this.previous, this.next),
    );
    this.card.hidden = true;
    document.body.append(this.card);

    byId('sg-tour-open').addEventListener('click', () => this.start());
    quit.addEventListener('click', () => this.stop());
    this.previous.addEventListener('click', () => this.go(this.index - 1));
    this.next.addEventListener('click', () => {
      if (this.index >= TOUR_STEPS.length - 1) this.stop();
      else this.go(this.index + 1);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.running) this.stop();
    });
  }

  private get running(): boolean {
    return this.index >= 0;
  }

  sync(_view: ResolvedView, state: AppState): void {
    this.state = state;
  }

  private start(): void {
    this.before = this.state;
    document.body.classList.add('sg-touring');
    this.card.hidden = false;
    this.go(0);
  }

  private stop(): void {
    this.index = -1;
    this.card.hidden = true;
    document.body.classList.remove('sg-touring');
    if (this.before) this.actions.patch(this.before, 'normal');
    this.before = null;
    this.chart.resetZoom();
  }

  private go(index: number): void {
    const step: TourStep | undefined = TOUR_STEPS[index];
    if (!step) return;
    this.index = index;
    this.progress.textContent = `Étape ${index + 1} sur ${TOUR_STEPS.length}`;
    this.title.textContent = step.title;
    this.text.textContent = step.text;
    this.previous.hidden = index === 0;
    this.next.textContent = index === TOUR_STEPS.length - 1 ? 'Terminer' : 'Suivant';
    this.actions.patch(tourPatch(step), 'normal');
    window.setTimeout(() => {
      if (!this.running) return;
      if (step.frame === 'electorates') this.chart.fitElectorates();
      else this.chart.resetZoom();
    }, FRAME_DELAY_MS);
    this.next.focus();
  }
}
