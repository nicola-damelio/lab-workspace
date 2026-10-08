/* Cherche un motif dans tous les .js/.jsx de src (grep fiable, le tool étant
   capricieux). TEMPORAIRE. */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

const pattern = new RegExp(process.argv[2], 'i');
const out = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = `${dir}/${name}`;
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.(js|jsx)$/.test(name)) continue;
    readFileSync(p, 'utf8').split(/\r?\n/).forEach((l, i) => {
      if (pattern.test(l)) out.push(`${p}:${i + 1}: ${l.trim().slice(0, 140)}`);
    });
  }
};
walk('src');
writeFileSync(process.argv[3] || 'tmp_grep2.txt', out.join('\n') || '(none)', 'utf8');
console.log(`${out.length} lignes`);
