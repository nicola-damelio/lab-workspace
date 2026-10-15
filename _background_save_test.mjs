/* =========================================================================
   _background_save_test.mjs — « NE ME FAIS PAS ATTENDRE POUR SAUVER ».

   La demande, mot pour mot : « the program makes me wait a lot because it does
   not let me change page untill it finishes to save but it coukd save in
   background ».

   Deux gestes faisaient réellement attendre :

     · LE ◀ DE LA BARRE LATÉRALE (`handleBackToExplorer`) : la fonction était
       `async` et n'exécutait la navigation qu'APRÈS la relecture Firestore du
       verrou des expériences (voir guardDistantExperiments) puis la compression
       du payload. Changer de page = rester devant un écran immobile, alors que
       tout ce qu'il faut écrire est déjà en mémoire AU CLIC.

     · LES ÉCRITURES EN SÉRIE : la matrice « 👥 Équipe & accès » et le geste
       « 🌐 Rendre visibles à toute l'équipe » faisaient un aller-retour réseau
       PAR dataset, l'un après l'autre (N fois le temps pour un seul geste).

   Ce qui est vérifié ici, sur les fichiers RÉELS :
     · la navigation n'attend plus rien : `handleBackToExplorer` n'est plus
       `async`, elle LANCE l'écriture puis change de page dans le même clic ;
     · l'instantané est pris AU CLIC (avant le premier `await` du geste) et la
       compression lourde n'arrive qu'après avoir rendu la main au navigateur
       (la page d'arrivée se peint d'abord) ;
     · l'identifiant du dataset quitté et son TYPE sont FIGÉS (le réseau peut
       répondre alors qu'une AUTRE base est ouverte) ;
     · l'écriture d'arrière-plan ne retouche pas l'écran d'arrivée
       (`applyToScreen: false`) mais garde toujours la mémoire des expériences ;
     · LES TICKETS D'ÉCRITURE : une écriture dépassée par une plus récente du
       même dataset se TAIT — elle ne peut pas remettre une version plus vieille
       en ligne (et écrire dans un autre dataset ne la dérange pas) ;
     · les deux gestes d'écriture multiple ne sont plus en série.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync('./src/App.jsx', 'utf8').replace(/\r\n/g, '\n');
const MATRIX = readFileSync('./src/components/AppModules/datasetMembershipMatrix.jsx', 'utf8').replace(/\r\n/g, '\n');

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

/* Les deux morceaux de App.jsx qui portent la sortie d'un dataset : le GESTE
   (l'écriture d'arrière-plan) et la NAVIGATION (le bouton ◀). */
const atLeaver = APP.indexOf('const saveLeavingDataset = (datasetId, isAdmin) => {');
const atBack = APP.indexOf('/* ── LE BOUTON ◀ : LA NAVIGATION, SANS ATTENTE');
const atNext = APP.indexOf("/* ── Le CONTENU d'un dataset sur le Drive", atBack);
const LEAVER = APP.slice(atLeaver, atBack);
const BACK = APP.slice(atBack, atNext);

/* ── 1. LA NAVIGATION NE SE FAIT PLUS ATTENDRE ───────────────────────────── */
ok(atLeaver > 0, 'la sortie d’un dataset a son propre geste (saveLeavingDataset)');
ok(atBack > atLeaver, '…et la navigation est décrite après lui');
eq((APP.match(/const handleBackToExplorer = async \(\) => \{/g) || []).length, 0,
  'le ◀ n’est PLUS une fonction async (c’est l’attente qui faisait patienter)');
has(BACK, 'const handleBackToExplorer = () => {', 'il est devenu synchrone');
has(BACK, 'saveLeavingDataset(String(currentDatasetId), isAdministrationKind(activeDatasetKind));',
  'il LANCE l’enregistrement de la base quittée (identifiant ET type figés au clic)');
lacks(BACK, 'await saveLeavingDataset', '…sans l’attendre');
ok(BACK.indexOf('saveLeavingDataset(String(currentDatasetId)') < BACK.indexOf("setAppView('explorer');"),
  'l’enregistrement part AVANT la navigation (il ne peut pas être oublié au passage)');
ok(BACK.indexOf("setAppView('explorer');") < BACK.indexOf('setProjectDatasetScope(null);'),
  'la navigation d’origine est intacte (la page d’accueil s’affiche, la portée du dataset tombe)');
has(BACK, "setCurrentAdminPage('overview');", '…y compris le retour à la première page d’administration');
has(BACK, 'resetAdminNavHistory();', '…et l’historique de navigation remis à zéro');

/* ── 2. L’INSTANTANÉ EST PRIS AU CLIC, PAS APRÈS LE RÉSEAU ───────────────── */
has(LEAVER, 'const saveLeavingDataset = (datasetId, isAdmin) => {',
  'le geste n’est pas async : il rend la main immédiatement');
has(LEAVER, '(async () => {', '…le travail continue dans sa propre promesse (personne ne l’attend)');
const atRawData = LEAVER.indexOf('const rawData = isAdmin ? null : { ...latestDataRef.current, ...cloudProjectsPayload() };');
const atLock = LEAVER.indexOf('if (!isAdmin) rawData.tests = guardExperimentsForWrite(rawData.tests);');
const atYield = LEAVER.indexOf('await new Promise((resolve) => { setTimeout(resolve, 0); });');
/* La compression a quitté le fil principal (voir utils/datasetCompression) : le
   geste reste le même, il est simplement attendu — et il arrive toujours APRÈS
   le rendu de main ci-dessus. */
const atCompress = LEAVER.indexOf("const compressedPayload = isAdmin ? '' : await compressDatasetForSave(rawData);");
ok(atRawData > 0 && atRawData < atYield,
  'l’instantané (mémoire + projets) est pris AVANT le premier await : c’est l’état du CLIC');
ok(atLock > 0 && atLock < atYield,
  'le verrou des expériences (guardExperimentsForWrite) est posé au même moment');
ok(atYield > 0, 'le travail rend la main au navigateur avant de commencer');
ok(atCompress > atYield,
  'la compression (lourde) vient APRÈS ce rendu de main : la page d’arrivée se peint d’abord');
has(LEAVER, 'if (!isAdmin) rawData.tests = await guardDistantExperiments(rawData.tests, { datasetId, applyToScreen: false });',
  'la relecture de la copie partagée passe par le même verrou, avec l’identifiant FIGÉ et sans toucher l’écran');

/* ── 3. LE DATASET QUITTÉ EST FIGÉ (le réseau répond quand on est ailleurs) ─ */
has(LEAVER, 'mirrorDatasetContent(datasetId, updatedPayload);',
  'la copie du Drive part vers le dataset QUITTÉ, pas vers celui qui est ouvert maintenant');
has(LEAVER, '.doc(datasetId)', '…l’écriture Firestore aussi');
has(LEAVER, 'const existingIdx = stored.findIndex((e) => e.id === datasetId);',
  '…et le repli localStorage également');
lacks(LEAVER, 'mirrorDatasetContent(currentDatasetId', 'aucun chemin d’écriture ne retombe sur l’état courant');
lacks(LEAVER, '.doc(currentDatasetId)', '…y compris pour Firestore');
has(LEAVER, "kind: 'scientific'", 'le payload scientifique garde sa forme (rien n’a été perdu au déménagement)');
has(LEAVER, "kind: 'administration',", '…et une base d’administration reste une base d’administration');
has(LEAVER, 'testCount: rawData.tests?.length || 0,', '…avec le compte d’expériences');
has(LEAVER, 'pendingDatasetSaveRef.current = null;',
  'l’attente du minuteur est remplacée par cet envoi (jamais deux envois de la même base)');
has(LEAVER, 'try { datasetCopyMirrorRef.current.flush(); } catch { /* best-effort */ }',
  'la copie Drive (re)programmée part sans son délai');
has(LEAVER, "setSaveStatus('error');", 'un échec en arrière-plan se DIT (la barre latérale le porte)');

/* ── 4. LES TICKETS : UNE ÉCRITURE DÉPASSÉE SE TAIT ──────────────────────── */
has(APP, 'const writeTicketRef = useRef(new Map()); // datasetId → numéro du dernier ticket posé',
  'un compteur de tickets PAR dataset (écrire ailleurs ne gêne personne)');
has(APP, 'const takeWriteTicket = (datasetId) => {', 'un seul endroit qui pose un ticket');
has(APP, 'const holdsLatestWriteTicket = (datasetId, ticket) =>', '…et un seul endroit qui le vérifie');
eq((APP.match(/const writeTicket = takeWriteTicket\(/g) || []).length, 3,
  'les TROIS écritures prennent un ticket (enregistrement automatique scientifique, base d’administration, sortie du dataset)');
eq((APP.match(/if \(!holdsLatestWriteTicket\(/g) || []).length, 3,
  '…et les trois vérifient, juste avant d’écrire, qu’elles ont encore le dernier');
has(LEAVER, 'if (!holdsLatestWriteTicket(datasetId, writeTicket)) return;',
  'l’écriture d’arrière-plan se tait si une plus récente de la même base est partie entre-temps');

/* LA RÈGLE ELLE-MÊME, rejouée : c’est elle qui empêche une version plus vieille
   d’atterrir après une plus récente (mêmes opérations que dans App.jsx). */
const makeTickets = () => {
  const map = new Map();
  return {
    take: (id) => { const k = String(id); const n = (map.get(k) || 0) + 1; map.set(k, n); return n; },
    holds: (id, ticket) => map.get(String(id)) === ticket,
  };
};
{
  const T = makeTickets();
  const leaving = T.take('ds1');
  ok(T.holds('ds1', leaving), 'seule en course : l’écriture d’arrière-plan écrit (le cas normal ne change pas)');
  const reopened = T.take('ds1');
  ok(!T.holds('ds1', leaving), 'la base a été rouverte et retapée : l’écriture d’arrière-plan SE TAIT');
  ok(T.holds('ds1', reopened), '…c’est la plus récente qui écrit (la version fraîche gagne)');
  T.take('ds2');
  ok(T.holds('ds1', reopened), 'écrire dans un AUTRE dataset ne fait pas taire celle-ci');
  const numeric = T.take(7);
  ok(T.holds('7', numeric), 'un identifiant numérique et sa forme texte sont le même dataset (datasetId vient de String())');
}

/* ── 5. L’ÉCRAN N’EST PAS RETOUCHÉ QUAND ON EST AILLEURS ─────────────────── */
has(APP, 'if (applyToScreen) setReactTests(out.tests);',
  'le verrou à distance ne verse les expériences rattrapées qu’à l’écran où elles vivent');
has(APP, 'rememberExperiments(targetId, out.tests);',
  'la MÉMOIRE des expériences, elle, est toujours écrite (c’est elle qui protège la suite)');
has(APP, 'const targetId = datasetId || currentDatasetIdRef.current;',
  'le verrou travaille sur le dataset demandé, ou sur celui qui est ouvert');
const atGuard = APP.indexOf('const guardDistantExperiments = async (list, { datasetId = null, applyToScreen = true } = {}) => {');
const GUARD = APP.slice(atGuard, atGuard + 2600);
ok(atGuard > 0, 'le verrou à distance est bien celui qu’on vient de lire');
ok(!GUARD.includes('\n    setReactTests(out.tests);'),
  'le verrou à distance n’appelle plus setReactTests sans condition (l’écran d’arrivée n’est pas écrasé)');
ok(GUARD.includes('\n    if (applyToScreen) setReactTests(out.tests);'),
  '…il ne le fait que quand ce dataset est celui qui est affiché');

/* ── 6. LES ÉCRITURES MULTIPLES NE SONT PLUS EN SÉRIE ───────────────────── */
has(MATRIX, 'await Promise.all(patches.map((patch) =>', 'la matrice écrit ses datasets EN PARALLÈLE');
lacks(MATRIX, 'for (const patch of patches)', '…il n’y a plus de boucle séquentielle avec un await dedans');
lacks(MATRIX, 'no-await-in-loop', '…donc plus besoin de la dérogation de lint qui allait avec');
has(MATRIX, 'const done = results.filter(Boolean).length;',
  'chaque échec est compté pour être DIT (« 2/5 dataset(s) enregistré(s) »)');
has(MATRIX, 'setBusy(false);', 'et le bouton redevient actif quand toutes les écritures sont posées');
has(APP, 'await Promise.all(restrictedList.map((d) => Promise.resolve()',
  '« 🌐 Rendre visibles à toute l’équipe » écrit aussi en parallèle');
lacks(APP, 'for (const d of restrictedList)', '…plus un aller-retour réseau par dataset');
has(APP, "console.warn('Could not make a dataset team-visible:', e && e.message);",
  'un échec n’empêche pas les autres et laisse une trace');

/* ── 7. L’ÉCRITURE D’ARRIÈRE-PLAN SE DIT SUR LA PAGE D’ARRIVÉE ─────────────
   La barre latérale qui porte « Saving… » et l’erreur appartient à la page d’un
   dataset ; la page d’accueil, elle, n’en a pas. Sans ce bandeau, une écriture
   qui continue après le ◀ serait invisible — et son échec, muet. */
has(APP, 'Enregistrement de la base que vous venez de quitter… vous pouvez continuer, rien n’est perdu.',
  'la page d’accueil DIT qu’une écriture continue (elle ne fait pas patienter en silence)');
has(APP, 'L’enregistrement de la dernière base n’a pas abouti : {saveErrorMsg}',
  '…et elle DIT l’échec, avec le message reçu (sinon il serait muet, hors de la page du dataset)');
has(APP, "{saveStatus === 'saving' && (", 'le bandeau est piloté par l’état de sauvegarde, pas par un texte figé');

/* ── Bilan ────────────────────────────────────────────────────────────────── */
console.log(`_background_save_test.mjs — ${passed} assertions OK`);
