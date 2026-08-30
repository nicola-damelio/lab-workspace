import React, { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import LZString from 'lz-string';
import {LOCAL_STORAGE_KEY, PLATES_DEF, DEF_COMPOUNDS, DEF_CELL_LINES, parsePayload} from './data/constants';
const TestShellRenderer = lazy(() => import('./components/TestShellRenderer'));
import { StorageModals } from './components/Storage';
import { Setup, Data, Simulations, Analysis, MD_ANALYSIS_SECTIONS, mdChartToSvg, mdContactToSvg, mdProfileToSvg, mdDsspToSvg, readChartSnapshots } from '/src/components/MDSections.jsx';


import { MD_SIMULATION_TAB_CONFIG } from './data/specialPages';
import {PRIMARY_CATEGORIES} from './data/testTypes';
import { AppSidebar } from './components/AppModules/appSidebar';
import { AgendaModule } from './components/AppModules/agendaModule';
import { DashboardModule } from './components/AppModules/dashboardModule';
import { LibraryModule } from './components/AppModules/libraryModule';
import { SettingsModule } from './components/AppModules/settingsModule';
import { StorageModule } from './components/AppModules/storageModuleViews';
import { TestsModule } from './components/AppModules/testsModule';
import { ProtocolsModule } from './components/AppModules/protocolsModule';
import { ActiveTestModule } from './components/AppModules/activeTestModule';
import { NotebookModule, CalculationsModule, PublicationsModule } from './components/AppModules/miscModules';
import { ProjectsModule } from './components/AppModules/projectsModule';
import { ProjectDetailModule } from './components/AppModules/projectDetailModule';
import {normalizeOperators} from './utils/auth';
import { clearDriveToken, testDriveAccess, getConfiguredDriveClientId, connectDriveWithGis, setDriveRootContext, ensureDriveFolder, getDriveToken, uploadWorkspaceFile } from './utils/driveUpload';
import { sanitizeSlug } from './utils/driveNaming';

import { ScientistLoginGate, ScientistLoginModal } from './components/AppModules/definitionsManagers';




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

/**
 * Keep the persisted "test categories" list in sync with reality: always the
 * canonical PRIMARY_CATEGORIES plus any extra category that is actually used
 * by an existing test. Unused stale categories (e.g. from older datasets) are
 * dropped so they no longer pollute the classification dropdowns.
 */
const sanitizeTestCategories = (cats, testsList) => {
  const used = new Set((testsList || []).map((t) => t.testCategory).filter(Boolean));
  return [...new Set([...PRIMARY_CATEGORIES, ...(cats || []).filter((c) => used.has(c))])];
};

const buildMDNotebookHtml = (checked, ctx) => {
  const t = ctx?.activeTest || {};
  // Snapshot figures (contacts / profiles / DSSP) are kept out of the Firestore
  // document and read back from the per-test sessionStorage cache (legacy
  // mdNotebookCharts is still honoured for previously saved datasets).
  const charts = { ...readChartSnapshots(t.id), ...((t && t.mdNotebookCharts) || {}) };
  const res = (t && t.mdAnalysisResult) || null;

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

  // Vector chart rendered straight from the persisted analysis data — no
  // base64 images involved, so the notebook stays crisp and tiny.
  const svgFigure = (svg, label) => (svg
    ? `<figure style="margin: 12px 0; text-align:center; break-inside:avoid;">${svg}<figcaption style="font-size:11px;color:#64748b;margin-top:4px;"><b>${label}</b></figcaption></figure>`
    : '');

  const svgOrImage = (svg, src, label) => svgFigure(svg, label) || chartFigure(src, label);

  if (checked.results) {
    html += `<p style="font-size:12px;color:#475569;margin-bottom:8px;"><b>Results Summary:</b> RMSD, RMSF, Rg, SASA and energy curves.</p>`;
    html += svgOrImage(mdChartToSvg({ data: res && res.rmsd, series: [{ key: 'value', color: '#3b82f6' }], yLabel: 'nm', xLabel: 'Time (ns)' }), charts.rmsd, 'RMSD (backbone)');
    const rmsfSvgData = res && res.rmsf ? res.rmsf.map((d) => ({ ...d, fill: d.value > 0.25 ? '#ef4444' : '#3b82f6' })) : null;
    html += svgOrImage(mdChartToSvg({ data: rmsfSvgData, series: [{ key: 'value', color: '#3b82f6' }], chartType: 'bar', xKey: 'residue', yLabel: 'nm', xLabel: 'Residue' }), charts.rmsf, 'RMSF per residue');
    html += svgOrImage(mdChartToSvg({ data: res && res.rg, series: [{ key: 'value', color: '#22c55e' }], yLabel: 'nm', xLabel: 'Time (ns)' }), charts.rg, 'Radius of Gyration (Rg)');
    html += svgOrImage(mdChartToSvg({ data: res && res.sasa, series: [{ key: 'value', color: '#f59e0b' }], yLabel: 'nm²', xLabel: 'Time (ns)' }), charts.sasa, 'SASA');
    html += svgOrImage(mdChartToSvg({ data: res && res.energy, series: [{ key: 'potential', color: '#ef4444' }, { key: 'kinetic', color: '#3b82f6' }, { key: 'total', color: '#22c55e' }], yLabel: 'kJ/mol', xLabel: 'Time (ns)' }), charts.energy, 'Energy');
  }

  if (checked.analysis) {
    html += `<p style="font-size:12px;color:#475569;margin-bottom:8px;"><b>Data Analysis:</b> membrane contacts (polar + apolar), membrane profiles and secondary structure (DSSP).</p>`;
    const contact = (t && t.mdContactResult) || {};
    const profile = (t && t.mdProfileResult) || null;
    const dssp = (t && t.mdDsspResult) || null;
    // Prefer vector SVG rendered from the persisted analysis data; fall back to
    // the in-session raster snapshots for cases where only those exist.
    const fig = (svg, img, label) => svgFigure(svg, label) || chartFigure(img, label);
    const contactFigs = [
      ['polar', 'peptide', 'Membrane contacts — Polar (X: peptide atoms)'],
      ['polar', 'membrane', 'Membrane contacts — Polar (X: lipid atoms)'],
      ['vdW', 'peptide', 'Membrane contacts — Apolar (X: peptide atoms)'],
      ['vdW', 'membrane', 'Membrane contacts — Apolar (X: lipid atoms)'],
    ];
    contactFigs.forEach(([m, xa, label]) => {
      const imgKey = m === 'polar' ? 'contactPolar' : 'contactApolar';
      html += fig(mdContactToSvg(contact[`${m}_${xa}`], label), charts[imgKey], label);
    });
    if (Array.isArray(profile) && profile.length) {
      html += profile.map((p) => mdProfileToSvg(p)).join('');
    } else {
      html += chartFigure(charts.scd, 'Order parameter |SCD|');
      html += chartFigure(charts.density, 'Electron density profile');
      html += chartFigure(charts.potential, 'Electrostatic potential');
    }
    if (Array.isArray(dssp) && dssp.length) {
      html += dssp.map((d) => mdDsspToSvg(d)).join('');
      html += chartFigure(charts.dsspHeat, 'DSSP timeline map (residue × frame)');
    } else {
      html += chartFigure(charts.dsspContent, 'Secondary structure content vs time');
      html += chartFigure(charts.dsspHeat, 'DSSP timeline map (residue × frame)');
      html += chartFigure(charts.dsspOcc, 'Per-residue occupancy');
    }
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
        manualMW: '',
        manualResidues: '',
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

let auth,
  db,
  appId = 'lab-workspace-app';

try {
  if (window.firebase) {
    if (!window.firebase.apps.length) {
      window.firebase.initializeApp(FIREBASE_CONFIG);
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

// ── Weekly HTML autosave ──────────────────────────────────────────────────
// Full HTML backups of every dataset are written to <Lab Workspace>/backups/
// on Google Drive once a week. The key stores the timestamp of the last run.
const BACKUP_INTERVAL_KEY = 'labLastWeeklyBackup';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/* =========================================================
MAIN APP
========================================================= */
export default function App() {
  try { console.info('Lab Workspace build:', typeof __APP_COMMIT__ !== 'undefined' ? __APP_COMMIT__ : 'dev'); } catch { /* ignore */ }
  const createEmptyTest = (id, num, customType = 'plate-96') => {
const baseTest = {
  id,
  name: `Test ${num}`,
  date: new Date().toISOString().split('T')[0],
  // The first instance is ALWAYS present and non-empty: a brand-new test gets
  // a real instance name right away (instance1) instead of an unnamed one.
  instanceName: 'instance1',
  testCategory: 'Activity',
  secondaryCategory: '',
  bestMeasurement: false,
  operator: currentUser?.name || '',
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
        manualMW: '',
        manualResidues: '',
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
testCategory: 'Molecular Structure and Dynamics', // real primary category (was 'Solid-state NMR')
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
     testCategory: 'Activity', // flow-cytometry default: real primary category (was 'Immunophenotyping')
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
if (customType === 'microscopy') {
   const dimKey = '96';
   const dim = PLATES_DEF[dimKey] || PLATES_DEF['96'];
   const defCell = Array(26)
     .fill(null)
     .map(() =>
       Array(26)
         .fill(null)
         .map(() => ({ excluded: false, role: null, conc: null, region: 'Primary', manualOverride: false }))
     );

   return {
     ...baseTest,
     type: 'microscopy',
     testCategory: 'Interactions',
     secondaryCategory: 'Microscopy',
     cellNumber: '',
     fixation: 'None',
     permeabilization: 'None',
     microscopyType: '',
     microscopeModel: '',
     objective: '',
     laserLines: '',
     detector: '',
     filterCubes: '',
     magnification: '',
     acquisitionSoftware: '',
     // Same plate design as Flow Cytometry's Experimental Setup.
     fcPlate: {
       plateType: dimKey,
       rowCompounds: Array(dim?.rows || 8).fill(''),
       compounds: Array(dim?.cols || 12).fill(''),
       cellConfig: defCell,
       topConcStr: '100',
       dilFactorStr: '3',
       unit: 'µM',
       cmpColors: {},
       customConc: {}
     },
     msVideos: [],
     msMovies: [],
     msImages: []
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

if (customType === 'dosy') {
  const id = 'dt' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  return {
    ...baseTest,
    name: `DOSY ${num}`,
    type: 'dosy',
    testCategory: 'Molecular Structure and Dynamics',
    secondaryCategory: 'Diffusion by DOSY',
    dosyTables: [{
      id, nRows: 8, nCols: 4, delayUnit: 's/mm2',
      delays: [0, 5, 10, 20, 40, 60, 80, 100],
      colResidues: ['', '', '', ''],
      grid: Array.from({ length: 8 }, () => Array(4).fill(''))
    }]
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
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [datasetsList, setDatasetsList] = useState([]);
  const [currentDatasetId, setCurrentDatasetId] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [pendingLoad, setPendingLoad] = useState(null);
  const [appClipboard, setAppClipboard] = useState(null);
  const [datasetTitle, setDatasetTitle] = useState('');
  const [datasetSubtitle, setDatasetSubtitle] = useState('');
  // Keep the Google Drive dataset folder in sync with the main file (dataset)
  // that is open: everything the app uploads lives inside Lab Workspace →
  // a folder named after the dataset (see driveUpload.ensureDriveFolder).
  // Renaming the dataset renames that Drive folder right away (debounced), so
  // the name shown at the top of the app and the Drive folder name are one
  // and the same.
  const driveRenameTimeoutRef = useRef(null);
  useEffect(() => {
    setDriveRootContext({ id: currentDatasetId || '', name: datasetTitle || '' });
    if (!currentDatasetId || !getDriveToken()) return;
    if (driveRenameTimeoutRef.current) clearTimeout(driveRenameTimeoutRef.current);
    driveRenameTimeoutRef.current = setTimeout(() => {
      ensureDriveFolder().catch(() => {});
    }, 800);
    return () => {
      if (driveRenameTimeoutRef.current) clearTimeout(driveRenameTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDatasetId, datasetTitle]);
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
  // Where the user came from before opening a test page (used by the active
  // test's "◀ Back" button), e.g. { module: 'project-detail', projectId }.
  const [returnTarget, setReturnTarget] = useState(null);
  const [storageModal, setStorageModal] = useState(null);
  const [moveModal, setMoveModal] = useState(null);
 const [testCategories, setTestCategories] = useState(PRIMARY_CATEGORIES);
  const [protocolCategories, setProtocolCategories] = useState([
    'Preparation',
    'Measurement',
    'Analysis'
  ]);
  const [datasetProtocols, setDatasetProtocols] = useState([]);

  const historyRef = useRef([[createEmptyTest('t1', 1, 'plate-96')]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [reactTests, setReactTests] = useState(historyRef.current[0]);

  const tests = reactTests;

  const allCmpds = useMemo(() => {
    // Built-in default compounds only appear as a fallback when the user has
    // not defined their own library yet — otherwise dropdowns keep showing
    // compounds that were removed from the Library.
    const lib = [...new Set(customCmpds || [])].filter(Boolean);
    return lib.length > 0 ? lib : [...new Set([...DEF_COMPOUNDS, ...lib])];
  }, [customCmpds]);

  const allCellLines = useMemo(() => {
    const lib = [...new Set(customCellLines || [])].filter(Boolean);
    return lib.length > 0 ? lib : [...new Set([...DEF_CELL_LINES, ...lib])];
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

  // ── AUTO-ATTRIBUTE OPENED TESTS TO THE CURRENT SCIENTIST ────────────────
  // A test with no owner is invisible to non-superuser scientists in the test
  // list (only superusers see unassigned tests), so a scientist who opens an
  // unassigned test would lose it after closing it. Claim it for them on open
  // so it stays visible in their list.
  useEffect(() => {
    if (!currentUser || !currentUser.name) return;
    const openTest = tests.find((x) => x.id === activeTestId);
    if (!openTest) return;
    const scientists = [openTest.operator, ...(openTest.coScientists || [])].filter(Boolean);
    if (scientists.length > 0) return; // already owned / assigned to others
    setTests((prev) =>
      prev.map((x) => (x.id === openTest.id ? { ...x, operator: currentUser.name } : x))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTestId]);

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
  }, [operators, authSettings, user]);
  // ─────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!auth) {
      setIsCloudReady(true);
      return;
    }

    const initAuth = async () => {
      auth.onAuthStateChanged((currentUser) => {
        // Google / Firebase sign-in is OPTIONAL and only used for cloud sync.
        // People without a Google account must still be able to use the app:
        // the scientist password login (ScientistLoginGate) is the only
        // required gate, and saving falls back to localStorage when no Google
        // user is signed in.
        if (currentUser) {
          setUser(currentUser);
        }
        setNeedsLogin(false);
        setIsCloudReady(true);
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
  }, [user]);
  // ──────────────────────────────────────────────────────────────────────


    const handleManualLogin = async () => {
    // Optional Google sign-in for CLOUD SYNC (Firestore).
    // Drive uploads are handled separately by connectDrive() below.
    if (!window.firebase || !auth) {
      console.warn('Firebase auth is not available — cloud sync is disabled.');
      return;
    }

    const provider = new window.firebase.auth.GoogleAuthProvider();

    try {
      await auth.signInWithPopup(provider);

      // If a proper Google Cloud OAuth client is configured, also connect Drive.
      if (getConfiguredDriveClientId()) {
        const ok = await connectDriveWithGis();
        if (ok) {
          try { window.dispatchEvent(new CustomEvent('lab:drive-connected')); } catch { /* ignore */ }
        }
      }
    } catch (e) {
      console.error('Google sign-in error:', e);
    }
  };

  // Connect Google Drive for uploads. Requires a configured Google Cloud
  // OAuth client — the standard Google sign-in cannot get Drive permission.
  const connectDrive = async () => {
    if (getConfiguredDriveClientId()) {
      const ok = await connectDriveWithGis();
      if (ok) {
        const verified = await testDriveAccess();
        if (verified) {
          try { window.dispatchEvent(new CustomEvent('lab:drive-connected')); } catch { /* ignore */ }
          alert('Google Drive connected ✓ — uploaded images/documents will be saved automatically to your Drive folder.');
        } else {
          clearDriveToken();
          try { window.dispatchEvent(new CustomEvent('lab:drive-disconnected')); } catch { /* ignore */ }
          alert('Google sign-in succeeded, but Google blocked Drive access. Check that the OAuth client has the drive.file scope enabled.');
        }
      } else {
        const origin = (() => { try { return window.location.origin || ''; } catch { return ''; } })();
        alert(
          'Google Drive sign-in was cancelled or failed. ' +
          (origin
            ? '\n\nIf Google shows “no registered origin / invalid_client”:\n' +
              '  1) In Google Cloud Console → APIs & Services → Credentials,\n' +
              '  2) open your Web OAuth client,\n' +
              '  3) add this to “Authorized JavaScript origins” (no trailing slash):\n' +
              `     ${origin}\n` +
              '  4) Save, then try Connect Drive again.'
            : 'Check that the OAuth client is a Web application client with the right authorized origins.')
        );
      }
      return;
    }

    // No OAuth client configured yet — explain exactly what is needed.
    alert(
      'Google Drive saving needs a Google Cloud OAuth client — the normal Google sign-in cannot get Drive permission from Google.\n\n' +
      'Please have the app owner:\n' +
      ' 1) enable the Google Drive API in Google Cloud Console,\n' +
      ' 2) create a Web OAuth Client ID for this app,\n' +
      ' 3) add scope https://www.googleapis.com/auth/drive.file,\n' +
      ' 4) paste the Client ID into GOOGLE_DRIVE_CLIENT_ID in src/data/constants.js.\n\n' +
      'Until then, uploaded files are stored locally and can be downloaded with the correct name.'
    );
  };

  // Let the DriveUpload component trigger the Drive connection from anywhere.
  useEffect(() => {
    const onConnectDrive = () => { connectDrive(); };
    window.addEventListener('lab:connect-drive', onConnectDrive);
    return () => window.removeEventListener('lab:connect-drive', onConnectDrive);
  }, []);

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
  }, [isCloudReady, currentDatasetId, needsLogin]);

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
          } catch {}

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
      } catch {}

      setIsCloudReady(true);
    }
  }, [user]);

  // ── Derived string array for backward-compatible child components ──
  // All child components (test renderers, LabNotebook, Storage, etc.) still
  // expect operators as plain strings. This is the safe list to pass them.
  const operatorNames = normalizeOperators(operators).map((op) => op.name);

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

  // ── WEEKLY HTML AUTOSAVE TO GOOGLE DRIVE ──────────────────────────────────
  // Every 7 days (checked on load, on Drive connect, and every few hours while
  // the app stays open) a full HTML backup of EVERY dataset is written to
  // <Lab Workspace>/backups/<title>_backup_<date>.html on Google Drive — the
  // same format the "Save HTML" button produces, so any backup file can be
  // re-imported with "Load HTML" if a dataset is ever lost or corrupted.
  const [backupStatus, setBackupStatus] = useState(null);
  const backupRunningRef = useRef(false);
  const datasetsListRef = useRef(datasetsList);
  datasetsListRef.current = datasetsList;
  const currentDatasetIdRef = useRef(currentDatasetId);
  currentDatasetIdRef.current = currentDatasetId;
  const datasetTitleRef = useRef(datasetTitle);
  datasetTitleRef.current = datasetTitle;
  const datasetSubtitleRef = useRef(datasetSubtitle);
  datasetSubtitleRef.current = datasetSubtitle;

  const buildBackupHtml = (title, subtitle, payload) => {
    const dataBlob = {
      payload,
      isCompressed: true,
      title: title || 'Untitled Dataset',
      subtitle: subtitle || '',
      savedAt: Date.now()
    };
    // Escape <, > and & as JSON escape sequences so the blob can never close
    // the <script> tag early (the payload is a large compressed string).
    const json = JSON.stringify(dataBlob)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026');
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>' + esc(title || 'Untitled Dataset') + ' — Lab Workspace backup</title></head>'
      + '<body style="font-family:sans-serif;color:#334155;padding:24px;max-width:760px">'
      + '<h2>🧪 ' + esc(title || 'Untitled Dataset') + ' — weekly backup</h2>'
      + '<p>Automatic backup generated by Lab Workspace on ' + esc(new Date().toLocaleString()) + '. To restore, open the app and choose “Load HTML”.</p>'
      + '<script type="application/json" id="saved-data-blob">' + json + '</script>'
      + '</body></html>';
  };

  const runWeeklyBackup = useCallback(async () => {
    if (backupRunningRef.current) return false;
    if (!getDriveToken()) { setBackupStatus({ state: 'skip', msg: 'Connect Google Drive to enable weekly backups' }); return false; }
    let last = 0;
    try { last = parseInt(localStorage.getItem(BACKUP_INTERVAL_KEY) || '0', 10) || 0; } catch {}
    if (last && Date.now() - last < WEEK_MS) return false; // already backed up this week

    backupRunningRef.current = true;
    try {
      const list = Array.isArray(datasetsListRef.current) ? datasetsListRef.current : [];
      if (list.length === 0) { setBackupStatus({ state: 'skip', msg: 'No datasets to back up yet' }); return false; }

      setBackupStatus({ state: 'running', msg: `Writing weekly backup (${list.length} dataset${list.length > 1 ? 's' : ''})…` });
      const dateStr = new Date().toISOString().slice(0, 10);
      let done = 0;
      let failed = 0;
      for (const dset of list) {
        try {
          if (!dset || !dset.payload) continue;
          const isCurrent = currentDatasetIdRef.current && String(dset.id) === String(currentDatasetIdRef.current);
          const payload = isCurrent ? getCompressedPayload() : dset.payload;
          const title = isCurrent
            ? (datasetTitleRef.current || dset.title || 'Untitled Dataset')
            : (dset.title || 'Untitled Dataset');
          const subtitle = isCurrent ? datasetSubtitleRef.current : (dset.subtitle || '');
          const html = buildBackupHtml(title, subtitle, payload);
          // A short dataset-id fragment guarantees two datasets with the same
          // title never overwrite each other's weekly backup.
          const idTag = String(dset.id || '').replace(/[^a-z0-9]/gi, '').slice(-6) || 'ds';
          const fname = `${sanitizeSlug(title) || 'dataset'}_${idTag}_backup_${dateStr}.html`;
          const res = await uploadWorkspaceFile({ name: fname, mimeType: 'text/html', file: new Blob([html], { type: 'text/html' }) });
          if (res) done++; else failed++;
        } catch (e) {
          failed++;
          console.warn('Weekly backup failed for a dataset:', e && e.message);
        }
      }
      if (done > 0) {
        try { localStorage.setItem(BACKUP_INTERVAL_KEY, String(Date.now())); } catch {}
        setBackupStatus({ state: 'ok', msg: `Weekly backup saved (${done} dataset${done > 1 ? 's' : ''}) → Lab Workspace/backups` });
        return true;
      }
      setBackupStatus(failed > 0 ? { state: 'error', msg: 'Weekly backup failed — check the Drive connection' } : { state: 'skip', msg: 'Nothing to back up' });
      return false;
    } catch (e) {
      console.error('Weekly backup error:', e);
      setBackupStatus({ state: 'error', msg: 'Weekly backup failed' });
      return false;
    } finally {
      backupRunningRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check on dataset-load and every few hours while the app is open, so the
  // weekly backup happens even if the user keeps the tab open across the
  // 7-day boundary or only connects Drive later.
  useEffect(() => {
    const due = (() => {
      try {
        const last = parseInt(localStorage.getItem(BACKUP_INTERVAL_KEY) || '0', 10) || 0;
        return !last || Date.now() - last >= WEEK_MS;
      } catch { return true; }
    })();
    if (due && (Array.isArray(datasetsList) ? datasetsList.length : 0) > 0 && getDriveToken()) runWeeklyBackup();
    const timer = setInterval(() => runWeeklyBackup(), 6 * 60 * 60 * 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetsList]);

  useEffect(() => {
    const onConnected = () => runWeeklyBackup();
    window.addEventListener('lab:drive-connected', onConnected);
    return () => window.removeEventListener('lab:drive-connected', onConnected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
// Firestore rejects a single document/field above ~1 MiB ("the value of
// property payload is longer than 1048487 bytes"). LZString's UTF-16 output is
// up to 3 bytes per char in UTF-8, so we stay well under the limit: if the
// compressed payload would be too large, drop the heavy legacy chart images
// (mdNotebookCharts) that no longer belong in the dataset document — the MD
// notebook now renders its figures from persisted data / sessionStorage.
const compressDatasetForSave = (raw) => {
  const compress = (data) => LZString.compressToUTF16(JSON.stringify(data));
  const sizeOf = (data) => compress(data).length * 3; // UTF-16 char -> max 3 UTF-8 bytes
  const budget = 900000; // Firestore field limit is 1048487 bytes; stay well under.
  if (sizeOf(raw) <= budget) return compress(raw);

  // Stage 1: drop the heavy legacy chart images (mdNotebookCharts) that no
  // longer belong in the dataset document — the MD notebook now renders its
  // figures from persisted data / sessionStorage.
  let cleaned = {
    ...raw,
    tests: (raw.tests || []).map((test) => {
      if (!test) return test;
      const clean = { ...test };
      delete clean.mdNotebookCharts;
      delete clean.chartSnapshots;
      return clean;
    })
  };
  if (sizeOf(cleaned) <= budget) return compress(cleaned);

  // Stage 2: the serialized FCS payloads (fcParsed / fcExtraFiles[].data) are
  // RECOVERABLE — the raw files are kept in the browser IndexedDB cache and in
  // Google Drive — so they are the first thing to drop. Removed one at a time
  // (largest first) so small files keep their fast restore path.
  {
    let guard = 0;
    while (sizeOf(cleaned) > budget && guard < 40) {
      guard++;
      let best = null; // { testIndex, kind, extraIdx, size }
      (cleaned.tests || []).forEach((test, ti) => {
        if (!test) return;
        if (typeof test.fcParsed === 'string' && (!best || test.fcParsed.length > best.size)) {
          best = { testIndex: ti, kind: 'main', size: test.fcParsed.length };
        }
        if (Array.isArray(test.fcExtraFiles)) {
          test.fcExtraFiles.forEach((f, ei) => {
            if (f && typeof f.data === 'string' && (!best || f.data.length > best.size)) {
              best = { testIndex: ti, kind: 'extra', extraIdx: ei, size: f.data.length };
            }
          });
        }
      });
      if (!best) break;
      if (best.kind === 'main') {
        cleaned.tests[best.testIndex].fcParsed = null;
      } else {
        const f = cleaned.tests[best.testIndex].fcExtraFiles[best.extraIdx];
        cleaned.tests[best.testIndex].fcExtraFiles[best.extraIdx] = { ...f, data: null };
      }
    }
  }
  if (sizeOf(cleaned) <= budget) return compress(cleaned);

  // Stage 3: iteratively drop the LARGEST base64 images embedded in notebook
  // `comments` until the payload fits (a single image below 40 KB may still
  // overflow when there are many of them). Each dropped image is replaced with
  // a placeholder note, so no content is ever silently lost from the document.
  let guard = 0;
  while (sizeOf(cleaned) > budget && guard < 40) {
    guard++;
    let target = null; // { testId, len, img }
    cleaned.tests.forEach((test) => {
      if (!test || typeof test.comments !== 'string' || !test.comments.includes('data:image')) return;
      const imgs = test.comments.match(/<img[^>]*src="data:image\/[a-z0-9+/]+;base64,[^"]+"[^>]*>/gi) || [];
      imgs.forEach((img) => {
        if (!target || img.length > target.len) target = { testId: test.id, len: img.length, img };
      });
    });
    if (!target) break;
    cleaned.tests = (cleaned.tests || []).map((test) => {
      if (test.id !== target.testId || typeof test.comments !== 'string') return test;
      return { ...test, comments: test.comments.replace(target.img, '<p style="color:#94a3b8;">[large image omitted from saved notebook — re-run the analysis to re-append]</p>') };
    });
  }
  if (sizeOf(cleaned) <= budget) return compress(cleaned);

  // Stage 4: cap the largest analysis arrays (MD time series). The notebook
  // re-renders figures from data and the per-atom table already holds the
  // imported per-atom values.
  cleaned.tests = (cleaned.tests || []).map((test) => {
    if (!test) return test;
    const clean = { ...test };
    if (clean.mdAnalysisResult && typeof clean.mdAnalysisResult === 'object') {
      Object.entries(clean.mdAnalysisResult).forEach(([k, v]) => {
        if (Array.isArray(v) && v.length > 400) clean.mdAnalysisResult[k] = v.slice(0, 400);
      });
    }
    return clean;
  });
  if (sizeOf(cleaned) <= budget) return compress(cleaned);

  // Stage 5 (guarantee — the save must NEVER fail): iteratively drop the
  // heaviest binary/data values left in ANY experiment page — long base64
  // blobs (attachments, documents, images) and big numeric arrays (spectra) —
  // replacing each with a small marker. This is the safety net that keeps the
  // dataset writable no matter how much data an experiment accumulates; the
  // marker tells the affected page the value was omitted for size. Notebook
  // `comments` are never touched here (their images are handled in Stage 3).
  const isFiniteNumber = (x) => typeof x === 'number' && Number.isFinite(x);
  const isBigNumericArray = (v) => Array.isArray(v) && v.length > 400 && v.every(isFiniteNumber);
  const approxSizeOf = (v) => {
    if (typeof v === 'string') return v.length;
    if (typeof v === 'number') return 8;
    if (Array.isArray(v)) { let s = 0; for (let i = 0; i < v.length; i++) s += approxSizeOf(v[i]); return s; }
    if (v && typeof v === 'object') { let s = 0; for (const k in v) s += approxSizeOf(v[k]); return s; }
    return 4;
  };
  const collectHeavy = (node, path, out) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      if (isBigNumericArray(node)) { out.push({ path, size: node.length * 8 }); return; }
      for (let i = 0; i < node.length; i++) {
        const v = node[i];
        if (v && typeof v === 'object') collectHeavy(v, `${path}[${i}]`, out);
        else if (typeof v === 'string' && v.length > 20000) out.push({ path: `${path}[${i}]`, size: v.length });
      }
      return;
    }
    const vals = Object.values(node);
    if (vals.length) {
      const heavyNumeric = vals.filter(isBigNumericArray).length;
      const heavyStrings = vals.filter((v) => typeof v === 'string' && v.length > 20000).length;
      // Drop the object as a single unit only when it is essentially pure data:
      // a spectrum ({xs, ys}) or a blob whose every child is a huge string.
      const unitDroppable =
        (heavyNumeric > 0 && heavyNumeric >= Math.min(2, Math.ceil(vals.length / 2))) ||
        (heavyStrings === vals.length && vals.length > 0);
      if (unitDroppable) {
        const total = approxSizeOf(node);
        if (total > 50000) { out.push({ path, size: total }); return; }
      }
    }
    Object.keys(node).forEach((k) => {
      if (k === 'comments') return; // user notebook text is never dropped here
      const v = node[k];
      if (v && typeof v === 'object') collectHeavy(v, path ? `${path}.${k}` : k, out);
      else if (typeof v === 'string' && v.length > 20000) out.push({ path: path ? `${path}.${k}` : k, size: v.length });
    });
  };
  const setByPath = (root, path, value) => {
    if (!root) return;
    const segs = [];
    const re = /([^.[\]]+)|\[(\d+)\]/g;
    let m;
    while ((m = re.exec(path))) segs.push(m[2] !== undefined ? Number(m[2]) : m[1]);
    let cur = root;
    for (let i = 0; i < segs.length - 1; i++) {
      if (cur == null || typeof cur !== 'object') return;
      cur = cur[segs[i]];
    }
    if (cur == null || typeof cur !== 'object') return;
    cur[segs[segs.length - 1]] = value;
  };
  {
    let guard = 0;
    while (sizeOf(cleaned) > budget && guard < 60) {
      guard++;
      let best = null;
      (cleaned.tests || []).forEach((test, ti) => {
        if (!test || typeof test !== 'object') return;
        const out = [];
        collectHeavy(test, '', out);
        out.forEach((c) => { if (!best || c.size > best.size) best = { testIndex: ti, path: c.path, size: c.size }; });
      });
      if (!best) break;
      const label = (best.path.split(/[.[\]]/).filter(Boolean).pop() || 'data');
      setByPath(cleaned.tests[best.testIndex], best.path, `[${label} omitted — kept in browser cache / Drive or re-uploadable]`);
    }
  }
  return compress(cleaned);
};
useEffect(() => {
  if (!isCloudReady || appView !== 'dataset' || !currentDatasetId) return;
  setSaveStatus('saving');
  if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
  saveTimeoutRef.current = setTimeout(async () => {
    try {
      const rawData = latestDataRef.current;
      // Compress payload to prevent Firestore 1MB limit and write stream exhaustion
      const compressedPayload = compressDatasetForSave(rawData);

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
        } catch {}
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
      if (s.testCategories !== undefined) setTestCategories(sanitizeTestCategories(s.testCategories, loadedTests));
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
      } catch {}

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
      const compressedPayload = compressDatasetForSave(rawData);
      
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
        } catch {}
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
      setSaveStatus('error');
      setSaveErrorMsg(e.message || String(e));
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
        dset.title && String(dset.title).trim()
          ? dset.title
          : s.datasetTitle !== undefined
          ? s.datasetTitle
          : s.reportTitle !== undefined
          ? s.reportTitle
          : 'Untitled'
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
      
   setTestCategories(sanitizeTestCategories(s.testCategories, loadedTests));

      setProtocolCategories(
        s.protocolCategories || ['Preparation', 'Measurement', 'Analysis']
      );

      setDatasetProtocols(s.datasetProtocols || []);
      setStorages(migrated.storages);

      setCurrentDatasetId(dset.id);
      setAppView('dataset');
      setCurrentModule('dashboard');

      window.history.pushState({}, '', '?dataset=' + dset.id);
    } catch {
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
          } catch {}

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
            } catch {}

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
        } catch {
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
          } catch {}

          const emptyIds = emptyDatasets.map((d) => d.id);

          stored = stored.filter((d) => !emptyIds.includes(d.id));

          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stored));
          setDatasetsList(stored);
        }
      }
    });
  };

  // Deletion is intentionally NOT available from the start page: for safety,
  // data can only be deleted from Settings → Database Cleanup & Data
  // management. Any delete request from the start page warns and redirects there.
  const redirectDeleteToSettings = (e, label) => {
    if (e && e.stopPropagation) e.stopPropagation();

    setDialog({
      type: 'confirm',
      title: '⚠️ Deletion only in Settings',
      message: `“${label}” cannot be deleted from the start page.\n\nFor safety, data deletion is only possible in the “Settings → Database Cleanup & Data management” section.\n\nOpen that section now?`,
      onConfirm: () => setCurrentModule('settings')
    });
  };

  const [expandedGroups, setExpandedGroups] = useState({});

  // Recent datasets, newest first. The landing page shows them as a simple flat
  // list of cards (each with its own title) — no category-group headers like
  // "Activity, Blind Docking, CD".
  const flatDatasets = useMemo(() => {
    const list = Array.isArray(datasetsList) ? datasetsList : [];
    return [...list].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
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
    // Remember where we came from so the test page's "◀ Back" button can
    // return there (e.g. a project detail page instead of the test list).
    if (currentModule !== 'active-test') {
      setReturnTarget({
        module: currentModule,
        projectId: currentProjectId,
        storageId: activeStorageId
      });
    }
    setActiveTestId(testId);
    setCurrentModule('active-test');

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

              <p className="text-sm text-slate-600 mb-4 whitespace-pre-line">{dialog.message}</p>

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
                  {/* Delete Empty — superuser only (warns + redirects to Settings) */}
                  {currentUser?.role === 'superuser' && (
                    <button
                      onClick={(e) => redirectDeleteToSettings(e, 'Delete Empty Datasets')}
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

              {isCloudReady && flatDatasets.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-md flex flex-col items-center gap-3">
                  <span className="text-4xl opacity-30">📂</span>
                  <span>No datasets found in cloud or local storage.</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                  {flatDatasets.map((dset) => (
                    <div
                      key={dset.id}
                      onClick={() => openDataset(dset)}
                      className="bg-white border border-slate-200 hover:border-blue-400 hover:shadow-md p-3 rounded-lg cursor-pointer flex justify-between items-center transition-all group/item"
                    >
                      <div className="flex flex-col overflow-hidden">
                        <span className="font-bold text-sm text-blue-700 truncate">
                          {dset.title || 'Untitled'}
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
                              renameDataset(e, dset.id, dset.title || 'Untitled')
                            }
                            className="text-slate-500 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded text-xs font-bold transition-colors text-right"
                          >
                            Rename
                          </button>

                          <button
                            onClick={(e) => redirectDeleteToSettings(e, dset.title || 'Untitled')}
                            className="text-slate-500 hover:text-red-600 hover:bg-red-50 px-2 py-1 rounded text-xs font-bold transition-colors text-right"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
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
            backupStatus={backupStatus}
            currentUser={currentUser} setCurrentUser={setCurrentUser}
            setUnlockedTestIds={setUnlockedTestIds} setLoginModal={setLoginModal}
            currentModule={currentModule} setCurrentModule={setCurrentModule}
            handlePrint={handlePrint} loadHTML={loadHTML} exportHTML={exportHTML}
            handleUndo={handleUndo} handleRedo={handleRedo}
            historyIndex={historyIndex} historyRef={historyRef}
            user={user} onGoogleLogin={handleManualLogin}
            onConnectDrive={connectDrive}
          />

          {/* MAIN CONTENT */}
          <div className="flex-1 flex flex-col bg-slate-50 h-full overflow-hidden relative">
            {currentModule === 'dashboard' && (<DashboardModule
              datasetTitle={datasetTitle} setDatasetTitle={setDatasetTitle}
              datasetSubtitle={datasetSubtitle}
              handlePrint={handlePrint} tests={tests} setTests={setTests} storages={storages}
              setCurrentModule={setCurrentModule} mergedPlan={mergedPlan}
            />)}

            {currentModule === 'projects' && (<ProjectsModule
              currentUser={currentUser} operatorNames={operatorNames} handlePrint={handlePrint}
              setCurrentModule={setCurrentModule} setCurrentProjectId={setCurrentProjectId}
            />)}
            {currentModule === 'project-detail' && (<ProjectDetailModule
              currentUser={currentUser} setCurrentModule={setCurrentModule}
              currentProjectId={currentProjectId} setCurrentProjectId={setCurrentProjectId}
              createEmptyTest={createEmptyTest} tests={tests} setTests={setTests}
              setActiveTestId={setActiveTestId} jumpToTest={jumpToTest}
              operatorNames={operatorNames}
            />)}

            {currentModule === 'library' && (<LibraryModule
              allCmpds={allCmpds} setActiveLibrarySelection={setActiveLibrarySelection} activeLibrarySelection={activeLibrarySelection}
              allCellLines={allCellLines}
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
            />)}

            {currentModule === 'settings' && (<SettingsModule
              customFields={customFields}
              mandatoryRules={mandatoryRules} setMandatoryRules={setMandatoryRules}
              mandatoryBehavior={mandatoryBehavior} setMandatoryBehavior={setMandatoryBehavior}
              operators={operators} setOperators={setOperators}
              authSettings={authSettings} setAuthSettings={setAuthSettings}
              currentUser={currentUser} tests={tests} setTests={setTests} handleSetCustomFields={handleSetCustomFields}
              allCmpds={allCmpds} allCellLines={allCellLines}
              setCustomCmpds={setCustomCmpds} setCompoundMeta={setCompoundMeta} compoundMeta={compoundMeta}
              setCustomCellLines={setCustomCellLines} setCellLineMeta={setCellLineMeta} cellLineMeta={cellLineMeta}
              datasetsList={datasetsList} deleteDataset={deleteDataset} deleteEmptyDatasets={deleteEmptyDatasets}
              datasetTitle={datasetTitle}
            />)}

            {currentModule === 'agenda' && (<AgendaModule
              currentUser={currentUser} agendaOpFilter={agendaOpFilter} setAgendaOpFilter={setAgendaOpFilter}
              operatorNames={operatorNames} mergedPlan={mergedPlan}
              calFilterDate={calFilterDate} setCalFilterDate={setCalFilterDate}
              agendaGrouped={agendaGrouped} jumpToTest={jumpToTest}
              currentMonth={currentMonth} monthName={monthName} startDayOffset={startDayOffset} totalDays={totalDays}
              handlePrevMonth={handlePrevMonth} handleNextMonth={handleNextMonth} handlePrint={handlePrint}
            />)}

            <StorageModule
              currentModule={currentModule} tests={tests} setTests={setTests} storages={storages} setStorages={setStorages}
              operatorNames={operatorNames} setActiveTestId={setActiveTestId} setCurrentModule={setCurrentModule}
              setActiveStorageId={setActiveStorageId} setStorageModal={setStorageModal}
              handlePrint={handlePrint} activeStorageId={activeStorageId}
              jumpToTest={jumpToTest} setMoveModal={setMoveModal} createEmptyTest={createEmptyTest}
            />

            {currentModule === 'tests' && (<TestsModule
              authSettings={authSettings} createEmptyTest={createEmptyTest} currentUser={currentUser}
              expandedGroups={expandedGroups} handlePrint={handlePrint}
              setActiveTestId={setActiveTestId} setCurrentModule={setCurrentModule} setCurrentUser={setCurrentUser}
              setExpandedGroups={setExpandedGroups} setLoginModal={setLoginModal}
              setTestCategories={setTestCategories} setTests={setTests} testCategories={testCategories}
              tests={tests} unlockedTestIds={unlockedTestIds}
              allCellLines={allCellLines} allCmpds={allCmpds} operatorNames={operatorNames} plasmidMeta={plasmidMeta}
              solvents={solvents} buffers={buffers} additives={additives}
              nmrInstruments={nmrInstruments} nmrProbes={nmrProbes} nmrExperiments={nmrExperiments}
            />)}
            {currentModule === 'protocols' && (<ProtocolsModule
              datasetProtocols={datasetProtocols} expandedGroups={expandedGroups} handlePrint={handlePrint}
              nmrExperiments={nmrExperiments} operatorNames={operatorNames} currentUser={currentUser}
              protocolCategories={protocolCategories}
              setActiveLibrarySelection={setActiveLibrarySelection}
              setActiveTestId={setActiveTestId} setCurrentModule={setCurrentModule}
              setDatasetProtocols={setDatasetProtocols} setExpandedGroups={setExpandedGroups}
              setProtocolCategories={setProtocolCategories}
              tests={tests}
            />)}
            {currentModule === 'active-test' && (<ActiveTestModule
              activeTestId={activeTestId} additives={additives} allCellLines={allCellLines} allCmpds={allCmpds}
              appClipboard={appClipboard} buffers={buffers} cmpColors={cmpColors} compoundMeta={compoundMeta}
              currentUser={currentUser} customCmpds={customCmpds} customConc={customConc} customFields={customFields}
              datasetProtocols={datasetProtocols} expandedGroups={expandedGroups} jumpToTest={jumpToTest}
              mandatoryBehavior={mandatoryBehavior} mandatoryRules={mandatoryRules} molecules={molecules}
              nmrExperiments={nmrExperiments} nmrInstruments={nmrInstruments} nmrProbes={nmrProbes}
              operatorNames={operatorNames} plasmidMeta={plasmidMeta} returnTarget={returnTarget}
              setActiveStorageId={setActiveStorageId} setReturnTarget={setReturnTarget}
              setActiveTestId={setActiveTestId} setAppClipboard={setAppClipboard} setCmpColors={setCmpColors}
              setCurrentModule={setCurrentModule} setCurrentProjectId={setCurrentProjectId}
              setCustomCmpds={setCustomCmpds} setCustomConc={setCustomConc}
              setExpandedGroups={setExpandedGroups} setMoveModal={setMoveModal} setTests={setTests}
              solvents={solvents} storages={storages} testCategories={testCategories} tests={tests}
              unlockedTestIds={unlockedTestIds} MDTestRenderer={MDTestRenderer}
            />)}
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
