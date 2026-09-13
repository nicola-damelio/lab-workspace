/* =========================================================================
   src/utils/chartJsBrokenAxis.js

   The Chart.js side of the interrupted ("broken") axis: a 'brokenLinear' scale
   type plus the plugin that draws the double slash. Chart.js charts are used by
   the plate results (IC50 histogram, dose-response), the NMR fittings
   (R1/R2/DOSY + histogram) and DOSY — all of them show histograms where one bar
   can be 100× the others.

   The scale keeps the REAL values everywhere (min / max / ticks / tooltips /
   cursor). Only value→pixel and pixel→value are re-mapped through the same
   piecewise maths as the recharts side (src/utils/chartStyle.js), so a CSV
   export or a hovered value never shows a rescaled number.

   The commands come from the 🎨 panel (cfg.yBreak / yBreakFrom / yBreakTo /
   yBreakGap). With the two numbers left EMPTY the break is placed automatically
   on the biggest gap of the data (see brokenAxisScaleOptions below), so the ✂
   tick alone is enough — exactly like the recharts side.
   ========================================================================= */
import { Chart, LinearScale } from 'chart.js';
import { breakSegments, breakMapFrac, breakFracValue, chartJsBrokenAxisOptions } from './chartStyle.js';

const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));

/** Break spec of one Chart.js scale, from its own options. */
const scaleBreakOf = (options = {}) => {
  const from = num(options.breakFrom);
  const to = num(options.breakTo);
  const gap = num(options.breakGap);
  return {
    on: Number.isFinite(from) && Number.isFinite(to) && to > from,
    from: Number.isFinite(from) ? from : 0,
    to: Number.isFinite(to) ? to : 0,
    gap: Math.min(0.4, Math.max(0.01, Number.isFinite(gap) ? gap : 0.07))
  };
};

export class BrokenLinearScale extends LinearScale {
  static id = 'brokenLinear';

  static defaults = LinearScale.defaults;

  /** The two visible pieces of THIS scale, or null when nothing is interrupted. */
  _segments() {
    const brk = scaleBreakOf(this.options);
    if (!brk.on) return null;
    return breakSegments(brk, this.min, this.max);
  }

  getPixelForValue(value) {
    const seg = this._segments();
    const f = seg ? breakMapFrac(seg, value) : null;
    if (f == null) return super.getPixelForValue(value);
    return this.getPixelForDecimal(f);
  }

  getValueForPixel(pixel) {
    const seg = this._segments();
    if (!seg) return super.getValueForPixel(pixel);
    return breakFracValue(seg, this.getDecimalForPixel(pixel));
  }

  buildTicks() {
    const ticks = super.buildTicks();
    const seg = this._segments();
    if (!seg) return ticks;
    const { from, to } = seg;
    const eps = Math.abs(to - from) / 1e6;
    // Every tick that would fall INSIDE the compressed band is dropped; the two
    // edges of the interruption are always labelled.
    const kept = ticks.filter((t) => t.value <= from + eps || t.value >= to - eps);
    for (const v of [from, to]) {
      if (!kept.some((t) => Math.abs(t.value - v) <= eps)) kept.push({ value: v });
    }
    kept.sort((a, b) => a.value - b.value);
    return kept;
  }
}

/** Draws the dashed guide lines + the classic double slash on the axis. */
export const brokenAxisPlugin = {
  id: 'labBrokenAxis',
  afterDraw(chart) {
    const ctx = chart && chart.ctx;
    const area = chart && chart.chartArea;
    if (!ctx || !area || !chart.scales) return;
    Object.keys(chart.scales).forEach((key) => {
      const scale = chart.scales[key];
      const seg = scale && typeof scale._segments === 'function' ? scale._segments() : null;
      if (!seg) return;
      const horizontal = scale.isHorizontal();
      const p1 = scale.getPixelForValue(seg.from);
      const p2 = scale.getPixelForValue(seg.to);
      if (!Number.isFinite(p1) || !Number.isFinite(p2)) return;
      const lo = Math.min(p1, p2);
      const hi = Math.max(p1, p2);
      ctx.save();
      ctx.strokeStyle = 'rgba(100,116,139,0.85)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(lo, area.top); ctx.lineTo(lo, area.bottom);
        ctx.moveTo(hi, area.top); ctx.lineTo(hi, area.bottom);
      } else {
        ctx.moveTo(area.left, lo); ctx.lineTo(area.right, lo);
        ctx.moveTo(area.left, hi); ctx.lineTo(area.right, hi);
      }
      ctx.stroke();
      // The interruption marks sit ON the axis line, as two parallel slashes.
      ctx.setLineDash([]);
      ctx.lineWidth = 1.6;
      const axisPx = horizontal
        ? (scale.position === 'top' ? area.top : area.bottom)
        : (scale.position === 'right' ? area.right : area.left);
      const w = 5;
      [lo, hi].forEach((p) => {
        for (const off of [-3, 3]) {
          ctx.beginPath();
          if (horizontal) {
            ctx.moveTo(p + off - w, axisPx + 6);
            ctx.lineTo(p + off + w, axisPx - 6);
          } else {
            ctx.moveTo(axisPx - 6, p + off - w);
            ctx.lineTo(axisPx + 6, p + off + w);
          }
          ctx.stroke();
        }
      });
      ctx.restore();
    });
  }
};

let registered = false;

/** Idempotent: makes `type: 'brokenLinear'` (and the slash plugin) available. */
export const registerBrokenAxis = () => {
  if (registered) return;
  Chart.register(BrokenLinearScale, brokenAxisPlugin);
  registered = true;
};

registerBrokenAxis();

/**
 * `{ ...options.scales.y, ...brokenAxisScaleOptions(cfg, 'y', values) }` — null
 * when the axis is not interrupted, so a normal chart keeps its plain linear
 * scale.
 *
 * `values` are the Y values of the axis (chartJsYValues does it for a Chart.js
 * `datasets` array): they let the ✂ tick ALONE interrupt the axis, the panel's
 * two numbers only being needed to override where the break sits.
 */
export const brokenAxisScaleOptions = (cfg = {}, axis = 'y', values = []) => chartJsBrokenAxisOptions(cfg, axis, values);

/**
 * The Y values of Chart.js datasets — `[{ data: [{x, y}] }]` (scatter / line /
 * bar) or `[{ data: [12, 8, 4000] }]` (histogram) — ready for the automatic
 * break. Hidden datasets and non-finite / missing points are dropped, so a
 * series switched off in the panel cannot decide where the axis is cut.
 */
export const chartJsYValues = (datasets = []) => (Array.isArray(datasets) ? datasets : [])
  .flatMap((ds) => {
    if (!ds || ds.hidden) return [];
    const rows = Array.isArray(ds.data) ? ds.data : [];
    return rows.map((p) => {
      if (p === null || p === undefined) return NaN;
      return typeof p === 'object' ? Number(p.y) : Number(p);
    });
  })
  .filter((v) => Number.isFinite(v));

