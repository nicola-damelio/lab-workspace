// Validates the FEATURE "when an image is inserted into a project, the project
// keeps a link back to the Image Builder so the composition can be modified".
//
// Chain under test (keep the mirrors in sync with the sources):
//   ImageBuilder.jsx
//     • publishCanvas()            → stores the composition as a canvas of the
//       TARGET project's image library (scope/updateId rules mirrored below)
//     • the "📤 Insert into project…" handler → stamps the inserted figure with
//       { source:'image-builder', canvasId, builderProjectId, canvasLabel }
//   projectDetailModule.jsx
//     • openBuilderForFigure(fig)  → openImageBuilder(fig.builderProjectId ||
//       project.id, fig.canvasId || null)   (“✏️ Modify in Image Builder”)
//   App.jsx / ImageBuilder.jsx       → the request is honoured: the builder loads
//       that canvas from the project library and restores grid/objects/captions.
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const IB = read('src/components/ImageBuilder.jsx');
const PD = read('src/components/AppModules/projectDetailModule.jsx');
const APP = read('src/App.jsx');
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
// 1) The editor side: publishCanvas() + the insert handler stamps the link
// ===========================================================================
frag('[ImageBuilder] publishCanvas', IB, 'const publishCanvas = async ({ label, targetProjectId = projectId || null, dataUrl = null }) => {');
frag('[ImageBuilder] target scope', IB, `scope: target ? 'project' : 'common',`);
frag('[ImageBuilder] per-scope entry lookup (id kept, else the composition key)', IB, 'const known = canvasEntryFor(target);');
frag('[ImageBuilder] in-place update of THAT scope copy', IB, 'updateId: known ? known.id : null,');
frag('[ImageBuilder] scope key helper', IB, "const canvasScopeKey = (scopeProjectId) => scopeProjectId || 'dataset';");
frag('[ImageBuilder] entry remembered per scope', IB, 'rememberCanvasEntry(target, entry);');
frag('[ImageBuilder] snapshot carried by the canvas', IB, 'canvasW, canvasH, gridCols, gridRows, showPanelBorders, showGridLines, keepAspect, globalCaption,');
frag('[ImageBuilder] snapshot objects', IB, 'objects: (objects || []).map(thumbnailsOf)');
frag('[ImageBuilder] insert publishes to the target project', IB, 'const pub = await publishCanvas({ label, targetProjectId: prj.id, dataUrl });');
frag('[ImageBuilder] figure carries the link', IB, 'link = { canvasId: pub.entry.id, builderProjectId: prj.id, canvasLabel: pub.entry.label || label };');
frag('[ImageBuilder] link spread into the figure', IB, '...(link || {})');
frag('[ImageBuilder] legacy marker kept', IB, "source: 'image-builder',");
frag('[ImageBuilder] opt-out switch (on by default)', IB, 'const [insertLink, setInsertLink] = useState(true);');
frag('[ImageBuilder] opt-out checkbox', IB, 'checked={insertLink}');
frag('[ImageBuilder] the figure keeps its image (pushed as a normal figure)', IB, 'url: dataUrl,');
frag('[ImageBuilder] insert says the image stays in the section', IB, 'it stays visible in that section on');
frag('[ImageBuilder] "Save now" opens the destination dialog', IB, '<button onClick={openSaveDialog} title="Save the whole canvas now and choose WHICH PROJECT owns it');
frag('[ImageBuilder] save dialog proposes the canvas\' project', IB, `const own = [canvasHome, projectId, ...Object.keys(canvasEntries || {})]`);
frag('[ImageBuilder] save dialog lists every project', IB, '📁 {p.name} — its Project tab + “🖼 Saved canvases”');
frag('[ImageBuilder] save dialog has NO dataset library any more (canvases live in a project)',
  IB, '<option value="">— no project you may write to —</option>');
frag('[ImageBuilder] save goes to the CHOSEN destination', IB, 'const pub = await publishCanvas({ label, targetProjectId: destProjectId, dataUrl: null });');
frag('[ImageBuilder] save tells where it landed', IB, 'Image Library → Project tab — and on that project page under “🖼 Saved canvases”');
frag('[ImageBuilder] the library opens on the destination tab', IB, "setLibraryTab('project');");
frag('[ImageBuilder] the library opens on the destination project', IB, 'setLibProjectId(destProjectId);');
frag('[ImageBuilder] re-homing is announced', IB, 'Saving it here stores a');
frag('[ImageBuilder] render reused (no second render)', IB, 'const img = dataUrl || await renderToDataUrl(');
frag('[ImageBuilder] canvas badge shows the home scope', IB, 'const homeEntry = useMemo(');
frag('[ImageBuilder] bookkeeping is reset per canvas/project', IB, 'setCanvasEntries({});');
frag('[ImageBuilder] reset also re-homes the dialog default', IB, 'setCanvasHome(projectId || null);');
frag('[ImageBuilder] loading a canvas binds it to THAT library', IB, 'restoreCanvasFromItem(here.item, { confirm: false, scopeProjectId: here.scopeProjectId })');
frag('[ImageBuilder] …and a canvas whose list entry is missing is fetched from Drive', IB, 'res = await pullLibraryFromDrive(scopeInfo);');
frag('[ImageBuilder] library "Load" binds the browsed scope', IB, "restoreCanvasFromItem(item, { scopeProjectId: libraryTab === 'project' ? activeLibProjectId : null })");
frag('[projectDetail] the project page says the picture stays', PD, 'there — the link is added on top, it never replaces the picture.');

// A failed link publish must never lose the insert itself.
const insertBlock = IB.slice(IB.indexOf('const sec = insertTarget.section'), IB.indexOf('setInsertMsg(link'));
checkTrue('[ImageBuilder] link failure is caught (insert still happens)', /catch \(err\) \{\s*console\.warn\('Canvas link failed:'/.test(insertBlock));
checkTrue('[ImageBuilder] figure pushed even without a link', insertBlock.indexOf('prj.figures[sec].push(') > insertBlock.indexOf('if (insertLink) {'));

// ===========================================================================
// 2) The project page: the figure card shows the way back
// ===========================================================================
frag('[projectDetail] openBuilderForFigure uses the stored scope', PD, 'openImageBuilder(fig.builderProjectId || project.id, fig.canvasId || null);');
frag('[projectDetail] button only on builder figures', PD, "{fig.source === 'image-builder' && typeof openImageBuilder === 'function' && (");
frag('[projectDetail] button label', PD, '✏️ Modify in Image Builder');
frag('[projectDetail] tooltip names the canvas', PD, 'Reopen ${fig.canvasLabel ?');
frag('[projectDetail] builder badge', PD, '🖼 builder</span>');
frag('[App] openImageBuilder is passed to the project page', APP, 'operatorNames={operatorNames} openImageBuilder={openImageBuilder}');
frag('[App] pending canvas is honoured for the opened project', APP, 'openCanvasId={(pendingCanvas && pendingCanvas.projectId === (currentProjectId || null)) ? pendingCanvas.canvasId : null}');


// ===========================================================================
// 3) Mirrors of the real logic — behaviour of the link round trip
// ===========================================================================
let uid = 0;
const newId = () => `lib${++uid}`;

const makeStore = () => ({ common: [], projects: new Map() });
const listOf = (store, scope, projectId) => (scope === 'project' ? (store.projects.get(projectId) || []) : store.common);
const put = (store, scope, projectId, items) => {
  if (scope === 'project') store.projects.set(projectId, items); else store.common = items;
};
const newEntry = ({ dataUrl, label, canvasData }) => ({
  id: newId(), label, url: `${dataUrl}#thumb`, full: dataUrl, src: null, canvasData: canvasData || null,
  drive: false, driveUrl: null, addedAt: 'T0'
});

// Mirror of publishLibraryFigure (src/utils/figuresLibrary.js): updateId patches
// an EXISTING entry of that scope in place (id + addedAt preserved) — unknown id
// → normal insert.
const publishLibraryFigure = (store, { scope, projectId = null, dataUrl, label, canvasData = null, updateId = null }) => {
  const item = newEntry({ dataUrl, label, canvasData });
  const list = listOf(store, scope, projectId);
  if (updateId) {
    const prev = list.find((i) => i.id === updateId);
    if (prev) {
      const updated = { ...prev, ...item, id: prev.id, addedAt: prev.addedAt, updatedAt: 'T1' };
      put(store, scope, projectId, list.map((i) => (i.id === updateId ? updated : i)));
      return { entry: updated, updated: true };
    }
  }
  put(store, scope, projectId, [item, ...list]);
  return { entry: item, updated: false };
};

// Mirror of ImageBuilder.publishCanvas + rememberCanvasEntry: the scope follows
// the TARGET project, the copy of THAT scope is updated in place when it exists
// (its id is recorded per scope, so re-saving never duplicates and never touches
// the copies of the other scopes).
const canvasScopeKey = (scopeProjectId) => scopeProjectId || 'dataset';
const publishCanvas = (store, builder, { label, targetProjectId = builder.projectId, dataUrl, canvasData }) => {
  const target = targetProjectId || null;
  const known = (builder.canvasEntries || {})[canvasScopeKey(target)] || null;
  const { entry, updated } = publishLibraryFigure(store, {
    scope: target ? 'project' : 'common', projectId: target, dataUrl, label,
    canvasData, updateId: known ? known.id : null
  });
  builder.canvasEntries = { ...(builder.canvasEntries || {}), [canvasScopeKey(target)]: { id: entry.id, label: entry.label } };
  builder.canvasHome = target;
  builder.canvasLabel = entry.label;
  return { entry, updated };
};

// Mirror of ImageBuilder.openSaveDialog: the proposed destination is where the
// canvas is stored already, else the project this builder is open with, else the
// shared dataset library ('').
const defaultSaveDest = (builder) => (Object.keys(builder.canvasEntries || {}).length
  ? (builder.canvasHome || '')
  : (builder.projectId || ''));

// Mirror of the insert handler: the figure is always stored; the link fields are
// added only when the publish succeeded (link === null otherwise).
const insertFigure = (store, builder, { project, section, dataUrl, caption, canvasData, link = true }) => {
  let lnk = null;
  if (link) {
    const pub = publishCanvas(store, builder, { label: 'Figure — demo', targetProjectId: project.id, dataUrl, canvasData });
    if (pub && pub.entry) lnk = { canvasId: pub.entry.id, builderProjectId: project.id, canvasLabel: pub.entry.label };
  }
  project.figures = project.figures || {};
  project.figures[section] = project.figures[section] || [];
  project.figures[section].push({
    id: `fig${++uid}`, url: dataUrl, caption, addedAt: 'T0', source: 'image-builder', ...(lnk || {})
  });
  const list = project.figures[section];
  return list[list.length - 1];
};

// Mirror of App's openImageBuilder + ImageBuilder's openCanvasId effect.
const openImageBuilder = (projectIdArg, canvasId) => ({ projectId: projectIdArg || null, canvasId });
const loadRequestedCanvas = (store, builderProjectId, canvasId) => {
  const list = builderProjectId ? (store.projects.get(builderProjectId) || []) : store.common;
  const item = list.find((i) => i.id === canvasId && i.canvasData);
  return item ? item.canvasData : null;
};

// Mirror of the render condition of the figure-card button.
const showsModifyLink = (fig, hasOpenImageBuilder = true) => fig.source === 'image-builder' && hasOpenImageBuilder;

const snap = (gridCols, gridRows, objectCount) => ({
  canvasW: 900, canvasH: 600, gridCols, gridRows,
  showPanelBorders: true, showGridLines: true, keepAspect: true, globalCaption: 'demo',
  objects: Array.from({ length: objectCount }, (_, i) => ({ id: `o${i}` }))
});

// ---- S1: first insert into the builder's own project ----------------------
{
  const store = makeStore();
  const project = { id: 'P', name: 'Project P' };
  const builder = { projectId: 'P', canvasEntries: {} };
  const fig = insertFigure(store, builder, { project, section: 'background', dataUrl: 'img1', caption: 'Fig 1', canvasData: snap(2, 1, 2) });
  check('S1 insert → 1 canvas in the project library', listOf(store, 'project', 'P').length, 1);
  check('S1 nothing leaks into the common library', store.common.length, 0);
  checkTrue('S1 figure carries a canvasId', !!fig.canvasId);
  check('S1 figure linked to an existing entry', listOf(store, 'project', 'P').some((i) => i.id === fig.canvasId), true);
  check('S1 figure keeps the legacy source marker', fig.source, 'image-builder');
  check('S1 figure remembers the builder project', fig.builderProjectId, 'P');
  const req = openImageBuilder(fig.builderProjectId, fig.canvasId);
  check('S1 project page asks for this canvas', req, { projectId: 'P', canvasId: fig.canvasId });
  const cd = loadRequestedCanvas(store, req.projectId, req.canvasId);
  checkTrue('S1 editor restores the very same composition', !!cd && cd.objects.length === 2);
  check('S1 restored grid = canvas grid', cd && cd.gridCols, 2);
}

// ---- S2: modify + insert again → ONE entry, links follow the update -------
{
  const store = makeStore();
  const project = { id: 'P', name: 'Project P' };
  const builder = { projectId: 'P', canvasEntries: {} };
  const fig1 = insertFigure(store, builder, { project, section: 'background', dataUrl: 'img1', caption: 'Fig 1', canvasData: snap(2, 1, 2) });
  const firstId = fig1.canvasId;
  // The user edits the canvas (now 3 panels / 4 objects) and inserts again.
  const fig2 = insertFigure(store, builder, { project, section: 'discussion', dataUrl: 'img2', caption: 'Fig 2', canvasData: snap(3, 2, 4) });
  check('S2 second insert does not duplicate the canvas', listOf(store, 'project', 'P').length, 1);
  check('S2 canvas id is stable across inserts', [fig1.canvasId, fig2.canvasId], [firstId, firstId]);
  check('S2 both figures reuse the same link', new Set([firstId, fig2.canvasId]).size, 1);
  const cd = loadRequestedCanvas(store, fig2.builderProjectId, fig2.canvasId);
  checkTrue('S2 the link reopens the LATEST composition', cd.gridCols === 3 && cd.objects.length === 4);
}

// ---- S3: builder had no project → still links into the target project ------
{
  const store = makeStore();
  const project = { id: 'P', name: 'Project P' };
  const builder = { projectId: null, canvasEntries: {} };
  const fig = insertFigure(store, builder, { project, section: 'conclusions', dataUrl: 'img1', caption: 'Fig 1', canvasData: snap(1, 1, 1) });
  check('S3 canvas stored in the target project (not the common library)', [listOf(store, 'project', 'P').length, store.common.length], [1, 0]);
  check('S3 the builder remembers the entry it created there', builder.canvasEntries.P.id, fig.canvasId);
  check('S3 link opens the target project scope', openImageBuilder(fig.builderProjectId, fig.canvasId), { projectId: 'P', canvasId: fig.canvasId });
  checkTrue('S3 the canvas is found where the link points', !!loadRequestedCanvas(store, 'P', fig.canvasId));
}

// ---- S4: inserting into ANOTHER project never touches the builder's own ----
{
  const store = makeStore();
  const other = { id: 'P', name: 'Project P' };
  const builder = { projectId: 'Q', canvasEntries: {} };
  // The builder's own canvas was already saved in Q's library.
  const own = publishCanvas(store, builder, { label: 'My canvas', dataUrl: 'imgQ', canvasData: snap(2, 2, 3) });
  const fig = insertFigure(store, builder, { project: other, section: 'background', dataUrl: 'imgP', caption: 'Fig', canvasData: snap(4, 1, 1) });
  check('S4 own library untouched by the insert', listOf(store, 'project', 'Q').map((i) => i.id), [own.entry.id]);
  check('S4 foreign insert creates its own entry', listOf(store, 'project', 'P').map((i) => i.id), [fig.canvasId]);
  checkTrue('S4 the two canvases are distinct', fig.canvasId !== own.entry.id);
  check('S4 the link stays in the target project', fig.builderProjectId, 'P');
  const inP = loadRequestedCanvas(store, 'P', fig.canvasId);
  checkTrue('S4 reopening resolves in the target project only', inP.gridCols === 4 && loadRequestedCanvas(store, 'Q', fig.canvasId) === null);
  // Inserting the SAME canvas into P again must reuse P's own copy (the entry
  // recorded for that scope) instead of piling up duplicates there; the Q copy
  // stays exactly as it was for the Q project page.
  const fig2 = insertFigure(store, builder, { project: other, section: 'discussion', dataUrl: 'imgP2', caption: 'Fig 2', canvasData: snap(4, 2, 5) });
  check('S4 repeat insert reuses the target entry (no duplicate)', listOf(store, 'project', 'P').length, 1);
  check('S4 both P figures share that canvas id', [fig.canvasId, fig2.canvasId], [fig.canvasId, fig.canvasId]);
  check('S4 the Q copy is untouched', listOf(store, 'project', 'Q').map((i) => i.id), [own.entry.id]);
  checkTrue('S4 the P copy carries the latest composition', loadRequestedCanvas(store, 'P', fig2.canvasId).objects.length === 5);
}

// ---- S5: opt-out + legacy figures ----------------------------------------
{
  const store = makeStore();
  const project = { id: 'P', name: 'Project P' };
  const builder = { projectId: 'P', canvasEntries: {} };
  const fig = insertFigure(store, builder, { project, section: 'background', dataUrl: 'img1', caption: 'Fig', canvasData: snap(1, 1, 1), link: false });
  check('S5 opt-out → no canvas saved', listOf(store, 'project', 'P').length, 0);
  checkTrue('S5 opt-out still inserts the figure', fig.url === 'img1' && fig.source === 'image-builder');
  checkTrue('S5 opt-out figure has no canvasId', fig.canvasId === undefined);
  // Legacy insert (before the link existed): the project page must still offer a
  // way into the editor — with canvasId null the builder resumes its own state.
  const legacy = { id: 'f0', url: 'img0', caption: 'Old', source: 'image-builder' };
  check('S5 legacy figure → open the builder on this project',
    openImageBuilder(legacy.builderProjectId || project.id, legacy.canvasId || null), { projectId: 'P', canvasId: null });
  check('S5 nothing to restore → the builder keeps its state', loadRequestedCanvas(store, 'P', null), null);
}

// ---- S7: the destination dialog — save into ANY project's library ----------
// The reported flow: the Image Builder is opened from the sidebar (no project),
// the composition is saved with the dialog destination = project P. It must land
// in P's library — the one the library's Project tab and the project page's
// "🖼 Saved canvases" read — and NOT in the shared dataset library; re-saving it
// for that project must update that very entry.
{
  const store = makeStore();
  const builder = { projectId: null, canvasEntries: {} }; // opened without a project
  check('S7 destination proposed with no project = shared library', defaultSaveDest(builder), '');
  const first = publishCanvas(store, builder, { label: 'My canvas', targetProjectId: 'P', dataUrl: 'img1', canvasData: snap(2, 1, 1) });
  check('S7 canvas lands in the chosen project library', listOf(store, 'project', 'P').length, 1);
  check('S7 shared dataset library untouched', store.common.length, 0);
  check('S7 the project page lists it as a canvas', listOf(store, 'project', 'P').filter((i) => i.canvasData).map((i) => i.id), [first.entry.id]);
  check('S7 the library keeps a picture of it (thumbnail)', typeof listOf(store, 'project', 'P')[0].url, 'string');
  check('S7 that project is now the proposed destination', defaultSaveDest(builder), 'P');
  const second = publishCanvas(store, builder, { label: 'My canvas', targetProjectId: 'P', dataUrl: 'img2', canvasData: snap(3, 2, 4) });
  check('S7 re-saving updates that same entry', [listOf(store, 'project', 'P').length, second.updated, second.entry.id === first.entry.id], [1, true, true]);
  checkTrue('S7 the link reopens the LATEST composition', loadRequestedCanvas(store, 'P', first.entry.id).gridCols === 3);
  // The same canvas can ALSO be parked in the shared dataset library: a separate
  // entry, and the project copy is left alone.
  const shared = publishCanvas(store, builder, { label: 'My canvas', targetProjectId: null, dataUrl: 'img3', canvasData: snap(3, 2, 4) });
  check('S7 the shared copy is a separate entry', [store.common.length, listOf(store, 'project', 'P').length], [1, 1]);
  checkTrue('S7 the two copies are independent', shared.entry.id !== first.entry.id && loadRequestedCanvas(store, 'P', first.entry.id).gridCols === 3);
  check('S7 the shared library is now the proposed destination', defaultSaveDest(builder), '');
}

// ---- S8: the dialog proposes where the canvas already lives ----------------
{
  const store = makeStore();
  const builder = { projectId: 'P', canvasEntries: {} };
  check('S8 fresh canvas + project open → propose that project', defaultSaveDest(builder), 'P');
  const saved = publishCanvas(store, builder, { label: 'Canvas P', dataUrl: 'img', canvasData: snap(1, 1, 1) });
  check('S8 after saving → still that project', defaultSaveDest(builder), 'P');
  // A canvas opened from the dataset library proposes the dataset library again,
  // even while a project is open in the editor.
  const opened = { projectId: 'P', canvasEntries: { dataset: { id: saved.entry.id, label: 'Canvas P' } }, canvasHome: null };
  check('S8 canvas opened from the shared library → propose it', defaultSaveDest(opened), '');
}

// ---- S9: a canvas whose entry was deleted re-saves as a NEW entry ----------
{
  const store = makeStore();
  const builder = { projectId: 'P', canvasEntries: {} };
  const first = publishCanvas(store, builder, { label: 'C', dataUrl: 'a', canvasData: snap(1, 1, 1) });
  put(store, 'project', 'P', []); // the user deleted it from the library
  const again = publishCanvas(store, builder, { label: 'C', dataUrl: 'b', canvasData: snap(2, 1, 2) });
  check('S9 deleted entry → a fresh entry is created', [listOf(store, 'project', 'P').length, again.updated], [1, false]);
  checkTrue('S9 the new id is remembered', builder.canvasEntries.P.id === again.entry.id && again.entry.id !== first.entry.id);
}

// ---- S10: the inserted figure keeps the IMAGE (the link is additive) -------
{
  const store = makeStore();
  const project = { id: 'P', name: 'Project P' };
  const builder = { projectId: 'P', canvasEntries: {} };
  const fig = insertFigure(store, builder, { project, section: 'discussion', dataUrl: 'rendered-png', caption: 'Fig', canvasData: snap(2, 1, 1) });
  check('S10 the section holds the rendered image', project.figures.discussion.map((f) => f.url), ['rendered-png']);
  checkTrue('S10 the image is the render itself (not a link)', !/^https?:/.test(fig.url));
  checkTrue('S10 the same object carries the canvas link on top', !!fig.canvasId && !!loadRequestedCanvas(store, 'P', fig.canvasId));
  const entry = listOf(store, 'project', 'P')[0];
  checkTrue('S10 the library entry is an image with a preview', typeof entry.url === 'string' && entry.url.endsWith('#thumb'));
}

// ---- S6: negative controls ------------------------------------------------
check('S6 a plain figure shows no builder link', showsModifyLink({ id: 'f', url: 'u' }, true), false);
checkTrue('S6 a builder figure shows the link', showsModifyLink({ id: 'f', url: 'u', source: 'image-builder' }, true));
checkTrue('S6 an unknown canvasId resolves to nothing (no crash)', loadRequestedCanvas(makeStore(), 'P', 'ghost') === null);
frag('[figuresLibrary] update-in-place semantics still there', LIB, 'const prev = list.find((i) => i.id === updateId) || prevByKey;');
frag('[figuresLibrary] id preserved on update', LIB, 'id: prev.id, addedAt: prev.addedAt, updatedAt: new Date().toISOString()');
frag('[ImageBuilder] the editor restores the snapshot', IB, 'if (cd.gridCols) setGridCols(cd.gridCols);');
frag('[ImageBuilder] ...and its objects', IB, 'setObjects((cd.objects || []).map((o) => resolveObj(o)));');

console.table(results);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `❌ ${failed.length} check(s) failed` : `✅ ${results.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
