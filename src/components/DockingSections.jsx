import React, { useState, useMemo, useRef, useEffect } from 'react';
import {BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell, ScatterChart, Scatter} from 'recharts';
import {ChartControlBar, SharedChartStylePanel} from './SharedAnalysisTools';

import NMRMoleculeViewer from './NMRMoleculeViewer';
import {AMINO_ACID_DB, NUCLEOTIDE_DB, SUGAR_DB, LIPID_DB, SS_META, RESIDUE_COLORS, buildProteinStructure, buildNucleicStructure, buildSugarStructure, buildLipidStructure, elementsToSVG, StructureSVGView, CollapsibleSection, SequencePaintStrip, getSelectedKeys, getManualKeys, DOCKING_PROGRAMS, DOCKING_METRICS, DOCKING_PIPELINE_STAGES, parseDockingValue, getProgramInfo, getScoringFunctions, getSearchAlgorithms, parseDockingFile, getDockingInstances, getDockingActiveInstance, getDockingLayers, getDockingActiveLayerKey, getDockingLayerValues, writeDockingCellValue, generateDockingPoses, generateHADDOCKPoses, DEFAULT_DOCKING_CHART_STYLE, dockChartBoxStyle, DOCK_CHART_MARGIN} from './DockingData';


/* ============================================================================
   DockingSections — Docking page content sections (mirrors MDSections.jsx)
============================================================================ */

// ================= SHARED DERIVED DATA HOOK =================
const useDockingDerived = (activeTest, ctx = {}) => {
  const compName = activeTest.selectedCompounds?.[0] || activeTest.compound;
  const metaSeq = (ctx.compoundMeta && compName && ctx.compoundMeta[compName]?.sequence)
    ? ctx.compoundMeta[compName].sequence : '';
  const metaType = (ctx.compoundMeta && compName && ctx.compoundMeta[compName]?.type)
    ? ctx.compoundMeta[compName].type : null;

  // Receptor molecule (the "main" molecule, like MD)
  const moleculeType = activeTest.moleculeType || metaType || 'protein';
  const rawSeq = (activeTest.proteinSequence || metaSeq || '').toUpperCase();
  const validChars =
    moleculeType === 'protein' ? 'ACDEFGHIKLMNPQRSTVWY'
    : moleculeType === 'dna' ? 'ACGT'
    : moleculeType === 'rna' ? 'ACGU' : '';
  const seq = ['protein', 'dna', 'rna'].includes(moleculeType)
    ? rawSeq.replace(new RegExp(`[^${validChars}]`, 'g'), '') : '';
  const isPolymer = ['protein', 'dna', 'rna'].includes(moleculeType);
  const DB =
    moleculeType === 'protein' ? AMINO_ACID_DB
    : moleculeType === 'dna' ? NUCLEOTIDE_DB.DNA
    : moleculeType === 'rna' ? NUCLEOTIDE_DB.RNA
    : moleculeType === 'sugar' ? SUGAR_DB : LIPID_DB;

  // Docking parameters
  const dockingProgram = activeTest.dockingProgram || 'vina';
  const programInfo = getProgramInfo(dockingProgram);
  const scoringFunction = activeTest.scoringFunction || programInfo.scoringFunctions[0];
  const searchAlgorithm = activeTest.searchAlgorithm || programInfo.searchAlgorithms[0];
  const exhaustiveness = activeTest.exhaustiveness ?? '8';
  const numModes = activeTest.numModes ?? '9';
  const energyRange = activeTest.energyRange ?? '3';
  const boxCenterX = activeTest.boxCenterX ?? '0';
  const boxCenterY = activeTest.boxCenterY ?? '0';
  const boxCenterZ = activeTest.boxCenterZ ?? '0';
  const boxSizeX = activeTest.boxSizeX ?? '20';
  const boxSizeY = activeTest.boxSizeY ?? '20';
  const boxSizeZ = activeTest.boxSizeZ ?? '20';

  // Ligand
  const ligandSmiles = activeTest.ligandSmiles || '';
  const ligandPdbId = activeTest.ligandPdbId || '';

  const typeLabel =
    moleculeType === 'protein' ? 'Protein Receptor'
    : moleculeType === 'dna' ? 'DNA Receptor'
    : moleculeType === 'rna' ? 'RNA Receptor'
    : moleculeType === 'sugar' ? 'Sugar' : 'Phospholipid';

  const ssRaw = activeTest.secondaryStructure || '';
  const getSSAt = (i) => (ssRaw[i] && 'HES'.includes(ssRaw[i]) ? ssRaw[i] : 'C');

  const parsedSeq = useMemo(() => {
    let chars = [];
    if (isPolymer) {
      if (!seq) return [];
      chars = seq.split('');
    } else if (moleculeType === 'sugar') chars = [activeTest.sugarChoice || 'GLC'];
    else if (moleculeType === 'lipid') chars = [activeTest.lipidChoice || 'POPC'];
    return chars.map((char, index) => {
      const entry = DB[char];
      if (!entry) return null;
      return {
        ...entry,
        id: `${entry.code3 || char}${index + 1}`,
        char,
        color: RESIDUE_COLORS[index % RESIDUE_COLORS.length]
      };
    }).filter(Boolean);
  }, [seq, moleculeType, activeTest.sugarChoice, activeTest.lipidChoice, DB, isPolymer]);

  const structure = useMemo(() => {
    if (parsedSeq.length === 0) return null;
    try {
      if (moleculeType === 'protein') return buildProteinStructure(parsedSeq);
      if (moleculeType === 'dna' || moleculeType === 'rna') return buildNucleicStructure(parsedSeq, moleculeType);
      if (moleculeType === 'sugar') return buildSugarStructure(parsedSeq[0], 'chair', 'alpha');
      if (moleculeType === 'lipid') return buildLipidStructure(parsedSeq[0], 'cis');
    } catch (e) {
      console.warn('Docking structure build error:', e);
    }
    return null;
  }, [parsedSeq, moleculeType]);

  // Docking poses / results
  const poses = useMemo(() => {
    if (Array.isArray(activeTest.dockingPoses) && activeTest.dockingPoses.length) {
      return activeTest.dockingPoses;
    }
    return dockingProgram === 'haddock' ? generateHADDOCKPoses(12) : generateDockingPoses(9);
  }, [activeTest.dockingPoses, dockingProgram]);

  // Instances / layers
  const instances = getDockingInstances(activeTest);
  const activeInstance = getDockingActiveInstance(activeTest);
  const layers = getDockingLayers(activeTest);
  const activeLayerKey = getDockingActiveLayerKey(activeTest);
  const activeValues = getDockingLayerValues(activeInstance, activeLayerKey);

  return {
    moleculeType, seq, validChars, isPolymer, DB, typeLabel,
    dockingProgram, programInfo, scoringFunction, searchAlgorithm,
    exhaustiveness, numModes, energyRange,
    boxCenterX, boxCenterY, boxCenterZ, boxSizeX, boxSizeY, boxSizeZ,
    ligandSmiles, ligandPdbId,
    getSSAt, parsedSeq, structure,
    poses, instances, activeInstance, layers, activeLayerKey, activeValues
  };
};

// ================= 1) EXPERIMENT SETUP (Docking) =================
export const DockingExperimentSetupSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useDockingDerived(activeTest, ctx);

  const structureMode = activeTest.structureMode || '2d';
  const [hasOpened3D, setHasOpened3D] = useState(structureMode === '3d');
  const [expandedPanel, setExpandedPanel] = useState(null);
  const [ssBrush, setSSBrush] = useState('H');

  useEffect(() => { if (structureMode === '3d') setHasOpened3D(true); }, [structureMode]);
  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
    return () => clearTimeout(t);
  }, [structureMode, hasOpened3D]);

  // Auto-fill sequence / SMILES from compound metadata when a compound is selected
  const firstSelectedCmp = activeTest.selectedCompounds?.[0];
  useEffect(() => {
    if (!firstSelectedCmp || !ctx.compoundMeta) return;
    const meta = ctx.compoundMeta[firstSelectedCmp];
    if (!meta) return;
    const updates = {};
    let needsUpdate = false;
    if (meta.smiles && meta.smiles !== activeTest.smiles) {
      updates.smiles = meta.smiles;
      updates.moleculeType = 'organic';
      needsUpdate = true;
    }
    if (meta.sequence && meta.sequence !== activeTest.proteinSequence) {
      updates.proteinSequence = meta.sequence;
      updates.moleculeType = meta.type || 'protein';
      needsUpdate = true;
    }
    if (needsUpdate) updateActiveTest(updates);
  }, [firstSelectedCmp, ctx.compoundMeta, activeTest.smiles, activeTest.proteinSequence, updateActiveTest]);

  const selectedKeys = getSelectedKeys(activeTest);
  const manualKeys = useMemo(() => getManualKeys(d.activeValues), [d.activeValues]);

  const handleAtomClick = (ri, keys) => {
    if (ri === null || !keys) return;
    const cur = getSelectedKeys(activeTest);
    if (cur && cur.join('|') === keys.join('|')) updateActiveTest({ selectedAtomKeys: [] });
    else updateActiveTest({ selectedAtomKeys: keys });
  };

  const paintSSAt = (i, letter) => {
    const arr = d.seq.split('').map((_, j) => d.getSSAt(j));
    arr[i] = letter;
    updateActiveTest({ secondaryStructure: arr.join('') });
  };

  const structureSrc = useMemo(() => {
    const raw = (activeTest.structureSrc || '').trim();
    if (!raw) {
      if (d.moleculeType === 'protein') return 'https://models.rcsb.org/1UBQ.mmtf';
      if (d.moleculeType === 'dna') return 'https://models.rcsb.org/1BNA.mmtf';
      if (d.moleculeType === 'rna') return 'https://models.rcsb.org/1EHZ.mmtf';
      return '';
    }
    if (/^(https?:|blob:|data:)/i.test(raw) || raw.startsWith('/')) return raw;
    if (/^[0-9][A-Za-z0-9]{3}$/.test(raw)) return `https://models.rcsb.org/${raw.toUpperCase()}.mmtf`;
    return raw;
  }, [activeTest.structureSrc, d.moleculeType]);

  return (
    <div className="flex flex-col gap-6">
      {/* Molecule type selector */}
      <div className="flex flex-wrap gap-2 mb-2">
        {[['protein', '🧬 Protein'], ['dna', '🧬 DNA'], ['rna', '🧬 RNA'], ['sugar', '🍬 Sugar'], ['lipid', '🫧 Lipid']].map(([val, lab]) => (
          <button
            key={val}
            onClick={() => updateActiveTest({ moleculeType: val })}
            className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors ${
              d.moleculeType === val ? 'bg-blue-600 border-blue-700 text-white shadow' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {lab}
          </button>
        ))}
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Receptor definition */}
        <div className="flex-1 w-full">
          {d.isPolymer ? (
            <>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                {d.typeLabel} Sequence (1-letter code)
              </label>
              <textarea
                value={activeTest.proteinSequence || ''}
                onChange={(e) => updateActiveTest({ proteinSequence: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-3 font-mono text-sm tracking-widest outline-none focus:border-blue-500 uppercase h-24 shadow-inner"
                placeholder={d.moleculeType === 'protein' ? 'e.g. MKWVTFISLL...' : 'e.g. ATGCGTAC...'}
              />
              <p className="text-[10px] text-slate-400 mt-1 font-bold">
                Length: {d.seq.length} {d.moleculeType === 'protein' ? 'residues' : 'nucleotides'}
              </p>
            </>
          ) : (
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Select Receptor Molecule</label>
              <select
                value={d.moleculeType === 'sugar' ? activeTest.sugarChoice || 'GLC' : activeTest.lipidChoice || 'POPC'}
                onChange={(e) => updateActiveTest(d.moleculeType === 'sugar' ? { sugarChoice: e.target.value } : { lipidChoice: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white outline-none focus:border-blue-500 font-semibold"
              >
                {Object.entries(d.DB).map(([k, v]) => (
                  <option key={k} value={k}>{v.name} ({k})</option>
                ))}
              </select>
            </div>
          )}

          {/* Ligand panel */}
          <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4">
            <label className="block text-xs font-bold text-amber-700 uppercase mb-3">⬡ Ligand</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Ligand SMILES</label>
                <input
                  type="text"
                  value={d.ligandSmiles}
                  onChange={(e) => updateActiveTest({ ligandSmiles: e.target.value })}
                  placeholder="e.g. CC(=O)Oc1ccccc1C(=O)O"
                  className="border border-slate-300 rounded-lg px-3 py-2 font-mono text-sm bg-white outline-none focus:border-amber-500"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Ligand PDB / 3-letter ID</label>
                <input
                  type="text"
                  value={d.ligandPdbId}
                  onChange={(e) => updateActiveTest({ ligandPdbId: e.target.value })}
                  placeholder="e.g. ASN, IBU, STI"
                  className="border border-slate-300 rounded-lg px-3 py-2 font-mono text-sm bg-white outline-none focus:border-amber-500 uppercase"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Docking program + box */}
        <div className="w-full lg:w-80 flex flex-col gap-4">
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">🎯 Docking Program</label>
            <select
              value={d.dockingProgram}
              onChange={(e) => {
                const pk = e.target.value;
                const info = getProgramInfo(pk);
                updateActiveTest({
                  dockingProgram: pk,
                  scoringFunction: info.scoringFunctions[0] || '',
                  searchAlgorithm: info.searchAlgorithms[0] || ''
                });
              }}
              className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white outline-none focus:border-blue-500 font-semibold mb-2"
            >
              {Object.entries(DOCKING_PROGRAMS).map(([k, v]) => (
                <option key={k} value={k}>{v.name}</option>
              ))}
            </select>
            <p className="text-[10px] text-slate-400 mb-2">{d.programInfo.description}</p>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Scoring Function</label>
            <select
              value={d.scoringFunction}
              onChange={(e) => updateActiveTest({ scoringFunction: e.target.value })}
              className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white outline-none focus:border-blue-500 mb-2"
            >
              {getScoringFunctions(d.dockingProgram).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Search Algorithm</label>
            <select
              value={d.searchAlgorithm}
              onChange={(e) => updateActiveTest({ searchAlgorithm: e.target.value })}
              className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white outline-none focus:border-blue-500"
            >
              {getSearchAlgorithms(d.dockingProgram).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="bg-sky-50 p-4 rounded-lg border border-sky-200">
            <label className="block text-xs font-bold text-sky-700 uppercase mb-3">📦 Docking Box / Grid</label>
            <div className="grid grid-cols-3 gap-2">
              {[['Center X', 'boxCenterX', d.boxCenterX], ['Center Y', 'boxCenterY', d.boxCenterY], ['Center Z', 'boxCenterZ', d.boxCenterZ],
                ['Size X (Å)', 'boxSizeX', d.boxSizeX], ['Size Y (Å)', 'boxSizeY', d.boxSizeY], ['Size Z (Å)', 'boxSizeZ', d.boxSizeZ]].map(([lab, key, val]) => (
                <div key={key} className="flex flex-col gap-0.5">
                  <label className="text-[9px] font-bold text-slate-500">{lab}</label>
                  <input
                    type="text"
                    value={val}
                    onChange={(e) => updateActiveTest({ [key]: e.target.value })}
                    className="border border-slate-300 rounded px-2 py-1 text-xs bg-white outline-none focus:border-sky-500"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Secondary structure paint (protein only) */}
      {d.moleculeType === 'protein' && d.parsedSeq.length > 0 && (
        <div>
          <div className="flex flex-wrap gap-2 mb-3 items-center">
            <span className="text-xs font-bold text-slate-500 uppercase mr-1">🖌️ Brush:</span>
            {['C', 'H', 'E'].map((l) => (
              <button
                key={l}
                onClick={() => setSSBrush(l)}
                className="px-3 py-1 rounded-lg text-xs font-black border transition-all"
                style={{
                  backgroundColor: ssBrush === l ? SS_META[l].color : 'white',
                  borderColor: SS_META[l].color,
                  color: ssBrush === l ? 'white' : SS_META[l].color
                }}
              >
                {SS_META[l].label}
              </button>
            ))}
          </div>
          <SequencePaintStrip
            residues={d.parsedSeq}
            getLetter={(i) => d.getSSAt(i)}
            meta={SS_META}
            onApply={(i) => paintSSAt(i, ssBrush)}
            focusIdx="ALL"
          />
        </div>
      )}

      {/* 2D / 3D structure view */}
      <div>
        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
            <div className="flex bg-slate-200 p-1 rounded-lg">
              <button
                onClick={() => updateActiveTest({ structureMode: '2d' })}
                className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                  structureMode === '2d' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'
                }`}
              >
                2D Formula
              </button>
              <button
                onClick={() => updateActiveTest({ structureMode: '3d' })}
                className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                  structureMode === '3d' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'
                }`}
              >
                3D Viewer
              </button>
            </div>
          </div>

          {structureMode === '3d' && (
            <div className="mb-3 grid grid-cols-1 md:grid-cols-2 gap-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Receptor topology (PDB ID / URL)</label>
                <input
                  type="text"
                  value={activeTest.structureSrc || ''}
                  onChange={(e) => updateActiveTest({ structureSrc: e.target.value })}
                  placeholder="e.g. 1UBQ"
                  className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500"
                />
              </div>
            </div>
          )}

          <div style={{ display: structureMode === '3d' ? 'block' : 'none' }}>
            {hasOpened3D && (
              <NMRMoleculeViewer
                key={structureSrc}
                src={structureSrc}
                moleculeType={d.moleculeType}
                parsedSeq={d.parsedSeq}
                selectedKeys={selectedKeys}
                manualKeys={manualKeys}
                onAtomClick={handleAtomClick}
                atomRenames={activeTest.atomRenames || {}}
                onAtomRenames={(map) => updateActiveTest({ atomRenames: map })}
                resRenumber={activeTest.resRenumber || {}}
                onResRenumber={(map) => updateActiveTest({ resRenumber: map })}
                onStructureSequence={(seq) => {
                  if (seq && !activeTest.proteinSequence && ['protein', 'dna', 'rna'].includes(d.moleculeType)) {
                    updateActiveTest({ proteinSequence: seq });
                  }
                }}
                height="480px"
              />
            )}
          </div>

          <div style={{ display: structureMode === '2d' ? 'block' : 'none' }}>
            {d.structure ? (
              <StructureSVGView
                structure={d.structure}
                minWidth={d.moleculeType === 'protein' && d.parsedSeq.length > 3 ? `${d.parsedSeq.length * 120}px` : '100%'}
                isExpanded={expandedPanel === 'formula'}
                onToggleExpand={() => setExpandedPanel(expandedPanel === 'formula' ? null : 'formula')}
                selectedKeys={selectedKeys}
                manualKeys={manualKeys}
                onAtomClick={handleAtomClick}
                height={d.moleculeType === 'dna' || d.moleculeType === 'rna' ? `${Math.max(360, d.parsedSeq.length * 250 + 120)}px` : '300px'}
              />
            ) : (
              <div className="flex items-center justify-center bg-slate-50 border border-dashed border-slate-300 rounded-xl p-6 text-center w-full">
                <div>
                  <div className="text-2xl mb-1">🧬</div>
                  <p className="text-xs font-bold text-slate-500">No structure to display yet</p>
                  <p className="text-[11px] text-slate-400 mt-1 max-w-md">
                    Enter a receptor sequence below (or select a compound that has sequence / SMILES metadata)
                    to generate the 2D formula.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
    </div>
  );
};

// ================= 2) DATA (Docking results table + import) =================
const DockingImportPanel = ({ ctx, onPoses }) => {
  const { updateActiveTest } = ctx;
  const [pasteText, setPasteText] = useState('');
  const [report, setReport] = useState(null);

  const handleText = (text, filename) => {
    const parsed = parseDockingFile(text, filename || 'pasted.txt');
    if (parsed.poses.length) {
      onPoses(parsed.poses, parsed.program);
      setReport({ ok: parsed.poses.length, type: parsed.type });
    } else if (Object.keys(parsed.updates || {}).length) {
      updateActiveTest(parsed.updates);
      setReport({ ok: Object.keys(parsed.updates).length, type: parsed.type, params: true });
    } else {
      setReport({ ok: 0, type: 'unknown' });
    }
  };

  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => handleText(ev.target.result, file.name);
    reader.readAsText(file);
  };

  return (
    <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 flex flex-col gap-3">
      <p className="text-xs font-bold text-sky-800">
        📥 Import docking results — AutoDock Vina (log/table), AutoDock 4 (.dlg), HADDOCK (.csv),
        or parameter files (.dpf / .gpf / config.txt / .param). Format is auto-detected.
      </p>
      <div className="flex flex-wrap gap-3 items-center">
        <label className="bg-sky-600 hover:bg-sky-700 text-white font-bold px-4 py-2 rounded-lg text-xs cursor-pointer shadow-sm transition-colors inline-flex items-center gap-2">
          📂 Choose file…
          <input
            type="file"
            accept=".dlg,.dpf,.gpf,.csv,.txt,.param,.log,.cfg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files && e.target.files[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
        </label>
        <span className="text-[10px] text-slate-500">…or paste output text below:</span>
      </div>
      <textarea
        value={pasteText}
        onChange={(e) => setPasteText(e.target.value)}
        placeholder={'Paste a Vina table, a HADDOCK CSV, or a .dlg energy block…'}
        className="w-full h-24 border border-sky-300 rounded-lg p-2 text-xs font-mono bg-white outline-none focus:border-sky-500"
      />
      <button
        onClick={() => handleText(pasteText, 'pasted.txt')}
        disabled={!pasteText.trim()}
        className="bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-bold px-4 py-1.5 rounded-lg text-xs w-fit"
      >
        Import pasted data
      </button>
      {report && (
        <div className={`text-xs font-bold ${report.ok > 0 ? 'text-green-600' : 'text-red-500'}`}>
          {report.ok > 0
            ? report.params
              ? `✅ Imported ${report.ok} parameters (${report.type})`
              : `✅ Imported ${report.ok} poses (${report.type})`
            : '⚠️ No recognized data in this input.'}
        </div>
      )}
    </div>
  );
};

export const DockingDataSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useDockingDerived(activeTest, ctx);
  const [showImport, setShowImport] = useState(false);

  const handlePoses = (poses, program) => {
    updateActiveTest({
      dockingPoses: poses,
      dockingProgram: program || d.dockingProgram
    });
  };

  const bestPose = d.poses.length ? d.poses.reduce((a, b) => (a.affinity < b.affinity ? a : b)) : null;

  const metricCols = DOCKING_METRICS.filter((m) =>
    d.poses.some((p) => p[m.key] !== undefined && p[m.key] !== null)
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-indigo-800 uppercase">Program:</span>
        <span className="text-sm font-black text-indigo-900">{d.programInfo.name}</span>
        <span className="text-[10px] font-bold bg-white border border-indigo-200 text-indigo-700 px-2 py-0.5 rounded-full">
          Scoring: {d.scoringFunction}
        </span>
        <span className="text-[10px] font-bold bg-white border border-indigo-200 text-indigo-700 px-2 py-0.5 rounded-full">
          {d.poses.length} poses
        </span>
        {bestPose && (
          <span className="text-[10px] font-bold bg-green-100 border border-green-300 text-green-800 px-2 py-0.5 rounded-full">
            Best: {bestPose.affinity} {d.programInfo.energyUnit}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowImport(!showImport)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${
              showImport ? 'bg-sky-100 border-sky-400 text-sky-800' : 'bg-sky-50 border-sky-200 text-sky-700 hover:bg-sky-100'
            }`}
          >
            📥 Import AutoDock / HADDOCK…
          </button>
        </div>
      </div>

      {showImport && <DockingImportPanel ctx={ctx} d={d} onPoses={handlePoses} />}

      <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[520px]">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-slate-500 uppercase bg-slate-100 sticky top-0 z-10">
            <tr>
              <th className="px-4 py-3 font-black border-b w-16 text-center">Mode</th>
              <th className="px-3 py-3 font-bold border-b">Label</th>
              {metricCols.map((m) => (
                <th key={m.key} className="px-3 py-3 font-bold text-blue-700 border-b bg-blue-50/50">
                  {m.label}{m.unit ? ` (${m.unit})` : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {d.poses.map((pose, idx) => (
              <tr key={idx} className={`hover:bg-slate-50 ${idx === 0 ? 'bg-green-50/40' : ''}`}>
                <td className="px-4 py-2 font-black text-slate-700 text-center bg-slate-50 border-r">
                  {pose.mode ?? idx + 1}
                </td>
                <td className="px-3 py-2 text-xs font-mono text-slate-600 max-w-[180px] truncate">
                  {pose.label || `Pose ${idx + 1}`}
                </td>
                {metricCols.map((m) => {
                  const cellKey = `${idx}-${m.key}`;
                  const raw = d.activeValues[cellKey];
                  const val = raw !== undefined ? raw : pose[m.key];
                  const isAffinity = m.key === 'affinity';
                  return (
                    <td key={m.key} className="px-3 py-1">
                      <input
                        type="text"
                        value={val !== undefined && val !== null ? val : ''}
                        onChange={(e) => writeDockingCellValue(activeTest, updateActiveTest, d.activeLayerKey, cellKey, e.target.value)}
                        className={`w-full border rounded px-2 py-1 text-center text-xs font-mono outline-none focus:border-blue-500 ${
                          isAffinity ? 'border-indigo-300 bg-indigo-50 text-indigo-800 font-bold' : 'border-slate-200'
                        }`}
                        placeholder="—"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-slate-400">
        💡 Values are editable and stored per-layer (like the MD atom table). The green row is the top-ranked pose.
      </p>
    </div>
  );
};

// ================= 3) ANALYSIS (Docking charts) =================
export const DockingAnalysisSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useDockingDerived(activeTest, ctx);
  const cfg = { ...DEFAULT_DOCKING_CHART_STYLE, ...(activeTest.dockingAnalysisCfg || {}) };
  const setCfg = (patch) => updateActiveTest({ dockingAnalysisCfg: { ...cfg, ...patch } });
  const [showCfg, setShowCfg] = useState(false);
  const scatterRef = useRef(null);

  const isHADDOCK = d.dockingProgram === 'haddock';
  const unit = d.programInfo.energyUnit;

  const affinityData = d.poses.map((p, i) => ({
    mode: p.mode ?? i + 1,
    affinity: parseDockingValue(p.affinity) ?? 0
  }));

  const rmsdData = d.poses
    .filter((p) => p.rmsd_lb !== undefined || p.rmsd !== undefined)
    .map((p, i) => ({
      mode: p.mode ?? i + 1,
      affinity: parseDockingValue(p.affinity) ?? 0,
      rmsd: parseDockingValue(p.rmsd_lb ?? p.rmsd) ?? 0
    }));

  const energyBreakdownData = d.poses.slice(0, 10).map((p, i) => ({
    mode: p.mode ?? i + 1,
    vdW: parseDockingValue(p.energy_vdw) ?? 0,
    elec: parseDockingValue(p.energy_elec) ?? 0,
    torsional: parseDockingValue(p.energy_torsional) ?? 0,
    desolv: parseDockingValue(p.energy_desolv) ?? 0
  }));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <ChartControlBar showCfg={showCfg} onToggleCfg={() => setShowCfg(!showCfg)} className="flex gap-2" />
        <span className="text-xs text-slate-500 font-bold">
          {isHADDOCK ? 'HADDOCK scoring terms' : 'Binding energy / RMSD'} · {d.poses.length} poses
        </span>
      </div>

      {showCfg && <SharedChartStylePanel cfg={cfg} setCfg={setCfg} series={[]} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Affinity bar chart */}
        <CollapsibleSection title={`Binding Affinity per Pose (${unit})`} icon="📊" defaultOpen={false}>
          <div style={dockChartBoxStyle(cfg)}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={affinityData} margin={DOCK_CHART_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="mode" tick={{ fontSize: cfg.fontSize }} label={{ value: 'Mode / Pose', position: 'insideBottom', offset: -10, fontSize: cfg.fontSize }} />
                <YAxis tick={{ fontSize: cfg.fontSize }} label={{ value: unit, angle: -90, position: 'insideLeft', fontSize: cfg.fontSize }} />
                <Tooltip />
                <Bar dataKey="affinity" name={`Affinity (${unit})`} radius={[3, 3, 0, 0]}>
                  {affinityData.map((entry, i) => (
                    <Cell key={i} fill={i === 0 ? '#16a34a' : '#3b82f6'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CollapsibleSection>

        {/* Affinity vs RMSD scatter */}
        <CollapsibleSection title="Affinity vs. RMSD" icon="🎯" defaultOpen={false}>
          <div ref={scatterRef} style={dockChartBoxStyle(cfg)} className="select-none relative">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={DOCK_CHART_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" dataKey="rmsd" name="RMSD" tick={{ fontSize: cfg.fontSize }} label={{ value: 'RMSD from best (Å)', position: 'insideBottom', offset: -10, fontSize: cfg.fontSize }} />
                <YAxis type="number" dataKey="affinity" name="Affinity" tick={{ fontSize: cfg.fontSize }} label={{ value: unit, angle: -90, position: 'insideLeft', fontSize: cfg.fontSize }} />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                <Scatter data={rmsdData} fill="#8b5cf6" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          {rmsdData.length === 0 && (
            <p className="text-xs text-slate-400 italic text-center mt-2">No RMSD data available for these poses.</p>
          )}
        </CollapsibleSection>

        {/* Energy breakdown stacked bar */}
        <CollapsibleSection title="Energy Component Breakdown" icon="🔋" defaultOpen={false}>
          <div style={dockChartBoxStyle(cfg)}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={energyBreakdownData} margin={DOCK_CHART_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="mode" tick={{ fontSize: cfg.fontSize }} label={{ value: 'Mode / Pose', position: 'insideBottom', offset: -10, fontSize: cfg.fontSize }} />
                <YAxis tick={{ fontSize: cfg.fontSize }} label={{ value: unit, angle: -90, position: 'insideLeft', fontSize: cfg.fontSize }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="vdW" stackId="e" fill="#3b82f6" name="vdW / Hbond / desolv" />
                <Bar dataKey="elec" stackId="e" fill="#ef4444" name="Electrostatic" />
                <Bar dataKey="torsional" stackId="e" fill="#f59e0b" name="Torsional" />
                <Bar dataKey="desolv" stackId="e" fill="#14b8a6" name="Desolvation" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CollapsibleSection>

        {/* HADDOCK-specific score terms */}
        {isHADDOCK && (
          <CollapsibleSection title="HADDOCK Score Terms" icon="🧮" defaultOpen={false}>
            <div style={dockChartBoxStyle(cfg)}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.poses.slice(0, 15).map((p, i) => ({
                  mode: p.mode ?? i + 1,
                  AIR: parseDockingValue(p.energy_air) ?? 0,
                  BSA: (parseDockingValue(p.bsa) ?? 0) / 100,
                  vdW: parseDockingValue(p.energy_vdw) ?? 0,
                  Elec: parseDockingValue(p.energy_elec) ?? 0
                }))} margin={DOCK_CHART_MARGIN}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="mode" tick={{ fontSize: cfg.fontSize }} />
                  <YAxis tick={{ fontSize: cfg.fontSize }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="AIR" fill="#8b5cf6" />
                  <Bar dataKey="vdW" fill="#3b82f6" />
                  <Bar dataKey="Elec" fill="#ef4444" />
                  <Bar dataKey="BSA" fill="#22c55e" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CollapsibleSection>
        )}
      </div>
    </div>
  );
};

// ================= 4) DOCKING PARAMETERS =================
export const DockingParametersSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useDockingDerived(activeTest, ctx);
  const isVina = d.dockingProgram === 'vina';
  const isAD4 = ['autodock4', 'autodock_gpu'].includes(d.dockingProgram);
  const isHADDOCK = d.dockingProgram === 'haddock';

  const Num = ({ label, value, onChange, unit }) => (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-bold text-slate-500 uppercase">
        {label}{unit ? ` (${unit})` : ''}
      </label>
      <input
        type="text"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500"
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {DOCKING_PIPELINE_STAGES.map((s) => (
          <button
            key={s.key}
            onClick={() => updateActiveTest({ dockingStage: s.key })}
            className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors ${
              (activeTest.dockingStage || 'docking') === s.key
                ? 'bg-blue-600 border-blue-700 text-white'
                : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-white border border-slate-200 rounded-xl p-4">
        {isVina && (
          <>
            <Num label="Exhaustiveness" value={d.exhaustiveness} onChange={(v) => updateActiveTest({ exhaustiveness: v })} />
            <Num label="Num modes" value={d.numModes} onChange={(v) => updateActiveTest({ numModes: v })} />
            <Num label="Energy range" value={d.energyRange} onChange={(v) => updateActiveTest({ energyRange: v })} unit="kcal/mol" />
            <Num label="Seed" value={activeTest.seed ?? ''} onChange={(v) => updateActiveTest({ seed: v })} />
          </>
        )}
        {isAD4 && (
          <>
            <Num label="GA runs" value={activeTest.numRuns ?? '50'} onChange={(v) => updateActiveTest({ numRuns: v })} />
            <Num label="Population size" value={activeTest.populationSize ?? '150'} onChange={(v) => updateActiveTest({ populationSize: v })} />
            <Num label="Max evaluations" value={activeTest.numEvaluations ?? '2500000'} onChange={(v) => updateActiveTest({ numEvaluations: v })} />
            <Num label="Grid spacing" value={activeTest.gridSpacing ?? '0.375'} onChange={(v) => updateActiveTest({ gridSpacing: v })} unit="Å" />
          </>
        )}
        {isHADDOCK && (
          <>
            <Num label="Sampling (it0)" value={activeTest.sampling ?? '1000'} onChange={(v) => updateActiveTest({ sampling: v })} />
            <Num label="Structures it1" value={activeTest.structuresIt1 ?? '200'} onChange={(v) => updateActiveTest({ structuresIt1: v })} />
            <Num label="Water refinement" value={activeTest.waterRefine ?? '200'} onChange={(v) => updateActiveTest({ waterRefine: v })} />
            <Num label="Random orientation" value={activeTest.randomOrientation ?? 'true'} onChange={(v) => updateActiveTest({ randomOrientation: v })} />
          </>
        )}
      </div>
    </div>
  );
};

// ================= NOTEBOOK EXTRA =================
export const NotebookExtra = ({ ctx, checkId }) => {
  const { activeTest } = ctx;
  const d = useDockingDerived(activeTest, ctx);

  if (checkId === 'cond') {
    return `
      <p style="font-size:12px;color:#475569;margin-bottom:8px;"><b>Docking Setup:</b> Program ${d.programInfo.name} | Scoring ${d.scoringFunction} | Search ${d.searchAlgorithm} | Exhaustiveness ${d.exhaustiveness} | Modes ${d.numModes} | Box (${d.boxSizeX}×${d.boxSizeY}×${d.boxSizeZ} Å) at (${d.boxCenterX}, ${d.boxCenterY}, ${d.boxCenterZ})</p>
    `;
  }
  if (checkId === 'seq') {
    return `
      <p style="font-size:12px;color:#475569;margin-bottom:8px;"><b>Receptor / Ligand:</b> <span style="font-family:monospace;background:#e2e8f0;padding:2px 4px;border-radius:4px;">${d.isPolymer ? (activeTest.proteinSequence || 'N/A') : (d.parsedSeq[0]?.name || 'N/A')}</span> · Ligand: <span style="font-family:monospace;background:#fef3c7;padding:2px 4px;border-radius:4px;">${d.ligandSmiles || d.ligandPdbId || 'N/A'}</span></p>
    `;
  }
  if (checkId === 'formula' && d.structure) {
    return `${elementsToSVG(d.structure, 300)}`;
  }
  if (checkId === 'table' && d.poses.length) {
    let html = `<table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:11px;text-align:left;background:white;">
      <tr style="background-color:#f1f5f9;"><th style="padding:6px;border:1px solid #cbd5e1;">Mode</th><th style="padding:6px;border:1px solid #cbd5e1;">Affinity</th><th style="padding:6px;border:1px solid #cbd5e1;">RMSD l.b.</th></tr>`;
    d.poses.forEach((p) => {
      html += `<tr>
        <td style="padding:6px;border:1px solid #e2e8f0;"><b>${p.mode}</b></td>
        <td style="padding:6px;border:1px solid #e2e8f0;">${p.affinity ?? ''}</td>
        <td style="padding:6px;border:1px solid #e2e8f0;">${p.rmsd_lb ?? ''}</td>
      </tr>`;
    });
    html += '</table>';
    return html;
  }
  return '';
};

// ================= NOTEBOOK HTML BUILDER =================
export const buildNotebookHtml = (ctx, checked) => {
  let html = '';
  ['cond', 'seq', 'formula', 'table'].forEach((id) => {
    if (checked && checked[id]) {
      html += NotebookExtra({ ctx, checkId: id });
    }
  });
  return html;
};

// ================= ALL (section aliases) =================
export const Setup = DockingExperimentSetupSection;
export const Data = DockingDataSection;
export const Analysis = DockingAnalysisSection;
export const Parameters = DockingParametersSection;
