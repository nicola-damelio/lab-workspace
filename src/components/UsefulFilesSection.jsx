/* =========================================================================
   src/components/UsefulFilesSection.jsx
   Project page section: "Useful files".

   The files chosen here are uploaded to Google Drive inside an explicit
   `useful_files` directory of the PROJECT folder of the canonical tree:

       <Lab Workspace>/<dataset>/projects/<project>/useful_files/<file>

   (see utils/projectFiles.js). The project keeps a light index of what was
   uploaded (project.usefulFiles) so the list renders without querying Drive,
   while Drive remains the source of truth: "⟳ Refresh from Drive" re-reads the
   folder and reconciles the index (files added from another browser or replayed
   from the pending-upload queue appear; files deleted in Drive disappear).

   Files keep their OWN name (no project/scientist renaming) and are addressed
   by their shareable Drive link, exactly like the other Drive attachments.
   ========================================================================= */

import React, { useState } from 'react';
import { DriveUploadButton } from './DriveUpload';
import {
  cloudBackendAvailable, getDriveRootName, getDriveToken,
  listDriveChildren, resolveDrivePathFromNames, trashDriveFile
} from '../utils/driveUpload';
import { openDrive } from '../utils/driveNaming';
import {
  addProjectFile, formatFileSize, isDriveFolderMime, mergeDriveListing,
  removeProjectFile, sortProjectFiles, usefulFileBaseName, usefulFilesFolderLabel,
  usefulFilesFolderPath, usefulFilesFolderUrl
} from '../utils/projectFiles';

/** Documents a project may want to keep at hand (deliberately broad). */
const USEFUL_FILES_ACCEPT = [
  'image/*', '.pdf', '.doc', '.docx', '.odt', '.rtf', '.txt', '.md', '.csv',
  '.xls', '.xlsx', '.ods', '.ppt', '.pptx', '.tex', '.zip', '.7z',
  '.jws', '.xtc', '.trr', '.dcd', '.dat', '.pdb', '.cif', '.inp', '.mol2',
  'application/octet-stream'
].join(',');

export const UsefulFilesSection = ({
  projectName, files = [], folderUrl = '', canModify = false, currentUser = null,
  onChange, onFolderUrl
}) => {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const list = sortProjectFiles(files);
  const folderLabel = usefulFilesFolderLabel(projectName, getDriveRootName());
  const flash = (msg) => { setStatus(msg); };

  /** Remember the Drive folder URL of projects/<project>/useful_files, so the
   *  link keeps working without re-resolving the path. Best-effort: no Drive
   *  connection, no request. */
  const rememberFolderUrl = async () => {
    if (!getDriveToken()) return '';
    try {
      const { leafId } = await resolveDrivePathFromNames(usefulFilesFolderPath(projectName));
      const url = usefulFilesFolderUrl(leafId);
      if (url && url !== folderUrl && onFolderUrl) onFolderUrl(url);
      return url;
    } catch { return ''; }
  };

  /** Called once per uploaded file (DriveUploadButton onDone). */
  const handleUploaded = ({ name, file, drive, mimeType }) => {
    if (!drive || !drive.id) {
      flash(`⚠ “${name}” is not in Google Drive yet — connect Drive and add it again (the file is kept in the retry queue).`);
      return;
    }
    if (onChange) {
      onChange(addProjectFile(list, {
        name: name || (file && file.name) || 'file',
        url: drive.driveUrl || '',
        driveId: drive.id,
        mime: mimeType || (file && file.type) || '',
        size: (file && file.size) || 0,
        addedBy: (currentUser && currentUser.name) || '',
        addedAt: new Date().toISOString()
      }));
    }
    flash(`✓ “${name}” saved to Google Drive → useful_files/`);
    rememberFolderUrl();
  };

  /** Open the project's useful_files folder (created on first use). */
  const openFolder = async () => {
    if (!cloudBackendAvailable()) {
      // No cloud storage configured: fall back to the saved dataset folder so
      // the user can still reach the project directory.
      if (folderUrl) window.open(folderUrl, '_blank', 'noopener,noreferrer');
      else openDrive();
      flash('⚠ Connect Google Drive to open the useful_files folder directly.');
      return;
    }
    setBusy(true);
    try {
      const url = (await rememberFolderUrl()) || folderUrl;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      else openDrive();
    } finally { setBusy(false); }
  };

  /** Re-read the Drive folder and reconcile the index with its real content. */
  const refreshFromDrive = async () => {
    if (!getDriveToken()) { flash('⚠ Connect Google Drive to list the useful_files folder.'); return; }
    setBusy(true);
    flash('⟳ Reading useful_files on Google Drive…');
    try {
      const { leafId } = await resolveDrivePathFromNames(usefulFilesFolderPath(projectName));
      const url = usefulFilesFolderUrl(leafId);
      if (url && url !== folderUrl && onFolderUrl) onFolderUrl(url);
      const children = await listDriveChildren(leafId);
      const found = children.filter((c) => c && !isDriveFolderMime(c.mimeType)).length;
      if (onChange) onChange(mergeDriveListing(list, children, new Date().toISOString()));
      flash(`⟳ ${found} file${found === 1 ? '' : 's'} in useful_files`);
    } catch (err) {
      flash(`⚠ Could not read the Drive folder (${(err && err.message) || 'unknown error'}).`);
    } finally { setBusy(false); }
  };

  /** Drop one file from the index and move its Drive copy to the Trash. */
  const removeFile = (entry) => {
    const label = (entry && entry.name) || 'this file';
    if (!window.confirm(`Remove “${label}” from the list? Its Google Drive copy is moved to the Trash${getDriveToken() ? '' : ' once Drive is connected'}.`)) return;
    if (onChange) onChange(removeProjectFile(list, entry.id));
    if (entry.driveId) trashDriveFile(entry.driveId).catch(() => {});
    flash(`🗑 “${label}” removed`);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-xs text-slate-500 max-w-xl">
          Documents useful for the whole project (protocols, PDFs, spreadsheets, data sheets…).
          They are saved on Google Drive — in the <code className="text-slate-700">useful_files</code> directory
          of the project folder — and listed here for everyone working on the project.
          Each file keeps its own name.
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {canModify && (
            <DriveUploadButton
              multiple
              accept={USEFUL_FILES_ACCEPT}
              path={usefulFilesFolderPath(projectName)}
              nameFor={(f) => usefulFileBaseName(f && f.name)}
              suggestedName={usefulFileBaseName(projectName) || 'file'}
              label="⬆ Add files"
              onDone={handleUploaded}
              onError={(err) => flash(`⚠ Upload failed (${(err && err.message) || 'unknown error'}).`)}
            />
          )}
          {canModify && (
            <button type="button" onClick={refreshFromDrive} disabled={busy}
                    title="Read the useful_files folder on Google Drive and update this list"
                    className="px-2 py-1 rounded text-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-300 shadow-sm disabled:opacity-50">
              {busy ? '⏳ Reading…' : '⟳ Refresh from Drive'}
            </button>
          )}
          <button type="button" onClick={openFolder} disabled={busy}
                  title="Open (creating it if needed) the project's useful_files folder on Google Drive"
                  className="px-2 py-1 rounded text-[10px] font-bold bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 shadow-sm disabled:opacity-50">
            📂 Open the Drive folder ↗
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
        <span className="font-bold">📁 Drive location:</span>
        <span className="font-mono break-all">{folderLabel}</span>
        {folderUrl && (
          <a href={folderUrl} target="_blank" rel="noopener noreferrer"
             className="text-blue-600 hover:text-blue-800 underline">open ↗</a>
        )}
      </div>

      {status && (
        <div className="text-[10px] font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">{status}</div>
      )}

      {list.length === 0 ? (
        <div className="text-xs italic text-slate-400 bg-slate-50 border border-dashed border-slate-300 rounded-lg px-3 py-4 text-center">
          {canModify
            ? 'No files yet — use “⬆ Add files” to save project documents into the useful_files directory on Google Drive.'
            : 'No files yet.'}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {list.map((f) => (
            <div key={f.id} className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg p-2">
              <span className="shrink-0 text-base leading-none no-print">📄</span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-slate-800 truncate" title={f.name}>{f.name}</div>
                <div className="text-[10px] text-slate-500 truncate">
                  {[
                    formatFileSize(f.size),
                    f.addedBy ? `by ${f.addedBy}` : '',
                    f.addedAt ? new Date(f.addedAt).toLocaleString() : '',
                    f.driveId ? '' : 'temporary — not in Drive yet'
                  ].filter(Boolean).join(' · ')}
                </div>
              </div>
              {f.url && (
                <a href={f.url} target="_blank" rel="noopener noreferrer"
                   className="shrink-0 text-[10px] font-bold text-blue-600 hover:text-blue-800 underline whitespace-nowrap">
                  Open ↗
                </a>
              )}
              {canModify && (
                <button type="button" onClick={() => removeFile(f)}
                        title="Remove this file (the Google Drive copy is moved to the Trash)"
                        className="shrink-0 text-slate-400 hover:text-red-500 font-bold px-1 text-xs">×</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
