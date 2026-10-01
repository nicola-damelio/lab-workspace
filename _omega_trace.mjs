/* =========================================================================
   _omega_trace.mjs — SCRATCH (diagnostic, not a test).

   OÙ le ω cis apparaît-il ? Le tirage tire TOUTES les charnières
   (`rotatableBondsOf`, liaison peptidique C–N comprise) à une valeur uniforme ;
   les trois moteurs « protégés » (recuit, dynamique, minimisation) ne refusent
   qu'un pas qui AUGMENTE le coût d'ω — donc un ω tombé du côté cis ne peut plus
   revenir. Ce script mesure : (a) les ω imposés par le tirage, (b) l'écart à 180°
   après CHAQUE étape du protocole, (c) ce que le rapport du module en dit.

   Run: node _omega_trace.mjs   (rapport écrit dans _omega_trace_out.txt)
   ========================================================================= */
import { readFileSync, writeFileSync } from 'node:fs';
import { dihedralDeg } from './src/utils/torsionDrive.js';
import {
  backboneTorsionsOf, peptideOmegasOf, randomTorsionsOf, structureAttemptFrames,
  omegaPenaltyOf, secondaryDihedralRestraintsOf, SS_DIHEDRAL_TOLERANCE,
} from './src/utils/structureCalc.js';
import { FF_DIHEDRAL_CENTRE_K } from './src/utils/forceFieldKcal.js';

const LINES = [];
const say = (s = '') => { LINES.push(s); console.log(s); };

/* ── LE BUILDING DE LA PAGE, TEL QUEL (même extraction que _kc_sweep.mjs) ── */
const src = readFileSync('src/components/NMRSections.jsx', 'utf8');
const extract = (name) => {
  const start = src.indexOf(`const ${name} = `);
  if (start === -1) throw new Error('missing ' + name);
  const bodyStart = start + `const ${name} = `.length;
  let depth = 0;
  let i = bodyStart;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if (ch === ';' && depth === 0) break;
  }
  return src.slice(start, i + 1) + '\n';
};
let code = '';
['_vecSub', '_vecAdd', '_vecScale', '_vecDot', '_vecCross', '_vecNorm',
  '_vecNormalize', '_deg2rad', 'nerfPlace', 'PROTEIN_BB', 'SS_TORSIONS', 'ssTorsionAt',
  'buildProteinBackbone'].forEach((n) => { code += extract(n); });
const B = new Function(code + '\nreturn { buildProteinBackbone };')();

const N_RES = 12;
const SS = 'H'.repeat(N_RES);
const residues = B.buildProteinBackbone('A'.repeat(N_RES), SS);
const elements = [];
const positions = [];
const bonds = [];
const idx = { N: [], CA: [], C: [], O: [] };
const push = (p, el) => {
  const k = elements.length;
  elements.push(el);
  positions.push(p[0], p[1], p[2]);
  return k;
};
let prevC = -1;
residues.forEach((r) => {
  const n = push(r.N, 'N');
  const ca = push(r.CA, 'C');
  const c = push(r.C, 'C');
  const o = r.O ? push(r.O, 'O') : -1;
  bonds.push({ i: n, j: ca, order: 1 }, { i: ca, j: c, order: 1 });
  if (o >= 0) bonds.push({ i: c, j: o, order: 1 });
  if (prevC >= 0) bonds.push({ i: prevC, j: n, order: 1 });
  prevC = c;
  idx.N.push(n); idx.CA.push(ca); idx.C.push(c); idx.O.push(o);
});
const count = elements.length;
const at = (flat, k) => [flat[k * 3], flat[k * 3 + 1], flat[k * 3 + 2]];
const torsions = backboneTorsionsOf({ elements, bonds, atomCount: count });
const omegas = peptideOmegasOf({ elements, bonds, atomCount: count });

/* les liens ω : leur clé de charnière, leur dièdre, et l'écart à 180° */
const key = (i, j) => (i < j ? `${i}-${j}` : `${j}-${i}`);
const omegaKeys = new Map(omegas.map((o) => [key(o.c, o.n), o]));
const devsOf = (flat) => omegas.map((o) => {
  const [a, b, c, d] = o.probeAtoms;
  const deg = dihedralDeg(at(flat, a), at(flat, b), at(flat, c), at(flat, d));
  return deg == null ? null : Math.abs(((deg - 180 + 540) % 360) - 180);
});
const show = (flat) => devsOf(flat)
  .map((v) => (v == null ? '  — ' : v.toFixed(1).padStart(5))).join(' ');
const hbOf = (flat) => {
  const out = [];
  for (let i = 0; i + 4 < N_RES; i += 1) {
    out.push(Math.hypot(
      at(flat, idx.O[i])[0] - at(flat, idx.N[i + 4])[0],
      at(flat, idx.O[i])[1] - at(flat, idx.N[i + 4])[1],
      at(flat, idx.O[i])[2] - at(flat, idx.N[i + 4])[2],
    ));
  }
  return out.map((v) => v.toFixed(2).padStart(5)).join(' ');
};
const rmsOf = (flat) => {
  let s = 0; let n = 0;
  for (let i = 0; i < N_RES; i += 1) {
    if (i > 0) {
      const p = dihedralDeg(at(flat, idx.C[i - 1]), at(flat, idx.N[i]), at(flat, idx.CA[i]), at(flat, idx.C[i]));
      s += (((p + 57 + 540) % 360) - 180) ** 2; n += 1;
    }
    if (i < N_RES - 1) {
      const q = dihedralDeg(at(flat, idx.N[i]), at(flat, idx.CA[i]), at(flat, idx.C[i]), at(flat, idx.N[i + 1]));
      s += (((q + 47 + 540) % 360) - 180) ** 2; n += 1;
    }
  }
  return Math.sqrt(s / n);
};


const start = positions.slice();
say('═'.repeat(96));
say(`§ LA MOLÉCULE — ${N_RES} résidus ALA « ${SS} » · ${count} atomes · ${bonds.length} liaisons`);
say(`  liaisons peptidiques lues (peptideOmegasOf) : ${omegas.length}`);
say(`  ω au départ (écart à 180°) : ${show(start)}`);
say(`  φ/ψ dev rms au départ : ${rmsOf(start).toFixed(1)}° · i→i+4 : ${hbOf(start)}`);
say('');

/* ── (1) LE TIRAGE ──────────────────────────────────────────────────────────── */
const drawn = randomTorsionsOf({
  positions: start, elements, bonds, atomCount: count, seed: 20261001,
});
const turnedOmega = drawn.turned.filter((t) => omegaKeys.has(key(t.i, t.j)));
say('§ 1 · LE TIRAGE DES DIÈDRES');
say(`  charnières tournées : ${drawn.drawn} · dont des liaisons PEPTIDIQUES : ${turnedOmega.length}`);
say('  angles IMPOSÉS à ces ω (uniforme dans (−180, 180)) :');
say(`    ${turnedOmega.map((t) => t.drawn.toFixed(1).padStart(7)).join(' ')}`);
say(`  ω après le tirage : ${show(drawn.positions)}`);
const afterDraw = devsOf(drawn.positions);
const outside = afterDraw.filter((v) => v > 30).length;
const cisSide = afterDraw.filter((v) => v > 120).length;
say(`    ${outside}/${omegas.length} hors du plateau (± 30°) · ${cisSide} DU CÔTÉ CIS (au-delà de 120°)`);
say('  le coût ω du champ (k = 20, cos 2) à ces écarts :');
say(`    ${afterDraw.map((v) => (v == null ? '  —  '
  : (20 * (1 - Math.cos(2 * (v - 30) * Math.PI / 180)) / 2).toFixed(1).padStart(5))).join(' ')}`);
say('  ⇒ à 180° (cis) il vaut 5.0 : MOINS que le sommet de la barrière (20.0 à 120°) —');
say('    c\'est un SECOND minimum, et les moteurs protégés n\'acceptent que de DESCENDRE.');
say('');

/* ── (2) LE PROTOCOLE, ÉTAPE PAR ÉTAPE ─────────────────────────────────────── */
const conv = secondaryDihedralRestraintsOf({
  secondaryStructure: SS, torsions, tolerance: SS_DIHEDRAL_TOLERANCE,
  centreK: FF_DIHEDRAL_CENTRE_K,
});
const frames = structureAttemptFrames({
  positions: start.slice(), elements, bonds, restraints: [],
  dihedrals: conv.constraints, draw: true, index: 0, targetFunction: 'dyana', seed: 20261001,
});
const perPhase = new Map();
for (const f of frames) {
  const prev = perPhase.get(f.phase);
  perPhase.set(f.phase, { ...f, first: prev ? prev.first : f });
}
say('§ 2 · LE PROTOCOLE, ÉTAPE PAR ÉTAPE (écart ω à 180° après chaque étape)');
for (const [phase, f] of perPhase) {
  say(`  ${phase.padEnd(9)} : ${show(f.positions)}   φ/ψ rms ${rmsOf(f.positions).toFixed(1)}°`);
}
const last = Array.from(perPhase.values()).pop();
say(`  i→i+4 O···N à la fin : ${hbOf(last.positions)}`);
say('');

/* ── (3) CE QUE LE RAPPORT DU MODULE EN DIT ────────────────────────────────── */
say('§ 3 · LE RAPPORT DU MODULE SUR CES MÊMES COORDONNÉES');
const rep = omegaPenaltyOf({ positions: last.positions, omegas });
say(`  ω lus : ${rep.count} · pénalité ${rep.penalty.toFixed(2)} kcal/mol · hors plateau ${rep.violations}`);
for (const row of rep.list) {
  say(`    lien ${String(row.i).padStart(2)}-${String(row.j).padStart(2)} : ${row.deg.toFixed(2).padStart(8)}°`
    + ` (écart ${row.dev.toFixed(1).padStart(5)}° · coût ${row.cost.toFixed(2)})`);
}
writeFileSync('_omega_trace_out.txt', LINES.join('\n') + '\n', 'utf8');
