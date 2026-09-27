/* _scan34.mjs — the extraction harness of the rings test + nucleicRingPlates + setFrameSafe. */
import { readFileSync, writeFileSync } from 'node:fs';

const T = readFileSync('_viewer_rings_gradient_test.mjs', 'utf8').replace(/\r\n/g, '\n').split('\n');
const V = readFileSync('src/components/NMRMoleculeViewer.jsx', 'utf8').replace(/\r\n/g, '\n').split('\n');
let out = '';
const dump = (arr, from, to, label) => {
  out += `\n===== ${label} ${from}-${to} =====\n`;
  out += arr.slice(from - 1, to).map((l, i) => `${from + i}| ${l}`).join('\n') + '\n';
};
dump(T, 61, 101, 'rings test harness');
dump(V, 6108, 6127, 'setFrameSafe body');
dump(V, 4543, 4620, 'nucleicRingPlates');
writeFileSync('_live_scan34.txt', out);
console.log('_live_scan34.txt written');
