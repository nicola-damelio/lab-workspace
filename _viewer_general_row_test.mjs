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
     3. LA CESSION DES ATOMES, RENDUE À SA PLACE. La règle 1 avait été poussée trop loin,
        sur un rapport plus ancien : « the hierarchy of the styles is wrong. It was
        better before. If in general (which represents the full molecule) i put cartoon,
        then the subgroups must be on hide and only cartoon must be visualised. » Pour
        cela, la rangée General CÉDAIT ses atomes aux parties (`sec.sele and not (…)`),
        MAIS la clause de chaque partie était AMPUTÉE des atomes que le style de General
        parcourt. LE RAPPORT DE CETTE SESSION : « If I put the general to cartoon or to
        whatever other style nothing is displayed. If I put the backbone in ball and
        sticks the backbone is displayed correctly but then if I put the side chains in
        ball and sticks part of the backbone vanishes. In other words you have to deeply
        revise these commands because nothing works. I cannot even display the molecule
        in ball and sticks because it appears fragmented. » — avec sa référence : « in the
        vercel deployment be33c40 the controls of the viewer worked well ». LA RÈGLE EST
        DONC : un style PROPRE à une sous-rangée l'emporte sur General POUR EXACTEMENT
        les atomes qu'elle dessine, et General dessine ce qui reste. Les SÉLECTIONS DES
        PARTIES ne bougent pas d'un caractère (`sectionRowSele`), et les trois pannes
        ci-dessus sont empêchées une par une : la rangée General S'EFFACE au lieu d'être
        vidée (`generalCession.empty`), le CA que le squelette et les chaînes latérales
        doivent garder pour que la chaîne tienne RESTE à General (`partAtomsHeldBack`),
        et un PARCOURS ne se partage pas atome par atome (`SPLINE_STYLES` ·
        `SPLINE_TRAIT_OWNERS`). La hiérarchie tient par la CASCADE (règle 1b) et par
        `effectiveSectionLook` (une partie cachée par General garde son « Hide ») ;
        mesuré atome par atome et liaison par liaison dans
        _viewer_style_coverage_test.mjs, et règle par règle dans
        _viewer_general_cession_test.mjs.

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

   Les mesures, sur le code livré :
     §1 la HIÉRARCHIE pure (setGeneralSectionField · effectiveSectionLook ·
        rowFollowsGeneral), exécutée sur de vrais arbres de look ;
     §2 le RENDU réel (buildSectionReps), dont les sélections partent à NGL — c'est
        là que la cession se voit : UNE clause soustractive, celle de la rangée
        General, des sélections de parties intactes, et le parcours pris ENTIER ;
     §3 le CÂBLAGE de la règle dans la source (generalCession · partAtomsHeldBack ·
        SPLINE_STYLES · SPLINE_TRAIT_OWNERS · la cession appelée par le rendu) — et
        les noms de l'ancienne cession, toujours interdits ;
     §4 · §5 les diagnostics (une rangée qui ne dessine rien le dit).

   Les règles sont AUSSI écrites dans le viewer (commentées avec le nom de ce
   fichier) : §3 vérifie le câblage, pour qu'une refonte du rendu ne puisse pas les
   perdre en silence.
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
  sliceFn(VIEW, 'nucleicGroupOf'),
  sliceDecl(VIEW, 'nucleicGroupCache'),
  sliceFn(VIEW, 'nucleicGroupIndicesIn'),
  sliceFn(VIEW, 'nucleotideGroupIndices'),
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
  sliceDecl(VIEW, 'SPLINE_STYLES'),
  sliceDecl(VIEW, 'SPLINE_TRAIT_OWNERS'),
  sliceFn(VIEW, 'partAtomsHeldBack'),
  sliceFn(VIEW, 'generalCession'),
  sliceFn(VIEW, 'buildSectionReps'),
  'return { buildSectionReps, warnIfEmptySelection };',
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

/* 2b. LA RANGÉE GENERAL DESSINE CE QUE LES AUTRES LUI LAISSENT (la cession est de retour,
   sans les trois pannes qui l'avaient fait retirer — voir son commentaire dans
   buildSectionReps). L'ORDRE DU RAPPORT : « General → Tube », puis « Backbone →
   Cartoon ». Le squelette a pris SON parcours : le tube de General n'est donc plus
   dessiné — deux rubans à la fois, c'était exactement la panne « It is not working
   anymore » — et les sélections des parties, elles, ne bougent pas d'un caractère. */
const dev = sels(tree(['tube', 'sstruc'], ['cartoon', 'sstruc', false], ['licorice', 'element', false]));
ok(!dev.includes(':A and protein'),
  'le tube de General n’est plus dessiné : la rangée qui parcourt le même chemin a pris le parcours');
ok(dev.every((s) => !String(s).includes(' and not ')),
  '…et AUCUNE clause soustractive n’est produite : un parcours se prend ENTIER, il ne se découpe pas');
ok(dev.includes(':A and protein and backbone'),
  'le squelette dévié dessine son cartoon — sa sélection est la sienne, sans « and not »');
ok(dev.includes(':A and protein and (sidechain or .CA)'),
  '…et les chaînes latérales les leurs, CA COMPRIS (la parenthèse n’est jamais amputée : elles ne flottent plus)');
ok(!scene(tree(['tube', 'sstruc'], ['cartoon', 'sstruc', false], ['licorice', 'element', false]))
  .some((r) => r.type === 'tube'),
  '…et il ne reste qu’UN parcours à l’écran : celui du squelette');

/* 2c. UNE PARTIE CACHÉE NE DESSINE RIEN — elle ne produit AUCUNE représentation, et elle
   ne prend de General que ce qu'elle annonce : sous un style qui PARCOURT la molécule,
   ses atomes restent à General (un parcours ne se partage pas) ; sous un style qui DESSINE
   DES ATOMES, elle cède les SIENS — « Hide » veut dire « ne dessine plus ces atomes », et
   General ne les redessine donc plus. */
const hid = sels(tree(['tube', 'sstruc'], ['hide', 'sstruc', false], ['licorice', 'element', false]));
ok(hid.includes(':A and protein'),
  'sous un PARCOURS (General → tube), une partie cachée ne lui prend rien : la chaîne reste entière');
ok(!hid.includes(':A and protein and backbone'), '…la partie cachée ne dessine rien du tout');
ok(hid.includes(':A and protein and (sidechain or .CA)'),
  '…et la partie qui a son propre style dessine ses atomes, CA compris');
const hidAtom = sels(tree(['ball+stick', 'sstruc'], ['hide', 'sstruc', false], ['licorice', 'element', false]));
eq(hidAtom, [':A and protein', ':A and protein and (sidechain or .CA)'],
  '…et sans structure à mesurer, la cession ne peut RIEN retirer : la rangée General reste telle quelle');

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
      et les chaînes latérales passent sur Hide — et ce « Hide » TIENT (règle 1g,
      `effectiveSectionLook` : une partie cachée par General ne retombe pas sur son
      propre style par défaut).
   2. « Side chains → licorice » (1f) : les chaînes latérales se dessinent VRAIMENT —
      et le cartoon de General est TOUJOURS là, ENTIER : sa sélection est la molécule
      entière, elle n'a jamais été amputée — le squelette est CACHÉ, donc il ne prend
      pas le parcours (règle 4). Avant, le partage d'atomes laissait le cartoon sans Cα.
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
eq(stepCartoon.params.sele, ':A and protein',
  '…et c’est la molécule ENTIÈRE qu’il dessine : aucune sous-rangée ne lui prend ses Cα');
ok(stepScene.some((r) => r.type === 'licorice' && r.params.sele === ':A and protein and (sidechain or .CA)'),
  '…et les chaînes latérales se dessinent vraiment, CA compris');
eq(gen(HIER.setGeneralSectionField(step2, 'protein', 'style', 'ribbon'), 'protein', 'sidechain').style, 'hide',
  'étape 3 : un NOUVEAU style sur General remet la sous-rangée sur Hide (la règle 1b vaut à chaque fois)');

/* 2f. LA RÈGLE ELLE-MÊME, HORS DU RENDU : ce que chaque couple (style de General, style
   des parties) produit. Un style qui DESSINE DES ATOMES cède ses atomes à une partie qui
   a son propre style : la clause n'existe alors QUE sur la rangée General, et les
   sélections des parties restent celles de sectionRowSele, octet pour octet. Un style qui
   PARCOURT la molécule ne se partage pas atome par atome : la rangée General disparaît
   seulement quand la rangée qui parcourt le même chemin a pris le parcours. Le tout est
   mesuré atome par atome et liaison par liaison dans _viewer_style_coverage_test.mjs. */
['cartoon', 'ribbon', 'tube', 'trace', 'hide', 'licorice', 'ball+stick', 'spacefill', 'surface'].forEach((st) => {
  [true, false].forEach((follow) => {
    const sc = sels(tree([st, 'sstruc', false], ['licorice', 'sstruc', follow], ['ball+stick', 'element', follow]));
    ok(sc.filter((s) => String(s).includes(' and not ')).length <= (follow ? 0 : 1),
      `« ${st} » (parties qui suivent : ${follow}) : la SEULE clause soustractive possible est celle de General`);
    if (follow) {
      ok(sc.every((s) => !String(s).includes(' and not ')),
        `« ${st} » (parties qui suivent) : aucune soustraction — une rangée qui suit ne prend rien`);
    } else {
      ok(sc.includes(':A and protein and backbone') && sc.includes(':A and protein and (sidechain or .CA)'),
        `« ${st} » (parties déviées) : les sélections des parties ne sont pas touchées d’un caractère`);
    }
  });
});
// 2g. LE PARCOURS DE GENERAL RESTE LE SEUL DESSIN DE LA CHAÎNE QUAND PERSONNE NE LE PREND :
//     une rangée CACHÉE ne prend pas le parcours (elle ne dessine rien), un squelette qui
//     SUIT General non plus (il n'a pas de style propre), et le défaut d'une molécule neuve
//     ne bouge donc pas d'un caractère.
ok(!sels(tree(['cartoon', 'sstruc', false], ['ball+stick', 'sstruc', false], ['licorice', 'element', false]))
  .includes(':A and protein'),
  'General → cartoon + Backbone → ball+stick : le ruban de General n’est plus dessiné');
ok(sels(tree(['cartoon', 'sstruc', false], ['hide', 'sstruc', false], ['licorice', 'element', false]))
  .includes(':A and protein'),
  '…mais General → cartoon + Backbone → hide le LAISSE : personne d’autre ne parcourt la chaîne');
ok(sels(tree(['cartoon', 'sstruc', false], ['cartoon', 'sstruc', true], ['licorice', 'element', true]))
  .includes(':A and protein'),
  '…et un squelette qui SUIT General ne prend rien : la molécule neuve se dessine comme avant');

/* ══ 3. LE CÂBLAGE : LA RÈGLE D'UNION EST DANS LA SOURCE ════════════════════ */
has("next.follow = next.style !== 'hide' || value === 'hide';",
  'la source dit « une partie cachée PAR GENERAL reste dans la hiérarchie (elle le suit) »');
gone("if (value === 'hide') { next.style = defaultLookOf(kind, s.sub).style; next.follow = false; }",
  '…et l’exception « Hide sur General redonne à chaque partie son style par défaut » a disparu');
has("if (own.style === 'hide') return { ...own, follow: true };",
  '…et un « Hide » écrit par la cascade TIENT : une partie cachée par General ne retombe pas sur son propre défaut');
has("const anchorSideChains = sec.kind === 'protein'",
  'le rendu décide l’ancre des chaînes latérales d’après le look de SA rangée');
has('const sele = sectionRowSele(structure, sec, spec.sub, { anchorSideChains, anchorParts });',
  '…et la sélection d’une PART est EXACTEMENT ce que sectionRowSele écrit : sa part (+ ancre, + pont), jamais amputée');
has('const cession = generalCession(structure, sec, subLooks, { anchorSideChains });',
  '…tandis que la rangée General reçoit la CESSION, calculée une fois pour toute la section');
gone('const giveAway =',
  'l’ANCIENNE cession, qui AMPUTAIT les parties, ne peut pas revenir…');
gone('const generalKeeps =',
  '…ni « les atomes que le style de General parcourt » à protéger…');
gone('const relinquished =',
  '…ni la liste des parties qui prenaient les atomes de General…');
gone('const rowOpts =',
  '…ni les drapeaux qui servaient à ce partage…');
gone('const generalOnly',
  '…ni le remplacement de la sélection de la rangée General…');
gone('const backboneLosesCa = anchorSideChains',
  '…ni les CA retirés au squelette (« part of the backbone vanishes »)');
has("const SPLINE_STYLES = ['cartoon', 'ribbon', 'tube', 'trace'];",
  '…et la liste des styles qui PARCOURENT la molécule sert à la règle du parcours');
has("const SPLINE_TRAIT_OWNERS = { protein: ['backbone'], nucleic: ['backbone', 'ribose'] };",
  '…avec les rangées qui parcourent le même chemin, par type de section');
has('const partAtomsHeldBack = (structure, part, rowAtoms, taken, within) => {',
  '…et le garde-fou qui retient à General l’atome dont un voisin ne serait plus dessiné');
gone('const generalWalkingSele =',
  '…et la fonction qui protégeait le chemin de General n’a jamais eu besoin de revenir');

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
has('warnIfEmptySelection(structure, drawn, `« ${spec.label} » of ${sec.name}`);',
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
