/* =========================================================================
   src/utils/driveUpload.js
   Uploads locally-chosen files to the user's Google Drive, automatically
   renamed with the app's naming convention, and organised into FOLDERS that
   mirror the app schema (project / test / section / instance).

   How it works:
     1. The Google sign-in requests the "drive.file" OAuth scope (files the
        app creates only — nothing else is touched). The resulting Google
        access token is stored in localStorage.
     2. uploadLocalFile() PUTs the file to the Drive API (multipart upload)
        into the leaf folder of the app-schema path (creating every missing
        folder along the way). Everything lives inside the app's "Lab Workspace"
        folder → a folder named after the main file (the dataset) →
        <project>/<test>/<instance>/<section>/…
     3. The file is shared as "anyone with the link" so the app can display
        it (thumbnails/embed) and others can open it.
     4. When a project / test / instance / section / protocol is renamed, the
        matching Drive FOLDER is renamed too (never recreated); when a test is
        added to a project its WHOLE Drive folder is moved into the project
        folder (no duplicate); deleting a test removes its Drive folder (all of
        its files). The Drive tree mirrors the program.

   Everything degrades gracefully: if no Drive token is available the caller
   still receives the file as a data URL (temporary in-app attachment).
   ========================================================================= */

// Tolerant data:URL → bytes (base64 OR percent-encoded — the saved figures of the
// VECTOR charts are the latter: 'data:image/svg+xml;charset=utf-8,' +
// encodeURIComponent(xml)). An unconditional atob() on that payload is what made
// every SVG figure fail its Drive upload with "Failed to execute 'atob' on
// 'Window'…" and stay browser-only; see utils/dataUrlBytes.
import { dataUrlToBytes, dataUrlMime } from './dataUrlBytes';
/* La boucle « toutes les pages » (voir driveListPages.js) : `listDriveChildren`
   ne s'arrête plus au premier millier d'enfants — un dossier `projects/` un peu
   fourni en contient davantage, et ce qui suit la première page « disparaissait »
   de la liste affichée. */
import { MAX_DRIVE_LIST_PAGES, collectDrivePages } from './driveListPages';

export { MAX_DRIVE_LIST_PAGES } from './driveListPages';

const TOKEN_KEY = 'labDriveAccessToken';
const TOKEN_EXPIRY_KEY = 'labDriveAccessTokenExpiresAt';
/* Les clés de la mémoire des dossiers (`labDriveFolders`, et l'ancienne mémoire
   unique `labDriveFolderId` / `labDriveFolderDatasetId` / `labDriveFolderName`)
   vivent dans utils/driveFolderAnchor.js : c'est LÀ que se décide à quel dataset
   appartient un dossier retenu, et qu'un dossier d'un autre dataset est refusé. */

/* Les créations de dossier EN VOL, par (parent, nom) — voir folderRace.js : deux
   envois simultanés vers le MÊME dossier partagent désormais une seule création
   au lieu d'en fabriquer deux (les jumeaux d'instance constatés sur le Drive
   réel le 20/09/2026, expérience NMR du projet p53H : `Exp_7` ×2, `Exp_19` ×2…). */
const folderCreations = new Map();

/**
 * Google's OAuth access tokens expire after ~1 hour. We store the expiry time
 * (from the token response) and treat an expired token as "not connected", so
 * the UI shows "Connect Drive" again instead of looking connected while every
 * request fails.
 */
export const getDriveToken = () => {
  try {
    const token = localStorage.getItem(TOKEN_KEY) || '';
    if (!token) return '';
    const exp = parseInt(localStorage.getItem(TOKEN_EXPIRY_KEY) || '0', 10);
    if (exp && Date.now() > exp) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_EXPIRY_KEY);
      // The token expired while the page was open. Google can usually issue a
      // fresh one SILENTLY after the first consent (no password needed), so
      // try to heal automatically and only show "disconnected" if that fails.
      renewDriveTokenSilently().then((ok) => {
        if (ok) notifyDriveConnected();
        else notifyDriveDisconnected();
      });
      return '';
    }
    return token;
  } catch { return ''; }
};

export const setDriveToken = (token, expiresInSec) => {
  const hadToken = !!(() => { try { return localStorage.getItem(TOKEN_KEY); } catch { return ''; } })();
  try {
    localStorage.setItem(TOKEN_KEY, String(token || ''));
    if (expiresInSec && expiresInSec > 0) {
      // Keep ~5 minutes of grace before Google actually rejects the token.
      localStorage.setItem(TOKEN_EXPIRY_KEY, String(Date.now() + (expiresInSec - 300) * 1000));
    } else {
      localStorage.removeItem(TOKEN_EXPIRY_KEY);
    }
  } catch { /* ignore */ }
  if (token && !hadToken) notifyDriveConnected();
  scheduleAutoDriveRenew();
};

export const clearDriveToken = () => {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
  } catch { /* ignore */ }
};
import { suggestDriveFileName, sanitizeSlug, driveFolderPath, DATASET_FOLDER_DIRS, DEFAULT_PROJECT_NAME, datasetFolderSlug, canonicalPageSection, canonicalExperimentPath, canonicalizeExperimentPath, projectNamesOf } from './driveNaming';
/* ⛔ LE GARDE-FOU DE LA RACINE DU DATASET : un chemin dont le premier segment
   est le nom d'un PROJET est routé sous `projects/<projet>/…` au lieu d'être
   créé à côté (voir utils/driveStray.js — la cause du dossier « au nom d'un
   projet en dehors du dossier Projects », signalée trois fois). */
import { guardProjectHead } from './driveStray';
import {
  readDriveMirror, writeDriveMirror, rememberDatasetFolder, rememberProjectFolder,
  rememberDatasetDir, findDatasetDirId, findDatasetFolderId,
  isDatasetMirrorDeleted, isDrivePathMirrorDeleted
} from './driveMirrorStore';
/* LA MÉMOIRE DES DOSSIERS DE DATASET — TENUE PAR DATASET (voir le bandeau de
   utils/driveFolderAnchor.js) : l'identifiant retenu pour un dataset ne peut pas
   servir à un autre, et un dossier n'est utilisé que s'il est VIVANT et qu'il
   porte le nom du dataset. C'est ce qui empêche les fichiers d'un dataset de
   partir dans le dossier d'un autre (le dossier `GEC-UPJV-pp` du Drive réel). */
import {
  datasetFolderEntry, rememberDatasetFolderEntry, forgetDatasetFolderEntry, folderUseDecision
} from './driveFolderAnchor';
import { pickCanonicalFolder, emptyTwinIds, isCanonicalDatasetDir } from './datasetDirTwins';
import { oncePerFolder, folderCreateKey } from './folderRace';
import { getCloudProvider, nextcloudConfigured, ncUploadFile } from './nextcloud';
/* L'ENVOI DES GROS FICHIERS PAR MORCEAUX (session « resumable ») : au-delà de
   `RESUMABLE_MIN_BYTES`, une seule requête multipart n'a aucun point de reprise —
   une trajectoire MD de plusieurs Go arrivait alors « à moitié » (l'arborescence
   créée, le fichier absent : voir driveChunkUpload.js). */
import { shouldChunkUpload, uploadBlobInChunks } from './driveChunkUpload';
import {
  enqueuePendingUpload, removePendingUpload, listPendingUploads,
  touchPendingUpload, notifyPendingChanged,
  MAX_SINGLE_BYTES, MAX_PENDING_AGE_MS
} from './pendingUploads';

/** The name of the currently open dataset folder ('' when none is open). */
export const getDriveRootName = () => driveRootName;

/** True when the currently selected cloud provider is ready to accept files:
 *  • Google Drive → an OAuth token is available
 *  • Nextcloud → server URL + username + app password are configured
 */
export const cloudBackendAvailable = () => {
  if (getCloudProvider() === 'nextcloud') return nextcloudConfigured();
  // Shared workspace mode: the server mints short-lived tokens on demand for
  // every browser, so Drive is reachable without a personal Google login.
  if (sharedWorkspaceMode()) return true;
  return !!getDriveToken();
};

/** Verify the stored token really works against the Drive API (the scope can be silently missing). */
export const testDriveAccess = async () => {
  if (!getDriveToken()) return false;
  try {
    const res = await driveFetch('/drive/v3/files?pageSize=1&fields=files(id)');
    await res.json();
    return true;
  } catch { return false; }
};

/** Folder id the app uploads into — POUR LE DATASET OUVERT. La mémoire est tenue
 *  PAR DATASET (utils/driveFolderAnchor.js) : l'identifiant retenu pour un
 *  dataset ne peut pas servir à un autre, même si l'on passe de l'un à l'autre
 *  plus vite que le rendu ne se termine. */
export const getDriveFolderId = () => datasetFolderEntry(folderStore(), driveRootId).id;

/** Retenir le dossier du dataset OUVERT (les autres datasets gardent le leur). */
export const setDriveFolderId = (id) => { rememberDriveFolder({ id: String(id || '') }); };

/** La mémoire du navigateur, ou null (jamais d'exception : la navigation privée
 *  n'empêche pas d'envoyer — elle prive seulement de la mémoire du dossier). */
const folderStore = () => {
  try { return (typeof localStorage !== 'undefined' && localStorage) ? localStorage : null; } catch { return null; }
};

/** Retenir l'identifiant et/ou le nom du dossier du dataset OUVERT. */
const rememberDriveFolder = ({ id, name } = {}) => {
  const current = datasetFolderEntry(folderStore(), driveRootId);
  return rememberDatasetFolderEntry(folderStore(), driveRootId, {
    id: id === undefined ? current.id : id,
    name: name === undefined ? current.name : name
  });
};

/** Read a File as a data URL (the "temporary in-app" copy). */
export const readFileAsDataURL = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('Could not read file'));
    r.readAsDataURL(file);
  });

/** Append the original file's extension to a base name. */
export const withExtension = (baseName, originalName) => {
  const m = /(\.[a-zA-Z0-9]+)$/.exec(String(originalName || ''));
  return m ? `${String(baseName).replace(/\.\w+$/, '')}${m[1]}` : baseName;
};

const throwCode = (code, message) => {
  const e = new Error(message || code);
  e.code = code;
  throw e;
};

/** Convert a data URL into a Blob (for the multipart upload body). */
export const dataUrlToBlob = (dataUrl) => {
  const type = dataUrlMime(dataUrl) || 'application/octet-stream';
  return new Blob([dataUrlToBytes(dataUrl)], { type });
};

export const driveFetch = async (path, opts = {}) => {
  let token = getDriveToken();
  // Shared workspace mode: a browser may legitimately have NO token yet (first
  // page load before the background mint finished, or the hourly token expired
  // while the workspace server was briefly unreachable). Mint one on demand —
  // Drive must never be unusable just because "nobody logged in".
  if (!token && sharedWorkspaceMode()) {
    await renewDriveTokenSilently();
    token = getDriveToken();
  }
  if (!token) throwCode('NO_TOKEN', 'Google Drive is not connected.');

  // A corrupted token string (control chars, line breaks, …) makes the
  // Authorization header invalid and the browser silently rejects the whole
  // request with "Failed to fetch". Detect it and force a clean reconnect.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(token)) {
    clearDriveToken();
    notifyDriveDisconnected();
    throwCode('BAD_TOKEN', 'The stored Google Drive token is invalid — reconnect Google Drive from the sidebar.');
  }

  // Fast interactive requests (metadata, listing, small uploads) use a 20 s
  // timeout. Large UPLOADS (trajectory files, videos, backups) pass an explicit
  // much longer timeout — a big .xtc can take minutes to transfer and must not
  // be aborted after 20 seconds. File-content DOWNLOADS (`alt=media`) get the
  // same long timeout by default, since the bytes are streamed as the response.
  const isFileDownload = typeof path === 'string' && path.includes('alt=media');
  const { timeout: timeoutMs = isFileDownload ? 10 * 60 * 1000 : 20000, accept = null, ...rest } = opts;
  /* UN CHEMIN ABSOLU EST UTILISÉ TEL QUEL : l'URL d'une session d'envoi
     « resumable » est rendue par Drive dans l'en-tête `Location` et ne se
     reconstruit pas (elle porte un `upload_id`). Les appels ordinaires — chemins
     relatifs — sont préfixés comme avant. */
  const isAbsolute = typeof path === 'string' && /^https?:\/\//i.test(path);
  const url = isAbsolute ? path : `https://www.googleapis.com${path}`;
  /* `accept` : des statuts NON-ok qui ont un sens ici — 308 pendant un envoi
     par morceaux (« le morceau est passé, la session continue »). Ils ne sont
     donc pas convertis en erreur (voir driveChunkUpload.js). */
  const accepted = Array.isArray(accept) ? accept : [];

  const perform = async (tok, attempt) => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetch(url, {
        ...rest,
        signal: controller ? controller.signal : undefined,
        headers: { Authorization: `Bearer ${tok}`, ...(rest.headers || {}) }
      });
    } catch (e) {
      // Transient network blip: retry ONCE (with a fresh token) before giving up.
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 800));
        const fresh = getDriveToken() || (await renewDriveTokenSilently() ? getDriveToken() : '');
        if (fresh) return perform(fresh, 1);
      }
      const msg = (e && e.name === 'AbortError')
        ? 'Google Drive request timed out — check your connection and try again.'
        : `Cannot reach Google Drive (${e && e.message ? e.message : 'network error'}). Check your internet connection, VPN/proxy or ad-blocker.`;
      throwCode('NETWORK', msg);
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    if (res.status === 401) {
      // The token expired or was revoked server-side. Try to renew it SILENTLY
      // and replay the request once — users should never have to reconnect
      // manually just because the hourly token expired.
      if (attempt === 0) {
        clearDriveToken();
        const ok = await renewDriveTokenSilently();
        if (ok) {
          notifyDriveConnected();
          const fresh = getDriveToken();
          if (fresh) return perform(fresh, 1);
        }
        notifyDriveDisconnected();
      } else {
        // A retry with a freshly renewed token still got 401 → permanently
        // revoked; let the UI offer the normal reconnection.
        notifyDriveDisconnected();
      }
      throwCode('TOKEN_EXPIRED', 'Drive access expired — please reconnect Google Drive.');
    }
    if (res.status === 403) {
      throwCode('TOKEN_EXPIRED', 'Google Drive denied the request (scope or permissions). Please reconnect Google Drive from the sidebar.');
    }
    if (!res.ok && !accepted.includes(res.status)) {
      let msg = `Drive error (HTTP ${res.status})`;
      try {
        const j = await res.json();
        msg = (j && j.error && j.error.message) || msg;
      } catch { /* keep default */ }
      throwCode('DRIVE_ERROR', msg);
    }
    return res;
  };

  return perform(token, 0);
};

// ── Dataset folder inside "Lab Workspace" ──────────────────────────────────
// The whole workspace is saved as ONE main file (the dataset) whose title the
// user can edit in the sidebar. On Drive every folder the app creates lives
// inside the app's "Lab Workspace" root folder, under a major folder named
// after the dataset:
//     <Lab Workspace>/<dataset title>/<project>/<test>/<section>/…
// When the dataset title changes, the dataset folder is renamed in place so
// every already-uploaded file follows.

let driveRootId = '';            // dataset id the root folder belongs to
let driveRootName = '';          // desired dataset folder name ('' → Lab Workspace root)
let driveRootKind = 'scientific'; // 'scientific' | 'administration' (folder layout choice)

/** LES DOSSIERS VÉRIFIÉS DANS CETTE SESSION (dataset → nom vérifié). Le contrôle
 *  du dossier retenu — UNE requête : est-il vivant, et porte-t-il bien le nom de
 *  ce dataset ? (voir driveFolderAnchor.folderUseDecision) — coûte une fois par
 *  dataset et par session, jamais à chaque envoi. Il est refait dès que le TITRE
 *  change, puisque c'est le nom qui est vérifié. */
const verifiedFolderNames = new Map();
const folderVerified = (name) => !!driveRootId && verifiedFolderNames.get(driveRootId) === name;
const markFolderVerified = (name) => { if (driveRootId) verifiedFolderNames.set(driveRootId, name); };
/** Abandonner le dossier retenu du dataset ouvert (à la corbeille, ou portant le
 *  nom d'un autre dataset) — et lui SEUL : les autres datasets gardent le leur. */
const forgetDriveFolder = () => {
  if (!driveRootId) return;
  verifiedFolderNames.delete(driveRootId);
  forgetDatasetFolderEntry(folderStore(), driveRootId);
};

/** Sub-directories that may exist directly inside a dataset folder. Scientific
 *  datasets keep the canonical five-folder tree (projects / backups / protocols
 *  / storage / publications). An ADMINISTRATION dataset only needs its own
 *  `backups` folder (weekly HTML snapshots) and the `Budget_labo` container
 *  created by the expense/Document filing helpers — never projects, protocols,
 *  storage or publications (which belong to the scientific datasets only). */
const datasetDirNames = () =>
  driveRootKind === 'administration'
    ? ['backups', 'Budget_labo']
    : DATASET_FOLDER_DIRS;

/** Tell the Drive layer which main file (dataset) is currently open, so the
 *  dataset folder on Drive (inside "Lab Workspace") is named after it, and
 *  which internal folder layout it expects (`kind` = 'scientific' |
 *  'administration').
 *
 *  ⛔ APPELÉ PENDANT LE RENDU (App.jsx), PAS DANS UN `useEffect` : un envoi part
 *  d'un GESTE, donc avant les effets ; posé après le rendu, le contexte laissait
 *  l'envoi viser le dossier du dataset PRÉCÉDENT — c'est ainsi que des fichiers
 *  d'un dataset se sont retrouvés dans le dossier d'un autre.
 *
 *  Passer d'un dataset à l'autre n'EFFACE plus rien : chaque dataset a SA mémoire
 *  de dossier (utils/driveFolderAnchor.js), donc le dossier du précédent reste le
 *  sien et ne peut pas servir au suivant. */
export const setDriveRootContext = ({ id = '', name = '', kind = '' } = {}) => {
  const nextId = String(id || '');
  const nextName = String(name || '').trim();
  const nextKind = kind === 'administration' ? 'administration' : 'scientific';
  if (nextId === driveRootId && nextName === driveRootName && nextKind === driveRootKind) return;
  driveRootId = nextId;
  driveRootName = nextName;
  if (nextKind) driveRootKind = nextKind;
};

/** L'id du dataset ouvert — le dossier d'un dataset sur le Drive est ancré
 *  dessus (voir datasetFolderName), donc les helpers qui cherchent un dossier
 *  DÉJÀ existant en ont besoin pour retrouver le même ancrage que les envois
 *  (voir utils/figuresFolder.js). */
export const getDriveRootId = () => driveRootId;

/** Which dataset the CURRENT Drive context points to (for the pending-upload
 *  queue: an upload enqueued while dataset A was open must be flushed into
 *  dataset A's folder even if the user has opened dataset B in the meantime). */
export const getDriveRootAnchor = () => ({
  datasetId: driveRootId,
  rootFolderId: getDriveFolderId(),
  kind: driveRootKind
});

export const findLabWorkspaceFolder = async () => {
  if (!getDriveToken()) return '';
  let containerId = '';
  try {
    const { getDriveFolderUrl } = await import('./driveNaming');
    containerId = extractDriveFolderId(getDriveFolderUrl());
  } catch { /* ignore */ }
  try {
    if (containerId) return await findFolderByName('Lab Workspace', containerId);
    const q = encodeURIComponent(
      "name='Lab Workspace' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    );
    const res = await driveFetch(`/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=10`);
    const j = await res.json();
    const list = (Array.isArray(j.files) ? j.files : []).filter((f) => f && f.name === 'Lab Workspace');
    return list.length ? String(list[0].id) : '';
  } catch { return ''; }
};

/** Find (or create) the app's "Lab Workspace" root folder (inside the user's
 *  saved Drive folder URL if one is set, otherwise at the Drive root). */
export const ensureLabWorkspaceFolder = async () => {
  let containerId = '';
  try {
    const { getDriveFolderUrl } = await import('./driveNaming');
    containerId = extractDriveFolderId(getDriveFolderUrl());
  } catch { /* ignore */ }

  if (containerId) {
    const id = await findFolderByName('Lab Workspace', containerId);
    if (id) return id;
    return findOrCreateFolder('Lab Workspace', containerId);
  }

  // Otherwise find (or create) "Lab Workspace" at the Drive root. UNE SEULE
  // création à la fois ici aussi (folderRace.js) : sur une installation neuve,
  // deux envois simultanés fabriquaient DEUX « Lab Workspace » à la racine du
  // Drive — même défaut que les jumeaux d'instance du NMR.
  return oncePerFolder(folderCreations, folderCreateKey('Lab Workspace', 'root'), async () => {
    const q = encodeURIComponent(
      "name='Lab Workspace' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    );
    const res = await driveFetch(`/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=10`);
    const j = await res.json();
    const existing = (j.files || []).find((f) => f.name === 'Lab Workspace');
    if (existing) return existing.id;

    const c = await driveFetch('/drive/v3/files?fields=id,name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Lab Workspace', mimeType: 'application/vnd.google-apps.folder' })
    });
    const created = await c.json();
    return created.id;
  });
};

/* Combien de PAGES une énumération de dossier suit avant de s'arrêter : la
   valeur vit dans driveListPages.js (MAX_DRIVE_LIST_PAGES) et c'est elle qui
   est ré-exportée ici — une seule définition pour tout le dépôt. */

/** List immediate children (files AND folders) of a Drive folder, EN SUIVANT
 *  `nextPageToken` — TOUTES les pages, pas seulement les mille premiers
 *  éléments. Un dossier `projects/` un peu fourni dépasse 1000 entrées : s'y
 *  arrêter ferait « disparaître » des projets parfaitement présents (c'est la
 *  question à laquelle « Resync from Drive » doit répondre). Renvoie aussi
 *  combien de pages ont été lues et si l'énumération s'est arrêtée AVANT la fin
 *  (`truncated`) — jamais de troncature silencieuse. */
export const listDriveChildrenDetailed = async (parentId, { maxPages = MAX_DRIVE_LIST_PAGES } = {}) => {
  if (!parentId || !getDriveToken()) return { files: [], pages: 0, truncated: false, errors: 0 };
  const q = encodeURIComponent(`'${parentId}' in parents and trashed=false`);
  /* Une page du Drive, telle quelle : `collectDrivePages` lit `files` et
     `nextPageToken` (voir driveListPages.js). */
  const page = await collectDrivePages(async (pageToken) => {
    const url = `/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,size,webViewLink)`
      + `&pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await driveFetch(url);
    return res.json();
  }, { maxPages });
  return { files: page.files, pages: page.pages, truncated: page.truncated, errors: page.errors };
};

/** List immediate children (files AND folders) of a Drive folder. */
export const listDriveChildren = async (parentId, opts = {}) =>
  (await listDriveChildrenDetailed(parentId, opts)).files;

/**
 * Les instantanés HTML (sauvegardes) du dataset actuellement ouvert, du plus
 * récent au plus ancien — ils vivent dans
 * <Lab Workspace>/<dataset>/backups/. Sert à RÉCUPÉRER les papiers d'une
 * ancienne version sans recharger tout le fichier (voir Publications →
 * « Recover papers »). Le dossier est cherché, jamais créé : si le dataset n'a
 * pas encore de sauvegarde, la liste est vide.
 */
export const listDatasetBackups = async () => {
  if (!getDriveToken()) return [];
  try {
    const rootId = await ensureDriveFolder();
    if (!rootId) return [];
    const backupsId = (await canonicalDatasetDirId('backups', { rootId, create: false }).catch(() => ''))
      || await findFolderByName('backups', rootId);
    if (!backupsId) return [];
    const items = await listDriveChildren(backupsId);
    return items
      .filter((f) => /\.html?$/i.test(String(f.name || '')))
      .map((f) => ({ id: f.id, name: f.name || '', size: Number(f.size || 0), webViewLink: f.webViewLink || '' }))
      .sort((a, b) => String(b.name).localeCompare(String(a.name)));
  } catch { return []; }
};

/** Contenu TEXTE d'un fichier de Drive créé par l'application (un instantané
 *  HTML relu par la fenêtre « Recover papers »). Passe par le jeton OAuth :
 *  seuls les fichiers de l'application sont accessibles (portée drive.file). */
export const downloadDriveFileText = async (fileId) => {
  if (!fileId) return '';
  const res = await driveFetch(`/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`);
  return res.text();
};

/** Ensure the sub-directories a dataset folder needs exist inside it.
 *  Scientific datasets get the canonical five-folder tree
 *  (projects/backups/protocols/storage/publications); an administration
 *  dataset only gets its own `backups` + `Budget_labo` containers (the
 *  budget-document helpers create Budget_labo/<year>/… on demand).
 *  For an administration base the empty legacy scientific containers
 *  (projects / protocols / storage / publications) possibly left behind by
 *  older app versions are trashed — they are never created any more, and a
 *  non-empty folder is always kept untouched.
 *  Returns the {name → id} map of the created folder structure. */
export const ensureDatasetFolderStructure = async (datasetRootId, dirs = null) => {
  const map = {};
  if (!datasetRootId || !getDriveToken()) return map;
  const list = Array.isArray(dirs) && dirs.length ? dirs : datasetDirNames();
  for (const dir of list) {
    /* Un dossier SUPPRIMÉ dans le programme ne se recrée pas : sans ce test,
       ouvrir le dataset refaisait « projects/ » (ou « backups/ »…) juste après
       sa suppression — le dossier semblait réapparaître tout seul. */
    if (datasetDirDeleted(dir)) { map[dir] = ''; continue; }
    try {
      /* Chaque conteneur canonique passe par le résolveur UNIQUE : il retient
         l'identifiant, départage les JUMEAUX par leur contenu et range les
         jumeaux vides à la corbeille — au lieu de « le premier du nom ». */
      map[dir] = await canonicalDatasetDirId(dir, { rootId: datasetRootId });
    } catch { map[dir] = ''; }
  }
  if (driveRootKind === 'administration') {
    const SCIENTIFIC_ONLY = ['projects', 'protocols', 'storage', 'publications'];
    try {
      const children = await listDriveChildren(datasetRootId);
      for (const child of children) {
        if (!child || child.mimeType !== 'application/vnd.google-apps.folder') continue;
        if (SCIENTIFIC_ONLY.indexOf(child.name) === -1) continue;
        const inside = await listDriveChildren(child.id);
        if (inside.length > 0) continue; // only empty leftovers are removed
        await driveFetch(`/drive/v3/files/${child.id}?fields=id`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trashed: true })
        });
      }
    } catch { /* hygiene is best-effort */ }
  }
  return map;
};

/** Best-effort workspace-root hygiene:
 *  1. A root-level "backups" folder (old shared backup location) is trashed
 *     once empty.
 *  2. A root-level dataset folder named "<dataset>_<idTag>" (legacy weekly
 *     backup layout) is trashed — its current dataset/backups backup was just
 *     written to the canonical dataset folder by the caller.
 *  Never touches anything else under Lab Workspace. */
export const cleanupWorkspaceRootFolders = async ({ legacyFolderNames = [], skipTrashIfNonEmpty = true } = {}) => {
  const workspaceId = await ensureLabWorkspaceFolder();
  if (!workspaceId || !getDriveToken()) return;
  const names = new Set(['backups', ...legacyFolderNames.map((s) => String(s || '').trim()).filter(Boolean)]);
  const children = await listDriveChildren(workspaceId);
  for (const child of children) {
    if (!child || child.mimeType !== 'application/vnd.google-apps.folder') continue;
    if (!names.has(child.name)) continue;
    try {
      if (skipTrashIfNonEmpty) {
        const inside = await listDriveChildren(child.id);
        if (inside.length > 0) continue;
      }
      await driveFetch(`/drive/v3/files/${child.id}?fields=id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true })
      });
    } catch { /* keep the folder on failure */ }
  }
};

/** The Drive folder name of the open dataset ('' only when NO dataset is open).
 *  While a dataset is open its folder is ALWAYS used: an unknown title (not
 *  loaded yet / cleared) used to fall back to the "Lab Workspace" root, which
 *  dropped uploads BESIDE the dataset folders — mixed with every other dataset,
 *  outside the folder the app backs up and restores. Such a dataset is anchored
 *  on its id instead (`dataset_<id>`), and renamed to `<title>` as soon as the
 *  title is known (see the rename branch of ensureDriveFolder). */
const datasetFolderName = () => {
  if (driveRootName) return datasetFolderSlug(driveRootName);
  return driveRootId ? `dataset_${sanitizeSlug(driveRootId)}` : '';
};

/** Le dossier `dir` du dataset COURANT (au sens de son dossier Drive) a-t-il été
 *  SUPPRIMÉ dans le programme ? Dans ce cas il n'est jamais recréé : c'est ce
 *  qui met fin aux dossiers qui « réapparaissent » après une suppression
 *  (voir driveMirrorStore.js). */
const datasetDirDeletedFor = (dir, datasetId = '', datasetName = '') => {
  try {
    return isDrivePathMirrorDeleted(readDriveMirror(), {
      dataset: { id: datasetId || driveRootId, name: datasetName || driveRootName }, path: dir
    });
  } catch { return false; }
};

const datasetDirDeleted = (dir) => datasetDirDeletedFor(dir);

/** Le dataset COURANT a-t-il été supprimé ? (un dataset supprimé ne voit pas
 *  son dossier Drive renaître). */
const currentDatasetDeleted = () => {
  try {
    return !!driveRootId
      && isDatasetMirrorDeleted(readDriveMirror(), { id: driveRootId, name: driveRootName });
  } catch { return false; }
};

/** Noter l'identifiant Drive du dossier d'un dataset (registre partagé sur le
 *  Drive : sans lui, un autre poste ne peut ni renommer ni supprimer ce dossier
 *  et en crée un second). Best-effort. */
const rememberDatasetFolderId = (folderId, name) => {
  try {
    if (!driveRootId || !folderId) return;
    writeDriveMirror(rememberDatasetFolder(readDriveMirror(), {
      id: driveRootId, name: name || driveRootName, folderId
    }));
  } catch { /* la mémoire du miroir est un confort, pas une condition */ }
};

/** Le dossier d'un dataset tel que le DRIVE le décrit ({ id, name, trashed }),
 *  ou null quand le Drive n'a PAS répondu (hors ligne, jeton expiré, droits) :
 *  un silence ne doit pas faire perdre le dossier retenu — il ne doit pas non
 *  plus faire écrire au hasard (voir folderUseDecision). */
const driveFolderMetaOrNull = async (folderId) => {
  if (!folderId) return null;
  try { return await getDriveFileMeta(folderId); } catch { return null; }
};

/** ADOPTER un dossier comme étant celui du dataset OUVERT : il est retenu (pour
 *  ce dataset-là seulement), noté dans le registre partagé (donc valable depuis
 *  n'importe quel poste), et il reçoit la structure interne du dataset. */
const adoptDatasetFolder = async (folderId, name) => {
  if (!folderId) return '';
  rememberDriveFolder({ id: folderId, name });
  markFolderVerified(name);
  rememberDatasetFolderId(folderId, name);
  if (name) await ensureDatasetFolderStructure(folderId).catch(() => {});
  return folderId;
};

/** LE DOSSIER RETENU POUR LE DATASET OUVERT, s'il est UTILISABLE — vérifié une
 *  fois par dataset et par session. Rend '' quand il n'y a rien de sûr :
 *  l'appelant cherche alors ailleurs (registre partagé, nom, création), au lieu
 *  d'écrire dans un dossier qui n'est pas celui de ce dataset. */
const anchoredDatasetFolderId = async (name) => {
  const entry = datasetFolderEntry(folderStore(), driveRootId);
  if (!entry.id) return '';
  if (!name) return entry.id;                 // rien d'ouvert : la racine de l'espace
  if (folderVerified(name)) return entry.id;   // déjà vérifié dans cette session
  if (!getDriveToken()) return entry.id;       // Drive muet : on ne juge rien
  const meta = await driveFolderMetaOrNull(entry.id);
  /* Renommer ne fabrique jamais un JUMEAU : on ne regarde s'il existe un dossier
     au bon nom QUE sur ce chemin-là (une requête, une fois par session). */
  const real = (meta && !meta.trashed) ? String(meta.name || '') : '';
  let twinExists = false;
  if (real && real !== name && entry.name && real === entry.name) {
    const workspaceId = await ensureLabWorkspaceFolder().catch(() => '');
    twinExists = !!(workspaceId && await findFolderByName(name, workspaceId));
  }
  const decision = folderUseDecision({ entry, wanted: name, meta, twinExists });
  if (decision.action === 'use') {
    markFolderVerified(name);
    rememberDatasetFolderId(entry.id, name);
    if (name) await ensureDatasetFolderStructure(entry.id).catch(() => {});
    return entry.id;
  }
  if (decision.action === 'rename') {
    try {
      await renameDriveFile(entry.id, name);
      return await adoptDatasetFolder(entry.id, name);
    } catch { /* le renommage a échoué : on ne se rabat pas sur un dossier douteux */ }
  }
  /* ABANDON : dossier à la corbeille, ou portant le nom d'un AUTRE dataset (le
     `GEC-UPJV-pp` du Drive réel). On l'oublie — lui seul — et on repart du nom :
     écrire dedans, c'est ranger les fichiers d'un dataset chez un autre. */
  forgetDriveFolder();
  return '';
};

/** Le dossier du dataset ouvert tel que le REGISTRE PARTAGÉ le connaît : la clé
 *  est l'IDENTIFIANT du dataset, donc ce dossier-là est le sien, d'où qu'on
 *  vienne — et il suit un titre changé depuis un autre poste. Vérifié avant
 *  usage, comme le dossier retenu : un dossier à la corbeille n'est jamais
 *  réutilisé. Rend '' s'il n'y a rien de sûr. */
const registeredDatasetFolderId = async (name) => {
  if (!driveRootId || !name) return '';
  let registered = '';
  try { registered = findDatasetFolderId(readDriveMirror(), { id: driveRootId, name: driveRootName }); }
  catch { registered = ''; }
  if (!registered) return '';
  const meta = await driveFolderMetaOrNull(registered);
  /* Le registre l'affirme : ce dossier appartient à ce dataset. Un titre changé
     se renomme donc EN PLACE (tous les fichiers déjà dedans suivent). */
  const decision = folderUseDecision({ entry: { id: registered, name }, wanted: name, meta });
  if (decision.action === 'use') return adoptDatasetFolder(registered, name);
  if (decision.action === 'rename') {
    try {
      await renameDriveFile(registered, name);
      return await adoptDatasetFolder(registered, name);
    } catch { return ''; }
  }
  return '';
};
/** Resolve the upload root folder: "Lab Workspace" → the dataset folder inside
 *  it (when the dataset has a title). The dataset folder ALWAYS gets its own
 *  internal structure — the canonical five-folder tree for scientific datasets
 *  (projects/backups/protocols/storage/publications), or only backups +
 *  Budget_labo for an administration dataset — so uploads and weekly backups
 *  share one dataset directory and scientific folders are never created inside
 *  an administration base.
 *
 *  ⛔ IL N'EST JAMAIS ÉCRIT DANS LE DOSSIER D'UN AUTRE DATASET. Trois étapes, et
 *  toutes passent par l'IDENTIFIANT du dataset ouvert :
 *    1. le dossier RETENU POUR CE DATASET (vérifié : vivant, et à son nom) ;
 *    2. le REGISTRE PARTAGÉ (state.json), clé = identifiant du dataset ;
 *    3. le NOM sous « Lab Workspace », puis la création — un dossier existant au
 *       bon nom est toujours préféré à un nouveau. */
export const ensureDriveFolder = async () => {
  const name = datasetFolderName();
  /* UN DOSSIER SUPPRIMÉ NE REVIENT PAS : si le dataset a été supprimé dans le
     programme (voir driveMirror.js / App.jsx), on ne recrée pas son dossier
     Drive. C'est ce qui laissait une arborescence fantôme après une
     suppression. */
  if (currentDatasetDeleted()) return '';

  const anchored = await anchoredDatasetFolderId(name);
  if (anchored) return anchored;

  const registered = await registeredDatasetFolderId(name);
  if (registered) return registered;

  const workspaceId = await ensureLabWorkspaceFolder();
  if (!workspaceId) return '';

  let rootId = workspaceId;
  if (name) {
    rootId = await findFolderByName(name, workspaceId);
    if (!rootId) rootId = await findOrCreateFolder(name, workspaceId);
  }
  return await adoptDatasetFolder(rootId, name);
};

// ── App-schema FOLDER helpers ─────────────────────────────────────────────
// Files are organised on Drive inside folders that mirror the app schema:
//   <project>/<test>/<instance>/<section>/<file>
//   protocols/<protocol>/<file>
// The app only ever touches folders it created itself (drive.file scope).

/** Escape a value for a Drive files.list `q` query. */
const escapeDriveQuery = (v) => String(v || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** TOUS les dossiers appartenant à l'application qui portent EXACTEMENT ce nom
 *  dans `parentId` (le Drive peut en contenir plusieurs : des JUMEAUX).
 *  Un ÉCHEC de recherche REMONTE (quota 403, 5xx, délai) : c'est la seule façon
 *  de ne jamais confondre « le Drive n'a pas répondu » avec « le dossier n'existe
 *  pas » — cette confusion fabriquait un second `projects/` à côté du premier
 *  (voir datasetDirTwins.js et docs/DRIVE-MIRROR.md). */
export const listFoldersByName = async (name, parentId) => {
  if (!name || !parentId) return [];
  const q = encodeURIComponent(
    `name='${escapeDriveQuery(name)}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const res = await driveFetch(`/drive/v3/files?q=${q}&fields=files(id,name,createdTime)&pageSize=100`);
  const j = await res.json();
  return (Array.isArray(j.files) ? j.files : []).filter((f) => f && f.name === name);
};

/** Le dossier CANONIQUE parmi des JUMEAUX : celui qui PORTE du contenu (à
 *  contenu égal le plus ancien — l'arborescence d'origine, même règle que
 *  datasetDirTwins.js). La question ne se pose que si le Drive porte plusieurs
 *  dossiers du même nom (voir folderRace.js) : leurs contenus sont alors lus
 *  STRICTEMENT. Sans ce départage, « le premier du nom » était rendu dans un
 *  ordre que Drive ne garantit pas — les fichiers d'une expérience se rangeaient
 *  donc tantôt dans un jumeau, tantôt dans l'autre. */
const canonicalTwinOf = async (folders) => {
  const list = Array.isArray(folders) ? folders : [];
  if (list.length <= 1) return list[0] || null;
  const scored = [];
  for (const f of list) {
    let items = null;
    try { items = await strictChildCount(f.id); } catch { items = null; }
    scored.push({ id: f.id, name: f.name, createdTime: f.createdTime || '', items });
  }
  return pickCanonicalFolder(scored) || list[0];
};

/** Find an existing app-created folder by exact name inside `parentId` ('' if missing). */
export const findFolderByName = async (name, parentId) => {
  try {
    const all = await listFoldersByName(name, parentId);
    const keep = await canonicalTwinOf(all);
    return keep ? String(keep.id) : '';
  } catch { return ''; }
};

/** Find an existing app-created file by exact name inside `parentId` ('' if missing). */
export const findDriveFileByName = async (name, parentId) => {
  if (!name || !parentId) return '';
  try {
    const q = encodeURIComponent(
      `name='${escapeDriveQuery(name)}' and '${parentId}' in parents and trashed=false`
    );
    const res = await driveFetch(`/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=10`);
    const j = await res.json();
    const found = (j.files || []).find((f) => f.name === name);
    return found ? String(found.id) : '';
  } catch { return ''; }
};

/** Fetch a Drive file's id + name (+ its PARENT folders: `parents` dit dans quel
 *  dossier le fichier vit VRAIMENT — c'est ce que lit le déplacement d'une image
 *  de bibliothèque d'une portée à l'autre, voir figuresLibrary.moveLibraryItemOnDrive).
 *  Only files the app created are readable under the drive.file scope — external
 *  files throw and should be skipped. */
export const getDriveFileMeta = async (fileId) => {
  if (!fileId) throw new Error('No file id');
  const res = await driveFetch(`/drive/v3/files/${fileId}?fields=id,name,trashed,parents`);
  const meta = await res.json();
  if (!meta || !meta.id) throw new Error('File not found');
  return {
    id: String(meta.id), name: String(meta.name || ''), trashed: Boolean(meta.trashed),
    parents: Array.isArray(meta.parents) ? meta.parents.map(String) : []
  };
};

/** Restore a trashed Drive file (e.g. after the user deleted its old folder —
 *  the file survives in the trash and can be moved back into a visible folder). */
export const untrashDriveFile = async (fileId) => {
  if (!fileId) return false;
  try {
    const res = await driveFetch(`/drive/v3/files/${fileId}?fields=id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: false })
    });
    await res.json();
    return true;
  } catch (err) {
    console.warn('Could not restore trashed Drive file:', err && err.message);
    return false;
  }
};

/** Find a folder or create it (app-owned) inside `parentId`.
 *  La RECHERCHE est STRICTE : si le Drive ne répond pas (quota 403, 5xx, délai),
 *  l'échec remonte au lieu de passer pour « le dossier n'existe pas ». Sans
 *  cela, un `projects/` déjà présent était recréé à côté du premier — les
 *  jumeaux `projects`/`protocols` constatés sur le Drive réel le 19/09/2026.
 *
 *  UNE SEULE création à la fois par (parent, nom) — RECHERCHE COMPRISE (voir
 *  folderRace.js) : l'import Bruker archive les fichiers bruts pendant que la
 *  copie de référence du spectre du NMR 1D part vers le MÊME dossier (les deux
 *  « cherchaient puis créaient »), ce qui posait DEUX dossiers du même nom sous
 *  le même parent — les jumeaux d'instance constatés le 20/09/2026
 *  (`projects/p53H/NMR_p53H/Exp_7/` et `/Exp_7/`, `Exp_19` ×2, `Structure` ×2).
 *  Entre plusieurs jumeaux DÉJÀ présents, c'est le canonique qui est rendu
 *  (celui qui porte du contenu), donc les fichiers cessent de s'éparpiller. */
export const findOrCreateFolder = async (name, parentId) => oncePerFolder(
  folderCreations,
  folderCreateKey(name, parentId),
  async () => {
    const all = await listFoldersByName(name, parentId);
    if (all.length) return String((await canonicalTwinOf(all)).id);
    const c = await driveFetch('/drive/v3/files?fields=id,name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId]
      })
    });
    const created = await c.json();
    if (!created || !created.id) throwCode('DRIVE_ERROR', 'Drive returned no folder.');
    return String(created.id);
  }
);

/** Nombre d'éléments d'un dossier, lu STRICTEMENT : `null` quand le Drive ne
 *  répond pas. Un contenu inconnu n'est jamais « vide » — donc jamais rangé à la
 *  corbeille (voir datasetDirTwins.js). */
const strictChildCount = async (folderId) => {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const res = await driveFetch(`/drive/v3/files?q=${q}&fields=files(id)&pageSize=1000`);
  const j = await res.json();
  return Array.isArray(j.files) ? j.files.length : null;
};

/** Noter l'identifiant Drive d'un conteneur canonique dans le registre partagé
 *  (il voyage dans _workspace/state.json, donc vaut sur tous les postes).
 *  Best-effort : la mémoire du miroir est un confort, pas une condition. */
const rememberDatasetDirId = (folderId, dir, datasetId = '', datasetName = '') => {
  try {
    if (!folderId || !dir) return;
    writeDriveMirror(rememberDatasetDir(readDriveMirror(), {
      datasetId: datasetId || driveRootId,
      datasetName: datasetName || driveRootName,
      dir,
      folderId
    }));
  } catch { /* confort */ }
};

/** Le conteneur canonique `dir` d'un dataset (`projects`, `backups`,
 *  `protocols`, `storage`, `publications`) — UN SEUL, toujours le même :
 *
 *   1. l'identifiant RETENU dans le registre partagé, s'il est encore vivant ;
 *   2. sinon les JUMEAUX portant ce nom : `pickCanonicalFolder` retient celui
 *      qui PORTE du contenu (à contenu égal le plus ancien — c'est
 *      l'arborescence d'origine), il est noté par identifiant, et les jumeaux
 *      connus VIDES partent à la corbeille (best-effort, jamais un jumeau
 *      rempli ni de contenu inconnu) ;
 *   3. sinon création — jamais si le dossier a été supprimé dans le programme,
 *      et jamais quand `create:false` (lecture seule).
 *
 *  @param {string} dir nom du conteneur
 *  @param {{rootId?:string,datasetId?:string,datasetName?:string,create?:boolean,cleanup?:boolean}} options
 *  `rootId` évite un `ensureDriveFolder()` inutile (et la récursion quand on
 *  vient de `ensureDatasetFolderStructure`).
 *  @returns {Promise<string>} l'identifiant du conteneur ('' si introuvable). */
export const canonicalDatasetDirId = async (dir, {
  rootId = '', datasetId = '', datasetName = '', create = true, cleanup = true
} = {}) => {
  const name = String(dir || '').trim();
  if (!name) return '';
  const scope = {
    datasetId: datasetId || driveRootId,
    datasetName: datasetName || driveRootName,
    dir: name
  };
  /* 1. L'identité retenue : elle suit un renommage et ne tombe jamais sur un
     jumeau, contrairement à une recherche par nom. */
  const remembered = findDatasetDirId(readDriveMirror(), scope);
  if (remembered) {
    const meta = await getDriveFileMeta(remembered).catch(() => null);
    if (meta && meta.id && !meta.trashed) return remembered;
  }
  const parent = rootId || await ensureDriveFolder();
  if (!parent) return '';

  // 2. TOUS les jumeaux (une recherche qui échoue remonte ici — rien n'est créé).
  const twins = await listFoldersByName(name, parent);
  if (!twins.length) {
    if (!create || datasetDirDeletedFor(name, scope.datasetId, scope.datasetName)) return '';
    const made = await findOrCreateFolder(name, parent);
    rememberDatasetDirId(made, name, scope.datasetId, scope.datasetName);
    return made;
  }

  const scored = [];
  for (const twin of twins) {
    let items = null;
    try { items = await strictChildCount(twin.id); } catch { items = null; }
    scored.push({ id: String(twin.id), createdTime: twin.createdTime || '', items });
  }
  const keep = pickCanonicalFolder(scored);
  if (!keep) return '';
  rememberDatasetDirId(keep.id, name, scope.datasetId, scope.datasetName);

  if (cleanup && scored.length > 1) {
    for (const twinId of emptyTwinIds(scored, keep.id)) {
      try { await trashDriveFile(twinId); } catch { /* hygiène, au mieux */ }
    }
  }
  return keep.id;
};

/** Resolve the folder chain described by explicit folder NAMES (each sanitized;
 *  empty segments skipped). Creates the missing folders — unless `create:false`,
 *  in which case the chain is only SEARCHED: it stops at the first missing
 *  segment and `leafId` is '' (nothing is invented below). C'est ce que demande
 *  un geste de RANGEMENT : déplacer des fichiers déjà envoyés ne doit jamais
 *  fabriquer d'arborescence — sans cela, un chemin recalculé à chaque frappe
 *  (renommer une boîte laissait « j », « ja », « jac » derrière soi) créait un
 *  dossier par lettre (voir storageDrive.tidyStorageFiles).
 *  @param {string[]} names
 *  @param {{create?: boolean}} [opts]
 *  @returns {{ leafId:string, path:Array<{name:string,id:string}> }} */
export const resolveDrivePathFromNames = async (names, { create = true } = {}) => {
  /* ⛔ LE GARDE-FOU POSÉ DANS L'ENTONNOIR — voir utils/driveStray.js.
     C'est ICI que le dossier fautif naissait : cette fonction CRÉE chaque
     segment du chemin qu'on lui donne, en ne traitant spécialement que le
     premier — et seulement s'il est un conteneur canonique. Un chemin
     explicite resté en forme historique (`[<projet>, <expérience>, …]`), un
     appelant qui assemble son tableau à la main ou une file d'envois rejouée
     faisait donc naître `<dataset>/<projet>/…`, à côté de `projects/`.
     Corriger les constructeurs de chemins un par un n'a jamais suffi (c'est la
     troisième fois que le défaut est signalé) : le refus est donc posé ici, au
     seul endroit par lequel TOUT envoi passe. Un premier segment qui est le nom
     d'un projet de ce dataset passe sous `projects/<projet>/…` ; tout autre
     premier segment (publications, protocols, storage, library…) est inchangé. */
  const routed = guardProjectHead(names || [], { datasetId: driveRootId, datasetName: driveRootName });
  if (routed.changed) {
    console.warn(
      `Drive: “${routed.head}” is a PROJECT of this dataset — the files are filed under `
      + `“${routed.names.join('/')}”, never in a folder beside projects/.`
    );
  }
  const wanted = routed.names.map((n) => sanitizeSlug(n)).filter(Boolean);
  /* UN DOSSIER SUPPRIMÉ NE SE RECRÉE PAS : si cette branche (ou celle du
     dataset lui-même) a été supprimée dans le programme, on s'arrête net au
     lieu de refabriquer une arborescence à côté de celle qui a été effacée.
     L'erreur porte un code explicite, donc l'appelant n'enfile pas non plus ce
     fichier dans la file de reprise (le dossier n'existe plus). */
  if (wanted.length && isDrivePathMirrorDeleted(readDriveMirror(), {
    dataset: { id: driveRootId, name: driveRootName }, path: wanted.join('/')
  })) {
    throwCode('PATH_DELETED', `The Drive folder “${wanted.join('/')}” was deleted — it is not recreated.`);
  }
  let parent = await ensureDriveFolder();
  const path = [];
  for (let i = 0; i < wanted.length; i++) {
    const name = wanted[i];
    /* Le PREMIER segment d'un chemin d'expérience / de protocole est un
       CONTENEUR canonique (projects/, protocols/) : il est résolu comme tel —
       identifiant retenu, jumeaux départagés par leur contenu — et non « le
       premier dossier du nom », qui pouvait être un jumeau vide. */
    const next = (i === 0 && isCanonicalDatasetDir(name))
      ? await canonicalDatasetDirId(name, { rootId: parent, create })
      : create ? await findOrCreateFolder(name, parent) : await findFolderByName(name, parent);
    /* RECHERCHE SEULE : le premier dossier absent arrête la chaîne, et rien
       n'est créé — un rangement ne fabrique pas de dossier. */
    if (!next && !create) return { leafId: '', path };
    parent = next;
    path.push({ name, id: parent });
  }
  /* Registre partagé : l'identifiant du dossier d'un PROJET est noté pour que
     renommer ou supprimer ce projet marche depuis n'importe quel poste (sinon
     l'application cherche le dossier par son nom et en crée un second). */
  if (wanted[0] === 'projects' && wanted[1] && driveRootId && path[1]) {
    try {
      writeDriveMirror(rememberProjectFolder(readDriveMirror(), {
        datasetId: driveRootId, datasetName: driveRootName, projectName: wanted[1], folderId: path[1].id
      }));
    } catch { /* confort */ }
  }
  return { leafId: parent, path };
};

/** The ACTUAL folder names (relative to the dataset root) that `ctx` resolves
 *  to. Experiments use the canonical architecture (projects/<project>/…);
 *  protocols keep their own container; anything else falls back to the legacy
 *  driveFolderPath ordering so older recorded paths keep working. */
const ctxPathOf = (ctx) => {
  if (!ctx || typeof ctx !== 'object') return [];
  if (ctx.protocol !== undefined) return driveFolderPath(ctx);
  const canonical = canonicalExperimentPath(ctx);
  return canonical.length ? canonical : driveFolderPath(ctx);
};

/** Resolve (creating as needed) the folder chain described by `ctx`.
 *  @returns {{ leafId:string, path:Array<{name:string,id:string}> }} */
export const resolveDrivePath = async (ctx) => resolveDrivePathFromNames(ctxPathOf(ctx));

/** The index of a naming-context field inside the ACTUAL folder path
 *  (canonical architecture / driveFolderPath order). -1 when the field is not
 *  a folder level or its value is empty. For experiments the path starts with
 *  the "projects" container, so a project lives at index 1, a standalone test
 *  (legacy data) still resolves through its recorded position. */
const pathIndexOf = (ctx, field) => {
  if (!ctx || typeof ctx !== 'object') return -1;
  if (field === 'protocol') return ctx.protocol ? 1 : -1;
  // The scientist is NOT a folder level (protocols/<protocol> only; test files
  // already carry the scientist in the file name) — so renaming a scientist
  // never renames a folder.
  if (field === 'scientist') return -1;
  const value = field === 'project' ? ctx.project
    : field === 'test' ? ctx.test
      : field === 'section' ? (ctx.section || ctx.pagesection)
        : field === 'subsection' ? (ctx.subsection || ctx.pagesubsection)
          : field === 'instance' ? ctx.instance : '';
  if (!value) return -1;
  return ctxPathOf(ctx).indexOf(sanitizeSlug(value));
};

/** Resolve the folder id at a position of the ctx's actual folder path by
 *  walking the chain from the dataset root (lookup only — nothing is created).
 *  The stored path is searched by segment NAME (not index), so it also works
 *  for files recorded before the path layout was changed. Returns '' when the
 *  folder is missing. */
const resolveFolderIdAtPathIndex = async (ctx, path, index) => {
  const names = ctxPathOf(ctx);
  const name = names[index];
  if (!name) return '';
  if (Array.isArray(path)) {
    const seg = path.find((s) => s && s.name === name);
    if (seg && seg.id) return String(seg.id);
  }
  let parent = await ensureDriveFolder();
  for (let i = 0; i < index; i++) {
    parent = await findFolderByName(names[i], parent);
    if (!parent) return '';
  }
  return findFolderByName(name, parent);
};

/** Move a file into `newParentId` (removing it from its current parents). */
export const moveDriveFile = async (fileId, newParentId) => {
  if (!fileId || !newParentId) return false;
  const res = await driveFetch(`/drive/v3/files/${fileId}?fields=parents`);
  const meta = await res.json();
  const parents = Array.isArray(meta.parents) ? meta.parents : [];
  const toRemove = parents.filter((p) => p !== newParentId);
  if (toRemove.length === 0) return true; // already in place
  const params = new URLSearchParams();
  params.set('addParents', newParentId);
  toRemove.forEach((p) => params.append('removeParents', p));
  await driveFetch(`/drive/v3/files/${fileId}?${params.toString()}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  return true;
};

/** Trash the folder chain that a moved file just left, BOTTOM-UP, but only the
 *  folders that became completely empty (no visible files/folders inside).
 *  Folders that still contain anything — e.g. other files of the same test, or
 *  the freshly-created folders of the NEW path — are kept. `path` is the
 *  recorded {name,id} chain (from the app root down to the old leaf folder). */
export const trashEmptyFolderChain = async (path) => {
  if (!Array.isArray(path) || path.length === 0) return;
  for (let i = path.length - 1; i >= 0; i--) {
    const folderId = path[i] && path[i].id;
    if (!folderId) continue;
    let empty = false;
    try {
      const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
      const res = await driveFetch(`/drive/v3/files?q=${q}&fields=files(id)&pageSize=10`);
      const j = await res.json();
      empty = !Array.isArray(j.files) || j.files.length === 0;
    } catch { empty = false; }
    if (!empty) break; // this folder (and everything above it) still has content — keep it
    try {
      await driveFetch(`/drive/v3/files/${folderId}?fields=id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true })
      });
    } catch { /* not app-created or gone — keep going */ }
  }
};

/** Locate an experiment (test) folder on Drive, looking first in the canonical
 *  "projects" container, then in the legacy dataset-root layout:
 *    <dataset>/projects/<project>/<test>            (canonical)
 *    <dataset>/projects/test/<test>                 (experiment with no project)
 *    <dataset>/projects/_unassigned/<test>          (legacy standalone)
 *    <dataset>/<project>/<test> and <dataset>/<test> (pre-architecture layout)
 *  @returns {{ id:string, pathNames:string[] }|null} */
const findProjectTestFolder = async (root, testName, projectName) => {
  const testSlug = sanitizeSlug(testName);
  if (!root || !testSlug) return null;
  const rels = [];
  if (projectName) {
    rels.push(`projects/${sanitizeSlug(projectName)}/${testSlug}`);
    rels.push(`${sanitizeSlug(projectName)}/${testSlug}`); // legacy
  }
  rels.push(`projects/${DEFAULT_PROJECT_NAME}/${testSlug}`);
  rels.push(`projects/_unassigned/${testSlug}`);
  rels.push(testSlug); // legacy standalone
  for (const rel of rels) {
    let parent = root;
    let ok = true;
    for (const seg of rel.split('/')) {
      parent = await findFolderByName(seg, parent);
      if (!parent) { ok = false; break; }
    }
    if (ok) return { id: parent, pathNames: rel.split('/') };
  }
  return null;
};

/** Trash the Drive folder that mirrors a test, so ALL of its files (raw data,
 *  attachments, reports…) are removed together — the Drive mirrors the app:
 *  a test deleted here disappears from Drive too. */
export const deleteTestDriveFolder = async (test) => {
  if (!getDriveToken() || !test || !test.name) return 0;
  try {
    const root = await ensureDriveFolder();
    if (!root) return 0;
    let testFolderId = '';
    const project = (test.projectNames || [])[0] || '';
    const found = await findProjectTestFolder(root, test.name, project);
    if (found) testFolderId = found.id;
    if (!testFolderId) {
      // Fallback: locate it through the registry — a file uploaded for this
      // test knows its exact folder chain.
      const reg = getDriveFileRegistry();
      for (const entry of Object.values(reg)) {
        if (!entry || entry.deleted) continue;
        const chain = entry.path || [];
        const idx = chain.findIndex((seg) => seg && seg.name === sanitizeSlug(test.name));
        if (idx >= 0 && chain[idx] && chain[idx].id) { testFolderId = chain[idx].id; break; }
      }
    }
    if (!testFolderId) return 0;
    await driveFetch(`/drive/v3/files/${testFolderId}?fields=id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true })
    });
    return 1;
  } catch { return 0; }
};

/** Trash the Drive folder that mirrors a protocol — protocols/<protocol> — so
 *  ALL of its files (attachments, imported Word documents, pasted images…)
 *  are removed together. The Drive mirrors the app: a protocol deleted here
 *  disappears from Drive too (its folder is moved to the Drive Trash). */
export const deleteProtocolDriveFolder = async (protocol) => {
  if (!getDriveToken() || !protocol || !protocol.title) return 0;
  try {
    const root = await ensureDriveFolder();
    if (!root) return 0;
    const protocolsFolderId = await findFolderByName('protocols', root);
    if (!protocolsFolderId) return 0;
    let protoFolderId = await findFolderByName(sanitizeSlug(protocol.title), protocolsFolderId);
    if (!protoFolderId) {
      // Fallback: locate it through the registry — a file uploaded for this
      // protocol knows its exact folder chain.
      const reg = getDriveFileRegistry();
      for (const entry of Object.values(reg)) {
        if (!entry || entry.deleted) continue;
        const ctx = entry.ctx || {};
        if (String(ctx.protocol || '') !== String(protocol.title)) continue;
        const seg = (entry.path || []).find((s) => s && s.name === sanitizeSlug(protocol.title));
        if (seg && seg.id) { protoFolderId = seg.id; break; }
      }
    }
    if (!protoFolderId) return 0;
    await driveFetch(`/drive/v3/files/${protoFolderId}?fields=id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true })
    });
    return 1;
  } catch { return 0; }
};

/** Move a test's WHOLE Drive folder into a project folder — used when an
 *  existing standalone test is linked to a project. The folder is MOVED (never
 *  copied), so the old path disappears and no duplicate remains on Drive.
 *  If the folder cannot be moved directly, it falls back to moving the
 *  individual files and cleaning up the empty old folders.
 *  @returns {Promise<number>} number of registry entries updated */
export const moveTestFolderIntoProject = async ({ testName, projectName }) => {
  if (!getDriveToken() || !testName || !projectName) return 0;
  try {
    const root = await ensureDriveFolder();
    if (!root) return 0;

    // Locate the experiment folder wherever it currently lives (canonical
    // projects/_unassigned container or any legacy dataset-root layout).
    let testFolderId = '';
    const found = await findProjectTestFolder(root, testName, '');
    if (found) testFolderId = found.id;
    if (!testFolderId) {
      // Fallback: locate it through the registry — a file uploaded for this
      // standalone test knows its exact folder chain.
      const reg = getDriveFileRegistry();
      for (const entry of Object.values(reg)) {
        if (!entry || entry.deleted) continue;
        const ctx = entry.ctx || {};
        if (String(ctx.test || '') !== String(testName)) continue;
        if (String(ctx.project || '')) continue; // already inside a project folder
        const seg = (entry.path || []).find((s) => s && s.name === sanitizeSlug(testName));
        if (seg && seg.id) { testFolderId = seg.id; break; }
      }
    }
    if (!testFolderId) return 0; // no standalone test folder on Drive — nothing to move

    const projectsContainerId = await canonicalDatasetDirId('projects', { rootId: root });
    const projectFolderId = await findOrCreateFolder(sanitizeSlug(projectName), projectsContainerId);
    // Already inside the project folder → nothing to do.
    if ((await findFolderByName(sanitizeSlug(testName), projectFolderId)) === testFolderId) return 0;

    // Move the whole test folder into the project folder (children follow).
    // moveDriveFile reads the folder's ACTUAL parents and removes ALL of them
    // except the project folder — so the move can never leave the old copy
    // behind (no duplicate), even when the folder's real parent differs from
    // the recorded layout.
    await moveDriveFile(testFolderId, projectFolderId);

    // Keep the registry in sync: point every file of this test at the new
    // canonical path — projects/<project>/<test>/…
    const projectsSeg = { name: 'projects', id: projectsContainerId };
    const projectSeg = { name: sanitizeSlug(projectName), id: projectFolderId };
    const reg = getDriveFileRegistry();
    let count = 0;
    for (const [fileId, entry] of Object.entries(reg)) {
      if (!entry || entry.deleted) continue;
      const ctx = entry.ctx || {};
      if (String(ctx.test || '') !== String(testName)) continue;
      if (String(ctx.project || '')) continue; // already inside a project folder
      const base = (Array.isArray(entry.path) ? entry.path : [])
        .filter((seg) => seg && seg.name !== 'projects' && seg.name !== '_unassigned');
      const newPath = [projectsSeg, projectSeg, ...base];
      reg[fileId] = { ...entry, ctx: { ...ctx, project: projectName }, path: newPath, at: Date.now() };
      count++;
    }
    if (count > 0) saveDriveFileRegistry(reg);
    return count;
  } catch (err) {
    console.warn('moveTestFolderIntoProject failed:', err && err.message);
    // Folder move failed (e.g. the folder is not app-owned): fall back to
    // moving the individual files and cleaning up the empty old folders.
    try {
      return await renameDriveFilesFor({
        field: 'project',
        oldValue: '',
        newValue: projectName,
        scope: { test: testName }
      });
    } catch { return 0; }
  }
};

/** Move a test's WHOLE Drive folder OUT of a project folder, back to the
 *  dataset root — used when a test is removed from a project. The folder is
 *  MOVED (never copied), so no duplicate remains.
 *  If the folder cannot be moved directly, it falls back to moving the
 *  individual files out of the project folder.
 *  @returns {Promise<number>} number of registry entries updated */
export const moveTestFolderOutOfProject = async ({ testName, projectName }) => {
  if (!getDriveToken() || !testName || !projectName) return 0;
  try {
    const root = await ensureDriveFolder();
    if (!root) return 0;
    const projectsContainerId = await canonicalDatasetDirId('projects', { rootId: root, create: false }).catch(() => '');

    // Locate the experiment folder inside the project (canonical container
    // first, then legacy dataset-root layout).
    let testFolderId = '';
    const found = await findProjectTestFolder(root, testName, projectName);
    if (found) testFolderId = found.id;
    if (!testFolderId) {
      // Fallback: locate it through the registry — a file uploaded for this
      // test inside this project knows its exact folder chain.
      const reg = getDriveFileRegistry();
      for (const entry of Object.values(reg)) {
        if (!entry || entry.deleted) continue;
        const ctx = entry.ctx || {};
        if (String(ctx.test || '') !== String(testName)) continue;
        if (String(ctx.project || '') !== String(projectName)) continue;
        const seg = (entry.path || []).find((s) => s && s.name === sanitizeSlug(testName));
        if (seg && seg.id) { testFolderId = seg.id; break; }
      }
    }
    if (!testFolderId) return 0; // test not inside this project folder

    // Experiments must ALWAYS belong to a project, so "removed from this
    // project" means "moved into the DEFAULT project folder" — `projects/test`,
    // exactement le même bac qu'un test sans projet (jamais un dossier errant à
    // la racine, jamais un projet qui n'existe pas).
    const projectsFolderId = projectsContainerId || await canonicalDatasetDirId('projects', { rootId: root });
    const outOfProjectFolderId = await findOrCreateFolder(DEFAULT_PROJECT_NAME, projectsFolderId);
    const existingThere = await findFolderByName(sanitizeSlug(testName), outOfProjectFolderId);
    if (existingThere !== testFolderId) {
      // moveDriveFile removes the folder from ALL its current parents, so the
      // move can never leave a copy inside the project (no duplicate).
      await moveDriveFile(testFolderId, outOfProjectFolderId);
    }

    // The project folder may now be empty (last test moved out) — trash it so
    // Drive stays tidy. Folders that still hold project docs are kept.
    try {
      const projectFolderId = await findFolderByName(sanitizeSlug(projectName), projectsFolderId);
      if (projectFolderId) {
        await trashEmptyFolderChain([{ name: sanitizeSlug(projectName), id: projectFolderId }]);
      }
    } catch { /* keep the project folder */ }

    // Keep the registry in sync: drop ctx.project and rewrite paths to the
    // canonical projects/<projet par défaut>/<test>/… layout.
    const outOfProjectSeg = { name: DEFAULT_PROJECT_NAME, id: outOfProjectFolderId };
    const projectsSeg = { name: 'projects', id: projectsFolderId };
    const reg = getDriveFileRegistry();
    let count = 0;
    for (const [fileId, entry] of Object.entries(reg)) {
      if (!entry || entry.deleted) continue;
      const ctx = entry.ctx || {};
      if (String(ctx.test || '') !== String(testName)) continue;
      if (String(ctx.project || '') !== String(projectName)) continue;
      const newCtx = { ...ctx, project: '' };
      /* Les segments du CHEMIN sont refaits : on retire le conteneur, le bac
         (« test » — et son ancien nom « _unassigned », encore présent sur les
         dossiers d'avant) et l'ancien projet. */
      const base = (Array.isArray(entry.path) ? entry.path : [])
        .filter((seg) => seg && seg.name !== 'projects' && seg.name !== '_unassigned'
          && seg.name !== DEFAULT_PROJECT_NAME && seg.name !== sanitizeSlug(projectName));
      reg[fileId] = { ...entry, ctx: newCtx, path: [projectsSeg, outOfProjectSeg, ...base], at: Date.now() };
      count++;
    }
    if (count > 0) saveDriveFileRegistry(reg);
    return count;
  } catch (err) {
    console.warn('moveTestFolderOutOfProject failed:', err && err.message);
    // Fallback: move the individual files into projects/<projet par défaut>/<test>.
    let moved = 0;
    try {
      const root = await ensureDriveFolder();
      const projectsFolderId = root ? await findOrCreateFolder('projects', root) : '';
      const outOfProjectFolderId = projectsFolderId ? await findOrCreateFolder(DEFAULT_PROJECT_NAME, projectsFolderId) : '';
      const reg = getDriveFileRegistry();
      for (const [fileId, entry] of Object.entries(reg)) {
        if (!entry || entry.deleted) continue;
        const ctx = entry.ctx || {};
        if (String(ctx.test || '') !== String(testName)) continue;
        if (String(ctx.project || '') !== String(projectName)) continue;
        try {
          const newCtx = { ...ctx, project: '' };
          const resolved = await resolveDrivePath(newCtx);
          await moveDriveFile(fileId, outOfProjectFolderId || resolved.leafId);
          const chain = Array.isArray(entry.path) ? entry.path : [];
          reg[fileId] = { ...entry, ctx: newCtx, path: resolved.path, at: Date.now() };
          if (chain.length) { try { await trashEmptyFolderChain(chain); } catch { /* keep going */ } }
          moved++;
        } catch { /* keep going */ }
      }
      if (moved > 0) saveDriveFileRegistry(reg);
    } catch { /* keep going */ }
    return moved;
  }
};

/* ── DÉPLACER LE DOSSIER D'UNE EXPÉRIENCE D'UN PROJET À UN AUTRE ──────────── */

/** Un nœud Drive est-il un DOSSIER ? Le mime est la seule marque fiable. */
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const isFolderNode = (node) => Boolean(node) && String(node.mimeType || '') === DRIVE_FOLDER_MIME;

/** Fusionner le dossier `fromId` DANS `toId` : chaque enfant est DÉPLACÉ par son
 *  identifiant (jamais copié), et un dossier portant le MÊME nom des deux côtés
 *  est fusionné RÉCURSIVEMENT — c'est ce qui évite de fabriquer un jumeau de
 *  plus (voir docs/DRIVE-MIRROR.md, « Les jumeaux d'INSTANCE »).
 *  Un FICHIER homonyme n'est JAMAIS écrasé : il reste où il est (son dossier,
 *  devenu non vide, n'est donc pas rangé à la corbeille — l'appelant le
 *  signale). Même politique que `_repair_drive_twins.mjs`.
 *  @returns {Promise<number>} nombre d'enfants déplacés */
const mergeFolderInto = async (fromId, toId, depth = 0) => {
  if (!fromId || !toId || fromId === toId || depth > 12) return 0;
  let moved = 0;
  const [kids, keep] = await Promise.all([listDriveChildren(fromId), listDriveChildren(toId)]);
  for (const kid of kids) {
    const folder = isFolderNode(kid);
    const clash = keep.find((k) => k && k.name === kid.name && isFolderNode(k) === folder);
    if (folder && clash) {
      moved += await mergeFolderInto(kid.id, clash.id, depth + 1);
      await trashEmptyFolderChain([{ name: kid.name, id: kid.id }]);
      continue;
    }
    if (clash) continue; // homonyme : rien n'est écrasé, rien n'est supprimé
    await moveDriveFile(kid.id, toId);
    moved += 1;
  }
  return moved;
};

/** Ranger les SOURCES d'un dossier d'expérience sous le dossier du projet visé.
 *  Partie « geste » de `moveTestFolderBetweenProjects` (voir sa documentation) :
 *  chaque source est DÉPLACÉE, ou FUSIONNÉE dans le dossier du même nom déjà
 *  présent dans le projet visé ; les conteneurs vidés partent à la corbeille ;
 *  le registre des fichiers est réécrit en `projects/<projet visé>/…`.
 *  @returns {Promise<{folders:number, merged:number, registry:number, kept:number}>} */
const moveExperimentSourcesInto = async (sources, {
  testName, testSlug, fromSlug, toProjectName, toSlug, toFolderId, projectsId, leftovers = [], report
}) => {
  /* Chaque source MIGRE — ou fusionne avec un dossier du même nom déjà là. */
  for (const src of sources) {
    if (src.id === toFolderId || src.parent === toFolderId) continue; // déjà rangé
    try {
      const twins = (await listFoldersByName(testSlug, toFolderId)).filter((f) => String(f.id) !== src.id);
      const keep = twins.length ? await canonicalTwinOf(twins) : null;
      if (!keep) {
        await moveDriveFile(src.id, toFolderId); // DÉPLACÉ (addParents + removeParents)
        report.folders += 1;
        continue;
      }
      await mergeFolderInto(src.id, String(keep.id));
      /* Le dossier ne part à la corbeille que s'il est VIDE maintenant : un
         homonyme laissé en place le maintient (et il est signalé). */
      await trashEmptyFolderChain([{ name: testSlug, id: src.id }]);
      if ((await listDriveChildren(src.id)).length) report.kept += 1;
      report.merged += 1;
    } catch (err) {
      console.warn('Could not move the experiment Drive folder:', err && err.message);
    }
  }

  /* Les conteneurs devenus vides (bac, dossier du projet quitté) partent à la
     corbeille : c'est ce qui fait DISPARAÎTRE l'ancien chemin. Ceux qui portent
     encore quelque chose (documents du projet, une autre expérience) sont gardés
     — la lecture de leur contenu décide. */
  for (const parent of leftovers) {
    if (!parent || parent === toFolderId || String(parent) === String(projectsId)) continue;
    try { await trashEmptyFolderChain([{ name: '', id: parent }]); } catch { /* hygiène */ }
  }

  /* Le registre suit (voir registerDriveFile) : `ctx.project` devient le projet
     visé et le chemin est refait à neuf. `expFolderId` est le dossier de
     l'expérience MAINTENANT sous le projet visé (le canonique s'il en existe
     plusieurs) : c'est l'identifiant que le registre doit porter — l'ancien vient
     d'être déplacé, ou fusionné dans un autre. */
  const landed = await listFoldersByName(testSlug, toFolderId);
  const expFolderId = landed.length ? String((await canonicalTwinOf(landed)).id) : toFolderId;
  const heads = new Set(['projects', '_unassigned', DEFAULT_PROJECT_NAME, fromSlug]);
  const reg = getDriveFileRegistry();
  const projectsSeg = { name: 'projects', id: projectsId };
  const toSeg = { name: toSlug, id: toFolderId };
  let count = 0;
  for (const [fileId, entry] of Object.entries(reg)) {
    if (!entry || entry.deleted) continue;
    const ctx = entry.ctx || {};
    if (String(ctx.test || '') !== String(testName)) continue;
    const owner = String(ctx.project || '');
    /* La copie d'un AUTRE projet resté lié ne bouge pas (many-to-many). */
    if (owner && sanitizeSlug(owner) !== fromSlug) continue;
    const segs = (Array.isArray(entry.path) ? entry.path : []).filter((s) => s && s.name);
    const at = segs.findIndex((s) => s.name === testSlug);
    /* Ce qui SUIT le segment de l'expérience (instance, section, …) est
       conservé ; le segment de l'expérience est refait à neuf — son ancien
       identifiant vient d'être déplacé, ou fusionné dans un autre. */
    const tail = at >= 0 ? segs.slice(at + 1) : segs.filter((s) => !heads.has(s.name));
    reg[fileId] = {
      ...entry,
      ctx: { ...ctx, project: toProjectName },
      path: [projectsSeg, toSeg, { name: testSlug, id: expFolderId }, ...tail],
      at: Date.now()
    };
    count++;
  }
  if (count > 0) saveDriveFileRegistry(reg);
  report.registry = count;
  return report;
};

/** DÉPLACER une expérience d'un projet à un autre : son dossier Drive MIGRE dans
 *  le dossier du projet visé — DÉPLACÉ, jamais copié.
 *
 *  C'est le geste du ⇄ « Move to project » de la page projet
 *  (projectDetailModule.jsx). Une expérience = un test = UN dossier Drive
 *  (`projects/<projet>/<expérience>`, voir canonicalExperimentPath) : le
 *  déplacement doit donc réunir tout ce qui porte ce nom sur le Drive, sinon un
 *  dossier resté derrière continuerait d'être rendu par `findFolderByName` et
 *  l'expérience vivrait à deux endroits.
 *
 *    1. les sources sont cherchées PARTOUT où ce dossier peut vivre — le projet
 *       quitté, le bac des expériences sans projet (`projects/test`), l'ancien
 *       bac `projects/_unassigned`, l'héritage `<dataset>/<projet>/<expérience>`
 *       et la racine du dataset — JUMEAUX compris (folderRace.js) ;
 *    2. le dossier du projet visé est retrouvé (ou créé) — mais SEULEMENT s'il y
 *       a vraiment quelque chose à y ranger : aucun dossier n'est semé ;
 *    3. chaque source est DÉPLACÉE : `moveDriveFile` retire TOUS les autres
 *       parents, donc aucun doublon ne peut subsister ; si un dossier du même
 *       nom est DÉJÀ dans le projet visé (l'expérience y était déjà liée, ou un
 *       jumeau l'y attend), le contenu est FUSIONNÉ dedans (`mergeFolderInto`)
 *       au lieu de poser un second dossier du même nom ;
 *    4. les dossiers vidés (bac, dossier du projet quitté) partent à la
 *       corbeille : l'ancien chemin disparaît ;
 *    5. le registre des fichiers suit (`ctx.project` = projet visé, chemin refait
 *       en `projects/<projet visé>/<expérience>/…`). Les fichiers d'un AUTRE
 *       projet resté lié (many-to-many) ne sont pas touchés.
 *
 *  Au mieux, jamais bloquant : sans Drive connecté, ou si le dossier n'existe
 *  pas encore, rien n'est fait et rien n'est créé — les fichiers envoyés plus
 *  tard arrivent directement dans le bon dossier, puisque le chemin se calcule à
 *  partir de `projectNames`.
 *  @returns {Promise<{folders:number, merged:number, registry:number, kept:number}>}
 *    `folders` dossiers déplacés, `merged` fusionnés dans un dossier existant,
 *    `registry` entrées du registre réécrites, `kept` dossiers homonymes laissés
 *    en place (devenus non vides). */
export const moveTestFolderBetweenProjects = async ({ testName, fromProjectName, toProjectName }) => {
  const report = { folders: 0, merged: 0, registry: 0, kept: 0 };
  if (!getDriveToken() || !testName || !fromProjectName || !toProjectName) return report;
  const testSlug = sanitizeSlug(testName);
  const fromSlug = sanitizeSlug(fromProjectName);
  const toSlug = sanitizeSlug(toProjectName);
  if (!testSlug || !toSlug || toSlug === fromSlug) return report;
  try {
    const root = await ensureDriveFolder();
    if (!root) return report;
    const projectsId = await canonicalDatasetDirId('projects', { rootId: root });
    if (!projectsId) return report;

    /* 1. TOUTES les copies de ce dossier d'expérience. */
    const fromProjectId = await findFolderByName(fromSlug, projectsId);
    const bucketId = await findFolderByName(DEFAULT_PROJECT_NAME, projectsId);
    const legacyBucketId = await findFolderByName('_unassigned', projectsId);
    const legacyProjectId = await findFolderByName(fromSlug, root);
    const sources = [];
    for (const parent of [fromProjectId, bucketId, legacyBucketId, legacyProjectId, root]) {
      if (!parent) continue;
      for (const f of await listFoldersByName(testSlug, parent)) {
        if (f && f.id && !sources.some((s) => s.id === String(f.id))) sources.push({ id: String(f.id), parent });
      }
    }
    if (!sources.length) return report; // rien sur le Drive → aucun dossier à semer

    const toFolderId = await findOrCreateFolder(toSlug, projectsId);
    if (!toFolderId) return report;
    return await moveExperimentSourcesInto(sources, {
      testName, testSlug, fromSlug, toProjectName, toSlug, toFolderId, projectsId,
      leftovers: [fromProjectId, bucketId, legacyBucketId, legacyProjectId], report
    });
  } catch (err) {
    console.warn('moveTestFolderBetweenProjects failed:', err && err.message);
    return report;
  }
};

/**
 * Upload one file to the Drive folder and share it as "anyone with the link".
 * `file` can be a raw File/Blob (recommended — works for large files like
 * XTC trajectories, CD spectra, PDFs...) or a data URL string (fallback).
 *
 * Overwrite behaviour: if a file with the same name already exists in the
 * target folder, its content is replaced (same ID/link) instead of creating
 * a duplicate — so updating a figure/document tomorrow reuses the same file.
 * @returns {{ id:string, name:string, driveUrl:string }}
 */
/** Perform ONE Drive/Nextcloud upload into the canonical folder described by
 *  `folderNames` (relative to the dataset folder). When `folderNames` is null,
 *  `path` is an explicit path array or `ctx` still describes a legacy folder
 *  (non-experiment uploads such as library figures or project documents).
 *  @returns {{ id:string, name:string, driveUrl:string }} */
const uploadDriveFileToFolderOnce = async ({ name, mimeType, file, ctx = null, path = null, folderNames = null, folderId = '', onProgress = null }) => {
  // ── Nextcloud provider ─────────────────────────────────────────────────────
  // Mirror the Drive folder layout on the WebDAV tree:
  //   <user>/Lab Workspace/<dataset>/<project>/<test>/<page section>/[<subsection>]
  // (or an explicit `path` array, exactly like Drive uploads under the dataset).
  if (getCloudProvider() === 'nextcloud') {
    if (!nextcloudConfigured()) return null;
    const segments = ['Lab Workspace'];
    if (driveRootName) segments.push(sanitizeSlug(driveRootName));
    if (Array.isArray(folderNames) && folderNames.length > 0) {
      segments.push(...folderNames.map((s) => sanitizeSlug(String(s))));
    } else if (Array.isArray(path) && path.length > 0) {
      segments.push(...path.filter(Boolean).map((s) => sanitizeSlug(String(s))));
    } else if (ctx && typeof ctx === 'object') {
      segments.push(...driveFolderPath(ctx));
    }
    try {
      return await ncUploadFile({ parts: segments, name, mimeType, file });
    } catch (err) {
      console.warn('Nextcloud upload failed:', err && err.message);
      return null;
    }
  }
  // Upload into the leaf folder that mirrors the canonical app schema
  // (projects/<project>/<experiment>/<instance>/<page section>/[<subsection>]
  // or an explicit `path` like publications/<scientist>/own_publications).
  /* LE DOSSIER DÉJÀ RÉSOLU par son IDENTIFIANT (figures d'un projet) : deux
     dossiers du même nom peuvent coexister sur le Drive, et une résolution par
     nom (`findOrCreateFolder`) tombe sur « le premier du nom » — parfois le
     jumeau VIDE. Les envois visent donc EXACTEMENT le dossier que la lecture
     utilise (voir utils/figuresFolder.js). Un dossier inaccessible (Drive muet)
     ne fait pas échouer l'envoi : on retombe sur le chemin par nom. */
  const pinnedId = String(folderId || '').trim();
  let pinned = '';
  if (pinnedId) {
    const pinnedMeta = await getDriveFileMeta(pinnedId).catch(() => null);
    if (pinnedMeta && pinnedMeta.id) {
      if (pinnedMeta.trashed) throwCode('PATH_DELETED', 'The target folder is gone.');
      pinned = pinnedId;
    }
  }
  let targetId = await ensureDriveFolder();
  let drivePath = null;
  if (pinned) {
    targetId = pinned;
    drivePath = Array.isArray(path) && path.length
      ? path.map((seg, i) => ({ name: sanitizeSlug(String(seg)), id: i === path.length - 1 ? pinned : '' }))
      : null;
  } else if (Array.isArray(folderNames) && folderNames.length > 0) {
    const resolved = await resolveDrivePathFromNames(folderNames);
    targetId = resolved.leafId;
    drivePath = resolved.path;
  } else if (Array.isArray(path) && path.length > 0) {
    const resolved = await resolveDrivePathFromNames(path);
    targetId = resolved.leafId;
    drivePath = resolved.path;
  } else if (ctx && typeof ctx === 'object' && driveFolderPath(ctx).length > 0) {
    const resolved = await resolveDrivePath(ctx);
    targetId = resolved.leafId;
    drivePath = resolved.path;
  }
  // Accept a raw Blob/File (streamed directly, no base64 overhead) or a data URL.
  const blob = typeof file === 'string' ? dataUrlToBlob(file) : file;
  const type = mimeType || blob.type || 'application/octet-stream';

  // Find an existing file with the same name in the target folder so we can
  // overwrite it instead of piling up duplicates.
  let existingId = '';
  try {
    const safeName = String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = encodeURIComponent(`name='${safeName}' and '${targetId}' in parents and trashed=false`);
    const listRes = await driveFetch(`/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=10`);
    const list = await listRes.json();
    existingId = ((list.files || [])[0] || {}).id || '';
  } catch { /* listing failed — fall back to a plain (new) upload */ }

  const boundary = 'labBoundary' + Date.now() + Math.random().toString(36).slice(2);
  // For an update the file is already in the folder, so omit `parents`.
  const meta = JSON.stringify(existingId
    ? { name, mimeType: type }
    : { name, mimeType: type, parents: [targetId] });

  /* LES GROS FICHIERS PARTENT PAR MORCEAUX (session « resumable »). Une seule
     requête multipart n'a aucun point de reprise : une trajectoire de plusieurs Go
     laissait ses dossiers sur le Drive SANS son fichier, et rien ne pouvait plus
     la restaurer sur un autre poste (défaut signalé le 25/09/2026). Même nom,
     même dossier, même remplacement d'un fichier existant : seule la façon de
     transporter les octets change. Une session refusée (`Location` illisible,
     p. ex. une réponse CORS sans en-tête exposé) rend `null` et l'envoi en une
     seule requête ci-dessous reste le repli — un échec de TRANSFERT, lui, remonte
     (il doit se dire, pas se doubler d'un second envoi complet). */
  let fileMeta = null;
  if (shouldChunkUpload(blob.size)) {
    fileMeta = await uploadBlobInChunks({
      blob, name, mimeType: type, targetId, existingId, driveFetch, onProgress
    });
    if (!fileMeta) {
      console.warn(`Resumable session unavailable for “${name}” (${Math.round(blob.size / 1048576)} MB) — single-request upload.`);
    }
  }

  if (!fileMeta) {
    const pre = new Blob(
      [`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`],
      { type: 'multipart/related' }
    );
    const post = new Blob([`\r\n--${boundary}--\r\n`], { type: 'multipart/related' });
    const body = new Blob([pre, blob, post], { type: `multipart/related; boundary=${boundary}` });

    const res = await driveFetch(
      existingId
        ? `/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id,name`
        : `/upload/drive/v3/files?uploadType=multipart&fields=id,name`,
      // Large raw files (trajectories, videos, …) can take minutes to upload —
      // never abort them with the short interactive-request timeout.
      { method: existingId ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body, timeout: 10 * 60 * 1000 }
    );
    fileMeta = await res.json();
  }
  if (!fileMeta || !fileMeta.id) throwCode('DRIVE_ERROR', 'Drive returned no file.');

  // Make it readable via the link so the app can show thumbnails / others can open it.
  try {
    await driveFetch(`/drive/v3/files/${fileMeta.id}/permissions?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' })
    });
  } catch { /* link may stay private to the owner — upload still succeeded */ }

  // Remember the naming context (and the folder path) so later project/test
  // renames can rename/move the Drive file to match.
  if (ctx) registerDriveFile(fileMeta.id, fileMeta.name, ctx, drivePath);

  return { id: fileMeta.id, name: fileMeta.name, driveUrl: `https://drive.google.com/file/d/${fileMeta.id}/view` };
};

// ── Pending-upload queue (automatic retry when Drive comes back) ───────────
// When Drive is unreachable (workspace token server down, token expired,
// network blip) an upload must not be lost: its bytes are parked in the
// IndexedDB-backed queue (pendingUploads.js). uploadLocalFile() and the
// upload button enqueue the failed attempt automatically, and
// flushPendingUploads() replays the whole queue as soon as
// 'lab:drive-connected' fires again (the auto-renew mints a fresh token every
// minute while the server is down, so this happens WITHOUT user action).
// A deterministic id (name + naming context + payload tag) makes repeated
// attempts for the same file REPLACE the queued copy instead of duplicating.

const hashQueueId = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

/** Payload fingerprint: two different files that share the same suggested name
 *  (e.g. two pasted screenshots both called "pasted_image_1") stay distinct. */
const payloadTagOf = (file) => {
  if (typeof file === 'string' && String(file).indexOf('data:') === 0) {
    const s = String(file);
    return `d|${s.length}|${hashQueueId(s.slice(0, 256))}`;
  }
  if (file && typeof file.size === 'number') {
    const nm = (file.name && String(file.name)) || 'blob';
    const lm = (file.lastModified && Number(file.lastModified)) || 0;
    return `b|${nm}|${lm}|${file.size}`;
  }
  return '';
};

/**
 * Queue a failed upload for automatic retry when Drive answers again.
 * Google Drive provider only (Nextcloud failures are reported as-is).
 * @returns {Promise<{queued:boolean,id?:string,reason?:string}>}
 */
export const saveUploadForRetry = async ({ name, mimeType, file, ctx = null, path = null, source = 'upload', folderId = '' } = {}) => {
  try {
    if (!name || !file || getCloudProvider() === 'nextcloud') return { queued: false, reason: 'unsupported' };
    const isDataUrl = typeof file === 'string' && String(file).indexOf('data:') === 0;
    const isBlob = !isDataUrl && typeof Blob !== 'undefined' && file instanceof Blob;
    if (!isDataUrl && !isBlob) return { queued: false, reason: 'unsupported' };
    const approxBytes = isDataUrl ? Math.ceil(String(file).length * 0.75) : (Number(file.size) || 0);
    if (approxBytes > MAX_SINGLE_BYTES) return { queued: false, reason: 'too_large' };
    const tag = payloadTagOf(file);
    const id = `pq_${hashQueueId([name, JSON.stringify(ctx || null), JSON.stringify(path || null), String(folderId || ''), tag].join('|'))}`;
    return await enqueuePendingUpload({
      id,
      name,
      mimeType: mimeType || 'application/octet-stream',
      payload: file,
      ctx: ctx && typeof ctx === 'object' ? { ...ctx } : null,
      path: Array.isArray(path) ? path.slice() : null,
      // Le dossier visé par IDENTIFIANT (figures d'un projet) : la reprise écrit
      // alors dans le MÊME dossier que l'envoi, jumeaux compris.
      folderId: String(folderId || ''),
      source,
      ...getDriveRootAnchor()
    });
  } catch (err) {
    console.warn('Could not queue the failed upload:', err && err.message);
    return { queued: false, reason: 'storage' };
  }
};

/** Public upload entry point.
 *
 *  Many-to-many experiments: when `ctx` describes an experiment (ctx.test) and
 *  ctx.projectNames lists SEVERAL projects, the file is duplicated — one full
 *  canonical tree (projects/<project>/<experiment>/<instance>/<page section>/…)
 *  is created/updated inside EACH linked project directory, exactly mirroring
 *  the experiment being shared. `ctx.projectNames` is the experiment's current
 *  project list (falling back to the legacy ctx.project when it is empty).
 *
 *  Non-experiment uploads (protocols, publications, figures, imports that pass
 *  an explicit `path`) are routed exactly as before.
 */
export const uploadLocalFile = async ({ name, mimeType, file, ctx = null, path = null, skipQueue = false, folderId = '', onProgress = null }) => {
  const folderCtxs = [];
  if (ctx && typeof ctx === 'object' && String(ctx.test || '').trim() && ctx.protocol === undefined) {
    const projects = projectNamesOf(ctx);
    const projectList = projects.length ? projects : [DEFAULT_PROJECT_NAME]; // projet par défaut
    projectList.forEach((projectName) => {
      folderCtxs.push({ ...ctx, project: projectName, projectNames: [projectName] });
    });
  } else {
    folderCtxs.push(ctx);
  }

  let last = null;
  let deletedTarget = false;
  for (const singleCtx of folderCtxs) {
    // Explicit path arrays are kept, but the first segment is normalised to the
    // canonical lower-case page section when it is one ("Data" → "data",
    // "Experimental Conditions" → "experimental conditions", …).
    let folderNames = null;
    if (Array.isArray(path) && path.length > 0) {
      /* Un chemin explicite d'EXPÉRIENCE doit commencer par le conteneur
         canonique « projects/ » : l'ancienne forme (celle de driveFolderPath,
         [<projet>, <expérience>, …], utilisée par l'import Bruker du NMR 1D et
         du ssNMR) créait le dossier de l'expérience AU NIVEAU DU DATASET, à côté
         de projects/ — comme si l'expérience n'était liée à aucun projet.
         Voir driveNaming.canonicalizeExperimentPath. */
      folderNames = canonicalizeExperimentPath(
        [canonicalPageSection(path[0]), ...path.slice(1)], singleCtx
      );
    } else if (singleCtx && typeof singleCtx === 'object' && String(singleCtx.test || '').trim()) {
      folderNames = canonicalExperimentPath(singleCtx);
    }
    try {
      const res = await uploadDriveFileToFolderOnce({
        name, mimeType, file, ctx: singleCtx, path: folderNames ? null : path, folderNames,
        /* Le dossier résolu par IDENTIFIANT ne vaut que pour une SEULE cible (les
           figures d'un projet). Un fichier déposé dans plusieurs projets a un
           chemin PAR PROJET : il n'y a alors pas d'identifiant unique à viser. */
        folderId: folderCtxs.length === 1 ? folderId : '',
        onProgress
      });
      if (res) last = res;
    } catch (err) {
      // One linked project failing must not hide the others; the caller still
      // receives the last successful upload (or null when all failed).
      if (err && err.code === 'PATH_DELETED') deletedTarget = true;
      console.warn(`Drive upload failed for project "${(singleCtx && singleCtx.project) || ''}":`, err && err.message);
    }
  }
  if (!last && !skipQueue && !deletedTarget) {
    // Every folder copy failed → Drive is unreachable right now (token server
    // down / token expired / network error). Keep the file in the pending
    // queue so flushPendingUploads() replays it as soon as Drive answers
    // again, instead of losing it. The public contract is unchanged (null).
    // EXCEPTION : la cible a été SUPPRIMÉE dans le programme (PATH_DELETED) —
    // rien à reprendre, le dossier ne sera pas recréé (voir driveMirrorStore).
    const q = await saveUploadForRetry({
      name, mimeType, file, ctx, path, source: 'upload',
      folderId: folderCtxs.length === 1 ? folderId : ''
    }).catch(() => null);
    // Le sort du fichier est retenu ici : l'appelant peut alors DIRE ce qui
    // s'est passé (« envoyé », « en attente de reprise ») au lieu d'un
    // « échec » indistinct. Voir takeLastUploadQueueInfo().
    lastUploadQueueInfo = { queued: !!(q && q.queued), reason: (q && q.reason) || 'error', at: Date.now() };
  } else {
    lastUploadQueueInfo = {
      queued: false,
      reason: last ? 'uploaded' : (deletedTarget ? 'path_deleted' : 'not_queued'),
      at: Date.now()
    };
  }
  return last;
};

/** Ce qui vient d'arriver au DERNIER uploadLocalFile : `{ queued, reason }`.
 *  `queued: true` = le fichier est dans la file d'attente d'IndexedDB et
 *  repartira tout seul dès que le Drive répond (voir pendingUploads.js) — donc
 *  rien n'est perdu, ce qui n'est PAS la même chose qu'un échec définitif.
 *  La lecture CONSOMME l'information (chaque appel concerne un envoi). */
let lastUploadQueueInfo = null;
export const takeLastUploadQueueInfo = () => {
  const info = lastUploadQueueInfo;
  lastUploadQueueInfo = null;
  return info;
};

let flushPendingInFlight = false;

/** Back-off between retry attempts of one file (30 s → … → max 30 min). */
const pendingRetryDelayMs = (attempts) => {
  if (!attempts || attempts <= 0) return 0;
  return Math.min(30 * 1000 * (2 ** Math.min(attempts - 1, 6)), 30 * 60 * 1000);
};

/**
 * Replay every queued upload now that Drive is (possibly) reachable again.
 * Items that belong to a dataset that is NOT currently open are left queued
 * (never uploaded into the wrong dataset folder); they flush as soon as that
 * dataset is opened again and a token renewal succeeds.
 * @returns {Promise<number>} number of files successfully uploaded
 */
export const flushPendingUploads = async () => {
  if (flushPendingInFlight || typeof window === 'undefined') return 0;
  if (getCloudProvider() === 'nextcloud') return 0;
  // A token is required to upload anything. If none is cached, try one silent
  // renewal (personal refresh token / shared workspace mint) — when the
  // workspace server is still down this returns false quickly and we simply
  // wait for the next 'lab:drive-connected'.
  try {
    if (!getDriveToken()) {
      const ok = await renewDriveTokenSilently();
      if (!ok) return 0;
    }
  } catch { return 0; }

  flushPendingInFlight = true;
  let uploaded = 0;
  try {
    const items = await listPendingUploads();
    if (!items.length) return 0;
    const now = Date.now();
    const currentAnchor = getDriveRootAnchor();
    for (const item of items) {
      if (!item || !item.id) continue;
      // Housekeeping: queued copies older than 30 days are dropped (the local
      // in-app copy kept in the dataset document is never affected).
      if (now - (item.createdAt || now) > MAX_PENDING_AGE_MS) {
        await removePendingUpload(item.id).catch(() => {});
        continue;
      }
      // Never upload into the WRONG dataset folder when another dataset is open.
      if (item.datasetId && (!currentAnchor.datasetId || currentAnchor.datasetId !== item.datasetId)) continue;
      // Back-off after failed attempts so a permanently failing item (e.g. a
      // full Drive quota) does not hammer the API on every reconnect.
      if (item.attempts > 0 && now - (item.lastAttemptAt || 0) < pendingRetryDelayMs(item.attempts)) continue;
      try {
        const drive = await uploadLocalFile({
          name: item.name,
          mimeType: item.mimeType,
          file: item.payload,
          ctx: item.ctx || null,
          path: item.path || null,
          // Le dossier retenu au moment de l'envoi (figures d'un projet) : la
          // reprise écrit dans le MÊME dossier, même si un jumeau du même nom
          // est apparu entre-temps (voir utils/figuresFolder.js).
          folderId: item.folderId || '',
          skipQueue: true
        });
        if (drive && drive.id) {
          uploaded++;
          await removePendingUpload(item.id).catch(() => {});
          try {
            window.dispatchEvent(new CustomEvent('lab:pending-uploaded', {
              detail: {
                id: item.id,
                name: item.name,
                mimeType: item.mimeType,
                drive,
                ctx: item.ctx || null,
                dataUrl: item.kind === 'dataUrl' && typeof item.payload === 'string' ? item.payload : ''
              }
            }));
          } catch { /* ignore */ }
        } else {
          await touchPendingUpload(item.id, { attempts: (item.attempts || 0) + 1, lastAttemptAt: now }).catch(() => {});
        }
      } catch (err) {
        console.warn(`Pending upload "${item.name}" failed — kept for a later retry:`, err && err.message);
        await touchPendingUpload(item.id, { attempts: (item.attempts || 0) + 1, lastAttemptAt: now }).catch(() => {});
      }
    }
  } finally {
    flushPendingInFlight = false;
    try { notifyPendingChanged(); } catch { /* ignore */ }
  }
  return uploaded;
};

/** Build the "_deleted" variant of a file name (inserted before the extension). */
const deletedNameOf = (name) => {
  const s = String(name || '').trim();
  if (!s) return '';
  const m = /^(.*?)(\.[a-zA-Z0-9]{1,10})$/.exec(s);
  return m ? `${m[1]}_deleted${m[2]}` : `${s}_deleted`;
};

/** Recursively find every Google Drive file id referenced by a value (string/array/object/HTML). */
export const extractDriveFileIds = (value, out = []) => {
  if (typeof value === 'string') {
    const re = /drive\.google\.com\/(?:file\/d\/|open\?.*?id=|uc\?.*?id=|thumbnail\?.*?id=|drive\/folders\/)([a-zA-Z0-9_-]{8,})|lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]{8,})/g;
    let m;
    while ((m = re.exec(value)) !== null) {
      const id = m[1] || m[2];
      if (id && out.indexOf(id) === -1) out.push(id);
    }
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((v) => extractDriveFileIds(v, out));
    return out;
  }
  if (value && typeof value === 'object') {
    Object.keys(value).forEach((k) => extractDriveFileIds(value[k], out));
  }
  return out;
};

/** Rename a Drive file (the app can only rename files it created — others are skipped). */
export const renameDriveFile = async (fileId, newName) => {
  if (!fileId || !newName) return false;
  const res = await driveFetch(`/drive/v3/files/${fileId}?fields=id,name`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: String(newName).slice(0, 200) })
  });
  await res.json();
  return true;
};

/** Append "_deleted" to a Drive file's name (best-effort) and remember it in the registry. */
export const markDriveFileDeleted = async (fileId) => {
  if (!fileId) return false;
  try {
    const res = await driveFetch(`/drive/v3/files/${fileId}?fields=id,name`);
    const meta = await res.json();
    if (!meta || !meta.name) return false;
    const ok = await renameDriveFile(fileId, deletedNameOf(meta.name));
    if (ok) {
      const reg = getDriveFileRegistry();
      if (reg[fileId]) {
        reg[fileId] = { ...reg[fileId], name: deletedNameOf(meta.name), deleted: true, at: Date.now() };
        saveDriveFileRegistry(reg);
      }
    }
    return ok;
  } catch (err) {
    console.warn('Could not mark Drive file as deleted:', err && err.message);
    return false;
  }
};

/** Permanently remove a file from the Drive tree (moves it to the Drive Trash).
 *  Used e.g. when a publication's PDF is removed from the table — Drive mirrors
 *  the app, so the file disappears there too. */
export const trashDriveFile = async (fileId) => {
  if (!fileId) return false;
  try {
    const res = await driveFetch(`/drive/v3/files/${fileId}?fields=id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true })
    });
    await res.json();
    const reg = getDriveFileRegistry();
    if (reg[fileId]) {
      reg[fileId] = { ...reg[fileId], deleted: true, at: Date.now() };
      saveDriveFileRegistry(reg);
    }
    return true;
  } catch (err) {
    console.warn('Could not trash Drive file:', err && err.message);
    return false;
  }
};

// ── Google Identity Services (proper Drive access) ─────────────────────────
// The standard Firebase Google sign-in cannot get the drive.file scope from
// Google. If GOOGLE_DRIVE_CLIENT_ID is configured, we use Google Identity
// Services to request a real Drive-access token.
import { GOOGLE_DRIVE_CLIENT_ID, GOOGLE_TOKEN_EXCHANGE_URL, GOOGLE_DRIVE_SHARED_MODE, GOOGLE_MAIL_SEND_SCOPE } from '../data/constants';

/* Étendues demandées à Google au moment du consentement :
   - drive.file : fichiers créés par l'application uniquement ;
   - gmail.send : envoi automatique des e-mails du module Administration
     (Approbation devis & BC) depuis le compte Google connecté. */
const GOOGLE_AUTH_SCOPES =
  `https://www.googleapis.com/auth/drive.file${GOOGLE_MAIL_SEND_SCOPE ? ` ${GOOGLE_MAIL_SEND_SCOPE}` : ''}`;

export const getConfiguredDriveClientId = () =>
  String(GOOGLE_DRIVE_CLIENT_ID || '').trim();

/** HTTPS endpoint that exchanges authorization codes / refresh tokens for
 *  Google access tokens (holds the OAuth client secret server-side). */
const getTokenExchangeUrl = () => String(GOOGLE_TOKEN_EXCHANGE_URL || '').trim();

// ── Shared "Lab Workspace" server mode ─────────────────────────────────────
// GOOGLE_TOKEN_EXCHANGE_URL points at a small HTTPS server (see server/) that
// holds the workspace OWNER's permanent Drive refresh token and mints short-
// lived access tokens for every browser. In this mode nobody connects their
// own Google Drive — the app just asks the server for a fresh token whenever
// one is needed, and the "not connected" state cannot happen anymore. (Only
// the Drive step changes: the app login and every permission stay exactly as
// configured.)
export const sharedWorkspaceMode = () =>
  !!getTokenExchangeUrl() && GOOGLE_DRIVE_SHARED_MODE !== false;

/** True when this page load is the OWNER's one-time bootstrap: appending
 *  "?drive-bootstrap=1" to the URL is the ONLY situation in shared mode where
 *  a Google consent popup may appear (the server stores the permanent token).
 *
 *  The flag is captured HERE at module load, because the app later rewrites
 *  window.location.search to "?dataset=…" (window.history.pushState) when it
 *  opens a shared dataset — which would otherwise silently erase
 *  "drive-bootstrap=1" before the user clicks the button. */
let bootstrapRequestedAtLoad = false;
try {
  bootstrapRequestedAtLoad = typeof window !== 'undefined' &&
    !!window.location &&
    new URLSearchParams(window.location.search).has('drive-bootstrap');
} catch { bootstrapRequestedAtLoad = false; }

const workspaceBootstrapMode = () => {
  if (bootstrapRequestedAtLoad) return true;
  try {
    return typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).has('drive-bootstrap');
  } catch { return false; }
};

/** Whether THIS page load was opened with "?drive-bootstrap=1" in the URL —
 *  captured once at module load, before any pushState rewrite. Components use
 *  it to show the owner the one-time shared-Drive setup UI. */
export const driveBootstrapRequestedAtLoad = () => bootstrapRequestedAtLoad;

// Last workspace-server problem, so the UI can explain failures:
//   null  → no failure yet
//   'not_initialized' → server is up, but the owner never stored the credential
//   'unreachable'     → network error / HTTP error / timeout
let workspaceServerIssue = null;
let lastSharedDriveConnectedAt = 0;
export const getWorkspaceServerIssue = () => workspaceServerIssue;

// Precise reason of the last failed Drive-connect attempt (shared bootstrap debug).
let lastDriveConnectError = '';
const setLastDriveConnectError = (message) => {
  lastDriveConnectError = String(message || '');
  if (lastDriveConnectError) console.warn('[drive] connect failed:', lastDriveConnectError);
};
export const getLastDriveConnectError = () => lastDriveConnectError;

/** Ask the workspace server to mint a short-lived access token from the stored
 *  permanent refresh token ({ grant_type: 'workspace' }). Stores the returned
 *  token and CLEARS any legacy per-browser refresh token (the permanent
 *  credential lives server-side only). Resolves true on success. */
const mintWorkspaceAccessToken = async () => {
  const res = await postToTokenExchange({ grant_type: 'workspace' });
  const body = res.json || {};
  if (res.ok && body.access_token) {
    workspaceServerIssue = null;
    lastSharedDriveConnectedAt = Date.now();
    setDriveToken(body.access_token, body.expires_in);
    setStoredRefreshToken('');
    return true;
  }
  workspaceServerIssue =
    (body.error === 'workspace_not_initialized' || res.status === 503)
      ? 'not_initialized' : 'unreachable';
  console.warn('Workspace token mint failed:',
    res.error || body.error_description || body.error || `HTTP ${res.status}`);
  return false;
};

/** Shared-mode bootstrap at app load: mint a token right away so that every
 *  getDriveToken() / driveFetch() gate below finds one ready when the UI asks.
 *  The success event is re-announced after ~1.5 s because components attach
 *  their 'lab:drive-connected' listener only after first mount and would
 *  otherwise miss the very first (very early) mint. */
const kickOffSharedWorkspaceToken = () => {
  if (!sharedWorkspaceMode() || getDriveToken()) return;
  renewDriveTokenSilently().then((ok) => {
    if (!ok) return;
    notifyDriveConnected();
    setTimeout(() => notifyDriveConnected(), 1500);
  });
};

// ── Refresh-token persistence ─────────────────────────────────────────────
// The refresh token is what makes the Drive connection permanent. It is
// returned ONLY by the token-exchange endpoint (access_type=offline), which is
// why a configured endpoint matters: without one, Google refuses to hand a
// refresh token to a pure client-side flow.
const REFRESH_TOKEN_KEY = 'labDriveRefreshToken';
const getStoredRefreshToken = () => {
  try { return localStorage.getItem(REFRESH_TOKEN_KEY) || ''; } catch { return ''; }
};
const setStoredRefreshToken = (token) => {
  try {
    if (token) localStorage.setItem(REFRESH_TOKEN_KEY, String(token));
    else localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch { /* ignore */ }
};

let gisLoaded = false;
const loadGis = () =>
  new Promise((resolve, reject) => {
    if (window.google && window.google.accounts) return resolve();
    if (gisLoaded) return resolve();
    gisLoaded = true;
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the Google sign-in script.'));
    document.head.appendChild(s);
  });

/** One GIS token-client request. `promptValue`: '' = silent (no UI), 'consent'
 *  forces the consent screen on the initial authorization. Resolves the full
 *  token response ({access_token, expires_in}) or null. */
const requestGisToken = (clientId, promptValue) =>
  new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const guard = setTimeout(() => done(null), 12000); // never hang if no callback arrives
    try {
      const params = {
        client_id: clientId,
        scope: GOOGLE_AUTH_SCOPES,
        callback: (resp) => {
          clearTimeout(guard);
          done(resp && resp.access_token ? resp : null);
        },
        error_callback: () => { clearTimeout(guard); done(null); }
      };
      if (promptValue) params.prompt = promptValue;
      const client = window.google.accounts.oauth2.initTokenClient(params);
      client.requestAccessToken();
    } catch { clearTimeout(guard); done(null); }
  });

/** Obtain an OAuth authorization code (GIS popup) — the first step of the
 *  offline/refresh-token flow. */
const requestGisCode = (clientId) =>
  new Promise((resolve) => {
    let settled = false;
    const done = (code) => { if (!settled) { settled = true; resolve(code || ''); } };
    try {
      const client = window.google.accounts.oauth2.initCodeClient({
        client_id: clientId,
        scope: GOOGLE_AUTH_SCOPES,
        ux_mode: 'popup',
        redirect_uri: 'postmessage',
        callback: (resp) => done(resp && resp.code ? resp.code : ''),
        error_callback: () => done('')
      });
      client.requestCode();
    } catch { done(''); }
  });

/** POST a JSON body to the configured token-exchange endpoint (the server holds
 *  the Google OAuth client secret and, in shared mode, the permanent refresh
 *  token). Always resolves (never throws):
 *    { ok:true,  json }                 — 2xx with a parsed JSON body
 *    { ok:false, error, status, json }  — HTTP / network / parse failure
 *  A 15 s timeout keeps mints and renewals from hanging the UI when the
 *  workspace server is unreachable. */
const postToTokenExchange = async (body) => {
  const url = getTokenExchangeUrl();
  if (!url) return { ok: false, error: 'No token-exchange server is configured.', status: 0, json: null };
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 15000) : null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    });
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    if (!res.ok) {
      const error = (json && (json.error_description || (json.error && json.error.message)))
        || (json && json.error) || `Server error (HTTP ${res.status})`;
      return { ok: false, error: String(error), status: res.status, json };
    }
    return { ok: true, json: json || {} };
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      json: null,
      error: aborted
        ? 'The Lab Workspace server did not answer (timeout) — the app will retry automatically.'
        : `Cannot reach the Lab Workspace server: ${(err && err.message) || 'network error'}`
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/** Persist an access token (+ optional refresh token) from an exchange response. */
const storeTokensFromResponse = (json) => {
  if (!json || !json.access_token) return false;
  setDriveToken(json.access_token, json.expires_in);
  if (json.refresh_token) setStoredRefreshToken(json.refresh_token);
  return true;
};

/** Connect to Google Drive.
 *
 *  SHARED WORKSPACE mode (GOOGLE_TOKEN_EXCHANGE_URL configured): ordinary users
 *  are NEVER shown a Google popup — the button simply asks the workspace server
 *  to mint a fresh token from the owner's stored refresh token. Only the OWNER's
 *  one-time bootstrap (?drive-bootstrap=1 in the URL) runs the GIS CODE flow, so
 *  the server can store the permanent refresh token as the shared credential.
 *
 *  Without a shared endpoint we run the OAuth CODE flow (access_type=offline,
 *  prompt=consent via the endpoint) so a permanent refresh token is returned
 *  and stored, and fall back to the GIS token client otherwise (asking for an
 *  explicit consent once so Google allows later SILENT renewals). */
export const connectDriveWithGis = async () => {
  const clientId = getConfiguredDriveClientId();

  if (sharedWorkspaceMode()) {
    if (!workspaceBootstrapMode()) {
      // Normal user (or plain retry): silent server mint, never a Google popup.
      const ok = await mintWorkspaceAccessToken();
      if (ok) { lastDriveConnectError = ''; return true; }
      clearDriveToken();
      setLastDriveConnectError(workspaceServerIssue === 'not_initialized'
        ? 'The shared server has no stored workspace credential yet.'
        : 'The shared server is unreachable.');
      return false;
    }
    // Owner bootstrap: one-time GIS consent whose refresh token is stored by
    // the server as the shared workspace credential.
    if (!clientId) {
      setLastDriveConnectError('No Drive OAuth client is configured (GOOGLE_DRIVE_CLIENT_ID is empty).');
      return false;
    }
    try { await loadGis(); } catch {
      setLastDriveConnectError('The Google Identity script failed to load — check the network or an ad-blocker.');
      return false;
    }
    const code = await requestGisCode(clientId);
    if (code) {
      const res = await postToTokenExchange({
        code,
        grant_type: 'authorization_code',
        access_type: 'offline',
        prompt: 'consent'
      });
      if (res.ok && res.json && res.json.access_token) {
        lastDriveConnectError = '';
        setDriveToken(res.json.access_token, res.json.expires_in);
        setStoredRefreshToken(''); // the permanent credential stays server-side only
        return true;
      }
      setLastDriveConnectError(
        res.ok
          ? 'The shared server answered but returned no access token.'
          : `The shared server refused the code: ${res.error || `HTTP ${res.status}`}`
      );
      return false;
    }
    setLastDriveConnectError(
      'Google returned no authorization code. Possible causes: this page origin is not in the OAuth '
      + 'client “Authorized JavaScript origins”, the consent screen is in Testing without this account '
      + 'added as a Test user, or the Google popup was closed/blocked.'
    );
    return false;
  }

  if (!clientId) return false;
  try { await loadGis(); } catch { return false; }

  // 1) Offline code flow → refresh token (permanent connection).
  if (getTokenExchangeUrl()) {
    const code = await requestGisCode(clientId);
    if (code) {
      const res = await postToTokenExchange({
        code,
        grant_type: 'authorization_code',
        access_type: 'offline',
        prompt: 'consent'
      });
      if (res.ok && storeTokensFromResponse(res.json)) return true;
    }
  }

  // 2) Classic GIS token flow. `prompt: 'consent'` guarantees the user sees the
  //    authorisation once — required for Google to allow silent renewals later.
  const resp = await requestGisToken(clientId, 'consent');
  if (resp && resp.access_token) {
    setDriveToken(resp.access_token, resp.expires_in);
    return true;
  }
  clearDriveToken();
  return false;
};


// ── Always-connected Drive: silent token renewal ────────────────────────────
// Google Drive access tokens expire after ~1 hour. Instead of making users
// reconnect manually every hour, the app now:
//   1. renews the token silently ~5 min BEFORE it expires (GIS re-uses the
//      consent already granted — no password popup when Google can do it
//      silently), and
//   2. automatically retries a request once with a fresh token when Google
//      answers 401 (expired mid-request).
// If the browser blocks Google's silent flow (third-party cookies / ITP) the
// manual "Connect Google Drive" button remains available, but the common cases
// no longer interrupt anyone.
const notifyDriveConnected = () => { try { window.dispatchEvent(new CustomEvent('lab:drive-connected')); } catch { /* ignore */ } };
const notifyDriveDisconnected = () => { try { window.dispatchEvent(new CustomEvent('lab:drive-disconnected')); } catch { /* ignore */ } };

let renewPromise = null;

/** Renew the Drive access token with NO user interaction:
 *  • shared workspace mode → mint a fresh token from the workspace server (the
 *    permanent refresh token lives there only; this also self-heals a browser
 *    whose previous token expired while the server was briefly unreachable);
 *  • personal mode:
 *    1. when a refresh token is stored, it is exchanged through the configured
 *       token endpoint (refresh tokens never expire) — this is what makes the
 *       connection permanent, even days/weeks later;
 *    2. otherwise ask GIS for a silent token (works while the Google account is
 *       still signed in and the earlier consent is still valid).
 *  Resolves true when a fresh access token was stored. */
export const renewDriveTokenSilently = () => {
  if (renewPromise) return renewPromise;
  renewPromise = (async () => {
    if (sharedWorkspaceMode()) {
      return mintWorkspaceAccessToken();
    }
    // 1) Permanent path — stored refresh token → new access token (no UI).
    const refreshToken = getStoredRefreshToken();
    if (refreshToken) {
      const res = await postToTokenExchange({ refresh_token: refreshToken });
      if (res.ok && res.json && res.json.access_token) {
        storeTokensFromResponse(res.json);
        return true;
      }
      // Exchange failed (revoked/expired?) → drop it so the fallbacks below run.
      setStoredRefreshToken('');
    }
    // 2) GIS silent renewal while the user session allows it.
    const clientId = getConfiguredDriveClientId();
    if (clientId) {
      try { await loadGis(); } catch { return false; }
      const resp = await requestGisToken(clientId, '');
      if (resp && resp.access_token) {
        setDriveToken(resp.access_token, resp.expires_in);
        return true;
      }
    }
    return false;
  })().finally(() => { renewPromise = null; });
  return renewPromise;
};

let renewTimer = null;
let renewInterval = null;
const scheduleAutoDriveRenew = () => {
  try {
    if (renewTimer) clearTimeout(renewTimer);
    const token = localStorage.getItem(TOKEN_KEY) || '';
    const exp = parseInt(localStorage.getItem(TOKEN_EXPIRY_KEY) || '0', 10);
    if (!token || !exp) return;
    const msLeft = exp - Date.now();
    if (msLeft <= 0) return;
    // Renew a few minutes before the token actually expires.
    const when = Math.max(2000, msLeft - 5 * 60 * 1000);
    renewTimer = setTimeout(() => {
      renewDriveTokenSilently().then((ok) => { if (ok) notifyDriveConnected(); });
    }, when);
  } catch { /* ignore */ }
};

/** Start the background keep-alive (run once when the module loads): keeps the
 *  token fresh across the whole session and heals it after a reload. In shared
 *  workspace mode it also re-mints every minute while the workspace server is
 *  unreachable / not initialised yet — Drive comes back WITHOUT any user action
 *  the moment the server answers again. */
const initDriveAutoRenew = () => {
  if (renewInterval || typeof window === 'undefined') return;
  scheduleAutoDriveRenew();
  renewInterval = setInterval(() => {
    try {
      const token = localStorage.getItem(TOKEN_KEY) || '';
      const exp = parseInt(localStorage.getItem(TOKEN_EXPIRY_KEY) || '0', 10);
      if (token && exp && Date.now() > exp - 6 * 60 * 1000 && Date.now() < exp) {
        renewDriveTokenSilently().then((ok) => { if (ok) notifyDriveConnected(); });
      } else if (!token && sharedWorkspaceMode()) {
        // No local token in shared mode: keep asking the workspace server until
        // it answers again (only notify "disconnected" if a working connection
        // was lost — a fresh browser that never got a token stays quiet).
        renewDriveTokenSilently().then((ok) => {
          if (ok) notifyDriveConnected();
          else if (lastSharedDriveConnectedAt > 0) notifyDriveDisconnected();
        });
      }
      // A dataset may have been opened since the last attempt: replay the
      // pending-upload queue for it whenever a token is usable.
      try { flushPendingUploads(); } catch { /* ignore */ }
    } catch { /* ignore */ }
  }, 60 * 1000);
};
if (typeof window !== 'undefined') {
  try { window.addEventListener('lab:drive-connected', () => scheduleAutoDriveRenew()); } catch { /* ignore */ }
  // Drive is (or just became) reachable → replay the pending-upload queue.
  // A small delay lets the freshly minted token land before the first upload.
  try { window.addEventListener('lab:drive-connected', () => setTimeout(() => { try { flushPendingUploads(); } catch { /* ignore */ } }, 700)); } catch { /* ignore */ }
  initDriveAutoRenew();
  kickOffSharedWorkspaceToken();
  // A page reload with a leftover queue: try once after startup (also covers
  // the personal mode where a stored refresh token is exchanged silently).
  setTimeout(() => { try { flushPendingUploads(); } catch { /* ignore */ } }, 3500);
}

// ── File-name registry: remember what context each uploaded file was named
//    from, so that renaming a project / test / protocol / section can rename
//    the corresponding Drive files to match. ───────────────────────────────
const FILE_REGISTRY_KEY = 'labDriveFileRegistry';

export const getDriveFileRegistry = () => {
  try { return JSON.parse(localStorage.getItem(FILE_REGISTRY_KEY) || '{}') || {}; } catch { return {}; }
};

const saveDriveFileRegistry = (reg) => {
  try { localStorage.setItem(FILE_REGISTRY_KEY, JSON.stringify(reg)); } catch { /* ignore */ }
};

/** Record an uploaded Drive file with the naming context that produced it
 *  and the folder chain ({name,id} from the app root down) it was uploaded to. */
export const registerDriveFile = (fileId, name, ctx, path = null) => {
  if (!fileId) return;
  const reg = getDriveFileRegistry();
  reg[fileId] = { name: String(name || ''), ctx: ctx || {}, path: path || null, at: Date.now() };
  saveDriveFileRegistry(reg);
};

/**
 * Best-effort: archive a raw file to Google Drive with the app's naming
 * convention. Used by the data importers (FCS, Jasco, Bruker, MD, ...) so that
 * EVERY file the user loads is also saved to Drive automatically.
 * @returns {Promise<boolean>} true if the file was saved to Drive
 */
export const archiveFileToDrive = async ({ file, ctx = {}, title = '', suffix = 'file' }) => {
  if (!file || !getDriveToken()) return false;
  try {
    const base = title || String(file.name || '').replace(/\.[^/.]+$/, '');
    const name = archiveFileDriveName({ file, ctx, title, suffix });
    await uploadLocalFile({ name, mimeType: file.type || 'application/octet-stream', file, ctx: { ...ctx, title: base, suffix } });
    return true;
  } catch (err) {
    console.warn('Drive archive failed:', err && err.message);
    return false;
  }
};

/** Le nom que PORTERA sur le Drive un fichier archivé par
 *  `archiveFileToDrive` : `<titre>_<scientifique>` + extension d'origine. Un
 *  module le calcule AVANT l'envoi pour pouvoir le RETENIR dans le dataset (le
 *  nom déposé est ce que la recherche par nom retrouve depuis un autre poste,
 *  même si l'envoi part en file de reprise). */
export const archiveFileDriveName = ({ file, ctx = {}, title = '', suffix = 'file' }) => {
  const base = title || String((file && file.name) || '').replace(/\.[^/.]+$/, '');
  return withExtension(suggestDriveFileName({ ...ctx, title: base, suffix }), (file && file.name) || 'file');
};

/** Pointeur minuscule (il voyage dans le dataset) vers une copie Drive — `null`
 *  quand l'envoi n'a pas abouti (hors ligne : la recherche par nom le retrouvera
 *  dès que la file de reprise l'aura déposé). `id` = l'identifiant exact, donc
 *  insensible à un renommage du fichier sur le Drive. */
export const driveFilePointer = (res, fallbackName = '') => (
  res && (res.id || res.url || res.driveUrl)
    ? {
      id: String(res.id || ''),
      name: String(res.name || fallbackName || ''),
      url: String(res.url || res.driveUrl || '')
    }
    : null
);

/** Comme `archiveFileToDrive`, mais rend de quoi écrire un POINTEUR de
 *  restauration : `{ name, pointer, error }`. Le nom (celui du Drive) est rendu
 *  même quand l'envoi échoue — c'est lui que cherchera la restauration par nom
 *  sur un poste vierge ; `pointer` est null dans ce cas (rien à viser par id) et
 *  `error` dit POURQUOI l'envoi n'a pas abouti (l'appelant l'affiche : un échec
 *  muet laissait croire à une archive qui n'existait pas).
 *  `onProgress(octetsConfirmés, total)` est passé à l'envoi : les gros fichiers
 *  partant par morceaux, l'interface peut annoncer leur avancement.
 *  Le nommage reste EXACTEMENT celui d'`archiveFileToDrive` : rien ne change
 *  dans l'arborescence du Drive.
 *  @returns {Promise<{ name: string, pointer: {id:string,name:string,url:string}|null, error: string }>} */
export const archiveFileToDriveWithPointer = async ({ file, ctx = {}, title = '', suffix = 'file', onProgress = null }) => {
  const name = archiveFileDriveName({ file, ctx, title, suffix });
  if (!file || !getDriveToken()) {
    return { name, pointer: null, error: 'Google Drive is not connected in this browser.' };
  }
  const base = title || String(file.name || '').replace(/\.[^/.]+$/, '');
  try {
    const res = await uploadLocalFile({ name, mimeType: file.type || 'application/octet-stream', file, ctx: { ...ctx, title: base, suffix }, onProgress });
    const pointer = driveFilePointer(res, name);
    if (pointer) return { name, pointer, error: '' };
    /* L'ÉCHEC SE DIT : la copie de référence du fichier n'est PAS sur le Drive,
       donc elle n'existe que dans ce navigateur. Un fichier plus gros que la file
       de reprise (MAX_SINGLE_BYTES) n'y est même pas mis : c'est écrit noir sur
       blanc au lieu d'un « archivé » trompeur. */
    const tooLarge = Number(file.size || 0) > MAX_SINGLE_BYTES;
    return {
      name,
      pointer: null,
      error: tooLarge
        ? `the file is too large for the retry queue (${Math.round(MAX_SINGLE_BYTES / 1048576)} MB max) — keep this browser open and press again`
        : 'the upload did not complete (network, session or permission) — it is queued and retried on its own'
    };
  } catch (err) {
    console.warn('Drive archive failed:', err && err.message);
    return { name, pointer: null, error: String((err && err.message) || 'Drive upload failed.') };
  }
};

/**
 * Upload a file into a subfolder (or nested path) directly inside the app's
 * "Lab Workspace" root folder on Drive. Unlike uploadLocalFile the folder is
 * resolved from the WORKSPACE root, not the dataset folder, so e.g. the weekly
 * HTML autosave lands in
 *   <Lab Workspace>/<dataset>/backups/<name>
 * — one `backups` subfolder per dataset (the caller passes "<dataset>/backups"
 * via `folder`), instead of piling every dataset into a single shared "backups"
 * folder. A file with the same name inside the same folder is overwritten
 * instead of piling up duplicates.
 * @returns {Promise<{id:string,name:string}|null>} the Drive file, or null on failure
 */
export const uploadWorkspaceFile = async ({ name, mimeType, file, folder = 'backups' }) => {
  if (!name || !file) return null;
  // Nextcloud provider — mirror Drive: Lab Workspace/<folder>/<file>.
  if (getCloudProvider() === 'nextcloud') {
    if (!nextcloudConfigured()) return null;
    const segments = ['Lab Workspace', ...String(folder || 'backups').split('/').filter(Boolean).map((s) => sanitizeSlug(String(s)))];
    try {
      const res = await ncUploadFile({ parts: segments, name, mimeType, file });
      return res ? { id: String(res.id), name: String(res.name || name) } : null;
    } catch (err) {
      console.warn('Nextcloud workspace upload failed:', err && err.message);
      return null;
    }
  }
  if (!getDriveToken()) return null;
  try {
    const workspaceId = await ensureLabWorkspaceFolder();
    if (!workspaceId) return null;
    // `folder` may be a nested path (e.g. "<dataset>/backups") — resolve each
    // segment so every dataset's backups live in their own subfolder.
    let folderId = workspaceId;
    for (const seg of String(folder || 'backups').split('/')) {
      const name = seg.trim();
      if (!name) continue;
      folderId = await findOrCreateFolder(name, folderId);
    }

    const blob = typeof file === 'string' ? dataUrlToBlob(file) : file;
    const type = mimeType || blob.type || 'application/octet-stream';

    // Find an existing file with the same name so we overwrite instead of duplicating.
    let existingId = '';
    try {
      const safeName = String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const q = encodeURIComponent(`name='${safeName}' and '${folderId}' in parents and trashed=false`);
      const listRes = await driveFetch(`/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=10`);
      const list = await listRes.json();
      existingId = ((list.files || [])[0] || {}).id || '';
    } catch { /* listing failed — fall back to a plain (new) upload */ }

    const boundary = 'labBoundary' + Date.now() + Math.random().toString(36).slice(2);
    const meta = JSON.stringify(existingId
      ? { name, mimeType: type }
      : { name, mimeType: type, parents: [folderId] });

    /* Même règle que pour les envois d'expérience : au-delà de
       `RESUMABLE_MIN_BYTES` (une sauvegarde HTML hebdomadaire peut peser
       plusieurs Mo), le fichier part par MORCEAUX — avec reprise — et l'envoi en
       une seule requête reste le repli si la session est refusée. */
    let fileMeta = null;
    if (shouldChunkUpload(blob.size)) {
      fileMeta = await uploadBlobInChunks({ blob, name, mimeType: type, targetId: folderId, existingId, driveFetch });
    }
    if (!fileMeta) {
      const pre = new Blob(
        [`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`],
        { type: 'multipart/related' }
      );
      const post = new Blob([`\r\n--${boundary}--\r\n`], { type: 'multipart/related' });
      const body = new Blob([pre, blob, post], { type: `multipart/related; boundary=${boundary}` });

      const res = await driveFetch(
        existingId
          ? `/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id,name`
          : `/upload/drive/v3/files?uploadType=multipart&fields=id,name`,
        // Weekly backup HTML files can be several MB — allow a long transfer time.
        { method: existingId ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body, timeout: 10 * 60 * 1000 }
      );
      fileMeta = await res.json();
    }
    if (!fileMeta || !fileMeta.id) return null;
    return { id: String(fileMeta.id), name: String(fileMeta.name || name) };
  } catch (err) {
    console.warn('Workspace file upload failed:', err && err.message);
    return null;
  }
};

/**
 * Keep the Drive file tree in sync when a naming context value changes.
 *
 *  • project / test / instance / protocol rename → the matching Drive FOLDER is
 *    renamed in place (all files inside follow automatically), so the folder
 *    name always mirrors the current entity name.
 *  • structural changes (oldValue === '' — e.g. a test being added to a
 *    project) → every matching file is MOVED to the new leaf folder.
 *
 * `scope` (optional) restricts the rename to files whose context also matches
 * every { field: value } it lists.
 * @returns {Promise<number>} number of files updated
 */
export const renameDriveFilesFor = async ({ field, oldValue, newValue, scope = null }) => {
  if (!field || oldValue === undefined || newValue === undefined) return 0;
  if (String(oldValue) === String(newValue)) return 0;
  if (!getDriveToken()) return 0;

  const reg = getDriveFileRegistry();
  const matches = Object.entries(reg).filter(([, entry]) => {
    if (!entry || entry.deleted) return false; // never revive files marked as deleted
    const ctx = entry.ctx || {};
    const ctxValue = String(ctx[field] || '');
    const inCtx = ctxValue === String(oldValue);
    // Old uploads may lack the field in ctx but still sit in a folder that
    // matches (e.g. the instance folder); only then fall back to the path.
    const ctxMissing = !ctxValue;
    const inPath = Array.isArray(entry.path) && entry.path.some(
      (seg) => seg && seg.name === sanitizeSlug(oldValue)
    );
    if (!inCtx && !(ctxMissing && inPath)) return false;
    // Optional extra context filter (e.g. only files of one test): every
    // key in `scope` must match the recorded naming context too.
    if (scope) {
      return Object.entries(scope).every(
        ([k, v]) => String(ctx[k] || '') === String(v)
      );
    }
    return true;
  });
  if (matches.length === 0) return 0;

  const FOLDER_FIELDS = ['protocol', 'scientist', 'project', 'test', 'section', 'subsection', 'instance'];
  const isFolderLevel = FOLDER_FIELDS.includes(field);

  // Phase 1 — plan each file: a folder rename (pure rename) or a file move
  // (structural change or the folder could not be located).
  const plans = [];
  for (const [fileId, entry] of matches) {
    // If the entry matched only via its stored path, its ctx may miss the old
    // value — assume the old value so pathIndexOf works.
    const oldCtx = { ...(entry.ctx || {}), [field]: oldValue };
    const newCtx = { ...oldCtx, [field]: newValue };
    const ext = /(\.[a-zA-Z0-9]{1,10})$/.exec(String(entry.name || ''))?.[1] || '';
    // The position of this field inside the ACTUAL folder path (a standalone
    // test has no project level, so there the test lives at index 0).
    const pathIndex = pathIndexOf(oldCtx, field);
    // The new folder name at that position, computed from the full context
    // (e.g. for protocols the folder is protocols/<protocol>, so renaming the
    // protocol renames the folder; the scientist is not a folder level).
    const newFolderName = (pathIndex >= 0 && String(newValue || '')) ? (driveFolderPath(newCtx)[pathIndex] || '') : '';
    const oldFolderName = pathIndex >= 0 ? (driveFolderPath(oldCtx)[pathIndex] || '') : '';
    let folderSeg = null;
    // When the field is being REMOVED (newValue === ''), the path structure
    // changes, so the folder must be MOVED, never renamed.
    if (isFolderLevel && String(oldValue) !== '' && String(newValue || '') && pathIndex >= 0) {
      try {
        const id = await resolveFolderIdAtPathIndex(oldCtx, entry.path, pathIndex);
        if (id) folderSeg = { id };
      } catch { /* folder lookup failed → the file will be moved instead */ }
    }
    plans.push({ fileId, entry, oldCtx, newCtx, folderSeg, ext, newFolderName, oldFolderName, pathIndex });
  }

  // Phase 2 — rename every affected folder once (renaming a folder moves ALL of
  // its children automatically, which is exactly what the app schema needs).
  const renamedFolderIds = new Set();
  for (const plan of plans) {
    if (!plan.folderSeg || renamedFolderIds.has(plan.folderSeg.id)) continue;
    try {
      await renameDriveFile(plan.folderSeg.id, plan.newFolderName || sanitizeSlug(newValue));
      renamedFolderIds.add(plan.folderSeg.id);
    } catch { plan.folderSeg = null; }
  }

  // Phase 3 — update the registry; move the files whose folder was not renamed.
  let count = 0;
  for (const plan of plans) {
    try {
      const { fileId, entry, newCtx, folderSeg, ext, newFolderName, oldFolderName } = plan;
      let newPath = entry.path || null;

      if (folderSeg && renamedFolderIds.has(folderSeg.id)) {
        // Folder renamed in place — the file already follows it; just update
        // the recorded folder-name segment (matched by NAME, so it also works
        // for paths recorded with an older folder order).
        newPath = (entry.path || []).map((seg) =>
          seg && seg.name === oldFolderName ? { ...seg, name: newFolderName || sanitizeSlug(newValue) } : seg
        );
      } else {
        // Structural change (or folder not found): move the file into the new
        // leaf folder, creating the folders as needed.
        const oldLeafChain = entry.path || null;
        const resolved = await resolveDrivePath(newCtx);
        await moveDriveFile(fileId, resolved.leafId);
        newPath = resolved.path;
        // The folder(s) the file just left are now empty (every tracked file of
        // this context moved with it) — trash them so the OLD path does not
        // linger on Drive. Only completely empty folders are trashed, so a
        // folder that still holds other files is never touched.
        if (oldLeafChain && oldLeafChain.length > 0) {
          try { await trashEmptyFolderChain(oldLeafChain); } catch { /* keep going */ }
        }
      }

      const newName = suggestDriveFileName(newCtx) + ext;
      if (newName !== entry.name) {
        try { await renameDriveFile(fileId, newName); } catch { /* keep going */ }
      }
      reg[fileId] = { ...entry, name: newName, ctx: newCtx, path: newPath, at: Date.now() };
      count++;
    } catch { /* skip files that cannot be updated (e.g. not app-created) */ }
  }

  if (count > 0) saveDriveFileRegistry(reg);
  return count;
};


/** The email/name of the Google account currently connected for Drive ('' if unknown). */
export const getDriveAccountEmail = async () => {
  if (!getDriveToken()) return '';
  try {
    const res = await driveFetch('/drive/v3/about?fields=user');
    const j = await res.json();
    const u = (j && j.user) || {};
    return String(u.emailAddress || u.displayName || '');
  } catch { return ''; }
};

/**
 * Mark every Google Drive file referenced by a value (test / project and all
 * of its attachments) as deleted by appending "_deleted" to its name.
 * @returns {Promise<number>} number of files renamed
 */
export const markAttachmentsDeleted = async (value) => {
  if (!getDriveToken()) return 0;
  const ids = extractDriveFileIds(value);
  let renamed = 0;
  for (const id of ids) {
    try {
      if (await markDriveFileDeleted(id)) renamed++;
    } catch { /* keep going */ }
  }
  return renamed;
};

/** Extract a folder id from a Drive folder URL, if any. */
export const extractDriveFolderId = (url) => {
  const u = String(url || '');
  const m = u.match(/\/drive\/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  const q = u.match(/[?&](?:folder|id)=([a-zA-Z0-9_-]+)/);
  if (q) return q[1];
  return '';
};
// ── Automatic e-mail sending via Gmail (Administration module) ───────────────
// The notifications of the devis/BC approval workflow are sent through the
// Gmail API, from the Google account already connected for Drive (its address
// should be the one configured in the Personnel table; when a different one is
// provided it becomes the Reply-To so answers go back to the right person).
const GMAIL_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const gmailToBase64 = (str) => {
  try {
    const bytes = new TextEncoder().encode(String(str));
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin);
  } catch {
    return '';
  }
};

const gmailBase64Url = (b64) =>
  b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* En-tête RFC 2047 : les sujets français (accents…) sont encodés en UTF-8. */
const gmailHeaderValue = (value) => {
  const v = String(value || '').replace(/[\r\n]/g, ' ').trim();
  if (!v) return '';
  if (/^[\x20-\x7E]+$/.test(v)) return v;
  const b64 = gmailToBase64(v);
  return b64 ? `=?UTF-8?B?${b64}?=` : v;
};

/* Message MIME complet, puis base64url (champ `raw` de l'API Gmail). */
const buildGmailRaw = ({ fromEmail, fromName = '', replyTo = '', to = [], subject = '', text = '' }) => {
  const fromLabel = String(fromName || '').trim();
  const lines = [];
  lines.push(`From: ${fromLabel && !/[<>\r\n]/.test(fromLabel) ? `${fromLabel} <${fromEmail}>` : fromEmail}`);
  if (replyTo && GMAIL_EMAIL_RE.test(replyTo) && replyTo.toLowerCase() !== String(fromEmail || '').toLowerCase()) {
    lines.push(`Reply-To: ${replyTo}`);
  }
  lines.push(`To: ${to.join(', ')}`);
  lines.push(`Subject: ${gmailHeaderValue(subject)}`);
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/plain; charset=utf-8');
  lines.push('Content-Transfer-Encoding: base64');
  lines.push('');
  const body = gmailToBase64(String(text || ''));
  for (let i = 0; i < body.length; i += 76) lines.push(body.slice(i, i + 76));
  return gmailBase64Url(gmailToBase64(lines.join('\r\n')));
};
/* Analyse d'une réponse d'erreur de l'API Gmail :
   - 'api_disabled'     : l'API Gmail n'est PAS activée dans le projet Google
                          Cloud du client OAuth (réponse « has not been used in
                          project … or it is disabled » / SERVICE_DISABLED).
                          Aucun consentement de reconnexion ne peut corriger
                          ça — action dans la console Google Cloud uniquement.
   - 'consent_missing'  : le compte a un jeton sans la portée gmail.send.
   - 'other'            : autre refus (politique, quota, réseau…). */
const gmailErrorKind = (json) => {
  const err = json && json.error;
  const msg = String((err && (err.message || err.error_description)) || '').toLowerCase();
  const details = JSON.stringify((Array.isArray(err && err.details) ? err.details : []) || []).toLowerCase();
  if (/has not been used in project|or it is disabled|service_disabled|accessnotconfigured/i.test(`${msg} ${details}`)) {
    return 'api_disabled';
  }
  if (/insufficient_permission|scope.*(denied|missing|forbidden)|forbidden|unauthorized_client/i.test(`${msg} ${details}`)) {
    return 'consent_missing';
  }
  return 'other';
};

/* Lien console « API Gmail » pour le projet du message d'erreur (sinon lien
   générique vers le client OAuth configuré). */
const gmailConsoleUrl = (json) => {
  const raw = String((json && json.error && (json.error.message || '')) || '');
  const fromUrl = raw.match(/project=(\d+)/i);
  const fromProj = raw.match(/project\s+(\d+)/i);
  const project = (fromUrl && fromUrl[1]) || (fromProj && fromProj[1])
    || String(getConfiguredDriveClientId()).split('-')[0];
  return `https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=${project}`;
};

/** Envoi automatique d'un e-mail via l'API Gmail du compte Google connecté
 *  (celui utilisé pour Drive). Ne lève jamais — renvoie
 *  { ok, id? } ou { ok:false, reason }. */
export const sendAdminGmail = async ({ to = [], subject = '', text = '', fromName = '', replyTo = '' } = {}) => {
  const unique = [...new Set((Array.isArray(to) ? to : [to])
    .map((s) => String(s || '').trim())
    .filter((s) => GMAIL_EMAIL_RE.test(s)))];
  if (!unique.length) {
    return { ok: false, reason: 'Aucune adresse e-mail renseignée (fiche Personnel).' };
  }
  const subjectText = String(subject || '').trim();
  const bodyText = String(text || '').trim();

  /* 1) Un jeton Google doit exister. En mode personnel on demande d'abord un
        jeton direct silencieux avec les deux portées (drive.file + gmail.send) :
        si l'utilisateur a déjà accepté la permission d'envoi, il ne verra
        jamais de popup ; sinon on retombe sur le renouvellement silencieux du
        jeton stocké (drive.file) et le 403 ci-dessous demandera le
        consentement complet une seule fois. */
  const ensureGmailToken = async () => {
    if (getDriveToken()) return true;
    if (sharedWorkspaceMode()) {
      await renewDriveTokenSilently();
      return !!getDriveToken();
    }
    const clientId = getConfiguredDriveClientId();
    if (clientId) {
      try { await loadGis(); } catch { /* ignoré */ }
      const silent = await requestGisToken(clientId, '');
      if (silent && silent.access_token) {
        setDriveToken(silent.access_token, silent.expires_in);
        return true;
      }
    }
    await renewDriveTokenSilently();
    return !!getDriveToken();
  };
  if (!(await ensureGmailToken())) {
    return {
      ok: false,
      reason: 'Aucun compte Google connecté — connectez « Google Drive » puis réessayez (ou utilisez le lien de secours).',
    };
  }
  let token = getDriveToken();

  /* 2) Expéditeur = le compte Google connecté (adresse lue sur Drive « about »). */
  let fromEmail = '';
  try {
    const about = await driveFetch('/drive/v3/about?fields=user');
    const j = await about.json();
    fromEmail = String(((j && j.user) || {}).emailAddress || '').trim();
  } catch { /* géré plus bas */ }
  if (!GMAIL_EMAIL_RE.test(fromEmail)) {
    return { ok: false, reason: 'Impossible de déterminer l’adresse e-mail du compte Google connecté.' };
  }
  const raw = buildGmailRaw({ fromEmail, fromName, replyTo, to: unique, subject: subjectText, text: bodyText });

  /* 3) POST gmail/v1/users/me/messages/send, avec renouvellement silencieux du
        jeton sur 401 et une demande de consentement (gmail.send) en secours. */
  const attempt = async (tok) => {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 30000) : null;
    try {
      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw }),
        signal: ctrl ? ctrl.signal : undefined,
      });
      let j = null;
      try { j = await res.json(); } catch { j = null; }
      return { status: res.status, j };
    } catch (err) {
      const msg = (err && err.name === 'AbortError')
        ? 'Gmail n’a pas répondu (délai dépassé).'
        : ((err && err.message) || 'Réseau injoignable.');
      return { status: 0, j: { error: { message: msg } } };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  let result = await attempt(token);
  if (result.status === 401) {
    clearDriveToken();
    await renewDriveTokenSilently();
    token = getDriveToken();
    if (token) result = await attempt(token);
  }
  if (result.status === 403 && gmailErrorKind(result.j) === 'api_disabled') {
    /* API Gmail désactivée dans le projet Google Cloud : aucune popup inutile —
       une reconnexion n'y changerait rien, seul l'activation console compte. */
    const url = gmailConsoleUrl(result.j);
    return {
      ok: false,
      consoleUrl: url,
      reason: 'Gmail a refusé l’envoi : l’API « Gmail » n’est pas activée dans le projet Google Cloud de l’application (la reconnexion de « Google Drive » ne suffit pas). Cliquez sur « Activer l’API Gmail » pour l’activer dans la console Google Cloud, puis attendez quelques minutes avant de réessayer.',
    };
  }
  if (result.status === 403 && !sharedWorkspaceMode() && getConfiguredDriveClientId() && GOOGLE_MAIL_SEND_SCOPE) {
    /* La permission gmail.send manque au jeton courant (connexion antérieure) :
       demander une seule fois le consentement complet (drive.file + gmail.send). */
    try { await loadGis(); } catch { /* ignoré */ }
    const upgraded = await requestGisToken(getConfiguredDriveClientId(), 'consent');
    if (upgraded && upgraded.access_token) {
      setDriveToken(upgraded.access_token, upgraded.expires_in);
      result = await attempt(upgraded.access_token);
    }
  }
  if (result.status >= 200 && result.status < 300) {
    return { ok: true, id: String((result.j && result.j.id) || '') };
  }
  const apiMsg = (result.j && result.j.error && (result.j.error.message || result.j.error_description))
    || `HTTP ${result.status || '?'}`;
  const kind = result.status === 403 ? gmailErrorKind(result.j) : 'other';
  const hint = sharedWorkspaceMode()
    ? 'Le propriétaire doit relancer une fois « ?drive-bootstrap=1 » en acceptant la permission « envoyer des e-mails » (gmail.send).'
    : (kind === 'consent_missing'
      ? 'Reconnectez « Google Drive » en acceptant la permission « envoyer des e-mails » puis réessayez.'
      : 'Vérifiez que l’API « Gmail » est activée dans la console Google Cloud du projet, ou utilisez le lien de secours ci-dessous.');
  return { ok: false, reason: `Gmail a refusé l’envoi : ${apiMsg}. ${hint}` };
};


