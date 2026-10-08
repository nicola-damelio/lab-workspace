/* Qui lit quoi : les cibles readFileSync des suites en échec, et l'état de la
   ligne d'import d'App.jsx que _project_store_guard_test attend. TEMPORAIRE. */
import { readFileSync, writeFileSync } from 'node:fs';

const out = [];
const appLines = readFileSync('src/App.jsx', 'utf8').split(/\r?\n/);
out.push('--- App.jsx : lignes contenant adoptWorkspaceProjects');
appLines.forEach((l, i) => { if (l.includes('adoptWorkspaceProjects')) out.push(`${i + 1}: ${l}`); });
out.push(`--- ligne complète attendue par le test présente ? ${appLines.some((l) => l.includes('adoptWorkspaceProjects, loadRevivedProjects, adoptRevivedProjects, reviveDeletedProject } from'))}`);

const targets = (file) => {
  const src = readFileSync(file, 'utf8');
  const list = [...src.matchAll(/readFileSync\(\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
  return [...new Set(list)].join(' | ') || '(aucun)';
};
for (const f of ['_project_store_guard_test.mjs', '_sequence_charge_test.mjs', '_cysteine_panel_layout_test.mjs', '_experiment_folder_files_test.mjs', '_md_wall_test.mjs', '_docking_scatter_card_test.mjs']) {
  out.push(`--- ${f} lit : ${targets(f)}`);
}
writeFileSync('tmp_own_fail.txt', out.join('\n'), 'utf8');
console.log('wrote tmp_own_fail.txt');
