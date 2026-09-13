// Validates the "↗ Open original graph" chain of the Image Builder:
// following the link must open the CORRECT INSTANCE (condition) of the
// experiment AND land on the exact chart/spectrum the image was taken from.
//
// The chain under test (mirrors kept in sync with the sources):
//   ImageBuilder.jsx      openOriginalGraph(src)
//      → queuePendingFigureScroll({ key, label, testId, testName, instanceName, date })
//      → jumpToTest(src.testId, src)
//   App.jsx               jumpToTest(testId, origin)
//      → resolveOriginTest(tests, origin)   … same condition even when the id
//        of the experiment was rebuilt (Drive restore / duplication) instead of
//        "Test not found" / the first condition of the experiment
//   ChartStarLayer.jsx    marks every chart/spectrum with data-figure-origin,
//      finds the captured one by ATTRIBUTE (the key contains spaces and '·'),
//      scrolls it into view, opens the closed sections with the page's
//      "▸ Expand all" button when it is not rendered, and keeps it centred
//      while the page settles.
//   ui.jsx                useExperimentScrollMemory stands down while a request
//      is pending, otherwise the remembered offset overrode the scroll.
//   activeTestModule.jsx  exposes data-expand-all (only while it would expand).
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const UTIL = read('src/utils/pendingFigureScroll.js');
const IB = read('src/components/ImageBuilder.jsx');
const CSL = read('src/components/ChartStarLayer.jsx');
const UI = read('src/components/ui.jsx');
const ATM = read('src/components/AppModules/activeTestModule.jsx');
const APP = read('src/App.jsx');

const results = [];
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push({ name, got: String(got), want: String(want), ok });
  return ok;
};
const checkTrue = (name, got) => check(name, !!got, true);
const frag = (name, hay, needle) => checkTrue(`${name}: ${needle.slice(0, 42)}…`, hay.includes(needle));

// ── a fake browser storage for the pending request ──────────────────────────
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); }
};
let NOW = 1_000_000;
const realNow = Date.now;
Date.now = () => NOW;

// ── mirror: src/utils/pendingFigureScroll.js ────────────────────────────────
const PENDING_FIGURE_SCROLL_KEY = 'labPendingFigureScroll';
const PENDING_TTL_MS = 60000;
const readStore = () => {
  try {
    return JSON.parse(localStorage.getItem(PENDING_FIGURE_SCROLL_KEY) || 'null');
  } catch {
    return null;
  }
};
const queuePendingFigureScroll = (payload = {}) => {
  const request = {
    key: payload.key || '',
    label: payload.label || '',
    testId: payload.testId || '',
    testName: payload.testName || '',
    instanceName: payload.instanceName || '',
    date: payload.date || '',
    at: Date.now()
  };
  try { localStorage.setItem(PENDING_FIGURE_SCROLL_KEY, JSON.stringify(request)); } catch { /* ignore */ }
  return request;
};
const clearPendingFigureScroll = () => {
  try { localStorage.removeItem(PENDING_FIGURE_SCROLL_KEY); } catch { /* ignore */ }
};
const peekPendingFigureScroll = () => {
  const request = readStore();
  if (!request || !request.key) return null;
  if (Date.now() - (Number(request.at) || 0) > PENDING_TTL_MS) {
    clearPendingFigureScroll();
    return null;
  }
  return request;
};
const hasFreshPendingFigureScroll = (withinMs = 12000) => {
  const request = readStore();
  if (!request || !request.key) return false;
  return Date.now() - (Number(request.at) || 0) <= (Number(withinMs) || 12000);
};
const resolveOriginTest = (tests = [], origin = null) => {
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

/* ══════════════════════════════════════════════════════════════════════════
   1) THE REQUEST QUEUED BY THE IMAGE BUILDER
   ══════════════════════════════════════════════════════════════════════════ */
// What the 📷 button stamps on a figure (ChartStarLayer) and what the Image
// Builder queues are the same fields, so the arrival can find the instance and
// the chart even after the experiment was rebuilt.
const FIGURE_SRC = {
  testId: 't-42',
  testName: 'CD titration',
  instanceName: 'Sample 3',
  date: '2026-02-11',
  elementLabel: 'CD spectra',
  elementKey: 'CD spectra · Chart · 2'
};
queuePendingFigureScroll({
  key: FIGURE_SRC.elementKey,
  label: FIGURE_SRC.elementLabel,
  testId: FIGURE_SRC.testId,
  testName: FIGURE_SRC.testName,
  instanceName: FIGURE_SRC.instanceName,
  date: FIGURE_SRC.date
});
const pending = peekPendingFigureScroll();
check('the request carries the chart key', pending.key, FIGURE_SRC.elementKey);
check('the request carries the chart label', pending.label, FIGURE_SRC.elementLabel);
check('the request carries the instance id', pending.testId, 't-42');
check('the request carries the condition name', pending.instanceName, 'Sample 3');
check('the request carries the experiment name', pending.testName, 'CD titration');
check('the request carries the date', pending.date, '2026-02-11');
check('the request is timestamped', typeof pending.at, 'number');
checkTrue('the request is readable while it is fresh', !!peekPendingFigureScroll());

// A stale request (the user navigated somewhere else in the meantime) is
// dropped instead of blocking the page's own scroll memory forever.
NOW += PENDING_TTL_MS - 1;
checkTrue('still honoured just before the TTL', !!peekPendingFigureScroll());
NOW += 2;
check('dropped once stale', peekPendingFigureScroll(), null);
checkTrue('…and forgotten in the storage too', store.size === 0);
// A request without a chart key is ignored (nothing to scroll to).
queuePendingFigureScroll({ testId: 't-1' });
check('a key-less request is ignored', peekPendingFigureScroll(), null);
clearPendingFigureScroll();

/* ══════════════════════════════════════════════════════════════════════════
   2) WHICH INSTANCE IS REOPENED
   ══════════════════════════════════════════════════════════════════════════ */
const TESTS = [
  { id: 'a1', name: 'CD titration', instanceName: 'Sample 1', date: '2026-01-04' },
  { id: 'a2', name: 'CD titration', instanceName: 'Sample 3', date: '2026-02-11' },
  { id: 'a3', name: 'CD titration', instanceName: 'Sample 3', date: '2026-03-02' },
  { id: 'b1', name: 'Other test', instanceName: 'Sample 1', date: '2026-01-04' }
];
check('the stored instance still exists → reopen it',
  resolveOriginTest(TESTS, { ...FIGURE_SRC, testId: 'a3' }).id, 'a3');
check('the experiment was rebuilt (new ids) → the SAME condition (name + instance)',
  resolveOriginTest(TESTS, { ...FIGURE_SRC, testId: 'gone' }).id, 'a2');
check('the same instance name twice → the date decides',
  resolveOriginTest(TESTS, { ...FIGURE_SRC, testId: 'gone', instanceName: 'Sample 3', date: '2026-03-02' }).id, 'a3');
check('…and falls back to the first one when the date is gone too',
  resolveOriginTest(TESTS, { ...FIGURE_SRC, testId: 'gone', instanceName: 'Sample 3', date: 'nope' }).id, 'a2');
check('the condition was renamed → the date still matches',
  resolveOriginTest(TESTS, { ...FIGURE_SRC, testId: 'gone', instanceName: 'Sample 9' }).id, 'a2');
check('the condition was renamed and re-dated → the experiment is still found',
  resolveOriginTest(TESTS, { ...FIGURE_SRC, testId: 'gone', instanceName: 'Sample 9', date: 'nope' }).id, 'a1');
check('a single condition keeps its experiment',
  resolveOriginTest([{ id: 'solo', name: 'CD titration', instanceName: 'Sample 1' }], { ...FIGURE_SRC, testId: 'gone' }).id, 'solo');
check('the experiment was deleted → nothing to open',
  resolveOriginTest(TESTS, { ...FIGURE_SRC, testId: 'gone', testName: 'Deleted test' }), null);
check('no origin → nothing to resolve', resolveOriginTest(TESTS, null), null);
check('an origin without an id → nothing to resolve', resolveOriginTest(TESTS, { testName: 'CD titration' }), null);
check('an empty test list → nothing to resolve', resolveOriginTest([], FIGURE_SRC), null);


/* ══════════════════════════════════════════════════════════════════════════
   3) THE PAGE IS TOLD WHERE TO GO
   ══════════════════════════════════════════════════════════════════════════ */
// A figure keeps the INSTANCE stamp, not only the experiment id.
frag('[ChartStarLayer] the figure is stamped with the instance', CSL, 'instanceName: (test && test.instanceName) || \'\',');
frag('[ChartStarLayer] …and the date', CSL, "date: (test && test.date) || '',");
frag('[ChartStarLayer] …and the exact element', CSL, 'elementKey: t.key');
// The Image Builder queues the request and hands the origin to jumpToTest.
frag('[ImageBuilder] the request is queued', IB, 'queuePendingFigureScroll({');
frag('[ImageBuilder] the chart key goes in', IB, 'key: src.elementKey,');
frag('[ImageBuilder] the label goes in', IB, 'label: src.elementLabel,');
frag('[ImageBuilder] the instance id goes in', IB, 'testId: src.testId,');
frag('[ImageBuilder] the condition name goes in', IB, 'instanceName: src.instanceName,');
frag('[ImageBuilder] the origin travels with the jump', IB, 'if (jumpToTest) jumpToTest(src.testId, src);');
frag('[ImageBuilder] the button announces the condition', IB, '↗ Open original graph{originLabelOf(selectedObj.src)');
frag('[ImageBuilder] the figure row tooltip too', IB, 'right on the graph this figure was captured from');
// App resolves the origin instead of trusting a possibly stale id.
frag('[App] jumpToTest takes the origin', APP, 'const jumpToTest = (testId, origin = null) => {');
frag('[App] the origin condition is resolved', APP, 'const target = origin ? resolveOriginTest(tests, origin) : null;');
frag('[App] …and opened', APP, "setActiveTestId(target ? target.id : testId);");

/* ══════════════════════════════════════════════════════════════════════════
   4) THE ARRIVAL: EXACT CHART, EXACT POSITION
   ══════════════════════════════════════════════════════════════════════════ */
// The chart is looked up by ATTRIBUTE (the key is a human label: spaces, '·'),
// so a key can never break the selector.
frag('[ChartStarLayer] the lookup is attribute-based', CSL, "rootEl.querySelectorAll('[data-figure-origin]')");
frag('[ChartStarLayer] …and compares the stored key', CSL, "el.getAttribute('data-figure-origin') === pending.key");
// A chart hidden inside a closed section is not in the DOM: the page's own
// "▸ Expand all" button is clicked when the target is missing.
frag('[ChartStarLayer] closed sections are opened', CSL, "document.querySelector('[data-expand-all]')");
frag('[ChartStarLayer] …by clicking the page button', CSL, 'btn.click(); return true;');
frag('[Config] the expand-all button exposes the hook', ATM, "data-expand-all={allSectionsOpen ? undefined : '1'}");
// Long enough for the lazy renderers / Drive data, and the element is kept
// centred while the layout settles.
frag('[ChartStarLayer] the chart is brought into view', CSL, "el.scrollIntoView({ block: 'center', behavior: 'smooth' })");
frag('[ChartStarLayer] it is flashed', CSL, "card.style.outline = '3px solid #3b82f6';");
frag('[ChartStarLayer] the layout is given time to settle', CSL, 'const SETTLE_MS = 4200;');
frag('[ChartStarLayer] lazy renderers get 20 s', CSL, 'const DEADLINE_MS = 20000;');
frag('[ChartStarLayer] the user takes over at will', CSL, "host.addEventListener('pointerdown', onUser, opts);");
// The request survives the retries (the old code removed it immediately, which
// let the page's scroll memory put the user back where they were).
frag('[ChartStarLayer] the request is only dropped when done', CSL, 'clearPendingFigureScroll();');
checkTrue('[ChartStarLayer] no early removal (the request survives the retries)',
  !CSL.includes("localStorage.removeItem('labPendingFigureScroll')"));

/* ══════════════════════════════════════════════════════════════════════════
   5) THE PAGE'S SCROLL MEMORY STANDS DOWN
   ══════════════════════════════════════════════════════════════════════════ */
// useExperimentScrollMemory re-applied the remembered offset (12 retries, up to
// ~1.7 s) right after the chart scroll, which is why the user ended up on the
// right page but not at the graph.
frag('[ui] the scroll memory knows about the request', UI, "import { hasFreshPendingFigureScroll } from '../utils/pendingFigureScroll';");
frag('[ui] …and stands down while it is pending', UI, 'if (hasFreshPendingFigureScroll()) return undefined;');
const restoreIdx = UI.indexOf('if (hasFreshPendingFigureScroll()) return undefined;');
const savedIdx = UI.indexOf('const saved = readViewScroll(scope);');
checkTrue('the stand-down happens BEFORE the restore', restoreIdx > 0 && savedIdx > restoreIdx);
// …and only for a request that was just queued (a parked one must never freeze
// the scroll memory of the next experiments the user opens).
frag('[pendingFigureScroll] the scroll memory uses the freshness window', UTIL, 'export const hasFreshPendingFigureScroll = (withinMs = 12000) => {');
queuePendingFigureScroll({ key: 'k', testId: 't-1' });
checkTrue('a just-queued request is fresh', hasFreshPendingFigureScroll());
NOW += 12001;
checkTrue('after the window it no longer holds the scroll memory back', !hasFreshPendingFigureScroll());
checkTrue('…even though the request itself is still parked', !!peekPendingFigureScroll());
clearPendingFigureScroll();
checkTrue('no request → nothing to stand down for', !hasFreshPendingFigureScroll());
// A parked request for another experiment must not touch the page it does not
// belong to.
frag('[ChartStarLayer] the request is matched to the page', CSL, 'if (test && pending.testName && pending.testId !== test.id && pending.testName !== test.name) {');

/* ══════════════════════════════════════════════════════════════════════════
   6) THE UTILITY MODULE ITSELF
   ══════════════════════════════════════════════════════════════════════════ */
frag('[pendingFigureScroll] the storage key is unchanged', UTIL, "export const PENDING_FIGURE_SCROLL_KEY = 'labPendingFigureScroll';");
frag('[pendingFigureScroll] a stale request expires', UTIL, 'export const PENDING_TTL_MS = 60000;');
frag('[pendingFigureScroll] queue', UTIL, 'export const queuePendingFigureScroll = (payload = {}) => {');
frag('[pendingFigureScroll] peek', UTIL, 'export const peekPendingFigureScroll = () => {');
frag('[pendingFigureScroll] clear', UTIL, 'export const clearPendingFigureScroll = () => {');
frag('[pendingFigureScroll] the instance resolver', UTIL, 'export const resolveOriginTest = (tests = [], origin = null) => {');

Date.now = realNow;
console.table(results);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `❌ ${failed.length} check(s) failed` : `✅ ${results.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

