/* =========================================================================
   _residue_numbering_panels_test.mjs — LE NUMÉRO D'UN RÉSIDU, PARTOUT.

   Ce qui doit rester vrai :

     • la renumérotation du viewer 3D (🔢) n'atteint plus UNE partie de l'écran :
       la bande de séquence de la sous-section « Sequence and structure »
       (NMR, MD — protéine ET acide nucléique — et Docking) et les étiquettes Cys
       / les ponts disulfure de la page NMR portent désormais le MÊME numéro que
       les étiquettes 3D, la bande de résidus et la table des déplacements ;
     • la règle est UNE : `src/utils/residueNumbering.js` (module pur) —
       numéro d'origine = position 1-based dans la séquence + `residueOffset` de
       la condition, remplacé par l'entrée de `resRenumber` quand elle existe ;
     • une entrée vide ('') ou illisible rend le numéro d'origine ; 0 est un
       numéro VALIDE ; ni `null` ni un décalage illisible ne font planter ;
     • les ÉTATS et les PAIRES restent indexés par POSITION DE SÉQUENCE : une
       renumérotation ne réécrit ni un état redox ni une définition de pont
       disulfure (le modèle redox, les déplacements simulés et les barres de
       plages lisent des positions) ;
     • la bande de séquence n'existe qu'en UN exemplaire (NMRData.jsx) : la copie
       privée de NMRSections.jsx est supprimée, un correctif ne peut plus
       n'atteindre qu'une page sur trois ;
     • les deux côtés parlent de la même CLÉ : le viewer indexe `resRenumber` par
       le numéro de la STRUCTURE (`r.resno`), et la page retrouve ce numéro par
       « position + residueOffset » — la formule du module pur.

   La règle est RÉELLEMENT exécutée (import direct du module — il est pur). Les
   pages sont des .jsx : leurs sites de rendu sont vérifiés sur le TEXTE, comme
   _viewer_report_fixes_test.mjs.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  originalResidueNumber, renumberMapOf, residueNumberOf, residueNumberResolver, residueOffsetOf
} from './src/utils/residueNumbering.js';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const DATA = read('src/components/NMRData.jsx');
const SEC = read('src/components/NMRSections.jsx');
const MD = read('src/components/MDSections.jsx');
const DOCK = read('src/components/DockingSections.jsx');
const VIEW = read('src/components/NMRMoleculeViewer.jsx');

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};
const has = (src, needle, what) => {
  assert.ok(src.includes(needle), `${what}\n  cherche : ${needle}`);
  passed += 1;
};
const gone = (src, needle, what) => {
  assert.ok(!src.includes(needle), `${what}\n  encore présent : ${needle}`);
  passed += 1;
};
const count = (src, needle) => src.split(needle).length - 1;

/* ════════════ 1. LA RÈGLE, EXÉCUTÉE ════════════ */
eq(originalResidueNumber(0), 1, 'le premier résidu de la séquence est le 1 sans décalage');
eq(originalResidueNumber(4, 26), 31, 'la position + le décalage donnent le numéro de la STRUCTURE');
eq(originalResidueNumber(4, '26'), 31, 'un décalage texte compte comme un nombre');
eq(originalResidueNumber(4, 'x'), 5, 'un décalage illisible retombe sur zéro (aucun NaN à l’écran)');
eq(residueOffsetOf({}), 0, 'sans décalage : zéro');
eq(residueOffsetOf(null), 0, 'sans condition : zéro (la fonction ne lève jamais)');
eq(residueOffsetOf({ residueOffset: '26' }), 26, 'le décalage texte est lu');
eq(residueOffsetOf({ residueOffset: 'x' }), 0, 'le décalage illisible est ignoré');
eq(renumberMapOf({}), null, 'sans table 🔢 : aucune renumérotation');
eq(renumberMapOf({ resRenumber: null }), null, 'une table nulle vaut aucune renumérotation');
eq(renumberMapOf({ resRenumber: { 1: 7 } }), { 1: 7 }, 'la table 🔢 est rendue telle quelle');

eq(residueNumberOf({}, 0), 1, 'sans renumérotation : le numéro d’origine');
eq(residueNumberOf({}, 11), 12, '…la position du résidu dans la séquence');
eq(residueNumberOf({ residueOffset: 26 }, 0), 27, '…décalée quand la structure commence à 27');
eq(residueNumberOf(null, 4), 5, 'une condition absente ne fait pas planter le rendu');
eq(residueNumberOf({ resRenumber: { 3: 12 } }, 2), 12, 'la table 🔢 remplace le numéro du résidu visé');
eq(residueNumberOf({ resRenumber: { 3: 12 } }, 3), 4, '…et SEULEMENT le résidu visé');
eq(residueNumberOf({ residueOffset: 26, resRenumber: { 27: 1 } }, 0), 1,
  '« Renumber from 1 » : la CLÉ est le numéro de la structure (position + décalage)');
eq(residueNumberOf({ resRenumber: { 1: '' } }, 0), 1, 'une case vidée dans 🔢 rend le numéro d’origine');
eq(residueNumberOf({ resRenumber: { 1: 'abc' } }, 0), 1, 'une saisie illisible aussi (pas de NaN)');
eq(residueNumberOf({ resRenumber: { 1: '5' } }, 0), 5, 'une saisie texte numérique compte');
eq(residueNumberOf({ resRenumber: { 1: 0 } }, 0), 0, '0 est un numéro VALIDE (renumérotation depuis zéro)');

/* Le résolveur des composants rend EXACTEMENT le même numéro que la fonction
   d'un seul index — une bande de séquence, une table et un panneau Cys ne
   peuvent pas diverger. */
const cases = [
  { test: {}, n: 6 },
  { test: { residueOffset: 26 }, n: 6 },
  { test: { resRenumber: { 2: 9, 4: '' } }, n: 6 },
  { test: { residueOffset: 100, resRenumber: { 101: 1, 102: 2, 103: 0 } }, n: 6 },
  { test: null, n: 3 }
];
cases.forEach(({ test, n }, ci) => {
  const resolve = residueNumberResolver(test);
  const seen = Array.from({ length: n }, (_, i) => resolve(i));
  eq(seen, Array.from({ length: n }, (_, i) => residueNumberOf(test, i)),
    `cas ${ci + 1} : le résolveur et la fonction d’un index s’accordent sur toute la séquence`);
  ok(seen.every((v) => Number.isFinite(v)), `cas ${ci + 1} : aucun numéro non numérique à l’écran`);
});

/* ════════════ 2. LA BANDE DE SÉQUENCE PORTE LE NUMÉRO AFFICHÉ ════════════ */
has(DATA, 'export const SequencePaintStrip = ({ residues, getLetter, meta, onApply, focusIdx, charLabel, residueNo, linkOf }) => {',
  'la bande de séquence accepte le numéro affiché (et, avec les ponts disulfure, les résidus appariés)');
has(DATA, 'const numberAt = typeof residueNo === \'function\' ? residueNo : (i) => i + 1;',
  '…et retombe sur le rang dans la séquence quand aucune page ne le fournit');
has(DATA, '<div className="text-[8px] text-slate-500 font-bold">{resNo}</div>',
  'la pastille écrit LE numéro du résidu (et non son rang)');
has(DATA, 'const resNo = numberAt(i);', '…calculé une fois par pastille');
has(DATA, 'title={`${r.name || r.char} ${resNo}: ${m.label}${link ? ` · ⚭ disulphide with ${link.partner}` : \'\'}`}',
  'l’infobulle donne le même numéro que la pastille (plus de « Ala1 » qui contredit « 12 »)');
gone(DATA, '<div className="text-[8px] text-slate-500 font-bold">{i + 1}</div>',
  'l’ancien rang de séquence n’est plus écrit sous la lettre');
eq(count(DATA, 'const SequencePaintStrip = ('), 1, 'la bande de séquence n’a qu’une définition');
eq(count(SEC, 'const SequencePaintStrip = ('), 0,
  'la copie privée de NMRSections.jsx est supprimée (un correctif atteint les trois pages)');
has(SEC, 'SequencePaintStrip\n} from \'./NMRData\';', 'la page NMR importe la bande partagée');

/* La règle INTERNE de la bande, extraite du source et RÉELLEMENT exécutée :
   la pastille écrit `numberAt(i)`, donc les numéros que la page lui donne. */
const numberAtLine = DATA.split('\n').find((l) => l.includes('const numberAt = typeof residueNo ==='));
ok(!!numberAtLine, 'la bande calcule le numéro d’une pastille par un seul `numberAt`');
const makeNumberAt = (residueNo) => new Function('residueNo',
  `const numberAt = ${numberAtLine.split('const numberAt = ')[1].replace(/;$/, '')}; return numberAt;`)(residueNo);
eq([0, 1, 2, 3].map(makeNumberAt(residueNumberResolver({ resRenumber: { 3: 77 } }))), [1, 2, 77, 4],
  'les pastilles suivent le résolveur de la page (le résidu renuméroté porte SON numéro)');
eq([0, 1, 2].map(makeNumberAt(residueNumberResolver({ residueOffset: 26 }))), [27, 28, 29],
  '…et le décalage de la structure');
eq([0, 1, 2].map(makeNumberAt(undefined)), [1, 2, 3],
  'sans résolveur, la bande retombe sur le rang dans la séquence (comportement historique)');

/* ════════════ 3. LES QUATRE SOUS-SECTIONS « SEQUENCE AND STRUCTURE » ════════════ */
const PAGES = DOCK + MD + SEC;
eq(count(PAGES, '<SequencePaintStrip'), 4,
  'quatre bandes de séquence : Docking + MD (protéine, acide nucléique) + NMR');
eq(count(PAGES, 'residueNo={residueNoOf}'), 4, '…et les quatre reçoivent le résolveur de la page');

has(DOCK, 'import { residueNumberResolver } from \'../utils/residueNumbering\';',
  'la page Docking lit la règle partagée');
has(DOCK, 'const residueNoOf = residueNumberResolver(activeTest);',
  '…et se construit le résolveur de la condition');
eq(count(DOCK, 'residueNo={residueNoOf}'), 1, 'la bande du Docking l’utilise');

has(MD, 'import { residueNumberResolver } from \'../utils/residueNumbering\';',
  'la page MD lit la règle partagée');
has(MD, 'const residueNoOf = residueNumberResolver(activeTest);', '…et se construit le résolveur');
eq(count(MD, 'residueNo={residueNoOf}'), 2,
  'les deux bandes MD (peinture secondaire ET formes A/B/Z) l’utilisent');
eq(count(MD, 'title="Sequence and structure"'), 2,
  '…ce sont bien les deux sous-sections « Sequence and structure »');

has(SEC, 'import { residueNumberResolver, residueNumberOf } from \'../utils/residueNumbering\';',
  'la page NMR lit la règle partagée');
has(SEC, 'const residueNoOf = residueNumberResolver(activeTest);', '…et se construit le résolveur');
has(SEC, '<SequencePaintStrip residues={d.parsedSeq} getLetter={(i) => d.getSSAt(i)} meta={SS_META} onApply={(i) => paintSSAt(i, ssBrush)} focusIdx={focusIdx} residueNo={residueNoOf}',
  'la bande NMR de « Sequence and structure » l’utilise (et lui passe les ponts disulfure par linkOf)');

/* ════════════ 4. LA TABLE DES DÉPLACEMENTS LIT LA MÊME RÈGLE ════════════ */
has(SEC, 'const displayNo = residueNumberOf(activeTest, idx);',
  'la table des déplacements passe par le module partagé');
gone(SEC, 'const origNo = idx + 1 + (activeTest.residueOffset || 0);',
  '…et ne recalcule plus la règle à sa façon');

/* ════════════ 5. CYSTÉINES : LE NUMÉRO SUIT LE VIEWER, LA DÉFINITION NON ════════════ */
has(SEC, 'const resNoOf = residueNumberResolver(activeTest);',
  'le panneau Cys se construit le résolveur de numéros');
has(SEC, 'const noOf = (pos) => resNoOf(pos - 1);',
  'la position 1-based de séquence est traduite en index de résidu');
has(SEC, '<span className="font-bold text-slate-700 w-14 pl-1">Cys #{noOf(pos)}</span>',
  'l’étiquette d’une cystéine porte le numéro de la structure renumérotée');
has(SEC, '{pairTargets.map((p2) => <option key={p2} value={p2}>Cys #{noOf(p2)}</option>)}',
  '« ⚭ couple with » propose les numéros affichés — la VALEUR stockée reste la position');
has(SEC, '<span>Cys #{noOf(pair[0])}</span>',
  'la définition du pont disulfure s’écrit avec les numéros affichés (premier Cys)');
has(SEC, '<span>Cys #{noOf(pair[1])}</span>',
  '…et le second — le DESSIN S–S vit entre les deux (DisulfideBondGlyph)');
has(SEC, 'if (p2) addPair(pos, p2);',
  '…mais la paire enregistrée reste en POSITIONS de séquence (le modèle redox les lit)');
has(SEC, 'cysDisulfides: [...remaining, [a, b]]', 'aucune écriture de paire n’a été convertie en numéros affichés');
has(SEC, 'pairs.some(([a, b]) => a === pos || b === pos)',
  'l’état redox est résolu sur la position, pas sur le numéro affiché');
has(SEC, '🔢 numbers follow the 3D viewer',
  'le panneau DIT que ses numéros sont ceux du viewer (l’utilisateur ne peut pas se tromper de résidu)');

/* La conversion position ↔ index du panneau Cys, extraite et EXÉCUTÉE : une
   position 1-based de séquence doit devenir l’index 0-based du résolveur (une
   erreur d’un cran afficherait le numéro du résidu voisin). */
const noOfLine = SEC.split('\n').find((l) => l.includes('const noOf = (pos) => resNoOf(pos - 1);'));
ok(!!noOfLine, 'le panneau Cys traduit la position par un seul `noOf`');
const makeNoOf = (resNoOf) => new Function('resNoOf', 'const noOf = (pos) => resNoOf(pos - 1); return noOf;')(resNoOf);
eq([1, 5, 30].map(makeNoOf(residueNumberResolver({}))), [1, 5, 30],
  'sans décalage ni renumérotation, la position 1-based est déjà le numéro (aucun cran d’écart)');
eq([1, 5, 30].map(makeNoOf(residueNumberResolver({ resRenumber: { 5: 105 } }))), [1, 105, 30],
  'la 5ᵉ cystéine de la séquence prend le numéro que le viewer lui a donné');
eq(makeNoOf(residueNumberResolver({ residueOffset: 26 }))(1), 27,
  'le décalage de la structure est appliqué à la position de séquence');

/* ════════════ 6. LES DEUX CÔTÉS PARLENT DE LA MÊME CLÉ ════════════ */
has(VIEW, 'const displayResno = (resno) => {\n  const v = renumberMap[String(resno)];',
  'le viewer lit sa table 🔢 par le numéro du résidu');
has(VIEW, 'list.forEach((r, i) => { next[String(r.resno)] = start + i; });',
  '« Renumber from » la remplit avec les numéros de la STRUCTURE');
has(VIEW, '{r.resname}{r.resno} → {displayResno(r.resno)}', 'le panneau 🔢 montre résidu → nouveau numéro');
has(VIEW, '<span className="text-[6px] font-bold text-slate-400 leading-none">{displayResno(r.resno)}</span>',
  'la bande de résidus du viewer affiche le numéro renuméroté');
has(SEC, 'const residueOffset = activeTest.residueOffset || 0;',
  'la page traduit la position de séquence en numéro de structure par ce décalage');

console.log(`_residue_numbering_panels_test.mjs — ${passed} assertions OK`);
