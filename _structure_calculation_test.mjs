/* =========================================================================
   _structure_calculation_test.mjs — 🧬 n DÉPARTS TIRÉS AU HASARD, LE ⚒ SUR CHACUN,
   LES m MEILLEURES GARDÉES.

   La demande, mot pour mot : « Implement a structure calculation button in which the
   user provide the distances between atom pairs and selects the number of starting
   structures n and the number of retained structures m. The program must then
   generate n structures by randomly assigning values of all dihedral angles. From
   each of these n structure the protocol of “model build” is applied to respect the
   distance constraints and the final result is scored. the best m structures are
   retained. »

   Ce qui doit rester vrai, § par § :

     §1 le module, ses BORNES et ses emprunts — les constantes (n, m, la graine, la
        tolérance d'une contrainte), et le fait qu'il n'a NI tables NI descente NI
        générateur à lui : le protocole, la fonction cible et le tirage viennent de
        utils/geometryRelax.js, le dièdre et la rotation de utils/torsionDrive.js ;
     §2 LE LECTEUR DES DIÈDRES, EXÉCUTÉ — une chaîne linéaire (trois charnières, les
        deux liaisons terminales écartées), un cycle (aucune), une double liaison
        (aucune), un atome seul (aucune) ;
     §3 LE TIRAGE, EXÉCUTÉ — le même n donne le même départ au chiffre près, un autre
        n en donne un autre, CHAQUE canal est tourné de l'angle tiré (relu par le
        lecteur de dihèdre du dossier), les LONGUEURS et les ANGLES ne bougent pas
        d'un chiffre (une rotation est rigide), et le côté qui ne tourne pas reste
        BIT À BIT où il était ; un quadruplet sans dièdre est REFUSÉ, pas inventé ;
     §4 LE PROTOCOLE DU ⚒, EXÉCUTÉ — une distance demandée hors de portée est
        RAPPROCHÉE (mesurée, pas supposée), une distance impossible est DITE
        (l'écart réel, la raison, le score), la note préfère un modèle qui respecte
        la contrainte, et l'empilement coûte ;
     §5 LE CALCUL ENTIER — n tentatives, un classement par score croissant, les m
        premières RETENUES avec leurs coordonnées, deux fois le même appel donnent
        le même résultat au chiffre près, les bornes mordent, les refus sont dits, la
        famille est décrite (ce que chaque contrainte mesure, et sa dispersion deux à
        deux après superposition optimale) ;
     §6 LE PANNEAU DU VIEWER — le bouton 🧬, les deux champs (n et m), la liste des
        distances, ▶ Run / ⏹ Stop, le tableau classé, ⤓ Load, l'écriture par le MÊME
        chemin qu'une torsion, la note qui dit ce que ce calcul n'est PAS, et SON
        EMPLACEMENT : le bouton est à côté de « 🧬 Structure from sequence », sa section
        comprise (la demande de cette session : « move the button structure calculation
        next to the button structure from sequence and color the latter in light blue »),
        — et LA FRAPPE DES ATOMES : ce que la table dit d'une case tapée (✓ compris, avec
        le nom de l'atome tombé ; ✕ NOMMÉ par son côté, pour que la plainte du second
        atome ne passe jamais pour celle du premier), et le fait que le navigateur n'a
        pas le droit de réécrire ce qu'on écrit (taper et coller mènent au même texte).

   Run: node _structure_calculation_test.mjs
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dihedralDeg } from './src/utils/torsionDrive.js';
import {
  STRUCTURE_CALC_DEFAULT_STARTS, STRUCTURE_CALC_MAX_STARTS,
  STRUCTURE_CALC_DEFAULT_KEEP, STRUCTURE_CALC_MAX_KEEP,
  STRUCTURE_CALC_SEED, STRUCTURE_CALC_SEED_STEP, STRUCTURE_CALC_RESTRAINT_TOLERANCE,
  STRUCTURE_CALC_MAX_RESTRAINTS,
  STRUCTURE_CALC_ANNEAL_STEPS, STRUCTURE_CALC_ANNEAL_HOT, STRUCTURE_CALC_ANNEAL_COLD,
  STRUCTURE_CALC_QUENCH_STEPS, STRUCTURE_CALC_QUENCH_TEMPERATURE, STRUCTURE_CALC_OMEGA,
  STRUCTURE_CALC_OMEGA_TOLERANCE, STRUCTURE_CALC_OMEGA_WEIGHT,
  STRUCTURE_CALC_RAMA_WEIGHT, STRUCTURE_CALC_CHI_WEIGHT, STRUCTURE_CALC_CHI_TOLERANCE,
  STRUCTURE_CALC_MD_STEPS, STRUCTURE_CALC_MD_HOT, STRUCTURE_CALC_MD_COLD,
  STRUCTURE_CALC_MD_DT, STRUCTURE_CALC_MD_EQUILIBRATION, STRUCTURE_CALC_MD_MAX_TORQUE,
  STRUCTURE_CALC_MD_FRAME, STRUCTURE_CALC_MIN_ROUNDS, STRUCTURE_CALC_LEASH_WALL,
  structureCalcSimulationTimeOf,
  rotatableBondsOf, randomTorsionsOf, channelReadingsOf, restraintListOf,
  restraintReportOf, scoreStructureOf, structureAttemptOf, rankStructureAttempts,
  familySpreadOf, familyRestraintsOf, structureCalculationOf,
  peptideOmegasOf, omegaPenaltyOf, annealTorsionsOf,
  drainFrames, annealFrames, structureAttemptFrames, structureCalculationFrames,
  backboneTorsionsOf, ramaGapOf, ramaPenaltyOf, chiPenaltyOf,
  forceFieldEnergyOf, forceFieldRowsOf, FORCE_FIELD_FAMILIES,
  mdFrames, molecularDynamicsOf, minimizeFrames, minimizeTorsionsOf,
} from './src/utils/structureCalc.js';
import {
  ffKcalEnergyOf, ffKcalRowsOf, FORCE_FIELD_KCAL_FAMILIES,
  hydrogenatedOf, ffHydrogensOf, partialChargesOf, ffPairListOf, ffSurfaceOf, ffSasaOf,
  ffEntropyOf, ffVdwCostOf, ffCoulombCostOf, ffRestraintCostOf, ffOmegaCostOf, ffChiCostOf,
  ffRamaCostOf, ffBondCostOf, ffAngleCostOf, ffPlanarCostOf, ffNonbondedEnergyOf,
  ffRestraintWeightOf, ffRestraintKOf,
  FF_RESTRAINT_TOLERANCE, FF_NOE_K, FF_OMEGA_K, FF_CHI_K, FF_RAMA_K, FF_BOND_K,
  FF_ANGLE_K, FF_PLANAR_K, FF_SASA_GAMMA, FF_GAS_CONSTANT, FF_REFERENCE_TEMPERATURE,
  FF_COULOMB, FF_DIELECTRIC, FF_KCAL_UNITS, FF_PAIR_LIMIT, ffElementOf, FF_VDW_RADII,
} from './src/utils/forceFieldKcal.js';
import { ramaGapOf as ramaGapOfFromPlot } from './src/utils/ramachandran.js';
/* ⚭ Le pont disulfure d'une Cys lointaine : sa liaison SG–SG n'est pas une liaison
   covalente, et c'est `withoutStretchedDisulfideBonds` qui la retire du graphe des
   moteurs (§8). */
import {
  SS_BOND_LENGTH, SS_BOND_TOLERANCE, withoutStretchedDisulfideBonds,
} from './src/utils/disulfideFold.js';

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};
const near = (a, b, what, tol = 1e-6) => {
  assert.ok(Math.abs(Number(a) - Number(b)) <= tol,
    `${what}\n  attendu : ${b} ± ${tol}\n  obtenu  : ${a}`);
  passed += 1;
};
const has = (src, needle, what) => {
  assert.ok(src.includes(needle), `${what}\n  cherche : ${needle}`);
  passed += 1;
};
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const MODULE = read('src/utils/structureCalc.js');
const RELAX = read('src/utils/geometryRelax.js');
const RUN3 = read('src/utils/structureFit.js');
const VIEW = read('src/components/NMRMoleculeViewer.jsx');

/* ── LA CHIMIE DE LA SONDE — une chaîne construite au chiffre près ─────────────
   Les atomes sont posés par `placeWith`, qui RÈGLE le dièdre mesuré par
   `dihedralDeg` : la sonde ne dépend donc d'aucune convention devinée (la même
   béquille que _ramachandran_test.mjs), et les longueurs et les angles sont ceux
   d'un alcane normal — 1.54 Å et 109.47°. */
const DEG = Math.PI / 180;
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit3 = (a) => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
const placeWith = ({ a, b, c, length, angleDeg, dihDeg }) => {
  const bc = unit3(sub3(c, b));
  const n = unit3(cross3(sub3(b, a), bc));
  const m = cross3(bc, n);
  const th = angleDeg * DEG; const ph = dihDeg * DEG;
  const v = [-length * Math.cos(th), length * Math.sin(th) * Math.cos(ph), length * Math.sin(th) * Math.sin(ph)];
  let p = [0, 1, 2].map((k) => c[k] + v[0] * bc[k] + v[1] * m[k] + v[2] * n[k]);
  let delta = dihDeg - dihedralDeg(a, b, c, p);
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  const r = delta * DEG; const cs = Math.cos(r); const sn = Math.sin(r);
  const w = sub3(p, c);
  const d = bc[0] * w[0] + bc[1] * w[1] + bc[2] * w[2];
  const rot = [
    w[0] * cs + (bc[1] * w[2] - bc[2] * w[1]) * sn + bc[0] * d * (1 - cs),
    w[1] * cs + (bc[2] * w[0] - bc[0] * w[2]) * sn + bc[1] * d * (1 - cs),
    w[2] * cs + (bc[0] * w[1] - bc[1] * w[0]) * sn + bc[2] * d * (1 - cs),
  ];
  return [0, 1, 2].map((k) => c[k] + rot[k]);
};
const LEN = 1.54;
const ANG = 109.47;
/** Une chaîne d'alcanes : n carbones, liaisons de 1.54 Å, coudes de 109.47°, chaque
 *  dièdre consécutif à `dih` degrés, toutes les liaisons à `order`. */
const chainOf = (n, { el = 'C', dih = 60, order = 1 } = {}) => {
  const th = ANG * DEG;
  const pts = [[0, 0, 0], [LEN, 0, 0], [LEN - LEN * Math.cos(th), LEN * Math.sin(th), 0]];
  for (let k = 3; k < n; k += 1) {
    pts.push(placeWith({
      a: pts[k - 3], b: pts[k - 2], c: pts[k - 1], length: LEN, angleDeg: ANG, dihDeg: dih,
    }));
  }
  const bonds = [];
  for (let k = 0; k + 1 < n; k += 1) bonds.push({ i: k, j: k + 1, order });
  return {
    count: n, elements: Array.from({ length: n }, () => el), bonds, positions: pts.flat(),
  };
};
/** Le point d'un atome, à plat. */
const at3 = (x, i) => [x[i * 3], x[i * 3 + 1], x[i * 3 + 2]];
/** Les longueurs et les angles d'un graphe, relus sur un tableau à plat. */
const geometryOf = ({ positions, bonds }) => {
  const lengths = bonds.map((b) => Math.hypot(
    positions[b.i * 3] - positions[b.j * 3],
    positions[b.i * 3 + 1] - positions[b.j * 3 + 1],
    positions[b.i * 3 + 2] - positions[b.j * 3 + 2],
  ));
  const angles = [];
  for (const b of bonds) {
    for (const o of bonds) {
      const apex = (b.j === o.i || b.i === o.j) ? (b.j === o.i ? b.j : b.i)
        : ((b.j === o.j || b.i === o.i) ? (b.j === o.j ? b.j : b.i) : -1);
      if (apex < 0) continue;
      const p = b.i === apex ? b.j : b.i;
      const q = o.i === apex ? o.j : o.i;
      if (p === q) continue;
      const u = sub3(at3(positions, p), at3(positions, apex));
      const v = sub3(at3(positions, q), at3(positions, apex));
      const c = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2])
        / ((Math.hypot(...u) || 1) * (Math.hypot(...v) || 1));
      angles.push(Math.acos(Math.min(1, Math.max(-1, c))) / DEG);
    }
  }
  return { lengths, angles };
};
/** La plus grande différence, coordonnée par coordonnée. */
const maxDiff = (a, b) => Math.max(...a.map((v, k) => Math.abs(v - b[k])));

/* ── 1 · LE MODULE, SES BORNES, ET CE QU'IL EMPRUNTE ───────────────────────── */
eq(STRUCTURE_CALC_DEFAULT_STARTS, 8, 'le panneau propose huit structures de départ');
eq(STRUCTURE_CALC_MAX_STARTS, 64, '…et refuse d’en calculer plus de soixante-quatre');
eq(STRUCTURE_CALC_DEFAULT_KEEP, 3, 'trois structures retenues par défaut');
eq(STRUCTURE_CALC_MAX_KEEP, 12, '…douze au plus (une famille se regarde)');
near(STRUCTURE_CALC_RESTRAINT_TOLERANCE, 0.25,
  'une distance demandée est RESPECTÉE à 0.25 Å près — l’ordre d’une contrainte NOE tenue', 1e-12);
ok(STRUCTURE_CALC_SEED > 0 && Number.isInteger(STRUCTURE_CALC_SEED),
  'la graine du calcul est un entier fixe : le même n redonne les mêmes départs');
eq(STRUCTURE_CALC_SEED_STEP, 0x9E3779B1,
  '…et la graine du départ k avance de k pas dorés (2³²/φ) : deux départs ne tirent jamais la même suite');
/* LES 🎲 BOTTES ONT DISPARU avec le protocole du ⚒ : la diversification, c'est n. */
ok(STRUCTURE_CALC_QUENCH_STEPS >= 1, 'la trempe finale a au moins un palier');
ok(STRUCTURE_CALC_QUENCH_TEMPERATURE > 0 && STRUCTURE_CALC_QUENCH_TEMPERATURE < STRUCTURE_CALC_ANNEAL_COLD,
  '⚠ la trempe est PLUS FROIDE que le refroidissement (elle répare ω et ne casse rien)');
ok(STRUCTURE_CALC_MAX_RESTRAINTS >= 10, 'le module accepte une liste de contraintes utilisable');
/* LE PROTOCOLE STANDARD, ET SES UNITÉS — « implement a standard protocol … apply the
   kcal/mol » : les températures sont des KELVINS, les temps des PICOSECONDES. */
ok(STRUCTURE_CALC_ANNEAL_HOT > STRUCTURE_CALC_ANNEAL_COLD && STRUCTURE_CALC_ANNEAL_HOT >= 1000,
  '⚠ le recuit CHAUFFE vraiment (1500 K : 3 kcal/mol d’énergie thermique, de quoi changer de bassin)');
near(FF_GAS_CONSTANT, 1.98720425864083e-3, '⚠ R (kcal·mol⁻¹·K⁻¹) est la seule conversion du dossier', 1e-15);
near(FF_GAS_CONSTANT * 298.15, 0.5925, '…donc 298 K valent 0.59 kcal/mol d’énergie thermique', 5e-3);
eq(FF_KCAL_UNITS.energy, 'kcal/mol', '⚠ l’unité d’énergie du champ est DITE, et c’est le kcal/mol');
eq(FF_KCAL_UNITS.temperature, 'K', '…la température est en kelvins');
eq(FF_KCAL_UNITS.time, 'ps', '…et le temps en picosecondes');
eq(structureCalcSimulationTimeOf({ steps: 500, dt: 0.01 }).ps, 5,
  '⚠ « total simulation time » = pas × dt (500 pas de 0.01 ps font 5 ps)');
eq(structureCalcSimulationTimeOf({ steps: 0, dt: 0.01 }).ps, 0, '…sans pas, aucune durée');
eq(structureCalcSimulationTimeOf({ steps: 3, dt: Number.NaN }).dt, STRUCTURE_CALC_MD_DT,
  '…et un pas de temps illisible retombe sur celui du dossier');
ok(STRUCTURE_CALC_MD_EQUILIBRATION > 0 && STRUCTURE_CALC_MD_EQUILIBRATION < 1,
  '⚠ la dynamique a une phase d’ÉQUILIBRATION (chaud) puis un REFROIDISSEMENT, comme un protocole standard');
ok(STRUCTURE_CALC_MD_MAX_TORQUE > 0 && STRUCTURE_CALC_MD_MAX_TORQUE < 1000,
  '⚠ l’intégrateur a un plafond de couple : un mur de Lennard-Jones ne fait pas sauter la conformation');

/* LE PROTOCOLE, LA FONCTION CIBLE ET LE TIRAGE VIENNENT DU ⚒ — jamais d'une seconde
   table, d'une seconde descente ou d'un second générateur. */
has(MODULE, "} from './geometryRelax.js';", 'le module importe le module du ⚒');
has(MODULE, "} from './forceFieldKcal.js';", '⚠ …et le CHAMP DE FORCES en kcal/mol est un module à part, qu’il branche');
for (const name of ['buildRelaxTerms', 'bondGraphOf', 'badContactsOf', 'clashReportOf']) {
  has(MODULE, name, `…et il emprunte « ${name} » (aucune seconde implémentation)`);
}
has(MODULE, 'torsionEngineOf', '⚠ le moteur dihédral est UN seul endroit : le recuit, la dynamique et la minimisation l’appellent');
ok(!/const corePairsOf = /.test(MODULE) && !/const costPair = /.test(MODULE),
  '⚠ la physique recopiée a DISPARU du moteur (plus de cœur dur à part, plus de coût recopié)');
has(RELAX, 'export const buildModelGeometry', '…le protocole « model build » reste le bouton ⚒ du panneau, il n’est plus le moteur du calcul');
has(RELAX, 'export const makeRelaxRandom', '…et le générateur du ⚒ est le seul générateur du dossier');
ok(!/(mulberry32\s*=|function mulberry32|Math\.random\()/.test(MODULE),
  '⚠ donc AUCUN second générateur ici — ni mulberry32 recopié, ni Math.random (le nom n’apparaît que pour dire d’où vient le tirage)');
has(MODULE, "import { dihedralDeg, planTorsion } from './torsionDrive.js';",
  'le dièdre se RELIT et se POSE avec les deux fonctions du dossier');
has(MODULE, "import { rigidTransform } from './structureFit.js';",
  '…et la dispersion de la famille passe par le solveur de superposition du dossier');
has(RUN3, 'export const rigidTransform', '…qui est bien celui-là (kabsch de utils/mdAnalysis.js)');
eq([...MODULE.matchAll(/from '([^']+)';/g)].map((m) => m[1]).sort(),
  ['./forceFieldKcal.js', './geometryRelax.js', './ramachandran.js', './structureFit.js', './torsionDrive.js'].sort(),
  '⚠ le module n’importe QUE le champ, le ⚒, les bassins du graphe 🪢, le dièdre et la superposition — rien d’autre (aucun écran, aucun NGL)');
ok(!/(positionFromArray\(|updateRepresentations\(|document\.|window\.requestAnimationFrame)/.test(MODULE),
  'le module est PUR : il ne touche à aucun tableau de coordonnées et à aucune fenêtre');
for (const fn of ['rotatableBondsOf', 'randomTorsionsOf', 'restraintListOf', 'restraintReportOf',
  'scoreStructureOf', 'structureAttemptOf', 'rankStructureAttempts', 'familySpreadOf',
  'structureCalculationOf']) {
  has(MODULE, `export const ${fn} =`, `le module exporte « ${fn} »`);
}
/* ET LES MOTEURS ÉCRITS EN GÉNÉRATEURS — un seul moteur, deux conducteurs (le module qui
   va jusqu'au bout, et l'écran qui peint entre deux images). */
for (const fn of ['annealFrames', 'structureAttemptFrames', 'structureCalculationFrames',
  'mdFrames', 'minimizeFrames']) {
  has(MODULE, `export function* ${fn}(`, `le moteur « ${fn} » est un GÉNÉRATEUR (il rend la main à chaque image)`);
}
for (const fn of ['drainFrames', 'molecularDynamicsOf', 'minimizeTorsionsOf']) {
  has(MODULE, `export const ${fn} =`, `…et « ${fn} » le conduit`);
}
ok(!/const step = \(phase, positions/.test(MODULE),
  '⚠ les gestes du départ ne sont plus poussés par un rappel : ils sont YIELDÉS (§5)');
ok(/drainFrames\(annealFrames\(spec\), spec\.onStep\)/.test(MODULE)
  && /drainFrames\(structureAttemptFrames\(spec\), spec\.onStep\)/.test(MODULE)
  && /drainFrames\(structureCalculationFrames\(spec\), spec\.onFrame\)/.test(MODULE),
  '⚠ …et les trois fonctions historiques sont EXACTEMENT le même moteur, conduit d’un trait (aucun code recopié)');

/* ── 2 · LE LECTEUR DES DIÈDRES, EXÉCUTÉ ───────────────────────────────────── */
const hexane = chainOf(6);
const chans = rotatableBondsOf({ elements: hexane.elements, bonds: hexane.bonds, atomCount: 6 });
eq(chans.checked, 5, 'le lecteur regarde les cinq liaisons du graphe');
eq(chans.count, 3, '⚠ trois d’entre elles SONT un dièdre (les charnières de l’hexane)');
eq(chans.channels.map((c) => [c.i, c.j]), [[1, 2], [2, 3], [3, 4]],
  '…et ce sont les trois liaisons intérieures, dans l’ordre des indices');
eq(chans.terminal, 2,
  'les deux liaisons des extrémités ne font pas un dièdre (il n’y a pas de quatrième atome)');
eq([chans.ring, chans.multiple, chans.unknown], [0, 0, 0], '…et rien n’a été écarté pour une autre raison');
for (const c of chans.channels) {
  ok(c.moving.every((k) => k !== c.axis[0] && k !== c.axis[1]),
    `le côté qui tourne (${c.i}–${c.j}) ne contient AUCUN atome de l’axe — un atome de l’axe ne bouge pas`);
  ok(c.movingCount <= c.anchorCount,
    `…et c’est le PLUS PETIT des deux côtés (${c.movingCount} contre ${c.anchorCount}) : un dièdre tourne le bout`);
  ok(c.moving.includes(c.probe) && !c.moving.includes(c.ref),
    '…D (l’atome mobile) est dedans, A (la référence) dehors');
  ok(c.probeAtoms.length === 4 && c.probeAtoms[1] === c.axis[0] && c.probeAtoms[2] === c.axis[1],
    '…et le quadruplet du dièdre est bien A–B–C–D avec B–C pour axe');
  ok(c.moving.every((k, idx) => idx === 0 || k > c.moving[idx - 1]),
    'la liste des atomes qui tournent est TRIÉE (le contrat de planTorsion)');
}

const ring = (() => {
  const n = 6; const r = LEN / (2 * Math.sin(Math.PI / n));
  const positions = [];
  for (let k = 0; k < n; k += 1) {
    positions.push([r * Math.cos((k * 2 * Math.PI) / n), r * Math.sin((k * 2 * Math.PI) / n), 0]);
  }
  const bonds = [];
  for (let k = 0; k < n; k += 1) bonds.push({ i: k, j: (k + 1) % n, order: 1 });
  return { count: n, elements: Array.from({ length: n }, () => 'C'), bonds, positions: positions.flat() };
})();
const ringRead = rotatableBondsOf({ elements: ring.elements, bonds: ring.bonds, atomCount: 6 });
eq(ringRead.count, 0, '⚠ un CYCLE n’a aucune charnière : tourner une de ses liaisons déformerait le cycle');
eq([ringRead.ring, ringRead.checked], [6, 6],
  '…les six liaisons sont comptées comme des liaisons de cycle, pas oubliées');

const ene = chainOf(4);
ene.bonds[1].order = 2;
const eneRead = rotatableBondsOf({ elements: ene.elements, bonds: ene.bonds, atomCount: 4 });
eq(eneRead.count, 0, '⚠ une DOUBLE liaison ne tourne pas');
eq(eneRead.multiple, 1, '…et le lecteur la compte : il dit POURQUOI il l’a écartée');

const ethane = chainOf(2);
const ethaneRead = rotatableBondsOf({ elements: ethane.elements, bonds: ethane.bonds, atomCount: 2 });
eq([ethaneRead.count, ethaneRead.terminal], [0, 1], 'une molécule à une seule liaison n’a aucun dièdre');
eq(rotatableBondsOf({ elements: [], bonds: [], atomCount: 0 }).count, 0,
  '…et un graphe vide non plus (aucune exception)');

/* LES CONTRAINTES, NORMALISÉES — ce qui est refusé est COMPTÉ. */
const clean = restraintListOf({
  restraints: [
    [0, 5, 3.2], { i: 0, j: 5, target: 4.4 }, [2, 4, 3],
    [0, 0, 3], [99, 1, 3], { i: 1, j: 2, target: -1 }, [1, 4, 0],
  ],
  atomCount: 6,
});
eq(clean.list.map((r) => [r.i, r.j, r.target]), [[0, 5, 3.2], [2, 4, 3]],
  'la liste garde les contraintes lisibles, dans l’ordre reçu');
eq(clean.count, 2, '…et les numérote');
eq(clean.dropped, 5,
  '⚠ un doublon, un couple dégénéré, un indice hors molécule, une cible négative et une cible nulle sont ÉCARTÉS et comptés');
eq(clean.list[0].order, 1, '…la première ligne du rapport porte le numéro 1');
eq(restraintListOf({ restraints: null, atomCount: 3 }).count, 0, 'une liste absente ne casse rien');

/* ⚖ LE POIDS D'UNE LIGNE — la demande de cette session : « enable this option allowing
   the user to give a weight to these constraints. This weight can be defined in the
   table. » Le poids est une PROPRIÉTÉ de la ligne : `restraintListOf` le TRANSPORTE
   jusqu'au moteur (1 quand il n'est pas donné, 0 permis — une ligne en pause), et c'est
   lui qui multiplie la raideur du puits plat (`k = FF_NOE_K × poids`, voir
   `ffRestraintWeightOf` / `ffRestraintKOf` du champ). */
const weighted = restraintListOf({
  restraints: [
    { i: 0, j: 5, target: 3 }, { i: 1, j: 5, target: 3, weight: 2.5 },
    { i: 2, j: 5, target: 3, weight: 0 }, { i: 3, j: 5, target: 3, weight: 'abc' },
    { i: 4, j: 5, target: 3, weight: -1 }, { i: 1, j: 3, target: 3, weight: false },
  ],
  atomCount: 6,
});
eq(weighted.list.map((r) => r.weight), [1, 2.5, 0, 1, 1, 1],
  '⚠ les poids traversent la liste NORMALISÉE : 1 par défaut, 2.5 tel quel, 0 tel quel (une mise en pause est une valeur), et un poids illisible, négatif ou booléen retombe à 1');
eq(weighted.list.map((r) => r.order), [1, 2, 3, 4, 5, 6],
  '…sans changer l’ordre ni la numérotation des lignes (un poids ne réordonne rien)');
eq(ffRestraintWeightOf(undefined), 1,
  'un poids ABSENT vaut 1 : une table écrite avant cette colonne se comporte exactement comme avant');
eq([ffRestraintWeightOf(2), ffRestraintWeightOf('0.5'), ffRestraintWeightOf(0)], [2, 0.5, 0],
  '…et un chiffre donné, texte ou nombre, est lu tel quel (le 0 compris)');
eq([ffRestraintKOf(1), ffRestraintKOf(2), ffRestraintKOf(0), ffRestraintKOf(0.5)],
  [FF_NOE_K, FF_NOE_K * 2, 0, FF_NOE_K / 2],
  '…et `ffRestraintKOf` rend LA raideur de la ligne : k_NOE × poids, exactement — un poids de 0 rend la ligne inerte');

/* ── 3 · LE TIRAGE DES DIÈDRES, EXÉCUTÉ ───────────────────────────────────────
   Une rotation autour d'une liaison est RIGIDE : elle change les dièdres et RIEN
   d'autre. C'est la seule chose qui rend « randomiser les dièdres » différent de
   « secouer la molécule », et la sonde le mesure. */
const drawOf = (geom, seed) => randomTorsionsOf({
  positions: geom.positions, elements: geom.elements, bonds: geom.bonds, seed,
});
const drawA = drawOf(hexane, STRUCTURE_CALC_SEED);
const drawB = drawOf(hexane, STRUCTURE_CALC_SEED);
const drawC = drawOf(hexane, STRUCTURE_CALC_SEED + STRUCTURE_CALC_SEED_STEP);
eq(maxDiff(drawA.positions, drawB.positions), 0,
  '⚠ le MÊME n (la même graine) redonne le même départ, coordonnée par coordonnée');
ok(maxDiff(drawC.positions, drawA.positions) > 0.1,
  '…et un AUTRE n en donne un autre (les départs ne sont pas tous pareils)');
eq(drawA.drawn, chans.count, 'CHAQUE canal de dièdre est tourné (ici les trois de l’hexane)');
eq(drawA.skipped.length, 0, '…aucun quadruplet refusé sur une molécule propre');
eq(drawA.counts, { ring: 0, multiple: 0, terminal: 2, unknown: 0 },
  '…et le tirage reprend le compte du lecteur (ce qui n’est PAS un dièdre est dit)');
for (const t of drawA.turned) {
  near(t.before, 60, `le dièdre de ${t.i}–${t.j} était bien celui que la sonde avait construit (60°)`, 1e-6);
  near(t.after, t.drawn, '…et il est maintenant EXACTEMENT l’angle tiré (relu par le lecteur du dossier)', 1e-9);
  ok(t.drawn > -180 && t.drawn < 180, `…tiré dans (−180, 180] : ${t.drawn}`);
  ok(t.atoms >= 1, '…et au moins un atome a tourné');
}
const before = geometryOf(hexane);
const afterDraw = geometryOf({ positions: drawA.positions, bonds: hexane.bonds });
ok(Math.max(...afterDraw.lengths.map((d, k) => Math.abs(d - before.lengths[k]))) < 1e-9,
  '⚠ les LONGUEURS de liaison ne bougent pas d’un chiffre — une rotation est rigide');
ok(Math.max(...afterDraw.angles.map((d, k) => Math.abs(d - before.angles[k]))) < 1e-9,
  '⚠ …ni les ANGLES (' + afterDraw.angles.length + ' paires relues)');
ok(Math.max(...before.lengths.map((d) => Math.abs(d - LEN))) < 1e-9,
  '…et la chaîne de la sonde était bien à 1.54 Å AVANT (la mesure a un sens)');
for (const r of channelReadingsOf({ positions: drawA.positions, channels: drawA.channels })) {
  const t = drawA.turned.find((u) => u.i === r.i && u.j === r.j);
  near(r.deg, t.drawn, `le module RELIT le dièdre de ${r.i}–${r.j} et retrouve ce qu’il a posé`, 1e-9);
}

/* LE CÔTÉ QUI NE TOURNE PAS EST BIT À BIT OÙ IL ÉTAIT — sur une molécule à un seul
   canal (butane : la charnière 1–2 fait tourner l'atome 3, le côté 0–1–2 ne bouge
   pas d'un chiffre). */
const butane = chainOf(4);
const butaneDraw = drawOf(butane, 7);
eq(butaneDraw.channels.length, 1, 'le butane n’a qu’une charnière');
eq(butaneDraw.channels[0].moving, [3], '…et c’est le dernier atome qui tourne (le plus petit côté)');
eq(butaneDraw.positions.slice(0, 9), butane.positions.slice(0, 9),
  '⚠ le côté qui ne tourne pas est rendu BIT À BIT : aucune dérive, aucun arrondi');
ok(maxDiff(butaneDraw.positions.slice(9), butane.positions.slice(9)) > 0.1,
  '…tandis que l’atome qui tourne a vraiment tourné');

/* UNE MOLÉCULE SANS DIÈDRE — le tirage ne touche à rien, et le DIT. */
const noChannel = drawOf(ethane, 3);
eq([noChannel.drawn, noChannel.skipped.length], [0, 0], 'l’éthane n’a aucun canal : rien à tirer');
eq(noChannel.positions, ethane.positions, '…et les coordonnées sont rendues telles quelles');

/* UN QUADRUPLET SANS DIHÈDRE — aligné, il n’a pas d’angle : le module le REFUSE au
   lieu d’inventer un nombre. */
const linear = {
  count: 4,
  elements: ['C', 'C', 'C', 'C'],
  bonds: [{ i: 0, j: 1, order: 1 }, { i: 1, j: 2, order: 1 }, { i: 2, j: 3, order: 1 }],
  positions: [0, 0, 0, LEN, 0, 0, 2 * LEN, 0, 0, 3 * LEN, 0, 0],
};
const linearDraw = drawOf(linear, 11);
eq(linearDraw.ok, true, 'un tirage qui ne peut rien tourner ne lève pas : il rend la molécule');
eq(linearDraw.drawn, 0, '…sans un seul dièdre posé');
eq(linearDraw.skipped.length, 1, '⚠ …et il COMPTE le quadruplet refusé');
eq(linearDraw.skipped[0].why, 'no-dihedral',
  '…avec la raison du module (quatre atomes alignés n’ont pas de dièdre)');
eq(linearDraw.positions, linear.positions, '…donc rien n’a bougé (aucune position inventée)');
eq(randomTorsionsOf({}).ok, false, 'sans coordonnées lisibles, le tirage est refusé d’emblée');

/* ── 4 · LE PROTOCOLE STANDARD SUR UN DÉPART, EXÉCUTÉ ─────────────────────────
   La demande, mot pour mot : « implement a standard protocol (dihedral annealing + MD
   + minimisation under a real force field) ». La sonde prend une chaîne dont les deux
   bouts sont à 4.62 Å, demande 3.90 Å, et MESURE ce qui arrive — puis demande
   l'impossible (1.00 Å sur une LIAISON) et vérifie que le rapport le DIT au lieu de le
   prétendre. */
const exact = restraintReportOf({ positions: hexane.positions, restraints: [{ i: 0, j: 5, target: 3.9 }] });
eq(exact.count, 1, 'une contrainte, une ligne de rapport');
eq(exact.violations, 1, '⚠ la chaîne reçue est à 4.62 Å : 3.90 Å n’est PAS respecté');
near(exact.worst.distance, 4.619948447180539, '…et la distance mesurée est celle des coordonnées, au chiffre près', 1e-9);
near(exact.rmsd, exact.worst.abs, 'la racine des écarts au carré et l’écart de la seule contrainte sont le même chiffre', 1e-12);
const satisfied = restraintReportOf({
  positions: hexane.positions,
  restraints: [{ i: 0, j: 5, target: exact.worst.distance }],
});
eq([satisfied.satisfied, satisfied.violations, satisfied.rmsd], [1, 0, 0],
  '…et à sa distance mesurée, la contrainte EST respectée (aucun écart inventé)');

const fix = structureAttemptOf({
  positions: hexane.positions, elements: hexane.elements, bonds: hexane.bonds,
  restraints: [{ i: 0, j: 5, target: 3.9 }], index: 0, md: 60, minimise: 2,
});
eq(fix.ok, true, 'le départ passe par le protocole standard');
ok(fix.draw.turned > 0, '…en TIRANT les dièdres au hasard (le départ n’est pas la molécule reçue)');
/* ⚠ LA CONTRAINTE EST UN PUITS PLAT, PAS UNE BARRE DE FER — c'est la sémantique d'un vrai
   protocole (XPLOR/CNS, CYANA) : ± 0.25 Å de liberté, puis k·over². Un modèle qui reste à
   0.29 Å de la cible est donc DIT (1 contrainte hors tolérance), et la sonde l'exige au
   lieu de prétendre une précision qu'aucun champ ne donne. Ce qu'elle vérifie, c'est que
   le protocole TIRE la distance vers la cible et que l'écart qui reste est petit et écrit. */
ok(fix.restraint.worst.distance < exact.worst.distance - 0.2,
  `⚠ le protocole TIRE la distance vers la cible : ${exact.worst.distance.toFixed(3)} Å au départ, ${fix.restraint.worst.distance.toFixed(3)} Å à l’arrivée`);
ok(fix.restraint.worst.abs < 0.4,
  `…et l’écart qui reste est petit (${fix.restraint.worst.abs.toFixed(3)} Å, tolérance ${STRUCTURE_CALC_RESTRAINT_TOLERANCE} Å)`);
ok(fix.restraint.violations === (fix.restraint.worst.abs <= STRUCTURE_CALC_RESTRAINT_TOLERANCE ? 0 : 1),
  '…et le nombre de contraintes hors tolérance est EXACTEMENT ce que la mesure dit');
/* CE QUE LE PROTOCOLE A FAIT, ÉTAPE PAR ÉTAPE — la somme des étapes est le coût du champ,
   donc un aller-retour se VÉRIFIE (et les constantes du mouvement sont rendues à part). */
let prev = null;
for (const st of fix.protocol.stages) {
  if (prev != null && st.before != null) {
    ok(Math.abs(st.before - prev) < 1e-6,
      `⚠ l’étape « ${st.name} » part du coût où la précédente s’est arrêtée (${Number(prev).toFixed(3)} kcal/mol)`);
  }
  if (st.after != null) prev = st.after;
}
ok(fix.protocol.stages.every((s) => s.after == null || s.after === s.after),
  '…et chaque étape annonce son coût d’arrivée');
eq(fix.reason, 'standard-protocol', '…et le départ dit quelle famille de protocole il a suivie');
ok(fix.moved >= 2, `…et ${fix.moved} atomes ont bougé de la molécule reçue`);
const fixed = geometryOf({ positions: fix.positions, bonds: hexane.bonds });
ok(Math.max(...fixed.lengths.map((d) => Math.abs(d - LEN))) < 0.05,
  '⚠ …sans casser la chimie : toutes les liaisons restent à 1.54 Å ± 0.05');
ok(Math.max(...fixed.angles.map((d) => Math.abs(d - ANG))) < 4,
  '…et tous les angles à 109.47° ± 4 — la géométrie est TENUE pendant le geste');
ok(fix.bond < 0.01 * FF_BOND_K && fix.angle < 4,
  `…le rapport le chiffre : liaisons ${fix.bond.toFixed(4)} kcal/mol, angles ${fix.angle.toFixed(3)} kcal/mol`);

/* UNE DISTANCE QUE LA GÉOMÉTRIE INTERDIT — une LONGUEUR DE LIAISON. Un pas de torsion est
   une rotation rigide (il ne peut pas changer une liaison) et le terme de liaison du champ
   (k = 300) l'emporte sur la contrainte (k = 20) : demander 1.00 Å sur un C–C de 1.54 Å ne
   peut pas être satisfait, et c'est ce que la sonde exige — l'écart est DIT, jamais maquillé. */
const hard = structureAttemptOf({
  positions: hexane.positions, elements: hexane.elements, bonds: hexane.bonds,
  restraints: [{ i: 0, j: 1, target: 1.0 }], index: 0, md: 60, minimise: 2,
});
eq(hard.restraint.violations, 1, '⚠ une distance IMPOSSIBLE n’est pas prétendue atteinte : elle reste en défaut');
ok(hard.restraint.worst.distance > 1.0 + STRUCTURE_CALC_RESTRAINT_TOLERANCE,
  `…et le rapport donne la distance RÉELLEMENT obtenue (${hard.restraint.worst.distance.toFixed(3)} Å au lieu de 1.00)`);
ok(hard.restraintEnergy > fix.restraintEnergy * 2,
  `…et le PUITS PLAT le chiffre : la contrainte impossible coûte ${hard.restraintEnergy.toFixed(2)} kcal/mol, la contrainte tenue ${fix.restraintEnergy.toFixed(2)}`);

/* LA NOTE — elle préfère ce qui respecte la contrainte, et elle est EN kcal/mol. */
const good = scoreStructureOf({
  positions: hexane.positions, elements: hexane.elements, bonds: hexane.bonds,
  restraints: [{ i: 0, j: 5, target: 4.619948447180539 }],
});
const bad = scoreStructureOf({
  positions: hexane.positions, elements: hexane.elements, bonds: hexane.bonds,
  restraints: [{ i: 0, j: 5, target: 3.9 }],
});
near(good.restraintEnergy, 0, 'une contrainte respectée ne coûte RIEN (le PUITS PLAT du champ)', 1e-9);
ok(bad.restraintEnergy > 0, '…tandis qu’une contrainte violée coûte k_NOE·(écart − tolérance)²');
ok(good.score < bad.score, '⚠ donc la note préfère le modèle qui respecte la distance demandée');
eq(good.clashPenalty, 0,
  '⚠ la pénalité d’empilement à part a disparu : le MUR de Lennard-Jones est DANS le champ');
ok(good.score === good.freeEnergy && good.total === good.enthalpy,
  '⚠ `score` est la free energy du champ (enthalpie + entropie), et les deux sont nommées');
ok(Math.abs(good.freeEnergy - (good.enthalpy + good.entropyEnergy)) < 1e-6,
  '…`freeEnergy = enthalpy + entropyEnergy` (−T·S), au chiffre près');
ok(good.bond >= 0 && good.angle >= 0 && Number.isFinite(good.vdw) && Number.isFinite(good.elec),
  '…la fonction cible est bien le champ entier (liaisons, angles, vdW, électrostatique)');
eq(scoreStructureOf({}).ok, false, 'sans coordonnées, la note est refusée (score infini) au lieu d’un zéro trompeur');

/* ⚖ LE POIDS, EXÉCUTÉ — il ne décore pas le rapport : il change L'ÉNERGIE. Même couple,
   même cible, même écart ; seule la colonne ⚖ change, et le prix suit exactement. */
const pair = { i: 0, j: 5, target: 3.9 };
const weightedScore = (w) => scoreStructureOf({
  positions: hexane.positions, elements: hexane.elements, bonds: hexane.bonds,
  restraints: [w === null ? pair : { ...pair, weight: w }],
});
const sOne = weightedScore(null);
const sTwo = weightedScore(2);
const sHalf = weightedScore(0.5);
const sZero = weightedScore(0);
ok(sOne.restraintEnergy > 0,
  `…la contrainte dépassée coûte ${sOne.restraintEnergy.toFixed(3)} kcal/mol à ⚖ 1`);
near(sTwo.restraintEnergy, sOne.restraintEnergy * 2,
  '⚠ …DEUX FOIS plus cher à ⚖ 2 : le poids multiplie le puits plat, il ne s’y ajoute pas', 1e-5);
near(sHalf.restraintEnergy, sOne.restraintEnergy / 2, '…et deux fois moins à ⚖ 0.5', 1e-5);
near(sZero.restraintEnergy, 0,
  '⚠ …et RIEN du tout à ⚖ 0 : la ligne est INERTE (elle reste dans le rapport, elle ne pèse rien)', 1e-9);
eq(sOne.restraint.list[0].weight, 1, 'la ligne du rapport dit son poids (1 quand il n’est pas donné)');
eq(sTwo.restraint.list[0].k, FF_NOE_K * 2,
  '…et sa raideur, telle que le champ l’a lue (`k` par ligne, jamais recopié ailleurs)');
near(sTwo.restraint.list[0].distance, sOne.restraint.list[0].distance,
  '…la MESURE, elle, ne dépend pas du poids : c’est la raideur qui change', 1e-12);
eq([sTwo.restraint.satisfied, sZero.restraint.satisfied], [0, 0],
  '…et « respectée » reste une lecture GÉOMÉTRIQUE : c’est la tolérance qui la décide, pas le poids');

/* ⚖ …ET LE MOTEUR DE TORSION LE SENT AUSSI — la note n'est pas la seule à lire le poids :
   c'est `costRestraint` / `costWall` du moteur (la dynamique et la minimisation), donc le
   coût de départ d'une descente est le même chiffre que celui du champ. */
const engineCostOf = (restraints) => minimizeTorsionsOf({
  positions: hexane.positions, elements: hexane.elements, bonds: hexane.bonds,
  restraints, rounds: 1,
}).cost.before;
const costFree = engineCostOf([]);
const costOne = engineCostOf([pair]);
const costTwo = engineCostOf([{ ...pair, weight: 2 }]);
const costZero = engineCostOf([{ ...pair, weight: 0 }]);
ok(costOne - costFree > 0, `…le moteur sent la contrainte à ⚖ 1 (${(costOne - costFree).toFixed(3)} kcal/mol)`);
near(costZero, costFree,
  '⚠ …il ne sent PAS une ligne de poids 0 : son coût de départ est celui d’une molécule sans contrainte', 1e-9);
near(costTwo - costFree, (costOne - costFree) * 2,
  '…et il sent DEUX fois une ligne de poids 2 : ce que la note compte est ce que la descente minimise', 1e-5);

const stacked = chainOf(6);
for (let k = 0; k < 3; k += 1) { stacked.positions[k] = 0; stacked.positions[15 + k] = 0; }
const stackScore = scoreStructureOf({
  positions: stacked.positions, elements: stacked.elements, bonds: stacked.bonds,
  restraints: [{ i: 0, j: 5, target: 3.9 }],
});
ok(stackScore.clashes.count >= 1, '⚠ deux atomes au même endroit sont COMPTÉS comme empilés');
ok(stackScore.vdw > 0,
  '…et le MUR de Lennard-Jones du champ les fait payer (la pénalité à part a disparu : elle comptait deux fois)');
ok(stackScore.nonbonded.repulsive > 0,
  '…le rapport DIT combien de couples sont répulsifs (deux atomes qui se traversent)');
eq(stackScore.clashes.minDistance, 1.45, 'le seuil annoncé est celui du module (RELAX_CLASH_DISTANCE)');

/* ── 5 · LE CALCUL ENTIER — n DÉPARTS, m RETENUES ─────────────────────────────
   « generate n structures […] the final result is scored. the best m structures are
   retained. » La sonde demande n = 4, m = 2, et vérifie que les quatre ont été
   calculées, que les deux retenues sont bien les deux meilleures, et que le MÊME
   appel redonne le même résultat au chiffre près. */
const spec = {
  positions: hexane.positions, elements: hexane.elements, bonds: hexane.bonds,
  restraints: [{ i: 0, j: 5, target: 3.9 }], starts: 4, keep: 2,
  /* ⚙ LE PROTOCOLE EST COMPLET (les valeurs par défaut), MAIS LA SONDE LE RACCOURCIT :
     le même moteur, un budget qui laisse le fichier tourner en quelques secondes (500
     pas de dynamique × 4 départs × les 20 atomes, sur chaque bloc, serait payer la
     physique pour vérifier la MÉCANIQUE). */
  anneal: 2, md: 40, minimise: 1,
};
const calc = structureCalculationOf(spec);
eq(calc.ok, true, 'le calcul aboutit');
eq(calc.reason, 'ok', '…jusqu’au bout (aucun arrêt demandé)');
eq([calc.starts, calc.keep], [4, 2], 'n = 4 départs, m = 2 retenues — ce que l’utilisateur a choisi');
eq([calc.tried, calc.scored, calc.refused], [4, 4, 0], '…les quatre sont calculées et notées, aucune refusée');
eq(calc.ranking.map((r) => r.rank), [1, 2, 3, 4], 'le classement numérote les quatre');
ok(calc.ranking.every((r, k) => k === 0 || r.score >= calc.ranking[k - 1].score),
  '⚠ …par SCORE CROISSANT : le meilleur est le premier, et jamais autre chose que le score ne décide');
eq(calc.retained.length, 2, 'exactement m structures sont RETENUES');
eq(calc.retained.map((r) => r.rank), [1, 2], '…et ce sont les deux premières du classement');
eq(calc.retained.map((r) => r.index), calc.ranking.slice(0, 2).map((r) => r.index),
  '…les mêmes départs, dans le même ordre');
eq(calc.retained.map((r) => r.score), calc.ranking.slice(0, 2).map((r) => r.score),
  '…avec les mêmes scores (le tableau et les modèles ne peuvent pas diverger)');
ok(calc.ranking[0].violations === 0 && calc.ranking[0].rmsd <= STRUCTURE_CALC_RESTRAINT_TOLERANCE,
  `⚠ le meilleur modèle RESPECTE la contrainte (écart rms ${calc.ranking[0].rmsd.toFixed(4)} Å)`);
ok(calc.family.restraints[0].satisfied >= 1,
  '…et la famille le dit : la distance demandée est tenue par les modèles retenus');
ok(Array.isArray(calc.retained[0].positions) && calc.retained[0].positions.length === 18,
  'une structure retenue PORTE ses coordonnées (trois nombres par atome) — c’est ce que le panneau écrit');
eq(new Set(calc.attempts.map((a) => a.seed)).size, 4,
  '⚠ les quatre départs ont QUATRE graines différentes (le pas doré)');
for (let a = 1; a < calc.attempts.length; a += 1) {
  ok(maxDiff(calc.attempts[a].positions, calc.attempts[0].positions) > 0.5,
    `…donc deux départs ne sont JAMAIS la même molécule (écart maximal ${maxDiff(calc.attempts[a].positions, calc.attempts[0].positions).toFixed(2)} Å)`);
}
for (const a of calc.attempts) {
  eq(a.draw.turned, chans.count, `le départ ${a.index} a bien tourné ses ${chans.count} dièdres`);
  eq(a.channels.length, chans.count, '…et le rapport porte la valeur RELUE de chacun');
  eq(a.seed, (STRUCTURE_CALC_SEED + STRUCTURE_CALC_SEED_STEP * a.index) % 4294967296,
    `…la graine du départ ${a.index} est la graine de base avancée de ${a.index} pas dorés (et ramenée sur 32 bits)`);
}

/* LE MÊME APPEL REDONNE LE MÊME RÉSULTAT — au chiffre près. */
const calcAgain = structureCalculationOf(spec);
eq(calcAgain.ranking.map((r) => r.score), calc.ranking.map((r) => r.score),
  '⚠ deux fois le même calcul : les mêmes scores, au chiffre près');
eq(calcAgain.retained[0].positions, calc.retained[0].positions,
  '…et le meilleur modèle est le MÊME, coordonnée par coordonnée (aucun aléatoire caché)');
eq(calcAgain.ranking.map((r) => [r.index, r.violations, r.moved]),
  calc.ranking.map((r) => [r.index, r.violations, r.moved]),
  '…le même classement, les mêmes écarts, les mêmes atomes déplacés');
const calcOtherSeed = structureCalculationOf({ ...spec, seed: STRUCTURE_CALC_SEED + 987654 });
eq(calcOtherSeed.tried, 4, 'une autre graine change les DÉPARTS, pas la machine');
ok(calcOtherSeed.ranking.map((r) => r.score).join('|') !== calc.ranking.map((r) => r.score).join('|'),
  '…les quatre modèles sont donc différents (le tirage a bougé)');

/* LES BORNES MORDENT, ET LES REFUS SONT DITS. */
const clamped = structureCalculationOf({ ...spec, starts: 200, keep: 99, indices: [0] });
eq([clamped.starts, clamped.tried, clamped.keep], [STRUCTURE_CALC_MAX_STARTS, 1, STRUCTURE_CALC_MAX_KEEP],
  '⚠ n est plafonné à 64 et m à 12 (une TRANCHE ne calcule que ce qu’on lui demande)');
eq(structureCalculationOf({ ...spec, starts: 3, keep: 99 }).retained.length, 3,
  '…et demander plus de structures qu’il n’y en a en retient 3, pas douze');
eq(structureCalculationOf({ ...spec, starts: 4, keep: 0 }).retained.length, 0,
  'm = 0 est obéi (aucune structure gardée) — le panneau lui-même n’en propose pas');
eq(structureCalculationOf({ restraints: [{ i: 0, j: 5, target: 3.9 }] }).reason, 'bad-points',
  'sans coordonnées lisibles, le calcul est refusé');
eq(structureCalculationOf({ ...spec, restraints: [] }).reason, 'no-restraint',
  '⚠ SANS AUCUNE DISTANCE DEMANDÉE, il n’y a rien à respecter : le calcul est refusé (le panneau le dit avant de lancer)');
eq(structureCalculationOf({ ...spec, starts: 0 }).reason, 'no-start',
  '…et n = 0 aussi (aucun départ à construire)');
const sliced = structureCalculationOf({ ...spec, indices: [3, 1, 3] });
eq(sliced.indices, [1, 3], 'une TRANCHE trie ses indices et ne calcule pas deux fois le même départ');
eq(sliced.tried, 2, '…elle ne calcule que ceux-là');
eq(sliced.ranking.map((r) => [r.index, r.score]),
  calc.ranking.filter((r) => r.index === 1 || r.index === 3)
    .sort((a, b) => (a.score - b.score)).map((r) => [r.index, r.score]),
  '⚠ …et un départ calculé seul donne EXACTEMENT le même modèle que dans le calcul entier');
let stopCalls = 0;
const stopped = structureCalculationOf({
  ...spec, starts: 6, shouldStop: () => (stopCalls += 1) > 2,
});
eq([stopped.stopped, stopped.tried, stopped.reason], [true, 2, 'stopped'],
  'le bouton ⏹ arrête le calcul entre deux départs, et ce qui est fait est gardé');
const seen = [];
const watched = structureCalculationOf({
  ...spec, onAttempt: (a, info) => seen.push([a.index, info.index, info.of]),
});
eq(seen, [[0, 0, 4], [1, 1, 4], [2, 2, 4], [3, 3, 4]],
  'le panneau est prévenu de CHAQUE départ, dans l’ordre (c’est ce qui fait avancer la progression)');
eq(watched.tried, 4, '…et le calcul va au bout');
const withDropped = structureCalculationOf({
  ...spec, restraints: [{ i: 0, j: 5, target: 3.9 }, [0, 5, 3.2], [1, 1, 4]],
});
eq([withDropped.restraintCount, withDropped.dropped], [1, 2],
  '⚠ la liste des contraintes passe par la MÊME normalisation : ce qui est écarté est compté, jamais tu');

/* LA FAMILLE — ce que chaque distance mesure dans les modèles gardés, et leur
   dispersion (RMSD deux à deux APRÈS superposition optimale). */
eq(calc.family.count, 2, 'la famille, ce sont les m structures retenues');
eq(calc.family.restraints.length, 1, '…une ligne par distance demandée');
eq(calc.family.restraints[0].models, 2, '…et elle est relue sur les deux modèles');
eq(calc.family.restraints[0].satisfied, 2, '…les deux la respectent (le tableau du panneau le dit)');
near(calc.family.restraints[0].target, 3.9, '…à la distance demandée, telle quelle', 1e-12);
ok(calc.family.restraints[0].min <= calc.family.restraints[0].mean
  && calc.family.restraints[0].mean <= calc.family.restraints[0].max,
  '…avec le plus petit, la moyenne et le plus grand dans l’ordre');
near(calc.family.restraints[0].spread,
  calc.family.restraints[0].max - calc.family.restraints[0].min,
  '…et l’écart de la famille est exactement le plus grand moins le plus petit', 1e-12);
eq(calc.family.spread.models, 2, 'la dispersion porte sur les deux modèles');
eq(calc.family.spread.atoms, 6, '…sur les six atomes, tous pris (aucune sélection cachée)');
eq(calc.family.spread.count, 1, '…soit un couple à comparer');
eq(calc.family.spread.pairs.map((p) => [p.a, p.b]), [[1, 2]], '…les rangs 1 et 2, nommés');
ok(calc.family.spread.mean >= 0 && calc.family.spread.min <= calc.family.spread.mean
  && calc.family.spread.mean <= calc.family.spread.max,
  '…avec une moyenne entre le minimum et le maximum');
eq(calc.family.spread.worst, calc.family.spread.pairs[0],
  '…et le couple le plus divergent est nommé (ici le seul)');
eq(calc.family.rest.map((r) => r.rank), [3, 4],
  '⚠ les structures NON retenues sont listées avec leur rang et leur score (le panneau peut les nommer)');
eq(structureCalculationOf({ ...spec, starts: 2, keep: 2 }).family.rest, [],
  '…et quand m = n, rien n’est laissé de côté');
eq(structureCalculationOf({ ...spec, starts: 3, keep: 1 }).family.rest.map((r) => r.rank), [2, 3],
  '…une famille de trois dont une seule est gardée en laisse deux dehors');

/* LA DISPERSION EST UNE VRAIE SUPERPOSITION — deux copies d’un même modèle à une
   rotation et une translation près ont une dispersion NULLE. Sans le solveur, le
   chiffre serait de l’ordre de l’ångström. */
const cs = Math.cos(0.7); const sn = Math.sin(0.7);
const moved = hexane.positions.map((v, k) => {
  const i = Math.floor(k / 3);
  const ax = hexane.positions[i * 3]; const ay = hexane.positions[i * 3 + 1];
  const az = hexane.positions[i * 3 + 2];
  if (k % 3 === 0) return ax * cs - ay * sn + 5;
  if (k % 3 === 1) return ax * sn + ay * cs - 3;
  return az + 2;
});
const rigid = familySpreadOf({ attempts: [{ positions: hexane.positions, rank: 1 }, { positions: moved, rank: 2 }] });
near(rigid.pairs[0].rmsd, 0,
  '⚠ la dispersion d’un modèle et de sa copie TOURNÉE et TRANSLATÉE est nulle : la superposition est réelle', 1e-9);
ok(familySpreadOf({ attempts: [{ positions: hexane.positions, rank: 1 }] }).models === 1
  && familySpreadOf({ attempts: [{ positions: hexane.positions, rank: 1 }] }).pairs.length === 0,
  'un seul modèle : rien à comparer, et le rapport rend une liste vide plutôt qu’un chiffre inventé');
eq(familySpreadOf({ attempts: [] }).mean, 0, '…et une famille vide ne divise pas par zéro');
eq(familyRestraintsOf({ attempts: [] }), [], 'sans modèle, aucune ligne de contrainte');

/* ── 5bis · LE CAS QUI COMPTE — UNE CHAÎNE QU'UNE CONTRAINTE DOIT REPLIER ──────
   Vingt carbones que 4.00 Å entre les deux bouts oblige à se replier : c'est LE cas où
   une méthode qui ne surveille pas ses contacts laisse deux atomes l'un sur l'autre
   (« in the calculation you did not consider steric clashes along atoms »). Le module
   garde le cœur dur dans la descente ET dans la note — la sonde mesure les deux. */
const longChain = chainOf(20);
const folded = structureCalculationOf({
  positions: longChain.positions, elements: longChain.elements, bonds: longChain.bonds,
  restraints: [{ i: 0, j: 19, target: 4.0 }], starts: 4, keep: 3, anneal: 2, md: 40, minimise: 2,
});
eq(folded.tried, 4, 'quatre départs');
ok(folded.ranking.filter((r) => r.violations === 0).length >= 2,
  `⚠ au moins deux départs respectent la distance demandée (${folded.ranking.filter((r) => r.violations === 0).length} sur 4)`);
ok(folded.ranking.every((r) => r.clashes === 0),
  '⚠ AUCUN modèle rendu n’a deux atomes l’un sur l’autre (ni sous 1.45 Å, ni à 0.6 × les rayons de Bondi)');
ok(folded.ranking.every((r) => r.bond < 0.75),
  '…et les liaisons tiennent : un pas de torsion ne peut pas les changer, donc leur énergie reste nulle (un demi kcal/mol d’ordre de grandeur)');
ok(folded.ranking.every((r) => Number.isInteger(r.nonbonded.repulsive) && r.nonbonded.count > 0),
  '…et le rapport DIT combien de couples non liés entrent dans la portée, et combien sont répulsifs');
near(folded.retained[0].restraint.worst.distance, 4.0,
  '…le meilleur modèle finit à sa cible', STRUCTURE_CALC_RESTRAINT_TOLERANCE + 0.15);
eq(folded.family.restraints[0].models, 3, 'les trois retenues sont relues');
ok(folded.family.spread.mean > 0,
  '⚠ et elles ne sont PAS la même molécule : la dispersion de la famille est non nulle (c’est ce qu’une famille est)');
const reScored = scoreStructureOf({
  positions: folded.retained[0].positions, elements: longChain.elements, bonds: longChain.bonds,
  restraints: [{ i: 0, j: 19, target: 4.0 }],
});
near(reScored.score, folded.retained[0].score,
  '⚠ relire la note du modèle RETENU redonne exactement le score qui l’a classé', 1e-9);
eq([reScored.clashes.count, reScored.contacts.count], [0, 0],
  '…et cette relecture confirme : aucun empilement, ni sous 1.45 Å ni dans le cœur dur');

/* ── 5ter · LE RECUIT ET LE TERME ω — LA PHYSIQUE AJOUTÉE, EXÉCUTÉE ──────────
   Le recuit est en espace DIHÉDRAL : chaque pas est une rotation rigide d'un côté
   autour de sa charnière, donc les longueurs et les angles ne peuvent pas bouger.
   La sonde mesure les trois choses qu'un recuit doit prouver : il tourne, il
   AMÉLIORE (son coût baisse), et il est DÉTERMINISTE. */
const anChain = chainOf(24);
const anTarget = [{ i: 0, j: 23, target: 6.0 }];
const noAnneal = structureAttemptOf({
  positions: anChain.positions, elements: anChain.elements, bonds: anChain.bonds,
  restraints: anTarget, index: 0, anneal: 0,
});
eq(noAnneal.anneal, null, '`anneal: 0` enlève le recuit : c’est le départ tiré tel quel');
/* ⚠ LA PRÉCISION D'UNE DISTANCE TENUE EST CELLE DU PALIER — « ± 0.25 Å » est une phrase
   du FROID. Le moteur est un Langevin VRAIMENT thermostaté depuis la révision qui a suivi
   la remarque « the MD looks more like a minimisation… at a certain temperature the
   movement should be continuous » : la vitesse d'un canal à 1500 K vaut √(R·T/m) = 34.5 °/ps
   au lieu de 1.7 °/ps, donc l'équilibration EXPLORE au lieu de descendre, et une distance
   tenue par un puits de 20 kcal/mol/Å² fluctue de √(R·T/k) = 0.39 Å à 1500 K — PLUS que la
   tolérance. La sonde de cette session l'a mesuré (chaîne de 24, cible 6.0 Å) : la distance
   part de 20.5 Å, elle est TENUE (5.7–6.3 Å, elle oscille autour de la cible) et c'est le
   bout FROID du protocole qui la pose. `minimise` est donc le nombre de balayages du
   PANNEAU (`STRUCTURE_CALC_MIN_ROUNDS`), pas moins : le budget que l'application donne
   vraiment à sa finition. */
const withAnneal = structureAttemptOf({
  positions: anChain.positions, elements: anChain.elements, bonds: anChain.bonds,
  restraints: anTarget, index: 0, md: 20, minimise: STRUCTURE_CALC_MIN_ROUNDS,
});
ok(withAnneal.anneal && withAnneal.anneal.steps === STRUCTURE_CALC_ANNEAL_STEPS,
  `le recuit tourne ses ${STRUCTURE_CALC_ANNEAL_STEPS} paliers de température`);
eq(withAnneal.anneal.schedule.length, STRUCTURE_CALC_ANNEAL_STEPS, '…et il les RACONTE un par un');
ok(withAnneal.anneal.schedule[0].temperature > withAnneal.anneal.schedule[STRUCTURE_CALC_ANNEAL_STEPS - 1].temperature,
  '⚠ la température DÉCROÎT (chaud d’abord : les conformations s’échangent ; froid à la fin : c’est un minimum local)');
ok(withAnneal.anneal.tried > 0 && withAnneal.anneal.accepted > 0,
  `…${withAnneal.anneal.accepted} pas acceptés sur ${withAnneal.anneal.tried} essayés`);
ok(withAnneal.anneal.after < withAnneal.anneal.before,
  `⚠ …et le coût BAISSE : ${withAnneal.anneal.before.toFixed(2)} → ${withAnneal.anneal.after.toFixed(2)}`
  + ' (Metropolis ne garde que ce qui passe la barrière exp(−Δ/T))');
ok(withAnneal.quench && withAnneal.quench.steps === STRUCTURE_CALC_QUENCH_STEPS,
  'la TREMPE suit le protocole : un dernier recuit froid, sous longe');
eq(withAnneal.restraint.violations, 0, '…et la distance demandée est bien respectée à l’arrivée');
/* ⚠ …ET LA PRÉCISION EST CELLE DU PALIER, pas celle de la tolérance : la sonde de cette
   session mesure l’écart final, et il vaut ~0.15 Å ici (√(R·T/k) = 0.39 Å à 1500 K). Une
   distance TENUE oscille autour de sa cible — c’est ce qu’un moteur thermostaté fait, et
   c’est exactement ce que la remarque demandait (« the movement should be continuous »). */
const anGap0 = () => Math.hypot(
  at3(withAnneal.positions, 0)[0] - at3(withAnneal.positions, 23)[0],
  at3(withAnneal.positions, 0)[1] - at3(withAnneal.positions, 23)[1],
  at3(withAnneal.positions, 0)[2] - at3(withAnneal.positions, 23)[2],
);
ok(Math.abs(anGap0() - 6) < 0.4,
  `…dans la précision THERMIQUE du palier (√(R·T/k) ≈ 0.39 Å à 1500 K) : écart ${Math.abs(anGap0() - 6).toFixed(3)} Å`);
ok(withAnneal.bond < 1 && withAnneal.angle < 6,
  '⚠ les liaisons et les angles sont INTACTS : un pas de recuit est une rotation rigide, pas un déplacement d’atome');
const anAgain = structureAttemptOf({
  positions: anChain.positions, elements: anChain.elements, bonds: anChain.bonds,
  restraints: anTarget, index: 0, md: 20, minimise: STRUCTURE_CALC_MIN_ROUNDS,
});
eq(Array.from(anAgain.positions), Array.from(withAnneal.positions),
  '⚠ deux appels rendent les MÊMES coordonnées, au chiffre près : le recuit est déterministe (graine fixe)');
const anCalc = structureCalculationOf({
  positions: anChain.positions, elements: anChain.elements, bonds: anChain.bonds,
  restraints: anTarget, starts: 4, keep: 2, anneal: 6, md: 150, minimise: 2,
});
ok(anCalc.ranking.filter((r) => r.violations === 0).length >= 1,
  `⚠ au moins un départ va au bout de la distance (${anCalc.ranking.filter((r) => r.violations === 0).length} sur 4 : le protocole standard ne CONDUIT plus les distances, il les laisse au champ, et le budget de la sonde est court)`);
ok(anCalc.ranking.every((r) => r.bond < 1),
  '…sans qu’aucun n’ait cassé sa chimie');
const anMod = annealTorsionsOf({
  positions: anChain.positions, elements: anChain.elements, bonds: anChain.bonds,
  restraints: anTarget, seed: 7, steps: 2,
});
ok(anMod.ok && anMod.channels > 0 && anMod.tried > 0,
  `le recuit s’appelle seul (${anMod.channels} canaux, ${anMod.tried} pas essayés)`);
eq(anMod.schedule.length, 2, '…et deux paliers demandés font deux paliers');
eq(annealTorsionsOf({}).ok, false, 'sans coordonnées lisibles, le recuit est refusé d’emblée');
eq(annealTorsionsOf({ positions: anChain.positions, elements: anChain.elements, bonds: anChain.bonds, channels: [], steps: 3 }).reason,
  'no-channel', '⚠ sans canal rotatable, le recuit le DIT au lieu de tourner à vide');

/* ── 5quater · LE TERME ω — UNE LIAISON PEPTIDIQUE PRÉFÈRE TRANS ──────────────
   Le module disait avant : « le ⚒ n'a aucune cible d'ω ». Il en a une maintenant, et
   elle se mesure sur un dipeptide : le carbonyle C=O sur un N suffit à reconnaître la
   liaison (aucun nom d'atome lu), le plateau de ± 30° ne coûte rien, et le recuit
   ramène vers 180° ce qu'un tirage a mis en cis — sans lâcher une distance tenue. */
const pepPts = [[0, 0, 0], [1.45, 0, 0]];
pepPts.push(placeWith({ a: [0, 1, 0], b: pepPts[0], c: pepPts[1], length: 1.52, angleDeg: 111, dihDeg: 120 }));
pepPts.push(placeWith({ a: pepPts[0], b: pepPts[1], c: pepPts[2], length: 1.23, angleDeg: 120.5, dihDeg: 180 }));
pepPts.push(placeWith({ a: pepPts[0], b: pepPts[1], c: pepPts[2], length: 1.33, angleDeg: 116, dihDeg: 180 }));
pepPts.push(placeWith({ a: pepPts[1], b: pepPts[2], c: pepPts[4], length: 1.46, angleDeg: 121, dihDeg: 180 }));
pepPts.push(placeWith({ a: pepPts[2], b: pepPts[4], c: pepPts[5], length: 1.52, angleDeg: 111, dihDeg: -60 }));
pepPts.push(placeWith({ a: pepPts[4], b: pepPts[5], c: pepPts[6], length: 1.23, angleDeg: 120.5, dihDeg: -45 }));
const pep = {
  positions: pepPts.flat(),
  elements: ['N', 'C', 'C', 'O', 'N', 'C', 'C', 'O'],
  bonds: [
    { i: 0, j: 1, order: 1 }, { i: 1, j: 2, order: 1 }, { i: 2, j: 3, order: 2 },
    { i: 2, j: 4, order: 1 }, { i: 4, j: 5, order: 1 }, { i: 5, j: 6, order: 1 },
    { i: 6, j: 7, order: 2 },
  ],
};
const pepOmega = peptideOmegasOf({ elements: pep.elements, bonds: pep.bonds, atomCount: 8 });
eq(pepOmega.length, 1, '⚠ la liaison peptidique est reconnue par la CHIMIE seule (un carbonyle sur un N)');
eq(pepOmega[0].probeAtoms, [1, 2, 4, 5], '…et son dièdre est le dièdre IUPAC CA–C–N–CA');
eq(pepOmega[0].target, STRUCTURE_CALC_OMEGA, '…visé TRANS, la seule conformation observée');
eq(peptideOmegasOf({ elements: anChain.elements, bonds: anChain.bonds, atomCount: 24 }).length, 0,
  '…une chaîne d’alcanes n’a aucun ω (aucune cible inventée là où il n’y a pas de peptide)');
eq(omegaPenaltyOf({ positions: pep.positions, omegas: pepOmega }).penalty, 0,
  'un ω plan et trans ne coûte RIEN : le plateau de ± 30° est le désordre d’une vraie chaîne');
const pepOmegaBad = omegaPenaltyOf({
  positions: pep.positions,
  omegas: [{ ...pepOmega[0], probeAtoms: [3, 2, 4, 5] }],
});
ok(pepOmegaBad.penalty > 0 && pepOmegaBad.violations === 1,
  `⚠ un O=C–N–CA ramené autour de 0° (le cis) COÛTE : ${pepOmegaBad.penalty.toFixed(1)}`);
const pepRestraint = { i: 3, j: 5, target: 4.0 };
const pepDrawn = structureAttemptOf({
  positions: pep.positions, elements: pep.elements, bonds: pep.bonds,
  restraints: [pepRestraint], index: 0, anneal: 0, md: 0, minimise: 0, quench: false,
});
const pepAnneal = structureAttemptOf({
  positions: pep.positions, elements: pep.elements, bonds: pep.bonds,
  restraints: [pepRestraint], index: 0, md: 20, minimise: 1,
});
eq(pepDrawn.omega.count, 1, 'un départ tiré relit son ω (le module DIT ce que le tirage a fait)');
ok(pepDrawn.omega.count === 1 && Number.isFinite(pepDrawn.omega.worst.dev),
  `le départ tiré relit son ω (écart ${pepDrawn.omega.worst.dev.toFixed(1)}° à 180° : le module DIT ce que le tirage a fait)`);
ok(pepAnneal.omega.worst.dev <= STRUCTURE_CALC_OMEGA_TOLERANCE + 1e-6,
  `⚠ …et le protocole le garde DANS SON PLATEAU : écart ${pepDrawn.omega.worst.dev.toFixed(1)}° au tirage →`
  + ` ${pepAnneal.omega.worst.dev.toFixed(1)}° après le protocole complet (tolérance ± ${STRUCTURE_CALC_OMEGA_TOLERANCE}° :`
  + ' un peptide reste TRANS ; les autres dièdres, eux, explorent librement)');
ok(pepAnneal.quench.omega.penalty <= pepAnneal.quench.omegaBefore + 1e-9,
  '⚠ et la TREMPE ne laisse jamais ω pire qu’elle ne l’a trouvé (à froid, seuls les pas qui améliorent sont gardés)');
near(scoreStructureOf({
  positions: pep.positions, elements: pep.elements, bonds: pep.bonds, restraints: [],
}).omegaPenalty, 0, 'la note d’un modèle trans ne porte aucune pénalité ω', 1e-12);
const pepScored = scoreStructureOf({
  positions: pep.positions, elements: pep.elements, bonds: pep.bonds, restraints: [],
});
near(pepScored.score, pepScored.freeEnergy,
  '⚠ le SCORE d’un modèle reste lisible : la FREE ENERGY du champ (enthalpie + entropie), jamais autre chose', 1e-9);
near(pepScored.freeEnergy, pepScored.enthalpy + pepScored.entropy,
  '⚠ …et elle se relit : enthalpie + (−T·S), les deux nommées', 1e-6);
near(pepScored.total,
  pepScored.bond + pepScored.angle + pepScored.planar + pepScored.vdw + pepScored.elec
  + pepScored.solv + pepScored.ramaPenalty + pepScored.chiPenalty + pepScored.omegaPenalty
  + pepScored.restraintEnergy,
  '⚠ …le champ ENTIER se lit famille par famille (liaisons, angles, cycles, van der Waals, électrostatique, solvant, φ/ψ, χ1, ω, vos distances), EN kcal/mol', 1e-6);
has(MODULE, 'export const annealTorsionsOf', 'le recuit est exporté par le module');
has(MODULE, 'export const peptideOmegasOf', '…et la lecture des liaisons peptidiques aussi');
has(MODULE, 'export const omegaPenaltyOf', '…et le terme ω');
has(MODULE, 'const walls = [];',
  '⚠ …avec la LONGE du moteur (les distances DÉJÀ tenues ne sont jamais lâchées) : le recuit refuse un pas qui les casse, la dynamique les met dans un MUR');
has(MODULE, 'omegaCrossCost',
  '⚠ …et le recuit lit à part ce qu’un pas fait au SEUL ω (la protection : un peptide reste trans)');
/* LE RECUIT MONTRE SES PAS — par les IMAGES qu'il rend (`yield`), et c'est un seul et même
   moteur que le conducteur synchrone conduit jusqu'au bout. */
has(MODULE, "phase: 'anneal', positions: engine.heavyPositions(), step: s + 1, of: nStep",
  '⚠ le recuit rend une image PAR PALIER et `perFrame` pas à l’intérieur (le panneau voit la molécule se replier)');
has(MODULE, "yield* step('draw', x, { channels:",
  '⚠ …et le départ TIRÉ est montré AVANT le recuit');
has(MODULE, 'const engine = torsionEngineOf({',
  '⚠ le moteur du champ a sa portée (la grille des couples non liés, refaite régulièrement)');
has(MODULE, 'const frameEvery = Math.max(1, Math.floor(perStep / framesPerPalier));',
  '⚠ `perFrame` = le nombre d’IMAGES PAR PALIER (0 = une seule) : le pas d’image est déduit des gestes du palier');

/* ── 5quinquies · LE SQUELETTE, LES BASSINS φ/ψ ET χ1 — LA PHYSIQUE QUI MANQUAIT ──
   « the final structures have very bad Ramachandran plots » : la sonde construit un
   TRIPEPTIDE dont chaque dièdre est posé par `placeWith` (donc relu par le lecteur du
   dossier, sans convention devinée), et vérifie les trois choses qui font qu'un
   Ramachandran tient : les dièdres du squelette sont TROUVÉS par la chimie seule, un
   résidu placé DANS un bassin ne coûte rien, et le même résidu hors bassin COÛTE. */
const triOf = ({ psiA = -45, phiB = -60, psiB = -45, phiC = -60 }) => {
  /* N0 – CA1 – C2(=O3) – N4 – CA5 – C6(=O7) – N8 – CA9 – C10(=O11) : un tripeptide
     construit atome par atome. ⚠ `placeWith` accroche le NOUVEL atome à son TROISIÈME
     point (`c`) : l'oxygène d'un carbonyle s'accroche donc au CARBONE, et il se pose
     ANTI au prochain azote (dihèdre + 180°) — c'est ce qui donne un carbonyle plan et
     un O=C–N de 121°. Un oxygène éclipsé sur l'azote (0,2 Å) ne serait pas une molécule. */
  const n0 = [0, 0, 0];
  const ca1 = [1.45, 0, 0];
  const c2 = placeWith({ a: [0, 1, 0], b: n0, c: ca1, length: 1.53, angleDeg: 110, dihDeg: psiA });
  const n4 = placeWith({ a: n0, b: ca1, c: c2, length: 1.33, angleDeg: 116, dihDeg: psiA });
  const o3 = placeWith({ a: n0, b: ca1, c: c2, length: 1.23, angleDeg: 120.5, dihDeg: psiA + 180 });
  const ca5 = placeWith({ a: ca1, b: c2, c: n4, length: 1.46, angleDeg: 121, dihDeg: 180 });
  const c6 = placeWith({ a: c2, b: n4, c: ca5, length: 1.53, angleDeg: 111, dihDeg: phiB });
  const n8 = placeWith({ a: n4, b: ca5, c: c6, length: 1.33, angleDeg: 116, dihDeg: psiB });
  const o7 = placeWith({ a: n4, b: ca5, c: c6, length: 1.23, angleDeg: 120.5, dihDeg: psiB + 180 });
  const ca9 = placeWith({ a: ca5, b: c6, c: n8, length: 1.46, angleDeg: 121, dihDeg: 180 });
  const c10 = placeWith({ a: c6, b: n8, c: ca9, length: 1.53, angleDeg: 111, dihDeg: phiC });
  const o11 = placeWith({ a: n8, b: ca9, c: c10, length: 1.23, angleDeg: 120.5, dihDeg: 180 });
  return {
    positions: [n0, ca1, c2, o3, n4, ca5, c6, o7, n8, ca9, c10, o11].flat(),
    elements: ['N', 'C', 'C', 'O', 'N', 'C', 'C', 'O', 'N', 'C', 'C', 'O'],
    bonds: [
      { i: 0, j: 1, order: 1 }, { i: 1, j: 2, order: 1 }, { i: 2, j: 3, order: 2 },
      { i: 2, j: 4, order: 1 }, { i: 4, j: 5, order: 1 }, { i: 5, j: 6, order: 1 },
      { i: 6, j: 7, order: 2 }, { i: 6, j: 8, order: 1 }, { i: 8, j: 9, order: 1 },
      { i: 9, j: 10, order: 1 }, { i: 10, j: 11, order: 2 },
    ],
  };
};
/* L'α PROPRE — ψ_B = −45°, φ_B = −60° : le résidu B tombe DANS le bassin α. */
const triAlpha = triOf({});
/* …et le MÊME tripeptide avec ψ_B = 0° : le couple (φ, ψ) de B sort du bassin. */
const triBad = triOf({ psiB: 0 });
const bbAlpha = backboneTorsionsOf({
  elements: triAlpha.elements, bonds: triAlpha.bonds, atomCount: 12,
});
eq([bbAlpha.residues, bbAlpha.phi.length, bbAlpha.psi.length, bbAlpha.omega.length],
  [3, 2, 2, 2],
  '⚠ le squelette est TROUVÉ par la chimie seule : trois résidus, deux φ, deux ψ, deux ω'
  + ' (les deux bouts n’ont qu’un angle — c’est `partial` qui le compte)');
eq(bbAlpha.partial, 2, '…et les deux résidus de bout sont comptés `partial`, jamais devinés');
eq(bbAlpha.phi[1].atoms, [6, 8, 9, 10],
  '⚠ le φ du résidu C est le dièdre IUPAC C(précédent)–N–CA–C, lu par la chimie');
eq(bbAlpha.psi[1].atoms, [4, 5, 6, 8], '…et le ψ du résidu B est N–CA–C–N(suivant)');
eq(bbAlpha.omega[1].atoms, [5, 6, 8, 9], '…et l’ω de la liaison peptidique est CA–C–N–CA');
eq(bbAlpha.chi.length, 0, 'aucune χ1 : ces trois résidus n’ont pas de CB (ce sont des glycines)');
eq(bbAlpha.classes.gly, 3, '…et la chimie les CLASSE glycines (aucun CB), comme le graphe 🪢');
/* LA SONDE EST UNE MOLÉCULE — deux atomes ne se superposent pas (sinon les longueurs,
   les angles et les dièdres mesurés ne voudraient plus rien dire). */
const closestPair = (g) => {
  let best = Infinity;
  for (let i = 0; i < 12; i += 1) {
    for (let j = i + 1; j < 12; j += 1) {
      const d = Math.hypot(
        g.positions[i * 3] - g.positions[j * 3],
        g.positions[i * 3 + 1] - g.positions[j * 3 + 1],
        g.positions[i * 3 + 2] - g.positions[j * 3 + 2],
      );
      if (d < best) best = d;
    }
  }
  return best;
};
ok(closestPair(triAlpha) > 1.2,
  `⚠ deux atomes du modèle ne se superposent pas (le plus proche couple est à ${closestPair(triAlpha).toFixed(2)} Å)`);
/* LE PONT AVEC LE DIÈDRE DU DOSSIER — le module ne mesure pas ses angles à sa façon. */
const pt3 = (i) => [triAlpha.positions[i * 3], triAlpha.positions[i * 3 + 1], triAlpha.positions[i * 3 + 2]];
const om0 = bbAlpha.omega[0];
near(omegaPenaltyOf({ positions: triAlpha.positions, omegas: [om0] }).list[0].deg,
  dihedralDeg(pt3(om0.probeAtoms[0]), pt3(om0.probeAtoms[1]), pt3(om0.probeAtoms[2]), pt3(om0.probeAtoms[3])),
  '⚠ l’ω du rapport est le dièdre du dossier, au chiffre près', 1e-9);

/* LES BASSINS — 0 dedans, la distance au bord dehors, et les classes comptent vraiment. */
eq([ramaGapOf(-60, -45), ramaGapOf(-120, 135)], [0, 0],
  '⚠ le centre du bassin α et celui du β ne coûtent RIEN (le bassin entier est un plateau)');
ok(ramaGapOf(0, 0) > 25,
  `…et un point qui n’est dans aucun bassin est LOIN du bord (${ramaGapOf(0, 0).toFixed(1)}°)`);
eq(ramaGapOf(NaN, 12), 0, 'un angle illisible ne coûte rien : le module n’invente pas un terme');
eq(ramaGapOf(100, 0, 'gly'), 0,
  '⚠ une GLYCINE a ses deux miroirs permis : son α gauche s’ouvre là où un résidu ordinaire est dehors');
ok(ramaGapOf(100, 0, 'general') > 0,
  '…et le MÊME point est hors bassin pour la classe générale — les jeux de bassins diffèrent vraiment');
/* LE TERME, EXÉCUTÉ — posé dans l'α, il ne coûte rien ; le même sorti, il coûte. */
const ramaAlpha = ramaPenaltyOf({ positions: triAlpha.positions, torsions: bbAlpha });
eq([ramaAlpha.measured, ramaAlpha.violations, ramaAlpha.penalty], [1, 0, 0],
  '⚠ le résidu placé dans l’α ne coûte RIEN (et un seul résidu a ses DEUX angles : les bouts n’en ont qu’un)');
eq(ramaAlpha.partial, 2, '…et les deux bouts sont comptés à part, sans terme inventé');
const bbBad = backboneTorsionsOf({ elements: triBad.elements, bonds: triBad.bonds, atomCount: 12 });
const ramaBad = ramaPenaltyOf({ positions: triBad.positions, torsions: bbBad });
ok(ramaBad.penalty > 0 && ramaBad.violations === 1,
  `⚠ le même résidu avec ψ = 0° est HORS bassin et COÛTE (${ramaBad.penalty.toFixed(2)},`
  + ` à ${ramaBad.worst.gap.toFixed(1)}° du bord, région « ${ramaBad.worst.region} »)`);
near(ramaBad.penalty, ffRamaCostOf(ramaBad.worst.gap, STRUCTURE_CALC_RAMA_WEIGHT),
  '…et le coût est bien le potentiel statistique du champ — k·(écart/100°)², k = 20 kcal/mol', 1e-9);
eq([ramaPenaltyOf({ positions: null }).penalty, ramaPenaltyOf({}).penalty], [0, 0],
  'sans coordonnées lisibles le terme vaut zéro — il ne lève rien et n’invente rien');

/* χ1 — TROIS PUITS DÉCALÉS, ET RIEN ENTRE EUX. Un CB et un CG sont ajoutés au
   tripeptide, et χ1 est posé par `placeWith` : 180° (un conformère) puis 0° (entre deux). */
const triChi = (chiDeg) => {
  const base = triOf({});
  const pts = [];
  for (let i = 0; i < base.positions.length; i += 3) pts.push(base.positions.slice(i, i + 3));
  /* LE CB S'ACCROCHE AU CA5 (le troisième point de `placeWith`), puis le CG au CB : le
     dièdre NOUVEAU est donc bien χ1 = N4–CA5–CB–CG. */
  const cb = placeWith({ a: pts[4], b: pts[6], c: pts[5], length: 1.53, angleDeg: 110, dihDeg: 122 });
  pts.push(cb);
  const cg = placeWith({ a: pts[4], b: pts[5], c: cb, length: 1.53, angleDeg: 113, dihDeg: chiDeg });
  pts.push(cg);
  return {
    positions: pts.flat(),
    elements: [...base.elements, 'C', 'C'],
    bonds: [...base.bonds, { i: 5, j: 12, order: 1 }, { i: 12, j: 13, order: 1 }],
  };
};
const chiWell = triChi(180);
const chiMid = triChi(0);
const bbChi = backboneTorsionsOf({ elements: chiWell.elements, bonds: chiWell.bonds, atomCount: 14 });
eq(bbChi.chi.length, 1, '⚠ χ1 est trouvé sur le résidu qui a un CB (N–CA–CB–X, X = le plus lourd)');
eq(bbChi.chi[0].atoms, [4, 5, 12, 13], '…et son quadruplet est bien N–CA–CB–CG');
eq(bbChi.classes.gly, 2, '…et le résidu qui a un CB n’est plus une glycine (deux sur trois)');
const chiRead = chiPenaltyOf({ positions: chiWell.positions, chis: bbChi.chi });
eq([chiRead.measured, chiRead.violations], [1, 0],
  'un χ1 PILE sur un conformère décalé (180°) ne coûte rien, et n’est pas compté hors puits');
near(chiRead.penalty, 0, '…son coût est exactement zéro', 1e-12);
const bbChiMid = backboneTorsionsOf({ elements: chiMid.elements, bonds: chiMid.bonds, atomCount: 14 });
const chiReadMid = chiPenaltyOf({ positions: chiMid.positions, chis: bbChiMid.chi });
ok(chiReadMid.penalty > chiRead.penalty && chiReadMid.violations === 1,
  `⚠ …et un χ1 à 0° est ENTRE deux puits : il coûte, et il est compté (${chiReadMid.penalty.toFixed(3)},`
  + ` écart ${chiReadMid.worst.dev.toFixed(1)}° au puits le plus proche)`);
ok(chiReadMid.penalty <= STRUCTURE_CALC_CHI_WEIGHT + 1e-9,
  '…sans jamais dépasser le poids du module (la barrière à trois puits est BORNÉE)');

/* ── 5sexies · LE CHAMP DE FORCES, LA DYNAMIQUE ET LA MINIMISATION — EXÉCUTÉS ────
   Le champ est UNE fonction (`forceFieldEnergyOf`) dont on lit les familles ; la
   dynamique et la minimisation sont le même mouvement rigidement dihédral, conduits par
   des générateurs. Ce paragraphe mesure ce qu'on leur demande : le champ SOMME ses
   familles, il se DÉCRIT en lignes que le panneau recopie, la dynamique RÉPOND à la
   température, la minimisation ne remonte JAMAIS, et la LONGE tient les distances déjà
   tenues même chaud. */
const fieldAlpha = forceFieldEnergyOf({
  positions: triAlpha.positions, elements: triAlpha.elements, bonds: triAlpha.bonds, restraints: [],
});
ok(fieldAlpha.ok, 'le champ de forces se lit sur le tripeptide');
near(fieldAlpha.total,
  fieldAlpha.bond + fieldAlpha.angle + fieldAlpha.planar + fieldAlpha.vdw + fieldAlpha.elec
  + fieldAlpha.solv + fieldAlpha.rama + fieldAlpha.chi + fieldAlpha.omega + fieldAlpha.restraint,
  '⚠ E = la SOMME de ses familles (liaisons, angles, cycles, van der Waals, électrostatique, solvant, φ/ψ, χ1, ω, vos distances), en kcal/mol', 1e-6);
eq(fieldAlpha.rows.length, FORCE_FIELD_FAMILIES.length,
  '…et il se décrit en AUTANT de lignes que de familles');
eq(fieldAlpha.rows.map((r) => r.id), FORCE_FIELD_FAMILIES,
  '⚠ les lignes portent les familles dans l’ordre : le panneau n’en invente aucune');
/* ⚠ LES POIDS VIENNENT DU MODULE, ET LA CLEF AUSSI : les lignes du champ portent `k`
   (l'unité dit laquelle — kcal·mol⁻¹·Å⁻² pour une longueur, kcal/mol pour un angle),
   et on les retrouve PAR LEUR IDENTIFIANT : l'ordre de la liste est celui du champ, il
   n'est pas recopié ici. */
eq(fieldAlpha.rows[0].k, FF_BOND_K, '…le poids des liaisons est celui du module (kcal·mol⁻¹·Å⁻²)');
eq(forceFieldRowsOf().find((r) => r.id === 'omega').k, STRUCTURE_CALC_OMEGA_WEIGHT,
  '…et celui d’ω est celui du module');
eq(forceFieldRowsOf().find((r) => r.id === 'rama').k, STRUCTURE_CALC_RAMA_WEIGHT,
  '…celui des bassins φ/ψ aussi');
eq(forceFieldRowsOf().find((r) => r.id === 'chi').k, STRUCTURE_CALC_CHI_WEIGHT,
  '…et celui de χ1 avec lui');
eq(forceFieldRowsOf().find((r) => r.id === 'restraint').k, STRUCTURE_CALC_LEASH_WALL,
  '⚠ …et vos distances portent le k du puits plat (le même que la longe des gestes ⚙)');
eq(fieldAlpha.rama, 0, 'le champ d’un modèle α ne porte AUCUN terme de bassin');
const fieldBad = forceFieldEnergyOf({
  positions: triBad.positions, elements: triBad.elements, bonds: triBad.bonds, restraints: [],
});
ok(fieldBad.rama > 0 && fieldBad.total > fieldAlpha.total,
  `⚠ …et le même modèle hors bassin coûte plus cher (φ/ψ ${fieldBad.rama.toFixed(2)} →`
  + ` E ${fieldBad.total.toFixed(2)} contre ${fieldAlpha.total.toFixed(2)})`);
const fieldChi = forceFieldEnergyOf({
  positions: chiMid.positions, elements: chiMid.elements, bonds: chiMid.bonds, restraints: [],
});
ok(fieldChi.chi > 0, `…et un χ1 entre deux puits entre dans le champ (${fieldChi.chi.toFixed(3)})`);
eq([fieldChi.torsions.chi.length, fieldChi.chiReport.count], [1, 1],
  '…le rapport du champ dit COMBIEN de χ1 ont été lus');
eq(forceFieldEnergyOf({ positions: null }).ok, false, 'sans coordonnées lisibles le champ est refusé');

/* LA DYNAMIQUE — elle tourne, elle est déterministe, et sa température CINÉTIQUE suit
   le thermostat : c'est ce qui la distingue d'un recuit déguisé. */
const mdSpec = {
  positions: triBad.positions, elements: triBad.elements, bonds: triBad.bonds,
  restraints: [], seed: 0xA11CE, steps: 60, perFrame: 12,
};
const mdHot = molecularDynamicsOf({ ...mdSpec, temperature: 6 });
const mdCold = molecularDynamicsOf({ ...mdSpec, temperature: 0.2 });
eq([mdHot.ok, mdHot.channels > 0, mdHot.steps, mdHot.applied > 0], [true, true, 60, true],
  '🌡 la dynamique tourne ses pas, sur les canaux rotatables de la molécule');
ok(mdHot.temperature.kinetic > mdCold.temperature.kinetic,
  `⚠ un thermostat à T = 6 donne une température cinétique PLUS HAUTE qu’à T = 0.2`
  + ` (${mdHot.temperature.kinetic.toFixed(2)} contre ${mdCold.temperature.kinetic.toFixed(2)})`);
eq(mdHot.trace.length, Math.floor(60 / 12),
  '…et elle rend une image tous les `perFrame` pas (la trajectoire se lit)');
eq(mdHot.temperature.mode, 'fixed', '…en disant que la température était TENUE (pas un plan)');
const mdAgain = molecularDynamicsOf({ ...mdSpec, temperature: 6 });
eq(Array.from(mdAgain.positions), Array.from(mdHot.positions),
  '⚠ la même graine donne EXACTEMENT la même trajectoire (aucun hasard caché)');
eq([molecularDynamicsOf({ positions: null }).ok,
  molecularDynamicsOf({ ...mdSpec, steps: 0 }).reason],
[false, 'no-step'], '…et ses deux refus sont DITS (coordonnées illisibles, aucun pas demandé)');
/* LA LONGE DE LA DYNAMIQUE — un MUR, pas un refus : même à haute température, une
   distance DÉJÀ tenue ne sort pas de sa tolérance. */
const leashChain = chainOf(12);
const leashProbe = (molecule) => Math.hypot(
  molecule.positions[0] - molecule.positions[33],
  molecule.positions[1] - molecule.positions[34],
  molecule.positions[2] - molecule.positions[35],
);
/* LA DISTANCE EST TENUE AU DÉPART — sa cible est celle qu'elle a MAINTENANT : c'est
   exactement ce que la longe du panneau fait (« les distances déjà tenues »). */
const leashTarget = { i: 0, j: 11, target: Number(leashProbe(leashChain).toFixed(4)) };
const leashRun = molecularDynamicsOf({
  positions: leashChain.positions, elements: leashChain.elements, bonds: leashChain.bonds,
  restraints: [leashTarget], leash: [leashTarget], seed: 7, steps: 80, temperature: 6,
});
eq([leashRun.ok, leashRun.walls.count, Number(leashRun.walls.before.toFixed(6))], [true, 1, 0],
  '⚠ la longe part d’une distance TENUE (le mur n’est qu’un puits autour d’elle, son coût est nul)');
ok(Math.abs(leashProbe(leashRun) - leashTarget.target) <= STRUCTURE_CALC_RESTRAINT_TOLERANCE,
  `…et après 80 pas à T = 6 elle la tient encore (${leashProbe(leashRun).toFixed(3)} Å`
  + ` pour ${leashTarget.target.toFixed(2)} demandés)`);

/* LA MINIMISATION — elle ne remonte JAMAIS (elle n'accepte que ce qui baisse). */
const minSpec = {
  positions: triBad.positions, elements: triBad.elements, bonds: triBad.bonds, restraints: [],
};
const minRun = minimizeTorsionsOf({ ...minSpec, rounds: 4 });
eq([minRun.ok, minRun.sweeps], [true, 4], '⚒ la minimisation balaie ses tours');
ok(minRun.cost.after <= minRun.cost.before + 1e-9,
  `⚠ elle ne peut pas remonter : ${minRun.cost.before.toFixed(3)} → ${minRun.cost.after.toFixed(3)}`);
ok(minRun.cost.after < minRun.cost.before,
  '…et sur ce modèle hors bassin elle DESCEND vraiment (un bassin est un puits)');
ok(minRun.awaited === undefined && minRun.accepted > 0, '…et elle dit combien de mouvements elle a gardés');
const minAgain = minimizeTorsionsOf({ ...minSpec, rounds: 4 });
eq(Array.from(minAgain.positions), Array.from(minRun.positions),
  '⚠ la même minimisation redonne les mêmes coordonnées, au chiffre près');
eq([minimizeTorsionsOf({ positions: null }).ok,
  minimizeTorsionsOf({ ...minSpec, rounds: 0 }).reason],
[false, 'no-step'], '…et sans coordonnées, ou sans tour demandé, elle le DIT');
const minFrames = [];
drainFrames(minimizeFrames({ ...minSpec, rounds: 2 }), (f) => minFrames.push(f));
eq([minFrames.length, minFrames[0].phase, minFrames[1].sweep], [2, 'minimise', 2],
  '…et elle rend une image PAR BALAYAGE (c’est ce qui se regarde à l’écran)');

/* ── 5septies · LES IMAGES — UN SEUL MOTEUR, DEUX CONDUCTEURS ──────────────────
   C'est ce qui répond à « I do not see the molecule changing structures during the
   calculation » : le protocole est un GÉNÉRATEUR, le module le conduit d'un trait
   (`drainFrames`), l'écran le conduit image par image en peignant entre deux. La sonde
   prouve que les DEUX chemins donnent le MÊME résultat, au bit près. */
const frameSpec = {
  positions: triBad.positions, elements: triBad.elements, bonds: triBad.bonds,
  restraints: [{ i: 3, j: 9, target: 4.0 }], index: 0, anneal: 2, annealPerFrame: 3,
  md: 12, mdPerFrame: 4, minimise: 1, seed: STRUCTURE_CALC_SEED,
};
const walked = [];
const viaFrames = drainFrames(structureAttemptFrames(frameSpec), (f) => walked.push(f));
const viaCall = structureAttemptOf(frameSpec);
eq(Array.from(viaFrames.positions), Array.from(viaCall.positions),
  '⚠ le générateur conduit par `drainFrames` et l’appel direct donnent les MÊMES coordonnées (au bit près)');
near(viaFrames.score, viaCall.score, '…et le même score', 1e-12);
const phases = [...new Set(walked.map((f) => f.phase))];
/* ⚠ LES SIX PHASES DU PROTOCOLE STANDARD, ET RIEN D'AUTRE — le tirage, le recuit, les
   DEUX phases de dynamique (équilibration puis refroidissement), la minimisation et la
   trempe. Le module ne CONDUIT plus aucune distance : « drive » et « scan » ont disparu
   avec le protocole du ⚒, et une image qui les annoncerait serait un mensonge. */
for (const phase of ['draw', 'anneal', 'md-equilibrate', 'md-cool', 'minimise', 'quench']) {
  ok(phases.includes(phase), `…et les images couvrent la phase « ${phase} » (le panneau la nomme)`);
}
ok(!phases.includes('drive') && !phases.includes('scan') && !phases.includes('prep'),
  '⚠ …et AUCUNE image n’annonce le protocole du ⚒ (conduire une distance n’existe plus)');
ok(walked.every((f) => f.index === 0), '…chaque image dit de quel départ elle vient');
ok(walked.filter((f) => f.phase === 'anneal').length === 2 * 3,
  '⚠ le recuit rend EXACTEMENT « images par palier » images par palier (le réglage du panneau :'
  + ' 3 en cours de palier + celle de chaque palier) — et il les DOIT, gardé ou non, sinon le'
  + ` réglage ne compte que ce que le hasard accepte — ${walked.filter((f) => f.phase === 'anneal').length} images pour 2 paliers`);
ok(walked.filter((f) => f.phase === 'md-equilibrate').length + walked.filter((f) => f.phase === 'md-cool').length
  === Math.floor(4 / 4) + Math.floor(8 / 4),
  '…et la dynamique en rend une tous les 4 pas, dans ses deux phases (4 pas d’équilibration, 8 de refroidissement)');
const anFrames = [];
const anViaFrames = drainFrames(
  annealFrames({
    positions: triBad.positions, elements: triBad.elements, bonds: triBad.bonds,
    restraints: [], steps: 2, moves: 6, perFrame: 3,
  }),
  (f) => anFrames.push(f),
);
const anViaCall = annealTorsionsOf({
  positions: triBad.positions, elements: triBad.elements, bonds: triBad.bonds,
  restraints: [], steps: 2, moves: 6, perFrame: 3,
});
ok(anFrames.length === 2 * 3,
  `le recuit seul rend « images par palier » images par palier quand on lui en demande 3 (${anFrames.length} images pour 2 paliers)`);
eq(anFrames[0].phase, 'anneal', '…et chaque image est bien une image de recuit');
eq(Array.from(anViaFrames.positions), Array.from(anViaCall.positions),
  '⚠ …et les deux conducteurs du recuit donnent les mêmes coordonnées');
near(anViaFrames.rama.penalty, anViaCall.rama.penalty,
  '…et le recuit RELIT les bassins φ/ψ sur sa sortie (son rapport ne peut pas mentir)', 1e-12);
near(anViaFrames.cost.after, anViaCall.cost.after,
  '…son coût avant/après est le même, que l’on coupe le recuit en images ou non', 1e-9);
const calcFrames = [];
const calcViaFrames = drainFrames(
  structureCalculationFrames({
    positions: triBad.positions, elements: triBad.elements, bonds: triBad.bonds,
    restraints: [{ i: 3, j: 9, target: 4.0 }], starts: 2, keep: 1, anneal: 2, md: 12, minimise: 1,
  }),
  (f) => calcFrames.push(f),
);
const calcViaCall = structureCalculationOf({
  positions: triBad.positions, elements: triBad.elements, bonds: triBad.bonds,
  restraints: [{ i: 3, j: 9, target: 4.0 }], starts: 2, keep: 1, anneal: 2, md: 12, minimise: 1,
});
eq(calcViaFrames.ranking.map((r) => r.score), calcViaCall.ranking.map((r) => r.score),
  '⚠ le calcul ENTIER, conduit image par image, classe exactement comme l’appel d’un trait');
eq(calcFrames.filter((f) => f.phase === 'start').length, 2,
  '…une image « start » par départ (le panneau l’annonce avant de bouger)');
eq(calcFrames.filter((f) => f.phase === 'attempt-done').length, 2,
  '…et une image « attempt-done » par départ fini');
ok(calcFrames.some((f) => f.phase === 'attempt-done' && f.attempt && Array.isArray(f.attempt.positions)),
  '…et l’image d’un départ fini PORTE le modèle (le panneau peut l’écrire à l’écran)');

/* ── 6 · LE PANNEAU DU VIEWER — 🧬 LE BOUTON, LES DEUX CHAMPS, LA LISTE, LES m ─── */
has(VIEW, "} from '../utils/structureCalc';", 'le viewer importe le module du calcul de structure');
has(VIEW, 'structureAttemptOf, rankStructureAttempts,', '…avec les deux fonctions qui font le travail (un départ, un classement)');
for (const k of ['STRUCTURE_CALC_DEFAULT_STARTS', 'STRUCTURE_CALC_MAX_STARTS', 'STRUCTURE_CALC_DEFAULT_KEEP',
  'STRUCTURE_CALC_MAX_KEEP', 'STRUCTURE_CALC_SEED', 'STRUCTURE_CALC_MAX_RESTRAINTS',
  'STRUCTURE_CALC_RESTRAINT_TOLERANCE', 'STRUCTURE_CALC_MD_STEPS', 'STRUCTURE_CALC_MD_DT',
  'STRUCTURE_CALC_MD_HOT', 'STRUCTURE_CALC_MD_COLD', 'STRUCTURE_CALC_MD_EQUILIBRATION',
  'structureCalcSimulationTimeOf']) {
  has(VIEW, k, `…et la constante « ${k} » (aucune recopie de chiffre dans le panneau)`);
}
has(VIEW, 'const [calcSection, setCalcSection] = useState(null);',
  'la section 🧬 du calcul s’ouvre et se ferme par son bouton');
has(VIEW, 'const openCalcSection = (which) => setCalcSection((cur) => (cur === which ? null : which));',
  '⚠ …et c’est UN seul geste : le bouton U0001f9ec (il n’y a plus trois onglets à faire défiler)');
ok(VIEW.indexOf("['torsion', ") < 0 && VIEW.indexOf("['rama', ") < 0 && VIEW.indexOf("['distances', ") < 0,
  '⚠ la barre d’onglets du panneau unique a DISPARU — la demande : « when clicking on torsion do not open the'
  + ' section inside the toolbar but open a dedicated retractable window inside the viewer as for ramachandran »');
has(VIEW, 'const [torsionWindow, setTorsionWindow] = useState(false);',
  '✏️ Torsion est donc une FENÊTRE de la vue 3D, avec son propre état');
ok(VIEW.indexOf('absolute left-2 bottom-2 z-20') > 0,
  '…rendue DANS le cadre de la vue 3D : un panneau flottant, pas une section de la barre');
has(VIEW, 'const [calcAnneal, setCalcAnneal] = useState(STRUCTURE_CALC_ANNEAL_STEPS);',
  '🔥 les paliers de recuit sont un RÉGLAGE du panneau (0 = l’ancien comportement)');
has(VIEW, 'const [calcWatch, setCalcWatch] = useState(true);',
  '👁 …et « regarder chaque départ » aussi (l’écriture à l’écran se déconnecte)');
has(VIEW, 'const [calcRestraints, setCalcRestraints] = useState([]);',
  '⚠ les DISTANCES sont un état du panneau (l’utilisateur les donne, elles se gardent)');
has(VIEW, 'const [calcStarts, setCalcStarts] = useState(STRUCTURE_CALC_DEFAULT_STARTS);', 'n est un état');
has(VIEW, 'const [calcKeep, setCalcKeep] = useState(STRUCTURE_CALC_DEFAULT_KEEP);', '…m aussi');
has(VIEW, 'const [calcResult, setCalcResult] = useState(null);', '…et la famille classée est gardée pour le tableau');
has(VIEW, 'const calcRunRef = useRef(0);',
  '⚠ un JETON d’annulation : c’est lui que le ⏹ avance pour arrêter le calcul entre deux départs');

/* LE PANNEAU, DÉCOUPÉ DU VIEWER — du commentaire qui l’ouvre jusqu’au bloc suivant
   (🔢 Renumber). C’est CE morceau que le bouton 🧬 et son tableau occupent. */
const calcPanel = VIEW.slice(
  VIEW.lastIndexOf('{/* 🧬 LE CALCUL DE STRUCTURE'),
  VIEW.indexOf('{/* 🔢 Renumber'),
);
ok(calcPanel.length > 6000, `le panneau 🧬 est bien dans le viewer (${calcPanel.length} caractères)`);
/* ⚙ LES TROIS GESTES DU CHAMP SONT ÉCRITS UNE FOIS — `renderForceGestures`, AVANT le
   `return` du composant, donc hors du panneau : c'est ce qui leur permet d'être rendus
   DANS la rangée du bouton 🧬 sans être recopiés (un seul exemplaire du JSX). */
const forceGestures = VIEW.slice(
  VIEW.indexOf('const renderForceGestures = () => ('),
  VIEW.indexOf('return (', VIEW.indexOf('const renderForceGestures = () => (')),
);
ok(forceGestures.length > 800,
  `les trois gestes du champ (▶ MD · ⚒ Minimise · ⟳ Energy) sont écrits UNE fois (${forceGestures.length} caractères)`);
has(calcPanel, 'onClick={() => openCalcSection(\'distances\')}', 'le bouton 🧬 ouvre la section du calcul');
has(calcPanel, '🧬 Structure calculation', '…et il dit ce qu’il fait');
has(calcPanel, 'title="🧬 STRUCTURE CALCULATION — the request, verbatim',
  '⚠ …en citant la demande, mot pour mot (le panneau ne se raconte pas une autre histoire)');
/* ⚠ L'EMPLACEMENT DU BOUTON — la demande de cette session : « move the button structure
   calculation next to the button structure from sequence and color the latter in light
   blue. » Le bouton 🧬 quitte donc le FOND de la rangée ✏️ Modify (il y était le dernier,
   après ⚡ ESP et 🔢 Renumber) : il vient JUSTE APRÈS « 🧬 Structure from sequence », et
   SA SECTION VIENT AVEC LUI (bouton, les trois gestes du champ et le panneau sont un
   seul bloc contigu). Les indices sont pris sur les `onClick` et sur l'ouverture du
   panneau, pas sur les commentaires, qui citent les mêmes mots plus haut. */
const iSeqBtn = VIEW.indexOf('onClick={buildFromSequence}');
const iCalcBtn = VIEW.indexOf("onClick={() => openCalcSection('distances')}");
const iCalcPanel = VIEW.indexOf("{calcSection === 'distances' && (() => {");
const iDisulfBtn = VIEW.indexOf('onClick={toggleDisulfideBonds}');
ok(iSeqBtn > 0 && iSeqBtn < iCalcBtn && iCalcBtn < iCalcPanel && iCalcPanel < iDisulfBtn,
  '⚠ le bouton 🧬 ET sa section vivent maintenant entre « 🧬 Structure from sequence » et ⚭ Disulfides');
ok(VIEW.indexOf('⚡ ESP — the electrostatic-potential surface') > iCalcPanel,
  '…la fin de la rangée (⚡ ESP, 🔢 Renumber avec sa liste) passe donc APRÈS la section du calcul');
has(VIEW, '⚠ EMPLACEMENT — la demande de cette session : « move the button structure',
  '…et le déplacement est daté LÀ OÙ le bloc vit, demande citée mot par mot');
has(VIEW, 'bg-sky-100 border-sky-400 text-sky-800 hover:bg-sky-200 disabled:opacity-40 disabled:cursor-not-allowed',
  '…« 🧬 Structure from sequence » est en BLEU CLAIR (la seconde moitié de la demande)');
has(calcPanel, '⌖ Add the picked pair', 'l’ajout d’une distance passe par le couple piqué (les mêmes 🎯 que le ⚒)');
has(calcPanel, '➕ Add a row',
  '⚠ …ET une ligne s’ajoute VIDE pour être TAPÉE : « define distances in a table and not only by clicking on atoms »');
has(calcPanel, 'onClick={calcAddBlankRow}', '…ce bouton-là');
has(calcPanel, 'aria-label={`${side === \'a\' ? \'First\' : \'Second\'} atom of line ${k + 1}`}',
  '⚠ …et chaque ligne porte SES DEUX ATOMES, écrits à la main');
has(calcPanel, 'onChange={(e) => calcSetRowAtom(r.key, side, e.target.value)}',
  '…résolus à la frappe sur la molécule à l’écran');
/* ⚠ LA FRAPPE, LE ✕ QUI PARLE DE L'AUTRE ATOME, ET LE MESSAGE QUI RESTE — le rapport de
   cette session, mot pour mot : « if I paste “CYS 31 SG” the structure calculation
   recognises the atom but if I type “CYS 31 SG” I get “no atom of this molecule is
   named “CYS 1 SG”. It does not see the 1. Mistery ». La ligne disait ✕ avec le texte
   d'une AUTRE case (la seconde de la ligne, ou un essai plus ancien) sans dire de quelle
   case elle parlait : la frappe se croyait refusée alors qu'elle venait d'être comprise
   — et le ✕ figé du panneau survivait au texte qu'il décrivait. Ce qui doit donc
   rester vrai : chaque plainte est NOMMÉE par son côté, la frappe n'écrit que la sienne,
   le message du panneau dit le verdict du texte PRÉSENT (✓ compris, ✕ refusé, rien pour
   une case vidée), et les cases demandent au navigateur de ne pas réécrire la frappe. */
has(VIEW, 'const calcRowSayOf = (row) => [',
  'la phrase d’une ligne est composée d’UN seul endroit (`calcRowSayOf`) — 📂 Load et la frappe la disent de la même façon');
has(VIEW, 'row && row.sayA ? `atom A: ${row.sayA}` : \'\',',
  '⚠ …et elle NOMME le côté : la plainte du second atome ne peut plus passer pour celle du premier');
has(VIEW, 'const sayCol = which === \'a\' ? \'sayA\' : \'sayB\';',
  '⚠ une frappe n’écrit QUE la plainte de son côté (`sayA`/`sayB`) : l’autre case garde la sienne intacte');
has(VIEW, 'const hadSay = String(row[sayCol] == null ? \'\' : row[sayCol]);',
  '…et la comparaison qui arrête la boucle d’écriture porte sur ELLE, pas sur la phrase entière');
has(VIEW, 'next.say = calcRowSayOf(next);',
  '…donc une case qui redevient lisible EFFACE sa plainte et laisse celle de l’autre');
has(VIEW, 'const CALC_SIDE_NAME = (side) => (side === \'a\' ? \'atom A\' : \'atom B\');',
  'le message du panneau nomme LUI AUSSI la case dont il parle');
has(VIEW, '? `✓ ${CALC_SIDE_NAME(side)} “${written}” is ${hit.label} (atom #${hit.index})',
  '⚠ …une frappe COMPRISE est DITE (✓, avec le nom de l’atome tombé : on voit si le BON résidu a été pris) ;');
has(VIEW, ': `✕ ${CALC_SIDE_NAME(side)} “${written}”: ${hit.say}.`);',
  '…et un refus dit LUI AUSSI de quelle case il parle : le ✕ d’un texte corrigé depuis ne peut plus rester à l’écran');
has(VIEW, 'if (!written) { setCalcMsg(\'\'); return; }',
  '…une case vidée emporte sa plainte, et le ✕ d’une frappe refusée est celui du texte PRÉSENT');
has(calcPanel, 'autoComplete="off" autoCorrect="off" spellCheck={false}',
  '⚠ …les deux cases d’atomes demandent au navigateur de NE PAS réécrire ce qu’on tape : taper et coller mènent au même texte');
has(calcPanel, 'const own = side === \'a\' ? r.sayA : r.sayB;',
  '…et chaque case porte SA plainte (l’infobulle de la case dit ce qui manque à CETTE case-là)');

has(calcPanel, 'aria-label="Number of starting structures n"', 'le champ n dit ce qu’il compte');
has(calcPanel, 'aria-label="Number of retained structures m"', '…et le champ m aussi');
has(calcPanel, 'max={STRUCTURE_CALC_MAX_STARTS}', 'n est borné par la constante du module');
has(calcPanel, 'max={STRUCTURE_CALC_MAX_KEEP}', '…m aussi');
has(calcPanel, 'aria-label={`Target distance for ', 'chaque ligne porte SA cible, modifiable');
has(calcPanel, 'onChange={(e) => calcSetRestraintTarget(r.key, e.target.value)}',
  '…et une frappe la passe au module (aucun chiffre gardé en double)');
has(calcPanel, 'onClick={() => calcRemoveRestraint(r.key)}', 'une ligne se retire (✕)');
has(calcPanel, 'onClick={calcAddRestraint}', '…et ⌖ en ajoute une');
has(calcPanel, 'disabled={calcBusy || !calcUsableRows().length}',
  '⚠ ▶ Run est inerte tant qu’aucune ligne n’a ses DEUX atomes et sa cible (une ligne à moitié écrite attend)');
has(calcPanel, '▶ Run', 'le bouton du calcul est nommé');
has(calcPanel, 'onClick={calcStop}', '…et le ⏹ a le sien');
has(calcPanel, '⏹ Stop', '…nommé lui aussi');
ok(calcPanel.indexOf('relaxRadius') < 0 && calcPanel.indexOf('relaxEscapes') < 0,
  '⚠ ces réglages ont disparu avec le bouton ⚒ Model build (le protocole du calcul n’en dépend plus :'
  + ' voir §1 de utils/structureCalc.js — il est STANDARD, recuit → dynamique → minimisation → trempe)');
has(calcPanel, 'calcWhyOf(r.reason)', 'la colonne « how it ended » traduit la raison du module');
has(calcPanel, '{ranked.ranking.map((r) => {', 'TOUTES les tentatives sont listées, classées');
has(calcPanel, '{r.satisfied}/{r.satisfied + r.violations}', '…avec les distances respectées, en clair');
has(calcPanel, '{r.score.toFixed(1)}', '…et le score du module, tel quel');
has(calcPanel, 'const inFamily = r.rank <= ranked.retained.length;',
  '⚠ les m RETENUES sont marquées comme telles (et elles seules portent des coordonnées)');
has(calcPanel, '⤓ Load', '…et chacune s’écrit à l’écran par le bouton ⤓ Load');
has(calcPanel, 'onClick={() => calcWriteStructure(model, ranked)}', '…qui passe par le writer commun');
has(calcPanel, 'The kept family', 'la famille est décrite (ce que chaque distance y mesure, et sa dispersion)');
has(calcPanel, 'What it is NOT', '⚠ et le panneau dit ce que ce calcul n’est PAS');
has(calcPanel, '🔥 <b>simulated annealing in',
  '⚠ …en disant qu’il EST un recuit (en espace dihédral) au lieu de prétendre le contraire');
has(calcPanel, 'aria-label="Annealing temperature steps"', '…avec le réglage des paliers de recuit');
has(calcPanel, 'aria-label="Write each start on screen while it is computed"',
  '⚠ …et l’interrupteur qui MONTRE le calcul (👁 watch each start)');
has(calcPanel, 'ranked.comp !== componentRef.current',
  '⚠ …et il prévient quand la famille appartient à une AUTRE molécule que celle à l’écran');
/* ⚙ LES DEUX DYNAMIQUES SONT SÉPARÉES — la demande de cette session : « bring back all the
   MD parameters related to structure calculation in the settings of structure
   calculation … In the window dedicated to MD put the parameters for an MD run
   (temperature, explicit, implicit solvent, steps, stepinterval, duration) … This MD
   should be independent of structure calculation. »
   Deux blocs, donc, et DEUX JEUX D'ÉTATS : `renderCalcMdOptions()` (le protocole du 🧬,
   rendu DANS son panneau, lu par son ▶ Run) et `renderMdOptions()` (la dynamique ISOLÉE de
   la fenêtre 🌡 MD, lue par son ▶ MD). */
const calcMdOptions = VIEW.slice(
  VIEW.indexOf('const renderCalcMdOptions = () => ('),
  VIEW.indexOf('const renderMdOptions = () => ('),
);
ok(calcMdOptions.length > 1500,
  `le protocole du 🧬 est écrit une fois (${calcMdOptions.length} caractères)`);
for (const label of ['Molecular dynamics steps per start', 'Minimisation sweeps per start',
  'Hot temperature of the molecular dynamics, in kelvins',
  'Cold temperature of the molecular dynamics, in kelvins',
  'Timestep of each start\'s dynamics, in picoseconds',
  'Total simulation time per start, in picoseconds',
  'Share of the dynamics spent equilibrating, in per cent',
  'Let the peptide ω dihedral vary in the structure calculation']) {
  has(calcMdOptions, `aria-label="${label}"`,
    `…le panneau 🧬 a retrouvé le réglage « ${label} » (le protocole de CHAQUE départ)`);
}
eq(calcMdOptions.includes('value={md'), false,
  '⚠ …et il n’écrit QUE ses propres états (`calcMd*`) : aucun réglage de la fenêtre ne s’y glisse');
has(calcPanel, '{renderCalcMdOptions()}',
  '⚠ …et le panneau les REND, dans sa rangée de réglages (la demande : « in the settings of structure calculation »)');
const mdWindow = VIEW.slice(
  VIEW.indexOf('const renderMdOptions = () => ('),
  VIEW.indexOf('const renderForceGestures = () => ('),
);
ok(mdWindow.length > 3000, `la fenêtre 🌡 MD est écrite une fois (${mdWindow.length} caractères)`);
for (const label of ['Molecular dynamics temperature, in kelvins',
  'Solvent of the molecular dynamics',
  'Molecular dynamics steps',
  'Molecular dynamics timestep, in picoseconds',
  'Duration of the molecular dynamics, in picoseconds',
  'One image every N steps of the molecular dynamics',
  'Let the peptide ω dihedral vary',
  'Use the distance constraints defined in Structure calculation']) {
  has(mdWindow, `aria-label="${label}"`,
    `…la fenêtre MD a SON réglage « ${label} » (T · 💧 solvant · pas · dt · durée · images · ω · 📏)`);
}
has(mdWindow, '= {mdTime.ps} ps ({mdTime.ns} ns)',
  '⚠ …et la fenêtre AFFICHE sa durée (pas × dt), calculée par le module');
for (const label of ['Annealing temperature steps', 'Images per annealing temperature step']) {
  has(calcPanel, `aria-label="${label}"`,
    `⚠ …et « ${label} » reste au panneau 🧬 (c’est un paramètre des départs)`);
}
has(calcPanel, 'families · kcal/mol',
  '⚠ …dans les UNITÉS du champ : kcal/mol (le bloc 🧲 du panneau le dit)');
has(mdWindow, 'onClick={runMolecularDynamics}', '🌡 ▶ MD est un bouton, dans SA fenêtre');
has(mdWindow, 'onClick={() => toggleMdDock(false)}', '…dont le ⇤ la replie');
has(VIEW, 'onClick={() => toggleMdDock(true)}',
  '…et l’onglet vertical 🌡 MD la rouvre (le graphe 🪢 suit le même dessin)');
has(forceGestures, 'onClick={() => toggleMdDock()}', '⚠ …et le bouton de la barre OUVRE/FERME la fenêtre');
eq(forceGestures.includes('onClick={runMolecularDynamics}'), false,
  '⚠ …le ▶ MD n’y est plus : il n’existe qu’une fois, dans sa fenêtre');
has(forceGestures, 'onClick={runMinimise}', '⚒ Minimise est resté dans la rangée');
has(forceGestures, 'onClick={calcReadForceField}', '🧲 …et ⟳ Energy aussi');
/* ⚡ LA RÉPONSE DU ⟳ ENERGY EST ÉCRITE LÀ OÙ LE BOUTON EST — la remarque de cette session :
   « I do not understand the use of the energy button. If I click nothing happens and
   nothing is written anywhere. » La lecture n’existait QUE dans le corps du 🧬 : section
   fermée, le clic ne disait rien. Elle est maintenant rendue DANS la rangée des gestes (et
   seulement là quand la section du 🧬 est fermée, pour ne pas écrire deux fois le même
   texte), et l’enveloppe try/catch garantit qu’une lecture impossible est DITE. */
has(forceGestures, "{calcMsg && calcSection !== 'distances' && (",
  '⚠ …et sa réponse s’écrit SOUS les boutons qui l’ont demandée (le clic dit toujours quelque chose)');
has(forceGestures, 'basis-full text-[10px] font-semibold rounded-md border',
  '…sur toute la largeur de la rangée, donc lisible au premier coup d’œil');
has(VIEW, 'const calcReadForceFieldNow = () => {',
  '…la lecture du champ reste UNE seule implémentation (aucun second calcul d’énergie)');
has(VIEW, 'const calcReadForceField = () => {\n  try {\n    return calcReadForceFieldNow();',
  '⚠ …mais elle est enveloppée : une lecture qui jette est DITE au lieu de laisser le clic muet');
has(VIEW, '✕ The reading of the force field failed:',
  '…avec le texte de l’erreur, et la promesse que la molécule n’a pas bougé (une lecture n’écrit rien)');
has(VIEW, 'The family-by-family table of this same reading is in 🧬 Structure calculation',
  '…et le renvoi vers le tableau famille par famille du 🧬 (le chiffre s’y décompose)');
has(calcPanel, '{renderForceGestures()}',
  '⚠ …et les trois sont RENDUS dans le panneau (la demande : « can the MD, Minimize and Energy be put next to “structure calculation” button? »)');
ok(calcPanel.indexOf('{renderForceGestures()}') > calcPanel.indexOf('🧬 Structure calculation'),
  '…juste APRÈS 🧬 Structure calculation — donc là sans ouvrir une seule section');
eq(VIEW.split('{renderForceGestures()}').length - 1, 1,
  '…rendus une seule fois (aucun second exemplaire au fond du corps 🧬 : un seul JSX)');
has(calcPanel, 'hydrogens added on',
  '⚠ …et la lecture DIT les atomes ajoutés (hydrogènes), les charges et la surface');
has(calcPanel, 'The three torsion families are what makes a Ramachandran plot defensible',
  '⚠ …et le panneau DIT pourquoi ces trois familles sont là (la remarque sur les Ramachandran)');
has(calcPanel, 'k {row.k} {row.id === \'elec\' ? \'\' : row.unit}',
  '⚠ …et chaque famille affiche son POIDS et son UNITÉ telles que le module les écrit (aucun kcal/mol recopié dans le JSX)');
has(calcPanel, '🧭 φ/ψ', '⚠ le tableau classé porte la lecture du squelette par modèle (colonne 🧭 φ/ψ)');
has(calcPanel, 'r.rama ? `${r.rama.violations}/${r.rama.measured}`', '…avec les résidus hors bassin');

/* LES FENÊTRES SONT SÉPARÉES — chacune se rend de son côté, et plus rien ne s’ajoute au
   panneau U0001f9ec (la barre d’onglets a disparu avec les deux autres fenêtres). */
ok(VIEW.indexOf("{calcSection === 'torsion' && (() => {") < 0,
  '⚠ la section ✏️ Torsion ne se rend plus dans la barre (elle est devenue la fenêtre de la vue 3D)');
ok(VIEW.indexOf("{calcSection === 'rama' && (() => {") < 0,
  '…ni celle du U0001faa2 Ramachandran (elle est devenue le dock du viewer, ouvert par son bouton)');
has(VIEW, "{calcSection === 'distances' && (() => {",
  '…seule celle du U0001f9ec calcul reste une section de la barre');
ok(VIEW.indexOf('Structure &amp; geometry') < 0,
  '…et la barre d’onglets elle-même a disparu (les trois sections ne partagent plus rien)');
has(VIEW, 'className="w-full bg-indigo-50/40 border border-t-0 border-indigo-200 rounded-b-lg p-3 flex flex-col gap-2"',
  '⚠ …et c’est LE SEUL corps de panneau : la barre d’onglets et son enveloppe partagée ont disparu avec elle');

/* LE PIQUAGE SE VOIT — l’atome cliqué est peint dans la vue 3D, de la couleur de son
   slot (A · B · C · D), et la peinture est vérifiée avant d’être gardée. */
has(VIEW, 'const TORSION_SLOT_COLORS = [0x16a34a, 0x2563eb, 0xf59e0b, 0xdb2777];',
  '⚠ les quatre couleurs du piquage (A · B · C · D)');
has(VIEW, 'const paintTorsionPicks = (slots) => {', '…peintes par une seule fonction');
has(VIEW, "const paint = paintTorsionPicks(torsionAtomsRef.current);",
  '⚠ …appelée à CHAQUE piquage : l’atome se colore pendant la définition, pas après');
has(VIEW, 'rep.structureView.getAtomIndices', '…et la sélection est VÉRIFIÉE (jamais le mauvais atome peint)');
has(VIEW, 'style={{ backgroundColor: dot }}', '…la pastille du bouton porte la même couleur que l’atome');

/* ⚖ LE POIDS D'UNE LIGNE, ET LA CASE 📏 DE LA FENÊTRE 🌡 MD — la demande, mot pour mot :
   « nella finestra MD aggiungi l'opzione “use constraints defined in structure calculation”
   and enable this option allowing the user to give a weight to these constraints. This
   weight can be defined in the table. » Ce qui doit rester vrai : la case EST dans la
   fenêtre MD et elle commande le ▶ MD (et lui seul), le poids EST une COLONNE de la table
   (une case par ligne), et les QUATRE gestes du champ lisent le même poids — un seul
   lecteur (`calcWeightOf`), une seule fabrique de contraintes (`calcRestraintTermsOf`). */
has(mdWindow, 'aria-label="Use the distance constraints defined in Structure calculation"',
  '📏 l’option « use constraints defined in structure calculation » existe, DANS la fenêtre 🌡 MD');
has(mdWindow, 'onChange={(e) => setMdUseRestraints(e.target.checked)}',
  '…et c’est une vraie case à cocher, branchée sur son état');
has(mdWindow, '📏 use the constraints of 🧬 Structure calculation',
  '…qui se lit dans l’interface (le mot de la demande, pas un glyphe à deviner)');
has(mdWindow, '<span className="font-mono font-bold text-indigo-800">({calcFieldRows().length})</span>',
  '…avec le nombre de lignes qui partiront VRAIMENT (complètes, et de poids non nul)');
has(VIEW, 'const [mdUseRestraints, setMdUseRestraints] = useState(true);',
  '⚠ la case est un état DE LA FENÊTRE, COCHÉE par défaut : une table ne change pas de sens sans un geste');
has(VIEW, 'mdRunRestraints: mdUseRestraints,',
  '…et le choix survit à un rechargement de la page (sous la clef de la fenêtre)');
has(VIEW, "if (typeof s.mdRunRestraints === 'boolean') setMdUseRestraints(s.mdRunRestraints);",
  '…il est relu au montage');
has(VIEW, "if (typeof s.mdUseRestraints === 'boolean') setMdUseRestraints(s.mdUseRestraints);",
  '⚠ …et une session enregistrée AVANT cette séparation retrouve la sienne (clef historique : aucun réglage perdu)');
/* ⚙ LES RÉGLAGES DE LA FENÊTRE SONT À ELLE — les six états de la dynamique isolée, et la
   preuve qu'ils ne sont pas ceux du 🧬 (les états du calcul s'appellent `calcMd*`). */
for (const state of ['const [mdTemp, setMdTemp] = useState(STRUCTURE_CALC_MD_HOT);',
  'const [mdSteps, setMdSteps] = useState(STRUCTURE_CALC_MD_STEPS);',
  'const [mdDt, setMdDt] = useState(STRUCTURE_CALC_MD_DT);',
  'const [mdImage, setMdImage] = useState(STRUCTURE_CALC_MD_FRAME);',
  'const [mdSolvent, setMdSolvent] = useState(STRUCTURE_CALC_SOLVENT);',
  'const [mdFreeOmega, setMdFreeOmega] = useState(STRUCTURE_CALC_FREE_OMEGA);']) {
  has(VIEW, state, `…l’état de la fenêtre est là : ${state.split(' = ')[0]}`);
}
has(VIEW, 'const [calcMdSteps, setCalcMdSteps] = useState(STRUCTURE_CALC_MD_STEPS);',
  '⚠ …et le protocole du 🧬 garde le SIEN (deux états, deux gestes : aucun ne lit l’autre)');
has(VIEW, 'const mdTime = structureCalcSimulationTimeOf({ steps: mdSteps, dt: mdDt });',
  '…la durée de la fenêtre est calculée par le module, comme celle du calcul');
has(VIEW, 'const mdSolventOf = () => structureCalcSolventOf(mdSolvent);',
  '💧 …et le solvant est résolu par le module (aucun ε écrit dans le JSX)');
/* LE ▶ MD LIT LA CASE — décochée : ni contrainte, ni longe, et le rapport le DIT. */
const mdSrc = VIEW.slice(
  VIEW.indexOf('const runMolecularDynamics = () => {'),
  VIEW.indexOf('const runMinimise = () => {'),
);
ok(mdSrc.length > 1500, `la dynamique est bien branchée (${mdSrc.length} caractères)`);
has(mdSrc, 'const list = mdUseRestraints',
  '⚠ …le ▶ MD demande d’abord à SA case : ce qu’il porte dépend d’elle');
has(mdSrc, 'steps: mdSteps, dt: mdDt, temperature: mdTemp,',
  '⚙ …et il passe SES réglages au moteur : ses pas, son pas de temps, sa température');
has(mdSrc, 'dielectric: mdSolventOf().dielectric',
  '💧 …avec SON solvant (le diélectrique que les charges voient)');
has(mdSrc, 'perFrame: mdImage',
  '🖼 …et SON intervalle d’images (le « stepinterval » de la demande)');
has(mdSrc, 'freeOmega: mdFreeOmega', '🪢 …et SON option ω (le calcul a la sienne)');
has(mdSrc, 'watch: true,',
  '👁 …et il s’ÉCRIT toujours : la molécule bouge PENDANT la dynamique, pas seulement à la fin');
eq(/calcMdSteps|calcMdTemp|calcMdHot|calcMdEquil|calcMinimise|calcOmegaFree|calcMdTime/.test(mdSrc), false,
  '⚠ …en ne citant AUCUN état du calcul — et le calcul ne cite pas les siens : les deux dynamiques sont INDÉPENDANTES, comme la demande le dit');
has(mdSrc, '    : [];', '…décochée, il part SANS aucune contrainte de distance');
has(mdSrc, 'const held = list.length ? calcHeldPairs(geom, list) : [];',
  '⚠ …et SANS longe : ni contrainte, ni mur (une dynamique libre, vraiment)');
has(mdSrc, 'the distance table was LEFT OUT',
  '…et le rapport dit que la table a été laissée de côté — jamais un silence');
has(mdSrc, 'at weight 0 left out', '…ainsi que le nombre de lignes en pause, quand il y en a');
/* LA COLONNE ⚖ DE LA TABLE DES DISTANCES — une case par ligne, à côté de sa cible. */
has(calcPanel, '⚖ w', 'la table des distances porte la colonne ⚖ (le poids, demandé « in the table »)');
has(calcPanel, 'onChange={(e) => calcSetRestraintWeight(r.key, e.target.value)}',
  '…chaque ligne a SA case de poids (aucun poids global caché)');
has(calcPanel, "aria-label={`Weight of distance ${k + 1}, in multiples of the field's k_NOE`}",
  '…nommée pour ce qu’elle est');
has(calcPanel, 'const paused = ready && weight === 0;',
  '⚠ …et un poids de 0 est une MISE EN PAUSE, dite à l’écran (⏸ sur la ligne) au lieu d’être un poids comme un autre');
has(calcPanel, '⚖ is the WEIGHT of a line', 'le panneau dit ce que cette colonne fait');
has(calcPanel, 'k = k_NOE × weight', '…avec la formule en clair (le poids multiplie la raideur)');
has(VIEW, 'const calcSetRestraintWeight = (key, value) => {', 'le poids se tape comme la cible');
has(VIEW, 'const weight = Number.isFinite(v) && v >= 0 ? v : null;',
  '…le texte tapé est gardé, la valeur n’en est que la conséquence, et un illisible vaut le DÉFAUT');
has(VIEW, 'const calcWeightOf = (row) => restraintWeightOf(row);',
  '⚠ UN SEUL lecteur du poids dans le viewer (les quatre gestes passent par lui)');
has(VIEW, 'const calcFieldRows = () => calcUsableRows().filter((r) => calcWeightOf(r) > 0);',
  '…et UNE seule définition des lignes qui entrent dans le champ');
has(VIEW, 'const calcInertCount = () => calcUsableRows().filter((r) => calcWeightOf(r) <= 0).length;',
  '…et le nombre de lignes en pause, pour que les rapports puissent le DIRE');
has(VIEW, 'const calcRestraintTermsOf = (list) => Array.from(list || []).map((r) => ({',
  '…et UNE seule fabrique de contraintes (i, j, target, weight) pour les quatre gestes');
has(VIEW, '})).concat(stretchedDisulfideTermsOf({ bridges: disulfideDrawnRef.current.bonds }));',
  '⚠ …et elle y ajoute les PONTS DISULFURE ÉTIRÉS (un terme de distance visé à 2.05 Å : la liaison du graphe est une famille FIGÉE du champ, donc aucun geste ne les refermerait — voir utils/disulfideFold.js)');
has(VIEW, 'const disulfideConductedNote = () => {',
  '…et la phrase qui DIT qu’un pont étiré est conduit (le rapport compterait sinon une distance de plus que la table)');
eq(VIEW.split('disulfideConductedNote()}').length - 1, 3,
  '⚠ …dite par les TROIS gestes qui bougent la molécule : ▶ Run, ▶ MD, ⚒ Minimise');
eq(VIEW.split('restraints: calcRestraintTermsOf(list),').length - 1, 4,
  '⚠ les QUATRE gestes du champ — ▶ Run, ▶ MD, ⚒ Minimise, ⟳ Energy — portent le poids de la même façon');
eq(VIEW.split('calcFieldRows().filter((r) => r.i < geom.count && r.j < geom.count)').length - 1, 4,
  '…et ils prennent tous les mêmes lignes (complètes, poids non nul)');
has(VIEW, "w: r.w != null ? r.w : (r.weight == null || r.weight === 1 ? '' : String(r.weight)),",
  '⚠ …et le POIDS de chaque ligne est écrit avec la table (le texte tapé, comme la cible)');
has(VIEW, 'weight: Number.isFinite(wv) && wv >= 0 ? wv : null,',
  '…puis relu ligne par ligne au montage suivant');
/* ⚠ L'ORDRE DES DÉCLARATIONS EST UN CONTRAT, PAS UN DÉTAIL DE MISE EN PAGE — le tableau
   de dépendances de l'effet 💾 est évalué PENDANT le rendu : les états qu'il y cite
   doivent donc être déclarés AVANT lui, sinon c'est une TDZ (« Cannot access 'calcMdHot'
   before initialization ») qui fait JETER le viewer entier — c'est ce qu'a trouvé
   `_viewer_render_smoke_test.mjs`, et la leçon est répétée ici pour qu'on ne la
   réapprenne pas deux fois. */
for (const state of ['mdTemp', 'mdSteps', 'mdDt', 'mdImage', 'mdSolvent', 'mdFreeOmega',
  'calcMdHot', 'calcMdCold', 'mdUseRestraints']) {
  ok(VIEW.indexOf(`const [${state}, set`) < VIEW.indexOf("const CALC_STORE_KEY = 'labViewerCalcState';"),
    `⚠ …et ${state} est déclaré AVANT l’effet 💾 qui le lit dans ses dépendances (aucune TDZ au rendu)`);
}

/* LE GESTE, DANS LE SOURCE — le MOTEUR du module conduit image par image, le classement
   par le module, et l'écriture par le MÊME chemin qu'une torsion. */
const runSrc = VIEW.slice(
  VIEW.indexOf('const runStructureCalculation = () => {'),
  VIEW.indexOf('const calcStop = () => {'),
);
ok(runSrc.length > 1800, `le calcul est bien branché (${runSrc.length} caractères)`);
has(runSrc, 'const frames = structureCalculationFrames({',
  '⚠ le calcul EST le moteur du module (`structureCalculationFrames`), conduit image par image — aucune descente recopiée');
has(runSrc, 'seed: STRUCTURE_CALC_SEED', '…avec la graine FIXE du dossier (le même n redonne la même famille)');
has(runSrc, 'restraints: calcRestraintTermsOf(list),',
  '…et les distances de l’utilisateur, telles quelles, AVEC LEUR POIDS ⚖ (une seule fabrique de contraintes pour les quatre gestes)');
has(runSrc, 'const list = calcFieldRows().filter(',
  '⚠ …qui sont les lignes FINIES de la table (deux atomes résolus + une cible) et dont le ⚖ n’est pas 0');
has(runSrc, 'const base = Array.from(geom.positions);',
  '⚠ …et le départ est photographié : l’aperçu qui écrit à l’écran ne nourrit pas le départ suivant');
has(runSrc, 'anneal: calcAnneal, annealPerFrame: calcAnnealFrame,',
  '🔥 …le recuit du panneau est celui qui tourne, avec le nombre d’images par palier du panneau');
has(runSrc, 'md: calcMdSteps, mdPerFrame: STRUCTURE_CALC_MD_FRAME,',
  '🌡 …et la dynamique du panneau aussi (les pas de MD de chaque départ)');
has(runSrc, 'mdDt: calcMdDt, mdEquilibration: calcMdEquil,',
  '⏱ …avec le PAS DE TEMPS (ps) et la part d’équilibration du panneau : c’est la durée totale de la simulation');
has(runSrc, 'mdHot: calcMdHot, mdCold: calcMdCold,',
  '🌡 …et les deux températures (K) du panneau');
has(runSrc, 'minimise: calcMinimise,', '⚒ …et la minimisation (l’affinage final)');
has(runSrc, 'shouldStop: () => calcRunRef.current !== run,',
  '⚠ le module est arrêté ENTRE deux départs par le ⏹, ET PAR LUI SEUL (il le demande lui-même)');
/* ⚠ L'OBJET DE CETTE SESSION : LE CALCUL SURVIT AU CHANGEMENT DE PAGE / D'ONGLET. La page
   resservant sa molécule, `componentRef.current` n'est plus le composant du départ —
   comparer les OBJETS arrêtait le calcul (« The molecule on screen changed… ») et perdait
   tout ce qui était fait (« Structure calculation ha un problema … se rinfresco la pagina
   tutto è perso e bisogna ricominciare da capo »). La CLÉ de la molécule remplace cette
   comparaison : le calcul CONTINUE sur les coordonnées photographiées au départ, seule
   l'écriture à l'écran est suspendue, la famille est gardée, et ⤓ Load l'écrit dès que la
   bonne molécule est revenue. */
has(VIEW, 'const calcMoleculeKey = (comp, structure) => {',
  '⚠ la molécule se reconnaît à sa CLÉ (nom, atomes, résidus, atomes extrêmes) — jamais à l’objet NGL, qui change à chaque fois que la page resserve son modèle');
has(runSrc, 'const moleculeKey = calcMoleculeKey(comp, structure);',
  '…le calcul retient donc la clé de SA molécule, une fois, au départ');
has(runSrc, "const onScreen = calcMoleculeKey(componentRef.current, componentRef.current && componentRef.current.structure) === moleculeKey;",
  '⚠ …l’écriture à l’écran est suspendue (puis reprise) selon cette clé, à CHAQUE image');
ok(runSrc.indexOf('The molecule on screen changed') < 0,
  '⚠ …et « the molecule on screen changed » n’est PLUS une raison d’arrêter : la pompe ne s’interrompt plus pour ça');
has(runSrc, 'if (calcMoleculeKey(componentRef.current, componentRef.current && componentRef.current.structure) === moleculeKey) {',
  '⚠ …et l’écriture du meilleur est gardée par la même clé : elle ne part que vers SA molécule');
has(runSrc, 'The calculation went through the page change',
  '⚠ …et quand la page a changé d’onglet pendant le calcul, le panneau DIT que la famille est gardée au lieu de perdre le travail');
has(VIEW, 'if (ranked && ranked.moleculeKey && ranked.moleculeKey !== calcMoleculeKey(comp, structure)) {',
  '…⤓ Load accepte la famille dès que la MÊME molécule est revenue (la clé, plus l’objet)');
has(VIEW, 'const onScreen = calcMoleculeKey(componentRef.current, componentRef.current && componentRef.current.structure) === moleculeKey;',
  '⚠ …et un ▶ MD / ⚒ Minimise survit au changement de page de la même façon (même clé, même garde)');
has(runSrc, 'try { tick = frames.next(); } catch (e) {',
  '⚠ une erreur du moteur est DITE (et le panneau se débloque) au lieu de laisser tourner une ligne');
has(runSrc, 'if (calcWatch && shown.positions) calcPreviewPositions(comp, structure, shown.positions);',
  '👁 …chaque image du module est écrite à l’écran, par le MÊME chemin d’écriture qu’une torsion');
has(runSrc, 'if (Date.now() - started > CALC_FRAME_BUDGET_MS) break;',
  '⚠ …puis la main revient à la page (budget de quelques millisecondes) : c’est CE qui fait qu’on VOIT la molécule bouger');
has(runSrc, 'window.setTimeout(pump, 0)', '⚠ …et la tranche suivante reprend après le rendu');
has(runSrc, 'if (calcRunRef.current !== run) return;',
  '…et le jeton arrête la pompe (⏹, ou une autre molécule)');
has(runSrc, 'setCalcProgress(calcPhaseLine(shown, attempts.length, n));',
  '…avec une ligne de progression PAR PHASE du moteur (tirage, recuit, ▷ dynamique, ⚒ minimisation, trempe)');
has(runSrc, 'onAttempt: (attempt) => {', '⚠ chaque départ FINI est poussé par le moteur (et le panneau le dit)');
has(runSrc, 'const family = ranked || rankStructureAttempts({ attempts, keep: m });',
  '⚠ le classement est celui du module quand il a fini — et le panneau ne choisit pas les m à sa place');
has(runSrc, 'calcWriteStructure(family.retained[0], family)', 'le meilleur est écrit tout de suite');
ok(runSrc.indexOf('finishRelaxPlayback') < 0,
  '⚠ l’attente de l’animation du ⚒ a disparu avec elle : le U0001f9ec a le monopole de l’écriture');
has(runSrc, 'torsionUndoRef.current = {', '⚠ et le ↺ est armé AVANT toute écriture : la molécule d’avant est gardée');
ok(runSrc.indexOf('torsionUndoRef.current = {') < runSrc.indexOf('pump();'),
  '…la photographie du ↺ est prise avant le premier départ, pas après');
/* LA LIGNE D'UNE IMAGE ET CELLE D'UN DÉPART — écrites une fois, pour les trois moteurs. */
has(VIEW, 'const calcPhaseLine = (f, done, of, head = null) => {',
  'la ligne de progression est UNE fonction de la phase du moteur');
for (const phase of ["case 'draw':", "case 'anneal':", "case 'md-equilibrate':", "case 'md-cool':",
  "case 'md':", "case 'minimise':", "case 'quench':"]) {
  has(VIEW, phase, `…qui sait dire « ${phase.slice(6, -2)} »`);
}
has(VIEW, 'const calcAttemptLine = (a, { done, of }) =>',
  '⚠ et la ligne d’un départ fini aussi (recuit, dynamique, minimisation, ω, φ/ψ)');
/* LES GESTES ⚙ — LA MÊME MÉCANIQUE D'IMAGES POUR LA DYNAMIQUE ET LA MINIMISATION. */
has(VIEW, 'const pumpMotion = ({ frames, comp, structure, head, watch = calcWatch, onEnd }) => {',
  '⚠ la dynamique et la minimisation se conduisent avec LA MÊME pompe que le calcul (pas une seconde boucle),'
  + ' et c’est ELLE qui porte le droit d’écrire les images (`watch`)');
has(VIEW, 'const runMolecularDynamics = () => {', '🌡 ▶ MD est branché');
has(VIEW, 'frames: mdFrames({', '…sur le moteur de dynamique du module');
has(VIEW, 'const runMinimise = () => {', '⚒ Minimise est branché');
has(VIEW, 'frames: minimizeFrames({', '…sur le moteur de minimisation du module');
has(VIEW, 'const held = calcHeldPairs(geom, list);',
  '⚠ …tous deux SOUS LONGE : les distances déjà tenues sont transmises au module');
has(VIEW, 'const calcHeldPairs = (geom, list) => list',
  '…par une fonction qui ne garde QUE celles qui sont tenues à cet instant');
has(VIEW, 'label: `🌡 molecular dynamics · ${mdSteps} steps · ${mdTime.ps} ps · T = ${mdTemp} K`\n'
  + "      + ` · 💧 ${mdSolventOf().label}`\n"
  + "      + ` · ω ${mdFreeOmega ? 'free to vary' : 'held trans'}`\n"
  + "      + ` · ${mdUseRestraints ? `with the ${list.length} distance${list.length === 1 ? '' : 's'} of the table` : 'without the distance table'}`,",
  '⚠ …et le ↺ est armé AVANT d’écrire, comme pour une torsion (avec les réglages de LA FENÊTRE : pas, durée, solvant, ω — et ce que la case 📏 a décidé)');
has(VIEW, "// le graphe suit ce que la dynamique vient d'écrire",
  '⚠ le graphe 🪢 est relu après la dynamique et après la minimisation (il ne parle jamais d’une autre conformation)');
eq(VIEW.split('if (ramaIsShown()) readRamachandran();').length - 1, 4,
  '…et il est relu dans les QUATRE points d’écriture d’une image : à chaque image de la dynamique, '
  + 'à chaque image de la minimisation, à leur FIN, et quand le calcul de structure écrit son modèle');
eq(VIEW.split('if (ramaIsShown())').length - 1, 4,
  '…toujours par le MÊME lecteur (celui du bouton ⟳ du 🪢), jamais un second calcul de φ/ψ');
/* LE 🪢 SUIT LE MOUVEMENT — la demande : « can the ramachandran be updated while the
   molecule moves? » Oui : la lecture φ/ψ est refaite après CHAQUE image écrite quand la
   fenêtre 🪢 est à l'écran (mesuré : 0.24 ms pour 30 résidus, 1 ms pour 300), dans la
   dynamique ET dans la minimisation ; et dans le calcul quand 👁 watch écrit vraiment la
   molécule. C'est TOUJOURS le même lecteur — celui du bouton ⟳ du 🪢.
   ⚠ La demande de CETTE session : « update the ramachandran during energy minimization,
   MD and structure calculation. » La question « la fenêtre est-elle à l'écran ? » est donc
   posée À CHAQUE IMAGE (`ramaIsShown()`), et non une fois au clic : une boucle d'images est
   une fermeture DÉJÀ EN VOL, elle ne verrait jamais un état mis à jour — alors que la
   fenêtre ouverte PENDANT un ▶ MD, un ⚒ Minimise ou un ▶ Run doit suivre, elle aussi. */
has(VIEW, 'const ramaShownRef = useRef(false);',
  '⚠ …la réponse est tenue dans une RÉFÉRENCE (elle rend toujours la valeur COURANTE à une boucle déjà en vol)');
has(VIEW, 'ramaShownRef.current = !!rama;',
  '…écrite à chaque rendu, au seul endroit qui la tient : aucune autre lecture de `rama` ne peut la désynchroniser');
has(VIEW, 'const ramaIsShown = () => ramaShownRef.current;',
  '…et lue par UNE question, « la fenêtre 🪢 est-elle à l’écran MAINTENANT ? »');
eq(VIEW.split('if (calcWatch && ramaIsShown()) readRamachandran();').length - 1, 1,
  '…posée aussi après chaque départ ÉCRIT du calcul de structure (le 👁 décide, rien n’est lu d’une autre conformation)');
/* LA DERNIÈRE COORDONNÉE EST ÉCRITE, MÊME SANS 👁 — le moteur n'annonce qu'une image tous
   `perFrame` pas : s'arrêter à la dernière IMAGE laissait la molécule (et le 🪢) quelques pas
   AVANT la fin, et avec le 👁 décoché elle ne bougeait pas du tout, pendant que le rapport
   parlait de l'énergie APRÈS et que le ↺ promettait de défaire le geste. `tick.value` porte
   l'état FINAL : il s'écrit une fois, par le même chemin qu'une image. */
has(VIEW, 'const end = tick.value;',
  '⚠ la fin d’une trajectoire (▶ MD, ⚒ Minimise) se lit sur le RÉSULTAT du moteur, pas sur la dernière image annoncée');
has(VIEW, 'if (end && end.ok && end.positions) calcPreviewPositions(comp, structure, end.positions);',
  '…et ces coordonnées FINALES s’écrivent par le MÊME chemin qu’une image (le 📏, les plaques et le 🪢 suivent)');
ok(VIEW.indexOf('if (end && end.ok && end.positions) calcPreviewPositions(comp, structure, end.positions);')
  < VIEW.indexOf('if (onEnd) onEnd(end);'),
  '…AVANT le rapport : la relecture des distances et celle du 🪢 portent donc sur ce que la molécule montre');
/* LES DISTANCES DEMANDÉES SONT RELUES APRÈS COUP — « can the MD take the distance
   constraints into account? » La réponse est DANS LE RAPPORT : combien de distances de la
   table sont dans la tolérance après le geste, et de combien la plus fausse en sort. Le
   chiffre vient de `restraintReportOf`, relu sur les coordonnées que le geste vient
   d’écrire — le panneau ne compte rien lui-même. */
has(VIEW, 'const rep = restraintReportOf({ positions: run.positions, restraints: list });',
  '⚠ …et les distances tenues sont RELUES après la dynamique ET après la minimisation');
eq(VIEW.split('restraintReportOf({ positions: run.positions, restraints: list })').length - 1, 2,
  '…dans les DEUX gestes ⚙, par le lecteur du module (aucun second comptage)');
has(VIEW, '· distances: ${rep.satisfied}/${rep.count} within ± ${rep.tolerance} Å',
  '…et le rapport du panneau chiffre les distances dans la tolérance, geste par geste');
/* LE CHAMP DE FORCES ET SES FAMILLES — décrits par le module, jamais recopiés ici. */
has(VIEW, 'const calcReadForceField = () => {', '🧲 le panneau sait RELIRE le champ de forces sur la molécule');
has(VIEW, 'forceFieldEnergyOf({', '…avec la fonction du module');
has(VIEW, '{forceFieldRowsOf().map((row) => (', '…et affiche les familles que le module rend');
has(VIEW, '🧲 Force field · {FORCE_FIELD_FAMILIES.length} families',
  '⚠ …sans écrire un seul poids à la main dans le JSX');
has(VIEW, 'STRUCTURE_CALC_RAMA_WEIGHT', '…le poids des bassins φ/ψ vient du module');
has(VIEW, 'STRUCTURE_CALC_CHI_WEIGHT', '…celui de χ1 aussi');
const writeCalc = VIEW.slice(
  VIEW.indexOf('const calcWriteStructure = (retained, ranked) => {'),
  VIEW.indexOf('const calcPreviewPositions'),
);
has(writeCalc, 'writeStructurePositions(comp, idxs, retained.positions)',
  'l’écriture passe par LE chemin d’une torsion (positionFromArray + un seul redessin)');
eq(writeCalc.split('writeStructurePositions(').length - 1, 1, '…et par lui seul');
has(writeCalc, 'for (let i = 0; i < count; i += 1) idxs.push(i);',
  '⚠ TOUTE la molécule est écrite : c’est elle que le calcul a construite');
has(writeCalc, 'if (!writeStructurePositions(comp, idxs, retained.positions)) {',
  '…et un refus de NGL est DIT au lieu d’être cru');
has(VIEW, 'const calcStop = () => {', 'le ⏹ a son implémentation');
has(VIEW, 'part.finish(true)', '…et il CLASSE ce qui est déjà calculé au lieu de jeter le travail fait');
has(VIEW, 'setCalcMsg((prev) => `⏹ Stopped between two starts:', '…en disant combien de départs sur n ont été faits');
has(VIEW, 'const calcReportOf = (retained, ranked) => {', 'le rapport du calcul est une fonction (une seule mise en phrases)');
has(VIEW, '🧬 structure calculation · ', '…et le journal ↺ nomme le geste (n, m et le nombre de distances)');
has(writeCalc, 'ranked.moleculeKey !== calcMoleculeKey(comp, structure)',
  '⚠ une famille ne peut pas être écrite sur une AUTRE molécule — la MÊME clé que le calcul la reconnaît : l’écriture est refusée, et le panneau le dit');
ok(runSrc.indexOf('if (componentRef.current !== comp) {') < 0,
  '⚠ …et un calcul en cours NE s’arrête PLUS quand la page resserve sa molécule (l’objet de cette session : le calcul survit au changement de page / d’onglet)');
has(runSrc, 'setCalcResult({ ...family, comp, structure, moleculeKey })',
  '…la famille est marquée de SA molécule (et de sa clé) au moment où elle est classée');

/* ── 8 · LES DEUX PANNES DE CETTE SESSION, MESURÉES ────────────────────────────
   ① « The structure calculation can never be completed … Cannot read properties of
      undefined (reading 'toFixed') » : le rapport du 🧬 lit des champs du classement
      (`bondRms`, `angleRms`, `anneal`, `quench`, `omega`, `omegaFree`) que
      `rankStructureAttempts` ne transportait PAS — il en mourait donc À LA FIN de chaque
      calcul, après avoir écrit la molécule (le travail était fait et perdu à l'écran).
   ② « when a disulphide is declared this long bond … seems blocked and can never
      approach the custom disulphide distance » : la liaison SG–SG qu'écrit la page pour
      qu'NGL dessine le pont referme le graphe sur un CYCLE, donc toutes les charnières du
      segment entre les deux Cys passent pour des liaisons de cycle et AUCUN canal ne peut
      plus rapprocher les deux Sγ. Le graphe des moteurs est celui de
      `withoutStretchedDisulfideBonds` (les ponts ÉTIRÉS seulement : un pont fermé garde
      sa vraie liaison S–S). */
const spanOf = (geo, i, j) => Math.hypot(
  geo.positions[i * 3] - geo.positions[j * 3],
  geo.positions[i * 3 + 1] - geo.positions[j * 3 + 1],
  geo.positions[i * 3 + 2] - geo.positions[j * 3 + 2],
);
/* La chaîne du test, refermée par la « liaison » d'un pont disulfure déclaré : huit
   carbones, et l'arête 0–7 — ce que le CONECT SG–SG écrit entre deux Cys lointaines. */
const bridged = (() => {
  const base = chainOf(8);
  return { ...base, bonds: base.bonds.concat([{ i: 0, j: 7, order: 1 }]) };
})();
const bridgeSpan = spanOf(bridged, 0, 7);
ok(Math.abs(bridgeSpan - SS_BOND_LENGTH) > SS_BOND_TOLERANCE,
  `le pont déclaré est ÉTIRÉ : les deux Sγ sont à ${bridgeSpan.toFixed(2)} Å, hors de la fenêtre de liaison`);
const bridge = { atomIndex1: 0, atomIndex2: 7, distance: bridgeSpan };
const engineBonds = withoutStretchedDisulfideBonds({ bonds: bridged.bonds, bridges: [bridge] });
eq(engineBonds.length, bridged.bonds.length - 1,
  '⚠ la fausse liaison d’un pont ÉTIRÉ est RETIRÉE du graphe des moteurs (une seule arête, rien d’autre)');
eq(rotatableBondsOf({ elements: bridged.elements, bonds: bridged.bonds, atomCount: 8 }).count, 0,
  '⚠ avec elle, la chaîne entière est UN CYCLE : aucune charnière — donc aucun canal ne peut rapprocher les deux Sγ');
eq(rotatableBondsOf({ elements: bridged.elements, bonds: engineBonds, atomCount: 8 }).count, 5,
  '…sans elle, les cinq charnières de la chaîne redeviennent des canaux');
const closedBridge = withoutStretchedDisulfideBonds({
  bonds: bridged.bonds, bridges: [{ atomIndex1: 0, atomIndex2: 7, distance: SS_BOND_LENGTH }],
});
ok(closedBridge === bridged.bonds,
  '⚠ un pont FERMÉ garde sa liaison S–S (le cas ordinaire rend la liste reçue telle quelle, sans même la copier)');
/* LE GESTE, EXÉCUTÉ : la même distance demandée (3 Å, plus courte que le pont), sur les
   deux graphes. Avec la fausse liaison, la molécule ne bouge pas d’un chiffre. */
const driveOn = (bondList) => structureCalculationOf({
  positions: bridged.positions, elements: bridged.elements, bonds: bondList,
  restraints: [{ i: 0, j: 7, target: 3, weight: 1 }],
  starts: 1, keep: 1, anneal: 2, md: 40, minimise: 20,
});
const blockedRun = driveOn(bridged.bonds);
const freedRun = driveOn(engineBonds);
const endSpan = (run) => spanOf({ positions: run.retained[0].positions }, 0, 7);
near(endSpan(blockedRun), bridgeSpan,
  '⚠ …et le calcul ne rapproche RIEN : la distance des deux Sγ ressort telle quelle', 1e-6);
ok(endSpan(freedRun) < endSpan(blockedRun) - 0.2,
  `…alors qu’avec le graphe des moteurs elle DESCEND (${endSpan(blockedRun).toFixed(2)} → ${endSpan(freedRun).toFixed(2)} Å)`);

/* ① bis LES LECTURES DE GÉOMÉTRIE SONT DE VRAIS NOMBRES, ET ILS MESURENT — le contrat
   (une clé qui existe) ne suffisait pas : `bondRms`/`angleRms` étaient annoncés par le
   module et valaient `undefined`, donc `toFixed` mourait dessus. Ces deux-là le prouvent. */
const straightScore = scoreStructureOf({
  positions: hexane.positions, elements: hexane.elements, bonds: hexane.bonds, restraints: [],
});
near(straightScore.bondRms, 0,
  'un hexane aux longueurs de la table ne tend aucune liaison (rms 0)', 1e-6);
const pulled = Array.from(hexane.positions);
pulled[3] += 0.4;                       // un atome tiré de 0.4 Å : les liaisons ne sont plus à la cible
const pulledScore = scoreStructureOf({
  positions: pulled, elements: hexane.elements, bonds: hexane.bonds, restraints: [],
});
ok(pulledScore.bondRms > 0.1,
  `…et une liaison DÉFORMÉE est mesurée (${pulledScore.bondRms.toFixed(4)} Å rms, pire écart ${Number(pulledScore.worstBond.dev).toFixed(3)} Å)`);
ok(Number.isFinite(pulledScore.angleRms) && pulledScore.angleRms > 0,
  `…les angles aussi (${pulledScore.angleRms.toFixed(2)}° rms : c'est ce que le tableau affiche)`);

/* ① LE CONTRAT DU RAPPORT — tout champ que le rapport du 🧬 lit existe dans le classement
   (c'est exactement ce qui manquait : il lisait des champs que `ranking` ne portait pas). */
const reportSrc = VIEW.slice(
  VIEW.indexOf('const calcReportOf = (retained, ranked) => {'),
  VIEW.indexOf('const calcMoleculeKey = (comp, structure) => {'),
);
ok(reportSrc.length > 1000, 'le rapport du 🧬 est lu dans la source du viewer (la tranche existe)');
const reportFields = [...new Set(Array.from(reportSrc.matchAll(/\bbest\.([A-Za-z_$][\w$]*)/g)).map((m) => m[1]))];
ok(reportFields.length >= 12, `…et il lit ${reportFields.length} champs de la meilleure structure`);
const topRow = rankStructureAttempts({ attempts: freedRun.attempts, keep: 1 }).ranking[0];
for (const field of reportFields) {
  ok(Object.prototype.hasOwnProperty.call(topRow, field),
    `⚠ le champ « ${field} », lu par le rapport du 🧬, EXISTE dans le classement (sinon le rapport meurt sur undefined.toFixed)`);
}
ok(Number.isFinite(topRow.bondRms) && Number.isFinite(topRow.angleRms),
  `…et les deux lectures de géométrie sont des NOMBRES (${Number(topRow.bondRms).toFixed(4)} Å · ${Number(topRow.angleRms).toFixed(2)}°)`);
ok(Number.isFinite(topRow.contacts),
  '…« contacts » aussi (le tableau du panneau affiche ce compte à côté des chocs)');
ok(topRow.anneal !== null && topRow.anneal.steps > 0,
  '⚠ …et le RECUIT est transporté : le rapport ne peut plus dire « recuit OFF » sur un recuit qui a tourné');
/* LE GRAPHE DES MOTEURS, DANS LE VIEWER — les QUATRE gestes du champ lisent le même, et
   c'est la fonction du module qui le fabrique (aucun geste ne se bricole un graphe à lui). */
has(VIEW, 'withoutStretchedDisulfideBonds,',
  '⚠ le viewer importe le filtre des ponts étirés (le module du pont, pas une seconde règle)');
has(VIEW, 'const calcEngineGeometry = () => {',
  '…et les gestes du champ lisent un graphe à part (`calcEngineGeometry`)');
has(VIEW, 'bonds: now.geom.bonds, bridges: disulfideDrawnRef.current.bonds,',
  '…fabriqué avec les ponts DESSINÉS de l’écran (un pont étiré perd sa fausse longueur, un pont fermé la garde)');
eq(VIEW.split('calcEngineGeometry();').length - 1, 4,
  '⚠ …et les QUATRE gestes — ▶ Run, ▶ MD, ⚒ Minimise, ⟳ Energy — le lisent (aucun ne garde la molécule brute)');
eq(VIEW.split('const calcEngineGeometry').length - 1, 1,
  'la lecture des moteurs est UNE fonction (pas quatre graphes bricolés)');
has(writeCalc, 'report = calcReportOf(retained, ranked);',
  '⚠ …et le rapport est construit SOUS FILET : une lecture manquante ne jette plus le calcul qui vient de finir');
has(writeCalc, 'setCalcMsg(report);', '…et le résultat est dit au spectateur, succès ou échec de la mise en phrases');

console.log(`_structure_calculation_test.mjs — ${passed} assertions OK (les bornes et les emprunts du module,`
  + ' le lecteur des dièdres EXÉCUTÉ sur une chaîne, un cycle et une double liaison, le tirage REJOUÉ au'
  + ' chiffre près (longueurs et angles intacts, côté ancré bit à bit), le protocole du ⚒ qui rapproche une'
  + ' distance demandée et qui DIT celle qu’il ne peut pas atteindre, la note qui préfère ce qui respecte la'
  + ' contrainte, n départs classés par score croissant avec les m premières GARDÉES, la dispersion de la'
  + ' famille après superposition optimale, et le panneau 🧬 du viewer : les distances, n, m, ▶ Run / ⏹ Stop,'
  + ' le tableau classé, ⤓ Load, et l’écriture par le chemin d’une torsion ; et les deux pannes'
  + ' mesurées de cette session — le rapport du 🧬 qui lisait des champs absents du classement'
  + ' (il en mourait sur undefined.toFixed à la fin de chaque calcul), et le pont disulfure ÉTIRÉ'
  + ' dont la fausse liaison refermait le graphe sur un cycle : sans aucun canal entre les deux'
  + ' Cys, le pont ne pouvait jamais les rapprocher)');
