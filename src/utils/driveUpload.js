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
        folder along the way), under the user's saved folder URL if provided,
        otherwise a "Lab Workspace" folder that is created automatically.
     3. The file is shared as "anyone with the link" so the app can display
        it (thumbnails/embed) and others can open it.
     4. When a project / test / instance / protocol is renamed, the matching
        Drive FOLDER is renamed too; when a test is added to a project its
        files are moved under the project folder.

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

/** Resolve the target folder id: saved URL → saved id → 'Lab Workspace' (auto-created). */
export const ensureDriveFolder = async () => {
  const saved = getDriveFolderId();
  if (saved) return saved;

  // If the user saved a Drive folder URL, upload into that folder.
  let folderUrlId = '';
  try {
    const { getDriveFolderUrl } = await import('./driveNaming');
    folderUrlId = extractDriveFolderId(getDriveFolderUrl());
  } catch { /* ignore */ }
  if (folderUrlId) {
    setDriveFolderId(folderUrlId);
    return folderUrlId;
  }

  // Otherwise find (or create) a dedicated "Lab Workspace" folder.
  const q = encodeURIComponent(
    "name='Lab Workspace' and mimeType='application/vnd.google-apps.folder' and trashed=false"
  );
  const res = await driveFetch(`/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=10`);
  const j = await res.json();
  const existing = (j.files || []).find((f) => f.name === 'Lab Workspace');
  if (existing) {
    setDriveFolderId(existing.id);
    return existing.id;
  }

  const c = await driveFetch('/drive/v3/files?fields=id,name', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Lab Workspace', mimeType: 'application/vnd.google-apps.folder' })
  });
  const created = await c.json();
  setDriveFolderId(created.id);
  return created.id;
};

// ── App-schema FOLDER helpers ─────────────────────────────────────────────
// Files are organised on Drive inside folders that mirror the app schema:
//   <project>/<test>/<section>/<instance>/<file>
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

/** Resolve (creating as needed) the folder chain described by `ctx`.
 *  @returns {{ leafId:string, path:Array<{name:string,id:string}> }} */
export const resolveDrivePath = async (ctx) => {
  const names = driveFolderPath(ctx);
  let parent = await ensureDriveFolder();
  const path = [];
  for (const name of names) {
    parent = await findOrCreateFolder(name, parent);
    path.push({ name, id: parent });
  }
  return { leafId: parent, path };
};

/** The folder name that belongs to a schema level for a naming context. */
const segmentNameAt = (ctx, level) => {
  if (ctx.protocol) {
    // Protocol path: ['protocols', '<protocol>_<scientist>']
    if (level === 0) return 'protocols';
    if (level === 1) return [ctx.protocol, ctx.scientist].filter(Boolean).join('_');
    return '';
  }
  if (level === 0) return ctx.project || '';
  if (level === 1) return ctx.test || '';
  if (level === 2) return ctx.section || '';
  if (level === 3) return ctx.instance || '';
  return '';
};

/** Resolve the folder id at a schema level by walking the chain from the root
 *  (lookup only — nothing is created). Returns '' when the folder is missing. */
const resolveFolderIdAtLevel = async (ctx, path, level) => {
  if (path && path[level] && path[level].id) return String(path[level].id);
  if (level === 0) {
    const rootId = await ensureDriveFolder();
    const name = sanitizeSlug(segmentNameAt(ctx, 0));
    return name ? findFolderByName(name, rootId) : '';
  }
  let parent = await ensureDriveFolder();
  for (let i = 0; i <= level - 1; i++) {
    if (path && path[i] && path[i].id) { parent = String(path[i].id); continue; }
    const name = sanitizeSlug(segmentNameAt(ctx, i));
    if (!name) return '';
    parent = await findFolderByName(name, parent);
    if (!parent) return '';
  }
  const own = sanitizeSlug(segmentNameAt(ctx, level));
  return own ? findFolderByName(own, parent) : '';
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
export const uploadLocalFile = async ({ name, mimeType, file, ctx = null }) => {
  // Upload into the leaf folder that mirrors the app schema
  // (<project>/<test>/<section>/<instance>/…), creating the folders as needed.
  let folderId = await ensureDriveFolder();
  let drivePath = null;
  if (ctx && typeof ctx === 'object' && driveFolderPath(ctx).length > 0) {
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

  const FIELD_LEVEL = { protocol: 1, scientist: 1, project: 0, test: 1, section: 2, instance: 3 };
  const level = FIELD_LEVEL[field]; // undefined → the field is not a folder level
  const isFolderLevel = level !== undefined;

  // Phase 1 — plan each file: a folder rename (pure rename) or a file move
  // (structural change or the folder could not be located).
  const plans = [];
  for (const [fileId, entry] of matches) {
    const oldCtx = entry.ctx || {};
    const newCtx = { ...oldCtx, [field]: newValue };
    const ext = /(\.[a-zA-Z0-9]{1,10})$/.exec(String(entry.name || ''))?.[1] || '';
    // The new folder name at the changed level, computed from the full context
    // (e.g. for protocols the folder is <protocol>_<scientist>, so renaming the
    // scientist renames the folder too).
    const newFolderName = driveFolderPath(newCtx)[level] || '';
    let folderSeg = null;
    if (isFolderLevel && String(oldValue) !== '') {
      try {
        const id = await resolveFolderIdAtLevel(oldCtx, entry.path, level);
        if (id) folderSeg = { id, name: sanitizeSlug(segmentNameAt(oldCtx, level)) };
      } catch { /* folder lookup failed → the file will be moved instead */ }
    }
    plans.push({ fileId, entry, oldCtx, newCtx, folderSeg, ext, newFolderName });
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
      const { fileId, entry, newCtx, folderSeg, ext, newFolderName } = plan;
      let newPath = entry.path || null;

      if (folderSeg && renamedFolderIds.has(folderSeg.id)) {
        // Folder renamed in place — the file already follows it; just update
        // the recorded folder-name segment.
        newPath = (entry.path || []).map((seg, i) =>
          i === level ? { ...seg, name: newFolderName || sanitizeSlug(newValue) } : seg
        );
      } else {
        // Structural change (or folder not found): move the file into the new
        // leaf folder, creating the folders as needed.
        const resolved = await resolveDrivePath(newCtx);
        await moveDriveFile(fileId, resolved.leafId);
        newPath = resolved.path;
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
