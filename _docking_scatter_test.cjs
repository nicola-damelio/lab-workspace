/* Repro du nuage « énergie vs RMSD » : on exécute LE VRAI code de
   DockingData.jsx (extraction + new Function) et LE VRAI bloc de dérivation de
   DockingAnalysisSection (extrait de DockingSections.jsx), sur des fichiers
   CAPRI réalistes. Ce qui doit rester vrai :

     • les sept dispositions de colonnes rencontrées (HADDOCK3, CAPRI 2.4,
       Vina, poses enregistrées avant le renommage des colonnes, valeurs
       saisies à la main, colonne d'écart non réclamée, fichier sans écart)
       donnent chacune leurs points au nuage « énergie vs RMSD » ;
     • l'abscisse « Auto » suit DEVIATION_PLOT_KEYS — l'i-RMSD d'abord ;
     • une colonne d'écart qu'aucune devinette ne couvre (« Ligand_dev ») est
       proposée par le sélecteur (« col: ») et remplit le nuage une fois
       choisie ;
     • « All deviations » trace un nuage par écart du tableau, aucun vide ;
     • un fichier sans AUCUNE colonne d'écart affiche la note, pas un cadre
       muet. */
const { readFileSync } = require('node:fs');
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const DATA = read('src/components/DockingData.jsx');
const SEC = read('src/components/DockingSections.jsx');

const grab = (name, end) => {
  const m = DATA.match(new RegExp(`export const ${name} = [\\s\\S]*?${end}`));
  if (!m) throw new Error(`${name} introuvable`);
  return m[0].replace(/^export\s+/, '');
};
const api = new Function(
  [grab('parseCapriTsv', '\n};'), grab('CAPRI_METRIC_SYNONYMS', '\n};'),
   grab('normMetricColumn', ';'), grab('posesFromCapri', '\n};'),
   grab('parseDockingValue', '\n};'), grab('DOCKING_METRICS', '\n];'),
   grab('dockingMetricOf', '\n};'),
   grab('CAPRI_RAW_PREFIX', ';'), grab('poseRawMetric', '\n};'),
   grab('LEGACY_POSE_KEYS', '\n};'), grab('poseMetricValue', '\n};'),
   grab('capriColumnMetricKey', '\n};'), grab('chartEnergyMetricKey', ';'),
   grab('poseChartValue', '\n};'), grab('poseRawColumnValue', ';'),
   grab('DEVIATION_PLOT_KEYS', ';'), grab('ENERGY_PLOT_KEYS', ';'), grab('dockingMetricLabel', ';'),
   grab('poseDeviation', '\n};'),
   grab('unclaimedColumnMatching', '\n};'), grab('deviationColumnOf', ';'),
   grab('energyColumnOf', ';'), grab('PLOT_SOURCE_PREFIX', ';'),
   grab('PLOT_SOURCE_ALL', ';'), grab('plotSourceOptions', '\n};'),
   grab('plotSourceLabel', '\n};'), grab('plotSourceValue', '\n};')].join('\n')
  + '\nreturn { parseCapriTsv, posesFromCapri, parseDockingValue, normMetricColumn,'
  + ' DOCKING_METRICS, dockingMetricOf, dockingMetricLabel, CAPRI_RAW_PREFIX, poseRawMetric,'
  + ' LEGACY_POSE_KEYS, poseMetricValue, capriColumnMetricKey, chartEnergyMetricKey,'
  + ' poseChartValue, poseRawColumnValue, DEVIATION_PLOT_KEYS, poseDeviation,'
  + ' unclaimedColumnMatching, deviationColumnOf, energyColumnOf, PLOT_SOURCE_PREFIX,'
  + ' PLOT_SOURCE_ALL, plotSourceOptions, plotSourceLabel, plotSourceValue };'
)();

// ── le bloc de dérivation de DockingAnalysisSection, extrait du source ───────
const START = 'const rows = d.poses.map((p, i) => {';
const END = 'const energyBreakdownData';
const b0 = SEC.indexOf(START);
const b1 = SEC.indexOf(END);
if (b0 < 0 || b1 < 0) throw new Error('bloc de dérivation introuvable');
const BLOCK = SEC.slice(b0, b1);
const analyze = new Function(
  'd', 'activeTest', 'cfg', 'unit', 'DOCKING_METRICS', 'poseMetricValue',
  'chartEnergyMetricKey', 'dockingMetricOf', 'poseChartValue', 'poseDeviation',
  'energyColumnOf', 'deviationColumnOf', 'parseDockingValue', 'poseRawColumnValue',
  'DEVIATION_PLOT_KEYS', 'dockingMetricLabel', 'PLOT_SOURCE_PREFIX', 'PLOT_SOURCE_ALL',
  'plotSourceOptions', 'plotSourceLabel', 'plotSourceValue',
  `${BLOCK}
   return { rows, energyKey, energyName, energyAxisTitle, rmsdAxisTitle,
     energyFromColumn, deviationFromColumn, affinityData, rmsdData, missingEnergy,
     xOptions, xChoice, yChoice, allDeviations, rmsdSeriesData, plottedSeries, plottedPoints };`
);

const run = (label, { columns, poses, activeValues = {}, program = 'haddock', cfg = {} }) => {
  const d = { poses, activeValues, dockingProgram: program, programInfo: { energyUnit: 'kcal/mol' } };
  const activeTest = { dockingCapri: { columns } };
  const out = analyze(d, activeTest, cfg, 'kcal/mol', api.DOCKING_METRICS,
    api.poseMetricValue, api.chartEnergyMetricKey, api.dockingMetricOf,
    api.poseChartValue, api.poseDeviation, api.energyColumnOf,
    api.deviationColumnOf, api.parseDockingValue, api.poseRawColumnValue,
    api.DEVIATION_PLOT_KEYS, api.dockingMetricLabel, api.PLOT_SOURCE_PREFIX,
    api.PLOT_SOURCE_ALL, api.plotSourceOptions, api.plotSourceLabel, api.plotSourceValue);
  console.log(`\n### ${label}`);
  console.log(`  energyKey=${out.energyKey}  energyName="${out.energyName}"  deviationFromColumn=${JSON.stringify(out.deviationFromColumn)}`);
  console.log(`  energie : ${out.affinityData.length}/${out.rows.length} poses   nuage : ${out.rmsdData.length}/${out.rows.length} points`);
  if (out.rmsdData.length === 0 && out.rows.length) {
    console.log(`  >> NUAGE VIDE — note affichée : ${out.missingEnergy ? 'No score' : 'No RMSD'}`);
  }
  return out;
};

// ── A) capri_ss.tsv de HADDOCK3 complet, import frais ────────────────────────
const H3 = [
  'structure\tmodel-cluster_ranking\tcluster_id\tcluster_size\tscore\tdesolv\telec\tvdw\tair\tbsa\ttotal\tirmsd\tlrmsd\tilrmsd\trmsd\tfnat\tdockq',
  'run1/it1/cluster_1_1.pdb\t1\t1\t4\t-52.31\t8.4\t-210.8\t-42.6\t-15.2\t1240.5\t-118.62\t0.512\t0.912\t1.404\t1.404\t0.71\t0.83',
  'run1/it1/cluster_1_2.pdb\t2\t1\t4\t-48.90\t7.1\t-198.4\t-38.1\t-12.9\t1188.0\t-97.15\t0.734\t1.234\t2.015\t2.015\t0.66\t0.79'
].join('\n');
const parsedA = api.parseCapriTsv(H3);
run('A) HADDOCK3 capri_ss.tsv — import frais', {
  columns: parsedA.columns, poses: api.posesFromCapri(parsedA)
});

// ── B) mêmes colonnes, mais poses d'un import ANCIEN (clés canoniques non
//      remplies : seules les colonnes brutes capri_* existent) ──────────────
const oldPoses = parsedA.rows.map((row, i) => {
  const p = { mode: i + 1, label: `cluster_1_${i + 1}.pdb`, program: 'haddock', affinity: 0 };
  parsedA.columns.forEach((c, ci) => { p[`capri_${c}`] = row[ci]; });
  return p;
});
run('B) mêmes lignes, poses enregistrées par une version antérieure', {
  columns: parsedA.columns, poses: oldPoses
});

// ── C) fichier avec « total » + « i-RMSD » seulement, poses anciennes ────────
const C = [
  'structure\ttotal\tirmsd',
  'clus_1.pdb\t-118.62\t0.512',
  'clus_2.pdb\t-97.15\t0.734'
].join('\n');
const parsedC = api.parseCapriTsv(C);
const oldC = parsedC.rows.map((row, i) => {
  const p = { mode: i + 1, label: `clus_${i + 1}.pdb`, program: 'haddock' };
  parsedC.columns.forEach((c, ci) => { p[`capri_${c}`] = row[ci]; });
  return p;
});
run('C) « total » + « i-RMSD » seulement, poses anciennes', {
  columns: parsedC.columns, poses: oldC
});

// ── D) Vina (affinity / rmsd_lb / rmsd_ub) ──────────────────────────────────
const V = [
  'mode\taffinity\trmsd_lb\trmsd_ub',
  '1\t-9.1\t0.0\t0.0',
  '2\t-8.4\t1.231\t2.019'
].join('\n');
const parsedV = api.parseCapriTsv(V);
run('D) Vina — import frais', {
  columns: parsedV.columns, poses: api.posesFromCapri(parsedV), program: 'vina'
});
const oldV = parsedV.rows.map((row, i) => {
  const p = { mode: i + 1, label: `mode_${i + 1}`, program: 'vina' };
  parsedV.columns.forEach((c, ci) => { p[`capri_${c}`] = row[ci]; });
  return p;
});
run('D2) Vina — poses anciennes (colonnes brutes seules)', {
  columns: parsedV.columns, poses: oldV, program: 'vina'
});

// ── E) colonne d'écart NON réclamée (RMSD_interface) ────────────────────────
const E = [
  'structure\ttotal\tRMSD_interface',
  'clus_1.pdb\t-118.62\t0.512',
  'clus_2.pdb\t-97.15\t0.734'
].join('\n');
const parsedE = api.parseCapriTsv(E);
run('E) colonne non réclamée « RMSD_interface »', {
  columns: parsedE.columns, poses: api.posesFromCapri(parsedE)
});

// ── F) valeurs SAISIES à la main dans le tableau ────────────────────────────
run('F) valeurs saisies à la main (cellules éditables)', {
  columns: [], program: 'haddock',
  poses: [
    { mode: 1, label: 'cluster_1_1.pdb', program: 'haddock', energy_total: -118.62 },
    { mode: 2, label: 'cluster_1_2.pdb', program: 'haddock', energy_total: -97.15 }
  ],
  activeValues: { '0-lrmsd': '0.912', '1-lrmsd': '1.234' }
});

// ── G) aucune colonne d'écart dans le fichier du tout ───────────────────────
const G = [
  'structure\ttotal\tdockq\tfnat',
  'clus_1.pdb\t-118.62\t0.83\t0.71',
  'clus_2.pdb\t-97.15\t0.79\t0.66'
].join('\n');
const parsedG = api.parseCapriTsv(G);
run('G) fichier sans aucune colonne d’écart', {
  columns: parsedG.columns, poses: api.posesFromCapri(parsedG)
});

/* ── VÉRIFICATIONS : l'axe X de l'écart choisi à la main, et « tous les écarts ».
   Le nombre de points obtenu est celui que le nuage affiche. */
const check = (label, { columns, poses, cfg = {}, program = 'haddock' }) => {
  const d = { poses, activeValues: {}, dockingProgram: program, programInfo: { energyUnit: 'kcal/mol' } };
  const activeTest = { dockingCapri: { columns } };
  return analyze(d, activeTest, cfg, 'kcal/mol', api.DOCKING_METRICS,
    api.poseMetricValue, api.chartEnergyMetricKey, api.dockingMetricOf,
    api.poseChartValue, api.poseDeviation, api.energyColumnOf,
    api.deviationColumnOf, api.parseDockingValue, api.poseRawColumnValue,
    api.DEVIATION_PLOT_KEYS, api.dockingMetricLabel, api.PLOT_SOURCE_PREFIX,
    api.PLOT_SOURCE_ALL, api.plotSourceOptions, api.plotSourceLabel, api.plotSourceValue);
};
const expect = (what, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error(`${what} : attendu ${JSON.stringify(want)}, obtenu ${JSON.stringify(got)}`);
  }
  console.log(`  ok  ${what}`);
};

console.log('\n### VÉRIFICATIONS');

// Une colonne d'écart qu'aucune devinette ne couvre.
const H = [
  'structure\ttotal\tLigand_dev',
  'clus_1.pdb\t-118.62\t1.42',
  'clus_2.pdb\t-97.15\t2.05'
].join('\n');
const parsedH = api.parseCapriTsv(H);
const hPoses = api.posesFromCapri(parsedH);
const hAuto = check('H1', { columns: parsedH.columns, poses: hPoses });
expect('H1 « Ligand_dev » laisse en Auto : aucun point devine', hAuto.rmsdData.length, 0);
expect('H1 le selecteur propose la colonne', hAuto.xOptions.some((o) => o.value === 'col:Ligand_dev'), true);
const hManual = check('H2', { columns: parsedH.columns, poses: hPoses, cfg: { xColumn: 'col:Ligand_dev' } });
expect('H2 « col:Ligand_dev » choisi : 2 points', hManual.rmsdData.length, 2);
expect('H2 le point relit la valeur du tableau', hManual.rmsdData[0].rmsd, 1.42);

// L'axe X suit DEVIATION_PLOT_KEYS : l'i-RMSD d'abord, puis ceux qu'on choisit.
const J = [
  'structure\tscore\tirmsd\tlrmsd\trmsd',
  'clus_1.pdb\t-52.31\t0.512\t1.912\t2.512',
  'clus_2.pdb\t-48.90\t0.734\t1.234\t2.015'
].join('\n');
const parsedJ = api.parseCapriTsv(J);
const jPoses = api.posesFromCapri(parsedJ);
const jAuto = check('J1', { columns: parsedJ.columns, poses: jPoses });
expect('J1 l abscisse « Auto » est l i-RMSD', jAuto.rmsdAxisTitle, 'i-RMSD (Å)');
expect('J1 …et ses valeurs sont tracees', jAuto.rmsdData.map((r) => r.rmsd), [0.512, 0.734]);
const jManual = check('J2', { columns: parsedJ.columns, poses: jPoses, cfg: { xColumn: 'metric:rmsd' } });
expect('J2 « metric:rmsd » choisi : le RMSD global', jManual.rmsdData.map((r) => r.rmsd), [2.512, 2.015]);

// « All deviations » : un nuage par écart du tableau.
const allOut = check('I', { columns: parsedA.columns, poses: api.posesFromCapri(parsedA), cfg: { xColumn: api.PLOT_SOURCE_ALL } });
expect('I « All deviations » : un nuage par ecart', allOut.plottedSeries.map((s) => s.short),
  ['i-RMSD', 'l-RMSD', 'i-l-RMSD', 'RMSD']);
expect('I …et chacun a ses points', allOut.plottedSeries.map((s) => s.points.length), [2, 2, 2, 2]);

console.log('\nToutes les vérifications passent ✔');
