/* =========================================================================
   _viewer_main_reps_ownership_test.mjs — AUCUNE REPRÉSENTATION ORPHELINE.

   Le bug que cette suite empêche de revenir (rapport : « there is no way to
   remove a surface », « hide still does not hide », « in general nothing seem to
   work although the layout is good ») :

     • `buildMainReps` appelait `addDefaultReps(comp, 'main')` DEUX FOIS ;
     • `addDefaultReps` remet `baseCompsRef.current = []` à zéro AU DÉBUT et
       n'enregistre ensuite que sa propre série.

   Donc la PREMIÈRE série de représentations restait dans la scène NGL sans être
   dans la liste : plus aucun rebuild ne pouvait la retirer. Chaque geste de style
   ne redessinait que la série suivie, et la série orpheline continuait à afficher
   l'état D'AVANT — la molécule décochée restait dessinée, la surface ne voulait
   pas disparaître, et les menus semblaient morts.

   Ce qui est vérifié ici est EXÉCUTÉ : `addDefaultReps` et `buildMainReps` sont
   EXTRAITS du .jsx puis lancés sur une doublure de composant NGL qui tient une
   VRAIE scène (chaque représentation ajoutée y entre, chaque représentation
   retirée en sort), comme _viewer_section_visibility_test.mjs le fait pour
   buildSectionReps (le viewer est un .jsx : il ne s'importe pas sous Node).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};

// VIEWER_SRC permet de rejouer la suite sur une version d'avant le correctif
// (elle doit alors ÊTRE ROUGE — c'est ainsi que le bug a été reproduit).
const SRC = process.env.VIEWER_SRC || new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url);
const VIEW = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
const gone = (needle, what) => ok(!VIEW.includes(needle), `${what}\n  encore présent : ${needle}`);

/* ── Extraction : `const name = (…) => { … };` ────────────────────────────── */
const sliceFn = (src, name) => {
  const start = src.indexOf(`const ${name} = (`);
  assert.ok(start >= 0, `fonction ${name} introuvable`);
  const arrow = src.indexOf('=>', start);
  const offset = src.slice(arrow + 2).search(/\S/);
  const body = arrow + 2 + offset;
  assert.equal(src[body], '{', `${name} : corps bloc attendu`);
  let depth = 0;
  for (let i = body; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return `${src.slice(start, i + 1)};`;
    }
  }
  throw new Error(`${name} : corps non terminé`);
};

/* ── Le banc d'essai : la scène NGL en doublure, et les deux fonctions RÉELLES ─
   `VISIBLE` est ce que le rendu des sections dessinerait : une représentation par
   section VISIBLE (une section décochée dans la barre n'en produit aucune). */
const sandbox = [
  `const scene = [];
   let serial = 0;
   const component = {
     structure: {},
     addRepresentation(type, params) {
       const rep = { type, params, id: (serial += 1) };
       scene.push(rep);
       return rep;
     },
     removeRepresentation(rep) {
       const i = scene.indexOf(rep);
       if (i >= 0) scene.splice(i, 1);
     },
   };`,
  'const componentRef = { current: component };',
  'const baseCompsRef = { current: [] };',
  'const catEspRepsRef = { current: new Map() };',
  'const lightRenderRef = { current: false };',
  'const largeStyleRef = { current: "lines" };',
  'const showLargeWaterRef = { current: false };',
  'let VISIBLE = ["protein"];',
  'const rebuildSectionsOf = () => VISIBLE.map((type) => component.addRepresentation(type, {}));',
  sliceFn(VIEW, 'addDefaultReps'),
  sliceFn(VIEW, 'buildMainReps'),
  'const setVisible = (next) => { VISIBLE = next; };',
  'return { buildMainReps, scene, baseCompsRef, component, setVisible };',
].join('\n');
const H = new Function(sandbox)();

// L'invariant qui a manqué : la scène et la liste SUIVIE disent la même chose.
const owned = () => H.scene.every((r) => H.baseCompsRef.current.includes(r));
const types = () => H.scene.map((r) => r.type).sort();

/* ══ 1. UN REBUILD = UNE SEULE SÉRIE, ENTIÈREMENT SUIVIE ═══════════════════ */
H.setVisible(['protein', 'water']);
H.buildMainReps();
// L'orphelin d'abord : sur la version d'avant, la scène contenait DEUX séries et
// la liste n'en suivait qu'une — c'est l'orpheline qui gardait l'ancien dessin.
ok(owned(), 'chaque représentation de la scène est dans baseCompsRef (aucune copie orpheline)');
eq(types(), ['protein', 'water'],
  'un rebuild dessine exactement ce que les sections visibles demandent — pas une fois de plus');

/* ══ 2. DÉCOCHER L'EAU LA RETIRE VRAIMENT (le rapport : « hide ne cache pas ») ═ */
H.setVisible(['protein']);
H.buildMainReps();
eq(types(), ['protein'], 'décocher l’eau la retire de la scène');
ok(owned(), 'après un rebuild, il ne reste AUCUNE représentation orpheline');

/* ══ 3. UNE SURFACE DÉCOCHÉE DISPARAÎT (le rapport : « no way to remove a surface ») ═ */
H.setVisible(['protein', 'surface', 'water']);
H.buildMainReps();
ok(H.scene.some((r) => r.type === 'surface'), 'la surface demandée est bien dessinée');
H.setVisible(['protein']);
H.buildMainReps();
ok(!H.scene.some((r) => r.type === 'surface'),
  'la surface décochée a disparu de la scène — aucune copie oubliée ne la redessine');
ok(!H.scene.some((r) => r.type === 'water'), 'l’eau décochée a disparu elle aussi');
eq(types(), ['protein'], 'il ne reste que ce qui est coché');

/* ══ 4. LE DOUBLE APPEL NE DOIT PAS REVENIR ════════════════════════════════ */
const callCount = VIEW.split("addDefaultReps(comp, 'main');").length - 1;
eq(callCount, 1, 'buildMainReps appelle addDefaultReps UNE fois (le second appel orphelinait la première série)');
gone("addDefaultReps(comp, 'main');\n  addDefaultReps(comp, 'main');", 'les deux appels identiques consécutifs ont disparu');
has(`  if (component === componentRef.current) {
    baseCompsRef.current.forEach((r) => { try { component.removeRepresentation(r); } catch {} });
  }
  baseCompsRef.current = [];`,
  'addDefaultReps retire ce qui est encore suivi AVANT de vider la liste : la liste ne peut plus perdre une représentation vivante');

/* ══ 5. LE CANARI — la forme d'hier laissait bien une copie à l'écran ══════
   Le code d'avant, rejoué tel quel : deux appels, et le second remet la liste à
   zéro sans rien retirer du premier. C'est ce que voyait l'utilisateur. Si ce
   canari devenait vert, c'est la SUITE qui ne mesurerait plus rien. */
const scene2 = [];
const tracked2 = [];
const comp2 = {
  structure: {},
  addRepresentation(type) { const rep = { type }; scene2.push(rep); return rep; },
  removeRepresentation(rep) { const i = scene2.indexOf(rep); if (i >= 0) scene2.splice(i, 1); },
};
const oldAddDefaultReps = (visible) => {
  tracked2.length = 0;                       // ← la liste vidée en premier (comme avant)
  visible.forEach((type) => tracked2.push(comp2.addRepresentation(type)));
};
oldAddDefaultReps(['protein', 'water']);
oldAddDefaultReps(['protein', 'water']);
tracked2.forEach((r) => comp2.removeRepresentation(r));   // le rebuild ne retire que le SUIVI
ok(scene2.some((r) => r.type === 'water'),
  'le canari est vivant : la forme d’hier laisse bien l’eau (donc une surface) à l’écran');

console.log(`_viewer_main_reps_ownership_test.mjs — ${passed} assertions OK`);
