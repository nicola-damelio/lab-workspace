/* ============================================================================
   _docking_scatter_card_test.mjs

   « Total energy as a function of i-RMSD » ne s'affichait pas sur une
   expérience de docking. Deux causes, toutes deux corrigées ici :

     1. le nuage « énergie vs. écart à la référence » vivait dans une section
        REPLIÉE (`defaultOpen={allDeviations}`, soit false en mode Auto) — or une
        section repliée ne rend pas ses enfants : le graphe n'était pas dessiné
        du tout (aucun corps de graphe dans la page). Ce n'est pas le fait d'être
        « imbriqué » qui le cachait — les autres graphiques sont imbriqués de la
        même façon — c'est d'être fermé sans que rien ne l'annonce. Un graphe QUI
        A DES POINTS s'ouvre maintenant tout seul (`points.length > 0`), un graphe
        vide reste replié (la note dit alors quoi importer / saisir).
     2. l'abscisse « Auto » suit DEVIATION_PLOT_KEYS — l'i-RMSD d'abord — mais un
        jeu de poses HADDOCK fraîchement généré n'avait AUCUN i-RMSD : l'axe
        retombait sur le l-RMSD, et « énergie vs. i-RMSD » n'existait donc sur
        aucune expérience neuve. `generateHADDOCKPoses` fournit désormais
        l'i-RMSD (CAPRI : interface ≤ ligand).

   Le composant est importé pour de vrai (transformé par le bundler du projet,
   rolldown) et rendu avec react-dom/server : ce que la page DESSINE est vérifié
   — titre de la carte, carte ouverte, corps du graphe présent — et pas seulement
   la présence d'un texte dans la source.
   ========================================================================= */
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { rolldown } from 'rolldown';

const results = [];
let passed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passed += 1;
  else results.push(`✗ ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
};
const checkTrue = (name, cond) => check(name, !!cond, true);
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const DOCK_DATA = read('src/components/DockingData.jsx');

/* ── 1. le VRAI composant, avec le bundler du projet ─────────────────────────
   Les modules qui ne vivent que dans le navigateur (viewer NGL, Drive/Firebase,
   restauration) sont remplacés par des bouchons : la section d'analyse n'en
   dépend pas, et le rendu doit rester possible hors navigateur. */
const BROWSER_ONLY = ['NMRMoleculeViewer', 'DriveUpload', 'useDriveAutoRestore',
  'driveRestore', 'pdbStore', 'driveUpload', 'driveNaming'];
const bundle = await rolldown({
  input: 'src/components/DockingSections.jsx',
  external: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime',
    'react-dom', 'react-dom/server', 'recharts', 'fflate'],
  transform: { jsx: { runtime: 'automatic' } },
  plugins: [{
    name: 'stub-browser-only',
    resolveId(source, importer) {
      return importer && BROWSER_ONLY.some((n) => source.includes(n)) ? '\0stub' : null;
    },
    load(id) {
      if (id !== '\0stub') return null;
      return 'export default function Stub(){return null;}\n'
        + 'export const DriveUploadButton=()=>null;\n'
        + "export const suggestDriveFileName=()=>'';\n"
        + 'export const getDriveToken=async()=>null;\n'
        + 'export const uploadLocalFile=async()=>null;\n'
        + 'export const cloudBackendAvailable=()=>false;\n'
        + 'export const storeJson=async()=>null;\n'
        + 'export const loadJson=async()=>null;\n'
        + 'export const archiveRestoreJson=async()=>null;\n'
        + 'export const placeRestorePointer=()=>null;\n'
        + 'export const restoreJsonFor=()=>null;\n'
        + 'export const restoreStems=()=>[];\n'
        + 'export const takePendingRestorePointer=()=>null;\n'
        + 'export const useDriveAutoRestore=()=>null;\n';
    }
  }]
});
const { output } = await bundle.generate({ format: 'esm' });
const BUNDLE = 'tmp_dock_card_bundle.mjs';
fs.writeFileSync(BUNDLE, output.map((o) => o.code).join('\n'), 'utf8');
const { DockingAnalysisSection } = await import(`./${BUNDLE}`);

/* ── 2. ce que la page dessine : une carte par CollapsibleSection ────────────
   Repliée, une section ne rend PAS ses enfants (voir ui.jsx : `{isOpen && …}`) :
   une carte absente du HTML est exactement un graphe absent de l'écran. */
const CARD = 'bg-white rounded-xl shadow-sm border border-slate-200 mb-3';
const cards = (html) => html.split(CARD).slice(1).map((seg) => {
  const t = /truncate select-none">([^<]*)</.exec(seg);
  return { title: t ? t[1] : '?', open: seg.includes('class="p-3"'), seg };
});
const render = (activeTest) => renderToStaticMarkup(React.createElement(
  DockingAnalysisSection, { ctx: { activeTest, updateActiveTest: () => {} } }
));
const card = (html, title) => cards(html).find((c) => c.title === title) || null;

/* ── 3. capri_ss.tsv de HADDOCK3 : les écarts CAPRI + l'énergie totale ────── */
const CAPRI = [
  'structure\tmodel-cluster_ranking\tcluster_id\tcluster_size\tscore\tdesolv\telec\tvdw\tair\tbsa\ttotal\tirmsd\tlrmsd\tilrmsd\trmsd\tfnat\tdockq',
  'run1/it1/cluster_1_1.pdb\t1\t1\t4\t-52.31\t8.4\t-210.8\t-42.6\t-15.2\t1240.5\t-118.62\t0.512\t0.912\t1.404\t1.404\t0.71\t0.83',
  'run1/it1/cluster_1_2.pdb\t2\t1\t4\t-48.90\t7.1\t-198.4\t-38.1\t-12.9\t1188.0\t-97.15\t0.734\t1.234\t2.015\t2.015\t0.66\t0.79'
].join('\n');
const capriColumns = CAPRI.split('\n')[0].split('\t');
const capriPoses = CAPRI.split('\n').slice(1).map((line, i) => {
  const cells = line.split('\t');
  const p = { mode: i + 1, program: 'haddock', label: cells[0] };
  capriColumns.forEach((c, ci) => { p[`capri_${c}`] = cells[ci]; });
  return p;
});

/* ═══ A) une expérience HADDOCK neuve : AUCUN fichier importé ═══════════════
   La page génère ses poses elle-même (`generateHADDOCKPoses`). Le graphe
   « énergie totale vs. i-RMSD » doit y être, et DESSINÉ. */
const fresh = render({ name: 'probe', dockingProgram: 'haddock' });
const freshScatter = card(fresh, 'Total energy (kcal/mol) vs. i-RMSD');
checkTrue('[A] une expérience HADDOCK neuve trace « Total energy (kcal/mol) vs. i-RMSD »',
  !!freshScatter);
check('[A] …et le graphe est OUVERT (dessiné, jamais caché derrière un clic)',
  freshScatter ? freshScatter.open : null, true);
checkTrue('[A] …avec son corps de graphe (zone + double-clic pour éditer)',
  !!freshScatter && freshScatter.seg.includes('class="select-none relative"')
  && freshScatter.seg.includes('Double-click a curve, an axis or a label to edit it'));
check('[A] le titre de la carte nomme l’abscisse tracée', freshScatter ? freshScatter.title : null,
  'Total energy (kcal/mol) vs. i-RMSD');
checkTrue('[A] …donc plus jamais « vs. l-RMSD » faute d’i-RMSD dans les poses',
  !fresh.includes('vs. l-RMSD'));
check('[A] les autres cartes gardent leur état replié (le graphe ne force personne)',
  cards(fresh).filter((c) => c.open).length, 1);

/* ═══ B) un capri_ss.tsv importé (HADDOCK3) ════════════════════════════════ */
const imported = render({
  name: 'probe', dockingProgram: 'haddock',
  dockingPoses: capriPoses, dockingCapri: { columns: capriColumns }
});
const impScatter = card(imported, 'Total energy (kcal/mol) vs. i-RMSD');
checkTrue('[B] un capri_ss.tsv importé trace « Total energy (kcal/mol) vs. i-RMSD »', !!impScatter);
check('[B] …ouvert', impScatter ? impScatter.open : null, true);

/* ═══ C) le choix EXPLICITE de l'abscisse prime sur « Auto » ═══════════════ */
const chosen = render({
  name: 'probe', dockingProgram: 'haddock',
  dockingPoses: capriPoses, dockingCapri: { columns: capriColumns },
  dockingAnalysisCfg: { xColumn: 'metric:lrmsd' }
});
checkTrue('[C] choisir le l-RMSD renomme la carte et la garde dessinée',
  !!card(chosen, 'Total energy (kcal/mol) vs. l-RMSD (Å)'));

/* ═══ D) Vina : les bornes de RMSD, pas d'i-RMSD ══════════════════════════ */
const vina = render({ name: 'probe', dockingProgram: 'vina' });
const vinaScatter = card(vina, 'Affinity (kcal/mol) vs. RMSD l.b.');
checkTrue('[D] une expérience Vina trace « Affinity (kcal/mol) vs. RMSD l.b. »', !!vinaScatter);
check('[D] …ouvert', vinaScatter ? vinaScatter.open : null, true);

/* ═══ E) aucun écart dans la table : la carte reste repliée, et la note dit
        quoi importer / saisir (un graphe vide ne s'ouvre pas tout seul) ═════ */
const empty = render({
  name: 'probe', dockingProgram: 'vina',
  dockingPoses: [{ mode: 1, program: 'vina', affinity: -8.1 }]
});
const emptyScatter = card(empty, 'Affinity (kcal/mol) vs. RMSD');
checkTrue('[E] sans le moindre écart, la carte « vs. RMSD » existe', !!emptyScatter);
check('[E] …et reste repliée (rien à dessiner)', emptyScatter ? emptyScatter.open : null, false);
checkTrue('[E] la note dit quoi importer / saisir',
  empty.includes('No RMSD in the results table'));

/* ── 4. le générateur de poses HADDOCK, exécuté pour de vrai ─────────────────
   Un graphe ne peut pas tracer un écart absent : l'i-RMSD doit VENIR des poses,
   et rester ≤ le l-RMSD (CAPRI). */
const grab = (name, end) => {
  const m = DOCK_DATA.match(new RegExp(`export const ${name} = [\\s\\S]*?${end}`));
  if (!m) throw new Error(`${name} introuvable dans DockingData.jsx`);
  return m[0].replace(/^export\s+/, '');
};
const api = new Function(
  [grab('parseDockingValue', '\n};'), grab('DEVIATION_PLOT_KEYS', ';'),
    grab('poseDeviation', '\n};'), grab('generateHADDOCKPoses', '\n};')].join('\n')
  + '\nreturn { parseDockingValue, DEVIATION_PLOT_KEYS, poseDeviation, generateHADDOCKPoses };'
)();
const poses = api.generateHADDOCKPoses(12);
check('[F] DEVIATION_PLOT_KEYS trace l’i-RMSD en tête', api.DEVIATION_PLOT_KEYS[0], 'irmsd');
check('[F] les 12 poses HADDOCK portent un i-RMSD numérique',
  poses.filter((p) => typeof p.irmsd === 'number' && Number.isFinite(p.irmsd)).length, 12);
checkTrue('[F] …et il est ≤ le l-RMSD (interface ≤ ligand, comme CAPRI)',
  poses.every((p) => p.irmsd <= p.lrmsd));
check('[F] l’abscisse « Auto » lit CET i-RMSD (et pas le l-RMSD)',
  poses.map((p) => api.poseDeviation(p) === p.irmsd), poses.map(() => true));
checkTrue('[F] l’énergie totale reste tracée en ordonnée',
  poses.every((p) => typeof p.energy_total === 'number'));

/* ── report ───────────────────────────────────────────────────────────────── */
try { fs.unlinkSync(BUNDLE); } catch { /* ignore */ }
if (results.length) {
  console.log(results.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`${passed} vérifications OK — le nuage « énergie vs. i-RMSD » est dessiné`);
}
