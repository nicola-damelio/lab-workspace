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

// Live per-analysis status, so the "⚡ Calculate all analyses" toolbar can show
// what each analysis is doing in real time (otherwise the user thinks it froze).
const statuses = {};
const statusListeners = new Set();

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

  /**
   * Fire every subscribed subsection (used by the Calculate-all button).
   * Runs each analysis ONE AFTER THE OTHER (awaiting the previous one) instead
   * of all in parallel: parallel runs saturate the main thread with 4 heavy
   * per-frame loops at once, which froze the page and hid the progress feed.
   */
  async triggerRun() {
    const fns = [...runListeners];
    for (const fn of fns) {
      try { await fn(); } catch { /* one failing subsection must not block the others */ }
    }
  },

  /** Report live progress for one analysis (key, e.g. 'general'|'dssp'|'contacts'|'profiles'). */
  setStatus(key, msg, active = true) {
    statuses[key] = { msg: msg || '', active };
    statusListeners.forEach((fn) => {
      try { fn({ ...statuses }); } catch {}
    });
  },

  /** Mark an analysis finished (idle) and clear its status. */
  clearStatus(key) {
    delete statuses[key];
    statusListeners.forEach((fn) => {
      try { fn({ ...statuses }); } catch {}
    });
  },

  /** Get a snapshot of all live statuses. */
  getStatus() { return { ...statuses }; },

  /** Subscribe to status changes; fires immediately with the current snapshot. */
  subscribeStatus(fn) {
    statusListeners.add(fn);
    try { fn({ ...statuses }); } catch {}
    return () => { statusListeners.delete(fn); };
  },
};

