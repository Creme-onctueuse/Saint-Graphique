/**
 * Listes des panneaux « Électorats » et « Catégories » : un clic sur un nom le sélectionne, et l'œil
 * affiche ou masque ce repère.
 */
import { formatPct } from '../core/format.ts';
import { selectionPatch } from '../core/selection.ts';
import type { AppState } from '../core/state.ts';
import type { ResolvedView } from '../view.ts';
import { effectiveSelection } from '../viewCrossing.ts';
import type { AppActions, Feature } from './actions.ts';
import { el } from './dom.ts';
import { icon } from './icons.ts';

function eye(visible: boolean): HTMLSpanElement {
  return el('span', { class: 'sg-icon' }, icon(visible ? 'eye' : 'eye-off'));
}

export class Legend implements Feature {
  private readonly actions: AppActions;
  private readonly groups: HTMLElement;
  private readonly candidates: HTMLElement;
  private view: ResolvedView | null = null;
  private state: AppState | null = null;
  private key = '';

  constructor(
    groups: HTMLElement,
    candidates: HTMLElement,
    keys: HTMLElement,
    actions: AppActions,
  ) {
    this.actions = actions;
    this.groups = groups;
    this.candidates = candidates;
    const ring = el('span', {
      class: 'sg-swatch sg-swatch--ring',
      attrs: { 'aria-hidden': 'true' },
    });
    const dots = el('span', {
      class: 'sg-swatch sg-swatch--dots',
      attrs: { 'aria-hidden': 'true' },
    });
    keys.append(
      el('span', { class: 'sg-legend__key' }, ring, 'Barycentre de la population'),
      el('span', { class: 'sg-legend__key' }, dots, 'Diagonale de (−10, −10) à (10, 10)'),
      el('span', {
        class: 'sg-legend__key',
        text: 'Aire des disques : part de la population. Taille des losanges : score.',
      }),
    );
  }

  private select(key: string): void {
    if (!this.state) return;
    this.actions.patch(
      selectionPatch(effectiveSelection(this.view, this.state), key, false),
      'fast',
    );
  }

  private row(
    label: string,
    color: string,
    shape: 'disc' | 'diamond',
    value: string | null,
    onToggle: (visible: boolean) => void,
    id: string,
    selectKey: string,
  ): HTMLDivElement {
    const swatch = el('span', {
      class: `sg-swatch sg-swatch--${shape}`,
      attrs: { 'aria-hidden': 'true' },
    });
    swatch.style.setProperty('--sg-swatch', color);
    const name = el(
      'button',
      { class: 'sg-lrow__name', attrs: { type: 'button', 'data-select': selectKey } },
      swatch,
      el('span', { class: 'sg-chip__label', text: label }),
      value ? el('span', { class: 'sg-chip__value', text: value }) : null,
    );
    name.addEventListener('click', () => this.select(selectKey));
    const toggle = el(
      'button',
      {
        class: 'sg-chip',
        attrs: {
          type: 'button',
          'aria-pressed': 'true',
          'data-id': id,
          'aria-label': `Afficher ou masquer : ${label}`,
          title: 'Afficher ou masquer',
        },
      },
      eye(true),
    );
    toggle.addEventListener('click', () => {
      onToggle(toggle.getAttribute('aria-pressed') !== 'true');
    });
    return el('div', { class: 'sg-lrow', attrs: { 'data-key': selectKey } }, name, toggle);
  }

  private setPressed(chip: HTMLButtonElement, visible: boolean): void {
    if (chip.getAttribute('aria-pressed') === String(visible)) return;
    chip.setAttribute('aria-pressed', String(visible));
    chip.replaceChildren(eye(visible));
  }

  sync(view: ResolvedView, state: AppState): void {
    this.view = view;
    this.state = state;
    const { candidates, pcs } = view.model;
    // Un groupe se sélectionne par sa plus grande catégorie.
    const largest = new Map<string, (typeof pcs)[number]>();
    for (const p of pcs) {
      const known = largest.get(p.group);
      if (!known || p.weight > known.weight) largest.set(p.group, p);
    }
    const groups = [...largest.values()].sort((a, b) => a.group.localeCompare(b.group));
    const key =
      groups.map((p) => `${p.group}:${p.groupLabel}:${p.code}`).join('|') +
      '#' +
      candidates.map((c) => `${c.id}:${c.label}:${c.color}:${c.share ?? ''}`).join('|');
    if (key !== this.key) {
      this.key = key;
      this.groups.replaceChildren(
        ...groups.map((p) =>
          this.row(
            p.groupLabel,
            `var(--sg-group-${p.group}, ${p.color})`,
            'disc',
            null,
            (visible) => this.actions.setGroupVisible(p.group, visible),
            `g:${p.group}`,
            `p:${p.code}`,
          ),
        ),
      );
      const sorted = [...candidates].sort((a, b) => (b.share ?? 0) - (a.share ?? 0));
      this.candidates.replaceChildren(
        ...sorted.map((c) =>
          this.row(
            c.label,
            c.isAbstention ? `var(--sg-abstention, ${c.color})` : c.color,
            'diamond',
            c.share !== null ? formatPct(c.share) : null,
            (visible) => this.actions.setCandidateVisible(c.id, visible),
            `c:${c.id}`,
            `c:${c.id}`,
          ),
        ),
      );
    }
    for (const chip of this.groups.querySelectorAll<HTMLButtonElement>('button.sg-chip')) {
      const code = (chip.dataset['id'] ?? '').slice(2);
      this.setPressed(chip, !state.hiddenGroups.includes(code));
    }
    for (const chip of this.candidates.querySelectorAll<HTMLButtonElement>('button.sg-chip')) {
      const id = (chip.dataset['id'] ?? '').slice(2);
      this.setPressed(chip, !state.hiddenCandidates.includes(id));
    }
    const keys = new Set(view.crossing?.keys ?? []);
    for (const row of [
      ...this.groups.querySelectorAll<HTMLElement>('.sg-lrow'),
      ...this.candidates.querySelectorAll<HTMLElement>('.sg-lrow'),
    ]) {
      const current = keys.has(row.dataset['key'] ?? '');
      if (current) row.setAttribute('aria-current', 'true');
      else row.removeAttribute('aria-current');
    }
  }
}
