// Sonde 4 : le VRAI lecteur de fichier d'NGL (FileReader / readAsText) et le résolveur nom/ext.
import { readFileSync } from 'node:fs';
const s = readFileSync('node_modules/ngl/dist/ngl.js', 'utf8');
const all = (needle) => {
  const out = [];
  let i = s.indexOf(needle);
  while (i !== -1) { out.push(i); i = s.indexOf(needle, i + 1); }
  return out;
};
for (const needle of ['readAsText', 'readAsDataURL', 'FileReader']) {
  console.log(`=== ${needle}: ${all(needle).join(', ')}`);
}
const hits = all('FileReader');
for (const h of hits) {
  console.log(`\n--- @${h} (context -700)\n${s.slice(h - 700, h + 500)}`);
}
console.log('\n=== rc (nom/ext) ===');
console.log(s.slice(s.indexOf('function rc('), s.indexOf('function rc(') + 700));
