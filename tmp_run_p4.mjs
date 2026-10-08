/* Phase 4 : suites voisines + build. TEMPORAIRE. */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const suites = [
  '_backup_file_test.mjs',
  '_save_html_test.mjs',
  '_load_html_projects_test.mjs',
  '_library_restore_test.mjs',
  '_reference_import_test.mjs',
  '_deleted_projects_test.mjs',
  '_dataset_index_test.mjs',
  '_dataset_copy_mirror_test.mjs',
  '_project_store_guard_test.mjs',
  '_workspace_open_refresh_test.mjs',
  '_workspace_resync_test.mjs',
  '_workspace_resync_ui_test.mjs',
  '_workspace_drive_test.mjs',
  '_workspace_keys_test.mjs',
  '_app_page_window_test.mjs'
];

const out = [];
let failed = 0;
for (const s of suites) {
  const r = spawnSync(process.execPath, [s], { encoding: 'utf8' });
  const lines = `${r.stdout || ''}${r.stderr || ''}`.split(/\r?\n/)
    .filter((l) => l.trim() && !/DEP0205|trace-deprecation|Figure → Drive/.test(l));
  if (r.status !== 0) failed += 1;
  out.push(`### ${s} code=${r.status} -> ${(lines[lines.length - 1] || '').slice(0, 110)}`);
  if (r.status !== 0) out.push(lines.slice(0, 8).join('\n'));
}

const b = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { encoding: 'utf8' });
const bLines = `${b.stdout || ''}${b.stderr || ''}`.split(/\r?\n/).filter((l) => l.trim());
out.push(`### BUILD code=${b.status}`);
out.push(bLines.slice(0, 4).join('\n'));

writeFileSync('tmp_p4_full.txt', `suites en échec : ${failed}/${suites.length}\n\n${out.join('\n\n')}`, 'utf8');
console.log(`écrit — échecs : ${failed}, build code=${b.status}`);
