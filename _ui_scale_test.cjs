/* Validates the “Display scale” — the ONE number that rescales every page.
 *
 *   src/utils/uiScale.js   the value itself: default, clamping, `0` = keep the
 *      browser's own default size, read from / written to localStorage, applied
 *      on document.documentElement.style.fontSize (Tailwind v4 computes every
 *      text size and spacing step in `rem`, so the ROOT size scales the whole
 *      program: characters, paddings, gaps, the sidebar, the modals).
 *   src/main.jsx           applies the stored value BEFORE the first render.
 *   src/index.css          restates the arbitrary text tokens in `rem` (the
 *      8–11px readability floor AND 13/14/15px), otherwise only `rem` follows.
 *   settingsModule.jsx     offers the presets to EVERY user (per-browser pref).
 *   activeTestModule.jsx   the chrome of the experiment page: a REPLIABLE header
 *      — a thin bar that is ALWAYS visible (◀ Back · experiment name · condition
 *      on screen · 🔄 Refresh · ▸ Expand all · ▸ More details) over the TWO
 *      compact bars it folds away (identity + actions on ONE wrapping line, then
 *      the identification fields on a full-width grid of COMPACT inline-label
 *      fields) and the Date/Conditions chips that wrap instead of pushing a
 *      sideways scrollbar. « 🔄 Refresh » re-mounts the page (key in App.jsx)
 *      instead of reloading the tab, so the path to the page is never lost.
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = __dirname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const UTIL = read('src/utils/uiScale.js');
const MAIN = read('src/main.jsx');
const CSS = read('src/index.css');
const SET = read('src/components/AppModules/settingsModule.jsx');
const ATM = read('src/components/AppModules/activeTestModule.jsx');

const results = [];
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push({ name, got: String(got), want: String(want), ok });
  return ok;
};
const checkTrue = (name, got) => check(name, !!got, true);
const frag = (name, hay, needle) => checkTrue(`${name}: ${needle.slice(0, 46)}…`, hay.includes(needle));

(async () => {
  /* ── a fake browser: localStorage + just enough DOM for the util ────────── */
  const store = new Map();
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); }
  };
  const el = {
    style: {
      fontSize: '',
      removeProperty(p) { if (p === 'font-size') this.fontSize = ''; }
    }
  };
  global.document = { documentElement: el };

  const UI = await import(pathToFileURL(path.join(ROOT, 'src/utils/uiScale.js')).href);
  const KEY = 'labWorkspace_uiScale';

  /* ══════════════════════════════════════════════════════════════════════════
     1) THE STORED VALUE — default, reading, clamping, “browser default”
     ══════════════════════════════════════════════════════════════════════════ */
  frag('uiScale.js declares the storage key', UTIL, `export const UI_SCALE_KEY = '${KEY}';`);
  check('1a the shipped default is 15px (a touch denser than the 16px browser default)', UI.UI_SCALE_DEFAULT, 15);
  check('1b an empty storage falls back to the default', UI.readUiScale(), 15);

  store.set(KEY, '14');
  check('1c a stored value is read back', UI.readUiScale(), 14);

  store.set(KEY, 'not-a-number');
  check('1d garbage falls back to the default', UI.readUiScale(), 15);

  store.set(KEY, '0');
  check('1e 0 means “leave the browser default alone” — it must NOT be clamped up to 12',
    UI.readUiScale(), 0);

  store.set(KEY, '99');
  check('1f a too large value is clamped', UI.readUiScale(), UI.UI_SCALE_MAX);
  check('1g …and the ceiling stays sane', UI.UI_SCALE_MAX, 18);

  store.set(KEY, '-4');
  check('1h a too small value is clamped', UI.readUiScale(), UI.UI_SCALE_MIN);
  check('1i …and the floor stays sane', UI.UI_SCALE_MIN, 12);

  /* A broken storage (private mode) must not break the boot. */
  const realGetItem = global.localStorage.getItem;
  global.localStorage.getItem = () => { throw new Error('storage disabled'); };
  check('1j a storage that throws still yields the default', UI.readUiScale(), 15);
  global.localStorage.getItem = realGetItem;

  /* ══════════════════════════════════════════════════════════════════════════
     2) APPLYING IT — the root character size, and the way back
     ══════════════════════════════════════════════════════════════════════════ */
  UI.applyUiScale(14);
  check('2a a scale is written on the ROOT element (every rem follows it)', el.style.fontSize, '14px');

  UI.applyUiScale(0);
  check('2b “browser default” REMOVES the override (accessibility settings survive)', el.style.fontSize, '');

  UI.saveUiScale(13);
  check('2c saving applies immediately', el.style.fontSize, '13px');
  check('2d …and persists for this browser', store.get(KEY), '13');

  store.set(KEY, '17');
  UI.applyStoredUiScale();
  check('2e main.jsx applies what is stored', el.style.fontSize, '17px');
  check('2f …and does so before React renders', MAIN.indexOf('applyStoredUiScale()') > 0
    && MAIN.indexOf('applyStoredUiScale()') < MAIN.indexOf('ReactDOM.createRoot'), true);
  frag('main.jsx imports the helper', MAIN, `import { applyStoredUiScale } from './utils/uiScale'`);

  /* ══════════════════════════════════════════════════════════════════════════
     3) THE CSS MUST FOLLOW — only `rem` tracks the root size
     ══════════════════════════════════════════════════════════════════════════ */
  frag('index.css keeps the 8–11px floor in rem', CSS, 'font-size: 0.75rem !important;   /* 12px */');
  frag('index.css restates 13px in rem', CSS, '[class^="text-[13px]"], [class*=" text-[13px]"] { font-size: 0.8125rem !important; }');
  frag('index.css restates 14px in rem', CSS, '[class^="text-[14px]"], [class*=" text-[14px]"] { font-size: 0.875rem !important; }');
  frag('index.css restates 15px in rem', CSS, '[class^="text-[15px]"], [class*=" text-[15px]"] { font-size: 0.9375rem !important; }');
  check('3a the table base is still declared AFTER the global token rules (tables keep winning)',
    CSS.lastIndexOf('table td,') > CSS.indexOf('[class^="text-[13px]"]'), true);
  check('3b …and the table base itself is 13px in rem (so it scales too)',
    CSS.includes('font-size: 0.8125rem !important;  /* 13px — shared tabular base */'), true);

  /* ══════════════════════════════════════════════════════════════════════════
     4) THE CONTROL — Settings, visible to every user, per browser
     ══════════════════════════════════════════════════════════════════════════ */
  frag('settingsModule imports the presets', SET, `import { UI_SCALE_PRESETS, readUiScale, saveUiScale } from '../../utils/uiScale';`);
  frag('settingsModule defines the control', SET, 'const DisplayScaleControl = () => {');
  frag('…writes through the shared setter', SET, 'const pick = (px) => { setScale(px); saveUiScale(px); };');
  frag('…and the page shows it', SET, 'title="Display scale — character size of every page"');
  check('4a the section sits before the superuser-only block (a screen property, not a dataset setting)',
    SET.indexOf('<DisplayScaleControl />') > 0
    && SET.indexOf('<DisplayScaleControl />') < SET.indexOf('<ScientistsOperatorsManager'), true);
  check('4b it is NOT inside the `isSuper &&` block',
    SET.indexOf('{isSuper && (') > SET.indexOf('<DisplayScaleControl />'), true);
  check('4c the presets offer the browser default back',
    UI.UI_SCALE_PRESETS.some((p) => p.px === 0), true);
  check('4d …and the shipped default is one of the presets',
    UI.UI_SCALE_PRESETS.some((p) => p.px === UI.UI_SCALE_DEFAULT), true);
  check('4e …and a preset sits ON the floor, so “too big” is one click away',
    UI.UI_SCALE_PRESETS.some((p) => p.px === UI.UI_SCALE_MIN), true);

  /* ══════════════════════════════════════════════════════════════════════════
     5) THE CHROME OF THE EXPERIMENT PAGE — stacked, it is worth a THIRD of the
        screen, so the header is laid out as TWO compact bars
     ══════════════════════════════════════════════════════════════════════════ */
  /* Bar 1 — name + classification chips + “◀ Back” + the action buttons on ONE
     wrapping line. It used to be `flex-col lg:flex-row`, i.e. two stacked rows
     as soon as the window is narrower than the `lg` breakpoint. */
  frag('bar 1 lays identity + actions on ONE wrapping line', ATM,
    '<div className="bg-white border-b border-slate-200 px-3 md:px-4 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 shadow-sm">');
  check('5a the old stacked identity bar is gone',
    ATM.includes('py-2 flex flex-col lg:flex-row justify-between items-start lg:items-center'), false);

  /* Bar 2 — the identification fields on a grid of their OWN, at the FULL width
     of the page. Inside the action-button row (`lg:w-auto`) they were squeezed
     into a few hundred pixels, and eight fields became three or four rows. */
  frag('the identification fields get a full-width bar of their own', ATM,
    '<div className="bg-white border-b border-slate-200 px-3 md:px-4 py-1.5 grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-x-2 gap-y-1 shadow-sm">');
  check('5b the fields grid is opened exactly once',
    (ATM.match(/grid-cols-\[repeat\(auto-fit,minmax\(210px,1fr\)\)\]/g) || []).length, 1);
  check('5c …AFTER the action buttons, i.e. NOT inside their row',
    ATM.indexOf('grid-cols-[repeat(auto-fit,minmax(210px,1fr))]')
      > ATM.indexOf('flex flex-wrap items-center gap-1.5 shrink-0'), true);
  check('5d the grid wraps the fields (opened before them, closed before the strip)',
    ATM.indexOf('minmax(210px,1fr)') < ATM.indexOf('<React.Fragment>')
    && ATM.indexOf('minmax(210px,1fr)') < ATM.indexOf('{siblingTests.length > 0 && ('), true);
  check('5e no field keeps a column minimum that would re-create the old stacked rows',
    ATM.includes('flex flex-col flex-1 min-w-['), false);
  check('5f every field label sits IN LINE with its control (half the height)',
    (ATM.match(/shrink-0 text-\[10px\] font-bold text-slate-400 uppercase/g) || []).length >= 7, true);

  frag('the Date / Conditions chips WRAP', ATM,
    'className="bg-blue-50 border-b border-blue-200 px-4 md:px-6 py-1.5 flex flex-wrap items-center gap-1.5 shadow-inner"');
  check('5g the strip no longer forces a sideways scrollbar',
    ATM.includes('overflow-x-auto custom-scrollbar gap-2 shadow-inner'), false);
  check('5h the strip comment is a JS comment — a JSX `{/* … */}` inside `&& (` would not compile',
    ATM.includes('/* Date / Conditions strip') && !ATM.includes('{/* Date / Conditions strip'), true);

  /* ══════════════════════════════════════════════════════════════════════════
     6) LA BARRE DU HAUT SE REPLIE, ET LA PAGE SE RAFRAÎCHIT SUR PLACE

        Deux demandes : (a) la barre horizontale du haut doit être repliable —
        elle prenait un tiers de l'écran ; (b) chaque page d'expérience doit
        porter un bouton « 🔄 Refresh », car un rechargement depuis la barre du
        navigateur obligeait à refaire tout le chemin jusqu'à la page.
     ══════════════════════════════════════════════════════════════════════════ */
  const APP = read('src/App.jsx');
  const ATML = ATM.replace(/\r\n/g, '\n');
  const APPL = APP.replace(/\r\n/g, '\n');

  frag('the header folds', ATML, 'const [headerOpen, setHeaderOpen] = useState(() => {');
  frag('…and starts FOLDED (only the thin bar is shown)', ATML,
    "try { return sessionStorage.getItem(EXPERIMENT_HEADER_KEY) === '1'; } catch { return false; }");
  frag('the fold is remembered for the browser session', ATML,
    "sessionStorage.setItem(EXPERIMENT_HEADER_KEY, headerOpen ? '1' : '0')");
  frag('the whole chrome is behind that toggle', ATML, '{headerOpen && (\n                      <>');
  frag('the thin bar holds ◀ Back', ATML, '{backButton}');
  frag('…the experiment name', ATML,
    "{String(activeTest.name || '').trim() || (isBox ? 'Untitled box' : 'Untitled experiment')}");
  frag('…the condition displayed on the page', ATML,
    "const conditionLabel = String(activeTest.instanceName || activeTest.date || '').trim();");
  frag('…the 🔄 Refresh button', ATML, '🔄 Refresh');
  frag('…wired to App', ATML, 'onClick={onRefreshPage}');
  frag('…with a “✓ page refreshed” confirmation', ATML, '✓ page refreshed');
  frag('…and the ▸ More details toggle', ATML, "{headerOpen ? '▾ Fewer details' : '▸ More details'}");
  check('5j a box that cannot be identified still warns while folded',
    ATML.indexOf('{boxIssues.length > 0 && (') < ATML.indexOf('{headerOpen && ('), true);
  frag('…the ▸ Expand all hook stays OUTSIDE the folded block', ATML,
    "data-expand-all={allSectionsOpen ? undefined : '1'}");
  check('5i …so the Image Builder can still open a closed section while folded',
    ATML.indexOf("data-expand-all={allSectionsOpen ? undefined : '1'}") < ATML.indexOf('{headerOpen && ('), true);

  frag('App re-mounts the page instead of reloading the tab', APPL, 'key={`test-page-${testPageNonce}`}');
  frag('…through a single refresh funnel', APPL, 'const refreshTestPage = useCallback(() => {');
  frag('…passed down to the page', APPL, 'onRefreshPage={refreshTestPage}');

  /* ══════════════════════════════════════════════════════════════════════════ */
  const failed = results.filter((r) => !r.ok);
  if (failed.length) for (const f of failed) console.error(`✗ ${f.name}\n     got ${f.got}\n    want ${f.want}`);
  console.log(failed.length ? `❌ ${failed.length} check(s) failed` : `✅ ${results.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})();
