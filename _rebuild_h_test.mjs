// Validation: rebuildProteinHydrogenCoords must reproduce the exact H geometry
// the in-app builder (NMRSections buildProteinHCoords) generates, while leaving
// every heavy atom byte-for-byte untouched. Run: node _rebuild_h_test.mjs
import { readFileSync } from 'node:fs';
import { rebuildProteinHydrogenCoords } from './src/utils/rebuildProteinHydrogens.js';

const src = readFileSync('src/components/NMRSections.jsx', 'utf8');
const extract = (name) => {
  const start = src.indexOf(`const ${name} = `);
  if (start === -1) throw new Error('missing ' + name);
  const bodyStart = start + `const ${name} = `.length;
  let depth = 0;
  let i = bodyStart;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if (ch === ';' && depth === 0) break;
  }
  if (i >= src.length) throw new Error('unterminated ' + name);
  return src.slice(start, i + 1) + '\n';
};

const order = ['_vecSub', '_vecAdd', '_vecScale', '_vecDot', '_vecCross', '_vecNorm', '_vecNormalize', '_deg2rad', 'nerfPlace', '_padLeft', '_padRight', '_formatAtomName', '_fmtNum', 'pdbAtomLine', 'AA_1_TO_3', 'PROTEIN_BB', 'SS_TORSIONS', 'ssTorsionAt', '_ringClose', 'placeSidechainAtoms', 'buildProteinBackbone', 'buildProteinHCoords', 'proteinSequenceToPdbText'];
let code = '';
order.forEach((n) => { code += extract(n); });
const runner = new Function(code + '\nreturn { proteinSequenceToPdbText, buildProteinHCoords };');
const { proteinSequenceToPdbText, buildProteinHCoords } = runner();

const seq = 'ACDEFGHIKLMNPQRSTVWY';
const pdb = proteinSequenceToPdbText(seq, '');
const res = rebuildProteinHydrogenCoords(pdb);

if (!res.ok) { console.error('rebuild failed:', res.message); process.exit(1); }
console.log(`rebuilt=${res.rebuilt} kept=${res.kept} residues=${res.residues}`);

const parse = (text) => {
  const atoms = [];
  text.split('\n').forEach((l) => {
    if (!l.startsWith('ATOM  ') && !l.startsWith('HETATM')) return;
    atoms.push({
      name: l.slice(12, 16).trim(),
      resSeq: parseInt(l.slice(22, 26), 10),
      x: parseFloat(l.slice(30, 38)), y: parseFloat(l.slice(38, 46)), z: parseFloat(l.slice(46, 54)),
      element: l.slice(76, 78).trim() || l.slice(12, 13).trim(),
    });
  });
  return atoms;
};
const before = parse(pdb);
const after = parse(res.text);

if (before.length !== after.length) { console.error('atom count changed'); process.exit(1); }
const heavyChanged = before.filter((a, i) => a.element !== 'H' && (a.x !== after[i].x || a.y !== after[i].y || a.z !== after[i].z));
if (heavyChanged.length) { console.error('heavy atoms moved!', heavyChanged.length); process.exit(1); }

const expected = buildProteinHCoords(seq, '');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
let mismatches = 0;
let checked = 0;
after.forEach((a) => {
  if (a.element !== 'H') return;
  const ri = a.resSeq - 1;
  const want = expected[ri] && expected[ri][a.name];
  if (!want) return;
  checked++;
  const got = [a.x, a.y, a.z];
  if (dist(got, want) > 0.002) { mismatches++; if (mismatches < 6) console.log('H mismatch', seq[ri], a.resSeq, a.name, got, want); }
});
console.log(`checked ${checked} H positions vs builder, mismatches=${mismatches}`);

// N-H(amide) of residue 2 must be ~1.01 A
const amide = after.find((a) => a.resSeq === 2 && a.name === 'H');
const n2 = after.find((a) => a.resSeq === 2 && a.name === 'N');
const nh = dist([amide.x, amide.y, amide.z], [n2.x, n2.y, n2.z]);
console.log(`amide N-H distance residue 2 = ${nh.toFixed(4)} A`);

// Idempotence: running again must not change anything.
const second = rebuildProteinHydrogenCoords(res.text);
if (!second.ok || second.text !== res.text) { console.error('rebuild is NOT idempotent'); process.exit(1); }

if (res.kept === 0 && mismatches === 0 && Math.abs(nh - 1.01) < 0.02) console.log('PASS');
else { console.error('FAIL'); process.exit(1); }
