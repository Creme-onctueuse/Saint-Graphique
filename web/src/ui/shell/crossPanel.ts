/**
 * Panneau « Croiser » : choisir ce que montre la carte. Le Saint-Graphique, des axes libres parmi les
 * variables Insee, ou la carte de proximité. La légende de la couleur flotte sur la carte.
 */
import './crossing.css';
import { COLOR_CLASSES } from '../../core/freeAxes.ts';
import type { AppState, MapLayout } from '../../core/state.ts';
import type { Variable } from '../../core/variables.ts';
import type { Dataset } from '../../data/dataset.ts';
import type { ResolvedView } from '../../view.ts';
import { crossVariables } from '../../viewCrossing.ts';
import type { AppActions, Feature } from '../actions.ts';
import { el } from '../dom.ts';

type CrossMode = 'map' | 'free' | 'proximity';

interface Preset {
  id: string;
  label: string;
  x: string;
  y: string;
  color: string | null;
}

/** Quelques croisements pour commencer. Un préréglage dont une variable manque n'est pas proposé. */
const PRESETS: readonly Preset[] = [
  {
    id: 'argent-diplome',
    label: 'L’argent ou le diplôme',
    x: 'niveau_vie',
    y: 'bac5',
    color: 'patrimoine',
  },
  {
    id: 'heritage',
    label: 'Salaire contre héritage',
    x: 'niveau_vie',
    y: 'patrimoine',
    color: null,
  },
  { id: 'cap', label: 'Le pays du CAP', x: 'cap', y: 'niveau_vie', color: 'certif_aucun' },
  {
    id: 'pierre',
    label: 'La pierre ou l’entreprise',
    x: 'immobilier',
    y: 'professionnel',
    color: 'patrimoine',
  },
  {
    id: 'proprietaires',
    label: 'Qui est propriétaire ?',
    x: 'proprietaire',
    y: 'niveau_vie',
    color: 'bac5',
  },
];

const MODES: readonly { id: CrossMode; label: string }[] = [
  { id: 'map', label: 'Carte' },
  { id: 'free', label: 'Axes libres' },
  { id: 'proximity', label: 'Proximité' },
];

const DEFAULT_X = 'patrimoine';
const DEFAULT_Y = 'bac5';

function optionLabel(v: Variable): string {
  return v.imputed ? `${v.label} (≈ imputé)` : v.label;
}

export class CrossPanel implements Feature {
  private readonly actions: AppActions;
  private readonly onLayoutChange: () => void;
  private readonly modes = new Map<CrossMode, HTMLInputElement>();
  private readonly note = el('p', { class: 'sg-note', attrs: { id: 'sg-cross-note' } });
  private readonly freeBox = el('div', {
    class: 'sg-panel__group',
    attrs: { id: 'sg-cross-free' },
  });
  private readonly axisX = el('select', { attrs: { id: 'sg-axis-x' } });
  private readonly axisY = el('select', { attrs: { id: 'sg-axis-y' } });
  private readonly colorBy = el('select', { attrs: { id: 'sg-color-by' } });
  private readonly imputedNote = el('p', {
    class: 'sg-ins__alert',
    attrs: { id: 'sg-cross-imputed' },
  });
  private readonly reset = el('button', {
    class: 'sg-btn',
    text: 'Revenir à la carte',
    attrs: { type: 'button', id: 'sg-cross-reset' },
  });
  private readonly scale: HTMLElement;
  private readonly scaleLabel = el('span', { class: 'sg-scale__label' });
  private readonly scaleMin = el('span', { class: 'sg-scale__end' });
  private readonly scaleMax = el('span', { class: 'sg-scale__end' });
  private readonly variables: Variable[];
  private lastMode: CrossMode = 'map';
  private initialized = false;

  constructor(host: HTMLElement, ds: Dataset, actions: AppActions, onLayoutChange: () => void) {
    this.actions = actions;
    this.onLayoutChange = onLayoutChange;
    this.variables = crossVariables(ds);

    const segmented = el('div', {
      class: 'sg-segmented',
      attrs: { role: 'radiogroup', 'aria-label': 'Ce que montre la carte', id: 'sg-cross-mode' },
    });
    for (const mode of MODES) {
      const input = el('input', {
        class: 'sg-sr-only',
        attrs: { type: 'radio', name: 'sg-cross-mode', value: mode.id },
      });
      input.addEventListener('change', () => {
        if (input.checked) this.chooseMode(mode.id);
      });
      this.modes.set(mode.id, input);
      segmented.append(el('label', {}, input, el('span', { text: mode.label })));
    }

    const options = this.variables.map((v) => ({ id: v.id, label: optionLabel(v) }));
    for (const select of [this.axisX, this.axisY]) {
      select.append(...options.map((o) => el('option', { text: o.label, attrs: { value: o.id } })));
    }
    this.colorBy.append(
      el('option', { text: 'Couleur des groupes sociaux', attrs: { value: '' } }),
      ...options.map((o) => el('option', { text: o.label, attrs: { value: o.id } })),
    );
    this.axisX.addEventListener('change', () =>
      this.actions.patch({ axisX: this.axisX.value, layout: 'map' }, 'normal'),
    );
    this.axisY.addEventListener('change', () =>
      this.actions.patch({ axisY: this.axisY.value, layout: 'map' }, 'normal'),
    );
    this.colorBy.addEventListener('change', () =>
      this.actions.patch({ colorBy: this.colorBy.value || null }, 'fast'),
    );

    const known = new Set(this.variables.map((v) => v.id));
    const presets = PRESETS.filter(
      (p) => known.has(p.x) && known.has(p.y) && (p.color === null || known.has(p.color)),
    ).map((p) => {
      const button = el('button', {
        class: 'sg-preset',
        text: p.label,
        attrs: { type: 'button', 'data-preset': p.id },
      });
      button.addEventListener('click', () => {
        this.actions.patch(
          { axisX: p.x, axisY: p.y, colorBy: p.color, layout: 'map', compared: null },
          'normal',
        );
        this.onLayoutChange();
      });
      return button;
    });

    this.freeBox.append(
      el('label', { class: 'sg-field' }, 'Axe horizontal', this.axisX),
      el('label', { class: 'sg-field' }, 'Axe vertical', this.axisY),
      el('label', { class: 'sg-field' }, 'Couleur des disques', this.colorBy),
      this.imputedNote,
    );
    host.append(
      segmented,
      this.note,
      this.freeBox,
      el(
        'section',
        { class: 'sg-ins__section' },
        el('h3', { text: 'Croisements à essayer' }),
        el('div', { class: 'sg-presets', attrs: { id: 'sg-cross-presets' } }, ...presets),
      ),
      this.reset,
    );
    this.reset.addEventListener('click', () => this.chooseMode('map'));

    const steps = el('span', { class: 'sg-scale__steps', attrs: { 'aria-hidden': 'true' } });
    for (let i = 1; i <= COLOR_CLASSES; i++) {
      const step = el('span', { class: 'sg-scale__step' });
      step.style.background = `var(--sg-seq-${i})`;
      steps.append(step);
    }
    this.scale = el(
      'div',
      {
        class: 'sg-scale sg-float',
        attrs: { id: 'sg-color-legend', 'aria-label': 'Échelle de couleur' },
      },
      this.scaleLabel,
      this.scaleMin,
      steps,
      this.scaleMax,
    );
    this.scale.hidden = true;
    document.body.append(this.scale);

    // Le rail n'affiche ce panneau que s'il y a des variables à croiser.
    const railButton = document.querySelector<HTMLButtonElement>(
      '#sg-rail button[data-panel="cross"]',
    );
    if (railButton) railButton.hidden = this.variables.length < 2;
  }

  private chooseMode(mode: CrossMode): void {
    const layout: MapLayout = mode === 'proximity' ? 'proximity' : 'map';
    const patch: Partial<AppState> =
      mode === 'free'
        ? { axisX: this.axisX.value || DEFAULT_X, axisY: this.axisY.value || DEFAULT_Y, layout }
        : mode === 'map'
          ? { axisX: null, axisY: null, colorBy: null, layout }
          : { layout };
    this.actions.patch({ ...patch, compared: null }, 'normal');
  }

  sync(view: ResolvedView, state: AppState): void {
    const crossing = view.crossing;
    const mode: CrossMode = crossing?.mode ?? 'map';
    const asked: CrossMode =
      state.layout === 'proximity' ? 'proximity' : state.axisX || state.axisY ? 'free' : 'map';
    for (const [id, input] of this.modes) input.checked = id === asked;
    this.freeBox.hidden = asked !== 'free';
    this.reset.hidden = asked === 'map';

    const free = crossing?.free ?? null;
    if (free) {
      this.axisX.value = free.x.variable.id;
      this.axisY.value = free.y.variable.id;
    } else if (!this.initialized) {
      this.axisX.value = DEFAULT_X;
      this.axisY.value = DEFAULT_Y;
    }
    this.colorBy.value = free?.color?.variable.id ?? '';
    this.initialized = true;

    this.note.textContent = this.noteFor(asked, mode, view);
    const flagged = free
      ? [free.x.variable, free.y.variable, ...(free.color ? [free.color.variable] : [])].some(
          (v) => v.imputed,
        )
      : false;
    this.imputedNote.hidden = !flagged;
    if (flagged) {
      this.imputedNote.textContent =
        'Composition du patrimoine : valeurs imputées pour 27 catégories sur 30. Lecture indicative.';
    }

    const color = free?.color ?? null;
    this.scale.hidden = color === null;
    // Les disques ne portent plus la couleur de leur groupe : la légende des groupes le dit.
    document.documentElement.toggleAttribute('data-sg-color-by', color !== null);
    if (color) {
      this.scaleLabel.textContent = optionLabel(color.variable);
      this.scaleMin.textContent = color.variable.format(color.min);
      this.scaleMax.textContent = color.variable.format(color.max);
    }
    if (mode !== this.lastMode) {
      this.lastMode = mode;
      this.onLayoutChange();
    }
  }

  private noteFor(asked: CrossMode, mode: CrossMode, view: ResolvedView): string {
    const crossing = view.crossing;
    if (asked === 'proximity') {
      if (mode !== 'proximity') {
        return 'La carte de proximité compare des électorats : choisissez un scrutin sur la frise.';
      }
      const pct = Math.round((crossing?.explained ?? 0) * 100);
      return (
        'Plus deux électorats sont proches, plus leur composition sociale se ressemble. ' +
        `Le plan conserve ${pct} % de l’information. Ni axes ni graduations : ces directions n’ont pas de nom.`
      );
    }
    if (asked === 'free') {
      const free = crossing?.free;
      const omitted =
        free && free.omitted > 0 ? ` ${free.omitted} sans valeur ne sont pas placées.` : '';
      const count = free?.pcs.length ?? 30;
      return (
        `Ces axes utilisent ${count} catégories Insee, et non les 41 positions lues sur les vidéos.` +
        omitted
      );
    }
    return 'Mettez les variables de votre choix sur les axes, ou placez les électorats selon leur ressemblance.';
  }
}
