/** Panneau « À propos » : les méthodes viennent des données, les crédits de index.html. */
import type { Dataset } from '../data/dataset.ts';
import { availableMethods } from '../view.ts';
import { byId, el } from './dom.ts';

export function initAbout(ds: Dataset): void {
  const dialog = byId<HTMLDialogElement>('sg-about');
  byId('sg-about-open').addEventListener('click', () => dialog.showModal());
  byId('sg-credits-open').addEventListener('click', () => {
    dialog.showModal();
    byId('sg-credits').scrollIntoView({ block: 'start' });
  });
  byId('sg-about-close').addEventListener('click', () => dialog.close());
  // Un clic sur le fond (hors du contenu) ferme le panneau.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  byId('sg-about-x').textContent = `${ds.axes.xLabel} (axe horizontal) : ${ds.axes.xHint}.`;
  byId('sg-about-y').textContent = `${ds.axes.yLabel} (axe vertical) : ${ds.axes.yHint}.`;

  byId('sg-about-methods').replaceChildren(
    ...availableMethods(ds).map((m) =>
      el('li', {}, el('strong', { text: m.label }), m.description ? ` : ${m.description}` : ''),
    ),
  );
}
