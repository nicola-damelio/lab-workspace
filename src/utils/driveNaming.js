/* =========================================================================
   src/utils/driveNaming.js
   Helpers that keep Google Drive attachments tidy with zero setup:
     - suggestDriveFileName()  → SHORT file names (title_scientist.ext)
     - driveFolderPath()       → the Drive folder hierarchy that mirrors the
       app schema (project / test / section / instance)
     - getDriveFolderUrl()     → the Drive folder the user wants to open
     - setDriveFolderUrl()     → remember that folder in localStorage
     - openDrive()             → open the saved folder (or Drive root) in a new tab
     - copyText()              → clipboard helper with a textarea fallback

   Folder layout on Drive (inside the app's root folder):
       <project>/<test>/<section>/<instance>/<title>_<scientist>.<ext>
   A standalone protocol lives under a fixed "protocols" container, in its own
   scientist-tagged folder:
       protocols/<protocol>_<scientist>/<title>.<ext>
   A test that is not part of any project lives at the root:
       <test>/<section>/<instance>/<title>_<scientist>.<ext>
   ========================================================================= */

/** Shared slug-maker for folder and file names. */
export const sanitizeSlug = (s) => String(s || '')
  .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '') // strip emoji pictographs
  .replace(/[\uFE0F\u200D]/g, '') // variation selector + zero-width joiner
  .replace(/\s+/g, '_')
  .replace(/[^\w.-]+/g, '')
  .replace(/_+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 60);

/** Short file name: <title>_<scientist>. The context that used to be stuffed
 *  into the name (project, test, section, instance) now becomes a FOLDER
 *  hierarchy — see driveFolderPath(). `title` falls back to `suffix`/`kind`
 *  so placeholder names (no file chosen yet) still read sensibly.
 *  For protocols the scientist is already part of the folder
 *  (protocols/<protocol>_<scientist>), so it is NOT repeated in the file name.
 *  No date prefix: re-uploading a file with the same name overwrites the
 *  existing Drive file (see driveUpload.uploadLocalFile) instead of
 *  creating a duplicate every day. */
export const suggestDriveFileName = ({
  kind = 'File', title = '', suffix = '', scientist = '', protocol = ''
}) => {
  const parts = [];
  if (title) parts.push(String(title).trim());
  else if (suffix) parts.push(String(suffix).trim());
  else if (kind && kind !== 'File') parts.push(kind);
  if (scientist && !protocol) parts.push(String(scientist).trim());
  const slug = parts.map(sanitizeSlug).filter(Boolean).join('_');
  return slug || kind || 'file';
};

/** The Drive folder path (folder NAMES only) that mirrors the app schema:
 *  [project, test, section, instance] for tests and
 *  [protocols, <protocol>_<scientist>] for standalone protocols. */
export const driveFolderPath = (ctx = {}) => {
  if (!ctx || typeof ctx !== 'object') return [];
  if (ctx.protocol) {
    return [
      'protocols',
      [sanitizeSlug(ctx.protocol), sanitizeSlug(ctx.scientist)].filter(Boolean).join('_')
    ].filter(Boolean);
  }
  const segs = [];
  if (ctx.project) segs.push(ctx.project);
  if (ctx.test) segs.push(ctx.test);
  if (ctx.section) segs.push(ctx.section);
  if (ctx.instance) segs.push(ctx.instance);
  return segs.map(sanitizeSlug).filter(Boolean);
};

const DRIVE_FOLDER_KEY = 'labDriveFolderUrl';

/** The Drive folder URL the user wants "Open Drive" to jump to ('' = Drive root). */
export const getDriveFolderUrl = () => {
  try {
    const v = localStorage.getItem(DRIVE_FOLDER_KEY);
    return v && String(v).startsWith('http') ? String(v).trim() : '';
  } catch { return ''; }
};

export const setDriveFolderUrl = (url) => {
  try { localStorage.setItem(DRIVE_FOLDER_KEY, String(url || '').trim()); } catch { /* ignore */ }
};

/** Open the saved Drive folder (or Drive root) in a new tab. */
export const openDrive = () => {
  const folder = getDriveFolderUrl();
  window.open(folder || 'https://drive.google.com/', '_blank', 'noopener,noreferrer');
};

/** Copy text to the clipboard (Async Clipboard API + legacy fallback). */
export const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(String(text ?? ''));
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = String(text ?? '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }
};
