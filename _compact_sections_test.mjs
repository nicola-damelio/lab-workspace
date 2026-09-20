/* =========================================================================
   _compact_sections_test.mjs — LA MISE EN PAGE COMPACTE DES PAGES D'EXPÉRIENCE
   et LA LECTURE DU TABLEAU PAR LES GRAPHIQUES DE DOCKING.

   Ce qui doit rester vrai :

     • « Classification » et « Compounds & Biological Models » vivent dans le
       MÊME bloc GENERAL, côte à côte sur un écran large (une colonne chacun) ;
     • « Bruker Import » (NMR) tient sur UNE ligne : la phrase d'aide sous le
       bouton, le sous-volet « From Google Drive link » et les champs
       « Manual SW (ppm) / Centre O1 (ppm) » ont disparu ;
     • « Bruker Import » (ssNMR) tient sur une ligne AVEC les trois champs de
       recadrage « From (kHz) / To (kHz) / Number of points » — ces trois
       paramètres n'existent QUE là —, et les champs « Manual SW (kHz) » /
       « Carrier offset (kHz) » ont disparu ;
     • le volet 3D de la page NMR n'a plus son champ « PDB ID / URL / local
       file » : la source de structure s'écrit à UN SEUL endroit, les commandes
       du viewer 3D (📂 PDB file(s) / « PDB ID or URL ») ;
     • les valeurs numériques d'un spectre (ssNMR, CD) ne sont plus une section
       à part : elles sont des COLONNES à côté de l'axe des x, juste sous les
       boutons d'import ;
     • « Jasco Import » (CD) tient sur une ligne : plus de phrase d'aide sous le
       bouton, plus de zone de collage « Import pasted data » ;
     • « Ellipticity conversion » / « Blank Subtraction » / « Math Operations »
       sont sur une seule rangée ;
     • page Docking : les graphiques sont rendus DIRECTEMENT dans « Data
       Analysis » (plus de sous-section « Per Atom Plot ») et ils tracent LE
       TABLEAU DE RÉSULTATS (valeurs éditées + colonnes CAPRI brutes), pas la
       liste brute des poses qui les laissait vides.
     • page Docking : renommer une colonne (et son unité) ne perd AUCUNE valeur
       — les cellules relisent la colonne CAPRI brute et l'ancienne clé de la
       métrique renommée, une colonne importée n'est jamais masquée sans que la
       métrique qui la porte soit rendue, et le graphique trace la grandeur que
       le tableau porte (score en a.u. pour HADDOCK, énergie en kcal/mol) au
       lieu de rester vide.
     • page Docking : une valeur AFFICHÉE dans le tableau est TRACÉE — quand le
       fichier range une grandeur (énergie, écart à la référence) dans une
       colonne qu'aucune métrique ne réclame, les deux axes du nuage, leurs
       étiquettes et le titre lisent cette colonne au lieu de laisser le
       graphique vide ; les deux bornes de RMSD de Vina / AutoDock comptent
       comme un écart à la référence.
     • page Docking : l'abscisse du nuage est NOMMABLE — l'i-RMSD d'abord par
       défaut (DEVIATION_PLOT_KEYS), n'importe quelle colonne du fichier à la
       main (« col:Ligand_dev » comprise), ou TOUTES les colonnes d'écart du
       tableau à la fois (un nuage par écart).

   Les fonctions pures de DockingData.jsx sont RÉELLEMENT exécutées (extraction
   + new Function, comme _docking_sanity.cjs) ; le reste est vérifié sur la
   source, comme les autres garde-fous du dépôt (les sections sont du JSX).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const DATA = read('src/components/DockingData.jsx');
const SEC = read('src/components/DockingSections.jsx');
const RENDER = read('src/components/DockingTestRenderer.jsx');
const SHELL = read('src/components/TestShellRenderer.jsx');
const NMR = read('src/components/NMRSections.jsx');
const SSN = read('src/components/ssNMRSections.jsx');
const CD = read('src/components/CDSections.jsx');

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};
const has = (src, needle, what) => {
  assert.ok(src.includes(needle), `${what}\n  cherche : ${needle}`);
  passed += 1;
};
const countOf = (src, needle) => src.split(needle).length - 1;
/* ══ 1. LE TSV CAPRI REMPLIT LE TABLEAU DE RÉSULTATS ═══════════════════════ */

const grab = (name, end) => {
  const m = DATA.match(new RegExp(`export const ${name} = [\\s\\S]*?${end}`));
  assert.ok(m, `DockingData.jsx : ${name} introuvable`);
  return m[0].replace(/^export\s+/, '');
};
const { parseCapriTsv, posesFromCapri, parseDockingValue, normMetricColumn,
  DOCKING_METRICS, dockingMetricOf, dockingMetricLabel, dockingMetricUnit,
  poseBindingEnergy, poseDeviation, haddockScoreTerms, CAPRI_RAW_PREFIX,
  poseRawMetric, LEGACY_POSE_KEYS, poseMetricValue, capriColumnMetricKey,
  chartEnergyMetricKey, poseChartValue, poseRawColumnValue,
  unclaimedColumnMatching, deviationColumnOf, energyColumnOf,
  DEVIATION_PLOT_KEYS, ENERGY_PLOT_KEYS, PLOT_SOURCE_PREFIX, PLOT_SOURCE_ALL,
  plotSourceOptions, plotSourceLabel, plotSourceValue } = new Function(
  [grab('parseCapriTsv', '\n};'), grab('CAPRI_METRIC_SYNONYMS', '\n};'),
   grab('normMetricColumn', ';'), grab('posesFromCapri', '\n};'),
   grab('parseDockingValue', '\n};'), grab('DOCKING_METRICS', '\n];'),
   grab('dockingMetricOf', '\n};'), grab('dockingMetricLabel', ';'),
   grab('dockingMetricUnit', ';'), grab('poseBindingEnergy', '\n};'),
   grab('DEVIATION_PLOT_KEYS', ';'), grab('ENERGY_PLOT_KEYS', ';'),
   grab('poseDeviation', '\n};'), grab('haddockScoreTerms', '\n};'),
   grab('CAPRI_RAW_PREFIX', ';'), grab('poseRawMetric', '\n};'),
   grab('LEGACY_POSE_KEYS', '\n};'), grab('poseMetricValue', '\n};'),
   grab('capriColumnMetricKey', '\n};'), grab('chartEnergyMetricKey', ';'),
   grab('poseChartValue', '\n};'), grab('poseRawColumnValue', ';'),
   grab('unclaimedColumnMatching', '\n};'), grab('deviationColumnOf', ';'),
   grab('energyColumnOf', ';'), grab('PLOT_SOURCE_PREFIX', ';'),
   grab('PLOT_SOURCE_ALL', ';'),
   grab('plotSourceOptions', '\n};'), grab('plotSourceLabel', '\n};'),
   grab('plotSourceValue', '\n};')].join('\n')
  + '\nreturn { parseCapriTsv, posesFromCapri, parseDockingValue, normMetricColumn,'
  + ' DOCKING_METRICS, dockingMetricOf, dockingMetricLabel, dockingMetricUnit,'
  + ' poseBindingEnergy, poseDeviation, haddockScoreTerms, CAPRI_RAW_PREFIX,'
  + ' poseRawMetric, LEGACY_POSE_KEYS, poseMetricValue, capriColumnMetricKey,'
  + ' chartEnergyMetricKey, poseChartValue, poseRawColumnValue,'
  + ' unclaimedColumnMatching, deviationColumnOf, energyColumnOf,'
  + ' DEVIATION_PLOT_KEYS, ENERGY_PLOT_KEYS, PLOT_SOURCE_PREFIX, PLOT_SOURCE_ALL,'
  + ' plotSourceOptions, plotSourceLabel, plotSourceValue };'
)();

eq(normMetricColumn('RMSD l.b.'), 'rmsdlb', 'les noms de colonnes sont comparés sous forme canonique');
eq(normMetricColumn('HADDOCK score'), normMetricColumn('haddock_score'),
  '« HADDOCK score » et « haddock_score » sont la même colonne');

/* Un capri_ss.tsv de HADDOCK3 : en-tête tabulé, scores et termes de score. */
const CAPRI = [
  'structure\tmodel\tcaprieval_rank\tscore\tlrmsd\tilrmsd\tair\tbsa\tvdw\telec\tdesolv\tcluster_id',
  'run1/data/structures/it1/cluster_1_1.pdb\tcluster_1_1.pdb\t1\t-52.31\t0.000\t0.000\t-15.2\t1240.5\t-42.6\t-210.8\t8.4\t1',
  'run1/data/structures/it1/cluster_1_2.pdb\tcluster_1_2.pdb\t2\t-48.90\t1.234\t2.015\t-12.9\t1188.0\t-38.1\t-198.4\t7.1\t1'
].join('\n');

const parsedCapri = parseCapriTsv(CAPRI);
ok(parsedCapri && parsedCapri.columns.length === 12, 'le TSV CAPRI est lu (12 colonnes)');
const poses = posesFromCapri(parsedCapri);
eq(poses.length, 2, 'deux poses sortent du TSV — le tableau de résultats est rempli');
eq(poses[0].mode, 1, 'le rang CAPRI devient le mode');
eq(poses[0].label, 'cluster_1_1.pdb', 'le nom de modèle (dernier segment du chemin) devient le label');
eq(poses[0].program, 'haddock', 'le programme est HADDOCK');
eq(poses[0].affinity, -52.31, 'la colonne « score » alimente le score du programme (graphique de liaison)');
eq(poses[0].lrmsd, 0, 'la colonne « lrmsd » alimente l-RMSD (Å) — un écart que le nuage sait tracer');
eq(poses[0].ilrmsd, 0, 'la colonne « ilrmsd » alimente l’i-l-RMSD (Å)');
eq(poses[0].energy_air, -15.2, 'la colonne « air » alimente AIR (termes HADDOCK)');
eq(poses[0].bsa, 1240.5, 'la colonne « bsa » alimente BSA (termes HADDOCK)');
eq(poses[0].energy_vdw, -42.6, 'la colonne « vdw » alimente vdW');
eq(poses[0].energy_elec, -210.8, 'la colonne « elec » alimente Electrostatic');
eq(poses[0].energy_desolv, 8.4, 'la colonne « desolv » alimente Desolvation');
eq(poses[0].capri_cluster_id, '1', 'les colonnes brutes restent disponibles pour le tableau');
eq(poses[1].affinity, -48.9, 'la deuxième pose suit la même conversion');
/* Autres orthographes (HADDOCK 2.4 / exports retravaillés) + virgule décimale. */
const POSES2 = posesFromCapri(parseCapriTsv([
  'Model\tHADDOCK score\tRMSD l.b.\tRMSD u.b.\tE_vdw\tE_elec\tE_desolv\tAIR\tBSA\tFraction of common contacts',
  'cluster_2_1.pdb\t-45,20\t1.5\t2.5\t-30.1\t-150.2\t6.3\t-10.1\t980.0\t0.42'
].join('\n')));
eq(POSES2[0].affinity, -45.2, '« HADDOCK score » avec virgule décimale → Affinity');
eq(POSES2[0].rmsd_lb, 1.5, '« RMSD l.b. » → RMSD l.b.');
eq(POSES2[0].rmsd_ub, 2.5, '« RMSD u.b. » → RMSD u.b.');
eq(POSES2[0].energy_vdw, -30.1, '« E_vdw » → vdW');
eq(POSES2[0].energy_elec, -150.2, '« E_elec » → Electrostatic');
eq(POSES2[0].energy_desolv, 6.3, '« E_desolv » → Desolvation');
eq(POSES2[0].energy_air, -10.1, '« AIR » → AIR');
eq(POSES2[0].bsa, 980, '« BSA » → BSA');
eq(POSES2[0].fcc, 0.42, '« Fraction of common contacts » → FCC');
eq(POSES2[0].mode, 1, 'sans colonne de rang, le mode est l’ordre de la ligne');

/* Une métrique ABSENTE vaut '' — jamais 0 : un zéro de complaisance ferait
   croire à une barre nulle dans le graphique au lieu d'un manque. */
const POSES3 = posesFromCapri(parseCapriTsv('score\tlrmsd\n-8.5\t1.2'));
eq(POSES3[0].affinity, -8.5, 'les colonnes présentes sont converties');
eq(POSES3[0].energy_vdw, '', 'une colonne absente reste vide');
eq(parseDockingValue(POSES3[0].energy_vdw), null, '…et ne devient pas 0 dans un graphique');
eq(parseDockingValue(POSES3[0].affinity), -8.5, 'les valeurs présentes sont tracées');
eq(posesFromCapri(null), [], 'un TSV illisible ne produit aucune pose');
eq(posesFromCapri({ columns: ['score'], rows: [] }), [], 'un TSV sans ligne ne produit aucune pose');

/* ══ 1b. RENOMMER UNE COLONNE NE PERD AUCUNE VALEUR ════════════════════════
   Un jeu de données importé AVANT le renommage des colonnes garde ses valeurs
   sous l'ancienne clé (« rmsd_lb » portait le l-RMSD d'un capri_ss.tsv, et
   « rmsd_ub » l'i-l-RMSD : c'est ce que le renommage corrige) et sous la
   colonne brute (« capri_lrmsd »). Tableau ET graphiques relisent par
   poseMetricValue : une cellule ne se vide plus parce qu'une colonne a changé
   de nom. */
const OLD_POSE = {
  mode: 1, label: 'cluster_1_1.pdb', program: 'haddock',
  affinity: -52.31, rmsd_lb: 0.912, rmsd_ub: 1.404, rmsd: 1.404,
  capri_lrmsd: '0.912', capri_ilrmsd: '1.404', capri_irmsd: '0.5', capri_cluster_id: '1'
};
eq(CAPRI_RAW_PREFIX, 'capri_', 'les colonnes brutes du fichier importé vivent sous ce préfixe');
eq(LEGACY_POSE_KEYS.lrmsd, ['rmsd_lb'], 'l’ancienne clé du l-RMSD est documentée (renommage des colonnes)');
eq(poseRawMetric(OLD_POSE, 'lrmsd'), '0.912', 'la colonne brute d’un import se lit directement');
eq(poseMetricValue(OLD_POSE, 'lrmsd', 'haddock'), '0.912',
  'une pose d’avant le renommage retrouve son l-RMSD par la colonne brute');
eq(poseMetricValue(OLD_POSE, 'ilrmsd', 'haddock'), '1.404',
  '…et son i-l-RMSD : aucune colonne CAPRI n’est perdue');
eq(poseMetricValue(OLD_POSE, 'irmsd', 'haddock'), '0.5',
  '…ni son i-RMSD (aucune colonne n’a de nom de métrique)');
eq(poseMetricValue({ rmsd_lb: 1.5, program: 'haddock' }, 'lrmsd', 'haddock'), 1.5,
  'sans colonne brute, l’ANCIENNE clé « RMSD l.b. » rend le l-RMSD');
eq(poseMetricValue({ rmsd_ub: 2.5, program: 'haddock' }, 'ilrmsd', 'haddock'), 2.5,
  '…et « RMSD u.b. » l’i-l-RMSD');
eq(poseMetricValue({ rmsd_lb: 1.5, program: 'vina' }, 'lrmsd', 'vina'), undefined,
  'une pose Vina garde « RMSD l.b. » pour elle : aucun l-RMSD inventé');
eq(poseMetricValue({ lrmsd: 2, capri_lrmsd: '9' }, 'lrmsd', 'haddock'), 2,
  'la clé canonique passe avant la colonne brute');
eq(poseMetricValue(posesFromCapri(parseCapriTsv('score\tlrmsd\n-8.5\t1.2'))[0], 'energy_vdw', 'haddock'), '',
  'une métrique absente d’un TSV importé reste vide — jamais 0');

eq(capriColumnMetricKey('lrmsd'), 'lrmsd', 'la colonne « lrmsd » alimente la métrique l-RMSD');
eq(capriColumnMetricKey('HADDOCK score'), 'affinity', '« HADDOCK score » alimente le score du programme');
eq(capriColumnMetricKey('E_vdw'), 'energy_vdw', '« E_vdw » alimente E vdW');
eq(capriColumnMetricKey('energy_torsional'), 'energy_torsional',
  'une colonne nommée comme la clé alimente sa clé');
eq(capriColumnMetricKey('md5'), null, 'une colonne inconnue n’est la colonne de personne (elle s’affiche brute)');

/* L'INVARIANT DU TABLEAU : toute colonne du fichier importé a un endroit où
   s'afficher — soit sa métrique (rendue parce que la colonne l'alimente), soit
   la colonne brute elle-même. C'est ce que fait DockingDataSection avec
   `capriFedKeys` / `renderedMetricKeys` ; ici, la même règle calculée sur le
   vrai capri_ss.tsv, pour qu'aucune colonne ne puisse disparaître. */
const CAPRI_COLUMNS = parsedCapri.columns;
const fedKeys = new Set(CAPRI_COLUMNS.map(capriColumnMetricKey).filter(Boolean));
const capriRendered = new Set(DOCKING_METRICS.filter((m) => fedKeys.has(m.key)).map((m) => m.key));
const shownRaw = CAPRI_COLUMNS.filter((c) => { const k = capriColumnMetricKey(c); return !(k && capriRendered.has(k)); });
eq(shownRaw, ['structure', 'model'],
  'seules les colonnes que PERSONNE ne réclame s’affichent en plus (le reste est déjà une métrique du tableau)');
ok(CAPRI_COLUMNS.every((c) => { const k = capriColumnMetricKey(c); return (k && capriRendered.has(k)) || shownRaw.includes(c); }),
  'aucune colonne du capri_ss.tsv ne disparaît du tableau');
eq(DOCKING_METRICS.filter((m) => fedKeys.has(m.key)).length, 10,
  'les dix colonnes reconnues du capri_ss.tsv sont rendues comme métriques');

/* Le graphique trace la grandeur que LE TABLEAU porte. */
const CAPRI_ROWS = posesFromCapri(parseCapriTsv(CAPRI));
eq(chartEnergyMetricKey(CAPRI_ROWS), 'affinity',
  'un capri_ss.tsv (aucune colonne « total ») trace son SCORE : le graphique n’est plus vide');
eq(chartEnergyMetricKey([{ affinity: -52.31, energy_total: -60 }]), 'energy_total',
  '…et l’énergie totale dès que le tableau en porte une');
eq(chartEnergyMetricKey([]), 'affinity', 'un tableau vide ne fait pas planter le choix de la grandeur');
eq(poseChartValue(CAPRI_ROWS[0], 'affinity', 'haddock'), -52.31, 'la barre trace le score HADDOCK lu dans le tableau');
eq(poseChartValue({ affinity: -8.5 }, 'energy_total', 'vina'), -8.5,
  'Vina / AutoDock : l’affinité EST l’énergie de liaison (kcal/mol)');
eq(poseChartValue({ affinity: -52.31 }, 'energy_total', 'haddock'), null,
  'HADDOCK : un score en a.u. ne devient jamais une énergie en kcal/mol');
eq(dockingMetricOf(DOCKING_METRICS.find((m) => m.key === 'affinity'), 'haddock').unit, 'a.u.',
  'l’axe porte l’unité de la grandeur tracée : a.u. pour le score HADDOCK');

/* ══ 1d. LA VALEUR DU TABLEAU EST TRACÉE, MÊME DEPUIS UNE COLONNE BRUTE ══
   Le tableau affiche TOUTE colonne importée : celles qu’une métrique reconnaît
   (sous son nom et son unité) et les autres TELLES QUELLES. Sans repli, une
   valeur rangée dans l’une de ces dernières s’affichait dans le tableau et le
   nuage restait vide — le cas rapporté : énergie et RMSD tous deux à l’écran,
   aucun point sur « énergie vs. RMSD ». */
eq(poseRawColumnValue({ capri_rmsd_lig: '1.42' }, 'rmsd_lig'), '1.42',
  'une colonne brute se relit par le nom de sa colonne');
eq(poseRawColumnValue({ capri_rmsd_lig: '1.42' }, null), undefined,
  'sans colonne choisie, il n’y a rien à relire');
eq(deviationColumnOf(['structure', 'rmsd_lig', 'md5']), 'rmsd_lig',
  'une colonne « …rmsd… » qu’aucune métrique ne réclame devient l’abscisse du nuage');
eq(deviationColumnOf(['structure', 'L-RMSD (Å)', 'md5']), null,
  'une colonne déjà ramenée sur l-RMSD n’est pas un repli (elle se lit normalement)');
eq(deviationColumnOf(['structure', 'md5']), null, 'sans colonne d’écart, aucun repli n’est inventé');
eq(energyColumnOf(['structure', 'Energy total (kcal/mol)', 'md5']), 'Energy total (kcal/mol)',
  'la colonne d’énergie non reconnue devient l’ordonnée du graphique');
eq(energyColumnOf(['structure', 'total_energy']), null,
  'une colonne déjà ramenée sur l’énergie totale n’est pas un repli');
eq(energyColumnOf(['structure', 'score', 'lrmsd']), null,
  '« score » est déjà l’affinité du tableau : pas de repli');
eq(energyColumnOf(['structure', 'protonation']), null,
  'un mot qui n’est pas une énergie ne devient pas l’ordonnée');
eq(poseDeviation({ rmsd_ub: 2.5 }), 2.5,
  'la borne SUPÉRIEURE de RMSD compte aussi : les deux bornes s’affichent dans le tableau');
eq(poseDeviation({ rmsd_lb: 1.5, rmsd_ub: 2.5 }), 1.5,
  'la borne inférieure reste l’abscisse quand les deux existent');

/* Le nuage, tel que la section le construit : le nombre de points est ce que
   l’utilisateur voit. Énergie ET RMSD à l’écran, aucun point : le cas rapporté. */
const pointsOf = (columns, poses, x = '', y = '') => {
  const dev = poses.some((p) => poseDeviation(p) !== null) ? null : deviationColumnOf(columns);
  const ene = poses.some((p) => poseChartValue(p, 'affinity', 'haddock') !== null) ? null : energyColumnOf(columns);
  const point = (p) => {
    const energy = y
      ? plotSourceValue(p, y, 'energy', 'haddock')
      : (poseChartValue(p, 'affinity', 'haddock') ?? parseDockingValue(poseRawColumnValue(p, ene)));
    const deviation = x
      ? plotSourceValue(p, x, 'deviation', 'haddock')
      : (poseDeviation(p) ?? parseDockingValue(poseRawColumnValue(p, dev)));
    return energy !== null && deviation !== null;
  };
  return poses.filter(point).length;
};
const RAW_DEV = posesFromCapri(parseCapriTsv([
  'Model\tHADDOCK score\trmsd_lig',
  'cluster_1_1.pdb\t-52.31\t1.42',
  'cluster_1_2.pdb\t-48.90\t2.05'
].join('\n')));
eq(RAW_DEV[0].capri_rmsd_lig, '1.42', 'une colonne non reconnue reste brute dans la ligne importée');
eq(RAW_DEV[0].lrmsd, '', '…et ne remplit pas la métrique l-RMSD du tableau');
eq(poseDeviation(RAW_DEV[0]), null, 'le chemin normal ne trouve alors aucun écart : sans repli, le nuage est vide');
eq(pointsOf(['Model', 'HADDOCK score', 'rmsd_lig'], RAW_DEV), 2,
  'la colonne d’écart non reconnue donne quand même ses points au nuage');
const UPPER_ONLY = posesFromCapri(parseCapriTsv('Model\tHADDOCK score\tRMSD u.b.\ncluster_1_1.pdb\t-52.31\t2.5'));
eq(pointsOf(['Model', 'HADDOCK score', 'RMSD u.b.'], UPPER_ONLY), 1,
  'une table qui ne porte que la borne supérieure place quand même son point');
/* ══ 1e. L'ABSCISSE : L'ÉCART CHOISI, OU TOUS LES ÉCARTS ═══════════════════
   L'abscisse « Auto » suit DEVIATION_PLOT_KEYS : l'i-RMSD d'abord (l'écart de
   qualité de l'interface), puis le l-RMSD, les bornes de Vina / AutoDock,
   l'i-l-RMSD, le RMSD. Un fichier dont la colonne d'écart porte un nom qu'aucun
   synonyme ne couvre (« Ligand_dev ») se choisit à la main, et « All
   deviations » trace UN NUAGE PAR ÉCART du tableau : aucun nom de colonne ne
   peut plus laisser le nuage vide. */
eq(DEVIATION_PLOT_KEYS[0], 'irmsd', 'l’i-RMSD est le PREMIER écart tracé par défaut');
eq(DEVIATION_PLOT_KEYS.slice(1, 3), ['lrmsd', 'rmsd_lb'],
  '…puis le l-RMSD, puis les bornes de Vina / AutoDock');
eq(PLOT_SOURCE_ALL, 'all', '« toutes les colonnes d’écart » a sa valeur, distincte des sources');
eq(poseDeviation({ irmsd: 0.5, lrmsd: 1.2, rmsd: 3 }), 0.5,
  'une table qui porte l’i-RMSD et le l-RMSD trace l’i-RMSD');
eq(poseDeviation({ lrmsd: 1.2, rmsd: 3 }), 1.2, 'sans i-RMSD, c’est le l-RMSD qui mène');

const FULL_CAPRI = posesFromCapri(parseCapriTsv([
  'structure\tscore\tirmsd\tlrmsd\tilrmsd\trmsd',
  'run1/cluster_1_1.pdb\t-52.31\t0.512\t0.912\t1.404\t1.879',
  'run1/cluster_1_2.pdb\t-48.90\t0.734\t1.234\t2.015\t2.512'
].join('\n')));
const FULL_COLUMNS = ['structure', 'score', 'irmsd', 'lrmsd', 'ilrmsd', 'rmsd'];
eq(pointsOf(FULL_COLUMNS, FULL_CAPRI), 2, 'un capri_ss.tsv complet place ses points tout seul');
eq(poseDeviation(FULL_CAPRI[0]), 0.512, '…avec l’i-RMSD en abscisse par défaut');
eq(pointsOf(FULL_COLUMNS, FULL_CAPRI, 'metric:rmsd'), 2, 'un autre écart se choisit dans le sélecteur');
eq(pointsOf(FULL_COLUMNS, FULL_CAPRI, 'metric:rmsd', 'metric:energy_vdw'), 0,
  '…et une métrique sans valeur ne fabrique aucun point (le score HADDOCK n’est pas une énergie vdW)');
const X_METRICS = plotSourceOptions(FULL_COLUMNS, FULL_CAPRI, 'deviation', 'haddock')
  .filter((o) => o.value.startsWith(PLOT_SOURCE_PREFIX.metric));
eq(X_METRICS.length, 4, '« All deviations » propose les quatre écarts que le tableau porte');
eq(X_METRICS.map((o) => o.label), ['i-RMSD (Å)', 'l-RMSD (Å)', 'i-l-RMSD (Å)', 'RMSD (Å)'],
  '…nommés : chaque nuage dit quel écart il trace');
eq(X_METRICS.map((o) => FULL_CAPRI.filter((p) => plotSourceValue(p, o.value, 'deviation', 'haddock') !== null).length),
  [2, 2, 2, 2], '…et chacun a ses points (un nuage par écart, aucun vide)');

/* Le cas rapporté : une colonne d'écart qu'aucune devinette ne peut reconnaître.
   Le tableau l'affiche, le sélecteur la propose (« col: ») et le nuage se
   remplit dès qu'elle est choisie. */
const UNKNOWN_DEV = posesFromCapri(parseCapriTsv([
  'Model\tHADDOCK score\tLigand_dev',
  'cluster_1_1.pdb\t-52.31\t1.42',
  'cluster_1_2.pdb\t-48.90\t2.05'
].join('\n')));
eq(poseDeviation(UNKNOWN_DEV[0]), null, '« Ligand_dev » n’est devinable par personne');
eq(pointsOf(['Model', 'HADDOCK score', 'Ligand_dev'], UNKNOWN_DEV), 0, 'sans choix, ce nuage est vide');
eq(plotSourceLabel(plotSourceOptions(['Model', 'HADDOCK score', 'Ligand_dev'], UNKNOWN_DEV, 'deviation', 'haddock'), 'col:Ligand_dev'),
  'Ligand_dev — column of the imported file', '…mais le sélecteur propose la colonne');
eq(pointsOf(['Model', 'HADDOCK score', 'Ligand_dev'], UNKNOWN_DEV, 'col:Ligand_dev'), 2,
  '…et la colonne choisie remplit le nuage');
eq(plotSourceLabel([{ value: 'col:Ligand_dev', label: 'x' }], 'metric:irmsd'), '',
  'un choix qui n’existe plus revient à Auto (jamais une source inventée)');



/* ══ 2. LES DEUX IMPORTS REMPLISSENT LE MÊME TABLEAU ══════════════════════ */
has(DATA, 'poses: posesFromCapri(capri),', '[capri_ss.tsv] un fichier importé seul remplit AUSSI le tableau');
ok(!DATA.includes('poses: [], capri,'), '[capri_ss.tsv] le tableau n’est plus laissé vide');
has(SEC, 'const poses = posesFromCapri(parsed);', '[répertoire de calcul] même conversion que l’import seul');
ok(!SEC.includes('const metricMap = {'), '[répertoire de calcul] la correspondance locale a disparu (une seule source de vérité)');
has(SEC, 'if (poses.length) onPoses(poses, parsed.program);', 'le collage/import pose les poses');
has(SEC, 'if (updateCount) updateActiveTest(parsed.updates);', '…ET les paramètres du même fichier (les deux, plus l’un ou l’autre)');

/* ══ 3. LES GRAPHIQUES LISENT LE TABLEAU ══════════════════════════════════ */
has(SEC, 'const raw = d.activeValues[`${i}-${m.key}`];', 'les graphiques partent des cellules éditées du tableau');
has(SEC, 'const v = poseMetricValue(p, m.key, d.dockingProgram);',
  '…avec la lecture partagée des valeurs (colonne CAPRI brute + ancienne clé de la métrique)');
has(SEC, 'const energyKey = chartEnergyMetricKey(rows);',
  'la grandeur tracée est celle du tableau (score, sinon énergie totale)');
has(SEC, 'const rowEnergy = (p) => (yChoice', 'l’ordonnée du nuage part de la source CHOISIE dans le panneau, sinon du tableau');
has(SEC, 'const rowDeviation = (p) => (xChoice', '…idem pour l’abscisse');
has(SEC, 'const xOptions = plotSourceOptions(capriColumns, rows, \'deviation\', d.dockingProgram);',
  'les sources de l’axe X sont celles du TABLEAU, pour le programme du fichier');
has(SEC, 'const yOptions = plotSourceOptions(capriColumns, rows, \'energy\', d.dockingProgram);',
  '…et celles de l’axe Y');
has(SEC, 'const xChoice = plotSourceLabel(xOptions, cfg.xColumn) ? cfg.xColumn : \'\';',
  'un choix d’axe qui n’existe plus retombe sur Auto');
has(SEC, 'const allDeviations = cfg.xColumn === PLOT_SOURCE_ALL && xMetrics.length > 1;',
  '« All deviations » demande un nuage par écart — et n’a de sens que s’il y en a plusieurs');
has(SEC, '<option value="">Auto — {autoRmsdName}</option>',
  'le sélecteur X NOMME l’écart que « Auto » trace (i-RMSD d’abord)');
has(SEC, '<option value={PLOT_SOURCE_ALL}>', '…et offre de les tracer tous');
has(SEC, 'const autoRmsdName = deviationFromColumn || autoDeviationName || \'RMSD\';',
  'l’écart « Auto » : la colonne du fichier, sinon la première grandeur du tableau');
has(SEC, 'const autoDeviationKey = DEVIATION_PLOT_KEYS.find(',
  '…choisie dans DEVIATION_PLOT_KEYS (l’i-RMSD en tête)');
has(SEC, 'const rmsdSeriesData = allDeviations', 'un nuage par écart quand c’est demandé');
has(SEC, 'rmsd: plotSourceValue(p, o.value, \'deviation\', d.dockingProgram)',
  '…chaque nuage relit SON écart avec la lecture du tableau');
has(SEC, 'const scatterCard = ({ key, short, axisTitle, points, containerRef = null }) => (',
  'le nuage est rendu une fois par écart (même code, même habillage)');
has(SEC, 'containerRef: i === 0 ? scatterRef : null', 'le premier nuage garde la référence du panneau');
has(SEC, 'title={`${energyName} vs. ${short}`}',
  'le titre du nuage nomme la grandeur et la colonne lues');
has(SEC, 'label={cfgAxisLabel(cfg, \'x\', axisTitle, 10)}',
  'l’axe des abscisses est étiqueté de la colonne lue');
has(SEC, 'const energyFromColumn = rows.some((p) => metricEnergy(p) !== null) ? null : energyColumnOf(capriColumns);',
  'le repli ne sert que si AUCUNE ligne n’a d’énergie par la métrique');
has(SEC, 'const deviationFromColumn = rows.some((p) => metricDeviation(p) !== null) ? null : deviationColumnOf(capriColumns);',
  '…idem pour l’écart à la référence');
has(SEC, '    : autoRmsdName;', 'le titre du nuage suit l’écart que « Auto » trace');
has(SEC, '? `${deviationFromColumn} (Å)`',
  'l’axe nomme la colonne du fichier quand c’est elle qui porte l’écart');
has(SEC, 'const affinityUnit = plottedEnergy.unit || unit;', 'l’unité de l’axe suit la métrique tracée');
has(SEC, 'poseMetricValue(pose, m.key, program)', '[tableau] une cellule relit la colonne brute / l’ancienne clé');
has(SEC, 'const capriFedKeys = new Set(capriColumns.map(capriColumnMetricKey).filter(Boolean));',
  'une colonne importée force la métrique qui la porte dans le tableau');
has(SEC, 'return !(key && renderedMetricKeys.has(key));',
  '…et une colonne brute ne se cache que si sa métrique est RENDUE dans le tableau');
ok(!SEC.includes('capriMetricMapKeys'),
  'plus de liste noire de colonnes : aucune colonne importée ne peut disparaître');
has(SEC, 'const affinityData = rows.map((p, i) => ({', 'le graphique d’affinité lit les lignes du tableau');
has(SEC, 'const rmsdData = rows', 'le nuage Affinity vs RMSD lit les lignes du tableau');
has(SEC, 'const energyBreakdownData = rows.slice(0, 10).map(', 'la décomposition d’énergie aussi');
has(SEC, 'const termRows = rows.slice(0, 15).map(', 'les termes HADDOCK aussi');
has(SEC, 'data={termRows}', '…et le graphique des termes les trace UNE barre par terme présent');
has(SEC, '{rows.length} poses', 'le compteur de poses suit le tableau');
ok(!SEC.includes('const affinityData = d.poses'), 'plus aucun graphique branché sur la liste brute des poses');
ok(!SEC.includes('data={d.poses.slice(0, 15)'), '…ni les termes HADDOCK');
has(SEC, 'rmsd: rowDeviation(p)', 'l’écart à la référence passe par la lecture CAPRI partagée (l-RMSD, puis i-RMSD…), colonne brute comprise');
has(SEC, '.filter((r) => r.affinity !== null && r.rmsd !== null);', 'un RMSD vide ne se transforme pas en point à 0');

/* ══ 4. « DATA ANALYSIS » SANS SOUS-SECTION « PER ATOM PLOT » ═════════════ */
has(RENDER, 'analysisPlain: true,', '[docking] le contenu de Data Analysis est rendu directement');
has(SHELL, 'custom.analysisPlain ? (', '[shell] analysisPlain est bien ce qui supprime la sous-section');
/* ══ 5. GENERAL : CLASSIFICATION + COMPOUNDS CÔTE À CÔTE ═════════════════ */
has(SHELL, "grid grid-cols-1 items-start gap-0 ${(showCompoundsSection || CompoundsSection) ? 'xl:grid-cols-2 xl:gap-x-4' : ''}",
  'les deux sous-sections courtes de GENERAL partagent une grille à deux colonnes');
ok(SHELL.indexOf('title="Classification"') < SHELL.indexOf('title="Compounds & Biological Models"'),
  'Classification reste la première colonne');

/* ══ 6. « BRUKER IMPORT » (NMR) SUR UNE LIGNE ════════════════════════════ */
ok(!NMR.includes('0x1F517)} From Google Drive link'), '[NMR] le sous-volet « From Google Drive link » a disparu');
ok(!NMR.includes('nmrBrukerDataUrl') && !NMR.includes('nmrBrukerAcqusUrl') && !NMR.includes('nmrBrukerImagUrl'),
  '[NMR] …avec ses états et son handler');
ok(!NMR.includes('Import from links'), '[NMR] …et son bouton');
ok(!NMR.includes('This will automatically locate the 1r file(s)'),
  '[NMR] la phrase d’aide sous le bouton d’upload a disparu');
ok(!NMR.includes('Manual SW (ppm)') && !NMR.includes('Centre O1 (ppm)'),
  '[NMR] les champs « Manual SW (ppm) » / « Centre O1 (ppm) » ont disparu');
ok(!NMR.includes('From (kHz)') && !NMR.includes('Number of points'),
  '[NMR] les trois paramètres de recadrage ne sont PAS sur la page NMR (ssNMR seulement)');
ok(!NMR.includes('manualSWppm:'), '[NMR] l’import ne passe plus de valeurs manuelles au lecteur 1r');

const nmrH4 = NMR.indexOf('Bruker Import — 1r processed spectrum (ppm axis)');
const nmrMsg = NMR.indexOf('{nmrBrukerMsg &&');
const nmrCard = NMR.slice(NMR.lastIndexOf('<div className="bg-sky-50', nmrH4), nmrMsg);
ok(nmrH4 > 0 && nmrMsg > nmrH4, '[NMR] le bloc Bruker Import est identifiable');
ok(!nmrCard.includes('Manual SW') && !nmrCard.includes('From Google Drive link'),
  '[NMR] plus rien d’autre que la ligne d’import');
ok(nmrCard.includes('Choose Bruker Folder'), '[NMR] le bouton d’upload est sur la ligne du titre');
ok(countOf(nmrCard, '\n        <div className="flex flex-wrap items-center gap-2">') === 1,
  '[NMR] le bloc n’a qu’UNE ligne de commande');
ok(nmrCard.includes('nmr1dRestore.attempt'), '[NMR] l’état / la restauration du spectre restent accessibles');

/* ══ 7. « BRUKER IMPORT » (ssNMR) : UNE LIGNE + VALEURS EN COLONNES ══════ */
ok(!SSN.includes('From Google Drive link'), '[ssNMR] le sous-volet « From Google Drive link » a disparu');
ok(!SSN.includes('brukerDataUrl') && !SSN.includes('brukerAcqusUrl'), '[ssNMR] …avec ses états');
ok(!SSN.includes('Import from links'), '[ssNMR] …et son bouton');
ok(!SSN.includes('Manual SW (kHz)') && !SSN.includes('Carrier offset (kHz)'),
  '[ssNMR] les champs « Manual SW (kHz) » / « Carrier offset (kHz) » ont disparu');
ok(!SSN.includes('This will automatically locate the 1r file(s)'),
  '[ssNMR] la phrase d’aide sous le bouton d’upload a disparu');
has(SSN, 'From (kHz)', '[ssNMR] « From (kHz) » est là (et seulement là)');
has(SSN, 'To (kHz)', '[ssNMR] « To (kHz) » est là');
has(SSN, 'Number of points', '[ssNMR] « Number of points » est là');
ok(countOf(SSN, 'Crop & resample upon import') === 1, '[ssNMR] un seul bloc de recadrage');

const ssnUpload = SSN.indexOf('Choose Bruker Folder');
const ssnCrop = SSN.indexOf('Number of points');
const ssnAxis = SSN.indexOf('Frequencies (kHz) — comma, space or newline separated');
ok(ssnUpload > 0 && ssnCrop > ssnUpload, '[ssNMR] le recadrage suit les boutons d’import');
ok(ssnAxis > ssnCrop, '[ssNMR] les valeurs numériques viennent JUSTE SOUS les boutons d’import');
ok(countOf(SSN, 'Spectra — condition') === 1, '[ssNMR] une seule carte de spectres (dans l’import, plus de section dédiée)');
ok(SSN.indexOf('Spectra — condition') > ssnUpload, '[ssNMR] …et elle est dans la carte d’import');
ok(!SSN.includes('import a Bruker 1r folder below'), '[ssNMR] l’ancienne carte « Spectra — condition » a disparu');
has(SSN, 'flex flex-wrap items-stretch gap-2', '[ssNMR] l’axe et les spectres sont des COLONNES côte à côte');
has(SSN, 'same order as the frequencies', '[ssNMR] chaque colonne de spectre suit l’axe des fréquences');
/* ══ 8. « JASCO IMPORT » (CD) SUR UNE LIGNE + VALEURS EN COLONNES ════════ */
ok(!CD.includes('jascoText'), '[CD] la zone de collage des données a disparu (état compris)');
ok(!CD.includes('Import pasted data'), '[CD] …et son bouton « Import pasted data »');
ok(!CD.includes('or paste the file content below'), '[CD] la phrase d’aide sous le bouton d’upload a disparu');
ok(!CD.includes('handlePasteImport'), '[CD] …avec son handler');

const cdUpload = CD.indexOf('Choose Jasco file(s)');
const cdAxis = CD.indexOf('Wavelengths (nm) — comma, space or newline separated');
ok(cdUpload > 0 && cdAxis > cdUpload, '[CD] les valeurs numériques viennent JUSTE SOUS les boutons d’import');
ok(countOf(CD, 'Spectra — condition') === 1, '[CD] une seule carte de spectres (dans l’import, plus de section dédiée)');
ok(CD.indexOf('Spectra — condition') > cdUpload, '[CD] …et elle est dans la carte d’import');
ok(!CD.includes('import a Jasco file below'), '[CD] l’ancienne carte « Spectra — condition » a disparu');
has(CD, 'flex flex-wrap items-stretch gap-2', '[CD] l’axe et les spectres sont des COLONNES côte à côte');
has(CD, 'same order as the wavelengths', '[CD] chaque colonne de spectre suit l’axe des longueurs d’onde');

/* La ligne d'import porte l'upload ET l'état du spectre, sans description. */
const cdRow = CD.slice(cdUpload - 400, CD.indexOf('{jascoMsg &&'));
ok(cdRow.includes('cdRestore.attempt'), '[CD] la restauration Drive est sur la même ligne');

/* ══ 9. LES TROIS CARTES DE TRAITEMENT SUR UNE RANGÉE ════════════════════ */
has(CD, 'grid grid-cols-1 xl:grid-cols-3 gap-3 items-start',
  '[CD] « Ellipticity conversion / Blank Subtraction / Math Operations » sur une rangée');
const cdGrid = CD.indexOf('grid grid-cols-1 xl:grid-cols-3 gap-3 items-start');
const cdEll = CD.indexOf('🧮 Ellipticity conversion — [θ] / Δε');
const cdBlank = CD.indexOf('🧹 Blank Subtraction');
const cdMath = CD.indexOf('🔧 Math Operations');
ok(cdGrid > 0 && cdGrid < cdEll && cdEll < cdBlank && cdBlank < cdMath,
  '[CD] les trois cartes sont dans la grille, dans l’ordre attendu');
ok(CD.indexOf('</div>\n\n        <SpectraVisualization ctx={ctx} />') > cdMath,
  '[CD] la grille se referme après la troisième carte (le graphique reste dessous)');

/* ══ 10. RIEN N'A ÉTÉ PERDU ══════════════════════════════════════════════ */
has(SSN, 'Archive spectra to Drive', '[ssNMR] l’archivage Drive reste disponible');
has(SSN, 'DriveUploadButton', '[ssNMR] …par le même bouton');
has(NMR, '⬇️ Restore from Drive', '[NMR] la restauration manuelle du spectre reste possible');
has(SSN, '⬇️ Restore from Drive', '[ssNMR] la restauration manuelle des colonnes reste possible');
has(CD, '⬇️ Restore from Drive', '[CD] la restauration manuelle des colonnes reste possible');
has(SSN, 'manualSWkHz', '[ssNMR] le lecteur 1r accepte toujours un SW manuel (pour les appels internes)');
has(CD, '+ Add Spectrum', '[CD] l’ajout manuel de spectre existe toujours');
has(SSN, '+ Add Spectrum', '[ssNMR] l’ajout manuel de spectre existe toujours');
has(CD, 'Export CSV (all conditions)', '[CD] l’export CSV existe toujours');
has(SSN, 'Export CSV (all conditions)', '[ssNMR] l’export CSV existe toujours');

/* ══ 11. « PDB ID / URL / local file » (NMR, volet 3D) A DISPARU ═════════ */

/* Ce champ vivait sur la page NMR, juste au-dessus du viewer 3D, et recopiait
   dans `activeTest.structureSrc` ce que les commandes du viewer écrivent déjà
   (📂 PDB file(s) / « PDB ID or URL » → `onStructureSrc`). Deux champs pour une
   même adresse finissent par diverger — et c'est celui du viewer qui est
   RÉELLEMENT chargé. Partis avec lui : son état de frappe « découplé » (celui
   qui évitait de re-rendre le WebGL à chaque touche) et son bouton Load.
   Les assertions visent l'étiquette JSX et l'espace réservé, jamais l'identifiant
   seul : le commentaire qui raconte la disparition cite le libellé, il ne doit
   pas faire passer un test qui, lui, parle du code. */
ok(!NMR.includes('>PDB ID / URL / local file</label>'),
  '[NMR] l’étiquette « PDB ID / URL / local file » du volet 3D a disparu');
ok(!NMR.includes('e.g. 1UBQ or /structures/POPC.pdb'),
  '[NMR] …et son champ de saisie (l’invite qui allait avec)');
ok(!NMR.includes('value={localPdbInput}') && !NMR.includes('setLocalPdbInput')
  && !NMR.includes('applyPdbInput'),
  '[NMR] …ni son état de frappe découplé, ni son bouton Load');
has(NMR, 'onStructureSrc={(v) => updateActiveTest({ structureSrc: v })}',
  '[NMR] le viewer 3D reste le SEUL à écrire activeTest.structureSrc');
has(NMR, 'const structureSrc = useMemo(() => {',
  '[NMR] la source du viewer est toujours calculée à partir de la condition');
has(NMR, 'activeTest.structureSrc || activeTest.pdbId',
  '[NMR] …code PDB, URL, fichier déposé ou PDB de page : tous au même endroit');

console.log(`_compact_sections_test.mjs — ${passed} assertions passées ✔`);
