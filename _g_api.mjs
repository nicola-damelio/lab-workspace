/* Scratch probe (throw-away): which NGL APIs can write coordinates back? */
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync('node_modules/ngl/dist/ngl.esm.js', 'utf8');
const out = [];
[' as Streamer', ' as Structure', 'setAtomData(', 'getAtomData(', 'setCoordinates(', 'positionFromArray'].forEach((n) => {
  const i = src.indexOf(n);
  out.push(`${JSON.stringify(n)} → ${i}`);
  if (i > 0) out.push('   ' + src.slice(Math.max(0, i - 260), i + 420).replace(/\n/g, ' '));
});
writeFileSync('_g_pdbw4.txt', out.join('\n') + '\n', 'utf8');
console.log('api probe written');
