// Runs every scratch test in the repo root and reports pass/fail + the last
// meaningful line, so a change cannot silently break an older check.
const { execFileSync } = require('child_process');
const fs = require('fs');

const files = fs.readdirSync('.')
  .filter((f) => /^_.*\.(test\.)?(cjs|mjs)$/.test(f) && f !== '_run_all.cjs' && f !== '_explore.cjs')
  .sort();

const rows = [];
for (const f of files) {
  let out = '';
  let code = 0;
  try {
    out = execFileSync(process.execPath, [f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 });
  } catch (e) {
    code = e.status === undefined ? -1 : e.status;
    out = `${e.stdout || ''}\n${e.stderr || ''}`;
  }
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const summary = lines.filter((l) => /passed|PASS|FAIL|✗|error|Error/.test(l)).slice(-2).join(' | ') || lines.slice(-1)[0] || '(no output)';
  rows.push({ file: f, exit: code, summary: summary.slice(0, 150) });
}
fs.writeFileSync('_suite_report.txt', rows.map((r) => `${r.exit === 0 ? 'OK  ' : 'BAD '} ${r.file}  →  ${r.summary}`).join('\n') + `\ntotal ${rows.length}, failed ${rows.filter((r) => r.exit !== 0).length}\n`, 'utf8');
console.log(rows.map((r) => `${r.exit === 0 ? 'OK ' : 'BAD'} ${r.file} → ${r.summary}`).join('\n'));
console.log(`total ${rows.length}, failed ${rows.filter((r) => r.exit !== 0).length}`);
