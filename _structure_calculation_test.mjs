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
        chemin qu'une torsion, et la note qui dit ce que ce calcul n'est PAS.

   Run: node _structure_calculation_test.mjs
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dihedralDeg } from './src/utils/torsionDrive.js';
import {
  STRUCTURE_CALC_DEFAULT_STARTS, STRUCTURE_CALC_MAX_STARTS,
  STRUCTURE_CALC_DEFAULT_KEEP, STRUCTURE_CALC_MAX_KEEP,
  STRUCTURE_CALC_SEED, STRUCTURE_CALC_SEED_STEP, STRUCTURE_CALC_RESTRAINT_TOLERANCE,
  STRUCTURE_CALC_PASSES, STRUCTURE_CALC_ESCAPES, STRUCTURE_CALC_MAX_RESTRAINTS,
  rotatableBondsOf, randomTorsionsOf, channelReadingsOf, restraintListOf,
  restraintReportOf, scoreStructureOf, structureAttemptOf, rankStructureAttempts,
  familySpreadOf, familyRestraintsOf, structureCalculationOf,
} from './src/utils/structureCalc.js';

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
eq(STRUCTURE_CALC_ESCAPES, 0,
  'les 🎲 bottes sont ÉTEINTES par défaut ici : la diversification, c’est n (le panneau envoie le sien si on les veut)');
ok(STRUCTURE_CALC_PASSES >= 2, 'un départ reçoit au moins deux balayages des contraintes');
ok(STRUCTURE_CALC_MAX_RESTRAINTS >= 10, 'le module accepte une liste de contraintes utilisable');

/* LE PROTOCOLE, LA FONCTION CIBLE ET LE TIRAGE VIENNENT DU ⚒ — jamais d'une seconde
   table, d'une seconde descente ou d'un second générateur. */
has(MODULE, "} from './geometryRelax.js';", 'le module importe le module du ⚒');
for (const name of ['buildModelGeometry', 'relaxGeometry', 'buildRelaxTerms', 'energyOf',
  'bondGraphOf', 'bondSideOf', 'badContactsOf', 'clashReportOf', 'makeRelaxRandom']) {
  has(MODULE, name, `…et il emprunte « ${name} » (aucune seconde implémentation)`);
}
has(RELAX, 'export const buildModelGeometry', '⚠ le protocole « model build » est BIEN celui de utils/geometryRelax.js');
has(RELAX, 'export const relaxGeometry', '…et la descente qui conduit une distance aussi');
has(RELAX, 'export const makeRelaxRandom', '…et le générateur du ⚒ est le seul générateur du dossier');
ok(!/(mulberry32\s*=|function mulberry32|Math\.random\()/.test(MODULE),
  '⚠ donc AUCUN second générateur ici — ni mulberry32 recopié, ni Math.random (le nom n’apparaît que pour dire d’où vient le tirage)');
has(MODULE, "import { dihedralDeg, planTorsion } from './torsionDrive.js';",
  'le dièdre se RELIT et se POSE avec les deux fonctions du dossier');
has(MODULE, "import { rigidTransform } from './structureFit.js';",
  '…et la dispersion de la famille passe par le solveur de superposition du dossier');
has(RUN3, 'export const rigidTransform', '…qui est bien celui-là (kabsch de utils/mdAnalysis.js)');
eq([...MODULE.matchAll(/from '([^']+)';/g)].map((m) => m[1]).sort(),
  ['./geometryRelax.js', './structureCalc.js', './structureFit.js', './torsionDrive.js'].filter((p) => p !== './structureCalc.js').sort(),
  '⚠ le module n’importe QUE le ⚒, le dièdre et la superposition — rien d’autre (aucun écran, aucun NGL)');
ok(!/(positionFromArray\(|updateRepresentations\(|document\.|window\.requestAnimationFrame)/.test(MODULE),
  'le module est PUR : il ne touche à aucun tableau de coordonnées et à aucune fenêtre');
for (const fn of ['rotatableBondsOf', 'randomTorsionsOf', 'restraintListOf', 'restraintReportOf',
  'scoreStructureOf', 'structureAttemptOf', 'rankStructureAttempts', 'familySpreadOf',
  'structureCalculationOf']) {
  has(MODULE, `export const ${fn} =`, `le module exporte « ${fn} »`);
}

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

/* ── 4 · LE PROTOCOLE DU ⚒ SUR UN DÉPART, EXÉCUTÉ ─────────────────────────────
   « From each of these n structure the protocol of “model build” is applied to
   respect the distance constraints. » La sonde prend une chaîne dont les deux bouts
   sont à 4.62 Å, demande 3.90 Å, et MESURE ce qui arrive — puis demande l'impossible
   (1.00 Å) et vérifie que le rapport le DIT au lieu de le prétendre. */
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
  restraints: [{ i: 0, j: 5, target: 3.9 }], index: 0, draw: false,
});
eq(fix.ok, true, 'le départ sans tirage passe par le protocole du ⚒ (`draw: false`)');
eq(fix.draw.turned, 0, '…aucun dièdre tiré : c’est la molécule reçue qui est construite');
eq(fix.restraint.violations, 0, '⚠ la distance demandée est RAPPROCHÉE : plus une seule contrainte hors tolérance');
eq(fix.reason, 'converged', '…et le départ le dit (« converged »)');
ok(fix.restraint.worst.abs <= STRUCTURE_CALC_RESTRAINT_TOLERANCE,
  `…à ${fix.restraint.worst.abs.toFixed(4)} Å près (la tolérance est ${STRUCTURE_CALC_RESTRAINT_TOLERANCE} Å)`);
ok(fix.protocol.drove >= 1 && fix.protocol.reached >= 1,
  '⚠ …par le protocole du ⚒ : la distance a été CONDUITE, et la descente annonce qu’elle l’a atteinte');
ok(fix.protocol.prep !== null && typeof fix.protocol.prep.reason === 'string',
  '…après une PRÉPARATION par le construit automatique (le scan de la chimie et du cœur dur)');
ok(fix.moved >= 2, `…et ${fix.moved} atomes ont bougé de la molécule reçue`);
const fixed = geometryOf({ positions: fix.positions, bonds: hexane.bonds });
ok(Math.max(...fixed.lengths.map((d) => Math.abs(d - LEN))) < 0.05,
  '⚠ …sans casser la chimie : toutes les liaisons restent à 1.54 Å ± 0.05');
ok(Math.max(...fixed.angles.map((d) => Math.abs(d - ANG))) < 2,
  '…et tous les angles à 109.47° ± 2 — la géométrie est TENUE pendant le geste');
ok(fix.bondRms < 0.01 && fix.angleRms < 1,
  `…le rapport le chiffre : liaisons ${fix.bondRms.toFixed(5)} Å rms, angles ${fix.angleRms.toFixed(3)}° rms`);

const hard = structureAttemptOf({
  positions: hexane.positions, elements: hexane.elements, bonds: hexane.bonds,
  restraints: [{ i: 0, j: 5, target: 1.0 }], index: 0, draw: false,
});
eq(hard.restraint.violations, 1, '⚠ une distance IMPOSSIBLE n’est pas prétendue atteinte : elle reste en défaut');
ok(hard.restraint.worst.distance > 1.0 + STRUCTURE_CALC_RESTRAINT_TOLERANCE,
  `…et le rapport donne la distance RÉELLEMENT obtenue (${hard.restraint.worst.distance.toFixed(3)} Å au lieu de 1.00)`);
eq(hard.reason, 'stalled', '…avec la raison du module : la descente s’est posée sans pouvoir gagner plus');
ok(hard.protocol.passCount >= 2, '…après plus d’un balayage (il a réessayé avant de se poser)');
ok(hard.score > fix.score * 10, `…et son score est bien pire (${hard.score.toFixed(1)} contre ${fix.score.toFixed(3)})`);
ok(hard.protocol.drove >= 1 && hard.protocol.reached === 0,
  '⚠ …les gestes ont été TENTÉS (drove ≥ 1) et AUCUN n’a atteint sa cible (reached = 0) : les deux chiffres sont dits');

/* LA NOTE — elle préfère ce qui respecte la contrainte, et l'empilement coûte. */
const good = scoreStructureOf({
  positions: hexane.positions, elements: hexane.elements, bonds: hexane.bonds,
  restraints: [{ i: 0, j: 5, target: 4.619948447180539 }],
});
const bad = scoreStructureOf({
  positions: hexane.positions, elements: hexane.elements, bonds: hexane.bonds,
  restraints: [{ i: 0, j: 5, target: 3.9 }],
});
near(good.pair, 0, 'une contrainte respectée ne coûte RIEN dans la fonction cible', 1e-9);
ok(bad.pair > 0, '…tandis qu’une contrainte violée coûte (le terme `pair` de la fonction cible du ⚒)');
ok(good.score < bad.score, '⚠ donc la note préfère le modèle qui respecte la distance demandée');
ok(Math.abs(good.score - (good.total + good.clashPenalty)) < 1e-9,
  '⚠ `score` = la fonction cible du ⚒ + la pénalité d’empilement — et le rapport donne les deux');
ok(good.bond > 0 && good.angle > 0, '…la fonction cible est bien celle du ⚒ (liaisons ET angles dedans)');
eq(scoreStructureOf({}).ok, false, 'sans coordonnées, la note est refusée (score infini) au lieu d’un zéro trompeur');

const stacked = chainOf(6);
for (let k = 0; k < 3; k += 1) { stacked.positions[k] = 0; stacked.positions[15 + k] = 0; }
const stackScore = scoreStructureOf({
  positions: stacked.positions, elements: stacked.elements, bonds: stacked.bonds,
  restraints: [{ i: 0, j: 5, target: 3.9 }],
});
ok(stackScore.clashes.count >= 1, '⚠ deux atomes au même endroit sont COMPTÉS comme empilés');
ok(stackScore.clashPenalty > 0, '…et la pénalité d’empilement du ⚒ les fait payer');
ok(stackScore.contact > 0, '…le CŒUR DUR de la fonction cible aussi (le couple est dans son recouvrement)');
eq(stackScore.clashes.minDistance, 1.45, 'le seuil annoncé est celui du module (RELAX_CLASH_DISTANCE)');

/* ── 5 · LE CALCUL ENTIER — n DÉPARTS, m RETENUES ─────────────────────────────
   « generate n structures […] the final result is scored. the best m structures are
   retained. » La sonde demande n = 4, m = 2, et vérifie que les quatre ont été
   calculées, que les deux retenues sont bien les deux meilleures, et que le MÊME
   appel redonne le même résultat au chiffre près. */
const spec = {
  positions: hexane.positions, elements: hexane.elements, bonds: hexane.bonds,
  restraints: [{ i: 0, j: 5, target: 3.9 }], starts: 4, keep: 2, escapes: 0,
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
  restraints: [{ i: 0, j: 19, target: 4.0 }], starts: 4, keep: 3, escapes: 0,
});
eq(folded.tried, 4, 'quatre départs');
ok(folded.ranking.filter((r) => r.violations === 0).length >= 2,
  `⚠ au moins deux départs respectent la distance demandée (${folded.ranking.filter((r) => r.violations === 0).length} sur 4)`);
ok(folded.ranking.every((r) => r.clashes === 0 && r.contacts === 0),
  '⚠ AUCUN modèle rendu n’a deux atomes l’un sur l’autre : ni sous 1.45 Å, ni dans leur cœur dur (0.6 × les rayons de Bondi)');
ok(folded.ranking.every((r) => r.bondRms < 0.01),
  '…et les liaisons tiennent (rms < 0.01 Å sur une chaîne pliée de 153 Å à 4 Å)');
near(folded.retained[0].restraint.worst.distance, 4.0,
  '…le meilleur modèle finit à sa cible', STRUCTURE_CALC_RESTRAINT_TOLERANCE);
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

/* ── 6 · LE PANNEAU DU VIEWER — 🧬 LE BOUTON, LES DEUX CHAMPS, LA LISTE, LES m ─── */
has(VIEW, "} from '../utils/structureCalc';", 'le viewer importe le module du calcul de structure');
has(VIEW, 'structureAttemptOf, rankStructureAttempts,', '…avec les deux fonctions qui font le travail (un départ, un classement)');
for (const k of ['STRUCTURE_CALC_DEFAULT_STARTS', 'STRUCTURE_CALC_MAX_STARTS', 'STRUCTURE_CALC_DEFAULT_KEEP',
  'STRUCTURE_CALC_MAX_KEEP', 'STRUCTURE_CALC_SEED', 'STRUCTURE_CALC_PASSES', 'STRUCTURE_CALC_MAX_RESTRAINTS',
  'STRUCTURE_CALC_RESTRAINT_TOLERANCE']) {
  has(VIEW, k, `…et la constante « ${k} » (aucune recopie de chiffre dans le panneau)`);
}
has(VIEW, 'const [showCalcPanel, setShowCalcPanel] = useState(false);', 'le panneau s’ouvre et se ferme par son bouton');
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
has(calcPanel, 'onClick={() => setShowCalcPanel((v) => !v)}', 'le bouton 🧬 ouvre le panneau');
has(calcPanel, '🧬 Structure calculation', '…et il dit ce qu’il fait');
has(calcPanel, 'title="🧬 STRUCTURE CALCULATION — the request, verbatim',
  '⚠ …en citant la demande, mot pour mot (le panneau ne se raconte pas une autre histoire)');
has(calcPanel, '⌖ Add the picked pair', 'l’ajout d’une distance passe par le couple piqué (les mêmes 🎯 que le ⚒)');
has(calcPanel, 'aria-label="Number of starting structures n"', 'le champ n dit ce qu’il compte');
has(calcPanel, 'aria-label="Number of retained structures m"', '…et le champ m aussi');
has(calcPanel, 'max={STRUCTURE_CALC_MAX_STARTS}', 'n est borné par la constante du module');
has(calcPanel, 'max={STRUCTURE_CALC_MAX_KEEP}', '…m aussi');
has(calcPanel, 'aria-label={`Target distance for ', 'chaque ligne porte SA cible, modifiable');
has(calcPanel, 'onChange={(e) => calcSetRestraintTarget(r.key, e.target.value)}',
  '…et une frappe la passe au module (aucun chiffre gardé en double)');
has(calcPanel, 'onClick={() => calcRemoveRestraint(r.key)}', 'une ligne se retire (✕)');
has(calcPanel, 'onClick={calcAddRestraint}', '…et ⌖ en ajoute une');
has(calcPanel, 'disabled={calcBusy || !calcRestraints.length}',
  '⚠ ▶ Run est inerte sans une seule distance : la demande est « the user provide the distances »');
has(calcPanel, '▶ Run', 'le bouton du calcul est nommé');
has(calcPanel, 'onClick={calcStop}', '…et le ⏹ a le sien');
has(calcPanel, '⏹ Stop', '…nommé lui aussi');
has(calcPanel, '⇢ moves {relaxRadius} · ⇉ stages {relaxStageStep} · 🎲 escapes {relaxEscapes}',
  '⚠ les réglages du ⚒ qui s’appliquent à chaque descente sont MONTRÉS, pas cachés');
has(calcPanel, 'calcWhyOf(r.reason)', 'la colonne « how it ended » traduit la raison du module');
has(calcPanel, '{ranked.ranking.map((r) => {', 'TOUTES les tentatives sont listées, classées');
has(calcPanel, '{r.satisfied}/{r.satisfied + r.violations}', '…avec les distances respectées, en clair');
has(calcPanel, '{r.score.toFixed(1)}', '…et le score du module, tel quel');
has(calcPanel, 'const inFamily = r.rank <= ranked.retained.length;',
  '⚠ les m RETENUES sont marquées comme telles (et elles seules portent des coordonnées)');
has(calcPanel, '⤓ Load', '…et chacune s’écrit à l’écran par le bouton ⤓ Load');
has(calcPanel, 'onClick={() => calcWriteStructure(model, ranked)}', '…qui passe par le writer commun');
has(calcPanel, 'The kept family', 'la famille est décrite (ce que chaque distance y mesure, et sa dispersion)');
has(calcPanel, 'What this calculation is NOT', '⚠ et le panneau dit ce que ce calcul n’est PAS');
has(calcPanel, 'ranked.comp !== componentRef.current',
  '⚠ …et il prévient quand la famille appartient à une AUTRE molécule que celle à l’écran');

/* LE GESTE, DANS LE SOURCE — un départ par tranche, le classement par le module, et
   l'écriture par le MÊME chemin qu'une torsion. */
const runSrc = VIEW.slice(
  VIEW.indexOf('const runStructureCalculation = () => {'),
  VIEW.indexOf('const calcStop = () => {'),
);
ok(runSrc.length > 1500, `le calcul est bien branché (${runSrc.length} caractères)`);
has(runSrc, 'structureAttemptOf({', '⚠ chaque départ est UN appel au module pur (aucune descente recopiée)');
has(runSrc, 'index: attempts.length', '…numéroté par son rang de tirage (c’est ce qui fait sa graine)');
has(runSrc, 'seed: STRUCTURE_CALC_SEED', '…avec la graine FIXE du dossier (le même n redonne la même famille)');
has(runSrc, 'restraints: list.map((r) => ({ i: r.i, j: r.j, target: r.target }))',
  '…et les distances de l’utilisateur, telles quelles');
has(runSrc, 'window.setTimeout(step, 0)', '⚠ un départ par tranche : la page reste vivante pendant le calcul');
has(runSrc, 'calcRunRef.current !== run', '…et le jeton arrête la tranche suivante (⏹, ou une autre molécule)');
has(runSrc, 'rankStructureAttempts({ attempts, keep: m })',
  '⚠ le classement est celui du module : le panneau ne choisit pas les m à sa place');
has(runSrc, 'calcWriteStructure(ranked.retained[0], ranked)', 'le meilleur est écrit tout de suite');
has(runSrc, 'finishRelaxPlayback();', '⚠ …après avoir TERMINÉ un ⚒ qui jouait encore (jamais deux écritures ensemble)');
has(runSrc, 'torsionUndoRef.current = {', '⚠ et le ↺ est armé AVANT toute écriture : la molécule d’avant est gardée');
ok(runSrc.indexOf('torsionUndoRef.current = {') < runSrc.indexOf('step();'),
  '…la photographie du ↺ est prise avant le premier départ, pas après');
const writeCalc = VIEW.slice(
  VIEW.indexOf('const calcWriteStructure = (retained, ranked) => {'),
  VIEW.indexOf('const runStructureCalculation = () => {'),
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
has(writeCalc, 'ranked.comp !== comp',
  '⚠ une famille ne peut pas être écrite sur une AUTRE molécule : l’écriture est refusée, et le panneau le dit');
has(runSrc, 'if (componentRef.current !== comp) {',
  '⚠ …et un calcul en cours s’arrête de lui-même si la molécule change, en le DISANT');
has(runSrc, 'setCalcResult({ ...ranked, comp, structure })',
  '…la famille est marquée de SA molécule au moment où elle est classée');

console.log(`_structure_calculation_test.mjs — ${passed} assertions OK (les bornes et les emprunts du module,`
  + ' le lecteur des dièdres EXÉCUTÉ sur une chaîne, un cycle et une double liaison, le tirage REJOUÉ au'
  + ' chiffre près (longueurs et angles intacts, côté ancré bit à bit), le protocole du ⚒ qui rapproche une'
  + ' distance demandée et qui DIT celle qu’il ne peut pas atteindre, la note qui préfère ce qui respecte la'
  + ' contrainte, n départs classés par score croissant avec les m premières GARDÉES, la dispersion de la'
  + ' famille après superposition optimale, et le panneau 🧬 du viewer : les distances, n, m, ▶ Run / ⏹ Stop,'
  + ' le tableau classé, ⤓ Load, et l’écriture par le chemin d’une torsion)');
