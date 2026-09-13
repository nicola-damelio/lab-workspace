/* =========================================================================
   _curve_style_test.mjs — per-curve styling, chart types and the manual
   axis-title shift of src/utils/chartStyle.js.

   These helpers are the engine of the "the style is applied to all curves"
   fix: the double-click panel writes cfg.seriesStyles[key] and every chart
   family reads it back through these functions. The test imports the REAL
   module (it is plain JS, no JSX), so a change of behaviour fails here.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeChartType, seriesStyleOf, seriesOverride, seriesChartType,
  seriesPointStyle, seriesPtSize, seriesLineStyle, seriesLineThickness,
  seriesDash, seriesVisible, seriesLabelOf, seriesColorOf, hasSeriesOverrides,
  chartJsSeriesStyle, chartJsPadding, chartJsHeightFit, chartJsTitlePad,
  cfgAxisGap, rainbowColors,
  axisBreakOf, breakSegments, breakTicks, brokenScale, chartJsBrokenAxisOptions
} from './src/utils/chartStyle.js';

const results = [];
const check = (name, fn) => {
  try { fn(); results.push({ name, ok: true, got: '' }); }
  catch (e) { results.push({ name, ok: false, got: e.message }); }
};
const eq = (a, b, msg) => assert.deepEqual(a, b, msg || `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

/* ══ 1. ONE chart-type vocabulary ═════════════════════════════════════════ */
check('1 "hist" (page select) means bar', () => eq(normalizeChartType('hist'), 'bar'));
check('2 "histogram" (plate select) means bar', () => eq(normalizeChartType('histogram'), 'bar'));
check('3 "bar" (panel select) stays bar', () => eq(normalizeChartType('bar'), 'bar'));
check('4 "Bars" / case differences are accepted', () => eq(normalizeChartType(' Bars '), 'bar'));
check('5 "dose-response" means line', () => eq(normalizeChartType('dose-response'), 'line'));
check('6 line / scatter / area are canonical', () => {
  eq(normalizeChartType('line'), 'line');
  eq(normalizeChartType('scatter'), 'scatter');
  eq(normalizeChartType('area'), 'area');
});
check('7 an unknown / empty type falls back to line', () => {
  eq(normalizeChartType(''), 'line');
  eq(normalizeChartType(undefined), 'line');
  eq(normalizeChartType(null, 'bar'), 'bar');
});

/* ══ 2. per-curve overrides inherit the chart-wide commands ══════════════ */
const cfg = {
  fontSize: 16, ptStyle: 'circle', ptSize: 5, lineStyle: 'solid', lineThickness: 2,
  chartType: 'line',
  seriesStyles: {
    b: { pointStyle: 'square', ptSize: 9, lineStyle: 'dashed', lineThickness: 4, color: '#ff0000', hidden: true },
    c: { chartType: 'bar' }
  }
};
check('8 a curve without an entry inherits the chart-wide symbol', () => eq(seriesPointStyle(cfg, 'a'), 'circle'));
check('9 …and curve b uses its OWN symbol', () => eq(seriesPointStyle(cfg, 'b'), 'square'));
check('10 the symbol size is per curve', () => {
  eq(seriesPtSize(cfg, 'b', 4), 9);
  eq(seriesPtSize(cfg, 'a', 4), 5);
});
check('11 the line style is per curve', () => {
  eq(seriesLineStyle(cfg, 'b'), 'dashed');
  eq(seriesLineStyle(cfg, 'a'), 'solid');
});
check('12 the line width is per curve', () => {
  eq(seriesLineThickness(cfg, 'b'), 4);
  eq(seriesLineThickness(cfg, 'a'), 2);
});
check('13 a dashed curve gets a dash pattern, a solid one none', () => {
  eq(seriesDash(cfg, 'b'), '4 4');
  eq(seriesDash(cfg, 'a'), undefined);
});
check('14 show / hide is per curve', () => {
  eq(seriesVisible(cfg, 'b'), false);
  eq(seriesVisible(cfg, 'a'), true);
});
check('15 the curve type is per curve (c = bar) and falls back to the chart type', () => {
  eq(seriesChartType(cfg, 'c'), 'bar');
  eq(seriesChartType(cfg, 'a'), 'line');
  eq(seriesChartType({ chartType: 'histogram' }, 'a'), 'bar');
});
check('16 the colour is per curve over the auto palette', () => {
  eq(seriesColorOf(cfg, 'b', 1, 2), '#ff0000');
  eq(seriesColorOf(cfg, 'a', 0, 2), rainbowColors(2)[0]);
});
check('17 the legend label can be overridden per curve', () => {
  eq(seriesLabelOf({ seriesStyles: { a: { label: 'Sample 1' } } }, 'a', 'fallback'), 'Sample 1');
  eq(seriesLabelOf(cfg, 'a', 'fallback'), 'fallback');
});
check('18 an empty / absent override map is "no override"', () => {
  eq(hasSeriesOverrides({}), false);
  eq(hasSeriesOverrides({ seriesStyles: {} }), false);
  eq(hasSeriesOverrides({ seriesStyles: { a: {} } }), false);
  eq(hasSeriesOverrides(cfg), true);
});
check('19 seriesStyleOf never throws on a missing key', () => {
  eq(seriesStyleOf(null, 'a'), {});
  eq(seriesStyleOf(cfg, null), {});
  eq(seriesOverride(cfg, 'a', 'pointStyle'), undefined);
});

/* ══ 3. the Chart.js dataset patch ═══════════════════════════════════════ */
check('20 the patch carries every per-curve override', () => {
  const patch = chartJsSeriesStyle(cfg, 'b', { color: '#0000ff', pointStyle: 'circle', pointRadius: 5, borderWidth: 2 });
  eq(patch.pointStyle, 'square');
  eq(patch.pointRadius, 9);
  eq(patch.borderDash, [6, 4]);
  eq(patch.borderWidth, 4);
  eq(patch.borderColor, '#ff0000');
  eq(patch.hidden, true);
});
check('21 a curve without overrides gets an EMPTY patch (datasets unchanged)', () => {
  eq(chartJsSeriesStyle(cfg, 'a', { color: '#0000ff', pointStyle: 'circle', pointRadius: 5 }), {});
  eq(chartJsSeriesStyle({}, 'a', { color: '#0000ff' }), {});
});
check('21b "symbol: none" means radius 0 (Chart.js has no "none" style)', () => {
  const patch = chartJsSeriesStyle({ seriesStyles: { a: { pointStyle: 'none' } } }, 'a', { color: '#0000ff', pointRadius: 5 });
  eq(patch.pointRadius, 0);
  eq(patch.pointStyle, undefined);
});
check('22 the overrides survive the JSON round-trip of the saved test', () => {
  const round = JSON.parse(JSON.stringify(cfg.seriesStyles));
  eq(seriesPointStyle({ seriesStyles: round }, 'b'), 'square');
  eq(seriesPtSize({ seriesStyles: round }, 'b', 4), 9);
});

/* ══ 4. the MANUAL axis-title shift (X / Y label gap) ════════════════════ */
check('23 the gap reader clamps junk to 0', () => {
  eq(cfgAxisGap({}, 'y'), 0);
  eq(cfgAxisGap({ yAxisLabelGap: '' }, 'y'), 0);
  eq(cfgAxisGap({ yAxisLabelGap: 'abc' }, 'y'), 0);
  eq(cfgAxisGap({ yAxisLabelGap: '-12' }, 'y'), -12);
});
check('24 a positive Y gap widens the LEFT canvas padding (title room)', () => {
  const a = chartJsPadding({ fontSize: 16 });
  const b = chartJsPadding({ fontSize: 16, yAxisLabelGap: 30 });
  eq(b.left - a.left, 30);
  eq(b.bottom, a.bottom);
});
check('25 a positive X gap widens the BOTTOM canvas padding', () => {
  const a = chartJsPadding({ fontSize: 16 });
  const b = chartJsPadding({ fontSize: 16, xAxisLabelGap: 10 });
  eq(b.bottom - a.bottom, 10);
  eq(b.left, a.left);
});
check('26 a negative gap never shrinks the canvas below the base padding', () => {
  eq(chartJsPadding({ fontSize: 16, yAxisLabelGap: -50 }).left, chartJsPadding({ fontSize: 16 }).left);
});
check('27 the scale title padding is the shift (never negative)', () => {
  eq(chartJsTitlePad({ yAxisLabelGap: 24, xAxisLabelGap: -8 }), { x: 0, y: 24 });
  eq(chartJsTitlePad({}), { x: 0, y: 0 });
});
check('28 the height follows the rotated title AND the shift', () => {
  // A short canvas is grown by the rotated title room, and the manual shift
  // adds exactly its own px on top of that room.
  const base = chartJsHeightFit(100, { fontSize: 16 }, { yTitle: 'Intensity (a.u.)' });
  const shifted = chartJsHeightFit(100, { fontSize: 16, yAxisLabelGap: 40 }, { yTitle: 'Intensity (a.u.)' });
  eq(shifted - base, 40);
  assert.ok(base >= 100);
  // A canvas the caller already made tall enough is left alone.
  eq(chartJsHeightFit(900, { fontSize: 16 }, { yTitle: 'x' }), 900);
});

/* ══ 5. the panel writes what the helpers read ═══════════════════════════ */
const SAT = readFileSync('./src/components/SharedAnalysisTools.jsx', 'utf8');
const PANEL = SAT.slice(SAT.indexOf('export const chartStyleSeriesBlock'), SAT.indexOf('export const SharedChartStylePanel'));
check('29 the panel has a per-curve block', () => {
  assert.ok(SAT.includes('export const chartStyleSeriesBlock = (cfg, set, series = [], highlightKey = null) => {'));
  assert.ok(SAT.includes('Per-curve settings — one style for each curve'));
});
check('30 …rendered by the panel for the series / full view', () => {
  assert.ok(SAT.includes("show('series') && chartStyleSeriesBlock(cfg, set, series, highlightKey)"));
});
check('31 …writing cfg.seriesStyles[key]', () => {
  assert.ok(PANEL.includes('const next = { ...(all[key] || {}), ...patch };'));
  assert.ok(PANEL.includes('set({ seriesStyles: map });'));
  assert.ok(PANEL.includes('if (Object.keys(next).length) map[key] = next; else delete map[key];'));
});
check('32 every per-curve control exists (type, symbol, size, line, width, show)', () => {
  for (const s of [
    'title="Type of THIS curve"', 'title="Symbol of THIS curve"', 'title="Line style of THIS curve"',
    'placeholder="size"', 'placeholder="width"', 'write(s.key, { hidden: !e.target.checked })'
  ]) assert.ok(PANEL.includes(s), `missing ${s}`);
});
check('33 the chart type select shows the NORMALISED value', () => {
  assert.ok(SAT.includes('<SF label="Chart type" value={normalizeChartType(cfg.chartType)}'));
});
check('34 the recharts symbols are real shapes, not always a circle', () => {
  assert.ok(SAT.includes("export const ChartDot = ({ cx, cy, r, fill, stroke, symbol = 'circle'"));
  for (const shape of ['square', 'triangle', 'cross', 'diamond', 'star']) {
    assert.ok(SAT.includes(`k === '${shape}'`), `missing the ${shape} symbol`);
  }
});
check('35 cfgSeriesEl honours the per-curve type / colour / dash / hidden', () => {
  assert.ok(SAT.includes('if (!seriesVisible(cfg, key)) return null;'));
  assert.ok(SAT.includes("const type = seriesChartType(cfg, key, cfg.chartType || 'line');"));
  assert.ok(SAT.includes("seriesOverride(cfg, key, 'color') || opts.stroke"));
});
check('36 SharedChart drops hidden curves and switches to ComposedChart', () => {
  assert.ok(SAT.includes('safeSeries.filter((s) => seriesVisible(cfg, s.key))'));
  assert.ok(SAT.includes('<ComposedChart data={plotData} margin={resolvedMargin}>{children}</ComposedChart>'));
});
check('37 the per-curve block drives every Chart.js renderer', () => {
  for (const f of ['PlateSections', 'DOSYTestRenderer', 'NMRFittingsTestRenderer']) {
    const s = readFileSync(`./src/components/${f}.jsx`, 'utf8');
    assert.ok(s.includes('chartJsSeriesStyle('), `${f} does not apply the per-curve dataset patch`);
  }
});
check('38 the Chart.js plots apply the manual title shift + room', () => {
  for (const f of ['PlateSections', 'DOSYTestRenderer', 'NMRFittingsTestRenderer']) {
    const s = readFileSync(`./src/components/${f}.jsx`, 'utf8');
    assert.ok(s.includes('chartJsTitlePad('), `${f} does not shift the axis title`);
    assert.ok(s.includes('chartJsPadding('), `${f} does not reserve the canvas padding`);
  }
});
check('39 the NMR fittings histogram follows the panel chart type', () => {
  const s = readFileSync('./src/components/NMRFittingsTestRenderer.jsx', 'utf8');
  assert.ok(s.includes('const effType = normalizeChartType(chartCfg.chartType || chartType);'));
  assert.ok(s.includes("const isHist = effType === 'bar';"));
});
check('40 the plate histogram is no longer undone by the panel "bar"', () => {
  const s = readFileSync('./src/components/PlateSections.jsx', 'utf8');
  assert.ok(s.includes("const isHistogram = normalizeChartType(chartType) === 'bar';"));
  assert.ok(s.includes("? 'histogram' : 'dose-response'"));
});
check('41 the builder crop is available without a drag (numeric window)', () => {
  const s = readFileSync('./src/components/ImageBuilder.jsx', 'utf8');
  assert.ok(s.includes('{cropPanelIdx >= 0 && ('));
  assert.ok(s.includes('const cur = cropPanelRect || { x1: 0, y1: 0, x2: 1, y2: 1 };'));
  assert.ok(s.includes('or type the four % below'));
});
check('42 …and the crop release keeps the object selected', () => {
  const s = readFileSync('./src/components/ImageBuilder.jsx', 'utf8');
  assert.ok(s.includes('suppressSelectRef.current = true;'));
  assert.ok(s.includes('if (suppressSelectRef.current) { suppressSelectRef.current = false; return; }'));
  assert.ok(s.includes('if (d && (d.x2 - d.x1) >= CROP_MIN && (d.y2 - d.y1) >= CROP_MIN) {'));
});
check('43 the helper is defined exactly once (no duplicate export)', () => {
  eq((SAT.match(/export const chartStyleSeriesBlock/g) || []).length, 1);
  eq((SAT.match(/const cfgDot = \(cfg, stroke, key = null\)/g) || []).length, 1);
});
check('44 the interrupted ("broken") axis is a first-class panel command', () => {
  // The helpers the panel / the charts read, all from the real module.
  const brk = axisBreakOf({ yBreak: true, yBreakFrom: 10, yBreakTo: 90, yBreakGap: 6 }, 'y');
  eq(brk.on, true);
  eq(brk.from, 10);
  eq(brk.to, 90);
  assert.ok(brokenScale(brk) != null, 'brokenScale returns a scale');
  assert.ok(breakTicks(breakSegments(brk, 0, 100), 20).length > 0, 'breakTicks returns ticks');
  eq(chartJsBrokenAxisOptions({}, 'y'), null);
  eq(chartJsBrokenAxisOptions({ yBreak: true, yBreakFrom: 10, yBreakTo: 90 }, 'y').type, 'brokenLinear');
});
check('45 the panel writes the break commands and the title view shows them', () => {
  assert.ok(SAT.includes('✂ Interrupt Y axis'), 'the Y switch is in the panel');
  assert.ok(SAT.includes("{section === 'label' && chartStyleTickBlock(cfg, set, 'label')}"), 'the axis-title view shows ticks / decimals / log');
  assert.ok(SAT.includes('yBreakFrom') && SAT.includes('yBreakTo') && SAT.includes('yBreakGap'), 'the three commands exist');
});
check('46 every histogram family can interrupt its Y axis', () => {
  // recharts charts: SharedChart draws the scale itself, the others ask for it.
  assert.ok(SAT.includes('const yScale = brokenScale(yBrk);'), 'SharedChart builds the scale');
  assert.ok(SAT.includes('export const AxisBreakMarks'), 'SharedChart draws the ✂ marks');
  for (const f of ['FlowCytometrySections', 'MDSections', 'NMRSections', 'DockingSections']) {
    const s = readFileSync(`./src/components/${f}.jsx`, 'utf8');
    assert.ok(s.includes('brokenAxisProps('), `${f} does not use the shared break helper`);
  }
  // Chart.js canvases: Plate (IC50 histogram) + NMR fittings (rate histogram).
  for (const f of ['PlateSections', 'NMRFittingsTestRenderer']) {
    const s = readFileSync(`./src/components/${f}.jsx`, 'utf8');
    assert.ok(s.includes('brokenAxisScaleOptions(chartCfg, \'y\')'), `${f} does not interrupt the histogram`);
    assert.ok(s.includes("from '../utils/chartJsBrokenAxis'"), `${f} does not import the broken scale`);
  }
  const cjs = readFileSync('./src/utils/chartJsBrokenAxis.js', 'utf8');
  assert.ok(cjs.includes("static id = 'brokenLinear';"), 'the Chart.js scale type is declared');
  assert.ok(cjs.includes('Chart.register(BrokenLinearScale, brokenAxisPlugin);'), 'and registered');
});

check('47 the panel offers the ALONG-AXIS move of each title', () => {
  // The GAP pushes a title AWAY from the plot; the MOVE slides it ALONG its own
  // axis — the command that keeps a long, rotated y title inside the graph when
  // the characters are big (the title runs upwards from the middle of the plot).
  assert.ok(SAT.includes('X label move (px)') && SAT.includes('+ right / '), 'the X move control is missing');
  assert.ok(SAT.includes('Y label move (px)') && SAT.includes('+ down / '), 'the Y move control is missing');
  assert.ok(SAT.includes('set({ xAxisLabelMove: v })') && SAT.includes('set({ yAxisLabelMove: v })'),
    'the panel does not write the commands');
  assert.ok(SAT.includes('const move = axisLabelMove(cfg, axis);'), 'cfgAxisLabel does not read the move');
  assert.ok(SAT.includes("const axisLabelMove = (cfg = {}, axis = 'x') => {"), 'the reader is missing');
  assert.ok(SAT.includes('...(move ? { dy: move } : {})'), 'the rotated y title does not take the vertical move');
  assert.ok(SAT.includes('...(move ? { dx: move } : {})'), 'the x title does not take the horizontal move');
  // Nothing moves unless the user asks: at 0 no prop is added at all.
  assert.ok(SAT.includes('...(move ? { dy: move } : {})'), 'the move must be omitted at 0');
});
check('48 the move is not a gap: the two commands stay independent', () => {
  // A chart that only MOVES its titles asks for no extra canvas padding, and the
  // Chart.js canvases keep their own (gap-driven) room.
  eq(cfgAxisGap({ yAxisLabelMove: 60 }, 'y'), 0);
  eq(chartJsPadding({ fontSize: 16, yAxisLabelMove: 60 }), chartJsPadding({ fontSize: 16 }));
  eq(chartJsTitlePad({ yAxisLabelMove: 60 }), { x: 0, y: 0 });
  eq(chartJsHeightFit(100, { fontSize: 16, yAxisLabelMove: 60 }, { yTitle: 'Intensity (a.u.)' }),
    chartJsHeightFit(100, { fontSize: 16 }, { yTitle: 'Intensity (a.u.)' }));
});

const failed = results.filter((r) => !r.ok);
console.table(results.map((r) => ({ name: r.name, ok: r.ok, error: r.ok ? '' : r.got })));
if (failed.length) {
  console.error(`\n❌ ${failed.length}/${results.length} checks failed`);
  process.exit(1);
}
console.log(`\n✅ ${results.length}/${results.length} checks passed`);
