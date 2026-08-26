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

export const VIS_PALETTES = {
  default: ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'],
  viridis: ['#440154', '#482878', '#3e4a89', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'],
  magma: ['#000004', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf'],
  ocean: ['#082f49', '#1e3a8a', '#1d4ed8', '#2563eb', '#3b82f6', '#60a5fa', '#93c5fd'],
  warm: ['#7f1d1d', '#991b1b', '#b91c1c', '#dc2626', '#ef4444', '#f87171', '#fca5a5'],
  neon: ['#ff00ff', '#00ffff', '#00ff00', '#ffff00', '#ff0000', '#0000ff'],
  pastel: ['#fbcfe8', '#fecaca', '#fde68a', '#bbf7d0', '#a7f3d0', '#bfdbfe', '#c7d2fe', '#e9d5ff'],
  earth: ['#78350f', '#92400e', '#b45309', '#d97706', '#f59e0b', '#fbbf24', '#fcd34d'],
  monochrome: ['#0f172a', '#1e293b', '#334155', '#475569', '#64748b', '#94a3b8', '#cbd5e1']
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
