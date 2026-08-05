import React, { useState, useEffect, useRef, useCallback } from 'react';

const SELECT_COLOR_HEX = 0xf59e0b;
const MANUAL_COLOR_HEX = 0x16a34a;

// ---- PDB atom name → NMR Greek-letter name mapping ----
const PDB_TO_NMR = {
  H: 'HN',
  HN: 'HN',
  H1: 'HN',
  H2: 'HN',
  H3: 'HN',
  HA: 'Hα',
  HA1: 'Hα1',
  HA2: 'Hα2',
  HA3: 'Hα2',
  HB: 'Hβ',
  HB1: 'Hβ1',
  HB2: 'Hβ2',
  HB3: 'Hβ',
  HG: 'Hγ',
  HG1: 'Hγ1',
  HG2: 'Hγ2',
  HG3: 'Hγ',
  HG11: 'Hγ1',
  HG12: 'Hγ1',
  HG13: 'Hγ1',
  HG21: 'Hγ2',
  HG22: 'Hγ2',
  HG23: 'Hγ2',
  HD: 'Hδ',
  HD1: 'Hδ1',
  HD2: 'Hδ2',
  HD3: 'Hδ',
  HD11: 'Hδ1',
  HD12: 'Hδ1',
  HD13: 'Hδ1',
  HD21: 'Hδ21',
  HD22: 'Hδ22',
  HE: 'Hε',
  HE1: 'Hε1',
  HE2: 'Hε2',
  HE3: 'Hε3',
  HE21: 'Hε21',
  HE22: 'Hε22',
  HZ: 'Hζ',
  HZ1: 'Hζ(NH3)',
  HZ2: 'Hζ(NH3)',
  HZ3: 'Hζ(NH3)',
  HH: 'Hη2',
  HH11: 'Hη2',
  HH12: 'Hη2',
  HH2: 'Hη2',
  HH21: 'Hη2',
  HH22: 'Hη2',
};

const NMR_TO_PDB = {};

Object.entries(PDB_TO_NMR).forEach(([pdb, nmr]) => {
  if (!NMR_TO_PDB[nmr]) NMR_TO_PDB[nmr] = [];
  if (!NMR_TO_PDB[nmr].includes(pdb)) NMR_TO_PDB[nmr].push(pdb);
});

const GREEK_TO_PDB = {
  α: 'A',
  β: 'B',
  γ: 'G',
  δ: 'D',
  ε: 'E',
  ζ: 'Z',
  η: 'H',
};

const getCarbonName = (molType, char, atom) => {
  if (!atom) return null;

  if (
    atom.startsWith('HN') ||
    atom.startsWith('NH') ||
    atom.startsWith('OH') ||
    atom.startsWith('NHAc') ||
    atom.startsWith('Ac') ||
    atom.includes('NH3')
  ) {
    return null;
  }

  if (molType === 'protein') {
    if (atom === 'Hε' && char === 'R') return null;
    if (char === 'W' && atom === 'Hδ1') return null;

    if (atom.includes('CH3')) {
      return atom.replace('H', 'C').replace('(CH3)', '');
    }

    const cName = atom.replace('H', 'C').replace(/\d+$/, '');

    if (['V', 'I', 'T'].includes(char) && atom.includes('γ')) {
      return atom.replace('H', 'C');
    }

    if (['L', 'I'].includes(char) && atom.includes('δ')) {
      return atom.replace('H', 'C');
    }

    if (
      ['F', 'Y', 'W', 'H'].includes(char) &&
      (atom.includes('δ') || atom.includes('ε') || atom.includes('ζ') || atom.includes('η'))
    ) {
      return atom.replace('H', 'C');
    }

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

const mapPdbAtomToNmrKeys = (atomname, resno, parsedSeq, moleculeType) => {
  const ri = resno - 1;

  if (!parsedSeq || ri < 0 || ri >= parsedSeq.length) return null;

  const res = parsedSeq[ri];
  if (!res) return null;

  const upper = (atomname || '').trim().toUpperCase();
  const nmrAtom = PDB_TO_NMR[upper];

  if (nmrAtom) {
    const keys = buildKeys(ri, [nmrAtom], moleculeType, res.char);
    return {
      ri,
      keys,
      label: `${res.id || res.char}${resno} ${nmrAtom}`,
      nmrAtom,
    };
  }

  if (upper === 'N') {
    return {
      ri,
      keys: [`${ri}-N`],
      label: `${res.id || res.char}${resno} N`,
      nmrAtom: 'N',
    };
  }

  if (upper === 'CA') {
    return {
      ri,
      keys: [`${ri}-Cα`],
      label: `${res.id || res.char}${resno} Cα`,
      nmrAtom: 'Cα',
    };
  }

  if (upper === 'C') {
    return {
      ri,
      keys: [`${ri}-C'`],
      label: `${res.id || res.char}${resno} C'`,
      nmrAtom: "C'",
    };
  }

  if (upper === 'CB') {
    return {
      ri,
      keys: [`${ri}-Cβ`],
      label: `${res.id || res.char}${resno} Cβ`,
      nmrAtom: 'Cβ',
    };
  }

  return null;
};

const nmrAtomToPdbNames = (name) => {
  if (!name) return [];

  if (name === 'N') return ['N'];
  if (name === "C'") return ['C'];
  if (name === 'Cα') return ['CA'];
  if (name === 'Cβ') return ['CB'];

  const names = new Set();

  (NMR_TO_PDB[name] || []).forEach((pdbName) => names.add(pdbName));

  const carbonMatch = name.match(/^C([αβγδεζη])(\d*)$/);
  if (carbonMatch) {
    const letter = GREEK_TO_PDB[carbonMatch[1]];
    const digit = carbonMatch[2] || '';

    if (letter) {
      if (digit) {
        names.add(`C${letter}${digit}`);
      } else {
        names.add(`C${letter}`);
        [1, 2, 3].forEach((n) => names.add(`C${letter}${n}`));
      }
    }
  }

  const hydrogenMatch = name.match(/^H([αβγδεζη])(\d*)$/);
  if (hydrogenMatch) {
    const letter = GREEK_TO_PDB[hydrogenMatch[1]];
    const digit = hydrogenMatch[2] || '';

    if (letter) {
      if (digit) {
        names.add(`H${letter}${digit}`);
      } else {
        names.add(`H${letter}`);
        [1, 2, 3].forEach((n) => names.add(`H${letter}${n}`));
      }
    }
  }

  if (names.size === 0) names.add(name);

  return [...names];
};

const buildSelectionFromKeys = (keys) => {
  const parts = [];

  (keys || []).forEach((key) => {
    if (typeof key !== 'string') return;

    const dashIdx = key.indexOf('-');
    if (dashIdx <= 0) return;

    const ri = parseInt(key.slice(0, dashIdx), 10);
    const atomName = key.slice(dashIdx + 1);

    if (Number.isNaN(ri) || !atomName) return;

    const resno = ri + 1;
    const pdbNames = nmrAtomToPdbNames(atomName);

    pdbNames.forEach((pdbName) => {
      if (pdbName) parts.push(`${resno} and .${pdbName}`);
    });
  });

  return parts.length > 0 ? parts.join(' or ') : null;
};

const getLabelSelection = (scope) => {
  switch (scope) {
    case 'all':
      return 'not water';
    case 'all-heavy':
      return 'not water and not hydrogen';
    case 'backbone':
      return 'not hetero and backbone and not hydrogen';
    case 'sidechains-with-h':
      return 'not hetero and not backbone';
    case 'sidechains':
    default:
      return 'not hetero and not backbone and not hydrogen';
  }
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================
const NMRMoleculeViewer = ({
  onAtomClick,
  selectedKeys = [],
  manualKeys = [],
  moleculeType = 'protein',
  parsedSeq = [],
  height = '520px',
}) => {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const componentRef = useRef(null);
  const highlightCompRef = useRef([]);
  const labelCompRef = useRef(null);

  const [file, setFile] = useState(null);
  const [pdbInput, setPdbInput] = useState('');
  const [pdbId, setPdbId] = useState('');
  const [loadToken, setLoadToken] = useState(0);

  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [hoverInfo, setHoverInfo] = useState(null);

  const [showLabels, setShowLabels] = useState(false);
  const [labelScope, setLabelScope] = useState('sidechains');

  // Refs to prevent reload loops when parent re-renders
  const parsedSeqRef = useRef(parsedSeq);
  const moleculeTypeRef = useRef(moleculeType);
  const onAtomClickRef = useRef(onAtomClick);

  useEffect(() => {
    parsedSeqRef.current = parsedSeq;
    moleculeTypeRef.current = moleculeType;
    onAtomClickRef.current = onAtomClick;
  }, [parsedSeq, moleculeType, onAtomClick]);

  const requestRender = useCallback(() => {
    try {
      const stage = stageRef.current;
      if (stage && stage.viewer && typeof stage.viewer.requestRender === 'function') {
        stage.viewer.requestRender();
      }
    } catch (e) {
      // ignore render request errors
    }
  }, []);

  // Main load effect
  useEffect(() => {
    if (!file && !pdbId.trim()) return;
    if (!containerRef.current) return;

    let cancelled = false;

    if (stageRef.current) {
      stageRef.current.dispose();
      stageRef.current = null;
    }

    componentRef.current = null;
    highlightCompRef.current = [];
    labelCompRef.current = null;

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
        } else if (pdbId.trim()) {
          component = await stage.loadFile(`rcsb://${pdbId.trim()}`);
        }

        if (cancelled) return;

        componentRef.current = component;

        try {
          component.addRepresentation('cartoon', {
            color: 'residueindex',
            quality: 'high',
          });
        } catch (e) {
          console.warn('Cartoon rep failed', e);
        }

        try {
          component.addRepresentation('ball+stick', {
            sele: 'hetero and not water',
            aspectRatio: 1.1,
          });
        } catch (e) {
          console.warn('Ball+stick rep failed', e);
        }

        try {
          component.addRepresentation('line', {
            sele: 'not hetero',
            color: 'element',
            opacity: 0.15,
          });
        } catch (e) {
          console.warn('Line rep failed', e);
        }

        component.autoView();

        stage.signals.clicked.add((pickingProxy) => {
          if (!pickingProxy || !pickingProxy.atom) return;

          const atom = pickingProxy.atom;

          const mapped = mapPdbAtomToNmrKeys(
            atom.atomname,
            atom.resno,
            parsedSeqRef.current,
            moleculeTypeRef.current
          );

          if (mapped && onAtomClickRef.current) {
            onAtomClickRef.current(mapped.ri, mapped.keys);
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

          const mapped = mapPdbAtomToNmrKeys(
            atom.atomname,
            atom.resno,
            parsedSeqRef.current,
            moleculeTypeRef.current
          );

          const label = mapped
            ? mapped.label
            : `${atom.resname || ''} ${atom.resno || ''} ${atom.atomname || ''}`.trim();

          if (label !== lastHover) {
            lastHover = label;
            setHoverInfo(label);
          }
        });

        setStatus('ready');
        requestRender();
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
      highlightCompRef.current = [];
      labelCompRef.current = null;
    };
  }, [file, pdbId, loadToken, requestRender]);

  // Label effect
  useEffect(() => {
    const component = componentRef.current;
    if (!component || status !== 'ready') return;

    const clearLabels = () => {
      if (labelCompRef.current) {
        try {
          component.removeRepresentation(labelCompRef.current);
        } catch (e) {
          // ignore
        }

        labelCompRef.current = null;
        requestRender();
      }
    };

    clearLabels();

    if (!showLabels) return;

    const params = {
      sele: getLabelSelection(labelScope),
      labelType: 'atomname',
      labelGrouping: 'atom',
      color: '#0f172a',
      radius: labelScope === 'all' || labelScope === 'all-heavy' ? 0.8 : 1.15,
      opacity: 1,
      depthTest: false,
    };

    try {
      labelCompRef.current = component.addRepresentation('label', params);
    } catch (firstError) {
      try {
        const fallbackParams = { ...params };
        delete fallbackParams.labelGrouping;
        delete fallbackParams.depthTest;

        labelCompRef.current = component.addRepresentation('label', fallbackParams);
      } catch (secondError) {
        console.warn('Label rep failed', secondError);
      }
    }

    requestRender();

    return clearLabels;
  }, [showLabels, labelScope, status, requestRender]);

  // Highlight selected / manual atoms
  useEffect(() => {
    const component = componentRef.current;
    if (!component || status !== 'ready') return;

    const clearHighlights = () => {
      if (Array.isArray(highlightCompRef.current)) {
        highlightCompRef.current.forEach((rep) => {
          try {
            component.removeRepresentation(rep);
          } catch (e) {
            // ignore
          }
        });
      }

      highlightCompRef.current = [];
      requestRender();
    };

    clearHighlights();

    const selected = Array.isArray(selectedKeys) ? selectedKeys : [];
    const manual = Array.isArray(manualKeys)
      ? manualKeys.filter((k) => !selected.includes(k))
      : [];

    if (selected.length === 0 && manual.length === 0) return;

    const reps = [];

    try {
      const selectedSele = buildSelectionFromKeys(selected);

      if (selectedSele) {
        reps.push(
          component.addRepresentation('ball+stick', {
            sele: selectedSele,
            color: SELECT_COLOR_HEX,
            aspectRatio: 1.5,
            radius: 0.4,
            depthTest: false,
          })
        );
      }

      const manualSele = buildSelectionFromKeys(manual);

      if (manualSele) {
        reps.push(
          component.addRepresentation('ball+stick', {
            sele: manualSele,
            color: MANUAL_COLOR_HEX,
            aspectRatio: 1.5,
            radius: 0.4,
            depthTest: false,
          })
        );
      }

      highlightCompRef.current = reps;
      requestRender();
    } catch (e) {
      console.warn('Highlight error:', e);
    }

    return clearHighlights;
  }, [selectedKeys, manualKeys, status, requestRender]);

  const handleFileChange = useCallback((e) => {
    const f = e.target.files && e.target.files[0];

    if (f) {
      setFile(f);
      setPdbId('');
      setPdbInput('');
    }
  }, []);

  const handlePdbIdLoad = useCallback(() => {
    const id = pdbInput.trim().toUpperCase();

    if (!id) return;

    setFile(null);
    setPdbId(id);
    setLoadToken((t) => t + 1);
  }, [pdbInput]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">
            Load local file
          </label>

          <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-sm transition-colors inline-flex items-center gap-2">
            📂 Choose PDB / CIF file
            <input
              type="file"
              accept=".pdb,.cif,.ent,.mol2,.sdf"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>

          {file && (
            <span className="text-[10px] text-slate-500 max-w-[200px] truncate">
              {file.name}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">
            or RCSB PDB ID
          </label>

          <div className="flex gap-1">
            <input
              type="text"
              value={pdbInput}
              onChange={(e) => setPdbInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handlePdbIdLoad();
              }}
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

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">
            Labels
          </label>

          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(e) => setShowLabels(e.target.checked)}
              className="w-4 h-4 accent-blue-600"
            />
            Show atom names
          </label>

          <select
            value={labelScope}
            onChange={(e) => setLabelScope(e.target.value)}
            disabled={!showLabels}
            className="border border-slate-300 rounded-lg px-2 py-1 text-[11px] bg-white outline-none focus:border-blue-500 disabled:opacity-50"
          >
            <option value="sidechains">Side chains (no H)</option>
            <option value="sidechains-with-h">Side chains + H</option>
            <option value="all-heavy">All non-H</option>
            <option value="all">All atoms</option>
            <option value="backbone">Backbone only</option>
          </select>
        </div>
      </div>

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
              <p className="text-red-600 text-sm font-bold mb-1">
                ⚠️ Failed to load structure
              </p>
              <p className="text-slate-500 text-xs">{errorMsg}</p>
            </div>
          </div>
        )}

        {status === 'idle' && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50 z-10">
            <div className="text-center text-slate-400">
              <p className="text-4xl mb-2">🧬</p>
              <p className="text-sm font-bold">
                Load a PDB file or enter a PDB ID to view the 3D structure
              </p>
              <p className="text-xs mt-1">
                Tip: you cannot paste a file path — use the file picker button above
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default NMRMoleculeViewer;
