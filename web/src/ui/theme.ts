/** Choix du thème : système, clair ou sombre. Les couleurs sont dans src/theme/tokens.css. */
import type { ThemeChoice } from '../core/state.ts';
import type { AppActions } from './actions.ts';
import { byId } from './dom.ts';

const STORAGE_KEY = 'sg-theme';

function isThemeChoice(v: unknown): v is ThemeChoice {
  return v === 'system' || v === 'light' || v === 'dark';
}

/** Thème mémorisé par ce navigateur (commodité : l'URL reste prioritaire). */
export function storedTheme(): ThemeChoice {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return isThemeChoice(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(choice: ThemeChoice): void {
  if (choice === 'system') delete document.documentElement.dataset['theme'];
  else document.documentElement.dataset['theme'] = choice;
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Stockage indisponible (navigation privée, file://) : le thème reste porté par l'URL.
  }
}

export class ThemeSwitch {
  private readonly inputs: HTMLInputElement[];

  constructor(actions: AppActions) {
    const host = byId<HTMLFieldSetElement>('sg-theme');
    this.inputs = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    for (const input of this.inputs) {
      input.addEventListener('change', () => {
        if (input.checked && isThemeChoice(input.value)) actions.setTheme(input.value);
      });
    }
  }

  sync(choice: ThemeChoice): void {
    for (const input of this.inputs) input.checked = input.value === choice;
  }
}
