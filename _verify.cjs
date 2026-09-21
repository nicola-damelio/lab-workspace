// Les neuf suites du VIEWER 3D seul — les plus rapides à relancer après une
// retouche de src/components/NMRMoleculeViewer.jsx (l'ensemble du dépôt, c'est
// _run_all.cjs). _viewer_render_smoke_test.mjs est la SEULE qui exécute un vrai
// rendu : elle construit son probe en SSR et monte la page docking, chaque
// section docking, le viewer et toutes les autres pages (c'est elle qui aurait
// attrapé le « Cannot access 'extraMols' before initialization » de la page
// docking). Résultat : EXIT + dernière ligne de chacune, sur la console et dans
// _verify.txt.
const { spawnSync } = require('child_process');
const fs = require('fs');
const tests = [
  '_viewer_scheme_test.mjs', '_viewer_style_controls_test.mjs', '_viewer_ui_layout_test.mjs',
  '_viewer_rings_gradient_test.mjs', '_dock_style_test.mjs', '_large_system_style_test.mjs',
  '_viewer_color_settings_test.mjs', '_viewer_structure_classes_test.mjs',
  '_viewer_render_smoke_test.mjs',
];
const rows = tests.map((t) => {
  const r = spawnSync(process.execPath, [t], { encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim().split(/\r?\n/).filter((l) => l.trim() !== '');
  return `[${t}] EXIT=${r.status} :: ${out[out.length - 1] || '(vide)'}`;
});
fs.writeFileSync('_verify.txt', `${rows.join('\n')}\n`);
console.log(rows.join('\n'));
console.log(`total ${rows.length}, failed ${rows.filter((r) => !r.includes('EXIT=0')).length}`);
