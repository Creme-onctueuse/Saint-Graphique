/**
 * Légende toujours visible : les couleurs de la carte ne doivent pas dépendre d'un panneau ouvert.
 * Un clic sur un groupe l'affiche ou le masque.
 */
import { GROUP_SHORT_NAMES } from '../../core/groups.ts';
import type { AppState } from '../../core/state.ts';
import type { ResolvedView } from '../../view.ts';
import type { AppActions, Feature } from '../actions.ts';
import { el } from '../dom.ts';

export class Keybar implements Feature {
  private readonly host: HTMLElement;
  private readonly actions: AppActions;
  private readonly groups = el('div', { class: 'sg-keybar__groups' });
  private readonly marks: HTMLElement;
  private key = '';

  constructor(host: HTMLElement, actions: AppActions) {
    this.host = host;
    this.actions = actions;
    this.marks = el('div', { class: 'sg-keybar__marks' });
    host.append(this.groups, this.marks);
  }

  sync(view: ResolvedView, state: AppState): void {
    const groups = [...new Map(view.model.pcs.map((p) => [p.group, p])).values()].sort((a, b) =>
      a.group.localeCompare(b.group),
    );
    const key = groups.map((p) => p.group).join('|');
    if (key !== this.key) {
      this.key = key;
      this.groups.replaceChildren(
        ...groups.map((p) => {
          const swatch = el('span', {
            class: 'sg-swatch sg-swatch--disc',
            attrs: { 'aria-hidden': 'true' },
          });
          swatch.style.setProperty('--sg-swatch', `var(--sg-group-${p.group}, ${p.color})`);
          const button = el(
            'button',
            {
              class: 'sg-key',
              attrs: { type: 'button', 'data-group': p.group, title: p.groupLabel },
            },
            swatch,
            GROUP_SHORT_NAMES[p.group] ?? p.groupLabel,
          );
          button.addEventListener('click', () => {
            this.actions.setGroupVisible(p.group, button.getAttribute('aria-pressed') !== 'true');
          });
          return button;
        }),
      );
      const diamond = el('span', {
        class: 'sg-swatch sg-swatch--diamond sg-swatch--plain',
        attrs: { 'aria-hidden': 'true' },
      });
      const ring = el('span', {
        class: 'sg-swatch sg-swatch--ring',
        attrs: { 'aria-hidden': 'true' },
      });
      this.marks.replaceChildren(
        el('span', { class: 'sg-key sg-key--static' }, diamond, 'Électorat'),
        el('span', { class: 'sg-key sg-key--static' }, ring, 'Population'),
      );
    }
    for (const button of this.groups.querySelectorAll<HTMLButtonElement>('button')) {
      const code = button.dataset['group'] ?? '';
      button.setAttribute('aria-pressed', String(!state.hiddenGroups.includes(code)));
    }
    this.host.hidden = groups.length === 0;
  }
}
