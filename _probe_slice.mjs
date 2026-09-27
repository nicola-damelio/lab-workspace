import fs from 'fs';
const src = fs.readFileSync('_probe_inv.txt', 'utf8').split(/\r?\n/);
// split the middle chunk (which the reader truncates) into 3 small files
const chunks = [[52, 100], [101, 150], [151, 200]];
chunks.forEach(([a, b], i) => {
  fs.writeFileSync(`_probe_slice${i + 1}.txt`, src.slice(a - 1, b).join('\n'), 'utf8');
});
console.log('ok', src.length);
