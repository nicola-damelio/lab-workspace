// Sonde : le chargeur d'NGL accepte-t-il un Blob ? (et où NGL range `water`)
import { readFileSync, existsSync, statSync } from 'node:fs';

if (existsSync('_diag_helix_after.txt')) console.log('diag bytes', statSync('_diag_helix_after.txt').size);
else console.log('diag MISSING');

const p = 'node_modules/ngl/dist/ngl.js';
console.log('ngl dist exists', existsSync(p));
const s = readFileSync(p, 'utf8');
console.log('bytes', s.length, 'instanceof Blob:', (s.match(/instanceof Blob/g) || []).length);

const push = (tag, from, len) => {
  if (from < 0) { console.log(`--- ${tag}: NOT FOUND`); return; }
  console.log(`--- ${tag} @${from}\n${s.slice(from, from + len).replace(/\r?\n/g, '\n')}\n`);
};
push('loadFile', s.indexOf('loadFile( file, params'), 1100);
push('blob branches', s.indexOf('instanceof Blob'), 600);
push('pdb ext', s.indexOf("ext === 'pdb'"), 200);
push('water keyword', s.indexOf("{ name: 'water'"), 300);
push('water keyword2', s.indexOf("name: 'water'"), 300);
