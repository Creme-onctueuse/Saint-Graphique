/**
 * Panneau « Croiser » : choisir ce que montre la carte. Le Saint-Graphique, des axes libres parmi les
 * variables Insee, ou la carte de proximité. La légende de la couleur flotte sur la carte.
 */
import './crossing.css';
import { AXIS_SCALES, type AxisScale } from '../../core/axisScale.ts';
import { GROUP_SHORT_NAMES } from '../../core/groups.ts';
import { COLOR_CLASSES, type FreeAxis } from '../../core/freeAxes.ts';
import { hasCustomLayout, type AppState, type MapLayout } from '../../core/state.ts';
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
  /** Mesure de l'aire des bulles (core/bubbleSize.ts). */
  size?: string;
}

/** Groupes détaillés par les sondages. */
const POLL_GROUPS = ['2', '3', '4', '5', '6', '7'] as const;

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
    id: 'qui-detient',
    label: 'Qui détient le patrimoine ?',
    x: 'patrimoine',
    y: 'niveau_vie',
    color: null,
    size: 'var:patrimoine',
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

const SCALE_CHOICES: Record<AxisScale, { label: string; title: string }> = {
  linear: {
    label: 'Linéaire',
    title: 'Des écarts égaux à l’écran sont des écarts de valeur égaux.',
  },
  log: { label: 'Log', title: 'Des écarts égaux à l’écran sont des rapports égaux.' },
  rank: {
    label: 'Rang',
    title: 'Les catégories se suivent à intervalles égaux : seul l’ordre compte.',
  },
};

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
  private readonly sizeNote = el('p', { class: 'sg-note', attrs: { id: 'sg-size-note' } });
  private readonly freeBox = el('div', {
    class: 'sg-panel__group',
    attrs: { id: 'sg-cross-free' },
  });
  private readonly axisX = el('select', { attrs: { id: 'sg-axis-x' } });
  private readonly axisY = el('select', { attrs: { id: 'sg-axis-y' } });
  private readonly colorBy = el('select', { attrs: { id: 'sg-color-by' } });
  private readonly scaleX = new Map<AxisScale, HTMLInputElement>();
  private readonly scaleY = new Map<AxisScale, HTMLInputElement>();
  private readonly scaleNote = el('p', { class: 'sg-note', attrs: { id: 'sg-scale-note' } });
  private readonly bubbleSize = el('select', { attrs: { id: 'sg-bubble-size' } });
  private readonly imputedNote = el('p', {
    class: 'sg-ins__alert',
    attrs: { id: 'sg-cross-imputed' },
  });
  private readonly reset = el('button', {
    class: 'sg-btn sg-cross-home',
    text: '← Carte par défaut',
    attrs: { type: 'button', id: 'sg-cross-reset' },
  });
  /** Sur la carte : on doit pouvoir quitter un croisement panneau fermé. */
  private readonly chip: HTMLElement;
  private readonly chipLabel = el('span', { class: 'sg-cross-chip__label' });
  private readonly scale: HTMLElement;
  private readonly scaleLabel = el('span', { class: 'sg-scale__label' });
  private readonly scaleMin = el('span', { class: 'sg-scale__end' });
  private readonly scaleMax = el('span', { class: 'sg-scale__end' });
  private readonly variables: Variable[];
  /** Catégories Insee, et celles dont la composition du patrimoine est imputée. */
  private readonly itemCount: number;
  private readonly imputedCount: number;
  /** Ce que montrent les axes : s'il change, l'ancien cadre ne veut plus rien dire. */
  private lastLayout = 'map';
  private initialized = false;

  constructor(host: HTMLElement, ds: Dataset, actions: AppActions, onLayoutChange: () => void) {
    this.actions = actions;
    this.onLayoutChange = onLayoutChange;
    this.variables = crossVariables(ds);
    const items = ds.rawPcs?.items ?? [];
    this.itemCount = items.length;
    this.imputedCount = items.filter((it) => it.patrimoine_composition_status === 'imputed').length;

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
    // Une autre variable reprend l'échelle qui lui convient.
    this.axisX.addEventListener('change', () =>
      this.actions.patch({ axisX: this.axisX.value, scaleX: null, layout: 'map' }, 'normal'),
    );
    this.axisY.addEventListener('change', () =>
      this.actions.patch({ axisY: this.axisY.value, scaleY: null, layout: 'map' }, 'normal'),
    );
    this.colorBy.addEventListener('change', () =>
      this.actions.patch({ colorBy: this.colorBy.value || null }, 'fast'),
    );

    const group = (label: string, values: readonly [string, string][]): HTMLOptGroupElement =>
      el(
        'optgroup',
        { attrs: { label } },
        ...values.map(([value, text]) => el('option', { text, attrs: { value } })),
      );
    const groups = POLL_GROUPS.map((g) => [g, GROUP_SHORT_NAMES[g] ?? g] as const);
    this.bubbleSize.append(
      el('option', { text: 'Part des inscrits', attrs: { value: '' } }),
      el('option', { text: 'Score parmi les exprimés', attrs: { value: 'score' } }),
      group(
        'Part d’un groupe dans l’électorat',
        groups.map(([g, name]) => [`dans:${g}`, name]),
      ),
      group(
        'Vote d’un groupe',
        groups.map(([g, name]) => [`vote:${g}`, name]),
      ),
      group(
        'Part du total rassemblée',
        this.variables.filter((v) => !v.imputed).map((v) => [`var:${v.id}`, v.label]),
      ),
    );
    this.bubbleSize.addEventListener('change', () =>
      this.actions.patch({ bubbleSize: this.bubbleSize.value || null }, 'normal'),
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
          {
            axisX: p.x,
            axisY: p.y,
            scaleX: null,
            scaleY: null,
            colorBy: p.color,
            bubbleSize: p.size ?? null,
            layout: 'map',
            compared: null,
          },
          'normal',
        );
      });
      return button;
    });

    this.freeBox.append(
      el('label', { class: 'sg-field' }, 'Axe horizontal', this.axisX),
      this.scaleSwitch('x', 'Échelle de l’axe horizontal', this.scaleX),
      el('label', { class: 'sg-field' }, 'Axe vertical', this.axisY),
      this.scaleSwitch('y', 'Échelle de l’axe vertical', this.scaleY),
      this.scaleNote,
      el('label', { class: 'sg-field' }, 'Couleur des disques', this.colorBy),
      this.imputedNote,
    );
    host.append(
      segmented,
      this.reset,
      this.note,
      this.freeBox,
      el('label', { class: 'sg-field' }, 'Aire des bulles', this.bubbleSize),
      this.sizeNote,
      el(
        'section',
        { class: 'sg-ins__section' },
        el('h3', { text: 'Croisements à essayer' }),
        el('div', { class: 'sg-presets', attrs: { id: 'sg-cross-presets' } }, ...presets),
      ),
    );
    this.reset.addEventListener('click', () => this.leave());

    const chipHome = el('button', {
      class: 'sg-btn sg-cross-home',
      text: '← Carte par défaut',
      attrs: { type: 'button', id: 'sg-cross-home' },
    });
    chipHome.addEventListener('click', () => this.leave());
    this.chip = el(
      'div',
      {
        class: 'sg-cross-chip sg-float',
        attrs: { id: 'sg-cross-chip', role: 'group', 'aria-label': 'Vue croisée' },
      },
      this.chipLabel,
      chipHome,
    );
    this.chip.hidden = true;
    document.body.append(this.chip);

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
          ? {
              axisX: null,
              axisY: null,
              scaleX: null,
              scaleY: null,
              colorBy: null,
              bubbleSize: null,
              layout,
            }
          : { layout };
    this.actions.patch({ ...patch, compared: null }, 'normal');
  }

  private scaleSwitch(
    axis: 'x' | 'y',
    label: string,
    inputs: Map<AxisScale, HTMLInputElement>,
  ): HTMLElement {
    const root = el('div', {
      class: 'sg-segmented sg-segmented--small',
      attrs: { role: 'radiogroup', 'aria-label': label, id: `sg-scale-${axis}` },
    });
    for (const scale of AXIS_SCALES) {
      const choice = SCALE_CHOICES[scale];
      const input = el('input', {
        class: 'sg-sr-only',
        attrs: { type: 'radio', name: `sg-scale-${axis}`, value: scale },
      });
      input.addEventListener('change', () => {
        if (!input.checked) return;
        this.actions.patch(axis === 'x' ? { scaleX: scale } : { scaleY: scale }, 'normal');
      });
      inputs.set(scale, input);
      root.append(
        el('label', { attrs: { title: choice.title } }, input, el('span', { text: choice.label })),
      );
    }
    return root;
  }

  private syncScale(axis: FreeAxis, inputs: Map<AxisScale, HTMLInputElement>): void {
    for (const [scale, input] of inputs) input.checked = scale === axis.scale;
    const log = inputs.get('log');
    if (!log) return;
    log.disabled = !axis.logPossible;
    log
      .closest('label')
      ?.setAttribute(
        'title',
        axis.logPossible
          ? SCALE_CHOICES.log.title
          : 'Impossible : cette variable compte des valeurs nulles, qu’un logarithme ne peut pas montrer.',
      );
  }

  /** Quitte le croisement : ce qu'il avait réglé, et le cadre qu'il avait fait choisir. */
  private leave(): void {
    this.chooseMode('map');
    this.onLayoutChange();
  }

  sync(view: ResolvedView, state: AppState): void {
    const crossing = view.crossing;
    const mode: CrossMode = crossing?.mode ?? 'map';
    const asked: CrossMode =
      state.layout === 'proximity' ? 'proximity' : state.axisX || state.axisY ? 'free' : 'map';
    for (const [id, input] of this.modes) input.checked = id === asked;
    this.freeBox.hidden = asked !== 'free';
    const active = hasCustomLayout(state) || state.colorBy !== null || state.bubbleSize !== null;
    this.reset.hidden = !active;
    // À 2027, la carte est déjà celle de la méthode, et la carte de la projection dit ce qui attend.
    this.chip.hidden = !active || crossing?.suspended === true;
    this.chipLabel.textContent =
      asked === 'free'
        ? 'Axes libres'
        : asked === 'proximity'
          ? 'Carte de proximité'
          : `Aire : ${crossing?.sizeLabel ?? ''}`;

    const free = crossing?.free ?? null;
    if (free) {
      this.axisX.value = free.x.variable.id;
      this.axisY.value = free.y.variable.id;
      this.syncScale(free.x, this.scaleX);
      this.syncScale(free.y, this.scaleY);
      this.scaleNote.textContent = this.scaleNoteFor(free.x, free.y);
    } else if (!this.initialized) {
      this.axisX.value = DEFAULT_X;
      this.axisY.value = DEFAULT_Y;
    }
    this.colorBy.value = free?.color?.variable.id ?? '';
    this.bubbleSize.value = state.bubbleSize ?? '';
    // Un groupe choisi prend la main sur l'aire : le menu ne doit pas prétendre le contraire.
    const lensActive = (crossing?.lens?.pollGroup ?? null) !== null;
    this.bubbleSize.disabled = lensActive || view.projection !== null;
    if (view.projection) {
      this.sizeNote.textContent =
        'À 2027, l’aire reprend la part des inscrits de chaque parti à son dernier scrutin : aucun score n’est projeté par parti.';
    } else if (lensActive) {
      this.sizeNote.textContent =
        'Une catégorie est choisie : l’aire montre le vote de son groupe. « Quitter ce groupe » rend la main à ce menu.';
    } else {
      this.sizeNote.textContent = state.bubbleSize?.startsWith('var:')
        ? 'Ordre de grandeur : part des inscrits de l’électorat × moyenne de la variable selon sa composition, à partir des médianes par catégorie.'
        : '';
    }
    this.sizeNote.hidden = this.sizeNote.textContent === '';
    this.initialized = true;

    this.note.textContent = this.noteFor(asked, mode, view);
    const flagged = free
      ? [free.x.variable, free.y.variable, ...(free.color ? [free.color.variable] : [])].some(
          (v) => v.imputed,
        )
      : false;
    this.imputedNote.hidden = !flagged;
    if (flagged) {
      this.imputedNote.textContent = `Composition du patrimoine : valeurs imputées pour ${this.imputedCount} catégories sur ${this.itemCount}. Lecture indicative.`;
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
    const layout = free
      ? `free:${free.x.variable.id}:${free.x.scale}:${free.y.variable.id}:${free.y.scale}`
      : mode;
    if (layout !== this.lastLayout) {
      this.lastLayout = layout;
      this.onLayoutChange();
    }
  }

  private scaleNoteFor(x: FreeAxis, y: FreeAxis): string {
    const refused = [x, y].filter((axis) => !axis.logPossible);
    const parts: string[] = [];
    if (x.scale === 'log' || y.scale === 'log') {
      parts.push('Log : des écarts égaux à l’écran sont des rapports égaux.');
    }
    if (x.scale === 'rank' || y.scale === 'rank') {
      parts.push('Rang : seul l’ordre compte, pas l’écart entre deux valeurs.');
    }
    if (refused.length > 0) {
      const names = refused.map((axis) => axis.variable.label.toLowerCase()).join(' et ');
      parts.push(`Log impossible pour ${names} : des catégories y valent zéro.`);
    }
    return parts.join(' ');
  }

  private noteFor(asked: CrossMode, mode: CrossMode, view: ResolvedView): string {
    const crossing = view.crossing;
    if (asked === 'proximity') {
      if (crossing?.suspended) {
        return 'La projection 2027 n’existe que sur les axes de la carte. La carte de proximité reviendra au prochain scrutin.';
      }
      if (mode !== 'proximity') {
        return 'La carte de proximité compare des électorats : choisissez un scrutin sur la frise.';
      }
      const pct = Math.round((crossing?.explained ?? 0) * 100);
      return (
        'Plus deux électorats sont proches, plus leur composition sociale se ressemble. ' +
        `Le plan conserve ${pct} % de l’information. Ni axes ni graduations : ces directions n’ont pas de nom.`
      );
    }
    if (crossing?.suspended) {
      return 'La projection 2027 n’existe que sur les axes de la carte. Vos axes libres reviendront au prochain scrutin.';
    }
    if (asked === 'free') {
      const free = crossing?.free;
      const omitted =
        free && free.omitted > 0 ? ` ${free.omitted} sans valeur ne sont pas placées.` : '';
      const count = free?.pcs.length ?? this.itemCount;
      return (
        `Ces axes utilisent ${count} catégories Insee, et non les positions lues sur les vidéos.` +
        omitted
      );
    }
    return 'Mettez les variables de votre choix sur les axes, ou placez les électorats selon leur ressemblance.';
  }
}
