/* =========================================================================
   src/components/WorkspaceResyncPanel.jsx
   « Resync from Drive » — remettre CE poste d'accord avec le Drive.

   Le défaut réparé : « tous mes projets ont disparu du programme alors qu'ils
   sont toujours sur le Drive ». Les projets (et la liste des datasets) vivent
   d'abord dans le magasin du NAVIGATEUR ; n'importe quelle perte locale —
   magasin plein, écriture refusée, poste neuf, nettoyage du navigateur — les
   faisait disparaître à l'écran alors que `Lab Workspace/_workspace/state.json`
   et les copies `_workspace/datasets/ds_….json` les portaient depuis le début.

   Ce panneau fait donc, sur demande du superutilisateur, les QUATRE temps de la
   reprise — tous décidés par App.jsx (prop `onResync`), et le panneau ne fait que
   MONTRER le résultat. Les trois premiers ne font que LIRE le Drive ; le
   quatrième réécrit l'index partagé, et rien d'autre :

     1° l'INDEX — le même chemin qu'au démarrage : tombes, levées de tombe,
        projets de l'index, liste des datasets (App.jsx les garde) ;
     2° l'INVENTAIRE — `sweepWorkspaceDrive` (utils/workspaceResync.js) dit ce
        que le Drive porte, ce qui manque ici et ce qui est mal rangé ;
     3° LES CONTENUS — chaque copie que l'inventaire dit récupérable est relue
        (`readDatasetCopy`), sa charge est décodée (le contenu d'un dataset vit
        dans `payload`, compressé) et adoptée par le chemin normal de l'ouverture
        d'un dataset (`mergeProjectsFromCloud`) ;
     4° LE RÉSULTAT REPART — l'index partagé `_workspace/state.json` est réécrit
        avec ce que ce poste vient d'apprendre, sinon le poste suivant ne verrait
        toujours rien. C'est la SEULE écriture du geste : aucun dossier n'est
        créé, déplacé, renommé ni supprimé, et ce qui revient est remis dans le
        magasin de CE navigateur, exactement comme à l'ouverture d'un dataset.
   Le texte du rapport vient de `resyncReportLines` — le panneau ne
   décide pas ce qui est digne d'être dit, il l'affiche.
   ========================================================================= */

import React from 'react';
/* Les phrases ET le goût des lignes viennent du module pur (utils/workspaceResync.js,
   où `resyncReportLines` fabrique déjà le texte du rapport) : le panneau peint, il
   ne décide pas. C'est ce qui rend le compte-rendu vérifiable sans navigateur
   (_workspace_resync_ui_test.mjs). */
import { resyncLineTone, resyncSummaryText } from '../utils/workspaceResync';

export const WorkspaceResyncPanel = ({ onResync = null }) => {
  const [busy, setBusy] = React.useState(false);
  const [summary, setSummary] = React.useState(null);

  /* Le geste : UN appel à App.jsx (`onResync`), qui fait les quatre temps et
     rend son compte-rendu. Le panneau ne connaît ni le Drive ni les magasins —
     c'est ce qui rend la reprise vérifiable ailleurs qu'à l'écran. */
  const run = React.useCallback(async () => {
    if (typeof onResync !== 'function' || busy) return;
    setBusy(true);
    setSummary(null);
    try {
      const out = await onResync();
      setSummary(out && typeof out === 'object' ? out : { ok: false, error: 'The Drive read came back empty.' });
    } catch (err) {
      setSummary({ ok: false, error: `The Drive could not be read: ${String((err && err.message) || err || 'unknown error')}` });
    } finally {
      setBusy(false);
    }
  }, [onResync, busy]);

  const view = summary ? resyncSummaryText(summary) : null;
  const off = busy || typeof onResync !== 'function';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
        <span className="text-xs text-slate-500 leading-relaxed">
          Reads the whole Lab Workspace on Google Drive — <span className="font-semibold">_workspace/state.json</span> (the
          index that lists your datasets and projects), the dataset folders and the content copies in
          <span className="font-semibold"> _workspace/datasets/</span> — then puts back into THIS browser the datasets and
          projects the Drive still carries, and writes the result back to the index so the other PC(s) see it too. No folder
          is moved, renamed or deleted.
        </span>
        <button
          type="button"
          onClick={run}
          disabled={off}
          className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm transition-colors ${
            off
              ? 'bg-slate-100 text-slate-400 border-slate-200'
              : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
          }`}
        >
          {busy ? '⟳ Reading the Drive…' : '🔄 Resync from Drive'}
        </button>
      </div>


      {view && (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
          {summary.error ? (
            <p className="text-xs font-semibold text-amber-700">{view.headline} {String(summary.error)}</p>
          ) : (
            <p className={`text-xs font-semibold ${summary.ok ? 'text-emerald-700' : 'text-amber-700'}`}>
              {summary.ok ? '✓' : '⚠'} {view.headline}
            </p>
          )}

          {!summary.error && (
            <>
              <p className="text-xs text-slate-700">{view.projects}</p>
              <p className="text-xs text-slate-700">{view.index}</p>
              {view.copies ? <p className="text-xs text-slate-700">{view.copies}</p> : null}
              {view.failed ? <p className="text-xs font-semibold text-amber-700">{view.failed}</p> : null}
              {view.stateAdopted ? (
                <p className="text-xs text-slate-500 leading-relaxed">
                  The index was adopted FIRST: deletions and restorations recorded on another PC apply here too, so a project
                  somebody deleted (or gave back) elsewhere does not come back here by mistake.
                </p>
              ) : null}
            </>
          )}

          {view.lines.length > 0 && (
            <ul className="flex flex-col gap-1 border-t border-slate-100 pt-2">
              {view.lines.map((line, i) => (
                <li
                  key={`${i}-${line.slice(0, 24)}`}
                  className={`text-xs leading-relaxed ${
                    resyncLineTone(line) === 'warn' ? 'text-amber-700 font-semibold' : 'text-slate-600'
                  }`}
                >
                  {line}
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-slate-500 leading-relaxed border-t border-slate-100 pt-2">
            What came back lives in this browser, exactly as if each dataset had been opened here — open the
            <span className="font-semibold"> Projets </span> page to see it. If the inventory above reports a misplaced or
            missing folder, the DRIVE itself needs tidying: this panel reports it and never touches it.
          </p>
        </div>
      )}
    </div>
  );
};

export default WorkspaceResyncPanel;
