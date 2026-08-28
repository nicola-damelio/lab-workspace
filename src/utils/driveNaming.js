/* =========================================================================
   src/utils/driveNaming.js
   Small helpers that keep Google Drive attachments tidy with zero setup:
     - suggestDriveFileName()  → automatic file names (date + kind + title)
     - getDriveFolderUrl()     → the Drive folder the user wants to open
     - setDriveFolderUrl()     → remember that folder in localStorage
     - openDrive()             → open the saved folder (or Drive root) in a new tab
     - copyText()              → clipboard helper with a textarea fallback
   ========================================================================= */

/** Build a clean file name that *contains the full path*:
 *  Project_Test_Instance_Section_Subsection_Title_suffix
 *  e.g. MyProject_CDrun1_Rep1_Data_Spectra_figure1.png
 *       MyProtocol_doc.pdf
 *  No date prefix: re-uploading a file with the same name overwrites the
 *  existing Drive file (see driveUpload.uploadLocalFile) instead of
 *  creating a duplicate every day.
 */
export const suggestDriveFileName = ({
  kind = 'File', title = '', suffix = '',
  project = '', protocol = '', test = '', instance = '', section = '', subsection = ''
}) => {
  const sanitize = (s) => String(s || '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '') // strip emoji pictographs
    .replace(/[\uFE0F\u200D]/g, '') // variation selector + zero-width joiner
    .replace(/\s+/g, '_')
    .replace(/[^\w.-]+/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);

  const parts = [project, protocol, test, instance, section, subsection, title, suffix];
  const slug = parts.map(sanitize).filter(Boolean).join('_');

  return slug || kind || 'file';
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
