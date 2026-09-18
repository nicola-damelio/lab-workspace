// Validates the rule "the figures of a project are visible only to the people
// who have access to that project — in the Image Builder too".
//
// WHAT WENT WRONG
// A figure captured on an experiment, or a canvas composed in the builder, is
// stored in THAT PROJECT's image library (localStorage `labFiguresLib_<id>`
// plus the cloud <project>/images folder, see utils/figuresLibrary.js). The
// Image Builder browsed EVERY project library it found — its own Project
// select listed all projects of the workspace and the Project tab read
// readProjectLibrary(activeLibProjectId) with no access check — so on a shared
// browser (several operator accounts, shared workspace) a user who cannot even
// open project X could browse, load, re-save and DELETE the figures of X.
//
// THE FIX
// • projectsModule exports the single source of truth for project access:
//   projectAccessFor(project, user, isSuper) → 'modify' | 'view' | null and
//   visibleProjectsFor(projects, user, isSuper) → the projects of that user.
// • The Image Builder receives `currentUser` (App → ImageBuilderModule → the
//   builder), only offers the projects of that user, reads a project library
//   through figuresLibrary.readVisibleProjectLibrary() ([] when the project is
//   not theirs) and refuses the WRITE side of a project they can only 'view'.
// • figuresLibrary keeps its raw read/write API unfiltered (a write based on a
//   filtered list would erase the entries it cannot see) and applies the filter
//   to the display/cleanup paths only.
// • The project page lists its saved canvases only when the user has access.
//
// The components cannot be imported here (JSX modules), so the rules under test
// are mirrored verbatim from the sources — keep both in sync.
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PM = read('src/components/AppModules/projectsModule.jsx');
const LIB = read('src/utils/figuresLibrary.js');
const IB = read('src/components/ImageBuilder.jsx');
const PD = read('src/components/AppModules/projectDetailModule.jsx');
const MISC = read('src/components/AppModules/miscModules.jsx');
const APP = read('src/App.jsx');

const results = [];
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push({ name, got: String(got), want: String(want), ok });
  return ok;
};
const checkTrue = (name, got) => check(name, !!got, true);
const frag = (name, hay, needle) => checkTrue(`${name}: ${needle.slice(0, 44)}…`, hay.includes(needle));

// ===========================================================================
// 1) The access rules exist once and are used by the figures code
// ===========================================================================
frag('[projectsModule] one access rule per project', PM, 'export const projectAccessFor = (project, userName, isSuper = false) => {');
frag('[projectsModule] one list of the projects of a user', PM, 'export const visibleProjectsFor = (projects, userName, isSuper = false) => {');
frag('[projectsModule] the rule mirrors the project page (owner/super = modify)', PM, "if (isSuper || String(project.scientist || '') === name) return 'modify';");
frag('[projectsModule] a coworker keeps its own permission', PM, "return coworker.permission === 'view' ? 'view' : 'modify';");

frag('[figuresLibrary] a guarded read for display', LIB, 'export const readVisibleProjectLibrary = (projectId, allowedProjectIds = null) => {');
frag('[figuresLibrary] hidden project → empty list', LIB, 'return allowed(projectId) ? readProjectLibrary(projectId) : [];');
frag('[figuresLibrary] the raw API stays unfiltered', LIB, 'export const readProjectLibrary = (projectId) => withCanvasNames(memProjectList(projectId));');
frag('[figuresLibrary] the duplicate scan can be limited', LIB, 'export const findRecaptureDuplicates = ({ allowedProjectIds = null } = {}) => {');
frag('[figuresLibrary] …and skips other teams', LIB, "if (allowed && !allowed(pid)) return; // another team's project library");

frag('[ImageBuilder] the builder knows who is looking', IB, 'onBackToProject, currentUser = null }) => {');
frag('[ImageBuilder] only the projects of that user are offered', IB, 'const myProjects = visibleProjectsFor(allProjects, myName, isSuper);');
frag('[ImageBuilder] …and their ids drive the library reads', IB, 'const myProjectIds = myProjects.map((p) => p.id);');
frag('[ImageBuilder] the Project tab is filtered', IB, '? readVisibleProjectLibrary(activeLibProjectId, myProjectIds)');
frag('[ImageBuilder] pixels are never read out of a hidden project', IB, "if (scope === 'project' && !canSeeLibProject(pid)) continue;");
frag('[ImageBuilder] the style audit skips hidden projects', IB, 'figureStyleAudit(objects, styleTag, projectId, canSeeLibProject)');
frag('[ImageBuilder] a hidden project cannot stay selected', IB, 'if (libProjectId && !canSeeLibProject(libProjectId)) setLibProjectId(null);');
frag('[ImageBuilder] the empty grid explains the lock', IB, 'const libProjectBlocked = libraryTab');
frag('[ImageBuilder] the reader is told why nothing is listed', IB, 'figures are private to its team.');

frag('[ImageBuilder] publishing into a project needs edit access', IB, 'if (target && !canWriteLibProject(target)) return null;');
frag('[ImageBuilder] uploading into a project needs edit access', IB, 'private to its team — you cannot add images here.');
frag('[ImageBuilder] renaming/deleting a project figure too', IB, 'You do not have edit access to that project');
frag('[ImageBuilder] transferring into a project needs edit access to THAT project', IB, 'if (!canWriteLibProject(destProjectId)) {');
frag('[ImageBuilder] …and moving one OUT needs it on the project left', IB, '} else if (!canWriteLibProject(srcProjectId)) {');
frag('[ImageBuilder] an insert writes only into an editable project', IB, "if (!canWriteLibProject(insertTarget.projectId)) { setInsertMsg('");
frag('[ImageBuilder] restoring a canvas of a hidden project is refused', IB, 'if (fromProject && !canSeeLibProject(fromProject)) {');
frag('[ImageBuilder] opening a requested canvas of a hidden project too', IB, 'if (projectId && !canSeeLibProject(projectId)) {');
frag('[ImageBuilder] cleanup only touches the projects of that user', IB, 'removeRecaptureDuplicates({ allowedProjectIds: myProjectIds })');
frag('[ImageBuilder] the count is limited the same way', IB, 'countRecaptureDuplicates({ allowedProjectIds: myProjectIds })');
frag('[ImageBuilder] insert offers only editable projects', IB, 'No project you can edit');
frag('[ImageBuilder] browser offers the projects of the user', IB, '{myProjects.map((p) => <option key={p.id} value={p.id}>{p.name}');
frag('[ImageBuilder] …and flags the ones that cannot receive a figure', IB, "{canWriteLibProject(p.id) ? '' : ' 🔒 read-only'}");
frag('[ImageBuilder] save dialog offers only editable projects', IB, '{myWritableProjects.map((p) => <option key={p.id} value={p.id}>');

frag('[projectDetail] saved canvases need access to the project', PD, 'if (!projectAccessFor(project, myName, isSuper)) return [];');

// ===========================================================================
// 2) Mirrors of the real rules — behaviour
// ===========================================================================
// Mirror of projectsModule.normalizeAuthorized
const normalizeAuthorized = (list) => {
  if (!Array.isArray(list)) return [];
  return list.map((x) => {
    if (typeof x === 'string') return { name: x, permission: 'modify' };
    const perm = x && (x.permission === 'view' || x.permission === 'modify') ? x.permission : 'modify';
    return { name: x && x.name, permission: perm };
  }).filter((x) => x && String(x.name).trim());
};

// Mirror of projectsModule.projectAccessFor
const projectAccessFor = (project, userName, isSuper = false) => {
  const name = String(userName || '');
  if (!project || !name.trim()) return null;
  if (isSuper || String(project.scientist || '') === name) return 'modify';
  const coworker = normalizeAuthorized(project.authorizedPeople || [])
    .find((c) => String(c.name) === name);
  if (!coworker) return null;
  return coworker.permission === 'view' ? 'view' : 'modify';
};

// Mirror of projectsModule.visibleProjectsFor
const visibleProjectsFor = (projects, userName, isSuper = false) => {
  const list = Array.isArray(projects) ? projects.filter(Boolean) : [];
  if (isSuper) return list;
  return list.filter((p) => projectAccessFor(p, userName, false) !== null);
};

// Mirror of figuresLibrary.allowedProjectFilter + readVisibleProjectLibrary
const allowedProjectFilter = (allowedProjectIds) => {
  if (allowedProjectIds == null) return null;
  if (typeof allowedProjectIds === 'function') return allowedProjectIds;
  const set = allowedProjectIds instanceof Set ? allowedProjectIds : new Set(allowedProjectIds);
  return (projectId) => set.has(projectId);
};
const visibleLibrary = (store, projectId, allowedProjectIds = null) => {
  // Mirror of figuresLibrary.projectLibraryKey(): no project → the 'global' key.
  const readLib = (pid) => store[pid == null || pid === '' ? 'global' : pid] || [];
  if (projectId == null || projectId === '') return readLib(projectId);
  const allowed = allowedProjectFilter(allowedProjectIds);
  if (!allowed) return readLib(projectId);
  return allowed(projectId) ? readLib(projectId) : [];
};

const P1 = {
  id: 'P1', name: 'Kinetics', scientist: 'Anna',
  authorizedPeople: [{ name: 'Bob', permission: 'modify' }, { name: 'Cara', permission: 'view' }]
};
const P2 = { id: 'P2', name: 'Docking', scientist: 'Dan', authorizedPeople: [] };
const PROJECTS = [P1, P2];

// Two project libraries + the shared dataset one (a guest must still see the
// shared library: it belongs to no project).
const STORE = {
  P1: [{ id: 'f1', label: 'P1 figure' }],
  P2: [{ id: 'f2', label: 'P2 figure' }],
  global: [{ id: 'g1', label: 'dataset figure' }]
};

// What the builder would offer a user (the projects) and list (their figures).
const scopesOf = (user, isSuper = false) => {
  const visible = visibleProjectsFor(PROJECTS, user, isSuper);
  const ids = visible.map((p) => p.id);
  return { ids, seen: ids.flatMap((pid) => visibleLibrary(STORE, pid, ids).map((i) => i.id)) };
};

// The owner of P1 sees P1 only.
check('P1 owner → P1 only', scopesOf('Anna'), { ids: ['P1'], seen: ['f1'] });
// A coworker with edit rights, same.
check('P1 co-worker (modify) → P1 only', scopesOf('Bob'), { ids: ['P1'], seen: ['f1'] });
// A READ-ONLY coworker sees the figures, but must not write into the project.
check('P1 co-worker (view) → can read P1', scopesOf('Cara'), { ids: ['P1'], seen: ['f1'] });
check('P1 co-worker (view) → permission is view', projectAccessFor(P1, 'Cara'), 'view');
checkTrue('P1 co-worker (view) → no write right', projectAccessFor(P1, 'Cara') !== 'modify');
// The owner of P2 (another team) can NOT reach P1: this is the leak.
check('P2 owner → own project only', scopesOf('Dan'), { ids: ['P2'], seen: ['f2'] });
check('P2 owner → P1 library is EMPTY', visibleLibrary(STORE, 'P1', scopesOf('Dan').ids), []);
check('P2 owner → P1 access', projectAccessFor(P1, 'Dan'), null);
// A coworker listed only on P2 does not leak P1 either.
const P2b = { id: 'P2', name: 'Docking', scientist: 'Dan', authorizedPeople: [{ name: 'Elsa', permission: 'view' }] };
check('coworker of P2 → P1 is not theirs', projectAccessFor(P1, 'Elsa'), null);
check('coworker of P2 → list is empty', scopesOf('Elsa').seen, []);
check('coworker of P2 → own project visible', projectAccessFor(P2b, 'Elsa'), 'view');
// A superuser keeps every project (administrator).
check('superuser → every project', scopesOf('Zoe', true), { ids: ['P1', 'P2'], seen: ['f1', 'f2'] });
check('superuser → edit rights everywhere', projectAccessFor(P2, 'Zoe', true), 'modify');
// Nobody logged in (bootstrap / guest): no project library at all…
check('guest → no project', scopesOf(''), { ids: [], seen: [] });
check('guest → P1 access', projectAccessFor(P1, null), null);
check('guest → P1 library is empty', visibleLibrary(STORE, 'P1', []), []);
// …but the SHARED dataset library stays visible (it belongs to no project).
check('guest → shared library readable', visibleLibrary(STORE, null, []), [{ id: 'g1', label: 'dataset figure' }]);
check('guest → unassigned scope readable', visibleLibrary(STORE, '', []), [{ id: 'g1', label: 'dataset figure' }]);
check('no restriction asked → raw list', visibleLibrary(STORE, 'P1'), [{ id: 'f1', label: 'P1 figure' }]);
// The write side keeps using the UNFILTERED reader (a filtered list written
// back would erase the entries it cannot see).
check('raw reader is unfiltered (writes stay safe)', (STORE.P1 || []).map((i) => i.id), ['f1']);
// An old plain-string coworker entry still means full access.
check('legacy string coworker → modify', projectAccessFor({ id: 'P3', scientist: 'X', authorizedPeople: ['Bob'] }, 'Bob'), 'modify');
// A deleted / unknown project has no access and no library.
check('deleted project → no access', projectAccessFor(null, 'Anna'), null);
check('unknown project → empty library', visibleLibrary(STORE, 'PX', ['P1']), []);

const failed = results.filter((r) => !r.ok);
console.table(results.map((r) => ({ name: r.name, ok: r.ok, error: r.ok ? '' : r.got })));
if (failed.length) {
  console.error(`\n❌ ${failed.length}/${results.length} checks failed`);
  process.exit(1);
}
console.log(`\n✅ ${results.length}/${results.length} checks passed`);


frag('[App] the builder receives the current user', APP, 'projectId={currentProjectId} jumpToTest={jumpToTest} currentUser={currentUser}');
frag('[miscModules] …and forwards it to the builder', MISC, 'onBackToProject={onBackToProject} currentUser={currentUser} />');

frag('[figuresLibrary] the remover takes the same limit', LIB, 'export const removeRecaptureDuplicates = (opts = {}) => {');
