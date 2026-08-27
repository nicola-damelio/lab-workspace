import React from 'react';

/* =========================================================================
   StarToggle — "import into the project document" toggle.

   Shown next to figures, plots and tables on the test pages. When active
   (★) the item is imported into the project's 📄 Export document.
   ========================================================================= */
export const StarToggle = ({ active = false, onToggle, title, disabled = false, className = '' }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (!disabled && onToggle) onToggle(); }}
    title={title || (active ? 'Remove from project document' : 'Import into project document')}
    aria-pressed={active}
    className={`shrink-0 inline-flex items-center justify-center rounded-full w-6 h-6 text-sm font-bold transition-all shadow-sm border select-none ${
      disabled
        ? 'bg-slate-50 text-slate-300 border-slate-200 cursor-not-allowed'
        : active
          ? 'bg-amber-400 text-white border-amber-500 hover:bg-amber-500'
          : 'bg-white text-amber-500 border-amber-300 hover:bg-amber-50'
    } ${className}`}
    style={{ lineHeight: 1 }}
  >
    {active ? '★' : '☆'}
  </button>
);

export default StarToggle;
