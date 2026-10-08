/* Lance TOUTES les suites `_*_test.mjs` (liste établie par Node, pas par
   PowerShell) et écrit un résumé UTF-8. Fichier TEMPORAIRE. */
import { execFileSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';

const suites = readdirSync('.').filter((f) => f.startsWith('_') && f.includes('_test') && f.endsWith('t.mjs')).sort();

const write = (extra) => writeFileSync('tmp_all_result.txt', extra.join('\n'), 'utf8');
const lines = [`${suites.length} suites:\n${suites.map((s) => ' - ' + s).join('\n')}`, ''];
write(lines);

let bad = 0;
for (const suite of suites) {
  let out = '';
  let code = 0;
  try {
    out = execFileSync(process.execPath, [suite], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    code = typeof err.status === 'number' ? err.status : 1;
    out = `${err.stdout || ''}${err.stderr || ''}`;
  }
  if (code !== 0) bad += 1;
  const clean = out.split(/\r?\n/)
    .filter((l) => l.trim() && !/DeprecationWarning|trace-deprecation|module\.register/.test(l));
  lines.push(`### ${suite}  EXIT=${code}`);
  lines.push(clean.slice(-3).join('\n') || '(no output)');
  lines.push('');
  write(lines);
}
lines.push(bad === 0 ? `TOUTES LES ${suites.length} SUITES SONT VERTES` : `${bad} SUITE(S) EN ÉCHEC`);
write(lines);
console.log(`wrote tmp_all_result.txt (${suites.length} suites, ${bad} en échec)`);
