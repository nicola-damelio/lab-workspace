// Extracts the REAL splitPdbFileIntoMolecules from the source and runs it on a
// 20-model replica that mirrors the user's TAC file (paired identical models,
// unique serials, per-model CONECT, cross-conformer close contacts).
const fs = require('fs');

const src = fs.readFileSync('src/components/NMRMoleculeViewer.jsx', 'utf8');

// Extract the function body between the const declaration and its closing ";"
const startMarker = 'const splitPdbFileIntoMolecules = async (file) => {';
const start = src.indexOf(startMarker);
if (start < 0) throw new Error('splitter not found');
let depth = 0;
let end = start;
for (let i = start + startMarker.length - 1; i < src.length; i++) {
  const ch = src[i];
  if (ch === '{') depth += 1;
  else if (ch === '}') {
    depth -= 1;
    if (depth === 0) { end = i + 1; break; }
  }
}
const fnText = src.slice(start, end) + ';';
// eslint-disable-next-line no-eval
const splitPdbFileIntoMolecules = eval(
  '(' + fnText.replace(/^const splitPdbFileIntoMolecules = /, '').replace(/;\s*$/, '') + ')'
);

// ---- geometry: 8-atom fragment, 6 conformer families like the TAC ensemble ----
const ATOMS = [
  ['C1', -1.0, 0.0, 0.0], ['C2', 1.0, 0.0, 0.0], ['O1', 2.0, 1.0, 0.0],
  ['N1', -2.0, 1.0, 0.0], ['C3', 2.0, -1.0, 0.0], ['C4', -2.0, -1.0, 0.0],
  ['H1', 0.0, 1.2, 0.0], ['H2', 0.0, -1.2, 0.0],
];
const BONDS = [
  [0, 1], [0, 3], [0, 5], [1, 2], [1, 4], [2, 6], [4, 7], [3, 6], [5, 7],
];
// Family offsets: small (< 2 A) so the OLD proximity logic merges everything.
const FAMILIES = [
  [0, 0, 0], [0.3, -0.2, 0.1], [-0.2, 0.3, -0.1], [0.1, 0.1, 0.2],
  [-0.3, -0.1, 0.2], [0.2, -0.3, -0.1],
];
// Model -> family (mirrors the user's file: 1,2,9,13=A; 3,4,10,14=B; 5,6,12,16=C;
// 7,8=D; 11,15=E; 17-20=F)
const MODEL_FAMILY = [0, 0, 1, 1, 2, 2, 3, 3, 0, 1, 4, 2, 0, 1, 4, 2, 5, 5, 5, 5];

const fmt = (v) => v.toFixed(3).padStart(8);
const lines = [];
let serialBase = 0;
MODEL_FAMILY.forEach((fam, mi) => {
  lines.push(`MODEL        ${mi + 1}`);
  const [fx, fy, fz] = FAMILIES[fam];
  ATOMS.forEach(([name, x, y, z], ai) => {
    const serial = serialBase + ai + 1;
    lines.push(
      `HETATM${String(serial).padStart(5)} ${name.padEnd(4)} TAC A1678 ` +
      `${fmt(x + fx)}${fmt(y + fy)}${fmt(z + fz)}  1.00  0.00           ${name[0]}`
    );
  });
  BONDS.forEach(([a, b]) => {
    lines.push(`CONECT${String(serialBase + a + 1).padStart(5)}${String(serialBase + b + 1).padStart(5)}`);
  });
  serialBase += ATOMS.length;
  lines.push('ENDMDL');
});
lines.push('END');
const pdb = lines.join('\n');
fs.writeFileSync('_replica_20model.pdb', pdb, 'utf8');

(async () => {
  const parts = await splitPdbFileIntoMolecules(new Blob([pdb]));
  const out = [];
  out.push(`atoms in blob lines: ${lines.length}`);
  out.push(`SOURCE splitter returned ${parts.length} parts; modelCount=${parts[0].modelCount}`);
  out.push(`parts by model: ${parts.map((p) => `M${p.model + 1}`).join(', ')}`);
  out.push(`per-part atom counts: ${parts.map((p) => p.blob.size).join(', ')}`);
  const ok = parts.length === 20 && parts[0].modelCount === 20 &&
    parts.every((p, i) => p.model === i);
  out.push(`RESULT: ${ok ? 'PASS (20 models separated)' : 'FAIL'}`);
  fs.writeFileSync('_src_split_test_out.txt', out.join('\n'), 'utf8');
})().catch((e) => {
  fs.writeFileSync('_src_split_test_out.txt', 'ERROR: ' + (e && e.stack ? e.stack : e), 'utf8');
});
