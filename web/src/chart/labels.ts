/**
 * Placement glouton des libellés avec anti-collision simple : chaque libellé essaie huit
 * positions autour de son repère (droite, gauche, dessus, dessous, diagonales) ; la première
 * position sans chevauchement avec un libellé déjà placé et la moins gênante pour les autres
 * repères est retenue. Un libellé sans place libre est masqué (l'info reste dans l'infobulle).
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LabelItem {
  key: string;
  text: string;
  /** Centre du repère (px). */
  cx: number;
  cy: number;
  /** Rayon du repère (px). */
  r: number;
  /** Les priorités élevées sont placées d'abord. */
  priority: number;
  font: number;
  /** Graisse de la police (mesure du texte). */
  weight?: number;
}

/** Repère à éviter (disque ou losange approché par un disque). */
export interface Obstacle {
  key: string;
  cx: number;
  cy: number;
  r: number;
}

export type Anchor = 'start' | 'middle' | 'end';

export interface PlacedLabel {
  key: string;
  /** Point d'ancrage du texte (x selon `anchor`, y au centre vertical). */
  x: number;
  y: number;
  anchor: Anchor;
  visible: boolean;
}

export function rectsOverlap(a: Rect, b: Rect, pad = 0): boolean {
  return (
    a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad
  );
}

/** Profondeur de pénétration d'un disque dans un rectangle (0 si disjoints). */
export function circlePenetration(o: Obstacle, r: Rect): number {
  const nx = Math.max(r.x, Math.min(o.cx, r.x + r.w));
  const ny = Math.max(r.y, Math.min(o.cy, r.y + r.h));
  const d = Math.hypot(o.cx - nx, o.cy - ny);
  return Math.max(0, o.r - d);
}

interface Candidate {
  rect: Rect;
  anchor: Anchor;
  penalty: number;
}

function candidatesFor(it: LabelItem, w: number, h: number): Candidate[] {
  const gap = 3;
  const { cx, cy, r } = it;
  const d = r * Math.SQRT1_2;
  return [
    { rect: { x: cx + r + gap, y: cy - h / 2, w, h }, anchor: 'start', penalty: 0 },
    { rect: { x: cx - r - gap - w, y: cy - h / 2, w, h }, anchor: 'end', penalty: 0.3 },
    { rect: { x: cx - w / 2, y: cy - r - gap - h, w, h }, anchor: 'middle', penalty: 0.5 },
    { rect: { x: cx - w / 2, y: cy + r + gap, w, h }, anchor: 'middle', penalty: 0.6 },
    { rect: { x: cx + d + gap, y: cy - d - h, w, h }, anchor: 'start', penalty: 0.8 },
    { rect: { x: cx + d + gap, y: cy + d, w, h }, anchor: 'start', penalty: 0.9 },
    { rect: { x: cx - d - gap - w, y: cy - d - h, w, h }, anchor: 'end', penalty: 1 },
    { rect: { x: cx - d - gap - w, y: cy + d, w, h }, anchor: 'end', penalty: 1.1 },
  ];
}

function anchorPoint(c: Candidate): { x: number; y: number } {
  const { rect, anchor } = c;
  const x = anchor === 'start' ? rect.x : anchor === 'end' ? rect.x + rect.w : rect.x + rect.w / 2;
  return { x, y: rect.y + rect.h / 2 };
}

/**
 * Place les libellés dans `bounds`. `measure(text, font, weight)` renvoie la largeur du texte
 * en px.
 */
export function placeLabels(
  items: readonly LabelItem[],
  obstacles: readonly Obstacle[],
  bounds: Rect,
  measure: (text: string, font: number, weight: number) => number,
): Map<string, PlacedLabel> {
  const placed: Rect[] = [];
  const out = new Map<string, PlacedLabel>();
  const sorted = [...items].sort((a, b) => b.priority - a.priority);
  for (const it of sorted) {
    const w = measure(it.text, it.font, it.weight ?? 400);
    const h = it.font * 1.2;
    let best: Candidate | null = null;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const c of candidatesFor(it, w, h)) {
      const r = c.rect;
      if (r.x < bounds.x || r.y < bounds.y) continue;
      if (r.x + r.w > bounds.x + bounds.w || r.y + r.h > bounds.y + bounds.h) continue;
      if (placed.some((p) => rectsOverlap(p, r, 1))) continue;
      let cost = c.penalty;
      for (const o of obstacles) {
        if (o.key === it.key) continue;
        const pen = circlePenetration(o, r);
        // Les petits repères masqués par un libellé gênent plus que les grands disques.
        if (pen > 0) cost += (o.r < 12 ? 4 : 1) * Math.min(1, pen / h);
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = c;
      }
    }
    if (best) {
      placed.push(best.rect);
      const p = anchorPoint(best);
      out.set(it.key, { key: it.key, x: p.x, y: p.y, anchor: best.anchor, visible: true });
    } else {
      out.set(it.key, { key: it.key, x: it.cx, y: it.cy, anchor: 'middle', visible: false });
    }
  }
  return out;
}
