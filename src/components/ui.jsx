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

// ---- Per-experiment section memory --------------------------------------
// Leaving the experiment page (to consult the Library, the Projects, the Lab
// Notebook…) UNMOUNTS it, so every section used to collapse and its scroll
// position was lost: coming back meant reopening the same subsections again.
//
// Sections now remember whether they were open, PER EXPERIMENT (the active
// test id), so returning to an experiment restores the very same view — and
// two different experiments each keep their own layout.
//
// The scope comes from <SectionsScope>, which App.jsx wraps around the
// experiment page. Sections rendered outside that scope (Library, Settings…)
// keep their current, non-persistent behaviour on purpose: their titles are
// not unique enough to be used as keys.
export const SectionsScope = React.createContext(null);

const SECTION_MEMORY_KEY = 'labWorkspace_sectionMemory';
// Safety bound: only the most recently opened experiments are remembered
// (insertion order = first-visit order, so the oldest entries are dropped).
const SECTION_MEMORY_MAX_TESTS = 200;
let sectionMemoryCache = null;

const loadSectionMemory = () => {
  if (sectionMemoryCache) return sectionMemoryCache;
  try {
    const raw = JSON.parse(localStorage.getItem(SECTION_MEMORY_KEY) || 'null');
    sectionMemoryCache = raw && typeof raw === 'object' ? raw : {};
  } catch {
    sectionMemoryCache = {};
  }
  return sectionMemoryCache;
};

/** Open state remembered for `key` inside `scope` (a test id), or `fallback`. */
const readSectionOpen = (scope, key, fallback) => {
  if (!scope || !key) return fallback;
  const bucket = loadSectionMemory()[scope];
  const saved = bucket ? bucket[key] : undefined;
  return typeof saved === 'boolean' ? saved : fallback;
};

/** Remember the open state of one section for the next visit. */
const writeSectionOpen = (scope, key, open) => {
  if (!scope || !key) return;
  try {
    const mem = loadSectionMemory();
    if (!mem[scope]) mem[scope] = {};
    mem[scope][key] = !!open;
    const scopes = Object.keys(mem);
    if (scopes.length > SECTION_MEMORY_MAX_TESTS) {
      scopes.slice(0, scopes.length - SECTION_MEMORY_MAX_TESTS).forEach((k) => delete mem[k]);
    }
    localStorage.setItem(SECTION_MEMORY_KEY, JSON.stringify(mem));
  } catch {
    /* localStorage full or unavailable — the page keeps working, only the
       open/closed state is not remembered. */
  }
};

export const CollapsibleSection = ({
  title, icon, defaultOpen = false, children, headerExtra, className = '', openWhen = false
}) => {
  // Per-experiment memory (see SectionsScope above): the section reopens the
  // way the user left it when coming back to this experiment.
  const scope = React.useContext(SectionsScope);
  const memoryKey = scope ? String(title || '') : null;
  const [isOpen, setIsOpen] = useState(() => readSectionOpen(scope, memoryKey, defaultOpen));
  const sectionsCmd = useSectionsCommand();

  // Open/close AND remember it, so the choice survives leaving the page.
  const applyOpen = (next) => {
    setIsOpen(next);
    writeSectionOpen(scope, memoryKey, next);
  };

  // Apply expand-all / collapse-all (also covers nested sections that mount
  // right after their parent opened).
  useEffect(() => {
    if (sectionsCmd !== null && sectionsCmd !== undefined) applyOpen(sectionsCmd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionsCmd]);

  // Auto-open when something important appears (e.g. imported docking data) —
  // e.g. "Instrumental Setup" opens once raw_input.toml is attached.
  useEffect(() => {
    if (openWhen) applyOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openWhen]);

  return (
    <div className={`bg-white rounded-xl shadow-sm border border-slate-200 mb-3 break-inside-avoid ${className}`}>
      <div
        onClick={() => applyOpen(!isOpen)}
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
  // Same per-experiment memory as CollapsibleSection (see SectionsScope).
  const scope = React.useContext(SectionsScope);
  const memoryKey = scope ? String(id || title || '') : null;
  const [open, setOpen] = useState(() => readSectionOpen(scope, memoryKey, defaultOpen));
  const sectionsCmd = useSectionsCommand();

  const applyOpen = (next) => {
    setOpen(next);
    writeSectionOpen(scope, memoryKey, next);
  };

  useEffect(() => {
    // A section already remembered for this experiment keeps ITS state; only
    // panels without memory follow the caller's default (e.g. the Library
    // opens the panel matching the current selection).
    if (!scope || readSectionOpen(scope, memoryKey, undefined) === undefined) setOpen(defaultOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultOpen]);

  // Apply expand-all / collapse-all (also covers nested panels that mount
  // right after their parent opened).
  useEffect(() => {
    if (sectionsCmd !== null && sectionsCmd !== undefined) applyOpen(sectionsCmd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionsCmd]);

  return (
    <div id={id} className={`bg-white border border-slate-200 rounded-xl shadow-sm overflow-visible scroll-mt-6 ${className}`}>
      <button
        type="button"
        onClick={() => applyOpen(!open)}
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
