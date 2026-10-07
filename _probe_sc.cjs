const fs = require('fs');
const lines = fs.readFileSync('src/utils/sequenceCharge.js', 'utf8').split(/\r?\n/);
const out = [];
for (let i = 255; i < 290; i += 1) out.push((i + 1) + '| ' + JSON.stringify(lines[i]));
fs.writeFileSync('_probe_sc.txt', out.join('\n'), 'utf8');
console.log('ok');
