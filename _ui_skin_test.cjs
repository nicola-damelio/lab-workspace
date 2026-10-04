/* Validates the “Interface skin” — the palette of the whole program.
 *
 *   src/utils/uiSkin.js   the choice itself: the registry of the skins, the
 *      reference (the shipped palette, which restates NOTHING), PER-OPERATOR
 *      storage (his own key, and the COMPUTER's as the fallback and the starter
 *      value), and the attribute put on <html>.
 *   src/index.css         ONE block per skin: the Tailwind theme variables
 *      restated under `[data-skin="…"]`. Tailwind v4 compiles every colour
 *      utility to those variables, so a block repaints the program without
 *      touching a component — and, because custom properties are INHERITED,
 *      the same attribute paints any element (the Settings miniature).
 *   src/main.jsx          applies the skin of the SESSION's operator BEFORE the
 *      first render.
 *   settingsModule.jsx    offers the skins to EVERY user and writes the key of
 *      the one signed in, with a LIVE miniature drawn from the real classes of
 *      the interface.
 *
 * The palette half of this suite is the real guardrail: it re-reads Tailwind's
 * own ramps (node_modules/tailwindcss/theme.css — the reference), runs the
 * OKLCH → sRGB → WCAG maths on the pairs the program actually writes, and
 * refuses any skin that costs more than 1.5 steps of contrast anywhere, any
 * ramp that stops being monotonic in lightness, and any hue swap that moves a
 * stop by more than 4 points of OKLCH lightness.
 *
 * A NIGHT skin (the page goes dark and the ink goes light, see « NUIT » in
 * src/index.css) cannot be judged that way — it TURNS the palette over, so a
 * pair's contrast is not preserved, it is mirrored. It answers to two other
 * rules, both checked here: every stop must BE the recipe of src/index.css
 * applied to Tailwind's own ramp (nothing invented), and the nine pairs the
 * program writes must clear, family by family, the readability FLOOR of a dark
 * page — the writing that follows the background must stay visible, measured.
 *
 * The OWNERSHIP half (section 7) holds the other rule: a skin belongs to the
 * OPERATOR, not to the browser — his own key, the COMPUTER's key as the fallback
 * and the starter value, and an accent that follows the same rule — so a shared
 * computer hands each one back HIS palette, and reading one operator's choice
 * can never return another's.
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
const toLin = ({ L, C, H }) => {
  const h = (H * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L / 100 + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L / 100 - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L / 100 - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
};
/* `toLin` rend les trois canaux LINÉAIRES, SANS écrêtage : c'est lui qui dit si
   une couleur sort du gamut sRGB (voir la recette des peaux `night`, section 5).
   Le contraste, lui, écrite ce qui dépasse — c'est `clampLin`. */
const clampLin = (col) => toLin(col).map((c) => Math.min(1, Math.max(0, c)));
const lum = (col) => {
  if (col === 'white') return 1;
  const [r, g, b] = clampLin(col);
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
  global.document = {
    documentElement: {
      dataset: {},
      /* LE STYLE EN LIGNE : la peau personnalisée y écrit ses onze crans d'accent
         (ils ne peuvent pas vivre dans la feuille — ils dépendent d'une couleur
         choisie par l'utilisateur), et les retire quand une autre peau est
         choisie. Sans ce petit objet, ce nettoyage ne serait pas testable. */
      style: {
        props: {},
        setProperty(k, v) { this.props[k] = String(v); },
        removeProperty(k) { delete this.props[k]; },
        getPropertyValue(k) { return this.props[k] || ''; }
      }
    }
  };

  const UI = await import(pathToFileURL(path.join(ROOT, 'src/utils/uiSkin.js')).href);
  const KEY = 'labWorkspace_uiSkin';
  const root = global.document.documentElement;

  /* ══════════════════════════════════════════════════════════════════════════
     1) THE REGISTRY AND THE STORED VALUE
     ══════════════════════════════════════════════════════════════════════════ */
  frag('uiSkin.js declares the storage key', UTIL, `export const UI_SKIN_KEY = '${KEY}';`);
  frag('…and the reference skin', UTIL, "export const UI_SKIN_DEFAULT = 'slate';");
  /* Le module a maintenant UN import : le pliage des noms d'opérateurs
     (`opNameKey`), lui-même sans la moindre dépendance — c'est ce qui permet
     d'attacher la peau à un opérateur. Aucune bibliothèque, aucun effet. */
  ok('1a the helper imports only the pure name helper (no library, one import)',
    /^import \{ opNameKey \} from '\.\/auth\.js';$/m.test(UTIL)
    && (UTIL.match(/^import /gm) || []).length === 1);
  frag('…et les clés par opérateur sont déclarées ici', UTIL,
    'export const uiSkinKeyOf = (operator = null, base = UI_SKIN_KEY) => {');
  check('1b the reference is one of the skins', UI.UI_SKINS.some((s) => s.id === UI.UI_SKIN_DEFAULT), true);
  check('1c the ids are unique', new Set(UI.UI_SKINS.map((s) => s.id)).size, UI.UI_SKINS.length);
  check('1d every skin carries a label, a hint, a kind and four swatches',
    UI.UI_SKINS.every((s) => s.label && s.hint && ['tone', 'hue', 'night'].includes(s.kind)
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
  frag('main.jsx imports the helper', MAIN, "import { applyStoredUiSkinForSession } from './utils/uiSkin'");
  ok('2a …and applies it', MAIN.includes('\napplyStoredUiSkinForSession()'));
  check('2b …before React renders', MAIN.indexOf('applyStoredUiSkinForSession()') > 0
    && MAIN.indexOf('applyStoredUiSkinForSession()') < MAIN.indexOf('ReactDOM.createRoot'), true);
  check('2c the display scale is applied too (the two settings are neighbours)',
    MAIN.indexOf('applyStoredUiScale()') > 0, true);

  /* ══════════════════════════════════════════════════════════════════════════
     3) THE CONTROL — Settings, visible to every user, with a live miniature
     ══════════════════════════════════════════════════════════════════════════ */
  frag('settingsModule imports the registry', SET,
    'UI_CUSTOM_ACCENTS, UI_CUSTOM_NEUTRALS, UI_SKIN_CUSTOM, UI_SKIN_DEFAULT, UI_SKINS,');
  frag('…with the custom-skin helpers (accent, neutral, apply, read/write)',
    SET, 'readUiCustomSkin, readUiSkin, saveUiCustomSkin, saveUiSkin, uiSkinCustomVars');
  frag('…and the custom panel appears only for that skin', SET, '{skin === UI_SKIN_CUSTOM && (');
  frag('…offering the eight accents and the pipette', SET, '{UI_CUSTOM_ACCENTS.map((a) => (');
  frag('…and the neutral families', SET, '{UI_CUSTOM_NEUTRALS.map((n) => (');
  frag('settingsModule defines the control', SET, 'const SkinControl = ({ operator = null }) => {');
  frag('…writes through the shared setter, POUR CET OPÉRATEUR',
    SET, 'const pick = (id) => { setSkin(id); saveUiSkin(id, operator); };');
  frag('…offers the registry', SET, '{UI_SKINS.map((s) => (');
  frag('the miniature carries the attribute', SET,
    'data-skin={skin.id === UI_SKIN_DEFAULT ? undefined : skin.id}');
  check('3a the miniature is drawn with the REAL classes (chrome, card, accent)',
    SET.includes('rounded bg-slate-800') && SET.includes('border border-slate-200 bg-white')
    && SET.includes('rounded bg-blue-600') && SET.includes('text-white'), true);
  frag('…and the page shows it', SET, 'title="Interface skin — the colours of the whole program"');
  const SKIN_CTL = '<SkinControl operator={currentUser} />';
  frag('…with the control inside, branchée sur l’opérateur connecté', SET, SKIN_CTL);
  ok('3b the section sits after the display scale', SET.indexOf('<DisplayScaleControl />') < SET.indexOf(SKIN_CTL));
  ok('3c …and BEFORE the superuser-only block', SET.indexOf(SKIN_CTL) < SET.indexOf('{isSuper && ('));
  ok('3d …so it is not reserved to the superuser', SET.indexOf('<ScientistsOperatorsManager') > 0);
  frag('…the choice never touches the dataset (browser storage only, under the operator’s key)', UTIL,
    'localStorage.setItem(uiSkinKeyOf(operator), skin.id)');

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
  const kindOf = (id) => (UI.UI_SKINS.find((s) => s.id === id) || {}).kind;
  /* Un skin `night` RETOURNE la rampe : ses crans MONTENT (le 50 est la
     surface, le 950 l'encre) là où tous les autres descendent. */
  const monotonic = (id) => {
    const r = effOf(id);
    const night = kindOf(id) === 'night';
    const bad = [];
    for (const fam of FAMILIES) {
      for (let i = 1; i < STOPS.length; i++) {
        const [a, b] = [r(fam, STOPS[i]).L, r(fam, STOPS[i - 1]).L];
        if (night ? !(a > b) : !(a < b)) bad.push(`${fam}-${STOPS[i]}`);
      }
    }
    return bad;
  };

  if (!shippedRead) {
    console.log('⚠ node_modules/tailwindcss/theme.css not readable — the “vs the shipped palette” checks are SKIPPED');
  } else {
    check('5a the shipped palette IS the reference (blue-600 and slate-50 spot-check)',
      SHIPPED.blue['600'].L > 54 && SHIPPED.blue['600'].L < 55 && SHIPPED.slate['50'].L > 98, true);
    /* LA PEAU PERSONNALISÉE EST JUGÉE À PART (section 6, plus bas) : ses onze
       crans d'accent ne sont pas dans la feuille — ils dépendent d'une couleur
       choisie par l'utilisateur — donc les maths ci-dessus ne verraient que la
       palette livrée et ne prouveraient rien. */
    for (const id of others.filter((s) => s !== UI.UI_SKIN_CUSTOM)) {
      const kind = kindOf(id);
      /* Un skin `night` retourne la palette : il ne peut pas « perdre » moins de
         1.5 crans de contraste, il échange le fond et l'encre. Il a donc ses
         propres règles (5o et suivantes, plus bas) — et c'est 5c (la rampe est
         monotone, dans le sens que la peau annonce) qui continue de le tenir. */
      if (kind !== 'night') {
        const worst = worstVsShipped(id);
        ok(`5b ${id}: no pair of the program loses more than 1.5 contrast steps (worst ${worst.d.toFixed(2)} on ${worst.fam} · ${worst.role})`,
          worst.d > -1.5);
      }
      check(`5c ${id}: every ramp stays monotonic in lightness`, monotonic(id), []);
      const moved = maxDeltaL(id);
      ok(`5d ${id}: the skin really changes something (max ΔL ${moved.d.toFixed(1)} on ${moved.fam}-${moved.stop})`,
        moved.d >= 1);
      if (kind === 'hue') {
        ok(`5e ${id}: a hue swap never moves a stop by more than 4 points of OKLCH lightness (${moved.d.toFixed(1)})`,
          moved.d <= 4);
      }
    }
    /* ── LES PEAUX SOMBRES : LA RECETTE ET LES PLANCHERS ─────────────────────
       Un skin `night` n'est pas jugé « contre la palette livrée » (5b) : il la
       RETOURNE, donc une paire n'y garde pas son contraste, elle l'échange. Il
       est jugé sur deux choses, toutes deux mesurées ici :
         · chaque cran EST la recette de src/index.css appliquée à la rampe de
           Tailwind — même partage surfaces/encres, mêmes bandes, même famille
           neutre, même chroma (ramené dans le gamut sRGB comme le fait le
           moteur, CSS Color 4). Aucune valeur n'est inventée : changer la
           feuille sans changer la recette fait échouer cette vérification ;
         · les neuf paires que le programme écrit vraiment gardent, POUR CHAQUE
           FAMILLE, le plancher de lisibilité d'une page sombre. C'est la
           réponse mesurée à « for dark color the writing must change color to
           allow visibility » : l'encre a suivi le fond, et elle reste lisible. */
    const NIGHT_SURFACES = [50, 100, 200, 300];
    const NIGHT_RECIPE = {
      night: { neutral: 'slate', surfaces: [13, 30], inks: [50, 99], white: 17, colourSurfaces: [26, 38], colourInks: [49, 100] },
      carbon: { neutral: 'zinc', surfaces: [11, 28], inks: [52, 97], white: 15, colourSurfaces: [24, 36], colourInks: [49, 97] }
    };
    const inGamut = (col) => toLin(col).every((c) => c >= -1e-4 && c <= 1 + 1e-4);
    const chromaInto = (col) => {
      if (inGamut(col)) return col.C;
      let lo = 0, hi = col.C;
      for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (inGamut({ ...col, C: mid })) lo = mid; else hi = mid; }
      return lo;
    };
    const bandOf = (v, from, to, lo, hi) => lo + (hi - lo) * (v - from) / (to - from);
    const recipeStop = (recipe, fam, stop) => {
      const isNeutral = fam === 'slate';
      const src = SHIPPED[isNeutral ? recipe.neutral : fam];
      const s = src[String(stop)];
      const isSurface = NIGHT_SURFACES.includes(stop);
      const [lo, hi] = isNeutral
        ? (isSurface ? recipe.surfaces : recipe.inks)
        : (isSurface ? recipe.colourSurfaces : recipe.colourInks);
      const L = bandOf(s.L, isSurface ? src['50'].L : src['400'].L, isSurface ? src['300'].L : src['950'].L, lo, hi);
      return { L, C: chromaInto({ L, C: s.C, H: s.H }), H: s.H };
    };
    /* les neuf paires écrites par le programme, et le plancher d'une page sombre */
    const FLOORS = [
      ['a chip (text-700 on bg-50) stays ≥ 4.5', (r, f) => ratio(r(f, 700), r(f, 50)), 4.5],
      ['a stronger chip (text-800 on bg-100) stays ≥ 4.5', (r, f) => ratio(r(f, 800), r(f, 100)), 4.5],
      ['the label of an accent (white on bg-600) stays ≥ 3.5', (r, f) => ratio(r('white'), r(f, 600)), 3.5],
      ['a link on a card (text-600 on white) stays ≥ 4', (r, f) => ratio(r(f, 600), r('white')), 4],
      ['an emphasis (text-700 on white) stays ≥ 4.5', (r, f) => ratio(r(f, 700), r('white')), 4.5],
      ['a caption (text-500 on white) stays ≥ 3.5', (r, f) => ratio(r(f, 500), r('white')), 3.5],
      ['a date, a hint (text-400 on white) stays ≥ 2.4', (r, f) => ratio(r(f, 400), r('white')), 2.4],
      ['an edge (border-300 on white) stays ≥ 1.25', (r, f) => ratio(r(f, 300), r('white')), 1.25],
      ['a label on the chrome (white on bg-800) stays ≥ 4.5', (r, f) => ratio(r('white'), r(f, 800)), 4.5]
    ];
    for (const id of ids.filter((k) => kindOf(k) === 'night')) {
      const recipe = NIGHT_RECIPE[id];
      ok(`5o ${id}: the recipe of src/index.css is the one declared here (bands, neutral family, white)`, !!recipe);
      if (!recipe) continue;
      /* 1) la recette — 176 crans, L, C et H compris */
      const wrong = [];
      for (const fam of FAMILIES) for (const stop of STOPS) {
        const want = recipeStop(recipe, fam, stop);
        const got = blockVars[id][fam] && blockVars[id][fam][String(stop)];
        const hd = got ? Math.min(Math.abs(got.H - want.H), 360 - Math.abs(got.H - want.H)) : 99;
        if (!got || Math.abs(got.L - want.L) > 0.051 || Math.abs(got.C - want.C) > 0.0006 || hd > 0.051) {
          wrong.push(`${fam}-${stop}`);
        }
      }
      check(`5p ${id}: every one of the ${FAMILIES.length * STOPS.length} stops IS the recipe on Tailwind's ramp (L, C and H)`, wrong, []);
      const w = blockVars[id].white.base;
      ok(`5q ${id}: the card (--color-white) is the value the recipe gives it (L ${w.L})`,
        Math.abs(w.L - recipe.white) <= 0.051 && w.C <= 0.001);
      /* 2) la lisibilité — le plancher de chaque paire, famille par famille */
      const r = effOf(id);
      for (const [label, fn, floor] of FLOORS) {
        let worst = { v: Infinity, fam: '' };
        for (const fam of FAMILIES) { const v = fn(r, fam); if (v < worst.v) worst = { v, fam }; }
        ok(`5r ${id}: ${label} — worst ${worst.fam} ${worst.v.toFixed(2)}`, worst.v >= floor);
      }
      /* 3) la bascule est réelle : la page est sombre, l'encre claire */
      ok(`5s ${id}: the page IS dark and the ink IS light (page ${r('slate', 50).L}, card ${r('white').L}, ink ${r('slate', 700).L})`,
        r('slate', 50).L < 25 && r('white').L < 25 && r('slate', 700).L > 70);
      /* 4) et elle ne coûte jamais la moitié d'une paire */
      const lightRef = (f, stop) => (f === 'white' ? 'white' : SHIPPED[f][String(stop)]);
      let worstShare = { s: Infinity, role: '', fam: '' };
      for (const [role, fn] of ROLES) for (const fam of FAMILIES) {
        const s = fn(r, fam) / fn(lightRef, fam);
        if (s < worstShare.s) worstShare = { s, role, fam };
      }
      ok(`5t ${id}: no pair falls below 75 % of what the light palette gave it (worst ${worstShare.s.toFixed(2)} on ${worstShare.fam} · ${worstShare.role})`,
        worstShare.s >= 0.75);
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

  /* ══════════════════════════════════════════════════════════════════════════
     6) LA PEAU PERSONNALISÉE — « all too similar AND NOT customizable »
     ══════════════════════════════════════════════════════════════════════════ */
  check('6a the custom skin is in the registry (and is not the reference)',
    UI.UI_SKINS.some((s) => s.id === UI.UI_SKIN_CUSTOM) && UI.UI_SKIN_CUSTOM !== UI.UI_SKIN_DEFAULT, true);
  check('6b the eight offered accents are real hexes',
    UI.UI_CUSTOM_ACCENTS.every((a) => /^#[0-9a-f]{6}$/.test(a.color)), true);
  check('6c …all different', new Set(UI.UI_CUSTOM_ACCENTS.map((a) => a.color)).size, UI.UI_CUSTOM_ACCENTS.length);
  check('6d the three neutral families are declared', UI.UI_CUSTOM_NEUTRALS.map((n) => n.id), ['slate', 'zinc', 'stone']);
  frag('6e the fallback accent (and the block) are in the stylesheet', CSS, '[data-skin="custom"] {');
  frag('…carrying the delivered accent', CSS, '--lab-accent: #155dfc;');

  /* Les deux familles neutres empruntées sont les MÊMES dégradés que les peaux
     Graphite / Warm paper : la couture est vérifiée valeur par valeur (les blocs
     portent DEUX attributs — `[data-skin="custom"][data-tone="…"]` — donc ils
     échappent volontairement au relevé des blocs d'une seule peau). */
  const toneBlock = (tone) => {
    const m = new RegExp(`\\[data-skin="custom"\\]\\[data-tone="${tone}"\\]\\s*\\{([\\s\\S]*?)\\}`).exec(CSS);
    return m ? rampsOf(m[1]) : null;
  };
  const zinc = toneBlock('zinc');
  const stone = toneBlock('stone');
  check('6f the zinc ramp is complete (11 stops — pure greys)', zinc ? Object.keys(zinc.slate).length : 0, 11);
  check('6g …and it IS the Graphite ramp, stop for stop',
    zinc && blockVars.graphite && JSON.stringify(zinc.slate) === JSON.stringify(blockVars.graphite.slate), true);
  check('6h the stone ramp is complete (11 stops — warm greys)', stone ? Object.keys(stone.slate).length : 0, 11);
  check('6i …and it IS the Warm paper ramp, stop for stop',
    stone && blockVars.warm && JSON.stringify(stone.slate) === JSON.stringify(blockVars.warm.slate), true);

  /* LA DÉRIVATION — le cran 600 EST la couleur choisie, la forme est celle du
     dégradé livré, et le contraste d'un libellé blanc tient pour CHAQUE
     proposition : c'est ce qui garantit qu'une peau personnalisée ne peut pas
     casser la palette du programme. */
  const rampOf = (hexc) => Object.fromEntries(Object.entries(UI.uiSkinCustomRamp(hexc))
    .map(([k, v]) => {
      const m = /oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/.exec(v);
      return [k.replace('--color-blue-', ''), { L: +m[1], C: +m[2], H: +m[3] }];
    }));
  const delivered = rampOf(UI.UI_CUSTOM_ACCENT_DEFAULT);
  ok(`6j the delivered accent reproduces the shipped ramp (the 600 stop is L=${delivered['600'].L} vs blue-600 ${SHIPPED.blue['600'].L})`,
    Math.abs(delivered['600'].L - SHIPPED.blue['600'].L) <= 0.2
    && Math.abs(delivered['600'].H - SHIPPED.blue['600'].H) < 1);
  ok('6k …and the eleven stops descend in lightness',
    STOPS.every((s, i) => i === 0 || delivered[String(s)].L < delivered[String(STOPS[i - 1])].L));
  ok(`6l every offered accent keeps a white label readable (worst white-on-600 = ${Math.min(...UI.UI_CUSTOM_ACCENTS.map((a) => ratio('white', rampOf(a.color)['600']))).toFixed(2)} ≥ 3.5)`,
    UI.UI_CUSTOM_ACCENTS.every((a) => ratio('white', rampOf(a.color)['600']) >= 3.5));
  ok(`6m …and never moves the ramp more than 12 points of lightness (worst = ${Math.max(...UI.UI_CUSTOM_ACCENTS.map((a) => Math.max(...STOPS.map((s) => Math.abs(rampOf(a.color)[String(s)].L - SHIPPED.blue[String(s)].L))))).toFixed(1)})`,
    UI.UI_CUSTOM_ACCENTS.every((a) => Math.max(...STOPS.map((s) => Math.abs(rampOf(a.color)[String(s)].L - SHIPPED.blue[String(s)].L))) <= 12));
  check('6n sRGB and OKLCH agree (white is L=100 C=0, black is L=0)',
    [Math.round(UI.hexToOklch('#ffffff').L), Math.round(UI.hexToOklch('#ffffff').C), Math.round(UI.hexToOklch('#000000').L)],
    [100, 0, 0]);
  check('6o a colour that is not a hex is refused', UI.hexToOklch('red'), null);
  check('6p a garbage setting is sanitised (accent, neutral, page and motif)',
    UI.uiCustomSkinOf({ accent: 'red', neutral: 'neon', bg: 'red', pattern: 'stripes' }),
    { accent: UI.UI_CUSTOM_ACCENT_DEFAULT, neutral: UI.UI_CUSTOM_NEUTRAL_DEFAULT,
      bg: UI.UI_BG_DEFAULT, pattern: UI.UI_BG_PATTERN_DEFAULT });
  const TEAL_PAGE = { accent: '#009689', neutral: 'zinc', bg: '#eef2ff', pattern: 'dots' };
  check('6q the setting round-trips through localStorage (accent, neutral, page and motif)', (() => {
    UI.saveUiCustomSkin(TEAL_PAGE);
    return [JSON.parse(store.get(UI.UI_CUSTOM_KEY)), UI.readUiCustomSkin()];
  })(), [UI.uiCustomSkinOf(TEAL_PAGE), UI.uiCustomSkinOf(TEAL_PAGE)]);

  /* L'APPLICATION — les onze crans en ligne, et AUCUNE fuite vers une autre peau. */
  UI.saveUiSkin(UI.UI_SKIN_CUSTOM);
  check('6r the attribute names the custom skin', root.dataset.skin, UI.UI_SKIN_CUSTOM);
  check('6s …the neutral family rides with it', root.dataset.tone, 'zinc');
  check('6t …and the ELEVEN accent stops are written inline',
    Object.keys(root.style.props).filter((k) => k.startsWith('--color-blue-')).length, 11);
  check('6u …the 600 stop really is the chosen colour (teal)',
    root.style.props['--color-blue-600'], UI.uiSkinCustomRamp('#009689')['--color-blue-600']);
  UI.saveUiSkin('violet');
  check('6v another skin REMOVES them (they cannot outlive the choice)',
    [Object.keys(root.style.props), root.dataset.tone || ''], [[], '']);
  check('6w …and the attribute is the new skin', root.dataset.skin, 'violet');
  UI.saveUiSkin(UI.UI_SKIN_DEFAULT);

  /* ══════════════════════════════════════════════════════════════════════════
     7 — LA PEAU APPARTIENT À L'OPÉRATEUR
     « the skin must be associated to the operator as each operator must be able
     to choose his own preferred skin » : la clé porte le propriétaire (son id,
     ou son nom replié tant qu'il n'en a pas), le POSTE garde la sienne — celle
     de l'écran d'entrée, et celle dont part un opérateur qui n'a jamais rien
     choisi — et l'accent personnalisé suit exactement la même règle.
     ═══════════════════════════════════════════════════════════════════════ */
  const ALICE = { id: 'op_alice', name: 'Alice Martin', role: 'user' };
  const BOB = { id: 'op_bob', name: 'Bob Durand', role: 'user' };
  const ELISE = { id: '', name: 'Élise  Müller' };           // pas encore d'id

  check('7a the owner of a skin is the operator id', UI.uiSkinOwnerOf(ALICE), 'op_alice');
  check('7b …and the folded name while he has none (accents, case and word order fall)',
    UI.uiSkinOwnerOf(ELISE), UI.uiSkinOwnerOf({ id: '', name: 'muller elise' }));
  check('7c nobody ⇒ the key of the COMPUTER', UI.uiSkinKeyOf(null), KEY);
  check('7d …while each operator has his own, for each setting',
    [UI.uiSkinKeyOf(BOB), UI.uiCustomSkinKeyOf(BOB)],
    [`${KEY}_op_bob`, `${UI.UI_CUSTOM_KEY}_op_bob`]);

  store.clear();
  UI.saveUiSkin('red', ALICE);
  UI.saveUiSkin('warm', BOB);
  check('7e each operator keeps HIS skin, under his own key',
    [store.get(`${KEY}_op_alice`), store.get(`${KEY}_op_bob`)], ['red', 'warm']);
  check('7f …and reading one never returns the other',
    [UI.readUiSkin(ALICE), UI.readUiSkin(BOB)], ['red', 'warm']);
  check('7g the computer itself was not touched (the shipped palette)',
    [store.get(KEY), UI.readUiSkin()], [null, UI.UI_SKIN_DEFAULT]);

  UI.saveUiSkin('violet');                                   // réglée sans être connecté
  check('7h …its own choice goes under the plain key', [store.get(KEY), UI.readUiSkin()], ['violet', 'violet']);
  check('7i a NEWCOMER on this machine starts from the computer’s skin',
    UI.readUiSkin(ELISE), 'violet');

  UI.saveUiSkin('graphite', ELISE);                          // …puis choisit la sienne
  check('7j …which is then HIS (the machine keeps its own, under the folded name)',
    [UI.readUiSkin(ELISE), UI.readUiSkin(), store.get(`${KEY}_elise muller`)],
    ['graphite', 'violet', 'graphite']);

  UI.saveUiCustomSkin({ accent: '#009689', neutral: 'zinc', bg: '#eef2ff', pattern: 'grid' }, ALICE);
  UI.saveUiCustomSkin({ accent: '#e60076', neutral: 'stone' }, BOB);
  check('7k two operators can each have their own accent, neutral family and page',
    [UI.readUiCustomSkin(ALICE), UI.readUiCustomSkin(BOB)],
    [UI.uiCustomSkinOf({ accent: '#009689', neutral: 'zinc', bg: '#eef2ff', pattern: 'grid' }),
      UI.uiCustomSkinOf({ accent: '#e60076', neutral: 'stone' })]);
  check('7l …and the computer’s own accent was never borrowed from one of them',
    UI.readUiCustomSkin(), UI.uiCustomSkinOf(null));

  /* main.jsx pose la peau AVANT le premier rendu, en la lisant dans la session
     de l'onglet : un rechargement ne doit donc pas peindre la palette du poste
     avant celle de l'opérateur connecté. */
  global.sessionStorage = {
    getItem: (k) => (k === UI.SESSION_OPERATOR_KEY ? JSON.stringify(ALICE) : null),
    setItem: () => {}, removeItem: () => {}
  };
  UI.saveUiSkin('contrast', ALICE);
  UI.applyStoredUiSkinForSession();
  check('7m the skin of the session’s operator is the one applied before the first paint',
    root.dataset.skin, 'contrast');
  global.sessionStorage = null;                              // personne n'est connecté
  UI.applyStoredUiSkinForSession();
  check('7n …and with nobody in the session it is the computer’s skin', root.dataset.skin, 'violet');

  /* ══════════════════════════════════════════════════════════════════════════ */
  /* ══════════════════════════════════════════════════════════════════════════
     8 — LE FOND DES PAGES — « let the user choose the background color, with
     sober patterns ». Une page peut prendre n'importe quelle TEINTE, jamais
     n'importe quelle LUMIÈRE : la couleur choisie est ramenée dans une bande
     (luminosité `UI_BG_FLOOR`–`UI_BG_CEIL`, chroma ≤ `UI_BG_CAP`, chroma
     ramené dans le gamut sRGB), et le cran 100 qui porte les panneaux en est
     DÉRIVÉ (même teinte, même chroma, `UI_BG_GAP` de luminosité en moins).
     C'est ce qui garantit que l'encre que le programme écrit SUR une page — le
     titre d'une carte (text-700 sur bg-50) et l'encre des panneaux (text-800 sur
     bg-100) — ne perd jamais plus de 1.5 cran de contraste. La bande, le gamut,
     la dérivation et les deux paires sont donc MESURÉS ici, contre la palette
     livrée : sur les huit pages proposées et sur les 72 teintes saturées qu'un
     utilisateur peut saisir (le pire cas possible).
     ═══════════════════════════════════════════════════════════════════════ */
  ok('8a the offered pages are real hexes, all different',
    UI.UI_BG_PRESETS.every((p) => /^#[0-9a-f]{6}$/.test(p.hex))
    && new Set(UI.UI_BG_PRESETS.map((p) => p.hex)).size === UI.UI_BG_PRESETS.length);
  check('8b …and every one of them IS a stop of the shipped palette (nothing invented)',
    UI.UI_BG_PRESETS.filter((p) => !SHIPPED[p.id]
      || JSON.stringify(SHIPPED[p.id]['50']) !== JSON.stringify(p.oklch)).map((p) => p.id), []);
  check('8c the offered motifs are declared once each',
    new Set(UI.UI_BG_PATTERNS.map((p) => p.id)).size, UI.UI_BG_PATTERNS.length);
  check('8d …“none” is the default, and it is the first (the plain page)',
    UI.UI_BG_PATTERN_DEFAULT, UI.UI_BG_PATTERNS[0].id);
  check('8e …while the stylesheet paints exactly the others',
    UI.UI_BG_PATTERNS.filter((p) => p.id !== UI.UI_BG_PATTERN_DEFAULT)
      .filter((p) => !CSS.includes(`[data-pattern="${p.id}"]`)).map((p) => p.id), []);
  ok('8f …and has NO rule for the default (an attribute nobody needs to set)',
    !CSS.includes(`[data-pattern="${UI.UI_BG_PATTERN_DEFAULT}"]`));

  /* Le motif est peint — et il ne peut PAS s'imprimer : la règle qui touche au
     fond doit vivre DANS un `@media screen` (on n'imprime pas un quadrillage
     derrière du texte), et ne viser que la classe des pages, `bg-slate-50`. */
  const pageAt = CSS.indexOf('[class~="bg-slate-50"]');
  const pageFrom = pageAt < 0 ? -1 : CSS.lastIndexOf('@media screen {', pageAt);
  const pageRule = pageAt < 0 ? '' : CSS.slice(pageAt, pageAt + 300);
  ok('8g the pattern is painted on the page class, from inside @media screen (nothing printed)',
    pageAt > 0 && pageFrom > 0 && !/\n\}/.test(CSS.slice(pageFrom, pageAt))
    && pageRule.includes('background-image: var(--lab-page-image, none)')
    && pageRule.includes('background-size: var(--lab-page-size, auto)'));
  ok('8h …and the motifs themselves are declared in that same screen-only block',
    ['grid', 'dots', 'rules', 'diagonal'].every((id) => {
      const at = CSS.indexOf(`[data-pattern="${id}"]`);
      return at > pageFrom && at < pageAt && !CSS.slice(pageFrom, at).includes('\n}');
    }));

  /* L'APPLICATION — la page choisie est écrite EN LIGNE (comme l'accent), donc
     elle est lue par les variables que les classes `bg-slate-50` / `bg-slate-100`
     du programme lisent vraiment : c'est CE lien qui repeint les pages. */
  check('8i the two stops a page is made of are the very ones Tailwind reads',
    Object.keys(UI.uiSkinCustomVars({ bg: '#ff0000' })).filter((k) => k.startsWith('--color-slate-')),
    ['--color-slate-50', '--color-slate-100']);
  check('8j …and with no chosen page they are NOT written (the neutral family keeps serving the page)',
    Object.keys(UI.uiSkinCustomVars({ bg: UI.UI_BG_DEFAULT })).filter((k) => k.startsWith('--color-slate-')),
    []);
  const plain = UI.uiCustomSkinOf(null);
  check('8k a colour that is not a hex, and a motif that does not exist, are refused',
    UI.uiCustomSkinOf({ bg: 'red', pattern: 'stripes' }),
    { ...plain, bg: UI.UI_BG_DEFAULT, pattern: UI.UI_BG_PATTERN_DEFAULT });
  ok('8l …and a page nobody chose falls back to the SHIPPED one (slate-50)',
    JSON.stringify(UI.uiBgStops(UI.UI_BG_DEFAULT)) === JSON.stringify({
      page: { ...UI.UI_BG_SHIPPED_OKLCH },
      card: { ...UI.UI_BG_SHIPPED_OKLCH, L: UI.UI_BG_SHIPPED_OKLCH.L - UI.UI_BG_GAP }
    })
    && UI.uiBgStops('not-a-colour').page.L === UI.uiBgStops(UI.UI_BG_DEFAULT).page.L);

  store.clear();
  UI.saveUiSkin(UI.UI_SKIN_CUSTOM);
  UI.saveUiCustomSkin({ accent: '#009689', neutral: 'zinc', bg: '#ff0000', pattern: 'grid' });
  const stopped = UI.uiBgStops('#ff0000');
  check('8m the chosen page is written inline, clamped — not the colour that was typed',
    [root.style.props['--color-slate-50'], root.style.props['--color-slate-100']],
    [UI.oklchCss(stopped.page), UI.oklchCss(stopped.card)]);
  ok('8n …the two stops really are a PASTEL (the pipe dream of a red page, made legible)',
    stopped.page.L === UI.UI_BG_FLOOR && stopped.page.C > 0 && stopped.page.H > 0
    && root.style.props['--color-slate-50'].startsWith('oklch('));
  check('8o the motif rides with it, as one attribute on <html> (every page at once)',
    root.dataset.pattern, 'grid');
  check('8p the setting round-trips (accent, neutral, page and motif)',
    UI.readUiCustomSkin(),
    UI.uiCustomSkinOf({ accent: '#009689', neutral: 'zinc', bg: '#ff0000', pattern: 'grid' }));
  UI.saveUiCustomSkin({ accent: '#009689', neutral: 'zinc', bg: UI.UI_BG_DEFAULT, pattern: UI.UI_BG_PATTERN_DEFAULT });
  check('8q back to the plain page: the two stops AND the attribute are gone',
    [Object.keys(root.style.props).filter((k) => k.startsWith('--color-slate-')), 'pattern' in root.dataset],
    [[], false]);
  UI.saveUiCustomSkin({ accent: '#009689', neutral: 'zinc', bg: '#ff0000', pattern: 'dots' });
  UI.saveUiSkin('violet');
  check('8r another skin REMOVES the page too (it cannot outlive the choice)',
    [Object.keys(root.style.props), root.dataset.pattern || '', root.dataset.tone || ''], [[], '', '']);
  UI.saveUiSkin(UI.UI_SKIN_DEFAULT);

  /* …et ⚙ Settings les offre, avec une miniature qui montre le motif ET la
     couleur : les deux pastilles sont dessinées par les MÊMES variables que la
     page (la miniature porte `data-skin` / `data-pattern`, donc elle ment pas). */
  frag('the control offers the pages', SET, '{UI_BG_PRESETS.map((p) => (');
  frag('…and the motifs', SET, '{UI_BG_PATTERNS.map((p) => (');
  frag('…the free colour picker is there too', SET, 'onChange={(e) => setBg(e.target.value)}');
  frag('…and falls back on the shipped page when nothing is chosen', SET,
    'value={custom.bg || oklchToHex(uiBgStops(UI_BG_DEFAULT).page)}');
  frag('…clearing the page is offered', SET, 'onClick={() => setBg(UI_BG_DEFAULT)}');
  frag('the colour is applied through the same setter as the accent', SET,
    'const setBg = (bg) => setCustom(saveUiCustomSkin({ ...custom, bg }, operator));');
  frag('…and the motif through its own', SET,
    'const setPattern = (pattern) => setCustom(saveUiCustomSkin({ ...custom, pattern }, operator));');
  frag('the miniature carries the motif', SET,
    'data-pattern={pattern && pattern !== UI_BG_PATTERN_DEFAULT ? pattern : undefined}');
  frag('…and only for the custom skin', SET, 'pattern={s.id === UI_SKIN_CUSTOM ? custom.pattern : \'\'}');
  frag('…it is drawn from the very variables the page uses', SET,
    'style={s.id === UI_SKIN_CUSTOM ? uiSkinCustomVars(custom) : null}');

  /* ── LA MESURE ────────────────────────────────────────────────────────────
     D'abord la question de confiance : la réduction de chroma de l'util
     (`oklchToLin`) est-elle bien le même calcul que celui avec lequel cette
     sonde mesure TOUTE la palette (section 5) ? Même matrice, mêmes constantes :
     sinon la bande serait mesurée dans un espace et écrite dans un autre. */
  check('8s the colour maths of the util IS the one this suite measures with (same matrix)',
    [UI.oklchToLin(SHIPPED.blue['600']), UI.oklchToLin({ L: 0, C: 0, H: 0 })]
      .map((v) => v.map((n) => +n.toFixed(6))),
    [toLin(SHIPPED.blue['600']), toLin({ L: 0, C: 0, H: 0 })].map((v) => v.map((n) => +n.toFixed(6))));

  /* …puis la bande : 90 couleurs que la pipette peut donner (chaque teinte du
     cercle à sa lumière la plus violente), les extrêmes (noir, blanc, primaires
     vives, néon), et les huit pages proposées. Aucune ne doit sortir de la
     bande, du gamut sRGB, ni de la dérivation du cran 100. */
  const HUE_PROBES = [];
  for (let h = 0; h < 360; h += 5) HUE_PROBES.push(UI.oklchToHex({ L: 50, C: 1, H: h }));
  const PROBES = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#00ffff', '#ff00ff',
    '#ffff00', '#ff8a00', '#7f00ff', '#123456', '#aabbcc', '#eeeeee', '#010203',
    ...HUE_PROBES, ...UI.UI_BG_PRESETS.map((p) => p.hex)];
  const inGamut = (col) => UI.oklchToLin(col).every((c) => c >= -1e-4 && c <= 1 + 1e-4);
  check('8t every page a user can pick is pulled into the band, in sRGB, at the shipped gap',
    PROBES.flatMap((hex) => {
      const { page, card } = UI.uiBgStops(hex);
      const bad = [];
      if (!(page.L >= UI.UI_BG_FLOOR && page.L <= UI.UI_BG_CEIL)) bad.push(`${hex}:L`);
      if (page.C > UI.UI_BG_CAP + 1e-9) bad.push(`${hex}:C`);
      if (!inGamut(page) || !inGamut(card)) bad.push(`${hex}:gamut`);
      if (Math.abs((page.L - card.L) - UI.UI_BG_GAP) > 1e-9 || card.H !== page.H || card.C !== page.C)
        bad.push(`${hex}:derive`);
      return bad;
    }), []);

  /* …et enfin CE QUI COMPTE : l'encre que le programme écrit SUR la page. Les
     deux paires, mesurées famille neutre par famille neutre (l'ardoise, le
     zinc, le gris chaud — le programme sait servir les trois) contre ce que la
     palette livrée donne : aucune ne perd plus de 1.5 cran, et les deux restent
     très au-dessus du plancher d'un texte courant (4.5). */
  const pairsOf = (family, hex) => {
    const { page, card } = UI.uiBgStops(hex);
    const title = ratio(SHIPPED[family]['700'], page);
    const panel = ratio(SHIPPED[family]['800'], card);
    return {
      title,
      panel,
      loss: Math.min(title - ratio(SHIPPED[family]['700'], SHIPPED[family]['50']),
        panel - ratio(SHIPPED[family]['800'], SHIPPED[family]['100']))
    };
  };
  const PAIRS = ['slate', 'zinc', 'stone']
    .flatMap((family) => PROBES.map((hex) => ({ family, hex, ...pairsOf(family, hex) })));
  const worstPair = PAIRS.reduce((a, b) => (b.loss < a.loss ? b : a));
  ok(`8u a chosen page never costs the ink on it more than 1.5 step of contrast — worst ${worstPair.loss.toFixed(2)} (${worstPair.family}, page ${worstPair.hex})`,
    PAIRS.every((p) => p.loss > -1.5));
  ok(`8v …and both pairs stay far above the 4.5 of a body text (worst title ${Math.min(...PAIRS.map((p) => p.title)).toFixed(1)}, panel ${Math.min(...PAIRS.map((p) => p.panel)).toFixed(1)})`,
    PAIRS.every((p) => p.title >= 4.5 && p.panel >= 4.5));
  const presetPairs = PAIRS.filter((p) => UI.UI_BG_PRESETS.some((q) => q.hex === p.hex));
  const worstPreset = presetPairs.reduce((a, b) => (b.loss < a.loss ? b : a));
  ok(`8w …while the eight offered pages cost the ink at most ONE step of it — worst ${worstPreset.loss.toFixed(2)} (${worstPreset.family}, page ${worstPreset.hex})`,
    presetPairs.every((p) => Math.abs(p.loss) < 1));

  const failed = results.filter((r) => !r.ok);
  if (failed.length) for (const f of failed) console.error(`✗ ${f.name}\n     got ${f.got}\n    want ${f.want}`);
  console.log(failed.length
    ? `❌ ${failed.length} check(s) failed`
    : `✅ ${results.length}/${results.length} checks passed (${others.length} skins + the reference palette)`);
  process.exit(failed.length ? 1 : 0);
})();

