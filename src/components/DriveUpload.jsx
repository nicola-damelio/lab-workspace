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

export const DriveUploadButton = ({
  accept = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.jws,.xtc,.trr,.dcd',
  suggestedName = 'file',
  label = '⬆ Upload',
  className = '',
  preloadedFile = null,
  onDone,
  onError
}) => {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(''); // '' | 'drive' | 'local' | 'error'
  const [lastFile, setLastFile] = useState(null);

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    setStatus('');
    setLastFile(file);
    try {
      const name = withExtension(suggestedName, file.name || suggestedName);
      const mimeType = file.type || 'application/octet-stream';

      let drive = null;
      if (getDriveToken()) {
        try {
          drive = await uploadLocalFile({ name, mimeType, file });
        } catch (err) {
          drive = null;
          console.warn('Drive upload failed:', err && err.message);
        }
      }

      if (drive) {
        setStatus('drive');
        if (onDone) onDone({ name, file, drive, mimeType, dataUrl: null });
      } else {
        // Temporary in-app copy — the file still works, but warn for big files.
        const dataUrl = await readFileAsDataURL(file);
        setStatus('local');
        if (onDone) onDone({ name, file, drive: null, mimeType, dataUrl });
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

      {status === 'drive' && (
        <span className="text-[10px] font-bold text-emerald-600">
          ✓ Saved to Google Drive
        </span>
      )}
      {status === 'local' && (
        <span className="text-[10px] font-bold text-amber-600">
          {bigFile ? '⚠ Large file kept locally (temporary) — connect Google Drive to store it properly. ' : '⚠ Stored locally (temporary) — '}
          <button type="button" onClick={connectDrive} className="underline hover:text-amber-800">
            connect Google Drive
          </button>{' '}
          to auto-save it, then upload again.
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

