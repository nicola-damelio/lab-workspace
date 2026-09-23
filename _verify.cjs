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
  // Le pont PyMOL → NGL, la VRAIE cause du rapport « la scheda a sinistra non
  // funziona, tutto rimane in spheres e gli hide non funzionano » : NGL 2.4 ne
  // connaît ni `resn`/`name`/`resi`, ni `z>90`, ni les jokers — un mot inconnu
  // de ≤4 caractères devient un nom de résidu et un plus long JETTE, en
  // silence. Le pont traduit, résout `z>90` en liste d'index et développe les
  // jokers contre la structure ; le garde-fou EXÉCUTE cette traduction et
  // vérifie que le VRAI NGL accepte tout ce qu'elle produit. Il mesure aussi
  // les FEUILLETS (axe normal, plan médian, têtes) : « z était un moyen de
  // distinguer l'upper du lower leaflet », la géométrie le fait mieux.
  '_pymol_selection_bridge_test.mjs',
  // Ce qu'une macro doit dessiner, et ce que l'utilisateur doit pouvoir défaire
  // à la main (l'ordre des « show / hide », la barre Selections à gauche, §2
  // qui reprend la main, les `set … , <sélection>` devenus propriétés d'ATOMES).
  '_pymol_selections_test.mjs',
  // Le RIG DE LUMIÈRE (§3 Scene → ◐ Shadows / 🌑 Darkness / 💡 Light) est extrait
  // dans src/utils/viewerLightRig.js : les nombres de la référence (blanc, key
  // 1.15 / ambiante 0.34 hors ombres, 1.3 + 0.7·dark / max(0.12, 0.34 − 0.22·dark)
  // avec les ombres, direction azimut/élévation, lampe à 100× la boîte englobante,
  // sampleLevel 2) sont VÉRIFIÉS identiques à ceux qui étaient écrits en clair, et
  // leur traduction vers Mol* (Molstar) — le moteur qui sait dessiner les ombres
  // portées et l'ambient occlusion (postprocessing.occlusion = 'on') — est passée
  // au VRAI schéma de paramètres de molstar 4.18 (PD.merge sur RendererParams /
  // PostprocessingParams / Canvas3DParams) et à la fonction de direction de Mol*
  // elle-même (Vec3.directionFromSpherical) : la lumière ne bouge pas d'un iota.
  '_viewer_light_rig_test.mjs',
  // Le MATÉRIAU des quatre familles (🎛 Material) ne faisait RIEN : la cible
  // était fausse. `addRepresentation` ne renvoie pas la représentation mais
  // l'ÉLÉMENT qui l'enveloppe (ngl 2.4.0, component.ts), et un élément n'a ni
  // geometryList ni uniforms : l'ancien code ressortait en silence, donc chaque
  // curseur semblait mort. Le garde-fou EXÉCUTE le réglage sur une doublure
  // d'élément ET relit les sources de ngl dans sa sourcemap — roughness /
  // metalness sont des paramètres de PREMIÈRE CLASSE (`{ uniform: true }`), que
  // setParameters applique en place, sans rebuild.
  '_viewer_materials_test.mjs',
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
