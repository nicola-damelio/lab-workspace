/* =========================================================================
   src/utils/calculationEntries.js
   LES CALCULS DE SOLUTION D'UN DATASET — qui les a enregistrés, et ce qui
   doit être VISIBLE.

   `calculationEntries` vit dans la charge du dataset :

       { "<nom du composé>": [ { id, tab, label, data, mw, createdAt, operator } ] }

   Il voyage donc déjà avec le dataset (Firestore) et avec sa copie Drive
   (`_workspace/datasets/ds_<id>.json`). Les deux défauts constatés le
   19/09/2026 sur un poste neuf (« les calculs ne sont pas là ») ne venaient
   donc PAS du transport des données :

     1. la page ouvrait le calcul du PREMIER composé de la liste : les calculs
        d'un autre composé existaient, mais l'écran annonçait « aucun calcul
        enregistré » ;
     2. le filtre par scientifique (réservé aux superutilisateurs) comparait
        `operator` au nom du compte connecté : un calcul enregistré SANS nom
        (`operator: 'unknown'`, cas d'une session non identifiée) ou par un
        autre compte était MASQUÉ — sans le dire, et sans moyen de le faire
        réapparaître.

   D'où les règles de ce module, volontairement conservatrices :

     • une identité inconnue ne cache JAMAIS une donnée (sans nom de compte on
       montre tout) ;
     • ce qui est masqué est TOUJOURS compté (`hiddenCount`) pour que l'écran
       puisse l'annoncer au lieu de laisser croire à une absence ;
     • un calcul sans nom reste visible dans TOUS les filtres, puisqu'on ne
       peut l'attribuer à personne ;
     • l'INVENTAIRE (`calcInventory`) dit ce que le dataset contient, composé
       par composé : c'est ce qui rend visible sur un second poste un calcul
       fait sur le premier.

   Fonctions PURES — vérifiées hors navigateur par _calculation_entries_test.mjs.
   ========================================================================= */

/** Auteur d'un calcul enregistré avant l'attribution par compte. */
export const CALC_UNKNOWN_OPERATOR = 'unknown';
/** Filtre « tous les scientifiques » (valeur historique de l'écran). */
export const CALC_FILTER_ALL = 'ALL';
/** Filtre « mes calculs ». */
export const CALC_FILTER_MINE = 'MINE';
/** Filtre « enregistrés sans nom ». */
export const CALC_FILTER_UNKNOWN = 'UNKNOWN';

const text = (v) => (v === undefined || v === null ? '' : String(v).trim());
const isEntry = (e) => !!e && typeof e === 'object' && !Array.isArray(e);
const entriesOf = (value) => (Array.isArray(value) ? value.filter(isEntry) : []);
const byCompoundAsc = (a, b) => (a.compound < b.compound ? -1 : a.compound > b.compound ? 1 : 0);

/** Auteur déclaré d'une entrée ('' quand il n'y en a pas). */
export const calcEntryOperator = (entry) => text(isEntry(entry) ? entry.operator : '');

/** L'entrée n'est attribuable à personne : elle doit rester visible partout. */
export const isCalcUnattributed = (entry) => {
  const op = calcEntryOperator(entry);
  return !op || op === CALC_UNKNOWN_OPERATOR;
};

/** Date d'enregistrement (0 quand elle manque : l'entrée passe en fin de liste). */
export const calcEntryAt = (entry) => {
  const at = Number(isEntry(entry) ? entry.createdAt : 0);
  return Number.isFinite(at) && at > 0 ? at : 0;
};

/** Toutes les entrées d'un dataset, avec le composé qui les porte. */
export const allCalcEntries = (calculationEntries) => {
  const src = calculationEntries && typeof calculationEntries === 'object' ? calculationEntries : {};
  const out = [];
  Object.keys(src).forEach((compound) => {
    entriesOf(src[compound]).forEach((entry) => out.push({ compound, entry }));
  });
  return out;
};

/** Combien de calculs ce dataset contient (tous composés confondus). */
export const countCalcEntries = (calculationEntries) => allCalcEntries(calculationEntries).length;

/** Les scientifiques d'une liste d'entrées (les calculs sans nom en sont exclus). */
export const calcScientistsOf = (entries) => {
  const out = new Set();
  entriesOf(entries).forEach((e) => {
    const op = calcEntryOperator(e);
    if (op && op !== CALC_UNKNOWN_OPERATOR) out.add(op);
  });
  return Array.from(out).sort();
};


/**
 * L'INVENTAIRE du dataset : quels composés portent des calculs, combien, par
 * qui, et quand le dernier. Trié du plus récent au plus ancien (le calcul qui
 * vient d'arriver d'un autre poste est donc en tête).
 * @returns {Array<{compound:string,total:number,scientists:string[],unattributed:number,lastAt:number,entries:object[]}>}
 */
export const calcInventory = (calculationEntries) => {
  const src = calculationEntries && typeof calculationEntries === 'object' ? calculationEntries : {};
  const rows = [];
  Object.keys(src).forEach((compound) => {
    const entries = entriesOf(src[compound]);
    if (!entries.length) return;
    rows.push({
      compound,
      total: entries.length,
      scientists: calcScientistsOf(entries),
      unattributed: entries.filter(isCalcUnattributed).length,
      lastAt: entries.reduce((max, e) => Math.max(max, calcEntryAt(e)), 0),
      entries
    });
  });
  return rows.sort((a, b) => (b.lastAt - a.lastAt) || byCompoundAsc(a, b));
};

/** Le composé du calcul le plus récent (celui qu'une page doit ouvrir d'abord). */
export const lastCalcCompound = (calculationEntries) => {
  const inventory = calcInventory(calculationEntries);
  return inventory.length ? inventory[0].compound : '';
};

/** Une valeur de filtre → 'ALL' | 'MINE' | 'UNKNOWN' | nom du scientifique. */
export const normalizeCalcFilter = (filter) => {
  const raw = text(filter);
  if (!raw) return CALC_FILTER_ALL;
  const up = raw.toUpperCase();
  if (up === CALC_FILTER_ALL || up === CALC_FILTER_MINE || up === CALC_FILTER_UNKNOWN) return up;
  return raw;
};

/**
 * Le filtre d'ouverture : un superutilisateur voit tout ; un scientifique
 * connecté ouvre sur ses calculs ; SANS nom de compte on montre tout — une
 * identité inconnue ne cache jamais une donnée.
 */
export const defaultCalcFilter = ({ isSuperuser = false, myName = '' } = {}) => {
  if (isSuperuser) return CALC_FILTER_ALL;
  return text(myName) ? CALC_FILTER_MINE : CALC_FILTER_ALL;
};

const matchesFilter = (entry, filter, myName) => {
  if (isCalcUnattributed(entry)) return true; // jamais attribuable → toujours visible
  if (filter === CALC_FILTER_ALL) return true;
  if (filter === CALC_FILTER_UNKNOWN) return false;
  // « mes calculs » sans nom de compte : on ne sait pas qui est « moi », donc on
  // ne cache rien (sinon les calculs sembleraient absents sur ce poste).
  if (filter === CALC_FILTER_MINE) return !text(myName) || calcEntryOperator(entry) === text(myName);
  return calcEntryOperator(entry) === filter;
};

/**
 * Découper les calculs d'un composé en visibles / masqués — l'écran doit
 * pouvoir AFFICHER le nombre de masqués (`hiddenCount`) au lieu de laisser
 * croire qu'il n'y a rien.
 * @returns {{visible:object[],hidden:object[],hiddenCount:number,total:number,scientists:string[],filter:string}}
 */
export const selectCalcEntries = (entries, { filter = CALC_FILTER_ALL, myName = '' } = {}) => {
  const list = entriesOf(entries);
  const key = normalizeCalcFilter(filter);
  const visible = [];
  const hidden = [];
  list.forEach((entry) => (matchesFilter(entry, key, myName) ? visible : hidden).push(entry));
  visible.sort((a, b) => calcEntryAt(b) - calcEntryAt(a)); // le plus récent en tête
  return {
    visible,
    hidden,
    hiddenCount: hidden.length,
    total: list.length,
    scientists: calcScientistsOf(list),
    filter: key
  };
};

/** Le texte des calculs masqués par le filtre (« 2 saved calculations hidden… »). */
export const describeHiddenCalc = (hiddenCount, scientists = []) => {
  const n = Number(hiddenCount) || 0;
  if (n <= 0) return '';
  const who = (Array.isArray(scientists) ? scientists : []).filter(Boolean);
  const list = who.length ? ` (${who.slice(0, 3).join(', ')}${who.length > 3 ? '…' : ''})` : '';
  return `${n} saved calculation${n > 1 ? 's' : ''} hidden by this filter${list}`;
};
