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
     • les trois schémas du viewer (structure secondaire, groupes chimiques des
       acides nucléiques, identité de base A · C · G · T · U) donnent bien les
       couleurs attendues, y compris à travers le VRAI `atomColor(atom)` de NGL ;
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
  `return { BASE_IDENTITY_COLORS, DEFAULT_NUCLEIC_COLORS, DEFAULT_LIPID_COLORS, sstrucColorStore, nucleicColorStore, lipidColorStore,
    LIPID_GLYCEROL_NAMES, LIPID_ACYL_RE, LIPID_POLAR_ELEMENTS, LIPID_NAMED_PROBE, LIPID_CHAIN_PROBE_RE,
    nucleicGroupOf, baseIdentityColorOf, atomElement, lipidGroupOf, registerColorScheme,
    defineSstrucScheme, defineNucleicGroupsScheme, defineBaseIdentityScheme, defineLipidGroupsScheme };`
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

/* ══ 7. LA SÉLECTION DU FIN ANNEAU DE « Stylized rings » EST VALIDE ══════ */
const ringSele = new NGL.Selection('nucleic and sidechain');
eq(ringSele.selection.error, undefined, 'la sélection du pourtour des bases est comprise par NGL');
has("add('licorice', { sele: 'nucleic and sidechain', ...baseIdentityCol()",
  'et c’est bien celle-là que « Stylized rings » utilise pour son pourtour');
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



/* ── Bilan ══════════════════════════════════════════════════════════════ */
console.log(`_viewer_scheme_test.mjs — ${passed} assertions OK`);
