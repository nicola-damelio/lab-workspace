import React, { useState, useEffect, useRef } from 'react';

/* ============================================================================
   MDMoleculeViewer — NGL 3D viewer for the MD page.

   Supports:
   - online structure/topology: PDB ID, direct URL, Google Drive link
   - local structure/topology file from PC: PDB / GRO / CIF / MOL2 / SDF
   - online trajectory: XTC / TRR / DCD
   - trajectory playback
   - selected/manual atom highlighting
   - atom labels and side-chain representation
========================================================================== */

const SELECT_COLOR_HEX = 0xf59e0b;
const MANUAL_COLOR_HEX = 0x16a34a;

// ================= PDB ATOM NAME → NMR NAME MAPPING =================
const PDB_TO_NMR = {
  H: 'HN', HN: 'HN', H1: 'HN', H2: 'HN', H3: 'HN',
  HA: 'Hα', HA1: 'Hα1', HA2: 'Hα2', HA3: 'Hα2',
  HB: 'Hβ', HB1: 'Hβ1', HB2: 'Hβ2', HB3: 'Hβ',
  HG: 'Hγ', HG1: 'Hγ1', HG2: 'Hγ2', HG3: 'Hγ', HG11: 'Hγ1', HG12: 'Hγ1', HG13: 'Hγ1', HG21: 'Hγ2', HG22: 'Hγ2', HG23: 'Hγ2',
  HD: 'Hδ', HD1: 'Hδ1', HD2: 'Hδ2', HD3: 'Hδ', HD11: 'Hδ1', HD12: 'Hδ1', HD13: 'Hδ1', HD21: 'Hδ21', HD22: 'Hδ22',
  HE: 'Hε', HE1: 'Hε1', HE2: 'Hε2', HE3: 'Hε3', HE21: 'Hε21', HE22: 'Hε22',
  HZ: 'Hζ', HZ1: 'Hζ(NH3)', HZ2: 'Hζ(NH3)', HZ3: 'Hζ(NH3)',
  HH: 'Hη2', HH11: 'Hη2', HH12: 'Hη2', HH2: 'Hη2', HH21: 'Hη2', HH22: 'Hη2'
};

const GREEK_MAP = { A: 'α', B: 'β', G: 'γ', D: 'δ', E: 'ε', Z: 'ζ', H: 'η' };
const REVERSE_GREEK = { α: 'A', β: 'B', γ: 'G', δ: 'D', ε: 'E', ζ: 'Z', η: 'H' };

// ================= STRUCTURE SOURCE HELPERS =================
const getStructureCandidates = (raw, forcedFormat) => {
  const value = (raw || '').trim();
  if (!value) return [];
  const forced = forcedFormat && forcedFormat !== 'auto' ? forcedFormat : null;

  const extFromUrl = () => {
    const path = value.split(/[?#]/)[0];
    if (!path.includes('.')) return null;
    const ext = path.split('.').pop().toLowerCase();
    return ['pdb', 'ent', 'cif', 'mmcif', 'bcif', 'mol2', 'sdf', 'gro'].includes(ext) ? ext : null;
  };

  const ext = forced || extFromUrl();

  // Google Drive
  let m = value.match(/drive\.google\.com\/file\/d\/([^/?]+)/) || value.match(/drive\.google\.com\/(?:open|uc)[^#]*[?&]id=([^&#]+)/);
  if (m) {
    const id = m[1];
    const useExt = ext || 'pdb';
    return [
      { url: `https://drive.google.com/uc?export=download&id=${id}`, params: { ext: useExt } },
      { url: `https://lh3.googleusercontent.com/d/${id}`, params: { ext: useExt } },
      { url: value, params: { ext: useExt } }
    ];
  }

  if (/^rcsb:/i.test(value)) return [{ url: value }];

  // PDB ID, e.g. 1UBQ
  if (/^[0-9a-z]{4}$/i.test(value)) {
    const id = value.toUpperCase();
    return [
      { url: `https://files.rcsb.org/download/${id}.cif`, params: { ext: 'cif' } },
      { url: `https://files.rcsb.org/download/${id}.pdb`, params: { ext: 'pdb' } }
    ];
  }

  return [{ url: value, params: ext ? { ext } : undefined }];
};

// ================= ATOM KEY HELPERS =================
const getCarbonName = (molType, char, atom) => {
  if (!atom) return null;
  if (atom.startsWith('HN') || atom.startsWith('NH') || atom.startsWith('OH') || atom.startsWith('NHAc') || atom.startsWith('Ac') || atom.includes('NH3')) return null;

  if (molType === 'protein') {
    if (atom === 'Hε' && char === 'R') return null;
    if (char === 'W' && atom === 'Hδ1') return null;
    if (atom.includes('CH3')) return atom.replace('H', 'C').replace('(CH3)', '');
    const cName = atom.replace('H', 'C').replace(/\d+$/, '');
    if (['V', 'I', 'T'].includes(char) && atom.includes('γ')) return atom.replace('H', 'C');
    if (['L', 'I'].includes(char) && atom.includes('δ')) return atom.replace('H', 'C');
    if (['F', 'Y', 'W', 'H'].includes(char) && (atom.includes('δ') || atom.includes('ε') || atom.includes('ζ') || atom.includes('η'))) return atom.replace('H', 'C');
    return cName;
  }
  return atom.replace('H', 'C');
};

const buildKeys = (ri, tokens, molType, char) => {
  const set = new Set();
  (tokens || []).forEach((tok) => {
    const variants = new Set([tok]);
    if (/\d$/.test(tok)) {
      [1, 2].forEach((n) => variants.add(tok + n));
      const stripped = tok.replace(/\d+$/, '');
      if (stripped !== tok && stripped.length > 1) variants.add(stripped);
    }
    variants.forEach((v) => {
      set.add(`${ri}-${v}`);
      if (v.startsWith('H')) {
        const c = getCarbonName(molType, char, v);
        if (c) set.add(`${ri}-${c}`);
      }
    });
  });
  return [...set];
};

const mapPdbAtomToNmrKeys = (atomname, resno, parsedSeq, moleculeType, residueOffset = 0) => {
  const ri = resno - 1 - residueOffset;
  if (!parsedSeq || ri < 0 || ri >= parsedSeq.length) return null;
  const res = parsedSeq[ri];
  if (!res) return null;

  const upper = (atomname || '').trim().toUpperCase();
  let nmrAtom = PDB_TO_NMR[upper];
  if (!nmrAtom) {
    if (upper === 'N') nmrAtom = 'N';
    else if (upper === 'CA') nmrAtom = 'Cα';
    else if (upper === 'C') nmrAtom = "C'";
    else if (upper === 'CB') nmrAtom = 'Cβ';
    else if (upper === 'O') nmrAtom = 'O';
    else {
      const match = upper.match(/^([CNO])([ABGDEZH])(\d*)$/);
      if (match) nmrAtom = `${match[1]}${GREEK_MAP[match[2]]}${match[3]}`;
      else nmrAtom = upper;
    }
  }
  return { ri, keys: buildKeys(ri, [nmrAtom], moleculeType, res.char), label: `${res.id || res.char}${resno} ${nmrAtom}`, nmrAtom };
};

// ================= TRAJECTORY HELPERS =================
const getTrajectoryObject = (component) => {
  if (!component) return null;
  
  if (Array.isArray(component.trajList) && component.trajList.length > 0) {
    const tComp = component.trajList[component.trajList.length - 1];
    return tComp.trajectory || tComp;
  }
  
  if (Array.isArray(component.trajectories) && component.trajectories.length > 0) {
    return component.trajectories[component.trajectories.length - 1];
  }
  return null;
};

const getNumFrames = (traj) => {
  if (!traj) return 0;
  // Different NGL versions have exposed the frame count under different names
  // (numframes/nFrames in older builds, frameCount in current ones) — check them all.
  return (
    traj.frameCount || traj.numframes || traj.nFrames ||
    (traj.trajectory && (traj.trajectory.frameCount || traj.trajectory.numframes || traj.trajectory.nFrames)) ||
    (traj.trajectoryPlayer && (traj.trajectoryPlayer.frameCount || traj.trajectoryPlayer.numframes)) ||
    0
  );
};

const setFrameSafe = (traj, frame) => {
  if (!traj) return;
  try {
    if (typeof traj.setFrame === 'function') traj.setFrame(frame);
    else if (traj.trajectory && typeof traj.trajectory.setFrame === 'function') traj.trajectory.setFrame(frame);
  } catch (e) {}
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================
const MDMoleculeViewer = ({
  structureSrc,
  structureFileData = null,
  structureFileName = null,
  structureFormat = 'auto',
  trajectorySrc,
  trajectoryFile = null,
  trajectoryFallbacks = [],
  trajectoryFormat = 'xtc',
  moleculeType = 'protein',
  parsedSeq = [],
  selectedKeys,
  manualKeys = [],
  onAtomClick,
  residueOffset = 0,
  atomNameMap = {},
  labelMode = 'selected',
  height = '520px'
}) => {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const componentRef = useRef(null);
  const trajRef = useRef(null);
  
  // Ref to hold blob URLs so they are kept alive until unmount
  const blobUrlsRef = useRef([]);

  const highlightCompRef = useRef(null);
  const manualHighlightCompRef = useRef(null);
  const labelCompRef = useRef(null);
  const sidechainCompRef = useRef(null);

  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [hoverInfo, setHoverInfo] = useState(null);

  const [showLabels, setShowLabels] = useState(labelMode !== 'none');
  const [sidechainStyle, setSidechainStyle] = useState('licorice');

  const [trajStatus, setTrajStatus] = useState('none');
  const [trajError, setTrajError] = useState('');
  const [numFrames, setNumFrames] = useState(0);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);

  const parsedSeqRef = useRef(parsedSeq);
  const moleculeTypeRef = useRef(moleculeType);
  const onAtomClickRef = useRef(onAtomClick);
  const residueOffsetRef = useRef(residueOffset);

  useEffect(() => {
    parsedSeqRef.current = parsedSeq;
    moleculeTypeRef.current = moleculeType;
    onAtomClickRef.current = onAtomClick;
    residueOffsetRef.current = residueOffset;
  }, [parsedSeq, moleculeType, onAtomClick, residueOffset]);

  useEffect(() => {
    setShowLabels(labelMode !== 'none');
  }, [labelMode]);

  // ================= MAIN LOAD EFFECT =================
  useEffect(() => {
    if (!structureSrc && !structureFileData) {
      setStatus('idle');
      return;
    }

    if (!containerRef.current) return;

    let cancelled = false;

    setPlaying(false);
    setCurrentFrame(0);
    setNumFrames(0);
    setTrajStatus((trajectorySrc || trajectoryFile) ? 'loading' : 'none');
    setTrajError('');

    if (stageRef.current) {
      stageRef.current.dispose();
      stageRef.current = null;
    }

    componentRef.current = null;
    trajRef.current = null;
    highlightCompRef.current = null;
    manualHighlightCompRef.current = null;
    labelCompRef.current = null;
    sidechainCompRef.current = null;

    setStatus('loading');
    setErrorMsg('');

    const init = async () => {
      try {
        const NGL = await import('ngl');
        if (cancelled) return;

        const stage = new NGL.Stage(containerRef.current, { backgroundColor: '#f8fafc' });
        stageRef.current = stage;
        let component;

        if (structureFileData) {
          const fileExt = (structureFileName || '').split('.').pop().toLowerCase() || (structureFormat && structureFormat !== 'auto' ? structureFormat : 'pdb');
          try {
            component = await stage.loadFile(structureFileData, { ext: fileExt });
          } catch (e) {
            component = await stage.loadFile(structureFileData);
          }
        } else {
          const candidates = getStructureCandidates(structureSrc, structureFormat);
          if (!candidates.length) throw new Error('No structure source provided');
          let lastErr = null;
          for (const cand of candidates) {
            if (cancelled) break;
            try {
              component = cand.params ? await stage.loadFile(cand.url, cand.params) : await stage.loadFile(cand.url);
              if (component) break;
            } catch (e) { lastErr = e; }
          }
          if (!component) throw lastErr || new Error('Could not load structure');
        }

        if (cancelled) return;
        componentRef.current = component;

        try { component.addRepresentation('cartoon', { color: 'residueindex', quality: 'high' }); } catch (e) {}
        try { component.addRepresentation('ball+stick', { sele: 'hetero and not water', aspectRatio: 1.1 }); } catch (e) {}

        component.autoView();

        stage.signals.clicked.add((pickingProxy) => {
          if (!pickingProxy || !pickingProxy.atom) return;
          const mapped = mapPdbAtomToNmrKeys(pickingProxy.atom.atomname, pickingProxy.atom.resno, parsedSeqRef.current, moleculeTypeRef.current, residueOffsetRef.current);
          if (mapped && onAtomClickRef.current) onAtomClickRef.current(mapped.ri, mapped.keys);
        });

        let lastHover = null;
        stage.signals.hovered.add((pickingProxy) => {
          if (!pickingProxy || !pickingProxy.atom) {
            if (lastHover !== null) { lastHover = null; setHoverInfo(null); }
            return;
          }
          const atom = pickingProxy.atom;
          const mapped = mapPdbAtomToNmrKeys(atom.atomname, atom.resno, parsedSeqRef.current, moleculeTypeRef.current, residueOffsetRef.current);
          const label = mapped ? mapped.label : `${atom.resname || ''} ${atom.resno || ''} ${atom.atomname || ''}`.trim();
          if (label !== lastHover) { lastHover = label; setHoverInfo(label); }
        });

        setStatus('ready');

        // ---- Load trajectory ----
        if (trajectorySrc || trajectoryFile) {
          try {
            const candidates = trajectoryFile 
              ? [trajectoryFile] 
              : [trajectorySrc, ...(trajectoryFallbacks || [])].filter(Boolean);

            let traj = null;
            let lastErr = null;

            for (const cand of candidates) {
              if (cancelled) break;

              try {
                let targetCand = cand;

                // Generate a permanent blob URL from a local File so we have a
                // fetchable string source (kept alive for the component's lifetime).
                if (typeof cand === 'object' && cand instanceof File) {
                  const url = URL.createObjectURL(cand);
                  blobUrlsRef.current.push(url); // Keep it alive
                  targetCand = url;
                }

                // IMPORTANT: component.addTrajectory(url, {ext}) treats a plain
                // string as a request to an NGL "trajectory server" (a REST
                // backend for streaming frames) and throws "Cannot read
                // properties of undefined (reading 'getCountUrl')" once no such
                // server datasource is registered — which is always true here,
                // since this app has no backend. Parsing the whole trajectory
                // client-side first with autoLoad() (into an NGL Frames object)
                // and handing THAT to addTrajectory() keeps everything in the
                // browser and avoids the server code path entirely.
                const frames = await NGL.autoLoad(targetCand, { ext: trajectoryFormat });
                if (!frames) throw new Error('Could not parse trajectory frames');

                const trajComp = component.addTrajectory(frames);

                traj = (trajComp && trajComp.trajectory) || getTrajectoryObject(component);

                if (traj) break;
              } catch (e) {
                lastErr = e;
                console.warn("Trajectory loading failed for candidate:", e);
              }
            }

            if (cancelled) return;

            if (traj) {
              trajRef.current = traj;

              // Parsing large XTC files is asynchronous! We must poll to wait for the frames.
              const initialFrames = getNumFrames(traj);
              
              if (initialFrames > 0) {
                setNumFrames(initialFrames);
                setCurrentFrame(0);
                setTrajStatus('ready');
              } else {
                const checkInterval = setInterval(() => {
                  const nf = getNumFrames(traj);
                  if (nf > 0) {
                    setNumFrames(nf);
                    setCurrentFrame(0);
                    setTrajStatus('ready');
                    clearInterval(checkInterval);
                  }
                }, 250);
                
                // Safety clear to prevent memory leaks if the file is invalid
                setTimeout(() => {
                  clearInterval(checkInterval);
                  if (getNumFrames(traj) === 0 && !cancelled) {
                     setTrajStatus('error');
                     setTrajError('Trajectory loaded but contains 0 frames. Verify that the PDB and XTC have the exact same atom count.');
                  }
                }, 10000);
              }
            } else {
              throw lastErr || new Error('Could not attach trajectory');
            }
          } catch (trajErr) {
            if (!cancelled) {
              setTrajStatus('error');
              setTrajError(trajErr?.message || 'Failed to load trajectory. Check CORS and matching atom count.');
            }
          }
        }
      } catch (err) {
        console.error('MDMoleculeViewer error:', err);
        if (!cancelled) {
          setErrorMsg(err?.message || 'Failed to load structure. Check the URL, PDB ID, local file, or CORS settings.');
          setStatus('error');
        }
      }
    };

    init();

    return () => {
      cancelled = true;
      if (stageRef.current) {
        stageRef.current.dispose();
        stageRef.current = null;
      }
      componentRef.current = null;
      trajRef.current = null;
      
      // Clean up the object URLs to prevent memory leaks when tab is closed
      blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      blobUrlsRef.current = [];
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureSrc, structureFileData, structureFileName, structureFormat, trajectorySrc, trajectoryFile, trajectoryFormat]);

  // ================= PLAYBACK LOOP =================
  useEffect(() => {
    if (!playing || !trajRef.current || numFrames === 0) return;
    const interval = Math.max(16, 1000 / speed);
    const id = setInterval(() => {
      setCurrentFrame((prev) => {
        const next = (prev + 1) % numFrames;
        setFrameSafe(trajRef.current, next);
        return next;
      });
    }, interval);
    return () => clearInterval(id);
  }, [playing, speed, numFrames]);

  const togglePlay = () => {
    if (trajStatus !== 'ready' || numFrames === 0) return;
    setPlaying((p) => !p);
  };

  const handleFrameChange = (e) => {
    const frame = parseInt(e.target.value, 10);
    if (Number.isNaN(frame)) return;
    setCurrentFrame(frame);
    setFrameSafe(trajRef.current, frame);
  };

  // ================= ATOM LABELS =================
  useEffect(() => {
    const component = componentRef.current;
    if (!component || status !== 'ready') return;
    if (labelCompRef.current) {
      try { component.removeRepresentation(labelCompRef.current); } catch (e) {}
      labelCompRef.current = null;
    }
    if (showLabels) {
      try {
        labelCompRef.current = component.addRepresentation('label', {
          sele: 'protein and sidechain and not hydrogen', labelType: 'atomname', labelGrouping: 'atom', color: 0x111827, radius: 1.0, opacity: 1, depthTest: false
        });
      } catch (e) {}
    }
  }, [showLabels, status]);

  // ================= SIDE-CHAIN REPRESENTATION =================
  useEffect(() => {
    const component = componentRef.current;
    if (!component || status !== 'ready') return;
    if (sidechainCompRef.current) {
      try { component.removeRepresentation(sidechainCompRef.current); } catch (e) {}
      sidechainCompRef.current = null;
    }
    if (sidechainStyle !== 'none') {
      try {
        sidechainCompRef.current = component.addRepresentation(sidechainStyle, {
          sele: '(protein and sidechain) or (protein and .CA)', color: 'element', multipleBond: true, radiusSize: sidechainStyle === 'licorice' ? 0.25 : undefined
        });
      } catch (e) {}
    }
  }, [sidechainStyle, status]);

  // ================= HIGHLIGHT SELECTED / MANUAL ATOMS =================
  useEffect(() => {
    const component = componentRef.current;
    if (!component || status !== 'ready') return;

    if (highlightCompRef.current) {
      try { component.removeRepresentation(highlightCompRef.current); } catch (e) {}
      highlightCompRef.current = null;
    }
    if (manualHighlightCompRef.current) {
      try { component.removeRepresentation(manualHighlightCompRef.current); } catch (e) {}
      manualHighlightCompRef.current = null;
    }

    const sel = Array.isArray(selectedKeys) ? selectedKeys : [];
    const man = Array.isArray(manualKeys) ? manualKeys.filter((k) => !sel.includes(k)) : [];

    if (sel.length === 0 && man.length === 0) return;

    const buildSele = (keys) => {
      const parts = [];
      keys.forEach((k) => {
        const dashIdx = k.indexOf('-');
        if (dashIdx < 0) return;
        const ri = parseInt(k.substring(0, dashIdx), 10);
        const atomName = k.substring(dashIdx + 1);
        const resno = ri + 1 + residueOffset;

        const pdbNames = [];
        Object.entries(PDB_TO_NMR).forEach(([pdb, nmr]) => { if (nmr === atomName) pdbNames.push(pdb); });

        if (atomName === 'N') pdbNames.push('N');
        else if (atomName === 'Cα') pdbNames.push('CA');
        else if (atomName === 'Cβ') pdbNames.push('CB');
        else if (atomName === "C'") pdbNames.push('C');
        else if (atomName === 'O') pdbNames.push('O');
        else {
          const match = atomName.match(/^([CNO])([αβγδεζη])(\d*)$/);
          if (match) pdbNames.push(`${match[1]}${REVERSE_GREEK[match[2]]}${match[3]}`);
        }

        if (pdbNames.length === 0) pdbNames.push(atomName);
        pdbNames.forEach((pn) => parts.push(`${resno} and .${pn}`));
      });
      return parts.length > 0 ? parts.join(' or ') : null;
    };

    try {
      const selSele = buildSele(sel);
      if (selSele) {
        highlightCompRef.current = component.addRepresentation('ball+stick', { sele: selSele, color: SELECT_COLOR_HEX, aspectRatio: 1.5, radius: 0.4 });
      }
      const manSele = buildSele(man);
      if (manSele) {
        manualHighlightCompRef.current = component.addRepresentation('ball+stick', { sele: manSele, color: MANUAL_COLOR_HEX, aspectRatio: 1.5, radius: 0.4 });
      }
    } catch (e) {}
  }, [selectedKeys, manualKeys, status, residueOffset]);

  // ================= RENDER =================
  return (
    <div className="flex flex-col gap-3">
      {/* Trajectory playback controls */}
      {(trajectorySrc || trajectoryFile) && (
        <div className="flex flex-wrap items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-lg p-3">
          <button
            type="button"
            onClick={togglePlay}
            disabled={trajStatus !== 'ready' || numFrames === 0}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-sm transition-colors inline-flex items-center gap-1"
          >
            {playing ? '⏸ Pause' : '▶ Play'}
          </button>

          <div className="flex items-center gap-2 flex-1 min-w-[220px]">
            <span className="text-[10px] font-bold text-indigo-700 whitespace-nowrap">Frame</span>
            <input
              type="range"
              min={0}
              max={Math.max(0, numFrames - 1)}
              value={currentFrame}
              onChange={handleFrameChange}
              disabled={trajStatus !== 'ready' || numFrames === 0}
              className="flex-1 accent-indigo-600"
            />
            <span className="text-[10px] font-mono font-bold text-indigo-800 whitespace-nowrap">
              {currentFrame} / {Math.max(0, numFrames - 1)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-indigo-700 uppercase">Speed</label>
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value) || 10)}
              className="border border-indigo-300 rounded-lg px-2 py-1 text-xs bg-white outline-none focus:border-indigo-500"
            >
              {[1, 5, 10, 20, 30, 60].map((s) => <option key={s} value={s}>{s} fps</option>)}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-slate-600 uppercase">Labels</label>
            <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer">
              <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} className="w-4 h-4 accent-indigo-600" />
              Atom names
            </label>

            <select
              value={sidechainStyle}
              onChange={(e) => setSidechainStyle(e.target.value)}
              className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none focus:border-indigo-500"
            >
              <option value="none">Side chains: Hidden</option>
              <option value="line">Side chains: Lines</option>
              <option value="licorice">Side chains: Licorice</option>
              <option value="ball+stick">Side chains: Ball &amp; Stick</option>
              <option value="spacefill">Side chains: Spacefill</option>
            </select>
          </div>

          <div className="w-full">
            {trajStatus === 'loading' && <span className="text-[11px] font-bold text-indigo-600">⏳ Loading trajectory ({trajectoryFormat.toUpperCase()})…</span>}
            {trajStatus === 'ready' && <span className="text-[11px] font-bold text-emerald-600">✓ Trajectory loaded ({trajectoryFormat.toUpperCase()}, {numFrames} frames)</span>}
            {trajStatus === 'error' && <span className="text-[11px] font-bold text-red-600">⚠️ {trajError}</span>}
          </div>
        </div>
      )}

      {/* 3D viewport */}
      <div className="relative border border-slate-200 rounded-xl overflow-hidden bg-white" style={{ height }}>
        <div ref={containerRef} className="w-full h-full" />

        {hoverInfo && status === 'ready' && (
          <div className="absolute top-2 left-2 bg-white/90 border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm pointer-events-none z-10">
            {hoverInfo}
          </div>
        )}

        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-20">
            <div className="text-center">
              <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
              <p className="text-sm text-slate-500 font-bold">Loading structure…</p>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/90 z-20 p-4">
            <div className="text-center max-w-md">
              <p className="text-red-600 text-sm font-bold mb-1">⚠️ Failed to load structure</p>
              <p className="text-slate-500 text-xs">{errorMsg}</p>
            </div>
          </div>
        )}

        {status === 'idle' && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50 z-10">
            <div className="text-center text-slate-400">
              <p className="text-4xl mb-2">🧬</p>
              <p className="text-sm font-bold">Enter a topology URL / PDB ID, or choose a local PDB/GRO file in Experiment Setup</p>
            </div>
          </div>
        )}
      </div>

      <p className="text-[10px] text-slate-400">
        💡 Local topology file overrides the online topology link. Trajectory must match the topology atom count. Remote files must allow CORS.
      </p>
    </div>
  );
};

export default MDMoleculeViewer;