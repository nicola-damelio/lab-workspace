import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell
} from 'recharts';
import { parseSimulationParameters } from './MDData';
import {
  CONTACT_DEFAULTS, parseTopology, computeContactRDF, demoFrames,
  resolveFrameSource, AWK_PALETTE
} from './MDMembraneContacts';
import { computeOrderAndDensity, parseChargeMap } from './MDMembraneProfiles';
export { parseSimulationParameters };   
import NMRMoleculeViewer from './NMRMoleculeViewer';
import {
  computeSecondaryStructure, SS_CODE_ORDER, SS_COLORS, SS_GROUP_COLORS
} from './MDSecondaryStructure';

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
              
<NMRMoleculeViewer
  key={`${activeTest.structureSrc || 'no-src'}|${activeTest.structureFileName || 'no-file'}|${trajectoryFile ? trajectoryFile.name : 'no-traj-file'}|${d.trajectoryUrl || 'no-traj'}|${activeTest.smiles || 'no-smiles'}`}
  src={activeTest.structureSrc}
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




// ================= MD PER ATOM PLOT SECTION =================
const MD_PAP_COLORS = ['#3b82f6','#8b5cf6','#f59e0b','#22c55e','#ef4444','#0ea5e9','#ec4899','#14b8a6','#f97316','#6366f1'];

const MDPerAtomChartPanel = ({ d, chart, updateChart, removeChart, activeTest }) => {
  const [atomSearch, setAtomSearch] = useState('');
  const [showCfg, setShowCfg] = useState(false);
  const layerKey = chart.layerKey || 'md';
  const atoms = chart.atoms || [];
  const cfg = { aspect: 2.5, fontSize: 11, ...(chart.style || {}) };
  const setC = (p) => updateChart(chart.id, p);
  const setCfg = (p) => updateChart(chart.id, { style: { ...cfg, ...p } });

  const layer = d.layers.find(l => l.key === layerKey) || d.layers[0];
  // Collect values from all instances (average across instances, or active instance only)
  const valMap = getMDLayerValues(d.activeInstance, layerKey);

  const atomMeta = atoms.map((k, i) => ({
    key: k,
    label: d.atomOptions.find(o => o.key === k)?.label.split(' ').slice(1).join(' ') || k.split('-').slice(1).join('-'),
    color: MD_PAP_COLORS[i % MD_PAP_COLORS.length],
  }));

  const residueMap = {};
  atoms.forEach(atomKey => {
    const raw = valMap[atomKey];
    const val = raw !== undefined && raw !== '' ? parseFloat(raw) : NaN;
    if (isNaN(val)) return;
    const resIdx = atomKey.split('-')[0];
    const res = d.estSeq[Number(resIdx)];
    if (!res) return;
    if (!residueMap[res.id]) residueMap[res.id] = { label: res.id };
    residueMap[res.id][atomKey] = val;
  });
  const chartData = Object.values(residueMap).filter(r => Object.keys(r).length > 1);
  const filtered = d.atomOptions.filter(o => !atomSearch.trim() || o.label.toLowerCase().includes(atomSearch.toLowerCase()));
  const toggleAtom = (k) => setC({ atoms: atoms.includes(k) ? atoms.filter(a => a !== k) : [...atoms, k] });

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <input type="text" value={chart.title || ''} onChange={e => setC({ title: e.target.value })}
          placeholder="Chart title…" className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-700 outline-none focus:border-blue-500 bg-transparent flex-1 min-w-[140px]" />
        <div className="flex gap-2">
          <button onClick={() => setShowCfg(!showCfg)} className="text-xs bg-slate-100 border border-slate-300 px-2 py-1 rounded font-bold text-slate-600 hover:bg-slate-200">⚙️</button>
          <button onClick={() => removeChart(chart.id)} className="text-xs bg-red-50 border border-red-200 px-2 py-1 rounded font-bold text-red-600 hover:bg-red-100">🗑</button>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold text-slate-500 uppercase">Parameter:</span>
        {d.layers.map(l => (
          <button key={l.key} onClick={() => setC({ layerKey: l.key })}
            className={`text-xs font-bold px-2.5 py-1 rounded-full border transition-colors ${l.key === layerKey ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
            {l.label}{l.unit ? ` (${l.unit})` : ''}
          </button>
        ))}
      </div>
      {showCfg && (
        <div className="flex gap-4 flex-wrap">
          <label className="text-[10px] font-bold text-slate-500 flex flex-col gap-1">Aspect<input type="number" step="0.1" value={cfg.aspect} onChange={e=>setCfg({aspect:+e.target.value||2.5})} className="border border-slate-300 rounded px-2 py-1 text-xs w-20" /></label>
          <label className="text-[10px] font-bold text-slate-500 flex flex-col gap-1">Font<input type="number" value={cfg.fontSize} onChange={e=>setCfg({fontSize:+e.target.value||11})} className="border border-slate-300 rounded px-2 py-1 text-xs w-16" /></label>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-slate-500 uppercase">Atoms ({atoms.length} selected):</span>
          <input type="text" value={atomSearch} onChange={e => setAtomSearch(e.target.value)} placeholder="Filter…" className="border border-slate-200 rounded px-2 py-1 text-xs flex-1 outline-none focus:border-blue-400" />
          {atoms.length > 0 && <button onClick={() => setC({ atoms: [] })} className="text-xs text-red-500 hover:underline font-bold">Clear</button>}
        </div>
        <div className="max-h-28 overflow-y-auto flex flex-wrap gap-1 bg-slate-50 rounded p-2">
          {filtered.map(o => (
            <button key={o.key} onClick={() => toggleAtom(o.key)}
              className={`text-[10px] font-bold px-2 py-0.5 rounded border transition-colors ${atoms.includes(o.key) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'}`}>
              {o.label}
            </button>
          ))}
        </div>
        {atoms.length > 0 && (
          <div className="flex flex-wrap gap-1">{atomMeta.map(m => (
            <span key={m.key} style={{ background: m.color }} className="text-[10px] text-white font-bold px-2 py-0.5 rounded-full">{m.label}</span>
          ))}</div>
        )}
      </div>
      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" aspect={cfg.aspect}>
          <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 16, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: cfg.fontSize }} />
            <YAxis tick={{ fontSize: cfg.fontSize }} label={{ value: layer?.unit || '', angle: -90, position: 'insideLeft', style: { fontSize: cfg.fontSize } }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: cfg.fontSize }} />
            {atomMeta.map(m => <Bar key={m.key} dataKey={m.key} name={m.label} fill={m.color} isAnimationActive={false} />)}
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="bg-slate-50 border border-dashed border-slate-200 rounded-lg p-4 text-center text-xs text-slate-400">
          {atoms.length === 0 ? 'Select atoms above to plot.' : 'No data for selected atoms in this layer.'}
        </div>
      )}
    </div>
  );
};

const MDPerAtomPlotSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useMDDerived(activeTest, ctx);
  const charts = Array.isArray(activeTest.mdPerAtomCharts) ? activeTest.mdPerAtomCharts : [];
  const addChart = () => {
    const n = charts.length + 1;
    const id = `mdpap_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    updateActiveTest({ mdPerAtomCharts: [...charts, { id, title: `Chart ${n}`, layerKey: 'md', atoms: [], style: {} }] });
  };
  const updateChart = (id, patch) => updateActiveTest({ mdPerAtomCharts: charts.map(c => c.id === id ? { ...c, ...patch } : c) });
  const removeChart = (id) => updateActiveTest({ mdPerAtomCharts: charts.filter(c => c.id !== id) });

  if (d.parsedSeq.length === 0) return <div className="text-center py-8 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed">Enter a sequence in Experiment Setup to enable per-atom charts.</div>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">Per-Atom Parameter Charts</span>
        <button onClick={addChart} className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg shadow-sm flex items-center gap-1.5 transition-colors">+ Add Chart</button>
      </div>
      {charts.length === 0 && (
        <div className="bg-slate-50 border border-dashed border-slate-200 rounded-lg p-4 text-center text-xs text-slate-400">
          Click "+ Add Chart" to plot any MD parameter (RMSD, charge, mass…) per atom/residue.
        </div>
      )}
      {charts.map(chart => (
        <MDPerAtomChartPanel key={chart.id} d={d} chart={chart} updateChart={updateChart} removeChart={removeChart} activeTest={activeTest} />
      ))}
    </div>
  );
};

// ================= MD CONDITION PLOT SECTION =================
// Plot MD parameter values vs. simulation conditions (across instances)
const MD_COND_FIELDS = [
  { key: 'simTemperature', label: 'Temperature (K)' },
  { key: 'simPressure', label: 'Pressure (bar)' },
  { key: 'timestep', label: 'Timestep (fs)' },
  { key: 'nSteps', label: 'Steps' },
];

const getMDCondValue = (inst, key) => inst && inst.values ? (inst.values[key] ?? '') : '';

const MDConditionPlotPanel = ({ d, chart, updateChart, removeChart, activeTest }) => {
  const [atomSearch, setAtomSearch] = useState('');
  const atoms = chart.atoms || [];
  const layerKey = chart.layerKey || 'md';
  const xField = chart.xField || 'simTemperature';
  const cfg = { aspect: 2.5, fontSize: 11, ...(chart.style || {}) };
  const setC = (p) => updateChart(chart.id, p);
  const layer = d.layers.find(l => l.key === layerKey) || d.layers[0];
  const filtered = d.atomOptions.filter(o => !atomSearch.trim() || o.label.toLowerCase().includes(atomSearch.toLowerCase()));
  const toggleAtom = (k) => setC({ atoms: atoms.includes(k) ? atoms.filter(a => a !== k) : [...atoms, k] });

  // Build line chart data: for each instance, get x = condition value, y = atom value
  const series = atoms.map((ak, i) => {
    const pts = d.instances
      .map(inst => {
        const vals = getMDLayerValues(inst, layerKey);
        const y = vals[ak] !== undefined && vals[ak] !== '' ? parseFloat(vals[ak]) : NaN;
        const xRaw = inst.values?.[xField] ?? activeTest[xField];
        const x = xRaw !== undefined && xRaw !== '' ? parseFloat(xRaw) : NaN;
        return { x, y, name: inst.name };
      })
      .filter(p => !isNaN(p.x) && !isNaN(p.y))
      .sort((a, b) => a.x - b.x);
    return {
      key: ak,
      label: d.atomOptions.find(o => o.key === ak)?.label.split(' ').slice(1).join(' ') || ak,
      color: MD_PAP_COLORS[i % MD_PAP_COLORS.length],
      pts,
    };
  }).filter(s => s.pts.length > 0);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <input type="text" value={chart.title || ''} onChange={e => setC({ title: e.target.value })}
          placeholder="Plot title…" className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-700 outline-none focus:border-blue-500 bg-transparent flex-1 min-w-[140px]" />
        <button onClick={() => removeChart(chart.id)} className="text-xs bg-red-50 border border-red-200 px-2 py-1 rounded font-bold text-red-600 hover:bg-red-100">🗑</button>
      </div>
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Parameter (Y)</label>
          <select value={layerKey} onChange={e => setC({ layerKey: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none">
            {d.layers.map(l => <option key={l.key} value={l.key}>{l.label}{l.unit ? ` (${l.unit})` : ''}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">X axis (Condition)</label>
          <select value={xField} onChange={e => setC({ xField: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none">
            {MD_COND_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-slate-500 uppercase">Atoms ({atoms.length} selected):</span>
          <input type="text" value={atomSearch} onChange={e => setAtomSearch(e.target.value)} placeholder="Filter…" className="border border-slate-200 rounded px-2 py-1 text-xs flex-1 outline-none focus:border-blue-400" />
          {atoms.length > 0 && <button onClick={() => setC({ atoms: [] })} className="text-xs text-red-500 hover:underline font-bold">Clear</button>}
        </div>
        <div className="max-h-24 overflow-y-auto flex flex-wrap gap-1 bg-slate-50 rounded p-2">
          {filtered.map(o => (
            <button key={o.key} onClick={() => toggleAtom(o.key)}
              className={`text-[10px] font-bold px-2 py-0.5 rounded border transition-colors ${atoms.includes(o.key) ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'}`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {series.length > 0 ? (
        <ResponsiveContainer width="100%" aspect={cfg.aspect}>
          <LineChart margin={{ top: 8, right: 16, bottom: 24, left: 16 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="x" type="number" allowDuplicatedCategory={false} tick={{ fontSize: cfg.fontSize }}
              label={{ value: MD_COND_FIELDS.find(f => f.key === xField)?.label || xField, position: 'insideBottom', offset: -16, fill: '#64748b', fontSize: cfg.fontSize }} />
            <YAxis tick={{ fontSize: cfg.fontSize }} label={{ value: layer?.unit || '', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: cfg.fontSize }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: cfg.fontSize }} />
            {series.map(s => (
              <Line key={s.key} data={s.pts} dataKey="y" name={s.label} stroke={s.color} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="bg-slate-50 border border-dashed border-slate-200 rounded-lg p-4 text-center text-xs text-slate-400">
          {atoms.length === 0 ? 'Select atoms above.' : d.instances.length < 2 ? 'Add multiple simulation instances with different conditions to compare.' : 'No numeric data for selected atoms across instances.'}
        </div>
      )}
    </div>
  );
};

const MDConditionPlotSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useMDDerived(activeTest, ctx);
  const charts = Array.isArray(activeTest.mdConditionCharts) ? activeTest.mdConditionCharts : [];
  const addChart = () => {
    const n = charts.length + 1;
    const id = `mdcp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    updateActiveTest({ mdConditionCharts: [...charts, { id, title: `Condition Plot ${n}`, layerKey: 'md', xField: 'simTemperature', atoms: [], style: {} }] });
  };
  const updateChart = (id, patch) => updateActiveTest({ mdConditionCharts: charts.map(c => c.id === id ? { ...c, ...patch } : c) });
  const removeChart = (id) => updateActiveTest({ mdConditionCharts: charts.filter(c => c.id !== id) });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">Condition Plots</span>
          <p className="text-[10px] text-slate-400 mt-0.5">Plot MD parameter values vs. simulation conditions across instances.</p>
        </div>
        <button onClick={addChart} className="text-xs bg-purple-600 hover:bg-purple-700 text-white font-bold px-3 py-1.5 rounded-lg shadow-sm flex items-center gap-1.5 transition-colors">+ Add Plot</button>
      </div>
      {charts.length === 0 && (
        <div className="bg-slate-50 border border-dashed border-slate-200 rounded-lg p-4 text-center text-xs text-slate-400">
          Click "+ Add Plot" to compare parameter values across simulation instances (different temperatures, pressures…).
        </div>
      )}
      {charts.map(chart => (
        <MDConditionPlotPanel key={chart.id} d={d} chart={chart} updateChart={updateChart} removeChart={removeChart} activeTest={activeTest} />
      ))}
    </div>
  );
};


export const MDAnalysisSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useMDDerived(activeTest, ctx);

  const cfg = { ...DEFAULT_MD_CHART_STYLE, ...(activeTest.mdAnalysisCfg || {}) };
  const setCfg = (patch) => updateActiveTest({ mdAnalysisCfg: { ...cfg, ...patch } });
  const [showCfg, setShowCfg] = useState(false);
  
  // NEW: State for real imported data
  const [importedData, setImportedData] = useState(null);
  const [importError, setImportError] = useState('');

  const handleAnalysisFileUpload = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target.result;
        let data = JSON.parse(text);
        if (!data.rmsd && !data.rmsf && !data.rg && !data.sasa && !data.energy) {
           throw new Error('JSON must contain at least one of: rmsd, rmsf, rg, sasa, energy arrays.');
        }
        setImportedData(data);
        setImportError('');
      } catch (err) {
        setImportError('Invalid JSON: ' + err.message);
        setImportedData(null);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const nFrames = parseMDValue(activeTest.mdNumFrames) || 500;
  const nResidues = Math.max(1, d.parsedSeq.length || 20);

  // Use imported data if available, otherwise fallback to simulated data
  const rmsd = useMemo(() => importedData?.rmsd || generateRMSDData(nFrames), [nFrames, importedData]);
  const rmsf = useMemo(() => {
      if (importedData?.rmsf) return importedData.rmsf.map(r => ({ ...r, fill: r.value > 0.25 ? '#ef4444' : '#3b82f6' }));
      return generateRMSFData(nResidues).map((r) => ({ ...r, fill: r.value > 0.25 ? '#ef4444' : '#3b82f6' }));
  }, [nResidues, importedData]);
  const rg = useMemo(() => importedData?.rg || generateRgData(nFrames), [nFrames, importedData]);
  const sasa = useMemo(() => importedData?.sasa || generateSASAData(nFrames), [nFrames, importedData]);
  const energy = useMemo(() => importedData?.energy || generateEnergyData(nFrames), [nFrames, importedData]);



  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCfg(!showCfg)}
            className={`font-bold py-1.5 px-3 rounded-lg text-xs border transition-colors ${
              showCfg ? 'bg-slate-200 border-slate-400 text-slate-900' : 'bg-white border-slate-300 text-slate-800 hover:bg-slate-50'
            }`}
          >
            ⚙️ Chart Parameters
          </button>
          
          <label className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1.5 px-3 rounded-lg text-xs cursor-pointer shadow-sm transition-colors flex items-center gap-2">
            📂 Upload Real Analysis (JSON)
            <input type="file" accept=".json" className="hidden" onChange={handleAnalysisFileUpload} />
          </label>

          {importedData && (
             <button onClick={() => setImportedData(null)} className="text-xs font-bold text-red-500 hover:text-red-700 underline ml-2">
               ✕ Clear Real Data
             </button>
          )}
        </div>

        {!importedData && (
          <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2">
            Frames (Simulated)
            <input
              type="number"
              value={activeTest.mdNumFrames || 500}
              onChange={(e) => updateActiveTest({ mdNumFrames: e.target.value })}
              className="border border-slate-300 rounded-md px-2 py-1 text-xs w-20 outline-none focus:border-blue-500"
            />
          </label>
        )}
      </div>

      {importError && (
         <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-bold p-2 rounded-lg">
           ⚠️ Import Error: {importError}
         </div>
      )}

      {importedData ? (
         <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold p-2 rounded-lg flex items-center gap-2">
           ✅ Plotting real imported data. (XTC trajectory is still playing in the 3D viewer above).
         </div>
      ) : (
         <span className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 w-fit">
           Curves are simulated. To see real graphs, upload an analysis JSON file.
         </span>
      )}

      {showCfg && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
          <label className="text-[10px] font-bold text-slate-500 uppercase flex flex-col gap-1">
            Font size (px)
            <input type="number" value={cfg.fontSize} onChange={(e) => setCfg({ fontSize: Number(e.target.value) || 12 })} className="border border-slate-300 rounded-md p-1.5 text-xs outline-none" />
          </label>
          <label className="text-[10px] font-bold text-slate-500 uppercase flex flex-col gap-1">
            Aspect ratio (W÷H)
            <input type="number" step="0.1" value={cfg.aspect} onChange={(e) => setCfg({ aspect: Number(e.target.value) || 1.8 })} className="border border-slate-300 rounded-md p-1.5 text-xs outline-none" />
          </label>
          <label className="text-[10px] font-bold text-slate-500 uppercase flex flex-col gap-1">
            Line style
            <select value={cfg.lineStyle} onChange={(e) => setCfg({ lineStyle: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs bg-white outline-none">
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
            </select>
          </label>
          <label className="text-[10px] font-bold text-slate-500 uppercase flex flex-col gap-1">
            Line thickness
            <input type="number" step="0.5" value={cfg.lineThickness} onChange={(e) => setCfg({ lineThickness: Number(e.target.value) || 2 })} className="border border-slate-300 rounded-md p-1.5 text-xs outline-none" />
          </label>
        </div>
      )}

      {d.parsedSeq.length === 0 ? (
        <div className="text-center py-8 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed">Enter a sequence in Experiment Setup to enable trajectory charts.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <MDAnalysisChart title="RMSD (backbone)" data={rmsd} cfg={cfg} color="#3b82f6" yLabel="nm" xLabel="Time (ns)" />
          <MDAnalysisChart title="RMSF per residue" data={rmsf} xKey="residue" cfg={cfg} color="#3b82f6" yLabel="nm" xLabel="Residue" chartType="bar" />
          <MDAnalysisChart title="Radius of Gyration (Rg)" data={rg} cfg={cfg} color="#22c55e" yLabel="nm" xLabel="Time (ns)" />
          <MDAnalysisChart title="SASA" data={sasa} cfg={cfg} color="#f59e0b" yLabel="nm²" xLabel="Time (ns)" />
        </div>
      )}
      
      {d.parsedSeq.length > 0 && (
        <div className="bg-white rounded-lg border border-slate-200 p-3">
          <h5 className="text-xs font-bold text-slate-700 mb-1">Energy</h5>
          <div style={{ height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={energy} margin={{ top: 5, right: 10, bottom: 25, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend verticalAlign="top" wrapperStyle={{ fontSize: 10 }} />
                <Line type="monotone" dataKey="potential" stroke="#ef4444" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="kinetic" stroke="#3b82f6" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="total" stroke="#22c55e" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Per Atom Plot subsection */}
      <CollapsibleSection title="Per Atom Plot" icon="📊" defaultOpen={false}>
        <MDPerAtomPlotSection ctx={ctx} />
      </CollapsibleSection>

      {/* Condition Plot subsection */}
      <CollapsibleSection title="Condition Plot" icon="📈" defaultOpen={false}>
        <MDConditionPlotSection ctx={ctx} />
      </CollapsibleSection>
    </div>
  );
};
// ================= 4) SIMULATION PARAMETERS =================
export const MDSimulationParamsSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useMDDerived(activeTest, ctx);

  const ffVersions = getFFVersions(d.ffKey);

  return (
    <div className="space-y-6 p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
      <h2 className="text-lg font-bold text-slate-800 border-b pb-2">⚙️ Simulation Parameters</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Force Field */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide">Force Field</label>
          <select 
            value={d.ffKey} 
            onChange={(e) => updateActiveTest({ forceField: e.target.value, forceFieldVersion: getFFVersions(e.target.value)[0] || '' })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500"
          >
            {Object.keys(FORCE_FIELDS).map(k => <option key={k} value={k}>{FORCE_FIELDS[k].name}</option>)}
          </select>
          {ffVersions.length > 1 && (
            <select
              value={d.ffVersion}
              onChange={(e) => updateActiveTest({ forceFieldVersion: e.target.value })}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 mt-2"
            >
              {ffVersions.map(v => <option key={v} value={v}>Version: {v}</option>)}
            </select>
          )}
        </div>

        {/* Water Model */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide">Water Model</label>
          <select 
            value={d.waterModel} 
            onChange={(e) => updateActiveTest({ waterModel: e.target.value })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500"
          >
            {Object.keys(WATER_MODELS).map(k => <option key={k} value={k}>{WATER_MODELS[k].name}</option>)}
          </select>
        </div>

        {/* Ensemble */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide">Ensemble</label>
          <select 
            value={d.ensemble} 
            onChange={(e) => updateActiveTest({ ensemble: e.target.value })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500"
          >
            {MD_ENSEMBLES.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>

        {/* Integrator */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide">Integrator</label>
          <select 
            value={d.integrator} 
            onChange={(e) => updateActiveTest({ integrator: e.target.value })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500"
          >
            {MD_INTEGRATORS.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>

        {/* Thermostat */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide">Thermostat</label>
          <select 
            value={d.thermostat} 
            onChange={(e) => updateActiveTest({ thermostat: e.target.value })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500"
          >
            {MD_THERMOSTATS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {/* Barostat */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide">Barostat</label>
          <select 
            value={d.barostat} 
            onChange={(e) => updateActiveTest({ barostat: e.target.value })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500"
          >
            {MD_BAROSTATS.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      </div>

      <h3 className="text-md font-bold text-slate-700 mt-6 border-b pb-2">🌡️ Physical Conditions & Duration</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-600">Temperature (K)</label>
          <input 
            type="number" 
            value={activeTest.simTemperature ?? 300} 
            onChange={(e) => updateActiveTest({ simTemperature: e.target.value })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-600">Pressure (bar)</label>
          <input 
            type="number" 
            step="0.1"
            value={activeTest.simPressure ?? 1.0} 
            onChange={(e) => updateActiveTest({ simPressure: e.target.value })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-600">Timestep (fs)</label>
          <input 
            type="number" 
            step="0.5"
            value={activeTest.timestep ?? 2} 
            onChange={(e) => updateActiveTest({ timestep: e.target.value })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-600">Total Steps</label>
          <input 
            type="number" 
            value={activeTest.nSteps ?? 500000} 
            onChange={(e) => updateActiveTest({ nSteps: e.target.value })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>
      </div>
      
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800 mt-4">
        <strong>Estimated Simulation Time:</strong> {((parseMDValue(activeTest.nSteps) || 500000) * (parseMDValue(activeTest.timestep) || 2) / 1000000).toFixed(2)} ns
      </div>
    </div>
  );
};
// ================= 5) MEMBRANE CONTACTS (port of from_gro_to_rdf awk) =================
const mdDataUrlToBlob = (dataUrl) => {
  const s = String(dataUrl || '');
  const comma = s.indexOf(',');
  if (comma < 0) return null;
  const meta = s.slice(0, comma);
  const b64 = s.slice(comma + 1);
  const mime = /data:([^;,]+)/.exec(meta)?.[1] || 'application/octet-stream';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
};

const MDContactChart = ({ rows, series, yLabel, height = 480 }) => (
  <div className="flex gap-3">
    <div style={{ flex: 1, minWidth: 0 }}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 96, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="atom" interval={0} height={100}
                 tick={{ fontSize: 9, angle: -90, textAnchor: 'end' }} />
          <YAxis tick={{ fontSize: 11 }} width={56}
                 label={{ value: yLabel, angle: -90, position: 'insideLeft', style: { fontSize: 12 } }} />
          <Tooltip />
          {series.map((s, i) => (
            <Line key={s.key} dataKey={s.key} stroke={AWK_PALETTE[i % AWK_PALETTE.length]}
                  strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0 }} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
    <div className="w-52 shrink-0 overflow-y-auto custom-scrollbar border border-slate-200 rounded-lg p-2 text-[11px] font-mono bg-white"
         style={{ maxHeight: height }}>
      {series.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1.5 py-0.5">
          <span className="inline-block w-3 h-3 rounded-full shrink-0"
                style={{ background: AWK_PALETTE[i % AWK_PALETTE.length] }} />
          <span className="truncate" title={s.key}>{s.key}</span>
        </div>
      ))}
    </div>
  </div>
);

export const MDMembraneContactSection = ({ ctx }) => {
  const { activeTest } = ctx;
  const [cfg, setCfg] = useState({ ...CONTACT_DEFAULTS });
  const [extraRuns, setExtraRuns] = useState([]);
  const [status, setStatus] = useState({ state: 'idle', msg: '', done: 0 });
  const [output, setOutput] = useState(null);

  const setOpt = (k, v) => setCfg((c) => ({ ...c, [k]: v }));

  const topologyText = async () => {
    if (!activeTest.structureFileData) return null;
    const b64 = String(activeTest.structureFileData).split(',')[1] || '';
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  };

  const metricOf = (p) => (cfg.metric === 'contactFreq' ? p.contactFreq : p.peakRDF);

  const aggregatePairs = (pairs) => {
    const map = new Map();
    pairs.forEach((p) => {
      const v = metricOf(p);
      const e = map.get(p.mem) || { sum: 0, max: -Infinity, n: 0 };
      e.sum += v; e.max = Math.max(e.max, v); e.n++;
      map.set(p.mem, e);
    });
    const out = new Map();
    map.forEach((e, k) => {
      out.set(k, cfg.aggregate === 'max' ? e.max : cfg.aggregate === 'sum' ? e.sum : e.sum / e.n);
    });
    return out;
  };

  const buildAtomsOutput = (res) => {
    const byKey = new Map(res.pairs.map((p) => [`${p.mem}|${p.mol}`, p]));
    const rows = res.memLabels.map((m) => {
      const row = { atom: m };
      res.molLabels.forEach((mo) => {
        const p = byKey.get(`${m}|${mo}`);
        row[mo] = p ? +metricOf(p).toFixed(4) : 0;
      });
      return row;
    });
    setOutput({
      mode: 'atoms', rows, pairs: res.pairs, memLabels: res.memLabels,
      series: res.molLabels.map((k) => ({ key: k })), nFrames: res.nFramesUsed,
      molResidues: res.molResidues,
    });
    setStatus({ state: 'done', msg: '', done: res.nFramesUsed });
  };

  const buildRunsOutput = (memLabels, seriesVals) => {
    const names = Object.keys(seriesVals);
    const rows = memLabels.map((m) => {
      const row = { atom: m };
      names.forEach((n) => { row[n] = +(seriesVals[n].get(m) || 0).toFixed(4); });
      return row;
    });
    setOutput({
      mode: 'runs', rows, memLabels,
      series: names.map((k) => ({ key: k })),
      nFrames: null, molResidues: [],
    });
    setStatus({ state: 'done', msg: '', done: 0 });
  };

  const runAll = async (useDemo = false) => {
    setStatus({ state: 'busy', msg: 'Reading topology…', done: 0 });
    setOutput(null);
    try {
      const text = await topologyText();
      if (!text) throw new Error('Upload the simulation topology (.gro — same atom order as the trajectory) in Experiment Setup → 3D Viewer mode first.');
      const topo = parseTopology(text);
      if (!topo.box) throw new Error('The topology has no box vectors — a .gro file with its final box line is required.');

      const topoName = (activeTest.structureFileName || '').toLowerCase();
      const topoBlob = mdDataUrlToBlob(activeTest.structureFileData);
      const topoExt = topoName.endsWith('.pdb') ? 'pdb' : topoName.endsWith('.gro') ? 'gro' : 'gro';

      const openTrajectory = async (file) => {
        const src = await resolveFrameSource(file, {
          topologyBlob: topoBlob, topologyExt: topoExt, topologyBox: topo.box,
          onStatus: (m) => setStatus((s) => ({ ...s, msg: m })),
        });
        if (!src) throw new Error(`"${file.name}": unsupported format, or no topology available to decode it (.xtc / .dcd need the system topology uploaded; .trr works standalone).`);
        return src; // { frames, numframes, source }
      };

      const jobs = [];
      if (!useDemo) {
        const mainFile = localFileCache.get(activeTest.id)?.trajectory || null;
        if (mainFile) jobs.push({ name: mainFile.name.replace(/\.(xtc|trr|dcd)$/i, ''), file: mainFile });
        extraRuns.forEach((f) => jobs.push({ name: f.name.replace(/\.(xtc|trr|dcd)$/i, ''), file: f }));
      }

      if (jobs.length === 0) {
        const res = await computeContactRDF(topo, demoFrames(topo, 40), cfg,
          (p) => setStatus((s) => ({ ...s, msg: `Demo: frame ${p.done}`, done: p.done })));
        buildAtomsOutput(res);
        return;
      }

      if (jobs.length === 1) {
        const { frames, numframes, source } = await openTrajectory(jobs[0].file);
        const total = numframes ? ` / ${numframes}` : '';
        const res = await computeContactRDF(topo, frames, cfg,
          (p) => setStatus({ state: 'busy', msg: `${jobs[0].name} (${source}): frame ${p.done}${total}`, done: p.done }));
        buildAtomsOutput(res);
      } else {
        const seriesVals = {};
        let memLabels = null;
        for (const job of jobs) {
          const { frames, numframes, source } = await openTrajectory(job.file);
          const total = numframes ? ` / ${numframes}` : '';
          const res = await computeContactRDF(topo, frames, cfg,
            (p) => setStatus({ state: 'busy', msg: `${job.name} (${source}): frame ${p.done}${total}`, done: p.done }));
          if (!memLabels) memLabels = res.memLabels;
          seriesVals[job.name] = aggregatePairs(res.pairs);
        }
        buildRunsOutput(memLabels, seriesVals);
      }
    } catch (e) {
      setStatus({ state: 'error', msg: e.message, done: 0 });
    }
  };

  const exportCSV = () => {
    if (!output) return;
    const head = ['Membrane atom', ...output.series.map((s) => s.key)];
    const body = output.rows.map((r) => [r.atom, ...output.series.map((s) => r[s.key] ?? '')]);
    const csv = [head, ...body].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'membrane_contacts.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const yLabel = cfg.metric === 'contactFreq'
    ? `Contact frequency (fraction of frames, r < ${cfg.rMax} nm)`
    : cfg.mode === 'vdW' ? 'Apolar contact recurrence' : cfg.mode === 'all' ? 'Contact recurrence' : 'Polar contact recurrence';

  const inp = 'border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500';

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800">
        In-browser port of <span className="font-mono">from_gro_to_rdf-new-colors-r6.awk</span> (option=inter):
        for every membrane atom, the maximum of g(r) inside the {cfg.rMin}–{cfg.rMax} nm shell
        (gmx rdf, bin {cfg.bin} nm) against the molecule — the "contact recurrence" plot of Figures_CHD.pdf (p. 8).
        Upload the system topology (.gro) in the 3D panel plus a trajectory: <b>.xtc / .dcd</b> are decoded in-browser
        via the NGL library (the same one the 3D viewer uses), <b>.trr</b> is parsed natively.
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-bold text-slate-600">Mode
          <select value={cfg.mode} onChange={(e) => setOpt('mode', e.target.value)} className={`${inp} block mt-1 font-semibold`}>
            <option value="polar">Polar (O/N/S, awk vdW=no)</option>
            <option value="vdW">Apolar vdW carbons (awk vdW=yes)</option>
            <option value="all">All (polar + vdW)</option>
          </select>
        </label>
        <label className="text-xs font-bold text-slate-600">Metric
          <select value={cfg.metric} onChange={(e) => setOpt('metric', e.target.value)} className={`${inp} block mt-1 font-semibold`}>
            <option value="peakRDF">Peak RDF in window (awk)</option>
            <option value="contactFreq">Contact frequency (frames)</option>
          </select>
        </label>
        <label className="text-xs font-bold text-slate-600">r min (nm)
          <input type="number" step="0.01" value={cfg.rMin} onChange={(e) => setOpt('rMin', Number(e.target.value))} className={`${inp} block mt-1 w-20`} />
        </label>
        <label className="text-xs font-bold text-slate-600">r max (nm)
          <input type="number" step="0.01" value={cfg.rMax} onChange={(e) => setOpt('rMax', Number(e.target.value))} className={`${inp} block mt-1 w-20`} />
        </label>
        <label className="text-xs font-bold text-slate-600">Bin (nm)
          <input type="number" step="0.001" value={cfg.bin} onChange={(e) => setOpt('bin', Number(e.target.value))} className={`${inp} block mt-1 w-20`} />
        </label>
        <label className="text-xs font-bold text-slate-600">Stride
          <input type="number" min="1" value={cfg.stride} onChange={(e) => setOpt('stride', Math.max(1, Number(e.target.value) || 1))} className={`${inp} block mt-1 w-16`} />
        </label>
        <label className="text-xs font-bold text-slate-600">Start frame
          <input type="number" min="0" value={cfg.startFrame} onChange={(e) => setOpt('startFrame', Math.max(0, Number(e.target.value) || 0))} className={`${inp} block mt-1 w-20`} />
        </label>
        <label className="text-xs font-bold text-slate-600">Max frames (0=all)
          <input type="number" min="0" value={cfg.maxFrames} onChange={(e) => setOpt('maxFrames', Math.max(0, Number(e.target.value) || 0))} className={`${inp} block mt-1 w-24`} />
        </label>
        <label className="text-xs font-bold text-slate-600">Molecule residue(s)
          <input value={cfg.molResidues} onChange={(e) => setOpt('molResidues', e.target.value)} placeholder="auto" className={`${inp} block mt-1 w-32 font-mono`} />
        </label>
        <label className="text-xs font-bold text-slate-600 flex items-center gap-1.5 pb-2">
          <input type="checkbox" checked={cfg.includeIons} onChange={(e) => setOpt('includeIons', e.target.checked)} className="accent-blue-600" />
          include ions
        </label>
        <label className="text-xs font-bold text-slate-600">Run aggregation
          <select value={cfg.aggregate} onChange={(e) => setOpt('aggregate', e.target.value)} className={`${inp} block mt-1 font-semibold`}>
            <option value="max">max over molecule atoms</option>
            <option value="mean">mean</option>
            <option value="sum">sum</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => runAll(false)} disabled={status.state === 'busy'}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-bold px-5 py-2 rounded-lg text-sm">
          ▶ Compute contacts
        </button>
        <button onClick={() => runAll(true)} disabled={status.state === 'busy'}
                className="bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 font-bold px-4 py-2 rounded-lg text-xs">
          🧪 Test pipeline (demo frames)
        </button>
        <label className="text-xs font-bold text-slate-600">Additional runs to overlay (like POPC+CHD(1)…(3))
          <input type="file" multiple accept=".xtc,.trr,.dcd" className={`${inp} block mt-1`}
                 onChange={(e) => setExtraRuns(Array.from(e.target.files || []))} />
        </label>
        {extraRuns.length > 0 && (
          <span className="text-xs text-slate-500 font-mono">{extraRuns.map((f) => f.name).join(', ')}</span>
        )}
        {output && (
          <button onClick={exportCSV} className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 font-bold px-4 py-2 rounded-lg text-xs">
            📊 Export CSV
          </button>
        )}
      </div>

      {status.state === 'busy' && (
        <div className="text-xs font-bold text-blue-700 animate-pulse">⏳ {status.msg}</div>
      )}
      {status.state === 'error' && (
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-lg p-3 text-xs font-semibold">⚠️ {status.msg}</div>
      )}

      {output && (
        <div className="border border-slate-200 rounded-xl p-4 bg-white shadow-sm space-y-2">
          <div className="text-xs text-slate-500 font-semibold">
            {output.nFrames ? `${output.nFrames} frames analysed · ` : ''}
            {output.series.length} series · {output.rows.length} membrane atom groups
            {output.molResidues?.length ? ` · molecule residue(s): ${output.molResidues.join(', ')}` : ''}
          </div>
          <MDContactChart rows={output.rows} series={output.series} yLabel={yLabel} />
        </div>
      )}
    </div>
  );
};

// ================= 6) ORDER PARAMETERS & MEMBRANE PROFILES =================
const mdProfilesBlobFromDataUrl = (dataUrl) => {
  const s = String(dataUrl || '');
  const comma = s.indexOf(',');
  if (comma < 0) return null;
  const meta = s.slice(0, comma);
  const b64 = s.slice(comma + 1);
  const mime = /data:([^;,]+)/.exec(meta)?.[1] || 'application/octet-stream';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
};

const MDProfileChart = ({ rows, series, xKey, yLabel, xLabel, height = 380, rotateX = false, numericX = false }) => (
  <div className="flex gap-3">
    <div style={{ flex: 1, minWidth: 0 }}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: rotateX ? 90 : 36, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          {numericX ? (
            <XAxis dataKey={xKey} type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: 10 }}
                   label={{ value: xLabel, position: 'insideBottom', offset: -18, style: { fontSize: 11 } }} />
          ) : (
            <XAxis dataKey={xKey} interval={0} height={rotateX ? 100 : 40}
                   tick={{ fontSize: rotateX ? 9 : 10, angle: rotateX ? -90 : 0, textAnchor: rotateX ? 'end' : 'middle' }} />
          )}
          <YAxis tick={{ fontSize: 11 }} width={56}
                 label={{ value: yLabel, angle: -90, position: 'insideLeft', style: { fontSize: 12 } }} />
          <Tooltip />
          {series.map((s, i) => (
            <Line key={s.key} dataKey={s.key} stroke={AWK_PALETTE[i % AWK_PALETTE.length]} strokeWidth={2}
                  dot={{ r: rotateX ? 2.5 : 0, strokeWidth: 0 }} connectNulls isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
    <div className="w-48 shrink-0 overflow-y-auto custom-scrollbar border border-slate-200 rounded-lg p-2 text-[11px] font-mono bg-white"
         style={{ maxHeight: height }}>
      {series.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1.5 py-0.5">
          <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ background: AWK_PALETTE[i % AWK_PALETTE.length] }} />
          <span className="truncate" title={s.key}>{s.key}</span>
        </div>
      ))}
    </div>
  </div>
);

export const MDMembraneProfilesSection = ({ ctx }) => {
  const { activeTest } = ctx;
  const [cfg, setCfg] = useState({ bin: 0.02, centerMode: 'auto', signedSCD: false, scdResidues: '', stride: 1, startFrame: 0, maxFrames: 0 });
  const [extraRuns, setExtraRuns] = useState([]);
  const [chargeInfo, setChargeInfo] = useState({ map: null, count: 0, files: [] });
  const [status, setStatus] = useState({ state: 'idle', msg: '', done: 0 });
  const [outputs, setOutputs] = useState([]); // [{ name, result }]

  const setOpt = (k, v) => setCfg((c) => ({ ...c, [k]: v }));

  const handleChargeFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) { setChargeInfo({ map: null, count: 0, files: [] }); return; }
    const texts = [];
    for (const f of files) texts.push(await f.text());
    const map = parseChargeMap(texts);
    setChargeInfo({ map, count: map.size, files: files.map((f) => f.name) });
  };

  const runAll = async (useDemo = false) => {
    setStatus({ state: 'busy', msg: 'Reading topology…', done: 0 });
    setOutputs([]);
    try {
      if (!activeTest.structureFileData) throw new Error('Upload the simulation topology (.gro) in Experiment Setup → 3D Viewer mode first.');
      const b64 = String(activeTest.structureFileData).split(',')[1] || '';
      const text = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      const topo = parseTopology(text);
      if (!topo.box) throw new Error('The topology has no box vectors — a .gro with its final box line is required.');

      const topoName = (activeTest.structureFileName || '').toLowerCase();
      const topologyBlob = mdProfilesBlobFromDataUrl(activeTest.structureFileData);
      const topologyExt = topoName.endsWith('.pdb') ? 'pdb' : 'gro';

      const jobs = [];
      if (!useDemo) {
        const mainFile = localFileCache.get(activeTest.id)?.trajectory || null;
        if (mainFile) jobs.push({ name: mainFile.name.replace(/\.(xtc|trr|dcd)$/i, ''), file: mainFile });
        extraRuns.forEach((f) => jobs.push({ name: f.name.replace(/\.(xtc|trr|dcd)$/i, ''), file: f }));
      }

      const outs = [];
      if (jobs.length === 0) {
        const result = await computeOrderAndDensity(topo, demoFrames(topo, 40), cfg, chargeInfo.map,
          (p) => setStatus({ state: 'busy', msg: `Demo: frame ${p.done}`, done: p.done }));
        outs.push({ name: 'demo', result });
      } else {
        for (const job of jobs) {
          const src = await resolveFrameSource(job.file, {
            topologyBlob, topologyExt, topologyBox: topo.box,
            onStatus: (m) => setStatus((s) => ({ ...s, msg: m })),
          });
          if (!src) throw new Error(`"${job.file.name}": could not be opened (.xtc / .dcd need the topology uploaded; .trr works standalone).`);
          const frames = src.frames || src;
          const result = await computeOrderAndDensity(topo, frames, cfg, chargeInfo.map,
            (p) => setStatus({ state: 'busy', msg: `${job.name}: frame ${p.done}`, done: p.done }));
          outs.push({ name: job.name, result });
        }
      }
      setOutputs(outs);
      setStatus({ state: 'done', msg: '', done: 0 });
    } catch (e) {
      setStatus({ state: 'error', msg: e.message, done: 0 });
    }
  };

  /* ---- chart data (merged across runs) ---- */
  const scdData = useMemo(() => {
    if (outputs.length === 0) return null;
    const rowMap = new Map();
    const series = [];
    outputs.forEach((o) => {
      o.result.scdGroups.forEach((g) => {
        const sKey = outputs.length > 1 ? `${o.name} · ${g.label}` : g.label;
        series.push({ key: sKey });
        g.carbons.forEach((c) => {
          const rk = `${g.label}|${c.x}`;
          if (!rowMap.has(rk)) rowMap.set(rk, { group: g.label, x: c.x, xNum: c.xNum });
          rowMap.get(rk)[sKey] = c.scd;
        });
      });
    });
    const rows = [...rowMap.values()]
      .sort((a, b) =>
        a.group.localeCompare(b.group) ||
        ((a.xNum ?? 1e9) - (b.xNum ?? 1e9)) ||
        String(a.x).localeCompare(String(b.x), undefined, { numeric: true }))
      .map((r) => ({ x: r.x, group: r.group, ...Object.fromEntries(series.map((s) => [s.key, r[s.key] ?? null])) }));
    return { rows, series };
  }, [outputs]);

  const densityRows = useMemo(() => {
    if (outputs.length === 0) return null;
    const base = outputs[0].result.density;
    return base.z.map((zz, i) => {
      const row = { z: zz };
      outputs.forEach((o) => { row[o.name] = o.result.density.rhoE[i]; });
      return row;
    });
  }, [outputs]);

  const potentialRows = useMemo(() => {
    const withPot = outputs.filter((o) => o.result.density.potential);
    if (withPot.length === 0) return null;
    const base = withPot[0].result.density;
    return base.z.map((zz, i) => {
      const row = { z: zz };
      withPot.forEach((o) => { row[o.name] = o.result.density.potential[i]; });
      return row;
    });
  }, [outputs]);

  const exportCSV = () => {
    if (!scdData) return;
    const lines = ['# Order parameters |SCD|'];
    lines.push(['Lipid group', 'Carbon', ...scdData.series.map((s) => s.key)].join(','));
    scdData.rows.forEach((r) => lines.push([r.group, r.x, ...scdData.series.map((s) => r[s.key] ?? '')].join(',')));
    if (densityRows) {
      lines.push('', '# Electron density (e/nm3)');
      lines.push(['z (nm)', ...outputs.map((o) => o.name)].join(','));
      densityRows.forEach((r) => lines.push([r.z, ...outputs.map((o) => r[o.name] ?? '')].join(',')));
    }
    if (potentialRows) {
      lines.push('', '# Electrostatic potential (V)');
      lines.push(['z (nm)', ...outputs.filter((o) => o.result.density.potential).map((o) => o.name)].join(','));
      potentialRows.forEach((r) => lines.push([r.z, ...outputs.filter((o) => o.result.density.potential).map((o) => r[o.name] ?? '')].join(',')));
    }
    const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'membrane_profiles.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const inp = 'border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500';
  const anyMissing = outputs.length > 0 && outputs.some((o) => o.result.density.missingChargeResidues.length > 0);

  return (
    <div className="space-y-4">
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-xs text-indigo-800">
        Two more Figures_CHD.pdf analysis types, in-browser:
        <b> (1)</b> deuterium order parameter |SCD| per C–H bond (≙ <span className="font-mono">gmx order</span>;
        default = lipid acyl chains, sn-1 = C2x, sn-2 = C3x — any residue list works, e.g. CHL1) and
        <b> (2)</b> electron density + electrostatic potential across the membrane
        (≙ <span className="font-mono">gmx density</span> + <span className="font-mono">gmx potential</span>; bilayer centre per
        frame = median phosphate z, potential from double integration of the charge density, water baseline set to 0).
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-bold text-slate-600">Bin width (nm)
          <input type="number" step="0.005" value={cfg.bin} onChange={(e) => setOpt('bin', Number(e.target.value))} className={`${inp} block mt-1 w-20`} />
        </label>
        <label className="text-xs font-bold text-slate-600">Bilayer centre
          <select value={cfg.centerMode} onChange={(e) => setOpt('centerMode', e.target.value)} className={`${inp} block mt-1 font-semibold`}>
            <option value="auto">Auto (median phosphate z)</option>
            <option value="box">Box centre</option>
          </select>
        </label>
        <label className="text-xs font-bold text-slate-600">SCD residues
          <input value={cfg.scdResidues} onChange={(e) => setOpt('scdResidues', e.target.value)} placeholder="lipids only" className={`${inp} block mt-1 w-36 font-mono`} />
        </label>
        <label className="text-xs font-bold text-slate-600 flex items-center gap-1.5 pb-2">
          <input type="checkbox" checked={cfg.signedSCD} onChange={(e) => setOpt('signedSCD', e.target.checked)} className="accent-indigo-600" />
          signed SCD (default |SCD|)
        </label>
        <label className="text-xs font-bold text-slate-600">Stride
          <input type="number" min="1" value={cfg.stride} onChange={(e) => setOpt('stride', Math.max(1, Number(e.target.value) || 1))} className={`${inp} block mt-1 w-16`} />
        </label>
        <label className="text-xs font-bold text-slate-600">Start frame
          <input type="number" min="0" value={cfg.startFrame} onChange={(e) => setOpt('startFrame', Math.max(0, Number(e.target.value) || 0))} className={`${inp} block mt-1 w-20`} />
        </label>
        <label className="text-xs font-bold text-slate-600">Max frames (0=all)
          <input type="number" min="0" value={cfg.maxFrames} onChange={(e) => setOpt('maxFrames', Math.max(0, Number(e.target.value) || 0))} className={`${inp} block mt-1 w-24`} />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => runAll(false)} disabled={status.state === 'busy'}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-bold px-5 py-2 rounded-lg text-sm">
          ▶ Compute profiles
        </button>
        <button onClick={() => runAll(true)} disabled={status.state === 'busy'}
                className="bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 font-bold px-4 py-2 rounded-lg text-xs">
          🧪 Test pipeline (demo frames)
        </button>
        <label className="text-xs font-bold text-slate-600">Additional runs to overlay
          <input type="file" multiple accept=".xtc,.trr,.dcd" className={`${inp} block mt-1`}
                 onChange={(e) => setExtraRuns(Array.from(e.target.files || []))} />
        </label>
        <label className="text-xs font-bold text-slate-600">Charges (.itp / .top, for the potential)
          <input type="file" multiple accept=".itp,.top,.txt" className={`${inp} block mt-1`}
                 onChange={(e) => handleChargeFiles(e.target.files)} />
        </label>
        {chargeInfo.count > 0 && (
          <span className="text-xs text-emerald-700 font-semibold">✓ {chargeInfo.count} atom charges from {chargeInfo.files.join(', ')}</span>
        )}
        {outputs.length > 0 && (
          <button onClick={exportCSV} className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 font-bold px-4 py-2 rounded-lg text-xs">
            📊 Export CSV
          </button>
        )}
      </div>

      {!chargeInfo.map && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2.5 text-[11px] font-semibold">
          ⚠️ No charge file loaded: the electron density will be computed, but the electrostatic potential needs partial
          charges — upload your lipid / solvent / ion / ligand .itp (or a processed .top) files.
        </div>
      )}
      {anyMissing && chargeInfo.map && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2.5 text-[11px] font-semibold">
          ⚠️ Some residues have no charges in the uploaded files ({[...new Set(outputs.flatMap((o) => o.result.density.missingChargeResidues))].slice(0, 12).join(', ')}…) — the potential will be approximate until they are covered.
        </div>
      )}

      {status.state === 'busy' && (
        <div className="text-xs font-bold text-indigo-700 animate-pulse">⏳ {status.msg}</div>
      )}
      {status.state === 'error' && (
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-lg p-3 text-xs font-semibold">⚠️ {status.msg}</div>
      )}

      {outputs.length > 0 && scdData && (
        <div className="border border-slate-200 rounded-xl p-4 bg-white shadow-sm space-y-4">
          <div className="text-xs text-slate-500 font-semibold">
            {outputs.map((o) => o.name).join(' · ')} · {outputs[0].result.nFramesUsed} frames · bin {outputs[0].result.density.binNm} nm
          </div>
          <div>
            <div className="text-sm font-bold text-slate-700 mb-1">Order parameter |SCD| (≙ gmx order)</div>
            <MDProfileChart rows={scdData.rows} series={scdData.series} xKey="x" rotateX
                            yLabel={cfg.signedSCD ? 'SCD' : '|SCD|'} height={420} />
          </div>
          {densityRows && (
            <div>
              <div className="text-sm font-bold text-slate-700 mb-1">Electron density profile (≙ gmx density)</div>
              <MDProfileChart rows={densityRows} series={outputs.map((o) => ({ key: o.name }))}
                              xKey="z" numericX xLabel="Distance to bilayer center (nm)"
                              yLabel="Electron density (e/nm³)" height={360} />
            </div>
          )}
          {potentialRows ? (
            <div>
              <div className="text-sm font-bold text-slate-700 mb-1">Electrostatic potential (≙ gmx potential)</div>
              <MDProfileChart rows={potentialRows}
                              series={outputs.filter((o) => o.result.density.potential).map((o) => ({ key: o.name }))}
                              xKey="z" numericX xLabel="Distance to bilayer center (nm)"
                              yLabel="Potential (V)" height={360} />
            </div>
          ) : (
            <div className="text-xs text-slate-400 font-semibold">Electrostatic potential: requires a charges file (.itp / .top).</div>
          )}
        </div>
      )}
    </div>
  );
};

// ================= 7) SECONDARY STRUCTURE (DSSP along the trajectory) =================
const mdSSBlobFromDataUrl = (dataUrl) => {
  const s = String(dataUrl || '');
  const comma = s.indexOf(',');
  if (comma < 0) return null;
  const meta = s.slice(0, comma);
  const b64 = s.slice(comma + 1);
  const mime = /data:([^;,]+)/.exec(meta)?.[1] || 'application/octet-stream';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
};

const SS_LETTER_META = [
  { k: 'H', label: 'α-helix (H)' }, { k: 'E', label: 'β-strand (E)' },
  { k: 'G', label: '3-10 helix (G)' }, { k: 'I', label: 'π-helix (I)' },
  { k: 'B', label: 'bridge (B)' }, { k: 'T', label: 'turn (T)' },
  { k: 'S', label: 'bend (S)' }, { k: 'C', label: 'coil (C)' },
];

export const MDSecondaryStructureSection = ({ ctx }) => {
  const { activeTest } = ctx;
  const [cfg, setCfg] = useState({ stride: 1, startFrame: 0, maxFrames: 0, dtPs: 0, chartMode: 'grouped' });
  const [extraRuns, setExtraRuns] = useState([]);
  const [status, setStatus] = useState({ state: 'idle', msg: '', done: 0 });
  const [outputs, setOutputs] = useState([]); // [{ name, result }]
  const heatCanvasRef = useRef(null);

  const setOpt = (k, v) => setCfg((c) => ({ ...c, [k]: v }));

  const runAll = async (useDemo = false) => {
    setStatus({ state: 'busy', msg: 'Reading topology…', done: 0 });
    setOutputs([]);
    try {
      if (!activeTest.structureFileData) throw new Error('Upload the simulation topology (.gro) in Experiment Setup → 3D Viewer mode first.');
      const b64 = String(activeTest.structureFileData).split(',')[1] || '';
      const text = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      const topo = parseTopology(text);
      if (!topo.box) throw new Error('The topology has no box vectors — a .gro with its final box line is required.');

      const topoName = (activeTest.structureFileName || '').toLowerCase();
      const topologyBlob = mdSSBlobFromDataUrl(activeTest.structureFileData);
      const topologyExt = topoName.endsWith('.pdb') ? 'pdb' : 'gro';

      const jobs = [];
      if (!useDemo) {
        const mainFile = localFileCache.get(activeTest.id)?.trajectory || null;
        if (mainFile) jobs.push({ name: mainFile.name.replace(/\.(xtc|trr|dcd)$/i, ''), file: mainFile });
        extraRuns.forEach((f) => jobs.push({ name: f.name.replace(/\.(xtc|trr|dcd)$/i, ''), file: f }));
      }

      const outs = [];
      if (jobs.length === 0) {
        const result = await computeSecondaryStructure(topo, demoFrames(topo, 40), cfg,
          (p) => setStatus({ state: 'busy', msg: `Demo: frame ${p.done}`, done: p.done }));
        outs.push({ name: 'demo', result });
      } else {
        for (const job of jobs) {
          const src = await resolveFrameSource(job.file, {
            topologyBlob, topologyExt, topologyBox: topo.box,
            onStatus: (m) => setStatus((s) => ({ ...s, msg: m })),
          });
          if (!src) throw new Error(`"${job.file.name}": could not be opened (.xtc / .dcd need the topology uploaded; .trr works standalone).`);
          const frames = src.frames || src;
          const result = await computeSecondaryStructure(topo, frames, cfg,
            (p) => setStatus({ state: 'busy', msg: `${job.name}: frame ${p.done}`, done: p.done }));
          outs.push({ name: job.name, result });
        }
      }
      setOutputs(outs);
      setStatus({ state: 'done', msg: '', done: 0 });
    } catch (e) {
      setStatus({ state: 'error', msg: e.message, done: 0 });
    }
  };

  /* ---- content-vs-time chart data ---- */
  const contentData = useMemo(() => {
    if (outputs.length === 0) return null;
    const keys = cfg.chartMode === 'letters'
      ? SS_LETTER_META.map((m) => m.k)
      : ['alpha', 'beta', 'coil'];
    const keyLabel = (k) => (k === 'alpha' ? 'α-helix' : k === 'beta' ? 'β-sheet' : k === 'coil' ? 'coil/other' : k);
    const series = [];
    outputs.forEach((o) => {
      keys.forEach((k) => series.push({ key: outputs.length > 1 ? `${o.name} · ${keyLabel(k)}` : keyLabel(k), k }));
    });
    const rows = outputs[0].result.series.map((s, si) => {
      const row = { x: s.x };
      outputs.forEach((o) => {
        const fr = o.result.series[si];
        keys.forEach((k) => {
          const sKey = outputs.length > 1 ? `${o.name} · ${keyLabel(k)}` : keyLabel(k);
          row[sKey] = fr ? (k === 'alpha' ? fr.alpha : k === 'beta' ? fr.beta : k === 'coil' ? fr.coil : +((100 * fr.counts[k] / o.result.nRes).toFixed(2))) : null;
        });
      });
      return row;
    });
    return { rows, series };
  }, [outputs, cfg.chartMode]);

  const contentColor = (sKey, i) => {
    if (outputs.length > 1) return AWK_PALETTE[i % AWK_PALETTE.length];
    if (sKey === 'α-helix') return SS_GROUP_COLORS.alpha;
    if (sKey === 'β-sheet') return SS_GROUP_COLORS.beta;
    if (sKey === 'coil/other') return SS_GROUP_COLORS.coil;
    const letter = sKey.charAt(0);
    return SS_COLORS[letter] || '#64748b';
  };

  /* ---- DSSP heatmap (first run) ---- */
  const heat = outputs[0]?.result.heat || null;
  useEffect(() => {
    const cv = heatCanvasRef.current;
    if (!cv || !heat) return;
    cv.width = heat.samples.length;
    cv.height = heat.nRes;
    const c2 = cv.getContext('2d');
    heat.samples.forEach((codes, x) => {
      for (let y = 0; y < codes.length; y++) {
        c2.fillStyle = SS_COLORS[SS_CODE_ORDER[codes[y]]];
        c2.fillRect(x, y, 1, 1);
      }
    });
  }, [heat]);

  const exportCSV = () => {
    if (!contentData) return;
    const head = [`time (${outputs[0].result.xUnit})`, ...contentData.series.map((s) => `${s.key} (%)`)];
    const body = contentData.rows.map((r) => [r.x, ...contentData.series.map((s) => r[s.key] ?? '')]);
    const csv = [head, ...body].map((row) => row.join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'secondary_structure_dssp.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const inp = 'border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500';
  const occRows = outputs[0]?.result.occupancy || [];
  const occInterval = Math.max(0, Math.floor(occRows.length / 40));

  return (
    <div className="space-y-4">
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-800">
        Secondary structure along the trajectory — in-browser port of <span className="font-mono">gmx do_dssp</span> (Kabsch–Sander):
        backbone H-bond energies (E ≤ −0.5 kcal/mol), helix/turn/bend/β-bridge assignment with DSSP priority
        H &gt; B &gt; E &gt; G &gt; I &gt; T &gt; S &gt; C. Requires a protein topology (N/CA/C/O); H positions are reconstructed,
        so it also works with trajectories saved without hydrogens.
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-bold text-slate-600">Content chart
          <select value={cfg.chartMode} onChange={(e) => setOpt('chartMode', e.target.value)} className={`${inp} block mt-1 font-semibold`}>
            <option value="grouped">α / β / coil</option>
            <option value="letters">All DSSP letters</option>
          </select>
        </label>
        <label className="text-xs font-bold text-slate-600">Δt between frames (ps, 0 = frame axis)
          <input type="number" min="0" step="10" value={cfg.dtPs} onChange={(e) => setOpt('dtPs', Number(e.target.value) || 0)} className={`${inp} block mt-1 w-28`} />
        </label>
        <label className="text-xs font-bold text-slate-600">Stride
          <input type="number" min="1" value={cfg.stride} onChange={(e) => setOpt('stride', Math.max(1, Number(e.target.value) || 1))} className={`${inp} block mt-1 w-16`} />
        </label>
        <label className="text-xs font-bold text-slate-600">Start frame
          <input type="number" min="0" value={cfg.startFrame} onChange={(e) => setOpt('startFrame', Math.max(0, Number(e.target.value) || 0))} className={`${inp} block mt-1 w-20`} />
        </label>
        <label className="text-xs font-bold text-slate-600">Max frames (0=all)
          <input type="number" min="0" value={cfg.maxFrames} onChange={(e) => setOpt('maxFrames', Math.max(0, Number(e.target.value) || 0))} className={`${inp} block mt-1 w-24`} />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => runAll(false)} disabled={status.state === 'busy'}
                className="bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white font-bold px-5 py-2 rounded-lg text-sm">
          ▶ Compute DSSP
        </button>
        <button onClick={() => runAll(true)} disabled={status.state === 'busy'}
                className="bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 font-bold px-4 py-2 rounded-lg text-xs">
          🧪 Test pipeline (demo frames)
        </button>
        <label className="text-xs font-bold text-slate-600">Additional runs to overlay
          <input type="file" multiple accept=".xtc,.trr,.dcd" className={`${inp} block mt-1`}
                 onChange={(e) => setExtraRuns(Array.from(e.target.files || []))} />
        </label>
        {extraRuns.length > 0 && (
          <span className="text-xs text-slate-500 font-mono">{extraRuns.map((f) => f.name).join(', ')}</span>
        )}
        {outputs.length > 0 && (
          <button onClick={exportCSV} className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 font-bold px-4 py-2 rounded-lg text-xs">
            📊 Export CSV
          </button>
        )}
      </div>

      {status.state === 'busy' && (
        <div className="text-xs font-bold text-rose-700 animate-pulse">⏳ {status.msg}</div>
      )}
      {status.state === 'error' && (
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-lg p-3 text-xs font-semibold">⚠️ {status.msg}</div>
      )}

      {outputs.length > 0 && contentData && (
        <div className="border border-slate-200 rounded-xl p-4 bg-white shadow-sm space-y-5">
          <div className="text-xs text-slate-500 font-semibold">
            {outputs.map((o) => o.name).join(' · ')} · {outputs[0].result.nFramesUsed} frames · {outputs[0].result.nRes} protein residues
          </div>

          <div>
            <div className="text-sm font-bold text-slate-700 mb-1">Secondary structure content vs time (≙ gmx do_dssp summary)</div>
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={contentData.rows} margin={{ top: 8, right: 8, bottom: 30, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: 10 }}
                       label={{ value: outputs[0].result.xUnit === 'ns' ? 'Time (ns)' : 'Frame', position: 'insideBottom', offset: -18, style: { fontSize: 11 } }} />
                <YAxis tick={{ fontSize: 11 }} width={48} unit="%"
                       label={{ value: 'Residues (%)', angle: -90, position: 'insideLeft', style: { fontSize: 12 } }} />
                <Tooltip />
                {contentData.series.map((s, i) => (
                  <Line key={s.key} dataKey={s.key} stroke={contentColor(s.key, i)} strokeWidth={2}
                        dot={false} connectNulls isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {heat && (
            <div>
              <div className="text-sm font-bold text-slate-700 mb-1">DSSP timeline map (residue × frame)</div>
              <div className="overflow-x-auto custom-scrollbar">
                <canvas ref={heatCanvasRef} style={{ width: '100%', minWidth: 640, imageRendering: 'pixelated' }} />
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-2 text-[10px] font-mono text-slate-600">
                {SS_LETTER_META.map((m) => (
                  <span key={m.k} className="flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded-sm border border-slate-300" style={{ background: SS_COLORS[m.k] }} />
                    {m.label}
                  </span>
                ))}
                <span className="text-slate-400">
                  · x: every {heat.frameStride} frame(s) of {heat.totalFrames} · y: residue 1 → {heat.nRes}
                </span>
              </div>
            </div>
          )}

          {occRows.length > 0 && (
            <div>
              <div className="text-sm font-bold text-slate-700 mb-1">Per-residue occupancy ({outputs[0].name})</div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={occRows} margin={{ top: 8, right: 8, bottom: 70, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" interval={occInterval} height={80}
                         tick={{ fontSize: 8, angle: -90, textAnchor: 'end' }} />
                  <YAxis tick={{ fontSize: 11 }} width={48} unit="%" domain={[0, 100]} />
                  <Tooltip />
                  <Bar dataKey="alpha" stackId="ss" fill={SS_GROUP_COLORS.alpha} name="α-helix" isAnimationActive={false} />
                  <Bar dataKey="beta" stackId="ss" fill={SS_GROUP_COLORS.beta} name="β-sheet" isAnimationActive={false} />
                  <Bar dataKey="other" stackId="ss" fill="#e5e7eb" name="coil/other" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
// ================= ALL =================

// ================= ALL =================

export const Setup = MDExperimentSetupSection;
export const Data = MDDataSection;
export const Simulations = MDSimulationParamsSection;
export const Analysis = MDAnalysisSection;
export const Contacts = MDMembraneContactSection;
export const SecondaryStructure = MDSecondaryStructureSection;
export const Profiles = MDMembraneProfilesSection; 

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
