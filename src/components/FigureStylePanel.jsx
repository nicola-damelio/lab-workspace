import React from 'react';
import {
  DEFAULT_FIGURE_STYLE, FIGURE_FONT_MIN, FIGURE_FONT_MAX,
  FIGURE_ANGLE_MIN, FIGURE_ANGLE_MAX, figureStyleTag, writeFigureStyle
} from '../utils/figureStyle';
import { useFigureStyleProfile } from './FigureStyleTools';

/* =========================================================================
   src/components/FigureStylePanel.jsx
   Settings → "Figure style": the ONE place where the character sizes shared by
   every chart / spectrum of every experiment are defined.

   The profile is saved in `labFigureStyle` (localStorage, app-wide) and applied
   on an experiment page by the 🎨 button of the ChartStarLayer — "apply the
   style BEFORE the capture", which is the only way a figure captured here and a
   figure captured on another page end up with the same apparent character size.
   ========================================================================= */

const PRESETS = [
  { label: 'Compact', fontSize: 12, simLabelFontSize: 12, tickAngle: 0 },
  { label: 'Standard', fontSize: 16, simLabelFontSize: 16, tickAngle: 0 },
  { label: 'Slide', fontSize: 20, simLabelFontSize: 20, tickAngle: 0 },
  { label: 'Poster', fontSize: 24, simLabelFontSize: 24, tickAngle: 0 }
];

const Row = ({ label, hint, value, min, max, step = 1, unit = 'px', onChange }) => (
  <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
    <div className="flex-1 min-w-0">
      <div className="text-xs font-bold text-slate-700">{label}</div>
      {hint ? <div className="text-[10px] text-slate-500 leading-snug">{hint}</div> : null}
    </div>
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-32 accent-indigo-600"
    />
    <input
      type="number" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-16 border border-slate-300 rounded-md px-2 py-1 text-xs text-right outline-none focus:border-indigo-500"
    />
    <span className="text-[10px] text-slate-400 w-4">{unit}</span>
  </div>
);

export const FigureStylePanel = () => {
  const profile = useFigureStyleProfile();
  const set = (patch) => writeFigureStyle({ ...profile, ...patch });

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-slate-500 leading-relaxed">
        Every chart and spectrum of an experiment is styled with these character sizes, so figures
        captured on different pages line up in one slide / PDF. Apply them on a page with the
        <b> 🎨 Figure style</b> button (bottom-left of every experiment page) <i>before</i> capturing
        the 📷 figures.
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.label} type="button" onClick={() => set(p)}
            className="text-[11px] font-bold px-2.5 py-1 rounded-full border border-slate-300 bg-white text-slate-600 hover:bg-indigo-50 hover:text-indigo-700"
          >
            {p.label} · {p.fontSize}px
          </button>
        ))}
        <button
          type="button" onClick={() => set(DEFAULT_FIGURE_STYLE)}
          className="text-[11px] font-bold px-2.5 py-1 rounded-full border border-slate-300 bg-white text-slate-500 hover:bg-slate-100"
        >
          ↺ Reset
        </button>
        <span className="text-[10px] font-mono text-slate-400">tag: {figureStyleTag(profile)}</span>
      </div>

      <Row
        label="Axis & tick characters"
        hint="Ticks, axis titles, legends of every chart (all families / modules)."
        value={profile.fontSize} min={FIGURE_FONT_MIN} max={FIGURE_FONT_MAX}
        onChange={(v) => set({ fontSize: v })}
      />
      <Row
        label="Peak / data labels (spectra)"
        hint="Simulated spectra assignments, 1D / 2D peak labels — wherever an x axis exists."
        value={profile.simLabelFontSize} min={FIGURE_FONT_MIN} max={FIGURE_FONT_MAX}
        onChange={(v) => set({ simLabelFontSize: v })}
      />
      <Row
        label="X label rotation (spectra)"
        hint="Rotation of the x tick labels of the spectra / long category names. 0 = browser default."
        value={profile.tickAngle} min={FIGURE_ANGLE_MIN} max={FIGURE_ANGLE_MAX}
        unit="°"
        onChange={(v) => set({ tickAngle: v })}
      />

      <label className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 cursor-pointer">
        <input
          type="checkbox" checked={profile.applyOnOpen}
          onChange={(e) => set({ applyOnOpen: e.target.checked })}
          className="w-3.5 h-3.5 accent-indigo-600"
        />
        <span className="text-xs text-slate-600">
          Apply automatically when an experiment page is opened
          <span className="text-[10px] text-slate-400"> (charts already on the page are rewritten; the 🎨 button does it on demand)</span>
        </span>
      </label>

      <div className="bg-white border border-slate-200 rounded-lg p-3">
        <div className="text-[10px] font-bold text-slate-500 mb-2">Preview — what the figures will look like</div>
        <div className="flex items-end gap-4 h-24 border-l border-b border-slate-300 pl-2 pb-1 relative">
          <span className="absolute left-1 top-1 text-slate-500" style={{ fontSize: profile.fontSize }}>Intensity</span>
          <span className="absolute -bottom-1 right-1 text-slate-500" style={{ fontSize: profile.fontSize }}>250 nm</span>
          <span className="absolute left-10 top-9 text-red-600 font-semibold" style={{ fontSize: profile.simLabelFontSize }}>3A Hα</span>
          <span
            className="absolute right-2 top-1 text-slate-500 origin-top-left"
            style={{ fontSize: profile.fontSize, transform: `rotate(${profile.tickAngle}deg)` }}
          >
            rotated x label
          </span>
        </div>
      </div>
    </div>
  );
};

export default FigureStylePanel;
