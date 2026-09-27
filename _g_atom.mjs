/* Scratch probe (throw-away): does an NGL AtomProxy allow writing x/y/z (needed to
   « bake » the poses of every molecule into the exported PDB, then restore)? */
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync('node_modules/ngl/dist/ngl.esm.js', 'utf8');
const out = [];
const at = src.indexOf(' as AtomProxy');
const before = src.slice(Math.max(0, at - 60), at);
const id = (before.match(/([A-Za-z_$][\w$]*)$/) || [])[1] || '';
out.push(`AtomProxy alias at ${at} · identifier ${id}`);
const def = src.indexOf(`class ${id}`);
out.push(`class at ${def}`);
if (def > 0) {
  const body = src.slice(def, def + 9000);
  out.push(body.slice(0, 4200).replace(/\n/g, ' '));
  out.push('--- setter probes ---');
  ['set x(', 'set y(', 'set z(', 'get x(', 'set position(', 'setPosition('].forEach((needle) => {
    out.push(`${needle} → ${body.indexOf(needle)}`);
  });
}
writeFileSync('_g_pdbw3.txt', out.join('\n') + '\n', 'utf8');
console.log('atomproxy probe written');
