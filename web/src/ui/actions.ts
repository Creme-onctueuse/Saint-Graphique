/** Actions que l'interface peut demander à l'application. */
import type { RetiredSetting, ThemeChoice } from '../core/state.ts';
import type { DiplomaKey } from '../core/types.ts';

export interface AppActions {
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
