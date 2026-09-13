/* =========================================================================
   _break_test.mjs — the interrupted ("broken") axis.

   Part 1 checks the pure maths of src/utils/chartStyle.js.
   Part 2 renders a REAL recharts bar chart (server-side) with the custom
   `brokenScale` and checks the bar heights: the low bars must be expanded and
   the empty band between them and the tall bar must be compressed. That is the
   only way to prove a function-scale axis works without a browser.
   ========================================================================= */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Chart as ChartRegistry } from 'chart.js';
import {
  axisBreakOf, axisBreakFor, autoBreakBounds, breakSegments, breakMapFrac, breakFracValue,
  breakTicks, brokenScale, chartJsBrokenAxisOptions, niceStep
} from './src/utils/chartStyle.js';

const results = [];
const check = (name, fn) => {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
};
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const eqc = (a, b, tol, msg) => assert.ok(close(a, b, tol), msg || `${a} != ${b}`);
const eq = (a, b, msg) => assert.deepEqual(a, b, msg);

/* ══ 1. the 🎨 panel commands ════════════════════════════════════════════ */
const CFG = { yBreak: true, yBreakFrom: 50, yBreakTo: 950, yBreakGap: 7 };

check('1 the Y break is read from the panel commands', () => {
  const b = axisBreakOf(CFG, 'y');
  eq(b.on, true);
  eq(b.from, 50);
  eq(b.to, 950);
  eqc(b.gap, 0.07, 1e-12);
});
check('2 no checkbox = no break', () => {
  eq(axisBreakOf({ yBreakFrom: 50, yBreakTo: 950 }, 'y').on, false);
  eq(axisBreakOf({ yBreak: true, yBreakFrom: 950, yBreakTo: 50 }, 'y').on, false);
  eq(axisBreakOf({ yBreak: true, yBreakFrom: 50 }, 'y').on, false);
});
check('3 the default band is 7 % and nonsense is clamped', () => {
  eqc(axisBreakOf({ yBreak: true, yBreakFrom: 1, yBreakTo: 9 }, 'y').gap, 0.07, 1e-12);
  eqc(axisBreakOf({ yBreak: true, yBreakFrom: 1, yBreakTo: 9, yBreakGap: 500 }, 'y').gap, 0.4, 1e-12);
  eqc(axisBreakOf({ yBreak: true, yBreakFrom: 1, yBreakTo: 9, yBreakGap: 0 }, 'y').gap, 0.01, 1e-12);
});
check('4 X and Y breaks are independent', () => {
  eq(axisBreakOf({ xBreak: true, xBreakFrom: 1, xBreakTo: 2 }, 'x').on, true);
  eq(axisBreakOf({ xBreak: true, xBreakFrom: 1, xBreakTo: 2 }, 'y').on, false);
});

/* ══ 2. the geometry of the interruption ═════════════════════════════════ */
const brk = axisBreakOf(CFG, 'y');                       // 50 | 950 over [0, 1000]
const seg = breakSegments(brk, 0, 1000);

check('5 the two visible parts share the axis minus the band', () => {
  eqc(seg.lowFrac, 0.465, 1e-12);                        // (1 - 0.07) / 2
  eqc(seg.lowFrac + seg.gapFrac, 0.535, 1e-12);
  eqc(seg.lowFrac * 2 + seg.gapFrac, 1, 1e-12);          // nothing is lost
});
check('6 the break edges land on the edge of the band', () => {
  eqc(breakMapFrac(seg, 0), 0, 1e-12);
  eqc(breakMapFrac(seg, 50), 0.465, 1e-12);
  eqc(breakMapFrac(seg, 950), 0.535, 1e-12);
  eqc(breakMapFrac(seg, 1000), 1, 1e-12);
});
check('7 a value inside the (empty) band stays visible, squeezed', () => {
  eqc(breakMapFrac(seg, 500), 0.5, 1e-12);
  const f = breakMapFrac(seg, 725);
  assert.ok(f > 0.465 && f < 0.535, `inside the band: ${f}`);
});
check('8 the mapping is monotone', () => {
  const vals = [0, 10, 49, 50, 100, 500, 900, 950, 999, 1000];
  const fr = vals.map((v) => breakMapFrac(seg, v));
  for (let i = 1; i < fr.length; i++) assert.ok(fr[i] > fr[i - 1], `${vals[i]}`);
});
check('9 pixel→value is the exact inverse of value→pixel', () => {
  [0, 5, 25, 50, 123, 500, 949, 950, 975, 1000].forEach((v) => {
    const f = breakMapFrac(seg, v);
    eqc(breakFracValue(seg, f), v, 1e-6, `round trip of ${v}`);
  });
});
check('10 a break outside the data range is ignored (no false slash)', () => {
  eq(breakSegments(axisBreakOf({ yBreak: true, yBreakFrom: 2000, yBreakTo: 3000 }, 'y'), 0, 1000), null);
  eq(breakSegments(axisBreakOf({ yBreak: false, yBreakFrom: 50, yBreakTo: 950 }, 'y'), 0, 1000), null);
});
check('11 a break running off the top only compresses what is visible', () => {
  const s = breakSegments(axisBreakOf({ yBreak: true, yBreakFrom: 100, yBreakTo: 5000 }, 'y'), 0, 1000);
  eqc(s.to, 1000, 1e-12);
  eqc(s.lowSpan, 100, 1e-12);
  eqc(s.highSpan, 0, 1e-12);                             // everything above 100 is the break
  eqc(breakMapFrac(s, 0), 0, 1e-12);
  eqc(breakMapFrac(s, 50), 0.5 * 0.93 * 0.5, 1e-12);     // half of the low part
  eqc(breakMapFrac(s, 100), 0.465, 1e-12);               // top of the low part
  eqc(breakMapFrac(s, 1000), 1, 1e-12);                  // the tall bar keeps the rest
});
check('12 a break starting at the axis bottom compresses everything below it', () => {
  // "clipped axis" style: from = the axis minimum ⇒ the low part lives inside
  // the band, the whole upper part keeps the remaining share.
  const s = breakSegments(axisBreakOf({ yBreak: true, yBreakFrom: 0, yBreakTo: 900, yBreakGap: 10 }, 'y'), 0, 1000);
  eqc(s.lowSpan, 0, 1e-12);
  eqc(breakMapFrac(s, 0), 0, 1e-12);
  eqc(breakMapFrac(s, 450), 0.5, 1e-12);                 // inside the band
  eqc(breakMapFrac(s, 900), 0.55, 1e-12);                // top of the band
  eqc(breakMapFrac(s, 950), 0.775, 1e-12);               // half of the upper part
  eqc(breakMapFrac(s, 1000), 1, 1e-12);
});
check('12b the low bars always keep ~half of the plot, however big the bar is', () => {
  // bars 0..50 and one at 5_000_000: proportional shares would leave 0.001 %.
  const s = breakSegments(axisBreakOf({ yBreak: true, yBreakFrom: 50, yBreakTo: 4000000 }, 'y'), 0, 5000000);
  eqc(s.lowFrac, 0.465, 1e-12);
  const top = breakMapFrac(s, 5000000);
  eqc(top, 1, 1e-12);
  assert.ok(breakMapFrac(s, 50) > 0.4, 'the 50-count bar is drawn over 40 % of the axis');
});

/* ══ 3. the axis ticks ═══════════════════════════════════════════════════ */
check('13 the ticks keep the real values and skip the empty band', () => {
  const t = breakTicks(seg, 10);
  assert.ok(t.includes(50), 'low edge labelled');
  assert.ok(t.includes(950), 'high edge labelled');
  assert.ok(t.includes(0) && t.includes(1000), `extremes: ${t}`);
  assert.ok(!t.some((v) => v > 50 && v < 950), `no tick inside the band: ${t}`);
  for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1], 'sorted + unique');
});
check('14 an automatic tick step is chosen when the user set none', () => {
  const t = breakTicks(seg);
  assert.ok(t.length >= 3 && t.length <= 40, `${t.length} ticks`);
  assert.ok(niceStep(900, 6) === 200 || niceStep(900, 6) === 100, String(niceStep(900, 6)));
});

/* ══ 4. the recharts scale (the d3 surface recharts 3.10 uses) ══════════ */
check('15 the scale is callable and carries copy/domain/range/invert/ticks', () => {
  const s = brokenScale(brk);
  eq(typeof s, 'function');
  ['copy', 'domain', 'range', 'invert', 'ticks'].forEach((m) => eq(typeof s[m], 'function', m));
  eq(brokenScale({ on: false }), null);
});
check('16 value→pixel uses the interrupted mapping (inverted Y range)', () => {
  const s = brokenScale(brk).domain([0, 1000]).range([300, 0]);   // recharts: bottom→top
  eqc(s(0), 300, 1e-9);
  eqc(s(50), 300 - 0.465 * 300, 1e-9);                   // 160.5 px
  eqc(s(950), 300 - 0.535 * 300, 1e-9);                  // 139.5 px
  eqc(s(1000), 0, 1e-9);
  assert.ok(s(950) - s(50) < 30, 'the empty band is squeezed into < 30 px');
  assert.ok(Math.abs(s(500) - (s(50) + s(950)) / 2) < 1e-9, 'middle of the band');
});
check('17 the same bars on a LINEAR axis would be 270 px apart', () => {
  const lin = (v) => 300 - (v / 1000) * 300;
  assert.ok(Math.abs(lin(50) - lin(950)) > 260, 'proves the test is meaningful');
});
check('18 pixel→value of the scale inverts it (tooltips / hover)', () => {
  const s = brokenScale(brk).domain([0, 1000]).range([300, 0]);
  [0, 20, 50, 400, 950, 1000].forEach((v) => eqc(s.invert(s(v)), v, 1e-6));
});
check('19 range order is respected (a right-to-left axis stays right-to-left)', () => {
  const s = brokenScale(brk).domain([0, 1000]).range([0, 300]);
  eqc(s(0), 0, 1e-9);
  eqc(s(1000), 300, 1e-9);
});
check('20 copy() returns an independent scale with the same mapping', () => {
  const s = brokenScale(brk).domain([0, 1000]).range([300, 0]);
  const c = s.copy().domain([0, 1000]).range([300, 0]);
  eqc(c(50), s(50), 1e-9);
  c.domain([0, 2000]);
  eqc(s.domain()[1], 1000, 1e-12);
  eq(s.ticks(6).includes(50), true);
});

/* ══ 5. the Chart.js side ════════════════════════════════════════════════ */
check('21 the Chart.js scale options name the registered scale type', () => {
  const o = chartJsBrokenAxisOptions(CFG, 'y');
  eq(o.type, 'brokenLinear');
  eq(o.breakFrom, 50);
  eq(o.breakTo, 950);
  eqc(o.breakGap, 0.07, 1e-12);
  eq(chartJsBrokenAxisOptions({}, 'y'), null);
});

/* ══ 6. recharts' OWN scale factory — the real integration ═══════════════
   A browser is not available here, but `combineConfiguredScale` is the exact
   function recharts 3.10 runs for `<YAxis scale={brokenScale(brk)} />`: it calls
   `scale.copy().domain(axisDomain).range(axisRange)`. If our object survives
   that call with the right coordinates, the axis really is interrupted on screen.
   ════════════════════════════════════════════════════════════════════════ */
const require = createRequire(import.meta.url);
const configureScale = () =>
  require('./node_modules/recharts/lib/state/selectors/combiners/combineConfiguredScale.js').combineConfiguredScale;

check('22 recharts builds the axis from the custom broken scale', () => {
  const scale = configureScale()({ scale: brokenScale(brk) }, 'linear', [0, 4000], [300, 0]);
  eqc(scale(0), 300, 1e-6);                    // bottom of the plot
  eqc(scale(4000), 0, 1e-6);                   // top of the plot
  eqc(scale(50), 300 - 0.465 * 300, 1e-6);     // top of the LOW bars
  eqc(scale(950), 300 - 0.535 * 300, 1e-6);    // bottom of the TALL bar
});
check('23 the 5-count bar becomes visible (the whole point of the feature)', () => {
  const scale = configureScale()({ scale: brokenScale(brk) }, 'linear', [0, 4000], [300, 0]);
  const heightOf = (v) => Math.abs(scale(0) - scale(v));      // exactly what Bar does
  const linear = (v) => (v / 4000) * 300;
  assert.ok(linear(5) < 1, `linear height of the 5-count bar: ${linear(5)}px`);
  assert.ok(heightOf(5) > 10, `interrupted height: ${heightOf(5)}px`);
  assert.ok(heightOf(48) > heightOf(5), '48 is still taller than 5');
  assert.ok(heightOf(4000) > heightOf(48), 'the huge bar stays the tallest');
  // …and it does not eat the whole plot: the low bars keep half of it.
  assert.ok(heightOf(50) > 100, `low bands height: ${heightOf(50)}px`);
  // The tall bar is drawn from the bottom edge to the top edge: it crosses the
  // interrupted band, which the dashed guides + the double slash make explicit.
  eqc(heightOf(4000), 300, 1e-6);
});
check('24 an interrupted axis falls back to the normal one when switched off', () => {
  const off = axisBreakOf({ ...CFG, yBreak: false }, 'y');
  // This is how every chart asks for it: `scale={brokenScale(brk) || 'auto'}`.
  const scale = configureScale()({ scale: brokenScale(off) || 'auto' }, 'linear', [0, 4000], [300, 0]);
  assert.ok(scale != null, 'a normal linear scale is used');
  eqc(scale(2000), 150, 1e-6);                 // 2000 sits at the middle, as before
  eqc(scale(50), 300 - (50 / 4000) * 300, 1e-6);
});

/* ══ 7. the "Interrupt Y axis" tick alone (no numbers to type) ═══════════ */
check('25 a giant bar is detected and the break is placed automatically', () => {
  const auto = autoBreakBounds([5, 12, 8, 30, 48, 4000]);
  assert.ok(auto, 'a break is proposed');
  eqc(auto.to, 4000, 1e-9);
  assert.ok(auto.from > 48 && auto.from < 4000, `from = ${auto.from}`);
  eq(autoBreakBounds([5, 12, 8, 30, 48]), null);          // no dramatic gap → nothing
  eq(autoBreakBounds([5, 12]), null);                     // too few bars
});
check('26 axisBreakFor: typed numbers win, otherwise the data decides', () => {
  const typed = axisBreakFor(CFG, 'y', [5, 4000]);
  eq(typed.from, 50);
  eq(typed.auto, undefined);
  const auto = axisBreakFor({ yBreak: true }, 'y', [5, 12, 8, 30, 4000]);
  eq(auto.on, true);
  eq(auto.auto, true);
  eq(axisBreakFor({ yBreak: true }, 'y', [5, 12, 8]).on, false);   // nothing to interrupt
  eq(axisBreakFor({}, 'y', [5, 12, 8, 4000]).on, false);           // the switch is off
});

/* ══ 8. the Chart.js scale class (Plate / NMR-fittings histograms) ═════════ */
const { BrokenLinearScale, brokenAxisPlugin, registerBrokenAxis, chartJsYValues } = await import('./src/utils/chartJsBrokenAxis.js');

check('27 the Chart.js scale maps value→pixel through the interruption', () => {
  // A minimal stand-in for a Chart.js LinearScale: same min/max/options surface,
  // the inherited decimal helpers, and the scale's own segment finder.
  const fake = {
    min: 0,
    max: 4000,
    options: { breakFrom: 50, breakTo: 950, breakGap: 0.07 },
    getPixelForDecimal: (f) => 300 - f * 300,
    getDecimalForPixel: (p) => (300 - p) / 300,
    _segments: BrokenLinearScale.prototype._segments
  };
  const at = (v) => BrokenLinearScale.prototype.getPixelForValue.call(fake, v);
  const value = (p) => BrokenLinearScale.prototype.getValueForPixel.call(fake, p);
  eqc(at(0), 300, 1e-6);
  eqc(at(4000), 0, 1e-6);
  eqc(at(50), 300 - 0.465 * 300, 1e-6);
  eqc(at(950), 300 - 0.535 * 300, 1e-6);
  // The 5-count bar of a histogram: invisible before, ~14 px after.
  assert.ok(Math.abs(at(0) - at(5)) > 10, `bar height: ${Math.abs(at(0) - at(5))}px`);
  [0, 25, 50, 400, 950, 4000].forEach((v) => eqc(value(at(v)), v, 1e-6));
});
check('28 without break options the scale IS a normal linear scale', () => {
  const fake = { min: 0, max: 4000, options: {}, _segments: BrokenLinearScale.prototype._segments };
  eq(BrokenLinearScale.prototype._segments.call(fake), null);
  eq(BrokenLinearScale.id, 'brokenLinear');
  // …and the ✂ marks plugin does nothing at all when nothing is interrupted.
  brokenAxisPlugin.afterDraw({ scales: {}, ctx: null, chartArea: null });
});
check('29 the scale type is registered with Chart.js (so `type: brokenLinear` exists)', () => {
  const reg = ChartRegistry.registry;
  const getScale = (id) => (typeof reg.getScale === 'function' ? reg.getScale(id) : reg.scales.get(id));
  const getPlugin = (id) => (typeof reg.getPlugin === 'function' ? reg.getPlugin(id) : reg.plugins.get(id));
  eq(getScale('brokenLinear').id, 'brokenLinear');
  eq(getPlugin('labBrokenAxis').id, 'labBrokenAxis');
  registerBrokenAxis();   // idempotent: a second call is a no-op
});

/* ══ 9. the ✂ tick ALONE on a canvas (no numbers to type) ════════════════ */
check('30 chartJsBrokenAxisOptions also works from the plotted values', () => {
  // The Chart.js bridge now follows the recharts rule: the biggest gap of the
  // data is compressed when the panel's two numbers are left empty.
  const auto = chartJsBrokenAxisOptions({ yBreak: true }, 'y', [5, 8, 12, 30, 4000]);
  eq(auto.type, 'brokenLinear');
  eqc(auto.breakFrom, 36, 1e-9);           // 30 × 1.2 = the top of the small bars
  eqc(auto.breakTo, 4000, 1e-9);
  eqc(auto.breakGap, 0.07, 1e-12);
  // A canvas can also interrupt its X axis, with its own values.
  eq(chartJsBrokenAxisOptions({ xBreak: true }, 'x', [1, 2, 3, 90]).type, 'brokenLinear');
  eq(chartJsBrokenAxisOptions({ xBreak: true }, 'x', [1, 2, 3, 90]).breakTo, 90);
});
check('31 the typed numbers still win, and nothing happens without a gap', () => {
  eq(chartJsBrokenAxisOptions(CFG, 'y', [5, 4000]).breakFrom, 50);
  eq(chartJsBrokenAxisOptions({ yBreak: true }, 'y', [5, 8, 12]), null);   // no dramatic gap
  eq(chartJsBrokenAxisOptions({ yBreak: true }, 'y'), null);               // no values at all
  eq(chartJsBrokenAxisOptions({}, 'y', [5, 4000]), null);                  // the switch is off
});
check('32 chartJsYValues reads every dataset shape a canvas uses', () => {
  // Scatter / line points ({x, y}) and plain histogram numbers — both at once.
  eq(chartJsYValues([{ data: [{ x: 0, y: 5 }, { x: 1, y: 4000 }] }, { data: [7, '8'] }]), [5, 4000, 7, 8]);
  eq(chartJsYValues([{ data: [7, null, 'x', undefined] }]), [7]);          // gaps are dropped
  eq(chartJsYValues([{ hidden: true, data: [1, 4000] }, { data: [2] }]), [2]); // a hidden series is ignored
  eq(chartJsYValues(), []);
  eq(chartJsYValues(null), []);
});

const failed = results.filter((r) => !r.ok);
results.forEach((r) => console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}${r.ok ? '' : ` :: ${r.err}`}`));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
