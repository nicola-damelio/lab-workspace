import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildKeys } from './NMRData';

const SELECT_COLOR = '#f59e0b';
const MANUAL_COLOR = '#16a34a';

const normalizeAtomName = (s) =>
  String(s || '')
    .trim()
    .replace(/\*/g, "'")
    .replace(/\s+/g, '');

const PROTEIN_H_ALIASES = {
  H: 'HN',
  HN: 'HN',
  HA: 'Hα',
  HA1: 'Hα1',
  HA2: 'Hα2',
  HB: 'Hβ',
  HB1: 'Hβ1',
  HB2: 'Hβ2',
  HB3: 'Hβ',
  HG: 'Hγ',
  HG1: 'Hγ1',
  HG2: 'Hγ2',
  HG3: 'Hγ',
  HD: 'Hδ',
  HD1: 'Hδ1',
  HD2: 'Hδ2',
  HD3: 'Hδ',
  HE: 'Hε',
  HE1: 'Hε1',
  HE2: 'Hε2',
  HE3: 'Hε3',
  HZ: 'Hζ',
  HZ1: 'Hζ(NH3)',
  HZ2: 'Hζ(NH3)',
  HZ3: 'Hζ(NH3)',
  HH: 'Hη2',
  HH1: 'Hη2',
  HH2: 'Hη2'
};

const PROTEIN_C_ALIASES = {
  CA: 'Cα',
  CB: 'Cβ',
  CG: 'Cγ',
  CG1: 'Cγ1',
  CG2: 'Cγ2',
  CD: 'Cδ',
  CD1: 'Cδ1',
  CD2: 'Cδ2',
  CE: 'Cε',
  CE1: 'Cε1',
  CE2: 'Cε2',
  CZ: 'Cζ',
  CZ2: 'Cζ2',
  CZ3: 'Cζ3',
  CH2: 'Cη2',
  C: "C'"
};

function createNmrAtomMapper({
  moleculeType,
  parsedSeq,
  residueOffset = 0,
  atomNameMap = {}
}) {
  const customMap = Object.fromEntries(
    Object.entries(atomNameMap || {}).map(([k, v]) => [normalizeAtomName(k), v])
  );

  return (atomInfo) => {
    if (!parsedSeq || !parsedSeq.length) return null;

    let idx = 0;

    if (moleculeType === 'protein' || moleculeType === 'dna' || moleculeType === 'rna') {
      const resno = Number(atomInfo?.resno);
      if (!Number.isFinite(resno)) return null;

      idx = resno - 1 + Number(residueOffset || 0);
      if (idx < 0 || idx >= parsedSeq.length) return null;
    }

    const res = parsedSeq[idx];
    if (!res) return null;

    const raw = String(atomInfo?.atomname || '').trim();
    const norm = normalizeAtomName(raw);
    const upper = norm.toUpperCase();

    if (customMap[norm]) {
      const mapped = customMap[norm];
      const keys = buildKeys(idx, [mapped], moleculeType, res.char);
      return {
        ri: idx,
        keys,
        label: `${res.id} ${String(mapped).trim()}`
      };
    }

    if (upper === 'P') {
      return {
        ri: idx,
        keys: [`${idx}-P`],
        label: `${res.id} P`
      };
    }

    if (moleculeType === 'protein') {
      if (upper === 'N') {
        return {
          ri: idx,
          keys: [`${idx}-N`],
          label: `${res.id} N`
        };
      }

      if (PROTEIN_C_ALIASES[upper]) {
        const carbon = PROTEIN_C_ALIASES[upper];
        return {
          ri: idx,
          keys: [`${idx}-${carbon}`],
          label: `${res.id} ${carbon}`
        };
      }

      if (PROTEIN_H_ALIASES[upper]) {
        const mapped = PROTEIN_H_ALIASES[upper];
        const keys = buildKeys(idx, [mapped], moleculeType, res.char);
        return {
          ri: idx,
          keys,
          label: `${res.id} ${mapped}`
        };
      }
    }

    const exact = (res.atoms || []).find(
      (a) => normalizeAtomName(a) === norm
    );

    if (exact) {
      const keys = buildKeys(idx, [exact], moleculeType, res.char);
      return {
        ri: idx,
        keys,
        label: `${res.id} ${String(exact).trim()}`
      };
    }

    if (norm.startsWith('H')) {
      const keys = buildKeys(idx, [norm], moleculeType, res.char);
      return {
        ri: idx,
        keys,
        label: `${res.id} ${norm}`
      };
    }

    return null;
  };
}

export default function NMRMoleculeViewer({
  src,
  moleculeType,
  parsedSeq,
  selectedKeys,
  manualKeys = [],
  onAtomClick,
  residueOffset = 0,
  atomNameMap = {},
  labelMode = 'selected',
  height = '520px'
}) {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const nglRef = useRef(null);
  const modelRef = useRef(null);
  const highlightRef = useRef(null);
  const keyIndexRef = useRef(new Map());

  const [status, setStatus] = useState('loading');
  const [hoverLabel, setHoverLabel] = useState('');

  const mapper = useMemo(
    () =>
      createNmrAtomMapper({
        moleculeType,
        parsedSeq,
        residueOffset,
        atomNameMap
      }),
    [moleculeType, parsedSeq, residueOffset, atomNameMap]
  );

  const resolvedSrc = useMemo(() => {
    const s = String(src || '').trim();

    if (!s) {
      const defaults = {
        protein: '1UBQ',
        dna: '1BNA',
        rna: '1EHZ'
      };

      const id = defaults[moleculeType];
      if (!id) return '';

      return `https://models.rcsb.org/${id}.mmtf`;
    }

    if (/^https?:\/\//i.test(s) || s.startsWith('/') || s.startsWith('./')) {
      return s;
    }

    const id = s.toUpperCase();

    if (/^[0-9][A-Z0-9]{3}$/.test(id)) {
      return `https://models.rcsb.org/${id}.mmtf`;
    }

    return s;
  }, [src, moleculeType]);

  useEffect(() => {
    let cancelled = false;
    let stage = null;
    let clickHandler = null;
    let hoverHandler = null;

    async function init() {
      if (!containerRef.current || !resolvedSrc) {
        setStatus('empty');
        return;
      }

      setStatus('loading');

      try {
        const mod = await import('ngl');
        const ns = mod.default || mod;
        const Stage = ns.Stage || mod.Stage;
        const Shape = ns.Shape || mod.Shape;

        if (cancelled || !containerRef.current) return;

        nglRef.current = { Stage, Shape };

        stage = new Stage(containerRef.current, {
          backgroundColor: 'white'
        });

        stageRef.current = stage;

        const component = await stage.loadFile(resolvedSrc, {
          defaultRepresentation: false
        });

        if (cancelled) return;

        modelRef.current = component;

        if (
          moleculeType === 'protein' ||
          moleculeType === 'dna' ||
          moleculeType === 'rna'
        ) {
          component.addRepresentation('cartoon', {
            sele: 'polymer',
            color: 'chainid'
          });

          component.addRepresentation('ball+stick', {
            sele: 'hetero and not water',
            aspectRatio: 1.2
          });
        } else {
          component.addRepresentation('ball+stick', {
            sele: 'all',
            aspectRatio: 1.2
          });
        }

        component.autoView();

        const idxMap = new Map();

        const addPosition = (key, p) => {
          if (!idxMap.has(key)) idxMap.set(key, []);
          idxMap.get(key).push(p);
        };

        const atomInfoFromNgl = (atom) => ({
          atomname: atom.atomname || atom.atomName || '',
          resno: atom.resno ?? atom.residue?.resno ?? undefined,
          resname: atom.resname || atom.residue?.resname || '',
          chainname: atom.chainname || atom.chain?.chainname || '',
          x: atom.x,
          y: atom.y,
          z: atom.z
        });

        if (
          component.structure &&
          typeof component.structure.eachAtom === 'function'
        ) {
          component.structure.eachAtom((atom) => {
            const info = atomInfoFromNgl(atom);
            const mapped = mapper(info);

            if (!mapped || !Array.isArray(mapped.keys)) return;

            mapped.keys.forEach((key) => {
              addPosition(key, {
                x: info.x,
                y: info.y,
                z: info.z,
                label: mapped.label || key
              });
            });
          });
        }

        keyIndexRef.current = idxMap;

        clickHandler = (pickingProxy) => {
          if (!pickingProxy) return;

          const atom = pickingProxy.atom || pickingProxy;
          if (!atom) return;

          const info = {
            atomname: atom.atomname || atom.atomName || '',
            resno: atom.resno ?? atom.residue?.resno ?? undefined,
            resname: atom.resname || atom.residue?.resname || '',
            chainname: atom.chainname || atom.chain?.chainname || ''
          };

          const mapped = mapper(info);

          if (mapped && onAtomClick) {
            onAtomClick(mapped.ri, mapped.keys);
          }
        };

        hoverHandler = (pickingProxy) => {
          if (!pickingProxy) {
            setHoverLabel('');
            return;
          }

          const atom = pickingProxy.atom || pickingProxy;
          if (!atom) {
            setHoverLabel('');
            return;
          }

          const info = {
            atomname: atom.atomname || atom.atomName || '',
            resno: atom.resno ?? atom.residue?.resno ?? undefined,
            resname: atom.resname || atom.residue?.resname || '',
            chainname: atom.chainname || atom.chain?.chainname || ''
          };

          const mapped = mapper(info);

          setHoverLabel(
            mapped?.label ||
              `${info.resname || ''} ${info.resno || ''} ${info.atomname || ''}`.trim()
          );
        };

        stage.signals.clicked.add(clickHandler);
        stage.signals.hovered.add(hoverHandler);

        setStatus('ready');
      } catch (err) {
        console.error('NMR molecular viewer error:', err);
        if (!cancelled) setStatus('error');
      }
    }

    init();

    return () => {
      cancelled = true;

      if (stage) {
        if (clickHandler) stage.signals.clicked.remove(clickHandler);
        if (hoverHandler) stage.signals.hovered.remove(hoverHandler);
        stage.dispose();
      }

      stageRef.current = null;
      modelRef.current = null;
      highlightRef.current = null;
      keyIndexRef.current = new Map();
    };
  }, [resolvedSrc, moleculeType, mapper, onAtomClick]);

  useEffect(() => {
    const stage = stageRef.current;
    const ngl = nglRef.current;

    if (!stage || !ngl || !ngl.Shape || status !== 'ready') return;

    if (highlightRef.current) {
      stage.removeComponent(highlightRef.current);
      highlightRef.current = null;
    }

    const shape = new ngl.Shape('nmr-selection');
    let hasGraphics = false;

    const addLabel = (p, text) => {
      try {
        shape.addText([p.x, p.y + 1.6, p.z + 0.4], { color: 0x111111, size: 2.4 }, text);
        hasGraphics = true;
      } catch (err) {
        console.warn('Label failed:', err);
      }
    };

    const addKeys = (keys, color, opacity, radius, withLabel) => {
      keys.forEach((key) => {
        const positions = keyIndexRef.current.get(key) || [];

        positions.forEach((p, i) => {
          shape.addSphere([p.x, p.y, p.z], {
            color,
            opacity,
            radius
          });

          hasGraphics = true;

          if (withLabel && i === 0) {
            addLabel(p, p.label || key);
          }
        });
      });
    };

    const selected = Array.isArray(selectedKeys) ? selectedKeys : [];
    const manual = Array.isArray(manualKeys)
      ? manualKeys.filter((k) => !selected.includes(k))
      : [];

    if (labelMode === 'all') {
      keyIndexRef.current.forEach((positions, key) => {
        if (positions[0]) {
          addLabel(positions[0], positions[0].label || key);
        }
      });
    }

    addKeys(manual, MANUAL_COLOR, 0.25, 1.4, labelMode !== 'none');
    addKeys(selected, SELECT_COLOR, 0.4, 1.8, labelMode !== 'none');

    if (hasGraphics) {
      highlightRef.current = stage.addComponentFromObject(shape);
    }
  }, [selectedKeys, manualKeys, status, labelMode]);

  return (
    <div
      className="relative border border-slate-200 rounded-xl overflow-hidden bg-white"
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

      {status === 'empty' && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 text-slate-400 text-sm font-bold p-6 text-center pointer-events-none">
          Enter a PDB ID, URL, or local structure file.
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/85 text-red-600 text-sm font-bold p-6 text-center pointer-events-none">
          Could not load the molecular viewer. Check that `ngl` is installed and the structure URL is valid.
        </div>
      )}
    </div>
  );
}
