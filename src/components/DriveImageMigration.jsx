/* =========================================================================
   src/components/DriveImageMigration.jsx

   Dashboard maintenance card: moves every test image that is currently just a
   pasted Google Drive LINK into the correct Drive folder and renames it with
   the current conventions (Report section, <title>_<scientist>.<ext>).

   Mounted on the Dataset Overview (dashboard) — self-contained.
   ========================================================================= */
import React, { useState } from 'react';
import { getDriveToken } from '../utils/driveUpload';
import {
  countTestImageRefs,
  previewTestDriveFiles,
  migrateTestDriveImages,
  TEST_IMAGE_SECTION
} from '../utils/migrateTestImages';

export const DriveImageMigration = ({ tests, setTests, datasetTitle = '' }) => {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  const refCount = countTestImageRefs(tests);
  const preview = showPreview ? previewTestDriveFiles(tests) : [];
  const autoNamed = preview.filter((p) => p.autoNamed);

  const run = async () => {
    if (!getDriveToken()) {
      alert('Google Drive is not connected. Connect it from the sidebar first (Connect Drive).');
      return;
    }
    if (refCount === 0) {
      setResult({ nothing: true, at: Date.now() });
      return;
    }
    const ok = window.confirm(
      `Move ${refCount} test file(s) into the correct Drive folders\n` +
      `(Lab Workspace/<dataset>/<project>/<test>/<instance>/${TEST_IMAGE_SECTION})\n` +
      `and rename them as <title>_<scientist>?\n\n` +
      `This covers figures/images, ⭐ starred items, attached documents (PDFs etc.) ` +
      `and links inside the report text.\n\n` +
      `Files created by the app are moved in place. Files uploaded outside the app are ` +
      `downloaded and re-uploaded as app files into the folder (their link is updated).`
    );
    if (!ok) return;

    setBusy(true);
    setResult(null);
    try {
      const { nextTests, summary } = await migrateTestDriveImages({ tests });
      setTests(() => nextTests);
      setResult({ summary, at: Date.now() });
    } catch (err) {
      alert('Image migration failed: ' + ((err && err.message) || err));
    } finally {
      setBusy(false);
    }
  };

  const s = result && result.summary;

  return (
    <div className="bg-white p-3 md:p-4 rounded-xl border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <h3 className="text-sm font-bold text-slate-700">🖼️ Test files on Google Drive</h3>
        {refCount > 0 && (
          <span className="text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5 whitespace-nowrap">
            {refCount} file{refCount === 1 ? '' : 's'} found
          </span>
        )}
      </div>

      <p className="text-xs text-slate-500 mb-3">
        Older test attachments were stored as plain Drive links. This moves them into
        the correct folder (<code className="text-slate-600">…/&lt;test&gt;/&lt;instance&gt;/{TEST_IMAGE_SECTION}</code>)
        and renames them <code className="text-slate-600">&lt;title&gt;_&lt;scientist&gt;</code> —
        figures, ⭐ starred items, attached documents (PDFs) and links in the report text.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={run}
          disabled={busy || (refCount === 0 && !(s && (s.moved > 0 || s.copied > 0)))}
          className={`text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm transition-colors ${
            refCount === 0 && !(s && (s.moved > 0 || s.copied > 0))
              ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-default'
              : 'bg-indigo-600 hover:bg-indigo-700 text-white border border-indigo-700 disabled:opacity-60'
          }`}
        >
          {busy ? 'Moving files…' : refCount === 0 && !(s && (s.moved > 0 || s.copied > 0))
            ? 'No Drive-linked test files'
            : '⬆ Move files to correct Drive folders'}
        </button>

        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors bg-white border-slate-300 text-slate-600 hover:bg-slate-50"
          title="Dry run — show every test, its detected instance name and the exact target folder (nothing is touched on Drive)"
        >
          {showPreview ? '👁 Hide preview' : '👁 Preview target folders'}
        </button>
      </div>

      {showPreview && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          {autoNamed.length > 0 && (
            <p className="text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-2 py-1.5 mb-2">
              ℹ️ {autoNamed.length} unnamed instance{autoNamed.length === 1 ? '' : 's'} will be
              auto-renamed <code>instance1</code>, <code>instance2</code>, … (in the order shown in the app)
              and get their own folder — the test data is updated accordingly.
            </p>
          )}
          <ul className="max-h-60 overflow-y-auto custom-scrollbar text-[11px] space-y-1.5">
            {preview.map((p) => (
              <li key={p.id || p.test} className="flex items-start gap-1.5">
                <span className="text-slate-400 mt-0.5">•</span>
                <div className="min-w-0">
                  <div className="font-bold text-slate-700 truncate">
                    {p.test}
                    <span className={`ml-1.5 font-semibold ${p.autoNamed ? 'text-blue-600' : 'text-emerald-600'}`}>
                      inst: &quot;{p.instanceName}&quot;{p.autoNamed ? ' (auto)' : ''}
                    </span>
                  </div>
                  <div className="text-slate-500 font-mono text-[10px] truncate">
                    → {p.folder}/{p.files.length} file{p.files.length === 1 ? '' : 's'}
                  </div>
                </div>
              </li>
            ))}
            {preview.length === 0 && (
              <li className="text-slate-400">No Drive-linked files found in any test.</li>
            )}
          </ul>
        </div>
      )}

      {busy && (
        <p className="text-[11px] text-indigo-600 font-bold mt-2 animate-pulse">
          Moving files on Google Drive — please keep this tab open…
        </p>
      )}

      {result && result.nothing && !busy && (
        <p className="text-[11px] text-slate-500 font-semibold mt-2">
          ✓ Nothing to do — no Drive-linked test files found.
        </p>
      )}

      {s && !busy && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="flex flex-wrap gap-1.5 mb-2">
            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
              {s.moved} moved
            </span>
            {s.copied > 0 && (
              <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
                {s.copied} copied &amp; re-uploaded
              </span>
            )}
            {s.skipped > 0 && (
              <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                {s.skipped} skipped
              </span>
            )}
            {s.failed > 0 && (
              <span className="text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
                {s.failed} failed
              </span>
            )}
          </div>

          {s.details.length > 0 && (
            <ul className="max-h-40 overflow-y-auto custom-scrollbar text-[11px] space-y-1">
              {s.details.slice(0, 200).map((d, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className={
                    d.status === 'moved' ? 'text-emerald-600' :
                    d.status === 'copied' ? 'text-blue-600' :
                    d.status === 'skipped' ? 'text-amber-600' : 'text-red-600'
                  }>•</span>
                  <span className="text-slate-600">
                    {d.test || '?'}
                    {(d.status === 'moved' || d.status === 'copied')
                      ? <> → <span className="text-slate-400">
                          Lab Workspace/{datasetTitle || '<dataset>'}/{d.folder}/
                        </span><span className="font-semibold text-slate-700">{d.name}</span>
                          {d.status === 'copied' && <span className="text-blue-500"> (copied)</span>}</>
                      : <> — <span className="text-slate-400">{d.reason || d.status}</span></>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
