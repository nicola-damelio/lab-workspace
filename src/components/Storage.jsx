import React, { useEffect, useRef, useState } from 'react';
import { getDirectImageUrl, BOX_ROW_LABELS, DEF_COMPOUNDS } from '../data/constants';
import { RichTextEditor } from './RichTextEditor';
import { Icon } from './Icons';
import { markAttachmentsDeleted } from '../utils/driveUpload';
import { DriveUploadButton } from './DriveUpload';
import { sanitizeSlug, storageBoxImagesFolderPath, storageFileCtx, storageImagesFolderPath } from '../utils/driveNaming';
import { boxLabelDate, boxLabelOwner, boxLabelRows, boxLabelSignature, buildBoxLabelHtml, filledWells, labelWellsFor, wellIsFilled, wellPositionLabel } from '../utils/boxLabel';
/* Les règles des BOÎTES (plusieurs boîtes par emplacement, boîte 1 × 1 =
   échantillon en vrac, champs obligatoires, suppression d'un meuble) vivent
   dans src/utils/storageBoxes.js — testables sans écran. */
import {
    BOX_SIZE_PRESETS, assignBoxesToStorage, boxListLabel, boxSizeLabel, boxesInSlot,
    boxesNeedingSlot, boxesOfStorage, boxesWithoutStorage,
    describeBoxIssues, moveBoxToSlot, nextSlotIndex, presetById, presetIdOfBox,
    removeStorage, repairBoxPlacements, requiredBoxIssues, slotIndexOf, slotStackLabel,
    storageCols, storageCompleteness, storageOccupancy, storageRows, storageSlotCount,
    wellMissingRequired
} from '../utils/storageBoxes';
import { renameStorageDriveFolder, tidyStorageFiles } from '../utils/storageDrive';
import { BoxLabelFile } from './BoxLabelFile';

// Helper to bypass Google Drive CORS blocks
const getProxiedImage = (url) => {
    if (!url) return '';
    const directUrl = getDirectImageUrl(url);
    if (directUrl.includes('drive.google.com')) {
        return `https://wsrv.nl/?url=${encodeURIComponent(directUrl)}`;
    }
    return directUrl;
};

// Le fichier garde SON nom (file1.jpg, file2.jpg) : seule sa PLACE sur le Drive
// (le dossier) est imposée par l'application. Un fichier sans nom retombe sur le
// nom suggéré (Box_photo, Storage_image…).
const originalBaseName = (file, fallback = 'file') => {
    const raw = String((file && file.name) || '').trim();
    return sanitizeSlug(raw.replace(/\.[^/.]+$/, '')) || fallback;
};

// One photo slot for a box: preview + upload-from-PC (saved to Drive) + remove.
// Used twice per box — "Box Photo" (external, to locate it) and "Inside Photo"
// (to see its contents). Both live under
// storage/<storage>/boxes/<box>/images/ and keep the name of the file they came
// from. The preview is clickable to open a full-screen zoom.
const BoxPhotoSlot = ({ url, label, hint, storageName, boxName, kind, onSet, onClear }) => {
    const [zoom, setZoom] = useState(false);
    const fallback = sanitizeSlug(`${boxName || 'box'}_${kind || 'photo'}`) || 'box_photo';
    return (
        <>
            <div className="flex items-center gap-3">
                {url ? (
                    <img src={getProxiedImage(url)} alt={label} referrerPolicy="no-referrer"
                         onClick={() => setZoom(true)}
                         className="w-40 h-40 object-cover rounded-xl border border-slate-200 shadow-sm cursor-zoom-in"/>
                ) : (
                    <div className="w-40 h-40 rounded-xl border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center text-[10px] text-slate-400 px-1 text-center">{hint}</div>
                )}
                <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase">{label}</label>
                    <DriveUploadButton
                        label={url ? '⬆ Replace' : '⬆ Upload'}
                        accept="image/*"
                        suggestedName={fallback}
                        nameFor={(file) => originalBaseName(file, fallback)}
                        path={storageBoxImagesFolderPath(storageName, boxName || 'box')}
                        naming={storageFileCtx({ storage: storageName, box: boxName || 'box', title: fallback })}
                        onDone={({ dataUrl, drive }) => onSet(drive ? drive.driveUrl : dataUrl)}
                    />
                    {url && (
                        <button type="button" onClick={() => setZoom(true)}
                                className="text-[10px] font-bold text-blue-600 hover:text-blue-800 underline self-start">
                            🔍 Zoom
                        </button>
                    )}
                    {url && (
                        <button type="button" onClick={onClear}
                                className="text-xs font-bold text-red-500 hover:text-red-700 underline self-start">
                            Remove
                        </button>
                    )}
                </div>
            </div>
            {zoom && url && (
                <div className="fixed inset-0 bg-slate-900/85 z-[999999] flex items-center justify-center p-6 cursor-zoom-out"
                     onClick={() => setZoom(false)}>
                    <img src={getProxiedImage(url)} alt={label} referrerPolicy="no-referrer"
                         className="max-w-full max-h-full object-contain rounded-lg shadow-2xl bg-white p-1"/>
                    <button type="button"
                            onClick={() => setZoom(false)}
                            className="absolute top-3 right-3 text-white text-2xl font-black w-10 h-10 bg-slate-700/80 hover:bg-slate-600 rounded-full"
                            title="Close">×</button>
                </div>
            )}
        </>
    );
};

// --- MODALS FOR STORAGE & BOX MOVEMENT ---
export const StorageModals = ({ storageModal, setStorageModal, storages, setStorages, moveModal, setMoveModal, tests, setTests, deleteStorageModal, setDeleteStorageModal }) => {
    const saveStorage = (e) => {
        e.preventDefault(); 
        const formData = new FormData(e.target);
        // Le NOM du storage est aussi le nom de son dossier sur le Drive : le
        // renommage doit renommer le dossier (voir utils/storageDrive.js).
        const previousName = storageModal.id ? (storages.find(s => s.id === storageModal.id)?.name || '') : '';
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
        /* RÉDUIRE la grille d'un meuble ne doit jamais rendre une boîte
           invisible : celles qui tombent hors des nouvelles cases reprennent la
           première place libre (utils/storageBoxes.js). */
        const nextStorages = storages.some(s => s.id === newStorage.id)
            ? storages.map(s => (s.id === newStorage.id ? newStorage : s))
            : [...storages, newStorage];
        setTests(prev => repairBoxPlacements(prev, nextStorages).tests);
        if (previousName && newStorage.name && previousName !== newStorage.name) {
            renameStorageDriveFolder({ oldName: previousName, newName: newStorage.name }).catch(() => {});
        }
        setStorageModal(null);
    };

    /* Un emplacement DÉJÀ occupé est accepté : c'est l'empilement (la boîte
       suivante se range derrière la première — utils/storageBoxes.js). */
    const handleMoveBox = (boxId, targetStorageId, targetSlotIndex) => {
        setTests(prev => moveBoxToSlot(prev, boxId, targetStorageId, targetSlotIndex));
        setMoveModal(null);
    };

    /* ── Supprimer un EMPLACEMENT ─────────────────────────────────────────────
       Un meuble n'emporte JAMAIS ses boîtes — et une boîte ne reste JAMAIS sans
       meuble : les boîtes partent donc vers un AUTRE meuble choisi par
       l'utilisateur (une par emplacement libre d'abord, empilées ensuite). La
       suppression est refusée quand il ne reste aucun meuble d'accueil. Le
       dossier Drive du meuble (photos des boîtes, étiquettes) n'est pas touché —
       seule sa fiche disparaît, et les boîtes restent des boîtes. */
    const performDeleteStorage = () => {
        if (!deleteStorageModal) return;
        const st = storages.find(s => s.id === deleteStorageModal.storageId);
        if (!st) { setDeleteStorageModal(null); return; }
        const inside = boxesOfStorage(tests, st.id);
        const target = storages.find(s => s.id === deleteStorageModal.targetStorageId);
        if (inside.length > 0) {
            /* Sans autre meuble à portée, on ne supprime pas : une boîte ne
               peut pas devenir « sans meuble ». */
            if (!target || target.id === st.id) return;
            setTests(prev => assignBoxesToStorage(prev, st.id, target.id, storageSlotCount(target)));
        }
        setStorages(prev => removeStorage(prev, st.id));
        setDeleteStorageModal(null);
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
                const boxesInTarget = boxesOfStorage(tests, targetSt.id).filter(t => t.id !== box.id);
                return (
                    <div className="fixed inset-0 bg-slate-900/50 z-[999999] flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setMoveModal(null)}>
                        <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col border border-slate-200" onClick={e => e.stopPropagation()}>
                            <div className="p-5 border-b border-slate-200 flex justify-between items-center shrink-0">
                                <div>
                                    <h3 className="text-lg font-bold text-slate-800">Move Box</h3>
                                    <p className="text-sm text-slate-500">Moving: <span className="font-semibold text-indigo-600">{box.name}</span> ({box.date})</p>
                                </div>
                                <button onClick={() => setMoveModal(null)} className="text-slate-400 hover:text-slate-600 text-2xl">&times;</button>
                            </div>
                            <div className="p-5 flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-4 min-h-0">
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
                                    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${storageCols(targetSt)}, minmax(60px, 1fr))` }}>
                                        {Array.from({ length: storageSlotCount(targetSt) }).map((_, i) => {
                                            const slotBoxes = boxesInTarget.filter(b => slotIndexOf(b) === i);
                                            return (
                                                <div key={i} onClick={() => handleMoveBox(box.id, targetSt.id, i)}
                                                    className={`relative aspect-square border-2 rounded-lg flex flex-col items-center justify-center cursor-pointer transition-all p-1 text-center
                                                    ${slotBoxes.length > 0 ? 'bg-orange-50 border-orange-300 hover:bg-orange-100' : 'bg-green-50 border-green-300 hover:bg-green-100'}`}>
                                                    <span className="absolute top-0.5 left-1 text-[8px] font-bold text-slate-400">{i + 1}</span>
                                                    {slotBoxes.length > 0 ? (
                                                        <>
                                                            <span className="text-indigo-500"><Icon name="box" size={20} /></span>
                                                            <span className="text-[8px] font-bold text-orange-800 truncate w-full">{slotBoxes[0].name || 'unnamed'}</span>
                                                            {slotBoxes.length > 1 && <span className="text-[8px] bg-orange-200 px-1 rounded" title={`${slotBoxes.length} boxes already in this slot — the moved box is stacked behind them`}>+{slotBoxes.length - 1}</span>}
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
            {deleteStorageModal && (() => {
                const st = storages.find(s => s.id === deleteStorageModal.storageId);
                if (!st) return null;
                const inside = boxesOfStorage(tests, st.id);
                const others = storages.filter(s => s.id !== st.id);
                const target = others.find(s => s.id === deleteStorageModal.targetStorageId) || null;
                const loose = inside.filter(b => presetIdOfBox(b) === 'bulk1').length;
                const label = (n, one, many) => `${n} ${n === 1 ? one : many}`;
                return (
                    <div className="fixed inset-0 bg-slate-900/50 z-[999999] flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setDeleteStorageModal(null)}>
                        <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col border border-slate-200" onClick={e => e.stopPropagation()}>
                            <div className="p-5 border-b border-slate-200 flex justify-between items-start shrink-0">
                                <div>
                                    <h3 className="text-lg font-bold text-slate-800">Delete storage</h3>
                                    <p className="text-sm text-slate-500">{st.name} ({st.type}) · {storageRows(st)} × {storageCols(st)} slots</p>
                                </div>
                                <button onClick={() => setDeleteStorageModal(null)} className="text-slate-400 hover:text-slate-600 text-2xl">&times;</button>
                            </div>
                            <div className="p-5 flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-4 min-h-0">
                                {inside.length === 0 ? (
                                    <p className="text-sm text-slate-600">This storage holds <strong>no box</strong>. Deleting it only removes the empty furniture.</p>
                                ) : (
                                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900">
                                        <p className="font-bold">⚠ {label(inside.length, 'box lives', 'boxes live')} inside this storage{loose > 0 ? ` — ${label(loose, 'is a 1 × 1 bulk sample', 'are 1 × 1 bulk samples')}` : ''}.</p>
                                        <p className="mt-1">Deleting a storage <strong>never deletes a box</strong>, and a box never stays without a storage: choose where {inside.length === 1 ? 'it goes' : 'they go'} — another storage.</p>
                                        <ul className="mt-2 text-xs list-disc list-inside">
                                            {inside.slice(0, 5).map(b => (
                                                <li key={b.id}>{boxListLabel(b)}{b.boxOwner ? ` · ${b.boxOwner}` : ''} · {boxSizeLabel(b)}</li>
                                            ))}
                                            {inside.length > 5 && <li>…and {inside.length - 5} more</li>}
                                        </ul>
                                    </div>
                                )}
                                {inside.length > 0 && others.length > 0 && (
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Move the boxes to</label>
                                        <select
                                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-blue-500 outline-none bg-white"
                                            value={deleteStorageModal.targetStorageId || ''}
                                            onChange={(e) => setDeleteStorageModal(prev => ({ ...prev, targetStorageId: e.target.value }))}>
                                            <option value="">— choose a storage —</option>
                                            {others.map(s => (
                                                <option key={s.id} value={s.id}>{s.name} ({storageOccupancy(s, tests).free} free of {storageSlotCount(s)} slots)</option>
                                            ))}
                                        </select>
                                        {target && (
                                            <p className="text-xs text-slate-500 mt-2">They are placed one per free slot of “{target.name}”; any box beyond that is <strong>stacked</strong> in a slot — nothing is lost.</p>
                                        )}
                                    </div>
                                )}
                                {inside.length > 0 && others.length === 0 && (
                                    <p className="text-xs font-bold text-red-600 bg-red-50 border border-red-100 rounded p-2">
                                        This is the only storage and it still holds {label(inside.length, 'box', 'boxes')}: a box cannot be left without a storage, so the storage cannot be deleted yet. Create another storage first.
                                    </p>
                                )}
                                <p className="text-xs text-slate-500">The Drive folder <code>storage/&lt;storage name&gt;/</code> (box photos, labels) is <strong>not</strong> deleted: those files stay on the Drive.</p>
                            </div>
                            <div className="p-4 border-t border-slate-100 flex flex-wrap justify-end gap-2 shrink-0">
                                <button type="button" onClick={() => setDeleteStorageModal(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded">Cancel</button>
                                {inside.length > 0 ? (
                                    <button type="button" onClick={() => performDeleteStorage()} disabled={!target}
                                        title={target ? `Move the ${label(inside.length, 'box', 'boxes')} to ${target.name}, then delete this storage` : 'Create another storage first: a box never stays without a storage'}
                                        className="px-4 py-2 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded shadow-sm disabled:opacity-40 disabled:cursor-not-allowed">
                                        ↔ Move {label(inside.length, 'box', 'boxes')}{target ? ` to ${target.name}` : ''}, then delete
                                    </button>
                                ) : (
                                    <button type="button" onClick={() => performDeleteStorage()} className="px-4 py-2 text-sm font-bold bg-red-600 hover:bg-red-700 text-white rounded shadow-sm">
                                        🗑 Delete storage
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}
        </>
    );
};

// --- STORAGE OVERVIEW LIST ---
export const StorageList = ({ storages, tests, setTests, setStorageModal, setActiveStorageId, setCurrentModule, handlePrint, setDeleteStorageModal, jumpToTest }) => {
    /* Une boîte qu'AUCUN meuble ne porte (import ancien, synchronisation d'un
       poste où le meuble a disparu) ne doit jamais être invisible : elle est
       listée ici et reçoit un meuble en un clic. Normalement cette liste est
       vide : le chargement d'un dataset replace déjà ces boîtes
       (repairBoxPlacements, utils/storageBoxes.js). */
    const boxesWithNoStorage = boxesWithoutStorage(tests, storages);

    return (
        <div className="p-6 h-full overflow-y-auto custom-scrollbar flex flex-col">
            <div className="mb-6 flex justify-between items-end border-b border-slate-200 pb-4">
                <div>
                    <h2 className="text-2xl font-black text-slate-800">Storage Locations</h2>
                    <p className="text-sm text-slate-500">Manage your physical storage units and navigate inside them to add boxes.</p>
                </div>
                <div className="flex gap-2 no-print">
                    <button onClick={handlePrint} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center gap-2 shadow-sm">
                        <Icon name="printer" size={14} /> Print / Save PDF
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
                        const occupancy = storageOccupancy(st, tests);
                        const incomplete = storageCompleteness(tests, st.id).incomplete;
                        /* Les boîtes que la grille de ce meuble ne peut pas dessiner :
                           elles sont comptées, donc elles doivent être MONTRÉES. */
                        const toPlace = boxesNeedingSlot(tests, st);
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
                                    <button onClick={(e) => { e.stopPropagation(); setStorageModal(st); }} className="absolute top-4 right-4 text-slate-400 hover:text-indigo-600 transition-colors z-10 no-print" title="Edit storage">✏️</button>
                                    {setDeleteStorageModal && (
                                        <button onClick={(e) => {
                                            e.stopPropagation();
                                            const others = storages.filter(s => s.id !== st.id);
                                            setDeleteStorageModal({ storageId: st.id, targetStorageId: (others[0] && others[0].id) || '' });
                                        }} className="absolute top-4 right-11 text-slate-400 hover:text-red-600 transition-colors z-10 no-print" title="Delete storage — the boxes inside are never deleted (you choose whether to move them first)">🗑️</button>
                                    )}
                                    <span className="text-[10px] font-black uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded self-start mb-2">{st.type}</span>
                                    <h3 className="font-bold text-slate-800 text-lg truncate pr-12">{st.name}</h3>
                                    <p className="text-xs text-slate-500 mt-1 font-medium">Grid: {storageRows(st)} rows × {storageCols(st)} cols ({occupancy.slots} slots)</p>
                                    <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center text-xs font-bold">
                                        <span className="text-slate-500 flex items-center gap-1"><Icon name="box" size={13} /> {occupancy.boxes} Box{occupancy.boxes === 1 ? '' : 'es'}</span>
                                        <span className={occupancy.free === 0 ? 'text-amber-600' : 'text-emerald-600'}>{occupancy.free === 0 ? 'every slot used (boxes stacked)' : `${occupancy.free} slot${occupancy.free === 1 ? '' : 's'} free`}</span>
                                    </div>
                                    <p className="text-[10px] text-slate-400 font-medium mt-0.5">{occupancy.used} / {occupancy.slots} slots occupied</p>
                                    {incomplete.length > 0 && (
                                        <button type="button"
                                           onClick={(e) => { e.stopPropagation(); setActiveStorageId(st.id); setCurrentModule('storage-detail'); }}
                                           title={`${describeBoxIssues(incomplete[0].issues)}\n\nClick to open this storage and see those boxes.`}
                                           className="mt-2 text-left text-[10px] font-bold text-red-600 bg-red-50 border border-red-100 rounded px-2 py-1 hover:bg-red-100">
                                            ⚠ {incomplete.length} box{incomplete.length === 1 ? '' : 'es'} missing required data ({incomplete.slice(0, 3).map(r => boxListLabel(r.box)).join(', ')}{incomplete.length > 3 ? '…' : ''})
                                        </button>
                                    )}
                                    {toPlace.length > 0 && (
                                        <p className="mt-1 text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-1"
                                           title={`${toPlace.map(b => boxListLabel(b)).join(', ')}\n\nThe grid of this storage cannot draw them: they are counted but not shown. Open the storage to give them a visible slot.`}>
                                            ⚠ {toPlace.length} box{toPlace.length === 1 ? '' : 'es'} without a visible slot
                                        </p>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
            {/* ── AUCUNE BOÎTE SANS MEUBLE ────────────────────────────────────
                Une boîte qu'aucun meuble ne porte (fichier importé, poste où le
                meuble a disparu) ne doit jamais devenir invisible : elle est
                listée ici, à côté des meubles, et reprend une place en un clic
                (« ⇊ Place »). Le chargement d'un dataset fait déjà ce travail
                (repairBoxPlacements) : cette liste est donc normalement vide. */}
            {boxesWithNoStorage.length > 0 && (
                <div className="mt-6 bg-white border border-amber-300 rounded-xl shadow-sm p-5">
                    <h3 className="text-sm font-black text-amber-900 uppercase">
                        ⚠ {boxesWithNoStorage.length} box{boxesWithNoStorage.length === 1 ? '' : 'es'} without a storage
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                        A box never stays without a storage: {boxesWithNoStorage.length === 1 ? 'it takes' : 'they take'} the first free slot of
                        {' '}{(storages[0] && storages[0].name) || 'a storage'} as soon as it is placed. Nothing is deleted — the box, its wells and its photos are kept
                        (its Drive folder follows the box).
                    </p>
                    <ul className="mt-3 flex flex-col gap-1.5">
                        {boxesWithNoStorage.map((b) => (
                            <li key={b.id} className="flex flex-wrap items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                                <span className="text-xs font-bold text-slate-700 flex-1 min-w-0 truncate">
                                    {b.name || 'Unnamed box'}{b.boxOwner ? ` · ${b.boxOwner}` : ''} · {boxSizeLabel(b)}
                                    {b.storageLabel || b.storageType ? ` · was: ${[b.storageType, b.storageLabel].filter(Boolean).join(' / ')}` : ''}
                                </span>
                                <button type="button"
                                    onClick={() => setTests(prev => repairBoxPlacements(prev, storages).tests)}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-2 py-1 text-[11px] font-bold"
                                    title={`Give this box a storage again (first free slot of ${(storages[0] && storages[0].name) || 'the first storage'})`}>
                                    ⇊ Place in {storages[0].name}
                                </button>
                                {jumpToTest && (
                                    <button type="button" onClick={() => jumpToTest(b.id)}
                                        className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-2 py-1 text-[11px] font-bold" title="Open this box">Open</button>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

// --- STORAGE DETAIL VIEW ---
export const StorageDetail = ({ storages, activeStorageId, tests, setTests, setStorages, setCurrentModule, handlePrint, jumpToTest, setMoveModal, createEmptyTest, setActiveTestId, setDeleteStorageModal }) => {
    const st = storages.find(s => s.id === activeStorageId);
    const storageName = st ? String(st.name || '') : '';
    /* La taille de la PROCHAINE boîte (9 × 9, ou 1 × 1 pour un échantillon en
       vrac) et l'emplacement dont on DÉPLIE la pile : plusieurs boîtes peuvent
       partager un emplacement, la grille n'en montre qu'une — ce panneau les
       ouvre toutes (et permet d'en ajouter une de plus). */
    const [newBoxSize, setNewBoxSize] = useState('box9');
    const [slotPicker, setSlotPicker] = useState(null);
    const storageImageUrl = st ? String(st.imageUrl || '') : '';
    /* L'image de référence a pu être envoyée AVANT cette structure
       (storage/<storage>/image/…) : on la ramène sous storage/<storage>/images/.
       Le déplacement se fait par identifiant de fichier, donc le lien enregistré
       dans le storage ne change pas. */
    useEffect(() => {
        if (!storageImageUrl || !storageName) return;
        tidyStorageFiles({ storage: storageName, urls: [storageImageUrl] })
            .then((moved) => { if (moved > 0) console.info(`Storage image moved into ${storageImagesFolderPath(storageName).join('/')}`); })
            .catch(() => {});
    }, [storageImageUrl, storageName]);
    if (!st) return <div className="p-6">Storage not found.</div>;
    
    const boxesInStorage = boxesOfStorage(tests, st.id);
    const storageFullness = storageOccupancy(st, tests);
    /* Les boîtes que la GRILLE ne peut pas dessiner (emplacement absent ou hors
       grille) : elles restent visibles ici, avec le geste qui leur rend une
       place (voir utils/storageBoxes.js). */
    const boxesToPlace = boxesNeedingSlot(tests, st);
    
    /* Ajoute une boîte dans un emplacement : celui qu'on a cliqué, ou le premier
       emplacement le moins rempli. Un emplacement DÉJÀ occupé accepte la
       nouvelle boîte (elle vient derrière la première = empilement), et la
       taille 1 × 1 fait de la boîte un échantillon en vrac. */
    const handleAddBox = (slotIndex, sizeId) => {
        const id = 't' + Date.now();
        const size = presetById(sizeId || newBoxSize);
        const newBox = createEmptyTest(id, tests.length + 1, 'plate-9x9box');
        newBox.storageId = st.id;
        newBox.boxRows = size.rows;
        newBox.boxCols = size.cols;
        /* Le propriétaire est un champ OBLIGATOIRE d'une boîte : une boîte neuve
           part donc de celui qui la crée (modifiable sur la page de la boîte),
           au lieu de naître incomplète. La date, elle, est déjà celle du jour. */
        newBox.boxOwner = newBox.operator || '';
        newBox.storageIndex = (slotIndex === undefined || slotIndex === null)
            ? nextSlotIndex(tests, st.id, storageSlotCount(st))
            : slotIndex;
        setTests(prev => [...prev, newBox]);
        setActiveTestId(id); 
        setCurrentModule('active-test');
    };

    const openDeleteStorage = () => {
        if (!st || !setDeleteStorageModal) return;
        const others = storages.filter(s => s.id !== st.id);
        setDeleteStorageModal({ storageId: st.id, targetStorageId: (others[0] && others[0].id) || '' });
    };

    return (
        <div className="p-6 h-full overflow-y-auto custom-scrollbar flex flex-col bg-slate-50">
            <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-end gap-4 shrink-0">
                <div className="flex items-center gap-4">
                    <button onClick={() => setCurrentModule('storage')} className="text-slate-400 hover:text-indigo-600 transition-colors bg-white p-2 rounded-lg shadow-sm border border-slate-200 no-print">◀ Back</button>
                    <div>
                        <h2 className="text-2xl font-black text-slate-800 flex items-center gap-2"><Icon name="box" size={26} className="text-indigo-500" /> {st.name}</h2>
                        <p className="text-sm text-slate-500">
                            Capacity: {storageFullness.slots} slots · {storageFullness.boxes} box{storageFullness.boxes === 1 ? '' : 'es'} in {storageFullness.used} slot{storageFullness.used === 1 ? '' : 's'}.
                            Click an empty slot to add a box; a slot can hold several boxes (they are stacked, open the slot to see them all).
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2 no-print">
                    <button onClick={handlePrint} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center gap-2 shadow-sm">
                        <Icon name="printer" size={14} /> Print / Save PDF
                    </button>
                    <select
                        value={newBoxSize}
                        onChange={(e) => setNewBoxSize(e.target.value)}
                        title="Size of the next box: 9 × 9 for a rack, 1 × 1 for a single bulk sample"
                        className="border border-slate-300 rounded-lg px-2 py-2 text-sm bg-white outline-none focus:border-blue-500 font-bold text-slate-700 shadow-sm">
                        {BOX_SIZE_PRESETS.map(p => (<option key={p.id} value={p.id}>{p.label}</option>))}
                    </select>
                    <button onClick={() => handleAddBox()} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-6 rounded-lg shadow-sm text-sm transition-colors flex items-center gap-2"><Icon name="box" size={14} /> Add {presetById(newBoxSize).short} box here</button>
                    <button onClick={openDeleteStorage} title="Delete this storage — the boxes inside are never deleted (you choose whether to move them first)"
                        className="bg-white border border-red-200 text-red-600 hover:bg-red-50 font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center gap-2 shadow-sm">
                        🗑 Delete Storage
                    </button>
                </div>
            </div>
            <div className="flex-1 flex flex-col xl:flex-row gap-6 min-h-0">
                <div className="w-full xl:w-1/3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm shrink-0 flex flex-col no-print">
                    <h3 className="text-xs font-bold text-slate-500 uppercase mb-3">Reference Image</h3>
                    {st.imageUrl ? (
                        <div className="flex-1 rounded-lg overflow-hidden border border-slate-100 bg-slate-100 mb-3">
                            <img src={getProxiedImage(st.imageUrl)} alt={st.name} referrerPolicy="no-referrer" className="w-full h-full object-cover"/>
                        </div>
                    ) : (
                        <div className="flex-1 rounded-lg border border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-[11px] text-slate-400 mb-3 min-h-[110px]">
                            No image yet
                        </div>
                    )}
                    <DriveUploadButton
                        label={st.imageUrl ? '⬆ Replace image' : '⬆ Upload image'}
                        accept="image/*"
                        suggestedName={sanitizeSlug(st.name) + '_image'}
                        path={storageImagesFolderPath(st.name)}
                        naming={storageFileCtx({ storage: st.name, title: sanitizeSlug(st.name) + '_image' })}
                        nameFor={(file) => originalBaseName(file, sanitizeSlug(st.name) + '_image')}
                        onDone={({ dataUrl, drive }) =>
                            setStorages(prev => prev.map(s => s.id === st.id ? { ...s, imageUrl: drive ? drive.driveUrl : dataUrl } : s))
                        }
                    />
                    {st.imageUrl && (
                        <button type="button"
                                onClick={() => setStorages(prev => prev.map(s => s.id === st.id ? { ...s, imageUrl: '' } : s))}
                                className="text-[10px] font-bold text-red-500 hover:text-red-700 underline self-start mt-2">
                            Remove image
                        </button>
                    )}
                </div>
                <div className="flex-1 bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col">
                    <h3 className="text-xs font-bold text-slate-500 uppercase mb-4 border-b border-slate-100 pb-2 flex justify-between">
                        <span>Interactive Grid</span>
                        <span className="text-indigo-600">{boxesInStorage.length} box{boxesInStorage.length === 1 ? '' : 'es'} in {storageFullness.used} / {storageFullness.slots} slots</span>
                    </h3>
                    <div className="flex-1 overflow-auto custom-scrollbar bg-slate-50 rounded-xl p-6 border border-slate-100 shadow-inner flex items-center justify-center">
                        <div className="grid gap-3 max-w-full" style={{ gridTemplateColumns: `repeat(${storageCols(st)}, minmax(80px, 120px))` }}>
                            {Array.from({length: storageSlotCount(st)}).map((_, i) => {
                                const stack = boxesInSlot(tests, st.id, i);
                                const box = stack[0] || null;
                                const boxIssues = box ? requiredBoxIssues(box) : [];
                                return (
                                    <div key={i} onClick={() => { if (stack.length) setSlotPicker({ slotIndex: i }); else handleAddBox(i); }}
                                        className={`relative aspect-square border-2 rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all shadow-sm overflow-hidden p-2 text-center group
                                        ${box ? 'bg-white border-indigo-300 hover:border-indigo-500 hover:shadow-md' : 'bg-slate-100 border-dashed border-slate-300 text-slate-400 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-600'}`} 
                                        title={box
                                            ? `Slot ${i+1}${stack.length > 1 ? ` — ${stack.length} boxes stacked` : ''}: ${stack.map(b => b.name || 'unnamed box').join(', ')} (click to open)`
                                            : `Add Box to Slot ${i+1}`}>
                                        <span className="absolute top-1 left-1.5 text-[9px] font-black text-slate-300 select-none">{i+1}</span>
                                        {stack.length > 1 && (
                                            <span className="absolute top-1 left-4 text-[8px] font-black text-white bg-indigo-600 rounded px-1 select-none"
                                                  title={`${stack.length} boxes in this slot (stacked — nothing is lost)`}>{stack.length}×</span>
                                        )}
                                        {box ? (
                                            <React.Fragment>
                                                {box.boxImageUrl ? (
                                                    <img src={getProxiedImage(box.boxImageUrl)} alt={box.name} referrerPolicy="no-referrer" className="w-10 h-10 object-cover rounded-lg border border-slate-200 mb-1 shadow-sm"/>
                                                ) : (
                                                    <span className="text-indigo-500 mb-1"><Icon name="box" size={26} /></span>
                                                )}
                                                {box.boxContentsImageUrl && (
                                                    <span className="absolute bottom-1 right-1 w-4 h-4 bg-white border border-slate-300 rounded-full flex items-center justify-center text-[8px] shadow-sm"
                                                          title="Inside photo available">📷</span>
                                                )}
                                                <span className={`text-[10px] font-bold leading-tight w-full truncate cursor-pointer hover:underline ${boxIssues.length ? 'text-red-600' : 'text-indigo-900'}`}
                                                      onClick={(e) => { e.stopPropagation(); jumpToTest(box.id); }}
                                                      title={`Open ${box.name || 'this box'} — click the slot itself to see all ${stack.length > 1 ? `${stack.length} boxes` : 'box'}${boxIssues.length ? `\n⚠ ${describeBoxIssues(boxIssues)}` : ''}`}>
                                                    {boxIssues.length > 0 ? '⚠ ' : ''}{box.name || 'Unnamed box'}
                                                </span>
                                                <span className="text-[9px] text-slate-500 truncate w-full">{box.date}</span>
                                                <span className="text-[8px] text-slate-400 truncate w-full">{boxSizeLabel(box)}{box.boxOwner ? ` · ${box.boxOwner}` : ''}</span>
                                                <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-20 no-print">
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); setMoveModal({ boxId: box.id, currentStorageId: st.id, targetStorageId: st.id }); }} 
                                                        className="bg-blue-500 hover:bg-blue-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs shadow-sm" 
                                                        title="Move Box"
                                                    >↕️</button>
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); handleAddBox(i); }}
                                                        className="bg-indigo-500 hover:bg-indigo-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs shadow-sm"
                                                        title={`Add another ${presetById(newBoxSize).short} box to slot ${i+1} (stacked on the one already there)`}
                                                    >+</button>
                                                    <button 
                                                        onClick={(e) => { 
                                                            e.stopPropagation(); 
                                                            if(confirm(`Delete box "${box.name}"?`)) {
                                                                setTests(prev => prev.filter(t => t.id !== box.id));
                                                                markAttachmentsDeleted(box).catch(() => {});
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
            {/* ── AUCUNE BOÎTE INVISIBLE ──────────────────────────────────────
                La grille ne dessine que les cases du meuble. Une boîte dont
                l'emplacement est absent ou TOMBE HORS de la grille (meuble
                réduit, boîte arrivée d'un autre poste) n'y apparaît pas, alors
                qu'elle reste comptée par la fiche du meuble — c'est le
                « ⚠ N boxes missing required data » qui parle de boîtes que
                personne ne voit. Elles sont donc listées ICI, avec le geste qui
                leur rend une place visible. */}
            {boxesToPlace.length > 0 && (
                <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl p-4 shrink-0">
                    <p className="text-sm font-bold text-amber-900">
                        ⚠ {boxesToPlace.length} box{boxesToPlace.length === 1 ? '' : 'es'} in this storage {boxesToPlace.length === 1 ? 'has' : 'have'} no visible slot
                    </p>
                    <p className="text-xs text-amber-800 mt-1">
                        The grid only draws the {storageRows(st)} × {storageCols(st)} slots of this storage, so these boxes are counted but not shown. Nothing is lost: give them a place and they appear in the grid.
                    </p>
                    <ul className="mt-2 flex flex-col gap-1">
                        {boxesToPlace.map((b) => (
                            <li key={b.id} className="flex flex-wrap items-center gap-2 bg-white border border-amber-200 rounded-lg px-3 py-1.5">
                                <span className="text-xs font-bold text-slate-700 flex-1 min-w-0 truncate">{boxListLabel(b)}{b.boxOwner ? ` · ${b.boxOwner}` : ''} · {boxSizeLabel(b)}</span>
                                <button type="button"
                                    onClick={() => setTests(prev => repairBoxPlacements(prev, storages).tests)}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-2 py-1 text-[11px] font-bold"
                                    title="Place every box of this storage that has no visible slot in the first free slot">⇊ Place</button>
                                <button type="button" onClick={() => jumpToTest(b.id)}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-2 py-1 text-[11px] font-bold" title="Open this box">Open</button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Un emplacement peut porter PLUSIEURS boîtes : la grille n'en
                montre qu'une (la première), ce panneau les ouvre toutes. */}
            {slotPicker && (() => {
                const stack = boxesInSlot(tests, st.id, slotPicker.slotIndex);
                return (
                    <div className="fixed inset-0 bg-slate-900/50 z-[999999] flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setSlotPicker(null)}>
                        <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col border border-slate-200" onClick={e => e.stopPropagation()}>
                            <div className="p-4 border-b border-slate-200 flex justify-between items-start shrink-0">
                                <div>
                                    <h3 className="text-base font-bold text-slate-800">Slot {slotPicker.slotIndex + 1}</h3>
                                    <p className="text-xs text-slate-500">{stack.length} box{stack.length === 1 ? '' : 'es'} in this slot{stack.length > 1 ? ' — stacked, not lost' : ''}</p>
                                </div>
                                <button onClick={() => setSlotPicker(null)} className="text-slate-400 hover:text-slate-600 text-2xl">&times;</button>
                            </div>
                            <div className="p-4 flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-2 min-h-0">
                                {stack.length === 0 && <p className="text-sm text-slate-500">This slot is empty.</p>}
                                {stack.map((b) => {
                                    const issues = requiredBoxIssues(b);
                                    return (
                                        <div key={b.id} className={`border rounded-lg p-3 flex items-center gap-3 ${issues.length ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
                                            <span className="text-[10px] font-black text-white bg-slate-400 rounded px-1.5 py-0.5 shrink-0" title="Position in the stack">{slotStackLabel(tests, b) || '1/1'}</span>
                                            <div className="flex-1 min-w-0">
                                                <p className={`text-sm font-bold truncate ${issues.length ? 'text-red-700' : 'text-slate-800'}`}>{b.name || 'Unnamed box'}</p>
                                                <p className="text-[11px] text-slate-500 truncate">{boxSizeLabel(b)}{b.boxOwner ? ` · ${b.boxOwner}` : ''}{b.date ? ` · ${b.date}` : ''}</p>
                                                {issues.length > 0 && <p className="text-[10px] text-red-600 font-bold">{describeBoxIssues(issues)}</p>}
                                            </div>
                                            <div className="flex gap-1 shrink-0">
                                                <button onClick={() => { setSlotPicker(null); jumpToTest(b.id); }}
                                                    className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-2 py-1 text-[11px] font-bold" title="Open this box">Open</button>
                                                <button onClick={() => { setSlotPicker(null); setMoveModal({ boxId: b.id, currentStorageId: st.id, targetStorageId: st.id }); }}
                                                    className="bg-blue-500 hover:bg-blue-600 text-white rounded-lg px-2 py-1 text-[11px] font-bold" title="Move this box to another slot or storage">↕️</button>
                                                <button onClick={() => { setSlotPicker(null); setMoveModal({ boxId: b.id, currentStorageId: st.id, targetStorageId: (storages.find(s => s.id !== st.id) || st).id }); }}
                                                    className="bg-white border border-slate-300 hover:bg-slate-100 text-slate-600 rounded-lg px-2 py-1 text-[11px] font-bold"
                                                    title={storages.some(s => s.id !== st.id)
                                                        ? 'Move this box to another slot or to another storage (a box always keeps a storage)'
                                                        : 'Move this box to another slot of this storage (it is the only storage: a box never stays without a storage)'}>
                                                    ↔ Move
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="p-3 border-t border-slate-100 flex justify-between items-center gap-2 shrink-0">
                                <div className="flex items-center gap-2">
                                    <select value={newBoxSize} onChange={(e) => setNewBoxSize(e.target.value)}
                                        className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none font-bold text-slate-700">
                                        {BOX_SIZE_PRESETS.map(p => (<option key={p.id} value={p.id}>{p.label}</option>))}
                                    </select>
                                    <button onClick={() => { const i = slotPicker.slotIndex; setSlotPicker(null); handleAddBox(i); }}
                                        className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-3 py-1.5 text-xs font-bold"
                                        title="Add another box to this slot (it is stacked behind the others)">+ Add box to this slot</button>
                                </div>
                                <button onClick={() => setSlotPicker(null)} className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg">Close</button>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};

// --- BOX DETAIL VIEW ---
export const BoxDetail = ({ activeTest, updateActiveTest, storages, expandedGroups, setExpandedGroups, customCmpds, TestHeader, operators = [] }) => {
    /* ── Étiquette de la boîte ───────────────────────────────────────────────
       storage/<storage>/boxes/<boîte>/<date>_<propriétaire>_boxlabel.pdf est
       fabriquée et déposée sur le Drive TOUT SEUL (voir BoxLabelFile) à partir de
       la table des puits REMPLIS de la boîte : le PDF archivé ne dépend donc pas
       des clics de sélection, alors que le bouton « Print Label » ci-dessous
       imprime la SÉLECTION. La date et le propriétaire de la boîte — ses deux
       champs obligatoires — donnent son NOM au fichier et entrent dans la
       signature : les changer réécrit l'étiquette. */
    const boxStorageName = ((storages || []).find((s) => s.id === activeTest.storageId)?.name) || '';
    const boxPosition = activeTest.storageIndex === null || activeTest.storageIndex === undefined
      ? null
      : activeTest.storageIndex + 1;
    const labelRows = boxLabelRows(activeTest, filledWells(activeTest));
    const labelOwner = boxLabelOwner(activeTest);
    const labelDate = boxLabelDate(activeTest);
    const labelSignature = boxLabelSignature({
      storage: boxStorageName, position: boxPosition, box: activeTest.name || '', rows: labelRows,
      date: labelDate, owner: labelOwner, notes: activeTest.comments || ''
    });
    /* Les photos envoyées AVANT cette structure
       (storage/<boîte>/<instance>/image/…) sont ramenées dans
       storage/<storage>/boxes/<boîte>/images/ — le lien enregistré dans la boîte
       ne change pas (déplacement par identifiant de fichier) et un fichier déjà
       rangé au bon endroit n'est jamais touché. */
    const boxPhotoKeys = [activeTest.boxImageUrl || '', activeTest.boxContentsImageUrl || ''].filter(Boolean).join('|');
    /* Le nom de la boîte est lu dans une REF, et n'est PAS une dépendance de
       l'effet : il change à chaque frappe, et recalculer le dossier à chaque
       lettre créait un dossier par nom intermédiaire (renommer une boîte en
       « jac » laissait storage/<storage>/boxes/j, …/ja, …/jac). Le rangement
       suit donc l'OUVERTURE de la boîte et ses photos ; le renommage, lui, est
       un geste du DOSSIER (une seule fois, au blur — voir activeTestModule). */
    const boxNameRef = useRef(activeTest.name || 'box');
    boxNameRef.current = activeTest.name || 'box';
    useEffect(() => {
        if (!boxPhotoKeys || !boxStorageName) return;
        tidyStorageFiles({ storage: boxStorageName, box: boxNameRef.current, urls: boxPhotoKeys.split('|') })
            .then((moved) => {
                if (moved > 0) console.info(`Box files moved into ${storageBoxImagesFolderPath(boxStorageName, boxNameRef.current).join('/')}`);
            })
            .catch(() => {});
    }, [boxPhotoKeys, boxStorageName, activeTest.id]);
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
  } catch {}

  return defaults;
};

    /* ── Champs OBLIGATOIRES d'une boîte ───────────────────────────────────
       Nom de l'échantillon, propriétaire et date — sur la boîte (une boîte
       1 × 1 EST un échantillon en vrac) ET sur chaque puits rempli. Les règles
       vivent dans utils/storageBoxes.js : ici on les MONTRE, on ne les
       réinvente pas. */
    const boxRequiredIssues = requiredBoxIssues(activeTest);
    const missingWellPositions = new Set(
        boxRequiredIssues.filter(i => i.scope === 'well').map(i => i.pos)
    );
    const wellIsIncomplete = (r, c) => {
        if (!wellIsFilled(getWellData(r, c))) return false;
        return missingWellPositions.has(wellPositionLabel(r, c))
            || wellMissingRequired(getWellData(r, c)).length > 0;
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

    /* ── « APPLY TO ALL » ─────────────────────────────────────────────────────
       Sélectionner plusieurs puits sert d'abord à leur donner les MÊMES
       informations : le propriétaire de l'échantillon, le solvant et la date se
       saisissent donc UNE fois (les trois contrôles de la barre ci-dessous) puis
       se posent sur TOUTE la sélection d'un seul geste. Un champ laissé vide ne
       change rien dans les puits (on peut donc appliquer le solvant sans toucher
       aux propriétaires), et tout part dans un SEUL enregistrement du jeu de
       données — pas une écriture par puits. */
    const [bulkOwner, setBulkOwner] = useState('');
    const [bulkSolvent, setBulkSolvent] = useState('');
    const [bulkDate, setBulkDate] = useState('');

    const applyToAllSelected = () => {
        const sel = Array.isArray(selectedWells) ? selectedWells : [];
        const fields = { sampleOwner: bulkOwner, solvent: bulkSolvent, date: bulkDate };
        if (!sel.length || !Object.values(fields).some(v => String(v).trim() !== '')) return;
        const ng = (activeTest.grid || []).map((row) => [...(row || [])]);
        sel.forEach(({ r, c }) => {
            const current = getWellData(r, c);
            if (fields.sampleOwner.trim() !== '') {
                current.sampleOwner = fields.sampleOwner;
                /* L'ancien champ `operator` reste synchronisé (compatibilité). */
                current.operator = fields.sampleOwner;
            }
            if (fields.solvent.trim() !== '') current.solvent = fields.solvent;
            if (fields.date.trim() !== '') current.date = fields.date;
            if (!ng[r]) ng[r] = [];
            ng[r][c] = JSON.stringify(current);
        });
        updateActiveTest({ grid: ng });
    };

const printBoxLabel = () => {
  try {
    const printWin = window.open('', '_blank');

    if (!printWin) {
      alert('Popup blocked!');
      return;
    }

    /* La table imprimée est celle de l'étiquette (utils/boxLabel.js) — la MÊME
       que celle déposée sur le Drive en boxlabel.pdf — et elle contient ici la
       SÉLECTION (le bouton est désactivé sans sélection) ; ses nombreuses
       colonnes laissent lire les notes ENTIÈRES, alors que le PDF les reprend
       en calce, rappelées par la position du puits (voir boxLabelPdf). */
    const html = buildBoxLabelHtml({
      storageName: boxStorageName || activeTest.storageLabel || 'Unassigned',
      position: boxPosition,
      boxName: activeTest.name || '',
      rows: boxLabelRows(activeTest, labelWellsFor(activeTest, selectedWells))
    });

    printWin.document.write(html);
    printWin.document.close();
    printWin.focus();

    setTimeout(() => {
      try {
        printWin.print();
      } catch {}
    }, 300);
  } catch (err) {
    alert('Print failed: ' + err.message);
  }
};
    return (
        <div className="flex flex-col h-full overflow-y-auto md:overflow-hidden custom-scrollbar">
            {TestHeader}
            {/* Les champs obligatoires d'une boîte (utils/storageBoxes.js) : la
                boîte doit être IDENTIFIABLE — nom de l'échantillon, propriétaire
                et date sur la boîte, et dans chaque puits rempli. Rien n'est
                bloqué : on dit simplement ce qui manque. */}
            {boxRequiredIssues.length > 0 ? (
                <div className="mx-6 mt-4 p-3 rounded-xl border border-red-200 bg-red-50 text-red-700 no-print">
                    <p className="text-xs font-black uppercase flex items-center gap-2">
                        ⚠ {boxRequiredIssues.length} required field{boxRequiredIssues.length > 1 ? 's' : ''} missing
                    </p>
                    <ul className="mt-1.5 text-[11px] list-disc list-inside grid gap-0.5">
                        {boxRequiredIssues.slice(0, 6).map((it, i) => (
                            <li key={`${it.scope}-${it.field}-${it.pos || ''}-${i}`}>{it.message}</li>
                        ))}
                    </ul>
                    {boxRequiredIssues.length > 6 && (
                        <p className="mt-1 text-[11px] font-bold">…and {boxRequiredIssues.length - 6} more</p>
                    )}
                    <p className="mt-1.5 text-[10px] text-red-500">Required on the box and in every filled well: sample name, owner, date.</p>
                </div>
            ) : (
                <div className="mx-6 mt-4 p-2.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-bold no-print">
                    ✓ All required information is filled ({filledWells(activeTest).length} filled well{filledWells(activeTest).length === 1 ? '' : 's'}).
                </div>
            )}
            <div className="p-6 md:flex-1 md:overflow-y-auto md:min-h-0 custom-scrollbar" onMouseUp={() => { if(boxDragState.active) setVal('boxDragState', { active: false, startR: -1, startC: -1 }); }}>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col mb-6">
                    <label className="text-xs font-bold text-slate-600 mb-2 flex items-center gap-1"><Icon name="document" size={13} /> General Box Notes</label>
                    <RichTextEditor value={activeTest.comments || ''} onChange={val => updateActiveTest({comments: val})} placeholder="Add general box notes here..." />
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-start gap-6 mb-6 no-print">
                    <BoxPhotoSlot
                        url={activeTest.boxImageUrl}
                        label="Box Photo (locate)"
                        hint="No photo"
                        storageName={boxStorageName}
                        boxName={activeTest.name || 'box'}
                        kind="photo"
                        onSet={(v) => updateActiveTest({ boxImageUrl: v })}
                        onClear={() => updateActiveTest({ boxImageUrl: '' })}
                    />
                    <BoxPhotoSlot
                        url={activeTest.boxContentsImageUrl}
                        label="Inside Photo (contents)"
                        hint="No photo"
                        storageName={boxStorageName}
                        boxName={activeTest.name || 'box'}
                        kind="contents"
                        onSet={(v) => updateActiveTest({ boxContentsImageUrl: v })}
                        onClear={() => updateActiveTest({ boxContentsImageUrl: '' })}
                    />
                    <BoxLabelFile
                        storageName={boxStorageName}
                        boxName={activeTest.name || 'box'}
                        position={boxPosition}
                        rows={labelRows}
                        owner={labelOwner}
                        date={labelDate}
                        boxNotes={activeTest.comments || ''}
                        signature={labelSignature}
                        savedSignature={activeTest.boxLabelSignature || ''}
                        savedUrl={activeTest.boxLabelUrl || ''}
                        onSaved={({ url, signature }) => updateActiveTest({ boxLabelUrl: url, boxLabelAt: Date.now(), boxLabelSignature: signature })}
                    />
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap gap-4 items-center mb-6 no-print">
                    <div className="flex items-center gap-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Rows:</label>
                        <input type="number" min="1" max="26" value={activeTest.boxRows || 9}
                            onChange={e => updateActiveTest({ boxRows: Math.max(1, Math.min(26, parseInt(e.target.value) || 9)) })}
                            className="w-16 border border-slate-300 rounded px-2 py-1 text-sm text-center outline-none focus:border-blue-500" />
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Cols:</label>
                        <input type="number" min="1" max="26" value={activeTest.boxCols || 9}
                            onChange={e => updateActiveTest({ boxCols: Math.max(1, Math.min(26, parseInt(e.target.value) || 9)) })}
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
                        <input type="text" value={boxSearch} onChange={e => setVal('boxSearch', e.target.value)} placeholder="Filter compounds or sample owners..."
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
                                        const isMatch = boxSearch && (String(data.compound || '').toLowerCase().includes(boxSearch.toLowerCase()) || String(data.sampleOwner || data.operator || '').toLowerCase().includes(boxSearch.toLowerCase()) || String(data.description || '').toLowerCase().includes(boxSearch.toLowerCase()) || String(data.solvent || '').toLowerCase().includes(boxSearch.toLowerCase()) || String(data.concentration || '').toLowerCase().includes(boxSearch.toLowerCase()));
                                        const incompleteWell = wellIsIncomplete(r, c);
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
                                                className={`aspect-square w-12 h-12 min-w-[48px] min-h-[48px] shrink-0 rounded-full border-[3px] cursor-pointer flex flex-col items-center justify-center text-xs overflow-hidden shadow-sm transition-all hover:scale-110 ${isSelected ? 'ring-4 ring-blue-500 border-blue-600 bg-blue-50' : isMatch ? 'bg-yellow-100 border-yellow-400 shadow-yellow-400/50 shadow-lg' : hasContent ? 'bg-indigo-50 border-indigo-300 text-indigo-900' : 'bg-white border-slate-200 text-slate-300 hover:border-slate-300'} ${!isSelected && incompleteWell ? 'ring-4 ring-red-400 border-red-500' : ''}`}
                                                title={`${data.compound ? `${data.compound}${data.operator ? ` (${data.operator})` : ''}` : 'Empty Slot'}${incompleteWell ? ` — required missing: ${wellMissingRequired(data).join(', ')}` : ''}`}>
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
                            <button onClick={printBoxLabel} disabled={selectedWells.length === 0} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-sm disabled:opacity-50 flex items-center gap-2 transition-colors"><Icon name="printer" size={14} /> Print Label</button>
                        </div>
                    </div>
                    {/* Barre « APPLY TO ALL » : les trois champs que plusieurs
                        puits partagent (propriétaire de l'échantillon, solvant,
                        date) se saisissent UNE fois et se posent sur toute la
                        sélection. Un champ vidé/laissé vide ne touche à rien. */}
                    {selectedWells.length > 0 && (
                        <div className="mb-4 p-3 rounded-xl border border-blue-200 bg-blue-50 flex flex-wrap items-center gap-2">
                            <span className="text-[11px] font-black uppercase text-blue-800 mr-1">
                                ⇊ Apply to all {selectedWells.length} selected
                            </span>
                            <select
                                value={bulkOwner}
                                onChange={(e) => setBulkOwner(e.target.value)}
                                title="Owner to write in every selected slot (leave empty to keep the current owners)"
                                className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white outline-none focus:border-blue-500 text-slate-600 font-medium">
                                <option value="">Owner…</option>
                                {operators.map((op) => (<option key={`bulk-${op}`} value={op}>{op}</option>))}
                            </select>
                            <input
                                type="text"
                                value={bulkSolvent}
                                onChange={(e) => setBulkSolvent(e.target.value)}
                                placeholder="Solvent…"
                                title="Solvent to write in every selected slot (leave empty to keep the current solvents)"
                                className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-32 outline-none focus:border-blue-500"/>
                            <input
                                type="date"
                                value={bulkDate}
                                onChange={(e) => setBulkDate(e.target.value)}
                                title="Date to write in every selected slot (leave empty to keep the current dates)"
                                className="border border-slate-300 rounded-md px-2 py-1.5 text-sm outline-none focus:border-blue-500 text-slate-600"/>
                            <button type="button" onClick={applyToAllSelected}
                                disabled={!bulkOwner && !bulkSolvent.trim() && !bulkDate}
                                title="Write these values in every selected slot (empty fields are left untouched)"
                                className="bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-md px-3 py-1.5 text-sm shadow-sm disabled:opacity-40 disabled:cursor-not-allowed">
                                Apply to all selected
                            </button>
                            <button type="button"
                                onClick={() => { setBulkOwner(''); setBulkSolvent(''); setBulkDate(''); }}
                                className="text-xs font-bold text-slate-500 hover:text-slate-700 underline">
                                Clear
                            </button>
                        </div>
                    )}
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
                    <datalist id="box-cmpd-list">{[...new Set((customCmpds && customCmpds.length ? customCmpds : DEF_COMPOUNDS))].map(c => <option key={c} value={c}/>)}</datalist>
                </div>
            </div>
        </div>
    );
};
