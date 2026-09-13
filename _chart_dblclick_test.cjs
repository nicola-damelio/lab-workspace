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
const FIGURE_ASPECT_KEY = 'figureAspect';
const textWidthPx = (text, fontSize) =>
  String(text == null ? '' : text).length * (Number(fontSize) || 12) * 0.55;
const axisTitleRoomPx = (texts, fontSize) => {
  const list = (Array.isArray(texts) ? texts : [texts]).filter(Boolean);
  if (!list.length) return 0;
  const fs = (Number(fontSize) || DEFAULT_CHART_FONT_SIZE) + 1;
  return Math.round(Math.max(...list.map((t) => textWidthPx(t, fs))));
};
const figureAspectOf = (cfg) => {
  const n = Number(cfg && cfg[FIGURE_ASPECT_KEY]);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
// The shape is a DELIBERATE choice only when the profile imposes a ratio or when
// the panel shows one that is not a historical default — only then may the box
// height (which cancels `aspect-ratio` in the browser) be dropped.
const chartAspectImposed = (cfg = {}) => {
  if (figureAspectOf(cfg) > 0) return true;
  const own = Number(cfg.aspect);
  return Number.isFinite(own) && own > 0 && own !== DEFAULT_CHART_ASPECT && own !== DEFAULT_CHART_ASPECT_WIDE;
};
const chartBoxStyle = (cfg = {}, opts = {}) => {
  const wide = opts.square === false;
  const forced = figureAspectOf(cfg);
  const a = Number(cfg.aspect);
  let aspect;
  if (forced) aspect = forced;
  else if (wide) aspect = (Number.isFinite(a) && a !== DEFAULT_CHART_ASPECT) ? a : DEFAULT_CHART_ASPECT_WIDE;
  else aspect = (Number.isFinite(a) && a !== DEFAULT_CHART_ASPECT_WIDE) ? a : DEFAULT_CHART_ASPECT;
  const yRoom = axisTitleRoomPx([opts.yTitle, cfg.yAxisLabel], cfg.fontSize);
  const minHeight = Math.max(220, yRoom + 120);
  const maxHeight = Math.max(Number(cfg.height) || 380, minHeight);
  const out = { width: '100%', aspectRatio: String(aspect) };
  if (!chartAspectImposed(cfg)) out.maxHeight = maxHeight;
  out.minHeight = minHeight;
  return out;
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
checkTrue('…and a wide spectrum keeps its wide ratio', chartBoxStyle({}, { square: false }).aspectRatio === '1.8');
// A definite height cap CANCELS `aspect-ratio` in the browser: the shape the
// profile imposes (Settings → Figure style) must not be clamped away by
// "Chart height (px)" — that is what made the ratio look ignored.
checkTrue('an imposed ratio drops the height cap',
  !('maxHeight' in chartBoxStyle({ figureAspect: 1, height: 380, fontSize: 16 })));
checkTrue('…a ratio typed in the panel drops it too',
  !('maxHeight' in chartBoxStyle({ aspect: 2.5, height: 380, fontSize: 16 })));
checkTrue('…a chart nobody reshaped keeps its historical cap',
  chartBoxStyle({ height: 380, fontSize: 16 }).maxHeight === 380);
checkTrue('…and the ratio of the profile still reaches the box',
  chartBoxStyle({ figureAspect: 2, height: 380, fontSize: 16 }).aspectRatio === '2');
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
frag('[SAT] the Chart.js wrapper', SAT, "export const ChartJsInspector = ({ chartRef, cfg, setCfg, series = [], unit, children, className = '', style = null, figureKind = null }) => {");
frag('[SAT] …which renders the canvas sizing box itself', SAT, '<div className={className} style={style} onDoubleClick={editable ? handle : undefined}');
frag('[SAT] the style panel is section-addressable', SAT, "section = 'all', highlightKey = null");
frag('[SAT] …and filters the blocks through `show`', SAT, "const show = (name) => section === 'all' || section === name;");
frag('[SAT] …with the X / Y range blocks', SAT, 'chartStyleRangeBlock(cfg, set, unit, rangeSection)');
frag('[SAT] …the tick blocks', SAT, "{(show('x') || show('y')) && chartStyleTickBlock(cfg, set, section)}");
frag('[SAT] …and the character-size block of the focused views', SAT, "section !== 'all' && section !== 'series' && chartStyleCharacterBlock(cfg, set, showHeightSlider)");
frag('[SAT] ChartPanel wires the inspector for its charts', SAT, '<ChartInspector cfg={cfg} setCfg={setCfg} series={series} unit={unit} figureKind={figureKind} className={`flex-1 min-h-0 ${bodyClassName}`}>');
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

/* ══ 5. a double-click ANYWHERE in the chart is never lost ════════════════
   recharts only marks the curves, the axes and the legend, so the plot
   background / a grid line / the surface used to swallow the gesture ("it is
   very difficult to click on the good position"). chartElementAtPoint() looks
   at WHERE the pointer landed and opens the matching settings instead.
   ──────────────────────────────────────────────────────────────────────── */
const chartElementAtPoint = (root, evt) => {
  if (!root || !evt || typeof root.querySelector !== 'function') return null;
  const wrapper = root.closest && root.closest('.recharts-wrapper')
    ? root.closest('.recharts-wrapper')
    : root.querySelector('.recharts-wrapper');
  if (!wrapper || typeof wrapper.getBoundingClientRect !== 'function') return null;
  const box = wrapper.getBoundingClientRect();
  const cx = Number(evt.clientX);
  const cy = Number(evt.clientY);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  const rectOf = (sel) => {
    const n = wrapper.querySelector(sel);
    return n && typeof n.getBoundingClientRect === 'function' ? n.getBoundingClientRect() : null;
  };
  const grid = rectOf('.recharts-cartesian-grid');
  const yAxis = rectOf('.recharts-yAxis');
  const xAxis = rectOf('.recharts-xAxis');
  const left = yAxis ? yAxis.right - box.left : grid ? grid.left - box.left : 0;
  const bottom = xAxis ? xAxis.top - box.top : grid ? grid.bottom - box.top : box.height;
  const px = cx - box.left;
  const py = cy - box.top;
  if (py > bottom) {
    return py > bottom + 26
      ? { kind: 'xLabel', section: 'label', axis: 'x', label: '' }
      : { kind: 'xAxis', section: 'x', axis: 'x', label: '' };
  }
  if (px < left) {
    return px < left - 26
      ? { kind: 'yLabel', section: 'label', axis: 'y', label: '' }
      : { kind: 'yAxis', section: 'y', axis: 'y', label: '' };
  }
  return { kind: 'plot', section: 'all', axis: null, label: '' };
};

// A chart box at (100,50) 400×300; the Y axis band ends at x = 160, the X axis
// band starts at y = 250.
const RECTS = {
  '.recharts-cartesian-grid': { left: 160, top: 50, right: 500, bottom: 250 },
  '.recharts-yAxis': { left: 100, top: 50, right: 160, bottom: 250 },
  '.recharts-xAxis': { left: 160, top: 250, right: 500, bottom: 290 }
};
const wrapperAt = (rects = RECTS, box = { left: 100, top: 50, width: 400, height: 300 }) => ({
  getBoundingClientRect: () => box,
  querySelector: (sel) => (rects[sel] ? { getBoundingClientRect: () => rects[sel] } : null)
});
const rootWith = (wrapper) => ({ querySelector: (sel) => (sel === '.recharts-wrapper' ? wrapper : null) });
const at = (x, y, rects, box) => chartElementAtPoint(rootWith(wrapperAt(rects, box)), { clientX: x, clientY: y });

check('double-click ON the plot background → the whole panel', at(300, 150), { kind: 'plot', section: 'all', axis: null, label: '' });
check('double-click on the Y numbers → the Y axis commands', at(140, 150).section, 'y');
check('double-click further left (the Y title) → the label commands', at(120, 150).kind, 'yLabel');
check('double-click under the plot → the X axis commands', at(300, 265).section, 'x');
check('double-click below the X title → the label commands', at(300, 300).kind, 'xLabel');
check('a container without a recharts chart → nothing', chartElementAtPoint({ querySelector: () => null }, { clientX: 1, clientY: 1 }), null);
check('a double-click without coordinates → nothing', at(NaN, NaN), null);
frag('[SAT] the geometric fallback exists', SAT, 'export const chartElementAtPoint = (root, evt) => {');
frag('[SAT] …and every wrapper uses it when no element matched', SAT, 'classifyChartElement(e.target) || chartElementAtPoint(e.currentTarget, e)');
frag('[SAT] the plot target has its own title', SAT, "plot: 'Chart — every setting (axes, ticks, log, interrupt, curves)'");

/* ══ 6. the axis commands a double-click must reach ═══════════════════════ */
frag('[SAT] an axis TITLE also shows the ticks / decimals / log scale', SAT, "{section === 'label' && chartStyleTickBlock(cfg, set, 'label')}");
frag('[SAT] the ✂ interrupted axis is a panel command', SAT, 'Interrupt Y axis — huge bar vs small bars');
frag('[SAT] …and it is drawn on the axis', SAT, 'export const AxisBreakMarks = ({ cfg = {}, axis = \'y\', values = [], brk = null }) => {');
frag('[SAT] any recharts chart can ask for it in three lines', SAT, 'export const brokenAxisProps = (cfg = {}, axis = \'y\', values = [], opts = {}) => {');
frag('[STYLE] the interrupted scale of recharts', STYLE, 'export const brokenScale = (brk) => {');
frag('[STYLE] …and of the Chart.js canvases', STYLE, "export const chartJsBrokenAxisOptions = (cfg = {}, axis = 'y', values = []) => {");
frag('[STYLE] …which takes the automatic break from those values', STYLE, 'const brk = axisBreakFor(cfg, axis, values);');

/* ══ 7. the charts that forgot to wire the inspector ═════════════════════ */
const FCS = read('src/components/FlowCytometrySections.jsx');
const DOCK = read('src/components/DockingSections.jsx');
const MD = read('src/components/MDSections.jsx');
frag('[SAT] a 🎨 panel makes its ChartPanel body editable on its own', SAT, 'const panelStyle = stylePanelCfg(cfgPanel);');
for (const [name, src] of [['[FCS] the histograms are editable', FCS], ['[Dock] the docking charts are editable', DOCK], ['[MD] the trajectory charts are editable', MD], ['[NMR] the per-atom chart is editable', NMR], ['[ssNMR] the small spectra are editable', SSNMR], ['[CD] the small spectra are editable', CD]]) {
  frag(`${name} (ChartInspector)`, src, '<ChartInspector');
}
frag('[Plate] a small canvas is no longer pointer-events-none', PLATE, 'onClick={!isFs ? clickCard : undefined}');
frag('[Plate] …so the double-click reaches it', SAT, 'export const useDeferredClick = (onClick, delay = 260) => {');

const failed = results.filter((r) => !r.ok);
console.table(results);
if (failed.length) {
  console.error(`\n❌ ${failed.length}/${results.length} checks failed`);
  process.exit(1);
}
console.log(`\n✅ ${results.length}/${results.length} checks passed`);

