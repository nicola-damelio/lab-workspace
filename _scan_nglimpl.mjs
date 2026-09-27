// Probe 17: NGL's own Buffer.setAttributes + BufferRepresentation.setBuffer, straight from the shipped bundle.
import fs from 'fs';
const files = ['node_modules/ngl/dist/ngl.js', 'node_modules/ngl/dist/ngl.esm.js'];
const out = [];
for (const f of files) {
  if (!fs.existsSync(f)) { out.push('MISSING ' + f); continue; }
  const src = fs.readFileSync(f, 'utf8');
  out.push('=== ' + f + ' (' + src.length + ' bytes) ===');
  const lines = src.split(/\r?\n/);
  out.push('lines: ' + lines.length);
  const want = [/setAttributes\s*\(/, /setBuffer\s*\(/, /updateRange/, /class BufferRepresentation/, /addBufferRepresentation\s*\(/];
  for (const re of want) {
    out.push('');
    out.push('--- ' + re + ' ---');
    let n = 0;
    lines.forEach((l, i) => {
      if (re.test(l) && n < 6) {
        n += 1;
        out.push('@' + (i + 1) + ' ' + src.split(/\r?\n/).slice(Math.max(0, i - 2), i + 3).join(' ⏎ ').slice(0, 400));
      }
    });
    out.push('(' + n + ' shown)');
  }
}
fs.writeFileSync('_t_nglimpl.txt', out.join('\r\n'), 'utf8');
console.log('ok', out.length);
