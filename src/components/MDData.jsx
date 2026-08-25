


import { MD_TAB_CONFIG } from './tabConfigs';

/* ============================================================================
   MDData — shared MD building blocks imported by MDSections.jsx
========================================================================== */

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

// ================= MD-SPECIFIC CONSTANTS =================
export const MD_SELECT_COLOR = '#f59e0b';
export const MD_MANUAL_COLOR = '#16a34a';

export const MD_LINE_COLORS = [
  '#3b82f6',
  '#ef4444',
  '#22c55e',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#6366f1',
  '#84cc16'
];

export const MD_CHART_MARGIN = {
  top: 20,
  right: 20,
  bottom: 45,
  left: 50
};

export const MD_CHART_MARGIN_1D = {
  top: 10,
  right: 15,
  bottom: 45,
  left: 15
};

// ================= FORCE FIELD DATABASES =================
export const FORCE_FIELDS = {
  GROMOS: {
    name: 'GROMOS',
    versions: ['54a7', '54a8', '53a6', '45a3'],
    description: 'GROMOS united-atom force field family',
    atomTypes: {
      protein: {
        backbone: [
          { name: 'N', type: 'N', mass: 14.007, charge: -0.47, description: 'Backbone amide N' },
          { name: 'HN', type: 'H', mass: 1.008, charge: 0.31, description: 'Backbone amide H' },
          { name: 'CA', type: 'CH1', mass: 13.019, charge: 0.07, description: 'Cα' },
          { name: 'HA', type: 'H', mass: 1.008, charge: 0.077, description: 'Hα' },
          { name: 'C', type: 'C', mass: 12.011, charge: 0.51, description: 'Carbonyl C' },
          { name: 'O', type: 'O', mass: 15.999, charge: -0.51, description: 'Carbonyl O' }
        ]
      },
      water: [
        { name: 'OW', type: 'OW', mass: 15.999, charge: -0.82, description: 'Water oxygen' },
        { name: 'HW1', type: 'HW', mass: 1.008, charge: 0.41, description: 'Water hydrogen 1' },
        { name: 'HW2', type: 'HW', mass: 1.008, charge: 0.41, description: 'Water hydrogen 2' }
      ]
    }
  },

  OPLS: {
    name: 'OPLS-AA/M',
    versions: ['opls-aa', 'opls-aa/m', 'opls2005', 'opls3e', 'opls4'],
    description: 'OPLS all-atom / mixed force field family',
    atomTypes: {
      protein: {
        backbone: [
          { name: 'N', type: 'opls_238', mass: 14.007, charge: -0.5, description: 'Backbone amide N' },
          { name: 'HN', type: 'opls_240', mass: 1.008, charge: 0.3, description: 'Backbone amide H' },
          { name: 'CA', type: 'opls_224', mass: 13.019, charge: 0.14, description: 'Cα' },
          { name: 'HA', type: 'opls_140', mass: 1.008, charge: 0.095, description: 'Hα' },
          { name: 'C', type: 'opls_235', mass: 12.011, charge: 0.5, description: 'Carbonyl C' },
          { name: 'O', type: 'opls_236', mass: 15.999, charge: -0.5, description: 'Carbonyl O' }
        ]
      },
      water: [
        { name: 'OW', type: 'opls_111', mass: 15.999, charge: -0.834, description: 'TIP4P water O' },
        { name: 'HW1', type: 'opls_112', mass: 1.008, charge: 0.417, description: 'TIP4P water H' },
        { name: 'HW2', type: 'opls_112', mass: 1.008, charge: 0.417, description: 'TIP4P water H' }
      ]
    }
  },

  CHARMM: {
    name: 'CHARMM',
    versions: ['charmm27', 'charmm36', 'charmm36m', 'cgenff'],
    description: 'CHARMM all-atom force field family',
    atomTypes: {
      protein: {
        backbone: [
          { name: 'N', type: 'NH1', mass: 14.007, charge: -0.47, description: 'Backbone amide N' },
          { name: 'HN', type: 'H', mass: 1.008, charge: 0.31, description: 'Backbone amide H' },
          { name: 'CA', type: 'CT1', mass: 12.011, charge: 0.07, description: 'Cα' },
          { name: 'HA', type: 'HB1', mass: 1.008, charge: 0.09, description: 'Hα' },
          { name: 'C', type: 'C', mass: 12.011, charge: 0.51, description: 'Carbonyl C' },
          { name: 'O', type: 'O', mass: 15.999, charge: -0.51, description: 'Carbonyl O' }
        ]
      },
      water: [
        { name: 'OW', type: 'OT', mass: 15.999, charge: -0.834, description: 'TIP3P water O' },
        { name: 'HW1', type: 'HT', mass: 1.008, charge: 0.417, description: 'TIP3P water H' },
        { name: 'HW2', type: 'HT', mass: 1.008, charge: 0.417, description: 'TIP3P water H' }
      ]
    }
  },

  AMBER: {
    name: 'AMBER',
    versions: ['ff99SB', 'ff14SB', 'ff19SB', 'GAFF2'],
    description: 'AMBER biomolecular force field family',
    atomTypes: {
      protein: {
        backbone: [
          { name: 'N', type: 'N', mass: 14.007, charge: -0.4157, description: 'Backbone amide N' },
          { name: 'HN', type: 'H', mass: 1.008, charge: 0.2719, description: 'Backbone amide H' },
          { name: 'CA', type: 'CT', mass: 12.011, charge: 0.0337, description: 'Cα' },
          { name: 'HA', type: 'H1', mass: 1.008, charge: 0.0823, description: 'Hα' },
          { name: 'C', type: 'C', mass: 12.011, charge: 0.5973, description: 'Carbonyl C' },
          { name: 'O', type: 'O', mass: 15.999, charge: -0.5679, description: 'Carbonyl O' }
        ]
      },
      water: [
        { name: 'OW', type: 'OW', mass: 15.999, charge: -0.834, description: 'TIP3P water O' },
        { name: 'HW1', type: 'HW', mass: 1.008, charge: 0.417, description: 'TIP3P water H' },
        { name: 'HW2', type: 'HW', mass: 1.008, charge: 0.417, description: 'TIP3P water H' }
      ]
    }
  },

  MARTINI: {
    name: 'Martini',
    versions: ['2.2', '3.0'],
    description: 'Martini coarse-grained force field',
    atomTypes: {
      protein: {
        backbone: [
          { name: 'BB', type: 'P5', mass: 72.0, charge: 0.0, description: 'Martini backbone bead' }
        ]
      },
      water: [
        { name: 'W', type: 'W', mass: 72.0, charge: 0.0, description: 'Martini water bead' }
      ]
    }
  }
};

// ================= MD WATER MODELS =================
export const WATER_MODELS = {
  TIP3P: {
    name: 'TIP3P',
    sites: 3,
    description: 'Transferable Intermolecular Potential 3-point'
  },
  TIP4P: {
    name: 'TIP4P',
    sites: 4,
    description: 'Transferable Intermolecular Potential 4-point'
  },
  SPC: {
    name: 'SPC',
    sites: 3,
    description: 'Simple Point Charge'
  },
  SPCE: {
    name: 'SPC/E',
    sites: 3,
    description: 'Simple Point Charge / Extended'
  },
  SPC_E: {
    name: 'SPC/E',
    sites: 3,
    description: 'Simple Point Charge / Extended'
  },
  TIP5P: {
    name: 'TIP5P',
    sites: 5,
    description: 'Transferable Intermolecular Potential 5-point'
  },
  OPC: {
    name: 'OPC',
    sites: 4,
    description: 'Optimal Point Charge'
  }
};

// ================= MD ENSEMBLES =================
export const MD_ENSEMBLES = [
  { key: 'NVE', label: 'NVE (Microcanonical)', description: 'Constant N, V, E' },
  { key: 'NVT', label: 'NVT (Canonical)', description: 'Constant N, V, T' },
  { key: 'NPT', label: 'NPT (Isothermal-Isobaric)', description: 'Constant N, P, T' },
  { key: 'NPH', label: 'NPH (Isoenthalpic-Isobaric)', description: 'Constant N, P, H' },
  { key: 'muVT', label: 'μVT (Grand Canonical)', description: 'Constant μ, V, T' }
];

// ================= MD INTEGRATORS =================
export const MD_INTEGRATORS = [
  { key: 'verlet', label: 'Velocity Verlet' },
  { key: 'leapfrog', label: 'Leap-frog Verlet' },
  { key: 'beeman', label: 'Beeman' },
  { key: 'langevin', label: 'Langevin Dynamics' },
  { key: 'brownian', label: 'Brownian Dynamics' },
  { key: 'stochastic', label: 'Stochastic Dynamics (SD)' }
];

// ================= MD THERMOSTATS =================
export const MD_THERMOSTATS = [
  { key: 'nose_hoover', label: 'Nosé-Hoover' },
  { key: 'velocity_rescaling', label: 'Velocity Rescaling (V-rescale)' },
  { key: 'v_rescale', label: 'Velocity Rescaling (V-rescale)' },
  { key: 'berendsen', label: 'Berendsen' },
  { key: 'langevin', label: 'Langevin' },
  { key: 'andersen', label: 'Andersen' },
  { key: 'bussi', label: 'Bussi-Donadio-Parrinello' }
];

// ================= MD BAROSTATS =================
export const MD_BAROSTATS = [
  { key: 'parrinello_rahman', label: 'Parrinello-Rahman' },
  { key: 'berendsen', label: 'Berendsen' },
  { key: 'mttk', label: 'Martyna-Tobias-Klein (MTTK)' },
  { key: 'cresswell', label: 'Cresswell' }
];

// ================= MD ANALYSIS METRICS =================
export const MD_ANALYSIS_METRICS = [
  { key: 'rmsd', label: 'RMSD', unit: 'nm', description: 'Root Mean Square Deviation' },
  { key: 'rmsf', label: 'RMSF', unit: 'nm', description: 'Root Mean Square Fluctuation' },
  { key: 'rg', label: 'Rg', unit: 'nm', description: 'Radius of Gyration' },
  { key: 'sasa', label: 'SASA', unit: 'nm²', description: 'Solvent Accessible Surface Area' },
  { key: 'hbonds', label: 'H-Bonds', unit: 'count', description: 'Hydrogen Bonds' },
  { key: 'energy_potential', label: 'Potential Energy', unit: 'kJ/mol', description: 'Potential Energy' },
  { key: 'energy_kinetic', label: 'Kinetic Energy', unit: 'kJ/mol', description: 'Kinetic Energy' },
  { key: 'energy_total', label: 'Total Energy', unit: 'kJ/mol', description: 'Total Energy' },
  { key: 'temperature', label: 'Temperature', unit: 'K', description: 'System Temperature' },
  { key: 'pressure', label: 'Pressure', unit: 'bar', description: 'System Pressure' },
  { key: 'volume', label: 'Volume', unit: 'nm³', description: 'Box Volume' },
  { key: 'density', label: 'Density', unit: 'kg/m³', description: 'System Density' },
  { key: 'dihedral_phi', label: 'φ dihedral', unit: '°', description: 'Phi backbone dihedral' },
  { key: 'dihedral_psi', label: 'ψ dihedral', unit: '°', description: 'Psi backbone dihedral' },
  { key: 'dihedral_omega', label: 'ω dihedral', unit: '°', description: 'Omega backbone dihedral' },
  { key: 'distance', label: 'Distance', unit: 'nm', description: 'Inter-atomic distance' },
  { key: 'angle', label: 'Angle', unit: '°', description: 'Bond angle' },
  { key: 'msd', label: 'MSD', unit: 'nm²', description: 'Mean Square Displacement' }
];

// ================= TRAJECTORY FORMAT INFO =================
export const TRAJECTORY_FORMATS = [
  { key: 'xtc', label: 'XTC (GROMACS)', ext: '.xtc', binary: true },
  { key: 'trr', label: 'TRR (GROMACS)', ext: '.trr', binary: true },
  { key: 'dcd', label: 'DCD (CHARMM/NAMD)', ext: '.dcd', binary: true },
  { key: 'pdb_traj', label: 'PDB Trajectory', ext: '.pdb', binary: false },
  { key: 'gro', label: 'GRO (GROMACS)', ext: '.gro', binary: false },
  { key: 'netcdf', label: 'NetCDF (AMBER)', ext: '.nc', binary: true }
];

// ================= MD SIMULATION PHASES =================
export const MD_SIMULATION_PHASES = [
  { key: 'minimization', label: 'Energy Minimization', icon: '⬇️' },
  { key: 'equilibration_nvt', label: 'Equilibration NVT', icon: '🌡️' },
  { key: 'equilibration_npt', label: 'Equilibration NPT', icon: '📦' },
  { key: 'production', label: 'Production MD', icon: '🚀' },
  { key: 'steered', label: 'Steered MD (SMD)', icon: '🎯' },
  { key: 'replica_exchange', label: 'Replica Exchange (REMD)', icon: '🔄' },
  { key: 'metadynamics', label: 'Metadynamics', icon: '⛰️' },
  { key: 'umbrella', label: 'Umbrella Sampling', icon: '☂️' }
];

// ================= RANDOM COIL / SECONDARY STRUCTURE =================
export const RANDOM_COIL_DB = {
  A: { HA: 4.35, CA: 52.5, CB: 19.1, CO: 177.8 },
  C: { HA: 4.55, CA: 58.2, CB: 28.0, CO: 175.9 },
  D: { HA: 4.76, CA: 54.5, CB: 40.8, CO: 177.5 },
  E: { HA: 4.37, CA: 56.9, CB: 29.8, CO: 177.6 },
  F: { HA: 4.66, CA: 57.9, CB: 39.8, CO: 177.4 },
  G: { HA: 3.96, CA: 45.2, CB: null, CO: 174.6 },
  H: { HA: 4.76, CA: 55.3, CB: 31.3, CO: 175.3 },
  I: { HA: 4.20, CA: 61.3, CB: 38.3, CO: 177.8 },
  K: { HA: 4.38, CA: 56.6, CB: 32.4, CO: 177.9 },
  L: { HA: 4.47, CA: 55.4, CB: 41.9, CO: 178.9 },
  M: { HA: 4.52, CA: 55.5, CB: 32.6, CO: 177.5 },
  N: { HA: 4.75, CA: 53.3, CB: 38.6, CO: 176.6 },
  P: { HA: 4.44, CA: 63.1, CB: 31.9, CO: 178.1 },
  Q: { HA: 4.39, CA: 56.2, CB: 29.5, CO: 177.2 },
  R: { HA: 4.51, CA: 56.5, CB: 30.4, CO: 177.2 },
  S: { HA: 4.51, CA: 58.4, CB: 63.6, CO: 175.6 },
  T: { HA: 4.39, CA: 62.0, CB: 69.6, CO: 175.7 },
  V: { HA: 4.16, CA: 62.1, CB: 32.1, CO: 177.4 },
  W: { HA: 4.70, CA: 57.4, CB: 29.5, CO: 177.2 },
  Y: { HA: 4.66, CA: 57.9, CB: 38.9, CO: 177.2 }
};

// ================= MD-SPECIFIC HELPERS =================
export const parseMDValue = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

export const getForceFieldInfo = (ffKey) => {
  return FORCE_FIELDS[ffKey] || FORCE_FIELDS.GROMOS;
};

export const getWaterModelInfo = (wmKey) => {
  return WATER_MODELS[wmKey] || WATER_MODELS.TIP3P;
};

export const getFFVersions = (ffKey) => {
  const ff = getForceFieldInfo(ffKey);
  return ff?.versions || [];
};

export const getFFBackboneAtoms = (ffKey) => {
  const ff = getForceFieldInfo(ffKey);
  const backbone = ff?.atomTypes?.protein?.backbone || [];

  return backbone.map((a) => ({
    atom: a.name || a.atom || '',
    type: a.type || '',
    mass: a.mass != null ? a.mass : 0,
    charge: a.charge != null ? a.charge : 0,
    desc: a.description || a.desc || ''
  }));
};

export const findFFAtom = (ffKey, atomName) => {
  const atoms = getFFBackboneAtoms(ffKey);
  return atoms.find((a) => a.atom === atomName) || null;
};

export const FF_ATOM_TYPES = Object.keys(FORCE_FIELDS).reduce((acc, ffKey) => {
  acc[ffKey] = getFFBackboneAtoms(ffKey);
  return acc;
}, {});

export const getMDAtomTypes = (ffKey, molType) => {
  const ff = getForceFieldInfo(ffKey);

  if (!ff || !ff.atomTypes) return [];

  if (molType === 'protein') {
    return ff.atomTypes.protein?.backbone || [];
  }

  if (molType === 'water') {
    return ff.atomTypes.water || [];
  }

  return [];
};

export const generateMDAtomEntry = (resIdx, atomName, forceField, molType) => {
  const ff = getForceFieldInfo(forceField);
  const types = getMDAtomTypes(forceField, molType);
  const match = types.find((t) => (t.name || t.atom) === atomName);

  return {
    resIdx,
    atomName,
    type: match?.type || atomName,
    mass: match?.mass != null ? match.mass : 12.011,
    charge: match?.charge != null ? match.charge : 0.0,
    description: match?.description || ''
  };
};

export const getTrajectoryFormatInfo = (formatKey) => {
  return (
    TRAJECTORY_FORMATS.find((f) => f.key === formatKey) ||
    TRAJECTORY_FORMATS[0]
  );
};

// ================= TRAJECTORY URL NORMALIZATION =================
export const normalizeTrajectoryUrl = (url) => {
  const u = (url || '').trim();

  if (!u) {
    return {
      url: null,
      fallbacks: []
    };
  }

  let m = u.match(/drive\.google\.com\/file\/d\/([^/?]+)/);

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

  m = u.match(/drive\.google\.com\/(?:open|uc)[^#]*[?&]id=([^&#]+)/);

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
    const raw =
      u.replace(/[?&]dl=0/g, '') +
      (u.includes('?') ? '&raw=1' : '?raw=1');

    return {
      url: raw,
      fallbacks: [u]
    };
  }

  return {
    url: u,
    fallbacks: []
  };
};

export const detectTrajectoryFormat = (url) => {
  const u = (url || '').toLowerCase();

  if (u.endsWith('.xtc')) return 'xtc';
  if (u.endsWith('.trr')) return 'trr';
  if (u.endsWith('.dcd')) return 'dcd';
  if (u.endsWith('.nc')) return 'netcdf';
  if (u.endsWith('.gro')) return 'gro';
  if (u.includes('pdb') && u.includes('traj')) return 'pdb_traj';

  return 'xtc';
};

// ================= MD INSTANCE / LAYER MODEL =================
export const MD_DEFAULT_LAYER = {
  key: 'md',
  label: 'MD Parameters',
  unit: '',
  builtin: true
};

// Computed layers populated by the in-browser analyses (MD general parameters,
// membrane profiles / SCD). They only appear in the per-atom table and in the
// Per-Atom / Condition plot selectors once a calculation has stored values.
export const MD_ANALYSIS_LAYERS = [
  { key: 'analysis_rmsf', label: 'RMSF', unit: 'nm', computed: true },
  { key: 'analysis_rmsd', label: 'RMSD', unit: 'nm', computed: true },
  { key: 'analysis_rg', label: 'Rg', unit: 'nm', computed: true },
  { key: 'analysis_sasa', label: 'SASA', unit: 'nm²', computed: true },
  { key: 'analysis_scd', label: 'Order param |SCD|', unit: '', computed: true }
];

export const makeMDInstanceId = () => {
  return `mdinst_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

export const getMDInstances = (activeTest) => {
  if (Array.isArray(activeTest.instances) && activeTest.instances.length) {
    return activeTest.instances;
  }

  return [
    {
      id: 'mdinst_default',
      name: 'Simulation 1',
      values: activeTest.mdValues || {}
    }
  ];
};

export const getMDActiveInstance = (activeTest) => {
  const insts = getMDInstances(activeTest);
  return insts.find((i) => i.id === activeTest.activeInstanceId) || insts[0] || null;
};

export const getMDLayers = (activeTest) => {
  const base = [
    MD_DEFAULT_LAYER,
    ...(Array.isArray(activeTest.parameterLayers) ? activeTest.parameterLayers : [])
  ];
  // Only surface the computed analysis layers that already have values for the
  // active instance (so empty columns don't clutter the table before a run).
  const inst = getMDActiveInstance(activeTest);
  const has = (lk) => {
    if (!inst || !inst.values || !inst.values[lk]) return false;
    return Object.keys(inst.values[lk]).length > 0;
  };
  const analysis = MD_ANALYSIS_LAYERS.filter((l) => has(l.key));
  return [...base, ...analysis];
};

export const getMDActiveLayerKey = (activeTest) => {
  return activeTest.activeLayerKey || 'md';
};

export const getMDLayerValues = (instance, layerKey) => {
  return (instance && instance.values && instance.values[layerKey]) || {};
};

export const writeMDCellValue = (
  activeTest,
  updateActiveTest,
  layerKey,
  cellKey,
  value
) => {
  if (!updateActiveTest) return;

  const activeInstance = getMDActiveInstance(activeTest);

  const mdValues = { ...(activeTest.mdValues || {}) };
  mdValues[layerKey] = {
    ...(mdValues[layerKey] || {}),
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

    updateActiveTest({
      instances,
      mdValues
    });

    return;
  }

  updateActiveTest({ mdValues });
};
export const parseSimulationParameters = (text, filename) => {
  const updates = {};
  const lowerText = text.toLowerCase();
  const lowerName = (filename || '').toLowerCase();

  // ================= FORCE FIELD / WATER MODEL DETECTION =================
  // Runs on every file regardless of extension: force-field / water-model names
  // usually show up as #include lines, header comments, or filenames rather than
  // as a single "key = value" pair, so a keyword scan is more reliable here than
  // a line-anchored regex. First match wins.
  const FF_DETECT = [
    { key: 'CHARMM', needle: 'charmm36m', version: 'charmm36m' },
    { key: 'CHARMM', needle: 'charmm36', version: 'charmm36' },
    { key: 'CHARMM', needle: 'charmm27', version: 'charmm27' },
    { key: 'CHARMM', needle: 'cgenff', version: 'cgenff' },
    { key: 'AMBER', needle: 'ff19sb', version: 'ff19SB' },
    { key: 'AMBER', needle: 'ff14sb', version: 'ff14SB' },
    { key: 'AMBER', needle: 'ff99sb', version: 'ff99SB' },
    { key: 'AMBER', needle: 'gaff2', version: 'GAFF2' },
    { key: 'OPLS', needle: 'opls-aa/m', version: 'opls-aa/m' },
    { key: 'OPLS', needle: 'opls4', version: 'opls4' },
    { key: 'OPLS', needle: 'opls3e', version: 'opls3e' },
    { key: 'OPLS', needle: 'opls2005', version: 'opls2005' },
    { key: 'OPLS', needle: 'oplsaa', version: 'opls-aa' },
    { key: 'OPLS', needle: 'opls-aa', version: 'opls-aa' },
    { key: 'GROMOS', needle: '54a7', version: '54a7' },
    { key: 'GROMOS', needle: '54a8', version: '54a8' },
    { key: 'GROMOS', needle: '53a6', version: '53a6' },
    { key: 'GROMOS', needle: '45a3', version: '45a3' },
    { key: 'MARTINI', needle: 'martini3', version: '3.0' },
    { key: 'MARTINI', needle: 'martini2', version: '2.2' },
    { key: 'MARTINI', needle: 'martini', version: '3.0' }
  ];
  for (const entry of FF_DETECT) {
    if (lowerText.includes(entry.needle) || lowerName.includes(entry.needle)) {
      updates.forceField = entry.key;
      updates.forceFieldVersion = entry.version;
      break;
    }
  }

  const WATER_DETECT = [
    ['tip5p', 'TIP5P'],
    ['tip4p', 'TIP4P'],
    ['tip3p', 'TIP3P'],
    ['spc/e', 'SPCE'],
    ['spce', 'SPCE'],
    ['opc', 'OPC'],
    ['spc', 'SPC']
  ];
  for (const [needle, key] of WATER_DETECT) {
    if (lowerText.includes(needle)) {
      updates.waterModel = key;
      break;
    }
  }

  if (lowerName.endsWith('.mdp')) {
    // ================= GROMACS run parameters (.mdp) =================
    updates.software = 'GROMACS';

    const getVal = (key) => {
      const match = new RegExp(`^\\s*${key}\\s*=\\s*([^\\s;]+)`, 'im').exec(text);
      return match ? match[1].trim() : null;
    };

    const dt = getVal('dt');
    if (dt) updates.timestep = (parseFloat(dt) * 1000).toString(); // ps → fs

    const nsteps = getVal('nsteps');
    if (nsteps) updates.nSteps = nsteps;

    const ref_t = getVal('ref_t');
    if (ref_t) updates.simTemperature = ref_t.split(',')[0].trim();

    const ref_p = getVal('ref_p');
    if (ref_p) updates.simPressure = ref_p.split(',')[0].trim();

    // Integrator (GROMACS 'md' is leap-frog; 'md-vv' is velocity Verlet)
    const integrator = getVal('integrator');
    if (integrator === 'md') updates.integrator = 'leapfrog';
    else if (integrator === 'md-vv' || integrator === 'md-vv-avek') updates.integrator = 'verlet';
    else if (integrator === 'sd' || integrator === 'sd2') updates.integrator = 'stochastic';
    else if (integrator === 'bd') updates.integrator = 'brownian';
    else if (integrator === 'steep' || integrator === 'cg' || integrator === 'l-bfgs') updates.integrator = 'verlet';

    // Thermostat
    const tcoupl = getVal('tcoupl');
    if (tcoupl) {
      if (tcoupl === 'v-rescale' || tcoupl === 'velocity-rescale')
        updates.thermostat = 'v_rescale';
      else if (tcoupl === 'nose-hoover') updates.thermostat = 'nose_hoover';
      else if (tcoupl === 'berendsen') updates.thermostat = 'berendsen';
      else if (tcoupl === 'andersen' || tcoupl === 'andersen-massive')
        updates.thermostat = 'andersen';
    }

    // Barostat
    const pcoupl = getVal('pcoupl');
    if (pcoupl) {
      if (pcoupl === 'parrinello-rahman') updates.barostat = 'parrinello_rahman';
      else if (pcoupl === 'berendsen') updates.barostat = 'berendsen';
      else if (pcoupl === 'mttk' || pcoupl === 'c-rescale') updates.barostat = 'mttk';
    }

    // Ensemble inference
    const hasT = tcoupl && tcoupl !== 'no';
    const hasP = pcoupl && pcoupl !== 'no';
    if (hasT && hasP) updates.ensemble = 'NPT';
    else if (hasT) updates.ensemble = 'NVT';
    else updates.ensemble = 'NVE';

    // Constraints (bonus info)
    const constraints = getVal('constraints');
    if (constraints) updates.constraints = constraints;

    // Cut-off scheme
    const coulombtype = getVal('coulombtype');
    if (coulombtype) updates.coulombType = coulombtype;

  } else if (/\.(top|itp)$/.test(lowerName)) {
    // ================= GROMACS topology (.top / .itp) =================
    // No run-control parameters live here — this branch only exists so uploading
    // a topology file still records the force field / water model detected above
    // and tags the software, without pretending to find a timestep that isn't there.
    updates.software = 'GROMACS';

  } else if (/\.(inp|str|conf|namd)$/.test(lowerName)) {
    // ================= CHARMM / NAMD control script (.inp / .str / .conf / .namd) =================
    const getMatch = (regex) => {
      const m = regex.exec(lowerText);
      return m ? m[1] : null;
    };

    const nstep = getMatch(/nstep\s+([0-9]+)/) || getMatch(/numsteps\s+([0-9]+)/);
    if (nstep) updates.nSteps = nstep;

    const isNamd = lowerText.includes('langevinpiston') || lowerText.includes('usegrouppressure') || lowerText.includes('numsteps') || lowerName.endsWith('.namd') || lowerName.endsWith('.conf');
    updates.software = isNamd ? 'NAMD' : 'CHARMM';

    // NAMD's "timestep" directive is already in fs; CHARMM's "timestep"/"timestp" in a
    // `dynamics` command is in ps, so only the CHARMM case needs the ×1000 conversion.
    const dt = getMatch(/timestep\s+([0-9.]+)/);
    if (dt) updates.timestep = isNamd ? parseFloat(dt).toString() : (parseFloat(dt) * 1000).toString();

    const temp =
      getMatch(/finalt\s+([0-9.]+)/) ||
      getMatch(/firstt\s+([0-9.]+)/) ||
      getMatch(/temperature\s+([0-9.]+)/);
    if (temp) updates.simTemperature = temp;

    const pressure = getMatch(/pressure\s+([0-9.]+)/) || getMatch(/pref\s+([0-9.]+)/);
    if (pressure) updates.simPressure = pressure;

    // Ensemble inference
    const isNpt =
      lowerText.includes('pcons') ||
      lowerText.includes('prmc') ||
      lowerText.includes('langevinpiston') ||
      lowerText.includes('usegrouppressure');
    const isNvt =
      lowerText.includes('hoover') ||
      lowerText.includes('lang ') ||
      lowerText.includes('langevin');

    if (isNpt) updates.ensemble = 'NPT';
    else if (isNvt) updates.ensemble = 'NVT';
    else updates.ensemble = 'NVE';

    // Thermostat inference
    if (lowerText.includes('langevin') && !lowerText.includes('langevinpiston'))
      updates.thermostat = 'langevin';
    else if (lowerText.includes('hoover')) updates.thermostat = 'nose_hoover';
    else if (lowerText.includes('berendsen')) updates.thermostat = 'berendsen';

    // Barostat inference
    if (lowerText.includes('langevinpiston')) updates.barostat = 'parrinello_rahman';
    else if (lowerText.includes('berendsen') && isNpt) updates.barostat = 'berendsen';

  } else if (/\.(prm|par|psf)$/.test(lowerName)) {
    // ================= CHARMM/NAMD parameter or structure file (.prm / .par / .psf) =================
    // Also has no run-control block — force field / water model + software tag only.
    updates.software = 'CHARMM';
  }

  // ================= DERIVED VALUES =================
  const tsNum = parseFloat(updates.timestep);
  const stepsNum = parseFloat(updates.nSteps);
  if (Number.isFinite(tsNum) && Number.isFinite(stepsNum) && tsNum > 0 && stepsNum > 0) {
    const ns = (tsNum * stepsNum) / 1e6; // fs * steps → ns
    updates.simulationTime = ns >= 0.01 ? ns.toFixed(3) : ns.toExponential(2);
  }

  // Mirror onto the generic condition-field keys ("Experimental Condition" /
  // "System Setup" tabs) so a single upload keeps every view of the same
  // activeTest in sync, without needing a second parser or a second button.
  if (updates.simTemperature) updates.temperature = updates.simTemperature;
  if (updates.simPressure) updates.pressure = updates.simPressure;

  return updates;
};
// ================= MD ANALYSIS DATA GENERATORS =================
export const generateRMSDData = (nFrames, rmsdBase = 0.15, rmsdPlateau = 0.3) => {
  const data = [];

  for (let i = 0; i < nFrames; i++) {
    const t = i / nFrames;
    const rmsd =
      rmsdBase +
      (rmsdPlateau - rmsdBase) * (1 - Math.exp(-5 * t)) +
      (Math.random() - 0.5) * 0.02;

    data.push({
      frame: i,
      time: i * 0.1,
      value: Math.max(0, rmsd)
    });
  }

  return data;
};

export const generateRMSFData = (nResidues, baseFluct = 0.1) => {
  const data = [];

  for (let i = 0; i < nResidues; i++) {
    const terminal = Math.min(i, nResidues - 1 - i) < 5 ? 0.15 : 0;
    const loop = Math.random() > 0.85 ? 0.1 : 0;

    data.push({
      residue: i + 1,
      value: baseFluct + terminal + loop + Math.random() * 0.05
    });
  }

  return data;
};

export const generateEnergyData = (nFrames, baseEnergy = -50000) => {
  const data = [];

  for (let i = 0; i < nFrames; i++) {
    const t = i / nFrames;
    const eq = 1 - Math.exp(-3 * t);

    data.push({
      frame: i,
      time: i * 0.1,
      potential: baseEnergy + 5000 * eq + (Math.random() - 0.5) * 500,
      kinetic: 15000 + (Math.random() - 0.5) * 1000,
      total: baseEnergy + 15000 + 5000 * eq + (Math.random() - 0.5) * 800
    });
  }

  return data;
};

export const generateRgData = (nFrames, baseRg = 1.8) => {
  const data = [];

  for (let i = 0; i < nFrames; i++) {
    const rg = baseRg + (Math.random() - 0.5) * 0.1;

    data.push({
      frame: i,
      time: i * 0.1,
      value: rg
    });
  }

  return data;
};

export const generateSASAData = (nFrames, baseSASA = 80) => {
  const data = [];

  for (let i = 0; i < nFrames; i++) {
    const sasa = baseSASA + (Math.random() - 0.5) * 5;

    data.push({
      frame: i,
      time: i * 0.1,
      value: sasa
    });
  }

  return data;
};

export const generateTemperatureData = (nFrames, baseTemperature = 300) => {
  const data = [];

  for (let i = 0; i < nFrames; i++) {
    data.push({
      frame: i,
      time: i * 0.1,
      value: baseTemperature + (Math.random() - 0.5) * 2
    });
  }

  return data;
};

// ================= MD CHART STYLE =================
export const DEFAULT_MD_CHART_STYLE = {
  height: 380,
  aspect: 1.8,
  fontSize: 12,
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
export const mdLineDash = (style) => {
  if (style === 'dashed') return '7 5';
  if (style === 'dotted') return '2 3';
  return undefined;
};

export const mdSeriesColor = (cfg, key, idx) => {
  return (
    (cfg.colors && cfg.colors[key]) ||
    MD_LINE_COLORS[Math.max(0, idx) % MD_LINE_COLORS.length]
  );
};

export const mdMakeTicks = (domain, stepStr) => {
  const step = parseMDValue(stepStr);

  if (!step || step <= 0 || !Array.isArray(domain)) return undefined;

  const [a, b] = [
    Math.min(domain[0], domain[1]),
    Math.max(domain[0], domain[1])
  ];

  const out = [];

  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) {
    out.push(parseFloat(v.toFixed(6)));
  }

  return out.length ? out : undefined;
};

export const mdDom = (v) => {
  if (v === '' || v == null || parseMDValue(v) === null) return undefined;
  return parseMDValue(v);
};

export const mdChartBoxStyle = (cfg) => ({
  width: '100%',
  aspectRatio: String(cfg.aspect || 1.8),
  maxHeight: cfg.height || 380,
  minHeight: 220
});

// ================= FITTING ENGINE =================
export {
  fitGeneric,
  fitLinear,
  fit4PL,
  fitCustomEquation,
  runFit,
  fitParamOptions,
  extractFitParam
} from './NMRSections';

// ================= EXPORT DEFAULT =================
export default {
  FORCE_FIELDS,
  WATER_MODELS,
  MD_ENSEMBLES,
  MD_INTEGRATORS,
  MD_THERMOSTATS,
  MD_BAROSTATS,
  MD_ANALYSIS_METRICS,
  TRAJECTORY_FORMATS,
  MD_SIMULATION_PHASES,
  RANDOM_COIL_DB,
  MD_TAB_CONFIG,

  parseMDValue,
  getForceFieldInfo,
  getWaterModelInfo,
  getFFVersions,
  getFFBackboneAtoms,
  findFFAtom,
  FF_ATOM_TYPES,
  getMDAtomTypes,
  generateMDAtomEntry,
  getTrajectoryFormatInfo,

  normalizeTrajectoryUrl,
  detectTrajectoryFormat,

  MD_DEFAULT_LAYER,
  makeMDInstanceId,
  getMDInstances,
  getMDActiveInstance,
  getMDLayers,
  getMDActiveLayerKey,
  getMDLayerValues,
  writeMDCellValue,

  generateRMSDData,
  generateRMSFData,
  generateEnergyData,
  generateRgData,
  generateSASAData,
  generateTemperatureData,

  DEFAULT_MD_CHART_STYLE,
  mdLineDash,
  mdSeriesColor,
  mdMakeTicks,
  mdDom,
  mdChartBoxStyle
};