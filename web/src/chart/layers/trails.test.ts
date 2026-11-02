import { describe, expect, it } from 'vitest';
import { thinTags } from './trails.ts';

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
