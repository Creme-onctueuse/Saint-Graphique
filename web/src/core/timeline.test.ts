import { describe, expect, it } from 'vitest';
import type { FamilyConfig } from '../data/dataset.ts';
import {
  blocVotes,
  carrySelection,
  familyHistory,
  familyOfCandidate,
  familyTrails,
  nearestStopId,
  nextStopId,
  playStartId,
  previousStopId,
  ringCenter,
  stopsForFilter,
  timelineStops,
  usesMapAxes,
  type CandidatePosition,
  type TimelineStop,
} from './timeline.ts';
import { PROJECTION_ID, type RawElection } from './types.ts';

const families: FamilyConfig = {
  dates: new Map([
    ['p17', 2017.3],
    ['l17', 2017.4],
    ['p22', 2022.3],
    ['l22', 2022.4],
    ['e24', 2024.4],
  ]),
  families: [
    {
      id: 'lfi',
      label: 'France insoumise',
      projection: true,
      candidates: new Map([
        ['p17', 'melenchon'],
        ['l17', 'lfi'],
        ['p22', 'melenchon'],
        ['e24', 'lfi'],
      ]),
    },
    {
      id: 'rn',
      label: 'RN',
      projection: true,
      candidates: new Map([
        ['p17', 'le-pen'],
        ['l22', 'rn'],
      ]),
    },
    {
      id: 'pcf',
      label: 'PCF',
      projection: false,
      candidates: new Map([['l17', 'pcf']]),
    },
  ],
  blocs: [
    { id: 'gauche', label: 'Gauche', candidates: new Set(['melenchon', 'lfi', 'nupes', 'pcf']) },
    { id: 'extreme_droite', label: 'Extrême droite', candidates: new Set(['le-pen', 'rn']) },
    { id: 'abstention', label: 'Abstention', candidates: new Set(['abst']) },
  ],
  unclassified: new Set(['divers']),
};

const elections = [
  { id: 'e24', label: 'Eur. 2024', type: 'europeennes', year: 2024 },
  { id: 'p17', label: 'Prés. 2017', type: 'presidentielle', year: 2017 },
  { id: 'l17', label: 'Lég. 2017', type: 'legislatives', year: 2017 },
  { id: 'p22', label: 'Prés. 2022', type: 'presidentielle', year: 2022 },
  { id: 'l22', label: 'Lég. 2022', type: 'legislatives', year: 2022 },
];

const projections = new Map([['m', { target: { label: 'Présidentielle 2027', date: 2027.3 } }]]);

const stops = timelineStops({ elections, families, projections });
const stopIds = (list: readonly TimelineStop[]): string[] => list.map((s) => s.id);

describe('timelineStops', () => {
  it('range les étapes dans le temps, projection en dernier', () => {
    expect(stopIds(stops)).toEqual(['p17', 'l17', 'p22', 'l22', 'e24', PROJECTION_ID]);
    expect(stops.at(-1)?.projection).toBe(true);
    expect(stops.at(-1)?.year).toBe(2027);
    expect(stops.at(-1)?.label).toContain('pas un résultat');
  });

  it('n’ajoute pas de projection sans fichier', () => {
    const none = timelineStops({ elections, families, projections: new Map() });
    expect(stopIds(none)).not.toContain(PROJECTION_ID);
  });

  it('se rabat sur l’année sans date connue', () => {
    const none = timelineStops({ elections, families: null, projections: new Map() });
    expect(none[0]?.date).toBe(2017);
  });
});

describe('filtre et navigation', () => {
  it('garde les étapes du type choisi, dont la projection pour les présidentielles', () => {
    expect(stopIds(stopsForFilter(stops, 'presidentielle'))).toEqual(['p17', 'p22', PROJECTION_ID]);
    expect(stopIds(stopsForFilter(stops, 'legislatives'))).toEqual(['l17', 'l22']);
    expect(stopsForFilter(stops, 'all')).toHaveLength(6);
  });

  it('avance et recule d’une étape, sans dépasser les bords', () => {
    expect(nextStopId(stops, 'p17')).toBe('l17');
    expect(nextStopId(stops, PROJECTION_ID)).toBeNull();
    expect(previousStopId(stops, 'l17')).toBe('p17');
    expect(previousStopId(stops, 'p17')).toBeNull();
  });

  it('entre dans la frise depuis une étape qui n’en fait pas partie', () => {
    expect(nextStopId(stops, 'population')).toBe('p17');
    expect(previousStopId(stops, 'population')).toBe(PROJECTION_ID);
  });

  it('relance la lecture au début si elle est finie', () => {
    expect(playStartId(stops, 'p22')).toBe('p22');
    expect(playStartId(stops, PROJECTION_ID)).toBe('p17');
    expect(playStartId(stops, 'population')).toBe('p17');
  });

  it('trouve l’étape la plus proche', () => {
    expect(nearestStopId(stopsForFilter(stops, 'legislatives'), 2017.3)).toBe('l17');
    expect(nearestStopId(stopsForFilter(stops, 'legislatives'), 2024)).toBe('l22');
    expect(nearestStopId([], 2024)).toBeNull();
  });
});

describe('familles et sélection', () => {
  it('retrouve une famille par candidat ou par identifiant', () => {
    expect(familyOfCandidate(families, 'melenchon')?.id).toBe('lfi');
    expect(familyOfCandidate(families, 'rn')?.id).toBe('rn');
    expect(familyOfCandidate(families, 'nupes')).toBeNull();
  });

  it('fait suivre la sélection d’une élection à l’autre', () => {
    expect(carrySelection(families, 'l17', 'c:melenchon')).toBe('c:lfi');
    expect(carrySelection(families, 'p22', 'c:lfi')).toBe('c:melenchon');
    expect(carrySelection(families, PROJECTION_ID, 'c:lfi')).toBe('c:lfi');
    expect(carrySelection(families, 'p22', 'c:lfi')).toBe('c:melenchon');
  });

  it('ne l’attribue pas à une coalition', () => {
    // Pas de France insoumise aux législatives de 2022 : la NUPES n'en tient pas lieu.
    expect(carrySelection(families, 'l22', 'c:melenchon')).toBe('c:melenchon');
  });

  it('laisse le reste intact', () => {
    expect(carrySelection(families, 'p22', 'p:31')).toBe('p:31');
    expect(carrySelection(families, 'p22', null)).toBeNull();
    expect(carrySelection(null, 'p22', 'c:lfi')).toBe('c:lfi');
    expect(carrySelection(families, PROJECTION_ID, 'c:pcf')).toBe('c:pcf');
  });
});

describe('familyTrails', () => {
  const position = (election: string, candidate: string): CandidatePosition | null => ({
    x: Number(families.dates.get(election)),
    y: candidate.length,
    color: '#123456',
    share: 10,
    isAbstention: false,
  });

  it('coupe la trajectoire à une élection sans électorat de la famille', () => {
    const trails = familyTrails(families, stops, position, 3000);
    const lfi = trails.find((t) => t.family === 'lfi');
    expect(lfi?.segments.map((s) => s.map((p) => p.election))).toEqual([
      ['p17', 'l17', 'p22'],
      ['e24'],
    ]);
  });

  it('s’arrête à l’élection affichée', () => {
    const trails = familyTrails(families, stops, position, 2017.4);
    const lfi = trails.find((t) => t.family === 'lfi');
    expect(lfi?.segments).toHaveLength(1);
    expect(lfi?.segments[0]?.map((p) => p.election)).toEqual(['p17', 'l17']);
    expect(trails.some((t) => t.family === 'rn')).toBe(true);
  });

  it('ne coupe pas pour une élection écartée par le filtre', () => {
    const trails = familyTrails(families, stopsForFilter(stops, 'presidentielle'), position, 3000);
    const lfi = trails.find((t) => t.family === 'lfi');
    expect(lfi?.segments.map((s) => s.map((p) => p.election))).toEqual([['p17', 'p22']]);
  });

  it('écarte une famille sans point', () => {
    const trails = familyTrails(families, stopsForFilter(stops, 'europeennes'), position, 3000);
    expect(trails.map((t) => t.family)).toEqual(['lfi']);
  });

  it('ignore un candidat sans position', () => {
    const trails = familyTrails(families, stops, () => null, 3000);
    expect(trails).toEqual([]);
  });
});

const election: RawElection = {
  id: 'p22',
  type: 'presidentielle',
  year: 2022,
  label: 'Test',
  pcs_level: 1,
  sources: [],
  candidates: [
    { id: 'melenchon', label: 'M', color: '#000', national_share_pct: 60 },
    { id: 'rn', label: 'R', color: '#000', national_share_pct: 30 },
    { id: 'divers', label: 'D', color: '#000', national_share_pct: 10 },
    { id: 'abst', label: 'A', color: '#000', national_share_pct: 50, is_abstention: true },
  ],
  composition: {
    melenchon: { '3': 50, '6': 50 },
    rn: { '3': 25, '6': 75 },
    divers: { '3': 50, '6': 50 },
    abst: { '3': 20, '6': 80 },
  },
};

describe('blocVotes', () => {
  const rings = blocVotes(election, families);

  it('donne un anneau par groupe, dont les parts somment à 100', () => {
    expect(rings.map((r) => r.group)).toEqual(['3', '6']);
    for (const ring of rings) {
      expect(ring.parts.reduce((a, p) => a + p.share, 0)).toBeCloseTo(100);
    }
  });

  it('garde un ordre fixe et compte à part ce qui n’est pas un bloc', () => {
    const parts = rings[0]?.parts ?? [];
    expect(parts.map((p) => p.bloc)).toEqual([
      'gauche',
      'centre',
      'droite',
      'extreme_droite',
      'autres',
      'abstention',
    ]);
    expect(parts.find((p) => p.bloc === 'centre')?.share).toBe(0);
    expect(parts.find((p) => p.bloc === 'autres')?.share).toBeGreaterThan(0);
  });

  it('calcule la part de chaque bloc dans le groupe', () => {
    // Cadres, sur les inscrits : gauche 30·50 % = 15 ; ED 15·25 % = 3,75 ; autres 5·50 % = 2,5 ;
    // abstention 50·20 % = 10 ; total 31,25.
    const parts = rings[0]?.parts ?? [];
    expect(rings[0]?.weight).toBeCloseTo(31.25);
    expect(parts.find((p) => p.bloc === 'gauche')?.share).toBeCloseTo((100 * 15) / 31.25);
    expect(parts.find((p) => p.bloc === 'abstention')?.share).toBeCloseTo((100 * 10) / 31.25);
  });
});

describe('ringCenter', () => {
  const available = new Set(['2', '6']);
  const categories = [
    { group: '1', x: 0, y: 0, weight: 1 },
    { group: '2', x: 4, y: 8, weight: 3 },
    { group: '6', x: 10, y: 10, weight: 2 },
    { group: '8', x: 50, y: 50, weight: 9 },
  ];

  it('réunit les agriculteurs et les indépendants', () => {
    expect(ringCenter('2', categories, available)).toEqual({ x: 3, y: 6 });
  });

  it('ne compte que les catégories du groupe', () => {
    expect(ringCenter('6', categories, available)).toEqual({ x: 10, y: 10 });
  });

  it('ne place pas un groupe sans catégorie', () => {
    expect(ringCenter('3', categories, available)).toBeNull();
  });
});

describe('familyHistory', () => {
  it('donne le score et la composition de la famille, sans coalition', () => {
    const history = familyHistory(families, stops, new Map([['p22', election]]), 'lfi');
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ election: 'p22', share: 60 });
    expect(history[0]?.composition).toEqual({ '3': 50, '6': 50 });
  });

  it('ne donne rien pour une famille inconnue', () => {
    expect(familyHistory(families, stops, new Map(), 'inconnue')).toEqual([]);
  });
});

describe('usesMapAxes', () => {
  it('est faux dès que des axes libres ou la carte de proximité sont affichés', () => {
    expect(usesMapAxes({ axisX: null, axisY: null, layout: 'map' })).toBe(true);
    expect(usesMapAxes({ axisX: 'bac5', axisY: null, layout: 'map' })).toBe(false);
    expect(usesMapAxes({ axisX: null, axisY: null, layout: 'proximity' })).toBe(false);
  });
});
