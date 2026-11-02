/** Tableaux des données : même information que le graphique, sans dépendre de la vue ni du survol. */
import { formatNumber, formatPct } from '../core/format.ts';
import { formatStatus } from '../core/reserves.ts';
import type { ResolvedView } from '../view.ts';
import { el } from './dom.ts';

function headerRow(columns: readonly [string, boolean][]): HTMLTableSectionElement {
  return el(
    'thead',
    {},
    el(
      'tr',
      {},
      ...columns.map(([label, numeric]) =>
        el('th', { class: numeric ? 'sg-num' : '', text: label, attrs: { scope: 'col' } }),
      ),
    ),
  );
}

function cell(text: string, numeric = false): HTMLTableCellElement {
  return el('td', { class: numeric ? 'sg-num' : '', text });
}

export function renderTables(host: HTMLElement, view: ResolvedView): void {
  const { model } = view;
  const x = model.xLabel;
  const y = model.yLabel;
  const withAxes = model.axes?.none !== true;
  const xValue = (v: number): string => model.axes?.text?.x(v) ?? formatNumber(v);
  const yValue = (v: number): string => model.axes?.text?.y(v) ?? formatNumber(v);

  const pcsTable = el(
    'table',
    { class: 'sg-table' },
    el('caption', { text: 'Catégories socioprofessionnelles' }),
    headerRow([
      ['Code', false],
      ['Libellé', false],
      ['Groupe', false],
      ['Part de la population', true],
      [x, true],
      [y, true],
      ['Patrimoine', false],
      ['Niveau de vie', false],
    ]),
    el(
      'tbody',
      {},
      ...[...model.pcs]
        .sort((a, b) => b.x - a.x)
        .map((p) =>
          el(
            'tr',
            {},
            cell(p.code),
            cell(p.label),
            cell(p.groupLabel),
            cell(formatPct(p.weight), true),
            cell(xValue(p.x), true),
            cell(yValue(p.y), true),
            cell(p.status ? formatStatus(p.status.patrimoine) : 'sans objet'),
            cell(p.status ? formatStatus(p.status.niveauVie) : 'sans objet'),
          ),
        ),
    ),
  );

  const sections: Node[] =
    model.pcs.length > 0 ? [el('div', { class: 'sg-table-wrap' }, pcsTable)] : [];

  if (model.candidates.length > 0) {
    const candTable = el(
      'table',
      { class: 'sg-table' },
      el('caption', { text: `Électorats : ${view.electionLabel}` }),
      headerRow([
        ['Électorat', false],
        ['Score', true],
        ...(withAxes
          ? ([
              [x, true],
              [y, true],
            ] as [string, boolean][])
          : []),
      ]),
      el(
        'tbody',
        {},
        ...[...model.candidates]
          .sort((a, b) => (b.share ?? 0) - (a.share ?? 0))
          .map((c) =>
            el(
              'tr',
              {},
              cell(c.label),
              cell(c.share !== null ? formatPct(c.share) : '–', true),
              withAxes ? cell(xValue(c.x), true) : null,
              withAxes ? cell(yValue(c.y), true) : null,
            ),
          ),
      ),
    );
    sections.push(el('div', { class: 'sg-table-wrap' }, candTable));
  }

  if (model.barycenter) {
    sections.push(
      el('p', {
        class: 'sg-note',
        text:
          `Barycentre de la population : ${x} ${xValue(model.barycenter.x)}, ` +
          `${y} ${yValue(model.barycenter.y)}.`,
      }),
    );
  }
  host.replaceChildren(...sections);
}
