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
     3. LA HIÉRARCHIE, celle de la règle 1 poussée trop loin : « the hierarchy of
        the styles is wrong. It was better before. If in general (which represents
        the full molecule) i put cartoon, then the subgroups must be on hide and
        only cartoon must be visualised. if after that i change the style in the
        subgroup the style must change until i change again the general. » Une
        rangée General cédait TOUS ses atomes, y compris ceux de SON PROPRE chemin :
        un ribbon / cartoon / tube est parcouru le long du Cα (voir
        generalWalkingSele), donc « General → cartoon » puis « Side chains →
        licorice » (cette rangée prend `(sidechain or .CA)`) laissait le cartoon
        SANS AUCUN Cα — le style de General disparaissait de la molécule entière au
        premier changement de sous-rangée. General ne cède donc plus les atomes que
        son propre style parcourt (le squelette N · CA · C · O d'une protéine, le
        sucre et le phosphate d'un nucléotide) : le cartoon continue de marcher la
        chaîne ENTIÈRE pendant que les chaînes latérales sont dessinées par leur
        rangée, et une sous-rangée modifiée reste modifiée jusqu'au prochain
        changement de General (règle 1b · 1f).

     4. LA CASCADE (le rapport de cette session) : « Qualsiasi modifica applicata al
        livello "General" deve forzare l'adeguamento a cascata delle sottomolecole.
        Se imposto "General" su cartoon, il backbone deve passare a cartoon e le
        sidechain a hide. Se imposto "General" su ball and stick, sia il backbone che
        le sidechain devono passare a ball and stick. » — avec les rayons (« Se
        modifico il raggio di una sfera in "General", il nuovo valore deve aggiornare
        automaticamente anche i raggi di backbone e sidechains. »), la modification
        locale qui n'atteint jamais General, et la commande suivante de General qui
        ÉCRASE les personnalisations des parties. La règle est lue dans le
        VOCABULAIRE de chaque rangée (partStyleUnderGeneral), donc elle vaut pour les
        protéines, les acides nucléiques ET les lipides. Mesurée en §5.

   Les mesures, sur le code livré (la cascade du rapport 4 est exécutée en §5) :
     §1 la HIÉRARCHIE pure (setGeneralSectionField · effectiveSectionLook ·
        rowFollowsGeneral), exécutée sur de vrais arbres de look ;
     §2 le RENDU réel (buildSectionReps), dont les sélections partent à NGL —
        c'est là que les règles « General cède ses atomes » et « jamais ceux de son
        propre chemin » se voient ou ne se voient pas.

   Les trois règles sont AUSSI écrites dans le viewer (elles y sont commentées avec
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
  sliceFn(VIEW, 'partStyleUnderGeneral'),
  sliceDecl(VIEW, 'RADIUS_FIELDS'),
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

/* 1b. UN STYLE SUR GENERAL DESCEND SUR LES PARTIES QUI PEUVENT LE DESSINER, ET MET
   LES AUTRES SUR HIDE (le rapport : « Qualsiasi modifica applicata al livello
   "General" deve forzare l'adeguamento a cascata delle sottomolecole. Se imposto
   "General" su cartoon, il backbone deve passare a cartoon e le sidechain a hide.
   Se imposto "General" su ball and stick, sia il backbone che le sidechain devono
   passare a ball and stick. »). Un ruban se parcourt le long du squelette : la
   rangée du squelette SAIT le dessiner, elle le prend donc et elle se remet à
   suivre General (son badge « ← General » le dit). Les chaînes latérales ne savent
   pas dessiner un ruban : elles passent sur Hide, sinon elles redessineraient les
   atomes que le ruban de General vient de parcourir. */
const byStyle = HIER.setGeneralSectionField({}, 'protein', 'style', 'ribbon');
eq(gen(byStyle, 'protein', 'general').style, 'ribbon', 'General prend le style choisi');
eq(gen(byStyle, 'protein', 'general').follow, false, '…et cesse de suivre qui que ce soit');
eq(gen(byStyle, 'protein', 'backbone').style, 'ribbon',
  'le squelette SAIT dessiner un ruban : il le prend (le rapport : « il backbone deve passare a cartoon »)');
eq(gen(byStyle, 'protein', 'backbone').follow, true, '…et il se REMET à suivre General — la cascade est lisible dans la barre');
ok(HIER.rowFollowsGeneral(byStyle, 'protein', 'backbone'), '…donc le badge « ← General » reste affiché sur sa rangée');
eq(eff(byStyle, 'protein', 'backbone').style, 'ribbon', '…et c’est bien ce ruban que sa rangée dessine');
eq(gen(byStyle, 'protein', 'sidechain').style, 'hide',
  'les CHAÎNES LATÉRALES ne dessinent pas de ruban : elles passent sur Hide (le rapport : « le sidechain a hide »)');
eq(gen(byStyle, 'protein', 'sidechain').follow, false, '…et elles cessent de suivre General (un suiveur serait redessiné à sa place)');
eq(eff(byStyle, 'protein', 'sidechain').style, 'hide', '…donc la rangée « Side chains » ne dessine rien');
ok(!HIER.rowFollowsGeneral(byStyle, 'protein', 'sidechain'), '…et son badge « ← General » disparaît');

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
  sliceDecl(VIEW, 'SPLINE_STYLES'),
  sliceFn(VIEW, 'nucleicGroupOf'),
  sliceDecl(VIEW, 'nucleicGroupCache'),
  sliceFn(VIEW, 'nucleicGroupIndicesIn'),
  sliceFn(VIEW, 'nucleotideGroupIndices'),
  sliceFn(VIEW, 'generalWalkingSele'),
  sliceDecl(VIEW, 'emptySelectionWarned'),
  sliceFn(VIEW, 'warnIfEmptySelection'),
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
  'return { buildSectionReps, generalWalkingSele, warnIfEmptySelection };',
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


const gen2 = (t, kind, sub) => t[kind][sub] || {};
const dump = (label, t) => {
  console.log('=== ' + label);
  scene(t).forEach((r) => console.log('    ', r.type.padEnd(10), String(r.params.sele)));
};
dump('S1 — défaut (General cartoon, backbone follow, sidechain follow)',
  tree(['cartoon', 'sstruc'], ['cartoon', 'sstruc', true], ['licorice', 'element', true]));

const ribbon = HIER.setGeneralSectionField({}, 'protein', 'style', 'ribbon');
console.log('--- état après « General → ribbon » :',
  'general=' + gen2(ribbon, 'protein', 'general').style + '/' + gen2(ribbon, 'protein', 'general').follow,
  'backbone=' + gen2(ribbon, 'protein', 'backbone').style + '/' + gen2(ribbon, 'protein', 'backbone').follow,
  'sidechain=' + gen2(ribbon, 'protein', 'sidechain').style + '/' + gen2(ribbon, 'protein', 'sidechain').follow);
dump('S2 — General → ribbon',
  tree([gen2(ribbon, 'protein', 'general').style, 'sstruc', false],
       [gen2(ribbon, 'protein', 'backbone').style, 'sstruc', gen2(ribbon, 'protein', 'backbone').follow],
       [gen2(ribbon, 'protein', 'sidechain').style, 'element', gen2(ribbon, 'protein', 'sidechain').follow]));

const hid = HIER.setGeneralSectionField({}, 'protein', 'style', 'hide');
console.log('--- état après « General → hide » :',
  'general=' + gen2(hid, 'protein', 'general').style,
  'backbone=' + gen2(hid, 'protein', 'backbone').style + '/' + gen2(hid, 'protein', 'backbone').follow,
  'sidechain=' + gen2(hid, 'protein', 'sidechain').style + '/' + gen2(hid, 'protein', 'sidechain').follow);
dump('S3 — General → hide',
  tree([gen2(hid, 'protein', 'general').style, 'sstruc', false],
       [gen2(hid, 'protein', 'backbone').style, 'sstruc', gen2(hid, 'protein', 'backbone').follow],
       [gen2(hid, 'protein', 'sidechain').style, 'element', gen2(hid, 'protein', 'sidechain').follow]));

dump('S4 — General → ribbon, puis « Backbone → tube » à la main',
  tree(['ribbon', 'sstruc', false], ['tube', 'sstruc', false], ['hide', 'element', false]));
