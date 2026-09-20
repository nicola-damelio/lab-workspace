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

/* ── Les helpers du viewer, exécutés dans une sandbox avec le vrai NGL ──── */
const sandbox = [
  sliceObject(VIEW, 'BASE_IDENTITY_COLORS'),
  sliceObject(VIEW, 'DEFAULT_NUCLEIC_COLORS'),
  sliceObject(VIEW, 'sstrucColorStore'),
  sliceObject(VIEW, 'nucleicColorStore'),
  sliceFn(VIEW, 'nucleicGroupOf'),
  sliceFn(VIEW, 'baseIdentityColorOf'),
  sliceFn(VIEW, 'registerColorScheme'),
  sliceFn(VIEW, 'defineSstrucScheme'),
  sliceFn(VIEW, 'defineNucleicGroupsScheme'),
  sliceFn(VIEW, 'defineBaseIdentityScheme'),
  `return { BASE_IDENTITY_COLORS, DEFAULT_NUCLEIC_COLORS, sstrucColorStore, nucleicColorStore,
    nucleicGroupOf, baseIdentityColorOf, registerColorScheme,
    defineSstrucScheme, defineNucleicGroupsScheme, defineBaseIdentityScheme };`
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

/* ── Bilan ══════════════════════════════════════════════════════════════ */
console.log(`_viewer_scheme_test.mjs — ${passed} assertions OK`);
