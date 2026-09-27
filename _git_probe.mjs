// Probe: git state + root files, written to _gs.txt / _gd.txt / _rootlist.txt
import { execSync } from 'node:child_process';
import { writeFileSync, readdirSync } from 'node:fs';

const run = (cmd) => {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (err) { return `ERROR: ${err.message}\n${err.stdout || ''}\n${err.stderr || ''}`; }
};

writeFileSync('_gs.txt', run('git --no-pager status --porcelain'), 'utf8');
writeFileSync('_gd.txt', run('git --no-pager diff --stat'), 'utf8');
writeFileSync('_gd_names.txt', run('git --no-pager diff --name-only'), 'utf8');
const all = readdirSync('.', { withFileTypes: true }).filter((e) => e.name.startsWith('_') && e.name !== 'node_modules');
writeFileSync('_rootlist.txt', all.map((e) => `${e.isDirectory() ? 'dir  ' : 'file '}${e.name}`).join('\n'), 'utf8');
console.log('probe done');
