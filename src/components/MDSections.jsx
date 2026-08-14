import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell
} from 'recharts';
import { parseSimulationParameters } from './MDData';
export { parseSimulationParameters };   
import MDMoleculeViewer from './MDMoleculeViewer';

import {
  AMINO_ACID_DB, NUCLEOTIDE_DB, SUGAR_DB, LIPID_DB,
  SS_META, FORM_META, RESIDUE_COLORS,
  SELECT_COLOR, MANUAL_COLOR, FS_CLASSES, OVERLAY_CLASSES,
  parseManual, buildKeys, getCarbonName,
  buildProteinStructure, buildNucleicStructure, buildSugarStructure, buildLipidStructure,
  elementsToSVG,
  StructureSVGView, CollapsibleSection, SequencePaintStrip,
  getSelectedKeys, selectionLabel, getManualKeys,

  FORCE_FIELDS, FF_ATOM_TYPES, WATER_MODELS, MD_ENSEMBLES, MD_INTEGRATORS,
  MD_THERMOSTATS, MD_BAROSTATS, MD_ANALYSIS_METRICS, TRAJECTORY_FORMATS, MD_SIMULATION_PHASES,
  parseMDValue, getForceFieldInfo, getFFVersions, getWaterModelInfo,
  getFFBackboneAtoms, findFFAtom,
  normalizeTrajectoryUrl, detectTrajectoryFormat, getTrajectoryFormatInfo,
  getMDInstances, getMDActiveInstance, getMDLayers, getMDActiveLayerKey, getMDLayerValues,
  writeMDCellValue,
  generateRMSDData, generateRMSFData, generateRgData, generateSASAData,
  generateEnergyData, generateTemperatureData,
  DEFAULT_MD_CHART_STYLE, mdLineDash, mdSeriesColor, mdDom, mdMakeTicks, mdChartBoxStyle,
  MD_CHART_MARGIN
} from './MDData';

// Cache to retain local File objects when switching tabs within the same session
const localFileCache = new Map();

/* ============================================================================
   MDSections — MD page content sections.
========================================================================== */

// ================= REMOTE 3D STRUCTURE FETCH =================
const looksLikePdb = (text) => !!text && /^(ATOM|HETATM)/m.test(text) && !/<html/i.test(text);

const fetchCactusPdb = async (smiles) => {
  const res = await fetch(`https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(smiles)}/file?format=pdb&get3d=true`);
  if (!res.ok) throw new Error(`Cactus HTTP ${res.status}`);
  const text = await res.text();
  if (!looksLikePdb(text)) throw new Error('Cactus did not return a usable 3D structure');
  return text;
};

const fetchPubchemPdb = async (smiles) => {
  const cidRes = await fetch('https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/cids/txt', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `smiles=${encodeURIComponent(smiles)}`,
  });
  if (!cidRes.ok) throw new Error(`PubChem CID lookup HTTP ${cidRes.status}`);
  const cid = (await cidRes.text()).trim().split('\n')[0].trim();
  const sdfRes = await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/record/SDF?record_type=3d`);
  if (!sdfRes.ok) throw new Error(`PubChem 3D SDF HTTP ${sdfRes.status}`);
  return { sdf: await sdfRes.text(), ext: 'sdf' };
};

const resolveOrganicStructureText = async (smiles) => {
  const errors = [];
  try { return { text: await fetchCactusPdb(smiles), ext: 'pdb' }; } catch (e) { errors.push(`Cactus: ${e.message}`); }
  try { const { sdf } = await fetchPubchemPdb(smiles); return { text: sdf, ext: 'sdf' }; } catch (e) { errors.push(`PubChem: ${e.message}`); }
  throw new Error(`No 3D structure could be resolved for this SMILES.\n${errors.join('\n')}`);
};

// ================= SHARED DERIVED DATA HOOK (MD) =================
const useMDDerived = (activeTest, ctx = {}) => {
  const compName = activeTest.selectedCompounds?.[0] || activeTest.compound;
  const metaSeq = (ctx.compoundMeta && compName && ctx.compoundMeta[compName]?.sequence) ? ctx.compoundMeta[compName].sequence : '';
  const metaType = (ctx.compoundMeta && compName && ctx.compoundMeta[compName]?.type) ? ctx.compoundMeta[compName].type : null;

  const moleculeType = activeTest.moleculeType || metaType || 'protein';
  const rawSeq = (activeTest.proteinSequence || metaSeq || '').toUpperCase();

  const validChars =
    moleculeType === 'protein' ? 'ACDEFGHIKLMNPQRSTVWY'
    : moleculeType === 'dna' ? 'ACGT'
    : moleculeType === 'rna' ? 'ACGU' : '';

  const seq =
    moleculeType === 'protein' || moleculeType === 'dna' || moleculeType === 'rna'
      ? rawSeq.replace(new RegExp(`[^${validChars}]`, 'g'), '') : '';

  const isPolymer = moleculeType === 'protein' || moleculeType === 'dna' || moleculeType === 'rna';

  const DB =
    moleculeType === 'protein' ? AMINO_ACID_DB
    : moleculeType === 'dna' ? NUCLEOTIDE_DB.DNA
    : moleculeType === 'rna' ? NUCLEOTIDE_DB.RNA
    : moleculeType === 'sugar' ? SUGAR_DB : LIPID_DB;

  // ---- MD parameters ----
  const ffKey = activeTest.forceField || 'GROMOS';
  const ffVersion = activeTest.forceFieldVersion || (getFFVersions(ffKey)[0] || '');
  const waterModel = activeTest.waterModel || 'TIP3P';
  const ensemble = activeTest.ensemble || 'NPT';
  const integrator = activeTest.integrator || 'verlet';
  const thermostat = activeTest.thermostat || 'v_rescale';
  const barostat = activeTest.barostat || 'parrinello_rahman';
  const timestep = activeTest.timestep ?? '2';
  const nSteps = activeTest.nSteps ?? '500000';
  const temperature = activeTest.simTemperature ?? '300';
  const pressure = activeTest.simPressure ?? '1.0';

  // ---- trajectory ----
  const trajectoryUrl = activeTest.trajectoryUrl || '';
  const trajectoryFormat = activeTest.trajectoryFormat || detectTrajectoryFormat(trajectoryUrl);

  // ---- conformation state (identical to NMR) ----
  const ssRaw = activeTest.secondaryStructure || '';
  const getSSAt = (i) => (ssRaw[i] && 'HES'.includes(ssRaw[i]) ? ssRaw[i] : 'C');

  const formsRaw = activeTest.nucleicForms || '';
  const dnaFormDefault = activeTest.dnaForm || 'B';
  const getFormAt = (i) => (formsRaw[i] && 'ABZ'.includes(formsRaw[i]) ? formsRaw[i] : dnaFormDefault);

  const sugarConf = activeTest.sugarConf || 'chair';
  const sugarAnomer = activeTest.sugarAnomer || 'alpha';
  const lipidDB = activeTest.lipidDB || 'cis';

  const typeLabel =
    moleculeType === 'protein' ? 'Protein'
    : moleculeType === 'dna' ? 'DNA'
    : moleculeType === 'rna' ? 'RNA'
    : moleculeType === 'sugar' ? 'Sugar'
    : moleculeType === 'organic' ? 'Organic Molecule' : 'Phospholipid';

  const ffInfo = getForceFieldInfo(ffKey);
  const ffBackbone = getFFBackboneAtoms(ffKey);

  // ---- parsed sequence with force-field atom data ----
  const parsedSeq = useMemo(() => {
    let chars = [];
    if (moleculeType === 'organic') {
      if (!activeTest.smiles) return [];
      return [{
        id: 'ORG1',
        char: 'O',
        name: 'Organic Molecule',
        color: '#3b82f6',
        ffAtoms: [] // Stays empty until full parameter logic parses it
      }];
    }
    if (isPolymer) { if (!seq) return []; chars = seq.split(''); }
    else if (moleculeType === 'sugar') chars = [activeTest.sugarChoice || 'GLC'];
    else if (moleculeType === 'lipid') chars = [activeTest.lipidChoice || 'POPC'];

    return chars.map((char, index) => {
      const entry = DB[char];
      if (!entry) return null;
      const ffAtoms = ffBackbone.map((a) => ({ ...a }));
      return {
        ...entry,
        id: `${entry.code3 || char}${index + 1}`,
        char,
        color: RESIDUE_COLORS[index % RESIDUE_COLORS.length],
        ffAtoms
      };
    }).filter(Boolean);
  }, [seq, moleculeType, activeTest.sugarChoice, activeTest.lipidChoice, ffKey, DB, isPolymer, ffBackbone]);

  // ---- secondary-structure / form annotated sequence ----
  const estSeq = useMemo(() => parsedSeq.map((res, idx) => ({
    ...res,
    ssLetter: moleculeType === 'protein' ? getSSAt(idx) : 'C',
    formLetter: getFormAt(idx)
  })), [parsedSeq, moleculeType, ssRaw, formsRaw, dnaFormDefault]);

  // ---- 2D structure ----
  const structure = useMemo(() => {
    if (parsedSeq.length === 0) return null;
    if (moleculeType === 'protein') return buildProteinStructure(parsedSeq);
    if (moleculeType === 'dna' || moleculeType === 'rna') return buildNucleicStructure(parsedSeq, moleculeType);
    if (moleculeType === 'sugar') return buildSugarStructure(parsedSeq[0], sugarConf, sugarAnomer);
    if (moleculeType === 'lipid') return buildLipidStructure(parsedSeq[0], lipidDB);
    return null;
  }, [parsedSeq, moleculeType, sugarConf, sugarAnomer, lipidDB]);

  // ---- atom options for selectors / plots ----
  const atomOptions = useMemo(() => {
    const opts = [];
    estSeq.forEach((res, idx) => {
      (res.ffAtoms || []).forEach((a) => opts.push({ key: `${idx}-${a.atom}`, label: `${res.id} ${a.atom}` }));
    });
    return opts;
  }, [estSeq]);

  // ---- instances / layers (MD model) ----
  const instances = getMDInstances(activeTest);
  const activeInstance = getMDActiveInstance(activeTest);
  const layers = getMDLayers(activeTest);
  const activeLayerKey = getMDActiveLayerKey(activeTest);
  const activeValues = getMDLayerValues(activeInstance, activeLayerKey);

  return {
    moleculeType, seq, validChars, isPolymer, DB, typeLabel,
    ffKey, ffVersion, ffInfo, ffBackbone, waterModel, ensemble, integrator,
    thermostat, barostat, timestep, nSteps, temperature, pressure,
    trajectoryUrl, trajectoryFormat,
    getSSAt, getFormAt, sugarConf, sugarAnomer, lipidDB, dnaFormDefault,
    parsedSeq, estSeq, structure, atomOptions,
    instances, activeInstance, layers, activeLayerKey, activeValues,
    metaSeq
  };
};

// ================= 1) EXPERIMENT SETUP (MD) =================
// ================= RDKIT MOLBLOCK HELPERS (organic atom naming) =================
const getMolWithExplicitHs = (smiles) => {
  if (!window.__RDKit || !smiles) return null;
  const base = window.__RDKit.get_mol(smiles);
  if (!base) return null;
  const molblockWithHs = base.add_hs();
  base.delete();
  return window.__RDKit.get_mol(molblockWithHs);
};

const deriveOrganicAtomNaming = (molblock) => {
  const lines = molblock.split('\n');
  const counts = lines[3] || '';
  const numAtoms = parseInt(counts.substring(0, 3).trim(), 10) || 0;
  const numBonds = parseInt(counts.substring(3, 6).trim(), 10) || 0;

  const elements = [];
  for (let i = 0; i < numAtoms; i++) elements.push((lines[4 + i].substring(31, 34) || '').trim());

  const bonds = [];
  for (let i = 0; i < numBonds; i++) {
    const bl = lines[4 + numAtoms + i] || '';
    const a1 = parseInt(bl.substring(0, 3).trim(), 10) - 1;
    const a2 = parseInt(bl.substring(3, 6).trim(), 10) - 1;
    if (!isNaN(a1) && !isNaN(a2)) bonds.push([a1, a2]);
  }

  const heavyRank = new Array(numAtoms).fill(-1);
  let hc = 0;
  for (let i = 0; i < numAtoms; i++) if (elements[i] !== 'H') heavyRank[i] = hc++;

  const parent = new Array(numAtoms).fill(-1);
  bonds.forEach(([a, b]) => {
    if (elements[a] === 'H' && elements[b] !== 'H') parent[a] = b;
    if (elements[b] === 'H' && elements[a] !== 'H') parent[b] = a;
  });

  const hGroups = {};
  for (let i = 0; i < numAtoms; i++) {
    if (elements[i] !== 'H') continue;
    const key = parent[i] >= 0 ? parent[i] : 'orphan';
    (hGroups[key] = hGroups[key] || []).push(i);
  }

  const atomNameList = new Array(numAtoms);
  for (let i = 0; i < numAtoms; i++) if (elements[i] !== 'H') atomNameList[i] = `${elements[i]}${heavyRank[i]}`;
  Object.entries(hGroups).forEach(([key, idxs]) => {
    const parentRank = key === 'orphan' ? null : heavyRank[Number(key)];
    idxs.forEach((idx, j) => {
      const suffix = idxs.length > 1 ? ('abcdefgh'[j] || String(j)) : '';
      atomNameList[idx] = parentRank !== null ? `H${parentRank}${suffix}` : `H${idx}`;
    });
  });

  const atomLabels = {};
  atomNameList.forEach((name, i) => { atomLabels[i] = name; });
  return { atomLabels, atomNameList, elements, numAtoms };
};

// ================= ORGANIC VIEWER =================
const OrganicViewer = ({ smiles, selectedKeys, onAtomClick }) => {
    const [svg, setSvg] = useState('');
    const [isZoomed, setIsZoomed] = useState(false);
    const svgRef = useRef(null);
    const zoomedSvgRef = useRef(null);
    
    useEffect(() => {
        if (smiles && window.__RDKit) {
            try {
                const mol = getMolWithExplicitHs(smiles);
                if (!mol) throw new Error('RDKit could not parse this SMILES');

                const molblock = mol.get_molblock();
                const { atomLabels, atomNameList } = deriveOrganicAtomNaming(molblock);

                let highlightAtoms = [];
                if (selectedKeys && selectedKeys.length > 0) {
                    highlightAtoms = selectedKeys.map(k => {
                        const parts = k.split('-');
                        if (parts.length < 2) return -1;
                        const atomName = parts.slice(1).join('-');
                        return atomNameList.indexOf(atomName);
                    }).filter(idx => idx >= 0);
                }

                const details = JSON.stringify({ 
                    addAtomIndices: false, 
                    addStereoAnnotation: true,
                    atomLabels: atomLabels, 
                    width: 450, 
                    height: 350,
                    atoms: highlightAtoms,
                    highlightAtomColors: highlightAtoms.reduce((acc, idx) => {
                        acc[idx] = [0.96, 0.62, 0.04]; 
                        return acc;
                    }, {})
                });
                
                setSvg(mol.get_svg_with_highlights(details));
                mol.delete();
            } catch(e) { setSvg(''); }
        } else { setSvg(''); }
    }, [smiles, selectedKeys]);

    const attachListeners = (containerEl) => {
        if (!containerEl || !onAtomClick || !window.__RDKit) return;
        try {
            const mol = getMolWithExplicitHs(smiles);
            if (!mol) return;
            const molblock = mol.get_molblock();
            const { atomNameList } = deriveOrganicAtomNaming(molblock);
            mol.delete();

            const atoms = containerEl.querySelectorAll('[class*="atom-"]');
            atoms.forEach(node => {
                node.style.cursor = 'pointer';
                node.onclick = (e) => {
                    e.stopPropagation();
                    const cls = Array.from(node.classList).find(c => c.startsWith('atom-'));
                    if (cls) {
                        const idx = parseInt(cls.replace('atom-', ''), 10);
                        if (!isNaN(idx) && atomNameList[idx]) {
                            onAtomClick(0, [`0-${atomNameList[idx]}`]);
                        }
                    }
                };
            });
        } catch (e) {}
    };

    useEffect(() => { attachListeners(svgRef.current); }, [svg, onAtomClick]);
    useEffect(() => { if (isZoomed) attachListeners(zoomedSvgRef.current); }, [isZoomed, svg, onAtomClick]);

    const fallbackUrl = `https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(smiles)}/image?width=1500&height=1500`;
    
    return (
        <>
            <div ref={svgRef} className="flex flex-col items-center justify-center bg-white p-4 rounded-xl shadow-sm border border-slate-200 group relative h-[350px]">
                {svg ? (
                    <div dangerouslySetInnerHTML={{__html: svg}} className="w-full h-full flex items-center justify-center [&>svg]:w-full [&>svg]:h-full" />
                ) : (
                    <img src={fallbackUrl} alt="2D Structure" className="max-w-full h-full object-contain" />
                )}
                <div onClick={() => setIsZoomed(true)} className="cursor-pointer absolute inset-0 bg-black/5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-xl">
                    <span className="bg-white/90 text-slate-800 px-3 py-1.5 rounded-lg font-bold text-sm shadow-sm pointer-events-none">🔍 Click to zoom structure</span>
                </div>
            </div>
            {isZoomed && (
                <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-900/85 backdrop-blur-sm p-4 overflow-auto" onClick={() => setIsZoomed(false)}>
                    <div ref={zoomedSvgRef} className="bg-white p-6 rounded-2xl shadow-2xl relative max-w-[95vw] max-h-[95vh] overflow-auto flex items-center justify-center" onClick={e => e.stopPropagation()}>
                        <button onClick={() => setIsZoomed(false)} className="absolute top-2 right-2 bg-slate-200 text-slate-800 rounded-full w-10 h-10 flex items-center justify-center text-2xl font-black shadow-lg hover:bg-slate-300 z-50">×</button>
                        {svg ? (
                            <div dangerouslySetInnerHTML={{__html: svg.replace(/width=['"]450['"]/i, 'width="100%"').replace(/height=['"]350['"]/i, 'height="100%"')} } className="w-full min-w-[800px] [&>svg]:w-full [&>svg]:h-auto" />
                        ) : (
                            <img src={fallbackUrl} alt="Zoomed Structure" className="w-full h-auto min-w-[800px] object-contain" />
                        )}
                    </div>
                </div>
            )}
        </>
    );
};

// ================= 1) EXPERIMENT SETUP (MD) =================
export const MDExperimentSetupSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useMDDerived(activeTest, ctx);

  const structureMode = activeTest.structureMode || '2d';
  const atomLabelMode = activeTest.atomLabelMode || 'selected';
  const residueOffset = activeTest.residueOffset || 0;

  const atomNameMap = useMemo(() => {
    try { return activeTest.atomNameMap ? JSON.parse(activeTest.atomNameMap) : {}; } catch { return {}; }
  }, [activeTest.atomNameMap]);

  const [hasOpened3D, setHasOpened3D] = useState(structureMode === '3d');
  
  const [trajectoryFile, setTrajectoryFile] = useState(() => localFileCache.get(activeTest.id)?.trajectory || null);

  const handleStructureFile = (file) => {
    if (!file) {
      updateActiveTest({ structureFileData: null, structureFileName: null });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      updateActiveTest({ structureFileData: e.target.result, structureFileName: file.name });
    };
    reader.readAsDataURL(file);
  };

  const handleTrajectoryFile = (file) => {
    if (!file) {
      updateActiveTest({ trajectoryFileName: null });
      setTrajectoryFile(null);
      return;
    }
    setTrajectoryFile(file);
    updateActiveTest({ trajectoryFileName: file.name });
    const cache = localFileCache.get(activeTest.id) || {};
    localFileCache.set(activeTest.id, { ...cache, trajectory: file });
  };
  
  useEffect(() => { if (structureMode === '3d') setHasOpened3D(true); }, [structureMode]);

  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
    return () => clearTimeout(t);
  }, [structureMode, hasOpened3D]);

  const focusIdx = activeTest.focusIdx !== undefined ? activeTest.focusIdx : 'ALL';
  const setFocusIdx = (val) => updateActiveTest({ focusIdx: val });

  const [expandedPanel, setExpandedPanel] = useState(null);
  const [ssBrush, setSSBrush] = useState('H');
  const [formBrush, setFormBrush] = useState(activeTest.dnaForm || 'B');

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

  const setAllSS = (letter) => updateActiveTest({ secondaryStructure: d.seq.split('').map(() => letter).join('') });

  const paintFormAt = (i, letter) => {
    const arr = d.seq.split('').map((_, j) => d.getFormAt(j));
    arr[i] = letter;
    updateActiveTest({ nucleicForms: arr.join('') });
  };

  const setAllForms = (letter) => updateActiveTest({ nucleicForms: d.seq.split('').map(() => letter).join(''), dnaForm: letter });

  const exportFormulaToNotebook = () => {
    if (!d.structure) return;
    const html = `<div style="margin-top:10px;"><h5 style="color:#1e40af;font-size:12px;margin-bottom:6px;">🔬 Chemical Formula (${d.typeLabel}):</h5>` + elementsToSVG(d.structure, 300) + `</div>`;
    const currentComments = activeTest.comments || '';
    updateActiveTest({ comments: currentComments + (currentComments ? '<br/>' : '') + html });
    alert('Chemical formula appended to the Lab Notebook notes.');
  };

  const trajNorm = normalizeTrajectoryUrl(d.trajectoryUrl) || { url: null, fallbacks: [] };

  // --- ORGANIC MOLECULE 3D FETCHING ---
  const activeSmiles = activeTest.smiles || '';
  const hasExplicitOverride = !!(activeTest.structureSrc || activeTest.structureFileName || activeTest.structureFileData);
  const [organicFetch, setOrganicFetch] = useState({ smiles: null, text: null, ext: null, loading: false, error: null });
  const needsOrganicFetch = !hasExplicitOverride && !!activeSmiles && d.moleculeType === 'organic';

  useEffect(() => {
    if (!needsOrganicFetch) { 
      setOrganicFetch({ smiles: null, text: null, ext: null, loading: false, error: null }); 
      return; 
    }
    if (organicFetch.smiles === activeSmiles && (organicFetch.text || organicFetch.loading)) return;
    
    let cancelled = false;
    setOrganicFetch({ smiles: activeSmiles, text: null, ext: null, loading: true, error: null });
    
    resolveOrganicStructureText(activeSmiles)
      .then(({ text, ext }) => { if (!cancelled) setOrganicFetch({ smiles: activeSmiles, text, ext, loading: false, error: null }); })
      .catch((err) => { if (!cancelled) setOrganicFetch({ smiles: activeSmiles, text: null, ext: null, loading: false, error: err.message }); });
    
    return () => { cancelled = true; };
  }, [needsOrganicFetch, activeSmiles]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2 mb-2">
        {[['protein', '🧬 Protein'], ['dna', '🧬 DNA'], ['rna', '🧬 RNA'], ['sugar', '🍬 Sugars'], ['lipid', '🫧 Phospholipids'], ['organic', '⬡ Organic Molecule']].map(([val, lab]) => (
          <button key={val} onClick={() => updateActiveTest({ moleculeType: val })}
            className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors ${d.moleculeType === val ? 'bg-blue-600 border-blue-700 text-white shadow' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
            {lab}
          </button>
        ))}
      </div>

      <div className="flex flex-col md:flex-row gap-6 items-start">
        <div className="flex-1 w-full">
          {d.moleculeType === 'organic' ? (
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">SMILES String</label>
              <input type="text" value={activeTest.smiles || ''} onChange={(e) => updateActiveTest({ smiles: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-3 font-mono text-sm outline-none focus:border-blue-500 shadow-inner"
                placeholder="e.g. CC(=O)Oc1ccccc1C(=O)O" />
            </div>
          ) : d.isPolymer ? (
            <>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">{d.typeLabel} Sequence (1-letter code)</label>
              <textarea 
                value={activeTest.proteinSequence ?? (d.metaSeq || '')} 
                onChange={(e) => updateActiveTest({ proteinSequence: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-3 font-mono text-sm tracking-widest outline-none focus:border-blue-500 uppercase h-24 custom-scrollbar shadow-inner"
                placeholder={d.moleculeType === 'protein' ? 'e.g. MKWVTFISLL...' : d.moleculeType === 'dna' ? 'e.g. ATGCGTAC...' : 'e.g. AUGCGUAC...'} 
              />
              <p className="text-[10px] text-slate-400 mt-1 font-bold">Length: {d.seq.length} {d.moleculeType === 'protein' ? 'residues' : 'nucleotides'} (valid: {d.validChars.split('').join(' ')})</p>
            </>
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
        </div>
      </div>

      {d.moleculeType === 'protein' && d.parsedSeq.length > 0 && (
        <div>
          <div className="flex flex-wrap gap-2 mb-3 items-center">
            <span className="text-xs font-bold text-slate-500 uppercase mr-1">🖌️ Brush:</span>
            {['C', 'H', 'E'].map((l) => (
              <button key={l} onClick={() => setSSBrush(l)} className="px-3 py-1 rounded-lg text-xs font-black border transition-all"
                style={{ backgroundColor: ssBrush === l ? SS_META[l].color : 'white', borderColor: SS_META[l].color, color: ssBrush === l ? 'white' : SS_META[l].color }}>
                {SS_META[l].label}
              </button>
            ))}
            <span className="mx-2 text-slate-300">|</span>
            <button onClick={() => setAllSS('C')} className="px-3 py-1 rounded-lg text-xs font-bold bg-slate-100 border border-slate-300 text-slate-600 hover:bg-slate-200">All Coil</button>
            <button onClick={() => setAllSS('H')} className="px-3 py-1 rounded-lg text-xs font-bold bg-violet-100 border border-violet-300 text-violet-700 hover:bg-violet-200">All α-Helix</button>
            <button onClick={() => setAllSS('E')} className="px-3 py-1 rounded-lg text-xs font-bold bg-amber-100 border border-amber-300 text-amber-700 hover:bg-amber-200">All β-Sheet</button>
          </div>
          <p className="text-xs text-slate-400 mb-3">💡 Select a brush, then click or drag across the sequence chips to paint secondary structure.</p>
          <SequencePaintStrip
            residues={d.parsedSeq}
            getLetter={(i) => d.getSSAt(i)}
            meta={SS_META}
            onApply={(i) => paintSSAt(i, ssBrush)}
            focusIdx={focusIdx}
          />
        </div>
      )}

      {(d.moleculeType === 'dna' || d.moleculeType === 'rna') && d.parsedSeq.length > 0 && (
        <div>
          <div className="flex flex-wrap gap-2 mb-3 items-center">
            <span className="text-xs font-bold text-slate-500 uppercase mr-1">🖌️ Brush:</span>
            {['A', 'B', 'Z'].map((l) => (
              <button key={l} onClick={() => setFormBrush(l)} className="px-3 py-1 rounded-lg text-xs font-black border transition-all"
                style={{ backgroundColor: formBrush === l ? FORM_META[l].color : 'white', borderColor: FORM_META[l].color, color: formBrush === l ? 'white' : FORM_META[l].color }}>
                {FORM_META[l].label}
              </button>
            ))}
            <span className="mx-2 text-slate-300">|</span>
            <button onClick={() => setAllForms('A')} className="px-3 py-1 rounded-lg text-xs font-bold bg-sky-100 border border-sky-300 text-sky-700 hover:bg-sky-200">All A</button>
            <button onClick={() => setAllForms('B')} className="px-3 py-1 rounded-lg text-xs font-bold bg-green-100 border border-green-300 text-green-700 hover:bg-green-200">All B</button>
            <button onClick={() => setAllForms('Z')} className="px-3 py-1 rounded-lg text-xs font-bold bg-rose-100 border border-rose-300 text-rose-700 hover:bg-rose-200">All Z</button>
          </div>
          <SequencePaintStrip
            residues={d.parsedSeq}
            getLetter={(i) => d.getFormAt(i)}
            meta={FORM_META}
            onApply={(i) => paintFormAt(i, formBrush)}
            focusIdx={focusIdx}
          />
        </div>
      )}

      {(d.structure || d.moleculeType === 'organic') && (
        <div>
          <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
            <div className="flex bg-slate-200 p-1 rounded-lg">
              <button onClick={() => updateActiveTest({ structureMode: '2d' })}
                className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${structureMode === '2d' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>2D Formula</button>
              <button onClick={() => updateActiveTest({ structureMode: '3d' })}
                className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${structureMode === '3d' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>3D Viewer + Trajectory</button>
            </div>

            <div className="flex items-center gap-2 flex-wrap justify-end">
              <label className="text-[10px] font-bold text-slate-500 uppercase">🔍 Focus</label>
              <select value={focusIdx} onChange={(e) => setFocusIdx(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
                className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 max-w-[180px]">
                <option value="ALL">All residues</option>
                {d.parsedSeq.map((r, i) => <option key={i} value={i}>{r.id} — {r.name}</option>)}
              </select>
              {selectedKeys && (
                <button onClick={() => updateActiveTest({ selectedAtomKeys: [] })} className="px-2 py-1 rounded-lg text-xs font-bold bg-amber-100 border border-amber-400 text-amber-800">✖ Deselect ({selectionLabel(d, selectedKeys)})</button>
              )}
              <button onClick={exportFormulaToNotebook} className="px-2 py-1 rounded-lg text-xs font-bold bg-indigo-50 border border-indigo-300 text-indigo-700 hover:bg-indigo-100" title="Append this formula (SVG) to the Lab Notebook notes">📓 Formula → Notebook</button>
            </div>
          </div>

          {structureMode === '3d' && (
            <div className="mb-3 flex flex-col gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Topology (PDB ID / Drive Link)</label>
                  <input type="text" value={activeTest.structureSrc || ''} onChange={(e) => updateActiveTest({ structureSrc: e.target.value })}
                    placeholder="e.g. 1UBQ or Google Drive link" className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500" />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Topology file from PC</label>
                  <input
                    type="file"
                    accept=".pdb,.ent,.gro,.cif,.mmcif,.bcif,.mol2,.sdf,.xyz"
                    onChange={(e) => handleStructureFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
                    className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 file:mr-2 file:px-2 file:py-0.5 file:rounded file:border-0 file:bg-blue-50 file:text-blue-700 file:text-[10px] file:font-bold"
                  />
                  {activeTest.structureFileName && (
                    <span className="text-[10px] font-bold text-emerald-700 mt-0.5 flex items-center">
                      ✓ {activeTest.structureFileName}
                      <button type="button" onClick={() => handleStructureFile(null)} className="ml-2 text-red-500 hover:text-red-700 font-black">✕</button>
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Topology format</label>
                  <select value={activeTest.structureFormat || 'auto'} onChange={(e) => updateActiveTest({ structureFormat: e.target.value })}
                    className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
                    <option value="auto">Auto-detect</option>
                    <option value="pdb">PDB</option>
                    <option value="gro">GRO</option>
                    <option value="cif">CIF</option>
                    <option value="mmcif">mmCIF</option>
                    <option value="mol2">MOL2</option>
                    <option value="sdf">SDF</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Atom labels</label>
                  <select value={atomLabelMode} onChange={(e) => updateActiveTest({ atomLabelMode: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
                    <option value="none">No labels</option>
                    <option value="selected">Selected labels</option>
                    <option value="all">All labels</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Trajectory format</label>
                  <select value={d.trajectoryFormat} onChange={(e) => updateActiveTest({ trajectoryFormat: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
                    {TRAJECTORY_FORMATS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 pt-3 border-t border-slate-200">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Trajectory file from PC (.xtc / .trr)</label>
                  <input
                    type="file"
                    accept=".xtc,.trr,.dcd,.nc,.gro,.pdb"
                    onChange={(e) => handleTrajectoryFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
                    className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 file:mr-2 file:px-2 file:py-0.5 file:rounded file:border-0 file:bg-blue-50 file:text-blue-700 file:text-[10px] file:font-bold"
                  />
                  {trajectoryFile ? (
                    <span className="text-[10px] font-bold text-emerald-700 mt-0.5 flex items-center">
                      ✓ {trajectoryFile.name} (Ready)
                      <button type="button" onClick={() => handleTrajectoryFile(null)} className="ml-2 text-red-500 hover:text-red-700 font-black">✕</button>
                    </span>
                  ) : activeTest.trajectoryFileName ? (
                    <span className="text-[10px] font-bold text-amber-600 mt-0.5 flex flex-col">
                      <span>⚠️ {activeTest.trajectoryFileName}</span>
                      <span className="font-normal text-slate-500">Please re-select this file to view it in 3D.</span>
                      <button type="button" onClick={() => updateActiveTest({ trajectoryFileName: null })} className="self-start mt-1 text-red-500 hover:text-red-700 font-bold underline">Clear saved name</button>
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">🎞️ Trajectory online link</label>
                  <input 
                    type="text" 
                    value={d.trajectoryUrl} 
                    onChange={(e) => updateActiveTest({ trajectoryUrl: e.target.value })}
                    placeholder="https://…/trajectory.xtc (or Google Drive link)"
                    className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-mono" 
                  />
                  <div className="flex items-center gap-2 flex-wrap mt-0.5">
                    <span className="text-[10px] text-slate-400">Detected: <b>{getTrajectoryFormatInfo(d.trajectoryFormat).label}</b></span>
                    {d.trajectoryUrl && (
                      <a 
                        href={d.trajectoryUrl} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-[10px] text-blue-600 hover:text-blue-800 font-bold underline bg-blue-50 px-2 py-0.5 rounded border border-blue-200"
                        title="Open this link in a new tab to download the file"
                      >
                        ⬇️ Download File
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          <p className="text-xs text-slate-400 mb-2">💡 Click an atom in the {structureMode === '2d' ? 'formula' : '3D viewer'} to highlight its cell in the atom table.</p>

          <div style={{ display: structureMode === '3d' ? 'block' : 'none' }} aria-hidden={structureMode !== '3d'}>
            {hasOpened3D && (
              <MDMoleculeViewer
                key={`${activeTest.structureSrc || 'no-src'}|${activeTest.structureFileName || 'no-file'}|${trajectoryFile ? trajectoryFile.name : 'no-traj-file'}|${d.trajectoryUrl || 'no-traj'}|${activeTest.smiles || 'no-smiles'}`}
                structureSrc={activeTest.structureSrc}
                structureFileData={activeTest.structureFileData}
                structureFileName={activeTest.structureFileName}
                structureFormat={activeTest.structureFormat || 'auto'}
                
                structureText={typeof organicFetch !== 'undefined' ? organicFetch.text : null}
                structureTextExt={typeof organicFetch !== 'undefined' ? organicFetch.ext : null}
                externalLoading={typeof organicFetch !== 'undefined' ? organicFetch.loading : false}
                externalError={typeof organicFetch !== 'undefined' ? organicFetch.error : null}
                
                trajectorySrc={trajNorm.url}
                trajectoryFile={trajectoryFile}
                trajectoryFallbacks={trajNorm.fallbacks}
                trajectoryFormat={d.trajectoryFormat}
                moleculeType={d.moleculeType}
                parsedSeq={d.parsedSeq}
                selectedKeys={selectedKeys}
                manualKeys={manualKeys}
                onAtomClick={handleAtomClick}
                residueOffset={residueOffset}
                atomNameMap={atomNameMap}
                labelMode={atomLabelMode}
                height={d.moleculeType === 'dna' || d.moleculeType === 'rna' ? '620px' : '520px'}
              />
            )}
          </div>

          <div style={{ display: structureMode === '2d' ? 'block' : 'none' }} aria-hidden={structureMode !== '2d'}>
            {d.moleculeType === 'organic' && activeTest.smiles ? (
               <OrganicViewer smiles={activeTest.smiles} selectedKeys={selectedKeys} onAtomClick={handleAtomClick} />
            ) : d.structure ? (
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
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

// ================= 2) DATA (MD atom table) =================
const MDImportPanel = ({ ctx, d }) => {
  const { activeTest, updateActiveTest } = ctx;
  const [pasteText, setPasteText] = useState('');
  const [report, setReport] = useState(null);
  const layerKey = d.activeLayerKey;

  const applyValues = (vals) => {
    const nv = { ...(activeTest.mdValues || {}) };
    nv[layerKey] = { ...(nv[layerKey] || {}), ...vals };
    updateActiveTest({ mdValues: nv });
  };

  const handleText = (text) => {
    const vals = {};
    let missed = 0;
    try {
      const j = JSON.parse(text);
      if (j && typeof j === 'object' && !Array.isArray(j)) Object.assign(vals, j);
    } catch {
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      lines.forEach((l) => {
        const parts = l.split(/[\t,;]/).map((c) => c.trim());
        if (parts.length >= 3) vals[`${parts[0]}-${parts[1]}`] = parts[2];
        else missed++;
      });
    }
    applyValues(vals);
    setReport({ ok: Object.keys(vals).length, missed });
  };

  return (
    <div className="mt-3 p-4 bg-sky-50 border border-sky-200 rounded-xl flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-bold text-sky-800 uppercase">Import into "{d.activeInstance ? d.activeInstance.name : 'active instance'}" · layer "{(d.layers.find((l) => l.key === layerKey) || {}).label}"</span>
      </div>
      <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)}
        placeholder={'Paste CSV/TSV or JSON, e.g.\n0-CA,0.07\n{ "0-CA": "0.07" }'}
        className="w-full h-24 border border-sky-300 rounded-lg p-2 text-xs font-mono bg-white outline-none focus:border-sky-500" />
      <button type="button" onClick={() => handleText(pasteText)} disabled={!pasteText.trim()}
        className="bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-bold px-4 py-1.5 rounded-lg text-xs w-fit">Import pasted data</button>
      {report && (
        <p className="text-xs font-bold text-emerald-700">✅ Imported {report.ok} values{report.missed > 0 ? ` · ⚠️ ${report.missed} rows skipped` : ''}</p>
      )}
    </div>
  );
};

export const MDDataSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useMDDerived(activeTest, ctx);

  const [tableMode, setTableMode] = useState(activeTest.tableMode || 'backbone');
  const [showImport, setShowImport] = useState(false);
  const [newLayerName, setNewLayerName] = useState('');
  const [newLayerUnit, setNewLayerUnit] = useState('');
  const [hiddenLayerKeys, setHiddenLayerKeys] = useState(activeTest.hiddenLayerKeys || []);

  const focusIdx = activeTest.focusIdx !== undefined ? activeTest.focusIdx : 'ALL';
  const selectedKeys = getSelectedKeys(activeTest);

  const effTableMode = d.moleculeType === 'sugar' || d.moleculeType === 'lipid' ? 'all' : tableMode;
  const activeLayer = d.layers.find((l) => l.key === d.activeLayerKey) || { label: 'MD Parameters', unit: '' };

  // Every layer's values, keyed by layer — needed so the "Unified" view can show
  // several parameter columns side by side instead of just the active layer.
  const layerValuesByKey = useMemo(() => {
    const map = {};
    d.layers.forEach((l) => { map[l.key] = getMDLayerValues(d.activeInstance, l.key); });
    return map;
  }, [d.layers, d.activeInstance]);

  const toggleLayerVisibility = (key) => {
    const next = hiddenLayerKeys.includes(key)
      ? hiddenLayerKeys.filter((k) => k !== key)
      : [...hiddenLayerKeys, key];
    setHiddenLayerKeys(next);
    updateActiveTest({ hiddenLayerKeys: next });
  };

  // Never let column selection hide every column — fall back to showing them all.
  const visibleLayers = (() => {
    const shown = d.layers.filter((l) => !hiddenLayerKeys.includes(l.key));
    return shown.length > 0 ? shown : d.layers;
  })();

  const handleCellChange = (resIdx, atom, val) => writeMDCellValue(activeTest, updateActiveTest, d.activeLayerKey, `${resIdx}-${atom}`, val);
  const handleCellChangeForLayer = (resIdx, atom, layerKey, val) => writeMDCellValue(activeTest, updateActiveTest, layerKey, `${resIdx}-${atom}`, val);

  const handleCellClick = (e, idx, atom) => {
    if (e && e.target && e.target.tagName === 'INPUT') return;
    const keys = buildKeys(idx, [atom], d.moleculeType, d.parsedSeq[idx]?.char);
    const cur = getSelectedKeys(activeTest);
    if (cur && cur.join('|') === keys.join('|')) updateActiveTest({ selectedAtomKeys: [] });
    else updateActiveTest({ selectedAtomKeys: keys });
  };

  const cellIsSelected = (idx, atom) => Boolean(selectedKeys && selectedKeys.includes(`${idx}-${atom}`));

  const addLayer = () => {
    const label = newLayerName.trim();
    if (!label) return;
    const layer = { key: `layer_${Date.now()}`, label, unit: newLayerUnit.trim() || '' };
    updateActiveTest({ parameterLayers: [...(activeTest.parameterLayers || []), layer], activeLayerKey: layer.key });
    setNewLayerName(''); setNewLayerUnit('');
  };

  const removeLayer = (key) => {
    if (key === 'md') return;
    const upd = (activeTest.parameterLayers || []).filter((l) => l.key !== key);
    updateActiveTest({ parameterLayers: upd, activeLayerKey: d.activeLayerKey === key ? 'md' : d.activeLayerKey });
  };

  const exportCSV = () => {
    // Export every parameter layer as its own column, not just the active one,
    // so the CSV is a complete record regardless of which table view is open.
    const rows = [[
      'Residue', 'Atom', 'Atom Type', 'Charge', 'Mass',
      ...d.layers.map((l) => `${l.label}${l.unit ? ` (${l.unit})` : ''}`)
    ]];
    d.estSeq.forEach((res, idx) => {
      (res.ffAtoms || []).forEach((a) => {
        const cellKey = `${idx}-${a.atom}`;
        rows.push([
          res.id, a.atom, a.type, a.charge, a.mass,
          ...d.layers.map((l) => (layerValuesByKey[l.key] || {})[cellKey] || '')
        ]);
      });
    });
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MD_${(d.activeInstance ? d.activeInstance.name : 'data').replace(/[^a-z0-9]+/gi, '_')}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const selTdCls = (isSel) => `px-3 py-1 cursor-pointer transition-colors ${isSel ? 'bg-amber-100 ring-2 ring-inset ring-amber-400' : 'hover:bg-slate-50'}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-indigo-800 uppercase">Active instance (from the top of the page):</span>
        <span className="text-sm font-black text-indigo-900">{d.activeInstance ? d.activeInstance.name : '—'}</span>
        <span className="text-[10px] font-bold bg-white border border-indigo-200 text-indigo-700 px-2 py-0.5 rounded-full">Force field: {d.ffInfo.name} {d.ffVersion}</span>
        <span className="text-[10px] font-bold bg-white border border-indigo-200 text-indigo-700 px-2 py-0.5 rounded-full">Water: {getWaterModelInfo(d.waterModel).name}</span>
        <span className="text-[10px] font-bold bg-white border border-indigo-200 text-indigo-700 px-2 py-0.5 rounded-full">Ensemble: {d.ensemble}</span>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs font-bold text-slate-500">
            Editing: <span className="text-indigo-700">{d.activeInstance ? d.activeInstance.name : '—'}</span>
            {effTableMode === 'unified'
              ? <> · <span className="text-blue-700">all parameters ({visibleLayers.length}/{d.layers.length} columns shown)</span></>
              : <> · <span className="text-blue-700">{activeLayer.label}</span></>}
          </span>
          <div className="flex gap-2 flex-wrap items-center">
            <button onClick={() => setShowImport(!showImport)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${showImport ? 'bg-sky-100 border-sky-400 text-sky-800' : 'bg-sky-50 border-sky-200 text-sky-700 hover:bg-sky-100'}`}>📥 Import data…</button>
            {d.parsedSeq.length > 0 && d.moleculeType !== 'sugar' && d.moleculeType !== 'lipid' && (
              <div className="flex bg-slate-200 p-1 rounded-lg mr-2">
                {['backbone', 'all', 'unified'].map((m) => (
                  <button key={m} onClick={() => { setTableMode(m); updateActiveTest({ tableMode: m }); }}
                    className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${effTableMode === m ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    {m === 'backbone' ? 'Backbone' : m === 'all' ? 'All Atoms' : 'Unified (all params)'}
                  </button>
                ))}
              </div>
            )}
            <button onClick={exportCSV} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 flex items-center gap-1 shadow-sm">📊 Export XLS (CSV)</button>
          </div>
        </div>
        {showImport && <MDImportPanel ctx={ctx} d={d} />}
      </div>

      {selectedKeys && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-300 rounded-lg px-3 py-1.5 text-xs font-bold text-amber-800 w-fit">
          🎯 Selected: {selectionLabel(d, selectedKeys)}
          <button onClick={() => updateActiveTest({ selectedAtomKeys: [] })} className="ml-1 text-amber-600 hover:text-red-600 font-black" title="Clear selection">✕</button>
        </div>
      )}

      {d.parsedSeq.length === 0 ? (
        <div className="text-center py-10 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300">
          Enter a sequence / select a molecule (in Experiment Setup) to generate the atom table.
        </div>
      ) : effTableMode === 'backbone' ? (
        <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-lg max-h-[500px]">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-100 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-4 py-3 font-black border-b border-slate-200 w-20 text-center">Res</th>
                {d.moleculeType === 'protein' && <th className="px-2 py-2 font-bold border-b border-slate-200 text-center">SS</th>}
                {d.ffBackbone.map((a) => (
                  <th key={a.atom} className="px-3 py-2 font-bold text-blue-700 border-b border-slate-200 bg-blue-50/50">
                    {a.atom} {activeLayer.unit ? `(${activeLayer.unit})` : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {d.estSeq.map((res, idx) => {
                if (focusIdx !== 'ALL' && focusIdx !== idx) return null;
                return (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2 font-black text-slate-700 text-center bg-slate-50 border-r border-slate-100">{res.id}</td>
                    {d.moleculeType === 'protein' && (
                      <td className="px-2 py-1 text-center">
                        <span className="inline-block w-6 h-6 leading-6 rounded-full text-xs font-black text-white" style={{ backgroundColor: SS_META[res.ssLetter].color }}>{res.ssLetter}</span>
                      </td>
                    )}
                    {d.ffBackbone.map((a) => {
                      const key = `${idx}-${a.atom}`;
                      const isSel = cellIsSelected(idx, a.atom);
                      const hasVal = parseMDValue(d.activeValues[key]) !== null;
                      return (
                        <td key={a.atom} className={selTdCls(isSel)} onClick={(e) => handleCellClick(e, idx, a.atom)} title={`${a.desc} · type ${a.type} · charge ${a.charge}`}>
                          <input type="text" value={d.activeValues[key] || ''} onChange={(e) => handleCellChange(idx, a.atom, e.target.value)}
                            className={`w-full border rounded px-2 py-1 outline-none text-center text-xs font-mono ${hasVal ? 'border-green-400 bg-green-50 text-green-700 font-bold' : 'border-slate-200 focus:border-blue-500'}`} placeholder="—" />
                          <div className="text-[11px] font-bold text-purple-600 text-center mt-0.5">{a.type}</div>
                          <div className="text-[10px] text-slate-500 text-center">q={a.charge} · m={a.mass}</div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : effTableMode === 'unified' ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase mr-1">Columns to show:</span>
            {d.layers.map((l) => {
              const isVisible = !hiddenLayerKeys.includes(l.key);
              return (
                <label key={l.key}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border cursor-pointer transition-colors select-none ${isVisible ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-300 text-slate-400'}`}>
                  <input type="checkbox" checked={isVisible} onChange={() => toggleLayerVisibility(l.key)} className="accent-blue-600" />
                  {l.label}{l.unit ? ` (${l.unit})` : ''}
                </label>
              );
            })}
          </div>

          <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-lg max-h-[500px]">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-500 uppercase bg-slate-100 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-4 py-3 font-black border-b border-slate-200 w-24 text-center">Res</th>
                  <th className="px-3 py-2 font-bold border-b border-slate-200">Atom</th>
                  <th className="px-3 py-2 font-bold border-b border-slate-200">Type</th>
                  <th className="px-3 py-2 font-bold border-b border-slate-200">Charge</th>
                  <th className="px-3 py-2 font-bold border-b border-slate-200">Mass</th>
                  {visibleLayers.map((l) => (
                    <th key={l.key} className="px-3 py-2 font-bold text-blue-700 border-b border-slate-200 bg-blue-50/50">
                      {l.label}{l.unit ? ` (${l.unit})` : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {d.estSeq.map((res, idx) => {
                  if (focusIdx !== 'ALL' && focusIdx !== idx) return null;
                  return (res.ffAtoms || []).map((a, aIdx) => {
                    const cellKey = `${idx}-${a.atom}`;
                    const isSel = cellIsSelected(idx, a.atom);
                    return (
                      <tr key={cellKey} className="hover:bg-slate-50 transition-colors">
                        {aIdx === 0 && <td rowSpan={(res.ffAtoms || []).length} className="px-4 py-2 font-black text-slate-700 text-center bg-slate-50 border-r border-slate-100 align-top">{res.id}</td>}
                        <td className="px-3 py-1.5 font-bold text-slate-600">{a.atom}</td>
                        <td className="px-3 py-1.5 text-purple-700 font-bold">{a.type}</td>
                        <td className="px-3 py-1.5 font-mono text-slate-600">{a.charge}</td>
                        <td className="px-3 py-1.5 font-mono text-slate-600">{a.mass}</td>
                        {visibleLayers.map((l) => {
                          const val = (layerValuesByKey[l.key] || {})[cellKey] || '';
                          const hasVal = parseMDValue(val) !== null;
                          return (
                            <td key={l.key} className={selTdCls(isSel)} onClick={(e) => handleCellClick(e, idx, a.atom)}>
                              <input type="text" value={val} onChange={(e) => handleCellChangeForLayer(idx, a.atom, l.key, e.target.value)}
                                className={`w-full border rounded px-2 py-1 outline-none text-xs font-mono max-w-[140px] ${hasVal ? 'border-green-400 bg-green-50 text-green-700 font-bold' : 'border-slate-200 focus:border-blue-500'}`} placeholder="—" />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-lg max-h-[500px]">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-100 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-4 py-3 font-black border-b border-slate-200 w-24 text-center">Res</th>
                <th className="px-3 py-2 font-bold border-b border-slate-200">Atom</th>
                <th className="px-3 py-2 font-bold border-b border-slate-200">Type</th>
                <th className="px-3 py-2 font-bold border-b border-slate-200">Charge</th>
                <th className="px-3 py-2 font-bold border-b border-slate-200">Mass</th>
                <th className="px-3 py-2 font-bold border-b border-slate-200">Value {activeLayer.unit ? `(${activeLayer.unit})` : ''}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {d.estSeq.map((res, idx) => {
                if (focusIdx !== 'ALL' && focusIdx !== idx) return null;
                return (res.ffAtoms || []).map((a, aIdx) => {
                  const key = `${idx}-${a.atom}`;
                  const isSel = cellIsSelected(idx, a.atom);
                  const hasVal = parseMDValue(d.activeValues[key]) !== null;
                  return (
                    <tr key={key} className="hover:bg-slate-50 transition-colors">
                      {aIdx === 0 && <td rowSpan={(res.ffAtoms || []).length} className="px-4 py-2 font-black text-slate-700 text-center bg-slate-50 border-r border-slate-100 align-top">{res.id}</td>}
                      <td className="px-3 py-1.5 font-bold text-slate-600">{a.atom}</td>
                      <td className="px-3 py-1.5 text-purple-700 font-bold">{a.type}</td>
                      <td className="px-3 py-1.5 font-mono text-slate-600">{a.charge}</td>
                      <td className="px-3 py-1.5 font-mono text-slate-600">{a.mass}</td>
                      <td className={selTdCls(isSel)} onClick={(e) => handleCellClick(e, idx, a.atom)}>
                        <input type="text" value={d.activeValues[key] || ''} onChange={(e) => handleCellChange(idx, a.atom, e.target.value)}
                          className={`w-full border rounded px-2 py-1 outline-none text-xs font-mono max-w-[140px] ${hasVal ? 'border-green-400 bg-green-50 text-green-700 font-bold' : 'border-slate-200 focus:border-blue-500'}`} placeholder="—" />
                      </td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm mt-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <label className="text-xs font-bold text-slate-600 uppercase">🗂️ Parameter Layer (atom-table data type)</label>
          <span className="text-[9px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded">Switch between MD Parameters & user-defined per-atom layers</span>
        </div>
        <div className="flex flex-wrap gap-2 items-center mb-3">
          {d.layers.map((l) => (
            <div key={l.key} className="inline-flex items-center">
              <button type="button" onClick={() => updateActiveTest({ activeLayerKey: l.key })}
                className={`px-3 py-1.5 rounded-l-lg text-xs font-bold border transition-colors ${d.activeLayerKey === l.key ? 'bg-blue-600 border-blue-700 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
                {l.label}{l.unit ? ` (${l.unit})` : ''}
              </button>
              {!l.builtin ? (
                <button type="button" onClick={() => removeLayer(l.key)}
                  className={`px-2 py-1.5 rounded-r-lg border border-l-0 text-xs font-black ${d.activeLayerKey === l.key ? 'bg-blue-600 border-blue-700 text-blue-200 hover:text-white' : 'bg-white border-slate-300 text-slate-400 hover:text-red-500'}`} title="Delete parameter">×</button>
              ) : (
                <span className="px-2 py-1.5 rounded-r-lg border border-l-0 bg-slate-100 border-slate-300 text-slate-400 text-xs">🔒</span>
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">New parameter name</label>
            <input type="text" value={newLayerName} onChange={(e) => setNewLayerName(e.target.value)} placeholder="e.g. Order Param, B-factor" className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-56 bg-white" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Unit</label>
            <input type="text" value={newLayerUnit} onChange={(e) => setNewLayerUnit(e.target.value)} placeholder="e.g. Å²" className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-24 bg-white" />
          </div>
          <button type="button" onClick={addLayer} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-sm shadow-sm h-fit">+ Add Parameter Layer</button>
        </div>
      </div>
    </div>
  );
};

// ================= 3) ANALYSIS (RMSD / RMSF / Rg / SASA / Energy) =================
const MDAnalysisChart = ({ title, data, dataKey = 'value', xKey = 'time', color, cfg, yLabel, xLabel, chartType = 'line' }) => {
  const fSize = cfg.fontSize || 12;
  const aspect = cfg.aspect || 1.8;
  const lineColor = color || '#3b82f6';

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-2 flex flex-col relative">
      <div className="flex justify-between items-center mb-1">
        <h5 className="text-[12px] font-bold text-slate-700">{title}</h5>
      </div>
      <div className="flex-1 w-full" style={{ aspectRatio: String(aspect), minHeight: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'bar' ? (
            <BarChart data={data} margin={MD_CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey={xKey} tick={{ fontSize: fSize }} label={{ value: xLabel, position: 'insideBottom', offset: -25, fill: '#64748b', fontSize: fSize + 1 }} />
              <YAxis tick={{ fontSize: fSize }} label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: -20, fill: '#64748b', fontSize: fSize + 1 }} />
              <Tooltip />
              <Bar dataKey={dataKey} isAnimationActive={false}>
                {data.map((entry, index) => <Cell key={index} fill={entry.fill || lineColor} />)}
              </Bar>
            </BarChart>
          ) : (
            <LineChart data={data} margin={MD_CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={xKey} type="number" domain={[mdDom(cfg.xMin) ?? 'auto', mdDom(cfg.xMax) ?? 'auto']} tick={{ fontSize: fSize }}
                label={{ value: xLabel, position: 'insideBottom', offset: -25, fill: '#64748b', fontSize: fSize + 1 }} />
              <YAxis type="number" domain={[mdDom(cfg.yMin) ?? 'auto', mdDom(cfg.yMax) ?? 'auto']} tick={{ fontSize: fSize }}
                label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: -20, fill: '#64748b', fontSize: fSize + 1 }} />
              <Tooltip />
              <Line type="monotone" dataKey={dataKey} stroke={lineColor} strokeWidth={cfg.lineThickness || 2} strokeDasharray={mdLineDash(cfg.lineStyle)} dot={false} isAnimationActive={false} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export const MDAnalysisSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useMDDerived(activeTest, ctx);

  const cfg = { ...DEFAULT_MD_CHART_STYLE, ...(activeTest.mdAnalysisCfg || {}) };
  const setCfg = (patch) => updateActiveTest({ mdAnalysisCfg: { ...cfg, ...patch } });
  const [showCfg, setShowCfg] = useState(false);

  const nFrames = parseMDValue(activeTest.mdNumFrames) || 500;
  const nResidues = Math.max(1, d.parsedSeq.length || 20);

  const rmsd = useMemo(() => generateRMSDData(nFrames), [nFrames]);
  const rmsf = useMemo(() => generateRMSFData(nResidues).map((r) => ({ ...r, fill: r.value > 0.25 ? '#ef4444' : '#3b82f6' })), [nResidues]);
  const rg = useMemo(() => generateRgData(nFrames), [nFrames]);
  const sasa = useMemo(() => generateSASAData(nFrames), [nFrames]);
  const energy = useMemo(() => generateEnergyData(nFrames), [nFrames]);

  if (d.parsedSeq.length === 0) {
    return <div className="text-center py-8 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed">Enter a sequence (in Experiment Setup) to enable analysis.</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap bg-white border border-slate-200 rounded-lg px-3 py-2 w-fit">
        <button type="button" onClick={() => setShowCfg(!showCfg)}
          className={`font-bold py-1.5 px-3 rounded-lg text-xs border transition-colors ${showCfg ? 'bg-slate-200 border-slate-400 text-slate-900' : 'bg-white border-slate-300 text-slate-800 hover:bg-slate-50'}`}>⚙️ Chart Parameters</button>
        <div className="flex items-center gap-2 border-l border-slate-300 pl-3 ml-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Frames</label>
          <input type="number" value={activeTest.mdNumFrames || 500} onChange={(e) => updateActiveTest({ mdNumFrames: e.target.value })}
            className="border border-slate-300 rounded-md px-2 py-1 text-xs w-20 outline-none focus:border-blue-500" />
        </div>
        <span className="text-[10px] text-slate-400">Curves are simulated until a real trajectory analysis is attached.</span>
      </div>

      {showCfg && (
        <div className="p-4 bg-white border border-slate-300 rounded-xl grid grid-cols-2 md:grid-cols-4 gap-3 shadow-sm">
          <div className="flex flex-col gap-1"><label className="text-[10px] font-bold text-slate-600">Font size (px)</label>
            <input type="number" value={cfg.fontSize} onChange={(e) => setCfg({ fontSize: Number(e.target.value) || 12 })} className="border border-slate-300 rounded-md p-1.5 text-xs outline-none" /></div>
          <div className="flex flex-col gap-1"><label className="text-[10px] font-bold text-slate-600">Aspect ratio (W÷H)</label>
            <input type="number" step="0.1" value={cfg.aspect} onChange={(e) => setCfg({ aspect: Number(e.target.value) || 1.8 })} className="border border-slate-300 rounded-md p-1.5 text-xs outline-none" /></div>
          <div className="flex flex-col gap-1"><label className="text-[10px] font-bold text-slate-600">Line style</label>
            <select value={cfg.lineStyle} onChange={(e) => setCfg({ lineStyle: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs bg-white outline-none">
              <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
            </select></div>
          <div className="flex flex-col gap-1"><label className="text-[10px] font-bold text-slate-600">Line thickness</label>
            <input type="number" step="0.5" value={cfg.lineThickness} onChange={(e) => setCfg({ lineThickness: Number(e.target.value) || 2 })} className="border border-slate-300 rounded-md p-1.5 text-xs outline-none" /></div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MDAnalysisChart title="RMSD (backbone)" data={rmsd} dataKey="value" xKey="time" color="#3b82f6" cfg={cfg} yLabel="RMSD (nm)" xLabel="Time (ns)" />
        <MDAnalysisChart title="RMSF per residue" data={rmsf} dataKey="value" xKey="residue" color="#3b82f6" cfg={cfg} yLabel="RMSF (nm)" xLabel="Residue" chartType="bar" />
        <MDAnalysisChart title="Radius of Gyration (Rg)" data={rg} dataKey="value" xKey="time" color="#22c55e" cfg={cfg} yLabel="Rg (nm)" xLabel="Time (ns)" />
        <MDAnalysisChart title="SASA" data={sasa} dataKey="value" xKey="time" color="#f59e0b" cfg={cfg} yLabel="SASA (nm²)" xLabel="Time (ns)" />
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-2 flex flex-col relative">
        <h5 className="text-[12px] font-bold text-slate-700 mb-1">Energy</h5>
        <div className="w-full" style={{ aspectRatio: String(cfg.aspect || 1.8), minHeight: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={energy} margin={MD_CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" type="number" tick={{ fontSize: cfg.fontSize }} label={{ value: 'Time (ns)', position: 'insideBottom', offset: -25, fill: '#64748b', fontSize: cfg.fontSize + 1 }} />
              <YAxis tick={{ fontSize: cfg.fontSize }} label={{ value: 'Energy (kJ/mol)', angle: -90, position: 'insideLeft', offset: -20, fill: '#64748b', fontSize: cfg.fontSize + 1 }} />
              <Tooltip />
              <Legend verticalAlign="top" wrapperStyle={{ fontSize: cfg.fontSize }} />
              <Line type="monotone" dataKey="potential" name="Potential" stroke="#ef4444" strokeWidth={cfg.lineThickness} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="kinetic" name="Kinetic" stroke="#3b82f6" strokeWidth={cfg.lineThickness} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="total" name="Total" stroke="#22c55e" strokeWidth={cfg.lineThickness} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

// ================= 4) SIMULATION PARAMETERS =================
export const MDSimulationParamsSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useMDDerived(activeTest, ctx);

  const Sel = ({ label, value, onChange, options }) => (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-bold text-slate-500 uppercase">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-semibold">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );

  const Num = ({ label, value, onChange, step = 1, unit }) => (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-bold text-slate-500 uppercase">{label}{unit ? ` (${unit})` : ''}</label>
      <input type="number" step={step} value={value ?? ''} onChange={(e) => onChange(e.target.value)}
        className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500" />
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          {MD_SIMULATION_PHASES.map((ph) => {
            const active = (activeTest.simPhase || 'production') === ph.key;
            return (
              <button key={ph.key} onClick={() => updateActiveTest({ simPhase: ph.key })}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors flex items-center gap-1.5 ${active ? 'bg-blue-600 border-blue-700 text-white shadow' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
                <span>{ph.icon}</span>{ph.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Force Field</label>
          <div className="flex gap-1">
            <select value={d.ffKey} onChange={(e) => updateActiveTest({ forceField: e.target.value, forceFieldVersion: '' })} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-semibold">
              {Object.entries(FORCE_FIELDS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
            </select>
            <select value={d.ffVersion} onChange={(e) => updateActiveTest({ forceFieldVersion: e.target.value })} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
              {getFFVersions(d.ffKey).map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>

        <Sel label="Water Model" value={d.waterModel} onChange={(v) => updateActiveTest({ waterModel: v })} options={Object.entries(WATER_MODELS).map(([k, v]) => [k, `${v.name} (${v.sites}-site)`])} />
        
        <Sel label="Ensemble" value={d.ensemble} onChange={(v) => updateActiveTest({ ensemble: v })} options={MD_ENSEMBLES.map((e) => [e.key, e.label])} />
        <Sel label="Integrator" value={d.integrator} onChange={(v) => updateActiveTest({ integrator: v })} options={MD_INTEGRATORS.map((i) => [i.key, i.label])} />
        <Num label="Time step" value={d.timestep} onChange={(v) => updateActiveTest({ timestep: v })} step={0.5} unit="fs" />
        <Num label="Number of steps" value={d.nSteps} onChange={(v) => updateActiveTest({ nSteps: v })} step={1000} />
        <Num label="Temperature" value={d.temperature} onChange={(v) => updateActiveTest({ simTemperature: v })} step={1} unit="K" />
        <Num label="Pressure" value={d.pressure} onChange={(v) => updateActiveTest({ simPressure: v })} step={0.1} unit="bar" />
        <Sel label="Thermostat" value={d.thermostat} onChange={(v) => updateActiveTest({ thermostat: v })} options={MD_THERMOSTATS.map((t) => [t.key, t.label])} />
        <Sel label="Barostat" value={d.barostat} onChange={(v) => updateActiveTest({ barostat: v })} options={MD_BAROSTATS.map((b) => [b.key, b.label])} />
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-600 flex flex-col gap-2">
        <p><b>Force field:</b> {d.ffInfo.name} {d.ffVersion} · <b>Water model:</b> {getWaterModelInfo(d.waterModel).name}</p>
        <p><b>Ensemble:</b> {d.ensemble} · <b>Integrator:</b> {d.integrator} · <b>Δt:</b> {d.timestep} fs · <b>Steps:</b> {d.nSteps} (≈ {((parseMDValue(d.timestep) || 0) * (parseMDValue(d.nSteps) || 0) / 1e6).toFixed(3)} ns)</p>
        <p><b>Thermostat:</b> {d.thermostat} · <b>Barostat:</b> {d.barostat} · <b>T:</b> {d.temperature} K · <b>P:</b> {d.pressure} bar</p>
      </div>
    </div>
  );
};

// ================= ALL =================

export const Setup = MDExperimentSetupSection;
export const Data = MDDataSection;
export const Simulations = MDSimulationParamsSection;
export const Analysis = MDAnalysisSection;

// ================= NOTEBOOK EXTRA =================
export const NotebookExtra = ({ ctx, checkId }) => {
  const { activeTest } = ctx;
  const d = useMDDerived(activeTest, ctx);

  if (checkId === 'cond') {
    return `<p style="font-size:12px;color:#475569;margin-bottom:8px;"><b>MD Setup:</b> Force field ${d.ffInfo.name} ${d.ffVersion} | Water ${getWaterModelInfo(d.waterModel).name} | Ensemble ${d.ensemble} | Integrator ${d.integrator} | Δt ${d.timestep} fs | ${d.nSteps} steps | T ${d.temperature} K</p>`;
  }

  if (checkId === 'seq') {
    return `<p style="font-size:12px;color:#475569;margin-bottom:12px;"><b>${d.typeLabel}:</b> <span style="font-family:monospace;background:#e2e8f0;padding:2px 4px;border-radius:4px;">${d.isPolymer ? activeTest.proteinSequence || 'N/A' : d.parsedSeq[0]?.name || 'N/A'}</span></p>`;
  }

  if (checkId === 'formula' && d.structure) {
    return `<div style="margin-bottom:12px;">${elementsToSVG(d.structure, 300)}</div>`;
  }

  if (checkId === 'table' && d.parsedSeq.length > 0) {
    let html = `<table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:11px;text-align:left;background:white;"><tr style="background-color:#f1f5f9;"><th style="padding:6px;border:1px solid #cbd5e1;">Residue</th><th style="padding:6px;border:1px solid #cbd5e1;">Atom</th><th style="padding:6px;border:1px solid #cbd5e1;">Type</th><th style="padding:6px;border:1px solid #cbd5e1;">Charge</th></tr>`;
    d.estSeq.forEach((res) => {
      (res.ffAtoms || []).forEach((a) => {
        html += `<tr><td style="padding:6px;border:1px solid #e2e8f0;"><b>${res.id}</b></td><td style="padding:6px;border:1px solid #e2e8f0;">${a.atom}</td><td style="padding:6px;border:1px solid #e2e8f0;">${a.type}</td><td style="padding:6px;border:1px solid #e2e8f0;">${a.charge}</td></tr>`;
      });
    });
    html += `</table>`;
    return html;
  }

  if (checkId === 'trajectory' && d.trajectoryUrl) {
    return `<p style="font-size:12px;color:#475569;"><b>Trajectory:</b> <a href="${d.trajectoryUrl}" style="color:#2563eb;">${d.trajectoryUrl}</a> (${getTrajectoryFormatInfo(d.trajectoryFormat).label})</p>`;
  }

  return '';
};
// ================= NOTEBOOK HTML BUILDER =================
export const buildNotebookHtml = (ctx, checked) => {
  let html = '';
  ['cond', 'seq', 'formula', 'table', 'trajectory'].forEach((id) => {
    if (checked && checked[id]) {
      html += NotebookExtra({ ctx, checkId: id });
    }
  });
  return html;
};