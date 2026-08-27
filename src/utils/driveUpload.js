/* =========================================================================
   src/utils/driveUpload.js
   Uploads locally-chosen files to the user's Google Drive, automatically
   renamed with the app's naming convention, into ONE tidy folder.

   How it works:
     1. The Google sign-in requests the "drive.file" OAuth scope (files the
        app creates only — nothing else is touched). The resulting Google
        access token is stored in sessionStorage.
     2. uploadLocalFile() PUTs the file to the Drive API (multipart upload)
        into a folder the app owns: the user's saved folder URL if provided,
        otherwise a "Lab Workspace" folder that is created automatically.
     3. The file is shared as "anyone with the link" so the app can display
        it (thumbnails/embed) and others can open it.

   Everything degrades gracefully: if no Drive token is available the caller
   still receives the file as a data URL (temporary in-app attachment).
   ========================================================================= */

const TOKEN_KEY = 'labDriveAccessToken';
const FOLDER_ID_KEY = 'labDriveFolderId';

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
export const uploadLocalFile = async ({ name, mimeType, file }) => {
  const folderId = await ensureDriveFolder();
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
    const re = /drive\.google\.com\/(?:file\/d\/|open\?.*?id=|uc\?.*?id=|thumbnail\?.*?id=|drive\/folders\/)([a-zA-Z0-9_-]{8,})/g;
    let m;
    while ((m = re.exec(value)) !== null) {
      if (out.indexOf(m[1]) === -1) out.push(m[1]);
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

/** Append "_deleted" to a Drive file's name (best-effort). */
export const markDriveFileDeleted = async (fileId) => {
  if (!fileId) return false;
  try {
    const res = await driveFetch(`/drive/v3/files/${fileId}?fields=id,name`);
    const meta = await res.json();
    if (!meta || !meta.name) return false;
    return await renameDriveFile(fileId, deletedNameOf(meta.name));
  } catch (err) {
    console.warn('Could not mark Drive file as deleted:', err && err.message);
    return false;
  }
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
