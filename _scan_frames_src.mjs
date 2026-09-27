// Probe 16: who touches trajectory frames anywhere in src/? (Node, because search_codebase is flaky here.)
import fs from 'fs';
import path from 'path';
const root = 'src';
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(jsx?|mjs)$/.test(e.name)) files.push(p);
  }
}(root));
const pats = [
  /frameChanged/,
  /updatePosition/,
  /signals\.frame/,
  /signals\.refreshed/,
  /setSelection/,
  /Trajectory\(/,
  /new NGL\.Trajectory/,
  /frame\b/,
];
const out = ['FILES ' + files.length];
for (const re of pats) {
  out.push('');
  out.push('=== ' + re + ' ===');
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
    lines.forEach((l, i) => {
      if (re.test(l)) out.push(f.replace(/\\/g, '/') + ':' + (i + 1) + ': ' + l.trim().slice(0, 150));
    });
  }
}
fs.writeFileSync('_t_frames_src.txt', out.join('\r\n'), 'utf8');
console.log('ok', out.length);
