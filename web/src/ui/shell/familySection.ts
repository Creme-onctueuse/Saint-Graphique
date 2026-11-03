/**
 * Sections de l'inspecteur propres aux familles : l'historique d'une famille à travers les scrutins,
 * et sa projection 2027. Texte en DOM, jamais en innerHTML.
 */
import { formatNumber, formatPct, NBSP } from '../../core/format.ts';
import { GROUP_SHORT_NAMES } from '../../core/groups.ts';
import type { ProjectedFamily } from '../../core/projection.ts';
import type { Scenario } from '../../core/state.ts';
import {
  familyHistory,
  timelineStops,
  type FamilyMoment,
  type TimelineStop,
  typeLetter,
} from '../../core/timeline.ts';
import type { Dataset } from '../../data/dataset.ts';
import { el } from '../dom.ts';

/** Barre empilée de la composition : un segment par groupe, dans l'ordre des groupes. */
function compositionBar(moment: FamilyMoment): HTMLSpanElement {
  const bar = el('span', { class: 'sg-history__bar' });
  const entries = Object.entries(moment.composition)
    .filter(([, share]) => share > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  for (const [group, share] of entries) {
    const segment = el('span', {
      class: 'sg-history__seg',
      attrs: { title: `${GROUP_SHORT_NAMES[group] ?? group} : ${formatPct(share, 0)}` },
    });
    segment.style.flexGrow = String(share);
    segment.style.background = `var(--sg-group-${group}, var(--sg-text-muted))`;
    bar.append(segment);
  }
  return bar;
}

function stopTag(stop: TimelineStop | undefined): string {
  return stop ? `${stop.year} ${typeLetter(stop.type)}`.trim() : '';
}

/**
 * Historique d'une famille : score et composition à chaque scrutin. Une ligne mène au scrutin.
 * Null si la famille n'a pas de scrutin à montrer.
 */
export function familyHistorySection(
  ds: Dataset,
  familyId: string,
  currentElection: string,
  onChoose: (electionId: string) => void,
): HTMLElement | null {
  if (!ds.families) return null;
  const stops = timelineStops(ds);
  const moments = familyHistory(ds.families, stops, ds.rawElections, familyId);
  if (moments.length === 0) return null;
  const list = el('ul', { class: 'sg-history', attrs: { id: 'sg-inspector-history' } });
  for (const moment of moments) {
    const button = el(
      'button',
      {
        class: 'sg-history__row',
        attrs: {
          type: 'button',
          'data-election': moment.election,
          title: `Aller à : ${moment.label}`,
          ...(moment.election === currentElection ? { 'aria-current': 'true' } : {}),
        },
      },
      el('span', {
        class: 'sg-history__tag',
        text: stopTag(stops.find((s) => s.id === moment.election)),
      }),
      el('span', {
        class: 'sg-history__score',
        text: moment.share === null ? '–' : formatPct(moment.share, 0),
      }),
      compositionBar(moment),
    );
    button.addEventListener('click', () => onChoose(moment.election));
    list.append(el('li', {}, button));
  }
  return el(
    'section',
    { class: 'sg-ins__section' },
    el('h3', { text: 'Au fil des scrutins' }),
    list,
    el('p', {
      class: 'sg-note',
      text: 'Score et composition de l’électorat, aux couleurs de la légende. Les types de scrutin (P, L, E) ne se comparent qu’avec prudence.',
    }),
  );
}

function position(p: { x: number; y: number }): string {
  return `${formatNumber(p.x)} ; ${formatNumber(p.y)}`;
}

/** Détail de la projection d'une famille : deux scénarios, et l'erreur mesurée sur le passé. */
export function projectionSection(family: ProjectedFamily, scenario: Scenario): HTMLElement {
  const error = family.error[scenario];
  const distance = Math.hypot(family.trend.x - family.still.x, family.trend.y - family.still.y);
  const row = (label: string, value: string): HTMLElement[] => [
    el('dt', { text: label }),
    el('dd', { text: value }),
  ];
  return el(
    'section',
    { class: 'sg-ins__section', attrs: { id: 'sg-inspector-projection' } },
    el('h3', { text: 'Projection 2027' }),
    el(
      'dl',
      { class: 'sg-factlist' },
      ...row('Rien ne bouge', position(family.still)),
      ...row('La tendance continue', position(family.trend)),
      ...row('Écart entre les deux', formatNumber(distance)),
      ...row('Erreur moyenne au test', `${formatNumber(error.position_mean)}${NBSP}unité`),
      ...row('Pire erreur au test', `${formatNumber(error.position_worst)}${NBSP}unité`),
      ...row('Prédictions testées', String(error.n)),
    ),
    el('p', {
      class: 'sg-note',
      text: 'Position seulement : le score d’un parti varie trop selon le type de scrutin. Les fourchettes de score sont données par bloc.',
    }),
  );
}
