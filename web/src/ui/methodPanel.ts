/** Panneau « Méthode » : curseurs des poids de diplômes et score Y imposé aux retraités. */
import { formatNumber } from '../core/format.ts';
import type { AppState } from '../core/state.ts';
import { DIPLOMA_KEYS, type DiplomaKey } from '../core/types.ts';
import type { ResolvedView } from '../view.ts';
import type { AppActions } from './actions.ts';
import { el } from './dom.ts';

const DIPLOMA_LABELS: Record<DiplomaKey, string> = {
  bac5: 'Bac +5 et plus',
  bac3: 'Bac +3 ou +4',
  bac2: 'Bac +2',
  bac: 'Bac',
  cap: 'CAP, BEP',
  brevet: 'Brevet',
  certif_aucun: 'Certificat, aucun',
};

/** Score proposé quand on active le forçage pour une méthode qui n'en a pas. */
const DEFAULT_RETIRED_SCORE = -180;

interface SliderRow {
  input: HTMLInputElement;
  output: HTMLOutputElement;
}

export class MethodPanel {
  private readonly sliders = new Map<DiplomaKey, SliderRow>();
  private readonly note = el('p', { class: 'sg-note' });
  /** Réglages masqués quand la méthode ne se recalcule pas : ils n'auraient aucun effet. */
  private readonly tuning: HTMLDivElement;
  private readonly retiredOn = el('input', { attrs: { type: 'checkbox' } });
  private readonly retiredScore = el('input', {
    class: 'sg-number',
    attrs: {
      type: 'number',
      min: '-600',
      max: '600',
      step: '10',
      'aria-label': 'Score Y imposé aux retraités',
    },
  });
  private readonly reset = el('button', {
    class: 'sg-btn',
    text: 'Réinitialiser les poids',
    attrs: { type: 'button' },
  });

  constructor(host: HTMLElement, actions: AppActions) {
    const list = el('div', { class: 'sg-sliders' });
    for (const key of DIPLOMA_KEYS) {
      const id = `sg-weight-${key}`;
      const input = el('input', {
        attrs: { id, type: 'range', min: '-10', max: '10', step: '0.5' },
      });
      const output = el('output', { attrs: { for: id } });
      input.addEventListener('input', () => actions.setWeight(key, Number(input.value)));
      this.sliders.set(key, { input, output });
      list.append(
        el(
          'div',
          { class: 'sg-slider' },
          el('label', { text: DIPLOMA_LABELS[key], attrs: { for: id } }),
          input,
          output,
        ),
      );
    }
    this.retiredOn.addEventListener('change', () => {
      if (this.retiredOn.checked) {
        const v = Number(this.retiredScore.value);
        actions.setRetired(
          this.retiredScore.value !== '' && Number.isFinite(v) ? v : DEFAULT_RETIRED_SCORE,
        );
      } else {
        actions.setRetired('off');
      }
    });
    this.retiredScore.addEventListener('change', () => {
      const v = Number(this.retiredScore.value);
      if (this.retiredScore.value !== '' && Number.isFinite(v)) actions.setRetired(v);
    });
    this.reset.addEventListener('click', () => actions.resetParams());

    this.tuning = el(
      'div',
      { class: 'sg-panel__group' },
      el('p', {
        class: 'sg-note',
        text:
          'Score X : patrimoine / niveau de vie. Score Y : somme des parts de diplômes, ' +
          'multipliées par les poids ci-dessous. Les méthodes placent ensuite ces scores sur [−10, 10].',
      }),
      list,
      el(
        'div',
        { class: 'sg-row' },
        el('label', { class: 'sg-check' }, this.retiredOn, 'Imposer un score Y aux retraités'),
        this.retiredScore,
      ),
      el('div', { class: 'sg-row' }, this.reset),
    );
    host.append(this.tuning, this.note);
  }

  sync(view: ResolvedView, state: AppState): void {
    const enabled = view.canRecompute;
    this.tuning.hidden = !enabled;
    for (const key of DIPLOMA_KEYS) {
      const row = this.sliders.get(key);
      if (!row) continue;
      const value = view.params.y_weights[key];
      row.input.value = String(value);
      row.input.disabled = !enabled;
      row.output.textContent = formatNumber(value, Number.isInteger(value) ? 0 : 1);
    }
    const retired = view.params.retired_y_override;
    this.retiredOn.checked = retired !== null;
    this.retiredOn.disabled = !enabled;
    if (retired !== null) this.retiredScore.value = String(retired.score);
    else if (this.retiredScore.value === '')
      this.retiredScore.value = String(DEFAULT_RETIRED_SCORE);
    this.retiredScore.disabled = !enabled || retired === null;
    this.reset.disabled = state.weights === null && state.retired === 'default';
    this.note.textContent = view.recomputeBlock ?? 'Le graphique se recalcule à chaque réglage.';
  }
}
