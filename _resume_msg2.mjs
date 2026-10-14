/* Un fichier par message. Usage: node _resume_msg2.mjs <fichier> i1 i2 ... */
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
const idxs = process.argv.slice(3).map(Number);
const data = JSON.parse(readFileSync(file, 'utf8'));
const list = Array.isArray(data) ? data : data.messages;
for (const i of idxs) {
  const m = list[i];
  if (!m) continue;
  writeFileSync(`_resume_msg_${i}.txt`, JSON.stringify(m.content, null, 2), 'utf8');
}
console.log('done ' + idxs.join(','));
