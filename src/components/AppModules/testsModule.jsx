/* =========================================================================
   src/components/AppModules/testsModule.jsx
   Tests & Test Categories view, extracted from App.jsx. Props-only.
   ========================================================================= */

import React from 'react';
import { PRIMARY_CATEGORIES } from '../../data/testTypes';

export const TestsModule = ({
  authSettings, createEmptyTest, currentUser, expandedGroups, handlePrint,
  setActiveTestId, setCurrentModule, setCurrentUser, setExpandedGroups, setLoginModal,
  setTestCategories, setTests, testCategories, tests, unlockedTestIds
}) => {
                const testSearch = expandedGroups['testSearch'] || '';
                const testCatFilter = expandedGroups['testCatFilter'] || 'ALL';
                const showCatMgr = expandedGroups['showTestCatMgr'] || false;
                const newCatInput = expandedGroups['newTestCatInput'] || '';

                // Filter dropdown shows only the official categories plus any
                // extra category still used by an existing test — stale
                // categories from older datasets are not offered here.
                const filterCategories = [
                  ...new Set([
                    ...PRIMARY_CATEGORIES,
                    ...(tests || []).map((t) => t.testCategory).filter(Boolean)
                  ])
                ];


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

                            {filterCategories.map((c) => (
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
};

