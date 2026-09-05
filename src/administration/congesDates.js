/* =========================================================================
   src/administration/congesDates.js
   Aide « jours ouvrés » pour la page Congés.

   La feuille Google Sheets « Congés » du laboratoire décompte dans la
   colonne « Jours » les jours ouvrés entre le premier et le dernier jour de
   congé INCLUS : week-ends exclus, ainsi que les jours fériés français de
   métropole (fixes et mobiles — Lundi de Pâques, Ascension, Pentecôte).

   Saison annuelle de référence (note de la feuille source) : 1er septembre →
   31 août de l'année suivante, renouvelée automatiquement chaque 1er septembre.
   Quota annuel par profil : 47 jours ouvrés par défaut (Doctorant), modulable
   dans Paramètres › « Congés : jours/an par profil ». Les jours de congé sont
   décomptés en jours ouvrés entre le premier et le dernier jour inclus (week-
   ends et fêtes nationales françaises exclus — y compris ceux qui tombent dans
   une fermeture UPJV : 2 semaines de Noël + 4 semaines entre juillet et août,
   et les fêtes mobiles Lundi de Pâques / Ascension / Pentecôte).
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

/** Jours fériés fixes français (métropole) : [mois, jour, libellé]. */
const FIXED_FRENCH_HOLIDAYS = [
  [1, 1, 'Jour de l’An'],
  [5, 1, 'Fête du Travail'],
  [5, 8, 'Victoire 1945'],
  [7, 14, 'Fête nationale'],
  [8, 15, 'Assomption'],
  [11, 1, 'Toussaint'],
  [11, 11, 'Armistice 1918'],
  [12, 25, 'Noël'],
];

/**
 * Liste complète et triée des jours fériés français d’une année, pour affichage :
 * renvoie [{ iso: 'yyyy-mm-dd', label }]. Les fêtes mobiles (Lundi de Pâques,
 * Ascension, Lundi de Pentecôte) sont recalculées depuis le dimanche de Pâques.
 */
export const frenchHolidayList = (year) => {
  const items = FIXED_FRENCH_HOLIDAYS.map(([m, d, label]) => ({
    iso: `${year}-${pad2(m)}-${pad2(d)}`,
    label,
  }));
  const shift = (date, days, label) => {
    const x = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
    return {
      iso: `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`,
      label,
    };
  };
  const eSun = new Date(year, easterSunday(year).m - 1, easterSunday(year).d);
  items.push(shift(eSun, 1, 'Lundi de Pâques'));
  items.push(shift(eSun, 39, 'Ascension'));
  items.push(shift(eSun, 50, 'Lundi de Pentecôte'));
  return items.sort((a, b) => a.iso.localeCompare(b.iso));
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

/** Partie date (yyyy-mm-dd) d'une valeur ISO éventuellement horodatée. */
const datePartOf = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
};

/** ISO (yyyy-mm-dd) du jour courant (heure locale). */
export const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/**
 * Saison de congés contenant la date `iso` (ou aujourd'hui) : elle court du
 * 1er septembre au 31 août de l'année suivante. Le solde affiché porte toujours
 * sur cette fenêtre, ce qui renouvelle automatiquement les jours chaque
 * 1er septembre (aucun compteur stocké à réinitialiser).
 */
export const congeYearBounds = (iso) => {
  const d = (() => {
    const parsed = parseISO(iso);
    if (parsed) return parsed;
    return new Date();
  })();
  const y = d.getFullYear();
  const startYear = d.getMonth() + 1 >= 9 ? y : y - 1;
  const endYear = startYear + 1;
  return {
    startYear,
    endYear,
    start: `${startYear}-09-01`,
    end: `${endYear}-08-31`,
    label: `1 sept. ${startYear} → 31 août ${endYear}`,
  };
};

/**
 * Jours ouvrés (décomptés du solde) de la période [startISO, endISO] qui
 * tombent à l'intérieur de la saison [periodStart, periodEnd]. Sert à prorater
 * une demande qui chevaucherait le 1er septembre (ex. vacances fin août).
 */
export const businessDaysInPeriod = (startISO, endISO, periodStart, periodEnd) => {
  const s = datePartOf(startISO);
  const e = datePartOf(endISO);
  const ps = datePartOf(periodStart);
  const pe = datePartOf(periodEnd);
  if (!s || !e || !ps || !pe) return 0;
  const lo = s < ps ? ps : s;
  const hi = e > pe ? pe : e;
  if (lo > hi) return 0;
  const n = businessDaysBetween(lo, hi);
  return n == null ? 0 : n;
};
