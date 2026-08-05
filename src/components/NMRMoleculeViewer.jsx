import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

/* ============================================================================
NMRMoleculeViewer — NGL-based 3D molecular viewer with NMR integration.
============================================================================ */
const SELECT_COLOR_HEX = 0xf59e0b;
const MANUAL_COLOR_HEX = 0x16a34a;

// ---- PDB atom name → NMR Greek-letter name mapping ----
const PDB_TO_NMR = {
  'H': 'HN', 'HN': 'HN', 'H1': 'HN', 'H2': 'HN', 'H3': 'HN',
  'HA': 'Hα', 'HA1': 'Hα1', 'HA2': 'Hα2', 'HA3': 'Hα2',
  'HB': 'Hβ', 'HB1': 'Hβ1', 'HB2': 'Hβ2', 'HB3': 'Hβ',
  'HG': 'Hγ', 'HG1': 'Hγ1', 'HG2': 'Hγ2', 'HG3': 'Hγ',
  'HG11': 'Hγ1', 'HG12': 'Hγ1', 'HG13': 'Hγ1',
  'HG21': 'Hγ2', 'HG22': 'Hγ2', 'HG23': 'Hγ2',
  'HD': 'Hδ', 'HD1': 'Hδ1', 'HD2': 'Hδ2', 'HD3': 'Hδ',
  'HD11': 'Hδ1', 'HD12': 'Hδ1', 'HD13': 'Hδ1',
  'HD21': 'Hδ21', 'HD22': 'Hδ22',
  'HE': 'Hε', 'HE1': 'Hε1', 'HE2': 'Hε2', 'HE3': 'Hε3',
  'HE21': 'Hε21', 'HE22': 'Hε22',
  'HZ': 'Hζ', 'HZ1': 'Hζ(NH3)', 'HZ2': 'Hζ(NH3)', 'HZ3': 'Hζ(NH3)',
  'HH': 'Hη2', 'HH11': 'Hη2', 'HH12': 'Hη2', 'HH2': 'Hη2',
  'HH21': 'Hη2', 'HH22': 'Hη2',
};

// ---- buildKeys (duplicated here to avoid circular imports) ----
const getCarbonName = (molType, char, atom) => {
  if (!atom) return null;
  if (atom.startsWith('HN') || atom.startsWith('NH') || atom.startsWith('OH') ||
      atom.startsWith('NHAc') || atom.startsWith('Ac') || atom.includes('NH3')) return null;
  if (molType === 'protein') {
    if (atom === 'Hε' && char === 'R') return null;
    if (char === 'W' && atom === 'Hδ1') return null;
    if (atom.includes('CH3')) return atom.replace('H', 'C').replace('(CH3)', '');
    const cName = atom.replace('H', 'C').replace(/\d+$/, '');
    if (['V', 'I', 'T'].includes(char) && atom.includes('γ')) return atom.replace('H', 'C');
    if (['L', 'I'].includes(char) && atom.includes('δ')) return atom.replace('H', 'C');
    if (['F', 'Y', 'W', 'H'].includes(char) &&
        (atom.includes('δ') || atom.includes('ε') || atom.includes('ζ') || atom.includes('η')))
      return atom.replace('H', 'C');
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

// ---- Map a PDB atom to NMR keys ----
const mapPdbAtomToNmrKeys = (atomname, resno, parsedSeq, moleculeType) => {
  const ri = resno - 1;
  if (!parsedSeq || ri < 0 || ri >= parsedSeq.length) return null;
  const res = parsedSeq[ri];
  if (!res) return null;
  const upper = (atomname || '').trim().toUpperCase();
  const nmrAtom = PDB_TO_NMR[upper];
  if (nmrAtom) {
    const keys = buildKeys(ri, [nmrAtom], moleculeType, res.char);
    return { ri, keys, label: `${res.id || res.char}${resno} ${nmrAtom}`, nmrAtom };
  }
  if (upper === 'N') return { ri, keys: [`${ri}-N`], label: `${res.id || res.char}${resno} N`, nmrAtom: 'N' };
  if (upper === 'CA') return { ri, keys: [`${ri}-Cα`], label: `${res.id || res.char}${resno} Cα`, nmrAtom: 'Cα' };
  if (upper === 'C') return { ri, keys: [`${ri}-C'`], label: `${res.id || res.char}${resno} C'`, nmrAtom: "C'" };
  if (upper === 'CB') return { ri, keys: [`${ri}-Cβ`], label: `${res.id || res.char}${resno} Cβ`, nmrAtom: 'Cβ' };
  return null;
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================
const NMRMoleculeViewer = ({
  onAtomClick,
  selectedKeys,
  manualKeys = [],
  moleculeType = 'protein',
  parsedSeq = [],
  height = '520px',
}) => {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const highlightCompRef = useRef(null);
  const labelCompRef = useRef(null);
  const [file, setFile] = useState(null);
  const [pdbIdInput, setPdbIdInput] = useState('');     // Bound to the text input
  const [activePdbId, setActivePdbId] = useState('');   // Triggers the useEffect
  const [loadTrigger, setLoadTrigger] = useState(0);    // Forces reload if same ID is submitted
  
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [hoverInfo, setHoverInfo] = useState(null);
  const [showLabels, setShowLabels] = useState(false);

  const componentRef = useRef(null);

  // ---- Load structure into NGL ----
  useEffect(() => {
    if (!file && !activePdbId) return;
    if (!containerRef.current) return;

    let cancelled = false;

    if (stageRef.current) {
      stageRef.current.dispose();
      stageRef.current = null;
    }
    componentRef.current = null;
    highlightCompRef.current = null;

    setStatus('loading');
    setErrorMsg('');

    const init = async () => {
      try {
        const NGL = await import('ngl');
        if (cancelled) return;

        const stage = new NGL.Stage(containerRef.current, {
          backgroundColor: '#f8fafc',
        });
        stageRef.current = stage;

        let component;
        if (file) {
          component = await stage.loadFile(file);
        } else if (activePdbId) {
          component = await stage.loadFile(`rcsb://${activePdbId}`);
        }

        if (cancelled) return;
        componentRef.current = component;

        component.addRepresentation('cartoon', { color: 'chainid', quality: 'high' });
        component.addRepresentation('ball+stick', { sele: 'hetero and not water', aspectRatio: 1.1 });
        component.addRepresentation('line', { sele: 'not hetero', color: 'element', opacity: 0.15 });
        
        component.autoView();

        stage.signals.clicked.add((pickingProxy) => {
          if (!pickingProxy || !pickingProxy.atom) return;
          const atom = pickingProxy.atom;
          const mapped = mapPdbAtomToNmrKeys(atom.atomname, atom.resno, parsedSeq, moleculeType);
          if (mapped && onAtomClick) {
            onAtomClick(mapped.ri, mapped.keys);
          }
        });

        let lastHover = null;
        stage.signals.hovered.add((pickingProxy) => {
          if (!pickingProxy || !pickingProxy.atom) {
            if (lastHover !== null) {
              lastHover = null;
              setHoverInfo(null);
            }
            return;
          }
          const atom = pickingProxy.atom;
          const mapped = mapPdbAtomToNmrKeys(atom.atomname, atom.resno, parsedSeq, moleculeType);
          const label = mapped
            ? mapped.label
            : `${atom.resname || ''} ${atom.resno || ''} ${atom.atomname || ''}`.trim();
          
          if (label !== lastHover) {
            lastHover = label;
            setHoverInfo(label);
          }
        });

 if (showLabels) {
       component.addRepresentation('label', {
         sele: '.CA', // <-- CHANGED: Only C-alpha for global labels to prevent freezing
         labelType: 'atomname',
         labelGrouping: 'residue',
         color: 0x334155,
         radius: 0.6,
       });
     }
        setStatus('ready');
      } catch (err) {
        console.error('NMRMoleculeViewer error:', err);
        if (!cancelled) {
          setErrorMsg(err.message || 'Failed to load structure');
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
      highlightCompRef.current = null;
    };
  }, [file, activePdbId, loadTrigger, showLabels, parsedSeq, moleculeType, onAtomClick]);

  // ---- Highlight selected / manual atoms ----
  useEffect(() => {
    const stage = stageRef.current;
    const component = componentRef.current;
    if (!stage || !component || status !== 'ready') return;

    // Remove previous highlight AND dynamic labels
    if (highlightCompRef.current) {
      stage.removeComponent(highlightCompRef.current);
      highlightCompRef.current = null;
    }
    if (labelCompRef.current) {
      stage.removeComponent(labelCompRef.current);
      labelCompRef.current = null;
    }

    const sel = Array.isArray(selectedKeys) ? selectedKeys : [];
    const man = Array.isArray(manualKeys) ? manualKeys.filter((k) => !sel.includes(k)) : [];
    
    if (sel.length === 0 && man.length === 0) return;

    // Build a selection string from the keys
    const buildSele = (keys) => {
      const parts = [];
      keys.forEach((k) => {
        const dashIdx = k.indexOf('-');
        if (dashIdx < 0) return;
        const ri = parseInt(k.substring(0, dashIdx), 10);
        const atomName = k.substring(dashIdx + 1);
        const resno = ri + 1;
        
        const pdbNames = [];
        Object.entries(PDB_TO_NMR).forEach(([pdb, nmr]) => {
          if (nmr === atomName) pdbNames.push(pdb);
        });
        if (atomName === 'N') pdbNames.push('N');
        if (atomName === 'Cα') pdbNames.push('CA');
        if (atomName === 'Cβ') pdbNames.push('CB');
        if (atomName === "C'") pdbNames.push('C');
        
        pdbNames.forEach((pn) => {
          parts.push(`${resno} and .${pn}`);
        });
      });
      return parts.length > 0 ? parts.join(' or ') : null;
    };

    try {
      const selSele = buildSele(sel);
      const manSele = buildSele(man);
      
      if (selSele) {
        // 1. Add Ball+Stick highlight
        const selComp = component.addRepresentation('ball+stick', {
          sele: selSele,
          color: SELECT_COLOR_HEX,
          aspectRatio: 1.5,
          radius: 0.4,
        });
        highlightCompRef.current = selComp;

        // ✨ MAGIC FIX: Show sidechain labels ONLY for the selected atoms
        if (showLabels) {
          const lblComp = component.addRepresentation('label', {
            sele: selSele,
            labelType: 'atomname',
            color: 0x0f172a, // Dark slate text
            radius: 0.8,
            showBackground: true,
            backgroundColor: 0xffffff, // White background box for readability
            backgroundMargin: 0.2,
            backgroundOpacity: 0.9,
          });
          labelCompRef.current = lblComp;
        }
      }
      
      if (manSele) {
         component.addRepresentation('ball+stick', {
           sele: manSele,
           color: MANUAL_COLOR_HEX,
           aspectRatio: 1.5,
           radius: 0.4,
         });
      }
    } catch (e) {
      console.warn('Highlight error:', e);
    }
  }, [selectedKeys, manualKeys, status, showLabels]); // <-- Added showLabels to dependencies

  // ---- Handle file selection ----
  const handleFileChange = useCallback((e) => {
    const f = e.target.files && e.target.files[0];
    if (f) {
      setFile(f);
      setActivePdbId('');
      setPdbIdInput('');
      setLoadTrigger(prev => prev + 1);
    }
  }, []);

  // ---- Handle PDB ID load ----
  const handlePdbIdLoad = useCallback(() => {
    if (pdbIdInput.trim()) {
      setFile(null);
      setActivePdbId(pdbIdInput.trim());
      setLoadTrigger(prev => prev + 1); // Forces useEffect to run even if same ID is entered
    }
  }, [pdbIdInput]);

  return (
    <div className="flex flex-col gap-3">
      {/* ---- Controls ---- */}
      <div className="flex flex-wrap items-end gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
        {/* File upload */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Load local file</label>
          <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-sm transition-colors inline-flex items-center gap-2">
            📂 Choose PDB / CIF file
            <input type="file" accept=".pdb,.cif,.ent,.mol2,.sdf" onChange={handleFileChange} className="hidden" />
          </label>
          {file && (
            <span className="text-[10px] text-slate-500 max-w-[200px] truncate">
              {file.name}
            </span>
          )}
        </div>

        {/* PDB ID */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">or RCSB PDB ID</label>
          <div className="flex gap-1">
            <input
              type="text"
              value={pdbIdInput}
              onChange={(e) => setPdbIdInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handlePdbIdLoad(); }}
              placeholder="e.g. 1TUP"
              className="border border-slate-300 rounded-lg px-3 py-2 text-xs w-28 bg-white outline-none focus:border-blue-500 font-mono"
            />
            <button
              type="button"
              onClick={handlePdbIdLoad}
              className="bg-slate-600 hover:bg-slate-700 text-white font-bold px-3 py-2 rounded-lg text-xs shadow-sm transition-colors"
            >
              Load
            </button>
          </div>
        </div>

        {/* Labels toggle */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Labels</label>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(e) => setShowLabels(e.target.checked)}
              className="w-4 h-4 accent-blue-600"
            />
            Show atom names
          </label>
        </div>
      </div>

      {/* ---- Viewer container ---- */}
      <div className="relative border border-slate-200 rounded-xl overflow-hidden bg-white" style={{ height }}>
        <div ref={containerRef} className="w-full h-full" />
        
        {/* Hover tooltip */}
        {hoverInfo && status === 'ready' && (
          <div className="absolute top-2 left-2 bg-white/90 border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm pointer-events-none z-10">
            {hoverInfo}
          </div>
        )}

        {/* Loading overlay */}
        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-20">
            <div className="text-center">
              <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
              <p className="text-sm text-slate-500 font-bold">Loading structure…</p>
            </div>
          </div>
        )}

        {/* Error overlay */}
        {status === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/90 z-20 p-4">
            <div className="text-center max-w-md">
              <p className="text-red-600 text-sm font-bold mb-1">⚠️ Failed to load structure</p>
              <p className="text-slate-500 text-xs">{errorMsg}</p>
            </div>
          </div>
        )}

        {/* Empty state */}
        {status === 'idle' && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50 z-10">
            <div className="text-center text-slate-400">
              <p className="text-4xl mb-2">🧬</p>
              <p className="text-sm font-bold">Load a PDB file or enter a PDB ID to view the 3D structure</p>
              <p className="text-xs mt-1">Tip: you cannot paste a file path — use the file picker button above</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default NMRMoleculeViewer;
