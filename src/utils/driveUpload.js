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
const FOLDER_ID_KEY = 'labDriveFolderId';
import { suggestDriveFileName, sanitizeSlug, driveFolderPath } from './driveNaming';

/** The Google OAuth access token (with drive.file scope) from the last sign-in.
 *  Stored in localStorage so it survives tab switches / page reloads (the
 *  token itself still expires after ~1h and needs a re-connect then). */
export const getDriveToken = () => {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
};

export const setDriveToken = (token) => {
  try { localStorage.setItem(TOKEN_KEY, String(token || '')); } catch { /* ignore */ }
};

export const clearDriveToken = () => {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
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

const driveFetch = async (path, opts = {}) => {
  const token = getDriveToken();
  if (!token) throwCode('NO_TOKEN', 'Google Drive is not connected.');

  const res = await fetch(`https://www.googleapis.com${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) }
  });

  if (res.status === 401 || res.status === 403) {
    if (res.status === 401) {
      // The stored token expired or was revoked: forget it and let the UI
      // offer a fresh Google sign-in (the sidebar switches back to
      // "Connect Drive" instead of silently failing every upload).
      clearDriveToken();
      try { window.dispatchEvent(new CustomEvent('lab:drive-disconnected')); } catch { /* ignore */ }
    }
    throwCode('TOKEN_EXPIRED', 'Drive access expired — please reconnect Google Drive.');
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
let driveRootResolvedId = '';    // dataset id of the cached labDriveFolderId
let driveRootResolvedName = '';  // dataset-name the cached labDriveFolderId was created with

/** Tell the Drive layer which main file (dataset) is currently open, so the
 *  dataset folder on Drive (inside "Lab Workspace") is named after it.
 *  Called by App.jsx whenever the current dataset id or title changes. */
export const setDriveRootContext = ({ id = '', name = '' } = {}) => {
  const nextId = String(id || '');
  const nextName = String(name || '').trim();
  if (nextId === driveRootId && nextName === driveRootName) return;
  driveRootId = nextId;
  driveRootName = nextName;
  // Different dataset → the cached folder id belongs to the previous one:
  // drop it so the new dataset gets its own folder.
  if (nextId !== driveRootResolvedId) setDriveFolderId('');
};

/** Find (or create) the app's "Lab Workspace" root folder (inside the user's
 *  saved Drive folder URL if one is set, otherwise at the Drive root). */
const ensureLabWorkspaceFolder = async () => {
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

/** Resolve the upload root folder: "Lab Workspace" → the dataset folder inside
 *  it (when the dataset has a title). Everything else (projects, tests,
 *  sections, protocols, publications…) is created under this root. */
export const ensureDriveFolder = async () => {
  const name = driveRootName ? sanitizeSlug(driveRootName) : '';
  const saved = getDriveFolderId();

  // Fast path: the cached folder already belongs to this dataset and name.
  if (saved && driveRootResolvedId === driveRootId && driveRootResolvedName === name) {
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
        return saved;
      }
    } catch { /* not app-created or gone → resolve a fresh dataset folder */ }
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
    driveRootResolvedId = driveRootId;
    driveRootResolvedName = name;
  }
  return rootId;
};

// ── App-schema FOLDER helpers ─────────────────────────────────────────────
// Files are organised on Drive inside folders that mirror the app schema:
//   <project>/<test>/<instance>/<section>/<file>
//   protocols/<protocol>_<scientist>/<file>
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

/** Resolve (creating as needed) the folder chain described by `ctx`.
 *  @returns {{ leafId:string, path:Array<{name:string,id:string}> }} */
export const resolveDrivePath = async (ctx) => resolveDrivePathFromNames(driveFolderPath(ctx));

/** The index of a naming-context field inside the ACTUAL folder path
 *  (driveFolderPath order). -1 when the field is not a folder level or its
 *  value is empty. This follows the real path, so a test WITHOUT a project
 *  lives at index 0 (Lab Workspace → test → instance → …), not index 1. */
const pathIndexOf = (ctx, field) => {
  if (!ctx || typeof ctx !== 'object') return -1;
  if (field === 'project') return ctx.project ? 0 : -1;
  if (field === 'protocol' || field === 'scientist') return ctx.protocol ? 1 : -1;
  const value = field === 'test' ? ctx.test
    : field === 'section' ? ctx.section
      : field === 'subsection' ? ctx.subsection
        : field === 'instance' ? ctx.instance : '';
  if (!value) return -1;
  return driveFolderPath(ctx).indexOf(sanitizeSlug(value));
};

/** Resolve the folder id at a position of the ctx's actual folder path by
 *  walking the chain from the dataset root (lookup only — nothing is created).
 *  The stored path is searched by segment NAME (not index), so it also works
 *  for files recorded before the path layout was changed. Returns '' when the
 *  folder is missing. */
const resolveFolderIdAtPathIndex = async (ctx, path, index) => {
  const names = driveFolderPath(ctx);
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

/** Trash the Drive folder that mirrors a test, so ALL of its files (raw data,
 *  attachments, reports…) are removed together — the Drive mirrors the app:
 *  a test deleted here disappears from Drive too. */
export const deleteTestDriveFolder = async (test) => {
  if (!getDriveToken() || !test || !test.name) return 0;
  try {
    const root = await ensureDriveFolder();
    if (!root) return 0;
    let parent = root;
    const project = (test.projectNames || [])[0] || '';
    if (project) {
      parent = await findFolderByName(sanitizeSlug(project), parent);
      if (!parent) return 0;
    }
    let testFolderId = await findFolderByName(sanitizeSlug(test.name), parent);
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
    const testFolderId = await findFolderByName(sanitizeSlug(testName), root);
    if (!testFolderId) return 0; // no standalone test folder on Drive — nothing to move
    const projectFolderId = await findOrCreateFolder(sanitizeSlug(projectName), root);

    // Move the whole test folder into the project folder (children follow).
    const params = new URLSearchParams();
    params.set('addParents', projectFolderId);
    params.set('removeParents', root);
    await driveFetch(`/drive/v3/files/${testFolderId}?${params.toString()}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });

    // Keep the registry in sync: set ctx.project and prepend the project
    // folder to every recorded path of this (previously standalone) test.
    const reg = getDriveFileRegistry();
    let count = 0;
    for (const [fileId, entry] of Object.entries(reg)) {
      if (!entry || entry.deleted) continue;
      const ctx = entry.ctx || {};
      if (String(ctx.test || '') !== String(testName)) continue;
      if (String(ctx.project || '')) continue; // already inside a project folder
      const newPath = [
        { name: sanitizeSlug(projectName), id: projectFolderId },
        ...(Array.isArray(entry.path) ? entry.path : [])
      ];
      reg[fileId] = { ...entry, ctx: { ...ctx, project: projectName }, path: newPath, at: Date.now() };
      count++;
    }
    if (count > 0) saveDriveFileRegistry(reg);
    return count;
  } catch {
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
export const uploadLocalFile = async ({ name, mimeType, file, ctx = null, path = null }) => {
  // Upload into the leaf folder that mirrors the app schema
  // (<project>/<test>/<section>/<instance>/… or an explicit `path` like
  // publications/<scientist>/own_publications), creating folders as needed.
  let folderId = await ensureDriveFolder();
  let drivePath = null;
  if (Array.isArray(path) && path.length > 0) {
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
    { method: existingId ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body }
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

// ── Google Identity Services (proper Drive access) ─────────────────────────
// The standard Firebase Google sign-in cannot get the drive.file scope from
// Google. If GOOGLE_DRIVE_CLIENT_ID is configured, we use Google Identity
// Services to request a real Drive-access token.
import { GOOGLE_DRIVE_CLIENT_ID } from '../data/constants';

export const getConfiguredDriveClientId = () =>
  String(GOOGLE_DRIVE_CLIENT_ID || '').trim();

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

/** Request a Drive-access token via Google Identity Services (needs a configured client id). */
export const connectDriveWithGis = async () => {
  const clientId = getConfiguredDriveClientId();
  if (!clientId) return false;
  try { await loadGis(); } catch { return false; }
  return new Promise((resolve) => {
    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: (resp) => {
          if (resp && resp.access_token) {
            setDriveToken(resp.access_token);
            resolve(true);
          } else {
            clearDriveToken();
            resolve(false);
          }
        },
        error_callback: () => { clearDriveToken(); resolve(false); }
      });
      client.requestAccessToken();
    } catch {
      clearDriveToken();
      resolve(false);
    }
  });
};

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
    if (String(ctx[field] || '') !== String(oldValue)) return false;
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
    const oldCtx = entry.ctx || {};
    const newCtx = { ...oldCtx, [field]: newValue };
    const ext = /(\.[a-zA-Z0-9]{1,10})$/.exec(String(entry.name || ''))?.[1] || '';
    // The position of this field inside the ACTUAL folder path (a standalone
    // test has no project level, so there the test lives at index 0).
    const pathIndex = pathIndexOf(oldCtx, field);
    // The new folder name at that position, computed from the full context
    // (e.g. for protocols the folder is <protocol>_<scientist>, so renaming the
    // scientist renames the folder too).
    const newFolderName = pathIndex >= 0 ? (driveFolderPath(newCtx)[pathIndex] || '') : '';
    const oldFolderName = pathIndex >= 0 ? (driveFolderPath(oldCtx)[pathIndex] || '') : '';
    let folderSeg = null;
    if (isFolderLevel && String(oldValue) !== '' && pathIndex >= 0) {
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
