import React from 'react';
import { getDirectImageUrl, BOX_ROW_LABELS, DEF_COMPOUNDS } from '../data/constants';
import { RichTextEditor } from './RichTextEditor';

// Helper to bypass Google Drive CORS blocks
const getProxiedImage = (url) => {
    if (!url) return '';
    const directUrl = getDirectImageUrl(url);
    if (directUrl.includes('drive.google.com')) {
        return `https://wsrv.nl/?url=${encodeURIComponent(directUrl)}`;
    }
    return directUrl;
};

// --- MODALS FOR STORAGE & BOX MOVEMENT ---
export const StorageModals = ({ storageModal, setStorageModal, storages, setStorages, moveModal, setMoveModal, tests, setTests }) => {
    const saveStorage = (e) => {
        e.preventDefault(); 
        const formData = new FormData(e.target);
        const newStorage = { 
            id: storageModal.id || 'st_' + Date.now(), 
            name: formData.get('name'), 
            type: formData.get('type'), 
            rows: parseInt(formData.get('rows')) || 5, 
            cols: parseInt(formData.get('cols')) || 4, 
            imageUrl: formData.get('imageUrl') || '' 
        };
        if (storageModal.id) { 
            setStorages(prev => prev.map(s => s.id === storageModal.id ? newStorage : s)); 
        } else { 
            setStorages(prev => [...prev, newStorage]); 
        }
        setStorageModal(null);
    };

    const handleMoveBox = (boxId, targetStorageId, targetSlotIndex) => {
        setTests(prev => prev.map(t => {
            if (t.id === boxId) return { ...t, storageId: targetStorageId, storageIndex: targetSlotIndex };
            return t;
        }));
        setMoveModal(null);
    };

    return (
        <>
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
                                    <option value="Freezer">Freezer</option>
                                    <option value="Refrigerator">Refrigerator</option>
                                    <option value="Closet">Closet</option>
                                </select>
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-bold text-slate-500 uppercase">Image URL (Optional)</label>
                                <input name="imageUrl" defaultValue={storageModal.imageUrl} className="border border-slate-300 rounded p-2 text-sm focus:border-blue-500 outline-none" placeholder="https://..."/>
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
        </>
    );
};

// --- STORAGE OVERVIEW LIST ---
export const StorageList = ({ storages, tests, setStorageModal, setActiveStorageId, setCurrentModule, handlePrint }) => {
    return (
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
                                    <div className="h-40 w-full overflow-hidden border-b border-slate-100 relative bg-slate-100">
                                        <img src={getProxiedImage(st.imageUrl)} alt={st.name} referrerPolicy="no-referrer" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"/>
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
    );
};

// --- STORAGE DETAIL VIEW ---
export const StorageDetail = ({ storages, activeStorageId, tests, setTests, setCurrentModule, handlePrint, jumpToTest, setMoveModal, createEmptyTest, setActiveTestId }) => {
    const st = storages.find(s => s.id === activeStorageId);
    if (!st) return <div className="p-6">Storage not found.</div>;
    
    const boxesInStorage = tests.filter(t => t.type === 'plate-9x9box' && t.storageId === st.id);
    
    const handleAddBox = (slotIndex) => {
        const id = 't' + Date.now();
        const newBox = createEmptyTest(id, tests.length + 1, 'plate-9x9box');
        newBox.storageId = st.id;
        if(slotIndex !== undefined) newBox.storageIndex = slotIndex;
        setTests(prev => [...prev, newBox]);
        setActiveTestId(id); 
        setCurrentModule('active-test');
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
                        <div className="flex-1 rounded-lg overflow-hidden border border-slate-100 bg-slate-100">
                            <img src={getProxiedImage(st.imageUrl)} alt={st.name} referrerPolicy="no-referrer" className="w-full h-full object-cover"/>
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
};

// --- BOX DETAIL VIEW ---
export const BoxDetail = ({ activeTest, updateActiveTest, storages, expandedGroups, setExpandedGroups, customCmpds, jumpToTest, setMoveModal, TestHeader, operators = [] }) => {
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
    
const getWellData = (r, c) => {
  const raw = activeTest?.grid?.[r]?.[c];

  const defaults = {
    compound: typeof raw === 'string' && !raw.startsWith('{') ? raw : '',
    operator: '',
    sampleOwner: '',
    solvent: '',
    concentration: '',
    concUnit: 'µM',
    volume: '',
    volUnit: 'µL',
    date: '',
    weight: '',
    weightUnit: 'mg',
    description: ''
  };

  try {
    if (typeof raw === 'string' && raw.startsWith('{')) {
      const parsed = JSON.parse(raw);

      return {
        ...defaults,
        ...parsed,
        sampleOwner: parsed.sampleOwner || parsed.operator || ''
      };
    }
  } catch (e) {}

  return defaults;
};

  const updateWellData = (r, c, field, value) => {
  const current = getWellData(r, c);
  current[field] = value;

  const ng = (activeTest.grid || []).map((row) => [...row]);

  if (!ng[r]) ng[r] = [];

  ng[r][c] = JSON.stringify(current);

  updateActiveTest({ grid: ng });
};

const updateWellOwner = (r, c, value) => {
  const current = getWellData(r, c);

  current.sampleOwner = value;

  // Keep the old operator field synchronized only for backward compatibility.
  current.operator = value;

  const ng = (activeTest.grid || []).map((row) => [...row]);

  if (!ng[r]) ng[r] = [];

  ng[r][c] = JSON.stringify(current);

  updateActiveTest({ grid: ng });
};

    const toggleWellSelection = (r, c) => { 
        const exists = selectedWells.find(w => w.r === r && w.c === c); 
        setVal('selectedWells', exists ? selectedWells.filter(w => !(w.r === r && w.c === c)) : [...selectedWells, {r, c}]); 
    };

    const printBoxLabel = () => {
        try {
            const printWin = window.open('', '_blank');
            if (!printWin) { alert('Popup blocked!'); return; }
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
            <table><tr><th>Pos</th><th>Compound</th><th>Operator</th><th>Solvent</th><th>Conc.</th><th>Vol.</th><th>Date</th><th>Weight</th><th>Notes</th></tr>`;
            const sortedWells = [...selectedWells].sort((a, b) => a.r === b.r ? a.c - b.c : a.r - b.r);
            sortedWells.forEach(({ r, c }) => {
                const d = getWellData(r, c);
                const rowLabel = (BOX_ROW_LABELS && BOX_ROW_LABELS[r]) ? BOX_ROW_LABELS[r] : String.fromCharCode(65 + r);
                const pos = `${rowLabel}${c + 1}`;
                html += `<tr><td>${pos}</td><td>${safe(d.compound)}</td><td>${safe(d.operator)}</td><td>${safe(d.solvent)}</td><td>${safe(d.concentration)} ${safe(d.concUnit || 'µM')}</td><td>${safe(d.volume)} ${safe(d.volUnit || 'µL')}</td><td>${safe(d.date)}</td><td>${safe(d.weight)} ${safe(d.weightUnit || 'mg')}</td><td>${safe(d.description)}</td></tr>`;
            });
            html += `</table></body></html>`;
            printWin.document.write(html);
            printWin.document.close();
            printWin.focus();
            setTimeout(() => { try { printWin.print(); } catch(e) {} }, 300);
        } catch (err) { alert('Print failed: ' + err.message); }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {TestHeader}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6" onMouseUp={() => { if(boxDragState.active) setVal('boxDragState', { active: false, startR: -1, startC: -1 }); }}>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col mb-6">
                    <label className="text-xs font-bold text-slate-600 mb-2">📝 General Box Notes</label>
                    <RichTextEditor value={activeTest.comments || ''} onChange={val => updateActiveTest({comments: val})} placeholder="Add general box notes here..." />
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
                            <option value="0">0°</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option>
                        </select>
                    </div>
                    <div className="flex-1 flex items-center gap-2 min-w-[200px]">
                        <label className="text-xs font-bold text-slate-500 uppercase">Search:</label>
                        <input type="text" value={boxSearch} onChange={e => setVal('boxSearch', e.target.value)} placeholder="Filter compounds or operators..."
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
                                        const isMatch = boxSearch && (String(data.compound || '').toLowerCase().includes(boxSearch.toLowerCase()) || String(data.operator || '').toLowerCase().includes(boxSearch.toLowerCase()) || String(data.description || '').toLowerCase().includes(boxSearch.toLowerCase()) || String(data.solvent || '').toLowerCase().includes(boxSearch.toLowerCase()) || String(data.concentration || '').toLowerCase().includes(boxSearch.toLowerCase()));
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
                                                title={data.compound ? `${data.compound}${data.operator ? ` (${data.operator})` : ''}` : 'Empty Slot'}>
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
                        <div className="bg-slate-50 border border-dashed border-slate-300 rounded-xl p-10 text-center text-slate-400 font-bold">No slots selected.</div>
                    ) : (
                        <div className="flex flex-col gap-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                            {[...selectedWells].sort((a,b) => a.r === b.r ? a.c - b.c : a.r - b.r).map(({r, c}) => {
                                const d = getWellData(r, c);
                                return (
                                    <div key={`${r}-${c}`} className="flex gap-3 items-center bg-slate-50 p-3 border border-slate-200 rounded-lg shadow-sm hover:border-blue-300 transition-colors flex-wrap">
                                        <div className="bg-blue-100 text-blue-800 font-black rounded-md w-12 h-10 flex items-center justify-center shrink-0 border border-blue-200 shadow-sm text-sm">{BOX_ROW_LABELS[r]}{c+1}</div>
                                        <input list="box-cmpd-list" value={d.compound} onChange={e => updateWellData(r, c, 'compound', e.target.value)} placeholder="Compound Name" className="border border-slate-300 rounded-md px-3 py-2 text-sm w-44 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-bold text-slate-700"/>
                                        
                                        <select
  value={d.sampleOwner || d.operator || ''}
  onChange={(e) => updateWellOwner(r, c, e.target.value)}
  className="border border-slate-300 rounded-md px-2 py-2 text-sm w-32 outline-none focus:border-blue-500 text-slate-600 font-medium bg-white"
>
  <option value="">Sample Owner...</option>
  {operators.map((op) => (
    <option key={op} value={op}>
      {op}
    </option>
  ))}
</select>

                                        <input type="text" value={d.solvent} onChange={e => updateWellData(r, c, 'solvent', e.target.value)} placeholder="Solvent" className="border border-slate-300 rounded-md px-3 py-2 text-sm w-24 outline-none focus:border-blue-500"/>
                                        
                                        <div className="flex items-center">
                                            <input type="text" value={d.concentration} onChange={e => updateWellData(r, c, 'concentration', e.target.value)} placeholder="Conc" className="border border-slate-300 rounded-l-md px-3 py-2 text-sm w-16 outline-none focus:border-blue-500 border-r-0"/>
                                            <select value={d.concUnit || 'µM'} onChange={e => updateWellData(r, c, 'concUnit', e.target.value)} className="border border-slate-300 rounded-r-md px-1 py-2 text-xs outline-none focus:border-blue-500 bg-slate-100 text-slate-700 font-semibold cursor-pointer">
                                                <option value="µM">µM</option><option value="mM">mM</option><option value="M">M</option><option value="ng/mL">ng/mL</option><option value="µg/mL">µg/mL</option><option value="mg/mL">mg/mL</option>
                                            </select>
                                        </div>

                                        <div className="flex items-center">
                                            <input type="text" value={d.volume} onChange={e => updateWellData(r, c, 'volume', e.target.value)} placeholder="Vol" className="border border-slate-300 rounded-l-md px-3 py-2 text-sm w-16 outline-none focus:border-blue-500 border-r-0"/>
                                            <select value={d.volUnit || 'µL'} onChange={e => updateWellData(r, c, 'volUnit', e.target.value)} className="border border-slate-300 rounded-r-md px-1 py-2 text-xs outline-none focus:border-blue-500 bg-slate-100 text-slate-700 font-semibold cursor-pointer">
                                                <option value="nL">nL</option><option value="µL">µL</option><option value="mL">mL</option><option value="L">L</option>
                                            </select>
                                        </div>

                                        <input type="date" value={d.date} onChange={e => updateWellData(r, c, 'date', e.target.value)} className="border border-slate-300 rounded-md px-3 py-2 text-sm w-36 outline-none focus:border-blue-500 text-slate-600"/>
                                        
                                        <div className="flex items-center">
                                            <input type="number" value={d.weight} onChange={e => updateWellData(r, c, 'weight', e.target.value)} placeholder="Wt" className="border border-slate-300 rounded-l-md px-3 py-2 text-sm w-20 outline-none focus:border-blue-500 border-r-0"/>
                                            <select value={d.weightUnit || 'mg'} onChange={e => updateWellData(r, c, 'weightUnit', e.target.value)} className="border border-slate-300 rounded-r-md px-1 py-2 text-xs outline-none focus:border-blue-500 bg-slate-100 text-slate-700 font-semibold cursor-pointer">
                                                <option value="µg">µg</option><option value="mg">mg</option><option value="g">g</option>
                                            </select>
                                        </div>

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
};
