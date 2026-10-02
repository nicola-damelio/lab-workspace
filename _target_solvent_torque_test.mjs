/* =========================================================================
   _target_solvent_torque_test.mjs — 🎯 DYANA · 💧 LA BOÎTE D'EAU · ⚖ LE POIDS QUI MORD.

   Les trois demandes de cette session, chacune avec sa preuve :

     • « it would be great if you could add the explicit solvent as a further option with
       its box. » — `explicitSolventOf` construit une boîte cubique d'eaux TIP3P RIGIDES,
       les AJOUTE à la fin de la molécule (les indices d'origine ne bougent pas), écarte
       les sites qui toucheraient la molécule, donne à chaque eau sa géométrie (0.9572 Å,
       104.52°) et REFUSE une arête qui ne peut pas contenir la molécule ;
     • « if the present plan is correct I wouldn't throw it but I would add the option to
       run as Dyana as well. » — une fonction cible unique (`FF_TARGET_FUNCTIONS`), lue par
       le champ ET par les quatre moteurs : RÉPULSION SEULE, sans charge, sans surface,
       atomes unis ;
     • « giving a high weight to one constraint did not have an effect on MD » — mesuré :
       c'était le PLAFOND DE COUPLE, commun aux contraintes et aux murs de Lennard-Jones.
       Il est maintenant séparé (`STRUCTURE_CALC_MD_MAX_RESTRAINT_TORQUE`), donc une ligne
       de poids 100 tire vraiment plus fort qu'une ligne de poids 1.

   Run: node _target_solvent_torque_test.mjs
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dihedralDeg } from './src/utils/torsionDrive.js';
import {
  explicitSolventOf, structureCalcSolventOf, structureCalcSolventIsExplicit,
  STRUCTURE_CALC_SOLVENTS, STRUCTURE_CALC_SOLVENT, STRUCTURE_CALC_SOLVENT_BOX,
  STRUCTURE_CALC_TARGET_FUNCTION, STRUCTURE_CALC_TARGET_FUNCTIONS,
  structureCalcTargetFunctionOf, STRUCTURE_CALC_MD_MAX_RESTRAINT_TORQUE,
  STRUCTURE_CALC_MD_MAX_TORQUE, STRUCTURE_CALC_RESTRAINT_TOLERANCE,
  mdFrames, rotatableBondsOf, restraintReportOf,
  forceFieldEnergyOf, STRUCTURE_CALC_WATER_CLEARANCE, STRUCTURE_CALC_WATER_SPACING,
} from './src/utils/structureCalc.js';
import {
  ffTargetFunctionOf, FF_TARGET_FUNCTIONS, ffRepulsionCostOf, ffVdwCostOf,
  ffNonbondedCostOf, ffElementOf, FF_TIP3P, ffWatersIn, partialChargesOf,
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


/* ── LE PEPTIDE DE SONDE — φ/ψ réglés, fait de N · CA · C · O par résidu ─────── */
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
  const N = [0, 0, 0]; const CA = [1.46, 0, 0];
  const C = [1.46 + 1.52 * Math.cos((180 - 111) * DEG), 1.52 * Math.sin((180 - 111) * DEG), 0];
  const iN = push('N', N); const iCA = push('C', CA); const iC = push('C', C);
  push('O', placeWith({ a: N, b: CA, c: C, length: 1.23, angleDeg: 120.5, dihDeg: psi + 180 }));
  bonds.push({ i: iN, j: iCA, order: 1 }, { i: iCA, j: iC, order: 1 }, { i: iC, j: iN + 3, order: 2 });
  let lastN = N; let lastCA = CA; let lastC = C; let lastCidx = iC; let lastNidx = iN;
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

const gapOf = (x, i, j) => Math.hypot(
  x[i * 3] - x[j * 3], x[i * 3 + 1] - x[j * 3 + 1], x[i * 3 + 2] - x[j * 3 + 2],
);
const mdRunOf = (spec) => {
  const frames = mdFrames(spec);
  let next = frames.next();
  while (!next.done) next = frames.next();
  return next.value;
};
const MOL = peptideOf({ residues: 4 });
const CHANNELS = rotatableBondsOf({ elements: MOL.elements, bonds: MOL.bonds, atomCount: MOL.count });
const [CI, CJ] = MOL.ends;
const START = gapOf(MOL.positions, CI, CJ);

/* ── 1 · 💧 LA BOÎTE D'EAU EXPLICITE ────────────────────────────────────────── */
eq(STRUCTURE_CALC_SOLVENT, 'implicit', '⚠ le solvant par défaut reste le modèle du champ (rien ne change pour qui ne demande rien)');
eq(structureCalcSolventIsExplicit('implicit'), false, '…les trois modèles implicites ne construisent AUCUNE boîte');
eq(structureCalcSolventIsExplicit('explicit'), true, '…et `explicit` est celui qui en construit une');
eq(structureCalcSolventOf('nawak').id, STRUCTURE_CALC_SOLVENT, 'un identifiant inconnu rend le défaut (le panneau ne peut pas jeter)');
const EXPLICIT = STRUCTURE_CALC_SOLVENTS.find((s) => s.id === 'explicit');
eq(EXPLICIT.dielectric, 1, '💧 la boîte est à ε = 1 : ce sont les MOLÉCULES qui écrantent, plus un chiffre');

const box = explicitSolventOf({
  positions: MOL.positions, elements: MOL.elements, bonds: MOL.bonds, edge: 40,
});
ok(box.ok, `la boîte doit s’ouvrir sur ce peptide (raison : ${box.reason})`);
ok(box.molecules > 20, `…avec un vrai remplissage (mesuré : ${box.molecules} eaux)`);
eq(box.elements.slice(0, MOL.count).join(','), MOL.elements.join(','),
  '⚠ LES INDICES D’ORIGINE NE BOUGENT PAS : les atomes de la molécule sont les PREMIERS, donc ses contraintes et ses canaux restent valides');
eq(box.elements.slice(MOL.count).filter((e) => e === 'OW').length, box.molecules,
  '…et chaque eau ajoutée est un OW suivi de ses deux HW');
eq(ffWatersIn(box.elements), { oxygens: box.molecules, hydrogens: 2 * box.molecules, molecules: box.molecules },
  'le compte du module (ffWatersIn) tombe sur le compte de la boîte');

/* LA GÉOMÉTRIE RIGIDE — TIP3P, et la MÊME pour toutes les eaux. */
const oh = (s) => gapOf(box.positions, MOL.count + s * 3, MOL.count + s * 3 + 1);
const hh = (s) => gapOf(box.positions, MOL.count + s * 3 + 1, MOL.count + s * 3 + 2);
near(oh(0), FF_TIP3P.oh, 'la liaison O–H d’une eau est celle de TIP3P', 1e-12);
const hoh = 2 * Math.asin(hh(0) / (2 * oh(0))) / DEG;
near(hoh, FF_TIP3P.angle, '…et son angle H–O–H aussi (lu sur les DEUX distances)', 1e-9);
const bondsAt = (rep, s) => {
  const i = MOL.count + s * 3;
  return rep.bonds.filter((b) => b.i === i || b.j === i).length;
};
eq(bondsAt(box, 0), 2, '…chaque eau porte ses DEUX liaisons O–H (c’est une molécule du graphe, pas trois atomes isolés)');

/* AUCUNE EAU NE TRAVERSE LA MOLÉCULE — le site le plus proche d’un atome lourd. */
let minClear = Infinity;
for (let s = 0; s < box.molecules; s += 1) {
  for (let k = 0; k < MOL.count; k += 1) {
    minClear = Math.min(minClear, gapOf(box.positions, MOL.count + s * 3, k));
  }
}
ok(minClear >= STRUCTURE_CALC_WATER_CLEARANCE - 1e-9,
  `⚠ aucune eau ne touche un atome lourd (mesuré ${minClear.toFixed(2)} Å ≥ ${STRUCTURE_CALC_WATER_CLEARANCE})`);
ok(box.skipped > 0, `…et les sites trop proches ont été ÉCARTÉS et comptés (${box.skipped})`);

/* LA BOÎTE EST UN CUBE — toutes les eaux sont dedans. */
near(box.edge, 40, 'l’arête demandée est celle rendue');
ok(box.positions.length === box.atoms * 3, '…et les coordonnées portent l’eau et rien qu’elle');

/* LE REFUS D’UNE ARÊTE TROP PETITE — jamais agrandie en silence. */
const tight = explicitSolventOf({
  positions: MOL.positions, elements: MOL.elements, bonds: MOL.bonds, edge: 12,
});
eq(tight.ok, false, '⚠ une arête de 12 Å est REFUSÉE sur ce peptide');
eq(tight.reason, 'box-too-small', '…avec sa raison, pas un silence');
ok(tight.needed > 12, `…et l’arête qu’il faudrait est DITE (${tight.needed} Å)`);
ok(STRUCTURE_CALC_SOLVENT_BOX > 0 && STRUCTURE_CALC_WATER_SPACING > 0,
  'l’arête et la maille ont un défaut, et ils sont positifs');

/* …ET LES EAUX PORTENT LES CHARGES DE TIP3P, PAS CELLES DE PEOE. */
const ch = partialChargesOf({ elements: box.elements, bonds: box.bonds });
const owAt = box.elements.indexOf('OW');

/* …ET LA BOÎTE EST VRAIMENT CONDUITE PAR LA DYNAMIQUE — l'intégration de bout en bout :
   les eaux sont des atomes du moteur, elles comptent dans le champ, et le modèle rendu ne
   contient QUE le soluté (les eaux ne remontent pas dans la molécule de l'écran).
   ⚠ EN MODE DYANA, ET C'EST LE CONSEIL QUE DONNE L'INFOBULLE : sans terme de surface et
   avec une portée de 3.5 Å, une boîte de plusieurs centaines d'eaux reste abordable — en
   `classic`, la famille ⚗ SASA les compterait toutes à chaque pas. */
const solvated = explicitSolventOf({
  positions: MOL.positions, elements: MOL.elements, bonds: MOL.bonds, edge: 34,
});
ok(solvated.ok, 'la boîte s’ouvre aussi sur une arête de 34 Å');
const t0 = Date.now();
const solvRun = mdRunOf({
  positions: solvated.positions, elements: solvated.elements, bonds: solvated.bonds,
  channels: CHANNELS.channels, steps: 6, temperature: 300, seed: 0x5EEDCA1C,
  perFrame: 1e9, targetFunction: 'dyana',
});
const ms = Date.now() - t0;
ok(solvRun.ok, '…et la dynamique tourne SUR la boîte (aucune erreur de moteur)');
/* ⚠ LES EAUX N'AJOUTENT AUCUN CANAL — c'est ce qui permet au moteur de construire ses
   charnières LUI-MÊME sur la géométrie solvatée (le chemin réel du viewer : `mdFrames` sans
   `channels`). Une liaison O–H d'une eau est TERMINALE (l'H n'a rien derrière lui), donc
   `rotatableBondsOf` l'écarte — et aucune charnière ne doit toucher un indice d'eau, sinon
   la dynamique tournerait une molécule d'eau au lieu du soluté. */
const solvChannels = rotatableBondsOf({
  elements: solvated.elements, bonds: solvated.bonds, atomCount: solvated.elements.length,
});
eq(solvChannels.channels.length, CHANNELS.channels.length,
  `⚠ les ${solvated.molecules} eaux n’ajoutent AUCUN canal de torsion (soluté : ${CHANNELS.channels.length})`);
ok(solvChannels.channels.every((ch) => ch.probeAtoms.every((k) => k < MOL.count)),
  '…et aucune charnière ne touche un atome d’eau (les eaux ont leurs six degrés de liberté à elles — voir `_water_md_test.mjs` —, mais AUCUNE charnière : une liaison O–H est terminale, donc `rotatableBondsOf` l’écarte et le moteur ne tourne jamais une eau comme un dièdre)');
const solvNoCh = mdRunOf({
  positions: solvated.positions, elements: solvated.elements, bonds: solvated.bonds,
  steps: 3, temperature: 300, seed: 0x5EEDCA1C, perFrame: 1e9, targetFunction: 'dyana',
});
eq(solvNoCh.channels, CHANNELS.channels.length,
  '⚠ …et la dynamique qui construit ses charnières ELLE-MÊME trouve exactement les mêmes');
eq(solvRun.waters.molecules, solvated.molecules,
  '⚠ …le rapport compte les eaux EXPLICITES qu’elle a vues (elles sont des atomes du champ)');
eq(solvRun.positions.length, (MOL.count + solvated.molecules * 3) * 3,
  '⚠ …et la géométrie rendue garde LE SOLUTÉ EN TÊTE, les eaux à la suite (les indices d’origine sont intacts, donc contraintes, canaux et rapports désignent les MÊMES atomes)');
ok(solvRun.positions.slice(0, MOL.count * 3).every((v) => Number.isFinite(v)),
  '…et le soluté est bien là, en tête, à ses indices d’origine');
/* ⚠ CE QUE L’ÉCRAN EN FAIT — `calcPreviewPositions` n’écrit QUE les atomes de la structure
   à l’écran (`structure.atomCount`), donc la queue d’eau n’est jamais écrite dans NGL : le
   soluté reste ce qui bouge et ce qu’on voit. Une assertion de SOURCE, parce que c’est le
   contrat d’écriture du viewer qui compte ici. */
has(read('./src/components/NMRMoleculeViewer.jsx'),
  'const count = Math.min(have, Number(structure.atomCount) || have);',
  '⚠ …et le viewer n’écrit que les atomes de la molécule à l’écran (la queue d’eau n’est jamais écrite)');
ok(ms < 60000, `…et six pas sur ${solvated.molecules} eaux tiennent en ${ms} ms (mode DYANA)`);

eq(STRUCTURE_CALC_TARGET_FUNCTION, 'classic', '⚠ le champ HISTORIQUE est le défaut : qui ne demande rien ne change pas de physique');
eq(structureCalcTargetFunctionOf('nawak').id, 'classic', 'un identifiant inconnu rend `classic` (le panneau ne peut pas jeter)');
eq(FF_TARGET_FUNCTIONS.length, 2, 'deux fonctions cibles, décrites UNE fois dans le module du champ');
const dy = ffTargetFunctionOf('dyana');
eq([dy.repulsionOnly, dy.electrostatics, dy.surface, dy.unitedAtoms], [true, false, false, true],
  '🎯 DYANA : répulsion seule, SANS charges, SANS surface, ATOMES UNIS');
ok(dy.pairLimit < ffTargetFunctionOf('classic').pairLimit,
  '…et une portée de couples plus COURTE (c’est une des raisons de sa vitesse)');
ok(dy.off.length >= 3, '…et le module DIT ce qu’elle éteint (le rapport l’écrit mot pour mot)');

/* LA RÉPULSION SEULE — mathématiquement le r¹² du Lennard-Jones, sans le puits. */
const pair = { rmin: 3.4, epsilon: 0.1 };
near(ffRepulsionCostOf(2.8, pair), 0.1 * ((3.4 / 2.8) ** 6) ** 2, 'ε·(r_min/r)¹² — la branche répulsive seule', 1e-9);
near(ffNonbondedCostOf(2.8, pair, { repulsionOnly: true }), ffRepulsionCostOf(2.8, pair),
  '…et le couple en mode DYANA n’est QUE cela', 1e-12);
ok(ffVdwCostOf(4.5, pair) < 0, 'le LJ entier, lui, a un PUITS attractif au-delà du minimum : c’est ce que DYANA n’a pas');
eq(ffNonbondedCostOf(4.5, { ...pair, cqq: 83 }, { repulsionOnly: true, electrostatics: false }),
  ffRepulsionCostOf(4.5, { ...pair, cqq: 83 }),
  '⚠ …et aucune charge n’y entre : deux atomes libres ne s’attirent pas');

/* LA NOTE LUE PAR LE CHAMP — les familles éteintes valent 0 et le rapport le DIT. */
const clash = {
  positions: [0, 0, 0, 2.6, 0, 0, 0, 2.6, 0], elements: ['C', 'C', 'O'],
  bonds: [{ i: 0, j: 1, order: 1 }, { i: 1, j: 2, order: 1 }],
};
const fClassic = forceFieldEnergyOf({ ...clash, hydrogenate: false });
const fDyana = forceFieldEnergyOf({ ...clash, hydrogenate: false, targetFunction: 'dyana' });
eq([fDyana.elec, fDyana.solv], [0, 0], '🎯 en DYANA, l’électrostatique et la surface sont à ZÉRO');
eq(fDyana.added.hydrogens, 0, '…et AUCUN hydrogène n’est ajouté (atomes unis)');
ok(fDyana.targetFunction === 'dyana' && fDyana.switchedOff.length >= 3, '…et le rapport du champ nomme ce qui est éteint');
eq(fClassic.targetFunction, 'classic', '…le défaut, lui, lit le champ entier');

/* LA MÊME FONCTION CIBLE DANS LES MOTEURS — la dynamique le prouve : sans charges ni
   surface, elle converge vers le même genre de conformation mais sur un autre champ. */
const dyRun = mdRunOf({
  positions: MOL.positions, elements: MOL.elements, bonds: MOL.bonds,
  channels: CHANNELS.channels, steps: 40, temperature: 300, seed: 0x5EEDCA1C, perFrame: 1e9,
  targetFunction: 'dyana',
});
ok(dyRun.ok, 'une dynamique DYANA tourne');
eq(dyRun.targetFunction, 'dyana', '…et son rapport dit la fonction cible qu’elle a conduite');
eq(dyRun.unitedAtoms, true, '…et qu’elle a tourné sur les ATOMES UNIS');
eq(dyRun.added.hydrogens, 0, '…aucun hydrogène ajouté, donc');
eq(ffWatersIn(dyRun.molecule.elements).molecules, 0, '…et aucun atome d’eau : le moteur ne solvate pas tout seul');

/* ── 3 · ⚖ LE POIDS ⚖ D’UNE LIGNE MORD SUR LA DYNAMIQUE ────────────────────── */
ok(STRUCTURE_CALC_MD_MAX_RESTRAINT_TORQUE > STRUCTURE_CALC_MD_MAX_TORQUE,
  `⚠ le plafond des contraintes (${STRUCTURE_CALC_MD_MAX_RESTRAINT_TORQUE}) est PLUS HAUT que celui du champ (${STRUCTURE_CALC_MD_MAX_TORQUE}) — c’est la séparation qui fait mordre le poids`);
const TARGET = Number((START * 0.7).toFixed(3));
/** La distance DEMANDÉE à chaque pas — c'est elle qui dit QUAND la ligne a mordu. */
const runAt = (weight, steps = 60) => {
  const list = weight == null ? [] : [{ i: CI, j: CJ, target: TARGET, weight }];
  const gen = mdFrames({
    positions: MOL.positions, elements: MOL.elements, bonds: MOL.bonds,
    restraints: list, leash: list.map((r) => ({ ...r })), channels: CHANNELS.channels,
    steps, temperature: 300, seed: 0x5EEDCA1C, perFrame: 1,
  });
  const frames = []; let s = gen.next();
  while (!s.done) { frames.push(s.value); s = gen.next(); }
  const dist = frames.map((f) => gapOf(f.positions, CI, CJ));
  return {
    run: s.value, dist, distance: dist[dist.length - 1],
    rep: restraintReportOf({ positions: s.value.positions, restraints: list }),
    /* LE PAS OÙ LA LIGNE EST TENUE — le premier pas dont la distance tombe DANS la
       tolérance du puits plat (`STRUCTURE_CALC_RESTRAINT_TOLERANCE`). C'est cela, « la
       ligne a mordu » : le puits plat n'a plus rien à demander au-delà. */
    heldAt: dist.findIndex((d) => Math.abs(d - TARGET) <= STRUCTURE_CALC_RESTRAINT_TOLERANCE),
  };
};
ok(START > TARGET + 1, `la sonde doit demander un vrai rapprochement (${START.toFixed(2)} → ${TARGET} Å)`);
const none = runAt(null, 300);
const one = runAt(1, 300);
const ten = runAt(10, 300);
const hundred = runAt(100, 300);
const moved = (r) => START - r.distance;
const away = (r) => Math.abs(r.distance - TARGET);
ok(moved(one) > 0, `⚠ une ligne de poids 1 rapproche DÉJÀ les deux atomes (mesuré ${moved(one).toFixed(3)} Å)`);
/* ⚖ CE QUE LE POIDS ⚖ DOIT PROUVER, ET QUI CHANGE DE MESURE AVEC LA CORRECTION DU PLAFOND
   DU CHAMP (voir `STRUCTURE_CALC_MD_SPEED_FACTOR`) : la ligne, elle, AMÈNE la distance dans
   la tolérance de son puits plat, et la première à y arriver est la plus lourde — un
   « gain » final en Å (l'ancienne mesure) n'a plus de sens, puisque le puits plat s'arrête
   à sa tolérance : mesuré, les trois poids finissent à |d − cible| = 0.24 Å (la tolérance
   elle-même, le thermostat faisant fluctuer la distance dedans), tandis que SANS ligne la
   même trajectoire ne gagne que 0.24 Å en 300 pas et reste à 0.90 Å de la cible. */
ok(away(one) <= STRUCTURE_CALC_RESTRAINT_TOLERANCE + 1e-9,
  `⚠ la ligne amène la distance DANS la tolérance de son puits plat (mesuré |d − cible| = ${away(one).toFixed(3)} Å ≤ ${STRUCTURE_CALC_RESTRAINT_TOLERANCE})`);
ok(away(none) > 2 * STRUCTURE_CALC_RESTRAINT_TOLERANCE,
  `…alors que SANS ligne la même trajectoire n'y arrive pas (mesuré ${away(none).toFixed(3)} Å, la dérive thermique seule — elle peut TRAVERSER la bande par hasard, pas y rester)`);
ok(one.heldAt >= 0 && hundred.heldAt >= 0, `…avec une ligne : tenue (poids 1 au pas ${one.heldAt}, poids 100 au pas ${hundred.heldAt})`);
ok(hundred.heldAt <= one.heldAt && ten.heldAt <= one.heldAt,
  `⚠ …et la ligne PLUS LOURDE y arrive PLUS TÔT (poids 1 : pas ${one.heldAt} · poids 10 : pas ${ten.heldAt} · poids 100 : pas ${hundred.heldAt}) — c'est là que le poids ⚖ mord`);
ok(ten.heldAt < one.heldAt, '…le poids 10 est le premier cran où le gain de temps se voit');
eq([one.run.torque.field, one.run.torque.restraint], [STRUCTURE_CALC_MD_MAX_TORQUE, STRUCTURE_CALC_MD_MAX_RESTRAINT_TORQUE],
  '…et le rapport du geste donne LES DEUX plafonds (le champ, la table)');
ok(none.rep.count === 0, 'la dynamique sans contrainte n’a aucune ligne à rapporter');
ok(hundred.rep.count === 1, '…et celle à une ligne en a une, mesurée');

/* ── 4 · LE PANNEAU — LES TROIS RÉGLAGES SONT BRANCHÉS ─────────────────────── */
const VIEW = read('./src/components/NMRMoleculeViewer.jsx');
const MODULE = read('./src/utils/structureCalc.js');
const FIELD = read('./src/utils/forceFieldKcal.js');

/* 💧 LA BOÎTE : son état, son champ, sa persistance, ET son entrée. */
has(VIEW, 'const [mdBox, setMdBox] = useState(STRUCTURE_CALC_SOLVENT_BOX);',
  '📦 l’arête de la boîte est un état du panneau, avec le défaut du module');
has(VIEW, 'structureCalcSolventIsExplicit(mdSolvent) && (',
  '…et l’entrée n’apparaît QU’AVEC le modèle explicite (les implicites n’ont pas de géométrie)');
has(VIEW, 'aria-label="Edge of the explicit water box, in angstroms"',
  '…elle est nommée pour ce qu’elle est');
has(VIEW, 'mdRunBox: mdBox, targetFunction: calcTargetFunction,',
  '…et les DEUX réglages survivent à un rechargement (sous les clefs du module)');
has(VIEW, 'if (Number.isFinite(s.mdRunBox)) setMdBox(Math.max(STRUCTURE_CALC_SOLVENT_BOX_MIN,',
  '…ils sont relus au montage, bornés par le module');
has(VIEW, 'const box = explicitSolventOf({', '…la boîte est construite par le module (aucun atome écrit dans le JSX)');
has(VIEW, 'const calcBoxNote = (geom) => {', '…et une phrase la DIT dans le rapport d’un geste');
eq(VIEW.split('const calcEngineGeometry').length - 1, 1,
  '⚠ un seul `calcEngineGeometry` : la boîte y est ajoutée pour les QUATRE gestes du champ');

/* 🎯 LA FONCTION CIBLE : son état, son sélecteur, et les quatre gestes qui la portent. */
has(VIEW, 'const [calcTargetFunction, setCalcTargetFunction] = useState(STRUCTURE_CALC_TARGET_FUNCTION);',
  '🎯 la fonction cible est un état du panneau 🧬, avec le défaut du module');
has(VIEW, 'aria-label="Target function of the structure calculation"',
  '…son sélecteur existe dans la rangée des réglages du calcul');
has(VIEW, '{STRUCTURE_CALC_TARGET_FUNCTIONS.map((t) => (',
  '…et il écrit la liste DU MODULE (le panneau n’invente aucune règle)');
has(VIEW, 'const calcTargetFunctionNote = (id) => {', '…une phrase la dit dans le rapport d’un geste');
eq(VIEW.split('targetFunction: calcTargetFunction,').length - 1, 5,
  '⚠ les QUATRE gestes du champ — ▶ Run, ▶ MD, ⚒ Minimise, ⟳ Energy — portent la même fonction cible, plus la clef de session qui la garde');
has(MODULE, 'export const STRUCTURE_CALC_TARGET_FUNCTIONS = FF_TARGET_FUNCTIONS;',
  '…et la liste est CELLE DU CHAMP (pas une seconde copie dans le protocole)');

/* ⚖ LE POIDS : la comparaison avant/après, que le rapport donne désormais. */
has(VIEW, 'const calcRestraintEffect = (before, after, list) => {',
  '⚖ le rapport compare la table AVANT et APRÈS le geste (c’est ce qui montre que le poids mord)');
has(VIEW, 'const restBefore = restraintReportOf({ positions: base, restraints: list });',
  '…la moitié « avant » est relue au départ, par la MÊME lecture du module');
eq(VIEW.split('+ calcRestraintEffect(restBefore, rep, list)').length - 1, 2,
  '…et les DEUX gestes qui bougent la molécule la donnent (▶ MD et ⚒ Minimise)');
has(MODULE, 'const restCap = Math.min(maxRestTorque, maxTorque * engine.crossRestraintWeightOf(ctx));',
  '…le budget de couple d’une contrainte SUIT son poids ⚖ (plafonné), c’est la correction mesurée');
has(MODULE, 'const torqueRest = -(engine.crossRestraintCost(ctx, up.map)',
  '…et le couple de la famille des distances est lu À PART des familles qui peuvent exploser');

/* 🪢 LE GRAPHE SUIT LE MOUVEMENT — la référence répond même quand la lecture est vide. */
has(VIEW, 'ramaShownRef.current = !!rama || !!ramaDock;',
  '⚠ le dock 🪢 OUVERT compte comme « le graphe est à l’écran » : sinon une lecture vide laissait la référence à faux, et plus rien ne se relisait pendant la dynamique');
has(VIEW, 'const ramaReadStructureRef = useRef(null);',
  '…et la lecture automatique est retentée UNE fois par molécule (pas une fois par page)');
ok(!VIEW.includes('if (rama || ramaMsg) return;'),
  '⚠ …l’ancienne garde « une seule tentative PAR PAGE » a disparu du viewer (elle laissait un graphe vide pour toujours)');
has(MODULE, 'export const STRUCTURE_CALC_MD_MAX_RESTRAINT_TORQUE', '…et le plafond est une CONSTANTE nommée du module');

/* LE CHAMP — les ajouts sont dans le module du champ, pas dans le JSX. */
has(FIELD, 'export const FF_TIP3P = {', '💧 les paramètres TIP3P sont dans le module du champ, une seule fois');
has(FIELD, 'export const ffRepulsionCostOf = (r, pair) => {', '🎯 la répulsion seule y est aussi');
has(FIELD, 'surface = true,', '⚠ …et la liste de surface reste le défaut (une fonction cible sans surface la vide)');
eq([ffElementOf('OW').radius * 2, ffElementOf('OW').epsilon], [FF_TIP3P.ow.sigma, FF_TIP3P.ow.epsilon],
  '…le σ et le ε d’un oxygène d’eau sont ceux de TIP3P (r_min = σ, contrat de la table)');

/* ── 5 · 💧 LA BOÎTE SE DESSINE — la remarque de cette session ───────────────────────────
   « I still do not see the water in the MD ». Elle était EXACTE : la boîte vivait dans la
   physique (le moteur tournait sur ses eaux, le rapport les comptait) et nulle part dans la
   scène. Elle entre maintenant par le chemin d’une molécule ordinaire (le préfixe `solv_`, le
   même critère que la famille `fam_`), écrite en PDB avec des HETATM HOH — donc reconnue
   comme de l’EAU (la sélection du dossier) et stylée comme telle, sans qu’un seul atome soit
   écrit dans le JSX. */
has(VIEW, 'const calcWaterBoxPdbText = (geom) => {',
  '💧 les eaux sont écrites en PDB (HETATM HOH) — NGL les reconnaît donc comme de l’EAU');
has(VIEW, 'HETATM${String(serial).padStart(5)} ${name} HOH W',
  '…un résidu HOH par molécule, avec OW et HW (la géométrie TIP3P du module, pas un atome écrit ici)');
has(VIEW, 'CONECT${String(serialOf[i - solute]).padStart(5)}${String(serialOf[j - solute]).padStart(5)}',
  '…et leur O–H en CONECT (les seules liaisons qu’une eau TIP3P possède)');
has(VIEW, 'const calcDrawWaterBox = async (geom) => {',
  '…et la boîte entre dans la scène comme une molécule de la barre des molécules');
has(VIEW, "extraCompsRef.current.filter((e) => String(e.id).startsWith('solv_'))",
  '⚠ UNE SEULE BOÎTE À LA FOIS (le préfixe `solv_`, le même critère que `fam_`)');
has(VIEW, 'const label = `💧 water box ${s.edge} Å · ${s.molecules} TIP3P`;',
  '…elle se nomme par ce que le module a construit (son arête, son nombre d’eaux — aucun chiffre du JSX)');
eq(VIEW.split('calcDrawWaterBox(geom).catch(() => {});').length - 1, 3,
  '⚠ les TROIS gestes qui construisent la boîte la dessinent (▶ Run du 🧬, ▶ MD et ⚒ Minimise)');
has(VIEW, 'They are drawn in the view as their own molecule',
  '…et le rapport du geste le DIT, donc le lecteur sait où regarder (et comment la cacher)');


console.log(`_target_solvent_torque_test.mjs — ${passed} assertions OK `
  + '(💧 la boîte d’eau explicite — géométrie TIP3P, indices d’origine intacts, sites écartés, arête refusée si trop petite, '
  + 'ET DESSINÉE dans la vue comme une molécule de la barre (HETATM HOH, préfixe `solv_`) ; '
  + '🎯 la fonction cible DYANA — répulsion seule, sans charges, sans surface, atomes unis, lue par le champ ET par les quatre gestes ; '
  + '⚖ et le poids d’une ligne qui MORD vraiment sur la dynamique, plafond de couple séparé)');

