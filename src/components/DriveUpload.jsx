/* =========================================================================
   src/components/DriveUpload.jsx
   Reusable "Upload file" button used everywhere images/documents are
   attached (figures, documents in protocols / projects / test reports) and
   to archive big data files (MD trajectories, CD spectra, ...).

   What it does with a chosen file:
     1. Renames it automatically (suggested name + original extension).
     2. If Google Drive is connected, uploads the RAW file straight to Drive
        (streamed — large XTC/PDF/spectra files work, no base64 overhead).
     3. Only if Drive is unavailable does it fall back to a data URL
        ("temporary in-app" copy) so nothing is ever lost.
     4. Reports the outcome via onDone({ name, file, drive, mimeType, dataUrl }).

   If Drive is not connected it dispatches a "lab:connect-drive" event so
   App.jsx can run the Google sign-in that grants Drive access.
   ========================================================================= */

import React, { useRef, useState } from 'react';
import { readFileAsDataURL, withExtension, uploadLocalFile, getDriveToken } from '../utils/driveUpload';
import { suggestDriveFileName, sanitizeSlug } from '../utils/driveNaming';

export const DriveUploadButton = ({
  accept = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.jws,.xtc,.trr,.dcd',
  suggestedName = 'file',
  label = '⬆ Upload',
  className = '',
  preloadedFile = null,
  naming = null,
  path = null,
  fileSuffix = null,
  onDone,
  onError
}) => {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(''); // '' | 'drive' | 'local' | 'error'
  const [lastFile, setLastFile] = useState(null);
  const [lastDrive, setLastDrive] = useState(null);
  const [lastDriveError, setLastDriveError] = useState('');
  const [lastDataUrl, setLastDataUrl] = useState('');
  const [lastFileName, setLastFileName] = useState('');

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    setStatus('');
    setLastFile(file);
    setLastDrive(null);
    setLastDriveError('');
    try {
      // Short file name: the ORIGINAL file name (or an explicit title) plus the
      // scientist. The project/test/section/instance context is reproduced as a
      // FOLDER hierarchy on Drive (see driveNaming.driveFolderPath), so it is no
      // longer stuffed into the file name.
      const namingCtx = naming && typeof naming === 'object' ? { ...naming } : null;
      if (namingCtx && !namingCtx.title) {
        const baseName = String(file.name || '').replace(/\.[^/.]+$/, '');
        if (baseName) namingCtx.title = baseName;
      }
      let computed = namingCtx
        ? suggestDriveFileName(namingCtx)
        : (suggestedName || 'file');
      // Optional suffix appended to the base name (e.g. publication year or
      // keywords): base_suffix.ext
      if (fileSuffix) {
        const sfx = Array.isArray(fileSuffix)
          ? fileSuffix.filter(Boolean).map(sanitizeSlug).join('_')
          : sanitizeSlug(String(fileSuffix));
        if (sfx) computed = `${computed}_${sfx}`;
      }
      const name = withExtension(computed, file.name || computed);
      const mimeType = file.type || 'application/octet-stream';

      let drive = null;
      let driveError = '';
      if (getDriveToken()) {
        try {
          drive = await uploadLocalFile({ name, mimeType, file, ctx: namingCtx, path });
        } catch (err) {
          drive = null;
          driveError = err && err.message ? String(err.message) : 'unknown Drive error';
          console.warn('Drive upload failed:', driveError);
        }
      } else {
        driveError = 'Google Drive is not connected.';
      }

      setLastDrive(drive);
      setLastDriveError(driveError);

      if (drive) {
        setStatus('drive');
        setLastDataUrl('');
        setLastFileName('');
        if (onDone) onDone({ name, file, drive, mimeType, dataUrl: null });
      } else {
        // Temporary in-app copy — but ONLY for small files. Encoding a large
        // file into a data URL would freeze the app and bloat the saved
        // dataset, so big files are NOT stored locally: the user is asked to
        // connect/reconnect Google Drive and upload again.
        if (file.size > 3 * 1024 * 1024) {
          setStatus('error');
          setLastDriveError('File too large to store locally — connect Google Drive and upload it again.');
          if (onError) onError(new Error('File too large to store locally'));
        } else {
          const dataUrl = await readFileAsDataURL(file);
          setStatus('local');
          setLastDataUrl(dataUrl);
          setLastFileName(name);
          if (onDone) onDone({ name, file, drive: null, mimeType, dataUrl });
        }
      }
    } catch (err) {
      setStatus('error');
      if (onError) onError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (e.target.value) e.target.value = '';
    if (!file) return;
    await upload(file);
  };

  const connectDrive = () => {
    try { window.dispatchEvent(new CustomEvent('lab:connect-drive')); } catch { /* ignore */ }
  };

  const downloadLocal = () => {
    if (!lastDataUrl || !lastFileName) return;
    const a = document.createElement('a');
    a.href = lastDataUrl;
    a.download = lastFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const bigFile = status === 'local' && lastFile && lastFile.size > 3 * 1024 * 1024;

  return (
    <div className="flex flex-col gap-1">
      <input ref={fileRef} type="file" accept={accept} onChange={handleFile} className="hidden" />
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (preloadedFile) { upload(preloadedFile); return; }
          if (fileRef.current) fileRef.current.click();
        }}
        className={`px-2 py-1 rounded text-[10px] font-bold transition-colors shadow-sm flex items-center justify-center gap-1 disabled:opacity-50 ${className || 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200'}`}
        title={preloadedFile
          ? `Upload ${preloadedFile.name || 'this file'} to Google Drive with the suggested name`
          : 'Choose a file — it will be renamed automatically and (if Drive is connected) saved to your Google Drive folder'}
      >
        {busy ? '⏳ Uploading…' : label}
      </button>

      {status === 'drive' && lastDrive && (
        <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-1">
          ✓ Saved to Google Drive
          {lastDrive.driveUrl && (
            <a href={lastDrive.driveUrl} target="_blank" rel="noopener noreferrer"
               className="text-blue-600 hover:text-blue-800 underline">
              Open ↗
            </a>
          )}
        </span>
      )}
      {status === 'local' && (
        <span className="text-[10px] font-bold text-amber-600">
          {lastDriveError ? (
            <>Drive saving unavailable — file kept locally. </> 
          ) : (
            <>{bigFile ? '⚠ Large file kept locally (temporary) — ' : '⚠ Stored locally (temporary) — '}</>
          )}
          <button type="button" onClick={connectDrive} className="underline hover:text-amber-800">
            {lastDriveError ? 'reconnect Google Drive' : 'connect Google Drive'}
          </button>{' '}
          to auto-save it{lastFileName ? (
            <>, or <button type="button" onClick={downloadLocal} className="underline hover:text-amber-800">⬇ download the renamed file</button> to save it into Drive yourself</>
          ) : (
            <>
              , then upload again.
            </>
          )}.
        </span>
      )}
      {status === 'error' && (
        <span className="text-[10px] font-bold text-red-600">
          Upload failed — try again or paste a link instead.
        </span>
      )}
    </div>
  );
};

