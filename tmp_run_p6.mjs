/* Phase 6 : les suites de la rampe du fond du viewer. TEMPORAIRE. */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const suites = ['_viewer_background_test.mjs', '_viewer_ring_gradient_test.mjs'];
const out = [];
for (const s of suites) {
  const r = spawnSync(process.execPath, [s], { encoding: 'utf8' });
  const lines = `${r.stdout || ''}${r.stderr || ''}`.split(/\r?\n/)
    .filter((l) => l.trim() && !/DEP0205|trace-deprecation/.test(l));
  out.push(`### ${s} code=${r.status}`);
  out.push(lines.slice(-3).join('\n'));
}
writeFileSync('tmp_p6_run.txt', out.join('\n\n'), 'utf8');
console.log('ok');
