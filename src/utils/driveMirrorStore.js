/* =========================================================================
   src/utils/driveMirrorStore.js
   LA MÉMOIRE DU MIROIR DRIVE — ce qui a été SUPPRIMÉ et OÙ VIT chaque dossier.

   Deux défauts réparés ici, tous les deux visibles par l'utilisateur :

   1) RIEN NE RESSUSCITE. Un dataset supprimé dans le programme n'était effacé
      que de Firestore et du cache du navigateur : son DOSSIER Drive restait
      (avec ses fichiers) et, sur un autre poste, la copie du cache local ou du
      document le faisait réapparaître dans la liste. La suppression laisse donc
      ici une PIERRE TOMBALE (id du dataset + chemin relatif) que TOUTE lecture
      applique — y compris sur un poste qui n'a jamais vu la suppression, parce
      que la tombe voyage dans le fichier d'état du Drive
      (Lab Workspace/_workspace/state.json, voir workspaceDrive.js).

   2) LE DRIVE SUIT LES RENOMMAGES. Le dossier Drive d'un dataset n'était
      renommé que sur le poste qui avait gardé son identifiant en localStorage :
      ailleurs l'application cherchait le dossier sous son NOUVEAU nom, ne le
      trouvait pas, et en CRÉAIT un second — d'où les dossiers fantômes et un
      contenu différent d'un poste à l'autre. Le registre ci-dessous retient
      l'identifiant Drive de chaque dossier (dataset et projet) et partage lui
      aussi sur le Drive, donc renommer ou supprimer marche depuis n'importe
      quel poste.

   Tout est PUR ici (aucun réseau) : les fonctions reçoivent et rendent un
   « miroir » { tombstones, datasets, projects }, la couche réseau est dans
   driveMirror.js. Vérifié par _drive_mirror_test.mjs.
   ========================================================================= */

import { sanitizeSlug, datasetFolderSlug, DATASET_FOLDER_DIRS } from './driveNaming';

/** Clé localStorage du miroir (tombes + registre des dossiers). */
export const DRIVE_MIRROR_KEY = 'labDriveMirror';

/** Nombre de tombes conservées (les plus récentes). Borné pour qu'un
 *  navigateur utilisé pendant des années ne grossisse pas sans fin ; une
 *  suppression récente n'est jamais oubliée. */
export const MAX_DRIVE_TOMBSTONES = 500;

/** Événement émis à chaque changement : workspaceDrive.js le met en écoute et
 *  programme l'écriture du fichier d'état sur le Drive. */
export const DRIVE_MIRROR_EVENT = 'lab:drive-mirror-changed';

/** Chemin RELATIF au dossier du dataset ('projects/<projet>', 'backups', …).
 *  '' désigne le dossier du dataset lui-même (dataset supprimé en entier). */
export const cleanMirrorPath = (path) => String(path || '')
  .split('/')
  .map((s) => sanitizeSlug(s))
  .filter(Boolean)
  .join('/');

const text = (v) => (v === undefined || v === null ? '' : String(v).trim());

/** Le nom de dossier Drive d'un dataset : le titre slugé, sinon l'id (même
 *  convention que driveUpload.datasetFolderName), sinon '' — auquel cas il n'y
 *  a rien à supprimer ni à renommer. */
export const datasetFolderNameOf = (name, id) => {
  if (text(name)) return datasetFolderSlug(name);
  return text(id) ? `dataset_${sanitizeSlug(id)}` : '';
};

/** Identité d'un dataset dans la mémoire du miroir : son ID quand on le
 *  connaît (deux datasets différents peuvent porter le même titre), son nom
 *  slugé sinon (données historiques). */
export const mirrorDatasetKey = ({ id = '', name = '' } = {}) => {
  const dsId = text(id);
  if (dsId) return `id:${dsId}`;
  if (!text(name)) return '';
  const slug = datasetFolderSlug(name);
  return slug ? `name:${slug}` : '';
};

/** Deux datasets sont-ils le MÊME ? Les identifiants décident quand l'un des
 *  deux en a un : deux datasets peuvent porter le même titre (recréer un dataset
 *  « Pepper viruses » après avoir supprimé l'ancien doit pouvoir créer SON
 *  dossier Drive) — mais un dataset ne peut pas usurper l'identifiant d'un
 *  autre. La comparaison par nom ne sert donc qu'aux données HISTORIQUES, qui
 *  n'ont jamais eu d'identifiant de leur côté. */
const sharesDatasetIdentity = (a, b) => {
  const ida = text(a && a.id);
  const idb = text(b && b.id);
  if (ida || idb) return !!ida && !!idb && ida === idb;
  const na = text(a && a.name) ? datasetFolderSlug(a && a.name) : '';
  const nb = text(b && b.name) ? datasetFolderSlug(b && b.name) : '';
  return !!na && na === nb;
};

const normTombstone = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const id = text(raw.id);
  const name = text(raw.name);
  const path = cleanMirrorPath(raw.path);
  if (!mirrorDatasetKey({ id, name })) return null;
  return {
    id,
    name,
    path,
    kind: text(raw.kind) || (path ? 'folder' : 'dataset'),
    deletedAt: Number(raw.deletedAt) || 0
  };
};

/** Clé d'unicité d'une tombe : dataset + chemin. */
export const driveTombstoneKey = (entry) => {
  const t = normTombstone(entry);
  if (!t) return '';
  return `${mirrorDatasetKey(t)}::${t.path}`;
};

export const emptyDriveMirror = () => ({ v: 1, tombstones: [], datasets: {}, projects: {} });

/** Un miroir propre et utilisable, quelle que soit la source (localStorage d'une
 *  ancienne version, fichier d'état abîmé…). */
export const normalizeDriveMirror = (raw) => {
  const src = raw && typeof raw === 'object' ? raw : {};
  const byKey = new Map();
  (Array.isArray(src.tombstones) ? src.tombstones : []).flat(1).forEach((t) => {
    const entry = normTombstone(t);
    if (!entry) return;
    const key = driveTombstoneKey(entry);
    const prev = byKey.get(key);
    if (!prev || entry.deletedAt >= prev.deletedAt) byKey.set(key, entry);
  });
  const tombstones = Array.from(byKey.values())
    .sort((a, b) => b.deletedAt - a.deletedAt)
    .slice(0, MAX_DRIVE_TOMBSTONES);

  const cleanMap = (map, keep) => {
    const out = {};
    const entries = map && typeof map === 'object' ? Object.entries(map) : [];
    entries.forEach(([key, value]) => {
      const clean = keep(value);
      if (clean) out[String(key)] = clean;
    });
    return out;
  };

  return {
    v: 1,
    tombstones,
    datasets: cleanMap(src.datasets, (v) => (v && text(v.folderId)
      ? { name: text(v.name), folderId: text(v.folderId), at: Number(v.at) || 0 }
      : null)),
    projects: cleanMap(src.projects, (v) => (v && text(v.folderId)
      ? {
        name: text(v.name),
        dataset: text(v.dataset),
        folderId: text(v.folderId),
        /* Le dossier `images` RETENU dans ce dossier de projet. Le Drive peut
           contenir DEUX dossiers du même nom (une recherche qui tombe à côté en
           fabrique un jumeau) : sans cette identité, la résolution reprendrait
           « le premier du nom » et pourrait relire le jumeau vide. */
        imagesId: text(v.imagesId) || '',
        at: Number(v.at) || 0
      }
      : null))
  };
};

/** Deux miroirs (ce poste + le fichier d'état du Drive) → un seul. Les
 *  suppressions s'ADDITIONNENT toujours (une tombe n'est jamais perdue parce
 *  qu'un autre poste ne la connaît pas encore) ; pour le registre des dossiers
 *  l'entrée la PLUS RÉCENTE gagne. */
export const mergeDriveMirrors = (current, incoming) => {
  const a = normalizeDriveMirror(current);
  const b = normalizeDriveMirror(incoming);
  const tombstones = new Map();
  [...a.tombstones, ...b.tombstones].forEach((t) => {
    const key = driveTombstoneKey(t);
    const prev = tombstones.get(key);
    if (!prev || t.deletedAt >= prev.deletedAt) tombstones.set(key, t);
  });
  const newest = (left, right) => {
    const out = { ...left };
    Object.keys(right).forEach((key) => {
      const l = out[key];
      const r = right[key];
      out[key] = !l || (Number(r.at) || 0) >= (Number(l.at) || 0) ? r : l;
    });
    return out;
  };
  return normalizeDriveMirror({
    tombstones: Array.from(tombstones.values()),
    datasets: newest(a.datasets, b.datasets),
    projects: newest(a.projects, b.projects)
  });
};

/** Vrai quand `path` est `base` ou l'un de ses descendants ('' = racine). */
const pathUnder = (path, base) => {
  const p = cleanMirrorPath(path);
  const b = cleanMirrorPath(base);
  return p === b || (!!b && p.indexOf(`${b}/`) === 0);
};

/** Le chemin Drive d'un dossier de PROJET ('projects/<projet>'). */
export const projectFolderPath = (projectName) =>
  `projects/${sanitizeSlug(projectName) || '_unassigned'}`;

/** Le chemin Drive du dossier de PROJET À LA RACINE DU DATASET (« <projet> ») :
 *  c'est là que vivent les DOCUMENTS DE SECTION (<projet>/<section>, voir
 *  driveNaming.projectSectionFolderPath — « 📁 Drive location » de chaque
 *  section de la page projet). Un projet a donc DEUX dossiers sur le Drive, et
 *  supprimer le projet doit emporter les deux : n'en mettre qu'un à la
 *  corbeille laissait l'autre sur le Drive (« si je supprime un projet, son
 *  dossier reste »). */
export const projectRootFolderPath = (projectName) => sanitizeSlug(projectName);

/** Les dossiers Drive d'un projet, du plus imbriqué au plus haut — ceux qu'une
 *  suppression met à la corbeille et qu'une tombstone marque. Le dossier de
 *  SECTION n'y est ajouté que s'il ne porte pas le nom d'un dossier PARTAGÉ du
 *  dataset (« projects », « backups »… : voir DATASET_FOLDER_DIRS) : un projet
 *  ainsi nommé ne doit jamais faire mettre à la corbeille — ni mettre en tombe —
 *  le conteneur commun. */
export const projectFolderPaths = (projectName) => {
  const slug = sanitizeSlug(projectName);
  const paths = [projectFolderPath(projectName)];
  if (slug && !DATASET_FOLDER_DIRS.includes(slug.toLowerCase())) paths.push(slug);
  return paths;
};

/** Une tombe de plus (la plus récente) ; le registre des dossiers situés DANS
 *  le chemin supprimé est oublié au passage : réutiliser l'identifiant d'un
 *  dossier mis à la corbeille ferait écrire dans un dossier invisible. */
export const addDriveTombstone = (
  mirror, { id = '', name = '', path = '', kind = '' } = {}, deletedAt = Date.now()
) => {
  const current = normalizeDriveMirror(mirror);
  const gonePath = cleanMirrorPath(path);
  const entry = normTombstone({
    id, name, path: gonePath, kind: kind || (gonePath ? 'folder' : 'dataset'), deletedAt
  });
  if (!entry) return current;
  const datasetKey = mirrorDatasetKey({ id, name });

  const datasets = {};
  Object.entries(current.datasets).forEach(([key, value]) => {
    if (!gonePath && key === datasetKey) return;             // dataset supprimé en entier
    datasets[key] = value;
  });
  const projects = {};
  Object.entries(current.projects).forEach(([key, value]) => {
    if (!gonePath && key.indexOf(`${datasetKey}::`) === 0) return;
    if (gonePath && projectFolderPaths(value && value.name).some((p) => pathUnder(p, gonePath))) return;
    projects[key] = value;
  });

  return normalizeDriveMirror({
    tombstones: [entry, ...current.tombstones.filter((t) => driveTombstoneKey(t) !== driveTombstoneKey(entry))],
    datasets,
    projects
  });
};

/** Ce dataset a-t-il été supprimé (tombe SANS chemin) ? */
export const isDatasetMirrorDeleted = (mirror, dataset = {}) => {
  const wanted = { id: dataset.id || dataset.datasetId || '', name: dataset.name || dataset.datasetName || '' };
  return normalizeDriveMirror(mirror).tombstones
    .some((t) => !t.path && sharesDatasetIdentity(t, wanted));
};

/** Ce CHEMIN (relatif au dossier du dataset) a-t-il été supprimé — ou l'un de
 *  ses ancêtres, ou le dataset entier ? C'est ce que la couche Drive demande
 *  avant de RECRÉER un dossier : un dossier supprimé ne revient pas. */
export const isDrivePathMirrorDeleted = (mirror, { dataset = {}, path = '' } = {}) => {
  const wanted = { id: dataset.id || dataset.datasetId || '', name: dataset.name || dataset.datasetName || '' };
  const wantedPath = cleanMirrorPath(path);
  return normalizeDriveMirror(mirror).tombstones.some((t) => {
    if (!sharesDatasetIdentity(t, wanted)) return false;
    if (!t.path) return !!wantedPath;             // dataset entier supprimé
    if (!wantedPath) return false;                // la racine n'est pas déduite d'une tombe interne
    return wantedPath === t.path || wantedPath.indexOf(`${t.path}/`) === 0;
  });
};

/** Les ids des datasets supprimés (Set) — pour écarter des copies par id. */
export const deletedDatasetMirrorIds = (mirror) => new Set(
  normalizeDriveMirror(mirror).tombstones.filter((t) => !t.path).map((t) => t.id).filter(Boolean)
);


/* ── Registre des dossiers (identifiants Drive partagés entre les postes) ──── */

const datasetRegistryKey = (dataset = {}) => mirrorDatasetKey({
  id: dataset.id || dataset.datasetId || '',
  name: dataset.name || dataset.datasetName || ''
});

/** `<dataset>::<projet slugé>` — la clé d'un dossier de projet. */
export const projectRegistryKey = (datasetKey, projectName) =>
  `${text(datasetKey)}::${sanitizeSlug(projectName) || '_unassigned'}`;

/** Retenir l'identifiant Drive du dossier d'un dataset. */
export const rememberDatasetFolder = (mirror, { id = '', name = '', folderId = '' } = {}, at = Date.now()) => {
  const key = datasetRegistryKey({ id, name });
  const folder = text(folderId);
  const current = normalizeDriveMirror(mirror);
  if (!key || !folder) return current;
  return normalizeDriveMirror({
    tombstones: current.tombstones,
    datasets: {
      ...current.datasets,
      [key]: { name: text(name), folderId: folder, at: Number(at) || Date.now() }
    },
    projects: current.projects
  });
};

/** Retenir l'identifiant Drive du dossier d'un projet (et, quand on le connaît,
 *  celui de son dossier `images` — deux dossiers du même nom peuvent coexister
 *  sur le Drive, seul l'identifiant tranche : voir figuresFolder.js). */
export const rememberProjectFolder = (mirror, {
  datasetId = '', datasetName = '', projectName = '', folderId = '', imagesId = ''
} = {}, at = Date.now()) => {
  const datasetKey = datasetRegistryKey({ id: datasetId, name: datasetName });
  const folder = text(folderId);
  const current = normalizeDriveMirror(mirror);
  if (!datasetKey || !folder || !sanitizeSlug(projectName)) return current;
  const key = projectRegistryKey(datasetKey, projectName);
  const prev = current.projects[key] || {};
  /* Le dossier du projet n'a pas bougé : son dossier `images` non plus. S'il a
     changé (renommage, réparation), l'ancien identifiant `images` ne vaut plus
     rien — on ne le traîne pas derrière soi. */
  const images = text(imagesId) || (text(prev.folderId) === folder ? text(prev.imagesId) : '');
  return normalizeDriveMirror({
    tombstones: current.tombstones,
    datasets: current.datasets,
    projects: {
      ...current.projects,
      [key]: {
        name: text(projectName),
        dataset: datasetKey,
        folderId: folder,
        imagesId: images,
        at: Number(at) || Date.now()
      }
    }
  });
};

/** Oublier le dossier enregistré d'un projet (renommé, supprimé). */
export const forgetProjectFolder = (
  mirror, { datasetId = '', datasetName = '', projectName = '' } = {}
) => {
  const current = normalizeDriveMirror(mirror);
  const key = projectRegistryKey(datasetRegistryKey({ id: datasetId, name: datasetName }), projectName);
  if (!key || !current.projects[key]) return current;
  const projects = { ...current.projects };
  delete projects[key];
  return normalizeDriveMirror({ tombstones: current.tombstones, datasets: current.datasets, projects });
};

/** L'identifiant Drive du dossier d'un dataset ('' s'il n'a jamais été vu). */
export const findDatasetFolderId = (mirror, dataset = {}) => {
  const current = normalizeDriveMirror(mirror);
  return text((current.datasets[datasetRegistryKey(dataset)] || {}).folderId);
};

/** L'identifiant Drive du dossier d'un projet ('' s'il n'a jamais été vu). */
export const findProjectFolderId = (
  mirror, { datasetId = '', datasetName = '', projectName = '' } = {}
) => {
  const current = normalizeDriveMirror(mirror);
  const key = projectRegistryKey(datasetRegistryKey({ id: datasetId, name: datasetName }), projectName);
  return text((current.projects[key] || {}).folderId);
};

/** L'identifiant Drive du dossier `images` RETENU pour un projet ('' s'il n'a
 *  jamais été désigné : on retombe alors sur la recherche par nom, qui peut
 *  tomber sur un jumeau vide — voir figuresFolder.findProjectFiguresFolder). */
export const findProjectImagesId = (
  mirror, { datasetId = '', datasetName = '', projectName = '' } = {}
) => {
  const current = normalizeDriveMirror(mirror);
  const key = projectRegistryKey(datasetRegistryKey({ id: datasetId, name: datasetName }), projectName);
  return text((current.projects[key] || {}).imagesId);
};

/* ── Lecture / écriture locales + notification ───────────────────────────── */

export const readDriveMirror = () => {
  try {
    const raw = localStorage.getItem(DRIVE_MIRROR_KEY);
    if (!raw) return emptyDriveMirror();
    return normalizeDriveMirror(JSON.parse(raw));
  } catch { return emptyDriveMirror(); }
};

/** Prévient (sans bloquer) que le miroir a changé : le fichier d'état du Drive
 *  est réécrit en différé par workspaceDrive.js (voir flushWorkspaceState). */
export const notifyDriveMirrorChanged = () => {
  try { window.dispatchEvent(new CustomEvent(DRIVE_MIRROR_EVENT)); } catch { /* hors navigateur */ }
};

export const writeDriveMirror = (mirror, { notify = true } = {}) => {
  const clean = normalizeDriveMirror(mirror);
  try { localStorage.setItem(DRIVE_MIRROR_KEY, JSON.stringify(clean)); } catch { /* quota */ }
  if (notify) notifyDriveMirrorChanged();
  return clean;
};

/** Un changement EN MÉMOIRE (sans écrire) : les appelants qui enchaînent
 *  plusieurs opérations n'écrivent qu'une fois. */
export const updateDriveMirror = (fn, { notify = true } = {}) =>
  writeDriveMirror(fn(readDriveMirror()), { notify });
