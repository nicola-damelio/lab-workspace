const fs = require('fs');
const src = fs.readFileSync('src/components/NMRMoleculeViewer.jsx', 'utf8');
// La RÈGLE de découpe vit dans son module (src/utils/viewerMoleculeParts.js), partagé
// avec la lecture d'une structure chargée par NGL : on la lui passe. Les DEUX fonctions
// du composant qui la portent (la lecture du texte et la fabrique d'entités) sont
// extraites telles quelles — c'est ELLES que la sonde met à l'épreuve.
const sliceFn = (marker) => {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error('introuvable: ' + marker);
  let depth = 0, end = at;
  for (let i = at + marker.length - 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) { end = i + 1; break; } }
  }
  return src.slice(at, end) + ';';
};
const fnText = sliceFn('const splitPdbFileIntoMolecules = async (file) => {');
const namedText = sliceFn('const namedPartsOf = (atoms, bonds, modelCount = 1) => {');
const RULE = require('./src/utils/viewerMoleculeParts.js');
const splitPdbFileIntoMolecules = eval('(function (fragmentMolecules, moleculePartNames, pdbTextForMolecule) { '
  + namedText + '\n' + fnText + '\nreturn splitPdbFileIntoMolecules; })'
)(RULE.fragmentMolecules, RULE.moleculePartNames, RULE.pdbTextForMolecule);
// Correct PDB columns: x at 30, y at 38, z at 46, chain at 21.
const line = (serial, name, chain, x, y, z, el) => 'ATOM  ' + String(serial).padStart(5) + ' ' + name.padEnd(4) + ' ALA ' + chain + String(1).padStart(4) + ' ' + '   ' + x.toFixed(3).padStart(8) + y.toFixed(3).padStart(8) + z.toFixed(3).padStart(8) + '  1.00  0.00           ' + el;
const l = line(1, 'N', 'A', 0, 0, 0, 'N');
console.log('x idx30:', JSON.stringify(l.slice(30,38)), parseFloat(l.slice(30,38)), '| chain:', JSON.stringify(l.slice(21,22)));
const lines = [];
lines.push(line(1, 'N',  'A', 0.0, 0, 0, 'N'));
lines.push(line(2, 'CA', 'A', 1.5, 0, 0, 'C'));
lines.push(line(3, 'C',  'A', 3.0, 0, 0, 'C'));
lines.push(line(4, 'N',  'B', 3.7, 0, 0, 'N'));   // 0.7 Å from A3 → chains in contact (would merge without the chain split)
lines.push(line(5, 'CA', 'B', 5.2, 0, 0, 'C'));
lines.push('END');
(async () => {
  const parts = await splitPdbFileIntoMolecules(new Blob([lines.join('\n')]));
  console.log('parts:', parts.length);
  parts.forEach((p, i) => console.log(`  part ${i + 1}: chain=${p.chainId || '(blank)'} model=${p.model}`));
  const ok = parts.length === 2 && parts[0].chainId === 'A' && parts[1].chainId === 'B';
  console.log('RESULT:', ok ? 'PASS (two chains separated, contacts do not merge them)' : 'FAIL');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
