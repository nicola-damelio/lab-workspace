/* =========================================================================
   _project_store_guard_test.mjs — UN PROJET NE DISPARAÎT QUE S'IL A ÉTÉ SUPPRIMÉ.

   LE RAPPORT RÉPARÉ (critique) : « A user created a new project and then tried
   to delete it. I received the confirmation prompt and accepted the deletion.
   Now all of my projects have disappeared from the program, even though they
   are still present in Google Drive. »

   La cause de fond : le magasin du navigateur (`labWorkspace_projects`) est la
   SEULE copie que le programme relit, et ses trois fonctions d'écriture
   reçoivent un TABLEAU de l'extérieur (`saveProjects` — l'état d'une page —,
   `saveProjectsRescued` — le même, allégé —, `mergeProjectsFromCloud` — une
   copie du payload). Un tableau plus court que le magasin pour une raison
   AUTRE qu'une suppression (état périmé après un `await`, portée de dataset,
   filtre par scientifique, payload partiel, sauvegarde restaurée…) EFFAÇAIT
   des projets que personne n'avait supprimés — et le Drive les gardait, d'où
   « disparus du programme mais toujours là sur le Drive ».

   La réparation : une suppression se reconnaît à sa TOMBE (« Delete project »
   l'écrit AVANT la liste). Ce qui manque à une écriture sans tombe est REMIS.
   Vérifié ici sur le module RÉEL (src/utils/projectTombstones.js) et sur le
   câblage réel des pages (projectsModule.jsx, App.jsx, workspaceDrive.js) —
   une règle juste que PERSONNE n'appelle ne répare rien.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const T = await import('./src/utils/projectTombstones.js');
const PROJECTS = readFileSync('./src/components/AppModules/projectsModule.jsx', 'utf8');
const APP = readFileSync('./src/App.jsx', 'utf8');
const WORKSPACE = readFileSync('./src/utils/workspaceDrive.js', 'utf8');

let passed = 0;
const eq = (actual, expected, what) => { assert.deepEqual(actual, expected, what); passed += 1; };
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => ok(src.includes(needle), what);
const gone = (src, needle, what) => ok(!src.includes(needle), what);

/* ── 1. LA RÈGLE : une écriture ne perd que ce qui a une tombe ────────────── */
const A = { id: 'prj_a', name: 'Aphids', datasetId: 'ds1' };
const B = { id: 'prj_b', name: 'Bees', datasetId: 'ds1' };
const C = { id: 'prj_c', name: 'Cicadas', datasetId: 'ds2' };

eq(T.untombstonedDrops([A, B, C], [A, C], []).map((p) => p.id), ['prj_b'],
  'le projet absent de la liste ET sans tombe est repéré — les autres non');
eq(T.protectUntombstoned([A, B, C], [A, C], []).list.map((p) => p.id), ['prj_a', 'prj_c', 'prj_b'],
  'la liste écrite garde le projet : rien ne disparaît sans tombe');
eq(T.protectUntombstoned([A, B, C], [A, C], []).rescued.map((p) => p.id), ['prj_b'],
  '…et le rapport dit lequel a été remis (au lieu de le taire)');
eq(T.protectUntombstoned([A, B], [], []).list.map((p) => p.id), ['prj_a', 'prj_b'],
  'le scénario même du rapport — une liste VIDE — n’efface plus rien');
eq(T.protectUntombstoned([A, B], [A], [{ id: 'prj_b', datasetId: 'ds1', deletedAt: 5 }]).list.map((p) => p.id), ['prj_a'],
  'une VRAIE suppression (tombe) passe : le projet reste dehors');
eq(T.protectUntombstoned([A, B], [A], [{ id: 'prj_b', datasetId: 'ds2', deletedAt: 5 }]).rescued.map((p) => p.id), ['prj_b'],
  'la tombe d’un AUTRE dataset ne peut pas faire disparaître ce projet-ci');
eq(T.protectUntombstoned([A, B], [A], ['prj_b']).list.map((p) => p.id), ['prj_a'],
  'une tombe écrite par une version ancienne (id seul) reste comprise');
eq(T.untombstonedDrops([A, B], ['prj_a', 'prj_b'], []).length, 0, 'une liste complète ne remet rien (aucun bruit)');
eq(T.untombstonedDrops([{ name: 'sans id' }], [], []).length, 0, 'un projet sans id n’est pas « remis » (il n’est pas identifiable)');
eq(T.protectUntombstoned([C], [], []).rescued.map((p) => p.id), ['prj_c'], 'un projet d’UN AUTRE dataset est protégé comme les autres');
eq(T.untombstonedDrops([A, B], [A, A, B], []).length, 0, 'aucun doublon n’entre par ce chemin non plus');

/* ── 2. LE CÂBLAGE : le verrou est DANS l'écriture, pas dans une page ────── */
has(PROJECTS, 'protectUntombstoned(readRawProjects(), incoming, tombstones)',
  'le magasin REFUSE de perdre un projet sans tombe (writeRawProjects — l’écriture unique)');
has(PROJECTS, 'export const takeUntombstonedRescue = () => {',
  '…et le geste est rapporté à l’appelant (jamais silencieux)');
gone(PROJECTS, 'const live = withoutDeletedProjects(Array.isArray(list) ? list : [], readDeletedProjects());',
  'l’ancienne écriture — qui perdait tout ce qui manquait — a disparu');
has(PROJECTS, 'writeRawProjects(kept, { allowDrops: true });',
  'seule la suppression d’un DATASET laisse partir ses projets (allowDrops, seul appelant légitime)');
has(PROJECTS, 'were about to disappear WITHOUT being deleted',
  'l’écran DIT qu’une écriture a failli effacer des projets, et lesquels');
has(PROJECTS, 'recordProjectDeletion(target || { id, datasetId: activeProjectDataset });',
  'la suppression, elle, note toujours sa tombe AVANT d’écrire la liste (c’est ce qui la distingue d’une perte)');

/* ── 3. LA RÉCUPÉRATION : les projets du Drive reviennent ───────────────── */
has(WORKSPACE, 'projects: parsed ? parsed.projects : [],',
  'adoptWorkspaceState rend les projets portés par _workspace/state.json');
has(PROJECTS, 'export const adoptWorkspaceProjects = (payloadProjects) => {',
  '…et les projets perdus par ce poste peuvent être RÉ-ADOPTÉS');
has(PROJECTS, 'if (adopted) writeRawProjects(Array.from(byId.values()));',
  '…par une fusion en AJOUT SEUL (rien n’est écrasé ni effacé)');
has(PROJECTS, 'if (isProjectDeleted(p, tombstones)) return;   // supprimé : jamais ré-adopté',
  '…qui n’annule JAMAIS une suppression (une tombe reste une tombe)');
has(APP, ', adoptWorkspaceProjects, loadRevivedProjects, adoptRevivedProjects, reviveDeletedProject,',
  'App.jsx importe le ré-adoptant (et le geste de retour, qui lève la tombe)');
has(APP, 'try { adoptWorkspaceProjects(adopted.projects); } catch { /* magasin indisponible */ }',
  '…et l’appelle au démarrage, juste après avoir adopté les tombes');

console.log(`_project_store_guard_test.mjs — ${passed} assertions OK (un projet ne disparaît que s’il a été SUPPRIMÉ)`);
