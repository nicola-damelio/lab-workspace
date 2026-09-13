/* =========================================================================
   src/utils/chartStyle.js
   Shared chart / style constants that were previously copy-pasted into
   nearly every page's sections file (NMR, ssNMR, CD, Flow Cytometry, Plate,
   MD). All values were byte-identical across the copies at consolidation
   time, so moving them here is a pure deduplication with no behaviour change.
   ========================================================================= */

export const FS_CLASSES = 'fixed top-4 left-4 z-[999999] bg-white shadow-2xl rounded-2xl !w-[calc(100vw-2rem)] !h-[calc(100vh-2rem)] !max-w-none !max-h-none !m-0 overflow-hidden flex flex-col';

export const OVERLAY_CLASSES = 'fixed top-0 left-0 w-screen h-screen bg-slate-900/50 backdrop-blur-sm z-[999990]';

export const SELECT_COLOR = '#f59e0b';

export const MANUAL_COLOR = '#16a34a';

export const LINE_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16'];

// Per-atom / per-residue palette used by the MD & NMR "per atom" plot panels.
// Previously copy-pasted as MD_PAP_COLORS (MDSections) and PAP_COLORS (NMRSections).
export const PER_ATOM_COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#22c55e', '#ef4444', '#0ea5e9', '#ec4899', '#14b8a6', '#f97316', '#6366f1'];

export const CHART_MARGIN = { top: 20, right: 20, bottom: 45, left: 50 };

export const CHART_MARGIN_1D = { top: 10, right: 15, bottom: 45, left: 15 };

// Default x-axis character dimension (font size) used across all charts.
export const DEFAULT_CHART_FONT_SIZE = 16;

// Default plot-area aspect ratio. 1 = square (x-axis length = y-axis length).
// Spectrum-like plots (CD spectra, 1D NMR, per-atom, chromatograms) keep the
// wide default below.
export const DEFAULT_CHART_ASPECT = 1;
export const DEFAULT_CHART_ASPECT_WIDE = 1.8;

/* =========================================================================
   AXIS-TITLE ROOM — why a bigger character size used to CUT the y-axis label.

   The y-axis title is drawn ROTATED (angle -90), so the room it needs is its
   own LENGTH: a chart shorter than "Intensity (a.u.)" at 24 px clips the
   beginning / the end of the label — the "the y axis label does not fit in the
   canvas and it is cut" report. The x-axis title runs horizontally and only
   needs its cap height, which the bottom margin already reserves.

   The estimates below are the same ones the axis-room helpers of
   SharedAnalysisTools use (average glyph ≈ 0.55 em, titles are drawn 1 px
   above the tick numbers).
   ========================================================================= */
export const textWidthPx = (text, fontSize) =>
  String(text == null ? '' : text).length * (Number(fontSize) || 12) * 0.55;

/** px a set of texts occupies at `fontSize` (longest one wins). */
export const axisTitleRoomPx = (texts, fontSize) => {
  const list = (Array.isArray(texts) ? texts : [texts]).filter(Boolean);
  if (!list.length) return 0;
  const fs = (Number(fontSize) || DEFAULT_CHART_FONT_SIZE) + 1;
  return Math.round(Math.max(...list.map((t) => textWidthPx(t, fs))));
};

// Shared chart-box style: width 100% and a square plot area by default.
// Pass `{ square: false }` for spectrum-like plots (CD, 1D, per-atom,
// chromatograms) that should stay wide. `cfg.aspect` is honoured whenever it
// differs from the (old) wide default — so explicit user choices survive, but
// the new square default is imposed on everything else.
// `opts.yTitle` / `opts.xTitle` (or cfg.yAxisLabel / cfg.xAxisLabel) let the
// box grow so the axis TITLES fit at the current character size.
export const chartBoxStyle = (cfg = {}, opts = {}) => {
  const wide = opts.square === false;
  const a = Number(cfg.aspect);
  let aspect;
  if (wide) {
    aspect = (Number.isFinite(a) && a !== DEFAULT_CHART_ASPECT) ? a : DEFAULT_CHART_ASPECT_WIDE;
  } else {
    aspect = (Number.isFinite(a) && a !== DEFAULT_CHART_ASPECT_WIDE) ? a : DEFAULT_CHART_ASPECT;
  }
  const yRoom = axisTitleRoomPx([opts.yTitle, cfg.yAxisLabel], cfg.fontSize);
  // 220 px is the historical minimum (an unlabelled chart keeps it); a long
  // rotated y title adds the room it really needs (its own length + the plot
  // band / the x numbers and title below it).
  const minHeight = Math.max(220, yRoom + 120);
  const maxHeight = Math.max(Number(cfg.height) || 380, minHeight);
  return {
    width: '100%',
    aspectRatio: String(aspect),
    maxHeight,
    minHeight
  };
};

/* -------------------------------------------------------------------------
   CHART.JS PLOTS (Plate dose-response / IC50, DOSY, NMR fittings…)

   A canvas clips whatever is drawn outside it, and Chart.js reserves only the
   space IT computed — a long rotated y title on a short canvas is cut. The two
   helpers below give those plots the same treatment as the recharts ones:
   a canvas padding derived from the character size, and a container height
   that leaves room for the rotated y title.
   ------------------------------------------------------------------------- */
export const chartJsPadding = (cfg = {}, base = 2) => {
  const fs = Number(cfg.fontSize) || DEFAULT_CHART_FONT_SIZE;
  const pad = Math.round(base + Math.max(0, fs - 12) * 0.5);
  // A positive "Y label gap" pushes the rotated y title further left and a
  // positive "X label gap" pushes the x title further down: the canvas padding
  // reserves exactly that room, so the moved title stays inside the canvas.
  const xg = Math.max(0, cfgAxisGap(cfg, 'x'));
  const yg = Math.max(0, cfgAxisGap(cfg, 'y'));
  return { left: pad + yg, right: pad, top: pad, bottom: pad + xg };
};

export const chartJsHeightFit = (height, cfg = {}, opts = {}) => {
  const h = Number(height) || 380;
  const yRoom = axisTitleRoomPx([opts.yTitle, cfg.yAxisLabel], cfg.fontSize);
  // The rotated title needs the canvas to be TALLER than its own length; a
  // positive shift keeps a little extra room so the moved title is never cut by
  // the canvas edge (the ⭐ capture rasterizes the canvas as-is).
  return Math.max(h, yRoom + 150 + Math.max(0, cfgAxisGap(cfg, 'y')));
};

/* =========================================================================
   RICH PALETTE — rainbow range + dark→light colour degradation.

   The default series palette is now a full rainbow range (24 evenly spaced
   hues). The user can also pick a single base colour; the program then
   degrades that colour from dark to light across the number of curves, e.g.
   blue with 2 curves → [dark blue, very light blue].
   ========================================================================= */

export const hslToHex = (h, s, l) => {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

export const hexToHsl = (hex) => {
  let hx = String(hex || '#3b82f6').replace('#', '').trim();
  if (hx.length === 3) hx = hx.split('').map((c) => c + c).join('');
  const r = parseInt(hx.slice(0, 2), 16) / 255;
  const g = parseInt(hx.slice(2, 4), 16) / 255;
  const b = parseInt(hx.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: Math.round(h * 60), s: Math.round(s * 100), l: Math.round(l * 100) };
};

/** Rich rainbow range: `n` evenly spaced hues around the colour wheel. */
export const rainbowColors = (n = 12) =>
  Array.from({ length: Math.max(1, n) }, (_, i) => hslToHex((i / Math.max(1, n)) * 360, 80, 50));

/** 24-stop rich rainbow used as the default series palette. */
export const RAINBOW_COLORS = rainbowColors(24);

/* =========================================================================
   SHARED SERIES PALETTES — used by Flow Cytometry, CD, NMR, ssNMR and every
   page that renders multiple series. 25 curated combinations (categorical,
   sequential, diverging and rainbow). `default` is kept for backward
   compatibility; `rainbow` is the full 24-stop rainbow.
   ========================================================================= */
export const VIS_PALETTES = {
  default: ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'],
  rainbow: RAINBOW_COLORS,
  viridis: ['#440154', '#482878', '#3e4a89', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'],
  plasma: ['#0d0887', '#46039f', '#7201a8', '#9c179e', '#bd3786', '#d8576b', '#ed7953', '#fb9f3a', '#fdca26', '#f0f921'],
  magma: ['#000004', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf'],
  inferno: ['#000004', '#1b0c41', '#4a0c6b', '#781c6d', '#a52c60', '#cf4446', '#ed6925', '#fb9b06', '#f7d03c', '#fcffa4'],
  turbo: ['#30123b', '#4145ab', '#4675ed', '#39a2fc', '#1bcfd4', '#24eca6', '#61fc6c', '#a4fc3b', '#d1e834', '#f3c63a', '#fe9b2d', '#f36315', '#d93806', '#b11901', '#7a0403'],
  twilight: ['#092b3a', '#1957a4', '#3b8ab7', '#67bfa6', '#9de0a0', '#d9efb8', '#fcfec0', '#fbd07b', '#f59c47', '#e56438', '#c7322e', '#8b1d2a', '#4a1124'],
  ocean: ['#082f49', '#1e3a8a', '#1d4ed8', '#2563eb', '#3b82f6', '#60a5fa', '#93c5fd'],
  cool: ['#5e4fa2', '#3e6b8f', '#2f7d79', '#3c8d5e', '#5a9e3c', '#94b736', '#d1d93d'],
  warm: ['#7f1d1d', '#991b1b', '#b91c1c', '#dc2626', '#ef4444', '#f87171', '#fca5a5'],
  neon: ['#ff00ff', '#00ffff', '#00ff00', '#ffff00', '#ff0000', '#0000ff'],
  pastel: ['#fbcfe8', '#fecaca', '#fde68a', '#bbf7d0', '#a7f3d0', '#bfdbfe', '#c7d2fe', '#e9d5ff'],
  earth: ['#78350f', '#92400e', '#b45309', '#d97706', '#f59e0b', '#fbbf24', '#fcd34d'],
  spectral: ['#9e0142', '#d53e4f', '#f46d43', '#fdae61', '#fee08b', '#ffffbf', '#e6f598', '#abdda4', '#66c2a5', '#3288bd', '#5e4fa2'],
  RdYlBu: ['#a50026', '#d73027', '#f46d43', '#fdae61', '#fee090', '#ffffbf', '#e0f3f8', '#abd9e9', '#74add1', '#4575b4', '#313695'],
  BrBG: ['#543005', '#8c510a', '#bf812d', '#dfc27d', '#f6e8c3', '#f5f5f5', '#c7eae5', '#80cdc1', '#35978f', '#01665e', '#003c30'],
  Paired: ['#a6cee3', '#1f78b4', '#b2df8a', '#33a02c', '#fb9a99', '#e31a1c', '#fdbf6f', '#ff7f00', '#cab2d6', '#6a3d9a', '#ffff99', '#b15928'],
  Set1: ['#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00', '#ffff33', '#a65628', '#f781bf', '#999999'],
  Set2: ['#66c2a5', '#fc8d62', '#8da0cb', '#e78ac3', '#a6d854', '#ffd92f', '#e5c494', '#b3b3b3'],
  Dark2: ['#1b9e77', '#d95f02', '#7570b3', '#e7298a', '#66a61e', '#e6ab02', '#a6761d', '#666666'],
  blues: ['#08306b', '#08519c', '#2171b5', '#4292c6', '#6baed6', '#9ecae1', '#c6dbef', '#deebf7', '#f7fbff'],
  reds: ['#7f0000', '#b30000', '#d7301f', '#ef6548', '#fc8d59', '#fdbb84', '#fdd49e', '#fee8c8', '#fff5f0'],
  greens: ['#00441b', '#006d2c', '#238b45', '#41ab5d', '#74c476', '#a1d99b', '#c7e9c0', '#e5f5e0', '#f7fcf5'],
  purples: ['#3f007d', '#4a1486', '#6a51a3', '#807dba', '#9e9ac8', '#bcbddc', '#dadaeb', '#efedf5', '#fcfbfd'],
  oranges: ['#7f2704', '#a63603', '#d94801', '#f16913', '#fd8d3c', '#fdae6b', '#fdd0a2', '#fee6ce', '#fff5eb'],
  monochrome: ['#0f172a', '#1e293b', '#334155', '#475569', '#64748b', '#94a3b8', '#cbd5e1']
};


/**
 * Degrade a base colour from dark to light across `n` steps.
 * e.g. blue + n=2 => [dark blue, very light blue].
 */
export const shadesFromColor = (baseHex, n = 1) => {
  const { h, s } = hexToHsl(baseHex || '#3b82f6');
  const count = Math.max(1, n);
  if (count === 1) return [baseHex || '#3b82f6'];
  return Array.from({ length: count }, (_, i) => hslToHex(h, s, 30 + (i / (count - 1)) * 55)); // 30% -> 85% lightness
};

/**
 * Resolve the colour of series `idx` out of `total` curves:
 *   • cfg.colors[key]  → explicit per-series override (always wins)
 *   • cfg.baseColor    → dark→light shades of that colour across `total`
 *   • otherwise        → the rich rainbow range
 * When `total` is unknown, degrade over a nominal 12-stop gradient so the
 * first curve is always darkest and later curves get progressively lighter.
 */
export const seriesColorFor = (cfg, key, idx, total) => {
  if (cfg && cfg.colors && cfg.colors[key]) return cfg.colors[key];
  const i = Math.max(0, idx || 0);
  if (cfg && cfg.baseColor) {
    const count = total != null && total > 0 ? total : 12;
    return shadesFromColor(cfg.baseColor, count)[i % count];
  }
  const count = total != null && total > 0 ? total : 12;
  return rainbowColors(count)[i % count];
};

/* =========================================================================
   CHART TYPE — one canonical vocabulary.

   The style panel writes `cfg.chartType` ('line' | 'bar' | 'scatter' | 'area')
   while the pages have their own historical words for the same things
   ('dose-response', 'hist'…). Everything a chart type selects goes through this
   helper so "Bar / Histogram" chosen in the double-click panel REALLY switches
   a dose-response chart to its histogram, and a page-level "hist" choice is not
   silently undone when the panel writes 'bar'.
   ========================================================================= */
export const CHART_TYPES = ['line', 'bar', 'scatter', 'area'];

export const normalizeChartType = (raw, fallback = 'line') => {
  const v = String(raw == null ? '' : raw).trim().toLowerCase();
  if (v === 'hist' || v === 'histogram' || v === 'bar' || v === 'bars') return 'bar';
  if (v === 'scatter' || v === 'points' || v === 'point') return 'scatter';
  if (v === 'area') return 'area';
  if (v === 'line' || v === 'curve' || v === 'dose-response' || v === 'dose_response') return 'line';
  return fallback;
};

/* =========================================================================
   PER-CURVE ("per series") STYLE OVERRIDES

   The style panel's "Chart Appearance" commands are chart-wide, which is not
   enough when several curves share one chart: the user could not give curve 2
   a different symbol / line style from curve 1. `cfg.seriesStyles` holds an
   OPTIONAL override per series key:
     cfg.seriesStyles = {
       'curve key': { chartType, pointStyle, ptSize, lineStyle, lineThickness,
                      color, label, hidden }
     }
   An absent / empty value means "inherit the chart-wide setting", so the
   helpers below always fall back to the global cfg and never change the
   behaviour of a chart that has no overrides.
   ========================================================================= */
export const seriesStyleOf = (cfg, key) => {
  const all = cfg && cfg.seriesStyles;
  if (!all || key == null) return {};
  const one = all[key];
  return one && typeof one === 'object' ? one : {};
};

/** Raw override value for one property ('' / null / undefined = inherit). */
export const seriesOverride = (cfg, key, prop) => {
  const v = seriesStyleOf(cfg, key)[prop];
  if (v === '' || v === null || v === undefined || v === false) return undefined;
  return v;
};

export const seriesChartType = (cfg, key, fallback = null) =>
  seriesOverride(cfg, key, 'chartType')
  || (fallback != null ? normalizeChartType(fallback) : normalizeChartType(cfg && cfg.chartType));

export const seriesPointStyle = (cfg, key) =>
  seriesOverride(cfg, key, 'pointStyle') || (cfg && (cfg.pointStyle || cfg.ptStyle)) || 'circle';

export const seriesPtSize = (cfg, key, fallback = 4) => {
  const v = seriesOverride(cfg, key, 'ptSize');
  const n = Number(v != null ? v : (cfg && cfg.ptSize));
  return Number.isFinite(n) ? n : fallback;
};

export const seriesLineStyle = (cfg, key) =>
  seriesOverride(cfg, key, 'lineStyle') || (cfg && cfg.lineStyle) || 'solid';

export const seriesLineThickness = (cfg, key, fallback = 2) => {
  const v = seriesOverride(cfg, key, 'lineThickness');
  const n = Number(v != null ? v : (cfg && cfg.lineThickness));
  return Number.isFinite(n) ? n : fallback;
};

/** Dash pattern (recharts `strokeDasharray`) of one series. */
export const seriesDash = (cfg, key, scale = 1) => {
  const st = seriesLineStyle(cfg, key);
  if (st === 'dashed') return `${4 * scale} ${4 * scale}`;
  if (st === 'dotted') return `${1 * scale} ${3 * scale}`;
  return undefined;
};

/** True unless the series was switched OFF in the per-curve block. */
export const seriesVisible = (cfg, key) => !seriesStyleOf(cfg, key).hidden;

/** Legend label of one series (the "Label" column of the per-curve block). */
export const seriesLabelOf = (cfg, key, fallback) => {
  const v = seriesOverride(cfg, key, 'label');
  return (v == null ? '' : String(v)) || fallback;
};

/** Colour of one series: per-curve colour > legacy colours[] > auto palette. */
export const seriesColorOf = (cfg, key, idx, total, fallback) => {
  const own = seriesOverride(cfg, key, 'color');
  if (own) return own;
  const legacy = cfg && cfg.colors && key != null ? cfg.colors[key] : null;
  if (legacy) return legacy;
  const i = Math.max(0, idx || 0);
  const count = total != null && total > 0 ? total : 12;
  if (cfg && cfg.baseColor) return shadesFromColor(cfg.baseColor, count)[i % count];
  return fallback || rainbowColors(count)[i % count];
};

/** Is ANY per-curve override set? (used to pick a ComposedChart) */
export const hasSeriesOverrides = (cfg) => {
  const all = cfg && cfg.seriesStyles;
  if (!all || typeof all !== 'object') return false;
  return Object.keys(all).some((k) => {
    const one = all[k];
    return !!one && typeof one === 'object' && Object.keys(one).length > 0;
  });
};

/**
 * Chart.js dataset props for ONE series, from the per-curve block.
 * `base` carries what the page already computed, so a chart with no override
 * keeps exactly the datasets it had. Returns only the overriding props, ready
 * to be spread over the dataset: `{ ...dataset, ...chartJsSeriesStyle(cfg, key, base) }`.
 */
export const chartJsSeriesStyle = (cfg, key, base = {}) => {
  const st = seriesStyleOf(cfg, key);
  const color = seriesOverride(cfg, key, 'color') || base.color;
  const out = {};
  if (color && color !== base.color) {
    out.borderColor = color;
    if (base.backgroundColor == null || base.backgroundColor === base.color) out.backgroundColor = color;
    if (base.pointBackgroundColor == null || base.pointBackgroundColor === base.color) out.pointBackgroundColor = color;
  }
  const ps = seriesOverride(cfg, key, 'pointStyle');
  // Chart.js has no 'none' point style: hiding the symbols means radius 0.
  if (ps === 'none') out.pointRadius = 0;
  else if (ps) out.pointStyle = ps;
  const size = seriesOverride(cfg, key, 'ptSize');
  if (size != null && Number.isFinite(Number(size))) out.pointRadius = Number(size);
  const ls = seriesOverride(cfg, key, 'lineStyle');
  if (ls) out.borderDash = ls === 'dashed' ? [6, 4] : ls === 'dotted' ? [2, 4] : [];
  const lt = seriesOverride(cfg, key, 'lineThickness');
  if (lt != null && Number.isFinite(Number(lt))) out.borderWidth = Number(lt);
  if (st.hidden) out.hidden = true;
  return out;
};

/* =========================================================================
   MANUAL AXIS-TITLE SHIFT — the "X / Y label gap (px)" panel commands.

   Positive = push the title FURTHER from the axis (beyond the tick numbers),
   negative = pull it back towards them. The recharts side already uses it
   (cfgAxisLabel offset + cfgChartMargin); these two helpers bring the SAME
   command to the Chart.js canvases: the title padding of the scale and the
   canvas padding / height the rotated title needs to stay inside the canvas
   (what the ⭐ figure capture and the PNG exports rasterize).
   ========================================================================= */
export const cfgAxisGap = (cfg = {}, axis = 'x') => {
  const raw = axis === 'x' ? cfg.xAxisLabelGap : cfg.yAxisLabelGap;
  if (raw === '' || raw === null || raw === undefined) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};

/** `scales.x.title.padding` / `scales.y.title.padding` for Chart.js. */
export const chartJsTitlePad = (cfg = {}) => ({
  x: Math.max(0, cfgAxisGap(cfg, 'x')),
  y: Math.max(0, cfgAxisGap(cfg, 'y'))
});

/** Swatches for the "Base colour" picker (null = auto rainbow). */
export const BASE_COLOR_SWATCHES = [
  { label: '🌈 Rainbow', hex: null },
  ...rainbowColors(12).map((hex) => ({ label: hex, hex })),
];

/* =========================================================================
   BROKEN ("INTERRUPTED") AXIS — the histogram scale-break.

   When one bar is 10000 and the others are 12, 8, 5… the small bars are
   invisible. The fix used by every graphing package is to INTERRUPT the axis:
   the empty range between the small bars and the huge one is compressed into a
   narrow band (marked with the classic double slash), so both the low bars AND
   the full height of the big one stay readable.

   The commands live in `cfg`:
     cfg.yBreak      true/false     — is the Y axis interrupted?
     cfg.yBreakFrom  number         — top of the LOW (expanded) segment
     cfg.yBreakTo    number         — bottom of the HIGH (expanded) segment
     cfg.yBreakGap   % of the axis  — height of the compressed band (default 7 %)
   `xBreak*` are the same commands for an interrupted X axis.

   The values themselves are NEVER modified (no data is rescaled): only the
   value→pixel mapping changes, so the tooltips, the exports and the numbers of
   the axis keep showing the real values.
   ========================================================================= */
export const AXIS_BREAK_GAP_DEFAULT = 7;

/** Parse the break commands of one axis: `{ on, axis, from, to, gap, share }`. */
export const axisBreakOf = (cfg = {}, axis = 'y') => {
  const k = axis === 'x' ? 'x' : 'y';
  const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
  const from = num(cfg[`${k}BreakFrom`]);
  const to = num(cfg[`${k}BreakTo`]);
  let gap = num(cfg[`${k}BreakGap`]);
  if (!Number.isFinite(gap)) gap = AXIS_BREAK_GAP_DEFAULT;
  gap = Math.min(40, Math.max(1, gap)) / 100;
  let share = num(cfg[`${k}BreakShare`]);
  if (!Number.isFinite(share)) share = 50;
  share = Math.min(85, Math.max(15, share)) / 100;
  const ok = !!cfg[`${k}Break`] && Number.isFinite(from) && Number.isFinite(to) && to > from;
  return { on: ok, axis: k, from: ok ? from : 0, to: ok ? to : 0, gap, share };
};

/**
 * Automatic break bounds for a histogram: when the biggest value dwarfs the
 * second biggest (×3 by default) the axis is interrupted between them, so the
 * "Interrupt Y axis" tick alone is enough — no numbers to type.
 */
export const autoBreakBounds = (values, factor = 3) => {
  const nums = (Array.isArray(values) ? values : [])
    .map(Number)
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  if (nums.length < 3) return null;
  const max = nums[nums.length - 1];
  const second = nums[nums.length - 2];
  if (!(second > 0) || max < second * factor) return null;
  return { from: second * 1.2, to: max };
};

/**
 * The break to use for one axis: the panel numbers when they are set, otherwise
 * an automatic break computed from the plotted values (null when the switch is
 * off or the data has no dramatic gap).
 */
export const axisBreakFor = (cfg = {}, axis = 'y', values = []) => {
  const k = axis === 'x' ? 'x' : 'y';
  const brk = axisBreakOf(cfg, axis);
  if (brk.on) return brk;
  if (!cfg[`${k}Break`]) return brk;
  const auto = autoBreakBounds(values);
  if (!auto) return brk;
  return { on: true, axis: k, from: auto.from, to: auto.to, gap: brk.gap, share: brk.share, auto: true };
};

/** "Nice" tick step (1 / 2 / 5 × 10ⁿ) for a wanted number of ticks. */
export const niceStep = (span, count = 6) => {
  const s = Math.abs(Number(span));
  const n = Math.max(2, Math.round(Number(count) || 6));
  if (!(s > 0)) return 1;
  const raw = s / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return mult * mag;
};

/**
 * The two visible pieces of a broken axis, in FRACTION of the axis length:
 *   value ≤ from  →  [0, lowFrac]            (the low bars, expanded)
 *   from … to     →  [lowFrac, lowFrac+gap]  (the interrupted band)
 *   value ≥ to    →  [lowFrac+gap, 1]        (the tall bars, expanded)
 *
 * The two parts split the axis EVENLY (`brk.share`, default 50 %) — the classic
 * interrupted-axis look. Splitting them in proportion to their value span would
 * give the low bars 1 % of the plot as soon as the big bar is 100× larger, i.e.
 * exactly what the interruption is supposed to fix.
 *
 * Returns null when the break is off or sits completely outside [lo, hi].
 */
export const breakSegments = (brk, lo, hi) => {
  if (!brk || !brk.on) return null;
  const a = Number(lo);
  const b = Number(hi);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !(b > a)) return null;
  const from = Math.min(Math.max(brk.from, a), b);
  const to = Math.min(Math.max(brk.to, a), b);
  if (!(to > from)) return null;
  const gapFrac = Math.min(Math.max(brk.gap, 0), 0.5);
  const share = Math.min(Math.max(Number.isFinite(brk.share) ? brk.share : 0.5, 0.15), 0.85);
  const lowFrac = share * (1 - gapFrac);
  return {
    lo: a, hi: b, from, to,
    lowSpan: from - a,
    highSpan: b - to,
    lowFrac,
    gapFrac,
    share
  };
};

/** value → fraction (0..1) of a broken axis. */
export const breakMapFrac = (seg, value) => {
  if (!seg) return null;
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  const { lo, from, to, lowSpan, highSpan, lowFrac, gapFrac } = seg;
  const a = lowFrac;
  const b = lowFrac + gapFrac;
  if (v <= from) return lowSpan > 0 ? ((v - lo) / lowSpan) * lowFrac : 0;
  // Nothing is visible above `to` (the break reaches the top of the axis): the
  // values above it sit ON the top edge, exactly like a clipped histogram.
  if (v >= to) return highSpan > 0 ? b + ((v - to) / highSpan) * (1 - b) : 1;
  // Inside the interrupted band: keep the relative position instead of dropping
  // the point, so a value sitting in the gap stays visible (squeezed).
  return a + ((v - from) / (to - from)) * gapFrac;
};

/** fraction (0..1) of a broken axis → value (the inverse of breakMapFrac). */
export const breakFracValue = (seg, frac) => {
  if (!seg) return NaN;
  const { lo, from, to, lowSpan, highSpan, lowFrac, gapFrac } = seg;
  const a = lowFrac;
  const b = lowFrac + gapFrac;
  const f = Math.min(Math.max(Number(frac) || 0, 0), 1);
  if (f <= a) return lowSpan > 0 && a > 0 ? lo + (f / a) * lowSpan : from;
  if (f >= b) return highSpan > 0 && b < 1 ? to + ((f - b) / (1 - b)) * highSpan : to;
  return gapFrac > 0 ? from + ((f - a) / gapFrac) * (to - from) : from;
};

/**
 * Ticks of a broken axis, in REAL values: the two edges of the interruption are
 * always kept, every tick falling inside the compressed band is dropped.
 */
export const breakTicks = (seg, step) => {
  if (!seg) return null;
  const { lo, hi, from, to } = seg;
  const st = Number(step) > 0 ? Number(step) : niceStep((hi - lo) - (to - from), 6);
  const eps = Math.abs(st) / 1e6;
  const out = [from, to];
  for (let i = Math.ceil((lo - eps) / st); i * st <= hi + eps; i++) {
    const v = i * st;
    if (v <= from + eps || v >= to - eps) out.push(v);
  }
  return out
    .sort((x, y) => x - y)
    .filter((v, i, arr) => i === 0 || Math.abs(v - arr[i - 1]) > eps);
};

/**
 * A recharts-compatible scale: a callable carrying the d3-scale methods recharts
 * v3 uses (copy / domain / range / invert / ticks). Recharts calls
 * `scale.copy().domain(axisDomain).range(axisRange)`, where the domain may be
 * computed from the data ('auto'), so nothing has to be precomputed here.
 */
export const brokenScale = (brk) => {
  if (!brk || !brk.on) return null;
  let dom = [0, 1];
  let rng = [0, 1];
  const seg = () => breakSegments(brk, dom[0], dom[1]);
  const scale = (v) => {
    const f = breakMapFrac(seg(), v);
    if (f == null) return NaN;
    return rng[0] + f * (rng[1] - rng[0]);
  };
  scale.copy = () => brokenScale(brk);
  scale.domain = (d) => {
    if (!d) return dom;
    dom = [Number(d[0]), Number(d[1])];
    return scale;
  };
  scale.range = (r) => {
    if (!r) return rng;
    rng = [Number(r[0]), Number(r[1])];
    return scale;
  };
  scale.invert = (px) => {
    const f = rng[1] - rng[0] !== 0 ? (Number(px) - rng[0]) / (rng[1] - rng[0]) : 0;
    return breakFracValue(seg(), f);
  };
  scale.ticks = (count) => breakTicks(seg(), niceStep(dom[1] - dom[0], count || 6)) || [];
  scale.tickFormat = () => (v) => String(v);
  return scale;
};

/**
 * Chart.js axis options for a broken Y (or X) axis — spread them over the axis
 * options: `{ ...options.scales.y, ...chartJsBrokenAxisOptions(cfg, 'y') }`.
 * 'brokenLinear' is the scale type registered by utils/chartJsBrokenAxis.
 */
export const chartJsBrokenAxisOptions = (cfg = {}, axis = 'y') => {
  const brk = axisBreakOf(cfg, axis);
  if (!brk.on) return null;
  return { type: 'brokenLinear', breakFrom: brk.from, breakTo: brk.to, breakGap: brk.gap };
};

/** `${axis}Break` / `${axis}BreakFrom` … — the commands the panel writes. */
export const axisBreakPatch = (axis, patch) => {
  const k = axis === 'x' ? 'x' : 'y';
  const out = {};
  Object.keys(patch || {}).forEach((key) => { out[`${k}${key}`] = patch[key]; });
  return out;
};
