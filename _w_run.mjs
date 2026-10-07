// SCRATCH — esegue i test del repo e scrive esito + fallimenti in _w_run.txt
// (questo terminale non cattura lo stdout: si legge il file).
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const tests = process.argv.slice(2);
let out = '';
for (const t of tests) {
  let code = 0;
  let text = '';
  try {
    text = execFileSync(process.execPath, [t], { encoding: 'utf8', maxBuffer: 1 << 28, timeout: 20 * 60 * 1000 });
  } catch (e) {
    code = typeof e.status === 'number' ? e.status : 1;
    text = `${e.stdout || ''}\n${e.stderr || ''}`;
  }
  const lines = String(text).replace(/\r/g, '').split('\n').filter((l) => l.trim());
  const fails = lines.filter((l) => /^FAIL|^not ok|Error:|AssertionError|✗/.test(l)).slice(0, 8);
  out += `\n=== ${t} exit=${code} lines=${lines.length}\n`;
  out += (fails.length ? fails.join('\n') : lines.slice(-2).join('\n')) + '\n';
}
writeFileSync('_w_run.txt', out, 'utf8');
