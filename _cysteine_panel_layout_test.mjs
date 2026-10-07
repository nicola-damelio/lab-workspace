/* =========================================================================
   _cysteine_panel_layout_test.mjs — « CYSTEINE STATES » À CÔTÉ DE LA CASE DE
   SÉQUENCE, ET PAS PLUS LARGE QU'UN QUART DE LA PAGE.

   Demandé mot pour mot : « Move teh "cysteine state" panel next to the
   "Protein Sequence (1-letter code)" panel. Its width shuld not be larger
   that 1/4 teh page width. »

   Ce qui doit rester vrai :
     • la case « <Protein|DNA|RNA> Sequence (1-letter code) » et le panneau
       « Cysteine states » sont les deux COLONNES de la même rangée : la case
       ouvre la rangée (`flex flex-col md:flex-row`, `flex-1`) et le panneau la
       ferme — un FRÈRE de la case, pas dedans, pas plus bas dans la page ;
     • le panneau porte LUI-MÊME sa largeur : un quart de la page au plus
       (`md:w-1/4` + `md:max-w-[25%]`, `shrink-0`, `min-w-0`), le contenu se
       replie au lieu de pousser la colonne, et plus de `mt-2` de superposition
       (l'espacement est celui de la rangée) ;
     • **la largeur est RÉELLEMENT EXÉCUTÉE** : les jetons de la classe sont lus
       dans la source, la fraction et le plafond en sont tirés, et la largeur
       des deux colonnes est calculée pour des pages de 768 à 2560 px — jamais
       plus d'un quart pour le panneau, jamais moins de trois quarts pour la
       case de séquence ;
     • **aucune colonne vide** : le panneau n'existe que s'il y a une cystéine
       et seulement pour une PROTÉINE — la règle qui repère les Cys est extraite
       de la source et EXÉCUTÉE, et c'est le NŒUD RENDU qui porte la largeur,
       donc un `null` (DNA / RNA, ou protéine sans Cys) ne laisse ni colonne
       vide ni « gap » et la case reprend toute la rangée ;
     • rien d'autre de la page ne bouge : le SMILES, les sucres, les
       phospholipides, la longueur, la note de nature, l'avertissement
       « sequence is empty » et tout le panneau (défauts Reduced / Oxidized,
       états −SH / S−S / auto, ponts ⚭ et leurs couleurs, numérotation 🔢).

   Les pages sont du JSX : la mise en page est vérifiée sur le TEXTE de
   src/components/NMRSections.jsx, comme _nmr_nuclei_table_test.mjs, et la
   seule règle calculable du lot — la largeur — est extraite et exécutée.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const SEC = read('src/components/NMRSections.jsx');

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
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
const at = (src, needle, what) => {
  const i = src.indexOf(needle);
  assert.ok(i >= 0, `${what}\n  introuvable : ${needle}`);
  passed += 1;
  return i;
};

/* ════════════ 1. LA BRANCHE POLYMÈRE, DÉCOUPÉE ═══════════════════════════ */
const polyStart = at(SEC, ') : d.isPolymer ? (', 'la branche polymère (protéine / DNA / RNA) est là');
const polyEnd = at(SEC, ") : d.moleculeType === 'sugar' ? (", 'la branche sucre la suit (fin de la découpe)');
ok(polyEnd > polyStart, 'la découpe de la branche polymère est ordonnée');
const POLY = SEC.slice(polyStart, polyEnd);

/* ════════════ 2. UNE RANGÉE, DEUX COLONNES FRÈRES ════════════════════════ */
const row = at(POLY, '<div className="flex flex-col md:flex-row gap-6 items-start w-full">',
  'la case de séquence et le panneau sont dans UNE rangée (empilés en dessous de md)');
const left = at(POLY, '<div className="flex-1 w-full min-w-0">',
  'la case de séquence est la colonne qui prend la place restante');
const seq = at(POLY, '<textarea value={d.rawSequence}',
  '…elle contient la case « <Protein|DNA|RNA> Sequence (1-letter code) »');
ok(seq > left && left > row, 'la case est DANS la première colonne de la rangée');
/* La jonction exacte : la première colonne se referme, le panneau s'ouvre. */
const joint = at(POLY, "                )}\n              </div>\n              {d.moleculeType === 'protein' && (() => {",
  'la colonne de la case se referme JUSTE AVANT le panneau');
ok(joint > seq, '…donc après la case : le panneau est un FRÈRE de la case, pas un enfant');
const panel = at(POLY, "{d.moleculeType === 'protein' && (() => {",
  'le panneau « Cysteine states » suit dans la MÊME rangée');
ok(panel > joint, '…après la fermeture de la case → À SA DROITE (flex-row)');
has(SEC, "            </div>\n          ) : d.moleculeType === 'sugar' ? (",
  'la rangée se referme à la fin de la branche polymère (les autres types ne bougent pas)');
gone(POLY, '\n            <>\n', 'plus de fragment « <> » : la rangée est le seul nœud de la branche');

/* ════════════ 3. LA LARGEUR : UN QUART DE LA PAGE AU PLUS, EXÉCUTÉ ═══════ */
eq(count(POLY, 'bg-amber-50 border border-amber-200 rounded-lg px-3 py-2'), 1,
  'un seul panneau ambre dans la branche (celui des cystéines)');
const clsMatch = POLY.match(/className="([^"]*bg-amber-50 border border-amber-200 rounded-lg px-3 py-2[^"]*)"/);
ok(clsMatch, 'la classe du panneau « Cysteine states » est lue dans la source');
const cls = clsMatch[1];
const tokens = cls.split(/\s+/);
eq(tokens.includes('w-full'), true, 'sous md (rangée empilée) le panneau prend la largeur disponible');
eq(tokens.includes('md:w-1/4'), true, 'à partir de md il fait UN QUART de la rangée (md:w-1/4)');
eq(tokens.includes('md:max-w-[25%]'), true, '…et il est PLAFONNÉ à 25 % (md:max-w-[25%])');
eq(tokens.includes('shrink-0'), true, '…la rangée ne peut pas l’élargir : il ne se rétracte pas (shrink-0)');
eq(tokens.includes('min-w-0'), true, '…c’est SON CONTENU qui se replie (min-w-0), pas la colonne qui s’élargit');
gone(cls, 'mt-2', 'plus de marge de superposition : l’espacement est celui de la rangée (gap-6)');
gone(SEC, 'className="mt-2 bg-amber-50 border border-amber-200', 'l’ancien panneau sous la case a bien disparu');
eq(count(SEC, 'md:max-w-[25%]'), 1, 'un seul élément de la page est plafonné au quart de la page');

/* La largeur, calculée à partir des jetons LUS dans la source : `md:w-1/4` est
   la fraction demandée, `md:max-w-[25%]` le plafond. La rangée est la largeur
   de la page utile, et md = 768 px, comme les autres `md:` de la page. */
const fractionOf = (t) => {
  const m = /^md:w-(\d+)\/(\d+)$/.exec(t);
  return m ? Number(m[1]) / Number(m[2]) : null;
};
const capOf = (t) => {
  const m = /^md:max-w-\[(\d+(?:\.\d+)?)%\]$/.exec(t);
  return m ? Number(m[1]) / 100 : null;
};
const wFraction = tokens.map(fractionOf).find((v) => v !== null);
const wCap = tokens.map(capOf).find((v) => v !== null);
eq(wFraction, 0.25, 'la fraction demandée au panneau est bien un quart');
eq(wCap, 0.25, 'le plafond demandé au panneau est bien un quart');
const pages = [768, 1024, 1280, 1440, 1920, 2560];
const layout = pages.map((page) => {
  const col = Math.min(page * wFraction, page * wCap);   // md:w-1/4, borné par md:max-w-[25%]
  return { page, col, left: page - col };
});
eq(layout.filter((r) => r.col > r.page / 4), [],
  'aucune largeur de page (768 → 2560 px) ne donne au panneau PLUS d’un quart');
eq(layout.map((r) => r.col / r.page), pages.map(() => 0.25),
  '…et il fait exactement un quart : la place demandée est prise, pas moins');
eq(layout.filter((r) => r.left < r.page * 0.75), [],
  'la case de séquence garde les trois quarts de la rangée (jamais moins)');

/* ════════════ 4. AUCUNE COLONNE VIDE (DNA / RNA, PROTÉINE SANS CYS) ══════ */
has(POLY, 'if (cysPositions.length === 0) return null;',
  'le panneau rend `null` quand la séquence n’a aucune cystéine');
has(POLY, 'return (\n                  <div className="w-full md:w-1/4',
  '…et c’est le NŒUD RENDU qui porte la largeur : un `null` ne laisse donc aucune colonne vide (ni « gap »)');
has(POLY, "d.moleculeType === 'protein' && (() => {",
  '…et il n’existe que pour une PROTÉINE : en DNA / RNA la case reprend toute la rangée');
const cysRule = SEC.match(/const cysPositions = d\.parsedSeq\n(?:[^\n]*\n)*?[^\n]*\.filter\(Boolean\);/);
ok(cysRule, 'la règle qui repère les cystéines est extraite de la source');
const cysPositionsOf = new Function('d', `${cysRule[0]}\n  return cysPositions;`);
eq(cysPositionsOf({ parsedSeq: [{ char: 'M' }, { char: 'C' }, { char: 'A' }, { char: 'C' }] }), [2, 4],
  'les cystéines sont repérées par leur POSITION de séquence (1-based)');
eq(cysPositionsOf({ parsedSeq: [{ char: 'M' }, { char: 'A' }, { char: 'G' }] }), [],
  'sans cystéine la liste est VIDE → le panneau rend `null` (aucune colonne, aucun « gap »)');
eq(cysPositionsOf({ parsedSeq: [] }), [],
  'séquence vide (DNA / RNA, ou pas encore saisie) : rien non plus');

/* ════════════ 5. RIEN D'AUTRE NE BOUGE ══════════════════════════════════ */
has(POLY, 'value={d.rawSequence}', 'la case affiche toujours la séquence de la nature courante');
has(POLY, 'Length: {d.seq.length}', 'le compte de résidus / nucléotides est toujours sous la case');
has(POLY, '⚠️ {Object.keys(d.shifts).length} chemical shift value(s) are stored',
  'l’avertissement « sequence is empty » reste sous la case');
has(POLY, 'type="radio" name="cysDefault"', 'les deux défauts (Reduced / Oxidized) restent dans le panneau');
has(POLY, '−SH', '…avec l’état réduit par cystéine');
has(POLY, 'S−S', '…et l’état oxydé');
has(POLY, 'updateActiveTest({ cysDisulfides: [...remaining, [a, b]] })',
  '…et la définition des ponts ⚭ (addPair / removePair) est intacte');
has(POLY, 'residueNumberResolver', '…toujours numérotés comme le viewer 3D (🔢)');
const seqSection = at(SEC, 'title="Sequence and structure"', 'la sous-section « Sequence and structure » suit toujours');
ok(polyStart < seqSection, 'le panneau reste dans le « Set Up », avant la formule 2D et le viewer');
has(SEC, 'SMILES String', 'le SMILES d’une molécule organique est intact');
has(SEC, 'Select Sugar', '…les sucres aussi');
has(SEC, 'Select Phospholipid', '…et les phospholipides');
has(SEC, '>Cysteine states</span>', 'le titre « Cysteine states » est inchangé');
eq(count(SEC, '>Cysteine states</span>'), 1, 'un seul panneau « Cysteine states » dans la page');

console.log(`_cysteine_panel_layout_test.mjs — ${passed} assertions OK (« Cysteine states » à côté de la case de séquence, un quart de la page au plus)`);
