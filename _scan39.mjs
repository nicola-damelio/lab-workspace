/* _scan39.mjs — live viewer: the row/plate rebuild effect vs. trajectory frames. */
import { readFileSync, writeFileSync } from 'node:fs';

const f = 'src/components/NMRMoleculeViewer.jsx';
const lines = readFileSync(f, 'utf8').replace(/\r\n/g, '\n').split('\n');
let out = `viewer lines: ${lines.length}\n`;

const dump = (re, title, before, after) => {
  out += `\n########## ${title} (${re}) ##########\n`;
  lines.forEach((l, i) => {
    if (!re.test(l)) return;
    const s = Math.max(0, i - before);
    const e = Math.min(lines.length, i + after + 1);
    out += `\n--- @${i + 1}\n`;
    for (let k = s; k < e; k += 1) out += `${k + 1}| ${lines[k]}\n`;
  });
};

dump(/buildSectionReps\(/, 'buildSectionReps call sites', 24, 24);
dump(/setFrameSafe/, 'setFrameSafe', 12, 30);
dump(/handleFrameChange/, 'handleFrameChange', 10, 40);
dump(/currentFrame/, 'currentFrame', 2, 2);
writeFileSync('_live_scan39.txt', out);
console.log('_live_scan39.txt', lines.length);
