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
       utils/chartStyle.js). 0 = every chart keeps its own ratio. There is ONE
       ratio PER KIND of figure (spectra / per-atom / per-residue / graphs, see
       FIGURE_KINDS), so a page mixing a 1D spectrum and a per-atom bar chart
       can give each the shape it needs.
     • the AXIS FORMAT and the AXIS SCALE — the exponential notation of the axis
       numbers and the LOGARITHMIC scale of an axis, PER AXIS (X / Y) and PER
       KIND of figure (see FIGURE_AXIS_FORMAT_FIELDS). They are pushed as the
       very keys the per-chart 🎨 panel writes (xSci / ySci / xLog / yLog), so
       the profile and a single chart say the same thing.
     • the SAVED CONFIGURATIONS — the named profiles of the user ("Figure — A4",
       "Screen"), so the style a set of figures needs and the everyday one live
       side by side and switching is one click (see FIGURE_STYLE_LIBRARY_KEY and
       the saveFigureStyleConfig family).
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

/* ── ONE RATIO PER KIND OF FIGURE ────────────────────────────────────────────
   Settings → Figure style carries FOUR plot-box ratios, because one page mixes
   figures that do not ask for the same shape: a 1D spectrum is a flat strip, a
   per-atom / per-residue bar chart needs room for its many categories, and a
   plain graph sits in between.

     spectra   the NMR (imported 1D + simulated 1D/2D), CD and ssNMR spectra
     atom      the per-atom plots (the NMR and MD “Per-Atom” chart panels)
     residue   the per-residue plots (MD per-residue occupancy / analysis bars)
     graph     every other chart — the DEFAULT, so a chart that does not say
               what it is keeps following the historical `aspect` knob

   A chart declares its kind when its style slot is registered (`figureKind` of
   <ChartInspector> / <ChartJsInspector> / <ChartPanel> / <SharedChart>, see
   useFigureStyleSlot); the profile then writes THAT kind's ratio into
   `cfg.aspect` + `cfg.figureAspect`, which is what chartAspect() reads. */
export const FIGURE_KINDS = ['spectra', 'atom', 'residue', 'graph'];
export const DEFAULT_FIGURE_KIND = 'graph';
// Profile field ↔ kind. The graph ratio keeps the historical `aspect` name, so
// a profile saved before the kinds existed still means “the other charts”.
export const FIGURE_KIND_FIELDS = {
  spectra: 'aspectSpectra',
  atom: 'aspectAtom',
  residue: 'aspectResidue',
  graph: 'aspect'
};
export const FIGURE_ASPECT_FIELDS = FIGURE_KINDS.map((k) => FIGURE_KIND_FIELDS[k]);
export const FIGURE_KIND_LABELS = {
  spectra: 'Spectra (NMR, CD, ssNMR)',
  atom: 'Per-atom plots',
  residue: 'Per-residue plots',
  graph: 'Graphs (everything else)'
};
/** Anything (null, '' , 'SPECTRA', a typo) → a kind of FIGURE_KINDS (graph). */
export const normalizeFigureKind = (kind) => (FIGURE_KINDS.includes(kind) ? kind : DEFAULT_FIGURE_KIND);
/** The profile field that carries the ratio of a kind. */
export const figureAspectFieldForKind = (kind) => FIGURE_KIND_FIELDS[normalizeFigureKind(kind)];
/** The plot-box ratio the profile imposes on a KIND of figure (0 = its own). */
export const figureAspectForKind = (style, kind) => {
  const s = normalizeFigureStyle(style);
  const n = Number(s[figureAspectFieldForKind(kind)]);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
/** [{ kind, label, field, ratio }] — the four rows of the Settings panel. */
export const figureAspectSummary = (style) => {
  const s = normalizeFigureStyle(style);
  return FIGURE_KINDS.map((kind) => ({
    kind,
    label: FIGURE_KIND_LABELS[kind],
    field: FIGURE_KIND_FIELDS[kind],
    ratio: Number(s[FIGURE_KIND_FIELDS[kind]]) || 0
  }));
};

/* ── THE AXIS FORMAT & SCALE, ONE PER KIND OF FIGURE ─────────────────────────
   The exponential notation of the axis numbers and the LOGARITHMIC scale of an
   axis are the two commands a figure of a paper needs next to the character
   sizes — and both are set PER AXIS (X / Y) and PER KIND of figure (see
   FIGURE_KINDS), because one page mixes figures that do not ask for the same
   axes: the ppm axis of a spectrum is never written in exponential notation,
   while the y axis of the per-atom plot of the same page is often read on a log
   scale.

   Sixteen knobs, one per axis × kind. Their NAME is the cfg key they write,
   suffixed by the kind (`Spectra` / `Atom` / `Residue`; nothing = the graphs,
   which is the historical default), so the meaning is readable at a glance:

     xSci / ySci / xLog / yLog          the GRAPHS (every other chart)
     xSciSpectra / ySciSpectra / …      the NMR, CD and ssNMR spectra
     xSciAtom / …                       the per-atom plots
     xSciResidue / …                    the per-residue plots

   They are the same commands as the ones of the 🎨 “Graphical Parameters” panel
   of a single chart (Sci. notation X / Y, Log X / Y axis) — see cfgLogScale /
   cfgTickFormatter in SharedAnalysisTools — so a global knob and a per-chart
   command are, again, the very same thing.

   The legacy `tickSci` knob (“exponential on both axes of EVERY figure”) is
   still READ: a profile saved before the axes / kinds existed still means
   exactly that (it is expanded onto the eight sci knobs). It is also DERIVED
   again by normalizeFigureStyle — true when all of the eight are on — so the
   tag of such a profile stays byte-identical to the one written before this
   knob grew axes and kinds.                                              */
export const FIGURE_AXIS_BASES = ['xSci', 'ySci', 'xLog', 'yLog'];
export const FIGURE_AXIS_KIND_SUFFIX = { spectra: 'Spectra', atom: 'Atom', residue: 'Residue', graph: '' };
export const FIGURE_AXIS_BASE_LABELS = {
  xSci: 'X exponential',
  ySci: 'Y exponential',
  xLog: 'X logarithmic',
  yLog: 'Y logarithmic'
};
/** What the four commands do for each KIND of figure (one line of it, in the panel). */
export const FIGURE_AXIS_HINTS = {
  spectra: 'The NMR (imported 1D and simulated 1D / 2D), CD and ssNMR spectra. A ppm / kHz axis stays linear and its numbers are not written in exponential notation — the intensity axis is where a log scale sometimes helps (CD / ssNMR titrations, 1D decays).',
  atom: 'The per-atom plots (the NMR and MD “Per-Atom” chart panels): a log y axis spreads visits per atom, a per-atom energy or an occupancy — and the x axis (the atom index) stays linear.',
  residue: 'The per-residue plots (the MD per-residue occupancy / analysis bars and the other plots whose x axis is the residue number): same commands, applied where the x axis is a residue index.',
  graph: 'Every other figure — time series, bar charts, scatter plots, chromatograms, dose-response curves… The historical knobs: a profile that only uses these leaves every other kind of figure exactly as it is today.'
};
/** The profile field that carries `base` (xSci / ySci / xLog / yLog) for a KIND of figure. */
export const figureAxisFormatField = (base, kind) =>
  `${base}${FIGURE_AXIS_KIND_SUFFIX[normalizeFigureKind(kind)]}`;
/** The sixteen fields, in a stable order (kind by kind, axis by axis). */
export const FIGURE_AXIS_FORMAT_FIELDS = FIGURE_KINDS.flatMap((kind) =>
  FIGURE_AXIS_BASES.map((base) => figureAxisFormatField(base, kind)));
/** The four commands of ONE kind of figure: { xSci, ySci, xLog, yLog }. */
export const figureAxisFormatForKind = (style, kind) => {
  const s = normalizeFigureStyle(style);
  const out = {};
  FIGURE_AXIS_BASES.forEach((base) => { out[base] = !!s[figureAxisFormatField(base, kind)]; });
  return out;
};
/** True when the legacy “exponential on both axes of EVERY figure” is on. */
export const figureAxisAllSci = (style) => {
  const s = normalizeFigureStyle(style);
  return FIGURE_KINDS.every((kind) =>
    !!s[figureAxisFormatField('xSci', kind)] && !!s[figureAxisFormatField('ySci', kind)]);
};
/** [{ kind, label, xSci, ySci, xLog, yLog }] — the four rows of the Settings panel. */
export const figureAxisFormatSummary = (style) => {
  const s = normalizeFigureStyle(style);
  return FIGURE_KINDS.map((kind) => ({
    kind,
    label: FIGURE_KIND_LABELS[kind],
    ...figureAxisFormatForKind(s, kind)
  }));
};

// …and the AXIS TITLE style / AXIS NUMBER format of the same profile:
//   axisTitleBold / axisTitleItalic   the axis titles ("Wavelength (nm)",
//                                     "Intensity (a.u.)") of every figure.
//   tickSci                           LEGACY, and DERIVED from the sixteen knobs
//                                     of FIGURE_AXIS_FORMAT_FIELDS: true when the
//                                     axis numbers of EVERY axis of EVERY kind
//                                     are in exponential notation (1.23 × 10⁴) —
//                                     which is what a profile saved before they
//                                     existed means. Never written by the panel.
//   tickDecimals                      how many decimals the axis numbers
//                                     show; '' = automatic (the old, untouched
//                                     behaviour of every chart). Shared by the X
//                                     and the Y axis of every kind.
//   xSci / ySci / xLog / yLog         the exponential notation and the LOGARITHMIC
//   (…Spectra / …Atom / …Residue)     scale of the X and the Y axis, PER KIND of
//                                     figure — see FIGURE_AXIS_FORMAT_FIELDS.
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
 *   tickSci             LEGACY + DERIVED (the panel never writes it): true when
 *                       the axis numbers of every axis of every kind are in
 *                       exponential notation — what this knob alone used to mean
 *                       and still means when it is the only one that is set.
 *   tickDecimals        how many decimals the axis NUMBERS show ('' = auto,
 *                       0…FIGURE_DECIMALS_MAX).
 *   xSci / ySci / …     the sixteen AXIS FORMAT / AXIS SCALE knobs: the
 *                       exponential notation of the axis NUMBERS and the
 *                       LOGARITHMIC scale of an axis, PER AXIS (X / Y) and PER
 *                       KIND of figure (see FIGURE_AXIS_FORMAT_FIELDS). The
 *                       bare names (xSci / ySci / xLog / yLog) are the GRAPHS,
 *                       the “…Spectra” / “…Atom” / “…Residue” ones the other
 *                       three kinds. The legacy `tickSci` is only READ (a
 *                       profile saved before the axes existed) and DERIVED from
 *                       them — the panel never writes it.
 *   aspect              x-axis length : y-axis length of the plot box of a
 *                       GRAPH — every figure that is not one of the three kinds
 *                       below. 0 = each chart keeps its own ratio.
 *   aspectSpectra       …the same command for the SPECTRA (NMR, CD, ssNMR).
 *   aspectAtom          …the same command for the PER-ATOM plots.
 *   aspectResidue       …the same command for the PER-RESIDUE plots.
 *                       (see FIGURE_ASPECT_MIN and FIGURE_KINDS)
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
  // …and the axis FORMAT / axis SCALE knobs, one per KIND of figure (see
  // FIGURE_AXIS_FORMAT_FIELDS): the exponential notation and the log scale of
  // the X and of the Y axis — for the graphs (the historical names), the
  // spectra, the per-atom plots and the per-residue plots. All false = every
  // axis keeps the format and the scale each chart shows today.
  xSci: false, ySci: false, xLog: false, yLog: false,
  xSciSpectra: false, ySciSpectra: false, xLogSpectra: false, yLogSpectra: false,
  xSciAtom: false, ySciAtom: false, xLogAtom: false, yLogAtom: false,
  xSciResidue: false, ySciResidue: false, xLogResidue: false, yLogResidue: false,
  // ONE plot-box ratio per KIND of figure (see FIGURE_KINDS): the spectra, the
  // per-atom plots, the per-residue plots and — the historical key, last —
  // every other graph. 0 = that kind keeps the ratio of its own 🎨 panel.
  aspect: 0,
  aspectSpectra: 0,
  aspectAtom: 0,
  aspectResidue: 0,
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
export const FIGURE_STYLE_FIELDS = [
  'fontFamily', 'fontSize', 'axisTitleFontSize', 'legendFontSize', 'simLabelFontSize',
  'tickAngle', 'axisTitleBold', 'axisTitleItalic', 'tickSci', 'tickDecimals',
  'aspect', 'aspectSpectra', 'aspectAtom', 'aspectResidue',
  // …and the sixteen axis format / scale knobs (kind by kind, axis by axis):
  // the exponential notation and the log scale of the X / Y axis of each kind
  // of figure (see FIGURE_AXIS_FORMAT_FIELDS).
  ...FIGURE_AXIS_FORMAT_FIELDS
];
export const FIGURE_SPECTRA_FIELDS = ['simLabelFontSize', 'tickAngle'];

// The cfg keys of the AXIS TITLE style / AXIS NUMBER format / AXIS SCALE. They
// are the very keys the 🎨 Graphical Parameters panel writes (xAxisLabelBold,
// xSci, xLog, xDecimals…), so a global knob and a per-chart command are the
// same thing to every chart — see cfgAxisLabel / cfgTickFormatter / cfgLogScale
// in SharedAnalysisTools.
export const FIGURE_AXIS_CFG_KEYS = {
  bold: ['xAxisLabelBold', 'yAxisLabelBold'],
  italic: ['xAxisLabelItalic', 'yAxisLabelItalic'],
  sci: ['xSci', 'ySci'],
  log: ['xLog', 'yLog'],
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
  // The axis FORMAT / SCALE knobs, one per axis × kind of figure (see
  // FIGURE_AXIS_FORMAT_FIELDS). A profile saved before they existed carries only
  // the legacy `tickSci` knob — “exponential on both axes of EVERY figure”: it
  // is expanded here onto the eight sci knobs, so such a profile keeps styling
  // every figure exactly the way it used to. It is expanded only while no sci
  // knob of its own is on — as soon as the profile says WHICH axis / kind it
  // wants, that is what wins.
  const axisFormat = {};
  const rawSciOn = FIGURE_KINDS.some((kind) =>
    toBool(s[figureAxisFormatField('xSci', kind)]) || toBool(s[figureAxisFormatField('ySci', kind)]));
  const legacySci = !rawSciOn && toBool(s.tickSci);
  FIGURE_KINDS.forEach((kind) => {
    FIGURE_AXIS_BASES.forEach((base) => {
      const field = figureAxisFormatField(base, kind);
      axisFormat[field] = toBool(s[field]) || (legacySci && (base === 'xSci' || base === 'ySci'));
    });
  });
  // `tickSci` is DERIVED back (true when all eight sci knobs are on) and never
  // written by the panel: the tag of a profile that asks for exponential
  // notation everywhere is therefore the one it has always been.
  const allSci = FIGURE_KINDS.every((kind) =>
    axisFormat[figureAxisFormatField('xSci', kind)] && axisFormat[figureAxisFormatField('ySci', kind)]);
  return {
    fontFamily: normalizeFigureFont(s.fontFamily),
    fontSize: clampFigureFont(s.fontSize),
    axisTitleFontSize: clampFigureFont(s.axisTitleFontSize, DEFAULT_FIGURE_STYLE.axisTitleFontSize),
    legendFontSize: clampFigureFont(s.legendFontSize, DEFAULT_FIGURE_STYLE.legendFontSize),
    simLabelFontSize: clampFigureFont(s.simLabelFontSize, DEFAULT_FIGURE_STYLE.simLabelFontSize),
    tickAngle: clampFigureAngle(s.tickAngle),
    axisTitleBold: toBool(s.axisTitleBold),
    axisTitleItalic: toBool(s.axisTitleItalic),
    tickSci: allSci,
    tickDecimals: clampFigureDecimals(s.tickDecimals),
    // …and the sixteen axis format / scale knobs (kind by kind, axis by axis).
    ...axisFormat,
    aspect: clampFigureAspect(s.aspect),
    // …and one ratio per kind of figure (see FIGURE_KINDS): a profile saved
    // before they existed simply reads 0 = “that kind keeps its own ratio”.
    aspectSpectra: clampFigureAspect(s.aspectSpectra),
    aspectAtom: clampFigureAspect(s.aspectAtom),
    aspectResidue: clampFigureAspect(s.aspectResidue),
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

/* ── SAVED CONFIGURATIONS ────────────────────────────────────────────────────
   The profile above is ONE style — the one the 🎨 button applies. A user who
   prints figures (oversized characters, a poster ratio, the font of a journal)
   and the same user who simply works in the app (small characters) needs
   SEVERAL of them; `labFigureStyles` is where they are SAVED, so switching is
   one click instead of re-typing four sizes, the axis switches and the ratios.

   A stored entry is `{ id, name, style, savedAt }`:
     • `style` is a FULL profile, normalized on the way in exactly like the live
       one, so a configuration is never “half of a style”;
     • the TAG of a configuration is never stored — it is derived from its style
       (`figureStyleTag`), so a configuration saved yesterday is still recognised
       today as “the style this page already uses”.

   Same storage convention as the profile and the figure library: memory first,
   localStorage best-effort (a full quota never breaks the feature for the
   session), listeners for the UI, plus a `lab:*` window event.
   ─────────────────────────────────────────────────────────────────────────── */
export const FIGURE_STYLE_LIBRARY_KEY = 'labFigureStyles';
export const FIGURE_STYLE_LIBRARY_EVENT = 'lab:figure-style-library-changed';
// A library is a handful of styles, not a database: past this the OLDEST
// configuration is dropped, so a runaway “save” cannot fill localStorage and
// starve the payload the workspace already keeps there.
export const FIGURE_STYLE_PRESET_MAX = 24;
export const FIGURE_STYLE_PRESET_NAME_MAX = 40;

/** A single-line, short name — it is shown in a select and under a tag line. */
export const normalizeFigureStyleConfigName = (v) => {
  if (v == null) return '';
  return String(v).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, FIGURE_STYLE_PRESET_NAME_MAX);
};

/** The name of a profile when the user gives none: its four sizes, e.g. “16/18/16/16 px”. */
export const figureStyleConfigName = (style = null) => {
  const s = normalizeFigureStyle(style || readFigureStyle());
  const rot = s.tickAngle ? ` · rot ${s.tickAngle}°` : '';
  return `${s.fontSize}/${s.axisTitleFontSize}/${s.legendFontSize}/${s.simLabelFontSize} px${rot}`;
};

/**
 * Same LOOK? Every field of FIGURE_STYLE_FIELDS — i.e. everything that ends up
 * in a figure. `applyOnOpen` is deliberately left out: it says WHEN a page
 * styles itself, not how its figures look, so switching it on must not make the
 * configuration that is currently in use “disappear” from the panel.
 */
export const figureStylesEqual = (a, b) => {
  const x = normalizeFigureStyle(a);
  const y = normalizeFigureStyle(b);
  return FIGURE_STYLE_FIELDS.every((k) => sameStyleValue(x[k], y[k]));
};

/** One line describing a configuration (under its name in Settings, in the 🎨 chip). */
export const figureStyleConfigSummary = (style = null) => {
  const s = normalizeFigureStyle(style || readFigureStyle());
  const parts = [`${s.fontSize}/${s.axisTitleFontSize}/${s.legendFontSize}/${s.simLabelFontSize} px`];
  if (s.tickAngle) parts.push(`rot ${s.tickAngle}°`);
  if (s.axisTitleBold) parts.push('bold');
  if (s.axisTitleItalic) parts.push('italic');
  if (s.tickDecimals !== '') parts.push(`${s.tickDecimals} dec`);
  const on = (prefix) => FIGURE_AXIS_FORMAT_FIELDS.filter((f) => f.startsWith(prefix) && s[f]).length;
  const sci = on('xSci') + on('ySci');
  const log = on('xLog') + on('yLog');
  if (sci) parts.push(sci === FIGURE_KINDS.length * 2 ? 'exponential axes (all)' : `exponential ×${sci}`);
  if (log) parts.push(`log ×${log}`);
  const ratios = FIGURE_KINDS
    .map((kind) => (s[FIGURE_KIND_FIELDS[kind]] > 0 ? `${kind} ${s[FIGURE_KIND_FIELDS[kind]]}:1` : ''))
    .filter(Boolean);
  if (ratios.length) parts.push(...ratios);
  if (s.fontFamily) parts.push(s.fontFamily.split(',')[0].replace(/"/g, '').trim());
  return parts.join(' · ');
};

const genFigureStyleConfigId = () => `figstyle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/** Anything (a stored entry, a half entry, a foreign object) → a configuration, or null. */
const normalizeFigureStyleConfig = (raw) => {
  const src = raw && typeof raw === 'object' ? raw : null;
  if (!src || src.style == null) return null;   // an entry without a profile is not a configuration
  const style = normalizeFigureStyle(src.style);
  return {
    id: typeof src.id === 'string' && src.id ? src.id : genFigureStyleConfigId(),
    name: normalizeFigureStyleConfigName(src.name) || figureStyleConfigName(style),
    style,
    savedAt: typeof src.savedAt === 'string' && src.savedAt ? src.savedAt : new Date().toISOString()
  };
};

let memConfigs = null;

/** A stored list (or anything at all) → the valid, de-duplicated configurations, capped. */
const normalizeFigureStyleConfigList = (list) => {
  const out = [];
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach((entry) => {
    const c = normalizeFigureStyleConfig(entry);
    if (!c || seen.has(c.id)) return;
    seen.add(c.id);
    if (out.length < FIGURE_STYLE_PRESET_MAX) out.push(c);
  });
  return out;
};

const loadFigureStyleConfigs = () => {
  let raw = null;
  try { raw = typeof localStorage !== 'undefined' ? localStorage.getItem(FIGURE_STYLE_LIBRARY_KEY) : null; } catch { raw = null; }
  let list = raw;
  if (typeof raw === 'string') { try { list = JSON.parse(raw); } catch { list = null; } }
  return normalizeFigureStyleConfigList(list);
};

/** The saved configurations, newest first. */
export const readFigureStyleConfigs = () => {
  if (memConfigs === null) memConfigs = loadFigureStyleConfigs();
  return memConfigs;
};

const configListeners = new Set();
/** Subscribe to the saved configurations. Returns the unsubscribe function. */
export const subscribeFigureStyleConfigs = (fn) => {
  if (typeof fn !== 'function') return () => {};
  configListeners.add(fn);
  return () => { configListeners.delete(fn); };
};

export const writeFigureStyleConfigs = (list) => {
  const next = normalizeFigureStyleConfigList(list);
  memConfigs = next;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(FIGURE_STYLE_LIBRARY_KEY, JSON.stringify(next));
  } catch { /* quota full — memory keeps the copy */ }
  configListeners.forEach((fn) => { try { fn(next); } catch { /* ignore */ } });
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FIGURE_STYLE_LIBRARY_EVENT, { detail: next }));
  } catch { /* ignore */ }
  return next;
};

/** One saved configuration by id (null when it was deleted meanwhile). */
export const figureStyleConfigById = (id) => readFigureStyleConfigs().find((c) => c.id === id) || null;

/** The saved configuration whose style IS this profile (the live one by default). */
export const figureStyleConfigForStyle = (style = null) => {
  const profile = style || readFigureStyle();
  return readFigureStyleConfigs().find((c) => figureStylesEqual(c.style, profile)) || null;
};

/**
 * SAVE the current settings (or a given profile) under a name.
 * A name that already exists — same name, whatever the case — is REPLACED, so
 * “save again” updates a configuration instead of duplicating it. An empty name
 * falls back to the sizes of the profile (see figureStyleConfigName).
 * Returns `{ config, created, replaced, dropped }`; `dropped` counts the oldest
 * configurations the cap pushed out (0 in the normal case).
 */
export const saveFigureStyleConfig = (name = '', style = null) => {
  const profile = normalizeFigureStyle(style || readFigureStyle());
  const label = normalizeFigureStyleConfigName(name) || figureStyleConfigName(profile);
  const key = label.toLowerCase();
  const list = readFigureStyleConfigs();
  const at = list.findIndex((c) => c.name.toLowerCase() === key);
  const config = {
    id: at >= 0 ? list[at].id : genFigureStyleConfigId(),
    name: label,
    style: profile,
    savedAt: new Date().toISOString()
  };
  const next = at >= 0 ? list.map((c, i) => (i === at ? config : c)) : [config, ...list];
  const dropped = Math.max(0, next.length - FIGURE_STYLE_PRESET_MAX);
  writeFigureStyleConfigs(next);
  return { config, created: at < 0, replaced: at >= 0, dropped };
};

/**
 * RENAME a configuration. `null` when the id is unknown, the name is empty, or
 * another configuration already uses it (two configurations with the same name
 * could not be told apart in the list nor replaced by name).
 */
export const renameFigureStyleConfig = (id, name) => {
  const label = normalizeFigureStyleConfigName(name);
  if (!id || !label) return null;
  const list = readFigureStyleConfigs();
  const entry = list.find((c) => c.id === id);
  if (!entry) return null;
  if (entry.name === label) return entry;   // already called that — nothing to write
  if (list.some((c) => c.id !== id && c.name.toLowerCase() === label.toLowerCase())) return null;
  const renamed = { ...entry, name: label };
  writeFigureStyleConfigs(list.map((c) => (c.id === id ? renamed : c)));
  return renamed;
};

/** DELETE a configuration. Returns the entry that was removed, or null. */
export const deleteFigureStyleConfig = (id) => {
  const list = readFigureStyleConfigs();
  const gone = list.find((c) => c.id === id) || null;
  if (!gone) return null;
  writeFigureStyleConfigs(list.filter((c) => c.id !== id));
  return gone;
};

/**
 * SWITCH to a saved configuration: it BECOMES the profile (so the Settings page
 * shows it and every page opened later starts from it), and with
 * `options.slots` it is pushed into the charts of the page that is open right
 * now — the one-click switch of the 🎨 Figure style button.
 * Returns `{ config, style, tag, applied, changed, total }`, or null.
 */
export const applyFigureStyleConfig = (id, options = null) => {
  const config = figureStyleConfigById(id);
  if (!config) return null;
  const style = writeFigureStyle(config.style);
  const pushed = options && options.slots ? applyFigureStyleEverywhere(style, options) : null;
  return {
    config,
    style,
    tag: figureStyleTag(style),
    applied: !!pushed,
    changed: pushed ? pushed.changed : 0,
    total: pushed ? pushed.total : 0
  };
};

/**
 * The whole library as JSON text — a copy that survives a cleared browser, or
 * that moves the configurations to another machine. The ids stay out of it (an
 * impostor id could point at the wrong entry); a name is what identifies a
 * configuration, here as everywhere.
 */
export const exportFigureStyleConfigs = () => JSON.stringify(
  readFigureStyleConfigs().map(({ name, style, savedAt }) => ({ name, style, savedAt })),
  null,
  2
);

/**
 * IMPORT a backup: the text of exportFigureStyleConfigs, a bare list of
 * configurations, or one configuration. An entry whose name already exists is
 * REPLACED (the rule of a manual save), so importing the same backup twice never
 * duplicates anything — and a corrupt payload never throws nor wipes the
 * library. Returns `{ added, replaced, skipped, error }`; an entry with no
 * profile at all is `skipped`.
 */
export const importFigureStyleConfigs = (text) => {
  let raw = text;
  if (typeof text === 'string') {
    try { raw = JSON.parse(text); } catch { return { added: 0, replaced: 0, skipped: 0, error: 'invalid' }; }
  }
  const items = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? [raw] : []);
  // A config of the export (`{ name, style }`) or a bare profile (any known key).
  const styleSource = (item) => {
    if (!item || typeof item !== 'object') return null;
    if (item.style != null) return item.style;
    return FIGURE_STYLE_FIELDS.some((k) => k in item) ? item : null;
  };
  let list = readFigureStyleConfigs();
  let added = 0;
  let replaced = 0;
  let skipped = 0;
  items.forEach((item) => {
    const src = styleSource(item);
    if (!src || (typeof src !== 'object' && typeof src !== 'string')) { skipped += 1; return; }
    const style = normalizeFigureStyle(src);
    const label = normalizeFigureStyleConfigName(item.name) || figureStyleConfigName(style);
    const at = list.findIndex((c) => c.name.toLowerCase() === label.toLowerCase());
    const config = {
      id: at >= 0 ? list[at].id : genFigureStyleConfigId(),
      name: label,
      style,
      savedAt: typeof item.savedAt === 'string' && item.savedAt ? item.savedAt : new Date().toISOString()
    };
    list = at >= 0 ? list.map((c, i) => (i === at ? config : c)) : [config, ...list];
    if (at >= 0) replaced += 1;
    else added += 1;
  });
  if (added || replaced) writeFigureStyleConfigs(list);
  return { added, replaced, skipped, error: '' };
};

/**
 * Stable short signature of a profile. It is stored on the test
 * (`test.figureStyleTag`) so a page can tell whether it is already styled and
 * which profile was used for its figures (see the Image Builder notice).
 *
 *   fs<tick>-t<title>-lg<legend>-lb<labels>-rot<angle>[-ar<ratio>]
 *   [-ars<spectra>][-ara<atom>][-arr<residue>][-bold]
 *   [-ital][-sci][-dec<n>][-<Family>]
 *
 * The AXIS FORMAT / SCALE knobs add one suffix per axis × kind that deviates
 * from its default — the kind letter is the one of the ratios (`s` spectra,
 * `a` atom, `r` residue, nothing = graphs), e.g. `-xScis` (the x axis of the
 * spectra), `-yLoga` (the y axis of the per-atom plots), `-xLog` (the x axis of
 * the graphs).
 * When every axis of every kind asks for exponential notation the single
 * historical `sci` is written instead, so a figure captured yesterday is still
 * recognised as “same style” today.
 * e.g. `fs16-t18-lg16-lb16-rot0` (app font) or `fs20-…-Arial`.
 *
 * The optional suffixes are only written when the knob really DEVIATES from its
 * default, so every tag produced before they existed stays byte-identical (a
 * figure captured yesterday is still recognised as "same style" today).
 */
// The sci / log suffixes of the tag: one per axis × kind that deviates from its
// default. When EVERY axis of EVERY kind asks for exponential notation the tag
// keeps the single historical `sci` suffix instead — that is what a profile
// written before the knobs grew axes / kinds carries (`tickSci`), and what
// figureAxisAllSci() answers. Suffixes run kind by kind (spectra `s`, atom `a`,
// residue `r`, graphs nothing) and axis by axis, e.g. `-xScis` (the x axis of
// the spectra), `-yLoga` (the y axis of the per-atom plots), `-xLog` (the x axis
// of the graphs).
const FIGURE_AXIS_TAG_KIND = { spectra: 's', atom: 'a', residue: 'r', graph: '' };
const axisFormatTagSuffixes = (s) => {
  if (figureAxisAllSci(s)) return ['sci'];
  const out = [];
  FIGURE_KINDS.forEach((kind) => {
    FIGURE_AXIS_BASES.forEach((base) => {
      if (s[figureAxisFormatField(base, kind)]) out.push(`${base}${FIGURE_AXIS_TAG_KIND[kind]}`);
    });
  });
  return out;
};

export const figureStyleTag = (style) => {
  const s = normalizeFigureStyle(style || readFigureStyle());
  const fam = s.fontFamily ? `-${s.fontFamily.replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}` : '';
  // The ratio only shows in the tag when it is imposed (0 = "each chart keeps
  // its own"), so every tag written before this knob existed stays identical.
  // ONE suffix per kind of figure (see FIGURE_KINDS): `ar` = the graphs — the
  // historical suffix — then the spectra / per-atom / per-residue ratios.
  const kindAr = [
    s.aspect > 0 ? `ar${s.aspect}` : '',
    s.aspectSpectra > 0 ? `ars${s.aspectSpectra}` : '',
    s.aspectAtom > 0 ? `ara${s.aspectAtom}` : '',
    s.aspectResidue > 0 ? `arr${s.aspectResidue}` : ''
  ].filter(Boolean).join('-');
  const ar = kindAr ? `-${kindAr}` : '';
  const axis = [
    s.axisTitleBold ? 'bold' : '',
    s.axisTitleItalic ? 'ital' : '',
    ...axisFormatTagSuffixes(s),
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
 *   • `axisTitleBold`, `axisTitleItalic`, `tickDecimals` → the cfg
 *     keys `xAxisLabelBold` / `yAxisLabelBold` / … / `xDecimals` / `yDecimals`
 *     (the same ones the 🎨 panel writes): turned ON they reach every chart cfg
 *     of the page (figureCfgAcceptsAxisStyle), turned back to their default
 *     they are cleared on the cfgs that carry them.
 *   • the sixteen AXIS FORMAT / SCALE knobs (see FIGURE_AXIS_FORMAT_FIELDS) →
 *     the same cfg keys (`xSci` / `ySci` / `xLog` / `yLog`, the exponential
 *     notation and the log scale of an axis, the very keys cfgTickFormatter /
 *     cfgLogScale read). They are resolved PER KIND of figure: a chart that
 *     declared `figureKind="atom"` takes the atom ones, a chart that declared
 *     nothing takes the graph ones.
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
  // The ratio depends on WHAT the figure is — a spectrum, a per-atom plot, a
  // per-residue plot or a plain graph (see FIGURE_KINDS). `options.kind` is the
  // kind the chart declared when it registered its slot; a chart that declares
  // nothing is a GRAPH, i.e. it keeps following the historical `aspect` knob.
  const ratio = figureAspectForKind(s, options && options.kind);
  if (ratio > 0) {
    out.aspect = ratio;
    out[FIGURE_ASPECT_KEY] = ratio;
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
  // The exponential notation and the log scale are PER AXIS (X / Y) and PER KIND
  // of figure: WHICH profile field is read depends on the kind the chart
  // declared when it registered its slot (`options.kind`), while the cfg key
  // written is always the panel's own (xSci / ySci / xLog / yLog). A chart that
  // declares no kind is a GRAPH, i.e. it keeps the historical behaviour.
  FIGURE_AXIS_BASES.forEach((base) => {
    onOff(!!s[figureAxisFormatField(base, options && options.kind)], [base]);
  });
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
   `kind` says WHAT the figure is (see FIGURE_KINDS) — the fan-out then hands it
   the plot-box ratio the profile defines for that kind of figure.
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
  // `kind` = what this figure IS (a spectrum? a per-atom plot? a per-residue
  // plot? a graph? — see FIGURE_KINDS), so the fan-out can hand it the ratio of
  // Settings → Figure style that belongs to it. A slot without a kind is a
  // GRAPH, which is the historical behaviour of the whole profile.
  slots.set(id, { id, get: slot.get, set: slot.set, kind: normalizeFigureKind(slot.kind) });
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
    const next = applyFigureStyleToCfg(cur, profile, { ...(options || {}), kind: slot.kind });
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
