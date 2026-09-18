// Validates the two Image Builder caption/label fixes:
//
//  1) THE GLOBAL CAPTION LISTS THE SUB-CAPTIONS IN ALPHABETICAL ORDER.
//     The caption at the bottom of the figure is the merge of every panel's
//     sub-caption. It used to be built in the order the panels happen to be
//     STORED in (`objects`), so a canvas whose panels were placed as C, A, B
//     read “C: … · A: … · B: …”. It is now sorted by the PANEL LETTER (see
//     `comparePanelLetters`), i.e. A first, then B, … — the order the letters
//     read on the figure, whatever order the panels were created in.
//
//  2) THE LETTER SIZE APPLIES TO ALL THE LETTERS, NOT ONE AT A TIME.
//     “Letter Size” was a per-object property, so the size had to be typed
//     again for every panel. It is now written to ALL the objects at once by
//     the three controls (canvas toolbar, fullscreen toolbar, “Labels &
//     Captions”), new panels adopt the shared size, and the letters keep being
//     drawn from `letterStyle.fontSize` — so every panel follows. Colour and
//     bold stay per panel.
//
// The component cannot be imported here (JSX module), so the rules under test
// are mirrored verbatim from src/components/ImageBuilder.jsx — keep both in sync:
//   * panelLetterRank() / comparePanelLetters()
//   * autoGlobalCaption()            (the caption built at the bottom)
//   * setLetterSizeAll() / currentLetterPt()
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
const frag = (name, hay, needle) => checkTrue(`${name}: ${needle.slice(0, 42)}…`, hay.includes(needle));

// ── mirror: ImageBuilder.jsx ────────────────────────────────────────────────
const panelLetterRank = (letter) => {
  const s = String(letter == null ? '' : letter).trim();
  if (/^[A-Za-z]$/.test(s)) return [0, s.toUpperCase().charCodeAt(0), ''];
  if (/^\d+$/.test(s)) return [1, Number(s), ''];
  return [2, 0, s.toUpperCase()];
};
const comparePanelLetters = (a, b) => {
  const ra = panelLetterRank(a);
  const rb = panelLetterRank(b);
  return (ra[0] - rb[0]) || (ra[1] - rb[1]) || (ra[2] < rb[2] ? -1 : ra[2] > rb[2] ? 1 : 0);
};
const DEFAULT_LETTER_PT = 14;
const autoGlobalCaption = (objects) => (objects || []).filter((o) => String(o.caption || '').trim())
  .sort((a, b) => comparePanelLetters(a.letter, b.letter) || (a.y - b.y) || (a.x - b.x))
  .map((o) => `${o.letter || '?'}: ${String(o.caption).trim()}`).join(' · ');
const setLetterSizeAll = (objects, pt) => {
  const size = Number(pt);
  if (!Number.isFinite(size) || size <= 0) return objects;
  return objects.map(o => ({ ...o, letterStyle: { ...(o.letterStyle || {}), fontSize: size } }));
};
const currentLetterPt = (objects, selectedId, fallbackPt = DEFAULT_LETTER_PT) => {
  const sel = (objects || []).find((o) => o.id === selectedId);
  const s = sel && sel.letterStyle ? Number(sel.letterStyle.fontSize) : 0;
  if (Number.isFinite(s) && s > 0) return s;
  const first = (objects || []).find((o) => o && o.letterStyle && Number(o.letterStyle.fontSize) > 0);
  return first ? Number(first.letterStyle.fontSize) : fallbackPt;
};
// the component keeps the last size typed in a state, so an empty canvas (or a
// brand-new panel) still shows/uses it — setLetterSizeAll writes both.
const setLetterSizeAllWithMemory = (state, pt) => {
  const size = Number(pt);
  if (!Number.isFinite(size) || size <= 0) return state;
  return { objects: setLetterSizeAll(state.objects, size), fallbackPt: size };
};
// panel at (y, x) — the letter is assigned by position, the caption by hand
const panel = (letter, caption, y = 0, x = 0, style = {}) => ({
  id: `obj_${letter}_${y}_${x}`, letter, caption, x, y, w: 1, h: 1,
  letterStyle: { fontSize: 14, color: '#000000', bold: true, ...style }
});


/* ══════════════════════════════════════════════════════════════════════════
   1) THE FIGURE CAPTION FOLLOWS THE PANEL LETTERS (A, B, C …)
   ══════════════════════════════════════════════════════════════════════════ */
// The reported case: the panels were placed / pasted out of order (C first).
const outOfOrder = [panel('C', 'Confocal images', 2, 0), panel('A', 'Synthesis scheme', 0, 0), panel('B', 'NMR spectrum', 1, 0)];
check('the caption lists the panels A, B, C — not the storage order',
  autoGlobalCaption(outOfOrder), 'A: Synthesis scheme · B: NMR spectrum · C: Confocal images');
check('sorting does not depend on the input order',
  autoGlobalCaption([...outOfOrder].reverse()), autoGlobalCaption(outOfOrder));
check('letters renumbered by position → the caption follows the figure',
  autoGlobalCaption([panel('B', 'First placed', 0, 0), panel('A', 'Second placed', 1, 0)]),
  'A: Second placed · B: First placed');

// Panels without a sub-caption are skipped; a blank caption is not a caption.
check('panels without a sub-caption are left out',
  autoGlobalCaption([panel('A', ''), panel('B', '   '), panel('C', 'Only this one')]), 'C: Only this one');
check('the captions are trimmed before merging',
  autoGlobalCaption([panel('A', '  Synthesis scheme \n')]), 'A: Synthesis scheme');
check('no caption at all → no caption band', autoGlobalCaption([]), '');
check('the objects themselves are not re-ordered',
  outOfOrder.map((o) => o.letter).join(''), 'CAB');

// Past Z the letters fall back to numbers (renumberLetters): 27, 28 … — they
// come after the letters and stay in numeric order.
check('numeric fallback letters sort after Z', autoGlobalCaption([panel('27', 'x'), panel('Z', 'y')]), 'Z: y · 27: x');
check('numeric fallback letters are in numeric order',
  autoGlobalCaption([panel('28', 'b'), panel('27', 'a')]), '27: a · 28: b');
// A panel with no letter at all (should not happen, but must not throw) is
// listed after the labelled ones, keeping its caption under “?”.
check('an unlabelled panel is listed last and marked with “?”',
  autoGlobalCaption([panel(undefined, 'mystery'), panel('A', 'alpha')]), 'A: alpha · ?: mystery');
// A custom label (the Letter field is editable) sorts last, case-insensitively.
check('a custom label sorts after the numbered ones',
  autoGlobalCaption([panel('aux', 'custom'), panel('2', 'second extra'), panel('A', 'alpha')]),
  'A: alpha · 2: second extra · aux: custom');
check('letter order ignores the case (a = A)', comparePanelLetters('a', 'B') < 0, true);
check('…and the full alphabet is in order',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').every((l, i, arr) => i === 0 || comparePanelLetters(arr[i - 1], l) < 0), true);
check('same letter twice → the position decides (top→bottom, left→right)',
  autoGlobalCaption([panel('A', 'right', 0, 1), panel('A', 'left', 0, 0)]), 'A: left · A: right');

// The merge is what the canvas draws, unless the user typed a custom caption.
frag('[ImageBuilder] the caption is the merged sub-captions', IB,
  `const effectiveGlobalCaption = String(globalCaption || '').trim() ? globalCaption : autoGlobalCaption;`);
frag('[ImageBuilder] the merge is sorted by panel letter', IB,
  '.sort((a, b) => comparePanelLetters(a.letter, b.letter) || (a.y - b.y) || (a.x - b.x))');
frag('[ImageBuilder] letter rank helper', IB, 'const panelLetterRank = (letter) => {');
frag('[ImageBuilder] comparator helper', IB, 'const comparePanelLetters = (a, b) => {');
frag('[ImageBuilder] one caption text is drawn at the bottom', IB, '>{effectiveGlobalCaption}</text>');
frag('[ImageBuilder] the toolbar says the order is the letter order', IB,
  'Global caption (click to edit — merges the object sub-captions in letter order)');
frag('[ImageBuilder] …and explains it on hover', IB, 'merges the panel sub-captions in LETTER order (A: … · B: … · C: …)');
frag('[ImageBuilder] the placeholder shows letter order too', IB, "'Merges the object sub-captions (A: …, B: …)'");

/* ══════════════════════════════════════════════════════════════════════════
   2) ONE LETTER SIZE FOR ALL THE PANELS
   ══════════════════════════════════════════════════════════════════════════ */
// Three panels sharing the default size.
const three = [panel('A', 'one', 0, 0), panel('B', 'two', 1, 0), panel('C', 'three', 2, 0)];
const resized = setLetterSizeAll(three, 22);
check('every panel letter is resized at once (not one at a time)',
  resized.map((o) => o.letterStyle.fontSize), [22, 22, 22]);
check('the value typed in the field (a string) is applied as a number',
  setLetterSizeAll(three, '18').map((o) => o.letterStyle.fontSize), [18, 18, 18]);
check('the colour of each panel letter is kept',
  resized.map((o) => o.letterStyle.color), ['#000000', '#000000', '#000000']);
const highlighted = [panel('A', 'one', 0, 0, { color: '#ff0000', bold: false }), panel('B', 'two', 1, 0)];
const afterHighlight = setLetterSizeAll(highlighted, 30);
check('colour and bold stay per panel while the size is shared',
  [afterHighlight[0].letterStyle.color, afterHighlight[0].letterStyle.bold, afterHighlight[0].letterStyle.fontSize],
  ['#ff0000', false, 30]);
checkTrue('an emptied field keeps the current size', setLetterSizeAll(three, '') === three);
checkTrue('a zero is ignored (the letters never vanish)', setLetterSizeAll(three, 0) === three);
checkTrue('a negative size is ignored', setLetterSizeAll(three, -5) === three);
checkTrue('a cleared number field (NaN) is ignored', setLetterSizeAll(three, NaN) === three);
check('an object without a letterStyle is fixed up',
  setLetterSizeAll([{ id: 'legacy', letter: 'A' }], 20)[0].letterStyle.fontSize, 20);
check('an empty canvas stays empty', setLetterSizeAll([], 20), []);

// What the controls display: the shared size, and the panels are unified by the
// first use of the control (a canvas set panel by panel before this change).
const mixed = [panel('A', 'one', 0, 0), panel('B', 'two', 1, 0, { fontSize: 20 })];
check('the control shows the selected panel size', currentLetterPt(mixed, 'obj_B_1_0'), 20);
check('…the first panel when nothing is selected', currentLetterPt(mixed, null), 14);
check('…the default on an empty canvas', currentLetterPt([], null), 14);
check('one use of the control makes every letter match',
  setLetterSizeAll(mixed, currentLetterPt(mixed, 'obj_A_0_0')).map((o) => o.letterStyle.fontSize), [14, 14]);

// A size typed before the first panel exists (or after "Clear Canvas") is kept
// for the panel that comes next instead of snapping back to the default.
const emptyCanvas = setLetterSizeAllWithMemory({ objects: [], fallbackPt: 14 }, 26);
check('an empty canvas remembers the size typed for the next panel',
  currentLetterPt(emptyCanvas.objects, null, emptyCanvas.fallbackPt), 26);
check('…and also when every panel was cleared afterwards',
  currentLetterPt(setLetterSizeAllWithMemory({ objects: [], fallbackPt: 14 }, '30').objects, null, 30), 30);
check('the field still shows a panel size once a panel exists',
  currentLetterPt(setLetterSizeAllWithMemory({ objects: mixed, fallbackPt: 14 }, 18).objects, 'obj_B_1_0', 18), 18);

// The panels added afterwards adopt the shared size, so a new panel never
// breaks the uniform look of the figure.
frag('[ImageBuilder] new panels adopt the shared size', IB,
  "letterStyle: { fontSize: currentLetterPt(), color: currentLetterColor(), bold: currentLetterBold() },");
frag('[ImageBuilder] the shared size helper', IB, 'const currentLetterPt = () => {');
frag('[ImageBuilder] the shared setter writes to EVERY object', IB,
  'setObjects(prev => prev.map(o => ({ ...o, letterStyle: { ...(o.letterStyle || {}), fontSize: size } })));');
frag('[ImageBuilder] an invalid field is ignored', IB, 'if (!Number.isFinite(size) || size <= 0) return; // empty / invalid field → keep the current size');
frag('[ImageBuilder] the letters are drawn at that size', IB, 'fontSize={ptToMm(obj.letterStyle.fontSize)}');
frag('[ImageBuilder] the size is a figure setting (why)', IB, 'The letters of a figure always read alike, so the size is a FIGURE setting,');

// The TWO controls that are left (canvas toolbar + fullscreen toolbar) drive the
// shared setter — none of them writes a single panel any more. The object window
// has no letter field left: the name (A, B, C …) is automatic, and the size is a
// general definition of the canvas.
const wired = IB.split('onChange={e => setLetterSizeAll(e.target.value)}').length - 1;
const shown = IB.split('value={letterPt}').length - 1;
check('the two letter-size controls use the shared setter', wired, 2);
check('…and both show the shared size', shown, 2);
checkTrue('the old per-panel size handler is gone',
  !IB.includes('letterStyle: { ...selectedObj.letterStyle, fontSize: Number(e.target.value) }'));
const letterPtDecl = IB.split('const letterPt = currentLetterPt();').length - 1;
check('the shared size is read once per render', letterPtDecl, 1);
frag('[ImageBuilder] the shared size is remembered for an empty canvas', IB, 'const [letterPtFallback, setLetterPtFallback] = useState(DEFAULT_LETTER_PT);');
frag('[ImageBuilder] …and written by the control', IB, 'setLetterPtFallback(size); // remembered for an empty canvas / a new panel');
frag('[ImageBuilder] canvas toolbar control', IB, 'Letter size (pt)');
frag('[ImageBuilder] fullscreen toolbar control', IB,
  '<input type="number" min="4" max="48" value={letterPt} onChange={e => setLetterSizeAll(e.target.value)} className="border border-slate-300 rounded px-1 py-0.5 text-[11px] w-14 bg-white font-normal" />');
frag('[ImageBuilder] the size field explains it on hover', IB,
  'changing it rescales every panel letter (A, B, C …) at once — no need to set it panel by panel');
checkTrue('the object window no longer carries a letter name / size',
  !IB.includes('Letter Size — all panels (pt)'));

/* ══════════════════════════════════════════════════════════════════════════
   3) THE COLOUR AND THE BOLD ARE GENERAL DEFINITIONS TOO
   — « move the bold and colour option as a general definition » : ils ne sont
   plus réglés panneau par panneau dans la fenêtre de l'objet, mais une fois pour
   tous les panneaux dans les options du canvas (barre d'outils de l'éditeur, et
   barre du plein écran). Mêmes règles que la taille, miroir de
   setLetterColorAll / setLetterBoldAll / currentLetterColor / currentLetterBold.
   ══════════════════════════════════════════════════════════════════════════ */
const setLetterColorAll = (objs, color) => {
  const c = String(color || '').trim() || '#000000';
  return objs.map((o) => ({ ...o, letterStyle: { ...(o.letterStyle || {}), color: c } }));
};
const setLetterBoldAll = (objs, bold) => objs.map((o) => ({ ...o, letterStyle: { ...(o.letterStyle || {}), bold: !!bold } }));
const currentLetterColor = (objs, selId, fallback = '#000000') => {
  const sel = (objs || []).find((o) => o.id === selId);
  const c = sel && sel.letterStyle ? String(sel.letterStyle.color || '').trim() : '';
  if (c) return c;
  const first = (objs || []).find((o) => o && o.letterStyle && String(o.letterStyle.color || '').trim());
  return first ? String(first.letterStyle.color) : fallback;
};
const currentLetterBold = (objs, selId, fallback = true) => {
  const sel = (objs || []).find((o) => o.id === selId);
  if (sel && sel.letterStyle && sel.letterStyle.bold !== undefined) return !!sel.letterStyle.bold;
  const first = (objs || []).find((o) => o && o.letterStyle && o.letterStyle.bold !== undefined);
  return first ? !!first.letterStyle.bold : fallback;
};
check('one colour change repaints every panel letter',
  setLetterColorAll(three, '#ff0000').map((o) => o.letterStyle.color), ['#ff0000', '#ff0000', '#ff0000']);
check('…and leaves the size alone',
  setLetterColorAll(three, '#00ff00').map((o) => o.letterStyle.fontSize), [14, 14, 14]);
check('an emptied colour falls back to black',
  setLetterColorAll(three, '   ').map((o) => o.letterStyle.color), ['#000000', '#000000', '#000000']);
check('an object without a letterStyle is fixed up by the colour too',
  setLetterColorAll([{ id: 'legacy' }], '#123456')[0].letterStyle.color, '#123456');
check('bold follows the same “every panel at once” rule',
  setLetterBoldAll(three, true).map((o) => o.letterStyle.bold), [true, true, true]);
check('…and can be taken off everywhere', setLetterBoldAll(three, 0).map((o) => o.letterStyle.bold), [false, false, false]);
check('the control shows the selected panel colour', currentLetterColor(highlighted, 'obj_A_0_0'), '#ff0000');
check('…the first panel when nothing is selected', currentLetterColor(three, null), '#000000');
check('…and the general value on an empty canvas', currentLetterColor([], null, '#abcdef'), '#abcdef');
check('bold: the selected panel wins',
  currentLetterBold([panel('A', 'x', 0, 0, { bold: false }), panel('B', 'y', 1, 0)], 'obj_A_0_0'), false);
check('bold: the general value on an empty canvas', currentLetterBold([], null, false), false);

frag('[ImageBuilder] the general colour helper', IB, 'const currentLetterColor = () => {');
frag('[ImageBuilder] …its writer', IB, 'const setLetterColorAll = (color) => {');
frag('[ImageBuilder] the general bold helper', IB, 'const currentLetterBold = () => {');
frag('[ImageBuilder] …its writer', IB, 'const setLetterBoldAll = (bold) => {');
frag('[ImageBuilder] canvas toolbar: the letter colour', IB, 'Letter colour');
frag('[ImageBuilder] canvas toolbar: the letter bold', IB,
  '<input type="checkbox" checked={currentLetterBold()} onChange={e => setLetterBoldAll(e.target.checked)} /> Letters bold');
frag('[ImageBuilder] fullscreen toolbar: the colour', IB, 'title="Colour of every panel letter (figure setting)"');
frag('[ImageBuilder] fullscreen toolbar: the bold', IB, 'title="Bold for every panel letter (figure setting)"');
frag('[ImageBuilder] the object window points at the canvas options', IB,
  'automatic (by position) · size / colour / bold: canvas options');
checkTrue('…and no per-panel colour / bold is left there',
  !IB.includes('Letter Color') && !IB.includes('colour and bold are per panel'));
checkTrue('a new panel adopts the general colour and bold',
  IB.includes("letterStyle: { fontSize: currentLetterPt(), color: currentLetterColor(), bold: currentLetterBold() },"));
checkTrue('the general definition travels with the saved canvas',
  IB.includes('if (cd.letterStyle) setLetterStyleDefaults((prev) => ({'));

console.table(results);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `❌ ${failed.length} check(s) failed` : `✅ ${results.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
