// ============================================================================
// Physical hydrogen rebuild for peptide / protein PDB text.
// ============================================================================
// "Delete the hydrogens, then add them again": every hydrogen atom of every
// standard amino-acid residue is *recomputed* from the residue's own heavy-atom
// scaffold using the exact same idealized NeRF geometry as the in-app builder
// (see proteinSequenceToPdbText in NMRSections.jsx — side-chain chi defaults,
// tetrahedral methyl/methylene placement, planar aromatic ring protons, amide
// H trans to Cα, terminal H1/H2/H3...). Names, serials, bonds and ALL heavy
// atoms are left untouched — only the x/y/z columns of the H lines change, so
// residue/atom labels and every connectivity record keep working.
//
// Coordinates are written back in place (fixed PDB columns), which means the
// function is safe for files with or without CONECT records, MODEL records and
// alternate locators, and the number of atoms never changes.
// ============================================================================

const AA3 = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G',
  HIS: 'H', HSD: 'H', HSE: 'H', HSP: 'H', HID: 'H', HIE: 'H', HIP: 'H',
  ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S', THR: 'T',
  TRP: 'W', TYR: 'Y', VAL: 'V', MSE: 'M', CYX: 'C', SEC: 'U', PYL: 'O',
};

// ---- Minimal vector helpers (mirror of NMRSections' NeRF geometry) ---------
const vSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vScale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vNorm = (a) => Math.sqrt(vDot(a, a));
const vNormalize = (a) => { const n = vNorm(a); return n < 1e-8 ? [0, 0, 0] : vScale(a, 1 / n); };
const deg2rad = (d) => d * Math.PI / 180;

const nerfPlace = (A, B, C, bondLength, bondAngleRad, torsionRad) => {
  const t = -torsionRad; // sign convention identical to the in-app builder
  const bc = vNormalize(vSub(C, B));
  const ab = vSub(B, A);
  const n = vNormalize(vCross(ab, bc));
  const m = vCross(n, bc);
  const d2 = [
    -bondLength * Math.cos(bondAngleRad),
    bondLength * Math.sin(bondAngleRad) * Math.cos(t),
    bondLength * Math.sin(bondAngleRad) * Math.sin(t),
  ];
  return [
    C[0] + bc[0] * d2[0] + m[0] * d2[1] + n[0] * d2[2],
    C[1] + bc[1] * d2[0] + m[1] * d2[1] + n[1] * d2[2],
    C[2] + bc[2] * d2[0] + m[2] * d2[1] + n[2] * d2[2],
  ];
};

// Fixed PDB atom-record columns (0-based JS slices).
const X0 = 30, X1 = 38, Y0 = 38, Y1 = 46, Z0 = 46, Z1 = 54;
const fmtCoord = (v) => String(Number(v).toFixed(3)).padStart(8);

const parseAtomRecord = (line) => {
  const name = line.slice(12, 16).trim();
  const altLoc = line.slice(16, 17).trim();
  if (altLoc && altLoc !== 'A') return null; // only the main (or A) conformer
  const element = (line.slice(76, 78).trim() || (name ? name[0] : '') || '').toUpperCase();
  const resSeq = parseInt(line.slice(22, 26), 10);
  if (!Number.isFinite(resSeq)) return null;
  return {
    chain: line.slice(21, 22).trim(),
    icode: line.slice(26, 27).trim(),
    resSeq,
    resName: line.slice(17, 20).trim().toUpperCase(),
    nameUp: name.toUpperCase(),
    element,
    isH: element === 'H' && name.charAt(0).toUpperCase() === 'H',
    isHeavy: element !== 'H' && element !== 'D' && element !== 'HD',
    x: parseFloat(line.slice(X0, X1)),
    y: parseFloat(line.slice(Y0, Y1)),
    z: parseFloat(line.slice(Z0, Z1)),
  };
};

// ---- Ideal H-placement recipes for every standard residue ------------------
// Mirrors placeSidechainAtoms (NMRSections.jsx): each H is placed with the
// SAME reference frame atoms (heavy-only) and the same bond length / angle /
// torsion, so rebuilt coordinates match the in-app builder wherever the heavy
// scaffold matches it — and stay physically sensible on any other scaffold.
const sidechainH = (char, h) => {
  const out = {};
  const has = (nm) => !!h[nm];
  const add = (nm, a, b, c, len, ang, tor) => {
    if (has(a) && has(b) && has(c)) out[nm] = nerfPlace(h[a], h[b], h[c], len, deg2rad(ang), deg2rad(tor));
  };
  const ch2 = (cname, a, b) => {
    add(cname.replace(/^C/, 'H') + '2', a, b, cname, 1.09, 109.5, 120);
    add(cname.replace(/^C/, 'H') + '3', a, b, cname, 1.09, 109.5, -120);
  };
  const ch3 = (cname, a, b) => {
    [60, 180, -60].forEach((tor, i) => add(cname.replace(/^C/, 'H') + String(i + 1), a, b, cname, 1.09, 109.5, tor));
  };
  const center = (names) => {
    const pts = names.map((nm) => h[nm]).filter(Boolean);
    if (pts.length < 3) return null;
    const c = [0, 0, 0];
    pts.forEach((p) => { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; });
    return vScale(c, 1 / pts.length);
  };
  const ringH = (nm, parent, ctr) => {
    if (has(parent) && ctr) {
      const d = vNormalize(vSub(h[parent], ctr));
      if (d[0] || d[1] || d[2]) out[nm] = vAdd(h[parent], vScale(d, 1.08));
    }
  };
  switch (char) {
    case 'A': ch3('CB', 'N', 'CA'); break;
    case 'R':
      ch2('CB', 'N', 'CA'); ch2('CG', 'CA', 'CB'); ch2('CD', 'CB', 'CG');
      add('HE', 'CG', 'CD', 'NE', 1.01, 115, 0);
      add('HH11', 'NE', 'CZ', 'NH1', 1.01, 120, 0); add('HH12', 'NE', 'CZ', 'NH1', 1.01, 120, 180);
      add('HH21', 'NE', 'CZ', 'NH2', 1.01, 120, 0); add('HH22', 'NE', 'CZ', 'NH2', 1.01, 120, 180);
      break;
    case 'N':
      ch2('CB', 'N', 'CA');
      add('HD21', 'CB', 'CG', 'ND2', 1.01, 120, 0); add('HD22', 'CB', 'CG', 'ND2', 1.01, 120, 180);
      break;
    case 'D': ch2('CB', 'N', 'CA'); break;
    case 'C':
      ch2('CB', 'N', 'CA');
      add('HG', 'CA', 'CB', 'SG', 1.34, 100, 180);
      break;
    case 'Q':
      ch2('CB', 'N', 'CA'); ch2('CG', 'CA', 'CB');
      add('HE21', 'CG', 'CD', 'NE2', 1.01, 120, 0); add('HE22', 'CG', 'CD', 'NE2', 1.01, 120, 180);
      break;
    case 'E': ch2('CB', 'N', 'CA'); ch2('CG', 'CA', 'CB'); break;
    case 'F':
      ch2('CB', 'N', 'CA');
      ringH('HD1', 'CD1', center(['CG', 'CD1', 'CE1', 'CZ', 'CE2', 'CD2']));
      ringH('HE1', 'CE1', center(['CG', 'CD1', 'CE1', 'CZ', 'CE2', 'CD2']));
      ringH('HE2', 'CE2', center(['CG', 'CD1', 'CE1', 'CZ', 'CE2', 'CD2']));
      ringH('HD2', 'CD2', center(['CG', 'CD1', 'CE1', 'CZ', 'CE2', 'CD2']));
      ringH('HZ', 'CZ', center(['CG', 'CD1', 'CE1', 'CZ', 'CE2', 'CD2']));
      break;
    case 'Y': {
      ch2('CB', 'N', 'CA');
      const c6 = center(['CG', 'CD1', 'CE1', 'CZ', 'CE2', 'CD2']);
      ringH('HD1', 'CD1', c6); ringH('HE1', 'CE1', c6);
      ringH('HE2', 'CE2', c6); ringH('HD2', 'CD2', c6);
      // Phenolic O–H: reproduce the builder frame (CB→CG axis + CA ref) so the
      // hydroxyl points consistently out of the ring plane.
      if (c6 && has('CB') && has('CG') && has('CA') && has('CZ') && has('OH')) {
        const u = vNormalize(vSub(h.CG, h.CB));
        let nrm = vNormalize(vCross(u, vNormalize(vSub(h.CA, h.CB))));
        if (!(nrm[0] || nrm[1] || nrm[2])) nrm = vCross(u, [1, 0, 0]);
        const vv = vNormalize(vCross(nrm, u));
        const dir = vNormalize(vSub(h.CZ, c6));
        out.HH = vAdd(h.OH, vScale(vNormalize(vAdd(dir, vScale(vv, 0.9))), 0.97));
      }
      break;
    }
    case 'H': {
      ch2('CB', 'N', 'CA');
      const c5 = center(['CG', 'ND1', 'CE1', 'NE2', 'CD2']);
      ringH('HD2', 'CD2', c5); ringH('HE1', 'CE1', c5);
      break;
    }
    case 'I':
      add('HB', 'N', 'CA', 'CB', 1.09, 109.5, 180);
      ch2('CG1', 'CA', 'CB'); ch3('CG2', 'CA', 'CB'); ch3('CD1', 'CB', 'CG1');
      break;
    case 'L':
      ch2('CB', 'N', 'CA');
      add('HG', 'CA', 'CB', 'CG', 1.09, 109.5, 180);
      ch3('CD1', 'CB', 'CG'); ch3('CD2', 'CB', 'CG');
      break;
    case 'K':
      ch2('CB', 'N', 'CA'); ch2('CG', 'CA', 'CB'); ch2('CD', 'CB', 'CG'); ch2('CE', 'CG', 'CD');
      ['HZ1', 'HZ2', 'HZ3'].forEach((nm, i) => add(nm, 'CD', 'CE', 'NZ', 1.01, 109.5, [60, 180, -60][i]));
      break;
    case 'M':
      ch2('CB', 'N', 'CA'); ch2('CG', 'CA', 'CB'); ch3('CE', 'CG', 'SD');
      break;
    case 'P': ch2('CB', 'N', 'CA'); ch2('CG', 'CA', 'CB'); ch2('CD', 'CB', 'CG'); break;
    case 'S':
      ch2('CB', 'N', 'CA');
      add('HG', 'CA', 'CB', 'OG', 0.97, 109, 180);
      break;
    case 'T':
      add('HB', 'N', 'CA', 'CB', 1.09, 109.5, 180);
      add('HG1', 'CA', 'CB', 'OG1', 0.97, 109, 180);
      ch3('CG2', 'N', 'CA');
      break;
    case 'V':
      add('HB', 'N', 'CA', 'CB', 1.09, 109.5, 180);
      ch3('CG1', 'N', 'CA'); ch3('CG2', 'N', 'CA');
      break;
    case 'W': {
      ch2('CB', 'N', 'CA');
      const c5 = center(['CG', 'CD1', 'NE1', 'CE2', 'CD2']);
      ringH('HD1', 'CD1', c5); ringH('HE1', 'NE1', c5);
      const c6 = center(['CD2', 'CE2', 'CE3', 'CZ3', 'CH2', 'CZ2']);
      ringH('HZ2', 'CZ2', c6); ringH('HH2', 'CH2', c6);
      ringH('HZ3', 'CZ3', c6); ringH('HE3', 'CE3', c6);
      break;
    }
    default: break;
  }
  return out;
};

// ---- Main entry -------------------------------------------------------------
// pdbText  the raw PDB text currently displayed by the 3D viewer.
// Returns  { ok, text, rebuilt, kept, residues } on success, or an
//          { ok:false, message } when there is nothing sensible to rebuild.
export const rebuildProteinHydrogenCoords = (pdbText) => {
  const text = String(pdbText || '');
  const lines = text.split('\n');

  // Parse all atom records, tracking MODEL numbers so multi-conformer PDB files
  // (NMR ensembles / docking clusters) rebuild each conformer independently.
  const atoms = [];
  let model = 1;
  lines.forEach((line, li) => {
    if (line.startsWith('MODEL')) {
      const m = parseInt(line.slice(6, 14).trim(), 10);
      if (Number.isFinite(m)) model = m;
      return;
    }
    if (line.startsWith('ATOM  ') || line.startsWith('HETATM')) {
      const rec = parseAtomRecord(line);
      if (rec) atoms.push(Object.assign({}, rec, { model, li }));
    }
  });


  // Group atoms into residues (one group per chain+resSeq+insertion code+model).
  const resByKey = new Map();
  const resOrder = [];
  atoms.forEach((a) => {
    const rkey = a.model + '|' + a.chain + '|' + a.resSeq + '|' + a.icode;
    let res = resByKey.get(rkey);
    if (!res) {
      res = {
        key: rkey,
        model: a.model,
        chain: a.chain,
        resSeq: a.resSeq,
        icode: a.icode,
        resName: a.resName,
        char: AA3[a.resName] || null,
        heavy: {},
        hNames: new Set(),
      };
      resByKey.set(rkey, res);
      resOrder.push(res);
    }
    if (a.isH) res.hNames.add(a.nameUp);
    else if (a.isHeavy) res.heavy[a.nameUp] = [a.x, a.y, a.z];
  });

  const aaResidues = resOrder.filter((r) => !!r.char);
  const aaHAtoms = atoms.filter((a) => {
    const res = resByKey.get(a.model + '|' + a.chain + '|' + a.resSeq + '|' + a.icode);
    return a.isH && res && !!res.char;
  });
  if (aaResidues.length === 0) {
    return { ok: false, message: 'No standard amino-acid residues were found — hydrogen rebuild currently supports peptide/protein PDB files.' };
  }
  if (aaHAtoms.length === 0) {
    return { ok: false, message: 'This peptide PDB has no hydrogen atoms — there is nothing to rebuild.' };
  }

  // Recompute every canonical hydrogen of every residue (heavy scaffold fixed).
  const replacements = new Map(); // model|chain|resSeq|icode|NAME -> [x, y, z]
  const chains = new Map();
  aaResidues.forEach((r) => {
    if (!chains.has(r.chain)) chains.set(r.chain, []);
    chains.get(r.chain).push(r);
  });


  chains.forEach((residues) => {
    residues.sort((p, q) => p.resSeq - q.resSeq || (p.icode < q.icode ? -1 : p.icode > q.icode ? 1 : 0));
    let prev = null;
    residues.forEach((res, idx) => {
      const cand = sidechainH(res.char, res.heavy);
      // H-alpha: same frame as the in-app builder (own residue C=O).
      if (res.heavy.O && res.heavy.C && res.heavy.CA) {
        cand.HA = nerfPlace(res.heavy.O, res.heavy.C, res.heavy.CA, 1.09, deg2rad(109.5), deg2rad(180));
      }
      // N-terminal H1/H2/H3 (never on proline) - frame via the freshly placed HA.
      if (idx === 0 && res.char !== 'P' && cand.HA && res.heavy.CA && res.heavy.N) {
        [60, 180, -60].forEach((tor, k) => {
          const nm = 'H' + (k + 1);
          if (res.hNames.has(nm)) cand[nm] = nerfPlace(cand.HA, res.heavy.CA, res.heavy.N, 1.01, deg2rad(109.5), deg2rad(tor));
        });
      }
      // Backbone amide H of residue i>0: frame on the PREVIOUS residue C=O so
      // the measured N-H stays ~1.01 A and trans to C-alpha.
      if (idx > 0 && res.char !== 'P' && prev && prev.heavy.O && prev.heavy.C && res.heavy.N) {
        const amide = nerfPlace(prev.heavy.O, prev.heavy.C, res.heavy.N, 1.01, deg2rad(120), deg2rad(180));
        if (res.hNames.has('H')) cand.H = amide;
        if (res.hNames.has('HN')) cand.HN = amide; // some files name the amide proton HN
      }
      const base = res.model + '|' + res.chain + '|' + res.resSeq + '|' + res.icode + '|';
      Object.keys(cand).forEach((nm) => {
        if (res.hNames.has(nm)) replacements.set(base + nm, cand[nm]);
      });
      prev = res;
    });
  });


  // Write the new coordinates back into the H lines. Names, serials, bonds,
  // heavy atoms and every other record stay byte-for-byte identical.
  let rebuilt = 0;
  let kept = 0;
  let moved = 0;
  const outLines = lines.slice();
  atoms.forEach((a) => {
    if (!a.isH) return;
    const res = resByKey.get(a.model + '|' + a.chain + '|' + a.resSeq + '|' + a.icode);
    if (!res || !res.char) return; // ligand / water / non-protein hydrogen: untouched
    const coord = replacements.get(a.model + '|' + a.chain + '|' + a.resSeq + '|' + a.icode + '|' + a.nameUp);
    if (!coord) { kept++; return; }
    const li = a.li;
    const orig = outLines[li];
    const updated = orig.slice(0, X0) + fmtCoord(coord[0]) + orig.slice(X1, Y0) + fmtCoord(coord[1]) + orig.slice(Y1, Z0) + fmtCoord(coord[2]) + orig.slice(Z1);
    outLines[li] = updated;
    rebuilt++;
    const ddx = coord[0] - a.x, ddy = coord[1] - a.y, ddz = coord[2] - a.z;
    if (Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) > 0.005) moved++;
  });

  return {
    ok: true,
    text: outLines.join('\n'),
    rebuilt,
    moved,
    kept,
    residues: aaResidues.length,
  };
};

