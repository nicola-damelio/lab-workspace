/* Les VRAIS messages humains (parts type 'text') de la session cline en cours. */
import fs from 'node:fs';
const p = process.env.USERPROFILE + '\\.cline\\data\\sessions\\1792025879935_1s5ca\\1792025879935_1s5ca.messages.json';
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
const out = [`total ${d.messages.length}`];
let n = 0;
const humans = [];
d.messages.forEach((m, i) => {
  if (m.role !== 'user' || !Array.isArray(m.content)) return;
  const text = m.content.filter((x) => x && x.type === 'text' && typeof x.text === 'string').map((x) => x.text).join('\n').trim();
  if (!text) return;
  n += 1;
  humans.push({ i, ts: m.ts, text });
});
out.push(`human prompts: ${n}`);
humans.slice(-6).forEach((h) => {
  out.push(`\n##### HUMAN #${h.i} ${new Date(Number(h.ts)).toISOString()} len=${h.text.length} #####\n${h.text.slice(0, 4000)}`);
});
fs.writeFileSync('_z_hum3.txt', out.join('\n'), 'utf8');
console.log('human prompts', n);
