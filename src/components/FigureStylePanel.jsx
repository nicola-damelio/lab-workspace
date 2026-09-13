import React from 'react';
import {
  DEFAULT_FIGURE_STYLE, FIGURE_FONT_MIN, FIGURE_FONT_MAX,
  FIGURE_FONT_STEPS, FIGURE_ANGLE_MIN, FIGURE_ANGLE_MAX,
  FIGURE_ASPECT_MIN, FIGURE_ASPECT_MAX, FIGURE_ASPECT_STEPS,
  FIGURE_DECIMALS_STEPS, FIGURE_KINDS, FIGURE_KIND_FIELDS, FIGURE_KIND_LABELS,
  FIGURE_AXIS_BASES, FIGURE_AXIS_BASE_LABELS, FIGURE_AXIS_HINTS,
  FIGURE_LINE_MIN, FIGURE_LINE_MAX, FIGURE_LINE_STEPS, normalizeFigureColor,
  FIGURE_STYLE_PRESET_MAX,
  figureAspectSummary, figureAxisFormatField, figureAxisFormatSummary,
  figureStyleTag, writeFigureStyle,
  figureStyleConfigForStyle, figureStyleConfigName, figureStyleConfigSummary,
  saveFigureStyleConfig, renameFigureStyleConfig, deleteFigureStyleConfig,
  applyFigureStyleConfig, exportFigureStyleConfigs, importFigureStyleConfigs
} from '../utils/figureStyle';
import { FIGURE_FONT_CHOICES, DEFAULT_CHART_ASPECT_WIDE } from '../utils/chartStyle';
import { useFigureStyleProfile, useFigureStyleConfigs } from './FigureStyleTools';

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

   And the commands a figure of a paper always needs next to the sizes:
     • the axis titles in BOLD / ITALIC   (axisTitleBold, axisTitleItalic)
     • the NUMBER OF DECIMALS of the axis numbers (tickDecimals — shared by the
       X and the Y axis of every chart)
     • the EXPONENTIAL notation of the axis numbers and the LOGARITHMIC scale of
       an axis — PER AXIS (X / Y) and PER KIND of figure: the sixteen knobs of
       FIGURE_AXIS_FORMAT_FIELDS (`xSci` / `ySci` / `xLog` / `yLog` for the
       graphs, plus the …Spectra / …Atom / …Residue variants), each one shown
       as its own checkbox under the kind of figure it belongs to.
   They are the same commands as the 🎨 “Graphical Parameters” panel of a single
   chart (X/Y label style, decimals, scientific notation, Log X / Log Y axis) —
   set once here and pushed into every chart by the 🎨 button of the experiment
   page.

   The plot-box RATIO (x-axis length : y-axis length) is the fifth knob — and it
   comes in FOUR flavours, one per KIND of figure (see FIGURE_KINDS):
     • spectra (NMR, CD, ssNMR)   • per-atom plots
     • per-residue plots          • graphs (everything else)
   Each one defaults to 0 = every chart of that kind keeps its own ratio, and
   anything else is imposed on every figure of that kind of a page — so the
   captured figures have the same SHAPE, not only the same characters.

   The profile is saved in `labFigureStyle` (localStorage, app-wide) and applied
   on an experiment page by the 🎨 button of the ChartStarLayer — "apply the
   style BEFORE the capture", which is the only way a figure captured here and a
   figure captured on another page end up with the same characters.

   ONE profile at a time is not enough, though: a set of figures often needs
   characters far bigger than the ones used to read the app. The box at the top
   therefore SAVES named configurations (`labFigureStyles`, see
   saveFigureStyleConfig), each one a COMPLETE style, so the “Figure — A4” style
   and the everyday one live side by side and switching is one click.
   ========================================================================= */

// One hint per KIND of figure: what the ratio lands on, and what 0 means.
const FIGURE_ASPECT_HINTS = {
  spectra: 'The NMR (imported 1D and simulated 1D / 2D), CD and ssNMR spectra: 1.8 = the wide spectrum box, 3 = a flat strip. 0 = every spectrum keeps the ratio of its own 🎨 Graphical Parameters panel (the 2D spectra keep their own square ratio).',
  atom: 'The per-atom plots (the NMR and MD “Per-Atom” chart panels): one bar group per atom needs a wider box. 0 = they keep the ratio of their own 🎨 panel.',
  residue: 'The per-residue plots (the MD per-residue occupancy bars and the other plots whose x axis is the residue number). 0 = they keep the ratio of their own 🎨 panel.',
  graph: 'Every other figure — time series, bar charts, scatter plots, chromatograms, dose-response curves… 0 = each chart keeps the ratio of its own 🎨 panel. This is the historical “aspect ratio” knob of the profile.'
};

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


/* One saved configuration: its name, what it changes and the four commands of
   the list (Use · ⤓ update · ✎ rename · 🗑 delete). The renaming happens IN
   PLACE, with a small draft — never through a browser prompt dialog. */
const ROW_BTN = 'text-[10px] font-bold px-1.5 py-0.5 rounded border border-slate-300 bg-white text-slate-600 hover:bg-indigo-50 hover:text-indigo-700';

/* One COLOUR of the profile (the axis numbers, the axis titles): a swatch, the
   hex value, and the “each chart's own” reset. The swatch always shows a colour
   — the historical #64748b when the profile names none — so it is obvious what
   the charts draw until this knob is set. */
const ColourRow = ({ label, hint, value, onChange }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-xs font-bold text-slate-600">{label}</span>
    <span className="text-[10px] text-slate-400">{hint}</span>
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value || '#64748b'}
        onChange={(e) => onChange(normalizeFigureColor(e.target.value))}
        className="w-9 h-6 rounded cursor-pointer border border-slate-300 bg-white p-0"
      />
      <span className="text-[10px] font-mono text-slate-500">{value || 'each chart’s own (#64748b)'}</span>
      {value ? (
        <button type="button" onClick={() => onChange('')} className={ROW_BTN}
          title="Let every chart keep the colour it draws today">⟲ own</button>
      ) : null}
    </div>
  </div>
);

const ConfigRow = ({ config, applied, onUse, onUpdate, onRename, onDelete }) => {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(config.name);
  React.useEffect(() => { setDraft(config.name); setEditing(false); }, [config.id, config.name]);
  const commit = () => { onRename(config.id, draft); setEditing(false); };
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${
      applied ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
      {editing ? (
        <>
          <input
            type="text" autoFocus value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') { setDraft(config.name); setEditing(false); }
            }}
            className="flex-1 min-w-0 border border-slate-300 rounded-md px-2 py-0.5 text-[11px] outline-none focus:border-indigo-500"
          />
          <button type="button" onClick={commit} title="Rename" className={ROW_BTN}>✔</button>
          <button type="button" onClick={() => { setDraft(config.name); setEditing(false); }} title="Cancel" className={ROW_BTN}>✕</button>
        </>
      ) : (
        <>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-bold text-slate-700 truncate">
              {config.name}{applied ? <span className="text-emerald-600"> ✓ applied</span> : null}
            </div>
            <div className="text-[10px] text-slate-500 truncate">{figureStyleConfigSummary(config.style)}</div>
            <div className="text-[10px] font-mono text-slate-400 truncate">{figureStyleTag(config.style)}</div>
          </div>
          <button
            type="button" onClick={() => onUse(config.id)}
            title="Make this configuration the profile of the whole app"
            className="text-[10px] font-bold px-2 py-0.5 rounded border border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-50"
          >
            Use
          </button>
          <button type="button" onClick={() => onUpdate(config.id)} className={ROW_BTN}
            title="Save the settings currently set above over this configuration">⤓</button>
          <button type="button" onClick={() => setEditing(true)} className={ROW_BTN} title="Rename">✎</button>
          <button type="button" onClick={() => onDelete(config.id)} className={ROW_BTN} title="Delete">🗑</button>
        </>
      )}
    </div>
  );
};

// The axis-number sample of the preview: the decimals / exponential commands
// applied to one value, exactly the way cfgTickFormatter does it on a real axis
// ('' = automatic → the plain number, as the charts render it today). The
// exponential switch shown is the one of the X axis of the GRAPHS (the
// historical `tickSci` knob, now xSci — see FIGURE_AXIS_FORMAT_FIELDS).
const previewTick = (v, profile) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (profile.xSci) return n.toExponential(profile.tickDecimals === '' ? 2 : Number(profile.tickDecimals));
  if (profile.tickDecimals !== '') return n.toFixed(Number(profile.tickDecimals));
  return String(n);
};

export const FigureStylePanel = () => {
  const profile = useFigureStyleProfile();
  const set = (patch) => writeFigureStyle({ ...profile, ...patch });
  const family = profile.fontFamily;

  // ---- the saved configurations (see utils/figureStyle) --------------------
  const configs = useFigureStyleConfigs();
  const applied = figureStyleConfigForStyle(profile);
  const [configName, setConfigName] = React.useState('');
  const [notice, setNotice] = React.useState(null);
  const [backup, setBackup] = React.useState('');

  const saveConfig = () => {
    const res = saveFigureStyleConfig(configName, profile);
    setConfigName('');
    setNotice(`💾 “${res.config.name}” ${res.replaced ? 'updated' : 'saved'}${res.dropped
      ? ` — the oldest ${res.dropped} configuration was dropped (the list keeps ${FIGURE_STYLE_PRESET_MAX})` : ''}`);
  };
  const useConfig = (id) => {
    const res = applyFigureStyleConfig(id);
    setNotice(res
      ? `↔ “${res.config.name}” is now the profile (${res.tag}) — press 🎨 Figure style on an experiment page to push it into its figures`
      : '↔ That configuration no longer exists');
  };
  const updateConfig = (id) => {
    const row = configs.find((c) => c.id === id);
    const res = row ? saveFigureStyleConfig(row.name, profile) : null;
    setNotice(res ? `⤓ “${res.config.name}” updated with the settings above` : '⤓ That configuration no longer exists');
  };
  const renameConfig = (id, name) => {
    const renamed = renameFigureStyleConfig(id, name);
    setNotice(renamed
      ? `✎ Renamed to “${renamed.name}”`
      : '✎ Nothing renamed — the name is empty, or another configuration already uses it');
  };
  const deleteConfig = (id) => {
    const gone = deleteFigureStyleConfig(id);
    setNotice(gone ? `🗑 “${gone.name}” deleted` : '🗑 That configuration no longer exists');
  };
  const showBackup = () => { const text = exportFigureStyleConfigs(); setBackup(text); return text; };
  const copyBackup = () => {
    const text = showBackup();
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(text);
      setNotice('⧉ The backup is in the clipboard');
    } catch { setNotice('⧉ Copy the text of the box below — the clipboard is unavailable'); }
  };
  const doImport = () => {
    const res = importFigureStyleConfigs(backup);
    setNotice(res.error
      ? '⇩ That is not a configuration backup (invalid JSON) — nothing was changed'
      : `⇩ Imported ${res.added} configuration${res.added === 1 ? '' : 's'}`
        + `${res.replaced ? `, ${res.replaced} replaced` : ''}${res.skipped ? `, ${res.skipped} skipped (no profile in them)` : ''}`);
  };

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

      {/* ---- the saved configurations ------------------------------------- */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-bold text-slate-700">💾 My saved configurations</div>
          <span className="text-[10px] text-slate-400">{configs.length} / {FIGURE_STYLE_PRESET_MAX} saved</span>
        </div>
        <div className="text-[10px] text-slate-500 leading-snug">
          A configuration is a COMPLETE style — the four character sizes, the axis-title style, the decimals,
          the per-axis exponential / log switches and the four plot-box ratios. Save the one a set of figures
          needs (“Figure — A4”), keep the everyday one, and switch between them in one click: <b>Use</b> makes
          a configuration the profile of the whole app — the 🎨 Figure style button of an experiment page then
          pushes it into the figures of that page. Saving under the name of an existing configuration UPDATES it.
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text" value={configName}
            onChange={(e) => setConfigName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveConfig(); }}
            placeholder={`Name — default: ${figureStyleConfigName(profile)}`}
            className="flex-1 min-w-[12rem] border border-slate-300 rounded-md px-2 py-1 text-[11px] outline-none focus:border-indigo-500"
          />
          <button
            type="button" onClick={saveConfig}
            className="text-[11px] font-bold px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            💾 Save the current settings
          </button>
          {applied ? (
            <button
              type="button" onClick={() => updateConfig(applied.id)}
              title={`Save the settings above over “${applied.name}”`}
              className="text-[11px] font-bold px-2.5 py-1 rounded-md bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-50"
            >
              ⤓ Update “{applied.name}”
            </button>
          ) : null}
        </div>
        {notice ? <div className="text-[10px] font-bold text-slate-500 leading-snug">{notice}</div> : null}
        {configs.length ? (
          <div className="flex flex-col gap-1 max-h-72 overflow-y-auto pr-0.5">
            {configs.map((c) => (
              <ConfigRow
                key={c.id} config={c} applied={!!applied && applied.id === c.id}
                onUse={useConfig} onUpdate={updateConfig} onRename={renameConfig} onDelete={deleteConfig}
              />
            ))}
          </div>
        ) : (
          <div className="text-[10px] italic text-slate-400 leading-snug">
            Nothing saved yet — put the sizes, the axis switches and the ratios above at the values a set of
            figures needs, type a name and press 💾. You can then come back to your everyday settings in one
            click, and back to the figure style just as fast.
          </div>
        )}
        <details className="text-[10px] text-slate-500">
          <summary className="cursor-pointer font-bold">⇄ Backup / move these configurations to another browser</summary>
          <div className="mt-2 flex flex-col gap-1">
            <textarea
              value={backup} onChange={(e) => setBackup(e.target.value)} rows={3}
              placeholder="[ { name, style, savedAt } … ] — paste a backup here and press ⇩ Import"
              className="w-full border border-slate-300 rounded-md px-2 py-1 text-[10px] font-mono outline-none focus:border-indigo-500"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={showBackup} className={ROW_BTN}>⇪ Show the backup here</button>
              <button type="button" onClick={copyBackup} className={ROW_BTN}>⧉ Copy</button>
              <button type="button" onClick={doImport} className={ROW_BTN}>⇩ Import</button>
            </div>
            <div className="text-[10px] text-slate-400 leading-snug">
              An import is a merge: a configuration whose name already exists is REPLACED by the imported one,
              the others are added, so importing the same backup twice changes nothing. The configurations live
              in this browser only (like the profile), hence the backup.
            </div>
          </div>
        </details>
      </div>

      {/* ---- the ink & the lines of a figure ------------------------------ */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-col gap-3">
        <div className="text-[10px] font-black text-slate-400 uppercase">Colours &amp; lines — the ink of every figure</div>
        <div className="text-[10px] text-slate-500 leading-snug">
          The <b>colour of the axis numbers</b>, the <b>colour of the axis titles</b> and the
          <b> thickness of the curves</b> — of every chart and spectrum of the page, recharts and Chart.js
          alike. “Each chart's own” = the colour / the thickness that chart draws today, so a profile that
          names none of them renders every figure exactly as it is.
        </div>
        <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
          <ColourRow
            label="Axis numbers — colour"
            hint="The numbers along every axis (the tick labels)."
            value={profile.tickColor}
            onChange={(v) => set({ tickColor: v })}
          />
          <ColourRow
            label="Axis titles — colour"
            hint="“Wavelength (nm)”, “Intensity (a.u.)”…"
            value={profile.axisTitleColor}
            onChange={(v) => set({ axisTitleColor: v })}
          />
        </div>
        <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-600">Line thickness — the curves of every figure</span>
            <span className="text-[10px] font-mono text-slate-400">
              {profile.lineThickness > 0 ? `${profile.lineThickness} px` : 'each chart’s own'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {FIGURE_LINE_STEPS.map((v) => (
              <button
                key={String(v)}
                type="button"
                onClick={() => set({ lineThickness: v })}
                title={v === FIGURE_LINE_MIN
                  ? 'Every chart keeps the thickness of its own 🎨 panel'
                  : `Draw every curve ${v} px thick`}
                className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${profile.lineThickness === v
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-slate-600 border-slate-300 hover:bg-indigo-50'}`}
              >
                {v === FIGURE_LINE_MIN ? 'Own' : v}
              </button>
            ))}
            <input
              type="range" min={FIGURE_LINE_MIN} max={FIGURE_LINE_MAX} step="0.5"
              value={profile.lineThickness}
              onChange={(e) => set({ lineThickness: Number(e.target.value) })}
              title="Any thickness between 0 and 8 px (0 = each chart's own)"
              className="w-40 accent-indigo-600"
            />
            <span className="inline-block bg-indigo-500 rounded-full align-middle"
              style={{ height: `${Math.max(1, profile.lineThickness || 2)}px`, width: '72px' }} />
          </div>
          <div className="text-[9px] text-slate-400 leading-snug">
            A curve given its own width in the 🎨 panel keeps it: the per-curve value wins, then this knob,
            then the chart itself.
          </div>
        </div>
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
        <div className="text-[10px] font-black text-slate-400 uppercase">Axis titles &amp; axis numbers — style, format and scale</div>

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
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-600">Axis numbers — decimals (shared by X and Y)</span>
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

        {/* ---- exponential notation + log scale, PER AXIS × KIND ----------- */}
        <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
          <div className="text-[10px] font-black text-slate-400 uppercase">
            Exponential notation &amp; logarithmic scale — per axis and per kind of figure
          </div>
          <div className="text-[10px] text-slate-500 leading-snug">
            The <b>exponential notation</b> of the axis numbers (1.23 × 10⁴) and the
            <b> logarithmic scale</b> of an axis are set for the X axis and the Y axis of ONE kind of
            figure at a time: a spectrum keeps a linear ppm axis while the per-atom plot of the same page
            is read on a log y axis. Same commands as the 🎨 <b>Graphical Parameters</b> panel of a single
            chart (Sci. notation X / Y, Log X / Y axis).
          </div>
          {figureAxisFormatSummary(profile).map((row) => (
            <div
              key={row.kind}
              className="flex flex-col gap-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2"
            >
              <div className="text-xs font-bold text-slate-700">{row.label}</div>
              <div className="text-[10px] text-slate-500 leading-snug">{FIGURE_AXIS_HINTS[row.kind]}</div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {FIGURE_AXIS_BASES.map((base) => {
                  const field = figureAxisFormatField(base, row.kind);
                  return (
                    <label
                      key={base}
                      className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 cursor-pointer"
                    >
                      <input
                        type="checkbox" checked={!!profile[field]}
                        onChange={(e) => set({ [field]: e.target.checked })}
                        className="w-3.5 h-3.5 accent-indigo-600"
                      />
                      {FIGURE_AXIS_BASE_LABELS[base]}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="text-[10px] text-slate-400 leading-snug">
            A logarithmic axis needs strictly positive values (the charts drop the points at 0 and below);
            an interrupted (✂) axis is ignored while its own axis is logarithmic.
          </div>
        </div>

        <div className="text-[10px] text-slate-500 leading-snug">
          The axis titles in bold / italic and the NUMBER OF DECIMALS are shared by the two axes of every
          chart; the exponential notation and the logarithmic scale above are set per axis and per kind of
          figure. All of them are the commands of the 🎨 <b>Graphical Parameters</b> panel of a single
          chart: set them once here and press 🎨 on the experiment page to push them into every chart and
          spectrum — so the axis titles, the axis numbers and the axis scales of every captured figure are
          written the same way. “Auto” leaves the format of each chart exactly as it is today.
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
      {/* ---- ONE plot-box ratio per KIND of figure ------------------------ */}
      <div className="flex flex-col gap-1 bg-white border border-slate-200 rounded-lg px-3 py-2">
        <div className="text-xs font-bold text-slate-700">5 · Aspect ratio — x axis length : y axis length</div>
        <div className="text-[10px] text-slate-500 leading-snug">
          The profile carries ONE shape per kind of figure, so a page mixing a 1D spectrum with a per-atom
          bar chart gives each the box it needs. 0 = that kind keeps the ratio of its own 🎨 Graphical
          Parameters panel; anything else is imposed by the 🎨 Figure style button of the page.
        </div>
      </div>
      {FIGURE_KINDS.map((kind) => (
        <Row
          key={kind}
          label={`Aspect ratio — ${FIGURE_KIND_LABELS[kind]}`}
          hint={FIGURE_ASPECT_HINTS[kind]}
          value={profile[FIGURE_KIND_FIELDS[kind]]}
          min={FIGURE_ASPECT_MIN} max={FIGURE_ASPECT_MAX} step={0.05}
          unit=""
          quick={FIGURE_ASPECT_STEPS} quickLabel="x:y"
          onChange={(v) => set({ [FIGURE_KIND_FIELDS[kind]]: v })}
        />
      ))}

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
            color: profile.axisTitleColor || undefined,
            fontWeight: profile.axisTitleBold ? 'bold' : 'normal',
            fontStyle: profile.axisTitleItalic ? 'italic' : 'normal'
          }}>
            Intensity (a.u.)
          </span>
          <span className="absolute -bottom-1 right-1 text-slate-500"
            style={{ fontSize: profile.fontSize, color: profile.tickColor || undefined }}>
            {previewTick(12500, profile)} ppm
          </span>
          {/* …and the thickness of the curves, at the size the figures will be
              drawn with (2 px = what every chart draws today). */}
          <span className="absolute left-1 bottom-8 flex items-center gap-2">
            <span className="inline-block bg-indigo-500 rounded-full"
              style={{ height: `${Math.max(1, profile.lineThickness || 2)}px`, width: '80px' }} />
            <span className="text-[9px] text-slate-400">
              {profile.lineThickness > 0 ? `curves ${profile.lineThickness} px` : 'curves: own'}
            </span>
          </span>
          <span className="absolute left-1 top-12 text-slate-500" style={{ fontSize: profile.legendFontSize }}>
            ▲ 3 conditions ▼
          </span>
          <span className="absolute left-32 top-20 text-red-600 font-semibold" style={{ fontSize: profile.simLabelFontSize }}>
            3A Hα
          </span>
          <span
            className="absolute right-2 top-1 text-slate-500 origin-top-left"
            style={{ fontSize: profile.fontSize, color: profile.tickColor || undefined, transform: `rotate(${profile.tickAngle}deg)` }}
          >
            rotated x label
          </span>
        </div>
        <div className="flex flex-wrap items-end gap-4 mt-3">
          {figureAspectSummary(profile).map((a) => (
            <div key={a.kind} className="flex flex-col items-start gap-1">
              <span className="text-[9px] font-bold text-slate-500 uppercase">{a.kind}</span>
              <div className="h-8 border border-slate-400 bg-indigo-100/70"
                style={{ aspectRatio: String(a.ratio > 0 ? a.ratio : DEFAULT_CHART_ASPECT_WIDE) }} />
              <span className="text-[9px] font-bold text-slate-600">
                {a.ratio > 0
                  ? `${a.ratio} : 1 (x : y)`
                  : `keeps its own (e.g. ${DEFAULT_CHART_ASPECT_WIDE} : 1)`}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FigureStylePanel;
