/* Dump brut de messages précis d'une session Cline.
   Usage: node _resume_msg.mjs <fichier.messages.json> i1 i2 i3 ... */
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
const idxs = process.argv.slice(3).map(Number);
const data = JSON.parse(readFileSync(file, 'utf8'));
const list = Array.isArray(data) ? data : data.messages;
const out = [];
for (const i of idxs) {
  const m = list[i];
  if (!m) { out.push(`##### #${i} ABSENT`); continue; }
  out.push(`\n##### #${i} role=${m.role} ts=${m.ts} #####\n${JSON.stringify(m.content, null, 2)}`);
}
writeFileSync('_resume_msg.txt', out.join('\n'), 'utf8');
console.log('wrote _resume_msg.txt');
