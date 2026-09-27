// Probe 4: NGL Buffer / MeshBuffer API that could refresh vertices in place.
import fs from 'fs';
const out = [];
const log = (...a) => out.push(a.join(' '));
const has = (p) => { try { fs.statSync(p); return true; } catch { return false } };
for (const p of [
  'node_modules/ngl/dist/declarations/buffer/buffer.d.ts',
  'node_modules/ngl/dist/declarations/buffer/mesh-buffer.d.ts',
  'node_modules/ngl/dist/declarations/buffer/surface-buffer.d.ts',
  'node_modules/ngl/dist/declarations/representation/buffer-representation.d.ts',
]) log(p + '  ' + has(p));
log('');
const b = fs.readFileSync('node_modules/ngl/dist/ngl.esm.js', 'utf8');
for (const kw of ['setParameters', 'updateAttributes', 'applyMatrix', 'makeAttributes', 'attributesChanged']) {
  let i = -1, n = 0;
  log('=== ' + kw + ' ===');
  while ((i = b.indexOf(kw, i + 1)) !== -1 && n < 4) {
    n++;
    log('@' + i + ': ' + b.slice(Math.max(0, i - 120), i + 200).replace(/\n/g, ' '));
  }
  log('(' + (b.split(kw).length - 1) + ' total)');
  log('');
}
fs.writeFileSync('_sp_nglapi.txt', out.join('\r\n'), 'utf8');
console.log('ok', out.length);
