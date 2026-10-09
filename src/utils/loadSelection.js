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

   ⚠ Deux façons d’appliquer ce qui est coché, et elles ne se ressemblent pas :

     · ♻️ REMPLACER — `filterLoadState` : la page cochée est REMPLACÉE par
       celle du fichier. Une ligne plus récente que le fichier disparaît.
     · 🔀 FUSIONNER — `mergeAdministration` : la BASE OUVERTE fait foi, le
       fichier ne fait qu’AJOUTER ce qu’elle n’a pas encore (rien n’est
       jamais effacé). Voir le bloc « FUSION » plus bas.

   Les comptes (operators) et la configuration de sécurité (authSettings) ne
   sont JAMAIS importés : ce sont des données globales de l’application, pas du
   dataset — ils ne figurent donc pas dans la liste.
   ========================================================================= */

import { ADMIN_COLLECTIONS, ADMIN_PAGES, collectionLabel } from '../administration/adminSchema';
/* L’IDENTITÉ d’une ligne (recettes, personnel, dépenses, OM…) est celle de
   l’assistant d’import : c’est la même clé qui empêche un doublon quand on
   colle une feuille. Une fusion qui l’ignorerait inscrirait deux fois la même
   ligne — donc la fusion s’appuie sur `recordDedupeKey`, pas sur une seconde
   règle qui pourrait diverger. */
import { recordDedupeKey, normalizeKey } from '../administration/importUtils';

/* ── Éléments d’un dataset scientifique (une entrée = une case à cocher) ─── */
const DEF_LIB = 'Définitions & bibliothèque';
const DEF_REP = 'Rapport & étiquettes';
const PUB = 'Publications';
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
  /* Papiers : ils sont FUSIONNÉS (jamais remplacés) au chargement — voir
     confirmLoad dans App.jsx — donc cocher ces éléments ne peut rien effacer. */
  { page: PUB, keys: ['_publications'], label: 'Publications des scientifiques (tableau)', unit: 'publication' },
  { page: PUB, keys: ['_relevantPapers'], label: 'Relevant papers', unit: 'papier' },
  { page: PUB, keys: ['_relevantSubjects'], label: 'Étiquettes des Relevant papers', unit: 'étiquette' },
  { page: PUB, keys: ['_excludedPubs'], label: 'Publications masquées (exclues)', unit: 'publication' },
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

/* ── 🔀 FUSION : AJOUTER au lieu de REMPLACER ─────────────────────────────────
   Le mode « remplacer » (ci-dessus) ÉCRASE la page cochée par celle du fichier :
   c’est ce qu’il faut pour une base vide, et c’est ce qui fait disparaître les
   lignes plus RÉCENTES que le fichier. Le mode « fusionner » fait l’inverse :
   la BASE OUVERTE fait foi — elle est la plus récente par construction, c’est
   celle où l’on travaille — et le fichier ne fait qu’AJOUTER ce qu’elle n’a
   pas encore. Une fusion n’efface donc jamais rien :

     · collection (tableau) → union par clé d’identité : la ligne déjà présente
       garde SA version, la ligne absente est ajoutée à la fin ;
     · objet (`settings`) → clé par clé : la base l’emporte, le fichier ne
       remplit que les clés ABSENTES ;
     · valeur simple → la base l’emporte ; le fichier ne remplit qu’un vide.

   La clé d’identité est EXACTEMENT celle de l’assistant d’import
   (`recordDedupeKey`) : une ligne ramenée par deux sauvegardes différentes
   n’est ajoutée qu’une fois. Deux lignes d’une même page qui ne disent rien
   d’exploitable (aucun champ renseigné) n’ont pas d’identité : elles sont
   ajoutées telles quelles — les garder vaut mieux que de choisir à leur place.
   ────────────────────────────────────────────────────────────────────────── */

/** Identité d’une ligne — '' quand elle n’en a aucune d’exploitable. */
const rowIdentityOf = (kind, rec) => {
  if (rec === null || rec === undefined) return '';
  if (typeof rec !== 'object') return normalizeKey(rec);
  const raw = recordDedupeKey(kind, rec);
  return /[a-z0-9]/.test(raw) ? raw : '';
};

/** Fusion d’UNE valeur d’administration. `added` compte les lignes du fichier
 *  AJOUTÉES, `kept` celles DÉJÀ présentes (elles nourrissent l’aperçu de la
 *  fenêtre d’import et le compte-rendu affiché après l’import). */
export const mergeAdminValue = (kind, baseVal, incomingVal) => {
  if (Array.isArray(incomingVal)) {
    const baseArr = Array.isArray(baseVal) ? baseVal : [];
    const known = new Set();
    baseArr.forEach((r) => { const k = rowIdentityOf(kind, r); if (k) known.add(k); });
    const add = [];
    let kept = 0;
    incomingVal.forEach((r) => {
      const k = rowIdentityOf(kind, r);
      if (k) {
        if (known.has(k)) { kept += 1; return; }
        known.add(k);         // …et un doublon INTERNE au fichier n’en passe pas non plus
      }
      add.push(r);
    });
    return { value: [...baseArr, ...add], added: add.length, kept };
  }
  if (incomingVal && typeof incomingVal === 'object') {
    const baseObj = (baseVal && typeof baseVal === 'object' && !Array.isArray(baseVal)) ? baseVal : {};
    let added = 0;
    let kept = 0;
    Object.keys(incomingVal).forEach((k) => {
      if (Object.prototype.hasOwnProperty.call(baseObj, k)) kept += 1;
      else added += 1;
    });
    /* La base ÉCRIT APRÈS : ses valeurs l’emportent, clé par clé. */
    return { value: { ...incomingVal, ...baseObj }, added, kept };
  }
  if (isPresent(incomingVal)) {
    const baseEmpty = !isPresent(baseVal) || baseVal === ''
      || (typeof baseVal === 'object' && Object.keys(baseVal).length === 0);
    return baseEmpty
      ? { value: incomingVal, added: 1, kept: 0 }
      : { value: baseVal, added: 0, kept: 1 };
  }
  return { value: baseVal, added: 0, kept: 0 };
};

/**
 * FUSION d’une base d’administration. `keys` = les pages que le fichier porte ET
 * que l’utilisateur a cochées (leur clé de collection — `recettes`, `personnel`,
 * `settings`…) ; les autres pages de la base ouverte sont recopiées telles
 * quelles. `baseAdmin` peut être vide (`{}` : aucune base ouverte, ou base
 * neuve) : la fusion se réduit alors à ce que le fichier apporte. Retourne
 * `{ administration, added, kept, addedByKey, keptByKey }` — `added` et `kept`
 * sont des nombres de LIGNES, par page et au total.
 */
export const mergeAdministration = (baseAdmin, incomingAdmin, keys) => {
  const base = (baseAdmin && typeof baseAdmin === 'object') ? baseAdmin : {};
  const inc = (incomingAdmin && typeof incomingAdmin === 'object') ? incomingAdmin : {};
  const wanted = Array.isArray(keys) ? keys : Object.keys(inc);
  const out = { ...base };
  const addedByKey = {};
  const keptByKey = {};
  let added = 0;
  let kept = 0;
  wanted.forEach((k) => {
    if (!isPresent(inc[k])) return;      // la page n’est pas dans le fichier
    if (!isPresent(base[k])) {           // rien en face : la page arrive telle quelle
      const n = sizeOf(inc[k]);
      out[k] = inc[k];
      addedByKey[k] = n;
      keptByKey[k] = 0;
      added += n;
      return;
    }
    const r = mergeAdminValue(k, base[k], inc[k]);
    out[k] = r.value;
    addedByKey[k] = r.added;
    keptByKey[k] = r.kept;
    added += r.added;
    kept += r.kept;
  });
  return { administration: out, added, kept, addedByKey, keptByKey };
};

/**
 * APERÇU de ce qu’une fusion apporterait, page cochée par page cochée — pour
 * que la fenêtre d’import dise « +3 lignes » AVANT de cliquer (une page absente
 * de la base ouverte est annoncée comme entièrement nouvelle).
 */
export const mergePreviewOf = (baseAdmin, incomingAdmin, sections, selectedIds) => {
  const keep = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  const inc = (incomingAdmin && typeof incomingAdmin === 'object') ? incomingAdmin : {};
  const base = (baseAdmin && typeof baseAdmin === 'object') ? baseAdmin : {};
  const out = {};
  (Array.isArray(sections) ? sections : []).forEach((s) => {
    if (!keep.has(s.id)) return;
    let added = 0;
    let kept = 0;
    (s.keys || []).forEach((k) => {
      if (!isPresent(inc[k])) return;
      if (!isPresent(base[k])) { added += sizeOf(inc[k]); return; }
      const r = mergeAdminValue(k, base[k], inc[k]);
      added += r.added;
      kept += r.kept;
    });
    out[s.id] = { added, kept };
  });
  return out;
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
