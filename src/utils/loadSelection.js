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

   ⚠ Et, DANS une page cochée, la sélection descend jusqu’à la LIGNE : cocher
   « Dépenses » ne veut pas dire accepter ses 412 lignes — `rowChoicesOf` décrit
   chaque ligne du fichier (son libellé, si la base la connaît déjà) et
   `pickAdminRows` ne garde que celles qui sont cochées. En fusion, le défaut est
   « seulement ce que la base n’a pas encore » : c’est ce qui empêche d’empiler
   des doublons à chaque chargement. Voir le bloc « LIGNE À LIGNE » plus bas.

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
/* L'identité d'un ESSAI (« l'id, sinon le nom ») est celle du verrou des
   expériences : la même règle, importée — jamais recopiée, sinon les deux
   divergeraient (voir utils/experimentTombstones.js). */
import { experimentKey } from './experimentTombstones';

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

/** Identifiant TECHNIQUE d’une ligne (`id`), '' s’il n’y en a pas. */
const rowIdOf = (rec) => {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return '';
  return String(rec.id === undefined || rec.id === null ? '' : rec.id).trim();
};

/** Identifiant libre pour une ligne qui arrive avec un `id` DÉJÀ pris : `r1~2`,
 *  `r1~3`… (déterministe, donc la même fusion rejouée donne le même résultat). */
const freshIdFor = (id, used) => {
  const stem = `${id}~`;
  let n = 2;
  while (used.has(`${stem}${n}`)) n += 1;
  return `${stem}${n}`;
};

/** Fusion d’UNE valeur d’administration. `added` compte les lignes du fichier
 *  AJOUTÉES, `kept` celles DÉJÀ présentes (elles nourrissent l’aperçu de la
 *  fenêtre d’import et le compte-rendu affiché après l’import), `renamed` celles
 *  dont l’identifiant technique a dû être renouvelé (voir plus bas).
 *
 *  Pourquoi renouveler un identifiant ? Une ligne du fichier ABSENTE de la base
 *  mais qui PORTE le même `id` qu’une ligne de la base est une AUTRE ligne (c’est
 *  ainsi que la fusion l’a reconnue) : deux lignes qui partagent un `id` sont
 *  indissociables — `remove(kind, id)` les supprime TOUTES LES DEUX. C’est très
 *  exactement le défaut constaté (« je supprime un doublon, les deux
 *  disparaissent ») : la ligne ajoutée reçoit donc un identifiant libre. */
export const mergeAdminValue = (kind, baseVal, incomingVal) => {
  if (Array.isArray(incomingVal)) {
    const baseArr = Array.isArray(baseVal) ? baseVal : [];
    const known = new Set();
    const usedIds = new Set();
    baseArr.forEach((r) => {
      const k = rowIdentityOf(kind, r);
      if (k) known.add(k);
      const id = rowIdOf(r);
      if (id) usedIds.add(id);
    });
    const add = [];
    let kept = 0;
    let renamed = 0;
    incomingVal.forEach((r) => {
      const k = rowIdentityOf(kind, r);
      if (k) {
        if (known.has(k)) { kept += 1; return; }
        known.add(k);         // …et un doublon INTERNE au fichier n’en passe pas non plus
      }
      const id = rowIdOf(r);
      if (id && usedIds.has(id)) {
        const fresh = freshIdFor(id, usedIds);
        usedIds.add(fresh);
        renamed += 1;
        add.push({ ...r, id: fresh });
        return;
      }
      if (id) usedIds.add(id);
      add.push(r);
    });
    return { value: [...baseArr, ...add], added: add.length, kept, renamed };
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
    return { value: { ...incomingVal, ...baseObj }, added, kept, renamed: 0 };
  }
  if (isPresent(incomingVal)) {
    const baseEmpty = !isPresent(baseVal) || baseVal === ''
      || (typeof baseVal === 'object' && Object.keys(baseVal).length === 0);
    return baseEmpty
      ? { value: incomingVal, added: 1, kept: 0, renamed: 0 }
      : { value: baseVal, added: 0, kept: 1, renamed: 0 };
  }
  return { value: baseVal, added: 0, kept: 0, renamed: 0 };
};

/**
 * FUSION d’une base d’administration. `keys` = les pages que le fichier porte ET
 * que l’utilisateur a cochées (leur clé de collection — `recettes`, `personnel`,
 * `settings`…) ; les autres pages de la base ouverte sont recopiées telles
 * quelles. `baseAdmin` peut être vide (`{}` : aucune base ouverte, ou base
 * neuve) : la fusion se réduit alors à ce que le fichier apporte. Retourne
 * `{ administration, added, kept, renamed, addedByKey, keptByKey }` — `added`,
 * `kept` et `renamed` sont des nombres de LIGNES, par page et au total.
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
  let renamed = 0;
  wanted.forEach((k) => {
    if (!isPresent(inc[k])) return;      // la page n’est pas dans le fichier
    /* MÊME RÈGLE que lorsque les deux côtés portent la page : une page qui
       n’existe QUE dans le fichier arrive avec ses lignes — sans les doublons
       internes du fichier, et sans jamais reprendre un `id` déjà pris dans la
       base (voir mergeAdminValue). Sans cela, charger un fichier déjà pollué
       ramenait ses doublons, et deux lignes pouvaient partager un `id`. */
    const r = mergeAdminValue(k, base[k], inc[k]);
    out[k] = r.value;
    addedByKey[k] = r.added;
    keptByKey[k] = r.kept;
    added += r.added;
    kept += r.kept;
    renamed += r.renamed || 0;
  });
  return { administration: out, added, kept, renamed, addedByKey, keptByKey };
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
      /* La page absente de la base est annoncée comme ENTIÈREMENT nouvelle,
         mais dédoublonnée : l’aperçu compte ce que la fusion ajouterait VRAI-
         MENT (mêmes règles que mergeAdministration, en lecture seule). */
      const r = mergeAdminValue(k, base[k], inc[k]);
      added += r.added;
      kept += r.kept;
    });
    out[s.id] = { added, kept };
  });
  return out;
};

/* ──────────────────────────────────────────────────────────────────────────
   LIGNE À LIGNE — choisir DANS une page, pas seulement la page entière
   ──────────────────────────────────────────────────────────────────────────
   Une page peut porter des centaines de lignes : « la page Dépenses » n’est pas
   un choix, et cocher la page pour n’en récupérer que trois obligeait à tout
   prendre — c’est comme ça que les doublons se fabriquent. `rowChoicesOf`
   DÉCRIT donc chaque ligne du fichier (libellé lisible, déjà présente dans la
   base ou non) et `pickAdminRows` ne garde que celles qui sont cochées.

   · en FUSION, le défaut est « ce que la base n’a pas encore » : les lignes
     déjà reconnues sont VERROUILLÉES (`locked` : cochées, non décochables —
     la base fait foi, les décoher ne changerait rien) et les lignes nouvelles
     arrivent cochées — un chargement ne ré-ajoute donc rien, même si
     l’utilisateur ne touche à rien ;
   · en REMPLACEMENT, tout est coché et décochable (le geste demandé est de
     reprendre la page telle quelle) ; décocher une ligne est alors un choix
     explicite.

   La clé d’une ligne est son identité (`recordDedupeKey`, préfixée par la
   collection) : deux lignes que la fusion considère comme LA MÊME se cochent et
   se décochent ensemble — et c’est dit (`duplicateOf`). Une ligne sans identité
   exploitable (aucun champ renseigné) est repérée par sa POSITION (`#3`) : elle
   compte alors pour elle-même.
   ────────────────────────────────────────────────────────────────────────── */

/** Colonnes qui NOMMENT une ligne, par collection : la première renseignée sert
 *  de titre, les suivantes de contexte (« 1 250 · Payé »). Volontairement
 *  courtes : une ligne d’aperçu, pas une fiche. */
const ROW_FIELDS = {
  recettes: { title: ['ligne', 'description'], sub: ['type', 'montant', 'financeur'] },
  librerie: {
    title: ['fournisseur', 'nomFournisseur', 'fournisseurNom', 'nom', 'name'],
    sub: ['contact', 'email', 'telephone', 'referenceSifac'],
  },
  personnel: { title: ['nom', 'description'], sub: ['prenom', 'fonction', 'dateDebutStage', 'dateEmbauche'] },
  depenses: { title: ['description'], sub: ['fournisseur', 'montant', 'statut', 'dateDemande'] },
  om: { title: ['description'], sub: ['demandeur', 'dateMission', 'coutTotal', 'numOM'] },
  reimbursements: { title: ['description'], sub: ['demandeur', 'beneficiaire', 'dateMission', 'coutTotal'] },
  conges: { title: ['demandeur'], sub: ['dateDebut', 'dateFin', 'type', 'statut'] },
  desiderate: { title: ['description'], sub: ['demandeur', 'montant', 'statut'] },
  devisBc: { title: ['description'], sub: ['kind', 'numDevis', 'numBC', 'montant'] },
  questioni: { title: ['description'], sub: ['demandeur', 'statut', 'date'] },
  sicurezza: { title: ['description'], sub: ['demandeur', 'lieu', 'date'] },
};

/** Première valeur LISIBLE d’une liste de champs (texte ou nombre — jamais un
 *  objet, jamais un pavé : au-delà de 120 caractères c’est un commentaire, pas
 *  un libellé). Rend '' s’il n’y a rien. */
const firstText = (rec, keys) => {
  if (!rec || typeof rec !== 'object') return '';
  for (const k of keys) {
    const v = rec[k];
    if (v === undefined || v === null || typeof v === 'object') continue;
    const s = String(v).trim();
    if (s && s.length <= 120) return s;
  }
  return '';
};

/** Libellé d’une ligne : `{ title, sub }` — JAMAIS vide. Les champs attendus
 *  d’abord, puis n’importe quel autre champ de la fiche (mieux vaut montrer
 *  « 12/03/2025 » que rien), et en dernier recours la position de la ligne. */
const rowLabelOf = (kind, rec, index) => {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) {
    const bare = rec === undefined || rec === null ? '' : String(rec).trim();
    return { title: bare || `ligne ${index + 1}`, sub: '' };
  }
  const spec = ROW_FIELDS[kind] || {};
  const others = Object.keys(rec).filter((k) => k !== 'id');
  const title = firstText(rec, (spec.title || []).concat(others)) || `ligne ${index + 1}`;
  const sub = [];
  (spec.sub || []).forEach((k) => {
    const v = firstText(rec, [k]);
    if (v && v.toLowerCase() !== title.toLowerCase() && sub.indexOf(v) === -1) sub.push(v);
  });
  return { title, sub: sub.slice(0, 3).join(' · ') };
};

/** Clé d’une ligne DANS sa collection : son identité, sinon sa position (`#3`).
 *  Toujours préfixée par la collection : deux pages peuvent avoir une ligne
 *  `#0` sans que cocher l’une touche l’autre. */
export const rowKeyOf = (kind, rec, index) =>
  `${kind}::${rowIdentityOf(kind, rec) || `#${Number(index) || 0}`}`;

/**
 * CHAQUE LIGNE d’une page, telle que la fenêtre d’import la montre. Chaque
 * entrée porte `{ key, index, title, sub, identity, inBase, duplicateOf,
 * noIdentity, locked, picked }` :
 *  · `inBase` — la ligne est DÉJÀ dans la base ouverte (même identité) ;
 *  · `locked` — en FUSION, une telle ligne n’est pas un choix : la fusion la
 *    reconnaîtra de toute façon (la base fait foi). Elle est donc cochée et
 *    NE PEUT PAS être décochée — la décoher ne changerait rien, et le
 *    compte-rendu doit pouvoir dire « 2 lignes reconnues » ;
 *  · `duplicateOf` — index d’une ligne DÉJÀ listée portant la même identité
 *    (elles seront fusionnées de toute façon : autant le dire avant) ;
 *  · `picked` — l’état par défaut des lignes que l’utilisateur DÉCIDE (voir
 *    l’en-tête du bloc), renversable ligne à ligne.
 */
export const rowChoicesOf = (kind, incomingVal, baseVal, mode) => {
  if (!Array.isArray(incomingVal)) return [];
  const merging = mode !== 'replace';
  const known = new Set();
  (Array.isArray(baseVal) ? baseVal : []).forEach((r) => {
    const id = rowIdentityOf(kind, r);
    if (id) known.add(id);
  });
  const firstSeen = new Map();
  return incomingVal.map((r, index) => {
    const identity = rowIdentityOf(kind, r);
    const inBase = !!identity && known.has(identity);
    const duplicateOf = identity && firstSeen.has(identity) ? firstSeen.get(identity) : -1;
    if (identity && !firstSeen.has(identity)) firstSeen.set(identity, index);
    const label = rowLabelOf(kind, r, index);
    return {
      key: rowKeyOf(kind, r, index),
      index,
      title: label.title,
      sub: label.sub,
      identity,
      inBase,
      duplicateOf,
      noIdentity: !identity,
      locked: merging && inBase,
      picked: merging ? !inBase : true,
    };
  });
};

/** Choix PAR DÉFAUT de la fenêtre : une liste de clés par page (voir
 *  `rowChoicesOf`). C’est l’état initial de la sélection ligne à ligne, et ce
 *  que « Tout » remet pour les pages concernées. Les lignes VERROUILLÉES
 *  (`locked`) en font partie : elles traversent la sélection pour que la fusion
 *  les reconnaisse et le dise — sans elles, elle annoncerait « 0 ligne ». */
export const rowPicksOf = (administration, sections, baseAdmin, mode) => {
  const src = administration && typeof administration === 'object' ? administration : {};
  const base = baseAdmin && typeof baseAdmin === 'object' ? baseAdmin : {};
  const out = {};
  (Array.isArray(sections) ? sections : []).forEach((s) => {
    const keys = [];
    (s.keys || []).forEach((k) => {
      if (!Array.isArray(src[k])) return;
      rowChoicesOf(k, src[k], base[k], mode)
        .forEach((c) => { if (c.picked || c.locked) keys.push(c.key); });
    });
    out[s.id] = keys;
  });
  return out;
};

/**
 * APPLICATION du choix ligne à ligne : une copie de `administration` où chaque
 * collection d’une page dont les lignes ont été choisies (`picks[page]` = liste
 * de clés) ne garde que ces lignes-là. Une page ABSENTE de `picks` n’est pas
 * touchée : sa page entière suit le sort de sa case à cocher — c’est ce qui
 * laisse « ♻️ Import everything » intact.
 */
export const pickAdminRows = (administration, sections, picks) => {
  const src = administration && typeof administration === 'object' ? administration : {};
  const out = { ...src };
  if (!picks || typeof picks !== 'object') return out;
  (Array.isArray(sections) ? sections : []).forEach((s) => {
    const chosen = picks[s.id];
    if (!Array.isArray(chosen)) return;
    const keep = new Set(chosen);
    (s.keys || []).forEach((k) => {
      if (!Array.isArray(src[k])) return;
      out[k] = src[k].filter((r, i) => keep.has(rowKeyOf(k, r, i)));
    });
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

/* ---------------------------------------------------------------------------
 * 🔎 LIGNES D'UN DATASET SCIENTIFIQUE — UNE LIGNE = UNE EXPÉRIENCE
 *
 * Le rapport : « nel dataset scientifico il recupero da backup deve essere
 * chirurgico come per quello amministrativo » — et, en amministration, on
 * choisit RIGA PER RIGA. Un dataset scientifique n'avait que des cases par
 * PAGE : pour ramener UNE expérience perdue d'une sauvegarde, il fallait
 * reprendre la page entière ; et, en AJOUT, chaque copie recevait un id NEUF —
 * donc ses liens avec son projet (`project.experiments[].testId`) et son dossier
 * Drive étaient perdus, et les doublons restaient à supprimer à la main.
 *
 * `experimentRowChoices` décrit ces lignes : une par EXPÉRIENCE — c'est-à-dire
 * par NOM, exactement comme les pages du dataset groupent les conditions d'un
 * même essai (`experimentsGrouped`) — et `pickExperimentRows` ne garde que les
 * essais cochés, ID D'ORIGINE COMPRIS (`inBase` dit ce que le dataset ouvert
 * porte DÉJÀ, par id ou par nom, pour que la fenêtre prévienne au lieu de
 * laisser empiler des jumeaux).
 * ------------------------------------------------------------------------ */

/** L'id de la page « Expériences / Tests » dans la fenêtre d'import. */
export const TESTS_SECTION_ID = 'data:tests';

const testTitleOf = (t, index) => String((t && (t.name || t.instanceName)) || '').trim() || `Test ${index + 1}`;

/** LE REGROUPEMENT D'UNE EXPÉRIENCE : par NOM d'abord — c'est la règle des pages
 *  du dataset (`experimentsGrouped`) et celle du geste 🗑, qui supprime TOUTES
 *  les conditions d'un même essai. Deux conditions d'une même expérience portent
 *  donc UNE ligne, alors qu'elles ont deux id : grouper par id couperait
 *  l'expérience en morceaux, et la restaurer à moitié. Le nom fait défaut (entrée
 *  écrite par une version ancienne) → l'identité du verrou (l'id), et faute de
 *  tout, la position (voir `#row:` ci-dessous). */
export const testGroupKey = (t) => {
  const name = String((t && (t.name || t.instanceName)) || '').trim();
  return name ? `name:${name}` : experimentKey(t);
};

/** Ce que la fenêtre affiche sous le titre d'une ligne : les conditions de
 *  l'essai, ses projets, son auteur et sa date — ce qui permet de RECONNAÎTRE
 *  l'expérience qu'on vient restaurer. */
const testSubOf = (items) => {
  const list = Array.isArray(items) ? items : [];
  const first = list[0] || {};
  const projects = [...new Set(list.flatMap((t) => (Array.isArray(t && t.projectNames) ? t.projectNames : [])))]
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  return [
    list.length > 1 ? `${list.length} conditions` : '',
    projects.length ? projects.join(' / ') : 'no project',
    String(first.operator || '').trim(),
    String(first.date || '').trim()
  ].filter(Boolean).join(' · ');
};

/** Grouper une liste d'essais par IDENTITÉ (id sinon nom) : une expérience =
 *  un essai AVEC ses conditions, comme partout ailleurs dans le programme. Une
 *  entrée sans identité (ni id ni nom) fait une ligne à elle : elle est
 *  reconnaissable à sa POSITION, pas à son contenu. */
const groupTests = (tests) => {
  const groups = [];
  const byKey = new Map();
  (Array.isArray(tests) ? tests : []).filter(Boolean).forEach((t) => {
    const key = testGroupKey(t);
    if (!key) { groups.push({ key: '', items: [t] }); return; }
    let g = byKey.get(key);
    if (!g) { g = { key, items: [] }; byKey.set(key, g); groups.push(g); }
    g.items.push(t);
  });
  return groups;
};

/** Les lignes de la page « Expériences / Tests » d'un FICHIER : une par essai,
 *  dans l'ordre du fichier. Même forme que `rowChoicesOf` (l'écran d'import n'a
 *  donc rien de spécial à savoir) : `key`, `title`, `sub`, `inBase`, `locked`,
 *  `picked`, `noIdentity`, `duplicateOf`. */
export const experimentRowChoices = (incomingTests, baseTests, merging = false) => {
  const baseKeys = new Set(
    (Array.isArray(baseTests) ? baseTests : []).map(testGroupKey).filter(Boolean)
  );
  const groups = groupTests(incomingTests);
  const firstSeen = new Map();
  return groups.map((g, index) => {
    const inBase = !!g.key && baseKeys.has(g.key);
    const duplicateOf = g.key && firstSeen.has(g.key) ? firstSeen.get(g.key) : -1;
    if (g.key && !firstSeen.has(g.key)) firstSeen.set(g.key, index);
    return {
      key: g.key || `#row:${index}`,
      index,
      title: testTitleOf(g.items[0], index),
      sub: testSubOf(g.items),
      identity: g.key,
      inBase,
      duplicateOf,
      noIdentity: !g.key,
      locked: !!merging && inBase,
      picked: merging ? !inBase : true
    };
  });
};

/** APPLICATION du choix ligne à ligne : ne garde que les essais dont la ligne
 *  est cochée. Les essais d'une ligne cochée partent ENTIERS (toutes leurs
 *  conditions) et avec leur ID D'ORIGINE — c'est ce qui fait revenir le lien du
 *  projet et le dossier du Drive au lieu d'en créer un jumeau anonyme. */
export const pickExperimentRows = (tests, picks) => {
  const list = (Array.isArray(tests) ? tests : []).filter(Boolean);
  if (!Array.isArray(picks)) return list;
  const keep = new Set(picks);
  const kept = new Set();
  groupTests(list).forEach((g, index) => {
    const key = g.key || `#row:${index}`;
    if (keep.has(key)) g.items.forEach((t) => kept.add(t));
  });
  return list.filter((t) => kept.has(t));
};
