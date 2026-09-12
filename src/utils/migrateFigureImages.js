/* =========================================================================
   src/utils/migrateFigureImages.js

   One-off maintenance tool: image-library figures captured in the app (Image
   Builder canvases, ⭐ chart captures, molecule-viewer captures) were uploaded
   BEFORE as

       <Lab Workspace>/<dataset>/<project>/images/<file>

   i.e. with the project name as a STRAY folder directly inside the dataset
   folder, beside the canonical projects/backups/protocols/… containers. They
   now belong INSIDE the canonical projects container:

       <Lab Workspace>/<dataset>/projects/<project>/images/<file>

   Every figure the app uploaded is recorded in the Drive file registry with its
   naming context (ctx.section === 'images') AND the folder chain it was saved
   into — so the misplaced files are found WITHOUT listing Drive: each one is
   moved into the canonical folder and the folders it left behind are trashed
   when they became empty. The Drive file KEEPS its id, so every link already
   stored in a library entry / project page keeps working.

   Only files the app created can be moved (drive.file OAuth scope): anything
   else is left untouched.
   ========================================================================= */
import {
  getDriveToken,
  getDriveFileRegistry,
  resolveDrivePathFromNames,
  moveDriveFile,
  trashEmptyFolderChain,
  registerDriveFile
} from './driveUpload';
import { projectImagesFolderPath } from './driveNaming';

/** A registry entry is a "misplaced figure" when it was uploaded as a figure or
 *  image (ctx.section === 'images') and its recorded folder chain does not
 *  contain the canonical `projects` container yet. */
const isMisplacedFigure = (entry) => {
  if (!entry || entry.deleted) return false;
  const ctx = entry.ctx || {};
  if (String(ctx.section || '').trim().toLowerCase() !== 'images') return false;
  const path = Array.isArray(entry.path) ? entry.path : [];
  return !path.some((seg) => seg && seg.name === 'projects');
};

/** Drive folder of one registry entry, e.g. "projects/CD_project/images". */
const targetFolderOf = (entry) => (
  projectImagesFolderPath(String((entry && entry.ctx || {}).project || '')).join('/')
);

/** How many image-library figures still sit outside projects/<project>/images
 *  (read from the local Drive file registry — no Drive call). */
export const countMisplacedFigures = () =>
  Object.values(getDriveFileRegistry()).filter(isMisplacedFigure).length;

/** DRY-RUN — the figures that would be moved, with their target folder. */
export const previewFigureMoves = () =>
  Object.entries(getDriveFileRegistry())
    .filter(([, entry]) => isMisplacedFigure(entry))
    .map(([fileId, entry]) => ({
      fileId,
      name: entry.name || '(file)',
      project: String(((entry.ctx) || {}).project || ''),
      folder: targetFolderOf(entry)
    }));

/** Move every misplaced image-library figure into projects/<project>/images
 *  (same Drive id → the stored links keep working) and trash the folders the
 *  files left behind when they became empty.
 *  @returns {Promise<{moved:number, failed:number, details:Array<object>}>} */
export const migrateFigureImages = async ({ onProgress = () => {} } = {}) => {
  const details = [];
  let moved = 0;
  let failed = 0;
  if (!getDriveToken()) return { moved, failed, details };
  const entries = Object.entries(getDriveFileRegistry()).filter(([, entry]) => isMisplacedFigure(entry));
  for (let i = 0; i < entries.length; i++) {
    const [fileId, entry] = entries[i];
    const folder = targetFolderOf(entry);
    onProgress(`Moving “${entry.name || 'figure'}” → ${folder} (${i + 1}/${entries.length})…`);
    try {
      const resolved = await resolveDrivePathFromNames(projectImagesFolderPath(String(((entry.ctx) || {}).project || '')));
      await moveDriveFile(fileId, resolved.leafId);
      // The file left its old folder(s): trash those that are now empty (a
      // folder that still holds other files/folders is never touched).
      if (Array.isArray(entry.path) && entry.path.length > 0) {
        try { await trashEmptyFolderChain(entry.path); } catch { /* keep going */ }
      }
      // Record the canonical chain so future project renames keep managing it.
      registerDriveFile(fileId, entry.name, entry.ctx || null, resolved.path);
      moved++;
      details.push({ name: entry.name || '', status: 'moved', folder });
    } catch (err) {
      failed++;
      details.push({ name: entry.name || '', status: 'failed', folder, reason: (err && err.message) || 'move failed' });
    }
  }
  return { moved, failed, details };
};
