/* Relance les suites en échec et écrit le DÉBUT de leur sortie (le motif), pour
   savoir si l'échec vient des fichiers touchés par la reprise ou d'ailleurs.
   Fichier TEMPORAIRE. */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const suites = process.argv.slice(2);
const out = [];
for (const suite of suites) {
  let text = '';
  let code = 0;
  try {
    text = execFileSync(process.execPath, [suite], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    code = typeof err.status === 'number' ? err.status : 1;
    text = `${err.stdout || ''}${err.stderr || ''}`;
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !/DeprecationWarning|trace-deprecation/.test(l));
  out.push(`### ${suite}  EXIT=${code}`);
  out.push(lines.slice(0, 18).join('\n'));
  out.push('');
}
writeFileSync('tmp_six_out.txt', out.join('\n'), 'utf8');
console.log('wrote tmp_six_out.txt');
