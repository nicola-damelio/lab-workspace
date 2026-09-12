// Validates the « ↩ Back to experiment » view memory added for the experiment
// pages: the button reopened the experiment (sometimes on the right condition)
// but dumped the user at the top of the page instead of the subsection they
// were reading — and the scroll offset is what carries the "same region of the
// subsection".
//
// The component (src/components/ui.jsx, useExperimentScrollMemory +
// read/writeViewScroll) cannot be imported here (JSX module), so the rules
// under test are mirrored verbatim. Keep them in sync with ui.jsx:
//   * readViewScroll / writeViewScroll  – the per-condition offset store
//   * isScrollContainer()               – which container really scrolls
//   * the restore loop                  – clamp + retry while the layout grows
//   * handleReturnToTest() fallback     – App.jsx: which condition to reopen
const SCROLL_MEMORY_KEY = 'labExperimentScroll';
const SCROLL_MEMORY_MAX_TESTS = 200;
const SCROLL_RANGE_MIN = 8;

// ---- fake browser: sessionStorage + getComputedStyle ----------------------
const store = new Map();
global.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const el = ({ overflowY = 'auto', scrollHeight = 2000, clientHeight = 800, scrollTop = 0 } = {}) => ({
  overflowY, scrollHeight, clientHeight, scrollTop,
  addEventListener() {}, removeEventListener() {},
});
global.window = { getComputedStyle: (e) => ({ overflowY: e.overflowY }) };

// ---- fake localStorage: the per-experiment SECTION memory (ui.jsx) --------
const lstore = new Map();
global.localStorage = {
  getItem: (k) => (lstore.has(k) ? lstore.get(k) : null),
  setItem: (k, v) => lstore.set(k, String(v)),
  removeItem: (k) => lstore.delete(k),
};
const SECTION_MEMORY_KEY = 'labWorkspace_sectionMemory';
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
const readSectionOpen = (scope, key, fallback) => {
  if (!scope || !key) return fallback;
  const bucket = loadSectionMemory()[scope];
  const saved = bucket ? bucket[key] : undefined;
  return typeof saved === 'boolean' ? saved : fallback;
};
const writeSectionOpen = (scope, key, open) => {
  if (!scope || !key) return;
  const mem = loadSectionMemory();
  if (!mem[scope]) mem[scope] = {};
  mem[scope][key] = !!open;
  localStorage.setItem(SECTION_MEMORY_KEY, JSON.stringify(mem));
};
// Mirror of useSectionMemory(key, fallback) — the page's own group toggles.
const groupToggle = (scope, key, fallback = false) => {
  const state = { open: readSectionOpen(scope, scope ? String(key || '') : null, fallback), writes: 0 };
  writeSectionOpen(scope, key, state.open); // the hook's [open] effect fires once on mount
  state.set = (next) => {
    state.open = !!next;
    writeSectionOpen(scope, String(key), state.open);
    state.writes += 1;
  };
  state.toggle = () => state.set(!state.open);
  // The header's "expand all / collapse all" command (null = no command).
  state.applyCmd = (cmd) => { if (cmd !== null && cmd !== undefined) state.set(cmd); };
  return state;
};

let scrollMemoryCache = null;
const loadScrollMemory = () => {
  if (scrollMemoryCache) return scrollMemoryCache;
  try {
    const raw = JSON.parse(sessionStorage.getItem(SCROLL_MEMORY_KEY) || 'null');
    scrollMemoryCache = raw && typeof raw === 'object' ? raw : {};
  } catch {
    scrollMemoryCache = {};
  }
  return scrollMemoryCache;
};
const readViewScroll = (scope) => {
  if (!scope) return 0;
  const saved = loadScrollMemory()[scope];
  return Number.isFinite(saved) && saved > 0 ? saved : 0;
};
const writeViewScroll = (scope, top) => {
  if (!scope) return;
  const value = Math.max(0, Math.round(Number(top) || 0));
  const mem = loadScrollMemory();
  delete mem[scope];
  if (value > 0) mem[scope] = value;
  const scopes = Object.keys(mem);
  if (scopes.length > SCROLL_MEMORY_MAX_TESTS) {
    scopes.slice(0, scopes.length - SCROLL_MEMORY_MAX_TESTS).forEach((k) => delete mem[k]);
  }
  sessionStorage.setItem(SCROLL_MEMORY_KEY, JSON.stringify(mem));
};
const isScrollContainer = (e) => {
  if (!e || e.scrollHeight - e.clientHeight <= SCROLL_RANGE_MIN) return false;
  const oy = window.getComputedStyle(e).overflowY;
  return oy === 'auto' || oy === 'scroll';
};

// ---- mirror of the hook's two effects (same order as ui.jsx) --------------
// `refs` are the candidate containers handed to the hook, outer first.
const mountPage = (scope, refs) => {
  const latest = { current: 0 };
  const restoring = { current: false };
  const elements = () => refs.filter(Boolean);
  const writes = [];
  const flush = () => { if (latest.current > 0) { writeViewScroll(scope, latest.current); writes.push(latest.current); } };

  // Save effect: new scope → start over; record every user scroll; flush out.
  latest.current = 0;
  const onScroll = (e) => {
    if (restoring.current || !isScrollContainer(e)) return;
    latest.current = e.scrollTop;
    flush(); // (the component throttles with a 200 ms trailing timer)
  };

  // Restore effect: apply the saved offset, retrying while the layout grows.
  const saved = readViewScroll(scope);
  const restoreState = { saved, appliedBy: null, attempts: 0, stopped: false };
  if (saved) {
    restoring.current = true;
    const apply = () => {
      if (restoreState.stopped) return;
      const e = elements().find(isScrollContainer);
      restoreState.attempts += 1;
      if (e) {
        const wanted = Math.min(saved, e.scrollHeight - e.clientHeight);
        if (e.scrollTop !== wanted) e.scrollTop = wanted;
        restoreState.appliedBy = e;
      }
      if (restoreState.attempts >= 12) restoreState.stopped = true;
    };
    // attempt #1 right away, then the component keeps retrying on timers
    apply();
    restoreState.stop = () => { restoreState.stopped = true; restoring.current = false; };
  } else {
    restoreState.stop = () => { restoring.current = false; };
  }

  return {
    onScroll, flush, restoring, latest, restoreState, writes,
    userTakesOver: () => restoreState.stop(),
    applyMore: (n = 1) => { for (let i = 0; i < n; i += 1) {
      if (restoreState.stopped) return;
      const e = elements().find(isScrollContainer);
      if (e) {
        const wanted = Math.min(saved, e.scrollHeight - e.clientHeight);
        if (e.scrollTop !== wanted) e.scrollTop = wanted;
      }
    } },
  };
};

const results = [];
const check = (name, got, want) => {
  const ok = String(got) === String(want);
  results.push({ name, got: String(got), want: String(want), ok });
  return ok;
};
// Identity comparison — for the container references (String() would hide them).
const checkSame = (name, got, want) => {
  const ok = got === want;
  results.push({ name, got: got === want ? 'same element' : 'DIFFERENT element', want: 'same element', ok });
  return ok;
};


// ============================ the store ====================================
writeViewScroll('t3', 1500);
check('round-trip: 1500 px remembered for t3', readViewScroll('t3'), 1500);
writeViewScroll('t3', -20);
check('a 0/negative value forgets the entry', readViewScroll('t3'), 0);
check('(and the whole map stays clean)', sessionStorage.getItem('labExperimentScroll'), '{}');
for (let i = 0; i < 205; i += 1) writeViewScroll('t' + i, 100 + i);
check('the store is bounded to the last 200 conditions', Object.keys(JSON.parse(sessionStorage.getItem('labExperimentScroll'))).length, 200);
check('the oldest entries are the ones dropped', readViewScroll('t0'), 0);
check('the most recent entry is kept', readViewScroll('t204'), 304);
scrollMemoryCache = {}; // start the page scenarios from a clean slate
sessionStorage.setItem('labExperimentScroll', '{}');

// ==================== which container scrolls? =============================
check('desktop page body (overflow auto + range) scrolls',
  isScrollContainer(el({ overflowY: 'auto', scrollHeight: 3000, clientHeight: 800 })), 'true');
check('desktop page root (md:overflow-hidden) does NOT',
  isScrollContainer(el({ overflowY: 'hidden', scrollHeight: 3000, clientHeight: 800 })), 'false');
check('a container without scroll range is ignored',
  isScrollContainer(el({ overflowY: 'auto', scrollHeight: 804, clientHeight: 800 })), 'false');

// ==================== restore on the right container =======================
writeViewScroll('t3', 1500);
const mobileRoot = el({ overflowY: 'auto', scrollHeight: 5000, clientHeight: 800 });
const mobileBody = el({ overflowY: 'visible', scrollHeight: 5000, clientHeight: 5000 });
const m = mountPage('t3', [mobileRoot, mobileBody]);
checkSame('mobile: the page ROOT is the container that scrolls', m.restoreState.appliedBy, mobileRoot);
check('mobile: restored at the remembered offset', mobileRoot.scrollTop, 1500);
check('mobile: the non-scrolling body is left alone', mobileBody.scrollTop, 0);

const deskRoot = el({ overflowY: 'hidden', scrollHeight: 5000, clientHeight: 800 });
const deskBody = el({ overflowY: 'auto', scrollHeight: 5000, clientHeight: 800 });
const d = mountPage('t3', [deskRoot, deskBody]);
checkSame('desktop: the inner BODY is the container that scrolls', d.restoreState.appliedBy, deskBody);
check('desktop: restored at the remembered offset', deskBody.scrollTop, 1500);

// ==================== clamp + retry while the layout grows =================
writeViewScroll('t3', 5000);
const shortBody = el({ overflowY: 'auto', scrollHeight: 900, clientHeight: 800 });
const g = mountPage('t3', [shortBody]);
check('a too far offset is clamped to the current maximum', shortBody.scrollTop, 100);
shortBody.scrollHeight = 9000; // sections/charts have finished laying out
g.applyMore(3);                // the hook keeps retrying with the ORIGINAL offset
check('once the page is laid out, the exact offset is applied', shortBody.scrollTop, 5000);

// ================= the restore never overwrites the memory =================
writeViewScroll('t3', 1500);
const body = el({ overflowY: 'auto', scrollHeight: 4000, clientHeight: 800 });
const p = mountPage('t3', [body]);
p.onScroll(body); // the scroll event fired by our own scrollTop write
check('scroll events caused by the restore are ignored', body.scrollTop, 1500);
check('… so the remembered offset is NOT overwritten', readViewScroll('t3'), 1500);
check('nothing was written while restoring', p.writes.length, 0);

// ================= a real scroll IS remembered (and replaces it) ===========
p.userTakesOver();
body.scrollTop = 2200;
p.onScroll(body);
check('a user scroll is written to the memory', readViewScroll('t3'), 2200);

// ============ leaving without scrolling keeps what was remembered ==========
writeViewScroll('t4', 900);
const untouched = mountPage('t4', [el({ overflowY: 'auto', scrollHeight: 4000, clientHeight: 800 })]);
untouched.flush(); // unmount cleanup: the user never scrolled in this visit
check('no scroll in this visit → the previous offset survives', readViewScroll('t4'), 900);

// ================= conditions keep their own offsets =======================
writeViewScroll('t3', 1500);
check('each condition has its own remembered region', readViewScroll('t4'), 900);
check('… and t3 is still 1500', readViewScroll('t3'), 1500);

// ============ App.jsx: which condition does the button reopen? =============
const resolveReturn = (target, tests) => {
  if (!target || !target.id) return null;
  if (tests.some((t) => t.id === target.id)) return target.id;
  const fallback = target.name
    ? tests.find((t) => t.name === target.name && target.instanceName && t.instanceName === target.instanceName)
      || tests.find((t) => t.name === target.name)
    : null;
  return fallback ? fallback.id : null;
};
const known = [
  { id: 'a1', name: 'Flow test', instanceName: 'Sample 1' },
  { id: 'a2', name: 'Flow test', instanceName: 'Sample 3' },
  { id: 'b1', name: 'Other test', instanceName: 'Sample 1' },
];
check('exact condition id still there → reopen it', resolveReturn({ id: 'a2', name: 'Flow test', instanceName: 'Sample 3' }, known), 'a2');
check('id rebuilt by a Drive restore → same condition (name + instance)',
  resolveReturn({ id: 'gone', name: 'Flow test', instanceName: 'Sample 3' }, known), 'a2');
check('condition renamed → same experiment',
  resolveReturn({ id: 'gone', name: 'Flow test', instanceName: 'Sample 9' }, known), 'a1');
check('experiment deleted → the memory is dropped',
  resolveReturn({ id: 'gone', name: 'Deleted test', instanceName: 'x' }, known), 'null');

// ====== the page's own group toggles (GENERAL / DATA AND ANALYSIS…) ========
// useSectionMemory keeps them per condition, in the SAME memory as the
// sections — they are the "open subsections" the user expects to find again.
const g1 = groupToggle('t3', 'group:data');
check('a group toggle starts closed on a fresh condition', g1.open, false);
g1.toggle();
check('clicking it opens the group', g1.open, true);
const fresh = groupToggle('t9', 'group:general');  // first ever visit of that condition
check('first visit: the group is closed by default', fresh.open, false);
check('… and that visit is noted for the next one',
  readSectionOpen('t9', 'group:general', undefined), false);
const g1b = groupToggle('t3', 'group:data');   // page left and reopened
check('coming back to the SAME condition reopens it', g1b.open, true);
check('another condition is NOT affected', groupToggle('t4', 'group:data').open, false);
g1b.toggle();
check('collapsing it is remembered too', groupToggle('t3', 'group:data').open, false);
const cmd = groupToggle('t3', 'group:report');
cmd.applyCmd(true);                            // header "▸ Expand all"
check('“Expand all” opens the group', cmd.open, true);
check('… and remembers it', groupToggle('t3', 'group:report').open, true);
cmd.applyCmd(false);                           // header "▾ Collapse all"
check('“Collapse all” closes it again', groupToggle('t3', 'group:report').open, false);
g1b.set(true);
check('the group key never collides with a section titled "Data"',
  readSectionOpen('t3', 'Data', false), false);
check('… while the group key itself is remembered', readSectionOpen('t3', 'group:data', false), true);
const outsideScope = groupToggle(null, 'group:data');
outsideScope.toggle();
check('outside an experiment (no SectionsScope) the toggle still works', outsideScope.open, true);
check('… but nothing is written for the next visit', groupToggle(null, 'group:data').open, false);

console.table(results);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `❌ ${failed.length} check(s) failed` : `✅ ${results.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
