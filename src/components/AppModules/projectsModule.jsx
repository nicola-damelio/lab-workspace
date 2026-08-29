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

export const loadProjects = () => {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* ignore malformed */ }
  return [];
};

export const saveProjects = (list) => {
  try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
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
      createdAt: now,
      updatedAt: now,
      background: '',
      discussion: '',
      conclusions: '',
      experiments: [],
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

