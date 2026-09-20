/* =========================================================================
   src/utils/workspaceDrive.js
   L'ESPACE DE TRAVAIL ENTIER SUR LE DRIVE — le même contenu sur chaque poste.

   Jusqu'ici le Drive ne portait que des FICHIERS : la liste des datasets, les
   projets, les suppressions et les identifiants de dossiers vivaient dans le
   navigateur (localStorage) et, pour les datasets, dans Firestore. Deux
   conséquences que l'utilisateur voit tout de suite :

     • un dataset créé sur le PC du bureau n'apparaît pas sur le portable ;
     • un dataset supprimé sur un poste revient sur l'autre, et son dossier
       Drive réapparaît.

   Ce module écrit l'espace de travail LUI-MÊME sur le Drive, dans le dossier
   réservé à l'application (jamais mélangé aux données du labo) :

     Lab Workspace/_workspace/state.json               ← l'index + les tombes
     Lab Workspace/_workspace/datasets/<id>.json       ← le CONTENU du dataset

   `state.json` porte : la liste des datasets (titre, sous-titre, genre, date,
   nombre d'expériences, droits), la liste des projets, les pierres tombales
   (datasets ET projets, voir driveMirrorStore.js / projectTombstones.js) et le
   registre des dossiers Drive. Tout poste le relit au démarrage : il voit donc
   les mêmes datasets, les mêmes projets, et il sait ce qui a été supprimé
   AILLEURS (une suppression ne se perd jamais : la tombe gagne toujours).

   `datasets/<id>.json` porte le contenu du dataset tel qu'il part sur Firestore
   (la charge compressée comprise) : sur un poste neuf — ou quand Firestore ne
   répond pas — « ouvrir le dataset » le RECHARGE depuis le Drive.

   Les fonctions pures (construire / lire / fusionner l'état) sont testées hors
   navigateur par _workspace_drive_test.mjs ; les entrées/sorties Drive sont
   BEST-EFFORT et ne lèvent jamais (Drive éteint = on rend null, l'appli
   continue).
   ========================================================================= */

import {
  uploadWorkspaceFile, downloadDriveFileText, ensureLabWorkspaceFolder,
  findFolderByName, findDriveFileByName, cloudBackendAvailable
} from './driveUpload';
import {
  getCloudProvider, nextcloudConfigured, nextcloudDavBase, ncUploadFile, ncFetchBlob
} from './nextcloud';
import { sanitizeSlug } from './driveNaming';
import {
  normalizeDriveMirror, mergeDriveMirrors, DRIVE_MIRROR_EVENT, readDriveMirror, writeDriveMirror
} from './driveMirrorStore';
import { normalizeTombstones } from './projectTombstones';

/** Dossier réservé à l'application (index, contenu des datasets). */
export const WORKSPACE_DIR = '_workspace';
export const WORKSPACE_STATE_FILE = 'state.json';
export const WORKSPACE_DATASETS_DIR = `${WORKSPACE_DIR}/datasets`;
export const WORKSPACE_STATE_KIND = 'lab-workspace/workspace-state';
export const WORKSPACE_STATE_VERSION = 1;

/** Le fichier qui porte le CONTENU d'un dataset : `datasets/ds_<id>.json`. */
export const workspaceDatasetFileName = (id) => `ds_${sanitizeSlug(id) || 'dataset'}.json`;
export const workspaceDatasetPath = (id) => `${WORKSPACE_DATASETS_DIR}/${workspaceDatasetFileName(id)}`;

const text = (v) => (v === undefined || v === null ? '' : String(v).trim());
const clampName = (v, max = 200) => text(v).slice(0, max);

/** Une entrée d'INDEX de dataset : tout ce qui décrit un dataset… sauf son
 *  contenu (il a son propre fichier). `driveFolder` est renseigné quand le
 *  dossier Drive du dataset est connu — il rend le renommage/suppression
 *  possible depuis n'importe quel poste. */
export const workspaceDatasetEntry = (dataset = {}, { driveFolder = '' } = {}) => {
  const id = text(dataset.id);
  if (!id) return null;
  const entry = {
    id,
    title: clampName(dataset.title),
    subtitle: clampName(dataset.subtitle, 300),
    kind: dataset.kind === 'administration' ? 'administration' : 'scientific',
    date: clampName(dataset.date, 40),
    testCount: Number(dataset.testCount) || 0,
    updatedAt: Number(dataset.updatedAt) || 0
  };
  if (dataset.access && typeof dataset.access === 'object') {
    entry.access = {
      restricted: !!dataset.access.restricted,
      memberNames: (Array.isArray(dataset.access.memberNames) ? dataset.access.memberNames : [])
        .map((n) => clampName(n, 120)).filter(Boolean)
    };
  }
  if (driveFolder) entry.driveFolder = text(driveFolder);
  return entry;
};

/** Une entrée d'INDEX de projet : de quoi le LISTER (et savoir qu'il existe)
 *  sans porter tout son texte — le texte voyage dans le document du dataset et
 *  dans <projet>_document.json (voir projectDocumentDrive.js). */
export const workspaceProjectEntry = (project = {}) => {
  const id = text(project.id);
  if (!id) return null;
  let size = 0;
  try { size = JSON.stringify(project).length; } catch { size = 0; }
  return {
    id,
    name: clampName(project.name, 200),
    datasetId: text(project.datasetId),
    scientist: clampName(project.scientist, 120),
    updatedAt: Number(project.updatedAt) || 0,
    size
  };
};


/** localStorage peut être absent (test, SSR) : un miroir vide suffit. */
const readDriveMirrorSafe = () => {
  try { return readDriveMirror(); } catch { return null; }
};

/** L'état complet, prêt à être écrit sur le Drive. PUR. */
export const buildWorkspaceState = ({
  datasets = [], projects = [], mirror = null, deletedProjects = [], at = new Date().toISOString()
} = {}) => {
  const folders = normalizeDriveMirror(mirror || readDriveMirrorSafe());
  const datasetEntries = (Array.isArray(datasets) ? datasets : [])
    .map((d) => workspaceDatasetEntry(d, {
      driveFolder: text((folders.datasets[`id:${text(d && d.id)}`] || {}).folderId)
    }))
    .filter(Boolean);
  const projectEntries = (Array.isArray(projects) ? projects : [])
    .map(workspaceProjectEntry)
    .filter(Boolean);
  return {
    kind: WORKSPACE_STATE_KIND,
    v: WORKSPACE_STATE_VERSION,
    savedAt: at,
    datasets: datasetEntries,
    projects: projectEntries,
    deletedProjects: normalizeTombstones(deletedProjects),
    mirror: folders
  };
};

/** Un état lu (fichier abîmé, version inconnue, fichier étranger) → un état
 *  normalisé, ou null quand ce n'est PAS un état d'espace de travail. */
export const parseWorkspaceState = (raw) => {
  let data = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return null;
    try { data = JSON.parse(s); } catch { return null; }
  }
  if (!data || typeof data !== 'object') return null;
  if (data.kind && data.kind !== WORKSPACE_STATE_KIND) return null; // fichier étranger
  const datasets = (Array.isArray(data.datasets) ? data.datasets : [])
    .map((d) => workspaceDatasetEntry(d, { driveFolder: d && d.driveFolder }))
    .filter(Boolean);
  const projects = (Array.isArray(data.projects) ? data.projects : [])
    .map((p) => (p && p.id ? {
      id: text(p.id),
      name: clampName(p.name, 200),
      datasetId: text(p.datasetId),
      scientist: clampName(p.scientist, 120),
      updatedAt: Number(p.updatedAt) || 0,
      size: Number(p.size) || 0
    } : null))
    .filter(Boolean);
  return {
    kind: WORKSPACE_STATE_KIND,
    v: Number(data.v) || WORKSPACE_STATE_VERSION,
    savedAt: text(data.savedAt),
    datasets,
    projects,
    deletedProjects: normalizeTombstones(data.deletedProjects),
    mirror: normalizeDriveMirror(data.mirror)
  };
};

/** Fusion de deux états (ce poste + le Drive) : les datasets des deux côtés sans
 *  doublon (le plus récemment modifié décrit), les tombes ADDITIONNÉES. PUR. */
export const mergeWorkspaceStates = (local, remote) => {
  const empty = { datasets: [], projects: [], deletedProjects: [], mirror: null, savedAt: '' };
  const a = parseWorkspaceState(local) || empty;
  const b = parseWorkspaceState(remote) || empty;
  const pick = (listA, listB) => {
    const out = new Map();
    [...listA, ...listB].forEach((entry) => {
      const prev = out.get(entry.id);
      if (!prev || (Number(entry.updatedAt) || 0) >= (Number(prev.updatedAt) || 0)) out.set(entry.id, entry);
    });
    return Array.from(out.values());
  };
  return {
    kind: WORKSPACE_STATE_KIND,
    v: WORKSPACE_STATE_VERSION,
    savedAt: String(a.savedAt) > String(b.savedAt) ? a.savedAt : b.savedAt,
    datasets: pick(a.datasets, b.datasets),
    projects: pick(a.projects, b.projects),
    deletedProjects: normalizeTombstones([...a.deletedProjects, ...b.deletedProjects]),
    mirror: mergeDriveMirrors(a.mirror, b.mirror)
  };
};

/** La liste des datasets d'un poste, COMPLÉTÉE par celle du Drive : les datasets
 *  connus du Drive mais absents ici sont ajoutés (`fromDrive: true`, leur
 *  contenu sera relu du Drive à l'ouverture), jamais ceux qui ont une tombe.
 *  Le tri (plus récent d'abord) est celui de l'écran d'accueil. PUR. */
export const applyWorkspaceIndex = ({ datasets = [], state = null, mirror = null } = {}) => {
  const folders = normalizeDriveMirror(mirror || (state && state.mirror) || null);
  const index = parseWorkspaceState(state) || { datasets: [] };
  const deleted = new Set(folders.tombstones.filter((t) => !t.path).map((t) => text(t.id)).filter(Boolean));
  const out = [];
  const seen = new Set();
  (Array.isArray(datasets) ? datasets : []).forEach((d) => {
    const id = text(d && d.id);
    if (!id || seen.has(id) || deleted.has(id)) return;
    seen.add(id);
    const indexed = index.datasets.find((e) => e.id === id) || null;
    // Le Drive COMPLÈTE la copie locale (droits, dossier) sans la contredire :
    // c'est ce poste qui vient d'écrire son contenu.
    out.push(indexed ? {
      ...indexed,
      ...d,
      updatedAt: Number(d.updatedAt) || Number(indexed.updatedAt) || 0,
      driveFolder: text(d.driveFolder) || text(indexed.driveFolder)
    } : d);
  });
  index.datasets.forEach((entry) => {
    if (seen.has(entry.id) || deleted.has(entry.id)) return;
    seen.add(entry.id);
    out.push({
      id: entry.id,
      title: entry.title,
      subtitle: entry.subtitle,
      kind: entry.kind,
      date: entry.date,
      testCount: entry.testCount,
      updatedAt: entry.updatedAt,
      access: entry.access,
      driveFolder: entry.driveFolder,
      fromDrive: true
    });
  });
  return out.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
};


/* ── Entrées / sorties Drive (best-effort : jamais d'exception) ────────────── */

/** Le JSON part toujours avec la même en-tête : relire un état écrit par une
 *  autre version reste possible (parseWorkspaceState tolère l'inconnu). */
export const workspaceStateJson = (state) => JSON.stringify(state, null, 2);

/** Vrai quand un backend cloud peut recevoir l'état (Drive connecté — y
 *  compris le mode « espace partagé » du serveur de jetons — ou Nextcloud
 *  configuré). */
export const workspaceBackendReady = () => {
  try {
    if (getCloudProvider() === 'nextcloud') return nextcloudConfigured();
    return !!cloudBackendAvailable();
  } catch { return false; }
};

const ncWorkspaceUrl = (segments = []) => {
  const base = nextcloudDavBase();
  if (!base) return '';
  const parts = ['Lab Workspace', ...segments].map((s) => encodeURIComponent(s));
  return `${base}/${parts.join('/')}`;
};

const uploadJson = async ({ folder, name, body }) => {
  return uploadWorkspaceJson({ folder, name, body });
};

/** Déposer un JSON dans `Lab Workspace/<folder>/<name>` (Drive ou Nextcloud),
 *  en écrasant la version précédente. Best-effort : `null` si rien n'a pu être
 *  écrit. Exporté pour les autres mémoires de l'espace de travail
 *  (workspaceKeyStore.js), afin qu'il n'existe qu'UN chemin d'écriture. */
export const uploadWorkspaceJson = async ({ folder, name, body }) => {
  const blob = typeof Blob === 'undefined' ? body : new Blob([body], { type: 'application/json' });
  if (getCloudProvider() === 'nextcloud') {
    if (!nextcloudConfigured()) return null;
    const parts = ['Lab Workspace', ...String(folder).split('/').filter(Boolean).map((s) => sanitizeSlug(s))];
    const res = await ncUploadFile({ parts, name, mimeType: 'application/json', file: blob });
    return res ? { id: String(res.id), name, url: String(res.webLink || res.url || '') } : null;
  }
  const res = await uploadWorkspaceFile({ name, mimeType: 'application/json', file: blob, folder });
  return res && res.id ? { id: String(res.id), name } : null;
};

const downloadJsonText = async ({ folder, name }) => {
  return downloadWorkspaceJsonText({ folder, name });
};

/** Relire un JSON déposé par l'application dans `Lab Workspace/<folder>/<name>`
 *  ('' si Drive éteint, dossier ou fichier absent). Exporté pour les autres
 *  mémoires de l'espace de travail (workspaceKeyStore.js). */
export const downloadWorkspaceJsonText = async ({ folder, name }) => {
  if (getCloudProvider() === 'nextcloud') {
    if (!nextcloudConfigured()) return '';
    const url = ncWorkspaceUrl([...String(folder).split('/').filter(Boolean), name]);
    if (!url) return '';
    const blob = await ncFetchBlob(url);
    return blob ? blob.text() : '';
  }
  const workspaceId = await ensureLabWorkspaceFolder();
  if (!workspaceId) return '';
  let folderId = workspaceId;
  for (const seg of String(folder).split('/')) {
    if (!seg.trim()) continue;
    folderId = await findFolderByName(seg.trim(), folderId);
    if (!folderId) return ''; // dossier absent : rien à lire (et rien à créer)
  }
  const fileId = await findDriveFileByName(name, folderId);
  if (!fileId) return '';
  return downloadDriveFileText(fileId);
};

/** L'état de l'espace de travail tel qu'il est SUR LE DRIVE (null si Drive
 *  éteint, fichier absent ou illisible — l'appelant garde alors sa copie). */
export const readWorkspaceState = async () => {
  try {
    if (!workspaceBackendReady()) return null;
    const raw = await downloadJsonText({ folder: WORKSPACE_DIR, name: WORKSPACE_STATE_FILE });
    return parseWorkspaceState(raw);
  } catch (err) {
    console.warn('Reading the Drive workspace state failed:', err && err.message);
    return null;
  }
};

/** Écrire l'état sur le Drive (écrase le précédent). null = non écrit. */
export const writeWorkspaceState = async (state) => {
  try {
    const parsed = parseWorkspaceState(state);
    if (!parsed || !workspaceBackendReady()) return null;
    return await uploadJson({
      folder: WORKSPACE_DIR,
      name: WORKSPACE_STATE_FILE,
      body: workspaceStateJson(parsed)
    });
  } catch (err) {
    console.warn('Writing the Drive workspace state failed:', err && err.message);
    return null;
  }
};

/** Taille maximale d'un contenu de dataset déposé sur le Drive (les figures
 *  sont déjà exclues de la charge enregistrée ; au-delà, Firestore et
 *  l'instantané HTML font foi). Un dépassement est DIT (voir writeDatasetCopy) :
 *  une copie Drive manquante ne doit jamais être silencieuse — c'est elle qui
 *  rend un dataset (et ses calculs) lisible sur un autre poste. */
export const MAX_DATASET_COPY_BYTES = 8 * 1024 * 1024;

/** Écrire le CONTENU d'un dataset sur le Drive (`_workspace/datasets/…`) : la
 *  copie qui rend un dataset lisible sur un poste neuf (ou quand Firestore ne
 *  répond pas). Best-effort. */
export const writeDatasetCopy = async (record = {}) => {
  try {
    const id = text(record.id);
    if (!id || !workspaceBackendReady()) return null;
    const body = JSON.stringify({ kind: WORKSPACE_STATE_KIND, at: new Date().toISOString(), record }, null, 2);
    if (body.length > MAX_DATASET_COPY_BYTES) {
      // Best-effort, mais pas silencieux : sans ce fichier, un poste neuf n'a
      // aucune copie de contenu à relire.
      console.warn(
        `Dataset copy is too large for the Drive mirror (${body.length} > ${MAX_DATASET_COPY_BYTES} bytes): ` +
        'the Firestore document and the HTML snapshot remain the reference.'
      );
      return null;
    }
    return await uploadJson({
      folder: WORKSPACE_DATASETS_DIR, name: workspaceDatasetFileName(id), body
    });
  } catch (err) {
    console.warn('Mirroring the dataset content to Drive failed:', err && err.message);
    return null;
  }
};

/** Relire le contenu d'un dataset déposé sur le Drive (null si absent). */
export const readDatasetCopy = async (id) => {
  try {
    if (!text(id) || !workspaceBackendReady()) return null;
    const raw = await downloadJsonText({ folder: WORKSPACE_DATASETS_DIR, name: workspaceDatasetFileName(id) });
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const record = parsed && parsed.record;
    if (!record || text(record.id) !== text(id)) return null; // fichier d'un autre dataset
    return record;
  } catch (err) {
    console.warn('Reading the Drive copy of a dataset failed:', err && err.message);
    return null;
  }
};


/* ── Écriture automatique, en différé ─────────────────────────────────────── */

/**
 * Installer la réécriture automatique de l'état sur le Drive :
 *   • à chaque changement du miroir (suppression, renommage, dossier retenu) ;
 *   • à chaque fois que l'appelant signale un changement (`schedule()`), par
 *     exemple quand la liste des datasets ou les projets bougent.
 * Les écritures sont REGROUPÉES (une seule requête après `delay` ms de calme) :
 * taper dans un titre ne déclenche pas cinquante envois.
 * @returns {() => void} désinstallation
 */
export const installWorkspaceAutosave = (getState, { delay = 2000 } = {}) => {
  let timer = null;
  let lastWritten = '';
  let stopped = false;
  const flush = async () => {
    if (stopped) return null;
    try {
      const state = buildWorkspaceState(getState() || {});
      const json = workspaceStateJson(state);
      if (json === lastWritten) return null;
      const res = await writeWorkspaceState(state);
      if (res) lastWritten = json;
      return res;
    } catch (err) {
      console.warn('Workspace autosave failed:', err && err.message);
      return null;
    }
  };
  const schedule = () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; flush(); }, Math.max(200, Number(delay) || 2000));
  };
  const onMirror = () => schedule();
  try { window.addEventListener(DRIVE_MIRROR_EVENT, onMirror); } catch { /* hors navigateur */ }
  // Un premier envoi est programmé dès l'installation : l'état de ce poste
  // part sur le Drive même si rien ne bouge ensuite (la liste vient d'arriver
  // de Firestore / du cache, et le Drive doit la connaître).
  schedule();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    try { window.removeEventListener(DRIVE_MIRROR_EVENT, onMirror); } catch { /* ignore */ }
  };
};

/** Adopter l'état lu sur le Drive : les tombes (suppressions faites ailleurs,
 *  sur cet espace de travail) rejoignent celles de ce poste et y sont écrites,
 *  pour que l'application les applique immédiatement — c'est ce qui empêche un
 *  dataset supprimé sur un poste de revenir sur un autre. */
export const adoptWorkspaceState = (state) => {
  const parsed = parseWorkspaceState(state);
  const mirror = mergeDriveMirrors(readDriveMirrorSafe(), parsed ? parsed.mirror : null);
  try { writeDriveMirror(mirror, { notify: false }); } catch { /* ignore */ }
  return {
    mirror,
    datasets: parsed ? parsed.datasets : [],
    deletedProjects: parsed ? parsed.deletedProjects : []
  };
};
