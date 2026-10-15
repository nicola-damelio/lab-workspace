/* Tous les messages HUMAINS d'une session Cline (pour retrouver la demande mot pour mot).
   Usage: node _resume_human2.mjs <fichier.messages.json> <sortie.txt> [maxChars] */
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
const outFile = process.argv[3] || '_resume_human2.txt';
const maxChars = Number(process.argv[4] || 4000);
const data = JSON.parse(readFileSync(file, 'utf8'));
const list = Array.isArray(data) ? data : data.messages;

const humanText = (m) => {
  const c = m.content;
  const parts = Array.isArray(c) ? c : [c];
  const txt = [];
  for (const p of parts) {
    if (!p || typeof p !== 'object') { if (typeof p === 'string') txt.push(p); continue; }
    if (p.type === 'text' && typeof p.text === 'string') txt.push(p.text);
  }
  return txt.join('\n').trim();
};

const out = [`total messages: ${list.length}`];
list.forEach((m, i) => {
  if (m.role !== 'user') return;
  const t = humanText(m);
  if (!t) return;
  out.push(`\n########## HUMAN #${i} (ts ${m.ts}) ##########\n${t.slice(0, maxChars)}`);
});
writeFileSync(outFile, out.join('\n'), 'utf8');
console.log('wrote ' + outFile + ' entries=' + (out.length - 1));
