/* =========================================================================
   src/components/DriveTidyPanel.jsx
   « Tidy the Drive » — remettre le DRIVE d'accord avec l'application.

   Le défaut rapporté (voir src/utils/driveTidy.js pour le détail) : après un
   renommage, le Drive portait la bonne arborescence MAIS aussi des tonnes de
   dossiers inutiles — un dossier d'instance en double, un `instance1` DANS un
   `instance1`, et des fichiers en plusieurs exemplaires. « Resync from Drive »
   ne fait que DÉCRIRE ces défauts (il ne touche à rien) : ce panneau-ci est le
   geste qui les RANGE.

   Le geste vient d'App.jsx (prop `onTidy`, qui appelle utils/driveTidy.js) et
   se fait en DEUX temps, jamais en un :

     1. « 🔍 Check the Drive » — LECTURE seule : on compare l'arborescence
        réelle au plan du dépôt et on rend ce qui POURRA être rangé ;
     2. « 🧹 Apply » — le même passage, en écrivant : le plan est publié (ce qui
        manque est créé, un objet renommé est adopté) PUIS les doublons partent
        à la CORBEILLE du Drive.

   Aucune phrase n'est fabriquée ici : le titre et les lignes viennent du module
   pur (`tidySummaryText`), ce qui rend le compte-rendu vérifiable sans
   navigateur (_drive_tidy_test.mjs).
   ========================================================================= */

import React from 'react';
import { tidySummaryText } from '../utils/driveTidy';

/** Le nombre d'éléments qu'un rapport propose de ranger. PUR (petit). */
export const tidyCountOf = (summary) => {
  const list = summary && Array.isArray(summary.datasets) ? summary.datasets : [];
  return list.reduce((n, r) => {
    const c = (r && r.decisions && r.decisions.counts) || {};
    return n + (c.trashFolders || 0);
  }, 0);
};

export const DriveTidyPanel = ({ onTidy = null }) => {
  const [busy, setBusy] = React.useState(false);
  const [summary, setSummary] = React.useState(null);
  const [error, setError] = React.useState('');

  const run = React.useCallback(async (dryRun) => {
    if (typeof onTidy !== 'function' || busy) return;
    setBusy(true);
    setError('');
    try {
      const out = await onTidy({ dryRun });
      setSummary(out && typeof out === 'object' ? out : { ok: false, reason: 'empty', datasets: [], lines: [] });
    } catch (err) {
      setError(`The Drive could not be checked: ${String((err && err.message) || err || 'unknown error')}`);
      setSummary(null);
    } finally {
      setBusy(false);
    }
  }, [onTidy, busy]);

  const view = summary ? tidySummaryText(summary) : null;
  const pending = summary ? tidyCountOf(summary) : 0;
  const checked = !!(summary && summary.dryRun);
  const off = busy || typeof onTidy !== 'function';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
        <span className="text-xs text-slate-500 leading-relaxed">
          Compares the folders of every dataset on the Drive with the tree the application describes
          (<span className="font-semibold">projects/&lt;project&gt;/&lt;experiment&gt;/&lt;instance&gt;/…</span>), then puts the leftovers
          away: a folder the app renamed is <span className="font-semibold">adopted</span> instead of being duplicated, missing
          folders and <span className="font-semibold">_meta.json</span> are written, and only PROVEN duplicates (twin folders
          holding no unique file, empty leftovers, folders of deleted objects, identical twin files) go to the Drive
          <span className="font-semibold"> Trash</span>. Files that differ, folders holding unknown files, and files the app
          points at but the Drive no longer has are <span className="font-semibold">reported, never touched</span>.
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => run(true)}
            disabled={off}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm transition-colors ${
              off ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
            }`}
          >
            {busy ? '⟳ Reading the Drive…' : '🔍 Check the Drive'}
          </button>
          <button
            type="button"
            onClick={() => run(false)}
            disabled={off || !checked}
            title={checked ? 'Write the tree back and move the duplicates to the Drive Trash' : 'Run 🔍 Check the Drive first: the gesture says what it will move before moving anything'}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm transition-colors ${
              off || !checked
                ? 'bg-slate-100 text-slate-400 border-slate-200'
                : 'bg-amber-600 text-white border-amber-600 hover:bg-amber-700'
            }`}
          >
            {`🧹 Apply${pending > 0 ? ` — ${pending}` : ''}`}
          </button>
        </div>
      </div>

      {(view || error) && (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
          {error
            ? <p className="text-xs font-semibold text-amber-700">{error}</p>
            : (
              <p className={`text-xs font-semibold ${summary && summary.ok ? 'text-emerald-700' : 'text-amber-700'}`}>
                {view.headline}
              </p>
            )}
          {view && view.lines.length > 0 && (
            <ul className="flex flex-col gap-1 border-t border-slate-100 pt-2">
              {view.lines.map((line, i) => (
                <li key={`${i}-${line.slice(0, 24)}`} className={`text-xs leading-relaxed ${line.startsWith('⚠') ? 'text-amber-700 font-semibold' : 'text-slate-600'}`}>
                  {line}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-slate-500 leading-relaxed border-t border-slate-100 pt-2">
            Nothing is ever destroyed: every item goes to the Drive <span className="font-semibold">Trash</span>, where it stays 30 days.
            The report above is the whole story — what was written back, what was moved, and what was left alone on purpose.
          </p>
        </div>
      )}
    </div>
  );
};

export default DriveTidyPanel;
