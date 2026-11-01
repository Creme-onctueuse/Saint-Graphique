/** Panneau « À propos » : méthodes et sources viennent des données, les crédits de index.html. */
import type { Dataset } from '../data/dataset.ts';
import { availableMethods } from '../view.ts';
import { byId, el } from './dom.ts';

function sourceItem(s: Dataset['sources'][number]): HTMLLIElement {
  const details = [s.publisher, s.accessed ? `consulté le ${s.accessed}` : '', s.license]
    .filter(Boolean)
    .join(', ');
  const title: Node = /^https?:\/\//.test(s.url)
    ? el('a', {
        text: s.title,
        attrs: { href: s.url, target: '_blank', rel: 'noopener' },
      })
    : document.createTextNode(s.title);
  return el('li', {}, title, details ? ` (${details})` : '');
}

export function initAbout(ds: Dataset): void {
  const dialog = byId<HTMLDialogElement>('sg-about');
  byId('sg-about-open').addEventListener('click', () => dialog.showModal());
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

  const sources = ds.sources.map(sourceItem);
  byId('sg-about-sources').replaceChildren(
    ...sources,
    el('li', { text: 'Détail complet : data/SOURCES.md, dans le dépôt du projet.' }),
  );
}
