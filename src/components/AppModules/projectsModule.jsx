import React, { useState, useEffect, useMemo } from 'react';
import { markAttachmentsDeleted } from '../../utils/driveUpload';

/* =========================================================================
   PROJECTS — "Scientific background / Experiments / Discussion /
   Conclusions / Bibliography" workspace pages.
   Data is persisted in localStorage (same pattern as journals/papers).
   Rights: superusers see everything (filterable by scientist); each user
   sees only their own projects.
   ========================================================================= */

export const PROJECTS_KEY = 'labWorkspace_projects';

export const genProjectId = () => `prj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const normProjectName = (p) => String((p && p.name) || '').trim().toLowerCase();

/** Rough "how much content does this project hold" measure — used to keep the
 *  fullest copy when the same project (same id or same name) exists twice on a
 *  device (e.g. an empty duplicate created on a phone next to the real one from
 *  the PC). */
const projectSize = (p) => {
  try { return JSON.stringify(p).length; } catch { return 0; }
};

/** Collapse exact duplicates (same id) and same-name duplicates within the
 *  SAME dataset (different ids, e.g. the same project created once on the PC
 *  and once on a phone, each with its own generated id). For a duplicate pair
 *  the RICHER copy is kept at the position of the first occurrence (order is
 *  otherwise preserved). Same-named projects in DIFFERENT datasets stay apart:
 *  they are legitimate separate projects. */
const datasetNameKey = (p) =>
  `${String((p && p.datasetId) || '')}::${String((p && p.name) || '').trim().toLowerCase()}`;

const dedupeProjects = (list) => {
  const byId = new Map();      // id -> index in out
  const byName = new Map();    // dataset-scoped name key -> index in out
  const out = [];
  const add = (p) => { out.push(p); return out.length - 1; };
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const id = p.id;
    const nameKey = p && p.name ? datasetNameKey(p) : '';
    const idIdx = id ? byId.get(id) : -1;
    const nameIdx = nameKey ? byName.get(nameKey) : -1;
    if (idIdx >= 0) {
      if (projectSize(p) > projectSize(out[idIdx])) out[idIdx] = p;
      continue;
    }
    if (nameIdx >= 0) {
      if (projectSize(p) > projectSize(out[nameIdx])) {
        out[nameIdx] = p;
        if (id) byId.set(id, nameIdx);
      }
      continue;
    }
    const idx = add(p);
    if (id) byId.set(id, idx);
    if (nameKey) byName.set(nameKey, idx);
  }
  return out;
};

/* ------------------------------------------------------------------------
 * Per-dataset project scoping.
 *
 * Projects belong to the dataset they were created in. The localStorage store
 * below is a per-device cache of EVERY dataset's projects (all ids keep living
 * in the same key so nothing is lost when datasets are switched), but every
 * read is FILTERED to the active dataset scope: a project created in dataset A
 * can never show up in dataset B.
 *
 * App.jsx calls setProjectDatasetScope() whenever a dataset is opened, created
 * or left. When no dataset is open (explorer, bootstrap) the scope is null and
 * the historical global view is kept.
 * ------------------------------------------------------------------------ */
let activeProjectDataset = null;

/** Set (or clear, with null) the dataset whose projects are currently shown. */
export const setProjectDatasetScope = (datasetArg) => {
  activeProjectDataset = datasetArg ? String(datasetArg) : null;
};
/** Dataset id of the currently shown projects (null outside a dataset). */
export const getActiveProjectDataset = () => activeProjectDataset;

const readRawProjects = () => {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* ignore malformed */ }
  return [];
};
const writeRawProjects = (list) => {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(dedupeProjects(Array.isArray(list) ? list : [])));
  } catch { /* ignore */ }
};

/** Projects of one dataset — defaults to the currently open one. When no
 *  dataset scope is active the historical (global) list is returned. Legacy
 *  projects (not yet tagged to a dataset) only appear in that global view. */
export const loadProjects = (datasetArg) => {
  const datasetId = datasetArg != null ? String(datasetArg) : activeProjectDataset;
  const all = readRawProjects();
  if (!datasetId) return dedupeProjects(all);
  return dedupeProjects(all.filter((p) => p && String(p.datasetId) === datasetId));
};

/** Persist the projects of the ACTIVE dataset. The list is authoritative for
 *  that scope (a project removed from it is deleted), while projects of the
 *  other datasets and not-yet-adopted legacy projects are left untouched. */
export const saveProjects = (list) => {
  const safe = dedupeProjects(Array.isArray(list) ? list : []);
  if (!activeProjectDataset) {
    writeRawProjects(safe);
    return;
  }
  const all = readRawProjects();
  const tagged = safe.map((p) => ({
    ...p,
    datasetId: (p && String(p.datasetId)) || activeProjectDataset
  }));
  const merged = [
    ...all.filter((p) => !(p && String(p.datasetId) === activeProjectDataset)),
    ...tagged
  ];
  writeRawProjects(merged);
};

/** Remove every project of a dataset from this device's cache (dataset
 *  deletion). */
export const removeProjectsOfDataset = (datasetArg) => {
  const datasetId = datasetArg != null ? String(datasetArg) : null;
  if (!datasetId) return;
  try {
    const kept = readRawProjects().filter((p) => !(p && String(p.datasetId) === datasetId));
    writeRawProjects(kept);
  } catch { /* ignore */ }
};

/** Merge the projects carried by a dataset payload (cloud/HTML) into this
 *  device's cache without creating duplicates:
 *    • same id in the same dataset   → the richer copy wins
 *    • same name + dataset, diff. id → the same logical project → keep the
 *      RICHER of the two (an empty duplicate never replaces the full project)
 *  Projects already tagged to ANOTHER dataset are ignored here — they are
 *  re-added when that dataset is opened (they live in its own payload).
 *
 *  Legacy projects (created before per-dataset scoping, no `datasetId`) are
 *  attributed to a dataset as soon as one opens whose tests contain their
 *  linked experiment ids (`opts.testIds`). Projects that reference NO
 *  experiment at all cannot be attributed by their links: when
 *  `opts.adoptAllLegacy` is true they go to the first dataset opened after
 *  the upgrade (fallback chosen by the workspace owner). A legacy project
 *  with experiments that live in another dataset is left untagged until that
 *  dataset is opened. */
export const mergeProjectsFromCloud = (payloadProjects, opts = {}) => {
  const datasetId = opts.datasetId != null ? String(opts.datasetId) : activeProjectDataset;
  const testIds = opts.testIds instanceof Set
    ? opts.testIds
    : new Set((Array.isArray(opts.tests) ? opts.tests : []).map((t) => t && t.id).filter(Boolean));
  const adoptAllLegacy = !!opts.adoptAllLegacy;
  const payload = Array.isArray(payloadProjects) ? payloadProjects : [];

  const byId = new Map();
  const nameToId = new Map(); // dataset-scoped name → id
  readRawProjects().forEach((p) => {
    if (!p || typeof p !== 'object' || !p.id) return;
    byId.set(p.id, p);
    const nk = p && p.name ? datasetNameKey(p) : '';
    if (nk && !nameToId.has(nk)) nameToId.set(nk, p.id);
  });

  let changed = false;
  const remember = (p) => {
    const nk = p && p.name ? datasetNameKey(p) : '';
    const cur = byId.get(p.id);
    if (cur) {
      // A project tagged to another dataset can never be moved by this dataset.
      if (cur.datasetId && p.datasetId && cur.datasetId !== p.datasetId) return;
      // A legacy (untagged) payload copy never re-tags an already-tagged project.
      if (cur.datasetId && !p.datasetId) return;
      if (!cur.datasetId && p.datasetId) {
        // Adopt the cached copy (keep the richer of the two) into this dataset.
        const richer = projectSize(p) > projectSize(cur) ? p : cur;
        byId.set(p.id, { ...richer, datasetId: p.datasetId });
        if (nk) nameToId.set(nk, p.id);
        changed = true;
        return;
      }
      // Same scope (both tagged to the same dataset, or both legacy): richer copy wins.
      if (projectSize(p) > projectSize(cur)) {
        byId.set(p.id, p);
        if (nk) nameToId.set(nk, p.id);
        changed = true;
      }
      return;
    }
    // Same name within the SAME dataset, different id (project created on two
    // devices): keep the richer copy at the first occurrence.
    const twinId = nk ? nameToId.get(nk) : null;
    if (twinId && twinId !== p.id) {
      const twin = byId.get(twinId);
      if (twin && projectSize(twin) >= projectSize(p)) return;
      byId.delete(twinId);
      if (nk) nameToId.delete(nk);
    }
    byId.set(p.id, p);
    if (nk) nameToId.set(nk, p.id);
    changed = true;
  };

  payload.forEach((p) => {
    if (!p || typeof p !== 'object' || !p.id) return;
    const pDs = p.datasetId != null ? String(p.datasetId) : null;
    if (!datasetId) {
      // Unscoped (legacy) merge: only untagged payload projects participate.
      if (!pDs) remember(p);
      return;
    }
    if (pDs) {
      // Already tagged: only projects of THIS dataset belong here.
      if (pDs === datasetId) remember(p);
      return;
    }
    // Legacy project (no dataset): decide where it belongs.
    const cached = byId.get(p.id);
    if (cached && String((cached && cached.datasetId) || '') !== '' && String(cached.datasetId) !== datasetId) {
      return; // already claimed by another dataset
    }
    const experiments = Array.isArray(p.experiments) ? p.experiments : [];
    const linkedHere = experiments.some((e) => e && e.testId && testIds.has(e.testId));
    if (linkedHere) {
      // Its linked experiments exist in THIS dataset's tests → it belongs here.
      remember({ ...p, datasetId });
      return;
    }
    // No link found here. If the project has linked experiments at all, leave it
    // untagged for now: the dataset that contains those experiments will claim it
    // when it is opened. Only projects with NO experiment reference use the
    // fallback (adoptAllLegacy = "first dataset opened after the upgrade").
    if (experiments.length === 0 && adoptAllLegacy) remember({ ...p, datasetId });
  });

  if (changed) writeRawProjects(Array.from(byId.values()));
};

/** Normalize a project's authorized-people list to [{ name, permission }].
 *  Legacy entries stored as plain strings had full access → 'modify'.
 *  permission is 'view' (read-only) or 'modify' (can see and edit). */
export const normalizeAuthorized = (list) => {
  if (!Array.isArray(list)) return [];
  return list.map((x) => {
    if (typeof x === 'string') return { name: x, permission: 'modify' };
    const perm = x && (x.permission === 'view' || x.permission === 'modify') ? x.permission : 'modify';
    return { name: x && x.name, permission: perm };
  }).filter((x) => x && String(x.name).trim());
};

/** Map of projectName → permission ('view' | 'modify') for the given user,
 *  built from every project's authorizedPeople list. */
export const getProjectAccessForUser = (userName) => {
  const map = {};
  if (!userName) return map;
  try {
    loadProjects().forEach((p) => {
      if (!p || !p.name) return;
      normalizeAuthorized(p.authorizedPeople || []).forEach((a) => {
        if (String(a.name) === String(userName)) map[p.name] = a.permission || 'modify';
      });
    });
  } catch { /* ignore */ }
  return map;
};

/** The access level ('view' | 'modify') a user has on a test because it is
 *  linked to one of the projects they belong to, or null when none applies. */
export const testProjectAccess = (test, userName) => {
  if (!test || !userName) return null;
  const map = getProjectAccessForUser(userName);
  const names = Array.isArray(test.projectNames) ? test.projectNames : [];
  for (const pn of names) {
    if (map[pn]) return map[pn];
  }
  return null;
};

export const loadPublications = () => {
  try {
    const raw = localStorage.getItem('labWorkspace_publications');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* ignore malformed */ }
  return [];
};

/* Test types that can be added to a project's Experiments subsection
   (mirrors the "+ New test" buttons of Experiments). */
export const TEST_TYPE_OPTIONS = [
  { type: 'nmr', label: 'NMR', color: 'bg-emerald-600 hover:bg-emerald-700' },
  { type: 'ssnmr', label: 'ssNMR', color: 'bg-indigo-600 hover:bg-indigo-700' },
  { type: 'nmr-fittings', label: 'NMR Fittings', color: 'bg-amber-600 hover:bg-amber-700' },
  { type: 'dosy', label: 'DOSY', color: 'bg-violet-600 hover:bg-violet-700' },
  { type: 'cd', label: 'CD', color: 'bg-purple-600 hover:bg-purple-700' },
  { type: 'plate-96', label: 'Multiwell Plate', color: 'bg-blue-600 hover:bg-blue-700' },
  { type: 'plate-384', label: 'Multiwell Plate 384', color: 'bg-blue-500 hover:bg-blue-600' },
  { type: 'flow_cytometry', label: 'Flow Cytometry', color: 'bg-pink-600 hover:bg-pink-700' },
  { type: 'cloning', label: 'Cloning', color: 'bg-teal-600 hover:bg-teal-700' },
  { type: 'protein_expression', label: 'Expression & Purification', color: 'bg-cyan-600 hover:bg-cyan-700' },
  { type: 'md_simulation', label: 'MD Simulations', color: 'bg-sky-600 hover:bg-sky-700' },
  { type: 'docking', label: 'Docking', color: 'bg-rose-600 hover:bg-rose-700' }
];

export const testTypeLabel = (type) => {
  const found = TEST_TYPE_OPTIONS.find((o) => o.type === type);
  return found ? found.label : type;
};

const inputCls = 'border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm bg-white outline-none focus:border-blue-500 w-full';

/* =====================  LIST VIEW ===================== */
export const ProjectsModule = ({
  currentUser, handlePrint,
  setCurrentModule, setCurrentProjectId
}) => {
  const isSuper = currentUser?.role === 'superuser';
  const myName = currentUser?.name || '';
  const [projects, setProjects] = useState(loadProjects);
  const [scientistFilter, setScientistFilter] = useState('ALL');
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(() => { saveProjects(projects); }, [projects]);

  const scientists = useMemo(() =>
    [...new Set(projects.map((p) => p.scientist).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
  [projects]);

  const visible = useMemo(() => {
    let list = projects;
    if (!isSuper) {
      // The owner and every coworker (view OR modify) can see the project.
      list = list.filter((p) => {
        if (p.scientist === myName) return true;
        return normalizeAuthorized(p.authorizedPeople || []).some((c) => c.name === myName);
      });
    } else if (scientistFilter !== 'ALL') list = list.filter((p) => p.scientist === scientistFilter);
    return list;
  }, [projects, isSuper, myName, scientistFilter]);

  const createProject = () => {
    const name = newName.trim();
    if (!name) return;
    const now = new Date().toISOString();
    const prj = {
      id: genProjectId(),
      name,
      scientist: myName,
      // Projects belong to the dataset they are created in.
      datasetId: getActiveProjectDataset() || '',
      createdAt: now,
      updatedAt: now,
      background: '',
      discussion: '',
      conclusions: '',
      experiments: [],
      // Project-level reference documents (Google Drive …/projects/<project>/useful_files).
      usefulFiles: [],
      usefulFilesFolderUrl: '',
      bibliography: [],
      references: [],
      figures: { background: [], discussion: [], conclusions: [] },
      docs: { background: [], discussion: [], conclusions: [] },
      authorizedPeople: [],
      comments: [],
      figureCaptionOverrides: {}
    };
    const nextProjects = [...projects, prj];
    setProjects(nextProjects);
    saveProjects(nextProjects);
    setNewName('');
    setShowNewForm(false);
    setCurrentProjectId(prj.id);
    setCurrentModule('project-detail');
  };

  const deleteProject = (id) => {
    const target = projects.find((p) => p.id === id);
    const remaining = projects.filter((p) => p.id !== id);
    setProjects(remaining);
    saveProjects(remaining);
    setConfirmDelete(null);
    // Mark any Google Drive attachments of this project as deleted.
    if (target) markAttachmentsDeleted(target).catch(() => {});
  };

  // Edit access: owner, superuser, or a coworker with 'modify' permission.
  const canManage = (p) => isSuper || p.scientist === myName
    || normalizeAuthorized(p.authorizedPeople || []).some((c) => c.name === myName && c.permission === 'modify');
  // Deleting a project stays reserved for the owner / superuser.
  const canDelete = (p) => isSuper || p.scientist === myName;

  return (
    <div className="p-4 md:p-6 h-full overflow-y-auto custom-scrollbar bg-slate-50">
      <div className="max-w-6xl mx-auto flex flex-col gap-4 pb-10">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-2 border-b border-slate-200 pb-3">
          <div>
            <h2 className="text-lg md:text-xl font-black text-slate-800">📁 Projects</h2>
            <p className="text-xs text-slate-500">
              Scientific projects collecting background, linked experiments, discussion, conclusions and bibliography.
              Each project is a page whose text sections accept bibliographic references from the
              “Project bibliography” and “Publications of the scientist”.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 no-print">
            <button onClick={handlePrint}
                    className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-1.5 px-3 rounded-lg text-xs transition-colors shadow-sm">
              🖨️ PDF
            </button>
            {currentUser && (
              <button onClick={() => setShowNewForm((v) => !v)}
                      className={`font-bold py-1.5 px-3 rounded text-xs transition-colors ${showNewForm ? 'bg-slate-200 text-slate-700' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
                {showNewForm ? 'Cancel' : '+ New Project'}
              </button>
            )}
          </div>
        </div>



        {!currentUser && (
          <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-xl p-3 text-sm font-semibold">
            ⚠️ Log in to create and manage projects. Each scientist sees only their own projects.
          </div>
        )}

        {showNewForm && (
          <div className="bg-white border border-blue-200 rounded-xl shadow-sm p-4">
            <label className="text-xs font-bold text-slate-600 mb-1.5 block">Project name *</label>
            <div className="flex flex-col md:flex-row gap-2">
              <input className={inputCls} value={newName}
                     onChange={(e) => setNewName(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter') createProject(); }}
                     placeholder="e.g. Structure and dynamics of SAAP-148 in lipid bilayers" />
              <button onClick={createProject} disabled={!newName.trim()}
                      className="px-4 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
                Create project
              </button>
            </div>
            <div className="mt-2 text-xs text-slate-500">
              👤 Owner: <strong>{myName || '—'}</strong> — the project and its “Project bibliography” are visible to you
              {isSuper ? ' and, as a superuser, to everyone (with scientist filter).' : ' only (superusers see everything).'}
            </div>
          </div>
        )}

        {isSuper && (
          <div className="flex flex-wrap items-center gap-2 bg-white border border-slate-200 rounded-xl shadow-sm px-3 py-2.5 no-print">
            <label className="text-xs font-bold text-slate-600">Filter by scientist:</label>
            <select value={scientistFilter} onChange={(e) => setScientistFilter(e.target.value)}
                    className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 font-semibold text-slate-700">
              <option value="ALL">All scientists ({projects.length})</option>
              {scientists.map((s) => (
                <option key={s} value={s}>
                  {s} ({projects.filter((p) => p.scientist === s).length})
                </option>
              ))}
            </select>
          </div>
        )}

        {!isSuper && currentUser && (
          <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
            🧪 Showing your projects — <strong>{myName}</strong>
          </div>
        )}

        {visible.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center text-sm text-slate-400 italic">
            No projects yet{isSuper ? '' : ' for you'} — use “+ New Project” to create the first one.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {visible.map((p) => (
              <div key={p.id} className="bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md transition-shadow p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-black text-slate-800 leading-snug">{p.name}</div>
                    <div className="text-[10px] text-slate-400 font-semibold mt-0.5">
                      📅 {new Date(p.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5">
                    👤 {p.scientist || 'Unassigned'}
                  </span>
                  {(() => {
                    const cws = normalizeAuthorized(p.authorizedPeople || []);
                    return cws.length > 0 ? (
                      <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5" title={cws.map((c) => `${c.name} (${c.permission === 'modify' ? 'modify' : 'view'})`).join(', ')}>
                        👥 {cws.length}
                      </span>
                    ) : null;
                  })()}
                </div>
                <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500">
                  <span className="bg-slate-100 rounded-full px-2 py-0.5">🧪 {(p.experiments || []).length} experiments</span>
                  <span className="bg-slate-100 rounded-full px-2 py-0.5">📚 {(p.references || []).length} references</span>
                  {(() => {
                    const open = (p.comments || []).filter((c) => !c.resolved).length;
                    return open > 0 ? (
                      <span className="bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">💬 {open} open</span>
                    ) : null;
                  })()}
                </div>
                <div className="flex items-center gap-1.5 mt-auto pt-1 no-print">
                  <button onClick={() => { setCurrentProjectId(p.id); setCurrentModule('project-detail'); }}
                          className="flex-1 px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors">
                    Open project
                  </button>
                  {canManage(p) && (
                    <button onClick={() => { setCurrentProjectId(p.id); setCurrentModule('project-detail'); }}
                            className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200"
                            title="Edit">✏️</button>
                  )}
                  {canDelete(p) && (
                    <button onClick={() => setConfirmDelete(p.id)}
                            className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-red-50 text-red-500 hover:bg-red-100"
                            title="Delete project">✕</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {confirmDelete && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl p-5 max-w-sm w-full">
              <h3 className="text-sm font-black text-slate-800 mb-1">Delete project?</h3>
              <p className="text-xs text-slate-500 mb-4">
                “{projects.find((p) => p.id === confirmDelete)?.name}” and its bibliography will be permanently removed.
                Linked tests are kept.
              </p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setConfirmDelete(null)}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300">Cancel</button>
                <button onClick={() => deleteProject(confirmDelete)}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-red-600 text-white hover:bg-red-700">Delete</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

