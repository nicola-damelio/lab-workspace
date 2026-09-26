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
     2. « the other molecule parts must be on hide » — ET « HIDE » SUR GENERAL AUSSI.
        Le premier correctif de ce rapport mettait les parties sur Hide quand General
        disait « Hide » : la molécule disparaissait et le seul retour était de restyler
        Backbone · Side chains à la main. Le suivant en a fait l'inverse — chaque
        partie reprenait son propre style par défaut — et une protéine « cachée »
        restait donc à l'écran en cartoon + licorice : c'est le rapport de cette
        session, « adesso quando general é su hide, si attivano backbone e sidechain
        che invece dovrebbero essere entrambi su hide ». « Hide » redescend donc sur
        les parties, qui restent DANS la hiérarchie (`follow: true`, leur badge dit
        que c'est General qui les cache) ; la molécule n'est jamais perdue pour
        autant : le ✔ de son en-tête, un style sur N'IMPORTE quelle rangée ou le ↺
        d'une rangée la ramènent (règles 1c · 1d).
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

/* 1c. « HIDE » SUR GENERAL DESCEND SUR LES PARTIES — LE RAPPORT DE CETTE SESSION :
   « adesso quando general é su hide, si attivano backbone e sidechain che invece
   dovrebbero essere entrambi su hide ». Chaque rangée connaît « Hide » (toutes les
   listes de styles l'ont), donc la cascade de 1b cache AUSSI les parties : la rangée
   du haut cesse de décrire la molécule ET celles du bas cessent de la dessiner —
   c'est ce que « the whole molecule is hidden » veut dire. Le rapport PRÉCÉDENT
   (« there is a bug in the general style of proteins … It is not working anymore »)
   avait fait de « Hide » l'exception (chaque partie reprenait son propre style par
   défaut), et une protéine « cachée » restait donc à l'écran en cartoon + licorice :
   c'est exactement ce que ce rapport-ci décrit. La molécule n'est jamais perdue pour
   autant — le ✔ de son en-tête la redessine, un style choisi sur N'IMPORTE quelle
   rangée ramène sa partie, et le ↺ d'une rangée / de la section remet les défauts. */
const hidden = HIER.setGeneralSectionField({}, 'protein', 'style', 'hide');
eq(gen(hidden, 'protein', 'general').style, 'hide', 'General cesse de décrire la molécule (« Hide »)');
['backbone', 'sidechain'].forEach((sub) => {
  eq(gen(hidden, 'protein', sub).style, 'hide',
    `« ${sub} » est caché AVEC General (le rapport : « dovrebbero essere entrambi su hide »)`);
  eq(gen(hidden, 'protein', sub).follow, true,
    '…et il continue de le suivre : le badge dit que c’est GENERAL qui l’a caché');
  eq(eff(hidden, 'protein', sub).style, 'hide',
    `…donc la rangée « ${sub} » ne dessine RIEN`);
});
// …et la molécule revient : General qui redessine, ou UNE rangée ramenée à la main.
const backFromHide = HIER.setGeneralSectionField(hidden, 'protein', 'style', 'cartoon');
eq(gen(backFromHide, 'protein', 'backbone').style, 'cartoon',
  'un nouveau style sur General rallume le squelette (la cascade vaut à chaque fois)');
const oneBack = HIER.setRowSectionField(hidden, 'protein', 'sidechain', 'style', 'licorice');
eq(eff(oneBack, 'protein', 'sidechain').style, 'licorice',
  '…et le style choisi sur une rangée cachée la ramène (le chemin de retour existe toujours)');

// 1d. « Color by » sur General, lui, reste EXCLUSIF : une seule description à la fois.
const hiddenColor = HIER.setGeneralSectionField({}, 'protein', 'colorBy', 'element');
['backbone', 'sidechain'].forEach((sub) => eq(gen(hiddenColor, 'protein', sub).style, 'hide',
  `« ${sub} » passe sur Hide quand General prend une coloration (une seule description)`));

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

/* 2b. UNE PARTIE QUI A SON PROPRE STYLE REÇOIT SES ATOMS — SAUF CEUX QUE LE STYLE DE
   GENERAL PARCOURT (règle 3 : sans eux, le tube / cartoon de General disparaissait de
   la molécule entière). L'ORDRE DU RAPPORT : « General → Tube », puis « Backbone →
   Cartoon ».
   Le squelette d'une protéine a un mot dans NGL (`backbone` = N · CA · C · O, le CA
   que le ruban parcourt) : il est donc protégé NOMMÉMENT, et la clause produite reste
   une clause NGL valable — `(… and backbone) and not backbone` ne retire rien. */
const dev = sels(tree(['tube', 'sstruc'], ['cartoon', 'sstruc', false], ['licorice', 'element', false]));
ok(!dev.includes(':A and protein'),
  'le calque de General ne dessine plus la molécule ENTIÈRE (il ne couvre plus les parties)');
eq(dev.filter((s) => String(s).includes('not (')).length, 1,
  '…et UNE seule rangée cède ses atomes (celle de General)');
const devGen = dev.find((s) => String(s).includes('not ('));
ok(devGen.indexOf(':A and protein and not ((:A and protein and backbone) and not backbone)') === 0,
  '…elle cède le squelette à la rangée du squelette — en GARDANT les atomes de son propre chemin');
ok(devGen.includes('and not ((:A and protein and (sidechain or .CA)) and not backbone)'),
  '…et les chaînes latérales (CA compris) à la leur, sauf ce chemin aussi');
ok(!devGen.includes('and not (:A and protein and backbone)'),
  'le squelette n’est plus retiré NU à General : son cartoon garde son chemin (c’était la règle 3)');
ok(dev.includes(':A and protein and backbone'), '…le cartoon du squelette dessine donc son squelette, et on le VOIT');
ok(dev.includes(':A and protein and (sidechain or .CA)'), '…et les chaînes latérales dessinent les leurs, CA compris');
eq(dev.filter((s) => s === ':A and protein and (sidechain or .CA)').length, 1,
  '…une seule rangée dessine ces atomes (aucun atome dessiné deux fois)');

// 2c. Une partie CACHÉE ne reçoit rien : elle ne dessine aucun atome, donc elle n'en
//     prend pas non plus à General.
const hid = sels(tree(['tube', 'sstruc'], ['hide', 'sstruc', false], ['licorice', 'element', false]));
ok(hid.includes(':A and protein and not ((:A and protein and (sidechain or .CA)) and not backbone)'),
  'seule la partie qui DESSINE retire ses atomes de General');
ok(!hid.includes(':A and protein and backbone'), '…la partie cachée ne dessine rien du tout');
eq(hid.filter((s) => s === ':A and protein and backbone').length, 0,
  '…aucune représentation ne part pour elle (une rangée cachée n’en produit aucune)');
ok(hid.some((s) => String(s).endsWith('and not backbone)')),
  '…et le chemin de General (le squelette) lui reste, quoi qu’il arrive');

/* 2d. Après « General → Hide » (1c), RIEN n'est dessiné : c'est la demande de cette
   session — « quando general é su hide, si attivano backbone e sidechain che invece
   dovrebbero essere entrambi su hide ». La molécule revient dès qu'un style est
   choisi, sur General (la rangée entière) ou sur une partie (1c). */
const afterHide = HIER.setGeneralSectionField({}, 'protein', 'style', 'hide');
const hiddenScene = sels(tree(
  [gen(afterHide, 'protein', 'general').style, 'sstruc', false],
  [gen(afterHide, 'protein', 'backbone').style, 'sstruc', gen(afterHide, 'protein', 'backbone').follow],
  [gen(afterHide, 'protein', 'sidechain').style, 'element', gen(afterHide, 'protein', 'sidechain').follow],
));
eq(hiddenScene, [], 'après « Hide » sur General, AUCUNE représentation ne part (les parties sont cachées avec lui)');
const redrawn = sels(tree(['cartoon', 'sstruc', false], ['cartoon', 'sstruc', true], ['hide', 'element', false]));
ok(redrawn.includes(':A and protein'), '…et un nouveau style sur General redessine la molécule entière');
ok(redrawn.includes(':A and protein and backbone'), '…le squelette suivant General comme avant');

/* 2e. LA HIÉRARCHIE DU RAPPORT, ÉTAPE PAR ÉTAPE — c'est LA demande :
   « if in general i put cartoon, then the subgroups must be on hide … if after that i
     change the style in the subgroup the style must change until i change again the
     general. »
   1. « General → cartoon » : le squelette prend le cartoon (il sait le dessiner, 1b)
      et les chaînes latérales passent sur Hide — une seule description du squelette,
      celle de General.
   2. « Side chains → licorice » (1f) : les chaînes latérales se dessinent VRAIMENT — et
      le cartoon de General est TOUJOURS là, il marche encore la chaîne entière. C'est
      ce que la règle 3 protège : avant, la rangée des chaînes latérales emportait
      `(sidechain or .CA)`, donc TOUS les Cα, et le cartoon de la molécule entière
      disparaissait au premier réglage d'une sous-rangée.
   3. « General → ribbon » (1b) : les deux parties repassent sous General — le
      squelette reprend le ruban, et les chaînes latérales (qui viennent de dévier)
      sont remises sur Hide : la modification d'une sous-rangée ne survit pas à un
      changement de General. */
const step1 = HIER.setGeneralSectionField({}, 'protein', 'style', 'cartoon');
eq(gen(step1, 'protein', 'sidechain').style, 'hide', 'étape 1 : « General → cartoon » met les chaînes latérales sur Hide');
eq(eff(step1, 'protein', 'sidechain').style, 'hide', '…donc seul le cartoon dessine les atomes qu’elles auraient dessinés');
eq(gen(step1, 'protein', 'backbone').style, 'cartoon',
  '…pendant que le squelette PREND le cartoon (il sait le dessiner — la cascade)');
eq(eff(step1, 'protein', 'backbone').style, 'cartoon', '…et c’est le cartoon de General qui marche la chaîne');
const step2 = HIER.setRowSectionField(step1, 'protein', 'sidechain', 'style', 'licorice');
eq(gen(step2, 'protein', 'sidechain').style, 'licorice', 'étape 2 : la sous-rangée choisie prend SON style');
eq(gen(step2, 'protein', 'backbone').style, 'cartoon',
  '…et le squelette garde ce que General lui a donné (il le suit toujours)');
eq(gen(step2, 'protein', 'general').style, 'cartoon', '…General, lui, n’a pas bougé d’un pouce');
const stepScene = scene(tree(['cartoon', 'sstruc'], ['hide', 'sstruc', false], ['licorice', 'element', false]));
const stepCartoon = stepScene.find((r) => r.type === 'cartoon');
ok(!!stepCartoon, '…le cartoon de General est TOUJOURS dessiné (il ne disparaît plus)');
ok(String(stepCartoon.params.sele).endsWith('and not backbone)'),
  '…en GARDANT le squelette qu’il parcourt (sans lui il ne dessine plus rien du tout)');
ok(stepScene.some((r) => r.type === 'licorice' && r.params.sele === ':A and protein and (sidechain or .CA)'),
  '…et les chaînes latérales se dessinent vraiment, CA compris');
eq(gen(HIER.setGeneralSectionField(step2, 'protein', 'style', 'ribbon'), 'protein', 'sidechain').style, 'hide',
  'étape 3 : un NOUVEAU style sur General remet la sous-rangée sur Hide (la règle 1b vaut à chaque fois)');

/* 2f. LA RÈGLE ELLE-MÊME, HORS DU RENDU : generalWalkingSele. Un squelette pour une
   protéine ; RIEN pour un style qui dessine les atomes (il peut tout céder) ; RIEN pour
   un lipide (aucun chemin) ; et RIEN quand la structure n'a pas d'atome lisible — la
   règle ne casse jamais un rendu, elle protège au pire trop peu. */
const fake = { eachAtom: () => {} };
['cartoon', 'ribbon', 'tube', 'trace'].forEach((st) => {
  eq(RENDER.generalWalkingSele(fake, SECTIONS[0], st), 'backbone',
    `« ${st} » : General garde le squelette de la protéine (N · CA · C · O)`);
});
['hide', 'licorice', 'ball+stick', 'spacefill', 'surface'].forEach((st) => {
  eq(RENDER.generalWalkingSele(fake, SECTIONS[0], st), '',
    `« ${st} » : un style qui dessine les atomes peut tout céder`);
});
eq(RENDER.generalWalkingSele(fake, { kind: 'lipid', sele: ':L' }, 'cartoon'), '',
  'un lipide n’a pas de chemin à garder (aucun de ses styles ne parcourt la molécule)');
eq(RENDER.generalWalkingSele(fake, { kind: 'nucleic', sele: ':A and nucleic' }, 'cartoon'), '',
  'un nucléotide sans atome lisible ne protège rien — jamais d’erreur, juste moins de protection');

/* ══ 3. LE CÂBLAGE : LES TROIS RÈGLES SONT DANS LA SOURCE ═══════════════════ */
has("next.follow = next.style !== 'hide' || value === 'hide';",
  'la source dit « une partie cachée PAR GENERAL reste dans la hiérarchie (elle le suit) »');
gone("if (value === 'hide') { next.style = defaultLookOf(kind, s.sub).style; next.follow = false; }",
  '…et l’exception « Hide sur General redonne à chaque partie son style par défaut » a disparu');
has(".filter(({ look }) => !!look && look.style !== 'hide' && look.follow === false)",
  'une partie ne reçoit ses atomes que si elle a un style PROPRE (follow: false) ET dessine');
has('const rowOpts = (style) => ({ anchorSideChains, backboneLosesCa, anchorParts: ATOM_DRAW_STYLES.includes(style) });',
  '…avec les mêmes drapeaux d’ancre que la rangée qui les reçoit');
has('const generalOnly = relinquished.length',
  'la rangée General ne devient exclusive que s’il y a des atomes à céder');
has("const sele = spec.sub === 'general' && generalOnly",
  '…et c’est la SEULE rangée dont la sélection est remplacée par cette clause');
has("const SPLINE_STYLES = ['cartoon', 'ribbon', 'tube', 'trace'];",
  'la source nomme les styles qui PARCOURENT la molécule au lieu de dessiner ses atomes');
has('const generalKeeps = generalWalkingSele(structure, sec, (subLooks.general || {}).style);',
  '…et lit les atomes du chemin de SON style avant de céder quoi que ce soit');
has('const giveAway = (sele) => (sele && generalKeeps ? `(${sele}) and not ${generalKeeps}` : sele);',
  '…les parties ne reçoivent donc que ce que ce chemin ne couvre pas');
has('.map(({ sp, look }) => giveAway(sectionRowSele(structure, sec, sp.sub, rowOpts(look.style))))',
  '…c’est la SEULE différence avec la cession d’avant (la règle des parties n’a pas bougé)');
has("if (sec.kind === 'protein') return 'backbone';",
  '…le squelette d’une protéine (N · CA · C · O) est protégé nommément, avec un mot de NGL');
has('return indexSele(nucleotideGroupIndices(structure, sec, \'phosphate\')',
  '…un nucléotide protège les atomes comptés sur SA structure (phosphate · pentose), sans dépendre d’une convention de nom');

/* ══ 4. UNE RANGÉE QUI NE DESSINE RIEN LE DIT ════════════════════════════════
   La seule panne qu'un SÉLECTEUR puisse avoir sans que NGL ne lève : il
   n'atteint aucun atome, et la rangée semble morte — le rapport « if in general
   i select cartoon or whatever other style i don't see anything ». Le compte est
   fait par le lecteur de sélection de la page (atomIndicesForSele), une fois par
   sélection distincte, et la rangée se nomme dans la console. */
const warned = [];
const realWarn = console.warn;
console.warn = (...args) => { warned.push(args.join(' ')); };
const emptyStruct = { eachAtom() {} };
const SEL_EMPTY = ':A and protein and not ((:A and protein and (sidechain or .CA)))';
ok(RENDER.warnIfEmptySelection(emptyStruct, SEL_EMPTY, '« General » of Chain A') === true,
  'une sélection soustractive qui n’atteint AUCUN atome est signalée');
eq(warned.length, 1, '…une fois, avec un seul message');
ok(warned[0].includes('« General » of Chain A') && warned[0].includes('draws NOTHING') && warned[0].includes(SEL_EMPTY),
  '…qui nomme la rangée ET écrit la sélection fautive (de quoi corriger en un regard)');
ok(RENDER.warnIfEmptySelection(emptyStruct, SEL_EMPTY, '« General » of Chain A') === false,
  '…et pas deux fois pour la même sélection (le Set des sélections déjà vues)');
ok(RENDER.warnIfEmptySelection(emptyStruct, ':A and protein', 'x') === false,
  'une sélection NON soustractive n’est jamais comptée (aucun coût)');
console.warn = realWarn;
has('warnIfEmptySelection(structure, sele, `« ${spec.label} » of ${sec.name}`);',
  'le rendu l’appelle pour chaque rangée qu’il construit, avec son libellé');
has('const emptySelectionWarned = new Set();',
  '…en se souvenant des sélections déjà signalées');

/* ══ 5. LA CASCADE, TELLE QUE LE RAPPORT L'ÉCRIT (exécutée) ═══════════════════
   Le rapport, mot pour mot :
     • « Qualsiasi modifica applicata al livello "General" deve forzare
        l'adeguamento a cascata delle sottomolecole. Se imposto "General" su
        cartoon, il backbone deve passare a cartoon e le sidechain a hide. Se
        imposto "General" su ball and stick, sia il backbone che le sidechain
        devono passare a ball and stick. » ;
     • « Se modifico il raggio di una sfera in "General", il nuovo valore deve
        aggiornare automaticamente anche i raggi di backbone e sidechains. » ;
     • « Modificare lo stile di una sottomolecola (es. impostare il backbone su tube)
        deve agire solo localmente, senza alterare lo stato del comando "General". » ;
     • « Se, dopo una modifica locale, riapplico un nuovo comando a "General" (es.
        ribbon), questo deve tornare a sovrascrivere tutte le personalizzazioni
        fatte in precedenza sulle singole parti. » ;
     • « Questa logica di ereditarietà deve valere in modo trasversale per tutte le
        tipologie molecolari (proteine, acidi nucleici, lipidi). »
   Les TROIS familles sont donc mesurées ici, avec la MÊME règle — lue dans le
   vocabulaire de chaque rangée (partStyleUnderGeneral), donc sans table par type. */
// 5a. « General → Balls and sticks » : TOUTES les parties prennent le style, y compris
//     celles qui ne savent pas dessiner un ruban.
const ball = HIER.setGeneralSectionField({}, 'protein', 'style', 'ball+stick');
['backbone', 'sidechain'].forEach((sub) => {
  eq(gen(ball, 'protein', sub).style, 'ball+stick',
    `« ${sub} » passe en ball+stick (le rapport : « sia il backbone che le sidechain »)`);
  eq(eff(ball, 'protein', sub).style, 'ball+stick', '…et c’est bien ce que sa rangée dessine');
  eq(gen(ball, 'protein', sub).follow, true, '…en suivant General (son badge « ← General » le dit)');
});
// 5b. « General → cartoon » : le squelette prend le cartoon, les chaînes latérales sont
//     mises sur Hide (le premier exemple du rapport).
const cart = HIER.setGeneralSectionField({}, 'protein', 'style', 'cartoon');
eq(gen(cart, 'protein', 'backbone').style, 'cartoon', 'General cartoon → backbone cartoon');
eq(gen(cart, 'protein', 'sidechain').style, 'hide', '…et side chains sur hide');
// 5c. UN ACIDE NUCLÉIQUE (DNA / RNA) : squelette · bases · ribose.
const nuc = HIER.setGeneralSectionField({}, 'nucleic', 'style', 'cartoon');
eq(gen(nuc, 'nucleic', 'backbone').style, 'cartoon', 'le squelette d’un nucléotide prend le cartoon');
['bases', 'ribose'].forEach((sub) => eq(gen(nuc, 'nucleic', sub).style, 'hide',
  `…et « ${sub} » passe sur hide (le cartoon de General parcourt déjà ses atomes)`));
const nucBall = HIER.setGeneralSectionField({}, 'nucleic', 'style', 'ball+stick');
eq(['backbone', 'bases', 'ribose'].map((s) => gen(nucBall, 'nucleic', s).style),
  ['ball+stick', 'ball+stick', 'ball+stick'],
  'General ball+stick → les TROIS parties de l’acide nucléique en ball+stick');
// 5d. UN PHOSPHOLIPIDE : tête polaire · chaînes acyle · glycérol.
const lip = HIER.setGeneralSectionField({}, 'lipid', 'style', 'licorice');
eq(['head', 'tail', 'glycerol'].map((s) => gen(lip, 'lipid', s).style),
  ['licorice', 'licorice', 'licorice'],
  'General licorice → les trois parties du phospholipide en licorice');
const lipBall = HIER.setGeneralSectionField({}, 'lipid', 'style', 'ball+stick');
eq(['head', 'tail', 'glycerol'].map((s) => gen(lipBall, 'lipid', s).follow), [true, true, true],
  '…et elles suivent General (la cascade vaut pour les lipides comme pour le reste)');
// 5e. UNE ENVELOPPE (surface · mesh) n’est dessinée par AUCUNE partie : elles passent
//     toutes sur hide, et l’enveloppe de General décrit la molécule seule.
const surf = HIER.setGeneralSectionField({}, 'protein', 'style', 'surface');
eq(['backbone', 'sidechain'].map((s) => gen(surf, 'protein', s).style), ['hide', 'hide'],
  'General surface → les parties passent sur hide (aucune ne dessine une surface)');

// 5f. LES DEUX RAYONS DESCENDENT, MÊME DANS UNE PARTIE QUI A DÉVIÉ — et le style de
//     cette partie ne bouge pas, General non plus (les deux avant-derniers points).
const local = HIER.setRowSectionField(cart, 'protein', 'backbone', 'style', 'tube');
eq(gen(local, 'protein', 'backbone').style, 'tube', 'modification locale : le backbone passe en tube');
eq(gen(local, 'protein', 'backbone').follow, false, '…et sa rangée cesse de suivre General');
eq(gen(local, 'protein', 'general').style, 'cartoon', '…General n’a PAS bougé (la modification reste LOCALE)');
const radii = HIER.setGeneralSectionField(local, 'protein', 'sphere', 1.8);
eq(gen(radii, 'protein', 'backbone').sphere, 1.8, 'le rayon de General atteint le backbone qui avait dévié');
eq(gen(radii, 'protein', 'sidechain').sphere, 1.8, '…et les chaînes latérales');
eq(gen(radii, 'protein', 'general').sphere, 1.8, '…General compris, évidemment');
eq(gen(radii, 'protein', 'backbone').style, 'tube', '…SANS toucher au style que la partie avait choisi');
eq(gen(radii, 'protein', 'backbone').follow, false, '…ni la raccrocher à General');
const radii2 = HIER.setGeneralSectionField(radii, 'protein', 'bond', 0.6);
eq(gen(radii2, 'protein', 'sidechain').bond, 0.6, 'il en va de même du rayon de liaison (bond)');
// 5g. …et un NOUVEAU style sur General ÉCRASE la personnalisation locale (le rapport :
//     « deve tornare a sovrascrivere tutte le personalizzazioni fatte in precedenza »).
const over = HIER.setGeneralSectionField(radii2, 'protein', 'style', 'ribbon');
eq(gen(over, 'protein', 'backbone').style, 'ribbon', 'un nouveau style sur General écrase le « tube » choisi localement');
eq(gen(over, 'protein', 'backbone').follow, true, '…et la rangée repasse sous General');
eq(gen(over, 'protein', 'backbone').sphere, 1.8, '…en gardant le rayon qui était descendu');
// 5h. LE CÂBLAGE : une fonction à part pour la règle, un nom pour les deux rayons.
has('const partStyleUnderGeneral = (kind, sub, value) => (', 'la cascade est une fonction à part (elle se teste seule)');
has("subsectionSpec(kind, sub).styles.includes(value) ? value : 'hide'", '…qui lit le vocabulaire de LA rangée');
has("const RADIUS_FIELDS = ['sphere', 'bond'];", '…et les deux rayons ont leur nom');
has('next[field] = value;', '…le nombre est écrit dans CHAQUE partie, déviée ou non');

/* ══ 6. LA SCÈNE SE REPEINT TOUT DE SUITE ═════════════════════════════════════
   La seconde moitié du rapport de cette session : « cambia il valore nella casella
   del drop down ma non è come cliccare », « la scène ne s'actualise pas tout de
   suite ». NGL ne dessine que lorsqu'on le lui demande (`requestRender()`), et les
   représentations d'une rangée sont construites PENDANT cette image-là : sans
   demande, le résultat d'un geste attendait un mouvement de souris sur le canevas.
   La demande est donc faite LÀ OÙ les représentations naissent — et de nouveau sur
   l'image suivante —, et le compteur des gestes de la barre entre dans la signature,
   pour qu'un geste ne puisse plus être absorbé par une signature inchangée. */
has('const requestSceneRepaint = () => {', 'la demande d’image est UNE fonction (voir son commentaire)');
has('window.requestAnimationFrame(() => { try { v.requestRender(); } catch { /* ignore */ } });',
  '…qui demande aussi l’image SUIVANTE (les représentations viennent d’être créées)');
has('requestSceneRepaint();\n  return () => {', '…et l’effet qui rebâtit les rangées la fait aussitôt');
has("const [sectionEpoch, setSectionEpoch] = useState(0);", 'le compteur des gestes de la barre existe');
has('const bumpSectionEpoch = () => setSectionEpoch((n) => n + 1);', '…et sait s’incrémenter');
has('|gesture:${sectionEpoch}`;', '…dans la signature qui décide de reconstruire la scène');
ok((VIEW.match(/bumpSectionEpoch\(\);/g) || []).length >= 5,
  'chaque geste de la barre (style · ↺ d’une rangée · ↺ d’une section · ✔ · 🎨 Copy) l’incrémente');
ok((VIEW.match(/requestSceneRepaint\(\);/g) || []).length >= 6,
  '…et demande l’image au lieu d’attendre un geste sans rapport avec le canevas');

console.log(`_viewer_general_row_test.mjs — ${passed} assertions OK (hiérarchie + rangée General exécutée)`);
