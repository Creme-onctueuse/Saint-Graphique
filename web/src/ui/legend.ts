/** Légende cliquable : chaque groupe PCS et chaque électorat s'affiche ou se masque d'un clic. */
import { formatPct } from '../core/format.ts';
import type { AppState } from '../core/state.ts';
import type { ResolvedView } from '../view.ts';
import type { AppActions } from './actions.ts';
import { el } from './dom.ts';

export class Legend {
  private readonly actions: AppActions;
  private readonly groups = el('div', { class: 'sg-legend__row' });
  private readonly candidates = el('div', { class: 'sg-legend__row' });
  private key = '';

  constructor(host: HTMLElement, actions: AppActions) {
    this.actions = actions;
    const ring = el('span', {
      class: 'sg-swatch sg-swatch--ring',
      attrs: { 'aria-hidden': 'true' },
    });
    const dots = el('span', {
      class: 'sg-swatch sg-swatch--dots',
      attrs: { 'aria-hidden': 'true' },
    });
    host.append(
      this.groups,
      this.candidates,
      el(
        'div',
        { class: 'sg-legend__row' },
        el('span', { class: 'sg-legend__key' }, ring, 'Barycentre de la population'),
        el('span', { class: 'sg-legend__key' }, dots, 'Diagonale de (−10, −10) à (10, 10)'),
        el('span', {
          class: 'sg-legend__key',
          text: 'Aire des disques : part de la population. Taille des losanges : score.',
        }),
      ),
    );
  }

  private chip(
    label: string,
    color: string,
    shape: 'disc' | 'diamond',
    value: string | null,
    visible: boolean,
    onToggle: (visible: boolean) => void,
    id: string,
  ): HTMLButtonElement {
    const swatch = el('span', {
      class: `sg-swatch sg-swatch--${shape}`,
      attrs: { 'aria-hidden': 'true' },
    });
    swatch.style.setProperty('--sg-swatch', color);
    const button = el(
      'button',
      {
        class: 'sg-chip',
        attrs: { type: 'button', 'aria-pressed': String(visible), 'data-id': id },
      },
      swatch,
      el('span', { text: label }),
      value ? el('span', { class: 'sg-chip__value', text: value }) : null,
    );
    button.addEventListener('click', () => {
      onToggle(button.getAttribute('aria-pressed') !== 'true');
    });
    return button;
  }

  sync(view: ResolvedView, state: AppState): void {
    const { candidates, pcs } = view.model;
    const groups = [...new Map(pcs.map((p) => [p.group, p])).values()].sort((a, b) =>
      a.group.localeCompare(b.group),
    );
    const key =
      groups.map((p) => `${p.group}:${p.groupLabel}`).join('|') +
      '#' +
      candidates.map((c) => `${c.id}:${c.label}:${c.color}:${c.share ?? ''}`).join('|');
    if (key !== this.key) {
      this.key = key;
      this.groups.replaceChildren(
        el('span', { class: 'sg-legend__title', text: 'PCS' }),
        ...groups.map((p) =>
          this.chip(
            p.groupLabel,
            `var(--sg-group-${p.group}, ${p.color})`,
            'disc',
            null,
            true,
            (visible) => this.actions.setGroupVisible(p.group, visible),
            `g:${p.group}`,
          ),
        ),
      );
      const sorted = [...candidates].sort((a, b) => (b.share ?? 0) - (a.share ?? 0));
      this.candidates.replaceChildren(
        ...(sorted.length > 0
          ? [el('span', { class: 'sg-legend__title', text: 'Électorats' })]
          : []),
        ...sorted.map((c) =>
          this.chip(
            c.label,
            c.isAbstention ? `var(--sg-abstention, ${c.color})` : c.color,
            'diamond',
            c.share !== null ? formatPct(c.share) : null,
            true,
            (visible) => this.actions.setCandidateVisible(c.id, visible),
            `c:${c.id}`,
          ),
        ),
      );
    }
    this.candidates.hidden = candidates.length === 0;
    for (const chip of this.groups.querySelectorAll<HTMLButtonElement>('button')) {
      const code = (chip.dataset['id'] ?? '').slice(2);
      chip.setAttribute('aria-pressed', String(!state.hiddenGroups.includes(code)));
    }
    for (const chip of this.candidates.querySelectorAll<HTMLButtonElement>('button')) {
      const id = (chip.dataset['id'] ?? '').slice(2);
      chip.setAttribute('aria-pressed', String(!state.hiddenCandidates.includes(id)));
    }
  }
}
