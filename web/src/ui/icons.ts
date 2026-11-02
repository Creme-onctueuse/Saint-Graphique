/**
 * Jeu d'icônes du projet, dessiné pour ce site : une seule grille (24 × 24), un seul trait, la couleur
 * du texte. Aucune police d'icônes, aucune requête : les tracés sont dans le code.
 *
 * Dans index.html : <span class="sg-icon" data-icon="plus"></span>, rempli par mountIcons().
 */
const SVG_NS = 'http://www.w3.org/2000/svg';

type Shape = string | { cx: number; cy: number; r: number };

const ICONS = {
  plus: ['M12 5v14M5 12h14'],
  minus: ['M5 12h14'],
  'fit-all': ['M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'],
  'fit-electorates': ['M12 8l4 4-4 4-4-4z', 'M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4'],
  link: [
    'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1',
    'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  ],
  image: ['M4 5h16v14H4z', 'M4 16l5-5 4 4 3-3 4 4', { cx: 15, cy: 9, r: 1.5 }],
  vector: ['M4 4h5v5H4zM15 15h5v5h-5z', 'M9 6.5h4a4.5 4.5 0 0 1 4.5 4.5v4'],
  info: [{ cx: 12, cy: 12, r: 9 }, 'M12 11v5M12 8h.01'],
  auto: [{ cx: 12, cy: 12, r: 8.5 }, 'M12 3.5v17'],
  sun: [
    { cx: 12, cy: 12, r: 4 },
    'M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3L7 7M17 17l1.7 1.7M5.3 18.7L7 17M17 7l1.7-1.7',
  ],
  moon: ['M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z'],
  close: ['M6 6l12 12M18 6L6 18'],
  electorates: ['M12 3.5l8.5 8.5-8.5 8.5L3.5 12z'],
  categories: [
    { cx: 8.5, cy: 9, r: 4.5 },
    { cx: 16, cy: 15.5, r: 4.5 },
  ],
  cross: [
    { cx: 9, cy: 12, r: 6 },
    { cx: 15, cy: 12, r: 6 },
  ],
  method: ['M4 7h9M19 7h1M4 17h1M11 17h9', { cx: 16, cy: 7, r: 2.5 }, { cx: 8, cy: 17, r: 2.5 }],
  data: ['M4 5h16v14H4z', 'M4 10h16M4 15h16M10 5v14'],
  play: ['M8 5l11 7-11 7z'],
  pause: ['M8.5 5v14M15.5 5v14'],
  trails: ['M4 19c4-1 3-6 7-7s4-6 9-7', { cx: 4, cy: 19, r: 1 }, { cx: 11, cy: 12, r: 1 }],
  rings: [
    { cx: 12, cy: 12, r: 8.5 },
    { cx: 12, cy: 12, r: 3.5 },
  ],
  shuffle: [
    'M3.5 7H7l9 10h4.5M3.5 17H7l2.5-2.8M13.5 9.8L16 7h4.5M18 4.5L20.5 7 18 9.5M18 14.5l2.5 2.5-2.5 2.5',
  ],
  compare: ['M12 4v16M8 20h8M6 7h12', 'M6 7l-3 7h6zM18 7l-3 7h6z'],
  game: [{ cx: 12, cy: 12, r: 9 }, 'M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.1 1-1.1 1.8M12 17h.01'],
  idea: [
    'M9.5 18h5M10.5 21h3',
    'M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z',
  ],
  warning: ['M12 4l9 16H3z', 'M12 10v4.5M12 17.5h.01'],
  book: ['M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z', 'M5 17a3 3 0 0 1 3-3h11'],
  chevron: ['M9 6l6 6-6 6'],
  eye: [
    'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z',
    { cx: 12, cy: 12, r: 2.75 },
  ],
  'eye-off': ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', 'M4 4l16 16'],
  target: [{ cx: 12, cy: 12, r: 8.5 }, 'M12 2v4M12 18v4M2 12h4M18 12h4'],
} satisfies Record<string, readonly Shape[]>;

export type IconName = keyof typeof ICONS;

function isIcon(name: string): name is IconName {
  return Object.hasOwn(ICONS, name);
}

/** Crée une icône. Elle est décorative : le nom du bouton passe par son texte ou aria-label. */
export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('sg-icon__svg');
  for (const shape of ICONS[name] as readonly Shape[]) {
    if (typeof shape === 'string') {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', shape);
      svg.append(path);
    } else {
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', String(shape.cx));
      circle.setAttribute('cy', String(shape.cy));
      circle.setAttribute('r', String(shape.r));
      svg.append(circle);
    }
  }
  return svg;
}

/** Remplit les emplacements [data-icon] de la page. */
export function mountIcons(root: ParentNode = document): void {
  for (const slot of root.querySelectorAll<HTMLElement>('[data-icon]')) {
    const name = slot.dataset['icon'] ?? '';
    if (isIcon(name)) slot.replaceChildren(icon(name));
  }
}
