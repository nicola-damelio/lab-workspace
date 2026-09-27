/* Scratch probe (throw-away): what does NGL's PdbWriter really write?
   The minified dist keeps the export alias (« as PdbWriter »), so the class body
   can be located by string search — no bundler naming guesses. */
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync('node_modules/ngl/dist/ngl.esm.js', 'utf8');
const out = [];
for (const alias of ['PdbWriter', 'PdbParser']) {
  const at = src.indexOf(` as ${alias}`);
  out.push(`== ${alias}: alias at ${at}`);
  if (at < 0) continue;
  const before = src.slice(Math.max(0, at - 60), at);
  const id = (before.match(/([A-Za-z_$][\w$]*)$/) || [])[1] || '';
  out.push(`   identifier: ${id}`);
  const def = src.indexOf(`class ${id}`);
  out.push(`   class at ${def}`);
  if (def > 0) out.push(src.slice(def, def + 2600).replace(/\n/g, ' '));
}
// The reader of a coordinate: does PdbWriter use .x/.y/.z (untransformed) or .position?
const atomData = src.indexOf('ATOM  ');
out.push(`== "ATOM  " literal at ${atomData}`);
writeFileSync('_g_pdbw.txt', out.join('\n') + '\n', 'utf8');
console.log(`writer probe written (${out.length} lines)`);
