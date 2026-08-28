/* =========================================================================
   src/components/AppModules/activeTestModule.jsx
   Active Test detail view, extracted from App.jsx. Props-only.
   ========================================================================= */

import React, { lazy, useRef } from 'react';
import { BoxDetail } from '../Storage';
import { CLASSIFICATION_MAP, PRIMARY_CATEGORIES, EXPERIMENT_TYPES } from '../../data/testTypes';
import { markAttachmentsDeleted, renameDriveFilesFor, deleteTestDriveFolder } from '../../utils/driveUpload';
import { Icon } from '../Icons';
// Lazy renderers (kept as dynamic imports so each stays its own chunk).
const NMRTestRenderer = lazy(() => import('../NMRTestRenderer').then(m => ({ default: m.NMRTestRenderer })));
const PlateTestRenderer = lazy(() => import('../PlateTestRenderer').then(m => ({ default: m.PlateTestRenderer })));
const CDTestRenderer = lazy(() => import('../CDTestRenderer').then(m => ({ default: m.CDTestRenderer })));
const SSNMRTestRenderer = lazy(() => import('../ssNMRTestRenderer').then(m => ({ default: m.SSNMRTestRenderer })));
const NMRFittingsTestRenderer = lazy(() => import('../NMRFittingsTestRenderer').then(m => ({ default: m.NMRFittingsTestRenderer })));
const DOSYTestRenderer = lazy(() => import('../DOSYTestRenderer').then(m => ({ default: m.DOSYTestRenderer })));
const CloningTestRenderer = lazy(() => import('../CloningTestRenderer').then(m => ({ default: m.CloningTestRenderer })));
const ProteinExpressionTestRenderer = lazy(() => import('../ProteinExpressionTestRenderer').then(m => ({ default: m.ProteinExpressionTestRenderer })));
const DockingTestRenderer = lazy(() => import('../DockingTestRenderer'));
const FlowCytometryTestRenderer = lazy(() => import('../FlowCytometryTestRenderer').then(m => ({ default: m.FlowCytometryTestRenderer })));

export const ActiveTestModule = ({
  activeTestId, additives, allCellLines, allCmpds, appClipboard, buffers,
  cmpColors, compoundMeta, currentUser, customCmpds, customConc, customFields,
  datasetProtocols, expandedGroups, jumpToTest, mandatoryBehavior, mandatoryRules,
  molecules, nmrExperiments, nmrInstruments, nmrProbes, operatorNames, plasmidMeta,
  returnTarget, setActiveStorageId, setReturnTarget, setActiveTestId, setAppClipboard,
  setCmpColors, setCurrentModule, setCurrentProjectId,
  setCustomCmpds, setCustomConc, setExpandedGroups, setMoveModal, setTests,
  solvents, storages, testCategories, tests, unlockedTestIds,
  MDTestRenderer
}) => {
                const dragInstanceId = React.useRef(null); // dragged instance tab (for reordering)
                const testNameBeforeEditRef = useRef(null); // Drive-file rename tracking
                const instanceNameBeforeEditRef = useRef(null); // Drive-file rename tracking (instance)
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
                      .sort((a, b) => {
                        // User-dragged order (instanceOrder) wins; fall back to date
                        // order for datasets that never had an explicit order.
                        const oa = a.instanceOrder;
                        const ob = b.instanceOrder;
                        const hasA = Number.isFinite(oa);
                        const hasB = Number.isFinite(ob);
                        if (hasA && hasB) return oa - ob;
                        if (hasA) return -1;
                        if (hasB) return 1;
                        return (a.date || '').localeCompare(b.date || '');
                      });

                // Reorder the sibling conditions by dragging a tab onto another one.
                const reorderInstances = (dragId, targetId) => {
                  if (!dragId || dragId === targetId) return;
                  setTests((prev) => {
                    const drag = prev.find((x) => x.id === dragId);
                    const target = prev.find((x) => x.id === targetId);
                    if (!drag || !target || drag.name !== target.name || !drag.name.trim()) return prev;
                    const ordered = prev
                      .filter((x) => x.name === drag.name && x.name.trim() !== '')
                      .sort((a, b) => {
                        const oa = a.instanceOrder; const ob = b.instanceOrder;
                        const hasA = Number.isFinite(oa); const hasB = Number.isFinite(ob);
                        if (hasA && hasB) return oa - ob;
                        if (hasA) return -1;
                        if (hasB) return 1;
                        return (a.date || '').localeCompare(b.date || '');
                      });
                    const from = ordered.findIndex((x) => x.id === dragId);
                    const to = ordered.findIndex((x) => x.id === targetId);
                    if (from < 0 || to < 0) return prev;
                    ordered.splice(from, 1);
                    ordered.splice(to, 0, drag);
                    const orderMap = {};
                    ordered.forEach((x, i) => { orderMap[x.id] = i; });
                    return prev.map((x) => (orderMap[x.id] !== undefined ? { ...x, instanceOrder: orderMap[x.id] } : x));
                  });
                };

                const jumpToProtocolFn = (id) => {
                  setExpandedGroups((p) => ({ ...p, activeProtoId: id }));
                  setCurrentModule('protocols');
                };

                const handleDuplicateInstance = () => {
                  const id = 't' + Date.now();
                  const newTest = JSON.parse(JSON.stringify(activeTest));

                  newTest.id = id;
                  newTest.date = new Date().toISOString().split('T')[0];
                  newTest.instanceName = 'New Instance ' + (siblingTests.length + 1);
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
                    <div className="bg-white border-b border-slate-200 px-4 py-2 flex flex-col lg:flex-row justify-between items-start lg:items-center shadow-sm gap-2">
                      <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4 w-full lg:w-auto">
                        <button
                          onClick={() => {
                            // "◀ Back" returns to where the user came from
                            // (e.g. the project page) instead of always the list.
                            if (returnTarget && returnTarget.module === 'project-detail' && returnTarget.projectId) {
                              setCurrentProjectId(returnTarget.projectId);
                              setCurrentModule('project-detail');
                              setReturnTarget(null);
                            } else if (returnTarget && returnTarget.module === 'storage-detail' && returnTarget.storageId) {
                              setActiveStorageId(returnTarget.storageId);
                              setCurrentModule('storage-detail');
                              setReturnTarget(null);
                            } else if (isBox && activeTest.storageId) {
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
                            onFocus={() => { testNameBeforeEditRef.current = activeTest.name; }}
                            onBlur={() => {
                              const before = testNameBeforeEditRef.current;
                              // Rename the Drive folder even when the old name
                              // was EMPTY (never skip '').
                              if (before !== null && before !== activeTest.name) {
                                renameDriveFilesFor({ field: 'test', oldValue: before, newValue: activeTest.name }).catch(() => {});
                              }
                              testNameBeforeEditRef.current = null;
                            }}
                            className="text-base font-black text-slate-800 bg-transparent border-none outline-none focus:ring-1 focus:ring-blue-500 rounded px-1 w-full md:w-64"
                            placeholder={isBox ? 'Box Name' : 'Test Name'}
                          />

                          <div className="text-[11px] text-slate-500 font-medium px-1 mt-0.5 flex flex-wrap items-center gap-1.5">
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
                                isBox
                                  ? 'Sei sicuro di voler eliminare definitivamente questo box?'
                                  : 'Sei sicuro di voler eliminare definitivamente questo test?'
                              )
                            ) {
                              setTests((prev) => prev.filter((t) => t.id !== activeTest.id));
                              setCurrentModule('tests');
                              markAttachmentsDeleted(activeTest).catch(() => {});
                              // Remove the test's Drive folder too — the Drive tree mirrors the program.
                              deleteTestDriveFolder(activeTest).catch(() => {});
                            }
                          }}
                          className="bg-red-50 text-red-600 hover:bg-red-100 hover:border-red-300 font-bold py-2 px-3 rounded-lg text-xs transition-colors border border-red-200 shadow-sm"
                        >
                          <Icon name="trash" size={14} /> Elimina
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
        className="bg-slate-50 border border-slate-200 text-xs px-2 py-1.5 rounded-lg outline-none focus:border-blue-500"
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
        className="bg-slate-50 border border-slate-200 text-xs px-2 py-1.5 rounded-lg outline-none focus:border-blue-500"
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

                    {!isBox && (
                    <>
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
                         className="bg-slate-50 border border-slate-200 text-xs px-2 py-1.5 rounded-lg outline-none focus:border-blue-500"
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
                         className="bg-slate-50 border border-slate-200 text-xs px-2 py-1.5 rounded-lg outline-none focus:border-blue-500"
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
                           activeTest.type === 'dosy' ? 'DOSY' :
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
                            className="bg-slate-100 border border-slate-200 text-xs px-2 py-1.5 rounded-lg outline-none text-slate-500 cursor-not-allowed"
                          >
                            {EXPERIMENT_TYPES.map(type => (
                              <option key={type} value={type}>{type}</option>
                            ))}
                          </select>
                        </div>
                    </>
                    )}

                        <div className="flex flex-col flex-1 min-w-[110px]">
                          <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">
                            Instance
                          </label>
                          <input
                            type="text"
                            value={activeTest.instanceName || ''}
                            onChange={(e) => updateActiveTest({ instanceName: e.target.value })}
                            onFocus={() => { instanceNameBeforeEditRef.current = activeTest.instanceName || ''; }}
                            onBlur={() => {
                              const before = instanceNameBeforeEditRef.current;
                              const after = activeTest.instanceName || '';
                              if (before !== null && before !== after) {
                                renameDriveFilesFor({
                                  field: 'instance',
                                  oldValue: before,
                                  newValue: after,
                                  scope: {
                                    project: (activeTest.projectNames || [])[0] || '',
                                    test: activeTest.name || ''
                                  }
                                }).catch(() => {});
                              }
                              instanceNameBeforeEditRef.current = null;
                            }}
                            className="bg-slate-50 border border-slate-200 text-xs px-2 py-1.5 rounded-lg outline-none focus:border-blue-500"
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
                            className="bg-slate-50 border border-slate-200 text-xs px-2 py-1.5 rounded-lg outline-none focus:border-blue-500"
                          />
                        </div>
                        
                        {!isBox && (
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
                        )}
                      </div>
                    </div>

                    {siblingTests.length > 0 && (
                      <div className="bg-blue-50 border-b border-blue-200 px-4 md:px-6 py-2 flex items-center overflow-x-auto custom-scrollbar gap-2 shadow-inner">
                        <span className="text-[10px] font-bold text-blue-800 uppercase tracking-wide mr-2 shrink-0">
                          <Icon name="calendar" size={12} className="mr-1 text-blue-700" /> Date / Conditions:
                        </span>

                        {siblingTests.map((t, idx) => (
                          <button
                            key={t.id}
                            draggable={siblingTests.length > 1}
                            onDragStart={(e) => {
                              dragInstanceId.current = t.id;
                              e.dataTransfer.effectAllowed = 'move';
                              try { e.dataTransfer.setData('text/plain', t.id); } catch {}
                            }}
                            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                            onDrop={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const dragId = dragInstanceId.current || e.dataTransfer.getData('text/plain');
                              reorderInstances(dragId, t.id);
                            }}
                            onClick={() => setActiveTestId(t.id)}
                            className={`shrink-0 px-3 py-1.5 md:py-1 text-xs font-bold rounded-full transition-colors flex items-center gap-1.5 shadow-sm group cursor-grab active:cursor-grabbing ${
                              activeTestId === t.id
                                ? 'bg-blue-600 text-white'
                                : 'bg-white text-blue-700 border border-blue-300 hover:bg-blue-100'
                            }`}
                            title={siblingTests.length > 1 ? 'Drag to reorder conditions' : undefined}
                          >
                            <span className="opacity-40 text-[9px] mr-0.5" aria-hidden="true">⠿</span>
                            <Icon name="calendar" size={12} className="mr-1 text-blue-700" /> {t.instanceName || t.date || `Cond ${idx + 1}`}

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
                      cmpColors={cmpColors}
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

                if (activeTest.type === 'dosy') {
                  return (
                    <DOSYTestRenderer
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
                      compoundMeta={compoundMeta}
                      cmpColors={cmpColors}
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
};

