import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import LZString from 'lz-string';
import {
  DEFAULT_FIREBASE_CONFIG, LOCAL_STORAGE_KEY, PLATES_DEF,
  DEF_COMPOUNDS, DEF_CELL_LINES, getDirectImageUrl, parsePayload, BOX_ROW_LABELS
} from './data/constants';
import { NMRTestRenderer } from './components/NMRTestRenderer';
import { PlateTestRenderer } from './components/PlateTestRenderer';
import { LabNotebook } from './components/LabNotebook';
import { RichTextEditor } from './components/RichTextEditor';

// --- MIGRAZIONE LEGACY (V1 -> V2) ---
const migrateLoadedDataset = (s) => {
  const rawTests = (s && (s.tests || s.plates)) || [];
  let tests = rawTests.map(p => {
    let safeComments = typeof p.comments === 'string' ? p.comments : '';
    safeComments = safeComments.replace(/<img[^>]+src="data:image\/[^;]+;base64,([^">]{500000,})"[^>]*>/gi, '<br/><span style="color:red;font-size:10px;font-weight:bold;">[Massive image removed]</span><br/>');
    let safeImages = Array.isArray(p.images) ? p.images.filter(img => typeof img === 'string' && !(img.startsWith('data:image/') && img.length > 500000)) : [];
    let migratedType = p.type;
    if (!migratedType && p.plateType) migratedType = p.plateType === '9x9box' ? 'plate-9x9box' : 'plate-' + p.plateType;
    let migratedCategory = p.testCategory || (p.expTypes && p.expTypes.length > 0 ? p.expTypes[0] : 'Activity');
    if (migratedType === 'nmr') {
      return {
        moleculeName: '', experimentDate: '', concentration: '', solvent: '', saltConcentration: '', temperature: '', otherMolecule: '', ratio: '', tableMode: 'backbone', compound: '',
        ...p, type: 'nmr', testCategory: migratedCategory, comments: safeComments, images: safeImages
      };
    }
    return { ...p, type: migratedType || 'plate-96', testCategory: migratedCategory, comments: safeComments, images: safeImages };
  });
  const existingStorages = (s && s.storages) ? s.storages.slice() : [];
  const legacyGroups = {};
  tests.forEach(t => {
    if (t.type !== 'plate-9x9box' || t.storageId) return;
    const label = typeof t.storageLabel === 'string' ? t.storageLabel.trim() : '';
    const typeText = typeof t.storageType === 'string' ? t.storageType.trim() : '';
    if (!label && !typeText) return;
    const key = typeText + '||' + label;
    if (!legacyGroups[key]) legacyGroups[key] = { typeText, label, items: [] };
    legacyGroups[key].items.push(t);
  });
  const newStorages = [];
  Object.values(legacyGroups).forEach((group, gi) => {
    const normType = /frigo|refriger/i.test(group.typeText) ? 'Refrigerator' : /clos|armad/i.test(group.typeText) ? 'Closet' : 'Freezer';
    const stId = 'st_legacy_' + Date.now().toString(36) + '_' + gi;
    const cols = 4;
    const rows = Math.max(5, Math.ceil(group.items.length / cols));
    newStorages.push({ id: stId, name: group.label || group.typeText || ('Imported Storage ' + (gi + 1)), type: normType, rows, cols, imageUrl: '' });
    group.items.forEach((t, idx) => { t.storageId = stId; t.storageIndex = idx; });
  });
  return { tests, storages: newStorages.length > 0 ? [...existingStorages, ...newStorages] : existingStorages };
};

// --- INIZIALIZZAZIONE FIREBASE CLOUD ---
const FIREBASE_CONFIG = {
  apiKey: "AQ.Ab8RN6I7-6yNsQyx8f39A4YT6Hp5jNWxz2JCxq2ZEwJ5Zhy1aQ",
  authDomain: "cell-experiment-tracker.firebaseapp.com",
  projectId: "cell-experiment-tracker",
  storageBucket: "cell-experiment-tracker.firebasestorage.app",
  messagingSenderId: "855790481107",
  appId: "1:855790481107:web:a566455d3f13a48a20ae26"
};

let app, auth, db, appId = 'lab-workspace-app';
try {
  if (!window.firebase.apps.length) {
    app = window.firebase.initializeApp(FIREBASE_CONFIG);
  } else {
    app = window.firebase.app();
  }
  auth = window.firebase.auth();
  db = window.firebase.firestore();
} catch (e) {
  console.error("Firebase init error. Falling back to local storage.", e);
}

export default function App() {
  const createEmptyTest = (id, num, customType = 'plate-96') => {
    const baseTest = {
      id, name: `Test ${num}`, date: new Date().toISOString().split('T')[0], instanceName: '',
      testCategory: 'Activity', type: customType, storageType: '', storageLabel: '', storageIndex: null,
      comments: '', images: [], documents: [], plan: [], linkedProtocolId: '',
    };
    if (customType.startsWith('plate')) {
      const dimKey = customType.split('-')[1];
      const dim = PLATES_DEF[dimKey] || PLATES_DEF['96'];
      const defGrid = Array(26).fill(null).map(() => Array(26).fill(''));
      const defCell = Array(26).fill(null).map(() => Array(26).fill(null).map(() => ({ excluded: false, role: null, conc: null, region: 'Primary', manualOverride: false })));
      return {
        ...baseTest, plateType: dimKey, grid: defGrid, boxRows: 9, boxCols: 9,
        compounds: Array(dim.cols).fill(''), rowCompounds: Array(dim.rows).fill(''), cellConfig: defCell,
        ctrlType: 'cells', ctrlODStr: '1.0', bgType: 'none', bgManualStr: '0', unit: 'µM', cellsSeeded: '', test: '',
        manualErrors: {}, topConcStr: '100', dilFactorStr: '3', glbOffsetStr: '0', errScaleStr: '1', useFixedSD: false, fixedSDStr: '0', showViab: true, fitIC50: true, showExcl: false, outlierThreshStr: '2.0',
        chartCfg: { yMin: '', yMax: '', xMin: '', xMax: '', ptStyle: 'circle', ptSize: 5, fontSize: 16, xPos: 'bottom', yPos: 'left', xAxisLabel: '', lineStyle: 'solid', lineThickness: 2 }
      };
    } else if (customType === 'nmr') {
      return {
        ...baseTest,
        proteinSequence: '', selectedNuclei: ['H', 'C', 'N'], chemicalShifts: {}, nmrSpectraImages: [],
        moleculeName: '', experimentDate: '', concentration: '', solvent: '', saltConcentration: '', temperature: '', otherMolecule: '', ratio: '', tableMode: 'backbone', compound: '',
        showSpectraSimulation: false
      };
    }
    return baseTest;
  };

  const [user, setUser] = useState(null);
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
  const [storages, setStorages] = useState([]);
  const [activeStorageId, setActiveStorageId] = useState(null);
  const [storageModal, setStorageModal] = useState(null);
  const [moveModal, setMoveModal] = useState(null);
  const [testCategories, setTestCategories] = useState(["Activity", "Toxicity", "Microscopy", "Flow Cytometry", "Viability"]);
  const [protocolCategories, setProtocolCategories] = useState(["Preparation", "Measurement", "Analysis"]);
  const [datasetProtocols, setDatasetProtocols] = useState([]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const historyRef = useRef([[createEmptyTest('t1', 1, 'plate-96')]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [reactTests, setReactTests] = useState(historyRef.current[0]);
  const tests = reactTests;
  const [activeTestId, setActiveTestId] = useState('t1');

  const setTests = useCallback((updater) => {
    setReactTests(prev => {
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
  }, [historyIndex]);

  const handleUndo = () => { if (historyIndex > 0) { const newIdx = historyIndex - 1; setHistoryIndex(newIdx); setReactTests(historyRef.current[newIdx]); } };
  const handleRedo = () => { if (historyIndex < historyRef.current.length - 1) { const newIdx = historyIndex + 1; setHistoryIndex(newIdx); setReactTests(historyRef.current[newIdx]); } };

  // --- FIREBASE AUTH & SYNC ---
  useEffect(() => {
    if (!auth) {
      setIsCloudReady(true);
      return;
    }
    const initAuth = async () => {
      try {
        if (typeof window.__initial_auth_token !== 'undefined' && window.__initial_auth_token) {
          try { await auth.signInWithCustomToken(window.__initial_auth_token); }
          catch (err) { await auth.signInAnonymously(); }
        } else {
          await auth.signInAnonymously();
        }
      } catch (e) { console.error("Auth error", e); setIsCloudReady(true); }
    };
    initAuth();
  }, []);

  // FIX: Leggi subito da localStorage come fallback, poi sincronizza col cloud
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (stored) {
        const localDatasets = JSON.parse(stored).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        setDatasetsList(localDatasets);
      }
    } catch (e) {}

    if (db) {
      const collRef = db.collection(`artifacts/${appId}/public/data/datasets`);
      const unsubscribe = collRef.onSnapshot((snap) => {
        const dsets = [];
        snap.forEach(doc => { dsets.push({ id: doc.id, ...doc.data() }); });
        dsets.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        setDatasetsList(dsets);
        setIsCloudReady(true);
      }, (err) => {
        console.error("Firestore sync error:", err);
        setIsCloudReady(true);
      });
      return () => unsubscribe();
    } else {
      setIsCloudReady(true);
    }
  }, [user, db]);

  const latestDataRef = useRef(null);
  latestDataRef.current = { tests, datasetTitle, datasetSubtitle, customCmpds, customCellLines, customConc, cmpColors, testCategories, protocolCategories, datasetProtocols, storages };
  const getCompressedPayload = () => LZString.compressToUTF16(JSON.stringify(latestDataRef.current));
  const saveTimeoutRef = useRef(null);

  useEffect(() => {
    if (!isCloudReady || appView !== 'dataset' || !currentDatasetId) return;
    setSaveStatus('saving');
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const updatedPayload = {
          title: datasetTitle || 'Untitled Dataset', subtitle: datasetSubtitle || '',
          date: tests[0]?.date || new Date().toISOString().split('T')[0],
          testCount: tests.length, updatedAt: Date.now(),
          payload: getCompressedPayload(), isCompressed: true
        };
        if (db && user) {
          const docRef = db.collection(`artifacts/${appId}/public/data/datasets`).doc(currentDatasetId);
          await docRef.set(updatedPayload, { merge: true }).then(() => {
            setSaveStatus('saved'); setSaveErrorMsg('');
          }).catch(err => {
            setSaveStatus('error'); setSaveErrorMsg(err.message);
          });
        } else {
          let stored = [];
          try { stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]'); } catch (e) {}
          const existingIdx = stored.findIndex(e => e.id === currentDatasetId);
          const newDset = { id: currentDatasetId, ...updatedPayload };
          if (existingIdx >= 0) stored[existingIdx] = { ...stored[existingIdx], ...newDset }; else stored.push(newDset);
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stored));
          setDatasetsList([...stored].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
          setSaveStatus('saved');
        }
      } catch (e) { setSaveStatus('error'); setSaveErrorMsg(e.message); }
    }, 1500);
  }, [tests, datasetTitle, datasetSubtitle, customCmpds, customCellLines, customConc, cmpColors, testCategories, protocolCategories, datasetProtocols, isCloudReady, appView, currentDatasetId, user]);

  const exportHTML = () => {
    try {
      const payload = getCompressedPayload();
      const dataBlob = { payload, isCompressed: true, title: datasetTitle || 'Untitled Dataset', subtitle: datasetSubtitle || '', savedAt: Date.now() };
      const clone = document.documentElement.cloneNode(true);
      const oldTag = clone.querySelector('#saved-data-blob'); if (oldTag) oldTag.remove();
      const oldLoader = clone.querySelector('#loader'); if (oldLoader) oldLoader.style.display = 'none';
      const tag = document.createElement('script'); tag.id = 'saved-data-blob'; tag.type = 'application/json'; tag.textContent = JSON.stringify(dataBlob);
      clone.querySelector('body').appendChild(tag);
      const htmlStr = '<!DOCTYPE html>\n' + clone.outerHTML;
      const blob = new Blob([htmlStr], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${(datasetTitle || 'dataset').replace(/[^a-z0-9]+/gi, '_')}.html`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setDialog({ type: 'alert', title: 'Save Failed', message: 'Could not save HTML file: ' + e.message }); }
  };

  const loadHTML = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 900000) setDialog({ type: 'alert', title: 'Large File Warning', message: 'This file is very large. After loading, saving to cloud might fail due to the 1MB limit. Consider removing embedded images.' });
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target.result; let s = null; let loadedTests = [];
        const newMatch = text.match(/<script[^>]*id=["']saved-data-blob["'][^>]*>([\s\S]*?)<\/script>/);
        if (newMatch) {
          const dataBlob = JSON.parse(newMatch[1]);
          let pStr = dataBlob.payload;
          if (dataBlob.isCompressed) { const dec = LZString.decompressFromUTF16(pStr); if (dec) pStr = dec; }
          s = JSON.parse(pStr);
          loadedTests = s.tests || s.plates || [];
          if (loadedTests.length === 0) { setDialog({ type: 'alert', title: 'Load Failed', message: 'No tests found in this file.' }); return; }
        } else { setDialog({ type: 'alert', title: 'Load Failed', message: 'No dataset data found in this HTML file.' }); return; }
        const migrated = migrateLoadedDataset(s);
        loadedTests = migrated.tests;
        s.storages = migrated.storages;
        setPendingLoad({ tests: loadedTests, fullState: s });
      } catch (err) { setDialog({ type: 'alert', title: 'Load Failed', message: 'Could not read this file: ' + err.message }); }
    };
    reader.readAsText(file); e.target.value = '';
  };

  const confirmLoad = (mode) => {
    const { tests: loadedTests, fullState: s } = pendingLoad;
    if (mode === 'replace') {
      setReactTests(loadedTests); historyRef.current = [loadedTests]; setHistoryIndex(0); setActiveTestId(loadedTests[0].id);
      if (s.datasetTitle !== undefined) setDatasetTitle(s.datasetTitle); else if (s.reportTitle !== undefined) setDatasetTitle(s.reportTitle);
      if (s.datasetSubtitle !== undefined) setDatasetSubtitle(s.datasetSubtitle); else if (s.reportSubtitle !== undefined) setDatasetSubtitle(s.reportSubtitle);
      if (s.customCmpds !== undefined) setCustomCmpds(s.customCmpds);
      if (s.customCellLines !== undefined) setCustomCellLines(s.customCellLines);
      if (s.customConc !== undefined) setCustomConc(s.customConc);
      if (s.cmpColors !== undefined) setCmpColors(s.cmpColors);
      if (s.testCategories !== undefined) setTestCategories(s.testCategories);
      if (s.protocolCategories !== undefined) setProtocolCategories(s.protocolCategories);
      if (s.datasetProtocols !== undefined) setDatasetProtocols(s.datasetProtocols);
      if (s.storages !== undefined) setStorages(s.storages);
    } else if (mode === 'append') {
      const newTests = loadedTests.map(p => ({ ...p, id: 't' + Math.random().toString(36).substr(2, 9) + Date.now() }));
      setTests(prev => [...prev, ...newTests]); setActiveTestId(newTests[0].id);
      if (s.customCmpds !== undefined) setCustomCmpds(prev => [...new Set([...prev, ...s.customCmpds])]);
      if (s.customCellLines !== undefined) setCustomCellLines(prev => [...new Set([...prev, ...s.customCellLines])]);
      if (s.customConc !== undefined) setCustomConc(prev => ({ ...prev, ...s.customConc }));
      if (s.cmpColors !== undefined) setCmpColors(prev => ({ ...prev, ...s.cmpColors }));
      if (s.storages !== undefined) {
        setStorages(prev => { const merged = [...prev]; s.storages.forEach(newSt => { if (!merged.find(st => st.id === newSt.id)) merged.push(newSt); }); return merged; });
      }
    }
    setPendingLoad(null); setCurrentModule('tests');
  };

  const createNewDataset = async () => {
    const newId = 'ds_' + Date.now();
    const freshTests = [createEmptyTest('t1', 1, 'plate-96')];
    setReactTests(freshTests); historyRef.current = [freshTests]; setHistoryIndex(0); setActiveTestId('t1');
    setDatasetTitle('New Dataset'); setDatasetSubtitle(''); setCustomCmpds([]); setCustomCellLines([]); setCustomConc({});
    setTestCategories(["Activity", "Toxicity", "Microscopy", "Flow Cytometry", "Viability"]);
    setProtocolCategories(["Preparation", "Measurement", "Analysis"]); setDatasetProtocols([]); setStorages([]);
    setCurrentDatasetId(newId); setAppView('dataset'); setCurrentModule('dashboard');
    const updatedPayload = {
      title: 'New Dataset', date: new Date().toISOString().split('T')[0], createdAt: Date.now(), updatedAt: Date.now(),
      payload: LZString.compressToUTF16(JSON.stringify({ tests: freshTests })), isCompressed: true
    };
    if (db && user) {
      await db.collection(`artifacts/${appId}/public/data/datasets`).doc(newId).set(updatedPayload);
    } else {
      let stored = []; try { stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]'); } catch (e) {}
      stored.push({ id: newId, ...updatedPayload }); localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stored));
      setDatasetsList([...stored].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
    }
  };

  const handleBackToExplorer = async () => {
    if (currentDatasetId) {
      setSaveStatus('saving'); if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      try {
        const updatedPayload = {
          title: datasetTitle || 'Untitled Dataset', subtitle: datasetSubtitle || '', date: tests[0]?.date || new Date().toISOString().split('T')[0],
          testCount: tests.length, updatedAt: Date.now(), payload: getCompressedPayload(), isCompressed: true
        };
        if (db && user) {
          await db.collection(`artifacts/${appId}/public/data/datasets`).doc(currentDatasetId).set(updatedPayload, { merge: true });
        } else {
          let stored = []; try { stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]'); } catch (e) {}
          const existingIdx = stored.findIndex(e => e.id === currentDatasetId);
          if (existingIdx >= 0) stored[existingIdx] = { ...stored[existingIdx], ...updatedPayload }; else stored.push({ id: currentDatasetId, ...updatedPayload });
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stored));
          setDatasetsList([...stored].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
        }
      } catch (e) {}
    }
    setAppView('explorer');
  };

  const openDataset = (dset) => {
    const s = parsePayload(dset); if (!s) return;
    try {
      const migrated = migrateLoadedDataset(s);
      const loadedTests = migrated.tests;
      if (loadedTests.length > 0) { setReactTests(loadedTests); historyRef.current = [loadedTests]; setHistoryIndex(0); setActiveTestId(loadedTests[0].id); }
      else { const fresh = [createEmptyTest('t1', 1)]; setReactTests(fresh); historyRef.current = [fresh]; setHistoryIndex(0); setActiveTestId('t1'); }
      setDatasetTitle(s.datasetTitle !== undefined ? s.datasetTitle : (s.reportTitle !== undefined ? s.reportTitle : (dset.title || 'Untitled')));
      setDatasetSubtitle(s.datasetSubtitle !== undefined ? s.datasetSubtitle : (s.reportSubtitle || ''));
      setCustomCmpds(s.customCmpds || []); setCustomCellLines(s.customCellLines || []); setCustomConc(s.customConc || {}); setCmpColors(s.cmpColors || {});
      setTestCategories(s.testCategories || ["Activity", "Toxicity", "Microscopy", "Flow Cytometry", "Viability"]);
      setProtocolCategories(s.protocolCategories || ["Preparation", "Measurement", "Analysis"]);
      setDatasetProtocols(s.datasetProtocols || []); setStorages(migrated.storages);
      setCurrentDatasetId(dset.id); setAppView('dataset'); setCurrentModule('dashboard');
    } catch (e) { setDialog({ type: 'alert', title: 'Error', message: "Error reading dataset structure." }); }
  };

  const deleteDataset = (e, id) => {
    e.stopPropagation();
    setDialog({
      type: 'confirm', title: 'Delete Dataset', message: 'Are you sure you want to delete this entire Dataset?',
      onConfirm: async () => {
        if (db && user) {
          await db.collection(`artifacts/${appId}/public/data/datasets`).doc(id).delete();
        } else {
          let stored = []; try { stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]'); } catch (e) {}
          stored = stored.filter(d => d.id !== id); localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stored));
          setDatasetsList(stored);
        }
      }
    });
  };

  const renameDataset = (e, id, currentTitle) => {
    e.stopPropagation();
    setDialog({
      type: 'prompt', title: 'Rename Dataset', message: 'Enter a new title for this Dataset:', defaultValue: currentTitle,
      onConfirm: async (newTitle) => {
        if (newTitle && newTitle.trim() !== currentTitle) {
          if (db && user) {
            await db.collection(`artifacts/${appId}/public/data/datasets`).doc(id).update({ title: newTitle.trim() });
          } else {
            let stored = []; try { stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]'); } catch (e) {}
            const idx = stored.findIndex(d => d.id === id);
            if (idx >= 0) { stored[idx].title = newTitle.trim(); localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stored)); setDatasetsList(stored); }
          }
        }
      }
    });
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState({});
  const toggleGroup = (key) => setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));

  const groupedDatasets = useMemo(() => {
    const groups = {};
    datasetsList.forEach(dset => {
      let catSet = new Set(); let cellSet = new Set();
      try {
        const s = parsePayload(dset);
        if (s && s.tests) {
          s.tests.forEach(t => {
            if (t.testCategory) catSet.add(t.testCategory);
            if (Array.isArray(t.cellLines)) t.cellLines.forEach(e => cellSet.add(e));
          });
        }
      } catch (e) {}
      const catStr = Array.from(catSet).sort().join(', ');
      const cellStr = Array.from(cellSet).sort().join(', ');
      const hasMeta = catStr || cellStr;
      const key = hasMeta ? `${catStr}|${cellStr}` : `unclassified_${dset.id}`;
      if (!groups[key]) { groups[key] = { key, categories: catStr, cellLines: cellStr, isUnclassified: !hasMeta, items: [] }; }
      groups[key].items.push(dset);
    });
    Object.values(groups).forEach(g => { g.items.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)); });
    return groups;
  }, [datasetsList]);

  const [currentMonth, setCurrentMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [calFilterDate, setCalFilterDate] = useState(null);

  const mergedPlan = useMemo(() => {
    const all = []; tests.forEach(t => { (t.plan || []).forEach(task => { all.push({ ...task, testName: t.name, testId: t.id }); }); });
    const sorted = all.sort((a, b) => a.date.localeCompare(b.date));
    if (calFilterDate) return sorted.filter(t => t.date === calFilterDate); return sorted;
  }, [tests, calFilterDate]);

  const agendaGrouped = useMemo(() => {
    const sorted = [...mergedPlan].sort((a, b) => a.date.localeCompare(b.date));
    return sorted.reduce((acc, t) => { acc[t.date] = acc[t.date] || []; acc[t.date].push(t); return acc; }, {});
  }, [mergedPlan]);

  const daysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();
  const startDayOffset = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;
  const totalDays = daysInMonth(currentMonth.getFullYear(), currentMonth.getMonth());
  const monthName = currentMonth.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const handlePrevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  const handleNextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));

  const storageItems = useMemo(() => {
    const items = [];
    tests.forEach(t => {
      if (t.storageType || t.storageLabel || t.type === 'plate-9x9box') {
        items.push({ id: t.id, name: t.name, instanceName: t.instanceName || t.date, storageType: t.storageType, storageLabel: t.storageLabel, storageIndex: t.storageIndex, type: t.type });
      }
    });
    return items;
  }, [tests]);

  const jumpToTest = (testId) => { setActiveTestId(testId); setCurrentModule('active-test'); };
  const jumpToProtocol = (protocolId) => { setExpandedGroups(p => ({ ...p, activeProtoId: protocolId })); setCurrentModule('protocols'); };

  const saveStorage = (e) => {
    e.preventDefault(); const formData = new FormData(e.target);
    const newStorage = { id: storageModal.id || 'st_' + Date.now(), name: formData.get('name'), type: formData.get('type'), rows: parseInt(formData.get('rows')) || 5, cols: parseInt(formData.get('cols')) || 4, imageUrl: formData.get('imageUrl') || '' };
    if (storageModal.id) { setStorages(prev => prev.map(s => s.id === storageModal.id ? newStorage : s)); } else { setStorages(prev => [...prev, newStorage]); }
    setStorageModal(null);
  };

  const handleMoveBox = (boxId, targetStorageId, targetSlotIndex) => {
    setTests(prev => prev.map(t => {
      if (t.id === boxId) return { ...t, storageId: targetStorageId, storageIndex: targetSlotIndex };
      return t;
    }));
    setMoveModal(null);
  };

  const handlePrint = () => { window.print(); };

  // --- NAV ITEMS ---
  const navItems = [
    { id: 'dashboard', icon: '📊', label: 'Dataset Overview' },
    { id: 'agenda', icon: '🗓️', label: 'Agenda (Timeline)' },
    { id: 'storage', icon: '📦', label: 'Storage & Boxes' },
    { id: 'tests', icon: '🧪', label: 'Tests & Fittings' },
    { id: 'protocols', icon: '📝', label: 'Protocols' },
    { id: 'notebook', icon: '📓', label: 'Lab Notebook' }
  ];

  return (
    <div className="w-full relative flex flex-col h-screen overflow-hidden bg-slate-50">
      <style>{`
        @media print {
          @page { margin: 1cm; size: A4 portrait; }
          .no-print, nav, button, input[type="file"], .sidebar-col { display: none !important; }
          .print-only { display: block !important; }
          body, html, #root { background: white !important; height: auto !important; min-height: 100% !important; overflow: visible !important; color: black !important; }
          .h-screen, .max-h-screen, .flex-1, .overflow-y-auto, .overflow-hidden, .custom-scrollbar, .h-full, .min-h-0 { height: auto !important; max-height: none !important; overflow: visible !important; position: static !important; }
          .fixed, .absolute { position: static !important; }
          .shadow-sm, .shadow-md, .shadow-lg, .shadow-xl, .shadow-2xl { box-shadow: none !important; border: 1px solid #e2e8f0 !important; }
        }
      `}</style>

      {/* DIALOG */}
      {dialog && (
        <div className="fixed inset-0 bg-slate-900/50 z-[999999] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm overflow-hidden flex flex-col border border-slate-200" onClick={e => e.stopPropagation()}>
            <div className="p-4 flex flex-col">
              {dialog.title && <h3 className="text-lg font-bold text-slate-800 mb-2">{dialog.title}</h3>}
              <p className="text-sm text-slate-600 mb-4">{dialog.message}</p>
              {dialog.type === 'prompt' && (
                <input type="text" id="prompt-input" defaultValue={dialog.defaultValue} autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') { dialog.onConfirm(e.target.value); setDialog(null); } if (e.key === 'Escape') setDialog(null); }}
                  className="border border-slate-300 rounded p-2 text-sm focus:border-blue-500 focus:outline-none mb-2" />
              )}
              <div className="flex justify-end gap-2 mt-2">
                {(dialog.type === 'confirm' || dialog.type === 'prompt') && (
                  <button onClick={() => setDialog(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded">Cancel</button>
                )}
                <button onClick={() => { if (dialog.onConfirm) { if (dialog.type === 'prompt') dialog.onConfirm(document.getElementById('prompt-input').value); else dialog.onConfirm(); } setDialog(null); }} className="px-4 py-2 text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white rounded shadow-sm">
                  {dialog.type === 'alert' ? 'OK' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PENDING LOAD */}
      {pendingLoad && (
        <div className="fixed inset-0 bg-slate-900/50 z-[99999] flex items-center justify-center backdrop-blur-sm">
          <div className="bg-white p-6 rounded-xl shadow-xl border border-slate-200 w-96">
            <h3 className="text-lg font-black text-slate-800 mb-2">Load Workspace Data</h3>
            <p className="text-sm text-slate-500 mb-6">How would you like to load the data from this file?</p>
            <div className="flex flex-col gap-3">
              <button onClick={() => confirmLoad('append')} className="bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-800 font-bold py-2 px-4 rounded-lg text-left transition-colors">➕ Add to Current File</button>
              <button onClick={() => confirmLoad('replace')} className="bg-red-50 hover:bg-red-100 border border-red-200 text-red-800 font-bold py-2 px-4 rounded-lg text-left transition-colors">🔄 Substitute Data</button>
              <button onClick={() => setPendingLoad(null)} className="mt-2 text-slate-500 hover:text-slate-700 text-sm font-bold py-2 w-full transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* STORAGE MODAL */}
      {storageModal && (
        <div className="fixed inset-0 bg-slate-900/50 z-[999999] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden flex flex-col border border-slate-200" onClick={e => e.stopPropagation()}>
            <form onSubmit={saveStorage} className="p-6 flex flex-col gap-4">
              <h3 className="text-xl font-black text-slate-800">{storageModal.id ? 'Edit Storage' : 'Add New Storage'}</h3>
              <div className="flex flex-col gap-1"><label className="text-xs font-bold text-slate-500 uppercase">Storage Name</label><input name="name" defaultValue={storageModal.name} required className="border border-slate-300 rounded p-2 text-sm focus:border-blue-500 outline-none" placeholder="e.g. Main Freezer -80°C" /></div>
              <div className="flex flex-col gap-1"><label className="text-xs font-bold text-slate-500 uppercase">Type</label><select name="type" defaultValue={storageModal.type || 'Freezer'} className="border border-slate-300 rounded p-2 text-sm focus:border-blue-500 outline-none bg-white"><option value="Freezer">Freezer</option><option value="Refrigerator">Refrigerator</option><option value="Closet">Closet</option></select></div>
              <div className="flex gap-4">
                <div className="flex flex-col gap-1 flex-1"><label className="text-xs font-bold text-slate-500 uppercase">Rows</label><input name="rows" type="number" min="1" max="50" defaultValue={storageModal.rows || 5} required className="border border-slate-300 rounded p-2 text-sm focus:border-blue-500 outline-none" /></div>
                <div className="flex flex-col gap-1 flex-1"><label className="text-xs font-bold text-slate-500 uppercase">Cols</label><input name="cols" type="number" min="1" max="50" defaultValue={storageModal.cols || 4} required className="border border-slate-300 rounded p-2 text-sm focus:border-blue-500 outline-none" /></div>
              </div>
              <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setStorageModal(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded">Cancel</button>
                <button type="submit" className="px-4 py-2 text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded shadow-sm">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MOVE MODAL */}
      {moveModal && (() => {
        const box = tests.find(t => t.id === moveModal.boxId);
        if (!box) return null;
        const targetSt = storages.find(s => s.id === (moveModal.targetStorageId || moveModal.currentStorageId));
        if (!targetSt) return null;
        const boxesInTarget = tests.filter(t => t.type === 'plate-9x9box' && t.storageId === targetSt.id && t.id !== box.id);
        return (
          <div className="fixed inset-0 bg-slate-900/50 z-[999999] flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setMoveModal(null)}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col border border-slate-200" onClick={e => e.stopPropagation()}>
              <div className="p-5 border-b border-slate-200 flex justify-between items-center shrink-0">
                <div><h3 className="text-lg font-bold text-slate-800">Move Box</h3><p className="text-sm text-slate-500">Moving: <span className="font-semibold text-indigo-600">{box.name}</span></p></div>
                <button onClick={() => setMoveModal(null)} className="text-slate-400 hover:text-slate-600 text-2xl">&times;</button>
              </div>
              <div className="p-5 flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-4">
                <select className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" onChange={(e) => setMoveModal(prev => ({ ...prev, targetStorageId: e.target.value }))} value={moveModal.targetStorageId || moveModal.currentStorageId}>
                  {storages.map(s => <option key={s.id} value={s.id}>{s.name} ({s.type})</option>)}
                </select>
                <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                  <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${targetSt.cols}, minmax(60px, 1fr))` }}>
                    {Array.from({ length: targetSt.rows * targetSt.cols }).map((_, i) => {
                      const boxesInSlot = boxesInTarget.filter(b => b.storageIndex === i);
                      return (
                        <div key={i} onClick={() => handleMoveBox(box.id, targetSt.id, i)} className={`relative aspect-square border-2 rounded-lg flex flex-col items-center justify-center cursor-pointer transition-all p-1 text-center ${boxesInSlot.length > 0 ? 'bg-orange-50 border-orange-300' : 'bg-green-50 border-green-300'}`}>
                          <span className="absolute top-0.5 left-1 text-[8px] font-bold text-slate-400">{i + 1}</span>
                          {boxesInSlot.length > 0 ? <><span className="text-lg">📦</span><span className="text-[8px] font-bold text-orange-800 truncate w-full">{boxesInSlot[0].name}</span></> : <span className="text-lg text-green-600">+</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ===== EXPLORER VIEW (rimosso Open File, aggiunto info su localStorage) ===== */}
      {appView === 'explorer' && (
        <div className="absolute inset-0 z-[100] flex flex-col items-center p-10 bg-slate-100 overflow-y-auto">
          <div className="w-full max-w-6xl bg-white p-8 rounded-xl shadow-2xl border border-slate-200">
            <div className="flex justify-between items-center mb-8 border-b border-slate-100 pb-4">
              <div>
                <h1 className="text-3xl font-black text-slate-800 tracking-tight">Lab Workspace</h1>
                <p className="text-slate-500 text-sm mt-1">Manage Datasets, Tests, and Protocols</p>
              </div>
              <button onClick={createNewDataset} disabled={!isCloudReady} className={`font-bold py-2.5 px-6 rounded-lg shadow-sm transition-colors flex items-center gap-2 ${isCloudReady ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-slate-300 text-slate-500 cursor-not-allowed'}`}>
                <span className="text-lg">+</span> New Dataset
              </button>
            </div>
            {!isCloudReady ? (
              <div className="text-center py-20 flex flex-col items-center gap-4">
                <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin"></div>
                <h2 className="text-xl font-bold text-slate-700">Caricamento in corso...</h2>
                <p className="text-slate-500">Connessione al cloud e caricamento dataset salvati.</p>
              </div>
            ) : Object.keys(groupedDatasets).length === 0 ? (
              <div className="text-center py-16 text-slate-500 text-lg flex flex-col items-center gap-4">
                <span className="text-4xl opacity-50">📂</span>
                <span>Nessun dataset trovato. Creane uno nuovo per iniziare!</span>
                <p className="text-sm text-slate-400 mt-2">I tuoi dataset vengono salvati automaticamente nel cloud e in locale.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {Object.values(groupedDatasets).map(group => {
                  const titleParts = [];
                  if (group.categories) titleParts.push(group.categories);
                  if (group.cellLines) titleParts.push(group.cellLines);
                  const groupTitle = group.isUnclassified ? (group.items[0].title || 'Untitled') : titleParts.join(' - ');
                  const isExpanded = expandedGroups[group.key];
                  return (
                    <div key={group.key} className="border border-slate-200 rounded-xl p-5 hover:shadow-lg hover:border-blue-300 transition-all bg-white flex flex-col h-full">
                      <h3 className="font-bold text-lg text-slate-800 mb-2 leading-tight truncate" title={groupTitle}>{groupTitle}</h3>
                      <p className="text-xs text-slate-500 mb-4 font-medium bg-slate-100 inline-block px-2 py-1 rounded-md self-start">{group.items.length} Dataset{group.items.length === 1 ? '' : 's'}</p>
                      <div className="flex flex-col gap-2 flex-1">
                        {group.items.slice(0, isExpanded ? undefined : 3).map(dset => (
                          <div key={dset.id} onClick={() => openDataset(dset)} className="bg-white border border-slate-200 hover:border-blue-400 hover:shadow-md p-3 rounded-lg cursor-pointer flex justify-between items-center transition-all group/item">
                            <div className="flex flex-col overflow-hidden">
                              <span className="font-bold text-sm text-blue-700 truncate">{dset.title || groupTitle}</span>
                              <span className="text-[11px] text-slate-500 mt-1 flex gap-2"><span>📅 {dset.date || 'No Date'}</span><span>🧪 {dset.testCount || 1} Tests</span></span>
                            </div>
                            <div className="flex flex-col gap-1 opacity-0 group-hover/item:opacity-100 transition-all shrink-0 ml-2">
                              <button onClick={(e) => renameDataset(e, dset.id, dset.title || groupTitle)} className="text-slate-500 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded text-xs font-bold transition-colors">Rename</button>
                              <button onClick={(e) => { e.stopPropagation(); deleteDataset(e, dset.id); }} className="text-slate-500 hover:text-red-600 hover:bg-red-50 px-2 py-1 rounded text-xs font-bold transition-colors">Delete</button>
                            </div>
                          </div>
                        ))}
                        {group.items.length > 3 && (
                          <button onClick={() => toggleGroup(group.key)} className="text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 font-bold py-2 rounded-lg mt-2 text-center transition-colors w-full">
                            {isExpanded ? 'Nascondi' : `Mostra altri ${group.items.length - 3}...`}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== DATASET VIEW ===== */}
      {appView === 'dataset' && (
        <div className="flex h-screen w-full overflow-hidden">
          {/* SIDEBAR COLLAPSABILE */}
          <div className={`sidebar-col ${isSidebarCollapsed ? 'w-16' : 'w-64'} bg-white border-r border-slate-200 flex flex-col shadow-sm z-30 shrink-0 no-print transition-all duration-300 ease-in-out`}>
            {/* Header sidebar */}
            <div className="p-3 border-b border-slate-200 flex items-center gap-2">
              <button onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)} className="text-slate-400 hover:text-blue-600 transition-colors p-1 shrink-0" title={isSidebarCollapsed ? "Espandi" : "Comprimi"}>
                {isSidebarCollapsed ? '▶' : '◀'}
              </button>
              {!isSidebarCollapsed && (
                <div className="min-w-0 flex-1">
                  <input value={datasetTitle} onChange={e => setDatasetTitle(e.target.value)} className="w-full text-sm font-black text-slate-800 bg-transparent border-none outline-none truncate focus:ring-1 focus:ring-blue-500 rounded px-1" placeholder="Dataset Title" />
                  <input value={datasetSubtitle} onChange={e => setDatasetSubtitle(e.target.value)} className="w-full text-[10px] font-medium text-slate-500 bg-transparent border-none outline-none truncate focus:ring-1 focus:ring-blue-500 rounded px-1 mt-0.5" placeholder="Subtitle" />
                </div>
              )}
            </div>

            {/* Status */}
            {!isSidebarCollapsed && (
              <div className="px-4 py-2 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center text-[10px] font-bold text-slate-500">
                <span>Status:</span>
                {saveStatus === 'saving' ? <span className="text-blue-500 animate-pulse">💾 Saving...</span> :
                  saveStatus === 'saved' ? <span className="text-emerald-600">☁️ Cloud Sync</span> :
                    saveStatus === 'error' ? <span className="text-red-600" title={saveErrorMsg}>❌ Error</span> :
                      <span className="text-slate-600">...</span>}
              </div>
            )}

            {/* Nav */}
            <nav className="flex-1 overflow-y-auto py-3 flex flex-col gap-1 px-2">
              <button onClick={handleBackToExplorer} className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-3'} px-3 py-2 rounded-lg text-sm transition-all text-left bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 font-bold shadow-sm mb-3`} title="Lista dei File Presenti">
                <span className="text-lg">📁</span>
                {!isSidebarCollapsed && 'Lista dei File'}
              </button>
              {navItems.map(nav => (
                <button key={nav.id} onClick={() => setCurrentModule(nav.id)} className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-3'} px-3 py-2 rounded-lg text-sm transition-all text-left ${currentModule === nav.id ? 'bg-blue-50 text-blue-700 font-bold shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`} title={nav.label}>
                  <span className="text-lg">{nav.icon}</span>
                  {!isSidebarCollapsed && nav.label}
                </button>
              ))}
            </nav>

            {/* Footer sidebar */}
            {!isSidebarCollapsed && (
              <div className="p-3 border-t border-slate-200 flex flex-col gap-2">
                <div className="flex gap-2">
                  <label className="flex-1 text-center bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 font-bold py-1.5 rounded text-xs cursor-pointer shadow-sm transition-colors">
                    📂 Load
                    <input type="file" accept=".html" onChange={loadHTML} className="hidden" />
                  </label>
                  <button onClick={exportHTML} className="flex-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-bold py-1.5 rounded text-xs shadow-sm transition-colors">💾 Save</button>
                </div>
                <div className="flex gap-2 justify-center mt-1">
                  <button onClick={handleUndo} disabled={historyIndex === 0} className={`p-2 rounded border shadow-sm transition-colors ${historyIndex > 0 ? 'bg-white hover:bg-slate-50 text-slate-700' : 'bg-slate-50 text-slate-300'}`} title="Undo">↩</button>
                  <button onClick={handleRedo} disabled={historyIndex >= historyRef.current.length - 1} className={`p-2 rounded border shadow-sm transition-colors ${historyIndex < historyRef.current.length - 1 ? 'bg-white hover:bg-slate-50 text-slate-700' : 'bg-slate-50 text-slate-300'}`} title="Redo">↪</button>
                </div>
              </div>
            )}
          </div>

          {/* MAIN CONTENT */}
          <div className="flex-1 flex flex-col bg-slate-50 h-full overflow-hidden relative">

            {/* DASHBOARD */}
            {currentModule === 'dashboard' && (
              <div className="p-8 h-full overflow-y-auto custom-scrollbar bg-slate-50">
                <div className="max-w-6xl mx-auto">
                  <div className="flex justify-between items-end mb-8 border-b border-slate-200 pb-4">
                    <div><h1 className="text-3xl font-bold text-slate-800">{datasetTitle || 'Dataset Overview'}</h1><p className="text-slate-500 mt-1">{datasetSubtitle || 'Manage your experiments.'}</p></div>
                    <button onClick={handlePrint} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center gap-2 shadow-sm no-print">🖨️ Print</button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                    <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm"><div className="text-slate-500 text-xs font-bold uppercase">Total Tests</div><div className="text-3xl font-bold text-slate-800 mt-1">{tests.filter(t => t.type !== 'plate-9x9box').length}</div></div>
                    <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm"><div className="text-slate-500 text-xs font-bold uppercase">Stored Boxes</div><div className="text-3xl font-bold text-slate-800 mt-1">{tests.filter(t => t.type === 'plate-9x9box').length}</div></div>
                    <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm"><div className="text-slate-500 text-xs font-bold uppercase">Storage Units</div><div className="text-3xl font-bold text-slate-800 mt-1">{storages.length}</div></div>
                    <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm"><div className="text-slate-500 text-xs font-bold uppercase">Upcoming Tasks</div><div className="text-3xl font-bold text-slate-800 mt-1">{mergedPlan.filter(t => t.date >= new Date().toISOString().split('T')[0]).length}</div></div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {navItems.filter(n => n.id !== 'dashboard').map(mod => (
                      <button key={mod.id} onClick={() => setCurrentModule(mod.id)} className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-400 transition-all text-left group no-print">
                        <div className="text-2xl mb-3 group-hover:scale-110 transition-transform">{mod.icon}</div>
                        <h3 className="font-bold text-slate-800 text-lg mb-1">{mod.label}</h3>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* AGENDA */}
            {currentModule === 'agenda' && (
              <div className="p-6 h-full overflow-y-auto custom-scrollbar flex flex-col">
                <div className="mb-6 flex justify-between items-end border-b border-slate-200 pb-4">
                  <div><h2 className="text-2xl font-black text-slate-800">Project Timeline</h2></div>
                  <button onClick={handlePrint} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-2 px-4 rounded-lg text-sm no-print">🖨️ Print</button>
                </div>
                <div className="flex flex-col md:flex-row gap-6">
                  <div className="w-full md:w-80 bg-white border border-slate-200 rounded-xl p-4 shadow-sm shrink-0 h-fit no-print">
                    <div className="flex justify-between items-center mb-4">
                      <button onClick={handlePrevMonth} className="text-slate-400 hover:text-blue-600 font-bold p-1 rounded">◀</button>
                      <h3 className="text-sm font-bold text-slate-700">{monthName}</h3>
                      <button onClick={handleNextMonth} className="text-slate-400 hover:text-blue-600 font-bold p-1 rounded">▶</button>
                    </div>
                    <div className="grid grid-cols-7 gap-1 text-center mb-2">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i} className="text-[11px] font-bold text-slate-400">{d}</div>)}</div>
                    <div className="grid grid-cols-7 gap-1">
                      {Array.from({ length: startDayOffset }).map((_, i) => <div key={`e-${i}`}></div>)}
                      {Array.from({ length: totalDays }, (_, i) => {
                        const day = String(i + 1).padStart(2, '0'); const month = String(currentMonth.getMonth() + 1).padStart(2, '0');
                        const dateStr = `${currentMonth.getFullYear()}-${month}-${day}`;
                        const hasTask = mergedPlan.some(p => p.date === dateStr); const isSel = calFilterDate === dateStr;
                        return (<button key={i} onClick={() => setCalFilterDate(isSel ? null : dateStr)} className={`text-[11px] py-1.5 rounded-md transition-all font-medium ${isSel ? 'bg-blue-600 text-white' : hasTask ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'text-slate-600 hover:bg-slate-100'}`}>{i + 1}</button>);
                      })}
                    </div>
                  </div>
                  <div className="flex-1 bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-700 mb-4">{calFilterDate ? `Tasks for ${calFilterDate}` : 'All Tasks'}</h3>
                    {Object.keys(agendaGrouped).length === 0 ? <div className="text-center text-slate-400 py-10 italic">No tasks planned.</div> :
                      (calFilterDate ? (agendaGrouped[calFilterDate] ? [[calFilterDate, agendaGrouped[calFilterDate]]] : []) : Object.entries(agendaGrouped)).map(([date, tasks]) => (
                        <div key={date} className="mb-4"><h4 className="font-bold text-sm text-slate-500 mb-2">{date}</h4>
                          {tasks.map((t, idx) => (<div key={idx} className="flex items-center gap-3 bg-slate-50 p-3 border border-slate-200 rounded-lg mb-2"><button onClick={() => jumpToTest(t.testId)} className="text-xs font-bold bg-blue-100 text-blue-800 px-3 py-1.5 rounded-md">{t.testName}</button><span className="text-sm text-slate-700">{t.task}</span></div>))}
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}

            {/* STORAGE */}
            {currentModule === 'storage' && (
              <div className="p-6 h-full overflow-y-auto custom-scrollbar flex flex-col">
                <div className="mb-6 flex justify-between items-end border-b border-slate-200 pb-4">
                  <h2 className="text-2xl font-black text-slate-800">Storage Locations</h2>
                  <button onClick={() => setStorageModal({})} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-6 rounded-lg shadow-sm text-sm no-print">➕ Add Storage</button>
                </div>
                {storages.length === 0 ? <div className="bg-white border border-dashed border-slate-300 rounded-xl p-16 text-center"><div className="text-5xl mb-4 opacity-50">🚪</div><p className="text-slate-600 font-bold text-xl">No storage locations.</p></div> :
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {storages.map(st => {
                      const boxesInStorage = tests.filter(t => t.type === 'plate-9x9box' && t.storageId === st.id);
                      const icon = st.type === 'Refrigerator' ? '❄️' : st.type === 'Freezer' ? '🧊' : '🚪';
                      return (
                        <div key={st.id} onClick={() => { setActiveStorageId(st.id); setCurrentModule('storage-detail'); }} className="bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-lg cursor-pointer transition-all overflow-hidden flex flex-col group">
                          <div className="h-24 w-full bg-slate-50 border-b border-slate-100 flex items-center justify-center text-4xl">{icon}</div>
                          <div className="p-5 flex flex-col"><h3 className="font-bold text-slate-800 text-lg">{st.name}</h3><p className="text-xs text-slate-500 mt-1">Grid: {st.rows}×{st.cols} | 📦 {boxesInStorage.length} Boxes</p></div>
                        </div>
                      );
                    })}
                  </div>}
              </div>
            )}

            {/* STORAGE DETAIL */}
            {currentModule === 'storage-detail' && (() => {
              const st = storages.find(s => s.id === activeStorageId);
              if (!st) return <div className="p-6">Storage not found.</div>;
              const boxesInStorage = tests.filter(t => t.type === 'plate-9x9box' && t.storageId === st.id);
              const handleAddBox = (slotIndex) => { const id = 't' + Date.now(); const newBox = createEmptyTest(id, tests.length + 1, 'plate-9x9box'); newBox.storageId = st.id; if (slotIndex !== undefined) newBox.storageIndex = slotIndex; setTests(prev => [...prev, newBox]); setActiveTestId(id); setCurrentModule('active-test'); };
              return (
                <div className="p-6 h-full overflow-y-auto custom-scrollbar flex flex-col bg-slate-50">
                  <div className="mb-6 flex items-center gap-4 shrink-0">
                    <button onClick={() => setCurrentModule('storage')} className="text-slate-400 hover:text-indigo-600 bg-white p-2 rounded-lg shadow-sm border no-print">◀ Back</button>
                    <h2 className="text-2xl font-black text-slate-800">{st.name}</h2>
                  </div>
                  <div className="flex-1 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                    <div className="grid gap-3 max-w-full" style={{ gridTemplateColumns: `repeat(${st.cols}, minmax(80px, 120px))` }}>
                      {Array.from({ length: st.rows * st.cols }).map((_, i) => {
                        const box = boxesInStorage.find(b => b.storageIndex === i);
                        return (
                          <div key={i} onClick={() => { if (box) jumpToTest(box.id); else handleAddBox(i); }} className={`aspect-square border-2 rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all p-2 text-center ${box ? 'bg-white border-indigo-300' : 'bg-slate-100 border-dashed border-slate-300'}`}>
                            {box ? <><span className="text-2xl">📦</span><span className="text-[10px] font-bold text-indigo-900 truncate w-full">{box.name}</span></> : <span className="text-xl opacity-50">+</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* TESTS */}
            {currentModule === 'tests' && (() => {
              const testSearch = expandedGroups['testSearch'] || '';
              const testCatFilter = expandedGroups['testCatFilter'] || 'ALL';
              const filteredTestsRaw = tests.filter(t => {
                if (t.type === 'plate-9x9box') return false;
                const matchesSearch = t.name.toLowerCase().includes(testSearch.toLowerCase());
                const matchesCat = testCatFilter === 'ALL' || t.testCategory === testCatFilter;
                return matchesSearch && matchesCat;
              });
              const filteredTests = []; const seenTestNames = new Set();
              filteredTestsRaw.forEach(t => { if (!seenTestNames.has(t.name)) { seenTestNames.add(t.name); filteredTests.push(t); } });
              return (
                <div className="p-6 h-full flex flex-col">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4 border-b border-slate-200 pb-4">
                    <h2 className="text-2xl font-black text-slate-800">Tests & Assays</h2>
                    <div className="flex flex-wrap gap-2 no-print">
                      <button onClick={() => { const id = 't' + Date.now(); setTests(prev => [...prev, createEmptyTest(id, prev.length + 1, 'plate-96')]); setActiveTestId(id); setCurrentModule('active-test'); }} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded shadow-sm text-sm">+ Plate Test</button>
                      <button onClick={() => { const id = 't' + Date.now(); setTests(prev => [...prev, createEmptyTest(id, prev.length + 1, 'nmr')]); setActiveTestId(id); setCurrentModule('active-test'); }} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-4 rounded shadow-sm text-sm">+ NMR Spectrum</button>
                    </div>
                  </div>
                  <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 mb-6 shrink-0 no-print">
                    <div className="flex gap-4 items-center">
                      <div className="flex-1 relative"><span className="absolute left-3 top-2.5 text-slate-400">🔍</span><input type="text" placeholder="Search tests..." value={testSearch} onChange={e => setExpandedGroups(p => ({ ...p, testSearch: e.target.value }))} className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm" /></div>
                      <select value={testCatFilter} onChange={e => setExpandedGroups(p => ({ ...p, testCatFilter: e.target.value }))} className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
                        <option value="ALL">All Categories</option>{testCategories.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {filteredTests.length === 0 ? <div className="text-center py-10 text-slate-400 italic">No tests match.</div> :
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {filteredTests.map(test => (
                          <div key={test.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md hover:border-blue-400 cursor-pointer transition-all" onClick={() => { setActiveTestId(test.id); setCurrentModule('active-test'); }}>
                            <span className="text-[10px] font-black uppercase text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{test.testCategory || 'Uncategorized'}</span>
                            <h3 className="font-bold text-slate-800 text-lg mt-2">{test.name}</h3>
                            <div className="mt-3 flex justify-between text-xs text-slate-500"><span>📅 {test.date}</span><span>{test.type === 'nmr' ? '📉 NMR' : '🧫 Plate'}</span></div>
                          </div>
                        ))}
                      </div>}
                  </div>
                </div>
              );
            })()}

            {/* PROTOCOLS */}
            {currentModule === 'protocols' && (() => {
              const protoSearch = expandedGroups['protoSearch'] || '';
              const activeProtoId = expandedGroups['activeProtoId'] || null;
              const filteredProtocols = datasetProtocols.filter(p => p.title.toLowerCase().includes(protoSearch.toLowerCase()));
              const activeProtocol = activeProtoId ? datasetProtocols.find(p => p.id === activeProtoId) : null;
              if (activeProtocol) {
                return (
                  <div className="p-6 h-full flex flex-col bg-white">
                    <div className="flex items-center gap-3 mb-6 border-b border-slate-100 pb-4 shrink-0">
                      <button onClick={() => setExpandedGroups(p => ({ ...p, activeProtoId: null }))} className="text-slate-400 hover:text-blue-600 bg-slate-50 p-2 rounded-lg no-print">◀ Back</button>
                      <input type="text" value={activeProtocol.title} onChange={e => setDatasetProtocols(datasetProtocols.map(p => p.id === activeProtocol.id ? { ...p, title: e.target.value } : p))} className="text-2xl font-black text-slate-800 bg-transparent border-none outline-none flex-1" />
                    </div>
                    <RichTextEditor value={activeProtocol.content || ''} onChange={val => setDatasetProtocols(datasetProtocols.map(p => p.id === activeProtocol.id ? { ...p, content: val } : p))} placeholder="Write protocol steps..." />
                  </div>
                );
              }
              return (
                <div className="p-6 h-full flex flex-col">
                  <div className="flex justify-between items-end mb-6 border-b border-slate-200 pb-4">
                    <h2 className="text-2xl font-black text-slate-800">Protocols Library</h2>
                    <button onClick={() => { const newProto = { id: 'pr' + Date.now(), title: 'Untitled Protocol', category: protocolCategories[0], content: '', links: [] }; setDatasetProtocols([newProto, ...datasetProtocols]); setExpandedGroups(p => ({ ...p, activeProtoId: newProto.id })); }} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 px-6 rounded-lg shadow-sm text-sm no-print">➕ New Protocol</button>
                  </div>
                  <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {filteredProtocols.length === 0 ? <div className="text-center py-10 text-slate-400 italic">No protocols.</div> :
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {filteredProtocols.map(proto => (
                          <div key={proto.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md cursor-pointer" onClick={() => setExpandedGroups(p => ({ ...p, activeProtoId: proto.id }))}>
                            <h3 className="font-bold text-slate-800 text-lg">{proto.title}</h3>
                            <span className="text-[10px] font-black uppercase text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded mt-2 inline-block">{proto.category}</span>
                          </div>
                        ))}
                      </div>}
                  </div>
                </div>
              );
            })()}

            {/* ACTIVE TEST */}
            {currentModule === 'active-test' && (() => {
              const activeTest = tests.find(t => t.id === activeTestId);
              if (!activeTest) return <div className="p-6">Test not found.</div>;
              const updateActiveTest = (updates) => { setTests(prev => prev.map(t => t.id === activeTestId ? { ...t, ...updates } : t)); };
              const isBox = activeTest.type === 'plate-9x9box';
              const siblingTests = isBox ? [] : tests.filter(t => t.name === activeTest.name && t.name.trim() !== '').sort((a, b) => (a.date || '').localeCompare(b.date || ''));
              const jumpToProtocolFn = (id) => { setExpandedGroups(p => ({ ...p, activeProtoId: id })); setCurrentModule('protocols'); };
              const handleDuplicateInstance = () => {
                const id = 't' + Date.now(); const newTest = JSON.parse(JSON.stringify(activeTest));
                newTest.id = id; newTest.date = new Date().toISOString().split('T')[0]; newTest.instanceName = 'New Instance'; newTest.comments = ''; newTest.images = [];
                setTests(prev => [...prev, newTest]); setActiveTestId(id);
              };
              const TestHeader = (
                <div className="flex flex-col shrink-0 z-20 no-print">
                  <div className="bg-white border-b border-slate-200 px-6 py-4 flex flex-col md:flex-row justify-between items-start md:items-center shadow-sm gap-4">
                    <div className="flex items-center gap-4 w-full md:w-auto">
                      <button onClick={() => { if (isBox && activeTest.storageId) { setActiveStorageId(activeTest.storageId); setCurrentModule('storage-detail'); } else setCurrentModule('tests'); }} className="text-slate-400 hover:text-blue-600 bg-slate-50 p-2 rounded-lg border">◀ Back</button>
                      <div className="flex-1">
                        <input value={activeTest.name} onChange={e => updateActiveTest({ name: e.target.value })} className="text-xl font-black text-slate-800 bg-transparent border-none outline-none w-full md:w-64" placeholder="Test Name" />
                        <div className="text-xs text-slate-500 mt-1 flex gap-2"><span className="uppercase text-blue-700 bg-blue-50 px-2 py-0.5 rounded">{activeTest.testCategory}</span><span className="uppercase text-slate-600 bg-slate-100 px-2 py-0.5 rounded">{activeTest.type}</span></div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <input type="text" value={activeTest.instanceName || ''} onChange={e => updateActiveTest({ instanceName: e.target.value })} className="bg-slate-50 border border-slate-200 text-xs px-3 py-1.5 rounded-lg w-32" placeholder="Instance" />
                      <input type="date" value={activeTest.date} onChange={e => updateActiveTest({ date: e.target.value })} className="bg-slate-50 border border-slate-200 text-xs px-3 py-1.5 rounded-lg" />
                    </div>
                  </div>
                  {siblingTests.length > 0 && (
                    <div className="bg-blue-50 border-b border-blue-200 px-6 py-2 flex items-center gap-2 overflow-x-auto">
                      <span className="text-[10px] font-bold text-blue-800 uppercase mr-2">Instances:</span>
                      {siblingTests.map(t => (
                        <button key={t.id} onClick={() => setActiveTestId(t.id)} className={`px-3 py-1 text-xs font-bold rounded-full ${activeTestId === t.id ? 'bg-blue-600 text-white' : 'bg-white text-blue-700 border border-blue-300'}`}>
                          📅 {t.instanceName || t.date}
                        </button>
                      ))}
                      <button onClick={handleDuplicateInstance} className="px-3 py-1 text-[10px] font-bold text-blue-600 border border-dashed border-blue-400 rounded-full bg-white ml-2">+ Copy</button>
                    </div>
                  )}
                </div>
              );

              if (activeTest.type === 'nmr') {
                return <NMRTestRenderer activeTest={activeTest} updateActiveTest={updateActiveTest} TestHeader={TestHeader} datasetProtocols={datasetProtocols} jumpToProtocol={jumpToProtocolFn} />;
              }
              if (activeTest.type === 'plate-9x9box') {
                return (
                  <div className="flex flex-col h-full overflow-hidden">
                    {TestHeader}
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-6">
                        <label className="text-xs font-bold text-slate-600 mb-2">📝 Box Notes</label>
                        <RichTextEditor value={activeTest.comments || ''} onChange={val => updateActiveTest({ comments: val })} />
                      </div>
                      <p className="text-sm text-slate-500">Box grid rendering (9x9) - see full implementation in original code.</p>
                    </div>
                  </div>
                );
              }
              if (activeTest.type.startsWith('plate-')) {
                return (
                  <PlateTestRenderer
                    activeTest={activeTest} updateActiveTest={updateActiveTest}
                    appClipboard={appClipboard} setAppClipboard={setAppClipboard}
                    customCmpds={customCmpds} setCustomCmpds={setCustomCmpds}
                    customConc={customConc} setCustomConc={setCustomConc}
                    cmpColors={cmpColors} setCmpColors={setCmpColors}
                    allCmpds={[...new Set([...DEF_COMPOUNDS, ...customCmpds])]}
                    jumpToTest={(id) => { setActiveTestId(id); setCurrentModule('active-test'); }} TestHeader={TestHeader}
                    datasetProtocols={datasetProtocols} jumpToProtocol={jumpToProtocolFn}
                  />
                );
              }
              return <div className="p-6">Unknown test type.</div>;
            })()}

            {/* LAB NOTEBOOK - con supporto immagini NMR */}
            {currentModule === 'notebook' && (() => {
              const notebookSearch = expandedGroups['notebookSearch'] || '';
              const filteredTests = tests.filter(t => {
                if (!notebookSearch) return true;
                return JSON.stringify(t).toLowerCase().includes(notebookSearch.toLowerCase());
              });
              return (
                <div className="flex flex-col h-full w-full">
                  <div className="bg-white p-4 border-b border-slate-200 shadow-sm flex items-center justify-between no-print shrink-0">
                    <div className="flex-1 max-w-md relative">
                      <span className="absolute left-3 top-2.5 text-slate-400">🔍</span>
                      <input type="text" placeholder="Ricerca nei dati dei test..." value={notebookSearch} onChange={e => setExpandedGroups(p => ({ ...p, notebookSearch: e.target.value }))} className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm" />
                    </div>
                    <button onClick={handlePrint} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-2 px-4 rounded-lg text-sm">🖨️ Stampa</button>
                  </div>
                  <div className="flex-1 overflow-hidden relative">
                    <LabNotebook
                      tests={filteredTests}
                      allCellLines={[...new Set([...DEF_CELL_LINES, ...customCellLines])]}
                      testCategories={testCategories}
                      jumpToTest={(id) => { setActiveTestId(id); setCurrentModule('active-test'); }}
                      customConc={customConc}
                      cmpColors={cmpColors}
                      allCmpds={[...new Set([...DEF_COMPOUNDS, ...customCmpds])]}
                    />
                  </div>
                </div>
              );
            })()}

          </div>
        </div>
      )}
    </div>
  );
}