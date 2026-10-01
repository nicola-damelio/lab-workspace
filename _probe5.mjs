// Sonde 5 : l'entrée du chargeur d'NGL (ac) — comment le lecteur est choisi (texte/binaire) et
// comment le PARSEUR est choisi à partir de `params.ext`.
import { readFileSync } from 'node:fs';
const s = readFileSync('node_modules/ngl/dist/ngl.js', 'utf8');
for (const needle of ['function ac(', 'ParserLoader']) {
  const i = s.indexOf(needle);
  console.log(`=== ${needle} @${i}`);
  if (i >= 0) console.log(s.slice(i, i + 1500));
  console.log('');
}
const j = s.indexOf('isTrajectory');
console.log('=== isTrajectory @', j, '\n', s.slice(j - 200, j + 400));
