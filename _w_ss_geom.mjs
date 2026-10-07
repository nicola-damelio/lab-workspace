// SCRATCH — misura la geometria REALE costruita da buildProteinBackbone (NMRSections.jsx):
// φ/ψ/ω di ogni residuo, il senso dell'elica, ET un contrôle EXTERNE sur un vrai PDB du
// dépôt (public/structures/template_amino_acid.pdb) : c'est lui qui dit dans quel sens
// lire (L-amino acides), pour ne pas corriger à l'envers.
import { readFileSync } from 'node:fs';

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
  return src.slice(start, i + 1) + '\n';
};
const order = ['_vecSub', '_vecAdd', '_vecScale', '_vecDot', '_vecCross', '_vecNorm',
  '_vecNormalize', '_deg2rad', 'nerfPlace', 'PROTEIN_BB', 'SS_TORSIONS', 'ssTorsionAt',
  'buildProteinBackbone'];
let code = '';
order.forEach((n) => { code += extract(n); });
const B = new Function(code + '\nreturn { buildProteinBackbone, SS_TORSIONS, nerfPlace };')();

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.sqrt(dot(a, a));
const unit = (a) => { const n = norm(a); return n < 1e-9 ? [0, 0, 0] : [a[0] / n, a[1] / n, a[2] / n]; };
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

// THE app's own reader (src/utils/torsionDrive.js) is the reference.
const { dihedralDeg } = await import('./src/utils/torsionDrive.js');
const dih1 = (p0, p1, p2, p3) => {
  const b0 = sub(p0, p1); const b1 = unit(sub(p2, p1)); const b2 = sub(p3, p2);
  const v = sub(b0, scale(b1, dot(b0, b1)));
  const w = sub(b2, scale(b1, dot(b2, b1)));
  return Math.atan2(dot(cross(b1, v), w), dot(v, w)) * 180 / Math.PI;
};
console.log('the app reader == the praxeolitic formula:',
  [dih1([1, 0, 0], [0, 0, 0], [0, 1, 0], [0, 1, 1]).toFixed(6),
    dihedralDeg([1, 0, 0], [0, 0, 0], [0, 1, 0], [0, 1, 1]).toFixed(6)].join(' vs '));

const f = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;

/* ── LE CONTRÔLE EXTERNE : un VRAI PDB du dépôt ─────────────────────────────── */
const atomsOf = (file) => {
  const byRes = new Map();
  String(readFileSync(file, 'utf8')).split(/\r?\n/).forEach((line) => {
    if (!/^(ATOM|HETATM)/.test(line)) return;
    const name = line.slice(12, 16).trim();
    const key = line.slice(17, 27);
    const p = [parseFloat(line.slice(30, 38)), parseFloat(line.slice(38, 46)), parseFloat(line.slice(46, 54))];
    if (p.some((v) => !Number.isFinite(v))) return;
    const r = byRes.get(key) || {};
    r[name] = p;
    byRes.set(key, r);
  });
  return [...byRes.values()];
};
const tpl = atomsOf('public/structures/template_amino_acid.pdb');
const withCb = tpl.find((r) => r.N && r.CA && r.C && r.CB);
console.log(`\n[template_amino_acid.pdb] ${tpl.length} residues`);
if (withCb) {
  console.log(`   REAL residue: N-CA-C-CB = ${f(dihedralDeg(withCb.N, withCb.CA, withCb.C, withCb.CB))}`
    + `   (this is an L-amino acid: the sign is the reference)`);
}

/* ── LA GÉOMÉTRIE CONSTRUITE ───────────────────────────────────────────────── */
const SEQ = 'AAAAAAAAAAAA';
for (const L of ['H', 'E', 'C']) {
  const ss = L.repeat(SEQ.length);
  const r = B.buildProteinBackbone(SEQ, ss);
  const phi = [];
  const psi = [];
  const omg = [];
  const cbc = [];
  for (let i = 0; i < r.length; i++) {
    if (i > 0) phi.push(dihedralDeg(r[i - 1].C, r[i].N, r[i].CA, r[i].C));
    if (i < r.length - 1) psi.push(dihedralDeg(r[i].N, r[i].CA, r[i].C, r[i + 1].N));
    if (i > 0) omg.push(dihedralDeg(r[i - 1].CA, r[i - 1].C, r[i].N, r[i].CA));
    if (r[i].CB) cbc.push(dihedralDeg(r[i].N, r[i].CA, r[i].C, r[i].CB));
  }
  const mid = (a) => a.slice(2, 5).map(f).join(' ');
  console.log(`\n[${L}] asked phi ${f(B.SS_TORSIONS[L].phi * 180 / Math.PI)} psi ${f(B.SS_TORSIONS[L].psi * 180 / Math.PI)}`);
  console.log(`   measured phi ${mid(phi)}   psi ${mid(psi)}   omega ${mid(omg)}`);
  console.log(`   measured N-CA-C-CB ${mid(cbc)}  (L-amino acid = ${withCb ? f(dihedralDeg(withCb.N, withCb.CA, withCb.C, withCb.CB)) : '?'})`);
}
