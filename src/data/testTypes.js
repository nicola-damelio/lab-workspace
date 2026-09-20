/* =========================================================================
   src/data/testTypes.js
   Test classification constants (moved out of App.jsx so LabNotebook and
   TestShellRenderer don't need to import from the App component file).
   ========================================================================= */

export const CLASSIFICATION_MAP = {
  "Protein production": ["Cloning", "Protein Expression and Purification", "Organic Purifications"],
  "Molecular Structure and Dynamics": [
    "Structure by NMR",
    "CD",
    "IR",
    "MD & Modeling",
    "Dynamics by NMR Relaxation",
    "ssNMR",
    "Diffusion by DLS",
    "Diffusion by DOSY",
    "NMR"
  ],
  "Interactions": ["Association Constant", "Molecular Docking", "MD interactions", "Chromatography", "Microscopy"],
  "Activity": ["Antibacterial", "Anticancer", "Antifungal", "Antiviral", "Toxicity"]
};

export const PRIMARY_CATEGORIES = Object.keys(CLASSIFICATION_MAP);

export const EXPERIMENT_TYPES = [
  "Cloning",
  "Protein expression & Purification",
  "Multiwell plate essay",
  "Flow Cytometry",
  "Microscopy",
  "Circular Dichroism",
  "NMR",
  "NMR Fitting",
  "DOSY",
  "Solid State NMR",
  "MD Simulation",
  "Molecular Docking"
];

/* =========================================================================
   EXPERIMENT-TYPE LABELS — ONE table for the whole app.

   Why this exists: the « Experiment type » dropdown of the Lab Notebook and
   of the Experiments page is built from EXPERIMENT_TYPES (human labels),
   while the filter used to compare the dropdown value with a SECOND, local
   label table (`typeLabels[t.type]`). Those tables drifted: neither had an
   entry for `microscopy`, so choosing “Microscopy” compared 'Microscopy'
   with the raw type 'microscopy' and matched NOTHING — the microscopy
   experiments were correctly labelled but impossible to filter.

   Everything now goes through `testTypeLabel` / `matchesExperimentTypeFilter`
   so a new experiment type cannot be forgotten in a second place.
   ========================================================================= */
export const TEST_TYPE_LABELS = {
  'plate-96': 'Multiwell plate essay',
  'plate-48': 'Multiwell plate essay',
  'plate-24': 'Multiwell plate essay',
  'plate-12': 'Multiwell plate essay',
  'plate-6': 'Multiwell plate essay',
  'plate-1': 'Multiwell plate essay',
  'plate-384': 'Multiwell plate essay',
  'plate-9x9box': 'Storage Box',
  nmr: 'NMR',
  cd: 'Circular Dichroism',
  'nmr-fittings': 'NMR Fitting',
  dosy: 'DOSY',
  cloning: 'Cloning',
  protein_expression: 'Protein expression & Purification',
  md_simulation: 'MD Simulation',
  ssnmr: 'Solid State NMR',
  docking: 'Molecular Docking',
  flow_cytometry: 'Flow Cytometry',
  microscopy: 'Microscopy'
};

/** Normalise a label for COMPARISON only: lower-case, accents removed and
 *  every non-alphanumeric character dropped — so « Protein expression &
 *  Purification » and “protein expression and purification” are the same
 *  experiment type, and the historical « Multiwell plate essay/assay » typo
 *  cannot hide data either. */
export const normExperimentType = (value) =>
  String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/** The human label of a test type, falling back to the raw type so an unknown
 *  (custom / imported) type is still shown and still filterable. */
export const testTypeLabel = (type) => {
  const raw = String(type == null ? '' : type).trim();
  if (!raw) return '';
  return TEST_TYPE_LABELS[raw] || TEST_TYPE_LABELS[raw.toLowerCase()] || raw;
};

/** Every spelling a test answers to for the « Experiment type » filter: the
 *  label of its type, the raw type, and its classifications. A microscopy
 *  experiment carries `type: 'microscopy'`, `testCategory: 'Interactions'`
 *  and `secondaryCategory: 'Microscopy'` — all three now match the filter. */
export const testTypeMatchValues = (test = {}) => {
  const out = [
    testTypeLabel(test.type),
    test.type,
    test.testCategory,
    test.secondaryCategory,
    test.experimentType
  ];
  // “Multiwell plate assay” (the label stored by some old datasets) must match
  // the dropdown entry “Multiwell plate essay”.
  if (normExperimentType(test.type).startsWith('plate')) out.push('Multiwell plate essay', 'Multiwell plate assay');
  return out.map(normExperimentType).filter(Boolean);
};

/** TRUE when a test belongs to the experiment type chosen in the filter.
 *  'ALL' always matches; matching is label-based and case/typo tolerant. */
export const matchesExperimentTypeFilter = (test, wanted) => {
  const w = String(wanted == null ? '' : wanted).trim();
  if (!w || w === 'ALL') return true;
  return testTypeMatchValues(test).includes(normExperimentType(w));
};

/** Options of the « Experiment type » dropdown: the published EXPERIMENT_TYPES
 *  PLUS the label of every type actually present in the data, so a dataset
 *  holding an unlisted/custom type is never impossible to filter. */
export const experimentTypeFilterOptions = (tests) => {
  const out = [];
  const seen = new Set();
  const push = (label) => {
    const key = normExperimentType(label);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(String(label).trim());
  };
  EXPERIMENT_TYPES.forEach(push);
  (Array.isArray(tests) ? tests : []).forEach((t) => {
    if (!t || t.type === 'plate-9x9box') return;
    push(testTypeLabel(t.type));
  });
  const known = new Set(EXPERIMENT_TYPES.map(normExperimentType));
  const extra = out.filter((l) => !known.has(normExperimentType(l))).sort();
  return EXPERIMENT_TYPES.concat(extra);
};
