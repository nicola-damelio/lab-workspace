// Probe #8: (A) NGL "refreshed" signal consumers; (B) viewer wiring around frames + plates.
import fs from 'fs';
const out = [];
const log = (...a) => out.push(a.join(' '));
const ascii = (s) => s.replace(/[^\x20-\x7E]/g, '\u00b7');

const ngl = fs.readFileSync('node_modules/ngl/dist/ngl.esm.js', 'utf8');
log('########## A. NGL: who listens to structure.signals.refreshed ##########');
let i = -1, n = 0;
while ((i = ngl.indexOf('refreshed.add(', i + 1)) !== -1 && n < 12) {
  n++;
  log('--- @' + i + '\n' + ascii(ngl.slice(Math.max(0, i - 420), i + 420)).replace(/\n/g, ' | '));
}
log('refreshed.dispatch: ' + (ngl.split('refreshed.dispatch').length - 1) + ' | refreshed.add: ' + (ngl.split('refreshed.add').length - 1));

log('');
log('########## B. viewer: frame handling + plate/buffer wiring ##########');
const V = fs.readFileSync('src/components/NMRMoleculeViewer.jsx', 'utf8').split(/\r?\n/);
const PATS = [
  ['frame', /frameChanged|currentFrame|setFrameSafe|handleFrameChange|keptFrames|togglePlay|trajectory/],
  ['plate', /ringPlate|nucleicRingPlates|plate|stylized|Stylized/i],
  ['buffer/geometry', /BufferRepresentation|MeshBuffer|addBufferRepresentation|\.buffer\b|geometry\.attributes|needsUpdate|buffer\.update/],
  ['setParameters', /setParameters/],
  ['rep refs', /repRefs|repRef|baseReps|sectionReps|repsRef/],
];
for (const [name, re] of PATS) {
  log('');
  log('--- ' + name);
  V.forEach((l, idx) => {
    if (re.test(l)) log('  ' + (idx + 1) + '| ' + ascii(l.trim()).slice(0, 165));
  });
}
fs.writeFileSync('_frame_plate8.txt', out.join('\n'), 'utf8');
console.log('wrote _frame_plate8.txt (' + out.length + ')');
