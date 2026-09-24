// Temporary probe: list (and optionally dump) NGL 2.4 sources from its sourcemap.
const fs = require('fs');
const map = JSON.parse(fs.readFileSync('node_modules/ngl/dist/ngl.js.map', 'utf8'));
const outFile = 'C:/Users/nicol/AppData/Local/Temp/_srclist.txt';
const re = /buffer|group|scene|geometry|mesh|surface|shape|utils/i;
const out = map.sources.filter((s) => re.test(s));
fs.writeFileSync(outFile, out.join('\n') + '\n');
console.log('total', map.sources.length, 'matched', out.length);
