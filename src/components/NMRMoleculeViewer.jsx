import React, { useCallback, useEffect, useRef, useState } from 'react';

/* ============================================================================
   NMRMoleculeViewer
   - NGL-based 3D molecular viewer
   - Load by PDB code or local file
   - Hover labels for ALL atoms
   - Optional persistent labels for ALL atoms
   - Click atom -> onAtomClick(ri, keys)
   - Highlights selectedKeys / manualKeys
========================================================================== */

const SELECT_COLOR = 0xf59e0b;
const MANUAL_COLOR = 0x16a34a;

const GREEK_FROM_PDB = {
  A: 'α',
  B: 'β',
  G: 'γ',
  D: 'δ',
  E: 'ε',
  Z: 'ζ',
  H: 'η'
};

const PROTEIN_SPECIAL = {
  N: ['N', 'HN'],
  HN: ['HN', 'N'],
  H: ['HN', 'N'],
  H1: ['HN', 'N'],
  H2: ['HN', 'N'],
  H3: ['HN', 'N'],

  CA: ['Cα', 'Hα'],
  HA: ['Hα', 'Cα'],
  HA1: ['Hα1', 'Cα'],
  HA2: ['Hα2', 'Cα'],

  C: ["C'"],
  O: ["O"],

  CB: ['Cβ'],
  HB: ['Hβ', 'Cβ'],
  HB1: ['Hβ1', 'Hβ', 'Cβ'],
  HB2: ['Hβ2', 'Hβ', 'Cβ'],
  HB3: ['Hβ', 'Cβ'],

  CG: ['Cγ'],
  CG1: ['Cγ1'],
  CG2: ['Cγ2'],

  HG: ['Hγ', 'Cγ'],
  HG1: ['Hγ1', 'Hγ', 'Cγ1'],
  HG2: ['Hγ2', 'Hγ', 'Cγ2'],
  HG3: ['Hγ', 'Cγ'],

  CD: ['Cδ'],
  CD1: ['Cδ1'],
  CD2: ['Cδ2'],

  HD: ['Hδ', 'Cδ'],
  HD1: ['Hδ1', 'Hδ', 'Cδ1'],
  HD2: ['Hδ2', 'Hδ', 'Cδ2'],
  HD3: ['Hδ', 'Cδ'],

  CE: ['Cε'],
  CE1: ['Cε1'],
  CE2: ['Cε2'],
  CE3: ['Cε3'],

  HE: ['Hε', 'Cε'],
  HE1: ['Hε1', 'Hε', 'Cε1'],
  HE2: ['Hε2', 'Hε', 'Cε2'],
  HE3: ['Hε3', 'Hε', 'Cε3'],

  CZ: ['Cζ'],
  CZ2: ['Cζ2'],
  CZ3: ['Cζ3'],

  HZ: ['Hζ', 'Cζ'],
  HZ1: ['Hζ(NH3)', 'Hζ', 'Cζ'],
  HZ2: ['Hζ(NH3)', 'Hζ', 'Cζ'],
  HZ3: ['Hζ(NH3)', 'Hζ', 'Cζ'],

  CH2: ['Cη2'],
  HH2: ['Hη2', 'Cη2'],

  HD21: ['Hδ21', 'Hδ2', 'Hδ'],
  HD22: ['Hδ22', 'Hδ2', 'Hδ'],
  HE21: ['Hε21', 'Hε2', 'Hε'],
  HE22: ['Hε22', 'Hε2', 'Hε']
};

const normalizeToken = (s) =>
  String(s || '')
    .trim()
    .replace(/\*/g, "'");

const tokenKeys = (ri, token) => {
  const t = normalizeToken(token);

  if (!t || ri === null || ri === undefined || !Number.isFinite(Number(ri))) {
    return [];
  }

  const keys = new Set();

  keys.add(`${ri}-${t}`);
  keys.add(`${ri}-${String(t).trim()}`);
  keys.add(`${ri}-${t} `);

  if (String(t).includes("'")) {
    keys.add(`${ri}-${String(t).replace(/'/g, '*')}`);
  }

  return [...keys];
};

function proteinAtomToTokens(raw) {
  let name = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/^[0-9]+/, '');

  if (!name) return [];

  if (PROTEIN_SPECIAL[name]) return PROTEIN_SPECIAL[name];

  const noAlt = name.replace(/^[0-9]+/, '');
  if (PROTEIN_SPECIAL[noAlt]) return PROTEIN_SPECIAL[noAlt];

  const m = name.match(/^([CH])([ABGDEZH])(\d*)$/);

  if (m) {
    const atom = m[1];
    const greek = GREEK_FROM_PDB[m[2]];
    let num = m[3] || '';

    if (!greek) return [];

    // For methyl-style names such as HG11, HG12, HG13 -> map to Hγ1 group
    if (num.length > 1) num = num[0];

    if (atom === 'C') {
      return [`C${greek}${num}`];
    }

    const tokens = [`H${greek}${num}`];

    if (num) {
      tokens.push(`H${greek}`);
    }

    tokens.push(`C${greek}${num}`);

    return tokens;
  }

  return [];
}

function nucleicAtomToTokens(raw) {
  let name = String(raw || '')
    .trim()
    .replace(/^[0-9]+/, '')
    .replace(/\*/g, "'");

  if (!name) return [];

  if (name === 'P') return ['P'];

  if (/^[CHNOP]/i.test(name)) {
    return [name];
  }

  return [];
}

function mapAtomToNmrKeys(atomInfo, moleculeType, residueOffset) {
  const resno = Number(atomInfo?.resno);

  if (!Number.isFinite(resno)) return null;

  const ri = resno - 1 + Number(residueOffset || 0);

  let tokens = [];

  if (moleculeType === 'protein') {
    tokens = proteinAtomToTokens(atomInfo.atomname);
  } else if (moleculeType === 'dna' || moleculeType === 'rna') {
    tokens = nucleicAtomToTokens(atomInfo.atomname);
  } else {
    tokens = [normalizeToken(atomInfo.atomname)].filter(Boolean);
  }

  const raw = normalizeToken(atomInfo.atomname);
  if (raw) tokens.push(raw);

  const keys = new Set();

  tokens.forEach((t) => {
    tokenKeys(ri, t).forEach((k) => keys.add(k));
  });

  const label = `${atomInfo.resname || ''} ${atomInfo.resno || ''} ${
    atomInfo.atomname || ''
  }`.trim();

  return {
    ri,
    keys: [...keys],
    label
  };
}

export default function NMRMoleculeViewer({
  initialPdbId = '',
  onAtomClick = null,
  selectedKeys = null,
  manualKeys = [],
  moleculeType = 'protein',
  parsedSeq = [],
  residueOffset = 0,
  height = '520px'
}) {
  const containerRef = useRef(null);

  const stageRef = useRef(null);
  const componentRef = useRef(null);
  const labelRepsRef = useRef([]);
  const highlightRef = useRef(null);
  const keyIndexRef = useRef(new Map());

  const lastHoverRef = useRef('');

  const labelModeRef = useRef('all');
  const onAtomClickRef = useRef(onAtomClick);
  const parsedSeqRef = useRef(parsedSeq);
  const moleculeTypeRef = useRef(moleculeType);
  const residueOffsetRef = useRef(residueOffset);

  const [nglModule, setNglModule] = useState(null);
  const [structure, setStructure] = useState(null);

  const [pdbInput, setPdbInput] = useState(initialPdbId || '');
  const [labelMode, setLabelMode] = useState('all');

  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [hoverLabel, setHoverLabel] = useState('');

  useEffect(() => {
    labelModeRef.current = labelMode;
  }, [labelMode]);

  useEffect(() => {
    onAtomClickRef.current = onAtomClick;
  }, [onAtomClick]);

  useEffect(() => {
    parsedSeqRef.current = parsedSeq;
  }, [parsedSeq]);

  useEffect(() => {
    moleculeTypeRef.current = moleculeType;
  }, [moleculeType]);

  useEffect(() => {
    residueOffsetRef.current = residueOffset;
  }, [residueOffset]);

  // Load NGL
  useEffect(() => {
    let alive = true;

    import('ngl')
      .then((mod) => {
        if (!alive) return;
        setNglModule(mod);
      })
      .catch((err) => {
        console.error(err);
        if (!alive) return;
        setError('NGL could not be loaded. Please install it with: npm install ngl');
      });

    return () => {
      alive = false;
    };
  }, []);

  const loadPdbCode = useCallback((code) => {
    const c = String(code || '').trim();

    if (!c) return;

    setError('');

    if (/^https?:\/\//i.test(c)) {
      setStructure({
        kind: 'url',
        url: c,
        label: c
      });
      return;
    }

    const id = c.toUpperCase();

    setStructure({
      kind: 'url',
      url: `rcsb://${id}`,
      fallbackUrl: `https://files.rcsb.org/download/${id}.pdb`,
      label: id
    });
  }, []);

  useEffect(() => {
    if (initialPdbId) {
      setPdbInput(initialPdbId);
      loadPdbCode(initialPdbId);
    }
  }, [initialPdbId, loadPdbCode]);

  const onFileChange = (e) => {
    const file = e.target.files && e.target.files[0];

    if (!file) return;

    setError('');

    setStructure({
      kind: 'file',
      file,
      label: file.name
    });

    e.target.value = '';
  };

  // Main NGL loading effect
  useEffect(() => {
    if (!structure || !containerRef.current || !nglModule) return;

    let cancelled = false;

    const NGL = nglModule.default || nglModule;

    setStatus('loading');
    setError('');
    setHoverLabel('');

    if (stageRef.current) {
      try {
        stageRef.current.dispose();
      } catch (err) {
        console.warn(err);
      }

      stageRef.current = null;
      componentRef.current = null;
      labelRepsRef.current = [];
      highlightRef.current = null;
      keyIndexRef.current = new Map();
    }

    const stage = new NGL.Stage(containerRef.current, {
      backgroundColor: '#f8fafc'
    });

    stageRef.current = stage;

    const hoverHandler = (pickingProxy) => {
      if (labelModeRef.current === 'none') {
        setHoverLabel('');
        return;
      }

      if (!pickingProxy || !pickingProxy.atom) {
        if (lastHoverRef.current) {
          lastHoverRef.current = '';
          setHoverLabel('');
        }
        return;
      }

      const atom = pickingProxy.atom;

      const mapped = mapAtomToNmrKeys(
        atom,
        moleculeTypeRef.current,
        residueOffsetRef.current
      );

      const label =
        mapped?.label ||
        `${atom.resname || ''} ${atom.resno || ''} ${atom.atomname || ''}`.trim();

      if (label !== lastHoverRef.current) {
        lastHoverRef.current = label;
        setHoverLabel(label);
      }
    };

    const clickHandler = (pickingProxy) => {
      if (!pickingProxy || !pickingProxy.atom) return;
      if (!onAtomClickRef.current) return;

      const atom = pickingProxy.atom;

      const mapped = mapAtomToNmrKeys(
        atom,
        moleculeTypeRef.current,
        residueOffsetRef.current
      );

      if (!mapped || !mapped.keys || !mapped.keys.length) return;

      const seq = parsedSeqRef.current;

      if (seq && seq.length && (mapped.ri < 0 || mapped.ri >= seq.length)) {
        return;
      }

      onAtomClickRef.current(mapped.ri, mapped.keys);
    };

    stage.signals.hovered.add(hoverHandler);
    stage.signals.clicked.add(clickHandler);

    async function run() {
      try {
        let component;

        try {
          component = await stage.loadFile(
            structure.kind === 'file' ? structure.file : structure.url
          );
        } catch (firstError) {
          if (structure.fallbackUrl) {
            component = await stage.loadFile(structure.fallbackUrl);
          } else {
            throw firstError;
          }
        }

        if (cancelled) return;

        componentRef.current = component;

        // Basic representation
        component.addRepresentation('cartoon', {
          sele: 'polymer',
          color: 'chainid'
        });

        component.addRepresentation('ball+stick', {
          sele: 'hetero and not water',
          aspectRatio: 1.1
        });

        component.addRepresentation('line', {
          sele: 'not polymer and not hetero',
          opacity: 0.55
        });

        component.autoView();

        // Build key index for selection highlighting
        const idx = new Map();

        const addPosition = (key, position) => {
          if (!idx.has(key)) idx.set(key, []);
          idx.get(key).push(position);
        };

        if (
          component.structure &&
          typeof component.structure.eachAtom === 'function'
        ) {
          component.structure.eachAtom((atom) => {
            const info = {
              atomname: atom.atomname,
              resno: atom.resno,
              resname: atom.resname,
              chainname: atom.chainname,
              x: atom.x,
              y: atom.y,
              z: atom.z
            };

            const mapped = mapAtomToNmrKeys(
              info,
              moleculeTypeRef.current,
              residueOffsetRef.current
            );

            const position = {
              x: info.x,
              y: info.y,
              z: info.z,
              label: mapped?.label || info.atomname
            };

            const raw = normalizeToken(info.atomname);

            if (raw && Number.isFinite(mapped?.ri)) {
              tokenKeys(mapped.ri, raw).forEach((k) => addPosition(k, position));
            }

            if (mapped && mapped.keys && mapped.keys.length) {
              mapped.keys.forEach((k) => addPosition(k, position));
            }
          });
        }

        keyIndexRef.current = idx;

        setStatus('ready');
      } catch (err) {
        console.error(err);

        if (!cancelled) {
          setError('Could not load the structure. Check the PDB code, URL, or file.');
          setStatus('error');
        }
      }
    }

    run();

    return () => {
      cancelled = true;

      try {
        stage.signals.hovered.remove(hoverHandler);
        stage.signals.clicked.remove(clickHandler);
      } catch (err) {
        console.warn(err);
      }

      try {
        stage.dispose();
      } catch (err) {
        console.warn(err);
      }

      stageRef.current = null;
      componentRef.current = null;
      labelRepsRef.current = [];
      highlightRef.current = null;
      keyIndexRef.current = new Map();
    };
  }, [structure, nglModule]);

  // Persistent labels: all atoms
  useEffect(() => {
    const component = componentRef.current;

    if (!component || status !== 'ready') return;

    labelRepsRef.current.forEach((rep) => {
      try {
        if (typeof component.removeRepresentation === 'function') {
          component.removeRepresentation(rep);
        } else if (rep && typeof rep.dispose === 'function') {
          rep.dispose();
        }
      } catch (err) {
        console.warn(err);
      }
    });

    labelRepsRef.current = [];

    if (labelMode === 'all') {
      try {
        const rep = component.addRepresentation('label', {
          sele: 'all',
          labelType: 'atomname',
          labelGrouping: 'atom',
          color: 0x111111,
          radius: 0.4,
          xOffset: 0,
          yOffset: 0.5,
          zOffset: 0.5,
          showBackground: false,
          opacity: 1
        });

        labelRepsRef.current.push(rep);
      } catch (err) {
        console.warn('Could not add all-atom labels:', err);
      }
    }
  }, [labelMode, status, structure]);

  // Highlight selected/manual keys
  const selectedKeyString = Array.isArray(selectedKeys)
    ? selectedKeys.join('|')
    : '';

  const manualKeyString = Array.isArray(manualKeys)
    ? manualKeys.join('|')
    : '';

  useEffect(() => {
    const stage = stageRef.current;
    const NGL = nglModule ? nglModule.default || nglModule : null;

    if (!stage || !NGL || status !== 'ready') return;

    if (highlightRef.current) {
      try {
        stage.removeComponent(highlightRef.current);
      } catch (err) {
        console.warn(err);
      }

      highlightRef.current = null;
    }

    const shape = new NGL.Shape('nmr-selection');

    let hasGraphics = false;

    const addSpheres = (keys, color, opacity, radius) => {
      (keys || []).forEach((key) => {
        const positions = keyIndexRef.current.get(key) || [];

        positions.forEach((p) => {
          shape.addSphere([p.x, p.y, p.z], {
            color,
            opacity,
            radius
          });

          hasGraphics = true;
        });
      });
    };

    const selected = Array.isArray(selectedKeys) ? selectedKeys : [];

    const manual = (Array.isArray(manualKeys) ? manualKeys : []).filter(
      (k) => !selected.includes(k)
    );

    addSpheres(manual, MANUAL_COLOR, 0.25, 1.2);
    addSpheres(selected, SELECT_COLOR, 0.35, 1.5);

    if (hasGraphics) {
      try {
        highlightRef.current = stage.addComponentFromObject(shape);
      } catch (err) {
        console.warn(err);
      }
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKeyString, manualKeyString, status, nglModule, structure]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">
            PDB code or URL
          </label>

          <div className="flex gap-1">
            <input
              value={pdbInput}
              onChange={(e) => setPdbInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  loadPdbCode(pdbInput);
                }
              }}
              placeholder="e.g. 1UBQ"
              className="border border-slate-300 rounded-lg px-3 py-2 text-xs w-36 bg-white outline-none focus:border-blue-500 font-mono"
            />

            <button
              type="button"
              onClick={() => loadPdbCode(pdbInput)}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-2 rounded-lg text-xs shadow-sm"
            >
              Load
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">
            Local file
          </label>

          <input
            type="file"
            accept=".pdb,.cif,.ent,.mol2,.sdf"
            onChange={onFileChange}
            className="text-xs"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">
            Atom names
          </label>

          <div className="flex bg-slate-200 p-1 rounded-lg">
            {[
              ['none', 'None'],
              ['hover', 'Hover'],
              ['all', 'All atoms']
            ].map(([value, lab]) => (
              <button
                key={value}
                type="button"
                onClick={() => setLabelMode(value)}
                className={`px-2 py-1 text-[11px] font-bold rounded-md transition-colors ${
                  labelMode === value
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {lab}
              </button>
            ))}
          </div>
        </div>

        {structure?.label && (
          <span className="text-xs text-slate-500 font-bold">
            Loaded: {structure.label}
          </span>
        )}
      </div>

      {labelMode === 'all' && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 w-fit">
          All-atom labels can be slow for large PDB entries. If the browser freezes,
          switch to Hover.
        </p>
      )}

      <div
        className="relative border border-slate-200 rounded-xl overflow-hidden bg-white"
        style={{ height }}
      >
        <div ref={containerRef} className="w-full h-full" />

        {hoverLabel && labelMode !== 'none' && (
          <div className="absolute top-2 left-2 bg-white/90 border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm pointer-events-none z-10">
            {hoverLabel}
          </div>
        )}

        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 z-20">
            <div className="text-center">
              <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
              <p className="text-sm text-slate-500 font-bold">Loading structure…</p>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/85 z-20 p-4">
            <div className="text-center max-w-md">
              <p className="text-red-600 text-sm font-bold mb-1">
                Could not load structure
              </p>
              <p className="text-slate-500 text-xs">{error}</p>
            </div>
          </div>
        )}

        {status === 'idle' && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50 z-10">
            <div className="text-center text-slate-400 px-6">
              <p className="text-4xl mb-2">🧬</p>
              <p className="text-sm font-bold">
                Enter a PDB code, paste a URL, or choose a local structure file.
              </p>
            </div>
          </div>
        )}

        {error && status !== 'error' && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/85 z-20 p-4">
            <div className="text-center max-w-md">
              <p className="text-red-600 text-sm font-bold mb-1">Error</p>
              <p className="text-slate-500 text-xs">{error}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
