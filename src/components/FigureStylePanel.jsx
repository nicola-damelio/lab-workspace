import React from 'react';
import {
  DEFAULT_FIGURE_STYLE, FIGURE_FONT_MIN, FIGURE_FONT_MAX,
  FIGURE_FONT_STEPS, FIGURE_ANGLE_MIN, FIGURE_ANGLE_MAX,
  FIGURE_ASPECT_MIN, FIGURE_ASPECT_MAX, FIGURE_ASPECT_STEPS,
  FIGURE_DECIMALS_STEPS,
  figureStyleTag, writeFigureStyle
} from '../utils/figureStyle';
import { FIGURE_FONT_CHOICES, DEFAULT_CHART_ASPECT_WIDE } from '../utils/chartStyle';
import { useFigureStyleProfile } from './FigureStyleTools';

/* =========================================================================
   src/components/FigureStylePanel.jsx
   Settings → "Figure style": the ONE place where the font and the character
   sizes shared by every chart / spectrum of every experiment are defined.

   ONE SIZE PER ELEMENT — a printed figure never uses the same size for the
   axis numbers, the axis titles and the legend:
     • axis numbers (tick labels)   fontSize
     • axis titles (x / y names)    axisTitleFontSize
     • legends / series names       legendFontSize
     • peak / data labels           simLabelFontSize
   …plus the FONT FAMILY every one of them is drawn with.

   And the two commands a figure of a paper always needs next to the sizes:
     • the axis titles in BOLD / ITALIC   (axisTitleBold, axisTitleItalic)
     • the axis numbers in EXPONENTIAL notation and with a fixed NUMBER OF
       DECIMALS                            (tickSci, tickDecimals)
   They are the same commands as the 🎨 “Graphical Parameters” panel of a single
   chart (X/Y label style, decimals, scientific notation) — set once here and
   pushed into every chart by the 🎨 button of the experiment page.

   The plot-box RATIO (x-axis length : y-axis length) is the fifth knob: 0 = each
   chart keeps its own ratio, anything else is imposed on every figure of the
   page — so the captured figures have the same SHAPE, not only the same
   characters.

   The profile is saved in `labFigureStyle` (localStorage, app-wide) and applied
   on an experiment page by the 🎨 button of the ChartStarLayer — "apply the
   style BEFORE the capture", which is the only way a figure captured here and a
   figure captured on another page end up with the same characters.
   ========================================================================= */

// Presets set the four sizes at once. The POSTER ones are the values a figure
// printed at A0 needs (36 / 40 px) — the ticks stay readable when the figure is
// looked at from a metre away — and the last one uses the UPPER BOUND of the
// profile (160 px, see FIGURE_FONT_MAX): a figure that is captured oversized and
// then scaled down to its place in a slide / PDF panel.
const PRESETS = [
  { label: 'Compact', fontSize: 12, axisTitleFontSize: 13, legendFontSize: 12, simLabelFontSize: 12, tickAngle: 0 },
  { label: 'Standard', fontSize: 16, axisTitleFontSize: 18, legendFontSize: 16, simLabelFontSize: 16, tickAngle: 0 },
  { label: 'Slide', fontSize: 20, axisTitleFontSize: 22, legendFontSize: 20, simLabelFontSize: 20, tickAngle: 0 },
  { label: 'Poster', fontSize: 28, axisTitleFontSize: 32, legendFontSize: 28, simLabelFontSize: 28, tickAngle: 0 },
  { label: 'Poster A0', fontSize: 36, axisTitleFontSize: 40, legendFontSize: 36, simLabelFontSize: 36, tickAngle: 0 },
  { label: 'Poster A0 XL', fontSize: 40, axisTitleFontSize: 40, legendFontSize: 36, simLabelFontSize: 36, tickAngle: 0 },
  { label: 'Poster A0 XXL', fontSize: 160, axisTitleFontSize: 160, legendFontSize: 160, simLabelFontSize: 160, tickAngle: 0 }
];

// One profile row: label + hint, a slider, a number box and the one-click
// values. The number box is edited through a local DRAFT so a DECIMAL is
// typeable ("1.75" is not cut down to "1" right after the dot) and an empty box
// no longer resets the value in the middle of the typing: the profile is
// written as soon as the text is a complete number, and the box falls back to
// the value of the profile as soon as it loses the focus.
const Row = ({ label, hint, value, min, max, step = 1, unit = 'px', onChange, quick = null, quickLabel = null }) => {
  const [draft, setDraft] = React.useState(null);
  React.useEffect(() => { setDraft(null); }, [value]);
  const type = (text) => {
    setDraft(text);
    const t = text.trim();
    if (!t || /[.,]$/.test(t)) return;     // "" / "1." — the number is not complete yet
    const n = Number(t);
    if (Number.isFinite(n)) onChange(n);
  };
  return (
  <div className="flex flex-col gap-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
    <div className="flex items-center gap-3">
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
        type="number" min={min} max={max} step={step}
        value={draft == null ? value : draft}
        onChange={(e) => type(e.target.value)}
        onBlur={() => setDraft(null)}
        className="w-16 border border-slate-300 rounded-md px-2 py-1 text-xs text-right outline-none focus:border-indigo-500"
      />
      <span className="text-[10px] text-slate-400 w-4">{unit}</span>
    </div>
    {quick && quick.length ? (
      <div className="flex flex-wrap items-center gap-1 pl-1">
        {quickLabel ? <span className="text-[9px] font-bold text-slate-400 uppercase mr-0.5">{quickLabel}</span> : null}
        {quick.map((v) => (
          <button
            key={v} type="button" onClick={() => onChange(v)}
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${Number(value) === v
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'bg-white border-slate-300 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700'}`}
          >
            {v}
          </button>
        ))}
      </div>
    ) : null}
  </div>
  );
};


// The axis-number sample of the preview: the decimals / exponential commands
// applied to one value, exactly the way cfgTickFormatter does it on a real axis
// ('' = automatic → the plain number, as the charts render it today).
const previewTick = (v, profile) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (profile.tickSci) return n.toExponential(profile.tickDecimals === '' ? 2 : Number(profile.tickDecimals));
  if (profile.tickDecimals !== '') return n.toFixed(Number(profile.tickDecimals));
  return String(n);
};

export const FigureStylePanel = () => {
  const profile = useFigureStyleProfile();
  const set = (patch) => writeFigureStyle({ ...profile, ...patch });
  const family = profile.fontFamily;

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
            title={`Ticks ${p.fontSize} px · titles ${p.axisTitleFontSize} px · legends ${p.legendFontSize} px · data labels ${p.simLabelFontSize} px`}
            className="text-[11px] font-bold px-2.5 py-1 rounded-full border border-slate-300 bg-white text-slate-600 hover:bg-indigo-50 hover:text-indigo-700"
          >
            {p.label} · {p.fontSize}/{p.axisTitleFontSize}
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

      {/* ---- font family -------------------------------------------------- */}
      <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-slate-700">Font family</div>
          <div className="text-[10px] text-slate-500 leading-snug">
            Applied to every axis number, axis title, legend and data label of every chart (recharts AND
            Chart.js figures). “App default” = the font the charts use today.
          </div>
        </div>
        <select
          value={family}
          onChange={(e) => set({ fontFamily: e.target.value })}
          className="w-56 border border-slate-300 rounded-md px-2 py-1 text-xs bg-white outline-none focus:border-indigo-500"
        >
          {FIGURE_FONT_CHOICES.map((f) => (
            <option key={f.value || 'default'} value={f.value}>{f.label}</option>
          ))}
          {family && !FIGURE_FONT_CHOICES.some((f) => f.value === family) ? (
            <option value={family}>{family}</option>
          ) : null}
        </select>
      </div>
      {family ? (
        <input
          type="text" value={family} onChange={(e) => set({ fontFamily: e.target.value })}
          placeholder='Any CSS font stack, e.g. "Helvetica Neue", Arial, sans-serif'
          className="border border-slate-300 rounded-md px-2 py-1 text-[11px] font-mono outline-none focus:border-indigo-500"
        />
      ) : null}

      {/* ---- one character size per element ------------------------------- */}
      <Row
        label="1 · Axis numbers (tick labels)"
        hint="The numbers along the axes — the size every page has always used (cfg.fontSize). Up to 160 px: oversized characters stay readable when the captured figure is scaled down in the slide / PDF panel."
        value={profile.fontSize} min={FIGURE_FONT_MIN} max={FIGURE_FONT_MAX}
        quick={FIGURE_FONT_STEPS} quickLabel="px"
        onChange={(v) => set({ fontSize: v })}
      />
      <Row
        label="2 · Axis titles (x / y names)"
        hint="“Wavelength (nm)”, “Intensity (a.u.)” — printed bigger than the numbers."
        value={profile.axisTitleFontSize} min={FIGURE_FONT_MIN} max={FIGURE_FONT_MAX}
        quick={FIGURE_FONT_STEPS} quickLabel="px"
        onChange={(v) => set({ axisTitleFontSize: v })}
      />
      <Row
        label="3 · Legends / series names"
        hint="The key of a multi-series graph (conditions, fits, simulated vs experimental)."
        value={profile.legendFontSize} min={FIGURE_FONT_MIN} max={FIGURE_FONT_MAX}
        quick={FIGURE_FONT_STEPS} quickLabel="px"
        onChange={(v) => set({ legendFontSize: v })}
      />
      <Row
        label="4 · Peak / data labels (spectra)"
        hint="Simulated spectra assignments, 1D / 2D peak labels — wherever an x axis exists."
        value={profile.simLabelFontSize} min={FIGURE_FONT_MIN} max={FIGURE_FONT_MAX}
        quick={FIGURE_FONT_STEPS} quickLabel="px"
        onChange={(v) => set({ simLabelFontSize: v })}
      />
      {/* ---- axis titles & axis numbers ----------------------------------- */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-col gap-3">
        <div className="text-[10px] font-black text-slate-400 uppercase">Axis titles &amp; axis numbers — style and format</div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer">
            <input
              type="checkbox" checked={profile.axisTitleBold}
              onChange={(e) => set({ axisTitleBold: e.target.checked })}
              className="w-3.5 h-3.5 accent-indigo-600"
            />
            Axis titles in <b>bold</b>
          </label>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer">
            <input
              type="checkbox" checked={profile.axisTitleItalic}
              onChange={(e) => set({ axisTitleItalic: e.target.checked })}
              className="w-3.5 h-3.5 accent-indigo-600"
            />
            Axis titles in <i>italic</i>
          </label>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer">
            <input
              type="checkbox" checked={profile.tickSci}
              onChange={(e) => set({ tickSci: e.target.checked })}
              className="w-3.5 h-3.5 accent-indigo-600"
            />
            Axis numbers in exponential notation (1.23 × 10⁴)
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-600">Axis numbers — number of decimals</span>
          {FIGURE_DECIMALS_STEPS.map((v) => (
            <button
              key={v === '' ? 'auto' : String(v)}
              type="button"
              onClick={() => set({ tickDecimals: v })}
              title={v === '' ? 'Automatic — every chart keeps the format it shows today' : `Always ${v} decimal${v === 1 ? '' : 's'}`}
              className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                String(profile.tickDecimals) === String(v)
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-slate-600 border-slate-300 hover:bg-indigo-50'
              }`}
            >
              {v === '' ? 'Auto' : v}
            </button>
          ))}
          <span className="text-[10px] font-mono text-slate-400">
            {previewTick(12500, profile)}
          </span>
        </div>

        <div className="text-[10px] text-slate-500 leading-snug">
          Same commands as the 🎨 <b>Graphical Parameters</b> panel of a single chart (X / Y label style,
          decimals, scientific notation): set them once here and press 🎨 on the experiment page to push
          them into every chart and spectrum — so the axis titles and the axis numbers of every captured
          figure are written the same way. “Auto” leaves the format of each chart exactly as it is today.
        </div>
      </div>

      <Row
        label="X label rotation (spectra)"
        hint="Rotation of the x tick labels of the spectra / long category names. 0 = browser default."
        value={profile.tickAngle} min={FIGURE_ANGLE_MIN} max={FIGURE_ANGLE_MAX}
        unit="°"
        quick={[0, -30, -45, -60, 30, 45, 60, 90]} quickLabel="°"
        onChange={(v) => set({ tickAngle: v })}
      />
      <Row
        label="Aspect ratio — x axis length : y axis length"
        hint="The shape of the plot box every figure of the page is drawn with: 1 = square, 1.8 = the wide spectrum / chromatogram box, 3 = a flat strip. 0 = every chart keeps the ratio of its own 🎨 Graphical Parameters panel (the 2D spectra keep their own square ratio)."
        value={profile.aspect} min={FIGURE_ASPECT_MIN} max={FIGURE_ASPECT_MAX} step={0.05}
        unit=""
        quick={FIGURE_ASPECT_STEPS} quickLabel="x:y"
        onChange={(v) => set({ aspect: v })}
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
        <div className="flex items-end gap-4 h-32 border-l border-b border-slate-300 pl-2 pb-1 relative overflow-hidden"
          style={{ fontFamily: family || undefined }}>
          <span className="absolute left-1 top-1 text-slate-500" style={{
            fontSize: profile.axisTitleFontSize,
            fontWeight: profile.axisTitleBold ? 'bold' : 'normal',
            fontStyle: profile.axisTitleItalic ? 'italic' : 'normal'
          }}>
            Intensity (a.u.)
          </span>
          <span className="absolute -bottom-1 right-1 text-slate-500" style={{ fontSize: profile.fontSize }}>
            {previewTick(12500, profile)} ppm
          </span>
          <span className="absolute left-1 top-12 text-slate-500" style={{ fontSize: profile.legendFontSize }}>
            ▲ 3 conditions ▼
          </span>
          <span className="absolute left-32 top-20 text-red-600 font-semibold" style={{ fontSize: profile.simLabelFontSize }}>
            3A Hα
          </span>
          <span
            className="absolute right-2 top-1 text-slate-500 origin-top-left"
            style={{ fontSize: profile.fontSize, transform: `rotate(${profile.tickAngle}deg)` }}
          >
            rotated x label
          </span>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[10px] text-slate-500">Plot box</span>
          <div className="h-8 border border-slate-400 bg-indigo-100/70"
            style={{ aspectRatio: String(profile.aspect > 0 ? profile.aspect : DEFAULT_CHART_ASPECT_WIDE) }} />
          <span className="text-[10px] font-bold text-slate-600">
            {profile.aspect > 0
              ? `${profile.aspect} : 1 (x : y)`
              : `each chart keeps its own (e.g. ${DEFAULT_CHART_ASPECT_WIDE} : 1)`}
          </span>
        </div>
      </div>
    </div>
  );
};

export default FigureStylePanel;
