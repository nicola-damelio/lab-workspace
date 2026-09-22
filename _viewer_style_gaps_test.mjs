/* =========================================================================
   _viewer_style_gaps_test.mjs — LES SIX DÉFAUTS DU RAPPORT « styling window ».

   Le rapport, mot pour mot, et ce que cette suite empêche de revenir :

     1. « in this file the viewer did not store phospholipids in the styling
        window. they were ignored. » — le fichier est un GRAND SYSTÈME (40 504
        atomes, 2,8 Mo). Le catalogue des sections n'était alimenté que par le
        chemin NON léger : un système au-delà des seuils ouvrait donc une barre de
        style VIDE, sans protéine, sans lipide, sans eau — aucun contrôle de style
        n'existait. addDefaultReps énumère maintenant les sections AVANT le bloc
        léger (et le dessin léger lui-même ne bouge pas) ;
     2. « in the ligand menu there is color by sugar type (should not be there). »
        — la rangée d'un LIGAND lisait COLORS.sugar : sa liste « Color by »
        proposait la palette des sucres, qui ne dit rien là où aucun sucre n'est
        dessiné. Les ligands ont leur propre liste ;
     3. « it is possible to color by chain but there is no way to define the color
        of the chain in the setting wheel. » — « Chain » peignait avec le schéma
        `chainid` de NGL, dont AUCUN contrôle du viewer ne pouvait changer une
        couleur. Un schéma maison (lab-chain) lit la palette éditable de la roue ⚙
        (A → H + le gris « other ») ;
     4. « The electrostatic potential is not calculated in the ligand. » — le
        `chargeForAtom` de NGL rend 0 pour tout atome NON protéique : la surface
        d'un ligand était blanche partout. Un schéma maison (lab-esp) calcule le
        MÊME potentiel mais donne une charge à chaque atome : celle du fichier, la
        table CHARMM de NGL pour une protéine, une estimation par électronégativité
        pour le reste, et la charge formelle d'un ion ;
     5. « the color by gradient does not seem to work in some cases. » — les bornes
        de la rampe étaient mesurées APRÈS la boucle de dessin (une représentation
        lit ses couleurs quand NGL la construit : le premier dessin prenait donc la
        PREMIÈRE couleur), et le magasin ne gardait que les bornes du DERNIER
        composant dessiné. Elles sont maintenant mesurées avant le dessin et
        mémorisées PAR STRUCTURE ;
     6. « in phospholipids, proteins and nucleic acids when general (type or
        colouring) is changed the other molecule parts (backbone, side chain,
        bases, acyl chain, glycerol etc) must be on hide. » — la rangée General est
        devenue EXCLUSIVE : un style ou une coloration choisis là mettent les
        autres rangées de la molécule sur « Hide », et une rangée revient en
        choisissant SON style.

   Le viewer est un .jsx : les helpers PURS sont EXTRAITS du fichier puis EXÉCUTÉS,
   et le VRAI NGL 2.4 (celui de la page) est utilisé là où cela compte : le schéma
   de potentiel est enregistré et interrogé sur une structure réellement parsée.
   VIEWER_SRC rejoue la suite sur une version d'avant les correctifs : elle doit
   alors ÊTRE ROUGE.
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
const near = (a, b, what, tol = 1e-4) => ok(Math.abs(a - b) < tol, `${what}\n  attendu ≈ ${b}, obtenu ${a}`);

const SRC = process.env.VIEWER_SRC || new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url);
const VIEW = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
const gone = (needle, what) => ok(!VIEW.includes(needle), `${what}\n  encore présent : ${needle}`);
const countOf = (re) => (VIEW.match(re) || []).length;

/* ── Extraction : le comptage de profondeur lit un MASQUE où les commentaires sont
   remplacés par des espaces de même longueur — sans quoi les parenthèses de la
   prose (les blocs de documentation de ce fichier en sont pleins) faussaient la
   fin d'un `const` et la tranche avalait la déclaration suivante. ───────────── */
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
  // Le corps d'une flèche : l'accolade IMMÉDIATEMENT après `=>` (rien entre les
  // deux). Un défaut de paramètre (`opts = {}`) ou un corps d'expression
  // (`(a) => (a ? {…} : {…})`) ne doit pas être pris pour le corps — c'est le
  // défaut qui faisait trancher `sectionRowSele` au milieu de sa signature.
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

/* ══ 1. UN GRAND SYSTÈME ÉNUMÈRE AUSSI SES SECTIONS ════════════════════════
   Le fichier du rapport (AA2.gro : 40 504 atomes, protéine + POPC + SOD/CLA +
   TIP3) dépasse les deux seuils, donc il partait en rendu léger — et le rendu
   léger sortait d'addDefaultReps AVANT l'énumération des sections : la barre de
   style s'ouvrait VIDE. C'est ce que « the phospholipids were ignored » veut
   dire : il n'y avait pas de place de phospholipide du tout. */
const iEnsure = VIEW.indexOf('ensureSections(component, molKey);');
const iLight = VIEW.indexOf('if (lightRenderRef.current) {');
ok(iEnsure > 0 && iLight > 0 && iEnsure < iLight,
  'addDefaultReps énumère les sections AVANT le bloc du rendu léger');
has('the viewer did not store phospholipids in the styling window. they',
  '…et le code dit pourquoi (le rapport du fichier de phospholipides)');

// Le comportement, sur un VRAI appel : un composant léger reçoit toujours le
// catalogue des sections, et le dessin léger reste UNE représentation.
const ADD = new Function(`
  let added = [];
  let ensureCalls = 0;
  let light = false;
  const ensureSections = () => { ensureCalls += 1; return [{ id: 'main::lipid|POPC', key: 'lipid|POPC', kind: 'lipid' }]; };
  const componentRef = { current: null };
  const baseCompsRef = { current: [] };
  const lightRenderRef = { get current() { return light; }, set current(v) { light = v; } };
  const largeStyleRef = { current: 'lines' };
  const showLargeWaterRef = { current: false };
  const rebuildSectionsOf = () => [];
  const component = {
    structure: {},
    addRepresentation: (type) => { added.push(type); return { type }; },
    removeRepresentation: () => {},
  };
${sliceFn(VIEW, 'addDefaultReps')}
  return {
    addDefaultReps,
    component,
    setLight: (v) => { light = v; },
    setAdded: () => { added = []; },
    added: () => added,
    ensureCalls: () => ensureCalls,
  };
`)();
ADD.setLight(true);
ADD.addDefaultReps(ADD.component, 'main');
eq(ADD.ensureCalls(), 1,
  'un GRAND système passe bien par le catalogue des sections (la barre de style n’est plus vide)');
eq(ADD.added(), ['line'], '…et son rendu léger reste UNE représentation « line »');
ADD.setAdded();
ADD.setLight(false);
ADD.addDefaultReps(ADD.component, 'main');
eq(ADD.ensureCalls(), 2, 'un système normal énumère ses sections par le même chemin');
eq(ADD.added(), [], '…et là, ce sont les SECTIONS qui dessinent');
has('{Object.keys(sectionCatalog).length === 0 && (',
  'la barre garde son message pour le cas où AUCUNE section n’existe');

/* ══ 2. LA RANGÉE D'UN LIGAND N'OFFRE PLUS « SUGAR TYPE » ═══════════════════
   Le rapport : « in the ligand menu there is color by sugar type (should not be
   there) ». La rangée d'un ligand lisait la liste des SUCRES — un copier-coller :
   la palette d'identité des sucres ne dit rien là où aucun sucre n'est dessiné. */
const SPECS = new Function([
  sliceObject(VIEW, 'STYLES'),
  sliceObject(VIEW, 'COLORS'),
  sliceObject(VIEW, 'SECTION_SUBSECTIONS'),
  'return { STYLES, COLORS, SECTION_SUBSECTIONS };',
].join('\n'))();
const { COLORS, SECTION_SUBSECTIONS: SUBS } = SPECS;
ok(Array.isArray(COLORS.ligand), 'COLORS a une liste propre aux LIGANDS');
ok(!COLORS.ligand.includes('sugar'), '…qui n’offre PLUS « Sugar type »');
ok(!COLORS.ligand.includes('glycan'), '…ni la lecture des glycanes liés');
ok(['solid', 'element'].every((c) => COLORS.ligand.includes(c)),
  '…mais garde les colorations qui ont un sens pour un ligand (Solid · Atom type)');
eq(SUBS.ligand[0].colors, COLORS.ligand, 'la rangée du ligand lit SA liste');
ok(SUBS.sugar[0].colors.includes('sugar'), 'le menu des SUCRES, lui, garde « Sugar type »');
eq(countOf(/colors: COLORS\.ligand,/g), 1, 'une seule rangée porte la liste des ligands');
ok(!/ligand: \[\{[^}]*COLORS\.sugar/.test(VIEW), 'aucune rangée de ligand ne lit plus celle des sucres');

/* ── 2b. Les IONS d'un .gro ne sont plus des ligands « organiques » ──────────
   NGL lit l'ÉLÉMENT dans le nom de l'atome : « SOD » donne S et « CLA » donne C,
   donc un sodium et un chlorure devenaient des ligands organiques (avec la
   coloration « Hydrophobicity » et la liste des ligands du rapport). Le nom du
   RÉSIDU est la seule source honnête là. */
const CLS = new Function([
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
  'return { classifySectionResidue, LABEL_ION_RESNAMES };',
].join('\n'))();
const res = (resname, atomNames, elements) => ({
  resname, atomNames: new Set(atomNames), elements: new Set(elements), count: atomNames.length,
});
eq(CLS.classifySectionResidue(res('SOD', ['SOD'], ['S'])), 'ion',
  'un sodium de .gro (SOD, élément deviné « S ») est un ION, pas un ligand');
eq(CLS.classifySectionResidue(res('CLA', ['CLA'], ['C'])), 'ion', '…et un chlorure aussi');
eq(CLS.classifySectionResidue(res('TIP3', ['OH2', 'H1', 'H2'], ['O', 'H', 'H'])), 'water',
  'l’eau du même fichier reste de l’eau');
eq(CLS.classifySectionResidue(res('POPC', ['P', 'N', 'C1', 'C21'], ['P', 'N', 'C', 'C'])), 'lipid',
  '…et le POPC est bien un LIPIDE (il a donc sa place dans la barre)');
eq(CLS.classifySectionResidue(res('LIG', ['C1', 'C2', 'O1'], ['C', 'C', 'O'])), 'ligand',
  'un vrai ligand reste un ligand');

/* ══ 3. LA COULEUR DES CHAÎNES SE DÉFINIT DANS LA ROUE ═════════════════════
   « it is possible to color by chain but there is no way to define the color of
   the chain in the setting wheel » : « Chain » passait par le schéma `chainid` de
   NGL, dont la table est interne au bundle. Un schéma maison lit maintenant la
   palette éditable — et la roue a une section À ELLE. */
const CHAIN = new Function('NGL', [
  sliceObject(VIEW, 'CHAIN_COLOR_PALETTE'),
  sliceDecl(VIEW, 'CHAIN_COLOR_ORDER'),
  sliceObject(VIEW, 'chainColorStore'),
  'let chainSchemeKey = null;',
  sliceFn(VIEW, 'chainColorOf'),
  sliceFn(VIEW, 'defineChainScheme'),
  sliceFn(VIEW, 'registerColorScheme'),
  'return { CHAIN_COLOR_PALETTE, CHAIN_COLOR_ORDER, chainColorStore, chainColorOf, defineChainScheme, registerColorScheme };',
].join('\n'))(NGL);
eq(CHAIN.CHAIN_COLOR_ORDER, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'other'],
  'la palette couvre les huit lettres de chaîne et le gris « other »');
eq(Object.keys(CHAIN.CHAIN_COLOR_PALETTE).sort(), [...CHAIN.CHAIN_COLOR_ORDER].sort(),
  'la liste de la roue et la table du schéma sont EXACTEMENT les mêmes clés');
CHAIN.CHAIN_COLOR_ORDER.forEach((c) => ok(/^[0-9a-f]{6}$/.test(CHAIN.CHAIN_COLOR_PALETTE[c].toString(16).padStart(6, '0')),
  `« ${c} » a une couleur 0xRRGGBB valide`));
eq(CHAIN.chainColorOf('A'), CHAIN.CHAIN_COLOR_PALETTE.A, 'la chaîne A prend son swatch');
eq(CHAIN.chainColorOf('b'), CHAIN.CHAIN_COLOR_PALETTE.B, '…sans tenir compte de la casse');
eq(CHAIN.chainColorOf(' A '), CHAIN.CHAIN_COLOR_PALETTE.A, '…ni des espaces d’un fichier mal aligné');
eq(CHAIN.chainColorOf(''), CHAIN.CHAIN_COLOR_PALETTE.other, 'une chaîne sans nom prend « other »');
eq(CHAIN.chainColorOf(null), CHAIN.CHAIN_COLOR_PALETTE.other, '…même sans nom du tout (jamais du noir)');
eq(CHAIN.chainColorOf('Z'), CHAIN.CHAIN_COLOR_PALETTE.other, '…et une lettre hors table aussi');

// La palette est VIVANTE : le schéma est enregistré dans le VRAI NGL et repeint
// dès qu'un swatch bouge (aucun schéma n'est réenregistré, rien n'est reconstruit).
const chainKey = CHAIN.registerColorScheme(NGL, 'lab-test-chain', CHAIN.defineChainScheme());
ok(typeof chainKey === 'string' && chainKey.length > 0, 'le schéma lab-chain s’enregistre dans NGL');
const chainCm = NGL.ColormakerRegistry.getScheme({ scheme: chainKey });
eq(chainCm.atomColor({ chainname: 'A' }), CHAIN.CHAIN_COLOR_PALETTE.A, 'NGL peint la chaîne A avec le swatch A');
eq(chainCm.atomColor({ chainname: 'g' }), CHAIN.CHAIN_COLOR_PALETTE.G, '…la chaîne g avec le swatch G');
eq(chainCm.atomColor({ chainname: '9' }), CHAIN.CHAIN_COLOR_PALETTE.other, '…une chaîne inconnue avec « other »');
CHAIN.chainColorStore.A = 0x123456;
eq(chainCm.atomColor({ chainname: 'A' }), 0x123456,
  'déplacer le swatch A repeint la chaîne A SANS réenregistrer le schéma');
CHAIN.chainColorStore.A = CHAIN.CHAIN_COLOR_PALETTE.A;

// La rangée de la barre et la roue offrent le contrôle, et « Chain » passe bien par
// le schéma maison (avec `chainid` en repli si l'enregistrement a échoué).
has("{look.colorBy === 'chain' && (", 'la rangée « Color by » montre le ⚙ dès que « Chain » est choisi');
has('Chains · color by chain', 'la roue ⚙ a une section À ELLE pour les chaînes');
has('{CHAIN_COLOR_ORDER.map((c) => (', '…qui dessine la MÊME liste que le schéma');
has('onClick={() => setChainColors({ ...CHAIN_COLOR_PALETTE })}', '…avec son ↺ Defaults');
has("const [chainColors, setChainColors] = useState(() => loadPalette('labViewerChainColors', CHAIN_COLOR_PALETTE));",
  'la palette de chaînes est un état persisté comme les autres');
has("try { localStorage.setItem('labViewerChainColors', JSON.stringify(chainColors)); } catch { /* ignore */ }",
  '…et elle est bien écrite dans le stockage (elle survit à un rechargement)');
has('if (pal.chains) setChainColors((p) => mergePalette(CHAIN_COLOR_PALETTE, { ...p, ...pal.chains }));',
  '…et elle voyage avec un setup ⚙️ enregistré');
has('registerChainScheme(NGL);        // 🔗 one editable colour per CHAIN (lab-chain)',
  'le schéma est enregistré au démarrage de la scène, comme les autres');
const makeColorParams = (chainKeyValue) => new Function([
  sliceObject(VIEW, 'DEFAULT_ATOM_COLORS'),
  sliceObject(VIEW, 'KIND_CATEGORY'),
  sliceDecl(VIEW, 'DEFAULT_ELEMENT_COLOR'),
  'let elementSchemeKey = null; let residueSchemeKey = null; let baseTypeSchemeKey = null;',
  'let sstrucSchemeKey = null; let sugarSchemeKey = null; let glycanSchemeKey = null;',
  'let lipidClassSchemeKey = null; let nucleicFormSchemeKey = null; let nucleicMotifSchemeKey = null;',
  'let chargeSchemeKey = null; let espSchemeKey = null;',
  `let chainSchemeKey = ${JSON.stringify(chainKeyValue)};`,
  'const espColorParams = () => ({ colorScheme: "esp" });',
  sliceDecl(VIEW, 'schemeParam'),
  sliceFn(VIEW, 'sectionColorParams'),
  'return sectionColorParams;',
].join('\n'))();
eq(makeColorParams('lab-chain-key')({ colorBy: 'chain' }, 'protein'), { color: 'lab-chain-key' },
  '« Chain » d’une rangée passe par le SCHÉMA MAISON (la palette de la roue)');
eq(makeColorParams(null)({ colorBy: 'chain' }, 'protein'), { colorScheme: 'chainid' },
  '…et retombe sur le `chainid` de NGL si le schéma n’a pas pu être enregistré');

/* ══ 4. LE POTENTIEL ÉLECTROSTATIQUE D'UN LIGAND ═══════════════════════════
   « The electrostatic potential is not calculated in the ligand. » — le
   `chargeForAtom` de NGL se termine par « if (!a.isProtein()) return 0.0 » : tout
   atome non protéique a une charge NULLE, donc une surface blanche partout. Le
   schéma lab-esp donne une charge à chaque atome. Vérifié sur une structure
   réellement parsée par le VRAI NGL. */
globalThis.FileReader = class {
  readAsText(blob) {
    Promise.resolve(blob.text()).then((t) => {
      this.result = t;
      if (typeof this.onload === 'function') this.onload({ target: this });
    });
  }
};
const ESP_PDB = [
  'ATOM      1  N   ALA A   1      11.104   6.134  -6.504  1.00  0.00           N',
  'ATOM      2  CA  ALA A   1      11.639   6.071  -5.131  1.00  0.00           C',
  'ATOM      3  C   ALA A   1      13.149   6.136  -5.106  1.00  0.00           C',
  'ATOM      4  O   ALA A   1      13.788   5.252  -5.588  1.00  0.00           O',
  'HETATM    5  C1  LIG B 101      -2.000   3.000   1.000  1.00  0.00           C',
  'HETATM    6  O1  LIG B 101      -1.000   3.500   1.500  1.00  0.00           O',
  'HETATM    7  N1  LIG B 101      -3.000   3.800   0.800  1.00  0.00           N',
  'HETATM    8  SOD SOD C 102       6.000   6.000   6.000  1.00  0.00           NA',
  'END',
].join('\n');

const ESP = new Function('NGL', [
  'const window = { NGL };   // le code extrait lit `window.NGL`, comme dans la page',
  sliceDecl(VIEW, 'ESP_MAX_RADIUS'),
  sliceDecl(VIEW, 'ESP_KCAL'),
  sliceDecl(VIEW, 'ESP_NEUTRAL_REFERENCE'),
  sliceDecl(VIEW, 'ESP_CHARGE_PER_UNIT'),
  sliceObject(VIEW, 'ESP_ELECTRONEGATIVITY'),
  sliceObject(VIEW, 'ESP_ION_CHARGES'),
  sliceFn(VIEW, 'espHeteroChargeOf'),
  sliceDecl(VIEW, 'espChargeCache'),
  sliceFn(VIEW, 'espChargesFor'),
  'let espSchemeKey = null;',
  sliceFn(VIEW, 'defineEspScheme'),
  sliceFn(VIEW, 'registerColorScheme'),
  'return { ESP_ION_CHARGES, ESP_ELECTRONEGATIVITY, espHeteroChargeOf, espChargesFor, defineEspScheme, registerColorScheme };',
].join('\n'))(NGL);

// 4a. L'estimation par électronégativité, seule règle utilisable quand le fichier
// ne donne ni charges ni liaisons (un PDB sans CONECT).
ok(ESP.espHeteroChargeOf('O') < 0, 'un OXYGÈNE d’un ligand reçoit une charge NÉGATIVE');
ok(ESP.espHeteroChargeOf('N') < 0, 'un AZOTE aussi');
ok(ESP.espHeteroChargeOf('Na') > 0, 'un sodium une charge positive');
ok(ESP.espHeteroChargeOf('C') > -0.05 && ESP.espHeteroChargeOf('C') < 0.05, 'un carbone reste quasi neutre');
eq(ESP.espHeteroChargeOf('Xx'), 0, 'un élément inconnu est neutre (jamais un pôle inventé)');
eq(ESP.espHeteroChargeOf(''), 0, '…et une case vide aussi');
near(ESP.espHeteroChargeOf('O'), -0.329, 'la valeur est celle de la calibration annoncée (0.35 × (2.5 − 3.44))', 1e-3);
ok(Math.abs(ESP.espHeteroChargeOf('F')) <= 1, 'aucune charge estimée ne dépasse ±1 e');

const espKey = ESP.registerColorScheme(NGL, 'lab-test-esp', ESP.defineEspScheme());
ok(typeof espKey === 'string' && espKey.length > 0, 'le schéma lab-esp s’enregistre dans le vrai NGL');

const st = await NGL.autoLoad(new Blob([ESP_PDB], { type: 'text/plain' }), { ext: 'pdb' });
const charges = ESP.espChargesFor(st);
ok(!!charges, 'les charges d’une structure se calculent (lazy, une fois)');
eq(charges.charges.length, st.atomCount, '…une charge par atome');
ok(ESP.espChargesFor(st) === charges, '…et le calcul est mémorisé (pas deux fois le même parcours)');
// Le LIGAND : ses hétéro-atomes portent enfin une charge, et le résidu est neutre.
ok(charges.charges[5] < 0, 'l’oxygène du ligand a une charge négative (NGL lui donnait 0)');
ok(charges.charges[6] < 0, '…l’azote aussi');
near(charges.charges[4] + charges.charges[5] + charges.charges[6], 0,
  '…et la somme du résidu est nulle (un ligand n’est pas un ion)', 1e-5);
eq(charges.charges[7], 1, 'un sodium SOD prend sa charge FORMELLE (+1)');
// La PROTÉINE garde la table CHARMM de NGL, au chiffre près.
const base = NGL.ColormakerRegistry.getScheme({ scheme: 'electrostatic', structure: st });
[0, 1, 2, 3].forEach((i) => eq(charges.charges[i], base.charges[i],
  `l’atome protéique ${i} garde la charge CHARMM de NGL`));

// 4b. Le schéma peint vraiment : rouge sur l'oxygène du ligand, bleu sur le sodium.
const cm = NGL.ColormakerRegistry.getScheme({ scheme: espKey, structure: st, colorScale: 'rwb', colorDomain: [-15, 15] });
const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
// Un point de la SURFACE : à ~1,3 Å du noyau, jamais exactement dessus (c'est là
// que passe une surface NGL, et un point sur le noyau diviserait par zéro).
const nearPoint = (i, d = 1.3) => { const a = st.getAtomProxy(i); return { x: a.x + d, y: a.y, z: a.z }; };
const at = (i) => { const a = st.getAtomProxy(i); return { x: a.x, y: a.y, z: a.z }; };
const oCol = rgb(cm.positionColor(nearPoint(5)));
const naCol = rgb(cm.positionColor(nearPoint(7)));
ok(oCol[0] > oCol[2], `la surface est ROUGE à l’oxygène du ligand (${oCol})`);
ok(naCol[2] > naCol[0], `…et BLEUE au sodium (${naCol})`);
ok(cm.positionColor({ x: 200, y: 200, z: 200 }) !== undefined, 'loin de la molécule, un potentiel est rendu (≈ neutre)');
ok(Number.isFinite(cm.positionColor(at(5))), 'un point EXACTEMENT sur un noyau ne casse pas la rampe');
// Le ± de la commande « ⚡ Range » change VRAIMENT la rampe. Les limites arrivent
// à la surface sous les noms `scale` / `domain` (Buffer#getColorParams) : c'est
// cette forme-là que NGL utilise en vrai, et l'instance neuve les reçoit.
const cmWide = NGL.ColormakerRegistry.getScheme({ scheme: espKey, structure: st, scale: 'rwb', domain: [-500, 500] });
eq(cmWide.parameters.domain, [-500, 500], 'une instance neuve reçoit bien les bornes demandées');
const wideCol = rgb(cmWide.positionColor(nearPoint(5)));
// La rampe rouge → blanc → bleu garde le canal rouge près de 255 : c'est la
// SATURATION (le vert + le bleu) qui dit si l'on est au pôle ou près du blanc.
ok(wideCol[1] + wideCol[2] > oCol[1] + oCol[2],
  `élargir les bornes (±500) désature le rouge (${wideCol} contre ${oCol})`);
// L'atome lui-même prend la couleur du potentiel (ruban / liaisons d'une rangée ESP).
const oAt = rgb(cm.atomColor({ index: 5 }));
ok(oAt[0] > oAt[2], '…et l’ATOME de cet oxygène est rouge lui aussi');
// Un schéma sans structure ne peint jamais du noir.
const cmNoStruct = NGL.ColormakerRegistry.getScheme({ scheme: espKey });
eq(cmNoStruct.positionColor({ x: 0, y: 0, z: 0 }), 0xffffff, 'sans structure, la couleur reste le blanc neutre');
eq(cmNoStruct.atomColor({ index: 0 }), 0xffffff, '…et l’atome aussi (jamais du noir)');

// 4c. Le viewer s'en sert partout où il peignait un potentiel.
has("if (espSchemeKey) return { color: espSchemeKey, colorScale: 'rwb', colorDomain: [-neg, pos] };",
  'espColorParams passe par le schéma maison…');
has("return { colorScheme: 'electrostatic', colorScale: 'rwb', colorDomain: [-neg, pos] };",
  '…et garde le schéma de NGL en repli (une surface est toujours peinte)');
has('...espColorParams(),', 'l’overlay ⚡ ESP du viewer utilise le MÊME espColorParams');
has('registerEspScheme(NGL);          // ⚡ the potential of a ligand too (lab-esp)',
  'le schéma est enregistré au démarrage de la scène');
has('if (!a.isProtein()) return 0.0', 'le code cite la règle de NGL qui laissait le ligand blanc');

/* ══ 5. LE DÉGRADÉ : MESURÉ AVANT LE DESSIN, ET PAR STRUCTURE ══════════════
   « the color by gradient does not seem to work in some cases. » Deux causes :
   les bornes étaient mesurées APRÈS la boucle de dessin (une représentation lit ses
   couleurs quand NGL la construit → le premier dessin prenait la première couleur,
   la rampe n'apparaissait qu'au rebuild suivant), et le magasin ne gardait que les
   bornes du DERNIER composant dessiné. */
const SCHEME_KEYS = [
  'let elementSchemeKey = "k-element"; let residueSchemeKey = "k-residue"; let baseTypeSchemeKey = "k-base";',
  'let sstrucSchemeKey = "k-sstruc"; let sugarSchemeKey = "k-sugar"; let glycanSchemeKey = "k-glycan";',
  'let lipidClassSchemeKey = "k-lipid"; let nucleicFormSchemeKey = "k-form"; let nucleicMotifSchemeKey = "k-motif";',
  'let chargeSchemeKey = "k-charge"; let chainSchemeKey = "k-chain"; let gradientSchemeKey = "k-gradient";',
].join('\n');
const GRAD = new Function([
  sliceDecl(VIEW, 'LICORICE_BOND_RADIUS'),
  sliceDecl(VIEW, 'BALLSTICK_BOND_RADIUS'),
  sliceDecl(VIEW, 'BASE_BOND_RADIUS'),
  sliceFn(VIEW, 'sectionOpacity'),
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
  'const DEFAULT_GRADIENT_COLORS = { from: 0x2563eb, to: 0xdc2626 };',
  sliceObject(VIEW, 'gradientColorStore'),
  sliceFn(VIEW, 'lerpHexColors'),
  sliceFn(VIEW, 'gradientT'),
  sliceObject(VIEW, 'DEFAULT_NUCLEIC_COLORS'),
  'const espColorParams = () => ({ colorScheme: "esp" });',
  'const flagMeshShadows = () => {};',
  'const nucleicRingPlates = () => null;',
  // Le VRAI `gradientRangesFor` est remplacé par un mouchard : c'est l'ORDRE des
  // appels qui est en cause, pas la mesure elle-même.
  'const events = [];',
  'const gradientRangesFor = (structure, sele) => { events.push(`ranges:${sele}`); return { all: [0, 10] }; };',
  sliceFn(VIEW, 'buildSectionReps'),
  'return { buildSectionReps, gradientColorStore, gradientT, lerpHexColors, events };',
].join('\n'))();
const GRAD_SECTION = [{ id: 'main::protein|A', key: 'protein|A', kind: 'protein', name: 'Chain A', sele: ':A and protein', count: 1 }];
const gradTree = (colorBy) => ({
  protein: {
    general: { style: 'cartoon', colorBy, solidColor: 0xffffff, opacity: 0, sphere: 1, bond: 1, follow: false },
    backbone: { style: 'cartoon', colorBy: 'sstruc', solidColor: 0xffffff, opacity: 0, sphere: 1, bond: 1, follow: false },
    sidechain: { style: 'licorice', colorBy: 'element', solidColor: 0xffffff, opacity: 0, sphere: 1, bond: 1, follow: false },
  },
});
const gradRenderer = (structure) => {
  const reps = [];
  const comp = {
    structure: structure || { eachAtom: () => {} },
    addRepresentation(type, params) {
      reps.push({ type, rangesAtBuild: GRAD.gradientColorStore.ranges ? 'ranges-set' : 'no-ranges' });
      return { type, params };
    },
  };
  return { comp, reps };
};
const gradBuild = (colorBy, structure) => {
  const { comp, reps } = gradRenderer(structure);
  GRAD.gradientColorStore.ranges = null;
  GRAD.events.length = 0;
  GRAD.buildSectionReps(comp, GRAD_SECTION, { 'main::protein|A': gradTree(colorBy) }, {});
  return { reps, events: [...GRAD.events] };
};

const gradOn = gradBuild('gradient');
eq(gradOn.events[0], 'ranges::A and protein',
  'la rampe est MESURÉE AVANT la première représentation (le premier dessin a donc la rampe)');
ok(gradOn.reps.length > 0 && gradOn.reps.every((r) => r.rangesAtBuild === 'ranges-set'),
  '…et CHAQUE représentation est construite avec les bornes déjà en place');
const gradOff = gradBuild('sstruc');
ok(!gradOff.events.some((e) => e.startsWith('ranges:')),
  'sans rangée en dégradé, la mesure n’est pas faite du tout (aucun parcours inutile)');
eq(GRAD.gradientColorStore.ranges, null, '…et le magasin reste vide');

// Les bornes sont gardées PAR STRUCTURE : deux molécules ne se marchent plus dessus.
const stA = { eachAtom: () => {} };
const stB = { eachAtom: () => {} };
gradBuild('gradient', stA);
gradBuild('sstruc', stB);                                    // la 2° molécule, SANS rampe
eq(GRAD.gradientColorStore.ranges, null, 'dessiner une molécule sans rampe laisse `ranges` vide…');
const aT = GRAD.gradientT({ structure: stA, chainIndex: 0, residueIndex: 5 });
eq(aT, 0.5, '…mais l’atome de la PREMIÈRE molécule lit toujours SA rampe (t = 0,5 au milieu)');
eq(GRAD.gradientT({ structure: stB, chainIndex: 0, residueIndex: 5 }), 0,
  'la molécule sans rampe prend la première couleur, comme avant');
const ramp = (t) => GRAD.lerpHexColors(0x000000, 0xffffff, t);
ok(ramp(aT) !== ramp(0) && ramp(aT) !== ramp(1), '…donc une vraie couleur ENTRE les deux, pas un plat');

// Le code le dit : la mesure précède le dessin, et le magasin est par structure.
const iFeed = VIEW.indexOf('gradientColorStore.ranges = gradientRows.length');
const iDraw = VIEW.indexOf('const subLooks = {};', iFeed);
ok(iFeed > 0 && iDraw > 0 && iFeed < iDraw,
  'buildSectionReps alimente la rampe AVANT que la moindre représentation soit préparée');
eq(countOf(/gradientRows\.push\(sec\.sele\)/g), 1,
  '…par UNE seule mesure par composant (le point de la boucle de dessin a disparu)');
has('byStructure: new WeakMap(),', 'le magasin garde les bornes PAR STRUCTURE');
has('const own = byStructure && atom && atom.structure ? byStructure.get(atom.structure) : null;',
  '…et gradientT lit celles de la structure de l’atome');

/* ══ 6. LA RANGÉE GENERAL EST EXCLUSIVE ════════════════════════════════════
   « in phospholipids, proteins and nucleic acids when general (type or colouring)
   is changed the other molecule parts (backbone, side chain, bases, acyl chain,
   glycerol etc) must be on hide. » Un style / une coloration choisis sur General
   décrivent la molécule ENTIÈRE : dessiner en plus les parties par-dessus donnait
   deux dessins des mêmes atomes, la partie gardant même la coloration que General
   venait de remplacer. */
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
  'return { setGeneralSectionField, setRowSectionField, effectiveSectionLook, rowFollowsGeneral, defaultLookOf, SECTION_SUBSECTIONS };',
].join('\n'))();
const lookOf = (tree, kind, sub) => HIER.effectiveSectionLook(tree, kind, sub);
const gen = (tree, kind, sub) => tree[kind][sub] || {};

// 6a. Un STYLE sur General met les parties de la protéine sur « Hide ».
const byStyle = HIER.setGeneralSectionField({}, 'protein', 'style', 'ribbon');
eq(gen(byStyle, 'protein', 'general').style, 'ribbon', 'General prend le style choisi');
eq(gen(byStyle, 'protein', 'general').follow, false, '…et ne suit plus personne');
['backbone', 'sidechain'].forEach((sub) => {
  eq(gen(byStyle, 'protein', sub).style, 'hide', `« ${sub} » passe sur HIDE (une seule description de la molécule)`);
  eq(gen(byStyle, 'protein', sub).follow, false,
    `…et il CESSE de suivre General (sinon General le redessinerait à sa place)`);
  eq(lookOf(byStyle, 'protein', sub).style, 'hide', `…donc la rangée « ${sub} » ne dessine RIEN`);
});
// …et un DEUXIÈME changement de General ne les rallume pas.
const byStyle2 = HIER.setGeneralSectionField(byStyle, 'protein', 'style', 'cartoon');
['backbone', 'sidechain'].forEach((sub) => eq(lookOf(byStyle2, 'protein', sub).style, 'hide',
  `un autre style sur General laisse « ${sub} » caché`));
// …le ↺ de la rangée, lui, la ramène (elle reprend la main sur son propre style).
const reset = { ...byStyle2, protein: { ...byStyle2.protein, backbone: HIER.defaultLookOf('protein', 'backbone') } };
eq(gen(reset, 'protein', 'backbone').style, 'cartoon', 'le ↺ de la rangée rend son style par défaut');
eq(gen(reset, 'protein', 'backbone').follow, true, '…et elle suit de nouveau General');
// 6b. Une COLORATION sur General aussi (le rapport dit « type OR colouring »).
const byColor = HIER.setGeneralSectionField({}, 'protein', 'colorBy', 'element');
eq(gen(byColor, 'protein', 'general').colorBy, 'element', 'General prend la coloration choisie');
['backbone', 'sidechain'].forEach((sub) => eq(gen(byColor, 'protein', sub).style, 'hide',
  `…et « ${sub} » passe sur hide comme pour un style`));
// 6c. Un LIPIDE : tête polaire · chaînes acyle · glycérol.
const lipid = HIER.setGeneralSectionField({}, 'lipid', 'style', 'licorice');
['head', 'tail', 'glycerol'].forEach((sub) => eq(gen(lipid, 'lipid', sub).style, 'hide',
  `le « ${sub} » du lipide passe sur hide (le rapport nomme chaîne acyle et glycérol)`));
// 6d. Un ACIDE NUCLÉIQUE : squelette · bases · ribose.
const nucleic = HIER.setGeneralSectionField({}, 'nucleic', 'style', 'tube');
['backbone', 'bases', 'ribose'].forEach((sub) => eq(gen(nucleic, 'nucleic', sub).style, 'hide',
  `le « ${sub} » de l’acide nucléique passe sur hide`));
// 6e. Les AUTRES champs ne cachent rien : la transparence et les rayons continuent
// de descendre (c’est la règle d’origine, intacte).
const byOpacity = HIER.setGeneralSectionField({}, 'protein', 'opacity', 0.5);
eq(gen(byOpacity, 'protein', 'sidechain').style,
  HIER.defaultLookOf('protein', 'sidechain').style,
  'changer la TRANSPARENCE ne cache pas les parties');
eq(lookOf(byOpacity, 'protein', 'sidechain').opacity, 0.5, '…elle descend bien de General');
// 6f. LE CHEMIN DU RETOUR : choisir un style sur SA rangée (c’est « dévier »).
const back = HIER.setRowSectionField(byStyle, 'protein', 'sidechain', 'style', 'licorice');
eq(gen(back, 'protein', 'sidechain').style, 'licorice', 'la rangée reprend son propre style');
eq(gen(back, 'protein', 'sidechain').follow, false, '…et cesse de suivre General');
eq(lookOf(back, 'protein', 'sidechain').style, 'licorice', '…donc elle redessine ses chaînes latérales');
eq(gen(back, 'protein', 'backbone').style, 'hide', 'les AUTRES rangées restent sur hide');
eq(gen(back, 'protein', 'general').style, 'ribbon', '…et General n’a pas bougé');
// 6g. Une molécule d’UNE seule rangée (ligand · eau · ion) ne casse rien.
['ligand', 'water', 'ion', 'sugar'].forEach((kind) => {
  const t = HIER.setGeneralSectionField({}, kind, 'style', 'spacefill');
  eq(Object.keys(t[kind]), ['general'], `« ${kind} » n’a que sa rangée General`);
  eq(gen(t, kind, 'general').style, 'spacefill', `…qui prend bien le style (${kind})`);
});
// 6h. La barre DIT pourquoi une rangée est vide (sinon le « hide » est un mystère).
has('hidden — choose a style here to bring this part back',
  'la rangée cachée dit qu’elle l’est et comment la ramener');
has('phospholipids, proteins and nucleic acids when general (type or colouring) is',
  '…et le code cite la demande mot pour mot');

/* ══ 7. LE SMILES D'UN LIGAND ORGANIQUE (HETATM → RCSB) ═══════════════════
   Un PDB ne nomme son ligand que par son code à 3 lettres : le SMILES se lit dans
   utils/ligandSmiles.js (testé pour lui-même par _ligand_smiles_test.mjs). Ici, ce
   sont les BRANCHEMENTS qui sont vérifiés : le viewer résout le code du ligand
   qu'il a réellement trouvé et le DIT, et le docking a retrouvé sa sous-section
   « Organic Molecule » — celle qui avait disparu et où le SMILES doit aller. */
const VIEWER_SRC = VIEW;
const DOCK_SRC = readFileSync(new URL('./src/components/DockingSections.jsx', import.meta.url), 'utf8');
const hasIn = (src, needle, what) => ok(src.includes(needle), `${what}\n  introuvable dans ${needle}`);
hasIn(VIEWER_SRC, "import { cachedLigandSmiles, fetchLigandSmiles } from '../utils/ligandSmiles';",
  'le viewer demande le SMILES au dictionnaire du RCSB');
hasIn(VIEWER_SRC, "if (s.kind !== 'ligand') return;",
  '…pour le code du ligand qu’il a VRAIMENT trouvé (les sections « ligand » de la barre)');
hasIn(VIEWER_SRC, 'const ligandSmilesSource = ligandSmilesText', '…et la boîte SMILES distingue les deux provenances');
hasIn(VIEWER_SRC, 'resolved for the HETATM code', '…en DISANT que c’est le dictionnaire qui l’a rendu');
hasIn(VIEWER_SRC, 'onLigandSmilesRef.current?.(info);', '…et le signale à la page (onLigandSmiles)');
hasIn(VIEWER_SRC, 'asking the RCSB dictionary for its SMILES',
  'un ligand que le dictionnaire ne connaît pas le dit, au lieu de rester muet');
ok(VIEWER_SRC.includes('{shownLigandSmiles && ('), 'la boîte SMILES affiche le SMILES résolu comme celui de la page');
ok(VIEWER_SRC.includes('onLigandSmiles,'), 'le viewer accepte le rappel onLigandSmiles');
hasIn(DOCK_SRC, "{ val: 'organic', icon: 'atom', label: 'Organic Molecule' },",
  'le DOCKING a retrouvé le type « Organic Molecule »…');
hasIn(DOCK_SRC, "d.moleculeType === 'organic' ? (", '…et la sous-section qui va avec');
hasIn(DOCK_SRC, '🧪 Organic Molecule — ligand SMILES', '…c’est bien LÀ que le SMILES du ligand apparaît');
hasIn(DOCK_SRC, '⬇ from the PDB ligand code', '…avec un bouton qui interroge le Chemical Component Dictionary');
hasIn(DOCK_SRC, 'fetchLigandSmiles(c)', '…par la fonction qui interroge le RCSB');
hasIn(DOCK_SRC, 'onLigandSmiles={(info) => {', 'la page reçoit le SMILES que le viewer a résolu');
hasIn(DOCK_SRC, 'updateActiveTest({ ligandCode: info.code, ligandSmiles: info.smiles });',
  '…et le range dans le run (la barre du viewer l’affiche)');
hasIn(DOCK_SRC, 'this structure declares no HETATM ligand code', '…et un fichier sans ligand le dit');
hasIn(DOCK_SRC, "import { fetchLigandSmiles, ligandCodesFromPdbText } from '../utils/ligandSmiles';",
  'la page importe l’utilitaire (le code se lit des HETATM)');
hasIn(DOCK_SRC, ": moleculeType === 'organic' ? 'Organic Molecule' : 'Phospholipid';",
  'et le libellé du type suit (plus de « Phospholipid » pour un ligand)');

/* ══ 8. CE QUI MARCHAIT DÉJÀ — ET QUE LA SUITE FIGE ════════════════════════
   Deux rapports de plus (« the program still does not recognise lipids », « ions
   of the same type are loaded separately ») : les deux chemins sont exécutés ici
   sur une structure réellement parsée par NGL, pour que la réponse ne soit pas une
   opinion. Un POPC (tête polaire · glycérol · deux chaînes acyle, nommage CHARMM)
   et DEUX sodiums du même type sont mis dans un petit PDB. */
const LIPID_PDB = [
  'ATOM      1  P   POPC A   1       0.000   0.000   0.000  1.00  0.00           P',
  'ATOM      2  O1  POPC A   1       1.000   0.000   0.000  1.00  0.00           O',
  'ATOM      3  O2  POPC A   1       1.000   1.000   0.000  1.00  0.00           O',
  'ATOM      4  O3  POPC A   1       1.000   0.000   1.000  1.00  0.00           O',
  'ATOM      5  O4  POPC A   1       1.000   1.000   1.000  1.00  0.00           O',
  'ATOM      6  N   POPC A   1       2.000   0.000   0.000  1.00  0.00           N',
  'ATOM      7  C12 POPC A   1       3.000   0.000   0.000  1.00  0.00           C',
  'ATOM      8  C13 POPC A   1       4.000   0.000   0.000  1.00  0.00           C',
  'ATOM      9  C14 POPC A   1       5.000   0.000   0.000  1.00  0.00           C',
  'ATOM     10  C15 POPC A   1       6.000   0.000   0.000  1.00  0.00           C',
  'ATOM     11  C11 POPC A   1       7.000   0.000   0.000  1.00  0.00           C',
  'ATOM     12  C1  POPC A   1       8.000   0.000   0.000  1.00  0.00           C',
  'ATOM     13  C2  POPC A   1       9.000   0.000   0.000  1.00  0.00           C',
  'ATOM     14  C3  POPC A   1      10.000   0.000   0.000  1.00  0.00           C',
  'ATOM     15  O21 POPC A   1       9.000   1.000   0.000  1.00  0.00           O',
  'ATOM     16  C21 POPC A   1       9.000   2.000   0.000  1.00  0.00           C',
  'ATOM     17  O22 POPC A   1       9.000   2.000   1.000  1.00  0.00           O',
  'ATOM     18  C22 POPC A   1       9.000   3.000   0.000  1.00  0.00           C',
  'ATOM     19  C23 POPC A   1       9.000   4.000   0.000  1.00  0.00           C',
  'ATOM     20  O31 POPC A   1      10.000   1.000   0.000  1.00  0.00           O',
  'ATOM     21  C31 POPC A   1      10.000   2.000   0.000  1.00  0.00           C',
  'ATOM     22  O32 POPC A   1      10.000   2.000   1.000  1.00  0.00           O',
  'ATOM     23  C32 POPC A   1      10.000   2.000   2.000  1.00  0.00           C',
  'ATOM     24  C33 POPC A   1      10.000   2.000   3.000  1.00  0.00           C',
  'HETATM   30  NA  NA  B   1      20.000   0.000   0.000  1.00  0.00          NA',
  'HETATM   31  NA  NA  B   2      30.000   0.000   0.000  1.00  0.00          NA',
  'END',
].join('\n');
const LSUBS = new Function('NGL', [
  'const window = { NGL };',
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
  sliceFn(VIEW, 'resnoListOf'),
  sliceFn(VIEW, 'classifySectionResidue'),
  'const MOL_KINDS = ["protein", "nucleic", "lipid", "sugar", "ligand", "water", "ion"];',
  'const glycanEntityMapFor = () => null;',
  sliceFn(VIEW, 'listMoleculeSections'),
  sliceFn(VIEW, 'atomElement'),
  sliceFn(VIEW, 'atomIndicesForSele'),
  sliceDecl(VIEW, 'LIPID_GLYCEROL_NAMES'),
  sliceDecl(VIEW, 'LIPID_ACYL_RE'),
  sliceDecl(VIEW, 'LIPID_POLAR_ELEMENTS'),
  sliceDecl(VIEW, 'LIPID_NAMED_PROBE'),
  sliceDecl(VIEW, 'LIPID_CHAIN_PROBE_RE'),
  sliceFn(VIEW, 'lipidGroupOf'),
  sliceDecl(VIEW, 'lipidSubCache'),
  sliceFn(VIEW, 'lipidSubSelections'),
  sliceFn(VIEW, 'lipidResnamesIn'),
  sliceFn(VIEW, 'lipidResnameSele'),
  sliceDecl(VIEW, 'lipidRes'),
  sliceDecl(VIEW, 'LIPID_STANDARD_RES'),
  sliceDecl(VIEW, 'lipidGroupSele'),
  'return { listMoleculeSections, lipidSubSelections, lipidGroupSele, lipidResnamesIn };',
].join('\n'))(NGL);
const lipidStruct = await NGL.autoLoad(new Blob([LIPID_PDB], { type: 'text/plain' }), { ext: 'pdb' });
const lipSections = LSUBS.listMoleculeSections(lipidStruct);
const lipidSec = lipSections.find((s) => s.kind === 'lipid');
ok(!!lipidSec, 'le POPC est reconnu comme un LIPIDE (une section « lipid », pas un ligand)');
eq(lipidSec && lipidSec.sele, '[POPC]', '…et sa sélection est le code du résidu (ce que NGL sait lire)');
const subs = LSUBS.lipidSubSelections(lipidStruct, '[POPC]');
ok(subs.named, 'son nommage d’atomes est reconnu comme le nommage standard (CHARMM)');
const count = (s) => String(s || '').split(',').filter(Boolean).length;
// Tous les ATOM du gabarit sont le POPC (les ions sont des HETATM) : c'est le
// résidu que les trois parties doivent couvrir EXACTEMENT.
const popcAtoms = LIPID_PDB.split('\n').filter((l) => l.startsWith('ATOM')).length;
eq(count(subs.head) + count(subs.glycerol) + count(subs.acyl), popcAtoms,
  `les trois parties (tête · glycérol · chaînes) TUILE le résidu — ${popcAtoms} atomes, aucun perdu, aucun en double`);
ok(count(subs.glycerol) >= 3, '…dont le glycérol (C1 · C2 · C3 et leurs oxygènes / hydrogènes)');
ok(count(subs.acyl) >= 8, '…et les deux chaînes acyle (C21… / C31…)');
const ionSections = lipSections.filter((s) => s.kind === 'ion');
eq(ionSections.length, 1, 'les deux sodiums du même type ne font QU’UNE section (comme l’eau)');
eq(ionSections[0].count, 2, '…et cette section dit combien il y en a (×2)');
eq(ionSections[0].sele, '[NA]', '…et les sélectionne tous les deux');

/* ══ 9. LE RENOMMAGE, LE 🔎 ET LE PANNEAU « ABORT » ═════════════════════════
   Trois demandes du même rapport, vérifiées ici :
     • « color by "DNA conformation" must be renamed as color by "RNA/DNA
       conformation" » — l'étiquette de la rangée ET les deux sélecteurs ;
     • « For each molecule in the molecules styling add a button zoom to zoom on
       that molecule » — un 🔎 par molécule, qui centre sur SA sélection ;
     • « When I play a md run I have an annoying window on top saying to abort it
       but it makes no sense because I can simply stop it. The trajectory has
       already been loaded. » — plus AUCUN panneau d'abandon pour une lecture. */
hasIn(VIEWER_SRC, "nucform: 'RNA/DNA conformation',", '« Color by » : l’étiquette est RNA/DNA conformation');
ok(!VIEWER_SRC.includes("'DNA conformation'"),
  '…et l’ancienne étiquette (« DNA conformation ») n’existe plus, dans aucun sélecteur');
eq(countOf(/RNA\/DNA conformation/g) >= 3, true, '…partout où la coloration se choisit (rangée + sélecteurs + textes)');
hasIn(VIEWER_SRC, 'onClick={() => zoomSection(sec)}', 'chaque molécule de la barre porte son bouton 🔎');
hasIn(VIEWER_SRC, 'comp.autoView(sec && sec.sele ? sec.sele : undefined)',
  '…et il centre la caméra sur LA molécule (la sélection de sa section), pas sur le fichier');
hasIn(VIEWER_SRC, 'const zoomSection = (sec) => {', '…par une fonction unique, partagée par toutes les molécules');
hasIn(VIEWER_SRC, 'const abortSnap = useAbortControl();', 'le ⏹ ne lit que le registre des VRAIES opérations');
ok(!VIEWER_SRC.includes("abortControl.register('trajectory playback'"),
  'la lecture de trajectoire ne s’enregistre PLUS comme une opération abandonnable');
hasIn(VIEWER_SRC, "trajStatus === 'loading') && (",
  '…et la barre verticale ne s’ouvre plus pendant une lecture');
ok(!VIEWER_SRC.includes('|| playing) && ('),
  'l’ancienne condition (qui ouvrait le panneau pour une lecture) a disparu');
hasIn(VIEWER_SRC, 'trajectory has already been loaded', '…et le code cite le rapport (la trajectoire est déjà chargée)');

console.log(`_viewer_style_gaps_test.mjs — ${passed} assertions OK`);


