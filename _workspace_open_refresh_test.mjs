/* =========================================================================
   _workspace_open_refresh_test.mjs — « LA PAGE S'OUVRE » : L'INDEX EST RELU.

   Le défaut réparé (voir src/utils/workspaceRefresh.js et src/App.jsx) : l'index
   partagé du Drive n'était lu qu'AU DÉMARRAGE et sur le geste explicite
   « Resync from Drive ». Un poste resté ouvert continuait donc d'afficher sa
   liste d'alors — un projet créé, supprimé ou restauré sur un autre poste
   n'apparaissait qu'après un rechargement de l'onglet — alors que la vérité
   était DÉJÀ sur le Drive.

   Ce qui est vérifié ici, sans navigateur :
     • la DÉCISION elle-même, cas par cas : les pages qui montrent les listes
       partagées, le délai d'une minute (bornes comprises), le refus quand le
       Drive n'est pas là ou qu'une relecture est en cours ;
     • les horloges tordues : jamais relu, relu à l'instant, horloge RECULÉE —
       dans le doute on RELIT (la relecture est en lecture seule, se tromper en
       relisant ne coûte rien, se tromper en ne relisant pas laisse l'écran faux) ;
     • la PURETÉ : aucune dépendance, aucun effet de bord, l'argument ressort
       intact ;
     • le BRANCHEMENT RÉEL dans App.jsx : la même porte qu'au démarrage
       (`syncWorkspaceFromDrive`), l'horodatage posé AVANT la lecture, une page
       remontée SEULEMENT si la liste des projets a changé, et aucune écriture —
       ouvrir une page ne réécrit jamais l'index partagé.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const R = await import('./src/utils/workspaceRefresh.js');

const SRC = readFileSync('./src/utils/workspaceRefresh.js', 'utf8');
const APP = readFileSync('./src/App.jsx', 'utf8');

let passed = 0;
const eq = (actual, expected, what) => { assert.deepEqual(actual, expected, what); passed += 1; };
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => ok(src.includes(needle), what);

/* ── 1. LES PAGES QUI MONTRENT CE QUE L'INDEX PORTE ─────────────────────────
   Ce n'est pas « toutes les pages » : chacune est là pour une raison, et une
   page absente ne déclenche jamais de relecture. */
eq(R.OPEN_REFRESH_MODULES, ['projects', 'project-detail', 'settings'],
  'les trois pages qui montrent les listes partagées, et elles seules');
ok(R.openRefreshCovers('projects'), 'la liste des projets (magasin du navigateur) en fait partie');
ok(R.openRefreshCovers('project-detail'), 'la page d’un projet aussi (elle relit le même magasin)');
ok(R.openRefreshCovers('settings'), 'les Réglages aussi (liste des datasets + « Resync from Drive »)');
ok(!R.openRefreshCovers('active-test'), 'une page d’expérience ne fait pas relire le Drive');
ok(!R.openRefreshCovers('notebook'), 'un carnet non plus');
ok(!R.openRefreshCovers(''), 'un module vide ne déclenche rien');
ok(!R.openRefreshCovers(null), 'null non plus');
ok(!R.openRefreshCovers(7), 'un nombre est lu sans lever');
/* Les identifiants ne peuvent pas dériver de l'application : chaque page citée
   est un vrai emplacement de page. */
R.OPEN_REFRESH_MODULES.forEach((id) => has(APP, `pageSlot('${id}'`, `la page « ${id} » existe bien dans App.jsx`));

/* ── 2. LE DÉLAI : UNE MINUTE, BORNES COMPRISES ─────────────────────────────
   Naviguer ne doit pas relire le Drive à chaque clic : c'est la navigation qui
   est fréquente, pas la vérité partagée qui change. */
eq(R.OPEN_REFRESH_MS, 60 * 1000, 'une relecture au plus par minute');
const NOW = 1_800_000_000_000;
const at = (lastAt, extra = {}) => R.shouldRefreshWorkspaceOnOpen({ module: 'projects', lastAt, now: NOW, ...extra });
ok(at(0), 'jamais relu : on relit');
ok(at(NOW - R.OPEN_REFRESH_MS - 1), 'il y a plus d’une minute : on relit');
ok(at(NOW - R.OPEN_REFRESH_MS), 'exactement une minute : on relit (la borne est incluse)');
ok(at(NOW - 10 * R.OPEN_REFRESH_MS), 'il y a longtemps : on relit');
ok(!at(NOW - (R.OPEN_REFRESH_MS - 1)), 'une seconde trop tôt : on attend');
ok(!at(NOW - 1000), 'relu à l’instant : on attend');

/* ── 3. LES TROIS RÈGLES DE REFUS ───────────────────────────────────────────
   Un refus doit être un NON silencieux (rien n'est affiché, rien n'est cassé),
   mais il doit être COMPLET : chaque condition manquante suffit à refuser. */
ok(!R.shouldRefreshWorkspaceOnOpen({ module: 'projects', lastAt: 0, driveReady: false }),
  'sans Drive connecté, on ne relit pas (une relecture muette n’apprend rien)');
ok(!R.shouldRefreshWorkspaceOnOpen({ module: 'projects', lastAt: 0, busy: true }),
  'une relecture déjà en cours : on n’en lance pas une seconde');
ok(!R.shouldRefreshWorkspaceOnOpen({ module: 'dashboard', lastAt: 0 }),
  'une page qui ne montre rien de partagé ne fait pas relire le Drive');
ok(R.shouldRefreshWorkspaceOnOpen({ module: 'projects' }),
  'les valeurs par défaut suffisent : un appel sans horodatage relit');

/* ── 4. LES HORLOGES TORDUES ────────────────────────────────────────────────
   Une horloge qui recule ne doit pas figer la relecture pour toujours : dans le
   doute on RELIT, parce que relire est sans conséquence et ne pas relire laisse
   l'écran faux. */
ok(at(NOW + 5000), 'horodatage dans le FUTUR (horloge reculée) : on relit');
ok(at('n’importe quoi'), 'horodatage illisible : on relit');
ok(at(NaN), 'NaN : on relit');
eq(R.openRefreshWaitMs({ lastAt: 0, now: NOW }), 0, 'jamais relu : aucune attente');
eq(R.openRefreshWaitMs({ lastAt: NOW, now: NOW }), R.OPEN_REFRESH_MS, 'relu à l’instant : la minute entière reste');
eq(R.openRefreshWaitMs({ lastAt: NOW - R.OPEN_REFRESH_MS / 2, now: NOW }), R.OPEN_REFRESH_MS / 2,
  'à mi-chemin : la moitié restante');
eq(R.openRefreshWaitMs({ lastAt: NOW - 10 * R.OPEN_REFRESH_MS, now: NOW }), 0, 'en retard : aucune attente');
eq(R.openRefreshWaitMs({ lastAt: NOW + 5000, now: NOW }), 0, 'horloge reculée : aucune attente imposée');
eq(R.openRefreshWaitMs({ lastAt: 'illisible', now: NOW }), 0, 'horodatage illisible : aucune attente');

/* ── 5. LA PURETÉ ───────────────────────────────────────────────────────────
   La décision ne doit RIEN lire ni RIEN écrire : c'est ce qui permet de la
   vérifier sans navigateur, et de la réutiliser sans crainte. */
ok(!/^\s*import\s/m.test(SRC), 'le module n’importe rien (ni Drive, ni magasin, ni horloge)');
ok(!/localStorage|sessionStorage|document\.|fetch\(/m.test(SRC), '…et ne touche à aucun stockage ni au réseau');
const arg = { module: 'projects', lastAt: 0, now: NOW };
eq(R.shouldRefreshWorkspaceOnOpen(arg), R.shouldRefreshWorkspaceOnOpen(arg),
  'deux appels sur le même argument donnent la même réponse');
eq(arg, { module: 'projects', lastAt: 0, now: NOW }, 'l’argument ressort intact');
eq(R.shouldRefreshWorkspaceOnOpen(), false, 'sans argument : aucun module, donc pas de relecture (jamais d’exception)');

/* ── 6. LE BRANCHEMENT RÉEL DANS App.jsx ────────────────────────────────────
   Le geste vit dans App.jsx : la décision pure ne sert à rien si personne ne la
   demande, si l'horodatage est posé APRÈS la lecture (deux navigations
   lanceraient deux relectures) ou si la page est remontée sans raison. */
has(APP, "import { shouldRefreshWorkspaceOnOpen } from './utils/workspaceRefresh';",
  'App.jsx demande la décision au module pur');
has(APP, 'shouldRefreshWorkspaceOnOpen({', '…et l’appelle avec ses entrées');
has(APP, 'module: currentModule,', 'la page affichée entre dans la décision');
has(APP, 'lastAt: workspaceOpenAtRef.current,', 'l’horodatage de la dernière relecture aussi');
has(APP, 'driveReady: cloudBackendAvailable(),', '…et la disponibilité du Drive');
has(APP, 'busy: workspaceOpenBusyRef.current', '…et la relecture en cours');

/* ⚠ Le geste est délimité AVANT d'être mesuré : `const projectsBefore = …`
   existe aussi dans le geste « Resync from Drive », et comparer les premières
   occurrences des deux gestes ne dirait rien sur l'ORDRE des temps de celui-ci. */
const sliceStart = APP.indexOf('/* ── LA PAGE S\'OUVRE');
const sliceEnd = APP.indexOf('}, [currentModule, syncWorkspaceFromDrive]);');
const slice = APP.slice(sliceStart, sliceEnd);
ok(sliceStart > 0 && sliceEnd > sliceStart && slice.length > 400, 'le geste est bien délimité dans App.jsx');

const stampAt = slice.indexOf('workspaceOpenAtRef.current = Date.now();');
const beforeAt = slice.indexOf("const projectsBefore = loadProjects('').length;");
const chainAt = slice.indexOf('.then((adoptedNow) => {');
ok(stampAt > 0 && beforeAt > 0 && chainAt > 0, 'les trois temps du geste sont présents');
ok(stampAt < beforeAt && beforeAt < chainAt,
  'l’horodatage est posé AVANT la lecture (deux navigations rapprochées ne lisent pas deux fois)');

ok(/syncWorkspaceFromDrive\(\)\s*\.then\(\(adoptedNow\)/.test(slice),
  'la relecture passe par la MÊME porte qu’au démarrage (tombes, levées, projets de l’index, datasets)');
has(APP, "if (loadProjects('').length !== projectsBefore) setWorkspaceResyncNonce((n) => n + 1);",
  'la page n’est remontée QUE si la liste des projets a réellement changé');
ok(slice.includes('if (!adoptedNow) return;'), 'rien d’adopté (pas d’index lu) : rien n’est remonté');
ok(slice.includes('.finally(() => { workspaceOpenBusyRef.current = false; });'),
  'la relecture retombe toujours (sinon plus aucune page ne relirait jamais)');
has(APP, '}, [currentModule, syncWorkspaceFromDrive]);', 'la relecture suit la page affichée');

ok(!slice.includes('writeWorkspaceState('), 'ouvrir une page n’écrit JAMAIS l’index partagé');
ok(!slice.includes('writeDatasetCopy('), '…ni une copie de dataset');
ok(!slice.includes('uploadWorkspaceFile('), '…ni un fichier sur le Drive');

console.log(`\n${passed} vérifications passées — « LA PAGE S'OUVRE » : l'index partagé est relu, et rien n'est écrit.\n`);



