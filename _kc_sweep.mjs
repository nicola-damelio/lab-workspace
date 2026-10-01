/* =========================================================================
   _kc_sweep.mjs — SCRATCH (diagnostic, not a test).

   Balaye LE FOND DU PUITS (`FF_DIHEDRAL_CENTRE_K`, le second chiffre de
   `ffDihedralCostOf`) sur le protocole COMPLET du dossier (draw=true, 🎯 dyana)
   et mesure ce que chaque valeur donne : écart φ/ψ, régions 🪢 et i→i+4 O···N.

   Le but : choisir le chiffre par MESURE, pas au goût — kc = 0 doit reproduire
   exactement le défaut d'avant (la fenêtre plate seule), et kc doit ramener
   l'hélice de la page (φ −57°, ψ −47°, ponts H 2.6–3.6 Å).

   Run: node _kc_sweep.mjs   (rapport aussi écrit dans _kc_sweep_out.txt)
   ========================================================================= */
import { readFileSync, writeFileSync } from 'node:fs';
import { dihedralDeg } from './src/utils/torsionDrive.js';
import { ramaRegionOf } from './src/utils/ramachandran.js';
import {
  backboneTorsionsOf, secondaryDihedralRestraintsOf, dihedralPenaltyOf,
  structureAttemptOf, scoreStructureOf, SS_DIHEDRAL_TOLERANCE,
} from './src/utils/structureCalc.js';
import { FF_DIHEDRAL_CENTRE_K } from './src/utils/forceFieldKcal.js';

const LINES = [];
const say = (s = '') => { LINES.push(s); console.log(s); };

/* ── LE BUILDING DE LA PAGE, TEL QUEL (même extraction que _diag_helix.mjs) ── */
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
const at = (flat, k) => [flat[k * 3], flat[k * 3 + 1], flat[k * 3 + 2]];
const torsions = backboneTorsionsOf({ elements, bonds, atomCount: elements.length });

/* φ/ψ, régions et les distances i→i+4 (le substitut chiffré d'un pont H) */
const readChain = (flat) => {
  const rows = [];
  for (let i = 0; i < N_RES; i += 1) {
    const phi = i > 0 ? dihedralDeg(at(flat, idx.C[i - 1]), at(flat, idx.N[i]), at(flat, idx.CA[i]), at(flat, idx.C[i])) : null;
    const psi = i < N_RES - 1 ? dihedralDeg(at(flat, idx.N[i]), at(flat, idx.CA[i]), at(flat, idx.C[i]), at(flat, idx.N[i + 1])) : null;
    rows.push({ phi, psi, region: (phi != null && psi != null) ? ramaRegionOf(phi, psi) : '-' });
  }
  const hb = [];
  for (let i = 0; i + 4 < N_RES; i += 1) {
    hb.push(Math.hypot(
      at(flat, idx.O[i])[0] - at(flat, idx.N[i + 4])[0],
      at(flat, idx.O[i])[1] - at(flat, idx.N[i + 4])[1],
      at(flat, idx.O[i])[2] - at(flat, idx.N[i + 4])[2],
    ));
  }
  return { rows, hb };
};
/* ω — le lien peptidique (CA·C·N·CA) : c'est LUI qui plie la chaîne sans que φ/ψ
   bougent, donc le suspect n° 1 des i→i+4 cassés aux bouts. */
const omegasOf = (flat) => {
  const out = [];
  for (let i = 0; i + 1 < N_RES; i += 1) {
    out.push(dihedralDeg(at(flat, idx.CA[i]), at(flat, idx.C[i]), at(flat, idx.N[i + 1]), at(flat, idx.CA[i + 1])));
  }
  return out;
};
const omDev = (w) => (w == null ? null : Math.abs(((w - 180 + 540) % 360) - 180));
const devsOf = (rows, key, target) => rows.map((r) => (r[key] == null ? null
  : ((r[key] - target + 540) % 360) - 180)).filter((v) => v != null);
const statOf = (ds) => {
  const abs = ds.map((v) => Math.abs(v));
  const mean = abs.reduce((s, v) => s + v, 0) / Math.max(1, abs.length);
  const rms = Math.sqrt(abs.reduce((s, v) => s + v * v, 0) / Math.max(1, abs.length));
  const signed = ds.reduce((s, v) => s + v, 0) / Math.max(1, ds.length);
  return { n: abs.length, mean, rms, signed, max: Math.max(...abs), over30: abs.filter((v) => v > 30).length };
};


/* ── LE BALAYAGE ───────────────────────────────────────────────────────────── */
const start = positions.slice();
const base = readChain(start);
const b0 = statOf(devsOf(base.rows, 'phi', -57));
const b1 = statOf(devsOf(base.rows, 'psi', -47));
say('═'.repeat(100));
say(`§ L'HÉLICE DE LA PAGE — ${N_RES} résidus ALA peints « ${SS} » · ${elements.length} atomes`);
say(`  au départ : φ dev rms ${b0.rms.toFixed(1)}° · ψ dev rms ${b1.rms.toFixed(1)}°`
  + ` · i→i+4 ${base.hb.map((v) => v.toFixed(2)).join(' ')} (mean ${(base.hb.reduce((s, v) => s + v, 0) / base.hb.length).toFixed(2)})`);
say(`  FF_DIHEDRAL_CENTRE_K du module = ${FF_DIHEDRAL_CENTRE_K} (le défaut de la conversion)`);
say('');
say(`  ${'kc'.padStart(6)} │ ${'φ rms'.padStart(6)} ${'φ max'.padStart(6)} ${'φ sgn'.padStart(6)} │`
  + ` ${'ψ rms'.padStart(6)} ${'ψ max'.padStart(6)} ${'ψ sgn'.padStart(6)} │ ${'α'.padStart(5)}`
  + ` │ ${'i→i+4 mean'.padStart(10)} ${'dans 2.6–3.6'.padStart(12)} │ ${'⛓ pén.'.padStart(8)} ${'ms'.padStart(6)}`);
say('─'.repeat(100));
const KCS = [0, 0.02, 0.05, 0.1, 0.2, 0.5];
const results = [];
for (const kc of KCS) {
  const conv = secondaryDihedralRestraintsOf({
    secondaryStructure: SS, torsions, tolerance: SS_DIHEDRAL_TOLERANCE, centreK: kc,
  });
  const t0 = Date.now();
  const ret = structureAttemptOf({
    positions: start.slice(), elements, bonds, restraints: [],
    dihedrals: conv.constraints, draw: true, index: 0, targetFunction: 'dyana', seed: 20261001,
  });
  const ms = Date.now() - t0;
  const { rows, hb } = readChain(ret.positions);
  const om = omegasOf(ret.positions);
  const omDevs = om.map(omDev);
  const omOut = omDevs.filter((v) => v != null && v > 10).length;
  const sp = statOf(devsOf(rows, 'phi', -57));
  const ss = statOf(devsOf(rows, 'psi', -47));
  const alpha = rows.filter((r) => r.region === 'alpha').length;
  const hbMean = hb.reduce((s, v) => s + v, 0) / hb.length;
  const inBand = hb.filter((v) => v >= 2.6 && v <= 3.6).length;
  const pen = dihedralPenaltyOf({ positions: ret.positions, dihedrals: conv.constraints });
  const field = scoreStructureOf({
    positions: ret.positions, elements, bonds, restraints: [],
    dihedrals: conv.constraints, targetFunction: 'dyana',
  });
  results.push({ kc, sp, ss, alpha, hb, hbMean, inBand, pen, field, ms, om, omDevs, omOut });
  say(`  ${String(kc).padStart(6)} │ ${sp.rms.toFixed(1).padStart(6)} ${sp.max.toFixed(1).padStart(6)}`
    + ` ${sp.signed.toFixed(1).padStart(6)} │ ${ss.rms.toFixed(1).padStart(6)} ${ss.max.toFixed(1).padStart(6)}`
    + ` ${ss.signed.toFixed(1).padStart(6)} │ ${`${alpha}/${N_RES}`.padStart(5)}`
    + ` │ ${hbMean.toFixed(2).padStart(10)} ${`${inBand}/${hb.length}`.padStart(12)}`
    + ` │ ${Number(pen.penalty).toFixed(1).padStart(8)} ${String(ms).padStart(6)}`);
}
say('');
say('  i→i+4 O···N, valeur par valeur (fenêtre d\'un pont H : 2.6–3.6 Å) :');
for (const r of results) {
  say(`    kc ${String(r.kc).padStart(5)} : ${r.hb.map((v) => v.toFixed(2).padStart(5)).join(' ')}`
    + `   (dans ${r.inBand}/${r.hb.length} · ⛓ ${r.pen.violations} hors fenêtre`
    + ` · champ ${Number(r.field.total).toFixed(1)} · α ${r.alpha}/${N_RES})`);
}
say('');
say('  ω (le lien peptidique, CA·C·N·CA) écart à 180° par lien — un ω retourné plie la');
say('  chaîne SANS que φ/ψ bougent : c\'est le suspect des bouts cassés :');
for (const r of results) {
  say(`    kc ${String(r.kc).padStart(5)} : ${r.omDevs.map((v) => (v == null ? '  —  ' : v.toFixed(1).padStart(5))).join(' ')}`
    + `   (${r.omOut}/11 liens à plus de 10° de trans)`);
}
say('');
const best = results.filter((r) => r.kc > 0).slice().sort((a, b) => b.inBand - a.inBand
  || a.sp.rms - b.sp.rms)[0];
say(`▶ MEILLEUR PAR LA MESURE : kc = ${best.kc} · φ rms ${best.sp.rms.toFixed(1)}° · ψ rms ${best.ss.rms.toFixed(1)}°`
  + ` · α ${best.alpha}/${N_RES} · ${best.inBand}/${best.hb.length} ponts H dans 2.6–3.6 Å`);
writeFileSync('_kc_sweep_out.txt', LINES.join('\n') + '\n', 'utf8');
