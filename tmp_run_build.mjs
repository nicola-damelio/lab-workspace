/* Lance `npm run build` et écrit la sortie en UTF-8 lisible. Fichier TEMPORAIRE. */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const r = spawnSync('npm.cmd', ['run', 'build'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: false });
const out = `${r.stdout || ''}\n${r.stderr || ''}`.split(/\r?\n/).filter((l) => l.trim());
writeFileSync('tmp_build_out.txt', `EXIT=${r.status}\n${out.slice(-12).join('\n')}\n`, 'utf8');
console.log('wrote tmp_build_out.txt');
