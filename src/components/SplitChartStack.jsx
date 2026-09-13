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

   ── THE LAYOUT OF THE STACK: { aspect, gap } ─────────────────────────────
   Every sub-chart used to be a FIXED 150 px box with no space between the
   rows — fine for two conditions, cramped for ten (the stack has to be
   scrolled, and a graph cannot be made flatter than its box allows). The page
   can now hand the stack a `layout`:
     • aspect — the WIDTH : HEIGHT ratio of ONE sub-chart (0 = the historical
       fixed 150 px box). It is applied as `aspect-ratio`, so the graphs grow
       and shrink with the width the stack was given. A definite `height` — or
       a `max-height` smaller than the ratio needs — CANCELS `aspect-ratio` in
       the browser, which is why splitChartBoxStyle returns ONE of the two and
       never both (the same rule chartRatioBoxStyle follows in chartStyle.js).
     • gap — the VERTICAL SEPARATION (px) inserted between two rows (0 = the
       hairlines of the historical layout, untouched).
   Both are clamped by normalizeSplitLayout, so a stored / hand-edited value
   can neither break the stack nor shrink a graph into a 4 px line.
   <SplitLayoutControls> (bottom of this file) is the pair of knobs the pages
   show in their toolbar — deliberately OUTSIDE the tagged card, so a control
   can never end up in the captured figure.
   ========================================================================= */
import React from 'react';

// Compact height of a stacked sub-chart (the overlay chart is ~380 px tall).
// It stays the height of a sub-chart until the page asks for a RATIO
// (layout.aspect > 0) — see splitChartBoxStyle.
export const SPLIT_CHART_H = 150;

// Floor of a RATIO-sized box: an 8 : 1 graph in a narrow column would be
// shorter than its own axis numbers. A definite `min-height` is allowed next
// to `aspect-ratio` (only a definite HEIGHT cancels it), so the floor never
// disables the shape — it only stops it at a readable minimum.
export const SPLIT_CHART_MIN_H = 72;

export const SPLIT_ASPECT_MIN = 0.5;
export const SPLIT_ASPECT_MAX = 8;
// The one-click shapes of <SplitLayoutControls>; 0 / “own” is the 150 px box.
export const SPLIT_ASPECT_STEPS = [1, 1.25, 1.5, 2, 2.5, 3, 4, 6];
export const SPLIT_GAP_MIN = 0;
export const SPLIT_GAP_MAX = 48;
export const SPLIT_GAP_STEP = 2;

/** A number, or 0 when the value is missing / empty / not a number. */
const numberOf = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** A clamped `{ aspect, gap }` — the only reader of a stored / typed value. */
export const normalizeSplitLayout = (layout = {}) => {
  const src = layout || {};
  const aspect = numberOf(src.aspect);
  return {
    aspect: aspect > 0 ? clamp(aspect, SPLIT_ASPECT_MIN, SPLIT_ASPECT_MAX) : 0,
    gap: clamp(numberOf(src.gap), SPLIT_GAP_MIN, SPLIT_GAP_MAX)
  };
};

/** The layout stored on an experiment (missing / edited values are clamped). */
export const splitLayoutOf = (exp) => normalizeSplitLayout(exp && exp.splitLayout);

/** The value to store for a layout change — `{ aspect, gap }`, already clamped. */
export const withSplitLayout = (exp, patch) =>
  normalizeSplitLayout({ ...splitLayoutOf(exp), ...(patch || {}) });

/**
 * The style of ONE sub-chart box: the ratio when one was asked for, the
 * historical fixed height otherwise — never both, because a definite `height`
 * silently wins over `aspect-ratio` and the shape knob would look ignored.
 */
export const splitChartBoxStyle = (layout = {}) => {
  const { aspect } = normalizeSplitLayout(layout);
  if (aspect > 0) return { width: '100%', aspectRatio: String(aspect), minHeight: SPLIT_CHART_MIN_H };
  return { width: '100%', height: SPLIT_CHART_H };
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
  // The shape / separation of the graphs: `{ aspect, gap }`, see above. Left
  // out (or 0 / 0) the stack renders exactly as it did before the knob existed.
  layout = null
}) => {
  const rowGap = splitRowGapStyle(layout);
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
            // asks for (undefined at 0 → the hairlines alone, as before).
            <div key={s.key || i} className="border-b border-slate-100 last:border-b-0" style={rowGap}>
              <div className="px-2.5 pt-1.5 pb-0.5 text-[10px] font-bold truncate flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-slate-700 truncate" title={s.label}>{s.label}</span>
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

/* The SHAPE of a sub-chart + the SEPARATION between the stacked graphs: the two
   knobs a page shows next to its Split checkbox, i.e. OUTSIDE the tagged card —
   a control must never end up inside the captured figure.

   Kept here so the NMR / ssNMR / CD toolbars cannot drift apart. The value is
   the page's (read with splitLayoutOf, stored with withSplitLayout): the
   component only normalises what it displays.

     Shape  a select of the usual widths + a free “W : 1” field (empty = own).
            A ratio that is not one of the presets — a value coming from an
            older session — stays SELECTABLE, so opening the page never snaps a
            deliberate shape to another one.
     Gap    the vertical separation between two rows, 0 – SPLIT_GAP_MAX px. */
export const SplitLayoutControls = ({ layout = null, onChange, className = '' }) => {
  const { aspect, gap } = normalizeSplitLayout(layout);
  // The number field keeps what was TYPED while it is being typed: a numeric
  // `value` would swallow the decimal point of “2.5” (see FigureStylePanel,
  // which keeps the same draft). It is dropped on blur, i.e. when the field is
  // no longer focused, so the clamped value is what stays on screen.
  const [draft, setDraft] = React.useState(null);
  const set = (patch) => { if (onChange) onChange(patch); };
  const shapes = SPLIT_ASPECT_STEPS.includes(aspect)
    ? SPLIT_ASPECT_STEPS
    : [...SPLIT_ASPECT_STEPS, aspect].sort((a, b) => a - b);
  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
      <label className="flex items-center gap-1 text-xs font-bold text-slate-700"
             title="Width : height of every stacked graph — “own” keeps the compact 150 px box">
        <span className="text-slate-500">Shape</span>
        <select value={String(aspect)} onChange={(e) => set({ aspect: Number(e.target.value) })}
                className="border border-slate-300 rounded px-1 py-0.5 text-[11px] font-bold bg-white text-slate-700 outline-none focus:border-blue-500">
          <option value="0">own (150 px)</option>
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
    </div>
  );
};
