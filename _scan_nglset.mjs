// Probe 6: the BASE Buffer.setAttributes implementation + Component.hasRepresentation.
import fs from 'fs';
const out = [];
const log = (...a) => out.push(a.join(' '));
const b = fs.readFileSync('node_modules/ngl/dist/ngl.esm.js', 'utf8');
log('total setAttributes occurrences: ' + (b.split('setAttributes').length - 1));
let i = -1, n = 0;
while ((i = b.indexOf('setAttributes(', i + 1)) !== -1) {
  n++;
  log('');
  log('--- #' + n + ' @' + i);
  log(b.slice(Math.max(0, i - 260), i + 620).replace(/\n/g, ' '));
}
log('');
log('=== hasRepresentation in the declarations ===');
try {
  const d = fs.readFileSync('node_modules/ngl/dist/declarations/component/component.d.ts', 'utf8');
  d.split(/\r?\n/).forEach((l, k) => { if (/hasRepresentation|reprList|representationList|addBufferRepresentation/.test(l)) log((k + 1) + '| ' + l.trim()); });
} catch (e) { log('MISSING component.d.ts ' + e.message); }
fs.writeFileSync('_sp_nglset.txt', out.join('\r\n'), 'utf8');
console.log('ok', out.length);
