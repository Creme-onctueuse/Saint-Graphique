/** Barre de sélection : élection et méthode. */
import { POPULATION_ID } from '../core/types.ts';
import type { Dataset } from '../data/dataset.ts';
import { availableMethods, type ResolvedView } from '../view.ts';
import type { AppActions } from './actions.ts';
import { byId, el } from './dom.ts';

export class Controls {
  private readonly election = byId<HTMLSelectElement>('sg-election');
  private readonly method = byId<HTMLSelectElement>('sg-method');
  private readonly description = byId<HTMLParagraphElement>('sg-method-desc');

  constructor(ds: Dataset, actions: AppActions) {
    this.election.append(
      el('option', { text: ds.populationLabel, attrs: { value: POPULATION_ID } }),
      ...ds.elections.map((e) => el('option', { text: e.label, attrs: { value: e.id } })),
    );
    this.method.append(
      ...availableMethods(ds).map((m) => el('option', { text: m.label, attrs: { value: m.id } })),
    );
    this.election.addEventListener('change', () => actions.setElection(this.election.value));
    this.method.addEventListener('change', () => actions.setMethod(this.method.value));
  }

  sync(view: ResolvedView): void {
    this.election.value = view.electionId;
    this.method.value = view.method.id;
    this.description.textContent = view.method.description;
  }
}
