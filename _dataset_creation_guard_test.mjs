/* =========================================================================
   _dataset_creation_guard_test.mjs — qui peut CRÉER un dataset ? (domanda 3)

   Le symptôme : « malgré le fait que seul le superutilisateur puisse créer des
   datasets, il en apparaît parfois que je n'ai pas créés ».

   La cause : les garde-fous de l'écran d'accueil laissaient passer dès que
   `operatorNames.length === 0` — or cette liste est AUSSI vide sur un poste dont
   la synchronisation n'est pas terminée, ou dont la copie locale est vide. Un
   utilisateur ordinaire voyait donc « Create New Dataset », créait un dataset,
   et celui-ci apparaissait ensuite chez le superutilisateur (les datasets sont
   partagés par l'espace de travail Drive / Firestore).

   Ce qui est vérifié ici est ce qui doit rester vrai :

     • la lecture de la liste des comptes est signalée (`teamLoaded`) — vide
       parce que « pas encore lu » n'est plus confondu avec « équipe vide » ;
     • un seul drapeau, `canManageDatasets`, garde la création des datasets ;
       les trois ACTIONS GLOBALES qu'il gardait sur la page d'accueil (Delete
       Empty, visibilité, Load HTML) ont quitté cette page — elles ne
       dépendaient pas du dataset ouvert et faisaient croire à un couple
       sauvegarde/restauration global qui n'existe pas. Elles vivent maintenant
       dans des zones déjà réservées au superutilisateur : Réglages →
       « Database Cleanup & Data management » pour les deux premières, la barre
       latérale d'un dataset (à côté de 💾 Save backup) pour « Load backup » ;
     • `createNewDataset` REFUSE la création même si un bouton caché l'appelle ;
     • chaque nouveau dataset est estampillé (qui / quel rôle / quand), pour
       qu'un dataset inattendu puisse être identifié.

   App.jsx est du JSX : l'audit se fait SUR LA SOURCE.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};

const APP = readFileSync(new URL('./src/App.jsx', import.meta.url), 'utf8');
const SETTINGS = readFileSync(new URL('./src/components/AppModules/settingsModule.jsx', import.meta.url), 'utf8');

/* ── 1. « Équipe vide » ≠ « liste pas encore lue » ───────────────────────── */
ok(/const \[teamLoaded, setTeamLoaded\] = useState\(false\);/.test(APP), 'un drapeau dit si la liste des comptes a été lue');
const snapDoc = APP.indexOf(".doc('global')");
const teamMark = APP.indexOf('setTeamLoaded(true)');
const noDocCase = APP.indexOf('cloudHasAccountsRef.current = false');
ok(snapDoc > 0 && teamMark > snapDoc && noDocCase > teamMark && noDocCase - teamMark < 400,
  'la lecture (même sans document) marque la liste comme lue, juste avant le cas « pas de document »');
ok(/setCloudAppConfigRead\(true\);/.test(APP), 'la lecture autorise aussi les écritures (protection existante)');

/* ── 2. Un seul drapeau pour toutes les actions réservées ────────────────── */
const flagStart = APP.indexOf('const canManageDatasets = ');
ok(flagStart > 0, 'canManageDatasets est défini');
const flagBlock = APP.slice(flagStart, APP.indexOf(';', flagStart) + 1);
ok(/currentUser\?\.role === 'superuser'/.test(flagBlock), 'le superutilisateur passe toujours');
ok(/recoveryBypass/.test(flagBlock), 'le mode récupération reste une porte de secours');
ok(/teamLoadedHere/.test(flagBlock), 'le « bootstrap » exige que la liste des comptes soit LUE');
ok(/operatorNames\.length === 0 \|\| teamNoSuperuser/.test(flagBlock),
  'le bootstrap couvre l’équipe vide ET l’équipe sans superutilisateur');
ok(/const teamLoadedHere = teamLoaded \|\| cloudAppConfigRead;/.test(APP),
  'la lecture cloud (cloudAppConfigRead) vaut aussi comme preuve que la liste est lue');

/* ── 3. L'ancienne porte est fermée partout ──────────────────────────────── */
eq(/currentUser\?\.role === 'superuser' \|\| operatorNames\.length === 0 \|\| recoveryBypass/.test(APP), false,
  'plus aucun garde-fou ne se contente de « operators vide »');
const guards = [...APP.matchAll(/\{canManageDatasets && \(/g)].length;
eq(guards, 0, 'plus AUCUNE action globale gardée par le drapeau sur la page d’accueil (elles ont été déplacées)');
/* Le geste n'est PAS perdu : il est passé à Réglages, et la section qui le
   porte est déjà réservée au superutilisateur (`isSuper`), ce qui remplace
   exactement la garde qu'il avait sur la page d'accueil. */
ok(/onMakeAllTeamVisible=\{makeAllDatasetsTeamVisible\}/.test(APP),
  '« Rendre visibles à toute l’équipe » est passé aux Réglages (aucune capacité perdue)');
ok(/const isSuper = !!currentUser && currentUser\.role === 'superuser';/.test(SETTINGS),
  'la section qui reçoit les gestes par lots est réservée au superutilisateur');
ok(/onMakeAllTeamVisible=\{onMakeAllTeamVisible\}/.test(SETTINGS),
  'Réglages fait suivre le geste au gestionnaire de nettoyage (DatabaseCleanupManager)');
ok(/allVisibleBusy=\{allVisibleBusy\}/.test(SETTINGS),
  '…avec son état d’attente (le bouton se désactive pendant les écritures)');
ok(/\{canManageDatasets \? \(/.test(APP), 'le bouton « Create New Dataset » aussi');
ok(/superuser \/ bootstrap \/ recovery/.test(APP), 'les commentaires disent toujours pourquoi la porte existe');

/* ── 4. La création elle-même refuse ─────────────────────────────────────── */
const createStart = APP.indexOf('const createNewDataset = async (kind');
ok(createStart > 0, 'createNewDataset existe');
const createBlock = APP.slice(createStart, createStart + 1400);
ok(/if \(!canManageDatasets\) \{/.test(createBlock), 'createNewDataset refuse si le drapeau est faux');
ok(/Création refusée/.test(createBlock), 'le refus est expliqué à l’utilisateur (dialogue)');
ok(/return;/.test(createBlock), 'un refus n’écrit RIEN');

/* ── 5. Traçabilité du nouveau dataset ───────────────────────────────────── */
const payloadStart = APP.indexOf("const updatedPayload = {", createStart);
const payloadBlock = APP.slice(payloadStart, payloadStart + 1600);
ok(/createdBy: /.test(payloadBlock), 'le dataset note QUI l’a créé');
ok(/createdByRole: /.test(payloadBlock), 'et avec quel rôle');
ok(/createdAt:/.test(payloadBlock), 'et quand (déjà présent, conservé)');
ok(/access: \{[\s\S]*memberNames/.test(payloadBlock), 'le créateur reste membre par défaut (comportement existant)');

/* ── Bilan ────────────────────────────────────────────────────────────────── */
console.log(`_dataset_creation_guard_test.mjs — ${passed} assertions OK`);
