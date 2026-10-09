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
        groupe 📏 Analysis, et le geste SÉLECTIONNE les résidus trouvés — les
        mêmes clés qu'un clic sur le bandeau de séquence (« as if the residues
        were clicked onto the sequence inside the viewer »), sans qu'une même
        sélection soit renvoyée à la page (elle la lirait comme un dé-clic) ;
        la surbrillance sky n'est que le REPLI quand la page ne porte pas de
        sélection, la caméra cadre la première correspondance, et la recherche
        meurt avec la structure.
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
   groupe, après 🟢 Assigned… et avant le groupe 🧪 PyMOL qui suit.
   ⚠ L’aiguille du bouton est « 🔎 Find » SUIVI de sa fermeture : le texte du
   geste apparaît aussi dans le titre du champ (et dans les commentaires du
   geste), une simple recherche de texte désignerait donc autre chose que lui. */
const iAnalysis = VIEW.indexOf('>📏 Analysis</span>');
const iAssigned = VIEW.indexOf('onClick={() => setShowAssignedFlag(!showManualHighlight)}');
const iFind = VIEW.indexOf('🔎 Find\n</button>');
const iInput = VIEW.indexOf('aria-label="Sequence fragment to find in this structure"');
const iPymol = VIEW.indexOf('>🧪 PyMOL</span>');
ok(iAnalysis > 0 && iAssigned > iAnalysis && iInput > iAssigned && iFind > iInput && iPymol > iFind,
  'le champ ET le 🔎 Find vivent dans 📏 Analysis, à la suite de 📏 Measure et 🟢 Assigned (avant 🧪 PyMOL)');
has(VIEW, 'onKeyDown={(e) => { if (e.key === \'Enter\') { e.preventDefault(); runSequenceSearch(); } }}',
  'Entrée lance la recherche (on ne quitte pas le clavier pour ça)');

/* Ce que fait le geste : les résidus de la structure CHARGÉE, la SÉLECTION
   partagée du programme, la caméra sur la première correspondance. */
has(VIEW, 'const residues = residuesOfTicks(ticks);',
  'la recherche lit les résidus de la structure chargée (la même liste que le bandeau de séquence)');
has(VIEW, 'const result = findSequenceMatches(residues, seqQuery);', '…par la règle pure');
has(VIEW, 'const clause = residueTickClause(tick);',
  'chaque résidu trouvé reçoit SA clause NGL (chaîne + numéro + nom, comme le bandeau)');
has(VIEW, 'component.autoView(clauses[0])', '…et la caméra cadre la PREMIÈRE correspondance');
has(VIEW, 'const SEQUENCE_HIT_COLOR = 0x0ea5e9;', 'la couleur de repli est nommée une fois');
has(VIEW, 'const useSphere = lightRenderRef.current || atoms > 1500;',
  'les gros motifs passent en sphères instanciées (pas de graphe de liaisons à recalculer)');

/* ══ LE GESTE SÉLECTIONNE (la demande de cette session) ═════════════════════
   « The MHEF button should select, not only show the sequence, as if the
   residues were clicked onto the sequence inside the viewer. » */
has(VIEW, 'const keys = keysOfTicks(hitTicks);',
  'les résidus trouvés reçoivent les MÊMES clés qu’un clic sur le bandeau (computeResidueKeys, via keysOfTicks)');
has(VIEW, 'noteGestureTicks(keys, hitTicks);',
  '⚠ ET LA LISTE EXACTE DE LEURS TICKS : c’est la moitié qui empêche « AVK » d’allumer les lettres d’une autre chaîne aux mêmes numéros (§Cbis)');
has(VIEW, 'stripResidueRiRef.current = firstRi;',
  '…la sélection est mise en mode « résidu ENTIER », comme le fait un clic sur le bandeau');
has(VIEW, 'const canSelect = keys.length > 0 && !!onAtomClickRef.current;',
  'la sélection est le chemin PRINCIPAL du geste (et elle n’existe que si la page peut la porter)');
ok(VIEW.indexOf("if (!canSelect) {") < VIEW.indexOf("seqHighlightCompRef.current = component.addRepresentation"),
  'la représentation sky n’est donc peinte QUE dans le cas de repli (aucune page ne porte la sélection)');
has(VIEW, 'onAtomClickRef.current(firstRi, keys);',
  'la sélection part par la porte ordinaire de la page (spectres, tables, espace « Selected »)');
has(VIEW, "if ((selectedKeysRef.current || []).join('|') !== keys.join('|')) onAtomClickRef.current(firstRi, keys);",
  '⚠ la MÊME sélection n’est pas renvoyée : la page lirait deux clés identiques comme un dé-clic, et relancer Find éteindrait ce qu’on regarde');
has(VIEW, 'seqSelectionKeysRef.current = keys;', 'la recherche retient CE QU’ELLE a sélectionné (c’est à cela que ✕ Clear la reconnaît)');
has(VIEW, 'const seqSelectionLive = !!seqSelectionKeysRef.current', '…et le badge « ✓ selected » se lit sur la sélection VRAIE (jamais un souvenir de plus longue vie qu’elle)');
has(VIEW, '✓ selected', 'le badge existe, et il est nommé');
has(VIEW, 'const dropSequenceSelection = () => {', 'défaire la sélection du Find passe par UNE fonction');
has(VIEW, "if ((selectedKeysRef.current || []).join('|') !== mine.join('|')) return false;",
  '⚠ une sélection faite à la main depuis la recherche est laissée INTACTE (comparaison de clés, jamais un drapeau)');
has(VIEW, '  dropSequenceSelection();\n  setSeqResult(null);',
  '✕ Clear relâche la sélection qu’il avait posée (le compte-rendu et la surbrillance partent avec)');
has(VIEW, '  dropSequenceSelection();\n\n  const residues = residuesOfTicks(ticks);',
  '…et une NOUVELLE recherche relâche celle de la précédente AVANT de poser la sienne');
has(VIEW, 'seqSelectionKeysRef.current = null;', 'la sélection du Find est oubliée quand la structure s’en va (vider · 🗑 Delete PDB · chargement)');

/* ── Cbis. DEUX CHAÎNES NUMÉROTÉES 1…N — LE RAPPORT DE CETTE SESSION ────────
   « if I select one letter (e.g. A) it also selects others » · « searching AVK
   also matches NIA ». La clé de sélection est `${resno - 1}-atome` : elle ne porte
   PAS la chaîne (elle nourrit aussi les spectres et la structure 2D). Deux
   résidus homonymes de deux chaînes donnent donc les MÊMES clés, et la sélection
   allumait les deux — la chaîne B montrait SES lettres aux numéros de la A.
   C’est mesuré ici (le motif, puis les clés) ; le remède est mesuré juste à côté,
   dans _viewer_sequence_highlight_test.mjs (les ticks exacts du geste). */
const HOMO = [
  ...['A', 'V', 'K', 'N', 'I', 'A'].map((c, i) => tick(i + 1, c, { chainname: 'A' })),
  ...['N', 'I', 'A', 'N', 'I', 'A'].map((c, i) => tick(i + 1, c, { chainname: 'B' })),
];
const homo = S.residuesOfTicks(HOMO);
const homoHit = S.findSequenceMatches(homo, 'AVK');
eq(homoHit.matches.map((m) => [m.chain, m.resnos]), [['A', [1, 2, 3]]],
  '« AVK » n’est trouvé QUE dans la chaîne A — le motif est ORDONNÉ, « NIA » ne le contient pas (ni anagramme, ni sous-ensemble)');
const keyOf = (r) => `${r.ri}-CA`;
const aKeys = homoHit.matches[0].indexes.map((i) => keyOf(homo[i]));
eq(aKeys, ['0-CA', '1-CA', '2-CA'], '…et ses clés sont `resno - 1` : SANS chaîne (la convention de tout le programme)');
const bSame = homo.filter((r) => r.chain === 'B' && r.resno <= 3);
eq(bSame.map((r) => r.code), ['N', 'I', 'A'], 'la chaîne B porte N·I·A à ces MÊMES numéros');
eq(bSame.map(keyOf), aKeys,
  '…et exactement les mêmes clés : des clés seules ne peuvent pas départager les deux chaînes — le rapport, mot pour mot');
has(VIEW, 'noteGestureTicks(keys, hitTicks);',
  'les gestes retiennent donc LEURS ticks (la provenance) — la vue et le bandeau s’en servent');
has(VIEW, "const gestureSel = gestureTicks && gestureTicks.sig === (selectedKeys || []).join('|')",
  '…et la provenance ne survit jamais à une sélection qu’ils n’ont pas posée (signatures comparées)');
has(VIEW, 'stripHighlightClauses(sel, residueTicks, gestureSel)',
  'la surbrillance ambre reçoit ces ticks : elle ne peut plus peindre l’homonyme d’une autre chaîne');
has(VIEW, 'setGestureTicks(null);',
  '…et elle s’oublie quand la structure s’en va (vider · 🗑 Delete PDB · chargement)');

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

console.log(`\n${passed} vérifications passées — recherche de séquence : la règle est pure, et le geste SÉLECTIONNE (la surbrillance n'est que le repli).\n`);
