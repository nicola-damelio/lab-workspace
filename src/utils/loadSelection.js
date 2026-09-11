/* =========================================================================
   src/utils/loadSelection.js
   Sélection des éléments à importer depuis un fichier HTML (« Load HTML »).

   Un fichier de sauvegarde contient SOIT un dataset scientifique (expériences,
   projets, définitions, stockage, rapport, bibliothèque Figures & Slides…),
   SOIT une base d’administration (une page = un élément : Personnel, OM prévus,
   Achats prévus, Approbation devis & BC, Recettes, Dépenses, Congés…).

   Ce module décrit ces éléments — « quel élément de quelle page » — pour que la
   fenêtre d’import puisse proposer une case à cocher par élément, plus
   « tout depuis cette page » et « tout importer ». `filterLoadState` ne
   conserve ensuite QUE les éléments cochés : les autres restent tels quels dans
   le dataset ouvert (import partiel sans rien écraser).

   Les comptes (operators) et la configuration de sécurité (authSettings) ne
   sont JAMAIS importés : ce sont des données globales de l’application, pas du
   dataset — ils ne figurent donc pas dans la liste.
   ========================================================================= */

import { ADMIN_COLLECTIONS, ADMIN_PAGES, collectionLabel } from '../administration/adminSchema';

/* ── Éléments d’un dataset scientifique (une entrée = une case à cocher) ─── */
const DEF_LIB = 'Définitions & bibliothèque';
const DEF_REP = 'Rapport & étiquettes';
const DATA_ELEMENTS = [
  { page: 'Expériences / Tests', keys: ['tests', 'plates'], label: 'Expériences (tests, plaques, cahier de laboratoire)', unit: 'expérience' },
  { page: 'Projets', keys: ['projects'], label: 'Projets (autorisations, publications, bibliothèques)', unit: 'projet' },
  { page: DEF_LIB, keys: ['molecules'], label: 'Molécules', unit: 'molécule' },
  { page: DEF_LIB, keys: ['compoundMeta'], label: 'Fiches composés', unit: 'fiche' },
  { page: DEF_LIB, keys: ['calculationEntries'], label: 'Calculs de solution / séquence', unit: 'calcul' },
  { page: DEF_LIB, keys: ['customCmpds'], label: 'Composés personnalisés', unit: 'entrée' },
  { page: DEF_LIB, keys: ['solvents'], label: 'Solvants', unit: 'solvant' },
  { page: DEF_LIB, keys: ['buffers'], label: 'Tampons', unit: 'tampon' },
  { page: DEF_LIB, keys: ['additives'], label: 'Additifs', unit: 'additif' },
  { page: DEF_LIB, keys: ['customFields'], label: 'Champs personnalisés', unit: 'champ' },
  { page: DEF_LIB, keys: ['cellLineMeta'], label: 'Fiches lignées cellulaires', unit: 'fiche' },
  { page: DEF_LIB, keys: ['plasmidMeta'], label: 'Fiches plasmides', unit: 'fiche' },
  { page: DEF_LIB, keys: ['nmrInstruments'], label: 'Instruments RMN', unit: 'instrument' },
  { page: DEF_LIB, keys: ['nmrProbes'], label: 'Sondes RMN', unit: 'sonde' },
  { page: DEF_LIB, keys: ['nmrExperiments'], label: 'Expériences RMN', unit: 'expérience' },
  { page: 'Stockage', keys: ['storages'], label: 'Emplacements de stockage', unit: 'emplacement' },
  { page: 'Stockage', keys: ['customCellLines'], label: 'Lignées cellulaires (stockage)', unit: 'ligne' },
  { page: 'Stockage', keys: ['customConc'], label: 'Concentrations personnalisées', unit: 'valeur' },
  { page: DEF_REP, keys: ['datasetTitle'], label: 'Titre du dataset', unit: '' },
  { page: DEF_REP, keys: ['datasetSubtitle'], label: 'Sous-titre du dataset', unit: '' },
  { page: DEF_REP, keys: ['testCategories'], label: 'Catégories de tests', unit: 'catégorie' },
  { page: DEF_REP, keys: ['protocolCategories'], label: 'Catégories de protocoles', unit: 'catégorie' },
  { page: DEF_REP, keys: ['datasetProtocols'], label: 'Protocoles du dataset', unit: 'protocole' },
  { page: DEF_REP, keys: ['cmpColors'], label: 'Couleurs de comparaison', unit: 'couleur' },
  { page: DEF_REP, keys: ['mandatoryFields'], label: 'Champs obligatoires', unit: 'champ' },
  { page: DEF_REP, keys: ['mandatoryRules'], label: 'Règles de champs obligatoires', unit: 'règle' },
  { page: DEF_REP, keys: ['mandatoryBehavior'], label: 'Comportement des champs obligatoires', unit: 'règle' },
  { page: 'Figures & Slides', keys: ['_figuresLibrary'], label: 'Bibliothèque d’images (partagée)', unit: 'image' },
  { page: 'Figures & Slides', keys: ['_figuresLibraryProjects'], label: 'Bibliothèque d’images (par projet)', unit: 'projet' },
];

/* ── Éléments d’une base d’administration : UNE PAGE par élément ───────────
   Les libellés viennent du registre des pages du module Administration, pour
   que la fenêtre d’import parle exactement comme la navigation latérale. */
const ADMIN_PAGE_RANK = (() => {
  const map = {};
  ADMIN_PAGES.forEach((page, i) => { map[page.id] = i; });
  return map;
})();
const adminRankOf = (key) => {
  if (key === 'settings') return ADMIN_PAGES.length; // Setup : en dernier
  const kind = ADMIN_COLLECTIONS[key];
  const page = kind ? ADMIN_PAGES.find((p) => p.kind === kind) : null;
  return page ? (ADMIN_PAGE_RANK[page.id] || 0) : ADMIN_PAGES.length + 1;
};

const isPresent = (v) => v !== undefined && v !== null;

/** Nombre d’éléments d’une valeur (lignes d’une collection, options, 1 si
 *  simple valeur) — affiché à côté de la case à cocher. */
const sizeOf = (v) => {
  if (v === undefined || v === null) return 0;
  if (Array.isArray(v)) return v.length;
  if (typeof v === 'object') return Object.keys(v).length;
  return 1;
};

/** Éléments importables d’une base d’administration, dans l’ordre des pages. */
export const adminElementsOf = (administration) => {
  const src = administration && typeof administration === 'object' ? administration : {};
  return Object.keys(src)
    .sort((a, b) => (adminRankOf(a) - adminRankOf(b)) || a.localeCompare(b))
    .map((key) => (key === 'settings'
      ? { page: '', keys: [key], label: 'Setup — options des listes déroulantes & accès aux pages', unit: 'option' }
      : { page: '', keys: [key], label: ADMIN_COLLECTIONS[key] ? collectionLabel(ADMIN_COLLECTIONS[key]) : key, unit: 'ligne' }));
};

/**
 * Sections importables d’une sauvegarde. `isAdmin` distingue la base
 * d’administration (les éléments vivent DANS `state.administration`) du
 * dataset scientifique (les éléments sont les clés de premier niveau).
 * Seuls les éléments réellement PRÉSENTS dans le fichier sont retournés :
 * on ne propose jamais de cocher un élément vide.
 */
export const loadSectionsOf = (state, isAdmin) => {
  const s = state && typeof state === 'object' ? state : {};
  const src = isAdmin
    ? (s.administration && typeof s.administration === 'object' ? s.administration : {})
    : s;
  const defs = isAdmin ? adminElementsOf(src) : DATA_ELEMENTS;
  const prefix = isAdmin ? 'admin:' : 'data:';
  const out = [];
  defs.forEach((d) => {
    const present = (d.keys || []).filter((k) => isPresent(src[k]));
    if (!present.length) return;
    out.push({
      id: prefix + present[0],
      page: d.page || '',
      label: d.label,
      unit: d.unit || '',
      keys: present,
      count: sizeOf(src[present[0]]),
    });
  });
  return out;
};

/** Sélection par défaut : TOUS les éléments présents (comportement historique). */
export const defaultSelection = (sections) => (Array.isArray(sections) ? sections : []).map((s) => s.id);

/** Groupes (« pages ») d’une liste de sections, dans l’ordre, page vide comprise. */
export const sectionGroupsOf = (sections) => {
  const out = [];
  (Array.isArray(sections) ? sections : []).forEach((s) => {
    const page = s.page || '';
    let g = out.find((x) => x.page === page);
    if (!g) { g = { page, items: [] }; out.push(g); }
    g.items.push(s);
  });
  return out;
};

/**
 * Snapshot réduit aux seuls éléments cochés. Les métadonnées du dataset (`id`)
 * sont toujours conservées : elles servent à savoir dans quel dataset écrire en
 * mode « remplacer ». Retourne aussi `administration` (base prête à fusionner)
 * et `keptIds` (éléments réellement appliqués).
 */
export const filterLoadState = (state, sections, selectedIds) => {
  const keep = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  const all = Array.isArray(sections) ? sections : [];
  const picked = all.filter((s) => keep.has(s.id));
  const src = state && typeof state === 'object' ? state : {};
  const isAdmin = all.some((s) => String(s.id).indexOf('admin:') === 0);

  if (isAdmin) {
    const adminSrc = src.administration && typeof src.administration === 'object' ? src.administration : {};
    const administration = {};
    picked.forEach((s) => s.keys.forEach((k) => { if (isPresent(adminSrc[k])) administration[k] = adminSrc[k]; }));
    const out = { administration };
    /* Métadonnées conservées (jamais des pages) : l’identifiant du dataset et
       son titre/sous-titre servent à nommer la base de destination. */
    ['id', 'title', 'datasetTitle', 'subtitle', 'datasetSubtitle'].forEach((k) => {
      if (isPresent(src[k])) out[k] = src[k];
    });
    return { state: out, administration, keptIds: picked.map((s) => s.id) };
  }

  const out = {};
  if (isPresent(src.id)) out.id = src.id;
  picked.forEach((s) => s.keys.forEach((k) => { if (isPresent(src[k])) out[k] = src[k]; }));
  return { state: out, administration: null, keptIds: picked.map((s) => s.id) };
};

/** L’élément « expériences » est-il dans la sélection ? (import des tests) */
export const selectionHasTests = (selectedIds) =>
  (Array.isArray(selectedIds) ? selectedIds : []).indexOf('data:tests') !== -1;

/** L’import couvre-t-il TOUS les éléments proposés ? (→ remplacement complet) */
export const selectionIsComplete = (sections, selectedIds) => {
  const all = Array.isArray(sections) ? sections : [];
  const keep = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  return all.length > 0 && all.every((s) => keep.has(s.id));
};

/** Texte « 12 lignes » / « 3 images » affiché à côté d’une case à cocher. */
export const describeCount = (section) => {
  const n = section && section.count ? section.count : 0;
  const unit = String((section && section.unit) || '').trim();
  if (!unit) return n ? `${n} valeur${n > 1 ? 's' : ''}` : 'vide';
  return `${n} ${unit}${n > 1 ? 's' : ''}`;
};
