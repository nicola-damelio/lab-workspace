/* =========================================================================
   _viewer_sequence_search_test.mjs — RECHERCHER « MHEF » DANS LA SÉQUENCE.

   La demande, mot pour mot : « nel viewer sarebbe utile dentro la barra analysis
   un modo per cercare pezzi di sequenza, ad esempio cerco la sequenza MHEF
   dentro la sequenza della proteina. se lanciato deve selezionare quella parte
   della proteina. »

   Vérifié ici :

     A. LA RÈGLE, pure (src/utils/sequenceSearch.js) : lecture des résidus d'une
        structure, casse et blancs ignorés, `X` = n'importe quel résidu, plusieurs
        chaînes sans jamais les traverser, correspondances sans recouvrement, les
        numéros rendus sont CEUX DU FICHIER, la limite qui dit sa troncature ;
     B. LE TEXTE DU COMPTE-RENDU : « rien trouvé » est une réponse, et les
        étiquettes sont des rangées (`12-15`), pas des listes de 40 numéros ;
     C. LE BRANCHEMENT dans le viewer : le champ ET le bouton vivent DANS le
        groupe 📏 Analysis, la surbrillance est UNE représentation à part (sa
        couleur, sa ref, retirée en relançant la recherche comme par ✕ Clear),
        la caméra cadre la première correspondance, et la recherche meurt avec
        la structure.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => ok(src.includes(needle), what);

register('./_esm_test_hook.mjs', import.meta.url);
const S = await import('./src/utils/sequenceSearch.js');

/* ── A. LA RÈGLE PURE ────────────────────────────────────────────────────── */

eq(S.normalizeSequenceQuery('  mh ef\n'), 'MHEF', 'la casse et les blancs ne comptent pas (une séquence se colle d’un article)');
eq(S.normalizeSequenceQuery('M-H_E.F*1'), 'MHEF', 'tout ce qui n’est pas une lettre est écarté');
eq(S.normalizeSequenceQuery(null), '', 'une requête absente n’est pas une requête');
eq(S.normalizeSequenceQuery(''), '', '…ni une requête vide');

/* Une structure telle que le viewer la lit (collectResidueTicks) : des résidus
   de polymère, et ce qui n’en fait PAS partie (l’eau, un ion, un lipide). */
const tick = (resno, code, { chainname = 'A', polymer = !!code, resname = '' } = {}) =>
  ({ resno, code, resname: resname || code, polymer, chainname, chainid: chainname, atomNames: ['CA', 'N'] });
const PEPTIDE = [
  tick(1, 'M'), tick(2, 'H'), tick(3, 'E'), tick(4, 'F'),
  tick(5, 'A'), tick(6, 'M'), tick(7, 'H'), tick(8, 'E'), tick(9, 'F'),
  tick(10, 'G'),
  tick(11, '', { resname: 'HOH', polymer: false }),          // une eau : jamais dans une séquence
  tick(12, '', { resname: 'UNK', polymer: false })           // un résidu non résolu
];
const RES = S.residuesOfTicks(PEPTIDE);
eq(RES.length, 10, 'seuls les résidus de polymère entrent dans la séquence (l’eau et l’inconnu sont dehors)');
eq(RES[0], { code: 'M', chain: 'A', resno: 1, ri: 0, tickIndex: 0 }, 'un résidu porte son code, sa chaîne et son numéro de fichier');

const found = S.findSequenceMatches(RES, 'MHEF');
eq(found.query, 'MHEF', 'la requête est normalisée');
eq(found.searched, 10, 'la recherche dit sur combien de résidus elle a porté');
eq(found.matches.length, 2, 'MHEF est trouvé deux fois');
eq(found.matches.map((m) => [m.indexStart, m.indexEnd]), [[0, 3], [5, 8]],
  'chaque correspondance dit ses INDICES (le viewer y retrouve ses résidus)');
eq(found.matches.map((m) => m.resnos), [[1, 2, 3, 4], [6, 7, 8, 9]],
  '…et les numéros du FICHIER, jamais une position 1…N');
eq(found.matches[0].riStart, 0, 'l’indice de résidu (ri = resno − 1) est là aussi : c’est la convention du programme');

eq(S.findSequenceMatches(RES, 'mhef').matches.length, 2, 'taper en minuscules trouve la même chose');
eq(S.findSequenceMatches(RES, 'M H E F').matches.length, 2, '…comme une séquence coupée par des blancs');
eq(S.findSequenceMatches(RES, 'MHXF').matches.length, 2,
  'X du motif = n’importe quel résidu (MHEF convient deux fois)');
eq(S.findSequenceMatches(RES, 'MHEG').matches.length, 0, '…mais il ne fait pas trouver ce qui n’est pas là');
eq(S.findSequenceMatches(RES, 'A'), S.findSequenceMatches(RES, 'a'),
  'une seule lettre cherche aussi (majuscule ou minuscule)');
eq(S.findSequenceMatches(RES, 'MHEFAAAA').matches.length, 0, 'un motif plus long que la chaîne ne trouve rien');
eq(S.findSequenceMatches(RES, 'ZZ').matches.length, 0, 'un motif absent rend une liste VIDE (jamais une correspondance approximative)');
eq(S.findSequenceMatches(RES, '').matches, [], 'sans requête, aucune correspondance');
eq(S.findSequenceMatches(RES, 'MHEFGAMHEF').searched, 10, '…mais la structure est quand même comptée');

/* Deux chaînes : un motif ne les traverse JAMAIS (ce sont deux séquences). */
const TWO = [tick(1, 'M'), tick(2, 'H'), tick(3, 'E'), tick(4, 'F'), tick(1, 'E', { chainname: 'B' }), tick(2, 'F', { chainname: 'B' })];
const cross = S.findSequenceMatches(S.residuesOfTicks(TWO), 'MHEF');
eq(cross.matches.length, 1, 'le motif est trouvé dans la chaîne A');
eq(cross.matches[0].chain, 'A', '…et il dit QUELLE chaîne');
eq(S.findSequenceMatches(S.residuesOfTicks(TWO), 'EF').matches.map((m) => m.chain), ['A', 'B'],
  'le même motif peut apparaître dans deux chaînes — une correspondance par chaîne');

/* Sans recouvrement : `AAAA` contient UNE fois `AAA` (le curseur reprend après). */
const FOUR = [tick(1, 'A'), tick(2, 'A'), tick(3, 'A'), tick(4, 'A')];
eq(S.findSequenceMatches(S.residuesOfTicks(FOUR), 'AAA').matches.map((m) => m.resnos), [[1, 2, 3]],
  'les correspondances ne se chevauchent pas');

/* La limite se DIT (une séquence courte répétée ne fige pas la fenêtre). */
const MANY = [];
for (let i = 1; i <= 40; i += 1) MANY.push(tick(i, 'M', { resname: 'MET' }));
const capped = S.findSequenceMatches(S.residuesOfTicks(MANY), 'M', { limit: 5 });
eq(capped.matches.length, 5, 'la limite est respectée');
eq(capped.truncated, true, '…et la troncature est AVOUÉE (le compte-rendu la dira)');
eq(S.findSequenceMatches(S.residuesOfTicks(MANY), 'M').truncated, false, 'sous la limite, rien n’est tronqué');
eq(S.SEQUENCE_SEARCH_LIMIT, 200, 'la limite par défaut est celle du module');

/* ── B. LE TEXTE DU COMPTE-RENDU ─────────────────────────────────────────── */

eq(S.resnoRangeText([1, 2, 3, 4]), '1-4', 'des numéros qui se suivent deviennent une RANGÉE');
eq(S.resnoRangeText([7]), '7', 'un résidu seul s’écrit sans tiret');
eq(S.resnoRangeText([12, 13, 15, 16, 20]), '12-13 · 15-16 · 20', 'une rangée par morceau continu');
eq(S.resnoRangeText([]), '', 'aucun numéro → aucun texte');

eq(S.matchLabel(found.matches[0]), 'A 1-4', 'l’étiquette dit la chaîne ET la rangée');
eq(S.matchLabel({ chain: '', resnos: [9] }), '9', 'sans nom de chaîne, il reste le numéro');
eq(S.matchLabel(null), '', 'sans correspondance, aucune étiquette');

has(S.matchesSummaryText(found), 'MHEF: 2 matches', 'le compte-rendu compte les correspondances');
has(S.matchesSummaryText(found), 'A 1-4 · A 6-9', '…et donne leurs places');
has(S.matchesSummaryText({ query: 'ZZZ', searched: 10, chains: ['A'], matches: [] }), 'no match in the 10 residue(s)',
  '« rien trouvé » est une réponse, pas un silence');
has(S.matchesSummaryText({ query: 'ZZZ', searched: 10, chains: ['A', 'B'], matches: [] }), 'chains A, B',
  '…et elle dit dans quelles chaînes on a cherché');
has(S.matchesSummaryText({ query: 'M', searched: 0, matches: [] }), 'Load a structure first',
  'sans résidu, on le dit au lieu de prétendre avoir cherché');
eq(S.matchesSummaryText({ query: '', searched: 0, matches: [] }), 'Type a sequence (one-letter code) to search.',
  'sans requête, on invite à en taper une');
const many = { query: 'M', searched: 40, chains: ['A'], matches: capped.matches, truncated: true, limit: 5 };
has(S.matchesSummaryText(many, { shown: 2 }), '+3 more', 'au-delà de l’affichage, le reste est compté…');
has(S.matchesSummaryText(many), 'stopped at 5', '…et la troncature se dit');

/* ── C. LE BRANCHEMENT DANS LE VIEWER ────────────────────────────────────── */

const VIEW = readFileSync('./src/components/NMRMoleculeViewer.jsx', 'utf8').replace(/\r\n/g, '\n');

has(VIEW, "import { findSequenceMatches, matchesSummaryText, normalizeSequenceQuery, residuesOfTicks } from '../utils/sequenceSearch';",
  'le viewer importe la règle pure (une seule définition de la recherche)');
has(VIEW, '🔎 Find', 'le bouton dit ce qu’il fait');
has(VIEW, 'placeholder="MHEF"', '…et le champ montre la demande telle qu’elle a été formulée');

/* Le champ et le bouton sont DANS le groupe 📏 Analysis : après l’en-tête du
   groupe, après 🟢 Assigned… et avant le groupe 🧪 PyMOL qui suit. */
const iAnalysis = VIEW.indexOf('>📏 Analysis</span>');
const iAssigned = VIEW.indexOf('onClick={() => setShowAssignedFlag(!showManualHighlight)}');
const iFind = VIEW.indexOf('🔎 Find');
const iInput = VIEW.indexOf('aria-label="Sequence fragment to find in this structure"');
const iPymol = VIEW.indexOf('>🧪 PyMOL</span>');
ok(iAnalysis > 0 && iAssigned > iAnalysis && iInput > iAssigned && iFind > iInput && iPymol > iFind,
  'le champ ET le 🔎 Find vivent dans 📏 Analysis, à la suite de 📏 Measure et 🟢 Assigned (avant 🧪 PyMOL)');
has(VIEW, 'onKeyDown={(e) => { if (e.key === \'Enter\') { e.preventDefault(); runSequenceSearch(); } }}',
  'Entrée lance la recherche (on ne quitte pas le clavier pour ça)');

/* Ce que fait le geste : les résidus de la structure CHARGÉE, une seule
   représentation à part, la caméra sur la première correspondance. */
has(VIEW, 'const residues = residuesOfTicks(ticks);',
  'la recherche lit les résidus de la structure chargée (la même liste que le bandeau de séquence)');
has(VIEW, 'const result = findSequenceMatches(residues, seqQuery);', '…par la règle pure');
has(VIEW, 'const clause = residueTickClause(tick);',
  'chaque résidu trouvé reçoit SA clause NGL (chaîne + numéro + nom, comme le bandeau)');
has(VIEW, "seqHighlightCompRef.current = component.addRepresentation(useSphere ? 'spacefill' : 'ball+stick', {",
  'la surbrillance est UNE représentation, dessinée sur les résidus trouvés');
has(VIEW, 'color: SEQUENCE_HIT_COLOR', '…dans SA couleur (ni l’ambre des sélections, ni le vert des assignés)');
has(VIEW, 'component.autoView(clauses[0])', '…et la caméra cadre la PREMIÈRE correspondance');
has(VIEW, 'const SEQUENCE_HIT_COLOR = 0x0ea5e9;', 'la couleur est nommée une fois');
has(VIEW, 'const useSphere = lightRenderRef.current || atoms > 1500;',
  'les gros motifs passent en sphères instanciées (pas de graphe de liaisons à recalculer)');

/* Ce qu’elle ne fait PAS : toucher à la molécule ou au réseau. */
ok(!/fetch\(|XMLHttpRequest|sendBeacon/.test(VIEW), 'la recherche n’ouvre aucun réseau (la promesse du film tient toujours)');

/* Le nettoyage : la recherche précédente s’éteint, ✕ Clear la retire, et la
   structure suivante l’emporte. */
ok((VIEW.match(/seqHighlightCompRef\.current = null;/g) || []).length >= 5,
  'la surbrillance est retirée à chaque fois qu’elle doit l’être (relance, ✕ Clear, chargement, vider)');
has(VIEW, 'onClick={clearSequenceSearch}', '✕ Clear retire la surbrillance');
has(VIEW, 'const clearSequenceSearch = useCallback(() => {', '…par une fonction unique');
has(VIEW, '{matchesSummaryText(seqResult)}', 'le compte-rendu affiché vient du module pur (le viewer ne fabrique aucune phrase)');
has(VIEW, 'disabled={status !== \'ready\' || !normalizeSequenceQuery(seqQuery)}',
  'Find est inerte sans structure chargée ou sans requête (jamais un bouton mort)');

console.log(`\n${passed} vérifications passées — recherche de séquence : la règle est pure, la surbrillance est à part.\n`);
