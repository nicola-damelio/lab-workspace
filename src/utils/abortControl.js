/* =========================================================================
   abortControl.js
   Global abort / emergency-stop coordinator shared by every test page.

   Long-running operations (structure / trajectory loads, trajectory
   playback, MD analyses, …) register a cancel function with a label. The
   always-visible ⏹ Stop button rendered by TestShellRenderer's shell shows
   the active operation and calls abortAll() on click — so any page that
   yields to the event loop can be stopped from one place, instead of the
   stop control being hidden behind a conditional panel.
   ========================================================================= */

import { useState, useEffect } from 'react';

let ops = new Map();       // token -> { label, cancel }
let seq = 1;
const listeners = new Set();

const emit = () => {
  listeners.forEach((fn) => {
    try { fn(); } catch { /* subscriber errors must never break the registry */ }
  });
};

export const abortControl = {
  /**
   * Register an active long-running operation.
   * @param {string} label short human-readable name shown on the Stop button
   * @param {() => void} cancel called once when the user hits Stop
   * @returns {() => void} unregister
   */
  register(label, cancel) {
    const token = seq++;
    ops.set(token, { label, cancel });
    emit();
    return () => {
      if (ops.delete(token)) emit();
    };
  },

  hasActive() { return ops.size > 0; },

  activeLabel() {
    const first = ops.values().next().value;
    return first ? first.label : '';
  },

  activeCount() { return ops.size; },

  /** Cancel every registered operation (used by the global ⏹ Stop button). */
  abortAll() {
    const all = Array.from(ops.values());
    ops.clear();
    emit();
    all.forEach((op) => {
      try { op.cancel(); } catch { /* a cancel that throws must not block the others */ }
    });
  },

  /** Subscribe to active-set changes. Returns an unsubscribe fn. */
  subscribe(fn) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
};

/** React hook: re-renders whenever the active operation set changes. */
export const useAbortControl = () => {
  const [snap, setSnap] = useState(() => ({
    active: abortControl.hasActive(),
    label: abortControl.activeLabel(),
  }));
  useEffect(() => abortControl.subscribe(() => {
    setSnap({ active: abortControl.hasActive(), label: abortControl.activeLabel() });
  }), []);
  return snap;
};

/** Standard "operation cancelled" error thrown by computations on abort. */
export const abortError = (msg = 'Operation cancelled.') =>
  Object.assign(new Error(msg), { name: 'AbortError' });

export const isAbortError = (e) => !!e && e.name === 'AbortError';
