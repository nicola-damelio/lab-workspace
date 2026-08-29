import React, { useMemo, useState } from 'react';
import { CollapsibleSection } from './TestShellRenderer';
import {
toNumber, INPUT_CLS,
cleanDna, reverseComplement, gcContent, calcTm, annealToTm,
RESTRICTION_ENZYMES, ENZYME_NAMES, scanAllEnzymes, codonOptimize
} from './cloningUtils';

/* ==========================================================================
CLONING STRATEGY PLANNER
Insert DNA auto-resolved from compoundMeta (Library)
Plasmid selected from plasmidMeta (Library → Plasmids)
Restriction/Ligation or Gibson Assembly primer design
Manual primer entry for actual primers used
========================================================================== */

const parseMcs = (mcs) =>
String(mcs || '')
.split(/[,\s;]+/)
.map((s) => s.trim())
.filter(Boolean)
.map((s) => ENZYME_NAMES.find((n) => n.toLowerCase() === s.toLowerCase()))
.filter(Boolean);

const resolveInsertSequence = (compoundName, compoundMeta) => {
const meta = compoundMeta?.[compoundName];
if (!meta) return { seq: '', source: null };
if (meta.type === 'dna' && meta.sequence) {
return { seq: cleanDna(meta.sequence), source: 'DNA sequence (Library)' };
}
if (meta.type === 'rna' && meta.sequence) {
return { seq: cleanDna(String(meta.sequence).replace(/U/g, 'T')), source: 'RNA → DNA conversion' };
}
if (meta.dnaSequence) {
return { seq: cleanDna(meta.dnaSequence), source: 'Saved codon-optimized DNA (Library)' };
}
if (meta.type === 'protein' && meta.sequence) {
return { seq: codonOptimize(meta.sequence, 'bacterial'), source: 'Codon-optimized on the fly (bacterial codons)' };
}
return { seq: '', source: null };
};

const DEFAULT_TASKS = [
{ offset: 0, task: 'PCR amplify insert (planner primers)' },
{ offset: 0, task: 'Digest vector backbone' },
{ offset: 1, task: 'Digest insert + gel purification' },
{ offset: 1, task: 'Ligation / Gibson assembly' },
{ offset: 2, task: 'Transformation into competent cells' },
{ offset: 3, task: 'Colony PCR screening' },
{ offset: 4, task: 'Miniprep + diagnostic digest' },
{ offset: 7, task: 'Sanger sequencing verification' }
];

const LABEL_CLS = 'block text-[10px] font-bold text-slate-500 uppercase mb-1';

const PrimerCard = ({ primer }) => {
const copy = () => {
try { navigator.clipboard.writeText(primer.seq); } catch {}
};
return (
 <div className= "bg-slate-50 border border-slate-200 rounded-lg p-3 flex flex-col gap-2 " >
 <div className= "flex justify-between items-center " >
 <span className= "text-xs font-black text-slate-700 " >{primer.name} </span >
 <button type= "button " onClick={copy} className= "text-[10px] font-bold bg-white border border-slate-300 hover:bg-blue-50 text-slate-600 px-2 py-1 rounded shadow-sm " >📋 Copy </button >
 </div >
 <p className= "font-mono text-[11px] text-slate-800 break-all bg-white border border-slate-200 rounded p-2 leading-relaxed " >{primer.seq} </p >
 <div className= "flex flex-wrap gap-2 text-[10px] font-bold " >
 <span className= "bg-blue-100 text-blue-700 px-2 py-0.5 rounded " >{primer.seq.length} nt </span >
 <span className= "bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded " >Tm(anneal) {primer.tm != null ?  `${primer.tm} °C`  : '—'} </span >
 <span className= "bg-violet-100 text-violet-700 px-2 py-0.5 rounded " >GC(anneal) {primer.gc != null ?  `${primer.gc.toFixed(1)} %`  : '—'} </span >
 </div >
 </div >
);
};

export const CloningStrategyPlanner = ({ ctx }) => {
const { activeTest, updateActiveTest, compoundMeta, allCmpds, selectedCompounds, plasmidMeta } = ctx;
const strategy = activeTest.cloningStrategy || {};
const setStrategy = (patch) => updateActiveTest({ cloningStrategy: { ...strategy, ...patch } });
const method = strategy.method || 'restriction';

/* Manual primer sequences */
const [showManualPrimers, setShowManualPrimers] = useState(false);
const [manualFwdSeq, setManualFwdSeq] = useState(strategy.manualFwdSeq || '');
const [manualRevSeq, setManualRevSeq] = useState(strategy.manualRevSeq || '');
const [manualFwdName, setManualFwdName] = useState(strategy.manualFwdName || 'Forward primer (manual)');
const [manualRevName, setManualRevName] = useState(strategy.manualRevName || 'Reverse primer (manual)');

const saveManualPrimers = () => {
setStrategy({
manualFwdSeq: manualFwdSeq.trim(),
manualRevSeq: manualRevSeq.trim(),
manualFwdName: manualFwdName.trim() || 'Forward primer (manual)',
manualRevName: manualRevName.trim() || 'Reverse primer (manual)'
});
};

/* Plasmid options — strictly the plasmids defined in the Library → Plasmids */
const plasmidOptions = useMemo(
() => Object.keys(plasmidMeta || {}).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
[plasmidMeta]
);

/* INSERT */
const insertCompound = strategy.insertCompound || (Array.isArray(selectedCompounds) && selectedCompounds[0]) || '';
const resolvedInsert = useMemo(() => resolveInsertSequence(insertCompound, compoundMeta), [insertCompound, compoundMeta]);
const insertSeq = cleanDna(strategy.insertSeq || resolvedInsert.seq);

/* VECTOR */
const vectorName = strategy.vectorName || '';
const vectorMetaFromPlasmids = plasmidMeta?.[vectorName];
const vectorMetaFromCompounds = compoundMeta?.[vectorName];
const vectorMeta = vectorMetaFromPlasmids || vectorMetaFromCompounds;
const vectorSeq = cleanDna(strategy.vectorSeq || vectorMeta?.sequence || vectorMeta?.insertSequence || '');

/* PARAMETERS */
const tmTarget = toNumber(strategy.tmTarget) ?? 60;
const padding = Math.max(0, Math.round(toNumber(strategy.padding) ?? 4));
const overlap = Math.max(10, Math.round(toNumber(strategy.overlap) ?? 20));
const insertionIndex = toNumber(strategy.insertionIndex);
const enzyme5 = strategy.enzyme5 || '';
const enzyme3 = strategy.enzyme3 || '';
const mcsEnzymes = useMemo(() => parseMcs(strategy.mcs), [strategy.mcs]);
const insertSitesMap = useMemo(() => scanAllEnzymes(insertSeq), [insertSeq]);
const mcsUsable = mcsEnzymes.filter((e) => !insertSitesMap[e]?.length);
const mcsBlocked = mcsEnzymes.filter((e) => insertSitesMap[e]?.length);

/* PRIMER DESIGN */
const annealF = useMemo(() => annealToTm(insertSeq, tmTarget, 'fwd'), [insertSeq, tmTarget]);
const annealRtail = useMemo(() => annealToTm(insertSeq, tmTarget, 'rev'), [insertSeq, tmTarget]);
const padStr = 'N'.repeat(padding);

let primers = null;
if (method === 'restriction' && enzyme5 && enzyme3 && insertSeq) {
const site5 = RESTRICTION_ENZYMES[enzyme5] || '';
const site3 = RESTRICTION_ENZYMES[enzyme3] || '';
primers = {
fwd: { name:  `Forward primer (5′ ${enzyme5})` , seq: padStr + site5 + annealF, tm: calcTm(annealF), gc: gcContent(annealF) },
rev: { name:  `Reverse primer (3′ ${enzyme3})` , seq: padStr + site3 + reverseComplement(annealRtail), tm: calcTm(annealRtail), gc: gcContent(annealRtail) }
};
} else if (method === 'gibson' && insertSeq && vectorSeq && insertionIndex != null) {
const homUp = vectorSeq.slice(Math.max(0, insertionIndex - overlap), insertionIndex);
const homDown = vectorSeq.slice(insertionIndex, insertionIndex + overlap);
primers = {
fwd: { name:  `Forward primer (Gibson, ${homUp.length} bp upstream overlap)` , seq: homUp + annealF, tm: calcTm(annealF), gc: gcContent(annealF) },
rev: { name:  `Reverse primer (Gibson, ${homDown.length} bp downstream overlap)` , seq: reverseComplement(homDown) + reverseComplement(annealRtail), tm: calcTm(annealRtail), gc: gcContent(annealRtail) }
};
}

const internalSiteWarnings = [enzyme5, enzyme3].filter(Boolean).map((e) => ({ enzyme: e, sites: insertSitesMap[e] || [] })).filter((w) => w.sites.length > 0);

/* VALIDATION */
const checks = [
{ ok: !!insertCompound, text: insertCompound ?  `Insert compound: ${insertCompound}`  : 'Select an insert compound.' },
{ ok: insertSeq.length > 0, text: insertSeq.length ?  `Insert DNA resolved (${insertSeq.length} bp).`  : 'No DNA sequence found for the insert.' },
{ ok: !!vectorName, text: vectorName ?  `Vector / plasmid: ${vectorName}`  : 'Select a plasmid / vector backbone.' },
...(method === 'restriction'
? [
{ ok: !!(enzyme5 && enzyme3), text: enzyme5 && enzyme3 ?  `Enzymes: 5′ ${enzyme5} / 3′ ${enzyme3}`  : 'Choose the 5′ and 3′ restriction enzymes.' },
{ ok: internalSiteWarnings.length === 0, text: internalSiteWarnings.length === 0 ? 'No internal sites for the chosen enzymes in the insert.' :  `⚠️ Internal site(s): ${internalSiteWarnings.map((w) =>` ${w.enzyme} @ ${w.sites.join(', ')} `).join(' | ')}` }
]
: [{ ok: vectorSeq.length > 0 && insertionIndex != null, text: vectorSeq.length && insertionIndex != null ?  `Gibson insertion position: ${insertionIndex} (vector ${vectorSeq.length} bp).`  : 'Gibson needs the vector sequence and an insertion position.' }])
];

/* TIMELINE */
const generateTimeline = () => {
const startStr = strategy.timelineStart || new Date().toISOString().split('T')[0];
const start = new Date(startStr + 'T00:00:00');
if (Number.isNaN(start.getTime())) { alert('Set a valid start date first.'); return; }
const plan = Array.isArray(activeTest.plan) ? activeTest.plan : [];
const label = `🧬 [Cloning${insertCompound ?` ${insertCompound}` : ''}${vectorName ?` → ${vectorName}` : ''}]`;
const newTasks = DEFAULT_TASKS.map((t, i) => {
const d = new Date(start); d.setDate(d.getDate() + t.offset);
return { id: Date.now() + i + Math.random(), date: d.toISOString().split('T')[0], task: `${label} ${t.task}` };
});
updateActiveTest({ plan: [...plan, ...newTasks].sort((a, b) => a.date.localeCompare(b.date)) });
alert(`${newTasks.length} cloning tasks added to the Agenda section.`);
};

const compoundOptions = [...new Set([...(Array.isArray(selectedCompounds) ? selectedCompounds : []), ...(Array.isArray(allCmpds) ? allCmpds : [])])].filter(Boolean);

return (
 <CollapsibleSection title= "Cloning Strategy Planner " icon= "🧭 " defaultOpen={false} headerExtra={ <span className= "text-[10px] font-black px-2 py-1 rounded-full border bg-teal-50 border-teal-300 text-teal-700 " >{insertCompound || 'no insert'} → {vectorName || 'no vector'} </span >} >
 <div className= "flex flex-col gap-6 " >
      {/* INSERT & VECTOR */}
       <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
         {/* INSERT */}
         <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-3">
           <h4 className="text-xs font-black text-slate-600 uppercase">🧬 Insert</h4>
           <div>
             <label className={LABEL_CLS}>Compound (from Library)</label>
             <select value={insertCompound} onChange={(e) => setStrategy({ insertCompound: e.target.value, insertSeq: '' })} className={INPUT_CLS}>
               <option value="">— Select compound —</option>
               {compoundOptions.map((c) => <option key={c} value={c}>{c}</option>)}
             </select>
           </div>
           {resolvedInsert.source && !strategy.insertSeq && (
             <p className="text-[11px] font-bold text-teal-700 bg-teal-50 border border-teal-200 rounded p-2">
               ✅ Auto-resolved: {resolvedInsert.source} ({insertSeq.length} bp)
             </p>
           )}
           <div>
             <div className="flex justify-between items-center mb-1">
               <label className={LABEL_CLS + ' mb-0'}>Insert DNA sequence (5′→3′)</label>
               {strategy.insertSeq && (
                 <button type="button" onClick={() => setStrategy({ insertSeq: '' })} className="text-[10px] font-bold text-blue-600 hover:underline">♻ Re-sync from compound</button>
               )}
             </div>
             <textarea value={insertSeq} onChange={(e) => setStrategy({ insertSeq: e.target.value.toUpperCase() })} rows={5} className={`${INPUT_CLS} font-mono text-[11px]`} placeholder="Paste DNA here or define the compound in the Library…" />
           </div>
         </div>
         {/* VECTOR — plasmid dropdown from the Library */}
         <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-3">
           <h4 className="text-xs font-black text-slate-600 uppercase">🦠 Vector / Plasmid</h4>
           <div>
             <label className={LABEL_CLS}>Plasmid (from Library → Plasmids)</label>
             <select value={vectorName} onChange={(e) => setStrategy({ vectorName: e.target.value, vectorSeq: '' })} className={INPUT_CLS}>
               <option value="">— Select plasmid —</option>
               {plasmidOptions.map((c) => <option key={c} value={c}>{c}</option>)}
             </select>
           </div>
           {vectorMeta && (
             <p className="text-[11px] font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded p-2">
               Type: {vectorMeta.type || vectorMeta.backbone || '—'} | Length: {cleanDna(vectorMeta.sequence || vectorMeta.insertSequence || '').length || '—'} bp |
               {vectorMeta.backbone ? ` Backbone: ${vectorMeta.backbone} |` : ''}
               {vectorMeta.marker ? ` Marker: ${vectorMeta.marker} |` : ''}
               MW: {vectorMeta.molecularWeight ? `${Number(vectorMeta.molecularWeight).toLocaleString()} Da` : '—'}
             </p>
           )}
           <div>
             <div className="flex justify-between items-center mb-1">
               <label className={LABEL_CLS + ' mb-0'}>Vector sequence (needed for Gibson)</label>
               {strategy.vectorSeq && (
                 <button type="button" onClick={() => setStrategy({ vectorSeq: '' })} className="text-[10px] font-bold text-blue-600 hover:underline">♻ Re-sync from library</button>
               )}
             </div>
             <textarea value={vectorSeq} onChange={(e) => setStrategy({ vectorSeq: e.target.value.toUpperCase() })} rows={5} className={`${INPUT_CLS} font-mono text-[11px]`} placeholder="Paste full plasmid sequence (auto-filled from plasmid definitions if available)…" />
           </div>
           {method === 'gibson' && (
             <div>
               <label className={LABEL_CLS}>Insertion position in vector (0-based index)</label>
               <input type="number" value={strategy.insertionIndex ?? ''} onChange={(e) => setStrategy({ insertionIndex: e.target.value })} className={INPUT_CLS} placeholder="e.g. 1542" />
             </div>
           )}
         </div>
       </div>
       {/* METHOD + PARAMETERS */}
       <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
         <div className="flex flex-wrap gap-2 mb-4">
           {[{ id: 'restriction', label: '🔪 Restriction / Ligation' }, { id: 'gibson', label: '🧩 Gibson Assembly' }].map((t) => (
             <button key={t.id} type="button" onClick={() => setStrategy({ method: t.id })} className={`px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${method === t.id ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>{t.label}</button>
           ))}
         </div>
         {method === 'restriction' ? (
           <div className="flex flex-col gap-4">
             <div>
               <label className={LABEL_CLS}>Vector MCS sites (comma separated)</label>
               <input type="text" value={strategy.mcs || ''} onChange={(e) => setStrategy({ mcs: e.target.value })} className={INPUT_CLS} placeholder="e.g. EcoRI, BamHI, HindIII, XhoI, NdeI, NotI" />
               {mcsEnzymes.length > 0 && (
                 <div className="flex flex-wrap gap-1.5 mt-2">
                   {mcsUsable.map((e) => <span key={e} className="text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-300 px-2 py-0.5 rounded">✓ {e}</span>)}
                   {mcsBlocked.map((e) => <span key={e} className="text-[10px] font-bold bg-red-100 text-red-700 border border-red-300 px-2 py-0.5 rounded">✗ {e} (in insert)</span>)}
                 </div>
               )}
             </div>
             <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
               <div><label className={LABEL_CLS}>5′ enzyme</label><select value={enzyme5} onChange={(e) => setStrategy({ enzyme5: e.target.value })} className={INPUT_CLS}><option value="">— Select —</option>{ENZYME_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
               <div><label className={LABEL_CLS}>3′ enzyme</label><select value={enzyme3} onChange={(e) => setStrategy({ enzyme3: e.target.value })} className={INPUT_CLS}><option value="">— Select —</option>{ENZYME_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
               <div><label className={LABEL_CLS}>5′ padding (nt)</label><input type="number" value={strategy.padding ?? '4'} onChange={(e) => setStrategy({ padding: e.target.value })} className={INPUT_CLS} /></div>
               <div><label className={LABEL_CLS}>Target Tm anneal (°C)</label><input type="number" value={strategy.tmTarget ?? '60'} onChange={(e) => setStrategy({ tmTarget: e.target.value })} className={INPUT_CLS} /></div>
             </div>
             {internalSiteWarnings.length > 0 && (
               <div className="bg-red-50 border border-red-300 rounded-lg p-3 text-xs text-red-700 font-bold">
                 ⚠️ The insert contains internal sites for the selected enzyme(s):
                 <ul className="list-disc ml-5 mt-1 font-normal">
                   {internalSiteWarnings.map((w) => <li key={w.enzyme}>{w.enzyme} at position(s) {w.sites.join(', ')} — pick another enzyme or use a modified insert.</li>)}
                 </ul>
               </div>
             )}
           </div>
         ) : (
           <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
             <div><label className={LABEL_CLS}>Overlap length (bp)</label><input type="number" value={strategy.overlap ?? '20'} onChange={(e) => setStrategy({ overlap: e.target.value })} className={INPUT_CLS} /></div>
             <div><label className={LABEL_CLS}>Target Tm anneal (°C)</label><input type="number" value={strategy.tmTarget ?? '60'} onChange={(e) => setStrategy({ tmTarget: e.target.value })} className={INPUT_CLS} /></div>
             <div className="col-span-2 flex items-end"><p className="text-[11px] text-slate-500 italic">Gibson primers use homology arms taken from the vector sequence around the insertion position.</p></div>
           </div>
         )}
       </div>
       {/* DESIGNED PRIMERS */}
       <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
         <div className="flex items-center justify-between mb-3">
           <h4 className="text-xs font-black text-slate-600 uppercase">🔬 Primers</h4>
           <button type="button" onClick={() => setShowManualPrimers(!showManualPrimers)} className={`text-[10px] font-bold px-3 py-1.5 rounded-lg border transition-colors ${showManualPrimers ? 'bg-amber-100 border-amber-400 text-amber-800' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
             ✏️ Manual Primers
           </button>
         </div>
         {/* Auto-designed primers */}
         {primers ? (
           <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
             <PrimerCard primer={primers.fwd} />
             <PrimerCard primer={primers.rev} />
           </div>
         ) : (
           <p className="text-sm text-slate-400 italic mb-4">Complete insert + method parameters above to generate primers automatically.</p>
         )}
         {/* Manual primer entry */}
         {showManualPrimers && (
           <div className="mt-4 border-t border-slate-200 pt-4">
             <h5 className="text-[11px] font-black text-amber-700 uppercase mb-3">✏️ Manual Primer Entry (actual primers used)</h5>
             <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
               <div className="flex flex-col gap-2">
                 <label className={LABEL_CLS}>Forward primer name</label>
                 <input type="text" value={manualFwdName} onChange={(e) => setManualFwdName(e.target.value)} className={INPUT_CLS} placeholder="Forward primer name" />
                 <label className={LABEL_CLS}>Forward primer sequence (5′→3′)</label>
                 <textarea value={manualFwdSeq} onChange={(e) => setManualFwdSeq(e.target.value.toUpperCase())} rows={3} className={`${INPUT_CLS} font-mono text-[11px]`} placeholder="ATGCGTACGATCG…" />
                 {manualFwdSeq && (
                   <div className="flex flex-wrap gap-2 text-[10px] font-bold">
                     <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{cleanDna(manualFwdSeq).length} nt</span>
                     <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">Tm {calcTm(cleanDna(manualFwdSeq)) ?? '—'} °C</span>
                     <span className="bg-violet-100 text-violet-700 px-2 py-0.5 rounded">GC {gcContent(cleanDna(manualFwdSeq))?.toFixed(1) ?? '—'}%</span>
                   </div>
                 )}
               </div>
               <div className="flex flex-col gap-2">
                 <label className={LABEL_CLS}>Reverse primer name</label>
                 <input type="text" value={manualRevName} onChange={(e) => setManualRevName(e.target.value)} className={INPUT_CLS} placeholder="Reverse primer name" />
                 <label className={LABEL_CLS}>Reverse primer sequence (5′→3′)</label>
                 <textarea value={manualRevSeq} onChange={(e) => setManualRevSeq(e.target.value.toUpperCase())} rows={3} className={`${INPUT_CLS} font-mono text-[11px]`} placeholder="TCAGGATCCGCTAG…" />
                 {manualRevSeq && (
                   <div className="flex flex-wrap gap-2 text-[10px] font-bold">
                     <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{cleanDna(manualRevSeq).length} nt</span>
                     <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">Tm {calcTm(cleanDna(manualRevSeq)) ?? '—'} °C</span>
                     <span className="bg-violet-100 text-violet-700 px-2 py-0.5 rounded">GC {gcContent(cleanDna(manualRevSeq))?.toFixed(1) ?? '—'}%</span>
                   </div>
                 )}
               </div>
             </div>
             <button type="button" onClick={saveManualPrimers} className="mt-3 bg-amber-600 hover:bg-amber-700 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-sm">
               💾 Save Manual Primers
             </button>
             {(strategy.manualFwdSeq || strategy.manualRevSeq) && (
               <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
                 {strategy.manualFwdSeq && <PrimerCard primer={{ name: strategy.manualFwdName || 'Forward primer (manual)', seq: strategy.manualFwdSeq, tm: calcTm(cleanDna(strategy.manualFwdSeq)), gc: gcContent(cleanDna(strategy.manualFwdSeq)) }} />}
                 {strategy.manualRevSeq && <PrimerCard primer={{ name: strategy.manualRevName || 'Reverse primer (manual)', seq: strategy.manualRevSeq, tm: calcTm(cleanDna(strategy.manualRevSeq)), gc: gcContent(cleanDna(strategy.manualRevSeq)) }} />}
               </div>
             )}
           </div>
         )}
       </div>
       {/* INTERNAL SITES TABLE */}
       {insertSeq && Object.keys(insertSitesMap).length > 0 && (
         <details className="bg-white border border-slate-200 rounded-xl shadow-sm">
           <summary className="cursor-pointer p-4 text-xs font-black text-slate-600 uppercase">🧪 All restriction sites detected inside the insert ({Object.keys(insertSitesMap).length} enzymes)</summary>
           <div className="px-4 pb-4 overflow-x-auto custom-scrollbar">
             <table className="w-full text-xs">
               <thead className="text-slate-500 uppercase bg-slate-100"><tr><th className="px-3 py-1.5 text-left border-b">Enzyme</th><th className="px-3 py-1.5 text-left border-b">Recognition</th><th className="px-3 py-1.5 text-left border-b">Positions</th></tr></thead>
               <tbody className="divide-y divide-slate-100">
                 {Object.entries(insertSitesMap).map(([enz, sites]) => (
                   <tr key={enz}><td className="px-3 py-1.5 font-bold text-slate-700">{enz}</td><td className="px-3 py-1.5 font-mono">{RESTRICTION_ENZYMES[enz]}</td><td className="px-3 py-1.5 font-mono text-slate-600">{sites.join(', ')}</td></tr>
                 ))}
               </tbody>
             </table>
           </div>
         </details>
       )}
       {/* VALIDATION + TIMELINE */}
       <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
         <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
           <h4 className="text-xs font-black text-slate-600 uppercase mb-3">✅ Strategy Checklist</h4>
           <ul className="flex flex-col gap-1.5">
             {checks.map((c, i) => (
               <li key={i} className={`text-xs flex gap-2 ${c.ok ? 'text-emerald-700' : 'text-red-600'}`}>
                 <span className="font-black">{c.ok ? '✅' : '❌'}</span>
                 <span>{c.text}</span>
               </li>
             ))}
           </ul>
         </div>
         <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-3">
           <h4 className="text-xs font-black text-slate-600 uppercase">📅 Generate Cloning Timeline (Agenda)</h4>
           <div className="flex flex-wrap items-end gap-3">
             <div className="flex-1 min-w-[160px]"><label className={LABEL_CLS}>Start date</label><input type="date" value={strategy.timelineStart || ''} onChange={(e) => setStrategy({ timelineStart: e.target.value })} className={INPUT_CLS} /></div>
             <button type="button" onClick={generateTimeline} className="bg-teal-600 hover:bg-teal-700 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-sm">➕ Add {DEFAULT_TASKS.length} tasks to Agenda</button>
           </div>
           <ul className="text-[11px] text-slate-500 flex flex-col gap-0.5 mt-1">
             {DEFAULT_TASKS.map((t, i) => <li key={i}>Day +{t.offset}: {t.task}</li>)}
           </ul>
         </div>
       </div>
     </div>
   </CollapsibleSection>
 );
};
export default CloningStrategyPlanner;