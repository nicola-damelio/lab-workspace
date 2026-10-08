/* Lance les suites une par une et écrit un résumé UTF-8 lisible (le passage par
   PowerShell abîme les accents et mélange les encodages). Fichier TEMPORAIRE. */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const suites = process.argv.slice(2);
const lines = [];
for (const suite of suites) {
  let out = '';
  let code = 0;
  try {
    out = execFileSync(process.execPath, [suite], { encoding: 'utf8' });
  } catch (err) {
    code = typeof err.status === 'number' ? err.status : 1;
    out = `${err.stdout || ''}${err.stderr || ''}`;
  }
  const clean = out.split(/\r?\n/)
    .filter((l) => l.trim() && !/DeprecationWarning|trace-deprecation|module\.register/.test(l));
  lines.push(`### ${suite}  EXIT=${code}`);
  lines.push(clean.slice(-4).join('\n') || '(no output)');
  lines.push('');
}
writeFileSync('tmp_suites_result.txt', lines.join('\n'), 'utf8');
console.log('wrote tmp_suites_result.txt');
