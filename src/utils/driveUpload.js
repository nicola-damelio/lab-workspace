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

const TOKEN_KEY = 'labDriveAccessToken';
const TOKEN_EXPIRY_KEY = 'labDriveAccessTokenExpiresAt';
const FOLDER_ID_KEY = 'labDriveFolderId';
const FOLDER_DATASET_KEY = 'labDriveFolderDatasetId';

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
const FOLDER_NAME_KEY = 'labDriveFolderName';
import { suggestDriveFileName, sanitizeSlug, driveFolderPath, DATASET_FOLDER_DIRS, datasetFolderSlug, canonicalPageSection, canonicalExperimentPath, projectNamesOf } from './driveNaming';
import { getCloudProvider, nextcloudConfigured, ncUploadFile } from './nextcloud';
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

/** Folder id the app uploads into (persisted so we don't re-create it). */
export const getDriveFolderId = () => {
  try { return localStorage.getItem(FOLDER_ID_KEY) || ''; } catch { return ''; }
};

export const setDriveFolderId = (id) => {
  try { localStorage.setItem(FOLDER_ID_KEY, String(id || '')); } catch { /* ignore */ }
};

/** The dataset id the cached folder id belongs to. Persisted alongside the
 *  folder id so a page reload does NOT lose the link between the dataset and
 *  its Drive folder — this is what lets the folder be RENAMED in place when
 *  the dataset title changes (instead of creating a second folder). */
const getDriveFolderDatasetId = () => {
  try { return localStorage.getItem(FOLDER_DATASET_KEY) || ''; } catch { return ''; }
};
const setDriveFolderDatasetId = (id) => {
  try { localStorage.setItem(FOLDER_DATASET_KEY, String(id || '')); } catch { /* ignore */ }
};
/** The folder name the cached id was created / last renamed with. */
const getDriveFolderName = () => {
  try { return localStorage.getItem(FOLDER_NAME_KEY) || ''; } catch { return ''; }
};
const setDriveFolderName = (name) => {
  try { localStorage.setItem(FOLDER_NAME_KEY, String(name || '')); } catch { /* ignore */ }
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
  const comma = String(dataUrl).indexOf(',');
  const meta = String(dataUrl).slice(0, comma);
  const b64 = String(dataUrl).slice(comma + 1);
  const mime = (/^data:([^;]+)/.exec(meta) || [])[1] || 'application/octet-stream';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
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
  const { timeout: timeoutMs = isFileDownload ? 10 * 60 * 1000 : 20000, ...rest } = opts;

  const perform = async (tok, attempt) => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetch(`https://www.googleapis.com${path}`, {
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
    if (!res.ok) {
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
let driveRootResolvedId = getDriveFolderDatasetId();   // dataset id of the cached labDriveFolderId
let driveRootResolvedName = getDriveFolderName();      // dataset-name the cached labDriveFolderId was created with

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
 *  'administration'). Called by App.jsx whenever the current dataset id,
 *  title or kind changes. */
export const setDriveRootContext = ({ id = '', name = '', kind = '' } = {}) => {
  const nextId = String(id || '');
  const nextName = String(name || '').trim();
  const nextKind = kind === 'administration' ? 'administration' : 'scientific';
  if (nextId === driveRootId && nextName === driveRootName && nextKind === driveRootKind) return;
  driveRootId = nextId;
  driveRootName = nextName;
  if (nextKind) driveRootKind = nextKind;
  // Switching to a DIFFERENT dataset → the cached folder id belongs to the
  // previous one: drop it so the new dataset gets its own folder. An EMPTY id
  // (nothing open yet / going back to the explorer) keeps the cache, so
  // re-opening the same dataset after a reload still knows its folder and can
  // rename it in place.
  if (nextId && nextId !== driveRootResolvedId) setDriveFolderId('');
};

/** Which dataset the CURRENT Drive context points to (for the pending-upload
 *  queue: an upload enqueued while dataset A was open must be flushed into
 *  dataset A's folder even if the user has opened dataset B in the meantime). */
export const getDriveRootAnchor = () => ({
  datasetId: driveRootId,
  rootFolderId: getDriveFolderId(),
  kind: driveRootKind
});

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

  // Otherwise find (or create) "Lab Workspace" at the Drive root.
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
};

/** List immediate children (files AND folders) of a Drive folder. */
export const listDriveChildren = async (parentId) => {
  if (!parentId || !getDriveToken()) return [];
  try {
    const q = encodeURIComponent(`'${parentId}' in parents and trashed=false`);
    const res = await driveFetch(`/drive/v3/files?q=${q}&fields=files(id,name,mimeType,size,webViewLink)&pageSize=1000`);
    const j = await res.json();
    return Array.isArray(j.files) ? j.files : [];
  } catch { return []; }
};

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
    const backupsId = await findFolderByName('backups', rootId);
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
    try {
      map[dir] = await findOrCreateFolder(dir, datasetRootId);
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

/** Resolve the upload root folder: "Lab Workspace" → the dataset folder inside
 *  it (when the dataset has a title). The dataset folder ALWAYS gets its own
 *  internal structure — the canonical five-folder tree for scientific datasets
 *  (projects/backups/protocols/storage/publications), or only backups +
 *  Budget_labo for an administration dataset — so uploads and weekly backups
 *  share one dataset directory and scientific folders are never created inside
 *  an administration base. */
export const ensureDriveFolder = async () => {
  const name = datasetFolderName();
  const saved = getDriveFolderId();

  // Fast path: the cached folder already belongs to this dataset and name.
  if (saved && driveRootResolvedId === driveRootId && driveRootResolvedName === name) {
    if (name) await ensureDatasetFolderStructure(saved).catch(() => {});
    return saved;
  }

  // Same dataset, but the title changed → rename the app-created dataset folder
  // in place so every already-uploaded file follows.
  if (name && saved && driveRootResolvedId === driveRootId && driveRootResolvedName && driveRootResolvedName !== name) {
    try {
      const metaRes = await driveFetch(`/drive/v3/files/${saved}?fields=id,name`);
      const meta = await metaRes.json();
      if (meta && meta.name === driveRootResolvedName) {
        await renameDriveFile(saved, name);
        driveRootResolvedName = name;
        setDriveFolderName(name);
        if (name) await ensureDatasetFolderStructure(saved).catch(() => {});
        return saved;
      }
    } catch { /* not app-created or gone → fall back to an old-name lookup */ }
  }

  // Same dataset, title changed, but the cached folder id is missing or stale
  // (e.g. after a tab/browser change): find the folder by its RECORDED name
  // under Lab Workspace and RENAME that one — never silently create a second
  // folder while the old one still exists on Drive.
  if (name && driveRootResolvedId === driveRootId && driveRootResolvedName && driveRootResolvedName !== name) {
    try {
      const workspaceId = await ensureLabWorkspaceFolder();
      const oldId = workspaceId ? await findFolderByName(driveRootResolvedName, workspaceId) : '';
      if (oldId) {
        await renameDriveFile(oldId, name);
        setDriveFolderId(oldId);
        setDriveFolderDatasetId(driveRootId);
        setDriveFolderName(name);
        driveRootResolvedName = name;
        if (name) await ensureDatasetFolderStructure(oldId).catch(() => {});
        return oldId;
      }
    } catch { /* fall through to a plain lookup/create */ }
  }

  const workspaceId = await ensureLabWorkspaceFolder();
  if (!workspaceId) return '';

  let rootId = workspaceId;
  if (name) {
    rootId = await findFolderByName(name, workspaceId);
    if (!rootId) rootId = await findOrCreateFolder(name, workspaceId);
  }

  if (rootId) {
    setDriveFolderId(rootId);
    setDriveFolderDatasetId(driveRootId);
    setDriveFolderName(name);
    driveRootResolvedId = driveRootId;
    driveRootResolvedName = name;
    if (name) await ensureDatasetFolderStructure(rootId).catch(() => {});
  }
  return rootId;
};

// ── App-schema FOLDER helpers ─────────────────────────────────────────────
// Files are organised on Drive inside folders that mirror the app schema:
//   <project>/<test>/<instance>/<section>/<file>
//   protocols/<protocol>/<file>
// The app only ever touches folders it created itself (drive.file scope).

/** Escape a value for a Drive files.list `q` query. */
const escapeDriveQuery = (v) => String(v || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** Find an existing app-created folder by exact name inside `parentId` ('' if missing). */
export const findFolderByName = async (name, parentId) => {
  if (!name || !parentId) return '';
  try {
    const q = encodeURIComponent(
      `name='${escapeDriveQuery(name)}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );
    const res = await driveFetch(`/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=10`);
    const j = await res.json();
    const found = (j.files || []).find((f) => f.name === name);
    return found ? String(found.id) : '';
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

/** Fetch a Drive file's id + name. Only files the app created are readable
 *  under the drive.file scope — external files throw and should be skipped. */
export const getDriveFileMeta = async (fileId) => {
  if (!fileId) throw new Error('No file id');
  const res = await driveFetch(`/drive/v3/files/${fileId}?fields=id,name,trashed`);
  const meta = await res.json();
  if (!meta || !meta.id) throw new Error('File not found');
  return { id: String(meta.id), name: String(meta.name || ''), trashed: Boolean(meta.trashed) };
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

/** Find a folder or create it (app-owned) inside `parentId`. */
export const findOrCreateFolder = async (name, parentId) => {
  const existing = await findFolderByName(name, parentId);
  if (existing) return existing;
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
};

/** Resolve (creating as needed) the folder chain described by explicit folder
 *  NAMES (each sanitized; empty segments skipped).
 *  @returns {{ leafId:string, path:Array<{name:string,id:string}> }} */
export const resolveDrivePathFromNames = async (names) => {
  let parent = await ensureDriveFolder();
  const path = [];
  for (const raw of names || []) {
    const name = sanitizeSlug(raw);
    if (!name) continue;
    parent = await findOrCreateFolder(name, parent);
    path.push({ name, id: parent });
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

    const projectsContainerId = await findOrCreateFolder('projects', root);
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
    const projectsContainerId = await findFolderByName('projects', root);

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
    // project" means "moved into the dataset's _unassigned project bucket"
    // (a hidden bucket inside projects/, never a stray folder at the root).
    const projectsFolderId = projectsContainerId || await findOrCreateFolder('projects', root);
    const unassignedFolderId = await findOrCreateFolder('_unassigned', projectsFolderId);
    const existingThere = await findFolderByName(sanitizeSlug(testName), unassignedFolderId);
    if (existingThere !== testFolderId) {
      // moveDriveFile removes the folder from ALL its current parents, so the
      // move can never leave a copy inside the project (no duplicate).
      await moveDriveFile(testFolderId, unassignedFolderId);
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
    // canonical projects/_unassigned/<test>/… layout.
    const unassignedSeg = { name: '_unassigned', id: unassignedFolderId };
    const projectsSeg = { name: 'projects', id: projectsFolderId };
    const reg = getDriveFileRegistry();
    let count = 0;
    for (const [fileId, entry] of Object.entries(reg)) {
      if (!entry || entry.deleted) continue;
      const ctx = entry.ctx || {};
      if (String(ctx.test || '') !== String(testName)) continue;
      if (String(ctx.project || '') !== String(projectName)) continue;
      const newCtx = { ...ctx, project: '' };
      const base = (Array.isArray(entry.path) ? entry.path : [])
        .filter((seg) => seg && seg.name !== 'projects' && seg.name !== '_unassigned' && seg.name !== sanitizeSlug(projectName));
      reg[fileId] = { ...entry, ctx: newCtx, path: [projectsSeg, unassignedSeg, ...base], at: Date.now() };
      count++;
    }
    if (count > 0) saveDriveFileRegistry(reg);
    return count;
  } catch (err) {
    console.warn('moveTestFolderOutOfProject failed:', err && err.message);
    // Fallback: move the individual files into projects/_unassigned/<test>.
    let moved = 0;
    try {
      const root = await ensureDriveFolder();
      const projectsFolderId = root ? await findOrCreateFolder('projects', root) : '';
      const unassignedFolderId = projectsFolderId ? await findOrCreateFolder('_unassigned', projectsFolderId) : '';
      const reg = getDriveFileRegistry();
      for (const [fileId, entry] of Object.entries(reg)) {
        if (!entry || entry.deleted) continue;
        const ctx = entry.ctx || {};
        if (String(ctx.test || '') !== String(testName)) continue;
        if (String(ctx.project || '') !== String(projectName)) continue;
        try {
          const newCtx = { ...ctx, project: '' };
          const resolved = await resolveDrivePath(newCtx);
          await moveDriveFile(fileId, unassignedFolderId || resolved.leafId);
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
const uploadDriveFileToFolderOnce = async ({ name, mimeType, file, ctx = null, path = null, folderNames = null }) => {
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
  let folderId = await ensureDriveFolder();
  let drivePath = null;
  if (Array.isArray(folderNames) && folderNames.length > 0) {
    const resolved = await resolveDrivePathFromNames(folderNames);
    folderId = resolved.leafId;
    drivePath = resolved.path;
  } else if (Array.isArray(path) && path.length > 0) {
    const resolved = await resolveDrivePathFromNames(path);
    folderId = resolved.leafId;
    drivePath = resolved.path;
  } else if (ctx && typeof ctx === 'object' && driveFolderPath(ctx).length > 0) {
    const resolved = await resolveDrivePath(ctx);
    folderId = resolved.leafId;
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
    const q = encodeURIComponent(`name='${safeName}' and '${folderId}' in parents and trashed=false`);
    const listRes = await driveFetch(`/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=10`);
    const list = await listRes.json();
    existingId = ((list.files || [])[0] || {}).id || '';
  } catch { /* listing failed — fall back to a plain (new) upload */ }

  const boundary = 'labBoundary' + Date.now() + Math.random().toString(36).slice(2);
  // For an update the file is already in the folder, so omit `parents`.
  const meta = JSON.stringify(existingId
    ? { name, mimeType: type }
    : { name, mimeType: type, parents: [folderId] });

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
  const fileMeta = await res.json();
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
export const saveUploadForRetry = async ({ name, mimeType, file, ctx = null, path = null, source = 'upload' } = {}) => {
  try {
    if (!name || !file || getCloudProvider() === 'nextcloud') return { queued: false, reason: 'unsupported' };
    const isDataUrl = typeof file === 'string' && String(file).indexOf('data:') === 0;
    const isBlob = !isDataUrl && typeof Blob !== 'undefined' && file instanceof Blob;
    if (!isDataUrl && !isBlob) return { queued: false, reason: 'unsupported' };
    const approxBytes = isDataUrl ? Math.ceil(String(file).length * 0.75) : (Number(file.size) || 0);
    if (approxBytes > MAX_SINGLE_BYTES) return { queued: false, reason: 'too_large' };
    const tag = payloadTagOf(file);
    const id = `pq_${hashQueueId([name, JSON.stringify(ctx || null), JSON.stringify(path || null), tag].join('|'))}`;
    return await enqueuePendingUpload({
      id,
      name,
      mimeType: mimeType || 'application/octet-stream',
      payload: file,
      ctx: ctx && typeof ctx === 'object' ? { ...ctx } : null,
      path: Array.isArray(path) ? path.slice() : null,
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
export const uploadLocalFile = async ({ name, mimeType, file, ctx = null, path = null, skipQueue = false }) => {
  const folderCtxs = [];
  if (ctx && typeof ctx === 'object' && String(ctx.test || '').trim() && ctx.protocol === undefined) {
    const projects = projectNamesOf(ctx);
    const projectList = projects.length ? projects : ['_unassigned']; // legacy safety net
    projectList.forEach((projectName) => {
      folderCtxs.push({ ...ctx, project: projectName, projectNames: [projectName] });
    });
  } else {
    folderCtxs.push(ctx);
  }

  let last = null;
  for (const singleCtx of folderCtxs) {
    // Explicit path arrays are kept, but the first segment is normalised to the
    // canonical lower-case page section when it is one ("Data" → "data",
    // "Experimental Conditions" → "experimental conditions", …).
    let folderNames = null;
    if (Array.isArray(path) && path.length > 0) {
      folderNames = [canonicalPageSection(path[0]), ...path.slice(1)];
    } else if (singleCtx && typeof singleCtx === 'object' && String(singleCtx.test || '').trim()) {
      folderNames = canonicalExperimentPath(singleCtx);
    }
    try {
      const res = await uploadDriveFileToFolderOnce({
        name, mimeType, file, ctx: singleCtx, path: folderNames ? null : path, folderNames
      });
      if (res) last = res;
    } catch (err) {
      // One linked project failing must not hide the others; the caller still
      // receives the last successful upload (or null when all failed).
      console.warn(`Drive upload failed for project "${(singleCtx && singleCtx.project) || ''}":`, err && err.message);
    }
  }
  if (!last && !skipQueue) {
    // Every folder copy failed → Drive is unreachable right now (token server
    // down / token expired / network error). Keep the file in the pending
    // queue so flushPendingUploads() replays it as soon as Drive answers
    // again, instead of losing it. The public contract is unchanged (null).
    await saveUploadForRetry({ name, mimeType, file, ctx, path, source: 'upload' }).catch(() => null);
  }
  return last;
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
    const name = withExtension(suggestDriveFileName({ ...ctx, title: base, suffix }), file.name || 'file');
    await uploadLocalFile({ name, mimeType: file.type || 'application/octet-stream', file, ctx: { ...ctx, title: base, suffix } });
    return true;
  } catch (err) {
    console.warn('Drive archive failed:', err && err.message);
    return false;
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
    const fileMeta = await res.json();
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


