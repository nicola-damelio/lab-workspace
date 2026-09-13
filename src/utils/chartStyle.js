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
  return { left: pad, right: pad, top: pad, bottom: pad };
};

export const chartJsHeightFit = (height, cfg = {}, opts = {}) => {
  const h = Number(height) || 380;
  const yRoom = axisTitleRoomPx([opts.yTitle, cfg.yAxisLabel], cfg.fontSize);
  return Math.max(h, yRoom + 150);
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

/** Swatches for the "Base colour" picker (null = auto rainbow). */
export const BASE_COLOR_SWATCHES = [
  { label: '🌈 Rainbow', hex: null },
  ...rainbowColors(12).map((hex) => ({ label: hex, hex })),
];
