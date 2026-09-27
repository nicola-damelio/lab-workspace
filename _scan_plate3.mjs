// Probe 3: where the plate builders are CALLED, and the effects that own them.
import fs from 'fs';
const P = 'src/components/NMRMoleculeViewer.jsx';
const L = fs.readFileSync(P, 'utf8').split(/\r?\n/);
const out = [];
function scan(re, tag, max = 80) {
  out.push('');
  out.push('##### ' + tag);
  let n = 0;
  L.forEach((l, i) => { if (re.test(l)) { n++; if (n <= max) out.push((i + 1) + '| ' + l.trim().slice(0, 200)); } });
  out.push('(' + n + ' hits)');
}
scan(/addPlates\(|addRingPlates\(/, 'addPlates calls');
scan(/buildSectionReps\(|rebuildSectionsOf\(|applyCurrentStyleTo/, 'buildSectionReps calls');
scan(/requestSceneRepaint|bumpSectionEpoch/, 'repaint');
scan(/\.removeRepresentation\(|removeAllRepresentations/, 'removals');
fs.writeFileSync('_sp_calls.txt', out.join('\r\n'), 'utf8');
console.log('lines', out.length);
