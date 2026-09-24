/* =========================================================================
   _viewer_general_row_test.mjs — LA RANGÉE « GENERAL » D'UNE SECTION.

   Ce que ce fichier empêche de revenir (les rapports, mot pour mot) :

     1. « there is a bug in the general style of proteins in the styling window.
        It is not working anymore. » Après « General → Tube », choisir « Backbone →
        Cartoon » faisait dessiner `:A and backbone` À CÔTÉ d'une rangée General qui
        dessinait encore `:A` — la protéine ENTIÈRE en tube de 0,5 Å. Le cartoon et
        les bâtons étaient donc dessinés À L'INTÉRIEUR d'un tube opaque qui les
        couvrait : rien ne semblait changer. Une partie qui a reçu son PROPRE style
        reçoit maintenant ses atomes (la règle des têtes de groupe, et la sélection
        `sidechain` de PyMOL).
     2. « the other molecule parts must be on hide » — mais un style choisi sur
        General mettait aussi les parties sur Hide quand ce style ÉTAIT « Hide » :
        la molécule disparaissait et le seul retour était de restyler Backbone ·
        Side chains à la main. « Hide » sur General veut dire « PLUS DE DESCRIPTION
        GÉNÉRALE », pas « molécule vide » : chaque partie reprend alors son propre
        style par défaut et redessine la molécule.

   Deux mesures, sur le code livré :
     §1 la HIÉRARCHIE pure (setGeneralSectionField · effectiveSectionLook ·
        rowFollowsGeneral), exécutée sur de vrais arbres de look ;
     §2 le RENDU réel (buildSectionReps), dont les sélections partent à NGL —
        c'est là que la règle « General cède ses atomes » se voit ou ne se voit pas.

   Les deux règles sont AUSSI écrites dans le viewer (elles y sont commentées avec
   le nom de ce fichier) : §3 vérifie le câblage, pour qu'une refonte du rendu ne
   puisse pas les perdre en silence.
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
const gone = (needle, what) => ok(!VIEW.includes(needle), `${what}\n  encore là   : ${needle}`);

/* ── Extraction : `const name = (…) => { … };`, `const name = { … };`, ──────
   `const name = … ;` (corps d'expression : les crochets sont équilibrés). */
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

/* ══ 1. LA HIÉRARCHIE, EXÉCUTÉE ═══════════════════════════════════════════════ */
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
  sliceFn(VIEW, 'setGeneralSectionField'),
  sliceFn(VIEW, 'setRowSectionField'),
  sliceDecl(VIEW, 'resetSectionRow'),
  sliceDecl(VIEW, 'resetSectionKind'),
  'return { setGeneralSectionField, setRowSectionField, resetSectionRow, resetSectionKind, effectiveSectionLook, rowFollowsGeneral, defaultLookOf, subsectionsOf };',
].join('\n'))();
const gen = (tree, kind, sub) => tree[kind][sub] || {};
const eff = (tree, kind, sub) => HIER.effectiveSectionLook(tree, kind, sub);

// 1a. Prémisse : une partie d'une molécule neuve SUIT General.
eq(eff({}, 'protein', 'sidechain').style, HIER.defaultLookOf('protein', 'sidechain').style,
  'prémisse : sans aucun choix, une partie suit General');
eq(eff({}, 'protein', 'sidechain').follow, true, '…et le dit (`follow: true`)');
ok(HIER.rowFollowsGeneral({}, 'protein', 'sidechain'), '…donc le badge « ← General » de la rangée est affiché');

// 1b. Un STYLE sur General met les parties sur Hide (une seule description de la molécule).
const byStyle = HIER.setGeneralSectionField({}, 'protein', 'style', 'ribbon');
eq(gen(byStyle, 'protein', 'general').style, 'ribbon', 'General prend le style choisi');
eq(gen(byStyle, 'protein', 'general').follow, false, '…et cesse de suivre qui que ce soit');
['backbone', 'sidechain'].forEach((sub) => {
  eq(gen(byStyle, 'protein', sub).style, 'hide', `« ${sub} » passe sur HIDE (le rapport : « must be on hide »)`);
  eq(gen(byStyle, 'protein', sub).follow, false, `…et il CESSE de suivre General (un suiveur serait redessiné à sa place)`);
  eq(eff(byStyle, 'protein', sub).style, 'hide', `…donc la rangée « ${sub} » ne dessine rien`);
});
ok(!HIER.rowFollowsGeneral(byStyle, 'protein', 'backbone'), '…et le badge « ← General » disparaît');

/* 1c. « HIDE » SUR GENERAL = « PLUS DE DESCRIPTION GÉNÉRALE », PAS « MOLÉCULE VIDE ».
   Le rapport : « there is a bug in the general style of proteins … It is not working
   anymore ». La règle exclusive de 1b emmenait `hide` avec elle : choisir « Hide » sur
   General cachait AUSSI toutes les parties, la molécule disparaissait, et le seul
   retour était de restyler Backbone · Side chains à la main. */
const hidden = HIER.setGeneralSectionField({}, 'protein', 'style', 'hide');
eq(gen(hidden, 'protein', 'general').style, 'hide', 'General cesse de décrire la molécule (« Hide »)');
['backbone', 'sidechain'].forEach((sub) => {
  eq(gen(hidden, 'protein', sub).style, HIER.defaultLookOf('protein', sub).style,
    `« ${sub} » reprend SON style par défaut au lieu d’être caché avec General`);
  eq(gen(hidden, 'protein', sub).follow, false,
    '…et ne suit plus General (qui ne dessine plus rien du tout)');
  ok(eff(hidden, 'protein', sub).style !== 'hide',
    `…donc la rangée « ${sub} » DESSINE encore la molécule`);
});
eq(eff(hidden, 'protein', 'backbone').style, 'cartoon', 'le squelette revient en cartoon');
eq(eff(hidden, 'protein', 'sidechain').style, 'licorice', 'les chaînes latérales reviennent en licorice');

// 1d. La règle est écrite UNE fois, pour les deux listes déroulantes (style · color by).
const hiddenColor = HIER.setGeneralSectionField({}, 'protein', 'colorBy', 'hide');
eq(gen(hiddenColor, 'protein', 'backbone').style, HIER.defaultLookOf('protein', 'backbone').style,
  'la même règle vaut pour « Color by » : une seule description retirée, pas une molécule vide');

// 1e. Une case qui n’est PAS une description (opacité · rayons · matériau) descend.
const soft = HIER.setGeneralSectionField({}, 'protein', 'opacity', 0.4);
['backbone', 'sidechain'].forEach((sub) => {
  eq(gen(soft, 'protein', sub).opacity, 0.4, `« ${sub} » reçoit la valeur de General (il le suit)`);
  eq(gen(soft, 'protein', sub).follow, true, '…et continue de le suivre');
});

// 1f. Une partie qui a pris la main sur SA rangée n’est plus touchée par ces cases.
const deviated = HIER.setRowSectionField(byStyle, 'protein', 'sidechain', 'style', 'licorice');
eq(gen(deviated, 'protein', 'sidechain').style, 'licorice', 'un style choisi SUR la rangée est celui de la rangée');
eq(gen(deviated, 'protein', 'sidechain').follow, false, '…et elle ne suit plus General');
const after = HIER.setGeneralSectionField(deviated, 'protein', 'opacity', 0.4);
eq(gen(after, 'protein', 'sidechain').style, 'licorice', 'une autre case de General ne la RALLUME pas');
eq(gen(after, 'protein', 'sidechain').opacity, 0,
  '…et aucune valeur ne lui est écrite (le matériau ne change que le style sélectionné)');
const reset = HIER.resetSectionRow(deviated, 'protein', 'sidechain');
eq(gen(reset, 'protein', 'sidechain').follow, true, 'le ↺ de la rangée la remet dans la hiérarchie (elle suit de nouveau)');
eq(gen(reset, 'protein', 'sidechain').style, HIER.defaultLookOf('protein', 'sidechain').style,
  '…avec son style par défaut');
eq(gen(HIER.resetSectionKind(deviated, 'protein'), 'protein', 'backbone').follow, true,
  'le ↺ de la SECTION remet toutes ses rangées dans la hiérarchie');

/* ══ 2. LE RENDU RÉEL : LES SÉLECTIONS QUI PARTENT À NGL ═════════════════════
   `buildSectionReps` est extrait du viewer et exécuté sur une fausse structure
   (`eachAtom` vide) : les sélections sont alors EXACTEMENT les clauses écrites, et
   c'est là que la règle « General cède ses atomes » se voit — ou pas. */
const SCHEME_KEYS = [
  'let elementSchemeKey = "k-element"; let residueSchemeKey = "k-residue"; let baseTypeSchemeKey = "k-base";',
  'let sstrucSchemeKey = "k-sstruc"; let sugarSchemeKey = "k-sugar"; let glycanSchemeKey = "k-glycan";',
  'let lipidClassSchemeKey = "k-lipid"; let nucleicFormSchemeKey = "k-form"; let nucleicMotifSchemeKey = "k-motif";',
  'let chargeSchemeKey = "k-charge"; let chainSchemeKey = "k-chain"; let gradientSchemeKey = "k-gradient";',
].join('\n');
const RENDER = new Function([
  sliceDecl(VIEW, 'LICORICE_BOND_RADIUS'),
  sliceDecl(VIEW, 'BALLSTICK_BOND_RADIUS'),
  sliceDecl(VIEW, 'BASE_BOND_RADIUS'),
  sliceDecl(VIEW, 'TUBE_RADIUS'),
  sliceDecl(VIEW, 'sectionOpacity'),
  sliceObject(VIEW, 'DEFAULT_ATOM_COLORS'),
  sliceObject(VIEW, 'KIND_CATEGORY'),
  sliceDecl(VIEW, 'DEFAULT_ELEMENT_COLOR'),
  sliceObject(VIEW, 'STYLES'),
  sliceObject(VIEW, 'COLORS'),
  sliceObject(VIEW, 'SECTION_SUBSECTIONS'),
  sliceDecl(VIEW, 'subsectionsOf'),
  sliceDecl(VIEW, 'subsectionSpec'),
  sliceFn(VIEW, 'defaultLookOf'),
  sliceFn(VIEW, 'effectiveSectionLook'),
  sliceDecl(VIEW, 'ATOM_DRAW_STYLES'),
  sliceFn(VIEW, 'sectionRowSele'),
  sliceFn(VIEW, 'atomIndicesForSele'),
  sliceDecl(VIEW, 'moleculeIndexCache'),
  sliceFn(VIEW, 'moleculeIndicesOf'),
  sliceDecl(VIEW, 'indexSele'),
  sliceFn(VIEW, 'bridgeAtomIndices'),
  sliceDecl(VIEW, 'schemeParam'),
  sliceFn(VIEW, 'sectionColorParams'),
  sliceFn(VIEW, 'sectionStyleReps'),
  SCHEME_KEYS,
  'const espColorParams = () => ({ colorScheme: "esp" });',
  'const flagMeshShadows = () => {};',
  'const nucleicRingPlates = () => null;',
  'const DEFAULT_NUCLEIC_COLORS = { base: 0xffffff, sugar: 0xffffff, phosphate: 0xffffff };',
  'const gradientRangesFor = () => null;',
  'const gradientColorStore = { ranges: null };',
  sliceFn(VIEW, 'buildSectionReps'),
  'return { buildSectionReps };',
].join('\n'))();
const SECTIONS = [{ id: 'main::protein|A', key: 'protein|A', kind: 'protein', name: 'Chain A', sele: ':A and protein', count: 1 }];
// Un look de rangée, tel que la barre de style l'écrit.
const look = (style, colorBy, follow) => ({ style, colorBy, solidColor: 0xffffff, opacity: 0, sphere: 1, bond: 1, follow });
const tree = (g, b, s) => ({ protein: { general: look(g[0], g[1], false), backbone: look(b[0], b[1], b[2]), sidechain: look(s[0], s[1], s[2]) } });
const scene = (t) => {
  const out = [];
  const comp = {
    structure: { eachAtom: () => {} },
    addRepresentation(type, params) { const rep = { type, params }; out.push(rep); return rep; },
  };
  RENDER.buildSectionReps(comp, SECTIONS, { 'main::protein|A': t }, {});
  return out;
};
const sels = (t) => scene(t).map((r) => r.params.sele);

// 2a. LE DESSIN PAR DÉFAUT NE BOUGE PAS D’UN CARACTÈRE : General cartoon, et les deux
//     rangées qui le SUIVENT ne lui retirent rien (elles n'ont pas de style propre).
const dflt = sels(tree(['cartoon', 'sstruc'], ['cartoon', 'sstruc', true], ['licorice', 'element', true]));
eq(dflt.filter((s) => s === ':A and protein').length, 1,
  'la rangée General dessine la molécule ENTIÈRE, une seule fois (le cartoon marche la chaîne)');
ok(dflt.every((s) => !String(s).includes('not (')),
  '…et aucune rangée qui SUIT General ne lui retire d’atomes (le défaut d’une molécule est intact)');
ok(scene(tree(['cartoon', 'sstruc'], ['cartoon', 'sstruc', true], ['licorice', 'element', true]))
  .some((r) => r.type === 'cartoon' && r.params.sele === ':A and protein'),
  '…c’est bien le cartoon de General qui la dessine');

/* 2b. UNE PARTIE QUI A SON PROPRE STYLE REÇOIT SES ATOMS.
   L'ORDRE DU RAPPORT : « General → Tube », puis « Backbone → Cartoon ». Le tube de
   General couvrait le cartoon (« le style general des protéines ne marche plus »). */
const dev = sels(tree(['tube', 'sstruc'], ['cartoon', 'sstruc', false], ['licorice', 'element', false]));
ok(!dev.includes(':A and protein'),
  'le calque opaque de General ne dessine plus la molécule ENTIÈRE (il ne couvre plus les parties)');
ok(dev.includes(':A and protein and not (:A and protein and backbone) and not (:A and protein and (sidechain or .CA))'),
  '…il CÈDE les atomes des deux parties qui ont leur propre style (le squelette ET ses chaînes latérales)');
ok(dev.includes(':A and protein and backbone'), '…le cartoon du squelette dessine donc son squelette, et on le VOIT');
ok(dev.includes(':A and protein and (sidechain or .CA)'), '…et les chaînes latérales dessinent les leurs, CA compris');
eq(dev.filter((s) => s === ':A and protein and (sidechain or .CA)').length, 1,
  '…une seule rangée dessine ces atomes (aucun atome dessiné deux fois)');
eq(dev.filter((s) => String(s).includes('not (')).length, 1,
  '…et UNE seule rangée cède ses atomes (celle de General)');

// 2c. Une partie CACHÉE ne reçoit rien : elle ne dessine aucun atome, donc elle n'en
//     prend pas non plus à General.
const hid = sels(tree(['tube', 'sstruc'], ['hide', 'sstruc', false], ['licorice', 'element', false]));
ok(hid.includes(':A and protein and not (:A and protein and (sidechain or .CA))'),
  'seule la partie qui DESSINE retire ses atomes de General');
ok(!hid.includes(':A and protein and backbone'), '…la partie cachée ne dessine rien du tout');
eq(hid.filter((s) => String(s).includes('backbone')).length, 0,
  '…aucune représentation ne part pour elle (une rangée cachée n’en produit aucune)');

/* 2d. Après « General → Hide » (1c), la molécule est REDESSINÉE par ses parties : le
   MÊME arbre que celui de 1c, passé au rendu. Avant le correctif, les deux parties
   étaient elles aussi sur Hide et la scène était VIDE. */
const afterHide = HIER.setGeneralSectionField({}, 'protein', 'style', 'hide');
const redrawn = sels(tree(
  [gen(afterHide, 'protein', 'general').style, 'sstruc'],
  [gen(afterHide, 'protein', 'backbone').style, 'sstruc', false],
  [gen(afterHide, 'protein', 'sidechain').style, 'element', false],
));
ok(redrawn.length > 0, 'après « Hide » sur General, la protéine est encore dessinée (elle n’est plus vide)');
ok(redrawn.includes(':A and protein and backbone'), '…par la rangée du squelette, en cartoon');
ok(redrawn.includes(':A and protein and (sidechain or .CA)'), '…et par celle des chaînes latérales, en licorice');
ok(!redrawn.includes(':A and protein'), '…et AUCUNE rangée ne décrit plus la molécule entière (General se tait)');

/* ══ 3. LE CÂBLAGE : LES DEUX RÈGLES SONT DANS LA SOURCE ════════════════════ */
has("if (value === 'hide') { next.style = defaultLookOf(kind, s.sub).style; next.follow = false; }",
  'la source dit « Hide sur General → chaque partie reprend son style par défaut »');
has(".filter(({ look }) => !!look && look.style !== 'hide' && look.follow === false)",
  'une partie ne reçoit ses atomes que si elle a un style PROPRE (follow: false) ET dessine');
has('const rowOpts = (style) => ({ anchorSideChains, backboneLosesCa, anchorParts: ATOM_DRAW_STYLES.includes(style) });',
  '…avec les mêmes drapeaux d’ancre que la rangée qui les reçoit');
has('const generalOnly = relinquished.length',
  'la rangée General ne devient exclusive que s’il y a des atomes à céder');
has("const sele = spec.sub === 'general' && generalOnly",
  '…et c’est la SEULE rangée dont la sélection est remplacée par cette clause');

console.log(`_viewer_general_row_test.mjs — ${passed} assertions OK (hiérarchie + rangée General exécutée)`);
