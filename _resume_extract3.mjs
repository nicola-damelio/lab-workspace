/* Derniers messages HUMAINS de la session Cline interrompue.
   Usage: node _resume_extract3.mjs <fichier.messages.json> [nb] */
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
const n = Number(process.argv[3] || 6);
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

const humans = [];
list.forEach((m, i) => {
  if (m.role !== 'user') return;
  const t = humanText(m);
  if (t) humans.push({ i, ts: m.ts, t });
});
const out = [`total messages: ${list.length} — human messages: ${humans.length}`];
humans.slice(-n).forEach((h) => {
  out.push(`\n########## HUMAN #${h.i} (ts ${h.ts}) ##########\n${h.t.slice(0, 3000)}`);
});
writeFileSync('_resume_human.txt', out.join('\n'), 'utf8');
console.log('wrote _resume_human.txt');
