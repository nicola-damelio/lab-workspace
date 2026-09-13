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

// How many times ONE figure may be tried again while its chart is not on the
// page yet (a lazy section, Drive-hosted data, a chart that mounts late). The
// experiment page ticks every 600 ms: without a cap, a figure that can never be
// captured was retried for the whole deadline — and every attempt used to add a
// NEW copy of the figure to the image library (hundreds of copies from one
// click, no way to stop it). After the cap the item is 'failed' for good and
// the run stops touching it.
export const FIGURE_RECAPTURE_MAX_ATTEMPTS = 3;

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
  attempts: 0,
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
  // ONE item per FIGURE: the same library entry queued twice (the same figure
  // placed in two panels of a canvas, a double click on the 🔄 button) must not
  // be captured twice — that is how a single click could start many captures.
  const seen = new Set();
  const unique = [];
  list.forEach((it) => {
    const key = it.figId || `${it.elementKey}|${it.scope}|${it.projectId || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(it);
  });
  const run = {
    at: Date.now(),
    origin: opts.origin || 'image-builder',
    returnTo: opts.return || null,
    items: unique,
    stopped: false
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

/** The items still to do on THIS experiment page (pending + a failed retry left). */
export const figureRecapturesForTest = (test) => {
  const run = readFigureRecapture();
  if (!run || run.stopped || !test) return [];
  return run.items.filter((it) => it.status === 'pending'
    && (Number(it.attempts) || 0) < FIGURE_RECAPTURE_MAX_ATTEMPTS
    && recaptureMatchesTest(it, test));
};

/**
 * Record the outcome of one figure. Returns the updated run (or null).
 *
 * A reported failure is FINAL by default — exactly as before. `opts.retry`
 * asks for another attempt (a capture can fail for a transient reason: the
 * chart was still painting), and even then the item gives up after
 * FIGURE_RECAPTURE_MAX_ATTEMPTS tries, so a figure that can never be captured
 * cannot keep the loop alive for the whole deadline. `opts.hard` always wins
 * over `opts.retry`: the entry the figure had to replace is gone, nothing to
 * retry.
 */
export const markFigureRecaptureResult = (figId, status, message = '', opts = null) => {
  const run = readFigureRecapture();
  if (!run) return null;
  const hard = !!(opts && opts.hard);
  const retryable = !hard && !!(opts && opts.retry);
  const next = {
    ...run,
    items: run.items.map((it) => {
      if (it.figId !== figId) return it;
      if (status === 'done') return { ...it, status: 'done', message: String(message || ''), at: Date.now() };
      const attempts = (Number(it.attempts) || 0) + 1;
      const keepTrying = retryable && attempts < FIGURE_RECAPTURE_MAX_ATTEMPTS;
      return { ...it, status: keepTrying ? 'pending' : 'failed', attempts, message: String(message || ''), at: Date.now() };
    })
  };
  return writeStore(next);
};

/**
 * STOP the run now — the ⏹ button of the experiment page (and of the Image
 * Builder). Every figure still pending is marked 'failed' with the reason and
 * the run is flagged as stopped, so no page may touch it again and the chain to
 * the next experiment stops as well. Returns the updated run (or null: idle).
 */
export const stopFigureRecaptures = (reason = 'stopped by the user') => {
  const run = readFigureRecapture();
  if (!run) return null;
  const msg = String(reason || '');
  const next = {
    ...run,
    stopped: true,
    stoppedAt: Date.now(),
    items: run.items.map((it) => (it.status === 'pending'
      ? { ...it, status: 'failed', message: msg, at: Date.now() }
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
  if (!run || run.stopped) return null;
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
    stopped: !!run.stopped,
    returnTo: run.returnTo || null,
    ...figureRecaptureProgress(),
    results: run.items.map((i) => ({ figId: i.figId, label: i.label, status: i.status, message: i.message }))
  };
};
