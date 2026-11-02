/**
 * Frise des élections, sur une vraie échelle de temps : une étape par année, un bouton par scrutin.
 * Boutons radio natifs : Tab et les flèches du clavier fonctionnent sans code.
 */
import type { AppState } from '../../core/state.ts';
import { POPULATION_ID } from '../../core/types.ts';
import type { Dataset, ElectionInfo } from '../../data/dataset.ts';
import type { ResolvedView } from '../../view.ts';
import type { AppActions, Feature } from '../actions.ts';
import { el } from '../dom.ts';

const TYPE_LETTER: Record<string, string> = {
  presidentielle: 'P',
  legislatives: 'L',
  europeennes: 'E',
};

function stop(id: string, letter: string, label: string, actions: AppActions): HTMLLabelElement {
  const input = el('input', {
    class: 'sg-sr-only',
    attrs: { type: 'radio', name: 'sg-election', value: id, 'aria-label': label },
  });
  input.addEventListener('change', () => {
    if (input.checked) actions.setElection(id);
  });
  return el(
    'label',
    { class: 'sg-stop', attrs: { title: label } },
    input,
    el('span', { class: 'sg-stop__dot', text: letter, attrs: { 'aria-hidden': 'true' } }),
  );
}

export class Timeline implements Feature {
  private readonly inputs: HTMLInputElement[];

  constructor(host: HTMLElement, ds: Dataset, actions: AppActions) {
    const years = new Map<number, ElectionInfo[]>();
    for (const e of ds.elections) {
      const year = e.year ?? 0;
      const list = years.get(year);
      if (list) list.push(e);
      else years.set(year, [e]);
    }
    const sorted = [...years.keys()].sort((a, b) => a - b);
    const first = sorted[0] ?? 0;
    const span = Math.max(1, (sorted.at(-1) ?? 0) - first);

    const track = el('div', { class: 'sg-timeline__track' });
    for (const year of sorted) {
      const stops = (years.get(year) ?? []).map((e) =>
        stop(e.id, TYPE_LETTER[e.type ?? ''] ?? '•', e.label, actions),
      );
      const group = el(
        'div',
        { class: 'sg-year' },
        el('div', { class: 'sg-year__stops' }, ...stops),
        el('span', { class: 'sg-year__label', text: String(year) }),
      );
      group.style.left = `${(100 * (year - first)) / span}%`;
      track.append(group);
    }
    const none = stop(POPULATION_ID, '∅', ds.populationLabel, actions);
    none.classList.add('sg-stop--none');
    host.append(
      el(
        'div',
        { class: 'sg-timeline__none' },
        none,
        el('span', { class: 'sg-year__label', text: 'Aucune' }),
      ),
      track,
    );
    this.inputs = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  }

  sync(view: ResolvedView, _state: AppState): void {
    for (const input of this.inputs) input.checked = input.value === view.electionId;
  }
}
