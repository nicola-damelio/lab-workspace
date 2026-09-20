/* =========================================================================
   src/utils/projectFiles.js
   "Useful files" — project-level reference documents (protocols, PDFs,
   spreadsheets, spectra …) attached to a project. The FILE always lives in
   Google Drive, in an explicit `useful_files` directory INSIDE the project
   folder of the canonical Drive tree:

       <Lab Workspace>/<dataset>/projects/<project>/useful_files/<file>

   The project object only keeps a light INDEX of what was uploaded
   (project.usefulFiles) so the list renders without querying Drive:

       [{ id, name, url, driveId, size, mime, addedBy, addedAt }]

   All helpers here are pure (no Drive / browser access) so they can be
   unit-tested and reused by the project page, the Drive helpers and imports.
   ========================================================================= */

import { DEFAULT_PROJECT_NAME, sanitizeSlug } from './driveNaming';

/** Container folder of the canonical Drive architecture. */
export const PROJECTS_DIR = 'projects';
/** Per-project directory holding the project's reference documents. */
export const USEFUL_FILES_DIR = 'useful_files';

/** Drive folder name of a project (the SAME slug the test uploads use). A file
 *  with no project goes to the DEFAULT project folder (`test`) — the bucket
 *  that used to be called `_unassigned`, which no longer means anything. */
export const projectFolderSlug = (projectName) => sanitizeSlug(projectName) || DEFAULT_PROJECT_NAME;

/** Folder path (folder NAMES, relative to the dataset folder) of a project's
 *  useful files: projects/<project>/useful_files. */
export const usefulFilesFolderPath = (projectName) => [
  PROJECTS_DIR, projectFolderSlug(projectName), USEFUL_FILES_DIR
];

/** Human-readable location, e.g. "My dataset / projects / CD_project / useful_files". */
export const usefulFilesFolderLabel = (projectName, datasetName = '') => {
  const segs = [];
  const ds = String(datasetName || '').trim();
  if (ds) segs.push(ds);
  segs.push(...usefulFilesFolderPath(projectName));
  return segs.join(' / ');
};

/** Base name of an attachment: the ORIGINAL name (extension stripped, slugged
 *  for the Drive tree). Unlike figures/documents the scientist is NOT appended —
 *  a "useful file" keeps its own readable name. '' when there is no name. */
export const usefulFileBaseName = (fileName) => {
  const raw = String(fileName || '').trim();
  if (!raw) return '';
  const stem = raw.replace(/\.[^/.]+$/, '');
  return sanitizeSlug(stem) || 'file';
};

/** Shareable URL of a Drive file ('' without an id). */
export const driveFileUrl = (fileId) => (
  fileId ? `https://drive.google.com/file/d/${String(fileId)}/view` : ''
);

/** URL of a Drive FOLDER ('' without an id). */
export const usefulFilesFolderUrl = (folderId) => (
  folderId ? `https://drive.google.com/drive/folders/${String(folderId)}` : ''
);

/** Human-readable size ("12 B", "1.4 MB", …); '' when unknown. */
export const formatFileSize = (bytes) => {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
};

/** Detect the Drive folder mime type returned by the Drive listing API. */
export const isDriveFolderMime = (mimeType) => (
  String(mimeType || '') === 'application/vnd.google-apps.folder'
);


/** Normalize ONE index entry (drops empty values, keeps the public shape).
 *  Returns null when there is neither a name nor a link. */
export const normalizeProjectFile = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim();
  const url = String(raw.url || raw.data || '').trim();
  const driveId = String(raw.driveId || raw.driveID || '').trim();
  if (!name && !url && !driveId) return null;
  const size = Number(raw.size);
  return {
    id: String(raw.id || '').trim() || `pf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: name || 'file',
    url: url || driveFileUrl(driveId),
    driveId,
    size: Number.isFinite(size) && size > 0 ? size : 0,
    mime: String(raw.mime || '').trim(),
    addedBy: String(raw.addedBy || '').trim(),
    addedAt: String(raw.addedAt || '').trim()
  };
};

/** Normalize a whole index: malformed entries are dropped, duplicate ids are
 *  collapsed (first occurrence wins). Always returns a new array. */
export const normalizeProjectFiles = (list) => {
  const out = [];
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach((raw) => {
    const file = normalizeProjectFile(raw);
    if (!file || seen.has(file.id)) return;
    seen.add(file.id);
    out.push(file);
  });
  return out;
};

/** Identity of an indexed file: the Drive file when known, else its link,
 *  else its local id. Used to avoid listing the same file twice. */
const fileKeyOf = (file) => (
  file.driveId ? `d:${file.driveId}` : file.url ? `u:${file.url}` : `i:${file.id}`
);

/** Append a file to the index. Re-uploading the same Drive file (or the same
 *  link) REPLACES its entry — the Drive upload overwrites by name, so the index
 *  must not duplicate it (the original entry id is kept, so React keys are
 *  stable). Returns a new array. */
export const addProjectFile = (list, entry) => {
  const base = normalizeProjectFiles(list);
  const file = normalizeProjectFile(entry);
  if (!file) return base;
  const key = fileKeyOf(file);
  const idx = base.findIndex((f) => fileKeyOf(f) === key);
  if (idx === -1) return [...base, file];
  const next = base.slice();
  next[idx] = { ...base[idx], ...file, id: base[idx].id };
  return next;
};

/** Remove ONE file from the index (by entry id). Returns a new array. */
export const removeProjectFile = (list, id) => {
  const target = String(id || '');
  return normalizeProjectFiles(list).filter((f) => f.id !== target);
};

/** Newest first (stable when the timestamps match). */
export const sortProjectFiles = (list) => normalizeProjectFiles(list)
  .slice()
  .sort((a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')));

/** Reconcile the index with a real Drive folder listing (listDriveChildren):
 *    • files already indexed KEEP their id/metadata (a missing local name only
 *      is filled in from Drive);
 *    • files found only in Drive are added — this is how a file uploaded from
 *      another browser, or replayed from the pending-upload queue, appears;
 *    • indexed files that are no longer in the folder (deleted/renamed in
 *      Drive) are dropped, because Drive is the source of truth;
 *    • entries WITHOUT a Drive id (a temporary in-app copy) are always kept.
 *  Folders reported by the listing are ignored. Returns a new array. */
export const mergeDriveListing = (list, listing, addedAt = '') => {
  const current = normalizeProjectFiles(list);
  // No listing at all (Drive not reachable / call failed): keep the index as is
  // — a refresh must NEVER wipe the list when it has no information.
  if (!Array.isArray(listing)) return current;
  const byDriveId = new Map();
  current.forEach((f) => { if (f.driveId) byDriveId.set(f.driveId, f); });

  const out = [];
  const seen = new Set();
  (Array.isArray(listing) ? listing : []).forEach((raw) => {
    const driveId = String((raw && raw.id) || '').trim();
    if (!driveId || seen.has(driveId)) return;
    if (isDriveFolderMime(raw && raw.mimeType)) return;
    seen.add(driveId);
    const listedName = String((raw && raw.name) || '').trim();
    const mime = String((raw && raw.mimeType) || '').trim();
    const listedUrl = String((raw && raw.webViewLink) || '').trim() || driveFileUrl(driveId);
    const listedSize = Number(raw && raw.size);
    const size = Number.isFinite(listedSize) && listedSize > 0 ? listedSize : 0;
    const prev = byDriveId.get(driveId);
    if (prev) {
      out.push({
        ...prev,
        name: prev.name || listedName || 'file',
        url: prev.url || listedUrl,
        mime: prev.mime || mime,
        size: prev.size || size
      });
      return;
    }
    out.push(normalizeProjectFile({
      name: listedName || 'file', url: listedUrl, driveId, mime, size, addedAt
    }));
  });

  // Local-only entries (no Drive id yet) survive a refresh.
  current.forEach((f) => {
    if (!f.driveId && !seen.has(f.id)) { seen.add(f.id); out.push(f); }
  });
  return out;
};
