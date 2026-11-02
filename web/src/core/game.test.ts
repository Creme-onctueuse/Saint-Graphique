import { describe, expect, it } from 'vitest';
import { buildDataset, type Dataset, type ElectionInfo } from '../data/dataset.ts';
import {
  eligibleElectorates,
  OPTION_COUNT,
  pickRound,
  playableElections,
  roundKey,
  shuffled,
  type Rng,
} from './game.ts';
import type { RawElection } from './types.ts';

const raw: RawElection = {
  id: 'e1',
  type: 'presidentielle',
  year: 2022,
  label: 'Élection test',
  pcs_level: 1,
  sources: [],
  candidates: [
    { id: 'a', label: 'Candidat A', color: '#000', national_share_pct: 40 },
    { id: 'b', label: 'Candidat B', color: '#000', national_share_pct: 30 },
    { id: 'c', label: 'Candidat C', color: '#000', national_share_pct: 20 },
    { id: 'petit', label: 'Trop petit', color: '#000', national_share_pct: 1.9 },
    { id: 'vide', label: 'Sans composition', color: '#000', national_share_pct: 8.1 },
    { id: 'abst', label: 'Abstention', color: '#000', national_share_pct: 25, is_abstention: true },
  ],
  composition: {
    a: { '3': 60, '6': 40 },
    b: { '3': 40, '6': 60 },
    c: { '3': 20, '6': 80 },
    petit: { '3': 100 },
    abst: { '3': 30, '6': 70 },
  },
};

const info: ElectionInfo = {
  id: 'e1',
  label: 'Élection test',
  type: 'presidentielle',
  year: 2022,
  round: 1,
};

function dataset(elections: RawElection[] = [raw]): Dataset {
  return {
    elections: elections.map((e) => ({ ...info, id: e.id, label: e.label })),
    rawElections: new Map(elections.map((e) => [e.id, e])),
    pcsMeta: new Map(),
  } as unknown as Dataset;
}

/** Suite de tirages imposée, qui recommence au début. */
function sequence(...values: number[]): Rng {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
}

describe('eligibleElectorates', () => {
  it('écarte l’abstention, les moins de 2 % et les électorats sans composition', () => {
    expect(eligibleElectorates(raw).map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('playableElections', () => {
  it('écarte une élection qui n’a pas trois électorats jouables', () => {
    const small: RawElection = {
      ...raw,
      id: 'e2',
      candidates: raw.candidates.filter((c) => c.id !== 'c'),
    };
    expect(playableElections(dataset([raw, small]))).toEqual(['e1']);
  });
});

describe('shuffled', () => {
  it('garde les mêmes éléments et ne modifie pas la liste', () => {
    const list = [1, 2, 3, 4];
    const out = shuffled(list, sequence(0.3, 0.8, 0.1));
    expect([...out].sort()).toEqual(list);
    expect(list).toEqual([1, 2, 3, 4]);
  });

  it('est déterministe à tirages égaux', () => {
    expect(shuffled([1, 2, 3, 4], sequence(0.2, 0.9))).toEqual(
      shuffled([1, 2, 3, 4], sequence(0.2, 0.9)),
    );
  });
});

describe('pickRound', () => {
  it('prend la réponse et les leurres dans les données', () => {
    const round = pickRound(dataset(), sequence(0));
    expect(round?.electionId).toBe('e1');
    expect(round?.answerId).toBe('a');
    expect(round?.options).toHaveLength(OPTION_COUNT);
    expect(round?.options.map((o) => o.id).sort()).toEqual(['a', 'b', 'c']);
    expect(round?.options.find((o) => o.id === round.answerId)?.label).toBe('Candidat A');
  });

  it('dépend du tirage', () => {
    expect(pickRound(dataset(), sequence(0.99))?.answerId).toBe('c');
  });

  it('propose la composition de la réponse, sans son nom', () => {
    const round = pickRound(dataset(), sequence(0));
    expect(round?.bars.map((b) => b.group)).toEqual(['3', '6']);
    expect(round?.bars[0]?.share).toBe(60);
    expect(JSON.stringify(round?.bars)).not.toContain('Candidat');
  });

  it('évite les manches déjà jouées tant qu’il en reste', () => {
    const played = new Set(['e1/a', 'e1/b']);
    expect(pickRound(dataset(), sequence(0), { played })?.answerId).toBe('c');
    const all = new Set(['e1/a', 'e1/b', 'e1/c']);
    expect(pickRound(dataset(), sequence(0), { played: all })?.answerId).toBe('a');
  });

  it('respecte l’élection imposée', () => {
    const other: RawElection = { ...raw, id: 'e2', label: 'Autre' };
    const round = pickRound(dataset([raw, other]), sequence(0), { election: 'e2' });
    expect(round?.electionId).toBe('e2');
    expect(round && roundKey(round)).toBe('e2/a');
  });

  it('renvoie null sans élection jouable', () => {
    expect(pickRound(dataset([]), sequence(0))).toBeNull();
    expect(pickRound(dataset(), sequence(0), { election: 'population' })).toBeNull();
  });
});

describe('données réelles', () => {
  const modules = import.meta.glob<unknown>('../data/computed/**/*.json', {
    eager: true,
    import: 'default',
  });
  const files: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(modules)) {
    files[path.replace('../data/computed/', '')] = value;
  }
  const ds = buildDataset(files);

  it.skipIf(ds.rawElections.size === 0)('toutes les manches tirées sont valides', () => {
    let seed = 1;
    const rng: Rng = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i = 0; i < 200; i++) {
      const round = pickRound(ds, rng);
      expect(round).not.toBeNull();
      if (!round) continue;
      const election = ds.rawElections.get(round.electionId);
      const answer = election?.candidates.find((c) => c.id === round.answerId);
      expect(answer?.is_abstention).not.toBe(true);
      expect(answer?.national_share_pct ?? 0).toBeGreaterThanOrEqual(2);
      expect(new Set(round.options.map((o) => o.id)).size).toBe(OPTION_COUNT);
      expect(round.options.map((o) => o.id)).toContain(round.answerId);
      const total = round.bars.reduce((s, b) => s + b.share, 0);
      expect(total).toBeGreaterThan(95);
      expect(total).toBeLessThan(105);
    }
  });
});
