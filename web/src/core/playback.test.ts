import { describe, expect, it } from 'vitest';
import type { ChartCandidate } from '../chart/types.ts';
import { interpolateMarks, sizeOf } from './playback.ts';

function mark(
  id: string,
  x: number,
  y: number,
  registered: number,
  track?: string,
): ChartCandidate {
  return {
    id,
    label: id,
    color: '#000',
    x,
    y,
    share: registered,
    registeredShare: registered,
    isAbstention: false,
    ellipse: null,
    composition: null,
    ...(track ? { trackKey: track, trackLabel: `Famille ${track}` } : {}),
  };
}

const from = [mark('le-pen', 0, 0, 16, 'rn'), mark('hamon', 5, 5, 4)];
const to = [mark('fn', 2, 4, 36, 'rn'), mark('joly', -5, -5, 9)];

describe('interpolateMarks', () => {
  it('fait glisser un parti d’une élection à l’autre, malgré le changement d’identifiant', () => {
    const rn = interpolateMarks(from, to, 0.5).find((m) => m.trackKey === 'rn');
    expect(rn?.x).toBeCloseTo(1);
    expect(rn?.y).toBeCloseTo(2);
    expect(rn?.sizeShare).toBeCloseTo(26);
    expect(rn?.alpha).toBe(1);
    expect(rn?.label).toBe('Famille rn');
  });

  it('passe par les positions exactes aux deux bouts', () => {
    const at0 = interpolateMarks(from, to, 0).find((m) => m.trackKey === 'rn');
    const at1 = interpolateMarks(from, to, 1).find((m) => m.trackKey === 'rn');
    expect([at0?.x, at0?.y, at0?.id]).toEqual([0, 0, 'le-pen']);
    expect([at1?.x, at1?.y, at1?.id]).toEqual([2, 4, 'fn']);
  });

  it('fait grandir sur place un électorat qui apparaît', () => {
    const joly = interpolateMarks(from, to, 0.25).find((m) => m.id === 'joly');
    expect([joly?.x, joly?.y]).toEqual([-5, -5]);
    expect(joly?.sizeShare).toBeCloseTo(2.25);
    expect(joly?.alpha).toBeCloseTo(0.25);
  });

  it('fait fondre sur place un électorat qui disparaît', () => {
    const hamon = interpolateMarks(from, to, 0.75).find((m) => m.id === 'hamon');
    expect([hamon?.x, hamon?.y]).toEqual([5, 5]);
    expect(hamon?.sizeShare).toBeCloseTo(1);
    expect(hamon?.alpha).toBeCloseTo(0.25);
  });

  it('borne l’instant', () => {
    expect(interpolateMarks(from, to, 2).find((m) => m.trackKey === 'rn')?.x).toBe(2);
    expect(interpolateMarks(from, to, -1).find((m) => m.trackKey === 'rn')?.x).toBe(0);
  });

  it('ne perd aucun électorat', () => {
    expect(interpolateMarks(from, to, 0.5)).toHaveLength(3);
  });
});

describe('sizeOf', () => {
  it('préfère la mesure croisée, puis la part des inscrits, puis le score', () => {
    const base = mark('a', 0, 0, 10);
    expect(sizeOf({ ...base, sizeShare: 3 })).toBe(3);
    expect(sizeOf(base)).toBe(10);
    expect(sizeOf({ ...base, registeredShare: null, share: 7 })).toBe(7);
    expect(sizeOf({ ...base, registeredShare: null, share: null })).toBe(0);
  });
});
