/* _scan33.mjs — the frame/section coupling comments and setFrameSafe. */
import { readFileSync, writeFileSync } from 'node:fs';

const VIEW = readFileSync('src/components/NMRMoleculeViewer.jsx', 'utf8').replace(/\r\n/g, '\n');
const L = VIEW.split('\n');
let out = '';
const dump = (from, to, label) => {
  out += `\n===== ${label} ${from}-${to} =====\n`;
  out += L.slice(from - 1, to).map((l, i) => `${from + i}| ${l}`).join('\n') + '\n';
};
dump(7130, 7200, 'the frame asked for by the section rebuild');
dump(9695, 9770, 'addRingPlates end + use');
dump(6095, 6140, 'setFrameSafe');
dump(11695, 11740, 'shader uniforms / rebuild frame');
writeFileSync('_live_scan33.txt', out);
console.log('_live_scan33.txt written');
