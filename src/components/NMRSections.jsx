import React, { useState, useMemo, useEffect } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceArea, BarChart, Bar
} from 'recharts';
import {
  AMINO_ACID_DB, NUCLEOTIDE_DB, SUGAR_DB, LIPID_DB, CARBON_RANGE_DB,
  SS_CORRECTIONS, SS_META, FORM_META, DNA_FORM_OFFSETS, SUGAR_ANOMER_OFFSETS,
  RESIDUE_COLORS, parseManual, getCarbonName, buildKeys, getProtonCountEx,
  getPascalRow, getCarbonRangeFor, buildProteinStructure, buildNucleicStructure,
  buildSugarStructure, buildLipidStructure, elementsToSVG, StructureSVGView,
  RangeBarChart, OneDSpectrumPlot, SpectrumPlot, HSQCPlot, SequencePaintStrip,
  SELECT_COLOR, MANUAL_COLOR
} from './NMRData';

const FS_CLASSES =
  'fixed top-4 left-4 z-[999999] bg-white shadow-2xl rounded-2xl !w-[calc(100vw-2rem)] !h-[calc(100vh-2rem)] !max-w-none !max-h-none !m-0 overflow-hidden flex flex-col';
const OVERLAY_CLASSES = 'fixed top-0 left-0 w-screen h-screen bg-slate-900/50 backdrop-blur-sm z-[999990]';

/* ---------- derived NMR state hook ---------- */
function useNmrDerived(activeTest) {
  const moleculeType = activeTest.moleculeType || 'protein';
  const rawSeq = (activeTest.proteinSequence || '').toUpperCase();
  const validChars = moleculeType === 'protein' ? 'ACDEFGHIKLMNPQRSTVWY' : moleculeType === 'dna' ? 'ACGT' : moleculeType === 'rna' ? 'ACGU' : '';
  const seq = (moleculeType === 'protein' || moleculeType === 'dna' || moleculeType === 'rna') ? rawSeq.replace(new RegExp(`[^${validChars}]`, 'g'), '') : '';
  const isPolymer = moleculeType === 'protein' || moleculeType === 'dna' || moleculeType === 'rna';
  const hasPhosphorus = moleculeType === 'dna' || moleculeType === 'rna' || moleculeType === 'lipid';
  const DB = moleculeType === 'protein' ? AMINO_ACID_DB : moleculeType === 'dna' ? NUCLEOTIDE_DB.DNA : moleculeType === 'rna' ? NUCLEOTIDE_DB.RNA : moleculeType === 'sugar' ? SUGAR_DB : LIPID_DB;
  const ssRaw = activeTest.secondaryStructure || '';
  const getSSAt = (i) => (ssRaw[i] && 'HES'.includes(ssRaw[i]) ? ssRaw[i] : 'C');
  const formsRaw = activeTest.nucleicForms || '';
  const dnaFormDefault = activeTest.dnaForm || 'B';
  const getFormAt = (i) => (formsRaw[i] && 'ABZ'.includes(formsRaw[i]) ? formsRaw[i] : dnaFormDefault);
  const sugarConf = activeTest.sugarConf || 'chair';
  const sugarAnomer = activeTest.sugarAnomer || 'alpha';
  const lipidDB = activeTest.lipidDB || 'cis';
  const shifts = activeTest.chemicalShifts || {};

  const parsedSeq = useMemo(() => {
    let chars = [];
    if (isPolymer) { if (!seq) return []; chars = seq.split(''); }
    else if (moleculeType === 'sugar') chars = [activeTest.sugarChoice || 'GLC'];
    else if (moleculeType === 'lipid') chars = [activeTest.lipidChoice || 'POPC'];
    const assigned = [];
    return chars.map((char, index) => {
      const entry = DB[char];
      if (!entry) return null;
      const gen = {};
      Object.keys(entry.ranges).forEach((atom) => {
        const r = entry.ranges[atom];
        let val = r.min, success = false, minDist = 0.3;
        while (minDist >= 0.05 && !success) {
          for (let i = 0; i < 50; i++) {
            const cand = r.min + Math.random() * (r.max - r.min);
            if (!assigned.some((a) => Math.abs(a - cand) < minDist)) { val = cand; success = true; break; }
          }
          minDist -= 0.05;
        }
        assigned.push(val);
        gen[atom] = parseFloat(val.toFixed(2));
      });
      const cShifts = {}, gen13 = {};
      Object.keys(gen).forEach((atom) => {
        const cn = getCarbonName(moleculeType, char, atom);
        if (!cn) return;
        if (!cShifts[cn]) { const range = getCarbonRangeFor(moleculeType, char, cn); cShifts[cn] = parseFloat((range.min + Math.random() * (range.max - range.min)).toFixed(1)); }
        gen13[atom] = cShifts[cn];
      });
      const backboneRand = moleculeType === 'protein' ? { N: parseFloat((117 + Math.random() * 8).toFixed(1)), CP: parseFloat((172 + Math.random() * 5).toFixed(1)) } : null;
      const p31 = hasPhosphorus ? parseFloat((-2 + Math.random() * 3).toFixed(2)) : null;
      return { ...entry, id: `${entry.code3 || char}${index + 1}`, char, color: RESIDUE_COLORS[index % RESIDUE_COLORS.length], shifts: gen, shifts13C: gen13, uniqueCShifts: { ...cShifts }, backboneRand, p31 };
    }).filter(Boolean);
  }, [seq, moleculeType, activeTest.sugarChoice, activeTest.lipidChoice]);

  const estSeq = useMemo(() => parsedSeq.map((res, idx) => {
    const ssLetter = moleculeType === 'protein' ? getSSAt(idx) : 'C';
    const ssKey = { C: 'coil', H: 'helix', E: 'sheet' }[ssLetter];
    const corr = SS_CORRECTIONS[ssKey];
    const estShifts = {};
    Object.keys(res.shifts || {}).forEach((a) => {
      let v = res.shifts[a];
      if (moleculeType === 'protein' && ssKey !== 'coil') { const h = corr.h; v += h[a] !== undefined ? h[a] : h.other || 0; }
      if (moleculeType === 'dna' || moleculeType === 'rna') { const f = getFormAt(idx); if (DNA_FORM_OFFSETS[f] && DNA_FORM_OFFSETS[f][a] !== undefined) v += DNA_FORM_OFFSETS[f][a]; }
      if (moleculeType === 'sugar') { const off = SUGAR_ANOMER_OFFSETS[sugarAnomer]; if (off && off[a] !== undefined) v += off[a]; }
      estShifts[a] = +v.toFixed(2);
    });
    const estUniqueC = {};
    Object.keys(res.uniqueCShifts || {}).forEach((cn) => { let v = res.uniqueCShifts[cn]; if (moleculeType === 'protein' && ssKey !== 'coil') v += corr.c[cn] || 0; estUniqueC[cn] = +v.toFixed(2); });
    const estShifts13C = {};
    Object.keys(res.shifts13C || {}).forEach((a) => { const cn = getCarbonName(moleculeType, res.char, a); if (cn && estUniqueC[cn] !== undefined) estShifts13C[a] = estUniqueC[cn]; });
    let estN = null, estCP = null;
    if (moleculeType === 'protein' && res.backboneRand) { estN = +(res.backboneRand.N + (ssKey !== 'coil' ? corr.c['N'] || 0 : 0)).toFixed(2); estCP = +(res.backboneRand.CP + (ssKey !== 'coil' ? corr.c["C'"] || 0 : 0)).toFixed(2); }
    return { ...res, estShifts, estUniqueC, estShifts13C, estN, estCP, ssLetter, formLetter: getFormAt(idx) };
  }), [parsedSeq, moleculeType, ssRaw, formsRaw, dnaFormDefault, sugarAnomer]);

  const simSeq = useMemo(() => {
    const getMan = (idx, name) => {
      const cands = [`${idx}-${name}`, `${idx}-${String(name).trim()}`, `${idx}-${String(name).replace(/\s+/g, '')}`];
      for (const k of cands) { const m = parseManual(shifts[k]); if (m !== null) return m; }
      return null;
    };
    return estSeq.map((res, idx) => {
      const simShifts = {};
      Object.keys(res.estShifts || {}).forEach((a) => { const m = getMan(idx, a); simShifts[a] = m !== null ? m : res.estShifts[a]; });
      const simUniqueC = {};
      Object.keys(res.estUniqueC || {}).forEach((cn) => { const m = getMan(idx, cn); simUniqueC[cn] = m !== null ? m : res.estUniqueC[cn]; });
      const simShifts13C = {};
      Object.keys(res.estShifts13C || {}).forEach((a) => { const cn = getCarbonName(moleculeType, res.char, a); if (cn) simShifts13C[a] = simUniqueC[cn]; });
      return { ...res, simShifts, simUniqueC, simShifts13C };
    });
  }, [estSeq, shifts, moleculeType]);

  const structure = useMemo(() => {
    if (parsedSeq.length === 0) return null;
    if (moleculeType === 'protein') return buildProteinStructure(parsedSeq);
    if (moleculeType === 'dna' || moleculeType === 'rna') return buildNucleicStructure(parsedSeq, moleculeType);
    if (moleculeType === 'sugar') return buildSugarStructure(parsedSeq[0], sugarConf, sugarAnomer);
    if (moleculeType === 'lipid') return buildLipidStructure(parsedSeq[0], lipidDB);
    return null;
  }, [parsedSeq, moleculeType, sugarConf, sugarAnomer, lipidDB]);

  return { moleculeType, seq, validChars, isPolymer, hasPhosphorus, DB, getSSAt, getFormAt, sugarConf, sugarAnomer, lipidDB, shifts, parsedSeq, estSeq, simSeq, structure, dnaFormDefault };
}

/* ---------- peaks ---------- */
function buildPeaks(simSeq, moleculeType, hasPhosphorus) {
  let diag = [], cosy = [], tocsy = [], noesy = [], hsqc = [], d1H = [], d13C = [], p31 = [];
  const addPair = (arr, x, y, label, type, colorClass, size, keys) => { arr.push({ x, y, label, type, colorClass, size, keys }); arr.push({ x: y, y: x, label, type, colorClass, size, keys }); };
  simSeq.forEach((res, index) => {
    if (!res.simShifts) return;
    Object.entries(res.simShifts).forEach(([atom, ppm]) => {
      let pks = [{ shift: ppm, intensity: 1 }];
      let totalNeighbors = 0;
      if (res.cosy) res.cosy.forEach((pair) => {
        const nb = pair[0] === atom ? pair[1] : pair[1] === atom ? pair[0] : null;
        if (nb) {
          const count = getProtonCountEx(moleculeType, res, nb);
          totalNeighbors += count;
          const jC = 0.01 + Math.random() * 0.008;
          const pr = getPascalRow(count);
          let np = [];
          pks.forEach((p) => { for (let k = 0; k <= count; k++) np.push({ shift: p.shift + (k - count / 2) * jC, intensity: p.intensity * pr[k] }); });
          pks = np;
        }
      });
      let merged = [];
      pks.sort((a, b) => a.shift - b.shift);
      pks.forEach((p) => {
        if (merged.length > 0) { const last = merged[merged.length - 1]; if (Math.abs(last.shift - p.shift) < 0.002) { last.shift = (last.shift * last.intensity + p.shift * p.intensity) / (last.intensity + p.intensity); last.intensity += p.intensity; } else merged.push({ ...p }); }
        else merged.push({ ...p });
      });
      const pCount = getProtonCountEx(moleculeType, res, atom);
      const maxI = Math.max(...merged.map((p) => p.intensity));
      const baseI = (1.5 + Math.random() * 0.5) * pCount;
      let multStr = 'm';
      if (totalNeighbors === 0) multStr = 's';
      else if (totalNeighbors === 1) multStr = 'd';
      else if (totalNeighbors === 2) multStr = merged.length === 3 ? 't' : 'dd';
      else if (totalNeighbors === 3) multStr = merged.length === 4 ? 'q' : 'm';
      const keys = buildKeys(index, [atom], moleculeType, res.char);
      merged.forEach((p) => d1H.push({ x: p.shift, y: (p.intensity / maxI) * baseI, label: `${res.id} ${atom}`, color: res.color, type: '1D', multiplet: multStr, keys }));
    });
    Object.entries(res.simUniqueC || {}).forEach(([cn, ppm]) => d13C.push({ x: ppm, y: 0.8 + Math.random() * 0.4, label: `${res.id} ${cn}`, color: res.color, type: '1D', keys: [`${index}-${cn}`] }));
    Object.keys(res.simShifts).forEach((atom) => diag.push({ x: res.simShifts[atom], y: res.simShifts[atom], label: `${res.id} ${atom}`, type: 'Diagonal', size: 4, keys: buildKeys(index, [atom], moleculeType, res.char) }));
    if (res.cosy) res.cosy.forEach(([a1, a2]) => { if (res.simShifts[a1] !== undefined && res.simShifts[a2] !== undefined) addPair(cosy, res.simShifts[a1], res.simShifts[a2], res.id, `${a1}-${a2} (COSY)`, 'cosy', 4, buildKeys(index, [a1, a2], moleculeType, res.char)); });
    if (res.spinSystems) res.spinSystems.forEach((sys) => { for (let i = 0; i < sys.length; i++) for (let j = i + 1; j < sys.length; j++) { if (res.simShifts[sys[i]] !== undefined && res.simShifts[sys[j]] !== undefined) { const isDirect = res.cosy && res.cosy.some((c) => (c[0] === sys[i] && c[1] === sys[j]) || (c[0] === sys[j] && c[1] === sys[i])); addPair(tocsy, res.simShifts[sys[i]], res.simShifts[sys[j]], res.id, `${sys[i]}-${sys[j]} (${isDirect ? 'Direct' : 'Relay'})`, isDirect ? 'tocsyDirect' : 'tocsyRelay', 4, buildKeys(index, [sys[i], sys[j]], moleculeType, res.char)); } } });
    const adj = {};
    if (res.cosy) res.cosy.forEach(([u, v]) => { if (!adj[u]) adj[u] = []; if (!adj[v]) adj[v] = []; adj[u].push(v); adj[v].push(u); });
    const seen = new Set();
    if (res.cosy) res.cosy.forEach(([a1, a2]) => { seen.add([a1, a2].sort().join('-')); if (res.simShifts[a1] !== undefined && res.simShifts[a2] !== undefined) addPair(noesy, res.simShifts[a1], res.simShifts[a2], res.id, `${a1}-${a2} (NOE Intra)`, 'noesyIntra', 4, buildKeys(index, [a1, a2], moleculeType, res.char)); });
    Object.keys(adj).forEach((u) => adj[u].forEach((v) => adj[v].forEach((w) => { if (u !== w) { const pk = [u, w].sort().join('-'); if (!seen.has(pk)) { seen.add(pk); if (res.simShifts[u] !== undefined && res.simShifts[w] !== undefined) addPair(noesy, res.simShifts[u], res.simShifts[w], res.id, `${u}-${w} (NOE 4-bond)`, 'noesyIntra4', 3, buildKeys(index, [u, w], moleculeType, res.char)); } } })));
    if (index < simSeq.length - 1 && moleculeType === 'protein') { const nr = simSeq[index + 1]; if (res.simShifts['HN'] !== undefined && nr.simShifts['HN'] !== undefined) addPair(noesy, res.simShifts['HN'], nr.simShifts['HN'], 'Seq. NOE', `${res.id} HN ↔ ${nr.id} HN`, 'noesySeq', 3, [...buildKeys(index, ['HN'], 'protein', res.char), ...buildKeys(index + 1, ['HN'], 'protein', nr.char)]); }
    Object.keys(res.simShifts13C || {}).forEach((atom) => { if (res.simShifts[atom] !== undefined) { const cn = getCarbonName(moleculeType, res.char, atom); hsqc.push({ x: res.simShifts[atom], y: res.simShifts13C[atom], label: `${res.id} ${atom}-${cn}`, type: 'HSQC', colorClass: 'hsqc', size: 4, keys: [...buildKeys(index, [atom], moleculeType, res.char), `${index}-${cn}`] }); } });
    if (hasPhosphorus && res.p31 !== null) p31.push({ x: res.p31, y: 0.8 + Math.random() * 0.4, label: `${res.id} P`, color: res.color, type: '1D', colorClass: 'p31', keys: [`${index}-P`] });
  });
  return { diagonalData: diag, cosyPeaks: cosy, tocsyPeaks: tocsy, noesyPeaks: noesy, hsqcPeaks: hsqc, data1H: d1H, data13C: d13C, p31Data: p31 };
}

/* ================= SETUP: sequence + painting + structure ================= */
export const Setup = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useNmrDerived(activeTest);
  const [ssBrush, setSSBrush] = useState('H');
  const [formBrush, setFormBrush] = useState(activeTest.dnaForm || 'B');
  const [expandedPanel, setExpandedPanel] = useState(null);
  const [selected, setSelected] = useState(null);
  const [focusIdx, setFocusIdx] = useState('ALL');
  const selectedKeys = selected ? selected.keys : null;

  const paintSSAt = (i, letter) => { const arr = d.seq.split('').map((_, j) => d.getSSAt(j)); arr[i] = letter; updateActiveTest({ secondaryStructure: arr.join('') }); };
  const setAllSS = (letter) => updateActiveTest({ secondaryStructure: d.seq.split('').map(() => letter).join('') });
  const paintFormAt = (i, letter) => { const arr = d.seq.split('').map((_, j) => d.getFormAt(j)); arr[i] = letter; updateActiveTest({ nucleicForms: arr.join('') }); };
  const setAllForms = (letter) => updateActiveTest({ nucleicForms: d.seq.split('').map(() => letter).join(''), dnaForm: letter });
  const handleAtomClick = (ri, keys) => { if (ri === null || !keys) return; setSelected((prev) => (prev && prev.ri === ri && prev.keys.join('|') === keys.join('|') ? null : { ri, keys })); };

  const typeLabel = d.moleculeType === 'protein' ? 'Protein' : d.moleculeType === 'dna' ? 'DNA' : d.moleculeType === 'rna' ? 'RNA' : d.moleculeType === 'sugar' ? 'Sugar' : 'Phospholipid';

  return (
    <div className="flex flex-col gap-6">
      {/* molecule type */}
      <div className="flex flex-wrap gap-2">
        {[['protein', '🧬 Protein'], ['dna', '🧬 DNA'], ['rna', '🧬 RNA'], ['sugar', '🍬 Sugars'], ['lipid', '🫧 Phospholipids']].map(([val, lab]) => (
          <button key={val} onClick={() => updateActiveTest({ moleculeType: val })} className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors ${d.moleculeType === val ? 'bg-blue-600 border-blue-700 text-white shadow' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}>{lab}</button>
        ))}
      </div>
      {/* sequence input */}
      {d.isPolymer ? (
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-2">{typeLabel} Sequence (1-letter code)</label>
          <textarea value={activeTest.proteinSequence || ''} onChange={(e) => updateActiveTest({ proteinSequence: e.target.value })}
            className="w-full border border-slate-300 rounded-lg p-3 font-mono text-sm tracking-widest outline-none focus:border-blue-500 uppercase h-24 custom-scrollbar shadow-inner"
            placeholder={d.moleculeType === 'protein' ? 'e.g. MKWVTFISLL...' : d.moleculeType === 'dna' ? 'e.g. ATGCGTAC...' : 'e.g. AUGCGUAC...'} />
          <p className="text-[10px] text-slate-400 mt-1 font-bold">Length: {d.seq.length} {d.moleculeType === 'protein' ? 'residues' : 'nucleotides'} (valid: {d.validChars.split('').join(' ')})</p>
        </div>
      ) : d.moleculeType === 'sugar' ? (
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Select Sugar</label>
          <select value={activeTest.sugarChoice || 'GLC'} onChange={(e) => updateActiveTest({ sugarChoice: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white outline-none focus:border-blue-500 font-semibold">
            {Object.entries(SUGAR_DB).map(([k, v]) => <option key={k} value={k}>{v.name} ({v.code3})</option>)}
          </select>
        </div>
      ) : (
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Select Phospholipid</label>
          <select value={activeTest.lipidChoice || 'POPC'} onChange={(e) => updateActiveTest({ lipidChoice: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white outline-none focus:border-blue-500 font-semibold">
            {Object.entries(LIPID_DB).map(([k, v]) => <option key={k} value={k}>{k} — {v.name}</option>)}
          </select>
        </div>
      )}
      {/* protein painting */}
      {d.moleculeType === 'protein' && d.parsedSeq.length > 0 && (
        <div>
          <div className="flex flex-wrap gap-2 mb-3 items-center">
            <span className="text-xs font-bold text-slate-500 uppercase mr-1">🖌️ Brush:</span>
            {['C', 'H', 'E'].map((l) => (
              <button key={l} onClick={() => setSSBrush(l)} className="px-3 py-1 rounded-lg text-xs font-black border" style={{ backgroundColor: ssBrush === l ? SS_META[l].color : 'white', borderColor: SS_META[l].color, color: ssBrush === l ? 'white' : SS_META[l].color }}>{SS_META[l].label}</button>
            ))}
            <button onClick={() => setAllSS('C')} className="px-3 py-1 rounded-lg text-xs font-bold bg-slate-100 border border-slate-300 text-slate-600">All Coil</button>
            <button onClick={() => setAllSS('H')} className="px-3 py-1 rounded-lg text-xs font-bold bg-violet-100 border border-violet-300 text-violet-700">All α-Helix</button>
            <button onClick={() => setAllSS('E')} className="px-3 py-1 rounded-lg text-xs font-bold bg-amber-100 border border-amber-300 text-amber-700">All β-Sheet</button>
          </div>
          <SequencePaintStrip residues={d.parsedSeq} getLetter={(i) => d.getSSAt(i)} meta={SS_META} onApply={(i) => paintSSAt(i, ssBrush)} focusIdx={focusIdx} />
        </div>
      )}
      {/* nucleic painting */}
      {(d.moleculeType === 'dna' || d.moleculeType === 'rna') && d.parsedSeq.length > 0 && (
        <div>
          <div className="flex flex-wrap gap-2 mb-3 items-center">
            <span className="text-xs font-bold text-slate-500 uppercase mr-1">🖌️ Brush:</span>
            {['A', 'B', 'Z'].map((l) => (
              <button key={l} onClick={() => setFormBrush(l)} className="px-3 py-1 rounded-lg text-xs font-black border" style={{ backgroundColor: formBrush === l ? FORM_META[l].color : 'white', borderColor: FORM_META[l].color, color: formBrush === l ? 'white' : FORM_META[l].color }}>{FORM_META[l].label}</button>
            ))}
            <button onClick={() => setAllForms('A')} className="px-3 py-1 rounded-lg text-xs font-bold bg-sky-100 border border-sky-300 text-sky-700">All A</button>
            <button onClick={() => setAllForms('B')} className="px-3 py-1 rounded-lg text-xs font-bold bg-green-100 border border-green-300 text-green-700">All B</button>
            <button onClick={() => setAllForms('Z')} className="px-3 py-1 rounded-lg text-xs font-bold bg-rose-100 border border-rose-300 text-rose-700">All Z</button>
          </div>
          <SequencePaintStrip residues={d.parsedSeq} getLetter={(i) => d.getFormAt(i)} meta={FORM_META} onApply={(i) => paintFormAt(i, formBrush)} focusIdx={focusIdx} />
        </div>
      )}
      {/* 2D structure */}
      {d.structure && (
        <div>
          <StructureSVGView structure={d.structure}
            minWidth={d.moleculeType === 'protein' && d.parsedSeq.length > 3 ? `${d.parsedSeq.length * 120}px` : '100%'}
            isExpanded={expandedPanel === 'formula'}
            onToggleExpand={() => setExpandedPanel(expandedPanel === 'formula' ? null : 'formula')}
            selectedKeys={selectedKeys}
            onAtomClick={handleAtomClick}
            height={d.moleculeType === 'dna' || d.moleculeType === 'rna' ? `${Math.max(360, d.parsedSeq.length * 250 + 120)}px` : '300px'} />
        </div>
      )}
    </div>
  );
};

/* ================= DATA: assignment table ================= */
export const Data = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useNmrDerived(activeTest);
  const [tableMode, setTableMode] = useState(activeTest.tableMode || 'backbone');
  const [focusIdx, setFocusIdx] = useState('ALL');
  const shifts = d.shifts;
  const selNuc = activeTest.selectedNuclei || ['H', 'N', 'C'];
  const effTableMode = d.moleculeType === 'sugar' || d.moleculeType === 'lipid' ? 'all' : tableMode;
  const nucDefs = d.moleculeType === 'protein' ? { H: ['HN', 'Hα', 'Hβ'], N: ['N'], C: ['Cα', 'Cβ', "C'"] } : (d.moleculeType === 'dna' || d.moleculeType === 'rna') ? { H: ["H1'", "H2'", "H3'"], N: [], C: ["C1'", "C2'", "C3'"] } : { H: [], N: [], C: [] };

  const handleShiftChange = (resIdx, atom, val) => updateActiveTest({ chemicalShifts: { ...shifts, [`${resIdx}-${atom}`]: val } });
  const fillEstimated = () => {
    const ns = { ...shifts };
    d.estSeq.forEach((res, idx) => {
      Object.entries(res.estShifts || {}).forEach(([a, v]) => { ns[`${idx}-${a}`] = String(v); });
      Object.entries(res.estUniqueC || {}).forEach(([cn, v]) => { ns[`${idx}-${cn}`] = String(v); });
      if (res.estN !== null) ns[`${idx}-N`] = String(res.estN);
      if (res.estCP !== null) ns[`${idx}-C'`] = String(res.estCP);
    });
    updateActiveTest({ chemicalShifts: ns });
  };
  const exportCSV = () => {
    const rows = [['Residue', 'Nucleus', 'Atom', 'Manual Shift (ppm)', 'Estimated (ppm)']];
    d.estSeq.forEach((res, idx) => {
      if (selNuc.includes('H')) Object.keys(res.estShifts || {}).forEach((a) => rows.push([res.id, '1H', a, shifts[`${idx}-${a}`] || '', res.estShifts[a]]));
      if (d.moleculeType === 'protein') {
        if (selNuc.includes('N') && res.estN !== null) rows.push([res.id, '15N', 'N', shifts[`${idx}-N`] || '', res.estN]);
        if (selNuc.includes('C')) { Object.keys(res.estUniqueC || {}).forEach((cn) => rows.push([res.id, '13C', cn, shifts[`${idx}-${cn}`] || '', res.estUniqueC[cn]])); if (res.estCP !== null) rows.push([res.id, '13C', "C'", shifts[`${idx}-C'`] || '', res.estCP]); }
      } else if (selNuc.includes('C')) Object.keys(res.estUniqueC || {}).forEach((cn) => rows.push([res.id, '13C', cn, shifts[`${idx}-${cn}`] || '', res.estUniqueC[cn]]));
      if (d.hasPhosphorus && selNuc.includes('P') && res.p31 !== null) rows.push([res.id, '31P', 'P', shifts[`${idx}-P`] || '', res.p31]);
    });
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'nmr_assignment.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        {d.parsedSeq.length > 0 && d.moleculeType !== 'sugar' && d.moleculeType !== 'lipid' && (
          <div className="flex bg-slate-200 p-1 rounded-lg">
            {['backbone', 'all', 'unified'].map((m) => (
              <button key={m} onClick={() => { setTableMode(m); updateActiveTest({ tableMode: m }); }} className={`px-3 py-1 text-xs font-bold rounded-md ${tableMode === m ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{m === 'backbone' ? 'Backbone' : m === 'all' ? 'All Atoms' : 'Unified'}</button>
            ))}
          </div>
        )}
        <button onClick={fillEstimated} className="px-2 py-1 rounded-lg text-xs font-bold bg-blue-50 border border-blue-300 text-blue-700 hover:bg-blue-100">🪄 Fill with estimated</button>
        <button onClick={() => updateActiveTest({ chemicalShifts: {} })} className="px-2 py-1 rounded-lg text-xs font-bold bg-red-50 border border-red-200 text-red-600 hover:bg-red-100">🧹 Clear manual</button>
        <button onClick={exportCSV} className="px-2 py-1 rounded-lg text-xs font-bold bg-emerald-50 border border-emerald-300 text-emerald-700 hover:bg-emerald-100">⬇ Export CSV</button>
      </div>
      {d.parsedSeq.length === 0 ? (
        <div className="text-center py-10 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300">Enter a sequence / select a molecule to generate the table.</div>
      ) : effTableMode === 'unified' ? (
        <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-lg max-h-[560px]">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-100 sticky top-0 z-10 shadow-sm">
              <tr><th className="px-4 py-3 font-black border-b border-slate-200 w-24 text-center">Res</th><th className="px-3 py-2 font-bold border-b border-slate-200">Nucleus</th><th className="px-3 py-2 font-bold border-b border-slate-200">Atom</th><th className="px-3 py-2 font-bold border-b border-slate-200 text-blue-700 bg-blue-50/50">Shift (ppm)</th><th className="px-3 py-2 font-bold border-b border-slate-200">Estimated (ppm)</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {d.estSeq.map((res, idx) => {
                const rows = [];
                if (selNuc.includes('H')) Object.keys(res.estShifts || {}).forEach((a) => rows.push({ nuc: '¹H', atom: a, est: res.estShifts[a].toFixed(2) }));
                if (d.moleculeType === 'protein' && selNuc.includes('N') && res.estN !== null) rows.push({ nuc: '¹⁵N', atom: 'N', est: res.estN.toFixed(2) });
                if (selNuc.includes('C')) { Object.keys(res.estUniqueC || {}).forEach((cn) => rows.push({ nuc: '¹³C', atom: cn, est: res.estUniqueC[cn].toFixed(2) })); if (d.moleculeType === 'protein' && res.estCP !== null) rows.push({ nuc: '¹³C', atom: "C'", est: res.estCP.toFixed(2) }); }
                if (d.hasPhosphorus && selNuc.includes('P') && res.p31 !== null) rows.push({ nuc: '³¹P', atom: 'P', est: res.p31.toFixed(2) });
                if (rows.length === 0) return null;
                return rows.map((row, ri) => {
                  const key = `${idx}-${row.atom}`;
                  const isMan = parseManual(shifts[key]) !== null;
                  return (
                    <tr key={`${idx}-${ri}`} className={`hover:bg-slate-50 ${isMan ? 'bg-green-50' : ''}`}>
                      {ri === 0 && <td rowSpan={rows.length} className="px-4 py-2 font-black text-slate-700 text-center bg-slate-50 border-r border-slate-100 align-top">{res.id}</td>}
                      <td className="px-3 py-1 font-bold text-slate-600 whitespace-nowrap">{row.nuc}</td>
                      <td className={`px-3 py-1 font-medium whitespace-nowrap ${isMan ? 'text-green-700 font-bold' : 'text-slate-700'}`}>{row.atom}</td>
                      <td className="px-3 py-1 text-center">
                        <input type="text" value={shifts[key] || ''} onChange={(e) => handleShiftChange(idx, row.atom, e.target.value)} className={`w-24 text-center border rounded px-2 py-1 outline-none text-xs font-mono ${isMan ? 'border-green-400 bg-green-50 text-green-700 font-bold' : 'border-slate-200 focus:border-blue-500'}`} placeholder="—" />
                      </td>
                      <td className="px-3 py-1 text-center text-[13px] font-bold text-blue-600">≈ {row.est}</td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-col gap-6 max-h-[600px] overflow-y-auto custom-scrollbar pr-2">
          <h4 className="text-md font-bold text-blue-700 border-b-2 border-blue-100 inline-block pr-4 pb-1">¹H Assignment</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {d.estSeq.map((res, resIdx) => (
              <div key={`1h-${resIdx}`} className="border border-slate-200 rounded-lg overflow-hidden shadow-sm h-fit">
                <div className="py-2 text-center font-bold text-sm" style={{ backgroundColor: `${res.color}15`, color: res.color, borderBottom: `1px solid ${res.color}30` }}>{res.name} ({res.id})</div>
                <table className="w-full text-sm text-left bg-white">
                  <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200"><tr><th className="px-3 py-2 font-semibold">Atom</th><th className="px-3 py-2 font-semibold text-center">Shift (ppm)</th></tr></thead>
                  <tbody className="text-slate-700 divide-y divide-slate-100">
                    {res.atoms.map((atom) => {
                      const isMan = parseManual(shifts[`${resIdx}-${atom}`]) !== null;
                      return (
                        <tr key={atom} className={`hover:bg-slate-50 ${isMan ? 'bg-green-50' : ''}`}>
                          <td className={`px-3 py-1 font-medium ${isMan ? 'text-green-700 font-bold' : ''}`}>{atom}</td>
                          <td className="px-3 py-1 text-center border-l border-slate-100 font-mono">
                            <div className="flex items-center justify-center gap-2 flex-wrap">
                              <input type="text" value={shifts[`${resIdx}-${atom}`] || ''} onChange={(e) => handleShiftChange(resIdx, atom, e.target.value)} className={`w-16 text-center border rounded py-0.5 outline-none text-xs ${isMan ? 'border-green-400 bg-green-50 text-green-700 font-bold' : 'border-slate-300 focus:border-blue-500'}`} placeholder="—" />
                              {res.estShifts[atom] !== undefined && <span className="text-[13px] font-bold text-blue-600">≈ {res.estShifts[atom].toFixed(2)}</span>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* ================= FITTING ERRORS / GRAPHICS (NMR has none) ================= */
export const FittingErrors = () => (
  <p className="text-sm text-slate-400 italic">NMR assignment does not use curve fitting / error management in this renderer. Use simulated spectra for visualization.</p>
);
export const FittingGraphics = () => (
  <p className="text-sm text-slate-400 italic">Graphical parameters for NMR spectra are auto-scaled. Use drag-to-zoom on the simulated spectra below.</p>
);

/* ================= SIMULATIONS: simulated spectra ================= */
export const Simulations = ({ ctx }) => {
  const { activeTest } = ctx;
  const d = useNmrDerived(activeTest);
  const [expandedPanel, setExpandedPanel] = useState(null);
  const selNuc = activeTest.selectedNuclei || ['H', 'N', 'C'];
  const peaks = useMemo(() => buildPeaks(d.simSeq, d.moleculeType, d.hasPhosphorus), [d.simSeq, d.moleculeType, d.hasPhosphorus]);
  const TICKS_1H = Array.from({ length: 111 }, (_, i) => parseFloat((i / 10).toFixed(1)));
  const TICKS_13C = Array.from({ length: 281 }, (_, i) => parseFloat((10 + i * 0.5).toFixed(1)));

  if (d.parsedSeq.length === 0) return <p className="text-sm text-slate-400 italic">Enter a sequence to generate simulated spectra.</p>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <OneDSpectrumPlot title="Simulated ¹H 1D Spectrum" data={peaks.data1H} fullDomain={[0, 11]} ticks={TICKS_1H} TickComponent={(p) => <text {...p} />} xLabel="¹H (ppm)" panelId="1D_1H" expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} />
      <OneDSpectrumPlot title="Simulated ¹³C 1D Spectrum" data={peaks.data13C} fullDomain={[0, 190]} ticks={TICKS_13C} TickComponent={(p) => <text {...p} />} xLabel="¹³C (ppm)" panelId="1D_13C" expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} />
      {d.hasPhosphorus && selNuc.includes('P') && peaks.p31Data.length > 0 && (
        <OneDSpectrumPlot title="Simulated ³¹P 1D Spectrum" data={peaks.p31Data} fullDomain={[-5, 5]} ticks={Array.from({ length: 11 }, (_, i) => i - 5)} TickComponent={(p) => <text {...p} />} xLabel="³¹P (ppm)" panelId="1D_31P" expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} />
      )}
      <SpectrumPlot title="Simulated COSY Spectrum" diagonalData={peaks.diagonalData} crossPeakData={peaks.cosyPeaks} expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} panelId="cosy" diagonalColor="#22c55e" />
      <SpectrumPlot title="Simulated NOESY Spectrum" diagonalData={peaks.diagonalData} crossPeakData={peaks.noesyPeaks} expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} panelId="noesy" diagonalColor="#ef4444" />
      <SpectrumPlot title="Simulated TOCSY Spectrum" diagonalData={peaks.diagonalData} crossPeakData={peaks.tocsyPeaks} expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} panelId="tocsy" diagonalColor="#1e3a8a" />
      <HSQCPlot title="Simulated ¹H-¹³C HSQC Spectrum" crossPeakData={peaks.hsqcPeaks} expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} panelId="hsqc" />
    </div>
  );
};

/* ================= NOTEBOOK EXTRA ================= */
export const NotebookExtra = ({ ctx, checkId }) => {
  const { activeTest } = ctx;
  const d = useNmrDerived(activeTest);
  const typeLabel = d.moleculeType === 'protein' ? 'Protein' : d.moleculeType === 'dna' ? 'DNA' : d.moleculeType === 'rna' ? 'RNA' : d.moleculeType === 'sugar' ? 'Sugar' : 'Phospholipid';

  if (checkId === 'cond') {
    return `<p style="font-size: 12px; color: #475569; margin-bottom: 8px;"><b>Solvent:</b> ${activeTest.solvent || 'N/A'} | <b>Temp:</b> ${activeTest.temperature || 'N/A'} | <b>Conc:</b> ${activeTest.concentration || 'N/A'}</p>`;
  }
  if (checkId === 'seq') {
    return `<p style="font-size: 12px; color: #475569; margin-bottom: 12px;"><b>${typeLabel}:</b> <span style="font-family: monospace; background: #e2e8f0; padding: 2px 4px; border-radius: 4px;">${d.isPolymer ? activeTest.proteinSequence || 'N/A' : d.parsedSeq[0]?.name || 'N/A'}</span></p>`;
  }
  if (checkId === 'formula' && d.structure) {
    return `<div style="margin-bottom: 12px;">${elementsToSVG(d.structure, 300)}</div>`;
  }
  if (checkId === 'table' && Object.keys(d.shifts).length > 0) {
    let html = `<table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; text-align: left; background: white;"><tr style="background-color: #f1f5f9;"><th style="padding: 6px; border: 1px solid #cbd5e1;">Residue</th><th style="padding: 6px; border: 1px solid #cbd5e1;">Atom</th><th style="padding: 6px; border: 1px solid #cbd5e1;">Shift (ppm)</th></tr>`;
    Object.keys(d.shifts).forEach((key) => {
      const parts = key.split('-');
      const resIdx = parts[0];
      const atom = parts.slice(1).join('-');
      const res = d.parsedSeq[resIdx];
      if (res && d.shifts[key]) html += `<tr><td style="padding: 6px; border: 1px solid #e2e8f0;"><b>${res.name} (${res.id})</b></td><td style="padding: 6px; border: 1px solid #e2e8f0;">${atom}</td><td style="padding: 6px; border: 1px solid #e2e8f0; font-family: monospace;">${d.shifts[key]}</td></tr>`;
    });
    html += `</table>`;
    return html;
  }
  return '';
};

export default { Setup, Data, FittingErrors, FittingGraphics, Simulations, NotebookExtra };
