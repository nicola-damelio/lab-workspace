// Sanity check for the CONECT generation in proteinSequenceToPdbText
// (src/components/NMRSections.jsx). Run: node _pdb_conect_sanity.cjs
const fs = require('fs');
const src = fs.readFileSync('src/components/NMRSections.jsx', 'utf8');
const out = [];

// Extract a `const NAME = ...;` block, stopping at the first `;` at brace depth 0.
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

const order = ['_vecSub', '_vecAdd', '_vecScale', '_vecDot', '_vecCross', '_vecNorm', '_vecNormalize', '_deg2rad', 'nerfPlace', '_padLeft', '_padRight', '_formatAtomName', '_fmtNum', 'pdbAtomLine', 'AA_1_TO_3', 'PROTEIN_BB', 'SS_TORSIONS', 'ssTorsionAt', '_ringClose', 'placeSidechainAtoms', 'buildProteinBackbone', 'proteinSequenceToPdbText'];
let code = '';
order.forEach((n) => { code += extract(n); });
const runner = new Function(code + '\nreturn proteinSequenceToPdbText;');
const proteinSequenceToPdbText = runner();

const seq = 'ACDEFGHIKLMNPQRSTVWY';
const pdb = proteinSequenceToPdbText(seq, '');
const lines = pdb.split(/\r?\n/);

const atoms = [];
const conect = [];
lines.forEach((l) => {
  const rec = l.slice(0, 6).trim();
  if (rec === 'ATOM' || rec === 'HETATM') atoms.push({ serial: parseInt(l.slice(6, 11), 10), name: l.slice(12, 16).trim(), resSeq: parseInt(l.slice(22, 26), 10) });
  else if (rec === 'CONECT') {
    const s = parseInt(l.slice(6, 11), 10);
    for (let i = 11; i + 5 <= l.length; i += 5) conect.push([s, parseInt(l.slice(i, i + 5), 10)]);
  }
});

out.push(`atoms=${atoms.length}  conectLines=${conect.length}`);
const serials = new Set(atoms.map((a) => a.serial));
const maxSerial = atoms.reduce((m, a) => Math.max(m, a.serial), 0);
let bad = 0;
conect.forEach(([a, b]) => { if (!serials.has(a) || !serials.has(b) || a === b) bad++; });
out.push(`maxSerial=${maxSerial} (atoms=${atoms.length}) — CONECT pairs referencing missing/self serials: ${bad}`);
out.push(`CONECT count (pairs): ${conect.length}`);

// Every atom should appear in at least one CONECT (no isolated atoms).
const covered = new Set();
conect.forEach(([a, b]) => { covered.add(a); covered.add(b); });
const isolated = atoms.filter((a) => !covered.has(a.serial));
out.push(`atoms with NO bond: ${isolated.length}${isolated.length ? ' → ' + isolated.slice(0, 8).map((a) => `${a.name}${a.resSeq}`).join(', ') : ''}`);

// Spot-check bonds: ALA(CB@1-HB1@1), peptide C@1-N@2, CYS(CB@1-SG@1) etc.
const serialOf = new Map();
atoms.forEach((a) => serialOf.set(`${a.name}@${a.resSeq}`, a.serial));
const pairSet = new Set(conect.map(([a, b]) => [a, b].sort((x, y) => x - y).join('|')));
const has = (aName, aRes, bName, bRes) => {
  const sa = serialOf.get(`${aName}@${aRes}`), sb = serialOf.get(`${bName}@${bRes}`);
  if (!sa || !sb) return `(missing serial ${aName}@${aRes}/${bName}@${bRes})`;
  return pairSet.has([sa, sb].sort((x, y) => x - y).join('|')) ? 'ok' : 'MISSING';
};
out.push(`ALA1 CB-HB1  : ${has('CB', 1, 'HB1', 1)}`);
out.push(`ALA1 CA-CB   : ${has('CA', 1, 'CB', 1)}`);
out.push(`peptide C1-N2: ${has('C', 1, 'N', 2)}`);
out.push(`CYS2 CB-SG   : ${has('CB', 2, 'SG', 2)}`);
out.push(`PHE5 CD1-HD1 : ${has('CD1', 5, 'HD1', 5)}`);
out.push(`HIS7 CG-ND1  : ${has('CG', 7, 'ND1', 7)}`);
out.push(`PRO13 CD-N   : ${has('CD', 13, 'N', 13)}`);
out.push(`TRP19 CE2-CD2: ${has('CE2', 19, 'CD2', 19)}`);
out.push(`TRP19 NE1-HE1: ${has('NE1', 19, 'HE1', 19)}`);
out.push(`TYR20 CZ-OH  : ${has('CZ', 20, 'OH', 20)}`);
out.push(`TYR20 OH-HH  : ${has('OH', 20, 'HH', 20)}`);

fs.writeFileSync('_pdb_conect_out.txt', out.join('\n'), 'utf8');
process.exit(bad === 0 && isolated.length === 0 ? 0 : 1);
