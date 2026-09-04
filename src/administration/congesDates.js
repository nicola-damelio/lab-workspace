/* =========================================================================
   src/administration/congesDates.js
   Aide « jours ouvrés » pour la page Congés.

   La feuille Google Sheets « Congés » du laboratoire décompte dans la
   colonne « Jours » les jours ouvrés entre le premier et le dernier jour de
   congé INCLUS : week-ends exclus, ainsi que les jours fériés français de
   métropole (fixes et mobiles — Lundi de Pâques, Ascension, Pentecôte).

   Saison annuelle de référence (note de la feuille source) : 1er septembre →
   31 août de l'année suivante ; 47 jours ouvrés pour un permanent, dont
   jusqu'à 28 pendant les fermetures UPJV (2 semaines de Noël + 4 semaines
   entre juillet et août). Les fêtes nationales tombant pendant une fermeture
   UPJV ne sont pas décomptées des jours de congés.
   ========================================================================= */

const pad2 = (n) => String(n).padStart(2, '0');

const parseISO = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** ISO (yyyy-mm-dd) → affichage français jj/mm/aaaa. */
export const toFrDate = (iso) => {
  const d = parseISO(iso);
  return d ? `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}` : '';
};

/* Dimanche de Pâques (algorithme de Meeus / Jones / Butcher) → { m, d }. */
const easterSunday = (year) => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { m: month, d: day };
};

/** Jours fériés français (métropole) d'une année, au format ISO. */
export const frenchHolidaysOf = (year) => {
  const fixed = [
    [1, 1],    // Jour de l'An
    [5, 1],    // Fête du Travail
    [5, 8],    // Victoire 1945
    [7, 14],   // Fête nationale
    [8, 15],   // Assomption
    [11, 1],   // Toussaint
    [11, 11],  // Armistice 1918
    [12, 25],  // Noël
  ];
  const set = new Set(fixed.map(([m, d]) => `${year}-${pad2(m)}-${pad2(d)}`));
  const shift = (date, days) => {
    const x = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
    return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
  };
  const eSun = new Date(year, easterSunday(year).m - 1, easterSunday(year).d);
  set.add(shift(eSun, 1));   // Lundi de Pâques
  set.add(shift(eSun, 39));  // Jeudi de l'Ascension
  set.add(shift(eSun, 50));  // Lundi de Pentecôte
  return set;
};

/* Cache des fériés par année (évite de recalculer à chaque itération). */
const holidayCache = new Map();
const holidaysOf = (year) => {
  if (!holidayCache.has(year)) holidayCache.set(year, frenchHolidaysOf(year));
  return holidayCache.get(year);
};

/**
 * Jours ouvrés entre deux dates ISO incluses (week-ends et jours fériés
 * exclus). Renvoie null si les dates sont absentes / invalides / inversées.
 */
export const businessDaysBetween = (startISO, endISO) => {
  const start = parseISO(startISO);
  const end = parseISO(endISO);
  if (!start || !end || start > end) return null;
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) {
      const iso = `${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}-${pad2(cursor.getDate())}`;
      if (!holidaysOf(cursor.getFullYear()).has(iso)) count += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
};
