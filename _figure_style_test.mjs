/* =========================================================================
   _figure_style_test.mjs — the global "Figure style" system.

   Imports the REAL module (src/utils/figureStyle.js is plain JS, no JSX, and
   every browser API is guarded), so a change of behaviour fails here — plus a
   few source checks on the wiring (Settings panel, 🎨 button on the page, the
   registry inside the two chart inspectors, the capture stamp and the Image
   Builder audit).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  DEFAULT_FIGURE_STYLE, FIGURE_FONT_MIN, FIGURE_FONT_MAX, FIGURE_FONT_STEPS,
  FIGURE_STYLE_KEY, FIGURE_STYLE_EVENT, FIGURE_STYLE_FIELDS,
  FIGURE_ASPECT_MIN, FIGURE_ASPECT_MAX, FIGURE_ASPECT_STEPS,
  normalizeFigureStyle, clampFigureFont, clampFigureAngle, clampFigureAspect,
  readFigureStyle, writeFigureStyle, figureStyleTag,
  figureStylePatch, figureStyleMatches, applyFigureStyleToCfg,
  registerFigureStyleSlot, figureStyleSlotCount, applyFigureStyleToSlots,
  undoFigureStyleSlots, figureStyleUndoAvailable
} from './src/utils/figureStyle.js';
// The chart-side clamp: the profile may ask for 160 px, a chart must not cap it.
// …and the ratio resolver a plot box is sized with.
import {
  clampChartFont, chartAspect, figureAspectOf, chartBoxStyle,
  DEFAULT_CHART_ASPECT_WIDE, FIGURE_ASPECT_KEY
} from './src/utils/chartStyle.js';

const results = [];
const check = (name, fn) => {
  try { fn(); results.push({ name, ok: true, got: '' }); }
  catch (e) { results.push({ name, ok: false, got: e.message }); }
};
const eq = (a, b, msg) => assert.deepEqual(a, b, msg || `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
const ok = (v, msg) => assert.ok(v, msg);
const SRC = (p) => readFileSync(`./src/${p}`, 'utf8');

/* ══ 1. the profile: defaults, clamping, stored JSON ══════════════════════ */
check('1 the default profile is one size per element, no rotation, no ratio, no auto-apply', () => {
  eq(DEFAULT_FIGURE_STYLE, {
    fontFamily: '', fontSize: 16, axisTitleFontSize: 18, legendFontSize: 16,
    simLabelFontSize: 16, tickAngle: 0, aspect: 0, applyOnOpen: false
  });
  eq(FIGURE_STYLE_KEY, 'labFigureStyle');
  eq(FIGURE_STYLE_EVENT, 'lab:figure-style-changed');
});
check('2 anything (null, a string, a partial object) becomes a valid profile', () => {
  eq(normalizeFigureStyle(null), DEFAULT_FIGURE_STYLE);
  eq(normalizeFigureStyle(undefined), DEFAULT_FIGURE_STYLE);
  eq(normalizeFigureStyle('{"fontSize":20}').fontSize, 20);
  eq(normalizeFigureStyle('not json').fontSize, DEFAULT_FIGURE_STYLE.fontSize);
  eq(normalizeFigureStyle({ fontSize: 18 }).simLabelFontSize, 16);
});
check('3 character sizes are clamped to a readable range (up to 160 px)', () => {
  eq(clampFigureFont(2), FIGURE_FONT_MIN);
  eq(clampFigureFont(999), FIGURE_FONT_MAX);
  eq(normalizeFigureStyle({ fontSize: 400 }).fontSize, FIGURE_FONT_MAX);
  eq(normalizeFigureStyle({ fontSize: 0 }).fontSize, FIGURE_FONT_MIN);
  eq(FIGURE_FONT_MAX, 160, 'the profile must accept the oversized 160 px characters');
  eq(clampFigureFont(160), 160, '160 px is a valid character size');
  eq(normalizeFigureStyle({ fontSize: 160 }).fontSize, 160, '…and it survives a round-trip');
  eq(clampFigureFont(161), FIGURE_FONT_MAX, 'nothing goes past the upper bound');
  eq(clampFigureAngle(400), 90);
  eq(clampFigureAngle(-400), -90);
});
check('4 the auto-apply flag is always a real boolean', () => {
  eq(normalizeFigureStyle({ applyOnOpen: 'true' }).applyOnOpen, true);
  eq(normalizeFigureStyle({ applyOnOpen: 1 }).applyOnOpen, false);
  eq(normalizeFigureStyle({ applyOnOpen: true }).applyOnOpen, true);
});
check('5 unknown keys never leak into the stored profile', () => {
  const p = normalizeFigureStyle({ fontSize: 16, colors: { a: '#fff' }, height: 380 });
  eq(Object.keys(p).sort(), ['applyOnOpen', 'aspect', 'axisTitleFontSize', 'fontFamily', 'fontSize', 'legendFontSize', 'simLabelFontSize', 'tickAngle']);
});
check('6 read/write round-trip (browser storage is optional in Node)', () => {
  const before = readFigureStyle();
  writeFigureStyle({ fontFamily: 'Arial', fontSize: 20, axisTitleFontSize: 22, legendFontSize: 18, simLabelFontSize: 18, tickAngle: 45, aspect: 0, applyOnOpen: true });
  eq(readFigureStyle(), { fontFamily: 'Arial', fontSize: 20, axisTitleFontSize: 22, legendFontSize: 18, simLabelFontSize: 18, tickAngle: 45, aspect: 0, applyOnOpen: true });
  eq(figureStyleTag(), 'fs20-t22-lg18-lb18-rot45-Arial');
  writeFigureStyle(before);
  eq(readFigureStyle(), before);
});

/* ══ 2. the tag: what identifies "this figure's style" ════════════════════ */
check('7 the tag follows the four character sizes and the font', () => {
  eq(figureStyleTag({ fontSize: 16, simLabelFontSize: 12, tickAngle: 0 }), 'fs16-t18-lg16-lb12-rot0');
  eq(figureStyleTag({ fontSize: 12, simLabelFontSize: 12, tickAngle: 0 }), 'fs12-t18-lg16-lb12-rot0');
  eq(figureStyleTag({ fontSize: 40, axisTitleFontSize: 40, legendFontSize: 36, simLabelFontSize: 36, tickAngle: 0, fontFamily: 'Times' }),
    'fs40-t40-lg36-lb36-rot0-Times', 'the poster sizes and the font must show in the tag');
  ok(figureStyleTag({ fontSize: 16 }) !== figureStyleTag({ fontSize: 20 }), 'the size must change the tag');
  ok(figureStyleTag({ fontSize: 16, tickAngle: 45 }) !== figureStyleTag({ fontSize: 16 }), 'the rotation must change the tag');
  ok(figureStyleTag({ fontSize: 16, axisTitleFontSize: 24 }) !== figureStyleTag({ fontSize: 16 }), 'the axis-title size must change the tag');
  ok(figureStyleTag({ fontSize: 16, legendFontSize: 24 }) !== figureStyleTag({ fontSize: 16 }), 'the legend size must change the tag');
});
check('8 a partial profile is tagged with the defaults of the missing knobs', () => {
  eq(figureStyleTag({ fontSize: 20 }), 'fs20-t18-lg16-lb16-rot0');
});
check('8b the font stack is sanitised (never markup, never CSS declarations)', () => {
  eq(normalizeFigureStyle({ fontFamily: '  Arial,  Helvetica ' }).fontFamily, 'Arial, Helvetica');
  eq(normalizeFigureStyle({ fontFamily: 'Arial; color: red' }).fontFamily, '');
  eq(normalizeFigureStyle({ fontFamily: '<script>x</script>' }).fontFamily, '');
  eq(normalizeFigureStyle({ fontFamily: null }).fontFamily, '');
});

/* ══ 3. applyFigureStyleToCfg: what a chart accepts ═══════════════════════ */
const rechart = { height: 380, aspect: 1, fontSize: 16, ptStyle: 'circle', lineStyle: 'dashed' };
const spectra = { fontSize: 9, height: 300, simLabelFontSize: 12, tickAngle: 15, simLabelFormat: 'resNum_code_atom' };
const profile = { fontSize: 20, simLabelFontSize: 18, tickAngle: 45 };

check('9 every chart takes the shared character size', () => {
  const next = applyFigureStyleToCfg(rechart, profile);
  eq(next.fontSize, 20);
  eq(next.height, 380);
  eq(next.lineStyle, 'dashed');
});
check('10 the spectra keys only reach a cfg that USES them', () => {
  const next = applyFigureStyleToCfg(rechart, profile);
  ok(!('simLabelFontSize' in next), 'a recharts chart must not receive peak-label plumbing');
  ok(!('tickAngle' in next), 'a chart without a tick angle must not receive one');
  const sp = applyFigureStyleToCfg(spectra, profile);
  eq(sp.simLabelFontSize, 18);
  eq(sp.tickAngle, 45);
  eq(sp.simLabelFormat, 'resNum_code_atom', 'the rest of the spectrum cfg is untouched');
});
check('11 { spectra: true } forces the two spectra keys on', () => {
  const next = applyFigureStyleToCfg({ fontSize: 11 }, profile, { spectra: true });
  eq(next, { fontSize: 20, axisTitleFontSize: 18, legendFontSize: 16, simLabelFontSize: 18, tickAngle: 45 });
});
check('12 nothing to do → null (no pointless re-render / test save)', () => {
  eq(applyFigureStyleToCfg({ fontSize: 20, axisTitleFontSize: 18, legendFontSize: 16, simLabelFontSize: 18, tickAngle: 45 }, profile), null);
  eq(applyFigureStyleToCfg({ fontSize: '20', axisTitleFontSize: '18', legendFontSize: '16', simLabelFontSize: '18', tickAngle: '45' }, profile), null,
    'a cfg stored as text numbers is already styled');
  eq(applyFigureStyleToCfg(null, profile), null);
  eq(applyFigureStyleToCfg(undefined, profile), null);
  eq(applyFigureStyleToCfg([1, 2], profile), null);
});
check('13 figureStylePatch / figureStyleMatches describe the same rule', () => {
  eq(figureStylePatch(profile, rechart), { fontSize: 20, axisTitleFontSize: 18, legendFontSize: 16 });
  eq(figureStylePatch(profile, spectra), { fontSize: 20, axisTitleFontSize: 18, legendFontSize: 16, simLabelFontSize: 18, tickAngle: 45 });
  eq(figureStyleMatches({ fontSize: 20, axisTitleFontSize: 18, legendFontSize: 16, simLabelFontSize: 18, tickAngle: 45 }, profile), true);
  eq(figureStyleMatches(rechart, profile), false);
});
check('13b the font family is written on demand — and cleared when the profile drops it', () => {
  const named = applyFigureStyleToCfg(rechart, { ...profile, fontFamily: 'Georgia, serif' });
  eq(named.fontFamily, 'Georgia, serif');
  // A cfg that already carries a family gets it REMOVED when the profile has none.
  eq(applyFigureStyleToCfg({ ...rechart, fontFamily: 'Georgia, serif' }, profile).fontFamily, '');
  // …but a cfg that never had one is left untouched (no pointless key).
  ok(!('fontFamily' in applyFigureStyleToCfg(rechart, profile)), 'no empty family injected');
});
check('14 the profile fields are the single source of the applied keys', () => {
  eq(FIGURE_STYLE_FIELDS, ['fontFamily', 'fontSize', 'axisTitleFontSize', 'legendFontSize', 'simLabelFontSize', 'tickAngle', 'aspect']);
  eq(Object.keys(figureStylePatch(profile, spectra)).sort(), ['fontSize', 'axisTitleFontSize', 'legendFontSize', 'simLabelFontSize', 'tickAngle'].sort());
});

/* ══ 4. the registry: one click styles every registered chart ═════════════ */
let chartA = { fontSize: 12, height: 380 };
let chartB = { fontSize: 9, simLabelFontSize: 12, tickAngle: 0 };
check('15 apply pushes the profile into every registered chart', () => {
  const offA = registerFigureStyleSlot({ get: () => chartA, set: (n) => { chartA = n; } });
  const offB = registerFigureStyleSlot({ get: () => chartB, set: (n) => { chartB = n; } });
  eq(figureStyleSlotCount(), 2);
  const res = applyFigureStyleToSlots(profile);
  eq(res.total, 2);
  eq(res.changed, 2);
  eq(res.tag, 'fs20-t18-lg16-lb18-rot45');
  eq(chartA.fontSize, 20);
  eq(chartB.fontSize, 20);
  eq(chartB.simLabelFontSize, 18);
  eq(chartB.tickAngle, 45);
  eq(chartA.height, 380, 'the layout of the chart is preserved');
  eq(applyFigureStyleToSlots(profile).changed, 0, 'a second click has nothing left to change');
  eq(undoFigureStyleSlots(), 2);
  eq(chartA.fontSize, 12);
  eq(chartB.tickAngle, 0);
  offA(); offB();
  eq(figureStyleSlotCount(), 0);
});
check('16 a chart that does not use the spectra keys keeps its cfg clean', () => {
  const off = registerFigureStyleSlot({ get: () => chartA, set: (n) => { chartA = n; } });
  applyFigureStyleToSlots(profile);
  ok(!('tickAngle' in chartA), 'no rotation injected into a plain chart');
  undoFigureStyleSlots();
  off();
});
check('17 a broken / empty slot never breaks the fan-out', () => {
  const offBad = registerFigureStyleSlot({ get: () => { throw new Error('no chart'); }, set: () => {} });
  const offNull = registerFigureStyleSlot({ get: () => null, set: () => {} });
  const offOk = registerFigureStyleSlot({ get: () => chartA, set: (n) => { chartA = n; } });
  const res = applyFigureStyleToSlots({ fontSize: 24 });
  eq(res.changed, 1);
  eq(chartA.fontSize, 24);
  undoFigureStyleSlots();
  offBad(); offNull(); offOk();
});
check('18 undo is only offered after a real change', () => {
  const off = registerFigureStyleSlot({ get: () => chartA, set: (n) => { chartA = n; } });
  eq(figureStyleUndoAvailable(), false);
  applyFigureStyleToSlots({ fontSize: 24 });
  eq(figureStyleUndoAvailable(), true);
  eq(undoFigureStyleSlots(), 1);
  eq(figureStyleUndoAvailable(), false);
  off();
});

/* ══ 5. the wiring: Settings panel, 🎨 button, capture stamp, audit ═══════ */
const TOOLS = SRC('components/FigureStyleTools.jsx');
const PANEL = SRC('components/FigureStylePanel.jsx');
const SETTINGS = SRC('components/AppModules/settingsModule.jsx');
const CSL = SRC('components/ChartStarLayer.jsx');
const SAT = SRC('components/SharedAnalysisTools.jsx');
const IB = SRC('components/ImageBuilder.jsx');
const FSJS = SRC('utils/figureStyle.js');

check('19 the profile editor lives in Settings', () => {
  ok(SETTINGS.includes("import { FigureStylePanel } from '../FigureStylePanel';"), 'the panel is not imported');
  ok(SETTINGS.includes('title="Figure style — uniform fonts & character sizes"'), 'no Settings section');
  ok(SETTINGS.includes('<FigureStylePanel />'), 'the section does not render the panel');
});
check('20 the panel exposes the font AND one size per element', () => {
  ok(PANEL.includes('Font family'), 'the font family is missing');
  ok(PANEL.includes('1 · Axis numbers (tick labels)'), 'the tick character size is missing');
  ok(PANEL.includes('2 · Axis titles (x / y names)'), 'the axis-title size is missing');
  ok(PANEL.includes('3 · Legends / series names'), 'the legend size is missing');
  ok(PANEL.includes('4 · Peak / data labels (spectra)'), 'the spectra label size is missing');
  ok(PANEL.includes('X label rotation (spectra)'), 'the x-rotation is missing');
  ok(PANEL.includes('FIGURE_FONT_CHOICES'), 'the font list is not offered');
  ok(PANEL.includes('Poster A0'), 'the poster values (36 / 40 px) are missing');
  ok(PANEL.includes('writeFigureStyle('), 'the panel does not save the profile');
  ok(PANEL.includes('Apply automatically when an experiment page is opened'), 'no auto-apply option');
});
check('20b the character sizes reach 160 px and the charts let them through', () => {
  ok(FIGURE_FONT_MAX >= 160, 'the profile cannot go past 40 px');
  eq(FIGURE_FONT_STEPS[FIGURE_FONT_STEPS.length - 1], FIGURE_FONT_MAX, 'the last one-click size must be the upper bound');
  eq(FIGURE_FONT_STEPS.filter((v) => v > 40).length, 7, 'the oversized steps (48 … 160) are missing');
  ok(PANEL.includes('FIGURE_FONT_STEPS'), 'no one-click size steps (36 / 40)');
  ok(PANEL.includes('fontSize: 160'), 'no preset reaches the oversized characters');
  const CS = SRC('utils/chartStyle.js');
  eq(clampChartFont(160), 160, 'a chart must not clamp the 160 px characters back down');
  eq(clampChartFont(999), 160, 'the chart clamp keeps its own upper bound');
  eq(clampChartFont(5), 6, 'the lower bound is unchanged');
  ok(CS.includes('export const FIGURE_FONT_CHOICES'), 'no font list in chartStyle');
  ok(CS.includes('export const tickTextProps = (cfg, extra)'), 'no tick helper');
  ok(CS.includes('export const legendTextStyle = (cfg, extra)'), 'no legend helper');
  ok(CS.includes('export const chartJsFont = (cfg, extra)'), 'no Chart.js font helper');
  ['NMRSections', 'ssNMRSections', 'CDSections', 'MDSections', 'PlateSections'].forEach((f) => {
    const s = readFileSync(`./src/components/${f}.jsx`, 'utf8');
    ok(/tickTextProps\(|chartJsFont\(|fontFamilyOf\(/.test(s), `${f} does not use the shared font helpers`);
  });
  ok(SAT.includes('axisTitleSize(cfg'), 'the axis titles do not follow the profile');
  ok(SAT.includes('fontFamilyOf(cfg)'), 'the axis titles ignore the font family');
});
check('21 the two inspectors register their cfg in the registry', () => {
  ok(SAT.includes("import { useFigureStyleSlot } from './FigureStyleTools';"), 'no import');
  eq(SAT.split('useFigureStyleSlot(cfg, setCfg);').length - 1, 2, 'both inspectors must register');
  ok(TOOLS.includes('registerFigureStyleSlot('), 'the hook does not register');
  ok(TOOLS.includes('get: () => cfgRef.current'), 'the slot must read the LIVE cfg');
});
check('22 the 🎨 chip is mounted on every experiment page', () => {
  ok(CSL.includes("import { FigureStyleApplyButton } from './FigureStyleTools';"), 'no import');
  ok(CSL.includes('<FigureStyleApplyButton test={test} update={update} />'), 'the chip is not mounted');
  ok(TOOLS.includes('data-figure-style-tools="1"'), 'no stable hook for the chip');
});

check('23 applying from the page reaches the charts of the CLOSED sections', () => {
  ok(TOOLS.includes('applyFigureStyleEverywhere'), 'the page does not use the shared apply');
  ok(FSJS.includes('export const applyFigureStyleEverywhere'), 'no shared page-level apply');
  ok(FSJS.includes("document.querySelector('[data-expand-all]')"), 'the Expand all button is not used');
  ok(FSJS.includes('btn.click()'), 'the closed sections are never opened');
  ok(FSJS.includes('setTimeout(() => applyFigureStyleToSlots(profile, options), 900)'), 'the delayed re-apply is missing');
});
check('24 the page records the style it applied', () => {
  ok(TOOLS.includes('update({ figureStyleTag: res.tag, figureStyleAppliedAt:'), 'the applied style is not stamped on the experiment');
  ok(TOOLS.includes('test.figureStyleTag === tag'), 'the chip cannot tell it is already applied');
  ok(TOOLS.includes('if (!profile.applyOnOpen || !test) return undefined;'), 'no auto-apply path');
});
check('25 a captured figure carries its style stamp and its pixel size', () => {
  ok(CSL.includes('src.styleTag = figureStyleTag();'), 'the capture does not stamp the style');
  ok(CSL.includes('src.pxW = Math.round('), 'the capture does not record pxW');
  ok(CSL.includes('src.pxH = Math.round('), 'the capture does not record pxH');
  ok(CSL.includes("import { figureStyleTag, readFigureStyle, applyFigureStyleEverywhere } from '../utils/figureStyle';"), 'no import of the tag helper');
});
check('26 the Image Builder audits the figures of the canvas', () => {
  ok(IB.includes('export const figureStyleAudit = (objects, currentTag'), 'no audit helper');
  ok(IB.includes('const STYLE_BADGE = {'), 'no badge for the audit rows');
  ok(IB.includes('⚖️ Character sizes'), 'the audit is not reachable from the toolbar');
  ok(IB.includes('imagePxCache.set(src, { w: Math.round(pxW), h: Math.round(pxH) });'), 'the pixel size is never measured');
  ok(IB.includes('return { ...o, imgPxW: px.w, imgPxH: px.h };'), 'pxW/pxH are not recorded on the image blocks');
  ok(IB.includes('onClick={() => openOriginalGraph(r.src)}'), 'a mismatching figure cannot be reopened');
  ok(IB.includes("(src && src.styleTag) || ''"), 'the audit does not read the capture stamp');
});
check('27 every ChartInspector / ChartJsInspector call site passes cfg + setCfg', () => {
  const files = readdirSync('./src/components', { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.jsx'))
    .map((d) => `components/${d.name}`);
  let sites = 0;
  files.forEach((f) => {
    const s = readFileSync(`./src/${f}`, 'utf8');
    let i = s.indexOf('<ChartInspector');
    while (i >= 0) {
      sites += 1;
      const block = s.slice(i, i + 600);
      ok(/cfg=\{/.test(block), `${f}: a call site without cfg= cannot be styled`);
      ok(/setCfg=\{/.test(block), `${f}: a call site without setCfg= cannot be styled`);
      i = s.indexOf('<ChartInspector', i + 1);
    }
    let j = s.indexOf('<ChartJsInspector');
    while (j >= 0) {
      sites += 1;
      const block = s.slice(j, j + 600);
      ok(/cfg=\{/.test(block), `${f}: a Chart.js call site without cfg=`);
      ok(/setCfg=\{/.test(block), `${f}: a Chart.js call site without setCfg=`);
      j = s.indexOf('<ChartJsInspector', j + 1);
    }
  });
  ok(sites >= 28, `only ${sites} style-panel call sites found — the registry would miss charts`);
});
check('28 the spectra families read the two spectra knobs of the profile', () => {
  ['NMRSections', 'ssNMRSections', 'CDSections', 'FlowCytometrySections', 'MDSections'].forEach((f) => {
    const s = readFileSync(`./src/components/${f}.jsx`, 'utf8');
    ok(s.includes('fontSize'), `${f} has no character size at all`);
    ok(s.includes('tickAngle'), `${f} ignores the tick rotation`);
  });
  const nmr = readFileSync('./src/components/NMRSections.jsx', 'utf8');
  ok(nmr.includes('simLabelFontSize'), 'the simulated spectra labels are not driven by the cfg');
  ok(nmr.includes('...(activeTest.simChartCfg || {})'), 'the simulated spectra cfg is not merged');
});

/* ══ 6. the plot-box ratio — x-axis length : y-axis length ═════════════════ */
check('29 the profile carries the plot-box ratio (0 = each chart keeps its own)', () => {
  eq(DEFAULT_FIGURE_STYLE.aspect, 0, 'the default must not reshape the figures');
  eq(FIGURE_ASPECT_MIN, 0);
  eq(FIGURE_ASPECT_STEPS[0], FIGURE_ASPECT_MIN, 'the first one-click value = "each chart keeps its own"');
  eq(FIGURE_ASPECT_STEPS[FIGURE_ASPECT_STEPS.length - 1], FIGURE_ASPECT_MAX, 'the last one-click value is the upper bound');
  ok(FIGURE_ASPECT_STEPS.includes(1), 'the square ratio is offered');
  ok(FIGURE_ASPECT_STEPS.includes(1.8), 'the wide spectrum ratio is offered');
  eq(normalizeFigureStyle({ aspect: 1.8 }).aspect, 1.8);
  eq(normalizeFigureStyle({ aspect: -3 }).aspect, 0, 'a negative ratio cannot exist');
  eq(normalizeFigureStyle({ aspect: 99 }).aspect, FIGURE_ASPECT_MAX);
  eq(clampFigureAspect('1.75'), 1.75, 'a decimal ratio survives');
  eq(clampFigureAspect(2.126), 2.13, 'two decimals are enough');
  eq(clampFigureAspect(''), 0, 'an empty box means "each chart keeps its own"');
  eq(clampFigureAspect(undefined), 0);
});
check('30 the ratio shows in the tag — and only when it is imposed', () => {
  eq(figureStyleTag({ fontSize: 16 }), 'fs16-t18-lg16-lb16-rot0', 'a tag written before the knob existed must not change');
  eq(figureStyleTag({ fontSize: 16, aspect: 1.8 }), 'fs16-t18-lg16-lb16-rot0-ar1.8');
  eq(figureStyleTag({ fontSize: 16, aspect: 1.8, fontFamily: 'Times' }), 'fs16-t18-lg16-lb16-rot0-ar1.8-Times');
  ok(figureStyleTag({ fontSize: 16, aspect: 1 }) !== figureStyleTag({ fontSize: 16, aspect: 1.8 }), 'the ratio must show in the tag');
});
check('31 applying the profile pushes the ratio — and gives it back at 0', () => {
  const cfg0 = { height: 380, aspect: 1, fontSize: 16, lineStyle: 'dashed' };
  const forced = applyFigureStyleToCfg(cfg0, { ...DEFAULT_FIGURE_STYLE, aspect: 1.8 });
  eq(forced.aspect, 1.8, 'the per-chart panel must show the ratio the figure was drawn with');
  eq(forced[FIGURE_ASPECT_KEY], 1.8, 'the key that really wins must be written too');
  eq(forced.height, 380, 'the rest of the chart is untouched');
  // …and the override is RELEASED when the profile goes back to "each chart its own".
  const freed = applyFigureStyleToCfg(forced, DEFAULT_FIGURE_STYLE);
  eq(freed[FIGURE_ASPECT_KEY], 0, 'the previous override must be cleared');
  eq(freed.aspect, 1.8, 'the value of the chart own panel stays visible');
  // A chart that never met the profile keeps its cfg exactly as it was.
  eq(figureStylePatch(DEFAULT_FIGURE_STYLE, cfg0), { fontSize: 16, axisTitleFontSize: 18, legendFontSize: 16 });
});
check('32 the imposed ratio beats the two historical defaults of a chart', () => {
  eq(figureAspectOf({}), 0);
  eq(figureAspectOf({ figureAspect: 0 }), 0);
  eq(figureAspectOf({ figureAspect: '2.5' }), 2.5, 'a stored string ratio counts');
  eq(chartAspect({}, 1.8), 1.8, 'the fallback of the call site');
  eq(chartAspect({ aspect: 1.8 }), 1.8, 'the value of the chart own panel');
  eq(chartAspect({ aspect: 1.8, figureAspect: 1 }), 1, 'the global ratio wins');
  eq(chartAspect({ aspect: 0, figureAspect: 0 }, 2), 2, 'a 0 never counts as a ratio');
  eq(chartBoxStyle({ aspect: 1, figureAspect: 1, fontSize: 16 }, { square: false }).aspectRatio, '1',
    'aspect 1 on a wide chart is exactly what cfg.aspect alone cannot express');
  eq(chartBoxStyle({ figureAspect: 1.8, fontSize: 16 }, {}).aspectRatio, '1.8', '…and a wide ratio on a square chart');
  eq(chartBoxStyle({ aspect: 1, fontSize: 16 }, { square: false }).aspectRatio, String(DEFAULT_CHART_ASPECT_WIDE),
    'without the profile the old behaviour is untouched');
});
check('33 the Settings panel and every chart are wired to the ratio', () => {
  ok(PANEL.includes('FIGURE_ASPECT_STEPS'), 'the panel offers no one-click ratio');
  ok(PANEL.includes('FIGURE_ASPECT_MAX'), 'the panel has no bounds for the ratio');
  ok(PANEL.includes('const [draft, setDraft] = React.useState(null);'), 'a decimal ratio cannot be typed');
  ok(PANEL.includes('DEFAULT_CHART_ASPECT_WIDE'), 'the preview does not draw the shape of the plot box');
  const CS2 = SRC('utils/chartStyle.js');
  ok(CS2.includes('export const chartAspect = (cfg = {}, fallback = DEFAULT_CHART_ASPECT) => {'), 'no shared ratio resolver');
  ok(CS2.includes('export const figureAspectOf = (cfg) => {'), 'no override reader');
  ok(CS2.includes('const forced = figureAspectOf(cfg);'), 'chartBoxStyle ignores the global ratio');
  ['NMRSections', 'ssNMRSections', 'CDSections', 'FlowCytometrySections', 'MDSections'].forEach((f) => {
    const s = readFileSync(`./src/components/${f}.jsx`, 'utf8');
    ok(/chartAspect\(/.test(s), `${f} does not read the ratio through chartAspect()`);
    ok(!/aspectRatio: String\(cfg\.aspect/.test(s), `${f} still sizes a box with cfg.aspect`);
    ok(!/aspect=\{cfg\.aspect\}/.test(s), `${f} still hands a raw cfg.aspect to recharts`);
    ok(!/cfg\.aspect \|\| /.test(s), `${f} still falls back with "cfg.aspect || x"`);
  });
  ok(SAT.includes('set({ aspect: v || 1.8, figureAspect: 0 })'), 'the per-chart panel cannot take back control');
  const nmrPanel = readFileSync('./src/components/NMRSections.jsx', 'utf8');
  ok(nmrPanel.includes('setCfg({ aspect: v || 2.5, figureAspect: 0 })'), 'the spectra panel cannot take back control');
  ok(TOOLS.includes('plot box'), 'the 🎨 chip does not tell the ratio');
});

const failed = results.filter((r) => !r.ok);
console.table(results.map((r) => ({ name: r.name, ok: r.ok, error: r.ok ? '' : r.got })));
if (failed.length) {
  console.error(`\n❌ ${failed.length}/${results.length} checks failed`);
  process.exit(1);
}
console.log(`\n✅ ${results.length}/${results.length} checks passed`);
