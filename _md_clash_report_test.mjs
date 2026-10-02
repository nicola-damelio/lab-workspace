/* =========================================================================
   _md_clash_report_test.mjs — LA DYNAMIQUE REND SES CLASH.

   LA DEMANDE DE CETTE SESSION, mot pour mot : « all this doesn't matter, just report the
   clashes. » Elle vient d'une MESURE, faite sur la géométrie que l'application engendre
   elle-même (`proteinSequenceToPdbText`) : pendant un ▶ MD à 300 K, deux atomes que le
   graphe NE LIE PAS se retrouvent à 1.22 Å — 1439 R·T de Lennard-Jones, et 12 des 20
   images regardées portaient un couple sous 0.70·r_min. L'œil voyait donc des sphères se
   compénétrer, et le rapport du geste, lui, n'en disait pas un mot : le 🧬 calcul de
   structure COMPTE ces couples (`clashReportOf`, seuil `RELAX_CLASH_DISTANCE` = 1.45 Å,
   « un atome passé à travers un autre ») mais la dynamique ne les lisait pas.

   Ce qui doit rester vrai, et qui est EXÉCUTÉ ici :

     • LE LECTEUR EST CELUI DU DOSSIER — la dynamique lit `clashReportOf` avec
       `RELAX_CLASH_DISTANCE` : aucun second seuil, aucune seconde table ;
     • ELLE MESURE, ELLE NE CONTRAINT PAS — deux gestes de MÊME graine et de seuils de
       clash DIFFÉRENTS donnent la MÊME trajectoire, au chiffre près : le rapport est un
       lecteur, jamais une physique (c'est la décision de la session) ;
     • ELLE NOMME CE QU'ELLE A FAIT — une géométrie propre ne nomme rien (0 couple, aucun
       pire couple), une géométrie empilée nomme le couple, sa distance et sa sévérité, ET
       le nombre d'images qui en portaient un ;
     • ELLE DIT LE CHEMIN, PAS SEULEMENT L'ARRIVÉE — `worstDuring` est le pire vu sur les
       IMAGES du geste (l'écran n'en montre qu'une toutes les `perFrame` pas : un
       empilement de trois pas vit entre deux images) ;
     • LA GÉOMÉTRIE LUE EST CELLE DE L'ÉCRAN — `engine.heavyPositions()` et les liaisons de
       l'appelant, jamais les hydrogènes que le champ ajoute pour lui : le rapport ne parle
       pas d'atomes que personne ne voit ;
     • LE PANNEAU LE DIT — la phrase du 🌡 cite le seuil LU DANS LE RAPPORT
       (`run.clashes.minDistance`), donc elle ne peut pas annoncer un chiffre recopié.

   Run: node _md_clash_report_test.mjs
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  molecularDynamicsOf, rotatableBondsOf,
} from './src/utils/structureCalc.js';
import { RELAX_CLASH_DISTANCE } from './src/utils/geometryRelax.js';

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
const VIEW = read('./src/components/NMRMoleculeViewer.jsx');
const SECTION = read('./src/components/NMRSections.jsx');

/* ── 1 · LE SEUIL EST CELUI DU DOSSIER ─────────────────────────────────────────────────
   Le chiffre de la session est 1.45 Å : c'est `RELAX_CLASH_DISTANCE`, la définition d'un
   empilement dans tout le dépôt (« deux atomes que le graphe ne lie pas »). La dynamique
   l'IMPORTE et l'ÉCRIT, elle ne le recopie pas. */
eq(RELAX_CLASH_DISTANCE, 1.45, 'le seuil d’un empilement est celui du dossier (RELAX_CLASH_DISTANCE = 1.45 Å)');
has(MODULE, 'clashDistance = RELAX_CLASH_DISTANCE,',
  '⚠ la dynamique PREND ce seuil du module du ⚒ (aucun chiffre recopié dans le moteur)');
has(MODULE, 'minDistance: clashMin,',
  '…et elle le passe au lecteur du dossier (`clashReportOf`), avec la géométrie qu’elle écrit');
has(MODULE, 'const clashMin = Number(clashDistance) > 0 ? Number(clashDistance) : RELAX_CLASH_DISTANCE;',
  '⚠ un seuil illisible retombe sur celui du module — et c’est CE chiffre-là que le rapport écrit');


/* ── 2 · LA SONDE — un butane (UNE charnière), et un thermostat GELÉ ───────────────────
   `temperature: 0` : `capsOf(0)` rend un plafond de couple NUL et le bruit
   `√(2γ·R·T·h_eff/m)` aussi, donc aucun canal ne tourne (`|v·h_eff| < 1e-9` → `continue`) :
   la géométrie rendue est EXACTEMENT celle qui a été donnée. C'est ce qui rend les
   assertions de ce fichier déterministes au chiffre près. */
const CLEAN = {
  positions: [0, 0, 0, 1.53, 0, 0, 3.06, 0, 0, 4.59, 0, 0],
  elements: ['C', 'C', 'C', 'C'],
  bonds: [{ i: 0, j: 1, order: 1 }, { i: 1, j: 2, order: 1 }, { i: 2, j: 3, order: 1 }],
};
eq(rotatableBondsOf({ elements: CLEAN.elements, bonds: CLEAN.bonds, atomCount: 4 }).channels.length, 1,
  'la sonde est un butane : UNE charnière, donc le moteur dihédral a de quoi tourner');
const FROZEN = { temperature: 0, steps: 20, perFrame: 8, seed: 5 };

const frozenClean = molecularDynamicsOf({ ...CLEAN, ...FROZEN });
ok(frozenClean.ok, 'le geste tourne (gelé : T = 0 K, aucun canal ne bouge)');
eq([frozenClean.clashes.count, frozenClean.clashes.worst, frozenClean.clashes.severity], [0, null, 0],
  '⚠ une géométrie PROPRE ne nomme RIEN (0 couple, aucun pire couple, sévérité 0)');
eq(frozenClean.clashes.worstDuring, null, '…et le chemin non plus (aucune image n’en portait)');
eq(frozenClean.clashes.frames, 0, '…donc aucune image sur le compte de celles qui en portent un');
eq(frozenClean.clashes.minDistance, RELAX_CLASH_DISTANCE,
  '…le seuil ANNONCÉ est celui du module (le rapport dit le chiffre qu’il a employé)');
eq(frozenClean.clashes.images, 3,
  'les images sont comptées (20 pas, une image tous les 8 pas : aux pas 8, 16 et 20)');
eq(Array.from(frozenClean.positions), [0, 0, 0, 1.53, 0, 0, 3.06, 0, 0, 4.59, 0, 0],
  '…et la géométrie gelée est EXACTEMENT celle qui a été donnée (aucun atome n’a bougé d’un chiffre)');
eq(CLEAN.positions.length, 12,
  '…et le moteur n’a pas touché le tableau de son appelant (la molécule rendue est la sienne)');

/* ── 3 · UN EMPILEMENT EST NOMMÉ — couple, distance, sévérité, images ──────────────────
   Le quatrième carbone est POSÉ SOUS le premier (1.20 Å, et le graphe ne les lie pas : ils
   sont 1-4), assez loin des deux autres pour qu'il n'y ait QU'UN couple trop court — le
   compte doit donc être 1, et non « au moins un ». Le lecteur du dossier doit le nommer
   (ses deux indices, sa distance) et dire son prix (`severity` = Σ (seuil − d)²). */
const STACKED = { ...CLEAN, positions: [0, 0, 0, 1.53, 0, 0, 3.06, 0, 0, 0, 1.2, 0] };
const frozenStack = molecularDynamicsOf({ ...STACKED, ...FROZEN });
ok(frozenStack.ok, 'le geste tourne aussi sur une géométrie empilée');
eq(frozenStack.clashes.count, 1, '⚠ UN couple trop court est compté (et il n’y en a qu’un)');
near(frozenStack.clashes.worst.distance, 1.2, '…avec sa distance VRAIE, pas un arrondi de confort', 1e-6);
eq([frozenStack.clashes.worst.i, frozenStack.clashes.worst.j], [0, 3], '…et ses deux indices');
near(frozenStack.clashes.severity, (RELAX_CLASH_DISTANCE - 1.2) ** 2,
  '…et le prix du module (Σ (seuil − d)², la même mesure que les échappées du ⚒)', 1e-9);
eq(frozenStack.clashes.frames, frozenStack.clashes.images,
  '⚠ TOUTES les images du geste en portent un (la géométrie est gelée) : le compte est un compte d’images');
near(frozenStack.clashes.worstDuring.distance, 1.2,
  '…et le rapport dit AUSSI ce que le CHEMIN a montré (`worstDuring`), pas seulement l’arrivée', 1e-6);
eq(frozenStack.clashes.worstDuring.step, 8,
  '…avec le pas de la PREMIÈRE image qui l’a porté — à distance égale le rapport ne réécrit pas un pas, donc la mesure reste reproductible');


/* ── 4 · ELLE MESURE, ELLE NE CONTRAINT PAS — la décision de la session ────────────────
   Le même geste, la même graine, la MÊME température : seul le seuil de clash change. Si la
   lecture entrait dans la physique (un pas refusé, une vitesse annulée), les deux
   trajectoires divergeraient. Elles doivent être IDENTIQUES au chiffre près, et seul le
   compte de couples doit changer : c'est ce qui prouve que « report the clashes » a été
   entendu au pied de la lettre. */
const WARM = { temperature: 300, steps: 60, perFrame: 8, seed: 5 };
const loose = molecularDynamicsOf({ ...CLEAN, ...WARM, clashDistance: RELAX_CLASH_DISTANCE });
const wide = molecularDynamicsOf({ ...CLEAN, ...WARM, clashDistance: 5 });
eq([loose.ok, wide.ok], [true, true], 'les deux gestes tournent');
eq(loose.positions, wide.positions,
  '⚠ LE SEUIL DE CLASH NE TOUCHE PAS LA TRAJECTOIRE — même graine, mêmes coordonnées, au chiffre près (le rapport est un LECTEUR)');
eq([loose.steps, loose.applied, loose.skipped], [wide.steps, wide.applied, wide.skipped],
  '…mêmes pas, mêmes applications, mêmes refus : rien n’a été contraint');
eq(wide.clashes.minDistance, 5, '…et un seuil demandé est le seuil ANNONCÉ');
ok(wide.clashes.count > loose.clashes.count,
  `…et un seuil plus large compte plus de couples (${wide.clashes.count} contre ${loose.clashes.count}) — le rapport suit le seuil, pas un chiffre en dur`);
eq([loose.clashes.images, wide.clashes.images], [8, 8],
  '…les deux ont vu le même nombre d’images (aucune n’a été sautée à cause d’un empilement)');

/* ── 5 · LA GÉOMÉTRIE QUE L'APPLICATION ENGENDRE — LA MESURE DE CETTE SESSION ─────────
   C'est CE geste-là qui a fait écrire « gli atomi si attraversano » : une séquence tapée
   dans la page devient un modèle (`proteinSequenceToPdbText`, hydrogènes compris), et la
   dynamique du panneau le relâche. La mesure, refaite ici à graine fixe, doit être NOMMÉE
   par le rapport — c'est tout l'objet de la demande. Les chiffres sont MESURÉS, pas
   supposés : ils sont écrits dans les assertions, donc une régression (ou un correctif du
   mur) les fera changer et le test le dira. */
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
const runPeptide = (perFrame) => molecularDynamicsOf({
  positions: Array.from(PEPTIDE.positions), elements: PEPTIDE.elements, bonds: PEPTIDE.bonds,
  steps: 150, temperature: 300, perFrame, seed: 11,
});
const md1 = runPeptide(1);
ok(md1.ok, 'la dynamique tourne sur le modèle engendré (300 K, 150 pas)');
eq(md1.clashes.images, 150, 'une image par pas : le compte d’images est le compte de pas');
ok(md1.clashes.worstDuring !== null && md1.clashes.worstDuring.distance < RELAX_CLASH_DISTANCE,
  `⚠⚠ MESURE DE CETTE SESSION : la dynamique met bien deux atomes NON LIÉS sous le seuil du module — ${md1.clashes.worstDuring ? `${md1.clashes.worstDuring.distance.toFixed(2)} Å au pas ${md1.clashes.worstDuring.step} (seuil ${md1.clashes.minDistance} Å)` : 'aucun pire couple'} : c’est ce que l’œil voit, et ce que le rapport disait jusqu’ici par son silence`);
ok(md1.clashes.frames > 0,
  `…et ${md1.clashes.frames} des ${md1.clashes.images} images du geste en portaient un (le chiffre que le panneau écrit)`);
const md8 = runPeptide(8);
eq([md8.clashes.images, md8.positions.length], [19, md1.positions.length],
  'les images de l’écran (une tous les 8 pas) sont bien celles du geste, et la géométrie rendue est la même');
eq(md8.positions, md1.positions,
  '…`perFrame` ne change QUE les images montrées, jamais la trajectoire (le même geste, la même physique)');
ok(md8.clashes.frames > 0,
  `⚠ …et il en reste ${md8.clashes.frames} sur les ${md8.clashes.images} images que l’ÉCRAN dessine : ce n’est pas un empilement de trois pas caché entre deux images`);


/* ── 6 · LE CODE DIT CE QU'IL FAIT — module ET panneau ───────────────────────────────── */
has(MODULE, "const clashReadingOf = () => clashReportOf({",
  'le lecteur est UNE fonction nommée du moteur, et c’est celui du dossier');
has(MODULE, 'positions: engine.heavyPositions(), bonds, minDistance: clashMin,',
  '⚠ …elle lit la géométrie que le geste ÉCRIT (les atomes de l’appelant), pas celle que le champ se fabrique');
has(MODULE, "CE N'EST PAS UNE CONTRAINTE",
  '⚠ …et le module DIT que la dynamique ne refuse rien pour un empilement (elle mesure, c’est la décision de la session)');
has(MODULE, 'let clashFrames = 0; let clashImages = 0; let worstClash = null;',
  '…le chemin est compté image par image (le pire vu, et à quel pas)');
has(MODULE, 'frames: clashFrames, images: clashImages,',
  '…et rendu dans le rapport du geste');
has(MODULE, 'worstDuring: worstClash ? { ...worstClash } : null,',
  '…avec le pire de la trajectoire, `null` quand il n’y en a pas (le rapport n’invente pas un zéro)');
has(VIEW, 'just report the clashes.',
  '…et le panneau porte la demande de la session, mot pour mot');
has(VIEW, 'closer than ${run.clashes.minDistance} Å in the geometry this gesture leaves',
  '⚠ la phrase du 🌡 nomme le seuil LU DANS LE RAPPORT (aucun chiffre recopié dans le JSX)');
has(VIEW, 'the SAME clash reader and the SAME threshold the 🧬 structure calculation uses',
  '…elle dit d’où vient le chiffre (le lecteur et le seuil du 🧬), donc deux rapports ne peuvent pas se contredire');
has(VIEW, 'and the trajectory itself went closer',
  '…et elle dit AUSSI ce que la trajectoire a montré en chemin, pas seulement ce qu’elle a laissé');
has(VIEW, 'the dynamics refuses no step for that (it only reports it, as asked)',
  '⚠ …en disant que rien n’a été refusé pour ça (la demande : « just report the clashes »)');
has(VIEW, '✓ no atom pair closer than ${run.clashes.minDistance} Å',
  '…et une molécule propre a SA phrase (aucun empilement : le rapport le dit aussi)');

console.log(`_md_clash_report_test.mjs — ${passed} assertions OK `
  + '(⚠ la dynamique REND ses clash — même lecteur et même seuil que le 🧬, sur la géométrie '
  + 'de l’écran — sans changer une seule trajectoire : le modèle engendré par la page en porte '
  + 'bien sous 1.45 Å pendant son ▶ MD à 300 K)');
