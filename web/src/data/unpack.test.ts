import { describe, expect, it } from 'vitest';
// @ts-expect-error script Node sans déclaration de types : seul ce test l'importe.
import { packComputed } from '../../scripts/pack-computed.mjs';
import { unpackComputed } from './unpack.ts';

type Files = Record<string, Record<string, unknown>>;
const pack = packComputed as (files: Files) => {
  packed: Files;
  pool: Record<string, unknown[]>;
};

const pcs = [{ code: '10', x: 1, y: 2 }];
const files: Files = {
  'ranks/a.json': { method: 'ranks', election_id: 'a', pcs, candidates: [{ id: 'x' }] },
  'ranks/b.json': { method: 'ranks', election_id: 'b', pcs, candidates: [{ id: 'y' }] },
  'mca/a.json': {
    method: 'mca',
    election_id: 'a',
    pcs: [{ code: '10', x: 3, y: 4 }],
    candidates: [],
  },
};

describe('packComputed et unpackComputed', () => {
  it('ne garde qu’une fois une liste répétée', () => {
    const { packed, pool } = pack(files);
    expect(pool['pcs']).toHaveLength(2);
    expect(packed['ranks/a.json']?.['pcs']).toBe(packed['ranks/b.json']?.['pcs']);
    expect(packed['mca/a.json']?.['pcs']).not.toBe(packed['ranks/a.json']?.['pcs']);
  });

  it('rend les fichiers à l’identique', () => {
    const { packed, pool } = pack(files);
    expect(unpackComputed({ ...packed, '_pool.json': pool })).toEqual(files);
  });

  it('laisse tout passer quand il n’y a pas de réservoir', () => {
    const plain = { 'index.json': { methods: [] }, 'ranks/a.json': { pcs } };
    expect(unpackComputed(plain)).toEqual(plain);
  });

  it('ne touche pas aux fichiers qui ne sont pas des objets', () => {
    expect(unpackComputed({ 'x.json': [1, 2], '_pool.json': { pcs: [[]] } })).toEqual({
      'x.json': [1, 2],
    });
  });
});
