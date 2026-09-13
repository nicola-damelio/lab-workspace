/* =========================================================================
   src/utils/figureRecapture.js

   "Re-capture this figure with the CURRENT figure style — automatically."

   A figure saved with 📷 carries the style it was RENDERED with
   (`src.styleTag`, see utils/figureStyle.js). When the profile changes, the
   Image Builder's ⚖️ audit lists the figures that no longer match; before this
   module the only cure was a round trip: open the experiment, 🎨, 📷, come back.

   This module makes the round trip automatic. The Image Builder QUEUES the
   figures to redo (their library entry id + the exact chart element on the
   page, `src.elementKey`) and jumps to the first experiment; the experiment
   page (ChartStarLayer) applies the profile, finds each element by its
   `data-figure-origin` stamp, captures it and REPLACES the library entry in
   place (`updateId`), so the canvas that pointed at it shows the new figure.

   The queue lives in localStorage: the two pages are different screens of the
   same SPA, and a reload in the middle must not lose the work. It expires
   (TTL) so a stale request can never drive the app on a later visit.
   ========================================================================= */

export const FIGURE_RECAPTURE_KEY = 'labFigureRecapture';
export const FIGURE_RECAPTURE_EVENT = 'lab:figure-recapture-changed';

// After this delay the request is forgotten: the user has long moved on, and
// silently re-capturing figures an hour later would be a surprise.
export const FIGURE_RECAPTURE_TTL_MS = 15 * 60 * 1000;

// Where the run came from: the page reopens that module on the same project
// when the last figure is done, or jumps to the next experiment.
export const RECAPTURE_RETURN_EVENT = 'lab:open-image-builder';
export const RECAPTURE_NEXT_TEST_EVENT = 'lab:open-origin-test';

const listeners = new Set();

const readStore = () => {
  try {
    if (typeof localStorage === 'undefined') return null;
    return JSON.parse(localStorage.getItem(FIGURE_RECAPTURE_KEY) || 'null');
  } catch { return null; }
};

const emit = (run) => {
  listeners.forEach((fn) => { try { fn(run); } catch { /* ignore */ } });
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FIGURE_RECAPTURE_EVENT, { detail: run }));
  } catch { /* ignore */ }
};

const writeStore = (run) => {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(FIGURE_RECAPTURE_KEY, JSON.stringify(run));
  } catch { /* private mode / quota — the in-memory run still works this session */ }
  emit(run);
  return run;
};

export const subscribeFigureRecapture = (fn) => {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};

export const clearFigureRecaptures = () => {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(FIGURE_RECAPTURE_KEY);
  } catch { /* ignore */ }
  emit(null);
};

/** The current run, or null when there is none (or it has gone stale). */
export const readFigureRecapture = () => {
  const run = readStore();
  if (!run || !Array.isArray(run.items) || run.items.length === 0) return null;
  if (Date.now() - (Number(run.at) || 0) > FIGURE_RECAPTURE_TTL_MS) {
    clearFigureRecaptures();
    return null;
  }
  return run;
};

/** True when a run was started a moment ago (default: the last 5 min). */
export const hasFreshFigureRecapture = (withinMs = 5 * 60 * 1000) => {
  const run = readStore();
  if (!run || !Array.isArray(run.items) || !run.items.length) return false;
  return Date.now() - (Number(run.at) || 0) <= (Number(withinMs) || 0);
};


/** One queued figure: the library entry + the exact element of the page. */
const normalizeItem = (item = {}) => ({
  figId: item.figId || '',
  scope: item.scope === 'project' ? 'project' : 'common',
  projectId: item.projectId || null,
  label: item.label || 'Figure',
  elementKey: item.elementKey || '',
  styleTag: item.styleTag || '',
  origin: item.origin && typeof item.origin === 'object' ? item.origin : {},
  status: 'pending',
  message: '',
  at: 0
});

/**
 * Queue the re-capture of one or more figures and return the run.
 * `opts.origin` names the requester ('image-builder'); `opts.return` is
 * `{ module: 'image-builder', projectId, canvasId }` — where the page sends the
 * user back once the LAST figure is done.
 */
export const queueFigureRecaptures = (items, opts = {}) => {
  const list = (Array.isArray(items) ? items : [items]).filter(Boolean).map(normalizeItem);
  const run = {
    at: Date.now(),
    origin: opts.origin || 'image-builder',
    returnTo: opts.return || null,
    items: list
  };
  return writeStore(run);
};

/** Does a queued item belong to this experiment / condition? */
export const recaptureMatchesTest = (item, test) => {
  if (!item || !test) return false;
  const o = item.origin || {};
  if (o.testId && test.id && o.testId === test.id) return true;
  const name = String(test.name || '').trim();
  const originName = String(o.testName || '').trim();
  if (!originName || !name || originName !== name) return false;
  const inst = String(test.instanceName || '').trim();
  const originInst = String(o.instanceName || '').trim();
  if (originInst && inst && originInst !== inst) return false;
  const date = String(test.date || '').trim();
  const originDate = String(o.date || '').trim();
  if (originInst && inst && originDate && date && originDate !== date) return false;
  return true;
};

/** The items still to do on THIS experiment page (pending + failed retries). */
export const figureRecapturesForTest = (test) => {
  const run = readFigureRecapture();
  if (!run || !test) return [];
  return run.items.filter((it) => it.status !== 'done' && recaptureMatchesTest(it, test));
};

/** Record the outcome of one figure. Returns the updated run (or null). */
export const markFigureRecaptureResult = (figId, status, message = '') => {
  const run = readFigureRecapture();
  if (!run) return null;
  const next = {
    ...run,
    items: run.items.map((it) => (it.figId === figId
      ? { ...it, status: status === 'done' ? 'done' : 'failed', message: String(message || ''), at: Date.now() }
      : it))
  };
  return writeStore(next);
};

/** { total, done, failed, pending } of the current run. */
export const figureRecaptureProgress = () => {
  const run = readFigureRecapture();
  if (!run) return { total: 0, done: 0, failed: 0, pending: 0 };
  const count = (s) => run.items.filter((i) => i.status === s).length;
  const done = count('done');
  const failed = count('failed');
  return { total: run.items.length, done, failed, pending: run.items.length - done - failed };
};

/** The next experiment that still has pending items (the automatic chain). */
export const nextRecaptureTarget = () => {
  const run = readFigureRecapture();
  if (!run) return null;
  const item = run.items.find((i) => i.status === 'pending');
  if (!item) return null;
  return { figId: item.figId, label: item.label, origin: item.origin, returnTo: run.returnTo || null };
};

/** What the Image Builder shows when the user comes back. */
export const figureRecaptureSummary = () => {
  const run = readFigureRecapture();
  if (!run) return null;
  return {
    at: run.at,
    origin: run.origin,
    returnTo: run.returnTo || null,
    ...figureRecaptureProgress(),
    results: run.items.map((i) => ({ figId: i.figId, label: i.label, status: i.status, message: i.message }))
  };
};
