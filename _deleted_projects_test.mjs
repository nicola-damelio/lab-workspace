/* =========================================================================
   _deleted_projects_test.mjs — UN PROJET SUPPRIMÉ RESTE SUPPRIMÉ.

   Le défaut réparé : un projet d'un dataset vit à DEUX endroits — dans le
   navigateur (localStorage `labWorkspace_projects`) et dans le document du
   dataset (payload cloud / sauvegarde HTML, clé `projects`). « Delete »
   n'effaçait le projet que du navigateur : à la réouverture du dataset,
   mergeProjectsFromCloud ré-adoptait la copie du payload et le projet
   RÉAPPARAISSAIT — sur le poste qui venait de le supprimer comme sur les
   autres.

   La réparation (src/utils/projectTombstones.js) est un module PUR : la
   suppression laisse une « pierre tombale » (id + dataset + date) que toute
   lecture, toute écriture et toute fusion appliquent. C'est ce qui est
   vérifié ici avec le module RÉEL, sur les pièges qui rendraient la
   réparation nuisible plutôt qu'utile :
     • un projet d'un AUTRE dataset ne doit pas être emporté par une tombe qui
       porte le même id (deux datasets peuvent naître de la même sauvegarde) ;
     • deux tombes de même identité n'en font qu'une (la plus récente gagne) ;
     • la liste est bornée, mais une suppression récente n'est jamais oubliée ;
     • quand le DATASET est supprimé, ses tombes partent avec lui (sinon un
       dataset recréé avec le même id n'afficherait plus jamais ses projets) ;
     • et la page projet / App.jsx appliquent réellement tout cela.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const T = await import('./src/utils/projectTombstones.js');
/* Les branchements sont vérifiés sur le code réel des pages : une fonction
   juste que PERSONNE n'appelle ne répare rien. */
const PROJECTS = readFileSync('./src/components/AppModules/projectsModule.jsx', 'utf8');
const DETAIL = readFileSync('./src/components/AppModules/projectDetailModule.jsx', 'utf8');
const APP = readFileSync('./src/App.jsx', 'utf8');

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, what);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => ok(src.includes(needle), what);

/* ── 1. La tombe : identité, propreté, unicité ───────────────────────────── */
eq(T.tombstoneKey({ id: 'prj_1', datasetId: 'ds1' }), 'ds1::prj_1',
  'l’identité d’un projet supprimé est « dataset::id »');
eq(T.tombstoneKey({ id: 'prj_1' }), '::prj_1',
  '…et un projet sans dataset (historique) garde une identité valable');
eq(T.normalizeTombstones(['prj_1', '', null, {}, '   ']).map((t) => t.id), ['prj_1'],
  'une tombe écrite par une ancienne version (id seul) est comprise, un id vide est écarté');
eq(T.normalizeTombstones([[{ id: 'prj_7', datasetId: 'ds1', deletedAt: 3 }]]).map((t) => t.id), ['prj_7'],
  'une liste imbriquée (payload abîmé) est comprise : une suppression ne se perd JAMAIS en silence');
eq(T.normalizeTombstones([{ id: 'prj_1' }])[0], { id: 'prj_1', datasetId: '', deletedAt: 0 },
  'une tombe est toujours { id, datasetId, deletedAt } (aucun champ manquant)');
const twice = T.normalizeTombstones([
  { id: 'prj_1', datasetId: 'ds1', deletedAt: 100 },
  { id: 'prj_1', datasetId: 'ds1', deletedAt: 250 }
]);
eq(twice.length, 1, 'deux tombes de même identité n’en font qu’une');
eq(twice[0].deletedAt, 250, '…et c’est la suppression la PLUS RÉCENTE qui compte');
eq(T.normalizeTombstones([{ id: 'a', deletedAt: 1 }, { id: 'b', deletedAt: 9 }]).map((t) => t.id), ['b', 'a'],
  'la plus récente est en tête');
eq(T.normalizeTombstones(T.normalizeTombstones(twice)), twice, 'la normalisation est idempotente');
eq(T.MAX_TOMBSTONES, 500, 'la liste est bornée (un localStorage ne grossit pas indéfiniment)');
const many = T.normalizeTombstones(Array.from({ length: T.MAX_TOMBSTONES + 40 },
  (_, i) => ({ id: `prj_${i}`, datasetId: 'ds1', deletedAt: i })));
eq([many.length, many[0].id], [T.MAX_TOMBSTONES, `prj_${T.MAX_TOMBSTONES + 39}`],
  'ce sont les suppressions les plus récentes qui sont conservées');

/* ── 2. Ce projet est-il supprimé ? ──────────────────────────────────────── */
const TOMBS = [{ id: 'prj_1', datasetId: 'ds1', deletedAt: 10 }];
eq(T.isProjectDeleted({ id: 'prj_1', datasetId: 'ds1' }, TOMBS), true, 'le projet supprimé est reconnu');
eq(T.isProjectDeleted({ id: 'prj_1', datasetId: 'ds2' }, TOMBS), false,
  'la MÊME id dans un autre dataset reste un projet vivant (copie d’une sauvegarde)');
eq(T.isProjectDeleted({ id: 'prj_2', datasetId: 'ds1' }, TOMBS), false, 'un autre projet n’est pas emporté');
eq(T.isProjectDeleted({ id: 'prj_1', datasetId: 'ds1' }, []), false, 'sans tombe, aucun projet n’est supprimé');
eq(T.isProjectDeleted({ datasetId: 'ds1' }, TOMBS), false, 'un projet sans id n’est jamais filtré');
eq(T.isProjectDeleted({ id: 'prj_1', datasetId: 'ds2' }, [{ id: 'prj_1' }]), true,
  'une tombe SANS dataset (suppression hors dataset) supprime cet id partout');
eq(T.isProjectDeleted({ id: 'prj_1' }, TOMBS), true,
  'un projet historique (sans dataset) est supprimé par la tombe de son id — c’est le même projet');

/* ── 3. Filtrer une liste : la copie locale du projet disparaît ──────────── */
const LIST = [
  { id: 'prj_1', name: 'Pepper viruses', datasetId: 'ds1' },
  { id: 'prj_2', name: 'Aphids', datasetId: 'ds1' },
  { id: 'prj_1', name: 'Pepper viruses', datasetId: 'ds2' }
];
eq(T.withoutDeletedProjects(LIST, TOMBS).map((p) => `${p.datasetId}/${p.id}`), ['ds1/prj_2', 'ds2/prj_1'],
  'seule la copie du projet supprimé est effacée (l’homonyme d’un autre dataset survit)');
eq(T.withoutDeletedProjects(LIST, []), LIST, 'sans tombe, la liste est rendue telle quelle');
eq(T.withoutDeletedProjects(null, TOMBS), [], 'une liste absente ne fait pas échouer la lecture');
eq(T.deletedProjectIds(TOMBS).has('prj_1'), true, 'les ids supprimés savent se résumer en Set');

/* ── 4. Ajouter une tombe + la transporter dans le payload du dataset ────── */
const tomb1 = T.addTombstone([], { id: 'prj_1', datasetId: 'ds1' }, 42);
eq(tomb1, [{ id: 'prj_1', datasetId: 'ds1', deletedAt: 42 }],
  'supprimer un projet note son id, son dataset et l’instant');
eq(T.addTombstone(tomb1, { id: 'prj_2', datasetId: 'ds1' }, 50).map((t) => t.id), ['prj_2', 'prj_1'],
  'la suppression suivante vient en tête (la plus récente d’abord)');
eq(T.addTombstone(tomb1, { datasetId: 'ds1' }), tomb1, 'un projet sans id ne crée pas de tombe');
eq(T.mergeTombstones(tomb1, [{ id: 'prj_9', datasetId: 'ds2' }, { id: 'prj_1', datasetId: 'ds1' }])
  .map((t) => t.id).sort(), ['prj_1', 'prj_9'],
  'les tombes de ce navigateur + celles du payload n’en font qu’une liste');
eq(T.tombstonesForDataset([{ id: 'prj_9', deletedAt: 5 }], 'ds2')[0].datasetId, 'ds2',
  'une tombe sans dataset portée par un payload appartient au dataset qui l’a écrite');
eq(T.tombstonesForDataset([{ id: 'prj_9', datasetId: 'ds1' }], 'ds2')[0].datasetId, 'ds1',
  '…et une tombe qui nomme déjà son dataset n’est pas réattribuée');

/* ── 5. Dataset supprimé : ses tombes partent avec lui ───────────────────── */
const mixed = [
  { id: 'prj_1', datasetId: 'ds1', deletedAt: 1 },
  { id: 'prj_2', datasetId: 'ds2', deletedAt: 2 },
  { id: 'prj_3', datasetId: '', deletedAt: 3 }
];
eq(T.withoutDatasetTombstones(mixed, 'ds1').map((t) => t.id), ['prj_3', 'prj_2'],
  'supprimer un dataset retire ses tombes (un dataset recréé doit revoir ses projets)');
ok(T.withoutDatasetTombstones(mixed, 'ds1').some((t) => t.id === 'prj_3'),
  '…mais une tombe sans dataset (suppression hors dataset) est conservée : elle vaut partout');

/* ── 6. LE SCÉNARIO RÉEL, bout en bout ────────────────────────────────────
      Un dataset ouvert, son payload porteur du projet ; suppression sur ce
      poste, puis réouverture (payload rechargé, inchangé : c'est LÀ que le
      projet réapparaissait). */
const DS = 'ds_lab';
const payload = [
  { id: 'prj_1', name: 'Pepper viruses', datasetId: DS },
  { id: 'prj_2', name: 'Aphids', datasetId: DS }
];
let cache = [...payload];
/* addTombstone rend une LISTE de tombes : on la donne telle quelle à la
   fusion (c'est ce que fait projectsModule.recordProjectDeletion). */
cache = T.withoutDeletedProjects(cache, T.mergeTombstones([], T.addTombstone([], cache[0], 1)));
eq(cache.map((p) => p.id), ['prj_2'], 'la copie locale du projet supprimé est effacée');

const carried = T.tombstonesForDataset(T.addTombstone([], payload[0], 1), DS);
const adopted = T.mergeTombstones([], carried);
eq(T.withoutDeletedProjects(payload, adopted).map((p) => p.id), ['prj_2'],
  'le payload rechargé à la réouverture du dataset ne ressuscite PAS le projet');
eq(T.withoutDeletedProjects(payload, T.mergeTombstones(adopted, [])).map((p) => p.id), ['prj_2'],
  'et rejouer la fusion (autre poste, autre ouverture) ne le ramène pas non plus');
eq(T.withoutDeletedProjects(payload, T.withoutDatasetTombstones(adopted, DS)).map((p) => p.id), ['prj_1', 'prj_2'],
  'à l’inverse, supprimer le DATASET libère ses projets (sa tombe part avec lui)');

/* ── 7. Les pages appliquent réellement la règle ────────────────────────── */
has(DETAIL, 'recordProjectDeletion(project);',
  'la page projet note la suppression avant d’enregistrer la liste restante');
has(DETAIL, 'import { loadProjects, saveProjects, saveProjectsChecked, lightenProjectForStorage, recordProjectDeletion, loadPublications',
  '…en important la fonction de projectsModule');
has(PROJECTS, 'recordProjectDeletion(target || { id, datasetId: activeProjectDataset });',
  'la liste des projets note la suppression avec le dataset du projet');
has(PROJECTS, 'const live = withoutDeletedProjects(Array.isArray(list) ? list : [], readDeletedProjects());',
  'écrire les projets écarte toute copie d’un projet supprimé (dernier rempart)');
has(PROJECTS, 'const all = withoutDeletedProjects(readRawProjects(), readDeletedProjects());',
  '…et lire les projets aussi');
has(PROJECTS, 'const tombstones = adoptDeletedProjects(opts.deleted, datasetId);',
  'la fusion d’un payload commence par adopter les suppressions qu’il porte');
has(PROJECTS, 'if (isProjectDeleted(p, tombstones)) { changed = true; return; }',
  '…puis la copie locale d’un projet supprimé est effacée de la fusion');
has(PROJECTS, 'if (isProjectDeleted(p, tombstones)) return; // supprimé : jamais ré-adopté',
  '…et la copie du payload n’est JAMAIS ré-adoptée (c’est là que le projet revenait)');
has(PROJECTS, 'writeDeletedProjects(withoutDatasetTombstones(readDeletedProjects(), datasetId));',
  'supprimer un dataset efface aussi ses tombes');
has(APP, 'deletedProjects: loadDeletedProjects()',
  'le payload du dataset (cloud / sauvegarde HTML) transporte les suppressions');
has(APP, 'adoptDeletedProjects(s.deletedProjects);',
  'restaurer une sauvegarde HTML adopte ses suppressions AVANT de réenregistrer les projets');
has(APP, 'deleted: s.deletedProjects',
  '…et la restauration cloud aussi (projet supprimé absent des deux côtés)');

console.log(`✅ ${passed} tests passés (projets supprimés : rien ne ressuscite)`);