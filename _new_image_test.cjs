// Validates the FEATURE "the Image Builder can START A NEW IMAGE".
//
// The builder restores the canvas it was left on and the only way to empty it
// was the destructive red "Clear Canvas" — which also forgot which library entry
// the canvas came from. There was no "create" button at all.
//
// Chain under test (keep the mirrors in sync with the sources):
//   ImageBuilder.jsx
//     • blankObject(letter)  → the ONE factory of an empty panel, shared by
//       "+ Add Object" and by "➕ New image" (the new figure starts with a single
//       empty panel A, selected, ready for its first capture)
//     • startNewImage()      → empties the editor, seeds that panel, KEEPS the
//       canvas format (width/height, grid, borders, aspect, letter size) and
//       detaches the canvas from the stored entry (setCanvasEntries({}))
//     • the header button "➕ New image" + the same action in the library window
//   figuresLibrary semantics → with no known entry the next "💾 Save canvas"
//     CREATES a new library image instead of updating the one that was open.
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const IB = read('src/components/ImageBuilder.jsx');

const results = [];
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push({ name, got: String(got), want: String(want), ok });
  return ok;
};
const checkTrue = (name, got) => check(name, !!got, true);
const frag = (name, hay, needle) => checkTrue(`${name}: ${needle.slice(0, 44)}…`, hay.includes(needle));

// ===========================================================================
// 1) One empty-panel factory, used by BOTH creation paths
// ===========================================================================
frag('[ImageBuilder] the empty-panel factory', IB, 'const blankObject = (letter) => ({');
frag('[ImageBuilder] "+ Add Object" uses it', IB, 'const newObj = blankObject(nextLetter);');
frag('[ImageBuilder] ...and the new panel gets selected', IB, 'setSelectedId(newObj.id);');
frag('[ImageBuilder] the letter size still follows the figure-wide control', IB, "letterStyle: { fontSize: currentLetterPt(), color: '#000000', bold: true },");

// ===========================================================================
// 2) "➕ New image": a blank figure with ONE panel ready for a capture
// ===========================================================================
const START = 'const startNewImage = () => {';
const END = '// Ctrl+Z undoes the last canvas change.';
const newImg = IB.slice(IB.indexOf(START), IB.indexOf(END));
frag('[ImageBuilder] the handler exists', IB, START);
frag('[ImageBuilder] it seeds a first empty panel', newImg, "const first = blankObject('A');");
frag('[ImageBuilder] ...which becomes the whole canvas', newImg, 'setObjects([first]);');
frag('[ImageBuilder] ...and is selected, ready for the next figure', newImg, 'setSelectedId(first.id);');
frag('[ImageBuilder] ...and is lettered by the position pass', newImg, 'renumberLetters();');
frag('[ImageBuilder] the figure caption starts empty', newImg, "setGlobalCaption('');");
frag('[ImageBuilder] inline editors are closed', newImg, 'setEditingText(null);');
frag('[ImageBuilder] the library window is closed', newImg, 'setShowLibrary(false);');
frag('[ImageBuilder] the insert dialog is closed', newImg, 'setInsertOpen(false);');
frag('[ImageBuilder] the canvas change is undoable', newImg, 'commitHistory();');

// The canvas FORMAT is deliberately kept: a new image is a new figure in the
// SAME format (same journal size, same panel grid), so the size / grid
// switches must not be reset by this action.
check('the format is not touched (width/height/grid)', /setCanvas[WH]\(|setGrid(Cols|Rows)\(/.test(newImg), false);

// ===========================================================================
// 3) Detachment: the next save CREATES an image instead of overwriting
// ===========================================================================
frag('[ImageBuilder] it forgets the stored entry', newImg, 'setCanvasEntries({});');
frag('[ImageBuilder] ...and its name', newImg, "setCanvasLabel('');");
frag('[ImageBuilder] ...while the save dialog keeps proposing that project', newImg, 'setCanvasHome(projectId || null);');

// Mirror of figuresLibrary.publishLibraryFigure + ImageBuilder.publishCanvas:
// the entry of THAT scope is updated IN PLACE only when the builder still knows
// it (`updateId`); with no known entry a brand-new image is added instead.
const publish = (store, scope, { known = null, label }) => {
  const list = scope ? (store.projects[scope] || []) : store.common;
  const updateId = known ? known.id : null;
  const prev = updateId ? list.find((i) => i.id === updateId) : null;
  if (prev) { prev.label = label; prev.updatedAt = 'newer'; return { id: prev.id, updated: true, entry: prev }; }
  const entry = { id: `${scope || 'dataset'}_${list.length + 1}`, label, canvasData: {} };
  list.push(entry);
  return { id: entry.id, updated: false, entry };
};

const store = { common: [], projects: { P: [] } };
const opened = publish(store, 'P', { label: 'Figure 1' });            // opened from the project page
check('the opened canvas is one image of P', store.projects.P.length, 1);
const resave = publish(store, 'P', { known: { id: opened.id }, label: 'Figure 1' });
check('without a new image, saving updates that very entry',
  [store.projects.P.length, resave.id === opened.id, resave.updated], [1, true, true]);
// "➕ New image" ran, so canvasEntries is empty: the builder knows no entry.
const made = publish(store, 'P', { known: null, label: 'Figure 2' });
check('after a new image, saving ADDS an image', store.projects.P.length, 2);
checkTrue('the image that was open is left untouched',
  store.projects.P[0].label === 'Figure 1' && made.id !== opened.id);
check('the new image is a separate library item', made.updated, false);

// ===========================================================================
// 4) The button exists where a user looks for it
// ===========================================================================
frag('[ImageBuilder] the label', IB, '➕ New image');
check('it is wired in the editor header AND in the library window',
  (IB.match(/onClick=\{startNewImage\}/g) || []).length, 2);
check('the old "+ Add Object" button is untouched',
  (IB.match(/onClick=\{addObject\}/g) || []).length, 2);
frag('[ImageBuilder] the header button explains what survives', IB, 'stays in the image library as it was last saved');
frag('[ImageBuilder] a never-saved canvas is announced as lost', IB, 'was never saved to the image library, so it will be lost');
frag('[ImageBuilder] it is not a wipe: the confirm only empties the editor', IB, 'only the editor is emptied');

console.table(results);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `❌ ${failed.length} check(s) failed` : `✅ ${results.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
