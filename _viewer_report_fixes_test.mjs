/* =========================================================================
   _viewer_report_fixes_test.mjs — LES CINQ DÉFAUTS DU RAPPORT SUR LE VIEWER.

   Ce que ce fichier empêche de revenir (le rapport, mot pour mot) :

     1. « i have this writing in the middle of the viewer » — l'en-tête de §2
        était écrit comme un commentaire de bloc NU entre deux éléments JSX : JSX
        n'y voit pas un commentaire mais du TEXTE, donc tout le paragraphe était
        dessiné au milieu du viewer, suivi d'un `[object Object]` laissé par une
        retouche outillée. Un commentaire JSX, lui, s'écrit ENTRE ACCOLADES.
     2. « rainbow does not color » — la rangée demandait `colorScheme: 'rainbow'`.
        NGL 2.4 n'a AUCUN colorMaker « rainbow » (vérifié ici sur la bibliothèque
        INSTALLÉE) : « rainbow » est une ÉCHELLE de couleurs. La demande faisait
        donc jeter NGL dans addRepresentation et la rangée ne dessinait RIEN. Le
        rainbow par résidu EST `residueindex`, dont l'échelle par défaut est
        justement « rainbow ».
     3. « impossible to change the colors of first and last » — les deux extrémités
        du dégradé sont UN seul schéma NGL, donc UNE paire pour tout le viewer :
        elle était posée catégorie par catégorie, et un `ovr.gradientFrom` laissé
        par l'ancien menu §2 faisait qu'`applyGeneralField` IGNORAIT la catégorie de
        référence — les pastilles ne changeaient plus rien. `setGradientPairIn` écrit
        la paire dans TOUTES les catégories, les pastilles existent aussi dans la
        rangée de la barre (là où « Gradient (first → last) » se choisit), et la
        paire entre dans `styleSignature` pour que la scène soit vraiment redessinée.
     4. « in ball and sticks or licorice the side chains are not attached to the
        backbone » — NGL ne dessine une liaison que si SES DEUX atomes sont dans la
        sélection, et son mot-clé `sidechain` EXCLUT le CA dont la chaîne latérale
        pend : le CB–CA n'était jamais dessiné. Quand le squelette ET les chaînes
        latérales sont dessinés en atomes, le CA appartient maintenant à la rangée
        « Side chains » et quitte celle du squelette (aucun atome dessiné deux fois).
     5. « renumber key does not do anything nor show specifications » — `residueInfo`
        n'était rempli que par un effet, le panneau n'était rendu que si la liste
        était non vide, il vivait dans §2 seul (le 🔢 de la barre ne pouvait donc
        rien montrer), et `renumberMap` n'était lu que par la liste des atomes : une
        renumérotation ne changeait RIEN de visible. Le panneau se refait désormais
        sa liste à la demande, il est rendu là où le bouton est, et la renumérotation
        atteint les étiquettes 3D et la bande des résidus.

   Le viewer est un .jsx : ses aides sont EXTRAITS du fichier puis EXÉCUTÉS (comme
   _viewer_rings_gradient_test.mjs), et les faits NGL sont vérifiés sur la
   bibliothèque installée (NGL 2.4.0, exactement celle que la page charge).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const NGL = require('ngl');

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};

// VIEWER_SRC permet de rejouer la suite sur une version d'avant les correctifs
// (elle doit alors ÊTRE ROUGE — c'est ainsi que chaque défaut a été reproduit).
const SRC = process.env.VIEWER_SRC || new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url);
const VIEW = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
const gone = (needle, what) => ok(!VIEW.includes(needle), `${what}\n  encore présent : ${needle}`);

/* ── Extraction : `const name = (…) => { … };`, `const name = { … };`, ───────
   `const name = … ;` (corps d'expression : les crochets sont équilibrés). */
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
// Les clés des schémas maison : `null` = « pas de schéma maison », le cas que le
// repli de sectionColorParams doit encaisser.
const SCHEME_KEYS = 'let baseTypeSchemeKey = null, residueSchemeKey = null, chargeSchemeKey = null,'
  + ' sstrucSchemeKey = null, elementSchemeKey = null, sugarSchemeKey = null,'
  + ' lipidClassSchemeKey = null, nucleicFormSchemeKey = null, gradientSchemeKey = null;';

/* ══ 1. LE PARAGRAPHE AU MILIEU DU VIEWER ══════════════════════════════════ */
gone('[object Object]', 'le `[object Object]` laissé au milieu de §2 a disparu');
has('{/* ══ 2 · THE VIEWER TOOLS OF §2', "l'en-tête de §2 est un VRAI commentaire JSX (accolades ouvertes)");
// Le paragraphe n'est plus du texte : sa première phrase ne peut plus être
// dessinée QUE par le commentaire — donc elle est précédée de `{/*`.
has('{/* ══ 2 · THE VIEWER TOOLS OF §2 ═════════════════════════════════════════════\n   The styling itself is NOT here any more',
  'le paragraphe de §2 est DANS les accolades du commentaire (sinon JSX le dessine)');

/* ══ 2. « RAINBOW (first → last) » PEINT VRAIMENT ═════════════════════════ */
const schemes = Object.keys(NGL.ColormakerRegistry.getSchemes());
const scales = Object.keys(NGL.ColormakerRegistry.getScales());
ok(schemes.includes('residueindex'), 'NGL connaît le colorMaker « residueindex »');
ok(!schemes.includes('rainbow'), 'NGL n’a AUCUN colorMaker « rainbow » — la valeur d’avant faisait jeter NGL');
ok(scales.includes('rainbow'), '« rainbow » est une ÉCHELLE de couleurs de NGL (elle, elle existe)');
gone("case 'rainbow': return { colorScheme: 'rainbow' };", 'la rangée ne demande plus un colorMaker qui n’existe pas');
has("case 'rainbow': return { colorScheme: 'residueindex', colorScale: 'rainbow' };",
  'elle demande le colorMaker « residueindex » avec l’échelle « rainbow »');
const COLOR_H = new Function([
  sliceDecl(VIEW, 'schemeParam'),
  SCHEME_KEYS,
  sliceObject(VIEW, 'DEFAULT_ATOM_COLORS'),
  sliceObject(VIEW, 'KIND_CATEGORY'),
  sliceDecl(VIEW, 'DEFAULT_ELEMENT_COLOR'),
  "const espColorParams = () => ({ colorScheme: 'esp', colorDomain: [-50, 50] });",
  sliceFn(VIEW, 'sectionColorParams'),
  'return { sectionColorParams };',
].join('\n'))();
eq(COLOR_H.sectionColorParams({ colorBy: 'rainbow' }, 'protein'),
  { colorScheme: 'residueindex', colorScale: 'rainbow' },
  'le rainbow par résidu demande « residueindex » AVEC l’échelle « rainbow »');
eq(COLOR_H.sectionColorParams({ colorBy: 'hydrophobicity' }, 'protein'),
  { colorScheme: 'hydrophobicity' }, 'les autres métaphores NGL restent inchangées');
eq(COLOR_H.sectionColorParams({ colorBy: 'element' }, 'protein'),
  { colorScheme: 'element' }, '…et un schéma maison absent retombe sur « element »');

/* ══ 3. LES DEUX COULEURS « first → last » (LE DÉGRADÉ) ═══════════════════ */
const LOOK_H = new Function([
  sliceObject(VIEW, 'DEFAULT_LOOK_OVERRIDES'),
  sliceDecl(VIEW, 'CAT_STYLE_CATS'),
  sliceFn(VIEW, 'overridesLook'),
  sliceFn(VIEW, 'applyGeneralField'),
  sliceFn(VIEW, 'setGradientPairIn'),
  'return { applyGeneralField, setGradientPairIn };',
].join('\n'))();
// Une catégorie qui OVERRIDE le champ : c'est l'état que l'ancien menu §2 laissait
// derrière lui, et c'est lui qui rendait les pastilles « first → last » mortes.
const CAT_STYLES = {
  protein: { gradientFrom: 0xff0000, gradientTo: 0x0000ff, ovr: { gradientFrom: true } },
  nucleic: { gradientFrom: 0xff0000, gradientTo: 0x0000ff },
};
// Le canari : la route d'avant (un champ général) SAUTE la catégorie qui l'override.
eq(LOOK_H.applyGeneralField(CAT_STYLES, 'gradientFrom', 0x00ff00).protein.gradientFrom, 0xff0000,
  'canari : applyGeneralField n’atteint pas une catégorie qui override le champ — le bug d’origine');
const AFTER = LOOK_H.setGradientPairIn(CAT_STYLES, 'gradientFrom', 0x00ff00);
eq(AFTER.protein.gradientFrom, 0x00ff00, 'setGradientPairIn atteint la catégorie de référence qui override');
eq(AFTER.nucleic.gradientFrom, 0x00ff00, '…et toutes les autres avec elle');
eq(CAT_STYLES.protein.gradientFrom, 0xff0000, 'la table d’entrée n’est jamais modifiée en place');
has('setCatStyles((prev) => setGradientPairIn(prev, key, hex));', 'les pastilles écrivent la paire par setGradientPairIn');
has('const gradientRampSignature =', 'la paire du dégradé entre dans la signature du style');
has('|ramp:${gradientRampSignature}`;', '…donc une pastille fait REBÂTIR les représentations (sinon rien ne se repeint)');
has("title=\"Colour of the FIRST residue of every chain (N terminus · 5' end)\"",
  'les deux pastilles existent aussi dans la RANGÉE de la barre, là où le dégradé se choisit');
has('<button type="button" onClick={swapGeneralGradient}', 'le ⇄ de la rangée inverse la paire globale');
gone("setCatStyle(cat, 'gradientFrom'", 'plus aucun swatch n’écrit une paire PAR CATÉGORIE (dont un seul était lu)');

/* ══ 4. LES CHAÎNES LATÉRALES SONT ATTACHÉES AU SQUELETTE ═════════════════ */
const ROW_H = new Function([sliceFn(VIEW, 'sectionRowSele'), 'return { sectionRowSele };'].join('\n'))();
const PROTEIN = { kind: 'protein', sele: ':A and protein' };
// Sans ancre (un squelette en ruban) : rien ne change.
eq(ROW_H.sectionRowSele(null, PROTEIN, 'sidechain'), ':A and protein and sidechain',
  'sans ancre, la rangée des chaînes latérales garde sa sélection d’origine');
eq(ROW_H.sectionRowSele(null, PROTEIN, 'backbone'), ':A and protein and backbone',
  '…et celle du squelette aussi');
// Avec ancre : le CA rejoint les chaînes latérales et QUITTE le squelette.
eq(ROW_H.sectionRowSele(null, PROTEIN, 'sidechain', { anchorSideChains: true }), ':A and protein and (sidechain or .CA)',
  'le CA est DANS la sélection des chaînes latérales : la liaison CB–CA est donc dessinée');
eq(ROW_H.sectionRowSele(null, PROTEIN, 'backbone', { anchorSideChains: true }), ':A and protein and backbone and not .CA',
  '…et il quitte celle du squelette : aucun atome n’est dessiné deux fois');
const ATOM_STYLES = new Function([sliceDecl(VIEW, 'ATOM_DRAW_STYLES'), 'return { ATOM_DRAW_STYLES };'].join('\n'))().ATOM_DRAW_STYLES;
eq([...ATOM_STYLES].sort(), ['ball+stick', 'licorice', 'line', 'spacefill'].sort(),
  'l’ancre vaut pour les quatre styles qui dessinent des ATOMES');
ok(!ATOM_STYLES.includes('cartoon') && !ATOM_STYLES.includes('ribbon') && !ATOM_STYLES.includes('tube'),
  'un squelette en ruban n’est jamais amputé de ses CA');

// ── Le rendu RÉEL : les rangées d'une protéine, telles qu'elles partent à NGL ──
const RENDER_H = new Function([
  sliceDecl(VIEW, 'LICORICE_BOND_RADIUS'),
  sliceDecl(VIEW, 'BALLSTICK_BOND_RADIUS'),
  sliceDecl(VIEW, 'BASE_BOND_RADIUS'),
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
const rowTree = (backbone, sidechain) => ({
  protein: {
    general: { style: 'cartoon', colorBy: 'sstruc', solidColor: 0xffffff, opacity: 0, sphere: 1, bond: 1, follow: false },
    backbone: { style: backbone, colorBy: 'element', solidColor: 0xffffff, opacity: 0, sphere: 1, bond: 1, follow: false },
    sidechain: { style: sidechain, colorBy: 'element', solidColor: 0xffffff, opacity: 0, sphere: 1, bond: 1, follow: false },
  },
});
const renderWith = (backbone, sidechain) => {
  const scene = [];
  const comp = {
    structure: { eachAtom: () => {} },
    addRepresentation(type, params) { const rep = { type, params }; scene.push(rep); return rep; },
  };
  RENDER_H.buildSectionReps(comp, SECTIONS, { 'main::protein|A': rowTree(backbone, sidechain) }, {});
  return scene;
};
const atomSels = renderWith('licorice', 'ball+stick').map((r) => r.params.sele);
ok(atomSels.includes(':A and protein and (sidechain or .CA)'), 'la rangée des chaînes latérales dessine le CA');
ok(atomSels.includes(':A and protein and backbone and not .CA'), 'la rangée du squelette ne le redessine pas');
ok(!atomSels.includes(':A and protein and sidechain'), 'la sélection FLOTTANTE (sans CA) n’est plus produite');
eq(atomSels.filter((s) => String(s).includes('.CA') && !String(s).includes('not .CA')).length, 1,
  'le CA est DESSINÉ par une seule rangée (« not .CA » l’exclut, ce n’est pas un second dessin)');
const ribbonSels = renderWith('cartoon', 'licorice').map((r) => r.params.sele);
ok(ribbonSels.includes(':A and protein and backbone'), 'un squelette en ruban garde sa sélection complète');
ok(ribbonSels.includes(':A and protein and sidechain'), '…et ses chaînes latérales gardent la leur');
ok(!ribbonSels.some((s) => String(s).includes('.CA')), 'aucun CA n’est ajouté sous un ruban');
has("const anchorSideChains = sec.kind === 'protein'", 'le rendu décide l’ancre d’après les DEUX looks de la section');

/* ══ 5. LE 🔢 RENUMÉROTATION : LE PANNEAU S'OUVRE, ET IL SERT À QUELQUE CHOSE ═ */
const RES_H = new Function([sliceFn(VIEW, 'collectResidues'), 'return { collectResidues };'].join('\n'))();
const atomsOf = (list) => ({ eachAtom: (cb) => { list.forEach(cb); } });
eq(RES_H.collectResidues(atomsOf([
  { resno: 5, resname: 'ALA', index: 0 }, { resno: 5, resname: 'ALA', index: 1 },
  { resno: 6, resname: 'GLY', index: 2 }, { resno: 7, resname: 'SER', index: 3 },
])),
[{ resno: 5, resname: 'ALA', count: 2 }, { resno: 6, resname: 'GLY', count: 1 }, { resno: 7, resname: 'SER', count: 1 }],
'la liste des résidus est celle, ordonnée, de la structure (une entrée par résidu, avec son compte d’atomes)');
eq(RES_H.collectResidues(null), [], 'sans structure : aucune ligne (le panneau le DIT au lieu de rester muet)');
eq(RES_H.collectResidues({}), [], 'une structure sans eachAtom ne fait pas planter le panneau');
eq(RES_H.collectResidues({ eachAtom: () => { throw new Error('nope'); } }), [], 'une structure illisible non plus');
// Le panneau ne peut plus rester vide, et il est rendu LÀ OÙ LE BOUTON EST.
has('const list = residueInfo.length ? residueInfo : ensureResidueInfo();', 'le panneau se refait sa liste à la demande');
has('const toggleRenumberPanel = () => {\n  ensureResidueInfo();', 'le bouton 🔢 remplit la liste AVANT d’ouvrir');
has('onClick={toggleRenumberPanel}', 'les deux 🔢 (barre + §2) ouvrent le MÊME panneau');
eq(VIEW.split('{renderRenumberPanel()}').length - 1, 2, 'le panneau est rendu dans la barre ET dans §2');
gone('{showRenumberPanel && residueInfo.length > 0 && (', 'le rendu qui restait vide quand la liste l’était a disparu');
// La renumérotation est VISIBLE : étiquettes 3D + bande des résidus.
has('renumberOf: displayResno,', 'les étiquettes 3D suivent la renumérotation');
has("const shownResno = typeof renumberOf === 'function' ? renumberOf(entry.resno) : entry.resno;",
  '…et build3dLabelMap lit vraiment le renumérotage');
has('moleculeType, JSON.stringify(renumberMap)]);', 'une renumérotation redessine les étiquettes (dépendance de l’effet)');
has('<span className="text-[6px] font-bold text-slate-400 leading-none">{displayResno(r.resno)}</span>',
  'la bande des résidus affiche le numéro renuméroté');
has('const next = {};\n  list.forEach((r, i) => { next[String(r.resno)] = start + i; });',
  '« Renumber from » numérote la liste — celle de l’état, ou celle lue à la demande');

console.log(`_viewer_report_fixes_test.mjs — ${passed} assertions OK`);




