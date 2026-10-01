/* =========================================================================
   _diag_helix.mjs — SCRATCH (diagnostic, not a test).

   Il fait tourner le VRAI protocole du dossier (structureAttemptOf) sur SON
   propre modèle (buildProteinBackbone de NMRSections.jsx) et mesure ce que
   « poorly helical » veut dire en chiffres :
     §A la molécule · §B la conversion ⛓ SS → φ/ψ · §C le protocole complet
     §D la géométrie finale (écart φ/ψ, régions 🪢, i→i+4 O···N)
     §E la dynamique seule (le contact le plus court de la trajectoire).

   Run: node _diag_helix.mjs   (rapport aussi écrit dans _diag_helix_out.txt)
   ========================================================================= */
import { readFileSync, writeFileSync } from 'node:fs';
import { dihedralDeg } from './src/utils/torsionDrive.js';
import { ramaRegionOf } from './src/utils/ramachandran.js';
import {
  backboneTorsionsOf, secondaryDihedralRestraintsOf, dihedralPenaltyOf, ramaPenaltyOf,
  peptideOmegasOf, rotatableBondsOf, scoreStructureOf,
  structureAttemptOf, molecularDynamicsOf,
  SS_DIHEDRAL_TOLERANCE,
} from './src/utils/structureCalc.js';
import { FF_DIHEDRAL_K, FF_DIHEDRAL_TOLERANCE, FF_RAMA_K } from './src/utils/forceFieldKcal.js';

const LINES = [];
const say = (s = '') => { LINES.push(s); console.log(s); };

/* ── LE BUILDING DE LA PAGE, TEL QUEL (comme _w_ss_geom.mjs) ───────────────── */
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
const B = new Function(code + '\nreturn { buildProteinBackbone, SS_TORSIONS };')();

/* ── §A · LA MOLÉCULE — atomes lourds du modèle de la page ─────────────────── */
const N_RES = 12;
const SEQ = 'A'.repeat(N_RES);
const SS = 'H'.repeat(N_RES);
const residues = B.buildProteinBackbone(SEQ, SS);
const elements = [];
const positions = [];
const bonds = [];
const idx = { N: [], CA: [], C: [], O: [], CB: [] };
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
  const cb = r.CB ? push(r.CB, 'C') : -1;
  bonds.push({ i: n, j: ca, order: 1 }, { i: ca, j: c, order: 1 });
  if (o >= 0) bonds.push({ i: c, j: o, order: 1 });
  if (cb >= 0) bonds.push({ i: ca, j: cb, order: 1 });
  if (prevC >= 0) bonds.push({ i: prevC, j: n, order: 1 });
  prevC = c;
  idx.N.push(n); idx.CA.push(ca); idx.C.push(c); idx.O.push(o); idx.CB.push(cb);
});
const count = elements.length;
const at = (flat, k) => [flat[k * 3], flat[k * 3 + 1], flat[k * 3 + 2]];

/* LA LECTURE φ/ψ ET LES DISTANCES i→i+4 (le substitut chiffré d'un pont H) */
const readChain = (flat) => {
  const rows = [];
  for (let i = 0; i < N_RES; i += 1) {
    const phi = i > 0 ? dihedralDeg(at(flat, idx.C[i - 1]), at(flat, idx.N[i]), at(flat, idx.CA[i]), at(flat, idx.C[i])) : null;
    const psi = i < N_RES - 1 ? dihedralDeg(at(flat, idx.N[i]), at(flat, idx.CA[i]), at(flat, idx.C[i]), at(flat, idx.N[i + 1])) : null;
    rows.push({ i, phi, psi, resname: 'ALA', klass: 'general', region: (phi != null && psi != null) ? ramaRegionOf(phi, psi) : '-' });
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
const stat = (rows, key, target) => {
  const devs = rows.filter((r) => r[key] != null).map((r) => Math.abs(((r[key] - target + 540) % 360) - 180));
  const mean = devs.reduce((s, v) => s + v, 0) / Math.max(1, devs.length);
  const rms = Math.sqrt(devs.reduce((s, v) => s + v * v, 0) / Math.max(1, devs.length));
  return {
    n: devs.length, mean, rms, max: Math.max(...devs),
    good10: devs.filter((v) => v <= 10).length,
    good20: devs.filter((v) => v <= 20).length,
    over30: devs.filter((v) => v > 30).length,
  };
};
const reportChain = (title, flat) => {
  const { rows, hb } = readChain(flat);
  const sp = stat(rows, 'phi', -57);
  const ss = stat(rows, 'psi', -47);
  say(`  ${title}`);
  say(`    φ dev (to −57°): mean ${sp.mean.toFixed(1)}° rms ${sp.rms.toFixed(1)}° max ${sp.max.toFixed(1)}°`
    + ` · ≤10°: ${sp.good10}/${sp.n} · ≤20°: ${sp.good20}/${sp.n} · OUT of the ±30° window: ${sp.over30}`);
  say(`    ψ dev (to −47°): mean ${ss.mean.toFixed(1)}° rms ${ss.rms.toFixed(1)}° max ${ss.max.toFixed(1)}°`
    + ` · ≤10°: ${ss.good10}/${ss.n} · ≤20°: ${ss.good20}/${ss.n} · OUT of the ±30° window: ${ss.over30}`);
  const alpha = rows.filter((r) => r.region === 'alpha').length;
  say(`    🪢 regions: ${rows.map((r) => r.region).join(',')}  (alpha ${alpha}/${rows.length})`);
  say(`    i→i+4 O···N (Å): ${hb.map((v) => v.toFixed(2)).join(' ')}`
    + ` · mean ${(hb.reduce((s, v) => s + v, 0) / hb.length).toFixed(2)}`
    + ` · outside 2.6–3.6 Å: ${hb.filter((v) => v < 2.6 || v > 3.6).length}/${hb.length}`);
  return { rows, hb, sp, ss, alpha };
};

/* ── §B · LA CONVERSION ⛓ ET L'HÉLICE DE DÉPART ───────────────────────────── */
say('═'.repeat(96));
say('§A · LA MOLÉCULE — le modèle de la page, atomes lourds (buildProteinBackbone)');
say(`  ${N_RES} résidus ALA peints « ${SS} » · ${count} atomes · ${bonds.length} liaisons`);
const channels = rotatableBondsOf({ elements, bonds, atomCount: count });
const chCount = Array.isArray(channels) ? channels.length : (channels && channels.channels ? channels.channels.length : '?');
const torsions = backboneTorsionsOf({ elements, bonds, atomCount: count });
const omegas = peptideOmegasOf({ elements, bonds, atomCount: count });
say(`  charnières (rotatableBondsOf) : ${chCount}`
  + ` · résidus lus (backboneTorsionsOf) : ${torsions.residues} (φ ${torsions.phi.length} · ψ ${torsions.psi.length})`
  + ` · liaisons peptidiques (ω) : ${omegas.length}`);
const conv30 = secondaryDihedralRestraintsOf({ secondaryStructure: SS, torsions, tolerance: SS_DIHEDRAL_TOLERANCE });
const conv10 = secondaryDihedralRestraintsOf({ secondaryStructure: SS, torsions, tolerance: 10 });
say(`  ⛓ conversion : ok=${conv30.ok} reason=${conv30.reason} contraintes=${conv30.constraints.length}`
  + ` (fenêtre ${conv30.tolerance}° · k = ${FF_DIHEDRAL_K} kcal/mol/deg² · FF_DIHEDRAL_TOLERANCE = ${FF_DIHEDRAL_TOLERANCE} · FF_RAMA_K = ${FF_RAMA_K})`);
say('');
say('§B · L’HÉLICE DE DÉPART (telle que la page la construit)');
const start = positions.slice();
reportChain('built model (before any protocol)', start);
const pen0 = dihedralPenaltyOf({ positions: start, dihedrals: conv30.constraints });
say(`    dihedralPenaltyOf: ${pen0.satisfied}/${pen0.count} satisfied · penalty ${pen0.penalty} kcal/mol`);
const rama0 = ramaPenaltyOf({ positions: start, torsions });
say(`    ramaPenaltyOf: ${rama0.measured} measured · violations ${rama0.violations} · penalty ${rama0.penalty.toFixed(2)} kcal/mol (weight ${rama0.weight})`);
say('');

/* ── §C · LE PROTOCOLE ────────────────────────────────────────────────────── */
const ffLine = (tag, s) => say(`  ${tag} : total ${Number(s.total).toFixed(1)} = bond ${Number(s.bond).toFixed(1)}`
  + ` + angle ${Number(s.angle).toFixed(1)} + vdw ${Number(s.vdw).toFixed(1)} + elec ${Number(s.elec).toFixed(1)}`
  + ` + restraint ${Number(s.restraintEnergy).toFixed(1)} · entropy ${Number(s.entropy).toFixed(1)}`
  + ` (freeEnergy ${Number(s.freeEnergy).toFixed(1)})`);
const run = (label, over) => {
  const s0 = scoreStructureOf({ positions: start, elements, bonds, restraints: [], dihedrals: over.dihedrals, targetFunction: over.targetFunction });
  const t0 = Date.now();
  const ret = structureAttemptOf({
    positions: start, elements, bonds, restraints: [],
    dihedrals: over.dihedrals, draw: over.draw, index: 0,
    targetFunction: over.targetFunction, seed: 20261001,
  });
  const ms = Date.now() - t0;
  say('─'.repeat(96));
  say(`▶ ${label}   (${ms} ms)`);
  ffLine('field BEFORE protocol ', s0);
  ffLine('field AFTER  protocol ', ret);
  say(`  ⛓ dihedral wells: ${ret.dihedralWells.satisfied}/${ret.dihedralWells.count} inside the ${ret.dihedralWells.tolerance}° window`
    + ` · violations ${ret.dihedralWells.violations} · penalty ${Number(ret.dihedralWells.penalty).toFixed(2)} kcal/mol`
    + ` · worst ${ret.dihedralWells.worst ? `${ret.dihedralWells.worst.over.toFixed(1)}° over` : '—'}`);
  say(`  🪢 rama penalty ${Number(ret.ramaPenalty).toFixed(2)} (${ret.ramaPlot.measured} residues read, ${ret.ramaPlot.violations} out of basin)`
    + ` · 🚧 clashes ${ret.clashes.count} (worst r ${ret.clashes.worst ? ret.clashes.worst.distance.toFixed(2) : '—'} Å`
    + `, severity ${ret.clashes.severity})`
    + ` · ⚠ bad contacts ${ret.contacts.count} (worst ${ret.contacts.worst ? ret.contacts.worst.distance.toFixed(2) : '—'} Å)`);
  if (ret.worstVdw) say(`  💥 worst LJ pair: atoms ${ret.worstVdw.i}–${ret.worstVdw.j} at ${Number(ret.worstVdw.distance).toFixed(2)} Å`
    + ` → ${Number(ret.worstVdw.energy).toFixed(1)} kcal/mol`);
  if (ret.anneal) say(`  anneal: ${ret.anneal.tried} tried / ${ret.anneal.accepted} accepted · cost ${Number(ret.anneal.before).toFixed(1)} → ${Number(ret.anneal.after).toFixed(1)}`);
  if (ret.md) say(`  MD: ${ret.md.steps} steps · ${ret.md.applied} applied · ${ret.md.channels} channels`
    + ` · T ${ret.md.temperature.mode} (kinetic ${ret.md.temperature.kinetic} vs target hot ${ret.md.temperature.hot} / cold ${ret.md.temperature.cold})`
    + ` · cost ${Number(ret.md.before).toFixed(1)} → ${Number(ret.md.after).toFixed(1)}`);
  if (ret.md) say(`  MD walls (longe 🦮): ${ret.md.walls.before.toFixed(1)} → ${ret.md.walls.after.toFixed(1)} (${ret.md.walls.count} walls)`
    + ` · rama ${Number(ret.md.rama).toFixed(2)}`);
  if (ret.minimise) say(`  ⚒: ${ret.minimise.sweeps} sweeps · ${ret.minimise.accepted} accepted`
    + ` · cost ${Number(ret.minimise.before).toFixed(1)} → ${Number(ret.minimise.after).toFixed(1)}`);
  if (ret.draw) say(`  🎲 draw: ${ret.draw.turned} channels turned`);
  say(`  protocol stages: ${(ret.protocol.stages || []).map((s) => s.name).join(' → ')}`);
  const pen = dihedralPenaltyOf({ positions: ret.positions, dihedrals: over.dihedrals });
  say(`  dihedralPenaltyOf (relecture): ${pen.satisfied}/${pen.count} satisfied · penalty ${Number(pen.penalty).toFixed(2)}`
    + ` · worst ${pen.worst ? `${pen.worst.over.toFixed(1)}° over` : '—'}`);
  const m = reportChain('final model', ret.positions);
  return { ret, m, pen };
};

const A = run('protocole complet · draw=true · 🎯 dyana · fenêtre ± 30°', { dihedrals: conv30.constraints, draw: true, targetFunction: 'dyana' });
const Bx = run('protocole complet · draw=true · 🎯 classic · fenêtre ± 30°', { dihedrals: conv30.constraints, draw: true, targetFunction: 'classic' });
const C = run('protocole complet · draw=true · 🎯 dyana · fenêtre ± 10°', { dihedrals: conv10.constraints, draw: true, targetFunction: 'dyana' });
const D = run('draw=false (⚒ seulement) · dyana · fenêtre ± 30° — l’hélice est-elle SEULEMENT conservée ?', { dihedrals: conv30.constraints, draw: false, targetFunction: 'dyana' });
const E = run('draw=false (⚒ seulement) · dyana · fenêtre ± 10°', { dihedrals: conv10.constraints, draw: false, targetFunction: 'dyana' });

/* ── §E · LA DYNAMIQUE SEULE — les atomes se traversent-ils ? ──────────────── */
say('─'.repeat(96));
say('§E · LA DYNAMIQUE SEULE (300 pas, 1500 K, 🎯 dyana) — le contact le plus court');
const bonded = new Map();
bonds.forEach(({ i, j }) => {
  if (!bonded.has(i)) bonded.set(i, new Set());
  if (!bonded.has(j)) bonded.set(j, new Set());
  bonded.get(i).add(j);
  bonded.get(j).add(i);
});
const excluded = (i, j) => (bonded.get(i) && bonded.get(i).has(j))
  || [...(bonded.get(i) || [])].some((k) => bonded.get(k) && bonded.get(k).has(j));
let minContact = Infinity;
let minPair = null;
let framesUnder = 0;
let frames = 0;
const dyn = molecularDynamicsOf({
  positions: start, elements, bonds, restraints: [], dihedrals: conv30.constraints,
  steps: 300, hot: 1500, cold: 300, targetFunction: 'dyana', seed: 20261001,
  onFrame: (fr) => {
    const x = fr && fr.positions ? fr.positions : null;
    if (!x) return;
    frames += 1;
    let worst = Infinity;
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        if (excluded(i, j)) continue;
        const d = Math.hypot(at(x, i)[0] - at(x, j)[0], at(x, i)[1] - at(x, j)[1], at(x, i)[2] - at(x, j)[2]);
        if (d < worst) worst = d;
        if (d < minContact) { minContact = d; minPair = [i, j]; }
      }
    }
    if (worst < 2.4) framesUnder += 1;
  },
});
say(`  ${dyn.steps} pas · ${frames} images · canaux ${dyn.channels} · T ${dyn.temperature.mode}`
  + ` (cinétique ${dyn.temperature.kinetic} · visée ${dyn.temperature.hot}→${dyn.temperature.cold} K)`);
say(`  contact non-lié le plus court de TOUTE la trajectoire : ${minContact.toFixed(3)} Å`
  + ` (atomes ${minPair ? minPair.join('–') : '-'}) · images sous 2.4 Å : ${framesUnder}/${frames}`);
say(`  murs du moteur : ${dyn.walls.count} · coût des murs (longe 🦮) ${Number(dyn.walls.before).toFixed(1)} → ${Number(dyn.walls.after).toFixed(1)}`
  + ` · coût du champ ${Number(dyn.cost.before).toFixed(1)} → ${Number(dyn.cost.after).toFixed(1)}`);
say(`  ⚖ couple : dynamique ${dyn.torque.dynamic} (mur ${dyn.torque.wall}) · plafond champ ${dyn.torque.field}`
  + ` · plafond distances ${dyn.torque.restraint} · facteur ${dyn.torque.factor}`);
say(`  🪢 après la dynamique : dihedral ${Number(dyn.after.dihedral.penalty).toFixed(2)} kcal/mol`
  + ` (${dyn.after.dihedral.satisfied}/${dyn.after.dihedral.count} dans la fenêtre)`
  + ` · rama ${Number(dyn.after.rama.penalty).toFixed(2)} · ω ${Number(dyn.after.omega.penalty).toFixed(2)}`);
const dynScore = scoreStructureOf({ positions: dyn.positions, elements, bonds, restraints: [], dihedrals: conv30.constraints, targetFunction: 'dyana' });
ffLine('field after dynamics    ', dynScore);
if (dynScore.worstVdw) say(`  💥 worst LJ pair after dynamics: atoms ${dynScore.worstVdw.i}–${dynScore.worstVdw.j}`
  + ` at ${Number(dynScore.worstVdw.distance).toFixed(2)} Å → ${Number(dynScore.worstVdw.energy).toFixed(1)} kcal/mol`);
reportChain('final model after dynamics', dyn.positions);

say('');
say('═'.repeat(96));
say('RÉSUMÉ CHIFFRÉ');
const s0 = stat(readChain(start).rows, 'phi', -57);
say(`  hélice de départ           : φ rms ${s0.rms.toFixed(1)}° · α ${readChain(start).rows.filter((r) => r.region === 'alpha').length}/${N_RES}`);
[['full protocol dyana ±30', A], ['full protocol classic ±30', Bx], ['full protocol dyana ±10', C],
  ['minimise only dyana ±30', D], ['minimise only dyana ±10', E]].forEach(([name, r]) => {
  say(`  ${name.padEnd(26)}: φ rms ${r.m.sp.rms.toFixed(1)}° ψ rms ${r.m.ss.rms.toFixed(1)}°`
    + ` · α ${r.m.alpha}/${N_RES} · hors ±30°: φ ${r.m.sp.over30} ψ ${r.m.ss.over30}`
    + ` · i→i+4 hors 2.6–3.6 Å : ${r.m.hb.filter((v) => v < 2.6 || v > 3.6).length}/${r.m.hb.length}`);
});
say(`  dynamique seule            : contact le plus court ${minContact.toFixed(3)} Å · images sous 2.4 Å ${framesUnder}/${frames}`);

writeFileSync('_diag_helix_out.txt', LINES.join('\n') + '\n', 'utf8');
