// Validates the two UI fixes of this change:
//
//  A) GRAPHS — increasing the "Font size (px)" of a chart made the x-axis TICK
//     NUMBERS climb into the axis line / tick marks, because both tick renderers
//     placed the numbers with a hard-coded offset tuned for ~11 px labels
//     (AngledTick dy = 12; NMRSections y = tickLength + 12). The offset now
//     grows with the character size (keeping the historical value as a floor).
//
//  B) IMAGE BUILDER — changing the number of panels (grid) or the canvas
//     dimensions stretched the figures placed in the panels. The new canvas
//     option "🔒 Keep aspect ratio" draws every figure with its OWN width/height
//     ratio inside its panel cell, so a grid / canvas change only rescales it.
//
// The components (src/components/SharedAnalysisTools.jsx, NMRSections.jsx,
// ImageBuilder.jsx) cannot be imported here (JSX modules), so the rules under
// test are mirrored verbatim. Keep them in sync:
//   * tickLabelOffset()          – SharedAnalysisTools.jsx  (exported helper)
//   * AngledTick dy              – SharedAnalysisTools.jsx  (unrotated branch)
//   * CustomXTick1H/13C labelY   – NMRSections.jsx
//   * objFigureGeom() aspect fit – ImageBuilder.jsx (canvas option keepAspect)
//   * keepAspect default / load  – ImageBuilder.jsx (canvas payload + loader)

// ── mirror: SharedAnalysisTools.jsx ─────────────────────────────────────────
const tickLabelOffset = (tickEnd = 0, fontSize = 11, gap = 3, minOffset = 0) => {
  const fs = Number(fontSize) || 11;
  const end = Number(tickEnd) || 0;
  const floor = Number(minOffset) || 0;
  return Math.max(floor, Math.round(end + gap + fs * 0.72));
};
// AngledTick: tickEnd = tickSize - tickMargin = 6 - 10 = -4, floor = 12 (old dy)
const angledDy = (fontSize, angle = 0) => {
  const fs = Number(fontSize) || 11;
  const grow = Math.max(4, Math.round(4 + Math.max(0, fs - 11) * 0.5));
  return angle ? grow : tickLabelOffset(-4, fs, 3, 12);
};
const OLD_ANGLED_DY = 12;                       // previous hard-coded offset
// recharts places the bottom-axis tick origin at plotBottom + tickSize + tickMargin
const TICK_SIZE = 6;
const TICK_MARGIN = 10;                          // every AngledTick x-axis passes this
const tickOriginY = (plotBottom) => plotBottom + TICK_SIZE + TICK_MARGIN;
const CAP = 0.72;                                // ≈ digit height of the font (em)

// ── mirror: NMRSections.jsx CustomXTick1H / CustomXTick13C ──────────────────
const nmrLabelY = (tickLength, fontSize) =>
  tickLabelOffset(tickLength, fontSize, 3, tickLength + 12);
const OLD_NMR_LABEL_Y = (tickLength) => tickLength + 12;

// ── mirror: ImageBuilder.jsx objFigureGeom() (aspect part) ──────────────────
// cellW = canvasW / gridCols, cellH = canvasH / gridRows, panel = w × h cells.
const figureBox = ({ canvasW, canvasH, gridCols, gridRows, panelW = 1, panelH = 1, cols = 1, rows = 1, pad = 2, scale = 1, aspect = 0, keepAspect = true }) => {
  const cellW = canvasW / gridCols;
  const cellH = canvasH / gridRows;
  const cw = (panelW * cellW) / cols;
  const ch = (panelH * cellH) / rows;
  let iW = (cw - pad * 2) * scale;
  let iH = (ch - pad * 2) * scale;
  const a = keepAspect ? (aspect || 0) : 0;
  if (a > 0 && iW > 0 && iH > 0) {
    if (iW / iH > a) iW = iH * a;
    else iH = iW / a;
  }
  // centring straight from the component (iX/iY keep the figure centred)
  const iX = pad + (cw - pad * 2 - iW) / 2;
  const iY = pad + (ch - pad * 2 - iH) / 2;
  return { iW, iH, iX, iY, cw, ch };
};
// loader of a persisted / saved canvas (ImageBuilder.jsx)
const keepAspectFromSaved = (data) => (data && data.keepAspect !== undefined ? !!data.keepAspect : true);

const results = [];
const check = (name, got, want) => {
  const ok = Math.abs(got - want) < 1e-9;
  results.push({ name, got: Number(got).toFixed(4), want: Number(want).toFixed(4), ok });
  return ok;
};
const checkBool = (name, got, want) => {
  const ok = got === want;
  results.push({ name, got: String(got), want: String(want), ok });
  return ok;
};

/* ══════════════════════════════════════════════════════════════════════════
   A) TICK NUMBERS KEEP THEIR DISTANCE FROM THE AXIS
   ══════════════════════════════════════════════════════════════════════════ */
const SIZES = [8, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48];
const PLOT_BOTTOM = 500;
const marksEnd = PLOT_BOTTOM + TICK_SIZE;              // tick marks are 6 px long
const numTop = (fs, dy) => tickOriginY(PLOT_BOTTOM) + dy - CAP * fs;
const numBottom = (fs, dy) => tickOriginY(PLOT_BOTTOM) + dy + 0.22 * fs; // descent

// The numbers never touch the tick marks, at ANY character size.
SIZES.forEach((fs) => {
  const top = numTop(fs, angledDy(fs));
  checkBool(`AngledTick ${fs} px: numbers start below the tick marks`, top >= marksEnd + 1, true);
});
// …and the old fixed dy broke exactly that for bigger labels (the reported bug).
const oldTopAt = (fs) => numTop(fs, OLD_ANGLED_DY);
checkBool('OLD dy = 12 still fine at 16 px (no visual change)', oldTopAt(16) >= marksEnd + 1, true);
checkBool('OLD dy = 12 climbed into the marks at 32 px (the bug)', oldTopAt(32) > marksEnd, false);
checkBool('OLD dy = 12 climbed above the axis at 40 px (the bug)', oldTopAt(40) < PLOT_BOTTOM, true);
checkBool('FIXED: 32 px stays below the tick marks', numTop(32, angledDy(32)) >= marksEnd + 1, true);
checkBool('FIXED: 40 px stays below the tick marks', numTop(40, angledDy(40)) >= marksEnd + 1, true);

// No visual regression for the sizes people actually use: the historical
// offsets are kept as a floor.
checkBool('AngledTick 11 px keeps the historical dy', angledDy(11) === OLD_ANGLED_DY, true);
checkBool('AngledTick 16 px keeps the historical dy (app default)', angledDy(16) === OLD_ANGLED_DY, true);
checkBool('AngledTick dy only grows with big fonts', angledDy(32) > angledDy(24) && angledDy(24) >= OLD_ANGLED_DY, true);
checkBool('Rotated labels keep a sane offset', angledDy(16, -45) >= 4 && angledDy(32, -45) > angledDy(16, -45), true);

// NMRSections' hand-drawn axes (1D spectrum + HSQC) use the same rule.
const TICK_LENGTHS = [3, 4, 5, 8, 10];
TICK_LENGTHS.forEach((len) => {
  SIZES.forEach((fs) => {
    const top = nmrLabelY(len, fs) - CAP * fs;
    checkBool(`NMR x-tick len ${len} / ${fs} px: clear of the tick mark`, top >= len + 1, true);
  });
  checkBool(`NMR x-tick len ${len}: historical offset kept at 11 px`, nmrLabelY(len, 11) === OLD_NMR_LABEL_Y(len), true);
});
const nmrTopAt = (len, fs) => OLD_NMR_LABEL_Y(len) - CAP * fs;
checkBool('OLD NMR offset overlapped the mark at 32 px (the bug)', nmrTopAt(8, 32) > 8, false);
checkBool('FIXED: NMR offset clear at 32 px', nmrLabelY(8, 32) - CAP * 32 >= 9, true);

/* ══════════════════════════════════════════════════════════════════════════
   B) IMAGE BUILDER — "🔒 Keep aspect ratio"
   ══════════════════════════════════════════════════════════════════════════ */
const FIG = 3 / 2;                                  // a 3:2 figure (e.g. 1800x1200)

// Every grid / canvas combination the user can pick keeps the figure's ratio.
const GRIDS = [
  { canvasW: 180, canvasH: 120, gridCols: 4, gridRows: 5 },
  { canvasW: 180, canvasH: 120, gridCols: 6, gridRows: 5 },
  { canvasW: 180, canvasH: 120, gridCols: 3, gridRows: 7 },
  { canvasW: 240, canvasH: 90, gridCols: 4, gridRows: 5 },
  { canvasW: 90, canvasH: 240, gridCols: 4, gridRows: 5 },
  { canvasW: 300, canvasH: 300, gridCols: 1, gridRows: 1 },
];
GRIDS.forEach((g) => {
  const b = figureBox({ ...g, aspect: FIG, keepAspect: true });
  const label = `${g.canvasW}x${g.canvasH} mm / ${g.gridCols}x${g.gridRows}`;
  check(`figure ratio preserved (${label})`, b.iW / b.iH, FIG);
  checkBool(`figure stays inside the panel (${label})`, b.iW <= b.cw - 4 + 1e-9 && b.iH <= b.ch - 4 + 1e-9, true);
  checkBool(`figure centred in the panel (${label})`, Math.abs(b.iX - (b.cw - b.iW) / 2) < 1e-9 && Math.abs(b.iY - (b.ch - b.iH) / 2) < 1e-9, true);
});

// Without the option the panel cell dictates the shape (the stretching the
// option exists to avoid) — a wide panel really does produce a wide figure box.
const oldWide = figureBox({ canvasW: 180, canvasH: 120, gridCols: 1, gridRows: 5, aspect: FIG, keepAspect: false });
check('OLD (option off): a 1x1 panel in a 5-row grid stretches the box', oldWide.iW / oldWide.iH, (180 - 4) / (24 - 4));
const newWide = figureBox({ canvasW: 180, canvasH: 120, gridCols: 1, gridRows: 5, aspect: FIG, keepAspect: true });
check('NEW (option on): the same panel keeps the figure ratio', newWide.iW / newWide.iH, FIG);

// Ratio unknown (figure still loading / unreachable) → the cell is used, and the
// <image> is rendered with preserveAspectRatio="meet" so nothing is distorted.
const unknown = figureBox({ canvasW: 180, canvasH: 120, gridCols: 4, gridRows: 5, aspect: 0, keepAspect: true });
check('unknown ratio falls back to the panel cell', unknown.iW, 45 - 4);

// Scale (%) still scales the fitted figure, and the ratio survives.
const half = figureBox({ canvasW: 180, canvasH: 120, gridCols: 4, gridRows: 5, aspect: FIG, scale: 0.5, keepAspect: true });
check('scale 50% halves the fitted width', half.iW, newWide.iW * 0.5);
check('scale keeps the ratio', half.iW / half.iH, FIG);

// Multi-figure panels: each sub-cell keeps the ratio too (2 figures side by side).
const multi = figureBox({ canvasW: 180, canvasH: 120, gridCols: 4, gridRows: 5, panelW: 2, panelH: 2, cols: 2, rows: 1, aspect: FIG, keepAspect: true });
check('multi-figure sub-cell keeps the ratio', multi.iW / multi.iH, FIG);
checkBool('multi-figure sub-cell stays inside its cell', multi.iW <= multi.cw - 4 + 1e-9 && multi.iH <= multi.ch - 4 + 1e-9, true);

// The option is canvas-wide and ON by default; canvases saved before it existed
// (and the in-session payload without the flag) keep the aspect-ratio behaviour,
// while an explicit "off" is honoured.
checkBool('new canvas defaults to keep aspect ratio', keepAspectFromSaved({ canvasW: 180 }), true);
checkBool('saved canvas without the flag -> on', keepAspectFromSaved({ objects: [] }), true);
checkBool('saved canvas with the flag off -> off', keepAspectFromSaved({ keepAspect: false }), false);
checkBool('saved canvas with the flag on -> on', keepAspectFromSaved({ keepAspect: true }), true);

console.table(results);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `❌ ${failed.length} check(s) failed` : `✅ ${results.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);


// The numbers must still fit inside the margin the panel reserves for the axis
// (cfgChartMargin grows the bottom margin by 2.2 px per extra font px).
const bottomMargin = (fs) => 45 + Math.max(0, fs - 12) * 2.2;
SIZES.forEach((fs) => {
  const needed = numBottom(fs, angledDy(fs)) - PLOT_BOTTOM;
  checkBool(`AngledTick ${fs} px: numbers fit the axis margin`, needed <= bottomMargin(fs), true);
});

