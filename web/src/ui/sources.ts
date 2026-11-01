/**
 * Sources affichées sous le graphique. Tout vient des données brutes (sources de l'élection et de
 * pcs.json) : aucune source n'est écrite en dur ici.
 */
import type { SourceRef } from '../core/types.ts';
import type { ResolvedView } from '../view.ts';
import { el } from './dom.ts';

/** Institut et titre d'une source ; l'institut n'est pas répété si le titre commence par lui. */
export function sourceText(s: SourceRef): string {
  return s.publisher && !s.title.startsWith(s.publisher) ? `${s.publisher} : ${s.title}` : s.title;
}

function sourceNode(s: SourceRef): Node {
  const text = sourceText(s);
  return /^https?:\/\//.test(s.url)
    ? el('a', { text, attrs: { href: s.url, target: '_blank', rel: 'noopener' } })
    : document.createTextNode(text);
}

function row(label: string, sources: readonly SourceRef[]): HTMLParagraphElement {
  const line = el('p', {}, el('span', { class: 'sg-sources__label', text: `${label} : ` }));
  if (sources.length === 0) {
    line.append('source absente des données chargées (voir data/SOURCES.md).');
  }
  sources.forEach((s, i) => {
    if (i > 0) line.append(' ; ');
    line.append(sourceNode(s));
  });
  return line;
}

export function renderSources(host: HTMLElement, view: ResolvedView): void {
  host.replaceChildren(
    ...(view.isPopulation ? [] : [row('Sondage', view.sources.poll)]),
    row('Population, diplômes, revenus et patrimoine', view.sources.pcs),
  );
}
