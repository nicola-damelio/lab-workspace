/* =========================================================================
   src/utils/structureFit.js
   THE RIGID FIT OF ONE STRUCTURE ONTO ANOTHER — « fit all selected molecules
   to a chosen one » (the styling window's 🎯 button).

   The chemist's request, verbatim: « in the styling window the “all”, “main”,
   “copy” buttons at the top are obsolete, you can replace them for a button to
   select all molecules or none and a button to fit all selected molecules to a
   chosen one. »

   A fit needs TWO things, and this module owns both — the maths is pure, so it
   is unit tested (see _structure_fit_test.mjs):

     1. WHICH atom of the moving structure corresponds to which atom of the
        chosen one (`atomMatchPairs`). Two loaded files of the same molecule —
        docking poses, an NMR ensemble, a ligand and its reference — carry the
        SAME atom names, so the names are the correspondence. A selection of the
        same file (one chain, one leaflet) is a SUBSET: the names still match, they
        are simply fewer. Anything else (two different molecules) has too few
        pairs, and the caller says so instead of drawing a nonsense overlay.

     2. The rigid motion itself. It is NOT re-implemented here: `rigidTransform`
        feeds the paired coordinates to `kabsch` (src/utils/mdAnalysis.js — the
        optimal-rotation solver the MD analysis fits frames with) and turns the
        result into a proper (R, t) that REALLY superposes the atoms — see the note
        on `rigidTransform` for the convention trap it catches.
   ========================================================================= */

import { kabsch } from './mdAnalysis.js';

/** One atom, reduced to what a fit needs. @typedef {{name:string,resname:string,x:number,y:number,z:number}} FitAtom */

/** `ATOMNAME|RESNAME` — the key two copies of the same molecule agree on, however
 *  the files spelled their chain ids, residue numbers or model names. */
export const fitAtomKey = (atom) => `${String((atom && atom.name) || '').trim().toUpperCase()}|${String((atom && atom.resname) || '').trim().toUpperCase()}`;

/**
 * The atom-to-atom correspondence of a fit: the k-th occurrence of a key in the
 * moving structure matches the k-th occurrence in the chosen one, so a repeated
 * name (the four oxygens of a phosphate, the three methyls of a leucine) is
 * matched in ORDER instead of collapsing onto one atom.
 * @param {FitAtom[]} refAtoms atoms of the CHOSEN structure
 * @param {FitAtom[]} movAtoms atoms of the structure being fitted
 * @returns {{refIdx:number[], movIdx:number[], size:number}} paired indices
 */
export const atomMatchPairs = (refAtoms, movAtoms) => {
  const buckets = new Map();
  (refAtoms || []).forEach((a, i) => {
    const k = fitAtomKey(a);
    const list = buckets.get(k);
    if (list) list.push(i); else buckets.set(k, [i]);
  });
  const seen = new Map();
  const refIdx = [];
  const movIdx = [];
  (movAtoms || []).forEach((a, i) => {
    const k = fitAtomKey(a);
    const list = buckets.get(k);
    if (!list || !list.length) return;
    const n = seen.get(k) || 0;
    if (n >= list.length) return;      // more copies here than there: the extras are left out
    seen.set(k, n + 1);
    refIdx.push(list[n]);
    movIdx.push(i);
  });
  return { refIdx, movIdx, size: refIdx.length };
};

/**
 * Three coordinates per atom, in the order given by `idx`, as one flat array —
 * the shape `kabsch` (utils/mdAnalysis.js) reads. Units do not matter as long as
 * BOTH arrays use the same one (the fit is a rigid motion).
 * @param {FitAtom[]} atoms @param {number[]} idx
 * @returns {Float32Array}
 */
export const flatCoords = (atoms, idx) => {
  const out = new Float32Array(idx.length * 3);
  idx.forEach((i, k) => {
    const a = atoms[i] || {};
    out[k * 3] = Number(a.x) || 0;
    out[k * 3 + 1] = Number(a.y) || 0;
    out[k * 3 + 2] = Number(a.z) || 0;
  });
  return out;
};

/** Column-major 4×4 product `a · b` (three.js order: `a` applies AFTER `b`). */
export const multiplyMat4 = (a, b) => {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += (a[k * 4 + r] || 0) * (b[c * 4 + k] || 0);
      out[c * 4 + r] = v;
    }
  }
  return out;
};

/** The point `[x, y, z]` transformed by a column-major 4×4 matrix. */
export const applyMat4 = (m, p) => [
  (m[0] * p[0]) + (m[4] * p[1]) + (m[8] * p[2]) + m[12],
  (m[1] * p[0]) + (m[5] * p[1]) + (m[9] * p[2]) + m[13],
  (m[2] * p[0]) + (m[6] * p[1]) + (m[10] * p[2]) + m[14],
];

/**
 * NGL's own decomposition of a rigid world matrix: the rotation quaternion and
 * the position that `Component#updateMatrix()` must be given to produce
 * `elements`, given the CENTRE of the untransformed geometry.
 * @param {number[]} elements column-major 4×4 of the wanted geometry→world map
 * @param {number[]} center [x, y, z] of the component's own geometry
 * @returns {{position:number[], quaternion:number[]}} quaternion is [x, y, z, w]
 */
export const poseFromRigidMatrix = (elements, center) => {
  const m = elements || [];
  const c = center || [0, 0, 0];
  // Rotation matrix, column-major 3×3 (m[c * 4 + r]).
  const r00 = m[0]; const r01 = m[4]; const r02 = m[8];
  const r10 = m[1]; const r11 = m[5]; const r12 = m[9];
  const r20 = m[2]; const r21 = m[6]; const r22 = m[10];
  const trace = r00 + r11 + r22;
  let x; let y; let z; let w;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = s / 4; x = (r21 - r12) / s; y = (r02 - r20) / s; z = (r10 - r01) / s;
  } else if (r00 > r11 && r00 > r22) {
    const s = Math.sqrt(1 + r00 - r11 - r22) * 2;
    w = (r21 - r12) / s; x = s / 4; y = (r01 + r10) / s; z = (r02 + r20) / s;
  } else if (r11 > r22) {
    const s = Math.sqrt(1 + r11 - r00 - r22) * 2;
    w = (r02 - r20) / s; x = (r01 + r10) / s; y = s / 4; z = (r12 + r21) / s;
  } else {
    const s = Math.sqrt(1 + r22 - r00 - r11) * 2;
    w = (r10 - r01) / s; x = (r02 + r20) / s; y = (r12 + r21) / s; z = s / 4;
  }
  // NGL rotates about the geometry's centre: the position is « centre → centre ».
  const moved = applyMat4(m, c);
  return {
    position: [moved[0] - c[0], moved[1] - c[1], moved[2] - c[2]],
    quaternion: [x, y, z, w],
  };
};

/** One line saying what the fit did — and, honestly, what it could not do. */
export const fitSummary = (fitted, skipped) => {
  const n = (fitted || []).length;
  const s = (skipped || []).length;
  if (!n && !s) return 'Nothing to fit — only one structure is shown.';
  const parts = [];
  if (n) parts.push(`🎯 ${n} structure${n > 1 ? 's' : ''} fitted on the chosen one`);
  if (s) parts.push(`left alone: ${skipped.join(', ')}`);
  return parts.join(' · ');
};

/**
 * The 4×4 (column-major, the layout three.js — and therefore NGL — stores) of a
 * rigid motion `ref ≈ R·mov + t`, built from Kabsch's row-major 3×3 `R` and `t`.
 * @param {ArrayLike<number>} R 9 numbers, row-major @param {ArrayLike<number>} t 3 numbers
 * @returns {number[]} 16 numbers, column-major
 */
export const rigidMatrix = (R, t) => {
  const r = R || [];
  const p = t || [];
  // Column-major: e[col * 4 + row].
  return [
    Number(r[0]) || 0, Number(r[3]) || 0, Number(r[6]) || 0, 0,
    Number(r[1]) || 0, Number(r[4]) || 0, Number(r[7]) || 0, 0,
    Number(r[2]) || 0, Number(r[5]) || 0, Number(r[8]) || 0, 0,
    Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0, 1,
  ];
};

/** Centroid of the atoms listed in `idx` (flat coordinates, three per atom). */
export const centroidOf = (flat, idx) => {
  const c = [0, 0, 0];
  const n = (idx || []).length;
  if (!n) return c;
  for (let k = 0; k < n; k++) {
    const i = idx[k] * 3;
    c[0] += (flat[i] || 0) / n;
    c[1] += (flat[i + 1] || 0) / n;
    c[2] += (flat[i + 2] || 0) / n;
  }
  return c;
};

/** Transpose of a row-major 3×3, row-major — the two ways a solver may store `R`. */
export const transpose3 = (R) => {
  const r = R || [];
  return [r[0] || 0, r[3] || 0, r[6] || 0, r[1] || 0, r[4] || 0, r[7] || 0, r[2] || 0, r[5] || 0, r[8] || 0];
};

/** `t` such that the rotation `R` (row-major, `mov → ref`) brings the centroid of
 *  the moving atoms onto the centroid of the chosen ones. */
export const translationFor = (R, refCentroid, movCentroid) => {
  const r = R || [];
  const cRef = refCentroid || [0, 0, 0];
  const cMov = movCentroid || [0, 0, 0];
  return [
    cRef[0] - (r[0] * cMov[0] + r[1] * cMov[1] + r[2] * cMov[2]),
    cRef[1] - (r[3] * cMov[0] + r[4] * cMov[1] + r[5] * cMov[2]),
    cRef[2] - (r[6] * cMov[0] + r[7] * cMov[1] + r[8] * cMov[2]),
  ];
};

/** RMS distance left between the paired atoms after `p ↦ R·p + t` (Å if the
 *  coordinates are Å). It is the only judge of « did this fit work? ». */
export const residualRmsd = (refFlat, movFlat, idx, R, t) => {
  const r = R || [];
  const p = t || [0, 0, 0];
  const n = (idx || []).length;
  if (!n) return Infinity;
  let sq = 0;
  for (let k = 0; k < n; k++) {
    const i = idx[k] * 3;
    const x = movFlat[i] || 0;
    const y = movFlat[i + 1] || 0;
    const z = movFlat[i + 2] || 0;
    const ax = r[0] * x + r[1] * y + r[2] * z + p[0];
    const ay = r[3] * x + r[4] * y + r[5] * z + p[1];
    const az = r[6] * x + r[7] * y + r[8] * z + p[2];
    sq += (ax - (refFlat[i] || 0)) ** 2 + (ay - (refFlat[i + 1] || 0)) ** 2 + (az - (refFlat[i + 2] || 0)) ** 2;
  }
  return Math.sqrt(sq / n);
};

/**
 * THE RIGID MOTION that really takes `mov` onto `ref`:
 * `{ R (row-major 3×3, mov → ref), t, rmsd }`.
 *
 * ⚠ LE PIÈGE DE CONVENTION, MESURÉ : `kabsch` rend une matrice dont la TRANSPOSÉE
 * est la rotation qui superpose (son commentaire dit l'inverse, et `applyKabsch`
 * l'applique dans le sens du commentaire). Sur une rotation de 0,7 rad l'écart
 * résiduel passe de 2,1 Å dans le sens documenté à 1e-6 Å dans l'autre : un fit
 * choisi à l'aveugle laisserait donc les molécules côte à côte, DéCALÉES de deux
 * fois l'angle. Ce module ne parie donc pas : il construit les DEUX candidats (R et
 * Rᵀ, chacun avec SA translation), mesure le résidu RMS des atomes appariés et
 * garde celui qui superpose vraiment. Le jour où le solveur sera corrigé, c'est
 * toujours le bon candidat qui gagne.
 */
export const rigidTransform = (refFlat, movFlat, idx) => {
  const { R } = kabsch(refFlat, movFlat, idx);
  const cRef = centroidOf(refFlat, idx);
  const cMov = centroidOf(movFlat, idx);
  let best = null;
  [R, transpose3(R)].forEach((Rr) => {
    const t = translationFor(Rr, cRef, cMov);
    const rmsd = residualRmsd(refFlat, movFlat, idx, Rr, t);
    if (!best || rmsd < best.rmsd) best = { R: Rr, t, rmsd };
  });
  return best;
};

