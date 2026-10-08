/* `vite build` capturé proprement, sans passer par PowerShell. TEMPORAIRE. */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts || {};
const buildCmd = String(scripts.build || 'vite build');
const r = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { encoding: 'utf8' });
const text = `${r.stdout || ''}\n${r.stderr || ''}`;
writeFileSync('tmp_build_out2.txt',
  `script npm: ${buildCmd}\nEXIT=${r.status}\n${text.split(/\r?\n/).filter((l) => l.trim()).slice(-20).join('\n')}`, 'utf8');
console.log(`build (${buildCmd}) EXIT=${r.status}`);
