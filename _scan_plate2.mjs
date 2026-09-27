// Probe 2: interior / frame-change wiring, one output file per topic.
import fs from 'fs';
const P = 'src/components/NMRMoleculeViewer.jsx';
const L = fs.readFileSync(P, 'utf8').split(/\r?\n/);
function scan(re, out, max = 120) {
  let n = 0;
  L.forEach((l, i) => { if (re.test(l)) { n++; if (n <= max) out.push((i + 1) + '| ' + l.trim().slice(0, 200)); } });
  out.push('(' + n + ' hits)');
}
const A = [], B = [], C = [], D = [];
scan(/interior/i, A);
scan(/currentFrame|frameRef|setFrame\b|trajFrame|onFrameChange|frameChanged/i, B);
scan(/\bplates?\b/i, C);
scan(/ringOpacity|keepFrames|nucleicRingPlates|ringOutline|outline/i, D);
fs.writeFileSync('_sp_interior.txt', A.join('\r\n'), 'utf8');
fs.writeFileSync('_sp_frame.txt', B.join('\r\n'), 'utf8');
fs.writeFileSync('_sp_plates.txt', C.join('\r\n'), 'utf8');
fs.writeFileSync('_sp_ring.txt', D.join('\r\n'), 'utf8');
console.log('ok', A.length, B.length, C.length, D.length);
