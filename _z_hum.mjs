/* Dump BRUT des derniers messages humains (pour voir la forme exacte). */
import fs from 'node:fs';
const p = process.env.USERPROFILE + '\\.cline\\data\\sessions\\1792025879935_1s5ca\\1792025879935_1s5ca.messages.json';
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
const users = d.messages.filter((m) => m.role === 'user');
const out = [`total ${d.messages.length} · users ${users.length}`];
users.slice(-5).forEach((m, i) => {
  out.push(`\n### USER[-${users.length - i}] ts=${m.ts} ${new Date(Number(m.ts)).toISOString()} keys=${Object.keys(m).join(',')}`);
  out.push(JSON.stringify(m).slice(0, 3500));
});
fs.writeFileSync('_z_raw.txt', out.join('\n'), 'utf8');
console.log('users', users.length);

import fs from 'node:fs';
const p = process.env.USERPROFILE + '\\.cline\\data\\sessions\\1792025879935_1s5ca\\1792025879935_1s5ca.messages.json';
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
const out = [`total ${d.messages.length}`];
let n = 0;
d.messages.forEach((m, i) => {
  if (m.role !== 'user') return;
  const c = m.content;
  const parts = Array.isArray(c) ? c : [c];
  const text = parts.map((x) => {
    if (typeof x === 'string') return x;
    if (x && typeof x === 'object' && typeof x.text === 'string') return x.text;
    return '';
  }).join('\n').trim();
  if (!text) return;
  if (/^\s*\{/.test(text)) return;   // résultat d'outil JSON
  n += 1;
  out.push(`\n##### HUMAN #${i} ts=${m.ts} len=${text.length} #####\n${text.slice(0, 3000)}`);
});
out.push(`\nhuman texts: ${n}`);
fs.writeFileSync('_z_hum2.txt', out.join('\n'), 'utf8');
console.log('human texts', n);
