/* =========================================================================
   _viewer_scheme_test.mjs — les SCHÉMAS NGL MAISON du viewer 3D, EXÉCUTÉS avec
   le vrai paquet `ngl` (2.4.0, la version que la page charge depuis le CDN).

   Ce que ce fichier protège (le bug du 20/09/2026) :

     • `ColormakerRegistry.addScheme(DÉFINITION, LIBELLÉ)` — la définition
       D'ABORD, le libellé ENSUITE. L'ancien ordre inversé ne levait aucune
       erreur (la classe n'est construite qu'à l'instanciation), mais NGL
       transformait le libellé en SOURCE DE FONCTION dans l'id du schéma et
       fabriquait une classe qui fait `.call()` sur une chaîne : dès qu'une
       représentation demandait cet id, l'instanciation jetait
       « … .call is not a function » et la représentation ne dessinait RIEN.
       D'où : « Colour by chemical group » faisait disparaître la molécule et
       « Stylized rings (coloured inside) » n'affichait rien du tout ;
     • registerColorScheme est donc le SEUL appelant d'addScheme : il respecte
       l'ordre et INSTANCIE le schéma une fois avant de rendre son id, sinon il
       rend `null` — le viewer garde alors une couleur NGL native plutôt que de
       ne rien dessiner ;
     • les schémas du viewer (structure secondaire, groupes chimiques des
       acides nucléiques, identité de base A · C · G · T · U, dégradé N → C /
       5' → 3') donnent bien les couleurs attendues, y compris à travers le VRAI
       `atomColor(atom)` de NGL ;
     • les noms d'atomes des gabarits nucléotidiques que l'application embarque
       (public/structures/template_nucleotide_dna.pdb · _rna.pdb) tombent dans
       le bon groupe chimique — c'est ce que colore « Colour by chemical group ».

   Le viewer est un .jsx : ses helpers sont EXTRAITS du fichier puis exécutés
   (comme dans _md_axis_cfg_test.mjs), ici avec le vrai NGL en sandbox.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const NGL = require('ngl'); // le paquet installé : 2.4.0, exactement le CDN chargé par la page

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
// Le CODE seul (commentaires retirés) : les commentaires du viewer CITENT
// addScheme pour expliquer justement l'ordre inversé.
const CODE = VIEW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ── Extraction : `const name = (…) => { … };` (corps bloc) ──────────────── */
const sliceFn = (src, name) => {
  const start = src.indexOf(`const ${name} = (`);
  assert.ok(start >= 0, `fonction ${name} introuvable`);
  const arrow = src.indexOf('=>', start);
  assert.ok(arrow >= 0, `flèche de ${name} introuvable`);
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
/* ── Extraction : `const name = { … };` ─────────────────────────────────── */
const sliceObject = (src, name) => {
  const start = src.indexOf(`const ${name} = {`);
  assert.ok(start >= 0, `objet ${name} introuvable`);
  const end = src.indexOf('};', start);
  assert.ok(end > start, `fin de ${name} introuvable`);
  return src.slice(start, end + 2);
};
/* ── Extraction : `const name = …;` (valeur sans `;` interne) ────────────── */
const sliceConst = (name) => {
  const m = new RegExp(`const ${name} = ([^;]+);`).exec(VIEW);
  assert.ok(!!m, `constante ${name} introuvable`);
  return `const ${name} = ${m[1]};`;
};
/* ── Extraction d'un BLOC CONTIGU entre deux ancres ──────────────────────── */
// PART 3 (géométrie · seuils · classificateurs · marcheurs) et PART 2.2bis (le
// dictionnaire des sucres et le regroupement des glycanes) sont écrits d'un seul
// tenant dans le viewer : la sandbox les reprend tels quels, donc rien n'est
// recopié — et une dérive du fichier fait échouer ces essais.
const sliceRange = (from, to) => {
  const start = VIEW.indexOf(from);
  assert.ok(start >= 0, `bloc introuvable : ${from}`);
  const end = VIEW.indexOf(to, start);
  assert.ok(end > start, `fin de bloc introuvable : ${to}`);
  return VIEW.slice(start, end);
};



/* ── Extraction : `const name = (…) => expr;` (flèche d'UNE ligne) ───────── */
const sliceArrow = (src, name) => {
  const m = new RegExp(`const ${name} = \\([^)]*\\) => [^\\n]+`).exec(src);
  assert.ok(!!m, `fonction ${name} (une ligne) introuvable`);
  return `${m[0]};`;
};

/* ── Les helpers du viewer, exécutés dans une sandbox avec le vrai NGL ──── */
const sandbox = [
  sliceObject(VIEW, 'BASE_IDENTITY_COLORS'),
  sliceObject(VIEW, 'DEFAULT_NUCLEIC_COLORS'),
  sliceObject(VIEW, 'DEFAULT_LIPID_COLORS'),
  sliceObject(VIEW, 'sstrucColorStore'),
  sliceObject(VIEW, 'nucleicColorStore'),
  sliceObject(VIEW, 'lipidColorStore'),
  sliceFn(VIEW, 'nucleicGroupOf'),
  sliceFn(VIEW, 'baseIdentityColorOf'),
  sliceFn(VIEW, 'atomElement'),
  sliceFn(VIEW, 'lipidGroupOf'),
  sliceObject(VIEW, 'lipidPartIndexStore'),
  sliceConst('LIPID_GLYCEROL_NAMES'),
  sliceConst('LIPID_ACYL_RE'),
  sliceConst('LIPID_POLAR_ELEMENTS'),
  sliceConst('LIPID_NAMED_PROBE'),
  sliceConst('LIPID_CHAIN_PROBE_RE'),
  sliceFn(VIEW, 'registerColorScheme'),
  sliceFn(VIEW, 'defineSstrucScheme'),
  sliceFn(VIEW, 'defineNucleicGroupsScheme'),
  sliceFn(VIEW, 'defineBaseIdentityScheme'),
  sliceFn(VIEW, 'defineLipidGroupsScheme'),
  // Les deux palettes du ⚙ (types d'atomes · types de sucres) : leurs stores
  // vivants, leurs lecteurs et leurs définitions de schéma — exécutés ici avec le
  // vrai NGL, comme les quatre schémas ci-dessus.
  sliceObject(VIEW, 'ELEMENT_COLOR_PALETTE'),
  sliceObject(VIEW, 'SUGAR_IDENTITY_COLORS'),
  sliceObject(VIEW, 'elementColorStore'),
  sliceObject(VIEW, 'sugarColorStore'),
  sliceConst('DEFAULT_ELEMENT_COLOR'),
  sliceConst('SUGAR_RES_SEL'),
  sliceConst('SUGAR_IDENTITY_CODES'),
  sliceFn(VIEW, 'elementColorOf'),
  sliceFn(VIEW, 'sugarColorOf'),
  sliceFn(VIEW, 'defineElementScheme'),
  sliceFn(VIEW, 'defineSugarIdentityScheme'),
  // ── PART 3 · les formes (A · B · Z · ARN) et les motifs (G4 · hairpin) ────
  // Le bloc entier, pris d'un seul tenant : la géométrie, les seuils, les
  // classificateurs, les marcheurs d'atomes et leurs caches par structure.
  sliceRange('const nucAtomKey = (name)', 'const loadViewerSetups'),
  sliceFn(VIEW, 'nucBaseOf'),
  sliceFn(VIEW, 'sstrucAtomColorOf'),
  sliceObject(VIEW, 'DEFAULT_NUCLEIC_FORM_COLORS'),
  sliceObject(VIEW, 'nucleicFormColorStore'),
  sliceFn(VIEW, 'nucleicFormColorOf'),
  sliceFn(VIEW, 'defineNucleicFormScheme'),
  sliceObject(VIEW, 'DEFAULT_NUCLEIC_MOTIF_COLORS'),
  sliceObject(VIEW, 'nucleicMotifColorStore'),
  sliceFn(VIEW, 'nucleicMotifColorOf'),
  sliceFn(VIEW, 'defineNucleicMotifScheme'),
  // ── PART 2.2bis · les glycanes liés + PART 2.1bis · les classes de lipides ─
  sliceRange('const SUGAR_NAME_CODES = {', 'const catSeleCache = new WeakMap();'),
  sliceConst('GLYCAN_ENTITY_COLORS'),
  sliceConst('DEFAULT_GLYCAN_ENTITY_COLOR'),
  sliceObject(VIEW, 'glycanColorStore'),
  sliceFn(VIEW, 'glycanEntityColorOf'),
  sliceFn(VIEW, 'defineGlycanScheme'),
  sliceObject(VIEW, 'LIPID_CLASS_ALIASES'),
  sliceConst('LIPID_CLASS_SUFFIXES'),
  sliceFn(VIEW, 'lipidClassOf'),
  /* ⚠ « CE RÉSIDU EST-IL UN LIPIDE ? » — le lecteur des parts s'en sert maintenant
     pour décider qu'un atome que ni son nom ni sa liaison ne placent est la TÊTE
     (voir lipidAtomPart) : la table de reconnaissance et son prédicat sont donc
     pris dans la source, comme tout le reste. */
  sliceConst('LIPID_RESNAMES'),
  sliceArrow(VIEW, 'isLipidResname'),
  sliceObject(VIEW, 'LIPID_CLASS_COLORS'),
  sliceObject(VIEW, 'lipidClassColorStore'),
  sliceFn(VIEW, 'lipidClassColorOf'),
  sliceFn(VIEW, 'defineLipidClassScheme'),
  // Les PARTIES des trois palettes de la demande : la classe de lipide (tête ·
  // glycérol · chaînes), le ribose de chaque base et le squelette / les chaînes de
  // chaque résidu — les tables, les lecteurs et les classificateurs d'atome, pris
  // d'un seul tenant pour qu'aucune ligne ne soit recopiée ici.
  sliceConst('LIPID_TYPE_ORDER'),
  sliceFn(VIEW, 'lipidPartNameOf'),
  // ⚠ LES HYDROGÈNES DE LIPIDE SUIVENT LEUR LIAISON — le rapport de cette session :
  // « the hydrogen atoms of a lipid are green while the different parts of the lipid
  // are defined in a different color in the setting wheel ». Le cache par structure
  // et les deux lecteurs qui l'utilisent, pris d'un seul tenant.
  sliceRange('const lipidBondParentCache = new WeakMap();', '// The three sub-selections'),
  sliceRange('const lipidPartDefaults = () => Object.fromEntries', 'let lipidClassSchemeKey'),
  sliceObject(VIEW, 'BASE_SUGAR_COLORS'),
  sliceObject(VIEW, 'baseSugarColorStore'),
  sliceFn(VIEW, 'baseSugarColorOf'),
  // (les deux lignes des PARTS d'un residu vivent plus bas, apres RESIDUE_COLOR_PALETTE)  // PART 4 — les palettes et les schémas que la barre de style lit.
  sliceConst('BASE_TYPE_ORDER'),
  sliceObject(VIEW, 'RESIDUE_COLOR_PALETTE'),
  sliceObject(VIEW, 'residueColorStore'),
  sliceFn(VIEW, 'residueColorOf'),
  sliceConst('RESIDUE_ORDER'),
  sliceRange('const PROTEIN_BACKBONE_ATOMS = new Set([', 'const defineResidueScheme'),
  sliceFn(VIEW, 'defineResidueScheme'),
  sliceObject(VIEW, 'baseTypeColorStore'),
  sliceFn(VIEW, 'baseTypeColorOf'),
  sliceFn(VIEW, 'defineBaseTypeScheme'),
  sliceObject(VIEW, 'CHARGE_COLORS'),
  sliceObject(VIEW, 'chargeColorStore'),
  sliceFn(VIEW, 'ionChargeOf'),
  sliceFn(VIEW, 'chargeColorOf'),
  sliceFn(VIEW, 'defineChargeScheme'),
  sliceObject(VIEW, 'SUGAR_TYPE_COLORS'),
  sliceObject(VIEW, 'sugarTypeColorStore'),
  sliceObject(VIEW, 'SUGAR_TYPE_OF_CODE'),
  sliceFn(VIEW, 'sugarTypeOf'),
  sliceFn(VIEW, 'sugarTypeColorOf'),

  `return { BASE_IDENTITY_COLORS, DEFAULT_NUCLEIC_COLORS, DEFAULT_LIPID_COLORS, sstrucColorStore, nucleicColorStore, lipidColorStore,
    LIPID_GLYCEROL_NAMES, LIPID_ACYL_RE, LIPID_POLAR_ELEMENTS, LIPID_NAMED_PROBE, LIPID_CHAIN_PROBE_RE,
    lipidPartIndexStore,
    nucleicGroupOf, baseIdentityColorOf, atomElement, lipidGroupOf, registerColorScheme,
    defineSstrucScheme, defineNucleicGroupsScheme, defineBaseIdentityScheme, defineLipidGroupsScheme,
    ELEMENT_COLOR_PALETTE, SUGAR_IDENTITY_COLORS, SUGAR_IDENTITY_CODES, elementColorStore, sugarColorStore,
    DEFAULT_ELEMENT_COLOR, elementColorOf, sugarColorOf, defineElementScheme, defineSugarIdentityScheme,
    nucBaseOf, sstrucAtomColorOf, nucleicForms, nucleicMotifs, nucleicClassFor, structureAtomRecords,
    DEFAULT_NUCLEIC_FORM_COLORS, nucleicFormColorStore, nucleicFormColorOf, defineNucleicFormScheme,
    DEFAULT_NUCLEIC_MOTIF_COLORS, nucleicMotifColorStore, nucleicMotifColorOf, defineNucleicMotifScheme,
    SUGAR_NAME_CODES, GLYCAN_ENTITY_COLORS, DEFAULT_GLYCAN_ENTITY_COLOR, glycanColorStore,
    glycanEntityColorOf, defineGlycanScheme, glycanEntityMapFor, isSugarResidueCode,
    LIPID_CLASS_ALIASES, LIPID_CLASS_SUFFIXES, lipidClassOf, LIPID_CLASS_COLORS, lipidClassColorStore,
    lipidClassColorOf, defineLipidClassScheme ,
    LIPID_TYPE_ORDER, lipidPartNameOf, LIPID_PART_DEFAULTS, lipidPartColorStore, lipidPartColorOf, lipidAtomPart,
    BASE_SUGAR_COLORS, baseSugarColorStore, baseSugarColorOf,
    RESIDUE_ORDER, PROTEIN_BACKBONE_ATOMS, proteinAtomPart, RESIDUE_PART_DEFAULTS, residuePartColorStore, residuePartColorOf,
      BASE_TYPE_ORDER, RESIDUE_COLOR_PALETTE, residueColorStore, residueColorOf, defineResidueScheme, baseTypeColorStore, baseTypeColorOf, defineBaseTypeScheme, CHARGE_COLORS, chargeColorStore, ionChargeOf, chargeColorOf, defineChargeScheme, SUGAR_TYPE_COLORS, sugarTypeColorStore, SUGAR_TYPE_OF_CODE, sugarTypeOf, sugarTypeColorOf };`
].join('\n');
const H = new Function(sandbox)();

/* ══ 1. UN SEUL ENREGISTREUR, DANS L'ORDRE QUE NGL ATTEND ═════════════════ */
has('const registerColorScheme = (NGL, label, define) => {', 'l’enregistreur unique');
has('const key = NGL.ColormakerRegistry.addScheme(define, label);',
  'addScheme reçoit la DÉFINITION d’abord et le LIBELLÉ ensuite');
gone("NGL.ColormakerRegistry.addScheme('", 'aucun appel direct addScheme(libellé, …) ne subsiste');
ok((CODE.match(/ColormakerRegistry\.addScheme\(/g) || []).length === 1,
  'addScheme n’est appelé QU’UNE fois dans tout le code (dans l’enregistreur)');
['lab-sstruc', 'lab-nucleic-groups', 'lab-base-identity'].forEach((label) => {
  has(`registerColorScheme(NGL, '${label}'`, `le schéma ${label} passe par l’enregistreur`);
});

/* ══ 2. LE PIÈGE QUI A CAUSÉ LE BUG EST BIEN RÉEL (et refusé) ═════════════ */
// L'ordre inversé, tel qu'il était écrit : NGL accepte l'appel sans broncher,
// mais l'id contient la source de la fonction et l'instanciation jette.
const brokenId = NGL.ColormakerRegistry.addScheme('lab-broken', function () { this.atomColor = () => 0; });
ok(/function|=>/.test(brokenId), 'l’ordre inversé met la SOURCE DE LA FONCTION dans l’id du schéma');
let thrown = null;
try { NGL.ColormakerRegistry.getScheme({ scheme: brokenId }); } catch (e) { thrown = e; }
ok(thrown !== null, '…et instancier ce schéma jette (la représentation ne dessinerait rien)');
ok(/not a function/.test(String(thrown && thrown.message)), '…sur un appel de fonction sur une chaîne');
// Notre enregistreur, appelé avec les deux arguments inversés, refuse l'id.
eq(H.registerColorScheme(NGL, H.defineBaseIdentityScheme(), 'lab-reversed'), null,
  'l’enregistreur rend null plutôt qu’un id cassé');
eq(H.registerColorScheme(null, 'lab-x', () => {}), null, 'et null aussi sans NGL chargé');

/* ══ 3. LE SCHÉMA DES TROIS GROUPES CHIMIQUES (menu B) ════════════════════ */
const groupsKey = H.registerColorScheme(NGL, 'lab-test-groups', H.defineNucleicGroupsScheme());
ok(typeof groupsKey === 'string' && groupsKey.length > 0, 'l’enregistreur rend un id de schéma');
ok(Object.keys(NGL.ColormakerRegistry.getSchemes()).includes(groupsKey),
  'l’id est exactement ce que Representation#setColor reconnaît (Object.keys(getSchemes()))');
const groupsCm = NGL.ColormakerRegistry.getScheme({ scheme: groupsKey });
eq(typeof groupsCm.atomColor, 'function', 'le schéma instancié sait colorer un atome');
const ATOM = (atomname) => ({ atomname });
eq(groupsCm.atomColor(ATOM('P')), H.nucleicColorStore.phosphate, 'P → la couleur phosphate');
eq(groupsCm.atomColor(ATOM('O2P')), H.nucleicColorStore.phosphate, 'O2P (gabarit de l’app) → phosphate');
eq(groupsCm.atomColor(ATOM("C4'")), H.nucleicColorStore.pentose, "C4' → la couleur pentose");
eq(groupsCm.atomColor(ATOM('O4*')), H.nucleicColorStore.pentose, 'O4* (ancienne notation) → pentose');
eq(groupsCm.atomColor(ATOM('N9')), H.nucleicColorStore.base, 'N9 → la couleur des bases');
eq(groupsCm.atomColor({}), H.nucleicColorStore.base, 'un atome sans nom ne fait pas planter le schéma');
// Le schéma lit le STORE VIVANT : déplacer une pastille recolore sans réenregistrer.
const savedPhosphate = H.nucleicColorStore.phosphate;
H.nucleicColorStore.phosphate = 0x112233;
eq(groupsCm.atomColor(ATOM('P')), 0x112233, 'une pastille déplacée est lue IMMÉDIATEMENT (aucun réenregistrement)');
H.nucleicColorStore.phosphate = savedPhosphate;

/* ══ 4. LE SCHÉMA D'IDENTITÉ DE BASE (« Stylized rings ») ═════════════════ */
const identityKey = H.registerColorScheme(NGL, 'lab-test-bases', H.defineBaseIdentityScheme());
ok(typeof identityKey === 'string' && identityKey.length > 0, 'le schéma par identité de base est enregistré');
ok(Object.keys(NGL.ColormakerRegistry.getSchemes()).includes(identityKey),
  'son id est utilisable en `color` par une représentation');
const identityCm = NGL.ColormakerRegistry.getScheme({ scheme: identityKey });
eq(identityCm.atomColor({ resname: 'DA' }), H.BASE_IDENTITY_COLORS.A, 'DA (ADN) → la couleur de A');
eq(identityCm.atomColor({ resname: 'RA' }), H.BASE_IDENTITY_COLORS.A, 'RA (ARN) → la couleur de A');
eq(identityCm.atomColor({ resname: 'DC' }), H.BASE_IDENTITY_COLORS.C, 'DC → la couleur de C');
eq(identityCm.atomColor({ resname: 'DG' }), H.BASE_IDENTITY_COLORS.G, 'DG → la couleur de G');
eq(identityCm.atomColor({ resname: 'DT' }), H.BASE_IDENTITY_COLORS.T, 'DT → la couleur de T');
eq(identityCm.atomColor({ resname: 'U' }), H.BASE_IDENTITY_COLORS.U, 'U (ARN) → la couleur de U');
ok(!Object.values(H.BASE_IDENTITY_COLORS).includes(identityCm.atomColor({ resname: 'HOH' })),
  'une molécule qui n’est pas une base garde son gris neutre');

/* ══ 5. LE SCHÉMA DES STRUCTURES SECONDAIRES (menu A) ════════════════════ */
const sstrucKey = H.registerColorScheme(NGL, 'lab-test-sstruc', H.defineSstrucScheme());
ok(typeof sstrucKey === 'string' && sstrucKey.length > 0, 'le schéma hélice / feuillet / boucle est enregistré');
const sstrucCm = NGL.ColormakerRegistry.getScheme({ scheme: sstrucKey });
eq(sstrucCm.atomColor({ sstruc: 'h' }), H.sstrucColorStore.helix, 'hélice α → sa couleur');
eq(sstrucCm.atomColor({ sstruc: 'g' }), H.sstrucColorStore.helix, 'hélice 3₁₀ → sa couleur');
eq(sstrucCm.atomColor({ sstruc: 'e' }), H.sstrucColorStore.sheet, 'feuillet β → sa couleur');
eq(sstrucCm.atomColor({ sstruc: 'c' }), H.sstrucColorStore.loop, 'boucle → sa couleur');

/* ══ 6. LES GABARITS NUCLÉOTIDIQUES EMBARQUÉS, GROUPE PAR GROUPE ═════════ */
// Les fichiers que l'application livre (le constructeur de nucléotide) : leurs
// noms d'atomes doivent tomber dans le bon groupe, sinon « Colour by chemical
// group » colorerait un phosphate comme une base.
const TEMPLATES = [
  // ADN : adénine (purine → deux cycles, N9 / C8 / N1 / C6 dans le noyau).
  { file: 'public/structures/template_nucleotide_dna.pdb', residue: 'DA', base: 'A',
    pentose: ["O5'", "C5'", "C4'", "O4'", "C3'", "O3'", "C2'", "C1'"],
    ring: ['N9', 'C8', 'N7', 'C5', 'C6', 'N6', 'N1', 'C2', 'N3', 'C4'] },
  // ARN : uracile (pyrimidine → un cycle, N1 / C2 / O2 / N3 / C4 / O4 / C5 / C6).
  { file: 'public/structures/template_nucleotide_rna.pdb', residue: 'U', base: 'U',
    pentose: ["O5'", "C5'", "C4'", "O4'", "C3'", "O3'", "C2'", "O2'", "C1'"],
    ring: ['N1', 'C2', 'O2', 'N3', 'C4', 'O4', 'C5', 'C6'] },
];
TEMPLATES.forEach(({ file, residue, base, pentose, ring }) => {
  const lines = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n').split('\n');
  const seen = { phosphate: [], pentose: [], base: [] };
  lines.forEach((l) => {
    if (!/^(ATOM|HETATM)/.test(l)) return;
    const atomname = l.slice(12, 16).trim();
    const resname = l.slice(17, 21).trim();
    eq(resname, residue, `${file} : le résidu de ${atomname}`);
    seen[H.nucleicGroupOf(atomname)].push(atomname);
    // Le nom de résidu du gabarit doit aussi donner la bonne couleur de base.
    eq(H.baseIdentityColorOf(resname), H.BASE_IDENTITY_COLORS[base],
      `${file} : ${resname} → la couleur de ${base}`);
  });
  eq(seen.phosphate, ['P', 'O1P', 'O2P'], `${file} : le phosphate = P + O1P + O2P`);
  eq(seen.pentose, pentose, `${file} : le sucre = tous les atomes primés`);
  eq(seen.base, ring, `${file} : les bases = le noyau de ${base}, ni sucre ni phosphate`);
});

/* ══ 7. LE POURTOUR DE « Stylized rings » EST VALIDE ══════════════════════ */
// Les plaques pleines portent un encadrement de bâtons fins dessiné sur EXACTEMENT
// les atomes des cycles (une sélection `@indices`, la seule que NGL comprenne pour
// une liste d'atomes) ; la sélection historique reste le REPLI, quand aucune plaque
// n'a pu être construite (un fichier sans liaisons, une base modifiée inconnue).
const ringSele = new NGL.Selection('nucleic and sidechain');
eq(ringSele.selection.error, undefined, 'la sélection de repli du pourtour est comprise par NGL');
has("add('licorice', { sele: `@${ringIdx.join(',')}`",
  '« Stylized rings » encadre exactement les atomes des anneaux');
has("add('licorice', { sele: 'nucleic and sidechain', ...ringLineCol()",
  '…et garde le repli sur les atomes des bases si aucune plaque n’a pu être construite');
has("registerColorScheme(NGL, 'lab-gradient'", 'un quatrième schéma maison : le dégradé N → C / 5\' → 3\'');
has('registerGradientScheme(NGL);', '…enregistré avec la scène, comme les trois autres');
/* ══ 8. LE SCHÉMA DES TROIS PARTS D'UN LIPIDE (menu C) ═══════════════════ */
// Même contrat que les deux autres schémas maison : une définition enregistrée
// par registerColorScheme, un store vivant, et le drapeau `named` qui suit la
// structure chargée — ce qui est DESSINÉ et ce qui est COLORIÉ sortent du même
// classificateur (lipidGroupOf).
const lipidKey = H.registerColorScheme(NGL, 'lab-test-lipid-groups', H.defineLipidGroupsScheme());
ok(typeof lipidKey === 'string' && lipidKey.length > 0, 'le schéma tête / squelette / chaînes est enregistré');
const lipidCm = NGL.ColormakerRegistry.getScheme({ scheme: lipidKey });
eq(lipidCm.atomColor({ atomname: 'C21', element: 'C' }), H.lipidColorStore.acyl, 'une chaîne acyle → la couleur des chaînes');
eq(lipidCm.atomColor({ atomname: 'C2', element: 'C' }), H.lipidColorStore.glycerol, 'le squelette glycérol → sa couleur');
eq(lipidCm.atomColor({ atomname: 'P', element: 'P' }), H.lipidColorStore.head, 'le phosphate → la tête');
eq(lipidCm.atomColor({ atomname: 'C13', element: 'C' }), H.lipidColorStore.head, 'un carbone de la choline → la tête');
eq(lipidCm.atomColor({ atomname: 'H13A', element: 'H' }), H.lipidColorStore.head, '…et son hydrogène aussi');
eq(lipidCm.atomColor({ atomname: 'H21A', element: 'H' }), H.lipidColorStore.acyl, 'un hydrogène de chaîne suit son carbone (H21A → C21)');
// Une pastille est VIVANTE : le schéma lit le store, rien n'est ré-enregistré.
H.lipidColorStore.acyl = 0x123456;
eq(lipidCm.atomColor({ atomname: 'C31', element: 'C' }), 0x123456, 'déplacer une pastille ne redessine rien : le store est lu en direct');
H.lipidColorStore.acyl = H.DEFAULT_LIPID_COLORS.acyl;
eq(lipidCm.atomColor({ atomname: 'C31', element: 'C' }), H.DEFAULT_LIPID_COLORS.acyl, '↺ remet la couleur par défaut');
// Un fichier qui renomme ses atomes d'après l'élément (P8 / C12 / O9) : le drapeau
// `named` bascule sur la règle des éléments, et le schéma suit.
H.lipidColorStore.named = false;
eq(lipidCm.atomColor({ atomname: 'C12', element: 'C' }), H.DEFAULT_LIPID_COLORS.acyl, 'sans nomenclature : tout carbone est une chaîne');
eq(lipidCm.atomColor({ atomname: 'O9', element: 'O' }), H.DEFAULT_LIPID_COLORS.head, '…et tout oxygène la tête');
eq(lipidCm.atomColor({ atomname: 'C1', element: 'C' }), H.DEFAULT_LIPID_COLORS.acyl, '…même un carbone nommé C1 (la nomenclature est ignorée)');
H.lipidColorStore.named = true;
/* …puis les SETS du marcheur (le regard de lipidSubSelections) : les pastilles
   colorent EXACTEMENT ce que les représentations dessinent. C'est le seul chemin
   qui donne la bonne couleur à un hydrogène de chaîne dont le nom ment — H2R est
   sur C22 à 1,09 Å (le rapport : « in phospholipids many hydrogens of acyl chains
   are attributed to the headgroups or (although they are very far) to the
   glycerol ») : son nom dit « C2 », donc le squelette, mais la LIAISON dit la
   chaîne. */
const struct = { name: 'AA2.gro' };
H.lipidPartIndexStore.structure = struct;
H.lipidPartIndexStore.head = new Set([0, 1]);
H.lipidPartIndexStore.glycerol = new Set([2, 3]);
H.lipidPartIndexStore.acyl = new Set([4, 5]);
const inWalk = (index, atomname) => ({ index, structure: struct, atomname, element: 'H' });
eq(lipidCm.atomColor(inWalk(4, 'H2R')), H.DEFAULT_LIPID_COLORS.acyl,
  'H2R (chaîne oléoyle) reçoit la couleur des CHAÎNES : la couleur vient de la liaison, pas du nom');
eq(lipidCm.atomColor(inWalk(5, 'H16Z')), H.DEFAULT_LIPID_COLORS.acyl, '…comme le méthyle terminal H16Z');
eq(lipidCm.atomColor(inWalk(2, 'HA')), H.DEFAULT_LIPID_COLORS.glycerol, 'HA (glycérol) garde la couleur du SQUELETTE');
eq(lipidCm.atomColor(inWalk(3, 'H2X')), H.DEFAULT_LIPID_COLORS.glycerol,
  'H2X est sur C32 : son NOM dit « C2 » (squelette) et la liaison aussi — donc squelette');
eq(lipidCm.atomColor(inWalk(0, 'N')), H.DEFAULT_LIPID_COLORS.head, 'N garde la couleur de la TÊTE');
eq(lipidCm.atomColor(inWalk(1, 'H13A')), H.DEFAULT_LIPID_COLORS.head, '…et H13A aussi');
// Le marcheur d'une structure ne colore jamais les atomes d'une AUTRE : là, les
// règles du nom reprennent la main (le repli d'avant).
eq(lipidCm.atomColor({ index: 4, structure: { name: 'autre' }, atomname: 'H2R', element: 'H' }),
  H.DEFAULT_LIPID_COLORS.glycerol,
  'le marcheur d’une structure ne colore pas les atomes d’une autre (repli sur le nom)');
eq(lipidCm.atomColor({ index: 99, structure: struct, atomname: 'C21', element: 'C' }),
  H.DEFAULT_LIPID_COLORS.acyl, '…un atome hors du marcheur garde les règles du nom');
H.lipidPartIndexStore.structure = null;
H.lipidPartIndexStore.head = null;
H.lipidPartIndexStore.glycerol = null;
H.lipidPartIndexStore.acyl = null;


/* ══ 9. LES TROIS PARTS D'UN LIPIDE NE SE CHEVAUCHENT PAS, ET NE PERDENT RIEN ══
   Le menu C n'envoie PLUS de règles `.NOM` à NGL : ses règles sont des
   comparaisons EXACTES (pas de joker `*`, donc « .O1* » ne matchait aucun O11), et
   surtout le headgroup est l'EXCLUSION des deux autres parts — un headgroup en
   Ball & Stick doit garder tous ses atomes et toutes ses liaisons. On refait donc
   ici la passe du viewer sur une liste d'atomes POPC, puis on demande au VRAI NGL
   si chaque part attrape exactement ses atomes (le `@indice` est la seule
   sélection d'indices de NGL, et c'est celle que le rendu lui passe). */
const POPC = [
  // [nom, élément, part attendue] — nomenclature CHARMM / AMBER
  ['N', 'N', 'head'], ['C11', 'C', 'head'], ['H11A', 'H', 'head'], ['H11B', 'H', 'head'],
  ['C12', 'C', 'head'], ['H12A', 'H', 'head'], ['H12B', 'H', 'head'],
  ['C13', 'C', 'head'], ['H13A', 'H', 'head'], ['H13B', 'H', 'head'], ['H13C', 'H', 'head'],
  ['C14', 'C', 'head'], ['H14A', 'H', 'head'], ['H14B', 'H', 'head'], ['H14C', 'H', 'head'],
  ['C15', 'C', 'head'], ['H15A', 'H', 'head'], ['H15B', 'H', 'head'], ['H15C', 'H', 'head'],
  ['P', 'P', 'head'], ['O11', 'O', 'head'], ['O12', 'O', 'head'], ['O13', 'O', 'head'], ['O14', 'O', 'head'],
  ['C1', 'C', 'glycerol'], ['HA', 'H', 'glycerol'], ['HB', 'H', 'glycerol'],
  ['C2', 'C', 'glycerol'], ['HS', 'H', 'glycerol'],
  ['C3', 'C', 'glycerol'], ['HX', 'H', 'glycerol'], ['HY', 'H', 'glycerol'],
  ['O21', 'O', 'glycerol'], ['O31', 'O', 'glycerol'],
  ['C21', 'C', 'acyl'], ['H21A', 'H', 'acyl'], ['H21B', 'H', 'acyl'], ['O22', 'O', 'acyl'],
  ['C22', 'C', 'acyl'], ['H22A', 'H', 'acyl'], ['H22B', 'H', 'acyl'],
  ['C23', 'C', 'acyl'], ['H23A', 'H', 'acyl'], ['H23B', 'H', 'acyl'],
  ['C24', 'C', 'acyl'], ['H24A', 'H', 'acyl'], ['H24B', 'H', 'acyl'], ['H24C', 'H', 'acyl'],
  ['C31', 'C', 'acyl'], ['H31A', 'H', 'acyl'], ['H31B', 'H', 'acyl'], ['O32', 'O', 'acyl'],
  ['C32', 'C', 'acyl'], ['H32A', 'H', 'acyl'], ['H32B', 'H', 'acyl'],
  ['C33', 'C', 'acyl'], ['H33A', 'H', 'acyl'], ['H33B', 'H', 'acyl'],
  ['C34', 'C', 'acyl'], ['H34A', 'H', 'acyl'], ['H34B', 'H', 'acyl'], ['H34C', 'H', 'acyl'],
];
// La passe du viewer : chaque atome tombe dans UNE part, la tête étant le reste.
const parts = { head: [], glycerol: [], acyl: [] };
POPC.forEach(([n, e], i) => { parts[H.lipidGroupOf(n, e, true)].push(i); });
eq(parts.head.length + parts.glycerol.length + parts.acyl.length, POPC.length,
  'les trois parts couvrent TOUS les atomes : aucune perte, aucun oubli');
eq(parts.glycerol.length, 10, 'le squelette = C1 · C2 · C3 · O21 · O31 + ses cinq hydrogènes');
ok(parts.acyl.length > parts.head.length && parts.head.length > 20,
  'les chaînes sont la plus grosse part, et la tête garde toute sa chimie');
// …puis la sélection `@indices` que NGL reçoit vraiment (aucun recouvrement).
const partsSele = {
  head: parts.head.length ? `@${parts.head.join(',')}` : '',
  glycerol: parts.glycerol.length ? `@${parts.glycerol.join(',')}` : '',
  acyl: parts.acyl.length ? `@${parts.acyl.join(',')}` : '',
};
const partsNgl = {};
Object.entries(partsSele).forEach(([g, s]) => {
  partsNgl[g] = new NGL.Selection(s);
  eq(partsNgl[g].selection.error, undefined, `la part « ${g} » est une sélection que NGL comprend`);
});
POPC.forEach(([n, e, expected], i) => {
  eq(H.lipidGroupOf(n, e, true), expected, `${n} : le classificateur du viewer donne la bonne part`);
  const hits = Object.keys(partsNgl).filter((g) => partsNgl[g].test({ index: i }));
  eq(hits, [expected], `${n} n’est dessiné QUE dans sa part (aucun recouvrement)`);
});
// Le bug corrigé : la tête n'est plus « P · N · O1* » mais TOUT le reste, donc les
// carbones de la choline et leurs hydrogènes reviennent dans le headgroup.
const headNames = POPC.filter(([n, e]) => H.lipidGroupOf(n, e, true) === 'head').map(([n]) => n);
['N', 'P', 'O11', 'O12', 'O13', 'O14', 'C11', 'C12', 'C13', 'C14', 'C15', 'H13A', 'H15C'].forEach((n) => {
  ok(headNames.includes(n), `${n} est dans la tête : un headgroup en Ball & Stick garde tous ses atomes`);
});
ok(headNames.length >= 24, 'la tête contient bien plus que le P / N / O de l’ancienne règle positive');
ok(!headNames.includes('C21') && !headNames.includes('O22') && !headNames.includes('C1'),
  '…et jamais une chaîne acyle ni un atome du squelette');
// Le drapeau `named` du viewer : « P / N / C1 » disent la nomenclature standard,
// « C12 / O9 » disent un fichier renommé d'après l'élément.
eq([
  H.LIPID_NAMED_PROBE.has('P'), H.LIPID_NAMED_PROBE.has('N'), H.LIPID_NAMED_PROBE.has('C1'),
  H.LIPID_NAMED_PROBE.has('C12'), H.LIPID_NAMED_PROBE.has('O9'),
  H.LIPID_CHAIN_PROBE_RE.test('C21'), H.LIPID_CHAIN_PROBE_RE.test('O32'),
  H.LIPID_CHAIN_PROBE_RE.test('C12'), H.LIPID_CHAIN_PROBE_RE.test('O9'),
], [true, true, true, false, false, true, true, false, false],
'P / N / C1 = nomenclature standard ; un C12 / O9 n’en est pas une');



/* ══ 10. LES DEUX PALETTES DU ⚙ (types d'atomes · types de sucres) ════════ */
// Ces deux schémas (« lab-elements » · « lab-sugar-identity ») vivaient dans le
// fichier SANS être ni enregistrés ni lus : les palettes de la roue ⚙ ne
// peignaient donc rien du tout. Ils sont maintenant enregistrés au démarrage
// (registerElementScheme / registerSugarScheme) et passés à NGL par les
// colorations « Atom type » / « Sugar type » — voici la preuve qu'ils colorent
// vraiment, exécutés avec le NGL installé comme les quatre schémas ci-dessus.
const elementsKey = H.registerColorScheme(NGL, 'lab-test-elements', H.defineElementScheme());
ok(typeof elementsKey === 'string' && elementsKey.length > 0, 'lab-elements s’enregistre comme les autres');
ok(Object.keys(NGL.ColormakerRegistry.getSchemes()).includes(elementsKey),
  'son id est utilisable en `color` par une représentation');
const elementsCm = NGL.ColormakerRegistry.getScheme({ scheme: elementsKey });
eq(typeof elementsCm.atomColor, 'function', 'le schéma des éléments sait colorer un atome');
eq(elementsCm.atomColor({ element: 'C' }), H.ELEMENT_COLOR_PALETTE.C,
  'un carbone prend la couleur de la palette des éléments');
eq(elementsCm.atomColor({ element: ' cl ' }), H.ELEMENT_COLOR_PALETTE.Cl,
  '…un chlore aussi (casse et espaces normalisés)');
eq(elementsCm.atomColor({ element: 'Xx' }), H.DEFAULT_ELEMENT_COLOR,
  'un élément hors palette garde le gris lisible (jamais noir)');
eq(elementsCm.atomColor({}), H.DEFAULT_ELEMENT_COLOR, 'un atome sans élément non plus');
eq(elementsCm.atomColor(null), H.DEFAULT_ELEMENT_COLOR, '…ni un atome absent (le rendu ne s’arrête pas)');
// Le schéma lit le STORE VIVANT : la roue ⚙ recolore sans réenregistrer quoi que
// ce soit (même mécanisme que lab-sstruc / lab-nucleic-groups / lab-lipid-groups).
const savedElementC = H.elementColorStore.C;
H.elementColorStore.C = 0x123456;
eq(elementsCm.atomColor({ element: 'C' }), 0x123456,
  'déplacer la pastille d’un élément recolore IMMÉDIATEMENT (aucun réenregistrement)');
H.elementColorStore.C = savedElementC;
const sugarsKey = H.registerColorScheme(NGL, 'lab-test-sugars', H.defineSugarIdentityScheme());
ok(typeof sugarsKey === 'string' && sugarsKey.length > 0, 'lab-sugar-identity s’enregistre comme les autres');
const sugarsCm = NGL.ColormakerRegistry.getScheme({ scheme: sugarsKey });
eq(sugarsCm.atomColor({ resname: 'GLC' }), H.SUGAR_IDENTITY_COLORS.GLC,
  'GLC prend la couleur de la palette des sucres');
eq(sugarsCm.atomColor({ resname: ' nag ' }), H.SUGAR_IDENTITY_COLORS.NAG,
  '…NAG aussi (casse et espaces normalisés)');
eq(sugarsCm.atomColor({ resname: 'HOH' }), H.DEFAULT_ELEMENT_COLOR,
  'une molécule d’eau n’est pas un sucre : gris lisible');
H.sugarColorStore.NAG = 0x654321;
eq(sugarsCm.atomColor({ resname: 'NAG' }), 0x654321, '…et la pastille des sucres est lue en direct');
H.sugarColorStore.NAG = H.SUGAR_IDENTITY_COLORS.NAG;
// La roue ⚙ propose EXACTEMENT les résidus que le menu des sucres sélectionne.
eq([...H.SUGAR_IDENTITY_CODES].sort(), Object.keys(H.SUGAR_IDENTITY_COLORS).sort(),
  'la grille de la roue et la table des sucres couvrent les mêmes résidus');
ok(H.elementColorStore.C === H.ELEMENT_COLOR_PALETTE.C, 'la palette des éléments est intacte après les essais');

/* ══ 11. LES QUATRE LECTURES STRUCTURALES (PART 2 / PART 3) ════════════════
   Les glycanes LIÉS, les CLASSES de lipides, les FORMES A · B · Z · ARN et les
   MOTIFS G-quadruplex · hairpin sont eux aussi des schémas NGL maison : voici la
   preuve qu'ils colorent vraiment, exécutés avec le NGL installé — et sur une
   STRUCTURE, puisque la classification est calculée par structure puis mise en
   cache (nucleicClassFor · glycanEntityMapFor). On fabrique donc une structure qui
   parle l'API de NGL : `eachAtom`, et chaque atome sait ses voisins liés. */
const fakeStructure = (atoms, bonds = []) => ({
  atomCount: atoms.length,
  eachAtom(cb) {
    atoms.forEach((a) => {
      cb({
        ...a,
        eachBondedAtom(next) {
          bonds.forEach(([i, j]) => {
            if (i === a.index) next({ index: j });
            else if (j === a.index) next({ index: i });
          });
        },
      });
    });
  },
});
let fakeIdx = 0;
const fAtom = (name, p, resname, residueIndex, chainIndex = 0) => {
  fakeIdx += 1;
  return {
    index: fakeIdx, atomname: name, element: name.charAt(0).toUpperCase(),
    resname, resno: residueIndex + 1, residueIndex, chainIndex, x: p[0], y: p[1], z: p[2],
  };
};
// Quatre points dont la torsion vaut EXACTEMENT t : p3 à l'azimut 0, p0 à −t.
const tor4 = (origin, axisLen, radius, t) => {
  const rad = (t * Math.PI) / 180;
  const p1 = origin;
  const p2 = [origin[0] + axisLen, origin[1], origin[2]];
  const p3 = [p2[0], p2[1] + radius, p2[2]];
  return [[p1[0], p1[1] + radius * Math.cos(-rad), p1[2] + radius * Math.sin(-rad)], p1, p2, p3];
};
const chiAtoms = (o, t, purine) => {
  const [a, b, c, d] = tor4(o, 1.46, 1.4, t);
  return purine
    ? { "O4'": a, "C1'": b, N9: c, C4: d }
    : { "O4'": a, "C1'": b, N1: c, C2: d };
};
const deltaAtoms = (o, t) => {
  const [a, b, c, d] = tor4(o, 1.52, 1.45, t);
  return { "C5'": a, "C4'": b, "C3'": c, "O3'": d };
};
const nucResidue = (resname, ri, ci, chiT, deltaT) => Object.entries({
  ...chiAtoms([0, 0, 0], chiT, /^[DR]?[AG]/.test(resname)),
  ...deltaAtoms([40, 0, 0], deltaT),
}).map(([n, p]) => fAtom(n, p, resname, ri, ci));
// Un ARN en C3'-endo (δ = 85° → A-RNA) et un ADN en C2'-endo (δ = 150° → B-DNA).
const nucStruct = fakeStructure([...nucResidue('RA', 0, 0, 180, 85), ...nucResidue('DC', 1, 0, 180, 150)]);

const formKey = H.registerColorScheme(NGL, 'lab-test-nuc-form', H.defineNucleicFormScheme());
ok(typeof formKey === 'string' && formKey.length > 0, 'lab-nuc-form s\'enregistre comme les autres');
const formCm = NGL.ColormakerRegistry.getScheme({ scheme: formKey });
eq(formCm.atomColor({ structure: nucStruct, residueIndex: 0 }), H.DEFAULT_NUCLEIC_FORM_COLORS['a-rna'],
  'un ribose C3\'-endo → la couleur A-RNA');
eq(formCm.atomColor({ structure: nucStruct, residueIndex: 1 }), H.DEFAULT_NUCLEIC_FORM_COLORS['b-dna'],
  'un désoxyribose C2\'-endo → la couleur B-DNA');
eq(formCm.atomColor({ residueIndex: 0 }), H.DEFAULT_ELEMENT_COLOR, 'sans structure → gris lisible (jamais une exception)');
eq(formCm.atomColor(null), H.DEFAULT_ELEMENT_COLOR, '…et sans atome non plus');
ok(H.nucleicClassFor(nucStruct) === H.nucleicClassFor(nucStruct),
  'la classification est calculée UNE fois par structure (mise en cache)');
const savedForm = H.nucleicFormColorStore['a-rna'];
H.nucleicFormColorStore['a-rna'] = 0x0f0f0f;
eq(formCm.atomColor({ structure: nucStruct, residueIndex: 0 }), 0x0f0f0f,
  'la pastille d\'une forme est lue en direct (aucun réenregistrement)');
H.nucleicFormColorStore['a-rna'] = savedForm;

const motifKey = H.registerColorScheme(NGL, 'lab-test-nuc-motif', H.defineNucleicMotifScheme());
ok(typeof motifKey === 'string' && motifKey.length > 0, 'lab-nuc-motif s\'enregistre comme les autres');
const motifCm = NGL.ColormakerRegistry.getScheme({ scheme: motifKey });
// Aucun motif dans cette structure : chaque nucléotide garde sa couleur de 2°
// structure (la règle exacte de lab-sstruc) — c'est ce qui fait RESSORTIR un motif.
eq(motifCm.atomColor({ structure: nucStruct, residueIndex: 0, sstruc: 'h' }), H.sstrucColorStore.helix,
  'hors motif, un nucléotide garde la couleur de 2° structure (hélice)');
eq(motifCm.atomColor({ structure: nucStruct, residueIndex: 1, sstruc: 'c' }), H.sstrucColorStore.loop,
  '…et une boucle la sienne');
eq(motifCm.atomColor({ structure: nucStruct, residueIndex: 1, sstruc: 'e' }), H.sstrucColorStore.sheet,
  '…feuillet compris');
// Un VRAI G-quadruplex : deux tétrades de quatre guanines empilés à 3.35 Å (la
// même géométrie de Hoogsteen que dans _viewer_structure_classes_test.mjs).
const TETRAD = {
  N1: [2.0, 0],
  O6: [2.9 * Math.cos((-20 * Math.PI) / 180), 2.9 * Math.sin((-20 * Math.PI) / 180)],
  N2: [2.0 * Math.cos((6 * Math.PI) / 180), 2.0 * Math.sin((6 * Math.PI) / 180)],
  N7: [2.9 * Math.cos((-14 * Math.PI) / 180), 2.9 * Math.sin((-14 * Math.PI) / 180)],
  C2: [1.879, 0.684], N3: [2.165, 1.25], C4: [1.607, 1.915], C5: [1.1, 1.905], C6: [1.762, 1.478],
};
const tetradAtoms = (z, chainBase, riBase) => [0, 1, 2, 3].flatMap((k) => {
  const a = (k * Math.PI) / 2;
  const rot = ([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z];
  return Object.entries(TETRAD).map(([n, p]) => fAtom(n, rot(p), 'G', riBase + k, chainBase + k));
});
const g4Struct = fakeStructure([...tetradAtoms(0, 0, 0), ...tetradAtoms(3.35, 4, 4)]);
eq(motifCm.atomColor({ structure: g4Struct, residueIndex: 0 }), H.DEFAULT_NUCLEIC_MOTIF_COLORS.gquad,
  'une guanine d\'un G-quadruplex prend la couleur du motif');
eq(motifCm.atomColor({ structure: g4Struct, residueIndex: 4, sstruc: 'c' }), H.DEFAULT_NUCLEIC_MOTIF_COLORS.gquad,
  '…les deux tétrades empilés, donc les huit guanines (leur 2° structure est ignorée)');
eq(motifCm.atomColor({ structure: g4Struct, residueIndex: 99, sstruc: 'h' }), H.sstrucColorStore.helix,
  '…mais un résidu qui n\'est dans aucun motif garde sa 2° structure');
const g4Lone = fakeStructure(tetradAtoms(0, 0, 0));
eq(motifCm.atomColor({ structure: g4Lone, residueIndex: 0, sstruc: 'c' }), H.sstrucColorStore.loop,
  'un tétrade SEUL n\'est pas un quadruplex : ses guanines gardent leur 2° structure');

const glycanKey = H.registerColorScheme(NGL, 'lab-test-glycans', H.defineGlycanScheme());
ok(typeof glycanKey === 'string' && glycanKey.length > 0, 'lab-glycans s\'enregistre comme les autres');
const glycanCm = NGL.ColormakerRegistry.getScheme({ scheme: glycanKey });
const glcC1 = fAtom('C1', [0, 0, 0], 'GLC', 0);
const glcO4 = fAtom('O4', [2, 0, 0], 'GLC', 0);
const nagO4 = fAtom('O4', [1.42, 0, 0], 'NAG', 1);   // 1.42 Å de C1(GLC) → LIÉ
const nagC1 = fAtom('C1', [10, 0, 0], 'NAG', 1);
const fucC1 = fAtom('C1', [50, 0, 0], 'FUC', 2);     // loin de tout → isolé
const fucO4 = fAtom('O4', [55, 0, 0], 'FUC', 2);
const sugarStruct = fakeStructure([glcC1, glcO4, nagO4, nagC1, fucC1, fucO4]);
eq(glycanCm.atomColor({ ...glcC1, structure: sugarStruct }), H.GLYCAN_ENTITY_COLORS[0],
  'les atomes d\'un glycanne LIÉ prennent la couleur de leur entité');
eq(glycanCm.atomColor({ ...nagC1, structure: sugarStruct }), H.GLYCAN_ENTITY_COLORS[0],
  '…les deux monomères de la chaîne, une seule couleur : une seule molécule');
eq(glycanCm.atomColor({ ...fucC1, structure: sugarStruct }), H.SUGAR_IDENTITY_COLORS.FUC,
  'un sucre ISOLÉ garde la couleur de son identité : il n\'est lié à rien');
eq(glycanCm.atomColor({ ...fucC1, structure: fakeStructure([]) }), H.SUGAR_IDENTITY_COLORS.FUC,
  '…une structure sans aucun monomère retombe, elle aussi, sur la palette des sucres');
eq(glycanCm.atomColor({ structure: sugarStruct, index: 99999, resname: 'HOH' }), H.DEFAULT_ELEMENT_COLOR,
  'un atome qui n\'est pas un sucre garde le gris lisible');
eq(glycanCm.atomColor({ resname: 'GLC' }), H.SUGAR_IDENTITY_COLORS.GLC,
  'sans structure, le schéma retombe sur la palette des sucres (jamais de molécule sans couleur)');
// « polysaccharides are correctly identified but not linked together » : l'accepteur
// du α2→8 d'un polysialique est un O8 — ni un O4 ni un O6 — et le nom du monomère ne
// dit rien de la chaîne. C'est la GÉOMÉTRIE qui lie (un O8 à 1.44 Å du C2 de l'autre
// acide sialique), donc le schéma peint les deux monomères d'UNE seule couleur.
const siaC2 = fAtom('C2', [0, 0, 0], 'SIA', 3);
const siaO8 = fAtom('O8', [1.44, 0, 0], 'SIA', 4);
const siaStruct = fakeStructure([siaC2, siaO8]);
eq(glycanCm.atomColor({ ...siaC2, structure: siaStruct }), H.GLYCAN_ENTITY_COLORS[0],
  'un polySia lié α2→8 (accepteur O8) est UNE molécule : une seule couleur');
eq(glycanCm.atomColor({ ...siaO8, structure: siaStruct }), H.GLYCAN_ENTITY_COLORS[0],
  '…l\'atome accepteur porte la couleur de l\'entité, pas celle de son sucre isolé');
eq(H.glycanEntityMapFor(siaStruct).entities.map((e) => [e.members.length, e.linked]),
  [[2, true]], '…et l\'entité est bien marquée « liée » (ce que le menu des sucres annonce)');

const classKey = H.registerColorScheme(NGL, 'lab-test-lipid-class', H.defineLipidClassScheme());
ok(typeof classKey === 'string' && classKey.length > 0, 'lab-lipid-class s\'enregistre comme les autres');
const classCm = NGL.ColormakerRegistry.getScheme({ scheme: classKey });
eq(classCm.atomColor({ resname: 'POPC' }), H.LIPID_CLASS_COLORS.PC, 'POPC → la couleur des phosphatidylcholines');
eq(classCm.atomColor({ resname: 'DPPC' }), H.LIPID_CLASS_COLORS.PC, '…DPPC aussi (la classe se lit en fin de code)');
eq(classCm.atomColor({ resname: 'POP' }), H.LIPID_CLASS_COLORS.PC, '…et le code court POP');
eq(classCm.atomColor({ resname: 'EPH' }), H.LIPID_CLASS_COLORS.PE, 'EPH → phosphatidyléthanolamine');
eq(classCm.atomColor({ resname: 'PGL' }), H.LIPID_CLASS_COLORS.PG, 'PGL → phosphatidylglycérol');
eq(classCm.atomColor({ resname: 'CLR' }), H.LIPID_CLASS_COLORS.Chol, 'CLR → un stérol');
eq(classCm.atomColor({ resname: 'HOH' }), H.LIPID_CLASS_COLORS.OTHER, 'une eau → la classe « autre »');
eq(classCm.atomColor(null), H.LIPID_CLASS_COLORS.OTHER, '…et un atome absent aussi');
H.lipidClassColorStore.PC = 0xabcdef;
eq(classCm.atomColor({ resname: 'DPPC' }), 0xabcdef, 'la pastille d\'une classe est lue en direct');
H.lipidClassColorStore.PC = H.LIPID_CLASS_COLORS.PC;

/* ── 5ter. LES PARTIES DES TROIS PALETTES (la demande) ─────────────────────────
   « for each type of lipid allow to define the color for headgroup, glycerol and
   acyl chains », « for each type of base … bases, ribose/desoxyribose », « for
   each type of amino acid … backbone and sidechains » — et ces couleurs sont
   celles que « color by lipid type / base type / residue » peint. Chaque schéma
   choisit donc la couleur par la PART de l'atome : la MARCHE des lipides d'abord
   (les @index que les rangées dessinent), le NOM de l'atome ensuite, et — quand
   aucun des deux ne sait — la couleur du TYPE, jamais une part inventée. */
const lipidStruct = {};                       // une structure factice : la marche la connaît
H.lipidPartIndexStore.structure = lipidStruct;
H.lipidPartIndexStore.head = new Set([7]);
H.lipidPartIndexStore.glycerol = new Set([8]);
H.lipidPartIndexStore.acyl = new Set([9]);
H.lipidPartColorStore.PC = { head: 0x111111, glycerol: 0x222222, acyl: 0x333333 };
eq(classCm.atomColor({ resname: 'POPC', structure: lipidStruct, index: 7 }), 0x111111,
  'POPC · la TÊTE prend la couleur de tête de SA classe');
eq(classCm.atomColor({ resname: 'POPC', structure: lipidStruct, index: 8 }), 0x222222,
  '…le glycérol la sienne');
eq(classCm.atomColor({ resname: 'POPC', structure: lipidStruct, index: 9 }), 0x333333,
  '…la chaîne acyle la sienne');
eq(classCm.atomColor({ resname: 'POPC', atomname: 'C21' }), 0x333333,
  'hors marche, le NOM suffit (C21 = un carbone de chaîne)');
eq(classCm.atomColor({ resname: 'POPC', atomname: 'P' }), 0x111111,
  'un atome de TÊTE que le nom seul ne place pas prend la pastille de TÊTE de sa classe — plus jamais la couleur du type (le rapport de cette session : « still green hydrogen atoms in the headgroup »)');
eq(classCm.atomColor({ resname: 'HOH', atomname: 'O' }), H.LIPID_CLASS_COLORS.OTHER,
  '…mais HORS d’un lipide, rien n’est inventé : une eau garde la couleur de son type');
eq(classCm.atomColor({ resname: 'DPPE', atomname: 'C31' }), H.LIPID_CLASS_COLORS.PE,
  '…et une classe dont les parts n\'ont pas été touchées garde sa couleur unique');
/* ── 5ter-bis. UN HYDROGÈNE DE LIPIDE EST PEINT COMME L'ATOME DONT IL PEND ─────
   Le rapport de cette session : « In the styling window the hydrogen atoms of a lipid
   are green while the different parts of the lipid are defined in a different color in
   the setting wheel. It seems that the “lipid type” option is not working anymore. »
   Le nom seul ne dit rien d'un hydrogène de chaîne nommé H16T (il renvoie à C16, que
   la nomenclature stricte C2x / C3x ne place pas) : il tombait donc dans la TÊTE de la
   palette des parties, pendant que son carbone suivait la roue ⚙. Le graphe de
   liaisons de la structure tranche, et les DEUX schémas sont exécutés ici. */
H.lipidColorStore.named = true;
const POPC_NAMES = ['C2', 'H2R', 'C16', 'H16T', 'C21', 'H21A', 'O9', 'HO9', 'C31', 'HN2', 'N', 'H1'];
const POPC_ELS = ['C', 'H', 'C', 'H', 'C', 'H', 'O', 'H', 'C', 'H', 'N', 'H'];
const POPC_BONDS = [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9], [10, 11]];  // chaque H sur SON atome lourd
const lipidGraph = {
  eachBond: (cb) => POPC_BONDS.forEach(([a, b]) => cb({ atomIndex1: a, atomIndex2: b })),
  getAtomProxy: (i) => ({ atomname: POPC_NAMES[i], element: POPC_ELS[i] }),
};
const H_AT = (i) => ({
  resname: 'POPC', atomname: POPC_NAMES[i], element: POPC_ELS[i], structure: lipidGraph, index: i,
});
// Sans graphe de liaisons, rien ne change : le nom décide, comme avant.
eq(classCm.atomColor({ resname: 'POPC', atomname: 'HN2', element: 'H' }), 0x111111,
  'sans graphe, un H au nom muet reste dans sa TÊTE : c’est la pastille de tête qui gagne, plus le vert de la classe');
// Avec le graphe : l'hydrogène suit SON atome lourd, pour les deux schémas.
eq(classCm.atomColor(H_AT(1)), 0x222222, 'H2R pend à C2 : il prend la couleur du GLYCÉROL de sa classe');
eq(classCm.atomColor(H_AT(5)), 0x333333, 'H21A pend à C21 : il prend celle des CHAÎNES');
eq(classCm.atomColor(H_AT(9)), 0x333333,
  'un H au nom muet (HN2) pend à C31 : il prend AUSSI celle des chaînes — c’était la couleur de type, le vert du rapport');
eq(classCm.atomColor(H_AT(3)), 0x111111,
  'H16T pend à C16, que le lecteur strict ne place pas : il suit la TÊTE de sa classe, exactement comme son carbone');
/* ⚠ LA LIAISON PASSE AVANT LE NOM — le rapport de cette session : « there are still
   green hydrogen atoms in the headgroup of lipids which do not follow the color
   specified in the setting wheel choosing the option color by lipid type ». Un H de
   chaîne nommé comme le SQUELETTE (H2R pend à C21) suivait son nom — « glycérol » — et
   son carbone suivait la roue : la liaison, elle, ne se trompe pas. */
const chainGraph = {
  eachBond: (cb) => cb({ atomIndex1: 0, atomIndex2: 1 }),
  getAtomProxy: (i) => (i === 0
    ? { atomname: 'C21', element: 'C' }
    : { atomname: 'H2R', element: 'H' }),
};
eq(classCm.atomColor({ resname: 'POPC', atomname: 'H2R', element: 'H', structure: chainGraph, index: 1 }), 0x333333,
  'un H nommé comme le squelette mais LIÉ à une chaîne prend la couleur des CHAÎNES (la liaison tranche)');
/* …ET LE VERD DU RAPPORT EST MESURÉ TEL QUEL : sur une tête de PE dont la roue ⚙ a
   séparé les trois parts, la pastille de TÊTE doit gagner sur la couleur de CLASSE
   pour l’atome ENTIER — le phosphore, l’azote, les carbones de tête ET leurs
   hydrogènes, ceux que le nom seul ne place pas. */
H.lipidClassColorStore.PE = 0x3fbf6f;   // le vert d’un PE (la couleur de classe du rapport)
H.lipidPartColorStore.PE = { head: 0x2244ff, glycerol: 0x22aaaa, acyl: 0xdddddd };
['P', 'N', 'C11', 'H11A', 'HN2', 'HO9'].forEach((n) => {
  // `element: 'H'` pour les trois derniers : c'est la seule chose que NGL ajoute au nom.
  const el = n.startsWith('H') ? 'H' : '';
  eq(classCm.atomColor({ resname: 'POPE', atomname: n, element: el }), 0x2244ff,
    `la tête de POPE « ${n} » suit la pastille de TÊTE de la roue ⚙, jamais le vert de sa classe`);
});
H.lipidClassColorStore.PE = H.LIPID_CLASS_COLORS.PE;
H.lipidPartColorStore.PE = {
  head: H.LIPID_CLASS_COLORS.PE, glycerol: H.LIPID_CLASS_COLORS.PE, acyl: H.LIPID_CLASS_COLORS.PE,
};
eq(lipidCm.atomColor(H_AT(9)), H.DEFAULT_LIPID_COLORS.acyl,
  '[parties] …et là aussi l’H suit son carbone (HN2 → chaîne, plus jamais la tête)');
eq(lipidCm.atomColor(H_AT(1)), H.DEFAULT_LIPID_COLORS.glycerol,
  '[parties] H2R suit le squelette de son atome lourd');
eq(lipidCm.atomColor(H_AT(7)), H.DEFAULT_LIPID_COLORS.head,
  '[parties] HO9 pend à O9 : l’hydrogène d’une tête reste dans la tête');
/* Le graphe est lu UNE fois par structure : deux lectures du même H ne le recalculent
   pas (un compteur le mesure, et la couleur reste O(1) sur un grand système). */
let graphReads = 0;
const countedGraph = {
  eachBond: (cb) => { graphReads += 1; POPC_BONDS.forEach(([a, b]) => cb({ atomIndex1: a, atomIndex2: b })); },
  getAtomProxy: (i) => ({ atomname: POPC_NAMES[i], element: POPC_ELS[i] }),
};
const counted = { resname: 'POPC', atomname: 'HN2', element: 'H', structure: countedGraph, index: 9 };
classCm.atomColor(counted); classCm.atomColor(counted); classCm.atomColor(counted);
eq(graphReads, 1, 'le graphe des liaisons n’est lu qu’UNE fois par structure (cache)');
H.lipidPartColorStore.PC = { head: H.LIPID_CLASS_COLORS.PC, glycerol: H.LIPID_CLASS_COLORS.PC, acyl: H.LIPID_CLASS_COLORS.PC };

H.lipidPartIndexStore.structure = null; H.lipidPartIndexStore.head = null;
H.lipidPartIndexStore.glycerol = null; H.lipidPartIndexStore.acyl = null;

// Les bases : le ribose / 2′-désoxyribose a SON swatch, la base et le phosphate
// gardent le leur — les deux valent la couleur de la base par défaut.
const baseKey = H.registerColorScheme(NGL, 'lab-test-base-type', H.defineBaseTypeScheme());
const baseCm = NGL.ColormakerRegistry.getScheme({ scheme: baseKey });
eq(baseCm.atomColor({ resname: 'DA', atomname: 'N1' }), H.BASE_IDENTITY_COLORS.A,
  'la base garde la couleur de sa base');
eq(baseCm.atomColor({ resname: 'DA', atomname: "C1'" }), H.BASE_IDENTITY_COLORS.A,
  '…et son ribose AUSSI par défaut (les deux swatches sont égaux au départ)');
H.baseSugarColorStore.A = 0x123456;
eq(baseCm.atomColor({ resname: 'DA', atomname: "C1'" }), 0x123456,
  'séparer le swatch du ribose change les seuls atomes primés');
eq(baseCm.atomColor({ resname: 'DA', atomname: 'N1' }), H.BASE_IDENTITY_COLORS.A,
  '…la base, elle, ne bouge pas');
eq(baseCm.atomColor({ resname: 'DA', atomname: 'P' }), H.BASE_IDENTITY_COLORS.A,
  'le phosphate reste avec la base');
H.baseSugarColorStore.A = H.BASE_IDENTITY_COLORS.A;

// Les résidus : squelette et chaînes latérales, lus au NOM de l'atome.
// ⚠ LEU et non ALA : `residueColorOf` laisse un résidu dont le nom commence par
// A · C · G · T · U prendre la couleur de sa BASE (ALA → A, CYS → C) — un
// comportement d'origine, que ce schéma ne fait que traverser.
const resKey = H.registerColorScheme(NGL, 'lab-test-residue', H.defineResidueScheme());
const resCm = NGL.ColormakerRegistry.getScheme({ scheme: resKey });
eq(resCm.atomColor({ resname: 'LEU', atomname: 'CA' }), H.RESIDUE_COLOR_PALETTE.LEU,
  'à défaut, un atome de squelette prend la couleur du résidu');
H.residuePartColorStore.LEU = { backbone: 0xaaaaaa, sidechain: 0xbbbbbb };
eq(resCm.atomColor({ resname: 'LEU', atomname: 'CA' }), 0xaaaaaa,
  '…le swatch « squelette » la remplace (N · CA · C · O)');
eq(resCm.atomColor({ resname: 'LEU', atomname: 'CB' }), 0xbbbbbb,
  'une chaîne latérale prend celui des chaînes');
eq(resCm.atomColor({ resname: 'LEU' }), H.RESIDUE_COLOR_PALETTE.LEU,
  'un atome sans nom garde la couleur du résidu (jamais de part inventée)');
eq(resCm.atomColor({ resname: 'DG', atomname: "C1'" }), H.BASE_IDENTITY_COLORS.G,
  'un résidu NUCLÉIQUE garde la couleur de sa base (les 20 acides aminés seuls ont deux parts)');
H.residuePartColorStore.LEU = { backbone: H.RESIDUE_COLOR_PALETTE.LEU, sidechain: H.RESIDUE_COLOR_PALETTE.LEU };
eq(H.proteinAtomPart(' ca '), 'backbone', 'le lecteur normalise le nom (casse et espaces)');
eq(H.proteinAtomPart('CB'), 'sidechain', '…et range CB avec les chaînes');
eq(H.proteinAtomPart(''), '', '…tandis qu\'un nom vide ne dit rien du tout');


/* ── Bilan ══════════════════════════════════════════════════════════════ */
console.log(`_viewer_scheme_test.mjs — ${passed} assertions OK`);
