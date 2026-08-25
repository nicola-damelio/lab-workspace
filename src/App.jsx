import React, { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import LZString from 'lz-string';
import {
  DEFAULT_FIREBASE_CONFIG,
  LOCAL_STORAGE_KEY,
  PLATES_DEF,
  DEF_COMPOUNDS,
  DEF_CELL_LINES,
  getDirectImageUrl,
  parsePayload,
  BOX_ROW_LABELS
} from './data/constants';
const TestShellRenderer = lazy(() => import('./components/TestShellRenderer'));
const NMRTestRenderer = lazy(() => import('./components/NMRTestRenderer').then(m => ({ default: m.NMRTestRenderer })));
const PlateTestRenderer = lazy(() => import('./components/PlateTestRenderer').then(m => ({ default: m.PlateTestRenderer })));
const CDTestRenderer = lazy(() => import('./components/CDTestRenderer').then(m => ({ default: m.CDTestRenderer })));
const SSNMRTestRenderer = lazy(() => import('./components/ssNMRTestRenderer').then(m => ({ default: m.ssNMRTestRenderer })));
import { RichTextEditor } from './components/RichTextEditor';
import { StorageModals, BoxDetail } from './components/Storage';
const NMRFittingsTestRenderer = lazy(() => import('./components/NMRFittingsTestRenderer').then(m => ({ default: m.NMRFittingsTestRenderer })));
const CloningTestRenderer = lazy(() => import('./components/CloningTestRenderer').then(m => ({ default: m.CloningTestRenderer })));
const ProteinExpressionTestRenderer = lazy(() => import('./components/ProteinExpressionTestRenderer').then(m => ({ default: m.ProteinExpressionTestRenderer })));
const DockingTestRenderer = lazy(() => import('./components/DockingTestRenderer'));
import { Setup, Data, Simulations, Analysis, MD_ANALYSIS_SECTIONS } from '/src/components/MDSections.jsx';
import { SolventsManager, BuffersManager, AdditivesManager, NMRProbesManager, NMRInstrumentsManager, NMRExperimentsManager, BrukerPulseSequenceViewer } from './components/DefinitionsExtra';
import { SearchableSelect } from './components/SearchableSelect';
import { MD_SIMULATION_TAB_CONFIG } from './data/specialPages';
import { CLASSIFICATION_MAP, PRIMARY_CATEGORIES, EXPERIMENT_TYPES } from './data/testTypes';
import { AppSidebar } from './components/AppModules/appSidebar';
import { AgendaModule } from './components/AppModules/agendaModule';
import { DashboardModule } from './components/AppModules/dashboardModule';
import { DefinitionsModule } from './components/AppModules/definitionsModule';
import { StorageModule } from './components/AppModules/storageModuleViews';
import { NotebookModule, CalculationsModule, PublicationsModule } from './components/AppModules/miscModules';
const FlowCytometryTestRenderer = lazy(() => import('./components/FlowCytometryTestRenderer').then(m => ({ default: m.FlowCytometryTestRenderer })));
import { hashPassword, normalizeOperators, getOpLabel } from './utils/auth';
import { CALC_INPUT_CLS, CALC_LABEL_CLS } from './utils/styles';
import { ScientistLoginGate, ScientistLoginModal } from './components/AppModules/definitionsManagers';
import { Calculations } from './components/AppModules/calculationsModule';
import { CollapsibleSectionPanel as CollapsibleSection } from './components/ui';


// Auth utilities now live in ./utils/auth (see import above).

/* =========================================================
   COLLAPSIBLE SECTION
========================================================= */

/* CollapsibleSectionPanel (library panel style) now lives in ./ui; imported
   above as CollapsibleSection so existing call sites are unchanged. */

/* =========================================================
   MD SIMULATIONS CONFIG & RENDERER
========================================================= */
// MD_SIMULATION_TAB_CONFIG + SPECIAL_PAGES registry now live in ./data/specialPages (see import above).
class MDSectionErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('MD sections crashed:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            margin: 20,
            padding: 16,
            border: '3px solid #ef4444',
            background: '#fef2f2',
            borderRadius: 12
          }}
        >
          <div
            style={{
              fontWeight: 900,
              color: '#b91c1c',
              marginBottom: 8
            }}
          >
            ❌ MD sections crashed
          </div>

          <pre
            style={{
              whiteSpace: 'pre-wrap',
              fontSize: 12,
              color: '#b91c1c'
            }}
          >
            {String(this.state.error?.message || this.state.error)}
            {'\n\n'}
            {String(this.state.error?.stack || '')}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}

const SafeMDSectionsAll = (props) => {
  if (!MDSectionsAll) {
    return (
      <div
        style={{
          margin: 20,
          padding: 16,
          border: '3px solid #f59e0b',
          background: '#fffbeb',
          borderRadius: 12,
          fontWeight: 900,
          color: '#92400e'
        }}
      >
        ⚠️ MDSections.All was not found. Check the import path in App.jsx.
      </div>
    );
  }

  return (
    <MDSectionErrorBoundary>
      <MDSectionsAll {...props} />
    </MDSectionErrorBoundary>
  );
};

const buildMDNotebookHtml = (checked, ctx) => {
  const t = ctx?.activeTest || {};
  const charts = (t && t.mdNotebookCharts) || {};

  let html = '';

  if (checked.cond) {
    html += `<p style="font-size:12px;color:#475569;margin-bottom:8px;"><b>MD Setup:</b> Force field ${
      t.forceField || 'N/A'
    } | Water ${t.waterModel || 'N/A'} | Temperature ${
      t.temperature || 'N/A'
    } | Pressure ${t.pressure || 'N/A'} | Simulation time ${
      t.simulationTime || 'N/A'
    } | Timestep ${t.timestep || 'N/A'} | Software ${t.software || 'N/A'}</p>`;
  }

  if (checked.setup) {
    html += `<p style="font-size:12px;color:#475569;margin-bottom:8px;"><b>System Setup:</b> Box type ${
      t.boxType || 'N/A'
    } | Ion concentration ${t.ionConcentration || 'N/A'} | Other molecule ${
      t.otherMolecule || 'N/A'
    } | Other conditions ${t.otherConditions || 'N/A'}</p>`;
  }

  const chartFigure = (src, label) => (src
    ? `<figure style="margin: 12px 0; text-align:center; break-inside:avoid;"><img src="${src}" alt="${label}" style="max-width:100%; border:1px solid #e2e8f0; border-radius:8px; background:#fff; box-shadow:0 1px 3px rgba(15,23,42,0.08);"/><figcaption style="font-size:11px;color:#64748b;margin-top:4px;"><b>${label}</b></figcaption></figure>`
    : '');

  if (checked.results) {
    html += `<p style="font-size:12px;color:#475569;margin-bottom:8px;"><b>Results Summary:</b> RMSD, RMSF, Rg, SASA and energy curves.</p>`;
    html += chartFigure(charts.rmsd, 'RMSD (backbone)');
    html += chartFigure(charts.rmsf, 'RMSF per residue');
    html += chartFigure(charts.rg, 'Radius of Gyration (Rg)');
    html += chartFigure(charts.sasa, 'SASA');
    html += chartFigure(charts.energy, 'Energy');
  }

  if (checked.analysis) {
    html += `<p style="font-size:12px;color:#475569;margin-bottom:8px;"><b>Data Analysis:</b> membrane contacts (polar + apolar), membrane profiles and secondary structure (DSSP).</p>`;
    html += chartFigure(charts.contactPolar, 'Membrane contacts — Polar');
    html += chartFigure(charts.contactApolar, 'Membrane contacts — Apolar (van der Waals)');
    html += chartFigure(charts.scd, 'Order parameter |SCD|');
    html += chartFigure(charts.density, 'Electron density profile');
    html += chartFigure(charts.potential, 'Electrostatic potential');
    html += chartFigure(charts.dsspContent, 'Secondary structure content vs time');
    html += chartFigure(charts.dsspHeat, 'DSSP timeline map (residue × frame)');
    html += chartFigure(charts.dsspOcc, 'Per-residue occupancy');
  }

  return html;
};

const MD_CUSTOM = {
  MolecularStructure: Setup,
  Simulations: Simulations,
  Data: Data,
  Analysis: Analysis,
  AnalysisSections: MD_ANALYSIS_SECTIONS,
  buildNotebookHtml: buildMDNotebookHtml
};

const MDTestRenderer = (props) => {
  const appCategories =
    Array.isArray(props.testCategories) && props.testCategories.length
      ? props.testCategories
      : MD_SIMULATION_TAB_CONFIG.fallbackCategories;

  const config = {
    ...MD_SIMULATION_TAB_CONFIG,
    categories: appCategories
  };

  return (
    <TestShellRenderer
      {...props}
      config={config}
      custom={MD_CUSTOM}
      testCategories={appCategories}
      operators={Array.isArray(props.operators) ? props.operators : []}
      solvents={Array.isArray(props.solvents) ? props.solvents : []}
      buffers={Array.isArray(props.buffers) ? props.buffers : []}
      additives={Array.isArray(props.additives) ? props.additives : []}
    />
  );
};


/* =========================================================
   LINKS MANAGER UTILITY
========================================================= */
/* =========================================================
   CELL LINE DEFINITION SECTION
========================================================= */
/* =========================================================
   PLASMID DEFINITION SECTION
========================================================= */
/* =========================================================
   LIBRARY DIRECTORY
========================================================= */
// LibraryDirectory now lives in ./components/AppModules/libraryDirectory (see import above).

const normalizeCustomFields = (fields) => {
  if (!Array.isArray(fields)) return [];

  return fields.map((field, idx) => {
    const base =
      typeof field === 'string'
        ? { name: field }
        : field && typeof field === 'object'
        ? field
        : {};

    const firstArrayType =
      Array.isArray(base.types) && base.types.length ? base.types[0] : undefined;

    let appliesTo =
      base.appliesTo ||
      base.applyTo ||
      base.scope ||
      base.tab ||
      base.testType ||
      firstArrayType ||
      'all';

    if (Array.isArray(appliesTo) && appliesTo.length === 0) {
      appliesTo = 'all';
    }

    return {
      ...base,
      id: base.id || `custom_field_${idx}_${Math.random().toString(36).slice(2, 8)}`,
      name: base.name || `Field ${idx + 1}`,
      type: base.type || 'text',
      options: Array.isArray(base.options) ? base.options : [],
      appliesTo,
      // Which named subsection of the target page this field belongs to
      // (a notebookChecks id, e.g. 'cond', 'seq', 'instrument'). Empty
      // string = general / applies anywhere on the page.
      subsection: typeof base.subsection === 'string' ? base.subsection : ''
    };
  });
};

/* =========================================================
   MANDATORY PARAMETER RULES
   { id, page: 'all' | typeKey, subsection: '' | notebookCheck id, fieldName }
   Migrates the legacy flat `mandatoryFields` string array (global,
   no page/subsection scoping) into the new rule shape when needed.
========================================================= */
const normalizeMandatoryRules = (rules, legacyFlatFields) => {
  if (Array.isArray(rules) && rules.length) {
    return rules
      .map((r, idx) => ({
        id: r?.id || `mandatory_rule_${idx}_${Math.random().toString(36).slice(2, 8)}`,
        page: r?.page || 'all',
        subsection: r?.subsection || '',
        fieldName: (r?.fieldName || r?.name || '').toString()
      }))
      .filter((r) => r.fieldName.trim());
  }

  if (Array.isArray(legacyFlatFields) && legacyFlatFields.length) {
    return legacyFlatFields
      .filter(Boolean)
      .map((name, idx) => ({
        id: `mandatory_rule_legacy_${idx}_${Math.random().toString(36).slice(2, 8)}`,
        page: 'all',
        subsection: '',
        fieldName: String(name)
      }));
  }

  return [];
};

// Molecule/sequence utilities now live in ./utils/sequenceInfo (see import above).

// Calculations module now lives in ./components/AppModules/calculationsModule (see import above).
// CompoundDefinitionSection now lives in ./components/AppModules/compoundDefinitionSection (see import above).
// Definitions managers now live in ./components/AppModules/definitionsManagers (see import above).

/* =========================================================
   MIGRATION UTILITIES
========================================================= */

const migrateLoadedDataset = (s) => {
  const rawTests = (s && (s.tests || s.plates)) || [];

  let tests = rawTests.map((p) => {
    let safeComments = typeof p.comments === 'string' ? p.comments : '';

    safeComments = safeComments.replace(
      /<img[^>]+src="data:image\/[^;]+;base64,([^">]{500000,})"[^>]*>/gi,
      '<br/><span style="color:red; font-size:10px; font-weight:bold;">[Massive image removed]</span><br/>'
    );

    let safeImages = Array.isArray(p.images)
      ? p.images.filter(
          (img) =>
            typeof img === 'string' &&
            !(img.startsWith('data:image/') && img.length > 500000)
        )
      : [];

    let migratedType = p.type;

    if (!migratedType && p.plateType) {
      migratedType = p.plateType === '9x9box' ? 'plate-9x9box' : 'plate-' + p.plateType;
    }

    let migratedCategory =
      p.testCategory || (p.expTypes && p.expTypes.length > 0 ? p.expTypes[0] : 'Activity');

    if (migratedType === 'nmr') {
      return {
        moleculeName: '',
        experimentDate: '',
        concentration: '',
        solvent: '',
        saltConcentration: '',
        temperature: '',
        otherMolecule: '',
        ratio: '',
        tableMode: 'backbone',
        compound: '',
        ...p,
        type: 'nmr',
        testCategory: migratedCategory,
        comments: safeComments,
        images: safeImages
      };
    }

    if (migratedType === 'cd') {
      return {
        compound: '',
        experimentDate: '',
        concentration: '',
        solvent: '',
        saltConcentration: '',
        temperature: '',
        buffer: '',
        pathLength: '1',
        otherMolecule: '',
        ratio: '',
        wavelengthData: '',
        spectraColumns: [],
        structureComposition: {
          'α-Helix': 30,
          'β-Sheet': 20,
          Turn: 10,
          'Random Coil': 40
        },
        chartCfg: {
          yMin: '',
          yMax: '',
          xMin: '190',
          xMax: '260',
          fontSize: 12,
          lineWidth: 2
        },
        ...p,
        type: 'cd',
        testCategory: migratedCategory,
        comments: safeComments,
        images: safeImages
      };
    }

    return {
      ...p,
      type: migratedType || 'plate-96',
      testCategory: migratedCategory,
      comments: safeComments,
      images: safeImages
    };
  });

  const existingStorages = s && s.storages ? s.storages.slice() : [];
  const legacyGroups = {};

  tests.forEach((t) => {
    if (t.type !== 'plate-9x9box' || t.storageId) return;

    const label = typeof t.storageLabel === 'string' ? t.storageLabel.trim() : '';
    const typeText = typeof t.storageType === 'string' ? t.storageType.trim() : '';

    if (!label && !typeText) return;

    const key = typeText + '||' + label;

    if (!legacyGroups[key]) {
      legacyGroups[key] = { typeText, label, items: [] };
    }

    legacyGroups[key].items.push(t);
  });

  const newStorages = [];

  Object.values(legacyGroups).forEach((group, gi) => {
    const normType = /frigo|refriger/i.test(group.typeText)
      ? 'Refrigerator'
      : /clos|armad|closet/i.test(group.typeText)
      ? 'Closet'
      : 'Freezer';

    const stId = 'st_legacy_' + Date.now().toString(36) + '_' + gi;
    const cols = 4;
    const rows = Math.max(5, Math.ceil(group.items.length / cols));

    newStorages.push({
      id: stId,
      name: group.label || group.typeText || 'Imported Storage ' + (gi + 1),
      type: normType,
      rows,
      cols,
      imageUrl: ''
    });

    group.items.forEach((t, idx) => {
      t.storageId = stId;
      t.storageIndex = idx;
    });
  });

  return {
    tests,
    storages: newStorages.length > 0 ? [...existingStorages, ...newStorages] : existingStorages
  };
};

/* =========================================================
   FIREBASE SETUP
========================================================= */

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCVemPUayc_Q-IsbcQxnFRHg8bBLZFSHfA',
  authDomain: 'cell-experiment-tracker.firebaseapp.com',
  projectId: 'cell-experiment-tracker',
  storageBucket: 'cell-experiment-tracker.firebasestorage.app',
  messagingSenderId: '855790481107',
  appId: '1:855790481107:web:a566455d3f13a48a20ae26'
};

let app,
  auth,
  db,
  appId = 'lab-workspace-app';

try {
  if (window.firebase) {
    if (!window.firebase.apps.length) {
      app = window.firebase.initializeApp(FIREBASE_CONFIG);
    } else {
      app = window.firebase.app();
    }

    auth = window.firebase.auth();
    db = window.firebase.firestore();
  }
} catch (e) {
  console.error('Firebase init error. Falling back to local storage.', e);
}
// StorageFinder + DatabaseCleanupManager now live in ./components/AppModules/storageModules (see import above).
/* =========================================================
CLASSIFICATION CONSTANTS
========================================================= */
export { CLASSIFICATION_MAP, PRIMARY_CATEGORIES, EXPERIMENT_TYPES } from './data/testTypes';
/* =========================================================
MAIN APP
========================================================= */
export default function App() {
  const createEmptyTest = (id, num, customType = 'plate-96') => {
const baseTest = {
  id,
  name: `Test ${num}`,
  date: new Date().toISOString().split('T')[0],
  instanceName: '',
  testCategory: 'Activity',
  secondaryCategory: '',
  bestMeasurement: false,
  operator: '',
  boxOwner: '',
  sampleOwner: '',
  type: customType,
  storageType: '',
  storageLabel: '',
  storageIndex: null,
  comments: '',
  images: [],
  documents: [],
  plan: [],
  linkedProtocolId: '',
  cellLines: [],
  customFieldValues: {},
  selectedCompounds: [],
  compound: ''
};

    if (customType.startsWith('plate')) {
      const dimKey = customType.split('-')[1];
      const dim = PLATES_DEF[dimKey] || PLATES_DEF['96'];

      const defGrid = Array(26)
        .fill(null)
        .map(() => Array(26).fill(''));

      const defCell = Array(26)
        .fill(null)
        .map(() =>
          Array(26)
            .fill(null)
            .map(() => ({
              excluded: false,
              role: null,
              conc: null,
              region: 'Primary',
              manualOverride: false
            }))
        );

      return {
        ...baseTest,
        plateType: dimKey,
        grid: defGrid,
        boxRows: 9,
        boxCols: 9,
        compounds: Array(dim?.cols || 12).fill(''),
        rowCompounds: Array(dim?.rows || 8).fill(''),
        cellConfig: defCell,
        ctrlType: 'cells',
        ctrlODStr: '1.0',
        bgType: 'none',
        bgManualStr: '0',
        unit: 'µM',
        cellsSeeded: '',
        test: '',
        manualErrors: {},
        topConcStr: '100',
        dilFactorStr: '3',
        glbOffsetStr: '0',
        errScaleStr: '1',
        useFixedSD: false,
        fixedSDStr: '0',
        showViab: true,
        fitIC50: true,
        showExcl: false,
        outlierThreshStr: '2.0',
        chartCfg: {
          yMin: '',
          yMax: '',
          xMin: '',
          xMax: '',
          ptStyle: 'circle',
          ptSize: 5,
          fontSize: 16,
          xPos: 'bottom',
          yPos: 'left',
          xAxisLabel: '',
          lineStyle: 'solid',
          lineThickness: 2
        }
      };
    }
    
    if (customType === 'md_simulation') {
      return {
        ...baseTest,
        type: 'md_simulation',
        testCategory: 'Production',
        forceField: '',
        waterModel: '',
        temperature: '',
        pressure: '',
        simulationTime: '',
        timestep: '',
        boxType: '',
        ionConcentration: '',
        software: '',
        trajectoryLink: '',
        topologyLink: '',
        setupFileLink: '',
        images: []
      };
    }

    if (customType === 'cloning') {
      return {
        ...baseTest,
        type: 'cloning',
        testCategory: 'Vector Construction',
        pcrProgram: [],
        reactionMix: [],
        dnaQuantification: [],
        gelImages: [],
        uvSpectra: [],
        sim: null
      };
    }

    if (customType === 'nmr') {
      return {
        ...baseTest,
        proteinSequence: '',
        selectedNuclei: ['H', 'C', 'N'],
        chemicalShifts: {},
        nmrSpectraImages: [],
        moleculeName: '',
        experimentDate: '',
        concentration: '',
        solvent: '',
        saltConcentration: '',
        temperature: '',
        otherMolecule: '',
        ratio: '',
        tableMode: 'backbone',
        compound: ''
      };
    }

    if (customType === 'cd') {
      return {
        ...baseTest,
        compound: '',
        experimentDate: '',
        concentration: '',
        solvent: '',
        saltConcentration: '',
        temperature: '',
        buffer: '',
        pathLength: '1',
        otherMolecule: '',
        ratio: '',
        wavelengthData: '',
        spectraColumns: [],
        structureComposition: {
          'α-Helix': 30,
          'β-Sheet': 20,
          Turn: 10,
          'Random Coil': 40
        },
        chartCfg: {
          yMin: '',
          yMax: '',
          xMin: '190',
          xMax: '260',
          fontSize: 12,
          lineWidth: 2
        }
      };
    }
if (customType === 'ssnmr') {
return {
...baseTest,
type: 'ssnmr',
testCategory: 'Solid-state NMR',
lipid: '',
deuteration: '',
hydration: '',
cholesterolRatio: '',
ratio: '',
wavelengthData: '',
spectraColumns: [],
ssFits: {},
brukerMeta: null,
chartCfg: {
yMin: '',
yMax: '',
xMin: '-250',
xMax: '250',
fontSize: 12,
lineWidth: 2
}
};
}
    if (customType === 'protein_expression') {
      return {
        ...baseTest,
        type: 'protein_expression',
        testCategory: 'Expression Optimization', 
        yieldData: [],
        gelImages: [],
        chromatogramRaw: '',
        inductionMethod: '',
        inductionTemp: '',
        lysisBuffer: '',
        columnType: ''
      };
    }

    
if (customType === 'docking') {
   return {
     ...baseTest,
     type: 'docking',
     testCategory: 'Blind Docking',
     dockingProgram: '',
     scoringFunction: '',
     searchAlgorithm: '',
     exhaustiveness: '',
     numModes: '',
     boxCenter: '',
     boxSize: '',
     bestAffinity: '',
     dockingImages: [],
     dockingResults: []
   };
 }
 if (customType === 'flow_cytometry') {
   return {
     ...baseTest,
     type: 'flow_cytometry',
     testCategory: 'Immunophenotyping',
     cellNumber: '',
     liveDeadStain: '',
     fixation: 'None',
     permeabilization: 'None',
     fcMachine: '',
     acquisitionSoftware: '',
     fcPanel: [],
     fcPopulations: []
   };
 }
if (customType === 'nmr-fittings') {
      const rows = 8;
      const cols = 12;

      const defGrid = Array.from({ length: rows }, () => Array(cols).fill(''));

      const defCell = Array.from({ length: rows }, () =>
        Array(cols)
          .fill(null)
          .map(() => ({
            excluded: false,
            role: null,
            conc: null,
            region: 'Primary',
            manualOverride: false
          }))
      );

      return {
        ...baseTest,
        name: `NMR Fitting ${num}`,
        type: 'nmr-fittings',
        testCategory: 'NMR Fittings',
        gridPreset: '96',
        plateType: '96',
        rows,
        cols,
        rowsStr: String(rows),
        colsStr: String(cols),
        grid: defGrid,
        cellConfig: defCell,
        compounds: Array(cols).fill(''),
        rowCompounds: Array(rows).fill(''),
        operator: '',
        moleculeId: '',
        moleculeName: '',
        unit: 'µM',
        valueUnit: 'a.u.',
        topConcStr: '',
        dilFactorStr: '',
        ctrlType: 'none',
        ctrlODStr: '',
        bgType: 'none',
        bgManualStr: '',
        manualErrors: {},
        useFixedSD: false,
        fixedSDStr: '0',
        showViab: false,
        fitIC50: false,
        showExcl: false,
        outlierThreshStr: '2.0',
        chartCfg: {
          yMin: '',
          yMax: '',
          xMin: '',
          xMax: '',
          ptStyle: 'circle',
          ptSize: 5,
          fontSize: 16,
          xPos: 'bottom',
          yPos: 'left',
          xAxisLabel: '',
          lineStyle: 'solid',
          lineThickness: 2
        }
      };
    }

    return baseTest;
  };

  const [user, setUser] = useState(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [mandatoryFields, setMandatoryFields] = useState([]);
  const [mandatoryRules, setMandatoryRules] = useState([]);
  const [mandatoryBehavior, setMandatoryBehavior] = useState({});
  const [isCloudReady, setIsCloudReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle');
  const [saveErrorMsg, setSaveErrorMsg] = useState('');
  const [appView, setAppView] = useState('explorer');
  const [currentModule, setCurrentModule] = useState('dashboard');
  const [datasetsList, setDatasetsList] = useState([]);
  const [currentDatasetId, setCurrentDatasetId] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [pendingLoad, setPendingLoad] = useState(null);
  const [appClipboard, setAppClipboard] = useState(null);
  const [datasetTitle, setDatasetTitle] = useState('');
  const [datasetSubtitle, setDatasetSubtitle] = useState('');
  const [customCmpds, setCustomCmpds] = useState([]);
  const [customCellLines, setCustomCellLines] = useState([]);
  const [customConc, setCustomConc] = useState({});
  const [cmpColors, setCmpColors] = useState({});
  const [operators, setOperators] = useState(() => {
    try {
      const saved = localStorage.getItem('labWorkspace_operators');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  // ── AUTH STATE ──────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const stored = sessionStorage.getItem('labCurrentUser');
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });
  const [loginModal, setLoginModal] = useState(null); // null | { targetScientistName?: string, onSuccess?: fn, isEntryGate?: bool }
  const [authSettings, setAuthSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('labWorkspace_authSettings');
      return saved ? JSON.parse(saved) : { requireLoginOnEntry: true, hideOtherScientistTests: false };
    } catch { return { requireLoginOnEntry: true, hideOtherScientistTests: false }; }
  });
  const [unlockedTestIds, setUnlockedTestIds] = useState(new Set());
  const [recoveryBypass, setRecoveryBypass] = useState(false); // transient — not persisted
  // ────────────────────────────────────────────────────────

  const [customFields, setCustomFields] = useState([]);
  const [molecules, setMolecules] = useState([]);
  const [solvents, setSolvents] = useState([]);

  const [buffers, setBuffers] = useState([]);
  const [additives, setAdditives] = useState([]);
  const [nmrInstruments, setNmrInstruments] = useState([]);
  const [nmrProbes, setNmrProbes] = useState([]);
  const [nmrExperiments, setNmrExperiments] = useState([]);
  const [compoundMeta, setCompoundMeta] = useState({});
  const [calculationEntries, setCalculationEntries] = useState({});
  const [cellLineMeta, setCellLineMeta] = useState({});
  const [plasmidMeta, setPlasmidMeta] = useState({});
  const [activeLibrarySelection, setActiveLibrarySelection] = useState({ type: null, id: null });
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 768);
  const [storages, setStorages] = useState([]);
  const [activeStorageId, setActiveStorageId] = useState(null);
  const [storageModal, setStorageModal] = useState(null);
  const [moveModal, setMoveModal] = useState(null);
 const [testCategories, setTestCategories] = useState(PRIMARY_CATEGORIES);
  const [protocolCategories, setProtocolCategories] = useState([
    'Preparation',
    'Measurement',
    'Analysis'
  ]);
  const [datasetProtocols, setDatasetProtocols] = useState([]);
  const [protoImgInput, setProtoImgInput] = useState(''); // for inline image URL entry

  const historyRef = useRef([[createEmptyTest('t1', 1, 'plate-96')]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [reactTests, setReactTests] = useState(historyRef.current[0]);

  const tests = reactTests;

  const allCmpds = useMemo(() => {
    return [...new Set([...DEF_COMPOUNDS, ...customCmpds])].filter(Boolean);
  }, [customCmpds]);

  const allCellLines = useMemo(() => {
    return [...new Set([...DEF_CELL_LINES, ...customCellLines])].filter(Boolean);
  }, [customCellLines]);

  const [activeTestId, setActiveTestId] = useState('t1');

  const setTests = useCallback(
    (updater) => {
      setReactTests((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        const nextStr = JSON.stringify(next);
        const prevStr = JSON.stringify(prev);

        if (nextStr !== prevStr) {
          const currentHistory = historyRef.current.slice(0, historyIndex + 1);
          currentHistory.push(next);

          if (currentHistory.length > 50) currentHistory.shift();

          historyRef.current = currentHistory;
          setHistoryIndex(currentHistory.length - 1);
        }

        return next;
      });
    },
    [historyIndex]
  );

  const handleSetCustomFields = useCallback((updater) => {
    setCustomFields((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      return normalizeCustomFields(next);
    });
  }, []);

  const handleUndo = () => {
    if (historyIndex > 0) {
      const newIdx = historyIndex - 1;
      setHistoryIndex(newIdx);
      setReactTests(historyRef.current[newIdx]);
    }
  };

  const handleRedo = () => {
    if (historyIndex < historyRef.current.length - 1) {
      const newIdx = historyIndex + 1;
      setHistoryIndex(newIdx);
      setReactTests(historyRef.current[newIdx]);
    }
  };

  // ── PERSIST OPERATORS & AUTH SETTINGS ─────────────────────────────────
  // Always keep localStorage in sync (works offline / as cache)
  useEffect(() => {
    try { localStorage.setItem('labWorkspace_operators', JSON.stringify(operators)); } catch {}
  }, [operators]);

  useEffect(() => {
    try { localStorage.setItem('labWorkspace_authSettings', JSON.stringify(authSettings)); } catch {}
  }, [authSettings]);

  // Sync operators + authSettings TO Firestore whenever they change (cloud persistence)
  const appConfigSaveRef = useRef(null);
  useEffect(() => {
    if (!db || !user) return; // only sync when logged into Firebase
    if (appConfigSaveRef.current) clearTimeout(appConfigSaveRef.current);
    appConfigSaveRef.current = setTimeout(async () => {
      try {
        await db.collection(`artifacts/${appId}/public/data/appConfig`).doc('global').set({
          operators: JSON.stringify(operators),
          authSettings: JSON.stringify(authSettings),
          updatedAt: window.firebase ? window.firebase.firestore.FieldValue.serverTimestamp() : Date.now()
        }, { merge: true });
      } catch (e) { console.warn('Could not sync app config to Firestore:', e.message); }
    }, 1500);
    return () => { if (appConfigSaveRef.current) clearTimeout(appConfigSaveRef.current); };
  }, [operators, authSettings, user, db]);
  // ─────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!auth) {
      setIsCloudReady(true);
      return;
    }

    const initAuth = async () => {
      auth.onAuthStateChanged((currentUser) => {
        if (currentUser) {
          setUser(currentUser);
          setNeedsLogin(false);
          setIsCloudReady(true);
        } else {
          setNeedsLogin(true);
          setIsCloudReady(true);
        }
      });
    };

    initAuth();
  }, []);

// ── LOAD operators + authSettings FROM Firestore on login ─────────────
  useEffect(() => {
    if (!db || !user) return;
    const unsubscribe = db
      .collection(`artifacts/${appId}/public/data/appConfig`)
      .doc('global')
      .onSnapshot(
        (doc) => {
          if (!doc.exists) return;
          const data = doc.data();
          
          // Fix infinite loop: only update state if cloud data differs from current local string
          try {
            if (data.operators) {
              const currentLocal = localStorage.getItem('labWorkspace_operators');
              if (currentLocal !== data.operators) {
                const parsed = JSON.parse(data.operators);
                if (Array.isArray(parsed) && parsed.length > 0) {
                  setOperators(parsed);
                  localStorage.setItem('labWorkspace_operators', data.operators);
                }
              }
            }
          } catch {}

          try {
            if (data.authSettings) {
              const currentLocal = localStorage.getItem('labWorkspace_authSettings');
              if (currentLocal !== data.authSettings) {
                const parsed = JSON.parse(data.authSettings);
                if (parsed && typeof parsed === 'object') {
                  setAuthSettings(parsed);
                  localStorage.setItem('labWorkspace_authSettings', data.authSettings);
                }
              }
            }
          } catch {}
        },
        (err) => console.warn('AppConfig Firestore listener error:', err.message)
      );
    return () => unsubscribe();
  }, [user, db]);
  // ──────────────────────────────────────────────────────────────────────


    const handleManualLogin = async () => {
    const provider = new window.firebase.auth.GoogleAuthProvider();

    try {
      await auth.signInWithPopup(provider);
    } catch (e) {
      console.error('Errore login:', e);
    }
  };

  useEffect(() => {
    if (needsLogin) return;

    const urlParams = new URLSearchParams(window.location.search);
    const sharedDatasetId = urlParams.get('dataset');

    if (sharedDatasetId && isCloudReady && db && !currentDatasetId) {
      db.collection(`artifacts/${appId}/public/data/datasets`)
        .doc(sharedDatasetId)
        .get()
        .then((doc) => {
          if (doc.exists) {
            const dset = { id: doc.id, ...doc.data() };
            openDataset(dset);
          }
        })
        .catch((err) => console.error('Errore dataset condiviso:', err));
    }
  }, [isCloudReady, db, currentDatasetId, needsLogin]);

  useEffect(() => {
    if (db && user) {
      const collRef = db.collection(`artifacts/${appId}/public/data/datasets`);

      const unsubscribe = collRef.onSnapshot(
        (snap) => {
          const dsets = [];

          snap.forEach((doc) => {
            dsets.push({ id: doc.id, ...doc.data() });
          });

          dsets.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

          setDatasetsList(dsets);
          setIsCloudReady(true);
        },
        (err) => {
          console.error('Firestore sync error:', err);

          try {
            const stored = localStorage.getItem(LOCAL_STORAGE_KEY);

            if (stored) {
              setDatasetsList(
                JSON.parse(stored).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
              );
            }
          } catch (e) {}

          setIsCloudReady(true);
        }
      );

      return () => unsubscribe();
    }

    if (!user) {
      try {
        const stored = localStorage.getItem(LOCAL_STORAGE_KEY);

        if (stored) {
          setDatasetsList(
            JSON.parse(stored).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
          );
        }
      } catch (e) {}

      setIsCloudReady(true);
    }
  }, [user, db]);

  // ── Derived string array for backward-compatible child components ──
  // All child components (test renderers, LabNotebook, Storage, etc.) still
  // expect operators as plain strings. This is the safe list to pass them.
  const operatorNames = normalizeOperators(operators).map((op) => op.name);

  // Bootstrap mode: if no superuser exists yet, allow anyone to define roles
  const hasSuperuserDefined = normalizeOperators(operators).some((op) => op.role === 'superuser');

  const latestDataRef = useRef(null);


  latestDataRef.current = {
    tests,
    datasetTitle,
    datasetSubtitle,
    customCmpds,
    customCellLines,
    customConc,
    cmpColors,
    testCategories,
    protocolCategories,
    datasetProtocols,
    storages,
    customFields,
    operators,
    molecules,
    compoundMeta,
    calculationEntries,
    cellLineMeta,
    plasmidMeta,
    solvents,
    buffers,
    additives,
    nmrInstruments,
    nmrProbes,
    nmrExperiments,
    mandatoryFields,
    mandatoryRules,
    mandatoryBehavior,
    authSettings
  };

  const getCompressedPayload = () =>
    LZString.compressToUTF16(JSON.stringify(latestDataRef.current));

  // ── Sync currentUser to sessionStorage ──────────────────
  useEffect(() => {
    try {
      if (currentUser) {
        sessionStorage.setItem('labCurrentUser', JSON.stringify(currentUser));
      } else {
        sessionStorage.removeItem('labCurrentUser');
      }
    } catch {}
  }, [currentUser]);

  // ── Validate currentUser still exists in operators list ─
  useEffect(() => {
    if (!currentUser) return;
    const normalized = normalizeOperators(operators);
    const stillExists = normalized.some((op) => op.id === currentUser.id);
    if (!stillExists) {
      setCurrentUser(null);
    }
  }, [operators, currentUser]);

const saveTimeoutRef = useRef(null);
useEffect(() => {
  if (!isCloudReady || appView !== 'dataset' || !currentDatasetId) return;
  setSaveStatus('saving');
  if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
  saveTimeoutRef.current = setTimeout(async () => {
    try {
      const rawData = latestDataRef.current;
      // Compress payload to prevent Firestore 1MB limit and write stream exhaustion
      const compressedPayload = LZString.compressToUTF16(JSON.stringify(rawData));

      const updatedPayload = {
        title: datasetTitle || 'Untitled Dataset',
        subtitle: datasetSubtitle || '',
        date: rawData.tests?.[0]?.date || new Date().toISOString().split('T')[0],
        testCount: rawData.tests?.length || 0,
        updatedAt: window.firebase
          ? window.firebase.firestore.FieldValue.serverTimestamp()
          : Date.now(),
        payload: compressedPayload,
        isCompressed: true
      };
      if (db && user) {
        const docRef = db
          .collection(`artifacts/${appId}/public/data/datasets`)
          .doc(currentDatasetId);
        await docRef
          .set(updatedPayload, { merge: true })
          .then(() => {
            setSaveStatus('saved');
            setSaveErrorMsg('');
          })
          .catch((err) => {
            setSaveStatus('error');
            setSaveErrorMsg(err.message);
            console.error('Firestore save error:', err);
          });
      } else {
        let stored = [];
        try {
          stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
        } catch (e) {}
        const existingIdx = stored.findIndex((e) => e.id === currentDatasetId);
        if (existingIdx >= 0) {
          stored[existingIdx] = { ...stored[existingIdx], ...updatedPayload };
        } else {
          stored.push({ id: currentDatasetId, ...updatedPayload });
        }
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stored));
        setDatasetsList(
          [...stored].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        );
        setSaveStatus('saved');
      }
    } catch (e) {
      setSaveStatus('error');
      setSaveErrorMsg(e.message);
      console.error('Save error:', e);
    }
  }, 1500);
  return () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
  };
}, [
  tests, datasetTitle, datasetSubtitle, customCmpds, customCellLines,
  customConc, cmpColors, testCategories, protocolCategories, datasetProtocols,
  customFields, operators, molecules, compoundMeta, calculationEntries,
  cellLineMeta, plasmidMeta, storages, solvents, buffers, additives,
  nmrInstruments, nmrProbes, nmrExperiments, isCloudReady, appView,
  currentDatasetId, user, authSettings
]);


  const exportHTML = () => {
    try {
      const payload = getCompressedPayload();

      const dataBlob = {
        payload,
        isCompressed: true,
        title: datasetTitle || 'Untitled Dataset',
        subtitle: datasetSubtitle || '',
        savedAt: Date.now()
      };

      const clone = document.documentElement.cloneNode(true);
      const oldTag = clone.querySelector('#saved-data-blob');

      if (oldTag) oldTag.remove();

      const oldLoader = clone.querySelector('#loader');

      if (oldLoader) oldLoader.style.display = 'none';

      const tag = document.createElement('script');
      tag.id = 'saved-data-blob';
      tag.type = 'application/json';
      tag.textContent = JSON.stringify(dataBlob);

      clone.querySelector('body').appendChild(tag);

      const htmlStr = '<!DOCTYPE html>\n' + clone.outerHTML;
      const blob = new Blob([htmlStr], { type: 'text/html' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `${(datasetTitle || 'dataset').replace(/[^a-z0-9]+/gi, '_')}.html`;

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setDialog({
        type: 'alert',
        title: 'Save Failed',
        message: 'Could not save HTML file: ' + e.message
      });
    }
  };

  const loadHTML = (e) => {
    const file = e.target.files && e.target.files[0];

    if (!file) return;

    if (file.size > 900000) {
      setDialog({
        type: 'alert',
        title: 'Large File Warning',
        message:
          'This file is very large. After loading, saving to cloud might fail due to the 1MB limit. Consider removing embedded images.'
      });
    }

    const reader = new FileReader();

    reader.onload = (ev) => {
      try {
        const text = ev.target.result;
        let s = null;
        let loadedTests = [];

        const newMatch = text.match(
          /<script[^>]*id=["']saved-data-blob["'][^>]*>([\s\S]*?)<\/script>/
        );

        if (newMatch) {
          const dataBlob = JSON.parse(newMatch[1]);
          let pStr = dataBlob.payload;

          if (dataBlob.isCompressed) {
            const dec = LZString.decompressFromUTF16(pStr);
            if (dec) pStr = dec;
          }

          s = JSON.parse(pStr);
          loadedTests = s.tests || s.plates || [];

          if (loadedTests.length === 0) {
            setDialog({
              type: 'alert',
              title: 'Load Failed',
              message: 'No tests found in this file.'
            });
            return;
          }
        } else {
          setDialog({
            type: 'alert',
            title: 'Load Failed',
            message: 'No dataset data found in this HTML file.'
          });
          return;
        }

        const migrated = migrateLoadedDataset(s);

        loadedTests = migrated.tests;
        s.storages = migrated.storages;

        setPendingLoad({ tests: loadedTests, fullState: s });
      } catch (err) {
        setDialog({
          type: 'alert',
          title: 'Load Failed',
          message: 'Could not read this file: ' + err.message
        });
      }
    };

    reader.readAsText(file);

    e.target.value = '';
  };

  const confirmLoad = (mode) => {
    const { tests: loadedTests, fullState: s } = pendingLoad;
    let targetId = currentDatasetId;

    if (!targetId || mode === 'replace') {
      targetId = s.id || 'ds_' + Date.now();
      setCurrentDatasetId(targetId);
      setAppView('dataset');
      window.history.pushState({}, '', '?dataset=' + targetId);
    }

    if (mode === 'replace') {
      setReactTests(loadedTests);
      historyRef.current = [loadedTests];
      setHistoryIndex(0);

      if (loadedTests.length > 0) {
        setActiveTestId(loadedTests[0].id);
      }

      if (s.datasetTitle !== undefined) setDatasetTitle(s.datasetTitle);
      else if (s.reportTitle !== undefined) setDatasetTitle(s.reportTitle);

      if (s.datasetSubtitle !== undefined) setDatasetSubtitle(s.datasetSubtitle);
      else if (s.reportSubtitle !== undefined) setDatasetSubtitle(s.reportSubtitle);

      if (s.customCmpds !== undefined) setCustomCmpds(s.customCmpds);
      if (s.customCellLines !== undefined) setCustomCellLines(s.customCellLines);
      if (s.customConc !== undefined) setCustomConc(s.customConc);
      if (s.cmpColors !== undefined) setCmpColors(s.cmpColors);
      if (s.testCategories !== undefined) setTestCategories(s.testCategories);
      if (s.protocolCategories !== undefined) setProtocolCategories(s.protocolCategories);
      if (s.datasetProtocols !== undefined) setDatasetProtocols(s.datasetProtocols);
      if (s.storages !== undefined) setStorages(s.storages);
      // NOTE: operators and authSettings are NEVER imported from HTML
      // They are global app-level identity/security state — not dataset state.
      // if (s.operators !== undefined) setOperators(...);
      if (s.molecules !== undefined) setMolecules(s.molecules);
      if (s.compoundMeta !== undefined) setCompoundMeta(s.compoundMeta);
      if (s.calculationEntries !== undefined) setCalculationEntries(s.calculationEntries);
      if (s.cellLineMeta !== undefined) setCellLineMeta(s.cellLineMeta);
      if (s.plasmidMeta !== undefined) setPlasmidMeta(s.plasmidMeta);
      if (s.mandatoryFields !== undefined) setMandatoryFields(s.mandatoryFields);
      if (s.mandatoryRules !== undefined || s.mandatoryFields !== undefined) {
        setMandatoryRules(normalizeMandatoryRules(s.mandatoryRules, s.mandatoryFields));
      }
      if (s.mandatoryBehavior !== undefined) setMandatoryBehavior(s.mandatoryBehavior);
      // NOTE: authSettings not imported from HTML either — kept as global security config
      // if (s.authSettings !== undefined) setAuthSettings(...);
      if (s.solvents !== undefined) setSolvents(s.solvents);
      if (s.buffers !== undefined) setBuffers(s.buffers);
      if (s.additives !== undefined) setAdditives(s.additives);
      if (s.nmrInstruments !== undefined) setNmrInstruments(s.nmrInstruments);
      if (s.nmrProbes !== undefined) setNmrProbes(s.nmrProbes);
      if (s.nmrExperiments !== undefined) setNmrExperiments(s.nmrExperiments);

      if (s.customFields !== undefined) {
        setCustomFields(normalizeCustomFields(s.customFields));
      }
    } else if (mode === 'append') {
      const newTests = loadedTests.map((p) => ({
        ...p,
        id: 't' + Math.random().toString(36).substr(2, 9) + Date.now()
      }));

      setTests((prev) => [...prev, ...newTests]);

      if (newTests.length > 0) {
        setActiveTestId(newTests[0].id);
      }

      if (s.customCmpds !== undefined) {
        setCustomCmpds((prev) => [...new Set([...prev, ...s.customCmpds])]);
      }

      if (s.customCellLines !== undefined) {
        setCustomCellLines((prev) => [...new Set([...prev, ...s.customCellLines])]);
      }

      if (s.customConc !== undefined) {
        setCustomConc((prev) => ({ ...prev, ...s.customConc }));
      }

      if (s.cmpColors !== undefined) {
        setCmpColors((prev) => ({ ...prev, ...s.cmpColors }));
      }

      if (s.customFields !== undefined) {
        setCustomFields((prev) => {
          const incoming = normalizeCustomFields(s.customFields);
          const existingIds = new Set(prev.map((f) => f.id));
          const additions = incoming.filter((f) => !existingIds.has(f.id));
          return [...prev, ...additions];
        });
      }

      if (s.compoundMeta !== undefined) setCompoundMeta((prev) => ({ ...prev, ...s.compoundMeta }));
      if (s.cellLineMeta !== undefined) setCellLineMeta((prev) => ({ ...prev, ...s.cellLineMeta }));
      if (s.plasmidMeta !== undefined) setPlasmidMeta((prev) => ({ ...prev, ...s.plasmidMeta }));
if (s.mandatoryFields !== undefined) setMandatoryFields((prev) => [...new Set([...prev, ...s.mandatoryFields])]);
      if (s.mandatoryRules !== undefined || s.mandatoryFields !== undefined) {
        setMandatoryRules((prev) => {
          const incoming = normalizeMandatoryRules(s.mandatoryRules, s.mandatoryFields);
          const existingKeys = new Set(
            prev.map((r) => `${r.page}|${r.subsection}|${r.fieldName.toLowerCase()}`)
          );
          const additions = incoming.filter(
            (r) => !existingKeys.has(`${r.page}|${r.subsection}|${r.fieldName.toLowerCase()}`)
          );
          return [...prev, ...additions];
        });
      }
      if (s.mandatoryBehavior !== undefined) {
        setMandatoryBehavior((prev) => ({ ...prev, ...s.mandatoryBehavior }));
      }
      if (s.calculationEntries !== undefined) {
        setCalculationEntries((prev) => {
          const next = { ...prev };

          Object.entries(s.calculationEntries || {}).forEach(
            ([compoundName, incomingEntries]) => {
              const existing = next[compoundName] || [];

              const existingIds = new Set(existing.map((entry) => entry.id));

              const additions = (
                Array.isArray(incomingEntries) ? incomingEntries : []
              ).filter((entry) => !existingIds.has(entry.id));

              next[compoundName] = [...existing, ...additions];
            }
          );

          return next;
        });
      }

      if (s.storages !== undefined) {
        setStorages((prev) => {
          const merged = [...prev];

          s.storages.forEach((newSt) => {
            if (!merged.find((st) => st.id === newSt.id)) {
              merged.push(newSt);
            }
          });

          return merged;
        });
      }

      // NOTE: operators NOT imported in append mode — they are global, not per-dataset

      if (s.molecules !== undefined) {
        setMolecules((prev) => {
          const incoming = Array.isArray(s.molecules) ? s.molecules : [];
          const existingIds = new Set(prev.map((m) => m.id || m.name));
          const additions = incoming.filter((m) => !existingIds.has(m.id || m.name));
          return [...prev, ...additions];
        });
      }
    }

    setPendingLoad(null);
    setCurrentModule('tests');

    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

const createNewDataset = async () => {
    const newId = 'ds_' + Date.now();
    const freshTests = [createEmptyTest('t1', 1, 'plate-96')];

    setReactTests(freshTests);

    historyRef.current = [freshTests];
    setHistoryIndex(0);
    setActiveTestId('t1');

    setDatasetTitle('New Dataset');
    setDatasetSubtitle('');
    setCustomCmpds([]);
    setCustomCellLines([]);
    setCustomConc({});
    setCmpColors({});
    setCustomFields([]);
    setCompoundMeta({});
    setCalculationEntries({});
    setMolecules([]);

    setCellLineMeta({});
    setPlasmidMeta({});
    setMandatoryFields([]);
    setSolvents([]);
    setBuffers([]);
    setAdditives([]);
    setNmrInstruments([]);
    setNmrProbes([]);
    setNmrExperiments([]);

     setTestCategories(PRIMARY_CATEGORIES);

    setProtocolCategories(['Preparation', 'Measurement', 'Analysis']);
    setDatasetProtocols([]);
    setStorages([]);

    setCurrentDatasetId(newId);
    setAppView('dataset');
    setCurrentModule('dashboard');

    window.history.pushState({}, '', '?dataset=' + newId);

    const updatedPayload = {
      title: 'New Dataset',
      date: new Date().toISOString().split('T')[0],
      createdAt: window.firebase
        ? window.firebase.firestore.FieldValue.serverTimestamp()
        : Date.now(),
      updatedAt: window.firebase
        ? window.firebase.firestore.FieldValue.serverTimestamp()
        : Date.now(),
      payload: JSON.stringify({ tests: freshTests }),
      isCompressed: false
    };

    if (db && user) {
      await db
        .collection(`artifacts/${appId}/public/data/datasets`)
        .doc(newId)
        .set(updatedPayload);
    } else {
      let stored = [];

      try {
        stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
      } catch (e) {}

      stored.push({ id: newId, ...updatedPayload });

      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stored));

      setDatasetsList(
        [...stored].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      );
    }
  };

const handleBackToExplorer = async () => {
  if (currentDatasetId) {
    setSaveStatus('saving');
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    try {
      const rawData = latestDataRef.current;
      const compressedPayload = LZString.compressToUTF16(JSON.stringify(rawData));
      
      const updatedPayload = {
        title: datasetTitle || 'Untitled Dataset',
        subtitle: datasetSubtitle || '',
        date: rawData.tests?.[0]?.date || new Date().toISOString().split('T')[0],
        testCount: rawData.tests?.length || 0,
        updatedAt: window.firebase
          ? window.firebase.firestore.FieldValue.serverTimestamp()
          : Date.now(),
        payload: compressedPayload,
        isCompressed: true
      };
      if (db && user) {
        await db
          .collection(`artifacts/${appId}/public/data/datasets`)
          .doc(currentDatasetId)
          .set(updatedPayload, { merge: true });
      } else {
        let stored = [];
        try {
          stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
        } catch (e) {}
        const existingIdx = stored.findIndex((e) => e.id === currentDatasetId);
        if (existingIdx >= 0) {
          stored[existingIdx] = { ...stored[existingIdx], ...updatedPayload };
        } else {
          stored.push({ id: currentDatasetId, ...updatedPayload });
        }
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stored));
        setDatasetsList(
          [...stored].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        );
      }
    } catch (e) {
      console.error('Back to explorer save error:', e);
    }
  }
  window.history.pushState({}, '', window.location.pathname);
  setAppView('explorer');
};

const openDataset = (dset) => {
  let s = null;
  try {
    // Defensively handle compressed payloads in case parsePayload doesn't already
    if (dset.isCompressed && typeof dset.payload === 'string') {
      const decompressed = LZString.decompressFromUTF16(dset.payload);
      s = decompressed ? JSON.parse(decompressed) : null;
    } else {
      s = parsePayload(dset);
    }
  } catch (e) {
    console.error('Dataset parse error:', e);
    s = null;
  }

  if (!s) {
    setDialog({
      type: 'alert',
      title: 'Error',
      message: 'Error reading dataset structure. The payload may be corrupted or too large.'
    });
    return;
  }

  try {
    const migrated = migrateLoadedDataset(s);
      const loadedTests = migrated.tests;

      if (loadedTests.length > 0) {
        setReactTests(loadedTests);
        historyRef.current = [loadedTests];
        setHistoryIndex(0);
        setActiveTestId(loadedTests[0].id);
      } else {
        const fresh = [createEmptyTest('t1', 1)];
        setReactTests(fresh);
        historyRef.current = [fresh];
        setHistoryIndex(0);
        setActiveTestId('t1');
      }

      setDatasetTitle(
        s.datasetTitle !== undefined
          ? s.datasetTitle
          : s.reportTitle !== undefined
          ? s.reportTitle
          : dset.title || 'Untitled'
      );

      setDatasetSubtitle(
        s.datasetSubtitle !== undefined ? s.datasetSubtitle : s.reportSubtitle || ''
      );

      setCustomCmpds(s.customCmpds || []);
      setCustomCellLines(s.customCellLines || []);
      setCustomConc(s.customConc || {});
      setCmpColors(s.cmpColors || {});
      setCustomFields(normalizeCustomFields(s.customFields || []));
      setCompoundMeta(s.compoundMeta || {});
      setCalculationEntries(s.calculationEntries || {});
      // NOTE: operators NOT loaded from cloud dataset — they are global identity state
      setMolecules(Array.isArray(s.molecules) ? s.molecules : []);
      setCellLineMeta(s.cellLineMeta || {});
      setPlasmidMeta(s.plasmidMeta || {});
      setMandatoryFields(s.mandatoryFields || []);
      setMandatoryRules(normalizeMandatoryRules(s.mandatoryRules, s.mandatoryFields));
      setMandatoryBehavior(s.mandatoryBehavior || {});
      setSolvents(s.solvents || []);
      setBuffers(s.buffers || []);
      setAdditives(s.additives || []);
      setNmrInstruments(s.nmrInstruments || []);
      setNmrProbes(s.nmrProbes || []);
      setNmrExperiments(s.nmrExperiments || []);
      
   setTestCategories(s.testCategories || PRIMARY_CATEGORIES);

      setProtocolCategories(
        s.protocolCategories || ['Preparation', 'Measurement', 'Analysis']
      );

      setDatasetProtocols(s.datasetProtocols || []);
      setStorages(migrated.storages);

      setCurrentDatasetId(dset.id);
      setAppView('dataset');
      setCurrentModule('dashboard');

      window.history.pushState({}, '', '?dataset=' + dset.id);
    } catch (e) {
      setDialog({
        type: 'alert',
        title: 'Error',
        message: 'Error reading dataset structure.'
      });
    }
  };

  const deleteDataset = (e, id) => {
    e.stopPropagation();

    setDialog({
      type: 'confirm',
      title: 'Delete Dataset',
      message: 'Are you sure you want to delete this entire Dataset?',
      onConfirm: async () => {
        if (db && user) {
          await db.collection(`artifacts/${appId}/public/data/datasets`).doc(id).delete();
        } else {
          let stored = [];

          try {
            stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
          } catch (e) {}

          stored = stored.filter((d) => d.id !== id);

          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stored));
          setDatasetsList(stored);
        }
      }
    });
  };

  const renameDataset = (e, id, currentTitle) => {
    e.stopPropagation();

    setDialog({
      type: 'prompt',
      title: 'Rename Dataset',
      message: 'Enter a new title for this Dataset:',
      defaultValue: currentTitle,
      onConfirm: async (newTitle) => {
        if (newTitle && newTitle.trim() !== currentTitle) {
          if (db && user) {
            await db
              .collection(`artifacts/${appId}/public/data/datasets`)
              .doc(id)
              .update({ title: newTitle.trim() });
          } else {
            let stored = [];

            try {
              stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
            } catch (e) {}

            const idx = stored.findIndex((d) => d.id === id);

            if (idx >= 0) {
              stored[idx].title = newTitle.trim();
              localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stored));
              setDatasetsList(stored);
            }
          }
        }
      }
    });
  };

  const deleteEmptyDatasets = async () => {
    const emptyDatasets = datasetsList.filter((dset) => {
      if (!dset.testCount || dset.testCount === 0) return true;

      if (dset.testCount === 1) {
        try {
          if (dset.title === 'New Dataset' || dset.title === 'Untitled Dataset') {
            const s = parsePayload(dset);

            if (s && s.tests && s.tests.length === 1) {
              const t = s.tests[0];

              if (
                t.name === 'Test 1' &&
                !t.instanceName &&
                !t.comments &&
                (!t.images || t.images.length === 0)
              ) {
                return true;
              }
            }
          }
        } catch (e) {
          return false;
        }
      }

      return false;
    });

    if (emptyDatasets.length === 0) {
      setDialog({
        type: 'alert',
        title: 'Clean Up',
        message: 'No empty datasets found.'
      });

      return;
    }

    setDialog({
      type: 'confirm',
      title: 'Delete Empty Datasets',
      message: `Are you sure you want to delete ${emptyDatasets.length} empty dataset(s)?`,
      onConfirm: async () => {
        if (db && user) {
          try {
            const batch = db.batch();

            emptyDatasets.forEach((dset) => {
              const docRef = db
                .collection(`artifacts/${appId}/public/data/datasets`)
                .doc(dset.id);

              batch.delete(docRef);
            });

            await batch.commit();
          } catch (e) {
            console.error('Batch delete failed', e);

            setDialog({
              type: 'alert',
              title: 'Error',
              message: 'Cloud deletion failed.'
            });
          }
        } else {
          let stored = [];

          try {
            stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
          } catch (e) {}

          const emptyIds = emptyDatasets.map((d) => d.id);

          stored = stored.filter((d) => !emptyIds.includes(d.id));

          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stored));
          setDatasetsList(stored);
        }
      }
    });
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState({});

  const toggleGroup = (key) =>
    setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  const groupedDatasets = useMemo(() => {
    const groups = {};

    datasetsList.forEach((dset) => {
      let catSet = new Set();
      let cellSet = new Set();

      try {
        const s = parsePayload(dset);

        if (s && s.tests) {
          s.tests.forEach((t) => {
            if (t.testCategory) catSet.add(t.testCategory);

            if (Array.isArray(t.cellLines)) {
              t.cellLines.forEach((e) => cellSet.add(e));
            }
          });
        }
      } catch (e) {}

      const catStr = Array.from(catSet).sort().join(', ');
      const cellStr = Array.from(cellSet).sort().join(', ');
      const hasMeta = catStr || cellStr;
      const key = hasMeta ? `${catStr}|${cellStr}` : `unclassified_${dset.id}`;

      if (!groups[key]) {
        groups[key] = {
          key,
          categories: catStr,
          cellLines: cellStr,
          isUnclassified: !hasMeta,
          items: []
        };
      }

      groups[key].items.push(dset);
    });

    Object.values(groups).forEach((g) => {
      g.items.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    });

    return groups;
  }, [datasetsList]);

  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });

  const [calFilterDate, setCalFilterDate] = useState(null);
  const [agendaOpFilter, setAgendaOpFilter] = useState('ALL');

  const mergedPlan = useMemo(() => {
    const all = [];

    tests.forEach((t) => {
      (t.plan || []).forEach((task) => {
        all.push({
          ...task,
          testName: t.name,
          testId: t.id,
          testOperator: t.operator || '',
          testCoScientists: Array.isArray(t.coScientists) ? t.coScientists : [],
        });
      });
    });

    let sorted = all.sort((a, b) => a.date.localeCompare(b.date));

    if (calFilterDate) sorted = sorted.filter((t) => t.date === calFilterDate);

    // Normal users are locked to their own agenda; superusers use the dropdown
    const effectiveFilter = currentUser?.role !== 'superuser' && currentUser
      ? currentUser.name
      : agendaOpFilter;

    if (effectiveFilter !== 'ALL') sorted = sorted.filter((t) => {
      // Check direct assignment, test primary operator AND co-scientists
      const assignedTo = t.assignedTo || t.testOperator || '';
      const coScis = Array.isArray(t.testCoScientists) ? t.testCoScientists : [];
      return assignedTo === effectiveFilter || coScis.includes(effectiveFilter);
    });

    return sorted;
  }, [tests, calFilterDate, agendaOpFilter, currentUser]);

  const agendaGrouped = useMemo(() => {
    const sorted = [...mergedPlan].sort((a, b) => a.date.localeCompare(b.date));

    return sorted.reduce((acc, t) => {
      acc[t.date] = acc[t.date] || [];
      acc[t.date].push(t);
      return acc;
    }, {});
  }, [mergedPlan]);

  const daysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();

  const firstDayOfMonth = new Date(
    currentMonth.getFullYear(),
    currentMonth.getMonth(),
    1
  ).getDay();

  const startDayOffset = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;
  const totalDays = daysInMonth(currentMonth.getFullYear(), currentMonth.getMonth());
  const monthName = currentMonth.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const handlePrevMonth = () =>
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));

  const handleNextMonth = () =>
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));

  const jumpToTest = (testId) => {
    setActiveTestId(testId);
    setCurrentModule('active-test');

    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  const jumpToProtocol = (protocolId) => {
    setExpandedGroups((p) => ({ ...p, activeProtoId: protocolId }));
    setCurrentModule('protocols');

    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  const handlePrint = async () => {
    // Wait for all visible images to finish loading before printing
    // This is the correct approach for public Drive/external images already in the browser
    const imgs = Array.from(document.querySelectorAll('img'));
    await Promise.all(imgs.map((img) => {
      if (img.complete && img.naturalHeight !== 0) return Promise.resolve();
      return new Promise((resolve) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
        setTimeout(resolve, 5000); // max 5s timeout per image
      });
    }));
    await new Promise((r) => setTimeout(r, 150));
    window.print();
  };

  if (needsLogin) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-100 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl flex flex-col items-center max-w-sm border border-slate-200 text-center">
          <div className="text-5xl mb-4">🔐</div>

          <h1 className="text-2xl font-black text-slate-800 mb-2">Accesso Richiesto</h1>

          <p className="text-slate-500 mb-8 text-sm leading-relaxed">
            Per ragioni di sicurezza e per sincronizzare i tuoi dati di laboratorio sul Cloud,
            il browser richiede un'azione manuale per il login.
          </p>

          <button
            onClick={handleManualLogin}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-full shadow-lg transition-transform hover:scale-105 w-full flex items-center justify-center gap-2"
          >
            <span>Accedi con Google</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen text-slate-400 text-sm">Loading…</div>}>
    <React.Fragment>

    {/* ══════════════════════════════════════════════════════
         FULL-SCREEN LOGIN GATE
         Blocks everything when requireLoginOnEntry is on.
    ══════════════════════════════════════════════════════ */}
    {authSettings.requireLoginOnEntry && !currentUser && !recoveryBypass && (
      <ScientistLoginGate
        operators={normalizeOperators(operators)}
        onLogin={(user) => {
          setCurrentUser(user);
          try { sessionStorage.setItem('labCurrentUser', JSON.stringify(user)); } catch {}
        }}
        onRecovery={() => {
          // Transient bypass — does NOT touch requireLoginOnEntry in localStorage
          // On next page load, the gate will show again normally
          setRecoveryBypass(true);
        }}
      />
    )}

    {/* Main app — hidden (but preserved) while gate is shown */}
    <div className={`w-full relative flex flex-col h-screen overflow-hidden bg-slate-50${
      authSettings.requireLoginOnEntry && !currentUser && !recoveryBypass ? ' hidden' : ''
    }`}>
<style>{`
        @media print {
          @page {
            margin: 1.5cm 1.2cm;
            size: A4 portrait;
          }

          .no-print,
          nav,
          button,
          input[type="file"],
          aside,
          [class*="sidebar"] {
            display: none !important;
          }

          .print-only {
            display: block !important;
          }

          body,
          html,
          #root {
            background: white !important;
            height: auto !important;
            min-height: 100% !important;
            overflow: visible !important;
            color: black !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          .h-screen,
          .max-h-screen,
          .flex-1,
          .overflow-y-auto,
          .overflow-hidden,
          .custom-scrollbar,
          .h-full,
          .min-h-0 {
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            position: static !important;
          }

          .fixed,
          .absolute {
            position: static !important;
          }

          .shadow-sm,
          .shadow-md,
          .shadow-lg,
          .shadow-xl,
          .shadow-2xl {
            box-shadow: none !important;
            border: 1px solid #e2e8f0 !important;
          }

          .avoid-break,
          table,
          tr,
          thead,
          tbody,
          img,
          svg,
          canvas,
          figure {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }

          h1,
          h2,
          h3,
          h4,
          h5,
          h6 {
            break-after: avoid !important;
            page-break-after: avoid !important;
            break-inside: avoid !important;
          }

          p,
          li,
          td,
          th {
            orphans: 3;
            widows: 3;
          }

          #notebook-report-container > * {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            margin-top: 0.4cm;
            margin-bottom: 0.4cm;
          }

          /* Charts and canvases: prevent cutting in half */
          .recharts-wrapper,
          .recharts-surface,
          canvas,
          svg {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            max-width: 100% !important;
          }

          /* NMR sidebar controls hidden when printing */
          .no-print {
            display: none !important;
          }
        }

        /* ── Notebook-only print mode ─────────────────────────────────
           Applied by exportPDF() in LabNotebook to print only the
           notebook report, hiding all sidebar and navigation chrome.
           Uses display:none (not visibility:hidden) so Recharts SVGs render correctly. */
        @media print {
          body.notebook-print-mode > * > * {
            display: none !important;
          }
          body.notebook-print-mode #notebook-report-container {
            display: block !important;
            position: static !important;
            width: 100% !important;
            padding: 0 !important;
            background: white !important;
          }
          body.notebook-print-mode #notebook-report-container * {
            display: revert !important;
          }
        }
        /* Screen preview: isolate just the container */
        body.notebook-print-mode > * > *:not(:has(#notebook-report-container)) {
          visibility: hidden;
        }
        body.notebook-print-mode #notebook-report-container {
          position: fixed;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          overflow-y: auto;
          padding: 1cm;
          background: white;
          z-index: 99999;
        }
      `}</style>

      {dialog && (
        <div className="fixed inset-0 bg-slate-900/50 z-[999999] flex items-center justify-center p-4 backdrop-blur-sm">
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-sm overflow-hidden flex flex-col border border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 flex flex-col">
              {dialog.title && (
                <h3 className="text-lg font-bold text-slate-800 mb-2">{dialog.title}</h3>
              )}

              <p className="text-sm text-slate-600 mb-4">{dialog.message}</p>

              {dialog.type === 'prompt' && (
                <input
                  type="text"
                  id="prompt-input"
                  defaultValue={dialog.defaultValue}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      dialog.onConfirm(e.target.value);
                      setDialog(null);
                    }

                    if (e.key === 'Escape') {
                      setDialog(null);
                    }
                  }}
                  className="border border-slate-300 rounded p-2 text-sm focus:border-blue-500 focus:outline-none mb-2"
                />
              )}

              <div className="flex justify-end gap-2 mt-2">
                {(dialog.type === 'confirm' || dialog.type === 'prompt') && (
                  <button
                    onClick={() => setDialog(null)}
                    className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded"
                  >
                    Cancel
                  </button>
                )}

                <button
                  onClick={() => {
                    if (dialog.onConfirm) {
                      if (dialog.type === 'prompt') {
                        dialog.onConfirm(document.getElementById('prompt-input').value);
                      } else {
                        dialog.onConfirm();
                      }
                    }

                    setDialog(null);
                  }}
                  className="px-4 py-2 text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white rounded shadow-sm"
                >
                  {dialog.type === 'alert' ? 'OK' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingLoad && (
        <div className="fixed inset-0 bg-slate-900/50 z-[99999] flex items-center justify-center backdrop-blur-sm">
          <div className="bg-white p-6 rounded-xl shadow-xl border border-slate-200 w-full max-w-sm mx-4">
            <h3 className="text-lg font-black text-slate-800 mb-2">Load Workspace Data</h3>

            <p className="text-sm text-slate-500 mb-6">
              How would you like to load the data from this file?
            </p>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => confirmLoad('append')}
                className="bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-800 font-bold py-2 px-4 rounded-lg text-left transition-colors"
              >
                ➕ Add to Current File
              </button>

              <button
                onClick={() => confirmLoad('replace')}
                className="bg-red-50 hover:bg-red-100 border border-red-200 text-red-800 font-bold py-2 px-4 rounded-lg text-left transition-colors"
              >
                🔄 Substitute Data
              </button>

              <button
                onClick={() => setPendingLoad(null)}
                className="mt-2 text-slate-500 hover:text-slate-700 text-sm font-bold py-2 w-full transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <StorageModals
        storageModal={storageModal}
        setStorageModal={setStorageModal}
        storages={storages}
        setStorages={setStorages}
        moveModal={moveModal}
        setMoveModal={setMoveModal}
        tests={tests}
        setTests={setTests}
        operators={operatorNames}
      />

      {/* ===== EXPLORER VIEW ===== */}
      {appView === 'explorer' && (
        <div className="absolute inset-0 z-[100] flex flex-col items-center p-4 md:p-10 bg-slate-100 overflow-y-auto">
          <div className="w-full max-w-6xl">
            <div className="flex flex-col items-center justify-center py-12 md:py-16 px-6 md:px-8 border border-blue-100 mb-6 md:mb-10 bg-gradient-to-b from-white to-blue-50/50 rounded-2xl shadow-lg mt-4 md:mt-0">
              <h1 className="text-3xl md:text-5xl font-black text-slate-800 tracking-tight mb-4 text-center">
                Lab Workspace
              </h1>

              <p className="text-slate-500 text-base md:text-xl mb-8 text-center max-w-2xl font-medium">
                Create, manage, and analyze your experiments, assays, and inventory in one unified
                environment.
              </p>

              {currentUser?.role === 'superuser' ? (
                <button
                  onClick={createNewDataset}
                  disabled={!isCloudReady}
                  className={`font-black py-3 md:py-4 px-6 md:px-10 rounded-full shadow-lg transition-all transform hover:scale-105 flex items-center gap-3 text-base md:text-lg w-full md:w-auto justify-center ${
                    isCloudReady
                      ? 'bg-blue-600 hover:bg-blue-700 text-white'
                      : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  <span className="text-2xl">+</span> Create New Dataset
                </button>
              ) : (
                <div className="flex items-center gap-2 text-slate-400 bg-slate-100 border border-slate-200 rounded-full px-5 py-3 text-sm font-semibold">
                  ?? Creating datasets requires superuser access
                </div>
              )}

              {!isCloudReady && (
                <div className="mt-6 flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin"></div>
                  <p className="text-sm font-bold text-slate-500">Connecting to Cloud...</p>
                </div>
              )}

              {/* ── USER IDENTITY BAR on landing page ── */}
              {operatorNames.length > 0 && (
                <div className="mt-6 flex items-center gap-3">
                  {currentUser ? (
                    <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-full px-4 py-2 shadow-sm">
                      <span className="text-base">
                        {currentUser.role === 'superuser' ? '👑' : '🧪'}
                      </span>
                      <div className="flex flex-col leading-tight">
                        <span className="text-sm font-bold text-slate-800">{currentUser.name}</span>
                        <span className={`text-[10px] font-black uppercase ${
                          currentUser.role === 'superuser' ? 'text-amber-600' : 'text-slate-500'
                        }`}>
                          {currentUser.role === 'superuser' ? 'Superuser' : 'Scientist'}
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          setCurrentUser(null);
                          try { sessionStorage.removeItem('labCurrentUser'); } catch {}
                        }}
                        className="ml-2 text-xs text-slate-400 hover:text-red-500 font-bold transition-colors px-2 py-1 rounded hover:bg-red-50"
                        title="Log out"
                      >
                        Sign out
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setLoginModal({})}
                      className="flex items-center gap-2 bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 font-bold px-5 py-2.5 rounded-full shadow-sm transition-all hover:shadow-md text-sm"
                    >
                      🔑 Sign In as Scientist
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Recent Datasets — hidden from unauthenticated users when scientists are configured */}
            {operatorNames.length > 0 && !currentUser ? (
              <div className="bg-white p-8 rounded-2xl shadow-xl border border-slate-200 flex flex-col items-center justify-center gap-4 py-16">
                <div className="text-5xl">🔒</div>
                <h2 className="text-xl font-bold text-slate-700">Login required to view datasets</h2>
                <p className="text-slate-400 text-sm text-center max-w-sm">
                  Please log in using the button above to access your lab data.
                </p>
              </div>
            ) : (
            <div className="bg-white p-4 md:p-8 rounded-2xl shadow-xl border border-slate-200">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 border-b border-slate-100 pb-4 gap-4">
                <h2 className="text-xl md:text-2xl font-bold text-slate-800">
                  Your Recent Datasets
                </h2>

                <div className="flex flex-wrap gap-2 w-full md:w-auto">
                  {/* Delete Empty — superuser only */}
                  {currentUser?.role === 'superuser' && (
                    <button
                      onClick={deleteEmptyDatasets}
                      className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold py-2 px-4 rounded-lg shadow-sm transition-colors flex-1 md:flex-none items-center justify-center gap-2 cursor-pointer text-sm"
                    >
                      🗑️ Delete Empty
                    </button>
                  )}

                  {/* Load HTML — superuser only */}
                  {currentUser?.role === 'superuser' && (
                    <label className="bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 font-bold py-2 px-4 rounded-lg shadow-sm transition-colors flex-1 md:flex-none flex items-center justify-center gap-2 cursor-pointer text-sm">
                      📂 Load HTML File
                      <input type="file" accept=".html" onChange={loadHTML} className="hidden" />
                    </label>
                  )}
                </div>
              </div>

              {isCloudReady && Object.keys(groupedDatasets).length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-md flex flex-col items-center gap-3">
                  <span className="text-4xl opacity-30">📂</span>
                  <span>No datasets found in cloud or local storage.</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                  {Object.values(groupedDatasets).map((group) => {
                    const titleParts = [];

                    if (group.categories) titleParts.push(group.categories);
                    if (group.cellLines) titleParts.push(group.cellLines);

                    const groupTitle = group.isUnclassified
                      ? group.items[0].title || 'Untitled'
                      : titleParts.join(' - ');

                    const isExpanded = expandedGroups[group.key];

                    return (
                      <div
                        key={group.key}
                        className="border border-slate-200 rounded-xl p-4 md:p-5 hover:shadow-lg hover:border-blue-300 transition-all bg-white flex flex-col h-full"
                      >
                        <h3
                          className="font-bold text-lg text-slate-800 mb-2 leading-tight truncate"
                          title={groupTitle}
                        >
                          {groupTitle}
                        </h3>

                        <p className="text-xs text-slate-500 mb-4 font-medium bg-slate-100 inline-block px-2 py-1 rounded-md self-start">
                          {group.items.length} Dataset{group.items.length === 1 ? '' : 's'}
                        </p>

                        <div className="flex flex-col gap-2 flex-1">
                          {group.items
                            .slice(0, isExpanded ? undefined : 3)
                            .map((dset) => (
                              <div
                                key={dset.id}
                                onClick={() => openDataset(dset)}
                                className="bg-white border border-slate-200 hover:border-blue-400 hover:shadow-md p-3 rounded-lg cursor-pointer flex justify-between items-center transition-all group/item"
                              >
                                <div className="flex flex-col overflow-hidden">
                                  <span className="font-bold text-sm text-blue-700 truncate">
                                    {dset.title || groupTitle}
                                  </span>

                                  <span className="text-[11px] text-slate-500 mt-1 flex gap-2">
                                    <span>📅 {dset.date || 'No Date'}</span>
                                    <span>🧪 {dset.testCount || 1} Tests</span>
                                  </span>
                                </div>

                                {/* Rename / Delete — superuser only */}
                                {currentUser?.role === 'superuser' && (
                                  <div className="flex flex-col gap-1 opacity-100 md:opacity-0 group-hover/item:opacity-100 transition-all shrink-0 ml-2">
                                    <button
                                      onClick={(e) =>
                                        renameDataset(e, dset.id, dset.title || groupTitle)
                                      }
                                      className="text-slate-500 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded text-xs font-bold transition-colors text-right"
                                    >
                                      Rename
                                    </button>

                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        deleteDataset(e, dset.id);
                                      }}
                                      className="text-slate-500 hover:text-red-600 hover:bg-red-50 px-2 py-1 rounded text-xs font-bold transition-colors text-right"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                )}
                              </div>
                            ))}

                          {group.items.length > 3 && (
                            <button
                              onClick={() => toggleGroup(group.key)}
                              className="text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 font-bold py-2 rounded-lg mt-2 text-center transition-colors w-full"
                            >
                              {isExpanded
                                ? 'Hide Datasets'
                                : `Show ${group.items.length - 3} more...`}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            )} {/* end: login-required ternary */}
          </div>
        </div>
      )}

      {/* ===== DATASET VIEW ===== */}
      {appView === 'dataset' && (
        <div className="flex flex-col md:flex-row h-screen w-full overflow-hidden">
          {/* MOBILE TOP BAR */}
          <div className="md:hidden bg-white border-b border-slate-200 p-3 flex justify-between items-center z-10 shrink-0">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="text-2xl text-slate-600 px-2 py-1"
            >
              ☰
            </button>

            <span className="font-bold text-slate-800 truncate px-4">
              {datasetTitle || 'Lab Workspace'}
            </span>

            <div className="w-8"></div>
          </div>

          {isSidebarOpen && (
            <div
              className="md:hidden fixed inset-0 bg-slate-900/50 z-40"
              onClick={() => setIsSidebarOpen(false)}
            ></div>
          )}

          {/* COLLAPSIBLE SIDEBAR — now in ./components/AppModules/appSidebar */}
          <AppSidebar
            isSidebarOpen={isSidebarOpen} setIsSidebarOpen={setIsSidebarOpen}
            handleBackToExplorer={handleBackToExplorer}
            datasetTitle={datasetTitle} setDatasetTitle={setDatasetTitle}
            datasetSubtitle={datasetSubtitle} setDatasetSubtitle={setDatasetSubtitle}
            saveStatus={saveStatus} saveErrorMsg={saveErrorMsg}
            currentUser={currentUser} setCurrentUser={setCurrentUser}
            setUnlockedTestIds={setUnlockedTestIds} setLoginModal={setLoginModal}
            currentModule={currentModule} setCurrentModule={setCurrentModule}
            handlePrint={handlePrint} loadHTML={loadHTML} exportHTML={exportHTML}
            handleUndo={handleUndo} handleRedo={handleRedo}
            historyIndex={historyIndex} historyRef={historyRef}
          />

          {/* MAIN CONTENT */}
          <div className="flex-1 flex flex-col bg-slate-50 h-full overflow-hidden relative">
            {currentModule === 'dashboard' && (<DashboardModule
              datasetTitle={datasetTitle} datasetSubtitle={datasetSubtitle}
              handlePrint={handlePrint} tests={tests} storages={storages}
              setCurrentModule={setCurrentModule} mergedPlan={mergedPlan}
            />)}

            {currentModule === 'definitions' && (<DefinitionsModule
              allCmpds={allCmpds} setActiveLibrarySelection={setActiveLibrarySelection} activeLibrarySelection={activeLibrarySelection}
              compoundMeta={compoundMeta} setCompoundMeta={setCompoundMeta}
              cellLineMeta={cellLineMeta} setCellLineMeta={setCellLineMeta}
              plasmidMeta={plasmidMeta} setPlasmidMeta={setPlasmidMeta}
              customCmpds={customCmpds} setCustomCmpds={setCustomCmpds}
              customCellLines={customCellLines} setCustomCellLines={setCustomCellLines}
              solvents={solvents} setSolvents={setSolvents} buffers={buffers} setBuffers={setBuffers}
              additives={additives} setAdditives={setAdditives}
              nmrProbes={nmrProbes} setNmrProbes={setNmrProbes}
              nmrInstruments={nmrInstruments} setNmrInstruments={setNmrInstruments}
              nmrExperiments={nmrExperiments} setNmrExperiments={setNmrExperiments}
              customFields={customFields} setCustomFields={setCustomFields}
              mandatoryRules={mandatoryRules} setMandatoryRules={setMandatoryRules}
              mandatoryBehavior={mandatoryBehavior} setMandatoryBehavior={setMandatoryBehavior}
              operators={operators} setOperators={setOperators}
              authSettings={authSettings} setAuthSettings={setAuthSettings}
            />)}

            {currentModule === 'agenda' && (<AgendaModule
              currentUser={currentUser} agendaOpFilter={agendaOpFilter} setAgendaOpFilter={setAgendaOpFilter}
              operatorNames={operatorNames} mergedPlan={mergedPlan}
              calFilterDate={calFilterDate} setCalFilterDate={setCalFilterDate}
              agendaGrouped={agendaGrouped} jumpToTest={jumpToTest}
            />)}

            <StorageModule
              currentModule={currentModule} tests={tests} setTests={setTests} storages={storages}
              operatorNames={operatorNames} setActiveTestId={setActiveTestId} setCurrentModule={setCurrentModule}
              setActiveStorageId={setActiveStorageId} setStorageModal={setStorageModal}
              handlePrint={handlePrint} activeStorageId={activeStorageId}
              jumpToTest={jumpToTest} setMoveModal={setMoveModal} createEmptyTest={createEmptyTest}
            />

            {currentModule === 'tests' &&
              (() => {
                const testSearch = expandedGroups['testSearch'] || '';
                const testCatFilter = expandedGroups['testCatFilter'] || 'ALL';
                const showCatMgr = expandedGroups['showTestCatMgr'] || false;
                const newCatInput = expandedGroups['newTestCatInput'] || '';


                // ── Auth helpers ──────────────────────────────
                const isSuperuserSession = currentUser?.role === 'superuser';
                // Get all scientists assigned to a test
                const getTestScientists = (test) => {
                  const all = [];
                  if (test.operator) all.push(test.operator);
                  if (Array.isArray(test.coScientists)) all.push(...test.coScientists);
                  return all;
                };
                const isTestOwner = (test) => {
                  const scientists = getTestScientists(test);
                  if (isSuperuserSession) return true;
                  if (scientists.length === 0) return false; // unassigned → only superuser
                  return currentUser && scientists.includes(currentUser.name);
                };
                const isTestLocked = (test) => !isTestOwner(test) && !unlockedTestIds.has(test.id);
                // ─────────────────────────────────────────────

                const filteredTestsRaw = tests.filter((t) => {
                  if (t.type === 'plate-9x9box') return false;

                  // Normal users always see only their own tests.
                  // Superusers see all tests unless hideOtherScientistTests is enabled.
                  if (!isSuperuserSession) {
                    if (!isTestOwner(t)) return false;
                  } else if (authSettings.hideOtherScientistTests && !isTestOwner(t)) {
                    return false;
                  }

                  const matchesSearch =
                    t.name.toLowerCase().includes(testSearch.toLowerCase()) ||
                    (t.instanceName || '').toLowerCase().includes(testSearch.toLowerCase());

                  const matchesCat =
                    testCatFilter === 'ALL' || t.testCategory === testCatFilter;

                  return matchesSearch && matchesCat;
                });

                const filteredTests = [];
                const seenTestNames = new Set();

                filteredTestsRaw.forEach((t) => {
                  if (!seenTestNames.has(t.name)) {
                    seenTestNames.add(t.name);
                    filteredTests.push(t);
                  }
                });


                return (
                  <div className="p-4 md:p-6 h-full flex flex-col">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4 border-b border-slate-200 pb-4">
                      <div>
                        <h2 className="text-xl md:text-2xl font-black text-slate-800">
                          Tests & Assays
                        </h2>

                        <p className="text-sm text-slate-500">
                          Manage experimental plates, spectroscopic data, cloning, protein purification, and MD simulations.
                        </p>
                      </div>

<div className="flex flex-wrap gap-2 no-print w-full md:w-auto">
  <button
    onClick={handlePrint}
    className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 shadow-sm flex-1 md:flex-none"
  >
    🖨️ PDF
  </button>

  <button
    onClick={() => {
      const id = 't' + Date.now();
      setTests((prev) => [
        ...prev,
        createEmptyTest(id, prev.length + 1, 'cloning')
      ]);
      setActiveTestId(id);
      setCurrentModule('active-test');
    }}
    className="bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 px-4 rounded shadow-sm text-sm transition-colors flex-1 md:flex-none"
  >
    + Cloning
  </button>

  <button
    onClick={() => {
      const id = 't' + Date.now();
      setTests((prev) => [
        ...prev,
        createEmptyTest(id, prev.length + 1, 'protein_expression')
      ]);
      setActiveTestId(id);
      setCurrentModule('active-test');
    }}
    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded shadow-sm text-sm transition-colors flex-1 md:flex-none"
  >
    + Expression & Purification
  </button>

  <button
    onClick={() => {
      const id = 't' + Date.now();
      setTests((prev) => [
        ...prev,
        createEmptyTest(id, prev.length + 1, 'plate-96')
      ]);
      setActiveTestId(id);
      setCurrentModule('active-test');
    }}
    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded shadow-sm text-sm transition-colors flex-1 md:flex-none"
  >
    + Multiwell Plate tests
  </button>
  <button
onClick={() => {
const id = 't' + Date.now();
setTests((prev) => [
...prev,
createEmptyTest(id, prev.length + 1, 'flow_cytometry')
]);
setActiveTestId(id);
setCurrentModule('active-test');
}}
className="bg-pink-600 hover:bg-pink-700 text-white font-bold py-2 px-4 rounded shadow-sm text-sm transition-colors flex-1 md:flex-none"
>
+ Flow Cytometry
</button>

<button
onClick={() => {
const id = 't' + Date.now();
setTests((prev) => [
...prev,
createEmptyTest(id, prev.length + 1, 'cd')
]);
setActiveTestId(id);
setCurrentModule('active-test');
}}
className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded shadow-sm text-sm transition-colors flex-1 md:flex-none"
>
+ CD
</button>
<button
onClick={() => {
const id = 't' + Date.now();
setTests((prev) => [
...prev,
createEmptyTest(id, prev.length + 1, 'ssnmr')
]);
setActiveTestId(id);
setCurrentModule('active-test');
}}
className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded shadow-sm text-sm transition-colors flex-1 md:flex-none"
>
+ ssNMR
</button>
<button
onClick={() => {
const id = 't' + Date.now();
setTests((prev) => [
...prev,
createEmptyTest(id, prev.length + 1, 'nmr')
]);
setActiveTestId(id);
setCurrentModule('active-test');
}}
className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-4 rounded shadow-sm text-sm transition-colors flex-1 md:flex-none"
>
+ NMR
</button>

  <button
    onClick={() => {
      const id = 't' + Date.now();
      setTests((prev) => [
        ...prev,
        createEmptyTest(id, prev.length + 1, 'nmr-fittings')
      ]);
      setActiveTestId(id);
      setCurrentModule('active-test');
    }}
    className="bg-amber-600 hover:bg-amber-700 text-white font-bold py-2 px-4 rounded shadow-sm text-sm transition-colors flex-1 md:flex-none"
  >
    + NMR Fittings
  </button>

  <button
    onClick={() => {
      const id = 't' + Date.now();
      setTests((prev) => [
        ...prev,
        createEmptyTest(id, prev.length + 1, 'md_simulation')
      ]);
      setActiveTestId(id);
      setCurrentModule('active-test');
    }}
    className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded shadow-sm text-sm transition-colors flex-1 md:flex-none"
  >
    + MD Simulations
  </button>
  <button
    onClick={() => {
      const id = 't' + Date.now();
      setTests((prev) => [
        ...prev,
        createEmptyTest(id, prev.length + 1, 'docking')
      ]);
      setActiveTestId(id);
      setCurrentModule('active-test');
    }}
    className="bg-rose-600 hover:bg-rose-700 text-white font-bold py-2 px-4 rounded shadow-sm text-sm transition-colors flex-1 md:flex-none"
  >
    + Docking
  </button>
</div>
                    </div>

                    <div className="bg-white p-3 md:p-4 rounded-xl shadow-sm border border-slate-200 mb-6 flex flex-col gap-4 shrink-0 no-print">
                      <div className="flex flex-col md:flex-row gap-3 md:gap-4 items-center">
                        <div className="flex-1 w-full relative">
                          <span className="absolute left-3 top-2.5 text-slate-400">🔍</span>

                          <input
                            type="text"
                            placeholder="Search tests by name..."
                            value={testSearch}
                            onChange={(e) =>
                              setExpandedGroups((p) => ({ ...p, testSearch: e.target.value }))
                            }
                            className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                          />
                        </div>

                        <div className="w-full md:w-64 flex gap-2">
                          <select
                            value={testCatFilter}
                            onChange={(e) =>
                              setExpandedGroups((p) => ({ ...p, testCatFilter: e.target.value }))
                            }
                            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-500 font-semibold text-slate-700 cursor-pointer"
                          >
                            <option value="ALL">All Categories</option>

                            {testCategories.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>

                          <button
                            onClick={() =>
                              setExpandedGroups((p) => ({
                                ...p,
                                showTestCatMgr: !showCatMgr
                              }))
                            }
                            className={`px-3 py-2 border rounded-lg text-sm font-bold transition-colors shadow-sm ${
                              showCatMgr
                                ? 'bg-blue-50 border-blue-300 text-blue-700'
                                : 'bg-slate-50 border-slate-300 text-slate-600 hover:bg-slate-100'
                            }`}
                            title="Manage Categories"
                          >
                            ⚙️
                          </button>
                        </div>
                      </div>

                      {showCatMgr && (
                        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 flex flex-col gap-3">
                          <h4 className="text-xs font-bold text-slate-500 uppercase">
                            Manage Test Categories
                          </h4>

                          <div className="flex flex-col md:flex-row gap-2">
                            <input
                              type="text"
                              placeholder="New category name..."
                              value={newCatInput}
                              onChange={(e) =>
                                setExpandedGroups((p) => ({
                                  ...p,
                                  newTestCatInput: e.target.value
                                }))
                              }
                              className="flex-1 border border-slate-300 rounded px-3 py-2 text-sm outline-none focus:border-blue-500"
                            />

                            <button
                              onClick={() => {
                                const v = newCatInput.trim();

                                if (v && !testCategories.includes(v)) {
                                  setTestCategories([...testCategories, v]);

                                  setExpandedGroups((p) => ({
                                    ...p,
                                    newTestCatInput: ''
                                  }));
                                }
                              }}
                              className="bg-blue-600 text-white font-bold px-4 py-2 rounded text-sm shadow-sm hover:bg-blue-700 transition-colors"
                            >
                              Add Category
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                      {filteredTests.length === 0 ? (
                        <div className="text-center py-10 text-slate-400 italic">
                          No tests match your filters.
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                          {filteredTests.map((test) => {
                            const locked = isTestLocked(test);
                            return (
                            <div
                              key={test.id}
                              className={`bg-white border rounded-xl p-4 shadow-sm transition-all flex flex-col group relative overflow-hidden ${
                                locked
                                  ? 'border-slate-300 cursor-pointer hover:border-amber-400 hover:shadow-md'
                                  : 'border-slate-200 cursor-pointer hover:shadow-md hover:border-blue-400'
                              }`}
                              onClick={() => {
                                if (locked) {
                                  // prompt authentication for this scientist
                                  setLoginModal({
                                    isEntryGate: false,
                                    targetScientistName: test.operator,
                                    onSuccess: (user) => {
                                      setCurrentUser(user);
                                      setLoginModal(null);
                                      // Navigate into the test after login
                                      setActiveTestId(test.id);
                                      setCurrentModule('active-test');
                                    }
                                  });
                                } else {
                                  setActiveTestId(test.id);
                                  setCurrentModule('active-test');
                                }
                              }}
                            >
                              {/* Delete button (only if owner/superuser) */}
                              {!locked && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (window.confirm(`Eliminare definitivamente il test "${test.name}"?`)) {
                                      setTests((prev) => prev.filter((t) => t.id !== test.id));
                                    }
                                  }}
                                  className="absolute top-3 right-10 text-slate-300 hover:text-red-500 text-xl opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity no-print z-10"
                                  title="Elimina Test"
                                >
                                  &times;
                                </button>
                              )}

<div className="absolute top-3 right-3 text-2xl opacity-80 group-hover:scale-110 transition-transform">
{test.type === 'nmr' ? '📉'
: test.type === 'cd' ? '🌀'
: test.type === 'ssnmr' ? '🧲'
: test.type === 'cloning' ? '🧬'
: test.type === 'plate-9x9box' ? '📦'
: test.type === 'nmr-fittings' ? '🧭'
: test.type === 'md_simulation' ? '🖥️'
: test.type === 'docking' ? '🎯'
: test.type === 'flow_cytometry' ? '🩸'
: '🧫'}
</div>

                              <span className="text-[10px] font-black uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-0.5 rounded self-start mb-2 border border-blue-100">
                                {test.testCategory || 'Uncategorized'}
                              </span>

                              <h3 className="font-bold text-slate-800 text-lg truncate pr-8">
                                {test.name} {test.bestMeasurement && '⭐'}
                              </h3>

                              <p className="text-xs text-slate-500 mt-1">
                                Instance: {test.instanceName || 'Primary'}
                              </p>

                              {test.operator && (
                                <p className="text-xs text-slate-400 mt-0.5">
                                  🧪 {[test.operator, ...(test.coScientists || [])].join(', ')}
                                </p>
                              )}

                              <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center text-xs text-slate-500 font-medium">
                                <span>📅 {test.date}</span>
<span className="bg-slate-100 px-2 py-0.5 rounded font-bold text-slate-600">
{test.type === 'nmr-fittings' ? 'NMR FITTINGS'
: test.type === 'md_simulation' ? 'MD'
: test.type === 'protein_expression' ? 'PROTEIN'
: test.type === 'ssnmr' ? 'SSNMR'
: test.type === 'docking' ? 'DOCKING'
: test.type === 'flow_cytometry' ? 'FLOW'
: String(test.type || '').replace('plate-', '').toUpperCase()}
</span>
                              </div>

                              {/* 🔒 Lock overlay */}
                              {locked && (
                                <div className="absolute inset-0 bg-white/80 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2 rounded-xl">
                                  <div className="text-3xl">🔒</div>
                                  <div className="text-xs font-bold text-slate-600 text-center px-4">
                                    {[test.operator, ...(test.coScientists || [])].filter(Boolean).join(' / ')}'s test
                                  </div>
                                  <div className="text-[10px] text-slate-400 text-center px-4">
                                    Log in as one of the assigned scientists to access
                                  </div>
                                </div>
                              )}
                            </div>
                            );
                          })}

                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

            {currentModule === 'protocols' &&
              (() => {
                const protoSearch = expandedGroups['protoSearch'] || '';
                const protoCatFilter = expandedGroups['protoCatFilter'] || 'ALL';
                const showProtoCatMgr = expandedGroups['showProtoCatMgr'] || false;
                const newProtoCatInput = expandedGroups['newProtoCatInput'] || '';
                const activeProtoId = expandedGroups['activeProtoId'] || null;

                const filteredProtocols = datasetProtocols.filter((p) => {
                  const matchesSearch = p.title
                    .toLowerCase()
                    .includes(protoSearch.toLowerCase());

                  const matchesCat =
                    protoCatFilter === 'ALL' || p.category === protoCatFilter;

                  return matchesSearch && matchesCat;
                });

const activeProtocol = activeProtoId
  ? datasetProtocols.find((p) => p.id === activeProtoId)
  : null;

const extractGoogleDriveId = (url) => {
  try {
    const u = String(url || '');

    const fileMatch = u.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (fileMatch) return fileMatch[1];

    const idMatch = u.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (idMatch) return idMatch[1];

    const openMatch = u.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (openMatch) return openMatch[1];
  } catch (e) {}

  return '';
};

const getProtocolImagePreview = (url) => {
  if (!url) return '';

  const u = String(url);

  if (u.includes('drive.google.com')) {
    const id = extractGoogleDriveId(u);

    if (id) {
      return `https://drive.google.com/thumbnail?id=${id}&sz=w1600`;
    }
  }

  return getDirectImageUrl(u);
};

const getProtocolImageFallback = (url) => {
  const direct = getProtocolImagePreview(url);

  if (!direct) return '';

  if (String(direct).includes('drive.google.com')) {
    return `https://wsrv.nl/?url=${encodeURIComponent(direct)}`;
  }

  return direct;
};

                if (activeProtocol) {
                  return (
                    <div className="p-4 md:p-6 h-full flex flex-col bg-white">
                      <div className="flex flex-col md:flex-row items-start md:items-center gap-3 mb-6 border-b border-slate-100 pb-4 shrink-0">
                        <button
                          onClick={() =>
                            setExpandedGroups((p) => ({ ...p, activeProtoId: null }))
                          }
                          className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 p-2 rounded-lg transition-colors shadow-sm no-print self-start"
                        >
                          ◀ Back
                        </button>

                        <div className="flex-1 w-full">
                          <input
                            type="text"
                            value={activeProtocol.title}
                            onChange={(e) =>
                              setDatasetProtocols(
                                datasetProtocols.map((p) =>
                                  p.id === activeProtocol.id
                                    ? { ...p, title: e.target.value }
                                    : p
                                )
                              )
                            }
                            className="text-xl md:text-2xl font-black text-slate-800 bg-transparent border-none outline-none w-full focus:ring-1 focus:ring-blue-500 rounded px-1"
                            placeholder="Protocol Title"
                          />
                        </div>

                        <select
                          value={activeProtocol.category}
                          onChange={(e) =>
                            setDatasetProtocols(
                              datasetProtocols.map((p) =>
                                p.id === activeProtocol.id
                                  ? { ...p, category: e.target.value }
                                  : p
                              )
                            )
                          }
                          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-slate-50 font-semibold text-slate-700 outline-none cursor-pointer w-full md:w-auto no-print"
                        >
                          {protocolCategories.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex-1 flex flex-col lg:flex-row gap-6 overflow-y-auto lg:overflow-hidden">
<div className="flex-1 flex flex-col h-auto lg:h-full min-h-[300px]">
  <label className="text-xs font-bold text-slate-500 uppercase mb-2">
    Protocol Description & Steps
  </label>

  <RichTextEditor
    value={activeProtocol.content || ''}
    onChange={(val) =>
      setDatasetProtocols(
        datasetProtocols.map((p) =>
          p.id === activeProtocol.id ? { ...p, content: val } : p
        )
      )
    }
    placeholder="Write the detailed protocol steps here. You can paste images directly..."
  />

  <div className="mt-6 border border-slate-200 rounded-xl bg-slate-50 p-4 shadow-sm">
    <div className="flex flex-col gap-3 mb-3">
      <div>
        <h4 className="text-xs font-bold text-slate-500 uppercase">
          Protocol Images
        </h4>
        <p className="text-xs text-slate-400">
          Paste Google Drive image links. Previews appear immediately.
        </p>
      </div>

      {/* Inline URL input — no prompt() required */}
      <div className="flex gap-2 items-center no-print">
        <input
          type="text"
          value={protoImgInput}
          onChange={(e) => setProtoImgInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const urls = protoImgInput.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
              if (!urls.length) return;
              const existingCount = (activeProtocol.images || []).length;
              const newImgs = urls.map((url, idx) => ({ id: `proto_img_${Date.now()}_${idx}`, name: `Image ${existingCount + idx + 1}`, url }));
              setDatasetProtocols(datasetProtocols.map(p => p.id === activeProtocol.id ? { ...p, images: [...(p.images || []), ...newImgs] } : p));
              setProtoImgInput('');
            }
          }}
          placeholder="Paste Google Drive URL(s), comma-separated… then press Enter or Add"
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500 bg-white"
        />
        <button
          type="button"
          onClick={() => {
            const urls = protoImgInput.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
            if (!urls.length) return;
            const existingCount = (activeProtocol.images || []).length;
            const newImgs = urls.map((url, idx) => ({ id: `proto_img_${Date.now()}_${idx}`, name: `Image ${existingCount + idx + 1}`, url }));
            setDatasetProtocols(datasetProtocols.map(p => p.id === activeProtocol.id ? { ...p, images: [...(p.images || []), ...newImgs] } : p));
            setProtoImgInput('');
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-xs shadow-sm transition-colors whitespace-nowrap"
        >
          + Add
        </button>
      </div>
    </div>

    {(activeProtocol.images || []).length === 0 ? (
      <div className="text-sm text-slate-400 italic bg-white border border-dashed border-slate-300 rounded-lg p-4">
        No images added yet. Use “+ Add Image Link(s)” and paste Google Drive
        image URLs.
      </div>
    ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {(activeProtocol.images || []).map((img) => (
          <div
            key={img.id}
            className="bg-white border border-slate-200 rounded-lg p-2 shadow-sm flex flex-col gap-2"
          >
            <div className="h-28 rounded-md overflow-hidden border border-slate-100 bg-slate-100">
              <img
                src={getProtocolImagePreview(img.url)}
                alt={img.name || 'Protocol image'}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
                onError={(e) => {
                  if (!e.currentTarget.dataset.fallback) {
                    e.currentTarget.dataset.fallback = '1';
                    e.currentTarget.src = getProtocolImageFallback(img.url);
                  }
                }}
              />
            </div>

            <input
              type="text"
              value={img.name || ''}
              onChange={(e) =>
                setDatasetProtocols(
                  datasetProtocols.map((p) =>
                    p.id === activeProtocol.id
                      ? {
                          ...p,
                          images: (p.images || []).map((im) =>
                            im.id === img.id
                              ? { ...im, name: e.target.value }
                              : im
                          )
                        }
                      : p
                  )
                )
              }
              className="border border-slate-200 rounded-md px-2 py-1 text-xs font-bold text-slate-700 outline-none focus:border-blue-500"
              placeholder="Image name"
            />

            <div className="flex gap-2">
              <a
                href={img.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 text-center bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 font-bold py-1 px-2 rounded text-xs transition-colors"
              >
                Open
              </a>

              <button
                type="button"
                onClick={() =>
                  setDatasetProtocols(
                    datasetProtocols.map((p) =>
                      p.id === activeProtocol.id
                        ? {
                            ...p,
                            images: (p.images || []).filter(
                              (im) => im.id !== img.id
                            )
                          }
                        : p
                    )
                  )
                }
                className="flex-1 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold py-1 px-2 rounded text-xs transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>

  <div className="mt-6 border-t border-slate-100 pt-4 no-print shrink-0">
    <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">
      🧪 Tests Using This Protocol
    </h4>
    <div className="flex flex-wrap gap-2">
      {
        tests.filter(
          (t) =>
            t.linkedProtocolId === activeProtocol.id ||
            (Array.isArray(t.linkedProtocolIds) &&
              t.linkedProtocolIds.includes(activeProtocol.id))
        ).length === 0 && (
          <span className="text-sm text-slate-400 italic">
            No tests are currently linked to this protocol.
          </span>
        )
      }
      {tests
        .filter(
          (t) =>
            t.linkedProtocolId === activeProtocol.id ||
            (Array.isArray(t.linkedProtocolIds) &&
              t.linkedProtocolIds.includes(activeProtocol.id))
        )
        .map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setActiveTestId(t.id);
              setCurrentModule('active-test');
            }}
            className="text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 px-3 py-1.5 rounded-lg shadow-sm transition-colors flex items-center gap-1"
          >
            {t.type === 'nmr' ? '📉' : t.type === 'cd' ? '🌀' : '🧫'}{' '}
            {t.name} {t.instanceName ? `(${t.instanceName})` : ''}
          </button>
        ))}
    </div>
  </div>
</div>
{(() => {
  const pulsePrograms = (Array.isArray(nmrExperiments) ? nmrExperiments : [])
    .map((exp) => (typeof exp === 'string' ? { name: exp } : exp))
    .filter((exp) => exp && exp.name)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const linkedPulseName = activeProtocol.linkedPulseProgramName || '';
  const linkedPulse = pulsePrograms.find((exp) => exp.name === linkedPulseName) || null;

  const normalizeProtocolPulseLinkUrl = (url) => {
    const raw = String(url || '').trim();
    if (!raw) return '#';
    if (/^(https?:|mailto:|file:)/i.test(raw)) return raw;
    if (raw.startsWith('//')) return `https:${raw}`;
    return `https://${raw}`;
  };

  const openLinkedPulseInDefinitions = () => {
    if (!linkedPulseName) return;

    setActiveLibrarySelection({ type: 'nmrExperiment', id: linkedPulseName });
    setCurrentModule('definitions');

    setTimeout(() => {
      const el = document.getElementById('section-nmrExperiment');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 180);
  };

  return (
    <div className="w-full lg:w-80 flex flex-col gap-4 lg:overflow-y-auto custom-scrollbar shrink-0 lg:border-l border-t lg:border-t-0 border-slate-100 pt-4 lg:pt-0 lg:pl-4 no-print">
      <label className="text-xs font-bold text-slate-500 uppercase">
        Attached Resources
      </label>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex flex-col gap-2">
        <label className="text-[10px] font-bold text-blue-700 uppercase">
          Pulse Sequence Link (Definitions & Labels)
        </label>

        <select
          value={linkedPulseName}
          onChange={(e) => {
            const value = e.target.value;

            setDatasetProtocols(
              datasetProtocols.map((p) =>
                p.id === activeProtocol.id
                  ? { ...p, linkedPulseProgramName: value }
                  : p
              )
            );

            setExpandedGroups((prev) => ({
              ...prev,
              protoPulseViewerOpen: false
            }));
          }}
          className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 font-semibold text-slate-700"
        >
          <option value="">— No pulse program linked —</option>
          {pulsePrograms.map((exp) => (
            <option key={exp.name} value={exp.name}>
              {exp.name}
            </option>
          ))}
        </select>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={openLinkedPulseInDefinitions}
            disabled={!linkedPulseName}
            className="bg-white border border-blue-300 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed text-blue-700 font-bold py-1.5 px-3 rounded-lg text-xs shadow-sm transition-colors"
          >
            Open in Definitions
          </button>

          <button
            type="button"
            onClick={() =>
              setExpandedGroups((prev) => ({
                ...prev,
                protoPulseViewerOpen: true
              }))
            }
            disabled={!linkedPulse || !String(linkedPulse.pulseSequence || '').trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-1.5 px-3 rounded-lg text-xs shadow-sm transition-colors"
          >
            Preview Graphical
          </button>

          {linkedPulse && String(linkedPulse.pulseSequenceLink || '').trim() && (
            <a
              href={normalizeProtocolPulseLinkUrl(linkedPulse.pulseSequenceLink)}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white border border-blue-300 hover:bg-blue-100 text-blue-700 font-bold py-1.5 px-3 rounded-lg text-xs shadow-sm transition-colors"
            >
              Open Drive
            </a>
          )}
        </div>

        {!linkedPulse && (
          <p className="text-[11px] text-blue-700/80">
            Choose a pulse program defined under Definitions & Labels → NMR
            Experiments / Pulse Programs.
          </p>
        )}

        {linkedPulse && !String(linkedPulse.pulseSequence || '').trim() && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
            This pulse program is linked, but it does not contain pulse-sequence
            text yet. Open it in Definitions & Labels and paste the Bruker
            pulse-program text.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {(activeProtocol.links || []).length === 0 && (
          <span className="text-sm text-slate-400 italic">
            No external links or documents attached.
          </span>
        )}

        {(activeProtocol.links || []).map((link) => (
          <div
            key={link.id}
            className="bg-slate-50 border border-slate-200 p-2.5 rounded-lg flex items-center justify-between group shadow-sm"
          >
            <div
              className="flex items-center gap-2 overflow-hidden cursor-pointer flex-1"
              onClick={() => {
                const newName = prompt('Rename link:', link.name);
                if (newName) {
                  setDatasetProtocols(
                    datasetProtocols.map((p) =>
                      p.id === activeProtocol.id
                        ? {
                            ...p,
                            links: p.links.map((l) =>
                              l.id === link.id ? { ...l, name: newName } : l
                            )
                          }
                        : p
                    )
                  );
                }
              }}
            >
              <span className="text-lg">
                {link.url.match(/\.(jpeg|jpg|gif|png|svg)$/i) ? '🖼️' : '🔗'}
              </span>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-bold text-slate-700 truncate group-hover:text-blue-600"
                onClick={(e) => e.stopPropagation()}
              >
                {link.name}
              </a>
            </div>

            <button
              onClick={() =>
                setDatasetProtocols(
                  datasetProtocols.map((p) =>
                    p.id === activeProtocol.id
                      ? {
                          ...p,
                          links: p.links.filter((l) => l.id !== link.id)
                        }
                      : p
                  )
                )
              }
              className="text-slate-400 hover:text-red-500 font-bold px-2 py-1 transition-opacity"
            >
              &times;
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <button
          onClick={() => {
            const urlsText = prompt(
              'Paste external link(s) separated by commas (Drive, PDF, Image URL):'
            );

            if (urlsText && urlsText.trim()) {
              const urls = urlsText
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);

              const newLinks = urls.map((url, idx) => ({
                id: Date.now().toString() + idx + Math.random(),
                name: 'Linked Resource',
                url
              }));

              setDatasetProtocols(
                datasetProtocols.map((p) =>
                  p.id === activeProtocol.id
                    ? { ...p, links: [...(p.links || []), ...newLinks] }
                    : p
                )
              );
            }
          }}
          className="border-2 border-dashed border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 font-bold rounded-lg p-3 text-center transition-colors shadow-sm text-sm"
        >
          + Add External Link(s)
        </button>

        <label className="border-2 border-dashed border-emerald-200 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 font-bold rounded-lg p-3 text-center transition-colors shadow-sm text-sm cursor-pointer block">
          + Attach Multiple Files
          <input
            type="file"
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files);
              if (!files.length) return;

              const newLinksPromises = files.map(
                (file) =>
                  new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (ev) =>
                      resolve({
                        id: Date.now().toString() + Math.random(),
                        name: file.name,
                        url: ev.target.result
                      });
                    reader.readAsDataURL(file);
                  })
              );

              Promise.all(newLinksPromises).then((newLinks) => {
                setDatasetProtocols(
                  datasetProtocols.map((p) =>
                    p.id === activeProtocol.id
                      ? { ...p, links: [...(p.links || []), ...newLinks] }
                      : p
                  )
                );
              });

              e.target.value = '';
            }}
            className="hidden"
          />
        </label>
      </div>

      {expandedGroups['protoPulseViewerOpen'] &&
        linkedPulse &&
        String(linkedPulse.pulseSequence || '').trim() && (
          <BrukerPulseSequenceViewer
            open={true}
            onClose={() =>
              setExpandedGroups((prev) => ({
                ...prev,
                protoPulseViewerOpen: false
              }))
            }
            name={linkedPulse.name}
            pulseSequence={linkedPulse.pulseSequence || ''}
            pulseSequenceLink={linkedPulse.pulseSequenceLink || ''}
          />
        )}
    </div>
  );
})()}
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="p-4 md:p-6 h-full flex flex-col">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4 border-b border-slate-200 pb-4">
                      <div>
                        <h2 className="text-xl md:text-2xl font-black text-slate-800">
                          Protocols Library
                        </h2>

                        <p className="text-sm text-slate-500">
                          Draft, store, and link your experimental procedures.
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2 no-print w-full md:w-auto">
                        <button
                          onClick={handlePrint}
                          className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 shadow-sm flex-1 md:flex-none"
                        >
                          🖨️ PDF
                        </button>

                        <button
                          onClick={() => {
const newProto = {
  id: 'pr' + Date.now(),
  title: 'Untitled Protocol',
  category: protocolCategories[0] || 'Uncategorized',
  content: '',
  links: [],
  images: []
};

                            setDatasetProtocols([newProto, ...datasetProtocols]);

                            setExpandedGroups((p) => ({
                              ...p,
                              activeProtoId: newProto.id
                            }));
                          }}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-6 rounded-lg shadow-sm text-sm transition-colors flex-1 md:flex-none flex items-center justify-center gap-2"
                        >
                          ➕ New Protocol
                        </button>
                      </div>
                    </div>

                    <div className="bg-white p-3 md:p-4 rounded-xl shadow-sm border border-slate-200 mb-6 flex flex-col gap-4 shrink-0 no-print">
                      <div className="flex flex-col md:flex-row gap-3 md:gap-4 items-center">
                        <div className="flex-1 w-full relative">
                          <span className="absolute left-3 top-2.5 text-slate-400">🔍</span>

                          <input
                            type="text"
                            placeholder="Search protocols..."
                            value={protoSearch}
                            onChange={(e) =>
                              setExpandedGroups((p) => ({ ...p, protoSearch: e.target.value }))
                            }
                            className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                          />
                        </div>

                        <div className="w-full md:w-64 flex gap-2">
                          <select
                            value={protoCatFilter}
                            onChange={(e) =>
                              setExpandedGroups((p) => ({
                                ...p,
                                protoCatFilter: e.target.value
                              }))
                            }
                            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-emerald-500 font-semibold text-slate-700 cursor-pointer"
                          >
                            <option value="ALL">All Categories</option>

                            {protocolCategories.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>

                          <button
                            onClick={() =>
                              setExpandedGroups((p) => ({
                                ...p,
                                showProtoCatMgr: !showProtoCatMgr
                              }))
                            }
                            className={`px-3 py-2 border rounded-lg text-sm font-bold transition-colors shadow-sm ${
                              showProtoCatMgr
                                ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                                : 'bg-slate-50 border-slate-300 text-slate-600 hover:bg-slate-100'
                            }`}
                            title="Manage Categories"
                          >
                            ⚙️
                          </button>
                        </div>
                      </div>

                      {showProtoCatMgr && (
                        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 flex flex-col gap-3">
                          <h4 className="text-xs font-bold text-slate-500 uppercase">
                            Manage Protocol Categories
                          </h4>

                          <div className="flex flex-col md:flex-row gap-2">
                            <input
                              type="text"
                              placeholder="New category name..."
                              value={newProtoCatInput}
                              onChange={(e) =>
                                setExpandedGroups((p) => ({
                                  ...p,
                                  newProtoCatInput: e.target.value
                                }))
                              }
                              className="flex-1 border border-slate-300 rounded px-3 py-2 text-sm outline-none focus:border-emerald-500"
                            />

                            <button
                              onClick={() => {
                                const v = newProtoCatInput.trim();

                                if (v && !protocolCategories.includes(v)) {
                                  setProtocolCategories([...protocolCategories, v]);

                                  setExpandedGroups((p) => ({
                                    ...p,
                                    newProtoCatInput: ''
                                  }));
                                }
                              }}
                              className="bg-emerald-600 text-white font-bold px-4 py-2 rounded text-sm shadow-sm hover:bg-emerald-700 transition-colors"
                            >
                              Add
                            </button>
                          </div>

                          <div className="flex flex-wrap gap-2 mt-2">
                            {protocolCategories.map((c) => (
                              <div
                                key={c}
                                className="flex items-center gap-1 bg-white border border-slate-300 px-2 py-1 rounded text-xs shadow-sm font-semibold text-slate-700"
                              >
                                {c}

                                <button
                                  onClick={() =>
                                    setProtocolCategories(
                                      protocolCategories.filter((cat) => cat !== c)
                                    )
                                  }
                                  className="text-slate-400 hover:text-red-500 ml-1 text-sm leading-none font-bold"
                                >
                                  &times;
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                      {filteredProtocols.length === 0 ? (
                        <div className="text-center py-10 text-slate-400 italic">
                          No protocols match your filters.
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
{filteredProtocols.map((proto) => (
  <div
    key={proto.id}
    className="bg-white border border-slate-200 rounded-xl p-4 md:p-5 shadow-sm hover:shadow-md hover:border-emerald-400 cursor-pointer transition-all flex flex-col group relative"
    onClick={() =>
      setExpandedGroups((p) => ({
        ...p,
        activeProtoId: proto.id
      }))
    }
  >
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (confirm('Delete this protocol?')) {
          setDatasetProtocols(
            datasetProtocols.filter((p) => p.id !== proto.id)
          );
        }
      }}
      className="absolute top-3 right-3 text-slate-300 hover:text-red-500 text-lg md:opacity-0 group-hover:opacity-100 transition-opacity no-print"
      title="Delete Protocol"
    >
      &times;
    </button>

    <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded self-start mb-3 border border-emerald-200">
      {proto.category}
    </span>

    <h3 className="font-bold text-slate-800 text-lg truncate pr-6">
      {proto.title}
    </h3>

    {proto.linkedPulseProgramName && (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();

          setActiveLibrarySelection({
            type: 'nmrExperiment',
            id: proto.linkedPulseProgramName
          });

          setCurrentModule('definitions');

          setTimeout(() => {
            const el = document.getElementById('section-nmrExperiment');
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }, 180);
        }}
        className="mt-3 self-start bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm transition-colors flex items-center gap-1"
      >
        🎛️ {proto.linkedPulseProgramName}
      </button>
    )}

    <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-x-4 gap-y-2 text-xs font-bold text-slate-500">
      <span className="flex items-center gap-1">
        🔗 {(proto.links || []).length} Links
      </span>
      <span className="flex items-center gap-1">
        📝 {proto.content ? 'Has Content' : 'Empty'}
      </span>
      {proto.linkedPulseProgramName && (
        <span className="flex items-center gap-1 text-blue-600">
          📡 Pulse Linked
        </span>
      )}
    </div>
  </div>
))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

{currentModule === 'active-test' &&
              (() => {
                const activeTest = tests.find((t) => t.id === activeTestId);

                if (!activeTest) return <div className="p-6">Test not found.</div>;

                // ── Auth gate ─────────────────────────────────────
                const isSuperuserSession = currentUser?.role === 'superuser';
                const activeTestOwned = !activeTest.operator || isSuperuserSession || (currentUser && currentUser.name === activeTest.operator) || unlockedTestIds.has(activeTest.id);
                if (!activeTestOwned) {
                  // Redirect to test list — user should use the login modal from there
                  setCurrentModule('tests');
                  return null;
                }
                // ─────────────────────────────────────────────────

                const updateActiveTest = (updates) => {
                  setTests((prev) =>
                    prev.map((t) => (t.id === activeTestId ? { ...t, ...updates } : t))
                  );
                };

                const isBox = activeTest.type === 'plate-9x9box';

                const siblingTests = isBox
                  ? []
                  : tests
                      .filter((t) => t.name === activeTest.name && t.name.trim() !== '')
                      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

                const jumpToProtocolFn = (id) => {
                  setExpandedGroups((p) => ({ ...p, activeProtoId: id }));
                  setCurrentModule('protocols');
                };

                const handleDuplicateInstance = () => {
                  const id = 't' + Date.now();
                  const newTest = JSON.parse(JSON.stringify(activeTest));

                  newTest.id = id;
                  newTest.date = new Date().toISOString().split('T')[0];
                  newTest.instanceName = 'New Instance';
                  newTest.comments = '';
                  newTest.images = [];
                  newTest.documents = [];

                  if (
                    newTest.type.startsWith('plate-') &&
                    newTest.type !== 'plate-9x9box'
                  ) {
                    newTest.grid = newTest.grid.map((row) => row.map(() => ''));
                  }

                  if (newTest.type === 'nmr-fittings') {
                    newTest.grid = newTest.grid.map((row) => row.map(() => ''));
                  }

                  setTests((prev) => [...prev, newTest]);

                  setActiveTestId(id);
                };

const TestHeader = (
                  <div className="flex flex-col shrink-0 z-20 no-print">
                    <div className="bg-white border-b border-slate-200 px-4 md:px-6 py-4 flex flex-col lg:flex-row justify-between items-start lg:items-center shadow-sm gap-4">
                      <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4 w-full lg:w-auto">
                        <button
                          onClick={() => {
                            if (isBox && activeTest.storageId) {
                              setActiveStorageId(activeTest.storageId);
                              setCurrentModule('storage-detail');
                            } else {
                              setCurrentModule('tests');
                            }
                          }}
                          className="text-slate-400 hover:text-blue-600 transition-colors bg-slate-50 hover:bg-blue-50 p-2 rounded-lg shadow-sm border border-slate-200 self-start md:self-auto"
                        >
                          ◀ Back
                        </button>

                        <div className="flex-1 w-full">
                          <input
                            value={activeTest.name}
                            onChange={(e) => updateActiveTest({ name: e.target.value })}
                            className="text-xl font-black text-slate-800 bg-transparent border-none outline-none focus:ring-1 focus:ring-blue-500 rounded px-1 w-full md:w-64"
                            placeholder="Test Name"
                          />

                          <div className="text-xs text-slate-500 font-medium px-1 mt-1 flex flex-wrap items-center gap-2">
                            {activeTest.testCategory && (
                              <span className="uppercase text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                                {activeTest.testCategory}
                              </span>
                            )}
                            {activeTest.secondaryCategory && (
                              <span className="uppercase text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                                {activeTest.secondaryCategory}
                              </span>
                            )}
                            {activeTest.bestMeasurement && (
                              <span className="uppercase text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 font-bold">
                                ⭐ Best
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full lg:w-auto flex-wrap">
                        <button
                          onClick={() => {
                            if (
                              window.confirm(
                                'Sei sicuro di voler eliminare definitivamente questo test?'
                              )
                            ) {
                              setTests((prev) => prev.filter((t) => t.id !== activeTest.id));
                              setCurrentModule('tests');
                            }
                          }}
                          className="bg-red-50 text-red-600 hover:bg-red-100 hover:border-red-300 font-bold py-2 px-3 rounded-lg text-xs transition-colors border border-red-200 shadow-sm"
                        >
                          🗑️ Elimina
                        </button>
                        
<React.Fragment>
  {activeTest.type === 'plate-9x9box' ? (
    <div className="flex flex-col flex-1 min-w-[160px]">
      <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">
        Box Owner
      </label>
      <select
        value={activeTest.boxOwner || ''}
        onChange={(e) => updateActiveTest({ boxOwner: e.target.value })}
        className="bg-slate-50 border border-slate-200 text-xs px-2 py-2 rounded-lg outline-none focus:border-blue-500"
      >
        <option value="">Select Box Owner...</option>
        {operatorNames.map((op) => (<option key={`owner-${op}`} value={op}>{op}</option>))}
      </select>
    </div>
  ) : (
    <>
    <div className="flex flex-col flex-1 min-w-[160px]">
      <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">
        Primary Scientist
      </label>
      <select
        value={activeTest.operator || ''}
        onChange={(e) => updateActiveTest({ operator: e.target.value })}
        className="bg-slate-50 border border-slate-200 text-xs px-2 py-2 rounded-lg outline-none focus:border-blue-500"
      >
        <option value="">Select Scientist...</option>
        {operatorNames.map((op) => (<option key={`sci-${op}`} value={op}>{op}</option>))}
      </select>
    </div>
    <div className="flex flex-col flex-1 min-w-[180px]">
      <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">
        Co-Scientists
      </label>
      <div className="flex flex-wrap gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 min-h-[32px]">
        {(activeTest.coScientists || []).map((cs) => (
          <span key={cs} className="flex items-center gap-1 bg-blue-100 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
            {cs}
            <button type="button" onClick={() => updateActiveTest({ coScientists: (activeTest.coScientists || []).filter(x => x !== cs) })} className="hover:text-red-500 font-black leading-none">×</button>
          </span>
        ))}
        <select
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            const existing = activeTest.coScientists || [];
            if (!existing.includes(v) && v !== activeTest.operator) {
              updateActiveTest({ coScientists: [...existing, v] });
            }
          }}
          className="text-[10px] bg-transparent outline-none text-slate-400 flex-1 min-w-[80px]"
        >
          <option value="">+ Add co-scientist…</option>
          {operatorNames.filter(op => op !== activeTest.operator && !(activeTest.coScientists || []).includes(op)).map(op => (
            <option key={op} value={op}>{op}</option>
          ))}
        </select>
      </div>
    </div>
    </>
  )}
</React.Fragment>

                    <div className="flex flex-col flex-1 min-w-[140px]">
                       <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">
                         Primary Class.
                       </label>
                       <select
                         value={activeTest.testCategory || ''}
                         onChange={(e) => {
                           updateActiveTest({ 
                             testCategory: e.target.value,
                             secondaryCategory: '' 
                           });
                         }}
                         className="bg-slate-50 border border-slate-200 text-xs px-2 py-2 rounded-lg outline-none focus:border-blue-500"
                       >
                         <option value="">Select...</option>
                         {PRIMARY_CATEGORIES.map((cat) => (
                           <option key={cat} value={cat}>{cat}</option>
                         ))}
                       </select>
                     </div>
                     <div className="flex flex-col flex-1 min-w-[140px]">
                       <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">
                         Sec. Class.
                       </label>
                       <select
                         value={activeTest.secondaryCategory || ''}
                         onChange={(e) => updateActiveTest({ secondaryCategory: e.target.value })}
                         className="bg-slate-50 border border-slate-200 text-xs px-2 py-2 rounded-lg outline-none focus:border-blue-500"
                         disabled={!activeTest.testCategory || !CLASSIFICATION_MAP[activeTest.testCategory]}
                       >
                         <option value="">Select...</option>
                         {activeTest.testCategory && CLASSIFICATION_MAP[activeTest.testCategory] ? 
                           CLASSIFICATION_MAP[activeTest.testCategory].map((cat, idx) => (
                             <option key={idx} value={cat}>{cat}</option>
                           )) 
                           : null
                         }
                       </select>
                     </div>

                        <div className="flex flex-col flex-1 min-w-[140px]">
                          <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">
                            Experiment Type
                          </label>
                          <select
                            value={
                           activeTest.type === 'plate-96' || activeTest.type === 'plate-384' || activeTest.type === 'plate-24' ? 'Multiwell plate essay' : 
                           activeTest.type === 'nmr-fittings' ? 'NMR Fitting' :
                           activeTest.type === 'md_simulation' ? 'MD Simulation' :
                           activeTest.type === 'protein_expression' ? 'Protein expression & Purification' :
                           activeTest.type === 'ssnmr' ? 'Solid State NMR' :
                           activeTest.type === 'cd' ? 'Circular Dichroism' :
                           activeTest.type === 'nmr' ? 'NMR' :
                           activeTest.type === 'cloning' ? 'Cloning' :
                           activeTest.type === 'docking' ? 'Molecular Docking' :
                           activeTest.type === 'flow_cytometry' ? 'Flow Cytometry' : 'Multiwell plate essay'
                         }
                            disabled
                            className="bg-slate-100 border border-slate-200 text-xs px-2 py-2 rounded-lg outline-none text-slate-500 cursor-not-allowed"
                          >
                            {EXPERIMENT_TYPES.map(type => (
                              <option key={type} value={type}>{type}</option>
                            ))}
                          </select>
                        </div>

                        <div className="flex flex-col flex-1 min-w-[110px]">
                          <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">
                            Instance
                          </label>
                          <input
                            type="text"
                            value={activeTest.instanceName || ''}
                            onChange={(e) => updateActiveTest({ instanceName: e.target.value })}
                            className="bg-slate-50 border border-slate-200 text-xs px-2 py-2 rounded-lg outline-none focus:border-blue-500"
                            placeholder="e.g. 24h / Rep 1"
                          />
                        </div>

                        <div className="flex flex-col flex-1 min-w-[120px]">
                          <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">
                            Date
                          </label>
                          <input
                            type="date"
                            value={activeTest.date}
                            onChange={(e) => updateActiveTest({ date: e.target.value })}
                            className="bg-slate-50 border border-slate-200 text-xs px-2 py-2 rounded-lg outline-none focus:border-blue-500"
                          />
                        </div>
                        
                        <div className="flex flex-col items-center justify-center self-end mb-1">
                          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 cursor-pointer hover:text-blue-600 transition-colors">
                            <input
                              type="checkbox"
                              checked={!!activeTest.bestMeasurement}
                              onChange={(e) => updateActiveTest({ bestMeasurement: e.target.checked })}
                              className="rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                            />
                            ⭐ Best
                          </label>
                        </div>
                      </div>
                    </div>

                    {siblingTests.length > 0 && (
                      <div className="bg-blue-50 border-b border-blue-200 px-4 md:px-6 py-2 flex items-center overflow-x-auto custom-scrollbar gap-2 shadow-inner">
                        <span className="text-[10px] font-bold text-blue-800 uppercase tracking-wide mr-2 shrink-0">
                          📅 Date / Conditions:
                        </span>

                        {siblingTests.map((t, idx) => (
                          <button
                            key={t.id}
                            onClick={() => setActiveTestId(t.id)}
                            className={`shrink-0 px-3 py-1.5 md:py-1 text-xs font-bold rounded-full transition-colors flex items-center gap-1.5 shadow-sm group ${
                              activeTestId === t.id
                                ? 'bg-blue-600 text-white'
                                : 'bg-white text-blue-700 border border-blue-300 hover:bg-blue-100'
                            }`}
                          >
                            📅 {t.instanceName || t.date || `Cond ${idx + 1}`}

                            {siblingTests.length > 1 && (
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();

                                  if (
                                    window.confirm(
                                      `Delete condition ${t.instanceName || t.date}?`
                                    )
                                  ) {
                                    setTests((prev) => {
                                      const next = prev.filter((test) => test.id !== t.id);

                                      if (activeTestId === t.id) {
                                        setActiveTestId(
                                          next.find((x) => x.name === t.name)?.id ||
                                            next[0]?.id
                                        );
                                      }

                                      return next;
                                    });
                                  }
                                }}
                                className={`ml-1 px-1 opacity-100 md:opacity-0 group-hover:opacity-100 ${
                                  activeTestId === t.id
                                    ? 'text-blue-300 hover:text-white'
                                    : 'text-red-400 hover:text-red-600'
                                }`}
                              >
                                &times;
                              </span>
                            )}
                          </button>
                        ))}

                        <button
                          onClick={handleDuplicateInstance}
                          className="shrink-0 px-3 py-1.5 md:py-1 text-[10px] font-bold text-blue-600 border border-dashed border-blue-400 rounded-full hover:bg-blue-100 transition-colors bg-white shadow-sm ml-2"
                        >
                          + Add Date/Condition copy
                        </button>
                      </div>
                    )}
                  </div>
                );

                if (activeTest.type === 'md_simulation') {
                  return (
                    <MDTestRenderer
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      allTests={tests}
                      TestHeader={TestHeader}
                      datasetProtocols={datasetProtocols}
                      jumpToProtocol={jumpToProtocolFn}
                      allCmpds={allCmpds}
                      allCellLines={allCellLines}
                      customFields={customFields}
                      testCategories={testCategories}
                      instances={siblingTests}
                      operators={operatorNames}
                      solvents={solvents}
                      buffers={buffers}
                      additives={additives}
                      compoundMeta={compoundMeta}
                      mandatoryRules={mandatoryRules}
                      mandatoryBehavior={mandatoryBehavior}
                    />
                  );
                }

                if (activeTest.type === 'nmr') {
                  return (
                    <NMRTestRenderer
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      allTests={tests}
                      setTests={setTests}
                      TestHeader={TestHeader}
                      datasetProtocols={datasetProtocols}
                      jumpToProtocol={jumpToProtocolFn}
                      jumpToTest={jumpToTest}
                      allCmpds={allCmpds}
                      allCellLines={allCellLines}
                      customFields={customFields}
                      testCategories={testCategories}
                      instances={siblingTests}
                      operators={operatorNames}
                      solvents={solvents}
                      buffers={buffers}
                      additives={additives}
                      nmrInstruments={nmrInstruments}
                      nmrProbes={nmrProbes}
                      nmrExperiments={nmrExperiments}
                      compoundMeta={compoundMeta}
                      mandatoryRules={mandatoryRules}
                      mandatoryBehavior={mandatoryBehavior}
                    />
                  );
                }

                if (activeTest.type === 'cd') {
                  const updateInstance = (instId, updates) => {
                    setTests((prev) => prev.map((t) => t.id === instId ? { ...t, ...updates } : t));
                  };
                  return (
                    <CDTestRenderer
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      allTests={tests}
                      setTests={setTests}
                      appClipboard={appClipboard}
                      setAppClipboard={setAppClipboard}
                      TestHeader={TestHeader}
                      datasetProtocols={datasetProtocols}
                      jumpToProtocol={jumpToProtocolFn}
                      allCmpds={allCmpds}
                      allCellLines={allCellLines}
                      customFields={customFields}
                      testCategories={testCategories}
                      operators={operatorNames}
                      instances={siblingTests}
                      updateInstance={updateInstance}
                      solvents={solvents}
                      buffers={buffers}
                      additives={additives}
                      compoundMeta={compoundMeta}
                      mandatoryRules={mandatoryRules}
                      mandatoryBehavior={mandatoryBehavior}
                    />
                  );
                }
if (activeTest.type === 'ssnmr') {
  const ssNmrInstances = (() => {
    const base = Array.isArray(siblingTests) && siblingTests.length
      ? siblingTests
      : [activeTest];

    const filtered = base.filter(
      (t) => t && (t.id === activeTest.id || t.type === 'ssnmr')
    );

    return filtered.length ? filtered : [activeTest];
  })();

  const updateInstance = (instId, updates) => {
    setTests((prev) =>
      prev.map((t) => (t.id === instId ? { ...t, ...updates } : t))
    );
  };

  return (
    <SSNMRTestRenderer
      activeTest={activeTest}
      updateActiveTest={updateActiveTest}
      allTests={tests}
      setTests={setTests}
      appClipboard={appClipboard}
      setAppClipboard={setAppClipboard}
      TestHeader={TestHeader}
      datasetProtocols={datasetProtocols}
      jumpToProtocol={jumpToProtocolFn}
      allCmpds={allCmpds}
      allCellLines={allCellLines}
      customFields={customFields}
      testCategories={testCategories}
      operators={operatorNames}
      instances={ssNmrInstances}
      updateInstance={updateInstance}
      solvents={solvents}
      buffers={buffers}
      additives={additives}
      compoundMeta={compoundMeta}
      mandatoryRules={mandatoryRules}
      mandatoryBehavior={mandatoryBehavior}
    />
  );
}
                if (activeTest.type === 'plate-9x9box') {
                  return (
                    <BoxDetail
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      allTests={tests}
                      storages={storages}
                      expandedGroups={expandedGroups}
                      setExpandedGroups={setExpandedGroups}
                      customCmpds={customCmpds}
                      jumpToTest={jumpToTest}
                      setMoveModal={setMoveModal}
                      TestHeader={TestHeader}
                      operators={operatorNames}
                    />
                  );
                }
if (activeTest.type === 'flow_cytometry') {
               return (
                 <FlowCytometryTestRenderer
                   activeTest={activeTest}
                   updateActiveTest={updateActiveTest}
                   allTests={tests}
                   setTests={setTests}
                   TestHeader={TestHeader}
                   datasetProtocols={datasetProtocols}
                   jumpToProtocol={jumpToProtocolFn}
                   allCmpds={allCmpds}
                   allCellLines={allCellLines}
                   customFields={customFields}
                   testCategories={testCategories}
                   operators={operatorNames}
                   instances={siblingTests}
                   solvents={solvents}
                   buffers={buffers}
                   additives={additives}
                   compoundMeta={compoundMeta}
                   mandatoryRules={mandatoryRules}
                   mandatoryBehavior={mandatoryBehavior}
                 />
               );
             }
                if (activeTest.type === 'cloning') {
                  return (
                    <CloningTestRenderer
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      allTests={tests}
                      TestHeader={TestHeader}
                      datasetProtocols={datasetProtocols}
                      jumpToProtocol={jumpToProtocolFn}
                      allCmpds={allCmpds}
                      allCellLines={allCellLines}
                      customFields={customFields}
                      testCategories={testCategories}
                      operators={operatorNames}
                      instances={siblingTests}
                      compoundMeta={compoundMeta}
                      plasmidMeta={plasmidMeta}
                      molecules={molecules}
                      solvents={solvents}
                      buffers={buffers}
                      additives={additives}
                      mandatoryRules={mandatoryRules}
                      mandatoryBehavior={mandatoryBehavior}
                    />
                  );
                }

                if (activeTest.type === 'nmr-fittings') {
                  return (
                    <NMRFittingsTestRenderer
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      allTests={tests}
                      TestHeader={TestHeader}
                      operators={operatorNames}
                      molecules={molecules}
                      compoundMeta={compoundMeta}
                      allCmpds={allCmpds}
                      allCellLines={allCellLines}
                      customFields={customFields}
                      testCategories={testCategories}
                      customConc={customConc}
                      setCustomConc={setCustomConc}
                      cmpColors={cmpColors}
                      setCmpColors={setCmpColors}
                      customCmpds={customCmpds}
                      setCustomCmpds={setCustomCmpds}
                      appClipboard={appClipboard}
                      setAppClipboard={setAppClipboard}
                      datasetProtocols={datasetProtocols}
                      jumpToProtocol={jumpToProtocolFn}
                      solvents={solvents}
                      buffers={buffers}
                      additives={additives}
                      nmrInstruments={nmrInstruments}
                      nmrProbes={nmrProbes}
                      nmrExperiments={nmrExperiments}
                      mandatoryRules={mandatoryRules}
                      mandatoryBehavior={mandatoryBehavior}
                    />
                  );
                }

                if (activeTest.type === 'protein_expression') {
                  return (
                    <ProteinExpressionTestRenderer
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      allTests={tests}
                      TestHeader={TestHeader}
                      datasetProtocols={datasetProtocols}
                      jumpToProtocol={jumpToProtocolFn}
                      allCmpds={allCmpds}
                      allCellLines={allCellLines}
                      customFields={customFields}
                      testCategories={testCategories}
                      operators={operatorNames}
                      instances={siblingTests}
                      solvents={solvents}
                      buffers={buffers}
                      additives={additives}
                      mandatoryRules={mandatoryRules}
                      mandatoryBehavior={mandatoryBehavior}
                    />
                  );
                }

                if (
                  activeTest.type.startsWith('plate-') &&
                  activeTest.type !== 'plate-9x9box'
                ) {
                  return (
                    <PlateTestRenderer
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      allTests={tests}
                      appClipboard={appClipboard}
                      setAppClipboard={setAppClipboard}
                      customCmpds={customCmpds}
                      setCustomCmpds={setCustomCmpds}
                      customConc={customConc}
                      setCustomConc={setCustomConc}
                      cmpColors={cmpColors}
                      setCmpColors={setCmpColors}
                      allCmpds={allCmpds}
                      allCellLines={allCellLines}
                      customFields={customFields}
                      testCategories={testCategories}
                      jumpToTest={(id) => {
                        setActiveTestId(id);
                        setCurrentModule('active-test');
                      }}
                      TestHeader={TestHeader}
                      datasetProtocols={datasetProtocols}
                      jumpToProtocol={jumpToProtocolFn}
                      operators={operatorNames}
                      solvents={solvents}
                      buffers={buffers}
                      additives={additives}
                      mandatoryRules={mandatoryRules}
                      mandatoryBehavior={mandatoryBehavior}
                    />
                  );
                }

                if (activeTest.type === 'docking') {
                  return (
                    <DockingTestRenderer
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      allTests={tests}
                      TestHeader={TestHeader}
                      datasetProtocols={datasetProtocols}
                      jumpToProtocol={jumpToProtocolFn}
                      allCmpds={allCmpds}
                      allCellLines={allCellLines}
                      customFields={customFields}
                      testCategories={testCategories}
                      operators={operatorNames}
                      instances={siblingTests}
                      solvents={solvents}
                      buffers={buffers}
                      additives={additives}
                      mandatoryRules={mandatoryRules}
                      mandatoryBehavior={mandatoryBehavior}
                    />
                  );
                }

                return <div className="p-6">Unknown test type.</div>;
              })()}
            {currentModule === 'notebook' && (<NotebookModule
              tests={tests} allCellLines={allCellLines} testCategories={testCategories}
              setActiveTestId={setActiveTestId} setCurrentModule={setCurrentModule}
              customConc={customConc} cmpColors={cmpColors} allCmpds={allCmpds}
              customFields={customFields} operatorNames={operatorNames} plasmidMeta={plasmidMeta}
              solvents={solvents} buffers={buffers} additives={additives}
              nmrInstruments={nmrInstruments} nmrProbes={nmrProbes} nmrExperiments={nmrExperiments}
              currentUser={currentUser}
            />)}

            {currentModule === 'calculations' && (<CalculationsModule
              compoundMeta={compoundMeta} plasmidMeta={plasmidMeta}
              solvents={solvents} buffers={buffers} additives={additives}
              allCmpds={allCmpds} calculationEntries={calculationEntries}
              setCalculationEntries={setCalculationEntries} currentUser={currentUser}
            />)}

            {currentModule === 'publications' && (<PublicationsModule
              operatorNames={operatorNames} tests={tests} currentUser={currentUser}
            />)}
          </div>
        </div>
      )}
    </div>

    {/* The new ScientistLoginGate above (fixed full-screen) handles requireLoginOnEntry for ALL views */}

{/* ── Generic Login Modal (triggered by sidebar or locked tests) ── */}
    {loginModal && !(authSettings.requireLoginOnEntry && !currentUser) && (
      <ScientistLoginModal
        operators={
          loginModal.targetScientistName
            ? normalizeOperators(operators).filter((op) => op.name === loginModal.targetScientistName)
            : normalizeOperators(operators)
        }
        title={loginModal.targetScientistName ? `Log in as ${loginModal.targetScientistName}` : 'Scientist Login'}
        subtitle={loginModal.targetScientistName
          ? `This test belongs to ${loginModal.targetScientistName}. Enter their password to continue.`
          : 'Select your name and enter your password to access protected data.'}
        onLogin={(user) => {
          if (loginModal.onSuccess) {
            loginModal.onSuccess(user);
          } else {
            setCurrentUser(user);
            setLoginModal(null);
          }
        }}
        onClose={() => setLoginModal(null)}
      />
    )}
    </React.Fragment>
    </Suspense>
  );
}
