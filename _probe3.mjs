// Sonde 3 : le corps du lecteur d'NGL autour de la branche Blob.
import { readFileSync } from 'node:fs';
const s = readFileSync('node_modules/ngl/dist/ngl.js', 'utf8');
const at = s.indexOf('instanceof Blob');
console.log('blob index', at, 'of', s.length);
console.log(s.slice(at - 1500, at + 900));
