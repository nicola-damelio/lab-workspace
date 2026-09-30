/* =========================================================================
   _omega_free_test.mjs — 🪢 L'OPTION « ω VARIE » DANS LE CALCUL DE STRUCTURE.

   La demande, mot pour mot : « in the structure calculation allow the option to vary also
   the omega backbone angle. »

   Ce qui doit rester vrai :

     • LE DÉFAUT EST FAUX — `STRUCTURE_CALC_FREE_OMEGA` vaut `false` : un calcul qui ne
       demande rien garde les peptides TRANS, exactement comme avant l'option ;
     • LE PLATEAU EST GARANTI QUAND ELLE EST FAUSSE — exécuté : un ω placé dans le plateau
       (± 30° de 180°) y reste, quelle que soit la force qui tire ailleurs, parce que le
       recuit, la trempe, la dynamique ET la minimisation refusent chacun un pas qui
       augmente son coût ;
     • QUAND ELLE EST VRAIE, C'EST LE CHAMP QUI DÉCIDE — exécuté : la même molécule, avec
       une distance demandée qui ne peut être tenue qu'en tordant ω, voit la descente
       PAYER de la barrière d'ω (le ω sort du plateau, sa pénalité monte) et gagner
       ailleurs (la distance se rapproche, et le coût TOTAL — le champ — BAISSE) ;
     • LE PROTOCOLE ENTIER LE PORTE — `structureAttemptFrames` / `structureCalculationFrames`
       descendent le réglage au recuit, à la trempe, à la dynamique et à la minimisation,
       et chaque moteur le DIT (`omegaFree`) dans son rapport ;
     • LE PANNEAU LA BRANCHE — une case 🪢 « ω varies » dans la rangée des réglages, et le
       MÊME état part au ▶ Run, au ▶ MD et au ⚒ Minimise.

   Run: node _omega_free_test.mjs
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dihedralDeg } from './src/utils/torsionDrive.js';
import {
  STRUCTURE_CALC_FREE_OMEGA, STRUCTURE_CALC_OMEGA, STRUCTURE_CALC_OMEGA_TOLERANCE,
  STRUCTURE_CALC_OMEGA_WEIGHT,
  peptideOmegasOf, rotatableBondsOf, omegaPenaltyOf,
  minimizeTorsionsOf, mdFrames, annealTorsionsOf,
  structureAttemptOf, structureCalculationOf,
} from './src/utils/structureCalc.js';
import { ffOmegaCostOf } from './src/utils/forceFieldKcal.js';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};
const near = (a, b, what, eps = 1e-9) => {
  assert.ok(Math.abs(a - b) <= eps, `${what}\n  attendu ${b}, obtenu ${a}`);
  passed += 1;
};
const has = (src, needle, what) => {
  assert.ok(src.includes(needle), `${what}\n  cherche : ${needle}`);
  passed += 1;
};
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/* ── LE DIPEPTIDE DE SONDE — ω RÈGLÉ AU CHIFFRE PRÈS ─────────────────────────
   Le même constructeur que _ss_dihedral_test.mjs (`placeWith` règle le dièdre MESURÉ par
   `dihedralDeg`) : N · CA · C · O par résidu, et le CA du second résidu posé avec le
   dièdre CA1–C1–N2–CA2 qu'on demande — c'est-à-dire ω. La distance CA1···CA2 est donc une
   FONCTION DE ω (3.802 Å à 180°, 3.063 Å à 60°), ce qui donne une distance demandée
   capable de TIRER ω : c'est la physique que l'option laisse jouer. */
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
  const p = [0, 1, 2].map((k) => c[k] + v[0] * bc[k] + v[1] * m[k] + v[2] * n[k]);
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

/** UN DIPEPTIDE dont on RÈGLE ω (le reste du squelette est celui du feuillet). */
const peptideOf = (omegaDeg) => {
  const els = []; const pts = []; const bonds = [];
  const push = (el, p) => { els.push(el); pts.push(p); return pts.length - 1; };
  const N = [0, 0, 0];
  const CA = [1.46, 0, 0];
  const C = [1.46 + 1.52 * Math.cos((180 - 111) * DEG), 1.52 * Math.sin((180 - 111) * DEG), 0];
  const iN = push('N', N); const iCA = push('C', CA); const iC = push('C', C);
  const iO = push('O', placeWith({ a: N, b: CA, c: C, length: 1.23, angleDeg: 120.5, dihDeg: 135 + 180 }));
  bonds.push({ i: iN, j: iCA, order: 1 }, { i: iCA, j: iC, order: 1 }, { i: iC, j: iO, order: 2 });
  const n2 = placeWith({ a: N, b: CA, c: C, length: 1.33, angleDeg: 116, dihDeg: 135 });
  const iN2 = push('N', n2);
  const ca2 = placeWith({ a: CA, b: C, c: n2, length: 1.46, angleDeg: 122, dihDeg: omegaDeg });
  const iCA2 = push('C', ca2);
  const c2 = placeWith({ a: C, b: n2, c: ca2, length: 1.52, angleDeg: 111, dihDeg: -139 });
  const iC2 = push('C', c2);
  const iO2 = push('O', placeWith({ a: n2, b: ca2, c: c2, length: 1.23, angleDeg: 120.5, dihDeg: 135 + 180 }));
  bonds.push({ i: iC, j: iN2, order: 1 }, { i: iN2, j: iCA2, order: 1 },
    { i: iCA2, j: iC2, order: 1 }, { i: iC2, j: iO2, order: 2 });
  return {
    count: els.length, elements: els, bonds, positions: pts.flat(),
    CA1: iCA, CA2: iCA2, C1: iC, N2: iN2,
  };
};
const gapOf = (positions, i, j) => Math.hypot(
  positions[i * 3] - positions[j * 3],
  positions[i * 3 + 1] - positions[j * 3 + 1],
  positions[i * 3 + 2] - positions[j * 3 + 2],
);

/* LA SONDE — ω = 180° (trans, PILE au milieu du plateau), un seul ω lisible, et le canal
   rotatif de la liaison peptidique (C1–N2), le SEUL que les moteurs ont le droit de tourner
   ici : la démonstration porte donc sur ω, et sur rien d'autre. */
const MOL = peptideOf(180);
const OMEGAS = peptideOmegasOf({ elements: MOL.elements, bonds: MOL.bonds, atomCount: MOL.count });
const OMEGA_CHANNELS = rotatableBondsOf({ elements: MOL.elements, bonds: MOL.bonds, atomCount: MOL.count })
  .channels.filter((ch) => (ch.i === MOL.C1 && ch.j === MOL.N2) || (ch.j === MOL.C1 && ch.i === MOL.N2));
/* LA DISTANCE DEMANDÉE — celle de ω = 60° : CA1···CA2 y vaut 3.063 Å contre 3.802 Å à trans,
   donc la tenir oblige à TORDRE ω, précisément ce que le défaut interdit. */
const CA_TARGET = gapOf(peptideOf(60).positions, MOL.CA1, MOL.CA2);
const RESTRAINTS = [{ i: MOL.CA1, j: MOL.CA2, target: CA_TARGET }];
const BASE = {
  positions: MOL.positions, elements: MOL.elements, bonds: MOL.bonds,
  restraints: RESTRAINTS, channels: OMEGA_CHANNELS,
};
const omegaOf = (positions) => omegaPenaltyOf({ positions, omegas: OMEGAS });
const distOf = (positions) => gapOf(positions, MOL.CA1, MOL.CA2);
const mdRunOf = (spec) => {
  const frames = mdFrames(spec);
  let next = frames.next();
  while (!next.done) next = frames.next();
  return next.value;
};
/* LA SONDE DE LA DYNAMIQUE — le MÊME dipeptide, mais posé AU BORD du plateau (ω = 150°). Un
   pas de dynamique vaut 4° au plus sur cette liaison : depuis 180°, 3000 pas ne suffisent pas
   à en sortir même sans protection (mesuré) ; depuis le bord, la même trajectoire le fait. La
   règle protégée, elle, doit tenir dans les deux cas. */
const MOL_EDGE = peptideOf(150);
const omegaChannelOf = (m) => rotatableBondsOf({ elements: m.elements, bonds: m.bonds, atomCount: m.count })
  .channels.filter((ch) => (ch.i === m.C1 && ch.j === m.N2) || (ch.j === m.C1 && ch.i === m.N2));
const EDGE_BASE = {
  positions: MOL_EDGE.positions, elements: MOL_EDGE.elements, bonds: MOL_EDGE.bonds,
  restraints: [{ i: MOL_EDGE.CA1, j: MOL_EDGE.CA2, target: CA_TARGET }],
  channels: omegaChannelOf(MOL_EDGE),
};

/* ════════════ 0. LA SONDE ELLE-MÊME — ce sur quoi tout porte ═══════════════ */
eq(MOL.count, 8, 'la sonde est un dipeptide de huit atomes lourds (N, CA, C, O × 2)');
eq(OMEGAS.length, 1, '…avec UNE liaison peptidique, donc UN ω');
near(dihedralDeg(...OMEGAS[0].probeAtoms.map((k) => [MOL.positions[k * 3], MOL.positions[k * 3 + 1],
  MOL.positions[k * 3 + 2]])), STRUCTURE_CALC_OMEGA, '…posé PILE à trans (180°)');
eq(OMEGA_CHANNELS.length, 1, 'un seul canal rotatif peut le tourner : la liaison C1–N2');
near(distOf(peptideOf(60).positions), CA_TARGET, 'la cible est bien la distance CA1···CA2 de ω = 60°');
ok(CA_TARGET < distOf(MOL.positions) - 0.7,
  `…et elle est HORS D'ATTEINTE de trans : ${CA_TARGET.toFixed(3)} Å contre`
  + ` ${distOf(MOL.positions).toFixed(3)} Å au départ`);

/* ════════════ 1. L'OPTION EXISTE, ET SON DÉFAUT EST FAUX ════════════════════ */
const MODULE = read('./src/utils/structureCalc.js');
eq(STRUCTURE_CALC_FREE_OMEGA, false,
  '⚠ `STRUCTURE_CALC_FREE_OMEGA` vaut FAUX : qui ne demande rien garde les peptides TRANS');
has(MODULE, 'export const STRUCTURE_CALC_FREE_OMEGA = false;',
  '…et le module le dit à côté des constantes du protocole');
eq((MODULE.match(/freeOmega = STRUCTURE_CALC_FREE_OMEGA,/g) || []).length, 4,
  '⚠ LES QUATRE fonctions qui reçoivent le réglage le prennent au défaut du module'
  + ' (recuit, dynamique, minimisation, et un départ)');
has(MODULE, 'if (protectOmega && !freeOmega', 'le RECUIT lâche sa protection de ω avec l’option');
has(MODULE, 'if (isPeptideCh && !freeOmega) {',
  '⚠ …la DYNAMIQUE lâche la sienne sur ce canal-là (c’est elle qui refusait le pas qui abîme ω)');
has(MODULE, 'if (!freeOmega && omegaBond.has(omegaKey)) {',
  '…et la MINIMISATION aussi (le pas est alors jugé sur le coût local entier)');
has(MODULE, 'protectOmega: true,\n      freeOmega,',
  'un DÉPART passe l’option à son recuit — et garde `protectOmega: true`, que l’option neutralise');
has(MODULE, 'leash: clean.list, protectOmega: true,\n      /* 🪢 La trempe',
  '…et à sa TREMPE : avec l’option, la trempe non plus ne protège plus ω');
has(MODULE, 'freeOmega,\n  });\n  let mdRun = null;',
  '…et à la DYNAMIQUE et à la MINIMISATION de chaque départ (le même objet `motionOf`)');
has(MODULE, 'omegaFree: !!freeOmega,',
  'chaque moteur DIT le réglage qu’il a suivi (`omegaFree`) — un rapport qui le taît ne se relit pas');

/* ════════════ 2. LE PLATEAU, QUAND L'OPTION EST FAUSSE ══════════════════════
   La règle est DURE : le pas qui augmente le coût d'ω est REFUSÉ. Un ω posé à 180° (trans) ne
   peut donc pas quitter le plateau de ± 30°, quelle que soit la force qui tire ailleurs — ici
   une distance demandée à 3.063 Å, que trans ne peut pas tenir (3.802 Å). */
const minHeld = minimizeTorsionsOf({ ...BASE, rounds: 6 });
const mdHeld = mdRunOf({ ...EDGE_BASE, steps: 6000, temperature: 3000 });
const annealHeld = annealTorsionsOf({
  ...BASE, steps: 4, hot: 3000, cold: 3000, moves: 24, protectOmega: true,
});
eq(minHeld.omegaFree, false, 'la minimisation sans l’option dit `omegaFree: false`');
eq(mdHeld.omegaFree, false, 'la dynamique sans l’option aussi');
eq(annealHeld.omegaFree, false, 'le recuit protégé aussi');
near(minHeld.omega.penalty, 0, '⚠ la descente GARDE ω dans le plateau : sa pénalité reste NULLE');
eq(minHeld.omega.violations, 0, '…aucun ω hors du plateau (le plateau va jusqu’à ± '
  + `${STRUCTURE_CALC_OMEGA_TOLERANCE}° de ${STRUCTURE_CALC_OMEGA}°)`);
near(minHeld.omega.list[0].over, 0,
  '…donc `over` = 0 : le ω s’arrête AU BORD du plateau, jamais au-delà');
near(mdHeld.omega.penalty, 0,
  '⚠ la DYNAMIQUE non plus ne l’en sort — 6000 pas à 3000 K, et la pénalité d’ω reste NULLE');
near(annealHeld.omega.penalty, 0, '…ni le recuit sous `protectOmega` (3000 K, 96 pas)');
ok(distOf(minHeld.positions) > CA_TARGET + 0.5,
  `…et la distance demandée reste LOIN : ${distOf(minHeld.positions).toFixed(3)} Å pour une cible de`
  + ` ${CA_TARGET.toFixed(3)} Å — c’est le prix du peptide trans`);

/* ════════════ 3. ω VARIE, QUAND LA CASE EST COCHÉE (EXÉCUTÉ) ════════════════
   La MÊME molécule, la MÊME distance demandée, les MÊMES moteurs : seul le réglage change. Ce
   qui doit se voir, c'est le TRADE — le champ paie de la barrière d'ω et gagne plus ailleurs
   (elle vaut k·(1 − cos 2·over)/2, donc 0.87 kcal/mol à 12° hors du plateau, 20 au maximum :
   c'est un PRIX, pas un mur). */
const minFree = minimizeTorsionsOf({ ...BASE, rounds: 6, freeOmega: true });
const mdFree = mdRunOf({ ...EDGE_BASE, steps: 6000, temperature: 3000, freeOmega: true });
const annealFree = annealTorsionsOf({
  ...BASE, steps: 4, hot: 3000, cold: 3000, moves: 24, protectOmega: true, freeOmega: true,
});
eq(minFree.omegaFree, true, 'la minimisation AVEC l’option dit `omegaFree: true`');
eq(mdFree.omegaFree, true, '…la dynamique aussi');
eq(annealFree.omegaFree, true, '…le recuit aussi');
ok(minFree.omega.violations > 0,
  `⚠ LA DESCENTE SORT ω DU PLATEAU : ${minFree.omega.list[0].deg.toFixed(2)}°, soit`
  + ` ${minFree.omega.list[0].over.toFixed(1)}° au-delà de ± ${STRUCTURE_CALC_OMEGA_TOLERANCE}° de trans`);
ok(minFree.omega.penalty > 0,
  `…et elle PAIE la barrière : ${minFree.omega.penalty.toFixed(2)} kcal/mol (la fonction du champ,`
  + ` k = ${STRUCTURE_CALC_OMEGA_WEIGHT}, en donne ${ffOmegaCostOf(minFree.omega.list[0].deg).toFixed(2)})`);
ok(distOf(minFree.positions) < distOf(minHeld.positions) - 0.1,
  `…la distance demandée se RAPPROCHE (${distOf(minFree.positions).toFixed(3)} Å contre`
  + ` ${distOf(minHeld.positions).toFixed(3)} Å protégé, cible ${CA_TARGET.toFixed(3)} Å)`);
ok(minFree.cost.after < minHeld.cost.after - 1,
  `⚠ ET LE COÛT TOTAL BAISSE : ${minFree.cost.after.toFixed(2)} contre ${minHeld.cost.after.toFixed(2)}`
  + ' kcal/mol — c’est le champ, donc la note, qui préfère ce ω-là');
ok(mdFree.omega.penalty > 0,
  '⚠ la DYNAMIQUE AUSSI franchit le bord du plateau quand l’option est là'
  + ` (${mdFree.omega.list[0].deg.toFixed(2)}°, pénalité ${mdFree.omega.penalty.toFixed(2)})`);
ok(annealFree.accepted > annealHeld.accepted,
  `…et le RECUIT accepte plus de pas : ${annealFree.accepted}/${annealFree.tried} contre`
  + ` ${annealHeld.accepted}/${annealHeld.tried} — le refus qui manquait est exactement celui d’ω`);

/* ════════════ 4. LE PROTOCOLE ENTIER PORTE LE RÉGLAGE ══════════════════════
   « in the structure calculation » — c'est le CALCUL qui doit l'avoir, pas seulement les trois
   moteurs : un départ le descend à son recuit, sa trempe, sa dynamique et sa minimisation, et
   `structureCalculationFrames` (donc ▶ Run) le descend au départ. Le protocole tourne sur la
   MÊME sonde et la MÊME distance demandée : la seule différence est la case. */
const attemptHeld = structureAttemptOf({
  positions: MOL.positions, elements: MOL.elements, bonds: MOL.bonds, restraints: RESTRAINTS,
  index: 0, draw: false, anneal: 6, md: 600, minimise: 6, quench: true,
});
const attemptFree = structureAttemptOf({
  positions: MOL.positions, elements: MOL.elements, bonds: MOL.bonds, restraints: RESTRAINTS,
  index: 0, draw: false, anneal: 6, md: 600, minimise: 6, quench: true, freeOmega: true,
});
eq(attemptHeld.omegaFree, false, 'un DÉPART sans l’option le dit (`omegaFree: false`)');
eq(attemptFree.omegaFree, true, '…et avec elle aussi (`omegaFree: true`)');
eq(attemptHeld.protocol.stages.map((s) => s.name),
  ['anneal', 'equilibrate', 'cool', 'minimise', 'quench'],
  '⚠ le protocole est bien celui qu’on croit : recuit, équilibration, refroidissement,'
  + ' minimisation, trempe');
near(omegaOf(attemptHeld.positions).penalty, 0,
  '⚠ LE PROTÉGÉ FINIT TRANS : la pénalité d’ω du modèle est NULLE après les cinq étapes');
ok(omegaOf(attemptFree.positions).penalty > 0,
  `…LE LIBRE, NON : ${omegaOf(attemptFree.positions).penalty.toFixed(2)} kcal/mol de barrière d’ω payés`
  + ` (ω = ${omegaOf(attemptFree.positions).list[0].deg.toFixed(1)}°)`);
ok(distOf(attemptFree.positions) < distOf(attemptHeld.positions) - 0.1,
  `…et il tient mieux la distance demandée (${distOf(attemptFree.positions).toFixed(3)} Å contre`
  + ` ${distOf(attemptHeld.positions).toFixed(3)} Å)`);
ok(attemptFree.score < attemptHeld.score,
  `⚠ SON SCORE EST MEILLEUR : ${attemptFree.score.toFixed(2)} contre ${attemptHeld.score.toFixed(2)} —`
  + ' laisser ω varier a bien servi le champ, et c’est exactement ce que la case promet');
/* …ET LA TRANCHE DE CALCUL (`structureCalculationFrames`, le moteur du ▶ Run) LE DESCEND AUSSI. */
for (const freeOmega of [false, true]) {
  const run = structureCalculationOf({
    positions: MOL.positions, elements: MOL.elements, bonds: MOL.bonds, restraints: RESTRAINTS,
    starts: 2, keep: 1, draw: false, anneal: 0, md: 0, minimise: 1, quench: false, freeOmega,
  });
  eq(run.attempts.map((a) => a.omegaFree), [freeOmega, freeOmega],
    `les ${run.attempts.length} départs du calcul portent \`freeOmega: ${freeOmega}\` (via \`...rest\`)`);
  eq(run.ok, true, '…et le calcul aboutit dans les deux cas');
}

/* ════════════ 5. LE PANNEAU LA BRANCHE — UN SEUL ÉTAT ═══════════════════════ */
const VIEWER = read('./src/components/NMRMoleculeViewer.jsx');
has(VIEWER, 'STRUCTURE_CALC_FREE_OMEGA,',
  'le panneau importe le défaut du module (aucun chiffre écrit dans le JSX)');
has(VIEWER, 'const [calcOmegaFree, setCalcOmegaFree] = useState(STRUCTURE_CALC_FREE_OMEGA);',
  '⚠ UN ÉTAT, et son défaut vient du module');
eq((VIEWER.match(/freeOmega: calcOmegaFree/g) || []).length, 3,
  '⚠ le MÊME réglage part au ▶ Run, au ▶ MD et au ⚒ Minimise (trois appels, un seul état)');
has(VIEWER, 'checked={calcOmegaFree} onChange={(e) => setCalcOmegaFree(e.target.checked)}',
  '…et il se coche dans la rangée des réglages du 🧬');
has(VIEWER, '🪢 ω varies', 'la case est nommée 🪢 « ω varies »');
has(VIEWER, 'aria-label="Let the peptide ω dihedral vary"', '…avec son étiquette pour les lecteurs d’écran');
has(VIEWER, 'best.omegaFree', 'le rapport du calcul DIT avec quel réglage la famille a été calculée');
has(VIEWER, 'run.omegaFree', '…les rapports du ▶ MD et du ⚒ Minimise aussi');

console.log(`_omega_free_test.mjs — ${passed} assertions OK (l'option 🪢 « ω varie » : son défaut FAUX,`
  + ' les trois moteurs qui lâchent chacun leur protection, le plateau GARANTI quand elle est fausse,'
  + ' le TRADE exécuté quand elle est vraie — ω sort du plateau, paie sa barrière, la distance se'
  + ' rapproche et le coût TOTAL baisse —, le protocole entier du calcul de structure qui la porte,'
  + ' et le panneau qui la branche sur ▶ Run, ▶ MD et ⚒ Minimise)')
;



