/**
 * Sélection sur la carte : un clic sélectionne, un second clic retire, Maj + clic compare deux
 * repères de même nature. Les clés sont `c:<électorat>` ou `p:<catégorie>`.
 *
 * Module pur, testé dans selection.test.ts.
 */
import type { AppState } from './state.ts';

export type SelectionState = Pick<AppState, 'selected' | 'compared'>;

export function sameKind(a: string, b: string): boolean {
  return a.charAt(0) === b.charAt(0);
}

export function selectionPatch(
  current: SelectionState,
  key: string | null,
  additive: boolean,
): SelectionState {
  const { selected, compared } = current;
  if (key === null) return { selected: null, compared: null };
  if (key === selected) return { selected: compared, compared: null };
  if (key === compared) return { selected, compared: null };
  if (additive && selected && sameKind(selected, key)) return { selected, compared: key };
  return { selected: key, compared: null };
}
