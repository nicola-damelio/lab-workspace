/* =========================================================================
   _viewer_structure_classes_test.mjs — les CLASSIFICATEURS « STRUCTURE » du
   viewer 3D, EXÉCUTÉS sur de la géométrie synthétique dont on connaît la réponse.

   Ce que ce fichier protège (PART 2.2bis · 2.1bis · PART 3 du viewer) :

     • les CONFORMATIONS des acides nucléiques — A · B · Z DNA, A · flexible ·
       Z RNA — sont lues sur les COORDONNÉES : χ (O4'-C1'-N9-C4 pour une purine,
       O4'-C1'-N1-C2 pour une pyrimidine) pour syn / anti, δ (C5'-C4'-C3'-O3')
       pour la pucker, et la distance perpendiculaire de la liaison C1'-N au
       phosphate (repli de MolProbity) quand δ manque. Les seuils sont ceux du
       cahier des charges : |χ| < 90° = syn, δ < 100° = C3'-endo (famille A),
       δ > 120° = C2'-endo (B-DNA · RNA flexible), > 2.9 Å = C3'-endo. Un Z n'est
       annoncé que si AU MOINS DEUX purines syn alternent avec des pyrimidines :
       une seule purine retournée n'est pas une forme d'hélice ;
     • les MOTIFS — G-quadruplex et hairpin — sont lus sur la topologie : les
       H-bonds de Hoogsteen N1···O6 et N2···N7 (2.7 – 3.3 Å) forment un CYCLE de
       quatre guanines coplanaires (un G-tétrade), deux tétrades empilés (plans
       parallèles, 3.3 – 3.4 Å) font un quadruplex ; une hampe de trois paires
       Watson-Crick / wobble (< 3.5 Å) refermée par une boucle de 3 à 10 résidus
       non appariés, reliée par le squelette covalent P → O3', fait un hairpin ;
     • les GLYCANES sont groupés par leur liaison glycosidique (C1 → O4 · O6,
       C2 pour un acide sialique) — lue sur le graphe de liaisons OU, à défaut,
       sur la DISTANCE (≤ 1.8 Å) — donc une chaîne liée est UNE molécule ;
     • les CLASSES de lipides (PC · PE · PG · PS · PI · PA · CL · SM · Chol · FA)
       sont lues sur les codes 3 lettres standard (POPC · DPPC · POPE · POP ·
       DPQ · EPH · PGL · CLR …).

   Le viewer est un .jsx : ses helpers PURS sont EXTRAITS du fichier puis
   exécutés ici — comme _viewer_scheme_test.mjs le fait pour les schémas NGL.
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
// Une grandeur calculée se compare avec une tolérance : les torsions des jeux
// d'essai sont exactes, 1e-6 de bruit flottant ne doit pas faire échouer.
const near = (a, b, what, tol = 1e-6) => {
  assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tol, `${what}\n  attendu : ${b}\n  obtenu  : ${a}`);
  passed += 1;
};

const VIEW = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);

/* ── Extraction : `const name = (…) => { … };` et `const name = … ;` ─────── */
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
// `const name = …;` — on équilibre (), {} et [] jusqu'au point-virgule de niveau
// 0 : une valeur multi-ligne ou une IIFE (`SUGAR_CODE_NAMES`) passe aussi.
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
const raw = (name) => sliceDecl(VIEW, name);

/* ── Les helpers du viewer, exécutés ici ─────────────────────────────────── */
const sandbox = [
  // La géométrie de PART 3 (les flèches-expression passent par sliceDecl).
  raw('vecSub'), raw('vecCross'), raw('vecDot'), raw('vecLen'), raw('coordDist'),
  sliceFn(VIEW, 'torsionDeg'),
  sliceFn(VIEW, 'linePointDist'), sliceFn(VIEW, 'nucPairDist'),
  sliceFn(VIEW, 'nucBaseCentreOf'), sliceFn(VIEW, 'planeOfPoints'), sliceFn(VIEW, 'planeDeviation'),
  raw('NUC_SYN_MAX_DEG'), raw('NUC_C3_ENDO_MAX_DEG'), raw('NUC_C2_ENDO_MIN_DEG'), raw('NUC_PUCKER_DIST'),
  raw('NUC_CHI_PURINE'), raw('NUC_CHI_PYRIMIDINE'), raw('NUC_DELTA_ATOMS'), raw('NUC_PURINE_BASES'),
  raw('NUC_FORM_LABELS'), sliceObject(VIEW, 'NUC_FORM_NAMES'),
  raw('nucAtomKey'), sliceFn(VIEW, 'nucBaseOf'),
  raw('GQUAD_N1_O6_MIN'), raw('GQUAD_N1_O6_MAX'), raw('GQUAD_N2_N7_MIN'), raw('GQUAD_N2_N7_MAX'),
  raw('GQUAD_PLANAR_TOL'), raw('GQUAD_STACK_MIN'), raw('GQUAD_STACK_MAX'), raw('GQUAD_PARALLEL_MIN'),
  raw('GQUAD_MAX_GUANINES'), raw('WB_PAIR_MAX'), raw('HAIRPIN_STEM_MIN'), raw('HAIRPIN_LOOP_MIN'),
  raw('HAIRPIN_LOOP_MAX'), raw('BACKBONE_BOND_MAX'), sliceObject(VIEW, 'BASE_PAIR_HBONDS'),
  // Les classificateurs.
  sliceFn(VIEW, 'nucleicResidues'), sliceFn(VIEW, 'nucleicChiOf'), sliceFn(VIEW, 'nucleicSynOf'),
  sliceFn(VIEW, 'nucleicDeltaOf'), sliceFn(VIEW, 'nucleicPuckerDistOf'), sliceFn(VIEW, 'nucleicPuckerOf'),
  sliceFn(VIEW, 'nextPhosphateOf'), sliceFn(VIEW, 'neighbourPyrimidineOf'), sliceFn(VIEW, 'nucleicForms'),
  sliceFn(VIEW, 'basePairKeyOf'), sliceFn(VIEW, 'basePairKindOf'), sliceFn(VIEW, 'hoogsteenPairOf'),
  sliceFn(VIEW, 'gTetradsOf'), sliceFn(VIEW, 'stackedTetradsOf'), sliceFn(VIEW, 'backboneLinked'),
  sliceFn(VIEW, 'hairpinResiduesInChain'), sliceFn(VIEW, 'nucleicMotifs'),
  // Les sucres et leurs glycanes (PART 2.2bis).
  sliceObject(VIEW, 'SUGAR_NAME_CODES'), sliceDecl(VIEW, 'SUGAR_CODE_NAMES'),
  raw('SUGAR_KETOSE_CODES'), raw('SUGAR_ACCEPTOR_RE'), raw('SUGAR_LINK_CUTOFF'),
  raw('SUGAR_RES_SEL'), raw('SUGAR_IDENTITY_CODES'),
  raw('sugarCodeOf'), sliceFn(VIEW, 'isSugarResidueCode'), raw('sugarShortNameOf'),
  raw('sugarAnomericNamesOf'), sliceFn(VIEW, 'sugarLinkEnds'), sliceFn(VIEW, 'sugarLinkBondOf'),
  sliceFn(VIEW, 'sugarLinksByDistance'), raw('glycanLabel'), sliceFn(VIEW, 'glycanEntities'),
  // Les classes de lipides (PART 2.1bis).
  sliceObject(VIEW, 'LIPID_CLASS_ALIASES'), raw('LIPID_CLASS_SUFFIXES'), sliceFn(VIEW, 'lipidClassOf'),  // PART 4 — les palettes et les schémas que la barre de style lit.
  sliceObject(VIEW, 'BASE_IDENTITY_COLORS'),
  sliceDecl(VIEW, 'BASE_TYPE_ORDER'),
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

  `return { coordDist, torsionDeg, linePointDist, nucPairDist, nucBaseCentreOf, planeOfPoints,
    planeDeviation, NUC_SYN_MAX_DEG, NUC_C3_ENDO_MAX_DEG,
    NUC_C2_ENDO_MIN_DEG, NUC_PUCKER_DIST, NUC_FORM_LABELS, NUC_FORM_NAMES,
    nucAtomKey, nucBaseOf, GQUAD_PLANAR_TOL, GQUAD_STACK_MIN, GQUAD_STACK_MAX, GQUAD_MAX_GUANINES,
    WB_PAIR_MAX, HAIRPIN_STEM_MIN, HAIRPIN_LOOP_MIN, HAIRPIN_LOOP_MAX, BACKBONE_BOND_MAX,
    BASE_PAIR_HBONDS, nucleicResidues, nucleicChiOf, nucleicSynOf, nucleicDeltaOf,
    nucleicPuckerDistOf, nucleicPuckerOf, nextPhosphateOf, neighbourPyrimidineOf, nucleicForms,
    basePairKeyOf, basePairKindOf, hoogsteenPairOf, gTetradsOf, stackedTetradsOf, backboneLinked,
    hairpinResiduesInChain, nucleicMotifs, SUGAR_NAME_CODES, SUGAR_CODE_NAMES, SUGAR_KETOSE_CODES,
    SUGAR_ACCEPTOR_RE, SUGAR_LINK_CUTOFF, SUGAR_RES_SEL, SUGAR_IDENTITY_CODES, sugarCodeOf,
    isSugarResidueCode, sugarShortNameOf, sugarAnomericNamesOf, sugarLinkEnds, sugarLinkBondOf,
    sugarLinksByDistance, glycanLabel, glycanEntities, LIPID_CLASS_ALIASES, LIPID_CLASS_SUFFIXES,
    lipidClassOf ,
      BASE_TYPE_ORDER, RESIDUE_COLOR_PALETTE, residueColorStore, residueColorOf, defineResidueScheme, baseTypeColorStore, baseTypeColorOf, defineBaseTypeScheme, CHARGE_COLORS, chargeColorStore, ionChargeOf, chargeColorOf, defineChargeScheme, SUGAR_TYPE_COLORS, sugarTypeColorStore, SUGAR_TYPE_OF_CODE, sugarTypeOf, sugarTypeColorOf };`,
].join('\n');
const H = new Function(sandbox)();

/* ── Les fabriques de géométrie des essais ───────────────────────────────────
   Chaque jeu d'essai est construit À L'ENVERS de la classification : on choisit
   la torsion que l'on veut lire, puis on place les atomes pour qu'elle vaille
   exactement cela. La validation commence donc par vérifier les FABRIQUES
   elles-mêmes (§1), sinon tous les essais qui suivent ne prouveraient rien. */
let nextIndex = 0;
const atom = (name, p, resname, residueIndex, chainIndex, resno) => ({
  index: (nextIndex += 1), name, element: name.charAt(0).toUpperCase(),
  resname, resno: resno == null ? residueIndex + 1 : resno, residueIndex, chainIndex,
  x: p[0], y: p[1], z: p[2],
});
// Quatre points dont la torsion p0-p1-p2-p3 vaut EXACTEMENT `t` degrés : p1 → p2
// porte l'axe +x, p3 est à l'azimut 0 du plan (y, z) et p0 à l'azimut −t — la
// construction inverse de la formule, où la torsion vaut θ3 − θ0.
const chiral4 = (origin, axisLen, radius, t) => {
  const rad = (t * Math.PI) / 180;
  const p1 = origin;
  const p2 = [origin[0] + axisLen, origin[1], origin[2]];
  const p3 = [p2[0], p2[1] + radius, p2[2]];
  const p0 = [p1[0], p1[1] + radius * Math.cos(-rad), p1[2] + radius * Math.sin(-rad)];
  return [p0, p1, p2, p3];
};
// O4'-C1'-N9-C4 (purine) ou O4'-C1'-N1-C2 (pyrimidine) à la torsion `t`.
const chiAtoms = (origin, t, purine = true) => {
  const [o4, c1, n, c] = chiral4(origin, 1.46, 1.4, t);
  return purine
    ? { "O4'": o4, "C1'": c1, N9: n, C4: c }
    : { "O4'": o4, "C1'": c1, N1: n, C2: c };
};
// C5'-C4'-C3'-O3' à la torsion `t` — c'est δ, la pucker du sucre.
const deltaAtoms = (origin, t) => {
  const [c5, c4, c3, o3] = chiral4(origin, 1.52, 1.45, t);
  return { "C5'": c5, "C4'": c4, "C3'": c3, "O3'": o3 };
};
// Un résidu = une liste d'atomes (nom → position) ; `resno` sert aux libellés de
// glycanes (GLC3 · NAG4 …).
const residueAtoms = (resname, residueIndex, chainIndex, atoms, resno) => Object.entries(atoms)
  .map(([name, p]) => atom(name, p, resname, residueIndex, chainIndex, resno));
// Le squelette covalent d'un résidu : P et O3' posés LOIN des bases (z = 30) mais
// à 1.5 Å l'un de l'autre d'un résidu au suivant — la liaison P(i+1) → O3'(i) que
// `backboneLinked` mesure. `pAt` remplace le phosphate quand un essai veut régler
// la distance C1'-N → P du repli de pucker.
const skeletonAtoms = (ri, pAt) => ({
  P: pAt || [100 + ri * 4, 0, 30],
  "O3'": [100 + ri * 4 + 2.5, 0, 30],
});
// Une CHAÎNE d'essai : un tableau de { resname, atoms, ri?, chainIndex?, resno?,
// pAt?, o3At? } → les enregistrements d'atomes. Le squelette covalent est posé
// D'ABORD, les atomes du jeu d'essai ensuite : un O3' donné par l'essai (celui de
// δ) est donc bien celui que la classification lira, et les jeux qui n'en donnent
// pas gardent celui du squelette. `bare` = un fichier sans P / O3'.
const chainRecords = (list, { bare = false } = {}) => {
  const out = [];
  list.forEach((r, i) => {
    const ri = r.ri == null ? i : r.ri;
    const ci = r.chainIndex == null ? 0 : r.chainIndex;
    if (!bare) {
      const sk = skeletonAtoms(ri, r.pAt);
      if (r.o3At) sk["O3'"] = r.o3At;
      out.push(...residueAtoms(r.resname, ri, ci, sk, r.resno));
    }
    out.push(...residueAtoms(r.resname, ri, ci, r.atoms, r.resno));
  });
  return out;
};


/* ══ 1. LA GÉOMÉTRIE, ET LE SENS DE LA TORSION ═════════════════════════════
   La convention IUPAC est ce qui donne un sens aux seuils : cis (p0 et p3
   éclipsés) = 0°, anti (trans) = ±180°. Une formule décalée de 180° lirait une
   pucker C3'-endo (δ ≈ 85°) comme −95° et une C2'-endo (δ ≈ 150°) comme −30°,
   donc elle classerait TOUT en A — d'où cet essai, passé avant tous les autres. */
near(H.torsionDeg([0, 1, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0]), 0, 'p0 et p3 éclipsés (cis) → 0°');
near(Math.abs(H.torsionDeg([0, 1, 0], [0, 0, 0], [1, 0, 0], [1, -1, 0])), 180,
  'p0 et p3 anti (trans) → ±180°');
[60, -60, 85, -150, 150].forEach((t) => {
  const [p0, p1, p2, p3] = chiral4([0, 0, 0], 1.46, 1.4, t);
  near(H.torsionDeg(p0, p1, p2, p3), t, `la fabrique des essais pose une torsion de ${t}°`);
});
eq(H.torsionDeg(null, [0, 0, 0], [1, 0, 0], [1, 1, 0]), null,
  'une torsion sans tous ses atomes → null (jamais une forme au hasard)');
near(H.coordDist([0, 0, 0], [3, 4, 0]), 5, 'coordDist = la distance euclidienne');
near(H.linePointDist([0, 4, 0], [0, 0, 0], [1, 0, 0]), 4,
  'linePointDist : la perpendiculaire à la liaison C1\'-N (repli de pucker)');
near(H.linePointDist([2, 0, 0], [0, 0, 0], [1, 0, 0]), 0, '…et 0 sur la ligne');

/* ══ 2. UN NUCLÉOTIDE, LU DEPUIS SES ATOMES ════════════════════════════════ */
const gua = H.nucleicResidues(chainRecords([
  { resname: 'DG', atoms: { ...chiAtoms([0, 0, 0], 180, true), ...deltaAtoms([40, 0, 0], 85) } },
]));
eq(gua.length, 1, 'un résidu → un nucléotide');
eq(gua[0].base, 'G', 'DG → la base G');
eq(gua[0].purine, true, 'une purine');
eq(gua[0].rna, false, 'ni O2\', ni nom en R → ADN');
ok(gua[0].names.has("C1'"), 'les noms sont normalisés AVEC leur prime');
// L'ancienne écriture `C1*` est la même chose que `C1'`, mais O2 (base) n'est PAS
// O2' (le 2'-OH) : perdre le prime confondrait C2 / C4 / C5 / O2 de la base avec
// C2' / C4' / C5' / O2' du sucre, et la classification avec.
const star = H.nucleicResidues(chainRecords([
  { resname: 'A', atoms: { 'C1*': [0, 0, 0], 'O4*': [1, 0, 0], 'O2*': [2, 0, 0], O2: [3, 0, 0] } },
]))[0];
ok(star.names.has("C1'"), 'C1* (ancienne écriture) → C1\'');
ok(star.names.has('O2'), 'O2 (un oxygène de base) reste O2');
eq(star.rna, true, 'O2* — le 2\'-OH — fait de ce résidu un ARN');
const twoChains = [
  ...chainRecords([{ resname: 'DA', chainIndex: 0, ri: 0, atoms: chiAtoms([0, 0, 0], 180, true) }]),
  ...chainRecords([{ resname: 'RA', chainIndex: 1, ri: 5, atoms: chiAtoms([50, 0, 0], 180, true) }]),
];
const both = H.nucleicResidues(twoChains);
eq(both.length, 2, 'deux résidus → deux nucléotides');
eq(both.map((n) => n.rna), [false, true], 'DA → ADN, RA (nom en R) → ARN');
eq(both.map((n) => n.chainIndex), [0, 1], 'chaque nucléotide garde sa chaîne');
eq(H.nucleicResidues([]).length, 0, 'aucun atome → aucun nucléotide');
eq(H.nucleicResidues(null).length, 0, '…et sans planter');

/* ══ 3. LES FORMES : A · B · Z DNA, A · flexible RNA ═══════════════════════
   Chaque résidu d'essai porte SA géométrie (χ et δ choisis) et les résidus sont
   éloignés les uns des autres : la classification de forme ne lit donc que les
   torsions, jamais une paire de bases. */
const oneNuc = (resname, chi, delta, opts = {}) => H.nucleicResidues(chainRecords([{
  resname,
  atoms: {
    ...(chi == null ? {} : chiAtoms([0, 0, 0], chi, /^[DR]?[AG]/.test(resname))),
    ...(delta == null ? {} : deltaAtoms([40, 0, 0], delta)),
    ...(opts.atoms || {}),
  },
  pAt: opts.pAt,
}], { bare: !!opts.bare }));
const formOf = (resname, chi, delta, opts) => H.nucleicForms(oneNuc(resname, chi, delta, opts))[0];
eq(formOf('DA', 180, 85), 'a-dna', 'δ = 85° (C3\'-endo) sur un ADN → A-DNA');
eq(formOf('DA', 180, 150), 'b-dna', 'δ = 150° (C2\'-endo) → B-DNA, la forme standard');
eq(formOf('RA', 180, 85), 'a-rna', 'δ = 85° sur un ARN → A-RNA, la forme canonique');
eq(formOf('RA', 180, 150), 'loop-rna',
  'δ = 150° sur un ARN → RNA flexible / boucle (un B-RNA n\'existe pas : le 2\'-OH l\'interdit)');
// δ dans la zone grise (100 – 120°) : c'est le REPLI par la distance C1'-N → P qui
// tranche, avec le seuil de 2.9 Å.
eq(formOf('DA', 180, 110, { pAt: [0, 4, 0] }), 'a-dna',
  'δ ambigu + phosphate à 4 Å de l\'axe C1\'-N (> 2.9 Å) → C3\'-endo → A-DNA');
eq(formOf('DA', 180, 110, { pAt: [0, 2, 0] }), 'b-dna',
  'δ ambigu + phosphate à 2 Å (< 2.9 Å) → C2\'-endo → B-DNA');
// δ absent (un fichier sans C5'/C4'/C3'/O3') : le repli travaille seul.
eq(formOf('DA', 180, null, { pAt: [0, 4, 0] }), 'a-dna', 'δ absent → le repli (4 Å > 2.9) dit C3\'-endo');
eq(formOf('DA', 180, null, { pAt: [0, 2, 0] }), 'b-dna', '…et 2 Å < 2.9 dit C2\'-endo');
// Rien de mesurable du tout : la forme canonique de la famille, jamais un blanc.
eq(formOf('DA', 180, null, { bare: true }), 'b-dna', 'aucun atome de pucker → la forme canonique de l\'ADN (B)');
eq(formOf('RA', 180, null, { bare: true }), 'a-rna', '…et celle de l\'ARN (A)');
eq(H.nucleicSynOf({ purine: false, atoms: {} }), null, 'χ d\'une pyrimidine → null (syn / anti ne la concerne pas)');
eq(H.nucleicForms([{ base: '' }]), [''], 'un résidu qui n\'est pas un nucléotide → aucune forme');

/* ── 3b. Z-DNA · Z-RNA : des purines SYN alternées ─────────────────────────
   Un Z alterne purines syn et pyrimidines anti — c'est le zig-zag de l'hélice
   gauche. Une purine retournée seule (une lésion, une boucle) ne fait pas une
   forme : il en faut AU MOINS DEUX, chacune voisine d'une pyrimidine. */
const zRes = (resname, x, chi, purine, rna = false) => ({
  resname,
  atoms: {
    ...chiAtoms([x, 0, 0], chi, purine),
    ...deltaAtoms([x + 40, 0, 0], 150),
    ...(rna ? { "O2'": [x + 80, 0, 0] } : {}),
  },
});
const zForms = (rna) => H.nucleicForms(H.nucleicResidues(chainRecords([
  zRes('G', 0, 0, true, rna),
  zRes('C', 100, 180, false, rna),
  zRes('G', 200, 0, true, rna),
  zRes('C', 300, 180, false, rna),
])));
eq(zForms(false), ['z-dna', 'z-dna', 'z-dna', 'z-dna'],
  'deux purines syn alternées de pyrimidines anti → tout le segment est Z-DNA');
eq(zForms(true), ['z-rna', 'z-rna', 'z-rna', 'z-rna'],
  '…et la même géométrie sur des riboses (O2\') → Z-RNA');
const loneZ = H.nucleicForms(H.nucleicResidues(chainRecords([
  zRes('G', 0, 0, true),
  zRes('C', 100, 180, false),
  zRes('A', 200, 180, true),
])));
eq(loneZ, ['b-dna', 'b-dna', 'b-dna'],
  'une SEULE purine syn → aucune forme Z (le critère est l\'alternance, pas un retournement)');
const ggZ = H.nucleicForms(H.nucleicResidues(chainRecords([
  zRes('G', 0, 0, true),
  zRes('G', 100, 0, true),
])));
eq(ggZ, ['b-dna', 'b-dna'], 'deux purines syn VOISINES sans pyrimidine → toujours pas de Z');
eq(H.nucleicForms(H.nucleicResidues(chainRecords([
  zRes('G', 0, 180, true), zRes('C', 100, 180, false), zRes('G', 200, 180, true),
]))), ['b-dna', 'b-dna', 'b-dna'], 'purines ANTI (χ ≈ 180°) → hélice droite, jamais Z');

/* ══ 4. LES MOTIFS : G-QUADRUPLEX ET HAIRPIN ═══════════════════════════════
   Un G-tétrade d'essai, à symétrie d'ordre 4 autour de l'axe z : N1 à 2.0 Å du
   centre (azimut local 0), O6 à 2.9 Å (−20°), N2 à 2.0 Å (+6°), N7 à 2.9 Å (−14°),
   plus cinq atomes de cycle pour que la base ait un centre. La copie k est tournée
   de 90°·k, donc l'écart entre N1(i) et O6(i+1) vaut 70° et
   d² = 2.0² + 2.9² − 2·2.0·2.9·cos 70° → N1(i)···O6(i+1) = 2.906 Å — et de même
   N2(i)···N7(i+1) : les quatre guanines forment le CYCLE de Hoogsteen d'un
   tétrade, dans un plan. */
const TETRAD_TEMPLATE = {
  N1: [2.0, 0],
  O6: [2.9 * Math.cos((-20 * Math.PI) / 180), 2.9 * Math.sin((-20 * Math.PI) / 180)],
  N2: [2.0 * Math.cos((6 * Math.PI) / 180), 2.0 * Math.sin((6 * Math.PI) / 180)],
  N7: [2.9 * Math.cos((-14 * Math.PI) / 180), 2.9 * Math.sin((-14 * Math.PI) / 180)],
  C2: [1.879, 0.684],
  N3: [2.165, 1.25],
  C4: [1.607, 1.915],
  C5: [1.1, 1.905],
  C6: [1.762, 1.478],
};
const tetradResidues = (z, chainBase, riBase) => [0, 1, 2, 3].map((k) => {
  const a = (k * Math.PI) / 2;
  const rot = ([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z];
  return {
    resname: 'G',
    chainIndex: chainBase + k,
    ri: riBase + k,
    atoms: Object.fromEntries(Object.entries(TETRAD_TEMPLATE).map(([n, p]) => [n, rot(p)])),
  };
});
// Les H-bonds du tétrade, mesurés directement : le jeu d'essai doit être celui-là
// et pas un autre, sinon les essais de motif ne prouveraient rien.
const t1 = H.nucleicResidues(chainRecords(tetradResidues(0, 0, 0), { bare: true }));
near(H.nucPairDist(t1[0], 'N1', t1[1], 'O6'), 2.905, 'N1(G0)···O6(G1) du tétrade d\'essai', 1e-3);
near(H.nucPairDist(t1[0], 'N2', t1[1], 'N7'), 2.906, 'N2(G0)···N7(G1) du tétrade d\'essai', 1e-3);
ok(H.hoogsteenPairOf(t1[0], t1[1]), 'deux guanines voisines du tétrade sont partenaires de Hoogsteen');
ok(!H.hoogsteenPairOf(t1[0], t1[2]), '…mais les guanines opposées ne le sont pas (pas de fausse arête)');
const gIndexOf = (list) => new Set(list.map((n, i) => i).filter((i) => list[i].base === 'G'));
eq(H.gTetradsOf(t1, gIndexOf(t1)).length, 1, 'quatre guanines coplanaires en anneau → UN G-tétrade');
ok(!H.hoogsteenPairOf(t1[0], { ...t1[1], atoms: { ...t1[1].atoms, O6: [t1[1].atoms.O6[0], t1[1].atoms.O6[1], 6] } }),
  'un O6 sorti à 6 Å du plan → plus d\'H-bond de Hoogsteen (donc plus de tétrade)');
// Coplanarité : le MÊME cycle de Hoogsteen, mais avec les cycles d'une guanine
// sortis du plan de 10 Å, ne fait plus un tétrade (les quatre bases doivent être
// dans un plan — les atomes déplacés ne sont pas ceux qui portent les H-bonds,
// donc le graphe de Hoogsteen reste intact et c'est bien la coplanarité qui
// tranche).
const lifted = H.nucleicResidues(chainRecords(tetradResidues(0, 0, 0), { bare: true })
  .map((a) => (a.chainIndex === 1 && ['C2', 'N3', 'C4', 'C5', 'C6'].indexOf(a.name) >= 0
    ? { ...a, z: a.z + 10 } : a)));
eq(H.gTetradsOf(lifted, gIndexOf(lifted)).length, 0,
  'les mêmes H-bonds de Hoogsteen mais une base sortie du plan → aucun tétrade');
const plane = H.planeOfPoints([[0, 0, 0], [2.9, 0, 0], [0, 2.9, 0], [2.9, 2.9, 0]]);
near(H.planeDeviation(plane, [[0, 0, 0], [2.9, 0, 0], [0, 2.9, 0], [2.9, 2.9, 0]]), 0,
  'quatre centres dans un même plan → écart 0');
ok(H.planeDeviation(plane, [[0, 0, 0], [2.9, 0, 0], [0, 2.9, 0], [2.9, 2.9, 3]]) > H.GQUAD_PLANAR_TOL,
  '…et un centre sorti du plan dépasse la tolérance de coplanarité (1.5 Å)');
eq(H.planeOfPoints([[0, 0, 0], [1, 0, 0], [2, 0, 0]]), null, 'trois points alignés → aucun plan');
// Deux tétrades EMPILÉS à 3.35 Å : c'est la distance d'empilement d'un quadruplex.
const g4 = H.nucleicResidues([
  ...chainRecords(tetradResidues(0, 0, 0), { bare: true }),
  ...chainRecords(tetradResidues(3.35, 4, 4), { bare: true }),
]);
eq(H.gTetradsOf(g4, gIndexOf(g4)).length, 2, 'deux plans de quatre guanines → deux tétrades');
eq(H.nucleicMotifs(g4).gquad.size, 8, 'deux tétrades empilés à 3.35 Å → les huit guanines forment un G-QUADRUPLEX');
eq(H.nucleicMotifs(g4).hairpin.size, 0, '…et aucune de ces guanines n\'est un hairpin');
eq(H.nucleicMotifs(H.nucleicResidues(chainRecords(tetradResidues(0, 0, 0), { bare: true }))).gquad.size, 0,
  'un tétrade SEUL (non empilé) n\'est pas un quadruplex');
const g4Far = H.nucleicResidues([
  ...chainRecords(tetradResidues(0, 0, 0), { bare: true }),
  ...chainRecords(tetradResidues(6.05, 4, 4), { bare: true }),
]);
eq(H.nucleicMotifs(g4Far).gquad.size, 0,
  'deux tétrades à 6 Å → pas d\'empilement (la distance est 3.3 – 3.4 Å), donc pas de quadruplex');
eq(H.nucleicMotifs([]).gquad.size, 0, 'aucun nucléotide → aucun motif');

/* ── 4b. LES PAPPARIEMENTS (Watson-Crick · wobble) ─────────────────────────
   Une paire face à face : la première base dans le plan z = 0, la seconde 2.9 Å
   au-dessus, atome à atome — chaque couple donneur / accepteur de la liste est
   donc à 2.9 Å, exactement comme dans une vraie paire. */
const faceAtoms = (list, z, o = [0, 0, 0]) => Object.fromEntries(
  list.map(([n, y]) => [n, [o[0], o[1] + y, o[2] + z]]),
);
const pairKind = (res1, l1, res2, l2) => {
  const n = H.nucleicResidues(chainRecords([
    { resname: res1, atoms: faceAtoms(l1, 0) },
    { resname: res2, atoms: faceAtoms(l2, 2.9) },
  ], { bare: true }));
  return H.basePairKindOf(n[0], n[1]);
};
const ADENINE = [['N1', 0], ['N6', 1]];
const THYMINE = [['N3', 0], ['O4', 1]];
const GUANINE = [['O6', 0], ['N1', 1], ['N2', 2]];
const CYTOSINE = [['N4', 0], ['N3', 1], ['O2', 2]];
const URACIL_WC = [['N3', 0], ['O4', 1]];
const URACIL_WOB = [['N3', 0], ['O2', 1], ['O4', 2]];
eq(H.basePairKeyOf('A', 'T'), 'AU', 'A–T et A–U sont la MÊME paire (le T devient U dans la clé)');
eq(H.basePairKeyOf('T', 'A'), 'AU', '…et l\'ordre des deux bases ne compte pas');
eq(pairKind('DA', ADENINE, 'DT', THYMINE), 'wc', 'A–T : paire Watson-Crick');
eq(pairKind('RA', ADENINE, 'RU', URACIL_WC), 'wc', 'A–U : paire Watson-Crick (reconnue sur l\'ARN comme sur l\'ADN)');
eq(pairKind('DG', GUANINE, 'DC', CYTOSINE), 'wc', 'G–C : paire Watson-Crick');
eq(pairKind('DG', GUANINE, 'RU', URACIL_WOB), 'wobble', 'G–U : la paire wobble, qui compte comme une hampe');
eq(pairKind('DA', ADENINE, 'DC', [['N3', 0], ['O2', 1]]), '', 'A–C : pas une paire canonique, même collée');
eq(pairKind('DA', ADENINE, 'DT', [['N3', 4], ['O4', 5]]), '',
  'A–T à 4.9 Å : au-delà du seuil d\'H-bond (3.5 Å), ce n\'est pas une paire');

/* ── 4c. La HAMPE et sa BOUCLE ───────────────────────────────────────────────
   `stemChain(n, m)` construit UNE chaîne de n résidus : les paires (0, n−1),
   (1, n−2) … formées par `m` paires A–T — donc une hampe de m paires NICHÉES —,
   les résidus du milieu étant une boucle SANS aucun H-bond (ils sont à 100 Å les
   uns des autres) et chaque résidu portant son squelette covalent P → O3'. */
const pairAt = (k, res1, l1, res2, l2) => [
  { resname: res1, atoms: faceAtoms(l1, 0, [30 * k, 0, 0]) },
  { resname: res2, atoms: faceAtoms(l2, 2.9, [30 * k, 0, 0]) },
];
const loopRes = (x) => ({
  resname: 'DG',
  atoms: { N1: [x, 0, 0], O6: [x + 2.9, 0, 0], N2: [x, 2.9, 0], N7: [x + 2.9, 2.9, 0] },
});
const stemSpec = (n, m) => {
  const spec = [];
  const pairs = [];
  for (let k = 0; k < m; k += 1) pairs.push(pairAt(k, 'DA', ADENINE, 'DT', THYMINE));
  for (let k = 0; k < m; k += 1) spec[k] = pairs[k][0];
  for (let i = m; i < n - m; i += 1) spec[i] = loopRes(500 + 100 * i);
  for (let k = 0; k < m; k += 1) spec[n - 1 - k] = pairs[k][1];
  return spec;
};
const stemChain = (n, m) => H.nucleicResidues(chainRecords(stemSpec(n, m)));
const hp9 = H.nucleicMotifs(stemChain(9, 3));
eq(hp9.hairpin.size, 9, 'hampe de 3 paires + boucle de 3 résidus → les 9 résidus forment UN hairpin');
eq(hp9.gquad.size, 0, '…et aucun G-quadruplex (les guanines de la boucle sont à 100 Å les unes des autres)');
eq(H.nucleicMotifs(stemChain(17, 3)).hairpin.size, 0,
  'une boucle de 11 résidus (> 10) → ce n\'est plus un hairpin');
eq(H.nucleicMotifs(stemChain(7, 2)).hairpin.size, 0,
  'une hampe de 2 paires seulement (< 3) → pas un hairpin');
// Le squelette : la boucle doit refermer la MÊME chaîne (un O3' détaché du P du
// résidu suivant = une coupure, donc plus rien ne relie les deux brins).
const hpChain = stemChain(9, 3);
ok(H.backboneLinked(hpChain, 0, 8), 'le squelette P → O3\' des neuf résidus d\'essai est continu');
ok(H.backboneLinked(hpChain, 2, 2), '…et une région vide est laissée passer (rien à juger)');
const nicked = stemSpec(9, 3).map((r, i) => (i === 2 ? { ...r, o3At: [900, 0, 30] } : r));
eq(H.nucleicMotifs(H.nucleicResidues(chainRecords(nicked))).hairpin.size, 0,
  'une coupure (O3\' détaché du P suivant) → pas un hairpin : la boucle doit fermer la même chaîne');
// Une paire cassée : il ne reste plus que deux paires appariées.
const broken = stemSpec(9, 3);
broken[8] = { resname: 'DA', atoms: faceAtoms(ADENINE, 2.9, [0, 0, 0]) };
eq(H.nucleicMotifs(H.nucleicResidues(chainRecords(broken))).hairpin.size, 0,
  'une paire cassée (A en face de A) ne laisse qu\'une hampe de 2 paires → plus de hairpin');
// Le partenaire d'une paire posé sur une AUTRE chaîne : la boucle ne referme plus
// une seule chaîne, donc plus de hairpin (c'est le rôle du P → O3').
const crossChainSpec = stemSpec(9, 3).map((r, i) => (i === 8 ? { ...r, chainIndex: 1 } : r));
eq(H.nucleicMotifs(H.nucleicResidues(chainRecords(crossChainSpec))).hairpin.size, 0,
  'le partenaire d\'une paire sur une autre chaîne → pas de hairpin (la hampe doit être UNE chaîne)');

/* ══ 5. LES GLYCANES : UNE MOLÉCULE, PAS N MONOMÈRES ═══════════════════════ */
// Le dictionnaire demandé : nom court ⇄ code 3 lettres du PDB.
eq(H.SUGAR_CODE_NAMES.GLC, 'Glc', 'GLC → Glc');
eq(H.SUGAR_CODE_NAMES.NAG, 'GlcNAc', 'NAG → GlcNAc');
eq(H.SUGAR_CODE_NAMES.MAN, 'Man', 'MAN → Man');
eq(H.SUGAR_CODE_NAMES.BMA, 'Man', 'BMA (l\'anomère β) → Man');
eq(H.SUGAR_CODE_NAMES.GAL, 'Gal', 'GAL → Gal');
eq(H.SUGAR_CODE_NAMES.FUC, 'Fuc', 'FUC → Fuc');
eq(H.SUGAR_CODE_NAMES.SIA, 'Neu5Ac', 'SIA → Neu5Ac');
eq(H.SUGAR_CODE_NAMES.NAN, 'Neu5Ac', 'NAN (l\'autre écriture du même sucre) → Neu5Ac');
ok(H.SUGAR_NAME_CODES.Glc.indexOf('GLC') >= 0, 'le dictionnaire se lit aussi dans l\'autre sens');
eq(H.sugarShortNameOf('glc'), 'Glc', 'la casse n\'a pas d\'importance');
eq(H.isSugarResidueCode('HOH'), false, 'une eau n\'est pas un sucre');
eq(H.isSugarResidueCode('GLC'), true, 'GLC en est un');
ok(H.SUGAR_RES_SEL.indexOf('[NAN]') > 0, 'NAN (Neu5Ac) entre dans la sélection des sucres du menu');
// L'anomère : C1 pour un aldose, C2 pour un cétose (un acide sialique).
eq(H.sugarAnomericNamesOf('GLC'), ['C1'], 'l\'anomère d\'un aldose est C1');
eq(H.sugarAnomericNamesOf('SIA'), ['C2', 'C1'], '…et celui d\'un acide sialique (un cétose) C2');
// Les deux atomes d'une liaison glycosidique : C1 → O4 / O6 — jamais le O5 du
// cycle, et jamais le C2 d'un N-acétyl (qui porte l'azote, pas la liaison).
const edge = (name, element, resname, key) => ({ key, name, element, resname });
ok(H.sugarLinkBondOf(edge('C1', 'C', 'GLC', 'a'), edge('O4', 'O', 'NAG', 'b')),
  'C1(GLC) — O4(NAG) : la liaison glycosidique');
ok(H.sugarLinkBondOf(edge('C1', 'C', 'GLC', 'a'), edge('O6', 'O', 'MAN', 'b')),
  'C1 — O6 : l\'autre liaison courante');
ok(!H.sugarLinkBondOf(edge('C1', 'C', 'GLC', 'a'), edge('O5', 'O', 'NAG', 'b')),
  'O5 est l\'oxygène du CYCLE : ce n\'est pas une liaison glycosidique');
ok(!H.sugarLinkBondOf(edge('C2', 'C', 'NAG', 'a'), edge('O4', 'O', 'GLC', 'b')),
  'C2 d\'un N-acétyl-glucosamine n\'est pas l\'anomère');
ok(H.sugarLinkBondOf(edge('C2', 'C', 'SIA', 'a'), edge('O4', 'O', 'GAL', 'b')),
  '…mais C2 d\'un acide sialique l\'est');
ok(!H.sugarLinkBondOf(edge('C1', 'C', 'GLC', 'a'), edge('O4', 'O', 'GLC', 'a')),
  'deux atomes du MÊME résidu ne sont pas une liaison inter-monomère');
// La règle de DISTANCE (le fichier n'a ni LINK ni CONECT) : 1.42 Å = la liaison
// covalente C–O, 3 Å = un simple contact (une molécule d'eau, par exemple).
const monomer = (resname, ri, atoms) => ({ key: `m${ri}`, resname, resno: ri + 1, residueIndex: ri, atoms });
const pAtom = (name, element, x) => ({ index: 0, name, element, x, y: 0, z: 0 });
const glc = monomer('GLC', 0, [pAtom('C1', 'C', 0), pAtom('O4', 'O', 2)]);
const nagNear = monomer('NAG', 1, [pAtom('O4', 'O', 1.42), pAtom('C1', 'C', 10)]);
const nagFar = monomer('NAG', 1, [pAtom('O4', 'O', 3), pAtom('C1', 'C', 10)]);
eq(H.sugarLinksByDistance([glc, nagNear]), [[0, 1]], 'C1 à 1.42 Å de O4 → les deux sucres sont LIÉS');
eq(H.sugarLinksByDistance([glc, nagFar]), [], '…à 3 Å (un contact, pas une liaison covalente) → aucun lien');
// Le GROUPEMENT : trois monomères liés en chaîne = UNE entité, plus un isolé.
const monos = [
  glc,
  nagNear,
  monomer('MAN', 2, [pAtom('O4', 'O', 8.58), pAtom('C1', 'C', 20)]),
  monomer('FUC', 3, [pAtom('C1', 'C', 50), pAtom('O4', 'O', 51.42)]),
];
const ents = H.glycanEntities(monos, H.sugarLinksByDistance(monos));
eq(ents.length, 2, 'trois sucres liés + un isolé → DEUX entités (la chaîne, et le monosaccharide)');
eq(ents[0].members, [0, 1, 2], 'la première entité groupe les trois monomères liés');
eq(ents[0].linked, true, '…et elle est marquée « liée »');
eq(ents[0].label, 'Glc1 → GlcNAc2 → Man3', 'le libellé nomme les sucres liés, en séquence');
eq(ents[1].linked, false, 'un sucre isolé est sa propre entité, non liée');
eq(ents[1].label, 'Fuc4', '…et il garde son nom');
eq(H.glycanLabel([]), '', 'aucun monomère → aucun libellé');

/* ══ 6. LES CLASSES DE LIPIDES, LUES SUR LE CODE 3 LETTRES ═════════════════ */
[['POPC', 'PC'], ['DPPC', 'PC'], ['DOPC', 'PC'], ['SOPC', 'PC'], ['PLPC', 'PC'],
  ['POPE', 'PE'], ['DOPE', 'PE'], ['DPPE', 'PE'],
  ['POPG', 'PG'], ['DPPG', 'PG'],
  ['DLPS', 'PS'], ['DPPS', 'PS'],
  ['DMPI', 'PI'], ['POPI', 'PI'],
  ['DPPA', 'PA'], ['DOPA', 'PA'],
  ['TOCL', 'CL'], ['CDL', 'CL'],
  ['PSM', 'SM'], ['SM', 'SM'],
  ['CHOL', 'Chol'], ['CLR', 'Chol'], ['ERG', 'Erg'],
  ['TAG', 'TAG'], ['TGL', 'TAG'], ['DAG', 'DAG'], ['DGA', 'DAG'], ['MAG', 'MAG'], ['MGL', 'MAG'], ['CER', 'Cer'],
  ['MYR', 'FA'], ['PAL', 'FA'],
  ['POP', 'PC'], ['DPQ', 'PC'], ['EPH', 'PE'], ['PGL', 'PG'],
  ['PC', 'PC'], ['PE', 'PE'], ['CL', 'CL'],
  ['HOH', 'OTHER'], ['', 'OTHER'], [null, 'OTHER'],
  ['GLY', 'OTHER'], ['ALA', 'OTHER'], ['SER', 'OTHER'], ['HEM', 'OTHER'], ['ATP', 'OTHER'],
].forEach(([code, cls]) => {
  eq(H.lipidClassOf(code), cls, `${code || '(vide)'} → ${cls}`);
});

/* ══ 7. LE CÂBLAGE DANS LE VIEWER ══════════════════════════════════════════
   Les quatre lectures sont des SCHÉMAS NGL maison enregistrés au démarrage, elles
   sont offertes dans les deux listes « Color by » (la barre Molecules ET le menu
   de la catégorie), et leurs couleurs vivent dans la roue ⚙ / un ⚙️ setup. */
has("registerColorScheme(NGL, 'lab-glycans'", 'un schéma NGL maison pour les glycanes liés');
has("registerColorScheme(NGL, 'lab-lipid-class'", '…un pour les classes de lipides');
has("registerColorScheme(NGL, 'lab-nuc-form'", '…un pour les conformations A · B · Z · ARN');
has("registerColorScheme(NGL, 'lab-nuc-motif'", '…un pour les motifs G-quadruplex · hairpin');
['registerGlycanScheme(NGL);', 'registerLipidClassScheme(NGL);', 'registerNucleicFormScheme(NGL);', 'registerNucleicMotifScheme(NGL);']
  .forEach((call) => has(call, `…et ${call} est bien appelé au démarrage`));
// Les catégories demandées, dans la liste « Color by » de la barre Molecules.
has("basetype: 'DNA/RNA base',", 'la liste « Color by » nomme « DNA/RNA base »');
has("residue: 'Amino acid (residue)',", '…et « Amino acid (residue) »');
has("sstruc: 'Secondary structure',", '…« Secondary structure »');
has("nucform: 'DNA conformation',", '…« DNA conformation »');
has("lipidtype: 'Lipid type',", '…« Lipid type »');
// …et dans le sélecteur « Atom colour » de la BONNE catégorie de §2.
has("charge: 'Charge',", '…« Charge » (les ions seulement)');
has("gradient: 'Gradient (first → last)',", '…« Gradient » (premier → dernier résidu)');
has("water: ['solid', 'element', 'hydrophobicity', 'esp'],", 'l eau n offre PAS « Lipid type » (correction du cahier des charges)');
has("ion: ['solid', 'element', 'charge'],", 'un ion : solid · atom type · charge');
// La correspondance « Color by » → schéma NGL des quatre nouveaux modes, avec le
// repli qui garantit qu'une molécule ne reste JAMAIS sans couleur.
has("case 'basetype': return schemeParam(baseTypeSchemeKey, 'resname');", 'base types → lab-base-type (repli : resname)');
has("case 'lipidtype': return schemeParam(lipidClassSchemeKey || elementSchemeKey, 'element');", 'classes de lipides → lab-lipid-class (repli : éléments)');
has("case 'nucform': return schemeParam(nucleicFormSchemeKey || sstrucSchemeKey, 'sstruc');",
  'conformations → lab-nuc-form, repli sur la 2° structure');
has("case 'charge': return schemeParam(chargeSchemeKey || elementSchemeKey, 'element');",
  'motifs → lab-nuc-motif, repli sur la 2° structure');
// La roue ⚙ : les deux palettes des acides nucléiques, persistées et dans les setups.
has("const NUCLEIC_FORM_COLORS_KEY = 'labViewerNucleicFormColors';", 'les couleurs de forme sont persistées');
has("const NUCLEIC_MOTIF_COLORS_KEY = 'labViewerNucleicMotifColors';", 'les couleurs de motif aussi');
has('Object.assign(nucleicFormColorStore, nucleicFormColors);', 'le store vivant du schéma de forme est alimenté');
has('Object.assign(nucleicMotifColorStore, nucleicMotifColors);', '…et celui des motifs');
has('nucleicForms: nucleicFormColors,', 'un ⚙️ setup emporte les couleurs de forme');
has('if (pal.nucleicForms) setNucleicFormColors((p) => mergePalette(DEFAULT_NUCLEIC_FORM_COLORS, { ...p, ...pal.nucleicForms }));',
  '…et les relit en validant chaque clé (mergePalette)');
has('if (pal.nucleicMotifs) setNucleicMotifColors((p) => mergePalette(DEFAULT_NUCLEIC_MOTIF_COLORS, { ...p, ...pal.nucleicMotifs }));',
  '…idem pour les motifs');
has('Nucleotide conformations &amp; motifs', 'la roue ⚙ a une section pour ces deux palettes');
has('Amino acids · the 20 residues', 'la roue ⚙ édite la palette des 20 acides aminés');
has('DNA/RNA bases · charge', '…et celle des bases ADN/ARN (la charge à ses côtés)');
// La 2° structure a désormais une section À ELLE : le rapport ne trouvait pas ses
// trois couleurs, enterrées sous un en-tête qui commençait par « DNA/RNA bases ».
has('Secondary structure · helix / sheet / loop', '…et une SECTION À ELLE pour la 2° structure (hélice · feuillet · boucle)');
// Les deux palettes sont OFFERTES dans les réglages de couleur d'une molécule (le
// « Atom colour » de son menu) et lues par le MÊME lecteur (catColorParams).
has("if (mode === 'residue' && residueSchemeKey) return { color: residueSchemeKey };", 'un menu de protéine colore par acide aminé (lab-residue)');
has("if (mode === 'basetype' && baseTypeSchemeKey) return { color: baseTypeSchemeKey };", 'un menu d\'acide nucléique colore par base (lab-base-type)');
has('<option value="residue">Amino acid (⚙ palette)</option>', '« Amino acid » est offert dans « Atom colour »');
has('<option value="basetype">DNA/RNA base (⚙ palette)</option>', '…« DNA/RNA base » aussi');
has("const paletteOpen = mode === 'element' || mode === 'residue' || mode === 'basetype'", '…et les deux modes ouvrent le ⚙ de la palette');
has('{SUGAR_TYPE_ORDER.map((t) => (', '…les 29 types de sucres');
has('{LIPID_TYPE_ORDER.map((k) => (', '…les 14 types de lipides');
has('{NUC_FORM_LABELS.map((form) => (', '…avec une pastille par forme');
has("{['gquad', 'hairpin'].map((motif) => (", '…et une par motif');
// Les menus disent ce qu'ils ont trouvé : les glycans liés et les formes / motifs.
has('glycans: glycanSummaryFor(component.structure),', 'le résumé des glycanes est calculé au chargement');
has('nucleicClasses: nucleicClassCounts(component.structure),', 'les comptes de formes / motifs aussi');
has("bases: ['hide', 'base', 'rings', 'ball+stick', 'licorice', 'line', 'spacefill'],", 'le row bases offre slabs · stylized rings · balls and sticks · liquorice · lines · CPK');
has("trace: 'Phosphate trace (P)',", 'la trace phosphate est nommée comme dans la demande');
// Les codes du menu des sucres (le dictionnaire demandé) et les seuils du cahier
// des charges, écrits tels quels dans le viewer.
has("const SUGAR_RES_SEL = '[GLC] or [NAG] or [MAN] or [BMA] or [SIA] or [NAN] or [GAL] or [FUC]';",
  'la liste des sucres du menu contient les codes demandés (dont NAN)');
has('const NUC_SYN_MAX_DEG = 90;', '|χ| < 90° = syn');
has('const NUC_C3_ENDO_MAX_DEG = 100;', 'δ < 100° = C3\'-endo (famille A)');
has('const NUC_C2_ENDO_MIN_DEG = 120;', 'δ > 120° = C2\'-endo (B-DNA · RNA flexible)');
has('const NUC_PUCKER_DIST = 2.9;', 'le repli de pucker : 2.9 Å');
has('const GQUAD_N1_O6_MIN = 2.7;', 'l\'H-bond de Hoogsteen N1···O6 : 2.7 – 3.3 Å');
has('const GQUAD_N2_N7_MIN = 2.7;', '…et N2···N7');
has('const GQUAD_STACK_MIN = 3.0;', 'l\'empilement des tétrades : 3.3 – 3.4 Å (fenêtre 3.0 – 3.7)');
has('const WB_PAIR_MAX = 3.5;', 'une paire Watson-Crick / wobble : H-bond < 3.5 Å');
has('const HAIRPIN_LOOP_MIN = 3;', 'une boucle d\'épingle : 3 à 10 résidus');
has('const HAIRPIN_LOOP_MAX = 10;', '…bornée à 10');
has('const HAIRPIN_STEM_MIN = 3;', 'une hampe : au moins 3 paires');
has('const SUGAR_LINK_CUTOFF = 1.8;', 'la liaison glycosidique par distance : ≤ 1.8 Å');

/* ── Bilan ══════════════════════════════════════════════════════════════════ */
console.log(`_viewer_structure_classes_test.mjs — ${passed} assertions OK`);

