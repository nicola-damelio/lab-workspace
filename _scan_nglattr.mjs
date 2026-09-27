// Probe 5: Buffer.setAttributes / initIndex bodies, addBufferRepresentation, and
// the buildCategoryReps call sites in the viewer.
import fs from 'fs';
const out = [];
const log = (...a) => out.push(a.join(' '));
const b = fs.readFileSync('node_modules/ngl/dist/ngl.esm.js', 'utf8');
function dump(kw, before, after, max = 3) {
  log('');
  log('################ ' + kw);
  let i = -1, n = 0;
  while ((i = b.indexOf(kw, i + 1)) !== -1 && n < max) {
    n++;
    log('@' + i + ': ' + b.slice(Math.max(0, i - before), i + after).replace(/\n/g, ' '));
  }
  log('(' + (b.split(kw).length - 1) + ' total)');
}
dump('setAttributes(t={})', 60, 900);
dump('initIndex(', 40, 500);
dump('addBufferRepresentation(', 60, 500);
dump('_addBufferRepresentation', 60, 400);
log('');
log('################ viewer: buildCategoryReps / rebuildSectionsOf / addPlates');
const L = fs.readFileSync('src/components/NMRMoleculeViewer.jsx', 'utf8').split(/\r?\n/);
for (const re of [/buildCategoryReps/, /rebuildSectionsOf/, /sectionRepsOf|buildSectionReps/]) {
  log('--- ' + re);
  L.forEach((l, i) => { if (re.test(l)) log((i + 1) + '| ' + l.trim().slice(0, 170)); });
}
fs.writeFileSync('_sp_nglattr.txt', out.join('\r\n'), 'utf8');
console.log('ok', out.length);
