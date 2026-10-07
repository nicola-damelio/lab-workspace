/* =========================================================================
   _viewer_selected_space_test.mjs — LA DEMANDE « styling window » DE CETTE SESSION.

   Le rapport, mot pour mot, et ce que cette suite empêche de revenir :

     1. « In the styling window use a very light orange background for proteins
        section degrading for general, backbone and sidechains. Use a light gray
        color for lipid section … Make these colors customizable in the setting
        wheel. » → UNE couleur par TYPE peint l'ESPACE de la barre de style, et les
        RANGÉES de cet espace s'éclaircissent vers le blanc, General d'abord : la
        teinte de base et son échelle sont des pastilles de la roue ⚙, persistées
        comme les autres palettes ;
     2. « The setting wheel is now repeated in every space but only one on the top
        of the window is sufficient. » → les rangées ne répètent plus l'ouvreur : le
        SEUL ⚙ est celui de l'en-tête de la fenêtre de style ;
     3. « Add a section "selected" for selected residues, use the same menus as for
        molecules. Not all these dropdown menu must appear but only those related
        to selections classified as proteins, nucleic acids or lipids. … If the
        selection is not classified as proteins, nucleic acid or lipids, just show
        the general. » → l'espace « Selected » est bâti par le MÊME catalogue que
        celui d'une molécule (une section synthétique par type présent), sans
        seconde implémentation ;
     4/5/6. Les trois palettes ÉTENDUES de la roue : trois pastilles par classe de
        lipide (tête · glycérol · chaînes), deux par base (la base · son ribose /
        2′-désoxyribose), deux par résidu (squelette · chaînes latérales) — ce que
        « color by lipid type / base type / residue » peint.

   Le viewer est un .jsx : les helpers PURS sont EXTRAITS du fichier puis EXÉCUTÉS,
   et le JSX (que rien n'exécute ici) est vérifié par ses marqueurs.
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

const VIEW = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
const gone = (needle, what) => ok(!VIEW.includes(needle), `${what}\n  encore présent : ${needle}`);
const countOf = (re) => (VIEW.match(re) || []).length;

/* ── Extraction (le comptage lit un MASQUE sans commentaires : la prose du viewer
   est pleine de parenthèses, qui fausseraient la fin d'un `const`) ───────── */
const MASK = VIEW
  .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
  .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
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


/* ══ 1. LES FONDS DE LA FENÊTRE DE STYLE ════════════════════════════════════
   Un fond par TYPE (le rapport les nomme tous) et une ÉCHELLE : la rangée General
   porte la teinte de base, chaque partie en dessous est plus pâle. Les deux sont
   PURS — exécutés ici, comme dans les autres suites du viewer. */
const TINT = new Function([
  sliceObject(VIEW, 'STYLES'),
  sliceObject(VIEW, 'COLORS'),
  sliceObject(VIEW, 'SECTION_SUBSECTIONS'),
  sliceDecl(VIEW, 'subsectionsOf'),
  sliceFn(VIEW, 'subsectionSpec'),
  sliceFn(VIEW, 'numToHex'),
  sliceObject(VIEW, 'DEFAULT_SECTION_TINTS'),
  sliceDecl(VIEW, 'SECTION_TINT_KEY'),
  sliceFn(VIEW, 'mixHex'),
  sliceFn(VIEW, 'sectionTintOf'),
  sliceFn(VIEW, 'sectionCardTintCss'),
  sliceDecl(VIEW, 'SECTION_TINT_STEPS'),
  sliceFn(VIEW, 'sectionRowTintOf'),
  sliceFn(VIEW, 'sectionRowTintCss'),
  'return { DEFAULT_SECTION_TINTS, SECTION_TINT_KEY, SECTION_TINT_STEPS, mixHex, sectionTintOf, sectionCardTintCss, sectionRowTintOf, sectionRowTintCss, numToHex, subsectionsOf };',
].join('\n'))();

// Le mélange : arithmétique de canaux, bornée et arrondie.
eq(TINT.mixHex(0x000000, 0xffffff, 0.5), 0x808080, 'mélanger deux couleurs à 50 % donne le gris du milieu');
eq(TINT.mixHex(0x000000, 0xffffff, 0), 0x000000, 't = 0 : la première couleur, telle quelle');
eq(TINT.mixHex(0x000000, 0xffffff, 1), 0xffffff, 't = 1 : la seconde');
eq(TINT.mixHex(0xff0000, 0xffffff, 2), 0xffffff, 't est BORNÉ : au-delà de 1, la seconde couleur');
eq(TINT.mixHex(0xff0000, 0xffffff, -1), 0xff0000, '…et en dessous de 0, la première');
eq(TINT.mixHex(0x123456, 0xffffff, 0.5), 0x899aab, 'canal par canal, arrondi au plus proche');

// Les six couleurs du rapport, plus le gris neutre du ligand : chacune est bien
// celle que son nom annonce.
const lum = (hex) => (((hex >> 16) & 0xff) * 0.299 + ((hex >> 8) & 0xff) * 0.587 + (hex & 0xff) * 0.114);
const chan = (hex, c) => (hex >> c) & 0xff;
const D = TINT.DEFAULT_SECTION_TINTS;
ok(chan(D.protein, 16) > chan(D.protein, 8) && chan(D.protein, 8) > chan(D.protein, 0),
  'la protéine est ORANGE (rouge > vert > bleu)');
ok(chan(D.nucleic, 8) > chan(D.nucleic, 16) && chan(D.nucleic, 8) > chan(D.nucleic, 0),
  'l’acide nucléique est VERT (vert dominant)');
ok(Math.abs(chan(D.lipid, 16) - chan(D.lipid, 8)) <= 6 && Math.abs(chan(D.lipid, 8) - chan(D.lipid, 0)) <= 6,
  'le lipide est GRIS (les trois canaux au même niveau)');
ok(chan(D.water, 0) > chan(D.water, 16) && chan(D.water, 0) > chan(D.water, 8),
  'l’eau est BLEUE (bleu dominant)');
ok(chan(D.ion, 16) > chan(D.ion, 8) && chan(D.ion, 0) > chan(D.ion, 8),
  'l’ion est MAGENTA (rouge et bleu au-dessus du vert)');
ok(chan(D.sugar, 16) > chan(D.sugar, 8) && chan(D.sugar, 8) > chan(D.sugar, 0),
  'le sucre est MARRON (rouge > vert > bleu)');
ok(lum(D.sugar) < lum(D.protein), '…et il est plus sombre que l’orange TRÈS clair de la protéine');
['protein', 'nucleic', 'lipid', 'sugar', 'water', 'ion', 'ligand'].forEach((k) => {
  ok(Number.isFinite(D[k]) && lum(D[k]) > 200, `le fond « ${k} » existe et reste très clair (lisible sous du texte)`);
});

// L’échelle : General EST la teinte de base, et chaque rangée suivante s’approche
// du blanc — sans jamais l’atteindre (une partie resterait alors invisible).
['protein', 'nucleic', 'lipid'].forEach((k) => {
  const list = TINT.subsectionsOf(k);
  const tints = list.map((sp) => TINT.sectionRowTintOf(D, k, sp.sub));
  ok(lum(tints[0]) > lum(D[k]),
    `${k} : la rangée General est plus claire que le FOND de l'espace (le fond porte la couleur pleine)`);
  for (let i = 1; i < tints.length; i += 1) {
    ok(lum(tints[i]) > lum(tints[i - 1]), `${k} : « ${list[i].label} » est plus pâle que « ${list[i - 1].label} »`);
  }
  ok(lum(tints[tints.length - 1]) < lum(0xffffff), `${k} : …même la dernière rangée reste TEINTÉE`);
  eq(TINT.sectionCardTintCss(D, k), TINT.numToHex(D[k]), `${k} : le fond de l’espace est la pastille, telle quelle`);
  ok(/^#[0-9a-f]{6}$/.test(TINT.sectionRowTintCss(D, k, 'pas-une-partie')),
    'une partie inconnue garde une couleur valide (jamais « undefined » dans le style)');
});
ok(Number.isFinite(TINT.sectionRowTintOf(undefined, 'protein', 'general')),
  'sans palette chargée, les DÉFAUTS prennent la main (jamais de fond noir)');
eq(TINT.sectionTintOf({}, 'inconnu'), D.ligand, 'un type inconnu retombe sur le neutre du ligand');
eq(TINT.SECTION_TINT_KEY, 'labViewerSectionTints', 'la palette des fonds a SA clé de stockage');
ok(TINT.SECTION_TINT_STEPS.length >= 3 && TINT.SECTION_TINT_STEPS.every((s) => s > 0 && s < 1),
  'l’échelle est une liste de mélanges vers le blanc, tous entre 0 et 1');


// Les marqueurs du JSX : l’espace et ses rangées PORTENT le fond, la roue les
// édite, le stockage les garde.
has('style={{ backgroundColor: sectionCardTintCss(sectionTints, kind) }}',
  'l’ESPACE d’une molécule est peint du fond de son type');
has('style={{ backgroundColor: sectionRowTintCss(sectionTints, kind, sub) }}',
  '…et chaque RANGÉE de l’espace porte son cran de l’échelle');
has('const [sectionTints, setSectionTints] = useState(() => loadPalette(SECTION_TINT_KEY, DEFAULT_SECTION_TINTS));',
  'les fonds sont un état persisté, comme les autres palettes');
has('const setSectionTint = (kind, hex) => setSectionTints((p) => ({ ...p, [kind]: hex }));',
  'une pastille écrit SON type');
has('const resetSectionTints = () => setSectionTints(paletteDefaults(SECTION_TINT_KEY, DEFAULT_SECTION_TINTS));',
  '…et le ↺ de la section remet les sept (aux couleurs ENREGISTRÉES : voir paletteDefaults)');
has('useEffect(() => { savePalette(SECTION_TINT_KEY, sectionTints); }, [sectionTints]);',
  'les fonds survivent à un rechargement');
has('Styling window · section backgrounds', 'la roue ⚙ a une SECTION « fonds de la fenêtre de style »');
has('{SECTION_TINT_ORDER.map((k) => (', '…une pastille par type de molécule');
has('onChange={(e) => setSectionTint(k, parseInt(e.target.value.slice(1), 16))}',
  '…et la pastille écrit la table (la fenêtre suit à l’instant)');
has("const SECTION_TINT_ORDER = ['protein', 'nucleic', 'lipid', 'sugar', 'water', 'ion', 'ligand'];",
  'l’ordre des pastilles est déclaré une fois, dans l’ordre du rapport');


/* ══ 2. L'ESPACE « SELECTED » ══════════════════════════════════════════════
   Une seule implémentation : les sections synthétiques passent par le MÊME
   catalogue (SECTION_SUBSECTIONS) et le MÊME renderSection que les molécules. */
const SEL = new Function([
  sliceObject(VIEW, 'AA3_TO_1'),
  sliceObject(VIEW, 'NUCLEIC_1_BY_NAME'),
  sliceFn(VIEW, 'atomNameSet'),
  sliceDecl(VIEW, 'hasSugarRing'),
  sliceDecl(VIEW, 'hasPhosphateLink'),
  sliceFn(VIEW, 'residueNatureOf'),
  sliceDecl(VIEW, 'LIPID_RESNAMES'),
  sliceFn(VIEW, 'isLipidResname'),
  sliceObject(VIEW, 'SUGAR_NAME_CODES'),
  sliceDecl(VIEW, 'SUGAR_CODE_NAMES'),
  sliceDecl(VIEW, 'sugarCodeOf'),
  "const SUGAR_IDENTITY_CODES = ['GLC', 'NAG', 'MAN', 'BMA', 'SIA', 'NAN', 'GAL', 'FUC'];",
  sliceFn(VIEW, 'isSugarResidueCode'),
  sliceDecl(VIEW, 'LABEL_WATER_NAMES'),
  sliceDecl(VIEW, 'LABEL_ION_ELEMENTS'),
  sliceDecl(VIEW, 'LABEL_ION_RESNAMES'),
  sliceFn(VIEW, 'classifySectionResidue'),
  sliceFn(VIEW, 'atomElement'),
  sliceFn(VIEW, 'residueTickClause'),
  sliceDecl(VIEW, 'SELECTED_SECTION_PREFIX'),
  sliceDecl(VIEW, 'SELECTED_KINDS'),
  sliceFn(VIEW, 'tickResidueRecord'),
  sliceFn(VIEW, 'selectedResiduePlan'),
  sliceFn(VIEW, 'selectedResidueSections'),
  sliceObject(VIEW, 'MOL_KIND_LABELS'),
  sliceObject(VIEW, 'STYLES'),
  sliceObject(VIEW, 'COLORS'),
  sliceObject(VIEW, 'SECTION_SUBSECTIONS'),
  sliceDecl(VIEW, 'subsectionsOf'),
  sliceFn(VIEW, 'subsectionSpec'),
  'return { selectedResiduePlan, selectedResidueSections, subsectionsOf, SELECTED_SECTION_PREFIX };',
].join('\n'))();

// Des « ticks » de bande : la même forme que collectResidueTicks.
const tick = (resno, resname, atomNames, extra = {}) => ({
  resno, resname, code: extra.code || '', polymer: extra.polymer !== false,
  nature: extra.nature || '', chainid: extra.chainid || 'A', chainname: extra.chainname || 'A',
  atomNames,
});
const TICKS = [
  tick(1, 'ALA', ['N', 'CA', 'C', 'O', 'CB']),
  tick(2, 'LEU', ['N', 'CA', 'C', 'O', 'CB', 'CG', 'CD1', 'CD2']),
  tick(3, 'DA', ['P', "O5'", "C5'", "C1'", 'N9', 'C2', 'N1']),
  tick(4, 'POPC', ['P', 'N', 'C1', 'C2', 'C3', 'C21', 'C31'], { code: '', polymer: false }),
  tick(5, 'TIP3', ['OH2', 'H1', 'H2'], { code: '', polymer: false }),
];
const keysOf = (...resnos) => resnos.map((n) => `${n - 1}-CA`);

// 1) protéine → UN espace, nommé « Selected », avec SES rangées.
const one = SEL.selectedResidueSections(keysOf(1), TICKS);
eq(one.map((s) => s.kind), ['protein'], 'un résidu de protéine sélectionné → un espace de type protéine');
eq(one[0].name, 'Selected', '…nommé simplement « Selected » quand un seul type est là');
eq(one[0].detail, '1 residue', '…et il dit combien de résidus il porte');
eq(SEL.subsectionsOf(one[0].kind).map((s) => s.sub), ['general', 'backbone', 'sidechain'],
  'les menus d’une protéine : General · Backbone · Side chains');
ok(!SEL.subsectionsOf(one[0].kind).some((s) => ['head', 'glycerol', 'tail'].includes(s.sub)),
  '…et AUCUN menu de lipide');
const two = SEL.selectedResidueSections(keysOf(1, 2), TICKS);
eq(two[0].count, 2, 'deux résidus sélectionnés : le compte suit');
eq(two[0].sele, '(:A and 1 and ALA) or (:A and 2 and LEU)',
  'chaque résidu a SA clause, PARENTHÉSÉE (NGL lie « and » plus fort que « or »)');


// 2) protéine + acide nucléique → DEUX espaces, et ni têtes ni glycérol ni chaînes.
const both = SEL.selectedResidueSections(keysOf(1, 3), TICKS);
eq(both.map((s) => s.kind).sort(), ['nucleic', 'protein'],
  'protéine + acide nucléique : UN espace par type présent');
ok(both.every((s) => s.name.startsWith('Selected · ')),
  '…nommés « Selected · <type> », puisque deux types se partagent la sélection');
ok(both.every((s) => !SEL.subsectionsOf(s.kind).some((sp) => ['head', 'glycerol', 'tail'].includes(sp.sub))),
  'la demande, mot pour mot : « do not show headgroups, glycerol, acyl chains »');
eq(SEL.subsectionsOf('nucleic').map((s) => s.sub), ['general', 'backbone', 'bases', 'ribose'],
  'les menus d’un acide nucléique : General · Backbone · DNA/RNA bases · DNA/RNA ribose');

// 3) un lipide → ses trois parties ; une sélection NON classée → General seul.
const lip = SEL.selectedResidueSections(keysOf(4), TICKS);
eq(lip.map((s) => s.kind), ['lipid'], 'un POPC sélectionné → un espace de type lipide');
eq(SEL.subsectionsOf('lipid').map((s) => s.sub), ['general', 'head', 'heads', 'phosphorus', 'tail', 'glycerol'],
  'les menus d’un lipide : General · headgroups · heads (N · O) · P · acyl chains · glycerol');
const other = SEL.selectedResidueSections(keysOf(5), TICKS);
eq(other.length, 1, 'une sélection qui n’est ni protéine, ni acide nucléique, ni lipide : UN espace');
eq(other[0].kind, 'ligand', '…de type « ligand »');
eq(SEL.subsectionsOf(other[0].kind).map((s) => s.sub), ['general'],
  'la demande : « just show the general » — et c’est bien ce que ce type offre');

// 4) rien à montrer : aucun espace (jamais un espace vide dans la barre).
eq(SEL.selectedResidueSections([], TICKS), [], 'rien de sélectionné → aucun espace');
eq(SEL.selectedResidueSections(keysOf(1), []), [], 'structure pas encore lue (pas de ticks) → aucun espace');
eq(SEL.selectedResidueSections(['99-CA'], TICKS), [], 'une clé qui ne répond à aucun tick → aucun espace');
eq(SEL.selectedResidueSections(['0-CA'], TICKS).length, 1,
  'la clé est bien « resno - 1 » + l’atome (la convention de la bande)');

// 5) Les marqueurs de la barre et du renderer : UNE implémentation, deux appelants.
has('{selectedSectionsForUi().map((sec) => renderSection(sec))}',
  'la barre de style rend l’espace « Selected » avec LE renderSection des molécules');
has("molKey === 'main' ? selectedSectionsForUi() : [],",
  'le renderer dessine les mêmes sections synthétiques, sur la structure principale');
has('id: `${SELECTED_SECTION_PREFIX}::${k}`,', 'l’identifiant d’un espace « Selected » est préfixé (aucune collision)');
has("const selectedSpaceSig = `${(selectedKeys || []).join(',')}|${residueTicks.length}|${status}`;",
  'la signature de l’espace suit la SÉLECTION (les clés, les ticks, l’état)');
has('}, [status, selections, selStyles, pymolActive, hideAll, styleSignature, sstrucColors, selectedSpaceSig]);',
  '…et le rebuild des sections la surveille, comme les styles');
has('const residueTicksRef = useRef(residueTicks);',
  'les ticks sont lisibles là où le renderer les demande (une ref, pas l’état du premier rendu)');


/* ══ 3. UNE SEULE ROUE DANS LA FENÊTRE DE STYLE ════════════════════════════
   « The setting wheel is now repeated in every space but only one on the top of
   the window is sufficient. » Les deux ouvreurs des RANGÉES (le ⚙ de « Chain » et
   celui de « Secondary structure ») ont disparu ; les trois pastilles de la 2°
   structure, elles, restent dans la rangée — c'est l'UNIQUE ⚙ de l'en-tête qui
   ouvre la roue, et il édite exactement ces palettes-là. */
gone("{look.colorBy === 'chain' && (", 'la rangée « Color by : Chain » ne répète plus le ⚙ de la roue');
gone('« Secondary structure » has a section of its own there', '…ni la rangée de la 2° structure');
has("{look.colorBy === 'sstruc' && (", '…mais ses trois pastilles restent dans la rangée');
has('onChange={(e) => setSstrucColour(it.key, parseInt(e.target.value.slice(1), 16))}',
  '…et elles écrivent toujours par le seul écrivain de la palette');
has('edit every palette this viewer colours with', 'l’en-tête de la fenêtre de style garde SON ⚙ (l’ouvreur unique)');
has('Chains · color by chain', 'la roue a toujours sa section de chaînes (rien n’a été perdu)');
eq(countOf(/const renderAtomColour = /g), 1, 'l’ancien helper §2 existe encore (sa définition seule)');
eq(countOf(/renderAtomColour\(/g), 0,
  '…et il n’est JAMAIS appelé : les deux autres ⚙ du fichier sont donc inatteignables');
ok(VIEW.indexOf('molBarOpen && (') < VIEW.indexOf('edit every palette this viewer colours with'),
  'l’ouvreur vivant est bien celui de la barre de style');

/* ══ 4. LES TROIS PALETTES ÉTENDUES DE LA ROUE ═════════════════════════════
   « for each type of lipid … headgroup, glycerol and acyl chains », « for each
   type of base … bases, ribose/desoxyribose », « for each type of amino acid …
   backbone and sidechains » — et ces couleurs sont celles que « color by lipid
   type / base type / residue » peint. */
const PARTS = new Function([
  sliceDecl(VIEW, 'DEFAULT_ELEMENT_COLOR'),
  sliceDecl(VIEW, 'LIPID_TYPE_ORDER'),
  sliceObject(VIEW, 'LIPID_CLASS_COLORS'),
  sliceFn(VIEW, 'lipidPartDefaults'),
  sliceDecl(VIEW, 'LIPID_PART_DEFAULTS'),
  sliceObject(VIEW, 'BASE_IDENTITY_COLORS'),
  sliceObject(VIEW, 'BASE_SUGAR_COLORS'),
  sliceObject(VIEW, 'RESIDUE_COLOR_PALETTE'),
  sliceDecl(VIEW, 'RESIDUE_ORDER'),
  sliceFn(VIEW, 'residuePartDefaults'),
  sliceDecl(VIEW, 'RESIDUE_PART_DEFAULTS'),
  sliceFn(VIEW, 'mergePartPalette'),
  'return { LIPID_TYPE_ORDER, LIPID_CLASS_COLORS, LIPID_PART_DEFAULTS, BASE_IDENTITY_COLORS, BASE_SUGAR_COLORS, RESIDUE_COLOR_PALETTE, RESIDUE_ORDER, RESIDUE_PART_DEFAULTS, mergePartPalette };',
].join('\n'))();

// 1) Les lipides : trois parties par classe, et elles partent de la couleur de
// la classe (rien ne bouge tant que l'utilisateur ne les sépare pas).
eq(Object.keys(PARTS.LIPID_PART_DEFAULTS).sort(), [...PARTS.LIPID_TYPE_ORDER].sort(),
  'une entrée par type de lipide, et aucune de plus');
PARTS.LIPID_TYPE_ORDER.forEach((k) => {
  eq(Object.keys(PARTS.LIPID_PART_DEFAULTS[k]).sort(), ['acyl', 'glycerol', 'head'],
    `${k} : les trois parties demandées (tête · glycérol · chaînes)`);
  ['head', 'glycerol', 'acyl'].forEach((p) => eq(PARTS.LIPID_PART_DEFAULTS[k][p], PARTS.LIPID_CLASS_COLORS[k],
    `${k} · ${p} part de la couleur de SA classe`));
});

// 2) Les bases : deux pastilles chacune (la base existe déjà, le ribose est la
// nouvelle) — et le ribose part de la couleur de sa base.
eq(Object.keys(PARTS.BASE_SUGAR_COLORS).sort(), ['A', 'C', 'G', 'T', 'U'],
  'une pastille de ribose / 2′-désoxyribose par base');
Object.keys(PARTS.BASE_SUGAR_COLORS).forEach((b) => eq(PARTS.BASE_SUGAR_COLORS[b], PARTS.BASE_IDENTITY_COLORS[b],
  `${b} : le ribose part de la couleur de sa base`));

// 3) Les résidus : deux parties chacun (squelette · chaînes), mêmes défauts.
eq(Object.keys(PARTS.RESIDUE_PART_DEFAULTS).sort(), [...PARTS.RESIDUE_ORDER].sort(),
  'une entrée par acide aminé, et aucune de plus');
PARTS.RESIDUE_ORDER.forEach((r) => {
  eq(Object.keys(PARTS.RESIDUE_PART_DEFAULTS[r]).sort(), ['backbone', 'sidechain'],
    `${r} : squelette + chaînes latérales`);
  eq(PARTS.RESIDUE_PART_DEFAULTS[r].backbone, PARTS.RESIDUE_COLOR_PALETTE[r],
    `${r} : le squelette part de la couleur du résidu`);
  eq(PARTS.RESIDUE_PART_DEFAULTS[r].sidechain, PARTS.RESIDUE_COLOR_PALETTE[r],
    `${r} : les chaînes latérales aussi`);
});


// 4) La garde d'une palette IMBRIQUÉE : une classe connue, une partie connue, une
// couleur finie — tout le reste est ignoré (un localStorage édité à la main ne
// peut pas peindre une partie que les schémas ne lisent pas).
const merged = PARTS.mergePartPalette(PARTS.LIPID_PART_DEFAULTS, {
  PC: { head: 0x123456, glycerol: 'bleu', x: 1 },
  ZZ: { head: 0xffffff },
});
eq(merged.PC.head, 0x123456, 'une couleur écrite par l’utilisateur est reprise');
eq(merged.PC.glycerol, PARTS.LIPID_CLASS_COLORS.PC, '…une valeur qui n’est pas une couleur est ignorée');
ok(!('x' in merged.PC), '…une partie inconnue n’est jamais ajoutée');
ok(!('ZZ' in merged), '…pas plus qu’une classe inconnue');
eq(Object.keys(merged).sort(), [...PARTS.LIPID_TYPE_ORDER].sort(), 'le résultat garde EXACTEMENT les clés connues');
eq(PARTS.mergePartPalette(PARTS.RESIDUE_PART_DEFAULTS, null).ALA,
  PARTS.RESIDUE_PART_DEFAULTS.ALA, 'sans entrée enregistrée, les défauts sont rendus (copie, pas la référence)');

// 5) Les marqueurs : la roue dessine les pastilles, les schémas lisent les parties.
has('Lipid types · headgroup (H) / glycerol (G) / acyl chains (A)',
  'la roue a un bloc « trois parties » pour les lipides');
has('Amino acids · backbone (B) / side chains (S)', '…un bloc « squelette / chaînes » pour les résidus');
has('{BASE_TYPE_ORDER.map((b) => (', '…et les pastilles de ribose des bases, à côté de celles des bases');
has('onChange={(e) => setBaseSugarColors((p) => ({ ...p, [b]: parseInt(e.target.value.slice(1), 16) }))}',
  'la pastille du ribose écrit SA table');
has('onChange={(e) => setResiduePartColors((p) => ({ ...p, [res]: { ...p[res], backbone: parseInt(e.target.value.slice(1), 16) } }))}',
  'la pastille « squelette » écrit la sienne (sans perdre celle des chaînes)');
has('onChange={(e) => setLipidPartColors((p) => ({ ...p, [k]: { ...p[k], [part]: parseInt(e.target.value.slice(1), 16) } }))}',
  '…et les trois pastilles d’une classe écrivent leur ligne entière');
has("const [lipidPartColors, setLipidPartColors] = useState(() => loadPartPalette('labViewerLipidPartColors', LIPID_PART_DEFAULTS));",
  'les trois parties des lipides sont un état persisté');
has("const [baseSugarColors, setBaseSugarColors] = useState(() => loadPartPalette('labViewerBaseSugarColors', BASE_SUGAR_COLORS));",
  '…le ribose des bases aussi');
has("const [residuePartColors, setResiduePartColors] = useState(() => loadPartPalette('labViewerResiduePartColors', RESIDUE_PART_DEFAULTS));",
  '…et le squelette / les chaînes des résidus aussi');
has('const mergePartPalette = (defaults, raw) => {', 'la garde des palettes imbriquées est UNE fonction');
has('const loadPartPalette = (key, defaults) => {', '…avec son lecteur de stockage');
['labViewerLipidPartColors', 'labViewerBaseSugarColors', 'labViewerResiduePartColors'].forEach((k) => {
  has(`savePalette('${k}'`, `la palette ${k} est écrite dans le stockage`);
});
has("setLipidPartColors(paletteDefaults('labViewerLipidPartColors', LIPID_PART_DEFAULTS, mergePartPalette))", 'le ↺ des lipides revient aux couleurs ENREGISTRÉES par l’utilisateur (voir paletteDefaults)');
has("setResiduePartColors(paletteDefaults('labViewerResiduePartColors', RESIDUE_PART_DEFAULTS, mergePartPalette))", '…et celui des résidus aussi');
// Les trois schémas lisent la PART de l'atome (exécuté dans _viewer_scheme_test.mjs).
has('const part = lipidAtomPart(atom);', 'lab-lipid-class lit la part de chaque atome');
has('const part = proteinAtomPart(atom && atom.atomname);', 'lab-residue lit celle de chaque atome');
has("if (base && nucleicGroupOf(atom && atom.atomname) === 'pentose') return baseSugarColorOf(base);",
  'lab-base-type sépare les atomes primés (le ribose) du reste');

/* ── Bilan ───────────────────────────────────────────────────────────────── */
console.log(`_viewer_selected_space_test.mjs — ${passed} assertions OK`);
