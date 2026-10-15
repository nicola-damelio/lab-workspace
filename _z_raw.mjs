/* Dump BRUT des derniers messages humains de la session cline en cours. */
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
