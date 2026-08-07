// Per-tab declarative configuration for TestShellRenderer.
//
// IMPORTANT:
// `fallbackCategories` are only used when no categories are provided
// by Definitions & Labels.
//
// The categories provided by Definitions & Labels should be the primary source.

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
    compounds: true,   // Gene / Insert name
    cellLines: true,   // Bacterial strains (DH5α, BL21, ...)
    compoundLabel: 'Construct / Insert Name',
    cellLineLabel: 'Bacterial / Host Strain'
  },
  imagesKey: 'gelImages',
  conditionFields: [
    { key: 'experimentDate', label: 'Experiment Date', type: 'date' },
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
    { key: 'selectionMarker', label: 'Antibiotic Selection', type: 'text', placeholder: 'e.g. Kanamycin 50µg/mL' },
    {
      key: 'sequencingStatus',
      label: 'Sequencing Verification',
      type: 'select',
      options: ['Pending', 'Verified (Correct)', 'Failed / Mutated']
    }
  ],
  notebookChecks: [
    { id: 'cond', label: 'Classification & Conditions' },
    { id: 'setup', label: 'Thermal Cycler & Reaction Mix' },
    { id: 'quant', label: 'DNA Quantification' },
    { id: 'uv', label: 'UV Spectra Analysis' },
    { id: 'gels', label: 'Gel Images' },
    { id: 'sim', label: 'Simulation Parameters' }
  ]
};

export const PROTEIN_EXPRESSION_TAB_CONFIG = {
  typeKey: 'protein_expression',
  typeLabel: 'Expression & Purification',
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

    // ---- Culture ----
    { key: 'cultureVolume', label: 'Culture Volume', type: 'text', placeholder: 'e.g. 1 L' },
    {
      key: 'medium',
      label: 'Medium',
      type: 'select',
      options: ['LB', 'TB', '2xYT', 'M9 minimal', 'Auto-induction medium', 'Other']
    },
    { key: 'antibiotic', label: 'Antibiotic', type: 'text', placeholder: 'e.g. Kanamycin 50 µg/mL' },

    // ---- Induction ----
    {
      key: 'inductionMethod',
      label: 'Induction Method',
      type: 'select',
      options: ['IPTG', 'Auto-induction', 'Temperature shift', 'L-Arabinose', 'Other']
    },
    { key: 'iptgConcentration', label: 'IPTG / Inducer Conc.', type: 'text', placeholder: 'e.g. 0.5 mM' },
    { key: 'inductionOD', label: 'OD600 at Induction', type: 'text', placeholder: 'e.g. 0.6' },
    { key: 'inductionTemp', label: 'Induction Temperature', type: 'text', placeholder: 'e.g. 18 °C' },
    { key: 'inductionDuration', label: 'Induction Duration', type: 'text', placeholder: 'e.g. 16 h (overnight)' },
    { key: 'harvestOD', label: 'OD600 at Harvest', type: 'text', placeholder: 'e.g. 3.2' },

    // ---- Lysis ----
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

    // ---- Construct / Tag ----
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

    // ---- Purification ----
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
    { key: 'storageBuffer', label: 'Storage Buffer', type: 'text', placeholder: 'e.g. 20 mM HEPES, 150 mM NaCl, 10% glycerol' }
  ],
  notebookChecks: [
    { id: 'cond', label: 'Conditions & Buffers' },
    { id: 'yield', label: 'Protein Yield & Quant.' },
    { id: 'chromatogram', label: 'Chromatogram Summary' },
    { id: 'gels', label: 'SDS-PAGE Images' }
  ]
};

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
    { key: 'concentration', label: 'Concentration', type: 'text', placeholder: 'e.g. 0.1 mg/mL' },
    { key: 'solvent', label: 'Solvent / Buffer', type: 'text', placeholder: 'e.g. 10 mM Phosphate Buffer' },
    { key: 'buffer', label: 'Buffer', type: 'text', placeholder: 'e.g. 10 mM PBS pH 7.4' },
    { key: 'saltConcentration', label: 'Salt Concentration', type: 'text', placeholder: 'e.g. 50 mM NaCl' },
    { key: 'ph', label: 'pH', type: 'text', placeholder: 'e.g. 7.4' },
    { key: 'temperature', label: 'Temperature', type: 'text', placeholder: 'e.g. 25°C' },
    { key: 'pathLength', label: 'Cuvette Path Length', type: 'text', placeholder: 'e.g. 1 mm' },
    { key: 'otherMolecule', label: 'Other Molecule / Ligand', type: 'text', placeholder: 'e.g. Ligand X' },
    { key: 'ratio', label: 'Molar Ratio', type: 'text', placeholder: 'e.g. 1:5' }
  ],
  notebookChecks: [
    { id: 'cond', label: 'Experimental Conditions' },
    { id: 'struct', label: 'Structure Composition' },
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
    { key: 'cellsSeeded', label: 'Cells per Well', type: 'number', placeholder: 'e.g. 5000' },
    { key: 'timeBeforeRevelation', label: 'Time Before Revelation (h)', type: 'number', step: '0.5', placeholder: 'e.g. 72' },
    { key: 'temperature', label: 'Temperature', type: 'text', placeholder: 'e.g. 37°C, 5% CO₂' },
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
    { key: 'concentration', label: 'Concentration', type: 'text', placeholder: 'e.g. 1 mM' },
    { key: 'solvent', label: 'Solvent', type: 'text', placeholder: 'e.g. 90% H2O / 10% D2O' },
    { key: 'saltConcentration', label: 'Salt Concentration', type: 'text', placeholder: 'e.g. 50 mM NaCl' },
    { key: 'ph', label: 'pH', type: 'text', placeholder: 'e.g. 6.8' },
    { key: 'temperature', label: 'Temperature', type: 'text', placeholder: 'e.g. 298 K' },
    { key: 'otherMolecule', label: 'Other Molecule', type: 'text', placeholder: 'e.g. Ligand X' },
    { key: 'ratio', label: 'Ratio', type: 'text', placeholder: 'e.g. 1:5' }
  ],
  notebookChecks: [
    { id: 'cond', label: 'Experimental Conditions' },
    { id: 'seq', label: 'Sequence' },
    { id: 'table', label: 'Shifts Table' },
    { id: 'formula', label: 'Chemical Formula' },
    { id: 'images', label: 'Spectra Images' }
  ]
};
