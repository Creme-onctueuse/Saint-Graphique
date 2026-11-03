/**
 * Sources, à la fin de la page : une ligne compacte, et le détail avec ses liens à l'ouverture.
 * Tout vient des données brutes (sources de l'élection et de pcs.json) : aucune source n'est écrite
 * en dur ici.
 */
import { shortPublisher } from '../core/format.ts';
import type { SourceRef } from '../core/types.ts';
import type { ResolvedView } from '../view.ts';
import { el } from './dom.ts';

/** Institut et titre d'une source ; l'institut n'est pas répété si le titre commence par lui. */
export function sourceText(s: SourceRef): string {
  return s.publisher && !s.title.startsWith(s.publisher) ? `${s.publisher} : ${s.title}` : s.title;
}

export { shortPublisher };

function publishers(sources: readonly SourceRef[]): string[] {
  return [...new Set(sources.flatMap((s) => (s.publisher ? [shortPublisher(s.publisher)] : [])))];
}

/** Ligne compacte : « Ifop-Fiducial 2022 · Insee · positions lues sur les vidéos de Chris ». */
export function compactSources(view: ResolvedView): string {
  const year = view.rawElection?.year;
  // Le sondage d'abord : les résultats officiels et les effectifs sont dans le détail.
  const shown = view.projection ? view.sources.poll : view.sources.poll.slice(0, 1);
  const poll = publishers(shown).map((p) => (year ? `${p} ${year}` : p));
  const read = view.sources.positions.length > 0;
  const others = publishers(read ? view.sources.positions : view.sources.pcs).filter(
    (p) => p !== 'PaduTeam',
  );
  const parts = [...poll, ...others, ...(read ? ['positions lues sur les vidéos de Chris'] : [])];
  return parts.join(' · ');
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

/** Détail des sources de la vue affichée, avec leurs liens. */
export function renderSources(host: HTMLElement, view: ResolvedView): void {
  host.replaceChildren(
    ...(view.isPopulation
      ? []
      : [
          row(
            view.sources.poll.length > 1 && !view.projection
              ? 'Sondage, résultats officiels et effectifs'
              : 'Sondage',
            view.sources.poll,
          ),
        ]),
    view.sources.positions.length > 0
      ? row('Positions et poids des catégories', view.sources.positions)
      : row('Population, diplômes, revenus et patrimoine', view.sources.pcs),
    el('p', { text: 'Détail complet : data/SOURCES.md, dans le dépôt du projet.' }),
  );
}
