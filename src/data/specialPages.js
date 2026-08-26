/* =========================================================================
   src/data/specialPages.js
   "Special pages" registry (SPECIAL_PAGES) + the App-local MD simulation
   tab config + CUSTOM_FIELD_TAB_OPTIONS / getSubsectionsForPage.
   Moved out of App.jsx so the definitions managers (CustomMetadataFields,
   MandatoryParameters) can import them without circular dependencies.
   ========================================================================= */

import {
  CD_TAB_CONFIG,
  PLATE_TAB_CONFIG,
  NMR_TAB_CONFIG,
  CLONING_TAB_CONFIG,
  NMR_FITTING_TAB_CONFIG,
  DOSY_TAB_CONFIG,
  PROTEIN_EXPRESSION_TAB_CONFIG,
  SSNMR_TAB_CONFIG,
  FLOW_CYTOMETRY_TAB_CONFIG
} from '../components/tabConfigs.jsx';
import { DOCKING_TAB_CONFIG } from '../components/DockingTestRenderer';

/* NOTE: This MD_SIMULATION_TAB_CONFIG is the App-local copy (previously defined
   in App.jsx) and intentionally DIFFERS from the one exported by
   src/components/tabConfigs.jsx, which is used by the MD page sections:
     - fallbackCategories: App has 5 (adds 'Characterization'), tabConfigs has 4.
     - notebookChecks:     App has 3 (cond/setup/results), tabConfigs has 4
                           (adds 'analysis' = Data Analysis).
   conditionFields are identical. Consolidating requires deciding which values
   are canonical (it changes the MD test form's category list and the
   SPECIAL_PAGES subsections shown in Custom Metadata / Mandatory Parameters).
   TODO(refactor): pick one canonical definition and import it in both places. */
export const MD_SIMULATION_TAB_CONFIG = {
  typeKey: 'md_simulation',
  typeLabel: 'MD Simulations',
  icon: '🖥️',
  fallbackCategories: [
    'Equilibration',
    'Production',
    'Free Energy',
    'Binding',
    'Characterization'
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
    {
      key: 'forceField',
      label: 'Force Field',
      type: 'select',
      options: [
        'AMBER ff19SB',
        'CHARMM36m',
        'OPLS-AA/M',
        'GROMOS 54a7',
        'Other'
      ]
    },
    {
      key: 'waterModel',
      label: 'Water Model',
      type: 'select',
      options: ['TIP3P', 'TIP4P', 'SPC/E', 'OPC', 'Other']
    },
    {
      key: 'temperature',
      label: 'Temperature',
      type: 'text',
      placeholder: 'e.g. 300',
      units: ['K']
    },
    {
      key: 'pressure',
      label: 'Pressure',
      type: 'text',
      placeholder: 'e.g. 1',
      units: ['bar', 'atm']
    },
    {
      key: 'simulationTime',
      label: 'Simulation Time',
      type: 'text',
      placeholder: 'e.g. 100',
      units: ['ns', 'µs', 'ps']
    },
    {
      key: 'timestep',
      label: 'Timestep',
      type: 'text',
      placeholder: 'e.g. 2',
      units: ['fs', 'ps']
    },
    {
      key: 'boxType',
      label: 'Box Type',
      type: 'select',
      options: [
        'Cubic',
        'Dodecahedral',
        'Truncated Octahedral',
        'Rectangular'
      ]
    },
    {
      key: 'ionConcentration',
      label: 'Ion Concentration',
      type: 'text',
      placeholder: 'e.g. 0.15',
      units: ['M', 'mM']
    },
    {
      key: 'software',
      label: 'MD Software',
      type: 'select',
      options: ['GROMACS', 'AMBER', 'NAMD', 'OpenMM', 'CHARMM', 'Other']
    },
    {
      key: 'otherMolecule',
      label: 'Other Molecule',
      type: 'text',
      placeholder: 'e.g. Ligand X'
    },
    {
      key: 'otherConditions',
      label: 'Other Conditions',
      type: 'text',
      placeholder: 'e.g. Replica exchange'
    }
  ],
  notebookChecks: [
    { id: 'cond', label: 'Simulation Parameters' },
    { id: 'setup', label: 'System Setup' },
    { id: 'results', label: 'Results Summary' }
  ]
};

/* =========================================================
   SPECIAL PAGES REGISTRY
   Single source of truth for the 7 "special page" test types and the
   named subsections each one exposes (sourced from each page's own
   notebookChecks, i.e. the same section list already used for the
   Lab Notebook Export checklist). Used by:
     - Custom Metadata Fields (page + subsection targeting)
     - Mandatory Parameters (page + subsection rules, per-page behavior)
   NOTE: the NMR Fittings page type is 'nmr-fittings' (hyphenated) at
   runtime (see activeTest.type routing below) even though the
   tabConfigs.jsx export for it is named differently — the value here
   is kept in sync with the real routing key.
========================================================= */
export const SPECIAL_PAGES = [
  { value: 'nmr', label: 'NMR', subsections: NMR_TAB_CONFIG.notebookChecks || [] },
  { value: 'nmr-fittings', label: 'NMR Fittings', subsections: NMR_FITTING_TAB_CONFIG.notebookChecks || [] },
  { value: 'dosy', label: 'DOSY', subsections: DOSY_TAB_CONFIG.notebookChecks || [] },
  { value: 'plate', label: 'Plate', subsections: PLATE_TAB_CONFIG.notebookChecks || [] },
  { value: 'cd', label: 'CD', subsections: CD_TAB_CONFIG.notebookChecks || [] },
  { value: 'cloning', label: 'Cloning', subsections: CLONING_TAB_CONFIG.notebookChecks || [] },
  { value: 'protein_expression', label: 'Protein Purification', subsections: PROTEIN_EXPRESSION_TAB_CONFIG.notebookChecks || [] },
  { value: 'ssnmr', label: 'ssNMR', subsections: SSNMR_TAB_CONFIG.notebookChecks || [] },
  { value: 'md_simulation', label: 'MD Simulations', subsections: MD_SIMULATION_TAB_CONFIG.notebookChecks || [] },
  { value: 'docking', label: 'Docking', subsections: DOCKING_TAB_CONFIG.notebookChecks || [] },
  { value: 'flow_cytometry', label: 'Flow Cytometry', subsections: FLOW_CYTOMETRY_TAB_CONFIG.notebookChecks || [] }
];

export const CUSTOM_FIELD_TAB_OPTIONS = [
  { value: 'all', label: 'All tabs' },
  ...SPECIAL_PAGES.map((p) => ({ value: p.value, label: p.label }))
];

export const getSubsectionsForPage = (pageValue) =>
  SPECIAL_PAGES.find((p) => p.value === pageValue)?.subsections || [];
