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
