/* =========================================================================
   src/utils/mdAnalysis.js
   Calculates the "MD general parameters" directly from a structure + a
   trajectory (the same frame providers used by the membrane-contact
   analysis), instead of showing synthetic curves:

     - RMSD vs time        (least-squares fitted, like `gmx rms`)
     - RMSF per residue    (`gmx rmsf`)
     - Radius of gyration  (`gmx gyrate`, mass-weighted)
     - SASA vs time        (Shrake-Rupley, `gmx sasa`)

   Energies are NOT in XTC/TRR files — they live in GROMACS .edr / .log /
   gmx energy output. parseEnergyFile() reads a `gmx energy -o` .xvg (or a
   simple "time value" text file) so the energy chart shows real data.

   All coordinates are in nm (as produced by MDTrajectoryFrames.js).
   ========================================================================= */

// ---------------------------------------------------------------------------
// 3×3 SVD via one-sided Jacobi rotations (A = U·S·Vᵀ, row-major flat arrays)
// ---------------------------------------------------------------------------
export const svd3 = (A) => {
  const m = 3, n = 3;
  const u = [...A];
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let iter = 0; iter < 64; iter++) {
    let off = 0;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        let alpha = 0, beta = 0, gamma = 0;
        for (let i = 0; i < m; i++) {
          const uip = u[i * n + p], uiq = u[i * n + q];
          alpha += uip * uip; beta += uiq * uiq; gamma += uip * uiq;
        }
        off += gamma * gamma;
        if (Math.abs(gamma) < 1e-13) continue;
        const zeta = (beta - alpha) / (2 * gamma);
        const t = (zeta >= 0 ? 1 : -1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = c * t;
        for (let i = 0; i < m; i++) {
          const uip = u[i * n + p], uiq = u[i * n + q];
          u[i * n + p] = c * uip - s * uiq;
          u[i * n + q] = s * uip + c * uiq;
        }
        for (let i = 0; i < n; i++) {
          const vip = v[i * n + p], viq = v[i * n + q];
          v[i * n + p] = c * vip - s * viq;
          v[i * n + q] = s * vip + c * viq;
        }
      }
    }
    if (off < 1e-20) break;
  }
  const s = [0, 0, 0];
  for (let j = 0; j < n; j++) {
    let ss = 0;
    for (let i = 0; i < m; i++) ss += u[i * n + j] * u[i * n + j];
    s[j] = Math.sqrt(ss);
  }
  for (let j = 0; j < n; j++) {
    if (s[j] > 1e-14) for (let i = 0; i < m; i++) u[i * n + j] /= s[j];
  }
  return { u, s, v };
};

const det3 = (a) =>
  a[0] * (a[4] * a[8] - a[5] * a[7]) -
  a[1] * (a[3] * a[8] - a[5] * a[6]) +
  a[2] * (a[3] * a[7] - a[4] * a[6]);

/**
 * Kabsch optimal rotation that maps the `mov` points onto the `ref` points
 * (both flat Float32Array of n atoms, xyz interleaved, nm). Only the atoms
 * listed in `idx` are used for fitting.
 * Returns { R (3×3 row-major), t } such that ref ≈ R·mov + t.
 */
export const kabsch = (ref, mov, idx) => {
  const n = idx.length;
  let cxR = 0, cyR = 0, czR = 0, cxM = 0, cyM = 0, czM = 0;
  for (let k = 0; k < n; k++) {
    const i = idx[k] * 3;
    cxR += ref[i]; cyR += ref[i + 1]; czR += ref[i + 2];
    cxM += mov[i]; cyM += mov[i + 1]; czM += mov[i + 2];
  }
  cxR /= n; cyR /= n; czR /= n; cxM /= n; cyM /= n; czM /= n;

  const H = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let k = 0; k < n; k++) {
    const i = idx[k] * 3;
    const px = ref[i] - cxR, py = ref[i + 1] - cyR, pz = ref[i + 2] - czR;
    const qx = mov[i] - cxM, qy = mov[i + 1] - cyM, qz = mov[i + 2] - czM;
    H[0] += px * qx; H[1] += px * qy; H[2] += px * qz;
    H[3] += py * qx; H[4] += py * qy; H[5] += py * qz;
    H[6] += pz * qx; H[7] += pz * qy; H[8] += pz * qz;
  }
  const { u, s, v } = svd3(H);
  let d = det3(v) * det3(u);
  if (d < 0) d = -1; else d = 1;

  // R = V·D·Uᵀ  with D = diag(1,1,d)
  const R = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) {
        const dv = (k === 2) ? d : 1;
        sum += v[i * 3 + k] * dv * u[j * 3 + k];
      }
      R[i * 3 + j] = sum;
    }
  }
  const t = [
    cxR - (R[0] * cxM + R[1] * cyM + R[2] * czM),
    cyR - (R[3] * cxM + R[4] * cyM + R[5] * czM),
    czR - (R[6] * cxM + R[7] * cyM + R[8] * czM),
  ];
  return { R, t };
};

/** Apply the Kabsch transform to a full flat coordinate array (nm). */
const applyKabsch = (coords, { R, t }) => {
  const out = new Float32Array(coords.length);
  for (let i = 0; i < coords.length; i += 3) {
    const x = coords[i], y = coords[i + 1], z = coords[i + 2];
    out[i] = R[0] * x + R[1] * y + R[2] * z + t[0];
    out[i + 1] = R[3] * x + R[4] * y + R[5] * z + t[1];
    out[i + 2] = R[6] * x + R[7] * y + R[8] * z + t[2];
  }
  return out;
};

// ---------------------------------------------------------------------------
// Atom metadata helpers
// ---------------------------------------------------------------------------
const ELEMENT_MASS = {
  H: 1.008, C: 12.011, N: 14.007, O: 15.999, F: 18.998, P: 30.974, S: 32.06,
  CL: 35.45, NA: 22.99, MG: 24.305, K: 39.098, CA: 40.078, ZN: 65.38, FE: 55.845
};
const VDW_RADIUS_NM = {
  H: 0.11, C: 0.17, N: 0.155, O: 0.152, F: 0.147, P: 0.18, S: 0.18, CL: 0.175,
  NA: 0.227, MG: 0.173, K: 0.275, CA: 0.231, ZN: 0.139, FE: 0.194
};
const DEFAULT_RADIUS = 0.17;

const PROTEIN_AA = new Set([
  'ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLN', 'GLU', 'GLY', 'HIS', 'ILE',
  'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER', 'THR', 'TRP', 'TYR', 'VAL',
  'HSD', 'HSE', 'HSP', 'CYX', 'GLH', 'ASH', 'LYN', 'HIP', 'HID', 'HIE'
]);

const atomMass = (a) => {
  const el = String(a.element || a.atomname || '').replace(/[^A-Za-z]/g, '').toUpperCase();
  return ELEMENT_MASS[el] || (String(a.element || '').toUpperCase() === 'H' ? 1.008 : 12.011);
};

const atomRadius = (a) => {
  const el = String(a.element || '').toUpperCase();
  return VDW_RADIUS_NM[el] || DEFAULT_RADIUS;
};

/**
 * Decide which atoms are used for what:
 *  - fitIdx   : fitted subset for RMSD/RMSF (protein backbone, else all heavy)
 *  - heavyIdx : heavy atoms for Rg / SASA
 *  - residueOfAtom, residueNos, nResidues : for the RMSF residue grouping
 */
export const buildAnalysisSets = (atoms) => {
  const isProteinRes = (a) => PROTEIN_AA.has(String(a.resname || '').toUpperCase());
  const isHeavy = (a) => String(a.element || a.atomname || '').toUpperCase() !== 'H';
  const isBackbone = (a) => ['N', 'CA', 'C', 'O'].includes(String(a.atomname || '').toUpperCase());

  const nProtein = atoms.filter(isProteinRes).length;
  const useBackbone = nProtein >= 4;

  const fitIdx = [];
  const heavyIdx = [];
  const residueOfAtom = new Array(atoms.length).fill(-1);
  const residueNos = [];

  const resMap = new Map();
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    const heavy = isHeavy(a);
    if (heavy) heavyIdx.push(i);
    if (useBackbone ? (isProteinRes(a) && isBackbone(a)) : heavy) fitIdx.push(i);
    const key = `${a.resno || 0}:${a.resname || ''}`;
    if (!resMap.has(key)) {
      resMap.set(key, residueNos.length);
      residueNos.push(a.resno != null ? Number(a.resno) : residueNos.length + 1);
    }
    residueOfAtom[i] = resMap.get(key);
  }
  return { fitIdx, heavyIdx, residueOfAtom, residueNos, nResidues: residueNos.length, useBackbone };
};

// ---------------------------------------------------------------------------
// Per-frame observables
// ---------------------------------------------------------------------------
const gyrationRadius = (coords, heavyIdx, masses) => {
  let cx = 0, cy = 0, cz = 0, mTot = 0;
  for (let k = 0; k < heavyIdx.length; k++) {
    const i = heavyIdx[k] * 3;
    const m = masses[k];
    cx += m * coords[i]; cy += m * coords[i + 1]; cz += m * coords[i + 2];
    mTot += m;
  }
  if (mTot <= 0) return 0;
  cx /= mTot; cy /= mTot; cz /= mTot;
  let s = 0;
  for (let k = 0; k < heavyIdx.length; k++) {
    const i = heavyIdx[k] * 3;
    const dx = coords[i] - cx, dy = coords[i + 1] - cy, dz = coords[i + 2] - cz;
    s += masses[k] * (dx * dx + dy * dy + dz * dz);
  }
  return Math.sqrt(s / mTot);
};

const fibonacciSphere = (n) => {
  const pts = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = ga * i;
    pts.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }
  return pts;
};
const SASA_POINTS = fibonacciSphere(60);
const PROBE_NM = 0.14;

/** Shrake–Rupley SASA for one frame (nm²), grid-accelerated. */
const sasaFrame = (coords, heavyIdx, radii) => {
  const n = heavyIdx.length;
  if (n === 0) return 0;
  const centers = new Float32Array(n * 3);
  const cell = 0.6; // nm grid cell
  for (let k = 0; k < n; k++) {
    const i = heavyIdx[k] * 3;
    centers[k * 3] = coords[i]; centers[k * 3 + 1] = coords[i + 1]; centers[k * 3 + 2] = coords[i + 2];
  }

  const grid = new Map();
  const keyOf = (x, y, z) => `${Math.floor(x / cell)}|${Math.floor(y / cell)}|${Math.floor(z / cell)}`;
  for (let k = 0; k < n; k++) {
    const key = keyOf(centers[k * 3], centers[k * 3 + 1], centers[k * 3 + 2]);
    const arr = grid.get(key);
    if (arr) arr.push(k); else grid.set(key, [k]);
  }

  let total = 0;
  for (let k = 0; k < n; k++) {
    const ri = radii[k];
    const rp = ri + PROBE_NM;
    const cx = centers[k * 3], cy = centers[k * 3 + 1], cz = centers[k * 3 + 2];
    let exposed = 0;
    for (let p = 0; p < SASA_POINTS.length; p++) {
      const dir = SASA_POINTS[p];
      const px = cx + dir[0] * rp, py = cy + dir[1] * rp, pz = cz + dir[2] * rp;
      const gx = Math.floor(px / cell), gy = Math.floor(py / cell), gz = Math.floor(pz / cell);
      const reach = Math.ceil((PROBE_NM + DEFAULT_RADIUS) / cell) + 1;
      let occluded = false;
      outer:
      for (let dx = -reach; dx <= reach; dx++) {
        for (let dy = -reach; dy <= reach; dy++) {
          for (let dz = -reach; dz <= reach; dz++) {
            const cellList = grid.get(`${gx + dx}|${gy + dy}|${gz + dz}`);
            if (!cellList) continue;
            for (let ci = 0; ci < cellList.length; ci++) {
              const j = cellList[ci];
              if (j === k) continue;
              const rj = radii[j];
              const dxp = px - centers[j * 3], dyp = py - centers[j * 3 + 1], dzp = pz - centers[j * 3 + 2];
              const lim = rj + PROBE_NM;
              if (dxp * dxp + dyp * dyp + dzp * dzp < lim * lim - 1e-12) {
                occluded = true;
                break outer;
              }
            }
          }
        }
      }
      if (!occluded) exposed++;
    }
    total += (exposed / SASA_POINTS.length) * 4 * Math.PI * rp * rp;
  }
  return total;
};

const yieldUI = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Main entry: iterate frames and compute everything
// ---------------------------------------------------------------------------
/**
 * @param topo     { atoms, box } from parseTopology()
 * @param frames   async iterator from resolveFrameSource() (xyz in nm)
 * @param opts     { stride, maxFrames, doSasa, doRg }
 * @param onStatus ({ done, total, msg })  progress callback
 * @returns { rmsd:[{time,value}], rmsf:[{residue,value}], rg:[{time,value}],
 *            sasa:[{time,value}], nFrames }
 */
export async function computeMDTrajectoryAnalysis(topo, frames, opts = {}, onStatus) {
  const { stride = 1, maxFrames = 500, doSasa = true, doRg = true } = opts;
  const atoms = Array.isArray(topo.atoms) ? topo.atoms : [];
  if (atoms.length === 0) throw new Error('No topology atoms.');

  const { fitIdx, heavyIdx, residueOfAtom, residueNos, nResidues } = buildAnalysisSets(atoms);
  if (fitIdx.length < 3) throw new Error('Not enough atoms to fit (need ≥3 heavy / backbone atoms).');

  const masses = heavyIdx.map((i) => atomMass(atoms[i]));
  const radii = heavyIdx.map((i) => atomRadius(atoms[i]));
  const nFit = fitIdx.length;

  const rmsdSeries = [];
  const rgSeries = [];
  const sasaSeries = [];
  const alignedFrames = [];   // aligned fit-atom coords per processed frame
  let read = 0;

  for await (const fr of frames) {
    if (!fr || !fr.xyz) continue;
    read++;
    if (read > 1 && (read - 1) % stride !== 0) continue;   // stride over processed frames
    if (alignedFrames.length >= maxFrames) break;
    const t = fr.time != null ? fr.time : read;

    const movFit = new Float32Array(nFit * 3);
    for (let k = 0; k < nFit; k++) {
      const i = fitIdx[k] * 3;
      movFit[k * 3] = fr.xyz[i]; movFit[k * 3 + 1] = fr.xyz[i + 1]; movFit[k * 3 + 2] = fr.xyz[i + 2];
    }

    if (alignedFrames.length === 0) {
      // reference = first processed frame
      alignedFrames.push(movFit);
      rmsdSeries.push({ time: t, value: 0 });
      if (doRg) rgSeries.push({ time: t, value: gyrationRadius(fr.xyz, heavyIdx, masses) });
      if (doSasa) sasaSeries.push({ time: t, value: sasaFrame(fr.xyz, heavyIdx, radii) });
      if (onStatus) onStatus({ done: 1, total: maxFrames, msg: 'Reference frame set' });
      continue;
    }

    const fitRef = alignedFrames[0];
    const { R, t: T } = kabsch(fitRef, movFit, Array.from({ length: nFit }, (_, k) => k));
    const alignedFit = applyKabsch(movFit, { R, t: T });

    let sq = 0;
    for (let k = 0; k < nFit; k++) {
      const dx = alignedFit[k * 3] - fitRef[k * 3];
      const dy = alignedFit[k * 3 + 1] - fitRef[k * 3 + 1];
      const dz = alignedFit[k * 3 + 2] - fitRef[k * 3 + 2];
      sq += dx * dx + dy * dy + dz * dz;
    }
    rmsdSeries.push({ time: t, value: Math.sqrt(sq / nFit) });
    alignedFrames.push(alignedFit);

    if (doRg) rgSeries.push({ time: t, value: gyrationRadius(fr.xyz, heavyIdx, masses) });
    if (doSasa) sasaSeries.push({ time: t, value: sasaFrame(fr.xyz, heavyIdx, radii) });

    if (onStatus && alignedFrames.length % 5 === 0) {
      onStatus({ done: alignedFrames.length, total: maxFrames, msg: `Frame ${alignedFrames.length}` });
      await yieldUI();
    }
  }

  // RMSF per residue (from aligned frames)
  const nF = alignedFrames.length;
  const avg = new Float32Array(nFit * 3);
  for (let f = 0; f < nF; f++) {
    const fr = alignedFrames[f];
    for (let k = 0; k < nFit; k++) {
      avg[k * 3] += fr[k * 3];
      avg[k * 3 + 1] += fr[k * 3 + 1];
      avg[k * 3 + 2] += fr[k * 3 + 2];
    }
  }
  for (let k = 0; k < nFit * 3; k++) avg[k] /= nF;

  const msfByRes = new Array(nResidues).fill(0);
  const countByRes = new Array(nResidues).fill(0);
  for (let k = 0; k < nFit; k++) {
    const res = residueOfAtom[fitIdx[k]];
    if (res < 0) continue;
    let m = 0;
    for (let f = 0; f < nF; f++) {
      const fr = alignedFrames[f];
      const dx = fr[k * 3] - avg[k * 3], dy = fr[k * 3 + 1] - avg[k * 3 + 1], dz = fr[k * 3 + 2] - avg[k * 3 + 2];
      m += dx * dx + dy * dy + dz * dz;
    }
    msfByRes[res] += m / nF;
    countByRes[res]++;
  }
  const rmsf = [];
  for (let r = 0; r < nResidues; r++) {
    rmsf.push({
      residue: residueNos[r],
      value: countByRes[r] > 0 ? Math.sqrt(msfByRes[r] / countByRes[r]) : 0
    });
  }

  return { rmsd: rmsdSeries, rmsf, rg: rgSeries, sasa: sasaSeries, nFrames: alignedFrames.length };
}

// ---------------------------------------------------------------------------
// Energy file parsing (XTC/TRR carry no energies — read gmx energy output)
// ---------------------------------------------------------------------------
/**
 * Parse a `gmx energy -o energy.xvg` file (or a simple "time value(s)" text)
 * into [{ time, potential, kinetic, total }].
 */
export const parseEnergyFile = (text) => {
  const lines = String(text || '').split(/\r?\n/);
  const headers = [];   // { idx, label }
  const data = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('@')) {
      const m = /^@\s*s(\d+)\s+"([^"]+)"/.exec(line);
      if (m) headers.push({ idx: Number(m[1]), label: m[2].toLowerCase() });
      continue;
    }
    const parts = line.split(/\s+/).filter(Boolean).map(Number);
    if (parts.length < 2 || parts.some((x) => !Number.isFinite(x))) continue;
    if (headers.length === 0) {
      data.push({ time: parts[0], value: parts[1] });
      continue;
    }
    const row = {};
    for (const h of headers) {
      if (parts[h.idx] === undefined) continue;
      if (/time/i.test(h.label)) { row.time = parts[h.idx]; }
      else if (/potential/i.test(h.label)) { row.potential = parts[h.idx]; }
      else if (/kinetic/i.test(h.label)) { row.kinetic = parts[h.idx]; }
      else if (/total/i.test(h.label)) { row.total = parts[h.idx]; }
      else if (h.idx === 0) { row.time = parts[h.idx]; }
    }
    if (row.time === undefined) row.time = parts[0];
    data.push(row);
  }

  if (data.length === 0) {
    throw new Error('No numeric rows found. Expecting gmx energy .xvg output or "time value" columns.');
  }

  return data.map((r) =>
    (r.potential !== undefined || r.kinetic !== undefined || r.total !== undefined)
      ? { time: r.time, potential: r.potential, kinetic: r.kinetic, total: r.total }
      : { time: r.time, total: r.value, potential: undefined, kinetic: undefined }
  );
};




