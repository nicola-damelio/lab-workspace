/* =========================================================================
   src/components/AppModules/storageModules.jsx
   Storage Finder + Database Cleanup & Merging (extracted from App.jsx).
   Both components are pure props-based UI — firebase calls stay in App's
   data layer and in ./components/Storage.
   ========================================================================= */

import React, { useState, useMemo, useCallback } from 'react';
import { BOX_ROW_LABELS } from '../../data/constants';

/* =========================================================
STORAGE FINDER
========================================================= */

export const StorageFinder = ({
  tests = [],
  storages = [],
  operators = [],
  onOpenTest,
  onOpenStorage
}) => {
  const [searchMode, setSearchMode] = useState('owner');
  const [entityFilter, setEntityFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [textQuery, setTextQuery] = useState('');

  const findStorage = useCallback(
    (id) => storages.find((s) => s.id === id),
    [storages]
  );

  const positionLabel = useCallback((index, cols = 12) => {
    if (index === null || index === undefined || index === '') return '';

    const i = Number(index);
    const c = Number(cols) > 0 ? Number(cols) : 12;

    if (!Number.isFinite(i) || i < 0) return '';

    const row = Math.floor(i / c);
    const col = (i % c) + 1;

    const rowLabel =
      (Array.isArray(BOX_ROW_LABELS) && BOX_ROW_LABELS[row]) || String(row + 1);

    return `${rowLabel}${col}`;
  }, []);

  const parseWell = useCallback((value) => {
    if (value === null || value === undefined || value === '') return null;

    if (typeof value === 'string') {
      const trimmed = value.trim();

      if (!trimmed) return null;

      if (trimmed.startsWith('{')) {
        try {
          return JSON.parse(trimmed);
        } catch {
          return null;
        }
      }

      return { compound: trimmed };
    }

    if (typeof value === 'object') return value;

    return { compound: String(value) };
  }, []);

  const hasValue = useCallback((value) => {
    return value !== null && value !== undefined && String(value).trim() !== '';
  }, []);

  const getBoxOwner = useCallback((box) => {
    return String(box?.boxOwner || box?.operator || '').trim();
  }, []);

  const getWellOwner = useCallback((well) => {
    return String(well?.sampleOwner || well?.operator || '').trim();
  }, []);

  const getWellDetails = useCallback(
    (well) => {
      if (!well || typeof well !== 'object') return [];

      const owner = getWellOwner(well);

      const concentration = hasValue(well.concentration)
        ? [well.concentration, well.concUnit].filter(hasValue).join(' ')
        : '';

      const volume = hasValue(well.volume)
        ? [well.volume, well.volUnit].filter(hasValue).join(' ')
        : '';

      const weight = hasValue(well.weight)
        ? [well.weight, well.weightUnit].filter(hasValue).join(' ')
        : '';

      const details = [];

      if (hasValue(well.compound)) {
        details.push({ label: 'Compound', value: well.compound });
      }

      if (hasValue(owner)) {
        details.push({ label: 'Sample Owner', value: owner });
      }

      if (hasValue(well.operator) && String(well.operator).trim() !== owner) {
        details.push({ label: 'Operator', value: well.operator });
      }

      if (hasValue(well.solvent)) {
        details.push({ label: 'Solvent', value: well.solvent });
      }

      if (hasValue(concentration)) {
        details.push({ label: 'Concentration', value: concentration });
      }

      if (hasValue(volume)) {
        details.push({ label: 'Volume', value: volume });
      }

      if (hasValue(well.date)) {
        details.push({ label: 'Date', value: well.date });
      }

      if (hasValue(weight)) {
        details.push({ label: 'Weight', value: weight });
      }

      if (hasValue(well.description)) {
        details.push({ label: 'Notes', value: well.description });
      }

      return details;
    },
    [getWellOwner, hasValue]
  );

  const isStoredBox = useCallback(
    (box) => {
      if (!box) return false;

      const storage = findStorage(box.storageId);

      return Boolean(
        storage ||
          box.storageLabel ||
          box.storageType ||
          (box.storageIndex !== null &&
            box.storageIndex !== undefined &&
            box.storageIndex !== '')
      );
    },
    [findStorage]
  );

  const getBoxLocation = useCallback(
    (box) => {
      const storage = findStorage(box?.storageId);

      if (storage) {
        const pos = positionLabel(box?.storageIndex, storage.cols);
        return pos ? `${storage.name} · Slot ${pos}` : storage.name;
      }

      const legacy = [box?.storageType, box?.storageLabel]
        .filter(Boolean)
        .join(' / ');

      return legacy || 'No storage assigned';
    },
    [findStorage, positionLabel]
  );

  const getWellLocation = useCallback(
    (box, r, c) => {
      const storage = findStorage(box?.storageId);

      const rowLabel =
        (Array.isArray(BOX_ROW_LABELS) && BOX_ROW_LABELS[r]) ||
        String.fromCharCode(65 + r);

      const cell = `${rowLabel}${c + 1}`;

      const boxSlot = storage
        ? positionLabel(box?.storageIndex, storage.cols)
        : '';

      const storageName = storage
        ? storage.name
        : [box?.storageType, box?.storageLabel].filter(Boolean).join(' / ') ||
          'Unassigned storage';

      return [
        storageName,
        box?.name || 'Unnamed box',
        boxSlot ? `Slot ${boxSlot}` : '',
        `Cell ${cell}`
      ]
        .filter(Boolean)
        .join(' → ');
    },
    [findStorage, positionLabel]
  );

  const ownerOptions = useMemo(() => {
    const fromOperators = (Array.isArray(operators) ? operators : [])
      .map((op) =>
        typeof op === 'string'
          ? op
          : `${op?.name || ''} ${op?.surname || ''}`.trim()
      )
      .filter(Boolean);

    const fromTests = [];
    const fromWells = [];

    tests.forEach((t) => {
      fromTests.push(t.boxOwner || '', t.operator || '', t.sampleOwner || '');

      if (t.type === 'plate-9x9box') {
        (t.grid || []).forEach((row) => {
          (row || []).forEach((cell) => {
            const well = parseWell(cell);

            if (well) {
              fromWells.push(well.sampleOwner || well.operator || '');
            }
          });
        });
      }
    });

    return [
      ...new Set(
        [...fromOperators, ...fromTests, ...fromWells].map(String).filter(Boolean)
      )
    ].sort((a, b) => a.localeCompare(b));
  }, [operators, tests, parseWell]);

  const results = useMemo(() => {
    const sortResults = (arr) =>
      [...arr].sort(
        (a, b) =>
          a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)
      );

    const res = [];

    if (searchMode === 'owner') {
      if (!ownerFilter) return [];

      tests.forEach((box) => {
        if (box.type !== 'plate-9x9box') return;
        if (!isStoredBox(box)) return;

        if (entityFilter !== 'sample' && getBoxOwner(box) === ownerFilter) {
          res.push({
            key: box.id,
            testId: box.id,
            boxId: box.id,
            storageId: box.storageId || '',
            name: box.name || 'Unnamed box',
            owner: getBoxOwner(box),
            kind: 'Box',
            location: getBoxLocation(box),
            isWellSample: false,
            details: []
          });
        }

        if (entityFilter !== 'box') {
          (box.grid || []).forEach((row, r) => {
            (row || []).forEach((cell, c) => {
              const well = parseWell(cell);

              if (!well) return;

              const owner = getWellOwner(well);

              if (owner !== ownerFilter) return;

              const rowLabel =
                (Array.isArray(BOX_ROW_LABELS) && BOX_ROW_LABELS[r]) ||
                String.fromCharCode(65 + r);

              const cellLabel = `${rowLabel}${c + 1}`;

              res.push({
                key: `${box.id}-${r}-${c}`,
                testId: box.id,
                boxId: box.id,
                storageId: box.storageId || '',
                name: well.compound || `Sample ${cellLabel}`,
                owner,
                kind: 'Sample',
                location: getWellLocation(box, r, c),
                isWellSample: true,
                details: getWellDetails(well)
              });
            });
          });
        }
      });

      return sortResults(res);
    }

    const q = textQuery.trim().toLowerCase();

    if (!q) return [];

    if (searchMode === 'box') {
      tests.forEach((box) => {
        if (box.type !== 'plate-9x9box') return;
        if (!isStoredBox(box)) return;

        const haystack = `${box.name || ''} ${box.instanceName || ''}`.toLowerCase();

        if (!haystack.includes(q)) return;

        res.push({
          key: box.id,
          testId: box.id,
          boxId: box.id,
          storageId: box.storageId || '',
          name: box.name || 'Unnamed box',
          owner: getBoxOwner(box),
          kind: 'Box',
          location: getBoxLocation(box),
          isWellSample: false,
          details: []
        });
      });

      return sortResults(res);
    }

    tests.forEach((box) => {
      if (box.type !== 'plate-9x9box') return;
      if (!isStoredBox(box)) return;

      (box.grid || []).forEach((row, r) => {
        (row || []).forEach((cell, c) => {
          const well = parseWell(cell);

          if (!well) return;

          const haystack = `${well.compound || ''} ${well.description || ''}`.toLowerCase();

          if (!haystack.includes(q)) return;

          const rowLabel =
            (Array.isArray(BOX_ROW_LABELS) && BOX_ROW_LABELS[r]) ||
            String.fromCharCode(65 + r);

          const cellLabel = `${rowLabel}${c + 1}`;

          res.push({
            key: `${box.id}-${r}-${c}`,
            testId: box.id,
            boxId: box.id,
            storageId: box.storageId || '',
            name: well.compound || `Sample ${cellLabel}`,
            owner: getWellOwner(well),
            kind: 'Sample',
            location: getWellLocation(box, r, c),
            isWellSample: true,
            details: getWellDetails(well)
          });
        });
      });
    });

    return sortResults(res);
  }, [
    searchMode,
    entityFilter,
    ownerFilter,
    textQuery,
    tests,
    isStoredBox,
    getBoxOwner,
    getWellOwner,
    getBoxLocation,
    getWellLocation,
    getWellDetails,
    parseWell
  ]);

  const hasSearch =
    searchMode === 'owner' ? !!ownerFilter : !!textQuery.trim();

  return (
    <div className="p-4 md:p-6 pb-0 shrink-0 no-print">
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 md:p-5">
        <div className="flex flex-col xl:flex-row gap-3 xl:items-end">
          <div className="w-full xl:w-56">
            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
              Search Type
            </label>
            <select
              value={searchMode}
              onChange={(e) => {
                setSearchMode(e.target.value);
                setOwnerFilter('');
                setTextQuery('');
              }}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 font-semibold text-slate-700"
            >
              <option value="owner">Owner</option>
              <option value="box">Box name</option>
              <option value="sample">Sample name</option>
            </select>
          </div>

          {searchMode === 'owner' && (
            <>
              <div className="w-full xl:w-56">
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                  Search Scope
                </label>
                <select
                  value={entityFilter}
                  onChange={(e) => setEntityFilter(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 font-semibold text-slate-700"
                >
                  <option value="all">Boxes & Samples</option>
                  <option value="box">Boxes only</option>
                  <option value="sample">Samples only</option>
                </select>
              </div>

              <div className="flex-1 w-full">
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                  Owner
                </label>
                <select
                  value={ownerFilter}
                  onChange={(e) => setOwnerFilter(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 font-semibold text-slate-700"
                >
                  <option value="">Select owner...</option>
                  {ownerOptions.map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {searchMode === 'box' && (
            <div className="flex-1 w-full">
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                Box Name
              </label>
              <input
                type="text"
                value={textQuery}
                onChange={(e) => setTextQuery(e.target.value)}
                placeholder="Search stored boxes by name..."
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}

          {searchMode === 'sample' && (
            <div className="flex-1 w-full">
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                Sample Name
              </label>
              <input
                type="text"
                value={textQuery}
                onChange={(e) => setTextQuery(e.target.value)}
                placeholder="Search samples inside stored boxes..."
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}
        </div>

        {hasSearch ? (
          results.length === 0 ? (
            <div className="mt-4 text-sm text-slate-400 italic bg-slate-50 border border-dashed border-slate-300 rounded-lg p-4">
              No stored results found for this search.
            </div>
          ) : (
            <div className="mt-4 border border-slate-200 rounded-lg overflow-hidden">
              <div className="max-h-72 overflow-auto custom-scrollbar">
                <table className="w-full text-sm border-collapse min-w-max">
                  <thead className="sticky top-0 bg-slate-100 z-10">
                    <tr>
                      <th className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide px-3 py-2 border-b border-slate-200">
                        Type
                      </th>
                      <th className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide px-3 py-2 border-b border-slate-200">
                        Name
                      </th>
                      <th className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide px-3 py-2 border-b border-slate-200">
                        Owner
                      </th>
                      <th className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide px-3 py-2 border-b border-slate-200">
                        Location
                      </th>
                      <th className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide px-3 py-2 border-b border-slate-200">
                        Sample Fields
                      </th>
                      <th className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide px-3 py-2 border-b border-slate-200">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((row) => (
                      <tr
                        key={row.key}
                        className="border-b border-slate-100 hover:bg-blue-50/40 transition-colors"
                      >
                        <td className="px-3 py-2 text-slate-600 align-top">
                          {row.kind}
                        </td>
                        <td className="px-3 py-2 font-semibold text-slate-800 align-top">
                          {row.name}
                        </td>
                        <td className="px-3 py-2 text-slate-600 align-top">
                          {row.owner || '—'}
                        </td>
                        <td className="px-3 py-2 text-slate-600 align-top">
                          {row.location}
                        </td>
                        <td className="px-3 py-2 text-slate-600 align-top">
                          {row.details && row.details.length > 0 ? (
                            <div className="text-xs flex flex-col gap-0.5 min-w-[220px] max-w-[340px]">
                              {row.details.map((d, i) => (
                                <div key={i}>
                                  <span className="font-bold text-slate-700">
                                    {d.label}:
                                  </span>{' '}
                                  {d.value}
                                </div>
                              ))}
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="flex flex-wrap gap-2">
                            {row.isWellSample ? (
                              <button
                                type="button"
                                onClick={() => onOpenTest && onOpenTest(row.boxId)}
                                className="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-bold py-1 px-2 rounded text-xs transition-colors"
                              >
                                Open box
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => onOpenTest && onOpenTest(row.testId)}
                                className="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-bold py-1 px-2 rounded text-xs transition-colors"
                              >
                                Open {row.kind.toLowerCase()}
                              </button>
                            )}

                            {row.storageId && (
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenStorage && onOpenStorage(row.storageId)
                                }
                                className="bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 font-bold py-1 px-2 rounded text-xs transition-colors"
                              >
                                Show storage
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        ) : (
          <div className="mt-4 text-xs text-slate-500 bg-blue-50 border border-blue-100 rounded-lg p-3">
            Search by <b>owner</b> to find stored boxes and samples inside boxes.
            Search by <b>box name</b> to find where a stored box is located.
            Search by <b>sample name</b> to find samples stored inside boxes.
          </div>
        )}
      </div>
    </div>
  );
};
/* =========================================================
   DATABASE CLEANUP & MERGING
========================================================= */
export const DatabaseCleanupManager = ({
  setTests,
  allCmpds, allCellLines,
  setCustomCmpds, setCompoundMeta,
  setCustomCellLines, setCellLineMeta,
  datasetsList, deleteDataset, deleteEmptyDatasets
}) => {
  // Merge state
  const [oldName, setOldName] = useState('');
  const [newName, setNewName] = useState('');

  // Rename state
  const [renameTarget, setRenameTarget] = useState('');
  const [renameValue, setRenameValue] = useState('');

  // Combine compounds and cell lines
  const allResources = [...new Set([...allCmpds, ...allCellLines])].sort((a, b) => a.localeCompare(b));

  const replaceInTests = (oldVal, newVal) => {
    setTests(prevTests => prevTests.map(t => {
      let updated = { ...t };
      
      // Standard string fields
      if (updated.compound === oldVal) updated.compound = newVal;
      if (updated.otherMolecule === oldVal) updated.otherMolecule = newVal;
      if (updated.lipid === oldVal) updated.lipid = newVal;
      if (updated.moleculeName === oldVal) updated.moleculeName = newVal;

      // Arrays of strings
      if (Array.isArray(updated.selectedCompounds)) {
        updated.selectedCompounds = updated.selectedCompounds.map(c => c === oldVal ? newVal : c);
      }
      if (Array.isArray(updated.cellLines)) {
        updated.cellLines = updated.cellLines.map(c => c === oldVal ? newVal : c);
      }
      if (Array.isArray(updated.compounds)) {
        updated.compounds = updated.compounds.map(c => c === oldVal ? newVal : c);
      }
      if (Array.isArray(updated.rowCompounds)) {
        updated.rowCompounds = updated.rowCompounds.map(c => c === oldVal ? newVal : c);
      }

      // 2D Grid (Plate Boxes and Multiwell assays)
      if (Array.isArray(updated.grid)) {
        updated.grid = updated.grid.map(row => 
          row.map(cell => {
            if (!cell) return cell;
            
            if (typeof cell === 'string') {
              if (cell === oldVal) return newVal;
              // Handle JSON stringified wells
              if (cell.startsWith('{')) {
                try {
                  let parsed = JSON.parse(cell);
                  if (parsed.compound === oldVal) {
                    parsed.compound = newVal;
                    return JSON.stringify(parsed);
                  }
                } catch {}
              }
              return cell;
            }
            
            // Handle Object wells
            if (typeof cell === 'object' && cell.compound === oldVal) {
              return { ...cell, compound: newVal };
            }
            return cell;
          })
        );
      }

      return updated;
    }));
  };

  const handleMergeReplace = () => {
    if (!oldName || !newName) return alert("Please select both the item to delete and the item to replace it with.");
    if (oldName === newName) return alert("The old name and new name must be different.");
    
    if (!window.confirm(`WARNING: Every instance of "${oldName}" will be permanently rewritten to "${newName}".\n\n"${oldName}" will then be DELETED from the library.\n\nAre you sure you want to proceed?`)) return;

    replaceInTests(oldName, newName);

    // Delete the old item
    setCustomCmpds(prev => prev.filter(c => c !== oldName));
    setCompoundMeta(prev => { const next = {...prev}; delete next[oldName]; return next; });
    
    setCustomCellLines(prev => prev.filter(c => c !== oldName));
    setCellLineMeta(prev => { const next = {...prev}; delete next[oldName]; return next; });

    setOldName('');
    setNewName('');
    alert(`Success! "${oldName}" merged into "${newName}".`);
  };

  const handleGlobalRename = () => {
    const val = renameValue.trim();
    if (!renameTarget || !val) return alert("Please select an item and enter a new name.");
    if (renameTarget === val) return alert("The new name is the same as the old name.");
    if (allResources.includes(val)) return alert(`"${val}" already exists in the library! If you want to combine them, use the 'Merge & Delete Duplicate' tool below.`);

    if (!window.confirm(`This will rename "${renameTarget}" to "${val}" in the library AND update it across all your existing tests/plates.\n\nMetadata (MW, sequence, etc.) will be preserved.\n\nProceed?`)) return;

    replaceInTests(renameTarget, val);

    // Rename in Compound Library
    if (allCmpds.includes(renameTarget)) {
      setCustomCmpds(prev => {
        const arr = prev.filter(c => c !== renameTarget);
        arr.push(val);
        return arr;
      });
      setCompoundMeta(prev => {
        const next = {...prev};
        const oldMeta = next[renameTarget] || {};
        next[val] = { ...oldMeta, name: val, updatedAt: Date.now() };
        delete next[renameTarget];
        return next;
      });
    }

    // Rename in Cell Line Library
    if (allCellLines.includes(renameTarget)) {
      setCustomCellLines(prev => {
        const arr = prev.filter(c => c !== renameTarget);
        arr.push(val);
        return arr;
      });
      setCellLineMeta(prev => {
        const next = {...prev};
        const oldMeta = next[renameTarget] || {};
        next[val] = { ...oldMeta, name: val, updatedAt: Date.now() };
        delete next[renameTarget];
        return next;
      });
    }

    setRenameTarget('');
    setRenameValue('');
    alert(`Success! "${renameTarget}" renamed to "${val}".`);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* --- SAFETY BANNER --- */}
      <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4">
        <p className="text-xs font-bold text-red-700 leading-relaxed">
          ⚠️ This is the only area of the program where data can be deleted. The start page no longer
          deletes anything — every delete request from the start page warns and redirects here.
          Every deletion is permanent and always asks for confirmation first.
        </p>
      </div>

      {/* --- DELETE DATASETS TOOL --- */}
      <div className="bg-slate-50 border-2 border-red-200 rounded-xl p-5 shadow-sm">
        <h4 className="font-bold text-red-800 mb-1 text-sm">🗑️ Delete Datasets</h4>
        <p className="text-xs text-slate-500 mb-3">
          Datasets shown on the start page can only be deleted from here. Pick a dataset and press
          Delete — a confirmation dialog always appears before anything is removed.
        </p>

        {(!datasetsList || datasetsList.length === 0) ? (
          <p className="text-xs italic text-slate-400">No datasets to delete.</p>
        ) : (
          <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto custom-scrollbar pr-1">
            {datasetsList.map((dset) => (
              <div key={dset.id}
                   className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-lg px-3 py-1.5">
                <span className="text-xs font-semibold text-slate-700 truncate min-w-0" title={dset.title || 'Untitled'}>
                  {dset.title || 'Untitled'}
                  <span className="text-slate-400 font-normal ml-2">
                    📅 {dset.date || 'No date'} · {dset.testCount || 0} test{(dset.testCount || 0) === 1 ? '' : 's'}
                  </span>
                </span>
                <button
                  onClick={(e) => deleteDataset(e, dset.id)}
                  className="shrink-0 text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-0.5 rounded text-[11px] font-bold border border-red-200 transition-colors"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={deleteEmptyDatasets}
          className="mt-3 w-full md:w-auto bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg shadow-sm transition-colors text-sm"
        >
          🗑️ Delete Empty Datasets
        </button>
        <p className="text-xs text-red-500 mt-2 font-medium">
          ⚠️ Deleting is permanent — a confirmation dialog always asks before anything is removed.
        </p>
      </div>

      {/* --- RENAME TOOL --- */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 shadow-sm">
        <h4 className="font-bold text-blue-800 mb-3 text-sm">Global Rename</h4>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-4">
            <label className="block text-xs font-bold text-blue-700 uppercase mb-1">Item to Rename</label>
            <select value={renameTarget} onChange={e => setRenameTarget(e.target.value)} className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 text-slate-800 font-semibold">
              <option value="">-- Select item --</option>
              {allResources.map(r => <option key={`ren-${r}`} value={r}>{r}</option>)}
            </select>
          </div>

          <div className="md:col-span-1 flex justify-center pb-2 text-blue-400 font-black text-xl">
            ➔
          </div>

          <div className="md:col-span-4">
            <label className="block text-xs font-bold text-blue-700 uppercase mb-1">New Name</label>
            <input 
              type="text" 
              value={renameValue} 
              onChange={e => setRenameValue(e.target.value)} 
              placeholder="Type new name..." 
              className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 text-slate-800 font-semibold"
            />
          </div>

          <div className="md:col-span-3">
            <button 
              onClick={handleGlobalRename}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg shadow-sm transition-colors text-sm"
            >
              Rename Everywhere
            </button>
          </div>
        </div>
        <p className="text-xs text-blue-600 mt-3 font-medium">
          Use this to fix typos. The item will keep all its properties (MW, sequence, etc.) and its name will be updated instantly in all tests.
        </p>
      </div>

      {/* --- MERGE TOOL --- */}
      <div className="bg-red-50 border border-red-200 rounded-xl p-5 shadow-sm">
        <h4 className="font-bold text-red-800 mb-3 text-sm">Merge & Delete Duplicate</h4>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-4">
            <label className="block text-xs font-bold text-red-700 uppercase mb-1">Bad Item (To Delete)</label>
            <select value={oldName} onChange={e => setOldName(e.target.value)} className="w-full border border-red-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-red-500 text-red-900 font-semibold">
              <option value="">-- Select duplicate --</option>
              {allResources.map(r => <option key={`old-${r}`} value={r}>{r}</option>)}
            </select>
          </div>

          <div className="md:col-span-1 flex justify-center pb-2 text-red-400 font-black text-xl">
            ➔
          </div>

          <div className="md:col-span-4">
            <label className="block text-xs font-bold text-emerald-700 uppercase mb-1">Good Item (To Keep)</label>
            <select value={newName} onChange={e => setNewName(e.target.value)} className="w-full border border-emerald-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-emerald-500 text-emerald-900 font-semibold">
              <option value="">-- Select correct item --</option>
              {allResources.map(r => <option key={`new-${r}`} value={r}>{r}</option>)}
            </select>
          </div>

          <div className="md:col-span-3">
            <button 
              onClick={handleMergeReplace}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg shadow-sm transition-colors text-sm"
            >
              Merge & Replace
            </button>
          </div>
        </div>
        <p className="text-xs text-red-500 mt-3 font-medium">
          Use this if you have two identical items (e.g., "BadH" and "Bad_H") or accidentally saved a Cell Line as a Chemical. Create the correct one, then merge the bad one into it.
        </p>
      </div>
    </div>
  );
};
