/* Scanner de travail : `node _q_scan.mjs <fichier> <regex1> [regex2] [regex3]` →
   écrit les lignes qui matchent dans `_q_scan.txt` (numéro + ligne). */
import { readFileSync, writeFileSync } from 'node:fs';
const [file, ...pats] = process.argv.slice(2);
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const res = [...pats.map((p) => new RegExp(p))];
const out = [];
src.split('\n').forEach((line, i) => {
  if (res.some((re) => re.test(line))) out.push(`${i + 1}| ${line.trim().slice(0, 220)}`);
});
writeFileSync('_q_scan.txt', out.join('\n'), 'utf8');
console.log('matches=' + out.length);
