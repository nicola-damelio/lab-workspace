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

   Ce module porte AUSSI le seul geste qui FABRIQUE : CRÉER le dossier de
   l'expérience. Il est EXPLICITE (`createExperimentFolder`, appelé par un
   bouton — la demande : « If the experiment does not exist in drive, allow me
   to create it with the correct path »), et il crée la tête commune à TOUS les
   fichiers de l'expérience (`projects/<projet>/<expérience>[/<instance>]`),
   pas la sous-section d'un bouton : la topologie et la trajectoire s'y
   déposent ensuite.

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

import { canonicalExperimentPath, PROJECTS_CONTAINER, sanitizeSlug } from './driveNaming';
import { getCloudProvider, ncEnsureFolders } from './nextcloud';
import { getDriveToken, listDriveChildren, resolveDrivePathFromNames } from './driveUpload';

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
 *  me to create it with the correct path. » Le chemin créé est celui de
 *  l'expérience (`experimentFolderPathOf` — la tête commune à TOUS ses
 *  fichiers), pas la sous-section d'un bouton : la topologie et la trajectoire
 *  se déposent ensuite dans ce même dossier, et les 📂 le liront.
 *
 *  Le geste est IDEMPOTENT : `resolveDrivePathFromNames(..., { create: true })`
 *  TROUVE le dossier s'il existe déjà et le crée sinon — jamais de doublon.
 *
 *  @param {object} opts
 *  @param {object} [opts.ctx] contexte de nommage de la page (project/test/instance)
 *  @returns {Promise<{ok:boolean, path:string[], pathText:string, folderId:string,
 *                     folderUrl:string, error:string}>}
 *          `ok:false` + `error` quand la création n'a pas pu avoir lieu —
 *          jamais un succès muet.
 *  Google Drive et Nextcloud (là, par le MÊME geste que l'envoi :
 *  ncEnsureFolders) ; aucun autre fournisseur. */
export const createExperimentFolder = async ({ ctx = null } = {}) => {
  const path = experimentFolderPathOf(ctx);
  const text = drivePathText(path);
  const fail = (error) => ({ ok: false, path, pathText: text, folderId: '', folderUrl: '', error });
  if (!path.length) {
    return fail('This experiment has no Drive folder yet — the experiment needs a name (and a project) before its folder can be created.');
  }
  // Nextcloud : les dossiers s'y créent par WebDAV. Non configuré, l'erreur
  // est DITE telle quelle (jamais un faux succès).
  if (getCloudProvider() === 'nextcloud') {
    try {
      await ncEnsureFolders(path);
    } catch (err) {
      return fail((err && err.message) || 'Nextcloud could not create the folder.');
    }
    return { ok: true, path, pathText: text, folderId: '', folderUrl: '', error: '' };
  }
  if (!getDriveToken()) {
    return fail('Google Drive is not connected in this browser — connect it (sidebar, “Connect Google Drive”) and press again.');
  }
  let leafId = '';
  try {
    const resolved = await resolveDrivePathFromNames(path, { create: true });
    leafId = String((resolved && resolved.leafId) || '');
  } catch (err) {
    return fail((err && err.message) || 'Google Drive could not create the folder.');
  }
  if (!leafId) return fail('Google Drive did not create the folder — try again in a moment.');
  return {
    ok: true,
    path,
    pathText: text,
    folderId: leafId,
    folderUrl: `https://drive.google.com/drive/folders/${leafId}`,
    error: ''
  };
};


