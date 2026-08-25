import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ensureNGL } from '../utils/ngl';

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

// ============================================================================
// PyMOL-style helpers — colour parsing, selection translation, script subset
// ============================================================================
const PYMOL_COLORS = {
  red: '#ff0000', green: '#00ff00', blue: '#0000ff', yellow: '#ffff00',
  orange: '#ff8000', purple: '#800080', pink: '#ff00ff', cyan: '#00ffff',
  marine: '#000080', white: '#ffffff', gray: '#808080', grey: '#808080',
  gray20: '#333333', gray30: '#4d4d4d', gray40: '#666666', gray50: '#808080',
  gray60: '#999999', gray70: '#b3b3b3', gray80: '#cccccc', black: '#000000',
  gold: '#ffd700', salmon: '#fa8072', greencyan: '#00ffcc', tv_red: '#ff0000',
  tv_orange: '#ff8000', tv_yellow: '#ffff00', tv_green: '#00ff00',
  tv_blue: '#0000ff', tv_purple: '#800080', slate: '#708090',
};
const parseColorInt = (c) => {
  const s = String(c || '').trim();
  if (!s) return null;
  if (/^\[/.test(s)) {
    const m = s.match(/\[([^\]]+)\]/);
    if (m) {
      const parts = m[1].split(/[\s,]+/).map(Number).filter((n) => !isNaN(n));
      if (parts.length >= 3) return ((parts[0] & 255) << 16) | ((parts[1] & 255) << 8) | (parts[2] & 255);
    }
    return null;
  }
  if (/^#?[0-9a-f]{6}$/i.test(s)) return parseInt(s.replace('#', ''), 16);
  const base = String(s).split('_')[0].toLowerCase();
  return PYMOL_COLORS[base] ? parseInt(PYMOL_COLORS[base].slice(1), 16) : null;
};

// Convert a common PyMOL selection expression to NGL selection syntax.
const translateSelection = (expr) => {
  const s = String(expr || '')
    .replace(/\bpolymer\.protein\b/g, 'protein')
    .replace(/\bpolymer\.nucleic\b/g, 'nucleic')
    .replace(/\bbyres\b/g, '')
    .replace(/\bbycalpha\b/g, '')
    .replace(/\+/g, ' ')
    .replace(/,(?=\s*name|\s*resn|\s*resid|\s*protein|\s*not)/g, '')
    .trim();
  return s || 'all';
};

const normalizeStructureSource = (raw) => {
const value = (raw || '').trim();
if (!value) return null;
const driveMatch = value.match(/drive\.google\.com\/file\/d\/([^/?]+)/) || value.match(/drive\.google\.com\/(?:open|uc)[^#]*[?&]id=([^&#]+)/);
if (driveMatch) {
const id = driveMatch[1];
const path = value.split(/[?#]/)[0];
let ext = path.includes('.') ? path.split('.').pop().toLowerCase() : 'pdb';
if (!['pdb', 'cif', 'mmcif', 'bcif', 'mol2', 'sdf'].includes(ext)) {
ext = 'pdb';
}
const extParam = ext === 'mmcif' ? 'cif' : ext;
return {
url: `https://lh3.googleusercontent.com/d/${id}`,
params: { ext: extParam },
fallbacks: [
{ url: `https://drive.google.com/thumbnail?id=${id}&sz=w1600`, params: { ext: extParam } },
{ url: `https://drive.google.com/uc?export=download&id=${id}`, params: { ext: extParam } }
]
};
}
if (/^(https?:|blob:|data:)/i.test(value)) {
const path = value.split(/[?#]/)[0];
const ext = path.includes('.') ? path.split('.').pop().toLowerCase() : '';
if (ext === 'pdb' || ext === 'ent') return { url: value, params: { ext: 'pdb' } };
if (ext === 'cif' || ext === 'mmcif') return { url: value, params: { ext: 'cif' } };
if (ext === 'bcif') return { url: value, params: { ext: 'bcif' } };
if (ext === 'mol2') return { url: value, params: { ext: 'mol2' } };
if (ext === 'sdf') return { url: value, params: { ext: 'sdf' } };
const guessed = /bcif/i.test(value) ? 'bcif' : /cif/i.test(value) ? 'cif' : 'pdb';
return { url: value, params: { ext: guessed } };
}
if (/^rcsb:/i.test(value)) return { url: value };
if (/^[0-9a-z]{4}$/i.test(value)) {
const id = value.toUpperCase();
return { url: `https://files.rcsb.org/download/${id}.cif`, params: { ext: 'cif' } };
}
return { url: value };
};

const getCarbonName = (molType, char, atom) => {
if (!atom) return null;
if (
atom.startsWith('HN') || atom.startsWith('NH') || atom.startsWith('OH') ||
atom.startsWith('NHAc') || atom.startsWith('Ac') || atom.includes('NH3')
) {
return null;
}
if (molType === 'organic') {
return atom.replace('H', 'C').replace(/[a-z]+$/, '');
}
if (molType === 'protein') {
if (atom === 'Hε' && char === 'R') return null;
if (char === 'W' && atom === 'Hδ1') return null;
if (atom.includes('CH3')) return atom.replace('H', 'C').replace('(CH3)', '');
const cName = atom.replace('H', 'C').replace(/\d+$/, '');
if (['V', 'I', 'T'].includes(char) && atom.includes('γ')) return atom.replace('H', 'C');
if (['L', 'I'].includes(char) && atom.includes('δ')) return atom.replace('H', 'C');
if (['F', 'Y', 'W', 'H'].includes(char) && (atom.includes('δ') || atom.includes('ε') || atom.includes('ζ') || atom.includes('η'))) {
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

const NUCLEIC_NMR_ALIASES = { "HO2'": "OH2'", H71: 'H7(CH3)', H72: 'H7(CH3)', H73: 'H7(CH3)' };

const mapPdbAtomToNmrKeys = (atomname, resno, parsedSeq, moleculeType, namingConvention = 'nmr') => {
const ri = resno - 1;
if (!parsedSeq || ri < 0 || ri >= parsedSeq.length) return null;
const res = parsedSeq[ri];
if (!res) return null;
const upper = (atomname || '').trim().toUpperCase();
let nmrAtom;
if (namingConvention === 'pdb') {
if (upper === 'H') nmrAtom = 'HN';
else nmrAtom = upper;
} else if (moleculeType === 'dna' || moleculeType === 'rna') {
nmrAtom = NUCLEIC_NMR_ALIASES[upper] || upper;
} else {
nmrAtom = PDB_TO_NMR[upper];
if (!nmrAtom) {
if (upper === 'N') nmrAtom = 'N';
else if (upper === 'CA') nmrAtom = 'Cα';
else if (upper === 'C') nmrAtom = "C'";
else if (upper === 'CB') nmrAtom = 'Cβ';
else if (upper === 'O') nmrAtom = 'O';
else {
const match = upper.match(/^([CNO])([ABGDEZH])(\d*)$/);
nmrAtom = match ? `${match[1]}${GREEK_MAP[match[2]]}${match[3]}` : upper;
}
}
}
const tokens = [nmrAtom];
if (moleculeType === 'dna' || moleculeType === 'rna') tokens.push(`${nmrAtom}`);
const keys = buildKeys(ri, tokens, moleculeType, res.char);
return { ri, keys, label: `${res.id || res.char}${resno} ${nmrAtom}`, nmrAtom };
};

const mapAtomToNmrKeys = (atom, parsedSeq, moleculeType, namingConvention) => {
if (moleculeType === 'organic') {
const nmrAtom = getOrganicAtomName(atom);
const keys = buildKeys(0, [nmrAtom], 'organic', 'O');
return { ri: 0, keys, label: `Org ${nmrAtom}`, nmrAtom };
}
return mapPdbAtomToNmrKeys(atom.atomname, atom.resno, parsedSeq, moleculeType, namingConvention);
};

// ================= RDKit Helper Functions =================
const computeMorganRanks = (elements, bonds) => {
  const n = elements.length;
  const isHeavy = elements.map((e) => e !== 'H');
  const heavyIdx = [];
  elements.forEach((e, i) => { if (e !== 'H') heavyIdx.push(i); });
  const m = heavyIdx.length;
  const posOf = {};
  heavyIdx.forEach((gi, k) => { posOf[gi] = k; });
  const adj = Array.from({ length: m }, () => []);
  const hCount = new Array(m).fill(0);
  bonds.forEach(([a, b]) => {
    const ah = isHeavy[a], bh = isHeavy[b];
    if (ah && bh) { adj[posOf[a]].push(posOf[b]); adj[posOf[b]].push(posOf[a]); }
    else if (ah && !bh) hCount[posOf[a]]++;
    else if (!ah && bh) hCount[posOf[b]]++;
  });
  let sig = heavyIdx.map((gi, k) => `${elements[gi]}_${hCount[k]}`);
  for (let iter = 0; iter < n; iter++) {
    const next = sig.map((s, i) => {
      const neighbors = adj[i].map((j) => sig[j]).sort().join(',');
      const str = s + '|' + neighbors;
      let hash = 0;
      for (let k = 0; k < str.length; k++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(k);
        hash |= 0;
      }
      return Math.abs(hash).toString(36) + '_' + elements[heavyIdx[i]];
    });
    const converged = next.join(';') === sig.join(';');
    sig = next;
    if (converged) break;
  }
  const order = Array.from({ length: m }, (_, k) => k).sort((x, y) =>
    sig[x] < sig[y] ? -1 : sig[x] > sig[y] ? 1 : x - y
  );
  const ranks = new Array(n).fill(-1);
  order.forEach((k, r) => { ranks[heavyIdx[k]] = r; });
  return ranks;
};

const deriveOrganicAtomNaming = (molblock) => {
  const lines = molblock.split('\n');
  const countsLine = lines[3] || '';
  const nA = parseInt(countsLine.substring(0, 3).trim(), 10) || 0;
  const nB = parseInt(countsLine.substring(3, 6).trim(), 10) || 0;
  
  const elements = [];
  const bonds = [];
  
  for (let i = 0; i < nA; i++) {
    const line = lines[4 + i] || '';
    const elem = line.substring(31, 34).trim();
    elements.push(elem || 'C');
  }
  for (let i = 0; i < nB; i++) {
    const line = lines[4 + nA + i] || '';
    const a1 = parseInt(line.substring(0, 3).trim(), 10) - 1;
    const a2 = parseInt(line.substring(3, 6).trim(), 10) - 1;
    if (!isNaN(a1) && !isNaN(a2)) bonds.push([a1, a2]);
  }
  
  const ranks = computeMorganRanks(elements, bonds);
  const atomNameList = new Array(nA).fill('');
  const parentOfH = new Array(nA).fill(-1);
  
  bonds.forEach(([a1, a2]) => {
    if (elements[a1] === 'H' && elements[a2] !== 'H') parentOfH[a1] = a2;
    if (elements[a2] === 'H' && elements[a1] !== 'H') parentOfH[a2] = a1;
  });
  
  const keepAtom = new Array(nA).fill(true);
  const seenHForParent = new Set();
  
  for (let i = 0; i < nA; i++) {
    if (elements[i] !== 'H') {
      atomNameList[i] = `${elements[i]}${ranks[i] >= 0 ? ranks[i] : i}`;
    } else {
      const pr = parentOfH[i] >= 0 ? ranks[parentOfH[i]] : null;
      // Name it H{parentRank} without a,b,c suffix
      atomNameList[i] = pr !== null ? `H${pr}` : `H${i}`;
      
      // Only keep the FIRST hydrogen for each parent to avoid visual clutter
      if (parentOfH[i] !== -1) {
        if (seenHForParent.has(parentOfH[i])) {
          keepAtom[i] = false;
        } else {
          seenHForParent.add(parentOfH[i]);
        }
      }
    }
  }
  
  return { atomNameList, elements, keepAtom };
};
// ==========================================================

const _organicNamingCache = new WeakMap();
const getOrganicNaming = (structure) => {
  if (_organicNamingCache.has(structure)) return _organicNamingCache.get(structure);
  const elements = [];
  const bondPairs = [];
  structure.eachAtom((a) => { elements[a.index] = a.element || 'C'; });
  structure.eachAtom((a) => {
    a.eachBondedAtom((b) => { if (a.index < b.index) bondPairs.push([a.index, b.index]); });
  });
  const n = elements.length;
  const ranks = computeMorganRanks(elements, bondPairs);
  const parent = new Array(n).fill(-1);
  bondPairs.forEach(([x, y]) => {
    if (elements[x] === 'H' && elements[y] !== 'H') parent[x] = y;
    if (elements[y] === 'H' && elements[x] !== 'H') parent[y] = x;
  });
  
  const names = new Array(n);
  for (let i = 0; i < n; i++) {
    if (elements[i] !== 'H') {
      names[i] = `${elements[i]}${ranks[i] >= 0 ? ranks[i] : i}`;
    } else {
      const pr = parent[i] >= 0 ? ranks[parent[i]] : null;
      // Removed suffix logic to match 2D viewer and avoid a,b,c clutter for equivalent protons
      names[i] = pr !== null ? `H${pr}` : `H${i}`;
    }
  }
  
  _organicNamingCache.set(structure, names);
  return names;
};

const getOrganicAtomName = (atom) => {
const names = getOrganicNaming(atom.structure);
return names[atom.index] || `X${atom.index}`;
};

// NGL is loaded via the shared loader in ../utils/ngl.js (see import above).

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
const NMRMoleculeViewer = ({
src,
structureText,
structureTextExt,
externalLoading = false,
externalError = null,
structureFileData,
structureFileName,
structureFormat = 'auto',
trajectorySrc,
trajectoryFile,
trajectoryFallbacks = [],
trajectoryFormat = 'xtc',
onStructureFile,
onStructureSrc,
onTrajectoryFile,
onAtomClick,
selectedKeys,
manualKeys = [],
moleculeType = 'protein',
parsedSeq = [],
residueOffset = 0,
atomNameMap,
atomRenames,
onAtomRenames,
labelMode,
namingConvention = 'nmr',
height = '520px',
}) => {
const containerRef = useRef(null);
const stageRef = useRef(null);
const stageReadyRef = useRef(null);
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
const [backboneStyle, setBackboneStyle] = useState('cartoon');

// ---- Atom renaming (3D, post-generation) ----
const [renames, setRenames] = useState(() => (atomRenames && typeof atomRenames === 'object' ? { ...atomRenames } : {}));
const renamesRef = useRef(renames);
renamesRef.current = renames;
const [renameMode, setRenameMode] = useState(false);
const [renameTarget, setRenameTarget] = useState(null); // atom index being renamed
const [renameDraft, setRenameDraft] = useState('');
const [atomList, setAtomList] = useState([]);          // [{ idx, element, name, resno, resname }]
const [atomSearch, setAtomSearch] = useState('');
const [showAtomPanel, setShowAtomPanel] = useState(false);

// ---- PyMOL-style selections & effects ----
const [selections, setSelections] = useState([]);      // [{ name, expr }]
const [selStyles, setSelStyles] = useState({});        // key -> { cartoon, stick, sphere, surface, color, transparency, sphereScale }
const [pymolActive, setPymolActive] = useState(false);
const [pymolScript, setPymolScript] = useState('');
const [pymolLog, setPymolLog] = useState('');
const [showPymolPanel, setShowPymolPanel] = useState(false);
const [autoShowSel, setAutoShowSel] = useState(true); // auto-visibility of parsed selections
const [hideAll, setHideAll] = useState(false);        // remove every representation
const [bgColor, setBgColor] = useState('#f8fafc');
const [qualityHigh, setQualityHigh] = useState(false);

const persistRenames = (next) => {
  setRenames(next);
  if (typeof onAtomRenames === 'function') onAtomRenames(next);
};
const displayAtomName = (atom) => {
  if (!atom) return '';
  const idx = typeof atom.index === 'number' ? atom.index : -1;
  const over = renamesRef.current[idx];
  if (over && String(over).trim()) return String(over).trim();
  // For organic/lipid/sugar molecules, use the same connectivity-based name as
  // the 2D structure (so the 3D labels automatically match the 2D formula).
  if (['organic', 'lipid', 'sugar'].includes(moleculeTypeRef.current)) {
    try { return getOrganicAtomName(atom); } catch (e) { /* fall through */ }
  }
  return atom.atomname || atom.name || '';
};

// ---- Trajectory State ----
const [trajFile, setTrajFile] = useState(null);
const [trajStatus, setTrajStatus] = useState('none');
const [trajError, setTrajError] = useState('');
const [numFrames, setNumFrames] = useState(0);
const [currentFrame, setCurrentFrame] = useState(0);
const [playing, setPlaying] = useState(false);
const [speed, setSpeed] = useState(10);
const [stride, setStride] = useState(1);        // play every Nth frame (keeps total time)
const [maxFrames, setMaxFrames] = useState(0);  // 0 = keep all frames
const trajRef = useRef(null);
const blobUrlsRef = useRef([]);

// Number of frames we actually step through (the trajectory's total time span is
// preserved because we jump by `effStride` frames each step). When a "Max frames"
// cap is set, the stride is raised automatically so the full time range still fits
// inside the cap.
const effStride = numFrames > 0 && maxFrames > 0
  ? Math.max(stride, Math.ceil(numFrames / Math.max(1, maxFrames)))
  : stride;
const keptFrames = numFrames > 0 ? Math.max(1, Math.ceil(numFrames / effStride)) : 0;
const toActualFrame = (keptIdx) => Math.min(numFrames - 1, keptIdx * effStride);

const parsedSeqRef = useRef(parsedSeq);
const moleculeTypeRef = useRef(moleculeType);
const onAtomClickRef = useRef(onAtomClick);
const residueOffsetRef = useRef(residueOffset);
const namingConventionRef = useRef(namingConvention);
const renameModeRef = useRef(renameMode);
renameModeRef.current = renameMode;
const displayNameRef = useRef(displayAtomName);
displayNameRef.current = displayAtomName;
const backboneStyleRef = useRef(backboneStyle);
backboneStyleRef.current = backboneStyle;
const prevBackboneRef = useRef(backboneStyle);

useEffect(() => {
parsedSeqRef.current = parsedSeq;
moleculeTypeRef.current = moleculeType;
onAtomClickRef.current = onAtomClick;
residueOffsetRef.current = residueOffset;
namingConventionRef.current = namingConvention;
}, [parsedSeq, moleculeType, onAtomClick, residueOffset, namingConvention]);

useEffect(() => {
let cancelled = false;
stageReadyRef.current = (async () => {
const NGL = await Promise.race([
ensureNGL(),
new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out loading the NGL viewer library (20s).')), 20000)),
]);
if (cancelled || !containerRef.current) return null;
const stage = new NGL.Stage(containerRef.current, { backgroundColor: '#f8fafc' });
stageRef.current = stage;

stage.signals.clicked.add((pickingProxy) => {
if (!pickingProxy || !pickingProxy.atom) return;
const atom = pickingProxy.atom;
if (renameModeRef.current) {
setRenameTarget(atom.index);
setRenameDraft(displayNameRef.current(atom));
return;
}
const mapped = mapAtomToNmrKeys(atom, parsedSeqRef.current, moleculeTypeRef.current, namingConventionRef.current);
if (mapped && onAtomClickRef.current) onAtomClickRef.current(mapped.ri, mapped.keys);
});

let lastHover = null;
stage.signals.hovered.add((pickingProxy) => {
if (!pickingProxy || !pickingProxy.atom) {
if (lastHover !== null) { lastHover = null; setHoverInfo(null); }
return;
}
const atom = pickingProxy.atom;
const mapped = mapAtomToNmrKeys(atom, parsedSeqRef.current, moleculeTypeRef.current, namingConventionRef.current);
const label = mapped ? mapped.label : `${atom.resname || ''} ${atom.resno || ''} ${displayNameRef.current(atom)}`.trim();
if (label !== lastHover) { lastHover = label; setHoverInfo(label); }
});

return stage;
})().catch((err) => {
if (!cancelled) {
setErrorMsg(err?.message || 'Failed to initialize the NGL viewer.');
setStatus('error');
}
return null;
});

return () => {
cancelled = true;
stageReadyRef.current = null;
if (stageRef.current) {
stageRef.current.dispose();
stageRef.current = null;
}
blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
blobUrlsRef.current = [];
};
}, []);

const [manualOverride, setManualOverride] = useState(false);
const lastLoadedTextRef = useRef(null);
const lastSeenSrcRef = useRef(undefined);
const lastSeenTextRef = useRef(undefined);

useEffect(() => {
if (src !== lastSeenSrcRef.current) {
lastSeenSrcRef.current = src;
if (src) setManualOverride(false);
}
}, [src]);

// Load structure from an external data-URL (e.g. file picked in the MD page)
const lastSeenFileDataRef = useRef(undefined);
useEffect(() => {
if (structureFileData === lastSeenFileDataRef.current) return;
lastSeenFileDataRef.current = structureFileData;
if (!structureFileData) return;
setManualOverride(true);
setFile(null);
try {
const [meta, b64] = String(structureFileData).split(',');
const mime = /data:([^;,]+)/.exec(meta)?.[1] || 'application/octet-stream';
const bin = atob(b64);
const bytes = new Uint8Array(bin.length);
for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
const blob = new Blob([bytes], { type: mime });
const ext = structureFormat !== 'auto' ? structureFormat : (structureFileName || 'structure.pdb').split('.').pop();
const fakeFile = new File([blob], structureFileName || 'structure.pdb', { type: mime });
setLoadRequest({ file: fakeFile, url: null, ts: Date.now() });
} catch (e) {
setErrorMsg('Failed to decode structure file data.');
setStatus('error');
}
}, [structureFileData, structureFileName, structureFormat]);

useEffect(() => {
if (structureText !== lastSeenTextRef.current) {
lastSeenTextRef.current = structureText;
if (structureText) setManualOverride(false);
}
}, [structureText]);

useEffect(() => {
if (manualOverride) return;
if (!structureText) { lastLoadedTextRef.current = null; return; }
if (structureText !== lastLoadedTextRef.current) {
lastLoadedTextRef.current = structureText;
setFile(null);
setLoadRequest({ file: null, url: null, text: structureText, ext: structureTextExt || 'pdb', ts: Date.now() });
}
}, [structureText, structureTextExt, manualOverride]);

useEffect(() => {
if (manualOverride || structureText) return;
if (src) {
setFile(null);
setLoadRequest({ file: null, url: src, ts: Date.now() });
}
}, [src, structureText, manualOverride]);

useEffect(() => {
if (manualOverride || structureText || loadRequest) return;
if (externalLoading) { setStatus('loading'); setErrorMsg(''); }
else if (externalError) { setStatus('error'); setErrorMsg(externalError); }
}, [externalLoading, externalError, structureText, loadRequest, manualOverride]);

// Add the default (backbone + sidechain + hetero) representations, honouring the
// current "Backbone" style selector. Called on load and when restoring from "Hide all".
const addDefaultReps = (component) => {
  if (!component || !component.structure) return;
  baseCompsRef.current = [];
  const trackBase = (r) => { if (r) baseCompsRef.current.push(r); };
  const organicLike = ['organic', 'lipid', 'sugar'].includes(moleculeTypeRef.current);
  if (organicLike) {
    try { trackBase(component.addRepresentation('ball+stick', { colorScheme: 'element', multipleBond: true, aspectRatio: 1.3 })); } catch (e) {}
    return;
  }
  const isNucleic = moleculeTypeRef.current === 'dna' || moleculeTypeRef.current === 'rna';
  if (isNucleic) {
    try { trackBase(component.addRepresentation('ball+stick', { sele: 'all', colorScheme: 'element', multipleBond: true, aspectRatio: 1.1 })); } catch (e) {}
    return;
  }
  const bb = backboneStyleRef.current || 'cartoon';
  try {
    if (bb === 'cartoon') trackBase(component.addRepresentation('cartoon', { sele: 'protein', color: 'residueindex', quality: 'high' }));
    else if (bb === 'tube') trackBase(component.addRepresentation('cartoon', { sele: 'protein', color: 'residueindex', radius: 0.3, quality: 'high' }));
    else if (bb === 'sticks') trackBase(component.addRepresentation('ball+stick', { sele: 'protein and not sidechain', colorScheme: 'element', multipleBond: true, aspectRatio: 1.1 }));
    else if (bb === 'lines') trackBase(component.addRepresentation('line', { sele: 'protein', colorScheme: 'element' }));
    else if (bb === 'spheres') trackBase(component.addRepresentation('spacefill', { sele: 'protein', colorScheme: 'element', scale: 0.6 }));
  } catch (e) {}
  try { trackBase(component.addRepresentation('ball+stick', { sele: 'hetero and not water', aspectRatio: 1.1 })); } catch (e) {}
};

// Main structure load
useEffect(() => {
if (!loadRequest || (!loadRequest.file && !loadRequest.url && !loadRequest.text)) return;
let cancelled = false;
setStatus('loading');
setErrorMsg('');
setTrajFile(null);
setTrajStatus('none');
setNumFrames(0);
setCurrentFrame(0);
setPlaying(false);
setTrajError('');
trajRef.current = null;

const run = async () => {
try {
const stage = await stageReadyRef.current;
if (cancelled || !stage) return;
stage.removeAllComponents();
componentRef.current = null;
highlightCompRef.current = null;
manualHighlightCompRef.current = null;
labelCompRef.current = null;
sidechainCompRef.current = null;

let component;
if (loadRequest.file) {
component = await stage.loadFile(loadRequest.file);
} else if (loadRequest.text) {
const blob = new Blob([loadRequest.text], { type: 'text/plain' });
component = await stage.loadFile(blob, { ext: loadRequest.ext || 'pdb' });
} else {
const target = normalizeStructureSource(loadRequest.url);
if (!target) throw new Error('No structure URL or PDB ID provided');
try {
component = target.params ? await stage.loadFile(target.url, target.params) : await stage.loadFile(target.url);
} catch (firstErr) {
if (cancelled) throw firstErr;
let loaded = false;
if (target.fallbacks && Array.isArray(target.fallbacks)) {
for (const fb of target.fallbacks) {
if (cancelled) throw firstErr;
try {
component = fb.params ? await stage.loadFile(fb.url, fb.params) : await stage.loadFile(fb.url);
loaded = true;
break;
} catch (fbErr) { /* try next fallback */ }
}
}
if (!loaded) {
const raw = (loadRequest.url || '').trim();
const idMatch = raw.match(/([0-9][A-Za-z0-9]{3})(?:\.[A-Za-z0-9]+)?\/?$/);
if (idMatch) {
const id = idMatch[1].toUpperCase();
try {
component = await stage.loadFile(`https://files.rcsb.org/download/${id}.pdb`, { ext: 'pdb' });
} catch (secondErr) {
if (cancelled) throw secondErr;
component = await stage.loadFile(`rcsb://${id}`);
}
} else {
throw firstErr;
}
}
}
}

if (cancelled) return;
componentRef.current = component;

// Note: NGL viewer structures from PDB/SDF already contain hydrogens when generated correctly.
// We skip addHydrogens() to prevent "is not a function" errors in this NGL version.

addDefaultReps(component);

component.autoView();
requestAnimationFrame(() => {
if (cancelled || !stageRef.current) return;
try { stageRef.current.handleResize(); } catch (e) {}
try { component.autoView(); } catch (e) {}
});

if (!(component.structure ? component.structure.atomCount : 0)) {
throw new Error('The structure loaded but contains no atoms (empty/invalid file content).');
}
setStatus('ready');
} catch (err) {
if (!cancelled) {
const raw = (err && err.message ? String(err.message) : '').trim();
setErrorMsg(raw || 'Failed to load structure.');
setStatus('error');
}
}
};
run();
return () => { cancelled = true; };
}, [loadRequest]);

// ---- Trajectory Loading Effect ----
useEffect(() => {
const component = componentRef.current;
if (!component || status !== 'ready') return;
const targetSrc = trajFile || trajectoryFile || trajectorySrc;
if (!targetSrc) return;
let cancelled = false;
setTrajStatus('loading');
setTrajError('');
setNumFrames(0);
setCurrentFrame(0);
setPlaying(false);

const initTraj = async () => {
try {
const NGL = await ensureNGL();
if (cancelled) return;
let targetCand = targetSrc;
let ext = trajectoryFormat || 'xtc';
if (typeof targetSrc === 'object' && targetSrc instanceof File) {
targetCand = URL.createObjectURL(targetSrc);
blobUrlsRef.current.push(targetCand);
const fileParts = targetSrc.name.split('.');
ext = fileParts.length > 1 ? fileParts.pop().toLowerCase() : ext;
}
const candidates = [
targetCand,
...(Array.isArray(trajectoryFallbacks) ? trajectoryFallbacks : []),
].filter(Boolean);
let frames = null;
let lastTrajErr = null;
for (const cand of candidates) {
if (cancelled) return;
try {
frames = await NGL.autoLoad(cand, { ext });
if (frames) break;
} catch (e) { lastTrajErr = e; }
}
if (!frames) throw lastTrajErr || new Error('Could not parse trajectory frames from any candidate URL');

if (cancelled) return;
const trajComp = component.addTrajectory(frames);
const traj = (trajComp && trajComp.trajectory) || getTrajectoryObject(component);
if (traj) {
trajRef.current = traj;
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
setTimeout(() => {
clearInterval(checkInterval);
if (getNumFrames(traj) === 0 && !cancelled) {
setTrajStatus('error');
setTrajError('Trajectory loaded but contains 0 frames. Verify that the PDB and XTC have the exact same atom count.');
}
}, 10000);
}
} else {
throw new Error('Could not attach trajectory');
}
} catch (err) {
if (!cancelled) {
setTrajStatus('error');
setTrajError(err?.message || 'Failed to load trajectory. Check matching atom count.');
}
}
};
initTraj();
return () => { cancelled = true; };
}, [trajFile, trajectoryFile, trajectorySrc, trajectoryFormat, status]);

// ---- Trajectory Playback Loop ----
useEffect(() => {
if (!playing || !trajRef.current || keptFrames === 0) return;
const interval = Math.max(16, 1000 / speed);
const id = setInterval(() => {
setCurrentFrame((prev) => {
const next = (prev + 1) % keptFrames;
setFrameSafe(trajRef.current, toActualFrame(next));
return next;
});
}, interval);
return () => clearInterval(id);
}, [playing, speed, keptFrames, stride, numFrames, maxFrames]);

const togglePlay = () => {
if (trajStatus !== 'ready' || keptFrames === 0) return;
setPlaying((p) => !p);
};

const handleFrameChange = (e) => {
const idx = parseInt(e.target.value, 10);
if (Number.isNaN(idx)) return;
setCurrentFrame(idx);
setFrameSafe(trajRef.current, toActualFrame(idx));
};

// Jump back to the start when the stride / max-frames controls change.
useEffect(() => {
if (trajRef.current && numFrames > 0) {
setCurrentFrame(0);
setFrameSafe(trajRef.current, toActualFrame(0));
}
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [stride, maxFrames]);

// Sync externally-provided atom renames (e.g. restored from the active test)
useEffect(() => {
  if (atomRenames && typeof atomRenames === 'object') {
    setRenames((prev) => {
      const next = { ...prev, ...atomRenames };
      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
    });
  }
}, [atomRenames]);

// Collect the atom list once the structure is ready (for the rename panel)
useEffect(() => {
  const component = componentRef.current;
  if (!component || status !== 'ready' || !component.structure) return;
  const list = [];
  try {
    component.structure.eachAtom((a) => {
      list.push({ idx: a.index, element: a.element || '', name: a.atomname || '', resno: a.resno || 0, resname: a.resname || '' });
    });
  } catch (e) {}
  setAtomList(list);
}, [status]);

// ---- PyMOL-style selections & effects ----
const selCompsRef = useRef({});       // key -> [representations]
const baseCompsRef = useRef([]);      // default representations added at load
const selStylesRef = useRef(selStyles);
selStylesRef.current = selStyles;

// Resolved NGL expression for a selection key (named selection or raw expr),
// with references to other named selections expanded inline (like PyMOL sets).
const selKeyExpr = (key) => {
  const named = selections.find((s) => s.name === key);
  let raw = named ? named.expr : key;
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    selections.forEach((s) => {
      const re = new RegExp(`\\b${s.name}\\b`, 'g');
      if (re.test(raw)) {
        raw = raw.replace(re, `(${translateSelection(s.expr)})`);
        changed = true;
      }
    });
    if (!changed) break;
  }
  return translateSelection(raw);
};

// Number of atoms matching a selection key (null when unsupported by NGL).
const selectionAtomCount = (key) => {
  const component = componentRef.current;
  if (!component || !component.structure) return null;
  try {
    const sel = component.structure.getSelection(selKeyExpr(key));
    return sel.count != null ? sel.count : (sel.length != null ? sel.length : null);
  } catch (e) {
    return null;
  }
};

// Rebuild all selection representations from selStyles.
useEffect(() => {
  const component = componentRef.current;
  if (!component || status !== 'ready') return;
  Object.keys(selCompsRef.current).forEach((k) => {
    (selCompsRef.current[k] || []).forEach((r) => { try { component.removeRepresentation(r); } catch (e) {} });
  });
  selCompsRef.current = {};
  // Base representations: removed in "hide all" or PyMOL-script mode, and rebuilt
  // when the backbone style changes or when restoring from "hide all".
  const backboneChanged = prevBackboneRef.current !== backboneStyle;
  if (hideAll || pymolActive) {
    baseCompsRef.current.forEach((r) => { try { component.removeRepresentation(r); } catch (e) {} });
    baseCompsRef.current = [];
  } else if (backboneChanged || baseCompsRef.current.length === 0) {
    baseCompsRef.current.forEach((r) => { try { component.removeRepresentation(r); } catch (e) {} });
    baseCompsRef.current = [];
    addDefaultReps(component);
  }
  prevBackboneRef.current = backboneStyle;
  if (hideAll) return;
  const styles = selStylesRef.current || {};
  Object.keys(styles).forEach((key) => {
    const st = styles[key] || {};
    const expr = selKeyExpr(key);
    if (!expr || expr === '') return;
    const color = st.color != null ? st.color : undefined;
    const opacity = st.transparency != null ? Math.max(0, Math.min(1, 1 - st.transparency)) : undefined;
    const reps = [];
    const add = (type, params) => {
      try { reps.push(component.addRepresentation(type, { sele: expr, ...params })); } catch (e) {}
    };
    if (st.cartoon) add('cartoon', { color, opacity });
    if (st.sphere) add('spacefill', { scale: st.sphereScale || 1, color, opacity, multipleBond: true });
    if (st.stick) add('ball+stick', { color, opacity, multipleBond: true });
    if (st.surface) add('surface', { color, opacity: opacity != null ? opacity : 0.5 });
    selCompsRef.current[key] = reps;
  });
  return () => {
    Object.keys(selCompsRef.current).forEach((k) => {
      (selCompsRef.current[k] || []).forEach((r) => { try { component.removeRepresentation(r); } catch (e) {} });
    });
    selCompsRef.current = {};
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [status, selections, selStyles, pymolActive, hideAll, backboneStyle]);

// Background colour + quality ("ray shadows" approximation)
useEffect(() => {
  const stage = stageRef.current;
  if (!stage) return;
  try { stage.setParameters({ backgroundColor: bgColor }); } catch (e) {}
  try { stage.setQuality(qualityHigh ? 'high' : 'medium'); } catch (e) {}
}, [bgColor, qualityHigh, status]);

const parsePyMOL = (text) => {
  const sels = [];
  const acts = [];
  const colorDefs = {};
  String(text || '').split(/\r?\n/).forEach((raw) => {
    const line = (raw.split('#')[0] || '').trim();
    if (!line) return;
    // PyMOL puts the command AND its first argument before the first comma,
    // e.g. "select water, resn TIP3", "show sphere, resn POPC", "set sphere_scale, 1.0, sel".
    const commaIdx = line.indexOf(',');
    const head = (commaIdx >= 0 ? line.slice(0, commaIdx) : line).trim();
    const rest = commaIdx >= 0 ? line.slice(commaIdx + 1).split(',').map((p) => p.trim()) : [];
    const cmdMatch = head.match(/^([A-Za-z_.]+)\s*(.*)$/);
    const cmd = (cmdMatch ? cmdMatch[1] : head).toLowerCase();
    const arg1 = (cmdMatch ? cmdMatch[2] : '').trim();

    if (cmd === 'select') {
      // select <name>, <expr>   (the name is arg1)
      const name = arg1 || rest[0] || '';
      const expr = arg1 ? rest.join(',') : rest.slice(1).join(',');
      if (name && expr) sels.push({ name, expr });
    } else if (cmd === 'set_color') {
      const m = line.match(/set_color\s+(\S+)\s*,\s*\[([^\]]+)\]/i);
      if (m) {
        const rgb = m[2].split(/[\s,]+/).map(Number);
        if (rgb.length >= 3) colorDefs[m[1].trim()] = ((rgb[0] & 255) << 16) | ((rgb[1] & 255) << 8) | (rgb[2] & 255);
      }
    } else if (cmd === 'show' || cmd === 'hide') {
      const style = (arg1 || rest[0] || 'all').toLowerCase();
      const sel = (arg1 ? rest[0] : rest[1]) || 'all';
      acts.push({ type: cmd, style, sel });
    } else if (cmd === 'color') {
      const color = arg1 || rest[0];
      const sel = (arg1 ? rest[0] : rest[1]) || 'all';
      acts.push({ type: 'color', color, sel });
    } else if (cmd === 'bg_color') {
      acts.push({ type: 'bg_color', color: arg1 || rest[0] });
    } else if (cmd === 'cartoon') {
      const mode = (arg1 || 'automatic').toLowerCase();
      const sel = (arg1 ? rest[0] : rest[1]) || 'all';
      acts.push({ type: 'cartoon', mode, sel });
    } else if (cmd === 'surface') {
      acts.push({ type: 'surface', sel: arg1 || rest[0] || 'all' });
    } else if (cmd === 'set') {
      const prop = (arg1 || '').toLowerCase();
      const val = rest[0];
      const sel = rest[1] || 'all';
      if (prop === 'sphere_scale') acts.push({ type: 'sphere_scale', val: parseFloat(val), sel });
      else if (prop === 'transparency' || prop === 'sphere_transparency') acts.push({ type: 'transparency', val: parseFloat(val), sel });
    } else if (cmd === 'spectrum') {
      acts.push({ type: 'spectrum', sel: rest[2] || 'all' });
    } else if (cmd.startsWith('util.ray_shadows') || /util\.ray_shadows/.test(line)) {
      acts.push({ type: 'ray_shadows' });
    } else if (cmd === 'dist') {
      acts.push({ type: 'dist' }); // distance objects are reported, not drawn
    }
  });
  return { sels, acts, colorDefs };
};

const applyPyMOLScript = (text) => {
  const log = [];
  try {
    const { sels, acts, colorDefs } = parsePyMOL(text);
    const names = new Set(sels.map((s) => s.name));
    const nextSels = [
      ...selections.filter((s) => !names.has(s.name)),
      ...sels,
    ];
    setSelections(nextSels);
    const styleOf = (st) => (st === 'sphere' ? 'sphere' : st === 'stick' || st === 'sticks' ? 'stick' : st === 'cartoon' ? 'cartoon' : st === 'surface' ? 'surface' : st === 'line' || st === 'lines' ? 'line' : null);
    const next = { ...selStylesRef.current };
    // Reset every selection the script mentions to "hidden", then apply commands
    sels.forEach((s) => {
      const cur = next[s.name] || {};
      next[s.name] = { ...cur, cartoon: false, stick: false, sphere: false, surface: false };
    });
    acts.forEach((a) => {
      const key = names.has(a.sel) ? a.sel : (a.sel === 'all' ? 'all' : a.sel);
      const cur = next[key] || {};
      if (a.type === 'show' || a.type === 'hide') {
        const st = styleOf(a.style);
        if (st) next[key] = { ...cur, [st]: a.type === 'show' };
        if (a.style === 'everything' || a.style === 'all') {
          next[key] = { ...cur, cartoon: a.type === 'show', stick: a.type === 'show', sphere: a.type === 'show', surface: a.type === 'show' };
        }
      } else if (a.type === 'color') {
        const c = colorDefs[a.color] || parseColorInt(a.color);
        if (c != null) next[key] = { ...cur, color: c };
      } else if (a.type === 'sphere_scale') {
        next[key] = { ...cur, sphereScale: a.val || 1 };
      } else if (a.type === 'transparency') {
        next[key] = { ...cur, transparency: Math.max(0, Math.min(1, a.val || 0)) };
      } else if (a.type === 'bg_color') {
        const c = colorDefs[a.color] || parseColorInt(a.color);
        if (c != null) setBgColor(`#${c.toString(16).padStart(6, '0')}`);
      } else if (a.type === 'ray_shadows') {
        setQualityHigh(true);
        log.push('• util.ray_shadows → rendering quality set to High');
      } else if (a.type === 'dist') {
        log.push('• dist (distance measurements) are not drawn in the viewer');
      } else if (a.type === 'cartoon') {
        next[key] = { ...cur, cartoon: true };
      } else if (a.type === 'surface') {
        next[key] = { ...cur, surface: true };
      } else if (a.type === 'spectrum') {
        log.push('• spectrum (by residue) approximated with per-residue rainbow colour');
      }
    });
    setSelStyles(next);
    setPymolActive(true);
    setHideAll(false);
    // Reproduce every selection the script defines: selections that received no
    // explicit style from the script are shown as a subtle semi-transparent
    // sphere so the user can see exactly which atoms each one captures.
    if (autoShowSel && sels.length) {
      const PAL = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#a3e635', '#f472b6', '#6366f1', '#84cc16', '#eab308', '#0ea5e9', '#f43f5e'];
      let ci = 0;
      const shown = {};
      Object.keys(next).forEach((k) => {
        const s = next[k] || {};
        if (s.cartoon || s.stick || s.sphere || s.surface) shown[k] = true;
      });
      const patch = {};
      sels.forEach((s) => {
        if (shown[s.name]) return;
        patch[s.name] = { ...(next[s.name] || {}), sphere: true, transparency: 0.6, sphereScale: 0.6, color: parseInt(PAL[ci % PAL.length].slice(1), 16) };
        ci++;
      });
      Object.assign(next, patch);
      setSelStyles({ ...next });
      log.push(`• Auto-shown ${Object.keys(patch).length} selection(s) as subtle spheres (toggle in the list below).`);
    } else {
      setSelStyles(next);
    }
    log.push(`✓ Parsed ${sels.length} selection(s) and ${acts.length} command(s).`);
  } catch (e) {
    log.push(`⚠️ ${e?.message || 'Failed to parse script.'}`);
  }
  setPymolLog(log.join('\n'));
};

const clearPyMOL = () => {
  setSelections([]);
  setSelStyles({});
  setPymolActive(false);
  setPymolLog('');
  setPymolScript('');
};

// Atom rename helpers
const applyRename = () => {
  if (renameTarget === null) return;
  const val = renameDraft.trim();
  const next = { ...renames };
  if (val) next[renameTarget] = val; else delete next[renameTarget];
  persistRenames(next);
  setRenameTarget(null);
  setRenameDraft('');
};
const autoNameFrom2D = () => {
  const component = componentRef.current;
  if (!component || !component.structure) return;
  const next = {};
  try {
    component.structure.eachAtom((a) => {
      next[a.index] = getOrganicAtomName(a);
    });
  } catch (e) {}
  persistRenames(next);
};
const clearRenames = () => persistRenames({});

// Atom labels
useEffect(() => {
const component = componentRef.current;
if (!component || status !== 'ready') return;
const clearLabels = () => {
if (labelCompRef.current) {
try { component.removeRepresentation(labelCompRef.current); } catch (e) {}
labelCompRef.current = null;
}
};
clearLabels();
if (showLabels) {
try {
const isOrganicLike = ['organic', 'lipid', 'sugar'].includes(moleculeTypeRef.current);
labelCompRef.current = component.addRepresentation('label', {
sele: isOrganicLike ? 'not hydrogen' : 'protein and sidechain and not hydrogen',
labelType: 'custom', labelGrouping: 'atom', color: 0x111827, radius: 1.0, opacity: 1, depthTest: false,
customLabel: (a) => displayNameRef.current(a),
});
} catch (e) {}
}
return clearLabels;
}, [showLabels, status, renames]);

// Side-chain representation
useEffect(() => {
const component = componentRef.current;
if (!component || status !== 'ready') return;
if (['organic', 'lipid', 'sugar'].includes(moleculeTypeRef.current)) return;
const clearSidechain = () => {
if (sidechainCompRef.current) {
try { component.removeRepresentation(sidechainCompRef.current); } catch (e) {}
sidechainCompRef.current = null;
}
};
clearSidechain();
if (sidechainStyle !== 'none' && !hideAll && !pymolActive) {
try {
sidechainCompRef.current = component.addRepresentation(sidechainStyle, {
sele: '(protein and sidechain) or (protein and .CA)', color: 'element', multipleBond: true,
radiusSize: sidechainStyle === 'licorice' ? 0.25 : undefined,
});
} catch (e) {}
}
return clearSidechain;
}, [sidechainStyle, status, hideAll, pymolActive]);

// Highlight selected and manually selected atoms
useEffect(() => {
const component = componentRef.current;
if (!component || status !== 'ready') return;

const clearHighlights = () => {
if (highlightCompRef.current) {
try { component.removeRepresentation(highlightCompRef.current); } catch (e) {}
highlightCompRef.current = null;
}
if (manualHighlightCompRef.current) {
try { component.removeRepresentation(manualHighlightCompRef.current); } catch (e) {}
manualHighlightCompRef.current = null;
}
};
clearHighlights();

const sel = Array.isArray(selectedKeys) ? selectedKeys : [];
const man = Array.isArray(manualKeys) ? manualKeys.filter((k) => !sel.includes(k)) : [];
if (sel.length === 0 && man.length === 0) return;

let organicNameToIndex = null;
const getOrganicNameToIndexMap = () => {
if (organicNameToIndex) return organicNameToIndex;
organicNameToIndex = {};
component.structure.eachAtom((a) => { organicNameToIndex[getOrganicAtomName(a)] = a.index; });
return organicNameToIndex;
};

const buildSele = (keys) => {
const parts = [];
keys.forEach((k) => {
const dashIdx = k.indexOf('-');
if (dashIdx < 0) return;
const ri = parseInt(k.substring(0, dashIdx), 10);
const atomName = k.substring(dashIdx + 1).trim();
const resno = ri + 1;

if (moleculeTypeRef.current === 'organic') {
const map = getOrganicNameToIndexMap();
if (Object.prototype.hasOwnProperty.call(map, atomName)) parts.push(`@${map[atomName]}`);
return;
}

// Handle MD / PDB naming convention
if (namingConventionRef.current === 'pdb') {
const seleParts = [`${resno} and .${atomName}`];
if (atomName === 'HN') seleParts.push(`${resno} and .H`);
if (atomName === 'H') seleParts.push(`${resno} and .HN`);
if (atomName === 'HA') seleParts.push(`${resno} and (.HA1 or .HA2 or .HA3)`);
if (['HA1', 'HA2', 'HA3'].includes(atomName)) seleParts.push(`${resno} and .HA`);
parts.push(`(${seleParts.join(' or ')})`);
return;
}

if (moleculeTypeRef.current === 'dna' || moleculeType === 'rna' || moleculeTypeRef.current === 'rna') {
const names = [atomName];
if (atomName === "OH2'") names.push("HO2'");
if (atomName === 'H7(CH3)') names.push('H71', 'H72', 'H73');
names.forEach((pn) => parts.push(`${resno} and .${pn}`));
return;
}

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
if (atomName.startsWith('H') && atomName.length > 1 && REVERSE_GREEK[atomName[1]]) {
const base = `H${REVERSE_GREEK[atomName[1]]}`;
pdbNames.push(base, `${base}1`, `${base}2`, `${base}3`);
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

return clearHighlights;
}, [selectedKeys, manualKeys, status]);

const handleFileChange = useCallback((e) => {
const f = e.target.files && e.target.files[0];
if (!f) return;
setManualOverride(true);
setFile(f);
setPdbId('');
setTrajFile(null);
setLoadRequest({ file: f, url: null, ts: Date.now() });
onStructureFile?.(f);   // share the chosen topology with the analysis sections
e.target.value = '';
}, [onStructureFile]);

const handlePdbIdLoad = useCallback(() => {
const value = pdbId.trim();
if (!value) return;
setManualOverride(true);
setFile(null);
setTrajFile(null);
setLoadRequest({ file: null, url: value, ts: Date.now() });
onStructureSrc?.(value);   // share the web/PDB topology with the analysis sections
}, [pdbId, onStructureSrc]);

return (
<div className="flex flex-col gap-3">
{/* Topology and Structure Controls */}
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

{/* Trajectory Loader */}
<div className="flex flex-col gap-1">
<label className="text-[10px] font-bold text-slate-500 uppercase">
Load Trajectory
</label>
<label className="cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-sm transition-colors inline-flex items-center gap-2">
📂 Choose XTC / TRR
<input
type="file"
accept=".xtc,.trr,.dcd"
onChange={(e) => {
const f = e.target.files && e.target.files[0];
if (f) {
setTrajFile(f);
onTrajectoryFile?.(f);   // share the chosen trajectory with the analysis sections
}
e.target.value = '';
}}
className="hidden"
/>
</label>
{(trajFile || trajectoryFile) && (
<span className="text-[10px] text-slate-500 max-w-[150px] truncate">
{(trajFile || trajectoryFile).name}
</span>
)}
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

<div className="flex flex-col gap-1">
<label className="text-[10px] font-bold text-slate-500 uppercase">
Backbone
</label>
<select
value={backboneStyle}
onChange={(e) => setBackboneStyle(e.target.value)}
className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 h-8"
>
<option value="cartoon">Cartoon</option>
<option value="tube">Cartoon (Tube)</option>
<option value="sticks">Sticks</option>
<option value="lines">Lines</option>
<option value="spheres">Spheres</option>
<option value="hidden">Hidden</option>
</select>
</div>
</div>

{/* View enhancement panels: Atom renaming + Selections / PyMOL */}
<div className="flex flex-wrap items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg p-2">
  <button type="button" onClick={() => setShowAtomPanel((v) => !v)}
    className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors ${showAtomPanel ? 'bg-amber-100 border-amber-400 text-amber-900' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'}`}>
    ✏️ Atom names{Object.keys(renames).length ? ` (${Object.keys(renames).length})` : ''}
  </button>
  <button type="button" onClick={() => setShowPymolPanel((v) => !v)}
    className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors ${showPymolPanel ? 'bg-violet-100 border-violet-400 text-violet-900' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'}`}>
    🧪 Selections & PyMOL
  </button>
  <button type="button" onClick={() => setHideAll((v) => !v)}
    className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors ${hideAll ? 'bg-red-100 border-red-400 text-red-800' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'}`}>
    {hideAll ? '👁️ Show default' : '🙈 Hide everything'}
  </button>
</div>

{showAtomPanel && (
  <div className="bg-amber-50/40 border border-amber-200 rounded-lg p-3 flex flex-col gap-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-[10px] font-black text-amber-700 uppercase tracking-wide">Atom names (3D only — the 2D formula is not touched)</span>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setRenameMode((v) => !v)}
          className={`px-2 py-1 text-[10px] font-bold rounded border ${renameMode ? 'bg-amber-600 text-white border-amber-600' : 'bg-white border-amber-300 text-amber-700 hover:bg-amber-100'}`}>
          {renameMode ? '● Click an atom…' : 'Click-to-rename'}
        </button>
        <button type="button" onClick={autoNameFrom2D} className="px-2 py-1 text-[10px] font-bold rounded bg-white border border-amber-300 text-amber-700 hover:bg-amber-100">Auto-name (2D)</button>
        <button type="button" onClick={clearRenames} className="px-2 py-1 text-[10px] font-bold rounded bg-white border border-red-300 text-red-600 hover:bg-red-50">Clear overrides</button>
      </div>
    </div>
    <p className="text-[10px] text-slate-500">
      {renameMode ? 'Click any atom in the 3D viewer, then type its new name below.' : 'Search the atom list and edit names directly. Changes are stored with the test and persist.'}
    </p>
    {renameTarget !== null && (
      <div className="flex items-center gap-2 bg-white border border-amber-300 rounded-lg p-2">
        <span className="text-xs font-bold text-slate-700">Atom #{renameTarget}:</span>
        <input value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applyRename(); }} className="border border-slate-300 rounded px-2 py-1 text-xs outline-none focus:border-amber-500" />
        <button type="button" onClick={applyRename} className="px-2 py-1 text-[10px] font-bold rounded bg-amber-600 text-white">OK</button>
        <button type="button" onClick={() => setRenameTarget(null)} className="px-2 py-1 text-[10px] font-bold rounded bg-slate-200 text-slate-700">Cancel</button>
      </div>
    )}
    <div className="flex items-center gap-2">
      <input value={atomSearch} onChange={(e) => setAtomSearch(e.target.value)} placeholder="Filter atoms…" className="border border-slate-300 rounded px-2 py-1 text-xs w-44 outline-none focus:border-amber-500" />
      <span className="text-[10px] text-slate-400">{atomList.length} atoms</span>
    </div>
    <div className="max-h-48 overflow-y-auto custom-scrollbar border border-amber-200 rounded-lg bg-white">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-amber-50">
          <tr>
            <th className="text-left px-2 py-1 text-[9px] uppercase text-amber-700">#</th>
            <th className="text-left px-2 py-1 text-[9px] uppercase text-amber-700">El</th>
            <th className="text-left px-2 py-1 text-[9px] uppercase text-amber-700">Current</th>
            <th className="text-left px-2 py-1 text-[9px] uppercase text-amber-700">New name</th>
          </tr>
        </thead>
        <tbody>
          {atomList
            .filter((a) => !atomSearch || (a.name || '').toLowerCase().includes(atomSearch.toLowerCase()) || (renames[a.idx] || '').toLowerCase().includes(atomSearch.toLowerCase()))
            .slice(0, 200)
            .map((a) => (
              <tr key={a.idx} className="border-t border-amber-100">
                <td className="px-2 py-1 text-slate-400">{a.idx}</td>
                <td className="px-2 py-1 font-bold text-slate-600">{a.element}</td>
                <td className="px-2 py-1 font-mono text-slate-500">{a.name}</td>
                <td className="px-2 py-1">
                  <input value={renames[a.idx] || a.name} onChange={(e) => { const next = { ...renames }; if (e.target.value.trim()) next[a.idx] = e.target.value; else delete next[a.idx]; persistRenames(next); }} className="w-20 border border-slate-300 rounded px-1.5 py-0.5 text-xs outline-none focus:border-amber-500" />
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  </div>
)}

{showPymolPanel && (
  <div className="bg-violet-50/40 border border-violet-200 rounded-lg p-3 flex flex-col gap-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-[10px] font-black text-violet-700 uppercase tracking-wide">Selections & PyMOL</span>
      <div className="flex gap-1.5">
        <button type="button" onClick={() => applyPyMOLScript(pymolScript)} className="px-2 py-1 text-[10px] font-bold rounded bg-violet-600 text-white hover:bg-violet-700">▶ Run script</button>
        <button type="button" onClick={clearPyMOL} className="px-2 py-1 text-[10px] font-bold rounded bg-white border border-red-300 text-red-600 hover:bg-red-50">Clear</button>
      </div>
    </div>
    <label className="text-[10px] font-bold text-slate-500 uppercase">Paste a PyMOL script (select / show / hide / color / set sphere_scale·transparency / bg_color / cartoon / surface / spectrum / util.ray_shadows)</label>
    <textarea value={pymolScript} onChange={(e) => setPymolScript(e.target.value)} rows={6}
      className="w-full border border-violet-300 rounded-lg p-2 text-[11px] font-mono outline-none focus:border-violet-500 bg-white"
      placeholder={'select peptide, polymer.protein\nshow cartoon, peptide\ncolor gold, name CA and peptide\nset sphere_scale, 0.6, headgroups\nset sphere_transparency, 0.3, upper_headgroups\nbg_color white'} />
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-bold text-slate-500 uppercase">Effects</span>
      <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600"><input type="checkbox" checked={autoShowSel} onChange={(e) => setAutoShowSel(e.target.checked)} className="accent-violet-600" /> Auto-show parsed selections</label>
      <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600"><input type="checkbox" checked={qualityHigh} onChange={(e) => setQualityHigh(e.target.checked)} className="accent-violet-600" /> High quality (ray-shadows approx.)</label>
      <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600">BG <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="w-8 h-6 border border-slate-300 rounded cursor-pointer" /></label>
    </div>
    {pymolLog && <pre className="text-[10px] text-slate-600 bg-white border border-violet-200 rounded-lg p-2 whitespace-pre-wrap max-h-24 overflow-y-auto">{pymolLog}</pre>}
    {selections.length > 0 && (
      <p className="text-[10px] text-violet-600 font-bold">
        ✓ {selections.length} selection(s) parsed — toggle them in the vertical bar on the right of the 3D viewer.
      </p>
    )}
  </div>
)}

{/* Trajectory Playback Controls */}
{(trajFile || trajectoryFile || trajectorySrc) && (
<div className="flex flex-wrap items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-lg p-3">
<button
type="button"
onClick={togglePlay}
disabled={trajStatus !== 'ready' || keptFrames === 0}
className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-sm transition-colors inline-flex items-center gap-1"
>
{playing ? '⏸ Pause' : '▶ Play'}
</button>
<div className="flex items-center gap-2 flex-1 min-w-[220px]">
<span className="text-[10px] font-bold text-indigo-700 whitespace-nowrap">Frame</span>
<input
type="range"
min={0}
max={Math.max(0, keptFrames - 1)}
value={currentFrame}
onChange={handleFrameChange}
disabled={trajStatus !== 'ready' || keptFrames === 0}
className="flex-1 accent-indigo-600"
/>
<span className="text-[10px] font-mono font-bold text-indigo-800 whitespace-nowrap">
{currentFrame} / {Math.max(0, keptFrames - 1)}
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
<label className="text-[10px] font-bold text-indigo-700 uppercase">Load every</label>
<select
value={stride}
onChange={(e) => setStride(Math.max(1, parseInt(e.target.value, 10) || 1))}
className="border border-indigo-300 rounded-lg px-2 py-1 text-xs bg-white outline-none focus:border-indigo-500"
title="Play every Nth frame — keeps the same total trajectory time with fewer frames"
>
{[1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].map((s) => <option key={s} value={s}>{s}×</option>)}
</select>
</div>
<div className="flex items-center gap-2">
<label className="text-[10px] font-bold text-indigo-700 uppercase">Max frames</label>
<input
type="number"
min="0"
value={maxFrames}
onChange={(e) => setMaxFrames(Math.max(0, parseInt(e.target.value, 10) || 0))}
className="border border-indigo-300 rounded-lg px-2 py-1 text-xs w-20 bg-white outline-none focus:border-indigo-500"
title="Limit the number of frames actually played (0 = keep all)"
/>
</div>
<div className="w-full">
{trajStatus === 'loading' && <span className="text-[11px] font-bold text-indigo-600">⏳ Loading trajectory ({trajectoryFormat.toUpperCase()})…</span>}
{trajStatus === 'ready' && (
  <span className="text-[11px] font-bold text-emerald-600">
    ✓ {trajectoryFormat.toUpperCase()}: {numFrames} frames total → playing {keptFrames} (stride {effStride})
  </span>
)}
{trajStatus === 'error' && <span className="text-[11px] font-bold text-red-600">⚠️ {trajError}</span>}
</div>
</div>
)}

{/* 3D Viewport */}
<div
className="relative border border-slate-200 rounded-xl overflow-hidden bg-white"
style={{ height }}
>
<div ref={containerRef} className="w-full h-full" />

{/* Vertical selections bar (right side of the viewer) */}
{selections.length > 0 && status === 'ready' && (
  <div className="absolute top-2 right-2 bottom-2 w-60 z-10 flex flex-col gap-2 bg-white/95 border border-violet-200 rounded-xl shadow-lg p-2 overflow-hidden">
    <div className="flex items-center justify-between gap-2 shrink-0">
      <span className="text-[10px] font-black text-violet-700 uppercase tracking-wide">Selections</span>
      <button type="button" onClick={() => setHideAll((v) => !v)}
        className={`px-2 py-0.5 text-[9px] font-bold rounded border ${hideAll ? 'bg-red-600 text-white border-red-600' : 'bg-white border-red-300 text-red-600 hover:bg-red-50'}`}
        title={hideAll ? 'Show everything again' : 'Hide every representation'}>
        {hideAll ? 'Show all' : '🙈 Hide all'}
      </button>
    </div>
    <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-1.5">
      {selections.map((s) => {
        const st = selStyles[s.name] || {};
        const n = selectionAtomCount(s.name);
        return (
          <div key={s.name} className="flex flex-col gap-1 border border-slate-100 rounded-lg p-1.5 bg-white">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-bold text-slate-700 truncate" title={s.expr}>{s.name}</span>
              <span className="text-[8px] text-slate-400 font-mono shrink-0">{n != null ? `${n} atoms` : '—'}</span>
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              {['cartoon', 'stick', 'sphere', 'surface'].map((style) => (
                <button key={style} type="button"
                  onClick={() => setSelStyles({ ...selStylesRef.current, [s.name]: { ...(selStylesRef.current[s.name] || {}), [style]: !((selStylesRef.current[s.name] || {})[style]) } })}
                  className={`px-1.5 py-0.5 text-[8px] font-bold rounded border ${st[style] ? 'bg-violet-600 text-white border-violet-600' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-violet-50'}`}>
                  {style}
                </button>
              ))}
              <input type="color" value={st.color != null ? `#${st.color.toString(16).padStart(6, '0')}` : '#000000'}
                onChange={(e) => { const c = parseInt(e.target.value.slice(1), 16); setSelStyles({ ...selStylesRef.current, [s.name]: { ...(selStylesRef.current[s.name] || {}), color: c } }); }}
                className="w-5 h-5 border border-slate-300 rounded cursor-pointer" title="Colour" />
            </div>
            <label className="flex items-center gap-1 text-[8px] text-slate-500">
              transp
              <input type="range" min="0" max="1" step="0.05" value={st.transparency || 0}
                onChange={(e) => setSelStyles({ ...selStylesRef.current, [s.name]: { ...(selStylesRef.current[s.name] || {}), transparency: parseFloat(e.target.value) } })}
                className="accent-violet-600 w-full" />
            </label>
          </div>
        );
      })}
    </div>
  </div>
)}

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