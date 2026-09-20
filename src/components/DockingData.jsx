import React from 'react';
import { seriesColorFor, chartBoxStyle } from '../utils/chartStyle';

/* ============================================================================
   DockingData — shared molecular-docking building blocks imported by
   DockingSections.jsx. Mirrors the structure of MDData.jsx, but every
   database / parser / generator is adapted for docking instead of MD.
============================================================================ */

// ================= RE-EXPORT SHARED STRUCTURE CODE =================
export {
  FS_CLASSES,
  OVERLAY_CLASSES,
  SELECT_COLOR,
  MANUAL_COLOR,
  LINE_COLORS,
  AMINO_ACID_DB,
  NUCLEOTIDE_DB,
  SUGAR_DB,
  LIPID_DB,
  CARBON_RANGE_DB,
  SS_CORRECTIONS,
  SS_META,
  FORM_META,
  DNA_FORM_OFFSETS,
  SUGAR_ANOMER_OFFSETS,
  RESIDUE_COLORS,
  TICKS_1H,
  TICKS_13C,
  TICKS_15N,
  CHART_MARGIN,
  CHART_MARGIN_1D,
  parseManual,
  getNMRFillColor,
  getCarbonName,
  buildKeys,
  getProtonCountEx,
  getPascalRow,
  getCarbonRangeFor,
  getHexagon,
  getPentagon,
  hexAt,
  fusePentagon,
  makeBuilder,
  buildProteinStructure,
  buildNucleicStructure,
  buildSugarStructure,
  buildLipidStructure,
  elementsToSVG,
  ensureSvgSize,
  svgToPngDataUrl,
  StructureSVGView,
  CollapsibleSection,
  SequencePaintStrip,
  CustomXTick1H,
  CustomYTick1H,
  CustomXTick13C,
  CustomYTick13C,
  NMRTooltip,
  RangeBarChart,
  OneDSpectrumPlot,
  SpectrumPlot,
  HSQCPlot,
  CHEMICAL_SHIFT_LAYER,
  makeLayerId,
  getSelectedKeys,
  selectionLabel,
  getManualKeys,
  normalizeImageCandidates,
  SmartImage
} from './NMRData';

// ================= DOCKING-SPECIFIC CONSTANTS =================
export const DOCK_SELECT_COLOR = '#f59e0b';
export const DOCK_MANUAL_COLOR = '#16a34a';
export const DOCK_LINE_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16'
];
export const DOCK_CHART_MARGIN = { top: 20, right: 20, bottom: 45, left: 50 };
export const DOCK_CHART_MARGIN_1D = { top: 10, right: 15, bottom: 45, left: 15 };

// ================= DOCKING PROGRAMS =================
export const DOCKING_PROGRAMS = {
  vina: {
    name: 'AutoDock Vina',
    versions: ['1.1.2', '1.2.0', '1.2.2', '1.2.3', '1.2.4', '1.2.5'],
    scoringFunctions: ['vina', 'vinardo'],
    searchAlgorithms: ['Iterated local search', 'Monte Carlo'],
    energyUnit: 'kcal/mol',
    description: 'AutoDock Vina — gradient-based local search docking',
    fileFormats: ['config.txt', 'out.pdbqt', 'log.txt']
  },
  autodock4: {
    name: 'AutoDock 4',
    versions: ['4.2', '4.2.6'],
    scoringFunctions: ['autodock4'],
    searchAlgorithms: ['Lamarckian GA', 'Genetic Algorithm', 'Local Search', 'Simulated Annealing'],
    energyUnit: 'kcal/mol',
    description: 'AutoDock 4 — Lamarckian genetic-algorithm docking',
    fileFormats: ['.dpf', '.gpf', '.dlg']
  },
  autodock_gpu: {
    name: 'AutoDock-GPU',
    versions: ['1.5', '1.6'],
    scoringFunctions: ['autodock4'],
    searchAlgorithms: ['ADADELGA', 'Solis-Wets', 'Firefly'],
    energyUnit: 'kcal/mol',
    description: 'GPU-accelerated AutoDock',
    fileFormats: ['.xml', '.dlg']
  },
  haddock: {
    name: 'HADDOCK',
    versions: ['2.4', '2.5', '3.0 (web)'],
    scoringFunctions: ['haddock-score'],
    searchAlgorithms: ['Rigid-body (it0)', 'Semi-flexible (it1)', 'Water refinement (it1w)'],
    energyUnit: 'a.u.',
    description: 'HADDOCK — ambiguity-driven biomolecular docking',
    fileFormats: ['.csv', '.param', '.tbl']
  },
  glide: {
    name: 'Glide (Schrödinger)',
    versions: ['SP', 'XP', 'IFD'],
    scoringFunctions: ['GlideScore-SP', 'GlideScore-XP'],
    searchAlgorithms: ['HTVS', 'SP', 'XP'],
    energyUnit: 'kcal/mol',
    description: 'Schrödinger Glide docking',
    fileFormats: ['.maegz', '.csv']
  },
  gold: {
    name: 'GOLD',
    versions: ['2022', '2023'],
    scoringFunctions: ['GoldScore', 'ChemScore', 'ASP', 'ChemPLP'],
    searchAlgorithms: ['Genetic Algorithm'],
    energyUnit: 'a.u.',
    description: 'CCDC GOLD genetic-algorithm docking',
    fileFormats: ['_results.mol2', '_table.csv']
  }
};

// ================= DOCKING METRICS =================
/* Les grandeurs d'un résultat d'amarrage, avec LEUR unité.
   `programs` = « cette colonne est attendue pour ce programme » : elle est alors
   affichée dans le tableau de résultats même quand l'import ne l'a pas fournie
   (l'utilisateur voit la colonne, son unité, et peut saisir la valeur à la
   main). Une grandeur absente d'un programme n'encombre pas les autres.
   `haddock` remplace le libellé / l'unité pour HADDOCK : son score est une somme
   PONDÉRÉE de termes énergétiques, exprimée en unités arbitraires (a.u.) — pas
   une énergie en kcal/mol. */
export const DOCKING_METRICS = [
  // ── Le score du programme ──────────────────────────────────────────────────
  { key: 'affinity', label: 'Affinity', unit: 'kcal/mol',
    haddock: { label: 'HADDOCK score', unit: 'a.u.' },
    programs: ['vina', 'autodock4', 'autodock_gpu', 'haddock'],
    description: 'Docking score — « HADDOCK score », en unités arbitraires, pour HADDOCK' },
  { key: 'energy_total', label: 'Total energy', unit: 'kcal/mol',
    programs: ['haddock'], description: 'Énergie de liaison totale (le graphique d’affinité trace CE terme)' },
  // ── Écarts à la structure de référence (Å) ─────────────────────────────────
  { key: 'irmsd', label: 'i-RMSD', unit: 'Å', programs: ['haddock'], description: 'Interface RMSD (CAPRI)' },
  { key: 'lrmsd', label: 'l-RMSD', unit: 'Å', programs: ['haddock'], description: 'Ligand RMSD (CAPRI)' },
  { key: 'ilrmsd', label: 'i-l-RMSD', unit: 'Å', programs: ['haddock'], description: 'Interface ligand RMSD (CAPRI)' },
  { key: 'rmsd', label: 'RMSD', unit: 'Å', programs: ['haddock'], description: 'RMSD from the reference structure' },
  { key: 'rmsd_lb', label: 'RMSD l.b.', unit: 'Å', programs: ['vina', 'autodock4', 'autodock_gpu'], description: 'RMSD lower bound from the best mode' },
  { key: 'rmsd_ub', label: 'RMSD u.b.', unit: 'Å', programs: ['vina', 'autodock4', 'autodock_gpu'], description: 'RMSD upper bound from the best mode' },
  // ── Surface enfouie (Å²) ───────────────────────────────────────────────────
  { key: 'bsa', label: 'BSA', unit: 'Å²', programs: ['haddock'], description: 'Buried surface area' },
  // ── Termes énergétiques et restreintes (kcal/mol) ──────────────────────────
  { key: 'energy_vdw', label: 'E vdW', unit: 'kcal/mol', programs: ['haddock'], description: 'van der Waals energy' },
  { key: 'energy_elec', label: 'E elec', unit: 'kcal/mol', programs: ['haddock'], description: 'Electrostatic energy' },
  { key: 'energy_desolv', label: 'E desolv', unit: 'kcal/mol', programs: ['haddock'], description: 'Desolvation energy' },
  { key: 'energy_air', label: 'E air', unit: 'kcal/mol', programs: ['haddock'], description: 'Ambiguous Interaction Restraints energy' },
  { key: 'energy_angles', label: 'E angles', unit: 'kcal/mol', programs: ['haddock'], description: 'Bond-angle restraint energy' },
  { key: 'energy_bonds', label: 'E bonds', unit: 'kcal/mol', programs: ['haddock'], description: 'Bond-length restraint energy' },
  { key: 'energy_dihe', label: 'E dihe', unit: 'kcal/mol', programs: ['haddock'], description: 'Dihedral restraint energy' },
  { key: 'energy_improper', label: 'E improper', unit: 'kcal/mol', programs: ['haddock'], description: 'Improper-dihedral restraint energy' },
  { key: 'energy_cdih', label: 'E cdih', unit: 'kcal/mol', programs: ['haddock'], description: 'J-coupling (dihedral) restraint energy' },
  { key: 'energy_coup', label: 'E coup', unit: 'kcal/mol', programs: ['haddock'], description: 'Coupling restraint energy' },
  { key: 'energy_dani', label: 'E dani', unit: 'kcal/mol', programs: ['haddock'], description: 'DANI (RDC) restraint energy' },
  { key: 'energy_rdcs', label: 'E rdcs', unit: 'kcal/mol', programs: ['haddock'], description: 'RDC restraint energy' },
  { key: 'energy_rg', label: 'E rg', unit: 'kcal/mol', programs: ['haddock'], description: 'Radius-of-gyration restraint energy' },
  { key: 'energy_sym', label: 'E sym', unit: 'kcal/mol', programs: ['haddock'], description: 'Symmetry restraint energy' },
  { key: 'energy_vean', label: 'E vean', unit: 'kcal/mol', programs: ['haddock'], description: 'VEAN (pseudo-contact shift) restraint energy' },
  { key: 'energy_xpcs', label: 'E xpcs', unit: 'kcal/mol', programs: ['haddock'], description: 'XPCS (residual dipolar coupling) restraint energy' },
  // ── Qualité CAPRI (adimensionnel, 0 → 1) ───────────────────────────────────
  { key: 'fnat', label: 'fnat', unit: '0–1', programs: ['haddock'], description: 'Fraction of native contacts (0 → 1)' },
  { key: 'fcc', label: 'FCC', unit: '0–1', description: 'Fraction of common contacts (0 → 1)' },
  { key: 'dockq', label: 'DockQ', unit: '0–1', programs: ['haddock'], description: 'CAPRI quality score (0 → 1)' },
  // ── Classements et clusters (adimensionnel, entiers) ───────────────────────
  { key: 'caprieval_rank', label: 'CAPRI rank', unit: '', programs: ['haddock'], description: 'caprieval_rank — rang de la pose (entier)' },
  { key: 'cluster_id', label: 'Cluster id', unit: '', programs: ['haddock'], description: 'cluster_id (entier)' },
  { key: 'cluster_ranking', label: 'Cluster ranking', unit: '', programs: ['haddock'], description: 'cluster_ranking (entier)' },
  { key: 'model_cluster_ranking', label: 'Model/cluster ranking', unit: '', programs: ['haddock'], description: 'model-cluster_ranking (entier)' },
  { key: 'cluster_size', label: 'Cluster size', unit: '', programs: ['haddock'], description: 'Nombre de modèles du cluster (entier)' },
  // ── Spécifiques Vina / AutoDock ────────────────────────────────────────────
  { key: 'population', label: 'Population', unit: '%', description: 'Cluster population' },
  { key: 'energy_inter', label: 'Intermolecular', unit: 'kcal/mol', description: 'Intermolecular energy' },
  { key: 'energy_intra', label: 'Intramolecular', unit: 'kcal/mol', description: 'Intramolecular / internal energy' },
  { key: 'energy_torsional', label: 'Torsional', unit: 'kcal/mol', description: 'Torsional free energy' },
  { key: 'h_bonds', label: 'H-Bonds', unit: 'count', programs: ['vina', 'autodock4', 'autodock_gpu'], description: 'Hydrogen bonds at interface' },
  { key: 'contacts', label: 'Contacts', unit: 'count', programs: ['vina', 'autodock4', 'autodock_gpu'], description: 'Interface contacts' },
  { key: 'ki', label: 'Ki', unit: 'nM', programs: ['vina', 'autodock4', 'autodock_gpu'], description: 'Estimated inhibition constant' }
];

/** Libellé / unité d'une métrique POUR UN PROGRAMME : lire les deux évite que le
 *  score HADDOCK s'affiche « (kcal/mol) » dans le tableau de résultats. */
export const dockingMetricOf = (metric, program) => {
  if (!metric) return { label: '', unit: '' };
  const hk = program === 'haddock' ? metric.haddock : null;
  return {
    ...metric,
    label: (hk && hk.label) || metric.label,
    unit: hk && hk.unit !== undefined ? hk.unit : metric.unit
  };
};
export const dockingMetricLabel = (metric, program) => dockingMetricOf(metric, program).label;
export const dockingMetricUnit = (metric, program) => dockingMetricOf(metric, program).unit;

/* ── CE QUE TRACE CHAQUE GRAPHIQUE ───────────────────────────────────────────
   `poseBindingEnergy` : l'ÉNERGIE DE LIAISON en kcal/mol — l'énergie TOTALE du
   terme HADDOCK (`total`) quand elle existe, l'affinité pour Vina / AutoDock
   (c'est la même chose : leur affinité EST l'énergie de liaison). Pour HADDOCK un
   score en a.u. n'est PAS une énergie : il n'est jamais tracé sur cet axe.
   `poseDeviation` : l'écart à la référence en Å — l'i-RMSD d'abord (c'est la
   mesure de qualité de l'interface que le nuage « énergie vs RMSD » doit
   montrer quand le fichier la porte), puis le l-RMSD (CAPRI), les DEUX bornes de
   Vina / AutoDock (« RMSD l.b. » ET « RMSD u.b. » : les deux s'affichent dans le
   tableau, donc les deux sont un écart traçable), l'i-l-RMSD et le RMSD global.
   Les autres restent traçables : le panneau laisse choisir n'importe lequel
   (voir plotSourceOptions) ou les tracer TOUS (voir PLOT_SOURCE_ALL). */
export const poseBindingEnergy = (p, program) => {
  if (!p) return null;
  const total = parseDockingValue(p.energy_total);
  if (total !== null) return total;
  if (program === 'haddock') return null;
  return parseDockingValue(p.affinity);
};

/* Les grandeurs qu'un axe PEUT tracer, dans l'ordre de préférence : les écarts à
   la référence (Å) pour l'abscisse du nuage, l'énergie totale puis l'affinité
   (kcal/mol) pour l'ordonnée. C'est aussi la liste — et l'ORDRE — que propose le
   choix MANUEL de l'axe (voir plotSourceOptions) : un fichier qui nomme ses
   colonnes autrement que les synonymes connus s'y voit autant que les autres.
   L'i-RMSD vient en tête : c'est l'écart à la référence que trace le nuage par
   défaut (« Auto ») quand le tableau le porte ; un autre écart se choisit dans
   le sélecteur, et « toutes les colonnes d'écart » se tracent d'un coup
   (PLOT_SOURCE_ALL). */
export const DEVIATION_PLOT_KEYS = ['irmsd', 'lrmsd', 'rmsd_lb', 'ilrmsd', 'rmsd', 'rmsd_ub'];
export const ENERGY_PLOT_KEYS = ['energy_total', 'affinity'];

/** La valeur du choix d'axe qui demande de tracer TOUS les écarts à la
 *  référence du tableau : un nuage par écart (i-RMSD, l-RMSD, i-l-RMSD, RMSD…),
 *  tous contre la même énergie. « Auto », lui, garde la première grandeur de
 *  DEVIATION_PLOT_KEYS que le tableau porte. */
export const PLOT_SOURCE_ALL = 'all';

export const poseDeviation = (p) => {
  if (!p) return null;
  for (const key of DEVIATION_PLOT_KEYS) {
    const v = parseDockingValue(p[key]);
    if (v !== null) return v;
  }
  return null;
};

/** Les termes du score HADDOCK PRÉSENTS dans une ligne (kcal/mol), dans l'ordre
 *  de DOCKING_METRICS : le graphique « HADDOCK score terms » ne trace QUE ce que
 *  le tableau contient — plus de barres à 0 pour une colonne absente. */
export const HADDOCK_SCORE_TERM_KEYS = [
  'energy_vdw', 'energy_elec', 'energy_desolv', 'energy_air',
  'energy_angles', 'energy_bonds', 'energy_dihe', 'energy_improper',
  'energy_cdih', 'energy_coup', 'energy_dani', 'energy_rdcs',
  'energy_rg', 'energy_sym', 'energy_vean', 'energy_xpcs'
];

export const haddockScoreTerms = (p) => {
  if (!p) return {};
  const out = {};
  [...HADDOCK_SCORE_TERM_KEYS, 'energy_total'].forEach((k) => {
    const v = parseDockingValue(p[k]);
    if (v !== null) out[k] = v;
  });
  return out;
};

// ================= DOCKING FILE FORMATS =================
export const DOCKING_FILE_FORMATS = [
  { key: 'vina_config', label: 'Vina config (.txt)', ext: '.txt' },
  { key: 'vina_out', label: 'Vina output log', ext: '.log' },
  { key: 'pdbqt', label: 'AutoDock PDBQT', ext: '.pdbqt' },
  { key: 'dlg', label: 'AutoDock DLG (.dlg)', ext: '.dlg' },
  { key: 'dpf', label: 'AutoDock DPF (.dpf)', ext: '.dpf' },
  { key: 'gpf', label: 'AutoDock GPF (.gpf)', ext: '.gpf' },
  { key: 'haddock_csv', label: 'HADDOCK scores (.csv)', ext: '.csv' },
  { key: 'haddock_param', label: 'HADDOCK params (.param)', ext: '.param' }
];

// ================= DOCKING PIPELINE STAGES =================
export const DOCKING_PIPELINE_STAGES = [
  { key: 'prep_receptor', label: 'Receptor Preparation', icon: '🧬' },
  { key: 'prep_ligand', label: 'Ligand Preparation', icon: '⬡' },
  { key: 'grid', label: 'Grid / Box Setup', icon: '📦' },
  { key: 'docking', label: 'Docking Run', icon: '🎯' },
  { key: 'scoring', label: 'Scoring / Ranking', icon: '🏆' },
  { key: 'analysis', label: 'Pose Analysis', icon: '📈' }
];

// ================= VALUE / LOOKUP HELPERS =================
export const parseDockingValue = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

export const getProgramInfo = (key) => DOCKING_PROGRAMS[key] || DOCKING_PROGRAMS.vina;
export const getProgramVersions = (key) => getProgramInfo(key).versions || [];
export const getScoringFunctions = (key) => getProgramInfo(key).scoringFunctions || [];
export const getSearchAlgorithms = (key) => getProgramInfo(key).searchAlgorithms || [];

// ================= CSV LINE PARSER =================
const parseCsvLine = (line) => {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => String(s).trim());
};

// ================= AUTODOCK VINA OUTPUT PARSER =================
// Parses the classic Vina results table:
//   mode | affinity (kcal/mol) | rmsd l.b. | rmsd u.b.
export const parseVinaOutput = (text) => {
  const poses = [];
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*$/);
    if (m) {
      poses.push({
        mode: parseInt(m[1], 10),
        affinity: parseFloat(m[2]),
        rmsd_lb: parseFloat(m[3]),
        rmsd_ub: parseFloat(m[4]),
        program: 'vina'
      });
    }
  }
  return poses;
};

// ================= AUTODOCK 4 .dlg PARSER =================
// Extracts per-run binding energies and energy components from a DLG file.
export const parseAutoDockDlg = (text) => {
  const poses = [];
  const lines = String(text || '').split(/\r?\n/);
  let current = null;
  const num = (s) => {
    const m = String(s).match(/-?\d+\.?\d*/);
    return m ? parseFloat(m[0]) : null;
  };
  for (const line of lines) {
    if (/Estimated Free Energy of Binding/i.test(line)) {
      if (current) poses.push(current);
      current = {
        mode: poses.length + 1,
        affinity: num(line),
        energy_total: num(line),
        program: 'autodock4'
      };
    } else if (current) {
      if (/Final Intermolecular Energy/i.test(line)) current.energy_inter = num(line);
      else if (/vdW \+ Hbond \+ desolv Energy/i.test(line)) current.energy_vdw = num(line);
      else if (/Electrostatic Energy/i.test(line)) current.energy_elec = num(line);
      else if (/Final Total Internal Energy/i.test(line)) current.energy_intra = num(line);
      else if (/Torsional Free Energy/i.test(line)) current.energy_torsional = num(line);
      else if (/Unbound System's Energy/i.test(line)) current.energy_unbound = num(line);
      else if (/Estimated Inhibition Constant/i.test(line)) {
        const ki = num(line);
        if (ki != null) current.ki = ki;
      }
    }
  }
  if (current) poses.push(current);
  poses.forEach((p, i) => { p.mode = i + 1; });
  return poses;
};

/* ============================================================================
   NOMS DE COLONNES — UNE SEULE TABLE DE SYNONYMES
   ----------------------------------------------------------------------------
   La même grandeur porte plusieurs noms selon la source : « score » /
   « HADDOCK score » / « total » (le score), « vdW » / « E_vdw » (l'énergie de
   van der Waals), « RMSD l.b. » / « lrmsd » (l'écart à la référence)… Le TSV
   CAPRI (9_caprieval/capri_ss.tsv) et le CSV de scores HADDOCK sont donc lus
   avec CETTE table : renommer une colonne se corrige à un seul endroit.

   La comparaison se fait sur une forme CANONIQUE (lettres et chiffres seuls) :
   « RMSD l.b. », « RMSD_lb » et « rmsd-lb » sont la même colonne.

   Les unités de chaque grandeur vivent dans DOCKING_METRICS (kcal/mol pour les
   termes énergétiques et les restreintes, Å pour les écarts, Å² pour la surface
   enfouie, adimensionnel pour fnat / dockq, les rangs et les clusters).
   ========================================================================= */
export const normMetricColumn = (c) => String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export const CAPRI_METRIC_SYNONYMS = {
  // ── Le score du programme (a.u. pour HADDOCK, kcal/mol pour Vina/AutoDock) ──
  affinity: ['haddockscore', 'scorehaddock', 'score', 'dockingscore', 'scoring'],
  // ── Écarts à la structure de référence (Å) ─────────────────────────────────
  // Les formes courtes (« rms », « lrms », « irms ») sont celles des scripts de
  // docking (Rosetta, ProDy…) : la comparaison est EXACTE sur la forme
  // canonique, elles ne peuvent donc pas capturer une autre colonne.
  irmsd: ['irmsd', 'interfacer_rmsd', 'interfacermsd', 'irms'],
  lrmsd: ['lrmsd', 'ligandrmsd', 'rmsdligand', 'lrms', 'ligandrms'],
  ilrmsd: ['ilrmsd', 'interfaceligandrmsd', 'ilrms'],
  rmsd: ['rmsd', 'rmsdall', 'rmsdfrombest', 'rmsdref', 'rms'],
  // ── Bornes de RMSD de Vina / AutoDock (Å) ──────────────────────────────────
  rmsd_lb: ['rmsdlb', 'rmsdlower', 'rmsdlowerbound'],
  rmsd_ub: ['rmsdub', 'rmsdupper', 'rmsdupperbound'],
  // ── Termes énergétiques et restreintes (kcal/mol) ──────────────────────────
  // « dG » (« deltag » sous forme canonique), « binding energy », « free
  // energy » : les noms usuels de l'énergie libre de liaison. Une colonne qui
  // ne s'écrirait que « ΔG » se choisit à la main dans le panneau (voir
  // plotSourceOptions) : sa forme canonique est « g », une lettre seule, trop
  // ambiguë pour être réclamée automatiquement.
  energy_total: ['total', 'etotal', 'energytotal', 'totalenergy', 'dg', 'deltag',
    'bindingenergy', 'freeenergy'],
  energy_vdw: ['vdw', 'evdw', 'vdwenergy', 'vanderwaals'],
  energy_elec: ['elec', 'eelec', 'elecenergy', 'electrostatics', 'electrostatic'],
  energy_desolv: ['desolv', 'edesolv', 'desolvation', 'desolvenergy'],
  energy_air: ['air', 'eair', 'airenergy', 'ambig', 'desolvair'],
  energy_angles: ['angles', 'angle', 'eangles', 'bondangles'],
  energy_bonds: ['bonds', 'bond', 'ebonds'],
  energy_dihe: ['dihe', 'edihe', 'dihedral', 'dihedrals'],
  energy_improper: ['improper', 'eimproper', 'impropers'],
  energy_cdih: ['cdih', 'ecdih'],
  energy_coup: ['coup', 'ecoup', 'coupling'],
  energy_dani: ['dani', 'edani'],
  energy_rdcs: ['rdcs', 'erdcs'],
  energy_rg: ['rg', 'ergy', 'radiusofgyration'],
  energy_sym: ['sym', 'esym', 'symmetry'],
  energy_vean: ['vean', 'evean'],
  energy_xpcs: ['xpcs', 'expcs'],
  // ── Surface enfouie (Å²) ───────────────────────────────────────────────────
  bsa: ['bsa', 'buriedsurfacearea', 'buriedsurface', 'bsurface'],
  // ── Qualité CAPRI (adimensionnel, 0 → 1) et fractions de contacts ──────────
  fnat: ['fnat', 'fnative', 'fractionofnativecontacts', 'fractionnativecontacts'],
  fcc: ['fcc', 'fractionofcommoncontacts'],
  dockq: ['dockq', 'dockqscore'],
  // ── Classements et clusters (adimensionnel, entiers) ───────────────────────
  caprieval_rank: ['caprievalrank', 'rank', 'modelrank'],
  cluster_id: ['clusterid', 'cluster'],
  cluster_ranking: ['clusterranking', 'clusterrank'],
  model_cluster_ranking: ['modelclusterranking', 'modelclusterrank'],
  cluster_size: ['clustersize', 'nmembers', 'nmemberscluster']
};

// ================= HADDOCK CSV SCORE PARSER =================
// Le CSV de scores porte les MÊMES grandeurs que le TSV CAPRI, plus le nom du
// modèle et l'itération : les synonymes ci-dessus suffisent, on n'ajoute que
// les deux colonnes qui ne sont pas des métriques.
const HADDOCK_FIELD_ALIASES = {
  label: ['structure', 'filename', 'name', 'structurename', 'model'],
  itw: ['itw', 'run', 'iteration'],
  ...CAPRI_METRIC_SYNONYMS
};

const matchHADDOCKField = (header, field) => {
  const aliases = HADDOCK_FIELD_ALIASES[field] || [field];
  for (const a of aliases) {
    const idx = header.findIndex((h) => normMetricColumn(h) === a);
    if (idx >= 0) return idx;
  }
  return -1;
};

export const parseHADDOCKScores = (text) => {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]);
  const poses = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    if (vals.length < 2) continue;
    const pose = { mode: i, program: 'haddock' };
    Object.keys(HADDOCK_FIELD_ALIASES).forEach((field) => {
      const idx = matchHADDOCKField(header, field);
      if (idx >= 0 && vals[idx] !== undefined && vals[idx] !== '') {
        const n = parseDockingValue(vals[idx]);
        pose[field] = n !== null ? n : vals[idx];
      }
    });
    if (pose.affinity === undefined) pose.affinity = pose.energy_total ?? pose.energy_air ?? 0;
    poses.push(pose);
  }
  return poses;
};

// ================= VINA CONFIG PARSER =================
export const parseVinaConfig = (text) => {
  const updates = {};
  const get = (key) => {
    const m = new RegExp(`^\\s*${key}\\s*=\\s*(.+)`, 'im').exec(text);
    return m ? m[1].trim() : null;
  };
  const num = (k) => {
    const v = get(k);
    return v != null ? parseDockingValue(v) : null;
  };
  const map = [
    ['center_x', 'boxCenterX'], ['center_y', 'boxCenterY'], ['center_z', 'boxCenterZ'],
    ['size_x', 'boxSizeX'], ['size_y', 'boxSizeY'], ['size_z', 'boxSizeZ'],
    ['exhaustiveness', 'exhaustiveness'], ['num_modes', 'numModes'],
    ['energy_range', 'energyRange'], ['seed', 'seed'], ['cpu', 'cpu']
  ];
  map.forEach(([src, dst]) => {
    const v = num(src);
    if (v !== null) updates[dst] = String(v);
  });
  const receptor = get('receptor');
  if (receptor) updates.receptorFile = receptor;
  const ligand = get('ligand');
  if (ligand) updates.ligandFile = ligand;
  if (Object.keys(updates).length) updates.dockingProgram = 'vina';
  return updates;
};

// ================= AUTODOCK DPF (docking parameters) PARSER =================
export const parseAutoDockDPF = (text) => {
  const updates = {};
  const get = (key) => {
    const m = new RegExp(`^\\s*${key}\\s+(.+)`, 'im').exec(text);
    return m ? m[1].trim().split(/\s+/)[0] : null;
  };
  const map = [
    ['ga_run', 'numRuns'],
    ['ga_pop_size', 'populationSize'],
    ['ga_num_evals', 'numEvaluations'],
    ['ga_num_generations', 'numGenerations'],
    ['ga_mutation_rate', 'mutationRate'],
    ['ga_crossover_rate', 'crossoverRate'],
    ['ga_elitism', 'elitism'],
    ['seed', 'seed'],
    ['sw_max_its', 'localSearchIterations'],
    ['sw_max_succ', 'localSearchSuccesses'],
    ['ls_search_freq', 'localSearchFreq'],
    ['set_psw1', null]
  ];
  map.forEach(([src, dst]) => {
    if (!dst) return;
    const v = get(src);
    if (v != null) updates[dst] = v;
  });
  if (get('ga_run') || get('ga_pop_size')) updates.searchAlgorithm = 'Lamarckian GA';
  if (Object.keys(updates).length) updates.dockingProgram = 'autodock4';
  return updates;
};

// ================= AUTODOCK GPF (grid parameters) PARSER =================
export const parseGridGPF = (text) => {
  const updates = {};
  const get = (key) => {
    const m = new RegExp(`^\\s*${key}\\s+(.+)`, 'im').exec(text);
    return m ? m[1].trim() : null;
  };
  const npts = get('npts');
  if (npts) {
    updates.gridDims = npts;
    const parts = npts.split(/\s+/).map((p) => parseInt(p, 10));
    if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
      updates.boxSizeX = String(Math.round(parts[0] / 8));
      updates.boxSizeY = String(Math.round(parts[1] / 8));
      updates.boxSizeZ = String(Math.round(parts[2] / 8));
    }
  }
  const spacing = get('spacing');
  if (spacing) updates.gridSpacing = spacing;
  const center = get('gridcenter');
  if (center && center !== 'auto') {
    const parts = center.split(/\s+/).map((p) => parseFloat(p));
    if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
      updates.boxCenterX = String(parts[0]);
      updates.boxCenterY = String(parts[1]);
      updates.boxCenterZ = String(parts[2]);
    }
  }
  const types = get('types');
  if (types) updates.atomTypes = types;
  if (Object.keys(updates).length) updates.dockingProgram = 'autodock4';
  return updates;
};

// ================= HADDOCK PARAMETER PARSER =================
export const parseHADDOCKParams = (text) => {
  const updates = {};
  const get = (key) => {
    const m = new RegExp(`${key}\\s*[:=]\\s*([^,\\s]+)`, 'im').exec(text);
    return m ? m[1].trim() : null;
  };
  const map = [
    ['mdsteps_rigid', 'mdStepsRigid'],
    ['mdsteps_semi', 'mdStepsSemiFlex'],
    ['mdsteps_flex', 'mdStepsFlex'],
    ['sampl', 'sampling'],
    ['structures_it0', 'structuresIt0'],
    ['structures_it1', 'structuresIt1'],
    ['structures_w', 'structuresWater'],
    ['waterrefine', 'waterRefine'],
    ['ambig', 'ambigTbl'],
    ['randorien', 'randomOrientation']
  ];
  map.forEach(([src, dst]) => {
    const v = get(src);
    if (v != null) updates[dst] = v;
  });
  if (Object.keys(updates).length) updates.dockingProgram = 'haddock';
  return updates;
};

// ================= MASTER FILE DISPATCHER =================
// Detects the file type and returns either poses (results) or updates (params).
// Parse a CAPRI quality TSV (9_caprieval/capri_ss.tsv) into { columns, rows }.
export const parseCapriTsv = (text) => {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return null;
  const columns = lines[0].split('\t').map((c) => c.trim()).filter(Boolean);
  const rows = lines.slice(1).map((l) => l.split('\t').map((c) => c.trim()));
  if (!columns.length || !rows.length) return null;
  return { columns, rows };
};

/* ── CAPRI / caprieval → lignes du tableau de résultats ─────────────────────
   Chaque colonne reconnue (voir CAPRI_METRIC_SYNONYMS, en tête de fichier) est
   ramenée sur la clé de métrique que le tableau ET les graphiques utilisent —
   l'unité de chaque clé est celle de DOCKING_METRICS. */
/** Construit les lignes du tableau de résultats à partir d'un TSV CAPRI. Utilisé
 *  par l'import d'un répertoire de calcul ET par l'import d'un fichier seul, pour
 *  que les deux remplissent le MÊME tableau avec les mêmes valeurs. */
export const posesFromCapri = (parsed) => {
  const columns = (parsed && Array.isArray(parsed.columns)) ? parsed.columns : [];
  const rows = (parsed && Array.isArray(parsed.rows)) ? parsed.rows : [];
  if (!columns.length || !rows.length) return [];
  const colOf = (names) => {
    for (const n of names) {
      const ix = columns.findIndex((c) => normMetricColumn(c) === n);
      if (ix >= 0) return ix;
    }
    return -1;
  };
  const num = (v) => {
    const n = parseFloat(String(v === undefined || v === null ? '' : v).replace(',', '.'));
    return Number.isFinite(n) ? n : '';
  };
  return rows.map((row, i) => {
    const get = (names) => { const ix = colOf(names); return ix >= 0 ? row[ix] : ''; };
    const label = String(get(['model', 'structure']) || '').split('/').pop() || `Pose ${i + 1}`;
    const pose = { mode: num(get(['caprieval_rank', 'rank'])) || i + 1, label, program: 'haddock' };
    Object.entries(CAPRI_METRIC_SYNONYMS).forEach(([key, names]) => { pose[key] = num(get(names)); });
    // Every raw CAPRI value is kept so the full table can be shown too.
    columns.forEach((c, ci) => { pose[`capri_${c}`] = row[ci] !== undefined ? row[ci] : ''; });
    return pose;
  });
};
/* ── LIRE LA VALEUR D'UNE MÉTRIQUE DANS UNE POSE — AUCUNE VALEUR PERDUE ─────
   Une pose peut porter la valeur d'une métrique de trois façons :
     1) la cellule éditable du tableau (clé « <index>-<métrique> » de la couche) ;
     2) la clé canonique de la métrique (`pose.lrmsd`) ;
     3) la COLONNE BRUTE du fichier importé (`pose.capri_lrmsd`), reconnue par les
        synonymes — la colonne s'affiche dans le tableau, la valeur y retourne.
   S'y ajoute l'ancienne clé d'une métrique RENOMMÉE : le parseur CAPRI rangeait
   autrefois le l-RMSD sous « RMSD l.b. » et l'i-l-RMSD sous « RMSD u.b. » (les
   bornes de Vina / AutoDock). Une pose déjà enregistrée dans le jeu de données
   garde donc ses écarts à la référence. Renommer une colonne ne peut plus vider
   une cellule : le tableau ET les graphiques lisent par CETTE fonction. */
export const CAPRI_RAW_PREFIX = 'capri_';

export const poseRawMetric = (pose, key) => {
  if (!pose || !key) return undefined;
  // Le nom de la clé elle-même (« energy_vdw ») compte comme synonyme.
  const names = [...(CAPRI_METRIC_SYNONYMS[key] || []), normMetricColumn(key)];
  for (const n of names) {
    if (!n) continue;
    const hit = Object.keys(pose).find((k) => k.startsWith(CAPRI_RAW_PREFIX)
      && normMetricColumn(k.slice(CAPRI_RAW_PREFIX.length)) === n);
    if (hit === undefined) continue;
    const v = pose[hit];
    if (v !== '' && v !== undefined && v !== null) return v;
  }
  return undefined;
};

/** Ancienne clé d'une métrique renommée, quand elle portait la MÊME grandeur. */
export const LEGACY_POSE_KEYS = {
  lrmsd: ['rmsd_lb'],
  ilrmsd: ['rmsd_ub']
};

export const poseMetricValue = (pose, key, program) => {
  if (!pose || !key) return undefined;
  const own = pose[key];
  if (own !== '' && own !== undefined && own !== null) return own;
  const raw = poseRawMetric(pose, key);
  if (raw !== undefined) return raw;
  if (program === 'haddock' || pose.program === 'haddock') {
    for (const legacy of LEGACY_POSE_KEYS[key] || []) {
      const v = pose[legacy];
      if (v !== '' && v !== undefined && v !== null) return v;
    }
  }
  return own;
};

/** La métrique que reçoit une colonne d'un fichier importé : « score » →
 *  `affinity`, « lrmsd » → `lrmsd`, « E_vdw » → `energy_vdw`, une colonne nommée
 *  comme une clé → sa clé. `null` quand aucune métrique ne la reconnaît : elle
 *  s'affiche alors brute, jamais masquée. */
export const capriColumnMetricKey = (column) => {
  const c = normMetricColumn(column);
  if (!c) return null;
  const known = DOCKING_METRICS.find((m) => (CAPRI_METRIC_SYNONYMS[m.key] || []).includes(c));
  if (known) return known.key;
  const direct = DOCKING_METRICS.find((m) => normMetricColumn(m.key) === c);
  return direct ? direct.key : null;
};

/* ── LA COLONNE DU FICHIER QUE LES GRAPHIQUES PEUVENT ENCORE TRACER ─────────
   Le tableau montre TOUTE colonne importée : celles qu'une métrique reconnaît
   (« score » → Affinity, « lrmsd » → l-RMSD — avec leur unité), et les autres
   TELLES QUELLES (les colonnes violettes : model, md5, fnonnat…). Une colonne
   qu'AUCUNE métrique ne réclame n'alimentait aucun graphique : sa valeur
   s'affichait dans le tableau, et l'axe restait vide. Quand aucune ligne n'a
   d'écart (ou d'énergie) par le chemin normal — métrique, colonne reconnue,
   ancienne clé — les graphiques lisent donc la colonne du fichier qui porte
   manifestement cette grandeur, ET l'axe est étiqueté de son nom : la valeur
   affichée est tracée, et l'on voit d'où elle vient. Ce repli ne sert QUE
   lorsque l'axe serait vide : un graphique juste ne change jamais de grandeur. */
export const poseRawColumnValue = (pose, column) =>
  (pose && column ? pose[`${CAPRI_RAW_PREFIX}${column}`] : undefined);

/** Première colonne importée qu'AUCUNE métrique ne réclame et dont le nom
 *  contient l'un des mots-clés donnés, dans l'ordre des mots-clés — `null`
 *  s'il n'y en a aucune (`columns` = les colonnes du fichier importé). */
export const unclaimedColumnMatching = (columns, hints) => {
  const list = Array.isArray(columns) ? columns : [];
  for (const hint of hints) {
    const hit = list.find((c) => c && !capriColumnMetricKey(c)
      && normMetricColumn(c).includes(hint));
    if (hit) return hit;
  }
  return null;
};

/** La colonne « écart à la référence » d'un fichier importé (Å). */
export const deviationColumnOf = (columns) =>
  unclaimedColumnMatching(columns, ['rmsd', 'deviation']);

/** La colonne « énergie » d'un fichier importé (kcal/mol ou a.u.). */
export const energyColumnOf = (columns) =>
  unclaimedColumnMatching(columns, ['total', 'energy', 'score', 'affinity']);

/* ── CHOISIR À LA MAIN LA GRANDEUR DE CHAQUE AXE ────────────────────────────
   Le repli ci-dessus lit la colonne qui porte MANIFESTEMENT la grandeur (son
   nom contient « rmsd », « total »…). Un fichier qui la nomme autrement
   (« ΔG », « E_score », « rmsd_lig ») ne peut pas être deviné : le panneau
   propose donc LA LISTE des grandeurs que le tableau sait lire — les métriques
   de l'axe qui ont une valeur, puis CHAQUE colonne importée qui porte un
   nombre — et le choix de l'utilisateur prime sur toute devinette.
   `plotSourceValue` relit la source choisie avec LA MÊME lecture que le
   tableau : la métrique du tableau (`poseMetricValue` / `poseChartValue`), ou
   la colonne brute de l'import (`poseRawColumnValue`). */
export const PLOT_SOURCE_PREFIX = { metric: 'metric:', column: 'col:' };

/** Les sources traçables d'un axe, prêtes pour un <select> : les métriques de
 *  l'axe (`kind` = 'deviation' | 'energy') qui ont une valeur dans le tableau,
 *  puis chaque colonne du fichier importé qui porte un nombre. */
export const plotSourceOptions = (columns, rows, kind = 'deviation', program) => {
  const list = Array.isArray(rows) ? rows : [];
  const out = [];
  (kind === 'energy' ? ENERGY_PLOT_KEYS : DEVIATION_PLOT_KEYS).forEach((key) => {
    const metric = DOCKING_METRICS.find((m) => m.key === key);
    if (!metric) return;
    if (!list.some((p) => parseDockingValue(poseMetricValue(p, key, program)) !== null)) return;
    const m = dockingMetricOf(metric, program);
    out.push({
      value: `${PLOT_SOURCE_PREFIX.metric}${key}`,
      label: m.unit ? `${m.label} (${m.unit})` : m.label
    });
  });
  (Array.isArray(columns) ? columns : []).forEach((c) => {
    if (!c) return;
    if (!list.some((p) => parseDockingValue(poseRawColumnValue(p, c)) !== null)) return;
    out.push({
      value: `${PLOT_SOURCE_PREFIX.column}${c}`,
      label: `${c} — column of the imported file`
    });
  });
  return out;
};

/** Le libellé de la source choisie ('' quand elle n'existe plus dans la liste :
 *  le fichier a changé, on revient alors au comportement automatique). */
export const plotSourceLabel = (options, value) => {
  const hit = (Array.isArray(options) ? options : []).find((o) => o.value === value);
  return hit ? hit.label : '';
};

/** La valeur d'une source pour une pose — la lecture du tableau, à la lettre. */
export const plotSourceValue = (pose, source, kind, program) => {
  const s = String(source || '');
  if (s.startsWith(PLOT_SOURCE_PREFIX.column)) {
    return parseDockingValue(poseRawColumnValue(pose, s.slice(PLOT_SOURCE_PREFIX.column.length)));
  }
  if (s.startsWith(PLOT_SOURCE_PREFIX.metric)) {
    const key = s.slice(PLOT_SOURCE_PREFIX.metric.length);
    return kind === 'energy'
      ? poseChartValue(pose, key, program)
      : parseDockingValue(poseMetricValue(pose, key, program));
  }
  return null;
};

/* ── LA GRANDEUR QUE TRACE LE GRAPHIQUE D'ÉNERGIE ───────────────────────────
   Le graphique trace ce que LE TABLEAU porte réellement : l'énergie de liaison
   totale (kcal/mol) quand la table a un terme « total », sinon le score du
   programme — « HADDOCK score (a.u.) » pour HADDOCK, l'affinité (kcal/mol) pour
   Vina / AutoDock. L'unité affichée est celle de la métrique tracée (un score
   HADDOCK n'est jamais présenté comme une énergie en kcal/mol), mais un
   graphique n'est plus vide quand la table a une valeur : un capri_ss.tsv n'a
   pas de colonne « total », il a un « score ». */
export const chartEnergyMetricKey = (rows) =>
  (Array.isArray(rows) ? rows : []).some((p) => parseDockingValue(poseMetricValue(p, 'energy_total')) !== null)
    ? 'energy_total' : 'affinity';

export const poseChartValue = (p, metricKey, program) => {
  const v = parseDockingValue(poseMetricValue(p, metricKey || 'affinity', program));
  if (v !== null) return v;
  // Repli sur l'affinité seulement quand l'unité est la même (kcal/mol).
  if (metricKey === 'energy_total' && program !== 'haddock') {
    return parseDockingValue(poseMetricValue(p, 'affinity', program));
  }
  return null;
};

// Lightweight TOML reader for raw_input.toml (sections + key = value pairs).
// Handles comments, quoted values, duplicate sections (merged), both
// single-line and multi-line arrays (e.g. the `molecules` list) AND HADDOCK's
// `[[molecules]]` array-of-tables (each `[[molecules]]` header starts a NEW
// table entry, collected under `tables.molecules`).
// Output shape: { top, sections, tables } — `top`/`sections` keep the
// previous format (backward compatible), `tables` is new.
export const parseTomlSimple = (text) => {
  const top = [];
  const sections = [];
  const tables = {};
  let currentSection = null;
  let currentTable = null;
  const lines = String(text || '').split(/\r?\n/);
  // Remove inline comments (# ...), but not inside quoted strings.
  const stripComment = (s) => {
    let inQ = null;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inQ) { if (ch === inQ) inQ = null; continue; }
      if (ch === '"' || ch === "'") inQ = ch;
      else if (ch === '#') return s.slice(0, i);
    }
    return s;
  };
  const cleanVal = (v) => String(v || '').trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '');

  let i = 0;
  while (i < lines.length) {
    const line = stripComment(lines[i]).trim();
    i++;
    if (!line) continue;
    // Array-of-tables: `[[name]]` — each occurrence starts a new entry.
    const tm = /^\[\[([^\]]+)\]\]$/.exec(line);
    if (tm) {
      const name = tm[1].trim();
      if (!tables[name]) tables[name] = [];
      const entry = {};
      tables[name].push(entry);
      currentTable = entry;
      currentSection = null;
      continue;
    }
    const sm = /^\[([^\]]+)\]$/.exec(line);
    if (sm) {
      const name = sm[1].trim();
      currentSection = sections.find((s) => s.name === name);
      if (!currentSection) { currentSection = { name, pairs: [] }; sections.push(currentSection); }
      currentTable = null;
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (val.startsWith('[')) {
      // Array — read across lines until the closing bracket.
      let acc = val.includes(']') ? val.slice(val.indexOf('[') + 1, val.lastIndexOf(']')) : val.slice(1);
      if (!val.includes(']')) {
        while (i < lines.length) {
          const next = stripComment(lines[i]).trim();
          i++;
          const closeIdx = next.indexOf(']');
          if (closeIdx >= 0) { acc += ' ' + next.slice(0, closeIdx); break; }
          acc += ' ' + next;
        }
      }
      val = acc.split(',').map(cleanVal).filter(Boolean).join(', ');
    } else {
      val = cleanVal(val);
    }
    if (currentTable) currentTable[key] = val;
    else if (currentSection) currentSection.pairs.push({ key, value: val });
    else top.push({ key, value: val });
  }
  return { top, sections, tables };
};

// Extract the "molecules to be docked" from a parsed raw_input.toml.
// Real HADDOCK files use several shapes, so all are accepted (in order):
//   1) [[molecules]] array-of-tables  { name, pdb, segid }  (HADDOCK 2.4 web)
//   2) top-level  molecules = ["path/a.pdb", "path/b.pdb"]  (HADDOCK 3 style)
//   3) [molecules] / [molecule] table:   label = "path.pdb"
// Returns [{ name, pdb, segid }] in declaration order. `pdb` keeps the path
// exactly as written in the TOML (the caller matches by full path first and by
// basename second); entries without a `pdb` value are skipped.
export const extractDockedMolecules = (toml) => {
  const out = [];
  const add = (name, pdb, segid) => {
    const p = String(pdb || '').trim();
    if (!p) return;
    const fileName = String(p).split(/[\\/]/).pop();
    const nm = String(name || '').trim()
      || fileName.replace(/\.(pdb|pdb\.gz)$/i, '')
      || `Molecule ${out.length + 1}`;
    out.push({ name: nm, pdb: p, segid: String(segid || '').trim() });
  };

  // 1) [[molecules]] array-of-tables (classic HADDOCK 2.4 web-server shape).
  const tables = (toml && toml.tables && Array.isArray(toml.tables.molecules)) ? toml.tables.molecules : [];
  tables.forEach((m) => {
    if (!m || typeof m !== 'object') return;
    const pdb = m.pdb ?? m.pdbfile ?? m.file ?? m.structure;
    const name = m.name ?? m.label ?? m.molname ?? '';
    const segid = m.segid ?? m.seg_id ?? m.chain;
    add(name, pdb, segid);
  });
  if (out.length) return out;

  // 2) top-level `molecules = ["data/a.pdb", ...]` (HADDOCK 3 style).
  const topPair = (toml && Array.isArray(toml.top) ? toml.top : [])
    .find((p) => String(p.key || '').trim().toLowerCase() === 'molecules');
  if (topPair && String(topPair.value || '').trim()) {
    String(topPair.value).split(',').map((s) => s.trim()).filter(Boolean).forEach((p) => add('', p, ''));
    if (out.length) return out;
  }

  // 3) `[molecules]` / `[molecule]` table: label = "path.pdb".
  const sec = (toml && Array.isArray(toml.sections) ? toml.sections : [])
    .find((s) => ['molecules', 'molecule'].includes(String(s.name || '').trim().toLowerCase()));
  if (sec && Array.isArray(sec.pairs)) {
    sec.pairs.forEach((p) => add(p.key, p.value, ''));
  }
  return out;
};

export const parseDockingFile = (text, filename) => {
  const lower = (filename || '').toLowerCase();

  if (lower.endsWith('.tsv')) {
    const capri = parseCapriTsv(text);
    if (capri) {
      /* Le TSV alimente AUSSI le tableau de résultats (poses) : auparavant il ne
         posait que les colonnes CAPRI brutes, donc un capri_ss.tsv importé par
         « Choose file… » laissait le tableau ET les graphiques vides. */
      return {
        type: 'capri_tsv', program: 'haddock',
        poses: posesFromCapri(capri),
        capri,
        updates: { dockingCapri: { ...capri, sourceName: filename || 'capri_ss.tsv' } }
      };
    }
  }
  if (lower.endsWith('.toml')) {
    const toml = parseTomlSimple(text);
    return { type: 'raw_input_toml', program: null, poses: [], toml, updates: { dockingRawInput: { ...toml, fileName: filename || 'raw_input.toml' } } };
  }
  if (lower.endsWith('.dlg')) {
    const poses = parseAutoDockDlg(text);
    return { type: 'dlg', program: 'autodock4', poses, updates: { dockingProgram: 'autodock4' } };
  }
  if (lower.endsWith('.gpf')) {
    return { type: 'gpf', program: 'autodock4', poses: [], updates: parseGridGPF(text) };
  }
  if (lower.endsWith('.dpf')) {
    return { type: 'dpf', program: 'autodock4', poses: [], updates: parseAutoDockDPF(text) };
  }
  if (lower.endsWith('.csv')) {
    const poses = parseHADDOCKScores(text);
    if (poses.length) return { type: 'haddock_csv', program: 'haddock', poses, updates: { dockingProgram: 'haddock' } };
  }
  if (lower.endsWith('.param') || lower.endsWith('.cfg') || lower.includes('haddock')) {
    return { type: 'haddock_param', program: 'haddock', poses: [], updates: parseHADDOCKParams(text) };
  }

  // Vina config vs Vina output — try config first (key=value), then the table.
  const vinaCfg = parseVinaConfig(text);
  if (Object.keys(vinaCfg).length) {
    return { type: 'vina_config', program: 'vina', poses: [], updates: vinaCfg };
  }
  const vinaPoses = parseVinaOutput(text);
  if (vinaPoses.length) {
    return { type: 'vina_out', program: 'vina', poses: vinaPoses, updates: { dockingProgram: 'vina' } };
  }
  return { type: 'unknown', program: null, poses: [], updates: {} };
};

// ================= URL / FORMAT HELPERS =================
export const normalizeDockingUrl = (url) => {
  const u = (url || '').trim();
  if (!u) return { url: null, fallbacks: [] };
  let m = u.match(/drive.google.com\/file\/d\/([^/?]+)/);
  if (m) {
    const id = m[1];
    return {
      url: `https://lh3.googleusercontent.com/d/${id}`,
      fallbacks: [
        `https://drive.google.com/thumbnail?id=${id}&sz=w1600`,
        `https://drive.google.com/uc?export=view&id=${id}`
      ]
    };
  }
  m = u.match(/drive.google.com\/(?:open|uc)[^#]*[?&]id=([^&#]+)/);
  if (m) {
    const id = m[1];
    return {
      url: `https://lh3.googleusercontent.com/d/${id}`,
      fallbacks: [
        `https://drive.google.com/thumbnail?id=${id}&sz=w1600`,
        `https://drive.google.com/uc?export=view&id=${id}`
      ]
    };
  }
  if (u.includes('dropbox.com')) {
    const raw = u.replace(/[?&]dl=0/g, '') + (u.includes('?') ? '&raw=1' : '?raw=1');
    return { url: raw, fallbacks: [u] };
  }
  return { url: u, fallbacks: [] };
};

export const detectDockingFormat = (url) => {
  const u = (url || '').toLowerCase();
  if (u.endsWith('.dlg')) return 'dlg';
  if (u.endsWith('.dpf')) return 'dpf';
  if (u.endsWith('.gpf')) return 'gpf';
  if (u.endsWith('.pdbqt')) return 'pdbqt';
  if (u.endsWith('.csv')) return 'haddock_csv';
  return 'vina_out';
};

// ================= DOCKING INSTANCE / LAYER MODEL =================
// Mirrors the MD instance/layer model, but "cells" are keyed by pose + metric.
export const DOCKING_DEFAULT_LAYER = {
  key: 'dock',
  label: 'Docking Scores',
  unit: 'kcal/mol',
  builtin: true
};

export const makeDockingInstanceId = () =>
  `dockinst_${Date.now()}_${Math.random().toString(16).slice(2)}`;

export const getDockingInstances = (activeTest) => {
  if (Array.isArray(activeTest.instances) && activeTest.instances.length) {
    return activeTest.instances;
  }
  return [
    {
      id: 'dockinst_default',
      name: 'Docking Run 1',
      values: activeTest.dockingValues || {}
    }
  ];
};

export const getDockingActiveInstance = (activeTest) => {
  const insts = getDockingInstances(activeTest);
  return insts.find((i) => i.id === activeTest.activeInstanceId) || insts[0] || null;
};

export const getDockingLayers = (activeTest) => [
  DOCKING_DEFAULT_LAYER,
  ...(Array.isArray(activeTest.dockingLayers) ? activeTest.dockingLayers : [])
];

export const getDockingActiveLayerKey = (activeTest) =>
  activeTest.activeDockingLayerKey || 'dock';

export const getDockingLayerValues = (instance, layerKey) =>
  (instance && instance.values && instance.values[layerKey]) || {};

export const writeDockingCellValue = (
  activeTest,
  updateActiveTest,
  layerKey,
  cellKey,
  value
) => {
  if (!updateActiveTest) return;
  const activeInstance = getDockingActiveInstance(activeTest);
  const dockingValues = { ...(activeTest.dockingValues || {}) };
  dockingValues[layerKey] = {
    ...(dockingValues[layerKey] || {}),
    [cellKey]: value
  };
  if (
    Array.isArray(activeTest.instances) &&
    activeTest.instances.length &&
    activeInstance
  ) {
    const instances = activeTest.instances.map((inst) => {
      if (inst.id !== activeInstance.id) return inst;
      return {
        ...inst,
        values: {
          ...(inst.values || {}),
          [layerKey]: {
            ...((inst.values || {})[layerKey] || {}),
            [cellKey]: value
          }
        }
      };
    });
    updateActiveTest({ instances, dockingValues });
    return;
  }
  updateActiveTest({ dockingValues });
};

// ================= DEMO DATA GENERATORS =================
export const generateDockingPoses = (n = 9, baseAffinity = -8.5) => {
  const poses = [];
  for (let i = 0; i < n; i++) {
    const aff = baseAffinity + i * 0.35 + (Math.random() - 0.5) * 0.2;
    poses.push({
      mode: i + 1,
      affinity: +aff.toFixed(2),
      rmsd_lb: i === 0 ? 0 : +(Math.random() * 3 + 0.5).toFixed(3),
      rmsd_ub: i === 0 ? 0 : +(Math.random() * 4 + 1).toFixed(3),
      energy_inter: +(aff - 0.6).toFixed(2),
      energy_intra: +0.6.toFixed(2),
      energy_torsional: +(Math.random() * 0.8).toFixed(2),
      energy_elec: +(-(Math.random() * 2)).toFixed(2),
      energy_vdw: +(aff * 0.8).toFixed(2),
      h_bonds: Math.floor(Math.random() * 6),
      contacts: 15 + Math.floor(Math.random() * 25),
      program: 'vina'
    });
  }
  return poses;
};

export const generateHADDOCKPoses = (n = 20) => {
  const poses = [];
  for (let i = 0; i < n; i++) {
    const total = -45 + i * 1.2 + (Math.random() - 0.5) * 3;   // le SCORE HADDOCK (a.u.)
    const vdw = +(-(20 + Math.random() * 8)).toFixed(2);
    const elec = +(-(12 + Math.random() * 8)).toFixed(2);
    const desolv = +(Math.random() * 8).toFixed(2);
    const air = +(-(12 + Math.random() * 5)).toFixed(2);
    poses.push({
      mode: i + 1,
      label: `structure_${i + 1}w.pdb`,
      affinity: +total.toFixed(2),
      // L'énergie TOTALE (kcal/mol) : la somme pondérée des termes — c'est elle
      // que trace le graphique d'affinité, le score ci-dessus restant en a.u.
      energy_total: +(vdw + elec + desolv + air).toFixed(2),
      energy_air: air,
      energy_desolv: desolv,
      bsa: 1100 + Math.floor(Math.random() * 500),
      energy_vdw: vdw,
      energy_elec: elec,
      lrmsd: +(Math.random() * 3 + 0.2).toFixed(3),
      rmsd: +(1 + Math.random() * 3).toFixed(2),
      fnat: +(0.4 + Math.random() * 0.5).toFixed(3),
      dockq: +(0.3 + Math.random() * 0.6).toFixed(3),
      fcc: +(Math.random() * 0.6).toFixed(3),
      program: 'haddock'
    });
  }
  return poses.sort((a, b) => a.affinity - b.affinity);
};

// ================= DOCKING CHART STYLE =================
export const DEFAULT_DOCKING_CHART_STYLE = {
  height: 380,
  aspect: 1,
  fontSize: 16,
  tickStep: '',
  tickAngle: 0,
  pointStyle: 'circle',
  ptSize: 5,
  lineStyle: 'solid',
  lineThickness: 2,
  legend: 'top',
  colors: {},
  barRadius: 3,
  xMin: '',
  xMax: '',
  yMin: '',
  yMax: '',
  xAxisLabel: '',
  yAxisLabel: '',
  // La grandeur de chaque axe du nuage, choisie dans le panneau ('' = Auto :
  // la métrique du tableau, puis la colonne du fichier qui la porte).
  xColumn: '',
  yColumn: ''
};

// ================= GENERIC CHART HELPERS =================
export const dockLineDash = (style) => {
  if (style === 'dashed') return '7 5';
  if (style === 'dotted') return '2 3';
  return undefined;
};

export const dockSeriesColor = (cfg, key, idx, total) => seriesColorFor(cfg, key, idx, total);

export const dockMakeTicks = (domain, stepStr) => {
  const step = parseDockingValue(stepStr);
  if (!step || step <= 0 || !Array.isArray(domain)) return undefined;
  const [a, b] = [Math.min(domain[0], domain[1]), Math.max(domain[0], domain[1])];
  const out = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) {
    out.push(parseFloat(v.toFixed(6)));
  }
  return out.length ? out : undefined;
};

export const dockDom = (v) => {
  if (v === '' || v == null || parseDockingValue(v) === null) return undefined;
  return parseDockingValue(v);
};

export const dockChartBoxStyle = (cfg, opts) => chartBoxStyle(cfg, opts);

// ================= EXPORT DEFAULT =================
export default {
  DOCKING_PROGRAMS,
  DOCKING_METRICS,
  DOCKING_FILE_FORMATS,
  DOCKING_PIPELINE_STAGES,
  parseDockingValue,
  getProgramInfo,
  getProgramVersions,
  getScoringFunctions,
  getSearchAlgorithms,
  parseVinaOutput,
  parseAutoDockDlg,
  parseHADDOCKScores,
  parseVinaConfig,
  parseAutoDockDPF,
  parseGridGPF,
  parseHADDOCKParams,
  parseCapriTsv,
  parseTomlSimple,
  parseDockingFile,
  normalizeDockingUrl,
  detectDockingFormat,
  DOCKING_DEFAULT_LAYER,
  makeDockingInstanceId,
  getDockingInstances,
  getDockingActiveInstance,
  getDockingLayers,
  getDockingActiveLayerKey,
  getDockingLayerValues,
  writeDockingCellValue,
  generateDockingPoses,
  generateHADDOCKPoses,
  dockingMetricOf,
  dockingMetricLabel,
  dockingMetricUnit,
  poseBindingEnergy,
  poseDeviation,
  poseMetricValue,
  poseRawMetric,
  capriColumnMetricKey,
  LEGACY_POSE_KEYS,
  CAPRI_RAW_PREFIX,
  poseRawColumnValue,
  unclaimedColumnMatching,
  deviationColumnOf,
  energyColumnOf,
  DEVIATION_PLOT_KEYS,
  ENERGY_PLOT_KEYS,
  PLOT_SOURCE_PREFIX,
  PLOT_SOURCE_ALL,
  plotSourceOptions,
  plotSourceLabel,
  plotSourceValue,
  chartEnergyMetricKey,
  poseChartValue,

  HADDOCK_SCORE_TERM_KEYS,
  haddockScoreTerms,
  DEFAULT_DOCKING_CHART_STYLE,
  dockLineDash,
  dockSeriesColor,
  dockMakeTicks,
  dockDom,
  dockChartBoxStyle
};