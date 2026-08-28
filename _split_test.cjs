// Validates the MODEL-aware PDB splitting fix against replicas of the user's
// failing file (multi-MODEL ensemble with overlapping/identical coordinates).
const fs = require('fs');
const out = [];

// ---- molecule geometry: a small 8-atom fragment (residue TAC, chain A) ----
const ATOMS = [
  ['C1', -1.0, 0.0, 0.0],
  ['C2', 1.0, 0.0, 0.0],
  ['O1', 2.0, 1.0, 0.0],
  ['N1', -2.0, 1.0, 0.0],
  ['C3', 2.0, -1.0, 0.0],
  ['C4', -2.0, -1.0, 0.0],
  ['H1', 0.0, 1.2, 0.0],
  ['H2', 0.0, -1.2, 0.0],
];
// intra-model bonds (by 0-based atom index)
const BONDS = [
  [0, 1], [0, 3], [0, 5], [1, 2], [1, 4], [2, 6], [4, 7], [3, 6], [5, 7],
];

const fmtCoord = (v) => v.toFixed(3).padStart(8);

// Serial numbering strategy per model:
//  - 'unique' : serials continue across models (like the user's TAC file)
//  - 'restart': serials restart at 1 in every MODEL (standard NMR files)
// shift: array of per-model [atomIdx, dx, dy, dz] small perturbations used to
//        create cross-conformer close contacts (the real merge mechanism).
function buildPdb(models, { uniqueSerials = true, shift = [] } = {}) {
  const lines = [];
  let serialBase = 0;
  models.forEach((m, mi) => {
    lines.push(`MODEL        ${mi + 1}`);
    ATOMS.forEach(([name, x, y, z], ai) => {
      const serial = (uniqueSerials ? serialBase + ai + 1 : ai + 1);
      let [dx, dy, dz] = [0, 0, 0];
      if (shift[mi] && shift[mi][0] === ai) [dx, dy, dz] = shift[mi].slice(1);
      lines.push(
        `HETATM${String(serial).padStart(5)} ${name.padEnd(4)} TAC A   1    ` +
        `${fmtCoord(x + dx)}${fmtCoord(y + dy)}${fmtCoord(z + dz)}  1.00  0.00           ${name[0]}`
      );
    });
    if (uniqueSerials) {
      // per-model CONECT (serials unique → each pair resolves within the model)
      BONDS.forEach(([a, b]) => {
        lines.push(`CONECT${String(serialBase + a + 1).padStart(5)}${String(serialBase + b + 1).padStart(5)}`);
      });
    }
    serialBase += ATOMS.length;
    lines.push('ENDMDL');
  });
  lines.push('END');
  return lines.join('\n');
}

// ---------- OLD splitter (current code, frameCount-era) ----------
async function oldSplit(file) {
  let text = '';
  try { text = await file.text(); } catch { return []; }
  const lines = String(text || '').split(/\r?\n/);
  const atoms = [];
  const conectBonds = [];
  const conectIndex = new Map();
  for (const line of lines) {
    const rec = line.slice(0, 6).trim();
    if (rec === 'ATOM' || rec === 'HETATM') {
      const serial = parseInt(line.slice(6, 11), 10);
      const idx = atoms.length;
      const x = parseFloat(line.slice(30, 38));
      const y = parseFloat(line.slice(38, 46));
      const z = parseFloat(line.slice(46, 54));
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      atoms.push({ line, chain: line.slice(21, 22).trim() || '_', resname: line.slice(17, 20).trim(), x, y, z });
      if (Number.isFinite(serial)) conectIndex.set(serial, idx);
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
  const parent = atoms.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  conectBonds.forEach(([a, b]) => union(a, b));
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
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const cell = grid.get(cellKey(cx + dx, cy + dy, cz + dz));
      if (!cell) continue;
      for (const j of cell) {
        if (j <= i) continue;
        const b = atoms[j];
        const ddx = a.x - b.x, ddy = a.y - b.y, ddz = a.z - b.z;
        if (ddx * ddx + ddy * ddy + ddz * ddz <= BOND_DIST * BOND_DIST) union(i, j);
      }
    }
  }
  const groups = new Map();
  atoms.forEach((_, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
  const parts = [];
  groups.forEach((idxs) => {
    if (parts.length >= 30) return;
    parts.push({ chainId: atoms[idxs[0]].chain });
  });
  return parts;
}

// ---------- NEW splitter (MODEL-aware) ----------
async function newSplit(file) {
  if (!file) return [];
  let text = '';
  try { text = await file.text(); } catch { return []; }
  const lines = String(text || '').split(/\r?\n/);
  const atoms = [];
  const conectBonds = [];
  const conectIndex = new Map();
  let model = 0;          // 0-based index of the MODEL block owning current atoms
  let blocksSeen = 0;     // number of MODEL records seen so far
  for (const line of lines) {
    const rec = line.slice(0, 6).trim();
    if (rec === 'MODEL') {
      model = blocksSeen; // the next block gets the next 0-based index
      blocksSeen += 1;
      continue;
    }
    if (rec === 'ATOM' || rec === 'HETATM') {
      const serial = parseInt(line.slice(6, 11), 10);
      const idx = atoms.length;
      const x = parseFloat(line.slice(30, 38));
      const y = parseFloat(line.slice(38, 46));
      const z = parseFloat(line.slice(46, 54));
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      atoms.push({ line, chain: line.slice(21, 22).trim() || '_', resname: line.slice(17, 20).trim(), model, x, y, z });
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
  const modelCount = blocksSeen > 0 ? blocksSeen : 1; // 1 = no MODEL records (single model)
  const parent = atoms.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  conectBonds.forEach(([a, b]) => { if (atoms[a].model === atoms[b].model) union(a, b); });
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
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
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
  const groups = new Map();
  atoms.forEach((_, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
  const parts = [];
  groups.forEach((idxs) => {
    if (parts.length >= 30) return;
    parts.push({ chainId: atoms[idxs[0]].chain, model: atoms[idxs[0]].model });
  });
  return { parts, modelCount };
}

(async () => {
  // Scenario A: 4 IDENTICAL models, unique serials, per-model CONECT (like TAC models 1&2)
  const pdbA = buildPdb([0, 1, 2, 3], { uniqueSerials: true });
  fs.writeFileSync('_replica_identical.pdb', pdbA, 'utf8');
  const oldA = await oldSplit(new Blob([pdbA]));
  const newA = await newSplit(new Blob([pdbA]));
  out.push(`A) 4 identical models (unique serials + CONECT): OLD parts=${oldA.length} (bug: 1) | NEW parts=${newA.parts.length}, models=${newA.modelCount}`);
  out.push(`   NEW models per part: ${newA.parts.map((p) => p.model + 1).join(',')}`);

  // Scenario B: 4 conformers with CROSS-model close atoms (rigid-region overlap),
  // restarted serials, no CONECT — the pure-proximity merge mechanism.
  const shiftB = [
    null,
    [1, 0.15, -0.1, 0.05],        // model 2: C2 ~0.19 A from model 1's C2
    [3, -0.2, 0.1, -0.1],         // model 3: N1 ~0.24 A from model 1's N1
    [5, 0.1, 0.15, 0.1],          // model 4: C4 ~0.2 A from model 1's C4
  ];
  const pdbB = buildPdb([0, 1, 2, 3], { uniqueSerials: false, shift: shiftB });
  const oldB = await oldSplit(new Blob([pdbB]));
  const newB = await newSplit(new Blob([pdbB]));
  out.push(`B) 4 conformers w/ cross-model close atoms (restarted serials, no CONECT): OLD parts=${oldB.length} (bug: 1) | NEW parts=${newB.parts.length}, models=${newB.modelCount}`);

  // Scenario C: single-model protein+ligand (regression: multi-MOLECULE split still works)
  const pdbC = [
    'ATOM      1  N   GLY A   1       1.000   1.000   1.000  1.00  0.00           N',
    'ATOM      2  CA  GLY A   1       2.000   1.000   1.000  1.00  0.00           C',
    'ATOM      3  C   GLY A   1       3.000   1.000   1.000  1.00  0.00           C',
    'ATOM      4  O   GLY A   1       4.000   1.000   1.000  1.00  0.00           O',
    'HETATM    5  C1  LIG A   2       10.000  10.000  10.000  1.00  0.00           C',
    'HETATM    6  N1  LIG A   2       11.000  10.000  10.000  1.00  0.00           N',
    'CONECT    1    2',
    'CONECT    2    1    3',
    'CONECT    3    2    4',
    'CONECT    5    6',
    'END',
  ].join('\n');
  const oldC = await oldSplit(new Blob([pdbC]));
  const newC = await newSplit(new Blob([pdbC]));
  out.push(`C) single-model protein+ligand: OLD parts=${oldC.length} | NEW parts=${newC.parts.length}, models=${newC.modelCount}`);

  const okA = oldA.length === 1 && newA.parts.length === 4 && newA.modelCount === 4;
  const okB = oldB.length === 1 && newB.parts.length === 4 && newB.modelCount === 4;
  const okC = oldC.length === 2 && newC.parts.length === 2 && newC.modelCount === 1;
  out.push(`RESULT: A=${okA ? 'PASS' : 'FAIL'} B=${okB ? 'PASS' : 'FAIL'} C=${okC ? 'PASS' : 'FAIL'}`);

  fs.writeFileSync('_split_test_out.txt', out.join('\n'), 'utf8');
})().catch((e) => {
  fs.writeFileSync('_split_test_out.txt', 'ERROR: ' + (e && e.stack ? e.stack : e), 'utf8');
});
