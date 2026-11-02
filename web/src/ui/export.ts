/**
 * Export du graphique en SVG et en PNG. Le SVG exporté est autonome : styles calculés incorporés
 * (les var(--sg-*) n'existent plus hors de la page), avec titre, légende et crédits. Un export hors
 * de la page perd le bandeau : l'avertissement sur les données fictives y est donc recopié.
 *
 * Téléchargement par blob et lien <a download>, qui fonctionne aussi en file://.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Propriétés recopiées sur chaque élément exporté. */
const INLINE_PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'vector-effect',
  'stop-color',
  'stop-opacity',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'paint-order',
  'visibility',
];

/** Attributs propres à l'interface, sans objet dans un fichier. */
const DROP_ATTRS = ['tabindex', 'role', 'class', 'data-key', 'aria-label', 'aria-hidden'];

export interface LegendEntry {
  label: string;
  color: string;
  shape: 'disc' | 'diamond';
}

export interface ExportMeta {
  title: string;
  subtitle: string;
  /** Avertissement à faire figurer sur l'image (données fictives). */
  warning: string | null;
  legend: LegendEntry[];
  /** Réserves et sources : une image circule sans la page, elle doit les porter elle-même. */
  notes: string[];
  credit: string;
}

export interface ExportedSvg {
  markup: string;
  width: number;
  height: number;
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  text?: string,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Résout un var(--sg-…) à partir d'un élément de la page. */
function resolveColor(color: string, probe: Element): string {
  const span = document.createElementNS(SVG_NS, 'rect');
  span.style.fill = color;
  probe.append(span);
  const resolved = getComputedStyle(span).fill;
  span.remove();
  return resolved || color;
}

function textWidth(ctx: CanvasRenderingContext2D | null, text: string, size: number): number {
  return ctx ? ctx.measureText(text).width : text.length * size * 0.56;
}

function wrap(
  ctx: CanvasRenderingContext2D | null,
  text: string,
  size: number,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(ctx, next, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Construit le fichier SVG autonome à partir du graphique affiché. */
export function buildExportSvg(source: SVGSVGElement, meta: ExportMeta): ExportedSvg {
  const clone = source.cloneNode(true) as SVGSVGElement;
  const sourceNodes = [...source.querySelectorAll<SVGElement>('*')];
  const cloneNodes = [...clone.querySelectorAll<SVGElement>('*')];
  sourceNodes.forEach((node, i) => {
    const target = cloneNodes[i];
    if (!target) return;
    const cs = getComputedStyle(node);
    target.setAttribute(
      'style',
      INLINE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'),
    );
  });
  // Les éléments en sortie d'animation et le calque de développement ne s'exportent pas.
  clone
    .querySelectorAll('.sg-exiting, .sg-layer-below > *, .sg-layer-above > *')
    .forEach((n) => n.remove());
  for (const node of clone.querySelectorAll('*')) {
    for (const attr of DROP_ATTRS) node.removeAttribute(attr);
    node.removeAttribute('aria-describedby');
  }
  clone.querySelector('title')?.remove();
  clone.querySelector('desc')?.remove();

  const cs = getComputedStyle(source);
  const background = cs.getPropertyValue('--sg-surface').trim() || '#ffffff';
  const ink = cs.getPropertyValue('--sg-text').trim() || '#000000';
  const muted = cs.getPropertyValue('--sg-text-muted').trim() || '#555555';
  const warningColor = cs.getPropertyValue('--sg-warning-text').trim() || ink;
  const warningBg = cs.getPropertyValue('--sg-warning-bg').trim() || background;
  const candidateRing = cs.getPropertyValue('--sg-cand-ring').trim() || 'none';
  const family = cs.fontFamily;

  const width = Number(source.getAttribute('width')) || source.clientWidth;
  const chartHeight = Number(source.getAttribute('height')) || source.clientHeight;
  const pad = 16;
  const inner = width - 2 * pad;

  let measure: CanvasRenderingContext2D | null = null;
  try {
    measure = document.createElement('canvas').getContext('2d');
  } catch {
    measure = null;
  }
  const setFont = (size: number, weight: number): void => {
    if (measure) measure.font = `${weight} ${size}px ${family}`;
  };

  const out = svgEl('svg', { xmlns: SVG_NS, width });
  out.setAttribute('font-family', family);
  const parts: SVGElement[] = [];
  let y = pad;

  setFont(18, 700);
  for (const line of wrap(measure, meta.title, 18, inner)) {
    y += 22;
    parts.push(svgEl('text', { x: pad, y, fill: ink, 'font-size': 18, 'font-weight': 700 }, line));
  }
  setFont(13, 400);
  for (const line of wrap(measure, meta.subtitle, 13, inner)) {
    y += 18;
    parts.push(svgEl('text', { x: pad, y, fill: muted, 'font-size': 13 }, line));
  }
  if (meta.warning) {
    setFont(13, 650);
    const lines = wrap(measure, meta.warning, 13, inner - 16);
    y += 8;
    parts.push(
      svgEl('rect', {
        x: pad,
        y,
        width: inner,
        height: lines.length * 17 + 10,
        rx: 4,
        fill: warningBg,
      }),
    );
    y += 4;
    for (const line of lines) {
      y += 16;
      parts.push(
        svgEl(
          'text',
          { x: pad + 8, y, fill: warningColor, 'font-size': 13, 'font-weight': 650 },
          line,
        ),
      );
    }
    y += 4;
  }
  y += 10;

  // Carte : un SVG imbriqué la découpe, sinon un zoom ferait déborder ses repères sur la légende.
  const group = svgEl('svg', {
    x: 0,
    y,
    width,
    height: chartHeight,
    viewBox: `0 0 ${width} ${chartHeight}`,
  });
  while (clone.firstChild) group.append(clone.firstChild);
  parts.push(group);
  y += chartHeight + 6;

  // Légende, sur autant de lignes que nécessaire
  setFont(12, 400);
  let cursorX = pad;
  const rowHeight = 18;
  y += 12;
  for (const entry of meta.legend) {
    const w = 16 + textWidth(measure, entry.label, 12) + 14;
    if (cursorX + w > width - pad && cursorX > pad) {
      cursorX = pad;
      y += rowHeight;
    }
    const color = resolveColor(entry.color, source);
    if (entry.shape === 'disc') {
      parts.push(svgEl('circle', { cx: cursorX + 6, cy: y - 4, r: 5.5, fill: color }));
    } else {
      parts.push(
        svgEl('path', {
          d: `M${cursorX + 6},${y - 10}l6,6l-6,6l-6,-6z`,
          fill: color,
          stroke: candidateRing,
          'stroke-width': 1,
        }),
      );
    }
    parts.push(svgEl('text', { x: cursorX + 16, y, fill: ink, 'font-size': 12 }, entry.label));
    cursorX += w;
  }

  // Réserves et sources
  setFont(11, 400);
  y += 8;
  for (const note of meta.notes) {
    for (const line of wrap(measure, note, 11, inner)) {
      y += 15;
      parts.push(svgEl('text', { x: pad, y, fill: ink, 'font-size': 11 }, line));
    }
  }

  // Crédits
  y += 8;
  for (const line of wrap(measure, meta.credit, 11, inner)) {
    y += 15;
    parts.push(svgEl('text', { x: pad, y, fill: muted, 'font-size': 11 }, line));
  }
  const height = Math.ceil(y + pad);

  out.setAttribute('height', String(height));
  out.setAttribute('viewBox', `0 0 ${width} ${height}`);
  out.append(svgEl('rect', { width, height, fill: background }), ...parts);

  const markup = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(out)}`;
  return { markup, width, height };
}

/** Déclenche le téléchargement d'un blob sous le nom donné. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function svgBlob(exported: ExportedSvg): Blob {
  return new Blob([exported.markup], { type: 'image/svg+xml;charset=utf-8' });
}

/** Rend le SVG exporté dans un canvas, au double de sa taille pour rester net. */
export async function pngBlob(exported: ExportedSvg, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(svgBlob(exported));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Image SVG illisible'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(exported.width * scale);
    canvas.height = Math.round(exported.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas indisponible');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Conversion PNG impossible'))),
        'image/png',
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
