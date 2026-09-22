// Les onze suites du VIEWER 3D seul — les plus rapides à relancer après une
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
  // Le ✔ de la barre « Molecules · styling » EFFACE vraiment la molécule (le
  // bug : le rendu comparait la clé locale d'une section à un ensemble d'ids).
  '_viewer_section_visibility_test.mjs',
  // Le REBUILD de la structure principale laisse UNE seule série de
  // représentations, et la liste qui la suit est complète : le double appel
  // d'addDefaultReps laissait une copie orpheline dans la scène — une molécule
  // décochée restait dessinée et une surface ne partait plus (le rapport :
  // « hide still does not hide », « there is no way to remove a surface »).
  '_viewer_main_reps_ownership_test.mjs',
  // Les CINQ défauts du dernier rapport : le paragraphe de §2 dessiné au milieu du
  // viewer (un commentaire de bloc écrit NU entre deux éléments JSX), le rainbow
  // sans colorMaker NGL, les deux couleurs « first → last » que plus rien ne
  // pouvait changer, les chaînes latérales flottantes (CB–CA jamais dessiné) et le
  // 🔢 renumérotation qui n'ouvrait rien et ne changeait rien.
  '_viewer_report_fixes_test.mjs',
  // Les couleurs de la 2° structure sont ÉDITABLES partout où elles se choisissent :
  // la rangée « Color by » de la barre de style, le menu §2 (dont le bouton ouvrait
  // un panneau 🎨 qui n'existe plus) et une section À ELLE dans la roue ⚙ (le
  // rapport : « colors for secondary structure definition are not present in the
  // setting wheel »).
  '_viewer_sstruc_colors_test.mjs',
  // Les SIX défauts du rapport « styling window » : la barre de style d'un GRAND
  // système (protéines + phospholipides + eau) s'ouvrait VIDE, la rangée d'un
  // ligand offrait « Sugar type », la couleur des chaînes ne se définissait nulle
  // part, le potentiel électrostatique d'un ligand n'était pas calculé, le dégradé
  // était mesuré après le dessin (et écrasé d'une molécule à l'autre) et un
  // changement sur la rangée GENERAL devait mettre les parties de la molécule sur
  // « Hide ».
  '_viewer_style_gaps_test.mjs',
  // Le SMILES d'un ligand organique : le PDB ne donne que le code HETATM, donc le
  // SMILES vient du Chemical Component Dictionary du RCSB (fetch injecté, testé sans
  // réseau) — et la sous-section « Organic Molecule » du docking est revenue.
  '_ligand_smiles_test.mjs',
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
