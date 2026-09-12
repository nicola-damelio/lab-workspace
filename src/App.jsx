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
import { AdministrationModule } from './administration/adminModule';
import { isAdministrationKind, createAdministrationSeed, ADMIN_PAGES, adminCanViewPage, hasDefinedSuperuser } from './administration/adminSchema';
import { StorageModule } from './components/AppModules/storageModuleViews';
import { TestsModule } from './components/AppModules/testsModule';
import { ProtocolsModule } from './components/AppModules/protocolsModule';
import { ActiveTestModule } from './components/AppModules/activeTestModule';
// Contexte des sections repliables : les sections de la page d'expérience
// mémorisent leur état ouvert/fermé PAR EXPÉRIENCE (voir src/components/ui.jsx).
import { SectionsScope } from './components/ui';
import { NotebookModule, CalculationsModule, PublicationsModule, ImageBuilderModule } from './components/AppModules/miscModules';
import { ProjectsModule, loadProjects, saveProjects, mergeProjectsFromCloud, setProjectDatasetScope, removeProjectsOfDataset } from './components/AppModules/projectsModule';
import { ProjectDetailModule } from './components/AppModules/projectDetailModule';
import {normalizeOperators} from './utils/auth';
import { setActiveProjectId, readLibrary, readAllProjectLibraries, restoreLibraryFromSnapshot } from './utils/figuresLibrary';
import { clearDriveToken, testDriveAccess, getConfiguredDriveClientId, connectDriveWithGis, sharedWorkspaceMode, getWorkspaceServerIssue, getLastDriveConnectError, driveBootstrapRequestedAtLoad, setDriveRootContext, ensureDriveFolder, getDriveToken, uploadWorkspaceFile, cleanupWorkspaceRootFolders } from './utils/driveUpload';
import { sanitizeSlug, datasetFolderSlug } from './utils/driveNaming';
import { validateDatasetExperiments } from './utils/experimentRules';
import {
  loadSectionsOf, defaultSelection, sectionGroupsOf, filterLoadState,
  selectionHasTests, selectionIsComplete, describeCount,
} from './utils/loadSelection';
import { canUserOpenDataset, isDatasetRestricted, normalizeMemberNames, datasetAccessOf } from './utils/datasetAccess';
import {
  authServerConfigured, fetchAuthStatus, fetchRoster, serverLogin,
  publishAccounts, applyServerSession, clearFirebaseSession, serverAdminToken
} from './utils/labAuth';

import { ScientistLoginGate, ScientistLoginModal } from './components/AppModules/definitionsManagers';
import { DatasetAccessModal } from './components/AppModules/datasetAccessModal';




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
// Full HTML backups of every dataset are written to
// <Lab Workspace>/<dataset>/backups/ on Google Drive once a week. The key
// stores the timestamp of the last run.
const BACKUP_INTERVAL_KEY = 'labLastWeeklyBackup';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/* =========================================================
MAIN APP
========================================================= */

/** URL "?dataset=<id>" for the address bar, preserving the owner's one-time
 *  "?drive-bootstrap=1" marker when the app opens/restores a dataset (the
 *  pushState rewrite would otherwise drop it before the bootstrap is done). */
const datasetHref = (datasetId) => {
  let qs = 'dataset=' + encodeURIComponent(String(datasetId));
  try {
    if (new URLSearchParams(window.location.search).has('drive-bootstrap')) {
      qs += '&drive-bootstrap=1';
    }
  } catch { /* ignore */ }
  return '?' + qs;
};

/* -------------------------------------------------------------------------
   « OÙ J'ÉTAIS » — dernière expérience ouverte.

   Quitter une page d'expérience (pour consulter la Library, les Projects, le
   Lab Notebook…) la démonte : il fallait retrouver le chemin (Projects →
   projet → expérience) pour y revenir. On mémorise donc, PAR BASE, la
   dernière expérience ouverte — id + nom (et le nom de la condition en cours)
   — pour que la barre latérale propose « ↩ Retour à l'expérience » en un clic.
   sessionStorage : la mémoire vaut pour l'onglet courant et survit à un
   rechargement, sans polluer durablement le poste.
   ------------------------------------------------------------------------- */
const lastExperimentKey = (datasetId) => `labLastExperiment_${datasetId || 'global'}`;

const readLastExperiment = (datasetId) => {
  try {
    const raw = JSON.parse(sessionStorage.getItem(lastExperimentKey(datasetId)) || 'null');
    if (raw && typeof raw === 'object' && raw.id) return raw;
  } catch { /* ignore */ }
  return null;
};

const writeLastExperiment = (datasetId, payload) => {
  try {
    sessionStorage.setItem(lastExperimentKey(datasetId), JSON.stringify(payload));
  } catch { /* ignore */ }
};

/* =========================================================================
   « Load HTML » — panneau de sélection des éléments à importer.
   Un fichier de sauvegarde peut contenir plusieurs pages : ce panneau laisse
   cocher EXACTEMENT ce qu’on veut importer (« quel élément de quelle page »),
   avec par page « Tout / Rien » et, globalement, « Tout sélectionner ».
   ========================================================================= */
const LoadPickPanel = ({ sections, picked, onToggle, onPickMany }) => {
  const groups = sectionGroupsOf(sections);
  const isOn = (id) => picked.indexOf(id) !== -1;
  const groupIds = (g) => g.items.map((s) => s.id);
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
        <span className="text-[11px] font-black text-slate-500 uppercase tracking-wide">
          Elements to import ({picked.length}/{sections.length})
        </span>
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPickMany(sections.map((s) => s.id), true)}
            className="text-[10px] font-black text-blue-700 hover:underline"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => onPickMany(sections.map((s) => s.id), false)}
            className="text-[10px] font-black text-slate-500 hover:underline"
          >
            Clear all
          </button>
        </span>
      </div>
      <div className="max-h-[46vh] overflow-y-auto divide-y divide-slate-100">
        {groups.map((g) => (
          <div key={g.page || '_flat'} className="px-3 py-2">
            {g.page ? (
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-[11px] font-black text-slate-600">{g.page}</span>
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onPickMany(groupIds(g), true)}
                    title={`Import every element of « ${g.page} »`}
                    className="text-[10px] font-bold text-blue-700 hover:underline"
                  >
                    import all
                  </button>
                  <button
                    type="button"
                    onClick={() => onPickMany(groupIds(g), false)}
                    title={`Import nothing from « ${g.page} »`}
                    className="text-[10px] font-bold text-slate-400 hover:underline"
                  >
                    none
                  </button>
                </span>
              </div>
            ) : null}
            <div className="flex flex-col gap-1">
              {g.items.map((s) => (
                <label key={s.id} className="flex items-start gap-2 cursor-pointer rounded-lg px-1.5 py-1 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    className="accent-blue-600 mt-0.5"
                    checked={isOn(s.id)}
                    onChange={(e) => onToggle(s.id, e.target.checked)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold text-slate-700 leading-tight">{s.label}</span>
                    <span className="block text-[10px] text-slate-400 leading-tight">{describeCount(s)}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

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
  // Where the last successful save went: 'cloud' (shared Firestore workspace) or
  // 'local' (this device only, used when Firestore is unreachable). The sidebar
  // status must not claim "Cloud Sync" when the data never left the device.
  const [saveTarget, setSaveTarget] = useState('cloud');
  const [appView, setAppView] = useState('explorer');
  const [currentModule, setCurrentModule] = useState('dashboard');
  const [currentProjectId, setCurrentProjectId] = useState(null);
  // Saved Image Builder canvas the builder must load on its next mount. Set by
  // the "🖼 Saved canvases" links on a project page ({ projectId, canvasId }) and
  // cleared by the builder as soon as it has opened it — see openImageBuilder.
  const [pendingCanvas, setPendingCanvas] = useState(null);
  const [datasetsList, setDatasetsList] = useState([]);
  const [currentDatasetId, setCurrentDatasetId] = useState(null);
  // Type de la base actuellement ouverte : 'scientific' (par défaut, toute la
  // pile expériences) ou 'administration' (base d’administration dont tout le
  // contenu vit dans le document du dataset, sous la clé payload
  // `administration`). Ce type est persisté sur l’enregistrement du dataset
  // sous la clé `kind`.
  const [activeDatasetKind, setActiveDatasetKind] = useState('scientific');
  // Objet payload de la base d’administration ouverte (listes + settings).
  const [adminContent, setAdminContent] = useState(null);
  // Page active de la base d’administration ouverte — pilotée par la barre
  // latérale (structure identique aux modules d’un dataset scientifique).
  const [currentAdminPage, setCurrentAdminPage] = useState('overview');
  // Cible de navigation inter-pages d’administration (ex. Dépenses → Librerie
  // avec un fournisseur précis à mettre en évidence). Format :
  // { pageId, kind, recordId } — consommée par la page d’arrivée puis effacée.
  const [adminFocus, setAdminFocus] = useState(null);
  // Historique « Undo » du contenu de la base d’administration ouverte : chaque
  // commit d’une page (AdminContext → onChange → setAdminContent) empile un
  // instantané complet du payload `administration` — même logique que
  // l’historique des tests scientifiques. Indice -1 = aucun historique (aucune
  // base d’administration n’est ouverte / vient d’être réinitialisée).
  const adminHistoryRef = useRef([]);
  const [adminHistoryIndex, setAdminHistoryIndex] = useState(-1);
  // Dernier contenu connu (sérialisé) + base à laquelle il appartient : sert à
  // détecter un vrai changement (nouvel instantané) vs l’ouverture/le seed.
  const adminHistorySnapshotRef = useRef('');
  const adminHistoryDatasetRef = useRef(null);
  // Pile des pages d’administration visitées (bouton « ← Retour » de l’en-tête
  // du module) : on retient la page précédente à chaque navigation réelle.
  const [adminPageStack, setAdminPageStack] = useState([]);

  // Réinitialise l’historique (Undo) et la pile de navigation (Back) quand on
  // change de base ou qu’on la referme. L’ouverture d’une base est le nouveau
  // point de départ : on n’annule pas « avant » l’ouverture.
  const resetAdminNavHistory = () => {
    adminHistoryRef.current = [];
    setAdminHistoryIndex(-1);
    adminHistorySnapshotRef.current = '';
    adminHistoryDatasetRef.current = null;
    setAdminPageStack([]);
  };
  const [dialog, setDialog] = useState(null);
  const [pendingLoad, setPendingLoad] = useState(null);
  /* Éléments (pages / sections) COCHÉS pour l’import en cours : « Load HTML »
     peut n’importer qu’une partie du fichier — par exemple les seules fiches
     Personnel, ou les seuls OM prévus, sans toucher au reste du dataset. */
  const [loadPick, setLoadPick] = useState(null);
  /* Éléments proposés / cochés de l’import en cours (voir LoadPickPanel). */
  const loadSections = (pendingLoad && Array.isArray(pendingLoad.sections)) ? pendingLoad.sections : [];
  const loadPicked = Array.isArray(loadPick) ? loadPick : defaultSelection(loadSections);
  const toggleLoadPick = (id, on) => setLoadPick((prev) => {
    const cur = Array.isArray(prev) ? prev : [];
    if (on) return cur.indexOf(id) === -1 ? [...cur, id] : cur;
    return cur.filter((x) => x !== id);
  });
  const pickManyLoad = (ids, on) => setLoadPick((prev) => {
    const cur = Array.isArray(prev) ? prev : [];
    if (on) return [...new Set([...cur, ...ids])];
    return cur.filter((x) => ids.indexOf(x) === -1);
  });
  // Dataset dont le superutilisateur édite la liste d’accès (bouton « 👥
  // Membres » sur une carte de l’écran d’accueil).
  const [accessEditorDataset, setAccessEditorDataset] = useState(null);
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
    setDriveRootContext({
      id: currentDatasetId || '',
      name: datasetTitle || '',
      kind: isAdministrationKind(activeDatasetKind) ? 'administration' : 'scientific',
    });
    if (!currentDatasetId || !getDriveToken()) return;
    if (driveRenameTimeoutRef.current) clearTimeout(driveRenameTimeoutRef.current);
    driveRenameTimeoutRef.current = setTimeout(() => {
      ensureDriveFolder().catch(() => {});
    }, 800);
    return () => {
      if (driveRenameTimeoutRef.current) clearTimeout(driveRenameTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDatasetId, datasetTitle, activeDatasetKind]);
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
  // ── AUTHENTIFICATION SERVEUR (voir src/utils/labAuth.js + docs/SECURITY-SETUP.md)
  // `serverAuth.ready` = le serveur de jetons vérifie les mots de passe ET
  // l'équipe y est publiée : dans ce cas la session Firebase devient
  // obligatoire (les règles Firestore ne répondent qu'à un jeton signé).
  // `serverRoster` = liste des membres (nom + rôle, SANS mot de passe) servie
  // par le serveur pour remplir la liste déroulante avant toute connexion.
  const [serverAuth, setServerAuth] = useState({
    checked: false, configured: false, accounts: 0, ready: false, adminPushEnabled: false, lastError: ''
  });
  const [serverRoster, setServerRoster] = useState([]);
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
  const [driveBootstrapOpen, setDriveBootstrapOpen] = useState(false);
  const [driveBootstrapBusy, setDriveBootstrapBusy] = useState(false);
  const [driveBootstrapError, setDriveBootstrapError] = useState('');
  const dismissDriveBootstrapRef = useRef(false);
  const [storages, setStorages] = useState([]);
  const [activeStorageId, setActiveStorageId] = useState(null);
  // Where the user came from before opening a test page (used by the active
  // test's "◀ Back" button), e.g. { module: 'project-detail', projectId }.
  const [returnTarget, setReturnTarget] = useState(null);
  // Dernière expérience ouverte de cette base (voir readLastExperiment
  // ci-dessus) : alimente le bouton « ↩ Retour à l'expérience » de la barre
  // latérale, disponible depuis n'importe quelle autre page.
  const [lastOpenedTest, setLastOpenedTest] = useState(() => readLastExperiment(currentDatasetId));
  const [storageModal, setStorageModal] = useState(null);
  const [moveModal, setMoveModal] = useState(null);

  // Keep the Figures & Slides module aware of the active project so exports
  // (e.g. the molecule viewer's "📷 Figure") land in the project library.
  useEffect(() => {
    setActiveProjectId(currentProjectId);
  }, [currentProjectId]);
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
  // Miroir de `tests` lu par l'effet « dernière expérience ouverte » : évite de
  // le relancer à chaque frappe (le tableau change à chaque édition du nom).
  const testsRef = useRef(tests);
  testsRef.current = tests;

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

  // ── « OÙ J'ÉTAIS » : mémoire de la dernière expérience ouverte ───────────
  // 1) Chaque fois qu'on ouvre un dataset, on relit la mémoire de CETTE base
  //    (sessionStorage, clé par dataset) — la mémoire suit donc l'onglet et
  //    survit à un rechargement de page.
  useEffect(() => {
    setLastOpenedTest(readLastExperiment(currentDatasetId));
  }, [currentDatasetId]);

  // 2) Chaque fois qu'une expérience est à l'écran, on mémorise son id, son nom
  //    et la condition (instance) en cours : c'est ce que le bouton « ↩ Retour
  //    à l'expérience » rouvrira, exactement sur la même condition.
  //    On lit le test via une ref pour ne PAS relancer cet effet à chaque
  //    frappe (l'édition du nom change le tableau `tests` à chaque fois).
  useEffect(() => {
    if (currentModule !== 'active-test' || !activeTestId) return;
    const t = testsRef.current.find((x) => x.id === activeTestId);
    if (!t) return;
    const payload = {
      id: t.id,
      name: t.name || t.instanceName || 'Experiment',
      instanceName: t.instanceName || '',
      at: Date.now(),
    };
    setLastOpenedTest((prev) =>
      prev && prev.id === payload.id && prev.name === payload.name && prev.instanceName === payload.instanceName
        ? prev
        : payload
    );
    writeLastExperiment(currentDatasetId, payload);
  }, [currentModule, activeTestId, currentDatasetId]);

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

  // ── HISTORIQUE UNDO DE LA BASE D’ADMINISTRATION ──────────────────────────
  // Enregistre un instantané à chaque vrai changement du payload
  // `administration`. Après une réinitialisation (resetAdminNavHistory → base
  // inconnue/null), on ré-ensemence la pile sur le contenu chargé : l’indice
  // retombe à 0 et le bouton « Annuler » reste inactif tant qu’aucune
  // modification n’a été faite dans cette session.
  useEffect(() => {
    if (!currentDatasetId || activeDatasetKind !== 'administration') return;
    if (!adminContent || typeof adminContent !== 'object') return;
    const json = JSON.stringify(adminContent);
    if (adminHistoryDatasetRef.current !== currentDatasetId) {
      adminHistoryDatasetRef.current = currentDatasetId;
      adminHistorySnapshotRef.current = json;
      adminHistoryRef.current = [adminContent];
      setAdminHistoryIndex(0);
      return;
    }
    if (adminHistorySnapshotRef.current === json) return;
    const nextHistory = adminHistoryRef.current.slice(0, adminHistoryIndex + 1);
    nextHistory.push(adminContent);
    if (nextHistory.length > 50) nextHistory.shift();
    adminHistoryRef.current = nextHistory;
    setAdminHistoryIndex(nextHistory.length - 1);
    adminHistorySnapshotRef.current = json;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminContent, activeDatasetKind, currentDatasetId, adminHistoryIndex]);

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
  // La copie distante a-t-elle été lue ? Tant que non, on n'écrit RIEN : un
  // navigateur neuf (cache local vide) écrasait sinon la liste des comptes du
  // cloud par une liste vide, ce qui supprimait l'écran de connexion pour
  // TOUTE l'équipe (et ouvrait l'accès à tout le monde). Le cloud fait foi.
  const [cloudAppConfigRead, setCloudAppConfigRead] = useState(false);
  const cloudHasAccountsRef = useRef(false);
  useEffect(() => {
    // NO Google/Firebase sign-in required: the whole team shares ONE workspace,
    // so cloud persistence starts as soon as the Firestore SDK is available.
    if (!db) return;
    // Avec l'authentification serveur active, aucune écriture sans session.
    if (serverAuth.ready && !user) return;
    // Protection anti-effacement (voir ci-dessus).
    if (!cloudAppConfigRead) return;
    if (!normalizeOperators(operators).length && cloudHasAccountsRef.current) {
      console.warn('Écriture annulée : liste de comptes locale vide alors que le cloud en contient — protection anti-effacement.');
      return;
    }
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
  }, [operators, authSettings, user, serverAuth.ready, cloudAppConfigRead]);
  // ─────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!auth) {
      setIsCloudReady(true);
      return undefined;
    }

    // ── SESSION FIREBASE = IDENTITÉ RÉELLE ──────────────────────────────────
    // Le mot de passe est vérifié par le serveur de jetons (server/), qui signe
    // un jeton Firebase portant les revendications « lab », nom et rôle : c'est
    // ce jeton que les règles Firestore (firestore.rules) exigent. On ne
    // déconnecte donc plus le visiteur au chargement — on ÉCOUTE l'état
    // d'authentification et on reconstruit l'identité depuis ces revendications
    // signées (donc non falsifiables via localStorage / la console).
    setIsCloudReady(true);
    setNeedsLogin(false);

    const unsubscribe = auth.onAuthStateChanged(async (fbUser) => {
      setIsCloudReady(true);
      setNeedsLogin(false);
      if (!fbUser) { setUser(null); return; }
      setUser(fbUser);
      try {
        const tokenResult = await fbUser.getIdTokenResult();
        const claims = (tokenResult && tokenResult.claims) || {};
        if (claims.lab === true) {
          setCurrentUser({
            id: fbUser.uid,
            name: claims.name || fbUser.displayName || '',
            role: claims.role === 'superuser' ? 'superuser' : 'user'
          });
        } else {
          // Session Firebase SANS jeton du serveur (ex. compte créé par une
          // inscription publique avec la clé API) : aucun accès aux données.
          console.warn('Session Firebase sans revendication « lab » — déconnexion.');
          setCurrentUser(null);
          try { await auth.signOut(); } catch { /* ignore */ }
        }
      } catch (e) {
        console.warn('Lecture des revendications du jeton impossible:', e && e.message);
      }
    });

    return () => { try { unsubscribe(); } catch { /* ignore */ } };
  }, []);

  // ── ÉTAT DE L'AUTHENTIFICATION SERVEUR + LISTE DE L'ÉQUIPE ────────────────
  // `ready` (serveur prêt ET équipe publiée) impose la session Firebase ;
  // le roster (noms + rôles, SANS mot de passe) alimente l'écran de connexion
  // avant toute authentification. Rien n'est bloqué si le serveur n'est pas
  // encore configuré : l'application garde alors son comportement historique.
  const refreshServerAuth = useCallback(async () => {
    if (!authServerConfigured()) {
      setServerAuth({ checked: true, configured: false, accounts: 0, ready: false, adminPushEnabled: false, lastError: '' });
      setServerRoster([]);
      return;
    }
    const st = await fetchAuthStatus();
    setServerAuth({
      checked: true,
      configured: !!st.configured,
      accounts: Number(st.accounts || 0),
      ready: !!st.ready,
      adminPushEnabled: !!st.adminPushEnabled,
      lastError: st.ok ? '' : (st.message || st.error || 'serveur injoignable')
    });
    if (st.ok) {
      const roster = await fetchRoster();
      if (roster.ok) setServerRoster(Array.isArray(roster.members) ? roster.members : []);
    }
  }, []);

  useEffect(() => { refreshServerAuth(); }, [refreshServerAuth]);

  // Le roster (liste des noms) alimente l'écran de connexion : si le serveur est
  // prêt mais que la liste n'a pas pu être lue (réseau intermittent), on
  // réessaie — sans elle, personne ne pourrait choisir son nom.
  useEffect(() => {
    if (!serverAuth.ready || serverRoster.length) return undefined;
    const timer = setInterval(async () => {
      const roster = await fetchRoster();
      if (roster.ok && roster.members.length) setServerRoster(roster.members);
    }, 8000);
    return () => clearInterval(timer);
  }, [serverAuth.ready, serverRoster.length]);

  // ── PUBLICATION DE L'ÉQUIPE SUR LE SERVEUR DE JETONS ──────────────────────
  // Le serveur doit connaître les comptes (nom + hash) pour vérifier lui-même
  // les mots de passe : le superutilisateur publie la liste (ADMIN_TOKEN requis,
  // voir docs/SECURITY-SETUP.md). Mise en page : Setup → Équipe & accès.
  const publishTeamToServer = useCallback(async () => {
    const list = normalizeOperators(operators);
    if (!list.length) return { ok: false, error: 'empty_roster', message: 'Aucun compte à publier.' };
    const res = await publishAccounts(list, serverAdminToken());
    if (res.ok) {
      console.info(`[auth] ${res.accounts} compte(s) publié(s) sur le serveur de jetons.`);
      await refreshServerAuth();
    } else {
      console.warn('[auth] publication de l’équipe impossible:', res.error, res.message);
    }
    return res;
  }, [operators, refreshServerAuth]);

  // Synchronisation automatique (superutilisateur, jeton admin présent) : au
  // plus une publication par changement d'équipe — pour qu'une fiche ajoutée
  // ou un mot de passe modifié soit immédiatement accepté par le serveur.
  const lastPublishedRef = useRef('');
  useEffect(() => {
    if (!serverAuth.checked || !serverAuth.configured || !serverAuth.adminPushEnabled) return;
    if (!serverAdminToken()) return;
    if (currentUser?.role !== 'superuser') return;
    const list = normalizeOperators(operators);
    if (!list.length) return;
    const fingerprint = JSON.stringify(list.map((o) => [o.id, o.name, o.role, o.passwordHash]));
    if (lastPublishedRef.current === fingerprint) return;
    const t = setTimeout(() => {
      lastPublishedRef.current = fingerprint;
      publishTeamToServer();
    }, 1500);
    return () => clearTimeout(t);
  }, [operators, currentUser, serverAuth.checked, serverAuth.configured, serverAuth.adminPushEnabled, publishTeamToServer]);

  // ── FERMETURE DE SESSION ─────────────────────────────────────────────────
  // Fermer AUSSI la session Firebase : sans cela Firestore resterait
  // accessible après un « Sign out » (le jeton n'expire qu'au bout d'une heure).
  const handleSignOut = useCallback(async () => {
    setCurrentUser(null);
    setUnlockedTestIds(new Set());
    try { sessionStorage.removeItem('labCurrentUser'); } catch { /* ignore */ }
    await clearFirebaseSession();
  }, []);

// ── LOAD operators + authSettings FROM Firestore (any session) ────────────
  useEffect(() => {
    // The scientists list + access settings are TEAM data: they must appear on
    // every browser even when no personal Google account is signed in (shared
    // Lab Workspace Drive mode), so the login gate and the permissions stay
    // exactly as configured. Reads use the public path (like datasets below)
    // and therefore work before a Google sign-in; writes remain gated on a
    // signed-in Google user (see the save effect above).
    if (!db) return;
    // Avec l'authentification serveur active, on ne lit le cloud qu'une fois
    // connecté : les règles Firestore refusent tout jeton non signé.
    if (serverAuth.ready && !user) return;
    const unsubscribe = db
      .collection(`artifacts/${appId}/public/data/appConfig`)
      .doc('global')
      .onSnapshot(
        (doc) => {
          // La lecture distante a eu lieu : les écritures (opérateurs / réglages)
          // deviennent autorisées — voir la protection anti-effacement de
          // l'effet de sauvegarde plus haut.
          setCloudAppConfigRead(true);
          if (!doc.exists) {
            cloudHasAccountsRef.current = false;
            return;
          }
          const data = doc.data();
          
          // Fix infinite loop: only update state if cloud data differs from current local string
          try {
            if (data.operators) {
              const currentLocal = localStorage.getItem('labWorkspace_operators');
              let parsedList = [];
              try { const p = JSON.parse(data.operators); parsedList = Array.isArray(p) ? p : []; } catch { parsedList = []; }
              // Le cloud contient-il déjà une équipe ? (protection anti-effacement)
              cloudHasAccountsRef.current = parsedList.length > 0;
              if (currentLocal !== data.operators && parsedList.length > 0) {
                setOperators(parsedList);
                localStorage.setItem('labWorkspace_operators', data.operators);
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
  }, [user, serverAuth.ready]);
  // ──────────────────────────────────────────────────────────────────────


  // Connect Google Drive for uploads. In SHARED workspace mode this NEVER opens
  // a Google popup for normal users: it simply asks the workspace server for a
  // fresh token (the permanent credential lives on the server). Only the owner
  // bootstrap (?drive-bootstrap=1) runs the real Google consent flow. Otherwise
  // the flow requires the configured Google Cloud OAuth client.
  const connectDrive = async () => {
    if (getConfiguredDriveClientId()) {
      const ok = await connectDriveWithGis();
      if (ok) {
        const verified = await testDriveAccess();
        if (verified) {
          try { window.dispatchEvent(new CustomEvent('lab:drive-connected')); } catch { /* ignore */ }
          alert(sharedWorkspaceMode()
            ? 'Shared Drive connected ✓ — uploaded images/documents will be saved automatically to the shared Lab Workspace Drive folder.'
            : 'Google Drive connected ✓ — uploaded images/documents will be saved automatically to your Drive folder.');
        } else {
          clearDriveToken();
          try { window.dispatchEvent(new CustomEvent('lab:drive-disconnected')); } catch { /* ignore */ }
          alert(sharedWorkspaceMode()
            ? 'The shared Drive server answered, but it could not verify Drive access. It may not be set up yet — ask the workspace owner to run the one-time setup (?drive-bootstrap=1).'
            : 'Google sign-in succeeded, but Google blocked Drive access. Check that the OAuth client has the drive.file scope enabled.');
        }
      } else if (sharedWorkspaceMode()) {
        // Shared mode: never a Google popup — explain the real cause instead.
        const bootstrapFailed = driveBootstrapRequestedAtLoad();
        const preciseError = getLastDriveConnectError();
        alert(
          bootstrapFailed
            ? 'The one-time Google consent for the shared Drive did not complete.\n\n'
              + (preciseError
                ? `Dettaglio tecnico: ${preciseError}`
                : 'Close the popup and click “Connect shared Drive (owner)” again, approving the consent with the workspace owner’s Google account.')
            : (getWorkspaceServerIssue() === 'not_initialized'
              ? 'Shared Drive is not set up yet. The workspace owner must open this app once with “?drive-bootstrap=1” at the end of the URL and click Connect Drive — that stores the permanent credential on the shared server. Until then files are kept locally.' + (preciseError ? '\n\nDettaglio tecnico: ' + preciseError : '')
              : 'The shared Lab Workspace server is temporarily unreachable, so Drive is unavailable right now.\n\nYour files are still saved locally, and the app will reconnect automatically as soon as the server answers again — no personal Google Drive is needed (you still log in to the app normally).')
        );
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

  // One-time OWNER bootstrap (?drive-bootstrap=1): a full-screen overlay makes
  // the Google-consent step impossible to miss, whether the owner is on the
  // explorer or inside a dataset. It stays visible until a shared access token
  // is stored (server initialised) and then drops the flag from the URL so a
  // later reload does not re-open it.
  const runDriveBootstrapConnect = async () => {
    if (driveBootstrapBusy) return;
    setDriveBootstrapBusy(true);
    setDriveBootstrapError('');
    try {
      await connectDrive();
      if (!getDriveToken()) {
        setDriveBootstrapError(
          getLastDriveConnectError()
            || 'The Google consent flow did not complete. See the alert above for details.'
        );
      }
    } catch (e) {
      setDriveBootstrapError((e && e.message) ? e.message : String(e));
    } finally {
      setDriveBootstrapBusy(false);
    }
  };

  useEffect(() => {
    if (!sharedWorkspaceMode() || !driveBootstrapRequestedAtLoad()) return;
    let alive = true;
    const refresh = () => {
      if (!alive) return;
      const tokenReady = !!getDriveToken();
      if (tokenReady) {
        // Server already initialised / bootstrap just succeeded — remove the
        // "?drive-bootstrap=1" marker so reloads stay clean.
        try {
          const q = new URLSearchParams(window.location.search);
          if (q.has('drive-bootstrap')) {
            q.delete('drive-bootstrap');
            const qs = q.toString();
            window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
          }
        } catch { /* ignore */ }
      }
      if (!dismissDriveBootstrapRef.current) setDriveBootstrapOpen(!tokenReady);
    };
    // Wait a moment so the automatic server mint (kickOffSharedWorkspaceToken)
    // can finish first — no flashing overlay when the server is already ready.
    const later = setTimeout(refresh, 1200);
    const poll = setInterval(refresh, 5000);
    const onConnected = refresh;
    window.addEventListener('lab:drive-connected', onConnected);
    window.addEventListener('lab:drive-disconnected', onConnected);
    return () => {
      alive = false;
      clearTimeout(later);
      clearInterval(poll);
      window.removeEventListener('lab:drive-connected', onConnected);
      window.removeEventListener('lab:drive-disconnected', onConnected);
    };
  }, []);

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

    if (sharedDatasetId && isCloudReady && db && !currentDatasetId
        && (!serverAuth.ready || !!user)) {
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
    // openDataset est stable pour cet effet (garde `!currentDatasetId`) :
    // l'ajouter aux dépendances relancerait la lecture à chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCloudReady, currentDatasetId, needsLogin, user, serverAuth.ready]);

  /* Datasets supprimés VOLONTAIREMENT pendant cette session. Le document est
     retiré de Firestore, mais le cache localStorage de l’appareil en garde une
     copie : sans ce marqueur, l’écouteur du snapshot la ré-ajoutait aussitôt à
     la liste et la suppression semblait « ne rien faire » (le dataset restait
     vivant, y compris après rechargement tant que le cache local existait).
     Il empêche aussi la sauvegarde automatique en attente de recréer le
     document (un `set(..., {merge:true})` ressuscite un document supprimé). */
  const deletedDatasetIdsRef = useRef(new Set());

  useEffect(() => {
    // Cloud datasets live under `artifacts/{appId}/public/data/datasets`.
    // La lecture ET l'écriture exigent désormais un jeton signé par le serveur
    // de jetons (voir firestore.rules) : plus aucun client anonyme. Quand
    // l'authentification serveur est active, on n'interroge le cloud qu'avec une
    // session ET on n'affiche aucun cache local sans session — un visiteur sans
    // compte ne doit même pas voir la LISTE des datasets.
    // Tant que l'état du serveur de jetons n'est pas connu (serveur configuré),
    // on ne charge RIEN : sans cela le cache local laisserait apparaître les
    // titres des datasets avant toute connexion. En mode historique (aucun
    // serveur de jetons configuré) le comportement d'origine est conservé.
    const serverAuthActive = !!serverAuth.ready;
    const serverAuthPending = authServerConfigured() && !serverAuth.checked;
    if ((serverAuthActive || serverAuthPending) && !user) {
      setDatasetsList([]);
      setIsCloudReady(true);
      return undefined;
    }
    if (db) {
      const collRef = db.collection(`artifacts/${appId}/public/data/datasets`);

      const unsubscribe = collRef.onSnapshot(
        (snap) => {
          const dsets = [];

          snap.forEach((doc) => {
            dsets.push({ id: doc.id, ...doc.data() });
          });

          dsets.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

          // CLOUD WINS. Firestore is the single source of truth: every device
          // reads AND writes it now, so its record — including `access`, the
          // hide/show-visibility flag — must never be overridden by this
          // device's cached copy; that override is what made the access toggle
          // look "stuck". localStorage is kept only for datasets this device has
          // that the cloud does not know yet (e.g. created while offline): they
          // are appended so nothing is silently dropped, and the next successful
          // save publishes them.
          try {
            const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
            const local = stored ? JSON.parse(stored) : [];
            (Array.isArray(local) ? local : []).forEach((l) => {
              if (!l || !l.id) return;
              // Dataset supprimé volontairement : ne jamais le ressusciter.
              if (deletedDatasetIdsRef.current.has(String(l.id))) return;
              if (!dsets.some((d) => String(d.id) === String(l.id))) dsets.push(l);
            });
            dsets.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          } catch { /* quota / parse — the cloud copy is enough */ }

          setDatasetsList(dsets);
          setIsCloudReady(true);
        },
        (err) => {
          // Read not permitted (or offline) — fall back to this device's local data.
          console.warn('Firestore datasets read error (using local storage):', err?.message || err);

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

    // No Firestore available — pure local mode.
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);

      if (stored) {
        setDatasetsList(
          JSON.parse(stored).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        );
      }
    } catch {}

    setIsCloudReady(true);
  }, [user, serverAuth.ready, serverAuth.checked]);

  // ── Derived string array for backward-compatible child components ──
  // All child components (test renderers, LabNotebook, Storage, etc.) still
  // expect operators as plain strings. This is the safe list to pass them.
  const operatorNames = normalizeOperators(operators).map((op) => op.name);

  // « Bootstrap » d’accès : aucun compte OU aucun superutilisateur défini →
  // tout le monde peut ouvrir les datasets (permet de créer la 1re équipe).
  const datasetAccessBootstrap = operatorNames.length === 0 || !hasDefinedSuperuser(operators);

  // Contexte d’accès par dataset, lu par openDataset via une ref (toujours à
  // jour, même depuis un effet / une promesse).
  const accessContextRef = useRef(null);
  accessContextRef.current = { currentUser, noAccounts: datasetAccessBootstrap };

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
    LZString.compressToUTF16(JSON.stringify({
      ...latestDataRef.current,
      // The Figures & Slides image library (common + every project) is embedded
      // in the HTML save and the weekly Drive backups so a restored file brings
      // the library back too.
      _figuresLibrary: readLibrary(),
      _figuresLibraryProjects: readAllProjectLibraries(),
      projects: loadProjects()
    }));

  // ── WEEKLY HTML AUTOSAVE TO GOOGLE DRIVE ──────────────────────────────────
  // Every 7 days (checked on load, on Drive connect, and every few hours while
  // the app stays open) a full HTML backup of EVERY dataset is written to
  // <Lab Workspace>/<dataset>/backups/<title>_backup_<date>.html on Google
  // Drive — the same format the "Save HTML" button produces, so any backup file
  // can be re-imported with "Load HTML" if a dataset is ever lost or corrupted.
  const [backupStatus, setBackupStatus] = useState(null);
  const backupRunningRef = useRef(false);
  const datasetsListRef = useRef(datasetsList);
  datasetsListRef.current = datasetsList;
  const currentDatasetIdRef = useRef(currentDatasetId);
  currentDatasetIdRef.current = currentDatasetId;
  const activeDatasetKindRef = useRef(activeDatasetKind);
  activeDatasetKindRef.current = activeDatasetKind;
  const adminContentRef = useRef(adminContent);
  adminContentRef.current = adminContent;
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
      // Hard rule: experiments may not be backed up / saved without a Project.
      const backupValidation = activeDatasetKindRef.current === 'administration'
        ? { ok: true }
        : validateDatasetExperiments({ tests: latestDataRef.current?.tests || [] });
      if (!backupValidation.ok) {
        setBackupStatus({ state: 'error', msg: `${backupValidation.message} Link every experiment to a Project before the weekly backup runs.` });
        return false;
      }
      const list = Array.isArray(datasetsListRef.current) ? datasetsListRef.current : [];
      if (list.length === 0) { setBackupStatus({ state: 'skip', msg: 'No datasets to back up yet' }); return false; }

      setBackupStatus({ state: 'running', msg: `Writing weekly backup (${list.length} dataset${list.length > 1 ? 's' : ''})…` });
      const dateStr = new Date().toISOString().slice(0, 10);
      let done = 0;
      let failed = 0;
      const legacyBackupFolders = [];
      for (const dset of list) {
        try {
          if (!dset || !dset.payload) continue;
          const isCurrent = currentDatasetIdRef.current && String(dset.id) === String(currentDatasetIdRef.current);
          const payload = isCurrent
            ? (dset.kind === 'administration'
                ? LZString.compressToUTF16(JSON.stringify({ administration: adminContentRef.current || createAdministrationSeed() }))
                : getCompressedPayload())
            : dset.payload;
          const title = isCurrent
            ? (datasetTitleRef.current || dset.title || 'Untitled Dataset')
            : (dset.title || 'Untitled Dataset');
          const subtitle = isCurrent ? datasetSubtitleRef.current : (dset.subtitle || '');
          const html = buildBackupHtml(title, subtitle, payload);
          // A short dataset-id fragment guarantees two datasets with the same
          // title never collide in the FILE name (folders below are canonical
          // dataset directories named after the title).
          const idTag = String(dset.id || '').replace(/[^a-z0-9]/gi, '').slice(-6) || 'ds';
          const fname = `${sanitizeSlug(title) || 'dataset'}_${idTag}_backup_${dateStr}.html`;
          // Backups now live INSIDE the dataset directory —
          // <Lab Workspace>/<dataset>/backups/ — where the canonical dataset
          // structure (projects/backups/protocols/storage/publications) is
          // enforced. Never create a second per-dataset folder at the root.
          const dsFolder = datasetFolderSlug(title);
          const res = await uploadWorkspaceFile({ name: fname, mimeType: 'text/html', file: new Blob([html], { type: 'text/html' }), folder: `${dsFolder}/backups` });
          if (res) done++;
          else failed++;
          // The legacy weekly-backup layout used <dataset>_<idTag> folders at
          // the workspace root — remember them for the cleanup pass below.
          const legacyFolder = `${sanitizeSlug(title) || 'dataset'}_${idTag}`;
          if (legacyFolder !== dsFolder) legacyBackupFolders.push(legacyFolder);
        } catch (e) {
          failed++;
          console.warn('Weekly backup failed for a dataset:', e && e.message);
        }
      }
      if (done > 0) {
        try { localStorage.setItem(BACKUP_INTERVAL_KEY, String(Date.now())); } catch {}
        setBackupStatus({ state: 'ok', msg: `Weekly backup saved (${done} dataset${done > 1 ? 's' : ''}) → Lab Workspace/<dataset>/backups` });
        // Root hygiene: the workspace root must only contain dataset folders.
        // Empty legacy artifacts (a shared root "backups" folder or the old
        // "<dataset>_<idTag>" backup folders) are trashed best-effort. Legacy
        // folders that still hold their own old backup files are NOT deleted —
        // new backups go to the canonical dataset/backups location from now on.
        cleanupWorkspaceRootFolders({ legacyFolderNames: legacyBackupFolders }).catch(() => {});
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
// Deep copy that replaces oversized base64 data-URLs with '' — used for the
// CLOUD mirror of the (per-browser) project store, so Firestore stays small and
// a phone never receives a giant string or a broken compression marker.
const stripOversizedDataUrls = (value) => {
  if (typeof value === 'string') {
    return value.startsWith('data:') && value.length > 5000 ? '' : value;
  }
  if (Array.isArray(value)) return value.map(stripOversizedDataUrls);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = stripOversizedDataUrls(value[k]);
    return out;
  }
  return value;
};
const cloudProjectsPayload = () => {
  try { return { projects: stripOversizedDataUrls(loadProjects() || []) }; } catch { return { projects: [] }; }
};

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
      // structureFileData is replaced with `null` (not a marker): the MD page
      // reads it as "absent" and restores the raw topology file from IndexedDB
      // instead, avoiding a "Failed to decode structure file data." error on
      // reload. Every other value gets the readable text marker.
      const replacement = label === 'structureFileData' ? null : `[${label} omitted — kept in browser cache / Drive or re-uploadable]`;
      setByPath(cleaned.tests[best.testIndex], best.path, replacement);
    }
  }
  return compress(cleaned);
};
useEffect(() => {
  if (!isCloudReady || appView !== 'dataset' || !currentDatasetId) return;
  // Les bases d’administration sont sauvegardées par leur propre effet
  // débouncé ci-dessous : le payload scientifique ne doit JAMAIS écrire
  // par-dessus une base d’administration.
  if (isAdministrationKind(activeDatasetKind)) return;
  setSaveStatus('saving');
  if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
  saveTimeoutRef.current = setTimeout(async () => {
    try {
      const rawData = { ...latestDataRef.current, ...cloudProjectsPayload() };
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
      if (db) {
        const docRef = db
          .collection(`artifacts/${appId}/public/data/datasets`)
          .doc(currentDatasetId);
        await docRef
          .set(updatedPayload, { merge: true })
          .then(() => {
            setSaveStatus('saved');
            setSaveTarget('cloud');
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
        setSaveTarget('local');
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [
  tests, datasetTitle, datasetSubtitle, customCmpds, customCellLines,
  customConc, cmpColors, testCategories, protocolCategories, datasetProtocols,
  customFields, operators, molecules, compoundMeta, calculationEntries,
  cellLineMeta, plasmidMeta, storages, solvents, buffers, additives,
  nmrInstruments, nmrProbes, nmrExperiments, isCloudReady, appView,
  currentDatasetId, activeDatasetKind, user, authSettings
]);


  useEffect(() => {
    if (!isCloudReady || appView !== 'dataset' || !currentDatasetId) return;
    if (!isAdministrationKind(activeDatasetKind) || !adminContent) return;
    setSaveStatus('saving');
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const updatedPayload = {
          kind: 'administration',
          title: datasetTitle || 'Base d’administration',
          subtitle: datasetSubtitle || '',
          date: new Date().toISOString().split('T')[0],
          updatedAt: window.firebase
            ? window.firebase.firestore.FieldValue.serverTimestamp()
            : Date.now(),
          payload: LZString.compressToUTF16(JSON.stringify({ administration: adminContent })),
          isCompressed: true
        };
        if (db) {
          const docRef = db
            .collection(`artifacts/${appId}/public/data/datasets`)
            .doc(currentDatasetId);
          await docRef
            .set(updatedPayload, { merge: true })
            .then(() => {
              setSaveStatus('saved');
              setSaveTarget('cloud');
              setSaveErrorMsg('');
            })
            .catch((err) => {
              setSaveStatus('error');
              setSaveErrorMsg(err.message);
              console.error('Firestore administration save error:', err);
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
          setSaveTarget('local');
        }
      } catch (e) {
        setSaveStatus('error');
        setSaveErrorMsg(e.message);
        console.error('Administration save error:', e);
      }
    }, 1500);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    adminContent, datasetTitle, datasetSubtitle, isCloudReady, appView,
    currentDatasetId, user, activeDatasetKind
  ]);


  const exportHTML = async () => {
    try {
      const isAdmin = isAdministrationKind(activeDatasetKind);
      // Hard rule: experiments may not be saved without a Project.
      const validation = isAdmin ? { ok: true } : validateDatasetExperiments({ tests: latestDataRef.current?.tests || [] });
      if (!validation.ok) {
        setDialog({ type: 'alert', title: 'Experiments must be linked to a Project', message: `${validation.message}\n\nLink every experiment to at least one Project (Projects → open project → “+ Add experiment”, or link existing experiments inside the project), then save again.` });
        return;
      }
      const title = datasetTitle || (isAdmin ? 'Base d’administration' : 'Untitled Dataset');
      const subtitle = datasetSubtitle || '';
      const payload = isAdmin
        ? LZString.compressToUTF16(JSON.stringify({ administration: adminContent || createAdministrationSeed() }))
        : getCompressedPayload();

      /* Enregistre un instantané de l’ÉTAT du dataset (administratif comme
         scientifique) sur Google Drive, dans le dossier de sauvegarde du
         dataset : Lab Workspace/<dataset>/backups/. Si Drive n’est pas
         connecté (ou en cas d’échec), un fichier HTML local est téléchargé à
         la place — même format, relisible par « Load HTML ». */
      const downloadSnapshot = (htmlStr) => {
        const blob = new Blob([htmlStr], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(datasetTitle || 'dataset').replace(/[^a-z0-9]+/gi, '_')}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };

      let storedOnDrive = false;
      if (getDriveToken() && currentDatasetId) {
        try {
          const html = buildBackupHtml(title, subtitle, payload);
          const dsFolder = datasetFolderSlug(title);
          const slug = sanitizeSlug(title) || 'dataset';
          const idTag = String(currentDatasetId || '').replace(/[^a-z0-9]/gi, '').slice(-6) || 'ds';
          const dateStr = new Date().toISOString().slice(0, 10);
          const fname = `${slug}_${idTag}_save_${dateStr}.html`;
          const res = await uploadWorkspaceFile({
            name: fname,
            mimeType: 'text/html',
            file: new Blob([html], { type: 'text/html' }),
            folder: `${dsFolder}/backups`,
          });
          if (res) {
            storedOnDrive = true;
            setBackupStatus({ state: 'ok', msg: `💾 État enregistré → Lab Workspace/<dataset>/backups (${dateStr})` });
          }
        } catch (err) {
          console.warn('Save HTML to Drive failed:', err && err.message);
        }
      }

      if (storedOnDrive) return;

      setBackupStatus(
        getDriveToken() && currentDatasetId
          ? { state: 'error', msg: '⚠️ Enregistrement Drive impossible — copie locale téléchargée' }
          : { state: 'skip', msg: '💾 Google Drive non connecté — copie locale téléchargée' }
      );

      const dataBlob = {
        payload,
        isCompressed: true,
        title,
        subtitle,
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

      downloadSnapshot('<!DOCTYPE html>\n' + clone.outerHTML);
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

    const reader = new FileReader();

    reader.onload = (ev) => {
      try {
        const text = ev.target.result;
        let s = null;
        let loadedTests = [];
        // The .html file itself is almost always big — it also contains the
        // whole rendered app UI (the DOM), which has nothing to do with the
        // cloud limit. What matters is the size of the compressed dataset
        // payload that would be written to Firestore (field limit ~1 MiB).
        let payloadBytes = 0;
        let payloadUnits = 0;

        const newMatch = text.match(
          /<script[^>]*id=["']saved-data-blob["'][^>]*>([\s\S]*?)<\/script>/
        );

        if (newMatch) {
          const dataBlob = JSON.parse(newMatch[1]);
          let pStr = dataBlob.payload;

          // Exact UTF-8 byte size of the compressed payload (what Firestore
          // sees for its ~1 MiB field limit), plus the save routine's own
          // budget metric (length × 3, a strict upper bound) that decides when
          // heavy data gets stripped from the live cloud copy.
          try {
            payloadBytes = new TextEncoder().encode(String(pStr || '')).length;
          } catch {
            payloadBytes = String(pStr || '').length * 3;
          }
          payloadUnits = String(pStr || '').length * 3;

          if (dataBlob.isCompressed) {
            const dec = LZString.decompressFromUTF16(pStr);
            if (dec) pStr = dec;
          }

          s = JSON.parse(pStr);
          loadedTests = s.tests || s.plates || [];

          /* Une sauvegarde d’une base d’administration (payload { administration:
             … }) n’a pas d’expériences : elle est restaurée telle quelle. */
          const isAdminLoad = !!s && typeof s.administration === 'object'
            && s.administration !== null
            && !Array.isArray(s.tests) && !Array.isArray(s.plates);
          if (isAdminLoad) {
            /* Éléments importables de la base (une page = une collection) :
               l’utilisateur peut n’en restaurer qu’une partie. */
            const sections = loadSectionsOf(s, true);
            setPendingLoad({
              tests: [],
              fullState: s,
              isAdmin: true,
              sections,
              adminTitle: dataBlob && (dataBlob.title || ''),
              adminSubtitle: dataBlob && (dataBlob.subtitle || ''),
            });
            setLoadPick(defaultSelection(sections));
            return;
          }

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

        // Warn only when the PAYLOAD itself is near/over the cloud limit. The
        // Google Drive copies (weekly backups in Lab Workspace/backups and the
        // archived raw files) are completely separate and are NOT affected by
        // the Firestore 1 MB field limit.
        if (payloadBytes > 1048487 || payloadUnits > 1048487) {
          setDialog({
            type: 'alert',
            title: 'Cloud Limit Warning',
            message:
              'This dataset payload is larger than the cloud 1 MB limit, so the live cloud copy cannot hold it in one document. Nothing is lost: the weekly backups in your Drive "Lab Workspace/backups" folder and the raw files archived on Drive keep everything. If you want the cloud copy to fit too, remove the heaviest embedded images and re-save.'
          });
        } else if (payloadUnits > 900000) {
          setDialog({
            type: 'alert',
            title: 'Large Dataset',
            message:
              'This dataset is close to the cloud 1 MB limit. When saving the live cloud copy, the heaviest embedded data (notebook images, large FCS payloads) is left out of that copy to keep it under the limit — but nothing is lost: those files remain in Google Drive (archived raw files + the weekly backups in "Lab Workspace/backups") and in this browser cache.'
          });
        }

        const migrated = migrateLoadedDataset(s);

        loadedTests = migrated.tests;
        s.storages = migrated.storages;

        /* Éléments importables du dataset scientifique (expériences, projets,
           définitions, stockage, rapport, Figures & Slides…). */
        const dataSections = loadSectionsOf(s, false);
        setPendingLoad({ tests: loadedTests, fullState: s, sections: dataSections });
        setLoadPick(defaultSelection(dataSections));
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

  const confirmLoad = (mode, pickedIds) => {
    const { tests: pendingTests, fullState: rawState, sections } = pendingLoad;
    const allSections = Array.isArray(sections) ? sections : [];
    const picked = Array.isArray(pickedIds)
      ? pickedIds
      : (Array.isArray(loadPick) ? loadPick : defaultSelection(allSections));
    /* Import PARTIEL : le snapshot est réduit aux éléments COCHÉS — les autres
       gardent leur valeur actuelle (rien n’est écrasé en silence). Les
       expériences d’un dataset scientifique ne sont remplacées que si
       l’élément « Expériences » est coché. */
    const pruned = filterLoadState(rawState, allSections, picked);
    const s = pruned.state;
    const loadedTests = selectionHasTests(picked) ? (pendingTests || []) : [];
    let targetId = currentDatasetId;

    /* Restauration d’une base d’administration : tout le contenu vit dans
       s.administration (aucune expérience). Si la base actuellement ouverte
       n’est PAS une base d’administration, la sauvegarde est restaurée dans
       une NOUVELLE base (le dataset scientifique ouvert n’est pas touché). */
    if (pendingLoad && pendingLoad.isAdmin) {
      const pickedAdmin = pruned.administration || {};
      /* Tout est coché → le contenu du fichier remplace la base, comme avant ;
         import PARTIEL → seules les pages cochées remplacent leurs homologues,
         les autres pages de la base ouverte restent intactes. */
      const complete = selectionIsComplete(allSections, picked);
      const base = (currentDatasetId && isAdministrationKind(activeDatasetKind)
        && adminContent && typeof adminContent === 'object')
        ? adminContent
        : createAdministrationSeed();
      const admin = complete
        ? (Object.keys(pickedAdmin).length ? pickedAdmin : base)
        : { ...base, ...pickedAdmin };
      const restoringInPlace = !!currentDatasetId && isAdministrationKind(activeDatasetKind);
      targetId = restoringInPlace ? currentDatasetId : 'ds_' + Date.now();
      if (!restoringInPlace) {
        setCurrentDatasetId(targetId);
        setAppView('dataset');
        window.history.pushState({}, '', datasetHref(targetId));
      }
      setActiveDatasetKind('administration');
      setAdminContent(admin);
      const loadedTitle = (pendingLoad && pendingLoad.adminTitle)
        || (s && (s.title || s.datasetTitle))
        || (restoringInPlace ? datasetTitle : 'Base d’administration');
      const loadedSubtitle = (pendingLoad && pendingLoad.adminSubtitle)
        || (s && (s.subtitle || s.datasetSubtitle))
        || '';
      setDatasetTitle(loadedTitle);
      setDatasetSubtitle(loadedSubtitle);
      setCurrentModule('administration');
      setCurrentAdminPage('overview');
      setAdminFocus(null);
      resetAdminNavHistory();
      setPendingLoad(null);
      setLoadPick(null);
      if (window.innerWidth < 768) setIsSidebarOpen(false);
      return;
    }

    if (!targetId || mode === 'replace') {
      targetId = s.id || 'ds_' + Date.now();
      setCurrentDatasetId(targetId);
      setAppView('dataset');
      window.history.pushState({}, '', datasetHref(targetId));
    }
    // The restored dataset becomes the active project scope, so its projects
    // are stored/tagged under this dataset's id.
    setProjectDatasetScope(targetId);

    if (mode === 'replace') {
      /* Les expériences ne sont remplacées que si l’élément « Expériences » est
         coché : importer uniquement les définitions ne doit jamais vider les
         expériences déjà présentes dans le dataset. */
      if (loadedTests.length > 0 || selectionHasTests(picked)) {
        setReactTests(loadedTests);
        historyRef.current = [loadedTests];
        setHistoryIndex(0);

        if (loadedTests.length > 0) {
          setActiveTestId(loadedTests[0].id);
        }
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
      // Projects live in localStorage (not React state) — restore them here.
      if (Array.isArray(s.projects)) saveProjects(s.projects);
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

      // Restore the Figures & Slides image library embedded in the HTML file
      // (app-level; on replace the whole library is taken from the file).
      if (s._figuresLibrary !== undefined || s._figuresLibraryProjects !== undefined) {
        restoreLibraryFromSnapshot({ common: s._figuresLibrary, projects: s._figuresLibraryProjects });
        window.dispatchEvent(new CustomEvent('lab:figures-library-restored'));
      }
    } else if (mode === 'append') {
      const newTests = loadedTests.map((p) => ({
        ...p,
        id: 't' + Math.random().toString(36).substr(2, 9) + Date.now()
      }));

      setTests((prev) => [...prev, ...newTests]);

      // Merge projects from the loaded file (by id) into the existing ones.
      if (Array.isArray(s.projects) && s.projects.length) {
        const existing = loadProjects();
        const ids = new Set(existing.map((p) => p && p.id));
        const additions = s.projects.filter((p) => p && p.id && !ids.has(p.id));
        if (additions.length) saveProjects([...existing, ...additions]);
      }

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
    setLoadPick(null);
    setCurrentModule('tests');

    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

const createNewDataset = async (kind = 'scientific') => {
    const newId = 'ds_' + Date.now();
    const isAdmin = isAdministrationKind(kind);
    // Projects are scoped per dataset: a new dataset starts with an empty
    // project list (never the projects of the other datasets).
    setProjectDatasetScope(isAdmin ? null : newId);
    // Experiments must belong to a Project of the CURRENT dataset. A brand-new
    // dataset has no projects yet, so its starter experiment starts unassigned
    // (it must be linked to a project created inside this dataset before the
    // experiment can be saved or backed up). An Administration database does NOT
    // need a starter experiment — it starts with an empty `administration`
    // payload.
    let freshTests = [];
    let adminSeed = null;
    if (isAdmin) {
      adminSeed = createAdministrationSeed();
    } else {
      const existingProjects = loadProjects() || [];
      const starterProject = String(existingProjects[0] && existingProjects[0].name || '').trim();
      const starter = createEmptyTest('t1', 1, 'plate-96');
      if (starterProject) starter.projectNames = [starterProject];
      freshTests = [starter];
    }

    setReactTests(freshTests);

    historyRef.current = [freshTests];
    setHistoryIndex(0);
    setActiveTestId('t1');

    setDatasetTitle(isAdmin ? 'Base d’administration' : 'New Dataset');
    setDatasetSubtitle('');
    setAdminContent(isAdmin ? adminSeed : null);
    setActiveDatasetKind(kind);
    setCurrentAdminPage('overview');
    setAdminFocus(null);
    resetAdminNavHistory();
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
    setCurrentModule(isAdmin ? 'administration' : 'dashboard');

    window.history.pushState({}, '', datasetHref(newId));

    const updatedPayload = {
      kind,
      // Par défaut, un nouveau dataset est visible par TOUS les comptes de
      // l’équipe (comportement historique) ; le créateur est pré-rempli membre.
      access: {
        restricted: false,
        memberNames: currentUser && currentUser.name ? [String(currentUser.name).trim()] : []
      },
      title: isAdmin ? 'Base d’administration' : 'New Dataset',
      subtitle: '',
      date: new Date().toISOString().split('T')[0],
      createdAt: window.firebase
        ? window.firebase.firestore.FieldValue.serverTimestamp()
        : Date.now(),
      updatedAt: window.firebase
        ? window.firebase.firestore.FieldValue.serverTimestamp()
        : Date.now(),
      payload: isAdmin
        ? LZString.compressToUTF16(JSON.stringify({ administration: adminSeed }))
        : JSON.stringify({ tests: freshTests }),
      isCompressed: isAdmin
    };

    if (db) {
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
    const isAdmin = isAdministrationKind(activeDatasetKind);
    setSaveStatus('saving');
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    try {
      const rawData = { ...latestDataRef.current, ...cloudProjectsPayload() };
      const compressedPayload = isAdmin ? '' : compressDatasetForSave(rawData);
      
      const updatedPayload = isAdmin
        ? {
            kind: 'administration',
            title: datasetTitle || 'Base d’administration',
            subtitle: datasetSubtitle || '',
            date: new Date().toISOString().split('T')[0],
            updatedAt: window.firebase
              ? window.firebase.firestore.FieldValue.serverTimestamp()
              : Date.now(),
            payload: LZString.compressToUTF16(JSON.stringify({ administration: adminContent || createAdministrationSeed() })),
            isCompressed: true
          }
        : {
            title: datasetTitle || 'Untitled Dataset',
            subtitle: datasetSubtitle || '',
            date: rawData.tests?.[0]?.date || new Date().toISOString().split('T')[0],
            testCount: rawData.tests?.length || 0,
            updatedAt: window.firebase
              ? window.firebase.firestore.FieldValue.serverTimestamp()
              : Date.now(),
            payload: compressedPayload,
            isCompressed: true,
            kind: 'scientific'
          };
      if (db) {
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
  setCurrentAdminPage('overview');
  setAdminFocus(null);
  resetAdminNavHistory();
  // Back on the explorer: no dataset scope anymore (the datasets list screen
  // never shows projects).
  setProjectDatasetScope(null);
};

const openDataset = (dset) => {
  // Chaque dataset n’est visible que par les utilisateurs définis dedans :
  // garde de sécurité, y compris pour l’ouverture directe par URL.
  const ctx = accessContextRef.current || { currentUser: null, noAccounts: false };
  if (!canUserOpenDataset(dset, ctx.currentUser, { bootstrap: ctx.noAccounts })) {
    setDialog({
      type: 'alert',
      title: '🔒 Accès restreint',
      message: `Le dataset « ${(dset && dset.title) || 'sans titre'} » n’est visible que par les utilisateurs définis comme membres. Connectez-vous avec votre compte membre, ou demandez au superutilisateur de vous ajouter.`
    });
    return;
  }
  const kind = dset && dset.kind === 'administration' ? 'administration' : 'scientific';
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

  // ── Base d’administration : tout le contenu vit dans s.administration ──
  if (kind === 'administration') {
    // Administration bases have no Projects module — clear any leftover scope.
    setProjectDatasetScope(null);
    const admin = (s && s.administration && typeof s.administration === 'object')
      ? s.administration
      : createAdministrationSeed();
    setAdminContent(admin);
    setActiveDatasetKind('administration');
    setDatasetTitle(dset.title && String(dset.title).trim() ? dset.title : 'Base d’administration');
    setDatasetSubtitle(dset.subtitle || '');
    setCurrentDatasetId(dset.id);
    setAppView('dataset');
    setCurrentModule('administration');
    setCurrentAdminPage('overview');
    setAdminFocus(null);
    resetAdminNavHistory();
    window.history.pushState({}, '', datasetHref(dset.id));
    if (window.innerWidth < 768) setIsSidebarOpen(false);
    return;
  }

  setAdminContent(null);
  setActiveDatasetKind('scientific');
  setCurrentAdminPage('overview');
  setAdminFocus(null);
  resetAdminNavHistory();

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

      // Projects are stored per-browser (localStorage) and scoped to the
      // dataset being opened: the payload projects are merged into the device
      // cache under THIS dataset's id, so a second device (e.g. a phone) that
      // opens this dataset gets the same projects — and a project created in
      // another dataset never appears here.
      setProjectDatasetScope(dset.id);
      try {
        mergeProjectsFromCloud(s.projects, {
          datasetId: dset.id,
          testIds: new Set((loadedTests || []).map((t) => t && t.id).filter(Boolean)),
          adoptAllLegacy: true
        });
      } catch (err) { console.warn('Could not restore projects from dataset:', err && err.message); }

      setCurrentDatasetId(dset.id);
      setAppView('dataset');
      setCurrentModule('dashboard');

      window.history.pushState({}, '', datasetHref(dset.id));
    } catch {
      setDialog({
        type: 'alert',
        title: 'Error',
        message: 'Error reading dataset structure.'
      });
    }
  };

  const saveDatasetAccess = async (dsetId, access) => {
    const cleanAccess = {
      restricted: !!access && !!access.restricted,
      memberNames: normalizeMemberNames(access && access.memberNames)
    };

    // Mise à jour optimiste (l’écran reflète immédiatement le changement).
    setDatasetsList((prev) => (Array.isArray(prev) ? prev : []).map((d) =>
      String(d.id) === String(dsetId) ? { ...d, access: cleanAccess } : d
    ));
    // On écrit AUSSI dans la copie locale : simple cache hors-ligne. Le cloud
    // fait désormais autorité dans l’onSnapshot, et chaque appareil y écrit
    // directement — aucune connexion Google n’est plus requise.
    try {
      const localList = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
      const localIdx = (Array.isArray(localList) ? localList : []).findIndex((d) => String(d.id) === String(dsetId));
      if (localIdx >= 0) {
        localList[localIdx] = { ...localList[localIdx], access: cleanAccess };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(localList));
      }
    } catch { /* quota / parse — le cloud reste la source de vérité */ }

    if (db) {
      try {
        await db
          .collection(`artifacts/${appId}/public/data/datasets`)
          .doc(dsetId)
          .set({ access: cleanAccess }, { merge: true });
        return;
      } catch (e) {
        console.warn('Could not sync dataset access to Firestore:', e && e.message);
      }
    }
    // Repli local (cet appareil uniquement).
    let stored = [];
    try {
      stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
    } catch { /* ignore */ }
    const idx = (Array.isArray(stored) ? stored : []).findIndex((d) => String(d.id) === String(dsetId));
    if (idx >= 0) {
      stored[idx] = { ...stored[idx], access: cleanAccess };
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stored));
    }
  };
  // ── Action groupée : rendre TOUS les datasets visibles par l’équipe ──────
  // Dé-coche « Restreindre la visibilité aux membres » sur chaque dataset ;
  // les listes de membres sont conservées pour une restriction ultérieure.
  const [allVisibleBusy, setAllVisibleBusy] = useState(false);

  const makeAllDatasetsTeamVisible = () => {
    const list = Array.isArray(datasetsList) ? datasetsList : [];
    const restrictedList = list.filter((d) => isDatasetRestricted(d));
    if (restrictedList.length === 0) {
      setDialog({
        type: 'alert',
        title: '🌐 Déjà partagés',
        message: 'Tous les datasets sont déjà visibles par toute l’équipe.'
      });
      return;
    }
    setDialog({
      type: 'confirm',
      title: '🌐 Rendre visibles à toute l’équipe',
      message: `${restrictedList.length} dataset(s) sont actuellement restreints.\n\n« Restreindre la visibilité » sera décoché pour chacun : ils redeviennent visibles par TOUS les comptes de l’équipe (les listes de membres sont conservées).\n\nContinuer ?`,
      onConfirm: async () => {
        setAllVisibleBusy(true);
        try {
          for (const d of restrictedList) {
            await saveDatasetAccess(String(d.id), {
              restricted: false,
              memberNames: datasetAccessOf(d).memberNames
            });
          }
        } finally {
          setAllVisibleBusy(false);
        }
      }
    });
  };



  /* ── Suppression d’un dataset : le nettoyage LOCAL est obligatoire ─────────
     Firestore est la source de vérité, mais chaque appareil garde un cache
     localStorage que l’écouteur du snapshot ré-injecte : sans ce nettoyage, le
     dataset supprimé réapparaissait aussitôt dans la liste (le « Delete » de
     Database Cleanup semblait ne rien faire). */
  const forgetLocalDataset = (id) => {
    const key = String(id);
    try {
      const stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
      const kept = (Array.isArray(stored) ? stored : []).filter((d) => !d || String(d.id) !== key);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(kept));
    } catch { /* cache illisible : le cloud reste la référence */ }
    setDatasetsList((prev) => (Array.isArray(prev) ? prev : []).filter((d) => !d || String(d.id) !== key));
  };

  /* Ferme le dataset OUVERT sans le sauvegarder : il vient d’être supprimé et la
     sauvegarde automatique débouncée le recréerait (`set(..., {merge:true})` sur
     un document supprimé recrée le document). Toute sauvegarde en attente est
     annulée avant d’afficher la page de démarrage. */
  const closeDeletedDataset = (id) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    if (!currentDatasetId || String(currentDatasetId) !== String(id)) return;
    window.history.pushState({}, '', window.location.pathname);
    setAppView('explorer');
    setCurrentDatasetId(null);
    setDatasetTitle('');
    setDatasetSubtitle('');
  };

  const deleteDataset = (e, id) => {
    e.stopPropagation();
    const target = (Array.isArray(datasetsList) ? datasetsList : [])
      .find((d) => d && String(d.id) === String(id)) || null;
    const label = (target && (target.title || target.id)) || id;
    const isOpen = !!currentDatasetId && String(currentDatasetId) === String(id);

    setDialog({
      type: 'confirm',
      title: 'Delete Dataset',
      message: isOpen
        ? `« ${label} » est le dataset actuellement OUVERT.\n\nIl sera fermé (sans sauvegarde) puis supprimé définitivement : cloud, cache de cet appareil et projets liés. Continuer ?`
        : 'Are you sure you want to delete this entire Dataset?',
      onConfirm: async () => {
        /* 1) Marquer comme supprimé AVANT toute écriture : ni le snapshot (qui
           ré-injecte le cache local) ni une sauvegarde en attente ne doivent
           recréer ce dataset. */
        deletedDatasetIdsRef.current.add(String(id));
        closeDeletedDataset(id);
        try {
          if (db) {
            await db.collection(`artifacts/${appId}/public/data/datasets`).doc(id).delete();
          } else {
            forgetLocalDataset(id);
          }
        } catch (err) {
          /* Échec (hors ligne, droits Firestore…) : le dataset est toujours là.
             On annule le marqueur et on le dit, au lieu de laisser croire à une
             suppression alors que la ligne reste affichée. */
          deletedDatasetIdsRef.current.delete(String(id));
          setDialog({
            type: 'alert',
            title: 'Delete Failed',
            message: `The dataset could not be deleted${err && err.message ? `: ${err.message}` : '.'}\n\nCheck your connection and the Firestore rules, then try again.`
          });
          return;
        }
        /* 2) Nettoyage local (cache de l’appareil + liste affichée) et projets
           de ce dataset sur cet appareil. */
        forgetLocalDataset(id);
        try { removeProjectsOfDataset(id); } catch { /* ignore */ }
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
          if (db) {
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
        /* Ces datasets ne doivent plus être recréés : marqueur posé AVANT toute
           écriture (le snapshot ré-injecterait leur copie du cache local) et
           sauvegarde automatique en attente annulée. */
        emptyDatasets.forEach((dset) => deletedDatasetIdsRef.current.add(String(dset.id)));
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
        }
        if (db) {
          try {
            const batch = db.batch();

            emptyDatasets.forEach((dset) => {
              const docRef = db
                .collection(`artifacts/${appId}/public/data/datasets`)
                .doc(dset.id);

              batch.delete(docRef);
            });

            await batch.commit();

            /* Nettoyage local + fermeture du dataset ouvert s’il fait partie du lot. */
            emptyDatasets.forEach((dset) => {
              closeDeletedDataset(dset.id);
              forgetLocalDataset(dset.id);
            });
          } catch (e) {
            /* Rien n’a été supprimé : on annule les marqueurs. */
            emptyDatasets.forEach((dset) => deletedDatasetIdsRef.current.delete(String(dset.id)));
            console.error('Batch delete failed', e);

            setDialog({
              type: 'alert',
              title: 'Error',
              message: 'Cloud deletion failed.'
            });
          }
        } else {
          emptyDatasets.forEach((dset) => {
            closeDeletedDataset(dset.id);
            forgetLocalDataset(dset.id);
          });
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

  // Chaque dataset n’est visible que par les utilisateurs définis dedans
  // (liste de membres + superutilisateur) — voir utils/datasetAccess.js.
  const visibleDatasets = useMemo(() => {
    if (!currentUser && !datasetAccessBootstrap) return []; // comptes configurés : connexion requise
    return flatDatasets.filter((d) =>
      canUserOpenDataset(d, currentUser, { bootstrap: datasetAccessBootstrap })
    );
  }, [flatDatasets, currentUser, datasetAccessBootstrap]);

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

  // « ↩ Retour à l'expérience » (barre latérale + barre mobile) : rouvre la
  // dernière expérience ouverte — sur la même condition — depuis n'importe
  // quelle autre page, sans repasser par Projects/Experiments. Si l'expérience
  // a été supprimée entre-temps, la mémoire est simplement oubliée.
  const handleReturnToTest = () => {
    const target = lastOpenedTest;
    if (!target || !target.id) return;
    if (!tests.some((t) => t.id === target.id)) {
      setLastOpenedTest(null);
      writeLastExperiment(currentDatasetId, null);
      return;
    }
    jumpToTest(target.id);
  };

  // Open the dedicated Image Builder page (sidebar entry, or the "🖼 Saved
  // canvases" links of a project page). `canvasId` is a saved canvas of that
  // project's image library: the builder loads it as soon as it mounts.
  const openImageBuilder = (projectIdArg, canvasId = null) => {
    if (projectIdArg !== undefined) setCurrentProjectId(projectIdArg || null);
    setPendingCanvas(canvasId ? { projectId: projectIdArg || null, canvasId } : null);
    setCurrentModule('image-builder');
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

  // With NO scientists configured the app runs in bootstrap (superuser) mode —
  // there is nobody to log in as, so the entry gate would only show a dead-end
  // "No scientists configured / 🔓 Enter Recovery Mode" screen. This happens on
  // any fresh browser/device (e.g. opening the app from a phone), where the
  // operator list lives in another browser's localStorage. In that case skip
  // the gate entirely and open the workspace directly, matching the rest of
  // the app, which already treats an empty operator list as bootstrap.
  // Navigation d’une base d’administration : les pages du module sont
  // présentées dans la barre latérale comme les modules scientifiques.
  const adminNavEntries = isAdministrationKind(activeDatasetKind)
    ? ADMIN_PAGES.filter((p) => adminCanViewPage(p, currentUser, operators,
      (adminContent && adminContent.personnel) || [],
      (adminContent && adminContent.settings) || {})).map((p) => ({
        id: p.id, label: p.label, icon: p.icon,
      }))
    : [];
  // « Annuler » de l’en-tête de la base d’administration : restaure
  // l’instantané précédent du payload (voir l’effet HISTORIQUE UNDO ci-dessus).
  const handleAdminUndo = () => {
    if (adminHistoryIndex <= 0) return;
    const targetIdx = adminHistoryIndex - 1;
    const snapshot = adminHistoryRef.current[targetIdx];
    if (!snapshot) return;
    // Marque l’instantané comme « courant » pour que l’effet d’historique ne
    // l’empile pas une seconde fois lors du rendu suivant.
    adminHistorySnapshotRef.current = JSON.stringify(snapshot);
    setAdminHistoryIndex(targetIdx);
    setAdminContent(snapshot);
  };

  // « Retour » de l’en-tête de la base d’administration : remonte la pile des
  // pages visitées dans cette session (dernier LIFO, comme un historique back).
  const handleAdminBack = () => {
    if (adminPageStack.length === 0) return;
    const remaining = [...adminPageStack];
    const target = remaining.pop();
    setAdminPageStack(remaining);
    setCurrentAdminPage(target);
    setAdminFocus(null);
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  // Navigation d’une page d’administration (clic dans la barre latérale ou
  // lien inter-page). `focusPayload` optionnel = { kind, recordId } : une autre
  // page demande à pointer un enregistrement précis (fiche fournisseur,
  // ligne budgétaire, personne…) → la page d’arrivée le met en évidence.
  const handleAdminNav = (navId, focusPayload) => {
    setCurrentModule('administration');
    // Mémorise la page en cours pour le bouton « ← Retour » de l’en-tête : on
    // n’empile pas si on re-clique la page déjà active ou déjà au sommet.
    setAdminPageStack((prev) =>
      currentAdminPage === navId || prev[prev.length - 1] === navId
        ? prev
        : [...prev, currentAdminPage]
    );
    setCurrentAdminPage(navId);
    setAdminFocus(focusPayload && focusPayload.recordId
      ? { pageId: navId, kind: focusPayload.kind, recordId: focusPayload.recordId }
      : null);
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  // Bootstrap de l’équipe : sans superutilisateur défini, la création de
  // datasets reste possible (la page Paramètres d’une base permet alors de
  // définir le premier superutilisateur).
  const teamNoSuperuser = !hasDefinedSuperuser(operators);

  // Authentification SERVEUR prête (jetons signés + équipe publiée) : la session
  // Firebase devient OBLIGATOIRE (les règles Firestore n'acceptent qu'un jeton
  // signé), et le contournement de secours historique est neutralisé.
  const serverAuthReady = !!serverAuth.ready;
  const recoveryBypassActive = recoveryBypass && !serverAuthReady;
  // Liste proposée à l'écran de connexion : celle du serveur (nom + rôle, SANS
  // mot de passe) quand elle existe, sinon la copie locale historique.
  const loginRoster = serverRoster.length ? serverRoster : normalizeOperators(operators);
  const serverLoginMode = serverAuthReady || serverRoster.length > 0;

  const showLoginGate =
    (authSettings.requireLoginOnEntry || serverAuthReady) &&
    !user && !currentUser && !recoveryBypassActive &&
    (operatorNames.length > 0 || loginRoster.length > 0 || serverAuthReady);

  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen text-slate-400 text-sm">Loading…</div>}>
    <React.Fragment>

    {/* ══════════════════════════════════════════════════════
         FULL-SCREEN LOGIN GATE
         Blocks everything when requireLoginOnEntry is on.
    ══════════════════════════════════════════════════════ */}
    {showLoginGate && (
      <ScientistLoginGate
        operators={loginRoster}
        serverMode={serverLoginMode}
        serverStatus={serverAuth}
        onLogin={async (user, password) => {
          // Identité vérifiée CÔTÉ SERVEUR : le serveur de jetons contrôle le
          // mot de passe puis signe une session Firebase (claim « lab » + rôle).
          if (authServerConfigured()) {
            const res = await serverLogin(user && user.name, password);
            if (!res.ok) {
              if (serverAuthReady) {
                return { error: res.message || 'Connexion refusée par le serveur.' };
              }
              // Serveur configuré mais pas encore prêt (équipe non publiée) :
              // on informe sans bloquer, les règles Firestore n'étant pas
              // encore fermées. À régler AVANT de publier les règles.
              console.warn('[auth] connexion serveur indisponible:', res.error, res.message);
            } else {
              const applied = await applyServerSession(res.token);
              if (!applied.ok) return { error: applied.message };
              const identity = { id: res.id || user.id, name: res.name || user.name, role: res.role || user.role };
              setCurrentUser(identity);
              try { sessionStorage.setItem('labCurrentUser', JSON.stringify(identity)); } catch { /* ignore */ }
              return undefined;
            }
          }
          setCurrentUser(user);
          try { sessionStorage.setItem('labCurrentUser', JSON.stringify(user)); } catch { /* ignore */ }
          return undefined;
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
      showLoginGate ? ' hidden' : ''
    }`}>
<style>{`
        /* Mobile: 100vh extends under the browser toolbar (the bottom of fixed-height
           pages becomes unreachable). Use the dynamic viewport height wherever the
           layout is pinned to the screen. */
        @supports (height: 100dvh) {
          .h-screen { height: 100dvh !important; }
          .min-h-screen { min-height: 100dvh !important; }
          .max-h-screen { max-height: 100dvh !important; }
        }
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

      {/* One-time owner bootstrap (?drive-bootstrap=1): full-screen guidance so
          the Google-consent step is reachable from ANY screen (explorer or
          dataset), not only the sidebar button inside a dataset. */}
      {driveBootstrapOpen && (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.72)', backdropFilter: 'blur(4px)' }}>
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6">
            <div className="text-xl font-black text-slate-800 mb-1">🛠️ Shared Drive owner setup</div>
            <p className="text-sm text-slate-600 mb-3">
              This workspace saves its files on one <b>shared Google Drive account</b>. Before the first
              use the <b>owner</b> must connect it a single time: a Google consent popup opens and the
              permanent credential is stored on the Lab Workspace server. Every other user then needs no
              Google account for Drive.
            </p>
            <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-4">
              You opened the app with <code className="bg-slate-100 px-1 rounded">?drive-bootstrap=1</code> —
              this is the owner one-time flow. In the popup, sign in with the <b>workspace owner’s</b> Google
              account.
            </p>
            {driveBootstrapError && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4 whitespace-pre-line">
                {driveBootstrapError}
              </div>
            )}
            <button
              onClick={runDriveBootstrapConnect}
              disabled={driveBootstrapBusy}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-wait text-white font-bold py-2.5 px-4 rounded-lg text-sm transition-colors"
            >
              {driveBootstrapBusy ? 'Waiting for the Google consent popup…' : '🔑 Connect shared Drive (owner)'}
            </button>
            <button
              onClick={() => { dismissDriveBootstrapRef.current = true; setDriveBootstrapOpen(false); }}
              className="mt-3 w-full text-center text-xs font-bold text-slate-400 hover:text-slate-600"
            >
              Not now — I’ll use the “Reconnect shared Drive” button in the sidebar later
            </button>
          </div>
        </div>
      )}

      {pendingLoad && (
        <div className="fixed inset-0 bg-slate-900/50 z-[99999] flex items-center justify-center backdrop-blur-sm p-4">
          <div className="bg-white p-6 rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[92vh] overflow-y-auto">
            <h3 className="text-lg font-black text-slate-800 mb-2">
              {pendingLoad.isAdmin ? 'Restore Administration Base' : 'Load Workspace Data'}
            </h3>

            {pendingLoad.isAdmin ? (
              <>
                <p className="text-sm text-slate-500 mb-4">
                  This file contains an administration base ({' '}
                  <b>{pendingLoad.adminTitle
                    || (pendingLoad.fullState && (pendingLoad.fullState.title || pendingLoad.fullState.datasetTitle))
                    || 'sans titre'}</b>
                  ). Tick the pages to import: a ticked page replaces its counterpart and the other
                  pages of the open base stay untouched — or import everything to restore the base
                  exactly as saved.
                </p>
                <LoadPickPanel
                  sections={loadSections}
                  picked={loadPicked}
                  onToggle={toggleLoadPick}
                  onPickMany={pickManyLoad}
                />
                <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                  Accounts (operators) and the security configuration are never imported: they belong
                  to the application, not to the dataset.
                </p>
                <div className="flex flex-col gap-3 mt-4">
                  <button
                    onClick={() => confirmLoad('replace')}
                    disabled={loadPicked.length === 0}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-lg text-left transition-colors"
                  >
                    ♻️ Import the selected pages ({loadPicked.length})
                  </button>
                  <button
                    onClick={() => confirmLoad('replace', defaultSelection(loadSections))}
                    className="bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-800 font-bold py-2 px-4 rounded-lg text-left transition-colors"
                  >
                    ♻️ Import everything (restore the whole base)
                  </button>
                  <button
                    onClick={() => { setPendingLoad(null); setLoadPick(null); }}
                    className="mt-2 text-slate-500 hover:text-slate-700 text-sm font-bold py-2 w-full transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-slate-500 mb-4">
                  Choose the elements to import from this file (per row, per project, or whole pages),
                  then add them to the open dataset or replace what is already there.
                </p>
                <LoadPickPanel
                  sections={loadSections}
                  picked={loadPicked}
                  onToggle={toggleLoadPick}
                  onPickMany={pickManyLoad}
                />
                <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                  Un-ticked elements keep their current value; accounts (operators) and the security
                  configuration are never imported.
                </p>
                <div className="flex flex-col gap-3 mt-4">
                  <button
                    onClick={() => confirmLoad('append')}
                    disabled={loadPicked.length === 0}
                    className="bg-blue-50 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed border border-blue-200 text-blue-800 font-bold py-2 px-4 rounded-lg text-left transition-colors"
                  >
                    ➕ Add the selected elements ({loadPicked.length})
                  </button>

                  <button
                    onClick={() => confirmLoad('replace')}
                    disabled={loadPicked.length === 0}
                    className="bg-red-50 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed border border-red-200 text-red-800 font-bold py-2 px-4 rounded-lg text-left transition-colors"
                  >
                    🔄 Replace the selected elements
                  </button>

                  <button
                    onClick={() => confirmLoad('replace', defaultSelection(loadSections))}
                    className="bg-red-50 hover:bg-red-100 border border-red-200 text-red-800 font-bold py-2 px-4 rounded-lg text-left transition-colors"
                  >
                    🔄 Import everything (replace the dataset)
                  </button>

                  <button
                    onClick={() => { setPendingLoad(null); setLoadPick(null); }}
                    className="mt-2 text-slate-500 hover:text-slate-700 text-sm font-bold py-2 w-full transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {accessEditorDataset && (
        <DatasetAccessModal
          dset={accessEditorDataset}
          operators={operators}
          onClose={() => setAccessEditorDataset(null)}
          onSave={async (dsetId, access) => {
            await saveDatasetAccess(dsetId, access);
            setAccessEditorDataset(null);
          }}
        />
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

          {(currentUser?.role === 'superuser' || operatorNames.length === 0 || recoveryBypass || teamNoSuperuser) ? (
            <div className="flex flex-col items-center gap-3 w-full">
              <button
                onClick={() => createNewDataset('scientific')}
                disabled={!isCloudReady}
                className={`font-black py-3 md:py-4 px-6 md:px-10 rounded-full shadow-lg transition-all transform hover:scale-105 flex items-center gap-3 text-base md:text-lg w-full md:w-auto justify-center ${
                  isCloudReady
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                }`}
              >
                <span className="text-2xl">+</span> {operatorNames.length === 0 ? 'Initialize Workspace & Create Dataset' : 'Create New Dataset'}
              </button>

              <div className="flex flex-col items-center gap-1.5">
                <button
                  onClick={() => createNewDataset('administration')}
                  disabled={!isCloudReady}
                  className={`font-black py-2.5 px-6 md:px-8 rounded-full shadow-lg transition-all transform hover:scale-105 flex items-center gap-2 text-sm md:text-base w-full md:w-auto justify-center ${
                    isCloudReady
                      ? 'bg-slate-800 hover:bg-slate-900 text-white'
                      : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  🏛️ Créer une base d’administration
                </button>
                <span className="text-[11px] font-semibold text-slate-400">
                  Recettes, fournisseurs, personnel, dépenses, missions… dans un dataset dédié.
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-slate-400 bg-slate-100 border border-slate-200 rounded-full px-5 py-3 text-sm font-semibold">
              🔒 Creating datasets requires superuser access
            </div>
          )}

              {/* There is deliberately NO cloud sign-in button here any more:
                  Firestore reads AND writes work without a Google account, so a
                  new device (phone, another browser) already pulls the datasets
                  that were saved from elsewhere. */}


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
                        onClick={handleSignOut}
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
               {/* Delete Empty — superuser / bootstrap / recovery */}
               {(currentUser?.role === 'superuser' || operatorNames.length === 0 || recoveryBypass) && (
                 <button
                   onClick={(e) => redirectDeleteToSettings(e, 'Delete Empty Datasets')}
                   className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold py-2 px-4 rounded-lg shadow-sm transition-colors flex-1 md:flex-none items-center justify-center gap-2 cursor-pointer text-sm"
                 >
                   🗑️ Delete Empty
                 </button>
               )}
               {/* Rendre TOUS les datasets visibles par l’équipe — superuser / bootstrap / recovery */}
               {(currentUser?.role === 'superuser' || operatorNames.length === 0 || recoveryBypass) && (
                 <button
                   onClick={makeAllDatasetsTeamVisible}
                   disabled={allVisibleBusy}
                   className={`bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold py-2 px-4 rounded-lg shadow-sm transition-colors flex-1 md:flex-none flex items-center justify-center gap-2 text-sm ${allVisibleBusy ? 'opacity-60 cursor-wait' : 'cursor-pointer'}`}
                   title="Dé-coche « Restreindre la visibilité aux membres » sur TOUS les datasets : ils redeviennent visibles par tous les comptes de l’équipe (les listes de membres sont conservées)"
                 >
                   {allVisibleBusy ? '⏳ Mise à jour…' : '🌐 Rendre visibles à toute l’équipe'}
                 </button>
               )}

               {/* Load HTML — superuser / bootstrap / recovery */}
               {(currentUser?.role === 'superuser' || operatorNames.length === 0 || recoveryBypass) && (
                 <label className="bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 font-bold py-2 px-4 rounded-lg shadow-sm transition-colors flex-1 md:flex-none flex items-center justify-center gap-2 cursor-pointer text-sm">
                   📂 Load HTML File
                   <input type="file" accept=".html" onChange={loadHTML} className="hidden" />
                 </label>
               )}
                <div className="flex flex-wrap gap-2 w-full md:w-auto">

                </div>
              </div>

              {isCloudReady && flatDatasets.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-md flex flex-col items-center gap-3">
                  <span className="text-4xl opacity-30">📂</span>
                  <span>No datasets found in cloud or local storage.</span>
                  <span className="text-xs max-w-md text-slate-400 leading-relaxed">
                    Every dataset is saved to the shared cloud workspace, so it shows up here
                    automatically on any device — no sign-in needed. If this list is empty, the cloud
                    may be unreachable right now; a superuser can restore a copy with
                    “📂 Load HTML File” below.
                  </span>
                </div>
              ) : visibleDatasets.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-md flex flex-col items-center gap-3">
                  <span className="text-4xl opacity-30">🔒</span>
                  <span>Aucun dataset n’est visible pour votre compte.</span>
                  <span className="text-xs max-w-md text-slate-400 leading-relaxed">
                    Chaque dataset n’est visible que par les utilisateurs définis comme membres.
                    Demandez au superutilisateur de vous ajouter (bouton « 👥 Membres » sur la
                    carte du dataset côté superutilisateur).
                  </span>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                  {visibleDatasets.map((dset) => (
                    <div
                      key={dset.id}
                      onClick={() => openDataset(dset)}
                      className="bg-white border border-slate-200 hover:border-blue-400 hover:shadow-md p-3 rounded-lg cursor-pointer flex justify-between items-center transition-all group/item"
                    >
                      <div className="flex flex-col overflow-hidden">
                        <span className="font-bold text-sm text-blue-700 truncate">
                          {dset.title || 'Untitled'}
                          {isDatasetRestricted(dset) && (
                            <span
                              className="ml-1 align-middle"
                              title="Accès restreint : seuls les membres définis + le superutilisateur voient ce dataset"
                            >🔒</span>
                          )}
                          {!isDatasetRestricted(dset) && (
                            <span className="ml-1 align-middle" title="Visible par TOUS les comptes de l’équipe — bouton « 👥 Membres » pour restreindre">🌐</span>
                          )}

                        </span>

                        <span className="text-[11px] text-slate-500 mt-1 flex gap-2">
                          <span>📅 {dset.date || 'No Date'}</span>
                          {dset.kind === 'administration' ? (
                            <span>🏛️ Base d’administration</span>
                          ) : (
                            <span>🧪 {dset.testCount || 1} Tests</span>
                          )}
                        </span>
                      </div>

                      {/* Rename / Delete — superuser only */}
                      {currentUser?.role === 'superuser' && (
                        <div className="flex flex-col gap-1 opacity-100 md:opacity-0 group-hover/item:opacity-100 transition-all shrink-0 ml-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); setAccessEditorDataset(dset); }}
                            className="text-slate-500 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded text-xs font-bold transition-colors text-right"
                            title="Choisir qui voit ce dataset (membres) — réservé au superutilisateur"
                          >
                            👥 Membres
                          </button>

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

            {/* Retour direct à la dernière expérience ouverte (voir
                readLastExperiment) : sur mobile la barre latérale est repliée,
                ce raccourci évite de la rouvrir pour retrouver sa page. */}
            {lastOpenedTest && currentModule !== 'active-test' ? (
              <button
                type="button"
                onClick={handleReturnToTest}
                className="shrink-0 flex items-center gap-1 max-w-[42%] px-2 py-1 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-[11px] font-bold"
                title={`Back to the experiment you were working on: ${lastOpenedTest.name}${lastOpenedTest.instanceName ? ` — ${lastOpenedTest.instanceName}` : ''}`}
              >
                ↩ <span className="truncate">{lastOpenedTest.name}</span>
              </button>
            ) : (
              <div className="w-8"></div>
            )}
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
            saveStatus={saveStatus} saveErrorMsg={saveErrorMsg} saveTarget={saveTarget}
            backupStatus={backupStatus}
            currentUser={currentUser} setCurrentUser={setCurrentUser}
            onSignOut={handleSignOut}
            setUnlockedTestIds={setUnlockedTestIds} setLoginModal={setLoginModal}
            currentModule={currentModule} setCurrentModule={setCurrentModule}
            handlePrint={handlePrint} loadHTML={loadHTML} exportHTML={exportHTML}
            handleUndo={handleUndo} handleRedo={handleRedo}
            historyIndex={historyIndex} historyRef={historyRef}
            datasetKind={activeDatasetKind}
            adminNav={adminNavEntries}
            currentAdminPage={currentAdminPage}
            onAdminNav={handleAdminNav}
            onConnectDrive={connectDrive}
            lastOpenedTest={lastOpenedTest}
            onReturnToTest={handleReturnToTest}
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
              operatorNames={operatorNames} openImageBuilder={openImageBuilder}
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
            {currentModule === 'active-test' && (<SectionsScope value={activeTestId}><ActiveTestModule
              activeTestId={activeTestId} additives={additives} allCellLines={allCellLines} allCmpds={allCmpds}
              appClipboard={appClipboard} buffers={buffers} cmpColors={cmpColors} compoundMeta={compoundMeta}
              createEmptyTest={createEmptyTest} currentUser={currentUser} customCmpds={customCmpds} customConc={customConc} customFields={customFields}
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
            /></SectionsScope>)}
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

            {/* Image Builder: dedicated page, siblings with Publications in the
                sidebar (it used to be appended to the Publications page).
                openCanvasId → the saved canvas a project page asked to reopen;
                onBackToProject → the "📁 Project page" button of the builder. */}
            {currentModule === 'image-builder' && (<ImageBuilderModule
              projectId={currentProjectId} jumpToTest={jumpToTest}
              openCanvasId={(pendingCanvas && pendingCanvas.projectId === (currentProjectId || null)) ? pendingCanvas.canvasId : null}
              onCanvasOpened={() => setPendingCanvas(null)}
              onBackToProject={currentProjectId ? () => setCurrentModule('project-detail') : undefined}
            />)}

            {currentModule === 'administration' && (<AdministrationModule
              currentUser={currentUser} user={user}
              datasetTitle={datasetTitle} saveStatus={saveStatus}
              content={adminContent} onChange={setAdminContent}
              pageId={currentAdminPage}
              operators={operators} setOperators={setOperators}
              authSettings={authSettings} setAuthSettings={setAuthSettings}
              onRequestLogin={() => setLoginModal({ isEntryGate: false })}
              onNavigateAdmin={handleAdminNav}
              adminFocus={adminFocus}
              onClearFocus={() => setAdminFocus(null)}
              canAdminBack={adminPageStack.length > 0}
              onAdminBack={handleAdminBack}
              canAdminUndo={adminHistoryIndex > 0}
              onAdminUndo={handleAdminUndo}
            />)}
          </div>
        </div>
      )}
    </div>

    {/* The new ScientistLoginGate above (fixed full-screen) handles requireLoginOnEntry for ALL views */}

{/* ── Generic Login Modal (triggered by sidebar or locked tests) ── */}
    {loginModal && !((authSettings.requireLoginOnEntry || serverAuthReady) && !currentUser && !user) && (
      <ScientistLoginModal
        operators={
          loginModal.targetScientistName
            ? (serverRoster.length ? serverRoster : normalizeOperators(operators)).filter((op) => op.name === loginModal.targetScientistName)
            : (serverRoster.length ? serverRoster : normalizeOperators(operators))
        }
        serverMode={serverLoginMode}
        title={loginModal.targetScientistName ? `Log in as ${loginModal.targetScientistName}` : 'Scientist Login'}
        subtitle={loginModal.targetScientistName
          ? `This test belongs to ${loginModal.targetScientistName}. Enter their password to continue.`
          : 'Select your name and enter your password to access protected data.'}
        onLogin={async (user, password) => {
          // Ce modal (barre latérale, test verrouillé) doit passer par le même
          // contrôle serveur que l'écran de connexion : sans session Firebase,
          // les règles Firestore refusent toute lecture/écriture.
          if (authServerConfigured()) {
            const res = await serverLogin(user && user.name, password);
            if (!res.ok) {
              if (serverAuthReady) return { error: res.message || 'Connexion refusée par le serveur.' };
              console.warn('[auth] connexion serveur indisponible:', res.error, res.message);
            } else {
              const applied = await applyServerSession(res.token);
              if (!applied.ok) return { error: applied.message };
              const identity = { id: res.id || user.id, name: res.name || user.name, role: res.role || user.role };
              setCurrentUser(identity);
              try { sessionStorage.setItem('labCurrentUser', JSON.stringify(identity)); } catch { /* ignore */ }
              if (loginModal.onSuccess) loginModal.onSuccess(identity);
              else setLoginModal(null);
              return undefined;
            }
          }
          if (loginModal.onSuccess) {
            loginModal.onSuccess(user);
          } else {
            setCurrentUser(user);
            setLoginModal(null);
          }
          return undefined;
        }}
        onClose={() => setLoginModal(null)}
      />
    )}
    </React.Fragment>
    </Suspense>
  );
}
