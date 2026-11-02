/**
 * Placement des libellés avec anti-collision et lignes de rappel.
 *
 * Chaque libellé cherche sa place sur des anneaux de plus en plus éloignés de son repère, dans
 * seize directions. Un libellé ne chevauche jamais un autre libellé. Parmi les places libres, on
 * retient la moins coûteuse : éloignement, repères recouverts ou voisins d'un libellé qui n'est pas
 * le leur, lignes de rappel qui se croisent, qui traversent un libellé ou un repère. Un libellé écarté de son repère est relié à lui par une ligne de
 * rappel.
 *
 * Passe gloutonne par priorité, puis déplacement itératif : chaque libellé est retiré et replacé en
 * tenant compte de tous les autres. Sans place libre à portée, un libellé est masqué (l'information
 * reste dans l'infobulle, la légende et le tableau).
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
  /** Éloignement maximal (px) avec ligne de rappel ; 0 = uniquement au contact du repère. */
  reach?: number;
}

/** Repère à éviter (disque ou losange approché par un disque). */
export interface Obstacle {
  key: string;
  cx: number;
  cy: number;
  r: number;
  /** Repère à ne surtout pas recouvrir (losange d'un électorat). */
  strong?: boolean;
}

export type Anchor = 'start' | 'middle' | 'end';

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PlacedLabel {
  key: string;
  /** Point d'ancrage du texte (x selon `anchor`, y au centre vertical). */
  x: number;
  y: number;
  anchor: Anchor;
  visible: boolean;
  /** Ligne de rappel, du bord du repère au libellé. */
  leader: Segment | null;
}

export interface PlaceOptions {
  /** Passes de déplacement itératif après la passe gloutonne. */
  passes?: number;
}

const GAP = 3;
/**
 * Écart minimal entre deux libellés (px) : plus large à l'horizontale, pour que deux libellés sur
 * une même ligne ne se lisent pas comme une seule chaîne.
 */
const LABEL_PAD_X = 8;
const LABEL_PAD_Y = 1;
/**
 * Hauteur occupée par une ligne de texte, en em. La boîte réelle du texte vaut environ 1,33 em avec
 * les polices système courantes et n'est pas tout à fait centrée sur le point d'ancrage.
 */
export const LABEL_LINE_HEIGHT = 1.4;
/** Éloignements successifs au-delà du contact (px). */
const RINGS = [0, 8, 16, 26, 38, 52, 68, 86, 106, 128, 152];
const DISTANCE_COST = 0.06;
const COVER_STRONG_COST = 18;
const COVER_SMALL_COST = 12;
const COVER_LARGE_COST = 12;
const LEADER_CROSS_COST = 8;
const LEADER_OVER_STRONG_COST = 6;
const LEADER_OVER_MARK_COST = 5;
/** Un libellé posé contre un repère qui n'est pas le sien se lit comme le libellé de ce repère. */
const NEAR_FOREIGN_MARK_COST = 3;
const NEAR_FOREIGN_MARK_GAP = 6;
/** En dessous de ce rayon (px), un disque recouvert gêne autant qu'un petit repère. */
const SMALL_MARK_RADIUS = 12;

/** Directions essayées, de la préférée à la moins naturelle (y vers le bas). */
const DIRECTIONS = (
  [
    [0, 0],
    [180, 0.3],
    [-90, 0.5],
    [90, 0.6],
    [-45, 0.8],
    [45, 0.9],
    [-135, 1],
    [135, 1.1],
    [-22.5, 1.2],
    [22.5, 1.25],
    [-157.5, 1.3],
    [157.5, 1.35],
    [-67.5, 1.4],
    [67.5, 1.45],
    [-112.5, 1.5],
    [112.5, 1.55],
  ] as const
).map(([deg, penalty]) => ({
  cos: Math.cos((deg * Math.PI) / 180),
  sin: Math.sin((deg * Math.PI) / 180),
  penalty,
}));

export function rectsOverlap(a: Rect, b: Rect, padX = 0, padY = padX): boolean {
  return (
    a.x < b.x + b.w + padX &&
    b.x < a.x + a.w + padX &&
    a.y < b.y + b.h + padY &&
    b.y < a.y + a.h + padY
  );
}

/** Profondeur de pénétration d'un disque dans un rectangle (0 si disjoints). */
export function circlePenetration(o: Pick<Obstacle, 'cx' | 'cy' | 'r'>, r: Rect): number {
  const nx = Math.max(r.x, Math.min(o.cx, r.x + r.w));
  const ny = Math.max(r.y, Math.min(o.cy, r.y + r.h));
  const d = Math.hypot(o.cx - nx, o.cy - ny);
  return Math.max(0, o.r - d);
}

/** Vrai si les deux segments se coupent franchement (un point commun aux extrémités ne compte pas). */
export function segmentsCross(a: Segment, b: Segment): boolean {
  const orient = (px: number, py: number, qx: number, qy: number, rx: number, ry: number): number =>
    (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const d1 = orient(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
  const d2 = orient(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  const d3 = orient(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
  const d4 = orient(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Vrai si le segment traverse le rectangle (découpage de Liang-Barsky). */
export function segmentHitsRect(s: Segment, r: Rect): boolean {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, s.x1 - r.x],
    [dx, r.x + r.w - s.x1],
    [-dy, s.y1 - r.y],
    [dy, r.y + r.h - s.y1],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

function pointSegmentDistance(px: number, py: number, s: Segment): number {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / len2)) : 0;
  return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
}

interface Slot {
  rect: Rect;
  anchor: Anchor;
  leader: Segment | null;
}

/** Ligne de rappel du bord du repère au point le plus proche du libellé. */
function leaderFor(it: LabelItem, rect: Rect): Segment | null {
  const nx = Math.max(rect.x, Math.min(it.cx, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(it.cy, rect.y + rect.h));
  const len = Math.hypot(nx - it.cx, ny - it.cy);
  if (len <= it.r + GAP + 1) return null;
  const ux = (nx - it.cx) / len;
  const uy = (ny - it.cy) / len;
  return { x1: it.cx + ux * it.r, y1: it.cy + uy * it.r, x2: nx, y2: ny };
}

function slotAt(
  it: LabelItem,
  w: number,
  h: number,
  distance: number,
  cos: number,
  sin: number,
): Slot {
  const reach = it.r + GAP + distance;
  const px = it.cx + reach * cos;
  const py = it.cy + reach * sin;
  let x: number;
  let anchor: Anchor;
  if (cos > 0.3) {
    x = px;
    anchor = 'start';
  } else if (cos < -0.3) {
    x = px - w;
    anchor = 'end';
  } else {
    x = px - w / 2;
    anchor = 'middle';
  }
  const y = sin > 0.3 ? py : sin < -0.3 ? py - h : py - h / 2;
  const rect = { x, y, w, h };
  return { rect, anchor, leader: distance > 0 ? leaderFor(it, rect) : null };
}

function coverCost(o: Obstacle, rect: Rect, h: number): number {
  const pen = circlePenetration(o, rect);
  if (pen <= 0) return 0;
  const weight = o.strong
    ? COVER_STRONG_COST
    : o.r < SMALL_MARK_RADIUS
      ? COVER_SMALL_COST
      : COVER_LARGE_COST;
  return weight * (0.5 + 0.5 * Math.min(1, pen / h));
}

function bestSlot(
  it: LabelItem,
  w: number,
  h: number,
  obstacles: readonly Obstacle[],
  bounds: Rect,
  others: readonly Slot[],
): Slot | null {
  const reachLimit = it.reach ?? 0;
  let best: Slot | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const distance of RINGS) {
    if (distance > reachLimit) break;
    // Les anneaux suivants coûtent au moins leur éloignement : inutile d'aller plus loin.
    if (best && bestCost <= distance * DISTANCE_COST) break;
    for (const dir of DIRECTIONS) {
      const slot = slotAt(it, w, h, distance, dir.cos, dir.sin);
      const r = slot.rect;
      if (r.x < bounds.x || r.y < bounds.y) continue;
      if (r.x + r.w > bounds.x + bounds.w || r.y + r.h > bounds.y + bounds.h) continue;
      if (others.some((o) => rectsOverlap(o.rect, r, LABEL_PAD_X, LABEL_PAD_Y))) continue;

      let cost = dir.penalty + distance * DISTANCE_COST;
      for (const o of obstacles) {
        if (o.key === it.key) continue;
        cost += coverCost(o, r, h);
        if (circlePenetration({ ...o, r: o.r + NEAR_FOREIGN_MARK_GAP }, r) > 0) {
          cost += NEAR_FOREIGN_MARK_COST;
        }
      }
      for (const other of others) {
        // Ce libellé ne doit pas se poser sur la ligne de rappel d'un autre.
        if (other.leader && segmentHitsRect(other.leader, r)) cost += LEADER_CROSS_COST;
        if (slot.leader) {
          if (segmentHitsRect(slot.leader, other.rect)) cost += LEADER_CROSS_COST;
          if (other.leader && segmentsCross(slot.leader, other.leader)) cost += LEADER_CROSS_COST;
        }
      }
      if (slot.leader) {
        const leader = slot.leader;
        for (const o of obstacles) {
          if (o.key !== it.key && pointSegmentDistance(o.cx, o.cy, leader) < o.r) {
            cost += o.strong ? LEADER_OVER_STRONG_COST : LEADER_OVER_MARK_COST;
          }
        }
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = slot;
      }
    }
  }
  return best;
}

function anchorPoint(slot: Slot): { x: number; y: number } {
  const { rect, anchor } = slot;
  const x = anchor === 'start' ? rect.x : anchor === 'end' ? rect.x + rect.w : rect.x + rect.w / 2;
  return { x, y: rect.y + rect.h / 2 };
}

/**
 * Place les libellés dans `bounds`. `measure(text, font, weight)` renvoie la largeur du texte en px.
 */
export function placeLabels(
  items: readonly LabelItem[],
  obstacles: readonly Obstacle[],
  bounds: Rect,
  measure: (text: string, font: number, weight: number) => number,
  options: PlaceOptions = {},
): Map<string, PlacedLabel> {
  const passes = options.passes ?? 2;
  const order = [...items].sort((a, b) => b.priority - a.priority);
  const sizes = new Map(
    order.map((it) => [
      it.key,
      { w: measure(it.text, it.font, it.weight ?? 400), h: it.font * LABEL_LINE_HEIGHT },
    ]),
  );
  const slots = new Map<string, Slot>();
  for (let pass = 0; pass <= passes; pass++) {
    for (const it of order) {
      slots.delete(it.key);
      const size = sizes.get(it.key);
      if (!size) continue;
      const slot = bestSlot(it, size.w, size.h, obstacles, bounds, [...slots.values()]);
      if (slot) slots.set(it.key, slot);
    }
  }
  const out = new Map<string, PlacedLabel>();
  for (const it of order) {
    const slot = slots.get(it.key);
    if (slot) {
      const p = anchorPoint(slot);
      out.set(it.key, {
        key: it.key,
        x: p.x,
        y: p.y,
        anchor: slot.anchor,
        visible: true,
        leader: slot.leader,
      });
    } else {
      out.set(it.key, {
        key: it.key,
        x: it.cx,
        y: it.cy,
        anchor: 'middle',
        visible: false,
        leader: null,
      });
    }
  }
  return out;
}
