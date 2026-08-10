import React, { useState, useEffect, useRef, useCallback } from 'react';

/* ============================================================================
   MDMoleculeViewer — NGL-based 3D viewer with trajectory playback.
   Supports:
     • Structure from PDB ID, URL, or local file (data-URL / File)
     • Trajectory from online URL (XTC/TRR/DCD/NetCDF) with fallbacks
     • Trajectory from local File object (via URL.createObjectURL)
     • Playback controls: play/pause, frame slider, fps selector
     • Atom click → selection callback
     • Atom labels (none / selected / all)
   ========================================================================== */

// ---------- trajectory helpers ----------
const getTrajectoryObject = (component) => {
  if (!component) return null;
  if (Array.isArray(component.trajectories) && component.trajectories.length > 0) {
    return component.trajectories[component.trajectories.length - 1];
  }
  return null;
};

const getNumFrames = (traj) => {
  if (!traj) return 0;
  return (
    traj.numframes ||
    traj.nFrames ||
    (traj.trajectory && traj.trajectory.numframes) ||
    (traj.trajectoryPlayer && traj.trajectoryPlayer.numframes) ||
    0
  );
};

const setFrameSafe = (traj, frame) => {
  if (!traj) return;
  try {
    if (typeof traj.setFrame === 'function') traj.setFrame(frame);
    else if (traj.trajectory && typeof traj.trajectory.setFrame === 'function')
      traj.trajectory.setFrame(frame);
  } catch (_) { /* ignore */ }
};

// ---------- component ----------
const MDMoleculeViewer = ({
  structureSrc,
  structureFileData,
  structureFileName,
  structureFormat = 'auto',
  trajectorySrc,
  trajectoryFile,
  trajectoryFallbacks = [],
  trajectoryFormat = 'xtc',
  moleculeType = 'protein',
  parsedSeq = [],
  selectedKeys,
  manualKeys,
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
  const trajBlobUrlRef = useRef(null);
  const parsedSeqRef = useRef(parsedSeq);
  const onAtomClickRef = useRef(onAtomClick);
  const selectedKeysRef = useRef(selectedKeys);

  useEffect(() => {
    parsedSeqRef.current = parsedSeq;
    onAtomClickRef.current = onAtomClick;
    selectedKeysRef.current = selectedKeys;
  }, [parsedSeq, onAtomClick, selectedKeys]);

  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [hoverInfo, setHoverInfo] = useState(null);
  const [trajStatus, setTrajStatus] = useState('none');
  const [trajError, setTrajError] = useState('');
  const [numFrames, setNumFrames] = useState(0);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);

  // ---- resolve structure source ----
  const resolveStructureSrc = useCallback(() => {
    if (structureFileData) {
      if (typeof structureFileData === 'string' && structureFileData.startsWith('data:'))
        return structureFileData;
      if (structureFileData instanceof File) {
        return URL.createObjectURL(structureFileData);
      }
    }
    const raw = (structureSrc || '').trim();
    if (!raw) return null;
    if (/^(https?:|blob:|data:)/i.test(raw) || raw.startsWith('/') || raw.startsWith('./'))
      return raw;
    if (/^[0-9a-z]{4}$/i.test(raw))
      return `https://files.rcsb.org/download/${raw.toUpperCase()}.cif`;
    return raw;
  }, [structureSrc, structureFileData]);

  const resolveStructureExt = useCallback(() => {
    if (structureFormat && structureFormat !== 'auto') return structureFormat;
    const name = structureFileName || structureSrc || '';
    const ext = name.split(/[?#]/)[0].split('.').pop().toLowerCase();
    if (['pdb', 'ent', 'cif', 'mmcif', 'bcif', 'gro', 'mol2', 'sdf', 'xyz', 'mmtf'].includes(ext))
      return ext;
    return undefined;
  }, [structureFormat, structureFileName, structureSrc]);

  // ---- main init ----
  useEffect(() => {
    const src = resolveStructureSrc();
    if (!src || !containerRef.current) {
      setStatus('idle');
      return;
    }

    let cancelled = false;
    setPlaying(false);
    setCurrentFrame(0);
    setNumFrames(0);
    setTrajStatus('none');
    setTrajError('');

    if (stageRef.current) {
      stageRef.current.dispose();
      stageRef.current = null;
    }
    componentRef.current = null;
    trajRef.current = null;

    setStatus('loading');
    setErrorMsg('');

    const init = async () => {
      try {
        const NGL = await import('ngl');
        if (cancelled) return;

        const stage = new NGL.Stage(containerRef.current, {
          backgroundColor: '#f8fafc'
        });
        stageRef.current = stage;

        // -- load structure --
        const ext = resolveStructureExt();
        const loadOpts = ext ? { ext } : {};
        let component;

        try {
          component = await stage.loadFile(src, loadOpts);
        } catch (e1) {
          if (/^[0-9a-z]{4}$/i.test((structureSrc || '').trim())) {
            try {
              component = await stage.loadFile(
                `rcsb://${(structureSrc || '').trim().toUpperCase()}`
              );
            } catch (_) {
              throw e1;
            }
          } else {
            throw e1;
          }
        }
        if (cancelled) return;
        componentRef.current = component;

        // -- representations --
        try {
          component.addRepresentation('cartoon', {
            color: 'residueindex',
            quality: 'high'
          });
        } catch (_) { /* ignore */ }
        try {
          component.addRepresentation('ball+stick', {
            sele: 'hetero and not water',
            aspectRatio: 1.1
          });
        } catch (_) { /* ignore */ }
        try {
          component.addRepresentation('line', {
            sele: 'water',
            opacity: 0.3
          });
        } catch (_) { /* ignore */ }

        component.autoView();

        // -- atom click --
        stage.signals.clicked.add((pp) => {
          if (!pp || !pp.atom) return;
          const ri = pp.atom.resno - 1 - residueOffset;
          const seq = parsedSeqRef.current;
          if (ri < 0 || ri >= seq.length) return;
          if (onAtomClickRef.current) {
            const atomName = pp.atom.atomname || pp.atom.atom || '';
            onAtomClickRef.current(ri, [`${ri}-${atomName}`]);
          }
        });

        // -- hover --
        let lastHover = null;
        stage.signals.hovered.add((pp) => {
          if (!pp || !pp.atom) {
            if (lastHover !== null) { lastHover = null; setHoverInfo(null); }
            return;
          }
          const label = `${pp.atom.resname || ''} ${pp.atom.resno || ''} ${pp.atom.atomname || ''}`.trim();
          if (label !== lastHover) { lastHover = label; setHoverInfo(label); }
        });

        // -- atom labels --
        if (labelMode === 'all') {
          try {
            component.addRepresentation('label', {
              sele: 'all',
              labelType: 'atomname',
              labelSize: 12,
              labelColor: '#334155',
              labelBackground: true,
              labelBackgroundColor: '#ffffff'
            });
          } catch (_) { /* ignore */ }
        }

        setStatus('ready');

        // ---- TRAJECTORY LOADING ----
        const hasUrlTraj = Boolean(trajectorySrc);
        const hasFileTraj = Boolean(trajectoryFile);

        if (!hasUrlTraj && !hasFileTraj) return;

        setTrajStatus('loading');

        try {
          let traj = null;
          let lastErr = null;

          // 1) Local File takes priority
          if (hasFileTraj && !cancelled) {
            try {
              const blobUrl = URL.createObjectURL(trajectoryFile);
              trajBlobUrlRef.current = blobUrl;
              const trajComp = await stage.loadFile(blobUrl, {
                ext: trajectoryFormat
              });
              component.addTrajectory(trajComp);
              traj = getTrajectoryObject(component);
            } catch (e) {
              lastErr = e;
            }
          }

          // 2) Online URL with fallbacks
          if (!traj && hasUrlTraj && !cancelled) {
            const candidates = [
              trajectorySrc,
              ...(Array.isArray(trajectoryFallbacks) ? trajectoryFallbacks : [])
            ].filter(Boolean);

            for (const cand of candidates) {
              if (cancelled) break;
              try {
                const trajComp = await stage.loadFile(cand, {
                  ext: trajectoryFormat
                });
                component.addTrajectory(trajComp);
                traj = getTrajectoryObject(component);
                if (traj) break;
              } catch (e) {
                lastErr = e;
              }
            }
          }

          if (cancelled) return;

          if (traj) {
            trajRef.current = traj;
            const nf = getNumFrames(traj);
            setNumFrames(nf);
            setCurrentFrame(0);
            setTrajStatus('ready');
          } else {
            throw lastErr || new Error('Could not attach trajectory');
          }
        } catch (te) {
          if (!cancelled) {
            setTrajStatus('error');
            setTrajError(
              te?.message || 'Failed to load trajectory (check CORS + matching atom count).'
            );
          }
        }
      } catch (err) {
        console.error('MDMoleculeViewer error:', err);
        if (!cancelled) {
          setErrorMsg(err?.message || 'Failed to load structure.');
          setStatus('error');
        }
      }
    };

    init();

    return () => {
      cancelled = true;
      if (trajBlobUrlRef.current) {
        URL.revokeObjectURL(trajBlobUrlRef.current);
        trajBlobUrlRef.current = null;
      }
      if (stageRef.current) {
        stageRef.current.dispose();
        stageRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    structureSrc, structureFileData, structureFileName, structureFormat,
    trajectorySrc, trajectoryFile, trajectoryFormat,
    residueOffset, labelMode
  ]);

  // ---- playback loop ----
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

  // ---- render ----
  const hasTrajectoryInput = Boolean(trajectorySrc || trajectoryFile);

  return (
    <div className="flex flex-col gap-3">
      {/* Trajectory controls */}
      {hasTrajectoryInput && (
        <div className="flex flex-wrap items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-lg p-3">
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            disabled={trajStatus !== 'ready' || numFrames === 0}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-sm"
          >
            {playing ? '⏸ Pause' : '▶ Play'}
          </button>

          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <span className="text-[10px] font-bold text-indigo-700">Frame</span>
            <input
              type="range"
              min={0}
              max={Math.max(0, numFrames - 1)}
              value={currentFrame}
              onChange={(e) => {
                const f = parseInt(e.target.value, 10);
                setCurrentFrame(f);
                setFrameSafe(trajRef.current, f);
              }}
              disabled={trajStatus !== 'ready' || numFrames === 0}
              className="flex-1 accent-indigo-600"
            />
            <span className="text-[10px] font-mono font-bold text-indigo-800">
              {currentFrame} / {Math.max(0, numFrames - 1)}
            </span>
          </div>

          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value) || 10)}
            className="border border-indigo-300 rounded-lg px-2 py-1 text-xs bg-white"
          >
            {[1, 5, 10, 20, 30, 60].map((s) => (
              <option key={s} value={s}>{s} fps</option>
            ))}
          </select>

          <div className="w-full">
            {trajStatus === 'loading' && (
              <span className="text-[11px] font-bold text-indigo-600">
                ⏳ Loading trajectory ({trajectoryFormat.toUpperCase()})…
              </span>
            )}
            {trajStatus === 'ready' && (
              <span className="text-[11px] font-bold text-emerald-600">
                ✓ Trajectory loaded ({trajectoryFormat.toUpperCase()}, {numFrames} frames)
              </span>
            )}
            {trajStatus === 'error' && (
              <span className="text-[11px] font-bold text-red-600">⚠️ {trajError}</span>
            )}
          </div>
        </div>
      )}

      {/* 3D viewport */}
      <div
        className="relative border border-slate-200 rounded-xl overflow-hidden bg-white"
        style={{ height }}
      >
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
              <p className="text-sm font-bold">
                Enter a topology (PDB ID / URL) or upload a file in Experiment Setup
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MDMoleculeViewer;