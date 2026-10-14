/* =========================================================================
   _notebook_window_test.mjs — LE CAHIER SE DÉPLIE PAR TRANCHES.

   Le rapport, mot pour mot : « anche l'apertura della pagina "lab notebook" è
   molto lenta ».

   LA CAUSE, DANS LE CODE : `LabNotebook.jsx` montait TOUT d'un coup —
   `filteredTests.map((test) => <NotebookTestItem … />)` — c'est-à-dire, pour
   chaque expérience du dataset, sa fiche ENTIÈRE : conditions, formule 2D,
   tableau NMR, rapport HTML, images, graphes d'analyse (recharts / chart.js).
   Vingt expériences = vingt rapports à peindre avant la première image utile,
   et le nombre de nœuds DOM suit la taille du cahier.

   CE QUI EST VÉRIFIÉ ICI :
     1. la RÈGLE de la tranche (`utils/notebookWindow.js`) est pure : première
        tranche, croissance, bornes (jamais plus que la liste, jamais zéro pas),
        « tout déplier », libellé et reste à montrer ;
     2. le cahier SUIT cette règle : une tranche montée, un marqueur observé en
        bas de page, un bouton pour tout déplier, et plus JAMAIS la liste entière
        `filteredTests.map(...)` ;
     3. L'IMPRESSION DÉPLIE TOUT : le cahier écoute `lab:before-print` (le geste
        de la maison, envoyé par `handlePrint` d'App.jsx) et `beforeprint` (Ctrl+P
        du navigateur). Sans cela, le PDF ne porterait que la tranche montrée.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NOTEBOOK_WINDOW_FIRST, NOTEBOOK_WINDOW_STEP,
  notebookVisibleCount, notebookGrownCount, notebookWindowSlice,
  notebookHiddenCount, notebookWindowLabel,
} from './src/utils/notebookWindow.js';

const NB = readFileSync('./src/components/LabNotebook.jsx', 'utf8').replace(/\r\n/g, '\n');

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => {
  assert.ok(String(src).includes(needle), `${what}\n  fragment absent : ${needle}`);
  passed += 1;
};
const lacks = (src, needle, what) => {
  assert.ok(!String(src).includes(needle), `${what}\n  fragment présent : ${needle}`);
  passed += 1;
};

/* ══ 1. LA RÈGLE DE LA TRANCHE (pure, sans React ni DOM) ════════════════════ */
{
  eq(NOTEBOOK_WINDOW_FIRST, 4, 'un cahier qui s’ouvre montre une PREMIÈRE tranche (4 fiches)');
  eq(NOTEBOOK_WINDOW_STEP, 4, 'et le défilement en ajoute 4 à la fois');

  /* Ce qui est montré : borné par la liste, jamais négatif, jamais absurde. */
  eq(notebookVisibleCount(31, NOTEBOOK_WINDOW_FIRST), 4, '31 expériences : 4 montées au départ');
  eq(notebookVisibleCount(2, NOTEBOOK_WINDOW_FIRST), 2, 'moins d’expériences que la tranche : tout est monté');
  eq(notebookVisibleCount(0, NOTEBOOK_WINDOW_FIRST), 0, 'aucune expérience : rien à monter');
  eq(notebookVisibleCount(31, -5), 0, 'une tranche négative ne monte rien (jamais d’index absurde)');
  eq(notebookVisibleCount(31, 'n’importe quoi'), NOTEBOOK_WINDOW_FIRST,
    'une valeur illisible retombe sur la première tranche');
  eq(notebookVisibleCount(3, 99), 3, 'la tranche ne dépasse JAMAIS la liste');
  eq(notebookVisibleCount(31, 0, { first: 7 }), 0, '0 reste 0 (une liste vidée par un filtre ne remonte pas)');

  /* La croissance : un pas au moins, jamais deux fois la même tranche. */
  eq(notebookGrownCount(31, 4), 8, 'le bas de page ajoute un pas');
  eq(notebookGrownCount(31, 28), 31, '…et s’arrête pile à la fin de la liste');
  eq(notebookGrownCount(31, 4, { step: 0 }), 5, 'un pas nul ne peut pas bloquer le défilement');
  eq(notebookGrownCount(31, 4, { step: -3 }), 5, '…ni un pas négatif');
  eq(notebookGrownCount(31, 4, { step: 2.9 }), 6, 'un pas décimal est ramené à un entier');
  eq(notebookGrownCount(2, 1), 2, 'une petite liste finit d’être montrée en un geste');

  /* Tout déplier (impression, bouton). */
  eq(notebookVisibleCount(31, 4, { showAll: true }), 31, '« tout déplier » monte la liste entière');
  eq(notebookVisibleCount(0, 4, { showAll: true }), 0, '…et rien de plus que la liste');
  eq(notebookGrownCount(31, 4, { showAll: true }), 31, 'une liste dépliée ne se referme pas toute seule');

  /* La tranche rendue, et ce qu'il reste. */
  const list = Array.from({ length: 9 }, (_, i) => ({ id: 't' + i }));
  eq(notebookWindowSlice(list, 4).map((t) => t.id), ['t0', 't1', 't2', 't3'],
    'la tranche est le DÉBUT de la liste, dans l’ordre (aucune fiche sautée)');
  eq(notebookWindowSlice(list, 8).map((t) => t.id), ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'],
    'la tranche suivante s’AJOUTE (le défilement ne rejoue rien)');
  eq(notebookWindowSlice(list, 4, { showAll: true }).length, 9, 'dépliée, la tranche est toute la liste');
  eq(notebookWindowSlice(null, 4), [], 'aucune liste : aucune tranche');
  eq(notebookWindowSlice(list, 4).length + notebookHiddenCount(list.length, 4), 9,
    'ce qui est montré et ce qui reste font exactement la liste');

  eq(notebookHiddenCount(31, 4), 27, 'le reste à montrer est DIT');
  eq(notebookHiddenCount(31, 31), 0, '…et vaut 0 quand tout est monté');
  eq(notebookHiddenCount(2, 99), 0, '…jamais négatif');
  eq(notebookWindowLabel(4, 31), '4 of 31 experiment(s) shown', 'la phrase dit ce qui est montré');
  eq(notebookWindowLabel(0, 0), '0 experiment', 'et ne ment pas sur un cahier vide');
  eq(notebookWindowLabel(99, 3), '3 of 3 experiment(s) shown', 'un compte trop grand est ramené à la liste');
}

/* ══ 2. LE CAHIER SUIT LA RÈGLE (fichier réel) ═════════════════════════════ */
{
  has(NB, "import { NOTEBOOK_WINDOW_FIRST, notebookVisibleCount, notebookGrownCount, notebookHiddenCount, notebookWindowLabel } from '../utils/notebookWindow';",
    'la tranche vient de la règle pure, pas d’un nombre recopié dans le JSX');
  has(NB, 'const [notebookShown, setNotebookShown] = useState(NOTEBOOK_WINDOW_FIRST);',
    'le cahier retient COMBIEN de fiches il a montées');
  has(NB, 'const notebookShownCount = notebookVisibleCount(filteredTests.length, notebookShown, { showAll: notebookShowAll });',
    'le compte montré est celui de la règle (borné par la liste)');
  has(NB, 'const notebookLeftToShow = notebookHiddenCount(filteredTests.length, notebookShownCount);',
    'le reste est connu (c’est la phrase, et le marqueur)');

  /* ⛔ LA DÉFAUT D'ORIGINE : la liste entière montée d'un coup. */
  lacks(NB, '{filteredTests.map((test) => (', 'plus AUCUNE liste entière montée d’un coup');
  has(NB, '{filteredTests.slice(0, notebookShownCount).map((test) => (',
    'c’est la TRANCHE qui est montée, dans l’ordre');

  /* Le défilement : un marqueur observé (et un bouton pour ceux qui le cherchent). */
  has(NB, 'const notebookEndRef = useRef(null);', 'le bas de la tranche a un marqueur');
  has(NB, 'new IntersectionObserver((entries) => {', 'une observation le surveille');
  has(NB, "}, { rootMargin: '600px 0px' });", 'avec de l’avance : la tranche suivante est prête avant qu’on n’y arrive');
  has(NB, 'setNotebookShown((prev) => notebookGrownCount(filteredTests.length, prev));',
    'quand il entre à l’écran, la tranche suivante se monte');
  has(NB, 'if (!node || typeof IntersectionObserver !== \'function\') return undefined;',
    'un navigateur sans observation ne casse rien (le bouton reste)');
  has(NB, 'setNotebookShowAll(true)', 'le bouton « tout déplier » existe aussi (⌨ sans observation)');
  has(NB, '⬇ Unfold every experiment', '…et il est lisible');
  has(NB, 'className="no-print flex flex-col items-center gap-2 pt-2"',
    'le marqueur et son bouton ne s’impriment pas eux-mêmes');
  has(NB, '{notebookLeftToShow > 0 && (', 'le marqueur n’existe que s’il reste des fiches à montrer');

  /* Une liste qui change (filtres, recherche, dataset) repart de la première tranche. */
  has(NB, 'setNotebookShown(NOTEBOOK_WINDOW_FIRST);', 'un filtre qui change repart de la première tranche');
  has(NB, '}, [notebookFirstId, filteredTests.length]);', '…et c’est la LISTE qui le déclenche');

  /* Ce qui est montré est DIT (jamais un filtre silencieux). */
  has(NB, '{notebookWindowLabel(notebookShownCount, filteredTests.length)}', 'le cahier dit ce qu’il montre');
  has(NB, "the rest unfolds as you scroll", '…et annonce que le reste se déplie en défilant');
}

/* ══ 3. L'IMPRESSION DÉPLIE TOUT ═══════════════════════════════════════════ */
{
  has(NB, "window.addEventListener('lab:before-print', expand);",
    'le geste d’impression de la maison déplie le cahier');
  has(NB, "window.addEventListener('beforeprint', expand);",
    '…et un Ctrl+P du navigateur aussi');
  has(NB, 'const expand = () => setNotebookShowAll(true);', 'déplier ne fait que monter ce qui manquait');
  lacks(NB, 'setNotebookShowAll(false)', 'on ne replie JAMAIS après l’impression (le cahier garde ce qui a été imprimé)');
  has(NB, "window.removeEventListener('lab:before-print', expand);",
    'l’écoute est retirée au démontage (rien ne reste branché)');

  /* Le cahier ne s'écoute pas lui-même : c'est App.jsx qui parle — et il parle
     AVANT son attente d'images et sa pause de 150 ms, donc avant window.print(). */
  const APP = readFileSync('./src/App.jsx', 'utf8').replace(/\r\n/g, '\n');
  const atPrint = APP.indexOf('const handlePrint = async () => {');
  const ask = APP.indexOf("window.dispatchEvent(new CustomEvent('lab:before-print'))", atPrint);
  const wait = APP.indexOf('const imgs = Array.from(document.querySelectorAll', atPrint);
  const atWindowPrint = APP.indexOf('window.print();', atPrint);
  ok(ask > atPrint && ask < wait && wait < atWindowPrint,
    'App demande le dépliage AVANT d’attendre les images et de lancer l’impression : '
    + 'React a donc monté toutes les fiches quand le navigateur photographie la page');
}

console.log(`_notebook_window_test.mjs — ${passed} assertions OK`);
