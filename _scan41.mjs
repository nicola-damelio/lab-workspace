/* _scan41.mjs — repo state + where "plate/frame/interior" concepts live outside the viewer. */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

let out = '';
const git = (args) => {
  try { return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); }
  catch (e) { return `<<git ${args.join(' ')} failed: ${e.message}>>`; }
};

out += `########## git status --porcelain ##########\n${git(['status', '--porcelain'])}\n`;
out += `########## git log --oneline -12 ##########\n${git(['--no-pager', 'log', '--oneline', '-12'])}\n`;
out += `########## git diff --stat ##########\n${git(['--no-pager', 'diff', '--stat'])}\n`;
out += `########## git stash list ##########\n${git(['stash', 'list'])}\n`;

out += `\n########## root files (newest 25) ##########\n`;
const root = readdirSync('.').filter((n) => {
  try { return statSync(join('.', n)).isFile(); } catch { return false; }
}).map((n) => ({ n, m: statSync(join('.', n)).mtimeMs, s: statSync(join('.', n)).size }))
  .sort((a, b) => b.m - a.m).slice(0, 25);
root.forEach((r) => { out += `${new Date(r.m).toISOString()}  ${String(r.s).padStart(9)}  ${r.n}\n`; });

const walk = (dir, acc = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist' || e.name === 'build') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(jsx|js|mjs)$/.test(e.name)) acc.push(p);
  }
  return acc;
};

const PATTERNS = [
  ['interior', /interior/i],
  ['refreshed', /refreshed/],
  ['setFrame(', /setFrame\(/],
  ['plate+frame same line', /plate|Plate/],
];
const files = walk('src').concat(process.argv[2] ? [process.argv[2]] : []);
for (const [title, re] of PATTERNS) {
  out += `\n########## src: ${title} ##########\n`;
  for (const p of files) {
    const t = readFileSync(p, 'utf8').replace(/\r\n/g, '\n').split('\n');
    t.forEach((l, i) => {
      if (re.test(l)) {
        if (title === 'plate+frame same line' && !/(frame|Frame)/.test(l)) return;
        out += `${p}:${i + 1}: ${l.trim().slice(0, 220)}\n`;
      }
    });
  }
}
writeFileSync('_live_scan41.txt', out);
console.log('_live_scan41.txt written');
