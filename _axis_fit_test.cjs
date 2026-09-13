// Validates the "the axis numbers / the axis title go out of the chart, and the
// x & y ORIGIN numbers overlap" fix of the experiment graphs.
//
// Reproduced by raising the "Font size (px)" of a graph's Graphical Parameters:
//   • the first number of the x axis (the origin one) was CENTRED on the very
//     left edge of the plot, so half of it reached into the y-axis gutter and
//     collided with the y number of the origin (bottom-left corner); the last
//     number did the same on the right, past the chart edge;
//   • the x axis title was placed with an offset that ignored the height of the
//     digits, so at the sizes in use it overlapped the numbers and, with angled
//     labels or a big font, it was pushed out of the chart (a chart is an
//     <svg>: whatever the margin does not reserve is clipped);
//   • the y axis numbers outgrow the (fixed) 60 px axis gutter as the
//     characters grow and were cut on the left edge of the chart.
//
// The components cannot be imported here (JSX modules), so the rules under test
// are mirrored verbatim from src/components/SharedAnalysisTools.jsx — keep both
// in sync:
//   * tickLabelOffset / angledTickDy          (also pinned by _axis_aspect_test)
//   * tickNumberWidth / yTickNumberBand / yAxisTitleOffset
//   * xTickNumberExtent / xAxisTitleOffset / extremeTickAnchor
//   * cfgAxisLabel offset / cfgChartMargin
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SAT = fs.readFileSync(path.join(ROOT, 'src/components/SharedAnalysisTools.jsx'), 'utf8');

// ── mirror: SharedAnalysisTools.jsx ─────────────────────────────────────────
const tickLabelOffset = (tickEnd = 0, fontSize = 11, gap = 3, minOffset = 0) => {
  const f = Number(fontSize) || 11;
  const end = Number(tickEnd) || 0;
  const floor = Number(minOffset) || 0;
  return Math.max(floor, Math.round(end + gap + f * 0.72));
};
const angledTickDy = (fontSize, angle = 0) => {
  const f = Number(fontSize) || 11;
  if (Number(angle) || 0) return Math.max(4, Math.round(4 + Math.max(0, f - 11) * 0.5));
  return tickLabelOffset(-4, f, 3, 12);
};
const TICK_CHARS = 6;
const AVG_GLYPH_EM = 0.55;
const CAP_EM = 0.72;
const DESCENT_EM = 0.22;
const Y_AXIS_GUTTER = 60;
const tickNumberWidth = (fontSize, chars = TICK_CHARS) =>
  Math.round((Number(chars) || 0) * (Number(fontSize) || 11) * AVG_GLYPH_EM);
const yTickNumberBand = (fontSize, gutter = Y_AXIS_GUTTER) =>
  Math.max(0, Math.round(6 + 10 + tickNumberWidth(fontSize) - (Number(gutter) || Y_AXIS_GUTTER)));
const axisTitleFontSize = (fontSize) => (Number(fontSize) || 11) + 1;
const axisTitleCap = (fontSize) => Math.round(axisTitleFontSize(fontSize) * CAP_EM);
const axisTitleDescent = (fontSize) => Math.round(axisTitleFontSize(fontSize) * DESCENT_EM);
const yAxisTitleOffset = (fontSize) => yTickNumberBand(fontSize) + axisTitleDescent(fontSize) + 4;
const xTickNumberExtent = (fontSize, tickAngle = 0) => {
  const f = Number(fontSize) || 11;
  const a = Math.abs(Number(tickAngle) || 0);
  const origin = 6 + 10;                       // tickSize + tickMargin
  if (a > 0) {
    const w = tickNumberWidth(f, 4);
    const drop = w * Math.sin((Math.min(a, 90) * Math.PI) / 180);
    return Math.round(origin + angledTickDy(f, a) + f * CAP_EM + drop);
  }
  return Math.round(origin + angledTickDy(f, 0) + f * DESCENT_EM);
};
const xAxisTitleOffset = (fontSize, tickAngle = 0, base = 25, extra = 0, gap = 0) =>
  Math.max(
    (Number(base) || 0) + (Number(extra) || 0) * 1.6,
    xTickNumberExtent(fontSize, tickAngle) + axisTitleCap(fontSize) + 4
  ) + (Number(gap) || 0);
const extremeTickAnchor = (index, visibleTicksCount, fallback = 'middle') => {
  const i = Number(index);
  const n = Number(visibleTicksCount);
  if (!Number.isFinite(i) || !Number.isFinite(n) || n < 2) return { textAnchor: fallback, dx: 0 };
  if (i <= 0) return { textAnchor: 'start', dx: 2 };
  if (i >= n - 1) return { textAnchor: 'end', dx: -2 };
  return { textAnchor: fallback, dx: 0 };
};


const axisLabelGapOf = (cfg, axis) => {
  const raw = axis === 'x' ? cfg.xAxisLabelGap : cfg.yAxisLabelGap;
  if (raw === '' || raw === null || raw === undefined) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};
const extraOf = (f, angle) => Math.max(0, f - 12) + (Math.abs(Number(angle) || 0) > 0 ? 8 : 0);
const cfgAxisLabelOffset = (cfg, axis = 'x', base) => {
  const f = Number(cfg.fontSize) || 16;
  const extra = extraOf(f, cfg.tickAngle);
  const gap = axisLabelGapOf(cfg, axis);
  const offset = axis === 'x'
    ? xAxisTitleOffset(f, cfg.tickAngle, base ?? 25, extra, gap)
    : Math.max((base ?? 20) + extra * 1.6, yAxisTitleOffset(f)) + gap;
  return Math.abs(offset);
};
const cfgChartMargin = (cfg = {}, base = { top: 20, right: 20, bottom: 45, left: 50 }) => {
  const f = Number(cfg.fontSize) || 16;
  const angle = Number(cfg.tickAngle) || 0;
  const extra = Math.max(0, f - 12);
  const xGap = Math.max(0, axisLabelGapOf(cfg, 'x'));
  const yGap = Math.max(0, axisLabelGapOf(cfg, 'y'));
  const xNeed = Math.round(xAxisTitleOffset(f, angle, 25, extra, xGap) + axisTitleFontSize(f) * DESCENT_EM + 2);
  const yNeed = Math.round(Math.max(20 + extra * 1.6, yAxisTitleOffset(f)) + axisTitleCap(f) + 2 + yGap);
  return {
    ...base,
    bottom: Math.max((base.bottom ?? 45) + extra * 2.2, xNeed),
    left: Math.max((base.left ?? 50) + extra * 2.2, yNeed)
  };
};
// the pre-fix versions, to document what used to happen
const OLD_xTitleOffset = (f, angle, base = 25) => base + extraOf(f, angle) * 1.6;
const OLD_marginBottom = (f) => 45 + Math.max(0, f - 12) * 2.2;

const results = [];
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push({ name, got: String(got), want: String(want), ok });
  return ok;
};
const checkBool = (name, got) => {
  results.push({ name, got: String(got), want: 'true', ok: got === true });
  return got === true;
};
const frag = (name, needle) => checkBool(`${name}: ${needle.slice(0, 40)}…`, SAT.includes(needle));
const checkTrue = checkBool;

const SIZES = [8, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48];
const ANGLES = [0, 45, -45, 90];

/* ══════════════════════════════════════════════════════════════════════════
   1) THE x NUMBER OF THE ORIGIN NO LONGER REACHES INTO THE y AXIS
   ══════════════════════════════════════════════════════════════════════════ */
// recharts anchors every bottom-axis number 'middle', i.e. centred on the tick
// coordinate, and the tick of the origin sits ON the left edge of the plot:
// half of the number used to land in the y-axis gutter, exactly where the
// lowest y number is drawn. The extreme ticks are now anchored inside.
const halfWidth = (f) => tickNumberWidth(f, 4) / 2;
const oldFirstLeft = (f) => -halfWidth(f);
const oldLastRight = (f) => halfWidth(f);
const newFirstLeft = (f, n) => {
  const a = extremeTickAnchor(0, n);
  return a.textAnchor === 'start' ? a.dx : -halfWidth(f);
};
const newLastRight = (f, n) => {
  const a = extremeTickAnchor(n - 1, n);
  return a.textAnchor === 'end' ? a.dx : halfWidth(f);
};
SIZES.forEach((f) => {
  checkBool(`OLD ${f} px: the first x number reached ${Math.round(-oldFirstLeft(f))} px left of the plot`,
    oldFirstLeft(f) < 0);
  checkBool(`FIXED ${f} px: it starts on the plot edge`, newFirstLeft(f, 6) >= 0);
  checkBool(`FIXED ${f} px: the last number is pulled back inside`, newLastRight(f, 6) < oldLastRight(f));
  if (f >= 24) {
    // …and from ~24 px up it really ran past the (≈20 px) right margin.
    checkBool(`OLD ${f} px: the last x number ran ${Math.round(oldLastRight(f))} px past the right edge`,
      oldLastRight(f) > 20);
  }
});
check('the middle number keeps the centred anchor', extremeTickAnchor(2, 6), { textAnchor: 'middle', dx: 0 });
check('the first number is start-anchored with a small inset', extremeTickAnchor(0, 6), { textAnchor: 'start', dx: 2 });
check('the last number is end-anchored with a small inset', extremeTickAnchor(5, 6), { textAnchor: 'end', dx: -2 });
check('a lone number is left alone', extremeTickAnchor(0, 1), { textAnchor: 'middle', dx: 0 });
check('an unknown index is left alone', extremeTickAnchor(undefined, 6), { textAnchor: 'middle', dx: 0 });
check('a custom anchor is honoured for the middle', extremeTickAnchor(3, 6, 'start').textAnchor, 'start');
// Rotated labels anchor on their own side (start/end by sign) — untouched.
checkBool('the rotated branch keeps its own offset', angledTickDy(16, 45) === 7 && angledTickDy(32, 45) === 15);

/* ══════════════════════════════════════════════════════════════════════════
   2) THE NUMBERS AND BOTH TITLES STAY INSIDE THE CHART
   ══════════════════════════════════════════════════════════════════════════ */
SIZES.forEach((f) => {
  ANGLES.forEach((angle) => {
    const m = cfgChartMargin({ fontSize: f, tickAngle: angle });
    const extent = xTickNumberExtent(f, angle);
    const cap = axisTitleCap(f);
    const descent = axisTitleDescent(f);
    const xTitle = cfgAxisLabelOffset({ fontSize: f, tickAngle: angle }, 'x');
    const band = yTickNumberBand(f);
    const yTitle = cfgAxisLabelOffset({ fontSize: f, tickAngle: angle }, 'y');
    const label = `${f} px / ${angle}°`;
    // x numbers: never climb into the tick marks / above the axis line…
    checkBool(`x numbers start below the tick marks (${label})`, extent - f * CAP_EM >= 6);
    // …and never run out of the margin (they are not clipped).
    checkBool(`x numbers stay inside the chart (${label})`, extent <= m.bottom);
    // the title sits UNDER the numbers (its own cap height cleared)…
    checkBool(`x title starts below the numbers (${label})`, xTitle - cap >= extent - 1);
    // …and stays inside the margin as well.
    checkBool(`x title stays inside the chart (${label})`, xTitle + descent <= m.bottom);
    // y side: the numbers that outgrow the axis gutter stay inside the chart…
    checkBool(`y numbers stay inside the chart (${label})`, band + 2 <= m.left);
    // …the title is pushed left of them…
    checkBool(`y title clears the y numbers (${label})`, yTitle >= band + descent - 1);
    // …and is not clipped either.
    checkBool(`y title stays inside the chart (${label})`, yTitle + cap + 2 <= m.left);
  });
});

// The reported bug, at the sizes people actually use.
const DEFAULT_FS = 16;
checkBool('OLD: the 16 px x title overlapped the numbers',
  OLD_xTitleOffset(DEFAULT_FS, 0) - axisTitleCap(DEFAULT_FS) < xTickNumberExtent(DEFAULT_FS, 0));
checkBool('FIXED: it now sits below them',
  cfgAxisLabelOffset({ fontSize: DEFAULT_FS }, 'x') - axisTitleCap(DEFAULT_FS) >= xTickNumberExtent(DEFAULT_FS, 0));
// Angled labels are the case where the numbers really did not fit the margin:
// a 45° label reaches down by its own width, well past the historical margin.
checkBool('OLD: the angled numbers of 16 px did not fit the historical margin',
  xTickNumberExtent(16, 45) > OLD_marginBottom(16));
checkBool('FIXED: they fit',
  xTickNumberExtent(16, 45) <= cfgChartMargin({ fontSize: 16, tickAngle: 45 }).bottom);


/* ══════════════════════════════════════════════════════════════════════════
   3) NO VISUAL REGRESSION AT THE SIZES ALREADY IN USE
   ══════════════════════════════════════════════════════════════════════════ */
// The historical margin growth (2.2 px per extra font px) is kept as a floor…
checkBool('the 16 px bottom margin keeps the historical 53.8 as its floor',
  cfgChartMargin({ fontSize: 16 }).bottom >= 45 + 4 * 2.2 && cfgChartMargin({ fontSize: 16 }).bottom <= 54.5);
check('the 32 px bottom margin is unchanged', cfgChartMargin({ fontSize: 32 }).bottom, 89);
check('the 16 px left margin is unchanged', cfgChartMargin({ fontSize: 16 }).left, 58.8);
check('the 12 px left margin is untouched', cfgChartMargin({ fontSize: 12 }).left, 50);
checkBool('the historical growth still wins where it is bigger (24 px)',
  cfgChartMargin({ fontSize: 24 }).bottom >= 45 + 12 * 2.2);
// …the y title keeps its historical offset while the numbers fit the gutter…
check('the 16 px y title keeps its offset', cfgAxisLabelOffset({ fontSize: 16 }, 'y'), 26.4);
checkBool('≈4 characters still fit the 60 px gutter at 16 px', yTickNumberBand(16) <= 10);
checkBool('the y title only moves out once the numbers outgrow the gutter (24 px)',
  yAxisTitleOffset(24) > 20 + 12 * 1.6 && cfgAxisLabelOffset({ fontSize: 24 }, 'y') === yAxisTitleOffset(24));
// …and a chart whose base margin is small still gets what it needs.
const small = cfgChartMargin({ fontSize: 16 }, { top: 8, right: 16, bottom: 30, left: 12 });
checkBool('a small base margin is raised to the geometry (bottom)',
  small.bottom >= Math.round(cfgAxisLabelOffset({ fontSize: 16 }, 'x') + axisTitleDescent(16) + 2));
checkBool('a small base margin is raised to the geometry (left)',
  small.left >= Math.round(cfgAxisLabelOffset({ fontSize: 16 }, 'y') + axisTitleCap(16) + 2));
checkBool('an unknown font size falls back to the 16 px default',
  cfgChartMargin({}).bottom === cfgChartMargin({ fontSize: 16 }).bottom);

/* ══════════════════════════════════════════════════════════════════════════
   4) THE AXIS-TITLE GAP CONTROL STILL WORKS
   ══════════════════════════════════════════════════════════════════════════ */
const gapCfg = { fontSize: 16, xAxisLabelGap: 20 };
check('a positive x gap pushes the x title further out',
  cfgAxisLabelOffset(gapCfg, 'x') - cfgAxisLabelOffset({ fontSize: 16 }, 'x'), 20);
check('a positive x gap widens the bottom margin',
  cfgChartMargin(gapCfg).bottom - cfgChartMargin({ fontSize: 16 }).bottom, 20);
checkBool('a big y gap pushes the y title out and widens the left margin',
  cfgChartMargin({ fontSize: 16, yAxisLabelGap: 60 }).left > cfgChartMargin({ fontSize: 16 }).left
  && Math.abs(cfgAxisLabelOffset({ fontSize: 16, yAxisLabelGap: 60 }, 'y') - cfgAxisLabelOffset({ fontSize: 16 }, 'y') - 60) < 1e-9);

/* ══════════════════════════════════════════════════════════════════════════
   5) SOURCE CHECKS — the shared helpers really are the ones in use
   ══════════════════════════════════════════════════════════════════════════ */
frag('[SharedAnalysisTools] extent helper', 'export const xTickNumberExtent = (fontSize, tickAngle = 0) => {');
frag('[SharedAnalysisTools] y number band helper', 'export const yTickNumberBand = (fontSize, gutter = Y_AXIS_GUTTER) =>');
frag('[SharedAnalysisTools] y title offset helper', 'export const yAxisTitleOffset = (fontSize) =>');
frag('[SharedAnalysisTools] x title offset helper', 'export const xAxisTitleOffset = (fontSize, tickAngle = 0, base = 25, extra = 0, gap = 0) =>');
frag('[SharedAnalysisTools] extreme anchor helper', "export const extremeTickAnchor = (index, visibleTicksCount, fallback = 'middle') => {");
frag('[SharedAnalysisTools] AngledTick takes the tick index', "anchor = 'middle', formatter, index, visibleTicksCount, edgeAnchor = true }) => {");
frag('[SharedAnalysisTools] AngledTick anchors the ends', 'const edge = a === 0 && edgeAnchor !== false ? extremeTickAnchor(index, visibleTicksCount, anchor) : null;');
frag('[SharedAnalysisTools] the y title clears the numbers', ': Math.max((base ?? 20) + extra * 1.6, yAxisTitleOffset(fs)) + gap;');
frag('[SharedAnalysisTools] the bottom margin honours the geometry', 'bottom: Math.max((base.bottom ?? 45) + extra * 2.2, xNeed),');
frag('[SharedAnalysisTools] the left margin too', 'left: Math.max((base.left ?? 50) + extra * 2.2, yNeed)');
// Band axes (bar charts) keep the centred labels over their bars; the numeric
// axes of the spectra do get the extreme-anchor treatment.
const CD = fs.readFileSync(path.join(ROOT, 'src/components/CDSections.jsx'), 'utf8');
const SS = fs.readFileSync(path.join(ROOT, 'src/components/ssNMRSections.jsx'), 'utf8');
const NMR = fs.readFileSync(path.join(ROOT, 'src/components/NMRSections.jsx'), 'utf8');
const MD = fs.readFileSync(path.join(ROOT, 'src/components/MDSections.jsx'), 'utf8');
const fragIn = (name, hay, needle) => checkBool(`${name}: ${needle.slice(0, 40)}…`, hay.includes(needle));
fragIn('[CDSections] a condition bar chart opts out', CD, 'dataKey="__condition" interval={catInterval(cfg.tickStep)} tick={<AngledTick angle={cfg.tickAngle} fontSize={cfg.fontSize} edgeAnchor={false} />}');
fragIn('[CDSections] a "name" bar chart opts out', CD, 'fontSize={Math.max(9, cfg.fontSize - 2)} edgeAnchor={false} />');
fragIn('[CDSections] the numeric CD spectrum keeps the anchor', CD, 'type="number" dataKey="x" domain={xDomain} allowDataOverflow scale={xScale} ticks={cfgAxisTicks(cfg, \'x\', xDomain)} tick={<AngledTick angle={cfg.tickAngle} fontSize={cfg.fontSize} formatter=');
checkTrue('[ssNMRSections] both band axes opt out', (SS.match(/edgeAnchor=\{false\}/g) || []).length === 2);
checkTrue('[NMRSections] both band axes opt out', (NMR.match(/edgeAnchor=\{false\}/g) || []).length === 2);
checkTrue('[MDSections] the per-atom bar chart opts out', (MD.match(/edgeAnchor=\{false\}/g) || []).length === 1);

console.table(results);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `❌ ${failed.length} check(s) failed` : `✅ ${results.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

