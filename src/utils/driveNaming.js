/* =========================================================================
   src/utils/driveNaming.js
   Helpers that keep Google Drive attachments tidy with zero setup:
     - suggestDriveFileName()  → SHORT file names (title_scientist.ext)
     - driveFolderPath()       → the Drive folder hierarchy that mirrors the
       app schema (project / test / section / instance)
     - getDriveFolderUrl()     → the Drive folder the user wants to open
     - setDriveFolderUrl()     → remember that folder in localStorage
     - openDrive()             → open the saved folder (or Drive root) in a new tab
     - copyText()              → clipboard helper with a textarea fallback

   Folder layout on Drive (inside "Lab Workspace" → the dataset folder):
       <project>/<test>/<instance>/<section>/<title>_<scientist>.<ext>
   A standalone protocol lives under a fixed "protocols" container, in its own
   folder named after the protocol:
       protocols/<protocol>/<title>.<ext>
   A test that is not part of any project lives at:
       <test>/<instance>/<section>/<title>_<scientist>.<ext>
   A storage and its boxes are NOT experiments (a box is a location):
       storage/<storage>/images/<file>
       storage/<storage>/boxes/<box>/images/<file>
       storage/<storage>/boxes/<box>/label.pdf
   ========================================================================= */

/** Shared slug-maker for folder and file names. */
export const sanitizeSlug = (s) => String(s || '')
  .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '') // strip emoji pictographs
  .replace(/[\uFE0F\u200D]/g, '') // variation selector + zero-width joiner
  .replace(/\s+/g, '_')
  .replace(/[^\w.-]+/g, '')
  .replace(/_+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 60);

/** Short file name: <title>_<scientist>. The context that used to be stuffed
 *  into the name (project, test, section, instance) now becomes a FOLDER
 *  hierarchy — see driveFolderPath(). `title` falls back to `suffix`/`kind`
 *  so placeholder names (no file chosen yet) still read sensibly.
 *  For protocols the folder is named after the protocol only
 *  (protocols/<protocol>), so the scientist is NOT repeated in the file name.
 *  No date prefix: re-uploading a file with the same name overwrites the
 *  existing Drive file (see driveUpload.uploadLocalFile) instead of
 *  creating a duplicate every day. */
export const suggestDriveFileName = ({
  kind = 'File', title = '', suffix = '', scientist = '', protocol = ''
}) => {
  const parts = [];
  if (title) parts.push(String(title).trim());
  else if (suffix) parts.push(String(suffix).trim());
  else if (kind && kind !== 'File') parts.push(kind);
  if (scientist && !protocol) parts.push(String(scientist).trim());
  const slug = parts.map(sanitizeSlug).filter(Boolean).join('_');
  return slug || kind || 'file';
};

/** Alias des TITRES de section d'un PROJET → nom de dossier Drive HISTORIQUE.
 *  Un titre affiché peut évoluer (« Discussion » s'appelle aujourd'hui
 *  « Results and Discussion ») sans que les documents déjà envoyés changent de
 *  dossier : le dossier garde le nom d'origine, donc un seul dossier existe et
 *  l'emplacement affiché (« 📁 Drive location ») est le vrai. */
const PROJECT_SECTION_FOLDER_ALIASES = {
  'results and discussion': 'Discussion',
  'results & discussion': 'Discussion'
};

/** Le nom de dossier Drive d'une section de projet, indépendant du titre montré. */
export const projectSectionFolderAlias = (label) => {
  const raw = String(label || '').trim();
  return PROJECT_SECTION_FOLDER_ALIASES[raw.toLowerCase()] || raw;
};

/* ── Le rangement d'un STORAGE et de ses BOÎTES ─────────────────────────────
   Une boîte de stockage n'est PAS une expérience : c'est un EMPLACEMENT. Elle
   ne suit donc pas l'architecture d'une expérience (ni « instance », ni
   « section ») et son dossier porte le NOM de la boîte — jamais le numéro
   « Test 74 » de sa création. Dans le dossier du dataset :

       storage/<storage>/images/<fichier>          ← image de référence du storage
       storage/<storage>/boxes/<boîte>/images/<f>  ← photos d'une boîte
       storage/<storage>/boxes/<boîte>/label.pdf   ← étiquette d'une boîte

   Un storage sans nom tombe dans le bac « unassigned » (le « _ » de tête du nom
   canonique tombe à la création, exactement comme projects/_unassigned). */
export const STORAGE_DIR = 'storage';
export const STORAGE_BOXES_DIR = 'boxes';
export const STORAGE_IMAGES_DIR = 'images';
/** Nom du PDF d'étiquette d'une boîte (rangé dans le dossier de la boîte). */
export const BOX_LABEL_FILE_NAME = 'label.pdf';

/** Le nom de dossier d'un storage (« _unassigned » quand il n'a pas de nom). */
const storageSlug = (name) => sanitizeSlug(name) || '_unassigned';

/** Noms de dossiers Drive d'un storage : storage/<storage>. */
export const storageFolderPath = (storageName) => [STORAGE_DIR, storageSlug(storageName)];

/** storage/<storage>/images — l'image de référence du storage. */
export const storageImagesFolderPath = (storageName) =>
  [...storageFolderPath(storageName), STORAGE_IMAGES_DIR];

/** storage/<storage>/boxes/<boîte> — le dossier d'UNE boîte. */
export const storageBoxFolderPath = (storageName, boxName) => [
  ...storageFolderPath(storageName), STORAGE_BOXES_DIR, sanitizeSlug(boxName) || 'box'
];

/** storage/<storage>/boxes/<boîte>/images — les photos d'une boîte. */
export const storageBoxImagesFolderPath = (storageName, boxName) =>
  [...storageBoxFolderPath(storageName, boxName), STORAGE_IMAGES_DIR];

/** Contexte de nommage d'un fichier rangé sous un storage / une boîte : il sert
 *  à la fois à RÉSOUDRE le dossier (driveFolderPath) et à tenir le REGISTRE des
 *  fichiers (renommage, suppression, reprise d'envoi suivent le dossier).
 *  `title` est le nom du fichier : un renommage de storage/boîte recalcule donc
 *  le même nom et ne renomme pas le fichier. */
export const storageFileCtx = ({ storage, box = '', title = '' }) => ({
  storage, box, title, section: STORAGE_IMAGES_DIR
});

/** « image » (singulier, l'ancien nom de dossier) est le dossier « images ». */
const storageSectionSlug = (raw) => {
  const section = sanitizeSlug(canonicalPageSection(raw));
  return section === 'image' ? STORAGE_IMAGES_DIR : section;
};


/** The Drive folder path (folder NAMES only) that mirrors the app schema:
 *  [project, test, instance, section] for test files — the instance comes right
 *  after the test and the SECTION (e.g. Data/Setup/Report) is the leaf folder;
 *  [project, section] for project documents; [protocols, <protocol>]
 *  for protocols (the folder is named after the protocol only). */
export const driveFolderPath = (ctx = {}) => {
  /* STORAGE / BOÎTES : un contexte { storage, box? } vise la structure
     storage/<storage>/boxes/<boîte>/images (voir les helpers ci-dessus). L'ordre
     est celui de la structure canonique — aucun niveau « instance ». */
  if (ctx && typeof ctx === 'object' && ctx.storage !== undefined) {
    const segs = storageFolderPath(ctx.storage);
    if (String(ctx.box || '').trim()) segs.push(STORAGE_BOXES_DIR, sanitizeSlug(ctx.box));
    const section = storageSectionSlug(ctx.section || ctx.pagesection || '');
    if (section) segs.push(section);
    return segs.filter(Boolean);
  }
  if (!ctx || typeof ctx !== 'object') return [];
  if (ctx.protocol !== undefined) {
    // Protocols live in their own container, in a folder named after the
    // protocol only: protocols/<protocol> (the scientist is NOT part of the
    // folder name). An empty/untitled protocol still lands INSIDE the
    // protocols container — never at the dataset root.
    const protoSlug = sanitizeSlug(ctx.protocol);
    return protoSlug ? ['protocols', protoSlug] : ['protocols'];
  }
  const segs = [];
  if (ctx.project) segs.push(ctx.project);
  if (ctx.test) {
    // Test files: Project/Test/Instance/Section
    segs.push(ctx.test);
    if (ctx.instance) segs.push(ctx.instance);
  }
  if (ctx.section) segs.push(ctx.test ? ctx.section : projectSectionFolderAlias(ctx.section));
  return segs.map(sanitizeSlug).filter(Boolean);
};

const DRIVE_FOLDER_KEY = 'labDriveFolderUrl';

/** The Drive folder URL the user wants "Open Drive" to jump to ('' = Drive root). */
export const getDriveFolderUrl = () => {
  try {
    const v = localStorage.getItem(DRIVE_FOLDER_KEY);
    return v && String(v).startsWith('http') ? String(v).trim() : '';
  } catch { return ''; }
};

export const setDriveFolderUrl = (url) => {
  try { localStorage.setItem(DRIVE_FOLDER_KEY, String(url || '').trim()); } catch { /* ignore */ }
};

/** Open the saved Drive folder (or Drive root) in a new tab. */
export const openDrive = () => {
  const folder = getDriveFolderUrl();
  window.open(folder || 'https://drive.google.com/', '_blank', 'noopener,noreferrer');
};

/** Copy text to the clipboard (Async Clipboard API + legacy fallback). */
export const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(String(text ?? ''));
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = String(text ?? '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }
};

/* =========================================================================
   Canonical Google-Drive architecture (Lab Workspace)
   =========================================================================
   Root ("Lab Workspace") contains ONLY dataset directories.

   Every dataset directory follows a strict, fixed structure:
     <dataset>/projects     → <project>/<experiment>/<instance>/<page section>/[<page subsection>]
     <dataset>/backups      → weekly HTML saves of the dataset
     <dataset>/protocols    → shared protocol library
     <dataset>/storage      → shared storage / sample-location resources
     <dataset>/publications → shared publication library

   Page-section directories are always the lower-case shell names:
     experimental conditions · instrumental setup · experiment setup ·
     data · data analysis · report
   Subsections are created dynamically when a page section has them.
   ========================================================================= */

/** Le conteneur canonique des EXPÉRIENCES : c'est le premier segment de tout
 *  envoi d'expérience — projects/<projet>/<expérience>/… (voir
 *  canonicalExperimentPath). */
export const PROJECTS_CONTAINER = 'projects';

/** The only sub-directories allowed directly inside a dataset folder. */
export const DATASET_FOLDER_DIRS = [PROJECTS_CONTAINER, 'backups', 'protocols', 'storage', 'publications'];

/** Canonical dataset directory name (used for uploads AND backups, so a dataset
 *  never fragments into several sibling folders at the workspace root). */
export const datasetFolderSlug = (title) => sanitizeSlug(title) || 'dataset';

/** Map any historical / UI section label onto the canonical lower-case page
 *  section. Labels that are not page sections are returned unchanged. */
export const canonicalPageSection = (raw) => {
  const key = String(raw || '').trim().toLowerCase();
  const table = {
    'experimental conditions': 'experimental conditions',
    conditions: 'experimental conditions',
    'instrumental setup': 'instrumental setup',
    instrumental: 'instrumental setup',
    setup: 'experiment setup',
    'experiment setup': 'experiment setup',
    'experimental setup': 'experiment setup',
    data: 'data',
    analysis: 'data analysis',
    analyses: 'data analysis',
    'data analysis': 'data analysis',
    report: 'report',
    reports: 'report'
  };
  return table[key] || String(raw || '').trim();
};

/** Canonical name of a page subsection ('' when none). Kept as a clean slug. */
export const canonicalSubSection = (raw) => sanitizeSlug(raw);

/** Unique project names referenced by an upload context (ctx.projectNames is
 *  the experiment's many-to-many list; ctx.project is the legacy single one). */
export const projectNamesOf = (ctx = {}) => [
  ...new Set(
    []
      .concat(Array.isArray(ctx.projectNames) ? ctx.projectNames : [])
      .concat(ctx.project ? [ctx.project] : [])
      .map((s) => String(s || '').trim())
      .filter(Boolean)
  )
];

/** Canonical Drive folder NAMES (relative to the dataset folder) for an
 *  experiment (test) upload context:
 *      projects/<project>/<experiment>/<instance>/<page section>/[<subsection>]
 *  Returns [] when `ctx` does not describe an experiment file.
 *  NOTE: protocols keep their own container — protocols/<protocol>. */
export const canonicalExperimentPath = (ctx = {}) => {
  if (!ctx || typeof ctx !== 'object') return [];
  if (ctx.protocol !== undefined) return driveFolderPath(ctx);
  const test = String(ctx.test || '').trim();
  if (!test) return []; // project documents / library figures keep legacy routing
  const projects = projectNamesOf(ctx);
  const project = (projects[0] || '_unassigned'); // validation forbids missing projects
  const segs = ['projects', sanitizeSlug(project), sanitizeSlug(test)];
  if (String(ctx.instance || '').trim()) segs.push(sanitizeSlug(ctx.instance));
  const section = canonicalPageSection(ctx.section || ctx.pagesection || '');
  if (section) segs.push(section);
  const subsection = canonicalSubSection(ctx.subsection || ctx.pagesubsection || '');
  if (subsection) segs.push(subsection);
  return segs.filter(Boolean);
};

/** Rétablit la tête CANONIQUE d'un chemin d'envoi d'EXPÉRIENCE.
 *
 *  Un `path` explicite peut arriver dans l'ancienne forme de driveFolderPath —
 *      [<projet>, <expérience>, <instance?>, <section?>…]
 *  — qui n'a PAS le conteneur « projects ». L'envoi créait alors un dossier au
 *  NIVEAU DU DATASET (« <dataset>/<projet>/… ») à côté de projects/, comme si
 *  l'expérience n'était liée à aucun projet (constaté sur l'import Bruker du
 *  NMR 1D et du ssNMR : deux spectres importés dans une expérience d'un projet
 *  laissaient le dossier du projet à la racine du dataset).
 *
 *  Un chemin DÉJÀ canonique est conservé : seul le nom du projet est remplacé
 *  par celui du projet visé, donc un fichier partagé entre plusieurs projets est
 *  déposé sous CHACUN d'eux (l'appelant boucle projet par projet).
 *  Sans `ctx.test` (protocole, figure, document de projet, storage) le chemin
 *  est rendu tel quel. PUR. */
export const canonicalizeExperimentPath = (path, ctx = {}) => {
  const segs = Array.isArray(path) ? path.filter(Boolean) : [];
  if (segs.length === 0) return segs;
  const test = String((ctx && ctx.test) || '').trim();
  if (!test) return segs;
  const projects = projectNamesOf(ctx);
  const projectSeg = sanitizeSlug(projects[0] || '_unassigned');
  if (segs[0] === PROJECTS_CONTAINER) {
    // Déjà canonique : on ne remplace que le projet (envoi multi-projets).
    return segs[1] ? [PROJECTS_CONTAINER, projectSeg, ...segs.slice(2)] : segs;
  }
  const testSeg = sanitizeSlug(test);
  const projectSlug = projects.length ? sanitizeSlug(projects[0]) : '';
  if (projectSlug && segs[0] === projectSlug && segs[1] === testSeg) {
    // <projet>/<expérience>/… → projects/<projet visé>/<expérience>/…
    return [PROJECTS_CONTAINER, projectSeg, ...segs.slice(1)];
  }
  if (segs[0] === testSeg) {
    // <expérience>/… (ancienne forme sans projet, ou projet absent du chemin)
    return [PROJECTS_CONTAINER, projectSeg, ...segs];
  }
  return segs;
};

/** Same as canonicalExperimentPath but returns the plain canonical page-section
 *  name + subsection, for building/validating the mirror folders. */
export const pageSectionOf = (ctx = {}) => {
  const section = canonicalPageSection(ctx.section || ctx.pagesection || '');
  const subsection = canonicalSubSection(ctx.subsection || ctx.pagesubsection || '');
  return { pagesection: section, pagesubsection: subsection };
};

/** Canonical Drive folder NAMES (relative to the dataset folder) of a project's
 *  IMAGE LIBRARY — the figures captured in the app (Image Builder canvases,
 *  ⭐ chart captures, molecule-viewer captures):
 *      projects/<project>/images
 *  The figures folder always lives INSIDE the canonical "projects" container:
 *  a figure saved with no project goes to the "_unassigned" bucket, exactly
 *  like an experiment with no project, so a dataset folder never grows a stray
 *  directory beside projects/backups/protocols/storage/publications. */
export const projectImagesFolderPath = (projectName) => [
  'projects', sanitizeSlug(projectName) || '_unassigned', 'images'
];

/** Canonical Drive folder NAMES (relative to the dataset folder) of a PROJECT
 *  DOCUMENT attached to one of the project page's sections (Scientific
 *  background / Discussion / Conclusions …):
 *      <project>/<section>
 *  Exactly the routing driveFolderPath({ project, section }) gives an upload
 *  carrying that naming context, so the label shown in the interface and the
 *  folder where the file really lands can never drift apart. */
export const projectSectionFolderPath = (projectName, section) =>
  driveFolderPath({ project: projectName, section });

/** Human-readable location of a project section's documents, with the EXACT
 *  Drive folder name of the dataset first:
 *      "My_dataset / CD_project / Scientific_background"
 *  (`datasetName` is the open dataset's title; it is slugged like
 *  datasetFolderSlug so what is displayed is what Drive shows.) */
export const projectSectionFolderLabel = (projectName, section, datasetName = '') => {
  const segs = [];
  const ds = String(datasetName || '').trim();
  if (ds) segs.push(datasetFolderSlug(ds));
  segs.push(...projectSectionFolderPath(projectName, section));
  return segs.join(' / ');
};

/** Human-readable location of a project's IMAGE LIBRARY on Drive:
 *      "My_dataset / projects / CD_project / images"
 *  Chaque segment est affiché tel que le Drive le NOMME : la création d'un
 *  chemin sanitise les noms de dossiers (driveUpload.resolveDrivePathFromNames),
 *  donc la bibliothèque COMMUNE vit dans `projects/unassigned/images` — le `_`
 *  de tête du nom canonique `_unassigned` tombe. Afficher le nom canonique
 *  envoyait l'utilisateur chercher un dossier qui n'existe pas sur son Drive.
 *  ('' when the dataset folder is not known yet — see driveUpload). */
export const projectImagesFolderLabel = (projectName, datasetName = '') => {
  const segs = [];
  const ds = String(datasetName || '').trim();
  if (ds) segs.push(datasetFolderSlug(ds));
  segs.push(...projectImagesFolderPath(projectName).map((s) => sanitizeSlug(s) || s));
  return segs.join(' / ');
};
