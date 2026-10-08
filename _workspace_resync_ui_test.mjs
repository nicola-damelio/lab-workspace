/* =========================================================================
   _workspace_resync_ui_test.mjs — « RESYNC FROM DRIVE » : LE COMPTE-RENDU.

   Le défaut réparé (voir src/components/WorkspaceResyncPanel.jsx et
   src/utils/workspaceResync.js) : la reprise lisait le Drive et remettait des
   projets dans le navigateur, mais RIEN ne disait ce qui avait été remis — ni
   combien, ni ce qui avait échoué. Et deux pièges silencieux l'attendaient :

     • le CONTENU d'une copie de dataset vit dans `payload`, COMPRESSÉ : lire
       `copy.projects` sans décoder rend `undefined`, l'adoption ne fait RIEN et
       personne ne le voit — il faut décoder (`parsePayload`) et compter une
       charge illisible comme un ÉCHEC ;
     • ce qui revient doit REPARTIR vers l'index partagé, sinon le poste suivant
       ne voit toujours rien (et l'inventaire signale les mêmes « inconnus » à
       chaque fois).

   Ce qui est vérifié ici, sans navigateur :
     • `resyncLineTone` : le goût d'une ligne (`⚠` = défaut peint en ambre) ;
     • `resyncSummaryText` : tous les cas — rien à récupérer, projets rendus,
       copie illisible, erreur du geste, chiffres en texte, jamais de
       soustraction négative, jamais de `undefined` à l'écran ;
     • la PURETÉ : deux lectures du même objet donnent le même texte et
       l'objet donné n'est jamais modifié ;
     • le chaînage réel `resyncReportLines` → compte-rendu (les défauts de
       l'inventaire arrivent jusqu'à l'écran, peints en ambre) ;
     • le BRANCHEMENT : le panneau ne fabrique aucune phrase (elles viennent du
       module pur), les Réglages le montent avec le geste d'App.jsx, et App.jsx
       décode, compte les échecs, réécrit l'index et ne remonte les pages que
       quand quelque chose a bougé.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
  setItem: (k, v) => { store.set(String(k), String(v)); },
  removeItem: (k) => { store.delete(String(k)); }
};
globalThis.window = { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true };
globalThis.CustomEvent = class CustomEvent {
  constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
};

const R = await import('./src/utils/workspaceResync.js');

const RESYNC_SRC = readFileSync('./src/utils/workspaceResync.js', 'utf8');
const PANEL_SRC = readFileSync('./src/components/WorkspaceResyncPanel.jsx', 'utf8');
const SETTINGS_SRC = readFileSync('./src/components/AppModules/settingsModule.jsx', 'utf8');
const APP_SRC = readFileSync('./src/App.jsx', 'utf8');

let passed = 0;
const eq = (actual, expected, what) => { assert.deepEqual(actual, expected, what); passed += 1; };
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => ok(src.includes(needle), what);

/* ── 1. LE GOÛT D'UNE LIGNE ─────────────────────────────────────────────────
   `⚠` = un défaut trouvé (peint en ambre) ; tout le reste est un constat. Le
   test ne cherche pas l'esthétique : il vérifie qu'un défaut ne peut pas
   passer pour un constat, et qu'aucune ligne ne peut faire tomber le panneau. */
eq(R.resyncLineTone('⚠ A project folder sits at the dataset root.'), 'warn', 'une ligne de défaut est peinte en ambre');
eq(R.resyncLineTone('   ⚠ indented'), 'warn', '…même précédée d’espaces (la ligne est nettoyée avant lecture)');
eq(R.resyncLineTone('\t⚠ tabbed'), 'warn', '…ou d’une tabulation');
eq(R.resyncLineTone('· Drive: 2 dataset folder(s)'), 'note', 'un constat est peint en gris');
eq(R.resyncLineTone(''), 'note', 'une ligne vide est un constat (jamais une alerte inventée)');
eq(R.resyncLineTone(null), 'note', 'null ne fait pas tomber le panneau');
eq(R.resyncLineTone(undefined), 'note', 'undefined non plus');
eq(R.resyncLineTone(42), 'note', 'un nombre est lu comme du texte, sans exception');
eq(R.resyncLineTone('! ⚠ pas en tête'), 'note', 'seul le `⚠` EN TÊTE compte (une phrase qui en parle n’est pas un défaut)');

/* ── 2. LE COMPTE-RENDU, CAS PAR CAS ────────────────────────────────────────
   La première qualité attendue d'un compte-rendu est de ne JAMAIS rien dire de
   faux : rien de récupéré doit se lire comme tel, un échec de lecture doit être
   nommé, et un compte-rendu absent ne doit pas se présenter comme une réussite. */
const empty = R.resyncSummaryText(null);
eq(empty.restored, 0, 'aucun compte-rendu : aucun projet « rendu » (jamais un chiffre inventé)');
eq(empty.headline, 'The Drive inventory is unavailable — nothing was read.', '…et l’en-tête le DIT');
eq(empty.projects, 'No project was missing here (0 known).', '…sans faire croire à une reprise');
eq(empty.index, 'The workspace index lists no project.', '…et sans promettre ce que l’index porte');
eq(empty.copies, '', 'aucune copie relue : aucune phrase (pas de ligne creuse)');
eq(empty.failed, '', 'aucun échec : aucune phrase');
eq(empty.lines, [], 'aucune ligne inventée');
eq(empty.stateAdopted, false, 'index non adopté : le panneau ne le prétend pas');

const restored = R.resyncSummaryText({
  ok: true, projectsBefore: 3, projectsAfter: 7, projectsInIndex: 7,
  copiesAdopted: 2, stateAdopted: true
});
eq(restored.restored, 4, '4 projets de plus qu’avant : c’est le chiffre de la reprise');
eq(restored.headline, 'The Drive was read and this browser was brought back in line with it.', '…et l’en-tête dit que le Drive a été lu');
eq(restored.projects, '4 project(s) restored in this browser (3 known before, 7 now).', '…avec les deux chiffres, avant et après');
eq(restored.index, 'The workspace index lists 7 project(s); everything it lists is now here too.', '…et ce que l’index porte est rappelé');
eq(restored.copies, '2 dataset copy(ies) were re-read from the Drive.', 'les copies relues sont comptées');
eq(restored.failed, '', '…et aucun échec n’est signalé quand il n’y en a pas');
eq(restored.stateAdopted, true, 'l’adoption de l’index est rapportée au panneau');

/* Les chiffres peuvent arriver du DOM ou d'un magasin : en TEXTE. */
eq(R.resyncSummaryText({ ok: true, projectsBefore: '2', projectsAfter: '5' }).restored, 3,
  'des nombres donnés en texte sont compris (aucun NaN à l’écran)');

/* Une adoption ne rend JAMAIS des projets « en moins » : une liste locale plus
   courte après coup (magasin nettoyé, tombe adoptée entre-temps) ne doit pas
   afficher un chiffre négatif. */
const shrunk = R.resyncSummaryText({ ok: true, projectsBefore: 9, projectsAfter: 4 });
eq(shrunk.restored, 0, 'aucune soustraction négative (jamais « -5 projets restaurés »)');
eq(shrunk.projects, 'No project was missing here (4 known).', '…le compte-rendu dit simplement ce qui est là');

/* Une copie illisible est NOMMÉE : c'est ce qui distingue « rien à récupérer »
   de « la récupération a échoué » — le silence était le défaut d'origine. */
const failedCopies = R.resyncSummaryText({ ok: true, copiesAdopted: 1, copiesFailed: ['abc', '', null, 7] });
eq(failedCopies.failed,
  '2 copy(ies) could not be read: abc, 7 (the dataset folders themselves are still on the Drive).',
  'les copies illisibles sont nommées, les entrées vides écartées, les identifiants rendus en texte');
ok(failedCopies.failed.startsWith('2 copy(ies)'), '…et le compte des échecs est celui des copies réellement nommées');

/* L'erreur du geste (exception) a SA phrase, et elle prime sur tout le reste :
   l'utilisateur doit voir l'échec, pas un compte-rendu de réussite. */
const errored = R.resyncSummaryText({ error: 'boom', ok: true, projectsBefore: 1, projectsAfter: 5 });
eq(errored.headline, 'The Drive could not be read.', 'une erreur du geste a sa propre en-tête (elle prime)');
eq(errored.projects, '4 project(s) restored in this browser (1 known before, 5 now).', '…le détail reste lisible sous l’en-tête');

/* Les lignes de l'inventaire sont rendues en texte, jamais `undefined` ni `0` :
   une ligne qui ne veut rien dire ne doit pas laisser un trou dans la liste. */
const lines = R.resyncSummaryText({ ok: false, lines: ['· a', '', null, 0, '⚠ b'] });
eq(lines.lines, ['· a', '⚠ b'], 'les lignes creuses sont écartées, le reste est rendu en texte');
eq(lines.headline, 'The Drive inventory is unavailable — nothing was read.', '…sans que l’en-tête change de sens');

/* ── 3. PURETÉ ──────────────────────────────────────────────────────────────
   Le compte-rendu est construit à chaque rendu : le helper ne doit ni mémoriser
   ni modifier ce qu'on lui donne (sinon l'écran dépendrait du nombre de fois
   qu'on a cliqué). */
const input = { ok: true, projectsBefore: 1, projectsAfter: 3, lines: ['· a'], copiesFailed: ['x'] };
const snapshot = JSON.stringify(input);
const firstPass = R.resyncSummaryText(input);
const secondPass = R.resyncSummaryText(input);
eq(firstPass, secondPass, 'deux lectures du même objet donnent le MÊME texte');
eq(JSON.stringify(input), snapshot, '…et l’objet donné n’est jamais modifié');
eq(R.resyncSummaryText(undefined), R.resyncSummaryText({}), 'aucun argument et objet vide se lisent pareil (pas de cas spécial caché)');

/* ── 4. LE CHAÎNAGE RÉEL : L’INVENTAIRE JUSQU’À L’ÉCRAN ─────────────────────
   Les phrases ne sont pas réécrites en route : ce que l'inventaire signale
   arrive tel quel dans le compte-rendu, et le défaut (`⚠`) garde son ambre. */
const report = {
  ok: true,
  at: '2026-01-01T00:00:00.000Z',
  reason: '',
  counts: {
    datasetFolders: 2, projectFoldersOnDrive: 3,
    datasetsListedInIndex: 2, projectsListedInIndex: 4,
    datasetsListedHere: 1, projectsListedHere: 2, foldersUnreadable: 0
  },
  recoverable: { copyIds: ['dsA'] },
  issues: [{ kind: 'project-folder-outside-projects', text: 'A project folder sits at the dataset root.' }]
};
const rows = R.resyncReportLines(report);
const warned = rows.filter((l) => R.resyncLineTone(l) === 'warn');
eq(warned, ['⚠ A project folder sits at the dataset root.'], 'le défaut de l’inventaire est la SEULE ligne en ambre (aucune n’est inventée)');
ok(rows.some((l) => l.includes('2 dataset folder(s)')), '…et les chiffres du Drive sont rappelés au-dessus');

const shown = R.resyncSummaryText({
  ok: true, projectsBefore: 2, projectsAfter: 2, projectsInIndex: 4,
  copiesAdopted: 1, lines: rows
});
ok(shown.lines.includes('⚠ A project folder sits at the dataset root.'),
  'la phrase du défaut arrive TELLE QUELLE dans le compte-rendu affiché');
eq(shown.restored, 0, '…sans transformer « rien à récupérer » en reprise');
eq(shown.copies, '1 dataset copy(ies) were re-read from the Drive.', '…et la copie relue est bien comptée');

/* Le cas heureux ne doit pas être muet : « rien ne manque » se dit. */
const quiet = R.resyncSummaryText({ ok: true, lines: R.resyncReportLines({ ok: true, counts: {}, recoverable: {}, issues: [] }) });
eq(quiet.lines.filter((l) => R.resyncLineTone(l) === 'warn'), [], 'aucun défaut : aucune ligne en ambre');
ok(quiet.lines.some((l) => l.includes('No misplaced or incomplete folder found')),
  '…et l’inventaire le dit noir sur blanc (un inventaire muet ne sert à rien)');

/* ── 5. LE BRANCHEMENT (et les deux pièges silencieux) ──────────────────────
   Le panneau peint, il ne décide pas : ses phrases viennent du module pur. Et le
   geste d'App.jsx doit DÉCODER la copie, COMPTER ses échecs, RÉÉCRIRE l'index et
   ne remonter les pages que si quelque chose a bougé. Ces vérifications lisent
   les sources : c'est ce qui empêche la réapparition d'une reprise qui ne fait
   rien en silence. */
has(RESYNC_SRC, 'export const resyncSummaryText', 'le helper du compte-rendu est exporté (vérifiable hors navigateur)');
has(RESYNC_SRC, 'export const resyncLineTone', '…le goût des lignes aussi');
has(PANEL_SRC, "import { resyncLineTone, resyncSummaryText } from '../utils/workspaceResync'",
  'le panneau importe les helpers purs : une seule source pour les phrases');
ok(!PANEL_SRC.includes('project(s) restored in this browser'),
  '…et ne redéfinit AUCUNE phrase du compte-rendu (le panneau peint, il ne décide pas)');
has(PANEL_SRC, 'resyncSummaryText(summary)', 'le compte-rendu affiché vient du helper');
has(PANEL_SRC, 'resyncLineTone(line)', '…et le goût des lignes aussi');

has(SETTINGS_SRC, "import { WorkspaceResyncPanel } from '../WorkspaceResyncPanel'", 'les Réglages importent le panneau');
has(SETTINGS_SRC, '<WorkspaceResyncPanel onResync={onResyncFromDrive} />', '…et le montent avec le geste reçu d’App.jsx');
has(SETTINGS_SRC, 'onResyncFromDrive = null', 'la prop a une valeur par défaut (le panneau ne casse pas sans Drive)');
has(APP_SRC, 'onResyncFromDrive={resyncWorkspaceFromDrive}', 'App.jsx branche le geste sur le module Réglages');

has(APP_SRC, 'await readDatasetCopy(id)', 'la copie d’un dataset est relue par le chemin normal (readDatasetCopy)');
has(APP_SRC, 'const content = parsePayload(copy)',
  'App.jsx DÉCODE la copie avant d’adopter ses projets (le contenu vit dans `payload`, compressé)');
has(APP_SRC, 'if (!content) { copiesFailed.push(String(id)); continue; }',
  '…et une charge illisible est COMPTÉE comme un échec, jamais comme une réussite silencieuse');
has(APP_SRC, 'mergeProjectsFromCloud(content.projects', 'les projets sont adoptés par le chemin de l’ouverture d’un dataset');
has(APP_SRC, 'adoptAllLegacy: true', '…y compris les projets historiques (adoptAllLegacy)');
has(APP_SRC, 'testIds: new Set((content.tests || content.plates || [])',
  '…et les expériences de la copie attribuent ses projets au bon dataset');
has(APP_SRC, 'deleted: content.deletedProjects', '…sans ré-adopter un projet supprimé (les tombes de la copie comptent)');
has(APP_SRC, 'console.warn(\'Resync: the copy of dataset\'', 'un échec par copie est journalisé sans interrompre les suivantes');

has(APP_SRC, 'writeWorkspaceState(buildWorkspaceState(', 'ce qui est adopté REPART vers l’index partagé');
has(APP_SRC, 'datasets: [...(Array.isArray(datasetsList) ? datasetsList : []), ...readDatasetListCache()]',
  '…avec la liste des datasets en UNION (une liste d’écran périmée n’ampute jamais l’index)');
has(APP_SRC, 'What was adopted here could NOT be written back',
  '…et un échec de cette écriture est DIT (l’adoption locale, elle, a bien eu lieu)');
has(APP_SRC, 'if (changed) setWorkspaceResyncNonce((n) => n + 1)',
  'les pages ne sont remontées que si quelque chose a bougé (pas de rendu pour rien)');
has(APP_SRC, 'const projectsAfter = loadProjects(\'\').length', 'le compte-rendu compte les projets du magasin, pas ceux de l’écran');
has(APP_SRC, 'const copyIds = report && report.recoverable && Array.isArray(report.recoverable.copyIds)',
  'les copies à relire sont celles que l’inventaire dit récupérables (aucune liste devinée)');

const BTN = readFileSync('./src/components/WorkspaceResyncPanel.jsx', 'utf8');
has(BTN, '🔄 Resync from Drive', 'le bouton dit ce qu’il fait');
has(BTN, "typeof onResync !== 'function'", '…et se désactive si le geste n’est pas branché (jamais un bouton mort)');
has(BTN, 'catch (err)', 'une exception du geste devient un compte-rendu lisible, pas une page blanche');

/* ── 6. LA TOMBE NE RESSUSCITE PAS (même en republiant l’index) ──────────────
   Le geste republie l’index partagé, et il publie une UNION : la liste de
   l’écran + le cache du navigateur. Or ce cache est LOCAL et peut encore porter
   un dataset que quelqu’un a supprimé depuis — le publier ferait ressusciter un
   dataset supprimé sur TOUS les postes, exactement ce qu’une tombe interdit.
   C’est `isDatasetMirrorDeleted` qui tranche, et le geste le lui demande. */
const MIRROR = await import('./src/utils/driveMirrorStore.js');
const WD = await import('./src/utils/workspaceDrive.js');

ok(MIRROR.isDatasetMirrorDeleted({ tombstones: [{ id: 'dsGone' }] }, { id: 'dsGone' }),
  'une tombe SANS chemin supprime le dataset entier');
ok(!MIRROR.isDatasetMirrorDeleted({ tombstones: [{ id: 'dsGone' }] }, { id: 'dsAlive' }),
  '…et laisse les autres tranquilles');
eq(MIRROR.isDatasetMirrorDeleted({ tombstones: [{ id: 'dsX', path: 'figures' }] }, { id: 'dsX' }), false,
  'une tombe INTERNE (avec chemin) ne supprime pas le dataset');

const union = [{ id: 'dsKept' }, { id: 'dsGone' }];
eq(WD.applyWorkspaceIndex({ datasets: union, mirror: { tombstones: [{ id: 'dsGone' }] } }).map((d) => d.id),
  ['dsKept'], 'l’index publié écarte le dataset supprimé (le miroir fait foi)');
eq(WD.applyWorkspaceIndex({ datasets: union }).map((d) => d.id), ['dsKept', 'dsGone'],
  '…sans le miroir il ne PEUT pas le savoir : d’où le filtre du geste, vérifié ci-dessus');

/* Le seul chemin d’écriture de l’espace de travail rend `null` quand rien n’a pu
   être écrit : l’échec est donc testable, et le geste le teste. */
eq(typeof WD.writeWorkspaceState, 'function', 'l’index s’écrit par l’API de l’espace de travail');
has(APP_SRC, 'if (!published) {', '…et le geste teste le RÉSULTAT de l’écriture (null = non écrit)');
has(APP_SRC, 'writeWorkspaceState(buildWorkspaceState({', '…par le constructeur d’état, pas un JSON bricolé');

console.log(`\n${passed} vérifications passées — « RESYNC FROM DRIVE » : le compte-rendu dit tout, depuis une seule source.\n`);
