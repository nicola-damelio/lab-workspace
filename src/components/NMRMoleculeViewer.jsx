import React, { useState, useEffect, useRef, useCallback } from 'react';

const SELECT_COLOR_HEX = 0xf59e0b;
const MANUAL_COLOR_HEX = 0x16a34a;

// ---- PDB atom name → NMR Greek-letter name mapping (Hydrogens) ----
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

// Maps PDB letters (A, B, G, D, E, Z, H) to Greek characters for heavy atoms
const GREEK_MAP = {
  A: 'α',
  B: 'β',
  G: 'γ',
  D: 'δ',
  E: 'ε',
  Z: 'ζ',
  H: 'η',
};

const REVERSE_GREEK = {
  α: 'A',
  β: 'B',
  γ: 'G',
  δ: 'D',
  ε: 'E',
  ζ: 'Z',
  η: 'H',
};

const normalizeStructureSource = (raw) => {
  const value = (raw || '').trim();
  if (!value) return null;

  // Direct URL: http, https, blob, data
  if (/^(https?:|blob:|data:)/i.test(value)) {
    const path = value.split(/[?#]/)[0];
    const ext = path.includes('.') ? path.split('.').pop().toLowerCase() : '';

    if (ext === 'pdb' || ext === 'ent') {
      return { url: value, params: { ext: 'pdb' } };
    }

    if (ext === 'cif' || ext === 'mmcif') {
      return { url: value, params: { ext: 'cif' } };
    }

    if (ext === 'bcif') {
      return { url: value, params: { ext: 'bcif' } };
    }

    if (ext === 'mol2') {
      return { url: value, params: { ext: 'mol2' } };
    }

    if (ext === 'sdf') {
      return { url: value, params: { ext: 'sdf' } };
    }

    // If the URL has no obvious extension, guess the format.
    const guessed = /bcif/i.test(value)
      ? 'bcif'
      : /cif/i.test(value)
        ? 'cif'
        : 'pdb';

    return { url: value, params: { ext: guessed } };
  }

  // Already an RCSB-style URI
  if (/^rcsb:/i.test(value)) {
    return { url: value };
  }

  // Plain 4-character PDB ID
  if (/^[0-9a-z]{4}$/i.test(value)) {
    const id = value.toUpperCase();

    return {
      url: `https://files.rcsb.org/download/${id}.cif`,
      params: { ext: 'cif' },
    };
  }

  // Fallback: assume it is already a loadable path/URL
  return { url: value };
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
      if (stripped !== tok && stripped.length > 1) {
        variants.add(stripped);
      }
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

  let nmrAtom = PDB_TO_NMR[upper];

  if (!nmrAtom) {
    if (upper === 'N') {
      nmrAtom = 'N';
    } else if (upper === 'CA') {
      nmrAtom = 'Cα';
    } else if (upper === 'C') {
      nmrAtom = "C'";
    } else if (upper === 'CB') {
      nmrAtom = 'Cβ';
    } else if (upper === 'O') {
      nmrAtom = 'O';
    } else {
      // Dynamically map heavy side-chain atoms (e.g., CG1 -> Cγ1, ND2 -> Nδ2)
      const match = upper.match(/^([CNO])([ABGDEZH])(\d*)$/);

      if (match) {
        nmrAtom = `${match[1]}${GREEK_MAP[match[2]]}${match[3]}`;
      } else {
        nmrAtom = upper;
      }
    }
  }

  const keys = buildKeys(ri, [nmrAtom], moleculeType, res.char);

  return {
    ri,
    keys,
    label: `${res.id || res.char}${resno} ${nmrAtom}`,
    nmrAtom,
  };
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
  const componentRef = useRef(null);

  const highlightCompRef = useRef(null);
  const manualHighlightCompRef = useRef(null);
  const labelCompRef = useRef(null);
  const sidechainCompRef = useRef(null);

  const [file, setFile] = useState(null);
  const [pdbId, setPdbId] = useState('');
  const [loadRequest, setLoadRequest] = useState(null);

  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [hoverInfo, setHoverInfo] = useState(null);
  const [showLabels, setShowLabels] = useState(false);
  const [sidechainStyle, setSidechainStyle] = useState('licorice');

  const parsedSeqRef = useRef(parsedSeq);
  const moleculeTypeRef = useRef(moleculeType);
  const onAtomClickRef = useRef(onAtomClick);

  useEffect(() => {
    parsedSeqRef.current = parsedSeq;
    moleculeTypeRef.current = moleculeType;
    onAtomClickRef.current = onAtomClick;
  }, [parsedSeq, moleculeType, onAtomClick]);

  // Main structure loading effect
  useEffect(() => {
    if (!loadRequest || (!loadRequest.file && !loadRequest.url)) return;
    if (!containerRef.current) return;

    let cancelled = false;

    if (stageRef.current) {
      stageRef.current.dispose();
      stageRef.current = null;
    }

    componentRef.current = null;
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

        const stage = new NGL.Stage(containerRef.current, {
          backgroundColor: '#f8fafc',
        });

        stageRef.current = stage;

        let component;

        if (loadRequest.file) {
          component = await stage.loadFile(loadRequest.file);
        } else {
          const target = normalizeStructureSource(loadRequest.url);

          if (!target) {
            throw new Error('No structure URL or PDB ID provided');
          }

          try {
            component = target.params
              ? await stage.loadFile(target.url, target.params)
              : await stage.loadFile(target.url);
          } catch (firstErr) {
            if (cancelled) throw firstErr;

            const raw = (loadRequest.url || '').trim();

            // Fallback for plain PDB IDs
            if (/^[0-9a-z]{4}$/i.test(raw)) {
              const id = raw.toUpperCase();

              try {
                component = await stage.loadFile(
                  `https://files.rcsb.org/download/${id}.pdb`,
                  { ext: 'pdb' }
                );
              } catch (secondErr) {
                if (cancelled) throw secondErr;
                component = await stage.loadFile(`rcsb://${id}`);
              }
            } else {
              throw firstErr;
            }
          }
        }

        if (cancelled) return;

        componentRef.current = component;

        try {
          component.addRepresentation('cartoon', {
            color: 'residueindex',
            quality: 'high',
          });
        } catch (e) {
          console.warn('Cartoon representation failed', e);
        }

        try {
          component.addRepresentation('ball+stick', {
            sele: 'hetero and not water',
            aspectRatio: 1.1,
          });
        } catch (e) {
          console.warn('Ball+stick representation failed', e);
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
      } catch (err) {
        console.error('NMRMoleculeViewer error:', err);

        if (!cancelled) {
          setErrorMsg(
            err?.message ||
              'Failed to load structure. If using a URL, check that it is HTTPS, CORS-enabled, and returns a PDB/CIF file.'
          );
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
      manualHighlightCompRef.current = null;
      labelCompRef.current = null;
      sidechainCompRef.current = null;
    };
  }, [loadRequest]);

  // Atom labels
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
      }
    };

    clearLabels();

    if (showLabels) {
      try {
        labelCompRef.current = component.addRepresentation('label', {
          sele: 'protein and sidechain and not hydrogen',
          labelType: 'atomname',
          labelGrouping: 'atom',
          color: 0x111827,
          radius: 1.0,
          opacity: 1,
          depthTest: false,
        });
      } catch (e) {
        console.warn('Label representation failed', e);
      }
    }

    return clearLabels;
  }, [showLabels, status]);

  // Side-chain representation
  useEffect(() => {
    const component = componentRef.current;
    if (!component || status !== 'ready') return;

    const clearSidechain = () => {
      if (sidechainCompRef.current) {
        try {
          component.removeRepresentation(sidechainCompRef.current);
        } catch (e) {
          // ignore
        }
        sidechainCompRef.current = null;
      }
    };

    clearSidechain();

    if (sidechainStyle !== 'none') {
      try {
        sidechainCompRef.current = component.addRepresentation(sidechainStyle, {
          // Explicit grouping helps NGL draw CA-CB bonds correctly
          sele: '(protein and sidechain) or (protein and .CA)',
          color: 'element',
          multipleBond: true,
          radiusSize: sidechainStyle === 'licorice' ? 0.25 : undefined,
        });
      } catch (e) {
        console.warn('Sidechain representation failed', e);
      }
    }

    return clearSidechain;
  }, [sidechainStyle, status]);

  // Highlight selected and manually selected atoms
  useEffect(() => {
    const component = componentRef.current;
    if (!component || status !== 'ready') return;

    const clearHighlights = () => {
      if (highlightCompRef.current) {
        try {
          component.removeRepresentation(highlightCompRef.current);
        } catch (e) {
          // ignore
        }
        highlightCompRef.current = null;
      }

      if (manualHighlightCompRef.current) {
        try {
          component.removeRepresentation(manualHighlightCompRef.current);
        } catch (e) {
          // ignore
        }
        manualHighlightCompRef.current = null;
      }
    };

    clearHighlights();

    const sel = Array.isArray(selectedKeys) ? selectedKeys : [];
    const man = Array.isArray(manualKeys)
      ? manualKeys.filter((k) => !sel.includes(k))
      : [];

    if (sel.length === 0 && man.length === 0) return;

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

        if (atomName === 'N') {
          pdbNames.push('N');
        } else if (atomName === 'Cα') {
          pdbNames.push('CA');
        } else if (atomName === 'Cβ') {
          pdbNames.push('CB');
        } else if (atomName === "C'") {
          pdbNames.push('C');
        } else if (atomName === 'O') {
          pdbNames.push('O');
        } else {
          // Dynamically translate Greek back to PDB heavy atoms for highlighting
          const match = atomName.match(/^([CNO])([αβγδεζη])(\d*)$/);

          if (match) {
            pdbNames.push(`${match[1]}${REVERSE_GREEK[match[2]]}${match[3]}`);
          }
        }

        if (pdbNames.length === 0) {
          pdbNames.push(atomName);
        }

        pdbNames.forEach((pn) => {
          parts.push(`${resno} and .${pn}`);
        });
      });

      return parts.length > 0 ? parts.join(' or ') : null;
    };

    try {
      const selSele = buildSele(sel);

      if (selSele) {
        highlightCompRef.current = component.addRepresentation('ball+stick', {
          sele: selSele,
          color: SELECT_COLOR_HEX,
          aspectRatio: 1.5,
          radius: 0.4,
        });
      }

      const manSele = buildSele(man);

      if (manSele) {
        manualHighlightCompRef.current = component.addRepresentation('ball+stick', {
          sele: manSele,
          color: MANUAL_COLOR_HEX,
          aspectRatio: 1.5,
          radius: 0.4,
        });
      }
    } catch (e) {
      console.warn('Highlight error:', e);
    }

    return clearHighlights;
  }, [selectedKeys, manualKeys, status]);

  const handleFileChange = useCallback((e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;

    setFile(f);
    setPdbId('');

    setLoadRequest({
      file: f,
      url: null,
      ts: Date.now(),
    });

    // Allow selecting the same file again later
    e.target.value = '';
  }, []);

  const handlePdbIdLoad = useCallback(() => {
    const value = pdbId.trim();
    if (!value) return;

    setFile(null);

    setLoadRequest({
      file: null,
      url: value,
      ts: Date.now(),
    });
  }, [pdbId]);

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
              accept=".pdb,.cif,.bcif,.ent,.mol2,.sdf"
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
            PDB ID or URL
          </label>

          <div className="flex gap-1">
            <input
              type="text"
              value={pdbId}
              onChange={(e) => setPdbId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handlePdbIdLoad();
              }}
              placeholder="1TUP or https://files.rcsb.org/download/1TUP.cif"
              className="border border-slate-300 rounded-lg px-3 py-2 text-xs w-72 bg-white outline-none focus:border-blue-500 font-mono"
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

          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer h-8">
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(e) => setShowLabels(e.target.checked)}
              className="w-4 h-4 accent-blue-600"
            />
            Show atom names
          </label>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">
            Side Chains
          </label>

          <select
            value={sidechainStyle}
            onChange={(e) => setSidechainStyle(e.target.value)}
            className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 h-8"
          >
            <option value="none">Hidden</option>
            <option value="line">Lines (Thin)</option>
            <option value="licorice">Licorice (Thick)</option>
            <option value="ball+stick">Ball &amp; Stick</option>
            <option value="spacefill">Spacefill</option>
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
                Load a PDB file, enter a PDB ID, or paste a structure URL
              </p>
              <p className="text-xs mt-1">
                Tip: you cannot paste a local file path — use the file picker button above
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default NMRMoleculeViewer;
