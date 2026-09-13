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
   ========================================================================= */
import React from 'react';

// Compact height of a stacked sub-chart (the overlay chart is ~380 px tall).
export const SPLIT_CHART_H = 150;

export const SplitChartStack = ({
  id, label, series = [], renderChart, extraHeader = null, className = ''
}) => (
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
          <div key={s.key || i} className="border-b border-slate-100 last:border-b-0">
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
