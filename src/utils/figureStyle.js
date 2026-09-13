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

// Character sizes are clamped: below 8 px a figure is unreadable, above 30 px a
// 1D spectrum only shows two ticks. Rotation is clamped to ±90°.
export const FIGURE_FONT_MIN = 8;
export const FIGURE_FONT_MAX = 30;
export const FIGURE_ANGLE_MIN = -90;
export const FIGURE_ANGLE_MAX = 90;

/**
 * The profile. `fontSize` is THE knob (axis ticks, axis titles, legends of the
 * Chart.js canvases…); the two others only reach the charts that read them:
 * `simLabelFontSize` the simulated / peak labels of the spectra, `tickAngle`
 * the rotated x labels (spectra, long category names).
 */
export const DEFAULT_FIGURE_STYLE = {
  fontSize: 16,
  simLabelFontSize: 16,
  tickAngle: 0,
  applyOnOpen: false
};

// The cfg keys the profile writes when applying. `fontSize` goes into EVERY
// registered chart; the spectra keys only into a cfg that ALREADY carries them
// (a recharts chart has no peak labels, and we never inject plumbing into a
// saved `test.<...>Cfg` object). Every merged style container of the app
// (DEFAULT_CHART_STYLE, simCfg, DEFAULT_CFG…) carries all three, so the spectra
// are covered everywhere an x axis exists.
export const FIGURE_STYLE_FIELDS = ['fontSize', 'simLabelFontSize', 'tickAngle'];
export const FIGURE_SPECTRA_FIELDS = ['simLabelFontSize', 'tickAngle'];

const toNum = (v, fb) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};
export const clampFigureFont = (v, fb = DEFAULT_FIGURE_STYLE.fontSize) =>
  Math.max(FIGURE_FONT_MIN, Math.min(FIGURE_FONT_MAX, Math.round(toNum(v, fb))));
export const clampFigureAngle = (v) =>
  Math.max(FIGURE_ANGLE_MIN, Math.min(FIGURE_ANGLE_MAX, Math.round(toNum(v, DEFAULT_FIGURE_STYLE.tickAngle))));

/** Accepts anything (a partial object, a stored JSON string, null) → a valid profile. */
export const normalizeFigureStyle = (style) => {
  let raw = style;
  if (typeof style === 'string') {
    try { raw = JSON.parse(style); } catch { raw = null; }
  }
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    fontSize: clampFigureFont(s.fontSize),
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
 */
export const figureStyleTag = (style) => {
  const s = normalizeFigureStyle(style || readFigureStyle());
  return `fs${s.fontSize}-lb${s.simLabelFontSize}-rot${s.tickAngle}`;
};

/**
 * The subset of the profile a given cfg accepts.
 *   • `fontSize`                    → always (the shared character size)
 *   • `simLabelFontSize`, `tickAngle` → only when the cfg already uses them
 *     (spectra: the merged simCfg / nmr1dCfg / DEFAULT_CHART_STYLE carry both).
 * `options.spectra === true` forces the two spectra keys on.
 */
export const figureStylePatch = (style, cfg = null, options = null) => {
  const s = normalizeFigureStyle(style || readFigureStyle());
  const forceSpectra = !!(options && options.spectra);
  const out = { fontSize: s.fontSize };
  FIGURE_SPECTRA_FIELDS.forEach((k) => {
    const uses = forceSpectra || (!!cfg && typeof cfg === 'object' && k in cfg);
    if (uses) out[k] = s[k];
  });
  return out;
};

/** True when every field of the profile already holds its value in `cfg`. */
export const figureStyleMatches = (cfg, style = null) => {
  if (!cfg || typeof cfg !== 'object') return true;
  const patch = figureStylePatch(style, cfg);
  return Object.keys(patch).every((k) => Number(cfg[k]) === patch[k]);
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
  const changed = Object.keys(patch).some((k) => Number(cfg[k]) !== patch[k]);
  if (!changed) return null;
  return { ...cfg, ...patch };
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
