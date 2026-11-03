/** Mise en forme des nombres à la française (virgule décimale, signe moins typographique). */

/** Espace insécable (U+00A0). */
export const NBSP = String.fromCharCode(0x00a0);
/** Signe moins typographique (U+2212). */
export const MINUS = String.fromCharCode(0x2212);

const formatters = new Map<number, Intl.NumberFormat>();

function formatter(digits: number): Intl.NumberFormat {
  let f = formatters.get(digits);
  if (!f) {
    f = new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      signDisplay: 'negative',
    });
    formatters.set(digits, f);
  }
  return f;
}

/** 3.14159 → « 3,14 » ; -2 → « −2,00 » (signe moins U+2212). */
export function formatNumber(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '–';
  return formatter(digits).format(n).replace('-', MINUS);
}

/** Nom court d'un éditeur : « Insee-DGFiP-Cnaf… » et « Insee, Progedo… » donnent « Insee ». */
export function shortPublisher(publisher: string): string {
  const first = (publisher.split(',')[0] ?? publisher).trim();
  return first.startsWith('Insee') ? 'Insee' : first;
}

/** L'institut, sans ses partenaires : « Ifop-Fiducial » et « Ifop » sont le même institut. */
export function instituteOf(publisher: string): string {
  return /^[\p{L}\p{N}]+/u.exec(publisher.trim())?.[0] ?? publisher.trim();
}

/** 4.187 → « 4,2 % » (espace insécable avant le signe %). */
export function formatPct(n: number, digits = 1): string {
  return `${formatNumber(n, digits)}${NBSP}%`;
}
