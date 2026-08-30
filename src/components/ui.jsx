import React, { useState, useEffect } from 'react';
import { Icon } from './Icons';

/* =========================================================================
   src/components/ui.jsx
   Shared UI primitives used across several pages of the app.

   Previously each page shipped its own private copy of these components
   (8+ duplicate CollapsibleSection implementations with subtly different
   behaviour). They now live here so all pages share one definition.

   CollapsibleSection      : accordion "card" style used by the test tabs
                             (title + optional icon, headerExtra, rotating
                             chevron, p-6 content). Default: closed.
   CollapsibleSectionPanel : plain "panel" style used in the library /
                             settings screens (small uppercase title,
                             optional subtitle, ▲/▼ chevron, px-4 pb-4
                             content). Default: closed.

   Both subscribe to the "Expand all / Collapse all" command issued by the
   top-bar button of the experiment pages (see setSectionsCommand below).
   ========================================================================= */

// ---- "Expand all / Collapse all" command store -------------------------
// The top-bar button calls setSectionsCommand(true/false). Every collapsible
// subscribes via useSectionsCommand(). The command is kept for a short window
// so NESTED sections that only mount after their parent opens still honour it.
let sectionsCmd = null;
const SECTIONS_CMD_TTL = 3000;
const sectionsCmdListeners = new Set();

export const setSectionsCommand = (open) => {
  sectionsCmd = { open: !!open, at: Date.now() };
  sectionsCmdListeners.forEach((fn) => fn(!!open));
};

const subscribeSectionsCommand = (fn) => {
  sectionsCmdListeners.add(fn);
  return () => { sectionsCmdListeners.delete(fn); };
};

const isSectionsCommandFresh = () =>
  !!sectionsCmd && Date.now() - sectionsCmd.at < SECTIONS_CMD_TTL;

/** Reactively returns the latest "expand all / collapse all" command
 *  (true/false) or null when none is pending. Consuming components re-render
 *  whenever a new command is issued. */
export const useSectionsCommand = () => {
  const [cmd, setCmd] = useState(() => (isSectionsCommandFresh() ? sectionsCmd.open : null));
  useEffect(() => subscribeSectionsCommand((open) => setCmd(open)), []);
  return cmd;
};

// Bridge the shared window event into the store (kept for any external
// dispatcher; the top-bar button uses setSectionsCommand directly).
if (typeof window !== 'undefined') {
  window.addEventListener('lab:toggle-all-sections', (e) => {
    if (e && e.detail && typeof e.detail.open === 'boolean') setSectionsCommand(e.detail.open);
  });
}

export const CollapsibleSection = ({
  title, icon, defaultOpen = false, children, headerExtra, className = ''
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const sectionsCmd = useSectionsCommand();

  // Apply expand-all / collapse-all (also covers nested sections that mount
  // right after their parent opened).
  useEffect(() => {
    if (sectionsCmd !== null && sectionsCmd !== undefined) setIsOpen(sectionsCmd);
  }, [sectionsCmd]);

  return (
    <div className={`bg-white rounded-xl shadow-sm border border-slate-200 mb-3 break-inside-avoid ${className}`}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex justify-between items-center px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors text-left cursor-pointer ${isOpen ? 'rounded-t-xl border-b border-slate-200' : 'rounded-xl'}`}
      >
        <div className="flex items-center gap-2 overflow-hidden">
          {icon && <Icon name={icon} size={18} className="shrink-0 text-slate-500" />}
          <h3 className="text-sm font-bold text-slate-800 truncate select-none">{title}</h3>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {headerExtra && <div onClick={(e) => e.stopPropagation()}>{headerExtra}</div>}
          <svg className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
      {isOpen && <div className="p-3">{children}</div>}
    </div>
  );
};

export const CollapsibleSectionPanel = ({ id, title, subtitle, defaultOpen = false, children, className = '' }) => {
  const [open, setOpen] = useState(defaultOpen);
  const sectionsCmd = useSectionsCommand();

  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);

  // Apply expand-all / collapse-all (also covers nested panels that mount
  // right after their parent opened).
  useEffect(() => {
    if (sectionsCmd !== null && sectionsCmd !== undefined) setOpen(sectionsCmd);
  }, [sectionsCmd]);

  return (
    <div id={id} className={`bg-white border border-slate-200 rounded-xl shadow-sm overflow-visible scroll-mt-6 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-4 text-left"
      >
        <div>
          <h3 className="text-sm font-bold text-slate-700 uppercase">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
        </div>
        <span className="text-slate-400 text-lg">{open ? '▲' : '▼'}</span>
      </button>

      {open && <div className="px-4 pb-4 overflow-visible">{children}</div>}
    </div>
  );
};
