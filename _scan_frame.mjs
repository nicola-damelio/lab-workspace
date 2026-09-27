// Probe 15: the frame-change path with context.
import fs from 'fs';
const src = fs.readFileSync('src/components/NMRMoleculeViewer.jsx', 'utf8').split(/\r?\n/);
const pats = [
  /frameChanged/,
  /updatePosition/,
  /plates/i,
  /nucleicRingPlates/,
  /flagMeshShadows/,
  /structure\.signals/,
];
const out = [];
out.push('TOTAL ' + src.length);
for (const re of pats) {
  out.push('');
  out.push('=== ' + re + ' ===');
  let n = 0;
  for (let i = 0; i < src.length; i += 1) {
    if (!re.test(src[i])) continue;
    n += 1;
    if (n > 24) break;
    // only print matches from the component body (line > 6570)
    if (i + 1 < 6570) continue;
    out.push('--- line ' + (i + 1) + ' ---');
    for (let k = Math.max(0, i - 4); k <= Math.min(src.length - 1, i + 6); k += 1) {
      out.push((k + 1) + '|' + src[k]);
    }
  }
  out.push('(' + n + ' matches)');
}
fs.writeFileSync('_t_frame.txt', out.join('\r\n'), 'utf8');
console.log('ok', out.length);
