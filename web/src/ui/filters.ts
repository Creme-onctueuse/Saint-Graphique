/** Panneau « Filtres » : cases à cocher des électorats et des groupes PCS, options d'affichage. */
import type { AppState } from '../core/state.ts';
import type { ResolvedView } from '../view.ts';
import type { AppActions } from './actions.ts';
import { el } from './dom.ts';

function swatchFor(color: string, shape: 'disc' | 'diamond'): HTMLSpanElement {
  const swatch = el('span', {
    class: `sg-swatch sg-swatch--${shape}`,
    attrs: { 'aria-hidden': 'true' },
  });
  swatch.style.setProperty('--sg-swatch', color);
  return swatch;
}

export class Filters {
  private readonly actions: AppActions;
  private readonly candidates = el('div', { class: 'sg-checks' });
  private readonly groups = el('div', { class: 'sg-checks' });
  private readonly candidateFieldset: HTMLFieldSetElement;
  private readonly showLabels = el('input', { attrs: { type: 'checkbox' } });
  private readonly showEllipses = el('input', { attrs: { type: 'checkbox' } });
  private readonly ellipsesLabel: HTMLLabelElement;
  private candidateKey = '';
  private groupKey = '';
  private candidateIds: string[] = [];

  constructor(host: HTMLElement, actions: AppActions) {
    this.actions = actions;
    const allOn = el('button', {
      class: 'sg-btn',
      text: 'Tout afficher',
      attrs: { type: 'button' },
    });
    const allOff = el('button', {
      class: 'sg-btn',
      text: 'Tout masquer',
      attrs: { type: 'button' },
    });
    allOn.addEventListener('click', () => actions.setCandidatesVisible(this.candidateIds, true));
    allOff.addEventListener('click', () => actions.setCandidatesVisible(this.candidateIds, false));
    this.candidateFieldset = el(
      'fieldset',
      { class: 'sg-fieldset' },
      el('legend', { text: 'Électorats' }),
      this.candidates,
      el('div', { class: 'sg-row' }, allOn, allOff),
    );
    this.ellipsesLabel = el(
      'label',
      { class: 'sg-check' },
      this.showEllipses,
      'Ellipses de confiance à 95 %',
    );
    host.append(
      this.candidateFieldset,
      el(
        'fieldset',
        { class: 'sg-fieldset' },
        el('legend', { text: 'Groupes de PCS' }),
        this.groups,
      ),
      el(
        'fieldset',
        { class: 'sg-fieldset' },
        el('legend', { text: 'Affichage' }),
        el('label', { class: 'sg-check' }, this.showLabels, 'Libellés sur le graphique'),
        this.ellipsesLabel,
      ),
    );
    this.showLabels.addEventListener('change', () =>
      actions.setShowLabels(this.showLabels.checked),
    );
    this.showEllipses.addEventListener('change', () =>
      actions.setShowEllipses(this.showEllipses.checked),
    );
  }

  private check(
    label: string,
    swatch: HTMLSpanElement,
    onChange: (checked: boolean) => void,
    key: string,
  ): HTMLLabelElement {
    const input = el('input', { attrs: { type: 'checkbox', 'data-key': key } });
    input.addEventListener('change', () => onChange(input.checked));
    return el('label', { class: 'sg-check' }, input, swatch, label);
  }

  sync(view: ResolvedView, state: AppState): void {
    const { candidates, pcs } = view.model;
    this.candidateIds = candidates.map((c) => c.id);
    const candidateKey = candidates.map((c) => `${c.id}:${c.label}:${c.color}`).join('|');
    if (candidateKey !== this.candidateKey) {
      this.candidateKey = candidateKey;
      this.candidates.replaceChildren(
        ...candidates.map((c) =>
          this.check(
            c.label,
            swatchFor(c.isAbstention ? `var(--sg-abstention, ${c.color})` : c.color, 'diamond'),
            (checked) => this.actions.setCandidateVisible(c.id, checked),
            c.id,
          ),
        ),
      );
    }
    this.candidateFieldset.hidden = candidates.length === 0;
    for (const input of this.candidates.querySelectorAll<HTMLInputElement>('input')) {
      input.checked = !state.hiddenCandidates.includes(input.dataset['key'] ?? '');
    }

    const groups = new Map(pcs.map((p) => [p.group, p]));
    const sorted = [...groups.values()].sort((a, b) => a.group.localeCompare(b.group));
    const groupKey = sorted.map((p) => `${p.group}:${p.groupLabel}`).join('|');
    if (groupKey !== this.groupKey) {
      this.groupKey = groupKey;
      this.groups.replaceChildren(
        ...sorted.map((p) =>
          this.check(
            p.groupLabel,
            swatchFor(`var(--sg-group-${p.group}, ${p.color})`, 'disc'),
            (checked) => this.actions.setGroupVisible(p.group, checked),
            p.group,
          ),
        ),
      );
    }
    for (const input of this.groups.querySelectorAll<HTMLInputElement>('input')) {
      input.checked = !state.hiddenGroups.includes(input.dataset['key'] ?? '');
    }

    this.showLabels.checked = state.showLabels;
    this.showEllipses.checked = state.showEllipses;
    this.ellipsesLabel.hidden = !view.hasEllipses;
  }
}
