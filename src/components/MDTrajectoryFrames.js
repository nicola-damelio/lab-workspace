/* =========================================================================
   MDTrajectoryFrames.js
   Frame providers for the membrane-contact analysis (MDMembraneContacts.js).

   - .trr       : parsed natively here (uncompressed XDR)
   - .xtc/.dcd  : decoded through the NGL library (loaded via src/utils/ngl.js,
                  which also powers the 3D viewers). NGL's dist build bundles
                  the official GROMACS xdrfile / 3dfcoord decoder, so XTC
                  compression is handled by proven code, not a re-implementation.

   Every provider yields { xyz: Float32Array(3N) in nm, box: 9 floats (nm) }
   in topology atom order.
   ========================================================================= */

import { ensureNGL } from '../utils/ngl';

/* ------------------------------ TRR reader ------------------------------ */

export async function* readTrrFrames(file, onProgress) {
  const ab = await file.arrayBuffer();
  const dv = new DataView(ab);
  let off = 0, frameIdx = 0;
  const ri = () => { const v = dv.getInt32(off); off += 4; return v; };
  while (off + 84 <= ab.byteLength) {
    const magic = ri();
    if (magic !== 1995) throw new Error(`TRR: bad magic at frame ${frameIdx}`);
    const slen = ri(); off += slen;                        // version string (padded)
    ri();                                                  // ir_size
    const e_size = ri(), box_size = ri(), vir_size = ri(), pres_size = ri(),
          top_size = ri(), sym_size = ri(), x_size = ri(),
          v_size = ri(), f_size = ri();
    const natoms = ri(); ri(); ri();                       // step, nre
    const dbl = (box_size / 9) === 8;
    const rn = dbl
      ? () => { const v = dv.getFloat64(off); off += 8; return v; }
      : () => { const v = dv.getFloat32(off); off += 4; return v; };
    rn(); rn();                                            // time, lambda
    off += e_size;
    const box = []; for (let i = 0; i < 9; i++) box.push(rn());
    off += vir_size + pres_size + top_size + sym_size;
    let xyz = null;
    if (x_size > 0) {
      xyz = new Float32Array(natoms * 3);
      for (let i = 0; i < natoms * 3; i++) xyz[i] = rn();
    }
    off += v_size + f_size;
    frameIdx++;
    if (xyz) {
      yield { xyz, box };
      if (onProgress && (frameIdx % 50 === 0)) onProgress(frameIdx);
    }
  }
};

/* --------------------- NGL-backed XTC / DCD reader ---------------------- */

// NGL 2.4's autoLoad() parses trajectory files into a "Frames" object
// ({ coordinates:[Float32Array…], boxes:[…], times:[…] }) WITHOUT needing a
// Stage / WebGL context. The topology is already parsed by the app
// (parseTopology → atoms in nm), so we only need autoLoad + unit detection.
const nglTrajectoryFrames = async (file, ext, topoAtoms, topoBoxNm, onStatus, maxFrames = 0) => {
  const NGL = await ensureNGL();
  const natoms = Array.isArray(topoAtoms) ? topoAtoms.length : 0;
  if (!natoms) throw new Error('No topology atoms available to anchor the trajectory.');

  onStatus?.('NGL: parsing trajectory frames…');
  let framesObj = null;
  try {
    framesObj = await NGL.autoLoad(file, { ext });
  } catch (e) {
    throw new Error(`NGL could not parse the trajectory: ${e.message}`);
  }
  if (!framesObj || !Array.isArray(framesObj.coordinates) || framesObj.coordinates.length === 0) {
    throw new Error(
      'NGL did not parse the trajectory into frames (check the topology / trajectory format). ' +
      `Parsed object: ${framesObj ? Object.keys(framesObj).join(', ') : 'empty'}.`
    );
  }

  const coords = framesObj.coordinates;
  const boxes = Array.isArray(framesObj.boxes) ? framesObj.boxes : [];
  const expected = natoms * 3;
  if (coords[0].length !== expected) {
    throw new Error(
      `Trajectory / topology atom mismatch: trajectory frames have ${coords[0].length / 3} atoms, ` +
      `but the topology has ${natoms}. Use a topology (.gro/.pdb) with the exact same atom order and count.`
    );
  }

  // ---- representative frame selection --------------------------------------
  // Frame COUNT is what matters: when a cap is set, keep a subset of frames
  // sampled evenly across the WHOLE trajectory (not just the first N frames),
  // so the analysis still covers the full time range.
  const total = coords.length;
  let indices;
  if (maxFrames > 0 && total > maxFrames) {
    indices = Array.from({ length: maxFrames }, (_, i) =>
      Math.round((total - 1) * (i / (maxFrames - 1)))
    );
  } else {
    indices = Array.from({ length: total }, (_, i) => i);
  }

  // ---- coordinate scale: NGL's trajectory parsers are inconsistent (some XTC
  // builds keep nm, DCD is Å). The topology from parseTopology() is in nm, so
  // compare the spread of the first frame with the topology spread:
  // ratio ≈ 1 → nm (use as-is); ratio ≈ 10 → Å (divide by 10 to get nm).
  const spread = (arr) => {
    const n = Math.floor(arr.length / 3);
    if (n <= 0) return 0;
    let mx = 0, my = 0, mz = 0;
    for (let i = 0; i < n; i++) { mx += arr[3 * i]; my += arr[3 * i + 1]; mz += arr[3 * i + 2]; }
    mx /= n; my /= n; mz /= n;
    let s = 0;
    for (let i = 0; i < n; i++) {
      const dx = arr[3 * i] - mx, dy = arr[3 * i + 1] - my, dz = arr[3 * i + 2] - mz;
      s += dx * dx + dy * dy + dz * dz;
    }
    return Math.sqrt(s / n);
  };
  const topoArr = new Float32Array(expected);
  for (let i = 0; i < natoms; i++) {
    topoArr[3 * i] = topoAtoms[i].x;
    topoArr[3 * i + 1] = topoAtoms[i].y;
    topoArr[3 * i + 2] = topoAtoms[i].z;
  }
  const refSpread = spread(topoArr);
  const frameSpread = spread(coords[0]);
  const nmScale = !(refSpread > 0 && frameSpread > 0 && frameSpread / refSpread > 3);

  const frames = (async function* () {
    let read = 0;
    for (const idx of indices) {
      const c = coords[idx];
      const xyz = new Float32Array(c.length);
      for (let k = 0; k < c.length; k++) xyz[k] = nmScale ? c[k] : c[k] / 10; // → nm
      let box = topoBoxNm || null;
      const b = boxes[idx];
      if (b && b.length >= 9) {
        box = new Float32Array(9);
        for (let k = 0; k < 9; k++) box[k] = b[k] / 10; // NGL boxes are Å → nm
      }
      yield { xyz, box };
      read++;
      if (onStatus && (read % 50 === 0 || read === indices.length)) {
        onStatus(`Parsing trajectory frames… ${read} / ${indices.length}`);
      }
    }
    if (read === 0) throw new Error('Trajectory contained no readable frames.');
  })();

  return { frames, numframes: indices.length, source: `NGL ${ext.toUpperCase()}` };
};

/* ----------------------------- public entry ----------------------------- */

export const resolveFrameSource = async (file, opts = {}) => {
  const name = (file?.name || '').toLowerCase();
  const { topoAtoms, topologyBox, onStatus, maxFrames } = opts;

  if (name.endsWith('.trr')) {
    return { frames: readTrrFrames(file, onStatus ? (n) => onStatus(`Parsing trajectory frames… ${n} parsed`) : undefined), numframes: null, source: 'native TRR' };
  }
  const ext = name.endsWith('.xtc') ? 'xtc' : name.endsWith('.dcd') ? 'dcd' : null;
  if (ext && Array.isArray(topoAtoms) && topoAtoms.length > 0) {
    const { frames, numframes } = await nglTrajectoryFrames(
      file, ext, topoAtoms, topologyBox, onStatus, maxFrames
    );
    return { frames, numframes, source: `NGL ${ext.toUpperCase()}` };
  }
  return null; // unknown format, or XTC/DCD without a topology to anchor it
};