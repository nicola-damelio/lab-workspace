/* =========================================================================
   src/administration/adminImportModal.jsx
   Assistant d’import « Google Sheets » → toutes les collections d’admin.

   1. L’utilisateur colle le tableau copié depuis sa feuille Google Sheets
      (ou téléverse un export CSV / TSV / Excel).
   2. Les en-têtes sont reconnus automatiquement et dirigés vers la bonne
      collection : Lignes budgétaires → recettes ; annuaire & stagiaires →
      personnel ; Dépenses → depenses ; OMs → om ; Souhaités → desiderate ;
      Questions_ouvertes → questioni ; H&S → sicurezza.
   3. Aperçu, dédoublonnage, puis insertion groupée via `importMany`.
   ========================================================================= */
import React, { useState } from 'react';
import { useAdmin } from './AdminContext';
import { collectionLabel } from './adminSchema';
import {
  IMPORT_PRESETS,
  parseDelimitedText,
  parseXlsxWorkbook,
  detectImport,
  buildImportItems,
  recordDedupeKey,
} from './importUtils';

export const AdminImportModal = ({ kind, onClose }) => {
  const { data, importMany, upsert } = useAdmin();
  const [step, setStep] = useState('source'); // 'source' | 'review' | 'done'
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [dedupe, setDedupe] = useState(true);
  const [summary, setSummary] = useState(null);

  const keyOf = (listKind, rec) => recordDedupeKey(listKind, rec);

  const buildFromRows = (matrix) => {
    const detection = detectImport(matrix);
    if (!detection) {
      setError(
        'En-têtes non reconnus : collez le tableau COMPLET avec sa ligne d’en-tête ' +
        '(« Lignes budgétaires », « porteur / HDR / BAP / RIPEC », « porteur / encadrant / Projet », ' +
        '« Suivi / Description / n° SIFAC », « ENT / Prix / Description », « Decision / Code produit », ' +
        '« Question / Categorie / Note » ou « Question / Responsable / priorité »).'
      );
      setAnalysis(null);
      return false;
    }
    const built = buildImportItems(matrix, detection, { recettes: data.recettes });
    setAnalysis({
      preset: detection.preset,
      items: built.items,
      skipped: built.skipped,
      unmatchedProjets: built.unmatchedProjets || [],
    });
    setStep('review');
    setError('');
    return true;
  };

  const analysePaste = () => {
    if (!String(text || '').trim()) {
      setError('Collez d’abord les données copiées depuis la feuille Google Sheets.');
      return;
    }
    if (/docs\.google\.com/i.test(text)) {
      setError(
        'Vous avez collé un lien : le navigateur ne peut pas lire la feuille Google directement ' +
        '(partage/CORS). Ouvrez le lien dans un onglet, sélectionnez le tableau (Ctrl+A), copiez ' +
        '(Ctrl+C) puis recollez le tableau ici.'
      );
      return;
    }
    setError('');
    buildFromRows(parseDelimitedText(text));
  };

  const analyseXlsx = async (sheets) => {
    for (const sheet of sheets) {
      if (detectImport(sheet.rows)) {
        if (buildFromRows(sheet.rows)) return;
      }
    }
    setError(
      'Aucun onglet du classeur ne correspond aux en-têtes attendus. ' +
      'Préférez : Fichier → Télécharger → CSV (feuille actuelle), ouverte sur le bon onglet.'
    );
  };

  const onFile = async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (ev.target.value) ev.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const lower = String(file.name || '').toLowerCase();
      if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        await analyseXlsx(parseXlsxWorkbook(wb));
      } else {
        const content = await file.text();
        buildFromRows(parseDelimitedText(content));
      }
    } catch (err) {
      setError(`Impossible de lire le fichier : ${err && err.message ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  };

  const runImport = () => {
    if (!analysis) return;
    const listKind = analysis.preset.kind;
    const existingKeys = (Array.isArray(data[listKind]) ? data[listKind] : []).map((r) => keyOf(listKind, r));
    const existingSet = new Set(existingKeys);
    const inBatch = new Set();
    const creates = [];
    let doublons = 0;
    let relies = 0;
    (analysis.items || []).forEach((item) => {
      const key = item.key || keyOf(listKind, item.rec);
      if (inBatch.has(key) || (dedupe && existingSet.has(key))) {
        if (listKind === 'personnel' && dedupe && item.rec.recetteId) {
          const found = (Array.isArray(data.personnel) ? data.personnel : []).find((p) => keyOf('personnel', p) === key);
          if (found && !found.recetteId) {
            upsert('personnel', { recetteId: item.rec.recetteId }, found.id);
            relies += 1;
            inBatch.add(key);
            return;
          }
        }
        doublons += 1;
        return;
      }
      inBatch.add(key);
      creates.push(item.rec);
    });
    const { added } = importMany(listKind, creates);
    setSummary({
      listKind,
      added,
      doublons,
      relies,
      skipped: analysis.skipped || 0,
      unmatchedProjets: analysis.unmatchedProjets || [],
    });
    setStep('done');
  };

  const reset = () => {
    setStep('source');
    setText('');
    setError('');
    setAnalysis(null);
    setSummary(null);
  };

  const listKind = analysis && analysis.preset.kind;
  const pageLabel = listKind ? collectionLabel(listKind) : '';

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden max-h-[94vh] flex flex-col">
        <div className="px-6 py-4 bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-black flex items-center gap-2">
              <span className="text-xl">{analysis && analysis.preset.icon ? analysis.preset.icon : '📥'}</span>
              Importer des données
            </h2>
            <p className="text-blue-100 text-xs">Depuis une feuille Google Sheets : copier-coller, fichier CSV/TSV ou Excel.</p>
          </div>
          <button onClick={onClose} className="shrink-0 w-8 h-8 rounded-lg bg-white/15 hover:bg-white/30 text-white font-bold" title="Fermer">✕</button>
        </div>
        {step === 'done' && summary ? (
          <DoneBody summary={summary} onReset={reset} onClose={onClose} />
        ) : step === 'review' && analysis ? (
          <ReviewBody
            analysis={analysis} pageLabel={pageLabel} dedupe={dedupe} setDedupe={setDedupe}
            onBack={() => { setStep('source'); setAnalysis(null); setError(''); }} onImport={runImport}
          />
        ) : (
          <SourceBody
            text={text} setText={setText} busy={busy} error={error}
            onAnalyse={analysePaste} onFile={onFile} fromKind={kind}
          />
        )}
      </div>
    </div>
  );
};

const labelCls = 'block text-[10px] font-black uppercase text-slate-400 tracking-wide mb-1';
const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500';

/* ── Étape 1 : choisir la source (copier-coller ou fichier) ──────────────── */
const SourceBody = ({ text, setText, busy, error, onAnalyse, onFile, fromKind }) => (
  <div className="p-6 overflow-y-auto custom-scrollbar flex flex-col gap-4">
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="text-sm font-black text-slate-800 flex items-center gap-2">
        Source : feuille Google Sheets
        {fromKind ? (
          <span className="text-[10px] font-black uppercase bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
            depuis la page {collectionLabel(fromKind)}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-3 flex-wrap text-[11px] font-bold">
        {IMPORT_PRESETS.map((p, i, arr) => (
          arr.findIndex((x) => x.sourceUrl === p.sourceUrl) === i ? (
            <a key={p.id} href={p.sourceUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
              {p.icon} {p.tabLabel} ↗
            </a>
          ) : null
        ))}
      </div>
    </div>

    <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-xs text-slate-600 leading-relaxed">
      <b>1.</b> Ouvrez la feuille source dans Google Sheets (liens ci-dessus), onglet voulu : sélectionnez le tableau
      (<b>Ctrl+A</b>) puis copiez-le (<b>Ctrl+C</b>).<br />
      <b>2.</b> Collez-le ci-dessous (<b>Ctrl+V</b>) — ou téléversez un export <b>CSV / TSV / Excel</b> de l’onglet
      (Google Sheets : Fichier → Télécharger → CSV).
    </div>

    <div>
      <label className={labelCls}>Contenu de la feuille (collez le tableau ici)</label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'Lignes budgétaires\tCategorie\tporteur\tBudget totale\t…\n— ou —\nporteur\ttype\tHDR\tBAP\tarrivé en\tfin contrat\t…\n— ou —\nporteur\ttype\tencadrant\tProjet\tdebut\tfin contrat\tNote\n— ou —\nSuivi\tENT\tDescription\tDemandeur\tMontant HT\tn° SIFAC\t…\n— ou —\nDecision\tPriorité\tCout\tDescription\tCode produit\t…'}
        className={`${inputCls} min-h-[130px] font-mono text-xs`}
        spellCheck={false}
      />
    </div>

    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={onAnalyse}
        disabled={busy || !String(text || '').trim()}
        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-bold text-sm px-5 py-2 rounded-xl shadow-sm transition-colors"
      >
        {busy ? 'Analyse…' : 'Analyser le collage'}
      </button>
      <label className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold text-sm px-4 py-2 rounded-xl shadow-sm transition-colors cursor-pointer">
        {busy ? 'Lecture…' : '📎 Charger un fichier (.csv .tsv .xlsx)…'}
        <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" onChange={onFile} className="hidden" />
      </label>
    </div>

    {error ? (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 whitespace-pre-wrap">{error}</div>
    ) : null}

    <p className="text-[11px] text-slate-400 leading-relaxed">
      Les en-têtes sont détectés automatiquement et dirigés vers la bonne page : <b>Lignes budgétaires</b> →
      Recettes ; <b>Personnel</b> (annuaire) et <b>Stagiaires</b> → Personnel ; <b>Dépenses</b> (BC / SIFAC) → Dépenses ;
      <b>OMs</b> → OM ; <b>Souhaités</b> → Spese Desiderate ; <b>Questions_ouvertes</b> → Questioni ; <b>H&S</b> →
      Igiene e Sicurezza. Les montants « € 18.664,00 » et les dates « 20/10/2025 » sont convertis automatiquement, et
      la ligne budgétaire est reliée automatiquement quand le code projet figure dans « Ligne budgetaire ».
    </p>
  </div>
);

/* ── Étape 2 : aperçu & confirmation ──────────────────────────────────────── */
const ReviewBody = ({ analysis, pageLabel, dedupe, setDedupe, onBack, onImport }) => {
  const items = analysis.items || [];
  const preview = items.slice(0, 8);
  const more = Math.max(0, items.length - preview.length);
  return (
    <div className="p-6 overflow-y-auto custom-scrollbar flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-black text-slate-800">
          <span className="text-lg">{analysis.preset.icon}</span>
          {analysis.preset.title}
          <span className="text-[10px] font-black uppercase bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">→ page {pageLabel}</span>
        </div>
        <span className="text-xs font-bold text-slate-500">
          {items.length} élément{items.length > 1 ? 's' : ''} prêt{items.length > 1 ? 's' : ''} à importer
          {analysis.skipped > 0 ? ` · ${analysis.skipped} ligne(s) ignorée(s)` : ''}
        </span>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-black uppercase tracking-wide text-slate-500">
          Aperçu des lignes détectées
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-amber-700 px-4 py-3">Aucune donnée exploitable n’a été trouvée sous l’en-tête.</p>
        ) : (
          <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto custom-scrollbar">
            {preview.map((it) => (
              <div key={it.key} className="px-4 py-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-700 truncate">{it.preview.title}</div>
                  <div className="text-[10px] text-slate-400 truncate">{it.preview.sub}</div>
                </div>
                <div className="text-[11px] font-semibold text-slate-500 whitespace-nowrap shrink-0">{it.preview.extra}</div>
              </div>
            ))}
            {more > 0 ? <div className="px-4 py-2 text-[11px] text-slate-400 italic">… et {more} autre{more > 1 ? 's' : ''}.</div> : null}
          </div>
        )}
      </div>

      {analysis.unmatchedProjets && analysis.unmatchedProjets.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <b>Projets non reliés :</b> {[...new Set(analysis.unmatchedProjets)].join(', ')} — aucune ligne budgétaire
          correspondante dans Recettes (importez d’abord « Lignes budgétaires » puis relancez l’import : le stagiaire
          sera alors relié automatiquement à sa ligne).
        </div>
      ) : null}

      <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 cursor-pointer">
        <input type="checkbox" checked={dedupe} onChange={(e) => setDedupe(e.target.checked)} className="accent-blue-600" />
        Éviter les doublons (intitulé, dates, n° SIFAC…)
      </label>

      <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
        <button onClick={onBack} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 bg-slate-100">
          ← Changer la source
        </button>
        <button onClick={onImport} disabled={items.length === 0}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm px-5 py-2 rounded-xl shadow-sm transition-colors">
          Importer {items.length > 0 ? `les ${items.length} élément${items.length > 1 ? 's' : ''} ` : ''}dans {pageLabel}
        </button>
      </div>
    </div>
  );
};

/* ── Étape 3 : résultat ───────────────────────────────────────────────────── */
const Stat = ({ label, value, tone }) => (
  <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
    <div className={`text-2xl font-black ${tone || 'text-slate-700'}`}>{value}</div>
    <div className="text-[10px] font-bold uppercase text-slate-400 mt-0.5">{label}</div>
  </div>
);

const DoneBody = ({ summary, onReset, onClose }) => (
  <div className="p-6 overflow-y-auto custom-scrollbar flex flex-col gap-4">
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 flex items-start gap-3">
      <span className="text-3xl">✅</span>
      <div>
        <h3 className="font-black text-emerald-800">Import terminé</h3>
        <p className="text-xs text-emerald-700 mt-0.5">
          {summary.added} élément{summary.added > 1 ? 's' : ''} ajouté{summary.added > 1 ? 's' : ''} dans la page{' '}
          {collectionLabel(summary.listKind)}.
        </p>
      </div>
    </div>

    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
      <Stat label="Ajoutés" value={summary.added} tone="text-emerald-600" />
      <Stat label="Doublons ignorés" value={summary.doublons} tone="text-slate-500" />
      <Stat label={summary.listKind === 'personnel' ? 'Stagiaires reliés' : 'Liens recettes'} value={summary.relies} tone="text-blue-600" />
      <Stat label="Lignes ignorées" value={summary.skipped} tone="text-amber-600" />
    </div>

    {summary.unmatchedProjets && summary.unmatchedProjets.length > 0 ? (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
        <b>{summary.listKind === 'personnel'
          ? 'Projets non reliés (ligne introuvable dans Recettes) :'
          : 'Lignes budgétaires non reliées (aucune Recette correspondante) :'}</b>{' '}
        {[...new Set(summary.unmatchedProjets)].join(', ')}
        <div className="mt-1">Reliez-les ensuite avec le bouton « Lier » d’une ligne de Recettes.</div>
      </div>
    ) : null}

    <div className="flex items-center justify-end gap-2 pt-1">
      <button onClick={onReset} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 bg-slate-100">
        Importer une autre feuille
      </button>
      <button onClick={onClose} className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-5 py-2 rounded-xl shadow-sm transition-colors">
        Fermer et voir la page
      </button>
    </div>
  </div>
);
