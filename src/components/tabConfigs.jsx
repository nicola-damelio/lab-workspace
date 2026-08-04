// Per-tab declarative configuration for TestShellRenderer.

export const CD_TAB_CONFIG = {
  typeKey: 'cd',
  typeLabel: 'Circular Dichroism',
  icon: '🌀',

  categories: [
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

  categories: [
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
    {
      key: 'timeBeforeRevelation',
      label: 'Time Before Revelation (h)',
      type: 'number',
      step: '0.5',
      placeholder: 'e.g. 72'
    },
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

  categories: [
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
