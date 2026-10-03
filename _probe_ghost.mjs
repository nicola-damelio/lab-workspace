/* =========================================================================
   _probe_ghost.mjs — LA BILLE DE vdW QUI REVIENT QUAND LE MAILLAGE EST LU.

   Hypothèse à prouver : `drawnProxyRadiiOf` saute les atomes d'une
   représentation dont les TRIANGLES ont été lus (le proxy serait un doublon du
   ruban). Ces atomes gardent alors `NaN`. Dans `layOut`, tant qu'UN atome est
   mesurable les NaN sont écartés, mais si AUCUN ne l'est (`measurable` faux —
   le cas d'une scène où le ruban est la SEULE représentation, donc d'un
   « cartoon + side chains hidden »), le repli `vdw` s'applique à TOUS : la
   scène se remplit de billes de 1,7 Å que rien ne dessine.
   ========================================================================= */
import {
  atomsFromStage, buildRayShadowMask, boundsBoxOf, mat4LookAt,
  mat4Multiply, maxStrokeRadiusOf, proxyStrokeSummary, expandBoxOf,
  rasterizeTriangles, rayShadowMaskSize, shadowRigOf,
} from './src/utils/viewerRayShadows.js';

const IDENT16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const POS = Float32Array.from([
  0, 0, 0,
  1.5, 0.4, 0,
  3.0, 0.8, 0,
  4.5, 1.2, 0,
]);
const N = POS.length / 3;

/* Un maillage INDEXÉ avec des normales : c'est ce que NGL attache à un cartoon
   une fois construit. Sa seule présence suffit à `covered`. */
const indexedSurface = ({ verts = 4, tris = 2 } = {}) => {
  const p = new Float32Array(verts * 3);
  const nn = new Float32Array(verts * 3);
  for (let i = 0; i < verts; i += 1) {
    p[i * 3] = i * 0.5; p[i * 3 + 2] = 0;
    nn[i * 3 + 2] = 1;
  }
  const idx = new Uint16Array(tris * 3);
  for (let t = 0; t < tris; t += 1) {
    idx[t * 3] = t; idx[t * 3 + 1] = (t + 1) % verts; idx[t * 3 + 2] = (t + 2) % verts;
  }
  return {
    attributes: { position: { array: p, count: verts }, normal: { array: nn, count: verts } },
    index: { array: idx },
  };
};

const structure = {
  atomCount: N,
  getAtomData: () => ({ position: POS, radius: new Float32Array(N).fill(1.7) }),
  eachBond: (cb) => { for (let i = 0; i + 1 < N; i += 1) cb({ atomIndex1: i, atomIndex2: i + 1 }); },
  eachResidue: (cb) => { for (let i = 0; i < N; i += 1) cb({ traceAtomIndex: i }); },
};
const view = { getAtomIndices: () => Uint32Array.from({ length: N }, (_, i) => i) };
const el = (name, rep) => ({ name, getType: () => name, type: 'representation', repr: rep, parameters: {} });
const stageOf = (reprList) => ({ compList: [{ structure, matrix: { elements: IDENT16 }, reprList }] });

const report = (label, atoms) => {
  const summary = proxyStrokeSummary(atoms.radii, atoms.count, 64);
  console.log(`${label}\n   count=${atoms.count} filled=${atoms.filled} radii=${Array.from(atoms.radii).map((v) => (Number.isFinite(v) ? v.toFixed(2) : 'NaN')).join(',')}\n   strokes=${JSON.stringify(summary.list)} maxStroke=${maxStrokeRadiusOf(atoms).toFixed(2)}`);
  return atoms;
};

const covered = report('A. cartoon SEUL, maillage LU (side chains cachées)',
  atomsFromStage(stageOf([el('cartoon', { type: 'cartoon', visible: true, radiusScale: 0.7, radiusType: 'sstruc', structureView: view, bufferList: [{ geometry: indexedSurface() }] })]), 100000));

report('B. cartoon SEUL, maillage NON lisible (build en file)',
  atomsFromStage(stageOf([el('cartoon', { type: 'cartoon', visible: true, radiusScale: 0.7, radiusType: 'sstruc', structureView: view })]), 100000));

report('C. cartoon (maillage LU) + licorice des chaînes latérales',
  atomsFromStage(stageOf([
    el('cartoon', { type: 'cartoon', visible: true, radiusScale: 0.7, radiusType: 'sstruc', structureView: view, bufferList: [{ geometry: indexedSurface() }] }),
    el('licorice', { type: 'licorice', visible: true, radiusType: 'size', radiusSize: 0.25, structureView: { getAtomIndices: () => Uint32Array.from([2, 3]) } }),
  ]), 100000));

/* D. L'ORDRE DES REPRÉSENTATIONS NE COMPTE PAS : le licorice AVANT le cartoon.
   Le ZÉRO du maillage ne doit écraser un trait MESURÉ par personne (voir le test
   `!(out[a] >= 0)` dans `drawnProxyRadiiOf`) : même résultat que C. */
report('D. licorice AVANT le cartoon (maillage LU) — ordre indifférent',
  atomsFromStage(stageOf([
    el('licorice', { type: 'licorice', visible: true, radiusType: 'size', radiusSize: 0.25, structureView: { getAtomIndices: () => Uint32Array.from([2, 3]) } }),
    el('cartoon', { type: 'cartoon', visible: true, radiusScale: 0.7, radiusType: 'sstruc', structureView: view, bufferList: [{ geometry: indexedSurface() }] }),
  ]), 100000));

/* E. UN GENRE ILLISIBLE *SUR LES MÊMES ATOMES* QUE LE RUBAN — MESURÉ, ET ASSUMÉ.
   Contre toute attente, le `dot` ne garde PAS son repli ici : le ruban écrit son
   ZÉRO sur les atomes qu'il dessine, le premier filtre de `layOut` les écarte, et
   il ne reste plus AUCUN atome à replier — `measurable` reste faux (aucune valeur
   finie > 0) mais les NaN du `dot` ont été REMPLACÉS par ce zéro. C'est le
   comportement voulu : le maillage DESSINE déjà ces atomes, une bille de vdW les
   doublerait (c'est le fantôme du rapport). ⚠ `dot` n'est plus le style de
   pointillés du viewer (NGL 2.4 ne l'enregistre même pas — c'est `point`, voir F) :
   il ne reste ici que comme le PROTOTYPE d'un genre que la table ne sait pas
   mesurer. */
report('E. cartoon (maillage LU) + dot sur les MÊMES atomes → aucun proxy (le maillage dessine déjà)',
  atomsFromStage(stageOf([
    el('cartoon', { type: 'cartoon', visible: true, radiusScale: 0.7, radiusType: 'sstruc', structureView: view, bufferList: [{ geometry: indexedSurface() }] }),
    el('dot', { type: 'dot', visible: true, radiusScale: 1, structureView: view }),
  ]), 100000));

/* F. LA SCÈNE RÉELLE : le ruban sur [0, 1] (maillage LU) et les POINTILLÉS sur
   [2, 3]. Les deux ensembles sont disjoints, comme `cartoon` (protéine) + les
   points des eaux / ions dans le viewer. ⚠ CES POINTILLÉS SONT DES `point` — NGL
   2.4 n'enregistre aucune représentation `dot` (la demander LÈVE, et le `try` du
   viewer ne dessinait alors RIEN). Le point est un POINT ÉCRAN : sa seule ombre
   honnête est un cheveu (0,15 Å), jamais la bille de 1,7 Å du repli vdW qui
   remplissait l'ombre d'une nuée de billes (« a shadow on a plane »). C'est cette
   scène-là que le banc garde (sections 8 et 8b). */
report('F. cartoon (maillage LU, [0,1]) + point ([2,3]) — la scène du viewer',
  atomsFromStage(stageOf([
    el('cartoon', { type: 'cartoon', visible: true, radiusScale: 0.7, radiusType: 'sstruc', structureView: { getAtomIndices: () => Uint32Array.from([0, 1]) }, bufferList: [{ geometry: indexedSurface() }] }),
    el('point', { type: 'point', visible: true, pointSize: 2, structureView: { getAtomIndices: () => Uint32Array.from([2, 3]) } }),
  ]), 100000));

/* G. LE STYLE LÉGER « dots » D'UN GRAND SYSTÈME : TOUT est en points, et rien
   d'autre (voir `ls === 'dots'` d'addDefaultReps). C'était la scène où le repli
   vdW faisait le plus de dégâts — 100 % des atomes y tombaient. */
report('G. point seul (le style léger « dots ») → un cheveu par atome, aucune bille',
  atomsFromStage(stageOf([
    el('point', { type: 'point', visible: true, pointSize: 2, structureView: view }),
  ]), 100000));


/* ── LE MASQUE, ET LE COMPTAGE DES PIXELS FANTÔMES ────────────────────────── */
const box = expandBoxOf(boundsBoxOf(covered.positions, covered.count), maxStrokeRadiusOf(covered) || 1);
const center = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
const radius = Math.max(1e-3, 0.5 * Math.sqrt(
  (box.max[0] - box.min[0]) ** 2 + (box.max[1] - box.min[1]) ** 2 + (box.max[2] - box.min[2]) ** 2,
));
const W = 400, H = 300;
const aspect = W / H;
const tan = Math.tan((40 * Math.PI) / 360);
const dist = (radius * 1.35) / tan;
const proj = [
  1 / (aspect * tan), 0, 0, 0,
  0, 1 / tan, 0, 0,
  0, 0, -((dist * 4) + 0.1) / ((dist * 4) - 0.1), -1,
  0, 0, (-2 * (dist * 4) * 0.1) / ((dist * 4) - 0.1), 0,
];
const cview = mat4LookAt([0, 0, -dist], [0, 0, 0], [0, 1, 0]);
const camera = { view: cview, clip: mat4Multiply(proj, cview) };
const LAMP = [Math.cos(0.26) * Math.cos(2.09), Math.cos(0.26) * Math.sin(2.09), Math.sin(0.26)];
const light = {
  dir: LAMP, center, radius, distance: radius * 100, bounds: box,
  ...shadowRigOf({ dir: LAMP, bounds: box, center, radius, distance: radius * 100 }),
};
const shadow = buildRayShadowMask({ atoms: covered, camera, light, width: W, height: H });
const size = rayShadowMaskSize(W, H, {});
const tris = covered.tris;
const triPass = tris.count ? rasterizeTriangles({
  positions: tris.positions, normals: tris.normals, indices: tris.indices, count: tris.count,
  clip: camera.clip, width: size.width, height: size.height, stride: tris.stride || 1,
}) : { hit: new Uint8Array(size.width * size.height), drawn: 0 };
let maskPx = 0, ghostPx = 0;
for (let i = 0; i < shadow.mask.length; i += 1) {
  if (!(shadow.mask[i] > 0.02)) continue;
  maskPx += 1;
  if (!triPass.hit[i]) ghostPx += 1;
}
console.log(`\nMASQUE (scene A, cartoon seul) : ${maskPx} px assombris, dont ${ghostPx} HORS du ruban dessiné (${triPass.drawn} triangles)`);
console.log(`   compteur d'auto-ombrage : ${shadow.selfShadow}`);
