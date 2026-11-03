/**
 * Morceaux sans état de l'inspecteur : pastilles, barres, tableau des voisins, listes de comparaison,
 * duel en papillon et vote d'un groupe. La mise en forme est dans crossing.css.
 */
import type { ChartPcs } from '../../chart/types.ts';
import { compositionByGroup, hasAbstentionBreakdown } from '../../core/crossing.ts';
import { formatNumber, formatPct, MINUS, NBSP } from '../../core/format.ts';
import { GROUP_SHORT_NAMES } from '../../core/groups.ts';
import type { RawElection } from '../../core/types.ts';
import type { ResolvedView } from '../../view.ts';
import type { CrossingInfo, LensInfo } from '../../viewCrossing.ts';
import { el } from '../dom.ts';

export function points(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? MINUS : '';
  return `${sign}${formatNumber(Math.abs(value), 1)}${NBSP}pts`;
}

export function candidateColor(c: { color: string; isAbstention: boolean }): string {
  return c.isAbstention ? `var(--sg-abstention, ${c.color})` : c.color;
}

export function swatch(color: string, shape: 'disc' | 'bubble'): HTMLSpanElement {
  const node = el('span', {
    class: `sg-swatch sg-swatch--${shape}`,
    attrs: { 'aria-hidden': 'true' },
  });
  node.style.setProperty('--sg-swatch', color);
  return node;
}

export function groupName(
  key: string,
  election: RawElection,
  groupOf: (code: string) => string,
): string {
  const name = GROUP_SHORT_NAMES[key] ?? `Groupe ${key}`;
  if (key !== '2') return name;
  const separate = election.candidates.some(
    (c) => (compositionByGroup(election, c.id, groupOf)['1'] ?? 0) > 0,
  );
  return separate ? name : 'Indépendants, agriculteurs';
}

export function section(title: string, ...children: (Node | null)[]): HTMLElement {
  return el('section', { class: 'sg-ins__section' }, el('h3', { text: title }), ...children);
}

export function stat(id: string, label: string, value: string): HTMLDivElement {
  return el(
    'div',
    { class: 'sg-stat', attrs: { id } },
    el('span', { class: 'sg-stat__value', text: value }),
    el('span', { class: 'sg-stat__label', text: label }),
  );
}

/** Barre centrée : la longueur dit l'écart, le sens dit s'il est positif ou négatif. */
export function divergingBar(delta: number, scale: number, color: string): HTMLSpanElement {
  const fill = el('span', {
    class: `sg-div__fill sg-div__fill--${delta >= 0 ? 'pos' : 'neg'}`,
  });
  fill.style.width = `${scale > 0 ? (50 * Math.abs(delta)) / scale : 0}%`;
  fill.style.background = color;
  return el('span', { class: 'sg-div__track' }, fill);
}

export function rankedBar(share: number, max: number, color: string): HTMLSpanElement {
  const fill = el('span', { class: 'sg-bar__fill' });
  fill.style.width = `${max > 0 ? (100 * share) / max : 0}%`;
  fill.style.background = color;
  return el('span', { class: 'sg-bar__track' }, fill);
}

/** Sur quoi se lisent les parts d'un groupe : sans détail de l'abstention, sur ses seuls votants. */
export function partsNote(election: RawElection, scope: string): string {
  return hasAbstentionBreakdown(election)
    ? `Parts calculées parmi les inscrits ${scope}, abstention comprise.`
    : `Parts calculées parmi les votants ${scope} : ce sondage ne détaille pas l’abstention.`;
}

export function neighborTable(
  view: ResolvedView,
  crossing: CrossingInfo,
  rows: { id: string; gap: number; distance: number }[],
  pick: (key: string) => void,
): HTMLElement {
  const map = crossing.mode === 'proximity' ? 'Plan' : 'Carte';
  const table = el(
    'div',
    { class: 'sg-neighbors', attrs: { id: 'sg-inspector-neighbors' } },
    el(
      'div',
      { class: 'sg-neighbors__head' },
      el('span', { text: 'Électorat' }),
      el('span', { text: 'Composition' }),
      el('span', { text: map }),
    ),
  );
  for (const row of rows) {
    const other = view.model.candidates.find((o) => o.id === row.id);
    if (!other) continue;
    const button = el(
      'button',
      { class: 'sg-neighbors__row', attrs: { type: 'button', 'data-compare': `c:${row.id}` } },
      el(
        'span',
        { class: 'sg-neighbors__name' },
        swatch(candidateColor(other), 'bubble'),
        other.label,
      ),
      el('span', { class: 'sg-num', text: `${formatNumber(row.gap, 1)}${NBSP}pts` }),
      el('span', { class: 'sg-num', text: formatNumber(row.distance) }),
    );
    button.addEventListener('click', () => pick(`c:${row.id}`));
    table.append(button);
  }
  return table;
}

export function compareList(
  view: ResolvedView,
  exclude: string,
  pick: (key: string) => void,
): HTMLElement {
  const list = el('div', { class: 'sg-compare', attrs: { id: 'sg-compare-list' } });
  const others = view.model.candidates
    .filter((o) => o.id !== exclude)
    .sort((a, b) => (b.share ?? 0) - (a.share ?? 0));
  for (const other of others) {
    const button = el(
      'button',
      { class: 'sg-compare__item', attrs: { type: 'button', 'data-compare': `c:${other.id}` } },
      swatch(candidateColor(other), 'bubble'),
      other.label,
    );
    button.addEventListener('click', () => pick(`c:${other.id}`));
    list.append(button);
  }
  return section('Comparer avec', list);
}

export function butterfly(
  nameA: string,
  colorA: string,
  nameB: string,
  colorB: string,
  rows: { label: string; a: number; b: number }[],
): HTMLElement {
  const max = Math.max(...rows.flatMap((r) => [r.a, r.b]), 1e-9);
  const side = (value: number, color: string, cls: string): HTMLElement => {
    const fill = el('span', { class: 'sg-duel__fill' });
    fill.style.width = `${(100 * value) / max}%`;
    fill.style.background = color;
    return el(
      'span',
      { class: `sg-duel__side ${cls}` },
      el('span', { class: 'sg-duel__value', text: formatPct(value, 0) }),
      el('span', { class: 'sg-duel__track' }, fill),
    );
  };
  return el(
    'div',
    { class: 'sg-duel', attrs: { id: 'sg-inspector-duel' } },
    el(
      'div',
      { class: 'sg-duel__legend' },
      el('span', {}, swatch(colorA, 'bubble'), nameA),
      el('span', {}, swatch(colorB, 'bubble'), nameB),
    ),
    ...rows.flatMap((r) => [
      el('span', { class: 'sg-duel__label', text: r.label }),
      el(
        'div',
        { class: 'sg-duel__row' },
        side(r.a, colorA, 'sg-duel__side--a'),
        side(r.b, colorB, 'sg-duel__side--b'),
      ),
    ]),
  );
}

export function voteSection(
  view: ResolvedView,
  crossing: CrossingInfo,
  p: ChartPcs,
  lens: LensInfo | null,
): HTMLElement {
  const election = view.rawElection;
  if (!election || !lens) {
    return section(
      'Comment vote ce groupe ?',
      el('p', {
        class: 'sg-note',
        text: 'Aucune élection affichée : choisissez un scrutin sur la frise pour voir ce vote.',
      }),
    );
  }
  if (lens.pollGroup === null) {
    return section(
      'Comment vote ce groupe ?',
      el('p', {
        class: 'sg-ins__alert',
        attrs: { id: 'sg-inspector-novote' },
        text: 'Pas de donnée de vote : les sondages n’isolent pas ce groupe.',
      }),
    );
  }
  const max = Math.max(...lens.rows.map((r) => r.share), 1e-9);
  const name = groupName(lens.pollGroup, election, crossing.groupOf);
  return section(
    `Comment vote le groupe : ${name}`,
    el('p', {
      class: 'sg-note',
      attrs: { id: 'sg-inspector-vote-note' },
      text: lens.merged
        ? `Vote de tout le groupe, et non de « ${p.short} » seule : les sondages réunissent les agriculteurs avec les artisans, commerçants et chefs d’entreprise.`
        : `Vote de tout le groupe, et non de « ${p.short} » seule : les sondages ne détaillent pas les catégories.`,
    }),
    el(
      'ul',
      { class: 'sg-bars', attrs: { id: 'sg-inspector-votes' } },
      ...lens.rows.map((r) =>
        el(
          'li',
          { class: 'sg-bars__row' },
          el('span', { class: 'sg-bars__label', text: r.label }),
          rankedBar(r.share, max, candidateColor(r)),
          el('span', { class: 'sg-bars__value', text: formatPct(r.share, 0) }),
        ),
      ),
    ),
    el('p', {
      class: 'sg-note',
      text: partsNote(election, 'du groupe'),
    }),
  );
}

/** Comparer deux catégories revient à comparer leurs groupes : un bouton par groupe. */
export function groupCompareList(
  view: ResolvedView,
  p: ChartPcs,
  pick: (key: string) => void,
): HTMLElement {
  const election = view.rawElection;
  const crossing = view.crossing;
  const list = el('div', { class: 'sg-compare', attrs: { id: 'sg-compare-list' } });
  if (!election || !crossing) return section('Comparer avec', list);
  const seen = new Set<string>([crossing.lens?.pollGroup ?? p.group]);
  const available = new Set(
    election.candidates.flatMap((c) =>
      Object.keys(compositionByGroup(election, c.id, crossing.groupOf)),
    ),
  );
  const byWeight = [...view.model.pcs].sort((a, b) => b.weight - a.weight);
  for (const other of byWeight) {
    const key = other.group === '1' && !available.has('1') ? '2' : other.group;
    if (seen.has(key) || !available.has(key)) continue;
    seen.add(key);
    const button = el(
      'button',
      {
        class: 'sg-compare__item',
        attrs: { type: 'button', 'data-compare': `p:${other.code}` },
      },
      swatch(`var(--sg-group-${key}, ${other.color})`, 'disc'),
      groupName(key, election, crossing.groupOf),
    );
    button.addEventListener('click', () => pick(`p:${other.code}`));
    list.append(button);
  }
  return section('Comparer avec le groupe', list);
}
