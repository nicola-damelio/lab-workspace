// Validates the Image Builder cropping feature (and the two commands that were
// removed with it):
//
//  1) CROP — a figure can be cropped to a window of the ORIGINAL image.
//     The window is stored per figure in SOURCE units (x1/y1 top-left, x2/y2
//     bottom-right, 0 = the edge of the source, 1 = the other edge), so it
//     survives a change of panel size, grid or canvas dimensions, the undo
//     stack and the localStorage copy. On the canvas, "✂️ Crop" arms the mode
//     and a DRAG over the figure draws the window (mouse release applies it);
//     a crop only ever REFINES the current window (the parts already removed
//     never come back). The figure is drawn with the crop window filling its
//     panel.
//
//  2) THE "SHIFT X / SHIFT Y" NUMBER COMMANDS ARE GONE — the image is shifted
//     by dragging it on the canvas (or Shift+drag the object frame), which is
//     the natural gesture.
//
//  3) THE "LEFT / RIGHT / TOP / BOTTOM (%)" NUMBER FIELDS ARE GONE TOO — « remove
//     commands like the left, right, top, bottom values of crop (crop only by
//     mouse) ». A crop is drawn on the canvas, and 🎯 Precision (or Shift) gives
//     the gesture the tenth of a percent (see FINE_GAIN in onDrag).
//
//  4) THE LETTER SIZE IS A FIGURE-WIDE SETTING (no per-panel resize) — and so are
//     the colour and the bold of the letters.
//
// The component cannot be imported here (JSX module), so the rules under test
// are mirrored verbatim from src/components/ImageBuilder.jsx — keep both in sync:
//   * cropOf()            (validation of a stored window)
//   * objFigureGeom()     (visible window vs drawn rect of a cropped figure)
//   * the crop drag math  (startCropDrag / onDrag 'crop' / endDrag)
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
const frag = (name, hay, needle) => checkTrue(`${name}: ${needle.slice(0, 40)}…`, hay.includes(needle));

// ── mirror: ImageBuilder.jsx (crop) ─────────────────────────────────────────
const CROP_MIN = 0.02;
const cropOf = (im) => {
  const c = im && im.crop;
  if (!c) return null;
  const nums = ['x1', 'y1', 'x2', 'y2'].map((k) => Math.max(0, Math.min(1, Number(c[k]))));
  if (nums.some((v) => !Number.isFinite(v))) return null;
  const [x1, y1, x2, y2] = nums;
  if (!(x2 - x1 >= CROP_MIN && y2 - y1 >= CROP_MIN)) return null;
  // A window that covers the whole image is NOT a crop: the figure is drawn
  // by the historical path (browser aspect fitting) again.
  if (x1 <= 0 && y1 <= 0 && x2 >= 1 && y2 >= 1) return null;
  return { x1, y1, x2, y2 };
};

// Geometry of one figure: cellW/cellH = the figure cell, aspect = natural w/h
// ratio of the source (0 = unknown), keepAspectOnCanvas = the canvas option.
const figureGeom = ({ cellW, cellH, pad = 0, scale = 1, aspect = 0, fit = 'contain', keepAspectOnCanvas = true, crop = null }) => {
  const cw = cellW;
  const ch = cellH;
  const cropW = crop ? crop.x2 - crop.x1 : 1;
  const cropH = crop ? crop.y2 - crop.y1 : 1;
  let iW = (cw - pad * 2) * scale;
  let iH = (ch - pad * 2) * scale;
  const natAspect = keepAspectOnCanvas || crop ? aspect : 0;
  const boxAspect = natAspect > 0 && (keepAspectOnCanvas || crop)
    ? (fit === 'stretch' && crop ? 0 : natAspect * (cropW / cropH))
    : 0;
  if (boxAspect > 0 && iW > 0 && iH > 0) {
    if (iW / iH > boxAspect) iW = iH * boxAspect;
    else iH = iW / boxAspect;
  }
  const vX = pad + (cw - pad * 2 - iW) / 2;
  const vY = pad + (ch - pad * 2 - iH) / 2;
  if (!crop) return { iX: vX, iY: vY, iW, iH, vX, vY, vW: iW, vH: iH, crop: null };
  const dW = iW / cropW;
  const dH = iH / cropH;
  return { iX: vX - crop.x1 * dW, iY: vY - crop.y1 * dH, iW: dW, iH: dH, vX, vY, vW: iW, vH: iH, crop };
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Pointer → source units (through the DRAWN rect) and the refine-only window.
const toSrc = (clientPt, view) => ({
  x: clamp((clientPt.x - view.left) / view.w, 0, 1),
  y: clamp((clientPt.y - view.top) / view.h, 0, 1)
});
const refineWindow = (base, from, cur) => ({
  x1: Math.max(base.x1, Math.min(from.x, cur.x)),
  y1: Math.max(base.y1, Math.min(from.y, cur.y)),
  x2: Math.min(base.x2, Math.max(from.x, cur.x)),
  y2: Math.min(base.y2, Math.max(from.y, cur.y))
});
/* ══ 1. a stored crop window is validated ══════════════════════════════════ */
check('no crop property → no crop', cropOf({}), null);
check('an undefined figure → no crop', cropOf(undefined), null);
check('a full-image window is not a crop', cropOf({ crop: { x1: 0, y1: 0, x2: 1, y2: 1 } }), null);
check('a 1 % window is refused (CROP_MIN = 2 %)', cropOf({ crop: { x1: 0.5, y1: 0.5, x2: 0.51, y2: 0.9 } }), null);
check('a valid window is kept', cropOf({ crop: { x1: 0.25, y1: 0.1, x2: 0.75, y2: 0.6 } }),
  { x1: 0.25, y1: 0.1, x2: 0.75, y2: 0.6 });
check('values are clamped to 0…1', cropOf({ crop: { x1: -0.3, y1: -1, x2: 0.8, y2: 0.6 } }),
  { x1: 0, y1: 0, x2: 0.8, y2: 0.6 });
check('a window that covers the whole image is no crop at all',
  cropOf({ crop: { x1: -0.3, y1: -1, x2: 1.4, y2: 2 } }), null);
check('a NaN window is refused', cropOf({ crop: { x1: 'a', y1: 0, x2: 1, y2: 1 } }), null);
check('string numbers (persisted JSON) are accepted', cropOf({ crop: { x1: '0.2', y1: '0.2', x2: '0.8', y2: '0.8' } }),
  { x1: 0.2, y1: 0.2, x2: 0.8, y2: 0.8 });

/* ══ 2. an uncropped figure is unchanged ══════════════════════════════════ */
const plain = figureGeom({ cellW: 100, cellH: 100, aspect: 2, keepAspectOnCanvas: true });
check('uncropped: the drawn rect IS the visible box', [plain.iX === plain.vX, plain.iY === plain.vY], [true, true]);
check('uncropped: a wide figure stays wide', [plain.iW, plain.iH], [100, 50]);
check('uncropped: no crop flag', plain.crop, null);

/* ══ 3. a cropped figure: the window fills the panel ══════════════════════ */
// Source 4:3 (aspect 1.333), crop window 0.5 wide × 0.75 tall → window ratio 0.888.
const crop = { x1: 0.25, y1: 0.125, x2: 0.75, y2: 0.875 };
const g = figureGeom({ cellW: 200, cellH: 100, aspect: 4 / 3, keepAspectOnCanvas: true, crop });
const close = (a, b) => Math.abs(a - b) < 1e-9;
checkTrue('cropped: the visible box follows the WINDOW ratio (0.5×0.75 of a 4:3 source)',
  close(g.vW / g.vH, ((4 / 3) * 0.5) / 0.75));
checkTrue('cropped: the window lands exactly on the visible box (left)', close(g.iX + crop.x1 * g.iW, g.vX));
checkTrue('cropped: the window lands exactly on the visible box (top)', close(g.iY + crop.y1 * g.iH, g.vY));
checkTrue('cropped: the drawn full image is BIGGER than the window', g.iW > g.vW + 0.01 && g.iH > g.vH + 0.01);
checkTrue('cropped: the drawn image overflows the panel on the cropped-away sides',
  g.iX < g.vX - 0.01 && g.iY < g.vY - 0.01);
checkTrue('cropped: the visible box stays inside the 200×100 cell',
  g.vX >= -1e-9 && g.vY >= -1e-9 && g.vX + g.vW <= 200 + 1e-9 && g.vY + g.vH <= 100 + 1e-9);
checkTrue('cropped: the drawn rect keeps the SOURCE ratio (uniform enlargement)',
  close(g.iW / g.iH, 4 / 3));
// A crop with "Stretch" fills the cell (no ratio fitting).
const stretched = figureGeom({ cellW: 200, cellH: 100, aspect: 4 / 3, keepAspectOnCanvas: false, fit: 'stretch', crop });
check('cropped + Stretch: the window fills the cell', [stretched.vW, stretched.vH], [200, 100]);
// The uncropped geometry is untouched by the crop code path.
const noCanvasAspect = figureGeom({ cellW: 200, cellH: 100, aspect: 4 / 3, keepAspectOnCanvas: false });
check('uncropped + no “Keep aspect ratio”: the cell is used as before', [noCanvasAspect.iW, noCanvasAspect.iH], [200, 100]);

/* ══ 4. the numeric % fields are GONE (crop by mouse only) ═════════════════ */
// « remove commands like the left, right, top, bottom values of crop (crop only
// by mouse) » : the four fields used to write an edge of the window at the
// keyboard (setCropEdge); the crop is now drawn on the canvas and refined with
// 🎯 Precision, so the fields — and their clamping rules — have no caller left.
checkTrue('the numeric crop fields are gone from the component',
  !IB.includes('onChange={(e) => setCropEdge(selectedObj.id, cropPanelIdx, edge, e.target.value)}'));
checkTrue('…and so is their writer', !IB.includes('const setCropEdge = (objId, idx, edge, pct) => {'));
checkTrue('no “Left (%)” / “Bottom (%)” label survives', !/\['x1', 'Left'\]/.test(IB));
// Ce qui RESTE du recadrage : le mode, la remise à zéro et le compte-rendu.
checkTrue('the crop mode is still armed from the properties panel',
  IB.includes('onClick={() => toggleCropMode(selectedObj.id, cropPanelIdx)}'));
checkTrue('“Reset crop” is still there', IB.includes('⟲ Reset crop'));
checkTrue('the window that is kept is still reported',
  IB.includes('const cropPct = (v) => Math.round((Number(v) || 0) * 1000) / 10;'));
checkTrue('…and the gesture is still documented where it is triggered',
  IB.includes('Drag a rectangle on the canvas over the figure'));
// 🎯 Precision : le geste de recadrage suit un QUART du pointeur quand il est on.
checkTrue('the crop drag knows the fine mode', IB.includes('const nx = fineDrag ? st.from.x + (rawX - st.from.x) * FINE_GAIN : rawX;'));
checkTrue('…and Shift arms it without the keyboard leaving the mouse', IB.includes('const fineDrag = !!(fineModeRef.current || e.shiftKey);'));

/* ══ 5. the crop drag ════════════════════════════════════════════════════ */
const view = { left: 100, top: 50, w: 400, h: 300 };
check('drag: the pointer is converted into source units', toSrc({ x: 200, y: 200 }, view), { x: 0.25, y: 0.5 });
check('drag: outside the figure is clamped', toSrc({ x: 0, y: 9999 }, view), { x: 0, y: 1 });
check('drag: a first window is the rectangle drawn',
  refineWindow({ x1: 0, y1: 0, x2: 1, y2: 1 }, { x: 0.2, y: 0.2 }, { x: 0.7, y: 0.6 }),
  { x1: 0.2, y1: 0.2, x2: 0.7, y2: 0.6 });
check('drag: the rectangle is normalised (dragged bottom-right → top-left)',
  refineWindow({ x1: 0, y1: 0, x2: 1, y2: 1 }, { x: 0.7, y: 0.6 }, { x: 0.2, y: 0.2 }),
  { x1: 0.2, y1: 0.2, x2: 0.7, y2: 0.6 });
check('drag: a crop only ever REFINES the current window (nothing comes back)',
  refineWindow({ x1: 0.3, y1: 0.3, x2: 0.7, y2: 0.7 }, { x: 0.33, y: 0.5 }, { x: 0.9, y: 0.9 }),
  { x1: 0.33, y1: 0.5, x2: 0.7, y2: 0.7 });
check('drag: a start OUTSIDE the current window is pulled onto its edge',
  refineWindow({ x1: 0.3, y1: 0.3, x2: 0.7, y2: 0.7 }, { x: 0.05, y: 0.05 }, { x: 0.5, y: 0.5 }),
  { x1: 0.3, y1: 0.3, x2: 0.5, y2: 0.5 });

/* ══ 6. wiring in src/components/ImageBuilder.jsx ════════════════════════ */
frag('[crop] the mode is state', IB, 'const [cropMode, setCropMode] = useState(null);   // { objId, idx }');
frag('[crop] the live rectangle is state', IB, 'const [cropDraft, setCropDraft] = useState(null); // live rectangle { x1, y1, x2, y2 }');
frag('[crop] the validator', IB, 'const cropOf = (im) => {');
frag('[crop] the smallest window', IB, 'const CROP_MIN = 0.02;');
frag('[crop] a crop clip path is declared per figure', IB, 'id={`figclip-${obj.id}-${i}`}');
frag('[crop] the drawn image is clipped to that window', IB, 'clipPath={`url(#figclip-${obj.id}-${i})`}');
frag('[crop] …with an exact pixel mapping', IB, 'preserveAspectRatio="none"');
frag('[crop] the drag handler', IB, 'onMouseDown={(e) => startCropDrag(e, obj.id, activeFigIdx(obj))}');
frag('[crop] the drag type', IB, "if (type === 'crop') {");
frag('[crop] the release applies the window', IB, 'applyCropRect(st.id, st.imgIdx, {');
frag('[crop] the window is written on the right figure', IB,
  'const imgs = getObjImages(o).map((im, i) => (i === idx ? { ...im, crop: rect } : im));');
frag('[crop] the dimmed overlay + dashed window are screen-only', IB, 'data-selection-ui="true" clipPath={`url(#clip-${obj.id})`}');
frag('[crop] the button arms the mode', IB, 'onClick={() => toggleCropMode(selectedObj.id, cropPanelIdx)}');
frag('[crop] “Reset crop”', IB, '⟲ Reset crop');
checkTrue('the numeric crop fields are gone from the component',
  !IB.includes('onChange={(e) => setCropEdge(selectedObj.id, cropPanelIdx, edge, e.target.value)}'));
frag('[crop] the figure list picks the active figure', IB, 'onClick={() => setActiveFig({ objId: selectedObj.id, idx: i })}');
frag('[crop] the % shown in the panel', IB, 'const cropPct = (v) => Math.round((Number(v) || 0) * 1000) / 10;');
frag('[crop] the crop survives the localStorage / undo copy', IB,
  'const images = getObjImagesOf(obj).map((im) => ({ ...im, imgSrc: im.imgThumb || im.imgSrc }));');
frag('[crop] the properties panel documents the gesture', IB, 'Drag a rectangle on the canvas over the figure');
frag('[crop] the button is disabled without a figure', IB, 'disabled={cropPanelIdx < 0}');
frag('[crop] an uncropped figure draws exactly as before', IB, 'const par = keepAspect ? \'xMidYMid meet\' : fit === \'cover\' ? \'xMidYMid slice\' : fit === \'stretch\' ? \'none\' : \'xMidYMid meet\';');
frag('[crop] hit-testing uses the VISIBLE window', IB, 'if (xMm >= g.vX && xMm <= g.vX + g.vW && yMm >= g.vY && yMm <= g.vY + g.vH) hits.push(i);');

/* ══ 7. the removed Shift X / Shift Y commands ═══════════════════════════ */
checkTrue('the “Shift X (mm)” number command is gone', !IB.includes('Shift X (mm)'));
checkTrue('the “Shift Y (mm)” number command is gone', !IB.includes('Shift Y (mm)'));
checkTrue('…but dragging the image on the canvas still shifts it',
  IB.includes('title="Drag to shift the image inside the frame'));
checkTrue('…and Shift+drag still does',
  IB.includes('Hold Shift while dragging the object frame to SHIFT the image instead.'));

/* ══ 8. the letter style is figure-wide (size / colour / bold) ═══════════ */
check('the letter size is written to every panel at once', IB.split('onChange={e => setLetterSizeAll(e.target.value)}').length - 1, 2);
checkTrue('no per-panel letter resize survives',
  !IB.includes('letterStyle: { ...selectedObj.letterStyle, fontSize:'));
checkTrue('the colour of every letter is written the same way',
  IB.includes('setObjects(prev => prev.map(o => ({ ...o, letterStyle: { ...(o.letterStyle || {}), color: c } })));'));
checkTrue('…and so is the bold',
  IB.includes('setObjects(prev => prev.map(o => ({ ...o, letterStyle: { ...(o.letterStyle || {}), bold: b } })));'));
checkTrue('the object window no longer carries a per-panel colour / bold',
  !IB.includes('Letter Color') && !IB.includes('Colour of THIS panel'));

const failed = results.filter((r) => !r.ok);
console.table(results);
if (failed.length) {
  console.error(`\n❌ ${failed.length}/${results.length} checks failed`);
  process.exit(1);
}
console.log(`\n✅ ${results.length}/${results.length} checks passed`);

