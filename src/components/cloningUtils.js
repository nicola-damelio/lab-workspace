/* ==========================================================================
   CLONING — shared constants & pure helpers (no JSX)
========================================================================== */
export const WATER_MASS = 18.01528;

export const DNA_RESIDUE_MASS = { A: 313.209, T: 304.196, C: 289.183, G: 329.212 };

export const AA_MASS = {
  A: 71.0779, R: 156.1857, N: 114.1026, D: 115.0874, C: 103.1429,
  E: 129.114, Q: 128.1292, G: 57.0513, H: 137.1393, I: 113.1576,
  L: 113.1576, K: 128.1723, M: 131.1961, F: 147.1739, P: 97.1152,
  S: 87.0773, T: 101.1039, W: 186.2099, Y: 163.1733, V: 99.1311
};

// ss-nucleotide molar extinction coefficients at their λmax
export const DNA_BASE_EPS = {
  A: { peak: 259, eps: 15400, sigma: 9 },
  T: { peak: 265, eps: 8700, sigma: 9 },
  G: { peak: 253, eps: 11500, sigma: 10 },
  C: { peak: 267, eps: 7400, sigma: 9 }
};

// Hypochromicity correction for dsDNA (calibrated: A260 = 1 ≈ 50 µg/mL)
export const DS_DNA_HYPOCHROMICITY = 0.6;

export const GAUSS = (x, peak, sigma) =>
  Math.exp(-Math.pow(x - peak, 2) / (2 * sigma * sigma));

export const INPUT_CLS =
  'w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500 bg-white';
export const INPUT_BAD_CLS =
  'w-full border-2 border-red-400 bg-red-50 rounded-lg p-2 text-sm outline-none focus:border-red-500';

export const toNumber = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

export const round = (n, d = 2) => {
  if (!Number.isFinite(n)) return '—';
  const p = Math.pow(10, d);
  return (Math.round(n * p) / p).toLocaleString();
};

export const uid = (prefix) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const getOperatorLabel = (op) => {
  if (typeof op === 'string') return op;
  return `${op?.name || ''} ${op?.surname || ''}`.trim();
};

export const countLetters = (chars) => {
  const counts = {};
  (chars || []).forEach((ch) => {
    counts[ch] = (counts[ch] || 0) + 1;
  });
  return counts;
};

/* ================= sequence analysis ================= */
export const analyzeDnaSequence = (sequence, strandedness = 'dsDNA') => {
  const clean = String(sequence || '')
    .toUpperCase()
    .replace(/U/g, 'T')
    .replace(/[^AGCT]/g, '');
  const counts = countLetters(clean.split(''));
  let mw = WATER_MASS;
  let epsSum = 0;
  clean.split('').forEach((ch) => {
    mw += DNA_RESIDUE_MASS[ch] || 0;
    epsSum += DNA_BASE_EPS[ch]?.eps || 0;
  });
  const eps260 = strandedness === 'dsDNA' ? epsSum * DS_DNA_HYPOCHROMICITY : epsSum;
  return { length: clean.length, mw, eps260, counts };
};

export const analyzeProteinSequence = (sequence) => {
  const clean = String(sequence || '')
    .toUpperCase()
    .replace(/\*/g, '')
    .replace(/[^A-Z]/g, '');
  const counts = countLetters(clean.split(''));
  let mw = WATER_MASS;
  clean.split('').forEach((ch) => {
    mw += AA_MASS[ch] || 0;
  });
  const nW = counts.W || 0;
  const nY = counts.Y || 0;
  const nC = counts.C || 0;
  // Pace method: Trp 5500, Tyr 1490, Cystine 125
  const eps280 = nW * 5500 + nY * 1490 + Math.floor(nC / 2) * 125;
  return { length: clean.length, mw, eps280, counts };
};

/* ================= spectrum parsing / analysis ================= */
export const parseSpectrumText = (text) => {
  const points = [];
  String(text || '')
    .split(/\r?\n/)
    .forEach((line) => {
      const parts = line.trim().split(/[\t;,]+|\s+/).filter(Boolean);
      if (parts.length < 2) return;
      const x = parseFloat(parts[0]);
      const y = parseFloat(parts[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        points.push({ wavelength: x, absorbance: y });
      }
    });
  points.sort((a, b) => a.wavelength - b.wavelength);
  return points;
};

export const baselineOf = (points) => {
  const tail = points.filter((p) => p.wavelength >= 320);
  if (!tail.length) return 0;
  return tail.reduce((s, p) => s + p.absorbance, 0) / tail.length;
};

export const absorbanceAt = (points, target) => {
  if (!points.length) return null;
  if (target <= points[0].wavelength) return points[0].absorbance;
  if (target >= points[points.length - 1].wavelength) {
    return points[points.length - 1].absorbance;
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (target >= a.wavelength && target <= b.wavelength) {
      const span = b.wavelength - a.wavelength || 1;
      const t = (target - a.wavelength) / span;
      return a.absorbance + t * (b.absorbance - a.absorbance);
    }
  }
  return null;
};

// Resolve ε and MW for a spectrum: manual entry OR computed from sequence
export const effectiveSpectrumProps = (spec) => {
  if (spec.epsMode === 'sequence' && String(spec.sequence || '').trim()) {
    if (spec.seqType === 'protein') {
      const a = analyzeProteinSequence(spec.sequence);
      return { epsilon: a.eps280, mw: a.mw, length: a.length };
    }
    const a = analyzeDnaSequence(spec.sequence, spec.seqType || 'dsDNA');
    return { epsilon: a.eps260, mw: a.mw, length: a.length };
  }
  return {
    epsilon: toNumber(spec.epsilon),
    mw: toNumber(spec.mw),
    length: null
  };
};

export const analyzeSpectrum = (spec) => {
  const raw = Array.isArray(spec?.points) ? spec.points : [];
  if (raw.length < 2) return null;

  const baseline = baselineOf(raw);
  const pts = raw.map((p) => ({
    wavelength: p.wavelength,
    absorbance: Math.max(0, p.absorbance - baseline)
  }));

  const a260 = absorbanceAt(pts, 260);
  const a280 = absorbanceAt(pts, 280);
  const a230 = absorbanceAt(pts, 230);

  const { epsilon, mw } = effectiveSpectrumProps(spec);
  const pathCm = toNumber(spec.pathLength) || 1;
  const isProtein = spec.seqType === 'protein';
  const measA = isProtein ? a280 : a260;

  let concM = null;
  if (epsilon && epsilon > 0 && measA != null) {
    concM = measA / (epsilon * pathCm); // Beer–Lambert
  }

  return {
    pts,
    baseline,
    a260,
    a280,
    a230,
    r260_280: a260 != null && a280 > 0 ? a260 / a280 : null,
    r260_230: a260 != null && a230 > 0 ? a260 / a230 : null,
    epsilon,
    mw,
    concUM: concM != null ? concM * 1e6 : null,
    concNgUl: concM != null && mw ? concM * mw * 1000 : null
  };
};
