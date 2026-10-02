/* =========================================================================
   _chemistry_ph_ionic_test.mjs — LE pH ET LA FORCE IONIQUE.

   LA DEMANDE DE CETTE SESSION, mot pour mot : « In MD and “structure calculation” allow to
   define the pH and ionic strength so that the molecule can be protonated or deprotonated and
   charge can be taken into consideration. »

   Deux réglages, deux mécanismes, chacun DIT par le module :
     · LE pH titrait les fonctions ionisables que le graphe montre — un ACIDE (carboxylate,
       phosphate, thiolate) est neutre à pH bas et chargé à pH haut, une BASE (ammonium,
       guanidinium) l'inverse — par Henderson–Hasselbalch avec les pKa du module (`FF_PKA`) ;
     · LA FORCE IONIQUE I écrante les charges : le terme de Coulomb est multiplié par
       exp(−κ·r), κ = 3.29·√I Å⁻¹ (Debye–Hückel, 298 K).

   Ce qui doit rester vrai, et qui est EXÉCUTÉ ici :

     • LE DÉFAUT NE CHANGE RIEN, AU CHIFFRE PRÈS — `ph = null` (« la chimie que le graphe
       montre ») et `I = 0` rendent exactement les charges, l'énergie et la pente d'avant cette
       fonctionnalité. C'est la garantie qui protège tout le reste du dossier ;
     • LA MOLÉCULE PEUT ÊTRE PROTONÉE OU DÉPROTONÉE — un fragment d'aspartate (que
       l'hydrogénation de l'application rend en COOH, donc SANS carboxylate formel) l'est
       vraiment : neutre sans pH et à pH 2, −1 à pH 7 comme à pH 12, charge NETTE comprise ;
     • LA FORMES ACIDE EST TITRÉE COMME L'IONISÉE — `ffIonisableGroupsOf` réunit les deux, donc
       un COOH n'est pas « un groupe que le pH ne voit pas » ;
     • LA FORCE IONIQUE ÉCRANTE — κ et la longueur de Debye sont ceux de Debye–Hückel, l'énergie
       électrostatique baisse, et la PENTE d'un couple reste la dérivée EXACTE de son prix, sans
       sel comme avec (les corps rigides d'eau lisent cette pente) ;
     • LE RAPPORT DIT CE QUI A ÉTÉ LU — `chemistry` sort de `mdFrames`, `minimizeFrames` et
       `structureAttemptFrames`, et `ffKcalEnergyOf` rend `ph`, `kappa`, `ionisation` ;
     • LE PANNEAU LE PROPOSE — deux cases (pH · I) et leur lecture, les QUATRE gestes du champ
       qui portent les deux valeurs, et la phrase du rapport qui les cite.

   Run: node _chemistry_ph_ionic_test.mjs
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ffIonisationOf, ffIonisationReportOf, ffDebyeKappaOf, ffDebyeLengthOf, ffScreeningOf,
  ffCoulombCostOf, ffNonbondedCostOf, ffNonbondedGradientOf, ffNonbondedOf,
  ffKcalEnergyOf, partialChargesOf, ffIonisableGroupsOf, hydrogenatedOf,
  FF_PKA, FF_PKA_ACIDS, FF_PH_DEFAULT, FF_IONIC_STRENGTH_DEFAULT, FF_DEBYE_FACTOR,
} from './src/utils/forceFieldKcal.js';
import { bondGraphOf } from './src/utils/geometryRelax.js';
import { molecularDynamicsOf, minimizeTorsionsOf, annealTorsionsOf } from './src/utils/structureCalc.js';

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

/* ── 1 · LE MODÈLE DE HENDERSON–HASSELBALCH, EXÉCUTÉ ─────────────────────────────────── */
const carboxylate = { name: 'carboxylate', charge: -1, spread: -0.5, atoms: [0, 1] };
eq(ffIonisationOf(carboxylate), 1, '⚠ sans pH, le degré d’ionisation vaut 1 (la chimie du graphe, au chiffre près)');
eq(ffIonisationOf(carboxylate, null), 1, '…et `null` veut dire « pas de pH », JAMAIS un pH 0');
eq(ffIonisationOf(carboxylate, ''), 1, '…une case vide non plus (le même contrat que le panneau)');
ok(ffIonisationOf(carboxylate, 7) > 0.99, `à pH 7 un carboxylate (pKa ${FF_PKA.carboxylate}) est chargé (${ffIonisationOf(carboxylate, 7).toFixed(4)})`);
ok(ffIonisationOf(carboxylate, 2) < 0.02, `à pH 2 il est NEUTRE (protoné : ${ffIonisationOf(carboxylate, 2).toFixed(4)})`);
const ammonium = { name: 'ammonium', charge: 1, spread: 1, atoms: [0] };
ok(ffIonisationOf(ammonium, 2) > 0.99, `à pH 2 un ammonium (pKa ${FF_PKA.ammonium}) est chargé`);
ok(ffIonisationOf(ammonium, 12) < 0.01, `à pH 12 il est neutre (déprotoné : ${ffIonisationOf(ammonium, 12).toExponential(2)})`);
eq(ffIonisationOf({ name: 'imidazole' }, 3), 1, '⚠ une famille sans pKa connu reste telle quelle (rien n’est deviné)');
FF_PKA_ACIDS.forEach((k) => ok(FF_PKA[k] > 0, `le pKa de ${k} est DIT par le module`));
ok(FF_PH_DEFAULT === null, 'le pH par défaut est « la chimie que le graphe montre »');
eq(FF_IONIC_STRENGTH_DEFAULT, 0, 'la force ionique par défaut est 0 (aucun sel)');

/* ── 2 · LA FORCE IONIQUE — κ, LA LONGUEUR DE DEBYE, ET L'ÉCRANTAGE ──────────────────── */
eq([ffDebyeKappaOf(0), ffDebyeKappaOf(null), ffDebyeKappaOf('x'), ffDebyeKappaOf(-1)],
  [0, 0, 0, 0], '⚠ κ = 0 pour une force ionique absente, nulle, illisible ou négative');
near(ffDebyeKappaOf(0.15), 1.2742, `κ(150 mM) = ${ffDebyeKappaOf(0.15).toFixed(3)} Å⁻¹ (Debye–Hückel, 3.29·√I)`, 1e-3);
near(ffDebyeLengthOf(ffDebyeKappaOf(0.15)), 0.7848, `longueur de Debye ≈ ${ffDebyeLengthOf(ffDebyeKappaOf(0.15)).toFixed(3)} Å`, 1e-3);
eq(ffDebyeLengthOf(0), Infinity, '⚠ sans sel, la longueur de Debye est INFINIE — pas un zéro qui voudrait dire « écranté partout »');
eq([ffScreeningOf(0, 1), ffScreeningOf(0, 500)], [1, 1], '⚠ sans sel, l’écrantage vaut 1 EXACTEMENT à toute distance (le champ d’avant)');
ok(ffScreeningOf(1, 1) > 0.36 && ffScreeningOf(1, 1) < 0.37, 'avec sel, une charge est écrantée à courte portée');
eq(FF_DEBYE_FACTOR, 3.29, 'le facteur de Debye est une constante DITE du module (aucun chiffre recopié dans le JSX)');

/* ── 3 · LE COUPLE — LE PRIX ET SA PENTE, SANS SEL COMME AVEC ────────────────────────── */
const pair = ffNonbondedOf(0, 1, ['N', 'O'], [1, -1]);
const charge4 = ffCoulombCostOf(4, pair, 4);
eq(ffCoulombCostOf(4, pair, 4, 0), charge4, '⚠ κ = 0 rend exactement le prix d’avant (au chiffre près)');
ok(Math.abs(ffCoulombCostOf(4, pair, 4, 1)) < Math.abs(charge4), 'avec sel, la charge coûte MOINS (elle est écrantée)');
const numOf = (r, k) => (ffNonbondedCostOf(r + 1e-7, pair, { dielectric: 4, kappa: k })
  - ffNonbondedCostOf(r - 1e-7, pair, { dielectric: 4, kappa: k })) / 2e-7;
for (const k of [0, 0.5, 1.27]) {
  const worst = Math.max(...[2, 3.2, 5, 7.5].map((r) => Math.abs(numOf(r, k)
    - ffNonbondedGradientOf(r, pair, { dielectric: 4, kappa: k }))));
  ok(worst < 1e-4, `⚠ κ = ${k} : la PENTE d’un couple reste la dérivée exacte de son prix (écart ${worst.toExponential(1)})`);
}

/* ── 4 · LA MOLÉCULE PEUT ÊTRE PROTONÉE OU DÉPROTONÉE — EXÉCUTÉ ───────────────────────── */
const ASP = {
  elements: ['C', 'O', 'O', 'C', 'C'],
  positions: [0, 0, 0, 1.25, 0.55, 0, 1.25, -0.55, 0, -1.5, 0.35, 0.2, -2.6, 0.6, 1.6],
  bonds: [{ i: 0, j: 1, order: 2 }, { i: 0, j: 2, order: 1 }, { i: 0, j: 3, order: 1 }, { i: 3, j: 4, order: 1 }],
};
const asp = hydrogenatedOf(ASP);
const aspGraph = bondGraphOf({ bonds: asp.bonds, atomCount: asp.elements.length });
eq(ffIonisableGroupsOf({ elements: asp.elements, graph: aspGraph })
  .map((g) => `${g.name}:${g.form}:${g.spread}`),
['carboxylate:acid:-0.5'],
'⚠ un aspartate hydrogéné (un COOH, donc AUCUN carboxylate formel) est bien une fonction que le pH peut titrer');
const chargeAt = (ph) => partialChargesOf({ elements: asp.elements, bonds: asp.bonds, ph });
near(chargeAt(null).net, 0, '⚠ SANS pH, la fonction acide reste NEUTRE — le champ d’avant, au chiffre près', 1e-9);
eq(chargeAt(null).method, 'peoe', '…et la méthode ne prétend pas qu’une charge formelle a été posée');
ok(Math.abs(chargeAt(2).net) < 0.05, `à pH 2 le résidu est PROTONÉ (charge nette ${chargeAt(2).net} e)`);
near(chargeAt(7).net, -1, `à pH 7 il est DÉPROTONÉ (charge nette ${chargeAt(7).net} e : −1, comme la chimie l’exige)`, 1e-3);
near(chargeAt(12).net, -1, '…et à pH 12 il l’est encore (l’acide est passé entièrement à sa forme ionisée)', 1e-3);
eq(chargeAt(7).method, 'peoe+formal+ph', '⚠ la méthode DIT le pH et la charge formelle qu’il a posée');
eq(chargeAt(2).ionisation.groups[0].pka, FF_PKA.carboxylate, '…et le rapport rend le pKa qu’il a lu');

/* ── 5 · LE CHAMP ENTIER — L'ÉNERGIE, ET LE DÉFAUT AU CHIFFRE PRÈS ───────────────────── */
const PROBE = {
  elements: ['C', 'O', 'O', 'C', 'N', 'H', 'H', 'H'],
  positions: [0, 0, 0, 1.25, 0.5, 0, 1.25, -0.5, 0, -1.6, 0, 0, -5, 0, 0, -5.5, 0.9, 0, -5.5, -0.9, 0, -5, 0, 0.9],
  bonds: [{ i: 0, j: 1, order: 2 }, { i: 0, j: 2, order: 1 }, { i: 0, j: 3, order: 1 },
    { i: 3, j: 4, order: 1 }, { i: 4, j: 5, order: 1 }, { i: 4, j: 6, order: 1 }, { i: 4, j: 7, order: 1 }],
};
const fieldOf = (extra) => ffKcalEnergyOf({ ...PROBE, hydrogenate: false, ...extra });
const plain = fieldOf({});
eq(plain.ph, null, 'sans pH, le rapport du champ dit « pas de pH » (jamais 0)');
eq([plain.kappa, plain.debyeLength], [0, null], 'sans sel, κ = 0 et aucune longueur de Debye inventée');
eq(plain.ionisation.atWork, false, '…et l’ionisation dit qu’elle n’a rien fait');
near(plain.charges.net, 0, 'à « pas de pH », les deux groupes opposés se neutralisent (charge nette 0)', 1e-9);
const acidic = fieldOf({ ph: 2 });
eq(acidic.ph, 2, 'pH 2 : le rapport rend le pH LU');
eq(acidic.ionisation.atWork, true, '…et il DIT que le pH a travaillé');
ok(acidic.ionisation.groups.some((g) => g.name === 'carboxylate' && g.factor < 0.02), '…le carboxylate est neutre à pH 2');
ok(acidic.ionisation.groups.some((g) => g.name === 'ammonium' && g.factor > 0.99), '…et l’ammonium reste chargé');
near(acidic.charges.net, 1, `la charge NETTE suit le pH (${plain.charges.net} → ${acidic.charges.net} e)`, 0.06);
ok(Math.abs(acidic.elec) < Math.abs(plain.elec), `le pH change l’électrostatique (${plain.elec.toFixed(2)} → ${acidic.elec.toFixed(2)} kcal/mol)`);
const salty = fieldOf({ ionicStrength: 0.15 });
ok(salty.kappa > 1.2 && salty.debyeLength > 0.7 && salty.debyeLength < 0.9, `150 mM : κ = ${salty.kappa} Å⁻¹, longueur de Debye ${salty.debyeLength} Å`);
ok(Math.abs(salty.elec) < Math.abs(plain.elec), `…et l’électrostatique est ÉCRANTÉE (${plain.elec.toFixed(2)} → ${salty.elec.toFixed(2)} kcal/mol)`);
eq(fieldOf({ ionicStrength: 0 }).elec, plain.elec, '⚠ I = 0 rend EXACTEMENT l’énergie d’avant (au chiffre près)');
eq(fieldOf({ ph: null }).elec, plain.elec, '⚠ pH nul rend EXACTEMENT l’énergie d’avant (au chiffre près)');
eq([ffKcalEnergyOf({}).kappa, ffKcalEnergyOf({}).ph, ffKcalEnergyOf({}).ionisation.atWork], [0, null, false],
  'un refus (aucune coordonnée) rend κ = 0, un pH nul et une lecture d’ionisation VIDE — jamais `undefined`');

/* ── 6 · LES MOTEURS — LA CHIMIE EST LUE PAR CEUX QUI BOUGENT LA MOLÉCULE ───────────────
   La sonde est LE MODÈLE DE LA PAGE (la même extraction que `_md_clash_report_test.mjs`) : une
   séquence tapée donne un peptide complet — Asp, Glu, His, Lys — donc des fonctions que le pH
   déplace vraiment. C'est la géométrie sur laquelle un ▶ MD tourne pour de bon. */
const SECTION = read('./src/components/NMRSections.jsx');
const builderOf = (name) => {
  const marker = `const ${name} = `;
  const start = SECTION.indexOf(marker);
  if (start === -1) throw new Error(`missing ${name}`);
  let depth = 0;
  let i = start + marker.length;
  for (; i < SECTION.length; i += 1) {
    const ch = SECTION[i];
    if (ch === '{' || ch === '[' || ch === '(') depth += 1;
    else if (ch === '}' || ch === ']' || ch === ')') depth -= 1;
    else if (ch === ';' && depth === 0) break;
  }
  return `${SECTION.slice(start, i + 1)}\n`;
};
const BUILDER_ORDER = ['_vecSub', '_vecAdd', '_vecScale', '_vecDot', '_vecCross', '_vecNorm',
  '_vecNormalize', '_deg2rad', 'nerfPlace', '_padLeft', '_padRight', '_formatAtomName', '_fmtNum',
  'pdbAtomLine', 'AA_1_TO_3', 'PROTEIN_BB', 'SS_TORSIONS', 'ssTorsionAt', '_ringClose',
  'placeSidechainAtoms', 'buildProteinBackbone', 'proteinSequenceToPdbText'];
const proteinSequenceToPdbText = new Function(
  `${BUILDER_ORDER.map(builderOf).join('')}\nreturn proteinSequenceToPdbText;`,
)();
const parsePdb = (text) => {
  const els = []; const pts = []; const serial = []; const pairs = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const rec = line.slice(0, 6).trim();
    if (rec === 'ATOM' || rec === 'HETATM') {
      serial.push(parseInt(line.slice(6, 11), 10));
      els.push(line.slice(76, 78).trim() || 'C');
      pts.push(Number(line.slice(30, 38)), Number(line.slice(38, 46)), Number(line.slice(46, 54)));
    } else if (rec === 'CONECT') {
      const a = parseInt(line.slice(6, 11), 10);
      for (let i = 11; i + 5 <= line.length; i += 5) {
        const b = parseInt(line.slice(i, i + 5), 10);
        if (Number.isInteger(a) && Number.isInteger(b) && a !== b) pairs.add(a < b ? `${a}|${b}` : `${b}|${a}`);
      }
    }
  }
  const at = new Map(serial.map((s, k) => [s, k]));
  const bonds = [];
  for (const key of pairs) {
    const [a, b] = key.split('|').map(Number);
    if (at.has(a) && at.has(b)) bonds.push({ i: at.get(a), j: at.get(b), order: 1 });
  }
  return { count: els.length, elements: els, positions: pts, bonds };
};
const PEPTIDE = parsePdb(proteinSequenceToPdbText('ACDEFGHIK', ''));
ok(PEPTIDE.count > 100, `la séquence engendre un modèle complet (${PEPTIDE.count} atomes, hydrogènes compris)`);
const runPeptide = (extra) => molecularDynamicsOf({
  positions: Array.from(PEPTIDE.positions), elements: PEPTIDE.elements, bonds: PEPTIDE.bonds,
  steps: 150, temperature: 300, perFrame: 25, seed: 11, ...extra,
});
const dryRun = runPeptide({});
const dryAgain = runPeptide({});
const acidicRun = runPeptide({ ph: 7 });
const acidicSalty = runPeptide({ ph: 7, ionicStrength: 0.15 });
ok(dryRun.ok && dryRun.applied > 0, `la dynamique tourne pour de bon sur ce modèle (${dryRun.applied} pas appliqués)`);
eq(dryRun.chemistry.ph, null, 'sans pH, le rapport de la dynamique dit « pas de pH » (jamais 0)');
eq(dryRun.chemistry.kappa, 0, '…et aucun écrantage');
ok(Number.isFinite(dryRun.chemistry.net) && dryRun.chemistry.net > 0,
  `…le peptide porte la charge de sa chimie de GRAPHE (${dryRun.chemistry.net} e : les deux ammoniums, les acides neutres)`);
eq(Array.from(dryAgain.positions), Array.from(dryRun.positions),
  '⚠ la même graine redonne la même trajectoire (aucun hasard caché dans la chimie)');
const diffOf = (a, b) => Array.from(a).reduce((m, v, k) => Math.max(m, Math.abs(v - b[k])), 0);
ok(diffOf(dryRun.positions, acidicRun.positions) > 1e-9,
  `⚠ LE pH CHANGE VRAIMENT LA TRAJECTOIRE (écart max ${diffOf(dryRun.positions, acidicRun.positions).toFixed(4)} Å) : la charge est dans la force, pas seulement dans le rapport`);
eq(acidicRun.chemistry.ph, 7, 'pH 7 : la dynamique DIT le pH qu’elle a lu');
eq(acidicRun.chemistry.atWork, true, '…et que le pH a changé la charge de la molécule');
ok(Math.abs(acidicRun.chemistry.net - dryRun.chemistry.net) > 1,
  `⚠ …et la charge NETTE a vraiment changé (${dryRun.chemistry.net} → ${acidicRun.chemistry.net} e : les acides sont ionisés à pH 7)`);
ok(diffOf(acidicRun.positions, acidicSalty.positions) > 1e-9,
  `⚠ …ET LA FORCE IONIQUE CHANGE CELLE D’UNE MOLÉCULE CHARGÉE (écart max ${diffOf(acidicRun.positions, acidicSalty.positions).toFixed(4)} Å : l’écrantage retire de l’attraction)`);
ok(acidicSalty.chemistry.kappa > 1.2 && acidicSalty.chemistry.debyeLength > 0.7,
  `…et le rapport dit κ = ${acidicSalty.chemistry.kappa} Å⁻¹, longueur de Debye ${acidicSalty.chemistry.debyeLength} Å`);
const minRun = minimizeTorsionsOf({ ...PEPTIDE, rounds: 2, ph: 7, ionicStrength: 0.05 });
eq([minRun.ok, minRun.chemistry.ph, minRun.chemistry.ionicStrength], [true, 7, 0.05],
  'la descente ⚒ lit la même chimie et la DIT');
const anRun = annealTorsionsOf({ ...PEPTIDE, steps: 1, hot: 600, cold: 600, moves: 8, ph: 7, ionicStrength: 0.05 });
eq([anRun.ok, anRun.chemistry.ph, anRun.chemistry.ionicStrength], [true, 7, 0.05],
  'le recuit 🔥 aussi (le protocole entier tourne donc dans la chimie demandée)');
has(MODULE, 'ph = FF_PH_DEFAULT, ionicStrength = FF_IONIC_STRENGTH_DEFAULT,\n} = {}) {',
  '⚠ …et c’est le MÊME contrat pour la dynamique et la minimisation (mêmes défauts, mêmes noms)');



/* ── 7 · LE MODULE DIT CE QU'IL FAIT — LE CHAMP ──────────────────────────────────────── */
has(FIELD, 'export const FF_PKA = {', 'les pKa sont une table NOMMÉE du champ (aucun n’est deviné d’un fichier)');
has(FIELD, 'export const ffIonisableGroupsOf = ({', '…avec la seconde lecture (les formes ACIDES qu’un squelette hydrogéné porte)');
has(FIELD, "out.push({ name: 'carboxylate', charge: -1, atoms: oxygens, spread: -0.5, form: 'acid' });",
  '…un carboxyle y est un groupe à part entière, titré par le MÊME pKa que le carboxylate');
has(FIELD, 'export const ffDebyeKappaOf = (ionicStrength = FF_IONIC_STRENGTH_DEFAULT) => {',
  'κ est une fonction du champ, avec le défaut du module');
has(FIELD, 'export const ffScreeningOf = (kappa, r)', 'une SEULE définition de l’écrantage (le prix ET la pente la lisent)');
has(FIELD, 'if (!(Number(kappa) > 0)) return pair.cqq / (eps * rr * rr);',
  '⚠ κ = 0 court-circuite vers la formule HISTORIQUE du Coulomb (le défaut est bit-à-bit l’ancien)');
has(FIELD, 'kappa = 0,\n} = {}) => {\n  if (!pair || !Number.isFinite(r) || r <= 0) return 0;',
  '…et le gradient d’un couple reçoit le même κ');
has(FIELD, 'ph = FF_PH_DEFAULT, ionicStrength = FF_IONIC_STRENGTH_DEFAULT,',
  'le champ entier reçoit les deux réglages (⟳ Energy et la note d’un modèle les portent)');
has(FIELD, 'ph: charges.ph, ionisation: charges.ionisation,',
  '…et le rapport les rend (le panneau peut les CITER au lieu de les supposer)');

/* ── 8 · LE MODULE DU PROTOCOLE — LES QUATRE MOTEURS ET LE SCORE ─────────────────────── */
eq(MODULE.split('ph = FF_PH_DEFAULT, ionicStrength = FF_IONIC_STRENGTH_DEFAULT,').length - 1, 7,
  '⚠ LES SEPT portes du protocole (recuit, champ entier, note d’un modèle, moteur commun, fenêtres '
  + 'de la dynamique, dynamique, minimisation) prennent la MÊME paire de réglages');
has(MODULE, 'out.chemistry = engine.chemistry;',
  'le recuit rend la chimie de son moteur (la même clé que le rapport des autres gestes)');
eq(MODULE.split('chemistry: engine.chemistry,').length - 1, 2,
  '⚠ les DEUX moteurs qui passent par la fenêtre commune (dynamique, minimisation) la RENDENT aussi');
has(MODULE, 'chemistry: scored.forceField ? {', 'un DÉPART rend la chimie du champ qui l’a noté');
has(MODULE, 'partialChargesOf,', '…et la charge elle-même est réexportée pour le panneau (une seule lecture)');
has(MODULE, 'export const structureCalculationOf', 'le calcul entier reste conduit d’un trait (rien n’a bougé)');

/* ── 9 · LE PANNEAU — DEUX CASES, QUATRE GESTES, ET UNE PHRASE ───────────────────────── */
has(VIEW, 'aria-label="pH of the solution, for the protonation state of the molecule"',
  'le panneau ⚙ propose le pH (nommé pour ce qu’il est)');
has(VIEW, 'aria-label="Ionic strength of the solution in mol per litre, screening the electrostatic term"',
  '…et la force ionique (nommée pour ce qu’elle fait)');
has(VIEW, '🧪 pH · ionic strength', 'les deux vivent dans LEUR bloc, chez le champ de forces');
has(VIEW, 'const calcPhOf = () => {', 'une case vide vaut le DÉFAUT du module, jamais un pH 0');
has(VIEW, 'const calcIonicOf = () => {', '…et une force ionique vide vaut 0 (aucun sel)');
has(VIEW, 'const calcChemNow = () => {', 'la note à côté des cases lit la MOLÉCULE, par la fonction du champ');
has(VIEW, 'const calcChemNote = (c) => {', '…et une phrase rend ce qu’un geste a lu (charge nette, groupes, κ)');
eq(VIEW.split('ph: calcPhOf(), ionicStrength: calcIonicOf(),').length - 1, 4,
  '⚠ LES QUATRE GESTES DU CHAMP portent la même chimie (▶ Run, ▶ MD, ⚒ Minimise, ⟳ Energy)');
has(VIEW, '+ calcChemNote(run.chemistry)', 'le rapport du ▶ MD cite ce que le MOTEUR a lu');
eq(VIEW.split('+ calcChemNote(run.chemistry)').length - 1, 2, '…et celui du ⚒ Minimise aussi');
has(VIEW, '+ calcChemNote(field)', '…celui du ⟳ Energy cite le champ qu’il vient de lire');
has(VIEW, '+ calcChemNote(best.chemistry)', '…et celui du 🧬 cite la chimie du meilleur modèle');
has(VIEW, 'chemPh: calcPhText, chemIonic: calcIonicText,', 'les deux réglages survivent à un rechargement (le TEXTE tapé)');
has(VIEW, "if (typeof s.chemPh === 'string') setCalcPhText(s.chemPh);",
  '…et ils sont relus au montage (une session d’avant cette ligne reste au défaut)');
has(VIEW, 'THE pH AND THE IONIC STRENGTH of the ⚙ panel, when they are set, ARE read by this same field',
  '⚠ le rapport du 🧬 ne prétend plus « no ionic strength » quand l’utilisateur en a donné une');

/* ── 9 · LE PEPTIDE DU RAPPORT — 34 « AMMONIUMS » POUR 31 RÉSIDUS ─────────────────────────
   LE RAPPORT DE CETTE SESSION, MOT POUR MOT : « The pH setting is wrong. it gives me a charge
   of +36 at pH 7 for the peptide: SIIGIIMGILGNIPQVIQIIMSIVKAFKGNK. At pH 7 it should be +3! »
   — et la molécule de l’utilisateur disait, chiffre en main : « pH 7 — net charge +33.66 e,
   34/34 of its ionisable groups charged ». 34 = 31 + 3 : TOUS LES AZOTES DU SQUELETTE plus ses
   trois lysines étaient comptés comme des ammoniums (34 × 0,990099 = 33,66). La règle était un
   DÉCOMPTE DE VOISINS (`heavy + h >= 4 && h >= 1`), et un azote de squelette a déjà deux voisins
   lourds et un hydrogène : il suffisait qu’un PDB ajoute UNE liaison par distance (NGL le fait,
   `inferBonds`) — un H posé à 1,3 Å d’un azote, ce que le modèle de la page fait — pour qu’il
   passe pour une amine protonée, à +1 par résidu.

   CE QUI EST VÉRIFIÉ ICI, EXÉCUTÉ : sur LE peptide du rapport, construit par la page, le nombre
   de fonctions que le pH peut titrer ne bouge pas d’une seule quand CHAQUE azote de squelette
   gagne un voisin de plus — et les quatre qui restent sont ses QUATRE AMINES (trois lysines et
   son N-terminal). */
const REPORT_SEQ = 'SIIGIIMGILGNIPQVIQIIMSIVKAFKGNK';
const REPORT_MOL = parsePdb(proteinSequenceToPdbText(REPORT_SEQ, ''));
ok(REPORT_MOL.count > 400, `le peptide du rapport est bâti par la page (${REPORT_MOL.count} atomes)`);
const reportGraph = bondGraphOf({ bonds: REPORT_MOL.bonds, atomCount: REPORT_MOL.elements.length });
const groupsOfBonds = (bonds) => ffIonisableGroupsOf({
  elements: REPORT_MOL.elements, graph: bondGraphOf({ bonds, atomCount: REPORT_MOL.elements.length }),
});
/* UN VOISIN DE PLUS SUR CHAQUE AMIDE DU SQUELETTE — ce qu’une liaison devinée par distance fait. */
const extraBonds = [];
REPORT_MOL.elements.forEach((e, k) => {
  if (e !== 'N') return;
  const used = new Set(reportGraph.neighbours(k));
  const heavy = [...used].filter((m) => REPORT_MOL.elements[m] !== 'H');
  if (heavy.length < 2) return;                     // une amine, pas un amide : on n’y touche pas
  const h = REPORT_MOL.elements.findIndex((el, m) => el === 'H' && !used.has(m));
  if (h >= 0) extraBonds.push({ i: k, j: h, order: 1 });
});
ok(extraBonds.length >= 25, `…et ${extraBonds.length} azotes de squelette peuvent recevoir un voisin de trop`);
const plainGroups = groupsOfBonds(REPORT_MOL.bonds);
const denseGroups = groupsOfBonds([...REPORT_MOL.bonds, ...extraBonds]);
eq(plainGroups.map((g) => g.name), ['ammonium', 'ammonium', 'ammonium', 'ammonium'],
  '⚠ SES QUATRE AMINES SEULEMENT : trois lysines et le N-terminal (le peptide du rapport en a 3)');
eq(denseGroups.length, plainGroups.length,
  '⚠⚠ UN VOISIN DE PLUS SUR CHAQUE AMIDE NE CHANGE RIEN — c’est le défaut mesuré (+33,66 e, 34/34)');
eq(denseGroups.map((g) => g.name), plainGroups.map((g) => g.name), '…et ce sont les mêmes fonctions, une par une');
const reportCharge = partialChargesOf({ elements: REPORT_MOL.elements, bonds: [...REPORT_MOL.bonds, ...extraBonds], ph: 7 });
ok(Math.abs(reportCharge.net - 4 * ffIonisationOf({ name: 'ammonium' }, 7)) < 1e-6,
  `⚠ la charge du peptide à pH 7 est celle de ses quatre amines (${reportCharge.net} e — et non 34)`);
eq(reportCharge.ionisation.groups.length, 4, '…quatre fonctions ionisables dans le rapport du pH, jamais 34');


/* ── Bilan ───────────────────────────────────────────────────────────────────────────── */
console.log(`_chemistry_ph_ionic_test.mjs — ${passed} assertions OK `
  + '(🧪 le pH titre les fonctions ionisables — formes chargées ET formes acides qu’un squelette '
  + 'hydrogéné porte —, la force ionique écrante le Coulomb (Debye–Hückel, κ = 3.29·√I), le défaut '
  + 'reste bit-à-bit celui d’avant, et les quatre gestes du champ lisent la même chimie)');


