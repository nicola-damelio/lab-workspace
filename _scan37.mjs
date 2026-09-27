/* _scan37.mjs — where does the live viewer rebuild things on a FRAME change? */
import { readFileSync, writeFileSync } from 'node:fs';

const file = 'src/components/NMRMoleculeViewer.jsx';
const L = readFileSync(file, 'utf8').split(/\r?\n/);
let out = `file lines: ${L.length}\n`;

const dump = (label, re, before = 0, after = 0) => {
  out += `\n########## ${label} ##########\n`;
  L.forEach((l, i) => {
    if (!re.test(l)) return;
    const from = Math.max(0, i - before);
    const to = Math.min(L.length, i + after + 1);
    out += L.slice(from, to).map((x, k) => `${from + 1 + k}| ${x}`).join('\n') + '\n';
  });
};

dump('buildSectionReps / addRingPlates / addPlates call sites', /buildSectionReps\s*\(|addRingPlates\s*\(|addPlates\s*\(/, 0, 0);
dump('currentFrame', /currentFrame/, 0, 0);
dump('requestSceneRepaint', /requestSceneRepaint/, 0, 0);
dump('effects whose dep array mentions frame', /^\s*\}\s*,\s*\[[^\]]*frame[^\]]*\]/, 0, 0);
writeFileSync('_live_scan37.txt', out);
console.log('_live_scan37.txt written', L.length);
