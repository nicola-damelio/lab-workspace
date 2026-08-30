import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ensureNGL } from '../utils/ngl';
import { readXtcFrames, countXtcFrames, countXtcFramesInFile } from '../utils/xtcDecoder';
import { abortControl } from '../utils/abortControl';
import { archiveFileToDrive } from '../utils/driveUpload';
import { getPymolScripts } from '../utils/pymolScripts';
import { addLibraryItem, downscaleImage } from '../utils/figuresLibrary';

/* ---- Shared "Assigned atoms" highlight flag ---------------------------------
   The green "assigned atoms" highlight is shown both on the 3D molecule viewer
   (ball+stick representation) and on the SIMULATED SPECTRA (green marks on the
   peaks of manually-assigned atoms). Both read this one flag, so the single
   "🟢 Assigned atoms ON/OFF" button controls them together. */
let showAssignedFlag = true;
const assignedListeners = new Set();

export const getShowAssignedFlag = () => showAssignedFlag;

export const setShowAssignedFlag = (v) => {
  showAssignedFlag = !!v;
  assignedListeners.forEach((fn) => { try { fn(showAssignedFlag); } catch {} });
};

export const useShowAssignedFlag = () => {
  const [v, setV] = useState(getShowAssignedFlag());
  useEffect(() => {
    assignedListeners.add(setV);
    return () => { assignedListeners.delete(setV); };
  }, []);
  return v;
};

// ---- Trajectory frame selection -------------------------------------------
// Frame COUNT is what matters (not file size). Before parsing a trajectory the
// user is always asked how to load it: the full trajectory, the default of
// ~30 representative frames spread across the whole run, or a custom number.
const TARGET_TRAJ_FRAMES = 30;                   // default representative frame count
const TARGET_TRAJ_BYTES = 2 * 1024 * 1024 * 1024;  // 2 GB effective-load cap

const fmtBytesMB = (b) => `${(b / (1024 * 1024)).toFixed(1)} MB`;
const fmtBytesGB = (b) => `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;

// Rough bytes/frame estimate per format (coordinates + box + header).
const estimateTrajectoryFrames = (file, atomCount) => {
  const name = (file.name || '').toLowerCase();
  const n = atomCount > 0 ? atomCount : 300; // fallback atom count
  let bytesPerFrame;
  if (name.endsWith('.trr')) bytesPerFrame = n * 3 * 8 + 44;     // doubles
  else if (name.endsWith('.dcd')) bytesPerFrame = n * 3 * 4 + 40; // floats
  else bytesPerFrame = n * 3 * 2 + 48;                            // XTC (compressed ints)
  return {
    estFrames: Math.max(1, Math.round(file.size / Math.max(1, bytesPerFrame))),
    bytesPerFrame
  };
};

// ---- Large-structure handling ----------------------------------------------
// Large systems (e.g. a protein embedded in a lipid bilayer with explicit
// TIP3P water) are loaded in full and rendered in FULL — nothing is hidden.
// Above the thresholds below the default representations switch to lightweight
// instanced ones (protein cartoon + everything else as spacefill spheres), so
// the whole system stays visible without freezing the browser.
const LARGE_STRUCT_BYTES = 1.5 * 1024 * 1024;   // ~1.5 MB of structure text
const LARGE_ATOM_COUNT = 25000;                 // lighter rendering above this

const AA3_TO_1 = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G',
  HIS: 'H', HSD: 'H', HSE: 'H', HSP: 'H', ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M',
  PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V', CYX: 'C',
  SEC: 'U', PYL: 'O', ASX: 'B', GLX: 'Z',
  DA: 'A', DC: 'C', DG: 'G', DT: 'T', DU: 'U'
};

// 1-letter sequence from an NGL structure. Tries NGL's getSequence() first,
// then falls back to walking the residues (handles .gro topologies and any
// PDB where NGL does not auto-detect the chains as polymers).
const extractStructureSequence = (component) => {
  if (!component || !component.structure) return '';
  if (typeof component.structure.getSequence === 'function') {
    try {
      const arr = component.structure.getSequence();
      if (Array.isArray(arr) && arr.length) {
        const seq = arr
          .map((s) => (s && (s.seq || s.sequence)) || '')
          .join('')
          .replace(/[^A-Za-z]/g, '');
        if (seq) return seq;
      }
    } catch { /* fall through */ }
  }
  let seq = '';
  try {
    component.structure.eachResidue((r) => {
      const name = String((r && (r.resname || r.restype)) || '').toUpperCase();
      const code = AA3_TO_1[name] || (name.length === 1 && /[ACGTU]/.test(name) ? name : '');
      if (code) seq += code;
    });
  } catch { /* fall through */ }
  return seq;
};

// Per-residue "tick" list for the sequence strip above the 3D viewport.
// Iterates the structure's residues in the same order as extractStructureSequence
// so tick index i ↔ residue ri = resno - 1 (the app-wide convention used by
// mapPdbAtomToNmrKeys and the per-atom tables). Also precomputes the PDB atom
// names of each residue in ONE pass so tick clicks never need a full-structure
// atom scan (which can freeze the page on large / multi-model systems).
const collectResidueTicks = (component) => {
  if (!component || !component.structure) return [];
  const out = [];
  const atomsByRes = new Map(); // `${chainid}|${resno}` -> Set(PDB atom names)
  try {
    component.structure.eachAtom((a) => {
      const key = `${String(a.chainid || a.chain || '')}|${a.resno}`;
      if (!atomsByRes.has(key)) atomsByRes.set(key, new Set());
      const nm = String(a.atomname || '').trim();
      if (nm) atomsByRes.get(key).add(nm);
    });
    component.structure.eachResidue((r) => {
      const name = String((r && (r.resname || r.restype)) || '').toUpperCase();
      const code = AA3_TO_1[name] || (name.length === 1 && /[ACGTU]/.test(name) ? name : '');
      const chainid = r && (r.chainid || r.chain) ? String(r.chainid || r.chain) : '';
      out.push({
        resno: r && r.resno != null ? r.resno : out.length + 1,
        resname: name || String((r && r.restype) || 'UNK'),
        code: code || (name.length === 1 ? name : ''),
        // TRUE only for polymer residues (protein / nucleic). Water, ions,
        // lipids and other hetero have no 1-letter code and are excluded from
        // the sequence strip (they are not part of the polymer "sequence").
        polymer: !!code,
        chainid,
        atomNames: [...(atomsByRes.get(`${chainid}|${r.resno}`) || [])],
      });
    });
  } catch { /* keep partial list */ }
  return out;
};

// The viewer no longer hides chains on large systems — they are rendered in
// full with lightweight representations (see addDefaultReps). This constant
// simply starts the selection-color block below.
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
// NOTE: Google-Drive link loading was removed — structures are uploaded from
// the PC (and archived to Drive automatically), so pasting a Drive link as the
// source is no longer needed. PDB IDs, rcsb: and plain https URLs still work.
if (/^(https?:|blob:|data:)/i.test(value)) {
const path = value.split(/[?#]/)[0];
const ext = path.includes('.') ? path.split('.').pop().toLowerCase() : '';
if (ext === 'pdb' || ext === 'ent') return { url: value, params: { ext: 'pdb' } };
if (ext === 'gro') return { url: value, params: { ext: 'gro' } };
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
} catch {}
};

/** Split a text PDB file into one Blob per MOLECULE (connected fragment).
 *  Atoms are grouped by COVALENT connectivity scoped to their MODEL record:
 *  CONECT bonds first, then implicit bonds by proximity (≤ 2.0 Å, via a
 *  spatial grid). This separates:
 *   - distinct chains (protein + ligand chain, complexes),
 *   - separate molecules that share ONE chain (receptor + ligand in chain A),
 *   - multimeric complexes held together only by non-covalent contacts,
 *   - overlapping conformers of a multi-MODEL PDB (NMR ensembles / docking
 *     clusters) — bonds never cross MODEL boundaries, so conformers with
 *     identical/overlapping coordinates are never merged into a single blob.
 *  Pure-water fragments are skipped, so a hydrated protein does not explode
 *  into dozens of tiny "molecule" entries. Returns [] when the file has 0/1
 *  molecules or cannot be read — the caller keeps the whole structure.
 *  Deterministic text parsing — independent of NGL internals. */
const splitPdbFileIntoMolecules = async (file) => {
  if (!file) return [];
  let text = '';
  try { text = await file.text(); } catch { return []; }
  const lines = String(text || '').split(/\r?\n/);

  const atoms = [];                 // { line, chain, resname, model, x, y, z }
  const conectBonds = [];           // [i, j] pairs into `atoms`
  const conectIndex = new Map();    // serial -> first atom index (bonds are
                                    // same-MODEL filtered below, so restarted
                                    // serials can never merge two conformers)
  let model = 0;                    // 0-based index of the MODEL block owning the current atoms
  let blocksSeen = 0;               // number of MODEL records seen so far
  for (const line of lines) {
    const rec = line.slice(0, 6).trim();
    if (rec === 'MODEL') {
      model = blocksSeen;   // the next block gets the next 0-based index
      blocksSeen += 1;
      continue;
    }
    if (rec === 'ATOM' || rec === 'HETATM') {
      const serial = parseInt(line.slice(6, 11), 10);
      const idx = atoms.length;
      const x = parseFloat(line.slice(30, 38));
      const y = parseFloat(line.slice(38, 46));
      const z = parseFloat(line.slice(46, 54));
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue; // invalid coords
      atoms.push({
        line,
        chain: line.slice(21, 22).trim() || '_',
        resname: line.slice(17, 20).trim(),
        model,
        x, y, z
      });
      if (Number.isFinite(serial) && !conectIndex.has(serial)) conectIndex.set(serial, idx);
    } else if (rec === 'CONECT') {
      const serial = parseInt(line.slice(6, 11), 10);
      const a = conectIndex.get(serial);
      if (a === undefined) continue;
      for (let s = 11; s + 5 <= line.length; s += 5) {
        const bs = parseInt(line.slice(s, s + 5), 10);
        const b = conectIndex.get(bs);
        if (b === undefined) continue;
        conectBonds.push([a, b]);
      }
    }
  }
  if (atoms.length === 0) return [];
  const modelCount = blocksSeen > 0 ? blocksSeen : 1;  // 1 = no MODEL records (single model)

  const parent = atoms.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  // CONECT bonds are only valid INSIDE one MODEL — serial numbers may repeat
  // across conformers, and a bond between different models would merge them.
  conectBonds.forEach(([a, b]) => { if (atoms[a].model === atoms[b].model) union(a, b); });

  // Implicit covalent bonds by proximity — spatial grid keeps this O(n).
  // Same-MODEL rule again: overlapping conformers of an ensemble never merge.
  const BOND_DIST = 2.0;
  const grid = new Map();
  const cellKey = (cx, cy, cz) => `${cx}|${cy}|${cz}`;
  atoms.forEach((a, i) => {
    const key = cellKey(Math.floor(a.x / BOND_DIST), Math.floor(a.y / BOND_DIST), Math.floor(a.z / BOND_DIST));
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  });
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    const cx = Math.floor(a.x / BOND_DIST), cy = Math.floor(a.y / BOND_DIST), cz = Math.floor(a.z / BOND_DIST);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const cell = grid.get(cellKey(cx + dx, cy + dy, cz + dz));
          if (!cell) continue;
          for (const j of cell) {
            if (j <= i) continue;
            const b = atoms[j];
            if (a.model !== b.model) continue;
            const ddx = a.x - b.x, ddy = a.y - b.y, ddz = a.z - b.z;
            if (ddx * ddx + ddy * ddy + ddz * ddz <= BOND_DIST * BOND_DIST) union(i, j);
          }
        }
      }
    }
  }

  // Group by root; skip pure-water fragments; cap the number of entries.
  const groups = new Map();
  atoms.forEach((_, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  });
  const parts = [];
  groups.forEach((idxs) => {
    if (parts.length >= 30) return;
    const pureWater = idxs.every((i) => atoms[i].resname === 'HOH' || atoms[i].resname === 'WAT');
    if (pureWater) return;
    parts.push({
      chainId: atoms[idxs[0]].chain,
      model: atoms[idxs[0]].model,
      modelCount,
      blob: new Blob([idxs.map((i) => atoms[i].line).join('\n') + '\nEND\n'], { type: 'text/plain' })
    });
  });
  return parts;
};

// Reverse map: NMR-style atom name → possible PDB atom names. Built once so
// highlight selection strings never re-scan PDB_TO_NMR per atom key (that is
// what made buildSele quadratic-ish for thousands of manual keys).
const NMR_TO_PDB_NAMES = (() => {
  const m = new Map();
  Object.entries(PDB_TO_NMR).forEach(([pdb, nmr]) => {
    if (!m.has(nmr)) m.set(nmr, []);
    m.get(nmr).push(pdb);
  });
  return m;
})();

// Build an NGL selection string from atom keys ("ri-atom"). Shared by the amber
// (selected) and green (manually-assigned) highlights so neither effect has to
// duplicate the logic. Builds SELECTION TEXT only — the caller picks the
// representation. Fast even for thousands of keys.
const buildNglSele = (keys, structure, moleculeType, namingConvention) => {
  if (!Array.isArray(keys) || keys.length === 0) return null;
  const parts = [];
  let organicNameToIndex = null;
  const getOrganicNameToIndexMap = () => {
    if (organicNameToIndex) return organicNameToIndex;
    organicNameToIndex = {};
    try { structure.eachAtom((a) => { organicNameToIndex[getOrganicAtomName(a)] = a.index; }); } catch { organicNameToIndex = {}; }
    return organicNameToIndex;
  };

  keys.forEach((k) => {
    const dashIdx = String(k).indexOf('-');
    if (dashIdx < 0) return;
    const ri = parseInt(String(k).substring(0, dashIdx), 10);
    if (!Number.isFinite(ri)) return;
    const atomName = String(k).substring(dashIdx + 1).trim();
    const resno = ri + 1;

    if (moleculeType === 'organic') {
      const map = getOrganicNameToIndexMap();
      if (Object.prototype.hasOwnProperty.call(map, atomName)) parts.push(`@${map[atomName]}`);
      return;
    }

    // MD / PDB naming convention
    if (namingConvention === 'pdb') {
      const seleParts = [`${resno} and .${atomName}`];
      if (atomName === 'HN') seleParts.push(`${resno} and .H`);
      if (atomName === 'H') seleParts.push(`${resno} and .HN`);
      if (atomName === 'HA') seleParts.push(`${resno} and (.HA1 or .HA2 or .HA3)`);
      if (['HA1', 'HA2', 'HA3'].includes(atomName)) seleParts.push(`${resno} and .HA`);
      parts.push(`(${seleParts.join(' or ')})`);
      return;
    }

    if (moleculeType === 'dna' || moleculeType === 'rna') {
      const names = [atomName];
      if (atomName === "OH2'") names.push("HO2'");
      if (atomName === 'H7(CH3)') names.push('H71', 'H72', 'H73');
      names.forEach((pn) => parts.push(`${resno} and .${pn}`));
      return;
    }

    const pdbNames = (NMR_TO_PDB_NAMES.get(atomName) || []).slice();
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
structureFile,
structureFormat = 'auto',
trajectorySrc,
trajectoryFile,
trajectoryFallbacks = [],
trajectoryFormat = 'xtc',
onStructureFile,
onStructureSrc,
onTrajectoryFile,
driveNaming = null,   // naming context → archive chosen structure files to Drive
onAtomClick,
selectedKeys,
manualKeys = [],
moleculeType = 'protein',
parsedSeq = [],
residueOffset = 0,
atomRenames,
onAtomRenames,
namingConvention = 'nmr',
resRenumber,
onResRenumber,
onStructureSequence,
height = '520px',
}) => {
// 3D viewport height — the viewer is RESIZABLE via the drag handle below it.
const [viewH, setViewH] = useState(() => {
  const m = /^(\d+)/.exec(String(height || '520px'));
  return m ? Math.max(240, parseInt(m[1], 10)) : 520;
});
const resizeRef = useRef(null); // { startY, startH } while dragging

// ---- Retractable viewer window ----
// "⬇ Minimize" collapses the 3D viewport to a thin bar (the stage stays
// mounted, so the structure and trajectory are never lost); "⬆ Expand"
// restores it and tells NGL that the canvas size changed.
const [viewerCollapsed, setViewerCollapsed] = useState(false);
const [captureMsg, setCaptureMsg] = useState('');

useEffect(() => {
  const move = (ev) => {
    if (!resizeRef.current) return;
    const dh = ev.clientY - resizeRef.current.startY;
    setViewH(Math.max(240, Math.min(2400, resizeRef.current.startH + dh)));
  };
  const up = () => { resizeRef.current = null; };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  return () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  };
}, []);

// NGL must be told when the container grew/shrunk (it only auto-listens to
// window resizes, not to our drag handle).
useEffect(() => {
  try { if (stageRef.current) stageRef.current.handleResize(); } catch {}
}, [viewH]);

// When the viewer is re-expanded after being minimized (canvas height went
// 0 → viewH), NGL must be told the size changed or the picture stays blank.
useEffect(() => {
  if (viewerCollapsed) return;
  try {
    if (stageRef.current) {
      stageRef.current.handleResize();
      if (stageRef.current.viewer) stageRef.current.viewer.requestRender();
    }
  } catch { /* ignore */ }
}, [viewerCollapsed]);

const containerRef = useRef(null);
const stageRef = useRef(null);
const stageReadyRef = useRef(null);
const componentRef = useRef(null);
const highlightCompRef = useRef(null);
const manualHighlightCompRef = useRef(null);
const stripHighlightCompRef = useRef(null);   // whole-residue amber highlight from a tick click
const stripResidueRiRef = useRef(null);       // residue index (ri) selected via the strip
const manualSigRef = useRef('');              // signature of the last green "assigned atoms" highlight
const manualSigCompRef = useRef(null);        // the component that signature was built for (structure reload)
const labelCompRef = useRef(null);
const sidechainCompRef = useRef(null);
const abortRef = useRef(null); // { token, label, cancel } of the active long-running operation (structure / trajectory load)

const [file, setFile] = useState(null);
const [pdbId, setPdbId] = useState('');
const [loadRequest, setLoadRequest] = useState(null);
const [status, setStatus] = useState('idle');
const [errorMsg, setErrorMsg] = useState('');
const showManualHighlight = useShowAssignedFlag(); // green "assigned" atoms toggle (shared with the simulated spectra)
const [hoverInfo, setHoverInfo] = useState(null);
const [showLabels, setShowLabels] = useState(false);
const [sidechainStyle, setSidechainStyle] = useState('licorice');
const [backboneStyle, setBackboneStyle] = useState('cartoon');
// Visualization style for NON-protein molecules (organic / lipid / sugar / nucleic):
// they previously had no style options at all — just a hard-coded ball+stick.
const [moleculeStyle, setMoleculeStyle] = useState('ball+stick');

// ---- Multiple structures & multi-model PDB (docking clusters: HADDOCK/AutoDock) ----
// extraMols = extra loaded structure files (each its own NGL component); the
// "Molecules" selector shows exactly one at a time. Multi-MODEL PDB files
// (NMR ensembles / docking clusters) are split into one entry per MODEL by the
// main-load effect, so they appear in the same "Molecules" selector.
const [extraMols, setExtraMols] = useState([]);    // [{ id, name }]
const [visibleMolKeys, setVisibleMolKeys] = useState(() => new Set(['main'])); // multi-select: which structures are shown
const [residueTicks, setResidueTicks] = useState([]); // [{ resno, resname, code, chainid }] — sequence strip above the 3D view
const extraCompsRef = useRef([]);                  // [{ id, name, comp }]
// Files chosen as "additional molecules" that must wait until the MAIN structure
// has finished loading — the main load calls stage.removeAllComponents(), which
// would wipe any component added concurrently. They are flushed once the main
// structure is ready (status === 'ready'), then cleared.
const pendingExtraFilesRef = useRef([]);           // [{ file, n }]

// Remove every extra uploaded molecule (its NGL components). Called at the START
// of any new main-structure load — NOT after it — so a freshly-selected batch
// of files is never wiped by the main load that runs concurrently with them.
const clearExtraMolecules = useCallback(() => {
  extraCompsRef.current.forEach(({ comp }) => {
    try { if (stageRef.current) stageRef.current.removeComponent(comp); } catch {}
  });
  extraCompsRef.current = [];
  pendingExtraFilesRef.current = [];
  setExtraMols([]);
  setVisibleMolKeys(new Set(['main']));
}, []);

// ---- Atom renaming (3D, post-generation) ----
const [renames, setRenames] = useState(() => (atomRenames && typeof atomRenames === 'object' ? { ...atomRenames } : {}));
const renamesRef = useRef(renames);
renamesRef.current = renames;

// ---- Residue renumbering (3D labels / analysis numbering) ----
// Map of { originalResno: newResno } — lets the user renumber residues when a
// PDB does not start at 1 (or any custom renumbering).
const [renumberMap, setRenumberMap] = useState(() => (resRenumber && typeof resRenumber === 'object' ? { ...resRenumber } : {}));
const [showRenumberPanel, setShowRenumberPanel] = useState(false);
const [residueInfo, setResidueInfo] = useState([]); // [{ resno, resname, count }]
const [renumberFrom, setRenumberFrom] = useState(1); // starting number for "Renumber from"
const displayResno = (resno) => {
  const v = renumberMap[String(resno)];
  return v != null ? v : resno;
};
const commitRenumber = (next) => {
  setRenumberMap(next);
  if (typeof onResRenumber === 'function') onResRenumber(next);
};

// Renumber every residue consecutively starting from the user-chosen number
// (residue 1 → start, residue 2 → start+1, …).
const applyRenumberFrom = () => {
  const start = parseInt(renumberFrom, 10);
  if (!Number.isFinite(start)) return;
  const next = {};
  residueInfo.forEach((r, i) => { next[String(r.resno)] = start + i; });
  commitRenumber(next);
};

// Sync externally-provided residue renumbering (e.g. restored from the active test)
useEffect(() => {
  if (resRenumber && typeof resRenumber === 'object') {
    setRenumberMap((prev) => {
      const next = { ...resRenumber };
      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
    });
  }
}, [resRenumber]);

// ---- Lightweight-rendering mode (large structures) -------------------------
// Large systems (protein in membrane + explicit solvent) are rendered in FULL
// but with lightweight instanced representations so the browser stays
// responsive. This flag simply switches the DEFAULT representation set.
const [lightRender, setLightRender] = useState(false);  // true → lightweight reps for big systems
const [lightInfo, setLightInfo] = useState(null);       // { nAtoms, size } → small info line
const lightRenderRef = useRef(false);                   // synchronous mirror for addDefaultReps / sidechain effect
lightRenderRef.current = lightRender;
// Water is NOT drawn in lightweight mode by default (it dominates the atom
// count of membrane systems); a checkbox re-enables it as tiny spheres.
const [showLargeWater, setShowLargeWater] = useState(false);
const showLargeWaterRef = useRef(false);
showLargeWaterRef.current = showLargeWater;
// Whether the loaded structure contains any non-protein atoms (ligands,
// lipids, ions, water) — controls the "Molecule Style" dropdown visibility.
const [hasNonProtein, setHasNonProtein] = useState(false);
// How the NON-protein part of a large system is drawn in lightweight mode:
// 'spheres' (spacefill, instanced — default) | 'lines' (bonds) | 'dots' (one
// point per atom — the absolute lightest). The protein is always a cartoon.
const [largeStyle, setLargeStyle] = useState('spheres');
const largeStyleRef = useRef('spheres');
largeStyleRef.current = largeStyle;

// Rebuild the base representations when the lightweight mode toggles
// ("Full detail" / loading a big system) or the large-style selector changes.
useEffect(() => {
  const component = componentRef.current;
  if (!component || status !== 'ready') return;
  baseCompsRef.current.forEach((r) => { try { component.removeRepresentation(r); } catch {} });
  baseCompsRef.current = [];
  addDefaultReps(component);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [lightRender, largeStyle, showLargeWater, status]);

const useFullDetail = () => {
  lightRenderRef.current = false;
  setLightRender(false);
  setLightInfo(null);
};
const [renameMode, setRenameMode] = useState(false);
const [renameTarget, setRenameTarget] = useState(null); // atom index being renamed
const [renameDraft, setRenameDraft] = useState('');
const [atomList, setAtomList] = useState([]);          // [{ idx, element, name, resno, resname }]
const [atomSearch, setAtomSearch] = useState('');
const [showAtomPanel, setShowAtomPanel] = useState(false);

// ---- PyMOL-style selections & effects ----
const [selections, setSelections] = useState([]);      // [{ name, expr }]
const [selStyles, setSelStyles] = useState({});        // key -> { cartoon, ribbon, tube, stick, sphere, surface, color, colorMode, transparency, sphereScale }
const [pymolActive, setPymolActive] = useState(false);
const [pymolScript, setPymolScript] = useState('');
const [pymolLog, setPymolLog] = useState('');
const [showPymolPanel, setShowPymolPanel] = useState(false);
const [autoShowSel, setAutoShowSel] = useState(true); // auto-visibility of parsed selections
const [hideAll, setHideAll] = useState(false);        // remove every representation
const [bgColor, setBgColor] = useState('#f8fafc');
const [qualityHigh, setQualityHigh] = useState(false);

// ---- Depth fog ----
// NGL's default depth fog (fogNear 50 / fogFar 100) fades distant atoms toward
// the background colour — a grey "haze" that many users find distracting. OFF by
// default; the "🌫 Fog" toolbar button re-enables it. The choice is persisted in
// localStorage so it sticks across pages and reloads.
const [fogEnabled, setFogEnabled] = useState(() => {
  try { return localStorage.getItem('labViewerFog') === 'on'; } catch { return false; }
});
const fogEnabledRef = useRef(fogEnabled);
fogEnabledRef.current = fogEnabled;

// Enable/disable NGL's depth fog on the live stage. NGL 2.4 recomputes
// scene.fog.near/far on EVERY render from parameters.fogNear/fogFar
// (Viewer.__updateClipping) and its on-screen label system dereferences
// scene.fog directly — so we must NEVER detach the fog object (that throws
// inside the render loop and freezes the whole viewer). Instead we push the
// fog transition beyond the far edge of the molecule: in the default
// "scene/relative" clip mode
//   fogNear = cDist − bRadius·(50 − fogNear)/50
// so fogNear=100 → the transition starts at cDist + bRadius (the far edge of
// the bounding sphere) → smoothstep = 0 for every atom → no visible fog, and
// the labels stay fully opaque. Re-enabling restores the NGL defaults (50/100).
const applyFog = useCallback(() => {
  const stage = stageRef.current;
  if (!stage) return;
  try {
    stage.setParameters(fogEnabledRef.current ? { fogNear: 50, fogFar: 100 } : { fogNear: 100, fogFar: 101 });
  } catch { /* ignore */ }
}, []);

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
    try { return getOrganicAtomName(atom); } catch { /* fall through */ }
  }
  return atom.atomname || atom.name || '';
};

// ---- Trajectory State ----
const [trajFile, setTrajFile] = useState(null);
const [trajAborted, setTrajAborted] = useState(false); // true while the user aborted the trajectory (blocks auto-reload from props)
const [trajStatus, setTrajStatus] = useState('none');
const [trajError, setTrajError] = useState('');
const [numFrames, setNumFrames] = useState(0);
const [trajTotal, setTrajTotal] = useState(0); // total frames of the trajectory being loaded (for the live counter)
const [currentFrame, setCurrentFrame] = useState(0);
const [playing, setPlaying] = useState(false);
const [speed, setSpeed] = useState(10);
const [stride, setStride] = useState(1);        // play every Nth frame (keeps total time)
const [maxFrames, setMaxFrames] = useState(0);  // 0 = keep all frames
const [pendingTraj, setPendingTraj] = useState(null); // { file, estFrames, suggested, over2G } awaiting user confirmation
const [trajFrameCount, setTrajFrameCount] = useState(TARGET_TRAJ_FRAMES);
const trajRef = useRef(null);
const lastChosenTrajRef = useRef(null);                // guards the async XTC exact-count scan
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
const selectedKeysRef = useRef(selectedKeys);
const residueOffsetRef = useRef(residueOffset);
const namingConventionRef = useRef(namingConvention);
const anchorTickRef = useRef(null);          // last strip tick clicked — Shift+click selects the range [anchor → click]
const [multiSelectActive, setMultiSelectActive] = useState(false);
const renameModeRef = useRef(renameMode);
renameModeRef.current = renameMode;
const displayNameRef = useRef(displayAtomName);
displayNameRef.current = displayAtomName;
const backboneStyleRef = useRef(backboneStyle);
backboneStyleRef.current = backboneStyle;
const moleculeStyleRef = useRef(moleculeStyle);
moleculeStyleRef.current = moleculeStyle;
const prevBackboneRef = useRef(backboneStyle);
const prevMoleculeRef = useRef(moleculeStyle);

useEffect(() => {
parsedSeqRef.current = parsedSeq;
moleculeTypeRef.current = moleculeType;
onAtomClickRef.current = onAtomClick;
selectedKeysRef.current = selectedKeys;
residueOffsetRef.current = residueOffset;
namingConventionRef.current = namingConvention;
}, [parsedSeq, moleculeType, onAtomClick, selectedKeys, residueOffset, namingConvention]);

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
applyFog(); // honour the user's fog preference (off by default) right away

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
stripResidueRiRef.current = null; // a viewport click is per-atom, not a strip click
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
}, [applyFog]); // applyFog is a stable useCallback — the effect still runs once

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
// A raw File supplied by the parent (e.g. restored from IndexedDB on reload)
// takes precedence over the base64 data URL.
if (structureFile) return;
// Old datasets may carry a "[…] omitted" marker instead of a data URL (Stage 5
// of compressDatasetForSave replaced the long base64 before this fix). Skip it
// so we never feed a marker into atob() — the restore-from-IndexedDB path or a
// fresh upload will provide the real file.
if (!String(structureFileData).startsWith('data:')) return;
// If this data URL is just the ECHO of the file the user picked in this viewer
// (the parent stored it back via onStructureFile — e.g. the MD page persists
// the topology), there is nothing to reload: reloading would call
// clearExtraMolecules() and wipe the additional molecules chosen in the same
// batch. The structure is already being loaded from the original File.
try {
  const activeFile = loadRequest && loadRequest.file;
  if (activeFile && structureFileName && String(activeFile.name || '') === String(structureFileName)) return;
} catch { /* keep going */ }
clearExtraMolecules();
setManualOverride(true);
setFile(null);
try {
const [meta, b64] = String(structureFileData).split(',');
const mime = /data:([^;,]+)/.exec(meta)?.[1] || 'application/octet-stream';
const bin = atob(b64);
const bytes = new Uint8Array(bin.length);
for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
const blob = new Blob([bytes], { type: mime });
const fakeFile = new File([blob], structureFileName || 'structure.pdb', { type: mime });
requestStructureLoad({ file: fakeFile, url: null, ts: Date.now() });
} catch {
setErrorMsg('Failed to decode structure file data.');
setStatus('error');
}
}, [structureFileData, structureFileName, structureFormat, loadRequest, clearExtraMolecules, structureFile]);

// Load a structure File handed back by the parent (MD page) — e.g. restored
// from IndexedDB after a reload. Large topology files (.gro/.pdb/.cif) are
// never persisted as base64 in the dataset payload, so on reload the parent
// provides the raw File instead of structureFileData.
const lastSeenStructFileRef = useRef(undefined);
useEffect(() => {
if (!structureFile) return;
const token = `${structureFile.name || ''}|${structureFile.size || 0}|${structureFile.lastModified || 0}`;
if (token === lastSeenStructFileRef.current) return;
lastSeenStructFileRef.current = token;
try {
  const activeFile = loadRequest && loadRequest.file;
  if (activeFile && String(activeFile.name || '') === String(structureFile.name || '')) return; // echo of the file the viewer just picked
} catch { /* keep going */ }
clearExtraMolecules();
setManualOverride(true);
setFile(null);
requestStructureLoad({ file: structureFile, url: null, ts: Date.now() });
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [structureFile, loadRequest, clearExtraMolecules]);

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
clearExtraMolecules();
setFile(null);
requestStructureLoad({ file: null, url: null, text: structureText, ext: structureTextExt || 'pdb', ts: Date.now() });
}
}, [structureText, structureTextExt, manualOverride, clearExtraMolecules]);

useEffect(() => {
if (manualOverride || structureText) return;
if (src) {
setFile(null);
clearExtraMolecules();
setLoadRequest({ file: null, url: src, ts: Date.now() });
}
}, [src, structureText, manualOverride, clearExtraMolecules]);

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
  // Large systems: keep the whole structure visible but use lightweight,
  // instanced representations so the browser stays responsive — protein as a
  // cartoon, and everything else (lipids, ions, ligands) drawn with the
  // user-selected large-style: spheres (spacefill), lines (bonds) or dots
  // (one point per atom — the lightest). WATER is hidden by default (it
  // dominates the atom count of membrane systems); the "💧 Water" checkbox
  // re-enables it with the same lightweight style.
  if (lightRenderRef.current) {
    try { trackBase(component.addRepresentation('cartoon', { sele: 'protein', color: 'residueindex', quality: 'low' })); } catch {}
    const ls = largeStyleRef.current || 'spheres';
    const waterSele = showLargeWaterRef.current ? 'water' : null;
    if (ls === 'lines') {
      try { trackBase(component.addRepresentation('line', { sele: 'hetero and not water', colorScheme: 'element' })); } catch {}
      if (waterSele) { try { trackBase(component.addRepresentation('line', { sele: waterSele, colorScheme: 'element' })); } catch {} }
    } else if (ls === 'dots') {
      try { trackBase(component.addRepresentation('dot', { sele: 'hetero and not water', colorScheme: 'element' })); } catch {}
      if (waterSele) { try { trackBase(component.addRepresentation('dot', { sele: waterSele, colorScheme: 'element' })); } catch {} }
    } else {
      try { trackBase(component.addRepresentation('spacefill', { sele: 'hetero and not water', colorScheme: 'element', scale: 0.25, quality: 'low' })); } catch {}
      if (waterSele) { try { trackBase(component.addRepresentation('spacefill', { sele: waterSele, colorScheme: 'element', scale: 0.08, quality: 'low' })); } catch {} }
    }
    return;
  }
  const organicLike = ['organic', 'lipid', 'sugar'].includes(moleculeTypeRef.current);
  if (organicLike) {
    const ms = moleculeStyleRef.current || 'ball+stick';
    try {
      if (ms === 'ball+stick') trackBase(component.addRepresentation('ball+stick', { colorScheme: 'element', multipleBond: true, aspectRatio: 1.3 }));
      else if (ms === 'stick') trackBase(component.addRepresentation('stick', { colorScheme: 'element', multipleBond: true }));
      else if (ms === 'line') trackBase(component.addRepresentation('line', { colorScheme: 'element' }));
      else if (ms === 'spheres') trackBase(component.addRepresentation('spacefill', { colorScheme: 'element', scale: 0.7 }));
      else if (ms === 'surface') trackBase(component.addRepresentation('surface', { colorScheme: 'element' }));
    } catch {}
    return;
  }
  const isNucleic = moleculeTypeRef.current === 'dna' || moleculeTypeRef.current === 'rna';
  if (isNucleic) {
    const ms = moleculeStyleRef.current || 'ball+stick';
    try {
      if (ms === 'ball+stick') trackBase(component.addRepresentation('ball+stick', { sele: 'all', colorScheme: 'element', multipleBond: true, aspectRatio: 1.1 }));
      else if (ms === 'stick') trackBase(component.addRepresentation('stick', { sele: 'all', colorScheme: 'element', multipleBond: true }));
      else if (ms === 'line') trackBase(component.addRepresentation('line', { sele: 'all', colorScheme: 'element' }));
      else if (ms === 'spheres') trackBase(component.addRepresentation('spacefill', { sele: 'all', colorScheme: 'element', scale: 0.6 }));
      else if (ms === 'surface') trackBase(component.addRepresentation('surface', { sele: 'all', colorScheme: 'element' }));
    } catch {}
    return;
  }
  const bb = backboneStyleRef.current || 'cartoon';
  try {
    if (bb === 'cartoon') trackBase(component.addRepresentation('cartoon', { sele: 'protein', color: 'residueindex', quality: 'high' }));
    else if (bb === 'tube') trackBase(component.addRepresentation('cartoon', { sele: 'protein', color: 'residueindex', radius: 0.3, quality: 'high' }));
    else if (bb === 'ball+stick') trackBase(component.addRepresentation('ball+stick', { sele: 'protein', colorScheme: 'element', multipleBond: true, aspectRatio: 1.1 }));
    else if (bb === 'sticks') trackBase(component.addRepresentation('ball+stick', { sele: 'protein and not sidechain', colorScheme: 'element', multipleBond: true, aspectRatio: 1.1 }));
    else if (bb === 'lines') trackBase(component.addRepresentation('line', { sele: 'protein', colorScheme: 'element' }));
    else if (bb === 'spheres') trackBase(component.addRepresentation('spacefill', { sele: 'protein', colorScheme: 'element', scale: 0.6 }));
  } catch {}
  // Non-protein content of a protein system (ligands, lipids, ions, …) follows
  // the Molecule Style selector — previously it was hard-coded to ball+stick.
  const ms = moleculeStyleRef.current || 'ball+stick';
  try {
    if (ms === 'ball+stick') trackBase(component.addRepresentation('ball+stick', { sele: 'hetero and not water', colorScheme: 'element', aspectRatio: 1.1 }));
    else if (ms === 'stick') trackBase(component.addRepresentation('stick', { sele: 'hetero and not water', colorScheme: 'element', multipleBond: true }));
    else if (ms === 'line') trackBase(component.addRepresentation('line', { sele: 'hetero and not water', colorScheme: 'element' }));
    else if (ms === 'spheres') trackBase(component.addRepresentation('spacefill', { sele: 'hetero and not water', colorScheme: 'element', scale: 0.6 }));
    else if (ms === 'surface') trackBase(component.addRepresentation('surface', { sele: 'hetero and not water', colorScheme: 'element' }));
  } catch {}
};

// Apply the CURRENT style selectors (Backbone / Molecule Style) to ANY component
// — the main structure OR an extra molecule/chain — so changing a style updates
// everything, not just the main structure. Proteins use the backbone selector
// (+ hetero ball+stick); other molecules use the Molecule Style selector.
// Returns the list of representation objects added (so callers can remove them).
const applyCurrentStyleTo = useCallback((comp, baseReps) => {
  if (!comp || !comp.structure) return baseReps || [];
  (baseReps || []).forEach((r) => { try { comp.removeRepresentation(r); } catch {} });
  const next = [];
  let isProteinish = false;
  try { isProteinish = (comp.structure.getAtomSet('protein').count || 0) > 0; } catch {
    isProteinish = moleculeTypeRef.current === 'protein';
  }
  if (isProteinish) {
    const bb = backboneStyleRef.current || 'cartoon';
    try {
      if (bb === 'cartoon') next.push(comp.addRepresentation('cartoon', { sele: 'protein', color: 'residueindex', quality: 'high' }));
      else if (bb === 'tube') next.push(comp.addRepresentation('cartoon', { sele: 'protein', color: 'residueindex', radius: 0.3, quality: 'high' }));
      else if (bb === 'ball+stick') next.push(comp.addRepresentation('ball+stick', { sele: 'protein', colorScheme: 'element', multipleBond: true, aspectRatio: 1.1 }));
      else if (bb === 'sticks') next.push(comp.addRepresentation('ball+stick', { sele: 'protein and not sidechain', colorScheme: 'element', multipleBond: true, aspectRatio: 1.1 }));
      else if (bb === 'lines') next.push(comp.addRepresentation('line', { sele: 'protein', colorScheme: 'element' }));
      else if (bb === 'spheres') next.push(comp.addRepresentation('spacefill', { sele: 'protein', colorScheme: 'element', scale: 0.6 }));
    } catch {}
    // Non-protein content of a protein system (ligands, lipids, ions, …) follows
    // the Molecule Style selector.
    const ms = moleculeStyleRef.current || 'ball+stick';
    try {
      if (ms === 'ball+stick') next.push(comp.addRepresentation('ball+stick', { sele: 'hetero and not water', colorScheme: 'element', aspectRatio: 1.1 }));
      else if (ms === 'stick') next.push(comp.addRepresentation('stick', { sele: 'hetero and not water', colorScheme: 'element', multipleBond: true }));
      else if (ms === 'line') next.push(comp.addRepresentation('line', { sele: 'hetero and not water', colorScheme: 'element' }));
      else if (ms === 'spheres') next.push(comp.addRepresentation('spacefill', { sele: 'hetero and not water', colorScheme: 'element', scale: 0.6 }));
      else if (ms === 'surface') next.push(comp.addRepresentation('surface', { sele: 'hetero and not water', colorScheme: 'element' }));
    } catch {}
  } else {
    const ms = moleculeStyleRef.current || 'ball+stick';
    try {
      if (ms === 'ball+stick') next.push(comp.addRepresentation('ball+stick', { colorScheme: 'element', multipleBond: true, aspectRatio: 1.3 }));
      else if (ms === 'stick') next.push(comp.addRepresentation('stick', { colorScheme: 'element', multipleBond: true }));
      else if (ms === 'line') next.push(comp.addRepresentation('line', { colorScheme: 'element' }));
      else if (ms === 'spheres') next.push(comp.addRepresentation('spacefill', { colorScheme: 'element', scale: 0.7 }));
      else if (ms === 'surface') next.push(comp.addRepresentation('surface', { colorScheme: 'element' }));
    } catch {}
  }
  return next;
}, []);

// Load ONE chain of a multi-chain PDB as its own (hidden) NGL component and add
// it to the Molecules selector. Called by the main-load effect after the whole
// structure is parsed.
const loadChainMolecule = useCallback(async (blob, name, ci) => {
  const stage = stageRef.current;
  if (!stage) return;
  try {
    const comp = await stage.loadFile(blob, { ext: 'pdb' });
    const baseReps = applyCurrentStyleTo(comp, []);
    extraCompsRef.current.push({ id: `chain_${Date.now()}_${ci}`, name, comp, baseReps });
    try { comp.setVisibility(false); } catch {}
  } catch { /* chain load failed — keep it inside the main component */ }
}, [applyCurrentStyleTo]);

// Main structure load
useEffect(() => {
if (!loadRequest || (!loadRequest.file && !loadRequest.url && !loadRequest.text)) return;
let cancelled = false;
const abortToken = {};
abortRef.current = {
  token: abortToken,
  label: 'structure loading',
  cancel: () => {
    cancelled = true;
    setStatus('idle');
    setErrorMsg('');
    setLoadRequest(null);
    componentRef.current = null;
    setSelections([]);
    setResidueTicks([]);
    stripResidueRiRef.current = null;
    setLightRender(false);
    setLightInfo(null);
    setHasNonProtein(false);
    try { if (stageRef.current) stageRef.current.removeAllComponents(); } catch {}
  }
};
const unregisterAbort = abortControl.register('structure loading', () => {
  if (abortRef.current && abortRef.current.token === abortToken) {
    const a = abortRef.current;
    abortRef.current = null;
    a.cancel();
  }
});
setStatus('loading');
setErrorMsg('');
setTrajFile(null);
setTrajStatus('none');
// Release the global ⏹ Stop registration as soon as the structure finishes
// loading (success or error) — otherwise the red "Stop (structure loading)"
// pill stays visible forever after a completed load.
const finishStructLoad = () => {
  unregisterAbort();
  if (abortRef.current && abortRef.current.token === abortToken) abortRef.current = null;
};
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
} catch { /* try next fallback */ }
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

// Large systems (e.g. a protein in a lipid bilayer with explicit solvent):
// load everything and render it ALL, but with lightweight instanced
// representations (protein cartoon + spacefill) so the browser does not freeze.
const nAtoms = component.structure ? component.structure.atomCount : 0;
const bigSource = (loadRequest && loadRequest.size) >= LARGE_STRUCT_BYTES;
const isLarge = nAtoms > LARGE_ATOM_COUNT || bigSource;
lightRenderRef.current = isLarge;
setLightRender(isLarge);
if (isLarge) {
  setLightInfo({ nAtoms, size: loadRequest && loadRequest.size ? loadRequest.size : 0 });
} else {
  setLightInfo(null);
}
// Whether this structure contains any non-protein atoms — shows the "Molecule
// Style" dropdown so ligands/lipids/water inside a protein complex can be styled.
let nonProtein = false;
try {
  const h = component.structure.getAtomSet('hetero and not water');
  const w = component.structure.getAtomSet('water');
  nonProtein = ((h && h.count) || 0) > 0 || ((w && w.count) || 0) > 0;
} catch { nonProtein = false; }
setHasNonProtein(nonProtein);
addDefaultReps(component);

// Multi-MODEL PDB files (ensembles / docking clusters / NMR structures):
// NGL 2.4.0 does not expose structure.frameCount (and StructureComponent has
// no setFrame), so the MODEL count comes from structure.modelStore.count —
// the number of MODEL records the PDB parser created. The per-MODEL /
// per-molecule text split below exposes each entry in the Molecules selector.
let nglModelCount = 0;
try {
  nglModelCount = component.structure && component.structure.modelStore
    ? component.structure.modelStore.count : 0;
} catch { nglModelCount = 0; }

// Multi-molecule / multi-MODEL PDB (complexes, docking poses, NMR ensembles):
// expose each MOLECULE — or each MODEL conformer — as its own entry in the
// Molecules selector so the partners can be viewed alone or together. Uses the
// PDB TEXT (deterministic, NGL-version independent) with connectivity from
// CONECT + proximity, scoped to MODEL records. Non-PDB inputs are skipped.
try {
  const srcFile = loadRequest && loadRequest.file;
  const textIsPdb = !!(loadRequest && loadRequest.text && ['pdb', 'ent'].includes(String(loadRequest.ext || '').toLowerCase()));
  if (srcFile || textIsPdb) {
    const isPdb = srcFile
      ? /\.(pdb|ent)$/i.test(String(srcFile.name || ''))
      : textIsPdb;
    if (isPdb) {
      const srcForSplit = srcFile || new Blob([loadRequest.text], { type: 'text/plain' });
      const moleculeParts = await splitPdbFileIntoMolecules(srcForSplit);
      if (moleculeParts.length > 1) {
        const multiModel = nglModelCount > 1 || (moleculeParts[0] && moleculeParts[0].modelCount > 1);
        const perModelCounts = new Map();
        moleculeParts.forEach((p) => perModelCounts.set(p.model, (perModelCounts.get(p.model) || 0) + 1));
        const onePartPerModel = moleculeParts.every((p) => perModelCounts.get(p.model) === 1);
        for (let ci = 0; ci < moleculeParts.length; ci++) {
          const part = moleculeParts[ci];
          const label = multiModel
            ? (onePartPerModel ? `Model ${part.model + 1}` : `Molecule ${ci + 1} (Model ${part.model + 1})`)
            : `Molecule ${ci + 1} (${part.chainId})`;
          await loadChainMolecule(part.blob, label, ci);
        }
        setExtraMols(extraCompsRef.current.map(({ id: xid, name: xname }) => ({ id: xid, name: xname })));
      }
    }
  }
} catch { /* molecule splitting failed — keep the whole structure as one component */ }

// Expose the 1-letter sequence parsed from the structure so the pages can
// auto-fill the sequence field when it is empty (enables the per-atom table).
if (typeof onStructureSequence === 'function') {
const seq = extractStructureSequence(component);
if (seq) onStructureSequence(seq);
}
// Build the residue strip ticks (resno / resname / 1-letter code per residue).
setResidueTicks(collectResidueTicks(component));
stripResidueRiRef.current = null;

component.autoView();
requestAnimationFrame(() => {
if (cancelled || !stageRef.current) return;
try { stageRef.current.handleResize(); } catch {}
try { component.autoView(); } catch {}
});

if (!(component.structure ? component.structure.atomCount : 0)) {
throw new Error('The structure loaded but contains no atoms (empty/invalid file content).');
}
setStatus('ready');
finishStructLoad();
} catch (err) {
if (!cancelled) {
const raw = (err && err.message ? String(err.message) : '').trim();
setErrorMsg(raw || 'Failed to load structure.');
setResidueTicks([]);
stripResidueRiRef.current = null;
finishStructLoad();
setStatus('error');
}
}
};
run();
return () => {
  cancelled = true;
  unregisterAbort();
  if (abortRef.current && abortRef.current.token === abortToken) abortRef.current = null;
};
}, [loadRequest]);

// ---- Trajectory Loading Effect ----
useEffect(() => {
if (trajAborted) return; // user aborted the trajectory — do not auto-reload (e.g. from props)
const component = componentRef.current;
if (!component || status !== 'ready') return;
const targetSrc = trajFile || trajectoryFile || trajectorySrc;
if (!targetSrc) return;
let cancelled = false;
const abortToken = {};
abortRef.current = {
  token: abortToken,
  label: 'trajectory loading',
  cancel: () => {
    cancelled = true;
    setTrajAborted(true); // block auto-reload (e.g. from the trajectorySrc prop) until the user picks a new trajectory
    setTrajStatus('idle');
    setTrajError('');
    setPlaying(false);
    setNumFrames(0);
    setTrajTotal(0);
    setCurrentFrame(0);
    trajRef.current = null;
    setTrajFile(null);
    try { if (componentRef.current && typeof componentRef.current.removeAllTrajectories === 'function') componentRef.current.removeAllTrajectories(); } catch {}
  }
};
const unregisterAbort = abortControl.register('trajectory loading', () => {
  if (abortRef.current && abortRef.current.token === abortToken) {
    const a = abortRef.current;
    abortRef.current = null;
    a.cancel();
  }
});
setTrajStatus('loading');
setTrajError('');
setNumFrames(0);
setTrajTotal(0);
setCurrentFrame(0);
setPlaying(false);

// Release the global ⏹ Stop registration as soon as the trajectory finishes
// (success or failure) — otherwise the red "Stop (trajectory loading)" pill
// stays visible forever after a completed load.
const finishTrajLoad = () => {
  unregisterAbort();
  if (abortRef.current && abortRef.current.token === abortToken) abortRef.current = null;
};

const initTraj = async () => {
try {
const NGL = await ensureNGL();
if (cancelled) return;
let targetCand = targetSrc;
let ext = trajectoryFormat || 'xtc';
let srcFile = null;
if (typeof targetSrc === 'object' && targetSrc instanceof File) {
  srcFile = targetSrc;
  const fileParts = targetSrc.name.split('.');
  ext = fileParts.length > 1 ? fileParts.pop().toLowerCase() : ext;
  if (ext !== 'xtc') {
    // Non-XTC files still go through NGL (blob URL), exactly as before.
    targetCand = URL.createObjectURL(targetSrc);
    blobUrlsRef.current.push(targetCand);
  }
}

// ---- Native incremental XTC decode (local .xtc files) ---------------------
// NGL's own parse of a large XTC is all-or-nothing and reports no per-frame
// progress. Decoding the file natively here lets the UI show a live
// "N / total frames loaded" counter and stay responsive (the generator
// yields between frames, so the Abort button keeps working).
if (ext === 'xtc' && srcFile) {
  const ab = await srcFile.arrayBuffer();
  if (cancelled) return;
  const { totalFrames } = countXtcFrames(ab);
  if (totalFrames > 0) setTrajTotal(totalFrames);
  const coords = [];
  const boxes = [];
  const times = [];
  let done = 0;
  for await (const fr of readXtcFrames(ab)) {
    if (cancelled) return;
    coords.push(fr.coords);
    boxes.push(fr.box);
    times.push(fr.time);
    done++;
    if (done === totalFrames || done % 20 === 0) {
      // Keep the counter honest: the header-scan total is only an estimate —
      // the decoded count is authoritative, so the total shown must never lag
      // behind (otherwise the live counter would claim "more than total").
      setNumFrames(done);
      if (totalFrames <= 0 || done > totalFrames) setTrajTotal(done);
      await new Promise((r) => setTimeout(r, 0)); // let React repaint + honour aborts
    }
  }
  if (cancelled) return;
  if (done === 0) {
    throw new Error('Trajectory contains 0 readable frames. Verify that the PDB and XTC have the exact same atom count.');
  }
  // The actually decoded frame count is the authoritative total.
  setNumFrames(done);
  setTrajTotal(done);
  const frames = new NGL.Frames(srcFile.name, srcFile.name);
  frames.coordinates = coords;
  frames.boxes = boxes;
  frames.times = times;
  frames.timeOffset = times[0] || 0;
  frames.deltaTime = times.length > 1 ? times[1] - times[0] : 1;
  setNumFrames(done);
  const trajComp = component.addTrajectory(frames);
  const traj = (trajComp && trajComp.trajectory) || getTrajectoryObject(component);
  if (!traj) throw new Error('Could not attach trajectory');
  trajRef.current = traj;
  try { if (typeof traj._setFrameCount === 'function') traj._setFrameCount(done); } catch {}
  setCurrentFrame(0);
  setTrajStatus('ready');
  finishTrajLoad();
  return;
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
finishTrajLoad();
} else {
const checkInterval = setInterval(() => {
const nf = getNumFrames(traj);
if (nf > 0) {
setNumFrames(nf);
setCurrentFrame(0);
setTrajStatus('ready');
finishTrajLoad();
clearInterval(checkInterval);
}
}, 250);
setTimeout(() => {
clearInterval(checkInterval);
if (getNumFrames(traj) === 0 && !cancelled) {
setTrajStatus('error');
setTrajError('Trajectory loaded but contains 0 frames. Verify that the PDB and XTC have the exact same atom count.');
finishTrajLoad();
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
finishTrajLoad();
}
}
};
initTraj();
return () => {
  cancelled = true;
  unregisterAbort();
  if (abortRef.current && abortRef.current.token === abortToken) abortRef.current = null;
};
}, [trajFile, trajectoryFile, trajectorySrc, trajectoryFormat, status, trajAborted]);

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

// Expose trajectory playback to the global Stop button (so the always-visible
// ⏹ Stop can also halt playback, not just loading operations).
useEffect(() => {
  if (!playing) return;
  const unregister = abortControl.register('trajectory playback', () => setPlaying(false));
  return unregister;
}, [playing]);


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

// ---- Large-trajectory confirmation ----------------------------------------
const handleTrajFileChosen = (f) => {
if (!f) return;
setTrajAborted(false); // a fresh user-selected trajectory is always allowed
const structure = componentRef.current && componentRef.current.structure;
const atomCount = structure ? structure.atomCount : 0;
const name = (f.name || '').toLowerCase();
const isTraj = name.endsWith('.xtc') || name.endsWith('.trr') || name.endsWith('.dcd') || name.endsWith('.nc');
if (!isTraj) {
setTrajFile(f);
onTrajectoryFile?.(f);
return;
}
// Always ask the user how to load the trajectory — frame COUNT matters, not
// file size. Representative frames are spread evenly over the whole run.
const { estFrames, bytesPerFrame } = estimateTrajectoryFrames(f, atomCount);
const finalizePendingTraj = (est, bpf) => {
  const over2G = f.size > TARGET_TRAJ_BYTES;
  let suggested = 1;
  if (est > TARGET_TRAJ_FRAMES) {
    suggested = Math.min(1000, Math.max(1, Math.ceil(est / TARGET_TRAJ_FRAMES)));
  }
  if (over2G) {
    // Recalculate the stride so the effective loaded data stays under ~2 GB.
    const keepFrames = Math.max(1, Math.floor(TARGET_TRAJ_BYTES / Math.max(1, bpf)));
    suggested = Math.max(suggested, Math.min(1000, Math.max(1, Math.ceil(est / keepFrames))));
  }
  setTrajFrameCount(Math.min(TARGET_TRAJ_FRAMES, est));
  setPendingTraj({ file: f, estFrames: est, suggested, over2G });
};
if (name.endsWith('.xtc')) {
  // XTC frame count can be read exactly from the file headers (fast chunked
  // scan, no decompression) — show the real number in the confirmation dialog.
  lastChosenTrajRef.current = f;
  countXtcFramesInFile(f)
    .then(({ totalFrames }) => {
      if (lastChosenTrajRef.current !== f) return; // stale: user already moved on
      const est = totalFrames > 0 ? totalFrames : estFrames;
      const bpf = totalFrames > 0 ? Math.max(1, f.size / totalFrames) : bytesPerFrame;
      finalizePendingTraj(est, bpf);
    })
    .catch(() => { if (lastChosenTrajRef.current === f) finalizePendingTraj(estFrames, bytesPerFrame); });
} else {
  finalizePendingTraj(estFrames, bytesPerFrame);
}
};

const acceptTrajReduction = () => {
if (!pendingTraj) return;
setTrajAborted(false); // a fresh user-selected trajectory is always allowed
const target = Math.min(Math.max(1, parseInt(trajFrameCount, 10) || TARGET_TRAJ_FRAMES), Math.max(1, pendingTraj.estFrames));
const strideNeeded = Math.max(1, Math.ceil(pendingTraj.estFrames / Math.max(1, target)));
setStride(strideNeeded);
setMaxFrames(target);
setTrajFile(pendingTraj.file);
onTrajectoryFile?.(pendingTraj.file);
setPendingTraj(null);
};

const loadTrajWithoutReduction = () => {
if (!pendingTraj) return;
setTrajAborted(false); // a fresh user-selected trajectory is always allowed
setTrajFile(pendingTraj.file);
onTrajectoryFile?.(pendingTraj.file);
setPendingTraj(null);
};

// ---- Structure load funnel -------------------------------------------------
// Every structure source goes through here. The size is tagged onto the load
// request so the load effect can auto-hide all but the first chain on very
// large systems (the structure is still loaded in full for the analysis).
const requestStructureLoad = (payload) => {
const file = payload.file;
const size = file ? file.size : (payload.text ? payload.text.length : 0);
setLoadRequest({ ...payload, size });
};

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
  const resMap = new Map();
  try {
    component.structure.eachAtom((a) => {
      const rawResno = a.resno != null ? Number(a.resno) : 0;
      list.push({ idx: a.index, element: a.element || '', name: a.atomname || '', resno: displayResno(rawResno), rawResno, resname: a.resname || '' });
      if (!resMap.has(rawResno)) resMap.set(rawResno, { resno: rawResno, resname: a.resname || '', count: 0 });
      resMap.get(rawResno).count++;
    });
  } catch {}
  setAtomList(list);
  setResidueInfo([...resMap.values()]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [status, renumberMap]);

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
  } catch {
    return null;
  }
};

// PDB anchor atoms used to build a SMALL, page-friendly key set when a residue
// tick is clicked. Keeping selectedAtomKeys small (≈ the size of a normal 3D
// atom click) avoids heavy re-renders in the spectra / per-atom tables; the WHOLE
// residue is still highlighted in 3D via a single-clause NGL representation.
const RESIDUE_ANCHOR_ATOMS = {
  protein: ['N', 'CA', 'C', 'O', 'CB'],
  dna: ['P', "O5'", "C5'", "C1'", "O3'"],
  rna: ['P', "O5'", "C5'", "C1'", "O3'"],
};

// Build the atom keys for one residue tick (single click, multi toggle or
// Shift+click range selection). Uses the atom names precomputed in
// collectResidueTicks — NO full-structure atom scan per click.
const computeResidueKeys = (tick) => {
  const ri = tick.resno - 1;
  const seq = Array.isArray(parsedSeqRef.current) ? parsedSeqRef.current : [];
  const anchors = RESIDUE_ANCHOR_ATOMS[moleculeTypeRef.current] || ['N', 'CA', 'C', 'O'];
  const keys = [];
  (tick.atomNames || []).forEach((an) => {
    const upper = String(an || '').trim().toUpperCase();
    if (!anchors.includes(upper)) return;
    if (seq.length && ri >= 0 && ri < seq.length) {
      const mapped = mapPdbAtomToNmrKeys(an, tick.resno, seq, moleculeTypeRef.current, namingConventionRef.current);
      if (mapped && Array.isArray(mapped.keys) && mapped.keys.length) {
        mapped.keys.forEach((k) => { if (!keys.includes(k)) keys.push(k); });
        return;
      }
    }
    if (!keys.includes(`${ri}-${upper}`)) keys.push(`${ri}-${upper}`);
  });
  if (keys.length === 0) {
    const anchor = moleculeTypeRef.current === 'dna' || moleculeTypeRef.current === 'rna' ? 'P' : 'CA';
    keys.push(`${ri}-${anchor}`);
  }
  return keys;
};

// Merge addKeys into an existing key selection. toggle=true flips each key
// (add if missing, remove if present) — used for Ctrl/Cmd and "⊞ multi" clicks.
const mergeKeys = (baseKeys, addKeys, toggle) => {
  const set = new Set(Array.isArray(baseKeys) ? baseKeys : []);
  (addKeys || []).forEach((k) => {
    if (toggle && set.has(k)) set.delete(k);
    else set.add(k);
  });
  return Array.from(set);
};

// Click a residue tick in the sequence strip:
//   - plain click  → select ONLY that residue (a second click on the same
//     residue clears it — handled by the page's handleAtomClick)
//   - Ctrl/Cmd/Shift click or the "⊞ multi" toggle → toggle that residue in/out
//     of the current multi-residue selection
//   - Shift click (after any strip click) → select the whole RANGE from the
//     last-clicked residue up to this one, added to the selection — handy for
//     highlighting a binding site / loop without clicking every residue.
const handleResidueTickClick = (tick, e = {}) => {
  const ri = tick.resno - 1;
  stripResidueRiRef.current = ri;
  if (!onAtomClickRef.current) return;

  const additive = multiSelectActive || e.ctrlKey || e.metaKey || e.shiftKey;

  // Shift+click range selection within the same chain: [anchor … clicked].
  if (e.shiftKey && anchorTickRef.current && anchorTickRef.current.chainid === tick.chainid) {
    const polyTicks = (Array.isArray(residueTicks) ? residueTicks : []).filter((r) => r.polymer);
    const ti = polyTicks.findIndex((t) => t.chainid === tick.chainid && t.resno === tick.resno);
    const ai = polyTicks.findIndex((t) => t.chainid === tick.chainid && t.resno === anchorTickRef.current.resno);
    if (ti >= 0 && ai >= 0) {
      const [lo, hi] = ai <= ti ? [ai, ti] : [ti, ai];
      const addKeys = [];
      for (let i = lo; i <= hi; i++) {
        computeResidueKeys(polyTicks[i]).forEach((k) => { if (!addKeys.includes(k)) addKeys.push(k); });
      }
      onAtomClickRef.current(ri, mergeKeys(selectedKeysRef.current, addKeys, false));
      anchorTickRef.current = tick;
      return;
    }
  }

  const keys = computeResidueKeys(tick);
  if (additive) onAtomClickRef.current(ri, mergeKeys(selectedKeysRef.current, keys, true));
  else onAtomClickRef.current(ri, keys);
  anchorTickRef.current = tick;
};

// "✕ clear" button in the sequence strip — drop the whole residue selection.
const clearResidueSelection = () => {
  stripResidueRiRef.current = null;
  anchorTickRef.current = null;
  if (onAtomClickRef.current) onAtomClickRef.current(0, []);
};

// Rebuild all selection representations from selStyles.
useEffect(() => {
  const component = componentRef.current;
  if (!component || status !== 'ready') return;
  Object.keys(selCompsRef.current).forEach((k) => {
    (selCompsRef.current[k] || []).forEach((r) => { try { component.removeRepresentation(r); } catch {} });
  });
  selCompsRef.current = {};
  // Base representations: removed in "hide all" or PyMOL-script mode, and rebuilt
  // when the backbone OR molecule style changes or when restoring from "hide all".
  const backboneChanged = prevBackboneRef.current !== backboneStyle;
  const moleculeChanged = prevMoleculeRef.current !== moleculeStyle;
  if (hideAll || pymolActive) {
    baseCompsRef.current.forEach((r) => { try { component.removeRepresentation(r); } catch {} });
    baseCompsRef.current = [];
  } else if (backboneChanged || moleculeChanged || baseCompsRef.current.length === 0) {
    baseCompsRef.current.forEach((r) => { try { component.removeRepresentation(r); } catch {} });
    baseCompsRef.current = [];
    addDefaultReps(component);
  }
  prevBackboneRef.current = backboneStyle;
  prevMoleculeRef.current = moleculeStyle;
  if (hideAll) return;
  const styles = selStylesRef.current || {};
  Object.keys(styles).forEach((key) => {
    const st = styles[key] || {};
    const expr = selKeyExpr(key);
    if (!expr || expr === '') return;
    // Hidden selections keep NO representations — "🙈 Hide" removes them.
    if (st.hidden) { selCompsRef.current[key] = []; return; }
    // Colouring metaphor: a NGL colorScheme (element/chain/resname/sstruc/…) or
    // a plain solid colour when "Solid" is selected.
    const colorScheme = st.colorMode && st.colorMode !== 'solid' ? st.colorMode : undefined;
    const color = colorScheme ? undefined : (st.color != null ? st.color : undefined);
    const opacity = st.transparency != null ? Math.max(0, Math.min(1, 1 - st.transparency)) : undefined;
    const reps = [];
    const add = (type, params) => {
      try { reps.push(component.addRepresentation(type, { sele: expr, color, colorScheme, ...params })); } catch {}
    };
    if (st.cartoon) add('cartoon', { colorScheme, opacity });
    if (st.ribbon) add('ribbon', { colorScheme, opacity });
    if (st.tube) add('tube', { colorScheme, opacity });
    if (st.sphere) add('spacefill', { scale: st.sphereScale || 1, colorScheme, opacity, multipleBond: true });
    if (st.ball) add('ball+stick', { colorScheme, opacity, multipleBond: true, aspectRatio: 1.3 });
    if (st.stick) add('stick', { colorScheme, opacity, multipleBond: true });
    if (st.surface) add('surface', { colorScheme, opacity: opacity != null ? opacity : 0.5 });
    selCompsRef.current[key] = reps;
  });
  return () => {
    Object.keys(selCompsRef.current).forEach((k) => {
      (selCompsRef.current[k] || []).forEach((r) => { try { component.removeRepresentation(r); } catch {} });
    });
    selCompsRef.current = {};
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [status, selections, selStyles, pymolActive, hideAll, backboneStyle, moleculeStyle]);

// Re-apply the current style selectors to EVERY extra molecule / chain when the
// user changes Backbone or Molecule Style — so the styles work for all loaded
// structures, not just the main one.
useEffect(() => {
  if (status !== 'ready') return;
  extraCompsRef.current.forEach((entry) => {
    if (entry && entry.comp) {
      entry.baseReps = applyCurrentStyleTo(entry.comp, entry.baseReps || []);
    }
  });
  try { if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender(); } catch {}
}, [backboneStyle, moleculeStyle, status, applyCurrentStyleTo]);

// Background colour + quality ("ray shadows" approximation)
useEffect(() => {
  const stage = stageRef.current;
  if (!stage) return;
  try { stage.setParameters({ backgroundColor: bgColor }); } catch {}
  try { stage.setQuality(qualityHigh ? 'high' : 'medium'); } catch {}
  // setBackground re-colours the fog; re-apply the user's fog preference after
  // any background/quality change so a toggled-off fog stays off.
  applyFog();
}, [bgColor, qualityHigh, status, applyFog]);

// Persist the fog preference and apply it to the live stage whenever it changes.
useEffect(() => {
  try { localStorage.setItem('labViewerFog', fogEnabled ? 'on' : 'off'); } catch { /* ignore */ }
  applyFog();
}, [fogEnabled, applyFog]);

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
    const styleOf = (st) => (st === 'sphere' || st === 'spheres' ? 'sphere' : st === 'stick' || st === 'sticks' ? 'stick' : st === 'ball' || st === 'ball+stick' || st === 'ball_and_stick' || st === 'ballandstick' ? 'ball' : st === 'cartoon' ? 'cartoon' : st === 'ribbon' ? 'ribbon' : st === 'tube' ? 'tube' : st === 'surface' ? 'surface' : st === 'line' || st === 'lines' || st === 'dots' ? 'line' : null);
    const next = { ...selStylesRef.current };
    // Reset every selection the script mentions to "hidden", then apply commands
    sels.forEach((s) => {
      const cur = next[s.name] || {};
      next[s.name] = { ...cur, cartoon: false, ribbon: false, tube: false, ball: false, stick: false, sphere: false, surface: false };
    });
    acts.forEach((a) => {
      const key = names.has(a.sel) ? a.sel : (a.sel === 'all' ? 'all' : a.sel);
      const cur = next[key] || {};
      if (a.type === 'show' || a.type === 'hide') {
        const st = styleOf(a.style);
        if (st) next[key] = { ...cur, [st]: a.type === 'show' };
        if (a.style === 'everything' || a.style === 'all') {
          next[key] = { ...cur, cartoon: a.type === 'show', ribbon: a.type === 'show', tube: a.type === 'show', ball: a.type === 'show', stick: a.type === 'show', sphere: a.type === 'show', surface: a.type === 'show' };
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
        next[key] = { ...cur, colorMode: 'residueindex' };
        log.push('• spectrum → per-residue rainbow colouring applied');
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
        if (s.cartoon || s.ribbon || s.tube || s.ball || s.stick || s.sphere || s.surface) shown[k] = true;
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
  } catch {}
  persistRenames(next);
};
const clearRenames = () => persistRenames({});

// Atom labels
useEffect(() => {
const component = componentRef.current;
if (!component || status !== 'ready') return;
const clearLabels = () => {
if (labelCompRef.current) {
try { component.removeRepresentation(labelCompRef.current); } catch {}
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
} catch {}
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
try { component.removeRepresentation(sidechainCompRef.current); } catch {}
sidechainCompRef.current = null;
}
};
clearSidechain();
// Skip heavy side-chain rendering on very large systems (keeps the view usable).
if (sidechainStyle !== 'none' && !hideAll && !pymolActive && !lightRenderRef.current) {
try {
sidechainCompRef.current = component.addRepresentation(sidechainStyle, {
sele: '(protein and sidechain) or (protein and .CA)', color: 'element', multipleBond: true,
radiusSize: sidechainStyle === 'licorice' ? 0.25 : undefined,
});
} catch {}
}
return clearSidechain;
}, [sidechainStyle, status, hideAll, pymolActive, lightRender]);

// Highlight the SELECTED atoms / residues (amber). Runs on every selection
// change (residue-strip clicks, atom clicks in the 3D view). Kept SEPARATE from
// the green "assigned atoms" highlight below so that clicking a residue NEVER
// rebuilds that (potentially huge) representation.
//
// Speed notes:
//  - Strip clicks use whole-residue clauses; resno alone can match SEVERAL
//    residues when the file mixes molecule types (protein + phospholipid +
//    water), so the residue NAME is pinned too.
//  - Large highlights fall back to `spacefill` (GPU-instanced, no bond map):
//    NGL's ball+stick needs the full-structure bond list, and computing it on a
//    big MD system blocks the page for seconds.
useEffect(() => {
const component = componentRef.current;
if (!component || status !== 'ready') return;

if (highlightCompRef.current) {
try { component.removeRepresentation(highlightCompRef.current); } catch {}
highlightCompRef.current = null;
}
if (stripHighlightCompRef.current) {
try { component.removeRepresentation(stripHighlightCompRef.current); } catch {}
stripHighlightCompRef.current = null;
}

const sel = Array.isArray(selectedKeys) ? selectedKeys : [];
if (sel.length === 0) return;

try {
const stripRi = stripResidueRiRef.current;
const isStripMode = stripRi !== null && Array.isArray(residueTicks) && sel.every((k) => {
  const riK = parseInt(String(k).split('-')[0], 10);
  return Number.isFinite(riK) && !!residueTicks[riK];
});

if (isStripMode) {
  const resSet = new Map(); // `${chainid}|${resno}|${resname}` → whole-residue NGL clause
  let approxAtoms = 0;
  sel.forEach((k) => {
    const riK = parseInt(String(k).split('-')[0], 10);
    if (!Number.isFinite(riK)) return;
    const t = residueTicks[riK];
    if (!t) return;
    approxAtoms += (t.atomNames || []).length;
    const chainClause = t.chainid ? `:${t.chainid}` : '';
    // resno alone can match SEVERAL residues when the file mixes molecule types
    // (e.g. a membrane MD system: protein + phospholipid + water). A phospholipid
    // with the same residue number would be highlighted too. Pin the residue
    // NAME as well so only the clicked residue is highlighted.
    resSet.set(`${t.chainid}|${t.resno}|${t.resname}`, `${chainClause} and ${t.resno} and resn ${t.resname}`);
  });
  const selParts = Array.from(resSet.values());
  if (selParts.length > 0) {
    // Lightweight mode → instanced spheres: ball+stick would force NGL to
    // compute the full-structure bond list (seconds of freeze on a big system).
    const useSphere = lightRenderRef.current || approxAtoms > 1500;
    stripHighlightCompRef.current = component.addRepresentation(useSphere ? 'spacefill' : 'ball+stick', {
      sele: selParts.join(' or '),
      color: SELECT_COLOR_HEX, aspectRatio: 1.5, radius: useSphere ? (approxAtoms > 1500 ? 0.3 : 0.4) : 0.4,
    });
  }
} else {
  const selSele = buildNglSele(sel, component.structure, moleculeTypeRef.current, namingConventionRef.current);
  if (selSele) {
    // Same bond-map reasoning as above: spheres when in lightweight mode.
    const useSphere = lightRenderRef.current;
    highlightCompRef.current = component.addRepresentation(useSphere ? 'spacefill' : 'ball+stick', {
      sele: selSele, color: SELECT_COLOR_HEX, aspectRatio: 1.5, radius: useSphere ? 0.5 : 0.4,
    });
  }
}
} catch { /* selection highlight is best-effort */ }
}, [selectedKeys, status, residueTicks]);

// Highlight the MANUALLY-ASSIGNED atoms (green "🟢 Assigned atoms"). Lives in its
// own effect so a selection click does not rebuild this representation — on a
// fully analysed MD/NMR page it can contain thousands of atoms. A signature
// guard also skips rebuilds when the parent passes a fresh (but identical)
// manualKeys array on unrelated re-renders, and tracks the component identity so
// a newly loaded structure always gets its green highlight rebuilt.
useEffect(() => {
const component = componentRef.current;
if (!component || status !== 'ready') return;

const sig = showManualHighlight
  ? `${Array.isArray(manualKeys) ? manualKeys.length : 0}|${Array.isArray(manualKeys) ? manualKeys.join(',') : ''}`
  : '';
if (sig === manualSigRef.current && manualHighlightCompRef.current && manualSigCompRef.current === component) return;
manualSigRef.current = sig;
manualSigCompRef.current = component;

if (manualHighlightCompRef.current) {
try { component.removeRepresentation(manualHighlightCompRef.current); } catch {}
manualHighlightCompRef.current = null;
}

const man = Array.isArray(manualKeys) ? manualKeys : [];
if (man.length === 0 || !showManualHighlight) return;
try {
const manSele = buildNglSele(man, component.structure, moleculeTypeRef.current, namingConventionRef.current);
if (manSele) {
  // Large assigned sets (or lightweight mode) → instanced spheres, no bond map.
  const useSphere = lightRenderRef.current || man.length > 1500;
  manualHighlightCompRef.current = component.addRepresentation(useSphere ? 'spacefill' : 'ball+stick', {
    sele: manSele, color: MANUAL_COLOR_HEX, aspectRatio: 1.5, radius: useSphere ? (man.length > 1500 ? 0.3 : 0.4) : 0.4,
  });
}
} catch { /* manual highlight is best-effort */ }
}, [manualKeys, showManualHighlight, status]);

// Load an additional structure file as its own NGL component (hidden by default —
// the "Molecules" selector reveals one at a time).
const loadExtraMolecule = useCallback(async (file, n) => {
try {
  const stage = stageRef.current;
  if (!stage) return;
  const comp = await stage.loadFile(file);
  // Style it with the CURRENT selectors (Backbone / Molecule Style) so extra
  // molecules follow the user's choices and never look like a gray blob.
  const baseReps = applyCurrentStyleTo(comp, []);
  const name = file.name || `Molecule ${n}`;
  const id = `mol_${Date.now()}_${n}`;
  extraCompsRef.current.push({ id, name, comp, baseReps });
  setExtraMols(extraCompsRef.current.map(({ id: xid, name: xname }) => ({ id: xid, name: xname })));
  try { comp.setVisibility(false); } catch {}
  // NOTE: no comp.autoView() here — the extra is HIDDEN and autoView would move
  // the camera away from the main structure. The camera is re-centred on the
  // main one after a flush; the Molecules bar (right side) toggles visibility.
} catch (err) {
  console.warn('Could not load additional molecule:', err && err.message);
}
}, [applyCurrentStyleTo]);

// Flush the pending extra files once the MAIN structure is ready. This runs
// AFTER the main load has called stage.removeAllComponents(), so the extras can
// never be wiped by it. Then re-centre the camera on the main structure.
useEffect(() => {
  if (status !== 'ready') return;
  const pending = pendingExtraFilesRef.current;
  if (!pending || pending.length === 0) return;
  pendingExtraFilesRef.current = [];
  pending.forEach(({ file, n }) => { loadExtraMolecule(file, n); });
  try { if (componentRef.current) componentRef.current.autoView(); } catch {}
  try { if (stageRef.current) stageRef.current.handleResize(); } catch {}
}, [status, loadExtraMolecule]);

const handleFileChange = useCallback((e) => {
const files = Array.from(e.target.files || []);
if (files.length === 0) return;
clearExtraMolecules();
setManualOverride(true);
setTrajFile(null);
const [first, ...rest] = files;
setFile(first);
setPdbId('');
requestStructureLoad({ file: first, url: null, ts: Date.now() });
onStructureFile?.(first);   // share the chosen topology with the analysis sections
if (driveNaming) archiveFileToDrive({ file: first, ctx: driveNaming }).catch(() => {});
// Additional structures (docking complexes / clusters / poses) are loaded as
// separate NGL components and shown via the "Molecules" bar (right side,
// multi-select — any combination can be displayed together).
// They are deferred (pendingExtraFilesRef) until the MAIN structure is ready:
// the main load calls stage.removeAllComponents(), which would wipe any
// component added while it runs.
pendingExtraFilesRef.current = rest.map((f, i) => ({ file: f, n: i + 1 }));
rest.forEach((f) => {
  if (driveNaming) archiveFileToDrive({ file: f, ctx: driveNaming }).catch(() => {});
});
e.target.value = '';
}, [onStructureFile, driveNaming, clearExtraMolecules]);

// Show/hide any combination of loaded structures (main + extra uploaded files).
// Only the selected molecules are displayed; the rest stay hidden.
const toggleMol = (key) => {
setVisibleMolKeys((prev) => {
  const next = new Set(prev);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
});
};
// Apply the molecule visibility to the NGL components whenever the selection changes.
useEffect(() => {
const show = (k) => visibleMolKeys.has(k);
try { if (componentRef.current) componentRef.current.setVisibility(show('main')); } catch {}
extraCompsRef.current.forEach(({ id, comp }) => {
  try { comp.setVisibility(show(id)); } catch {}
});
try { if (stageRef.current && stageRef.current.viewer) stageRef.current.viewer.requestRender(); } catch {}
}, [visibleMolKeys]);

const handlePdbIdLoad = useCallback(() => {
const value = pdbId.trim();
if (!value) return;
clearExtraMolecules();
setManualOverride(true);
setFile(null);
setTrajFile(null);
setLoadRequest({ file: null, url: value, ts: Date.now() });
onStructureSrc?.(value);   // share the web/PDB topology with the analysis sections
}, [pdbId, onStructureSrc, clearExtraMolecules]);

// ---- Empty the viewer completely ----
// Removes every loaded structure (main + extras), clears the residue strip, the
// Molecules / Selections bars and any trajectory, cancels in-flight loads, and
// returns the viewer to its empty idle state so a brand-new molecule can be
// loaded (nothing from the previous molecule remains on screen).
const handleClearViewer = () => {
  abortControl.abortAll();
  clearExtraMolecules();
  try { if (stageRef.current) stageRef.current.removeAllComponents(); } catch {}
  componentRef.current = null;
  highlightCompRef.current = null;
  manualHighlightCompRef.current = null;
  stripHighlightCompRef.current = null;
  stripResidueRiRef.current = null;
  labelCompRef.current = null;
  sidechainCompRef.current = null;
  selCompsRef.current = {};
  baseCompsRef.current = [];
  setFile(null);
  setPdbId('');
  setLoadRequest(null);
  setStatus('idle');
  setErrorMsg('');
  setResidueTicks([]);
  setSelections([]);
  setSelStyles({});
  setPymolActive(false);
  setPymolLog('');
  setPymolScript('');
  setShowPymolPanel(false);
  setHideAll(false);
  setHoverInfo(null);
  setHasNonProtein(false);
  setTrajFile(null);
  setTrajAborted(false); // a fresh trajectory pick is always allowed again
  setTrajStatus('none');
  setTrajError('');
  setPlaying(false);
  setNumFrames(0);
  setCurrentFrame(0);
  setPendingTraj(null);
  setExtraMols([]);
  setVisibleMolKeys(new Set(['main']));
  try { if (stageRef.current && typeof stageRef.current.handleResize === 'function') stageRef.current.handleResize(); } catch {}
};

// ---- Abort the current long-running operation (vertical-bar / global Stop) ----
// Stops trajectory playback, closes the frame-selection modal and cancels the
// active structure / trajectory load so the UI returns to a usable state.
const handleAbort = () => {
  setPlaying(false);
  setPendingTraj(null);
  abortControl.abortAll();
  if (abortRef.current) {
    const a = abortRef.current;
    abortRef.current = null;
    a.cancel();
  }
};

// ---- Capture the current 3D scene as a figure -------------------------------
// Uses NGL's makeImage (reliable WebGL screenshot), falls back to the raw
// canvas, then stores the image in the Figures library (Publications page).
const captureScene = async () => {
  const stage = stageRef.current;
  if (!stage) { setCaptureMsg('⚠️ No 3D scene to capture'); setTimeout(() => setCaptureMsg(''), 3500); return; }
  let url = '';
  try {
    if (typeof stage.makeImage === 'function') {
      const canvas = stage.makeImage();
      if (canvas && typeof canvas.toDataURL === 'function') url = canvas.toDataURL('image/png');
    }
  } catch { /* fall through to the raw canvas */ }
  if (!url) {
    try {
      const cv = stage.viewer && stage.viewer.container ? stage.viewer.container.querySelector('canvas') : null;
      if (cv) url = cv.toDataURL('image/png');
    } catch { /* ignore */ }
  }
  if (!url) { setCaptureMsg('⚠️ Could not capture the 3D scene'); setTimeout(() => setCaptureMsg(''), 3500); return; }
  const label = `Structure${file ? ` · ${file.name}` : pdbId ? ` · ${pdbId}` : ''}`;
  await addLibraryItem(await downscaleImage(url), label);
  setCaptureMsg('✓ 3D structure saved to the Figures library (Publications → Figures & Slides)');
  setTimeout(() => setCaptureMsg(''), 5000);
};

return (
<div className="flex flex-col gap-3">
{/* Topology and Structure Controls (compact) */}
<div className="flex flex-wrap items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg p-1.5">
<label
title="Load structure file(s) from your computer — the first is the main structure, the rest appear in the Molecules bar (right side, multi-select)"
className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white font-bold px-2.5 py-1.5 rounded-md text-xs shadow-sm transition-colors inline-flex items-center gap-1"
>
📂 PDB file(s)
<input
type="file"
accept=".pdb,.gro,.cif,.bcif,.ent,.mol2,.sdf"
multiple
onChange={handleFileChange}
className="hidden"
/>
</label>
<button
type="button"
onClick={() => setShowAssignedFlag(!showManualHighlight)}
title="Show / hide the green highlight on manually assigned atoms"
className={`text-xs font-bold px-2 py-1.5 rounded-md border transition-colors h-8 ${showManualHighlight ? 'bg-green-50 border-green-300 text-green-700' : 'bg-slate-100 border-slate-300 text-slate-500'}`}
>
{showManualHighlight ? '🟢 Assigned' : '⚪ Assigned'}
</button>
{file && (
<span title={file.name} className="text-[10px] text-slate-500 max-w-[120px] truncate">
{file.name}
</span>
)}

<div className="flex items-center gap-1">
<input
type="text"
value={pdbId}
onChange={(e) => setPdbId(e.target.value)}
onKeyDown={(e) => {
if (e.key === 'Enter') handlePdbIdLoad();
}}
placeholder="PDB ID or URL"
title="Load from a PDB ID (e.g. 1TUP), rcsb: or a plain https URL"
className="border border-slate-300 rounded-md px-2 py-1.5 text-xs w-28 bg-white outline-none focus:border-blue-500 font-mono h-8"
/>
<button
type="button"
onClick={handlePdbIdLoad}
className="bg-slate-600 hover:bg-slate-700 text-white font-bold px-2 py-1.5 rounded-md text-xs shadow-sm transition-colors h-8"
>
Load
</button>
</div>

<label
title="Load a trajectory (XTC/TRR/DCD) to animate the structure"
className="cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-2.5 py-1.5 rounded-md text-xs shadow-sm transition-colors inline-flex items-center gap-1"
>
📂 Trajectory
<input
type="file"
accept=".xtc,.trr,.dcd"
onChange={(e) => {
const f = e.target.files && e.target.files[0];
if (f) handleTrajFileChosen(f);
e.target.value = '';
}}
className="hidden"
/>
</label>
{(trajFile || trajectoryFile) && (
<span title={(trajFile || trajectoryFile).name} className="text-[10px] text-slate-500 max-w-[110px] truncate">
{(trajFile || trajectoryFile).name}
</span>
)}
{(file || residueTicks.length > 0 || extraMols.length > 0 || trajFile || trajectoryFile || status === 'ready' || status === 'loading' || status === 'error') && (
<button
type="button"
onClick={handleClearViewer}
title="Empty the viewer completely (remove all molecules, the sequence strip and any trajectory) so you can load a fresh molecule"
className="text-xs font-bold px-2 py-1.5 rounded-md border transition-colors h-8 bg-white border-red-300 text-red-600 hover:bg-red-50 whitespace-nowrap"
>
🗑 Clear
</button>
)}
<label title="Show atom names" className="flex items-center gap-1 text-xs font-bold text-slate-700 cursor-pointer h-8 whitespace-nowrap">
<input
type="checkbox"
checked={showLabels}
onChange={(e) => setShowLabels(e.target.checked)}
className="w-3.5 h-3.5 accent-blue-600"
/>
Names
</label>
<button
type="button"
onClick={() => setViewerCollapsed((v) => !v)}
title={viewerCollapsed ? 'Restore the 3D viewer window' : 'Retract (minimize) the 3D viewer window — the structure stays loaded, only the tall canvas collapses to a thin bar'}
className={`text-xs font-bold px-2 py-1.5 rounded-md border transition-colors h-8 whitespace-nowrap ${viewerCollapsed ? 'bg-sky-600 text-white border-sky-600 hover:bg-sky-700' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-100'}`}
>
{viewerCollapsed ? '⬆ Expand' : '⬇ Minimize'}
</button>

<button
type="button"
onClick={captureScene}
title="Save the current 3D view as a figure — it goes to the Figures library (Publications → Figures & Slides)"
className="text-xs font-bold px-2 py-1.5 rounded-md border transition-colors h-8 whitespace-nowrap bg-white border-indigo-300 text-indigo-600 hover:bg-indigo-50"
>
📷 Figure
</button>
{captureMsg && (
<span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md px-2 py-1">{captureMsg}</span>
)}

{/* Residue renumbering */}
<div className="flex flex-col gap-1">
<button
type="button"
onClick={() => setShowRenumberPanel((v) => !v)}
title="Renumber residues"
className="text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-md px-2 py-1.5 h-8 whitespace-nowrap"
>
🔢 Renumber{showRenumberPanel ? ' ▲' : ' ▼'}
</button>
{showRenumberPanel && residueInfo.length > 0 && (
<div className="border border-slate-200 rounded-lg bg-white shadow-sm p-2 flex flex-col gap-1.5 max-h-56 overflow-y-auto">
<div className="flex items-center justify-between gap-1">
<span className="text-[9px] font-bold text-slate-400 uppercase">Residue → new number</span>
<div className="flex items-center gap-1">
<input
type="number"
value={renumberFrom}
onChange={(e) => setRenumberFrom(e.target.value)}
className="border border-slate-300 rounded px-1 py-0.5 w-12 text-right outline-none focus:border-blue-500 text-[10px] font-mono"
title="Starting number"
/>
<button
type="button"
onClick={applyRenumberFrom}
className="text-xs font-bold bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded whitespace-nowrap"
title="Renumber all residues consecutively starting from this number (no manual per-residue edits needed)"
>
Renumber from
</button>
<button
type="button"
onClick={() => commitRenumber({})}
className="text-[9px] font-bold bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-1.5 py-0.5 rounded"
title="Clear renumbering (restore original numbers)"
>
Clear
</button>
</div>
</div>
{residueInfo.map((r, i) => (
<div key={r.resno} className="flex items-center gap-1.5 text-[10px] font-mono text-slate-600">
<span className="w-3 text-slate-400">{i + 1}.</span>
<span className="flex-1 truncate">{r.resname}{r.resno}</span>
<input
type="number"
value={renumberMap[String(r.resno)] !== undefined && renumberMap[String(r.resno)] !== '' ? renumberMap[String(r.resno)] : r.resno}
onChange={(e) => {
const nv = parseInt(e.target.value, 10);
commitRenumber({ ...renumberMap, [String(r.resno)]: Number.isFinite(nv) ? nv : '' });
}}
className="border border-slate-300 rounded px-1 py-0.5 w-16 text-right outline-none focus:border-blue-500"
title="New residue number (blank = keep the original)"
/>
</div>
))}
</div>
)}
</div>

<select
title="Side chain style"
value={sidechainStyle}
onChange={(e) => setSidechainStyle(e.target.value)}
className="border border-slate-300 rounded-md px-1.5 py-1.5 text-xs bg-white outline-none focus:border-blue-500 h-8"
>
<option value="none">Side: Hidden</option>
<option value="line">Side: Lines</option>
<option value="licorice">Side: Licorice</option>
<option value="ball+stick">Side: Ball &amp; Stick</option>
<option value="spacefill">Side: Spacefill</option>
</select>

<select
title="Backbone style"
value={backboneStyle}
onChange={(e) => setBackboneStyle(e.target.value)}
className="border border-slate-300 rounded-md px-1.5 py-1.5 text-xs bg-white outline-none focus:border-blue-500 h-8"
>
<option value="cartoon">Backbone: Cartoon</option>
<option value="tube">Backbone: Tube</option>
<option value="ball+stick">Backbone: Ball &amp; Stick</option>
<option value="sticks">Backbone: Sticks</option>
<option value="lines">Backbone: Lines</option>
<option value="spheres">Backbone: Spheres</option>
<option value="hidden">Backbone: Hidden</option>
</select>

{/* Molecule Style — for NON-protein molecules and for the non-protein content
    of a protein structure (ligands / lipids / ions / water in the same file). */}
{(['organic', 'lipid', 'sugar', 'dna', 'rna'].includes(moleculeType) || extraMols.length > 0 || hasNonProtein) && (
<select
title="Molecule style"
value={moleculeStyle}
onChange={(e) => setMoleculeStyle(e.target.value)}
className="border border-slate-300 rounded-md px-1.5 py-1.5 text-xs bg-white outline-none focus:border-blue-500 h-8"
>
<option value="ball+stick">Mol: Ball &amp; Stick</option>
<option value="stick">Mol: Sticks</option>
<option value="line">Mol: Lines</option>
<option value="spheres">Mol: Spheres</option>
<option value="surface">Mol: Surface</option>
</select>
)}

{/* Large-structure style — shown in lightweight mode. The protein stays a
    cartoon; this picks how lipids / ions / water are drawn. Dots is the
    absolute lightest (one point per atom). Water is hidden by default. */}
{lightRender && (
<select
title="Large structure style (lightweight mode): how the non-protein atoms are drawn"
value={largeStyle}
onChange={(e) => setLargeStyle(e.target.value)}
className="border border-sky-300 rounded-md px-1.5 py-1.5 text-xs bg-sky-50 text-sky-800 outline-none focus:border-sky-500 h-8"
>
<option value="spheres">Large: Spheres</option>
<option value="lines">Large: Lines</option>
<option value="dots">Large: Dots (lightest)</option>
</select>
)}

{lightRender && (
<label title="Water is hidden by default in large systems (it dominates the atom count); enable to show it with the same lightweight style" className="flex items-center gap-1 text-[10px] font-bold text-sky-800 cursor-pointer h-8 whitespace-nowrap">
<input
type="checkbox"
checked={showLargeWater}
onChange={(e) => setShowLargeWater(e.target.checked)}
className="w-3.5 h-3.5 accent-sky-600"
/>
💧 Water
</label>
)}

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
  <button type="button" onClick={() => setFogEnabled((v) => !v)}
    className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors ${fogEnabled ? 'bg-sky-100 border-sky-400 text-sky-800' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'}`}
    title="NGL's default depth fog fades distant atoms toward the background (a grey haze). Toggle it off for a crisp image — the setting is saved and persists across pages.">
    🌫 Fog: {fogEnabled ? 'On' : 'Off'}
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
        <button type="button" onClick={autoNameFrom2D} className="px-2 py-1 text-xs font-bold rounded bg-white border border-amber-300 text-amber-700 hover:bg-amber-100">Auto-name (2D)</button>
        <button type="button" onClick={clearRenames} className="px-2 py-1 text-xs font-bold rounded bg-white border border-red-300 text-red-600 hover:bg-red-50">Clear overrides</button>
      </div>
    </div>
    <p className="text-[10px] text-slate-500">
      {renameMode ? 'Click any atom in the 3D viewer, then type its new name below.' : 'Search the atom list and edit names directly. Changes are stored with the test and persist.'}
    </p>
    {renameTarget !== null && (
      <div className="flex items-center gap-2 bg-white border border-amber-300 rounded-lg p-2">
        <span className="text-xs font-bold text-slate-700">Atom #{renameTarget}:</span>
        <input value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applyRename(); }} className="border border-slate-300 rounded px-2 py-1 text-xs outline-none focus:border-amber-500" />
        <button type="button" onClick={applyRename} className="px-2 py-1 text-xs font-bold rounded bg-amber-600 text-white">OK</button>
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
        <button type="button" onClick={clearPyMOL} className="px-2 py-1 text-xs font-bold rounded bg-white border border-red-300 text-red-600 hover:bg-red-50">Clear</button>
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-[10px] font-bold text-slate-500 uppercase shrink-0">Load script</label>
      <select
        value=""
        onChange={(e) => {
          const n = e.target.value;
          e.target.value = '';
          if (!n) return;
          const entry = getPymolScripts()[n];
          if (entry) setPymolScript(typeof entry === 'string' ? entry : (entry.script || ''));
        }}
        title="Load a script saved in the Library (Library → PyMOL Scripts) into the editor, then press Run"
        className="border border-violet-300 rounded-md px-2 py-1 text-xs bg-white outline-none focus:border-violet-500"
      >
        <option value="">— Library scripts —</option>
        {Object.entries(getPymolScripts()).map(([n]) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
      <span className="text-[9px] text-slate-400">saved in <b>Library → PyMOL Scripts</b></span>
    </div>
    <label className="text-[10px] font-bold text-slate-500 uppercase">Paste a PyMOL script (select / show / hide / color / set sphere_scale·transparency / bg_color / cartoon · ribbon · tube / surface / spectrum / util.ray_shadows)</label>
    <textarea value={pymolScript} onChange={(e) => setPymolScript(e.target.value)} rows={6}
      className="w-full border border-violet-300 rounded-lg p-2 text-xs font-mono outline-none focus:border-violet-500 bg-white"
      placeholder={'select peptide, polymer.protein\nshow cartoon, peptide\ncolor gold, name CA and peptide\nset sphere_scale, 0.6, headgroups\nset sphere_transparency, 0.3, upper_headgroups\nbg_color white'} />
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-bold text-slate-500 uppercase">Effects</span>
      <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600"><input type="checkbox" checked={autoShowSel} onChange={(e) => setAutoShowSel(e.target.checked)} className="accent-violet-600" /> Auto-show parsed selections</label>
      <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600"><input type="checkbox" checked={qualityHigh} onChange={(e) => setQualityHigh(e.target.checked)} className="accent-violet-600" /> High quality (ray-shadows approx.)</label>
      <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600">BG <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="w-8 h-6 border border-slate-300 rounded cursor-pointer" /></label>
    </div>
    {pymolLog && <pre className="text-xs text-slate-700 bg-white border border-violet-200 rounded-lg p-2 whitespace-pre-wrap max-h-32 overflow-y-auto">{pymolLog}</pre>}
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
<div className="w-full">
{trajStatus === 'loading' && (
  <span className="text-xs font-bold text-indigo-600">
    ⏳ Loading trajectory ({trajectoryFormat.toUpperCase()})…
    {numFrames > 0 && (
      <span className="text-indigo-500 font-mono font-semibold">
        {' '}{trajTotal > 0
          ? `${Math.min(numFrames, trajTotal).toLocaleString()} / ${trajTotal.toLocaleString()}`
          : `${numFrames.toLocaleString()}`} frames loaded
      </span>
    )}
  </span>
)}
{trajStatus === 'ready' && (
  <span className="text-xs font-bold text-emerald-600">
    ✓ {trajectoryFormat.toUpperCase()}: {numFrames} frames total → playing {keptFrames} (stride {effStride})
  </span>
)}
{trajStatus === 'error' && <span className="text-xs font-bold text-red-600">⚠️ {trajError}</span>}
</div>
</div>
)}

{/* Residue sequence strip — click a tick to select that whole residue.
    Only POLYMER residues (protein / nucleic) are shown: water, ions and
    phospholipids/lipids are not part of the sequence and are excluded. */}
{residueTicks.length > 0 && moleculeType !== 'organic' && (() => {
  const polyTicks = residueTicks.filter((r) => r.polymer);
  if (polyTicks.length === 0) return null;
  const thinStep = polyTicks.length > 900 ? 5 : polyTicks.length > 450 ? 3 : polyTicks.length > 200 ? 2 : 1;
  return (
  <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-2 py-1.5">
    <span className="text-[9px] font-black text-slate-500 uppercase shrink-0">Residues</span>
    <div className="flex gap-0.5 overflow-x-auto custom-scrollbar items-stretch py-0.5">
      {polyTicks.map((r, i) => {
        if (thinStep > 1 && i % thinStep !== 0) return null;
        const isSel = selectedKeys && selectedKeys.some((k) => parseInt(String(k).split('-')[0], 10) === r.resno - 1);
        return (
          <button key={`${r.chainid}-${r.resno}`} type="button"
            onClick={(e) => handleResidueTickClick(r, e)}
            title={`${r.resname} ${r.resno}${r.chainid ? ` (chain ${r.chainid})` : ''} — click to select, Ctrl/Cmd/Shift-click to add to a multi-residue selection, Shift+click after another tick to select a range`}
            className={`w-7 h-9 shrink-0 rounded-md border flex flex-col items-center justify-center gap-px leading-none transition-colors ${isSel ? 'bg-amber-400 border-amber-600' : 'bg-white border-slate-300 hover:border-amber-400 hover:bg-amber-50'}`}>
            <span className="text-[6px] font-bold text-slate-400 leading-none">{r.resno}</span>
            <span className={`text-[10px] font-black leading-none ${isSel ? 'text-amber-950' : 'text-slate-700'}`}>{r.code || (r.resname ? r.resname.slice(0, 1) : '?')}</span>
          </button>
        );
      })}
    </div>
    <div className="flex items-center gap-1 shrink-0">
      <button type="button"
        onClick={() => setMultiSelectActive((v) => !v)}
        title="Toggle multi-residue selection — each click then adds/removes that residue instead of replacing the selection (Ctrl/Cmd/Shift-click always toggles)"
        className={`px-1.5 py-1 rounded-md border text-[9px] font-black leading-none transition-colors ${multiSelectActive ? 'bg-amber-400 border-amber-600 text-amber-950' : 'bg-white border-slate-300 text-slate-600 hover:bg-amber-50 hover:border-amber-400'}`}>
        {multiSelectActive ? '⊞ multi ON' : '⊞ multi'}
      </button>
      {(selectedKeys && selectedKeys.length > 0) && (
        <button type="button"
          onClick={clearResidueSelection}
          title="Clear the current residue selection"
          className="px-1.5 py-1 rounded-md border bg-white border-slate-300 text-slate-600 text-[9px] font-black leading-none hover:bg-red-50 hover:border-red-300 hover:text-red-600">
          ✕ clear
        </button>
      )}
    </div>
  </div>
  );
})()}

{/* Large-structure info line (non-blocking): the whole system is rendered,
    just with lightweight representations so the browser stays responsive.
    Kept at the TOP of the viewer window so the "water hidden" note is visible
    without scrolling to the bottom. */}
{lightInfo && (
<div className="flex flex-wrap items-center gap-2 bg-sky-50 border border-sky-200 text-sky-900 rounded-lg px-3 py-2 text-xs font-bold shadow-sm">
<span>
ℹ️ Large structure{lightInfo.nAtoms ? ` (${lightInfo.nAtoms.toLocaleString()} atoms)` : ''}: showing the whole system (protein cartoon + {largeStyle === 'lines' ? 'lines' : largeStyle === 'dots' ? 'dots' : 'spheres'}) — water is hidden by default, use the 💧 Water checkbox to show it.
</span>
<button
type="button"
onClick={useFullDetail}
className="text-xs font-bold bg-white border border-sky-300 text-sky-800 hover:bg-sky-100 px-2.5 py-1 rounded-lg transition-colors"
title="Switch to the full-detail representations (ball+stick, high quality) — can be slower on large systems"
>
✨ Full detail
</button>
</div>
)}

{viewerCollapsed && (
<div className="flex items-center justify-between border border-dashed border-slate-300 rounded-xl bg-slate-50 px-3 py-2.5">
  <span className="text-xs font-bold text-slate-500">🧬 3D viewer minimized — the structure stays loaded.</span>
  <button type="button" onClick={() => setViewerCollapsed(false)}
    className="text-xs font-bold px-2.5 py-1 rounded-md bg-sky-600 text-white border border-sky-600 hover:bg-sky-700 transition-colors">
    ▲ Expand viewer
  </button>
</div>
)}

{/* 3D Viewport — retractable: "⬇ Minimize" collapses it to a thin bar. The
    container stays MOUNTED (height 0) so the NGL stage, structure and
    trajectory are preserved; only the tall canvas is hidden. */}
<div
className="relative border border-slate-200 rounded-xl overflow-hidden bg-white"
style={{ height: (viewerCollapsed ? 0 : viewH) + 'px' }}
>
<div ref={containerRef} className="w-full h-full" />

{/* Floating retract control — top-left of the 3D viewport, always visible
    (above the status overlays). Mirrors the "⬇ Minimize" toolbar button. */}
<button
type="button"
onClick={() => setViewerCollapsed(true)}
title="Retract (minimize) the 3D viewer window — the structure stays loaded, only the tall canvas collapses to a thin bar"
className="absolute top-2 left-2 z-40 w-7 h-7 rounded-md bg-white/90 border border-slate-300 text-slate-600 text-xs font-black hover:bg-slate-100 shadow-sm flex items-center justify-center"
>
▼
</button>

{/* Vertical Molecules bar (right side) — multi-select which structures to display */}
{extraMols.length > 0 && (
  <div className="absolute top-2 right-2 bottom-2 w-44 z-40 flex flex-col gap-2 bg-white/95 border border-blue-200 rounded-xl shadow-lg p-2 overflow-hidden">
    <div className="flex items-center justify-between gap-2 shrink-0">
      <span className="text-[10px] font-black text-blue-700 uppercase tracking-wide">Molecules</span>
      <span className="flex gap-1">
        <button type="button"
          onClick={() => setVisibleMolKeys(new Set(extraCompsRef.current.map(({ id }) => id).concat(['main'])))}
          className="px-1.5 py-0.5 text-[8px] font-bold rounded border bg-white border-blue-300 text-blue-600 hover:bg-blue-50"
          title="Show every structure">All</button>
        <button type="button"
          onClick={() => setVisibleMolKeys(new Set(['main']))}
          className="px-1.5 py-0.5 text-[8px] font-bold rounded border bg-white border-slate-300 text-slate-500 hover:bg-slate-50"
          title="Show only the main structure">Main</button>
      </span>
    </div>
    <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-0.5">
      <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-700 cursor-pointer hover:bg-blue-50 rounded px-1 py-0.5" title="Main structure">
        <input type="checkbox" checked={visibleMolKeys.has('main')} onChange={() => toggleMol('main')} className="accent-blue-600 w-3.5 h-3.5" />
        <span className="truncate">Main{file ? ` (${file.name})` : ''}</span>
      </label>
      {extraMols.map((m) => (
        <label key={m.id} className="flex items-center gap-1.5 text-[10px] font-bold text-slate-700 cursor-pointer hover:bg-blue-50 rounded px-1 py-0.5" title={m.name}>
          <input type="checkbox" checked={visibleMolKeys.has(m.id)} onChange={() => toggleMol(m.id)} className="accent-blue-600 w-3.5 h-3.5" />
          <span className="truncate">{m.name}</span>
        </label>
      ))}
    </div>
  </div>
)}

{/* Vertical selections bar (right side of the viewer) — also hosts the Abort button */}
{(selections.length > 0 || status === 'loading' || trajStatus === 'loading' || playing) && (
  <div className={`absolute top-2 ${extraMols.length > 0 ? 'right-[11.5rem]' : 'right-2'} bottom-2 w-60 z-30 flex flex-col gap-2 bg-white/95 border border-violet-200 rounded-xl shadow-lg p-2 overflow-hidden`}>
    {selections.length > 0 && (
    <>
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
              <span className={`text-xs font-bold truncate ${st.hidden ? 'text-slate-400 line-through' : 'text-slate-800'}`} title={s.expr}>{s.name}</span>
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-[10px] text-slate-400 font-mono">{n != null ? `${n} atoms` : '—'}</span>
                <button type="button"
                  onClick={() => setSelStyles({ ...selStylesRef.current, [s.name]: { ...(selStylesRef.current[s.name] || {}), hidden: !st.hidden } })}
                  className={`px-1.5 py-0.5 text-[10px] font-bold rounded border ${st.hidden ? 'bg-red-600 text-white border-red-600' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-red-50'}`}
                  title={st.hidden ? 'Show this selection again' : 'Hide this selection (removes its representations)'}>
                  {st.hidden ? '👁 Show' : '🙈 Hide'}
                </button>
              </div>
            </div>
            {!st.hidden && (
              <>
            <div className="flex items-center gap-1 flex-wrap">
              {['cartoon', 'ribbon', 'tube', 'ball', 'stick', 'sphere', 'surface'].map((style) => (
                <button key={style} type="button"
                  onClick={() => setSelStyles({ ...selStylesRef.current, [s.name]: { ...(selStylesRef.current[s.name] || {}), [style]: !((selStylesRef.current[s.name] || {})[style]) } })}
                  className={`px-1.5 py-0.5 text-[10px] font-bold rounded border ${st[style] ? 'bg-violet-600 text-white border-violet-600' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-violet-50'}`}>
                  {style === 'ball' ? 'ball+stick' : style}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[10px] font-bold text-slate-500 uppercase">Colour</span>
              <select value={st.colorMode || 'solid'}
                onChange={(e) => setSelStyles({ ...selStylesRef.current, [s.name]: { ...(selStylesRef.current[s.name] || {}), colorMode: e.target.value } })}
                className="text-[10px] border border-slate-300 rounded bg-white text-slate-600 outline-none focus:border-violet-500 h-6"
                title="Colouring metaphor">
                <option value="solid">Solid</option>
                <option value="element">Atom type</option>
                <option value="chainid">Chain</option>
                <option value="resname">Residue</option>
                <option value="sstruc">2° structure</option>
                <option value="hydrophobicity">Hydrophobicity</option>
              </select>
              <input type="color" value={st.color != null ? `#${st.color.toString(16).padStart(6, '0')}` : '#000000'}
                disabled={(st.colorMode || 'solid') !== 'solid'}
                onChange={(e) => { const c = parseInt(e.target.value.slice(1), 16); setSelStyles({ ...selStylesRef.current, [s.name]: { ...(selStylesRef.current[s.name] || {}), color: c } }); }}
                className={`w-6 h-6 border border-slate-300 rounded cursor-pointer ${(st.colorMode || 'solid') !== 'solid' ? 'opacity-30 cursor-not-allowed' : ''}`}
                title="Solid colour (used when Colour = Solid)" />
            </div>
            <label className="flex items-center gap-1 text-[10px] text-slate-500">
              transp
              <input type="range" min="0" max="1" step="0.05" value={st.transparency || 0}
                onChange={(e) => setSelStyles({ ...selStylesRef.current, [s.name]: { ...(selStylesRef.current[s.name] || {}), transparency: parseFloat(e.target.value) } })}
                className="accent-violet-600 w-full" />
            </label>
              </>
            )}
          </div>
        );
      })}
    </div>
    </>
    )}
    <div className="shrink-0 border-t border-slate-100 pt-1.5 mt-1">
      <button type="button" onClick={handleAbort}
        className={`w-full px-2 py-1 text-xs font-bold rounded-lg border transition-colors ${abortRef.current || playing ? 'bg-red-600 text-white border-red-600 hover:bg-red-700' : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'}`}
        disabled={!(abortRef.current || playing)}
        title={abortRef.current ? `Abort: ${abortRef.current.label}` : playing ? 'Stop trajectory playback' : 'No operation in progress'}>
        ⏹ Abort{abortRef.current ? ` (${abortRef.current.label})` : ''}
      </button>
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

{/* Vertical resize handle — drag to make the 3D viewer taller/shorter */}
<div
  onMouseDown={(e) => { resizeRef.current = { startY: e.clientY, startH: viewH }; e.preventDefault(); }}
  className="h-4 -mt-1 cursor-row-resize flex items-center justify-center select-none text-slate-300 hover:text-slate-500 active:text-slate-600 transition-colors"
  title={`Drag to resize the 3D viewer (currently ${viewH} px)`}
>
  <span className="text-[11px] leading-none tracking-widest">⠿</span>
</div>

{/* Trajectory frame-selection modal */}
{pendingTraj && (
<div className="fixed inset-0 z-[99999] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
<div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
<h3 className="text-sm font-black text-slate-800 mb-2">Trajectory frame selection</h3>
<p className="text-xs text-slate-600 mb-3">
<b className="text-slate-800">{pendingTraj.file.name}</b> is estimated to contain ~{pendingTraj.estFrames.toLocaleString()} frames.
{pendingTraj.over2G
  ? ' Loading all of it may exceed ~2 GB of memory and freeze the browser.'
  : ' Choose how many frames to load — a reduced set is sampled evenly across the whole trajectory so the total time range is preserved.'}
</p>
<div className="flex items-center gap-2 mb-1">
<label className="text-xs font-bold text-slate-700 shrink-0">Load at most</label>
<input
  type="number"
  min="1"
  max={pendingTraj.estFrames}
  value={trajFrameCount}
  onChange={(e) => setTrajFrameCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
  className="w-24 border border-indigo-300 rounded-lg px-2 py-1.5 text-sm bg-white outline-none focus:border-indigo-500 font-semibold"
/>
<span className="text-xs text-slate-500 shrink-0">representative frames (max {pendingTraj.estFrames.toLocaleString()})</span>
</div>
<p className="text-[10px] text-slate-400 mb-4">
Default: {Math.min(TARGET_TRAJ_FRAMES, pendingTraj.estFrames).toLocaleString()} frames sampled evenly across the run (~every {pendingTraj.suggested}× frame). The total trajectory time is preserved.
</p>
<div className="flex flex-wrap gap-2 justify-end">
<button
type="button"
onClick={() => setPendingTraj(null)}
className="text-xs font-bold text-slate-500 hover:text-slate-700 px-3 py-2 rounded-lg"
>
Cancel
</button>
<button
type="button"
onClick={loadTrajWithoutReduction}
className="text-xs font-bold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 px-3 py-2 rounded-lg shadow-sm"
>
Load everything
</button>
<button
type="button"
onClick={acceptTrajReduction}
className="text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-lg shadow-sm"
>
✓ Load {Math.min(Math.max(1, parseInt(trajFrameCount, 10) || TARGET_TRAJ_FRAMES), Math.max(1, pendingTraj.estFrames)).toLocaleString()} frames
</button>
</div>
</div>
</div>
)}


</div>
);
};

export default NMRMoleculeViewer;
