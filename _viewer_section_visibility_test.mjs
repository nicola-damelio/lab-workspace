/* =========================================================================
   _viewer_section_visibility_test.mjs — LE ✔ D'UNE MOLÉCULE DE LA BARRE
   (« Molecules · styling ») DOIT VRAIMENT L'EFFACER DE LA SCÈNE.

   Le bug que cette suite empêche de revenir : le ✔ de la barre range la
   visibilité d'une section sous son id GLOBAL (`<molecule>::<clé>`, voir
   ensureSections), mais le rendu des sections cherchait la clé LOCALE dans
   l'ensemble des sections éteintes (`hidden.has(sec.key)`). `main::water|all`
   n'est jamais `water|all` : le test était donc TOUJOURS faux et le ✔ ne
   faisait rien —

     • décocher une molécule ne la cachait pas (le rapport : « I cannot hide
       the molecules. Hide command does not work ») ;
     • l'eau et les ions, que KIND_VISIBLE_BY_DEFAULT éteint exprès (un boîtier
       solvaté ne doit pas masquer la protéine), étaient dessinés quand même.

   Ce qui est vérifié ici est EXÉCUTÉ : buildSectionReps et hiddenSectionIds
   sont EXTRAITS du .jsx puis lancés, comme _viewer_structure_classes_test.mjs
   le fait pour les classificateurs (le viewer est un .jsx : il ne s'importe
   pas sous Node). Seuls les aides qui n'ont rien à voir avec le sujet — la
   sélection d'une rangée, sa couleur, sa géométrie — sont des doublures.
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

// CRLF → LF pour écrire les aiguilles multi-lignes naturellement.
const VIEW = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
const gone = (needle, what) => ok(!VIEW.includes(needle), `${what}\n  encore présent : ${needle}`);

/* ── Extraction : `const name = (…) => { … };` et `const name = … ;` ─────── */
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
const sliceObject = (src, name) => {
  const start = src.indexOf(`const ${name} = {`);
  assert.ok(start >= 0, `objet ${name} introuvable`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return `${src.slice(start, i + 1)};`;
    }
  }
  throw new Error(`${name} : non terminé`);
};
// `const name = …;` — on équilibre (), {} et [] jusqu'au point-virgule de niveau
// 0 : une valeur multi-ligne (`sectionOpacity` est un corps d'expression) passe.
const sliceDecl = (src, name) => {
  const head = `const ${name} = `;
  const start = src.indexOf(head);
  assert.ok(start >= 0, `déclaration ${name} introuvable`);
  let depth = 0;
  for (let i = start + head.length; i < src.length; i += 1) {
    const c = src[i];
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') depth -= 1;
    else if (c === ';' && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`${name} : déclaration non terminée`);
};
/* ── Le banc d'essai : hiddenSectionIds + buildSectionReps, EXÉCUTÉS ─────── */
const sandbox = [
  // Les seules données / fonctions RÉELLES dont le rendu a besoin ici : quelles
  // représentations une section éteinte peut encore ajouter.
  sliceObject(VIEW, 'KIND_VISIBLE_BY_DEFAULT'),
  sliceDecl(VIEW, 'LICORICE_BOND_RADIUS'),
  sliceDecl(VIEW, 'BALLSTICK_BOND_RADIUS'),
  sliceDecl(VIEW, 'BASE_BOND_RADIUS'),
  sliceDecl(VIEW, 'sectionOpacity'),
  sliceFn(VIEW, 'sectionStyleReps'),
  // Le store où le ✔ écrit : une ref lisible PENDANT le rendu, comme dans le
  // composant (sectionVisRef.current = sectionVis).
  'const sectionVisRef = { current: {} };',
  sliceFn(VIEW, 'hiddenSectionIds'),
  // Le reste n'entre pas dans ce que cette suite vérifie — la sélection d'une
  // rangée (sectionRowSele lit les proxies NGL), sa couleur (sectionColorParams
  // lit les palettes), ses sous-sections, ses ombres, ses plaques : doublures. La
  // liste des styles qui dessinent des ATOMES est, elle, une vraie constante du
  // viewer : le rendu la lit pour savoir si une rangée doit ancrer sa liaison.
  sliceDecl(VIEW, 'ATOM_DRAW_STYLES'),
  'const subsectionsOf = () => [{ sub: "general" }];',
  'const effectiveSectionLook = (looks, kind, sub) => ({ style: "cartoon", colorBy: "element", ...((looks && looks[kind] && looks[kind][sub]) || {}) });',
  'const sectionRowSele = (structure, sec) => sec.sele || null;',
  // …et une rangée qui n’atteint aucun atome le dit (warnIfEmptySelection) : rien à
  // mesurer ici, le lecteur de sélection de la page serait une doublure de plus.
  'const warnIfEmptySelection = () => false;',
  'const sectionColorParams = () => ({ colorScheme: "element" });',
  'const espColorParams = () => ({ colorScheme: "esp" });',
  'const flagMeshShadows = () => {};',
  'const nucleicRingPlates = () => null;',
  'const DEFAULT_NUCLEIC_COLORS = { base: 0xffffff, sugar: 0xffffff, phosphate: 0xffffff };',
  'const gradientRangesFor = () => null;',
  'const gradientColorStore = { ranges: null };',
  sliceDecl(VIEW, 'SPLINE_STYLES'),
  sliceDecl(VIEW, 'SPLINE_TRAIT_OWNERS'),
  sliceFn(VIEW, 'partAtomsHeldBack'),
  sliceFn(VIEW, 'generalCession'),
  sliceFn(VIEW, 'buildSectionReps'),
  'return { hiddenSectionIds, buildSectionReps, sectionVisRef };',
].join('\n');
const H = new Function(sandbox)();
/* ══ 1. UN ID DE SECTION EST GLOBAL, ET L'EAU / LES IONS SONT ÉTEINTS ═════ */
has('const sections = listMoleculeSections(structure).map((s) => ({ ...s, id: `${molKey}::${s.key}` }));',
  'l’id d’une section est GLOBAL : `<molecule>::<clé>`');
has('const v = sectionVisRef.current[s.id];', 'hiddenSectionIds lit la visibilité par ID global');
// Le monde de la barre : une chaîne protéique et l'eau d'un boîtier solvaté.
const SECTIONS = [
  { id: 'main::protein|A', key: 'protein|A', kind: 'protein', name: 'Chain A', detail: '', sele: ':A and protein', count: 1 },
  { id: 'main::water|all', key: 'water|all', kind: 'water', name: 'Water', detail: '', sele: 'water', count: 42 },
];
// Aucun réglage : seule l'eau s'éteint (KIND_VISIBLE_BY_DEFAULT le décide exprès).
H.sectionVisRef.current = {};
eq(Array.from(H.hiddenSectionIds(SECTIONS)), ['main::water|all'],
  'rien de coché : l’eau reste éteinte, et rien d’autre ne l’est');
// Le ✔ décoché d'une molécule, celui de l'eau recoché.
H.sectionVisRef.current = { 'main::protein|A': false, 'main::water|all': true };
eq(Array.from(H.hiddenSectionIds(SECTIONS)), ['main::protein|A'],
  'la chaîne décochée s’éteint, l’eau recochée se rallume');

/* ══ 2. LE RENDU OBÉIT AU ✔ (le bug : il ne l’écoutait pas) ═══════════════ */
// Un composant NGL factice : il retient `type|sele` de chaque représentation.
const fakeComp = () => {
  const calls = [];
  return {
    calls,
    structure: {},
    addRepresentation: (type, params) => {
      calls.push(`${type}|${(params && params.sele) || ''}`);
      return { type, params };
    },
    addBufferRepresentation: (mesh, params) => {
      calls.push(`buffer|${(params && params.opacity) || ''}`);
      return { mesh, params };
    },
  };
};
// Le seul appel du viewer : buildSectionReps(comp, sections, trees, { hidden }).
const rendered = (comp, sections, trees = {}) => {
  comp.calls.length = 0;
  H.buildSectionReps(comp, sections, trees, { hidden: H.hiddenSectionIds(sections) });
  return comp.calls.slice();
};

const comp = fakeComp();
H.sectionVisRef.current = {};
eq(rendered(comp, SECTIONS), ['cartoon|:A and protein'],
  'sans réglage : la protéine est dessinée, l’eau NON (elle bloque la vue)');
// Le rapport : décocher la molécule doit l'effacer ; recocher l'eau la dessine.
H.sectionVisRef.current = { 'main::protein|A': false, 'main::water|all': true };
eq(rendered(comp, SECTIONS), ['cartoon|water'],
  '✔ décoché → la molécule disparaît de la scène ; l’eau recochée est dessinée');
// Revenir en arrière rend la molécule telle qu'elle était.
H.sectionVisRef.current = { 'main::protein|A': true, 'main::water|all': true };
eq(rendered(comp, SECTIONS), ['cartoon|:A and protein', 'cartoon|water'],
  'les deux ✔ cochés : les deux molécules reviennent');
// La forme historique (les CLÉS locales) reste comprise : un appelant qui
// énumère une structure à la main n'a pas à connaître les ids globaux.
const byKey = fakeComp();
H.sectionVisRef.current = {};
H.buildSectionReps(byKey, SECTIONS, {}, { hidden: new Set(['water|all']) });
eq(byKey.calls.slice(), ['cartoon|:A and protein'],
  'les clés locales restent acceptées (le rendu compare l’id ET la clé)');
// Le « Hide » d'une RANGÉE (son menu de style) n'est pas en cause et marche
// toujours : une rangée réglée sur « Hide » n'ajoute aucune représentation.
H.sectionVisRef.current = { 'main::protein|A': true, 'main::water|all': true };
eq(rendered(comp, [SECTIONS[0]], { 'main::protein|A': { protein: { general: { style: 'hide' } } } }), [],
  'une rangée réglée sur « Hide » ne dessine rien (style de rangée, pas le ✔)');
/* ══ 3. LA BARRE ET LE RENDU PARLENT LA MÊME LANGUE ══════════════════════ */
has('onChange={() => toggleSectionVisible(sec.id, kind)}', 'le ✔ de la barre bascule la visibilité par ID');
has('setSectionVis((prev) => ({ ...prev, [id]: !sectionVisible(id, kind) }))',
  'toggleSectionVisible écrit sectionVis[id] — l’id global de la section');
has('const styleSignature = `${sectionLooksSig(kindLooks)}|${JSON.stringify(sectionLooks)}|${JSON.stringify(sectionVis)}|',
  'le ✔ entre dans la signature : un seul rebuild, à chaque bascule');
has('hidden: hiddenSectionIds(sections),', 'le rendu reçoit les sections éteintes de la molécule qu’il dessine');
has('if (hidden && (hidden.has(sec.id) || hidden.has(sec.key))) return;',
  'le rendu compare l’ID global de la section (et accepte la clé locale)');
gone('if (hidden && hidden.has(sec.key)) return;',
  'l’ancienne comparaison clé locale ↔ ids (le ✔ sans effet) a disparu');

/* ══ 4. « 🙈 HIDE EVERYTHING » EMPORTE AUSSI LES MOLÉCULES EXTRA ═════════ */
// Le bouton promet « all molecules » : une structure ajoutée par « Add
// structure » / une chaîne détachée doit disparaître avec la principale (et
// revenir quand on rappuie), surface ⚡ ESP comprise.
has('}, [styleSignature, status, applyCurrentStyleTo, sstrucColors, hideAll, pymolActive]);',
  'le rebuild des molécules EXTRA suit Hide-all / PyMOL');
has('espDisable(entry.id);', '…et leur surface ⚡ ESP part avec leurs représentations');
ok((VIEW.match(/if \(hideAll \|\| pymolActive\)/g) || []).length >= 2,
  'la structure principale ET les molécules extra écoutent le même interrupteur');
has('const show = (k) => visibleMolKeys.has(k);',
  '[conservé] le sélecteur de molécules pilote la visibilité des composants NGL');

/* ── Bilan ═════════════════════════════════════════════════════════════ */
console.log(`_viewer_section_visibility_test.mjs — ${passed} assertions OK`);



