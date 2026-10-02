/* =========================================================================
   _sequence_charge_test.mjs — LA CHARGE D'UNE SÉQUENCE, SON ε₂₈₀ ET SA COMPOSITION.

   LA DEMANDE DE CETTE SESSION, MOT POUR MOT : « Under the sequence field please write the
   number of each type of aminoacids, the total charge at pH 7 and the estimated molar
   extinction coefficient. Keep this information compact utilising as much horizontal space.
   In the library the compound are defined with their modification, like acetylation or
   amidation. the charge should keep this into account. If the sequence is written directly
   into the sequence space, assume free termini. this is valid not only for this writing but
   also for the calculation of the charge based on pH in the “params and constraints” section.
   In that case, to calculate the charge based on pH you need to know the pka of all
   aminoacids side chains. I guess you know them already. »

   CE QUI EST VÉRIFIÉ ICI, EXÉCUTÉ (aucune capture d'écran, aucun navigateur) :
     • LA TABLE DES pKa — les sept chaînes latérales ET les deux terminus sont DITS par le
       module (Asp 3,86 · Glu 4,25 · His 6,00 · Cys 8,33 · Tyr 10,07 · Lys 10,50 · Arg 12,40 ·
       N-term 9,69 · C-term 2,34), et Henderson–Hasselbalch est exécuté des deux côtés
       (un acide se charge vers le haut, une base vers le bas, pH == pKa vaut exactement ½) ;
     • LE PEPTIDE DU RAPPORT vaut +3 À pH 7 (et non +36, ni +4) : ses CINQ fonctions sont son
       ammonium N-terminal, ses trois lysines et son carboxyle C-terminal ; sans pH il vaut +3
       aussi (la forme ionisée qu'une séquence écrite directement porte) ;
     • LES DEUX LECTURES S'ACCORDENT — la séquence (+2,997 e) et le graphe de la molécule que
       la page bâtit (+2,961 e) tombent toutes deux sur +3,00 e : le panneau peut dire d'où
       vient son chiffre sans que les deux se contredisent sur ce peptide ;
     • LES TERMINUS SONT GRATUITS PAR DÉFAUT et se retirent sur la définition du composé :
       Acetylation (et Acylation / Formylation, et leurs alias `acetyl`/`ac`) supprime
       l'ammonium N-terminal, Amidation (alias `amide`/`nh2`) le carboxyle C-terminal — deux
       fois la même modification ne retire qu'une fois, une faute de frappe ne retire rien ;
     • TOUTES LES CHAÎNES LATÉRALES COMPTENT — l'imidazole d'une histidine (que le graphe ne
       reconnaît pas) est chargé à pH 6 et neutre à pH 9, et une phosphorylation ajoute un
       phosphate (deux pKa, −1,39 e à pH 7) par unité écrite ;
     • LES CELLULES DE SÉQUENCE SONT CÂBLÉES — la ligne sous la case (composition · charge ·
       ε₂₈₀) est rendue par UN SEUL composant (src/components/SequenceReadingLine.jsx), sous la
       case de la fiche du composé de la Librairie COMME sous la case « … Sequence (1-letter
       code) » de la page NMR ; la lecture du ⚙ Params & Constraints, elle, DIT si son chiffre
       vient de la séquence ou du graphe, et reçoit les modifications de la fiche du composé.

   Run: node _sequence_charge_test.mjs
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AA_SIDECHAIN_PKA, AA_SIDECHAIN_CHARGE, AA_SIDECHAIN_KIND, TERMINUS_PKA, TERMINUS_CHARGE,
  PHOSPHATE_PKA, SEQUENCE_PH, AA_ALPHABET, N_TERMINUS_CAPS, C_TERMINUS_CAPS,
  hhFactorOf, sequenceLettersOf, sequenceCompositionOf, compositionTextOf,
  modificationEffectsOf, sequenceIonisableOf, sequenceChargeReportOf, proteinSequenceReadingOf,
} from './src/utils/sequenceCharge.js';
/* LA SECONDE LECTURE — celle du graphe, pour vérifier que les deux s'accordent sur ce peptide. */
import { partialChargesOf } from './src/utils/forceFieldKcal.js';

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};
const near = (a, b, what, eps = 1e-6) => {
  assert.ok(Math.abs(a - b) <= eps, `${what}\n  attendu ${b}, obtenu ${a} (± ${eps})`);
  passed += 1;
};
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const has = (src, needle, what) => {
  assert.ok(src.includes(needle), `${what}\n  cherche : ${needle}`);
  passed += 1;
};
const gone = (src, needle, what) => {
  assert.ok(!src.includes(needle), `${what}\n  ne doit plus contenir : ${needle}`);
  passed += 1;
};

const MODULE = read('./src/utils/sequenceCharge.js');
const MODS = read('./src/utils/modifications.js');
const SEQINFO = read('./src/utils/sequenceInfo.js');
const COMPOUND = read('./src/components/AppModules/compoundDefinitionSection.jsx');
const VIEW = read('./src/components/NMRMoleculeViewer.jsx');
const PAGE = read('./src/components/NMRSections.jsx');
/* LA LIGNE SOUS UNE CASE DE SÉQUENCE — le composant PARTAGÉ par les deux cases (Librairie et
   page NMR) : c'est lui qui porte les trois choses de la demande et leur bulle d'aide. */
const READING = read('./src/components/SequenceReadingLine.jsx');
/* LE PEPTIDE DU RAPPORT — 31 résidus, trois lysines, aucun acide latéral. */
const REPORT_SEQ = 'SIIGIIMGILGNIPQVIQIIMSIVKAFKGNK';

/* ── 1 · LA TABLE DES pKa — ELLE EST DITE, ET COMPLÈTE ──────────────────────────────────── */
has(MODULE, 'Under the sequence field please write the',
  'la demande est écrite dans le module (contrat de la ligne sous la case de séquence)');
has(MODULE, 'number of each type of aminoacids, the total charge at pH 7 and the estimated molar',
  '…mot pour mot : le nombre de chaque acide aminé, la charge à pH 7 et l’ε₂₈₀');
has(MODULE, 'the charge based on pH in the “params and constraints” section',
  '…et le lien avec le ⚙ Params & Constraints est écrit lui aussi');
has(MODULE, 'assume free termini', '…avec LA règle des terminus (« assume free termini »)');
eq(AA_SIDECHAIN_PKA, { D: 3.86, E: 4.25, H: 6.00, C: 8.33, Y: 10.07, K: 10.50, R: 12.40 },
  '⚠ LES SEPT chaînes latérales ionisables ont leur pKa (aucun n’est deviné)');
eq(Object.keys(AA_SIDECHAIN_KIND).length, 7, '…chacune dit de quel côté du pH elle se charge');
eq(Object.keys(AA_SIDECHAIN_CHARGE).length, 7, '…et quelle est sa forme CHARGÉE');
eq(Object.values(AA_SIDECHAIN_CHARGE).filter((c) => c > 0).length, 3,
  '…trois cations (His · Lys · Arg) et quatre anions');
eq(TERMINUS_PKA, { nTerm: 9.69, cTerm: 2.34 }, '⚠ les DEUX TERMINUS ont leur pKa (un peptide libre)');
eq(TERMINUS_CHARGE, { nTerm: 1, cTerm: -1 }, '…l’ammonium N-terminal +1, le carboxyle C-terminal −1');
eq(PHOSPHATE_PKA, [2.15, 7.20], '…et un phosphate est un DIACIDE (deux pKa, donc jusqu’à −2)');
eq(SEQUENCE_PH, 7, 'la lecture d’un panneau se fait à pH 7 par défaut (« the total charge at pH 7 »)');
eq(AA_ALPHABET.length, 20, 'l’alphabet de la composition est celui des vingt acides aminés');
eq(N_TERMINUS_CAPS, ['Acetylation', 'Acylation', 'Formylation'],
  'les capuchons d’AMINE (le N-terminal) sont une liste NOMMÉE — les libellés que le lecteur rend');
eq(C_TERMINUS_CAPS, ['Amidation'], '…et l’amide du C-terminal, elle aussi nommée');

/* ── 2 · HENDERSON–HASSELBALCH — EXÉCUTÉ DES DEUX CÔTÉS ─────────────────────────────────── */
const acid = (pka, ph) => hhFactorOf(pka, ph, 'acid');
const base = (pka, ph) => hhFactorOf(pka, ph, 'base');
eq([acid(4, 4), base(4, 4)], [0.5, 0.5], '⚠ à pH == pKa, un acide COMME une base est à moitié chargé');
near(acid(3.86, 7), 1 / (1 + 10 ** (3.86 - 7)), 'un acide se charge VERS LE HAUT du pH (Asp à pH 7)');
near(base(10.50, 7), 1 / (1 + 10 ** (7 - 10.50)), 'une base VERS LE BAS (Lys à pH 7, presque +1)');
ok(acid(3.86, 2) < 0.02, `à pH 2 un carboxyle d’Asp est neutre (${acid(3.86, 2).toFixed(4)})`);
ok(base(10.50, 12) < 0.031, `…et à pH 12 un ammonium de Lys est neutre (${base(10.50, 12).toFixed(5)})`);
ok(base(6.00, 6) === 0.5 && acid(8.33, 8.33) === 0.5, '…la même règle pour l’imidazole et le thiol');
eq([hhFactorOf(5, null, 'acid'), hhFactorOf(5, '', 'base'), hhFactorOf(5, 'x', 'acid')],
  [1, 1, 1], '⚠ SANS pH (absent, vide, illisible) chaque fonction garde sa FORME CHARGÉE');
ok(acid(3.86, 7) > 0.999 && acid(3.86, 7) < 1, 'à pH 7 le carboxyle d’Asp est chargé (0,99987)');

/* ── 4 · LE PEPTIDE DU RAPPORT — +3 À pH 7, AVEC SES CINQ FONCTIONS ─────────────────────── */
const report = proteinSequenceReadingOf(REPORT_SEQ, { ph: 7 });
eq([report.length, Math.round(report.mw)], [31, 3310], 'le peptide pèse 31 résidus et 3310 Da');
eq(report.epsilon, 0,
  '⚠ ε₂₈₀ = 0 : ni Trp, ni Tyr, ni cystine — ce peptide n’absorbe vraiment rien à 280 nm');
eq(report.composition.counts.W, 0, '…il n’a aucun tryptophane');
eq(report.charge.groups.map((g) => g.name),
  ['ammonium (N-term)', 'ammonium (Lys)', 'ammonium (Lys)', 'ammonium (Lys)', 'carboxylate (C-term)'],
  '⚠ SES CINQ FONCTIONS : l’ammonium N-terminal, ses trois lysines, son carboxyle C-terminal');
eq(report.charge.total, 5, '…cinq fonctions titrables, jamais 34');
eq(report.charge.ionised, 5, '…toutes chargées à pH 7 (la fiche du pH le dit : 5/5)');
ok(Math.abs(report.net - 3) < 0.01,
  `⚠⚠ LE PEPTIDE VAUT +3 À pH 7 (${report.net} e) — le chiffre du rapport, et non +36 ni +4`);
near(report.net, 3 * base(10.50, 7) + base(9.69, 7) - acid(2.34, 7),
  '…la somme de ses cinq fonctions, chacune par Henderson–Hasselbalch', 1e-5);
const reportNoPh = sequenceChargeReportOf(REPORT_SEQ, null, {});
eq([reportNoPh.net, reportNoPh.ph, reportNoPh.listed], [3, null, false],
  '⚠ SANS pH il vaut +3 aussi (4 × +1 et 1 × −1) — et le rapport dit « pas de pH », jamais 0');
const titration = [2, 5, 7, 9, 12].map((p) => sequenceChargeReportOf(REPORT_SEQ, p).net);
ok(titration.every((v, k) => k === 0 || v <= titration[k - 1] + 1e-9),
  `…et sa charge DESCEND quand le pH monte (${titration.map((v) => v.toFixed(2)).join(' → ')})`);
ok(titration[0] > 3.5 && titration[4] < -0.5,
  '…de plus de +3,5 (pH 2, les trois lysines ET l’acide) à moins de −0,5 (pH 12, déprotoné)');

/* ── 4bis · LES DEUX LECTURES S'ACCORDENT SUR CE PEPTIDE ──────────────────────────────────
   Le ⚙ Params & Constraints dit d'où vient son chiffre : la SÉQUENCE, ou le GRAPHE de la
   molécule à l'écran. Sur ce peptide les deux doivent tomber sur +3,00 e — sinon le panneau
   aurait l'air de se contredire lui-même. Le modèle est celui que la PAGE bâtit (son
   `proteinSequenceToPdbText`, extrait du JSX comme les autres suites le font). */
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
  const els = []; const serial = []; const pairs = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const rec = line.slice(0, 6).trim();
    if (rec === 'ATOM' || rec === 'HETATM') {
      serial.push(parseInt(line.slice(6, 11), 10));
      els.push(line.slice(76, 78).trim() || 'C');
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
  return { count: els.length, elements: els, bonds };
};
const built = parsePdb(proteinSequenceToPdbText(REPORT_SEQ, ''));
ok(built.count > 400, `la page bâtit le peptide (${built.count} atomes, OXT compris)`);
const graphReading = partialChargesOf({ elements: built.elements, bonds: built.bonds, ph: 7 });
ok(Math.abs(graphReading.net - 3) < 0.05,
  `⚠ LE GRAPHE AUSSI TOMBE SUR +3,00 e (${graphReading.net.toFixed(3)} e, ${graphReading.ionisation.groups.length} groupes)`);
ok(Math.abs(graphReading.net - report.net) < 0.06,
  `⚠⚠ LES DEUX LECTURES S’ACCORDENT (séquence ${report.net} e · graphe ${graphReading.net.toFixed(3)} e : `
  + 'la petite différence est celle des pKa génériques du champ contre ceux, par résidu, de la séquence)');
eq(report.net.toFixed(2), '3.00', '…et les deux s’affichent « net +3.00 e » (la demande)');

/* ── 5 · LES TERMINUS — GRATUITS PAR DÉFAUT, RETIRÉS PAR LA FICHE DU COMPOSÉ ─────────────── */
const free = proteinSequenceReadingOf(REPORT_SEQ, { ph: 7 });
eq(free.effects.terminus, { nTerm: 'free', cTerm: 'free' },
  '⚠ UNE SÉQUENCE ÉCRITE DIRECTEMENT vaut des terminus GRATUITS (la règle de la demande)');
const acetyl = proteinSequenceReadingOf(REPORT_SEQ, { modifications: 'Acetylation', ph: 7 });
eq(acetyl.effects.terminus, { nTerm: 'acetylated', cTerm: 'free' }, 'Acetylation capuchonne le N-terminal');
eq(acetyl.charge.groups.some((g) => g.terminus === 'nTerm'), false,
  '…donc il n’y a PLUS d’ammonium N-terminal à titrer');
near(acetyl.net, 3 * base(10.50, 7) - acid(2.34, 7), '…et la charge perd exactement ce +1 (≈ +2,00 e)', 1e-5);
const amide = proteinSequenceReadingOf(REPORT_SEQ, { modifications: 'Amidation', ph: 7 });
eq(amide.effects.terminus, { nTerm: 'free', cTerm: 'amidated' }, 'Amidation capuchonne le C-terminal');
eq(amide.charge.groups.some((g) => g.terminus === 'cTerm'), false, '…le carboxyle C-terminal disparaît');
near(amide.net, base(9.69, 7) + 3 * base(10.50, 7), '…et la charge remonte de +1 (≈ +4,00 e)', 1e-5);
const both = proteinSequenceReadingOf(REPORT_SEQ, { modifications: 'Acetylation; Amidation', ph: 7 });
eq(both.charge.total, 3, 'les deux capuchons ne laissent que les trois lysines à titrer');
near(both.net, 3 * base(10.50, 7), '…et la charge est celle de ces trois lysines (≈ +3,00 e)', 1e-5);
[ 'acetyl', 'ac', 'ACETYLATION'].forEach((alias) => ok(
  modificationEffectsOf(alias).acetylated, `l’alias « ${alias} » est reconnu (le lecteur normalise)`));
['amide', 'nh2', 'Amidation: 4'].forEach((alias) => ok(
  modificationEffectsOf(alias).amidated, `…et « ${alias} » pour l’amide`));
eq(modificationEffectsOf('Acetylation:2').terminus, { nTerm: 'acetylated', cTerm: 'free' },
  '⚠ DEUX FOIS la même modification ne retire qu’UNE fois (un terminus n’existe qu’une fois)');
eq(modificationEffectsOf('Acetylaton, Nonsense').terminus, { nTerm: 'free', cTerm: 'free' },
  '⚠ une faute de frappe ne retire rien : la table est celle des libellés connus');
eq(modificationEffectsOf('Phosphorylation:2').phospho, 2, '…et un phosphate se compte par unité écrite');
eq(proteinSequenceReadingOf(REPORT_SEQ, { modifications: 'Methylation:3', ph: 7 }).net, free.net,
  'une méthylation ne change pas la charge (une lysine méthylée reste un ammonium)');
ok(sequenceIonisableOf('').length === 0 && sequenceIonisableOf('   ').length === 0,
  '⚠ une séquence vide n’a AUCUN groupe de terminus : il n’y a pas de peptide');

/* ── 6 · TOUTES LES CHAÎNES LATÉRALES — Y COMPRIS L’IMIDAZOLE QUE LE GRAPHE IGNORE ───────── */
const allIon = sequenceChargeReportOf('DEHCYKR', 7);
eq(allIon.groups.map((g) => g.name), [
  'ammonium (N-term)', 'carboxylate (Asp)', 'carboxylate (Glu)', 'imidazole (His)',
  'thiolate (Cys)', 'phenolate (Tyr)', 'ammonium (Lys)', 'guanidinium (Arg)',
  'carboxylate (C-term)',
], '⚠ LES SEPT familles latérales ET les deux terminus sont titrés, dans l’ordre de la séquence');
eq(allIon.groups.map((g) => g.pka[0]),
  [9.69, 3.86, 4.25, 6.00, 8.33, 10.07, 10.50, 12.40, 2.34],
  '…chacun avec SON pKa (aucun n’est celui d’un autre)');
eq(allIon.groups.map((g) => g.position), [1, 1, 2, 3, 4, 5, 6, 7, 7],
  '…et l’on sait QUEL résidu le porte (la position de la séquence)');
const hisFactor = (ph) => sequenceChargeReportOf('AH', ph).groups.find((g) => g.aa === 'H');
ok(Math.abs(hisFactor(6).factor - 0.5) < 1e-9 && hisFactor(9).factor < 0.01,
  '⚠ L’IMIDAZOLE COMPTE : chargé à pH 6 (½), neutre à pH 9 — c’est ce que le graphe ne sait pas dire');
ok(Math.abs(hisFactor(6).contribution - 0.5) < 1e-9 && hisFactor(9).contribution < 0.01,
  `…et cette seule histidine vaut ½ charge à pH 6 (${hisFactor(6).contribution} e) `
  + `puis presque rien à pH 9 (${hisFactor(9).contribution} e)`);
eq(sequenceIonisableOf('AGILMFWVPSTNQ', {}).length, 2,
  '…et un peptide sans résidu ionisable ne porte que ses deux terminus');
eq(sequenceIonisableOf('DEHCYKR', {}).map((g) => g.charge),
  [1, -1, -1, 1, -1, -1, 1, 1, -1], '…chaque groupe dit sa forme CHARGÉE (le signe compte)');

/* ── 7 · LA PHOSPHORYLATION — UN DIACIDE, COMPTÉ PAR UNITÉ ─────────────────────────────── */
const plain = sequenceChargeReportOf('SPS', 7);
const phospho = sequenceChargeReportOf('SPS', 7, { modifications: 'Phosphorylation' });
near(plain.net - phospho.net, acid(2.15, 7) + acid(7.20, 7),
  `⚠ un phosphate ajoute ${(plain.net - phospho.net).toFixed(3)} e à pH 7 (ses DEUX pKa)`, 1e-5);
const twoPhospho = sequenceChargeReportOf('SPS', 7, { modifications: 'Phosphorylation:2' });
near(phospho.net - twoPhospho.net, acid(2.15, 7) + acid(7.20, 7),
  '…et deux unités écrites en comptent deux fois autant', 1e-5);

/* ── 8 · LA LIGNE ET LA SECONDE LECTURE SONT CÂBLÉES PAR CE MODULE-LÀ ───────────────────── */
/* (a) LA LIGNE SOUS UNE CASE DE SÉQUENCE — UN SEUL RENDU POUR LES DEUX CASES : la fiche du
   composé de la Librairie et la case « … Sequence (1-letter code) » de la page NMR. */
has(READING, '{reading.length} aa', 'la ligne dit le NOMBRE DE RÉSIDUS');
has(READING, 'compositionTextOf(reading.composition)',
  '…LE NOMBRE DE CHAQUE ACIDE AMINÉ (« A 1 · F 1 · G 4 … »)');
has(READING, "net {reading.net >= 0 ? '+' : ''}{reading.net.toFixed(2)} e at pH 7",
  '…LA CHARGE TOTALE À pH 7');
has(READING, 'ε₂₈₀ {Math.round(reading.epsilon).toLocaleString()} M⁻¹cm⁻¹',
  '…et l’ε₂₈₀ estimé, en M⁻¹cm⁻¹');
has(READING, 'flex flex-wrap items-center gap-x-3 gap-y-1',
  '⚠ UNE ligne COMPACTE qui REMPLIT la largeur (flex-wrap, « utilising as much horizontal space »)');
has(READING, 'free N-term', '…et les deux terminus y sont DITS (gratuits ou capuchonnés)');
has(READING, 'if (!reading || !reading.ok) return null;',
  '⚠ une lecture absente — ou vide — ne rend RIEN (jamais une ligne muette)');
has(READING, 'utils/sequenceCharge.js — the pKa of EVERY side chain',
  '…et sa bulle d’aide DIT d’où vient la charge (le module pur, jamais le graphe)');
has(READING, '${TERMINUS_PKA.nTerm}', '…en citant les pKa des DEUX terminus du module');
gone(READING, 'nW * 5500', '⚠ aucune règle d’ε₂₈₀ recopiée : le chiffre vient de l’analyseur du dossier');

/* (a1) LA CASE DE LA LIBRAIRIE — la fiche du composé. */
has(COMPOUND, "import { proteinSequenceReadingOf } from '../../utils/sequenceCharge';",
  'la fiche de la Librairie lit CE module (aucune charge recalculée dans le JSX)');
has(COMPOUND, "import { SequenceReadingLine } from '../SequenceReadingLine';",
  '…et rend LA ligne partagée (une seule copie du JSX dans tout le dossier)');
has(COMPOUND, 'return proteinSequenceReadingOf(stripHtml(sequence), { modifications: modText, ph: 7 });',
  '…avec LA SÉQUENCE ET LE TEXTE DES MODIFICATIONS, à pH 7 (la demande)');
has(COMPOUND, '⚠ LA CASE EST DU HTML (RichTextEditor) : le module lit `stripHtml(sequence)`',
  '⚠ la case est du HTML : la lecture passe par stripHtml (les lettres des balises ne comptent pas)');
has(COMPOUND, 'const seqReading = useMemo(() => {',
  '…dans une lecture mémorisée (elle suit la séquence ET les modifications)');
has(COMPOUND, '<SequenceReadingLine reading={seqReading} className="mb-4" />',
  '…et c’est la ligne partagée qui est rendue, SOUS la case de séquence');

/* (a2) LA CASE DE LA PAGE NMR — « Molecular structure and visualization », la case où l’on écrit
   la séquence d’une condition et où la demande voulait cette information. */
has(PAGE, "import { proteinSequenceReadingOf } from '../utils/sequenceCharge';",
  'la case de séquence de la page NMR lit le MÊME module pur');
has(PAGE, "import { SequenceReadingLine } from './SequenceReadingLine';",
  '…et rend la MÊME ligne (le composant partagé, jamais une seconde copie)');
has(PAGE, "if (d.moleculeType !== 'protein' || !raw) return null;",
  '…seulement pour une PROTÉINE dont la case n’est pas vide');
has(PAGE, "return proteinSequenceReadingOf(raw, { modifications: activeTest.modifications || '', ph: 7 });",
  '…avec les modifications de la condition (celles que la fiche du composé sème) et à pH 7');
has(PAGE, 'const seqReading = useMemo(() => {',
  '…dans une lecture mémorisée (elle suit la séquence ET les modifications)');
has(PAGE, '<SequenceReadingLine reading={seqReading} className="mt-1" />',
  '…rendue SOUS la case, juste après la ligne « Length: … »');
gone(PAGE, 'nW * 5500', '⚠ la page ne recalcule ni charge ni ε₂₈₀ : tout vient du module');

/* (b) LE ⚙ PARAMS & CONSTRAINTS — la seconde lecture, qui DIT d'où vient son chiffre. */
has(VIEW, "import { sequenceChargeReportOf, AA_SIDECHAIN_PKA } from '../utils/sequenceCharge';",
  'le viewer lit le MÊME module (aucune table recopiée)');
has(VIEW, 'const calcSeqChemNow = () => {', 'la seconde lecture existe, à côté de celle du graphe');
has(VIEW, 'sequenceChargeReportOf(seq, calcPhOf(), { modifications: sequenceModifications })',
  '…elle titre la SÉQUENCE au pH de la case, avec les modifications du composé');
has(VIEW, "if (moleculeType !== 'protein') return null;", '…seulement pour une protéine');
has(VIEW, 'lastLoadedTextRef.current !== sequenceStructureText',
  '…et seulement quand l’écran montre LE MODÈLE DE LA SÉQUENCE (pas un PDB chargé)');
has(VIEW, '`${netPhraseOf(seqChem)} · read from the SEQUENCE (',
  '⚠ le panneau DIT que le chiffre vient de la séquence');
has(VIEW, '`${netPhraseOf(chem)} · read from the BOND GRAPH`)',
  '…et qu’il vient du GRAPHE, sinon (jamais l’un pour l’autre)');
has(VIEW, '${seqChem.effects.terminus.nTerm} N-term · ${seqChem.effects.terminus.cTerm} C-term',
  '…en nommant les deux terminus (la lecture par défaut est bien écrite)');
has(VIEW, "sequenceModifications = '',", 'le viewer REÇOIT la définition des modifications (une prop)');
has(VIEW, 'utils/sequenceCharge.js — i.e. the pKa of EVERY side chain',
  '…et la bulle d’aide du panneau explique LES DEUX modèles, et lequel il montre');
has(PAGE, 'sequenceModifications={activeTest.modifications',
  'la page passe les modifications de la condition au viewer');
has(PAGE, 'updates.modifications = meta.modifications',
  '…que la fiche de la Librairie SÈME dans la condition, comme sa séquence et son type');

/* (c) UNE SEULE TABLE, UN SEUL LECTEUR — rien n'est recopié. */
has(MODULE, "import { parseModificationsOf } from './modifications.js';",
  'la charge d’une séquence lit LE lecteur de modifications du dossier');
has(MODS, "{ id: 'acetylation', label: 'Acetylation', delta: 42.0106",
  '…qui vit dans utils/modifications.js (avec ses alias)');
gone(SEQINFO, "id: 'acetylation', label: 'Acetylation'", '⚠ la table n’y est PLUS : une seule copie');
has(SEQINFO, "export { MODIFICATIONS } from './modifications.js';",
  '…elle y est RÉEXPORTÉE (le reste de l’application ne voit aucune différence)');
has(SEQINFO, 'formulaMassOf: getMolecularWeightFromFormula',
  '…avec la pesée de formule chimique liée, exactement comme avant');
gone(MODULE, 'nW * 5500', '⚠ l’ε₂₈₀ n’est pas RECALCULÉ ici : il vient de l’analyseur du dossier');
has(MODULE, 'epsilon: analysis.eps280', '…`epsilon` EST l’eps280 de cet analyseur');
has(MODULE, "import { analyzeProteinSequence } from '../components/cloningUtils.js';", '…qui est importé');
has(MODS, "{ id: 'amidation', label: 'Amidation', delta: -0.984, aliases: ['amide', 'nh2'] }",
  '…et l’amidation garde ses alias (l’utilisateur peut écrire « amide »)');
eq(proteinSequenceReadingOf('AXBKU', { ph: 7 }).composition.unknown, ['X', 'B', 'U'],
  '⚠ une lettre non standard est COMPTÉE et DITE (jamais chargée en silence)');

/* ── Bilan ───────────────────────────────────────────────────────────────────────────── */
console.log(`_sequence_charge_test.mjs — ${passed} assertions OK `
  + '(🧬 la charge d’une séquence : le pKa de CHAQUE chaîne latérale, les deux terminus GRATUITS '
  + 'par défaut et capuchonnés par la fiche du composé — +3,00 e pour le peptide du rapport —, '
  + 'la composition en une ligne, l’ε₂₈₀, et la ligne des DEUX cases de séquence — Librairie et '
  + 'page NMR — câblée sur le même module)');

eq(phospho.groups[phospho.groups.length - 1].pka, [2.15, 7.20],
  '…le groupe phosphate PORTE ses deux pKa (aucun autre groupe n’en a deux)');
eq(sequenceChargeReportOf('SPS', null, { modifications: 'Phosphorylation' }).net, -2,
  '…sans pH un phosphate garde sa forme la plus chargée (deux protons partis : −2)');



/* ── 3 · LA COMPOSITION, EN LETTRES ET EN UNE LIGNE ─────────────────────────────────────── */
eq(sequenceLettersOf(REPORT_SEQ).length, 31, 'la séquence du rapport fait 31 résidus');
eq(sequenceLettersOf('ac def\ngh*'), ['A', 'C', 'D', 'E', 'F', 'G', 'H'],
  'les lettres sont nettoyées en majuscules (espaces, retours et codons stop écartés)');
const comp = sequenceCompositionOf(REPORT_SEQ);
eq(comp.length, 31, '…la composition compte TOUTES les lettres');
eq(comp.known, 31, '…et toutes sont des acides aminés standard');
eq(comp.unknown, [], '…aucune lettre inconnue dans le peptide du rapport');
eq([comp.counts.K, comp.counts.I, comp.counts.G, comp.counts.A], [3, 10, 4, 1],
  '⚠ trois lysines, dix isoleucines, quatre glycines, une alanine');
eq(Object.keys(comp.counts).filter((aa) => comp.counts[aa] > 0).length, 12,
  'douze types d’acides aminés présents (et huit à zéro : ils sont quand même DITS)');
eq(compositionTextOf(comp), 'A 1 · F 1 · G 4 · I 10 · K 3 · L 1 · M 2 · N 2 · P 1 · Q 2 · S 2 · V 2',
  '⚠ la ligne compacte ne montre que les lettres PRÉSENTES, dans l’ordre de l’alphabet');
eq(compositionTextOf(sequenceCompositionOf('')), '', '…et une séquence vide ne fait aucune ligne');
eq(compositionTextOf(sequenceCompositionOf('AXBKU')), 'A 1 · K 1 · X 1 · B 1 · U 1',
  '…les lettres non standard sont à la FIN, comptées elles aussi (la ligne du panneau le dit)');

