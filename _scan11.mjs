import fs from 'fs';

const out = [];
const B = 'node_modules/ngl/dist/ngl.esm.js';

if (fs.existsSync(B)) {
  const b = fs.readFileSync(B, 'utf8');
  const count = (n) => (b.split(n).length - 1);

  out.push('### bundle counts ###');
  ['signals.refreshed.add', 'signals.refreshed', 'updateRepresentations',
   'BufferRepresentation', 'addBufferRepresentation', 'this.reprList',
   'representationAdded'].forEach((n) => out.push(`${n} :: ${count(n)}`));

  const around = (needle, before, after, max) => {
    const hits = [];
    let i = -1;
    while ((i = b.indexOf(needle, i + 1)) !== -1) hits.push(i);
    hits.slice(0, max).forEach((p) => {
      hits.push(0);
      out.push(`--- @${p} ---`);
      out.push(b.slice(Math.max(0, p - before), p + after).replace(/\s+/g, ' '));
    });
  };

  out.push('');
  out.push('### signals.refreshed.add ###');
  around('signals.refreshed.add', 120, 500, 4);

  out.push('');
  out.push('### updateRepresentations ###');
  around('updateRepresentations', 120, 350, 4);

  out.push('');
  out.push('### addBufferRepresentation ###');
  around('addBufferRepresentation', 60, 400, 3);
}

out.push('');
out.push('### _ngl_src files mentioning representation ###');
if (fs.existsSync('_ngl_src')) {
  fs.readdirSync('_ngl_src').filter((f) => /representation/i.test(f)).forEach((f) => out.push('  ' + f));
}

const R = '_ngl_src/representation__representation.ts';
if (fs.existsSync(R)) {
  out.push('');
  out.push('### representation.ts :: update / setParameters ###');
  fs.readFileSync(R, 'utf8').split(/\r?\n/).forEach((ln, i) => {
    if (/^\s{2}(update|setParameters|build|prepare)\s*\(/.test(ln) || /update\s*\(data/.test(ln)) {
      out.push(`${i + 1}| ${ln.slice(0, 160)}`);
    }
  });
}

fs.writeFileSync('_live_scan11.txt', out.join('\n'), 'utf8');
console.log('ok');
