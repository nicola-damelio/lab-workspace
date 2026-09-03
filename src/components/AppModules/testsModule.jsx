/* =========================================================================
   src/components/AppModules/testsModule.jsx
   Tests & Test Categories view, extracted from App.jsx. Props-only.
   ========================================================================= */

import React, { useState } from 'react';
import { PRIMARY_CATEGORIES, CLASSIFICATION_MAP, EXPERIMENT_TYPES } from '../../data/testTypes';
import { SearchableSelect } from '../SearchableSelect';
import { Icon } from '../Icons';
import { markAttachmentsDeleted, deleteTestDriveFolder } from '../../utils/driveUpload';
import { removeTestFcsBlobs } from '../../utils/fcsBlobStore';
import { testProjectAccess, loadProjects } from './projectsModule';

const TEST_CARD_ICON = {
  nmr: 'chart-line',
  cd: 'atom',
  ssnmr: 'magnet',
  cloning: 'dna',
  'plate-9x9box': 'box',
  'nmr-fittings': 'compass',
  dosy: 'chart-bar',
  md_simulation: 'monitor',
  docking: 'target',
  flow_cytometry: 'droplet'
};
export const TestsModule = ({
  authSettings, createEmptyTest, currentUser, expandedGroups, handlePrint,
  setActiveTestId, setCurrentModule, setCurrentUser, setExpandedGroups, setLoginModal,
  setTestCategories, setTests, testCategories, tests, unlockedTestIds,
  allCellLines = [], allCmpds = [], operatorNames = [], plasmidMeta = {},
  solvents = [], buffers = [], additives = [], nmrInstruments = [], nmrProbes = [], nmrExperiments = []
}) => {
                const showCatMgr = expandedGroups['showTestCatMgr'] || false;
                const newCatInput = expandedGroups['newTestCatInput'] || '';

                // ── Notebook-style search & filters (identical to the Lab Notebook) ──
                const [searchQuery, setSearchQuery] = useState('');
                const [sortBy, setSortBy] = useState('date_desc');
                const [bestOnly, setBestOnly] = useState(false);
                const [filterPrimary, setFilterPrimary] = useState('ALL');
                const [filterSecondary, setFilterSecondary] = useState('ALL');
                const [filterScientist, setFilterScientist] = useState('ALL');
                const [filterType, setFilterType] = useState('ALL');
                const [filterCompound, setFilterCompound] = useState('ALL');
                const [filterPlasmid, setFilterPlasmid] = useState('ALL');
                const [filterCellLine, setFilterCellLine] = useState('ALL');
                const [filterProject, setFilterProject] = useState('ALL');
                const [showAdvanced, setShowAdvanced] = useState(false);
                const [filterSolvent, setFilterSolvent] = useState('ALL');
                const [filterBuffer, setFilterBuffer] = useState('ALL');
                const [filterAdditive, setFilterAdditive] = useState('ALL');
                const [filterInstrument, setFilterInstrument] = useState('ALL');
                const [filterProbe, setFilterProbe] = useState('ALL');
                const [filterPulseSeq, setFilterPulseSeq] = useState('ALL');

                const primaryOptions = PRIMARY_CATEGORIES || Object.keys(CLASSIFICATION_MAP || {});
                const secondaryOptions = (() => {
                  if (filterPrimary === 'ALL' || !CLASSIFICATION_MAP) {
                    const allSec = new Set();
                    Object.values(CLASSIFICATION_MAP || {}).forEach((arr) => (arr || []).forEach((s) => allSec.add(s)));
                    return Array.from(allSec).sort();
                  }
                  return CLASSIFICATION_MAP[filterPrimary] || [];
                })();
                const allScientists = [...new Set([...operatorNames, ...(tests || []).map((t) => t.operator)].filter(Boolean))].sort();
                const allProjects = [...new Set((tests || []).flatMap((t) => t.projectNames || []))].filter(Boolean).sort();
                const allPlasmids = Object.keys(plasmidMeta || {}).sort();
                const allSolvents = (solvents || []).map((s) => s.name || s).filter(Boolean).sort();
                const allBuffers = (buffers || []).map((b) => b.name || b).filter(Boolean).sort();
                const allAdditives = (additives || []).map((a) => a.name || a).filter(Boolean).sort();
                const allInstruments = (nmrInstruments || []).map((i) => i.name || i).filter(Boolean).sort();
                const allProbes = (nmrProbes || []).map((p) => p.name || p).filter(Boolean).sort();
                const allPulseSeqs = (nmrExperiments || []).map((e) => e.name || e).filter(Boolean).sort();

                const typeLabels = {
                  'plate-96': 'Multiwell plate essay', 'plate-48': 'Multiwell plate essay', 'plate-24': 'Multiwell plate essay',
                  'plate-12': 'Multiwell plate essay', 'plate-6': 'Multiwell plate essay', 'plate-1': 'Multiwell plate essay', 'plate-384': 'Multiwell plate essay',
                  'plate-9x9box': 'Storage Box', nmr: 'NMR', cd: 'Circular Dichroism', 'nmr-fittings': 'NMR Fitting',
                  dosy: 'DOSY', cloning: 'Cloning', protein_expression: 'Protein expression & Purification',
                  md_simulation: 'MD Simulation', docking: 'Molecular Docking', flow_cytometry: 'Flow Cytometry', ssnmr: 'Solid State NMR'
                };

                const filterActive = filterPrimary !== 'ALL' || filterSecondary !== 'ALL' || filterScientist !== 'ALL' ||
                  filterType !== 'ALL' || filterCompound !== 'ALL' || filterPlasmid !== 'ALL' || filterCellLine !== 'ALL' ||
                  filterProject !== 'ALL' || filterSolvent !== 'ALL' || filterBuffer !== 'ALL' || filterAdditive !== 'ALL' ||
                  filterInstrument !== 'ALL' || filterProbe !== 'ALL' || filterPulseSeq !== 'ALL';
                const clearAllFilters = () => {
                  setSearchQuery(''); setBestOnly(false);
                  setFilterPrimary('ALL'); setFilterSecondary('ALL'); setFilterScientist('ALL');
                  setFilterType('ALL'); setFilterCompound('ALL'); setFilterPlasmid('ALL'); setFilterCellLine('ALL');
                  setFilterProject('ALL'); setFilterSolvent('ALL'); setFilterBuffer('ALL'); setFilterAdditive('ALL');
                  setFilterInstrument('ALL'); setFilterProbe('ALL'); setFilterPulseSeq('ALL');
                };


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
                  if (currentUser && scientists.includes(currentUser.name)) return true;
                  // Project membership grants access to every experiment linked
                  // to a project the user belongs to (same rights as the project).
                  return !!currentUser && !!testProjectAccess(test, currentUser.name);
                };
                const isTestLocked = (test) => !isTestOwner(test) && !unlockedTestIds.has(test.id);
                // ── Deletion approval ─────────────────────────────
                // Normal users can only REQUEST deletion; a supervisor must approve.
                const requestDeletion = (test) => {
                  setTests((prev) => prev.map((t) =>
                    t.id === test.id
                      ? { ...t, pendingDeletion: true, deletionRequestedBy: currentUser?.name || 'Unknown', deletionRequestedAt: Date.now() }
                      : t
                  ));
                };
                const approveDeletion = (test) => {
                  // Deleting an experiment removes ALL its instances (they share
                  // the name); a box is a single item.
                  const isBox = test.type === 'plate-9x9box';
                  const group = isBox
                    ? [test]
                    : tests.filter((t) => t.id === test.id || (test.name && t.name === test.name));
                  const groupIds = new Set(group.map((t) => t.id));
                  setTests((prev) => prev.filter((t) => !groupIds.has(t.id)));
                  group.forEach((t) => {
                    // Mark any Google Drive attachments of this test as deleted.
                    markAttachmentsDeleted(t).catch(() => {});
                    // Remove the test's Drive folder too — the Drive tree mirrors the program.
                    deleteTestDriveFolder(t).catch(() => {});
                    // Drop the raw .fcs files cached in the browser (IndexedDB).
                    removeTestFcsBlobs(t).catch(() => {});
                  });
                };
                const rejectDeletion = (test) => {
                  setTests((prev) => prev.map((t) =>
                    t.id === test.id
                      ? { ...t, pendingDeletion: false, deletionRequestedBy: '', deletionRequestedAt: 0 }
                      : t
                  ));
                };
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

                  // ── Notebook-style filters (same as the Lab Notebook) ──
                  const flatCompounds = [...new Set([
                    ...(t.selectedCompounds || []),
                    ...(t.compoundsSelected || []),
                    ...(t.compound ? String(t.compound).split(',') : [])
                  ])].map((s) => String(s).trim());
                  const flatPlasmids = [...new Set([...(t.plasmids || []), ...(t.plasmid ? [t.plasmid] : [])])];
                  const testLabel = typeLabels[t.type] || t.type;

                  if (filterPrimary !== 'ALL' && t.testCategory !== filterPrimary) return false;
                  if (filterSecondary !== 'ALL' && t.secondaryCategory !== filterSecondary) return false;
                  if (isSuperuserSession && filterScientist !== 'ALL' && !getTestScientists(t).includes(filterScientist)) return false;
                  if (filterType !== 'ALL' && testLabel !== filterType) return false;
                  if (filterCompound !== 'ALL' && !flatCompounds.includes(filterCompound)) return false;
                  if (filterPlasmid !== 'ALL' && !flatPlasmids.includes(filterPlasmid)) return false;
                  if (filterCellLine !== 'ALL' && (!t.cellLines || !t.cellLines.includes(filterCellLine))) return false;
                  if (filterProject !== 'ALL' && !(t.projectNames || []).includes(filterProject)) return false;

                  if (showAdvanced) {
                    const testStr = JSON.stringify(t).toLowerCase();
                    if (filterSolvent !== 'ALL' && !testStr.includes(String(filterSolvent).toLowerCase())) return false;
                    if (filterBuffer !== 'ALL' && !testStr.includes(String(filterBuffer).toLowerCase())) return false;
                    if (filterAdditive !== 'ALL' && !testStr.includes(String(filterAdditive).toLowerCase())) return false;
                    if (filterInstrument !== 'ALL' && !testStr.includes(String(filterInstrument).toLowerCase())) return false;
                    if (filterProbe !== 'ALL' && !testStr.includes(String(filterProbe).toLowerCase())) return false;
                    if (filterPulseSeq !== 'ALL' && !testStr.includes(String(filterPulseSeq).toLowerCase())) return false;
                  }

                  if (bestOnly && !t.bestMeasurement) return false;
                  if (searchQuery && !JSON.stringify(t).toLowerCase().includes(searchQuery.toLowerCase())) return false;

                  return true;
                });

                // Notebook-style sorting.
                if (sortBy === 'date_desc') filteredTestsRaw.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
                else if (sortBy === 'date_asc') filteredTestsRaw.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
                else if (sortBy === 'name') filteredTestsRaw.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                else if (sortBy === 'type') filteredTestsRaw.sort((a, b) => (a.type || '').localeCompare(b.type || ''));

                const filteredTests = [];
                const seenTestNames = new Set();

                filteredTestsRaw.forEach((t) => {
                  if (!seenTestNames.has(t.name)) {
                    seenTestNames.add(t.name);
                    filteredTests.push(t);
                  }
                });

                // ── Project-required experiment creation ─────────────────────
                // Experiments must ALWAYS belong to at least one Project. The
                // +<type> buttons below go through this helper, which refuses to
                // create an experiment without a project:
                //   1. no projects at all     → jump to the Projects view,
                //   2. a project filter is on → use that project,
                //   3. exactly one project    → use it automatically,
                //   4. several projects      → ask which project to use.
                const createExperimentInProject = (type) => {
                  const projectNames = [...new Set(
                    (loadProjects() || [])
                      .map((p) => String(p && p.name || '').trim())
                      .filter(Boolean)
                  )];
                  if (projectNames.length === 0) {
                    window.alert('You need at least one Project before creating an Experiment.\n\nCreate a Project first (Projects → New Project), then add this experiment inside it.');
                    setCurrentModule('projects');
                    return;
                  }
                  let chosen = '';
                  if (filterProject !== 'ALL' && projectNames.includes(filterProject)) chosen = filterProject;
                  else if (projectNames.length === 1) chosen = projectNames[0];
                  else {
                    const answer = window.prompt(
                      `Choose the Project that will own this experiment:\n\n${projectNames.map((n) => `- ${n}`).join('\n')}\n\nType the project name:`
                    );
                    if (!answer) return;
                    const match = projectNames.find((n) => n.toLowerCase() === String(answer).trim().toLowerCase());
                    if (!match) { window.alert('Unknown project — experiment not created.'); return; }
                    chosen = match;
                  }
                  const id = 't' + Date.now() + Math.floor(Math.random() * 1e4);
                  const created = createEmptyTest(id, tests.length + 1, type);
                  created.projectNames = [chosen];
                  setTests((prev) => [...prev, created]);
                  setActiveTestId(id);
                  setCurrentModule('active-test');
                };

                return (
                  <div className="p-4 md:p-6 h-full flex flex-col overflow-y-auto custom-scrollbar">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-3 gap-2 border-b border-slate-200 pb-2">
                      <div>
                        <h2 className="text-lg md:text-xl font-black text-slate-800">
                          Experiments
                        </h2>

                        <p className="text-xs text-slate-500">
                          Manage experimental plates, spectroscopic data, cloning, protein purification, and MD simulations.
                        </p>
                      </div>

<div className="flex flex-wrap gap-1.5 no-print w-full md:w-auto">
  <button
    onClick={handlePrint}
    className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-1.5 px-3 rounded-lg text-xs transition-colors flex items-center justify-center gap-1.5 shadow-sm flex-1 md:flex-none"
  >
    🖨️ PDF
  </button>

  <button
    onClick={() => {
      createExperimentInProject('cloning');
    }}
    className="bg-teal-600 hover:bg-teal-700 text-white font-bold py-1.5 px-3 rounded text-xs transition-colors flex-1 md:flex-none"
  >
    + Cloning
  </button>

  <button
    onClick={() => {
      createExperimentInProject('protein_expression');
    }}
    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1.5 px-3 rounded text-xs transition-colors flex-1 md:flex-none"
  >
    + Expression & Purification
  </button>

  <button
    onClick={() => {
      createExperimentInProject('plate-96');
    }}
    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-1.5 px-3 rounded text-xs transition-colors flex-1 md:flex-none"
  >
    + Multiwell Plate tests
  </button>
  <button
onClick={() => {
createExperimentInProject('flow_cytometry');
}}
className="bg-pink-600 hover:bg-pink-700 text-white font-bold py-1.5 px-3 rounded text-xs transition-colors flex-1 md:flex-none"
>
+ Flow Cytometry
</button>
<button
onClick={() => {
createExperimentInProject('microscopy');
}}
className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-1.5 px-3 rounded text-xs transition-colors flex-1 md:flex-none"
>
+ Microscopy
</button>

<button
onClick={() => {
createExperimentInProject('cd');
}}
className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-1.5 px-3 rounded text-xs transition-colors flex-1 md:flex-none"
>
+ CD
</button>
<button
onClick={() => {
createExperimentInProject('ssnmr');
}}
className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1.5 px-3 rounded text-xs transition-colors flex-1 md:flex-none"
>
+ ssNMR
</button>
<button
onClick={() => {
createExperimentInProject('nmr');
}}
className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1.5 px-3 rounded text-xs transition-colors flex-1 md:flex-none"
>
+ NMR
</button>

  <button
    onClick={() => {
      createExperimentInProject('nmr-fittings');
    }}
    className="bg-amber-600 hover:bg-amber-700 text-white font-bold py-1.5 px-3 rounded text-xs transition-colors flex-1 md:flex-none"
  >
    + NMR Fittings
  </button>

  <button
    onClick={() => {
      createExperimentInProject('dosy');
    }}
    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1.5 px-3 rounded text-xs transition-colors flex-1 md:flex-none"
  >
    + DOSY
  </button>

  <button
    onClick={() => {
      createExperimentInProject('md_simulation');
    }}
    className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-1.5 px-3 rounded text-xs transition-colors flex-1 md:flex-none"
  >
    + MD Simulations
  </button>
  <button
    onClick={() => {
      createExperimentInProject('docking');
    }}
    className="bg-rose-600 hover:bg-rose-700 text-white font-bold py-1.5 px-3 rounded text-xs transition-colors flex-1 md:flex-none"
  >
    + Docking
  </button>
</div>
                    </div>

                    <div className="bg-white p-2.5 rounded-xl shadow-sm border border-slate-200 mb-3 flex flex-col gap-3 shrink-0 no-print">
                      {/* TOP CONTROLS — identical to the Lab Notebook */}
                      <div className="flex flex-wrap gap-3 items-end">
                        <div className="flex-1 min-w-[200px]">
                          <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Search</label>
                          <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search all fields..." className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Sort</label>
                          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500">
                            <option value="date_desc">Date (newest)</option>
                            <option value="date_asc">Date (oldest)</option>
                            <option value="name">Name</option>
                            <option value="type">Type</option>
                          </select>
                        </div>
                        <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer pb-2">
                          <input type="checkbox" checked={bestOnly} onChange={(e) => setBestOnly(e.target.checked)} className="accent-amber-600 w-4 h-4" />
                          ⭐ Best Only
                        </label>
                        {(filterActive || searchQuery || bestOnly) && (
                          <button
                            type="button"
                            onClick={clearAllFilters}
                            className="px-2.5 py-1.5 border rounded-lg text-xs font-bold text-red-600 border-red-200 bg-red-50 hover:bg-red-100 shadow-sm mb-1"
                          >
                            Clear filters
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setExpandedGroups((p) => ({ ...p, showTestCatMgr: !showCatMgr }))}
                          className={`px-2.5 py-1.5 border rounded-lg text-xs font-bold transition-colors shadow-sm mb-1 ${showCatMgr ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-slate-50 border-slate-300 text-slate-600 hover:bg-slate-100'}`}
                          title="Manage Categories"
                        >
                          <Icon name="gear" size={16} />
                        </button>
                      </div>

                      {/* MAIN FILTERS — same grid as the Lab Notebook */}
                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Main classification</label>
                          <select value={filterPrimary} onChange={(e) => { setFilterPrimary(e.target.value); setFilterSecondary('ALL'); }} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
                            <option value="ALL">All</option>
                            {primaryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Sub-classification</label>
                          <select value={filterSecondary} onChange={(e) => setFilterSecondary(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
                            <option value="ALL">All</option>
                            {secondaryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        {isSuperuserSession && (
                          <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Scientist</label>
                            <select value={filterScientist} onChange={(e) => setFilterScientist(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
                              <option value="ALL">All</option>
                              {allScientists.map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          </div>
                        )}
                        {allProjects.length > 0 && (
                          <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Project</label>
                            <select value={filterProject} onChange={(e) => setFilterProject(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
                              <option value="ALL">All</option>
                              {allProjects.map((o) => <option key={o} value={o}>📁 {o}</option>)}
                            </select>
                          </div>
                        )}
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Experiment type</label>
                          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
                            <option value="ALL">All</option>
                            {EXPERIMENT_TYPES.map((label) => <option key={label} value={label}>{label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Compound</label>
                          <SearchableSelect
                            value={filterCompound}
                            onChange={(v) => setFilterCompound(v)}
                            options={allCmpds || []}
                            placeholder="All"
                            onClear={() => setFilterCompound('ALL')}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Plasmid</label>
                          <SearchableSelect
                            value={filterPlasmid}
                            onChange={(v) => setFilterPlasmid(v)}
                            options={allPlasmids || []}
                            placeholder="All"
                            onClear={() => setFilterPlasmid('ALL')}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Cell Line</label>
                          <SearchableSelect
                            value={filterCellLine}
                            onChange={(v) => setFilterCellLine(v)}
                            options={allCellLines || []}
                            placeholder="All"
                            onClear={() => setFilterCellLine('ALL')}
                          />
                        </div>
                      </div>

                      {/* ADVANCED FILTERS toggle */}
                      <div>
                        <button onClick={() => setShowAdvanced(!showAdvanced)} className="text-xs font-bold text-blue-600 underline">
                          {showAdvanced ? 'Hide Advanced Filters' : 'Show Advanced Filters'}
                        </button>
                      </div>

                      {showAdvanced && (
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 bg-slate-50 p-2 rounded border border-slate-200">
                          <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Solvent</label>
                            <select value={filterSolvent} onChange={(e) => setFilterSolvent(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none">
                              <option value="ALL">All</option>{allSolvents.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Buffer</label>
                            <select value={filterBuffer} onChange={(e) => setFilterBuffer(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none">
                              <option value="ALL">All</option>{allBuffers.map((b) => <option key={b} value={b}>{b}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Additive</label>
                            <select value={filterAdditive} onChange={(e) => setFilterAdditive(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none">
                              <option value="ALL">All</option>{allAdditives.map((a) => <option key={a} value={a}>{a}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Instrument</label>
                            <select value={filterInstrument} onChange={(e) => setFilterInstrument(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none">
                              <option value="ALL">All</option>{allInstruments.map((i) => <option key={i} value={i}>{i}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">NMR Probe</label>
                            <select value={filterProbe} onChange={(e) => setFilterProbe(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none">
                              <option value="ALL">All</option>{allProbes.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">NMR Pulse Sequence</label>
                            <select value={filterPulseSeq} onChange={(e) => setFilterPulseSeq(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none">
                              <option value="ALL">All</option>{allPulseSeqs.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                          </div>
                        </div>
                      )}

                      {/* Category manager (independent from the filters) */}
                      {showCatMgr && (
                        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 flex flex-col gap-3">
                          <h4 className="text-xs font-bold text-slate-500 uppercase">Manage Test Categories</h4>
                          <div className="flex flex-col md:flex-row gap-2">
                            <input
                              type="text"
                              placeholder="New category name..."
                              value={newCatInput}
                              onChange={(e) => setExpandedGroups((p) => ({ ...p, newTestCatInput: e.target.value }))}
                              className="flex-1 border border-slate-300 rounded px-2.5 py-1.5 text-xs outline-none focus:border-blue-500"
                            />
                            <button
                              onClick={() => {
                                const v = newCatInput.trim();
                                if (v && !testCategories.includes(v)) {
                                  setTestCategories([...testCategories, v]);
                                  setExpandedGroups((p) => ({ ...p, newTestCatInput: '' }));
                                }
                              }}
                              className="bg-blue-600 text-white font-bold px-3 py-1.5 rounded text-xs shadow-sm hover:bg-blue-700 transition-colors"
                            >
                              Add Category
                            </button>
                          </div>
                        </div>
                      )}
                    </div>


                    <div className="md:flex-1 md:overflow-y-auto md:min-h-0 custom-scrollbar">
                      {filteredTests.length === 0 ? (
                        <div className="text-center py-10 text-slate-400 italic">
                          No tests match your filters.
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                          {filteredTests.map((test) => {
                            const locked = isTestLocked(test);
                            return (
                            <div
                              key={test.id}
                              className={`bg-white border rounded-xl p-2.5 shadow-sm transition-all flex flex-col group relative overflow-hidden ${
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
                                    if (test.pendingDeletion) {
                                      // Superuser approves the pending request; a requester just sees the badge.
                                      if (isSuperuserSession && window.confirm(`Approve deletion of "${test.name}"?`)) approveDeletion(test);
                                    } else if (isSuperuserSession) {
                                      if (window.confirm(`Delete "${test.name}" definitively?`)) approveDeletion(test);
                                    } else {
                                      if (window.confirm(`Request supervisor approval to delete "${test.name}"?`)) requestDeletion(test);
                                    }
                                  }}
                                  className="absolute top-2 right-9 text-slate-300 hover:text-red-500 text-base opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity no-print z-10"
                                  title={test.pendingDeletion
                                    ? (isSuperuserSession ? 'Approve deletion request' : 'Deletion requested — awaiting supervisor approval')
                                    : (isSuperuserSession ? 'Delete test' : 'Request deletion (supervisor approval required)')}
                                >
                                  {test.pendingDeletion && !isSuperuserSession ? '⏳' : '×'}
                                </button>
                              )}

<div className="absolute top-2 right-2 opacity-80 group-hover:scale-110 transition-transform text-blue-500">
<Icon name={TEST_CARD_ICON[test.type] || 'flask'} size={22} />
</div>

                              <span className="text-[10px] font-black uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-0.5 rounded self-start mb-1.5 border border-blue-100">
                                {test.testCategory || 'Uncategorized'}
                              </span>

                              <h3 className="font-bold text-slate-800 text-sm truncate pr-8">
                                {test.name} {test.bestMeasurement && '⭐'}
                              </h3>

                              <p className="text-[11px] text-slate-500 mt-0.5">
                                Instance: {test.instanceName || 'Primary'}
                              </p>

                              {test.operator && (
                                <p className="text-[11px] text-slate-400 mt-0.5">
                                  🧪 {[test.operator, ...(test.coScientists || [])].join(', ')}
                                </p>
                              )}

                              {(test.projectNames || []).length > 0 && (
                                <p className="text-[11px] text-violet-600 mt-0.5 flex flex-wrap gap-1">
                                  {(test.projectNames || []).map((pn) => (
                                    <span key={pn} className="bg-violet-50 border border-violet-200 rounded-full px-1.5 py-0.5 text-[9px] font-bold">
                                      📁 {pn}
                                    </span>
                                  ))}
                                </p>
                              )}

                              <div className="mt-2 pt-1.5 border-t border-slate-100 flex justify-between items-center text-[10px] text-slate-500 font-medium">
                                <span>📅 {test.date}</span>
<span className="bg-slate-100 px-2 py-0.5 rounded font-bold text-slate-600">
{test.type === 'nmr-fittings' ? 'NMR FITTINGS'
: test.type === 'dosy' ? 'DOSY'
: test.type === 'md_simulation' ? 'MD'
: test.type === 'protein_expression' ? 'PROTEIN'
: test.type === 'ssnmr' ? 'SSNMR'
: test.type === 'docking' ? 'DOCKING'
: test.type === 'flow_cytometry' ? 'FLOW'
: String(test.type || '').replace('plate-', '').toUpperCase()}
</span>
                              </div>

                              {/* ⏳ Pending deletion request badge */}
                              {test.pendingDeletion && (
                                <div className="absolute bottom-2 left-2 right-2 z-10 flex items-center gap-1.5 bg-amber-50 border border-amber-300 text-amber-800 text-[10px] font-bold px-2 py-1 rounded-lg shadow-sm">
                                  <Icon name="clock" size={12} /> Deletion requested by {test.deletionRequestedBy || 'a user'}
                                  {isSuperuserSession && (
                                    <>
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); if (window.confirm(`Approve deletion of "${test.name}"?`)) approveDeletion(test); }}
                                        className="ml-auto bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-0.5 rounded font-bold"
                                        title="Approve and delete this test"
                                      >✓ Approve</button>
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); rejectDeletion(test); }}
                                        className="bg-white hover:bg-slate-100 border border-slate-300 text-slate-600 px-2 py-0.5 rounded font-bold"
                                        title="Reject the deletion request"
                                      >✕ Reject</button>
                                    </>
                                  )}
                                </div>
                              )}

                              {/* 🔒 Lock overlay */}
                              {locked && (
                                <div className="absolute inset-0 bg-white/80 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2 rounded-xl">
                                  <div className="text-slate-400"><Icon name="lock" size={36} /></div>
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

