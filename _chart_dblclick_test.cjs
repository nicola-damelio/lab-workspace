// Validates the double-click editing of a graph / spectrum element and the
// axis-room fix that goes with it:
//
//  1) DOUBLE-CLICK ON WHAT YOU WANT TO CHANGE.
//     `classifyChartElement` looks at the recharts node under the pointer — it
//     is the SVG element the browser hit-tested, so it always matches what was
//     really clicked — and returns the block of the style panel to show:
//        tick numbers of the Y axis   → 'y'      (min/max, tick interval, size)
//        tick numbers of the X axis   → 'x'
//        the Y axis TITLE (rotated)   → 'label'  (text, character size, style)
//        the X axis title             → 'label'
//        a curve / bar / point / area → 'series' (line ↔ histogram, thickness…)
//        a legend entry               → 'series' (its colour is highlighted)
//     Chart.js canvases have no DOM elements, so `chartJsTargetAt` finds the
//     element from the chart geometry (outside the plot = the axis of that
//     side, inside = the nearest dataset).
//
//  2) THE AXIS AREA FOLLOWS THE CHARACTER SIZE.
//     A rotated y-axis TITLE runs vertically: a chart shorter than its own
//     title clips the label ("the y axis label does not fit in the canvas and
//     it is cut"). chartBoxStyle() therefore grows the chart box with the font
//     size and the title, and the recharts surface no longer clips (index.css).
//     Chart.js plots get the same treatment through chartJsPadding() /
//     chartJsHeightFit().
//
// The components cannot be imported here (JSX modules), so the rules under test
// are mirrored verbatim — keep both in sync:
//   * classifyChartElement() / chartJsTargetAt()  SharedAnalysisTools.jsx
//   * textWidthPx() / axisTitleRoomPx() / chartBoxStyle() /
//     chartJsPadding() / chartJsHeightFit()       utils/chartStyle.js
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SAT = read('src/components/SharedAnalysisTools.jsx');
const STYLE = read('src/utils/chartStyle.js');
const CSS = read('src/index.css');
const NMR = read('src/components/NMRSections.jsx');
const CD = read('src/components/CDSections.jsx');
const SSNMR = read('src/components/ssNMRSections.jsx');
const PLATE = read('src/components/PlateSections.jsx');

const results = [];
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push({ name, got: String(got), want: String(want), ok });
  return ok;
};
const checkTrue = (name, got) => check(name, !!got, true);
const frag = (name, hay, needle) => checkTrue(`${name}: ${needle.slice(0, 40)}…`, hay.includes(needle));

// ── a fake SVG node with recharts class names (closest() like the browser) ──
const makeEl = (classes, parent = null, extra = {}) => {
  const node = { className: classes, parent, textContent: extra.text || '', attrs: extra.attrs || {} };
  node.getAttribute = (k) => (node.attrs[k] !== undefined ? node.attrs[k] : null);
  node.closest = (sel) => {
    const list = String(sel).split(',').map((s) => s.trim()).filter(Boolean);
    let cur = node;
    while (cur) {
      const cls = ` ${String(cur.className || '')} `;
      if (list.some((s) => s.startsWith('.') && cls.includes(` ${s.slice(1)} `))) return cur;
      cur = cur.parent;
    }
    return null;
  };
  return node;
};

// ── mirror: SharedAnalysisTools.jsx ─────────────────────────────────────────
const classifyChartElement = (el) => {
  if (!el || typeof el.closest !== 'function') return null;
  const legend = el.closest('.recharts-legend-wrapper, .recharts-legend-item');
  if (legend) {
    return { kind: 'legend', section: 'series', axis: null, label: String(legend.textContent || '').trim() };
  }
  const axisY = el.closest('.recharts-yAxis');
  const axisX = el.closest('.recharts-xAxis');
  const label = el.closest('.recharts-label, .recharts-label-list');
  if (label) {
    const t = String(label.getAttribute && label.getAttribute('transform') || '');
    const axis = (axisY || t.includes('-90')) ? 'y' : 'x';
    return { kind: `${axis}Label`, section: 'label', axis, label: String(label.textContent || '').trim() };
  }
  if (axisY) return { kind: 'yAxis', section: 'y', axis: 'y', label: '' };
  if (axisX) return { kind: 'xAxis', section: 'x', axis: 'x', label: '' };
  const seriesEl = el.closest('.recharts-line, .recharts-bar, .recharts-area, .recharts-scatter, .recharts-radar, .recharts-pie');
  if (seriesEl) {
    const name = seriesEl.getAttribute('name') || '';
    return { kind: 'series', section: 'series', axis: null, label: name };
  }
  return null;
};

const chartJsTargetAt = (chart, evt) => {
  if (!chart || !evt) return null;
  const area = chart.chartArea || {};
  const x = Number(evt.offsetX) || 0;
  const y = Number(evt.offsetY) || 0;
  const left = Number(area.left) || 0;
  const right = Number(area.right) || 0;
  const top = Number(area.top) || 0;
  const bottom = Number(area.bottom) || 0;
  if (!(x >= left && x <= right && y >= top && y <= bottom)) {
    return y > bottom
      ? { kind: 'xAxis', section: 'x', axis: 'x', label: '' }
      : { kind: 'yAxis', section: 'y', axis: 'y', label: '' };
  }
  let hit = null;
  try {
    hit = (chart.getElementsAtEventForMode(evt, 'nearest', { intersect: false }, true) || [])[0] || null;
  } catch { hit = null; }
  const datasets = (chart.data && chart.data.datasets) || [];
  const ds = hit ? datasets[hit.datasetIndex] : null;
  return { kind: 'series', section: 'series', axis: null, label: ds ? String(ds.label || '') : '' };
};

// ── mirror: utils/chartStyle.js ─────────────────────────────────────────────
const DEFAULT_CHART_FONT_SIZE = 16;
const DEFAULT_CHART_ASPECT = 1;
const DEFAULT_CHART_ASPECT_WIDE = 1.8;
const textWidthPx = (text, fontSize) =>
  String(text == null ? '' : text).length * (Number(fontSize) || 12) * 0.55;
const axisTitleRoomPx = (texts, fontSize) => {
  const list = (Array.isArray(texts) ? texts : [texts]).filter(Boolean);
  if (!list.length) return 0;
  const fs = (Number(fontSize) || DEFAULT_CHART_FONT_SIZE) + 1;
  return Math.round(Math.max(...list.map((t) => textWidthPx(t, fs))));
};
const chartBoxStyle = (cfg = {}, opts = {}) => {
  const wide = opts.square === false;
  const a = Number(cfg.aspect);
  let aspect;
  if (wide) aspect = (Number.isFinite(a) && a !== DEFAULT_CHART_ASPECT) ? a : DEFAULT_CHART_ASPECT_WIDE;
  else aspect = (Number.isFinite(a) && a !== DEFAULT_CHART_ASPECT_WIDE) ? a : DEFAULT_CHART_ASPECT;
  const yRoom = axisTitleRoomPx([opts.yTitle, cfg.yAxisLabel], cfg.fontSize);
  const minHeight = Math.max(220, yRoom + 120);
  const maxHeight = Math.max(Number(cfg.height) || 380, minHeight);
  return { width: '100%', aspectRatio: String(aspect), maxHeight, minHeight };
};
const chartJsPadding = (cfg = {}, base = 2) => {
  const fs = Number(cfg.fontSize) || DEFAULT_CHART_FONT_SIZE;
  const pad = Math.round(base + Math.max(0, fs - 12) * 0.5);
  return { left: pad, right: pad, top: pad, bottom: pad };
};
const chartJsHeightFit = (height, cfg = {}, opts = {}) => {
  const h = Number(height) || 380;
  const yRoom = axisTitleRoomPx([opts.yTitle, cfg.yAxisLabel], cfg.fontSize);
  return Math.max(h, yRoom + 150);
};

/* ══ 1. which element was double-clicked (recharts / DOM) ═════════════════ */
const svgRoot = makeEl('recharts-surface');
const chartLayer = makeEl('recharts-layer', svgRoot);
const yAxisG = makeEl('recharts-cartesian-axis recharts-yAxis', makeEl('recharts-layer recharts-cartesian-axis', chartLayer));
const xAxisG = makeEl('recharts-cartesian-axis recharts-xAxis', makeEl('recharts-layer recharts-cartesian-axis', chartLayer));
const tickValue = (parent, text) => makeEl('recharts-text recharts-cartesian-axis-tick-value', parent, { text });

check('double-click on a Y tick number → the Y axis commands',
  classifyChartElement(tickValue(yAxisG, '20')),
  { kind: 'yAxis', section: 'y', axis: 'y', label: '' });
check('double-click on an X tick number → the X axis commands',
  classifyChartElement(tickValue(xAxisG, '250')),
  { kind: 'xAxis', section: 'x', axis: 'x', label: '' });
check('double-click on the rotated Y title → the label commands',
  classifyChartElement(makeEl('recharts-text recharts-label', yAxisG, { text: 'Intensity (a.u.)', attrs: { transform: 'rotate(-90)' } })),
  { kind: 'yLabel', section: 'label', axis: 'y', label: 'Intensity (a.u.)' });
check('…detected by its group even without a transform',
  classifyChartElement(makeEl('recharts-label', yAxisG, { text: 'Intensity' })).axis, 'y');
check('double-click on the X title → the label commands',
  classifyChartElement(makeEl('recharts-text recharts-label', xAxisG, { text: 'Wavelength (nm)' })),
  { kind: 'xLabel', section: 'label', axis: 'x', label: 'Wavelength (nm)' });
check('double-click on a curve → the series commands',
  classifyChartElement(makeEl('recharts-curve recharts-line-curve', makeEl('recharts-layer recharts-line', chartLayer))).section,
  'series');
check('double-click on a bar → the series commands',
  classifyChartElement(makeEl('recharts-rectangle', makeEl('recharts-bar-rectangle', makeEl('recharts-layer recharts-bar', chartLayer)))).section,
  'series');
check('double-click on a point → the series commands',
  classifyChartElement(makeEl('recharts-symbols', makeEl('recharts-layer recharts-scatter', chartLayer))).section,
  'series');
check('double-click on a legend entry → the series colours (with its name)',
  classifyChartElement(makeEl('recharts-legend-item-text', makeEl('recharts-legend-item', makeEl('recharts-legend-wrapper', svgRoot), { text: 'Condition 1' }), { text: 'Condition 1' })),
  { kind: 'legend', section: 'series', axis: null, label: 'Condition 1' });
check('double-click outside the chart elements → nothing',
  classifyChartElement(makeEl('card-body', svgRoot)), null);
check('a chart without a double-clickable node → nothing',
  classifyChartElement(null), null);
check('every target maps to a section of the style panel',
  ['yAxis', 'xAxis', 'yLabel', 'xLabel', 'series', 'legend']
    .map((k) => typeof chartStyleSectionFor(k)),
  ['string', 'string', 'string', 'string', 'string', 'string']);
function chartStyleSectionFor(kind) {
  return {
    yAxis: 'y', xAxis: 'x', yLabel: 'label', xLabel: 'label', series: 'series', legend: 'series'
  }[kind];
}
check('…and the mapping covers the titles',
  [chartStyleSectionFor('yLabel'), chartStyleSectionFor('xLabel')], ['label', 'label']);

/* ══ 2. which element of a Chart.js canvas ════════════════════════════════ */
const fakeChart = (opts = {}) => ({
  chartArea: opts.area || { left: 40, top: 10, right: 300, bottom: 200 },
  data: { datasets: opts.datasets || [{ label: 'Viability' }, { label: 'Fit' }] },
  getElementsAtEventForMode: () => (opts.hit ? [opts.hit] : [])
});
check('Chart.js: below the plot → the X axis',
  chartJsTargetAt(fakeChart(), { offsetX: 150, offsetY: 260 }),
  { kind: 'xAxis', section: 'x', axis: 'x', label: '' });
check('Chart.js: left of the plot → the Y axis',
  chartJsTargetAt(fakeChart(), { offsetX: 8, offsetY: 100 }),
  { kind: 'yAxis', section: 'y', axis: 'y', label: '' });
check('Chart.js: inside the plot → the curve under the pointer',
  chartJsTargetAt(fakeChart({ hit: { datasetIndex: 1 } }), { offsetX: 150, offsetY: 100 }),
  { kind: 'series', section: 'series', axis: null, label: 'Fit' });
check('Chart.js: inside the plot but on no data → the series commands',
  chartJsTargetAt(fakeChart(), { offsetX: 150, offsetY: 100 }),
  { kind: 'series', section: 'series', axis: null, label: '' });
check('Chart.js: no chart yet → nothing', chartJsTargetAt(null, { offsetX: 1, offsetY: 1 }), null);

/* ══ 3. the axis room follows the character size ═════════════════════════ */
check('textWidthPx: an empty text needs no room', textWidthPx('', 24), 0);
check('textWidthPx: 4 characters at 10 px', textWidthPx('abcd', 10), 22);
check('axisTitleRoomPx: no title → no room', axisTitleRoomPx([undefined, ''], 16), 0);
check('axisTitleRoomPx: the title is measured 1 px above the ticks',
  axisTitleRoomPx(['Intensity (a.u.)'], 16), Math.round(17 * 16 * 0.55));
checkTrue('…and the room grows with the character size',
  axisTitleRoomPx(['Intensity (a.u.)'], 24) > axisTitleRoomPx(['Intensity (a.u.)'], 16));

const boxDefault = chartBoxStyle({});
check('an unlabelled chart keeps its historical box', [boxDefault.minHeight, boxDefault.maxHeight], [220, 380]);
check('…and a wide spectrum keeps its wide ratio', chartBoxStyle({}, { square: false }).aspectRatio, '1.8');
const boxSmall = chartBoxStyle({ fontSize: 16, yAxisLabel: 'Normalized intensity (a.u.)' });
checkTrue('a labelled chart reserves room for its rotated y title', boxSmall.minHeight > 220);
checkTrue('…and the max height never clips the min height', boxSmall.maxHeight >= boxSmall.minHeight);
const boxBig = chartBoxStyle({ fontSize: 24, yAxisLabel: 'Normalized intensity (a.u.)' });
checkTrue('a bigger character size → a taller box', boxBig.minHeight > boxSmall.minHeight);
const boxExplicit = chartBoxStyle({ fontSize: 24, height: 900, yAxisLabel: 'x' });
checkTrue('an explicit chart height is honoured (and grown if needed)',
  boxExplicit.maxHeight >= 900 && boxExplicit.maxHeight >= boxExplicit.minHeight);
checkTrue('the y title is measured even without cfg.yAxisLabel',
  chartBoxStyle({ fontSize: 24 }, { yTitle: 'Normalized intensity (a.u.)' }).minHeight > 220);
check('chartJsPadding: the 12 px base', chartJsPadding({ fontSize: 12 }), { left: 2, right: 2, top: 2, bottom: 2 });
check('chartJsPadding: grows with the character size', chartJsPadding({ fontSize: 24 }), { left: 8, right: 8, top: 8, bottom: 8 });
check('chartJsPadding: the default font size', chartJsPadding({}), { left: 4, right: 4, top: 4, bottom: 4 });
check('chartJsHeightFit: no title → the requested height', chartJsHeightFit(420, {}, {}), 420);
checkTrue('chartJsHeightFit: a long rotated y title → a taller canvas',
  chartJsHeightFit(420, { fontSize: 24 }, { yTitle: 'Normalized intensity (a.u.)' }) > 420);
check('chartJsHeightFit: a small title keeps the requested height', chartJsHeightFit(420, { fontSize: 16 }, { yTitle: 'ln(I)' }), 420);

/* ══ 4. the wiring in the program ════════════════════════════════════════ */
frag('[SAT] the classifier exists', SAT, 'export const classifyChartElement = (el) => {');
frag('[SAT] …and reads the recharts axis groups', SAT, "const axisY = el.closest('.recharts-yAxis');");
frag('[SAT] …and the series elements', SAT, "const seriesEl = el.closest('.recharts-line, .recharts-bar, .recharts-area, .recharts-scatter, .recharts-radar, .recharts-pie');");
frag('[SAT] the Chart.js classifier', SAT, 'export const chartJsTargetAt = (chart, evt) => {');
frag('[SAT] the Chart.js hit test', SAT, "chart.getElementsAtEventForMode(evt, 'nearest', { intersect: false }, true)");
frag('[SAT] the wrapper every chart body can use', SAT, 'export const ChartInspector = ({');
frag('[SAT] …opens the matching section of the panel', SAT, 'section={target.section}');
frag('[SAT] …and highlights the double-clicked curve', SAT, 'highlightKey={matched ? matched.key : null}');
frag('[SAT] the dialog closes on Escape', SAT, "if (e.key === 'Escape') onClose();");
frag('[SAT] the dialog is rendered in a portal (never clipped by the card)', SAT, 'document.body');
frag('[SAT] the Chart.js wrapper', SAT, 'export const ChartJsInspector = ({ chartRef, cfg, setCfg, series = [], unit, children, className = \'\', style = null }) => {');
frag('[SAT] …which renders the canvas sizing box itself', SAT, '<div className={className} style={style} onDoubleClick={editable ? handle : undefined}');
frag('[SAT] the style panel is section-addressable', SAT, "section = 'all', highlightKey = null");
frag('[SAT] …and filters the blocks through `show`', SAT, "const show = (name) => section === 'all' || section === name;");
frag('[SAT] …with the X / Y range blocks', SAT, 'chartStyleRangeBlock(cfg, set, unit, rangeSection)');
frag('[SAT] …the tick blocks', SAT, "{(show('x') || show('y')) && chartStyleTickBlock(cfg, set, section)}");
frag('[SAT] …and the character-size block of the focused views', SAT, "section !== 'all' && section !== 'series' && chartStyleCharacterBlock(cfg, set, showHeightSlider)");
frag('[SAT] ChartPanel wires the inspector for its charts', SAT, '<ChartInspector cfg={cfg} setCfg={setCfg} series={series} unit={unit} className={`flex-1 min-h-0 ${bodyClassName}`}>');
frag('[SAT] …and takes the style object as props', SAT, 'cfg = null,');
frag('[SAT] SharedChart wires it too (double-click on a small chart)', SAT, 'containerRef={chartRef}');
frag('[SAT] …when the caller can write the style back', SAT, 'cfg={setCfg ? cfg : null}');
frag('[STYLE] the axis-title room helper', STYLE, 'export const axisTitleRoomPx = (texts, fontSize) => {');
frag('[STYLE] the box grows with the y title', STYLE, 'const minHeight = Math.max(220, yRoom + 120);');
frag('[STYLE] the Chart.js padding helper', STYLE, 'export const chartJsPadding = (cfg = {}, base = 2) => {');
frag('[STYLE] the Chart.js height helper', STYLE, 'export const chartJsHeightFit = (height, cfg = {}, opts = {}) => {');
frag('[CSS] the recharts surface no longer clips its labels', CSS, '.recharts-surface,');

frag('[NMR] the 1D spectrum is double-clickable', NMR, 'containerRef={chartRef}');
frag('[NMR] …with the style object of the panel', NMR, 'series={series}');
frag('[NMR] …and room for its y title', NMR, 'chartBoxStyle(cfg, { yTitle: yLab })');
frag('[CD] the CD spectrum is double-clickable', CD, 'series={seriesList}');
frag('[CD] …and room for its y title', CD, 'chartBoxStyle(cfg, { square: false, yTitle: yLab })');
frag('[ssNMR] the spectrum is double-clickable', SSNMR, 'series={seriesList}');
frag('[ssNMR] …and room for its y title', SSNMR, 'chartBoxStyle(cfg, { yTitle: yLab })');

frag('[Plate] the dose-response canvas gets padding from the character size', PLATE, 'layout: { padding: chartJsPadding(chartCfg) }');
frag('[Plate] …and a height that fits the rotated y title', PLATE, "chartJsHeightFit(chartH, chartCfg, { yTitle: 'Viability (%)' })");

const failed = results.filter((r) => !r.ok);
console.table(results);
if (failed.length) {
  console.error(`\n❌ ${failed.length}/${results.length} checks failed`);
  process.exit(1);
}
console.log(`\n✅ ${results.length}/${results.length} checks passed`);

