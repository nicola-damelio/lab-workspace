import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';

const SELECT_COLOR = '#f59e0b';
const MANUAL_COLOR = '#16a34a';

/* ============================================================
   Generate a simple PDB string from molecule data
   so we don't depend on external URLs
   ============================================================ */
function generateProteinPDB(parsedSeq) {
  if (!parsedSeq || parsedSeq.length === 0) return null;
  const lines = [];
  let serial = 1;
  const bondLen = 3.8;

  parsedSeq.forEach((res, i) => {
    const x = i * bondLen;
    const y = (i % 2 === 0) ? 0 : 1.5;
    const resName = (res.code3 || 'UNK').padEnd(3).slice(0, 3);
    const resSeq = String(i + 1).padStart(4);
    const chain = 'A';

    const atoms = [
      { name: ' N  ', elem: 'N',  ox: -1.2, oy: 0 },
      { name: ' CA ', elem: 'C',  ox: 0,    oy: 0 },
      { name: ' C  ', elem: 'C',  ox: 1.2,  oy: 0 },
      { name: ' O  ', elem: 'O',  ox: 1.2,  oy: 1.2 },
    ];

    atoms.forEach((a) => {
      const ax = (x + a.ox).toFixed(3).padStart(8);
      const ay = (y + a.oy).toFixed(3).padStart(8);
      const az = (0).toFixed(3).padStart(8);
      const s = String(serial).padStart(5);
      lines.push(
        `ATOM  ${s} ${a.name} ${resName} ${chain}${resSeq}    ${ax}${ay}${az}  1.00  0.00           ${a.elem}`
      );
      serial++;
    });
  });

  lines.push('END');
  return lines.join('\n');
}

function generateNucleicPDB(parsedSeq, molType) {
  if (!parsedSeq || parsedSeq.length === 0) return null;
  const lines = [];
  let serial = 1;
  const rise = 3.4;
  const radius = 8;
  const isDNA = molType === 'dna';

  parsedSeq.forEach((res, i) => {
    const angle = (i * 36 * Math.PI) / 180;
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle);
    const z = i * rise;
    const resName = (res.code3 || 'UNK').padEnd(3).slice(0, 3);
    const resSeq = String(i + 1).padStart(4);
    const chain = 'A';

    const atoms = [
      { name: " P   ", elem: 'P', ox: 0, oy: 0, oz: 0 },
      { name: " O5' ", elem: 'O', ox: 1.5, oy: 0, oz: 0 },
      { name: " C5' ", elem: 'C', ox: 2.5, oy: 1.0, oz: 0 },
      { name: " C4' ", elem: 'C', ox: 3.5, oy: 1.5, oz: 0.5 },
      { name: " C3' ", elem: 'C', ox: 4.0, oy: 2.5, oz: 1.0 },
      { name: " O3' ", elem: 'O', ox: 5.0, oy: 3.0, oz: 1.5 },
    ];

    atoms.forEach((a) => {
      const ax = (x + a.ox).toFixed(3).padStart(8);
      const ay = (y + a.oy).toFixed(3).padStart(8);
      const az = (z + a.oz).toFixed(3).padStart(8);
      const s = String(serial).padStart(5);
      lines.push(
        `ATOM  ${s} ${a.name} ${resName} ${chain}${resSeq}    ${ax}${ay}${az}  1.00  0.00           ${a.elem}`
      );
      serial++;
    });
  });

  lines.push('END');
  return lines.join('\n');
}

function generateLipidPDB(parsedSeq) {
  if (!parsedSeq || parsedSeq.length === 0) return null;
  const res = parsedSeq[0];
  if (!res || !res.atoms) return null;
  const lines = [];
  let serial = 1;

  res.atoms.forEach((atom, i) => {
    const x = (i % 5) * 3.0;
    const y = Math.floor(i / 5) * 2.5;
    const z = 0;
    const elem = atom.startsWith('H') ? 'H' : 'C';
    const s = String(serial).padStart(5);
    const name = atom.padEnd(4).slice(0, 4);
    lines.push(
      `ATOM  ${s} ${name} LIP A   1    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00  0.00           ${elem}`
    );
    serial++;
  });

  lines.push('END');
  return lines.join('\n');
}

function generateSugarPDB(parsedSeq) {
  if (!parsedSeq || parsedSeq.length === 0) return null;
  const res = parsedSeq[0];
  if (!res || !res.atoms) return null;
  const lines = [];
  let serial = 1;
  const n = res.atoms.length;

  res.atoms.forEach((atom, i) => {
    const angle = (i * 2 * Math.PI) / Math.min(n, 6);
    const x = 3 * Math.cos(angle);
    const y = 3 * Math.sin(angle);
    const z = 0;
    const elem = atom.startsWith('H') ? 'H' : 'C';
    const s = String(serial).padStart(5);
    const name = atom.padEnd(4).slice(0, 4);
    lines.push(
      `ATOM  ${s} ${name} SUG A   1    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00  0.00           ${elem}`
    );
    serial++;
  });

  lines.push('END');
  return lines.join('\n');
}

/* ============================================================
   Map PDB atom info → NMR keys
   ============================================================ */
function mapAtomToNmrKeys(atomInfo, parsedSeq, moleculeType) {
  if (!parsedSeq || !atomInfo) return null;

  const resno = atomInfo.resno;
  const atomName = (atomInfo.atomname || '').trim();

  if (moleculeType === 'protein') {
    const idx = resno - 1;
    if (idx < 0 || idx >= parsedSeq.length) return null;
    const res = parsedSeq[idx];

    const atomMap = {
      'N': ['HN'], 'HN': ['HN'], 'H': ['HN'],
      'CA': ['Hα'], 'C': [], 'O': [],
      'CB': ['Hβ'],
    };

    const mapped = atomMap[atomName];
    if (mapped && mapped.length > 0) {
      const keys = mapped.map((a) => `${idx}-${a}`);
      return { ri: idx, keys, label: `${res.id} ${mapped[0]}` };
    }
    return null;
  }

  if (moleculeType === 'dna' || moleculeType === 'rna') {
    const idx = resno - 1;
    if (idx < 0 || idx >= parsedSeq.length) return null;
    const res = parsedSeq[idx];

    const clean = atomName.replace(/'/g, "'");
    const nucAtoms = res.atoms || [];
    const match = nucAtoms.find((a) => a.trim() === clean.trim());
    if (match) {
      return { ri: idx, keys: [`${idx}-${match}`], label: `${res.id} ${match.trim()}` };
    }
    return null;
  }

  if (moleculeType === 'lipid' || moleculeType === 'sugar') {
    const res = parsedSeq[0];
    if (!res) return null;
    const match = (res.atoms || []).find(
      (a) => a.trim() === atomName.trim() || a.replace(/\s/g, '') === atomName.replace(/\s/g, '')
    );
    if (match) {
      return { ri: 0, keys: [`0-${match}`], label: `${res.id} ${match.trim()}` };
    }
    return null;
  }

  return null;
}

/* ============================================================
   Main NGL Viewer Component
   ============================================================ */
export default function NmrMoleculeViewer({
  parsedSeq,
  moleculeType,
  selectedKeys,
  manualKeys = [],
  onAtomClick,
  labelMode = 'selected',
  height = '500px',
  pdbUrl = null,
}) {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const highlightRef = useRef(null);
  const keyIndexRef = useRef(new Map());
  const nglRef = useRef(null);

  const [status, setStatus] = useState('loading');
  const [hoverLabel, setHoverLabel] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  /* Generate PDB data locally */
  const pdbData = useMemo(() => {
    if (pdbUrl) return null; // will load from URL instead
    if (!parsedSeq || parsedSeq.length === 0) return null;

    switch (moleculeType) {
      case 'protein':
        return generateProteinPDB(parsedSeq);
      case 'dna':
      case 'rna':
        return generateNucleicPDB(parsedSeq, moleculeType);
      case 'lipid':
        return generateLipidPDB(parsedSeq);
      case 'sugar':
        return generateSugarPDB(parsedSeq);
      default:
        return null;
    }
  }, [parsedSeq, moleculeType, pdbUrl]);

  /* Load NGL and structure */
  useEffect(() => {
    let cancelled = false;
    let stage = null;

    async function init() {
      setStatus('loading');
      setErrorMsg('');

      try {
        /* Dynamic import of NGL */
        const NGL = await import('ngl');
        if (cancelled) return;
        nglRef.current = NGL;

        if (!containerRef.current) {
          setStatus('error');
          setErrorMsg('Container not found');
          return;
        }

        /* Create stage */
        stage = new NGL.Stage(containerRef.current, {
          backgroundColor: '#f8fafc',
        });
        stageRef.current = stage;

        /* Handle resize */
        const handleResize = () => {
          if (stageRef.current) stageRef.current.handleResize();
        };
        window.addEventListener('resize', handleResize);

        /* Determine what to load */
        let loadPromise;
        if (pdbUrl) {
          loadPromise = stage.loadFile(pdbUrl, { ext: 'pdb' });
        } else if (pdbData) {
          const blob = new Blob([pdbData], { type: 'text/plain' });
          loadPromise = stage.loadFile(blob, { ext: 'pdb' });
        } else {
          setStatus('error');
          setErrorMsg('No structure data available. Enter a sequence first.');
          return;
        }

        const component = await loadPromise;
        if (cancelled) return;

        /* Add representations */
        if (moleculeType === 'protein') {
          component.addRepresentation('cartoon', { color: 'chainid' });
          component.addRepresentation('ball+stick', {
            sele: 'hetero',
            aspectRatio: 1.1,
          });
          component.addRepresentation('backbone', {
            color: 'residueindex',
            radius: 0.3,
          });
        } else if (moleculeType === 'dna' || moleculeType === 'rna') {
          component.addRepresentation('cartoon', { color: 'chainid' });
          component.addRepresentation('ball+stick', {
            sele: 'not backbone',
            aspectRatio: 1.1,
          });
        } else {
          component.addRepresentation('ball+stick', {
            aspectRatio: 1.1,
          });
        }

        component.autoView();

        /* Build atom index for selection */
        const index = new Map();
        if (component.structure) {
          component.structure.eachAtom((atom) => {
            const info = {
              atomname: atom.atomname,
              resno: atom.resno,
              x: atom.x,
              y: atom.y,
              z: atom.z,
            };
            const mapped = mapAtomToNmrKeys(info, parsedSeq, moleculeType);
            if (mapped && mapped.keys) {
              mapped.keys.forEach((key) => {
                if (!index.has(key)) index.set(key, []);
                index.get(key).push({
                  x: atom.x,
                  y: atom.y,
                  z: atom.z,
                  label: mapped.label || key,
                });
              });
            }
          });
        }
        keyIndexRef.current = index;

        /* Click handler */
        stage.signals.clicked.add((pickingProxy) => {
          if (!pickingProxy || !pickingProxy.atom) return;
          const atom = pickingProxy.atom;
          const info = {
            atomname: atom.atomname,
            resno: atom.resno,
          };
          const mapped = mapAtomToNmrKeys(info, parsedSeq, moleculeType);
          if (mapped && onAtomClick) {
            onAtomClick(mapped.ri, mapped.keys);
          }
        });

        /* Hover handler */
        let lastLabel = null;
        stage.signals.hovered.add((pickingProxy) => {
          if (!pickingProxy || !pickingProxy.atom) {
            if (lastLabel !== null) {
              lastLabel = null;
              setHoverLabel('');
            }
            return;
          }
          const atom = pickingProxy.atom;
          const info = {
            atomname: atom.atomname,
            resno: atom.resno,
          };
          const mapped = mapAtomToNmrKeys(info, parsedSeq, moleculeType);
          const label = mapped
            ? mapped.label
            : `${atom.resname || ''} ${atom.resno || ''} ${atom.atomname || ''}`.trim();

          if (label !== lastLabel) {
            lastLabel = label;
            setHoverLabel(label);
          }
        });

        setStatus('ready');
      } catch (err) {
        console.error('NGL load error:', err);
        if (!cancelled) {
          setStatus('error');
          setErrorMsg(
            err.message || 'Failed to load NGL. Make sure it is installed: npm install ngl'
          );
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      window.removeEventListener('resize', () => {});
      if (stage) {
        stage.dispose();
      }
      stageRef.current = null;
      highlightRef.current = null;
    };
  }, [pdbData, pdbUrl, moleculeType, parsedSeq, onAtomClick]);

  /* Highlight selected atoms */
  useEffect(() => {
    const stage = stageRef.current;
    const NGL = nglRef.current;
    if (!stage || !NGL || status !== 'ready') return;

    /* Remove old highlights */
    if (highlightRef.current) {
      stage.removeComponent(highlightRef.current);
      highlightRef.current = null;
    }

    const shape = new NGL.Shape('highlights');
    let hasGraphics = false;
    const labeledKeys = new Set();

    const addSphere = (pos, color, opacity, radius) => {
      shape.addSphere([pos.x, pos.y, pos.z], {
        color,
        opacity,
        radius,
      });
      hasGraphics = true;
    };

    const addLabel = (pos, text) => {
      try {
        shape.addText(
          [pos.x, pos.y + 1.5, pos.z],
          { color: 0x111111, size: 2 },
          text
        );
        hasGraphics = true;
      } catch (e) {
        /* label failed, skip */
      }
    };

    /* All labels mode */
    if (labelMode === 'all') {
      keyIndexRef.current.forEach((positions, key) => {
        if (positions && positions[0]) {
          addLabel(positions[0], positions[0].label || key);
          labeledKeys.add(key);
        }
      });
    }

    /* Selected atoms */
    const selected = Array.isArray(selectedKeys) ? selectedKeys : [];
    const manual = Array.isArray(manualKeys)
      ? manualKeys.filter((k) => !selected.includes(k))
      : [];

    const addKeys = (keys, color, opacity, radius, withLabel) => {
      keys.forEach((key) => {
        const positions = keyIndexRef.current.get(key) || [];
        positions.forEach((pos) => {
          addSphere(pos, color, opacity, radius);
        });
        if (withLabel && positions[0] && !labeledKeys.has(key)) {
          addLabel(positions[0], positions[0].label || key);
          labeledKeys.add(key);
        }
      });
    };

    addKeys(manual, MANUAL_COLOR, 0.3, 1.2, labelMode !== 'none');
    addKeys(selected, SELECT_COLOR, 0.5, 1.5, labelMode !== 'none');

    if (hasGraphics) {
      highlightRef.current = stage.addComponentFromObject(shape);
    }
  }, [selectedKeys, manualKeys, status, labelMode]);

  return (
    <div
      className="relative w-full border border-slate-200 rounded-xl overflow-hidden bg-white"
      style={{ height }}
    >
      <div ref={containerRef} className="w-full h-full" />

      {hoverLabel && (
        <div className="absolute top-2 left-2 bg-white/90 border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 shadow-sm pointer-events-none">
          {hoverLabel}
        </div>
      )}

      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-slate-500 text-sm font-bold pointer-events-none">
          Loading molecular viewer…
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/85 p-4 pointer-events-none">
          <div className="text-center max-w-md">
            <p className="text-red-600 text-sm font-bold mb-2">
              Could not load the molecular viewer.
            </p>
            <p className="text-slate-500 text-xs">{errorMsg}</p>
          </div>
        </div>
      )}
    </div>
  );
}
