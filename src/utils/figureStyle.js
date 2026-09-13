/* =========================================================================
   src/utils/figureStyle.js
   ONE global "Figure style" for every chart / spectrum of the workspace.

   The problem it solves: every experiment page keeps its own chart style
   (`activeTest.vizCfg`, `vizCfgSplit`, `chartCfg`, `dosyChartCfg`,
   `nmr1dChartCfg`, `simChartCfg`…) and every module has its OWN default
   character size (16 in FCS / CD / NMR, 12 in NMR-fittings / Plate, 9–10 in
   MD). Two figures captured on two pages therefore show 16 px labels at
   different apparent sizes once they are placed in the same slide / PDF.

   The fix is ONE style profile (`labFigureStyle`) applied to every chart of a
   page *before* the figure is captured (re-render, never a restyle of the
   saved pixels) — see Settings → "Figure style" and the 🎨 button the
   ChartStarLayer puts on every experiment page.

   This module is plain JS (no JSX, no React): it holds
     • the profile (read / write / clamp / tag)
     • the fan-out helper  applyFigureStyleToCfg(cfg, style)
     • a tiny REGISTRY of "style slots" — every `<ChartInspector>` /
       `<ChartJsInspector>` (i.e. every chart with a style panel, including the
       ones whose cfg lives in local React state, like MD) registers its
       `cfg` / `setCfg` pair here, so ONE click can push the profile into all of
       them without touching any of the ~10 section files.
     • the plot-box RATIO — the x-axis length : y-axis length of a figure,
       pushed as `cfg.aspect` + `cfg.figureAspect` (see chartAspect in
       utils/chartStyle.js). 0 = every chart keeps its own ratio.
   ========================================================================= */

import { FIGURE_ASPECT_KEY, figureAspectOf } from './chartStyle.js';

export const FIGURE_STYLE_KEY = 'labFigureStyle';
export const FIGURE_STYLE_EVENT = 'lab:figure-style-changed';

// Character sizes are clamped: below 8 px a figure is unreadable; the upper
// bound is 160 px — the "oversized" value of a figure that is captured big and
// then scaled down to its place in a slide / a PDF panel (48 … 160 are offered
// as one-click values, see FIGURE_FONT_STEPS). Rotation is clamped to ±90°.
export const FIGURE_FONT_MIN = 8;
export const FIGURE_FONT_MAX = 160;
export const FIGURE_ANGLE_MIN = -90;
export const FIGURE_ANGLE_MAX = 90;

// One-click character sizes of the profile editor: the usual values, the POSTER
// values a figure printed at A0 needs (36 / 40) and the OVERSIZED values up to
// the 160 px upper bound. The slider is not limited to these steps.
export const FIGURE_FONT_STEPS = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 80, 96, 120, 160];

// The plot-box ratio (x-axis length : y-axis length) the profile can impose on
// every figure. 0 = KEEP EACH CHART'S OWN ratio — the default, and the only
// value that fits a page mixing spectra, chromatograms and 2D plots; the range
// covers a tall square-ish panel (0.5) up to a flat strip (4). The 2D spectra
// (COSY / HSQC) keep their own square ratio: they are driven by the "2D aspect
// ratio" knob of the spectra panel, not by this one.
export const FIGURE_ASPECT_MIN = 0;
export const FIGURE_ASPECT_MAX = 4;
export const FIGURE_ASPECT_STEPS = [0, 0.5, 0.75, 1, 1.33, 1.5, 1.8, 2, 2.5, 3, 4];

// …and the AXIS TITLE style / AXIS NUMBER format of the same profile:
//   axisTitleBold / axisTitleItalic   the axis titles ("Wavelength (nm)",
//                                     "Intensity (a.u.)") of every figure.
//   tickSci                           the axis numbers in exponential
//                                     notation (1.2 × 10⁴) instead of 12000.
//   tickDecimals                      how many decimals the axis numbers
//                                     show; '' = automatic (the old, untouched
//                                     behaviour of every chart).
export const FIGURE_DECIMALS_MIN = 0;
export const FIGURE_DECIMALS_MAX = 6;
// The one-click values of the decimals control ('' = auto).
export const FIGURE_DECIMALS_STEPS = ['', 0, 1, 2, 3, 4];
export const FIGURE_SCI_FORMAT = 'exponential';

/**
 * The profile — ONE character size per ELEMENT, plus the font family:
 *
 *   fontFamily          '' = the app font (Inter). Any CSS font stack otherwise.
 *   fontSize            axis NUMBER labels (the historical knob: every page
 *                       already reads `cfg.fontSize`).
 *   axisTitleFontSize   axis TITLES ("Wavelength (nm)", "Intensity (a.u.)").
 *   legendFontSize      legend entries / series names.
 *   simLabelFontSize    peak / data labels of the spectra (assignments).
 *   tickAngle           rotation of the x tick labels.
 *   axisTitleBold       the axis TITLES are drawn bold.
 *   axisTitleItalic     the axis TITLES are drawn italic.
 *   tickSci             the axis NUMBERS are written in exponential notation
 *                       (1.23 × 10⁴) instead of 12300.
 *   tickDecimals        how many decimals the axis NUMBERS show ('' = auto,
 *                       0…FIGURE_DECIMALS_MAX).
 *   aspect              x-axis length : y-axis length of the plot box — ONE
 *                       shape for every figure of a page. 0 = each chart keeps
 *                       its own ratio (see FIGURE_ASPECT_MIN).
 *   applyOnOpen         push the profile automatically when a page opens.
 *
 * A chart that does not read one of the sizes simply ignores it; the ones that
 * do read it keep their own value when the profile leaves the field alone.
 */
export const DEFAULT_FIGURE_STYLE = {
  fontFamily: '',
  fontSize: 16,
  axisTitleFontSize: 18,
  legendFontSize: 16,
  simLabelFontSize: 16,
  tickAngle: 0,
  axisTitleBold: false,
  axisTitleItalic: false,
  tickSci: false,
  tickDecimals: '',
  aspect: 0,
  applyOnOpen: false
};

// Human labels of the character sizes (panel rows, tooltips, the 🎨 chip).
export const FIGURE_SIZE_FIELDS = ['fontSize', 'axisTitleFontSize', 'legendFontSize', 'simLabelFontSize'];
export const FIGURE_SIZE_LABELS = {
  fontSize: 'Axis numbers (tick labels)',
  axisTitleFontSize: 'Axis titles (x / y names)',
  legendFontSize: 'Legends / series names',
  simLabelFontSize: 'Peak / data labels (spectra)'
};

// The cfg keys the profile writes when applying. The family + the three sizes
// go into EVERY registered chart (a chart that does not use one ignores it);
// the spectra keys only into a cfg that ALREADY carries them (a recharts chart
// has no peak labels, and we never inject plumbing into a saved
// `test.<...>Cfg` object). Every merged style container of the app
// (DEFAULT_CHART_STYLE, simCfg, DEFAULT_CFG…) carries all of them, so the
// spectra are covered everywhere an x axis exists.
export const FIGURE_STYLE_FIELDS = ['fontFamily', 'fontSize', 'axisTitleFontSize', 'legendFontSize', 'simLabelFontSize', 'tickAngle', 'axisTitleBold', 'axisTitleItalic', 'tickSci', 'tickDecimals', 'aspect'];
export const FIGURE_SPECTRA_FIELDS = ['simLabelFontSize', 'tickAngle'];

// The cfg keys of the AXIS TITLE style / AXIS NUMBER format. They are the very
// keys the 🎨 Graphical Parameters panel writes (xAxisLabelBold, xSci,
// xDecimals…), so a global knob and a per-chart command are the same thing to
// every chart — see cfgAxisLabel / cfgTickFormatter in SharedAnalysisTools.
export const FIGURE_AXIS_CFG_KEYS = {
  bold: ['xAxisLabelBold', 'yAxisLabelBold'],
  italic: ['xAxisLabelItalic', 'yAxisLabelItalic'],
  sci: ['xSci', 'ySci'],
  decimals: ['xDecimals', 'yDecimals']
};

// Keys that say "this cfg belongs to a chart that is driven by the shared
// Graphical Parameters panel". EVERY chart cfg of an experiment page carries at
// least one of them (they come from the page's own DEFAULT_CHART_STYLE /
// simCfg / chartCfg), so the two AXIS TITLE booleans and the exponential /
// decimals controls of the profile are only written where a chart really reads
// cfgAxisLabel / cfgTickFormatter — never as dead plumbing into a foreign cfg.
export const FIGURE_PANEL_CFG_KEYS = [
  'fontSize', 'axisTitleFontSize', 'legendFontSize', 'simLabelFontSize', 'tickAngle',
  'tickStep', 'xTickStep', 'yTickStep', 'xMin', 'xMax', 'yMin', 'yMax',
  'xAxisLabel', 'yAxisLabel', 'chartType', 'lineStyle', 'legend',
  'ptStyle', 'pointStyle', 'colors', 'barRadius', 'aspect', 'height'
];

/** Is this cfg a chart cfg of the page (i.e. one the style panel drives)? */
export const figureCfgAcceptsAxisStyle = (cfg) =>
  !!cfg && typeof cfg === 'object' && !Array.isArray(cfg) && FIGURE_PANEL_CFG_KEYS.some((k) => k in cfg);

const toNum = (v, fb) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};
export const clampFigureFont = (v, fb = DEFAULT_FIGURE_STYLE.fontSize) =>
  Math.max(FIGURE_FONT_MIN, Math.min(FIGURE_FONT_MAX, Math.round(toNum(v, fb))));
export const clampFigureAngle = (v) =>
  Math.max(FIGURE_ANGLE_MIN, Math.min(FIGURE_ANGLE_MAX, Math.round(toNum(v, DEFAULT_FIGURE_STYLE.tickAngle))));
/** Ratio clamp: 0 (keep the chart's own ratio) … FIGURE_ASPECT_MAX, 2 decimals. */
export const clampFigureAspect = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= FIGURE_ASPECT_MIN) return FIGURE_ASPECT_MIN;
  return Math.round(Math.min(FIGURE_ASPECT_MAX, n) * 100) / 100;
};

/**
 * Decimals clamp: '' (auto — the chart formats its own numbers) or an integer
 * between FIGURE_DECIMALS_MIN and FIGURE_DECIMALS_MAX. Stored as a NUMBER so
 * the tag and the cfg keys stay stable ('2', 2 and '2.0' are the same profile).
 */
export const clampFigureDecimals = (v) => {
  if (v === '' || v === null || v === undefined) return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return Math.max(FIGURE_DECIMALS_MIN, Math.min(FIGURE_DECIMALS_MAX, Math.round(n)));
};

/** The two axis-title style booleans, stored as real booleans. */
const toBool = (v) => v === true || v === 'true';

/** A font stack of the profile: '' (app font) or a sanitised CSS font stack. */
export const normalizeFigureFont = (v) => {
  if (v == null) return '';
  const s = String(v).trim().replace(/\s+/g, ' ');
  if (!s) return '';
  // A font stack is a comma separated list of names — never markup, never CSS
  // declarations (the value ends up in a style attribute).
  if (/[<>;{}()"']/.test(s.replace(/"[^"]*"/g, ''))) return '';
  return s.slice(0, 120);
};

/** Accepts anything (a partial object, a stored JSON string, null) → a valid profile. */
export const normalizeFigureStyle = (style) => {
  let raw = style;
  if (typeof style === 'string') {
    try { raw = JSON.parse(style); } catch { raw = null; }
  }
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    fontFamily: normalizeFigureFont(s.fontFamily),
    fontSize: clampFigureFont(s.fontSize),
    axisTitleFontSize: clampFigureFont(s.axisTitleFontSize, DEFAULT_FIGURE_STYLE.axisTitleFontSize),
    legendFontSize: clampFigureFont(s.legendFontSize, DEFAULT_FIGURE_STYLE.legendFontSize),
    simLabelFontSize: clampFigureFont(s.simLabelFontSize, DEFAULT_FIGURE_STYLE.simLabelFontSize),
    tickAngle: clampFigureAngle(s.tickAngle),
    axisTitleBold: toBool(s.axisTitleBold),
    axisTitleItalic: toBool(s.axisTitleItalic),
    tickSci: toBool(s.tickSci),
    tickDecimals: clampFigureDecimals(s.tickDecimals),
    aspect: clampFigureAspect(s.aspect),
    applyOnOpen: s.applyOnOpen === true || s.applyOnOpen === 'true'
  };
};

// ---- storage (localStorage when available, memory otherwise) ---------------
let memStyle = null;

export const readFigureStyle = () => {
  if (!memStyle) {
    let raw = null;
    try { raw = typeof localStorage !== 'undefined' ? localStorage.getItem(FIGURE_STYLE_KEY) : null; } catch { raw = null; }
    memStyle = normalizeFigureStyle(raw);
  }
  return memStyle;
};

const styleListeners = new Set();
/** Subscribe to profile changes. Returns the unsubscribe function. */
export const subscribeFigureStyle = (fn) => {
  if (typeof fn !== 'function') return () => {};
  styleListeners.add(fn);
  return () => { styleListeners.delete(fn); };
};
const emitStyle = () => styleListeners.forEach((fn) => { try { fn(readFigureStyle()); } catch { /* ignore */ } });

export const writeFigureStyle = (style) => {
  const next = normalizeFigureStyle(style);
  const prev = readFigureStyle();
  memStyle = next;
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(FIGURE_STYLE_KEY, JSON.stringify(next)); } catch { /* quota */ }
  const changed = FIGURE_STYLE_FIELDS.some((k) => next[k] !== prev[k]) || next.applyOnOpen !== prev.applyOnOpen;
  emitStyle();
  if (changed) {
    // Same convention as the other lab:* events (figuresLibrary, starredItems…).
    try {
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FIGURE_STYLE_EVENT, { detail: next }));
    } catch { /* ignore */ }
  }
  return next;
};

/**
 * Stable short signature of a profile. It is stored on the test
 * (`test.figureStyleTag`) so a page can tell whether it is already styled and
 * which profile was used for its figures (see the Image Builder notice).
 *
 *   fs<tick>-t<title>-lg<legend>-lb<labels>-rot<angle>[-ar<ratio>][-bold]
 *   [-ital][-sci][-dec<n>][-<Family>]
 * e.g. `fs16-t18-lg16-lb16-rot0` (app font) or `fs20-…-Arial`.
 *
 * The optional suffixes are only written when the knob really DEVIATES from its
 * default, so every tag produced before they existed stays byte-identical (a
 * figure captured yesterday is still recognised as "same style" today).
 */
export const figureStyleTag = (style) => {
  const s = normalizeFigureStyle(style || readFigureStyle());
  const fam = s.fontFamily ? `-${s.fontFamily.replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}` : '';
  // The ratio only shows in the tag when it is imposed (0 = "each chart keeps
  // its own"), so every tag written before this knob existed stays identical.
  const ar = s.aspect > 0 ? `-ar${s.aspect}` : '';
  const axis = [
    s.axisTitleBold ? 'bold' : '',
    s.axisTitleItalic ? 'ital' : '',
    s.tickSci ? 'sci' : '',
    s.tickDecimals === '' ? '' : `dec${s.tickDecimals}`
  ].filter(Boolean).join('-');
  const ax = axis ? `-${axis}` : '';
  return `fs${s.fontSize}-t${s.axisTitleFontSize}-lg${s.legendFontSize}-lb${s.simLabelFontSize}-rot${s.tickAngle}${ar}${ax}${fam}`;
};

/**
 * The subset of the profile a given cfg accepts.
 *   • `fontSize`, `axisTitleFontSize`, `legendFontSize` → always (the shared
 *     character sizes; a chart that does not use one simply ignores it);
 *   • `fontFamily` → always, but only written when the profile HAS one (or to
 *     clear one the cfg already carries);
 *   • `simLabelFontSize`, `tickAngle` → only when the cfg already uses them
 *     (spectra: the merged simCfg / nmr1dCfg / DEFAULT_CHART_STYLE carry both).
 *   • `axisTitleBold`, `axisTitleItalic`, `tickSci`, `tickDecimals` → the cfg
 *     keys `xAxisLabelBold` / `yAxisLabelBold` / … / `xDecimals` / `yDecimals`
 *     (the same ones the 🎨 panel writes): turned ON they reach every chart cfg
 *     of the page (figureCfgAcceptsAxisStyle), turned back to their default
 *     they are cleared on the cfgs that carry them.
 * `options.spectra === true` forces the two spectra keys on.
 * The plot-box RATIO goes to `aspect` (the value the per-chart panel then
 * shows) AND to `figureAspect` — the key that really wins, because `aspect`
 * alone cannot be told apart from the two historical defaults of a chart (see
 * chartAspect in utils/chartStyle.js). A profile back at 0 clears the
 * `figureAspect` a previous apply left behind, so "each chart keeps its own
 * ratio" really gives the chart its own ratio back.
 */
export const figureStylePatch = (style, cfg = null, options = null) => {
  const s = normalizeFigureStyle(style || readFigureStyle());
  const forceSpectra = !!(options && options.spectra);
  const out = { fontSize: s.fontSize, axisTitleFontSize: s.axisTitleFontSize, legendFontSize: s.legendFontSize };
  if (s.fontFamily) out.fontFamily = s.fontFamily;
  else if (cfg && typeof cfg === 'object' && cfg.fontFamily) out.fontFamily = '';
  FIGURE_SPECTRA_FIELDS.forEach((k) => {
    const uses = forceSpectra || (!!cfg && typeof cfg === 'object' && k in cfg);
    if (uses) out[k] = s[k];
  });
  const owns = !!cfg && typeof cfg === 'object';
  if (s.aspect > 0) {
    out.aspect = s.aspect;
    out[FIGURE_ASPECT_KEY] = s.aspect;
  } else if (owns && figureAspectOf(cfg)) {
    out[FIGURE_ASPECT_KEY] = FIGURE_ASPECT_MIN;
  }
  // ── AXIS TITLE style + AXIS NUMBER format ─────────────────────────────────
  // ON: the knob reaches the charts that are driven by the shared style panel
  // (see figureCfgAcceptsAxisStyle) — the title/number keys are the SAME keys
  // the per-chart 🎨 panel writes, so nothing new is invented here.
  // OFF (profile back at its default): the keys are CLEARED on the cfgs that
  // carry them, and never injected as `false`/`''` into a cfg that has none —
  // the exact convention used for `fontFamily` and `figureAspect` above.
  const panel = figureCfgAcceptsAxisStyle(cfg);
  const onOff = (on, keys) => {
    if (on) {
      if (panel) keys.forEach((k) => { out[k] = true; });
      return;
    }
    if (!owns) return;
    keys.forEach((k) => { if (k in cfg) out[k] = false; });
  };
  onOff(s.axisTitleBold, FIGURE_AXIS_CFG_KEYS.bold);
  onOff(s.axisTitleItalic, FIGURE_AXIS_CFG_KEYS.italic);
  onOff(s.tickSci, FIGURE_AXIS_CFG_KEYS.sci);
  if (s.tickDecimals === '') {
    if (owns) FIGURE_AXIS_CFG_KEYS.decimals.forEach((k) => { if (k in cfg) out[k] = ''; });
  } else if (panel || (owns && FIGURE_AXIS_CFG_KEYS.decimals.some((k) => k in cfg))) {
    FIGURE_AXIS_CFG_KEYS.decimals.forEach((k) => { out[k] = s.tickDecimals; });
  }
  return out;
};

/** Same value? (the profile carries numbers AND the font family string) */
const sameStyleValue = (a, b) => (typeof a === 'string' || typeof b === 'string'
  ? String(a == null ? '' : a) === String(b == null ? '' : b)
  : Number(a) === Number(b));

/** True when every field of the profile already holds its value in `cfg`. */
export const figureStyleMatches = (cfg, style = null) => {
  if (!cfg || typeof cfg !== 'object') return true;
  const patch = figureStylePatch(style, cfg);
  return Object.keys(patch).every((k) => sameStyleValue(cfg[k], patch[k]));
};

/**
 * The fan-out helper: `cfg` + profile → the NEXT cfg object, or `null` when
 * there is nothing to change (so a caller can skip the `setCfg` call and avoid
 * a pointless re-render / test save). Everything else — curve overrides, axis
 * min/max, colours, titles… — is preserved as-is.
 */
export const applyFigureStyleToCfg = (cfg, style = null, options = null) => {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return null;
  const patch = figureStylePatch(style, cfg, options);
  const changed = Object.keys(patch).some((k) => !sameStyleValue(cfg[k], patch[k]));
  if (!changed) return null;
  return { ...cfg, ...patch };
};

/* ─────────────────────────────────────────────────────────────────────────────
   PAGE-LEVEL HELPERS — the 🎨 button and the automatic re-capture share them.
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Open every CLOSED section of the page (their charts are not rendered at all
 * until then, so they cannot be styled nor captured). Clicks the page's own
 * "▸ Expand all" button — which only exists while it would expand something.
 */
export const expandAllChartSections = () => {
  try {
    if (typeof document === 'undefined') return false;
    const btn = document.querySelector('[data-expand-all]');
    if (!btn) return false;
    btn.click();
    return true;
  } catch { return false; }
};

/**
 * Push the profile into every chart of the page — NOW, and again a moment after
 * the closed sections were opened (the charts mount lazily). Returns the first
 * result plus `expanded` and a `cancel()` for the parked re-applies.
 */
export const applyFigureStyleEverywhere = (style = null, options = null) => {
  const profile = normalizeFigureStyle(style || readFigureStyle());
  const first = applyFigureStyleToSlots(profile, options);
  const expanded = expandAllChartSections();
  const timers = [];
  if (expanded && typeof setTimeout === 'function') {
    timers.push(setTimeout(() => applyFigureStyleToSlots(profile, options), 900));
    timers.push(setTimeout(() => applyFigureStyleToSlots(profile, options), 2400));
  }
  return { ...first, expanded, cancel: () => timers.forEach((t) => clearTimeout(t)) };
};

/* ─────────────────────────────────────────────────────────────────────────────
   THE REGISTRY — "style slots"

   A slot is one chart that owns a style panel: `get()` returns its CURRENT
   (merged) cfg, `set(next)` is EXACTLY the setter the page's own Graphical
   Parameters panel uses. The write therefore follows the same path as a manual
   edit: `activeTest.<...>Cfg` containers go through `updateActiveTest`, the
   local-state ones (MD) through `setState`.
   The inspectors register / unregister themselves, so a page always knows every
   chart it can style — including the charts of a closed section, as soon as that
   section is opened.
   ──────────────────────────────────────────────────────────────────────────── */
const slots = new Map(); // id -> { id, get, set }
let slotSeq = 0;
const slotListeners = new Set();

export const subscribeFigureStyleSlots = (fn) => {
  if (typeof fn !== 'function') return () => {};
  slotListeners.add(fn);
  return () => { slotListeners.delete(fn); };
};
const emitSlots = () => slotListeners.forEach((fn) => { try { fn(slots.size); } catch { /* ignore */ } });

export const registerFigureStyleSlot = (slot) => {
  if (!slot || typeof slot.get !== 'function' || typeof slot.set !== 'function') return () => {};
  const id = `figslot_${(slotSeq += 1)}`;
  slots.set(id, { id, get: slot.get, set: slot.set });
  emitSlots();
  return () => { if (slots.delete(id)) emitSlots(); };
};

/** How many charts of the current page can be styled right now. */
export const figureStyleSlotCount = () => slots.size;

// The undo snapshot of the LAST apply (in memory: undo is an immediate action).
// One entry per slot, keyed by id, holding the cfg it had BEFORE the first apply
// of the run — so applying twice (e.g. once alone, then again after the closed
// sections were opened) can still be undone in one click.
let lastApply = null; // Map<slotId, { set, cfg }>
export const figureStyleUndoAvailable = () => !!lastApply && lastApply.size > 0;

/**
 * Push the profile into EVERY registered chart.
 * Returns `{ total, changed, style, tag }` — `changed` counts the charts that
 * really had to be rewritten (the others already matched the profile).
 */
export const applyFigureStyleToSlots = (style = null, options = null) => {
  const profile = normalizeFigureStyle(style || readFigureStyle());
  const undo = new Map(lastApply || undefined);
  let total = 0;
  let changed = 0;
  for (const slot of slots.values()) {
    let cur = null;
    try { cur = slot.get(); } catch { cur = null; }
    if (!cur || typeof cur !== 'object') continue;
    total += 1;
    const next = applyFigureStyleToCfg(cur, profile, options);
    if (!next) continue;
    try { slot.set(next); } catch { continue; }
    changed += 1;
    if (!undo.has(slot.id)) undo.set(slot.id, { set: slot.set, cfg: cur });
  }
  lastApply = undo.size ? undo : null;
  return { total, changed, style: profile, tag: figureStyleTag(profile) };
};

/** Restore the cfg of every chart the last apply changed. Returns how many. */
export const undoFigureStyleSlots = () => {
  if (!lastApply) return 0;
  const entries = [...lastApply.values()];
  lastApply = null;
  let n = 0;
  entries.forEach((e) => { try { e.set(e.cfg); n += 1; } catch { /* ignore */ } });
  return n;
};
