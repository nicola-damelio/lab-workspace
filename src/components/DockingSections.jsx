import React, { useState, useMemo, useRef, useEffect } from 'react';
import {BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell, ScatterChart, Scatter} from 'recharts';
import {ChartControlBar, SharedChartStylePanel, ChartInspector, brokenAxisProps, cfgAxisLabel, cfgChartMargin, cfgTickFormatter, cfgLogScale} from './SharedAnalysisTools';
import { Icon } from './Icons';
import { DriveUploadButton } from './DriveUpload';
import { suggestDriveFileName } from '../utils/driveNaming';
import { getDriveToken, uploadLocalFile } from '../utils/driveUpload';
import { storeJson, loadJson } from '../utils/pdbStore';
import { archiveRestoreJson, placeRestorePointer, restoreJsonFor, restoreStems, takePendingRestorePointer } from '../utils/driveRestore';
import { useDriveAutoRestore } from './useDriveAutoRestore';
import { gunzipSync } from 'fflate';
// One character size per element + the font family of the shared figure style
// (the axis numbers keep riding on cfg.fontSize, see utils/chartStyle.js).
import { tickTextProps, legendTextStyle, seriesColorFor } from '../utils/chartStyle';

/* ── RESTAURATION AUTOMATIQUE DES STRUCTURES DOCKING DEPUIS LE DRIVE ────────
   (mécanisme général : src/utils/driveRestore.js + useDriveAutoRestore.js)
   Les textes PDB d'un docking (structures 8_seletopclusts et molécules
   raw_input.toml) ne peuvent PAS vivre dans le document du dataset : ils sont
   rangés dans la base du navigateur (`pdbStore` → IndexedDB, sinon
   localStorage), qui est LOCALE. Le Drive est donc la copie de RÉFÉRENCE :
   l'import d'un répertoire de calcul y dépose un JSON gzip (structures +
   molécules) et le test n'en garde qu'un pointeur minuscule (`dockingDrive`),
   qui voyage avec le dataset — donc d'un poste à l'autre. Sur un poste vierge,
   la restauration retrouve le fichier par son NOM
   (`<instance>_docking_restore.json.gz`) et le remet dans la base du
   navigateur : le viewer 3D et « Molecules to be docked » fonctionnent. */
const DOCKING_RESTORE_KIND = 'docking';
const dockingDriveCtx = (test = {}, instance = '') => ({
  project: (test.projectNames || [])[0] || '',
  test: test.name || '',
  scientist: test.operator || '',
  section: 'Data',
  subsection: 'pdb files',
  instance: instance || test.instanceName || ''
});

/** Archive la copie de référence des structures / molécules d'un docking et
 *  rend son pointeur, ou null quand le Drive n'est pas joignable — un import ne
 *  doit JAMAIS échouer pour cette raison. */
const archiveDockingData = async ({
  test, instance, structures = [], molecules = [], source = {}
}) => (
  archiveRestoreJson({
    kind: DOCKING_RESTORE_KIND,
    suffix: DOCKING_RESTORE_KIND,
    stem: instance,
    data: {
      structures: Array.isArray(structures) ? structures : [],
      molecules: Array.isArray(molecules) ? molecules : [],
      instanceName: instance || '',
      source
    },
    ctx: dockingDriveCtx(test, instance)
  })
);

import NMRMoleculeViewer from './NMRMoleculeViewer';
import {AMINO_ACID_DB, NUCLEOTIDE_DB, SUGAR_DB, LIPID_DB, SS_META, RESIDUE_COLORS, buildProteinStructure, buildNucleicStructure, buildSugarStructure, buildLipidStructure, elementsToSVG, StructureSVGView, CollapsibleSection, SequencePaintStrip, getSelectedKeys, getManualKeys, DOCKING_METRICS, DOCKING_PIPELINE_STAGES, parseDockingValue, getProgramInfo, parseDockingFile, parseCapriTsv, posesFromCapri, parseTomlSimple, extractDockedMolecules, getDockingInstances, getDockingActiveInstance, getDockingLayers, getDockingActiveLayerKey, getDockingLayerValues, writeDockingCellValue, generateDockingPoses, generateHADDOCKPoses, DEFAULT_DOCKING_CHART_STYLE, dockChartBoxStyle, dockDom, DOCK_CHART_MARGIN, dockingMetricOf, poseMetricValue, capriColumnMetricKey, chartEnergyMetricKey, poseChartValue, poseDeviation, poseRawColumnValue, deviationColumnOf, energyColumnOf, plotSourceOptions, plotSourceLabel, plotSourceValue, PLOT_SOURCE_PREFIX, PLOT_SOURCE_ALL, DEVIATION_PLOT_KEYS, dockingMetricLabel, HADDOCK_SCORE_TERM_KEYS, haddockScoreTerms} from './DockingData';


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

// ================= SHARED: raw_input.toml BLOCK =================
// The "Calculation input (raw_input.toml)" block — Drive link + expandable
// parameters. Rendered ONCE, in the Instrumental Setup section (canonical).
const RawInputTomlBlock = ({ activeTest }) => {
  const [showRawInput, setShowRawInput] = useState(false);
  if (!activeTest || !activeTest.dockingRawInput) return null;
  const ri = activeTest.dockingRawInput;
  return (
    <div className="bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-black text-slate-600 uppercase">Calculation input</span>
        {ri.driveUrl ? (
          <a href={ri.driveUrl} target="_blank" rel="noreferrer"
            className="text-xs font-bold text-sky-700 hover:underline bg-sky-50 border border-sky-200 rounded-lg px-2.5 py-1">
            📄 {ri.fileName || 'raw_input.toml'} · open on Drive ↗
          </a>
        ) : (
          <span className="text-xs font-bold text-slate-500">📄 {ri.fileName || 'raw_input.toml'} (read locally)</span>
        )}
        <button type="button" onClick={() => setShowRawInput(!showRawInput)}
          className="text-[10px] font-bold text-slate-500 hover:text-slate-800 underline">{showRawInput ? 'hide parameters' : 'show parameters'}</button>
      </div>
      {showRawInput && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 bg-white border border-slate-200 rounded-lg p-3">
          {(ri.top || []).map((p) => (
            <div key={p.key} className="flex justify-between gap-2 text-[11px]">
              <span className="font-bold text-slate-500">{p.key}</span>
              <span className="font-mono text-slate-700 text-right">{p.value}</span>
            </div>
          ))}
          {(ri.sections || []).map((sec) => (
            <div key={sec.name} className="col-span-1 md:col-span-2 border-t border-slate-100 pt-1.5">
              <span className="text-[10px] font-black text-indigo-600 uppercase">[{sec.name}]</span>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-0.5 mt-0.5">
                {sec.pairs.map((p) => (
                  <div key={p.key} className="flex justify-between gap-2 text-[11px]">
                    <span className="font-bold text-slate-500">{p.key}</span>
                    <span className="font-mono text-slate-700 text-right">{p.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ================= INSTRUMENTAL SETUP (Docking) =================
// Wired in via DockingTestRenderer's `custom.InstrumentalSetup`, so the raw
// calculation input (raw_input.toml) appears inside TestShellRenderer's own
// "Instrumental Setup" collapsible section.
export const DockingInstrumentalSetup = ({ ctx }) => {
  const { activeTest } = ctx;
  return (
    <div className="flex flex-col gap-3">
      <RawInputTomlBlock activeTest={activeTest} />
      {!activeTest.dockingRawInput && (
        <p className="text-[11px] text-slate-400 italic">
          No calculation input attached yet. In the Data section, click <b>📂 Select HADDOCK calculation directory…</b> to read <b>raw_input.toml</b> here.
        </p>
      )}
    </div>
  );
};

// ================= EXPERIMENTAL CONDITIONS (Docking) =================
// "Molecules to be docked" from raw_input.toml (with their PDB structures,
// found in data/ or data/0_topoaa). Rendered inside TestShellRenderer's
// "Experimental Conditions" collapsible via `custom.ExperimentalConditions`.
// These structures are deliberately NOT fed to the 3D viewer (only the
// 8_seletopclusts cluster structures are) — the full PDB texts live in the
// molecules browser store and are shown here as expandable text.
export const DockingExperimentalConditions = ({ ctx }) => {
  const { activeTest } = ctx;
  const molKey = `labDockingMolecules_${activeTest.id || 'global'}`;
  const [molecules, setMolecules] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem(molKey) || 'null');
      return Array.isArray(v) ? v : null;
    } catch { return null; }
  });
  const [openIdx, setOpenIdx] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadJson(molKey)
      .then((list) => { if (!cancelled && Array.isArray(list)) setMolecules(list); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [molKey, activeTest.dockingMolecules]);

  const meta = Array.isArray(activeTest.dockingMolecules) ? activeTest.dockingMolecules : [];
  const shown = Array.isArray(molecules) && molecules.length ? molecules : meta;

  if (!shown.length) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 flex flex-col gap-1">
        <span className="text-xs font-black text-slate-600 uppercase">🧪 Molecules to be docked</span>
        <p className="text-[10px] text-slate-400">
          None imported yet — pick a HADDOCK calculation directory to attach the molecules from <b>raw_input.toml</b> (or the PDB files in <b>data/0_topoaa</b>) here.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 flex flex-col gap-2">
      <span className="text-xs font-black text-slate-600 uppercase">🧪 Molecules to be docked</span>
      {shown.map((m, i) => {
        const hasText = !!(m.pdb || m.hasPdb);
        return (
          <div key={m.name || m.fileName || i} className="bg-white border border-slate-200 rounded-lg px-2.5 py-2 flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-black text-slate-700">{m.name}</span>
              {m.segid && <span className="text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5">segid {m.segid}</span>}
              <span className="text-[10px] font-mono text-slate-500">{m.sourcePath || m.fileName}</span>
              {m.driveUrl ? (
                <a href={m.driveUrl} target="_blank" rel="noreferrer"
                  className="text-[10px] font-bold text-sky-700 bg-sky-50 border border-sky-200 hover:bg-sky-100 rounded-md px-2 py-0.5"
                  title="Open the molecule structure file on Google Drive">
                  ☁️ Structure on Drive
                </a>
              ) : (
                <span className="text-[10px] text-slate-400 italic" title="Google Drive was not connected when this molecule was imported — re-import with Drive connected to archive the file">
                  not on Drive
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {hasText ? (
                <button type="button" onClick={() => setOpenIdx(openIdx === i ? null : i)}
                  className="text-[10px] font-bold text-slate-500 hover:text-slate-800 underline">
                  {openIdx === i ? 'hide structure' : 'show structure'}
                </button>
              ) : (
                <span className="text-[10px] text-slate-400">structure not available locally — open it from Drive</span>
              )}
              {hasText && m.pdb && (
                <span className="text-[10px] text-slate-400">{Math.round(String(m.pdb).length / 1024)} KB</span>
              )}
            </div>
            {openIdx === i && m.pdb && (
              <pre className="bg-slate-950 text-emerald-200 rounded-md p-2 text-[9px] leading-tight overflow-auto max-h-52 font-mono whitespace-pre">
                {m.pdb}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
};


// ================= 1) EXPERIMENT SETUP (Docking) =================
export const DockingExperimentSetupSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useDockingDerived(activeTest, ctx);

  // Docking cluster structures (8_seletopclusts) read by the calculation-directory
  // importer — the full PDB texts live in localStorage, keyed by the test id.
  const structKey = `labDockingStructures_${activeTest.id || 'global'}`;
  const [structList, setStructList] = useState(() => {
    try { return JSON.parse(localStorage.getItem(structKey) || '[]'); } catch { return []; }
  });
  const [structIdx, setStructIdx] = useState(0);
  const hasDockStructs = Array.isArray(structList) && structList.length > 0;
  const selectedStruct = hasDockStructs ? (structList[structIdx] || structList[0] || null) : null;

  // When the calculation-directory importer brought cluster structures, open the
  // 3D viewer by default so they are actually visible (instead of a plain protein).
  const structureMode = activeTest.structureMode || (hasDockStructs ? '3d' : '2d');
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
      // Only offer a demo structure once the user has actually defined a
      // receptor (sequence / SMILES / compound) — a brand-new docking
      // experiment should NOT silently load a generic protein.
      const hasDefinedSystem = !!(activeTest.proteinSequence || activeTest.smiles ||
        activeTest.ligandPdbId || (activeTest.selectedCompounds || []).length || (activeTest.compoundsSelected || []).length);
      if (!hasDefinedSystem) return '';
      if (d.moleculeType === 'protein') return 'https://models.rcsb.org/1UBQ.mmtf';
      if (d.moleculeType === 'dna') return 'https://models.rcsb.org/1BNA.mmtf';
      if (d.moleculeType === 'rna') return 'https://models.rcsb.org/1EHZ.mmtf';
      return '';
    }
    if (/^(https?:|blob:|data:)/i.test(raw) || raw.startsWith('/')) return raw;
    if (/^[0-9][A-Za-z0-9]{3}$/.test(raw)) return `https://models.rcsb.org/${raw.toUpperCase()}.mmtf`;
    return raw;
  }, [activeTest.structureSrc, d.moleculeType, activeTest.proteinSequence, activeTest.smiles, activeTest.ligandPdbId, activeTest.selectedCompounds, activeTest.compoundsSelected]);

  // Keep the structure list in sync when the calculation-directory importer
  // stores new structures (the states are declared above the viewer). The
  // full PDB texts live in the browser store (IndexedDB → localStorage), so
  // this re-reads asynchronously after an import.
  useEffect(() => {
    let cancelled = false;
    loadJson(structKey)
      .then((list) => { if (!cancelled && Array.isArray(list)) setStructList(list); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [structKey, activeTest.dockingStructures]);

  return (
    <div className="flex flex-col gap-6">
      {/* Molecule type selector */}
      <div className="flex flex-wrap gap-2 mb-2">
        {[
          { val: 'protein', icon: 'dna', label: 'Protein' },
          { val: 'dna', icon: 'dna', label: 'DNA' },
          { val: 'rna', icon: 'dna', label: 'RNA' },
          { val: 'sugar', icon: 'sugar', label: 'Sugar' },
          { val: 'lipid', icon: 'layers', label: 'Lipid' }
        ].map(({ val, icon, label }) => (
          <button
            key={val}
            onClick={() => updateActiveTest({ moleculeType: val })}
            className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors inline-flex items-center gap-1.5 ${
              d.moleculeType === val ? 'bg-blue-600 border-blue-700 text-white shadow' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Icon name={icon} size={16} />
            {label}
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
            <div className="mb-2 flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase whitespace-nowrap">Receptor topology (PDB ID / URL)</label>
              <input
                type="text"
                value={activeTest.structureSrc || ''}
                onChange={(e) => updateActiveTest({ structureSrc: e.target.value })}
                placeholder="e.g. 1UBQ"
                className="flex-1 min-w-0 border border-slate-300 rounded-md px-2 py-1 text-xs bg-white outline-none focus:border-blue-500"
              />
            </div>
          )}

          <div style={{ display: structureMode === '3d' ? 'block' : 'none' }}>
            {hasOpened3D && (
              <>
                {selectedStruct && (
                  <div className="mb-2 flex flex-wrap items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    <span className="text-[10px] font-black text-slate-600 uppercase">8_seletopclusts structure</span>
                    <select value={structIdx} onChange={(e) => setStructIdx(Number(e.target.value))}
                      className="border border-slate-300 rounded px-2 py-1 text-xs bg-white max-w-[260px]">
                      {structList.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}
                    </select>
                    {selectedStruct.driveUrl && (
                      <a href={selectedStruct.driveUrl} target="_blank" rel="noreferrer" className="text-[10px] font-bold text-sky-700 hover:underline">☁️ Drive</a>
                    )}
                  </div>
                )}
              <NMRMoleculeViewer
                key={((activeTest && activeTest.id) || 'docking') + (selectedStruct ? '::' + selectedStruct.name : '')}
                src={selectedStruct ? '' : structureSrc}
                structureText={selectedStruct ? selectedStruct.pdb : undefined}
                structureTextExt="pdb"
                moleculeType={d.moleculeType}
                parsedSeq={d.parsedSeq}
                selectedKeys={selectedKeys}
                manualKeys={manualKeys}
                onAtomClick={handleAtomClick}
                driveNaming={{ project: (activeTest.projectNames || [])[0] || '', test: activeTest.name || '', instance: activeTest.instanceName || '', scientist: activeTest.operator || '', section: 'Data', subsection: 'Docking' }}
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
              </>
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
  const [calcDirBusy, setCalcDirBusy] = useState(false);
  /* Expérience affichée : dit si le pointeur d'une archive (asynchrone) peut
     être posé tout de suite, ou s'il doit attendre qu'on revienne dessus. */
  const dockingActiveIdRef = useRef((ctx.activeTest && ctx.activeTest.id) || '');
  dockingActiveIdRef.current = (ctx.activeTest && ctx.activeTest.id) || '';

  const handleText = (text, filename) => {
    const parsed = parseDockingFile(text, filename || 'pasted.txt');
    const poses = Array.isArray(parsed.poses) ? parsed.poses : [];
    const updateCount = Object.keys(parsed.updates || {}).length;
    /* Un capri_ss.tsv porte les DEUX : les poses (tableau de résultats) et ses
       colonnes brutes / paramètres. N'en poser qu'un laissait le tableau ou les
       paramètres vides. */
    if (poses.length) onPoses(poses, parsed.program);
    if (updateCount) updateActiveTest(parsed.updates);
    if (poses.length) setReport({ ok: poses.length, type: parsed.type });
    else if (updateCount) setReport({ ok: updateCount, type: parsed.type, params: true });
    else setReport({ ok: 0, type: 'unknown' });
  };

  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => handleText(ev.target.result, file.name);
    reader.readAsText(file);
  };

  // ---- Calculation-directory import (HADDOCK output tree) -------------------
  // The user picks the calculation directory; we read:
  //   data/configurations/raw_input.toml → link in Instrumental Setup
  //   9_caprieval/capri_ss.tsv           → the Data table (TSV, not CSV)
  //   8_seletopclusts/*.pdb[.gz]         → 3D viewer structures (gunzipped)
  // Every file / PDB is archived to Google Drive under <project>/<test>/Docking.
  const readText = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); });
  const readArrayBuffer = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(file); });

  const handleCalcDir = async (files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    setCalcDirBusy(true);
    setReport(null);
    const lower = (s) => String(s || '').toLowerCase();
    const test = ctx.activeTest || {};
    const driveCtx = {
      project: (test.projectNames || [])[0] || '',
      test: test.name || '',
      instance: test.instanceName || '',
      scientist: test.operator || '',
      section: 'Docking'
    };
    // Explicit Drive folder path under <project>/<test>/<instance>/… — each file
    // lands in the subsection it belongs to (Data/pdb files, Instrumental
    // Setup, Experimental Conditions) instead of everything piled into one
    // "Docking" folder.
    const drivePathOf = (extra) => {
      const base = [];
      if ((test.projectNames || [])[0]) base.push(test.projectNames[0]);
      if (test.name) base.push(test.name);
      if (test.instanceName) base.push(test.instanceName);
      return base.concat(extra || []).filter(Boolean);
    };
    const archive = async (name, mime, blob, pathExtra = [], section = 'Docking') => {
      try {
        const res = await uploadLocalFile({
          name, mimeType: mime, file: blob,
          ctx: { ...driveCtx, section },
          path: drivePathOf(pathExtra)
        });
        return res ? res.driveUrl : '';
      } catch { return ''; }
    };
    const done = [];
    const notes = [];
    const warnings = [];

    // Drive may be unavailable (never connected, or the ~1 h token expired) —
    // say so up-front so a "local only" import is not a surprise.
    if (!getDriveToken()) {
      warnings.push('Google Drive is not connected — files will NOT be uploaded (local only). Click “Connect Drive” in the import panel, then re-import to also archive everything on Drive.');
    }

    // 1) capri_ss.tsv → the Data results table (mapped onto the existing
    //    nice table: editable cells, green best row, affinity highlight).
    const capriFile = list.find((f) => /capri_ss\.tsv$/i.test(lower(f.webkitRelativePath || f.name)));
    if (capriFile) {
      const text = await readText(capriFile);
      const parsed = parseCapriTsv(text);
      if (parsed) {
        const driveUrl = await archive('capri_ss.tsv', 'text/tab-separated-values', new Blob([text], { type: 'text/tab-separated-values' }), ['Data'], 'Data');
        /* Mêmes colonnes, mêmes synonymes que pour un TSV importé seul (voir
           posesFromCapri dans DockingData.jsx) : un seul chemin de conversion
           pour les deux imports. */
        const poses = posesFromCapri(parsed);
        onPoses(poses, 'haddock');
        updateActiveTest({ dockingCapri: { ...parsed, sourceName: capriFile.name || 'capri_ss.tsv', driveUrl } });
        done.push(`capri_ss.tsv → results table (${poses.length} poses)`);
        notes.push(driveUrl ? 'stored on Drive' : 'Drive not connected — local only');
      }
    }

    // 2) raw_input.toml → link in Instrumental Setup (searched anywhere in the tree)
    let toml = null;
    const tomlFile = list.find((f) => /(^|\/)raw_input\.(toml|toml\.gz|toml\.bak)$/i.test(lower(f.webkitRelativePath || f.name)));
    if (tomlFile) {
      const text = await readText(tomlFile);
      toml = parseTomlSimple(text);
      const driveUrl = await archive('raw_input.toml', 'text/toml', new Blob([text], { type: 'text/toml' }), ['Instrumental Setup'], 'Instrumental Setup');
      updateActiveTest({ dockingRawInput: { ...toml, fileName: tomlFile.name || 'raw_input.toml', driveUrl } });
      done.push('raw_input.toml → link in Instrumental Setup');
      notes.push(driveUrl ? 'stored on Drive' : 'Drive not connected — local only');
    } else {
      // Make the failure actionable: show what the picked folder actually contained.
      const topLevel = [...new Set(list.map((f) => {
        const parts = String(f.webkitRelativePath || f.name || '').split('/');
        return parts.length > 1 ? parts[0] : '(root)';
      }))].filter(Boolean).slice(0, 12);
      warnings.push('raw_input.toml not found — expected it under data/configurations/raw_input.toml'
        + (topLevel.length ? `. Top-level items seen in the picked folder: ${topLevel.join(', ')}` : ''));
    }

    // 2b) molecules to be docked → Experimental Conditions. The list is read from
    //     raw_input.toml when it declares molecules ([[molecules]] array-of-tables,
    //     a top-level `molecules = [...]` array or a [molecules]/[molecule] label
    //     table). Many real runs carry no such list — there the docked molecules
    //     are simply the topology PDBs built into data/0_topoaa (each file is one
    //     molecule, its file name the molecule name). Only small metadata goes on
    //     the test; the full PDB texts go in the molecules browser store — they
    //     are NOT shown in the 3D viewer.
    if (toml) {
      let molecules = extractDockedMolecules(toml);
      let moleculeSource = 'raw_input.toml';
      if (!molecules.length) {
        // Fallback: enumerate the topology PDBs under data/0_topoaa.
        const topoaaPdb = list
          .filter((f) => /(^|\/)0_topoaa\/[^/]+\.(pdb|pdb\.gz)$/i.test(lower(f.webkitRelativePath || f.name)))
          .sort((a, b) => String(a.webkitRelativePath || a.name).localeCompare(String(b.webkitRelativePath || b.name)));
        molecules = topoaaPdb.map((f) => {
          const rel = f.webkitRelativePath || f.name || '';
          const base = String(f.name || rel.split('/').pop() || '').replace(/\.(pdb|pdb\.gz)$/i, '');
          return { name: base || 'Molecule', pdb: rel, segid: '' };
        });
        if (molecules.length) moleculeSource = 'data/0_topoaa (no molecule list in raw_input.toml)';
      }
      if (molecules.length) {
        const molMeta = [];
        const storedMols = [];
        for (const m of molecules) {
          // Normalize a reference ("data/x.pdb", "x.pdb.gz", "./x.pdb", …) and
          // match by full path first, basename second. The .gz suffix is stripped
          // on both sides so "ligand.pdb.gz" still matches a built "ligand.pdb"
          // file and vice-versa.
          const normRel = (s) => String(s || '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase().replace(/\.gz$/i, '');
          const wantedPath = normRel(m.pdb);
          const wantedBase = wantedPath.split('/').pop();
          const candidates = list.filter((f) => {
            const relN = normRel(f.webkitRelativePath || f.name);
            return relN === wantedPath
              || (wantedPath.includes('/') && relN.endsWith('/' + wantedPath))
              || relN.split('/').pop() === wantedBase;
          });
          // Prefer data/0_topoaa (built topologies), then data/, then anywhere.
          const dirScore = (rel) => (rel.includes('/0_topoaa/') ? 0 : rel.includes('/data/') ? 1 : 2);
          candidates.sort((a, b) => dirScore(normRel(a.webkitRelativePath || a.name)) - dirScore(normRel(b.webkitRelativePath || b.name)));
          const file = candidates[0] || null;
          if (!file) {
            molMeta.push({ name: m.name, segid: m.segid, fileName: m.pdb, sourcePath: '', driveUrl: '', hasPdb: false });
            warnings.push(`No PDB file found for docked molecule "${m.name}" (looked for "${m.pdb}" in data/ and data/0_topoaa)`);
            continue;
          }
          const isGz = /\.gz$/i.test(String(file.name || file.webkitRelativePath || ''));
          let pdbText = '';
          try {
            pdbText = isGz
              ? new TextDecoder('utf-8').decode(gunzipSync(new Uint8Array(await readArrayBuffer(file))))
              : await readText(file);
          } catch { pdbText = ''; }
          // Archive the DECOMPRESSED PDB to Drive (so Drive holds usable .pdb
          // files, not only .pdb.gz) under Experimental Conditions.
          const driveName = String(file.name || m.pdb || 'molecule.pdb').replace(/\.gz$/i, '');
          const driveUrl = await archive(
            driveName, 'chemical/x-pdb',
            pdbText ? new Blob([pdbText], { type: 'chemical/x-pdb' }) : file,
            ['Experimental Conditions'], 'Experimental Conditions'
          );
          const meta = {
            name: m.name,
            segid: m.segid,
            fileName: file.name || m.pdb,
            sourcePath: file.webkitRelativePath || file.name || '',
            driveUrl,
            hasPdb: !!pdbText
          };
          molMeta.push(meta);
          storedMols.push({ ...meta, pdb: pdbText });
        }
        const stored = await storeJson(`labDockingMolecules_${test.id || 'global'}`, storedMols);
        updateActiveTest({ dockingMolecules: molMeta });
        done.push(`${molMeta.length} molecule(s) to be docked (from ${moleculeSource}) → Experimental Conditions`);
        if (!stored) warnings.push('Molecule structures could not be stored in this browser (storage unavailable) — only the names are kept.');
        else notes.push(stored === 'indexeddb' ? 'structures stored in browser database' : 'structures stored locally');
      } else {
        warnings.push('No docked molecules recognised — raw_input.toml declares none (expected [[molecules]], molecules = [...] or a [molecules] table) and no .pdb files were found under data/0_topoaa.');
      }
    }

    // 3) 8_seletopclusts/*.pdb[.gz] → 3D viewer structures
    let pdbFiles = list.filter((f) => /(^|\/)(8_)?seletopclusts?\/[^/]+\.(pdb|pdb\.gz)$/i.test(lower(f.webkitRelativePath || f.name)));
    if (!pdbFiles.length) pdbFiles = list.filter((f) => /\.(pdb|pdb\.gz)$/i.test(lower(f.webkitRelativePath || f.name)));
    const structs = [];
    for (const f of pdbFiles) {
      const rel = f.webkitRelativePath || f.name;
      const isGz = lower(rel).endsWith('.gz');
      let pdbText = '';
      try {
        if (isGz) {
          const buf = await readArrayBuffer(f);
          pdbText = new TextDecoder('utf-8').decode(gunzipSync(new Uint8Array(buf)));
        } else {
          pdbText = await readText(f);
        }
      } catch { continue; }
      const base = String(f.name || rel.split('/').pop() || 'structure').replace(/\.gz$/i, '');
      // Archive the DECOMPRESSED PDB to Drive under Data/pdb files — the viewer
      // always reads the gunzipped text, and Drive also keeps usable .pdb files.
      const driveUrl = await archive(
        base, 'chemical/x-pdb',
        pdbText ? new Blob([pdbText], { type: 'chemical/x-pdb' }) : f,
        ['Data', 'pdb files'], 'Data'
      );
      structs.push({ name: base, pdb: pdbText, driveUrl });
    }
    if (structs.length) {
      // The PDB texts can be large — keep them in the browser store
      // (IndexedDB, falling back to localStorage) keyed by test, so the
      // persisted dataset document stays small; only the metadata goes on the
      // test, and the full text is re-read when the viewer opens.
      const stored = await storeJson(`labDockingStructures_${test.id || 'global'}`, structs);
      updateActiveTest({ dockingStructures: structs.map((s) => ({ name: s.name, driveUrl: s.driveUrl })) });
      done.push(`${structs.length} structure(s) from 8_seletopclusts → 3D viewer`);
      if (!stored) warnings.push('Cluster structures could not be stored in this browser (storage unavailable) — they will not appear in the 3D viewer; the metadata is still saved.');
      else notes.push(stored === 'indexeddb' ? 'stored in browser database' : 'stored locally');
    } else {
      warnings.push('No .pdb / .pdb.gz structures found — expected them under 8_seletopclusts/ (or anywhere in the picked folder)');
    }

    /* Copie de RÉFÉRENCE sur le Drive : les textes PDB vivent dans la base du
       navigateur (IndexedDB → localStorage), qui n'existe sur aucun autre
       poste. Les molécules sont relues de la base (c'est là que l'import les a
       rangées) ; les structures sont celles qu'on vient de lire. Best-effort :
       un Drive injoignable ne casse pas l'import. */
    void (async () => {
      const molecules = await loadJson(`labDockingMolecules_${test.id || 'global'}`).catch(() => null);
      const pointer = await archiveDockingData({
        test,
        instance: String(test.instanceName || '').trim(),
        structures: structs,
        molecules: Array.isArray(molecules) ? molecules : [],
        source: { files: list.length }
      });
      placeRestorePointer({
        field: 'dockingDrive', pointer, key: test.id || 'global',
        activeKey: dockingActiveIdRef.current, patch: updateActiveTest
      });
    })();

    setCalcDirBusy(false);
    setReport({ ok: done.length, items: done, notes, warnings });
  };

  return (
    <div id="docking-import-panel" className="bg-sky-50 border border-sky-200 rounded-xl p-4 flex flex-col gap-3">
      <p className="text-xs font-bold text-sky-800">
        📥 Import docking results — AutoDock Vina (log/table), AutoDock 4 (.dlg), HADDOCK (CAPRI TSV / CSV),
        or parameter files (.dpf / .gpf / config.txt / .toml / .param). Format is auto-detected.
      </p>

      {/* HADDOCK calculation directory — the recommended way to import a whole run */}
      <div id="docking-calc-dir" className="bg-indigo-50 border border-indigo-300 rounded-xl p-3 flex flex-col gap-2">
        <p className="text-xs font-black text-indigo-900 uppercase">📂 HADDOCK calculation directory (recommended)</p>
        <p className="text-[10px] text-indigo-800">
          Pick the whole calculation directory — the app reads <b>data/configurations/raw_input.toml</b> (link in Instrumental
          Setup), <b>9_caprieval/capri_ss.tsv</b> (full TSV into the Data table) and <b>8_seletopclusts/*.pdb[.gz]</b>
          (structures opened in the 3D viewer). The docked molecules listed in <b>raw_input.toml</b> — or, when it has no
          molecule list, the PDB files in <b>data/0_topoaa</b> — appear under Experimental Conditions, and every file is
          archived to Google Drive.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <label className={`bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 rounded-lg text-xs cursor-pointer shadow-sm transition-colors inline-flex items-center gap-2 ${calcDirBusy ? 'opacity-60 pointer-events-none' : ''}`}>
            {calcDirBusy ? '⏳ Reading calculation directory…' : '📂 Select calculation directory'}
            <input
              type="file"
              webkitdirectory=""
              directory=""
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length) handleCalcDir(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          <span className="text-[10px] text-slate-500">Expects the HADDOCK/CAPRI output tree: data/, 8_seletopclusts/, 9_caprieval/</span>
        </div>
      </div>

      {/* Connect Drive hint — imported files are only archived to Drive when a
          valid Drive token exists (tokens expire after ~1 h). */}
      {!getDriveToken() && (
        <div className="flex flex-wrap items-center gap-2 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
          <span className="text-[10px] font-bold text-amber-800">
            Google Drive is not connected — imported files will only be kept locally.
          </span>
          <button
            type="button"
            onClick={() => { try { window.dispatchEvent(new CustomEvent('lab:connect-drive')); } catch { /* ignore */ } }}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg text-[10px] shadow-sm transition-colors whitespace-nowrap"
          >
            🔗 Connect Drive
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-3 items-center">
        <label className="bg-sky-600 hover:bg-sky-700 text-white font-bold px-4 py-2 rounded-lg text-xs cursor-pointer shadow-sm transition-colors inline-flex items-center gap-2">
          📂 Choose file…
          <input
            type="file"
            accept=".dlg,.dpf,.gpf,.csv,.tsv,.txt,.toml,.param,.log,.cfg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files && e.target.files[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
        </label>
        <DriveUploadButton
          suggestedName={suggestDriveFileName({
            project: (ctx.activeTest?.projectNames || [])[0] || '',
            test: ctx.activeTest?.name || '',
            instance: ctx.activeTest?.instanceName || '',
            section: 'Data',
            subsection: 'Docking',
            suffix: 'docking'
          })}
          naming={{
            project: (ctx.activeTest?.projectNames || [])[0] || '',
            test: ctx.activeTest?.name || '',
            instance: ctx.activeTest?.instanceName || '',
            scientist: ctx.activeTest?.operator || '',
            section: 'Data',
            subsection: 'Docking',
            suffix: 'docking'
          }}
          accept=".dlg,.dpf,.gpf,.csv,.tsv,.txt,.toml,.param,.log,.cfg"
          label="⬆ Archive to Drive"
          className="bg-sky-50 text-sky-800 border border-sky-200 hover:bg-sky-100"
        />
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
        <div className={`text-xs font-bold ${report.ok > 0 ? 'text-green-600' : 'text-red-500'} flex flex-col gap-1`}>
          {report.ok > 0
            ? report.params
              ? `✅ Imported ${report.ok} parameters (${report.type})`
              : report.items && report.items.length
                ? report.items.map((it, i) => (
                  <span key={i}>✅ {it}{report.notes && report.notes[i] ? ` — ${report.notes[i]}` : ''}</span>
                ))
                : `✅ Imported ${report.ok} poses (${report.type})`
            : '⚠️ No recognized data — select a results file, paste output text, or pick a HADDOCK calculation directory.'}
          {report.warnings && report.warnings.map((w, i) => (
            <span key={i} className="text-amber-600">⚠️ {w}</span>
          ))}
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

  // ── RESTAURATION AUTOMATIQUE DES STRUCTURES DEPUIS LE DRIVE ──────────────
  // (mécanisme général : src/utils/driveRestore.js + useDriveAutoRestore.js)
  // Les textes PDB vivent dans la base du navigateur (IndexedDB), qui est
  // LOCALE : sur un autre poste, la page n'aurait que des noms de fichiers. Le
  // Drive est donc la copie de RÉFÉRENCE — dès que les métadonnées d'un import
  // sont là mais pas leur contenu, l'archive est re-téléchargée TOUTE SEULE et
  // remise dans la base, et l'utilisateur n'a rien à faire.
  const dockingStructKey = `labDockingStructures_${activeTest.id || 'global'}`;
  const dockingMolKey = `labDockingMolecules_${activeTest.id || 'global'}`;
  const dockingActiveIdRef = useRef(activeTest.id || '');
  dockingActiveIdRef.current = activeTest.id || '';
  useEffect(() => {
    const pending = takePendingRestorePointer({ field: 'dockingDrive', key: activeTest.id || 'global' });
    if (!pending) return;
    updateActiveTest(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTest.id]);

  const dockingHasMeta = (
    (Array.isArray(activeTest.dockingStructures) && activeTest.dockingStructures.length > 0)
    || (Array.isArray(activeTest.dockingMolecules) && activeTest.dockingMolecules.length > 0)
  );

  const dockingDefaultStems = () => restoreStems(activeTest.instanceName, activeTest.name);

  const dockingDriveMissing = async () => {
    if (!dockingHasMeta) return false; // aucun import : rien à restaurer
    const structs = await loadJson(dockingStructKey).catch(() => null);
    const mols = await loadJson(dockingMolKey).catch(() => null);
    const hasStructs = Array.isArray(structs) && structs.length > 0;
    const hasMols = Array.isArray(mols) && mols.length > 0;
    return !hasStructs && !hasMols;
  };

  const restoreDockingFromDrive = async () => {
    const pointer = activeTest.dockingDrive || null;
    const stems = (pointer && Array.isArray(pointer.stems) && pointer.stems.length
      ? pointer.stems
      : dockingDefaultStems());
    const found = await restoreJsonFor({
      kind: DOCKING_RESTORE_KIND, suffix: DOCKING_RESTORE_KIND, stems,
      ctx: dockingDriveCtx(activeTest, activeTest.instanceName), pointer
    });
    if (!found) {
      return {
        ok: false,
        message: '⚠️ The docking structures are not in this browser and no copy was found on Google Drive. Connect Google Drive, then re-import the calculation directory: it archives the structures AND the molecules.'
      };
    }
    const data = (found.data && typeof found.data === 'object') ? found.data : {};
    const structs = Array.isArray(data.structures) ? data.structures : [];
    const mols = Array.isArray(data.molecules) ? data.molecules : [];
    if (!structs.length && !mols.length) {
      return { ok: false, message: `⚠️ The copy found on Google Drive (${found.name}) holds no structures — re-import the calculation directory.` };
    }
    /* La base du navigateur est réapprovisionnée AVANT l'état : c'est elle que
       le viewer 3D et « Molecules to be docked » relisent. */
    if (structs.length) await storeJson(dockingStructKey, structs);
    if (mols.length) await storeJson(dockingMolKey, mols);
    updateActiveTest({
      ...(structs.length
        ? { dockingStructures: structs.map((s) => ({ name: s.name, driveUrl: s.driveUrl || '' })) }
        : {}),
      dockingDrive: {
        ...(activeTest.dockingDrive || {}),
        id: found.id, name: found.name, at: Date.now(), stems, restoredAt: Date.now()
      }
    });
    return { ok: true, message: `✅ Docking structures restored from Google Drive (${found.name}).` };
  };

  const dockingRestore = useDriveAutoRestore({
    kind: DOCKING_RESTORE_KIND,
    testId: activeTest.id,
    missing: dockingDriveMissing,
    restore: restoreDockingFromDrive
  });

  const bestPose = d.poses.length ? d.poses.reduce((a, b) => (a.affinity < b.affinity ? a : b)) : null;

  const program = activeTest.dockingProgram || 'vina';
  // Le libellé / l'unité du score DEPENDENT du programme : « Affinity (kcal/mol) »
  // pour Vina / AutoDock, « HADDOCK score (a.u.) » pour HADDOCK.
  const scoreMetric = dockingMetricOf(DOCKING_METRICS.find((m) => m.key === 'affinity'), program);
  /* Les colonnes du tableau : ce que les poses portent DÉJÀ, plus — pour le
     programme actif — les grandeurs qu'il produit, même absentes de l'import
     (la colonne, son UNITÉ et la cellule éditable sont alors visibles : c'est
     ainsi qu'on saisit les valeurs d'un terme que le fichier n'avait pas) —
     ET les métriques qu'une colonne du fichier importé alimente : sans elles,
     une colonne reconnue (donc masquée comme doublon) disparaîtrait du tableau
     avec sa valeur. */
  const capriColumns = (activeTest.dockingCapri && activeTest.dockingCapri.columns) || [];
  const capriFedKeys = new Set(capriColumns.map(capriColumnMetricKey).filter(Boolean));
  const hasValue = (p, key) => {
    const v = poseMetricValue(p, key, program);
    return v !== undefined && v !== null && v !== '';
  };
  const metricCols = DOCKING_METRICS.filter((m) =>
    (Array.isArray(m.programs) && m.programs.includes(program))
    || capriFedKeys.has(m.key)
    || d.poses.some((p) => hasValue(p, m.key))
  ).map((m) => dockingMetricOf(m, program));
  const renderedMetricKeys = new Set(metricCols.map((m) => m.key));

  // CAPRI columns that are NOT shown as a mapped metric still appear in the
  // results table (e.g. model, md5, fnonnat…) : une colonne du fichier
  // s'affiche donc TOUJOURS — soit sous le nom (et l'unité) de sa métrique,
  // soit telle quelle. Elle ne disparaît que si la métrique qui la porte est
  // réellement rendue dans le tableau.
  const capriExtraCols = capriColumns.filter((c) => {
    const key = capriColumnMetricKey(c);
    return !(key && renderedMetricKeys.has(key));
  });

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
            Best {scoreMetric.label}: {bestPose.affinity}{scoreMetric.unit ? ` ${scoreMetric.unit}` : ''}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Restauration automatique des structures depuis le Drive (voir
              DOCKING_RESTORE_KIND en tête de ce fichier) : l'archive est
              déposée TOUTE SEULE à l'import d'un répertoire de calcul, donc ce
              bouton n'est qu'un secours manuel. */}
          <button
            type="button"
            onClick={() => dockingRestore.attempt('manual')}
            disabled={dockingRestore.status === 'restoring'}
            title="Download the archived copy of these structures from Google Drive (it is saved automatically when a calculation directory is imported) — it also happens by itself when the page opens"
            className="text-[10px] font-bold bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-50 px-2 py-1.5 rounded-lg shadow-sm disabled:opacity-50"
          >
            {dockingRestore.status === 'restoring' ? '⬇️ Downloading…' : '⬇️ Restore from Drive'}
          </button>
          {activeTest.dockingDrive && !dockingRestore.message && (
            <span className="text-[10px] font-bold text-emerald-700">☁ Archived copy on Google Drive</span>
          )}
          {(dockingRestore.status === 'restoring' || dockingRestore.message) && (
            <span className={`text-[10px] font-semibold rounded-lg px-3 py-1.5 border ${dockingRestore.status === 'restored'
              ? 'bg-green-50 border-green-200 text-green-800'
              : dockingRestore.status === 'failed'
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-sky-50 border-sky-200 text-sky-800'}`}>
              {dockingRestore.status === 'restoring'
                ? '⬇️ These structures are not in this browser — restoring the archived copy from Google Drive…'
                : dockingRestore.message}
              {dockingRestore.status === 'failed' && (
                <button type="button" onClick={() => dockingRestore.attempt('manual')}
                  className="ml-2 underline font-bold">Try again</button>
              )}
            </span>
          )}
          <button
            onClick={() => { setShowImport(true); setTimeout(() => document.getElementById('docking-import-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80); }}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm"
          >
            📂 Select HADDOCK calculation directory…
          </button>
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

      {activeTest.dockingRawInput && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="font-bold text-slate-600 uppercase">Calculation input:</span>
          {activeTest.dockingRawInput.driveUrl ? (
            <a href={activeTest.dockingRawInput.driveUrl} target="_blank" rel="noreferrer"
              className="font-bold text-sky-700 hover:underline bg-sky-50 border border-sky-200 rounded-lg px-2 py-0.5">
              📄 {activeTest.dockingRawInput.fileName || 'raw_input.toml'} · open on Drive ↗
            </a>
          ) : (
            <span className="font-bold text-slate-500">📄 {activeTest.dockingRawInput.fileName || 'raw_input.toml'} (read locally)</span>
          )}
        </div>
      )}

      {activeTest.dockingCapri && (
        <p className="text-[10px] text-slate-500 flex flex-wrap items-center gap-2">
          <span className="font-bold text-slate-600 uppercase">CAPRI quality — capri_ss.tsv</span>
          <span>{activeTest.dockingCapri.rows.length} poses imported into the results table below.</span>
          {activeTest.dockingCapri.driveUrl && (
            <a href={activeTest.dockingCapri.driveUrl} target="_blank" rel="noreferrer" className="font-bold text-sky-700 hover:underline">☁️ Open capri_ss.tsv on Drive</a>
          )}
        </p>
      )}

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
              {capriExtraCols.map((c) => (
                <th key={c} className="px-3 py-3 font-bold text-violet-700 border-b bg-violet-50/50" title="CAPRI quality column">{c}</th>
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
                  const val = raw !== undefined ? raw : poseMetricValue(pose, m.key, program);
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
                {capriExtraCols.map((c) => (
                  <td key={c} className="px-3 py-1.5 text-center text-xs font-mono text-slate-600 whitespace-nowrap">{pose[`capri_${c}`]}</td>
                ))}
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

  /* Les graphiques tracent LE TABLEAU DE RÉSULTATS, pas la liste brute des
     poses : chaque cellule du tableau est éditable et sa valeur vit dans la
     couche active (`activeValues`, clé "<index>-<métrique>"). En lisant
     `d.poses` seul, un graphique ignorait ce que l'utilisateur voyait — ou
     restait vide quand la valeur n'existait que dans le tableau. Le repli est
     `poseMetricValue`, LA MÊME lecture que celle des cellules du tableau : la
     colonne CAPRI brute (« capri_lrmsd ») et l'ancienne clé d'une métrique
     renommée (« rmsd_lb ») y ramènent la valeur importée. */
  const rows = d.poses.map((p, i) => {
    const merged = { ...p };
    DOCKING_METRICS.forEach((m) => {
      const raw = d.activeValues[`${i}-${m.key}`];
      if (raw !== undefined && raw !== '') { merged[m.key] = raw; return; }
      const v = poseMetricValue(p, m.key, d.dockingProgram);
      if (v !== undefined) merged[m.key] = v;
    });
    return merged;
  });

  /* La grandeur tracée EST celle du tableau (voir chartEnergyMetricKey) : le
     score du programme quand la table n'a pas d'énergie totale — la seule
     façon de ne pas laisser le graphique vide sur un capri_ss.tsv. */
  const energyKey = chartEnergyMetricKey(rows);
  const energyMetric = dockingMetricOf(DOCKING_METRICS.find((m) => m.key === energyKey), d.dockingProgram);

  /* ── LA SOURCE DE CHAQUE AXE, ET SON DERNIER REPLI ─────────────────────────
     La valeur vient d'abord de la métrique du tableau (cellule éditée → clé
     canonique → colonne reconnue → ancienne clé). Si AUCUNE ligne n'en porte,
     c'est que le fichier range la grandeur dans une colonne qu'aucune métrique
     ne réclame : le tableau l'affiche telle quelle, le graphique la trace donc
     aussi (voir deviationColumnOf / energyColumnOf) — et l'axe en donne le nom.
     Ce repli ne sert QUE quand l'axe serait vide : une courbe juste garde sa
     grandeur, une valeur affichée n'est jamais absente du graphique. */
  const capriColumns = (activeTest.dockingCapri && activeTest.dockingCapri.columns) || [];
  const metricEnergy = (p) => poseChartValue(p, energyKey, d.dockingProgram);
  const metricDeviation = (p) => poseDeviation(p);
  const energyFromColumn = rows.some((p) => metricEnergy(p) !== null) ? null : energyColumnOf(capriColumns);
  const deviationFromColumn = rows.some((p) => metricDeviation(p) !== null) ? null : deviationColumnOf(capriColumns);
  /* ── OU L'UTILISATEUR DIT LUI-MÊME CE QUE TRACE CHAQUE AXE ─────────────────
     Une colonne que le fichier nomme hors des synonymes connus (« ΔG »,
     « E_score », « Ligand_dev ») ne peut pas être devinée : le panneau liste
     toutes les grandeurs lisibles par le tableau (les métriques de l'axe, puis
     les colonnes importées) et le choix explicite prime sur toute devinette —
     deux colonnes numériques du tableau donnent TOUJOURS un nuage. « Auto »
     garde le comportement automatique ci-dessus. */
  const xOptions = plotSourceOptions(capriColumns, rows, 'deviation', d.dockingProgram);
  const yOptions = plotSourceOptions(capriColumns, rows, 'energy', d.dockingProgram);
  const xChoice = plotSourceLabel(xOptions, cfg.xColumn) ? cfg.xColumn : '';
  const yChoice = plotSourceLabel(yOptions, cfg.yColumn) ? cfg.yColumn : '';
  /* « Toutes les colonnes d'écart » : un nuage par écart du tableau (i-RMSD,
     l-RMSD, i-l-RMSD, RMSD, bornes de Vina…), choisi dans le même sélecteur.
     Aucun nom de colonne à deviner : chaque écart du tableau a son nuage. */
  const xMetrics = xOptions.filter((o) => o.value.startsWith(PLOT_SOURCE_PREFIX.metric));
  const allDeviations = cfg.xColumn === PLOT_SOURCE_ALL && xMetrics.length > 1;
  const chosenColumnOf = (choice) => choice.slice(PLOT_SOURCE_PREFIX.column.length);
  const chosenMetricOf = (choice) => (choice.startsWith(PLOT_SOURCE_PREFIX.metric)
    ? dockingMetricOf(DOCKING_METRICS.find((m) => m.key === choice.slice(PLOT_SOURCE_PREFIX.metric.length)), d.dockingProgram)
    : null);
  const rowEnergy = (p) => (yChoice
    ? plotSourceValue(p, yChoice, 'energy', d.dockingProgram)
    : metricEnergy(p) ?? parseDockingValue(poseRawColumnValue(p, energyFromColumn)));
  const rowDeviation = (p) => (xChoice
    ? plotSourceValue(p, xChoice, 'deviation', d.dockingProgram)
    : metricDeviation(p) ?? parseDockingValue(poseRawColumnValue(p, deviationFromColumn)));

  /* ── CE QUE TRACENT LES GRAPHIQUES ──────────────────────────────────────────
     Le graphique trace ce que LE TABLEAU porte : l'énergie de liaison totale
     (kcal/mol) quand la table a un terme « total », sinon le SCORE du programme
     — « HADDOCK score (a.u.) » pour HADDOCK, l'affinité (kcal/mol) pour Vina /
     AutoDock. L'unité de l'axe est celle de la métrique RÉELLEMENT tracée
     (dockingMetricOf) : un score HADDOCK n'est jamais étiqueté kcal/mol, et le
     graphique n'est jamais vide alors que le tableau porte une valeur. Une
     valeur absente ne devient pas un 0 : elle sort du graphique (et la légende
     dit quoi importer / saisir). */
  const plottedEnergy = chosenMetricOf(yChoice) || energyMetric;
  const affinityUnit = plottedEnergy.unit || unit;
  /* Le nom de la grandeur tracée (titres et légendes) : la source CHOISIE dans
     le panneau, sinon la colonne du fichier quand c'est elle qui la porte — son
     unité n'est alors pas connue, on n'invente donc pas de kcal/mol. */
  const autoEnergyName = energyFromColumn || `${energyMetric.label} (${energyMetric.unit || unit})`;
  const energyName = yChoice ? plotSourceLabel(yOptions, yChoice) : autoEnergyName;
  /* L'écart que « Auto » trace : la première grandeur de DEVIATION_PLOT_KEYS que
     le tableau porte (voir poseDeviation) — le sélecteur et le titre du nuage la
     NOMMENT, pour que le graphique dise toujours quelle colonne il trace. */
  const autoDeviationKey = DEVIATION_PLOT_KEYS.find((k) => rows.some((p) => parseDockingValue(poseMetricValue(p, k, d.dockingProgram)) !== null));
  const autoDeviationName = autoDeviationKey
    ? dockingMetricLabel(DOCKING_METRICS.find((m) => m.key === autoDeviationKey), d.dockingProgram)
    : null;
  const autoRmsdName = deviationFromColumn || autoDeviationName || 'RMSD';
  /* L'étiquette d'un axe suit la même règle : elle nomme la colonne lue. */
  const energyAxisTitle = cfg.yAxisLabel
    || (yChoice
      ? (chosenMetricOf(yChoice) ? affinityUnit : chosenColumnOf(yChoice))
      : energyFromColumn || affinityUnit);
  const rmsdAxisTitle = cfg.xAxisLabel
    || (xChoice
      ? (chosenMetricOf(xChoice) ? plotSourceLabel(xOptions, xChoice)
        : `${chosenColumnOf(xChoice)} (Å)`)
      : (deviationFromColumn
        ? `${deviationFromColumn} (Å)`
        : (autoDeviationName ? `${autoDeviationName} (Å)` : 'RMSD from the reference (Å)')));
  const rmsdTitleShort = xChoice
    ? (chosenMetricOf(xChoice) ? plotSourceLabel(xOptions, xChoice) : chosenColumnOf(xChoice))
    : autoRmsdName;
  const affinityData = rows.map((p, i) => ({
    mode: p.mode ?? i + 1,
    affinity: rowEnergy(p)
  })).filter((r) => r.affinity !== null);
  const missingEnergy = rows.length > 0 && affinityData.length === 0;

  // Nuage « RMSD vs énergie » : l'abscisse est l'écart à la référence, choisi
  // dans le panneau, sinon la première grandeur que le tableau porte — l'i-RMSD
  // d'abord, puis le l-RMSD de CAPRI, les bornes de Vina / AutoDock, l'i-l-RMSD,
  // le RMSD, et à défaut la colonne du fichier qui porte un écart (voir
  // deviationFromColumn). L'ordonnée est l'énergie de liaison. Une pose à qui il
  // manque l'un des deux ne peut pas être un point.
  const rmsdData = rows
    .map((p, i) => ({
      mode: p.mode ?? i + 1,
      affinity: rowEnergy(p),
      rmsd: rowDeviation(p)
    }))
    .filter((r) => r.affinity !== null && r.rmsd !== null);

  /* Le choix « toutes les colonnes d'écart » : UN NUAGE PAR ÉCART du tableau
     (i-RMSD, l-RMSD, i-l-RMSD, RMSD, bornes de Vina…), tous contre la même
     énergie — chaque nuage est nommé par l'écart qu'il trace, donc rien n'est
     deviné et aucun écart du fichier n'est perdu de vue. */
  const rmsdSeriesData = allDeviations
    ? xMetrics.map((o) => {
      const m = chosenMetricOf(o.value);
      return {
        value: o.value,
        short: m && m.label ? m.label : o.label,
        axisTitle: m && m.label ? (m.unit ? `${m.label} (${m.unit})` : m.label) : o.label,
        points: rows
          .map((p, i) => ({
            mode: p.mode ?? i + 1,
            affinity: rowEnergy(p),
            rmsd: plotSourceValue(p, o.value, 'deviation', d.dockingProgram)
          }))
          .filter((r) => r.affinity !== null && r.rmsd !== null)
      };
    })
    : [];

  /* Ce que le panneau trace vraiment : la série unique (Auto / colonne choisie),
     ou toutes les séries d'écart — et le mot affiché quand il n'y a aucun point
     (ni énergie, ni écart dans le tableau). */
  const plottedSeries = allDeviations && xMetrics.length > 0 ? rmsdSeriesData : null;
  const plottedPoints = plottedSeries
    ? plottedSeries.reduce((n, s) => n + s.points.length, 0)
    : rmsdData.length;
  const noRmsdNote = missingEnergy
    ? `No score in the results table: the Y axis is ${energyAxisTitle} — see the note under “${energyName} per Pose”.`
    : `No RMSD in the results table${capriColumns.length ? ` (columns read: ${capriColumns.join(', ')})` : ''}: import the CAPRI file (i-RMSD / l-RMSD / i-l-RMSD / RMSD), type a value in a RMSD column above, or pick the X axis column in the bar above.`;

  const energyBreakdownData = rows.slice(0, 10).map((p, i) => ({
    mode: p.mode ?? i + 1,
    vdW: parseDockingValue(p.energy_vdw) ?? 0,
    elec: parseDockingValue(p.energy_elec) ?? 0,
    torsional: parseDockingValue(p.energy_torsional) ?? 0,
    desolv: parseDockingValue(p.energy_desolv) ?? 0
  }));
  const hasBreakdown = rows.some((p) => ['energy_vdw', 'energy_elec', 'energy_torsional', 'energy_desolv']
    .some((k) => parseDockingValue(p[k]) !== null));

  // « HADDOCK score terms » : UNE SÉRIE PAR TERME PRÉSENT dans le tableau
  // (kcal/mol), jamais une barre à 0 pour une colonne que l'import n'avait pas.
  const termDefs = HADDOCK_SCORE_TERM_KEYS.concat(['energy_total'])
    .filter((k) => rows.some((p) => parseDockingValue(p[k]) !== null))
    .map((k) => dockingMetricOf(DOCKING_METRICS.find((m) => m.key === k), d.dockingProgram))
    .filter((m) => m && m.key);
  const termRows = rows.slice(0, 15).map((p, i) => ({
    mode: p.mode ?? i + 1,
    ...haddockScoreTerms(p)
  }));

  const dockSeries = [
    { key: 'affinity', label: energyName },
    { key: 'vdW', label: 'vdW / Hbond / desolv' },
    { key: 'elec', label: 'Electrostatic' },
    { key: 'torsional', label: 'Torsional' },
    { key: 'desolv', label: 'Desolvation' }
  ];
  // Docking energies often mix a few huge values with many small ones: the
  // interrupted axis (✂ in the panel) keeps all the poses readable.
  const brkAff = brokenAxisProps(cfg, 'y', affinityData.map((p) => p.affinity), { min: cfg.yMin, max: cfg.yMax });

  /* Le nuage « énergie vs écart à la référence » : rendu UNE FOIS par écart
     tracé (un seul, ou tous ceux du tableau quand c'est demandé), avec le même
     habillage que les autres graphiques.
     Un graphe QUI A DES POINTS s'ouvre tout seul : une section repliée ne rend
     pas ses enfants (CollapsibleSection : `{isOpen && …}`), donc le nuage
     n'était pas dessiné du tout — « énergie vs. i-RMSD » existait dans le code
     et restait invisible sur la page. Vide (aucun écart, aucune énergie), il
     reste replié : la note sous la grille dit alors quoi importer / saisir. */
  const scatterCard = ({ key, short, axisTitle, points, containerRef = null }) => (
    <CollapsibleSection key={key} title={`${energyName} vs. ${short}`} icon="🎯"
      defaultOpen={allDeviations || points.length > 0}>
      <ChartInspector containerRef={containerRef} cfg={cfg} setCfg={setCfg} series={dockSeries} unit={affinityUnit} style={dockChartBoxStyle(cfg)} className="select-none relative">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={cfgChartMargin(cfg, DOCK_CHART_MARGIN)}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis type="number" dataKey="rmsd" name={short} tick={tickTextProps(cfg)}
              domain={[(dockDom(cfg.xMin) ?? 'auto'), (dockDom(cfg.xMax) ?? 'auto')]}
              tickFormatter={cfgTickFormatter(cfg, 'x') || undefined} scale={cfgLogScale(cfg, 'x')}
              label={cfgAxisLabel(cfg, 'x', axisTitle, 10)} />
            <YAxis type="number" dataKey="affinity" name="Energy" tick={tickTextProps(cfg)}
              domain={[(dockDom(cfg.yMin) ?? 'auto'), (dockDom(cfg.yMax) ?? 'auto')]}
              tickFormatter={cfgTickFormatter(cfg, 'y') || undefined} scale={cfgLogScale(cfg, 'y')}
              label={cfgAxisLabel(cfg, 'y', energyAxisTitle, 0)} />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} />
            <Scatter data={points} fill={seriesColorFor(cfg, 'scatter', 0, 1)} />
          </ScatterChart>
        </ResponsiveContainer>
      </ChartInspector>
    </CollapsibleSection>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <ChartControlBar showCfg={showCfg} onToggleCfg={() => setShowCfg(!showCfg)} className="flex gap-2" />
        {/* Les deux axes du nuage, choisis dans le tableau : une colonne que le
            fichier nomme autrement ne peut pas être devinée. « Toutes les
            colonnes d'écart » trace un nuage par écart du tableau. */}
        <label className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
          X axis
          <select value={cfg.xColumn || ''} onChange={(e) => setCfg({ xColumn: e.target.value })}
            className="border border-slate-300 rounded px-2 py-1 text-xs bg-white font-semibold text-slate-700 max-w-[16rem]">
            <option value="">Auto — {autoRmsdName}</option>
            {xMetrics.length > 1 && (
              <option value={PLOT_SOURCE_ALL}>
                {`All deviations (${xMetrics.map((o) => (chosenMetricOf(o.value) || {}).label || o.label).join(', ')})`}
              </option>
            )}
            {xOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
          Y axis
          <select value={cfg.yColumn || ''} onChange={(e) => setCfg({ yColumn: e.target.value })}
            className="border border-slate-300 rounded px-2 py-1 text-xs bg-white font-semibold text-slate-700 max-w-[16rem]">
            <option value="">Auto — {autoEnergyName}</option>
            {yOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <span className="text-xs text-slate-500 font-bold">
          {isHADDOCK ? 'HADDOCK scoring terms' : 'Binding energy / RMSD'} · {rows.length} poses
        </span>
      </div>

      {showCfg && <SharedChartStylePanel cfg={cfg} setCfg={setCfg} series={[]} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Bar chart — la grandeur du tableau : énergie totale (kcal/mol) ou score */}
        <CollapsibleSection title={`${energyName} per Pose`} icon="📊" defaultOpen={false}>
          <ChartInspector cfg={cfg} setCfg={setCfg} series={dockSeries} unit={affinityUnit} style={dockChartBoxStyle(cfg)}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={affinityData} margin={cfgChartMargin(cfg, DOCK_CHART_MARGIN)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="mode" tick={tickTextProps(cfg)} label={cfgAxisLabel(cfg, 'x', cfg.xAxisLabel || 'Mode / Pose', 10)} />
                <YAxis {...(brkAff.on ? brkAff.axisProps : {})} tick={tickTextProps(cfg)}
                  domain={brkAff.on ? undefined : [(dockDom(cfg.yMin) ?? 'auto'), (dockDom(cfg.yMax) ?? 'auto')]}
                  tickFormatter={cfgTickFormatter(cfg, 'y') || undefined} scale={cfgLogScale(cfg, 'y')}
                  label={cfgAxisLabel(cfg, 'y', energyAxisTitle, 0)} />
                <Tooltip />
                {brkAff.marks}
                <Bar dataKey="affinity" name={energyName} radius={cfg.barRadius ? [cfg.barRadius, cfg.barRadius, 0, 0] : 0}>
                  {affinityData.map((entry, i) => (
                    <Cell key={i} fill={seriesColorFor(cfg, `pose-${entry.mode}`, i, affinityData.length)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartInspector>
          {missingEnergy && (
            <p className="text-xs text-slate-400 italic text-center mt-2">
              No score in the results table: this graph plots the <b>{energyName}</b> — import the CAPRI file
              (score / HADDOCK score), type the values in the <b>{energyName}</b> column above, or pick the
              <b> Y axis</b> column in the bar above.
            </p>
          )}
        </CollapsibleSection>

        {/* La grandeur du tableau en fonction de l'écart à la référence : un seul
            nuage (la colonne choisie, sinon l'écart que « Auto » trace), ou UN
            NUAGE PAR ÉCART du tableau quand « All deviations » est demandé. */}
        {plottedSeries
          ? plottedSeries.map((s, i) => scatterCard({
            key: s.value,
            short: s.short,
            axisTitle: s.axisTitle,
            points: s.points,
            containerRef: i === 0 ? scatterRef : null
          }))
          : scatterCard({
            key: 'auto',
            short: rmsdTitleShort,
            axisTitle: rmsdAxisTitle,
            points: rmsdData,
            containerRef: scatterRef
          })}
        {plottedPoints === 0 && (
          <p className="text-xs text-slate-400 italic text-center mt-2">{noRmsdNote}</p>
        )}

        {/* Energy breakdown stacked bar */}
        <CollapsibleSection title="Energy Component Breakdown" icon="🔋" defaultOpen={false}>
          <ChartInspector cfg={cfg} setCfg={setCfg} series={dockSeries} unit={unit} style={dockChartBoxStyle(cfg)}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={energyBreakdownData} margin={cfgChartMargin(cfg, DOCK_CHART_MARGIN)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="mode" tick={tickTextProps(cfg)} label={cfgAxisLabel(cfg, 'x', cfg.xAxisLabel || 'Mode / Pose', 10)} />
                <YAxis tick={tickTextProps(cfg)}
                  domain={[(dockDom(cfg.yMin) ?? 'auto'), (dockDom(cfg.yMax) ?? 'auto')]}
                  tickFormatter={cfgTickFormatter(cfg, 'y') || undefined} scale={cfgLogScale(cfg, 'y')}
                  label={cfgAxisLabel(cfg, 'y', cfg.yAxisLabel || 'kcal/mol', 0)} />
                <Tooltip />
                {cfg.legend !== 'none' && (
                  <Legend verticalAlign={cfg.legend === 'bottom' ? 'bottom' : 'top'} wrapperStyle={legendTextStyle(cfg)} />
                )}
                <Bar dataKey="vdW" stackId="e" fill={seriesColorFor(cfg, 'vdW', 0, 4)} name="vdW / Hbond / desolv" isAnimationActive={false} />
                <Bar dataKey="elec" stackId="e" fill={seriesColorFor(cfg, 'elec', 1, 4)} name="Electrostatic" isAnimationActive={false} />
                <Bar dataKey="torsional" stackId="e" fill={seriesColorFor(cfg, 'torsional', 2, 4)} name="Torsional" isAnimationActive={false} />
                <Bar dataKey="desolv" stackId="e" fill={seriesColorFor(cfg, 'desolv', 3, 4)} name="Desolvation" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </ChartInspector>
          {!hasBreakdown && (
            <p className="text-xs text-slate-400 italic text-center mt-2">
              No energy component in the results table yet (vdW / elec / desolv / torsional, all in kcal/mol).
            </p>
          )}
        </CollapsibleSection>

        {/* HADDOCK-specific score terms — UNE barre par terme PRÉSENT */}
        {isHADDOCK && (
          <CollapsibleSection title="HADDOCK Score Terms" icon="🧮" defaultOpen={false}>
            <ChartInspector cfg={cfg} setCfg={setCfg}
              series={termDefs.map((m) => ({ key: m.key, label: m.label }))}
              unit="kcal/mol" style={dockChartBoxStyle(cfg)}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={termRows} margin={cfgChartMargin(cfg, DOCK_CHART_MARGIN)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="mode" tick={tickTextProps(cfg)} label={cfgAxisLabel(cfg, 'x', cfg.xAxisLabel || 'Mode / Pose', 10)} />
                  <YAxis tick={tickTextProps(cfg)}
                    domain={[(dockDom(cfg.yMin) ?? 'auto'), (dockDom(cfg.yMax) ?? 'auto')]}
                    tickFormatter={cfgTickFormatter(cfg, 'y') || undefined} scale={cfgLogScale(cfg, 'y')}
                    label={cfgAxisLabel(cfg, 'y', cfg.yAxisLabel || 'kcal/mol', 0)} />
                  <Tooltip />
                  {cfg.legend !== 'none' && (
                    <Legend verticalAlign={cfg.legend === 'bottom' ? 'bottom' : 'top'} wrapperStyle={legendTextStyle(cfg)} />
                  )}
                  {termDefs.map((m, i) => (
                    <Bar key={m.key} dataKey={m.key} name={m.label}
                      fill={seriesColorFor(cfg, m.key, i, termDefs.length)} isAnimationActive={false} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </ChartInspector>
            {termDefs.length === 0 && (
              <p className="text-xs text-slate-400 italic text-center mt-2">
                No HADDOCK score term in the results table: import the HADDOCK score file — it carries
                vdW / elec / desolv / air / total (and the restraint terms) in kcal/mol — or type them in
                the matching columns of the table above.
              </p>
            )}
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
            className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors inline-flex items-center gap-1.5 ${
              (activeTest.dockingStage || 'docking') === s.key
                ? 'bg-blue-600 border-blue-700 text-white'
                : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Icon name={s.icon} size={16} /> {s.label}
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
    const molNames = (activeTest.dockingMolecules || [])
      .map((m) => `${m.name || m.fileName || '?'}${m.segid ? ` (segid ${m.segid})` : ''}`)
      .join(', ');
    return `
      <p style="font-size:12px;color:#475569;margin-bottom:8px;"><b>Docking Setup:</b> Program ${d.programInfo.name} | Scoring ${d.scoringFunction} | Search ${d.searchAlgorithm} | Exhaustiveness ${d.exhaustiveness} | Modes ${d.numModes} | Box (${d.boxSizeX}×${d.boxSizeY}×${d.boxSizeZ} Å) at (${d.boxCenterX}, ${d.boxCenterY}, ${d.boxCenterZ})${molNames ? `<br/><b>Molecules docked:</b> ${molNames}` : ''}</p>
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
    // Le tableau du Lab Notebook suit le programme : le score HADDOCK est en
    // unités arbitraires, et sa déviation de référence est le l-RMSD (Å) — pas la
    // « borne inférieure » d'un amarrage Vina.
    const nbProgram = activeTest.dockingProgram || 'vina';
    const nbScore = dockingMetricOf(DOCKING_METRICS.find((m) => m.key === 'affinity'), nbProgram);
    const nbDev = nbProgram === 'haddock'
      ? dockingMetricOf(DOCKING_METRICS.find((m) => m.key === 'lrmsd'), nbProgram)
      : dockingMetricOf(DOCKING_METRICS.find((m) => m.key === 'rmsd_lb'), nbProgram);
    const th = (t) => `<th style="padding:6px;border:1px solid #cbd5e1;">${t}</th>`;
    let html = `<table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:11px;text-align:left;background:white;">
      <tr style="background-color:#f1f5f9;">${th('Mode')}${th(`${nbScore.label}${nbScore.unit ? ` (${nbScore.unit})` : ''}`)}${th(`${nbDev.label}${nbDev.unit ? ` (${nbDev.unit})` : ''}`)}</tr>`;
    d.poses.forEach((p) => {
      html += `<tr>
        <td style="padding:6px;border:1px solid #e2e8f0;"><b>${p.mode}</b></td>
        <td style="padding:6px;border:1px solid #e2e8f0;">${poseMetricValue(p, 'affinity', nbProgram) ?? ''}</td>
        <td style="padding:6px;border:1px solid #e2e8f0;">${poseMetricValue(p, nbDev.key, nbProgram) ?? ''}</td>
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
