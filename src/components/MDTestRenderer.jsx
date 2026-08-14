import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell
} from 'recharts';
import TestShellRenderer, { CollapsibleSection } from './TestShellRenderer';
import {
  buildNotebookHtml as buildMDNotebookHtmlFromSections
} from './MDSections';
import {
  AMINO_ACID_DB,
  NUCLEOTIDE_DB,
  SUGAR_DB,
  LIPID_DB,
  SS_META,
  RESIDUE_COLORS,
  buildProteinStructure,
  buildNucleicStructure,
  buildSugarStructure,
  buildLipidStructure,
  StructureSVGView,
  SequencePaintStrip,
  getSelectedKeys,
  getManualKeys
} from './NMRData';

/* ============================================================================
   MDTestRenderer — corrected self-contained file.
   - Fixed undefined MDSections reference
   - Fixed JSX syntax issues
   - Fixed Google Drive / Dropbox URL handling
   - Improved parameter parsing
   - Improved trajectory playback safety
============================================================================ */

// ================= MD DATABASES =================

const FORCE_FIELDS = {
  GROMOS: {
    name: 'GROMOS',
    versions: ['54a7', '54a8', '53a6', '45a3']
  },
  OPLS: {
    name: 'OPLS-AA/M',
    versions: ['opls-aa', 'opls2005', 'opls3e', 'opls4']
  },
  CHARMM: {
    name: 'CHARMM',
    versions: ['charmm27', 'charmm36', 'charmm36m']
  },
  AMBER: {
    name: 'AMBER',
    versions: ['ff99SB', 'ff14SB', 'ff19SB']
  },
  MARTINI: {
    name: 'Martini',
    versions: ['2.2', '3.0']
  }
};

const FF_ATOM_TYPES = {
  GROMOS: [
    { atom: 'N', type: 'N', mass: 14.007, charge: -0.47 },
    { atom: 'HN', type: 'H', mass: 1.008, charge: 0.31 },
    { atom: 'CA', type: 'CH1', mass: 13.019, charge: 0.07 },
    { atom: 'HA', type: 'H', mass: 1.008, charge: 0.077 },
    { atom: 'C', type: 'C', mass: 12.011, charge: 0.51 },
    { atom: 'O', type: 'O', mass: 15.999, charge: -0.51 }
  ],
  OPLS: [
    { atom: 'N', type: 'opls_238', mass: 14.007, charge: -0.5 },
    { atom: 'HN', type: 'opls_240', mass: 1.008, charge: 0.3 },
    { atom: 'CA', type: 'opls_224', mass: 13.019, charge: 0.14 },
    { atom: 'HA', type: 'opls_140', mass: 1.008, charge: 0.095 },
    { atom: 'C', type: 'opls_235', mass: 12.011, charge: 0.5 },
    { atom: 'O', type: 'opls_236', mass: 15.999, charge: -0.5 }
  ],
  CHARMM: [
    { atom: 'N', type: 'NH1', mass: 14.007, charge: -0.47 },
    { atom: 'HN', type: 'H', mass: 1.008, charge: 0.31 },
    { atom: 'CA', type: 'CT1', mass: 12.011, charge: 0.07 },
    { atom: 'HA', type: 'HB1', mass: 1.008, charge: 0.09 },
    { atom: 'C', type: 'C', mass: 12.011, charge: 0.51 },
    { atom: 'O', type: 'O', mass: 15.999, charge: -0.51 }
  ],
  AMBER: [
    { atom: 'N', type: 'N', mass: 14.007, charge: -0.4157 },
    { atom: 'HN', type: 'H', mass: 1.008, charge: 0.2719 },
    { atom: 'CA', type: 'CT', mass: 12.011, charge: 0.0337 },
    { atom: 'HA', type: 'H1', mass: 1.008, charge: 0.0823 },
    { atom: 'C', type: 'C', mass: 12.011, charge: 0.5973 },
    { atom: 'O', type: 'O', mass: 15.999, charge: -0.5679 }
  ],
  MARTINI: [
    { atom: 'BB', type: 'P5', mass: 72.0, charge: 0.0 }
  ]
};

const WATER_MODELS = {
  TIP3P: { name: 'TIP3P', sites: 3 },
  TIP4P: { name: 'TIP4P', sites: 4 },
  SPC: { name: 'SPC', sites: 3 },
  SPCE: { name: 'SPC/E', sites: 3 },
  OPC: { name: 'OPC', sites: 4 }
};

const MD_ENSEMBLES = [
  ['NVE', 'NVE (Microcanonical)'],
  ['NVT', 'NVT (Canonical)'],
  ['NPT', 'NPT (Isothermal–Isobaric)']
];

const MD_INTEGRATORS = [
  ['verlet', 'Velocity Verlet'],
  ['leapfrog', 'Leap-frog'],
  ['langevin', 'Langevin']
];

const MD_THERMOSTATS = [
  ['nose_hoover', 'Nosé–Hoover'],
  ['v_rescale', 'V-rescale'],
  ['berendsen', 'Berendsen']
];

const MD_BAROSTATS = [
  ['parrinello_rahman', 'Parrinello–Rahman'],
  ['berendsen', 'Berendsen'],
  ['mttk', 'MTTK']
];

const TRAJECTORY_FORMATS = [
  ['xtc', 'XTC (GROMACS)'],
  ['trr', 'TRR (GROMACS)'],
  ['dcd', 'DCD (CHARMM/NAMD)']
];

const MD_PHASES = [
  ['minimization', '⬇️ Energy Minimization'],
  ['equilibration_nvt', '🌡️ Equilibration NVT'],
  ['equilibration_npt', '📦 Equilibration NPT'],
  ['production', '🚀 Production MD']
];

export const MD_TAB_CONFIG = {
  typeKey: 'md',
  typeLabel: 'Molecular Dynamics',
  icon: '🎞️',
  fallbackCategories: [
    'Production MD',
    'Equilibration',
    'Energy Minimization',
    'Steered MD',
    'Replica Exchange',
    'Metadynamics'
  ],
  samples: {
    compounds: true,
    cellLines: false,
    compoundLabel: 'System / Molecule Label(s)',
    cellLineLabel: 'Biological Models'
  },
  imagesKey: 'mdImages',
  conditionFields: [
    { key: 'experimentDate', label: 'Simulation Date', type: 'date' },
    { key: 'forceField', label: 'Force Field', type: 'text', placeholder: 'e.g. CHARMM36m' },
    { key: 'waterModel', label: 'Water Model', type: 'text', placeholder: 'e.g. TIP3P' },
    { key: 'ensemble', label: 'Ensemble', type: 'text', placeholder: 'e.g. NPT' },
    { key: 'timestep', label: 'Time Step', type: 'text', placeholder: 'e.g. 2', units: ['fs', 'ps'] },
    { key: 'nSteps', label: 'Steps', type: 'text', placeholder: 'e.g. 500000' },
    { key: 'simTemperature', label: 'Temperature', type: 'text', placeholder: 'e.g. 300', units: ['K'] },
    { key: 'trajectoryUrl', label: 'Trajectory URL', type: 'text', placeholder: 'https://…/traj.xtc' }
  ],
  notebookChecks: [
    { id: 'cond', label: 'Simulation Parameters' },
    { id: 'seq', label: 'System / Sequence' },
    { id: 'table', label: 'Atom Table' },
    { id: 'formula', label: 'Chemical Formula' }
  ]
};

// ================= HELPERS =================

const getFF = (k) => FORCE_FIELDS[k] || FORCE_FIELDS.GROMOS;
const getFFVersions = (k) => getFF(k).versions || [];
const getWM = (k) => WATER_MODELS[k] || WATER_MODELS.TIP3P;
const getFFAtoms = (k) => FF_ATOM_TYPES[k] || FF_ATOM_TYPES.GROMOS;

const detectTrajFmt = (url) => {
  const u = (url || '').toLowerCase();
  if (u.endsWith('.trr')) return 'trr';
  if (u.endsWith('.dcd')) return 'dcd';
  return 'xtc';
};

const normTrajUrl = (url) => {
  const u = (url || '').trim();

  if (!u) {
    return {
      url: null,
      fallbacks: []
    };
  }

  let m = u.match(/drive\.google\.com\/file\/d\/([^/?]+)/);
  if (m) {
    const id = m[1];
    return {
      url: `https://lh3.googleusercontent.com/d/${id}`,
      fallbacks: [
        `https://drive.google.com/thumbnail?id=${id}&sz=w1600`,
        `https://drive.google.com/uc?export=view&id=${id}`
      ]
    };
  }

  m = u.match(/drive\.google\.com\/(?:open|uc)[^#]*[?&]id=([^&#]+)/);
  if (m) {
    const id = m[1];
    return {
      url: `https://lh3.googleusercontent.com/d/${id}`,
      fallbacks: [
        `https://drive.google.com/thumbnail?id=${id}&sz=w1600`,
        `https://drive.google.com/uc?export=view&id=${id}`
      ]
    };
  }

  if (u.includes('dropbox.com')) {
    try {
      const parsed = new URL(u);
      parsed.searchParams.delete('dl');
      parsed.searchParams.set('raw', '1');

      return {
        url: parsed.toString(),
        fallbacks: [u]
      };
    } catch {
      const cleaned = u.replace(/[?&]dl=0/g, '');
      const raw = cleaned + (cleaned.includes('?') ? '&raw=1' : '?raw=1');

      return {
        url: raw,
        fallbacks: [u]
      };
    }
  }

  return {
    url: u,
    fallbacks: []
  };
};

const genRMSD = (n) =>
  Array.from({ length: n }, (_, i) => ({
    time: +(i * 0.1).toFixed(2),
    value: Math.max(
      0,
      0.15 + 0.15 * (1 - Math.exp((-5 * i) / n)) + (Math.random() - 0.5) * 0.02
    )
  }));

const genRMSF = (n) =>
  Array.from({ length: n }, (_, i) => ({
    residue: i + 1,
    value: 0.1 + Math.random() * 0.15,
    fill: Math.random() > 0.8 ? '#ef4444' : '#3b82f6'
  }));

const genRg = (n) =>
  Array.from({ length: n }, (_, i) => ({
    time: +(i * 0.1).toFixed(2),
    value: 1.8 + (Math.random() - 0.5) * 0.1
  }));

const genSASA = (n) =>
  Array.from({ length: n }, (_, i) => ({
    time: +(i * 0.1).toFixed(2),
    value: 80 + (Math.random() - 0.5) * 5
  }));

const genEnergy = (n) =>
  Array.from({ length: n }, (_, i) => ({
    time: +(i * 0.1).toFixed(2),
    potential:
      -50000 +
      5000 * (1 - Math.exp((-3 * i) / n)) +
      (Math.random() - 0.5) * 500,
    kinetic: 15000 + (Math.random() - 0.5) * 1000,
    total:
      -35000 +
      5000 * (1 - Math.exp((-3 * i) / n)) +
      (Math.random() - 0.5) * 800
  }));

// ================= TRAJECTORY OBJECT HELPERS =================

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
    if (typeof traj.setFrame === 'function') {
      traj.setFrame(frame);
    } else if (traj.trajectory && typeof traj.trajectory.setFrame === 'function') {
      traj.trajectory.setFrame(frame);
    }
  } catch {
    // ignore frame errors
  }
};

// ================= DERIVED HOOK =================

const useMDDerived = (activeTest) => {
  const moleculeType = activeTest.moleculeType || 'protein';

  const rawSeq = (activeTest.proteinSequence || '').toUpperCase();

  const validChars =
    moleculeType === 'protein'
      ? 'ACDEFGHIKLMNPQRSTVWY'
      : moleculeType === 'dna'
        ? 'ACGT'
        : moleculeType === 'rna'
          ? 'ACGU'
          : '';

  const seq = ['protein', 'dna', 'rna'].includes(moleculeType)
    ? rawSeq.replace(new RegExp(`[^${validChars}]`, 'g'), '')
    : '';

  const isPolymer = ['protein', 'dna', 'rna'].includes(moleculeType);

  const DB =
    moleculeType === 'protein'
      ? AMINO_ACID_DB
      : moleculeType === 'dna'
        ? NUCLEOTIDE_DB.DNA
        : moleculeType === 'rna'
          ? NUCLEOTIDE_DB.RNA
          : moleculeType === 'sugar'
            ? SUGAR_DB
            : LIPID_DB;

  const ffKey = activeTest.forceField || 'GROMOS';
  const ffBackbone = getFFAtoms(ffKey);

  const typeLabel =
    moleculeType === 'protein'
      ? 'Protein'
      : moleculeType === 'dna'
        ? 'DNA'
        : moleculeType === 'rna'
          ? 'RNA'
          : moleculeType === 'sugar'
            ? 'Sugar'
            : 'Phospholipid';

  const ssRaw = activeTest.secondaryStructure || '';

  const getSSAt = (i) =>
    ssRaw[i] && 'HES'.includes(ssRaw[i]) ? ssRaw[i] : 'C';

  const parsedSeq = useMemo(() => {
    let chars = [];

    if (isPolymer) {
      if (!seq) return [];
      chars = seq.split('');
    } else if (moleculeType === 'sugar') {
      chars = [activeTest.sugarChoice || 'GLC'];
    } else if (moleculeType === 'lipid') {
      chars = [activeTest.lipidChoice || 'POPC'];
    }

    return chars
      .map((char, index) => {
        const entry = DB[char];
        if (!entry) return null;

        return {
          ...entry,
          id: `${entry.code3 || char}${index + 1}`,
          char,
          color: RESIDUE_COLORS[index % RESIDUE_COLORS.length],
          ffAtoms: ffBackbone.map((a) => ({ ...a }))
        };
      })
      .filter(Boolean);
  }, [
    seq,
    moleculeType,
    activeTest.sugarChoice,
    activeTest.lipidChoice,
    ffKey,
    DB,
    isPolymer,
    ffBackbone
  ]);

  const structure = useMemo(() => {
    if (!parsedSeq.length) return null;

    try {
      if (moleculeType === 'protein') return buildProteinStructure(parsedSeq);

      if (moleculeType === 'dna' || moleculeType === 'rna') {
        return buildNucleicStructure(parsedSeq, moleculeType);
      }

      if (moleculeType === 'sugar') {
        return buildSugarStructure(parsedSeq[0], 'chair', 'alpha');
      }

      if (moleculeType === 'lipid') {
        return buildLipidStructure(parsedSeq[0], 'cis');
      }
    } catch (e) {
      console.warn('MD structure build error:', e);
    }

    return null;
  }, [parsedSeq, moleculeType]);

  const activeValues = useMemo(
    () =>
      (activeTest.mdValues || {})[activeTest.activeLayerKey || 'md'] || {},
    [activeTest.mdValues, activeTest.activeLayerKey]
  );

  return {
    moleculeType,
    seq,
    validChars,
    isPolymer,
    DB,
    typeLabel,
    ffKey,
    ffBackbone,
    parsedSeq,
    structure,
    getSSAt,
    activeValues
  };
};

// ================= 3D VIEWER WITH TRAJECTORY =================

const SELECT_COLOR_HEX = 0xf59e0b;

const MDMoleculeViewer = ({
  structureSrc,
  trajectorySrc,
  trajectoryFallbacks = [],
  trajectoryFormat = 'xtc',
  parsedSeq = [],
  moleculeType = 'protein',
  selectedKeys,
  onAtomClick,
  height = '520px'
}) => {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const componentRef = useRef(null);
  const trajRef = useRef(null);
  const selectionReprRef = useRef(null);

  const parsedSeqRef = useRef(parsedSeq);
  const onAtomClickRef = useRef(onAtomClick);

  useEffect(() => {
    parsedSeqRef.current = parsedSeq;
    onAtomClickRef.current = onAtomClick;
  }, [parsedSeq, onAtomClick]);

  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [hoverInfo, setHoverInfo] = useState(null);

  const [trajStatus, setTrajStatus] = useState('none');
  const [trajError, setTrajError] = useState('');
  const [numFrames, setNumFrames] = useState(0);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);

  // Initialize structure + trajectory
  useEffect(() => {
    if (!structureSrc || !containerRef.current) {
      setStatus('idle');
      return;
    }

    let cancelled = false;

    setPlaying(false);
    setCurrentFrame(0);
    setNumFrames(0);
    setTrajStatus(trajectorySrc ? 'loading' : 'none');
    setTrajError('');

    if (stageRef.current) {
      stageRef.current.dispose();
      stageRef.current = null;
    }

    componentRef.current = null;
    trajRef.current = null;
    selectionReprRef.current = null;

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

        let component;

        const raw = structureSrc.trim();

        const isUrl =
          /^(https?:|blob:|data:)/i.test(raw) ||
          raw.startsWith('/') ||
          raw.startsWith('./');

        if (isUrl) {
          const ext = raw.split(/[?#]/)[0].split('.').pop().toLowerCase();

          component = await stage.loadFile(
            raw,
            ['pdb', 'cif', 'gro', 'mmcif', 'bcif', 'mol2', 'sdf', 'mmtf'].includes(ext)
              ? { ext }
              : {}
          );
        } else if (/^[0-9][A-Za-z0-9]{3}$/i.test(raw)) {
          try {
            component = await stage.loadFile(
              `https://files.rcsb.org/download/${raw.toUpperCase()}.cif`,
              { ext: 'cif' }
            );
          } catch {
            component = await stage.loadFile(`rcsb://${raw.toUpperCase()}`);
          }
        } else {
          component = await stage.loadFile(raw);
        }

        if (cancelled) return;

        componentRef.current = component;
        selectionReprRef.current = null;

        try {
          component.addRepresentation('cartoon', {
            color: 'residueindex',
            quality: 'high'
          });
        } catch {
          // ignore representation error
        }

        try {
          component.addRepresentation('ball+stick', {
            sele: 'hetero and not water',
            aspectRatio: 1.1
          });
        } catch {
          // ignore representation error
        }

        component.autoView();

        stage.signals.clicked.add((pp) => {
          if (!pp || !pp.atom) return;

          const ri = pp.atom.resno - 1;
          const seq = parsedSeqRef.current;

          if (ri < 0 || ri >= seq.length) return;

          if (onAtomClickRef.current) {
            onAtomClickRef.current(ri, [`${ri}-${pp.atom.atomname}`]);
          }
        });

        let lastHover = null;

        stage.signals.hovered.add((pp) => {
          if (!pp || !pp.atom) {
            if (lastHover !== null) {
              lastHover = null;
              setHoverInfo(null);
            }
            return;
          }

          const label = `${pp.atom.resname || ''} ${pp.atom.resno || ''} ${
            pp.atom.atomname || ''
          }`.trim();

          if (label !== lastHover) {
            lastHover = label;
            setHoverInfo(label);
          }
        });

        setStatus('ready');

        // Load trajectory
        if (trajectorySrc) {
          try {
            const candidates = [
              trajectorySrc,
              ...(Array.isArray(trajectoryFallbacks) ? trajectoryFallbacks : [])
            ].filter(Boolean);

            let traj = null;
            let lastErr = null;

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
                te?.message ||
                  'Failed to load trajectory (check CORS + matching atom count).'
              );
            }
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

      if (stageRef.current) {
        stageRef.current.dispose();
        stageRef.current = null;
      }

      componentRef.current = null;
      trajRef.current = null;
      selectionReprRef.current = null;
    };
  }, [structureSrc, trajectorySrc, trajectoryFormat, trajectoryFallbacks]);

  // Playback loop: only update React state here
  useEffect(() => {
    if (!playing || numFrames === 0) return;

    const interval = Math.max(16, 1000 / speed);

    const id = setInterval(() => {
      setCurrentFrame((prev) => (prev + 1) % numFrames);
    }, interval);

    return () => clearInterval(id);
  }, [playing, speed, numFrames]);

  // Apply frame changes to trajectory object
  useEffect(() => {
    if (trajStatus === 'ready' && trajRef.current) {
      setFrameSafe(trajRef.current, currentFrame);
    }
  }, [currentFrame, trajStatus]);

  // Optional selected-atom highlight
  useEffect(() => {
    const component = componentRef.current;

    if (!component || status !== 'ready') return;

    if (selectionReprRef.current) {
      try {
        component.removeRepresentation(selectionReprRef.current);
      } catch {
        // ignore
      }
      selectionReprRef.current = null;
    }

    if (!Array.isArray(selectedKeys) || selectedKeys.length === 0) return;

    const sele = selectedKeys
      .map((key) => {
        const [idx, atom] = String(key).split('-');
        const resno = Number(idx) + 1;

        if (!Number.isFinite(resno)) return null;

        return atom ? `${resno} and .${atom}` : `${resno}`;
      })
      .filter(Boolean)
      .join(' or ');

    if (!sele) return;

    try {
      selectionReprRef.current = component.addRepresentation('ball+stick', {
        sele,
        color: SELECT_COLOR_HEX,
        aspectRatio: 1.2
      });
    } catch {
      // ignore selection representation errors
    }
  }, [selectedKeys, status]);

  return (
    <div className="flex flex-col gap-3">
      {trajectorySrc && (
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
              <option key={s} value={s}>
                {s} fps
              </option>
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
              <span className="text-[11px] font-bold text-red-600">
                ⚠️ {trajError}
              </span>
            )}
          </div>
        </div>
      )}

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
                Enter a topology (PDB ID / URL) in Experiment Setup
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
// ================= PARAMETER PARSER =================

const parseSimulationParameters = (text, filename) => {
  const updates = {};
  const lowerText = text.toLowerCase();
  const name = (filename || '').toLowerCase();

  if (name.endsWith('.mdp')) {
    const getVal = (key) => {
      const match = new RegExp(`^\\s*${key}\\s*=\\s*([^\\s;]+)`, 'im').exec(text);
      return match ? match[1] : null;
    };

    const dt = getVal('dt');
    if (dt) {
      const parsed = parseFloat(dt);
      if (!Number.isNaN(parsed)) {
        // GROMACS dt is in ps; UI uses fs
        updates.timestep = String(parsed * 1000);
      }
    }

    const nsteps = getVal('nsteps');
    if (nsteps) updates.nSteps = nsteps;

    const refT = getVal('ref_t');
    if (refT) updates.simTemperature = refT.split(',')[0].trim();

    const refP = getVal('ref_p');
    if (refP) updates.simPressure = refP.split(',')[0].trim();

    const integrator = (getVal('integrator') || '').toLowerCase();
    if (integrator === 'md') {
      updates.integrator = 'leapfrog';
    } else if (integrator === 'md-vv') {
      updates.integrator = 'verlet';
    } else if (integrator === 'sd') {
      updates.integrator = 'langevin';
    }

    const tcoupl = (getVal('tcoupl') || '').toLowerCase();
    if (tcoupl === 'v-rescale') {
      updates.thermostat = 'v_rescale';
    } else if (tcoupl === 'nose-hoover') {
      updates.thermostat = 'nose_hoover';
    } else if (tcoupl === 'berendsen') {
      updates.thermostat = 'berendsen';
    }

    const pcoupl = (getVal('pcoupl') || '').toLowerCase();
    if (pcoupl === 'parrinello-rahman') {
      updates.barostat = 'parrinello_rahman';
    } else if (pcoupl === 'berendsen') {
      updates.barostat = 'berendsen';
    }

    const tcActive = tcoupl && tcoupl !== 'no';
    const pcActive = pcoupl && pcoupl !== 'no';

    if (tcActive && pcActive) {
      updates.ensemble = 'NPT';
    } else if (tcActive) {
      updates.ensemble = 'NVT';
    } else {
      updates.ensemble = 'NVE';
    }
  } else if (name.endsWith('.inp') || name.endsWith('.prm')) {
    const getMatch = (regex) => {
      const m = regex.exec(lowerText);
      return m ? m[1] : null;
    };

    const dt = getMatch(/timestep\s+([0-9.]+)/);
    if (dt) {
      // Assume input is already in fs for NAMD-like configs.
      // If you support CHARMM AKMA units, convert explicitly here.
      updates.timestep = dt;
    }

    const nstep =
      getMatch(/nstep\s+([0-9]+)/) ||
      getMatch(/nsteps\s+([0-9]+)/);

    if (nstep) updates.nSteps = nstep;

    const temp =
      getMatch(/finalt\s+([0-9.]+)/) ||
      getMatch(/firstt\s+([0-9.]+)/) ||
      getMatch(/temperature\s+([0-9.]+)/);

    if (temp) updates.simTemperature = temp;

    const pressure =
      getMatch(/pcons\s+([0-9.]+)/) ||
      getMatch(/pressure\s+([0-9.]+)/);

    if (pressure) updates.simPressure = pressure;

    const isNpt =
      lowerText.includes('pcons') ||
      lowerText.includes('prmc') ||
      lowerText.includes('barostat');

    const isNvt =
      lowerText.includes('hoover') ||
      lowerText.includes('lang') ||
      lowerText.includes('thermostat');

    if (isNpt) updates.ensemble = 'NPT';
    else if (isNvt) updates.ensemble = 'NVT';
    else updates.ensemble = 'NVE';
  }

  return updates;
};

// ================= SETUP SECTION =================

const MDExperimentSetupSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;

  const d = useMDDerived(activeTest);

  const structureMode = activeTest.structureMode || '2d';

  const [hasOpened3D, setHasOpened3D] = useState(structureMode === '3d');
  const [expandedPanel, setExpandedPanel] = useState(null);
  const [ssBrush, setSSBrush] = useState('H');

  useEffect(() => {
    if (structureMode === '3d') setHasOpened3D(true);
  }, [structureMode]);

  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
    return () => clearTimeout(t);
  }, [structureMode, hasOpened3D]);

  const structureSrc = useMemo(() => {
    const raw = (activeTest.structureSrc || '').trim();

    if (!raw) {
      if (d.moleculeType === 'protein') return 'https://models.rcsb.org/1UBQ.mmtf';
      if (d.moleculeType === 'dna') return 'https://models.rcsb.org/1BNA.mmtf';
      if (d.moleculeType === 'rna') return 'https://models.rcsb.org/1EHZ.mmtf';
      return '';
    }

    if (/^(https?:|blob:|data:)/i.test(raw) || raw.startsWith('/')) return raw;

    if (/^[0-9][A-Za-z0-9]{3}$/.test(raw)) {
      return `https://models.rcsb.org/${raw.toUpperCase()}.mmtf`;
    }

    return raw;
  }, [activeTest.structureSrc, d.moleculeType]);

  const trajNorm = useMemo(
    () => normTrajUrl(activeTest.trajectoryUrl || ''),
    [activeTest.trajectoryUrl]
  );

  const selectedKeys = getSelectedKeys(activeTest);

  const manualKeys = useMemo(
    () => getManualKeys(d.activeValues),
    [d.activeValues]
  );

  const handleAtomClick = (ri, keys) => {
    if (ri === null || !keys) return;

    const cur = getSelectedKeys(activeTest);

    if (cur && cur.join('|') === keys.join('|')) {
      updateActiveTest({ selectedAtomKeys: [] });
    } else {
      updateActiveTest({ selectedAtomKeys: keys });
    }
  };

  const paintSSAt = (i, letter) => {
    const arr = d.seq.split('').map((_, j) => d.getSSAt(j));
    arr[i] = letter;
    updateActiveTest({ secondaryStructure: arr.join('') });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Molecule type selector */}
      <div className="flex flex-wrap gap-2 mb-2">
        {[
          ['protein', '🧬 Protein'],
          ['dna', '🧬 DNA'],
          ['rna', '🧬 RNA'],
          ['sugar', '🍬 Sugars'],
          ['lipid', '🫧 Phospholipids']
        ].map(([val, lab]) => (
          <button
            key={val}
            onClick={() => updateActiveTest({ moleculeType: val })}
            className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors ${
              d.moleculeType === val
                ? 'bg-blue-600 border-blue-700 text-white shadow'
                : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {lab}
          </button>
        ))}
      </div>

      <div className="flex flex-col md:flex-row gap-6 items-start">
        <div className="flex-1 w-full">
          {d.isPolymer ? (
            <>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                {d.typeLabel} Sequence (1-letter code)
              </label>

              <textarea
                value={activeTest.proteinSequence || ''}
                onChange={(e) =>
                  updateActiveTest({ proteinSequence: e.target.value })
                }
                className="w-full border border-slate-300 rounded-lg p-3 font-mono text-sm tracking-widest outline-none focus:border-blue-500 uppercase h-24 shadow-inner"
                placeholder={
                  d.moleculeType === 'protein'
                    ? 'e.g. MKWVTFISLL...'
                    : d.moleculeType === 'dna'
                      ? 'e.g. ATGCGTAC...'
                      : 'e.g. AUGCGUAC...'
                }
              />

              <p className="text-[10px] text-slate-400 mt-1 font-bold">
                Length: {d.seq.length}{' '}
                {d.moleculeType === 'protein' ? 'residues' : 'nucleotides'}
              </p>
            </>
          ) : (
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                Select Molecule
              </label>

              <select
                value={
                  d.moleculeType === 'sugar'
                    ? activeTest.sugarChoice || 'GLC'
                    : activeTest.lipidChoice || 'POPC'
                }
                onChange={(e) =>
                  updateActiveTest(
                    d.moleculeType === 'sugar'
                      ? { sugarChoice: e.target.value }
                      : { lipidChoice: e.target.value }
                  )
                }
                className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white outline-none focus:border-blue-500 font-semibold"
              >
                {Object.entries(d.DB).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.name} ({k})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Force field / solvent */}
        <div className="w-full md:w-72 flex flex-col gap-4">
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
              ⚛️ Force Field
            </label>

            <select
              value={d.ffKey}
              onChange={(e) =>
                updateActiveTest({
                  forceField: e.target.value,
                  forceFieldVersion: ''
                })
              }
              className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white outline-none focus:border-blue-500 font-semibold mb-2"
            >
              {Object.entries(FORCE_FIELDS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.name}
                </option>
              ))}
            </select>

            <select
              value={
                activeTest.forceFieldVersion || getFFVersions(d.ffKey)[0] || ''
              }
              onChange={(e) =>
                updateActiveTest({ forceFieldVersion: e.target.value })
              }
              className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white outline-none focus:border-blue-500"
            >
              {getFFVersions(d.ffKey).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
              💧 Water Model
            </label>

            <select
              value={activeTest.waterModel || 'TIP3P'}
              onChange={(e) => updateActiveTest({ waterModel: e.target.value })}
              className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white outline-none focus:border-blue-500 font-semibold"
            >
              {Object.entries(WATER_MODELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.name} ({v.sites}-site)
                </option>
              ))}
            </select>
          </div>

          <div className="bg-emerald-50 p-4 rounded-lg border border-emerald-200 mt-4">
            <label className="block text-xs font-bold text-emerald-700 uppercase mb-2">
              📄 Auto-fill from .mdp / .inp
            </label>

            <p className="text-[10px] text-emerald-600 mb-2">
              Upload a GROMACS (.mdp) or CHARMM/NAMD (.inp) parameter file to
              auto-populate ensemble, integrator, thermostat, barostat, timestep,
              steps, temperature and pressure.
            </p>

            <label className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-4 rounded-lg text-xs cursor-pointer shadow-sm transition-colors inline-flex items-center gap-2">
              📂 Choose parameter file…
              <input
                type="file"
                accept=".mdp,.inp,.prm"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files && e.target.files[0];
                  if (!file) return;

                  const reader = new FileReader();

                  reader.onload = (ev) => {
                    const parsed = parseSimulationParameters(ev.target.result, file.name);

                    if (Object.keys(parsed).length > 0) {
                      updateActiveTest(parsed);
                      window.alert(
                        `✅ Imported ${Object.keys(parsed).length} parameters from ${file.name}`
                      );
                    } else {
                      window.alert('⚠️ No recognized parameters found in this file.');
                    }
                  };

                  reader.readAsText(file);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </div>
      </div>

      {/* Secondary structure paint */}
      {d.moleculeType === 'protein' && d.parsedSeq.length > 0 && (
        <div>
          <div className="flex flex-wrap gap-2 mb-3 items-center">
            <span className="text-xs font-bold text-slate-500 uppercase mr-1">
              🖌️ Brush:
            </span>

            {['C', 'H', 'E'].map((l) => (
              <button
                key={l}
                onClick={() => setSSBrush(l)}
                className="px-3 py-1 rounded-lg text-xs font-black border transition-all"
                style={{
                  backgroundColor: ssBrush === l ? SS_META[l].color : 'white',
                  borderColor: SS_META[l].color,
                  color: ssBrush === l ? 'white' : SS_META[l].color
                }}
              >
                {SS_META[l].label}
              </button>
            ))}
          </div>

          <SequencePaintStrip
            residues={d.parsedSeq}
            getLetter={(i) => d.getSSAt(i)}
            meta={SS_META}
            onApply={(i) => paintSSAt(i, ssBrush)}
            focusIdx="ALL"
          />
        </div>
      )}

      {/* 2D / 3D structure view */}
      {d.structure && (
        <div>
          <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
            <div className="flex bg-slate-200 p-1 rounded-lg">
              <button
                onClick={() => updateActiveTest({ structureMode: '2d' })}
                className={`px-3 py-1 text-xs font-bold rounded-md ${
                  structureMode === '2d'
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                2D Formula
              </button>

              <button
                onClick={() => updateActiveTest({ structureMode: '3d' })}
                className={`px-3 py-1 text-xs font-bold rounded-md ${
                  structureMode === '3d'
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                3D Viewer + Trajectory
              </button>
            </div>
          </div>

          {structureMode === '3d' && (
            <div className="mb-3 grid grid-cols-1 md:grid-cols-3 gap-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">
                  Topology (PDB ID / URL / .gro)
                </label>

                <input
                  type="text"
                  value={activeTest.structureSrc || ''}
                  onChange={(e) =>
                    updateActiveTest({ structureSrc: e.target.value })
                  }
                  placeholder="e.g. 1UBQ or /structures/sys.gro"
                  className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">
                  🎞️ Trajectory URL (XTC / TRR / DCD)
                </label>

                <input
                  type="text"
                  value={activeTest.trajectoryUrl || ''}
                  onChange={(e) =>
                    updateActiveTest({ trajectoryUrl: e.target.value })
                  }
                  placeholder="https://…/traj.xtc"
                  className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">
                  Trajectory format
                </label>

                <select
                  value={
                    activeTest.trajectoryFormat ||
                    detectTrajFmt(activeTest.trajectoryUrl)
                  }
                  onChange={(e) =>
                    updateActiveTest({ trajectoryFormat: e.target.value })
                  }
                  className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none"
                >
                  {TRAJECTORY_FORMATS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div style={{ display: structureMode === '3d' ? 'block' : 'none' }}>
            {hasOpened3D && (
              <MDMoleculeViewer
                key={`${structureSrc}|${activeTest.trajectoryUrl || ''}`}
                structureSrc={structureSrc}
                trajectorySrc={trajNorm.url}
                trajectoryFallbacks={trajNorm.fallbacks}
                trajectoryFormat={
                  activeTest.trajectoryFormat ||
                  detectTrajFmt(activeTest.trajectoryUrl)
                }
                moleculeType={d.moleculeType}
                parsedSeq={d.parsedSeq}
                selectedKeys={selectedKeys}
                onAtomClick={handleAtomClick}
                height={
                  d.moleculeType === 'dna' || d.moleculeType === 'rna'
                    ? '620px'
                    : '520px'
                }
              />
            )}
          </div>

          <div style={{ display: structureMode === '2d' ? 'block' : 'none' }}>
            <StructureSVGView
              structure={d.structure}
              minWidth={
                d.moleculeType === 'protein' && d.parsedSeq.length > 3
                  ? `${d.parsedSeq.length * 120}px`
                  : '100%'
              }
              isExpanded={expandedPanel === 'formula'}
              onToggleExpand={() =>
                setExpandedPanel(expandedPanel === 'formula' ? null : 'formula')
              }
              selectedKeys={selectedKeys}
              manualKeys={manualKeys}
              onAtomClick={handleAtomClick}
              height={
                d.moleculeType === 'dna' || d.moleculeType === 'rna'
                  ? `${Math.max(360, d.parsedSeq.length * 250 + 120)}px`
                  : '300px'
              }
            />
          </div>
        </div>
      )}
    </div>
  );
};

// ================= DATA SECTION =================

const MDDataSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;

  const d = useMDDerived(activeTest);
  const selectedKeys = getSelectedKeys(activeTest);

  if (!d.parsedSeq.length) {
    return (
      <div className="text-center py-10 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed">
        Enter a sequence / select a molecule in Experiment Setup.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-indigo-800 uppercase">
          Force Field:
        </span>

        <span className="text-sm font-black text-indigo-900">
          {getFF(d.ffKey).name} {activeTest.forceFieldVersion || ''}
        </span>

        <span className="text-[10px] font-bold bg-white border border-indigo-200 text-indigo-700 px-2 py-0.5 rounded-full">
          Water: {getWM(activeTest.waterModel || 'TIP3P').name}
        </span>

        <span className="text-[10px] font-bold bg-white border border-indigo-200 text-indigo-700 px-2 py-0.5 rounded-full">
          Ensemble: {activeTest.ensemble || 'NPT'}
        </span>
      </div>

      <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[500px]">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-slate-500 uppercase bg-slate-100 sticky top-0 z-10">
            <tr>
              <th className="px-4 py-3 font-black border-b w-20 text-center">
                Res
              </th>

              {d.moleculeType === 'protein' && (
                <th className="px-2 py-2 font-bold border-b text-center">SS</th>
              )}

              {d.ffBackbone.map((a) => (
                <th
                  key={a.atom}
                  className="px-3 py-2 font-bold text-blue-700 border-b bg-blue-50/50"
                >
                  {a.atom}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100 bg-white">
            {d.parsedSeq.map((res, idx) => (
              <tr key={idx} className="hover:bg-slate-50">
                <td className="px-4 py-2 font-black text-slate-700 text-center bg-slate-50 border-r">
                  {res.id}
                </td>

                {d.moleculeType === 'protein' && (
                  <td className="px-2 py-1 text-center">
                    <span
                      className="inline-block w-6 h-6 leading-6 rounded-full text-xs font-black text-white"
                      style={{
                        backgroundColor: (
                          SS_META[d.getSSAt(idx)] || { color: '#64748b' }
                        ).color
                      }}
                    >
                      {d.getSSAt(idx)}
                    </span>
                  </td>
                )}

                {d.ffBackbone.map((a) => {
                  const key = `${idx}-${a.atom}`;
                  const isSel = selectedKeys && selectedKeys.includes(key);

                  return (
                    <td
                      key={a.atom}
                      className={`px-3 py-1 ${
                        isSel ? 'bg-amber-100 ring-2 ring-amber-400' : ''
                      }`}
                      title={`type ${a.type} · q=${a.charge} · m=${a.mass}`}
                    >
                      <input
                        type="text"
                        value={d.activeValues[key] || ''}
                        onChange={(e) => {
                          const nv = { ...(activeTest.mdValues || {}) };
                          const lk = activeTest.activeLayerKey || 'md';

                          nv[lk] = {
                            ...(nv[lk] || {}),
                            [key]: e.target.value
                          };

                          updateActiveTest({ mdValues: nv });
                        }}
                        className="w-full border border-slate-200 rounded px-2 py-1 text-center text-xs font-mono outline-none focus:border-blue-500"
                        placeholder="—"
                      />

                      <div className="text-[10px] font-bold text-purple-600 text-center mt-0.5">
                        {a.type}
                      </div>

                      <div className="text-[9px] text-slate-400 text-center">
                        q={a.charge} · m={a.mass}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ================= SIMULATION PARAMS =================

const MDSimulationParamsSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;

  const handleParamFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (ev) => {
      const text = ev.target.result;
      const parsedUpdates = parseSimulationParameters(text, file.name);

      if (Object.keys(parsedUpdates).length > 0) {
        updateActiveTest(parsedUpdates);
      }
    };

    reader.readAsText(file);
    e.target.value = '';
  };

  const Sel = ({ label, value, onChange, options }) => (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-bold text-slate-500 uppercase">
        {label}
      </label>

      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none font-semibold"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );

  const Num = ({ label, value, onChange, unit }) => (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-bold text-slate-500 uppercase">
        {label}
        {unit ? ` (${unit})` : ''}
      </label>

      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs outline-none"
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          {MD_PHASES.map(([k, l]) => (
            <button
              key={k}
              onClick={() => updateActiveTest({ simPhase: k })}
              className={`px-3 py-1.5 rounded-lg text-sm font-bold border ${
                (activeTest.simPhase || 'production') === k
                  ? 'bg-blue-600 border-blue-700 text-white'
                  : 'bg-white border-slate-300 text-slate-600'
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <label className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold py-1.5 px-3 rounded-lg text-xs cursor-pointer shadow-sm transition-colors flex items-center gap-2">
            📄 Auto-fill from .mdp / .inp
            <input
              type="file"
              accept=".mdp,.inp,.prm"
              onChange={handleParamFile}
              className="hidden"
            />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-white border border-slate-200 rounded-xl p-4">
        <Sel
          label="Ensemble"
          value={activeTest.ensemble || 'NPT'}
          onChange={(v) => updateActiveTest({ ensemble: v })}
          options={MD_ENSEMBLES}
        />

        <Sel
          label="Integrator"
          value={activeTest.integrator || 'verlet'}
          onChange={(v) => updateActiveTest({ integrator: v })}
          options={MD_INTEGRATORS}
        />

        <Num
          label="Time step"
          value={activeTest.timestep || '2'}
          onChange={(v) => updateActiveTest({ timestep: v })}
          unit="fs"
        />

        <Num
          label="Steps"
          value={activeTest.nSteps || '500000'}
          onChange={(v) => updateActiveTest({ nSteps: v })}
        />

        <Num
          label="Temperature"
          value={activeTest.simTemperature || '300'}
          onChange={(v) => updateActiveTest({ simTemperature: v })}
          unit="K"
        />

        <Num
          label="Pressure"
          value={activeTest.simPressure || '1.0'}
          onChange={(v) => updateActiveTest({ simPressure: v })}
          unit="bar"
        />

        <Sel
          label="Thermostat"
          value={activeTest.thermostat || 'v_rescale'}
          onChange={(v) => updateActiveTest({ thermostat: v })}
          options={MD_THERMOSTATS}
        />

        <Sel
          label="Barostat"
          value={activeTest.barostat || 'parrinello_rahman'}
          onChange={(v) => updateActiveTest({ barostat: v })}
          options={MD_BAROSTATS}
        />
      </div>
    </div>
  );
};

// ================= ANALYSIS =================

const MDAnalysisSection = ({ ctx }) => {
  const { activeTest } = ctx;

  const d = useMDDerived(activeTest);

  const nFrames = 500;
  const nRes = Math.max(1, d.parsedSeq.length || 20);

  const rmsd = useMemo(() => genRMSD(nFrames), []);
  const rmsf = useMemo(() => genRMSF(nRes), [nRes]);
  const rg = useMemo(() => genRg(nFrames), []);
  const sasa = useMemo(() => genSASA(nFrames), []);
  const energy = useMemo(() => genEnergy(nFrames), []);

  if (!d.parsedSeq.length) {
    return (
      <div className="text-center py-8 text-slate-400 italic">
        Enter a sequence to enable analysis.
      </div>
    );
  }

  const Card = ({
    title,
    data,
    dataKey = 'value',
    xKey = 'time',
    color,
    yLabel,
    xLabel,
    type = 'line'
  }) => (
    <div className="bg-white rounded-lg border border-slate-200 p-3">
      <h5 className="text-xs font-bold text-slate-700 mb-1">{title}</h5>

      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          {type === 'bar' ? (
            <BarChart
              data={data}
              margin={{ top: 5, right: 10, bottom: 25, left: 10 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />

              <XAxis
                dataKey={xKey}
                tick={{ fontSize: 10 }}
                label={{
                  value: xLabel,
                  position: 'insideBottom',
                  offset: -15,
                  fontSize: 10
                }}
              />

              <YAxis
                tick={{ fontSize: 10 }}
                label={{
                  value: yLabel,
                  angle: -90,
                  position: 'insideLeft',
                  fontSize: 10
                }}
              />

              <Tooltip />

              <Bar dataKey={dataKey} isAnimationActive={false}>
                {data.map((e, i) => (
                  <Cell key={i} fill={e.fill || color} />
                ))}
              </Bar>
            </BarChart>
          ) : (
            <LineChart
              data={data}
              margin={{ top: 5, right: 10, bottom: 25, left: 10 }}
            >
              <CartesianGrid strokeDasharray="3 3" />

              <XAxis
                dataKey={xKey}
                type="number"
                tick={{ fontSize: 10 }}
                label={{
                  value: xLabel,
                  position: 'insideBottom',
                  offset: -15,
                  fontSize: 10
                }}
              />

              <YAxis
                tick={{ fontSize: 10 }}
                label={{
                  value: yLabel,
                  angle: -90,
                  position: 'insideLeft',
                  fontSize: 10
                }}
              />

              <Tooltip />

              <Line
                type="monotone"
                dataKey={dataKey}
                stroke={color}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card
          title="RMSD (backbone)"
          data={rmsd}
          color="#3b82f6"
          yLabel="nm"
          xLabel="Time (ns)"
        />

        <Card
          title="RMSF per residue"
          data={rmsf}
          xKey="residue"
          color="#3b82f6"
          yLabel="nm"
          xLabel="Residue"
          type="bar"
        />

        <Card
          title="Radius of Gyration (Rg)"
          data={rg}
          color="#22c55e"
          yLabel="nm"
          xLabel="Time (ns)"
        />

        <Card
          title="SASA"
          data={sasa}
          color="#f59e0b"
          yLabel="nm²"
          xLabel="Time (ns)"
        />
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-3">
        <h5 className="text-xs font-bold text-slate-700 mb-1">Energy</h5>

        <div style={{ height: 250 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={energy}
              margin={{ top: 5, right: 10, bottom: 25, left: 10 }}
            >
              <CartesianGrid strokeDasharray="3 3" />

              <XAxis dataKey="time" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />

              <Tooltip />
              <Legend verticalAlign="top" wrapperStyle={{ fontSize: 10 }} />

              <Line
                type="monotone"
                dataKey="potential"
                stroke="#ef4444"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />

              <Line
                type="monotone"
                dataKey="kinetic"
                stroke="#3b82f6"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />

              <Line
                type="monotone"
                dataKey="total"
                stroke="#22c55e"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

// ================= ALL =================

const MDAll = ({ ctx }) => (
  <div className="flex flex-col gap-6">
    <div className="bg-emerald-100 border-2 border-emerald-500 rounded-xl p-3 text-center text-emerald-800 font-black text-sm">
      ✅ MD TEST RENDERER LOADED SUCCESSFULLY
    </div>

    <CollapsibleSection title="Experiment Setup" icon="⚙️">
      <MDSimulationParamsSection ctx={ctx} />
    </CollapsibleSection>

    <CollapsibleSection title="Molecular system and simulations" icon="🧬">
      <CollapsibleSection title="Molecular structure and visualization" icon="🔬" defaultOpen={false}>
        <MDExperimentSetupSection ctx={ctx} />
      </CollapsibleSection>
    </CollapsibleSection>

    <CollapsibleSection title="Data" icon="🔢">
      <MDDataSection ctx={ctx} />
    </CollapsibleSection>

    <CollapsibleSection title="Analysis" icon="📈" defaultOpen={false}>
      <MDAnalysisSection ctx={ctx} />
    </CollapsibleSection>
  </div>
);

// ================= NOTEBOOK =================

const buildMDNotebookHtml = (checked, ctx) => {
  const { activeTest } = ctx;

  let html = '';

  const moleculeType = activeTest.moleculeType || 'protein';
  const ffKey = activeTest.forceField || 'GROMOS';

  const rawSeq = (activeTest.proteinSequence || '').toUpperCase();

  const validChars =
    moleculeType === 'protein'
      ? 'ACDEFGHIKLMNPQRSTVWY'
      : moleculeType === 'dna'
        ? 'ACGT'
        : moleculeType === 'rna'
          ? 'ACGU'
          : '';

  const seq = ['protein', 'dna', 'rna'].includes(moleculeType)
    ? rawSeq.replace(new RegExp(`[^${validChars}]`, 'g'), '')
    : '';

  if (checked.cond) {
    html += `<p style="font-size:12px;color:#475569;margin-bottom:8px;"><b>MD Setup:</b> Force field ${
      activeTest.forceField || 'GROMOS'
    } | Water ${activeTest.waterModel || 'TIP3P'} | Ensemble ${
      activeTest.ensemble || 'NPT'
    } | Δt ${activeTest.timestep || '2'} fs | ${
      activeTest.nSteps || '500000'
    } steps | T ${activeTest.simTemperature || '300'} K</p>`;
  }

  if (checked.seq) {
    const seqText =
      seq || activeTest.sugarChoice || activeTest.lipidChoice || 'N/A';

    html += `<p style="font-size:12px;color:#475569;margin-bottom:8px;"><b>System / Sequence:</b> <span style="font-family:monospace;background:#e2e8f0;padding:2px 4px;border-radius:4px;">${seqText}</span></p>`;
  }

  if (checked.table && seq) {
    const ffAtoms = getFFAtoms(ffKey);

    const values =
      (activeTest.mdValues || {})[activeTest.activeLayerKey || 'md'] || {};

    let rows = '';

    seq.split('').forEach((char, idx) => {
      ffAtoms.forEach((a) => {
        const key = `${idx}-${a.atom}`;

        rows += `<tr>
          <td style="padding:6px;border:1px solid #e2e8f0;"><b>${idx + 1}</b></td>
          <td style="padding:6px;border:1px solid #e2e8f0;">${char}</td>
          <td style="padding:6px;border:1px solid #e2e8f0;">${a.atom}</td>
          <td style="padding:6px;border:1px solid #e2e8f0;">${a.type}</td>
          <td style="padding:6px;border:1px solid #e2e8f0;">${a.charge}</td>
          <td style="padding:6px;border:1px solid #e2e8f0;">${a.mass}</td>
          <td style="padding:6px;border:1px solid #e2e8f0;">${values[key] || ''}</td>
        </tr>`;
      });
    });

    html += `<table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:11px;text-align:left;background:white;">
      <tr style="background-color:#f1f5f9;">
        <th style="padding:6px;border:1px solid #cbd5e1;">Res</th>
        <th style="padding:6px;border:1px solid #cbd5e1;">Char</th>
        <th style="padding:6px;border:1px solid #cbd5e1;">Atom</th>
        <th style="padding:6px;border:1px solid #cbd5e1;">Type</th>
        <th style="padding:6px;border:1px solid #cbd5e1;">Charge</th>
        <th style="padding:6px;border:1px solid #cbd5e1;">Mass</th>
        <th style="padding:6px;border:1px solid #cbd5e1;">Value</th>
      </tr>
      ${rows}
    </table>`;
  }

  if (checked.formula) {
    html += `<p style="font-size:12px;color:#475569;margin-top:8px;"><b>Chemical formula:</b> use the MD page “Formula → Notebook” button to append the rendered formula.</p>`;
  }

  return html;
};

// ================= ERROR BOUNDARY =================

class MDErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('MDTestRenderer error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-6 bg-red-50 border-2 border-red-400 rounded-xl m-6">
          <h2 className="text-red-700 font-black text-lg mb-2">
            ❌ MDTestRenderer crashed
          </h2>

          <pre className="text-red-600 text-xs whitespace-pre-wrap overflow-auto max-h-64">
            {String(
              (this.state.error && this.state.error.message) || this.state.error
            )}
            {'\n\n'}
            {String((this.state.error && this.state.error.stack) || '')}
          </pre>

          <p className="text-red-500 text-xs mt-2">
            Copy this error and share it so we can fix the exact line.
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}

// ================= MAIN RENDERER =================

const MDTestRenderer = ({
  activeTest,
  updateActiveTest,
  TestHeader,
  datasetProtocols,
  jumpToProtocol,
  allCmpds,
  allCellLines,
  customFields,
  testCategories,
  ...rest
}) => {
  const ctx = useMemo(
    () => ({
      activeTest,
      updateActiveTest,
      allCmpds,
      allCellLines,
      customFields,
      testCategories,
      datasetProtocols,
      jumpToProtocol,
      ...rest
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      activeTest,
      updateActiveTest,
      allCmpds,
      allCellLines,
      customFields,
      testCategories,
      datasetProtocols,
      jumpToProtocol
    ]
  );

  const custom = useMemo(
    () => ({
      MolecularStructure: MDExperimentSetupSection,
      Simulations: MDSimulationParamsSection,
      Data: MDDataSection,
      Analysis: MDAnalysisSection,
      buildNotebookHtml:
        typeof buildMDNotebookHtmlFromSections === 'function'
          ? (checked, ctxArg) => buildMDNotebookHtmlFromSections(ctxArg, checked)
          : buildMDNotebookHtml
    }),
    []
  );

  return (
    <MDErrorBoundary>
      <TestShellRenderer
        config={MD_TAB_CONFIG}
        custom={custom}
        activeTest={activeTest}
        updateActiveTest={updateActiveTest}
        TestHeader={TestHeader}
        datasetProtocols={datasetProtocols}
        jumpToProtocol={jumpToProtocol}
        allCmpds={allCmpds}
        allCellLines={allCellLines}
        customFields={customFields}
        testCategories={testCategories}
        {...rest}
      />
    </MDErrorBoundary>
  );
};

export default MDTestRenderer;