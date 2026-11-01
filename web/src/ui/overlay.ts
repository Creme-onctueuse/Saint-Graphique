/**
 * Mode calque, pour le développement uniquement (import conditionné par import.meta.env.DEV) : on
 * dépose une capture sur le graphique, on règle son opacité et on la cale en cliquant deux points
 * dont les coordonnées sont connues, par défaut (−10, −10) puis (10, 10). L'image est ensuite placée
 * en coordonnées de données : elle suit le zoom et le redimensionnement.
 *
 * L'image reste en mémoire : elle n'est jamais écrite sur disque ni dans le dépôt (les captures
 * vidéo de research/ ne doivent pas être publiées).
 */
import './overlay.css';
import type { SaintChart } from '../chart/chart.ts';
import { formatNumber } from '../core/format.ts';
import type { Point } from '../core/types.ts';
import { el } from './dom.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Emprise de l'image en coordonnées de données. */
interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Position relative d'un clic dans l'image (0..1). */
interface ImagePoint {
  u: number;
  v: number;
}

/**
 * Emprise de l'image telle que les points relatifs a et b tombent sur les coordonnées A et B.
 * Deux équations par axe, sans rotation. Renvoie null si les deux points sont trop alignés.
 */
export function solveBounds(a: ImagePoint, b: ImagePoint, A: Point, B: Point): Bounds | null {
  if (Math.abs(b.u - a.u) < 1e-6 || Math.abs(b.v - a.v) < 1e-6) return null;
  const width = (B.x - A.x) / (b.u - a.u);
  const left = A.x - a.u * width;
  const height = (A.y - B.y) / (b.v - a.v);
  const top = A.y + a.v * height;
  return { left, right: left + width, top, bottom: top - height };
}

export function installOverlay(chart: SaintChart): void {
  const image = document.createElementNS(SVG_NS, 'image');
  image.setAttribute('preserveAspectRatio', 'none');
  image.style.pointerEvents = 'none';
  const markers = document.createElementNS(SVG_NS, 'g');

  let bounds: Bounds | null = null;
  let objectUrl: string | null = null;
  let natural = { width: 1, height: 1 };
  let opacity = 0.5;
  let above = true;
  let clicks: ImagePoint[] | null = null;

  const help = el('p', {
    class: 'sg-devoverlay__help',
    text: 'Déposez une capture sur le graphique.',
  });
  const readout = el('p', { text: 'x –, y –' });
  const file = el('input', { attrs: { type: 'file', accept: 'image/*', 'aria-label': 'Capture' } });
  const opacityInput = el('input', {
    attrs: {
      type: 'range',
      min: '0',
      max: '1',
      step: '0.05',
      value: String(opacity),
      'aria-label': 'Opacité du calque',
    },
  });
  const aboveInput = el('input', { attrs: { type: 'checkbox', 'aria-label': 'Calque au-dessus' } });
  aboveInput.checked = above;
  const coordinate = (value: number, label: string): HTMLInputElement =>
    el('input', {
      attrs: { type: 'number', step: '0.5', value: String(value), 'aria-label': label },
    });
  const ax = coordinate(-10, 'Point 1, x');
  const ay = coordinate(-10, 'Point 1, y');
  const bx = coordinate(10, 'Point 2, x');
  const by = coordinate(10, 'Point 2, y');
  const calibrate = el('button', {
    class: 'sg-btn',
    text: 'Caler (2 clics)',
    attrs: { type: 'button' },
  });
  const remove = el('button', { class: 'sg-btn', text: 'Retirer', attrs: { type: 'button' } });

  const panel = el(
    'aside',
    { class: 'sg-devoverlay', attrs: { 'aria-label': 'Mode calque' } },
    el('p', { class: 'sg-devoverlay__title', text: 'Calque (dev)' }),
    file,
    el('label', { class: 'sg-devoverlay__row' }, 'Opacité', opacityInput),
    el('label', { class: 'sg-devoverlay__row' }, aboveInput, 'Au-dessus des repères'),
    el('div', { class: 'sg-devoverlay__row' }, 'P1', ax, ay),
    el('div', { class: 'sg-devoverlay__row' }, 'P2', bx, by),
    el('div', { class: 'sg-devoverlay__row' }, calibrate, remove),
    help,
    readout,
  );
  document.body.append(panel);

  const render = (): void => {
    const layer = above ? chart.layerAbove : chart.layerBelow;
    if (image.parentNode !== layer) layer.append(image);
    if (markers.parentNode !== chart.layerAbove) chart.layerAbove.append(markers);
    const b = bounds;
    if (!b || !objectUrl) {
      image.removeAttribute('href');
      return;
    }
    const { x, y } = chart.scales();
    image.setAttribute('href', objectUrl);
    image.setAttribute('x', String(x(b.left)));
    image.setAttribute('y', String(y(b.top)));
    image.setAttribute('width', String(Math.max(0, x(b.right) - x(b.left))));
    image.setAttribute('height', String(Math.max(0, y(b.bottom) - y(b.top))));
    image.setAttribute('opacity', String(opacity));
  };
  chart.onRender(render);

  const load = (blob: Blob): void => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(blob);
    const probe = new Image();
    probe.onload = () => {
      natural = { width: probe.naturalWidth, height: probe.naturalHeight };
      // Position initiale : l'image tient dans la zone visible, proportions conservées.
      const { x, y } = chart.scales();
      const [x0, x1] = x.domain() as [number, number];
      const [y0, y1] = y.domain() as [number, number];
      const scale = Math.min((x1 - x0) / natural.width, (y1 - y0) / natural.height);
      const w = natural.width * scale;
      const h = natural.height * scale;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      bounds = { left: cx - w / 2, right: cx + w / 2, top: cy + h / 2, bottom: cy - h / 2 };
      help.textContent = 'Réglez l’opacité, puis calez l’image en deux clics.';
      render();
    };
    probe.src = objectUrl;
  };

  const placeMarker = (point: Point): void => {
    const { x, y } = chart.scales();
    const marker = document.createElementNS(SVG_NS, 'circle');
    marker.setAttribute('class', 'sg-devoverlay__marker');
    marker.setAttribute('cx', String(x(point.x)));
    marker.setAttribute('cy', String(y(point.y)));
    marker.setAttribute('r', '6');
    markers.append(marker);
  };

  const stepHelp = (n: number): string =>
    n === 0
      ? `Cliquez sur le point (${ax.value}, ${ay.value}) de l’image.`
      : `Cliquez sur le point (${bx.value}, ${by.value}) de l’image.`;

  calibrate.addEventListener('click', () => {
    if (!bounds) {
      help.textContent = 'Déposez d’abord une capture.';
      return;
    }
    clicks = [];
    markers.replaceChildren();
    panel.classList.add('sg-devoverlay--calibrating');
    help.textContent = stepHelp(0);
  });

  // Le calage capte les clics avant le graphique (ni infobulle, ni zoom).
  chart.element.addEventListener(
    'click',
    (e) => {
      const b = bounds;
      if (!clicks || !b) return;
      const point = chart.clientToData(e.clientX, e.clientY);
      if (!point) return;
      e.stopPropagation();
      e.preventDefault();
      placeMarker(point);
      clicks.push({
        u: (point.x - b.left) / (b.right - b.left),
        v: (b.top - point.y) / (b.top - b.bottom),
      });
      if (clicks.length === 1) {
        help.textContent = stepHelp(1);
        return;
      }
      const [first, second] = clicks;
      clicks = null;
      panel.classList.remove('sg-devoverlay--calibrating');
      markers.replaceChildren();
      const solved =
        first && second
          ? solveBounds(
              first,
              second,
              { x: Number(ax.value), y: Number(ay.value) },
              { x: Number(bx.value), y: Number(by.value) },
            )
          : null;
      if (solved) {
        bounds = solved;
        help.textContent = 'Image calée.';
        render();
      } else {
        help.textContent = 'Points trop alignés : choisissez-en deux éloignés en x et en y.';
      }
    },
    true,
  );

  chart.element.addEventListener('pointermove', (e) => {
    const p = chart.clientToData(e.clientX, e.clientY);
    if (p) readout.textContent = `x ${formatNumber(p.x)}, y ${formatNumber(p.y)}`;
  });

  chart.element.addEventListener('dragover', (e) => e.preventDefault());
  chart.element.addEventListener('drop', (e) => {
    e.preventDefault();
    const dropped = e.dataTransfer?.files[0];
    if (dropped?.type.startsWith('image/')) load(dropped);
  });
  file.addEventListener('change', () => {
    const chosen = file.files?.[0];
    if (chosen) load(chosen);
  });
  opacityInput.addEventListener('input', () => {
    opacity = Number(opacityInput.value);
    render();
  });
  aboveInput.addEventListener('change', () => {
    above = aboveInput.checked;
    render();
  });
  remove.addEventListener('click', () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    bounds = null;
    clicks = null;
    file.value = '';
    markers.replaceChildren();
    panel.classList.remove('sg-devoverlay--calibrating');
    help.textContent = 'Déposez une capture sur le graphique.';
    render();
  });
  render();
}
