/* =========================================================================
   SplitChartStack — the “📚 Split view” stack of the spectra pages.

   It renders ONE graph per series, stacked vertically in a single card, and
   tags that card `data-star-group`, so the ChartStarLayer offers the WHOLE
   stack as ONE ⭐ / 📷 item: a split figure is captured, starred and saved as
   a SINGLE image (the same mechanism as the Flow Cytometry “Split view —
   single curves” panel). The sub-graphs keep their own ⭐/📷 buttons.

   Used by the NMR (1D overlay), ssNMR and CD spectra pages; `renderChart`
   supplies the page's own sub-chart so each page keeps its axes, ticks and
   styling helpers.

   ── THE LAYOUT OF THE STACK: { aspect, rowH, gap, yAxis } ───────────────
   A sub-chart used to be a FIXED 150 px box with no space between the rows —
   fine for two conditions, cramped for ten (the stack has to be scrolled, and
   a graph cannot be made flatter than its box allows). It is now drawn 2.5 ×
   taller (SPLIT_CHART_H = 375 px — about the height of the overlay chart it is
   compared against), and the page can hand the stack a `layout`:
     • aspect — the WIDTH : HEIGHT ratio of ONE sub-chart (0 = the default
       SPLIT_CHART_H box). It is applied as `aspect-ratio`, so the graphs grow
       and shrink with the width the stack was given. A definite `height` — or
       a `max-height` smaller than the ratio needs — CANCELS `aspect-ratio` in
       the browser, which is why splitChartBoxStyle returns ONE of the two and
       never both (the same rule chartRatioBoxStyle follows in chartStyle.js).
     • gap — the VERTICAL SEPARATION (px) inserted between two rows (0 = the
       hairlines of the historical layout, untouched).
     • rowH — the HEIGHT (px) of ONE stacked graph. A lane draws its curve from
       its own baseline to its own peak, so this is also how far the PEAKS of
       two curves sit apart: shorten it and the curves come closer, until they
       almost touch (the “Height” field of the controls). It beats `aspect` and
       the page's own box, because a definite `height` cancels `aspect-ratio`.
       0 (the default) leaves the box to `aspect` / the page.
     • yAxis — false hides the Y axis of every sub-chart: its numbers and the
       room the round ticks need are gone, so a curve fills its box from the
       baseline to its peak and two rows really come close (the “No Y axis”
       switch; see the readers below).
   Every value is clamped by normalizeSplitLayout, so a stored / hand-edited value
   can neither break the stack nor shrink a graph into a 4 px line.
   <SplitLayoutControls> (bottom of this file) is the set of knobs the pages
   show in their toolbar — deliberately OUTSIDE the tagged card, so a control
   can never end up in the captured figure. The Flow Cytometry split panel uses
   the same helpers (its “own” box height is its own Graphical-Parameters
   height, see splitOwnHeight), so the four split views cannot drift apart.
   ========================================================================= */
import React from 'react';

// Height of a stacked sub-chart: 2.5 × the 150 px box the stack originally
// used, i.e. about as tall as the overlay chart it is compared against
// (~380 px). It stays the height of a sub-chart until the page asks for a
// RATIO (layout.aspect > 0) — see splitChartBoxStyle.
export const SPLIT_CHART_H = 375;

// Floor of a RATIO-sized box (2.5 × the 72 px floor that went with the old
// 150 px box): an 8 : 1 graph in a narrow column would be shorter than its own
// axis numbers. A definite `min-height` is allowed next to `aspect-ratio` (only
// a definite HEIGHT cancels it), so the floor never disables the shape — it
// only stops it at a readable minimum.
export const SPLIT_CHART_MIN_H = 180;

export const SPLIT_ASPECT_MIN = 0.5;
export const SPLIT_ASPECT_MAX = 8;
// The one-click shapes of <SplitLayoutControls>; 0 / “own” is the
// SPLIT_CHART_H (375 px) box.
export const SPLIT_ASPECT_STEPS = [1, 1.25, 1.5, 2, 2.5, 3, 4, 6];
export const SPLIT_GAP_MIN = 0;
export const SPLIT_GAP_MAX = 48;
export const SPLIT_GAP_STEP = 2;

// The HEIGHT of ONE stacked graph (px) — and with it the distance between two
// curves, because every lane draws its curve from its own baseline to its own
// peak (the peaks of two curves are exactly one lane apart). “Auto” (0) leaves
// the box to the Shape knob / the host page; a value squeezes the lanes so the
// curves can be brought together until they almost touch — the “Height” field
// of <SplitLayoutControls>.
export const SPLIT_ROW_H_MIN = 30;
export const SPLIT_ROW_H_MAX = 480;
export const SPLIT_ROW_H_STEP = 10;
// …and what one click of “Pack” writes: no Y axis, no gap and one short lane
// per curve ⇒ the tightest stack this component can draw, i.e. the curves
// almost touching. Every knob of the controls can tune it from there.
export const SPLIT_PACK_H = 60;

/** A number, or 0 when the value is missing / empty / not a number. */
const numberOf = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** A clamped `{ aspect, rowH, gap, yAxis }` — the only reader of a stored / typed value. */
export const normalizeSplitLayout = (layout = {}) => {
  const src = layout || {};
  const aspect = numberOf(src.aspect);
  const rowH = numberOf(src.rowH);
  return {
    aspect: aspect > 0 ? clamp(aspect, SPLIT_ASPECT_MIN, SPLIT_ASPECT_MAX) : 0,
    // A lane height only counts when it was given: 0 (missing / empty / hand-
    // edited) leaves every box to the Shape knob or to the host page, i.e. the
    // historical layout.
    rowH: rowH > 0 ? clamp(rowH, SPLIT_ROW_H_MIN, SPLIT_ROW_H_MAX) : 0,
    gap: clamp(numberOf(src.gap), SPLIT_GAP_MIN, SPLIT_GAP_MAX),
    // “No Y axis”: only an explicit false hides it, so a layout stored before
    // that switch existed keeps every axis the stack has always drawn.
    yAxis: src.yAxis !== false
  };
};

/** The layout stored on an experiment (missing / edited values are clamped). */
export const splitLayoutOf = (exp) => normalizeSplitLayout(exp && exp.splitLayout);

/** The value to store for a layout change — `{ aspect, gap }`, already clamped. */
export const withSplitLayout = (exp, patch) =>
  normalizeSplitLayout({ ...splitLayoutOf(exp), ...(patch || {}) });

/**
 * The height of the “own” box: SPLIT_CHART_H, unless the page hosts its
 * sub-charts with a height of its own. The Flow Cytometry split panel is that
 * host — its mini charts are sized by the `height` of its own Graphical
 * Parameters (vizCfgSplit), so “own” there must keep meaning “the height I set
 * in that panel” and not silently override it with the 375 px of the spectra
 * stacks. Anything unusable (missing / empty / non-positive) falls back to
 * SPLIT_CHART_H, so a stored or typed value can never collapse a graph.
 */
export const splitOwnHeight = (baseHeight = SPLIT_CHART_H) => {
  const n = numberOf(baseHeight);
  return n > 0 ? n : SPLIT_CHART_H;
};

/* ── “No Y axis” — the switch that really packs the curves ────────────────
   With `layout.yAxis === false` every sub-chart of a stack loses its Y axis
   (the numbers AND the gutter they sit in) and, with it, the round-tick
   headroom that kept a curve away from the top of its box: a curve then fills
   its box from the baseline to its peak. The rows lose the rest of their
   furniture too — the caption moves OVER the box (see SplitChartStack), the box
   drops its bottom padding and only the BOTTOM row keeps the X ruler. Stacked
   at Gap 0 — with a short Height — they almost touch, which is the whole point: a Y axis
   needs round tick values, and the space above a peak is what separates two
   curves on screen. The four split views (NMR 1D, ssNMR, CD, Flow Cytometry)
   share these readers, so their packing cannot drift apart. */

/** True when the layout asks for NO Y axis (layout.yAxis === false). */
export const splitYAxisHidden = (layout = null) => !normalizeSplitLayout(layout).yAxis;

/** The YAxis props of ONE sub-chart: gone, its gutter included (`width: 0`). */
export const splitYAxisProps = (layout = null, width = 44) =>
  (splitYAxisHidden(layout) ? { hide: true, width: 0 } : { width });

/** …and the XAxis `hide` of ONE row: only the bottom row keeps the ruler. */
export const splitXAxisHidden = (layout = null, i = 0, count = 1) =>
  splitYAxisHidden(layout) && i < count - 1;

/** The margin of ONE sub-chart: the page's own, minus the axes that are gone. */
export const splitChartMargin = (layout = null, base = {}, i = 0, count = 1) => {
  if (!splitYAxisHidden(layout)) return base;
  return { ...base, top: 0, bottom: splitXAxisHidden(layout, i, count) ? 0 : base.bottom };
};

/** The className of ONE sub-chart box: the page's own, unpadded when packing. */
export const splitChartClass = (layout = null, base = 'px-2 pb-1') =>
  (splitYAxisHidden(layout) ? 'px-1' : base);

/**
 * The style of ONE sub-chart box: the LANE HEIGHT when one was asked for (it
 * beats everything — see rowH), the ratio when a shape was asked for, the
 * “own” fixed height (splitOwnHeight) otherwise — never two at once, because a
 * definite `height` silently wins over `aspect-ratio` and a `min-height` would
 * win over the lane height, so the knobs would look ignored.
 */
export const splitChartBoxStyle = (layout = {}, baseHeight = SPLIT_CHART_H) => {
  const { aspect, rowH } = normalizeSplitLayout(layout);
  if (rowH > 0) return { width: '100%', height: rowH };
  if (aspect > 0) return { width: '100%', aspectRatio: String(aspect), minHeight: SPLIT_CHART_MIN_H };
  return { width: '100%', height: splitOwnHeight(baseHeight) };
};

/**
 * The separation between two rows. `undefined` at gap 0, so a stack that never
 * touched the knob renders (and captures) exactly as it always did.
 */
export const splitRowGapStyle = (layout = {}) => {
  const { gap } = normalizeSplitLayout(layout);
  return gap > 0 ? { marginBottom: gap } : undefined;
};

export const SplitChartStack = ({
  id, label, series = [], renderChart, extraHeader = null, className = '',
  // The shape / size / separation / axes of the graphs: `{ aspect, rowH, gap,
  // yAxis }`, see above. Left out (or 0 / 0 / 0 / true) the stack renders
  // exactly as it did before the knobs existed.
  layout = null
}) => {
  const rowGap = splitRowGapStyle(layout);
  // “No Y axis” (layout.yAxis === false): the caption of a row moves over its
  // box and the box itself is unpadded — see splitYAxisHidden.
  const packed = splitYAxisHidden(layout);
  return (
    <div
      data-star-group={id}
      data-star-label={label}
      className={`flex flex-col gap-2 min-w-0 ${className}`}>
      <div className="bg-white rounded border border-slate-200 flex flex-col overflow-hidden max-h-[70vh]">
        <div className="shrink-0 px-2.5 py-1.5 bg-slate-100 border-b border-slate-200 text-[10px] font-black uppercase tracking-wide text-slate-500 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            📚 {label}
            {extraHeader}
          </span>
          <span className="text-slate-400">{series.length} {series.length === 1 ? 'curve' : 'curves'}</span>
        </div>
        <div className="overflow-y-auto custom-scrollbar flex-1">
          {series.map((s, i) => (
            // The SEPARATION between two graphs: the extra space the layout
            // asks for (undefined at 0 → the hairlines alone, as before). A
            // PACKED row (no Y axis) puts its caption OVER the box instead of
            // above it, so no line of text is left between two curves.
            <div key={s.key || i} className="relative border-b border-slate-100 last:border-b-0" style={rowGap}>
              <div className={packed
                ? 'absolute top-0 left-1 z-10 max-w-[70%] text-[9px] font-bold truncate flex items-center gap-1 pointer-events-none'
                : 'px-2.5 pt-1.5 pb-0.5 text-[10px] font-bold truncate flex items-center gap-1.5'}>
                <span className={packed ? 'hidden' : 'w-2 h-2 rounded-full shrink-0'} style={{ backgroundColor: s.color }} />
                <span className={packed ? 'text-slate-400' : 'text-slate-700 truncate'} title={s.label}>{s.label}</span>
              </div>
              {renderChart(s, i)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/* The “Split” (+ optional “Same Y”) checkboxes that live in a page header.
   Kept here so every spectra page shows the very same control. */
export const SplitToggle = ({ on, onToggle, sharedY = null, onToggleSharedY = null, title }) => (
  <>
    <label className="flex items-center gap-1 text-xs font-bold text-slate-700 cursor-pointer"
           title={title || 'Split the overlaid curves into separate graphs, stacked vertically on the right'}>
      <input type="checkbox" checked={on} onChange={onToggle} className="w-3.5 h-3.5 accent-blue-600" /> Split
    </label>
    {on && sharedY !== null && (
      <label className="flex items-center gap-1 text-xs font-bold text-slate-700 cursor-pointer"
             title="Use the same Y scale on every stacked graph">
        <input type="checkbox" checked={sharedY} onChange={onToggleSharedY} className="w-3.5 h-3.5 accent-blue-600" /> Same Y
      </label>
    )}
  </>
);

/* The HEIGHT of a sub-chart, the SHAPE of one and the SEPARATION between the
   stacked graphs: the knobs a page shows next to its Split checkbox, i.e.
   OUTSIDE the tagged card — a control must never end up inside the captured
   figure.

   Kept here so the NMR / ssNMR / CD toolbars cannot drift apart. The value is
   the page's (read with splitLayoutOf, stored with withSplitLayout): the
   component only normalises what it displays.

     Shape  a select of the usual widths + a free “W : 1” field (empty = own).
            A ratio that is not one of the presets — a value coming from an
            older session — stays SELECTABLE, so opening the page never snaps a
            deliberate shape to another one.
     Gap    the vertical separation between two rows, 0 – SPLIT_GAP_MAX px.
     Height the LANE HEIGHT (px) of one stacked graph — the distance between the
            peaks of two curves, so this is the knob that brings the curves
            together until they almost touch. Empty = auto (the Shape knob / the
            box the page sizes itself). SPLIT_ROW_H_MIN – SPLIT_ROW_H_MAX.
     Pack   one click writes the tightest stack: Height SPLIT_PACK_H, Gap 0 and
            no Y axis — the curves almost touching, ready to be tuned.
     No Y   the “No Y axis” switch: the Y axis of every sub-chart is dropped
     axis   (numbers AND gutter), so each curve fills its box and the rows really
            come close — layout.yAxis === false, see splitYAxisHidden. */
export const SplitLayoutControls = ({ layout = null, onChange, className = '', baseHeight = SPLIT_CHART_H }) => {
  const { aspect, rowH, gap, yAxis } = normalizeSplitLayout(layout);
  // The height of the “own” box as the HOST page sizes it (SPLIT_CHART_H for
  // the spectra stacks, the Flow Cytometry split panel's own `height` there),
  // so the knob says what “own” really is — see splitOwnHeight.
  const ownHeight = splitOwnHeight(baseHeight);
  // The number field keeps what was TYPED while it is being typed: a numeric
  // `value` would swallow the decimal point of “2.5” (see FigureStylePanel,
  // which keeps the same draft). It is dropped on blur, i.e. when the field is
  // no longer focused, so the clamped value is what stays on screen.
  const [draft, setDraft] = React.useState(null);
  // …and the same draft for the “Height” field, which is also typed as text.
  const [draftH, setDraftH] = React.useState(null);
  const set = (patch) => { if (onChange) onChange(patch); };
  const shapes = SPLIT_ASPECT_STEPS.includes(aspect)
    ? SPLIT_ASPECT_STEPS
    : [...SPLIT_ASPECT_STEPS, aspect].sort((a, b) => a - b);
  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
      <label className="flex items-center gap-1 text-xs font-bold text-slate-700"
             title={`Width : height of every stacked graph — “own” keeps the ${ownHeight} px box this figure already has`}>
        <span className="text-slate-500">Shape</span>
        <select value={String(aspect)} onChange={(e) => set({ aspect: Number(e.target.value) })}
                className="border border-slate-300 rounded px-1 py-0.5 text-[11px] font-bold bg-white text-slate-700 outline-none focus:border-blue-500">
          <option value="0">own ({ownHeight} px)</option>
          {shapes.map((a) => <option key={a} value={String(a)}>{a} : 1</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1 text-xs font-bold text-slate-700"
             title="Any width : height ratio — empty keeps the compact box">
        <input type="number" step="0.25" min={SPLIT_ASPECT_MIN} max={SPLIT_ASPECT_MAX}
               value={draft === null ? (aspect || '') : draft} placeholder="own"
               onChange={(e) => { setDraft(e.target.value); set({ aspect: e.target.value }); }}
               onBlur={() => setDraft(null)}
               className="w-16 border border-slate-300 rounded px-1 py-0.5 text-[11px] font-bold bg-white text-slate-700 outline-none focus:border-blue-500" />
        <span className="text-slate-500">: 1</span>
      </label>
      <label className="flex items-center gap-1 text-xs font-bold text-slate-700"
             title="Vertical separation between two stacked graphs">
        <span className="text-slate-500">Gap</span>
        <input type="range" min={SPLIT_GAP_MIN} max={SPLIT_GAP_MAX} step={SPLIT_GAP_STEP} value={gap}
               onChange={(e) => set({ gap: Number(e.target.value) })} className="w-20 accent-blue-600" />
        <span className="text-slate-600 tabular-nums">{gap} px</span>
      </label>
      {/* The HEIGHT of one stacked graph — the knob that really brings the
          curves together: a lane runs from its own baseline to its own peak,
          so two curves are exactly one Height apart. Shorter lane ⇒ the curves
          almost touch (splitChartBoxStyle gives it precedence over the Shape
          knob, which cannot go below SPLIT_CHART_MIN_H). */}
      <label className="flex items-center gap-1 text-xs font-bold text-slate-700"
             title={`Height of ONE stacked graph — the peaks of two curves sit exactly that far apart (${SPLIT_ROW_H_MIN}–${SPLIT_ROW_H_MAX} px), so a small value brings the curves together until they almost touch. Empty keeps the box the Shape knob / the page asks for`}>
        <span className="text-slate-500">Height</span>
        <input type="number" step={SPLIT_ROW_H_STEP} min={SPLIT_ROW_H_MIN} max={SPLIT_ROW_H_MAX}
               value={draftH === null ? (rowH || '') : draftH} placeholder="auto"
               onChange={(e) => { setDraftH(e.target.value); set({ rowH: e.target.value }); }}
               onBlur={() => setDraftH(null)}
               className="w-16 border border-slate-300 rounded px-1 py-0.5 text-[11px] font-bold bg-white text-slate-700 outline-none focus:border-blue-500" />
        <span className="text-slate-500">px</span>
      </label>
      {/* One click of “Pack”: the tightest stack this file can draw — one short
          lane per curve, no gap and no Y axis, i.e. the curves almost touching.
          The Height / Gap / Shape fields tune it from there. */}
      <button type="button" onClick={() => set({ yAxis: false, gap: 0, rowH: SPLIT_PACK_H })}
              title={`Squeeze the stack together so the curves almost touch: no Y axis, Gap 0 and one ${SPLIT_PACK_H} px lane per curve — tune it with the Height field`}
              className="text-[11px] font-bold px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-600 hover:border-blue-500 hover:text-blue-600">
        Pack
      </button>
      {/* The switch that lets the curves REALLY pack together: no Y axis (no
          numbers, no gutter), the caption over the box and the X ruler on the
          bottom row only — see splitYAxisHidden. */}
      <label className="flex items-center gap-1 text-xs font-bold text-slate-700 cursor-pointer"
             title="Hide the Y axis of every stacked graph (its numbers and the room they need) and keep the X axis on the bottom row only: each curve fills its box, so the curves really come close — at Gap 0 they touch">
        <input type="checkbox" checked={!yAxis} onChange={(e) => set({ yAxis: !e.target.checked })}
               className="w-3.5 h-3.5 accent-blue-600" />
        <span className="text-slate-500">No Y axis</span>
      </label>
    </div>
  );
};
