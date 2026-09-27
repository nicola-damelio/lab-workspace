// Probe NGL trajectory -> structure update path (ASCII out).
import fs from 'fs';
const out = [];
const log = (...a) => out.push(a.join(' '));
const b = fs.readFileSync('node_modules/ngl/dist/ngl.esm.js', 'utf8');

log('ngl.esm.js chars: ' + b.length);
let i = -1, n = 0;
while ((i = b.indexOf('_updateStructure', i + 1)) !== -1) {
  n++;
  log('');
  log('=== _updateStructure hit #' + n + ' @' + i + ' ===');
  log(b.slice(i, i + 1400));
  if (n > 8) break;
}

log('');
log('=== occurrences of "updateStructure" (no underscore) ===');
let j = -1, m = 0;
while ((j = b.indexOf('updateStructure', j + 1)) !== -1 && m < 12) {
  if (b[j - 1] !== '_') { m++; log('@' + j + ': ' + b.slice(Math.max(0, j - 160), j + 200).replace(/\n/g, ' ')); }
}

log('');
log('=== does Buffer/MeshBuffer have a frames/update path? ===');
for (const key of ['updateFrame', 'hasFrame', 'frameChanged', 'setFrameInterpolated', 'applyMatrix']) {
  log(key + ': ' + (b.split(key).length - 1) + ' occurrences');
}

fs.writeFileSync('_ngl_updatebody.txt', out.join('\n'), 'utf8');
console.log('wrote _ngl_updatebody.txt (' + out.length + ')');
