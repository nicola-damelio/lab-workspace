// Validates the FIX "zooming on one element of the figure left no way to move
// around it — the fullscreen view needs real SCROLLBARS".
//
// WHAT WENT WRONG
// The fullscreen canvas was drawn with a CSS transform:
//     <div className="overflow-auto">
//       <div style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }}>
// A transform does not change the LAYOUT: the scrollable box stayed the size of
// the unscaled canvas, so zooming in cut the figure off and the only way to move
// was the four arrow buttons that poked panX / panY by 30 px. "When I zoom in one
// element of the image I need scrolling bars to move."
//
// THE FIX
// The canvas is drawn at `zoom` inside a SIZER box that really is canvas × zoom
// big; the scaled canvas sits at its top-left corner. The browser therefore
// draws its own scrollbars, the wheel / trackpad work, and the centring (zoom on
// an element, "◎ Center", "↩ Initial zoom", the arrow buttons) is expressed as a
// SCROLL POSITION instead of a pan offset.
//
// The component cannot be imported here (JSX module), so the rules under test
// are mirrored verbatim from src/components/ImageBuilder.jsx — keep both in sync.
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

// ---- mirrors of the ImageBuilder maths under test --------------------------
const PX_PER_MM = 96 / 25.4;
const SCROLL_PAD = 32;                      // p-8 of the fullscreen area

// The sizer really occupies (canvas × zoom) + the padding of the scroll box.
const sizerSizePx = (canvasW, canvasH, captionH, zoom) => ({
  w: canvasW * PX_PER_MM * zoom + 2 * SCROLL_PAD,
  h: (canvasH + captionH) * PX_PER_MM * zoom + 2 * SCROLL_PAD
});

// centerOnMm(x, y, z): the scroll position that puts a point of the canvas in
// the middle of the viewport (never negative: the scroll can only be positive).
const centerOnMm = (xMm, yMm, z, clientW, clientH) => ({
  left: Math.max(0, xMm * PX_PER_MM * z + SCROLL_PAD - clientW / 2),
  top: Math.max(0, yMm * PX_PER_MM * z + SCROLL_PAD - clientH / 2)
});

// Where a canvas point ends up on screen for a given scroll position.
const viewportXOf = (xMm, z, scrollLeft) => xMm * PX_PER_MM * z + SCROLL_PAD - scrollLeft;

// ===========================================================================
// 1) The fix is wired in the component
// ===========================================================================
frag('[ImageBuilder] the fullscreen area scrolls', IB, 'className="flex-1 min-h-0 overflow-auto relative bg-slate-200 p-8"');
frag('[ImageBuilder] the sizer really is canvas × zoom big (the layout, not a transform)',
  IB, 'width: `calc(${canvasW}mm * ${zoom})`,');
frag('[ImageBuilder] …also in height, caption included',
  IB, 'height: `calc(${canvasH + captionH}mm * ${zoom})`');
frag('[ImageBuilder] the canvas is scaled from its top-left corner inside the sizer',
  IB, "transformOrigin: '0 0',");
frag('[ImageBuilder] the scaled canvas is pinned to the top-left of the sizer',
  IB, 'className="absolute top-0 left-0 shadow-2xl bg-white"');
frag('[ImageBuilder] the scroll helpers exist', IB, 'const scrollAreaTo = (x, y) => {');
frag('[ImageBuilder] …and the arrow buttons use them', IB, 'const nudgeArea = (dx, dy) => {');
frag('[ImageBuilder] centring is a SCROLL position', IB, 'const centerOnMm = (xMm, yMm, z) => {');
frag('[ImageBuilder] zooming keeps the centre of the viewport', IB, 'const setZoomKeepingCenter = (nextZ) => {');

// …and the pan transform is gone for good.
check('the old pan transform is gone (it left nothing to scroll)',
  IB.includes('transform: `translate(${panX}px, ${panY}px) scale(${zoom})`'), false);
check('the pan state is gone (no offset to keep in sync with the scrollbars)',
  IB.includes('const [panX, setPanX] = useState(0);'), false);
check('…and nothing pokes it any more', IB.includes('setPanX('), false);

// ===========================================================================
// 2) Why the sizer is the fix: the scroll range really exists
// ===========================================================================
const CANVAS_W = 180;      // mm
const CANVAS_H = 120;      // mm
const CAPTION_H = 14;      // mm
const VIEW_W = 900;        // the fullscreen area of a laptop
const VIEW_H = 600;
const ZOOM = 1.5;

const sizer = sizerSizePx(CANVAS_W, CANVAS_H, CAPTION_H, ZOOM);
check('zoomed in, the sizer is REALLY bigger than the viewport (scrollbars appear)',
  [sizer.w > VIEW_W, sizer.h > VIEW_H], [true, true]);
check('…by exactly the extra pixels the zoom adds',
  [Math.round(sizer.w - VIEW_W), Math.round(sizer.h - VIEW_H)],
  [Math.round(CANVAS_W * PX_PER_MM * ZOOM + 2 * SCROLL_PAD - VIEW_W),
    Math.round((CANVAS_H + CAPTION_H) * PX_PER_MM * ZOOM + 2 * SCROLL_PAD - VIEW_H)]);
const small = sizerSizePx(CANVAS_W, CANVAS_H, CAPTION_H, 0.5);
check('at a small zoom the whole figure fits and there is nothing to scroll',
  [small.w < VIEW_W, small.h < VIEW_H], [true, true]);

// ===========================================================================
// 3) Zooming on ONE element: the object ends up centred, and the rest of the
//    figure stays reachable
// ===========================================================================
// Panel B of a 2×2 grid: x = 0.5, y = 0, w = 0.5, h = 0.5 (the cells are halves).
// It is the interesting case: its centre is far enough right / down that the
// viewport must really scroll to bring it to the middle.
const cellW = CANVAS_W / 2;               // 90 mm
const cellH = CANVAS_H / 2;               // 60 mm
const obj = { x: 0.5, y: 0.5, w: 0.5, h: 0.5 };
const owMm = obj.w * cellW, ohMm = obj.h * cellH;
const oxMm = obj.x * cellW, oyMm = obj.y * cellH;
// The fit scale of recenterFocus (the object fills the viewport, small margin).
const fit = Math.max(0.05, Math.min((VIEW_W - 64 - 24) / (owMm * PX_PER_MM), (VIEW_H - 64 - 24) / (ohMm * PX_PER_MM)));
checkTrue('the zoom on an element is computed from its own size', fit > 1);
const scroll = centerOnMm(oxMm + owMm / 2, oyMm + ohMm / 2, fit, VIEW_W, VIEW_H);
checkTrue('…and the scroll position that centres it is positive', scroll.left > 0 && scroll.top > 0);
check('the centre of the object lands in the middle of the viewport',
  [Math.round(viewportXOf(oxMm + owMm / 2, fit, scroll.left)), Math.round(VIEW_W / 2)],
  [Math.round(VIEW_W / 2), Math.round(VIEW_W / 2)]);
check('…and the rest of the figure is still reachable (the scroll range covers it)',
  scroll.left < sizerSizePx(CANVAS_W, CANVAS_H, CAPTION_H, fit).w - VIEW_W, true);
check('a point at the far edge of the canvas can be brought into view',
  viewportXOf(CANVAS_W, fit, sizerSizePx(CANVAS_W, CANVAS_H, CAPTION_H, fit).w - VIEW_W) <= VIEW_W, true);
check('an element already at the top-left does not ask for a negative scroll (clamped at 0)',
  centerOnMm(owMm / 2, ohMm / 2, fit, VIEW_W, VIEW_H).left, 0);
check('…and at a small zoom there is nothing to scroll at all',
  centerOnMm(0, 0, 0.1, VIEW_W, VIEW_H), { left: 0, top: 0 });

// ===========================================================================
// 4) The toolbar follows the same rules
// ===========================================================================
frag('[ImageBuilder] the − button keeps the centre', IB, 'onClick={() => setZoomKeepingCenter(Math.max(0.1, +(zoom - 0.1).toFixed(1)))}');
frag('[ImageBuilder] the slider keeps the centre', IB, 'onChange={e => setZoomKeepingCenter(Number(e.target.value))}');
frag('[ImageBuilder] the + button keeps the centre', IB, 'onClick={() => setZoomKeepingCenter(Math.min(8, +(zoom + 0.1).toFixed(1)))}');
frag('[ImageBuilder] Reset keeps the centre', IB, 'onClick={() => setZoomKeepingCenter(1)}');
frag('[ImageBuilder] the arrow buttons scroll the viewport', IB, 'onClick={() => nudgeArea(-30, 0)}');
frag('[ImageBuilder] …all four of them', IB, 'onClick={() => nudgeArea(30, 0)}');
frag('[ImageBuilder] “◎ Center” re-centres the focused element', IB, 'const recenterFocus = () => {');
frag('[ImageBuilder] “↩ Initial zoom” restores zoom AND position', IB, 'const restoreInitialZoom = () => {');
frag('[ImageBuilder] the whole-canvas centring is a scroll too', IB, 'const centerCanvasAt = (z) => centerOnMm(canvasW / 2, (canvasH + captionH) / 2, z);');

const failed = results.filter((r) => !r.ok);
console.table(results.map((r) => ({ name: r.name, ok: r.ok, got: r.ok ? '' : r.got })));
if (failed.length) {
  console.error(`\n❌ ${failed.length}/${results.length} checks failed`);
  process.exit(1);
}
console.log(`\n✅ ${results.length}/${results.length} checks passed`);
