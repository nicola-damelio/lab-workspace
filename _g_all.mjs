/* Scratch runner (throw-away): every viewer/pymol guard-rail, one line each. */
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const files = readdirSync('.')
  .filter((f) => /^_(viewer|pymol|kf)[\w-]*_test\.mjs$/.test(f) || /^_viewer[\w-]*\.mjs$/.test(f))
  .filter((f) => /_test\.mjs$/.test(f))
  .sort();
const out = [];
let failed = 0;
for (const f of files) {
  let code = 0;
  let text = '';
  try {
    text = execFileSync(process.execPath, [f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    code = err.status == null ? 1 : err.status;
    text = `${err.stdout || ''}${err.stderr || ''}`;
  }
  if (code !== 0) failed += 1;
  const last = (text.trim().split('\n').pop() || '').slice(0, 160);
  out.push(`EXIT=${code} ${f} :: ${last}`);
}
out.push(`total=${files.length} failing=${failed}`);
writeFileSync('_g_all_run.txt', out.join('\n') + '\n', 'utf8');
console.log(`ran ${files.length} tests, failing=${failed}`);
