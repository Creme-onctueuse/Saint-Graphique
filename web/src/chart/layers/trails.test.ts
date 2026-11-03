import { describe, expect, it } from 'vitest';
import type { TrailPoint } from '../../core/timeline.ts';
import { thinTags, withTip } from './trails.ts';

describe('thinTags', () => {
  it('garde le plus récent de deux noms qui se chevauchent', () => {
    const kept = thinTags([
      { id: 'ancien', px: 100, py: 100 },
      { id: 'récent', px: 110, py: 104 },
    ]);
    expect(kept.map((k) => k.id)).toEqual(['récent']);
  });

  it('garde les noms assez éloignés sur un axe', () => {
    const items = [
      { px: 100, py: 100 },
      { px: 200, py: 100 },
      { px: 100, py: 130 },
    ];
    expect(thinTags(items)).toHaveLength(3);
  });

  it('accepte une liste vide', () => {
    expect(thinTags([])).toEqual([]);
  });
});

describe('withTip', () => {
  const point = (election: string, institute: string | null): TrailPoint => ({
    election,
    institute,
    x: 0,
    y: 0,
    share: 1,
  });
  const a = point('a', 'Ifop');
  const b = point('b', 'Ifop');
  const tip = point('b', 'Ifop');

  it('sans repère, ne change rien', () => {
    expect(withTip([a, b], null, 'Ifop')).toEqual([{ points: [a, b], sourceChange: false }]);
  });

  it('prolonge le tronçon quand l’institut suivant est le même', () => {
    expect(withTip([a, b], tip, 'Ifop')).toEqual([{ points: [a, b, tip], sourceChange: false }]);
  });

  it('ouvre un tronçon en pointillés vers un autre institut', () => {
    expect(withTip([a, b], tip, 'CSA')).toEqual([
      { points: [a, b], sourceChange: false },
      { points: [b, tip], sourceChange: true },
    ]);
  });

  it('dessine le premier pas d’une trajectoire, qui n’a encore qu’un point', () => {
    expect(withTip([b], tip, 'Ifop')).toEqual([{ points: [b, tip], sourceChange: false }]);
  });
});
