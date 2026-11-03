/**
 * Inspecteur : le détail du repère sélectionné. Pour un électorat, sa sur- et sous-représentation et
 * ses voisins ; pour une catégorie, le vote de son groupe ; pour deux repères, un duel.
 * Texte en DOM, jamais en innerHTML. La mise en forme est dans crossing.css.
 */
import './crossing.css';
import type { ChartCandidate, ChartPcs } from '../../chart/types.ts';
import { duelRows, misleadinglyClose, neighbors } from '../../core/compare.ts';
import {
  compositionByGroup,
  compositionGap,
  groupBase,
  representation,
} from '../../core/crossing.ts';
import { formatNumber, formatPct, NBSP } from '../../core/format.ts';
import type { AppState } from '../../core/state.ts';
import { familyOfCandidate } from '../../core/timeline.ts';
import type { Point } from '../../core/types.ts';
import type { Dataset } from '../../data/dataset.ts';
import type { ResolvedView } from '../../view.ts';
import { lensForPcs, type CrossingInfo, type LensInfo } from '../../viewCrossing.ts';
import type { AppActions, Feature } from '../actions.ts';
import { el } from '../dom.ts';
import { icon } from '../icons.ts';
import { familyHistorySection, projectionSection } from './familySection.ts';
import {
  butterfly,
  candidateColor,
  compareList,
  divergingBar,
  groupCompareList,
  groupName,
  neighborTable,
  partsNote,
  points,
  section,
  stat,
  swatch,
  voteSection,
} from './inspectorParts.ts';

/** Voisins affichés. */
const NEIGHBOR_COUNT = 5;
const NEAREST_ON_MAP_COUNT = 3;

export class Inspector implements Feature {
  private readonly host: HTMLElement;
  private readonly ds: Dataset;
  private readonly actions: AppActions;
  private readonly banner: HTMLElement;
  private readonly bannerText = el('span', { attrs: { id: 'sg-lens-text' } });
  private readonly bannerMore = el('span', {
    class: 'sg-lens-banner__more',
    text: ' L’aire des bulles montre le vote de ce groupe.',
  });
  private view: ResolvedView | null = null;
  private state: AppState | null = null;
  private renderKey = '';
  private compareOpen = false;

  constructor(host: HTMLElement, ds: Dataset, actions: AppActions) {
    this.host = host;
    this.ds = ds;
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
      el('span', {}, this.bannerText, this.bannerMore),
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

  private readonly compareWith = (key: string): void => {
    this.compareOpen = false;
    this.actions.patch({ compared: key }, 'fast');
  };

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
      state.scenario,
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
      this.bannerText.textContent = `Vue depuis : ${name}.`;
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
        this.head(absent ?? 'Sélection', 'Pas d’électorat distinct à ce scrutin.', null, false),
        el(
          'div',
          { class: 'sg-ins__body' },
          el('p', {
            class: 'sg-note',
            text: 'Coalition ou absence de liste : cette famille n’a pas ici d’électorat qui lui soit propre. Changez d’élection sur la frise pour la retrouver.',
          }),
        ),
      ];
    }
    if (selected.kind === 'candidate') {
      // La projection n'a pas de composition à comparer : pas de duel à ce stade.
      if (compared?.kind === 'candidate' && !view.projection) {
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
    const projected = view.projection?.families.find((f) => f.id === c.id) ?? null;
    const subtitle = projected
      ? 'Famille politique, projection'
      : c.share === null
        ? ''
        : c.isAbstention
          ? `${formatPct(c.share)} des inscrits`
          : `${formatPct(c.share)} des suffrages exprimés`;
    const body = el('div', { class: 'sg-ins__body' });
    const election = view.rawElection;
    if (projected) body.append(projectionSection(projected, this.state?.scenario ?? 'still'));
    if (this.compareOpen) body.append(compareList(view, c.id, this.compareWith));
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
            text: `Écart entre la part du groupe dans cet électorat et sa part parmi tous les ${groupBase(election)}.`,
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
          neighborTable(view, crossing, nearest, this.compareWith),
          el('p', { class: 'sg-note', text: 'Cliquez sur une ligne pour lancer le duel.' }),
        ),
      );
    }
    const families = this.ds.families;
    const family = families ? familyOfCandidate(families, c.id) : null;
    const history = family
      ? familyHistorySection(this.ds, family.id, view.electionId, (id) =>
          this.actions.setElection(id),
        )
      : null;
    if (history) body.append(history);
    return [
      this.head(c.label, subtitle, swatch(candidateColor(c), 'bubble'), election !== null),
      body,
    ];
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
          butterfly(
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

  // --- Catégorie ------------------------------------------------------------------------------

  private categoryDetail(view: ResolvedView, crossing: CrossingInfo, p: ChartPcs): Node[] {
    const body = el('div', { class: 'sg-ins__body' });
    if (this.compareOpen) body.append(groupCompareList(view, p, this.compareWith));
    body.append(voteSection(view, crossing, p, crossing.lens));
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
                swatch(candidateColor(c), 'bubble'),
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
        butterfly(
          nameOf(lensA, a),
          `var(--sg-group-${a.group}, ${a.color})`,
          nameOf(lensB, b),
          `var(--sg-group-${b.group}, ${b.color})`,
          rows,
        ),
        el('p', {
          class: 'sg-note',
          text: partsNote(election, 'de chaque groupe'),
        }),
      ),
    );
    return [this.head(title, 'Duel de groupes', null, false), body];
  }
}
