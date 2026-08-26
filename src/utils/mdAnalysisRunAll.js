/* =========================================================================
   mdAnalysisRunAll.js
   Shared coordinator for the MD "Data Analysis" section.

   The "⚡ Calculate all analyses" button (rendered by TestShellRenderer next
   to the shared stride / max-frames controls) triggers every analysis
   subsection that subscribed (MD general parameters, secondary structure,
   membrane contacts, membrane profiles). Each subsection keeps its own run
   button too — nothing runs automatically until the user clicks.

   The stride / max-frames values live here (module-level, defaulting to
   "every frame, no cap") so the toolbar can edit them once and every
   analysis picks them up.
   ========================================================================= */

let cfg = { stride: 1, maxFrames: 0 };
const cfgListeners = new Set();
const runListeners = new Set();

export const mdAnalysisRunAll = {
  getCfg: () => ({ ...cfg }),

  setCfg(patch) {
    cfg = { ...cfg, ...patch };
    cfgListeners.forEach((fn) => {
      try { fn({ ...cfg }); } catch { /* listener errors must not break the store */ }
    });
  },

  /** Subscribe to stride / max-frames changes. Fires immediately with the current config. */
  subscribeCfg(fn) {
    cfgListeners.add(fn);
    try { fn({ ...cfg }); } catch {}
    return () => { cfgListeners.delete(fn); };
  },

  /** Subscribe a subsection's "run everything" action to the Calculate-all button. */
  subscribeRun(fn) {
    runListeners.add(fn);
    return () => { runListeners.delete(fn); };
  },

  /** Fire every subscribed subsection (used by the Calculate-all button). */
  triggerRun() {
    runListeners.forEach((fn) => {
      try { fn(); } catch { /* one failing subsection must not block the others */ }
    });
  },
};
