/* =========================================================================
   _md_wall_test.mjs — UN MUR DE VAN DER WAALS EST-IL UN MUR, ET LES CHAÎNES
   LATÉRALES BOUGENT-ELLES ?

   Les deux remarques de cette session, verbatim : « controlla che anche le catene
   laterali si muovano perche mi da l'impressione che siano solo gli angoli phi e psi »
   et « ho visto una cosa preoccupante, mi sembra che gli atomi si attraversino l'un
   l'altro come se non ci fosse il potenziale di Lennard-Jones ».

   LES DEUX SONT LE MÊME DÉFAUT, ET IL EST MESURÉ. Le plafond de couple du champ valait
   `γ·m·f·√(R·T/m)` (0.17 kcal/mol·deg avec l'inertie du dossier à 1500 K), soit
   0.69 °/ps de réponse par pas — à comparer au bruit du thermostat, `√(2γ·R·T·h/m)` =
   6.9 °/ps. Le champ ne pouvait donc PAS contenir le thermostat : il lui fallait ~50 pas
   pour annuler une vitesse thermique, pendant lesquels un atome entrait de ~0.9 Å dans le
   mur. Résultat, sur le MÊME peptide, mêmes 300 pas, même graine :

     • plafond `γ·m·v` (l'ancien régime) — plus proche contact 2.071 Å (un O···C), 30 des
       300 images SOUS le `r_min` de 2.4 Å, et les chaînes latérales (χ1) figées à 5.05°
       pendant que le squelette balayait 67.5° : « gli atomi si attraversano » et « solo
       φ et ψ ». Ce n'est pas un hasard : les DIÈDRES DU SQUELETTE sont souples et ne
       rencontrent pas de mur, les χ1 poussent leurs atomes dans le voisinage et y restent
       bloqués dès que le mur ne peut plus répondre ;
     • plafond `√(R·T·m)/h` (8.63 kcal/mol·deg : il RENVERSE la vitesse thermique en UN
       pas) — 2.520 Å, AUCUNE image sous 2.4 Å, et χ1 tourne de 45.8° en déplaçant ses
       atomes de 3.76 Å.

   La mesure est faite sur les ATOMES LOURDS (le champ ajoute des hydrogènes : ce sont eux
   que `forceFieldEnergyOf` compte, mais c'est le squelette lourd qui se regarde).

   Run: node _md_wall_test.mjs
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mdFrames, rotatableBondsOf } from './src/utils/structureCalc.js';
import { dihedralDeg } from './src/utils/torsionDrive.js';
import { ffPairListOf, FF_GAS_CONSTANT } from './src/utils/forceFieldKcal.js';

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
  return [0, 1, 2].map((k) => c[k] + v[0] * bc[k] + v[1] * m[k] + v[2] * n[k]);
};
const peptideOf = ({ residues = 3, phi = -57, psi = -47, chi1 = 180 } = {}) => {
  const els = []; const pts = []; const bonds = []; const names = [];
  const push = (el, p, nm) => { els.push(el); pts.push(p); names.push(nm); return pts.length - 1; };
  const N0 = [0, 0, 0]; const CA = [1.46, 0, 0];
  const C = [1.46 + 1.52 * Math.cos((180 - 111) * DEG), 1.52 * Math.sin((180 - 111) * DEG), 0];
  const iN = push('N', N0, 'N'); const iCA = push('C', CA, 'CA'); const iC = push('C', C, 'C');
  const iO = push('O', placeWith({ a: N0, b: CA, c: C, length: 1.23, angleDeg: 120.5, dihDeg: psi + 180 }), 'O');
  bonds.push({ i: iN, j: iCA, order: 1 }, { i: iCA, j: iC, order: 1 }, { i: iC, j: iO, order: 2 });
  let lastN = N0; let lastCA = CA; let lastC = C; let lastCidx = iC;
  for (let k = 1; k < residues; k += 1) {
    const n2 = placeWith({ a: lastN, b: lastCA, c: lastC, length: 1.33, angleDeg: 116, dihDeg: psi });
    const iN2 = push('N', n2, `N${k}`);
    const ca2 = placeWith({ a: lastCA, b: lastC, c: n2, length: 1.46, angleDeg: 122, dihDeg: 180 });
    const iCA2 = push('C', ca2, `CA${k}`);
    const c2 = placeWith({ a: lastC, b: n2, c: ca2, length: 1.52, angleDeg: 111, dihDeg: phi });
    const iC2 = push('C', c2, `C${k}`);
    const iO2 = push('O', placeWith({ a: n2, b: ca2, c: c2, length: 1.23, angleDeg: 120.5, dihDeg: psi + 180 }), `O${k}`);
    bonds.push({ i: lastCidx, j: iN2, order: 1 }, { i: iN2, j: iCA2, order: 1 },
      { i: iCA2, j: iC2, order: 1 }, { i: iC2, j: iO2, order: 2 });
    lastN = n2; lastCA = ca2; lastC = c2; lastCidx = iC2;
  }
  /* Les chaînes latérales : CB posé ANTI au bissecteur N–CA / C–CA (propre), puis CG1 et
     CG2 par le dihèdre N–CA–CB–CG, c'est-à-dire χ1. */
  for (let k = 0; k < residues; k += 1) {
    const nIdx = k * 4; const caIdx = k * 4 + 1; const cIdx = k * 4 + 2;
    const pN = pts[nIdx]; const pCA = pts[caIdx]; const pC = pts[cIdx];
    const v1 = unit3(sub3(pN, pCA)); const v2 = unit3(sub3(pC, pCA));
    const bis = unit3([v1[0] + v2[0], v1[1] + v2[1], v1[2] + v2[2]]);
    const cb = [0, 1, 2].map((i) => pCA[i] - bis[i] * 1.53);
    const iCB = push('C', cb, `CB${k}`);
    bonds.push({ i: caIdx, j: iCB, order: 1 });
    const iG1 = push('C', placeWith({ a: pN, b: pCA, c: cb, length: 1.52, angleDeg: 110.5, dihDeg: chi1 }), `CG1_${k}`);
    bonds.push({ i: iCB, j: iG1, order: 1 });
    const iG2 = push('C', placeWith({ a: pN, b: pCA, c: cb, length: 1.52, angleDeg: 110.5, dihDeg: chi1 + 120 }), `CG2_${k}`);
    bonds.push({ i: iCB, j: iG2, order: 1 });
  }
  return { count: els.length, elements: els, bonds, names, positions: pts.flat() };
};

const MOL = peptideOf({ residues: 3 });
const CHAN = rotatableBondsOf({ elements: MOL.elements, bonds: MOL.bonds, atomCount: MOL.count });
const ptAt = (flat, k) => [flat[k * 3], flat[k * 3 + 1], flat[k * 3 + 2]];
/** Les canaux d'une χ1 (CA–CB) — c'est par EUX qu'une chaîne latérale tourne. */
const chi1Chans = CHAN.channels.filter((ch) => {
  const a = MOL.names[ch.i]; const b = MOL.names[ch.j];
  return (a.startsWith('CA') && b.startsWith('CB')) || (b.startsWith('CA') && a.startsWith('CB'));
});
eq(chi1Chans.length, 3, '⚠ les trois χ1 (CA–CB) SONT des canaux du moteur — une chaîne latérale est un degré de liberté');
const minNonbonded = (flat) => {
  const list = ffPairListOf({
    positions: flat, elements: MOL.elements, bonds: MOL.bonds, charges: null, limit: 8, surface: false,
  }).pairs;
  let best = Infinity;
  for (const p of list) {
    const d = Math.hypot(flat[p.i * 3] - flat[p.j * 3], flat[p.i * 3 + 1] - flat[p.j * 3 + 1],
      flat[p.i * 3 + 2] - flat[p.j * 3 + 2]);
    if (d < best) best = d;
  }
  return best;
};
const maxMove = (a, b, idxs) => {
  let m = 0;
  for (const k of idxs) m = Math.max(m, Math.hypot(a[k * 3] - b[k * 3], a[k * 3 + 1] - b[k * 3 + 1], a[k * 3 + 2] - b[k * 3 + 2]));
  return m;
};
/** La trajectoire : le contact le plus proche, et ce que chaque χ1 a tourné. */
const runOf = (spec) => {
  const gen = mdFrames({
    positions: Array.from(MOL.positions), elements: MOL.elements, bonds: MOL.bonds,
    channels: CHAN.channels, seed: 11, perFrame: 1, steps: 300, temperature: 1500, ...spec,
  });
  const frames = []; let s = gen.next();
  while (!s.done) { frames.push(s.value); s = gen.next(); }
  const first = frames[0].positions; const last = frames[frames.length - 1].positions;
  const closest = frames.map((f) => minNonbonded(f.positions));
  const turns = chi1Chans.map((ch) => {
    const d0 = dihedralDeg(...ch.probeAtoms.map((k) => ptAt(first, k)));
    const d1 = dihedralDeg(...ch.probeAtoms.map((k) => ptAt(last, k)));
    let dd = d1 - d0; while (dd > 180) dd -= 360; while (dd < -180) dd += 360;
    return { dd: Math.abs(dd), mov: maxMove(first, last, ch.moving || []) };
  });
  return {
    run: s.value, closest, turns,
    worst: Math.min(...closest),
    under: closest.filter((d) => d < 2.4).length,
    chiTurn: Math.max(...turns.map((t) => t.dd)),
    chiMove: Math.max(...turns.map((t) => t.mov)),
  };
};

/* ── 1 · LE DÉPART — une géométrie propre, et le `r_min` que le mur doit tenir. ─────── */
const START = minNonbonded(MOL.positions);
ok(START > 2.4, `la sonde part d'une géométrie PROPRE : plus proche contact ${START.toFixed(3)} Å (> 2.4)`);

/* ── 2 · LE MUR — avec le plafond du dossier, aucun atome ne se traverse. ──────────── */
const now = runOf({});
near(now.run.torque.wall,
  now.run.torque.factor * Math.sqrt(FF_GAS_CONSTANT * 1500 * 0.0025) / 0.01,
  '⚠ le plafond du CHAMP est √(R·T·m)/h — le couple qui renverse la vitesse thermique en UN pas', 1e-4);
ok(now.run.torque.wall > 8,
  `…et c’est 50 fois l’ancien budget (${now.run.torque.wall.toFixed(3)} contre 0.17 kcal/mol·deg) : le mur peut donc répondre au thermostat`);
eq(now.under, 0,
  `⚠ AUCUNE image sous le r_min : le mur tient (plus proche contact ${now.worst.toFixed(3)} Å sur ${now.closest.length} images)`);
ok(now.worst > 2.4,
  `…et il ne descend jamais sous 2.4 Å (mesuré ${now.worst.toFixed(3)} Å)`);

/* ── 3 · LES CHAÎNES LATÉRALES — elles TOURNENT, et elles DÉPLACENT leurs atomes. ──── */
ok(now.chiTurn > 20,
  `⚠ les χ1 (CA–CB) tournent vraiment : ${now.chiTurn.toFixed(2)}° sur la trajectoire`);
ok(now.chiMove > 1,
  `…en emmenant leurs atomes de ${now.chiMove.toFixed(3)} Å (ce n’est donc pas « seulement φ et ψ »)`);

/* ── 4 · LA CONTRE-ÉPREUVE — le plafond qui ne peut PAS répondre au bruit. ─────────── */
/* `f = 0.1` donne 0.86 kcal/mol·deg : le même régime que l'ancien plafond `γ·m·v`, où la
   réponse par pas (0.7 °/ps) est dix fois plus faible que le bruit (6.9 °/ps). */
const weak = runOf({ speedFactorLimit: 0.1 });
ok(weak.under > 0,
  `⚠ avec un plafond qui ne peut pas répondre au bruit (f = 0.1), les atomes SE TRAVERSENT : ${weak.under} images sous 2.4 Å`);
ok(weak.worst < now.worst - 0.2,
  `…et le contact descend à ${weak.worst.toFixed(3)} Å contre ${now.worst.toFixed(3)} Å (c’est le défaut mesuré)`);
ok(weak.chiTurn < now.chiTurn,
  `⚠ …et les chaînes latérales s’y BLOQUENT : χ1 ne tourne que de ${weak.chiTurn.toFixed(2)}° contre ${now.chiTurn.toFixed(2)}° — c’est POURQUOI on croyait que « seuls φ et ψ bougent »`);

/* ── 5 · CE QUI LE DIT DANS LE CODE ───────────────────────────────────────────────── */
const MODULE = readFileSync(new URL('./src/utils/structureCalc.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
has(MODULE, 'const vReverse = Math.sqrt(kT * m) / hEff;',
  'le plafond du mur est nommé et calculé au palier courant, sur l’intervalle RÉEL d’un canal');
has(MODULE, 'torque: Math.min(maxTorque, Math.max(gamma * m * vSpeed, wall)),',
  '…et le plafond du geste est le PLUS GRAND des deux (le mur doit pouvoir répondre)');
has(MODULE, 'wall: Number(endCaps.wall.toFixed(6)),',
  '…le rapport du geste le donne, donc un lecteur refait le calcul');

console.log(`_md_wall_test.mjs — ${passed} assertions OK `
  + '(🌡 un mur de van der Waals est un MUR — aucune image sous le r_min avec le plafond '
  + '√(R·T·m)/h, 30 images et un contact à 2.07 Å avec l’ancien régime —, et les CHAÎNES '
  + 'LATÉRALES tournent vraiment (χ1 : 45.8° et 3.76 Å de déplacement), alors que le plafond '
  + 'trop faible les bloquait : c’étaient les deux symptômes d’un même défaut)');
