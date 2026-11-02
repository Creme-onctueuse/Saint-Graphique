/**
 * Variables Insee que l'on peut mettre sur les axes de la carte (panneau « Croiser »). Elles viennent
 * de data/pcs.json, donc des 30 catégories du recensement, et non des 41 positions lues.
 *
 * Module pur, testé dans freeAxes.test.ts.
 */
import { formatNumber, formatPct, NBSP } from './format.ts';
import type { RawPcsItem } from './types.ts';

export interface Variable {
  id: string;
  /** Libellé d'axe, en toutes lettres. */
  label: string;
  /** Vrai si la plupart des valeurs sont imputées : à signaler partout où la variable apparaît. */
  imputed: boolean;
  read(item: RawPcsItem): number | null;
  format(value: number): string;
}

function finite(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

const euros = (v: number): string => `${formatNumber(v, 0)}${NBSP}€`;
const thousandEuros = (v: number): string => `${formatNumber(v, 0)}${NBSP}k€`;
const percent = (v: number): string => formatPct(v, 0);

function composition(id: string, label: string, key: string): Variable {
  return {
    id,
    label,
    imputed: true,
    read: (item) => finite(item.patrimoine_composition?.[key]),
    format: percent,
  };
}

export const VARIABLES: readonly Variable[] = [
  {
    id: 'niveau_vie',
    label: 'Niveau de vie mensuel',
    imputed: false,
    read: (item) => finite(item.niveau_vie_mensuel_eur),
    format: euros,
  },
  {
    id: 'patrimoine',
    label: 'Patrimoine médian',
    imputed: false,
    read: (item) => finite(item.patrimoine_keur),
    format: thousandEuros,
  },
  {
    id: 'bac5',
    label: 'Diplômés bac +5 et plus',
    imputed: false,
    read: (item) => finite(item.diplomes.bac5),
    format: percent,
  },
  {
    id: 'bac',
    label: 'Diplômés du bac',
    imputed: false,
    read: (item) => finite(item.diplomes.bac),
    format: percent,
  },
  {
    id: 'cap',
    label: 'Titulaires d’un CAP ou BEP',
    imputed: false,
    read: (item) => finite(item.diplomes.cap),
    format: percent,
  },
  {
    id: 'certif_aucun',
    label: 'Certificat d’études ou aucun diplôme',
    imputed: false,
    read: (item) => finite(item.diplomes.certif_aucun),
    format: percent,
  },
  composition('immobilier', 'Part de l’immobilier dans le patrimoine', 'immobilier_pct'),
  composition('financier', 'Part du financier dans le patrimoine', 'financier_pct'),
  composition('professionnel', 'Part du professionnel dans le patrimoine', 'professionnel_pct'),
  composition('proprietaire', 'Ménages propriétaires', 'proprietaire_pct'),
  composition('entreprise', 'Ménages détenant une entreprise', 'detention_entreprise_pct'),
];

export function variableById(id: string | null): Variable | null {
  return VARIABLES.find((v) => v.id === id) ?? null;
}

/** Variables renseignées dans ces données : la fixture d'exemple n'a pas de composition du patrimoine. */
export function availableVariables(items: readonly RawPcsItem[]): Variable[] {
  return VARIABLES.filter((v) => items.filter((it) => v.read(it) !== null).length >= 3);
}
