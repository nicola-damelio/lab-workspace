/* _scan30.mjs — the plate call sites + the frame plumbing of the live viewer. */
import { readFileSync, writeFileSync } from 'node:fs';

const VIEW = readFileSync('src/components/NMRMoleculeViewer.jsx', 'utf8').replace(/\r\n/g, '\n');
const L = VIEW.split('\n');
let out = '';
const pick = (from, to, label) => {
  out += `\n===== ${label} (${from}-${to}) =====\n`;
  out += L.slice(from - 1, to).map((l, i) => `${from + i}| ${l}`).join('\n') + '\n';
};
pick(9340, 9385, 'plates call 9356');
pick(9660, 9700, 'plates call 9674');
pick(11630, 11700, 'plates call 11646 + effect 11685');
pick(9940, 9990, 'applyCurrentStyleTo / rebuildSectionsOf');
pick(11740, 11770, 'sectionCatalog effect');
pick(235, 300, 'CLAUDE / headers? (skip)');

for (const re of [/addBufferRepresentation/g, /nucleicRingPlates/g, /setFrameSafe/g, /refreshed/g,
  /frameChanged/g, /signals\./g, /toActualFrame/g, /handleFrame/g, /applyCurrentStyleTo/g]) {
  out += `\n===== grep ${re.source} =====\n`;
  L.forEach((l, i) => { if (re.test(l)) { re.lastIndex = 0; out += `${i + 1}| ${l.trim()}\n`; } });
}
writeFileSync('_live_scan30.txt', out);
console.log('_live_scan30.txt written');
