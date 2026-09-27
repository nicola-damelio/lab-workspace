// Probe: where are the ring plates built, and what refreshes them on a frame change?
import fs from 'fs';
const P = 'src/components/NMRMoleculeViewer.jsx';
const L = fs.readFileSync(P, 'utf8').split(/\r?\n/);
const out = [];
function scan(re, tag, max = 60) {
  out.push('');
  out.push('##### ' + tag);
  let n = 0;
  L.forEach((l, i) => { if (re.test(l)) { n++; if (n <= max) out.push((i + 1) + '| ' + l.trim().slice(0, 190)); } });
  out.push('(' + n + ' hits)');
}
scan(/plate/i, 'plate');
scan(/interior/i, 'interior');
scan(/nucleicRingPlates/i, 'nucleicRingPlates');
scan(/currentFrame|frameRef|setFrame\b|trajFrame/i, 'frame');
scan(/flagMeshShadows|addBufferRepresentation|MeshBuffer/i, 'mesh');
scan(/ringOpacity|ringTransparency|ringsFilled/i, 'ringOpacity');
fs.writeFileSync('_scan_plate.txt', out.join('\r\n'), 'utf8');
console.log('lines', out.length);
