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
        safeComments = safeComments.replace(/<img[^>]+src="data:image\/[^;]+;base64,([^">]{500000,})"[^>]*>/gi, '<br/><span style="color:red; font-size:10px; font-weight:bold;">[Massive image removed]</span><br/>');
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
            const defGrid = Array(26).fill(null).map(()=>Array(26).fill(''));
            const defCell = Array(26).fill(null).map(()=>Array(26).fill(null).map(()=>({excluded:false, role:null, conc:null, region:'Primary', manualOverride:false})));
            
            return {
                ...baseTest, plateType: dimKey, grid: defGrid, boxRows: 9, boxCols: 9,
                compounds: Array(dim.cols).fill(''), rowCompounds: Array(dim.rows).fill(''), cellConfig: defCell, 
                ctrlType: 'cells', ctrlODStr: '1.0', bgType: 'none', bgManualStr: '0', unit: 'µM', cellsSeeded: '', test: '',
                manualErrors: {}, topConcStr: '100', dilFactorStr: '3', glbOffsetStr: '0', errScaleStr: '1', useFixedSD: false, fixedSDStr: '0', showViab: true, fitIC50: true, showExcl: false, outlierThreshStr: '2.0',
                chartCfg: { yMin:'',yMax:'',xMin:'',xMax:'', ptStyle:'circle',ptSize:5,fontSize:16,xPos:'bottom',yPos:'left', xAxisLabel:'', lineStyle:'solid', lineThickness:2 }
            };
        } else if (customType === 'nmr') {
            return { 
                ...baseTest, 
                proteinSequence: '', selectedNuclei: ['H', 'C', 'N'], chemicalShifts: {}, nmrSpectraImages: [],
                moleculeName: '', experimentDate: '', concentration: '', solvent: '', saltConcentration: '', temperature: '', otherMolecule: '', ratio: '', tableMode: 'backbone', compound: ''
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

    const historyRef = useRef([ [createEmptyTest('t1', 1, 'plate-96')] ]);
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
                    catch(err) { await auth.signInAnonymously(); }
                } else { 
                    await auth.signInAnonymously(); 
                }
            } catch(e) { console.error("Auth error", e); setIsCloudReady(true); }
        };
        initAuth();
    }, []);

    useEffect(() => {
        if (db) {
            const collRef = db.collection(`artifacts/${appId}/public/data/datasets`);
            const unsubscribe = collRef.onSnapshot((snap) => {
                const dsets = [];
                snap.forEach(doc => { dsets.push({ id: doc.id, ...doc.data() }); });
                dsets.sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0));
                setDatasetsList(dsets);
                setIsCloudReady(true);
            }, (err) => { 
                console.error("Firestore sync error:", err); 
                try {
                    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
                    if (stored) setDatasetsList(JSON.parse(stored).sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
                } catch(e){}
                setIsCloudReady(true); 
            });
            return () => unsubscribe();
        } else {
            try {
                const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
                if (stored) setDatasetsList(JSON.parse(stored).sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
            } catch (e) {}
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
                    try { stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]'); } catch(e){}
                    const existingIdx = stored.findIndex(e => e.id === currentDatasetId);
                    const newDset = { id: currentDatasetId, ...updatedPayload };
                    if (existingIdx >= 0) stored[existingIdx] = { ...stored[existingIdx], ...newDset }; else stored.push(newDset);
                    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stored));
                    setDatasetsList([...stored].sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
                    setSaveStatus('saved');
                }
            } catch(e) { setSaveStatus('error'); setSaveErrorMsg(e.message); }
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
        if (file.size > 900000) setDialog({type: 'alert', title: 'Large File Warning', message: 'This file is very large. After loading, saving to cloud might fail due to the 1MB limit. Consider removing embedded images.'});
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
            if(s.datasetTitle !== undefined) setDatasetTitle(s.datasetTitle); else if(s.reportTitle !== undefined) setDatasetTitle(s.reportTitle);
            if(s.datasetSubtitle !== undefined) setDatasetSubtitle(s.datasetSubtitle); else if(s.reportSubtitle !== undefined) setDatasetSubtitle(s.reportSubtitle);
            if(s.customCmpds !== undefined) setCustomCmpds(s.customCmpds);
            if(s.customCellLines !== undefined) setCustomCellLines(s.customCellLines);
            if(s.customConc !== undefined) setCustomConc(s.customConc);
            if(s.cmpColors !== undefined) setCmpColors(s.cmpColors);
            if(s.testCategories !== undefined) setTestCategories(s.testCategories);
            if(s.protocolCategories !== undefined) setProtocolCategories(s.protocolCategories);
            if(s.datasetProtocols !== undefined) setDatasetProtocols(s.datasetProtocols);
            if(s.storages !== undefined) setStorages(s.storages); 
        } else if (mode === 'append') {
            const newTests = loadedTests.map(p => ({ ...p, id: 't' + Math.random().toString(36).substr(2, 9) + Date.now() }));
            setTests(prev => [...prev, ...newTests]); setActiveTestId(newTests[0].id);
            if(s.customCmpds !== undefined) setCustomCmpds(prev => [...new Set([...prev, ...s.customCmpds])]);
            if(s.customCellLines !== undefined) setCustomCellLines(prev => [...new Set([...prev, ...s.customCellLines])]);
            if(s.customConc !== undefined) setCustomConc(prev => ({...prev, ...s.customConc}));
            if(s.cmpColors !== undefined) setCmpColors(prev => ({...prev, ...s.cmpColors}));
            if(s.storages !== undefined) { 
                setStorages(prev => { const merged = [...prev]; s.storages.forEach(newSt => { if(!merged.find(st => st.id === newSt.id)) merged.push(newSt); }); return merged; });
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
        
        if(db && user) { 
            await db.collection(`artifacts/${appId}/public/data/datasets`).doc(newId).set(updatedPayload); 
        } else {
            let stored = []; try { stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]'); } catch(e){}
            stored.push({ id: newId, ...updatedPayload }); localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stored));
            setDatasetsList([...stored].sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
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
                    let stored = []; try { stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]'); } catch(e){}
                    const existingIdx = stored.findIndex(e => e.id === currentDatasetId);
                    if (existingIdx >= 0) stored[existingIdx] = { ...stored[existingIdx], ...updatedPayload }; else stored.push({ id: currentDatasetId, ...updatedPayload });
                    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stored));
                    setDatasetsList([...stored].sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
                }
            } catch(e) {}
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
        } catch(e) { setDialog({type: 'alert', title: 'Error', message: "Error reading dataset structure."}); }
    };
    
    const deleteDataset = (e, id) => {
        e.stopPropagation();
        setDialog({
            type: 'confirm', title: 'Delete Dataset', message: 'Are you sure you want to delete this entire Dataset?',
            onConfirm: async () => {
                if(db && user) { 
                    await db.collection(`artifacts/${appId}/public/data/datasets`).doc(id).delete(); 
                } else {
                    let stored = []; try { stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]'); } catch(e){}
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
                        let stored = []; try { stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]'); } catch(e){}
                        const idx = stored.findIndex(d => d.id === id);
                        if (idx >= 0) { stored[idx].title = newTitle.trim(); localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stored)); setDatasetsList(stored); }
                    }
                }
            }
        });
    };

    const [searchQuery, setSearchQuery] = useState('');
    const [expandedGroups, setExpandedGroups] = useState({});
    const toggleGroup = (key) => setExpandedGroups(prev => ({...prev, [key]: !prev[key]}));

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
            } catch(e) {}
            const catStr = Array.from(catSet).sort().join(', '); 
            const cellStr = Array.from(cellSet).sort().join(', ');
            const hasMeta = catStr || cellStr; 
            const key = hasMeta ? `${catStr}|${cellStr}` : `unclassified_${dset.id}`;
            if (!groups[key]) { groups[key] = { key, categories: catStr, cellLines: cellStr, isUnclassified: !hasMeta, items: [] }; }
            groups[key].items.push(dset);
        });
        Object.values(groups).forEach(g => { g.items.sort((a,b) => new Date(b.date || 0) - new Date(a.date || 0)); });
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
            if (t.id === boxId) {
                return { ...t, storageId: targetStorageId, storageIndex: targetSlotIndex };
            }
            return t;
        }));
        setMoveModal(null);
    };

    const handlePrint = () => {
        window.print();
    };

    return (
        <div className="w-full relative flex flex-col h-screen overflow-hidden bg-slate-50">
            <style>{`
                @media print {
                    @page { margin: 1cm; size: A4 portrait; }
                    .no-print, nav, button, input[type="file"], .w-64 { display: none !important; }
                    .print-only { display: block !important; }
                    body, html, #root { 
                        background: white !important; 
                        height: auto !important; 
                        min-height: 100% !important; 
                        overflow: visible !important; 
                        color: black !important;
                    }
                    .h-screen, .max-h-screen, .flex-1, .overflow-y-auto, .overflow-hidden, .custom-scrollbar, .h-full, .min-h-0 { 
                        height: auto !important; 
                        max-height: none !important; 
                        overflow: visible !important; 
                        position: static !important;
                    }
                    .fixed, .absolute { position: static !important; }
                    .shadow-sm, .shadow-md, .shadow-lg, .shadow-xl, .shadow-2xl { 
                        box-shadow: none !important; 
                        border: 1px solid #e2e8f0 !important; 
                    }
                }
            `}</style>

            {dialog && (
                <div className="fixed inset-0 bg-slate-900/50 z-[999999] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-sm overflow-hidden flex flex-col border border-slate-200" onClick={e=>e.stopPropagation()}>
                        <div className="p-4 flex flex-col">
                            {dialog.title && <h3 className="text-lg font-bold text-slate-800 mb-2">{dialog.title}</h3>}
                            <p className="text-sm text-slate-600 mb-4">{dialog.message}</p>
                            {dialog.type === 'prompt' && (
                                <input type="text" id="prompt-input" defaultValue={dialog.defaultValue} autoFocus
                                    onKeyDown={e => {
                                        if(e.key === 'Enter'){ dialog.onConfirm(e.target.value); setDialog(null); }
                                        if(e.key === 'Escape'){ setDialog(null); }
                                    }}
                                    className="border border-slate-300 rounded p-2 text-sm focus:border-blue-500 focus:outline-none mb-2"/>
                            )}
                            <div className="flex justify-end gap-2 mt-2">
                                {(dialog.type === 'confirm' || dialog.type === 'prompt') && (
                                    <button onClick={()=>setDialog(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded">Cancel</button>
                                )}
                                <button onClick={()=>{
                                    if (dialog.onConfirm) {
                                        if(dialog.type === 'prompt') dialog.onConfirm(document.getElementById('prompt-input').value);
                                        else dialog.onConfirm();
                                    }
                                    setDialog(null);
                                }} className="px-4 py-2 text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white rounded shadow-sm">
                                    {dialog.type === 'alert' ? 'OK' : 'Confirm'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {pendingLoad && (
                <div className="fixed inset-0 bg-slate-900/50 z-[99999] flex items-center justify-center backdrop-blur-sm">
                    <div className="bg-white p-6 rounded-xl shadow-xl border border-slate-200 w-96">
                        <h3 className="text-lg font-black text-slate-800 mb-2">Load Workspace Data</h3>
                        <p className="text-sm text-slate-500 mb-6">How would you like to load the data from this file?</p>
                        <div className="flex flex-col gap-3">
                            <button onClick={() => confirmLoad('append')} className="bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-800 font-bold py-2 px-4 rounded-lg text-left transition-colors">
                                ➕ Add to Current File
                            </button>
                            <button onClick={() => confirmLoad('replace')} className="bg-red-50 hover:bg-red-100 border border-red-200 text-red-800 font-bold py-2 px-4 rounded-lg text-left transition-colors">
                                🔄 Substitute Data
                            </button>
                            <button onClick={() => setPendingLoad(null)} className="mt-2 text-slate-500 hover:text-slate-700 text-sm font-bold py-2 w-full transition-colors">Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {storageModal && (
                <div className="fixed inset-0 bg-slate-900/50 z-[999999] flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden flex flex-col border border-slate-200" onClick={e=>e.stopPropagation()}>
                        <form onSubmit={saveStorage} className="p-6 flex flex-col gap-4">
                            <h3 className="text-xl font-black text-slate-800">{storageModal.id ? 'Edit Storage' : 'Add New Storage'}</h3>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-bold text-slate-500 uppercase">Storage Name</label>
                                <input name="name" defaultValue={storageModal.name} required className="border border-slate-300 rounded p-2 text-sm focus:border-blue-500 outline-none" placeholder="e.g. Main Freezer -80°C"/>
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-bold text-slate-500 uppercase">Type</label>
                                <select name="type" defaultValue={storageModal.type || 'Freezer'} className="border border-slate-300 rounded p-2 text-sm focus:border-blue-500 outline-none bg-white">
                                    <option value="Freezer">Freezer (Congelatore)</option>
                                    <option value="Refrigerator">Refrigerator (Frigo)</option>
                                    <option value="Closet">Closet (Armadio)</option>
                                </select>
                            </div>
                            <div className="flex gap-4">
                                <div className="flex flex-col gap-1 flex-1">
                                    <label className="text-xs font-bold text-slate-500 uppercase">Shelves / Rows</label>
                                    <input name="rows" type="number" min="1" max="50" defaultValue={storageModal.rows || 5} required className="border border-slate-300 rounded p-2 text-sm focus:border-blue-500 outline-none"/>
                                </div>
                                <div className="flex flex-col gap-1 flex-1">
                                    <label className="text-xs font-bold text-slate-500 uppercase">Columns per Row</label>
                                    <input name="cols" type="number" min="1" max="50" defaultValue={storageModal.cols || 4} required className="border border-slate-300 rounded p-2 text-sm focus:border-blue-500 outline-none"/>
                                </div>
                            </div>
                            <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-slate-100">
                                <button type="button" onClick={()=>setStorageModal(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded">Cancel</button>
                                <button type="submit" className="px-4 py-2 text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded shadow-sm">Save Storage</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

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
                                <div>
                                    <h3 className="text-lg font-bold text-slate-800">Move Box</h3>
                                    <p className="text-sm text-slate-500">Moving: <span className="font-semibold text-indigo-600">{box.name}</span> ({box.instanceName || box.date})</p>
                                </div>
                                <button onClick={() => setMoveModal(null)} className="text-slate-400 hover:text-slate-600 text-2xl">&times;</button>
                            </div>
                            <div className="p-5 flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Select Target Storage</label>
                                    <select 
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-blue-500 outline-none bg-white"
                                        onChange={(e) => setMoveModal(prev => ({ ...prev, targetStorageId: e.target.value }))}
                                        value={moveModal.targetStorageId || moveModal.currentStorageId}
                                    >
                                        {storages.map(s => <option key={s.id} value={s.id}>{s.name} ({s.type})</option>)}
                                    </select>
                                </div>
                                
                                <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                                    <p className="text-xs text-slate-500 mb-3">Click a slot to move the box. You can place it in an empty slot or stack it with existing boxes.</p>
                                    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${targetSt.cols}, minmax(60px, 1fr))` }}>
                                        {Array.from({ length: targetSt.rows * targetSt.cols }).map((_, i) => {
                                            const boxesInSlot = boxesInTarget.filter(b => b.storageIndex === i);
                                            return (
                                                <div key={i} onClick={() => handleMoveBox(box.id, targetSt.id, i)}
                                                    className={`relative aspect-square border-2 rounded-lg flex flex-col items-center justify-center cursor-pointer transition-all p-1 text-center
                                                    ${boxesInSlot.length > 0 ? 'bg-orange-50 border-orange-300 hover:bg-orange-100' : 'bg-green-50 border-green-300 hover:bg-green-100'}`}>
                                                    <span className="absolute top-0.5 left-1 text-[8px] font-bold text-slate-400">{i + 1}</span>
                                                    {boxesInSlot.length > 0 ? (
                                                        <>
                                                            <span className="text-lg">📦</span>
                                                            <span className="text-[8px] font-bold text-orange-800 truncate w-full">{boxesInSlot[0].name}</span>
                                                            {boxesInSlot.length > 1 && <span className="text-[8px] bg-orange-200 px-1 rounded">+{boxesInSlot.length - 1}</span>}
                                                        </>
                                                    ) : <span className="text-lg text-green-600">+</span>}
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
            
            {appView === 'explorer' && (
                <div className="absolute inset-0 z-[100] flex flex-col items-center p-10 bg-slate-100 overflow-y-auto">
                    <div className="w-full max-w-6xl bg-white p-8 rounded-xl shadow-2xl border border-slate-200">
                        <div className="flex justify-between items-center mb-8 border-b border-slate-100 pb-4">
                            <div>
                                <h1 className="text-3xl font-black text-slate-800 tracking-tight">Lab Workspace</h1>
                                <p className="text-slate-500 text-sm mt-1">Manage Datasets, Tests, and Protocols</p>
                            </div>
                            <div className="flex gap-3">
                                <label className="bg-violet-100 hover:bg-violet-200 text-violet-800 font-bold py-2.5 px-6 rounded-lg shadow-sm transition-colors flex items-center gap-2 cursor-pointer">
                                    <span className="text-lg">📂</span> Apri File
                                    <input type="file" accept=".html" onChange={loadHTML} className="hidden"/>
                                </label>
                                <button onClick={createNewDataset} disabled={!isCloudReady} className={`font-bold py-2.5 px-6 rounded-lg shadow-sm transition-colors flex items-center gap-2 ${isCloudReady ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-slate-300 text-slate-500 cursor-not-allowed'}`}>
                                    <span className="text-lg">+</span> New Dataset
                                </button>
                            </div>
                        </div>
                        
                        {!isCloudReady ? (
                            <div className="text-center py-20 flex flex-col items-center gap-4">
                                <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin"></div>
                                <h2 className="text-xl font-bold text-slate-700">Connecting to Cloud...</h2>
                                <p className="text-slate-500">Syncing your workspace data securely.</p>
                            </div>
                        ) : Object.keys(groupedDatasets).length === 0 ? (
                            <div className="text-center py-16 text-slate-500 text-lg flex flex-col items-center gap-4">
                                <span className="text-4xl opacity-50">📂</span>
                                <span>No datasets found. Create a new one to start!</span>
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
                                            <p className="text-xs text-slate-500 mb-4 font-medium bg-slate-100 inline-block px-2 py-1 rounded-md self-start">
                                                {group.items.length} Dataset{group.items.length === 1 ? '' : 's'}
                                            </p>
                                            <div className="flex flex-col gap-2 flex-1">
                                                {group.items.slice(0, isExpanded ? undefined : 3).map(dset => (
                                                    <div key={dset.id} onClick={() => openDataset(dset)} className="bg-white border border-slate-200 hover:border-blue-400 hover:shadow-md p-3 rounded-lg cursor-pointer flex justify-between items-center transition-all group/item">
                                                        <div className="flex flex-col overflow-hidden">
                                                            <span className="font-bold text-sm text-blue-700 truncate">{dset.title || groupTitle}</span>
                                                            <span className="text-[11px] text-slate-500 mt-1 flex gap-2">
                                                                <span>📅 {dset.date || 'No Date'}</span>
                                                                <span>🧪 {dset.testCount || 1} Tests</span>
                                                            </span>
                                                        </div>
                                                        <div className="flex flex-col gap-1 opacity-0 group-hover/item:opacity-100 transition-all shrink-0 ml-2">
                                                            <button onClick={(e) => renameDataset(e, dset.id, dset.title || groupTitle)} className="text-slate-500 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded text-xs font-bold transition-colors">Rename</button>
                                                            <button onClick={(e) => { e.stopPropagation(); deleteDataset(e, dset.id); }} className="text-slate-500 hover:text-red-600 hover:bg-red-50 px-2 py-1 rounded text-xs font-bold transition-colors">Delete</button>
                                                        </div>
                                                    </div>
                                                ))}
                                                {group.items.length > 3 && (
                                                    <button onClick={() => toggleGroup(group.key)} className="text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 font-bold py-2 rounded-lg mt-2 text-center transition-colors w-full">
                                                        {isExpanded ? 'Hide Datasets' : `Show ${group.items.length - 3} more...`}
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

            {appView === 'dataset' && (
                <div className="flex h-screen w-full overflow-hidden">
                    <div className="w-64 bg-white border-r border-slate-200 flex flex-col shadow-sm z-30 shrink-0 no-print">
                        <div className="p-4 border-b border-slate-200 flex items-center gap-2">
                            <button onClick={handleBackToExplorer} className="text-slate-400 hover:text-blue-600 transition-colors" title="Back to Workspace">◀</button>
                            <div className="min-w-0 flex-1">
                                <input value={datasetTitle} onChange={e=>setDatasetTitle(e.target.value)} className="w-full text-sm font-black text-slate-800 bg-transparent border-none outline-none truncate focus:ring-1 focus:ring-blue-500 rounded px-1" placeholder="Dataset Title"/>
                                <input value={datasetSubtitle} onChange={e=>setDatasetSubtitle(e.target.value)} className="w-full text-[10px] font-medium text-slate-500 bg-transparent border-none outline-none truncate focus:ring-1 focus:ring-blue-500 rounded px-1 mt-0.5" placeholder="Subtitle / Project info"/>
                            </div>
                        </div>

                        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center text-[10px] font-bold text-slate-500">
                            <span>Status:</span>
                            {saveStatus === 'saving' ? <span className="text-blue-500 animate-pulse">💾 Saving...</span> :
                             saveStatus === 'saved' ? <span className="text-emerald-600">☁️ Cloud Sync</span> :
                             saveStatus === 'error' ? <span className="text-red-600" title={saveErrorMsg}>❌ Error</span> :
                             <span className="text-slate-600">...</span>}
                        </div>

                        <nav className="flex-1 overflow-y-auto py-4 flex flex-col gap-1 px-2">
                            <button 
                                onClick={handleBackToExplorer}
                                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all text-left bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 font-bold shadow-sm mb-4"
                            >
                                <span className="text-lg w-5 text-center">📁</span>
                                Lista dei File Presenti
                            </button>
                            {[
                                { id: 'dashboard', icon: '📊', label: 'Dataset Overview' },
                                { id: 'agenda', icon: '🗓️', label: 'Agenda (Timeline)' },
                                { id: 'storage', icon: '📦', label: 'Storage & Boxes' },
                                { id: 'tests', icon: '🧪', label: 'Tests & Fittings' },
                                { id: 'protocols', icon: '📝', label: 'Protocols' },
                                { id: 'notebook', icon: '📓', label: 'Lab Notebook' }
                            ].map(nav => (
                                <button 
                                    key={nav.id}
                                    onClick={() => setCurrentModule(nav.id)}
                                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all text-left ${currentModule === nav.id ? 'bg-blue-50 text-blue-700 font-bold shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
                                >
                                    <span className="text-lg w-5 text-center">{nav.icon}</span>
                                    {nav.label}
                                </button>
                            ))}
                        </nav>
                        
                        <div className="p-4 border-t border-slate-200 flex flex-col gap-2">
                            <div className="flex gap-2">
                                <label className="flex-1 text-center bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 font-bold py-1.5 rounded text-xs cursor-pointer shadow-sm transition-colors">
                                    📂 Load HTML
                                    <input type="file" accept=".html" onChange={loadHTML} className="hidden"/>
                                </label>
                                <button onClick={exportHTML} className="flex-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-bold py-1.5 rounded text-xs shadow-sm transition-colors">💾 Save HTML</button>
                            </div>
                            <div className="flex gap-2 justify-center mt-2">
                                <button onClick={handleUndo} disabled={historyIndex === 0} className={`p-2 rounded border shadow-sm transition-colors ${historyIndex > 0 ? 'bg-white hover:bg-slate-50 text-slate-700' : 'bg-slate-50 text-slate-300'}`} title="Undo">↩</button>
                                <button onClick={handleRedo} disabled={historyIndex >= historyRef.current.length - 1} className={`p-2 rounded border shadow-sm transition-colors ${historyIndex < historyRef.current.length - 1 ? 'bg-white hover:bg-slate-50 text-slate-700' : 'bg-slate-50 text-slate-300'}`} title="Redo">↪</button>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 flex flex-col bg-slate-50 h-full overflow-hidden relative">
                        {currentModule === 'dashboard' && (
                            <div className="p-8 h-full overflow-y-auto custom-scrollbar bg-slate-50">
                                <div className="max-w-6xl mx-auto">
                                    <div className="flex justify-between items-end mb-8 border-b border-slate-200 pb-4">
                                        <div>
                                            <h1 className="text-3xl font-bold text-slate-800">{datasetTitle || 'Dataset Overview'}</h1>
                                            <p className="text-slate-500 mt-1">{datasetSubtitle || 'Manage your experiments, inventory, and protocols.'}</p>
                                        </div>
                                        <button onClick={handlePrint} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center gap-2 shadow-sm no-print">
                                            🖨️ Print / Save PDF
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                                        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm">
                                            <div className="text-slate-500 text-xs font-bold uppercase tracking-wide">Total Tests</div>
                                            <div className="text-3xl font-bold text-slate-800 mt-1">{tests.filter(t => t.type !== 'plate-9x9box').length}</div>
                                        </div>
                                        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm">
                                            <div className="text-slate-500 text-xs font-bold uppercase tracking-wide">Stored Boxes</div>
                                            <div className="text-3xl font-bold text-slate-800 mt-1">{tests.filter(t => t.type === 'plate-9x9box').length}</div>
                                        </div>
                                        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm">
                                            <div className="text-slate-500 text-xs font-bold uppercase tracking-wide">Storage Units</div>
                                            <div className="text-3xl font-bold text-slate-800 mt-1">{storages.length}</div>
                                        </div>
                                        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm">
                                            <div className="text-slate-500 text-xs font-bold uppercase tracking-wide">Upcoming Tasks</div>
                                            <div className="text-3xl font-bold text-slate-800 mt-1">{mergedPlan.filter(t => t.date >= new Date().toISOString().split('T')[0]).length}</div>
                                        </div>
                                    </div>
                                    <h2 className="text-lg font-bold text-slate-700 mb-4">Quick Navigation</h2>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {[
                                            { id: 'tests', icon: '🧪', title: 'Tests & Assays', desc: 'Manage experimental plates and spectroscopic data.' },
                                            { id: 'storage', icon: '📦', title: 'Storage & Inventory', desc: 'Track physical boxes and storage locations.' },
                                            { id: 'agenda', icon: '🗓️', title: 'Project Agenda', desc: 'Timeline of all scheduled experimental tasks.' },
                                            { id: 'protocols', icon: '📝', title: 'Protocols Library', desc: 'Draft, store, and link experimental procedures.' },
                                            { id: 'notebook', icon: '📓', title: 'Lab Notebook', desc: 'Consolidated view of all experiment notes and results.' }
                                        ].map(mod => (
                                            <button 
                                                key={mod.id}
                                                onClick={() => setCurrentModule(mod.id)}
                                                className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-400 transition-all text-left group no-print"
                                            >
                                                <div className="text-2xl mb-3 group-hover:scale-110 transition-transform duration-200">{mod.icon}</div>
                                                <h3 className="font-bold text-slate-800 text-lg mb-1">{mod.title}</h3>
                                                <p className="text-sm text-slate-500">{mod.desc}</p>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {currentModule === 'agenda' && (
                            <div className="p-6 h-full overflow-y-auto custom-scrollbar flex flex-col">
                                <div className="mb-6 flex justify-between items-end border-b border-slate-200 pb-4">
                                    <div>
                                        <h2 className="text-2xl font-black text-slate-800">Project Timeline (Agenda)</h2>
                                        <p className="text-sm text-slate-500">Aggregated view of all tasks scheduled across tests.</p>
                                    </div>
                                    <button onClick={handlePrint} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center gap-2 shadow-sm no-print">
                                        🖨️ Print / Save PDF
                                    </button>
                                </div>
                                <div className="flex flex-col md:flex-row gap-6">
                                    <div className="w-full md:w-80 bg-white border border-slate-200 rounded-xl p-4 shadow-sm shrink-0 h-fit no-print">
                                        <div className="flex justify-between items-center mb-4">
                                            <button onClick={handlePrevMonth} className="text-slate-400 hover:text-blue-600 font-bold p-1 rounded hover:bg-slate-50 transition-colors">◀</button>
                                            <h3 className="text-sm font-bold text-slate-700">{monthName}</h3>
                                            <button onClick={handleNextMonth} className="text-slate-400 hover:text-blue-600 font-bold p-1 rounded hover:bg-slate-50 transition-colors">▶</button>
                                        </div>
                                        <div className="grid grid-cols-7 gap-1 text-center mb-2">
                                            {['M','T','W','T','F','S','S'].map((d,i)=><div key={i} className="text-[11px] font-bold text-slate-400">{d}</div>)}
                                        </div>
                                        <div className="grid grid-cols-7 gap-1">
                                            {Array.from({length: startDayOffset}).map((_, i) => <div key={`empty-${i}`}></div>)}
                                            {Array.from({length: totalDays}, (_,i)=>{
                                                const day = String(i+1).padStart(2,'0');
                                                const month = String(currentMonth.getMonth()+1).padStart(2,'0');
                                                const dateStr = `${currentMonth.getFullYear()}-${month}-${day}`;
                                                const hasTask = mergedPlan.some(p => p.date === dateStr);
                                                const isSel = calFilterDate === dateStr;
                                                return (
                                                    <button key={i} onClick={()=>setCalFilterDate(isSel ? null : dateStr)}
                                                        className={`text-[11px] py-1.5 rounded-md transition-all font-medium ${isSel ? 'bg-blue-600 text-white shadow-md scale-105' : hasTask ? 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100' : 'text-slate-600 hover:bg-slate-100'}`}>
                                                        {i+1}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        {calFilterDate && (
                                            <button onClick={()=>setCalFilterDate(null)} className="mt-4 w-full text-xs text-red-500 font-bold hover:bg-red-50 py-2 rounded transition-colors">Clear Filter</button>
                                        )}
                                    </div>
                                    <div className="flex-1 bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                                        <h3 className="text-lg font-bold text-slate-700 mb-4 border-b border-slate-100 pb-2">
                                            {calFilterDate ? `Tasks for ${calFilterDate}` : 'All Scheduled Tasks'}
                                        </h3>
                                        <div className="flex flex-col gap-4">
                                            {Object.keys(agendaGrouped).length === 0 ? (
                                                <div className="text-center text-slate-400 py-10 italic">No tasks planned across any test.</div>
                                            ) : (
                                                (calFilterDate ? (agendaGrouped[calFilterDate] ? [[calFilterDate, agendaGrouped[calFilterDate]]] : []) : Object.entries(agendaGrouped)).map(([date, tasks]) => (
                                                    <div key={date} className="flex flex-col">
                                                        <h4 className="font-bold text-sm text-slate-500 mb-2">{date}</h4>
                                                        <div className="flex flex-col gap-2">
                                                            {tasks.map((t, idx) => (
                                                                <div key={idx} className="flex items-center gap-3 bg-slate-50 p-3 border border-slate-200 rounded-lg group hover:border-blue-300 transition-colors">
                                                                    <button onClick={()=>jumpToTest(t.testId)} className="text-xs font-bold bg-blue-100 hover:bg-blue-200 text-blue-800 px-3 py-1.5 rounded-md transition-colors whitespace-nowrap shadow-sm">
                                                                        {t.testName}
                                                                    </button>
                                                                    <span className="text-sm text-slate-700 flex-1">{t.task}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {currentModule === 'storage' && (
                            <div className="p-6 h-full overflow-y-auto custom-scrollbar flex flex-col">
                                <div className="mb-6 flex justify-between items-end border-b border-slate-200 pb-4">
                                    <div>
                                        <h2 className="text-2xl font-black text-slate-800">Storage Locations</h2>
                                        <p className="text-sm text-slate-500">Manage your physical storage units and navigate inside them to add boxes.</p>
                                    </div>
                                    <div className="flex gap-2 no-print">
                                        <button onClick={handlePrint} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center gap-2 shadow-sm">
                                            🖨️ Print / Save PDF
                                        </button>
                                        <button onClick={() => setStorageModal({})} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-6 rounded-lg shadow-sm text-sm transition-colors flex items-center gap-2">
                                            ➕ Add Storage
                                        </button>
                                    </div>
                                </div>
                                {storages.length === 0 ? (
                                    <div className="bg-white border border-dashed border-slate-300 rounded-xl p-16 text-center shadow-sm">
                                        <div className="text-5xl mb-4 opacity-50">🚪</div>
                                        <p className="text-slate-600 font-bold text-xl">No storage locations defined.</p>
                                        <p className="text-sm text-slate-400 mt-2">Click "Add Storage" to create your first freezer or closet.</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                                        {storages.map(st => {
                                            const boxesInStorage = tests.filter(t => t.type === 'plate-9x9box' && t.storageId === st.id);
                                            const totalSlots = st.rows * st.cols;
                                            const icon = st.type === 'Refrigerator' ? '❄️' : st.type === 'Freezer' ? '🧊' : '🚪';
                                            return (
                                                <div key={st.id} onClick={() => { setActiveStorageId(st.id); setCurrentModule('storage-detail'); }} className="bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-lg hover:border-indigo-400 cursor-pointer transition-all overflow-hidden flex flex-col group">
                                                    {st.imageUrl ? (
                                                        <div className="h-40 w-full overflow-hidden border-b border-slate-100 relative">
                                                            <img src={getDirectImageUrl(st.imageUrl)} alt={st.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"/>
                                                            <div className="absolute inset-0 bg-gradient-to-t from-slate-900/50 to-transparent"></div>
                                                            <span className="absolute bottom-3 left-3 text-3xl drop-shadow-md">{icon}</span>
                                                        </div>
                                                    ) : (
                                                        <div className="h-24 w-full bg-slate-50 border-b border-slate-100 flex items-center justify-center text-4xl">{icon}</div>
                                                    )}
                                                    <div className="p-5 flex flex-col relative">
                                                        <button onClick={(e) => { e.stopPropagation(); setStorageModal(st); }} className="absolute top-4 right-4 text-slate-400 hover:text-indigo-600 transition-colors z-10 no-print">✏️</button>
                                                        <span className="text-[10px] font-black uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded self-start mb-2">{st.type}</span>
                                                        <h3 className="font-bold text-slate-800 text-lg truncate pr-6">{st.name}</h3>
                                                        <p className="text-xs text-slate-500 mt-1 font-medium">Grid: {st.rows} rows × {st.cols} cols ({totalSlots} slots)</p>
                                                        <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center text-xs font-bold">
                                                            <span className="text-slate-500">📦 {boxesInStorage.length} Boxes Stored</span>
                                                            <span className={boxesInStorage.length >= totalSlots ? 'text-red-500' : 'text-emerald-600'}>{Math.round((boxesInStorage.length / totalSlots) * 100)}% Full</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                        )}

                        {currentModule === 'storage-detail' && (() => {
                            const st = storages.find(s => s.id === activeStorageId);
                            if (!st) return <div className="p-6">Storage not found.</div>;
                            const boxesInStorage = tests.filter(t => t.type === 'plate-9x9box' && t.storageId === st.id);
                            
                            const handleAddBox = (slotIndex) => {
                                const id = 't' + Date.now();
                                const newBox = createEmptyTest(id, tests.length + 1, 'plate-9x9box');
                                newBox.storageId = st.id;
                                if(slotIndex !== undefined) newBox.storageIndex = slotIndex;
                                setTests(prev => [...prev, newBox]);
                                setActiveTestId(id); setCurrentModule('active-test');
                            };

                            return (
                                <div className="p-6 h-full overflow-y-auto custom-scrollbar flex flex-col bg-slate-50">
                                    <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-end gap-4 shrink-0">
                                        <div className="flex items-center gap-4">
                                            <button onClick={() => setCurrentModule('storage')} className="text-slate-400 hover:text-indigo-600 transition-colors bg-white p-2 rounded-lg shadow-sm border border-slate-200 no-print">◀ Back</button>
                                            <div>
                                                <h2 className="text-2xl font-black text-slate-800 flex items-center gap-2">{st.type === 'Refrigerator' ? '❄️' : st.type === 'Freezer' ? '🧊' : '🚪'} {st.name}</h2>
                                                <p className="text-sm text-slate-500">Capacity: {st.rows * st.cols} slots. Click an empty slot to add a box.</p>
                                            </div>
                                        </div>
                                        <div className="flex gap-2 no-print">
                                            <button onClick={handlePrint} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center gap-2 shadow-sm">
                                                🖨️ Print / Save PDF
                                            </button>
                                            <button onClick={() => handleAddBox()} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-6 rounded-lg shadow-sm text-sm transition-colors flex items-center gap-2">📦 Add Box Here</button>
                                        </div>
                                    </div>
                                    <div className="flex-1 flex flex-col xl:flex-row gap-6 min-h-0">
                                        {st.imageUrl && (
                                            <div className="w-full xl:w-1/3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm shrink-0 flex flex-col no-print">
                                                <h3 className="text-xs font-bold text-slate-500 uppercase mb-3">Reference Image</h3>
                                                <div className="flex-1 rounded-lg overflow-hidden border border-slate-100">
                                                    <img src={getDirectImageUrl(st.imageUrl)} alt={st.name} className="w-full h-full object-cover"/>
                                                </div>
                                            </div>
                                        )}
                                        <div className="flex-1 bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col">
                                            <h3 className="text-xs font-bold text-slate-500 uppercase mb-4 border-b border-slate-100 pb-2 flex justify-between">
                                                <span>Interactive Grid</span>
                                                <span className="text-indigo-600">{boxesInStorage.length} / {st.rows * st.cols} Used</span>
                                            </h3>
                                            <div className="flex-1 overflow-auto custom-scrollbar bg-slate-50 rounded-xl p-6 border border-slate-100 shadow-inner flex items-center justify-center">
                                                <div className="grid gap-3 max-w-full" style={{ gridTemplateColumns: `repeat(${st.cols}, minmax(80px, 120px))` }}>
                                                    {Array.from({length: st.rows * st.cols}).map((_, i) => {
                                                        const box = boxesInStorage.find(b => b.storageIndex === i);
                                                        return (
                                                            <div key={i} onClick={() => { if (box) jumpToTest(box.id); else handleAddBox(i); }}
                                                                className={`relative aspect-square border-2 rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all shadow-sm overflow-hidden p-2 text-center group
                                                                ${box ? 'bg-white border-indigo-300 hover:border-indigo-500 hover:shadow-md' : 'bg-slate-100 border-dashed border-slate-300 text-slate-400 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-600'}`} 
                                                                title={box ? `Open Box: ${box.name}` : `Add Box to Slot ${i+1}`}>
                                                                <span className="absolute top-1 left-1.5 text-[9px] font-black text-slate-300 select-none">{i+1}</span>
                                                                {box ? (
                                                                    <React.Fragment>
                                                                        <span className="text-2xl mb-1 drop-shadow-sm">📦</span>
                                                                        <span className="text-[10px] font-bold text-indigo-900 leading-tight w-full truncate">{box.name}</span>
                                                                        <span className="text-[9px] text-slate-500 truncate w-full">{box.instanceName || box.date}</span>
                                                                        
                                                                        <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-20 no-print">
                                                                            <button 
                                                                                onClick={(e) => { e.stopPropagation(); setMoveModal({ boxId: box.id, currentStorageId: st.id, targetStorageId: st.id }); }} 
                                                                                className="bg-blue-500 hover:bg-blue-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs shadow-sm" 
                                                                                title="Move Box"
                                                                            >↕️</button>
                                                                            <button 
                                                                                onClick={(e) => { 
                                                                                    e.stopPropagation(); 
                                                                                    if(confirm(`Delete box "${box.name}"?`)) {
                                                                                        setTests(prev => prev.filter(t => t.id !== box.id));
                                                                                    }
                                                                                }} 
                                                                                className="bg-red-500 hover:bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs shadow-sm" 
                                                                                title="Delete Box"
                                                                            >🗑️</button>
                                                                        </div>
                                                                    </React.Fragment>
                                                                ) : (
                                                                    <React.Fragment>
                                                                        <span className="text-xl mb-1 opacity-50">+</span>
                                                                        <span className="text-[9px] font-bold uppercase">Empty</span>
                                                                    </React.Fragment>
                                                                )}
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

                        {currentModule === 'tests' && (() => {
                            const testSearch = expandedGroups['testSearch'] || '';
                            const testCatFilter = expandedGroups['testCatFilter'] || 'ALL';
                            const showCatMgr = expandedGroups['showTestCatMgr'] || false;
                            const newCatInput = expandedGroups['newTestCatInput'] || '';

                            const filteredTestsRaw = tests.filter(t => {
                                if (t.type === 'plate-9x9box') return false;
                                const matchesSearch = t.name.toLowerCase().includes(testSearch.toLowerCase()) || (t.instanceName || '').toLowerCase().includes(testSearch.toLowerCase());
                                const matchesCat = testCatFilter === 'ALL' || t.testCategory === testCatFilter;
                                return matchesSearch && matchesCat;
                            });

                            const filteredTests = [];
                            const seenTestNames = new Set();
                            filteredTestsRaw.forEach(t => {
                                if (!seenTestNames.has(t.name)) { seenTestNames.add(t.name); filteredTests.push(t); }
                            });

                            return (
                                <div className="p-6 h-full flex flex-col">
                                    <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4 border-b border-slate-200 pb-4">
                                        <div>
                                            <h2 className="text-2xl font-black text-slate-800">Tests & Assays</h2>
                                            <p className="text-sm text-slate-500">Manage all experimental plates, boxes, and spectroscopic data.</p>
                                        </div>
                                        <div className="flex flex-wrap gap-2 no-print">
                                            <button onClick={handlePrint} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center gap-2 shadow-sm">
                                                🖨️ Print / Save PDF
                                            </button>
                                            <button onClick={() => {
                                                const id = 't' + Date.now();
                                                setTests(prev => [...prev, createEmptyTest(id, prev.length + 1, 'plate-96')]);
                                                setActiveTestId(id); setCurrentModule('active-test');
                                            }} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded shadow-sm text-sm transition-colors">+ Plate Test</button>
                                            <button onClick={() => {
                                                const id = 't' + Date.now();
                                                setTests(prev => [...prev, createEmptyTest(id, prev.length + 1, 'nmr')]);
                                                setActiveTestId(id); setCurrentModule('active-test');
                                            }} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-4 rounded shadow-sm text-sm transition-colors">+ NMR Spectrum</button>
                                        </div>
                                    </div>

                                    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 mb-6 flex flex-col gap-4 shrink-0 no-print">
                                        <div className="flex flex-col md:flex-row gap-4 items-center">
                                            <div className="flex-1 w-full relative">
                                                <span className="absolute left-3 top-2.5 text-slate-400">🔍</span>
                                                <input type="text" placeholder="Search tests by name..." value={testSearch} onChange={e => setExpandedGroups(p=>({...p, testSearch: e.target.value}))} className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"/>
                                            </div>
                                            <div className="w-full md:w-64 flex gap-2">
                                                <select value={testCatFilter} onChange={e => setExpandedGroups(p=>({...p, testCatFilter: e.target.value}))} className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-500 font-semibold text-slate-700 cursor-pointer">
                                                    <option value="ALL">All Categories</option>
                                                    {testCategories.map(c => <option key={c} value={c}>{c}</option>)}
                                                </select>
                                                <button onClick={() => setExpandedGroups(p=>({...p, showTestCatMgr: !showCatMgr}))} className={`px-3 py-2 border rounded-lg text-sm font-bold transition-colors shadow-sm ${showCatMgr ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-slate-50 border-slate-300 text-slate-600 hover:bg-slate-100'}`} title="Manage Categories">⚙️</button>
                                            </div>
                                        </div>
                                        {showCatMgr && (
                                            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 flex flex-col gap-3">
                                                <h4 className="text-xs font-bold text-slate-500 uppercase">Manage Test Categories</h4>
                                                <div className="flex gap-2">
                                                    <input type="text" placeholder="New category name..." value={newCatInput} onChange={e => setExpandedGroups(p=>({...p, newTestCatInput: e.target.value}))} className="flex-1 border border-slate-300 rounded px-3 py-1.5 text-sm outline-none focus:border-blue-500"/>
                                                    <button onClick={() => {
                                                        const v = newCatInput.trim();
                                                        if(v && !testCategories.includes(v)) {
                                                            setTestCategories([...testCategories, v]); setExpandedGroups(p=>({...p, newTestCatInput: ''}));
                                                        }
                                                    }} className="bg-blue-600 text-white font-bold px-4 py-1.5 rounded text-sm shadow-sm hover:bg-blue-700 transition-colors">Add</button>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                                        {filteredTests.length === 0 ? (
                                            <div className="text-center py-10 text-slate-400 italic">No tests match your filters.</div>
                                        ) : (
                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                                {filteredTests.map(test => (
                                                    <div key={test.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md hover:border-blue-400 cursor-pointer transition-all flex flex-col group relative" onClick={() => { setActiveTestId(test.id); setCurrentModule('active-test'); }}>
                                                        <div className="absolute top-3 right-3 text-2xl opacity-80 group-hover:scale-110 transition-transform">
                                                            {test.type === 'nmr' ? '📉' : test.type === 'plate-9x9box' ? '📦' : '🧫'}
                                                        </div>
                                                        <span className="text-[10px] font-black uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-0.5 rounded self-start mb-2 border border-blue-100">{test.testCategory || 'Uncategorized'}</span>
                                                        <h3 className="font-bold text-slate-800 text-lg truncate pr-8">{test.name}</h3>
                                                        <p className="text-xs text-slate-500 mt-1">Instance: {test.instanceName || 'Primary'}</p>
                                                        <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center text-xs text-slate-500 font-medium">
                                                            <span>📅 {test.date}</span>
                                                            <span className="bg-slate-100 px-2 py-0.5 rounded font-bold text-slate-600">{test.type.replace('plate-', '').toUpperCase()}</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}

                        {currentModule === 'protocols' && (() => {
                            const protoSearch = expandedGroups['protoSearch'] || '';
                            const protoCatFilter = expandedGroups['protoCatFilter'] || 'ALL';
                            const showProtoCatMgr = expandedGroups['showProtoCatMgr'] || false;
                            const newProtoCatInput = expandedGroups['newProtoCatInput'] || '';
                            const activeProtoId = expandedGroups['activeProtoId'] || null;

                            const filteredProtocols = datasetProtocols.filter(p => {
                                const matchesSearch = p.title.toLowerCase().includes(protoSearch.toLowerCase());
                                const matchesCat = protoCatFilter === 'ALL' || p.category === protoCatFilter;
                                return matchesSearch && matchesCat;
                            });

                            const activeProtocol = activeProtoId ? datasetProtocols.find(p => p.id === activeProtoId) : null;

                            if (activeProtocol) {
                                return (
                                    <div className="p-6 h-full flex flex-col bg-white">
                                        <div className="flex items-center gap-3 mb-6 border-b border-slate-100 pb-4 shrink-0">
                                            <button onClick={() => setExpandedGroups(p=>({...p, activeProtoId: null}))} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 p-2 rounded-lg transition-colors shadow-sm no-print">◀ Back</button>
                                            <div className="flex-1">
                                                <input type="text" value={activeProtocol.title} onChange={e => setDatasetProtocols(datasetProtocols.map(p => p.id === activeProtocol.id ? {...p, title: e.target.value} : p))} className="text-2xl font-black text-slate-800 bg-transparent border-none outline-none w-full focus:ring-1 focus:ring-blue-500 rounded px-1" placeholder="Protocol Title"/>
                                            </div>
                                            <select value={activeProtocol.category} onChange={e => setDatasetProtocols(datasetProtocols.map(p => p.id === activeProtocol.id ? {...p, category: e.target.value} : p))} className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-slate-50 font-semibold text-slate-700 outline-none cursor-pointer no-print">
                                                {protocolCategories.map(c => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                        </div>

                                        <div className="flex-1 flex flex-col lg:flex-row gap-6 overflow-hidden">
                                            <div className="flex-1 flex flex-col h-full min-h-[300px]">
                                                <label className="text-xs font-bold text-slate-500 uppercase mb-2">Protocol Description & Steps</label>
                                                <RichTextEditor
                                                    value={activeProtocol.content || ''}
                                                    onChange={val => setDatasetProtocols(datasetProtocols.map(p => p.id === activeProtocol.id ? {...p, content: val} : p))}
                                                    placeholder="Write the detailed protocol steps here. You can paste images directly..."
                                                />
                                                
                                                {/* LINKED TESTS SECTION */}
                                                <div className="mt-6 border-t border-slate-100 pt-4 no-print">
                                                    <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">🧪 Tests Using This Protocol</h4>
                                                    <div className="flex flex-wrap gap-2">
                                                        {tests.filter(t => t.linkedProtocolId === activeProtocol.id).length === 0 && (
                                                            <span className="text-sm text-slate-400 italic">No tests are currently linked to this protocol.</span>
                                                        )}
                                                        {tests.filter(t => t.linkedProtocolId === activeProtocol.id).map(t => (
                                                            <button
                                                                key={t.id}
                                                                onClick={() => { setActiveTestId(t.id); setCurrentModule('active-test'); }}
                                                                className="text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 px-3 py-1.5 rounded-lg shadow-sm transition-colors flex items-center gap-1"
                                                            >
                                                                {t.type === 'nmr' ? '📉' : '🧫'} {t.name} {t.instanceName ? `(${t.instanceName})` : ''}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="w-full lg:w-80 flex flex-col gap-4 overflow-y-auto custom-scrollbar shrink-0 border-l border-slate-100 pl-4 no-print">
                                                <label className="text-xs font-bold text-slate-500 uppercase">Attached Resources</label>
                                                <div className="flex flex-col gap-2">
                                                    {(activeProtocol.links || []).length === 0 && <span className="text-sm text-slate-400 italic">No external links or documents attached.</span>}
                                                    {(activeProtocol.links || []).map(link => (
                                                        <div key={link.id} className="bg-slate-50 border border-slate-200 p-2.5 rounded-lg flex items-center justify-between group shadow-sm">
                                                            <div className="flex items-center gap-2 overflow-hidden cursor-pointer flex-1" onClick={() => {
                                                                const newName = prompt("Rename link:", link.name);
                                                                if(newName) setDatasetProtocols(datasetProtocols.map(p => p.id === activeProtocol.id ? {...p, links: p.links.map(l => l.id === link.id ? {...l, name: newName} : l)} : p));
                                                            }}>
                                                                <span className="text-lg">{link.url.match(/\.(jpeg|jpg|gif|png|svg)$/i) ? '🖼️' : '🔗'}</span>
                                                                <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-slate-700 truncate group-hover:text-blue-600" onClick={e=>e.stopPropagation()}>{link.name}</a>
                                                            </div>
                                                            <button onClick={() => setDatasetProtocols(datasetProtocols.map(p => p.id === activeProtocol.id ? {...p, links: p.links.filter(l => l.id !== link.id)} : p))} className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 font-bold px-1 transition-opacity">&times;</button>
                                                        </div>
                                                    ))}
                                                </div>
                                                <div className="flex flex-col gap-2">
                                                    <button onClick={() => {
                                                        const url = prompt("Incolla link esterno (Drive, PDF, Image URL):");
                                                        if(url && url.trim()) {
                                                            const newLink = { id: Date.now().toString(), name: 'Risorsa Collegata', url: url.trim() };
                                                            setDatasetProtocols(datasetProtocols.map(p => p.id === activeProtocol.id ? {...p, links: [...(p.links||[]), newLink]} : p));
                                                        }
                                                    }} className="border-2 border-dashed border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 font-bold rounded-lg p-3 text-center transition-colors shadow-sm text-sm">
                                                        + Aggiungi Link Esterno
                                                    </button>
                                                    <label className="border-2 border-dashed border-emerald-200 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 font-bold rounded-lg p-3 text-center transition-colors shadow-sm text-sm cursor-pointer block">
                                                        + Allega Files Multipli
                                                        <input type="file" multiple onChange={(e) => {
                                                            const files = Array.from(e.target.files);
                                                            if (!files.length) return;
                                                            const newLinksPromises = files.map(file => new Promise((resolve) => {
                                                                const reader = new FileReader();
                                                                reader.onload = (ev) => resolve({ id: Date.now().toString() + Math.random(), name: file.name, url: ev.target.result });
                                                                reader.readAsDataURL(file);
                                                            }));
                                                            Promise.all(newLinksPromises).then(newLinks => {
                                                                setDatasetProtocols(datasetProtocols.map(p => 
                                                                    p.id === activeProtocol.id ? {...p, links: [...(p.links||[]), ...newLinks]} : p
                                                                ));
                                                            });
                                                            e.target.value = '';
                                                        }} className="hidden"/>
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            }

                            return (
                                <div className="p-6 h-full flex flex-col">
                                    <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4 border-b border-slate-200 pb-4">
                                        <div>
                                            <h2 className="text-2xl font-black text-slate-800">Protocols Library</h2>
                                            <p className="text-sm text-slate-500">Draft, store, and link your experimental procedures.</p>
                                        </div>
                                        <div className="flex gap-2 no-print">
                                            <button onClick={handlePrint} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center gap-2 shadow-sm">
                                                🖨️ Print / Save PDF
                                            </button>
                                            <button onClick={() => {
                                                const newProto = { id: 'pr' + Date.now(), title: 'Untitled Protocol', category: protocolCategories[0] || 'Uncategorized', content: '', links: [] };
                                                setDatasetProtocols([newProto, ...datasetProtocols]);
                                                setExpandedGroups(p=>({...p, activeProtoId: newProto.id}));
                                            }} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 px-6 rounded-lg shadow-sm text-sm transition-colors flex items-center gap-2">
                                                ➕ New Protocol
                                            </button>
                                        </div>
                                    </div>
                                    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 mb-6 flex flex-col gap-4 shrink-0 no-print">
                                        <div className="flex flex-col md:flex-row gap-4 items-center">
                                            <div className="flex-1 w-full relative">
                                                <span className="absolute left-3 top-2.5 text-slate-400">🔍</span>
                                                <input type="text" placeholder="Search protocols..." value={protoSearch} onChange={e => setExpandedGroups(p=>({...p, protoSearch: e.target.value}))} className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"/>
                                            </div>
                                            <div className="w-full md:w-64 flex gap-2">
                                                <select value={protoCatFilter} onChange={e => setExpandedGroups(p=>({...p, protoCatFilter: e.target.value}))} className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-emerald-500 font-semibold text-slate-700 cursor-pointer">
                                                    <option value="ALL">All Categories</option>
                                                    {protocolCategories.map(c => <option key={c} value={c}>{c}</option>)}
                                                </select>
                                                <button onClick={() => setExpandedGroups(p=>({...p, showProtoCatMgr: !showProtoCatMgr}))} className={`px-3 py-2 border rounded-lg text-sm font-bold transition-colors shadow-sm ${showProtoCatMgr ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-slate-50 border-slate-300 text-slate-600 hover:bg-slate-100'}`} title="Manage Categories">⚙️</button>
                                            </div>
                                        </div>

                                        {showProtoCatMgr && (
                                            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 flex flex-col gap-3">
                                                <h4 className="text-xs font-bold text-slate-500 uppercase">Manage Protocol Categories</h4>
                                                <div className="flex gap-2">
                                                    <input type="text" placeholder="New category name..." value={newProtoCatInput} onChange={e => setExpandedGroups(p=>({...p, newProtoCatInput: e.target.value}))} className="flex-1 border border-slate-300 rounded px-3 py-1.5 text-sm outline-none focus:border-emerald-500"/>
                                                    <button onClick={() => {
                                                        const v = newProtoCatInput.trim();
                                                        if(v && !protocolCategories.includes(v)) {
                                                            setProtocolCategories([...protocolCategories, v]); setExpandedGroups(p=>({...p, newProtoCatInput: ''}));
                                                        }
                                                    }} className="bg-emerald-600 text-white font-bold px-4 py-1.5 rounded text-sm shadow-sm hover:bg-emerald-700 transition-colors">Add</button>
                                                </div>
                                                <div className="flex flex-wrap gap-2 mt-2">
                                                    {protocolCategories.map(c => (
                                                        <div key={c} className="flex items-center gap-1 bg-white border border-slate-300 px-2 py-1 rounded text-xs shadow-sm font-semibold text-slate-700">
                                                            {c} <button onClick={() => setProtocolCategories(protocolCategories.filter(cat => cat !== c))} className="text-slate-400 hover:text-red-500 ml-1 text-sm leading-none font-bold">&times;</button>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                                        {filteredProtocols.length === 0 ? (
                                            <div className="text-center py-10 text-slate-400 italic">No protocols match your filters.</div>
                                        ) : (
                                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                                {filteredProtocols.map(proto => (
                                                    <div key={proto.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md hover:border-emerald-400 cursor-pointer transition-all flex flex-col group relative" onClick={() => setExpandedGroups(p=>({...p, activeProtoId: proto.id}))}>
                                                        <button onClick={(e) => {
                                                            e.stopPropagation();
                                                            if(confirm("Delete this protocol?")) { setDatasetProtocols(datasetProtocols.filter(p => p.id !== proto.id)); }
                                                        }} className="absolute top-3 right-3 text-slate-300 hover:text-red-500 text-lg opacity-0 group-hover:opacity-100 transition-opacity no-print" title="Delete Protocol">&times;</button>
                                                        <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded self-start mb-3 border border-emerald-200">{proto.category}</span>
                                                        <h3 className="font-bold text-slate-800 text-lg truncate pr-6">{proto.title}</h3>
                                                        <div className="mt-4 pt-4 border-t border-slate-100 flex gap-4 text-xs font-bold text-slate-500">
                                                            <span className="flex items-center gap-1">🔗 {(proto.links||[]).length} Links</span>
                                                            <span className="flex items-center gap-1">📝 {proto.content ? 'Has Content' : 'Empty'}</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}

                        {currentModule === 'active-test' && (() => {
                            const activeTest = tests.find(t => t.id === activeTestId);
                            if (!activeTest) return <div className="p-6">Test not found.</div>;
                            
                            const updateActiveTest = (updates) => { setTests(prev => prev.map(t => t.id === activeTestId ? { ...t, ...updates } : t)); };
                            const isBox = activeTest.type === 'plate-9x9box';
                            const siblingTests = isBox ? [] : tests.filter(t => t.name === activeTest.name && t.name.trim() !== '').sort((a,b) => (a.date||'').localeCompare(b.date||''));
                            
                            const jumpToProtocol = (id) => { setExpandedGroups(p => ({ ...p, activeProtoId: id })); setCurrentModule('protocols'); };

                            const handleDuplicateInstance = () => {
                                const id = 't' + Date.now();
                                const newTest = JSON.parse(JSON.stringify(activeTest)); 
                                newTest.id = id; newTest.date = new Date().toISOString().split('T')[0];
                                newTest.instanceName = 'New Instance'; newTest.comments = ''; newTest.images = []; newTest.documents = [];
                                if (newTest.type.startsWith('plate-') && newTest.type !== 'plate-9x9box') {
                                    newTest.grid = newTest.grid.map(row => row.map(() => ''));
                                }
                                setTests(prev => [...prev, newTest]); setActiveTestId(id);
                            };

                            const TestHeader = (
                                <div className="flex flex-col shrink-0 z-20 no-print">
                                    <div className="bg-white border-b border-slate-200 px-6 py-4 flex flex-col md:flex-row justify-between items-start md:items-center shadow-sm gap-4">
                                        <div className="flex items-center gap-4 w-full md:w-auto">
                                            <button onClick={() => {
                                                if (isBox && activeTest.storageId) {
                                                    setActiveStorageId(activeTest.storageId);
                                                    setCurrentModule('storage-detail');
                                                } else {
                                                    setCurrentModule('tests');
                                                }
                                            }} className="text-slate-400 hover:text-blue-600 transition-colors bg-slate-50 hover:bg-blue-50 p-2 rounded-lg shadow-sm border border-slate-200">◀ Back</button>
                                            <div className="flex-1">
                                                <input value={activeTest.name} onChange={e=>updateActiveTest({name: e.target.value})} className="text-xl font-black text-slate-800 bg-transparent border-none outline-none focus:ring-1 focus:ring-blue-500 rounded px-1 w-full md:w-64" placeholder="Test Name"/>
                                                <div className="text-xs text-slate-500 font-medium px-1 mt-1 flex items-center gap-2">
                                                    <span className="uppercase text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">{activeTest.testCategory}</span>
                                                    <span className="uppercase text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">{activeTest.type.replace('plate-', '')}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 w-full md:w-auto">
                                            <div className="flex flex-col flex-1 md:flex-none">
                                                <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Instance</label>
                                                <input type="text" value={activeTest.instanceName || ''} onChange={e=>updateActiveTest({instanceName: e.target.value})} className="bg-slate-50 border border-slate-200 text-xs px-3 py-1.5 rounded-lg outline-none focus:border-blue-500 w-full md:w-32" placeholder="e.g. 24h / Rep 1"/>
                                            </div>
                                            <div className="flex flex-col flex-1 md:flex-none">
                                                <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Date</label>
                                                <input type="date" value={activeTest.date} onChange={e=>updateActiveTest({date: e.target.value})} className="bg-slate-50 border border-slate-200 text-xs px-3 py-1.5 rounded-lg outline-none focus:border-blue-500 w-full"/>
                                            </div>
                                        </div>
                                    </div>
                                    {siblingTests.length > 0 && (
                                        <div className="bg-blue-50 border-b border-blue-200 px-6 py-2 flex items-center overflow-x-auto gap-2 shadow-inner">
                                            <span className="text-[10px] font-bold text-blue-800 uppercase tracking-wide mr-2">⏱️ Instances:</span>
                                            {siblingTests.map((t, idx) => (
                                                <button key={t.id} onClick={() => setActiveTestId(t.id)} className={`px-3 py-1 text-xs font-bold rounded-full transition-colors flex items-center gap-1.5 shadow-sm group ${activeTestId === t.id ? 'bg-blue-600 text-white' : 'bg-white text-blue-700 border border-blue-300 hover:bg-blue-100'}`}>
                                                    📅 {t.instanceName || t.date || `Inst ${idx+1}`}
                                                    {siblingTests.length > 1 && (
                                                        <span onClick={(e) => {
                                                            e.stopPropagation();
                                                            if(confirm(`Delete instance ${t.instanceName || t.date}?`)) {
                                                                setTests(prev => {
                                                                    const next = prev.filter(test => test.id !== t.id);
                                                                    if (activeTestId === t.id) setActiveTestId(next.find(x => x.name === t.name)?.id || next[0]?.id);
                                                                    return next;
                                                                });
                                                            }
                                                        }} className={`ml-1 opacity-0 group-hover:opacity-100 ${activeTestId === t.id ? 'text-blue-300 hover:text-white' : 'text-red-300 hover:text-red-500'}`}>&times;</span>
                                                    )}
                                                </button>
                                            ))}
                                            <button onClick={handleDuplicateInstance} className="px-3 py-1 text-[10px] font-bold text-blue-600 border border-dashed border-blue-400 rounded-full hover:bg-blue-100 transition-colors bg-white shadow-sm ml-2">
                                                + Add Timepoint/Copy
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );

                            if (activeTest.type === 'nmr') {
                                return <NMRTestRenderer activeTest={activeTest} updateActiveTest={updateActiveTest} TestHeader={TestHeader} datasetProtocols={datasetProtocols} jumpToProtocol={jumpToProtocol} />;
                            }
                            
                            if (activeTest.type === 'plate-9x9box') {
                                const getVal = (key, def) => expandedGroups[key] !== undefined ? expandedGroups[key] : def;
                                const setVal = (key, val) => setExpandedGroups(p => {
                                    let current = p[key];
                                    if (current === undefined) {
                                        if (key === 'boxRotation') current = 0; else if (key === 'selectedWells') current = []; else if (key === 'boxDragState') current = { active: false, startR: -1, startC: -1, currentR: -1, currentC: -1 }; else current = '';
                                    }
                                    return {...p, [key]: typeof val === 'function' ? val(current) : val};
                                });
                                const boxSearch = getVal('boxSearch', '');
                                const boxRotation = getVal('boxRotation', 0);
                                const selectedWells = getVal('selectedWells', []);
                                const boxDragState = getVal('boxDragState', { active: false, startR: -1, startC: -1, currentR: -1, currentC: -1 });
                                
                                const getWellData = (r, c) => { try { const val = activeTest.grid[r]?.[c]; if (typeof val === 'string' && val.startsWith('{')) return JSON.parse(val); } catch(e) {} return { compound: (activeTest.grid[r]?.[c] || '') + '', solvent: '', concentration: '', volume: '', date: '', weight: '', description: '' }; };
                                const updateWellData = (r, c, field, value) => { const current = getWellData(r, c); current[field] = value; const ng = activeTest.grid.map(row => [...row]); if(!ng[r]) ng[r] = []; ng[r][c] = JSON.stringify(current); updateActiveTest({ grid: ng }); };
                                const toggleWellSelection = (r, c) => { const exists = selectedWells.find(w => w.r === r && w.c === c); setVal('selectedWells', exists ? selectedWells.filter(w => !(w.r === r && w.c === c)) : [...selectedWells, {r, c}]); };

                                const printBoxLabel = () => {
                                    try {
                                        const printWin = window.open('', '_blank');
                                        if (!printWin) {
                                            alert('Popup blocked! Please allow popups for this site, then try again.');
                                            return;
                                        }
                                        const safe = (v) => (v === null || v === undefined) ? '' : String(v);
                                        const storageName = storages.find(s => s.id === activeTest.storageId)?.name || activeTest.storageLabel || 'Unassigned';
                                        const posLabel = activeTest.storageIndex !== null && activeTest.storageIndex !== undefined ? activeTest.storageIndex + 1 : 'N/A';

                                        let html = `<!DOCTYPE html><html><head><title>Label Print</title><style>
                                            @page { size: 12cm 12cm; margin: 0; }
                                            body { font-family: 'Inter', Arial, sans-serif; padding: 15px; font-size: 11px; color: #000; box-sizing: border-box; width: 12cm; height: 12cm; }
                                            h3 { margin-top: 0; margin-bottom: 10px; font-size: 14px; border-bottom: 1px solid #000; padding-bottom: 5px; }
                                            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                                            th, td { border: 1px solid #000; padding: 4px; text-align: left; font-size: 10px; }
                                            th { background-color: #f3f4f6; }
                                        </style></head><body>
                                        <h3>Storage: ${safe(storageName)} (Pos: ${posLabel})</h3>
                                        <p><strong>Box:</strong> ${safe(activeTest.name)}${activeTest.instanceName ? ' - ' + safe(activeTest.instanceName) : ''}</p>
                                        <table><tr><th>Pos</th><th>Compound</th><th>Solvent</th><th>Conc.</th><th>Vol.</th><th>Date</th><th>Wt(mg)</th><th>Notes</th></tr>`;

                                        const sortedWells = [...selectedWells].sort((a, b) => a.r === b.r ? a.c - b.c : a.r - b.r);
                                        sortedWells.forEach(({ r, c }) => {
                                            const d = getWellData(r, c);
                                            const rowLabel = (BOX_ROW_LABELS && BOX_ROW_LABELS[r]) ? BOX_ROW_LABELS[r] : String.fromCharCode(65 + r);
                                            const pos = `${rowLabel}${c + 1}`;
                                            html += `<tr><td>${pos}</td><td>${safe(d.compound)}</td><td>${safe(d.solvent)}</td><td>${safe(d.concentration)}</td><td>${safe(d.volume)}</td><td>${safe(d.date)}</td><td>${safe(d.weight)}</td><td>${safe(d.description)}</td></tr>`;
                                        });

                                        html += `</table></body></html>`;
                                        printWin.document.write(html);
                                        printWin.document.close();
                                        printWin.focus();
                                        setTimeout(() => { try { printWin.print(); } catch(e) {} }, 300);
                                    } catch (err) {
                                        alert('Print failed: ' + err.message);
                                    }
                                };

                                return (
                                    <div className="flex flex-col h-full overflow-hidden">
                                        {TestHeader}
                                        <div className="flex-1 overflow-y-auto custom-scrollbar p-6" onMouseUp={() => { if(boxDragState.active) setVal('boxDragState', { active: false, startR: -1, startC: -1 }); }}>
                                            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col mb-6">
                                                <label className="text-xs font-bold text-slate-600 mb-2">📝 Box Notes / General Comments</label>
                                                <RichTextEditor value={activeTest.comments || ''} onChange={val => updateActiveTest({comments: val})} placeholder="Aggiungi qui note generali sulla box, ubicazione, o log delle modifiche..." />
                                            </div>

                                            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap gap-4 items-center mb-6 no-print">
                                                <div className="flex items-center gap-2">
                                                    <label className="text-xs font-bold text-slate-500 uppercase">Rows:</label>
                                                    <input type="number" min="2" max="26" value={activeTest.boxRows || 9}
                                                        onChange={e => updateActiveTest({ boxRows: Math.max(2, Math.min(26, parseInt(e.target.value) || 9)) })}
                                                        className="w-16 border border-slate-300 rounded px-2 py-1 text-sm text-center outline-none focus:border-blue-500" />
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <label className="text-xs font-bold text-slate-500 uppercase">Cols:</label>
                                                    <input type="number" min="2" max="26" value={activeTest.boxCols || 9}
                                                        onChange={e => updateActiveTest({ boxCols: Math.max(2, Math.min(26, parseInt(e.target.value) || 9)) })}
                                                        className="w-16 border border-slate-300 rounded px-2 py-1 text-sm text-center outline-none focus:border-blue-500" />
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <label className="text-xs font-bold text-slate-500 uppercase">Rotate:</label>
                                                    <select value={boxRotation} onChange={e => setVal('boxRotation', parseInt(e.target.value))}
                                                        className="border border-slate-300 rounded px-2 py-1 text-sm outline-none focus:border-blue-500 bg-white">
                                                        <option value="0">0°</option>
                                                        <option value="90">90°</option>
                                                        <option value="180">180°</option>
                                                        <option value="270">270°</option>
                                                    </select>
                                                </div>
                                                <div className="flex-1 flex items-center gap-2 min-w-[200px]">
                                                    <label className="text-xs font-bold text-slate-500 uppercase">Search:</label>
                                                    <input type="text" value={boxSearch} onChange={e => setVal('boxSearch', e.target.value)} placeholder="Filter compounds..."
                                                        className="flex-1 border border-slate-300 rounded px-3 py-1 text-sm outline-none focus:border-blue-500" />
                                                </div>
                                            </div>

                                            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mb-6 overflow-x-auto text-center flex justify-center">
                                                <div className="transition-transform duration-300 ease-in-out origin-center inline-block" style={{transform: `rotate(${boxRotation}deg)`}}>
                                                    <div className="grid gap-2 max-w-min mx-auto bg-slate-50 p-6 border border-slate-300 rounded-xl shadow-inner" style={{ gridTemplateColumns: `auto repeat(${activeTest.boxCols || 9}, minmax(55px, 1fr))` }}>
                                                        <div /> 
                                                        {Array.from({length: activeTest.boxCols || 9}, (_, c) => (
                                                            <div key={c} className="text-center font-black text-slate-400 select-none flex items-center justify-center" style={{transform: `rotate(-${boxRotation}deg)`}}>{c+1}</div>
                                                        ))}
                                                        {Array.from({length: activeTest.boxRows || 9}, (_, r) => (
                                                            <React.Fragment key={r}>
                                                                <div className="flex items-center justify-center font-black text-slate-400 select-none" style={{transform: `rotate(-${boxRotation}deg)`}}>{BOX_ROW_LABELS[r]}</div>
                                                                {Array.from({length: activeTest.boxCols || 9}, (_, c) => {
                                                                    const data = getWellData(r, c);
                                                                    const hasContent = data.compound.trim().length > 0;
                                                                    const isSelected = selectedWells.some(w => w.r === r && w.c === c) || (boxDragState.active && r >= Math.min(boxDragState.startR, boxDragState.currentR) && r <= Math.max(boxDragState.startR, boxDragState.currentR) && c >= Math.min(boxDragState.startC, boxDragState.currentC) && c <= Math.max(boxDragState.startC, boxDragState.currentC));
                                                                    const isMatch = boxSearch && (String(data.compound || '').toLowerCase().includes(boxSearch.toLowerCase()) || String(data.description || '').toLowerCase().includes(boxSearch.toLowerCase()) || String(data.solvent || '').toLowerCase().includes(boxSearch.toLowerCase()) || String(data.concentration || '').toLowerCase().includes(boxSearch.toLowerCase()));
                                                                    return (
                                                                        <div key={c} 
                                                                            onMouseDown={(e) => {
                                                                                if (e.button !== 0) return;
                                                                                if (e.ctrlKey || e.metaKey || e.shiftKey) { toggleWellSelection(r, c); } 
                                                                                else { setVal('boxDragState', { active: true, startR: r, startC: c, currentR: r, currentC: c }); setVal('selectedWells', [{r, c}]); }
                                                                            }}
                                                                            onMouseEnter={() => {
                                                                                if (boxDragState.active) {
                                                                                    setVal('boxDragState', prev => ({...prev, currentR: r, currentC: c}));
                                                                                    const minR = Math.min(boxDragState.startR, r); const maxR = Math.max(boxDragState.startR, r); const minC = Math.min(boxDragState.startC, c); const maxC = Math.max(boxDragState.startC, c);
                                                                                    const newSel = []; for (let ir = minR; ir <= maxR; ir++) { for (let ic = minC; ic <= maxC; ic++) { newSel.push({r: ir, c: ic}); } }
                                                                                    setVal('selectedWells', newSel);
                                                                                }
                                                                            }}
                                                                            className={`aspect-square w-12 h-12 min-w-[48px] min-h-[48px] shrink-0 rounded-full border-[3px] cursor-pointer flex flex-col items-center justify-center text-xs overflow-hidden shadow-sm transition-all hover:scale-110 ${isSelected ? 'ring-4 ring-blue-500 border-blue-600 bg-blue-50' : isMatch ? 'bg-yellow-100 border-yellow-400 shadow-yellow-400/50 shadow-lg' : hasContent ? 'bg-indigo-50 border-indigo-300 text-indigo-900' : 'bg-white border-slate-200 text-slate-300 hover:border-slate-300'}`}
                                                                            title={data.compound || 'Empty Slot'}>
                                                                            <div style={{transform: `rotate(-${boxRotation}deg)`}} className="w-full flex items-center justify-center h-full pointer-events-none">
                                                                                {hasContent ? ( <span className="font-bold text-[9px] leading-tight px-1 text-center line-clamp-2 truncate w-full" title={data.compound}>{data.compound}</span> ) : ( <span className="opacity-0 hover:opacity-100 text-[10px] font-bold text-slate-400">+</span> )}
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </React.Fragment>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 no-print">
                                                <div className="flex justify-between items-center mb-6 border-b border-slate-100 pb-2">
                                                    <div>
                                                        <h4 className="text-lg font-black text-slate-800">Selected Slots ({selectedWells.length})</h4>
                                                        <p className="text-xs text-slate-500">Drag over the grid to select multiple, then edit bulk data below.</p>
                                                    </div>
                                                    <div className="flex gap-3">
                                                        <button onClick={() => setVal('selectedWells', [])} disabled={selectedWells.length === 0} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 font-bold border border-slate-300 rounded-lg disabled:opacity-50 transition-colors shadow-sm">Clear Selection</button>
                                                        <button onClick={printBoxLabel} disabled={selectedWells.length === 0} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-sm disabled:opacity-50 flex items-center gap-2 transition-colors">🖨️ Print Label</button>
                                                    </div>
                                                </div>
                                                {selectedWells.length === 0 ? (
                                                    <div className="bg-slate-50 border border-dashed border-slate-300 rounded-xl p-10 text-center text-slate-400 font-bold">No slots selected. Interact with the grid above to start editing content.</div>
                                                ) : (
                                                    <div className="flex flex-col gap-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                                                        {selectedWells.sort((a,b) => a.r === b.r ? a.c - b.c : a.r - b.r).map(({r, c}) => {
                                                            const d = getWellData(r, c);
                                                            return (
                                                                <div key={`${r}-${c}`} className="flex gap-3 items-center bg-slate-50 p-3 border border-slate-200 rounded-lg shadow-sm hover:border-blue-300 transition-colors flex-wrap">
                                                                    <div className="bg-blue-100 text-blue-800 font-black rounded-md w-12 h-10 flex items-center justify-center shrink-0 border border-blue-200 shadow-sm text-sm">{BOX_ROW_LABELS[r]}{c+1}</div>
                                                                    <input list="box-cmpd-list" value={d.compound} onChange={e => updateWellData(r, c, 'compound', e.target.value)} placeholder="Compound Name" className="border border-slate-300 rounded-md px-3 py-2 text-sm w-44 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-bold text-slate-700"/>
                                                                    <input type="text" value={d.solvent} onChange={e => updateWellData(r, c, 'solvent', e.target.value)} placeholder="Solvent" className="border border-slate-300 rounded-md px-3 py-2 text-sm w-24 outline-none focus:border-blue-500"/>
                                                                    <input type="text" value={d.concentration} onChange={e => updateWellData(r, c, 'concentration', e.target.value)} placeholder="Conc" className="border border-slate-300 rounded-md px-3 py-2 text-sm w-24 outline-none focus:border-blue-500"/>
                                                                    <input type="text" value={d.volume} onChange={e => updateWellData(r, c, 'volume', e.target.value)} placeholder="Vol" className="border border-slate-300 rounded-md px-3 py-2 text-sm w-24 outline-none focus:border-blue-500"/>
                                                                    <input type="date" value={d.date} onChange={e => updateWellData(r, c, 'date', e.target.value)} className="border border-slate-300 rounded-md px-3 py-2 text-sm w-36 outline-none focus:border-blue-500 text-slate-600"/>
                                                                    <input type="number" value={d.weight} onChange={e => updateWellData(r, c, 'weight', e.target.value)} placeholder="mg" className="border border-slate-300 rounded-md px-3 py-2 text-sm w-24 outline-none focus:border-blue-500"/>
                                                                    <input type="text" value={d.description} onChange={e => updateWellData(r, c, 'description', e.target.value)} placeholder="Notes..." className="border border-slate-300 rounded-md px-3 py-2 text-sm flex-1 min-w-[150px] outline-none focus:border-blue-500"/>
                                                                    <button onClick={() => toggleWellSelection(r, c)} className="text-slate-300 hover:text-red-500 hover:bg-red-50 px-2 py-1 rounded ml-auto text-lg shrink-0 font-bold transition-colors" title="Deselect">&times;</button>
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                )}
                                                <datalist id="box-cmpd-list">{[...new Set([...customCmpds, ...DEF_COMPOUNDS])].map(c => <option key={c} value={c}/>)}</datalist>
                                            </div>
                                        </div>
                                    </div>
                                );
                            }

                            if (activeTest.type.startsWith('plate-') && activeTest.type !== 'plate-9x9box') {
                                return (
                                    <PlateTestRenderer 
                                        activeTest={activeTest} updateActiveTest={updateActiveTest} 
                                        appClipboard={appClipboard} setAppClipboard={setAppClipboard}
                                        customCmpds={customCmpds} setCustomCmpds={setCustomCmpds}
                                        customConc={customConc} setCustomConc={setCustomConc}
                                        cmpColors={cmpColors} setCmpColors={setCmpColors}
                                        allCmpds={[...new Set([...DEF_COMPOUNDS, ...customCmpds])]}
                                        jumpToTest={(id) => { setActiveTestId(id); setCurrentModule('active-test'); }} TestHeader={TestHeader}
                                        datasetProtocols={datasetProtocols} jumpToProtocol={jumpToProtocol}
                                    />
                                );
                            }
                        })()}

                        {currentModule === 'notebook' && (() => {
                            const getVal = (key, def) => expandedGroups[key] !== undefined ? expandedGroups[key] : def;
                            const notebookSearch = getVal('notebookSearch', '');
                            const filteredTests = tests.filter(t => {
                                if(!notebookSearch) return true;
                                const query = notebookSearch.toLowerCase();
                                return JSON.stringify(t).toLowerCase().includes(query);
                            });
                            
                            return (
                                <div className="flex flex-col h-full w-full">
                                    <div className="bg-white p-4 border-b border-slate-200 shadow-sm flex items-center justify-between no-print shrink-0">
                                        <div className="flex-1 max-w-md relative">
                                            <span className="absolute left-3 top-2.5 text-slate-400">🔍</span>
                                            <input type="text" placeholder="Ricerca generica nei dati dei test..." value={notebookSearch} onChange={e => setExpandedGroups(p => ({...p, notebookSearch: e.target.value}))} className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500"/>
                                        </div>
                                        <button onClick={handlePrint} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center gap-2 shadow-sm">
                                            🖨️ Stampa / Salva PDF (App)
                                        </button>
                                    </div>
                                    <div className="flex-1 overflow-hidden relative">
                                        <LabNotebook tests={filteredTests} allCellLines={[...new Set([...DEF_CELL_LINES, ...customCellLines])]} testCategories={testCategories} jumpToTest={(id) => { setActiveTestId(id); setCurrentModule('active-test'); }} customConc={customConc} cmpColors={cmpColors} allCmpds={[...new Set([...DEF_COMPOUNDS, ...customCmpds])]} />
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
