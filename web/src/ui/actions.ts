/** Actions que l'interface peut demander à l'application. */
import type { Animation } from '../chart/types.ts';
import type { AppState, RetiredSetting, ThemeChoice } from '../core/state.ts';
import type { DiplomaKey } from '../core/types.ts';
import type { ResolvedView } from '../view.ts';

export interface AppActions {
  /** Modifie l'état et redessine : la voie générale pour toute nouvelle fonction. */
  patch(patch: Partial<AppState>, animation?: Animation): void;
  setElection(id: string): void;
  setMethod(id: string): void;
  setCandidateVisible(id: string, visible: boolean): void;
  setGroupVisible(code: string, visible: boolean): void;
  setCandidatesVisible(ids: readonly string[], visible: boolean): void;
  setShowLabels(show: boolean): void;
  setShowEllipses(show: boolean): void;
  setWeight(key: DiplomaKey, value: number): void;
  setRetired(value: RetiredSetting): void;
  resetParams(): void;
  setTheme(theme: ThemeChoice): void;
}

/** Une fonction de l'interface : elle se met à jour à chaque rendu. */
export interface Feature {
  sync(view: ResolvedView, state: AppState): void;
}
