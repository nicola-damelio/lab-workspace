// Probe 7: keep only setAttributes bodies that look like the BASE class (generic).
import fs from 'fs';
const txt = fs.readFileSync('_sp_nglset.txt', 'utf8').split(/\r?\n/);
const blocks = [];
let cur = null;
txt.forEach((l) => {
  if (/^--- #/.test(l)) { if (cur) blocks.push(cur); cur = [l]; }
  else if (cur) cur.push(l);
});
if (cur) blocks.push(cur);
const out = [];
blocks.forEach((blk) => {
  const body = blk.join('\n');
  const generic = /this\.geometry\.attributes/.test(body)
    && !/radialSegments|fontFamily|mappingSize|aspectRatio|this\.text\b/.test(body);
  out.push((generic ? '*** GENERIC *** ' : '    subclass    ') + blk[0] + ' [' + body.length + ']');
  if (generic) out.push(body.slice(0, 1800));
});
out.push('');
out.push('===== hasRepresentation lines =====');
txt.forEach((l) => { if (/^\d+\|/.test(l)) out.push(l); });
fs.writeFileSync('_sp_nglset2.txt', out.join('\r\n'), 'utf8');
console.log('blocks', blocks.length);
