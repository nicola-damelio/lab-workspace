/* _scan38.mjs — tests in the suite that talk about ring PLATES and/or FRAMES. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const files = readdirSync('.').filter((f) => f.endsWith('_test.mjs'));
let out = `test files: ${files.length}\n`;
for (const f of files) {
  const t = readFileSync(f, 'utf8');
  const lines = t.split(/\r?\n/);
  const hits = [];
  lines.forEach((l, i) => { if (/plate/i.test(l)) hits.push(i); });
  const frameHits = [];
  lines.forEach((l, i) => { if (/\bframe|currentFrame|setFrame/i.test(l)) frameHits.push(i); });
  if (hits.length === 0) continue;
  out += `\n########## ${f}  (plate lines: ${hits.length}, frame lines: ${frameHits.length}) ##########\n`;
  hits.forEach((i) => { out += `${i + 1}| ${lines[i]}\n`; });
  if (frameHits.length) {
    out += `--- frame lines ---\n`;
    frameHits.forEach((i) => { out += `${i + 1}| ${lines[i]}\n`; });
  }
}
writeFileSync('_live_scan38.txt', out);
console.log('_live_scan38.txt written', files.length);
