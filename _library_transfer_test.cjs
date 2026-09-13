// Validates the FEATURE "an image can be moved to the common (dataset) library
// AND to a SPECIFIC project library — the two directions of the ⇄ button of the
// Image Library modal".
//
// WHAT WENT WRONG
// The ⇄ button moved an image to the "other" scope with an IMPLICIT destination:
// `libraryTab === 'project' ? activeLibProjectId : projectId` — i.e. the project
// the editor was opened with. The project list (which picks the library being
// browsed) was rendered only on the Project tab, so from the Dataset tab there
// was nothing to choose: with no project open (sidebar → Image Builder, or after
// "➕ New image"), moveLibraryItem('common', 'project', null, id) wrote the entry
// into the UNASSIGNED scope (`labFiguresLib_global`), which no project page and
// no Project tab ever lists again. The image left the dataset library and showed
// up nowhere → "I can move images to the common library but I cannot move them to
// a specific project" (and the write check tested the editor's own project, so a
// figure moved OUT of another project was checked against the wrong one).
//
// THE FIX (src/components/ImageBuilder.jsx)
// • the project list is shown in BOTH tabs — its value (`libProjectId`,
//   defaulting to the project of the editor) IS the transfer destination, so any
//   project the user may edit can receive the figure;
// • no destination picked → the move is REFUSED with a message instead of
//   silently landing in the unassigned scope;
// • leaving a project needs write access to the project LEFT, entering one to the
//   project ENTERED (they used to be the same, wrong, check);
// • read-only projects are marked 🔒 in the list and the move is announced.
//
// The component cannot be imported here (a JSX module), so its rules are mirrored
// verbatim from the sources — keep both in sync.
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const IB = read('src/components/ImageBuilder.jsx');
const LIB = read('src/utils/figuresLibrary.js');

const results = [];
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push({ name, got: String(got), want: String(want), ok });
  return ok;
};
const checkTrue = (name, got) => check(name, !!got, true);
const frag = (name, hay, needle) => checkTrue(`${name}: ${needle.slice(0, 44)}…`, hay.includes(needle));

// ===========================================================================
// 1) Mirrors of the two functions under test
// ===========================================================================
// figuresLibrary.moveLibraryItem — same semantics as the source: the entry is
// MOVED (the source list loses it), a null project id is the unassigned scope.
const STORE = { common: [], global: {}, P1: [], P2: [], P3: [] };
const readProjectLibrary = (pid) => (pid ? (STORE[pid] || []) : (STORE.global.list || []));
const writeProjectLibrary = (pid, items) => { if (pid) STORE[pid] = items; else STORE.global.list = items; };
const readLibrary = () => STORE.common;
const writeLibrary = (items) => { STORE.common = items; };
const moveLibraryItem = (fromScope, toScope, projectId, id) => {
  const src = fromScope === 'project' ? readProjectLibrary(projectId) : readLibrary();
  const it = src.find((i) => i.id === id);
  if (!it) return;
  if (toScope === 'project') writeProjectLibrary(projectId, [it, ...readProjectLibrary(projectId)]);
  else writeLibrary([it, ...readLibrary()]);
  if (fromScope === 'project') writeProjectLibrary(projectId, src.filter((i) => i.id !== id));
  else writeLibrary(src.filter((i) => i.id !== id));
};

// ImageBuilder.transferItem — the destination is explicit (libProjectId, then
// the project of the editor) and is checked before anything is written.
const access = { P1: 'modify', P2: 'modify', P3: 'view', '': 'modify' };
const canWrite = (pid) => (access[pid || ''] || null) === 'modify';
const scopeName = (pid) => (pid ? `“${pid}” project` : 'shared dataset');
const transferItem = ({ libraryTab, libProjectId = null, projectId = null, activeLibProjectId = null, item }) => {
  const from = libraryTab;
  const to = from === 'project' ? 'common' : 'project';
  const srcProjectId = activeLibProjectId;
  const destProjectId = libProjectId || projectId || null;
  if (to === 'project') {
    if (!destProjectId) return { moved: false, where: 'none', msg: 'pick the project' };
    if (!canWrite(destProjectId)) return { moved: false, where: 'none', msg: 'read-only' };
  } else if (!canWrite(srcProjectId)) {
    return { moved: false, where: 'none', msg: 'read-only' };
  }
  moveLibraryItem(from, to, to === 'project' ? destProjectId : srcProjectId, item.id);
  return { moved: true, where: to === 'project' ? destProjectId : 'common', scope: scopeName(to === 'project' ? destProjectId : null) };
};

const reset = () => {
  STORE.common = [
    { id: 'd1', label: 'dataset logo' },
    { id: 'd2', label: 'common figure' }
  ];
  STORE.global = {};
  STORE.P1 = [{ id: 'p1', label: 'P1 figure' }];
  STORE.P2 = [];
  STORE.P3 = [{ id: 'p3', label: 'P3 figure' }];
};
const commonIds = () => STORE.common.map((i) => i.id);
const libIds = (pid) => readProjectLibrary(pid).map((i) => i.id);
const unassignedIds = () => (STORE.global.list || []).map((i) => i.id);

// ===========================================================================
// 2) Dataset → project: THE regression (no project open, nothing picked)
// ===========================================================================
reset();
check('no project + nothing picked → refused',
  transferItem({ libraryTab: 'common', item: { id: 'd1' } }),
  { moved: false, where: 'none', msg: 'pick the project' });
check('…the image stays in the dataset library', commonIds(), ['d1', 'd2']);
check('…and NOTHING is written to the unassigned scope', unassignedIds(), []);

// The user picks the project → the image lands in THAT project.
reset();
check('picked project P2 → moved into P2',
  transferItem({ libraryTab: 'common', libProjectId: 'P2', item: { id: 'd1' } }),
  { moved: true, where: 'P2', scope: '“P2” project' });
check('…the P2 library got it', libIds('P2'), ['d1']);
check('…the dataset library lost it', commonIds(), ['d2']);
check('…still nothing in the unassigned scope', unassignedIds(), []);
check('…the other projects are untouched', [libIds('P1'), libIds('P3')], [['p1'], ['p3']]);

// Editor opened with a project, list untouched → that project is the default
// destination (what the old implicit rule did, now visible and changeable).
reset();
check('the project of the editor is the default destination',
  transferItem({ libraryTab: 'common', projectId: 'P1', item: { id: 'd2' } }),
  { moved: true, where: 'P1', scope: '“P1” project' });
check('…P1 library got it, in front', libIds('P1'), ['d2', 'p1']);
check('…the dataset library lost it', commonIds(), ['d1']);

// …and the PICKED project wins over the editor's own (the whole point).
reset();
check('the picked project overrides the editor project',
  transferItem({ libraryTab: 'common', libProjectId: 'P2', projectId: 'P1', item: { id: 'd1' } }).where, 'P2');
check('…the editor project (P1) is untouched', libIds('P1'), ['p1']);
check('…P2 holds the figure', libIds('P2'), ['d1']);

// A project the user may only read cannot receive the figure.
reset();
check('read-only P3 → refused',
  transferItem({ libraryTab: 'common', libProjectId: 'P3', item: { id: 'd1' } }),
  { moved: false, where: 'none', msg: 'read-only' });
check('…the image stays in the dataset library', commonIds(), ['d1', 'd2']);
check('…the P3 library is untouched', libIds('P3'), ['p3']);

// ===========================================================================
// 3) Project → dataset (the direction that worked) + its own write check
// ===========================================================================
reset();
check('a P1 figure → the dataset library',
  transferItem({ libraryTab: 'project', activeLibProjectId: 'P1', projectId: 'P1', item: { id: 'p1' } }),
  { moved: true, where: 'common', scope: 'shared dataset' });
check('…it is in the dataset library, in front', commonIds(), ['p1', 'd1', 'd2']);
check('…the P1 library lost it', libIds('P1'), []);

// The write check follows the project LEFT, not the editor's project (moving out
// of a read-only project used to be allowed because the editor's own one was ok).
reset();
check('a read-only P3 figure → moving it out is refused (writable editor project or not)',
  transferItem({ libraryTab: 'project', activeLibProjectId: 'P3', projectId: 'P1', item: { id: 'p3' } }),
  { moved: false, where: 'none', msg: 'read-only' });
check('…P3 keeps its figure', libIds('P3'), ['p3']);
check('…the dataset library is untouched', commonIds(), ['d1', 'd2']);

// The unassigned listing ("Current / no project") belongs to no project: moving
// one of its figures out to the dataset library is always allowed.
reset();
STORE.global.list = [{ id: 'u1', label: 'unassigned figure' }];
check('the unassigned scope → the dataset library',
  transferItem({ libraryTab: 'project', activeLibProjectId: null, item: { id: 'u1' } }).moved, true);
check('…it left the unassigned scope', unassignedIds(), []);
check('…and landed in the dataset library', commonIds(), ['u1', 'd1', 'd2']);

// ===========================================================================
// 4) moveLibraryItem semantics (the mirror of the real one)
// ===========================================================================
reset();
moveLibraryItem('common', 'project', 'P2', 'd1');
check('a move keeps the entry object (id/label/thumbs)', libIds('P2'), ['d1']);
check('a move does not leave a duplicate behind', commonIds(), ['d2']);
moveLibraryItem('project', 'common', 'P2', 'd1');
check('…and back again', { common: commonIds(), P2: libIds('P2') }, { common: ['d1', 'd2'], P2: [] });
moveLibraryItem('common', 'project', 'P2', 'nope');
check('an unknown entry changes nothing', { common: commonIds(), P2: libIds('P2') }, { common: ['d1', 'd2'], P2: [] });

// ===========================================================================
// 5) The sources really contain what the mirrors assert
// ===========================================================================
frag('[figuresLibrary] the move is a MOVE (the source list loses the entry)', LIB, 'export const moveLibraryItem = (fromScope, toScope, projectId, id) => {');
frag('[figuresLibrary] a null project id is the unassigned scope', LIB, "const projectLibraryKey = (projectId) => `labFiguresLib_${projectId || 'global'}`;");

frag('[ImageBuilder] the destination project is explicit', IB, 'const destProjectId = libProjectId || projectId || null;   // scope written to');
frag('[ImageBuilder] …and the scope left behind too', IB, 'const srcProjectId = activeLibProjectId;                  // scope left behind');
frag('[ImageBuilder] no destination → refused, never the unassigned scope', IB, "setLibMsg('📁 Pick the project this image goes to in the “Move into” list, then click ⇄ again.');");
frag('[ImageBuilder] entering a project checks THAT project', IB, 'if (!canWriteLibProject(destProjectId)) {');
frag('[ImageBuilder] leaving a project checks THAT project', IB, '} else if (!canWriteLibProject(srcProjectId)) {');
frag('[ImageBuilder] the move uses the explicit destination', IB, "moveLibraryItem(from, to, to === 'project' ? destProjectId : srcProjectId, item.id);");
frag('[ImageBuilder] the move is announced', IB, 'is now in the “${canvasScopeName(destProjectId)}” project library');
frag('[ImageBuilder] the project list is no longer Project-tab only', IB, "{libraryTab === 'project' ? 'Project' : 'Move into'}");
frag('[ImageBuilder] the Dataset tab asks for a project instead of guessing', IB, "<option value=\"global\">{libraryTab === 'project' ? 'Current / no project' : '— pick a project —'}</option>");
frag('[ImageBuilder] read-only projects are marked in the list', IB, "{p.name}{canWriteLibProject(p.id) ? '' : ' 🔒 read-only'}");
frag('[ImageBuilder] the ⇄ tooltip names the destination project', IB, 'Move this image into the “${canvasScopeName(activeLibProjectId)}” project library');
frag('[ImageBuilder] the ⇄ tooltip sends back to the dataset library', IB, 'Move this image to the shared dataset library (Image Library → Dataset tab)');

// The ⇄ button is still offered once per card, on both tabs (the feature tested).
check('⇄ is rendered once, for both tabs', (IB.match(/transferItem\(item\)/g) || []).length, 1);
// …and the old implicit destination is gone for good.
check('the old implicit destination is gone', IB.includes("libraryTab === 'project' ? activeLibProjectId : projectId, item.id)"), false);
check('the old "moving into a project" check on the editor project is gone', IB.includes('if (to === \'project\' && !canWriteLibProject(projectId)) {'), false);

const failed = results.filter((r) => !r.ok);
console.table(results.map((r) => ({ name: r.name, ok: r.ok, error: r.ok ? '' : `got ${r.got} · want ${r.want}` })));
if (failed.length) {
  console.error(`\n❌ ${failed.length}/${results.length} checks failed`);
  process.exit(1);
}
console.log(`\n✅ ${results.length}/${results.length} checks passed`);

