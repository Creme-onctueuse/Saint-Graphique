import { describe, expect, it } from 'vitest';
import { circlePenetration, placeLabels, rectsOverlap, type LabelItem } from './labels.ts';
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
    const h = 12 * 1.2;
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

describe('utilitaires géométriques', () => {
  it('mesure la pénétration d’un disque dans un rectangle', () => {
    const rect = { x: 10, y: 10, w: 10, h: 10 };
    expect(circlePenetration({ key: 'a', cx: 0, cy: 15, r: 5 }, rect)).toBe(0);
    expect(circlePenetration({ key: 'a', cx: 7, cy: 15, r: 5 }, rect)).toBe(2);
    expect(circlePenetration({ key: 'a', cx: 15, cy: 15, r: 5 }, rect)).toBe(5);
  });

  it('dessine un losange centré', () => {
    expect(diamondPath(2)).toBe('M0,-2L2,0L0,2L-2,0Z');
    expect(diamondPath(-1)).toBe('M0,0L0,0L0,0L0,0Z');
  });
});
