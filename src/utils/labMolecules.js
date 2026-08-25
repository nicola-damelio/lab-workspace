// src/utils/labMolecules.js

export const WATER_MASS = 18.01528;

// Average residue masses in Da
export const AA_MASS = {
  A: 71.0779,
  R: 156.1857,
  N: 114.1026,
  D: 115.0874,
  C: 103.1429,
  E: 129.114,
  Q: 128.1292,
  G: 57.0513,
  H: 137.1393,
  I: 113.1576,
  L: 113.1576,
  K: 128.1723,
  M: 131.1961,
  F: 147.1739,
  P: 97.1152,
  S: 87.0773,
  T: 101.1039,
  W: 186.2099,
  Y: 163.1733,
  V: 99.1311
};

// Approximate nucleic-acid residue masses after phosphodiester linkage
export const DNA_RESIDUE_MASS = {
  A: 313.209,
  T: 304.196,
  C: 289.183,
  G: 329.212
};

export const RNA_RESIDUE_MASS = {
  A: 329.209,
  U: 306.169,
  C: 305.183,
  G: 345.212
};

// Simplified one-letter / token polysaccharide residue masses.
// You can extend this list as needed.
export const POLY_ONE_LETTER = {
  G: { label: 'Glucose', mass: 162.1404 },
  M: { label: 'Mannose', mass: 162.1404 },
  A: { label: 'Galactose', mass: 162.1404 },
  F: { label: 'Fucose', mass: 146.1404 },
  X: { label: 'Xylose', mass: 132.1242 },
  N: { label: 'HexNAc', mass: 203.19 },
  S: { label: 'Sialic acid', mass: 291.26 }
};

export const POLY_TOKENS = {
  GLC: 162.1404,
  GLUCOSE: 162.1404,
  MAN: 162.1404,
  MANNOSE: 162.1404,
  GAL: 162.1404,
  GALACTOSE: 162.1404,
  FUC: 146.1404,
  FUCOSE: 146.1404,
  XYL: 132.1242,
  XYLOSE: 132.1242,
  HEX: 162.1404,
  HEXNAC: 203.19,
  GLCNAC: 203.19,
  GALNAC: 203.19,
  NEUAC: 291.26,
  SIA: 291.26,
  SIALICACID: 291.26
};

export const MODIFICATIONS = [
  {
    id: 'acetylation',
    label: 'Acetylation',
    delta: 42.0106,
    aliases: ['ac', 'acetyl']
  },
  {
    id: 'acylation',
    label: 'Acylation',
    delta: 42.0106,
    aliases: ['acyl'],
    note: 'Default acetyl-like mass. Replace with specific acyl mass if needed.'
  },
  {
    id: 'phosphorylation',
    label: 'Phosphorylation',
    delta: 79.9664,
    aliases: ['phos', 'p']
  },
  {
    id: 'amidation',
    label: 'Amidation',
    delta: -0.984,
    aliases: ['amide', 'nh2']
  },
  {
    id: 'methylation',
    label: 'Methylation',
    delta: 14.0157,
    aliases: ['me']
  },
  {
    id: 'dimethylation',
    label: 'Dimethylation',
    delta: 28.0313,
    aliases: ['me2']
  },
  {
    id: 'trimethylation',
    label: 'Trimethylation',
    delta: 42.047,
    aliases: ['me3']
  },
  {
    id: 'formylation',
    label: 'Formylation',
    delta: 27.9949,
    aliases: ['formyl']
  },
  {
    id: 'succinylation',
    label: 'Succinylation',
    delta: 100.016,
    aliases: ['succinyl']
  },
  {
    id: 'palmitoylation',
    label: 'Palmitoylation',
    delta: 238.2297,
    aliases: ['palmitoyl']
  },
  {
    id: 'biotinylation',
    label: 'Biotinylation',
    delta: 226.0779,
    aliases: ['biotin']
  }
];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const normalizeKey = (s) => String(s || '').toLowerCase().replace(/[\s_-]+/g, '');

export function parseModifications(input = '') {
  if (!input) return [];

  return String(input)
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((token) => {
      // Supports formats like:
      // Phosphorylation
      // Phosphorylation:2
      // Phosphorylation*2
      // Phosphorylationx2
      const match = token.match(/^(.*?)(?:[:*x](\d+))?$/i);
      const rawName = (match?.[1] || token).trim();
      const parsedCount = parseInt(match?.[2] || '1', 10);
      const count = Number.isFinite(parsedCount) && parsedCount >= 0 ? parsedCount : 1;

      const norm = normalizeKey(rawName);

      const found = MODIFICATIONS.find((m) => {
        const idNorm = normalizeKey(m.id);
        const labelNorm = normalizeKey(m.label);
        const aliasNorms = (m.aliases || []).map(normalizeKey);
        return idNorm === norm || labelNorm === norm || aliasNorms.includes(norm);
      });

      return Array.from({ length: count }, () => {
        if (found) {
          return {
            label: found.label,
            delta: found.delta,
            known: true
          };
        }

        return {
          label: rawName,
          delta: 0,
          known: false
        };
      });
    });
}

export function modificationMass(mods = []) {
  return mods.reduce((sum, m) => sum + (Number(m.delta) || 0), 0);
}

export function calculateSequenceInfo({ type = 'protein', sequence = '', modifications = '' }) {
  const mods = parseModifications(modifications);
  const modMass = modificationMass(mods);

  if (type === 'protein') {
    const clean = String(sequence || '')
      .toUpperCase()
      .replace(/\s/g, '');

    const letters = clean.split('').filter(Boolean);
    const unknown = [];

    let mass = WATER_MASS + modMass;

    letters.forEach((ch) => {
      if (ch === '*') return;
      if (AA_MASS[ch]) {
        mass += AA_MASS[ch];
      } else {
        unknown.push(ch);
      }
    });

    return {
      ok: unknown.length === 0,
      type,
      length: letters.filter((ch) => ch !== '*').length,
      molecularWeight: round2(mass),
      unknown,
      mods
    };
  }

  if (type === 'dna' || type === 'rna') {
    let clean = String(sequence || '')
      .toUpperCase()
      .replace(/[^AGCTU]/g, '');

    if (type === 'dna') {
      clean = clean.replace(/U/g, 'T');
    }

    if (type === 'rna') {
      clean = clean.replace(/T/g, 'U');
    }

    const table = type === 'dna' ? DNA_RESIDUE_MASS : RNA_RESIDUE_MASS;
    const unknown = [];

    let mass = WATER_MASS + modMass;

    clean.split('').forEach((ch) => {
      if (table[ch]) {
        mass += table[ch];
      } else {
        unknown.push(ch);
      }
    });

    return {
      ok: unknown.length === 0,
      type,
      length: clean.length,
      molecularWeight: round2(mass),
      unknown,
      mods
    };
  }

  if (type === 'polysaccharide') {
    const raw = String(sequence || '').trim();

    let tokens = [];

    if (/[-,\s]/.test(raw)) {
      tokens = raw
        .split(/[-,\s]+/)
        .filter(Boolean)
        .map((t) => t.toUpperCase());
    } else {
      tokens = raw.toUpperCase().split('');
    }

    const unknown = [];
    let mass = WATER_MASS + modMass;

    tokens.forEach((token) => {
      const tokenMass =
        POLY_TOKENS[token] ||
        (POLY_ONE_LETTER[token] ? POLY_ONE_LETTER[token].mass : null);

      if (tokenMass) {
        mass += tokenMass;
      } else {
        unknown.push(token);
      }
    });

    return {
      ok: unknown.length === 0,
      type,
      length: tokens.length,
      molecularWeight: round2(mass),
      unknown,
      mods
    };
  }

  return {
    ok: false,
    type,
    length: 0,
    molecularWeight: 0,
    unknown: [],
    mods
  };
}

// Simple preferred-codon reverse translation.
// This is not a full codon-optimization engine, but is sufficient for a lab notebook helper.
const CODON_TABLES = {
  bacterial: {
    A: 'GCG',
    R: 'CGT',
    N: 'AAC',
    D: 'GAT',
    C: 'TGC',
    E: 'GAA',
    Q: 'CAA',
    G: 'GGC',
    H: 'CAT',
    I: 'ATT',
    L: 'CTG',
    K: 'AAA',
    M: 'ATG',
    F: 'TTT',
    P: 'CCG',
    S: 'AGC',
    T: 'ACC',
    W: 'TGG',
    Y: 'TAT',
    V: 'GTG',
    '*': 'TAA'
  },
  mammalian: {
    A: 'GCC',
    R: 'CGG',
    N: 'AAC',
    D: 'GAT',
    C: 'TGC',
    E: 'GAA',
    Q: 'CAA',
    G: 'GGC',
    H: 'CAT',
    I: 'ATT',
    L: 'CTG',
    K: 'AAA',
    M: 'ATG',
    F: 'TTT',
    P: 'CCC',
    S: 'TCC',
    T: 'ACC',
    W: 'TGG',
    Y: 'TAT',
    V: 'GTG',
    '*': 'TAA'
  }
};

export function generateDnaFromProtein(sequence, host = 'bacterial', { addStop = false } = {}) {
  const clean = String(sequence || '')
    .toUpperCase()
    .replace(/[^A-Z*]/g, '');

  const table = CODON_TABLES[host] || CODON_TABLES.bacterial;

  let dna = clean
    .split('')
    .map((aa) => table[aa] || 'NNN')
    .join('');

  if (addStop && !dna.endsWith('TAA')) {
    dna += 'TAA';
  }

  return dna;
}

// Optional RDKit-based SMILES MW calculation.
// If RDKit is not available, the UI should allow manual MW override.

async function loadRDKit() {
  if (typeof window === 'undefined') return null;

  if (window.__RDKit) return window.__RDKit;

  if (!window.initRDKitModule) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/@rdkit/rdkit/dist/RDKit_minimal.js';
      script.async = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  window.__RDKit = await window.initRDKitModule();
  return window.__RDKit;
}

export async function calculateSmilesInfoAsync(smiles) {
  if (!smiles) return null;

  try {
    const RDKit = await loadRDKit();
    if (!RDKit) return null;

    const mol = RDKit.get_mol(smiles);
    if (!mol) return null;

    let mw = null;

    try {
      const desc = JSON.parse(mol.get_descriptors());
      mw = desc.MolWt || desc.AMW || desc.exactmolwt || null;
    } catch (err) {
      console.warn('RDKit descriptor parsing failed:', err);
    }

    if (mol && typeof mol.delete === 'function') {
      mol.delete();
    }

    return {
      type: 'smiles',
      molecularWeight: mw ? Number(mw) : null,
      length: null
    };
  } catch (err) {
    console.warn('RDKit unavailable. Falling back to manual MW entry.', err);
    return null;
  }
}
