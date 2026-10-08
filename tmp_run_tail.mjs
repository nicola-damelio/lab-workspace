/* Lance les suites qui MANQUENT dans tmp_all_result.txt (la passe complète avait
   été interrompue) et écrit tmp_tail_result.txt. Fichier TEMPORAIRE. */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const all = readdirSync('.').filter((f) => f.startsWith('_') && f.includes('_test') && f.endsWith('t.mjs')).sort();
const done = existsSync('tmp_all_result.txt')
  ? new Set([...readFileSync('tmp_all_result.txt', 'utf8').matchAll(/^### (\S+)/gm)].map((m) => m[1]))
  : new Set();
const todo = all.filter((s) => !done.has(s));
writeFileSync('tmp_tail_result.txt', `reste ${todo.length} suite(s) sur ${all.length} :\n${todo.join('\n')}\n\n`, 'utf8');

const lines = [`${todo.length} suites restantes:`];
let bad = [];
for (const suite of todo) {
  let out = '';
  let code = 0;
  try {
    out = execFileSync(process.execPath, [suite], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    code = typeof err.status === 'number' ? err.status : 1;
    out = `${err.stdout || ''}${err.stderr || ''}`;
  }
  if (code !== 0) bad.push(suite);
  const clean = out.split(/\r?\n/).filter((l) => l.trim() && !/DeprecationWarning|trace-deprecation|module\.register/.test(l));
  lines.push(`### ${suite}  EXIT=${code}`);
  lines.push(clean.slice(-2).join('\n') || '(no output)');
  lines.push('');
  writeFileSync('tmp_tail_result.txt', `${lines.join('\n')}\nECHECS: ${bad.join(', ') || '(aucun)'}\n`, 'utf8');
}
console.log(`tail: ${todo.length} suites, ${bad.length} en échec`);
