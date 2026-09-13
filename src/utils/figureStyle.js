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
   ========================================================================= */

export const FIGURE_STYLE_KEY = 'labFigureStyle';
export const FIGURE_STYLE_EVENT = 'lab:figure-style-changed';

// Character sizes are clamped: below 8 px a figure is unreadable; the upper
// bound is 40 px — the "poster" size used for figures printed on a poster
// (36 / 40 are offered as one-click values, see FIGURE_FONT_STEPS). Rotation is
// clamped to ±90°.
export const FIGURE_FONT_MIN = 8;
export const FIGURE_FONT_MAX = 40;
export const FIGURE_ANGLE_MIN = -90;
export const FIGURE_ANGLE_MAX = 90;

// One-click character sizes of the profile editor. 36 / 40 are the poster
// values a figure printed at A0 needs; the slider is not limited to them.
export const FIGURE_FONT_STEPS = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40];

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
export const FIGURE_STYLE_FIELDS = ['fontFamily', 'fontSize', 'axisTitleFontSize', 'legendFontSize', 'simLabelFontSize', 'tickAngle'];
export const FIGURE_SPECTRA_FIELDS = ['simLabelFontSize', 'tickAngle'];

const toNum = (v, fb) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};
export const clampFigureFont = (v, fb = DEFAULT_FIGURE_STYLE.fontSize) =>
  Math.max(FIGURE_FONT_MIN, Math.min(FIGURE_FONT_MAX, Math.round(toNum(v, fb))));
export const clampFigureAngle = (v) =>
  Math.max(FIGURE_ANGLE_MIN, Math.min(FIGURE_ANGLE_MAX, Math.round(toNum(v, DEFAULT_FIGURE_STYLE.tickAngle))));

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
 *   fs<tick>-t<title>-lg<legend>-lb<labels>-rot<angle>[-<Family>]
 * e.g. `fs16-t18-lg16-lb16-rot0` (app font) or `fs20-…-Arial`.
 */
export const figureStyleTag = (style) => {
  const s = normalizeFigureStyle(style || readFigureStyle());
  const fam = s.fontFamily ? `-${s.fontFamily.replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}` : '';
  return `fs${s.fontSize}-t${s.axisTitleFontSize}-lg${s.legendFontSize}-lb${s.simLabelFontSize}-rot${s.tickAngle}${fam}`;
};

/**
 * The subset of the profile a given cfg accepts.
 *   • `fontSize`, `axisTitleFontSize`, `legendFontSize` → always (the shared
 *     character sizes; a chart that does not use one simply ignores it);
 *   • `fontFamily` → always, but only written when the profile HAS one (or to
 *     clear one the cfg already carries);
 *   • `simLabelFontSize`, `tickAngle` → only when the cfg already uses them
 *     (spectra: the merged simCfg / nmr1dCfg / DEFAULT_CHART_STYLE carry both).
 * `options.spectra === true` forces the two spectra keys on.
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
