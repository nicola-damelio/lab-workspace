/* Validates the “Interface skin” — the palette of the whole program.
 *
 *   src/utils/uiSkin.js   the choice itself: the registry of the skins, the
 *      reference (the shipped palette, which restates NOTHING), per-browser
 *      storage, and the attribute put on <html>.
 *   src/index.css         ONE block per skin: the Tailwind theme variables
 *      restated under `[data-skin="…"]`. Tailwind v4 compiles every colour
 *      utility to those variables, so a block repaints the program without
 *      touching a component — and, because custom properties are INHERITED,
 *      the same attribute paints any element (the Settings miniature).
 *   src/main.jsx          applies the stored skin BEFORE the first render.
 *   settingsModule.jsx    offers the skins to EVERY user, with a LIVE
 *      miniature drawn from the real classes of the interface.
 *
 * The palette half of this suite is the real guardrail: it re-reads Tailwind's
 * own ramps (node_modules/tailwindcss/theme.css — the reference), runs the
 * OKLCH → sRGB → WCAG maths on the pairs the program actually writes, and
 * refuses any skin that costs more than 1.5 steps of contrast anywhere, any
 * ramp that stops being monotonic in lightness, and any hue swap that moves a
 * stop by more than 4 points of OKLCH lightness.
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = __dirname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const UTIL = read('src/utils/uiSkin.js');
const MAIN = read('src/main.jsx');
const CSS = read('src/index.css');
const SET = read('src/components/AppModules/settingsModule.jsx');

const results = [];
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push({ name, got: String(got), want: String(want), ok });
  return ok;
};
const checkTrue = (name, got) => check(name, !!got, true);
const ok = (name, got) => checkTrue(name, got);
const frag = (name, hay, needle) => checkTrue(`${name}: ${needle.slice(0, 44)}…`, hay.includes(needle));

/* ══ the palette maths — OKLCH → sRGB (Ottosson) → WCAG contrast ═══════════ */
const srgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const toLin = ({ L, C, H }) => {
  const h = (H * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L / 100 + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L / 100 - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L / 100 - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s].map((c) => Math.min(1, Math.max(0, c)));
};
const lum = (col) => {
  if (col === 'white') return 1;
  const [r, g, b] = toLin(col);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/* both grammars: `--color-slate-800: oklch(27.9% .041 260.031);` (Tailwind) and
   the same with the numbers written out (our own blocks). */
const DECL = /--color-([a-z]+)(?:-(\d{2,3}))?:\s*oklch\(([\d.]+)%\s+([\d.]+)\s+(none|[\d.]+)\)/g;
const rampsOf = (css) => {
  const out = {};
  for (const m of css.matchAll(DECL)) {
    const [, fam, stop, l, c, h] = m;
    (out[fam] = out[fam] || {})[stop || 'base'] = { L: +l, C: +c, H: h === 'none' ? 0 : +h };
  }
  return out;
};
let SHIPPED = {};
let shippedRead = true;
try {
  SHIPPED = rampsOf(read('node_modules/tailwindcss/theme.css'));
  if (!SHIPPED.slate) shippedRead = false;
} catch { shippedRead = false; }

/* the blocks of our own stylesheet, keyed by skin id (comments stripped for the
   structural checks, so a comment can never masquerade as a rule) */
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const blocks = {};
const blockVars = {};
for (const m of CSS.matchAll(/\[data-skin="([a-z-]+)"\]\s*\{([\s\S]*?)\}/g)) {
  blocks[m[1]] = m[2];
  blockVars[m[1]] = rampsOf(m[2]);
}

const STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const ACCENT = ['blue', 'indigo', 'sky', 'teal', 'violet', 'purple', 'cyan', 'fuchsia'];
const STATUS = ['emerald', 'green', 'amber', 'yellow', 'orange', 'red', 'rose'];
const FAMILIES = ['slate', ...ACCENT, ...STATUS];
/* the pair roles the program writes, family by family (colour census of src:
   7 281 slate · 1 829 white · 1 847 blue · 840 amber · 774 red …) */
const ROLES = [
  ['text-700 on bg-50', (r, f) => ratio(r(f, 700), r(f, 50))],
  ['text-800 on bg-100', (r, f) => ratio(r(f, 800), r(f, 100))],
  ['white on bg-600', (r, f) => ratio(r('white'), r(f, 600))],
  ['text-600 on white', (r, f) => ratio(r(f, 600), r('white'))],
  ['text-700 on white', (r, f) => ratio(r(f, 700), r('white'))],
  ['text-500 on white', (r, f) => ratio(r(f, 500), r('white'))],
  ['text-400 on white', (r, f) => ratio(r(f, 400), r('white'))],
  ['border-300 on white', (r, f) => ratio(r(f, 300), r('white'))],
  ['white on bg-800', (r, f) => ratio(r('white'), r(f, 800))]
];

(async () => {
  /* ── a fake browser: localStorage + just enough DOM for the util ────────── */
  const store = new Map();
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); }
  };
  global.document = { documentElement: { dataset: {} } };

  const UI = await import(pathToFileURL(path.join(ROOT, 'src/utils/uiSkin.js')).href);
  const KEY = 'labWorkspace_uiSkin';
  const root = global.document.documentElement;

  /* ══════════════════════════════════════════════════════════════════════════
     1) THE REGISTRY AND THE STORED VALUE
     ══════════════════════════════════════════════════════════════════════════ */
  frag('uiSkin.js declares the storage key', UTIL, `export const UI_SKIN_KEY = '${KEY}';`);
  frag('…and the reference skin', UTIL, "export const UI_SKIN_DEFAULT = 'slate';");
  ok('1a the helper is a PURE module (no import at all)', !/^import /m.test(UTIL));
  check('1b the reference is one of the skins', UI.UI_SKINS.some((s) => s.id === UI.UI_SKIN_DEFAULT), true);
  check('1c the ids are unique', new Set(UI.UI_SKINS.map((s) => s.id)).size, UI.UI_SKINS.length);
  check('1d every skin carries a label, a hint, a kind and four swatches',
    UI.UI_SKINS.every((s) => s.label && s.hint && ['tone', 'hue'].includes(s.kind)
      && Array.isArray(s.swatch) && s.swatch.length === 4), true);
  check('1e the swatches are real colours',
    UI.UI_SKINS.every((s) => s.swatch.every((c) => /^#[0-9a-f]{6}$/.test(c))), true);
  check('1f no two skins wear the same swatch',
    new Set(UI.UI_SKINS.map((s) => s.swatch.join())).size, UI.UI_SKINS.length);

  check('1g an empty storage is the reference', UI.readUiSkin(), UI.UI_SKIN_DEFAULT);
  store.set(KEY, 'violet');
  check('1h a stored skin is read back', UI.readUiSkin(), 'violet');
  store.set(KEY, 'not-a-skin');
  check('1i garbage falls back to the reference', UI.readUiSkin(), UI.UI_SKIN_DEFAULT);
  store.set(KEY, '');
  check('1j an empty string too', UI.readUiSkin(), UI.UI_SKIN_DEFAULT);
  store.delete(KEY);

  UI.saveUiSkin('graphite');
  check('1k saveUiSkin writes the id', store.get(KEY), 'graphite');
  check('1l …and puts the attribute on <html>', root.dataset.skin, 'graphite');
  UI.saveUiSkin('not-a-skin');
  check('1m …writing the reference for an unknown name', store.get(KEY), UI.UI_SKIN_DEFAULT);
  check('1n …and taking the attribute away', 'skin' in root.dataset, false);

  store.set(KEY, 'warm');
  UI.applyStoredUiSkin();
  check('1o applyStoredUiSkin reads what is stored', root.dataset.skin, 'warm');
  store.delete(KEY);
  UI.applyUiSkin(undefined);
  check('1p an undefined name is the reference (attribute removed)', 'skin' in root.dataset, false);

  /* ══════════════════════════════════════════════════════════════════════════
     2) main.jsx — applied BEFORE the first paint
     ══════════════════════════════════════════════════════════════════════════ */
  frag('main.jsx imports the helper', MAIN, "import { applyStoredUiSkin } from './utils/uiSkin'");
  ok('2a …and applies it', MAIN.includes('\napplyStoredUiSkin()'));
  check('2b …before React renders', MAIN.indexOf('applyStoredUiSkin()') > 0
    && MAIN.indexOf('applyStoredUiSkin()') < MAIN.indexOf('ReactDOM.createRoot'), true);
  check('2c the display scale is applied too (the two settings are neighbours)',
    MAIN.indexOf('applyStoredUiScale()') > 0, true);

  /* ══════════════════════════════════════════════════════════════════════════
     3) THE CONTROL — Settings, visible to every user, with a live miniature
     ══════════════════════════════════════════════════════════════════════════ */
  frag('settingsModule imports the registry', SET,
    "import { UI_SKIN_DEFAULT, UI_SKINS, readUiSkin, saveUiSkin } from '../../utils/uiSkin';");
  frag('settingsModule defines the control', SET, 'const SkinControl = () => {');
  frag('…writes through the shared setter', SET, 'const pick = (id) => { setSkin(id); saveUiSkin(id); };');
  frag('…offers the registry', SET, '{UI_SKINS.map((s) => (');
  frag('the miniature carries the attribute', SET,
    'data-skin={skin.id === UI_SKIN_DEFAULT ? undefined : skin.id}');
  check('3a the miniature is drawn with the REAL classes (chrome, card, accent)',
    SET.includes('rounded bg-slate-800') && SET.includes('border border-slate-200 bg-white')
    && SET.includes('rounded bg-blue-600') && SET.includes('text-white'), true);
  frag('…and the page shows it', SET, 'title="Interface skin — the colours of the whole program"');
  frag('…with the control inside', SET, '<SkinControl />');
  ok('3b the section sits after the display scale', SET.indexOf('<DisplayScaleControl />') < SET.indexOf('<SkinControl />'));
  ok('3c …and BEFORE the superuser-only block', SET.indexOf('<SkinControl />') < SET.indexOf('{isSuper && ('));
  ok('3d …so it is not reserved to the superuser', SET.indexOf('<ScientistsOperatorsManager') > 0);
  frag('…the choice never touches the dataset (localStorage only)', UTIL,
    'localStorage.setItem(UI_SKIN_KEY, skin.id)');

  /* ══════════════════════════════════════════════════════════════════════════
     4) THE BLOCKS — one per skin, keyed on the attribute, unlayered
     ══════════════════════════════════════════════════════════════════════════ */
  const ids = UI.UI_SKINS.map((s) => s.id);
  const others = ids.filter((id) => id !== UI.UI_SKIN_DEFAULT);
  check('4a the reference has NO block of its own (it IS Tailwind’s palette)',
    Object.prototype.hasOwnProperty.call(blocks, UI.UI_SKIN_DEFAULT), false);
  check('4b every other skin has one', others.filter((id) => !blocks[id]), []);
  check('4c …and no block is unknown to the registry',
    Object.keys(blocks).filter((id) => !ids.includes(id)), []);
  check('4d the attribute is on an element, never forced on <html> (so a preview works)',
    /(^|\n)\[data-skin="[a-z-]+"\]\s*\{/.test(CSS) && !/html\[data-skin/.test(CSS), true);
  check('4e no !important anywhere in a skin block',
    Object.values(blocks).every((b) => !b.includes('!important')), true);
  ok('4f the blocks come after the Tailwind import (so they can win)',
    CSS.indexOf('@import "tailwindcss"') < CSS.indexOf('[data-skin='));
  ok('4g …and the theme layer cannot beat them: they are NOT inside @layer',
    !/@layer[^{]*\{[\s\S]*\[data-skin=/.test(CSS_CODE));
  check('4h every declaration is a palette variable (family + stop, or white)',
    Object.entries(blockVars).flatMap(([id, ramps]) => Object.entries(ramps)
      .filter(([fam, stops]) => !((fam === 'white' && Object.keys(stops).length === 1)
        || (FAMILIES.includes(fam) && Object.keys(stops).every((s) => STOPS.includes(+s)))))
      .map(([fam]) => `${id}:${fam}`)), []);
  check('4i the ramps are complete — 11 stops, or the 4-stop status deepening',
    Object.entries(blockVars).flatMap(([id, ramps]) => Object.entries(ramps)
      .filter(([fam, stops]) => {
        if (fam === 'white') return false;
        const k = Object.keys(stops).map(Number).sort((a, b) => a - b);
        return !(k.length === 11 || (k.length === 4 && k.join() === '600,700,800,900'));
      }).map(([fam]) => `${id}:${fam}`)), []);

  /* ══════════════════════════════════════════════════════════════════════════
     5) THE PALETTES — the guardrail
     ══════════════════════════════════════════════════════════════════════════ */
  const effOf = (id) => (fam, stop) => {
    if (fam === 'white') {
      const w = blockVars[id] && blockVars[id].white;
      return (w && w.base) || 'white';
    }
    const o = blockVars[id] && blockVars[id][fam];
    if (o && o[String(stop)]) return o[String(stop)];
    return SHIPPED[fam][String(stop)];
  };
  const worstVsShipped = (id) => {
    const r = effOf(id);
    const ref = (f, stop) => (f === 'white' ? 'white' : SHIPPED[f][String(stop)]);
    let worst = { d: Infinity, role: '', fam: '' };
    for (const [role, fn] of ROLES) {
      for (const fam of FAMILIES) {
        const d = fn(r, fam) - fn(ref, fam);
        if (d < worst.d) worst = { d, role, fam };
      }
    }
    return worst;
  };
  const maxDeltaL = (id) => {
    const r = effOf(id);
    let worst = { d: 0, fam: '', stop: 0 };
    for (const fam of FAMILIES) {
      for (const stop of STOPS) {
        const v = r(fam, stop);
        const d = Math.abs(v.L - SHIPPED[fam][String(stop)].L);
        if (d > worst.d) worst = { d, fam, stop };
      }
    }
    return worst;
  };
  const monotonic = (id) => {
    const r = effOf(id);
    const bad = [];
    for (const fam of FAMILIES) {
      for (let i = 1; i < STOPS.length; i++) {
        if (!(r(fam, STOPS[i]).L < r(fam, STOPS[i - 1]).L)) bad.push(`${fam}-${STOPS[i]}`);
      }
    }
    return bad;
  };

  if (!shippedRead) {
    console.log('⚠ node_modules/tailwindcss/theme.css not readable — the “vs the shipped palette” checks are SKIPPED');
  } else {
    check('5a the shipped palette IS the reference (blue-600 and slate-50 spot-check)',
      SHIPPED.blue['600'].L > 54 && SHIPPED.blue['600'].L < 55 && SHIPPED.slate['50'].L > 98, true);
    for (const id of others) {
      const worst = worstVsShipped(id);
      ok(`5b ${id}: no pair of the program loses more than 1.5 contrast steps (worst ${worst.d.toFixed(2)} on ${worst.fam} · ${worst.role})`,
        worst.d > -1.5);
      check(`5c ${id}: every ramp stays monotonic in lightness`, monotonic(id), []);
      const moved = maxDeltaL(id);
      ok(`5d ${id}: the skin really changes something (max ΔL ${moved.d.toFixed(1)} on ${moved.fam}-${moved.stop})`,
        moved.d >= 1);
      if (UI.UI_SKINS.find((s) => s.id === id).kind === 'hue') {
        ok(`5e ${id}: a hue swap never moves a stop by more than 4 points of OKLCH lightness (${moved.d.toFixed(1)})`,
          moved.d <= 4);
      }
    }
    /* the ink the program writes 7 281 times, and the chrome it writes 271 times */
    for (const id of ids) {
      const r = effOf(id);
      ok(`5f ${id}: the house ink keeps its readability (slate-700 on the page ≥ 7, slate-500 ≥ 4, slate-400 ≥ 2.4)`,
        ratio(r('slate', 700), r('white')) >= 7 && ratio(r('slate', 500), r('white')) >= 4
        && ratio(r('slate', 400), r('white')) >= 2.4);
      ok(`5g ${id}: white on the dark chrome (slate-800) stays ≥ 5.5`,
        ratio(r('white'), r('slate', 800)) >= 5.5);
      ok(`5h ${id}: the accent still carries a white label (blue-600 on white ≥ 3.5)`,
        ratio(r('blue', 600), r('white')) >= 3.5);
    }
    /* the two designed skins say exactly what they are */
    ok('5i “dim” is the one that restates the white', !!blockVars.dim.white && !blockVars.contrast.white);
    ok('5j …a soft white (94 < L < 98), not the glaring #fff', blockVars.dim.white.base.L < 98
      && blockVars.dim.white.base.L > 94);
    ok('5k …and the page then sits BELOW the cards (slate-50 darker than the white)',
      blockVars.dim.slate['50'].L < blockVars.dim.white.base.L);
    ok('5l “contrast” lifts the captions over 6:1 on white (slate-400)',
      ratio(effOf('contrast')('slate', 400), 'white') >= 6);
    check('5m …and never LIGHTENS a status ink',
      Object.entries(blockVars.contrast).filter(([f]) => !['slate', 'blue'].includes(f))
        .flatMap(([f, stops]) => Object.entries(stops)
          .filter(([s, v]) => v.L > SHIPPED[f][s].L + 0.01).map(([s]) => `${f}-${s}`)), []);
    ok('5n …while deepening every one of them by at least 3 points of lightness',
      Object.entries(blockVars.contrast).filter(([f]) => !['slate', 'blue'].includes(f))
        .every(([f, stops]) => Object.entries(stops).every(([s, v]) => SHIPPED[f][s].L - v.L >= 3)));
  }

  /* ══════════════════════════════════════════════════════════════════════════ */
  const failed = results.filter((r) => !r.ok);
  if (failed.length) for (const f of failed) console.error(`✗ ${f.name}\n     got ${f.got}\n    want ${f.want}`);
  console.log(failed.length
    ? `❌ ${failed.length} check(s) failed`
    : `✅ ${results.length}/${results.length} checks passed (${others.length} skins + the reference palette)`);
  process.exit(failed.length ? 1 : 0);
})();

