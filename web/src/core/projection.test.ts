import { describe, expect, it } from 'vitest';
import {
  asProjectionFile,
  backtestRow,
  formatDataEnd,
  scenarioError,
  scenarioPoint,
  verdictSentence,
  verdictText,
  type ProjectionFile,
} from './projection.ts';

const errors = { n: 2, position_mean: 0.5, position_worst: 1, score_mean: 3, score_worst: 6 };

function row(
  phi: number,
  position: number,
  score: number,
): ProjectionFile['backtest']['parties'][0] {
  return {
    phi,
    n: 17,
    position_mean: position,
    position_worst: 2,
    score_mean: score,
    score_worst: 20,
  };
}

const file: ProjectionFile = {
  method: 'read_positions',
  target: { label: 'Présidentielle 2027', date: 2027.3 },
  data_end: '2024-07',
  min_history: 3,
  backtest: {
    parties: [row(0, 0.62, 6.2), row(1, 0.81, 8.4)],
    blocs: [row(0, 0.42, 4.8), row(1, 0.51, 6)],
    verdict: { trend_worse_position: true, trend_worse_score: true },
  },
  families: [
    {
      id: 'rn',
      label: 'Rassemblement national',
      color: '#123456',
      last_election: 'x',
      points: 7,
      still: { x: 1, y: 2 },
      trend: { x: 3, y: 4 },
      error: { still: errors, trend: { ...errors, position_mean: 0.9 } },
    },
  ],
  blocs: [
    {
      id: 'gauche',
      label: 'Gauche',
      tested: true,
      last_election: 'x',
      points: 7,
      still: { x: 0, y: 0 },
      trend: { x: 1, y: 1 },
      error: { still: errors, trend: errors },
      score_range: { still: [29.9, 31.8], trend: [29.8, 34.4] },
    },
  ],
};

describe('asProjectionFile', () => {
  it('accepte un fichier complet', () => {
    expect(asProjectionFile(file)?.method).toBe('read_positions');
  });

  it('écarte un fichier incomplet', () => {
    expect(asProjectionFile(null)).toBeNull();
    expect(asProjectionFile({ ...file, target: {} })).toBeNull();
    expect(asProjectionFile({ ...file, families: [{ id: 'x' }] })).toBeNull();
    expect(
      asProjectionFile({
        ...file,
        blocs: [{ ...file.blocs[0], score_range: { still: [1], trend: [1, 2] } }],
      }),
    ).toBeNull();
    expect(
      asProjectionFile({ ...file, backtest: { ...file.backtest, parties: [{ phi: 0 }] } }),
    ).toBeNull();
  });
});

describe('scénarios', () => {
  const rn = file.families[0];

  it('donne la position et l’erreur du scénario', () => {
    expect(rn && scenarioPoint(rn, 'still')).toEqual({ x: 1, y: 2 });
    expect(rn && scenarioPoint(rn, 'trend')).toEqual({ x: 3, y: 4 });
    expect(rn && scenarioError(rn, 'trend').position_mean).toBe(0.9);
  });

  it('retrouve une ligne du tableau', () => {
    expect(backtestRow(file.backtest.parties, 1)?.position_mean).toBe(0.81);
    expect(backtestRow(file.backtest.parties, 0.25)).toBeNull();
  });
});

describe('verdictText', () => {
  it('reprend les chiffres du fichier', () => {
    const text = verdictText(file);
    expect(text.headline).toBe(
      'Testé sur le passé : la tendance prédit moins bien que « rien ne bouge »',
    );
    expect(text.position).toContain('0,81 contre 0,62 (partis)');
    expect(text.position).toContain('0,51 contre 0,42 (blocs)');
    expect(text.score).toContain('8,4 contre 6,2 (partis)');
    expect(text.score).toContain('6,0 contre 4,8 (blocs)');
    expect(text.comparison).toContain('tendance contre « rien ne bouge »');
    expect(text.dataEnd).toContain('juillet 2024');
  });

  it('ne prétend pas à un résultat que le fichier ne donne pas', () => {
    const verdict = { trend_worse_position: false, trend_worse_score: false };
    const text = verdictText({ ...file, backtest: { ...file.backtest, verdict } });
    expect(text.headline).toContain('ne fait pas moins bien');
    const mixed = verdictText({
      ...file,
      backtest: {
        ...file.backtest,
        verdict: { trend_worse_position: true, trend_worse_score: false },
      },
    });
    expect(mixed.headline).toContain('place moins bien');
  });
});

describe('verdictSentence', () => {
  it('tient le résultat du test en une ligne, chiffres compris', () => {
    const sentence = verdictSentence(file);
    expect(sentence).toContain('prédit moins bien');
    expect(sentence).toContain('position 0,81 contre 0,62 (partis)');
    expect(sentence).toContain('score 8,4 contre 6,2 (partis)');
    expect(sentence).toContain('juillet 2024');
  });
});

describe('formatDataEnd', () => {
  it('écrit le mois en toutes lettres', () => {
    expect(formatDataEnd('2024-07')).toBe('juillet 2024');
  });

  it('laisse une valeur inattendue telle quelle', () => {
    expect(formatDataEnd('bientôt')).toBe('bientôt');
  });
});
