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
  migrateTestDriveImages,
  TEST_IMAGE_SECTION
} from '../utils/migrateTestImages';

export const DriveImageMigration = ({ tests, setTests }) => {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const refCount = countTestImageRefs(tests);

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
      `Move ${refCount} test image(s) into the correct Drive folders\n` +
      `(<project>/<test>/<instance>/${TEST_IMAGE_SECTION}) and rename them ` +
      `as <title>_<scientist>? The images keep their Drive id, so all existing links keep working.`
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
        <h3 className="text-sm font-bold text-slate-700">🖼️ Test images on Google Drive</h3>
        {refCount > 0 && (
          <span className="text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5 whitespace-nowrap">
            {refCount} link{refCount === 1 ? '' : 's'} found
          </span>
        )}
      </div>

      <p className="text-xs text-slate-500 mb-3">
        Older test images were attached as plain Drive links. This moves them into
        the correct folder (<code className="text-slate-600">…/&lt;test&gt;/&lt;instance&gt;/{TEST_IMAGE_SECTION}</code>)
        and renames them <code className="text-slate-600">&lt;title&gt;_&lt;scientist&gt;</code>.
      </p>

      <button
        type="button"
        onClick={run}
        disabled={busy || (refCount === 0 && !(s && s.moved > 0))}
        className={`text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm transition-colors ${
          refCount === 0 && !(s && s.moved > 0)
            ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-default'
            : 'bg-indigo-600 hover:bg-indigo-700 text-white border border-indigo-700 disabled:opacity-60'
        }`}
      >
        {busy ? 'Moving images…' : refCount === 0 && !(s && s.moved > 0)
          ? 'No Drive-linked test images'
          : '⬆ Move images to correct Drive folders'}
      </button>

      {busy && (
        <p className="text-[11px] text-indigo-600 font-bold mt-2 animate-pulse">
          Moving files on Google Drive — please keep this tab open…
        </p>
      )}

      {result && result.nothing && !busy && (
        <p className="text-[11px] text-slate-500 font-semibold mt-2">
          ✓ Nothing to do — no Drive-linked test images found.
        </p>
      )}

      {s && !busy && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="flex flex-wrap gap-1.5 mb-2">
            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
              {s.moved} moved
            </span>
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
                    d.status === 'skipped' ? 'text-amber-600' : 'text-red-600'
                  }>•</span>
                  <span className="text-slate-600">
                    {d.test || '?'}
                    {d.status === 'moved'
                      ? <> → <span className="text-slate-400">{d.folder}/</span><span className="font-semibold text-slate-700">{d.name}</span></>
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
