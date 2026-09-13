/* =========================================================================
   _figure_recapture_test.mjs — the AUTOMATIC figure re-capture pipeline.

   "⚖️ Character sizes → 🔄 Recapture": instead of the manual round trip
   (open the experiment → 🎨 → 📷 → go back), the Image Builder queues the
   figures that do not match the current style; the experiment page applies the
   profile, re-captures each element and REPLACES its library entry, then the
   app returns to the Image Builder.

   The queue module is imported for real (a localStorage shim is installed
   first — the module is plain JS with guards) and the wiring of the three
   other files is checked at the source level.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* ── a tiny localStorage so the real module can be exercised in Node ───────── */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear()
};
const events = [];
globalThis.window = { dispatchEvent: (e) => { events.push(e); return true; }, addEventListener: () => {}, removeEventListener: () => {} };
globalThis.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } };

const R = await import('./src/utils/figureRecapture.js');

const results = [];
const check = (name, fn) => {
  try { fn(); results.push({ name, ok: true, got: '' }); }
  catch (e) { results.push({ name, ok: false, got: e.message }); }
};
const eq = (a, b, msg) => assert.deepEqual(a, b, msg || `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
const ok = (v, msg) => assert.ok(v, msg);
const SRC = (p) => readFileSync(`./src/${p}`, 'utf8');

const ITEM = (over = {}) => ({
  figId: 'fig1', scope: 'project', projectId: 'P1', label: 'CD Spectra · Chart · 1',
  elementKey: 'CD Spectra · Chart · 1', styleTag: 'fs16-t18-lg16-lb16-rot0',
  origin: { testId: 't1', testName: 'CD', instanceName: 'cond A', date: '2026-01-02' },
  ...over
});

/* ── 1. the queue ─────────────────────────────────────────────────────────── */
check('1 an empty queue reads as null', () => {
  R.clearFigureRecaptures();
  eq(R.readFigureRecapture(), null);
  eq(R.figureRecaptureProgress(), { total: 0, done: 0, failed: 0, pending: 0 });
  eq(R.figureRecaptureSummary(), null);
});
check('2 queueing normalises every item and starts them all pending', () => {
  const run = R.queueFigureRecaptures([ITEM(), ITEM({ figId: 'fig2', scope: 'common', projectId: null })], {
    origin: 'image-builder', return: { module: 'image-builder', projectId: 'P1' }
  });
  eq(run.items.length, 2);
  eq(run.items[0].scope, 'project');
  eq(run.items[1].scope, 'common');
  eq(run.items[1].projectId, null);
  eq(run.items.map((i) => i.status), ['pending', 'pending']);
  eq(R.figureRecaptureProgress(), { total: 2, done: 0, failed: 0, pending: 2 });
  eq(run.returnTo.module, 'image-builder');
});
check('3 a single item can be queued on its own (the per-row 🔄 button)', () => {
  R.queueFigureRecaptures(ITEM({ figId: 'solo', label: 'Solo' }));
  eq(R.figureRecaptureProgress().total, 1);
  eq(R.readFigureRecapture().items[0].label, 'Solo');
});
check('4 the items of a page are selected by experiment id', () => {
  R.queueFigureRecaptures([ITEM(), ITEM({ figId: 'fig2', origin: { testId: 't2', testName: 'NMR' } })]);
  const mine = R.figureRecapturesForTest({ id: 't1', name: 'CD' });
  eq(mine.map((i) => i.figId), ['fig1']);
  eq(R.figureRecapturesForTest({ id: 't9', name: 'Other' }).length, 0);
});
check('5 an experiment rebuilt with NEW ids is still matched by name + instance', () => {
  R.queueFigureRecaptures(ITEM());
  eq(R.figureRecapturesForTest({ id: 'newId', name: 'CD', instanceName: 'cond A', date: '2026-01-02' }).length, 1);
  eq(R.figureRecapturesForTest({ id: 'newId', name: 'CD', instanceName: 'cond B' }).length, 0, 'another condition must not be touched');
  eq(R.figureRecapturesForTest({ id: 'x', name: 'NMR' }).length, 0);
});


check('6 a done figure is not queued again', () => {
  R.queueFigureRecaptures([ITEM(), ITEM({ figId: 'fig2' })]);
  R.markFigureRecaptureResult('fig1', 'done', 're-captured');
  eq(R.figureRecapturesForTest({ id: 't1', name: 'CD' }).map((i) => i.figId), ['fig2']);
  eq(R.figureRecaptureProgress(), { total: 2, done: 1, failed: 0, pending: 1 });
  R.markFigureRecaptureResult('fig2', 'failed', 'chart not found');
  eq(R.figureRecaptureProgress(), { total: 2, done: 1, failed: 1, pending: 0 });
  eq(R.readFigureRecapture().items[1].message, 'chart not found');
});
check('7 the summary tells the Image Builder what happened', () => {
  const sum = R.figureRecaptureSummary();
  eq(sum.done, 1);
  eq(sum.failed, 1);
  eq(sum.results.map((r) => r.status), ['done', 'failed']);
  eq(sum.results[1].message, 'chart not found');
});
check('8 the next experiment of the run drives the automatic chain', () => {
  eq(R.nextRecaptureTarget(), null, 'nothing pending');
  R.queueFigureRecaptures([ITEM(), ITEM({ figId: 'fig2', origin: { testId: 't2', testName: 'NMR' } })]);
  R.markFigureRecaptureResult('fig1', 'done', '');
  eq(R.nextRecaptureTarget().origin.testId, 't2');
});
check('9 a stale run is forgotten (never drives the app later)', () => {
  const run = R.queueFigureRecaptures([ITEM()]);
  store.set(R.FIGURE_RECAPTURE_KEY, JSON.stringify({ ...run, at: Date.now() - R.FIGURE_RECAPTURE_TTL_MS - 1000 }));
  eq(R.readFigureRecapture(), null);
  eq(store.has(R.FIGURE_RECAPTURE_KEY), false, 'a stale run is dropped from the storage too');
});
check('10 the fresh-run guard keeps the Image Builder banner for a while', () => {
  R.queueFigureRecaptures([ITEM()]);
  eq(R.hasFreshFigureRecapture(), true);
  R.clearFigureRecaptures();
  eq(R.hasFreshFigureRecapture(), false);
});
check('11 a broken run (no items / bad JSON) never crashes the readers', () => {
  store.set(R.FIGURE_RECAPTURE_KEY, '{not json');
  eq(R.readFigureRecapture(), null);
  eq(R.figureRecaptureSummary(), null);
  store.set(R.FIGURE_RECAPTURE_KEY, JSON.stringify({ at: Date.now(), items: [] }));
  eq(R.readFigureRecapture(), null);
  R.clearFigureRecaptures();
});
check('12 subscribing is notified on every write (the builder refreshes live)', () => {
  let seen = 0;
  const off = R.subscribeFigureRecapture(() => { seen += 1; });
  R.queueFigureRecaptures([ITEM()]);
  R.markFigureRecaptureResult('fig1', 'done', '');
  R.clearFigureRecaptures();
  off();
  eq(seen, 3);
  eq(events.filter((e) => e.type === R.FIGURE_RECAPTURE_EVENT).length >= 3, true, 'the window event too');
});
check('13 the navigation events and the storage key have stable names', () => {
  eq(R.RECAPTURE_RETURN_EVENT, 'lab:open-image-builder');
  eq(R.RECAPTURE_NEXT_TEST_EVENT, 'lab:open-origin-test');
  eq(R.FIGURE_RECAPTURE_KEY, 'labFigureRecapture');
});

/* ── 2. the Image Builder offers the automatic path ───────────────────────── */
const IB = SRC('components/ImageBuilder.jsx');
check('14 the audit row carries what a re-capture needs', () => {
  ok(IB.includes('export const figureStyleAudit = (objects, currentTag'), 'no audit');
  ok(IB.includes("const libId = (im && im.libId) || '';"), 'the library entry id is not read');
  ok(IB.includes("const elementKey = (src && src.elementKey) || '';"), 'the element stamp is not read');
  ok(IB.includes('canRecapture: !!libId && !!elementKey && !isCanvas'), 'the row does not say whether it can be redone');
});
check('15 the builder queues the figures and opens the experiment', () => {
  ok(IB.includes('queueFigureRecaptures(items, {'), 'no queue');
  ok(IB.includes("origin: 'image-builder',"), 'the run does not say where it came from');
  ok(IB.includes("return: { module: 'image-builder', projectId: projectId || null }"), 'no return target');
  ok(IB.includes('if (jumpToTest && first.origin && first.origin.testId) jumpToTest(first.origin.testId, first.origin);'), 'the first experiment is not opened');
  ok(IB.includes('figId: r.libId,'), 'the library entry to replace is not passed');
  ok(IB.includes('elementKey: r.elementKey,'), 'the chart to find again is not passed');
});
check('16 both buttons exist (per row + all at once)', () => {
  ok(IB.includes('🔄 Recapture automatically ({recapturableCount})'), 'no “recapture all” button');
  ok(IB.includes('onClick={() => recaptureFigures(styleBad)}'), 'the all-button is not wired');
  ok(IB.includes('onClick={() => recaptureFigures([r])}'), 'the per-row button is not wired');
  ok(IB.includes('onClick={() => openOriginalGraph(r.src)}'), 'the manual fallback was dropped');
});
check('17 coming back shows the result and refreshes the canvas', () => {
  ok(IB.includes('figureRecaptureSummary()'), 'the result is not read');
  ok(IB.includes('subscribeFigureRecapture(sync)'), 'the builder does not follow the run');
  ok(IB.includes('setObjects((objs) => objs.map((o) => ((o.libId || (o.images || []).some((im) => im && im.libId)) ? resolveObj(o) : o)));'), 'the new pixels are never pulled back');
  ok(IB.includes('Automatic re-capture'), 'no report banner');
});


/* ── 3. the experiment page does the work ─────────────────────────────────── */
const CSL = SRC('components/ChartStarLayer.jsx');
check('18 the page picks up its own queued figures', () => {
  ok(CSL.includes('figureRecapturesForTest(test)'), 'the queue is never read');
  ok(CSL.includes('if (!figureRecapturesForTest(test).length) return undefined;'), 'the engine runs without a request');
});
check('19 it applies the profile BEFORE capturing', () => {
  ok(CSL.includes('applyFigureStyleEverywhere(readFigureStyle())'), 'the profile is not applied');
  ok(CSL.includes('figureStyleTag()'), 'the new stamp is not written');
  ok(CSL.includes('update({ figureStyleTag: res.tag, figureStyleAppliedAt: new Date().toISOString() })'), 'the page is not marked as styled');
});
check('20 it finds the exact element by its stamp and captures it', () => {
  ok(CSL.includes("rootEl.querySelectorAll('[data-figure-origin]')"), 'the elements are not searched');
  ok(CSL.includes("el.getAttribute('data-figure-origin') === key"), 'the stamp is not compared');
  ok(CSL.includes('const url = await captureFigure(el, kindOf(el));'), 'the element is not captured');
  ok(CSL.includes("if (el.hasAttribute && el.hasAttribute('data-star-group')) return 'group';"), 'a composite panel would not be captured as a whole');
});
check('21 it REPLACES the library entry (same id) instead of adding a copy', () => {
  ok(CSL.includes('updateId: item.figId'), 'no in-place update');
  ok(CSL.includes("if (!res || !res.updated) return { ok: false, message: 'the saved figure is no longer in the image library' };"), 'a missing entry is not reported');
  const LIB = SRC('utils/figuresLibrary.js');
  ok(LIB.includes('if (updateId) {'), 'publishLibraryFigure has no in-place path');
});
check('22 it reports the outcome and waits for a lazy chart', () => {
  ok(CSL.includes("markFigureRecaptureResult(item.figId, out.ok ? 'done' : 'failed', out.message);"), 'the result is not recorded');
  ok(CSL.includes('const DEADLINE_MS = 30000;'), 'no deadline (a lazy chart is not waited for)');
  ok(CSL.includes('data-figure-recapture="1"'), 'no progress chip');
  ok(CSL.includes('<b>{recap.done}</b>/{recap.total}'), 'the chip does not count');
});
check('23 it hands over: next experiment, else back to the Image Builder', () => {
  ok(CSL.includes('RECAPTURE_NEXT_TEST_EVENT'), 'the page never chains to the next experiment');
  ok(CSL.includes('RECAPTURE_RETURN_EVENT'), 'the page never returns to the builder');
  ok(CSL.includes('const next = nextRecaptureTarget();'), 'the chain does not look at the queue');
});
check('24 the cleanup never leaves a timer or a style-apply behind', () => {
  ok(CSL.includes('clearInterval(timer);'), 'the poll is not stopped');
  ok(CSL.includes('if (cancelApply) cancelApply();'), 'the parked style re-applies are not cancelled');
});

/* ── 4. App performs the two navigations ─────────────────────────────────── */
const APP = SRC('App.jsx');
check('25 App listens for the two recapture hops', () => {
  ok(APP.includes("import { RECAPTURE_RETURN_EVENT, RECAPTURE_NEXT_TEST_EVENT } from './utils/figureRecapture';"), 'no import');
  ok(APP.includes('window.addEventListener(RECAPTURE_NEXT_TEST_EVENT, onOpenTest);'), 'no test hop');
  ok(APP.includes('window.addEventListener(RECAPTURE_RETURN_EVENT, onOpenBuilder);'), 'no builder hop');
  ok(APP.includes('navRef.current.jumpToTest(detail.testId, detail.origin || null);'), 'the test hop does not use the live navigation');
  ok(APP.includes('navRef.current.openImageBuilder(detail.projectId || undefined);'), 'the builder hop does not use the live navigation');
  ok(APP.includes('window.removeEventListener(RECAPTURE_RETURN_EVENT, onOpenBuilder);'), 'the listeners are never removed');
});

const failed = results.filter((r) => !r.ok);
console.table(results.map((r) => ({ name: r.name, ok: r.ok, error: r.ok ? '' : r.got })));
if (failed.length) {
  console.error(`\n❌ ${failed.length}/${results.length} checks failed`);
  process.exit(1);
}
console.log(`\n✅ ${results.length}/${results.length} checks passed`);
