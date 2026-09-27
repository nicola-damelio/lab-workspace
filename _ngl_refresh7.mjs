// Probe #7: does NGL refresh representations (incl. MeshBuffer/BufferRepresentation) when a
// trajectory changes the frame? ASCII-only output. Reads the bundled NGL sources in _ngl_src.
import fs from 'fs';
import path from 'path';
const out = [];
const log = (...a) => out.push(a.join(' '));
const ascii = (s) => s.replace(/[^\x20-\x7E]/g, '\u00b7');

const FILES = ['node_modules/ngl/dist/ngl.esm.js'];
log('ngl files: ' + FILES.length);
const CONTENTS = new Map(FILES.map((f) => [f, fs.readFileSync(f, 'utf8')]));

function findBodies(re, ctx, tag) {
  log('');
  log('########## ' + tag + ' ##########');
  let n = 0;
  for (const [f, src] of CONTENTS) {
    let m;
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    while ((m = r.exec(src))) {
      n++;
      if (n > 14) break;
      log('--- ' + f + ' @' + m.index);
      log(ascii(src.slice(Math.max(0, m.index - 80), m.index + ctx)).replace(/\n/g, ' | '));
    }
  }
  log('(' + n + ' hits)');
}

findBodies(/updatePosition\s*\(/, 700, '1. structure.updatePosition (body: does it signal reps?)');
findBodies(/frameChanged\.add\(/, 260, '2. frameChanged listeners');
findBodies(/setFrame\s*\(frame/, 500, '3. trajectory.setFrame / _updateStructure');
findBodies(/class Buffer\b/, 200, '4. class Buffer');
findBodies(/(setParameters|applyMatrix|updateAttributes|setAttributes)\s*\(params|setParameters\s*\(data/, 400, '5. Buffer.setParameters / applyMatrix');
findBodies(/getAtomData|getBondData/, 200, '6. getAtomData (copy vs view)');

log('');
log('########## 7. Buffer representation class ##########');
for (const [f, src] of CONTENTS) {
  for (const name of ['BufferRepresentation', 'MeshBuffer']) {
    const i = src.indexOf('class ' + name);
    if (i >= 0) log('--- ' + name + ' in ' + f + ' @' + i + '\n' + ascii(src.slice(i, i + 900)).replace(/\n/g, ' | '));
  }
}

log('');
log('########## 8. per-atom refreshability keywords ##########');
for (const kw of ['updatePosition', 'updateStructure', 'frameChanged', 'setFrame', 'attributesChanged', 'needsUpdate', 'buffer.update', 'this.update(', '.update()']) {
  let count = 0;
  for (const [, src] of CONTENTS) count += (src.split(kw).length - 1);
  log('  ' + kw.padEnd(20) + ' ' + count);
}

fs.writeFileSync('_ngl_refresh7.txt', out.join('\n'), 'utf8');
console.log('wrote _ngl_refresh7.txt (' + out.length + ')');
