/* Scratch probe (throw-away): do the changes of this session really SHIP?
   The viewer lives in its OWN lazy chunk (auto-*.js), never index-*.js — the chunk is
   found by scanning dist/assets, never by hard-coding a hash (it changes every build). */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';

const files = readdirSync('dist/assets').filter((f) => f.endsWith('.js'));
const needles = [
  'not hydrogen',
  'Hide every hydrogen of EVERY molecule shown here',
  '★ main: ',
  'the arrangement on screen written into the coordinates',
  'REMARK 350 MOLECULE ',
  'beforeCapture',
  '🧪 Kept for ',
  'kept for ${', // the restored-session log line, built from the same label
];
const out = []; 
let missing = 0;
for (const n of needles) {
  const holders = files.filter((f) => readFileSync(`dist/assets/${f}`, 'utf8').includes(n));
  if (!holders.length) missing += 1;
  out.push(`${holders.length ? 'OK ' : 'MISS'} ${JSON.stringify(n)} -> ${holders.join(', ') || '(nowhere)'}`);
}
const sizes = files.map((f) => `${f} ${statSync(`dist/assets/${f}`).size}`).sort();
out.push(`--- chunks ---`);
out.push(sizes.join('\n'));
writeFileSync('_g_dist.txt', out.join('\n') + '\n', 'utf8');
console.log(`dist probe: missing=${missing}`);
