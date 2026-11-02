/** Choix de la méthode, dans le panneau « Méthode ». L'élection se choisit sur la frise. */
import type { Dataset } from '../data/dataset.ts';
import { availableMethods, type ResolvedView } from '../view.ts';
import type { AppActions } from './actions.ts';
import { byId, el } from './dom.ts';

export class Controls {
  private readonly method = byId<HTMLSelectElement>('sg-method');
  private readonly description = byId<HTMLParagraphElement>('sg-method-desc');

  constructor(ds: Dataset, actions: AppActions) {
    this.method.append(
      ...availableMethods(ds).map((m) => el('option', { text: m.label, attrs: { value: m.id } })),
    );
    this.method.addEventListener('change', () => actions.setMethod(this.method.value));
  }

  sync(view: ResolvedView): void {
    this.method.value = view.method.id;
    this.description.textContent = view.method.exploratory
      ? `Méthode exploratoire. ${view.method.description}`
      : view.method.description;
  }
}
