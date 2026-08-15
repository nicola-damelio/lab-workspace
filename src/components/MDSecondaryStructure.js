/* =========================================================================
   MDSecondaryStructure.js
   Secondary structure along the trajectory — in-browser port of
   `gmx do_dssp` (Kabsch & Sander algorithm):

   - backbone H positions reconstructed (N + 1 Å along N-C'; prolines
     have no donor H)
   - H-bond energy E = 27.888 * (1/rON + 1/rCH - 1/rOH - 1/rCN) kcal/mol
     (distances in Å); H-bond when E <= -0.5 kcal/mol
   - helix patterns: i->i-4 (alpha/H), i->i-3 (3-10/G), i->i-5 (pi/I);
     two consecutive turns -> helix letter, isolated turns -> T
   - bends: pseudo-bond angle kappa > 70 deg -> S
   - beta-bridges (parallel & antiparallel patterns); consecutive
     bridges (ladders) -> E, isolated bridges -> B
   - DSSP priority: H > B > E > G > I > T > S > C
   ========================================================================= */

export const SS_CODE_ORDER = ['H', 'E', 'G', 'I', 'B', 'T', 'S', 'C'];
export const SS_COLORS = {
  H: '#d62828', G: '#f3722c', I: '#9d0208', E: '#2667ff',
  B: '#00b4d8', T: '#ffb703', S: '#80b918', C: '#e5e7eb',
};
export const SS_GROUP_COLORS = { alpha: '#d62828', beta: '#2667ff', coil: '#9ca3af' };

const HBOND_E_MAX = -0.5;   // kcal/mol
const KFACTOR = 27.888;     // 332 * 0.42 * 0.20
const RSEARCH_NM = 0.36;    // O...N search radius (nm)
const PRIO = { H: 7, B: 6, E: 5, G: 4, I: 3, T: 2, S: 1, C: 0 };

const minImage3 = (dx, dy, dz, box) => {
  const sz = Math.round(dz / box[8]); dz -= sz * box[8]; dy -= sz * box[7]; dx -= sz * box[6];
  const sy = Math.round(dy / box[4]); dy -= sy * box[4]; dx -= sy * box[3];
  const sx = Math.round(dx / box[0]); dx -= sx * box[0];
  return [dx, dy, dz];
};

/* -------- backbone detection from the topology -------- */

export const prepareBackbone = (atoms) => {
  const residues = [];
  let cur = null;
  atoms.forEach((a, idx) => {
    if (!cur || a.resnr !== cur.resnr || a.resname !== cur.resname) {
      cur = { resnr: a.resnr, resname: a.resname, idx: {} };
      residues.push(cur);
    }
    const nm = a.atomname.toUpperCase();
    if (nm === 'N' && cur.idx.N === undefined) cur.idx.N = idx;
    else if (nm === 'CA' && cur.idx.CA === undefined) cur.idx.CA = idx;
    else if (nm === 'C' && cur.idx.C === undefined) cur.idx.C = idx;
    else if (nm === 'O' && cur.idx.O === undefined) cur.idx.O = idx;
  });
  // keep only protein residues with a complete backbone
  return residues.filter((r) =>
    r.idx.N !== undefined && r.idx.CA !== undefined &&
    r.idx.C !== undefined && r.idx.O !== undefined);
};

/* -------- per-frame DSSP assigner (precomputed static data) -------- */

const buildAssigner = (bb) => {
  const n = bb.length;
  const idxN = bb.map((r) => r.idx.N);
  const idxCA = bb.map((r) => r.idx.CA);
  const idxC = bb.map((r) => r.idx.C);
  const idxO = bb.map((r) => r.idx.O);
  const proline = bb.map((r) => /^(PRO|HYP)/.test(r.resname));
  const chainId = new Int32Array(n);
  let cid = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0 && bb[i].resnr !== bb[i - 1].resnr + 1) cid++;
    chainId[i] = cid;
  }

  return (xyz, box) => {
    /* 1) hydrogen positions */
    const H = new Float32Array(n * 3);
    const donates = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (proline[i]) continue;
      donates[i] = 1;
      const ni = 3 * idxN[i];
      const nx = xyz[ni], ny = xyz[ni + 1], nz = xyz[ni + 2];
      let rx, ry, rz;
      if (i > 0 && chainId[i] === chainId[i - 1]) {
        const pc = 3 * idxC[i - 1];
        [rx, ry, rz] = minImage3(nx - xyz[pc], ny - xyz[pc + 1], nz - xyz[pc + 2], box);
      } else {
        const ca = 3 * idxCA[i];
        [rx, ry, rz] = minImage3(nx - xyz[ca], ny - xyz[ca + 1], nz - xyz[ca + 2], box);
      }
      const len = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
      H[3 * i] = nx + 0.1 * rx / len;
      H[3 * i + 1] = ny + 0.1 * ry / len;
      H[3 * i + 2] = nz + 0.1 * rz / len;
    }

    /* 2) cell list over acceptor oxygens */
    const cs = RSEARCH_NM;
    const gx = Math.max(1, Math.floor(Math.abs(box[0]) / cs));
    const gy = Math.max(1, Math.floor(Math.abs(box[4]) / cs));
    const gz = Math.max(1, Math.floor(Math.abs(box[8]) / cs));
    const heads = new Int32Array(gx * gy * gz).fill(-1);
    const nxt = new Int32Array(n);
    const wrapN = (v, m) => ((v % m) + m) % m;
    for (let a = 0; a < n; a++) {
      const o3 = 3 * idxO[a];
      const cx = wrapN(Math.floor(xyz[o3] / cs), gx);
      const cy = wrapN(Math.floor(xyz[o3 + 1] / cs), gy);
      const cz = wrapN(Math.floor(xyz[o3 + 2] / cs), gz);
      const cell = (cz * gy + cy) * gx + cx;
      nxt[a] = heads[cell]; heads[cell] = a;
    }

    /* 3) H-bonds: donor d -> acceptor a, |d-a| >= 3 */
    const hb = new Set();
    const dist2A = (x1, y1, z1, x2, y2, z2) => {
      const [dx, dy, dz] = minImage3(x1 - x2, y1 - y2, z1 - z2, box);
      return Math.sqrt(dx * dx + dy * dy + dz * dz) * 10; // Å
    };
    for (let d = 0; d < n; d++) {
      if (!donates[d]) continue;
      const n3 = 3 * idxN[d], h3 = 3 * d;
      const cx0 = Math.floor(xyz[n3] / cs), cy0 = Math.floor(xyz[n3 + 1] / cs), cz0 = Math.floor(xyz[n3 + 2] / cs);
      for (let u = -1; u <= 1; u++) for (let v = -1; v <= 1; v++) for (let w = -1; w <= 1; w++) {
        const cell = (wrapN(cz0 + w, gz) * gy + wrapN(cy0 + v, gy)) * gx + wrapN(cx0 + u, gx);
        for (let a = heads[cell]; a !== -1; a = nxt[a]) {
          if (Math.abs(a - d) < 3) continue;
          const o3 = 3 * idxO[a], c3 = 3 * idxC[a];
          const rON = Math.max(0.8, dist2A(xyz[o3], xyz[o3 + 1], xyz[o3 + 2], xyz[n3], xyz[n3 + 1], xyz[n3 + 2]));
          const rOH = Math.max(0.8, dist2A(xyz[o3], xyz[o3 + 1], xyz[o3 + 2], H[h3], H[h3 + 1], H[h3 + 2]));
          const rCH = Math.max(0.8, dist2A(xyz[c3], xyz[c3 + 1], xyz[c3 + 2], H[h3], H[h3 + 1], H[h3 + 2]));
          const rCN = Math.max(0.8, dist2A(xyz[c3], xyz[c3 + 1], xyz[c3 + 2], xyz[n3], xyz[n3 + 1], xyz[n3 + 2]));
          const E = KFACTOR * (1 / rON + 1 / rCH - 1 / rOH - 1 / rCN);
          if (E <= HBOND_E_MAX) hb.add(d * n + a);
        }
      }
    }
    const isHB = (d, a) => d >= 0 && d < n && a >= 0 && a < n && hb.has(d * n + a);

    /* 4) assignments with DSSP priority */
    const letter = new Array(n).fill('C');
    const setSS = (i, ch) => { if (i >= 0 && i < n && PRIO[ch] > PRIO[letter[i]]) letter[i] = ch; };

    // helix-turn patterns: hK[i] = H-bond donor i -> acceptor i-K (same chain)
    const h4 = new Uint8Array(n), h3 = new Uint8Array(n), h5 = new Uint8Array(n);
    for (let i = 4; i < n; i++) if (isHB(i, i - 4) && chainId[i] === chainId[i - 4]) h4[i] = 1;
    for (let i = 3; i < n; i++) if (isHB(i, i - 3) && chainId[i] === chainId[i - 3]) h3[i] = 1;
    for (let i = 5; i < n; i++) if (isHB(i, i - 5) && chainId[i] === chainId[i - 5]) h5[i] = 1;

    // turns: isolated n-turns -> T on interior residues
    for (let i = 3; i < n; i++) if (h3[i]) { setSS(i - 2, 'T'); setSS(i - 1, 'T'); }
    for (let i = 4; i < n; i++) if (h4[i]) { setSS(i - 3, 'T'); setSS(i - 2, 'T'); setSS(i - 1, 'T'); }
    for (let i = 5; i < n; i++) if (h5[i]) { setSS(i - 4, 'T'); setSS(i - 3, 'T'); setSS(i - 2, 'T'); setSS(i - 1, 'T'); }

    // two consecutive turns -> helix
    for (let i = 4; i < n; i++) if (h4[i] && h4[i - 1]) for (let k = i - 5; k <= i; k++) setSS(k, 'H');
    for (let i = 4; i < n; i++) if (h3[i] && h3[i - 1]) for (let k = i - 4; k <= i; k++) setSS(k, 'G');
    for (let i = 6; i < n; i++) if (h5[i] && h5[i - 1]) for (let k = i - 6; k <= i; k++) setSS(k, 'I');

    // bends (kappa > 70 deg)
    const cosKappa = Math.cos(70 * Math.PI / 180);
    for (let i = 2; i + 2 < n; i++) {
      if (chainId[i - 2] !== chainId[i + 2]) continue;
      const a1 = 3 * idxCA[i - 2], a2 = 3 * idxCA[i], a3 = 3 * idxCA[i + 2];
      const v1 = minImage3(xyz[a2] - xyz[a1], xyz[a2 + 1] - xyz[a1 + 1], xyz[a2 + 2] - xyz[a1 + 2], box);
      const v2 = minImage3(xyz[a3] - xyz[a2], xyz[a3 + 1] - xyz[a2 + 1], xyz[a3 + 2] - xyz[a2 + 2], box);
      const d1 = Math.hypot(v1[0], v1[1], v1[2]) || 1, d2 = Math.hypot(v2[0], v2[1], v2[2]) || 1;
      if ((v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / (d1 * d2) < cosKappa) setSS(i, 'S');
    }

    // beta-bridges, ladders -> E / isolated -> B
    const bridgeMap = new Map();
    for (let i = 0; i < n; i++) {
      for (let j = i + 3; j < n; j++) {
        const anti = (isHB(i, j) && isHB(j, i)) || (isHB(i - 1, j + 1) && isHB(j - 1, i + 1));
        if (anti) { bridgeMap.set(`${i},${j}`, 'a'); continue; }
        const par = (isHB(i, j) && isHB(j - 1, i + 1)) || (isHB(j, i) && isHB(i - 1, j + 1));
        if (par) bridgeMap.set(`${i},${j}`, 'p');
      }
    }
    const visited = new Set();
    bridgeMap.forEach((type, key) => {
      if (visited.has(key)) return;
      const [bi, bj] = key.split(',').map(Number);
      const di = 1, dj = type === 'a' ? -1 : 1;
      let si = bi, sj = bj;
      while (bridgeMap.get(`${si - di},${sj - dj}`) === type) { si -= di; sj -= dj; }
      const run = [];
      let ii = si, jj = sj;
      while (bridgeMap.get(`${ii},${jj}`) === type) {
        visited.add(`${ii},${jj}`);
        run.push([ii, jj]);
        ii += di; jj += dj;
      }
      const ch = run.length >= 2 ? 'E' : 'B';
      run.forEach(([ri, rj]) => { setSS(ri, ch); setSS(rj, ch); });
    });

    return letter;
  };
};

/* -------- trajectory pass -------- */

export const computeSecondaryStructure = async (topo, frames, opts, onProgress) => {
  const bb = prepareBackbone(topo.atoms);
  if (bb.length === 0) throw new Error('No protein residues with complete backbone (N, CA, C, O) found — DSSP needs a protein topology (a CHARMM-GUI step*.gro works).');
  const assign = buildAssigner(bb);
  const n = bb.length;
  const labels = bb.map((r) => `${r.resname}${r.resnr}`);

  const stride = Math.max(1, opts.stride || 1);
  const startFrame = Math.max(0, opts.startFrame || 0);
  const dtPs = Number(opts.dtPs) || 0;
  const heatMax = opts.heatMaxFrames || 360;

  const series = [];
  const occ = bb.map(() => ({ H: 0, E: 0, other: 0 }));
  const allCodes = [];
  let fi = 0, used = 0;

  const iter = frames[Symbol.asyncIterator] ? frames : (async function* () { yield* frames; })();
  for await (const frame of iter) {
    const cur = fi++;
    if (cur < startFrame) continue;
    if ((cur - startFrame) % stride !== 0) continue;

    const letter = assign(frame.xyz, frame.box);
    const counts = { H: 0, B: 0, E: 0, G: 0, I: 0, T: 0, S: 0, C: 0 };
    const codes = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const ch = letter[i];
      counts[ch]++;
      codes[i] = SS_CODE_ORDER.indexOf(ch);
      if (ch === 'H' || ch === 'G' || ch === 'I') occ[i].H++;
      else if (ch === 'E' || ch === 'B') occ[i].E++;
      else occ[i].other++;
    }
    const alpha = +((100 * (counts.H + counts.G + counts.I)) / n).toFixed(2);
    const beta = +((100 * (counts.E + counts.B)) / n).toFixed(2);
    series.push({
      x: dtPs > 0 ? +(used * dtPs / 1000).toFixed(3) : used,
      counts, alpha, beta, coil: +(100 - alpha - beta).toFixed(2),
    });
    allCodes.push(codes);
    used++;

    if (opts.maxFrames && used >= opts.maxFrames) break;
    if (onProgress && used % 5 === 0) { onProgress({ done: used }); await new Promise((r) => setTimeout(r, 0)); }
  }

  if (used === 0) throw new Error('No frames analysed (check stride / start frame / trajectory).');

  const heatStride = Math.max(1, Math.ceil(allCodes.length / heatMax));
  const heat = {
    nRes: n,
    samples: allCodes.filter((_, i) => i % heatStride === 0),
    frameStride: heatStride,
    totalFrames: used,
  };

  const occupancy = labels.map((label, i) => ({
    label,
    alpha: +(100 * occ[i].H / used).toFixed(1),
    beta: +(100 * occ[i].E / used).toFixed(1),
    other: +(100 * occ[i].other / used).toFixed(1),
  }));

  return { nRes: n, labels, series, heat, occupancy, nFramesUsed: used, xUnit: dtPs > 0 ? 'ns' : 'frame' };
};