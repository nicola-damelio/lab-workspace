/* =========================================================================
   _structure_fit_test.mjs
   LE 🎯 « FIT ALL SELECTED MOLECULES TO A CHOSEN ONE » — src/utils/structureFit.js
   EXÉCUTÉ, pas relu : l'appariement des atomes, la matrice rigide, et la pose
   (position + quaternion) que NGL doit recevoir pour reproduire cette matrice.

   La demande, mot pour mot : « in the styling window the “all”, “main”, “copy”
   buttons at the top are obsolete, you can replace them for a button to select all
   molecules or none and a button to fit all selected molecules to a chosen one. »

   §1 L'APPARIEMENT — deux copies de la même molécule se reconnaissent par leurs
      NOMS d'atomes, dans l'ordre (une multiplicité n'écrase pas l'autre) ; une
      sélection partielle n'apparie que ce qu'elle contient ; deux molécules
      différentes ne trouvent pas de quoi tourner.
   §2 LA MATRICE RIGIDE — `rigidMatrix` range le R (row-major) et le t de Kabsch
      dans le layout colonne-major de three.js/NGL, et `multiplyMat4` compose dans
      l'ordre des colonnes : l'exécution compare point à point.
   §3 LA POSE — `poseFromRigidMatrix` rend un couple (position, quaternion) qui,
      recomposé à la manière de `Component#updateMatrix()` (T(pos+c)·R(q)·T(−c)),
      redonne EXACTEMENT la matrice voulue, pour plusieurs points et rotations.
   §4 BOUT EN BOUT — deux copies d'un même ligand, l'une tournée et translatée :
      Kabsch (utils/mdAnalysis.js) + l'appariement retrouvent la transformation, et
      la pose recomposée superpose tous les atomes à moins d'un centième d'Å.
   §5 LE MESSAGE — `fitSummary` dit ce qui a été fait, et nomme ce qui ne l'a pas été.
   ========================================================================= */
import assert from 'node:assert/strict';
import { rigidTransform, centroidOf, transpose3, translationFor, residualRmsd, fitSummary,
  fitAtomKey, atomMatchPairs, flatCoords, rigidMatrix, multiplyMat4, applyMat4,
  poseFromRigidMatrix,
} from './src/utils/structureFit.js';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, what);
  passed += 1;
};
const near = (a, b, tol, what) => ok(Math.abs(a - b) <= tol, `${what} (${a} ≉ ${b}, tol ${tol})`);
const nearArr = (a, b, tol, what) => {
  eq(a.length, b.length, `${what} — même longueur`);
  a.forEach((v, i) => near(v, b[i], tol, `${what} [${i}]`));
};

/* ── Petite algèbre du test : elle n'emprunte RIEN au module ─────────────── */
const rotZ = (a) => {
  const c = Math.cos(a); const s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};
const rotX = (a) => {
  const c = Math.cos(a); const s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
};
const mulR = (a, b) => {
  const out = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let v = 0;
      for (let k = 0; k < 3; k++) v += a[i * 3 + k] * b[k * 3 + j];
      out[i * 3 + j] = v;
    }
  }
  return out;
};
const applyR = (R, p) => [
  R[0] * p[0] + R[1] * p[1] + R[2] * p[2],
  R[3] * p[0] + R[4] * p[1] + R[5] * p[2],
  R[6] * p[0] + R[7] * p[1] + R[8] * p[2],
];
const flat = (pts) => Float32Array.from(pts.flat());
/* Quaternion → matrice 3×3 colonne-major (la convention de three.js). */
const quatToMat3 = ([x, y, z, w]) => [
  1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
  2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
  2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
];
/* Application d'une matrice 3×3 dans le layout COLONNE-major (celui de three.js :
   l'index est `colonne * 3 + ligne`). `applyR` ci-dessus lit, lui, du row-major —
   les deux conventions cohabitent dans ce test comme dans NGL. */
const applyCol3 = (m, p) => [
  m[0] * p[0] + m[3] * p[1] + m[6] * p[2],
  m[1] * p[0] + m[4] * p[1] + m[7] * p[2],
  m[2] * p[0] + m[5] * p[1] + m[8] * p[2],
];
/* Ce que Component#updateMatrix() compose : T(pos + c) · R(q) · T(−c). */
const nglPosePoint = (position, quaternion, center, p) => {
  const local = [p[0] - center[0], p[1] - center[1], p[2] - center[2]];
  const rotated = applyCol3(quatToMat3(quaternion), local);
  return [
    rotated[0] + position[0] + center[0],
    rotated[1] + position[1] + center[1],
    rotated[2] + position[2] + center[2],
  ];
};


/* ══ §1. L'APPARIEMENT DES ATOMES ═══════════════════════════════════════════ */
eq(fitAtomKey({ name: ' ca ', resname: 'ala' }), 'CA|ALA', 'la clé ignore la casse et les espaces');
const refAtoms = [
  { name: 'C1', resname: 'POPC', x: 0, y: 0, z: 0 },
  { name: 'O1', resname: 'POPC', x: 1, y: 0, z: 0 },
  { name: 'O2', resname: 'POPC', x: 2, y: 0, z: 0 },
  { name: 'N1', resname: 'POPC', x: 3, y: 0, z: 0 },
];
const movAtoms = [
  { name: 'O1', resname: 'POPC', x: 9, y: 9, z: 9 },   // délibérément dans un autre ordre
  { name: 'C1', resname: 'POPC', x: 8, y: 8, z: 8 },
  { name: 'O2', resname: 'POPC', x: 7, y: 7, z: 7 },
  { name: 'N1', resname: 'POPC', x: 6, y: 6, z: 6 },
];
const pairs = atomMatchPairs(refAtoms, movAtoms);
eq(pairs.size, 4, 'les quatre noms se retrouvent');
eq(pairs.movIdx, [0, 1, 2, 3], 'la molécule déplacée est lue dans son ordre');
eq(pairs.refIdx, [1, 0, 2, 3], '…et le CHOISI fournit l’atome correspondant, où qu’il soit chez lui');

/* Une multiplicité n'écrase pas l'autre : le 2e O2 se marie au 2e O2. */
const twice = [
  { name: 'O2', resname: 'POPC', x: 0, y: 0, z: 0 },
  { name: 'O2', resname: 'POPC', x: 1, y: 0, z: 0 },
];
eq(atomMatchPairs(twice, [{ name: 'O2', resname: 'POPC' }, { name: 'O2', resname: 'POPC' }]).movIdx, [0, 1],
  'les occurrences se marient dans l’ordre');
eq(atomMatchPairs(twice, [{ name: 'O2', resname: 'POPC' }, { name: 'O2', resname: 'POPC' }, { name: 'O2', resname: 'POPC' }]).size, 2,
  'une copie de trop est laissée de côté, jamais mariée deux fois');
/* Deux molécules différentes : rien à faire. */
eq(atomMatchPairs(refAtoms, [{ name: 'FE', resname: 'HEM' }, { name: 'NA', resname: 'ION' }]).size, 0,
  'deux molécules différentes ne trouvent aucun atome commun');
/* Une sélection partielle : elle s'apparie sur ce qu'elle a. */
eq(atomMatchPairs(refAtoms, [refAtoms[1], refAtoms[3]]).size, 2,
  'une sélection partielle n’apparie que ses atomes');

eq(Array.from(flatCoords(refAtoms, [1, 3])), [1, 0, 0, 3, 0, 0],
  'flatCoords range les coordonnées dans l’ordre demandé');

/* ══ §2. LA MATRICE RIGIDE ══════════════════════════════════════════════════ */
const Rz = rotZ(Math.PI / 2);
const mRigid = rigidMatrix(Rz, [3, -1, 2]);
nearArr(applyMat4(mRigid, [1, 0, 0]), [3, 0, 2], 1e-9, 'la matrice tourne (x → y) et translate');
nearArr(applyMat4(mRigid, [0, 1, 0]), [2, -1, 2], 1e-9, '…et (y → −x)');
nearArr(applyMat4(multiplyMat4(mRigid, rigidMatrix(rotZ(Math.PI / 2), [0, 0, 0])), [1, 0, 0]), [2, -1, 2], 1e-9,
  'multiplyMat4(a, b) applique b D’ABORD : les deux rotations se composent, la translation de a ne tourne pas');
eq(multiplyMat4(rigidMatrix([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0]), mRigid), mRigid,
  'composer avec l’identité ne change rien');
eq(rigidMatrix([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0]).length, 16, 'seize nombres, comme NGL les attend');
eq(rigidMatrix([1, 0, 0, 0, 1, 0, 0, 0, 1], [1, 2, 3])[12], 1, 'la translation est dans la 4e colonne (layout colonne-major)');

/* ══ §3. LA POSE (position + quaternion) ════════════════════════════════════ */
const box = [[0, 0, 0], [2.5, 0, 0], [0, 3.5, 0], [0.5, 0.5, 4.5], [-1, 2, 1]];
const center = [0.5, 1, 1];
[[rotZ(Math.PI / 3), [4, -2, 1]], [rotX(-Math.PI / 4), [0, 0, 0]], [mulR(rotZ(0.9), rotX(1.4)), [-3, 5, -2]]]
  .forEach(([R, t], k) => {
    const M = rigidMatrix(R, t);
    const { position, quaternion } = poseFromRigidMatrix(M, center);
    box.forEach((p, i) => {
      nearArr(nglPosePoint(position, quaternion, center, p), applyMat4(M, p), 1e-9,
        `cas ${k}, atome ${i} : la pose recomposée comme NGL redonne la matrice du fit`);
    });
  });
eq(poseFromRigidMatrix(rigidMatrix([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0]), center).quaternion.map((v) => Math.abs(v)),
  [0, 0, 0, 1], 'l’identité rend le quaternion neutre (au signe près)');
nearArr(poseFromRigidMatrix(rigidMatrix([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0]), center).position, [0, 0, 0], 1e-12,
  '…et aucune position');


/* ══ §4. BOUT EN BOUT : KABSCH + APPARIEMENT + POSE ════════════════════════ */
const ligand = [
  { name: 'C1', resname: 'LIG', x: 0, y: 0, z: 0 },
  { name: 'C2', resname: 'LIG', x: 1.4, y: 0, z: 0 },
  { name: 'N1', resname: 'LIG', x: 2.1, y: 1.2, z: 0.2 },
  { name: 'O1', resname: 'LIG', x: 3.3, y: 1.0, z: -0.4 },
  { name: 'C3', resname: 'LIG', x: 1.0, y: -1.5, z: 0.8 },
  { name: 'O2', resname: 'LIG', x: 1.7, y: -2.4, z: 1.6 },
];
const Rtrue = mulR(rotZ(0.7), rotX(-0.4));
const ttrue = [12, -5, 3];
// La « pose » : LA MÊME molécule, tournée puis translatée, dans un autre ordre
// d'atomes (c'est ce qu'un fichier de docking ou un modèle NMR renvoie).
const posed = ligand
  .map((a) => {
    const p = applyR(Rtrue, [a.x, a.y, a.z]);
    return { ...a, x: p[0] + ttrue[0], y: p[1] + ttrue[1], z: p[2] + ttrue[2] };
  })
  .reverse();
const pr = atomMatchPairs(ligand, posed);
eq(pr.size, 6, 'les six atomes du ligand s’apparient malgré l’ordre inversé');
const idxx = pr.movIdx.map((_, k) => k);
const refFlat = flatCoords(ligand, pr.refIdx);
const movFlat = flatCoords(posed, pr.movIdx);
const fit = rigidTransform(refFlat, movFlat, idxx);
ok(fit.rmsd < 1e-3, `le fit SUPERPOSE vraiment les atomes appariés (résidu ${fit.rmsd.toExponential(2)} Å)`);
const target = rigidMatrix(fit.R, fit.t);
/* §4bis LE PIÈGE DE CONVENTION — mesuré, pas supposé : le solveur rend une matrice
   dont la TRANSPOSÉE est la rotation qui superpose (son commentaire dit l'inverse).
   Le fit essaie les deux sens et garde le meilleur résidu : l'autre sens, lui,
   laisse les molécules décalées de deux fois l'angle, et voici ce que ça donne. */
const cR = centroidOf(refFlat, idxx);
const cM = centroidOf(movFlat, idxx);
const otherR = transpose3(fit.R);
const otherResidual = residualRmsd(refFlat, movFlat, idxx, otherR, translationFor(otherR, cR, cM));
ok(otherResidual > 0.5, `dans l'autre sens, le résidu est franc (${otherResidual.toFixed(3)} Å) — c'est ce que « R·mov + t » aurait laissé`);
// Le centre que NGL donne à la molécule DÉPLACÉE : celui de sa propre géométrie.
const cnt = posed.reduce((acc, a) => [acc[0] + a.x / 6, acc[1] + a.y / 6, acc[2] + a.z / 6], [0, 0, 0]);
const { position, quaternion } = poseFromRigidMatrix(target, cnt);
pr.refIdx.forEach((ri, k) => {
  const mi = pr.movIdx[k];
  const chosen = ligand[ri];
  const moved = posed[mi];
  nearArr(applyMat4(target, [moved.x, moved.y, moved.z]), [chosen.x, chosen.y, chosen.z], 1e-3,
    `atome ${ri} : la matrice du fit ramène la pose sur le choisi`);
  nearArr(nglPosePoint(position, quaternion, cnt, [moved.x, moved.y, moved.z]), [chosen.x, chosen.y, chosen.z], 1e-3,
    `atome ${ri} : …et la pose que NGL reçoit donne le même résultat`);
});
const cRefOfFit = centroidOf(refFlat, idxx);
nearArr(position, [
  cRefOfFit[0] - cnt[0],
  cRefOfFit[1] - cnt[1],
  cRefOfFit[2] - cnt[2],
], 1e-3, 'la position rendue amène le CENTRE de la molécule déplacée sur celui de la choisie');

/* Deux copies dont les hydrogènes manquent d'un côté : le squelette suffit. */
const heavyOnly = ligand.filter((a) => !String(a.name).startsWith('H'));
eq(atomMatchPairs(ligand, heavyOnly).size, heavyOnly.length,
  'une copie sans hydrogènes s’apparie sur ses atomes lourds');

/* ══ §5. LE MESSAGE ════════════════════════════════════════════════════════ */
eq(fitSummary(['Main (a.pdb)'], []), '🎯 1 structure fitted on the chosen one', 'un fit se raconte au singulier');
eq(fitSummary(['A', 'B'], []), '🎯 2 structures fitted on the chosen one', '…et au pluriel');
ok(fitSummary(['A'], ['HEM']).includes('left alone: HEM'), 'une molécule laissée de côté est NOMMÉE');
eq(fitSummary([], []), 'Nothing to fit — only one structure is shown.', 'rien à faire : le message le dit');
ok(fitSummary(['A'], ['B']).startsWith('🎯 1 structure'), 'les deux moitiés se lisent dans l’ordre');

console.log(`_structure_fit_test.mjs — ${passed} assertions OK`);
