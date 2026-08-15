/* =========================================================================
   MDMembraneProfiles.js
   Two more Figures_CHD.pdf analysis types, computed fully in-browser:

   1) Deuterium order parameter |SCD| of C-H bonds ("Carbon number" plots).
      Equivalent of `gmx order`. General: any residue with C-H bonds
      (lipid acyl chains by default; sterols, peptides, ligands via the
      residue filter).
          SCD = <(3 cos^2(theta) - 1)/2>,  theta = C-H vs bilayer normal z
      averaged over hydrogens, molecules and frames; plotted as |SCD|.

   2) Electron density rho_e(z) and electrostatic potential across the
      membrane. Equivalent of `gmx density` + `gmx potential`:
      per frame, find the bilayer centre (median phosphate z), bin electron
      counts (atomic numbers) and partial charges along z, then solve
          d2V/dz2 = -rho_q / eps0
      by double integration (linear ramp removed, water baseline = 0).

   One combined frame pass computes everything at once.
   ========================================================================= */

const RE_LIPID = /^(POP|CHL|ERG|STIG|SITO|TOCL|FOS|PSM|DLIP|SELIP|ECLIP)/;

/* ------------------------- element / electrons ------------------------- */

const ELEMENT_Z = {
  H: 1, C: 6, N: 7, O: 8, F: 9, NA: 11, MG: 12, P: 15, S: 16,
  CL: 17, K: 19, CA: 20, MN: 25, FE: 26, ZN: 30, BR: 35, I: 53,
};

export const guessElement = (atomname, resname) => {
  const a = String(atomname || '').toUpperCase();
  const r = String(resname || '').toUpperCase();
  if (/^(SOL|TIP|WAT|HOH|SPC)/.test(r)) return a.charAt(0) === 'H' ? 'H' : 'O';
  if (/^(NA|SOD|SODIUM)$/.test(r) || /^(NA|SOD)$/.test(a)) return 'NA';
  if (/^(CLA|CL|CHLORIDE)$/.test(r) || /^(CL|CLA)$/.test(a)) return 'CL';
  if (/^(CAL|CA)$/.test(r) || /^CAL$/.test(a)) return 'CA';
  if (/^MG$/.test(r) || /^MG$/.test(a)) return 'MG';
  if (/^(POT|K)$/.test(r) || /^(POT|K)$/.test(a)) return 'K';
  if (/^ZN/.test(a)) return 'ZN';
  if (/^FE/.test(a)) return 'FE';
  const c = a.charAt(0);
  if ('CHNOPS'.includes(c)) return c;   // protein CA stays carbon, etc.
  return null;
};

/* ------------------- charge maps from GROMACS .itp/.top ----------------- */
/* Parses every [ atoms ] section:  nr type resnr resname atomname cgnr charge */

export const parseChargeMap = (texts) => {
  const map = new Map();
  (Array.isArray(texts) ? texts : [texts]).forEach((text) => {
    let inAtoms = false;
    String(text).split(/\r?\n/).forEach((raw) => {
      const line = raw.replace(/;.*$/, '').trim();
      if (!line || line.startsWith('#')) return;
      if (line.startsWith('[')) { inAtoms = /^\[\s*atoms\s*\]/i.test(line); return; }
      if (!inAtoms) return;
      const f = line.split(/\s+/);
      if (f.length >= 7 && /^\d+$/.test(f[0])) {
        const charge = parseFloat(f[6]);
        if (!isNaN(charge)) map.set(`${f[3]}-${f[4]}`, charge);
      }
    });
  });
  return map;
};

/* --------------------------- main computation --------------------------- */

export const computeOrderAndDensity = async (topo, frames, opts, chargeMap, onProgress) => {
  const { atoms } = topo;
  const n = atoms.length;
  const stride = Math.max(1, opts.stride || 1);
  const startFrame = Math.max(0, opts.startFrame || 0);
  const bin = opts.bin && opts.bin > 0 ? opts.bin : 0.02; // nm

  /* ---------- static per-atom tables ---------- */
  const elZ = new Float32Array(n);                      // electron count per atom
  const q = chargeMap ? new Float32Array(n) : null;     // partial charge per atom
  const missingChargeRes = new Set();
  atoms.forEach((a, i) => {
    const el = guessElement(a.atomname, a.resname);
    elZ[i] = el ? (ELEMENT_Z[el] || 0) : 0;
    if (q) {
      const key = `${a.resname}-${a.atomname}`;
      if (chargeMap.has(key)) q[i] = chargeMap.get(key);
      else { q[i] = 0; missingChargeRes.add(a.resname); }
    }
  });

  const pIdx = []; // phosphates -> per-frame bilayer centre
  atoms.forEach((a, i) => {
    if (RE_LIPID.test(a.resname) && guessElement(a.atomname, a.resname) === 'P') pIdx.push(i);
  });

  /* ---------- SCD: target residues, C-H pairs, groups ---------- */
  const resFilter = (opts.scdResidues || '').split(/[,;\s]+/).filter(Boolean).map((s) => s.toUpperCase());
  const wantRes = (resname) =>
    resFilter.length
      ? resFilter.some((r) => resname.toUpperCase().startsWith(r))
      : RE_LIPID.test(resname);

  const carbons = [], hydrogens = [];
  atoms.forEach((a, i) => {
    if (!wantRes(a.resname)) return;
    const el = guessElement(a.atomname, a.resname);
    if (el === 'C') carbons.push(i);
    else if (el === 'H') hydrogens.push(i);
  });

  const groupList = [];            // [{label, buckets:[{xLabel,xNum,sum,count}]}]
  const groupOf = new Map();
  const buckets = [];
  const carbonBucket = new Int32Array(n).fill(-1);
  carbons.forEach((ci) => {
    const a = atoms[ci];
    const m2 = /^C2(\d+)$/.exec(a.atomname);
    const m3 = /^C3(\d+)$/.exec(a.atomname);
    let key, xNum, xLabel;
    if (m2) { key = `${a.resname} sn-1`; xNum = parseInt(m2[1], 10); xLabel = `C2${m2[1]}`; }
    else if (m3) { key = `${a.resname} sn-2`; xNum = parseInt(m3[1], 10); xLabel = `C3${m3[1]}`; }
    else {
      key = a.resname;
      const md = /^C(\d+)/.exec(a.atomname);
      xNum = md ? parseInt(md[1], 10) : null;
      xLabel = a.atomname;
    }
    if (!groupOf.has(key)) { groupOf.set(key, groupList.length); groupList.push({ label: key, buckets: [] }); }
    const g = groupList[groupOf.get(key)];
    let b = g.buckets.find((bb) => bb.xLabel === xLabel);
    if (!b) { b = { xLabel, xNum, sum: 0, count: 0 }; g.buckets.push(b); buckets.push(b); }
    carbonBucket[ci] = buckets.length - 1;
  });

  // C-H bond detection from the topology coordinates (cell list, 0.08–0.16 nm)
  const pairsC = [], pairsH = [], pairBucket = [];
  {
    const bx = topo.box;
    const cs = 0.2;
    const gx = Math.max(1, Math.floor(Math.abs(bx[0]) / cs));
    const gy = Math.max(1, Math.floor(Math.abs(bx[4]) / cs));
    const gz = Math.max(1, Math.floor(Math.abs(bx[8]) / cs));
    const heads = new Int32Array(gx * gy * gz).fill(-1);
    const nxt = new Int32Array(carbons.length);
    const wrapN = (v, m) => ((v % m) + m) % m;
    carbons.forEach((ci, k) => {
      const cx = wrapN(Math.floor(atoms[ci].x / cs), gx);
      const cy = wrapN(Math.floor(atoms[ci].y / cs), gy);
      const cz = wrapN(Math.floor(atoms[ci].z / cs), gz);
      const cell = (cz * gy + cy) * gx + cx;
      nxt[k] = heads[cell]; heads[cell] = k;
    });
    hydrogens.forEach((hi) => {
      const hx = atoms[hi].x, hy = atoms[hi].y, hz = atoms[hi].z;
      const cx0 = Math.floor(hx / cs), cy0 = Math.floor(hy / cs), cz0 = Math.floor(hz / cs);
      for (let u = -1; u <= 1; u++) for (let v = -1; v <= 1; v++) for (let w = -1; w <= 1; w++) {
        const cell = (wrapN(cz0 + w, gz) * gy + wrapN(cy0 + v, gy)) * gx + wrapN(cx0 + u, gx);
        for (let k = heads[cell]; k !== -1; k = nxt[k]) {
          const ci = carbons[k];
          let dx = atoms[ci].x - hx, dy = atoms[ci].y - hy, dz = atoms[ci].z - hz;
          const sz = Math.round(dz / bx[8]); dz -= sz * bx[8]; dy -= sz * bx[7]; dx -= sz * bx[6];
          const sy = Math.round(dy / bx[4]); dy -= sy * bx[4]; dx -= sy * bx[3];
          const sx = Math.round(dx / bx[0]); dx -= sx * bx[0];
          const r2 = dx * dx + dy * dy + dz * dz;
          if (r2 >= 0.0064 && r2 <= 0.0256) {   // 0.08–0.16 nm: C-H bond
            pairsC.push(ci); pairsH.push(hi); pairBucket.push(carbonBucket[ci]);
          }
        }
      }
    });
  }

  /* ---------- single frame pass ---------- */
  let fi = 0, used = 0, nb = 0, lzSum = 0;
  let eHist = null, qHist = null, volHist = null;

  const iter = frames[Symbol.asyncIterator] ? frames : (async function* () { yield* frames; })();
  for await (const frame of iter) {
    const cur = fi++;
    if (cur < startFrame) continue;
    if ((cur - startFrame) % stride !== 0) continue;
    const { xyz, box } = frame;
    const Lz = box[8];
    const area = Math.abs(box[0] * box[4]);

    if (nb === 0) {
      nb = Math.max(8, Math.round(Lz / bin));
      eHist = new Float64Array(nb);
      qHist = q ? new Float64Array(nb) : null;
      volHist = new Float64Array(nb);
    }
    const binW = Lz / nb;

    // bilayer centre: median phosphate z (or box centre)
    let zc = Lz / 2;
    if (opts.centerMode !== 'box' && pIdx.length) {
      const zs = pIdx.map((i) => xyz[3 * i + 2]).sort((a, b) => a - b);
      zc = zs[Math.floor(zs.length / 2)];
    }

    // density binning
    for (let i = 0; i < n; i++) {
      let dz = xyz[3 * i + 2] - zc;
      dz -= Lz * Math.round(dz / Lz);
      const b = Math.floor((dz + Lz / 2) / binW);
      if (b < 0 || b >= nb) continue;
      eHist[b] += elZ[i];
      if (qHist) qHist[b] += q[i];
      volHist[b] += area * binW;
    }

    // SCD accumulation (minimum-image C-H vectors)
    for (let p = 0; p < pairsC.length; p++) {
      const c3 = 3 * pairsC[p], h3 = 3 * pairsH[p];
      let dx = xyz[h3] - xyz[c3], dy = xyz[h3 + 1] - xyz[c3 + 1], dz = xyz[h3 + 2] - xyz[c3 + 2];
      const sz = Math.round(dz / box[8]); dz -= sz * box[8]; dy -= sz * box[7]; dx -= sz * box[6];
      const sy = Math.round(dy / box[4]); dy -= sy * box[4]; dx -= sy * box[3];
      const sx = Math.round(dx / box[0]); dx -= sx * box[0];
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 < 1e-6 || r2 > 0.04) continue;
      const uz = dz / Math.sqrt(r2);
      const bkt = buckets[pairBucket[p]];
      bkt.sum += (3 * uz * uz - 1) / 2;
      bkt.count++;
    }

    lzSum += Lz; used++;
    if (opts.maxFrames && used >= opts.maxFrames) break;
    if (onProgress && used % 5 === 0) { onProgress({ done: used }); await new Promise((r) => setTimeout(r, 0)); }
  }

  if (used === 0) throw new Error('No frames analysed (check stride / start frame / trajectory).');

  /* ---------- profiles ---------- */
  const LzAvg = lzSum / used;
  const avgBinW = LzAvg / nb;
  const zAxis = [], rhoE = [], rhoQ = [];
  for (let b = 0; b < nb; b++) {
    zAxis.push(+(-LzAvg / 2 + (b + 0.5) * avgBinW).toFixed(3));
    rhoE.push(volHist[b] > 0 ? +(eHist[b] / volHist[b]).toFixed(2) : 0);
    if (qHist) rhoQ.push(volHist[b] > 0 ? +(qHist[b] / volHist[b]).toFixed(4) : 0);
  }

  let potential = null;
  if (qHist) {
    const EPS0 = 8.8541878128e-12;
    const CONV = 1.602176634e-19 / 1e-27;   // e/nm^3 -> C/m^3
    const dzm = avgBinW * 1e-9;
    let E = 0, V = 0;
    const raw = [];
    for (let b = 0; b < nb; b++) {
      raw.push(V);
      E += -((qHist[b] / (volHist[b] || 1)) * CONV) / EPS0 * dzm;
      V += E * dzm;
    }
    const slope = (raw[nb - 1] - raw[0]) / ((nb - 1) * dzm);   // periodic closure
    potential = raw.map((v, b) => v - raw[0] - slope * b * dzm);
    const edge = Math.max(1, Math.floor(nb * 0.05));            // water baseline = 0
    let base = 0;
    for (let b = 0; b < edge; b++) base += potential[b] + potential[nb - 1 - b];
    base /= 2 * edge;
    potential = potential.map((v) => +(v - base).toFixed(5));
  }

  const scdGroups = groupList.map((g) => ({
    label: g.label,
    carbons: g.buckets
      .filter((b) => b.count > 0)
      .map((b) => ({
        x: b.xLabel,
        xNum: b.xNum,
        scd: opts.signedSCD ? +(b.sum / b.count).toFixed(4) : +Math.abs(b.sum / b.count).toFixed(4),
      })),
  }));

  return {
    nFramesUsed: used,
    scdGroups,
    density: { z: zAxis, rhoE, rhoQ, potential, binNm: +avgBinW.toFixed(4), missingChargeResidues: [...missingChargeRes] },
  };
};