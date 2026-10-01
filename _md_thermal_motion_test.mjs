/* =========================================================================
   _md_thermal_motion_test.mjs — LA TEMPÉRATURE CONDUIT-ELLE LE MOUVEMENT ?

   La remarque de cette session, verbatim : « La cosa strana é che la MD sembra piu una
   minimizzazione perche quando arriva a una struttura corretta gli atomi non si muovono
   piu ma non dovrebbe essere cosi perche a una certa temperatura il movimento é continuo. »

   Elle était EXACTE, et voici ce qui a été mesuré avant de changer quoi que ce soit :

     • l'intégrateur était CORRECT (Euler–Maruyama semi-implicite, bruit √(2γ·R·T·h/m) :
       la relation de fluctuation–dissipation était respectée, la T cinétique lue valait
       bien la température demandée) ;
     • mais la vitesse thermique √(R·T/m) valait 1.7 °/ps avec l'inertie d'alors (m = 1),
       soit un pas de 0.017° — 0.02 Å par image : INVISIBLE. Le temps de relaxation d'un
       puits, τ ≈ γ·m/k_θ ≈ 200 ps, était 100 fois plus long que la trajectoire (300 pas),
       donc la seule chose qu'on voyait était la DESCENTE vers le minimum, puis rien ;
     • mesuré : 0.022 Å par image à 1500 K et 0.024 Å à 300 K — IDENTIQUES, donc sans rien
       de thermique (un mouvement thermique scale comme √T), et le potentiel descendait
       MONOTONEMENT jusqu'au minimum. Le geste était une minimisation, exactement ce que
       la remarque décrivait.

   CE QUI CHANGE — l'inertie réduite d'un dièdre (m = 0.0025, voir le module), donc la
   vitesse thermique (34.5 °/ps à 1500 K) : le moteur devient un Langevin dont la
   température CONDUIT le mouvement. ⚠ ET LE PLAFOND DE COUPLE N'EST PAS `γ·m·√(R·T/m)` :
   cette expression (0.17 kcal/mol·deg) ne permettait au champ que 0.69 °/ps de réponse par
   pas à un bruit de 6.9 °/ps, donc un mur de van der Waals était TRANSPARENT (les atomes
   se traversaient, voir `_md_wall_test.mjs`). Le plafond est `√(R·T·m)/h` — le couple qui
   RENVERSE la vitesse thermique en un pas (8.6 kcal/mol·deg à 1500 K) — et il suit toujours
   T et la marge `f` (`STRUCTURE_CALC_MD_SPEED_FACTOR`). Les contrats mesurés ici :

     • le mouvement par image est VISIBLE (0.438 Å à 1500 K) ;
     • il SCALE comme √T (0.438 / 0.202 = 2.17 ≈ √(1500/300) = 2.24) ;
     • le potentiel de fin reste AU-DESSUS du minimum de la trajectoire : la molécule ne
       se colle plus au fond du puits, elle l'explore ;
     • la T cinétique lue reste bornée par la température demandée (la dérive peut la
       pousser, jamais l'écraser) ;
     • la contre-épreuve : avec l'ancienne inertie (m = 1, passée à la main) le même geste
       ne bouge plus (0.016 Å par image) — c'est le défaut d'origine, reproduit.
   ⚠ LA SONDE PART D'UNE GÉOMÉTRIE PROPRE (le carbonyle est posé à ψ + 180, comme la
   chimie le demande) : une sonde qui part d'un clash mesurerait la DÉTENTE d'une molécule
   empilée, pas le mouvement thermique.

   Run: node _md_thermal_motion_test.mjs
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dihedralDeg } from './src/utils/torsionDrive.js';
import {
  mdFrames, molecularDynamicsOf, rotatableBondsOf, channelReadingsOf,
  STRUCTURE_CALC_MD_MASS, STRUCTURE_CALC_MD_SPEED_FACTOR, STRUCTURE_CALC_MD_MAX_SPEED,
  STRUCTURE_CALC_MD_MAX_TORQUE, STRUCTURE_CALC_MD_MAX_RESTRAINT_TORQUE,
  STRUCTURE_CALC_MD_FRICTION, STRUCTURE_CALC_MD_STEPS,
  STRUCTURE_CALC_MD_CHANNELS, STRUCTURE_CALC_MD_MAX_SKIP,
} from './src/utils/structureCalc.js';
import { FF_GAS_CONSTANT } from './src/utils/forceFieldKcal.js';

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


/* ── LA SONDE — un peptide de quatre résidus, φ/ψ d'hélice ───────────────────── */
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
const peptideOf = ({ residues = 4, phi = -57, psi = -47 } = {}) => {
  const els = []; const pts = []; const bonds = [];
  const push = (el, p) => { els.push(el); pts.push(p); return pts.length - 1; };
  const N0 = [0, 0, 0]; const CA = [1.46, 0, 0];
  const C = [1.46 + 1.52 * Math.cos((180 - 111) * DEG), 1.52 * Math.sin((180 - 111) * DEG), 0];
  const iN = push('N', N0); const iCA = push('C', CA); const iC = push('C', C);
  push('O', placeWith({ a: N0, b: CA, c: C, length: 1.23, angleDeg: 120.5, dihDeg: psi + 180 }));
  bonds.push({ i: iN, j: iCA, order: 1 }, { i: iCA, j: iC, order: 1 }, { i: iC, j: iN + 3, order: 2 });
  let lastN = N0; let lastCA = CA; let lastC = C; let lastCidx = iC; let lastNidx = iN;
  for (let k = 1; k < residues; k += 1) {
    const n2 = placeWith({ a: lastN, b: lastCA, c: lastC, length: 1.33, angleDeg: 116, dihDeg: psi });
    const iN2 = push('N', n2);
    const ca2 = placeWith({ a: lastCA, b: lastC, c: n2, length: 1.46, angleDeg: 122, dihDeg: 180 });
    const iCA2 = push('C', ca2);
    const c2 = placeWith({ a: lastC, b: n2, c: ca2, length: 1.52, angleDeg: 111, dihDeg: phi });
    const iC2 = push('C', c2);
    const iO2 = push('O', placeWith({ a: n2, b: ca2, c: c2, length: 1.23, angleDeg: 120.5, dihDeg: psi + 180 }));
    bonds.push({ i: lastCidx, j: iN2, order: 1 }, { i: iN2, j: iCA2, order: 1 },
      { i: iCA2, j: iC2, order: 1 }, { i: iC2, j: iO2, order: 2 });
    lastN = n2; lastCA = ca2; lastC = c2; lastCidx = iC2; lastNidx = iN2;
  }
  return { count: els.length, elements: els, bonds, positions: pts.flat(), ends: [iC, lastNidx] };
};
const MOL = peptideOf({ residues: 4 });
const CHAN = rotatableBondsOf({ elements: MOL.elements, bonds: MOL.bonds, atomCount: MOL.count });
const [CI, CJ] = MOL.ends;
const gapOf = (x, i, j) => Math.hypot(
  x[i * 3] - x[j * 3], x[i * 3 + 1] - x[j * 3 + 1], x[i * 3 + 2] - x[j * 3 + 2],
);
const START = gapOf(MOL.positions, CI, CJ);
const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const maxMove = (a, b) => {
  let m = 0;
  for (let k = 0; k < a.length; k += 3) {
    m = Math.max(m, Math.hypot(a[k] - b[k], a[k + 1] - b[k + 1], a[k + 2] - b[k + 2]));
  }
  return m;
};
/** La trajectoire, image par image : le pas par image, la dispersion de la queue et le
 *  potentiel (pour voir si la molécule se pose dans un minimum ou l'explore). */
const motionOf = (spec) => {
  const gen = mdFrames({
    positions: Array.from(MOL.positions), elements: MOL.elements, bonds: MOL.bonds,
    channels: CHAN.channels, seed: 7, perFrame: 8, ...spec,
  });
  const frames = []; let s = gen.next();
  while (!s.done) { frames.push(s.value); s = gen.next(); }
  const per = [];
  for (let k = 1; k < frames.length; k += 1) per.push(maxMove(frames[k - 1].positions, frames[k].positions));
  const tail = frames.slice(-12);
  let spread = 0;
  for (const f of tail) spread = Math.max(spread, maxMove(tail[0].positions, f.positions));
  const pot = frames.map((f) => f.potential);
  return {
    run: s.value, frames, per, spread,
    image: mean(per.slice(-10)), imageAll: mean(per),
    potFirst: pot[0], potMin: Math.min(...pot), potLast: pot[pot.length - 1],
  };
};


/* ── 1 · LES CHIFFRES DE LA CALIBRATION ─────────────────────────────────────── */
near(STRUCTURE_CALC_MD_MASS, 0.0025, '💧 l’inertie réduite d’un dièdre est celle du dossier (0.0025)', 1e-12);
near(STRUCTURE_CALC_MD_SPEED_FACTOR, 1, '…et un pas ne porte pas plus d’UNE vitesse thermique', 1e-12);
ok(STRUCTURE_CALC_MD_MAX_SPEED > 100,
  `⚠ le plafond ABSOLU de vitesse (${STRUCTURE_CALC_MD_MAX_SPEED} °/ps) est un garde-fou, pas l’échelle du moteur`);
ok(STRUCTURE_CALC_MD_MAX_TORQUE === 50 && STRUCTURE_CALC_MD_MAX_RESTRAINT_TORQUE === 500,
  '⚠ les deux plafonds historiques restent, comme CEILINGS des plafonds du palier');
near(STRUCTURE_CALC_MD_FRICTION, 2, 'γ est inchangé (ps⁻¹) — c’est l’inertie qui a changé', 1e-12);
near(STRUCTURE_CALC_MD_STEPS, 300, '…et la longueur du geste aussi', 1e-12);

/* ── 2 · LA VITESSE THERMIQUE EST L’ÉCHELLE DU MOTEUR ───────────────────────── */
const hot = motionOf({ steps: 300, temperature: 1500 });
const cold = motionOf({ steps: 300, temperature: 300 });
const TH = (T) => Math.sqrt((FF_GAS_CONSTANT * T) / STRUCTURE_CALC_MD_MASS);
near(hot.run.temperature.thermal, TH(1500), '🌡 la vitesse thermique √(R·T/m) est dite par le rapport (34.5 °/ps à 1500 K)', 1e-4);
near(cold.run.temperature.thermal, TH(300), '…et elle suit la température du palier', 1e-4);
near(hot.run.temperature.speed, TH(1500), '…le pas ne peut porter qu’UNE fois cette vitesse', 1e-4);
near(hot.run.torque.dynamic, Math.min(STRUCTURE_CALC_MD_MAX_TORQUE,
  Math.max(STRUCTURE_CALC_MD_FRICTION * STRUCTURE_CALC_MD_MASS * hot.run.temperature.speed,
    hot.run.torque.wall)),
  '…et le plafond du palier se recalcule : τ = max(γ·m·f·√(R·T/m), f·√(R·T·m)/h)', 1e-6);
near(hot.run.torque.wall,
  hot.run.torque.factor * Math.sqrt(FF_GAS_CONSTANT * 1500 * STRUCTURE_CALC_MD_MASS) / 0.01,
  '⚠ …dont la moitié qui fait le MUR : √(R·T·m)/h, le couple qui renverse la vitesse thermique en UN pas', 1e-4);
ok(hot.run.torque.wall > STRUCTURE_CALC_MD_FRICTION * STRUCTURE_CALC_MD_MASS * hot.run.temperature.thermal,
  `⚠ …et c’est ELLE qui mène (${hot.run.torque.wall.toFixed(3)} contre ${(STRUCTURE_CALC_MD_FRICTION * STRUCTURE_CALC_MD_MASS * hot.run.temperature.thermal).toFixed(3)} kcal/mol·deg) : un mur doit répondre au thermostat`);
ok(hot.run.torque.dynamic < hot.run.torque.field,
  '…et il reste SOUS le garde-fou absolu (c’est un ceiling, jamais le plafond de tous les jours)');
ok(hot.run.temperature.kinetic > 0 && hot.run.temperature.kinetic < 3 * 1500,
  `🌡 la T cinétique lue reste bornée par la consigne : ${hot.run.temperature.kinetic} K pour 1500 K demandés`);
ok(cold.run.temperature.kinetic < 3 * 300,
  `…et à froid aussi : ${cold.run.temperature.kinetic} K pour 300 K`);
eq(hot.run.moved, CHAN.channels.length, '⚠ TOUS les canaux portent une vitesse (aucun n’est figé)');

/* ── 3 · LE MOUVEMENT EST VISIBLE, ET IL SCALE COMME √T ─────────────────────── */
eq(hot.frames.length, 38, '🖼 une image tous les 8 pas (300 pas font 38 images)');
ok(hot.image > 0.1,
  `▶ le pas par image est VISIBLE : ${hot.image.toFixed(4)} Å à 1500 K (l’ancien moteur : 0.022 Å)`);
ok(cold.image > 0 && cold.image < hot.image,
  `…et il est plus PETIT à froid : ${cold.image.toFixed(4)} Å à 300 K`);
const ratio = hot.image / cold.image;
ok(ratio > 1.6 && ratio < 3.6,
  `⚠ …suivant √(T) : rapport ${ratio.toFixed(2)} pour √(1500/300) = ${Math.sqrt(5).toFixed(2)} — c’est cela, une température qui CONDUIT`);
ok(hot.potLast > hot.potMin + 1e-6,
  `⚠ la molécule ne se colle plus au fond du puits : potentiel final ${hot.potLast.toFixed(3)} > minimum ${hot.potMin.toFixed(3)} kcal/mol`);
ok(cold.potLast - cold.potMin < hot.potLast - hot.potMin,
  '…mais à froid elle reste BEAUCOUP plus près de son minimum (c’est le bout froid qui pose une structure) : '
  + `écart ${(cold.potLast - cold.potMin).toFixed(3)} kcal/mol contre ${(hot.potLast - hot.potMin).toFixed(3)}`);
ok(hot.spread > cold.spread,
  `…et la queue de trajectoire disperse plus à chaud : ${hot.spread.toFixed(3)} Å contre ${cold.spread.toFixed(3)} Å`);

/* ── 4 · LA CONTRE-ÉPREUVE — LE DÉFAUT D’ORIGINE, REPRODUIT ──────────────────── */
const old = motionOf({ steps: 300, temperature: 1500, mass: 1 });
ok(old.image < 0.05,
  `⚠ avec l’inertie d’avant (m = 1, passée à la main) le MÊME geste ne bouge plus : ${old.image.toFixed(4)} Å par image`);
ok(old.image < hot.image / 3,
  '…la nouvelle inertie bouge donc au moins trois fois plus (c’est le défaut mesuré, pas une impression)');
ok(old.run.temperature.thermal < hot.run.temperature.thermal,
  '…parce que sa vitesse thermique est 20 fois plus petite');

/* ── 5 · ⚖ LE POIDS ⚖ — le contrat est TENU, et il est mesuré par la suite du poids ──────
   (`_target_solvent_torque_test.mjs` : une ligne de poids 100 accroche PLUS qu'une ligne de
   poids 1). Ici on vérifie seulement que le rapport du geste DONNE les deux budgets et le
   plafond dynamique du palier, donc qu'un lecteur peut refaire le calcul du couple. */
ok(hot.run.torque.restraint > hot.run.torque.field,
  `⚖ le budget d’une contrainte (${hot.run.torque.restraint}) reste plus large que celui du champ (${hot.run.torque.field}) : le poids ⚖ a de la place pour mordre`);
near(hot.run.torque.dynamic, hot.run.torque.wall,
  '…et le plafond du geste est celui du mur (voir `capsOf`)', 1e-6);

/* ── 6 · CE QUI LE DIT DANS LE CODE — les contrats de source ────────────────── */
const MODULE = read('./src/utils/structureCalc.js');
const VIEW = read('./src/components/NMRMoleculeViewer.jsx');
has(MODULE, 'export const STRUCTURE_CALC_MD_SPEED_FACTOR = 1;',
  '…l’échelle du moteur est une CONSTANTE nommée, décrite une seule fois');
has(MODULE, 'const vSpeed = Math.min(maxSpeed, speedFactor * vThermal);',
  '…le plafond du palier est calculé à chaque pas (un recuit change de température)');
has(MODULE, 'const vReverse = Math.sqrt(kT * m) / hEff;',
  '⚠ …et le plafond du CHAMP est le couple qui RENVERSE la vitesse thermique en UN pas (√(R·T·m)/h) — c’est ce qui fait d’un mur de van der Waals un mur');
has(MODULE, 'const restCap = Math.min(maxRestTorque, maxTorque * engine.crossRestraintWeightOf(ctx));',
  '⚠ la famille des distances garde son budget ABSOLU (une distance demandée est une mola dure, pas une agitation)');
has(VIEW, 'title="RUN MOLECULAR DYNAMICS', '▶ MD est toujours le geste du panneau');
ok(!VIEW.includes('mass: STRUCTURE_CALC_MD_MASS'),
  '⚠ …et il ne passe AUCUNE inertie : la calibration du module EST celle du geste qu’on regarde');
/* ── 7 · LA TAILLE DE LA MOLÉCULE NE CHANGE PLUS LE MOUVEMENT ──────────────────────────
   La remarque de cette session, verbatim : « I think that only phi and psi are varied. all
   the other dihedrals look blocked ». Mesuré : c’était EXACT sur une molécule GRANDE, et
   c’était la FENÊTRE (`STRUCTURE_CALC_MD_CHANNELS`) qui le faisait. Un pas ne tourne que 24
   dièdres : un canal était donc mis à jour tous les `canaux/24` pas et intégré comme s’il
   avait vécu `dt` À CHAQUE pas — sa trajectoire était `canaux/24` fois plus courte que celle
   que le rapport annonce. Sur l’ubiquitine (378 canaux, 300 pas), l’excursion TOTALE de
   chaque χ1 valait 1.4° (médiane 0.8°, max 5.7°) pendant que le squelette atteignait 13.6° :
   les chaînes latérales PARAIENT bloquées. Chaque canal intègre maintenant l’intervalle
   qu’il a réellement sauté (`hEff = dt × canaux/budget`, borné par
   `STRUCTURE_CALC_MD_MAX_SKIP`), et cette section mesure le contrat :
   LA MÊME MOLÉCULE DONNE LA MÊME EXCURSION QU’ELLE SOIT TOURNÉE À CHAQUE PAS OU TOUS LES
   `canaux` PAS. Sur l’ubiquitine, la même mesure donne χ1 de 1.4° → 31.3° (médiane 27.3°). */
const chiProbeOf = ({ residues = 5, phi = -60, psi = -45 } = {}) => {
  const els = []; const pts = []; const bonds = [];
  const push = (el, p) => { els.push(el); pts.push(p); return pts.length - 1; };
  const N0 = [0, 0, 0]; const CA = [1.46, 0, 0];
  const C = [1.46 + 1.52 * Math.cos((180 - 111) * DEG), 1.52 * Math.sin((180 - 111) * DEG), 0];
  let iN = push('N', N0); const iCA = push('C', CA); const iC = push('C', C);
  const iO = push('O', placeWith({ a: N0, b: CA, c: C, length: 1.23, angleDeg: 120.5, dihDeg: psi + 180 }));
  const iCB = push('C', placeWith({ a: N0, b: CA, c: C, length: 1.53, angleDeg: 110.5, dihDeg: -122 }));
  const cb = pts[iCB];
  const iG1 = push('C', placeWith({ a: N0, b: CA, c: cb, length: 1.52, angleDeg: 113, dihDeg: 60 }));
  const iG2 = push('C', placeWith({ a: N0, b: CA, c: cb, length: 1.52, angleDeg: 113, dihDeg: -60 }));
  bonds.push({ i: iN, j: iCA, order: 1 }, { i: iCA, j: iC, order: 1 }, { i: iC, j: iO, order: 2 },
    { i: iCA, j: iCB, order: 1 }, { i: iCB, j: iG1, order: 1 }, { i: iCB, j: iG2, order: 1 });
  let lastN = N0; let lastCA = CA; let lastC = C; let lastCidx = iC;
  for (let k = 1; k < residues; k += 1) {
    const n2 = placeWith({ a: lastN, b: lastCA, c: lastC, length: 1.33, angleDeg: 116, dihDeg: psi });
    const jN = push('N', n2);
    const ca2 = placeWith({ a: lastCA, b: lastC, c: n2, length: 1.46, angleDeg: 122, dihDeg: 180 });
    const jCA = push('C', ca2);
    const c2 = placeWith({ a: lastC, b: n2, c: ca2, length: 1.52, angleDeg: 111, dihDeg: phi });
    const jC = push('C', c2);
    const jO = push('O', placeWith({ a: n2, b: ca2, c: c2, length: 1.23, angleDeg: 120.5, dihDeg: psi + 180 }));
    const cb2 = placeWith({ a: n2, b: ca2, c: c2, length: 1.53, angleDeg: 110.5, dihDeg: -122 });
    const jCB = push('C', cb2);
    const jG1 = push('C', placeWith({ a: n2, b: ca2, c: cb2, length: 1.52, angleDeg: 113, dihDeg: 60 }));
    const jG2 = push('C', placeWith({ a: n2, b: ca2, c: cb2, length: 1.52, angleDeg: 113, dihDeg: -60 }));
    bonds.push({ i: lastCidx, j: jN, order: 1 }, { i: jN, j: jCA, order: 1 },
      { i: jCA, j: jC, order: 1 }, { i: jC, j: jO, order: 2 },
      { i: jCA, j: jCB, order: 1 }, { i: jCB, j: jG1, order: 1 }, { i: jCB, j: jG2, order: 1 });
    iN = jN; lastN = n2; lastCA = ca2; lastC = c2; lastCidx = jC;
  }
  return { count: els.length, elements: els, bonds, positions: pts.flat() };
};


const CHIP = chiProbeOf({ residues: 8 });
const CHICH = rotatableBondsOf({ elements: CHIP.elements, bonds: CHIP.bonds, atomCount: CHIP.count });
/* LES χ1 DE LA SONDE — l’atome de référence est un N et l’axe est CA–CB (N–CA–CB–CG) : c’est
   EXACTEMENT le dièdre dont la remarque dit qu’il « a l’air bloqué ». */
const CHI_AT = CHICH.channels
  .map((ch, k) => ({ ch, k }))
  .filter(({ ch }) => CHIP.elements[ch.probeAtoms[0]] === 'N'
    && CHIP.elements[ch.probeAtoms[1]] === 'C' && CHIP.elements[ch.probeAtoms[2]] === 'C');
/** L’excursion MESURÉE des χ1 — |Δ| du dièdre entre le départ et la fin de la trajectoire,
 *  pour un budget de canaux donné (le budget EST la fenêtre : `canaux` = tous à chaque pas). */
const chiSpanOf = (channelBudget) => {
  const run = molecularDynamicsOf({
    positions: Array.from(CHIP.positions), elements: CHIP.elements, bonds: CHIP.bonds,
    steps: 100, temperature: 1500, perFrame: 100, channelBudget, seed: 7,
  });
  const before = channelReadingsOf({ positions: CHIP.positions, channels: CHICH.channels });
  const after = channelReadingsOf({ positions: run.positions, channels: CHICH.channels });
  const abs = [];
  for (const { k } of CHI_AT) {
    if (!Number.isFinite(before[k].deg) || !Number.isFinite(after[k].deg)) continue;
    let d = after[k].deg - before[k].deg;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    abs.push(Math.abs(d));
  }
  return { run, mean: mean(abs), max: Math.max(...abs), n: abs.length };
};
const everyStep = chiSpanOf(CHICH.count);
const windowed = chiSpanOf(1);
ok(CHI_AT.length >= 3,
  `⚠ la sonde a bien des χ1 (${CHI_AT.length} sur ${CHICH.count} canaux) — c’est le dièdre de la remarque`);
ok(CHICH.count > STRUCTURE_CALC_MD_CHANNELS,
  `…et elle a PLUS de canaux que la fenêtre (${CHICH.count} > ${STRUCTURE_CALC_MD_CHANNELS}) : la fenêtre mord`);
eq(everyStep.run.windowed, false,
  '🎛 tourné à chaque pas : le rapport le dit (`windowed: false`) et `dtEff` vaut dt');
eq(windowed.run.windowed, true,
  '🎛 tourné tous les `canaux` pas : le rapport le dit (`windowed: true`)');
near(windowed.run.skip, Math.min(CHICH.count, STRUCTURE_CALC_MD_MAX_SKIP),
  '…le nombre de pas sautés est `canaux/budget`, borné par la borne de stabilité', 1e-9);
near(windowed.run.dtEff, 0.01 * Math.min(CHICH.count, STRUCTURE_CALC_MD_MAX_SKIP),
  '…et le canal intègre VRAIMENT cet intervalle (`dtEff = dt × skip`)', 1e-9);
ok(windowed.mean > everyStep.mean * 0.6 && windowed.mean < everyStep.mean * 1.8,
  `⚠ LA TAILLE DE LA MOLÉCULE NE CHANGE PLUS LE MOUVEMENT : χ1 fait |Δ| moyen `
  + `${windowed.mean.toFixed(2)}° en sautant ${windowed.run.skip} pas contre ${everyStep.mean.toFixed(2)}° tourné à chaque pas `
  + '(avant ce changement : 1/√skip de la seconde, soit « bloqué »)');
ok(windowed.mean > 10,
  `⚠ …et les χ1 TOURNENT vraiment (${windowed.mean.toFixed(2)}° de moyenne, max ${windowed.max.toFixed(1)}°) : ce n’est plus « seulement φ et ψ »`);

/* ── 8 · CE QUI LE DIT DANS LE CODE — LA FENÊTRE ET SON PAS EFFECTIF ─────────────────── */
has(MODULE, 'export const STRUCTURE_CALC_MD_MAX_SKIP = 25;',
  '⚠ la borne de stabilité de la fenêtre est une CONSTANTE nommée (`1 − γ·h_eff` doit rester > 0)');
has(MODULE, 'const skip = Math.min(chan.length / Math.max(1, budget), STRUCTURE_CALC_MD_MAX_SKIP);',
  '…et le nombre de pas sautés se lit sur la fenêtre (canaux / budget)');
has(MODULE, 'const hEff = h * skip;',
  '⚠ …et c’est CET intervalle que chaque canal intègre, pas `dt`');
has(MODULE, 'Math.sqrt((2 * gamma * FF_GAS_CONSTANT * target * hEff) / m) * gaussian()',
  '…le BRUIT porte sur l’intervalle réel (fluctuation–dissipation, à l’échelle du canal)');
has(MODULE, 'const v = vel[k] * (1 - gamma * hEff) + (capped / m) * hEff + noise;',
  '…la FRICTION et la RÉPONSE AU CHAMP aussi (les trois termes du même intervalle)');
has(MODULE, 'const turn = Math.max(-cap, Math.min(cap, vel[k] * hEff));',
  '…donc la rotation d’un pas est celle de l’intervalle intégré (et reste bornée par `maxStepDeg`)');
has(MODULE, 'dtEff: Number(hEff.toFixed(6)),\n    windowed: skip > 1,',
  '…et le rapport du geste DONNE l’échelle réelle (`dtEff`, `windowed`) au lieu de la cacher');
has(VIEW, 'the window turned ${run.budget} of the ${run.channels} dihedrals per step',
  '…le panneau l’ÉCRIT dans le rapport du ▶ MD (le module le promet depuis `STRUCTURE_CALC_MD_CHANNELS`)');

console.log(`_md_thermal_motion_test.mjs — ${passed} assertions OK `
  + '(🌡 la température CONDUIT le mouvement : vitesse thermique √(R·T/m) comme échelle du moteur, '
  + 'mouvement visible et suivant √T, la molécule n’est plus collée au fond du puits, toutes les vitesses '
  + 'bornées par la consigne, la contre-épreuve de l’ancienne inertie, le ⚖ poids qui mord toujours, '
  + 'et LA MÊME EXCURSION POUR CHAQUE DIÈDRE QUE LA MOLÉCULE AIT 8 OU 378 CANAUX)');

