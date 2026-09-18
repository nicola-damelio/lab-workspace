// Validates the FIX "a new panel lands in the FIRST FREE CELL of the grid".
//
// "+ Add Object" took its object straight from the one empty-panel factory,
// which carries the hard-coded top-left cell (x: 0, y: 0). Every panel added to
// a figure already in progress therefore landed ON TOP of panel A: the new
// panel hid the figure underneath, and the user had to drag it away — usually
// grabbing the wrong one, since the two were stacked.
//
// The panel now takes the first EMPTY cell, scanned in the same reading order
// the panel letters follow (row by row, left→right — see renumberLetters): it
// lands beside the panels already there, or in the gap left by a deleted /
// moved panel. A grid with no free cell cannot host it, so nothing is placed
// and the user is told to enlarge the grid or delete a panel: a new panel must
// never hide a figure that is already on the canvas.
//
// The component cannot be imported here (JSX module), so the rules under test
// are mirrored verbatim from src/components/ImageBuilder.jsx — keep both in sync:
//   * firstFreeCell(list, w, h) — first free cell of the gridCols × gridRows grid
//   * addObject()               — the placement + the full-grid guard + history
//   * renumberLetters()         — the letter pass that follows (the placement is
//                                 what makes the new panel the next letter)
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

// ── mirror: ImageBuilder.jsx firstFreeCell() ────────────────────────────────
// (the grid comes in as parameters instead of the two useState values of the
//  component; the body is otherwise identical)
const firstFreeCell = (list, gridCols, gridRows, w = 1, h = 1) => {
  const occupied = (x, y) => (list || []).some((o) => {
    if (!o) return false;
    const ox = Number(o.x) || 0, oy = Number(o.y) || 0;
    const ow = Math.max(1, Number(o.w) || 1), oh = Math.max(1, Number(o.h) || 1);
    return x < ox + ow && x + w > ox && y < oy + oh && y + h > oy;
  });
  for (let y = 0; y + h <= gridRows; y++) {
    for (let x = 0; x + w <= gridCols; x++) {
      if (!occupied(x, y)) return { x, y };
    }
  }
  return null;
};

// ── mirror: ImageBuilder.jsx blankObject() / renumberLetters() / addObject() ─
let seq = 0;
const blankObject = (letter) => ({ id: `obj_${++seq}`, x: 0, y: 0, w: 1, h: 1, letter: letter || 'A' });

// The letter pass: letters follow the POSITION (top→bottom, left→right). The
// sub-caption rewrite it also does is untouched by the placement.
const renumberLetters = (objects) => {
  const sorted = [...objects].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const letterOf = {};
  sorted.forEach((o, i) => { letterOf[o.id] = i < 26 ? String.fromCharCode(65 + i) : `${i + 1}`; });
  return objects.map((o) => {
    const L = letterOf[o.id];
    return (!L || o.letter === L) ? o : { ...o, letter: L };
  });
};

// addObject(): the full-grid guard, the placement, then history / selection /
// letters exactly as the component does them.
const addObject = (state, gridCols, gridRows) => {
  const spot = firstFreeCell(state.objects, gridCols, gridRows);
  if (!spot) {
    state.alerts.push(`The ${gridCols} × ${gridRows} grid is full: a new panel would cover an existing one.`);
    return state;
  }
  state.history.push(state.objects.map((o) => ({ ...o })));
  const nextLetter = state.objects.length < 26 ? String.fromCharCode(65 + state.objects.length) : `${state.objects.length + 1}`;
  const newObj = blankObject(nextLetter);
  newObj.x = spot.x;
  newObj.y = spot.y;
  state.objects = renumberLetters([...state.objects, newObj]);
  state.selectedId = newObj.id;
  return state;
};

const panel = (x, y, w = 1, h = 1) => ({ id: `p_${x}_${y}`, x, y, w, h, letter: '' });
const newState = (objects = []) => ({ objects, selectedId: null, history: [], alerts: [] });
const spot = (objects, cols, rows, w = 1, h = 1) => firstFreeCell(objects, cols, rows, w, h);

// ===========================================================================
// 1) The fix is wired in the component
// ===========================================================================
frag('[ImageBuilder] the first-free-cell helper', IB, 'const firstFreeCell = (list, w = 1, h = 1) => {');
// La règle elle-même vit dans utils/objectClipboard.js (firstFreeCellIn) : le
// builder ne fait que lui donner la grille courante. Le corps recopié plus haut
// continue de décrire exactement ce comportement, et le module est vérifié à
// fond par _builder_copy_paste_test.mjs.
frag('[ImageBuilder] il délègue au helper pur (une seule règle de placement)',
  IB, 'return firstFreeCellIn(list, gridCols, gridRows, w, h);');
const OBJCLIP = read('src/utils/objectClipboard.js');
frag('[utils/objectClipboard] it scans the grid row by row', OBJCLIP, 'for (let y = 0; y + bh <= rows; y++) {');
frag('[utils/objectClipboard] ...and cell by cell', OBJCLIP, 'for (let x = 0; x + bw <= cols; x++) {');
frag('[utils/objectClipboard] a cell is free only when NO panel covers it', OBJCLIP,
  'return x < ox + ow && x + bw > ox && y < oy + oh && y + bh > oy;');
frag('[ImageBuilder] "+ Add Object" asks for that cell', IB, 'const spot = firstFreeCell(objects);');
frag('[ImageBuilder] the new panel is placed there', IB, 'newObj.x = spot.x;');
frag('[ImageBuilder] ...instead of the factory default', IB, 'newObj.y = spot.y;');
frag('[ImageBuilder] the factory still defaults to the top-left cell (the FIRST panel)', IB, 'x: 0, y: 0, w: 1, h: 1,');
frag('[ImageBuilder] a FULL grid is reported, not covered', IB, 'grid is full: a new panel would cover an existing one');
frag('[ImageBuilder] ...with the way to make room', IB, 'Increase “Grid Cols” or “Grid Rows” in the canvas format, or delete a panel, to make room.');
check('both "+ Add Object" buttons explain the placement on hover',
  (IB.match(/title="Add a panel — it takes the FIRST FREE cell of the grid/g) || []).length, 2);
check('the two "+ Add Object" buttons are still wired',
  (IB.match(/onClick=\{addObject\}/g) || []).length, 2);

// Inside addObject(): the guard runs FIRST — a refused panel must not change the
// canvas AND must not push an undo step.
const addObj = IB.slice(IB.indexOf('const addObject = () => {'), IB.indexOf('// ---- start a NEW image'));
frag('[ImageBuilder] the canvas change stays undoable', addObj, 'commitHistory();');
frag('[ImageBuilder] the letters are re-assigned after the placement', addObj, 'renumberLetters();');
checkTrue('the full-grid guard runs BEFORE the undo entry is pushed',
  addObj.indexOf('if (!spot)') >= 0 && addObj.indexOf('if (!spot)') < addObj.indexOf('commitHistory();'));
checkTrue('...and before the panel is added / selected',
  addObj.indexOf('if (!spot)') < addObj.indexOf('setObjects([...objects, newObj]);')
  && addObj.indexOf('if (!spot)') < addObj.indexOf('setSelectedId(newObj.id);'));

// ===========================================================================
// 2) Where the first free cell is
// ===========================================================================
check('an EMPTY grid keeps the historical home of the first panel', spot([], 4, 5), { x: 0, y: 0 });
check('panel B goes BESIDE A — same row, next cell', spot([panel(0, 0)], 4, 5), { x: 1, y: 0 });
check('...and C beside B', spot([panel(0, 0), panel(1, 0)], 4, 5), { x: 2, y: 0 });
check('a gap left by a deleted panel is filled first', spot([panel(0, 0), panel(2, 0)], 4, 5), { x: 1, y: 0 });
check('the second row is used when the first one is full',
  spot([panel(0, 0), panel(1, 0), panel(2, 0), panel(3, 0)], 4, 5), { x: 0, y: 1 });
check('the LAST row is the home when everything above is taken',
  spot([panel(0, 0), panel(1, 0), panel(0, 1), panel(1, 1)], 2, 3), { x: 0, y: 2 });

// Panels bigger than one cell are respected as a BLOCK, so a new panel can never
// half-cover one (the placement tests every cell the panel would occupy).
check('a 2 × 2 panel pushes the new one past it', spot([panel(0, 0, 2, 2)], 4, 4), { x: 2, y: 0 });
check('a 2 × 2 REQUEST needs two free columns',
  spot([panel(0, 0, 2, 2), panel(2, 0, 2, 2)], 4, 4, 2, 2), { x: 0, y: 2 });
check('a full-width single-row panel is respected too', spot([panel(0, 0, 4, 1)], 4, 5), { x: 0, y: 1 });
check('a panel bigger than the grid itself cannot be placed', spot([], 2, 2, 3, 1), null);

// Canvases written before the fix (or by hand) can contain overlapping panels:
// the scan must still find a free cell instead of crashing or looping.
check('legacy overlapping panels still find a free cell', spot([panel(0, 0), panel(0, 0)], 4, 5), { x: 1, y: 0 });
check('a panel with no x/y/w/h counts as a single cell', spot([{ id: 'x' }], 4, 5), { x: 1, y: 0 });
check('a null entry is ignored', spot([null, panel(0, 0)], 4, 5), { x: 1, y: 0 });

// Full grids: no spot at all (the caller then refuses to place a panel).
check('a full 2 × 2 grid has no free cell',
  spot([panel(0, 0), panel(1, 0), panel(0, 1), panel(1, 1)], 2, 2), null);
check('...and neither has a full single-column grid', spot([panel(0, 0), panel(0, 1)], 1, 2), null);
check('a 1 × 1 grid without panels still takes its only cell', spot([], 1, 1), { x: 0, y: 0 });
checkTrue('every proposed cell is INSIDE the grid (panels are clamped there)',
  [[], [panel(0, 0)], [panel(3, 4)], [panel(0, 0, 2, 2)]].every((list) => {
    const p = spot(list, 4, 5);
    return !!p && p.x >= 0 && p.y >= 0 && p.x + 1 <= 4 && p.y + 1 <= 5;
  }));

// ===========================================================================
// 3) The behaviour of "+ Add Object"
// ===========================================================================
const s1 = newState([panel(0, 0)]);
addObject(s1, 4, 5);
check('the new panel is placed beside the existing one',
  s1.objects.map((o) => [o.x, o.y]), [[0, 0], [1, 0]]);
check('it is NOT the top-left cell any more (the old bug)', [s1.objects[1].x, s1.objects[1].y], [1, 0]);
check('the panel that was already there is untouched', s1.objects[0], { id: 'p_0_0', x: 0, y: 0, w: 1, h: 1, letter: 'A' });
check('the new panel is selected, ready for its capture', s1.selectedId, s1.objects[1].id);
check('the letters still read in reading order', s1.objects.map((o) => o.letter).join(''), 'AB');
check('the change is undoable (exactly one history entry)', s1.history.length, 1);

// A grid with no free cell: nothing is added, nothing is overwritten, and the
// canvas stays out of the undo history because it did not change.
const s2 = newState([panel(0, 0), panel(1, 0), panel(0, 1), panel(1, 1)]);
addObject(s2, 2, 2);
check('a full grid adds nothing', s2.objects.length, 4);
check('a full grid tells the user why (an alert, once)',
  [s2.alerts.length, s2.alerts[0].includes('2 × 2 grid is full')], [1, true]);
check('a full grid pushes no undo entry', s2.history.length, 0);
check('a full grid keeps the selection as it was', s2.selectedId, null);
check('no panel was moved by the refused add',
  s2.objects.map((o) => [o.x, o.y]), [[0, 0], [1, 0], [0, 1], [1, 1]]);

// Filling a 3 × 4 grid one panel at a time: every cell is used exactly once, in
// reading order — so the letters of the finished figure read A, B, C, … down the
// rows instead of piling up in the top-left cell.
const s3 = newState([]);
const seen = [];
for (let i = 0; i < 12; i++) {
  addObject(s3, 3, 4);
  const last = s3.objects[s3.objects.length - 1];
  seen.push(`${last.x},${last.y}`);
}
check('a 3 × 4 grid hosts 12 panels', s3.objects.length, 12);
check('every panel has its own cell', new Set(seen).size, 12);
check('the cells are filled in reading order', seen.join(' '),
  '0,0 1,0 2,0 0,1 1,1 2,1 0,2 1,2 2,2 0,3 1,3 2,3');
check('the letters run A … L like the reading order', s3.objects.map((o) => o.letter).join(''), 'ABCDEFGHIJKL');
addObject(s3, 3, 4);
check('the 13th panel is refused (the grid is full)', [s3.objects.length, s3.alerts.length], [12, 1]);

// Deleting a panel frees its cell: the next panel takes THAT one back.
const s4 = newState([panel(0, 0), panel(1, 0), panel(2, 0)]);
s4.objects = s4.objects.filter((o) => o.x !== 1);          // panel B deleted
addObject(s4, 4, 5);
// ...and the letters follow the POSITION, not the creation order: the objects
// stay in creation order (A @0,0 · the old C @2,0 · the new panel @1,0) while
// the new panel is lettered B because it now sits between them.
check('after a delete, the next panel fills the gap',
  s4.objects.map((o) => `${o.x},${o.y}`), ['0,0', '2,0', '1,0']);
check('...and the letters follow the POSITION, not the creation order',
  s4.objects.map((o) => o.letter).join(''), 'ACB');
check('...so the figure still reads A, B, C from left to right',
  [...s4.objects].sort((a, b) => (a.y - b.y) || (a.x - b.x)).map((o) => o.letter).join(''), 'ABC');

console.table(results);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `❌ ${failed.length} check(s) failed` : `✅ ${results.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);


