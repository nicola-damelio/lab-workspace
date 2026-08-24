/* =========================================================================
   MDMembraneContacts.js
   In-browser port of from_gro_to_rdf-new-colors-r6.awk (option="inter"):
   frequency of short distances between a molecule and a phospholipid
   membrane, plotted like page 8 of Figures_CHD.pdf.

   awk / GROMACS / gnuplot pipeline         browser equivalent
   ------------------------------------------------------------------------
   parse step7.gro                      ->  parseTopology()
   lipid vs molecule detection          ->  detectMoleculeResidues()
   gmx make_ndx selection rules         ->  selectContactAtoms()
   index groups "r RES & a ATOM"        ->  buildContactGroups()
   gmx rdf -bin 0.005 (per ref/sel)     ->  computeContactRDF()
   awk: 0.23<r<0.36, keep max value     ->  peak g(r) inside the window
   gnuplot linespoints                  ->  MDContactChart (recharts)
   ========================================================================= */
import { resolveFrameSource, readTrrFrames } from './MDTrajectoryFrames';
export const CONTACT_DEFAULTS = {
  mode: 'polar',          // 'polar' | 'vdW' | 'all'   (awk: vdW="no" / "yes")
  metric: 'peakRDF',      // 'peakRDF' (awk behaviour) | 'contactFreq'
  rMin: 0.23,             // nm  (awk: $1 > 0.23)
  rMax: 0.36,             // nm  (awk: $1 < 0.36)
  bin: 0.005,             // nm  (gmx rdf -bin 0.005)
  stride: 1,              // analyse every Nth frame
  startFrame: 0,          // skip initial frames (like gmx rdf -b)
  maxFrames: 0,           // 0 = all
  molResidues: '',        // override auto-detection, e.g. "CHD,LIG"
  includeIons: false,     // awk: include_ions
  aggregate: 'max',       // run-comparison mode: max|mean|sum over molecule atoms
  xAxis: 'lipid',         // 'lipid' = membrane atoms on the X axis (app default),
                          // 'peptide' = peptide atoms on the X axis, one curve per
                          // membrane atom, coloured like from_gro_to_rdf*.awk (inter)
};

const RE_LIPID  = /^(POP|CHL|ERG|STIG|SITO|TOCL|FOS|PSM|DLIP|SELIP|ECLIP)/;
const RE_STEROL = /^(CHL|ERG|STIG|SITO)/;
const RE_WATER  = /^(TIP|SOL)/;
const RE_ION    = /^(NA|SOD|CAL|MG|POT|CLA)$/;
const normRes = (r) => (r === 'CHL' ? 'CHL1' : r); // awk: gsub("CHL","CHL1")

// r6 palette from the awk script (colors[1..50])
export const AWK_PALETTE = [
  '#FEC79B','#FDA169','#FB7B43','#FA3F06','#D72604','#B31203','#900401','#770107',
  '#FEEB9C','#FCDB6A','#F9CB45','#f5b309','#D29306','#B07604','#8E5B02','#754701',
  '#C4FE99','#9BFC66','#74FA40','#35f703','#1DD402','#0BB101','#008F03','#00760B',
  '#9DF1FF','#6DE1FF','#48CDFF','#0caeff','#0887DB','#0665B7','#034893','#02337A',
  '#FEA9D9','#FE7FD1','#FD5ED4','#fc2ada','#D81ECC','#B115B5','#820D92','#600878',
  '#f9d7c7','#f8c3b9','#eaadb6','#c59eab','#8f8f9c','#3f9e91','#265e57','#59decc',
  '#5eebd8','#4fc4b5',
];

/* ------------------------- topology parsing -------------------------- */

const parseGroTopology = (text) => {
  const lines = text.split(/\r?\n/);
  const natoms = parseInt(lines[1], 10) || 0;
  const atoms = [];
  for (let i = 0; i < natoms; i++) {
    const l = lines[2 + i];
    if (!l || l.length < 44) continue;
    atoms.push({
      resnr: parseInt(l.substring(0, 5).trim(), 10),
      resname: normRes(l.substring(5, 10).trim()),
      atomname: l.substring(10, 15).trim(),
      x: parseFloat(l.substring(20, 28)),
      y: parseFloat(l.substring(28, 36)),
      z: parseFloat(l.substring(36, 44)),
    });
  }
  const box = (lines[2 + natoms] || '').trim().split(/\s+/).map(Number).filter((n) => !isNaN(n));
  const b = box.length >= 9 ? box.slice(0, 9)
    : box.length >= 3 ? [box[0], 0, 0, 0, box[1], 0, 0, 0, box[2]] : null;
  return { atoms, box: b };
};

const parsePdbTopology = (text) => {
  const atoms = [];
  let box = null;
  text.split(/\r?\n/).forEach((l) => {
    if (l.startsWith('CRYST1')) {
      box = [
        parseFloat(l.substring(6, 15)) / 10, 0, 0,
        0, parseFloat(l.substring(15, 24)) / 10, 0,
        0, 0, parseFloat(l.substring(24, 33)) / 10,
      ];
    } else if (l.startsWith('ATOM') || l.startsWith('HETATM')) {
      atoms.push({
        resnr: parseInt(l.substring(22, 26), 10),
        resname: normRes(l.substring(17, 21).trim()),
        atomname: l.substring(12, 16).trim(),
        x: parseFloat(l.substring(30, 38)) / 10,
        y: parseFloat(l.substring(38, 46)) / 10,
        z: parseFloat(l.substring(46, 54)) / 10,
      });
    }
  });
  return { atoms, box };
};

export const parseTopology = (text) => {
  const t = String(text || '').trim();
  if (/^(ATOM|HETATM)/m.test(t) || /^CRYST1/m.test(t)) return parsePdbTopology(t);
  return parseGroTopology(t);
};

/* ------------------- selection rules (ported from awk) ---------------- */

export const detectMoleculeResidues = (atoms, override = '') => {
  if (override && override.trim()) {
    return new Set(override.split(/[,;\s]+/).filter(Boolean).map(normRes));
  }
  const names = new Set();
  atoms.forEach((a) => {
    const r = a.resname;
    if (!RE_LIPID.test(r) && !RE_WATER.test(r) && !RE_ION.test(r)) names.add(r);
  });
  return names;
};

export const selectContactAtoms = (atoms, opts, molRes) => {
  const { mode, includeIons } = opts;
  const wantPolar = mode === 'polar' || mode === 'all';
  const wantVdw = mode === 'vdW' || mode === 'all';
  const sel = [];
  atoms.forEach((a, i) => {
    const { resname: res, atomname: name } = a;
    const first = name.charAt(0);
    let ok = false;

    if (wantPolar) {
      // awk: O/N/S heavy atoms, name length < 5, never water,
      // ions only when include_ions="yes"
      if (!RE_WATER.test(res) && first !== 'H' && first !== 'D' && name.length < 5 &&
          (first === 'O' || first === 'N' || first === 'S') &&
          (!RE_ION.test(res) || includeIons)) ok = true;
    }

    if (!ok && wantVdw) {
      if (first === 'C' && res !== 'CLA') {
        if (RE_STEROL.test(res) || res === 'LIG') {
          ok = true;                                          // whole sterol/ligand ring system
        } else if (RE_LIPID.test(res)) {
          // phospholipid acyl chains (C2*, C3*), TOCL CA/CB/CC/CD;
          // awk excludes C1/C2/C3/C11..C16, CA (non-GLY), C, CT
          if (name === 'C' || name === 'CT') ok = false;
          else if (name === 'CA' && res !== 'GLY') ok = false;
          else if (/^C1$|^C2$|^C3$|^C1[1-6]$/.test(name)) ok = false;
          else if (name.startsWith('C2') || name.startsWith('C3')) ok = true;
          else if (res === 'TOCL' && /^C[ABCD]/.test(name)) ok = true;
        } else if (molRes.has(res)) {
          // molecule side (vdW_option="all" in the awk): all carbons
          // except backbone C / CT / CA (CA only allowed for GLY)
          if (name === 'C' || name === 'CT') ok = false;
          else if (name === 'CA' && res !== 'GLY') ok = false;
          else ok = true;
        }
      }
    }
    if (ok) sel.push(i);
  });
  return sel;
};

export const buildContactGroups = (atoms, selIdx, molRes) => {
  const membrane = new Map(); // "RES-ATOM"      -> averaged over all lipid copies
  const molecule = new Map(); // "RESn-ATOM"     -> each molecule atom separate
  selIdx.forEach((i) => {
    const a = atoms[i];
    const key = molRes.has(a.resname)
      ? `${a.resname}${a.resnr}-${a.atomname}`
      : `${a.resname}-${a.atomname}`;
    const target = molRes.has(a.resname) ? molecule : membrane;
    if (!target.has(key)) {
      target.set(key, { label: key, resname: a.resname, atomname: a.atomname, atomIdx: [] });
    }
    target.get(key).atomIdx.push(i);
  });
  return { membrane: [...membrane.values()], molecule: [...molecule.values()] };
};

/* -------- x-axis ordering (ported awk reorder for vdW plots) ---------- */

// awk's explicit CHL1/sterol carbon ordering offsets
const STEROL_OFFSET = {
  C1: -13, C2: -17, C3: 0, C4: 1, C5: 1, C6: 4, C7: 4, C8: 5, C9: -5, C10: -10,
  C11: -2, C12: 1, C13: 5, C14: 6, C15: 7, C16: 9, C17: 9, C18: 5, C19: -10,
  C20: 0, C21: 0, C22: 0, C23: 0, C24: 0, C25: 1, C26: 1, C27: 1, C28: -3,
};

export const orderMembraneGroups = (groups, applyVdwOrder) => groups
  .map((g, i) => {
    let off = 0;
    if (applyVdwOrder) {
      if (RE_STEROL.test(g.resname)) {
        off = STEROL_OFFSET[g.atomname] ?? 0;
      } else {
        const m2 = /^C2(\d+)$/.exec(g.atomname);
        const m3 = /^C3(\d+)$/.exec(g.atomname);
        if (m2 && parseInt(m2[1], 10) > 2) off = -2;                      // awk
        if (m3 && parseInt(m3[1], 10) < 3 && g.resname !== 'FOS') off = 16; // awk
      }
    }
    return { g, key: i + off, i };
  })
  .sort((a, b) => (a.key - b.key) || (a.i - b.i))
  .map((x) => x.g);


/* ----------------------- trajectory readers ---------------------------
   Frame decoding now lives in MDTrajectoryFrames.js:
   - TRR parsed natively (uncompressed XDR)
   - XTC / DCD decoded through the NGL library (already loaded by
     MDMoleculeViewer.jsx; its CDN build bundles the official GROMACS
     xdrfile / 3dfcoord decoder)
------------------------------------------------------------------------ */
export { resolveFrameSource, readTrrFrames };

// Synthetic frames so the whole pipeline + plot can be tested without a trajectory
export const demoFrames = (topo, n = 40, jitter = 0.03) => {
  const { atoms, box } = topo;
  const xyz0 = new Float32Array(atoms.length * 3);
  atoms.forEach((a, i) => { xyz0[3 * i] = a.x; xyz0[3 * i + 1] = a.y; xyz0[3 * i + 2] = a.z; });
  const bx = box || [8, 0, 0, 0, 8, 0, 0, 0, 8];
  return (async function* () {
    for (let f = 0; f < n; f++) {
      const xyz = new Float32Array(xyz0);
      for (let i = 0; i < xyz.length; i++) xyz[i] += (Math.random() - 0.5) * 2 * jitter;
      yield { xyz, box: bx };
    }
  })();
};

/* ------------------------- core computation --------------------------- */

const det3 = (b) =>
  b[0] * (b[4] * b[8] - b[5] * b[7]) -
  b[1] * (b[3] * b[8] - b[5] * b[6]) +
  b[2] * (b[3] * b[7] - b[4] * b[6]);

export const computeContactRDF = async (topo, frames, opts, onProgress) => {
  const { atoms } = topo;
  const molRes = detectMoleculeResidues(atoms, opts.molResidues);
  const selIdx = selectContactAtoms(atoms, opts, molRes);
  const { membrane, molecule } = buildContactGroups(atoms, selIdx, molRes);
  if (membrane.length === 0) throw new Error('No membrane lipid atoms found in the topology (expected POP*/CHL*/ERG*/… residues).');
  if (molecule.length === 0) throw new Error('No molecule atoms selected. Set "Molecule residue(s)" manually (e.g. CHD).');
  const memGroups = orderMembraneGroups(membrane, opts.mode !== 'polar');
  const molGroups = molecule;

  const nMem = memGroups.length, nMol = molGroups.length;
  const nBins = Math.max(1, Math.ceil((opts.rMax - opts.rMin) / opts.bin));
  const r2Min = opts.rMin * opts.rMin, r2Max = opts.rMax * opts.rMax;

  // flat membrane-atom arrays
  const nMemAtoms = memGroups.reduce((s, g) => s + g.atomIdx.length, 0);
  const memAtomIdx = new Int32Array(nMemAtoms);
  const memAtomGrp = new Int32Array(nMemAtoms);
  { let k = 0; memGroups.forEach((g, gi) => g.atomIdx.forEach((ai) => { memAtomIdx[k] = ai; memAtomGrp[k] = gi; k++; })); }

  const counts = new Float64Array(nMem * nMol * nBins);
  const frameContact = new Float64Array(nMem * nMol);
  const pairStamp = new Int32Array(nMem * nMol).fill(-1);
  const heads = { arr: null };
  const next = new Int32Array(nMemAtoms);

  let nFramesUsed = 0, sumInvVol = 0, fi = 0;
  const yieldUI = () => new Promise((r) => setTimeout(r, 0));

  const iter = frames[Symbol.asyncIterator] ? frames : (async function* () { yield* frames; })();
  for await (const frame of iter) {
    const cur = fi++;
    if (cur < opts.startFrame) continue;
    if ((cur - opts.startFrame) % opts.stride !== 0) continue;
    const { xyz, box } = frame;
    const b0 = box[0], b3 = box[3], b4 = box[4], b6 = box[6], b7 = box[7], b8 = box[8];

    // ---- cell list over membrane atoms (cell size = rMax) ----
    const cs = opts.rMax;
    const nx = Math.max(1, Math.floor(Math.abs(b0) / cs));
    const ny = Math.max(1, Math.floor(Math.abs(b4) / cs));
    const nz = Math.max(1, Math.floor(Math.abs(b8) / cs));
    if (!heads.arr || heads.arr.length !== nx * ny * nz) heads.arr = new Int32Array(nx * ny * nz);
    heads.arr.fill(-1);
    for (let k = 0; k < nMemAtoms; k++) {
      const ai3 = 3 * memAtomIdx[k];
      let cx = Math.floor(xyz[ai3] / cs) % nx; if (cx < 0) cx += nx;
      let cy = Math.floor(xyz[ai3 + 1] / cs) % ny; if (cy < 0) cy += ny;
      let cz = Math.floor(xyz[ai3 + 2] / cs) % nz; if (cz < 0) cz += nz;
      const cell = (cz * ny + cy) * nx + cx;
      next[k] = heads.arr[cell]; heads.arr[cell] = k;
    }

    // ---- query: every molecule atom vs neighbouring cells ----
    molGroups.forEach((mg, mi) => {
      mg.atomIdx.forEach((ai) => {
        const ai3 = 3 * ai;
        const px = xyz[ai3], py = xyz[ai3 + 1], pz = xyz[ai3 + 2];
        const cx0 = Math.floor(px / cs), cy0 = Math.floor(py / cs), cz0 = Math.floor(pz / cs);
        for (let dzc = -1; dzc <= 1; dzc++) {
          let cz = (cz0 + dzc) % nz; if (cz < 0) cz += nz;
          for (let dyc = -1; dyc <= 1; dyc++) {
            let cy = (cy0 + dyc) % ny; if (cy < 0) cy += ny;
            for (let dxc = -1; dxc <= 1; dxc++) {
              let cx = (cx0 + dxc) % nx; if (cx < 0) cx += nx;
              for (let k = heads.arr[(cz * ny + cy) * nx + cx]; k !== -1; k = next[k]) {
                const bi3 = 3 * memAtomIdx[k];
                // minimum image (reduced triclinic box, GROMACS convention)
                let dx = xyz[bi3] - px, dy = xyz[bi3 + 1] - py, dz = xyz[bi3 + 2] - pz;
                const sz = Math.round(dz / b8); dz -= sz * b8; dy -= sz * b7; dx -= sz * b6;
                const sy = Math.round(dy / b4); dy -= sy * b4; dx -= sy * b3;
                const sx = Math.round(dx / b0); dx -= sx * b0;
                const r2 = dx * dx + dy * dy + dz * dz;
                if (r2 >= r2Min && r2 < r2Max) {
                  const r = Math.sqrt(r2);
                  const bin = Math.min(nBins - 1, Math.floor((r - opts.rMin) / opts.bin));
                  const pi = memAtomGrp[k] * nMol + mi;
                  counts[pi * nBins + bin]++;
                  if (pairStamp[pi] !== nFramesUsed) { pairStamp[pi] = nFramesUsed; frameContact[pi]++; }
                }
              }
            }
          }
        }
      });
    });

    nFramesUsed++;
    sumInvVol += 1 / Math.abs(det3(box));
    if (opts.maxFrames && nFramesUsed >= opts.maxFrames) break;
    if (onProgress && nFramesUsed % 5 === 0) { onProgress({ done: nFramesUsed }); await yieldUI(); }
  }

  if (nFramesUsed === 0) throw new Error('No frames were analysed (check stride / startFrame / trajectory).');

  // ---- normalise like gmx rdf and extract the awk window maximum ----
  const avgInvV = sumInvVol / nFramesUsed;
  const pairs = [];
  memGroups.forEach((g, gi) => {
    molGroups.forEach((mg, mi) => {
      const nRef = g.atomIdx.length;
      const rhoSel = mg.atomIdx.length * avgInvV;         // number density of sel group
      let peak = 0, peakR = null;
      for (let b = 0; b < nBins; b++) {
        const r1 = opts.rMin + b * opts.bin, r2 = r1 + opts.bin;
        const shell = (4 / 3) * Math.PI * (r2 ** 3 - r1 ** 3);
        const gval = counts[(gi * nMol + mi) * nBins + b] / (nRef * nFramesUsed * rhoSel * shell);
        if (gval > peak) { peak = gval; peakR = r1 + opts.bin / 2; }
      }
      pairs.push({
        mem: g.label, mol: mg.label,
        peakRDF: peak, peakR,
        contactFreq: frameContact[gi * nMol + mi] / nFramesUsed,
      });
    });
  });

  return {
    nFramesUsed,
    memLabels: memGroups.map((g) => g.label),
    molLabels: molGroups.map((g) => g.label),
    molResidues: [...molRes],
    pairs,
  };
};

/* ----------------------------------------------------------------------------
   awk from_gro_to_rdf*.awk colour / symbol tables (option="inter").
   In the awk script each reference group is a MEMBRANE atom and the X axis
   shows the SELECTION (peptide) atoms. The "polar" colours are gnuplot line
   types per lipid type; the "vdW" colours are the explicit hex gradients per
   carbon position. pt_group maps to point symbols (approximated here).
   -------------------------------------------------------------------------- */

// gnuplot "classic" default line colours for lt 1..8 (used by the awk polar case)
const GPLT = {
  1: '#ff0000', 2: '#0000ff', 3: '#00c000', 4: '#ff00ff',
  5: '#00c0c0', 6: '#c00000', 7: '#c0c000', 8: '#0000c0',
};

export const LIPID_POLAR_LT = {
  POPC: 8, POPE: 2, DLIPE: 2, DLIP: 2, POPG: 1, POPS: 5, POPI: 3,
  TOCL: 7, TOCL2: 7, FOS: 6, FOS12: 6, CHL: 7, CHL1: 7,
  STIG: 2, SITO: 3, ERG: 4, PSM: 6, LIG: 1,
};

// polar mode: colour of a membrane atom label, by lipid type (awk lt_group)
export const lipidPolarColor = (label) => {
  const res = String(label || '').split('-')[0].toUpperCase();
  const lt = LIPID_POLAR_LT[res];
  return lt ? GPLT[lt] : null;
};

// vdW mode: explicit hex gradients from the awk (per acyl carbon position)
const VDW_C3 = { 1:'#b3ffb3', 2:'#aadc32', 3:'#09ad00', 4:'#00ad14', 5:'#00ad31', 6:'#00ad4e', 7:'#00ad6b', 8:'#00ad88', 9:'#00ada4', 10:'#0099ad', 11:'#007cad', 12:'#0060ad', 13:'#0042ad', 14:'#0025ad', 15:'#000066', 16:'#000033' };
const VDW_C2 = { 1:'#FACC27', 2:'#F8BD24', 3:'#F7AF21', 4:'#F5A01F', 5:'#F4911C', 6:'#F28319', 7:'#F17416', 8:'#EF6613', 9:'#EE5710', 10:'#EC480E', 11:'#EB3A0B', 12:'#E92B08', 13:'#E81D05', 14:'#E60E02', 15:'#E50000', 16:'#cc0000', 17:'#990000', 18:'#660000' };
const VDW_PINK = { 1:'#ffe6ff', 2:'#ffccff', 3:'#ffb3ff', 4:'#ff99ff', 5:'#ff80ff', 6:'#ff66ff', 7:'#ff4dff', 8:'#ff33ff', 9:'#ff1aff', 10:'#ff00ff', 11:'#e600e6', 12:'#cc00cc', 13:'#b300b3', 14:'#990099', 15:'#800080', 16:'#660066', 17:'#4d004d', 18:'#330033' };
const VDW_STEROL = { 1:'#eeccff', 2:'#f7e6ff', 3:'#f2e6ff', 4:'#e6ccff', 5:'#d9b3ff', 6:'#d580ff', 7:'#bf80ff', 8:'#c44dff', 9:'#b366ff', 10:'#dd99ff', 11:'#c44dff', 12:'#a64dff', 13:'#bb33ff', 14:'#c44dff', 15:'#9933ff', 16:'#8c1aff', 17:'#b31aff', 18:'#a64dff', 19:'#cc99ff', 20:'#aa00ff', 21:'#9900e6', 22:'#7300e6', 23:'#8800cc', 24:'#7700b3', 25:'#660099', 26:'#550080', 27:'#440066', 28:'#4d0099' };

export const getVdwCarbonColor = (label) => {
  const [res, atm] = String(label || '').split('-');
  const resU = (res || '').toUpperCase();
  const m = /^C([ABCD]?)(\d+)$/.exec(atm || '');
  if (!m) return null;
  const n = parseInt(m[2], 10);
  if (m[1] === '3') return VDW_C3[n] || null;
  if (m[1] === '2') return VDW_C2[n] || null;
  if (/^(ERG|SITO|CHL|CHL1|STIG|PSM)/.test(resU)) return VDW_STEROL[n] || null;
  if ((/^TOCL/.test(resU) && /^C[ABCD]/.test(atm || '')) || (/LIP/.test(resU) && /^C\d/.test(atm || ''))) return VDW_PINK[n] || null;
  return null;
};

// polar mode point symbols (awk pt_group → shape key used by the chart)
export const getLipidPolarSymbol = (label) => {
  const [res, atm] = String(label || '').split('-');
  const u = String(label || '').toUpperCase();
  if (/^TOCL/.test(u)) {
    if (/(OP12|OP32)$/.test(u)) return 'triangle';
    if (/(OP11|OP31)$/.test(u)) return 'cross';
    if (/(OP13|OP33)$/.test(u)) return 'diamond';
    if (/(OP14|OP34)$/.test(u)) return 'triangle-down';
    if (/(O13|O33)$/.test(u)) return 'square';
    if (/(OB1|OD1)$/.test(u)) return 'star';
    if (/(O12|O32)$/.test(u)) return 'circle';
    if (/(OA1|OC1)$/.test(u)) return 'hexagon';
    return 'circle';
  }
  if (/^POPI/.test(u)) {
    const m = { O2: 'cross', O3: 'square', O4: 'diamond', O5: 'star', O6: 'triangle' };
    return m[atm] || 'circle';
  }
  if (atm === 'O3' && /^(CHL|CHL1|STIG|SITO|ERG|PSM)/.test(String(res || '').toUpperCase())) return 'square';
  if (atm === 'N') return 'triangle';
  if (atm === 'O11' || atm === 'O21') return 'cross';
  if (atm === 'O12' || atm === 'O22') return 'square';
  if (atm === 'O13' || atm === 'O31' || atm === 'OC2') return 'diamond';
  if (atm === 'O14' || atm === 'O32' || atm === 'OC3') return 'triangle';
  if (atm === 'O13A') return 'star';
  if (atm === 'O13B') return 'hexagon';
  return 'circle';
};

// unified per-series style for a membrane atom label, used when the X axis
// shows the peptide atoms (awk option="inter")
export const contactSeriesStyle = (label, mode) => {
  const color = mode === 'vdW'
    ? getVdwCarbonColor(label)
    : lipidPolarColor(label);
  const symbol = mode === 'vdW' ? 'diamond' : getLipidPolarSymbol(label);
  return { color: color || null, symbol };
};