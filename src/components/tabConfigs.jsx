// Per-tab declarative configuration for TestShellRenderer.
//
// IMPORTANT:
// `fallbackCategories` are only used when no categories are provided
// by the Library.
//
// The categories provided by the Library should be the primary source.

export const MD_TAB_CONFIG = {
  typeKey: 'md',
  typeLabel: 'Molecular Dynamics',
  icon: '🎞️',
  fallbackCategories: [
    'Production MD',
    'Equilibration',
    'Energy Minimization',
    'Steered MD',
    'Replica Exchange',
    'Metadynamics',
    'Umbrella Sampling',
    'Free Energy Calculation'
  ],
  samples: {
    compounds: true,
    cellLines: false,
    compoundLabel: 'System / Molecule Label(s)',
    cellLineLabel: 'Biological Models'
  },
  imagesKey: 'mdImages',
  conditionFields: [
    { key: 'experimentDate', label: 'Simulation Date', type: 'date' },
    { key: 'concentration', label: 'Concentration', type: 'text', placeholder: 'e.g. 1', units: ['mM', 'µM', 'mg/mL'] },

    { key: 'forceField', label: 'Force Field', type: 'text', placeholder: 'e.g. CHARMM36m' },
    { key: 'forceFieldVersion', label: 'FF Version', type: 'text', placeholder: 'e.g. charmm36m' },
    { key: 'waterModel', label: 'Water Model', type: 'text', placeholder: 'e.g. TIP3P' },
    { key: 'ensemble', label: 'Ensemble', type: 'text', placeholder: 'e.g. NPT' },
    { key: 'integrator', label: 'Integrator', type: 'text', placeholder: 'e.g. Velocity Verlet' },
    { key: 'timestep', label: 'Time Step', type: 'text', placeholder: 'e.g. 2', units: ['fs', 'ps'] },
    { key: 'nSteps', label: 'Number of Steps', type: 'text', placeholder: 'e.g. 500000' },
    { key: 'simTemperature', label: 'Temperature', type: 'text', placeholder: 'e.g. 300', units: ['K'] },
    { key: 'simPressure', label: 'Pressure', type: 'text', placeholder: 'e.g. 1.0', units: ['bar', 'atm'] },
    { key: 'thermostat', label: 'Thermostat', type: 'text', placeholder: 'e.g. Nosé-Hoover' },
    { key: 'barostat', label: 'Barostat', type: 'text', placeholder: 'e.g. Parrinello-Rahman' },
    { key: 'trajectoryUrl', label: 'Trajectory URL', type: 'text', placeholder: 'https://…/traj.xtc' },
    { key: 'trajectoryFormat', label: 'Trajectory Format', type: 'text', placeholder: 'e.g. xtc' }
  ],
  notebookChecks: [
    { id: 'cond', label: 'Simulation Parameters' },
    { id: 'seq', label: 'System / Sequence' },
    { id: 'table', label: 'Atom Table' },
    { id: 'formula', label: 'Chemical Formula' },
    { id: 'trajectory', label: 'Trajectory Info' },
    { id: 'results', label: 'Results Summary (RMSD / RMSF / Rg / SASA / Energy)' },
    { id: 'analysis', label: 'Data Analysis graphs' },
    { id: 'images', label: 'Figures / Images' }
  ]
};
export const CLONING_TAB_CONFIG = {
  typeKey: 'cloning',
  typeLabel: 'Cloning & DNA Prep',
  icon: '🧬',
  fallbackCategories: [
    'Vector Construction',
    'Mutagenesis',
    'Plasmid Prep',
    'Validation'
  ],
  samples: {
    compounds: true,
    cellLines: true,
    compoundLabel: 'Construct / Insert Name',
    cellLineLabel: 'Bacterial / Host Strain'
  },
  imagesKey: 'gelImages',
  conditionFields: [
    { key: 'experimentDate', label: 'Experiment Date', type: 'date' },
    { key: 'concentration', label: 'Concentration', type: 'text', placeholder: 'e.g. 100', units: ['ng/µL', 'µM', 'mg/mL', 'mM'] },

    { key: 'vectorBackbone', label: 'Vector Backbone', type: 'text', placeholder: 'e.g. pET-28a(+)' },
    {
      key: 'cloningMethod',
      label: 'Method',
      type: 'select',
      options: [
        'Restriction-Ligation',
        'Gibson Assembly',
        'Gateway',
        'TOPO',
        'Site-Directed Mutagenesis'
      ]
    },
    { key: 'selectionMarker', label: 'Antibiotic Selection', type: 'text', placeholder: 'e.g. Kanamycin 50' },
    {
      key: 'sequencingStatus',
      label: 'Sequencing Verification',
      type: 'select',
      options: ['Pending', 'Verified (Correct)', 'Failed / Mutated']
    },
    { key: 'otherMolecule', label: 'Other Molecule', type: 'text', placeholder: 'e.g. Ligand X' },
    { key: 'otherConditions', label: 'Other Conditions', type: 'text', placeholder: 'e.g. Special notes' }
  ],
  notebookChecks: [
    { id: 'cond', label: 'Classification & Conditions' },
    { id: 'strategy', label: 'Cloning Strategy' },
    { id: 'setup', label: 'Thermal Cycler & Reaction Mix' },
    { id: 'quant', label: 'DNA Quantification' },
    { id: 'uv', label: 'UV Spectra Analysis' },
    { id: 'gels', label: 'Gel Images' },
    { id: 'sim', label: 'Simulation Parameters' }
  ]
};

export const PROTEIN_EXPRESSION_TAB_CONFIG = {
  typeKey: 'protein_expression',
  typeLabel: 'Protein Expression / Purification',
  icon: '🧫',
  fallbackCategories: [
    'Expression Optimization',
    'Affinity Chromatography',
    'Size Exclusion (SEC)',
    'Ion Exchange (IEX)',
    'Refolding'
  ],
  samples: {
    compounds: true,
    cellLines: true,
    compoundLabel: 'Target Protein / Construct',
    cellLineLabel: 'Expression Host (e.g., BL21(DE3))'
  },
  imagesKey: 'gelImages',
  conditionFields: [
    { key: 'experimentDate', label: 'Experiment Date', type: 'date' },
    { key: 'concentration', label: 'Concentration', type: 'text', placeholder: 'e.g. 5', units: ['mg/mL', 'µM', 'mM', 'µg/mL'] },

    { key: 'cultureVolume', label: 'Culture Volume', type: 'text', placeholder: 'e.g. 1', units: ['L', 'mL', 'µL'] },
    {
      key: 'medium',
      label: 'Medium',
      type: 'select',
      options: ['LB', 'TB', '2xYT', 'M9 minimal', 'Auto-induction medium', 'Other']
    },
    { key: 'antibiotic', label: 'Antibiotic', type: 'text', placeholder: 'e.g. Kanamycin 50', units: ['µg/mL', 'mg/mL'] },
    {
      key: 'inductionMethod',
      label: 'Induction Method',
      type: 'select',
      options: ['IPTG', 'Auto-induction', 'Temperature shift', 'L-Arabinose', 'Other']
    },
    { key: 'iptgConcentration', label: 'IPTG / Inducer Conc.', type: 'text', placeholder: 'e.g. 0.5', units: ['mM', 'µM', 'ng/mL'] },
    { key: 'inductionOD', label: 'OD600 at Induction', type: 'text', placeholder: 'e.g. 0.6' },
    { key: 'inductionTemp', label: 'Induction Temperature', type: 'text', placeholder: 'e.g. 18', units: ['°C', 'K'] },
    { key: 'inductionDuration', label: 'Induction Duration', type: 'text', placeholder: 'e.g. 16 (overnight)', units: ['h', 'min', 'days'] },
    { key: 'harvestOD', label: 'OD600 at Harvest', type: 'text', placeholder: 'e.g. 3.2' },
    {
      key: 'lysisMethod',
      label: 'Lysis Method',
      type: 'select',
      options: [
        'Sonication',
        'French Press',
        'Lysozyme',
        'Detergent',
        'High-pressure homogenizer',
        'Other'
      ]
    },
    { key: 'lysisBuffer', label: 'Lysis Buffer', type: 'text', placeholder: 'e.g. 50 mM Tris, 300 mM NaCl, pH 8.0' },
    { key: 'proteaseInhibitors', label: 'Protease Inhibitors', type: 'select', options: ['Yes', 'No'] },
    {
      key: 'proteinTag',
      label: 'Affinity Tag',
      type: 'select',
      options: ['His6', 'GST', 'MBP', 'SUMO', 'Strep-II', 'None']
    },
    {
      key: 'cleavageProtease',
      label: 'Cleavage Protease',
      type: 'select',
      options: ['None', 'TEV', 'Thrombin', 'HRV 3C', 'Factor Xa']
    },
    {
      key: 'columnType',
      label: 'Primary Column',
      type: 'select',
      options: [
        'Ni-NTA',
        'HisTrap',
        'GST-Trap',
        'Superdex 75',
        'Superdex 200',
        'Q-Sepharose',
        'SP-Sepharose',
        'Other'
      ]
    },
    { key: 'elutionConditions', label: 'Elution Conditions', type: 'text', placeholder: 'e.g. 250 mM imidazole' },
    { key: 'storageBuffer', label: 'Storage Buffer', type: 'text', placeholder: 'e.g. 20 mM HEPES, 150 mM NaCl, 10% glycerol' },
    { key: 'otherMolecule', label: 'Other Molecule', type: 'text', placeholder: 'e.g. Ligand X' },
    { key: 'solvent', label: 'Solvent / Buffer', type: 'text', placeholder: 'e.g. PBS pH 7.4' }
  ],
  notebookChecks: [
    { id: 'cond', label: 'Conditions & Buffers' },
    { id: 'yield', label: 'Protein Yield & Quant.' },
    { id: 'chromatogram', label: 'Chromatogram Summary' },
    { id: 'gels', label: 'SDS-PAGE Images' }
  ]
};

// Field type conventions for CD_TAB_CONFIG.conditionFields (see
// TestShellRenderer.jsx renderConditionField):
//   'solvent-select' / key 'solvent' -> dropdown fed by the Library
//     solvents, with a free-text fallback for custom values.
// Buffer/Additive are NOT listed as conditionFields — TestShellRenderer always
// renders the shared <BufferAdditiveFields> component (bufferName/bufferConc/
// bufferUnit, additiveName/additiveConc/additiveUnit) right after the
// conditionFields grid, fed by the Library buffers/additives. Adding a
// 'buffer'/'additive' conditionFields entry here would create a second,
// differently-keyed input that silently goes out of sync with it.
//
// CD-spectrometer instrumental fields live in CD_INSTRUMENTAL_FIELDS in
// CDSections.jsx (wired in via CDTestRenderer's custom.InstrumentalSetup), not
// here — TestShellRenderer's Instrumental Setup section is driven by that
// custom component, not by a config field list.
export const CD_TAB_CONFIG = {
  typeKey: 'cd',
  typeLabel: 'Circular Dichroism',
  icon: '🌀',
  fallbackCategories: [
    'Activity',
    'Toxicity',
    'Structure',
    'Binding',
    'Characterization'
  ],
  samples: {
    compounds: true,
    cellLines: true,
    compoundLabel: 'Compound / Sample Label(s)',
    cellLineLabel: 'Cell Lines / Biological Models'
  },
  imagesKey: 'images',
  conditionFields: [
    { key: 'experimentDate', label: 'Experiment Date', type: 'date' },
    { key: 'concentration', label: 'Concentration', type: 'text', placeholder: 'e.g. 0.1', units: ['µM', 'mg/mL', 'mM', 'M', 'nM'] },
    { key: 'solvent', label: 'Solvent', type: 'solvent-select', placeholder: 'e.g. 10 mM Phosphate Buffer' },
    { key: 'saltConcentration', label: 'Salt Concentration', type: 'text', placeholder: 'e.g. 50', units: ['mM', 'M'] },
    { key: 'ph', label: 'pH', type: 'text', placeholder: 'e.g. 7.4' },
    { key: 'temperature', label: 'Temperature', type: 'text', placeholder: 'e.g. 25', units: ['K', '°C'] },
    { key: 'pathLength', label: 'Cuvette Path Length', type: 'text', placeholder: 'e.g. 1', units: ['mm', 'cm'] },
    { key: 'otherMolecule', label: 'Other Molecule / Ligand', type: 'text', placeholder: 'e.g. Ligand X' },
    { key: 'ratio', label: 'Molar Ratio', type: 'text', placeholder: 'e.g. 1:5' }
  ],
  notebookChecks: [
    { id: 'cond', label: 'Experimental Conditions' },
    { id: 'instrument', label: 'Instrumental Setup' },
    { id: 'struct', label: 'Structure Composition' },
    { id: 'spectra', label: 'Spectra Summary' }
  ]
};
export const SSNMR_TAB_CONFIG = {
  typeKey: 'ssnmr',
  typeLabel: 'ssNMR (²H)',
  icon: '🧲',
  fallbackCategories: [
    'Solid-state NMR',
    'Binding',
    'Characterization'
  ],
  samples: {
    compounds: true,
    cellLines: false,
    compoundLabel: 'Compound / Sample Label(s)',
    cellLineLabel: 'Cell Lines / Biological Models'
  },
  imagesKey: 'images',
  conditionFields: [
    { key: 'experimentDate', label: 'Experiment Date', type: 'date' },
    { key: 'concentration', label: 'Concentration', type: 'text', placeholder: 'e.g. 1', units: ['mM', 'µM', 'mg/mL'] },

    { key: 'temperature', label: 'Temperature', type: 'text', placeholder: 'e.g. 300', units: ['K', '°C'] },
    { key: 'lipid', label: 'Lipid', type: 'text', placeholder: 'e.g. POPC / DPPC' },
    { key: 'deuteration', label: 'Deuteration Pattern', type: 'text', placeholder: 'e.g. sn-1 perdeuterated' },
    { key: 'hydration', label: 'Hydration', type: 'text', placeholder: 'e.g. 40% w/w' },
    { key: 'ph', label: 'pH', type: 'text', placeholder: 'e.g. 7.4' },
    { key: 'cholesterolRatio', label: 'Cholesterol (mol %)', type: 'text', placeholder: 'e.g. 30' },
    { key: 'ratio', label: 'Peptide:Lipid Ratio', type: 'text', placeholder: 'e.g. 1:50' },
    { key: 'solvent', label: 'Solvent / Buffer', type: 'solvent-select', placeholder: 'e.g. 20 mM HEPES' },
    { key: 'otherMolecule', label: 'Other Molecule / Ligand', type: 'text', placeholder: 'e.g. Ligand X' }
  ],
  notebookChecks: [
    { id: 'cond', label: 'Experimental Conditions' },
    { id: 'instrument', label: 'Instrumental Setup' },
    { id: 'struct', label: 'Quadrupolar Fit (Δν / S_CD)' },
    { id: 'spectra', label: 'Spectra Summary' }
  ]
};
export const PLATE_TAB_CONFIG = {
  typeKey: 'plate',
  typeLabel: 'Plate Assay',
  icon: '🧫',
  fallbackCategories: [
    'Activity',
    'Toxicity',
    'Binding',
    'Characterization'
  ],
  samples: {
    compounds: true,
    cellLines: true,
    compoundLabel: 'Compound / Sample Label(s)',
    cellLineLabel: 'Cell Lines / Biological Models'
  },
  imagesKey: 'images',
  conditionFields: [
    { key: 'experimentDate', label: 'Experiment Date', type: 'date' },
    { key: 'concentration', label: 'Concentration', type: 'text', placeholder: 'e.g. 100', units: ['µM', 'mM', 'nM', 'µg/mL'] },

    { key: 'cellsSeeded', label: 'Cells per Well', type: 'number', placeholder: 'e.g. 5000' },
    { key: 'timeBeforeRevelation', label: 'Time Before Revelation', type: 'number', step: '0.5', placeholder: 'e.g. 72', units: ['h', 'min', 'days'] },
    { key: 'temperature', label: 'Temperature', type: 'text', placeholder: 'e.g. 37', units: ['°C', 'K'] },
    { key: 'solvent', label: 'Solvent / Medium', type: 'text', placeholder: 'e.g. DMEM + 10% FBS' },
    { key: 'otherMolecule', label: 'Other Molecule', type: 'text', placeholder: 'e.g. Ligand X' },
    { key: 'otherConditions', label: 'Other Conditions', type: 'text', placeholder: 'e.g. Serum-free medium' }
  ],
  notebookChecks: [
    { id: 'cond', label: 'Experimental Conditions' },
    { id: 'map', label: 'Plate Map Summary' },
    { id: 'ic50', label: 'IC50 Results' }
  ]
};

export const NMR_TAB_CONFIG = {
  typeKey: 'nmr',
  typeLabel: 'NMR',
  icon: '🧲',
  fallbackCategories: [
    'Activity',
    'Toxicity',
    'Structure',
    'Binding',
    'Characterization',
    'Kinetics'
  ],
  samples: {
    compounds: true,
    cellLines: true,
    compoundLabel: 'Compound / Molecule Label(s)',
    cellLineLabel: 'Cell Lines / Biological Models'
  },
  imagesKey: 'nmrSpectraImages',
  conditionFields: [
    { key: 'experimentDate', label: 'Experiment Date', type: 'date' },
    { key: 'concentration', label: 'Concentration', type: 'text', placeholder: 'e.g. 1', units: ['mM', 'µM', 'mg/mL'] },
    { key: 'solvent', label: 'Solvent', type: 'text', placeholder: 'e.g. 90% H2O / 10% D2O' },
    { key: 'saltConcentration', label: 'Salt Concentration', type: 'text', placeholder: 'e.g. 50', units: ['mM', 'M'] },
    { key: 'ph', label: 'pH', type: 'text', placeholder: 'e.g. 6.8' },
    { key: 'temperature', label: 'Temperature', type: 'text', placeholder: 'e.g. 298', units: ['K', '°C'] },
    { key: 'otherMolecule', label: 'Other Molecule', type: 'text', placeholder: 'e.g. Ligand X' },
    { key: 'ratio', label: 'Ratio', type: 'text', placeholder: 'e.g. 1:5' },
    { key: 'nmrFileTitle', label: 'Title (pdata/1/title)', type: 'text', fullWidth: true, placeholder: 'Text from the Bruker <dataset>/pdata/1/title file' }
  ],
  notebookChecks: [
    { id: 'cond', label: 'Experimental Conditions' },
    { id: 'seq', label: 'Sequence' },
    { id: 'table', label: 'Shifts Table' },
    { id: 'formula', label: 'Chemical Formula' },
    { id: 'images', label: 'Spectra Images' }
  ]
};

export const NMR_FITTING_TAB_CONFIG = {
  typeKey: 'nmrfitting',
  typeLabel: 'NMR Fitting',
  icon: '📈',
  fallbackCategories: [
    'Relaxation',
    'Dynamics',
    'Diffusion'
  ],
  samples: {
    compounds: true,
    cellLines: true,
    compoundLabel: 'Molecule / System Label(s)',
    cellLineLabel: 'Cell Lines / Biological Models'
  },
  imagesKey: 'images',
  conditionFields: [
    { key: 'experimentDate', label: 'Experiment Date', type: 'date' },
    { key: 'concentration', label: 'Concentration', type: 'text', placeholder: 'e.g. 1', units: ['mM', 'µM', 'mg/mL'] },

    { key: 'spectrometer', label: 'Spectrometer Frequency', type: 'text', placeholder: 'e.g. 600', units: ['MHz'] },
    { key: 'temperature', label: 'Temperature', type: 'text', placeholder: 'e.g. 298', units: ['K', '°C'] },
    { key: 'solvent', label: 'Solvent', type: 'text', placeholder: 'e.g. D2O' },
    { key: 'ph', label: 'pH', type: 'text', placeholder: 'e.g. 6.8' },
    { key: 'otherMolecule', label: 'Other Molecule', type: 'text', placeholder: 'e.g. Ligand X' },
    { key: 'ratio', label: 'Ratio', type: 'text', placeholder: 'e.g. 1:5' }
  ],
  notebookChecks: [
    { id: 'cond', label: 'Experimental Conditions' },
    { id: 'fittings', label: 'Fittings Summary' }
  ]
};

export const DOSY_TAB_CONFIG = {
  typeKey: 'dosy',
  typeLabel: 'DOSY',
  icon: '📈',
  fallbackCategories: ['Diffusion by DOSY', 'NMR', 'Relaxation'],
  samples: {
    compounds: true,
    cellLines: true,
    compoundLabel: 'Molecule / System Label(s)',
    cellLineLabel: 'Cell Lines / Biological Models'
  },
  imagesKey: 'images',
  conditionFields: [
    { key: 'experimentDate', label: 'Experiment Date', type: 'date' },
    { key: 'concentration', label: 'Concentration', type: 'text', placeholder: 'e.g. 1', units: ['mM', 'µM', 'mg/mL'] },

    { key: 'spectrometer', label: 'Spectrometer Frequency', type: 'text', placeholder: 'e.g. 600', units: ['MHz'] },
    { key: 'temperature', label: 'Temperature', type: 'text', placeholder: 'e.g. 298', units: ['K', '°C'] },
    { key: 'solvent', label: 'Solvent', type: 'text', placeholder: 'e.g. D2O' },
    { key: 'ph', label: 'pH', type: 'text', placeholder: 'e.g. 6.8' }
  ],
  notebookChecks: [
    { id: 'cond', label: 'Experimental Conditions' },
    { id: 'fittings', label: 'Diffusion Fits Summary' }
  ]
};

export const MD_SIMULATION_TAB_CONFIG = {
  typeKey: 'md_simulation',
  typeLabel: 'MD Simulations',
  icon: '🖥️',
  fallbackCategories: [
    'Equilibration',
    'Production',
    'Free Energy',
    'Binding'
  ],
  samples: {
    compounds: true,
    cellLines: false,
    compoundLabel: 'System / Molecule',
    cellLineLabel: ''
  },
  imagesKey: 'images',
  conditionFields: [
    { key: 'experimentDate', label: 'Simulation Date', type: 'date' },
    { key: 'concentration', label: 'Concentration', type: 'text', placeholder: 'e.g. 1', units: ['mM', 'µM', 'mg/mL'] },

    { key: 'forceField', label: 'Force Field', type: 'select', options: ['AMBER ff19SB', 'CHARMM36m', 'OPLS-AA/M', 'GROMOS 54a7', 'Other'] },
    { key: 'waterModel', label: 'Water Model', type: 'select', options: ['TIP3P', 'TIP4P', 'SPC/E', 'OPC', 'Other'] },
    { key: 'temperature', label: 'Temperature', type: 'text', placeholder: 'e.g. 300', units: ['K'] },
    { key: 'pressure', label: 'Pressure', type: 'text', placeholder: 'e.g. 1', units: ['bar', 'atm'] },
    { key: 'simulationTime', label: 'Simulation Time', type: 'text', placeholder: 'e.g. 100', units: ['ns', 'µs', 'ps'] },
    { key: 'timestep', label: 'Timestep', type: 'text', placeholder: 'e.g. 2', units: ['fs', 'ps'] },
    { key: 'boxType', label: 'Box Type', type: 'select', options: ['Cubic', 'Dodecahedral', 'Truncated Octahedral', 'Rectangular'] },
    { key: 'ionConcentration', label: 'Ion Concentration', type: 'text', placeholder: 'e.g. 0.15', units: ['M', 'mM'] },
    { key: 'software', label: 'MD Software', type: 'select', options: ['GROMACS', 'AMBER', 'NAMD', 'OpenMM', 'CHARMM', 'Other'] },
    { key: 'otherMolecule', label: 'Other Molecule', type: 'text', placeholder: 'e.g. Ligand X' },
    { key: 'otherConditions', label: 'Other Conditions', type: 'text', placeholder: 'e.g. Replica exchange' }
  ],
  notebookChecks: [
    { id: 'cond', label: 'Experimental Conditions (Simulation Parameters)' },
    { id: 'setup', label: 'System Setup' },
    { id: 'results', label: 'Results Summary (RMSD, RMSF, Rg, SASA, Energy)' },
    { id: 'analysis', label: 'Data Analysis (DSSP, Membrane Contacts, Profiles)' }
  ]
};
export const MICROSCOPY_TAB_CONFIG = {
  typeKey: 'microscopy',
  typeLabel: 'Microscopy',
  icon: '🔬',
  fallbackCategories: [
    'Confocal',
    'Fluorescence',
    'Electron',
    'Light',
    'Brightfield',
    'Time Lapse'
  ],
  samples: {
    compounds: true,
    cellLines: true,
    compoundLabel: 'Fluorophores / Reagents',
    cellLineLabel: 'Cell Type / Line'
  },
  imagesKey: 'msImages',
  conditionFields: [
    { key: 'experimentDate', label: 'Experiment Date', type: 'date' },
    { key: 'concentration', label: 'Concentration', type: 'text', placeholder: 'e.g. 5', units: ['µg/mL', 'ng/mL', 'µM', 'mM'] },

    { key: 'cellNumber', label: 'Cells per Sample', type: 'text', placeholder: 'e.g. 1x10^6' },
    { key: 'fixation', label: 'Fixation', type: 'select', options: ['None', '1% PFA', '4% PFA', 'BD Cytofix', 'eBioscience Foxp3'] },
    { key: 'permeabilization', label: 'Permeabilization', type: 'select', options: ['None', '0.1% Saponin', '0.1% Triton X-100', 'BD Perm', 'eBioscience Perm'] },
    { key: 'otherConditions', label: 'Other Conditions', type: 'text', placeholder: 'e.g. Staining / mounting protocol' }
  ],
  instrumentalFields: [
    { key: 'microscopyType', label: 'Microscope Type', type: 'select', options: ['Confocal', 'Fluorescence', 'Electron', 'Light', 'Brightfield', 'Time Lapse', 'Other'] },
    { key: 'microscopeModel', label: 'Microscope Model', type: 'text', placeholder: 'e.g. Zeiss LSM 980' },
    { key: 'objective', label: 'Objective', type: 'text', placeholder: 'e.g. 40x / 1.30 Oil' },
    { key: 'laserLines', label: 'Laser Lines', type: 'text', placeholder: 'e.g. 405, 488, 561, 640 nm' },
    { key: 'detector', label: 'Detector', type: 'text', placeholder: 'e.g. GaAsP PMT' },
    { key: 'filterCubes', label: 'Filter Cubes / Emission', type: 'text', placeholder: 'e.g. DAPI, FITC, TRITC' },
    { key: 'magnification', label: 'Magnification', type: 'text', placeholder: 'e.g. 200x' },
    { key: 'acquisitionSoftware', label: 'Acquisition Software', type: 'text', placeholder: 'e.g. ZEN, LAS X' },
    { key: 'plateName', label: 'Plate Name / ID', type: 'text', placeholder: 'e.g. 96 Well - Flat bottom' },
    { key: 'wellId', label: 'Well ID', type: 'text', placeholder: 'e.g. H01' }
  ],
  notebookChecks: [
    { id: 'cond', label: 'Experimental Conditions' },
    { id: 'instrument', label: 'Instrumental Setup' },
    { id: 'setup', label: 'Plate / Well Setup' },
    { id: 'data', label: 'Videos / Images' },
    { id: 'analysis', label: 'Movie Regions & Analysis' }
  ]
};
export const FLOW_CYTOMETRY_TAB_CONFIG = {
  typeLabel: 'Flow Cytometry',
  icon: '🩸',
  fallbackCategories: [
    'Immunophenotyping',
    'Cell Viability',
    'Apoptosis',
    'Cell Cycle',
    'Intracellular Cytokines',
    'Calcium Flux'
  ],
  samples: {
    compounds: true,
    cellLines: true,
    compoundLabel: 'Antibodies / Reagents',
    cellLineLabel: 'Cell Type / Line'
  },
  imagesKey: 'images',
  conditionFields: [
    { key: 'experimentDate', label: 'Experiment Date', type: 'date' },
    { key: 'concentration', label: 'Concentration', type: 'text', placeholder: 'e.g. 5', units: ['µg/mL', 'ng/mL', 'µM', 'mM'] },

    { key: 'cellNumber', label: 'Cells per Sample', type: 'text', placeholder: 'e.g. 1x10^6' },
    { key: 'liveDeadStain', label: 'Live/Dead Stain', type: 'text', placeholder: 'e.g. Zombie NIR' },
    { key: 'fixation', label: 'Fixation', type: 'select', options: ['None', '1% PFA', '4% PFA', 'BD Cytofix', 'eBioscience Foxp3'] },
    { key: 'permeabilization', label: 'Permeabilization', type: 'select', options: ['None', '0.1% Saponin', '0.1% Triton X-100', 'BD Perm', 'eBioscience Perm'] },
    { key: 'otherConditions', label: 'Other Conditions', type: 'text', placeholder: 'e.g. Stimulated with PMA/Iono' }
  ],
  instrumentalFields: [
    { key: 'cytometerModel', label: 'Cytometer Model', type: 'text', placeholder: 'e.g. FACSCanto II' },
    { key: 'cytometerSerial', label: 'Cytometer Serial Number', type: 'text', placeholder: 'e.g. V96300734' },
    { key: 'lasers', label: 'Lasers Config', type: 'textarea', placeholder: 'e.g. Blue (488nm), Red (633nm), Violet (405nm)' },
    { key: 'threshold', label: 'Threshold', type: 'text', placeholder: 'e.g. FSC, 5000' },
    { key: 'compensationApplied', label: 'Compensation Applied', type: 'select', options: ['Yes', 'No', 'Unknown'] },
    { key: 'plateName', label: 'Plate Name / ID', type: 'text', placeholder: 'e.g. 96 Well - Flat bottom' },
    { key: 'wellId', label: 'Well ID', type: 'text', placeholder: 'e.g. H01' }
  ],
  notebookChecks: [
    { id: 'cond', label: 'Experimental Conditions' },
    { id: 'instrument', label: 'Instrumental Setup' },
    { id: 'panel', label: 'Staining Panel' },
    { id: 'gating', label: 'Gating Strategy & Results' }
  ]
};