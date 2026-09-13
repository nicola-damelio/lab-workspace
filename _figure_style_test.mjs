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
  FIGURE_DECIMALS_STEPS, FIGURE_AXIS_CFG_KEYS,
  FIGURE_KINDS, DEFAULT_FIGURE_KIND, FIGURE_KIND_FIELDS, FIGURE_ASPECT_FIELDS, FIGURE_KIND_LABELS,
  FIGURE_AXIS_BASES, FIGURE_AXIS_KIND_SUFFIX, FIGURE_AXIS_FORMAT_FIELDS, FIGURE_AXIS_BASE_LABELS, FIGURE_AXIS_HINTS,
  figureAxisFormatField, figureAxisFormatForKind, figureAxisAllSci, figureAxisFormatSummary,
  normalizeFigureKind, figureAspectFieldForKind, figureAspectForKind, figureAspectSummary,
  normalizeFigureStyle, clampFigureFont, clampFigureAngle, clampFigureAspect,
  clampFigureDecimals, figureCfgAcceptsAxisStyle,
  readFigureStyle, writeFigureStyle, figureStyleTag,
  figureStylePatch, figureStyleMatches, applyFigureStyleToCfg,
  registerFigureStyleSlot, figureStyleSlotCount, applyFigureStyleToSlots,
  undoFigureStyleSlots, figureStyleUndoAvailable,
  FIGURE_STYLE_LIBRARY_KEY, FIGURE_STYLE_LIBRARY_EVENT,
  FIGURE_STYLE_PRESET_MAX, FIGURE_STYLE_PRESET_NAME_MAX,
  normalizeFigureStyleConfigName, figureStyleConfigName, figureStyleConfigSummary, figureStylesEqual,
  readFigureStyleConfigs, writeFigureStyleConfigs, subscribeFigureStyleConfigs,
  figureStyleConfigById, figureStyleConfigForStyle,
  saveFigureStyleConfig, renameFigureStyleConfig, deleteFigureStyleConfig, applyFigureStyleConfig,
  exportFigureStyleConfigs, importFigureStyleConfigs
} from './src/utils/figureStyle.js';
// The chart-side clamp: the profile may ask for 160 px, a chart must not cap it.
// …and the ratio resolver a plot box is sized with.
import {
  clampChartFont, chartAspect, figureAspectOf, chartBoxStyle, chartAspectImposed,
  chartRatioBoxStyle, DEFAULT_CHART_ASPECT_WIDE, FIGURE_ASPECT_KEY
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
    simLabelFontSize: 16, tickAngle: 0,
    axisTitleBold: false, axisTitleItalic: false, tickSci: false, tickDecimals: '',
    // the sixteen axis format / scale knobs, one per axis × kind (all off):
    // exponential notation and log scale of the X / the Y axis of each kind.
    xSci: false, ySci: false, xLog: false, yLog: false,
    xSciSpectra: false, ySciSpectra: false, xLogSpectra: false, yLogSpectra: false,
    xSciAtom: false, ySciAtom: false, xLogAtom: false, yLogAtom: false,
    xSciResidue: false, ySciResidue: false, xLogResidue: false, yLogResidue: false,
    aspect: 0, aspectSpectra: 0, aspectAtom: 0, aspectResidue: 0, applyOnOpen: false
  });
  eq(FIGURE_STYLE_KEY, 'labFigureStyle');
  eq(FIGURE_STYLE_EVENT, 'lab:figure-style-changed');
});
check('1b the axis format / scale model: 4 axes × 4 kinds of figure', () => {
  eq(FIGURE_AXIS_BASES, ['xSci', 'ySci', 'xLog', 'yLog'], 'the two exponential + the two log commands');
  eq(FIGURE_AXIS_KIND_SUFFIX, { spectra: 'Spectra', atom: 'Atom', residue: 'Residue', graph: '' });
  eq(FIGURE_AXIS_FORMAT_FIELDS.length, FIGURE_KINDS.length * FIGURE_AXIS_BASES.length);
  eq(FIGURE_AXIS_FORMAT_FIELDS, [
    'xSciSpectra', 'ySciSpectra', 'xLogSpectra', 'yLogSpectra',
    'xSciAtom', 'ySciAtom', 'xLogAtom', 'yLogAtom',
    'xSciResidue', 'ySciResidue', 'xLogResidue', 'yLogResidue',
    'xSci', 'ySci', 'xLog', 'yLog'
  ], 'a stable order, and the graphs keep the bare cfg key names');
  eq(figureAxisFormatField('xSciSpectra', 'graph'), 'xSciSpectra', 'the base must not be suffixed twice');
  eq(figureAxisFormatField('xSci', 'atom'), 'xSciAtom');
  eq(figureAxisFormatField('yLog', 'RESIDUE'), 'yLog', 'the kind is case sensitive — an unknown one is a graph');
  eq(figureAxisFormatField('yLog', 'nonsense'), 'yLog', 'anything unknown is a graph');
  eq(figureAxisFormatField('yLog', 'atom'), 'yLogAtom');
  eq(Object.keys(FIGURE_AXIS_BASE_LABELS).sort(), FIGURE_AXIS_BASES.slice().sort());
  FIGURE_KINDS.forEach((k) => ok(!!FIGURE_AXIS_HINTS[k], `no hint for ${k}`));
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
  eq(Object.keys(p).sort(), [
    'applyOnOpen', 'aspect', 'aspectAtom', 'aspectResidue', 'aspectSpectra',
    'axisTitleBold', 'axisTitleFontSize', 'axisTitleItalic',
    'fontFamily', 'fontSize', 'legendFontSize', 'simLabelFontSize',
    'tickAngle', 'tickDecimals', 'tickSci',
    // the axis format / scale knobs (see check 1b)
    ...FIGURE_AXIS_FORMAT_FIELDS.slice().sort()
  ].sort());
});
check('6 read/write round-trip (browser storage is optional in Node)', () => {
  const before = readFigureStyle();
  writeFigureStyle({
    fontFamily: 'Arial', fontSize: 20, axisTitleFontSize: 22, legendFontSize: 18,
    simLabelFontSize: 18, tickAngle: 45,
    axisTitleBold: true, axisTitleItalic: false, tickSci: true, tickDecimals: 2,
    aspect: 0, applyOnOpen: true
  });
  const round = readFigureStyle();
  eq(round, {
    fontFamily: 'Arial', fontSize: 20, axisTitleFontSize: 22, legendFontSize: 18,
    simLabelFontSize: 18, tickAngle: 45,
    axisTitleBold: true, axisTitleItalic: false, tickSci: true, tickDecimals: 2,
    // the legacy `tickSci` is expanded onto the eight sci knobs…
    xSci: true, ySci: true, xLog: false, yLog: false,
    xSciSpectra: true, ySciSpectra: true, xLogSpectra: false, yLogSpectra: false,
    xSciAtom: true, ySciAtom: true, xLogAtom: false, yLogAtom: false,
    xSciResidue: true, ySciResidue: true, xLogResidue: false, yLogResidue: false,
    aspect: 0, aspectSpectra: 0, aspectAtom: 0, aspectResidue: 0, applyOnOpen: true
  });
  // …and the tag stays the one written before the knobs grew axes / kinds.
  eq(figureStyleTag(), 'fs20-t22-lg18-lb18-rot45-bold-sci-dec2-Arial');
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
  eq(FIGURE_STYLE_FIELDS, [
    'fontFamily', 'fontSize', 'axisTitleFontSize', 'legendFontSize', 'simLabelFontSize',
    'tickAngle', 'axisTitleBold', 'axisTitleItalic', 'tickSci', 'tickDecimals',
    'aspect', 'aspectSpectra', 'aspectAtom', 'aspectResidue',
    'xSciSpectra', 'ySciSpectra', 'xLogSpectra', 'yLogSpectra',
    'xSciAtom', 'ySciAtom', 'xLogAtom', 'yLogAtom',
    'xSciResidue', 'ySciResidue', 'xLogResidue', 'yLogResidue',
    'xSci', 'ySci', 'xLog', 'yLog'
  ]);
  eq(Object.keys(figureStylePatch(profile, spectra)).sort(), ['fontSize', 'axisTitleFontSize', 'legendFontSize', 'simLabelFontSize', 'tickAngle'].sort());
  eq(FIGURE_AXIS_CFG_KEYS.bold, ['xAxisLabelBold', 'yAxisLabelBold']);
  eq(FIGURE_AXIS_CFG_KEYS.sci, ['xSci', 'ySci']);
  eq(FIGURE_AXIS_CFG_KEYS.log, ['xLog', 'yLog']);
  eq(FIGURE_AXIS_CFG_KEYS.decimals, ['xDecimals', 'yDecimals']);
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
  eq(SAT.split('useFigureStyleSlot(cfg, setCfg, figureKind);').length - 1, 2, 'both inspectors must register — with the kind of figure they are');
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
    ok(/chartAspect\(|chartRatioBoxStyle\(/.test(s), `${f} does not read the ratio through the shared resolver`);
    ok(!/aspectRatio: String\(cfg\.aspect/.test(s), `${f} still sizes a box with cfg.aspect`);
    ok(!/aspect=\{cfg\.aspect\}/.test(s), `${f} still hands a raw cfg.aspect to recharts`);
    ok(!/cfg\.aspect \|\| /.test(s), `${f} still falls back with "cfg.aspect || x"`);
  });
  ok(SAT.includes('set({ aspect: v || 1.8, figureAspect: 0 })'), 'the per-chart panel cannot take back control');
  const nmrPanel = readFileSync('./src/components/NMRSections.jsx', 'utf8');
  ok(nmrPanel.includes('setCfg({ aspect: v || 2.5, figureAspect: 0 })'), 'the spectra panel cannot take back control');
  ok(TOOLS.includes('plot box'), 'the 🎨 chip does not tell the ratio');
});

check('34 the imposed ratio is not cancelled by the height of the box', () => {
  // A definite `height` — or a `max-height` smaller than the ratio needs —
  // cancels `aspect-ratio` in the browser. With a 1000 px-wide card and a
  // "Chart height (px)" of 380, EVERY ratio under 2.63 used to draw the very
  // same 1000x380 box: the knob looked ignored.
  eq(chartAspectImposed({}), false);
  eq(chartAspectImposed({ aspect: 1 }), false, 'the square default is not a choice');
  eq(chartAspectImposed({ aspect: 1.8 }), false, 'the wide default is not a choice');
  eq(chartAspectImposed({ aspect: 1.8, figureAspect: 0 }), false);
  eq(chartAspectImposed({ aspect: 2 }), true, 'a ratio typed in the panel is a choice');
  eq(chartAspectImposed({ figureAspect: 1.8 }), true, 'the profile imposes a shape');
  eq(chartBoxStyle({ height: 380, fontSize: 16 }).maxHeight, 380, 'a chart nobody reshaped is untouched');
  ok(!('maxHeight' in chartBoxStyle({ figureAspect: 1, height: 380, fontSize: 16 })), 'the profile ratio must not be clamped');
  ok(!('maxHeight' in chartBoxStyle({ aspect: 2.5, height: 380, fontSize: 16 })), '…nor the ratio of the panel');
  eq(chartBoxStyle({ figureAspect: 1, height: 380, fontSize: 16 }).aspectRatio, '1');
  eq(chartBoxStyle({ figureAspect: 1.8, height: 380, fontSize: 16 }, { square: false }).aspectRatio, '1.8');
  eq(chartBoxStyle({ height: 900, fontSize: 16 }).maxHeight, 900, 'the height slider still works without a shape');
});
check('35 a box that IS its shape never mixes a height with the ratio', () => {
  eq(chartRatioBoxStyle({}, 1.8, { width: '100%', height: 380 }),
    { aspectRatio: '1.8', width: '100%', height: 380 }, 'without a choice the historical style is returned');
  eq(chartRatioBoxStyle({ figureAspect: 1.8, height: 380 }, 1.8, { width: '100%', height: 380 }),
    { aspectRatio: '1.8', width: '100%' }, 'a fixed height would cancel the ratio the profile imposes');
  eq(chartRatioBoxStyle({ aspect: 2.5 }, 1, { maxHeight: 'min(380px, 55vh)' }),
    { aspectRatio: '2.5' }, 'the layout cap goes with it when the user picks the shape');
  eq(chartRatioBoxStyle({ aspect: 1 }, 1, { maxHeight: '55vh' }), { aspectRatio: '1', maxHeight: '55vh' });
  eq(chartRatioBoxStyle({ figureAspect: 1 }, 2, { height: Math.min(280, 500) }), { aspectRatio: '1' });
});
check('36 every figure of a page can be reshaped — height-driven ones too', () => {
  const CS3 = SRC('utils/chartStyle.js');
  ok(CS3.includes('export const chartAspectImposed = (cfg = {}) => {'), 'no "deliberate shape" test');
  ok(CS3.includes('export const chartRatioBoxStyle = (cfg = {}, fallback = DEFAULT_CHART_ASPECT, opts = {}) => {'), 'no ratio box helper');
  ok(CS3.includes('...(chartAspectImposed(cfg) ? {} : { maxHeight }),'), 'chartBoxStyle still clamps an imposed ratio');
  ['CDSections', 'ssNMRSections', 'NMRSections', 'FlowCytometrySections'].forEach((f) => {
    const s = readFileSync(`./src/components/${f}.jsx`, 'utf8');
    ok(!/height: Math\.min\(280, cfg\.height\), aspectRatio/.test(s), `${f} still mixes a fixed height with the ratio`);
    ok(/chartRatioBoxStyle\(/.test(s), `${f} does not size its ratio box through the helper`);
  });
  const fcs = readFileSync('./src/components/FlowCytometrySections.jsx', 'utf8');
  ok(!/aspectRatio: String\(chartAspect\(cfg, 1\.8\)\), height: cfg\.height/.test(fcs), 'the FCS canvas box still fixes its height');
  ok(fcs.includes("chartRatioBoxStyle(cfg, 1.8, { width: '100%', height: cfg.height || 380 })"), 'the FCS canvas box does not go through the helper');
  const nmr = readFileSync('./src/components/NMRSections.jsx', 'utf8');
  ok(nmr.includes('const PANEL_ASPECT = (expandedBruker || !chartAspectImposed(nmr1dCfg)) ? 0 : chartAspect(nmr1dCfg, 1.8);'),
    'the 1D spectrum panel cannot be reshaped');
  ok(nmr.includes('...(PANEL_ASPECT ? { aspectRatio: String(PANEL_ASPECT), minHeight: PANEL_H } : { height: PANEL_H })'),
    'the 1D spectrum panel still hands a fixed height to the box');
  ['PlateSections', 'DOSYTestRenderer', 'NMRFittingsTestRenderer'].forEach((f) => {
    const s = readFileSync(`./src/components/${f}.jsx`, 'utf8');
    ok(/chartAspectImposed\(/.test(s), `${f} (Chart.js canvas) cannot be reshaped`);
    ok(/aspectRatio: String\(chartAspect\(/.test(s), `${f} never hands a shape to its canvas box`);
  });
});

/* ══ 6. AXIS TITLE style + AXIS NUMBER format (the four axis knobs) ═══════ */
const axisProfile = {
  ...DEFAULT_FIGURE_STYLE,
  axisTitleBold: true, axisTitleItalic: true, tickSci: true, tickDecimals: 2
};
check('37 the four axis knobs are normalised and clamped', () => {
  eq(normalizeFigureStyle({ axisTitleBold: 'true' }).axisTitleBold, true);
  eq(normalizeFigureStyle({ axisTitleBold: 1 }).axisTitleBold, false, 'only true / \'true\' switch it on');
  eq(normalizeFigureStyle({ axisTitleItalic: true }).axisTitleItalic, true);
  eq(normalizeFigureStyle({ tickSci: true }).tickSci, true);
  eq(clampFigureDecimals(''), '');
  eq(clampFigureDecimals('3'), 3, 'stored as a number');
  eq(clampFigureDecimals(9), 6, 'clamped to the readable maximum');
  eq(clampFigureDecimals('abc'), '', 'garbage = auto');
  eq(normalizeFigureStyle({ tickDecimals: '2' }).tickDecimals, 2);
  eq(FIGURE_DECIMALS_STEPS[0], '', 'the first one-click value is Auto');
  // The sixteen axis format / scale knobs: real booleans, per axis × kind.
  const legacySci = normalizeFigureStyle({ tickSci: true });
  FIGURE_KINDS.forEach((kind) => {
    eq(legacySci[figureAxisFormatField('xSci', kind)], true, `the legacy tickSci must reach the x axis of ${kind}`);
    eq(legacySci[figureAxisFormatField('ySci', kind)], true, `…and the y axis of ${kind}`);
    eq(legacySci[figureAxisFormatField('xLog', kind)], false, 'a log scale is never switched on by the legacy knob');
    eq(legacySci[figureAxisFormatField('yLog', kind)], false);
  });
  eq(figureAxisAllSci(legacySci), true, 'a legacy profile still means “exponential everywhere”');
  const oneAxes = normalizeFigureStyle({ xSciSpectra: true, yLogAtom: 'true' });
  eq(oneAxes.xSciSpectra, true);
  eq(oneAxes.yLogAtom, true, 'the same true / \'true\' rule everywhere');
  eq(oneAxes.xSci, false, 'the spectra knob does not switch the graphs on');
  eq(oneAxes.tickSci, false, 'tickSci is DERIVED from the eight sci knobs');
  eq(figureAxisAllSci(oneAxes), false);
  eq(figureAxisFormatForKind(oneAxes, 'atom'), { xSci: false, ySci: false, xLog: false, yLog: true });
  eq(figureAxisFormatSummary(oneAxes).map((r) => r.kind), FIGURE_KINDS, 'one row per kind of figure');
  eq(figureAxisFormatSummary(oneAxes)[1].label, FIGURE_KIND_LABELS.atom);
});
check('37b a knob the panel never writes stays readable in the tag', () => {
  // The legacy profile is tagged exactly as before…
  ok(figureStyleTag({ fontSize: 16, tickSci: true }).endsWith('-rot0-sci'));
  // …while a per axis / per kind command names that axis and kind (`s` spectra,
  // `a` atom, `r` residue, nothing = graphs — the letter of the ratios).
  const tag = figureStyleTag({ fontSize: 16, xSciSpectra: true, yLogAtom: true, xLog: true });
  eq(tag, 'fs16-t18-lg16-lb16-rot0-xScis-yLoga-xLog');
  ok(figureStyleTag({ fontSize: 16, xSciSpectra: true }) !== figureStyleTag({ fontSize: 16, xSciAtom: true }),
    'the two kinds must be told apart');
  ok(figureStyleTag({ fontSize: 16, yLog: true }) !== figureStyleTag({ fontSize: 16, ySci: true }),
    'a log scale and the exponential notation must be told apart');
  eq(figureStyleTag({ fontSize: 16, yLog: true, tickDecimals: 0 }), 'fs16-t18-lg16-lb16-rot0-yLog-dec0');
});
check('38 they only show in the tag when they deviate from the default', () => {
  eq(figureStyleTag({ fontSize: 16 }), 'fs16-t18-lg16-lb16-rot0',
    'a profile left at the defaults is tagged exactly as before (old figures still match)');
  ok(figureStyleTag({ fontSize: 16, axisTitleBold: true }).includes('-bold'));
  ok(figureStyleTag({ fontSize: 16, axisTitleItalic: true }).includes('-ital'));
  ok(figureStyleTag({ fontSize: 16, tickSci: true }).includes('-sci'));
  ok(figureStyleTag({ fontSize: 16, tickDecimals: 2 }).includes('-dec2'));
  eq(figureStyleTag({ fontSize: 16, axisTitleBold: true, tickSci: true, tickDecimals: 3 }),
    'fs16-t18-lg16-lb16-rot0-bold-sci-dec3');
});
check('39 ON: they reach the cfg of every chart, on BOTH axes', () => {
  const next = applyFigureStyleToCfg(rechart, axisProfile);
  eq(next.xAxisLabelBold, true);
  eq(next.yAxisLabelBold, true);
  eq(next.xAxisLabelItalic, true);
  eq(next.yAxisLabelItalic, true);
  eq(next.xSci, true);
  eq(next.ySci, true);
  eq(next.xDecimals, 2);
  eq(next.yDecimals, 2);
  ok(!('xLog' in next), 'the legacy “both axes in exponential” profile never switches a log scale on');
  ok(!('yLog' in next));
  eq(next.lineStyle, 'dashed', 'the rest of the cfg is untouched');
  const sp = applyFigureStyleToCfg(spectra, axisProfile);
  eq(sp.xSci, true);
  eq(sp.yDecimals, 2);
  eq(sp.simLabelFormat, 'resNum_code_atom', 'a spectrum keeps its own keys');
});
check('39b the exponential / log commands are resolved PER AXIS and PER KIND of figure', () => {
  const p = {
    ...DEFAULT_FIGURE_STYLE,
    xSciSpectra: true, ySciSpectra: true, // the spectra: both axes in exponential
    yLogAtom: true,                       // the per-atom plots: log y
    xLog: true                            // the graphs: log x
  };
  // A GRAPH takes the bare knobs only.
  const graph = figureStylePatch(p, { ...rechart, xSci: false, yLog: false }, { kind: 'graph' });
  eq(graph.xLog, true);
  eq(graph.xSci, false, 'the spectra knob must not reach a graph');
  eq(graph.yLog, false, 'nor switch anything else on');
  ok(!('ySci' in graph), 'a knob that is off is still never injected as dead plumbing');
  // A SPECTRUM takes the spectra knobs and nothing else.
  const sp = figureStylePatch(p, { ...rechart, xSci: false, ySci: false, xLog: false, yLog: false }, { kind: 'spectra' });
  eq([sp.xSci, sp.ySci, sp.xLog, sp.yLog], [true, true, false, false]);
  // The per-atom plot takes ITS y log knob…
  const atom = figureStylePatch(p, { ...rechart, yLog: false }, { kind: 'atom' });
  eq(atom.yLog, true);
  ok(!('xSci' in atom), 'the spectra / graph knobs never leak into an atom plot');
  // …and a chart that declares no kind is a GRAPH (the historical behaviour).
  eq(figureStylePatch(p, { ...rechart, xLog: false }, null).xLog, true);
  // The shared sizes and the axis-title style are still written everywhere.
  eq(graph.fontSize, 16);
  eq(figureStylePatch(p, { ...rechart }, { kind: 'atom' }).axisTitleFontSize, 18);
});
check('40 OFF: they only clear the cfg keys that are really there', () => {
  const styled = {
    ...rechart,
    xAxisLabelBold: true, yAxisLabelBold: true, xSci: true, ySci: true, xLog: true, yLog: true,
    xDecimals: 2, yDecimals: 2
  };
  const cleared = figureStylePatch(DEFAULT_FIGURE_STYLE, styled);
  eq(cleared.xAxisLabelBold, false);
  eq(cleared.ySci, false);
  eq(cleared.xLog, false);
  eq(cleared.yLog, false);
  eq(cleared.xDecimals, '');
  const fresh = figureStylePatch(DEFAULT_FIGURE_STYLE, rechart);
  ['xAxisLabelBold', 'yAxisLabelBold', 'xAxisLabelItalic', 'yAxisLabelItalic',
    'xSci', 'ySci', 'xLog', 'yLog', 'xDecimals', 'yDecimals']
    .forEach((k) => ok(!(k in fresh), `${k} must not be injected as dead plumbing`));
});
check('40b OFF per kind: only the axes / kinds the profile names are cleared', () => {
  const p = { ...DEFAULT_FIGURE_STYLE, yLogAtom: true };
  const cfg = { ...rechart, xSci: true, ySci: true, xLog: true, yLog: true };
  const cleared = figureStylePatch(p, cfg, { kind: 'atom' });
  eq(cleared.yLog, true, 'the knob the profile asks for stays on');
  eq(cleared.xSci, false, 'the others are cleared');
  eq(cleared.ySci, false);
  eq(cleared.xLog, false);
  const graph = figureStylePatch(p, cfg, { kind: 'graph' });
  eq(graph.yLog, false, 'the atom knob is not a graph knob');
});
check('41 a cfg that does not speak the panel language never gets the axis keys', () => {
  eq(figureCfgAcceptsAxisStyle(rechart), true, 'every page cfg carries at least one panel key');
  eq(figureCfgAcceptsAxisStyle({ color: '#fff' }), false);
  eq(figureCfgAcceptsAxisStyle(null), false);
  eq(figureCfgAcceptsAxisStyle([1, 2]), false);
  const foreign = figureStylePatch(axisProfile, { color: '#fff' });
  eq(foreign.fontSize, 16, 'the shared character sizes still reach every registered chart');
  FIGURE_AXIS_CFG_KEYS.bold.concat(FIGURE_AXIS_CFG_KEYS.italic, FIGURE_AXIS_CFG_KEYS.sci, FIGURE_AXIS_CFG_KEYS.log, FIGURE_AXIS_CFG_KEYS.decimals)
    .forEach((k) => ok(!(k in foreign), `${k} must not be written into a cfg that has no axes panel`));
  const foreignLog = figureStylePatch({ ...axisProfile, yLogAtom: true, xLog: true }, { color: '#fff' });
  ok(!('xLog' in foreignLog) && !('yLog' in foreignLog), 'a log scale is no exception');
});
check('42 a figure the profile was applied to is recognised as styled', () => {
  const styled = applyFigureStyleToCfg(rechart, axisProfile);
  eq(figureStyleMatches(styled, axisProfile), true);
  eq(figureStyleMatches(rechart, axisProfile), false, 'the audit must see the axis commands');
  eq(applyFigureStyleToCfg(styled, axisProfile), null, 'a second apply has nothing left to change');
});
check('43 the panel, the settings page and the Chart.js figures offer the same commands', () => {
  const PANEL = SRC('components/FigureStylePanel.jsx');
  ok(PANEL.includes('axisTitleBold'), 'the profile editor has no bold switch');
  ok(PANEL.includes('axisTitleItalic'), 'the profile editor has no italic switch');
  ok(PANEL.includes('FIGURE_DECIMALS_STEPS'), 'the profile editor has no decimals control');
  // …and the exponential / log commands, one checkbox per axis × kind of figure.
  ok(PANEL.includes('FIGURE_AXIS_BASES') && PANEL.includes('figureAxisFormatField'),
    'the profile editor has no per-axis / per-kind exponential & log switches');
  ok(PANEL.includes('figureAxisFormatSummary'), 'the rows are not built from the profile model');
  ok(PANEL.includes('FIGURE_AXIS_HINTS'), 'the per-kind switches come with no explanation');
  ok(PANEL.includes('FIGURE_AXIS_BASE_LABELS'), 'the switches have no label of their own');
  ok(!PANEL.includes('set({ tickSci'), 'the panel must not write the derived legacy knob');
  const CS4 = SRC('utils/chartStyle.js');
  ok(CS4.includes("on('Bold') ? { weight: 'bold' } : {}"), 'Chart.js axis titles ignore the bold command');
  ok(CS4.includes("on('Italic') ? { style: 'italic' } : {}"), 'Chart.js axis titles ignore the italic command');
  const SAT2 = SRC('components/SharedAnalysisTools.jsx');
  ok(SAT2.includes("export const chartJsTickCallback = (cfg = {}, axis = 'x') => (v) => {"), 'no Chart.js tick callback helper');
  ok(SAT2.includes("const sci = axis === 'x' ? !!cfg.xSci : !!cfg.ySci;"), 'cfgTickFormatter does not read the profile keys');
  // The log scale the profile writes is the very key the charts read.
  ok(/export const cfgLogScale = \(cfg = \{\}, axis = 'x'\) =>\s+\(\(axis === 'x' \? !!cfg\.xLog : !!cfg\.yLog\) \? 'log' : 'auto'\);/.test(SAT2),
    'cfgLogScale does not read the xLog / yLog keys');
  const SET = SRC('components/AppModules/settingsModule.jsx');
  ok(SET.includes('exponential notation'), 'the Settings page does not mention the axis commands');
  ok(SET.includes('logarithmic scale'), 'the Settings page does not mention the log scale');
});

/* ══ 7. ONE plot-box ratio PER KIND of figure ═══════════════════════════════
   Settings → Figure style has to shape a 1D spectrum differently from a
   per-atom bar chart, a per-residue bar chart and a plain graph.            */
check('44 the four kinds exist, each with its own profile field and a neutral default', () => {
  eq(FIGURE_KINDS, ['spectra', 'atom', 'residue', 'graph']);
  eq(DEFAULT_FIGURE_KIND, 'graph', 'a chart that declares nothing is a plain graph');
  eq(FIGURE_KIND_FIELDS, { spectra: 'aspectSpectra', atom: 'aspectAtom', residue: 'aspectResidue', graph: 'aspect' });
  eq(FIGURE_ASPECT_FIELDS, ['aspectSpectra', 'aspectAtom', 'aspectResidue', 'aspect']);
  FIGURE_KINDS.forEach((k) => eq(DEFAULT_FIGURE_STYLE[FIGURE_KIND_FIELDS[k]], 0, `${k} must default to "its own ratio"`));
  eq(DEFAULT_FIGURE_STYLE.aspect, 0, 'the graph knob IS the historical `aspect` key (old profiles keep working)');
  eq(normalizeFigureKind('spectra'), 'spectra');
  eq(normalizeFigureKind('SPECTRA'), 'graph', 'a kind is exact — no fuzzy matching');
  eq(normalizeFigureKind(''), 'graph');
  eq(normalizeFigureKind(null), 'graph');
  eq(normalizeFigureKind(7), 'graph');
});
check('45 every kind has its own clamped ratio — 0 = "its own shape"', () => {
  const p = normalizeFigureStyle({ aspect: 1.8, aspectSpectra: 2.2, aspectAtom: -1, aspectResidue: 99 });
  eq(p.aspect, 1.8);
  eq(p.aspectSpectra, 2.2);
  eq(p.aspectAtom, 0, 'a negative ratio cannot exist');
  eq(p.aspectResidue, FIGURE_ASPECT_MAX, 'the same upper bound as the historical knob');
  eq(figureAspectFieldForKind('atom'), 'aspectAtom');
  eq(figureAspectFieldForKind('nonsense'), 'aspect');
  eq(figureAspectForKind(p, 'spectra'), 2.2);
  eq(figureAspectForKind(p, 'atom'), 0);
  eq(figureAspectForKind(p, 'residue'), FIGURE_ASPECT_MAX);
  eq(figureAspectForKind(p, 'anything else'), 1.8, 'an undeclared figure keeps following the graph knob');
  eq(figureAspectSummary(p).map((a) => `${a.kind}=${a.ratio}`),
    ['spectra=2.2', 'atom=0', `residue=${FIGURE_ASPECT_MAX}`, 'graph=1.8'], 'the panel rows, in order');
  eq(figureAspectSummary(p).map((a) => a.label), FIGURE_KINDS.map((k) => FIGURE_KIND_LABELS[k]));
});
check('46 the profile hands every figure the ratio of ITS kind', () => {
  const p = { ...DEFAULT_FIGURE_STYLE, aspect: 1.8, aspectSpectra: 2.2, aspectAtom: 2.5, aspectResidue: 1.2 };
  const cfg0 = { height: 300, aspect: 1, fontSize: 16 };
  eq(figureStylePatch(p, cfg0, { kind: 'spectra' }),
    { fontSize: 16, axisTitleFontSize: 18, legendFontSize: 16, aspect: 2.2, figureAspect: 2.2 },
    'the spectrum takes the spectra ratio');
  eq(figureStylePatch(p, cfg0, { kind: 'atom' }).figureAspect, 2.5);
  eq(figureStylePatch(p, cfg0, { kind: 'residue' }).figureAspect, 1.2);
  eq(figureStylePatch(p, cfg0, null).figureAspect, 1.8, 'no kind = graph');
  // A kind the profile left at 0 gives the figure its own ratio BACK.
  const imposed = { ...cfg0, aspect: 2.2, figureAspect: 2.2 };
  eq(figureStylePatch({ ...DEFAULT_FIGURE_STYLE, aspect: 1.8 }, imposed, { kind: 'spectra' })[FIGURE_ASPECT_KEY], 0,
    'the spectra knob at 0 releases the ratio a previous apply imposed');
  eq(applyFigureStyleToCfg(imposed, { ...DEFAULT_FIGURE_STYLE, aspect: 1.8 }, { kind: 'spectra' }).aspect, 2.2,
    '…while the per-chart panel keeps showing the ratio of the chart itself');
  eq(applyFigureStyleToCfg(cfg0, { ...DEFAULT_FIGURE_STYLE, aspectAtom: 2.5 }, { kind: 'atom' }).figureAspect, 2.5);
});

check('47 the 🎨 button gives every registered figure the ratio of its own kind', () => {
  let graphCfg = { height: 300, aspect: 1, fontSize: 16 };
  let atomCfg = { height: 300, aspect: 1, fontSize: 16 };
  let specCfg = { height: 300, aspect: 1, fontSize: 16 };
  const offG = registerFigureStyleSlot({ get: () => graphCfg, set: (n) => { graphCfg = n; } });
  const offA = registerFigureStyleSlot({ get: () => atomCfg, set: (n) => { atomCfg = n; }, kind: 'atom' });
  const offS = registerFigureStyleSlot({ get: () => specCfg, set: (n) => { specCfg = n; }, kind: 'spectra' });
  const res = applyFigureStyleToSlots({ fontSize: 16, aspect: 1.8, aspectAtom: 2.5, aspectSpectra: 2.2 });
  eq(res.changed, 3);
  eq(graphCfg.figureAspect, 1.8, 'a chart that declares nothing stays on the historical knob');
  eq(atomCfg.figureAspect, 2.5);
  eq(specCfg.figureAspect, 2.2);
  eq(atomCfg.aspect, 2.5, 'the per-chart panel shows the ratio the figure was drawn with');
  // The per-atom knob of THAT profile is 0 → the per-atom chart goes back to its own shape.
  applyFigureStyleToSlots({ fontSize: 16, aspect: 1.8 });
  eq(atomCfg.figureAspect, 0, 'a kind left at 0 keeps the shape of the chart own panel');
  eq(specCfg.figureAspect, 0);
  undoFigureStyleSlots();
  offG(); offA(); offS();
  eq(figureStyleSlotCount(), 0);
});
check('48 the kind ratios only show in the tag when they are imposed', () => {
  eq(figureStyleTag({ fontSize: 16 }), 'fs16-t18-lg16-lb16-rot0', 'the tag of an untouched profile must not change');
  eq(figureStyleTag({ fontSize: 16, aspectSpectra: 2 }), 'fs16-t18-lg16-lb16-rot0-ars2');
  eq(figureStyleTag({ fontSize: 16, aspect: 1.8, aspectSpectra: 2, aspectAtom: 2.5, aspectResidue: 1.2 }),
    'fs16-t18-lg16-lb16-rot0-ar1.8-ars2-ara2.5-arr1.2');
  ok(figureStyleTag({ fontSize: 16, aspectAtom: 2 }) !== figureStyleTag({ fontSize: 16, aspectAtom: 2.5 }),
    'the per-atom ratio must change the tag (the Image Builder audit relies on it)');
});
check('49 the four kinds are wired from Settings down to every figure', () => {
  const SAT3 = SRC('components/SharedAnalysisTools.jsx');
  ok(SAT3.includes('figureKind = null'), 'the inspectors / wrappers have no figureKind prop');
  ok(SAT3.includes('<ChartInspector cfg={cfg} setCfg={setCfg} series={series} unit={unit} figureKind={figureKind}'),
    'ChartPanel does not forward the kind of its chart');
  ok(/series=\{safeSeries\}[\s\S]{0,40}unit=\{unit\}[\s\S]{0,40}figureKind=\{figureKind\}/.test(SAT3),
    'SharedChart does not forward the kind of its chart');
  ok(TOOLS.includes('normalizeFigureKind(kind)'), 'the hook does not normalise the kind');
  ok(TOOLS.includes('kind: slotKind'), 'the hook does not register the kind');
  ok(FSJS.includes('applyFigureStyleToCfg(cur, profile, { ...(options || {}), kind: slot.kind })'),
    'the fan-out ignores the kind of each slot');
  const nmr = readFileSync('./src/components/NMRSections.jsx', 'utf8');
  ok(nmr.includes("useFigureStyleSlot(nmr1dCfg, setNmr1dCfg, 'spectra');"),
    'the imported 1D NMR spectrum is not registered as a spectrum');
  eq(nmr.split('figureKind="spectra"').length - 1, 2, 'the simulated NMR 1D / 2D spectra are not marked as spectra');
  ok(nmr.includes('figureKind="atom"'), 'the NMR per-atom charts are not marked');
  ['CDSections', 'ssNMRSections'].forEach((f) => {
    const s = readFileSync(`./src/components/${f}.jsx`, 'utf8');
    eq(s.split('figureKind="spectra"').length - 1, 2, `${f}: overlay + individual spectra must be spectra`);
  });
  const md = readFileSync('./src/components/MDSections.jsx', 'utf8');
  ok(md.includes('figureKind="atom"'), 'the MD per-atom charts are not marked');
  ok(md.includes('figureKind="residue"'), 'the MD per-residue chart is not marked');
  ok(PANEL.includes('FIGURE_KINDS.map('), 'Settings offers no row per kind');
  ok(PANEL.includes('figureAspectSummary(profile)'), 'the preview does not draw the four boxes');
  ok(PANEL.includes('FIGURE_KIND_LABELS[kind]'), 'the rows do not name the kinds of figure');
  ok(PANEL.includes('FIGURE_KIND_FIELDS[kind]'), 'the rows are not bound to their own profile field');
  ok(TOOLS.includes('figureAspectSummary(profile)'), 'the 🎨 chip does not list the imposed ratios');
});

/* ══ 8. THE SAVED CONFIGURATIONS ═════════════════════════════════════════════
   ONE profile is not enough: a set of figures needs oversized characters while
   the user reads the app with small ones. Settings → Figure style therefore
   saves NAMED configurations (`labFigureStyles`), each one a complete profile,
   and switching is one click — from the Settings page or from the 🎨 chip.   */
const resetConfigs = () => { writeFigureStyleConfigs([]); eq(readFigureStyleConfigs(), []); };

check('50 the configurations have their own storage, a name and a cap', () => {
  eq(FIGURE_STYLE_LIBRARY_KEY, 'labFigureStyles');
  eq(FIGURE_STYLE_LIBRARY_EVENT, 'lab:figure-style-library-changed');
  ok(FIGURE_STYLE_PRESET_MAX >= 4 && FIGURE_STYLE_PRESET_MAX <= 100, 'a usable cap');
  eq(FIGURE_STYLE_PRESET_NAME_MAX, 40);
  resetConfigs();
  eq(normalizeFigureStyleConfigName('  Figure   —  A4 \n'), 'Figure — A4', 'one line, trimmed, single spaced');
  eq(normalizeFigureStyleConfigName(null), '');
  eq(normalizeFigureStyleConfigName('x'.repeat(200)).length, FIGURE_STYLE_PRESET_NAME_MAX);
  eq(figureStyleConfigName({ fontSize: 36, axisTitleFontSize: 40, legendFontSize: 36, simLabelFontSize: 36 }),
    '36/40/36/36 px', 'the name a profile suggests');
  eq(figureStyleConfigName({ ...DEFAULT_FIGURE_STYLE, tickAngle: -45 }), '16/18/16/16 px · rot -45°');
  eq(figureStyleConfigSummary({ fontSize: 36 }), '36/18/16/16 px');
  eq(figureStyleConfigSummary({
    fontSize: 16, axisTitleBold: true, tickDecimals: 2, xLog: true, aspectSpectra: 2, fontFamily: 'Arial'
  }), '16/18/16/16 px · bold · 2 dec · log ×1 · spectra 2:1 · Arial',
  'the summary lists the commands the configuration carries');
});
check('51 saving: a configuration is a FULL profile, and a known name replaces it', () => {
  resetConfigs();
  const figure = {
    fontSize: 36, axisTitleFontSize: 40, legendFontSize: 36, simLabelFontSize: 36,
    tickAngle: -30, axisTitleBold: true, tickDecimals: 1, fontFamily: 'Arial',
    ySciAtom: true, xLog: true, aspectSpectra: 2, aspect: 1.33
  };
  const a = saveFigureStyleConfig('Figure — A4', figure);
  eq([a.created, a.replaced, a.dropped], [true, false, 0]);
  eq(a.config.name, 'Figure — A4');
  eq(a.config.style.fontSize, 36);
  eq(a.config.style.axisTitleFontSize, 40);
  eq(a.config.style.ySciAtom, true, 'the per-axis exponential switch is saved with the configuration');
  eq(a.config.style.xLog, true);
  eq(a.config.style.aspectSpectra, 2);
  eq(a.config.style.aspect, 1.33);
  eq(a.config.style.fontFamily, 'Arial');
  eq(a.config.style.tickAngle, -30);
  eq(figureStyleTag(a.config.style), figureStyleTag(figure), 'the tag is derived from the style, never saved');
  eq(figureStyleConfigSummary(a.config.style).includes('spectra 2:1'), true);
  ok(!!a.config.savedAt, 'a configuration is dated');
  eq(readFigureStyleConfigs().length, 1);
  eq(readFigureStyleConfigs()[0].id, a.config.id, 'the list holds the very entry that was saved');
  // The same name — whatever the case, whatever the spaces — UPDATES it.
  const b = saveFigureStyleConfig('   figure — a4  ', { fontSize: 12 });
  eq([b.created, b.replaced], [false, true]);
  eq(b.config.id, a.config.id, 'the id survives an update (a page can keep pointing at it)');
  eq(b.config.name, 'figure — a4', 'the name of the last save wins');
  eq(b.config.style.fontSize, 12);
  eq(b.config.style.ySciAtom, false, 'an update replaces the WHOLE profile, it does not merge');
  eq(readFigureStyleConfigs().length, 1);
  // An empty name falls back to the sizes of the profile.
  const c = saveFigureStyleConfig('', { fontSize: 20 });
  eq(c.config.name, '20/18/16/16 px');
  eq(readFigureStyleConfigs().length, 2);
  eq(readFigureStyleConfigs()[0].id, c.config.id, 'the newest configuration comes first');
  eq(readFigureStyleConfigs()[0].name, '20/18/16/16 px');
});
check('52 the library is capped: the oldest configuration is dropped', () => {
  resetConfigs();
  for (let i = 0; i < FIGURE_STYLE_PRESET_MAX; i += 1) saveFigureStyleConfig(`S${i}`, { fontSize: 10 + i });
  eq(readFigureStyleConfigs().length, FIGURE_STYLE_PRESET_MAX);
  eq(readFigureStyleConfigs()[0].name, `S${FIGURE_STYLE_PRESET_MAX - 1}`, 'the newest is first');
  const over = saveFigureStyleConfig('Extra', { fontSize: 30 });
  eq(over.dropped, 1, 'the cap pushed exactly one out');
  eq(readFigureStyleConfigs().length, FIGURE_STYLE_PRESET_MAX);
  eq(readFigureStyleConfigs().some((c) => c.name === 'Extra'), true);
  eq(readFigureStyleConfigs().some((c) => c.name === 'S0'), false, 'the oldest one is gone');
  eq(readFigureStyleConfigs().some((c) => c.name === 'S1'), true, 'the recent ones stay');
  resetConfigs();
});

check('53 the configuration the profile currently IS gets recognised', () => {
  resetConfigs();
  const before = readFigureStyle();
  saveFigureStyleConfig('Screen', DEFAULT_FIGURE_STYLE);
  eq(figureStylesEqual(DEFAULT_FIGURE_STYLE, { fontSize: 16 }), true, 'a partial object normalises before the compare');
  eq(figureStylesEqual(DEFAULT_FIGURE_STYLE, { fontSize: 20 }), false);
  eq(figureStylesEqual({ ...DEFAULT_FIGURE_STYLE, applyOnOpen: true }, DEFAULT_FIGURE_STYLE), true,
    'applyOnOpen says WHEN a page styles itself — it is not part of the look');
  writeFigureStyle(DEFAULT_FIGURE_STYLE);
  eq(figureStyleConfigForStyle().name, 'Screen', 'the live profile is recognised');
  writeFigureStyle({ ...DEFAULT_FIGURE_STYLE, fontSize: 20 });
  eq(figureStyleConfigForStyle(), null, 'a profile nobody saved has no configuration');
  eq(figureStyleConfigForStyle({ fontSize: 16 }).name, 'Screen', 'a given profile is recognised too');
  writeFigureStyle(before);
  resetConfigs();
});
check('54 switching: the configuration BECOMES the profile, and can restyle the page', () => {
  resetConfigs();
  const before = readFigureStyle();
  const c = saveFigureStyleConfig('Figure — big',
    { fontSize: 36, axisTitleFontSize: 40, aspect: 1.33, xLog: true, fontFamily: 'Arial' }).config;
  writeFigureStyle(DEFAULT_FIGURE_STYLE);
  eq(applyFigureStyleConfig('nope'), null, 'an unknown id changes nothing');
  const res = applyFigureStyleConfig(c.id);
  eq(res.config.id, c.id);
  eq(res.tag, figureStyleTag(c.style));
  eq(res.applied, false, 'without `slots` the Settings page (no chart of its own) is not styled');
  eq(readFigureStyle().fontSize, 36);
  eq(readFigureStyle().axisTitleFontSize, 40);
  eq(readFigureStyle().aspect, 1.33);
  eq(readFigureStyle().xLog, true);
  eq(readFigureStyle().fontFamily, 'Arial');
  eq(figureStyleConfigForStyle().name, 'Figure — big');
  // …and with `slots` the charts of the open page are rewritten right away:
  let cfg = { fontSize: 16, height: 300, aspect: 1 };
  const off = registerFigureStyleSlot({ get: () => cfg, set: (next) => { cfg = next; } });
  const pushed = applyFigureStyleConfig(c.id, { slots: true });
  eq([pushed.applied, pushed.changed, pushed.total], [true, 1, 1]);
  eq(cfg.fontSize, 36, 'the chart takes the characters of the configuration');
  eq(cfg.figureAspect, 1.33, '…and its plot-box ratio');
  off();
  writeFigureStyle(before);
  resetConfigs();
});
check('55 rename / delete: a name identifies a configuration, and it stays unique', () => {
  resetConfigs();
  const a = saveFigureStyleConfig('A', { fontSize: 12 }).config;
  const b = saveFigureStyleConfig('B', { fontSize: 14 }).config;
  eq(renameFigureStyleConfig(a.id, '  Screen  ').name, 'Screen');
  eq(figureStyleConfigById(a.id).name, 'Screen');
  eq(renameFigureStyleConfig(a.id, ''), null, 'a configuration always has a name');
  eq(renameFigureStyleConfig(a.id, 'B'), null, 'two configurations cannot share a name');
  eq(renameFigureStyleConfig(a.id, 'b'), null, '…not even in another case');
  eq(renameFigureStyleConfig('nope', 'X'), null);
  eq(figureStyleConfigById('nope'), null);
  eq(renameFigureStyleConfig(a.id, 'Screen').name, 'Screen', 'renaming to its own name is not a clash');
  eq(deleteFigureStyleConfig(b.id).name, 'B', 'the removed entry is returned');
  eq(readFigureStyleConfigs().map((c) => c.name), ['Screen']);
  eq(readFigureStyleConfigs()[0].style.fontSize, 12, 'the configuration that stays is untouched');
  eq(deleteFigureStyleConfig(b.id), null, 'deleting twice is a no-op, not an error');
  resetConfigs();
});

check('56 export / import moves the configurations to another browser', () => {
  resetConfigs();
  saveFigureStyleConfig('Screen', { fontSize: 16, yLogAtom: true });
  const big = { fontSize: 36, axisTitleFontSize: 40, fontFamily: 'Arial', aspectSpectra: 2 };
  saveFigureStyleConfig('Figure — A4', big);
  const dump = exportFigureStyleConfigs();
  ok(typeof dump === 'string' && dump.includes('Figure — A4'), 'the backup names the configurations');
  eq(dump.includes('figstyle_'), false, 'the ids stay out of a backup — the name is the identity');
  resetConfigs();
  const back = importFigureStyleConfigs(dump);
  eq([back.added, back.replaced, back.skipped, back.error], [2, 0, 0, '']);
  eq(readFigureStyleConfigs().map((c) => c.name).sort(), ['Figure — A4', 'Screen']);
  eq(figureStyleConfigForStyle(big).name, 'Figure — A4', 'an imported configuration IS the one that was exported');
  eq(readFigureStyleConfigs().find((c) => c.name === 'Figure — A4').style.ySciAtom, false,
    'a full profile — the knobs the export did not set are at their default');
  // Importing the same backup again REPLACES, it never duplicates:
  const again = importFigureStyleConfigs(dump);
  eq([again.added, again.replaced], [0, 2]);
  eq(readFigureStyleConfigs().length, 2);
  // One configuration, and a bare profile, are accepted too:
  eq(importFigureStyleConfigs({ name: 'One', style: { fontSize: 22 } }).added, 1);
  eq(figureStyleConfigForStyle({ fontSize: 22 }).name, 'One');
  eq(importFigureStyleConfigs({ fontSize: 24 }).added, 1, 'a bare profile is a configuration too');
  eq(readFigureStyleConfigs().length, 4);
  // A corrupt / foreign payload never throws and never wipes the library:
  eq(importFigureStyleConfigs('not json'), { added: 0, replaced: 0, skipped: 0, error: 'invalid' });
  eq(readFigureStyleConfigs().length, 4, 'the library survives a corrupt import');
  eq(importFigureStyleConfigs([{ name: 'Nope' }]).skipped, 1, 'an entry without a profile is skipped');
  eq(importFigureStyleConfigs([1, null, 'x']).skipped, 3);
  eq(readFigureStyleConfigs().length, 4);
  eq(importFigureStyleConfigs(null).added, 0, 'nothing to import is not an error');
  resetConfigs();
});
check('57 a stored library is cleaned on the way in: name, id, unknown keys', () => {
  resetConfigs();
  let seen = null;
  const off = subscribeFigureStyleConfigs((list) => { seen = list; });
  const saved = saveFigureStyleConfig('Screen', { fontSize: 20 });
  ok(!!seen && seen.length === 1 && seen[0].id === saved.config.id, 'the subscribers are told about a save');
  off();
  writeFigureStyleConfigs([{ id: 'x', name: 'kept', style: { fontSize: 20 }, savedAt: '2024-01-01' }]);
  eq(readFigureStyleConfigs()[0].name, 'kept');
  eq(readFigureStyleConfigs()[0].savedAt, '2024-01-01', 'a stored date survives a read');
  // A half entry, a duplicate id and unknown keys never come back out:
  writeFigureStyleConfigs([
    { name: 'no profile' },
    { id: 'dup', name: 'one', style: { fontSize: 20 } },
    { id: 'dup', name: 'two', style: { fontSize: 22 } },
    { id: 'k', style: { fontSize: 24, colors: { a: 1 }, height: 400 } }
  ]);
  eq(readFigureStyleConfigs().map((c) => c.name), ['one', '24/18/16/16 px'],
    'an entry without a name gets the sizes one, and a duplicate id is dropped');
  eq(readFigureStyleConfigs()[1].style.colors, undefined, 'only the profile fields are kept');
  eq('height' in readFigureStyleConfigs()[1].style, false);
  eq(readFigureStyleConfigs()[1].style.fontSize, 24);
  resetConfigs();
});
check('58 Settings and the 🎨 button can both save and switch configurations', () => {
  const PANEL2 = SRC('components/FigureStylePanel.jsx');
  ['useFigureStyleConfigs', 'figureStyleConfigForStyle', 'figureStyleConfigName', 'figureStyleConfigSummary',
    'saveFigureStyleConfig', 'renameFigureStyleConfig', 'deleteFigureStyleConfig', 'applyFigureStyleConfig',
    'exportFigureStyleConfigs', 'importFigureStyleConfigs', 'FIGURE_STYLE_PRESET_MAX']
    .forEach((t) => ok(PANEL2.includes(t), `the Settings panel does not use ${t}`));
  ok(PANEL2.includes('<ConfigRow'), 'the saved configurations are not listed');
  eq(/window\.prompt/.test(PANEL2), false, 'renaming must not go through a browser prompt');
  ok(PANEL2.includes('Save the current settings') && PANEL2.includes('⤓ Update'),
    'there is no way to save what is set above');
  const TOOLS2 = SRC('components/FigureStyleTools.jsx');
  ['useFigureStyleConfigs', 'figureStyleConfigForStyle', 'figureStyleConfigName',
    'saveFigureStyleConfig', 'applyFigureStyleConfig']
    .forEach((t) => ok(TOOLS2.includes(t), `the 🎨 chip does not use ${t}`));
  ok(TOOLS2.includes('applyFigureStyleConfig(id, { slots: true })'),
    'switching a configuration on a page does not restyle that page');
  ok(TOOLS2.includes('update({ figureStyleTag: res.tag, figureStyleAppliedAt: new Date().toISOString() })'),
    'a switch is not recorded on the experiment');
  const SET2 = SRC('components/AppModules/settingsModule.jsx');
  ok(SET2.includes('SAVES your configurations'), 'the Settings page does not announce the saved configurations');
});

const failed = results.filter((r) => !r.ok);
console.table(results.map((r) => ({ name: r.name, ok: r.ok, error: r.ok ? '' : r.got })));
if (failed.length) {
  console.error(`\n❌ ${failed.length}/${results.length} checks failed`);
  process.exit(1);
}
console.log(`\n✅ ${results.length}/${results.length} checks passed`);
