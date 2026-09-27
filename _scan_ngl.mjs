// Temporary probe: print windows around frame-update API calls in the NGL bundle.
import fs from 'fs';

const s = fs.readFileSync('node_modules/ngl/dist/ngl.esm.js', 'utf8');
const needles = process.argv.slice(2);

for (const needle of needles) {
  let i = -1;
  let n = 0;
  console.log('##### needle:', needle, ' total length', s.length);
  while ((i = s.indexOf(needle, i + 1)) >= 0) {
    console.log(`--- @${i}`);
    console.log(s.slice(Math.max(0, i - 600), i + 600).replace(/\n/g, '\\n'));
    if (++n > 4) break;
  }
}
