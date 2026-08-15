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
let sig = heavyIdx.map((gi, k) => `${elements[gi]}(${hCount[k]})`);
for (let iter = 0; iter < n; iter++) {
const next = sig.map((s, i) => `${s}|${adj[i].map((j) => sig[j]).sort().join(',')}`);
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
const groups = {};
for (let i = 0; i < n; i++) {
if (elements[i] !== 'H') continue;
const key = parent[i] >= 0 ? parent[i] : 'orphan';
(groups[key] = groups[key] || []).push(i);
}
const names = new Array(n);
for (let i = 0; i < n; i++) if (elements[i] !== 'H') names[i] = `${elements[i]}${ranks[i] >= 0 ? ranks[i] : i}`;
Object.entries(groups).forEach(([key, idxs]) => {
idxs.sort((x, y) => x - y);
const pr = key === 'orphan' ? null : ranks[Number(key)];
idxs.forEach((idx, j) => {
const suffix = idxs.length > 1 ? ('abcdefgh'[j] || String(j)) : '';
names[idx] = pr !== null ? `H${pr}${suffix}` : `H${idx}`;
});
});
_organicNamingCache.set(structure, names);
return names;
};

const getOrganicAtomName = (atom) => {
const names = getOrganicNaming(atom.structure);
return names[atom.index] || `X${atom.index}`;
};

let _nglLoadPromise = null;
const NGL_CDN_URLS = [
'https://unpkg.com/ngl@2.4.0/dist/ngl.js',
'https://cdn.jsdelivr.net/npm/ngl@2.4.0/dist/ngl.js',
];

const loadNGLFromUrl = (url) => new Promise((resolve, reject) => {
const script = document.createElement('script');
script.src = url;
script.async = true;
script.onload = () => {
if (window.NGL) resolve(window.NGL);
else reject(new Error(`Script loaded from ${url} but did not set window.NGL`));
};
script.onerror = () => reject(new Error(`Failed to fetch NGL script from ${url}`));
document.head.appendChild(script);
});

const ensureNGL = () => {
if (window.NGL) return Promise.resolve(window.NGL);
if (_nglLoadPromise) return _nglLoadPromise;
_nglLoadPromise = (async () => {
let lastErr = null;
for (const url of NGL_CDN_URLS) {
try { return await loadNGLFromUrl(url); } catch (e) { lastErr = e; }
}
_nglLoadPromise = null;
throw new Error(`Could not load the NGL viewer library from any CDN. ${lastErr ? lastErr.message : ''}`);
})();
return _nglLoadPromise;
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
onAtomClick,
selectedKeys,
manualKeys = [],
moleculeType = 'protein',
parsedSeq = [],
residueOffset = 0,
atomNameMap,
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

// ---- Trajectory State ----
const [trajFile, setTrajFile] = useState(null);
const [trajStatus, setTrajStatus] = useState('none');
const [trajError, setTrajError] = useState('');
const [numFrames, setNumFrames] = useState(0);
const [currentFrame, setCurrentFrame] = useState(0);
const [playing, setPlaying] = useState(false);
const [speed, setSpeed] = useState(10);
const trajRef = useRef(null);
const blobUrlsRef = useRef([]);

const parsedSeqRef = useRef(parsedSeq);
const moleculeTypeRef = useRef(moleculeType);
const onAtomClickRef = useRef(onAtomClick);
const residueOffsetRef = useRef(residueOffset);
const namingConventionRef = useRef(namingConvention);

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
const label = mapped ? mapped.label : `${atom.resname || ''} ${atom.resno || ''} ${atom.atomname || ''}`.trim();
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

const isOrganicLike = ['organic', 'lipid', 'sugar'].includes(moleculeTypeRef.current);
const isNucleic = moleculeTypeRef.current === 'dna' || moleculeTypeRef.current === 'rna';
if (isOrganicLike) {
try { component.addRepresentation('ball+stick', { colorScheme: 'element', multipleBond: true, aspectRatio: 1.3 }); } catch (e) {}
} else if (isNucleic) {
try { component.addRepresentation('ball+stick', { sele: 'all', colorScheme: 'element', multipleBond: true, aspectRatio: 1.1 }); } catch (e) {}
} else {
try { component.addRepresentation('cartoon', { color: 'residueindex', quality: 'high' }); } catch (e) {}
try { component.addRepresentation('ball+stick', { sele: 'hetero and not water', aspectRatio: 1.1 }); } catch (e) {}
}

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
}, [trajFile, trajectorySrc, trajectoryFormat, status]);

// ---- Trajectory Playback Loop ----
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
labelType: 'atomname', labelGrouping: 'atom', color: 0x111827, radius: 1.0, opacity: 1, depthTest: false,
});
} catch (e) {}
}
return clearLabels;
}, [showLabels, status]);

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
if (sidechainStyle !== 'none') {
try {
sidechainCompRef.current = component.addRepresentation(sidechainStyle, {
sele: '(protein and sidechain) or (protein and .CA)', color: 'element', multipleBond: true,
radiusSize: sidechainStyle === 'licorice' ? 0.25 : undefined,
});
} catch (e) {}
}
return clearSidechain;
}, [sidechainStyle, status]);

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
e.target.value = '';
}, []);

const handlePdbIdLoad = useCallback(() => {
const value = pdbId.trim();
if (!value) return;
setManualOverride(true);
setFile(null);
setTrajFile(null);
setLoadRequest({ file: null, url: value, ts: Date.now() });
}, [pdbId]);

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
if (f) setTrajFile(f);
e.target.value = '';
}}
className="hidden"
/>
</label>
{trajFile && (
<span className="text-[10px] text-slate-500 max-w-[150px] truncate">
{trajFile.name}
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
</div>

{/* Trajectory Playback Controls */}
{(trajFile || trajectorySrc) && (
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
<div className="w-full">
{trajStatus === 'loading' && <span className="text-[11px] font-bold text-indigo-600">⏳ Loading trajectory ({trajectoryFormat.toUpperCase()})…</span>}
{trajStatus === 'ready' && <span className="text-[11px] font-bold text-emerald-600">✓ Trajectory loaded ({trajectoryFormat.toUpperCase()}, {numFrames} frames)</span>}
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