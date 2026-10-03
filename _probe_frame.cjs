// Probe: does a StructureComponent expose `currentFrame` in NGL 2.4?
const fs = require('fs');
const s = fs.readFileSync('node_modules/ngl/dist/ngl.js', 'utf8');
const out = [];
let i = -1;
let n = 0;
while ((i = s.indexOf('currentFrame', i + 1)) >= 0 && n < 30) {
  out.push('--- @' + i + ' :: ' + s.slice(Math.max(0, i - 110), i + 110).replace(/\n/g, ' '));
  n += 1;
}
fs.writeFileSync('_probe_frame_out.txt', out.join('\n'), 'utf8');
console.log('hits', n);
