/* =========================================================================
   _viewer_section_scope_test.mjs — TROIS RÉGLAGES DE LA FENÊTRE DE STYLING, ET LA
   MACRO QU'ON ENREGISTRE DEPUIS LE VIEWER.

   Les demandes de cette session, mot pour mot :

     1. « If I change the style in the general section of the styling window and I
        select color by “solid”, the solid color is not transferred to the
        subsections backbone, sidechains, etc. »
     2. « Moreover the setting of the general section does not affect only the
        molecule but all the molecules in different chains and this is not OK. »
     3. « the membrane section of the styling window does not color lipids
        according to the colors defined in the settings wheel if I select color by
        “lipid type”. »
     4. « It should be possible to save a pymol macro written in the viewer without
        having to go to the library page to save a new one. »

   CE QUI EST VÉRIFIÉ ICI :

     §1 LA COULEUR UNIE FAIT PARTIE DE LA CASCADE : « solidColor » est un champ de
        suivi (FOLLOW_FIELDS), et `effectiveSectionLook` la remet aux rangées qui
        suivent General — exécuté sur de vrais arbres, avec le cas de la rangée qui
        a sa PROPRE pastille (elle garde la sienne et cesse de suivre).
     §2 UNE SECTION NE PARLE QUE POUR ELLE : les sections DÉJÀ ÉNUMÉRÉES du même
        type sont ÉPINGLÉES sur l'arbre qu'elles affichent avant que le look du type
        ne soit écrit (pinSectionLooksOfKind, exécuté), et les quatre gestes de la
        barre l'appellent — le 🎨 Copy reste la propagation volontaire.
     §3 LES TROIS LECTURES MAISON QUI MANQUAIENT au « Color by » d'une rangée de
        sélection / de 🧫 membrane (chain · charge · lipidtype) : `schemeForColorMode`
        rend maintenant EXACTEMENT les schémas des rangées du styling, donc les
        couleurs de la roue ⚙ arrivent à la membrane.
     §4 LA MACRO S'ENREGISTRE DEPUIS LE VIEWER : le panneau écrit dans la réserve
        de la Library (utils/pymolScripts.js) — exécuté sur la fonction livrée, avec
        le refus du nom vide, le refus de la macro vide, la confirmation avant
        d'écraser un nom pris, et le commentaire existant conservé.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getPymolScripts, setPymolScript } from './src/utils/pymolScripts.js';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu : ${JSON.stringify(a)}`);
  passed += 1;
};

const SRC = process.env.VIEWER_SRC || new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url);
const VIEW = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
const countOf = (re) => (VIEW.match(re) || []).length;

/* ── Extraction : `const name = (…) => { … };`, `const name = { … };` ────── */
const MASK = VIEW.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
const sliceDecl = (src, name) => {
  const head = `const ${name} = `;
  const start = src.indexOf(head);
  assert.ok(start >= 0, `déclaration ${name} introuvable`);
  let depth = 0;
  for (let i = start + head.length; i < src.length; i += 1) {
    const c = MASK[i];
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') depth -= 1;
    else if (c === ';' && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`${name} : déclaration non terminée`);
};
const sliceFn = (src, name) => {
  const start = src.indexOf(`const ${name} = `);
  assert.ok(start >= 0, `fonction ${name} introuvable`);
  const arrow = src.indexOf('=>', start);
  const body = arrow >= 0 ? src.indexOf('{', arrow) : -1;
  const between = body > arrow ? MASK.slice(arrow + 2, body).trim() : 'x';
  if (body < 0 || between !== '') return sliceDecl(src, name);
  let depth = 0;
  for (let i = body; i < src.length; i += 1) {
    if (MASK[i] === '{') depth += 1;
    else if (MASK[i] === '}') { depth -= 1; if (depth === 0) return `${src.slice(start, i + 1)};`; }
  }
  throw new Error(`${name} : corps non terminé`);
};
const sliceObject = (src, name) => {
  const start = src.indexOf(`const ${name} = {`);
  assert.ok(start >= 0, `objet ${name} introuvable`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (MASK[i] === '{') depth += 1;
    else if (MASK[i] === '}') { depth -= 1; if (depth === 0) return `${src.slice(start, i + 1)};`; }
  }
  throw new Error(`${name} : objet non terminé`);
};

/* ══ §1. « SOLID » SUR GENERAL DESCEND ════════════════════════════════════════ */
const HIER = new Function([
  sliceObject(VIEW, 'DEFAULT_ATOM_COLORS'),
  sliceObject(VIEW, 'KIND_CATEGORY'),
  sliceDecl(VIEW, 'DEFAULT_ELEMENT_COLOR'),
  sliceObject(VIEW, 'STYLES'),
  sliceObject(VIEW, 'COLORS'),
  sliceObject(VIEW, 'SECTION_SUBSECTIONS'),
  sliceDecl(VIEW, 'subsectionsOf'),
  sliceDecl(VIEW, 'subsectionSpec'),
  sliceDecl(VIEW, 'SECTION_LOOK_FIELDS'),
  sliceDecl(VIEW, 'FOLLOW_FIELDS'),
  sliceFn(VIEW, 'defaultLookOf'),
  sliceFn(VIEW, 'effectiveSectionLook'),
  sliceDecl(VIEW, 'rowFollowsGeneral'),
  sliceFn(VIEW, 'partStyleUnderGeneral'),
  sliceDecl(VIEW, 'RADIUS_FIELDS'),
  sliceDecl(VIEW, 'ATOM_DRAW_STYLES'),
  sliceFn(VIEW, 'setGeneralSectionField'),
  sliceFn(VIEW, 'setRowSectionField'),
  'return { FOLLOW_FIELDS, defaultLookOf, effectiveSectionLook, rowFollowsGeneral, setGeneralSectionField, setRowSectionField };',
].join('\n'))();
const eff = (tree, kind, sub) => HIER.effectiveSectionLook(tree, kind, sub);
const gen = (tree, kind, sub) => tree[kind][sub] || {};

// 1a. La couleur unie est un champ de SUIVI, comme le style ou l'opacité.
ok(HIER.FOLLOW_FIELDS.includes('solidColor'),
  '« solidColor » est un champ de suivi : General le remet à ses parties');
ok(HIER.FOLLOW_FIELDS.includes('style') && HIER.FOLLOW_FIELDS.includes('colorBy'),
  '…à côté du style et de la coloration (la règle n’est pas un cas particulier)');

// 1b. « General → Solid » + une couleur : chaque partie qui suit PEINT cette
//     couleur-là, et sa pastille montre la même (le rapport n° 1).
const solidGeneral = HIER.setGeneralSectionField(
  HIER.setGeneralSectionField({}, 'protein', 'colorBy', 'solid'),
  'protein', 'solidColor', 0x22c55e);
eq(gen(solidGeneral, 'protein', 'general').colorBy, 'solid', 'General passe sur « Solid »');
eq(gen(solidGeneral, 'protein', 'backbone').colorBy, 'solid',
  'la coloration descend sur le squelette (sa liste la connaît)');
eq(eff(solidGeneral, 'protein', 'backbone').solidColor, 0x22c55e,
  '…et le squelette PEINT la couleur unie de General (le rapport : « the solid color is not transferred to the backbone »)');
eq(eff(solidGeneral, 'protein', 'sidechain').solidColor, 0x22c55e,
  '…les chaînes latérales aussi (« … and sidechains »)');
eq(gen(solidGeneral, 'protein', 'sidechain').solidColor, 0x22c55e,
  'la valeur est écrite DANS la rangée (c’est le même mécanisme que l’opacité)');

// 1c. Changer la pastille de General (sans toucher au style) atteint les parties.
const recoloured = HIER.setGeneralSectionField(solidGeneral, 'protein', 'solidColor', 0xef4444);
eq(eff(recoloured, 'protein', 'backbone').solidColor, 0xef4444, 'une nouvelle pastille de General repaint le squelette');
eq(eff(recoloured, 'protein', 'sidechain').solidColor, 0xef4444, '…et les chaînes latérales');

// 1d. UNE PARTIE QUI A SA PROPRE PASTILLE garde la sienne et cesse de suivre :
//     c’est « le geste de la rangée », la même règle que pour tout autre champ.
const ownSide = HIER.setRowSectionField(recoloured, 'protein', 'sidechain', 'solidColor', 0xffffff);
eq(gen(ownSide, 'protein', 'sidechain').follow, false,
  'une pastille choisie sur la rangée DÉTACHE cette rangée de General');
ok(!HIER.rowFollowsGeneral(ownSide, 'protein', 'sidechain'), '…donc son badge « ← General » disparaît');
eq(eff(ownSide, 'protein', 'sidechain').solidColor, 0xffffff, '…et elle garde SA couleur');
const regeneral = HIER.setGeneralSectionField(ownSide, 'protein', 'solidColor', 0x0000ff);
eq(eff(regeneral, 'protein', 'sidechain').solidColor, 0xffffff,
  'un changement de General ne la repeint plus (elle ne suit plus)');
eq(eff(regeneral, 'protein', 'backbone').solidColor, 0x0000ff,
  '…tandis que le squelette, lui, suit toujours');
eq(eff(regeneral, 'protein', 'general').solidColor, 0x0000ff, 'et General peint sa propre couleur');

// 1e. Les trois familles de molécules à parties (protéine · acide nucléique ·
//     lipide) suivent la MÊME règle.
['protein', 'nucleic', 'lipid'].forEach((kind) => {
  const tree = HIER.setGeneralSectionField({}, kind, 'solidColor', 0x112233);
  const parts = Object.keys(tree[kind]).filter((s) => s !== 'general');
  ok(parts.length > 0, `[${kind}] la section a bien des parties`);
  parts.forEach((sub) => {
    eq(eff(tree, kind, sub).solidColor, 0x112233, `[${kind}/${sub}] la couleur unie de General descend`);
  });
});

// 1f. Une couleur unie n’est PAS un style : la cascade de style reste intacte.
const styled = HIER.setGeneralSectionField({}, 'protein', 'style', 'ribbon');
eq(gen(styled, 'protein', 'sidechain').style, 'hide', 'la cascade de style n’a pas bougé (une chaîne latérale ne dessine pas de ruban)');
eq(eff(styled, 'protein', 'backbone').style, 'ribbon', '…et le squelette prend le ruban, comme avant');

/* ══ §2. UNE SECTION NE PARLE QUE POUR ELLE ═══════════════════════════════════ */
// La règle livrée est un pur calcul de patch : on l’exécute avec de fausses
// références (le catalogue des sections, les arbres déjà écrits, le look du type).
const PIN = new Function('sectionCatalogRef', 'sectionLooksRef', 'kindLooksRef', [
  sliceObject(VIEW, 'DEFAULT_ATOM_COLORS'),
  sliceObject(VIEW, 'KIND_CATEGORY'),
  sliceDecl(VIEW, 'DEFAULT_ELEMENT_COLOR'),
  sliceObject(VIEW, 'STYLES'),
  sliceObject(VIEW, 'COLORS'),
  sliceObject(VIEW, 'SECTION_SUBSECTIONS'),
  sliceDecl(VIEW, 'subsectionsOf'),
  sliceDecl(VIEW, 'subsectionSpec'),
  sliceFn(VIEW, 'defaultLookOf'),
  sliceFn(VIEW, 'initialSectionTree'),
  sliceFn(VIEW, 'pinSectionLooksOfKind'),
  'return { pinSectionLooksOfKind, initialSectionTree };',
].join('\n'));
const catalogOf = () => ({
  main: {
    sections: [
      { id: 'main::protein|A', key: 'protein|A', kind: 'protein', name: 'Chain A' },
      { id: 'main::protein|B', key: 'protein|B', kind: 'protein', name: 'Chain B' },
      { id: 'main::lipid|A', key: 'lipid|A', kind: 'lipid', name: 'Chain A' },
    ],
  },
  extra: { sections: [{ id: 'x1::protein|A', key: 'protein|A', kind: 'protein', name: 'Second structure' }] },
});
const kindLooks = {
  protein: { general: { style: 'cartoon', colorBy: 'sstruc', solidColor: 0x101010, opacity: 0, sphere: 1, bond: 1, material: 'auto', roughness: null, metalness: null, follow: false } },
  lipid: {},
};
const pin = PIN({ current: catalogOf() }, { current: {} }, { current: kindLooks });

const pinned = pin.pinSectionLooksOfKind('main::protein|A', 'protein');
eq(Object.keys(pinned).sort(), ['main::protein|B', 'x1::protein|A'],
  'le geste ÉPINGLE les AUTRES sections du même type (l’autre chaîne, l’autre structure) — jamais la section touchée');
ok(!('main::lipid|A' in pinned), '…et pas une section d’un autre type');
ok(!('main::protein|A' in pinned), '…ni celle qui porte le geste');
eq(pinned['main::protein|B'].protein.general.solidColor, 0x101010,
  'l’arbre épinglé est celui que la section affiche À CET INSTANT (le look du type)');
eq(Object.keys(pinned['main::protein|B'].protein), ['general', 'backbone', 'sidechain'],
  '…entier : toutes les rangées de son type');

// L’arbre épinglé est une COPIE : la suite de la vie d’une section ne touche pas
// les autres (c’est tout l’objet du correctif du rapport n° 2).
pinned['main::protein|B'].protein.general.solidColor = 0x999999;
eq(pinned['x1::protein|A'].protein.general.solidColor, 0x101010,
  'chaque section épinglée repart avec SON arbre (aucun partage d’objet)');
eq(kindLooks.protein.general.solidColor, 0x101010, '…et le look du type n’est pas modifié par le patch');

// Une section qui a DÉJÀ son arbre n’est jamais réécrite.
const pin2 = PIN({ current: catalogOf() }, { current: { 'main::protein|B': { general: { style: 'hide' } } } }, { current: kindLooks });
eq(Object.keys(pin2.pinSectionLooksOfKind('main::protein|A', 'protein')), ['x1::protein|A'],
  'une section qui a déjà son arbre est laissée telle quelle');

// Le câblage : les QUATRE gestes de la barre passent par cet épinglage, et la
// propagation volontaire reste le 🎨 Copy.
has('const pinSectionLooksOfKind = (keepId, kind) => {', 'la règle existe (une seule implémentation)');
eq(countOf(/const pinned = pinSectionLooksOfKind\(id, kind\);/g), 4,
  'un seul appel par geste — setSectionField · setSectionMaterialField · ↺ d’une rangée · ↺ d’une section');
eq(countOf(/setSectionLooks\(\(prev\) => \(\{ \.\.\.prev, \.\.\.pinned, \[id\]: nextTree \}\)\);/g), 4,
  '…et les quatre écrivent le patch épinglé en même temps que le leur');
has('const copySectionsToAll = () => {', 'la propagation VOLONTAIRE garde son geste dédié (🎨 Copy)');
has('onClick={copySectionsToAll}', '…et son bouton');

/* ══ §3. « COLOR BY : LIPID TYPE » D'UNE RANGÉE DE 🧫 MEMBRANE ════════════════ */
// La correspondance « Color by » → schéma NGL, exécutée : c'est ELLE que la rangée
// d'une sélection / d'un feuillet utilise (colorScheme = schemeForColorMode(mode)).
const schemeFn = (keys) => new Function([
  ...Object.entries(keys).map(([k, v]) => `let ${k} = ${JSON.stringify(v)};`),
  sliceFn(VIEW, 'schemeForColorMode'),
  'return schemeForColorMode;',
].join('\n'))();
const HOUSE = {
  sstrucSchemeKey: 'lab-sstruc', elementSchemeKey: 'lab-elements', sugarSchemeKey: 'lab-sugar-identity',
  glycanSchemeKey: 'lab-glycans', lipidClassSchemeKey: 'lab-lipid-class', residueSchemeKey: 'lab-residue',
  baseTypeSchemeKey: 'lab-base-type', nucleicFormSchemeKey: 'lab-nuc-form', nucleicMotifSchemeKey: 'lab-nuc-motif',
  chainSchemeKey: 'lab-chain', chargeSchemeKey: 'lab-charge',
};
const SCHEME = schemeFn(HOUSE);
const NONE = schemeFn(Object.fromEntries(Object.keys(HOUSE).map((k) => [k, null])));

eq(SCHEME('lipidtype'), 'lab-lipid-class',
  '« Lipid type » d’une rangée de membrane prend le schéma des types de lipides de la ⚙ (le rapport n° 3)');
eq(SCHEME('chain'), 'lab-chain', '« Chain » prend la palette des chaînes de la ⚙ (et non le nom « chain », que NGL ne connaît pas)');
eq(SCHEME('charge'), 'lab-charge', '« Charge » prend celle des charges (les ions de la barre de gauche)');
eq(NONE('lipidtype'), 'element',
  '…et si un schéma n’a pas pu être enregistré, la rangée retombe sur les éléments : jamais une molécule sans couleur');
eq(NONE('chain'), 'chainid', '…la chaîne sur le `chainid` natif de NGL');
eq(NONE('charge'), 'element', '…et la charge sur les éléments');
eq(SCHEME('chainid'), 'chainid', 'les métaphores natives passent toujours telles quelles');
eq(SCHEME('hydrophobicity'), 'hydrophobicity', '…toutes');
eq(SCHEME('lipidclass'), 'lab-lipid-class', 'la lecture des menus de §2 n’a pas bougé');

// LES DEUX BARRES LISENT LA MÊME PAILLE : la rangée de styling (sectionColorParams)
// et la rangée de sélection / membrane (schemeForColorMode) nomment les mêmes
// schémas — une couleur changée dans la roue ⚙ atteint donc la membrane.
has("case 'lipidtype': return schemeParam(lipidClassSchemeKey || elementSchemeKey, 'element');",
  '[styling] la rangée du lipide lit lab-lipid-class');
has("if (mode === 'lipidtype') return lipidClassSchemeKey || elementSchemeKey || 'element';",
  '[membrane / sélections] …et la rangée de la membrane lit EXACTEMENT le même');
has("case 'chain': return schemeParam(chainSchemeKey, 'chainid');", '[styling] la rangée lit lab-chain');
has("if (mode === 'chain') return chainSchemeKey || 'chainid';", '[membrane / sélections] …et la même palette de chaînes');
has("const colorScheme = colorMode !== 'solid' ? schemeForColorMode(colorMode) : undefined;",
  'la rangée de sélection / membrane passe bien par cette correspondance');
has('colorOptions: SEL_COLOR_MODES,', '…et son menu « Color by » propose « Lipid type » (SEL_COLOR_MODES ← COLORS)');

/* ══ §4. 💾 ENREGISTRER LA MACRO DEPUIS LE VIEWER ═════════════════════════════ */
// La réserve est celle de la Library : on l'exécute pour de vrai (faux localStorage).
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};
const LIB = { getPymolScripts, setPymolScript };
LIB.setPymolScript('Membrane setup', 'hide all\nshow cartoon, protein', 'for bilayers');
eq(LIB.getPymolScripts()['Membrane setup'],
  { script: 'hide all\nshow cartoon, protein', comment: 'for bilayers' },
  'la réserve de la Library écrit bien nom + macro + commentaire');

// Le geste du viewer, exécuté sur la fonction LIVRÉE : nom vide, macro vide, nom
// déjà pris (confirmation), et l'écriture dans la réserve de la Library.
const wanted = [];
const saved = [];
const runSave = (state, confirmAnswer = true) => {
  const fn = new Function(
    'pymolScriptName', 'pymolScript', 'setPymolSaveMsg', 'getPymolScripts',
    'savePymolScriptToLibrary', 'window',
    `${sliceFn(VIEW, 'saveViewerPymolScript')}\nreturn saveViewerPymolScript;`,
  )(
    state.name, state.script,
    (m) => wanted.push(m),
    () => LIB.getPymolScripts(),
    (n, s, c) => { saved.push([n, s, c]); LIB.setPymolScript(n, s, c); },
    { confirm: () => confirmAnswer },
  );
  return fn();
};
runSave({ name: '', script: 'show cartoon' });
ok(String(wanted.pop()).includes('name'), 'un nom vide est REFUSÉ (et dit à l’utilisateur)');
runSave({ name: 'Nothing', script: '   ' });
ok(String(wanted.pop()).includes('empty'), 'une macro vide est refusée');
ok(saved.length === 0, '…rien n’est écrit dans ces deux cas');

runSave({ name: 'New macro', script: 'show spheres' });
eq(saved.pop(), ['New macro', 'show spheres', ''],
  'une macro neuve est enregistrée depuis le viewer, sans passer par la page Library');
eq(Object.keys(LIB.getPymolScripts()).sort(), ['Membrane setup', 'New macro'],
  '…et elle est bien dans la réserve que la page Library affiche');

runSave({ name: 'Membrane setup', script: 'hide all\nshow licorice' }, false);
ok(saved.length === 0, 'un nom DÉJÀ PRIS n’est pas écrasé sans confirmation');
runSave({ name: 'Membrane setup', script: 'hide all\nshow licorice' });
eq(saved.pop(), ['Membrane setup', 'hide all\nshow licorice', 'for bilayers'],
  '…et une fois confirmé, la macro est remplacée en GARDANT son commentaire');
ok(String(wanted[wanted.length - 2] || '').includes('saved'), '…l’utilisateur reçoit la confirmation « saved »');

// Le panneau : le nom, le bouton, et le nom repris quand on recharge une macro.
has("import { getPymolScripts, setPymolScript as savePymolScriptToLibrary } from '../utils/pymolScripts';",
  'le viewer importe la MÊME écriture que la Library (un seul stockage)');
has('const saveViewerPymolScript = () => {', 'le geste existe');
has('onClick={saveViewerPymolScript}', '…et il est offert dans le panneau 🧪 Selections & PyMOL');
has('placeholder="Macro name"', '…à côté du nom de la macro');
has('setPymolScriptName(n);', 'charger une macro de la Library remplit son nom (💾 la met donc à jour)');
has('saved — it is in Library → PyMOL Scripts and in the list above',
  'la confirmation nomme ce qui a été enregistré et où il se retrouve');
has('Object.entries(getPymolScripts()).map(([n]) => (',
  'la liste déroulante du panneau relit la réserve (donc la macro y apparaît aussitôt)');

/* ── Bilan ──────────────────────────────────────────────────────────────── */
// …et le compte, lisible par les sondes de ce dépôt (`node --import` / wrapper) :
// la sortie standard d'un module est avalée dans certains environnements, pas le code.
globalThis.__viewerSectionScopeAssertions = passed;
console.log(`_viewer_section_scope_test.mjs — ${passed} assertions OK (solid qui descend · section qui ne parle que pour elle · membrane par type de lipide · macro enregistrée depuis le viewer)`);
