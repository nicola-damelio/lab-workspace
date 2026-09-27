// Probe 8: find the BASE Buffer.setAttributes via super.setAttributes callers.
import fs from 'fs';
const out = [];
const log = (...a) => out.push(a.join(' '));
const b = fs.readFileSync('node_modules/ngl/dist/ngl.esm.js', 'utf8');
log('super.setAttributes occurrences: ' + (b.split('super.setAttributes').length - 1));
let i = -1, n = 0;
while ((i = b.indexOf('super.setAttributes', i + 1)) !== -1 && n < 6) {
  n++;
  log('');
  log('--- @' + i);
  log(b.slice(Math.max(0, i - 300), i + 400).replace(/\n/g, ' '));
}
log('');
log('=== search for a generic body touching geometry.attributes by name ===');
const re = /setAttributes\(([a-zA-Z$_]+)=\{\}\)\{const ([a-zA-Z$_]+)=this\.geometry\.attributes/g;
let m;
while ((m = re.exec(b))) {
  log('');
  log('--- @' + m.index + ' param=' + m[1]);
  log(b.slice(m.index, m.index + 900).replace(/\n/g, ' '));
}
log('');
log('=== Buffer#update / makeAttributes base? ===');
for (const kw of ['updateAttributes(', 'setAttributes(t,e)', 'setAttributes(t)']) {
  log(kw + ': ' + (b.split(kw).length - 1));
}
fs.writeFileSync('_sp_nglbase.txt', out.join('\r\n'), 'utf8');
console.log('ok', out.length);
