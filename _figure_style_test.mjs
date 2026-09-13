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
  DEFAULT_FIGURE_STYLE, FIGURE_FONT_MIN, FIGURE_FONT_MAX,
  FIGURE_STYLE_KEY, FIGURE_STYLE_EVENT, FIGURE_STYLE_FIELDS,
  normalizeFigureStyle, clampFigureFont, clampFigureAngle,
  readFigureStyle, writeFigureStyle, figureStyleTag,
  figureStylePatch, figureStyleMatches, applyFigureStyleToCfg,
  registerFigureStyleSlot, figureStyleSlotCount, applyFigureStyleToSlots,
  undoFigureStyleSlots, figureStyleUndoAvailable
} from './src/utils/figureStyle.js';

const results = [];
const check = (name, fn) => {
  try { fn(); results.push({ name, ok: true, got: '' }); }
  catch (e) { results.push({ name, ok: false, got: e.message }); }
};
const eq = (a, b, msg) => assert.deepEqual(a, b, msg || `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
const ok = (v, msg) => assert.ok(v, msg);
const SRC = (p) => readFileSync(`./src/${p}`, 'utf8');

/* ══ 1. the profile: defaults, clamping, stored JSON ══════════════════════ */
check('1 the default profile is 16 px everywhere, no rotation, no auto-apply', () => {
  eq(DEFAULT_FIGURE_STYLE, { fontSize: 16, simLabelFontSize: 16, tickAngle: 0, applyOnOpen: false });
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
check('3 character sizes are clamped to a readable range', () => {
  eq(clampFigureFont(2), FIGURE_FONT_MIN);
  eq(clampFigureFont(999), FIGURE_FONT_MAX);
  eq(normalizeFigureStyle({ fontSize: 400 }).fontSize, FIGURE_FONT_MAX);
  eq(normalizeFigureStyle({ fontSize: 0 }).fontSize, FIGURE_FONT_MIN);
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
  eq(Object.keys(p).sort(), ['applyOnOpen', 'fontSize', 'simLabelFontSize', 'tickAngle']);
});
check('6 read/write round-trip (browser storage is optional in Node)', () => {
  const before = readFigureStyle();
  writeFigureStyle({ fontSize: 20, simLabelFontSize: 18, tickAngle: 45, applyOnOpen: true });
  eq(readFigureStyle(), { fontSize: 20, simLabelFontSize: 18, tickAngle: 45, applyOnOpen: true });
  eq(figureStyleTag(), 'fs20-lb18-rot45');
  writeFigureStyle(before);
  eq(readFigureStyle(), before);
});

/* ══ 2. the tag: what identifies "this figure's style" ════════════════════ */
check('7 the tag follows the three knobs', () => {
  eq(figureStyleTag({ fontSize: 16, simLabelFontSize: 12, tickAngle: 0 }), 'fs16-lb12-rot0');
  eq(figureStyleTag({ fontSize: 12, simLabelFontSize: 12, tickAngle: 0 }), 'fs12-lb12-rot0');
  ok(figureStyleTag({ fontSize: 16 }) !== figureStyleTag({ fontSize: 20 }), 'the size must change the tag');
  ok(figureStyleTag({ fontSize: 16, tickAngle: 45 }) !== figureStyleTag({ fontSize: 16 }), 'the rotation must change the tag');
});
check('8 a partial profile is tagged with the defaults of the missing knobs', () => {
  eq(figureStyleTag({ fontSize: 20 }), 'fs20-lb16-rot0');
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
  eq(next, { fontSize: 20, simLabelFontSize: 18, tickAngle: 45 });
});
check('12 nothing to do → null (no pointless re-render / test save)', () => {
  eq(applyFigureStyleToCfg({ fontSize: 20, simLabelFontSize: 18, tickAngle: 45 }, profile), null);
  eq(applyFigureStyleToCfg({ fontSize: '20', simLabelFontSize: '18', tickAngle: '45' }, profile), null,
    'a cfg stored as text numbers is already styled');
  eq(applyFigureStyleToCfg(null, profile), null);
  eq(applyFigureStyleToCfg(undefined, profile), null);
  eq(applyFigureStyleToCfg([1, 2], profile), null);
});
check('13 figureStylePatch / figureStyleMatches describe the same rule', () => {
  eq(figureStylePatch(profile, rechart), { fontSize: 20 });
  eq(figureStylePatch(profile, spectra), { fontSize: 20, simLabelFontSize: 18, tickAngle: 45 });
  eq(figureStyleMatches({ fontSize: 20, simLabelFontSize: 18, tickAngle: 45 }, profile), true);
  eq(figureStyleMatches(rechart, profile), false);
});
check('14 the profile fields are the single source of the applied keys', () => {
  eq(FIGURE_STYLE_FIELDS, ['fontSize', 'simLabelFontSize', 'tickAngle']);
  eq(Object.keys(figureStylePatch(profile, spectra)).sort(), ['fontSize', 'simLabelFontSize', 'tickAngle'].sort());
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
  eq(res.tag, 'fs20-lb18-rot45');
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

check('19 the profile editor lives in Settings', () => {
  ok(SETTINGS.includes("import { FigureStylePanel } from '../FigureStylePanel';"), 'the panel is not imported');
  ok(SETTINGS.includes('title="Figure style — uniform fonts & character sizes"'), 'no Settings section');
  ok(SETTINGS.includes('<FigureStylePanel />'), 'the section does not render the panel');
});
check('20 the panel exposes exactly the three shared knobs', () => {
  ok(PANEL.includes('Axis & tick characters'), 'the shared character size is missing');
  ok(PANEL.includes('Peak / data labels (spectra)'), 'the spectra label size is missing');
  ok(PANEL.includes('X label rotation (spectra)'), 'the x-rotation is missing');
  ok(PANEL.includes('writeFigureStyle('), 'the panel does not save the profile');
  ok(PANEL.includes('Apply automatically when an experiment page is opened'), 'no auto-apply option');
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
  ok(TOOLS.includes("document.querySelector('[data-expand-all]')"), 'the Expand all button is not used');
  ok(TOOLS.includes('btn.click()'), 'the closed sections are never opened');
  ok(TOOLS.includes('setTimeout(() => applyToSlots(), 900)'), 'the delayed re-apply is missing');
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
  ok(CSL.includes("import { figureStyleTag } from '../utils/figureStyle';"), 'no import of the tag helper');
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

const failed = results.filter((r) => !r.ok);
console.table(results.map((r) => ({ name: r.name, ok: r.ok, error: r.ok ? '' : r.got })));
if (failed.length) {
  console.error(`\n❌ ${failed.length}/${results.length} checks failed`);
  process.exit(1);
}
console.log(`\n✅ ${results.length}/${results.length} checks passed`);
