/* _scan36.mjs — NGL: base update/build/make, and who listens to `refreshed`. */
import { readFileSync, writeFileSync } from 'node:fs';

let out = '';
const read = (f) => readFileSync(`_ngl_src/${f}`, 'utf8').split('\n');

const rep = read('representation__representation.ts');
out += '===== representation.ts: update / build / make =====\n';
rep.forEach((l, i) => {
  if (/^\s{2}(update|build|make|init|attach|setVisibility|create)\s?\(/.test(l)) {
    out += `\n--- ${i + 1} ---\n`;
    out += rep.slice(i, i + 26).map((x, k) => `${i + 1 + k}| ${x}`).join('\n') + '\n';
  }
});

for (const f of ['component__structure-component.ts', 'representation__structure-representation.ts', 'component__component.ts']) {
  const L = read(f);
  out += `\n\n===== ${f}: refreshed / update / addRepresentation =====\n`;
  const hits = [];
  L.forEach((l, i) => { if (/refreshed|updateRepresentations|addRepresentation|representationAdded|\.update\(/.test(l)) hits.push(i); });
  let last = -10;
  hits.forEach((i) => {
    const from = Math.max(0, i - 3);
    if (from <= last) return;
    last = i + 6;
    out += `\n--- around ${i + 1} ---\n`;
    out += L.slice(from, i + 7).map((x, k) => `${from + 1 + k}| ${x}`).join('\n') + '\n';
  });
}
writeFileSync('_live_scan36.txt', out);
console.log('_live_scan36.txt written');
