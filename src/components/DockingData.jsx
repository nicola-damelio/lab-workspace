import React from 'react';
import { seriesColorFor, chartBoxStyle } from '../utils/chartStyle';

/* ============================================================================
   DockingData — shared molecular-docking building blocks imported by
   DockingSections.jsx. Mirrors the structure of MDData.jsx, but every
   database / parser / generator is adapted for docking instead of MD.
============================================================================ */

// ================= RE-EXPORT SHARED STRUCTURE CODE =================
export {
  FS_CLASSES,
  OVERLAY_CLASSES,
  SELECT_COLOR,
  MANUAL_COLOR,
  LINE_COLORS,
  AMINO_ACID_DB,
  NUCLEOTIDE_DB,
  SUGAR_DB,
  LIPID_DB,
  CARBON_RANGE_DB,
  SS_CORRECTIONS,
  SS_META,
  FORM_META,
  DNA_FORM_OFFSETS,
  SUGAR_ANOMER_OFFSETS,
  RESIDUE_COLORS,
  TICKS_1H,
  TICKS_13C,
  TICKS_15N,
  CHART_MARGIN,
  CHART_MARGIN_1D,
  parseManual,
  getNMRFillColor,
  getCarbonName,
  buildKeys,
  getProtonCountEx,
  getPascalRow,
  getCarbonRangeFor,
  getHexagon,
  getPentagon,
  hexAt,
  fusePentagon,
  makeBuilder,
  buildProteinStructure,
  buildNucleicStructure,
  buildSugarStructure,
  buildLipidStructure,
  elementsToSVG,
  ensureSvgSize,
  svgToPngDataUrl,
  StructureSVGView,
  CollapsibleSection,
  SequencePaintStrip,
  CustomXTick1H,
  CustomYTick1H,
  CustomXTick13C,
  CustomYTick13C,
  NMRTooltip,
  RangeBarChart,
  OneDSpectrumPlot,
  SpectrumPlot,
  HSQCPlot,
  CHEMICAL_SHIFT_LAYER,
  makeLayerId,
  getSelectedKeys,
  selectionLabel,
  getManualKeys,
  normalizeImageCandidates,
  SmartImage
} from './NMRData';

// ================= DOCKING-SPECIFIC CONSTANTS =================
export const DOCK_SELECT_COLOR = '#f59e0b';
export const DOCK_MANUAL_COLOR = '#16a34a';
export const DOCK_LINE_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16'
];
export const DOCK_CHART_MARGIN = { top: 20, right: 20, bottom: 45, left: 50 };
export const DOCK_CHART_MARGIN_1D = { top: 10, right: 15, bottom: 45, left: 15 };

// ================= DOCKING PROGRAMS =================
export const DOCKING_PROGRAMS = {
  vina: {
    name: 'AutoDock Vina',
    versions: ['1.1.2', '1.2.0', '1.2.2', '1.2.3', '1.2.4', '1.2.5'],
    scoringFunctions: ['vina', 'vinardo'],
    searchAlgorithms: ['Iterated local search', 'Monte Carlo'],
    energyUnit: 'kcal/mol',
    description: 'AutoDock Vina — gradient-based local search docking',
    fileFormats: ['config.txt', 'out.pdbqt', 'log.txt']
  },
  autodock4: {
    name: 'AutoDock 4',
    versions: ['4.2', '4.2.6'],
    scoringFunctions: ['autodock4'],
    searchAlgorithms: ['Lamarckian GA', 'Genetic Algorithm', 'Local Search', 'Simulated Annealing'],
    energyUnit: 'kcal/mol',
    description: 'AutoDock 4 — Lamarckian genetic-algorithm docking',
    fileFormats: ['.dpf', '.gpf', '.dlg']
  },
  autodock_gpu: {
    name: 'AutoDock-GPU',
    versions: ['1.5', '1.6'],
    scoringFunctions: ['autodock4'],
    searchAlgorithms: ['ADADELGA', 'Solis-Wets', 'Firefly'],
    energyUnit: 'kcal/mol',
    description: 'GPU-accelerated AutoDock',
    fileFormats: ['.xml', '.dlg']
  },
  haddock: {
    name: 'HADDOCK',
    versions: ['2.4', '2.5', '3.0 (web)'],
    scoringFunctions: ['haddock-score'],
    searchAlgorithms: ['Rigid-body (it0)', 'Semi-flexible (it1)', 'Water refinement (it1w)'],
    energyUnit: 'a.u.',
    description: 'HADDOCK — ambiguity-driven biomolecular docking',
    fileFormats: ['.csv', '.param', '.tbl']
  },
  glide: {
    name: 'Glide (Schrödinger)',
    versions: ['SP', 'XP', 'IFD'],
    scoringFunctions: ['GlideScore-SP', 'GlideScore-XP'],
    searchAlgorithms: ['HTVS', 'SP', 'XP'],
    energyUnit: 'kcal/mol',
    description: 'Schrödinger Glide docking',
    fileFormats: ['.maegz', '.csv']
  },
  gold: {
    name: 'GOLD',
    versions: ['2022', '2023'],
    scoringFunctions: ['GoldScore', 'ChemScore', 'ASP', 'ChemPLP'],
    searchAlgorithms: ['Genetic Algorithm'],
    energyUnit: 'a.u.',
    description: 'CCDC GOLD genetic-algorithm docking',
    fileFormats: ['_results.mol2', '_table.csv']
  }
};

// ================= DOCKING METRICS =================
export const DOCKING_METRICS = [
  { key: 'affinity', label: 'Affinity', unit: 'kcal/mol', description: 'Binding affinity / docking score' },
  { key: 'rmsd_lb', label: 'RMSD l.b.', unit: 'Å', description: 'RMSD lower bound from best mode' },
  { key: 'rmsd_ub', label: 'RMSD u.b.', unit: 'Å', description: 'RMSD upper bound from best mode' },
  { key: 'population', label: 'Population', unit: '%', description: 'Cluster population' },
  { key: 'energy_total', label: 'Total Energy', unit: 'kcal/mol', description: 'Total binding energy' },
  { key: 'energy_inter', label: 'Intermolecular', unit: 'kcal/mol', description: 'Intermolecular energy' },
  { key: 'energy_intra', label: 'Intramolecular', unit: 'kcal/mol', description: 'Intramolecular / internal energy' },
  { key: 'energy_torsional', label: 'Torsional', unit: 'kcal/mol', description: 'Torsional free energy' },
  { key: 'energy_elec', label: 'Electrostatic', unit: 'kcal/mol', description: 'Electrostatic energy' },
  { key: 'energy_vdw', label: 'vdW + Hbond + desolv', unit: 'kcal/mol', description: 'van der Waals + H-bond + desolvation' },
  { key: 'energy_desolv', label: 'Desolvation', unit: 'kcal/mol', description: 'Desolvation energy' },
  { key: 'energy_air', label: 'AIR', unit: 'a.u.', description: 'Ambiguous Interaction Restraints (HADDOCK)' },
  { key: 'bsa', label: 'BSA', unit: 'Å²', description: 'Buried surface area' },
  { key: 'fcc', label: 'FCC', unit: '', description: 'Fraction of common contacts (HADDOCK)' },
  { key: 'h_bonds', label: 'H-Bonds', unit: 'count', description: 'Hydrogen bonds at interface' },
  { key: 'contacts', label: 'Contacts', unit: 'count', description: 'Interface contacts' },
  { key: 'ki', label: 'Ki', unit: 'nM', description: 'Estimated inhibition constant' }
];

// ================= DOCKING FILE FORMATS =================
export const DOCKING_FILE_FORMATS = [
  { key: 'vina_config', label: 'Vina config (.txt)', ext: '.txt' },
  { key: 'vina_out', label: 'Vina output log', ext: '.log' },
  { key: 'pdbqt', label: 'AutoDock PDBQT', ext: '.pdbqt' },
  { key: 'dlg', label: 'AutoDock DLG (.dlg)', ext: '.dlg' },
  { key: 'dpf', label: 'AutoDock DPF (.dpf)', ext: '.dpf' },
  { key: 'gpf', label: 'AutoDock GPF (.gpf)', ext: '.gpf' },
  { key: 'haddock_csv', label: 'HADDOCK scores (.csv)', ext: '.csv' },
  { key: 'haddock_param', label: 'HADDOCK params (.param)', ext: '.param' }
];

// ================= DOCKING PIPELINE STAGES =================
export const DOCKING_PIPELINE_STAGES = [
  { key: 'prep_receptor', label: 'Receptor Preparation', icon: '🧬' },
  { key: 'prep_ligand', label: 'Ligand Preparation', icon: '⬡' },
  { key: 'grid', label: 'Grid / Box Setup', icon: '📦' },
  { key: 'docking', label: 'Docking Run', icon: '🎯' },
  { key: 'scoring', label: 'Scoring / Ranking', icon: '🏆' },
  { key: 'analysis', label: 'Pose Analysis', icon: '📈' }
];

// ================= VALUE / LOOKUP HELPERS =================
export const parseDockingValue = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

export const getProgramInfo = (key) => DOCKING_PROGRAMS[key] || DOCKING_PROGRAMS.vina;
export const getProgramVersions = (key) => getProgramInfo(key).versions || [];
export const getScoringFunctions = (key) => getProgramInfo(key).scoringFunctions || [];
export const getSearchAlgorithms = (key) => getProgramInfo(key).searchAlgorithms || [];

// ================= CSV LINE PARSER =================
const parseCsvLine = (line) => {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => String(s).trim());
};

// ================= AUTODOCK VINA OUTPUT PARSER =================
// Parses the classic Vina results table:
//   mode | affinity (kcal/mol) | rmsd l.b. | rmsd u.b.
export const parseVinaOutput = (text) => {
  const poses = [];
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*$/);
    if (m) {
      poses.push({
        mode: parseInt(m[1], 10),
        affinity: parseFloat(m[2]),
        rmsd_lb: parseFloat(m[3]),
        rmsd_ub: parseFloat(m[4]),
        program: 'vina'
      });
    }
  }
  return poses;
};

// ================= AUTODOCK 4 .dlg PARSER =================
// Extracts per-run binding energies and energy components from a DLG file.
export const parseAutoDockDlg = (text) => {
  const poses = [];
  const lines = String(text || '').split(/\r?\n/);
  let current = null;
  const num = (s) => {
    const m = String(s).match(/-?\d+\.?\d*/);
    return m ? parseFloat(m[0]) : null;
  };
  for (const line of lines) {
    if (/Estimated Free Energy of Binding/i.test(line)) {
      if (current) poses.push(current);
      current = {
        mode: poses.length + 1,
        affinity: num(line),
        energy_total: num(line),
        program: 'autodock4'
      };
    } else if (current) {
      if (/Final Intermolecular Energy/i.test(line)) current.energy_inter = num(line);
      else if (/vdW \+ Hbond \+ desolv Energy/i.test(line)) current.energy_vdw = num(line);
      else if (/Electrostatic Energy/i.test(line)) current.energy_elec = num(line);
      else if (/Final Total Internal Energy/i.test(line)) current.energy_intra = num(line);
      else if (/Torsional Free Energy/i.test(line)) current.energy_torsional = num(line);
      else if (/Unbound System's Energy/i.test(line)) current.energy_unbound = num(line);
      else if (/Estimated Inhibition Constant/i.test(line)) {
        const ki = num(line);
        if (ki != null) current.ki = ki;
      }
    }
  }
  if (current) poses.push(current);
  poses.forEach((p, i) => { p.mode = i + 1; });
  return poses;
};

// ================= HADDOCK CSV SCORE PARSER =================
const HADDOCK_FIELD_ALIASES = {
  label: ['filename', 'structure', 'name', 'model', 'structure_name'],
  itw: ['itw', 'run', 'iteration'],
  fcc: ['fcc', 'fraction_common_contacts'],
  rmsd: ['rmsd', 'rmsd_all', 'rmsd_from_best'],
  affinity: ['total', 'haddock-score', 'haddock_score', 'score', 'total_score'],
  energy_air: ['air', 'air_energy', 'desolvair', 'ambig'],
  energy_desolv: ['desolv', 'desolvation', 'desolv_energy'],
  bsa: ['bsa', 'buried_surface_area', 'bsurface'],
  energy_vdw: ['vdw', 'vdw_energy', 'van_der_waals', 'evdw'],
  energy_elec: ['elec', 'electrostatics', 'elec_energy', 'eelec'],
  cluster_rank: ['cluster_rank', 'rank', 'cluster'],
  cluster_size: ['cluster_size', 'clustersize', 'n_members']
};

const matchHADDOCKField = (header, field) => {
  const aliases = HADDOCK_FIELD_ALIASES[field] || [field];
  for (const a of aliases) {
    const idx = header.findIndex((h) => h.toLowerCase().replace(/[\s-]/g, '_') === a);
    if (idx >= 0) return idx;
  }
  return -1;
};

export const parseHADDOCKScores = (text) => {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]);
  const poses = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    if (vals.length < 2) continue;
    const pose = { mode: i, program: 'haddock' };
    Object.keys(HADDOCK_FIELD_ALIASES).forEach((field) => {
      const idx = matchHADDOCKField(header, field);
      if (idx >= 0 && vals[idx] !== undefined && vals[idx] !== '') {
        const n = parseDockingValue(vals[idx]);
        pose[field] = n !== null ? n : vals[idx];
      }
    });
    if (pose.affinity === undefined) pose.affinity = pose.energy_air || 0;
    poses.push(pose);
  }
  return poses;
};

// ================= VINA CONFIG PARSER =================
export const parseVinaConfig = (text) => {
  const updates = {};
  const get = (key) => {
    const m = new RegExp(`^\\s*${key}\\s*=\\s*(.+)`, 'im').exec(text);
    return m ? m[1].trim() : null;
  };
  const num = (k) => {
    const v = get(k);
    return v != null ? parseDockingValue(v) : null;
  };
  const map = [
    ['center_x', 'boxCenterX'], ['center_y', 'boxCenterY'], ['center_z', 'boxCenterZ'],
    ['size_x', 'boxSizeX'], ['size_y', 'boxSizeY'], ['size_z', 'boxSizeZ'],
    ['exhaustiveness', 'exhaustiveness'], ['num_modes', 'numModes'],
    ['energy_range', 'energyRange'], ['seed', 'seed'], ['cpu', 'cpu']
  ];
  map.forEach(([src, dst]) => {
    const v = num(src);
    if (v !== null) updates[dst] = String(v);
  });
  const receptor = get('receptor');
  if (receptor) updates.receptorFile = receptor;
  const ligand = get('ligand');
  if (ligand) updates.ligandFile = ligand;
  if (Object.keys(updates).length) updates.dockingProgram = 'vina';
  return updates;
};

// ================= AUTODOCK DPF (docking parameters) PARSER =================
export const parseAutoDockDPF = (text) => {
  const updates = {};
  const get = (key) => {
    const m = new RegExp(`^\\s*${key}\\s+(.+)`, 'im').exec(text);
    return m ? m[1].trim().split(/\s+/)[0] : null;
  };
  const map = [
    ['ga_run', 'numRuns'],
    ['ga_pop_size', 'populationSize'],
    ['ga_num_evals', 'numEvaluations'],
    ['ga_num_generations', 'numGenerations'],
    ['ga_mutation_rate', 'mutationRate'],
    ['ga_crossover_rate', 'crossoverRate'],
    ['ga_elitism', 'elitism'],
    ['seed', 'seed'],
    ['sw_max_its', 'localSearchIterations'],
    ['sw_max_succ', 'localSearchSuccesses'],
    ['ls_search_freq', 'localSearchFreq'],
    ['set_psw1', null]
  ];
  map.forEach(([src, dst]) => {
    if (!dst) return;
    const v = get(src);
    if (v != null) updates[dst] = v;
  });
  if (get('ga_run') || get('ga_pop_size')) updates.searchAlgorithm = 'Lamarckian GA';
  if (Object.keys(updates).length) updates.dockingProgram = 'autodock4';
  return updates;
};

// ================= AUTODOCK GPF (grid parameters) PARSER =================
export const parseGridGPF = (text) => {
  const updates = {};
  const get = (key) => {
    const m = new RegExp(`^\\s*${key}\\s+(.+)`, 'im').exec(text);
    return m ? m[1].trim() : null;
  };
  const npts = get('npts');
  if (npts) {
    updates.gridDims = npts;
    const parts = npts.split(/\s+/).map((p) => parseInt(p, 10));
    if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
      updates.boxSizeX = String(Math.round(parts[0] / 8));
      updates.boxSizeY = String(Math.round(parts[1] / 8));
      updates.boxSizeZ = String(Math.round(parts[2] / 8));
    }
  }
  const spacing = get('spacing');
  if (spacing) updates.gridSpacing = spacing;
  const center = get('gridcenter');
  if (center && center !== 'auto') {
    const parts = center.split(/\s+/).map((p) => parseFloat(p));
    if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
      updates.boxCenterX = String(parts[0]);
      updates.boxCenterY = String(parts[1]);
      updates.boxCenterZ = String(parts[2]);
    }
  }
  const types = get('types');
  if (types) updates.atomTypes = types;
  if (Object.keys(updates).length) updates.dockingProgram = 'autodock4';
  return updates;
};

// ================= HADDOCK PARAMETER PARSER =================
export const parseHADDOCKParams = (text) => {
  const updates = {};
  const get = (key) => {
    const m = new RegExp(`${key}\\s*[:=]\\s*([^,\\s]+)`, 'im').exec(text);
    return m ? m[1].trim() : null;
  };
  const map = [
    ['mdsteps_rigid', 'mdStepsRigid'],
    ['mdsteps_semi', 'mdStepsSemiFlex'],
    ['mdsteps_flex', 'mdStepsFlex'],
    ['sampl', 'sampling'],
    ['structures_it0', 'structuresIt0'],
    ['structures_it1', 'structuresIt1'],
    ['structures_w', 'structuresWater'],
    ['waterrefine', 'waterRefine'],
    ['ambig', 'ambigTbl'],
    ['randorien', 'randomOrientation']
  ];
  map.forEach(([src, dst]) => {
    const v = get(src);
    if (v != null) updates[dst] = v;
  });
  if (Object.keys(updates).length) updates.dockingProgram = 'haddock';
  return updates;
};

// ================= MASTER FILE DISPATCHER =================
// Detects the file type and returns either poses (results) or updates (params).
export const parseDockingFile = (text, filename) => {
  const lower = (filename || '').toLowerCase();

  if (lower.endsWith('.dlg')) {
    const poses = parseAutoDockDlg(text);
    return { type: 'dlg', program: 'autodock4', poses, updates: { dockingProgram: 'autodock4' } };
  }
  if (lower.endsWith('.gpf')) {
    return { type: 'gpf', program: 'autodock4', poses: [], updates: parseGridGPF(text) };
  }
  if (lower.endsWith('.dpf')) {
    return { type: 'dpf', program: 'autodock4', poses: [], updates: parseAutoDockDPF(text) };
  }
  if (lower.endsWith('.csv')) {
    const poses = parseHADDOCKScores(text);
    if (poses.length) return { type: 'haddock_csv', program: 'haddock', poses, updates: { dockingProgram: 'haddock' } };
  }
  if (lower.endsWith('.param') || lower.endsWith('.cfg') || lower.includes('haddock')) {
    return { type: 'haddock_param', program: 'haddock', poses: [], updates: parseHADDOCKParams(text) };
  }

  // Vina config vs Vina output — try config first (key=value), then the table.
  const vinaCfg = parseVinaConfig(text);
  if (Object.keys(vinaCfg).length) {
    return { type: 'vina_config', program: 'vina', poses: [], updates: vinaCfg };
  }
  const vinaPoses = parseVinaOutput(text);
  if (vinaPoses.length) {
    return { type: 'vina_out', program: 'vina', poses: vinaPoses, updates: { dockingProgram: 'vina' } };
  }
  return { type: 'unknown', program: null, poses: [], updates: {} };
};

// ================= URL / FORMAT HELPERS =================
export const normalizeDockingUrl = (url) => {
  const u = (url || '').trim();
  if (!u) return { url: null, fallbacks: [] };
  let m = u.match(/drive.google.com\/file\/d\/([^/?]+)/);
  if (m) {
    const id = m[1];
    return {
      url: `https://lh3.googleusercontent.com/d/${id}`,
      fallbacks: [
        `https://drive.google.com/thumbnail?id=${id}&sz=w1600`,
        `https://drive.google.com/uc?export=view&id=${id}`
      ]
    };
  }
  m = u.match(/drive.google.com\/(?:open|uc)[^#]*[?&]id=([^&#]+)/);
  if (m) {
    const id = m[1];
    return {
      url: `https://lh3.googleusercontent.com/d/${id}`,
      fallbacks: [
        `https://drive.google.com/thumbnail?id=${id}&sz=w1600`,
        `https://drive.google.com/uc?export=view&id=${id}`
      ]
    };
  }
  if (u.includes('dropbox.com')) {
    const raw = u.replace(/[?&]dl=0/g, '') + (u.includes('?') ? '&raw=1' : '?raw=1');
    return { url: raw, fallbacks: [u] };
  }
  return { url: u, fallbacks: [] };
};

export const detectDockingFormat = (url) => {
  const u = (url || '').toLowerCase();
  if (u.endsWith('.dlg')) return 'dlg';
  if (u.endsWith('.dpf')) return 'dpf';
  if (u.endsWith('.gpf')) return 'gpf';
  if (u.endsWith('.pdbqt')) return 'pdbqt';
  if (u.endsWith('.csv')) return 'haddock_csv';
  return 'vina_out';
};

// ================= DOCKING INSTANCE / LAYER MODEL =================
// Mirrors the MD instance/layer model, but "cells" are keyed by pose + metric.
export const DOCKING_DEFAULT_LAYER = {
  key: 'dock',
  label: 'Docking Scores',
  unit: 'kcal/mol',
  builtin: true
};

export const makeDockingInstanceId = () =>
  `dockinst_${Date.now()}_${Math.random().toString(16).slice(2)}`;

export const getDockingInstances = (activeTest) => {
  if (Array.isArray(activeTest.instances) && activeTest.instances.length) {
    return activeTest.instances;
  }
  return [
    {
      id: 'dockinst_default',
      name: 'Docking Run 1',
      values: activeTest.dockingValues || {}
    }
  ];
};

export const getDockingActiveInstance = (activeTest) => {
  const insts = getDockingInstances(activeTest);
  return insts.find((i) => i.id === activeTest.activeInstanceId) || insts[0] || null;
};

export const getDockingLayers = (activeTest) => [
  DOCKING_DEFAULT_LAYER,
  ...(Array.isArray(activeTest.dockingLayers) ? activeTest.dockingLayers : [])
];

export const getDockingActiveLayerKey = (activeTest) =>
  activeTest.activeDockingLayerKey || 'dock';

export const getDockingLayerValues = (instance, layerKey) =>
  (instance && instance.values && instance.values[layerKey]) || {};

export const writeDockingCellValue = (
  activeTest,
  updateActiveTest,
  layerKey,
  cellKey,
  value
) => {
  if (!updateActiveTest) return;
  const activeInstance = getDockingActiveInstance(activeTest);
  const dockingValues = { ...(activeTest.dockingValues || {}) };
  dockingValues[layerKey] = {
    ...(dockingValues[layerKey] || {}),
    [cellKey]: value
  };
  if (
    Array.isArray(activeTest.instances) &&
    activeTest.instances.length &&
    activeInstance
  ) {
    const instances = activeTest.instances.map((inst) => {
      if (inst.id !== activeInstance.id) return inst;
      return {
        ...inst,
        values: {
          ...(inst.values || {}),
          [layerKey]: {
            ...((inst.values || {})[layerKey] || {}),
            [cellKey]: value
          }
        }
      };
    });
    updateActiveTest({ instances, dockingValues });
    return;
  }
  updateActiveTest({ dockingValues });
};

// ================= DEMO DATA GENERATORS =================
export const generateDockingPoses = (n = 9, baseAffinity = -8.5) => {
  const poses = [];
  for (let i = 0; i < n; i++) {
    const aff = baseAffinity + i * 0.35 + (Math.random() - 0.5) * 0.2;
    poses.push({
      mode: i + 1,
      affinity: +aff.toFixed(2),
      rmsd_lb: i === 0 ? 0 : +(Math.random() * 3 + 0.5).toFixed(3),
      rmsd_ub: i === 0 ? 0 : +(Math.random() * 4 + 1).toFixed(3),
      energy_inter: +(aff - 0.6).toFixed(2),
      energy_intra: +0.6.toFixed(2),
      energy_torsional: +(Math.random() * 0.8).toFixed(2),
      energy_elec: +(-(Math.random() * 2)).toFixed(2),
      energy_vdw: +(aff * 0.8).toFixed(2),
      h_bonds: Math.floor(Math.random() * 6),
      contacts: 15 + Math.floor(Math.random() * 25),
      program: 'vina'
    });
  }
  return poses;
};

export const generateHADDOCKPoses = (n = 20) => {
  const poses = [];
  for (let i = 0; i < n; i++) {
    const total = -45 + i * 1.2 + (Math.random() - 0.5) * 3;
    poses.push({
      mode: i + 1,
      label: `structure_${i + 1}w.pdb`,
      affinity: +total.toFixed(2),
      energy_air: +(-(12 + Math.random() * 5)).toFixed(2),
      energy_desolv: +(Math.random() * 8).toFixed(2),
      bsa: 1100 + Math.floor(Math.random() * 500),
      energy_vdw: +(-(20 + Math.random() * 8)).toFixed(2),
      energy_elec: +(-(12 + Math.random() * 8)).toFixed(2),
      rmsd: +(1 + Math.random() * 3).toFixed(2),
      fcc: +(Math.random() * 0.6).toFixed(3),
      program: 'haddock'
    });
  }
  return poses.sort((a, b) => a.affinity - b.affinity);
};

// ================= DOCKING CHART STYLE =================
export const DEFAULT_DOCKING_CHART_STYLE = {
  height: 380,
  aspect: 1,
  fontSize: 16,
  tickStep: '',
  tickAngle: 0,
  pointStyle: 'circle',
  ptSize: 5,
  lineStyle: 'solid',
  lineThickness: 2,
  legend: 'top',
  colors: {},
  barRadius: 3,
  xMin: '',
  xMax: '',
  yMin: '',
  yMax: '',
  xAxisLabel: '',
  yAxisLabel: ''
};

// ================= GENERIC CHART HELPERS =================
export const dockLineDash = (style) => {
  if (style === 'dashed') return '7 5';
  if (style === 'dotted') return '2 3';
  return undefined;
};

export const dockSeriesColor = (cfg, key, idx, total) => seriesColorFor(cfg, key, idx, total);

export const dockMakeTicks = (domain, stepStr) => {
  const step = parseDockingValue(stepStr);
  if (!step || step <= 0 || !Array.isArray(domain)) return undefined;
  const [a, b] = [Math.min(domain[0], domain[1]), Math.max(domain[0], domain[1])];
  const out = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) {
    out.push(parseFloat(v.toFixed(6)));
  }
  return out.length ? out : undefined;
};

export const dockDom = (v) => {
  if (v === '' || v == null || parseDockingValue(v) === null) return undefined;
  return parseDockingValue(v);
};

export const dockChartBoxStyle = (cfg, opts) => chartBoxStyle(cfg, opts);

// ================= EXPORT DEFAULT =================
export default {
  DOCKING_PROGRAMS,
  DOCKING_METRICS,
  DOCKING_FILE_FORMATS,
  DOCKING_PIPELINE_STAGES,
  parseDockingValue,
  getProgramInfo,
  getProgramVersions,
  getScoringFunctions,
  getSearchAlgorithms,
  parseVinaOutput,
  parseAutoDockDlg,
  parseHADDOCKScores,
  parseVinaConfig,
  parseAutoDockDPF,
  parseGridGPF,
  parseHADDOCKParams,
  parseDockingFile,
  normalizeDockingUrl,
  detectDockingFormat,
  DOCKING_DEFAULT_LAYER,
  makeDockingInstanceId,
  getDockingInstances,
  getDockingActiveInstance,
  getDockingLayers,
  getDockingActiveLayerKey,
  getDockingLayerValues,
  writeDockingCellValue,
  generateDockingPoses,
  generateHADDOCKPoses,
  DEFAULT_DOCKING_CHART_STYLE,
  dockLineDash,
  dockSeriesColor,
  dockMakeTicks,
  dockDom,
  dockChartBoxStyle
};