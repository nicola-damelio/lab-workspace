/* =========================================================================
   loadProgress.js
   HOW FAR ALONG the long operation of the moment is — shared by the pages.

   The request: « the stop (structure loading) message that appears when
   loading a structure is useless and should be removed. At its place it
   would be more useful a loading bar showing the progression that could be
   inserted in the top bar of the window. »

   utils/abortControl.js is the first half of that story: a long operation (a
   structure load, a trajectory load, an MD analysis…) registers a cancel
   function so it can be stopped from anywhere. This module is the SECOND
   half: the very same operation says what it is doing and how far it got,
   and TestShellRenderer draws it as a thin bar along the top of the window.

   The bar never invents a percentage. An operation reports either counters
   it really has — the molecule being loaded in a complex, the frame being
   decoded in a trajectory — or a mere `phase()`; when nothing can be
   counted the snapshot says `percent: null` and the bar pulses instead of
   pretending to advance.
   ========================================================================= */

import { useState, useEffect } from 'react';

let current = null;   // { token, label, phase, done, total, startedAt } | null
let seq = 1;
const listeners = new Set();

const emit = () => {
  listeners.forEach((fn) => {
    try { fn(); } catch { /* subscriber errors must never break the store */ }
  });
};

/**
 * Completion in per cent, or null when it cannot be told.
 * @param {number} done @param {number} total
 * @returns {number|null} 0–100 (integer) or null for an unknown / empty total
 */
export const loadProgressPercent = (done, total) => {
  const d = Number(done);
  const t = Number(total);
  if (!Number.isFinite(d) || !Number.isFinite(t) || t <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((d / t) * 100)));
};

/** The frozen view of the store the UI renders from. */
const snapshotOf = (entry) => (entry ? {
  active: true,
  label: entry.label,
  phase: entry.phase,
  done: entry.done,
  total: entry.total,
  percent: loadProgressPercent(entry.done, entry.total),
  startedAt: entry.startedAt,
} : {
  active: false,
  label: '',
  phase: '',
  done: null,
  total: null,
  percent: null,
  startedAt: 0,
});

export const loadProgress = {
  /**
   * Start reporting a long operation.
   * @param {string} label short human-readable name, drawn by the top bar
   * @returns {{phase:Function, step:Function, end:Function}} the reporter
   */
  begin(label) {
    const token = seq++;
    current = {
      token,
      label: String(label || ''),
      phase: '',
      done: null,
      total: null,
      startedAt: Date.now(),
    };
    emit();
    // A reporter only ever touches ITS OWN entry: an older operation that
    // finishes late (a cancelled load, a superseded one) can neither clear
    // nor overwrite the bar of the operation running now.
    const alive = () => !!current && current.token === token;
    return {
      /**
       * What the operation is busy with, without any counter.
       * The counters of the PREVIOUS step are forgotten on purpose: a step
       * whose length is unknown must make the bar pulse rather than display
       * the percentage of another step.
       */
      phase(text) {
        if (!alive()) return;
        current.phase = String(text || '');
        current.done = null;
        current.total = null;
        emit();
      },
      /**
       * Real counters, plus an optional phase text.
       * `total <= 0` (or a missing number) means « cannot be counted » → the
       * bar pulses rather than lying about a percentage.
       */
      step(done, total, text) {
        if (!alive()) return;
        const d = Number(done);
        const t = Number(total);
        current.done = Number.isFinite(d) ? d : null;
        current.total = Number.isFinite(t) ? t : null;
        if (text !== undefined) current.phase = String(text || '');
        emit();
      },
      /** The operation is over (success or error). Idempotent. */
      end() {
        if (!alive()) return;
        current = null;
        emit();
      },
    };
  },

  snapshot: () => snapshotOf(current),

  /** Forget the current operation (nothing is running any more). */
  clear() {
    if (!current) return;
    current = null;
    emit();
  },

  /** Subscribe to progression changes. Returns an unsubscribe fn. */
  subscribe(fn) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
};

/** React hook: re-renders whenever the reported progression changes. */
export const useLoadProgress = () => {
  const [snap, setSnap] = useState(() => loadProgress.snapshot());
  useEffect(() => loadProgress.subscribe(() => setSnap(loadProgress.snapshot())), []);
  return snap;
};
