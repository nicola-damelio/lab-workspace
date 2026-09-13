/* =========================================================================
   src/utils/pendingFigureScroll.js

   "Take me back to the graph I took this image from."

   A figure saved with the 📷 button of the experiment page carries a `src`
   stamp { testId, testName, instanceName, date, elementLabel, elementKey }.
   When the Image Builder's "↗ Open original graph" is clicked, the ORIGIN
   instance is queued here and the experiment page consumes it on arrival:

     • ChartStarLayer  — marks every chart with `data-figure-origin` and scrolls
       the exact one into view (opening the closed sections if needed);
     • useExperimentScrollMemory (ui.jsx) — must NOT restore the remembered
       offset while this request is pending, otherwise the page's own scroll
       memory puts the user back where they were instead of at the graph.

   The request lives in localStorage (the Image Builder is a page of the same
   app, so no reload is needed, but a reload mid-way must not lose it) and is
   dropped after PENDING_TTL_MS so a stale request can never block the scroll
   memory nor the next navigation.
   ========================================================================= */

export const PENDING_FIGURE_SCROLL_KEY = 'labPendingFigureScroll';

// A request is meaningless after this delay (the user navigated somewhere
// else in the meantime) — it is then simply ignored and forgotten.
export const PENDING_TTL_MS = 60000;

const readStore = () => {
  try {
    return JSON.parse(localStorage.getItem(PENDING_FIGURE_SCROLL_KEY) || 'null');
  } catch {
    return null;
  }
};

/** Queue "open the origin instance and scroll to this chart" for the next page. */
export const queuePendingFigureScroll = (payload = {}) => {
  const request = {
    key: payload.key || '',
    label: payload.label || '',
    testId: payload.testId || '',
    testName: payload.testName || '',
    instanceName: payload.instanceName || '',
    date: payload.date || '',
    at: Date.now()
  };
  try {
    localStorage.setItem(PENDING_FIGURE_SCROLL_KEY, JSON.stringify(request));
  } catch {
    /* private mode / full storage — the navigation still happens, only the
       exact scroll position is lost. */
  }
  return request;
};

/** The pending request, or null when there is none (or it has gone stale). */
export const peekPendingFigureScroll = () => {
  const request = readStore();
  if (!request || !request.key) return null;
  if (Date.now() - (Number(request.at) || 0) > PENDING_TTL_MS) {
    clearPendingFigureScroll();
    return null;
  }
  return request;
};

/**
 * True when a request was queued a moment ago (default: the last 12 s) — used
 * by the page's scroll memory, which must stand down while the user is being
 * taken to a chart, whatever instance id the page ends up opening.
 */
export const hasFreshPendingFigureScroll = (withinMs = 12000) => {
  const request = readStore();
  if (!request || !request.key) return false;
  return Date.now() - (Number(request.at) || 0) <= (Number(withinMs) || 12000);
};

/** Forget the pending request (it has been honoured, or abandoned). */
export const clearPendingFigureScroll = () => {
  try {
    localStorage.removeItem(PENDING_FIGURE_SCROLL_KEY);
  } catch {
    /* ignore */
  }
};

/**
 * Which condition should "↗ Open original graph" reopen?
 *
 * The stored id normally still exists (the same tests array). When the
 * experiment was rebuilt in between — a Drive restore or a duplication
 * recreates the conditions with NEW ids — the SAME condition is found by
 * experiment name + instance (condition) name, then by date, so the user lands
 * on the very instance the figure was taken from instead of the first one of
 * the experiment (or on "Test not found", which is what a stale id gave).
 *
 * Same rules as the "↩ Back to experiment" button of the sidebar (App.jsx
 * handleReturnToTest), so both shortcuts behave identically.
 */
export const resolveOriginTest = (tests = [], origin = null) => {
  if (!origin || !origin.testId) return null;
  const list = Array.isArray(tests) ? tests : [];
  const exact = list.find((t) => t && t.id === origin.testId);
  if (exact) return exact;

  const name = String(origin.testName || '').trim();
  if (!name) return null;
  const sameName = list.filter((t) => t && String(t.name || '').trim() === name);
  if (sameName.length === 0) return null;
  if (sameName.length === 1) return sameName[0];

  const instance = String(origin.instanceName || '').trim();
  const date = String(origin.date || '').trim();
  const sameInstance = instance
    ? sameName.filter((t) => String(t.instanceName || '').trim() === instance)
    : [];
  // The same condition name can exist several times (a repetition on another
  // day): the date then tells which one the figure came from.
  if (sameInstance.length > 1 && date) {
    const sameInstanceDate = sameInstance.find((t) => String(t.date || '').trim() === date);
    if (sameInstanceDate) return sameInstanceDate;
  }
  if (sameInstance.length) return sameInstance[0];
  if (date) {
    const sameDate = sameName.find((t) => String(t.date || '').trim() === date);
    if (sameDate) return sameDate;
  }
  return sameName[0];
};
