// Probe 9: base Buffer class – dump every method name inside it (look for setAttributes).
import fs from 'fs';
const out = [];
const log = (...a) => out.push(a.join(' '));
const b = fs.readFileSync('node_modules/ngl/dist/ngl.esm.js', 'utf8');
const idx = [];
let i = -1;
while ((i = b.indexOf('setAttributes', i + 1)) !== -1) idx.push(i);
log('all indices: ' + idx.join(','));
log('');
// The base Buffer class sits around 193000-196500 (size/attributeSize getters @193881).
const near = idx.filter((x) => x > 190000 && x < 199000);
log('indices in [190000,199000]: ' + near.join(','));
near.forEach((x) => {
  log('');
  log('--- @' + x);
  log(b.slice(x - 120, x + 520).replace(/\n/g, ' '));
});
log('');
log('=== class body window @191500-197200: method names ===');
const win = b.slice(191500, 197200);
const names = [...win.matchAll(/([a-zA-Z_$][\w$]*)\(([^)]*)\)\{/g)].map((m) => m[1]);
log(names.join(' | '));
fs.writeFileSync('_sp_nglbase2.txt', out.join('\r\n'), 'utf8');
console.log('ok', out.length, near.length);
