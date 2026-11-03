/**
 * Carte de la projection 2027 : le choix du scénario, le résultat du test sur le passé, toujours
 * visible à cette étape, et les fourchettes de score des blocs. Tous les chiffres viennent du fichier.
 */
import { formatNumber } from '../../core/format.ts';
import {
  projectionMarks,
  SCENARIO_LABELS,
  verdictText,
  type ProjectedBloc,
} from '../../core/projection.ts';
import type { AppState, Scenario } from '../../core/state.ts';
import type { ResolvedView } from '../../view.ts';
import type { AppActions, Feature } from '../actions.ts';
import { el, PHONE_WIDTH } from '../dom.ts';

/** Largeur où le détail s'ouvre de lui-même. */

const SCENARIOS: readonly Scenario[] = ['still', 'trend'];

function blocToken(id: string): string {
  return `var(--sg-bloc-${id.replace('_', '-')})`;
}

function rangeRow(bloc: ProjectedBloc, scenario: Scenario, max: number): HTMLLIElement {
  const [lo, hi] = bloc.score_range[scenario];
  const fill = el('span', { class: 'sg-range__fill' });
  fill.style.left = `${(100 * lo) / max}%`;
  fill.style.width = `${Math.max(1.5, (100 * (hi - lo)) / max)}%`;
  fill.style.background = blocToken(bloc.id);
  const title = bloc.tested ? bloc.label : `${bloc.label} : part des inscrits, hors du test`;
  return el(
    'li',
    { class: 'sg-range', attrs: { 'data-bloc': bloc.id, title } },
    el('span', { class: 'sg-range__label', text: bloc.label }),
    el('span', { class: 'sg-range__track' }, fill),
    el('span', {
      class: 'sg-range__value',
      text: `${formatNumber(lo, 0)} à ${formatNumber(hi, 0)} %`,
    }),
  );
}

export class ProjectionCard implements Feature {
  private readonly root: HTMLElement;
  private readonly inputs: HTMLInputElement[] = [];
  private readonly headline = el('p', { class: 'sg-projection-card__headline' });
  private readonly comparison = el('p', { class: 'sg-note' });
  private readonly position = el('dd');
  private readonly score = el('dd');
  private readonly dataEnd = el('p', { class: 'sg-note' });
  private readonly marks = el('p', { class: 'sg-note sg-projection-card__marks' });
  private readonly ranges = el('ul', { class: 'sg-ranges' });

  constructor(actions: AppActions) {
    const scenarios = el(
      'fieldset',
      { class: 'sg-scenario', attrs: { id: 'sg-scenario' } },
      el('legend', { class: 'sg-sr-only', text: 'Scénario de la projection' }),
      ...SCENARIOS.map((id) => {
        const input = el('input', {
          class: 'sg-sr-only',
          attrs: { type: 'radio', name: 'sg-scenario', value: id },
        });
        input.addEventListener('change', () => {
          if (input.checked) actions.patch({ scenario: id }, 'normal');
        });
        this.inputs.push(input);
        return el(
          'label',
          { class: 'sg-scenario__choice' },
          input,
          el('span', { text: SCENARIO_LABELS[id] }),
        );
      }),
    );
    const details = el(
      'details',
      { class: 'sg-projection-card__details' },
      el('summary', { text: 'Fourchettes de score par bloc' }),
      this.ranges,
      el('p', {
        class: 'sg-note',
        text: 'Score projeté, plus ou moins son erreur moyenne. Les partis n’ont qu’une position.',
      }),
    );
    details.open = window.innerWidth >= PHONE_WIDTH;
    this.root = el(
      'aside',
      {
        class: 'sg-projection-card sg-float',
        // La carte réserve sa place : elle ne doit cacher aucun électorat.
        attrs: { id: 'sg-projection', 'aria-label': 'Projection 2027', 'data-sg-reserve': '' },
      },
      el('h2', { class: 'sg-projection-card__title', text: 'Projection 2027' }),
      el('p', {
        class: 'sg-note sg-projection-card__intro',
        text: 'Où iraient les électorats selon deux scénarios. Pas une prévision du résultat.',
      }),
      scenarios,
      el(
        'div',
        {
          class: 'sg-projection-card__verdict',
          attrs: { id: 'sg-projection-verdict', role: 'note' },
        },
        this.headline,
        this.comparison,
        el(
          'dl',
          { class: 'sg-verdict-numbers' },
          el('dt', { text: 'Position' }),
          this.position,
          el('dt', { text: 'Score' }),
          this.score,
        ),
        this.dataEnd,
      ),
      this.marks,
      details,
    );
    this.root.hidden = true;
    document.body.append(this.root);
  }

  sync(view: ResolvedView, state: AppState): void {
    const file = view.projection;
    this.root.hidden = file === null;
    if (!file) return;
    for (const input of this.inputs) input.checked = input.value === state.scenario;
    const text = verdictText(file);
    this.headline.textContent = text.headline;
    this.comparison.textContent = text.comparison;
    this.position.textContent = text.position;
    this.score.textContent = text.score;
    this.dataEnd.textContent = text.dataEnd;
    this.marks.textContent = projectionMarks(file);
    const max = Math.max(
      10,
      ...file.blocs.flatMap((b) => [b.score_range.still[1], b.score_range.trend[1]]),
    );
    this.ranges.replaceChildren(...file.blocs.map((b) => rangeRow(b, state.scenario, max)));
  }
}
