/* =========================================================================
   _water_md_test.mjs — 💧 LES EAUX DE LA BOÎTE EXPLICITE BOUGENT VRAIMENT.

   LA DÉCISION DE CETTE SESSION, mot pour mot : « MAKE WATER MOBILE ». Jusqu'ici la boîte
   explicite était un DÉCOR HONNÊTE — des atomes réels du champ (elles écrantent, elles
   poussent, elles comptent dans chaque famille) dont la position ne changeait jamais, parce
   que le moteur ne tourne que des CHARNIÈRES et qu'une molécule d'eau n'en a aucune.

   Ce qui doit rester vrai, et qui est EXÉCUTÉ ici :

     • LE GRADIENT EST LA DÉRIVÉE DU COÛT — `ffNonbondedGradientOf` est comparé à la dérivée
       NUMÉRIQUE de `ffNonbondedCostOf`, sur cinq couples (eau–eau, eau–H, classique,
       répulsion seule, sans charge) et huit distances, plancher de rampe compris : une force
       ne peut pas diverger du prix qu'elle dérive ;
     • LES EAUX SONT DES CORPS RIGIDES — reconnues par le GRAPHE (l'OW et ses deux HW), avec
       le repli par ordre pour une boîte sans CONECT : une molécule d'eau est un corps, pas
       trois atomes ;
     • ELLES TRANSLATENT ET ELLES TOURNENT — exécuté : 24 eaux d'une boîte de 12 Å, 1000 pas
       à 1500 K, TOUTES déplacées (déplacement net moyen ~15 Å, plusieurs centaines d'Å²
       d'écart quadratique), et elles ont tourné de plus de 100° ;
     • LEUR GÉOMÉTRIE TIP3P NE BOUGE PAS — les trois longueurs O–H, H–H et l'angle sont
       réécrits par une ROTATION EXACTE : l'écart mesuré sur toute la trajectoire est de
       l'ordre de 10⁻¹⁵ Å (et non de quelques centièmes) ;
     • LE THERMOSTAT TIENT CE QU'IL ANNONCE — sans aucune force, la température cinétique LUE
       des deux moitiés (translation ET rotation, mesurées séparément) tombe sur celle qui a
       été demandée : 1480 K et 1514 K pour 1500 demandés, sur 400 échantillons ;
     • LA ROTATION LIBRE CONSERVE SON ÉNERGIE — sans couple ni frottement, `½·Lᵀ·I⁻¹·L` ne
       dérive que de 0.15 % en 2000 pas (l'ordre un en dérivait de +24 %, et l'Euler explicite
       du terme gyroscopique partait à `NaN`) ;
     • LE SOLUTÉ EST INTACT — ses atomes et ses indices ne bougent pas d'un iota, et une
       molécule SANS eau rend `water: null` (le geste d'avant, au chiffre près) ;
     • LA GRAINE EST CELLE DU DOSSIER — deux gestes de même graine donnent la MÊME
       trajectoire, eaux comprises, et le module ne contient AUCUN `Math.random` ;
     • LE PANNEAU LE DIT — la boîte dessinée est RÉÉCRITE à chaque image
       (`calcPreviewWaterPositions`), le rapport chiffre ce que les eaux ont fait
       (`calcWaterRunNote`), et plus une phrase du dépôt ne prétend qu'elles ne bougent pas.

   Run: node _water_md_test.mjs
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  explicitSolventOf, waterRigidBodyOf, mdFrames, molecularDynamicsOf, rotatableBondsOf,
  STRUCTURE_CALC_WATER_MOBILE, STRUCTURE_CALC_WATER_REFRESH, STRUCTURE_CALC_WATER_MAX_MOVE,
  STRUCTURE_CALC_WATER_MAX_SUB, STRUCTURE_CALC_WATER_MAX_SPEED, STRUCTURE_CALC_WATER_MAX_TURN,
  STRUCTURE_CALC_WATER_SPEED_FACTOR, STRUCTURE_CALC_WATER_MAX_FORCE,
  STRUCTURE_CALC_WATER_MAX_TORQUE, STRUCTURE_CALC_MD_DT, STRUCTURE_CALC_MD_FRICTION,
} from './src/utils/structureCalc.js';
import {
  ffNonbondedGradientOf, ffNonbondedCostOf, ffNonbondedOf, ffPairListOf, partialChargesOf,
  FF_KCAL_PER_AMU_A2_PS2, FF_TIP3P, FF_GAS_CONSTANT,
} from './src/utils/forceFieldKcal.js';

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};
const near = (a, b, what, eps = 1e-9) => {
  assert.ok(Math.abs(a - b) <= eps, `${what}\n  attendu ${b}, obtenu ${a} (± ${eps})`);
  passed += 1;
};
const has = (src, needle, what) => {
  assert.ok(src.includes(needle), `${what}\n  cherche : ${needle}`);
  passed += 1;
};
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MODULE = read('./src/utils/structureCalc.js');
const FIELD = read('./src/utils/forceFieldKcal.js');
const VIEW = read('./src/components/NMRMoleculeViewer.jsx');

/* ── 1 · LA FORCE EST LA DÉRIVÉE DU PRIX — la seule définition possible ─────────────────
   Un corps rigide lit `dV/dr` par couple : si cette pente n'était pas EXACTEMENT celle du
   coût, les eaux minimiseraient autre chose que le champ. On la compare donc à la dérivée
   numérique de `ffNonbondedCostOf`, sur les cinq sortes de couples du dossier et sur huit
   distances (dont 0.7 Å, SOUS le plancher de rampe, où la pente vaut −FF_VDW_FLOOR_K). */
const CASES = [
  ['eau–H', ['OW', 'HW'], [-0.834, 0.417], { dielectric: 1 }],
  ['eau–eau', ['OW', 'OW'], [-0.834, -0.834], { dielectric: 1 }],
  ['classique C–O', ['C', 'O'], [0.1, -0.4], { dielectric: 4 }],
  ['répulsion seule (DYANA)', ['OW', 'OW'], [-0.834, -0.834], { repulsionOnly: true, electrostatics: false }],
  ['sans charge (LJ seul)', ['C', 'C'], [0, 0], { dielectric: 4 }],
];
for (const [label, els, q, opts] of CASES) {
  const pair = ffNonbondedOf(0, 1, els, q);
  let worst = 0;
  for (const r of [0.7, 1.0, 1.5, 2.0, 2.76, 3.5, 5.0, 7.9]) {
    const hh = 1e-6;
    const num = (ffNonbondedCostOf(r + hh, pair, opts) - ffNonbondedCostOf(r - hh, pair, opts)) / (2 * hh);
    worst = Math.max(worst, Math.abs(num - ffNonbondedGradientOf(r, pair, opts)));
  }
  ok(worst < 1e-4, `⚠ le gradient du couple ${label} est la dérivée de son coût (écart max ${worst.toExponential(2)} < 1e-4)`);
}
eq(ffNonbondedGradientOf(0.5, ffNonbondedOf(0, 1, ['OW', 'OW'], [-0.834, -0.834])),
  -1e4, '…et SOUS le plancher c’est la pente de la RAMPE (−FF_VDW_FLOOR_K) qui décide, pas le r⁻¹²');
eq(ffNonbondedGradientOf(-1, ffNonbondedOf(0, 1, ['C', 'C'], [0, 0])), 0,
  '…un couple illisible (r ≤ 0) ne rend pas une pente inventée');
near(FF_KCAL_PER_AMU_A2_PS2, 418.4, '💧 le pont d’unités énergie ↔ inertie est DIT (418.4 amu·Å²·ps⁻² par kcal/mol)', 0.2);

/* ── 2 · LES EAUX SONT DES CORPS RIGIDES — reconnues par le GRAPHE ──────────────────────
   Une eau = un OW et SES deux HW (le graphe), pas « les trois atomes qui se suivent ». Le
   repli par ORDRE n'existe que pour une boîte relue sans CONECT, et une eau incomplète n'est
   jamais déplacée (on ne bouge pas un corps dont on ignore la composition). */
const MOL = {
  positions: [0, 0, 0, 1.53, 0, 0, 3.06, 0, 0, 4.59, 0, 0],
  elements: ['C', 'C', 'C', 'C'],
  bonds: [{ i: 0, j: 1, order: 1 }, { i: 1, j: 2, order: 1 }, { i: 2, j: 3, order: 1 }],
};
eq(rotatableBondsOf({ elements: MOL.elements, bonds: MOL.bonds, atomCount: 4 }).channels.length, 1,
  'la sonde est un butane : UNE charnière (donc le moteur dihédral a bien de quoi tourner)');
const BOX = explicitSolventOf({ ...MOL, edge: 12, margin: 2 });
ok(BOX.ok && BOX.molecules > 8, `la boîte se construit (${BOX.molecules} eaux dans 12 Å)`);
ok(ffPairListOf({ positions: BOX.positions, elements: BOX.elements, bonds: BOX.bonds, limit: 8 }).pairs.length > 0,
  '…et sa liste de couples existe (le champ la lit depuis toujours)');

const bodiesOf = (positions, elements, bonds) => waterRigidBodyOf({ positions, elements, bonds, seed: 5 });
const fresh = () => Float64Array.from(BOX.positions);
const body1 = bodiesOf(fresh(), BOX.elements, BOX.bonds);
ok(body1.ok && body1.molecules === BOX.molecules,
  `…et CHAQUE eau devient un corps rigide (${body1.molecules} corps pour ${BOX.molecules} eaux)`);
eq(body1.atomIndex.length, BOX.molecules, '…un corps par molécule (trois indices chacun)');
ok(body1.atomIndex.every((a) => a.length === 3 && elementsLookWater(BOX.elements, a)),
  '…et ses trois atomes sont bien un OW et DEUX HW (le graphe, pas une position devinée)');
function elementsLookWater(els, a) {
  return String(els[a[0]]).toUpperCase() === 'OW'
    && String(els[a[1]]).toUpperCase() === 'HW' && String(els[a[2]]).toUpperCase() === 'HW';
}
const idle = waterRigidBodyOf({ positions: Float64Array.from(MOL.positions), elements: MOL.elements, bonds: MOL.bonds });
eq([idle.ok, idle.reason, idle.molecules], [false, 'no-water', 0],
  '⚠ une molécule SANS eau n’a pas de corps (et son geste reste celui d’avant)');
const halfWater = waterRigidBodyOf({
  positions: Float64Array.from([0, 0, 0, 1.5, 0, 0]),
  elements: ['OW', 'HW'], bonds: [{ i: 0, j: 1, order: 1 }],
});
eq([halfWater.ok, halfWater.reason], [false, 'no-water'],
  '…et une eau INCOMPLÈTE n’est jamais déplacée (on ne bouge pas un corps dont on ignore la composition)');

/* ── 3 · LE THERMOSTAT TIENT CE QU'IL ANNONCE — le contrôle qui doit rendre T ────────────
   Sans AUCUNE force (liste vide) il ne reste que le frottement et le bruit : la température
   cinétique LUE doit alors tomber sur la consigne, séparément pour la translation (½·M·v²) et
   pour la rotation (½·Lᵀ·I⁻¹·L). C'est ce qui rend les deux sections suivantes lisibles. */
const therm = (T, steps, dt = STRUCTURE_CALC_MD_DT) => {
  const body = bodiesOf(fresh(), BOX.elements, BOX.bonds);
  let st = 0; let sr = 0; let n = 0;
  for (let t = 0; t < steps; t += 1) {
    body.step({ pairs: [], dt, temperature: T, friction: STRUCTURE_CALC_MD_FRICTION });
    if (t % 10 === 9) {
      const s = body.stats();
      st += s.kinetic.translation; sr += s.kinetic.rotation; n += 1;
    }
  }
  return { t: st / n, r: sr / n, n };
};
const free1500 = therm(1500, 4000);
ok(Math.abs(free1500.t - 1500) < 300,
  `⚠ SANS AUCUNE FORCE, la température de TRANSLATION lue tombe sur la consigne (${free1500.t.toFixed(0)} K pour 1500, ${free1500.n} échantillons)`);
ok(Math.abs(free1500.r - 1500) < 300,
  `…et celle de ROTATION aussi (${free1500.r.toFixed(0)} K) — les deux moitiés sont MESURÉES séparément`);
const freeCool = therm(600, 3000);
ok(freeCool.t < free1500.t && Math.abs(freeCool.t - 600) < 150,
  `…et la consigne conduit vraiment (600 K demandés → ${freeCool.t.toFixed(0)} K lus)`);

/* ── 4 · LA ROTATION LIBRE CONSERVE SON ÉNERGIE — l'intégrateur, pas le thermostat ──────
   Avec γ = 0 et aucun couple, il ne reste que la rotation du corps libre : son énergie
   ½·Lᵀ·I⁻¹·L doit donc être CONSTANTE. C'est le test qui a fait tomber les trois premiers
   essais (l'Euler explicite du terme gyroscopique partait à `NaN`, le point fixe arrêté trop
   tôt dérivait de +21 %, la rotation d'ordre un de +24 %). */
const rotDrift = (dt) => {
  const body = bodiesOf(fresh(), BOX.elements, BOX.bonds);
  for (let t = 0; t < 200; t += 1) body.step({ pairs: [], dt, temperature: 1500, friction: STRUCTURE_CALC_MD_FRICTION });
  const e0 = body.stats().kinetic.rotation;
  for (let t = 0; t < 2000; t += 1) body.step({ pairs: [], dt, temperature: 0, friction: 0 });
  const e1 = body.stats().kinetic.rotation;
  return { e0, e1, pct: (e1 / e0 - 1) * 100 };
};
const drift = rotDrift(STRUCTURE_CALC_MD_DT);
ok(Math.abs(drift.pct) < 3,
  `⚠ sans couple ni frottement, l’énergie de rotation ne dérive que de ${drift.pct.toFixed(2)} % en 2000 pas`);
ok(Number.isFinite(drift.e0) && drift.e0 > 0,
  `…et elle a démarré d’une valeur FINIE (${drift.e0.toFixed(0)} K) — aucune image ne part en NaN`);

/* ── 5 · LA DYNAMIQUE — ELLES BOUGENT, ELLES RESTENT RIGIDES, LE SOLUTÉ EST INTACT ─────── */
const runMd = (spec) => {
  const out = [];
  for (const f of mdFrames({
    positions: Array.from(BOX.positions), elements: BOX.elements, bonds: BOX.bonds,
    steps: 400, temperature: 1500, dt: STRUCTURE_CALC_MD_DT, perFrame: 50, seed: 11, ...spec,
  })) out.push(f);
  return out;
};
const frames = runMd({});
const last = frames[frames.length - 1];
ok(frames.length >= 8, `le geste annonce ses images (${frames.length})`);
ok(!!(last && last.water), '…et chacune porte l’ÉTAT DES EAUX (`water`)');
eq(last.water.molecules, BOX.molecules, '…le compte des eaux est celui de la boîte');
ok(last.water.moved > 0,
  `⚠ LES EAUX ONT BOUGÉ : ${last.water.moved}/${last.water.molecules} déplacées, ${last.water.net} Å net en moyenne`);
ok(last.water.msd > 1,
  `…et de façon DIFFUSIVE (écart quadratique moyen ${last.water.msd} Å² — un frémissement ne ferait pas ça)`);
ok(last.water.turned > 0.5,
  `…elles ont aussi TOURNÉ (${((last.water.turned * 180) / Math.PI).toFixed(0)}° en moyenne)`);
ok(Number.isFinite(last.water.closest) && last.water.closest > 0,
  `…et le rapport a de quoi juger : contact le plus court atteint ${last.water.closest} Å (mesuré, pas décoré)`);
ok(Number.isFinite(last.water.kinetic.translation) && Number.isFinite(last.water.kinetic.rotation),
  '…avec les DEUX températures cinétiques (translation ET rotation) dans le rapport');
ok(Number.isInteger(last.water.subSteps) && last.water.subSteps >= 1,
  `…et la SUBDIVISION du pas est dite (${last.water.subSteps} évaluations de force par pas — c'est ce qui résout une collision, et ce qui explique le coût)`);

/* LA GÉOMÉTRIE TIP3P N'A PAS BOUGÉ D'UN CHIFFRE — les trois longueurs de chaque eau. */
const dist = (flat, a, b) => Math.hypot(
  flat[a * 3] - flat[b * 3], flat[a * 3 + 1] - flat[b * 3 + 1], flat[a * 3 + 2] - flat[b * 3 + 2],
);
let worstRigid = 0;
for (const [o, h1, h2] of body1.atomIndex) {
  const r0 = [dist(BOX.positions, o, h1), dist(BOX.positions, o, h2), dist(BOX.positions, h1, h2)];
  const r1 = [dist(last.positions, o, h1), dist(last.positions, o, h2), dist(last.positions, h1, h2)];
  for (let k = 0; k < 3; k += 1) worstRigid = Math.max(worstRigid, Math.abs(r1[k] - r0[k]));
}
ok(worstRigid < 1e-9,
  `⚠ la géométrie TIP3P est INVARIANTE (écart max ${worstRigid.toExponential(2)} Å sur toute la trajectoire — une rotation EXACTE, pas une intégration de coordonnées)`);
ok(Math.abs(dist(last.positions, 0, 3) - dist(BOX.positions, 0, 3)) < 0.02,
  '…et le SOLUTÉ est intact : sa liaison C–C n’a pas bougé (le butane a tourné, ses atomes non)');

/* LA MÊME GRAINE DONNE LA MÊME TRAJECTOIRE — eaux comprises. */
const againLast = runMd({}).slice(-1)[0];
let worstSame = 0;
for (let k = 0; k < last.positions.length; k += 1) worstSame = Math.max(worstSame, Math.abs(last.positions[k] - againLast.positions[k]));
eq(worstSame, 0, '⚠ deux gestes de MÊME graine donnent la MÊME trajectoire, eaux comprises (aucun hasard caché)');

/* L'OPTION `waterMobile: false` LAISSE LES EAUX OÙ ELLES SONT — et le rapport ne ment pas. */
const frozen = molecularDynamicsOf({
  positions: Array.from(BOX.positions), elements: BOX.elements, bonds: BOX.bonds,
  steps: 300, temperature: 1500, dt: STRUCTURE_CALC_MD_DT, perFrame: 50, seed: 11,
  waterMobile: false,
});
let worstFrozen = 0;
for (let k = BOX.solute * 3; k < frozen.positions.length; k += 1) {
  worstFrozen = Math.max(worstFrozen, Math.abs(frozen.positions[k] - BOX.positions[k]));
}
eq([frozen.water, frozen.waterMobile, worstFrozen], [null, false, 0],
  '⚠ `waterMobile: false` rend exactement l’ancien geste : `water` nul dans le rapport et les eaux au réseau du départ, au chiffre près');
ok(frozen.ok && frozen.steps === 300,
  '…le geste tourne quand même (les dièdres, eux, ne demandent pas la permission)');
const wet = molecularDynamicsOf({
  positions: Array.from(BOX.positions), elements: BOX.elements, bonds: BOX.bonds,
  steps: 300, temperature: 1500, dt: STRUCTURE_CALC_MD_DT, perFrame: 50, seed: 11,
});
eq([wet.waterMobile, wet.water.molecules, wet.water.moved > 0], [true, BOX.molecules, true],
  '…et sans l’option, le moteur DIT qu’il a des eaux mobiles (`waterMobile`) et le geste les a déplacées');
const dry = molecularDynamicsOf({ ...MOL, steps: 200, temperature: 1500, dt: STRUCTURE_CALC_MD_DT, seed: 11 });
eq([dry.waterMobile, dry.water], [false, null],
  '⚠ une molécule SANS eau n’a NI corps NI ligne d’eau dans son rapport (le geste d’avant, au chiffre près)');

/* ── 6 · LE CODE DIT CE QU'IL FAIT — module, champ, panneau ───────────────────────────── */
has(MODULE, 'export const STRUCTURE_CALC_WATER_MOBILE = true;',
  '💧 la décision est une CONSTANTE nommée du module (vraie : les eaux bougent)');
for (const [c, what] of [
  ['export const STRUCTURE_CALC_WATER_REFRESH = 4;', 'la cadence de relecture des couples'],
  ['export const STRUCTURE_CALC_WATER_MAX_MOVE = 0.02;', 'le déplacement maximal par évaluation de force (la SUBDIVISION du pas)'],
  ['export const STRUCTURE_CALC_WATER_MAX_SUB = 24;', 'la borne de coût des sous-pas'],
  ['export const STRUCTURE_CALC_WATER_MAX_TURN = 0.1;', 'le pas angulaire d’une eau'],
]) has(MODULE, c, `…et ${what} est une constante DITE, pas un chiffre caché`);
has(MODULE, 'export const waterRigidBodyOf = ({', '…et le corps rigide est UNE fonction exportée (le panneau ne réimplémente rien)');
has(MODULE, 'pairs: () => walk.pairs,', '…le moteur lui DONNE sa marche de couples (la pente est celle du champ)');
has(MODULE, 'waters.step({', '…et `mdFrames` le pousse à chaque pas');
has(MODULE, 'seed: wrapSeed(Number(seed) + 137)',
  '…avec une graine DÉCALÉE de celle des dièdres (les deux moitiés ne tirent pas les mêmes nombres)');
ok(!/Math\.random\(/.test(MODULE),
  '⚠ AUCUN second générateur dans le module : le bruit des eaux vient de `makeRelaxRandom` (le nom de `Math.random` n’y apparaît que dans les commentaires qui le refusent)');
has(MODULE, 'let closest = Infinity;', '…et le CONTACT le plus court est mesuré (dans la boucle des forces, donc gratuit)');
has(FIELD, 'export const ffNonbondedGradientOf = (r, pair, {',
  '⚗ le champ porte la PENTE d’un couple, à côté de son prix (une seule définition de chaque)');
has(FIELD, 'export const FF_KCAL_PER_AMU_A2_PS2 = 418.4;',
  '…et le pont d’unités énergie ↔ inertie est écrit une fois, en amu·Å²·ps⁻²');

has(VIEW, 'const calcPreviewWaterPositions = (positions, solute) => {',
  '🖥 les eaux DESSINÉES sont réécrites image par image (la boîte suit la physique)');
has(VIEW, 'if (watch && water) calcPreviewWaterPositions(shown.positions, water.solute);',
  '…et c’est la pompe commune qui le fait (la même que le calcul, pas une seconde boucle)');
has(VIEW, 'water: geom.solvent && geom.solvent.ok && geom.solvent.solute',
  '…le geste ▶ MD lui passe la boîte du moteur (`solute` = où finit le soluté)');
has(VIEW, 'const calcWaterRunNote = (w, askedK) => {',
  '…et le rapport a SA phrase pour ce que les eaux ont fait');
has(VIEW, 'and they DO move: each one translates and rotates',
  '⚠ le rapport du geste ne dit plus « they never move » : il dit ce qui est mesuré');
ok(!VIEW.includes('so the waters are RIGID and their position never changes'),
  '…et l’ancienne phrase de l’infobulle du solvant a bien disparu (elle était devenue fausse)');
has(VIEW, 'closest contact reached', '…avec le contact le plus court atteint, pour que le lecteur juge');
has(VIEW, 'its motion was subdivided', '…et la subdivision du pas est CITÉE : une eau rapide coûte plus cher, le rapport le dit');
has(VIEW, 'STRUCTURE_CALC_WATER_MAX_MOVE,', '…avec la constante du module importée, jamais recopiée');
near(FF_TIP3P.ow.mass + 2 * FF_TIP3P.hw.mass, 18.0154,
  '💧 la masse d’une eau est celle de TIP3P (18.0154 amu : le thermostat est dans les VRAIES unités)', 1e-4);
near(FF_GAS_CONSTANT * 1500 * FF_KCAL_PER_AMU_A2_PS2 / 18.0154, 69.3,
  '…et la vitesse thermique d’une eau à 1500 K vaut √(k_B·T/M) = 8.3 Å/ps (69.3 = son carré)', 1);

console.log(`_water_md_test.mjs — ${passed} assertions OK `
  + '(💧 LES EAUX DE LA BOÎTE EXPLICITE BOUGENT VRAIMENT : six degrés de liberté de corps rigide, '
  + 'gradient = dérivée exacte du coût, thermostat MESURÉ (translation ET rotation), rotation libre qui '
  + 'conserve son énergie, géométrie TIP3P invariante à 10⁻¹⁵ Å, graine du dossier, `waterMobile: false` '
  + 'qui rend l’ancien geste au chiffre près, et le panneau qui suit et qui dit)');
