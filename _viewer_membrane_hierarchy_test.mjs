/* =========================================================================
   _viewer_membrane_hierarchy_test.mjs — LA HIÉRARCHIE D'UNE BICOUCHE.

   La demande, mot pour mot : « Since upper headgroup is a part of upper leaflet, the
   latter must impose the settings on the first. the same applys for lower leaflet
   (general) and lower headgroups. the order of hierarchy in this case is upper
   leaflet -> upper headgroups --> phospholipids general --> phospholipid headgrpup,
   glycerol and acyl chains (the last three on the same level). and also lower
   leaflet -> lower headgroups --> phospholipids general --> (…). In this way if I
   have a membrane which is a mixture of POPC and POPE, changing phospholipid upper
   leaflet will also change the sections of each of the two phospholipids. »

   CE QUI EST VÉRIFIÉ ICI, EN EXÉCUTANT LA RÈGLE SUR DE VRAIS OBJETS :

     §1 LE SAUT FEUILLET → TÊTES DE GROUPE (selRowWithStyle · membraneRowImposes) :
        le style, la coloration, la pastille, la transparence et les rayons du
        feuillet sont posés sur SA rangée de têtes de groupe — et les têtes gardent
        leurs atomes (membraneHeadRelinquish reste chaîné), sans que rien ne remonte.
     §2 LE SAUT TÊTES DE GROUPE → SECTIONS (phospholipidImposedWrite ·
        phospholipidSectionIds) : ce sont les DEUX sections POPC et POPE d'un mélange
        qui suivent, le vocabulaire de la section limite ce qui est écrit (un style
        qu'un phospholipide ne connaît pas n'est jamais écrit), le 🎛 matériau ne
        descend pas, et une rangée de macro n'est pas dans la hiérarchie.
     §3 LA CHAÎNE ENTIÈRE, exécutée : feuillet → têtes → rangée General de la section
        → ses trois rangées (têtes de groupe · chaînes acyle · glycérol, au MÊME
        niveau), « Hide » compris, et une surface qui laisse les parties se cacher.
     §4 LE CÂBLAGE dans la source : les deux sauts sont appelés par setSelField (le
        geste des DEUX barres), toutes les sections de phospholipides sont écrites,
        RIEN NE REMONTE, et les rangées disent leur hiérarchie dans leur info-bulle.
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

const SRC = process.env.VIEWER_SRC || new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url);
const VIEW = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
const countOf = (re) => (VIEW.match(re) || []).length;

/* ── Extraction : `const name = (…) => { … };`, `const name = { … };`, ──────────
   `const name = … ;` — le harnais de _viewer_general_row_test.mjs, à l'identique. */
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

/* ══ 1. LE SAUT FEUILLET → TÊTES DE GROUPE, EXÉCUTÉ ═══════════════════════════
   « Since upper headgroup is a part of upper leaflet, the latter must impose the
   settings on the first. » La règle tourne sur un état de `selStyles` ordinaire
   (celui que les deux barres écrivent), avec `toggleSelStyle` — le geste des ticks
   — donc les autres rangées retrouvent leurs atomes comme d'habitude. */
const ROWS = new Function([
  sliceObject(VIEW, 'MEMBRANE_SIDE_OF'),
  sliceObject(VIEW, 'MEMBRANE_PARENT_OF'),
  sliceObject(VIEW, 'MEMBRANE_CHILD_OF'),
  sliceObject(VIEW, 'MEMBRANE_ROW_BELOW'),
  sliceObject(VIEW, 'MEMBRANE_PHOSPHOLIPID_ROW'),
  sliceObject(VIEW, 'MEMBRANE_IMPOSED_FIELDS'),
  sliceObject(VIEW, 'SEL_STYLE_FLAG_OF'),
  sliceObject(VIEW, 'SEL_STYLE_TOGGLE_TOKEN'),
  sliceObject(VIEW, 'LOOK_FIELD_OF_SEL'),
  'const selections = [];',
  'let selStylesRef = { current: {} };',
  'const setSelStyles = (v) => { selStylesRef.current = v; };',
  sliceFn(VIEW, 'toggleSelStyle'),
  sliceFn(VIEW, 'membraneHeadRelinquish'),
  sliceFn(VIEW, 'selRowWithStyle'),
  sliceFn(VIEW, 'membraneRowImposes'),
  'return { MEMBRANE_ROW_BELOW, MEMBRANE_PHOSPHOLIPID_ROW, MEMBRANE_IMPOSED_FIELDS, MEMBRANE_CHILD_OF, MEMBRANE_PARENT_OF, MEMBRANE_SIDE_OF, LOOK_FIELD_OF_SEL, selRowWithStyle, membraneRowImposes };',
].join('\n'))();

// 1a. La rangée du bas est laissée EXACTEMENT comme le menu du haut la choisit :
//     le drapeau de ce style, tous les autres éteints.
const line = ROWS.selRowWithStyle({}, 'upper_headgroups', 'line');
eq(line.upper_headgroups, { line: true },
  'le style demandé est posé sur la rangée du bas (le drapeau de CE style, et rien d’autre avec)');
ok(ROWS.selRowWithStyle(line, 'upper_headgroups', 'line') === line,
  '…et un second geste identique n’écrit RIEN (même objet : aucune écriture d’état inutile)');
eq(ROWS.selRowWithStyle({ upper_headgroups: { ball: true } }, 'upper_headgroups', 'licorice').upper_headgroups,
  { ball: false, stick: true },
  '…le drapeau du style précédent est ÉTEINT (le geste des ticks, donc les autres rangées retrouvent ces atomes)');

// 1b. LE FEUILLET IMPOSE SON STYLE À SES TÊTES DE GROUPE.
const up = ROWS.membraneRowImposes({}, 'upper_leaflet', 'style', 'ball+stick');
eq(up.upper_headgroups, { ball: true }, 'upper_leaflet → upper_headgroups : le style est posé sur les têtes de groupe');
ok(up.upper_leaflet === undefined, '…et la rangée du feuillet n’est pas réécrite ici (le geste s’en est déjà chargé)');
const ceded = ROWS.membraneRowImposes({ upper_leaflet: { ball: true } }, 'upper_leaflet', 'style', 'ball+stick');
eq(ceded.upper_leaflet.hideFor, { ball: ['upper_headgroups'] },
  '…les têtes gardent LEURS atomes : le feuillet les soustrait du style qu’il dessine (membraneHeadRelinquish reste chaîné)');
eq(ceded.upper_headgroups, { ball: true }, '…et elles dessinent le style que le feuillet vient de prendre');

// 1c. Le bas suit la même règle, et les deux moitiés ne se mélangent pas.
const lo = ROWS.membraneRowImposes({}, 'lower_leaflet', 'style', 'spacefill');
eq(lo.lower_headgroups, { sphere: true },
  'lower_leaflet → lower_headgroups : « the same applys for lower leaflet and lower headgroups »');
ok(lo.upper_headgroups === undefined, '…un geste du bas ne touche jamais le haut');
const headsAlone = {};
ok(ROWS.membraneRowImposes(headsAlone, 'upper_headgroups', 'style', 'line') === headsAlone,
  'les têtes de groupe ne se remplissent pas elles-mêmes : ce qu’elles remplissent, ce sont les SECTIONS (§2)');

// 1d. LES AUTRES RÉGLAGES PARLENT AUSSI, sous le nom que les deux barres lisent.
eq(ROWS.membraneRowImposes({}, 'upper_leaflet', 'colorBy', 'lipidtype').upper_headgroups, { colorMode: 'lipidtype' },
  'la coloration descend (colorMode : le nom de la rangée de sélection)');
eq(ROWS.membraneRowImposes({}, 'upper_leaflet', 'solidColor', 0x3366ff).upper_headgroups, { color: 0x3366ff },
  'la pastille « Solid » descend (color)');
eq(ROWS.membraneRowImposes({}, 'upper_leaflet', 'opacity', 0.4).upper_headgroups, { transparency: 0.4 },
  'la transparence descend (transparency)');
eq(ROWS.membraneRowImposes({}, 'upper_leaflet', 'sphere', 1.5).upper_headgroups, { radiusSphere: 1.5 },
  'le rayon R◯ descend (radiusSphere)');
eq(ROWS.membraneRowImposes({}, 'upper_leaflet', 'bond', 0.8).upper_headgroups, { radiusBond: 0.8 },
  'le rayon R— descend (radiusBond)');
Object.keys(ROWS.MEMBRANE_IMPOSED_FIELDS).forEach((f) => {
  if (f === 'style') return;
  eq(ROWS.MEMBRANE_IMPOSED_FIELDS[f], ROWS.LOOK_FIELD_OF_SEL[f],
    `« ${f} » est gardé sous le nom que les DEUX barres lisent (une seule table, LOOK_FIELD_OF_SEL)`);
});

// 1e. CE QUI NE DESCEND PAS, ET CE QUI N'EST PAS CONCERNÉ.
const same = {};
ok(ROWS.membraneRowImposes(same, 'upper_leaflet', 'material', 'glass') === same,
  'le 🎛 matériau NE DESCEND PAS (il appartient à la rangée et à une famille de représentation)');
ok(ROWS.membraneRowImposes(same, 'POPC', 'style', 'line') === same,
  'une rangée de macro n’est pas dans la hiérarchie');
ok(ROWS.membraneRowImposes(same, 'headgroups', 'style', 'line') === same,
  '…quelle que soit la sélection que le script a faite sur les lipides');
ok(ROWS.membraneRowImposes(same, 'upper_headgroups', 'colorBy', 'element') === same,
  'rien sous une rangée des têtes : ce qui suit les têtes de groupe, ce sont les SECTIONS');
const noWrite = { upper_headgroups: { colorMode: 'element' } };
ok(ROWS.membraneRowImposes(noWrite, 'upper_leaflet', 'colorBy', 'element') === noWrite,
  '…et une valeur déjà posée n’écrit pas d’état (même objet rendu)');

/* ══ 2. LE SAUT TÊTES DE GROUPE → SECTIONS DE PHOSPHOLIPIDES ══════════════════
   « phospholipids general → phospholipid headgrpup, glycerol and acyl chains » et
   « changing phospholipid upper leaflet will also change the sections of each of the
   two phospholipids ». La règle s'exécute sur les vraies listes de styles et de
   colorations des phospholipides (STYLES.small · COLORS.lipid). */
const PHOS = new Function([
  sliceObject(VIEW, 'STYLES'),
  sliceObject(VIEW, 'COLORS'),
  sliceObject(VIEW, 'SECTION_SUBSECTIONS'),
  sliceDecl(VIEW, 'subsectionsOf'),
  sliceDecl(VIEW, 'subsectionSpec'),
  sliceObject(VIEW, 'MEMBRANE_PHOSPHOLIPID_ROW'),
  sliceObject(VIEW, 'MEMBRANE_IMPOSED_FIELDS'),
  sliceFn(VIEW, 'phospholipidImposedWrite'),
  sliceDecl(VIEW, 'phospholipidSectionIds'),
  'return { phospholipidImposedWrite, phospholipidSectionIds };',
].join('\n'))();

eq(PHOS.phospholipidImposedWrite('upper_leaflet', 'style', 'line'), { field: 'style', value: 'line' },
  'un feuillet atteint la rangée General des sections (le style passe tel quel : même vocabulaire)');
eq(PHOS.phospholipidImposedWrite('upper_headgroups', 'style', 'ball+stick'), { field: 'style', value: 'ball+stick' },
  '…les têtes de groupe aussi (c’est LEUR rangée que les sections suivent)');
eq(PHOS.phospholipidImposedWrite('lower_headgroups', 'style', 'surface'), { field: 'style', value: 'surface' },
  '…des deux côtés (« the same applys for lower leaflet (general) and lower headgroups »)');
eq(PHOS.phospholipidImposedWrite('POPC', 'style', 'line'), null,
  'une rangée de macro n’est pas dans la hiérarchie');
eq(PHOS.phospholipidImposedWrite('upper_leaflet', 'style', 'cartoon'), null,
  'un style que la rangée General d’un phospholipide ne connaît pas n’est JAMAIS écrit (il se lirait « Hide »)');
eq(PHOS.phospholipidImposedWrite('upper_leaflet', 'colorBy', 'lipidtype'), { field: 'colorBy', value: 'lipidtype' },
  'la coloration descend aussi (colorBy, le nom d’une SECTION)');
eq(PHOS.phospholipidImposedWrite('upper_leaflet', 'colorBy', 'basetype'), null,
  '…si la liste des phospholipides la connaît (COLORS.lipid) : une liste d’une autre molécule ne passe pas');
eq(PHOS.phospholipidImposedWrite('upper_leaflet', 'material', 'glass'), null,
  'le 🎛 matériau ne descend pas dans les sections');
eq(PHOS.phospholipidImposedWrite('upper_leaflet', 'sphere', 1.4), { field: 'sphere', value: 1.4 },
  'les deux rayons descendent (un réglage qui n’est pas une description ne casse rien)');
eq(PHOS.phospholipidImposedWrite('upper_leaflet', 'bond', 0.9), { field: 'bond', value: 0.9 },
  '…R— compris');
eq(PHOS.phospholipidImposedWrite('upper_leaflet', 'hidden', true), null,
  'le 🙈 n’est pas un réglage de cette hiérarchie (cacher une rangée retire déjà ses atomes de partout)');

// LES SECTIONS QUE LA RANGÉE ATTEINT : une par nom de résidu, dans toute la barre.
const catalog = {
  main: {
    sections: [
      { id: 'main::protein|A', kind: 'protein' },
      { id: 'main::lipid|POPC', kind: 'lipid' },
      { id: 'main::lipid|POPE', kind: 'lipid' },
      { id: 'main::lipid|CHOL', kind: 'lipid' },
      { id: 'main::water|all', kind: 'water' },
    ],
  },
  extra_1: { sections: [{ id: 'extra_1::lipid|POPG', kind: 'lipid' }] },
};
eq(PHOS.phospholipidSectionIds(catalog),
  ['main::lipid|POPC', 'main::lipid|POPE', 'main::lipid|CHOL', 'extra_1::lipid|POPG'],
  'un mélange POPC + POPE + CHOL donne TROIS sections de lipides : « each of the two phospholipids » (et le cholestérol, lipide lui aussi)');
eq(PHOS.phospholipidSectionIds({}), [], 'sans molécule, aucune section');
eq(PHOS.phospholipidSectionIds(null), [], '…et jamais d’exception');

/* ══ 3. LA CHAÎNE ENTIÈRE, EXÉCUTÉE ══════════════════════════════════════════
   Le feuillet impose son style aux têtes (§1), les têtes l'imposent à la rangée
   General de la section (§2), et la section le passe à SES rangées par la cascade
   déjà en place (setGeneralSectionField) — les trois du même niveau. */
const CHAIN = new Function([
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
  sliceFn(VIEW, 'setGeneralSectionField'),
  sliceFn(VIEW, 'setRowSectionField'),
  sliceObject(VIEW, 'MEMBRANE_PHOSPHOLIPID_ROW'),
  sliceObject(VIEW, 'MEMBRANE_IMPOSED_FIELDS'),
  sliceFn(VIEW, 'phospholipidImposedWrite'),
  'return { phospholipidImposedWrite, setGeneralSectionField, setRowSectionField, effectiveSectionLook, partStyleUnderGeneral };',
].join('\n'))();

// Ce que imposeOnPhospholipids écrit dans la section POPC : le General, puis ses trois
// rangées — c'est littéralement l'appel setSectionField(id, 'lipid', 'general', …).
const write = CHAIN.phospholipidImposedWrite('upper_leaflet', 'style', 'line');
const popc = CHAIN.setRowSectionField({}, 'lipid', 'general', write.field, write.value);
eq(popc.lipid.general.style, 'line', 'la rangée « General » de la section POPC prend le style du feuillet');
eq(popc.lipid.head.style, 'line', '…et sa rangée « Phospholipid headgroups » suit');
eq(popc.lipid.tail.style, 'line', '…celle des « Acyl chains » aussi');
eq(popc.lipid.glycerol.style, 'line', '…et « Glycerol » : les trois sont au MÊME niveau, comme la demande le dit');
eq(CHAIN.effectiveSectionLook(popc, 'lipid', 'tail').style, 'line', '…c’est bien ce que la rangée des chaînes acyle dessine');
eq(CHAIN.effectiveSectionLook(popc, 'lipid', 'head').follow, true, '…et elles restent DANS la hiérarchie (le prochain style les reprend)');

// « Hide » descend comme un style : la section se cache AVEC le feuillet.
const hideWrite = CHAIN.phospholipidImposedWrite('upper_leaflet', 'style', 'hide');
eq(hideWrite, { field: 'style', value: 'hide' }, '« Hide » est un style que la General d’un phospholipide connaît : il descend aussi');
const hid = CHAIN.setRowSectionField({}, 'lipid', 'general', hideWrite.field, hideWrite.value);
eq(CHAIN.effectiveSectionLook(hid, 'lipid', 'head').style, 'hide', '…et les rangées de la section se cachent avec lui');

// Les RAYONS descendent jusqu'aux parties, même déviées (RADIUS_FIELDS).
const wide = CHAIN.setRowSectionField({}, 'lipid', 'general', 'sphere', 1.6);
eq(wide.lipid.head.sphere, 1.6, 'un rayon imposé par le feuillet atteint les parties de la section, déviées ou non');

// Une surface : la General d'un phospholipide la connaît, ses parties se cachent.
const surf = CHAIN.setGeneralSectionField({}, 'lipid', 'style', 'surface');
eq(surf.lipid.general.style, 'surface', 'la rangée General d’un phospholipide sait dessiner une surface');
eq(surf.lipid.tail.style, 'hide', 'les chaînes acyle, elles, passent sur Hide (partStyleUnderGeneral : rien n’est cassé)');
eq(CHAIN.effectiveSectionLook(surf, 'lipid', 'tail').style, 'hide', '…donc la section ne redessine pas par-dessus');

/* ══ 4. LE CÂBLAGE DANS LA SOURCE ════════════════════════════════════════════ */
// Les deux sauts sont NOMMÉS en un seul endroit, dans l'ordre de la demande.
has('const MEMBRANE_ROW_BELOW = {', 'le saut rangée → rangée est nommé');
has("  upper_leaflet: 'upper_headgroups',", '…le feuillet du haut remplit SES têtes de groupe');
has("  lower_leaflet: 'lower_headgroups',", '…et celui du bas les siennes');
has('const MEMBRANE_PHOSPHOLIPID_ROW = {', 'le saut rangée → sections de phospholipides aussi');
has('const MEMBRANE_IMPOSED_FIELDS = {', 'les réglages imposés sont énumérés en un seul endroit');
has("const MEMBRANE_IMPOSED_FIELDS = {\n  style: '',", '…le style y est marqué comme une COMMANDE (pas un champ)');
has('const selRowWithStyle = (from, key, token) => {', 'poser un style sur une autre rangée réutilise le geste des ticks (toggleSelStyle)');
has('const membraneRowImposes = (work, key, field, value) => {', 'le saut rangée → rangée a sa fonction (exécutée en §1)');
has('const phospholipidImposedWrite = (key, field, value) => {', 'le saut rangée → section la sienne (exécutée en §2)');
has('const phospholipidSectionIds = (catalog) => Object.keys(catalog || {})', '…avec la liste des sections de phospholipides de la barre');
has('const imposeOnPhospholipids = (key, field, value) => {', 'l’écriture dans les sections a sa propre fonction');
eq(countOf(/imposeOnPhospholipids\(key, field, value\);/g), 2,
  'les DEUX branches du geste (style · autres réglages) imposent le réglage');
has('const laid = membraneRowImposes(chained, key, field, value);',
  'le style est posé sur la rangée du bas DANS L’ÉCRITURE du geste (un seul état écrit)');
has('if (laid !== work) setSelStyles(laid);', '…et seulement si quelque chose a changé');
has('const laid = membraneRowImposes(selStylesRef.current || {}, key, field, value);',
  'les autres réglages prennent le même chemin');
has("setSectionField(id, 'lipid', 'general', write.field, write.value);",
  'chaque section de phospholipide reçoit le réglage sur SA rangée General');
has('const write = phospholipidImposedWrite(key, field, value);', '…seulement quand la hiérarchie le dit');
// RIEN NE REMONTE : la fonction qui écrit une section ne touche jamais les rangées de sélection.
const setterBody = VIEW.slice(VIEW.indexOf('const setSectionField = (id, kind, sub, field, value) => {'));
eq(setterBody.slice(0, setterBody.indexOf('};')).includes('setSelStyles'), false,
  'écrire une section ne touche JAMAIS une rangée de sélection (rien ne remonte)');
// UNE SEULE IMPLÉMENTATION : un appel par branche, et une seule définition.
eq(countOf(/membraneRowImposes\(/g), 2, 'deux appels, pas une copie de la règle du saut rangée → rangée');
eq(countOf(/phospholipidImposedWrite\(/g), 1, 'un seul appel, pas une copie de la règle du saut rangée → section');
// Le geste des DEUX barres est le seul point d'entrée (une rangée 🧫 est une rangée de sélection).
has('set: (field, value) => setSelField(key, field, value),', 'la rangée 🧫 de la fenêtre de styling passe par setSelField');
has('set: (field, value) => setSelField(s.name, field, value),', '…et la barre de gauche (les mêmes rangées, les mêmes commandes)');
// La hiérarchie est DITE sur la rangée elle-même.
has('· imposes its setting on ${MEMBRANE_ROW_BELOW[key]} and, through it, on the phospholipid sections of this bilayer',
  'l’info-bulle d’un feuillet dit ce qu’il impose, et sur quoi cela retombe');
has('· the ${MEMBRANE_SIDE_OF[key]} leaflet row imposes its setting on this row',
  '…et celle des têtes de groupe dit qui le lui impose');

/* —— Bilan —————————————————————————————————————————————————————————————— */
console.log(`_viewer_membrane_hierarchy_test.mjs — ${passed} assertions OK (feuillet → têtes de groupe → sections de phospholipides)`);




