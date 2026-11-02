import { describe, expect, it } from 'vitest';
import {
  circlePenetration,
  LABEL_LINE_HEIGHT,
  placeLabels,
  rectsOverlap,
  segmentHitsRect,
  segmentsCross,
  type LabelItem,
  type Obstacle,
} from './labels.ts';
import { diamondPath } from './shapes.ts';

const bounds = { x: 0, y: 0, w: 400, h: 400 };
const measure = (text: string, font: number): number => text.length * font * 0.5;

function label(key: string, cx: number, cy: number, priority = 1): LabelItem {
  return { key, text: 'Libellé', cx, cy, r: 6, priority, font: 12 };
}

/** Rectangle occupé par un libellé placé. */
function boxOf(p: { x: number; y: number; anchor: string }, w: number, h: number) {
  const x = p.anchor === 'start' ? p.x : p.anchor === 'end' ? p.x - w : p.x - w / 2;
  return { x, y: p.y - h / 2, w, h };
}

describe('placeLabels', () => {
  it('place un libellé seul à droite de son repère', () => {
    const placed = placeLabels([label('a', 100, 100)], [], bounds, measure).get('a');
    expect(placed).toMatchObject({ visible: true, anchor: 'start', y: 100 });
    expect(placed?.x).toBe(109);
  });

  it('change de côté près du bord droit', () => {
    const placed = placeLabels([label('a', 395, 100)], [], bounds, measure).get('a');
    expect(placed).toMatchObject({ visible: true, anchor: 'end' });
  });

  it('ne laisse jamais deux libellés se chevaucher', () => {
    const items = Array.from({ length: 12 }, (_, i) => label(`l${i}`, 200, 200 + i * 4, 12 - i));
    const placed = [...placeLabels(items, [], bounds, measure).values()].filter((p) => p.visible);
    expect(placed.length).toBeGreaterThan(1);
    const w = measure('Libellé', 12);
    const h = 12 * LABEL_LINE_HEIGHT;
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i];
        const b = placed[j];
        if (a && b) expect(rectsOverlap(boxOf(a, w, h), boxOf(b, w, h))).toBe(false);
      }
    }
  });

  it('masque les libellés sans place libre, les moins prioritaires d’abord', () => {
    const items = Array.from({ length: 30 }, (_, i) => label(`l${i}`, 200, 200, 30 - i));
    const result = placeLabels(items, [], bounds, measure);
    expect(result.get('l0')?.visible).toBe(true);
    expect(result.get('l29')?.visible).toBe(false);
  });

  it('évite un petit repère voisin quand une autre position est libre', () => {
    const obstacle = { key: 'o', cx: 125, cy: 100, r: 5 };
    const placed = placeLabels([label('a', 100, 100)], [obstacle], bounds, measure).get('a');
    expect(placed?.anchor).not.toBe('start');
  });

  it('ne se gêne pas lui-même', () => {
    const own = { key: 'a', cx: 100, cy: 100, r: 6 };
    const placed = placeLabels([label('a', 100, 100)], [own], bounds, measure).get('a');
    expect(placed?.anchor).toBe('start');
  });
});

describe('groupe dense (cas de la présidentielle)', () => {
  // Treize repères serrés, comme les électorats au centre du graphique.
  const positions: [number, number][] = [
    [200, 200],
    [210, 190],
    [190, 210],
    [220, 205],
    [185, 190],
    [205, 215],
    [215, 180],
    [195, 180],
    [225, 195],
    [180, 205],
    [200, 225],
    [230, 215],
    [175, 180],
  ];
  const items: LabelItem[] = positions.map(([cx, cy], i) => ({
    ...label(`c${i}`, cx, cy, 100 - i),
    reach: 152,
    weight: 650,
  }));
  const obstacles: Obstacle[] = items.map((it) => ({
    key: it.key,
    cx: it.cx,
    cy: it.cy,
    r: it.r,
    strong: true,
  }));
  const w = measure('Libellé', 12);
  const h = 12 * LABEL_LINE_HEIGHT;
  const placed = [...placeLabels(items, obstacles, bounds, measure).values()];

  it('place tous les libellés, sans aucun chevauchement', () => {
    expect(placed.every((p) => p.visible)).toBe(true);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i];
        const b = placed[j];
        if (a && b) expect(rectsOverlap(boxOf(a, w, h), boxOf(b, w, h))).toBe(false);
      }
    }
  });

  it('ne recouvre aucun losange du groupe', () => {
    for (const p of placed) {
      const box = boxOf(p, w, h);
      for (const o of obstacles) expect(circlePenetration(o, box)).toBe(0);
    }
  });

  it('relie les libellés écartés à leur repère par une ligne de rappel', () => {
    const withLeader = placed.filter((p) => p.leader !== null);
    expect(withLeader.length).toBeGreaterThan(0);
    for (const p of withLeader) {
      const it = items.find((i) => i.key === p.key);
      if (!it || !p.leader) continue;
      // La ligne part du bord du repère et arrive sur le libellé.
      expect(Math.hypot(p.leader.x1 - it.cx, p.leader.y1 - it.cy)).toBeCloseTo(it.r, 6);
      expect(
        circlePenetration({ cx: p.leader.x2, cy: p.leader.y2, r: 0.01 }, boxOf(p, w, h)),
      ).toBeGreaterThan(0);
    }
  });

  it('évite que les lignes de rappel se croisent', () => {
    const leaders = placed.flatMap((p) => (p.leader ? [p.leader] : []));
    let crossings = 0;
    for (let i = 0; i < leaders.length; i++) {
      for (let j = i + 1; j < leaders.length; j++) {
        const a = leaders[i];
        const b = leaders[j];
        if (a && b && segmentsCross(a, b)) crossings++;
      }
    }
    expect(crossings).toBe(0);
  });

  it('est déterministe', () => {
    const again = [...placeLabels(items, obstacles, bounds, measure).values()];
    expect(again).toEqual(placed);
  });

  it('reste valide sans passe de déplacement (pendant un zoom)', () => {
    const quick = [...placeLabels(items, obstacles, bounds, measure, { passes: 0 }).values()];
    expect(quick.filter((p) => p.visible).length).toBeGreaterThan(0);
  });
});

describe('repères qui ne sont pas les siens', () => {
  // Un groupe serré d'électorats à côté d'un grand disque, comme les employés du graphique réel.
  const positions: [number, number][] = [
    [240, 200],
    [250, 192],
    [232, 208],
    [258, 204],
    [226, 192],
    [246, 214],
    [256, 184],
    [236, 182],
    [266, 196],
    [222, 206],
  ];
  const items: LabelItem[] = positions.map(([cx, cy], i) => ({
    ...label(`c${i}`, cx, cy, 100 - i),
    text: 'Libellé long',
    reach: 152,
  }));
  const disc: Obstacle = { key: 'p:grand', cx: 150, cy: 200, r: 24 };
  const obstacles: Obstacle[] = [
    disc,
    ...items.map((it) => ({ key: it.key, cx: it.cx, cy: it.cy, r: it.r, strong: true })),
  ];
  const w = measure('Libellé long', 12);
  const h = 12 * LABEL_LINE_HEIGHT;
  const placed = [...placeLabels(items, obstacles, bounds, measure).values()];

  it('ne pose pas un libellé contre un disque étranger quand il y a de la place', () => {
    for (const p of placed) {
      expect(circlePenetration({ ...disc, r: disc.r + 6 }, boxOf(p, w, h))).toBe(0);
    }
  });

  it('ne fait pas passer une ligne de rappel à travers un disque étranger', () => {
    const box = { x: disc.cx - 16, y: disc.cy - 16, w: 32, h: 32 };
    for (const p of placed) {
      if (p.leader) expect(segmentHitsRect(p.leader, box)).toBe(false);
    }
  });
});

describe('lignes de rappel', () => {
  it('n’en met pas quand le libellé touche son repère', () => {
    const p = placeLabels([{ ...label('a', 100, 100), reach: 152 }], [], bounds, measure).get('a');
    expect(p?.leader).toBeNull();
  });

  it('respecte la portée : sans portée, le libellé reste au contact ou se masque', () => {
    const cloud = Array.from({ length: 30 }, (_, i) => label(`l${i}`, 200, 200, 30 - i));
    const result = [...placeLabels(cloud, [], bounds, measure).values()];
    expect(result.every((p) => p.leader === null)).toBe(true);
  });
});

describe('utilitaires géométriques', () => {
  it('détecte le croisement de deux segments', () => {
    const a = { x1: 0, y1: 0, x2: 10, y2: 10 };
    expect(segmentsCross(a, { x1: 0, y1: 10, x2: 10, y2: 0 })).toBe(true);
    expect(segmentsCross(a, { x1: 20, y1: 0, x2: 30, y2: 10 })).toBe(false);
  });

  it('détecte un segment qui traverse un rectangle', () => {
    const r = { x: 10, y: 10, w: 10, h: 10 };
    expect(segmentHitsRect({ x1: 0, y1: 15, x2: 30, y2: 15 }, r)).toBe(true);
    expect(segmentHitsRect({ x1: 0, y1: 0, x2: 5, y2: 5 }, r)).toBe(false);
    expect(segmentHitsRect({ x1: 0, y1: 5, x2: 30, y2: 5 }, r)).toBe(false);
  });

  it('mesure la pénétration d’un disque dans un rectangle', () => {
    const rect = { x: 10, y: 10, w: 10, h: 10 };
    expect(circlePenetration({ cx: 0, cy: 15, r: 5 }, rect)).toBe(0);
    expect(circlePenetration({ cx: 7, cy: 15, r: 5 }, rect)).toBe(2);
    expect(circlePenetration({ cx: 15, cy: 15, r: 5 }, rect)).toBe(5);
  });

  it('dessine un losange centré', () => {
    expect(diamondPath(2)).toBe('M0,-2L2,0L0,2L-2,0Z');
    expect(diamondPath(-1)).toBe('M0,0L0,0L0,0L0,0Z');
  });
});
