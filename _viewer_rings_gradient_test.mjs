/* =========================================================================
   _viewer_rings_gradient_test.mjs — LES PLAQUES DE CYCLES (« stylized » DNA /
   RNA, façon PyMOL) et la COLORATION GRADUELLE d'un ruban le long de la séquence.

   Ce que ce fichier protège :

     • « Stylized rings » dessine de VRAIES PLAQUES PLEINES — l'anneau de chaque
       base ET l'anneau du ribose. NGL n'a aucune représentation pour cela (sa
       représentation `base` est un Ball & Stick sur les atomes du rung), donc le
       viewer construit les plaques lui-même :
         - découverte des cycles sur le graphe de liaisons (un cycle = un anneau,
           rendu DANS L'ORDRE DU CYCLE, ce qui est exactement l'ordre du polygone) ;
         - triangulation en éventail depuis le centroïde, dans le plan du cycle
           (normale de Newell, partagée par tous les sommets) ;
         - UN SEUL MeshBuffer pour toutes les plaques d'un composant, confié au
           composant de structure (addBufferRepresentation) donc il suit sa
           matrice (poses de docking, molécules extra) ;
         - couleur et transparence venues du panneau 🎨 du menu B — les réponses
           du viewer à cartoon_ring_color / cartoon_ring_transparency ;
     • la couleur d'une plaque : UNE couleur unie (ringColour 'custom'), sinon les
       couleurs de groupes quand « Colour by chemical group » est allumé, sinon
       l'identité de la base (A · C · G · T · U) — et la plaque du ribose suit la
       couleur de SON nucléotide ;
     • le dégradé : deux couleurs, de la PREMIÈRE à la DERNIÈRE résidu de CHAQUE
       chaîne (N → C pour une protéine, 5' → 3' pour un acide nucléique), avec un
       store vivant et des bornes mesurées sur la structure dessinée ;
     • « Atom colour » d'un menu est lu par UN SEUL helper (catColorParams) : les
       couleurs de structure secondaire atteignent donc le RUBAN autant que les
       atomes / liaisons, et un schéma indisponible retombe sur l'aspect classique
       au lieu de ne rien dessiner.

   Le viewer est un .jsx : ses helpers purs sont EXTRAITS du fichier puis EXÉCUTÉS
   (comme dans _viewer_scheme_test.mjs) — et les plaques sont éprouvées sur le
   VRAI gabarit nucléotidique que l'application embarque
   (public/structures/template_nucleotide_dna.pdb), avec le VRAI NGL pour le
   MeshBuffer et le schéma de dégradé.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Le paquet installé : NGL 2.4.0, exactement la version chargée par la page.
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
const near = (a, b, what) => ok(Math.abs(a - b) < 1e-6, `${what}\n  attendu ≈ ${b}, obtenu ${a}`);
// Le MeshBuffer de NGL range les couleurs en Float32 : deux valeurs « égales » le
// sont donc à la précision du Float32 près — on compare des clés arrondies.
const rgbKey = (arr) => [...new Float32Array(arr)].map((v) => v.toFixed(5)).join(',');

const VIEW = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
const CODE = VIEW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');


/* ── Extraction : `const name = (…) => { … };` et `const name = { … };` ──── */
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
const sliceRaw = (name) => {
  const m = new RegExp(`const ${name} = ([^;]+);`).exec(VIEW);
  assert.ok(!!m, `constante ${name} introuvable`);
  return m[1];
};

/* ── La sandbox : les helpers du viewer, exécutés pour de vrai ───────────── */
// `keys` dit si les schémas maison ont pu être enregistrés (`null` = échec de
// l'enregistrement, le cas que le viewer doit encaisser sans ne rien dessiner).
const buildHelpers = (keys = {}) => new Function([
  `const RING_MAX_SIZE = ${sliceRaw('RING_MAX_SIZE')};`,
  `const RING_TRANSPARENCY_DEFAULT = ${sliceRaw('RING_TRANSPARENCY_DEFAULT')};`,
  `const RING_TRANSPARENCY_MAX = ${sliceRaw('RING_TRANSPARENCY_MAX')};`,
  sliceObject(VIEW, 'DEFAULT_GRADIENT_COLORS'),
  sliceObject(VIEW, 'BASE_IDENTITY_COLORS'),
  sliceObject(VIEW, 'DEFAULT_NUCLEIC_COLORS'),
  sliceFn(VIEW, 'nucleicGroupOf'),
  // La lettre de la base (A · C · G · T · U) : la couleur des plaques passe par
  // elle, donc elle est extraite AVANT (elle est aussi le lecteur du classificateur
  // de conformation de PART 3).
  sliceFn(VIEW, 'nucBaseOf'),
  sliceFn(VIEW, 'baseIdentityColorOf'),
  `const flatHex = ${sliceRaw('flatHex')};`,
  sliceFn(VIEW, 'hexToRgb01'),
  sliceFn(VIEW, 'ringPlaneNormal'),
  sliceFn(VIEW, 'ringCyclesOf'),
  sliceFn(VIEW, 'ringPlateTriangles'),
  sliceFn(VIEW, 'ringPlateColorOf'),
  sliceFn(VIEW, 'nucleicRingPlates'),
  sliceFn(VIEW, 'toNglSelection'),
  sliceFn(VIEW, 'lerpHexColors'),
  sliceFn(VIEW, 'gradientT'),
  sliceFn(VIEW, 'gradientRangesFor'),
  sliceFn(VIEW, 'defineGradientScheme'),
  sliceFn(VIEW, 'registerColorScheme'),
  sliceFn(VIEW, 'catColorParams'),
  sliceObject(VIEW, 'gradientColorStore'),
  `let sstrucSchemeKey = ${keys.sstruc === undefined ? 'null' : JSON.stringify(keys.sstruc)};`,
  `let gradientSchemeKey = ${keys.gradient === undefined ? 'null' : JSON.stringify(keys.gradient)};`,
  // Les deux palettes du ⚙ (types d'atomes · types de sucres) : elles aussi
  // peuvent manquer (l'enregistrement du schéma a échoué) et le menu doit alors
  // garder l'aspect classique au lieu de ne rien dessiner.
  `let elementSchemeKey = ${keys.elements === undefined ? 'null' : JSON.stringify(keys.elements)};`,
  `let sugarSchemeKey = ${keys.sugar === undefined ? 'null' : JSON.stringify(keys.sugar)};`,  // PART 4 — les palettes et les schémas que la barre de style lit.
  `const BASE_TYPE_ORDER = ${sliceRaw('BASE_TYPE_ORDER')};`,
  sliceObject(VIEW, 'RESIDUE_COLOR_PALETTE'),
  sliceObject(VIEW, 'residueColorStore'),
  sliceFn(VIEW, 'residueColorOf'),
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

  `return { RING_MAX_SIZE, RING_TRANSPARENCY_DEFAULT, RING_TRANSPARENCY_MAX, DEFAULT_GRADIENT_COLORS,
    BASE_IDENTITY_COLORS, DEFAULT_NUCLEIC_COLORS, nucleicGroupOf, baseIdentityColorOf, flatHex,
    hexToRgb01, ringPlaneNormal, ringCyclesOf, ringPlateTriangles, ringPlateColorOf, nucleicRingPlates,
    toNglSelection, lerpHexColors, gradientT, gradientRangesFor, defineGradientScheme,
    registerColorScheme, catColorParams, gradientColorStore ,
      BASE_TYPE_ORDER, RESIDUE_COLOR_PALETTE, residueColorStore, residueColorOf, defineResidueScheme, baseTypeColorStore, baseTypeColorOf, defineBaseTypeScheme, CHARGE_COLORS, chargeColorStore, ionChargeOf, chargeColorOf, defineChargeScheme, SUGAR_TYPE_COLORS, sugarTypeColorStore, SUGAR_TYPE_OF_CODE, sugarTypeOf, sugarTypeColorOf };`,
].join('\n'))();
const H = buildHelpers();
const HS = buildHelpers({ sstruc: 'lab-test-sstruc', gradient: 'lab-test-gradient', elements: 'lab-test-elements', sugar: 'lab-test-sugar' });


/* ══ 1. LA DÉCOUVERTE DES CYCLES ══════════════════════════════════════════ */
// Un graphe de liaisons minimal : le squelette d'une purine (deux cycles FUSIONNÉS,
// qui partagent l'arête 4–5) plus une chaîne pendante qui ne doit JAMAIS devenir un
// anneau.
const graph = {
  1: [2, 6], 2: [1, 3], 3: [2, 4], 4: [3, 5, 9], 5: [4, 6, 7],
  6: [5, 1, 10], 7: [5, 8], 8: [7, 9], 9: [8, 4], 10: [6],
};
const rings = H.ringCyclesOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], graph);
eq(rings.length, 2, 'un système bicyclique (purine) donne DEUX cycles');
eq(rings.map((r) => r.length).sort(), [5, 6], 'le cycle à six et le cycle à cinq');
ok(!rings.some((r) => r.includes(10)), 'la chaîne pendante ne fait jamais partie d’un cycle');
ok(!rings.some((r) => r.length > H.RING_MAX_SIZE),
  'le PÉRIMÈTRE du système fusionné (neuf atomes) n’est jamais pris pour un anneau de base');
// Chaque cycle est rendu DANS L'ORDRE de l'anneau : c'est cet ordre qui fait le
// polygone de la plaque (deux atomes voisins du tableau sont liés).
rings.forEach((ring) => {
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    ok((graph[a] || []).includes(b), `le cycle est ordonné : ${a} → ${b} est bien une liaison`);
  }
});
eq(H.ringCyclesOf([1, 10], { 1: [10], 10: [1] }), [], 'une simple liaison n’est pas un anneau');
eq(H.ringCyclesOf([1], {}), [], 'un atome isolé non plus');
eq(H.ringCyclesOf([], {}), [], 'ni une liste vide (un fichier sans atome)');
// Les deux sens de parcours d'un même anneau fusionnent : UNE seule plaque.
const square = { 1: [2, 4], 2: [1, 3], 3: [2, 4], 4: [3, 1] };
eq(H.ringCyclesOf([1, 2, 3, 4], square).length, 1, 'un carré est trouvé une seule fois');
// Un cycle plus long que RING_MAX_SIZE n'est pas un anneau de base : il est ignoré
// (le périmètre d'une purine, 9 atomes, ne doit jamais devenir une plaque).
const big = {};
for (let i = 1; i <= 9; i += 1) big[i] = [((i % 9) + 1), (((i + 6) % 9) + 1)];
ok(!H.ringCyclesOf(Object.keys(big).map(Number), big).some((r) => r.length > H.RING_MAX_SIZE),
  `aucun anneau plus grand que ${H.RING_MAX_SIZE} atomes`);

/* ══ 2. LA PLAQUE : UN ÉVENTAIL DANS LE PLAN DU CYCLE ═════════════════════ */
const hexPts = [[2, 0, 0], [1, 1.7, 0], [-1, 1.7, 0], [-2, 0, 0], [-1, -1.7, 0], [1, -1.7, 0]]
  .map(([x, y, z]) => ({ x, y, z }));
const tri = H.ringPlateTriangles(hexPts);
eq(tri.position.length / 3, 7, 'un hexagone = six sommets + le centre de l’éventail');
eq(tri.index.length / 3, 6, '…et six triangles (un par sommet)');
eq(tri.normal.length / 3, 7, 'chaque sommet porte une normale');
// Toutes les faces partagent la normale du plan, et elle est unitaire : les plaques
// d'une même base sont éclairées exactement pareil (et le signe n'importe pas : NGL
// rend un MeshBuffer recto-verso, la face arrière retourne la normale).
const n0 = tri.normal.slice(0, 3);
near(Math.hypot(n0[0], n0[1], n0[2]), 1, 'la normale est unitaire');
for (let i = 0; i < tri.normal.length; i += 3) {
  near(tri.normal[i], n0[0], 'normale identique sur tous les sommets (x)');
  near(tri.normal[i + 1], n0[1], '…(y)');
  near(tri.normal[i + 2], n0[2], '…(z)');
}
eq(n0.map((v) => Math.round(v)), [0, 0, 1], 'un cycle tracé dans le plan (x, y) a la normale (0, 0, 1)');
eq(tri.position.slice(18, 21), [0, 0, 0], 'le centre de l’éventail (dernier sommet) est le centroïde du cycle');
for (let t = 0; t < tri.index.length; t += 3) {
  const c = tri.index[t];
  const a = tri.index[t + 1];
  const b = tri.index[t + 2];
  eq(c, 6, 'chaque triangle part du centre de l’éventail');
  eq((b - a + 6) % 6, 1, '…et relie deux sommets VOISINS du cycle');
}
eq(H.ringPlateTriangles([[0, 0, 0], [1, 0, 0]]), null, 'un cycle dégénéré (moins de trois atomes) ne produit aucune plaque');
eq(H.ringPlateTriangles([null, { x: NaN, y: 0, z: 0 }]), null, 'des coordonnées manquantes non plus (jamais de NaN)');

/* ══ 3. LES PLAQUES DU VRAI GABARIT NUCLÉOTIDIQUE ═════════════════════════ */
// Le gabarit que l'application embarque : une désoxyadénosine complète. Ses
// liaisons sont déduites par distance (< 1,8 Å entre atomes lourds, comme le fait
// NGL), et une structure bouchon expose exactement ce que le constructeur de plaques
// utilise (eachAtom · getAtomProxy · eachBondedAtom).
const template = readFileSync(new URL('./public/structures/template_nucleotide_dna.pdb', import.meta.url), 'utf8');
const atoms = template.split(/\r?\n/).filter((l) => l.startsWith('ATOM')).map((l, i) => ({
  index: i,
  atomname: l.slice(12, 16).trim(),
  resname: l.slice(17, 20).trim(),
  element: l.slice(76, 78).trim(),
  x: Number(l.slice(30, 38)),
  y: Number(l.slice(38, 46)),
  z: Number(l.slice(46, 54)),
}));
ok(atoms.length >= 20, 'le gabarit contient un nucléotide complet');
ok(atoms.every((a) => Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z)),
  '…avec des coordonnées lisibles');
const bondList = atoms.map(() => []);
atoms.forEach((a, i) => atoms.forEach((b, j) => {
  if (i >= j || a.element === 'H' || b.element === 'H') return;
  const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  if (d > 0.4 && d < 1.8) { bondList[i].push(j); bondList[j].push(i); }
}));
const proxy = (i) => ({
  index: i,
  atomname: atoms[i].atomname,
  element: atoms[i].element,
  resname: atoms[i].resname,
  residueIndex: 0,
  chainIndex: 0,
  x: atoms[i].x,
  y: atoms[i].y,
  z: atoms[i].z,
  eachBondedAtom: (cb) => { bondList[i].forEach((j) => cb(proxy(j))); },
});
const fakeStructure = {
  eachAtom: (cb) => { atoms.forEach((a, i) => cb(proxy(i))); },
  getAtomProxy: (i) => proxy(i),
};
const MENU = {
  bases: 'rings', ringColour: 'base', ringColorHex: 0x000000, sugarPlate: true,
  groupColour: false, ringTransparency: H.RING_TRANSPARENCY_DEFAULT,
  pentoseColor: H.DEFAULT_NUCLEIC_COLORS.pentose, baseColor: H.DEFAULT_NUCLEIC_COLORS.base,
};
const plates = H.nucleicRingPlates(fakeStructure, 'nucleic', MENU);
ok(!!plates, 'les plaques de la désoxyadénosine sont construites');
eq(plates.rings, 6 + 5 + 5, 'deux cycles de base (6 + 5) et le cycle du ribose (5) → 16 triangles');
eq(plates.position.length / 3, (6 + 1) + (5 + 1) + (5 + 1), 'un sommet par atome de cycle + le centre de chaque éventail');
eq(plates.normal.length, plates.position.length, 'chaque sommet a sa normale');
eq(plates.color.length, plates.position.length, 'chaque sommet a sa couleur');
eq(plates.index.length / 3, plates.rings, 'un triangle par atome de cycle');
// Le pourtour (les bâtons fins dessinés sur les plaques) ne contient QUE les atomes
// des cycles, et chacun UNE seule fois malgré la purine fusionnée (N9–C4 partagé).
const at = (name) => atoms.findIndex((a) => a.atomname === name);
const ringNames = ["O4'", "C1'", "C2'", "C3'", "C4'", 'N1', 'C2', 'N3', 'C4', 'C5', 'C6', 'N7', 'C8', 'N9'];
eq(plates.atomIndices, ringNames.map(at).sort((a, b) => a - b),
  'le pourtour = les atomes DES CYCLES, chacun une seule fois');
ok(!plates.atomIndices.includes(at("C5'")) && !plates.atomIndices.includes(at("O3'")),
  '…et jamais un atome hors cycle (le C5\' et l\'O3\' du ribose)');
// La couleur des plaques : l'identité de la base (DA → A) pour les deux cycles de la
// purine, et la MÊME couleur pour l'anneau du ribose de ce même nucléotide.
const rgbA = H.hexToRgb01(H.BASE_IDENTITY_COLORS.A);
const colours = new Set();
for (let v = 0; v < plates.position.length; v += 3) colours.add(rgbKey(plates.color.slice(v, v + 3)));
eq([...colours], [rgbKey(rgbA)], 'toutes les plaques d’une désoxyadénosine prennent la couleur de A');

/* ══ 4. LES OPTIONS DES PLAQUES (le panneau 🎨 du menu B) ═════════════════ */
// « Sugar ring plates » décoché : seuls les cycles des BASES sont remplis.
const sugarOff = H.nucleicRingPlates(fakeStructure, 'nucleic', { ...MENU, sugarPlate: false });
eq(sugarOff.rings, 6 + 5, 'sans la plaque du ribose : les deux cycles de la purine seulement');
eq(sugarOff.atomIndices, ['N1', 'C2', 'N3', 'C4', 'C5', 'C6', 'N7', 'C8', 'N9'].map(at).sort((a, b) => a - b),
  '…et le pourtour ne garde que les atomes des bases');
// « Colour by chemical group » allumé : chaque plaque prend la couleur de son GROUPE
// (le ribose → la couleur du pentose, les bases → la couleur des bases).
const grouped = H.nucleicRingPlates(fakeStructure, 'nucleic', { ...MENU, groupColour: true });
const groupColours = new Set();
for (let v = 0; v < grouped.position.length; v += 3) groupColours.add(rgbKey(grouped.color.slice(v, v + 3)));
eq([...groupColours].sort(), [rgbKey(H.hexToRgb01(H.DEFAULT_NUCLEIC_COLORS.base)), rgbKey(H.hexToRgb01(H.DEFAULT_NUCLEIC_COLORS.pentose))].sort(),
  'deux couleurs de groupe : celle des bases et celle du pentose');
// « One colour… » : TOUTES les plaques prennent la couleur unie (cartoon_ring_color).
const flat = H.nucleicRingPlates(fakeStructure, 'nucleic', { ...MENU, ringColour: 'custom', ringColorHex: 0xff0000 });
const flatColours = new Set();
for (let v = 0; v < flat.position.length; v += 3) flatColours.add(rgbKey(flat.color.slice(v, v + 3)));
eq([...flatColours], [rgbKey(H.hexToRgb01(0xff0000))], 'une seule couleur pour tous les anneaux');
// Les plaques N'EXISTENT QUE pour « Stylized rings » : les quatre autres styles de
// bases gardent les représentations NGL (rungs, bâtons, lignes, sphères).
eq(H.nucleicRingPlates(fakeStructure, 'nucleic', { ...MENU, bases: 'slab' }), null,
  '« Filled rings (slabs) » ne demande aucune plaque');
eq(H.nucleicRingPlates(fakeStructure, 'nucleic', { ...MENU, bases: 'sticks' }), null, 'ni « Licorice »');
// Et jamais sans structure ni sélection (le rendu appelle avant que NGL soit prêt).
eq(H.nucleicRingPlates(null, 'nucleic', MENU), null, 'sans structure, aucune plaque');
eq(H.nucleicRingPlates(fakeStructure, '', MENU), null, 'sans sélection non plus');
eq(H.nucleicRingPlates(fakeStructure, 'nucleic', null), null, 'sans menu (aucun réglage) non plus');
// Une sélection sans cycle (une chaîne protéique) ne fabrique rien : le menu des
// protéines passe par le même constructeur et n'ajoute donc jamais de plaque.
const chainOnly = {
  eachAtom: (cb) => {
    [0, 1, 2, 3].forEach((i) => cb({
      index: i, atomname: 'CA', element: 'C', resname: 'ALA', residueIndex: 0, chainIndex: 0,
      x: i * 1.5, y: 0, z: 0,
      eachBondedAtom: (b2) => { if (Math.abs(b2.index - i) === 1) b2; },
    }));
  },
  getAtomProxy: () => null,
};
eq(H.nucleicRingPlates(chainOnly, 'protein', MENU), null, 'une chaîne sans cycle ne produit aucune plaque');

/* ══ 5. LE VRAI NGL ACCEPTE LA PLAQUE (MeshBuffer) ════════════════════════ */
const mesh = new NGL.MeshBuffer({ position: plates.position, normal: plates.normal, color: plates.color, index: plates.index });
eq(mesh.geometry.attributes.position.count, plates.position.length / 3, 'NGL lit tous les sommets');
eq(mesh.geometry.attributes.normal.count, plates.normal.length / 3, '…et toutes les normales');
eq(mesh.geometry.attributes.color.count, plates.color.length / 3, '…et toutes les couleurs');
eq(mesh.geometry.index.count, plates.index.length, '…et tous les indices de triangle');
eq(mesh.parameters.opacity, 1, 'par défaut la plaque est SOLIDE (opacity 1)');
eq(mesh.transparent, false, '…donc pas de transparence');
// Ring transparency : 1 − t, poussé à NGL. Buffer#transparent = opacity < 1.
const half = new NGL.MeshBuffer({ position: plates.position, normal: plates.normal, color: plates.color, index: plates.index }, { opacity: 0.5 });
eq(half.parameters.opacity, 0.5, 'la transparence choisie part bien dans NGL');

/* ══ 6. LE DÉGRADÉ N → C / 5' → 3' ════════════════════════════════════════ */
// Le mélange des deux couleurs : borné, robuste, exact aux extrémités.
eq(H.lerpHexColors(0x000000, 0xffffff, 0), 0x000000, 't = 0 → la PREMIÈRE couleur (le N / 5\')');
eq(H.lerpHexColors(0x000000, 0xffffff, 1), 0xffffff, 't = 1 → la SECONDE (le C / 3\')');
eq(H.lerpHexColors(0x000000, 0xffffff, 0.5), 0x808080, 't = 0,5 → le mélange');
eq(H.lerpHexColors(0xff0000, 0x0000ff, 0.5), 0x800080, 'rouge → bleu : le milieu est violet');
eq(H.lerpHexColors(0x123456, 0xabcdef, -3), 0x123456, 't négatif borné (jamais une couleur folle)');
eq(H.lerpHexColors(0x123456, 0xabcdef, 99), 0xabcdef, 't > 1 borné');
eq(H.lerpHexColors(0x123456, 0xabcdef, NaN), 0x123456, 't non numérique → première couleur');
eq(H.lerpHexColors(undefined, undefined, 0.5), 0x000000, 'des couleurs absentes ne font pas planter le dégradé');
// La position d'un atome dans le dégradé : SA chaîne d'abord, puis le repli global.
H.gradientColorStore.ranges = { 0: [10, 20], 1: [5, 5], all: [10, 20] };
eq(H.gradientT({ chainIndex: 0, residueIndex: 10 }), 0, 'le premier résidu de la chaîne est au début du dégradé');
eq(H.gradientT({ chainIndex: 0, residueIndex: 20 }), 1, 'le dernier est à la fin');
eq(H.gradientT({ chainIndex: 0, residueIndex: 15 }), 0.5, '…et le milieu au milieu');
eq(H.gradientT({ chainIndex: 1, residueIndex: 5 }), 0, 'une chaîne d’un seul résidu ne dégrade pas (première couleur)');
eq(H.gradientT({ chainIndex: 9, residueIndex: 15 }), 0.5, 'une chaîne hors table retombe sur le repli global');
eq(H.gradientT({ chainIndex: 9, residueIndex: 99 }), 1, 'un résidu au-delà des bornes est borné');
H.gradientColorStore.ranges = null;
eq(H.gradientT({ chainIndex: 0, residueIndex: 15 }), 0, 'sans bornes mesurées : la première couleur, jamais du hasard');
// Le schéma enregistré, exécuté par le VRAI ColormakerRegistry de NGL 2.4.
const gKey = H.registerColorScheme(NGL, 'lab-test-gradient', H.defineGradientScheme());
ok(typeof gKey === 'string' && gKey.length > 0, 'le schéma du dégradé est enregistré');
ok(Object.keys(NGL.ColormakerRegistry.getSchemes()).includes(gKey),
  'son id est utilisable en `color` par une représentation');
const cm = NGL.ColormakerRegistry.getScheme({ scheme: gKey });
H.gradientColorStore.from = 0x000000;
H.gradientColorStore.to = 0xffffff;
H.gradientColorStore.ranges = { all: [0, 10] };
eq(cm.atomColor({ residueIndex: 0 }), 0x000000, 'le premier résidu prend la première couleur (N / 5\')');
eq(cm.atomColor({ residueIndex: 10 }), 0xffffff, 'le dernier prend la seconde (C / 3\')');
eq(cm.atomColor({ residueIndex: 5 }), 0x808080, 'les résidus du milieu sont interpolés');
eq(cm.atomColor({}), 0x000000, 'un atome sans indice de résidu ne fait pas planter le schéma');
// Une pastille déplacée est lue IMMÉDIATEMENT : le schéma lit le store vivant.
H.gradientColorStore.ranges = { all: [0, 1] };
H.gradientColorStore.from = 0x112233;
eq(cm.atomColor({ residueIndex: 0 }), 0x112233, 'changer une couleur ne ré-enregistre aucun schéma');
H.gradientColorStore.from = H.DEFAULT_GRADIENT_COLORS.from;
H.gradientColorStore.to = H.DEFAULT_GRADIENT_COLORS.to;
// Les bornes d'une structure : par CHAÎNE, plus le repli global.
const ranged = H.gradientRangesFor({
  eachAtom: (cb) => { [{ chainIndex: 0, residueIndex: 3 }, { chainIndex: 0, residueIndex: 7 }, { chainIndex: 1, residueIndex: 2 }].forEach(cb); },
}, 'protein');
eq(ranged, { 0: [3, 7], 1: [2, 2], all: [2, 7] }, 'une chaîne = ses propres bornes ; le repli couvre tout');
eq(H.gradientRangesFor(null, 'protein'), null, 'sans structure : aucune borne (et aucun plantage)');
eq(H.gradientRangesFor({}, 'protein'), null, 'une structure incomplète non plus');
eq(H.gradientRangesFor({ eachAtom: (cb) => { cb({}); } }, 'protein'), null, 'un atome sans indices ne produit pas de bornes fausses');


/* ══ 7. « ATOM COLOUR » : UN SEUL LECTEUR, QUATRE MÉTIERS ═════════════════ */
// Avec les schémas enregistrés : « Secondary structure » et « Gradient » passent
// leur id à NGL, pour le RUBAN comme pour les ATOMES / LIAISONS.
eq(HS.catColorParams({ atomColor: 'sstruc' }, 'backbone'), { color: 'lab-test-sstruc' },
  'le ruban (cartoon / ribbon / tube / trace) suit les couleurs de structure secondaire');
eq(HS.catColorParams({ atomColor: 'sstruc' }, 'atom'), { color: 'lab-test-sstruc' },
  '…et les atomes / liaisons aussi (mêmes couleurs, mêmes règles)');
eq(HS.catColorParams({ atomColor: 'gradient' }, 'backbone'), { color: 'lab-test-gradient' }, 'le ruban peut suivre le dégradé');
eq(HS.catColorParams({ atomColor: 'gradient' }, 'atom'), { color: 'lab-test-gradient' }, '…et les atomes aussi');
eq(HS.catColorParams({ atomColor: 'custom', atomColorHex: 0x112233 }, 'backbone'), { color: 0x112233 },
  '« Custom… » : une couleur unie, pour le ruban');
eq(HS.catColorParams({ atomColor: 'custom', atomColorHex: 0x112233 }, 'atom'), { color: 0x112233 }, '…et pour les atomes');
eq(HS.catColorParams({ atomColor: 'custom' }, 'backbone'), { color: 'residueindex' },
  'une couleur unie absente retombe sur l’arc-en-ciel (jamais une molécule invisible)');
eq(HS.catColorParams({ atomColor: 'custom', atomColorHex: NaN }, 'atom'), { colorScheme: 'element' },
  '…et sur les couleurs d’éléments pour les atomes');
eq(HS.catColorParams({}, 'backbone'), { color: 'residueindex' }, 'défaut : l’arc-en-ciel par résidu pour un ruban');
eq(HS.catColorParams({}, 'atom'), { colorScheme: 'element' }, 'défaut : les couleurs d’éléments pour les atomes');
eq(HS.catColorParams(null, 'atom'), { colorScheme: 'element' }, 'un menu absent ne fait pas planter le rendu');
// Schéma indisponible (l'enregistrement a échoué) : l'aspect classique, pas du vide.
eq(H.catColorParams({ atomColor: 'sstruc' }, 'backbone'), { color: 'residueindex' },
  'un schéma cassé ne fait pas disparaître la molécule (repli classique)');
// Les deux PALETTES du ⚙ (types d'atomes · types de sucres) : le menu les suit
// quand le schéma est là, et retombe sur les couleurs d'éléments sinon.
eq(HS.catColorParams({ atomColor: 'element' }, 'atom'), { color: 'lab-test-elements' },
  '« Atom-type palette (⚙) » passe l’id du schéma des éléments (celui que la roue édite)');
eq(HS.catColorParams({ atomColor: 'element' }, 'backbone'), { color: 'lab-test-elements' },
  '…et il vaut pour le ruban comme pour les atomes (un seul lecteur, mêmes règles)');
eq(HS.catColorParams({ atomColor: 'sugar' }, 'atom'), { color: 'lab-test-sugar' },
  '« Sugar type » passe l’id du schéma d’identité des sucres');
eq(H.catColorParams({ atomColor: 'element' }, 'atom'), { colorScheme: 'element' },
  'une palette non enregistrée retombe sur les couleurs d’éléments (jamais de molécule vide)');
eq(H.catColorParams({ atomColor: 'sugar' }, 'atom'), { colorScheme: 'element' },
  '…et il en va de même pour les sucres');
eq(H.catColorParams({ atomColor: 'gradient' }, 'atom'), { colorScheme: 'element' }, '…idem pour le dégradé');
// La priorité des couleurs de plaque : couleur unie > groupes > identité de la base.
eq(H.ringPlateColorOf({ ringColour: 'custom', ringColorHex: 0xabcdef, groupColour: true, baseColor: 0x111111 }, 'DA', 'base'), 0xabcdef,
  '« One colour… » gagne sur tout le reste (cartoon_ring_color)');
eq(H.ringPlateColorOf({ ringColour: 'base', groupColour: true, baseColor: 0x111111 }, 'DA', 'base'), 0x111111,
  '« Colour by chemical group » recolore les plaques des bases');
eq(H.ringPlateColorOf({ ringColour: 'base', groupColour: true, pentoseColor: 0x222222 }, 'DA', 'pentose'), 0x222222,
  '…et la plaque du ribose prend la couleur du pentose');
eq(H.ringPlateColorOf({ ringColour: 'base', groupColour: false }, 'DC', 'base'), H.BASE_IDENTITY_COLORS.C,
  'sans mode groupe : l’identité de la base (DC → C)');
eq(H.ringPlateColorOf({ ringColour: 'base', groupColour: false }, 'DC', 'pentose'), H.BASE_IDENTITY_COLORS.C,
  '…et le ribose suit la couleur de SON nucléotide');
eq(H.ringPlateColorOf({ ringColour: 'custom', ringColorHex: NaN, groupColour: false }, 'HOH', 'base'), H.baseIdentityColorOf('HOH'),
  'une couleur unie invalide retombe sur la règle suivante');

eq(half.transparent, true, '…et rend la plaque translucide (cartoon_ring_transparency)');

/* ══ 8. LE BRANCHEMENT DANS LE VIEWER ═════════════════════════════════════ */
has('registerGradientScheme(NGL);', 'le schéma du dégradé est enregistré avec la scène');
has("registerColorScheme(NGL, 'lab-gradient'", '…sous son propre libellé (définition d’abord, libellé ensuite)');
has("if (!m || m.bases !== 'rings') return null;", 'les plaques sont réservées à « Stylized rings »');
has('const plates = addRingPlates(sels.nucleic);', 'la branche « Stylized rings » construit de VRAIES plaques');
has("const rep = comp.addBufferRepresentation(mesh, { opacity: ringOpacity(), side: 'double' });",
  'le MeshBuffer est confié au COMPOSANT (il suit sa matrice : poses de docking, molécules extra)');
has('const mesh = new NG.MeshBuffer({ position: data.position, normal: data.normal, color: data.color, index: data.index });',
  'les plaques passent par le vrai MeshBuffer de NGL');
has("add('licorice', { sele: `@${ringIdx.join(',')}`", 'le pourtour est dessiné sur EXACTEMENT les atomes des cycles');
has("const atomCol = (cat) => catColorParams(cs[cat], 'atom');", 'les six menus lisent catColorParams');
has("const backboneCol = (cat) => catColorParams(cs[cat], 'backbone');", '…pour le ruban comme pour les atomes');
has("{ sub: 'sidechain', label: 'Side chains'", 'les chaînes latérales sont une ROW de la section (PART 4)');
has('sectionStyleReps(look.style, sec.kind, look)', 'les rows lisent leur style par le MÊME traducteur');
has("const setSstrucColour = (key, hex) => {", 'une SEULE écriture des couleurs de structure secondaire');
has("atomColor: 'sstruc' } }));", 'une pastille de structure secondaire allume le mode (plus jamais ignorée)');
has('ringTransparency: RING_TRANSPARENCY_DEFAULT,', 'les plaques sont SOLIDES par défaut (des plaques pleines)');
has('const setRingPlate = (patch) => {', 'un réglage de cycle allume « Stylized rings » (jamais invisible)');
has("const gradientLabel = cat === 'protein' ? 'Gradient (N → C terminus)'",
  'le dégradé nomme le N → C terminus d’une protéine…');
has('? "Gradient (5\' → 3\' end)"', '…et le 5\' → 3\' d’un acide nucléique');
has("const showGradient = cat === 'protein' || cat === 'nucleic';",
  'le dégradé n’est proposé que sur les deux menus de POLYMÈRES (une séquence à parcourir)');
has("const swap = () => { setCatStyle(cat, 'gradientFrom', to);", 'le bouton ⇄ inverse le dégradé');
has('gradientColorStore.ranges = gradientRangesFor(comp.structure, polySele);',
  'les bornes du dégradé sont mesurées sur la structure DESSINÉE');
has("else if (prop === 'cartoon_ring_mode')", 'le panneau PyMOL connaît set cartoon_ring_mode');
has("else if (prop === 'cartoon_nucleic_acid_mode')", '…set cartoon_nucleic_acid_mode');
has("else if (prop === 'cartoon_ring_color')", '…set cartoon_ring_color');
has("else if (prop === 'cartoon_ring_transparency')", '…set cartoon_ring_transparency');
has("bases === 'rings') {", 'en mode PyMOL les plaques sont aussi construites sur les sélections du script');
ok(!CODE.includes("addScheme('lab-"), 'aucun schéma enregistré avec les deux arguments inversés');
ok(!CODE.includes('computeVertexNormals'), 'les normales viennent du plan du cycle, pas d’un calcul par facette');
ok(CODE.includes("value={look.opacity}") && CODE.includes("onChange={(e) => set('opacity', Number(e.target.value))}"), 'la transparence d une row est un curseur (0 % = opaque), plaques comprises');
ok(CODE.includes('{ sub: \'ribose\', label: \'DNA/RNA ribose\''), 'la plaque du ribose est la row « DNA/RNA ribose » (Ring plates)');

/* ── Bilan ─────────────────────────────────────────────────────────────── */
console.log(`_viewer_rings_gradient_test.mjs — ${passed} assertions OK`);

eq(mesh.parameters.side, 'double', 'les plaques sont rendues recto-verso (une plaque se voit des deux côtés)');

