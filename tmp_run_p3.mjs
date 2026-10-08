/* Phase 3 : relance les suites voisines + le build de production, et écrit un
   résumé UTF-8 (les redirections PowerShell abîment les accents). TEMPORAIRE. */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const suites = [
  '_workspace_open_refresh_test.mjs',
  '_workspace_resync_test.mjs',
  '_workspace_resync_ui_test.mjs',
  '_workspace_drive_test.mjs',
  '_workspace_keys_test.mjs',
  '_app_page_window_test.mjs',
  '_project_store_guard_test.mjs',
  '_deleted_projects_test.mjs',
  '_dataset_index_test.mjs',
  '_dataset_copy_mirror_test.mjs'
];

const out = [];
let failed = 0;
for (const s of suites) {
  const r = spawnSync(process.execPath, [s], { encoding: 'utf8' });
  const lines = `${r.stdout || ''}${r.stderr || ''}`.split(/\r?\n/)
    .filter((l) => l.trim() && !/DEP0205|trace-deprecation/.test(l));
  if (r.status !== 0) failed += 1;
  out.push(`### ${s} code=${r.status}`);
  out.push(lines.slice(-3).join('\n'));
}

const b = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { encoding: 'utf8' });
const bLines = `${b.stdout || ''}${b.stderr || ''}`.split(/\r?\n/).filter((l) => l.trim());
out.push(`### BUILD code=${b.status}`);
out.push(bLines.slice(-6).join('\n'));

writeFileSync('tmp_p3_full.txt', `suites en échec : ${failed}/${suites.length}\n\n${out.join('\n\n')}`, 'utf8');
console.log(`écrit — échecs : ${failed}, build code=${b.status}`);
