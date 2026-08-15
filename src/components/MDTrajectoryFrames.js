/* =========================================================================
   MDTrajectoryFrames.js
   Frame providers for the membrane-contact analysis (MDMembraneContacts.js).

   - .trr       : parsed natively here (uncompressed XDR)
   - .xtc/.dcd  : decoded through the NGL library, which MDMoleculeViewer.jsx
                  already loads from CDN. NGL's dist build bundles the
                  official GROMACS xdrfile / 3dfcoord decoder, so XTC
                  compression is handled by proven code, not a re-implementation.

   Every provider yields { xyz: Float32Array(3N) in nm, box: 9 floats (nm) }
   in topology atom order.
   ========================================================================= */

/* ------------------------------ NGL loader ----------------------------- */
/* Same CDN builds MDMoleculeViewer.jsx uses. */

let _nglPromise = null;
const NGL_CDN_URLS = [
  'https://unpkg.com/ngl@2.4.0/dist/ngl.js',
  'https://cdn.jsdelivr.net/npm/ngl@2.4.0/dist/ngl.js',
];

export const ensureNGL = () => {
  if (typeof window !== 'undefined' && window.NGL) return Promise.resolve(window.NGL);
  if (_nglPromise) return _nglPromise;
  _nglPromise = new Promise((resolve, reject) => {
    let idx = 0;
    const tryNext = () => {
      if (idx >= NGL_CDN_URLS.length) {
        _nglPromise = null;
        reject(new Error('Could not load NGL from any CDN (unpkg / jsdelivr).'));
        return;
      }
      const script = document.createElement('script');
      script.src = NGL_CDN_URLS[idx++];
      script.async = true;
      script.onload = () => (window.NGL ? resolve(window.NGL) : tryNext());
      script.onerror = () => tryNext();
      document.head.appendChild(script);
    };
    tryNext();
  });
  return _nglPromise;
};

/* --------------------------- hidden NGL stage -------------------------- */

const makeHiddenStage = (NGL) => {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:48px;height:48px;pointer-events:none;opacity:0;';
  document.body.appendChild(host);
  const stage = new NGL.Stage(host, { backgroundColor: '#ffffff', sampleLevel: 0, hoverTimeout: 0 });
  return { stage, host };
};

/* ------------------------------ TRR reader ------------------------------ */

export async function* readTrrFrames(file) {
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
    if (xyz) yield { xyz, box };
  }
};

/* --------------------- NGL-backed XTC / DCD reader ---------------------- */

const nglTrajectoryFrames = async (file, ext, topoBlob, topoExt, topoBoxNm, onStatus) => {
  const NGL = await ensureNGL();
  const { stage, host } = makeHiddenStage(NGL);
  const cleanup = () => {
    try { stage.removeAllComponents(); } catch (e) {}
    try { if (typeof stage.dispose === 'function') stage.dispose(); } catch (e) {}
    try { host.remove(); } catch (e) {}
  };

  try {
    onStatus?.('NGL: loading topology…');
    const sComp = await stage.loadFile(topoBlob, { ext: topoExt, defaultRepresentation: false });
    if (!sComp || typeof sComp.addTrajectory !== 'function') {
      throw new Error('NGL topology component lacks addTrajectory() — cannot attach the trajectory.');
    }

    onStatus?.('NGL: attaching trajectory…');
    let tComp = null;
    const TrajFileCls = { xtc: NGL.XtcTrajectoryFile, trr: NGL.TrrTrajectoryFile, dcd: NGL.DcdTrajectoryFile }[ext];
    try {
      if (!TrajFileCls) throw new Error(`NGL trajectory class for .${ext} not found`);
      tComp = sComp.addTrajectory(new TrajFileCls(file));
    } catch (e1) {
      try {
        const loaded = await stage.loadFile(file, { ext });
        tComp = sComp.addTrajectory(loaded);
      } catch (e2) {
        throw new Error(`NGL could not attach the trajectory (${e1.message} / ${e2.message}).`);
      }
    }

    const trajectory = tComp?.trajectory || tComp?.traj || tComp;
    const natoms = sComp.structure?.atomCount;
    if (!natoms) throw new Error('NGL topology contains no atoms.');

    // frame count can be reported asynchronously (XTC has no index)
    let numframes = 0;
    for (let t = 0; t < 40 && numframes === 0; t++) {
      const n = trajectory?.numframes ?? trajectory?.frameCount;
      if (Number.isFinite(n) && n > 0) numframes = n;
      else await new Promise((r) => setTimeout(r, 250));
    }
    const knownCount = numframes > 0;
    if (!knownCount) numframes = Infinity;

    const xyz = new Float32Array(natoms * 3);
    const box = topoBoxNm || null;

    const fillFromAtomstore = () => {
      const as = sComp.structure.atomstore;
      for (let i = 0; i < natoms; i++) {
        xyz[3 * i] = as.x[i] / 10;        // NGL keeps Å; the engine expects nm
        xyz[3 * i + 1] = as.y[i] / 10;
        xyz[3 * i + 2] = as.z[i] / 10;
      }
    };

    // NGL's trajectory API differs slightly between versions — try the known
    // shapes in order: promise getFrame, callback getFrame, then setFrame.
    const readFrame = async (i) => {
      if (typeof trajectory.getFrame === 'function') {
        try {
          const r = trajectory.getFrame(i);
          if (r && typeof r.then === 'function') {
            const c = await r;
            if (c && c.length) { for (let k = 0; k < xyz.length && k < c.length; k++) xyz[k] = c[k] / 10; return; }
          }
        } catch (e) { /* next strategy */ }
        try {
          const c = await new Promise((resolve, reject) => {
            const to = setTimeout(() => reject(new Error('getFrame callback timeout')), 60000);
            try { trajectory.getFrame(i, (coords) => { clearTimeout(to); resolve(coords); }); }
            catch (e) { clearTimeout(to); reject(e); }
          });
          if (c && c.length) { for (let k = 0; k < xyz.length && k < c.length; k++) xyz[k] = c[k] / 10; return; }
        } catch (e) { /* next strategy */ }
      }
      if (typeof trajectory.setFrame === 'function') {
        await new Promise((resolve) => {
          let done = false;
          const fin = () => { if (!done) { done = true; resolve(); } };
          const to = setTimeout(fin, 5000);
          try { trajectory.signals?.frameChanged?.add(() => { clearTimeout(to); fin(); }); } catch (e) {}
          try { trajectory.setFrame(i); } catch (e) { clearTimeout(to); fin(); }
        });
        fillFromAtomstore();
        return;
      }
      throw new Error(`No usable NGL frame accessor (trajectory keys: ${Object.keys(trajectory || {}).join(', ')}).`);
    };

    const frames = (async function* () {
      let read = 0;
      try {
        for (let i = 0; i < numframes; i++) {
          let ok = true;
          try { await readFrame(i); }
          catch (e) { if (knownCount) throw e; ok = false; }
          if (!ok) break;
          read++;
          // stop NGL from retaining the whole trajectory in its frame cache
          try {
            if (Array.isArray(trajectory.frameCache) && trajectory.frameCache.length > 64) {
              trajectory.frameCache.splice(0, trajectory.frameCache.length - 1);
            }
          } catch (e) {}
          yield { xyz, box };   // reused buffer; the engine consumes it synchronously
        }
      } finally { cleanup(); }
      if (read === 0) throw new Error('Trajectory contained no readable frames.');
    })();

    return { frames, numframes: knownCount ? numframes : null };
  } catch (e) {
    cleanup();
    throw e;
  }
};

/* ----------------------------- public entry ----------------------------- */

export const resolveFrameSource = async (file, opts = {}) => {
  const name = (file?.name || '').toLowerCase();
  const { topologyBlob, topologyExt, topologyBox, onStatus } = opts;

  if (name.endsWith('.trr')) {
    return { frames: readTrrFrames(file), numframes: null, source: 'native TRR' };
  }
  const ext = name.endsWith('.xtc') ? 'xtc' : name.endsWith('.dcd') ? 'dcd' : null;
  if (ext && topologyBlob) {
    const { frames, numframes } = await nglTrajectoryFrames(
      file, ext, topologyBlob, topologyExt || 'gro', topologyBox, onStatus
    );
    return { frames, numframes, source: `NGL ${ext.toUpperCase()}` };
  }
  return null; // unknown format, or XTC/DCD without a topology to anchor it
};