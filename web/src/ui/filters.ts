/** Options d'affichage des panneaux : tout afficher ou masquer, libellés, ellipses. */
import type { AppState } from '../core/state.ts';
import type { ResolvedView } from '../view.ts';
import type { AppActions, Feature } from './actions.ts';
import { el } from './dom.ts';

export interface FilterHosts {
  electorates: HTMLElement;
  categories: HTMLElement;
  method: HTMLElement;
}

export class Filters implements Feature {
  private readonly showLabels = el('input', { attrs: { type: 'checkbox', id: 'sg-show-labels' } });
  private readonly showEllipses = el('input', {
    attrs: { type: 'checkbox', id: 'sg-show-ellipses' },
  });
  private readonly square = el('input', { attrs: { type: 'checkbox', id: 'sg-square' } });
  private readonly ellipsesLabel: HTMLLabelElement;
  private candidateIds: string[] = [];

  constructor(hosts: FilterHosts, actions: AppActions) {
    const allOn = el('button', {
      class: 'sg-btn',
      text: 'Tout afficher',
      attrs: { type: 'button' },
    });
    const allOff = el('button', {
      class: 'sg-btn',
      text: 'Tout masquer',
      attrs: { type: 'button' },
    });
    allOn.addEventListener('click', () => actions.setCandidatesVisible(this.candidateIds, true));
    allOff.addEventListener('click', () => actions.setCandidatesVisible(this.candidateIds, false));
    this.ellipsesLabel = el(
      'label',
      { class: 'sg-check' },
      this.showEllipses,
      'Ellipses de confiance à 95 %',
    );
    hosts.electorates.append(el('div', { class: 'sg-row' }, allOn, allOff), this.ellipsesLabel);
    hosts.categories.append(
      el('label', { class: 'sg-check' }, this.showLabels, 'Libellés sur la carte'),
    );
    hosts.method.append(
      el(
        'label',
        { class: 'sg-check' },
        this.square,
        'Proportions d’origine (carte carrée, mêmes échelles sur les deux axes)',
      ),
    );
    this.showLabels.addEventListener('change', () =>
      actions.setShowLabels(this.showLabels.checked),
    );
    this.showEllipses.addEventListener('change', () =>
      actions.setShowEllipses(this.showEllipses.checked),
    );
    this.square.addEventListener('change', () =>
      actions.patch({ square: this.square.checked }, 'normal'),
    );
  }

  sync(view: ResolvedView, state: AppState): void {
    this.candidateIds = view.model.candidates.map((c) => c.id);
    this.showLabels.checked = state.showLabels;
    this.showEllipses.checked = state.showEllipses;
    this.square.checked = state.square;
    this.ellipsesLabel.hidden = !view.hasEllipses;
  }
}
