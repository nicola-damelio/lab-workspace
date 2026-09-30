// ⚠ LA GÉOMÉTRIE CONSTRUITE — le modèle de protéine sort DROIT (L), plus en miroir.
// Le corpus : « il bottone alfa elica impone una struttura elicacea left-handed » (l'hélice
// peinte sortait GAUCHE) et « la struttura beta ha gli angoli phi e psi rovesciati » (le
// feuillet sortait avec ses φ/ψ inversés). La cause : `nerfPlace` (NMRSections.jsx) posait
// la torsion avec le signe OPPOSÉ à celui que l'application relit (`dihedralDeg` de
// utils/torsionDrive.js, la convention signée IUPAC) — tout le modèle de protéine était
// donc le MIROIR de ce qu'il annonçait, carbone α en D compris.
//
// Ce fichier construit les quatre lettres (H, L, E, C), puis les RELIT avec le lecteur du
// dossier : la torsion demandée doit être la torsion mesurée, le carbone α doit tomber du
// même côté que celui d'un VRAI aminoacide L du dépôt (public/structures/template_amino_acid.pdb),
// et ω doit rester trans.
//
// Run: node _ss_geometry_test.mjs
import { readFileSync } from 'node:fs';
import { dihedralDeg } from './src/utils/torsionDrive.js';

let failures = 0;
let passed = 0;
const eq = (got, want, msg) => {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) { passed++; console.log(`ok   ${msg}`); }
  else { failures++; console.error(`FAIL ${msg}\n  attendu : ${JSON.stringify(want)}\n  obtenu  : ${JSON.stringify(got)}`); }
};
const near = (got, want, msg, tol = 0.05) => {
  if (Number.isFinite(got) && Math.abs(got - want) <= tol) { passed++; console.log(`ok   ${msg}`); }
  else { failures++; console.error(`FAIL ${msg}\n  attendu : ${want} ± ${tol}\n  obtenu  : ${got}`); }
};
const ok2 = (cond, msg) => eq(!!cond, true, msg);
const read = (p) => readFileSync(p, 'utf8');

/* ---- le bâtisseur, extrait du JSX comme les autres sondes du dossier ------------- */
const src = read('src/components/NMRSections.jsx');
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
const order = ['_vecSub', '_vecAdd', '_vecScale', '_vecDot', '_vecCross', '_vecNorm',
  '_vecNormalize', '_deg2rad', 'nerfPlace', 'PROTEIN_BB', 'SS_TORSIONS', 'ssTorsionAt',
  'buildProteinBackbone'];
let code = '';
order.forEach((n) => { code += extract(n); });
const B = new Function(code + '\nreturn { buildProteinBackbone, SS_TORSIONS, nerfPlace };')();

/* ---- le contrôle EXTERNE : un vrai aminoacide L du dépôt ------------------------- */
const resAtoms = (file) => {
  const byRes = new Map();
  read(file).split(/\r?\n/).forEach((line) => {
    if (!/^(ATOM|HETATM)/.test(line)) return;
    const name = line.slice(12, 16).trim();
    const key = line.slice(17, 27);
    const p = [parseFloat(line.slice(30, 38)), parseFloat(line.slice(38, 46)), parseFloat(line.slice(46, 54))];
    if (p.some((v) => !Number.isFinite(v))) return;
    const r = byRes.get(key) || {};
    r[name] = p;
    byRes.set(key, r);
  });
  return [...byRes.values()];
};
const template = resAtoms('public/structures/template_amino_acid.pdb')
  .find((r) => r.N && r.CA && r.C && r.CB);
ok2(template, 'le dépôt porte un aminoacide de référence (public/structures/template_amino_acid.pdb)');
const realCb = dihedralDeg(template.N, template.CA, template.C, template.CB);
ok2(realCb < 0, `⚠ LA RÉFÉRENCE : l'aminoacide L du dépôt donne N–CA–C–CB = ${realCb.toFixed(1)}°`
  + ' (négatif) — c\'est le signe à retrouver sur le modèle construit');

/* ---- LA CHIMIE DE CHAQUE LETTRE : la torsion demandée EST la torsion mesurée ----- */
const SEQ = 'AAAAAAAAAA';
for (const letter of ['H', 'L', 'E', 'C']) {
  const r = B.buildProteinBackbone(SEQ, letter.repeat(SEQ.length));
  const wantPhi = B.SS_TORSIONS[letter].phi * 180 / Math.PI;
  const wantPsi = B.SS_TORSIONS[letter].psi * 180 / Math.PI;
  const phi = [];
  const psi = [];
  const omg = [];
  const cb = [];
  for (let i = 0; i < r.length; i++) {
    if (i > 0) phi.push(dihedralDeg(r[i - 1].C, r[i].N, r[i].CA, r[i].C));
    if (i < r.length - 1) psi.push(dihedralDeg(r[i].N, r[i].CA, r[i].C, r[i + 1].N));
    if (i > 0) omg.push(dihedralDeg(r[i - 1].CA, r[i - 1].C, r[i].N, r[i].CA));
    if (r[i].CB) cb.push(dihedralDeg(r[i].N, r[i].CA, r[i].C, r[i].CB));
  }
  const mid = (a) => a[Math.floor(a.length / 2)];
  near(mid(phi), wantPhi, `[${letter}] φ MESURÉ = DEMANDÉ (${wantPhi.toFixed(1)}°)`, 0.2);
  near(mid(psi), wantPsi, `[${letter}] ψ MESURÉ = DEMANDÉ (${wantPsi.toFixed(1)}°)`, 0.2);
  near(Math.abs(mid(omg)), 180, `[${letter}] ω reste TRANS (${mid(omg).toFixed(1)}°)`, 0.2);
  near(mid(cb), realCb, `[${letter}] N–CA–C–CB = celui d'un VRAI aminoacide L (${realCb.toFixed(1)}°)`, 1);
  if (letter === 'H' || letter === 'L') {
    ok2((mid(phi) < 0) === (letter === 'H'),
      `[${letter}] SENS — H est l'hélice α DROITE, L la GAUCHE (φ ${mid(phi) > 0 ? '+' : ''}${mid(phi).toFixed(1)}°)`);
  }
}
/* LES DEUX MAINS SONT LE MIROIR EXACT L'UNE DE L'AUTRE, ET L'ÉLICHE H EST CELLE DE
   PAULING–COREY (φ −57° / ψ −47°) ; l'éliche L est son couple positif. */
eq(B.SS_TORSIONS.H.phi, B.SS_TORSIONS.L.phi * -1, '⚠ H et L sont deux MIROIRS : φ opposés');
eq(B.SS_TORSIONS.H.psi, B.SS_TORSIONS.L.psi * -1, '…et ψ opposés aussi');
near(B.SS_TORSIONS.H.phi * 180 / Math.PI, -57, 'l\'hélice α DROITE est celle de Pauling–Corey (φ −57°)');
near(B.SS_TORSIONS.E.phi * 180 / Math.PI, -139,
  '⚠ …et le feuillet vise LE MÊME couple que la contrainte de structure secondaire (SS_DIHEDRALS.E, φ −139°)');
near(B.SS_TORSIONS.E.psi * 180 / Math.PI, 135, '…et ψ +135° — les φ/ψ ne sont plus « rovesciati »');

/* ════════════ LA SOURCE — LE SIGNE, ET LES DEUX MAINS DANS L'INTERFACE ══════════ */
const UTIL = read('src/utils/rebuildProteinHydrogens.js');
const TORSION = read('src/utils/torsionDrive.js');
ok2(TORSION.includes('export const dihedralDeg'),
  'le lecteur de référence est celui du dossier (utils/torsionDrive.js)');
ok2(src.includes('const t = torsionRad;'),
  '⚠ `nerfPlace` pose LA torsion demandée (le signe du dossier, plus son opposé)');
ok2(!src.includes('const t = -torsionRad;'), '…et l\'ancien signe de miroir a disparu du bâtisseur');
ok2(UTIL.includes('const t = torsionRad;'),
  '⚠ …et la copie du poseur dans rebuildProteinHydrogens.js suit la MÊME règle'
  + ' (les hydrogènes rebâtis tombent sur le modèle)');
ok2(!UTIL.includes('const t = -torsionRad;'), '…sans garder l\'ancien signe');
ok2(src.includes('L: { phi: _deg2rad(57), psi: _deg2rad(47) },'),
  'la lettre L (hélice α gauche) a SA géométrie dans SS_TORSIONS');
const META = read('src/components/NMRData.jsx');
ok2(META.includes("L: { label: 'α-Helix (left-handed)'"),
  '…son pinceau existe et porte SON nom (les deux mains ne se confondent pas)');
ok2(META.includes("H: { label: 'α-Helix (right-handed)'"), '…et H dit qu\'il est la main droite');
for (const page of ['src/components/NMRSections.jsx', 'src/components/MDSections.jsx',
  'src/components/DockingSections.jsx']) {
  const p = read(page);
  ok2(p.includes("'HESL'.includes"), `${page.split('/').pop()} accepte la lettre L dans getSSAt`);
  ok2(p.includes("{['C', 'H', 'L', 'E'].map((l) => ("), '…et son pinceau la propose');
}
const MODULE = read('src/utils/structureCalc.js');
ok2(MODULE.includes('L: { phi: 57, psi: 47 },'), 'la conversion SS → φ/ψ connaît L (SS_DIHEDRALS)');
ok2(src.includes("const ssKey = { C: 'coil', H: 'helix', L: 'helix', E: 'sheet' }[ssLetter];"),
  '⚠ …et L prend les corrections de déplacements chimiques de l\'hélice'
  + ' (sans quoi la lettre tombait sur `undefined`)');
ok2(src.includes('SS_CORRECTIONS[ssKey]'), '…les corrections, lues par la clé du tableau');

console.log(`\n_ss_geometry_test.mjs — ${passed} assertions OK${failures ? `, ${failures} ÉCHECS` : ''}`);
if (!failures) {
  console.log('  (la géométrie CONSTRUITE puis RELUE : φ/ψ/ω des lettres H, L, E et C, le carbone α du bon côté'
    + '\n   — référence : un VRAI aminoacide L du dépôt —, le sens de chaque hélice, le couple de Pauling–Corey,'
    + '\n   et le signe corrigé dans les DEUX copies du poseur)');
}
if (failures) process.exitCode = 1;


