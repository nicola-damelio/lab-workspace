/* =========================================================================
   _save_in_background_test.mjs — « SAUVEGARDE, OUI — MAIS PAS DEVANT MOI ».

   La demande, mot pour mot : « quando clicco su un test non si apre subito
   perché aspetta il salvataggio globale che potrebbe essere fatto in background.
   anche l'apertura della pagina "lab notebook" è molto lenta ».

   CE QUI A ÉTÉ MESURÉ D'ABORD (fil principal, sonde jetable, 2026-10-14) :

     | ce qui tournait | payload | coût |
     |---|---|---|
     | `JSON.stringify(prev)` + `JSON.stringify(next)` dans `setTests` | 6,0 Mo | 41 ms |
     | …le même geste | 26,5 Mo | 125 ms |
     | `JSON.stringify` + `LZString.compressToUTF16` (sauvegarde) | 6,0 Mo | 884 ms |
     | `LZString.compressToUTF16` seul | 6,0 Mo | 3 815 ms |

   Ces tâches arrivaient SANS PRÉVENIR — souvent à l'instant du clic — et le
   navigateur ne peut pas peindre la page demandée avant qu'elles finissent. Ce
   n'est donc PAS un `await` dans la navigation : c'est le fil principal occupé,
   et le correctif est de lui rendre la main.

   CE QUI EST VÉRIFIÉ ICI, sur les fichiers et les modules RÉELS :
     1. `deepSame` remplace les deux `JSON.stringify` de `setTests` : il dit la
        même chose que `JSON.stringify` (table de cas + 1 000 paires tirées au
        hasard) et il ne LIT RIEN de ce qui n'a pas bougé (compteur de lectures :
        les fiches inchangées sont les mêmes références) ;
     2. `yieldToPaint` rend la main après une peinture (rAF + minuterie à 0 ms)
        et sait se replier sur une minuterie quand aucune image ne vient ;
     3. `runInBackground` attend `requestIdleCallback` (avec son échéance) et
        sait se replier ;
     4. `App.jsx` : la sauvegarde automatique rend la main AVANT de compresser
        (et de construire le plan du miroir Drive), le vidage d'onglet reste
        IMMÉDIAT (il n'y a plus de peinture à protéger), la réparation du lien
        expérience ↔ projet ne tombe plus sur le clic, et l'impression déplie le
        cahier avant que `window.print()` ne parte.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deepSame } from './src/utils/deepSame.js';
import { yieldToPaint, runInBackground, canRunInIdleTime, BACKGROUND_IDLE_TIMEOUT_MS } from './src/utils/backgroundWork.js';

const APP = readFileSync('./src/App.jsx', 'utf8').replace(/\r\n/g, '\n');

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => {
  assert.ok(String(src).includes(needle), `${what}\n  fragment absent : ${needle}`);
  passed += 1;
};
const lacks = (src, needle, what) => {
  assert.ok(!String(src).includes(needle), `${what}\n  fragment présent : ${needle}`);
  passed += 1;
};


/* ══ 1. `deepSame` : LA MÊME RÉPONSE QUE `JSON.stringify`, SANS RIEN ÉCRIRE ══ */

const sameByJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const CASES = [
  [{ a: 1 }, { a: 1 }],
  [{ a: 1 }, { a: 2 }],
  [{ a: 1 }, { a: 1, b: 2 }],
  [{ a: undefined }, {}],
  [{}, { a: undefined }],
  [{ a: undefined, b: 1 }, { b: 1 }],
  [[undefined], [null]],
  [[1, 2], [2, 1]],
  [[1, 2, 3], [1, 2, 3]],
  [[1, 2], [1, 2, 3]],
  [{ n: NaN }, { n: NaN }],
  [NaN, null],
  [[NaN], [null]],
  [{ n: NaN }, { n: 1 }],
  [Infinity, null],
  [null, {}],
  [[], {}],
  [null, null],
  [0, -0],
  ['', null],
  [{ d: new Date(0) }, { d: new Date(0) }],
  [{ d: new Date(0) }, { d: new Date(1) }],
  [{ a: { b: { c: [1, { d: 'x' }] } } }, { a: { b: { c: [1, { d: 'x' }] } } }],
  [{ a: { b: { c: [1, { d: 'x' }] } } }, { a: { b: { c: [1, { d: 'y' }] } } }],
  [{ list: [{ id: 'a' }, { id: 'b' }] }, { list: [{ id: 'a' }, { id: 'b' }] }],
  [true, 1], [null, false], [{ a: 0 }, { a: '' }],
];
CASES.forEach(([a, b], i) => {
  eq(deepSame(a, b), sameByJson(a, b), `cas ${i + 1} : la réponse est celle de JSON.stringify`);
});

/* LA SEULE DIFFÉRENCE VOULUE — l'ORDRE DES CLÉS. `JSON.stringify` distingue
   `{a,b}` de `{b,a}` : un simple réarrangement faisait donc empiler un pas
   d'historique (undo/redo) alors qu'AUCUNE donnée n'avait changé. `deepSame`
   compare les clés deux à deux, comme un lecteur de données — et cette
   différence est sans conséquence : au pire, un passage par l'historique
   n'existe plus, et rien ne peut être perdu. */
ok(deepSame({ a: 1, b: 2 }, { b: 2, a: 1 }), 'un réarrangement de clés n’est PAS un changement');
ok(!sameByJson({ a: 1, b: 2 }, { b: 2, a: 1 }), '…là où JSON.stringify, lui, en voyait un');

/* Les deux clones RÉCURSIFS (aucune référence partagée) : le pire cas. */
{
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const payload = { tests: [{ id: 't1', xs: [1, 2, 3], sub: { k: 'v' } }, { id: 't2' }], meta: { n: 3 } };
  ok(deepSame(payload, clone(payload)), 'deux copies complètes sont égales');
  ok(!deepSame(payload, { ...clone(payload), meta: { n: 4 } }), '…et une valeur changée au fond les sépare');
}

/* Le TIRAGE AU HASARD : mille paires de valeurs JSON, la même réponse que
   `JSON.stringify` — y compris `undefined` dans un objet ou dans un tableau. */
{
  let seed = 20261014;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const scalar = () => pick([0, 1, -1, 2.5, NaN, 'a', '', 'b', true, false, null, undefined]);
  const value = (depth) => {
    if (depth <= 0) return scalar();
    const kind = rnd();
    if (kind < 0.35) return scalar();
    if (kind < 0.6) return Array.from({ length: Math.floor(rnd() * 4) }, () => value(depth - 1));
    const out = {};
    for (let i = 0; i < Math.floor(rnd() * 4); i += 1) out['k' + i] = value(depth - 1);
    return out;
  };
  for (let i = 0; i < 1000; i += 1) {
    const a = value(3);
    const b = rnd() < 0.35 ? JSON.parse(JSON.stringify(a === undefined ? null : a)) : value(3);
    eq(deepSame(a, b), sameByJson(a, b), `tirage ${i + 1} : même réponse que JSON.stringify`);
  }
}

/* ⛔ LA MESURE QUI COMPTE : `deepSame` ne LIT RIEN de ce qui n'a pas bougé. Un
   objet surveillé compte ses lectures (clés ET valeurs) ; les fiches qu'un geste
   n'a pas touchées gardent leur référence, donc rien n'est parcouru — c'est là
   que les 41–125 ms du `JSON.stringify` disparaissent. */
{
  const watch = (obj, log) => new Proxy(obj, {
    get(target, prop, recv) { if (typeof prop === 'string') log.gets += 1; return Reflect.get(target, prop, recv); },
    ownKeys(target) { log.keys += 1; return Reflect.ownKeys(target); },
  });
  {
    const log = { gets: 0, keys: 0 };
    const fiche = watch({ id: 't1', xs: [1, 2, 3], deep: { a: { b: 1 } } }, log);
    ok(deepSame([fiche], [fiche]), 'même référence : égal');
    eq(log.gets + log.keys, 0, '…sans lire une seule propriété (court-circuit sur l’identité)');
  }
  {
    const log = { gets: 0, keys: 0 };
    const untouched = watch({ id: 't1', xs: [1, 2, 3] }, log);
    const before = [untouched, { id: 't2', v: 1 }];
    const after = [untouched, { id: 't2', v: 2 }];   // seule la SECONDE fiche change
    ok(!deepSame(after, before), 'une fiche modifiée est vue');
    eq(log.gets + log.keys, 0, '…et la fiche intacte n’a pas été parcourue');
  }
  {
    /* Le pire cas restant : une liste entièrement recopiée. La lecture est bornée
       par la PREMIÈRE différence — jamais par tout le dataset. */
    const log = { gets: 0, keys: 0 };
    const a = [watch({ id: 'x', v: 1 }, log), watch({ id: 'y', v: 2 }, log)];
    const b = [{ id: 'x', v: 1 }, { id: 'y', v: 9 }];
    ok(!deepSame(a, b), 'liste recopiée : la différence est trouvée');
    ok(log.gets + log.keys <= 12,
      `…en ne lisant que les deux fiches comparées (${log.gets + log.keys} lectures, pas une chaîne de 26 Mo)`);
  }
}

/* ══ 2. `yieldToPaint` : RENDRE LA MAIN APRÈS UNE PEINTURE ══════════════════ */
{
  ok(!canRunInIdleTime(null) || typeof globalThis.requestIdleCallback === 'function',
    'sous node, aucun travail d’arrière-plan natif : c’est donc le repli qu’on éprouve');
  ok(canRunInIdleTime({ requestIdleCallback: () => 1 }), 'un environnement qui sait attendre est reconnu');

  const timers = [];
  let rafCount = 0;
  let lastRaf = null;
  const fakeWin = {
    requestAnimationFrame(cb) { rafCount += 1; lastRaf = cb; return rafCount; },
    setTimeout(fn) { timers.push(fn); return timers.length; },
  };
  let resolved = false;
  const p = yieldToPaint(fakeWin).then(() => { resolved = true; });
  eq(resolved, false, 'la promesse ne se résout pas dans la foulée');
  eq(rafCount, 1, 'une image est demandée');
  lastRaf();                              // l'image arrive…
  eq(resolved, false, '…et le geste attend encore (la peinture de CETTE image n’a pas encore eu lieu)');
  timers.forEach((fn) => fn());           // …la minuterie à 0 ms clique
  await p;
  eq(resolved, true, 'il rend la main APRÈS la peinture, jamais avant');

  /* Sans `requestAnimationFrame` (onglet caché, environnement nu) : la minuterie
     de repli doit rendre la main seule — sinon un onglet caché ne sauverait
     jamais. */
  const t0 = Date.now();
  await yieldToPaint({}, { fallbackMs: 5 });
  ok(Date.now() - t0 >= 4, 'sans image, la minuterie de repli rend la main');
}

/* ══ 3. `runInBackground` : LE TRAVAIL QUE PERSONNE N'ATTEND ════════════════ */
{
  const calls = [];
  const fakeWin = {
    requestIdleCallback(fn, opts) { calls.push({ fn, opts }); return 42; },
    cancelIdleCallback(handle) { calls.push({ cancelled: handle }); },
  };
  let ran = 0;
  const cancel = runInBackground(() => { ran += 1; }, { scope: fakeWin });
  eq(calls.length, 1, 'le travail est confié au navigateur, pas exécuté');
  eq(calls[0].opts.timeout, BACKGROUND_IDLE_TIMEOUT_MS, 'avec une ÉCHÉANCE (un poste occupé ne le remet pas à demain)');
  eq(ran, 0, 'rien n’a encore tourné');
  calls[0].fn();
  eq(ran, 1, 'quand le navigateur est libre, le travail part');
  cancel();
  eq(calls[1].cancelled, 42, 'l’annulation rend le jeton reçu (un effet React ne laisse rien derrière lui)');

  /* Le repli : pas de `requestIdleCallback` → une minuterie à 0 ms, annulable. */
  let ranFast = 0;
  const stop = runInBackground(() => { ranFast += 1; });
  stop();
  await new Promise((r) => setTimeout(r, 5));
  eq(ranFast, 0, 'sans travail d’arrière-plan natif, l’annulation empêche aussi le repli');
  runInBackground(() => { ranFast += 1; });
  await new Promise((r) => setTimeout(r, 5));
  eq(ranFast, 1, 'sans annulation, le repli part bien');
}

/* ══ 4. `App.jsx` : LA SAUVEGARDE REND LA MAIN, LA SORTIE NE L'ATTEND PAS ═══ */
{
  const atSave = APP.indexOf('const runSave = async (urgent = false) => {');
  const atEffectEnd = APP.indexOf('pendingDatasetSaveRef.current = runSave;', atSave);
  ok(atSave > 0, 'l’enregistrement automatique dit s’il est URGENT ou d’arrière-plan');
  const SAVE = APP.slice(atSave, atEffectEnd);
  const atYield = SAVE.indexOf('if (!urgent) await yieldToPaint();');
  const atCompress = SAVE.indexOf('await compressDatasetForSave(rawData');
  const atPublish = SAVE.indexOf('publishDatasetStructure({');
  ok(atYield > 0, 'il rend la main quand il n’est pas urgent');
  ok(atCompress > atYield, '…AVANT la compression (884 ms pour 6 Mo : mesuré)');
  ok(atPublish > atYield, '…et avant la construction du plan du miroir Drive');
  eq((SAVE.match(/if \(!urgent\) await yieldToPaint\(\);/g) || []).length, 2,
    'les deux travaux lourds sont protégés (compression, miroir)');

  has(APP, "import { yieldToPaint, runInBackground } from './utils/backgroundWork';",
    'les deux gestes viennent du module mesuré, d’un même endroit');
  has(APP, 'if (pendingDatasetSaveRef.current !== runSave) return;',
    'une sauvegarde déjà vidée ou remplacée SE TAIT (le travail différé ne double pas l’envoi)');

  const atFlush = APP.indexOf('const flushPendingSave = () => {');
  const FLUSH = APP.slice(atFlush, APP.indexOf('const onVisibilityChange', atFlush));
  has(FLUSH, 'pendingDatasetSaveRef.current(true);',
    'le vidage (onglet qui se ferme, page en arrière-plan) part IMMÉDIATEMENT, en urgent');
  lacks(FLUSH, 'yieldToPaint', '…et n’attend AUCUNE peinture : il n’y a plus d’écran à protéger');

  /* La base d'administration a son propre minuteur : elle doit, elle aussi,
     rendre la main avant de compresser tout son contenu d'un bloc. */
  const atAdminEffect = APP.indexOf('saveTimeoutRef.current = setTimeout(async () => {');
  ok(atAdminEffect > 0, 'la base d’administration a son propre enregistrement');
  ok(APP.slice(atAdminEffect, atAdminEffect + 900).includes('await yieldToPaint();'),
    '…et elle rend la main avant de se compresser');

  /* Le changement de PAGE ne doit plus porter la réparation du lien projet ↔
     expérience : elle relit le magasin (localStorage) et peut le réécrire. */
  has(APP, 'const cancel = runInBackground(() => {', 'la réparation de fond est différée');
  has(APP, 'try { reconcileProjectExperiments(tests); } catch { /* magasin indisponible : rien de bloquant */ }',
    '…et c’est bien elle qui est différée (la règle du lien n’a pas bougé)');
  has(APP, '}, [currentDatasetId, currentModule, tests.length]);',
    '…elle garde ses déclencheurs (page, dataset, nombre d’expériences)');

  /* Le double `JSON.stringify` du dataset entier a disparu du geste. */
  lacks(APP, 'const nextStr = JSON.stringify(next);', 'plus de chaîne du dataset entier à chaque changement');
  lacks(APP, 'const prevStr = JSON.stringify(prev);', '…ni de seconde pour la comparer');
  has(APP, 'if (!deepSame(next, prev)) {', 'la comparaison sans allocation décide du pas d’historique');

  /* L'impression déplie le cahier AVANT de partir (l'autre moitié est dans
     `_notebook_window_test.mjs`, côté LabNotebook). */
  const atPrint = APP.indexOf('const handlePrint = async () => {');
  const atWindowPrint = APP.indexOf('window.print();', atPrint);
  const atAsk = APP.indexOf("window.dispatchEvent(new CustomEvent('lab:before-print'))", atPrint);
  ok(atAsk > atPrint && atAsk < atWindowPrint,
    'le cahier est déplié (lab:before-print) avant que l’impression ne parte');
}

console.log(`_save_in_background_test.mjs — ${passed} assertions OK`);

