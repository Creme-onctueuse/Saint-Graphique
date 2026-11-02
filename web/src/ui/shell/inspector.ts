/**
 * Inspecteur : le détail du repère sélectionné. Pour un électorat, sa sur- et sous-représentation et
 * ses voisins ; pour une catégorie, le vote de son groupe ; pour deux repères, un duel.
 * Texte en DOM, jamais en innerHTML. La mise en forme est dans crossing.css.
 */
import './crossing.css';
import type { ChartCandidate, ChartPcs } from '../../chart/types.ts';
import { duelRows, misleadinglyClose, neighbors } from '../../core/compare.ts';
import { compositionByGroup, compositionGap, representation } from '../../core/crossing.ts';
import { formatNumber, formatPct, MINUS, NBSP } from '../../core/format.ts';
import { GROUP_SHORT_NAMES } from '../../core/groups.ts';
import type { AppState } from '../../core/state.ts';
import type { Point, RawElection } from '../../core/types.ts';
import type { ResolvedView } from '../../view.ts';
import { lensForPcs, type CrossingInfo, type LensInfo } from '../../viewCrossing.ts';
import type { AppActions, Feature } from '../actions.ts';
import { el } from '../dom.ts';
import { icon } from '../icons.ts';

/** Voisins affichés. */
const NEIGHBOR_COUNT = 5;
const NEAREST_ON_MAP_COUNT = 3;

function points(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? MINUS : '';
  return `${sign}${formatNumber(Math.abs(value), 1)}${NBSP}pts`;
}

function candidateColor(c: { color: string; isAbstention: boolean }): string {
  return c.isAbstention ? `var(--sg-abstention, ${c.color})` : c.color;
}

function swatch(color: string, shape: 'disc' | 'diamond'): HTMLSpanElement {
  const node = el('span', {
    class: `sg-swatch sg-swatch--${shape}`,
    attrs: { 'aria-hidden': 'true' },
  });
  node.style.setProperty('--sg-swatch', color);
  return node;
}

function groupName(key: string, election: RawElection, groupOf: (code: string) => string): string {
  const name = GROUP_SHORT_NAMES[key] ?? `Groupe ${key}`;
  if (key !== '2') return name;
  const separate = election.candidates.some(
    (c) => (compositionByGroup(election, c.id, groupOf)['1'] ?? 0) > 0,
  );
  return separate ? name : 'Indépendants, agriculteurs';
}

function section(title: string, ...children: (Node | null)[]): HTMLElement {
  return el('section', { class: 'sg-ins__section' }, el('h3', { text: title }), ...children);
}

function stat(id: string, label: string, value: string): HTMLDivElement {
  return el(
    'div',
    { class: 'sg-stat', attrs: { id } },
    el('span', { class: 'sg-stat__value', text: value }),
    el('span', { class: 'sg-stat__label', text: label }),
  );
}

/** Barre centrée : la longueur dit l'écart, le sens dit s'il est positif ou négatif. */
function divergingBar(delta: number, scale: number, color: string): HTMLSpanElement {
  const fill = el('span', {
    class: `sg-div__fill sg-div__fill--${delta >= 0 ? 'pos' : 'neg'}`,
  });
  fill.style.width = `${scale > 0 ? (50 * Math.abs(delta)) / scale : 0}%`;
  fill.style.background = color;
  return el('span', { class: 'sg-div__track' }, fill);
}

function rankedBar(share: number, max: number, color: string): HTMLSpanElement {
  const fill = el('span', { class: 'sg-bar__fill' });
  fill.style.width = `${max > 0 ? (100 * share) / max : 0}%`;
  fill.style.background = color;
  return el('span', { class: 'sg-bar__track' }, fill);
}

export class Inspector implements Feature {
  private readonly host: HTMLElement;
  private readonly actions: AppActions;
  private readonly banner: HTMLElement;
  private readonly bannerText = el('span', { attrs: { id: 'sg-lens-text' } });
  private view: ResolvedView | null = null;
  private state: AppState | null = null;
  private renderKey = '';
  private compareOpen = false;

  constructor(host: HTMLElement, actions: AppActions) {
    this.host = host;
    this.actions = actions;
    const reset = el('button', {
      class: 'sg-btn sg-lens-banner__reset',
      text: 'Revenir à la carte',
      attrs: { type: 'button', id: 'sg-lens-reset' },
    });
    reset.addEventListener('click', () => this.clear());
    this.banner = el(
      'div',
      { class: 'sg-lens-banner sg-float', attrs: { id: 'sg-lens-banner', role: 'status' } },
      this.bannerText,
      reset,
    );
    this.banner.hidden = true;
    document.body.append(this.banner);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.state?.selected) return;
      if (document.querySelector('dialog[open]')) return;
      this.clear();
    });
  }

  private clear(): void {
    this.compareOpen = false;
    this.actions.patch({ selected: null, compared: null }, 'fast');
  }

  private compareWith(key: string): void {
    this.compareOpen = false;
    this.actions.patch({ compared: key }, 'fast');
  }

  sync(view: ResolvedView, state: AppState): void {
    this.view = view;
    this.state = state;
    const crossing = view.crossing;
    const visible = Boolean(crossing?.selected) || Boolean(crossing?.absent);
    this.host.hidden = !visible;
    this.syncBanner(crossing);
    if (!crossing || !visible) {
      this.renderKey = '';
      this.compareOpen = false;
      return;
    }
    const key = [
      crossing.selected?.key,
      crossing.compared?.key,
      crossing.absent,
      view.electionId,
      view.method.id,
      crossing.mode,
      view.model.candidates.map((c) => `${c.id}:${c.x}:${c.y}`).join(','),
      this.compareOpen,
    ].join('|');
    if (key === this.renderKey) return;
    this.renderKey = key;
    this.host.replaceChildren(...this.content(view, crossing));
  }

  private syncBanner(crossing: CrossingInfo | undefined): void {
    const pollGroup = crossing?.lens?.pollGroup;
    const election = this.view?.rawElection;
    const shown = Boolean(pollGroup && election && crossing);
    this.banner.hidden = !shown;
    if (pollGroup && election && crossing) {
      const name = groupName(pollGroup, election, crossing.groupOf);
      this.bannerText.textContent = `Vue depuis : ${name}. La taille des losanges montre le vote de ce groupe.`;
    }
  }

  private head(
    title: string,
    subtitle: string,
    mark: Node | null,
    canCompare: boolean,
  ): HTMLElement {
    const actions = el('div', { class: 'sg-ins__actions' });
    if (canCompare) {
      const compare = el(
        'button',
        {
          class: 'sg-btn sg-ins__compare',
          attrs: {
            id: 'sg-inspector-compare',
            type: 'button',
            'aria-expanded': String(this.compareOpen),
          },
        },
        el('span', { class: 'sg-icon' }, icon('compare')),
        'Comparer',
      );
      compare.addEventListener('click', () => {
        this.compareOpen = !this.compareOpen;
        if (this.view && this.state) {
          this.renderKey = '';
          this.sync(this.view, this.state);
          document.getElementById('sg-inspector-compare')?.focus();
        }
      });
      actions.append(compare);
    }
    const close = el(
      'button',
      {
        class: 'sg-iconbtn',
        attrs: {
          id: 'sg-inspector-close',
          type: 'button',
          'aria-label': 'Fermer le détail',
          title: 'Fermer le détail',
        },
      },
      el('span', { class: 'sg-icon' }, icon('close')),
    );
    close.addEventListener('click', () => this.clear());
    actions.append(close);
    return el(
      'header',
      { class: 'sg-ins__head' },
      el(
        'div',
        { class: 'sg-ins__title' },
        el('h2', {}, mark, title),
        el('p', { class: 'sg-note', text: subtitle }),
      ),
      actions,
    );
  }

  private content(view: ResolvedView, crossing: CrossingInfo): Node[] {
    const { selected, compared, absent } = crossing;
    if (!selected) {
      return [
        this.head(absent ?? 'Sélection', 'Pas d’électorat à cette élection.', null, false),
        el(
          'div',
          { class: 'sg-ins__body' },
          el('p', {
            class: 'sg-note',
            text: 'Cette famille ne se présentait pas seule à ce scrutin. Changez d’élection sur la frise pour la retrouver.',
          }),
        ),
      ];
    }
    if (selected.kind === 'candidate') {
      if (compared?.kind === 'candidate') {
        return this.candidateDuel(view, crossing, selected.candidate, compared.candidate);
      }
      return this.candidateDetail(view, crossing, selected.candidate);
    }
    if (compared?.kind === 'pcs') {
      return this.categoryDuel(view, crossing, selected.pcs, compared.pcs);
    }
    return this.categoryDetail(view, crossing, selected.pcs);
  }

  // --- Électorat ------------------------------------------------------------------------------

  private candidateDetail(view: ResolvedView, crossing: CrossingInfo, c: ChartCandidate): Node[] {
    const subtitle =
      c.share === null
        ? ''
        : c.isAbstention
          ? `${formatPct(c.share)} des inscrits`
          : `${formatPct(c.share)} des suffrages exprimés`;
    const body = el('div', { class: 'sg-ins__body' });
    const election = view.rawElection;
    if (this.compareOpen) body.append(this.compareList(view, c.id));
    if (election) {
      const rows = representation(election, c.id, crossing.groupOf);
      const scale = Math.max(...rows.map((r) => Math.abs(r.delta)), 1e-9);
      const list = el(
        'ul',
        { class: 'sg-div', attrs: { id: 'sg-inspector-representation' } },
        ...rows.map((r) =>
          el(
            'li',
            { class: 'sg-div__row' },
            el('span', { class: 'sg-div__label' }, groupName(r.group, election, crossing.groupOf)),
            divergingBar(r.delta, scale, `var(--sg-group-${r.group}, var(--sg-text-muted))`),
            el('span', { class: 'sg-div__value', text: points(r.delta) }),
          ),
        ),
      );
      body.append(
        section(
          'Qui est surreprésenté dans cet électorat ?',
          list,
          el('p', {
            class: 'sg-note',
            text: 'Écart entre la part du groupe dans cet électorat et sa part parmi tous les inscrits.',
          }),
        ),
      );
      const positions = new Map<string, Point>(
        view.model.candidates.map((o) => [o.id, { x: o.x, y: o.y }]),
      );
      const nearest = neighbors(election, c.id, positions, crossing.groupOf).slice(
        0,
        NEIGHBOR_COUNT,
      );
      body.append(
        section(
          'Électorats les plus ressemblants',
          this.neighborTable(view, crossing, nearest),
          el('p', { class: 'sg-note', text: 'Cliquez sur une ligne pour lancer le duel.' }),
        ),
      );
    }
    return [this.head(c.label, subtitle, swatch(candidateColor(c), 'diamond'), true), body];
  }

  private neighborTable(
    view: ResolvedView,
    crossing: CrossingInfo,
    rows: { id: string; gap: number; distance: number }[],
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
          swatch(candidateColor(other), 'diamond'),
          other.label,
        ),
        el('span', { class: 'sg-num', text: `${formatNumber(row.gap, 1)}${NBSP}pts` }),
        el('span', { class: 'sg-num', text: formatNumber(row.distance) }),
      );
      button.addEventListener('click', () => this.compareWith(`c:${row.id}`));
      table.append(button);
    }
    return table;
  }

  private compareList(view: ResolvedView, exclude: string): HTMLElement {
    const list = el('div', { class: 'sg-compare', attrs: { id: 'sg-compare-list' } });
    const others = view.model.candidates
      .filter((o) => o.id !== exclude)
      .sort((a, b) => (b.share ?? 0) - (a.share ?? 0));
    for (const other of others) {
      const button = el(
        'button',
        { class: 'sg-compare__item', attrs: { type: 'button', 'data-compare': `c:${other.id}` } },
        swatch(candidateColor(other), 'diamond'),
        other.label,
      );
      button.addEventListener('click', () => this.compareWith(`c:${other.id}`));
      list.append(button);
    }
    return section('Comparer avec', list);
  }

  private candidateDuel(
    view: ResolvedView,
    crossing: CrossingInfo,
    a: ChartCandidate,
    b: ChartCandidate,
  ): Node[] {
    const election = view.rawElection;
    const body = el('div', { class: 'sg-ins__body' });
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (election) {
      const sa = compositionByGroup(election, a.id, crossing.groupOf);
      const sb = compositionByGroup(election, b.id, crossing.groupOf);
      const gap = compositionGap(sa, sb);
      body.append(
        el(
          'div',
          { class: 'sg-stats' },
          stat('sg-duel-gap', 'Écart de composition', `${formatNumber(gap, 1)}${NBSP}pts`),
          stat(
            'sg-duel-distance',
            crossing.mode === 'proximity' ? 'Distance sur le plan' : 'Distance sur la carte',
            formatNumber(distance),
          ),
        ),
        el('p', {
          class: 'sg-note',
          text: `Il faudrait que ${formatNumber(gap, 0)} % des électeurs changent de groupe pour que ces deux électorats aient la même composition.`,
        }),
      );
      if (crossing.mode !== 'proximity' && misleadinglyClose(distance, gap)) {
        body.append(
          el('p', {
            class: 'sg-ins__alert',
            attrs: { id: 'sg-duel-misleading' },
            text: 'Voisins sur la carte, mais de composition différente : un barycentre peut cacher des électorats très différents.',
          }),
        );
      }
      body.append(
        section(
          'Composition, groupe par groupe',
          this.butterfly(
            a.label,
            candidateColor(a),
            b.label,
            candidateColor(b),
            duelRows(sa, sb).map((r) => ({
              label: groupName(r.key, election, crossing.groupOf),
              a: r.a,
              b: r.b,
            })),
          ),
        ),
      );
    }
    const title = `${a.label} / ${b.label}`;
    return [this.head(title, 'Duel', null, false), body];
  }

  private butterfly(
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
        el('span', {}, swatch(colorA, 'diamond'), nameA),
        el('span', {}, swatch(colorB, 'diamond'), nameB),
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

  // --- Catégorie ------------------------------------------------------------------------------

  private categoryDetail(view: ResolvedView, crossing: CrossingInfo, p: ChartPcs): Node[] {
    const body = el('div', { class: 'sg-ins__body' });
    if (this.compareOpen) body.append(this.groupCompareList(view, p));
    body.append(this.voteSection(view, crossing, p, crossing.lens));
    if (view.model.candidates.length > 0) {
      const rows = view.model.candidates
        .map((c) => ({ c, distance: Math.hypot(c.x - p.x, c.y - p.y) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, NEAREST_ON_MAP_COUNT);
      body.append(
        section(
          'Électorats les plus proches sur la carte',
          el(
            'ul',
            { class: 'sg-plainlist', attrs: { id: 'sg-inspector-nearest' } },
            ...rows.map(({ c, distance }) =>
              el(
                'li',
                {},
                swatch(candidateColor(c), 'diamond'),
                el('span', { class: 'sg-plainlist__label', text: c.label }),
                el('span', { class: 'sg-num', text: formatNumber(distance) }),
              ),
            ),
          ),
        ),
      );
    }
    const subtitle = `${p.groupLabel} · ${formatPct(p.weight)} de la population`;
    const hasVotes = crossing.lens !== null && crossing.lens.pollGroup !== null;
    return [
      this.head(
        p.label,
        subtitle,
        swatch(`var(--sg-group-${p.group}, ${p.color})`, 'disc'),
        hasVotes,
      ),
      body,
    ];
  }

  private voteSection(
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
        text: 'Parts calculées parmi les inscrits du groupe, abstention comprise.',
      }),
    );
  }

  /** Comparer deux catégories revient à comparer leurs groupes : un bouton par groupe. */
  private groupCompareList(view: ResolvedView, p: ChartPcs): HTMLElement {
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
      button.addEventListener('click', () => this.compareWith(`p:${other.code}`));
      list.append(button);
    }
    return section('Comparer avec le groupe', list);
  }

  private categoryDuel(
    view: ResolvedView,
    crossing: CrossingInfo,
    a: ChartPcs,
    b: ChartPcs,
  ): Node[] {
    const election = view.rawElection;
    const body = el('div', { class: 'sg-ins__body' });
    const title = `${a.short} / ${b.short}`;
    if (!election) return [this.head(title, 'Duel', null, false), body];
    const lensA = crossing.lens;
    const lensB = lensForPcs(view, b, crossing.groupOf);
    const votesOf = (lens: LensInfo | null): Map<string, number> | null =>
      lens && lens.pollGroup !== null ? new Map(lens.rows.map((r) => [r.id, r.share])) : null;
    const va = votesOf(lensA);
    const vb = votesOf(lensB);
    const nameOf = (lens: LensInfo | null, p: ChartPcs): string =>
      lens?.pollGroup ? groupName(lens.pollGroup, election, crossing.groupOf) : p.groupLabel;
    if (!va || !vb) {
      body.append(
        el('p', {
          class: 'sg-ins__alert',
          text: 'Pas de duel possible : les sondages n’isolent pas l’un de ces groupes.',
        }),
      );
      return [this.head(title, 'Duel', null, false), body];
    }
    if (lensA?.pollGroup === lensB?.pollGroup) {
      body.append(
        el('p', {
          class: 'sg-ins__alert',
          text: 'Ces deux catégories appartiennent au même groupe de sondage : leurs votes ne se distinguent pas.',
        }),
      );
      return [this.head(title, 'Duel', null, false), body];
    }
    const gap = compositionGap(Object.fromEntries(va), Object.fromEntries(vb));
    const labels = new Map(view.model.candidates.map((c) => [c.id, c.label]));
    const rows = duelRows(Object.fromEntries(va), Object.fromEntries(vb))
      .filter((r) => r.a >= 1 || r.b >= 1)
      .map((r) => ({ label: labels.get(r.key) ?? r.key, a: r.a, b: r.b }));
    body.append(
      el(
        'div',
        { class: 'sg-stats' },
        stat('sg-duel-gap', 'Écart entre leurs votes', `${formatNumber(gap, 1)}${NBSP}pts`),
        stat(
          'sg-duel-distance',
          'Distance sur la carte',
          formatNumber(Math.hypot(a.x - b.x, a.y - b.y)),
        ),
      ),
      section(
        'Vote, électorat par électorat',
        this.butterfly(
          nameOf(lensA, a),
          `var(--sg-group-${a.group}, ${a.color})`,
          nameOf(lensB, b),
          `var(--sg-group-${b.group}, ${b.color})`,
          rows,
        ),
        el('p', {
          class: 'sg-note',
          text: 'Parts parmi les inscrits de chaque groupe, abstention comprise.',
        }),
      ),
    );
    return [this.head(title, 'Duel de groupes', null, false), body];
  }
}
