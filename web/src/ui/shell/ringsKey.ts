/**
 * Légende des anneaux de vote, et leur équivalent en tableau : aucune valeur ne dépend du seul survol
 * ni de la seule couleur.
 */
import { ringName } from '../../chart/layers/rings.ts';
import { groupBase } from '../../core/crossing.ts';
import { formatPct } from '../../core/format.ts';
import type { AppState } from '../../core/state.ts';
import { blocVotes, usesMapAxes, type RingDatum } from '../../core/timeline.ts';
import type { Dataset } from '../../data/dataset.ts';
import type { ResolvedView } from '../../view.ts';
import type { Feature } from '../actions.ts';
import { el } from '../dom.ts';

function blocToken(id: string): string {
  return `var(--sg-bloc-${id.replace('_', '-')})`;
}

export class RingsKey implements Feature {
  private readonly ds: Dataset;
  private readonly root: HTMLElement;
  private readonly title = el('p', { class: 'sg-rings-key__title' });
  private readonly swatches = el('ul', { class: 'sg-rings-key__list' });
  private readonly table = el('div', { class: 'sg-table-wrap' });
  private readonly note = el('p', { class: 'sg-note' });

  constructor(ds: Dataset) {
    this.ds = ds;
    this.root = el(
      'aside',
      {
        class: 'sg-rings-key sg-float',
        attrs: { id: 'sg-rings-key', 'aria-label': 'Légende des anneaux de vote' },
      },
      this.title,
      this.swatches,
      el('details', {}, el('summary', { text: 'Tableau' }), this.table),
      this.note,
    );
    this.root.hidden = true;
    document.body.append(this.root);
  }

  private renderTable(rings: readonly RingDatum[], merged: boolean): HTMLTableElement {
    const parts = rings[0]?.parts ?? [];
    return el(
      'table',
      { class: 'sg-table' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { text: 'Groupe', attrs: { scope: 'col' } }),
          ...parts.map((p) =>
            el('th', { class: 'sg-num', text: p.label, attrs: { scope: 'col' } }),
          ),
        ),
      ),
      el(
        'tbody',
        {},
        ...rings.map((ring) =>
          el(
            'tr',
            {},
            el('td', { text: ringName(ring.group, merged) }),
            ...ring.parts.map((p) => el('td', { class: 'sg-num', text: formatPct(p.share, 0) })),
          ),
        ),
      ),
    );
  }

  sync(view: ResolvedView, state: AppState): void {
    const families = this.ds.families;
    const election = view.rawElection;
    const shown = state.showRings && families && election && usesMapAxes(state);
    this.root.hidden = !shown;
    if (!shown) return;
    const groupOf = (code: string): string => this.ds.pcsMeta.get(code)?.group ?? code.charAt(0);
    const rings = blocVotes(election, families, groupOf);
    const merged =
      view.model.pcs.some((p) => p.group === '1') && !rings.some((r) => r.group === '1');
    this.title.textContent = `Vote de chaque groupe : ${view.electionLabel}`;
    this.swatches.replaceChildren(
      ...(rings[0]?.parts ?? []).map((p) => {
        const swatch = el('span', { class: 'sg-swatch', attrs: { 'aria-hidden': 'true' } });
        swatch.style.setProperty('--sg-swatch', blocToken(p.bloc));
        return el('li', {}, swatch, p.label);
      }),
    );
    this.table.replaceChildren(this.renderTable(rings, merged));
    const base = groupBase(election) === 'inscrits' ? 'Parmi les inscrits' : 'Parmi les votants';
    this.note.textContent = `${base}. Ce sondage détaille ${rings.length} groupes seulement.`;
  }
}
