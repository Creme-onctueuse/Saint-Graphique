/**
 * Visite guidée : cinq étapes qui font bouger la carte. Le texte ne cite aucun chiffre : ceux qu'on
 * voit viennent des données affichées, et restent justes si elles changent.
 *
 * Module pur, testé dans tour.test.ts.
 */
import type { AppState } from './state.ts';

export type TourFrame = 'all' | 'electorates';

export interface TourStep {
  title: string;
  text: string;
  /** Réglages de la carte à cette étape. Ce qui n'est pas cité reprend sa valeur de départ. */
  state: Partial<AppState>;
  frame: TourFrame;
}

/** Scrutin qui sert de fil à la visite, et repères qu'elle montre. */
const ELECTION = '2022_presidentielle_t1';
const EARLIER = '2017_presidentielle_t1';

export const TOUR_STEPS: readonly TourStep[] = [
  {
    title: 'Une carte de la société',
    text: 'Chaque disque est une catégorie sociale, et son aire dit combien de personnes elle compte. En haut, les positions dominantes. À droite, les revenus tirés du capital plutôt que du travail.',
    state: { election: ELECTION },
    frame: 'all',
  },
  {
    title: 'Les électorats',
    text: 'Chaque bulle est un électorat, placé au centre de gravité des catégories qui le composent. Son aire dit sa taille, en part des inscrits. Le point marque sa position exacte.',
    state: { election: ELECTION },
    frame: 'electorates',
  },
  {
    title: 'Croiser une catégorie',
    text: 'Cliquez sur une catégorie : les bulles se redimensionnent pour montrer comment vote son groupe social. Ici, les ouvriers. Le détail s’ouvre à droite.',
    state: { election: ELECTION, selected: 'p:62' },
    frame: 'all',
  },
  {
    title: 'Suivre un électorat dans le temps',
    text: 'Un électorat bouge d’un scrutin à l’autre. Sa trajectoire reste sur la carte, et le bouton de lecture de la frise la fait défiler. Les catégories, elles, gardent leur place.',
    state: { election: EARLIER, selected: 'c:le-pen' },
    frame: 'electorates',
  },
  {
    title: 'À vous de jouer',
    text: 'Le panneau Croiser change les axes et ce que mesure l’aire des bulles. La recherche retrouve votre métier. Et le jeu, dans le menu de gauche, vous met au défi de reconnaître un électorat.',
    state: { election: ELECTION, panel: 'cross', bubbleSize: 'dans:6' },
    frame: 'electorates',
  },
];

/** Réglages neutres d'où part chaque étape, pour qu'une étape n'hérite pas de la précédente. */
const NEUTRAL: Partial<AppState> = {
  selected: null,
  compared: null,
  panel: null,
  bubbleSize: null,
  axisX: null,
  axisY: null,
  scaleX: null,
  scaleY: null,
  colorBy: null,
  layout: 'map',
  showRings: false,
  hiddenCandidates: [],
  hiddenGroups: [],
};

/** État complet à appliquer pour une étape. */
export function tourPatch(step: TourStep): Partial<AppState> {
  return { ...NEUTRAL, ...step.state };
}
