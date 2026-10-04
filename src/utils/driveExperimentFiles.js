/* =========================================================================
   src/utils/driveExperimentFiles.js — LIRE LE DOSSIER DE L'EXPÉRIENCE.

   Jusqu'ici l'application ne retrouvait un fichier BRUT (topologie `.gro` /
   `.pdb` / `.cif`, trajectoire `.xtc` / `.trr` / `.dcd`…) que par ce qui était
   DÉCLARÉ : le nom du fichier, le nom déposé sur le Drive, ou l'identifiant du
   pointeur (`utils/driveRestore.js`, recherche « name contains '<radical>' »).

   Conséquence signalée : un fichier parfaitement valable, DÉPOSÉ À LA MAIN
   dans le dossier de l'expérience, reste INVISIBLE — son nom ne contient pas le
   radical déclaré, son identifiant n'est dans aucun pointeur, et aucun registre
   local ne l'a jamais vu. La page annonce alors « pas dans ce navigateur ni sur
   le Drive » alors que le fichier est là, à l'endroit canonique.

   Ce module apporte le geste manquant : LIRE LE DOSSIER. Il résout les
   dossiers canoniques de l'expérience — ceux que `uploadLocalFile` a réellement
   créés (`canonicalExperimentPath` : projects/<projet>/<expérience>/
   <instance?>/<section?>/<sous-section?>) puis remonte d'un cran à la fois
   jusqu'au dossier de l'expérience — et rend la LISTE des fichiers dont
   l'extension correspond au type cherché :

       listExperimentFiles({ ctx, exts })
         → { paths, path, folderId, files: [{ id, name, size, modifiedTime,
                                              url, folderPath, folderPathText }] }

   Ce module porte AUSSI le seul geste qui FABRIQUE : CRÉER les dossiers de
   l'expérience. Il est EXPLICITE (`createExperimentFolder`, appelé par un
   bouton — la demande : « If the experiment does not exist in drive, allow me
   to create it with the correct path », puis, mot pour mot, « for a trajectory
   it must be datasetname/projects/projectname/experimentname/instancename/
   subsection/file where subsection is experiment_setup/trajectory for
   trajectory files and experiment_setup/Structure for pdb files »), et il crée
   la CHAÎNE ENTIÈRE : la tête commune (`projects/<projet>/<expérience>/
   [<instance>]`) ET les deux sous-sections où les fichiers se déposent
   (`experiment_setup/Structure`, `experiment_setup/Trajectory`).

   …ET IL LES REMPLIT : le même geste COPIE dedans les fichiers que ce poste a
   en main (`depositExperimentFiles` — la demande : « the "Create drive folder"
   button does not copy the files in the folder it creates but this is the most
   important thing »). Un fichier déjà là, sous son nom attendu (l'un des noms
   que l'archivage emploie), n'est PAS recopié, et un dossier déjà là n'est
   jamais recréé : le geste entier est idempotent.

   Règles tenues ici :
     • LA LECTURE NE CRÉE RIEN : le dossier est CHERCHÉ (`{ create: false }`) ;
       un dossier absent est simplement absent (un geste de lecture ne fabrique
       jamais d'arborescence) ;
     • on ne sort JAMAIS de l'expérience : le conteneur `projects/` et la racine
       du dataset ne sont jamais lus (le plus large candidat est le dossier de
       l'expérience) ;
     • les DOSSIERS ne sont pas des fichiers : seuls les enfants de type fichier
       sont rendus ;
     • `stopWhenFound` (défaut) arrête la lecture au PREMIER dossier qui porte
       une correspondance — c'est « le bon dossier » — et évite de balayer tout
       le projet ; la liste porte alors le chemin où le fichier a été vu, que
       l'interface montre tel quel.

   Google Drive uniquement : Nextcloud n'a pas d'équivalent de `listDriveChildren`
   (la reprise y reste la recherche par nom de driveRestore.js). Le provider est
   donc regardé avant toute requête.

   Vérifié hors navigateur par _experiment_folder_files_test.mjs (logique pure +
   faux Drive).
   ========================================================================= */

import {
  canonicalExperimentPath, canonicalPageSection, canonicalSubSection, datasetFolderSlug,
  PROJECTS_CONTAINER, sanitizeSlug
} from './driveNaming';
import { getCloudProvider, ncEnsureFolders } from './nextcloud';
/* Le PRÉDICAT « c'est le MÊME fichier » de l'application (`sameRawFileFor` : même
   extension, et radicaux identiques ou l'un préfixe de l'autre) — c'est lui qui
   reconnaît un fichier DÉJÀ déposé, même quand le nom porté sur le Drive est plus
   long que le nom local (`<radical>_<scientifique>.<ext>`). */
import { sameRawFileFor } from './driveRestore';
import {
  archiveFileDriveName, getDriveRootName, getDriveToken, listDriveChildren,
  resolveDrivePathFromNames, uploadLocalFile
} from './driveUpload';

/** Type MIME d'un dossier Google Drive (un dossier n'est PAS un fichier). */
export const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Extensions d'une TOPOLOGIE MD (`.gro` / `.pdb` / `.cif`…). */
export const MD_TOPOLOGY_EXTS = ['pdb', 'gro', 'cif', 'ent', 'mol2', 'pdbqt', 'xyz'];

/** Extensions d'une TRAJECTOIRE MD (fichiers lourds, jamais dans le dataset). */
export const MD_TRAJECTORY_EXTS = ['xtc', 'trr', 'dcd', 'nc', 'netcdf', 'lammpstrj', 'binpos', 'crd'];

/** Extensions d'une structure (NMR / docking : un modèle, pas une trajectoire). */
export const STRUCTURE_FILE_EXTS = ['pdb', 'cif', 'ent', 'gro', 'mol2', 'sdf', 'mol', 'xyz', 'pdbqt'];

/** L'extension d'un nom de fichier, sans le point et en minuscules ('' si aucune). */
export const driveFileExt = (name = '') => {
  const m = String(name || '').match(/\.([A-Za-z0-9]{1,8})$/);
  return m ? m[1].toLowerCase() : '';
};

/** Une liste d'extensions normalisée : sans point, minuscules, sans doublon. PUR. */
export const normalizeFileExts = (exts = []) => {
  const list = Array.isArray(exts) ? exts : [exts];
  const out = [];
  list.forEach((ext) => {
    const v = String(ext || '').replace(/^\./, '').trim().toLowerCase();
    if (v && !out.includes(v)) out.push(v);
  });
  return out;
};

/** Vrai quand `name` porte une des extensions voulues. PUR. */
export const fileHasExt = (name = '', exts = []) => {
  const ext = driveFileExt(name);
  return !!ext && normalizeFileExts(exts).includes(ext);
};

/** Vrai quand un nœud de Drive est un DOSSIER (donc pas un fichier à lire). PUR. */
export const isDriveFolderNode = (node) => (
  !!node && String(node.mimeType || '') === GOOGLE_FOLDER_MIME
);


/** Les chemins de dossiers candidats d'une expérience, du plus précis au plus
 *  large. PUR.
 *
 *  `canonicalExperimentPath(ctx)` rend [projects, projet, expérience,
 *  instance?, section?, sous-section?] — c'est EXACTEMENT le dossier où
 *  `uploadLocalFile` dépose (voir driveUpload.ctxPathOf). On remonte d'un cran
 *  à la fois — la sous-section, puis la section, puis l'instance — en
 *  s'arrêtant AU dossier de l'expérience : un fichier posé « un peu plus haut »
 *  (le dossier de la section, ou celui de la condition) est donc retrouvé, et
 *  rien au-dessus de l'expérience n'est jamais lu. */
export const experimentFolderPathsOf = (ctx = {}, { levels = 4 } = {}) => {
  const base = canonicalExperimentPath(ctx);
  if (base.length < 3) return [];      // projects/<projet>/<expérience> au minimum
  const out = [base];
  const max = Math.max(1, Number(levels) || 1);
  for (let cut = base.length - 1; cut >= 3 && out.length < max; cut -= 1) {
    out.push(base.slice(0, cut));
  }
  return out;
};

/** Tous les chemins candidats de PLUSIEURS contextes de nommage (l'app range une
 *  même donnée sous deux sections selon le bouton qui l'a envoyée : `Setup` pour
 *  la page MD, `Data` pour les commandes du viewer 3D). Dédupliqué ; l'ordre des
 *  contextes est conservé. PUR. */
export const experimentFolderCandidates = ({ ctx = null, ctxs = [], levels = 4 } = {}) => {
  const list = [ctx, ...(Array.isArray(ctxs) ? ctxs : [ctxs])].filter(Boolean);
  const out = [];
  const seen = new Set();
  list.forEach((c) => {
    experimentFolderPathsOf(c, { levels }).forEach((path) => {
      const key = path.join('/');
      if (seen.has(key)) return;
      seen.add(key);
      out.push(path);
    });
  });
  return out;
};

/** Le dossier de l'EXPÉRIENCE — la tête canonique que TOUS ses fichiers
 *  partagent : `projects/<projet>/<expérience>[/<instance>]`, SANS section ni
 *  sous-section. C'est ce dossier que crée `createExperimentFolder` : un
 *  dossier créé une fois sert aussi bien à la topologie (rangée sous `Setup`)
 *  qu'à la trajectoire (rangée sous `Data`).
 *  Rend [] quand le contexte ne décrit pas une expérience (aucun nom
 *  d'expérience, protocole, document de projet). PUR. */
export const experimentFolderPathOf = (ctx = {}) => {
  const base = canonicalExperimentPath(ctx);
  // Deux gardes : un chemin d'expérience commence par le conteneur `projects/`,
  // et il lui faut au moins projects/<projet>/<expérience>.
  if (base.length < 3 || base[0] !== PROJECTS_CONTAINER) return [];
  const instance = String((ctx && ctx.instance) || '').trim();
  return instance ? base.slice(0, 4) : base.slice(0, 3);
};

/** Le texte d'un chemin de dossiers TEL QU'IL EST ÉCRIT sur le Drive : chaque
 *  segment est slugué comme `resolveDrivePathFromNames` le fait pour de vrai
 *  (« experiment setup » y est le dossier `experiment_setup`). L'interface
 *  montre donc le nom que l'utilisateur voit dans son navigateur de fichiers,
 *  et non l'étiquette interne de la page. PUR. */
export const drivePathText = (path = []) => (
  (Array.isArray(path) ? path : []).map((seg) => sanitizeSlug(seg)).join('/')
);

/** LA SECTION où les fichiers d'une expérience se déposent : le dossier Drive
 *  s'appelle `experiment_setup` (« experiment setup » y est slugué par
 *  `resolveDrivePathFromNames`). */
export const EXPERIMENT_SETUP_SECTION = 'Setup';

/** LES SOUS-SECTIONS d'une expérience où ses fichiers se déposent vraiment —
 *  `experiment_setup/Structure` (topologie, .pdb, .cif) et
 *  `experiment_setup/Trajectory` (.xtc, .trr, .dcd). Ce sont les noms que
 *  l'envoi utilise déjà (section `Setup`, sous-section `Structure` /
 *  `Trajectory`, voir MDSections) : le bouton qui crée le dossier de
 *  l'expérience crée donc ces DEUX dossiers-là, pas un dossier vague au-dessus. */
export const EXPERIMENT_FILE_SUBSECTIONS = ['Structure', 'Trajectory'];

/** Le dossier d'UN TYPE de fichier de l'expérience :
 *      <dataset>/projects/<projet>/<expérience>/<instance?>/experiment_setup/<sous-section>
 *  `experimentFolderPathOf` donne la tête (projects/<projet>/<expérience>/
 *  <instance?>), puis la section `experiment_setup` et la sous-section —
 *  EXACTEMENT le chemin qu'un fichier déposé à la main doit avoir pour que les
 *  📂 le retrouvent. Rend [] quand le contexte ne décrit pas une expérience.
 *  PUR. */
export const experimentFileFolderPathOf = (ctx = {}, subsection = '') => {
  const base = experimentFolderPathOf(ctx);
  if (!base.length) return [];
  const sub = canonicalSubSection(subsection);
  if (!sub) return base;
  /* La section est la MÊME que celle de la lecture (`canonicalPageSection`
   * rend l'étiquette « experiment setup ») : le chemin créé et les dossiers
   * que les 📂 cherchent sont donc la MÊME liste, sans conversion
   * supplémentaire. C'est `drivePathText` / `resolveDrivePathFromNames` qui
   * sluguent au moment d'écrire ou d'afficher (« experiment_setup »). */
  return [...base, canonicalPageSection(EXPERIMENT_SETUP_SECTION), sub].filter(Boolean);
};

/** LA SOUS-SECTION où un fichier de l'expérience se dépose, d'après son
 *  extension : une trajectoire va dans `Trajectory`, TOUT LE RESTE (topologie,
 *  structure, modèle) dans `Structure` — les deux dossiers que le geste de
 *  création fabrique et que les 📂 lisent. PUR. */
export const experimentSubsectionForFile = (name = '') => (
  fileHasExt(name, MD_TRAJECTORY_EXTS) ? 'Trajectory' : 'Structure'
);

/** LES DOSSIERS OÙ UN FICHIER DE L'EXPÉRIENCE PEUT DÉJÀ VIVRE — celui que le
 *  geste de création fabrique (`experiment_setup/<sous-section>`) ET celui de la
 *  SECTION de la page (`<section>/<sous-section>` : `data/Structure` pour le
 *  viewer NMR et pour les commandes 3D, `data/Trajectory` pour les mêmes en MD).
 *  Un fichier trouvé dans l'UN OU L'AUTRE est « déjà là » : le geste de copie ne
 *  le redépose pas. PUR. */
export const experimentFileBranches = (ctx = null, subsection = '') => {
  const sub = canonicalSubSection(subsection);
  if (!sub) return [];
  const out = [];
  const push = (path) => {
    if (!Array.isArray(path) || !path.length) return;
    const key = path.join('/');
    if (!out.some((p) => p.join('/') === key)) out.push(path);
  };
  push(experimentFileFolderPathOf(ctx, sub));
  const base = experimentFolderPathOf(ctx);
  const section = canonicalPageSection((ctx && ctx.section) || '');
  if (base.length && section) push([...base, section, sub]);
  return out;
};

/** Le chemin COMPLET tel qu'il s'ÉCRIT sur le Drive : le dossier du DATASET
 *  d'abord, puis les segments —
 *      « My_dataset/projects/CD_project/Exp_1/cond1/experiment_setup/Structure »
 *  C'est le texte que l'interface montre : celui qu'un humain retrouve dans son
 *  navigateur de fichiers, dataset compris (« datasetname/… », la demande).
 *  Le nom du dataset est slugué comme `datasetFolderSlug` le fait pour le
 *  dossier réel. PUR. */
export const fullDrivePathText = (datasetName = '', path = []) => {
  const body = drivePathText(path);
  const ds = String(datasetName || '').trim();
  if (!body) return ds ? datasetFolderSlug(ds) : '';
  return ds ? `${datasetFolderSlug(ds)}/${body}` : body;
};

/** Le PREMIER segment qu'une création n'a PAS pu produire ('' quand la chaîne
 *  est complète) : c'est lui qui est NOMMÉ dans l'échec, au lieu d'un « la
 *  création a échoué » qui ne dit pas où. PUR. */
export const firstMissingSegment = (resolved, path = []) => {
  const got = (resolved && Array.isArray(resolved.path)) ? resolved.path : [];
  const wanted = Array.isArray(path) ? path : [];
  for (let i = 0; i < wanted.length; i += 1) {
    if (!got[i] || !got[i].id) return wanted[i];
  }
  return '';
};

/** Le message d'un échec de création — il DIT ce qui s'est passé : un chemin
 *  supprimé dans le programme (code PATH_DELETED : un dossier effacé n'est
 *  JAMAIS recréé, voir driveMirrorStore), un segment que le Drive n'a pas créé
 *  (tout ce qui est dessous manque aussi), ou l'erreur du fournisseur telle
 *  quelle. PUR. */
export const driveCreateError = (err, path = [], missing = '') => {
  const text = drivePathText(path);
  if (err && err.code === 'PATH_DELETED') {
    return `Drive refuses to recreate “${text}”: this folder was deleted in the program and a deleted folder is never recreated. Restore it in Drive, or give the experiment another name.`;
  }
  if (missing) {
    // Le segment est nommé TEL QU'IL EST ÉCRIT sur le Drive (« experiment setup »
    // → `experiment_setup`) : c'est le nom que l'utilisateur retrouve là-bas.
    return `Google Drive did not create “${sanitizeSlug(missing)}” on the way to “${text}”, so nothing below it exists either. Connect Drive, then press again: a folder that is already there is simply found.`;
  }
  return (err && err.message) || `Google Drive could not create “${text}”.`;
};

/** Un fichier de Drive tel que la LISTE le rend (les octets, eux, se
 *  téléchargent par `driveRestore.downloadCloudFile`). PUR. */
export const experimentFileRecord = (node = {}, folderPath = []) => {
  const path = Array.isArray(folderPath) ? folderPath : [];
  return {
    id: String(node.id || ''),
    name: String(node.name || ''),
    size: Number(node.size || 0),
    modifiedTime: String(node.modifiedTime || ''),
    url: String(node.webViewLink || ''),
    folderPath: path,
    folderPathText: drivePathText(path)
  };
};

/** Le plus RÉCENT d'abord (à défaut, l'ordre alphabétique) : le fichier qu'on
 *  vient de déposer est celui qu'on cherche. PUR. */
export const sortExperimentFiles = (files = []) => [...files].sort((a, b) => {
  const ta = Date.parse(a.modifiedTime || '') || 0;
  const tb = Date.parse(b.modifiedTime || '') || 0;
  if (ta !== tb) return tb - ta;
  return String(a.name || '').localeCompare(String(b.name || ''));
});

/** Taille lisible pour l'interface (« 1.4 GB »). PUR. */
export const describeDriveFileSize = (bytes = 0) => {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
};

/** Le POINTEUR de restauration d'un fichier choisi dans le dossier
 *  (`{ id, name, url }`) : c'est lui qui définit le fichier par défaut d'une
 *  condition et qui le ramène sur un autre poste. PUR. */
export const experimentFilePointer = (file = null) => (
  file && file.id
    ? { id: String(file.id), name: String(file.name || ''), url: String(file.url || '') }
    : null
);

/* ── LA LECTURE ──────────────────────────────────────────────────────────── */

/** Les FICHIERS de l'expérience vus du Drive, par extension.
 *
 *  @param {object}   opts
 *  @param {object}   [opts.ctx]            contexte de nommage (project/test/instance/section/subsection)
 *  @param {object[]} [opts.ctxs]           autres contextes à regarder aussi (branches Setup / Data)
 *  @param {string[]} opts.exts             extensions voulues (voir MD_TOPOLOGY_EXTS…)
 *  @param {number}   [opts.levels]         profondeur de la remontée (défaut 4 : sous-section, section, instance, expérience)
 *  @param {boolean}  [opts.stopWhenFound]  s'arrêter au premier dossier qui porte une correspondance (défaut true)
 *  @param {string[]} [opts.paths]          chemins explicites (test / appelant qui sait déjà où regarder)
 *  @returns {Promise<{paths: string[][], path: string[], folderId: string, files: object[]}>}
 *           `path`/`folderId` = le dossier où les fichiers ont été trouvés (le plus précis) ;
 *           `files` = [] quand il n'y a rien (jamais une erreur : l'appelant le dit à l'écran). */
export const listExperimentFiles = async ({
  ctx = null, ctxs = [], exts = [], levels = 4, stopWhenFound = true, paths = null
} = {}) => {
  const wanted = normalizeFileExts(exts);
  const empty = { paths: [], path: [], folderId: '', files: [] };
  if (!wanted.length || !getDriveToken()) return empty;
  // Nextcloud n'a pas de lecture de dossier par identifiant : on ne fait pas
  // semblant (la reprise par nom reste le chemin de ce fournisseur).
  if (getCloudProvider() === 'nextcloud') return empty;
  const candidates = Array.isArray(paths) && paths.length
    ? paths
    : experimentFolderCandidates({ ctx, ctxs, levels });
  const files = [];
  const seen = new Set();
  let firstPath = null;
  let firstId = '';
  for (const path of candidates) {
    let leafId = '';
    try {
      // CHERCHER, jamais créer : { create: false } (voir driveUpload.resolveDrivePathFromNames).
      const resolved = await resolveDrivePathFromNames(path, { create: false });
      leafId = String((resolved && resolved.leafId) || '');
    } catch { leafId = ''; }
    if (!leafId) continue;                       // dossier absent : rien à lire
    let children = [];
    try { children = await listDriveChildren(leafId); } catch { children = []; }
    const here = [];
    (Array.isArray(children) ? children : []).forEach((node) => {
      if (!node || !node.id) return;
      if (isDriveFolderNode(node)) return;       // un dossier n'est pas un fichier
      if (!fileHasExt(node.name, wanted)) return;
      if (seen.has(String(node.id))) return;     // jamais deux fois le même fichier
      seen.add(String(node.id));
      here.push(experimentFileRecord(node, path));
    });
    if (!here.length) continue;
    if (!firstPath) { firstPath = path; firstId = leafId; }   // le dossier le plus précis
    files.push(...here);
    if (stopWhenFound) break;
  }
  return {
    paths: candidates,
    path: firstPath || [],
    folderId: firstId,
    files: sortExperimentFiles(files)
  };
};

/* ── LA CRÉATION — LE SEUL GESTE QUI FABRIQUE ────────────────────────────── */

/** CRÉER le dossier de l'expérience (le SEUL geste de ce module qui FABRIQUE
 *  quelque chose — et il est EXPLICITE : la lecture, elle, cherche toujours
 *  sans créer, voir listExperimentFiles).
 *
 *  Défaut visé (signalé) : « If the experiment does not exist in drive, allow
 *  me to create it with the correct path », puis, mot pour mot : « for a
 *  trajectory it must be datasetname/projects/projectname/experimentname/
 *  instancename/subsection/file where subsection is experiment_setup/trajectory
 *  for trajectory files and experiment_setup/Structure for pdb files ». Le
 *  dossier de l'expérience ne suffisait donc pas : ce geste crée la CHAÎNE
 *  ENTIÈRE jusqu'aux sous-sections où les fichiers se déposent vraiment
 *  (`experimentFileFolderPathOf` — `<dataset>/projects/<projet>/<expérience>/
 *  <instance?>/experiment_setup/Structure` et `…/experiment_setup/Trajectory`,
 *  les mêmes dossiers que l'envoi et que les 📂 lisent).
 *
 *  Le geste est IDEMPOTENT : `resolveDrivePathFromNames(..., { create: true })`
 *  TROUVE le dossier s'il existe déjà et le crée sinon — jamais de doublon.
 *
 *  Rien n'est promis en l'air : CHAQUE segment créé est VÉRIFIÉ (son
 *  identifiant doit exister) et l'échec NOMME ce qui n'a pas été créé — y
 *  compris le cas d'un chemin supprimé dans le programme (code PATH_DELETED :
 *  un dossier effacé n'est jamais recréé, voir driveMirrorStore). C'est la
 *  réponse au défaut signalé : « This button did not create the folder ».
 *
 *  @param {object}   opts
 *  @param {object}   [opts.ctx]         contexte de nommage de la page (project/test/instance)
 *  @param {string[]} [opts.subsections] sous-sections à créer (défaut :
 *                                       EXPERIMENT_FILE_SUBSECTIONS — Structure ET Trajectory)
 *  @returns {Promise<{ok:boolean, error:string, datasetName:string,
 *                     path:string[], pathText:string, folderId:string, folderUrl:string,
 *                     experimentPath:string[], experimentPathText:string,
 *                     entries:Array<{subsection:string, path:string[], pathText:string,
 *                                    fullText:string, folderId:string, folderUrl:string}>}>}
 *          `ok:false` + `error` quand la création n'a pas pu avoir lieu —
 *          jamais un succès muet ; `entries` porte, pour CHAQUE dossier créé,
 *          son chemin complet (dataset compris) et son lien Drive.
 *  Google Drive et Nextcloud (là, par le MÊME geste que l'envoi :
 *  ncEnsureFolders) ; aucun autre fournisseur. */
/** Le nom du dossier de DATASET ouvert ('' quand il n'y en a pas) : la tête du
 *  chemin, celle que `drivePathText` ne peut pas montrer seul. Impur (lit le
 *  contexte Drive courant). */
const datasetRootName = () => {
  try { return String(getDriveRootName() || '').trim(); } catch { return ''; }
};

export const createExperimentFolder = async ({ ctx = null, subsections = EXPERIMENT_FILE_SUBSECTIONS } = {}) => {
  const experimentPath = experimentFolderPathOf(ctx);
  const experimentPathText = drivePathText(experimentPath);
  const datasetName = datasetRootName();
  /** Une entrée créée : son chemin, son texte COMPLET (dataset compris) et son
   *  lien Drive quand le fournisseur en rend un. */
  const entry = (path, resolved) => {
    const folderId = String((resolved && resolved.leafId) || '');
    return {
      subsection: String(path[path.length - 1] || ''),
      path,
      pathText: drivePathText(path),
      fullText: fullDrivePathText(datasetName, path),
      folderId,
      folderUrl: folderId ? `https://drive.google.com/drive/folders/${folderId}` : ''
    };
  };
  const fail = (error) => ({
    ok: false, error, datasetName,
    path: experimentPath, pathText: experimentPathText, folderId: '', folderUrl: '',
    experimentPath, experimentPathText, entries: []
  });
  const ok = (entries) => ({
    ok: true, error: '', datasetName,
    path: experimentPath, pathText: experimentPathText,
    folderId: (entries[0] && entries[0].folderId) || '',
    folderUrl: (entries[0] && entries[0].folderUrl) || '',
    experimentPath, experimentPathText, entries
  });
  if (!experimentPath.length) {
    return fail('This experiment has no Drive folder yet — the experiment needs a name (and a project) before its folder can be created.');
  }
  /* LES CIBLES — une par sous-section demandée (par défaut `experiment_setup/
   * Structure` ET `experiment_setup/Trajectory` : les dossiers où les .pdb et
   * les .xtc se déposent vraiment). Aucune sous-section demandée ⇒ le dossier
   * de l'expérience seul, pour qu'un appelant sans type de fichier garde un
   * geste qui a un sens. */
  const wanted = (Array.isArray(subsections) ? subsections : [subsections])
    .map((sub) => canonicalSubSection(sub))
    .filter(Boolean);
  const leafs = wanted.length
    ? wanted.map((sub) => experimentFileFolderPathOf(ctx, sub))
    : [experimentPath];
  // Nextcloud : les dossiers s'y créent par WebDAV (le MÊME geste que l'envoi).
  // Non configuré, l'erreur est DITE telle quelle (jamais un faux succès).
  if (getCloudProvider() === 'nextcloud') {
    const entries = [];
    for (const leaf of leafs) {
      try {
        await ncEnsureFolders(leaf);
      } catch (err) {
        return fail((err && err.message) || 'Nextcloud could not create the folders.');
      }
      entries.push(entry(leaf, null));
    }
    return ok(entries);
  }
  if (!getDriveToken()) {
    return fail('Google Drive is not connected in this browser — connect it (sidebar, “Connect Google Drive”) and press again.');
  }
  const entries = [];
  for (const leaf of leafs) {
    let resolved = null;
    try {
      resolved = await resolveDrivePathFromNames(leaf, { create: true });
    } catch (err) {
      return fail(driveCreateError(err, leaf));
    }
    // CHAQUE segment est vérifié : une chaîne créée à moitié (dossier du
    // dataset ou `projects/` indisponible) se DIT, au lieu de passer pour un
    // succès — c'était le défaut signalé (« did not create the folder »).
    const missing = firstMissingSegment(resolved, leaf);
    if (missing) return fail(driveCreateError(null, leaf, missing));
    entries.push(entry(leaf, resolved));
  }
  return ok(entries);
};

/* ── LA COPIE DES FICHIERS — l'autre moitié de « Create drive folder » ──────
   La demande, mot pour mot : « the "Create drive folder" button does not copy
   the files in the folder it creates but this is the most important thing. If
   the folder already exists it should not create another and if the files
   already exist (with the expected names) it should not copy them. »

   Le geste de création ne fabriquait que des DOSSIERS VIDES : il fallait
   ensuite les remplir à la main. Or le poste a DÉJÀ les fichiers — c'est même
   lui qui les montre à l'écran (`NMRMoleculeViewer` : le fichier de structure,
   les molécules annexes reçues avec lui, la trajectoire). Ce geste les COPIE
   donc dans les dossiers qu'il vient de créer :

     • le fichier de structure (`.pdb`, `.cif`, `.gro`…) → `experiment_setup/Structure`
     • la trajectoire (`.xtc`, `.trr`, `.dcd`…)           → `experiment_setup/Trajectory`

   Trois règles, et ce sont celles de la demande :
     1. le dossier visé est CELUI QUE LA CRÉATION VIENT DE RÉSOUDRE (`folders` :
        les entrées de `createExperimentFolder`) — le geste ne fabrique donc
        jamais un dossier de plus ; sans cette liste il résout le chemin
        canonique, toujours avec `create: true` (une résolution qui trouve est
        la règle de l'envoi) ;
     2. le fichier est cherché AVANT d'être envoyé : un fichier du MÊME nom
        attendu, dans l'une des branches de l'expérience (`experiment_setup/
        <sous-section>` et `<section>/<sous-section>` — un fichier déposé hier
        par l'archivage, dans `data/Structure` par exemple), est « déjà là » et
        n'est PAS recopié (`sameRawFileFor` : le nom plus long du Drive, ou le
        nom local, désignent le même fichier) ;
     3. le nom déposé est EXACTEMENT celui de l'archivage
        (`archiveFileDriveName` → `<radical>_<scientifique>.<ext>`) : la
        recherche de ② et l'archivage regardent donc le même nom, et re-presser
        le bouton ne recopie rien.

   Rien n'est promis en l'air : `copied` / `already` / `failed` sont comptés et
   chaque fichier est rendu avec son état, son nom et son lien. */

/** Le nom que PORTERA sur le Drive un fichier déposé par ce geste — celui de
 *  l'archivage, ou celui que l'appelant impose (`name`). PUR. */
export const experimentDepositName = ({ file = null, ctx = null, name = '' } = {}) => (
  String(name || '').trim()
  || archiveFileDriveName({ file, ctx: { ...(ctx || {}) } })
);

/** Une entrée de dépôt normalisée — `{ file, fileName, subsection, name }`, ou
 *  `null` quand il n'y a rien à copier (aucun fichier, ou un fichier sans nom :
 *  un nom est ce sans quoi ni la recherche ② ni l'envoi ne peuvent rien faire).
 *  Accepte aussi un `File` NU (l'appelant qui n'a qu'un fichier à donner). PUR. */
const depositEntryOf = (item = null) => {
  const raw = (item && typeof item === 'object' && item.file) ? item : { file: item };
  const file = raw.file;
  if (!file || typeof file.name !== 'string' || !file.name.trim()) return null;
  return {
    file,
    fileName: String(file.name),
    subsection: canonicalSubSection(raw.subsection || ''),
    name: String(raw.name || '').trim()
  };
};

/** Le fichier DÉJÀ LÀ qui décrit le même fichier que `name` — cherché dans les
 *  branches de l'expérience (`experimentFileBranches`), sans RIEN créer. Rend
 *  `null` quand il n'y est pas (ou quand le Drive ne peut pas être lu : on
 *  n'invente ni une présence ni une absence). */
const existingDepositFor = async ({ ctx = null, subsection = '', name = '' } = {}) => {
  const paths = experimentFileBranches(ctx, subsection);
  const ext = driveFileExt(name);
  if (!paths.length || !name || !ext) return null;
  const listed = await listExperimentFiles({
    paths, exts: [ext], stopWhenFound: false
  }).catch(() => null);
  const files = (listed && listed.files) || [];
  return files.find((f) => sameRawFileFor(f.name, name)) || null;
};

/** Le dossier déjà résolu par la CRÉATION pour une sous-section (`null` s'il n'y
 *  est pas : le dépôt résoudra alors le chemin canonique lui-même). PUR. */
const createdFolderFor = (folders = [], subsection = '') => {
  const sub = canonicalSubSection(subsection);
  if (!sub || !Array.isArray(folders)) return null;
  return folders.find((f) => canonicalSubSection(f && f.subsection) === sub) || null;
};


