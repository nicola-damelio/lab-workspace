/* =========================================================================
   src/utils/driveStructure.js
   LA RÈGLE DU DÉPÔT — un objet de l'application = UN dossier du Drive.

   Le Drive n'est pas une corbeille de fichiers : c'est le MÊME arbre que
   l'application. Un dossier par objet (dataset, projet, expérience, instance,
   section, sous-section, boîte, protocole, rendez-vous), un fichier par objet,
   et chaque dossier se décrit lui-même.

   Sous « Lab Workspace » :

     <dataset>/
       _meta.json                                   ← le dossier du DATASET
       <dataset>.json                               ← son état (sans pixels)
       projects/<projet>/
         _meta.json
         <projet>.json
         <section-de-page>.html                     ← le texte d'une section
         <expérience>/
           _meta.json
           <expérience>.json                        ← l'expérience entière
           <instance>/
             _meta.json
             <section>/
               _meta.json
               <sous-section>/                      ← autant de niveaux que la page
                 _meta.json
                 <texte>.html  <image>.png  <fichier>.pdb  <fichier>.xtc
         images/                                    ← figures du projet
       general_library_images/                      ← figures d'aucun projet
       protocols/<protocole>/{_meta.json,<protocole>.json}
       storage/<storage>/boxes/<boîte>/{_meta.json,box.json}
       agenda/<date>_<intitulé>/{_meta.json,appointment.json}
       backups/                                     ← instantanés + sauvegardes

   Les règles tenues ICI, et nulle part ailleurs :

     • UN SEUL créateur de dossier : l'adaptateur (`drive.ensureFolder`), qui
       passe par `driveUpload.findOrCreateFolder` — chercher-puis-créer, une
       création à la fois par (parent, nom), jumeaux départagés par leur
       contenu. Aucun autre code de ce module ne fabrique un dossier.
     • Chaque dossier PORTE son `_meta.json` : identifiant Drive, type, nom,
       parent, rang entre frères, dates. L'IDENTIFIANT est la vérité — jamais
       le nom, jamais le chemin.
     • Renommer / déplacer = PAR IDENTIFIANT (`renameObject`, `moveObject`) :
       un dossier n'est jamais recréé sous un autre nom (aucun doublon).
     • Supprimer = `trashObject` : corbeille du Drive, jamais de destruction.
     • Un fichier PAR OBJET (`<objet>.json`) et un fichier par texte : jamais un
       JSON partagé pour tout un dataset, une liste de boîtes ou l'agenda.
     • Les PIXELS ne montent pas dans ces JSON : une URL `data:` devient un
       marqueur (`__data_url__`) — l'image est déjà un fichier du Drive.
     • L'ORDRE des frères est écrit (`order`) : la page se relit à l'identique.

   Le PLAN est PUR (`datasetMirrorPlan`) : ce qui doit exister, où, avec quel
   contenu — vérifiable hors navigateur, sans réseau. L'exécution
   (`createDriveStructure`) ne fait qu'obéir au plan : créer ce qui manque,
   écrire ce qui a changé, RIEN d'autre. `publishDatasetStructure` est le seul
   geste que l'application appelle (voir App.jsx, à chaque sauvegarde).

   Vérifié hors navigateur par _drive_structure_test.mjs.
   ========================================================================= */

import {
  DEFAULT_PROJECT_NAME, GENERAL_LIBRARY_DIR, PROJECTS_CONTAINER, STORAGE_DIR,
  canonicalPageSection, canonicalSubSection, datasetFolderSlug, sanitizeSlug
} from './driveNaming';

/** Le fichier qui décrit un dossier (identique dans TOUS les dossiers). */
export const META_FILE_NAME = '_meta.json';
export const META_KIND = 'lab-workspace/folder';
export const META_VERSION = 1;
/** Marque des fichiers d'objet (`<objet>.json`). */
export const OBJECT_KIND = 'lab-workspace/object';
export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
/** Conteneurs de l'agenda (les rendez-vous sont des objets, pas des pages). */
export const AGENDA_DIR = 'agenda';
export const BACKUPS_DIR = 'backups';
export const PROTOCOLS_DIR = 'protocols';
export const STORAGE_DIR_NAME = STORAGE_DIR;

/** Les types d'objet que l'arbre connaît (`_meta.json → type`). */
export const STRUCTURE_TYPES = Object.freeze({
  DATASET: 'dataset',
  PROJECT: 'project',
  CONTAINER: 'container',
  LIBRARY: 'library',
  EXPERIMENT: 'experiment',
  INSTANCE: 'instance',
  SECTION: 'section',
  SUBSECTION: 'subsection',
  PROTOCOL: 'protocol',
  STORAGE: 'storage',
  BOX: 'box',
  AGENDA: 'agenda',
  APPOINTMENT: 'appointment',
  BACKUPS: 'backups',
  FOLDER: 'folder'
});

/* ── 1. NOMS ET MÉTADONNÉES (pur) ────────────────────────────────────────── */

/** Un dossier du Drive (et non un fichier). PUR. */
export const isFolderNode = (node) => !!node && String(node.mimeType || '') === DRIVE_FOLDER_MIME;

/** Le nom du fichier de description d'un dossier ? PUR. */
export const isMetaFileName = (name) =>
  String(name || '').trim().toLowerCase() === META_FILE_NAME;

/** Ce nœud EST-IL un `_meta.json` (donc PAS une donnée de l'utilisateur) ? PUR.
    Tout ce qui lit un dossier doit l'écarter : un `_meta.json` n'est ni une
    figure, ni un fichier brut, ni une pièce jointe. */
export const isMetaNode = (node) =>
  !!node && !isFolderNode(node) && isMetaFileName(node.name);

/** La liste des enfants d'un dossier SANS les fichiers de description. PUR. */
export const withoutMetaNodes = (nodes) =>
  (Array.isArray(nodes) ? nodes : []).filter((n) => !isMetaNode(n));

/**
 * Le contenu d'un `_meta.json`. PUR.
 * @param {{id?:string,type?:string,name?:string,parentId?:string,order?:number,
 *          datasetId?:string,datasetName?:string,datasetFolder?:string,
 *          createdAt?:string,updatedAt?:string,extra?:object}} input
 */
export const folderMetaPayload = ({
  id = '', type = STRUCTURE_TYPES.FOLDER, name = '', parentId = '', order = 0,
  datasetId = '', datasetName = '', datasetFolder = '', createdAt = '', updatedAt = '', extra = null
} = {}) => {
  const at = text(updatedAt) || new Date().toISOString();
  const meta = {
    kind: META_KIND,
    version: META_VERSION,
    id: text(id),
    type: text(type) || STRUCTURE_TYPES.FOLDER,
    name: text(name),
    parentId: text(parentId),
    order: Number.isFinite(Number(order)) ? Number(order) : 0,
    dataset: {
      id: text(datasetId),
      name: text(datasetName),
      folder: text(datasetFolder)
    },
    createdAt: text(createdAt) || at,
    updatedAt: at
  };
  if (extra && typeof extra === 'object') meta.extra = extra;
  return meta;
};

/** Le texte écrit dans `_meta.json` (indenté : lisible dans le navigateur du
    Drive). PUR. */
export const metaJson = (meta) => `${JSON.stringify(meta, null, 2)}\n`;

/**
 * Relire un `_meta.json`. PUR. `ok:false` quand le fichier n'est pas de
 * l'application — on ne prend jamais un fichier étranger pour une description.
 * @returns {{ok:boolean, meta?:object, reason?:string}}
 */
export const parseFolderMeta = (raw) => {
  let data = null;
  try {
    data = JSON.parse(String(raw == null ? '' : raw));
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'not-an-object' };
  if (text(data.kind) !== META_KIND) return { ok: false, reason: 'foreign-file' };
  return { ok: true, meta: data };
};

/** L'identifiant Drive que porte une description (`''` si le fichier est absent
    ou étranger) : c'est LUI qui fait foi. PUR. */
export const folderIdInMeta = (raw) => {
  const parsed = parseFolderMeta(raw);
  return parsed.ok ? text(parsed.meta.id) : '';
};

/**
 * Un nom d'enfant libre dans `parentId` : si le nom voulu est DÉJÀ pris, une
 * suite est ajoutée (`rapport.pdf` → `rapport_2.pdf`). Deux objets différents
 * ne sont jamais fusionnés dans un seul nom. PUR.
 */
export const safeChildName = (wanted, taken = []) => {
  const base = text(wanted) || 'item';
  const used = new Set((Array.isArray(taken) ? taken : []).map((n) => String(n || '').toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  const m = base.match(/^(.*?)(\.[A-Za-z0-9]+)$/);
  const stem = m ? m[1] : base;
  const ext = m ? m[2] : '';
  for (let i = 2; i < 500; i += 1) {
    const candidate = `${stem}_${i}${ext}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${stem}_${Date.now()}${ext}`;
};

/* ── 2. LES CHEMINS DE L'ARBRE (pur) ─────────────────────────────────────── */

const slugOr = (v, fallback = '') => sanitizeSlug(v) || fallback;

/** Une chaîne sûre (`''` si rien) — le texte d'un nom ne peut donc jamais être
    « undefined ». PUR. */
const text = (v) => (v === undefined || v === null ? '' : String(v)).trim();

/** Une sous-section peut elle-même contenir une sous-section : la chaîne donne
    les dossiers, dans l'ordre, du plus haut au plus bas. PUR. */
export const subsectionChain = (value) => {
  const list = Array.isArray(value) ? value : [value];
  return list.map((v) => canonicalSubSection(v)).filter(Boolean);
};

/**
 * Le chemin Drive d'un objet, RELATIF au dossier du dataset — le chemin COMPLET
 * est donc `Lab Workspace/<dataset>/projects/<projet>/…` (voir
 * `absoluteStructurePath`). Le dossier du dataset est résolu par l'application
 * (`ensureDriveFolder`), pour qu'un dataset renommé n'obtienne jamais un second
 * dossier. Une expérience SANS projet va dans le bac `test` SOUS `projects/` :
 * le dossier d'un projet n'est jamais posé à la racine du dataset. PUR.
 *
 * `ctx` porte les noms : project, experiment|test, instance, section,
 * subsections|subsection, storage, box, protocol, date, title.
 * @returns {string[]} les noms de dossiers, du plus haut au plus bas
 */
export const structurePathFor = (type, ctx = {}) => {
  const t = text(type).toLowerCase();
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const experiment = slugOr(c.experiment || c.test);
  /* Une expérience SANS projet ne tombe JAMAIS à la racine du dataset (défaut
     constaté : « <dataset>/<projet>/… » À CÔTÉ de `projects/`) : elle reçoit le
     bac `test` SOUS `projects/`, exactement ce que fait l'envoi
     (`driveNaming.canonicalExperimentPath` : `projects[0] || DEFAULT_PROJECT_NAME`). */
  const project = slugOr(c.project) || (experiment ? DEFAULT_PROJECT_NAME : '');
  const instance = slugOr(c.instance);
  const section = slugOr(canonicalPageSection(c.section || ''));
  const subs = subsectionChain(c.subsections || c.subsection || '');
  const head = [PROJECTS_CONTAINER];
  switch (t) {
    case STRUCTURE_TYPES.DATASET:
      return [];
    case STRUCTURE_TYPES.PROJECT:
      return [PROJECTS_CONTAINER, project].filter(Boolean);
    case STRUCTURE_TYPES.LIBRARY:
      return project ? [PROJECTS_CONTAINER, project, 'images'] : [GENERAL_LIBRARY_DIR];
    case STRUCTURE_TYPES.EXPERIMENT:
      return [...head, project, experiment].filter(Boolean);
    case STRUCTURE_TYPES.INSTANCE:
      return [...head, project, experiment, instance].filter(Boolean);
    case STRUCTURE_TYPES.SECTION:
      return [...head, project, experiment, instance, section].filter(Boolean);
    case STRUCTURE_TYPES.SUBSECTION:
      return [...head, project, experiment, instance, section, ...subs].filter(Boolean);
    case STRUCTURE_TYPES.PROTOCOL:
      return [PROTOCOLS_DIR, slugOr(c.protocol)].filter(Boolean);
    case STRUCTURE_TYPES.STORAGE:
      return [STORAGE_DIR, slugOr(c.storage)].filter(Boolean);
    case STRUCTURE_TYPES.BOX:
      return [STORAGE_DIR, slugOr(c.storage), 'boxes', slugOr(c.box)].filter(Boolean);
    case STRUCTURE_TYPES.AGENDA:
      return [AGENDA_DIR];
    case STRUCTURE_TYPES.APPOINTMENT:
      return [AGENDA_DIR, appointmentFolderName(c)].filter(Boolean);
    case STRUCTURE_TYPES.BACKUPS:
      return [BACKUPS_DIR];
    default:
      return (Array.isArray(c.path) ? c.path : []).map((n) => slugOr(n)).filter(Boolean);
  }
};

/** Le nom du dossier d'un rendez-vous : la DATE d'abord (l'agenda se lit dans
    l'ordre du calendrier), puis l'intitulé. PUR. */
export const appointmentFolderName = (ctx = {}) => {
  const date = text(ctx.date).slice(0, 10);
  const label = slugOr(ctx.title || ctx.label || ctx.name || '', '') || 'appointment';
  return date ? `${date}_${label}` : label;
};

/** La racine de l'application : le dossier qui CONTIENT les datasets, tel que
    `ensureLabWorkspaceFolder` le trouve/crée sur le Drive. PUR. */
export const APP_ROOT_NAME = 'Lab Workspace';

/** Le chemin COMPLET d'un objet, depuis la racine de l'application :
    `['Lab Workspace', <dataset>, 'projects', <projet>, …]`.
    C'est la SEULE forme qui dise où l'objet se trouve réellement : le dossier du
    dataset est un NIVEAU du Drive (résolu par l'application — `ensureDriveFolder`),
    il n'est pas un détail d'affichage. PUR. */
export const absoluteStructurePath = (type, ctx = {}) => [
  APP_ROOT_NAME,
  datasetFolderSlug(ctx.datasetName || ctx.dataset || '') || '<dataset>'
].concat(structurePathFor(type, ctx)).filter(Boolean);

/** Le chemin lisible d'un objet (« Lab Workspace / Mon_dataset / projects /
    CD / Exp_1 »). PUR. */
export const structurePathLabel = (type, ctx = {}) =>
  absoluteStructurePath(type, ctx).join(' / ');

/** Le nom du fichier d'objet (`<objet>.json`) — un fichier par objet, jamais un
    JSON partagé. PUR. */
export const objectFileName = (type, name) =>
  `${slugOr(name, slugOr(type, 'object'))}.json`;

/** Le nom du fichier d'un texte (le texte est un FICHIER, pas une case dans un
    JSON partagé). PUR. */
export const textFileName = (label, { html = true } = {}) =>
  `${slugOr(label, 'text')}${html ? '.html' : '.txt'}`;

/** Le nom d'un fichier de POINTEURS (figures, fichiers bruts d'un objet) :
    les pixels restent des fichiers du Drive, on n'écrit que le lien. PUR. */
export const pointersFileName = (type, name) =>
  `${slugOr(name, slugOr(type, 'object'))}.files.json`;


/* ── 3. CE QUI MONTE ET CE QUI NE MONTE PAS (pur) ─────────────────────────── */

const DATA_URL_RE = /^data:([\w.+-]+\/[\w.+-]+)?[;,]?/i;
const DRIVE_URL_RE = /drive\.google\.com\/(?:file\/d\/|drive\/folders\/|open\?id=)([\w-]{10,})/i;

/** Une chaîne est-elle une image (ou un fichier) encodée en clair ? PUR. */
export const isDataUrl = (value) =>
  typeof value === 'string' && value.startsWith('data:') && DATA_URL_RE.test(value.slice(0, 64));

/**
 * Le contenu d'un objet, TEL QU'IL MONTE sur le Drive : les pixels (URL
 * `data:`) deviennent un marqueur — l'image est déjà un fichier, et un JSON de
 * 40 Mo n'apprendrait rien de plus. Le reste du contenu est copié VERBATIM
 * (mêmes clés que l'application : un lecteur peut reconstruire l'objet).
 * `omitted` compte les pixels remplacés. PUR.
 */
export const stripDataUrls = (value, { depth = 0, maxDepth = 8, omitted = 0 } = {}) => {
  if (typeof value === 'string') {
    if (!isDataUrl(value)) return { value, omitted };
    const mime = (value.match(DATA_URL_RE) || [])[1] || 'application/octet-stream';
    return { value: { __data_url__: mime, bytes: Math.ceil(value.length * 0.75) }, omitted: omitted + 1 };
  }
  if (Array.isArray(value)) {
    const out = [];
    let count = omitted;
    value.forEach((item) => {
      const r = stripDataUrls(item, { depth: depth + 1, maxDepth, omitted: count });
      out.push(r.value);
      count = r.omitted;
    });
    return { value: out, omitted: count };
  }
  if (value && typeof value === 'object') {
    if (depth >= maxDepth) return { value: null, omitted };
    const out = {};
    let count = omitted;
    Object.keys(value).forEach((k) => {
      const r = stripDataUrls(value[k], { depth: depth + 1, maxDepth, omitted: count });
      if (r.value !== undefined) out[k] = r.value;
      count = r.omitted;
    });
    return { value: out, omitted: count };
  }
  return { value, omitted };
};

/**
 * Les POINTEURS Drive trouvés dans un objet (identifiants, dossiers, URL de
 * fichiers) : ce sont les figures et les fichiers bruts d'un objet, qui vivent
 * DÉJÀ comme fichiers du Drive. On écrit leur liste à côté de l'objet pour que
 * le lien soit lisible sans l'application. PUR.
 * @returns {Array<{key:string,path:string,kind:'file'|'folder',id:string,url:string}>}
 */
/**
 * Cette clé porte-t-elle l'identifiant d'un FICHIER du Drive (figure, pièce
 * jointe, document…) ? Un identifiant interne (`testId`, `boxId`) n'est PAS un
 * pointeur : seules les clés qui parlent de Drive, de fichier ou d'image. PUR.
 */
export const idKeyLooksLikeDrive = (key) => {
  const k = String(key || '');
  if (!/id$/i.test(k)) return false;
  return /(drive|file|folder|image|figure|attach|doc|pdf|blob|photo|capture|spec|raw)/i.test(k);
};

export const drivePointersIn = (value, { path = '', out = [], depth = 0, maxDepth = 8 } = {}) => {
  const push = (id, kind) => {
    const key = `${kind}:${id}`;
    if (out.some((p) => p.key === key)) return;
    out.push({
      key,
      path,
      kind,
      id,
      url: kind === 'folder'
        ? `https://drive.google.com/drive/folders/${id}`
        : `https://drive.google.com/file/d/${id}/view`
    });
  };
  if (typeof value === 'string') {
    const m = value.match(DRIVE_URL_RE);
    if (m) push(m[1], /folders/.test(value) ? 'folder' : 'file');
    return out;
  }
  if (Array.isArray(value)) {
    if (depth >= maxDepth) return out;
    value.forEach((item, i) => drivePointersIn(item, {
      path: `${path}[${i}]`, out, depth: depth + 1, maxDepth
    }));
    return out;
  }
  if (value && typeof value === 'object') {
    if (depth >= maxDepth) return out;
    Object.keys(value).forEach((k) => {
      const v = value[k];
      if (typeof v === 'string') {
        if (idKeyLooksLikeDrive(k) && /^[\w-]{10,}$/.test(v)) {
          push(v, /folder/i.test(k) ? 'folder' : 'file');
          return;
        }
        if (k.toLowerCase().endsWith('url')) return;
      }
      drivePointersIn(v, { path: path ? `${path}.${k}` : k, out, depth: depth + 1, maxDepth });
    });
  }
  return out;
};

const TEXT_KEY_RE = /(html|text|comment|note|description|procedure|protocol|setup|observation|result|conclusion|background|discussion|abstract|intro|summary|analysis|method|plan|title|subtitle|name|label)/i;
const ID_KEY_RE = /(^id$|Id$|_id$|url|link|date|time|color|mime|ext|unit|key|type|status|path|folder)/;

/**
 * Les TEXTES d'un objet : les chaînes qui portent du contenu (et non un
 * identifiant, une date, une couleur…). Chaque texte deviendra un FICHIER dans
 * le dossier de la section à laquelle il appartient. PUR.
 * @returns {Array<{key:string,label:string,value:string,html:boolean}>}
 */
export const textsIn = (value, { minLength = 24 } = {}) => {
  const out = [];
  const walk = (node, path, depth) => {
    if (depth > 4 || !node || typeof node !== 'object') return;
    Object.keys(node).forEach((k) => {
      const v = node[k];
      const here = path ? `${path}.${k}` : k;
      if (typeof v === 'string') {
        if (v.length < minLength || isDataUrl(v)) return;
        if (!TEXT_KEY_RE.test(k) || ID_KEY_RE.test(k)) return;
        out.push({
          key: here,
          label: k,
          value: v,
          html: /<[a-z][\s\S]*>/i.test(v)
        });
        return;
      }
      if (Array.isArray(v)) { v.forEach((item, i) => walk(item, `${here}[${i}]`, depth + 1)); return; }
      walk(v, here, depth + 1);
    });
  };
  walk(value, '', 0);
  return out.filter((t) => t.key);
};


/* ── 4. LE PLAN (pur) : ce qui doit exister, où, avec quel contenu ────────── */

/** Les collections d'objets d'un dataset, tolérant aux formes anciennes. PUR. */
export const datasetObjectsOf = (data) => {
  const d = data && typeof data === 'object' ? data : {};
  const asList = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
  const projects = asList(d.projects);
  const tests = asList(d.tests);
  const storages = asList(d.storages);
  const protocols = asList(d.datasetProtocols || d.protocols);
  const appointments = [];
  tests.forEach((t) => asList(t.plan).forEach((task) => appointments.push({ ...task, testId: t.id, testName: t.name })));
  return { projects, tests, storages, protocols, appointments };
};

/** Le contexte d'expérience d'une expérience (les mêmes clés que
    `driveNaming.canonicalExperimentPath`). PUR. */
export const experimentCtxOf = (test = {}) => {
  const t = test && typeof test === 'object' ? test : {};
  const names = Array.isArray(t.projectNames) ? t.projectNames.filter(Boolean) : [];
  const project = names[0] || t.project || '';
  const testName = text(t.name) || text(t.testName) || text(t.id) || 'experiment';
  return {
    project,
    projectNames: names.length ? names : (project ? [project] : []),
    experiment: testName,
    instance: text(t.instanceName) || text(t.instance) || '',
    section: t.section || t.pagesection || '',
    subsections: t.subsections || t.subsection || ''
  };
};

/** Les textes d'une page, SECTION PAR SECTION (quand l'objet les porte ainsi).
    PUR. `[]` quand l'objet n'a pas de sections nommées. */
export const sectionTextsOf = (value) => {
  const node = value && typeof value === 'object' ? value : null;
  if (!node) return [];
  const out = [];
  const pushOne = (raw, name) => {
    const r = raw && typeof raw === 'object' ? raw : null;
    const body = r ? (r.html || r.text || r.content || r.value || '') : (typeof raw === 'string' ? raw : '');
    const label = text((r && (r.title || r.label || r.name || r.id)) || name || '');
    if (!label || !text(body)) return;
    out.push({
      section: label,
      subsection: text(r && (r.subsection || r.subSection || r.child)) || '',
      value: String(body)
    });
  };
  const sections = node.sections;
  if (Array.isArray(sections)) sections.forEach((s, i) => pushOne(s, `section_${i + 1}`));
  else if (sections && typeof sections === 'object') {
    Object.keys(sections).forEach((k) => pushOne(sections[k], k));
  }
  return out;
};

/** Un objet du plan, sous sa forme de FICHIER : le contenu de l'application,
    plus ce qui permet de le reconnaître et de le relire (type, id, nom, date).
    PUR. */
export const objectPayload = ({ type, name, id = '', at = new Date().toISOString(), data = null, extra = null }) => {
  const stripped = stripDataUrls(data);
  const payload = {
    kind: OBJECT_KIND,
    version: META_VERSION,
    type: text(type),
    id: text(id),
    name: text(name),
    savedAt: text(at) || new Date().toISOString(),
    omittedPixels: stripped.omitted,
    data: stripped.value
  };
  if (extra && typeof extra === 'object') payload.extra = extra;
  return payload;
};

/** Le texte d'un fichier JSON lisible (indenté, terminé par un retour). PUR. */
export const jsonText = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** Les NIVEAUX de dossiers d'une expérience, du plus haut au plus bas : le
    projet, l'expérience, l'instance, la section, puis CHAQUE sous-section
    (autant de niveaux que la page en déclare). PUR. */
export const pathLevelsFor = (ctx = {}) => {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const levels = [];
  const experiment = slugOr(c.experiment || c.test);
  /* Même règle que `structurePathFor` : sans projet, une expérience vit dans le
     bac `test` SOUS `projects/` — le dossier du projet n'est jamais posé à la
     racine du dataset. */
  const project = slugOr(c.project) || (experiment ? DEFAULT_PROJECT_NAME : '');
  if (project) levels.push({ type: STRUCTURE_TYPES.PROJECT, name: project });
  if (experiment) levels.push({ type: STRUCTURE_TYPES.EXPERIMENT, name: experiment });
  const instance = slugOr(c.instance);
  if (instance) levels.push({ type: STRUCTURE_TYPES.INSTANCE, name: instance });
  const section = slugOr(canonicalPageSection(c.section || ''));
  if (section) levels.push({ type: STRUCTURE_TYPES.SECTION, name: section });
  subsectionChain(c.subsections || c.subsection || '')
    .forEach((sub) => levels.push({ type: STRUCTURE_TYPES.SUBSECTION, name: sub }));
  return levels;
};

/** Les niveaux d'une expérience transformés en CHEMINS (le conteneur
    `projects/` est posé devant le projet, comme le fait tout envoi). PUR. */
export const pathFromLevels = (levels = []) => {
  const path = [];
  (Array.isArray(levels) ? levels : []).forEach((level) => {
    if (level.type === STRUCTURE_TYPES.PROJECT) path.push(PROJECTS_CONTAINER);
    path.push(level.name);
  });
  return path;
};

/**
 * LE PLAN DU DÉPÔT d'un dataset : tout ce qui doit exister sur le Drive pour
 * que l'application soit reconstruisible par la LECTURE DU DRIVE SEUL. PUR —
 * aucun réseau, aucun accès au navigateur : un test le vérifie.
 *
 * Une entrée de `folders` = un dossier (`path` relatif au dossier du dataset,
 * `type`, `order`). Une entrée de `files` = un fichier (`path`, `name`, `body`).
 * Les parents précèdent toujours leurs enfants, l'ordre est stable.
 *
 * @returns {{datasetId:string,datasetName:string,datasetFolder:string,at:string,
 *            folders:Array<object>,files:Array<object>}}
 */
export const datasetMirrorPlan = ({
  datasetId = '', datasetName = '', datasetFolder = '', data = null, at = new Date().toISOString()
} = {}) => {
  const folderSlug = text(datasetFolder) || datasetFolderSlug(datasetName);
  const at2 = text(at) || new Date().toISOString();
  const folders = new Map();
  const files = new Map();
  const orderOf = new Map();

  const addFolder = (path, type, name, extra = null) => {
    const clean = (Array.isArray(path) ? path : []).map((n) => text(n)).filter(Boolean);
    const key = clean.join('/');
    if (folders.has(key)) {
      const prev = folders.get(key);
      if (extra) prev.extra = { ...(prev.extra || {}), ...extra };
      return prev;
    }
    const parentKey = clean.slice(0, -1).join('/');
    const order = orderOf.get(parentKey) || 0;
    orderOf.set(parentKey, order + 1);
    const entry = {
      path: clean,
      type,
      name: clean.length ? clean[clean.length - 1] : folderSlug,
      order,
      extra
    };
    folders.set(key, entry);
    return entry;
  };
  const addFile = ({ path, name, mimeType = 'application/json', body = '', kind = 'object' }) => {
    const clean = (Array.isArray(path) ? path : []).map((n) => text(n)).filter(Boolean);
    const cleanName = text(name);
    if (!cleanName) return null;
    const entry = { path: clean, name: cleanName, mimeType, body: String(body), kind };
    files.set(`${clean.join('/')}|${cleanName}`, entry);
    return entry;
  };
  const addJson = (path, name, payload, kind = 'object') =>
    addFile({ path, name, body: jsonText(payload), kind });
  const addText = (path, name, value, kind = 'text') =>
    addFile({ path, name, mimeType: 'text/html; charset=utf-8', body: String(value), kind });
  /** Ajoute TOUT un chemin de niveaux (les parents d'abord). Rend le chemin. */
  const addLevels = (levels, extra = null) => {
    const path = pathFromLevels(levels);
    const offset = levels.length && levels[0].type === STRUCTURE_TYPES.PROJECT ? 1 : 0;
    if (offset) addFolder([PROJECTS_CONTAINER], STRUCTURE_TYPES.CONTAINER, PROJECTS_CONTAINER);
    levels.forEach((level, i) => {
      const isLast = i === levels.length - 1;
      addFolder(path.slice(0, i + 1 + offset), level.type, level.name, isLast ? extra : null);
    });
    return path;
  };

  /* Le dataset lui-même : son dossier, décrit par son `_meta.json`. */
  addFolder([], STRUCTURE_TYPES.DATASET, folderSlug, { id: datasetId, name: datasetName });

  const { projects, tests, storages, protocols, appointments } = datasetObjectsOf(data);

  /* ── Un PROJET : son dossier, son JSON, ses textes de section ─────────── */
  if (projects.length || tests.length) {
    addFolder([PROJECTS_CONTAINER], STRUCTURE_TYPES.CONTAINER, PROJECTS_CONTAINER);
  }
  projects.forEach((p) => {
    const name = text(p.name) || text(p.id) || 'project';
    const path = structurePathFor(STRUCTURE_TYPES.PROJECT, { project: name });
    addFolder(path, STRUCTURE_TYPES.PROJECT, sanitizeSlug(name), { id: p.id });
    addJson(path, objectFileName('project', name),
      objectPayload({ type: 'project', name, id: p.id, at: at2, data: p }), 'project');
    textsIn(p).forEach((t) => addText(path, textFileName(t.label, { html: t.html }), t.value));
  });

  /* ── Les EXPÉRIENCES : un dossier PAR NIVEAU DE LA PAGE ──────────────── */
  tests.forEach((t) => {
    const raw = experimentCtxOf(t);
    const ctx = { ...raw, project: raw.project || DEFAULT_PROJECT_NAME };
    const levels = pathLevelsFor(ctx);
    if (!levels.length) return;
    const experimentName = text(t.name) || text(t.id) || 'experiment';
    const path = addLevels(levels, { id: t.id });
    const expLevels = levels.filter((l) => l.type !== STRUCTURE_TYPES.SECTION && l.type !== STRUCTURE_TYPES.SUBSECTION);
    const expPath = pathFromLevels(expLevels);
    addJson(expPath, objectFileName('experiment', experimentName),
      objectPayload({ type: 'experiment', name: experimentName, id: t.id, at: at2, data: t }), 'experiment');

    const named = sectionTextsOf(t);
    if (named.length) {
      /* Les textes que la page range DANS une section nommée vont dans le
         dossier de CETTE section (sous-sections comprises). */
      named.forEach((s) => {
        const sLevels = pathLevelsFor({
          ...ctx, section: s.section, subsections: s.subsection ? [s.subsection] : []
        });
        const sPath = sLevels.length ? addLevels(sLevels) : path;
        addText(sPath, textFileName(s.section, { html: true }), s.value, 'section-text');
      });
    }
    /* Les autres textes de la page (remarques, commentaires…) vont dans le
       dossier de l'expérience — jamais dans un JSON partagé. Ceux qui sont
       DÉJÀ rangés dans une section nommée ne sont pas écrits deux fois. */
    textsIn(t)
      .filter((x) => !/^sections(\[|\.)/.test(x.key))
      .forEach((x) => addText(expPath, textFileName(x.label, { html: x.html }), x.value));

    const pointers = drivePointersIn(t);
    if (pointers.length) {
      addJson(path, pointersFileName('experiment', experimentName), {
        kind: OBJECT_KIND,
        type: 'files',
        name: experimentName,
        savedAt: at2,
        files: pointers.map((p) => ({ path: p.path, kind: p.kind, id: p.id, url: p.url }))
      }, 'pointers');
    }
  });

  /* ── Un STORAGE et ses BOÎTES : un dossier par objet ──────────────────── */
  if (storages.length) addFolder([STORAGE_DIR], STRUCTURE_TYPES.CONTAINER, STORAGE_DIR);
  storages.forEach((s) => {
    const name = text(s.name) || text(s.id) || 'storage';
    const path = structurePathFor(STRUCTURE_TYPES.STORAGE, { storage: name });
    addFolder(path, STRUCTURE_TYPES.STORAGE, sanitizeSlug(name), { id: s.id });
    addJson(path, objectFileName('storage', name),
      objectPayload({ type: 'storage', name, id: s.id, at: at2, data: s }), 'storage');
    if (Array.isArray(s.boxes) && s.boxes.length) {
      addFolder([...path, 'boxes'], STRUCTURE_TYPES.CONTAINER, 'boxes');
    }
    (Array.isArray(s.boxes) ? s.boxes : []).forEach((box) => {
      if (!box || typeof box !== 'object') return;
      const boxName = text(box.name) || text(box.id) || 'box';
      const bPath = structurePathFor(STRUCTURE_TYPES.BOX, { storage: name, box: boxName });
      addFolder(bPath, STRUCTURE_TYPES.BOX, sanitizeSlug(boxName), { id: box.id });
      addJson(bPath, objectFileName('box', boxName),
        objectPayload({ type: 'box', name: boxName, id: box.id, at: at2, data: box }), 'box');
      textsIn(box).forEach((t) => addText(bPath, textFileName(t.label, { html: t.html }), t.value));
      const boxPointers = drivePointersIn(box);
      if (boxPointers.length) {
        addJson(bPath, pointersFileName('box', boxName), {
          kind: OBJECT_KIND,
          type: 'files',
          name: boxName,
          savedAt: at2,
          files: boxPointers.map((p) => ({ path: p.path, kind: p.kind, id: p.id, url: p.url }))
        }, 'pointers');
      }
    });
  });

  /* ── Un PROTOCOLE : son dossier, son JSON, son texte ─────────────────── */
  if (protocols.length) addFolder([PROTOCOLS_DIR], STRUCTURE_TYPES.CONTAINER, PROTOCOLS_DIR);
  protocols.forEach((p) => {
    const name = text(p.title) || text(p.name) || text(p.id) || 'protocol';
    const path = structurePathFor(STRUCTURE_TYPES.PROTOCOL, { protocol: name });
    addFolder(path, STRUCTURE_TYPES.PROTOCOL, sanitizeSlug(name), { id: p.id });
    addJson(path, objectFileName('protocol', name),
      objectPayload({ type: 'protocol', name, id: p.id, at: at2, data: p }), 'protocol');
    textsIn(p).forEach((t) => addText(path, textFileName(t.label, { html: t.html }), t.value));
  });

  /* ── L'AGENDA : un dossier par RENDEZ-VOUS ───────────────────────────── */
  if (appointments.length) {
    addFolder([AGENDA_DIR], STRUCTURE_TYPES.AGENDA, AGENDA_DIR);
  }
  appointments.forEach((a) => {
    const folderName = appointmentFolderName({ date: a.date, title: a.title || a.label || a.name || a.text });
    const path = [AGENDA_DIR, folderName];
    addFolder(path, STRUCTURE_TYPES.APPOINTMENT, folderName, { id: a.id || '', extra: { date: text(a.date).slice(0, 10) } });
    addJson(path, objectFileName('appointment', folderName),
      objectPayload({ type: 'appointment', name: folderName, id: a.id || '', at: at2, data: a }), 'appointment');
  });

  /* ── Le fichier du DATASET : de quoi retrouver chaque objet sans
        l'application (l'index de ce que le Drive porte). ─────────────────── */
  addJson([], objectFileName('dataset', folderSlug), {
    kind: OBJECT_KIND,
    version: META_VERSION,
    type: STRUCTURE_TYPES.DATASET,
    id: text(datasetId),
    name: text(datasetName),
    folder: folderSlug,
    savedAt: at2,
    objectFile: objectFileName('dataset', folderSlug),
    counts: {
      projects: projects.length,
      experiments: tests.length,
      storages: storages.length,
      protocols: protocols.length,
      appointments: appointments.length
    },
    folders: [...folders.values()].map((f) => f.path.join('/')),
    files: [...files.keys()].map((k) => k.replace('|', ' / '))
  }, 'dataset');

  return {
    datasetId: text(datasetId),
    datasetName: text(datasetName),
    datasetFolder: folderSlug,
    at: at2,
    folders: [...folders.values()],
    files: [...files.values()]
  };
};

/* ── 5. L'EXÉCUTION DU PLAN : créer ce qui manque, écrire ce qui a changé ─── */

/** Une empreinte courte et stable d'un contenu (djb2 + longueur). PUR. */
export const contentFingerprint = (value) => {
  const s = String(value == null ? '' : value);
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `${h.toString(36)}:${s.length}`;
};

/** Le corps d'un fichier SANS son horodate de passage (`savedAt` de premier
    niveau, celui que pose `objectPayload`). Deux sauvegardes du même contenu ne
    diffèrent QUE par elle : réécrire huit fichiers à chaque frappe pour une
    horodate serait du travail perdu. PUR. */
export const fileBodyStamp = (body) =>
  String(body == null ? '' : body).replace(/^ {2}"savedAt": "[^"]*",?\r?\n/gm, '');

/** L'empreinte d'un fichier du plan (ce qui décide s'il faut le réécrire). PUR. */
export const fileFingerprint = (file) =>
  contentFingerprint(`${(file && file.mimeType) || ''}\u0000${fileBodyStamp(file && file.body)}`);

/** Les empreintes des fichiers DÉJÀ publiés dans cette session : republier le
    même contenu n'écrit rien (l'application sauvegarde souvent). */
const publishedFingerprints = new Map();
export const resetPublishedFingerprints = () => publishedFingerprints.clear();

/* Deux mémoires de SESSION (elles évitent de relire et de réécrire les mêmes
   descriptions à chaque sauvegarde) :
     • `structureMetaWritten` : les dossiers dont la description a été écrite ;
     • `structureMetaCache`   : la description relue (son `createdAt` d'origine).
   Elles sont indexées par IDENTIFIANT de dossier : un dossier renommé ou
   déplacé garde la même entrée, et `renameObject` la rafraîchit. */
const structureMetaWritten = new Set();
const structureMetaCache = new Map();
/* L'EXÉCUTEUR D'UN DATASET EST RÉUTILISÉ : il garde la correspondance
   (« parent, nom » → identifiant), donc la sauvegarde suivante ne redemande RIEN
   au Drive pour retrouver les mêmes dossiers — une sauvegarde qui a lieu à chaque
   frappe ne doit pas coûter une tournée de recherches. Indexé par dossier de
   dataset (deux datasets n'ont jamais le même identifiant de dossier). */
const structureByRoot = new Map();
export const resetDriveStructureCache = () => {
  structureMetaWritten.clear();
  structureMetaCache.clear();
  publishedFingerprints.clear();
  structureByRoot.clear();
};

/**
 * L'EXÉCUTEUR. Il ne connaît que l'adaptateur (voir `defaultDriveStructureIo`)
 * et ne crée un dossier QUE par `drive.ensureFolder` — le seul créateur.
 *
 * @param {{io:object}} options l'adaptateur Drive (obligatoire)
 */
/* ── 5ter. L'OBJET RENOMMÉ N'A PAS DE SECOND DOSSIER ────────────────────────
   LE DÉFAUT, sur le Drive réel le 08/10/2026 (dataset « GEC-UPJV-projects ») :
   `projects/p53H/interaction_pdbs` portait CINQ dossiers d'instance —
   `1YCR`, `3LNZ`, `instance1`, `New_Instance_2`, `New_Instance_3` — alors que le
   programme n'en avait que trois. Les `_meta.json` le disent sans discussion :
   `1YCR` et `instance1` portent le MÊME `extra.id` (`t17914951876631134`), donc
   ce sont LE MÊME objet applicatif, sous deux noms. Renommer une instance (ou
   une expérience, ou un projet) laissait le dossier du vieux nom derrière lui et
   en fabriquait un nouveau — le renommage n'était qu'apparent.

   POURQUOI. Le plan est bâti sur les NOMS (`projects/<projet>/<expérience>/…`) et
   l'exécuteur ne savait faire que « chercher ce nom, sinon CRÉER » : après un
   renommage, le nom cherché n'existait plus, donc un dossier était créé — et
   l'ancien, que plus rien ne nommait, restait pour toujours.

   LE REMÈDE. Le plan PORTE l'identité applicative de chaque objet
   (`extra.id`, écrit dans son `_meta.json`, c'est elle qu'on lit dans la preuve
   ci-dessus) : quand le nom cherché manque, l'exécuteur regarde les dossiers
   FRÈRES et adopte celui dont la description porte le même identifiant — puis le
   RENOMME (par identifiant, donc rien n'est copié, rien n'est perdu). Un objet
   renommé n'a plus jamais deux dossiers. */

/** LE FRÈRE QUI EST LE MÊME OBJET : parmi des dossiers frères décrits
 *  (`{ id, name, meta }`), celui dont la description porte l'identifiant
 *  applicatif voulu. Rend son identifiant, ou '' (aucun candidat, ou pas
 *  d'identifiant à chercher). PUR. */
export const pickRenamedSibling = (candidates = [], { appId = '' } = {}) => {
  const want = String(appId || '').trim();
  if (!want) return '';
  const hit = (Array.isArray(candidates) ? candidates : []).find(
    (c) => c && String((c.meta && c.meta.extra && c.meta.extra.id) || '') === want
  );
  return hit ? String(hit.id || '') : '';
};

/** Nom de dossier qu'une entrée de plan veut, et identité qu'elle porte. PUR. */
export const planEntryIdentity = (entry = null) => ({
  name: String((entry && entry.name) || ''),
  appId: String((entry && entry.extra && entry.extra.id) || '')
});

export const createDriveStructure = ({ io = null } = {}) => {
  const drive = io && typeof io === 'object' ? io : null;
  if (!drive) return null;
  const pathIds = new Map();   // '<parentId>|<a/b>' → identifiant du dossier
  const metaCache = structureMetaCache;      // folderId → description relue (ou null)
  const metaWritten = structureMetaWritten;  // folderId → description écrite

  /** Le dossier d'un chemin, CRÉÉ au besoin (parents d'abord). Seul créateur. */
  const ensurePath = async (path, { rootId = '' } = {}) => {
    const wanted = (Array.isArray(path) ? path : []).map((n) => sanitizeSlug(n) || text(n)).filter(Boolean);
    let parent = rootId;
    const ids = [];
    for (let i = 0; i < wanted.length; i += 1) {
      const name = wanted[i];
      const key = `${parent}|${name}`;
      let id = pathIds.get(key) || '';
      if (!id) {
        id = String(await drive.ensureFolder(name, parent) || '');
        if (!id) return { ok: false, ids, error: `the folder “${name}” could not be created` };
        pathIds.set(key, id);
      }
      ids.push(id);
      parent = id;
    }
    return { ok: true, ids, leafId: parent };
  };

  /** La description d'un dossier, relue une fois (createdAt d'origine). */
  const readMeta = async (folderId) => {
    if (metaCache.has(folderId)) return metaCache.get(folderId);
    let meta = null;
    try {
      const fileId = await drive.findFile(META_FILE_NAME, folderId);
      if (fileId) {
        const raw = await drive.downloadText(fileId);
        const parsed = parseFolderMeta(raw);
        meta = parsed.ok ? parsed.meta : null;
      }
    } catch { meta = null; }
    metaCache.set(folderId, meta);
    return meta;
  };

  /** Écrire la description d'un dossier (une fois par passe et par dossier). */
  const writeMeta = async ({
    folderId, parentId = '', type = STRUCTURE_TYPES.FOLDER, name = '',
    order = 0, extra = null, force = false, dataset = null
  } = {}) => {
    if (!folderId) return false;
    if (!force && metaWritten.has(folderId)) return true;
    const previous = await readMeta(folderId);
    const payload = folderMetaPayload({
      id: folderId,
      parentId,
      type,
      name,
      order,
      createdAt: (previous && previous.createdAt) || '',
      updatedAt: new Date().toISOString(),
      datasetId: (dataset && dataset.id) || '',
      datasetName: (dataset && dataset.name) || '',
      datasetFolder: (dataset && dataset.folder) || '',
      extra: { ...((previous && previous.extra) || {}), ...(extra || {}) }
    });
    const id = await drive.upload({
      name: META_FILE_NAME,
      mimeType: 'application/json',
      body: metaJson(payload),
      folderId
    });
    if (!id) return false;
    metaCache.set(folderId, payload);
    metaWritten.add(folderId);
    return true;
  };

  /* ── L'OBJET DÉJÀ LÀ : PAR SON NOM, SINON PAR SON IDENTITÉ ────────────────
     `existingObjectFolder` est le seul chemin qui ÉVITE la création ; quand il
     rend '' l'appelant appelle `ensurePath` comme avant (donc rien ne change pour
     un objet qui n'existe pas encore). Le magasin `scanStore` (un par publication)
     fait qu'un dossier parent n'est LISTÉ qu'une fois par passage. */
  const folderOfAppIdentity = async ({ parentId = '', appId = '', skipNames = null, scanStore = null } = {}) => {
    const want = String(appId || '').trim();
    if (!parentId || !want) return null;
    const store = scanStore instanceof Map ? scanStore : new Map();
    let entry = store.get(parentId);
    if (!entry) {
      let children = [];
      try { children = await drive.list(parentId); } catch { children = []; }
      const skip = skipNames instanceof Set ? skipNames : new Set();
      const candidates = [];
      for (const child of (Array.isArray(children) ? children : [])) {
        if (!child || !child.id || !isFolderNode(child)) continue;
        const childName = String(child.name || '');
        /* Un frère dont le nom est DÉJÀ dans le plan de ce passage n'a pas été
           renommé : le décrire serait une lecture par objet, pour rien. */
        if (skip.has(childName)) continue;
        candidates.push({ id: String(child.id), name: childName, meta: await readMeta(String(child.id)) });
      }
      entry = { candidates };
      store.set(parentId, entry);
    }
    const id = pickRenamedSibling(entry.candidates, { appId: want });
    if (!id) return null;
    const hit = entry.candidates.find((c) => String(c.id) === String(id)) || null;
    return { id: String(id), name: hit ? String(hit.name || '') : '' };
  };

  const existingObjectFolder = async ({ names = [], parentId = '', appId = '', skipNames = null, scanStore = null } = {}) => {
    const wanted = (Array.isArray(names) ? names : []).map((n) => sanitizeSlug(n) || text(n)).filter(Boolean);
    const name = wanted.length ? wanted[wanted.length - 1] : '';
    if (!parentId || !name) return '';
    /* 1. LE NOM — le cas ordinaire : l'objet n'a pas bougé. */
    try {
      const found = await drive.findFolder(name, parentId);
      if (found) return String(found);
    } catch { /* une recherche qui échoue ne décide de rien — on essaie l'identité */ }
    /* 2. L'IDENTITÉ — l'objet a été RENOMMÉ : son dossier porte l'ancien nom, sa
       description porte `extra.id`. On l'ADOPTE (jamais un second dossier) et on
       le renomme PAR IDENTIFIANT, donc les fichiers qu'il contient suivent. */
    const adopted = await folderOfAppIdentity({ parentId, appId, skipNames, scanStore });
    if (!adopted || !adopted.id) return '';
    if (adopted.name !== name) {
      try { await drive.rename(adopted.id, name); } catch { /* le nom suivra au prochain passage */ }
      metaCache.delete(adopted.id);
    }
    return adopted.id;
  };

  /** Le dossier d'un objet, avec sa description (le seul chemin pour CRÉER). */
  const ensureObject = async ({ type, ctx = {}, rootId = '', order = 0, extra = null, dataset = null, path = null }) => {
    const names = Array.isArray(path) ? path : structurePathFor(type, ctx);
    const parentPath = names.slice(0, -1);
    const parent = parentPath.length ? (await ensurePath(parentPath, { rootId })) : { ok: true, leafId: rootId };
    if (!parent.ok) return { ok: false, id: '', path: names, error: parent.error };
    /* L'OBJET RENOMMÉ EST ADOPTÉ (voir pickRenamedSibling) : son nom a changé, son
       dossier existe déjà — le créer en fabriquerait un second. */
    const adopted = await existingObjectFolder({
      names,
      parentId: parent.leafId || '',
      appId: String((extra && extra.id) || ''),
      skipNames: null,
      scanStore: new Map()
    });
    const leaf = adopted ? { ok: true, leafId: adopted, error: '' } : await ensurePath(names, { rootId });
    if (!leaf.ok || !leaf.leafId) return { ok: false, id: '', path: names, error: leaf.error };
    const name = names.length ? names[names.length - 1] : '';
    await writeMeta({
      folderId: leaf.leafId, parentId: parent.leafId || '', type, name, order, extra, dataset
    });
    return { ok: true, id: leaf.leafId, parentId: parent.leafId || '', path: names, name };
  };

  /** Écrire un fichier dans un dossier (un fichier par objet / par texte). */
  const writeFile = async ({ folderId, name, mimeType = 'application/json', body = '' }) => {
    if (!folderId || !name) return '';
    return String(await drive.upload({ folderId, name, mimeType, body: String(body) }) || '');
  };

  /** Relire un fichier d'un dossier (`''` s'il n'y est pas). */
  const readFile = async ({ folderId, name }) => {
    if (!folderId || !name) return '';
    const id = await drive.findFile(name, folderId);
    return id ? drive.downloadText(id) : '';
  };

  /** Renommer un objet : PAR IDENTIFIANT (jamais un second dossier). */
  const renameObject = async ({ folderId, newName, type = '', order = 0, dataset = null, parentId = '' }) => {
    if (!folderId || !text(newName)) return false;
    const clean = sanitizeSlug(newName) || text(newName);
    const ok = await drive.rename(folderId, clean);
    if (!ok) return false;
    metaCache.delete(folderId);
    await writeMeta({ folderId, parentId, type, name: clean, order, force: true, dataset });
    return true;
  };

  /** Déplacer un objet : PAR IDENTIFIANT (le dossier suit, aucun doublon). */
  const moveObject = async ({ folderId, newParentId }) => {
    if (!folderId || !newParentId || folderId === newParentId) return false;
    const ok = await drive.move(folderId, newParentId);
    if (!ok) return false;
    metaCache.delete(folderId);
    return true;
  };

  /** Supprimer un objet : CORBEILLE du Drive, jamais de destruction. */
  const trashObject = async ({ folderId }) => {
    if (!folderId) return false;
    return !!(await drive.trash(folderId));
  };

  /**
   * Exécuter un PLAN : chaque dossier reçoit sa description, chaque fichier est
   * écrit (ou réécrit quand son contenu a changé). Les empreintes évitent les
   * réécritures inutiles. Rien d'autre n'est touché.
   */
  const publish = async (plan, { rootId = '', writeAll = false, fingerprints = null } = {}) => {
    const report = {
      ok: true, rootId: String(rootId || ''), folders: 0, metas: 0,
      files: 0, skipped: 0, errors: []
    };
    if (!plan || !rootId) {
      report.ok = false;
      report.errors.push({ scope: 'plan', message: 'no dataset folder (rootId)' });
      return report;
    }
    const dataset = { id: plan.datasetId, name: plan.datasetName, folder: plan.datasetFolder };
    const idByPath = new Map();
    /* Les deux mémoires du RENOMMAGE (voir pickRenamedSibling) : les noms que ce
       plan porte sous chaque parent (un frère dont le nom y est n'a pas bougé) et
       les frères déjà décrits une fois dans ce passage. */
    const planNamesByParent = new Map();
    (plan.folders || []).forEach((entry) => {
      const parentPath = entry.path.slice(0, -1).join('/');
      if (!planNamesByParent.has(parentPath)) planNamesByParent.set(parentPath, new Set());
      planNamesByParent.get(parentPath).add(String(entry.name || ''));
    });
    const scanStore = new Map();
    for (const entry of plan.folders) {
      const parentPath = entry.path.slice(0, -1).join('/');
      const parentId = entry.path.length ? (idByPath.get(parentPath) || rootId) : '';
      /* ⚠ LE DOSSIER EXISTANT SE CHERCHE D'ABORD PAR SON NOM, PUIS PAR L'IDENTITÉ
         DE L'OBJET. Sans cette seconde recherche, un objet RENOMMÉ faisait créer
         un dossier au nouveau nom et laissait l'ancien sur le Drive (constaté le
         08/10/2026 : cinq dossiers d'instance pour trois instances). Le dossier
         rendu est utilisé TEL QUEL, jamais recréé. */
      /* Le PARENT de cette entrée : on ne le connaît que s'il est DÉJÀ dans le plan
         (`idByPath`) ou si l'entrée est au premier niveau (parent = dossier du
         dataset). Dans tous les autres cas le parent sera construit par
         `ensurePath` juste après — et une recherche « par nom » sous un parent
         inconnu pourrait tomber sur un dossier homonyme d'une AUTRE branche. */
      const parentKnown = entry.path.length === 0 || parentPath === '' || idByPath.has(parentPath);
      const existing = parentKnown ? await existingObjectFolder({
        names: entry.path,
        parentId,
        appId: String((entry.extra && entry.extra.id) || ''),
        skipNames: planNamesByParent.get(parentPath) || null,
        scanStore
      }) : '';
      const leaf = existing ? { ok: true, leafId: existing } : await ensurePath(entry.path, { rootId });
      if (!leaf.ok || !leaf.leafId) {
        report.ok = false;
        report.errors.push({ scope: 'folder', path: entry.path.join('/'), message: leaf.error || 'unknown error' });
        continue;
      }
      idByPath.set(entry.path.join('/'), leaf.leafId);
      report.folders += 1;
      const wrote = await writeMeta({
        folderId: leaf.leafId, parentId, type: entry.type, name: entry.name,
        order: entry.order, extra: entry.extra, dataset
      });
      if (wrote) report.metas += 1;
    }
    for (const file of plan.files) {
      const folderId = idByPath.get(file.path.join('/'));
      if (!folderId) {
        report.ok = false;
        report.errors.push({ scope: 'file', path: `${file.path.join('/')}/${file.name}`, message: 'folder missing' });
        continue;
      }
      /* L'empreinte est indexée par DATASET **et** par dossier de dataset : un
         dossier recréé (dataset supprimé puis rouvert, autre compte Drive) ne
         peut jamais faire croire qu'un fichier y est déjà écrit. */
      const key = `${plan.datasetId}|${rootId}|${file.path.join('/')}|${file.name}`;
      const print = fileFingerprint(file);
      if (!writeAll && fingerprints && fingerprints.get(key) === print) {
        report.skipped += 1;
        continue;
      }
      const id = await writeFile({ folderId, name: file.name, mimeType: file.mimeType, body: file.body });
      if (!id) {
        report.ok = false;
        report.errors.push({ scope: 'file', path: `${file.path.join('/')}/${file.name}`, message: 'upload failed' });
        continue;
      }
      report.files += 1;
      if (fingerprints) fingerprints.set(key, print);
    }
    return report;
  };

  /**
   * VÉRIFIER un plan contre le Drive (LECTURE SEULE) : ce qui manque, ce qu'on
   * ne s'explique pas. C'est la question « tout est-il bien rangé ? ».
   */
  const audit = async (plan, { rootId = '' } = {}) => {
    const out = {
      ok: true, rootId: String(rootId || ''),
      foldersMissing: [], filesMissing: [], metasMissing: []
    };
    if (!plan || !rootId) { out.ok = false; return out; }
    const idByPath = new Map([['', rootId]]);
    for (const entry of plan.folders) {
      const key = entry.path.join('/');
      /* L'entrée RACINE, c'est le dossier du dataset lui-même : il n'existe pas
         de dossier portant le nom du dataset À L'INTÉRIEUR de lui-même. Le lui
         demander faisait répondre « il manque le dossier du dataset » alors
         qu'on était dedans. */
      if (!key) continue;
      const parentPath = entry.path.slice(0, -1).join('/');
      const parentId = idByPath.get(parentPath) || rootId;
      let id = '';
      try { id = String(await drive.findFolder(entry.name, parentId) || ''); } catch { id = ''; }
      if (!id) { out.foldersMissing.push(key); out.ok = false; continue; }
      idByPath.set(key, id);
    }
    for (const entry of plan.folders) {
      const id = idByPath.get(entry.path.join('/')) || '';
      if (!id) continue;
      let metaId = '';
      try { metaId = String(await drive.findFile(META_FILE_NAME, id) || ''); } catch { metaId = ''; }
      if (!metaId) { out.metasMissing.push(entry.path.join('/')); out.ok = false; }
    }
    const expected = new Map();
    plan.files.forEach((f) => {
      const key = f.path.join('/');
      if (!expected.has(key)) expected.set(key, []);
      expected.get(key).push(f.name);
    });
    for (const [key, names] of expected) {
      const id = idByPath.get(key) || '';
      if (!id) {
        names.forEach((n) => out.filesMissing.push(`${key || '.'}/${n}`));
        out.ok = false;
        continue;
      }
      for (const name of names) {
        let fileId = '';
        try { fileId = String(await drive.findFile(name, id) || ''); } catch { fileId = ''; }
        if (!fileId) { out.filesMissing.push(`${key || '.'}/${name}`); out.ok = false; }
      }
    }
    return out;
  };

  return {
    ensurePath, ensureObject, writeMeta, readMeta, writeFile, readFile,
    renameObject, moveObject, trashObject, publish, audit,
    knownPathId: (parentId, name) => pathIds.get(`${parentId}|${name}`) || ''
  };
};

/* ── 6. L'ADAPTATEUR RÉEL, ET LE GESTE QUE L'APPLICATION APPELLE ─────────── */

/**
 * L'adaptateur Drive du navigateur. Tout passe par `driveUpload` — donc par
 * `findOrCreateFolder` pour les dossiers (le seul créateur) et par
 * `uploadLocalFile` pour les fichiers (qui réécrit un fichier de même nom au
 * lieu d'en créer un second, et le met en file de reprise si le Drive ne
 * répond pas).
 */
/** L'exécuteur du dataset (réutilisé d'une sauvegarde à l'autre — voir
    `structureByRoot`). PUR de tout effet : il ne fait que mémoriser. */
const structureFor = (drive, rootId) => {
  const key = String(rootId || '');
  let structure = key ? structureByRoot.get(key) : null;
  if (!structure) {
    structure = createDriveStructure({ io: drive });
    if (key) structureByRoot.set(key, structure);
  }
  return structure;
};

export const defaultDriveStructureIo = async () => {
  const up = await import('./driveUpload');
  return {
    workspaceId: () => up.ensureLabWorkspaceFolder(),
    rootId: () => up.ensureDriveFolder(),
    ensureFolder: (name, parentId) => up.findOrCreateFolder(name, parentId),
    findFolder: (name, parentId) => up.findFolderByName(name, parentId),
    list: (folderId) => up.listDriveChildren(folderId),
    listDetailed: (folderId) => up.listDriveChildrenDetailed(folderId),
    findFile: (name, parentId) => up.findDriveFileByName(name, parentId),
    upload: async ({ name, mimeType, body, folderId }) => {
      const blob = typeof Blob === 'undefined'
        ? body
        : new Blob([String(body)], { type: mimeType || 'application/json' });
      const res = await up.uploadLocalFile({ name, mimeType, file: blob, folderId });
      return res && res.id ? String(res.id) : '';
    },
    downloadText: (fileId) => up.downloadDriveFileText(fileId),
    rename: (fileId, name) => up.renameDriveFile(fileId, name),
    move: (fileId, parentId) => up.moveDriveFile(fileId, parentId),
    trash: (fileId) => up.trashDriveFile(fileId),
    available: () => up.cloudBackendAvailable() && !!up.getDriveToken()
  };
};

/**
 * PUBLIER UN DATASET SUR LE DRIVE : le geste unique de la règle. Il construit
 * le plan (pur) puis l'exécute avec l'adaptateur donné (ou celui du navigateur).
 *
 * Il ne lève jamais : un Drive injoignable rend `{ ok:false, reason }` — c'est
 * à l'appelant de le DIRE, jamais de faire semblant d'avoir enregistré.
 *
 * @param {{datasetId?:string,datasetName?:string,datasetFolder?:string,data?:object,
 *          io?:object,rootId?:string,writeAll?:boolean,at?:string}} options
 */
export const publishDatasetStructure = async ({
  datasetId = '', datasetName = '', datasetFolder = '', data = null,
  io = null, rootId = '', writeAll = false, at = new Date().toISOString()
} = {}) => {
  const plan = datasetMirrorPlan({ datasetId, datasetName, datasetFolder, data, at });
  let drive = io;
  if (!drive) {
    if (typeof window === 'undefined') return { ok: false, reason: 'no-browser', plan, report: null };
    drive = await defaultDriveStructureIo();
  }
  if (typeof drive.available === 'function' && !drive.available()) {
    return { ok: false, reason: 'cloud-unavailable', plan, report: null };
  }
  let root = String(rootId || '');
  if (!root) {
    try { root = String(await drive.rootId() || ''); } catch { root = ''; }
  }
  if (!root) return { ok: false, reason: 'no-dataset-folder', plan, report: null };
  const structure = structureFor(drive, root);
  const report = await structure.publish(plan, { rootId: root, writeAll, fingerprints: publishedFingerprints });
  return { ok: report.ok, reason: report.ok ? '' : 'publish-failed', plan, report, structure, rootId: root };
};

/**
 * VÉRIFIER UN DATASET (LECTURE SEULE) : le plan contre le Drive. Rend ce qui
 * manque — de quoi dire « ce dataset est-il entièrement sur le Drive ? ».
 */
export const auditDatasetStructure = async ({
  datasetId = '', datasetName = '', datasetFolder = '', data = null, io = null, rootId = ''
} = {}) => {
  const plan = datasetMirrorPlan({ datasetId, datasetName, datasetFolder, data });
  let drive = io;
  if (!drive) {
    if (typeof window === 'undefined') return { ok: false, reason: 'no-browser', audit: null };
    drive = await defaultDriveStructureIo();
  }
  if (typeof drive.available === 'function' && !drive.available()) {
    return { ok: false, reason: 'cloud-unavailable', audit: null };
  }
  let root = String(rootId || '');
  if (!root) {
    try { root = String(await drive.rootId() || ''); } catch { root = ''; }
  }
  if (!root) return { ok: false, reason: 'no-dataset-folder', audit: null };
  const structure = createDriveStructure({ io: drive });
  const audit = await structure.audit(plan, { rootId: root });
  return { ok: audit.ok, reason: audit.ok ? '' : 'incomplete', audit, plan, rootId: root, structure };
};

/** Le rapport d'une publication en UNE phrase (pour la barre de statut). PUR. */
export const publishReportText = (report) => {
  if (!report) return 'nothing was published';
  const parts = [
    `${report.folders} folders`,
    `${report.metas} _meta.json`,
    `${report.files} files written`
  ];
  if (report.skipped) parts.push(`${report.skipped} unchanged`);
  if (report.errors && report.errors.length) parts.push(`${report.errors.length} failed`);
  const head = report.ok ? '✅ Drive mirrors the dataset — ' : '⚠️ Drive mirror incomplete — ';
  return head + parts.join(', ') + (report.errors && report.errors.length
    ? ` (first: ${report.errors[0].path || report.errors[0].scope})`
    : '');
};

/** Le rapport d'un audit en UNE phrase. PUR. */
export const auditReportText = (audit) => {
  if (!audit) return 'nothing was checked';
  const missing = (audit.foldersMissing || []).length
    + (audit.filesMissing || []).length + (audit.metasMissing || []).length;
  if (!missing) return '✅ every object of this dataset is on the Drive.';
  return `⚠️ ${missing} item(s) missing on the Drive: `
    + (audit.foldersMissing || []).slice(0, 3).join(', ')
    + ((audit.filesMissing || []).length ? ` · files: ${(audit.filesMissing || []).slice(0, 3).join(', ')}` : '')
    + ((audit.metasMissing || []).length ? ` · _meta.json: ${(audit.metasMissing || []).slice(0, 3).join(', ')}` : '');
};







