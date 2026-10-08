/* =========================================================================
   _load_html_projects_test.mjs — « J'OUVRE UN NOUVEAU DATASET, JE CHARGE LA
   DERNIÈRE SAUVEGARDE : LES EXPÉRIENCES REVIENNENT, LES PROJETS NON. »

   Le défaut réparé, tel qu'il a été rapporté. Les expériences d'une sauvegarde
   reviennent (elles vivent dans l'ÉTAT du dataset, donc elles suivent le dataset
   où l'import écrit) ; les PROJETS, non — ils sont ÉTIQUETÉS par le dataset qui
   les a vus naître (`datasetId`) et `loadProjects()` ne rend que ceux du dataset
   OUVERT. Deux causes, l'une aggravant l'autre :

     • le fichier ne disait pas d'où il venait, donc « Import everything »
       recréait un dataset NEUF à chaque restauration ;
     • les projets du fichier étaient écrits TELS QUELS (`saveProjects`), avec
       l'étiquette de leur dataset D'ORIGINE : présents sur ce poste, mais
       invisibles là où la restauration venait d'écrire.

   Ce qui est vérifié ici, sur le code RÉEL :
     1. le fichier dit d'où il vient (`dataBlob.datasetId`) et, à défaut, ses
        projets le disent (`fileDatasetIdOf` — sans jamais deviner) ;
     2. la décision d'adoption est PURE et rejouée telle quelle
        (`planProjectImport` : adoption, ajout qui n'écrase rien, tombe lue sur
        l'étiquette D'ORIGINE, fichier vide ou entièrement tombstoned qui
        n'efface rien, une seule copie par projet) ;
     3. le scénario complet, en clair : des projets nés dans `ds_lab`, une
        sauvegarde prise là, un dataset NEUF — et les projets VISIBLES après la
        restauration (écrits tels quels, ils ne l'étaient pas : contre-épreuve) ;
     4. les branchements : `confirmLoad` n'écrit plus la liste par
        `saveProjects`, un refus du magasin se dit dans les DEUX modes, et
        `filterLoadState` conserve bien l'id du dataset de destination.

   Suite : `node _load_html_projects_test.mjs` (reprise par _run_all.cjs).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

/* Les sources de src/ s'importent SANS extension (c'est Vite qui complète, pas
   Node) : même crochet que _deleted_projects_test.mjs. projectImport.js
   n'importe que projectTombstones.js — tout est pur, rien de React. */
register('./_esm_test_hook.mjs', import.meta.url);

const P = await import('./src/utils/projectImport.js');

const APP = readFileSync('./src/App.jsx', 'utf8');
const PROJECTS = readFileSync('./src/components/AppModules/projectsModule.jsx', 'utf8');
const SEL = readFileSync('./src/utils/loadSelection.js', 'utf8');

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => ok(src.includes(needle), what);

/* Le dataset de DESTINATION d'un fichier, tel que loadHTML le relit : ce que le
   fichier dit de lui-même, sinon l'étiquette de ses projets. */
const targetIdOf = (dataBlob, fileProjects) => (dataBlob && dataBlob.datasetId) || P.fileDatasetIdOf(fileProjects);

/* « QUELS PROJETS CE DATASET MONTRE », telles que les lit loadProjects() :
   même règle (datasetId égal), tombes déjà appliquées par le plan. */
const visibleIn = (store, datasetId) => (Array.isArray(store) ? store : [])
  .filter((p) => p && String(p.datasetId) === String(datasetId))
  .map((p) => p.id);

/* ── 1. D'où vient ce fichier ? ────────────────────────────────────────────
      Les sauvegardes récentes le disent elles-mêmes (`dataBlob.datasetId`, à
      côté du titre et de la date) ; les anciennes ne le disent pas — et c'est
      là que la restauration recréait un dataset neuf à chaque fois. */ 
eq(targetIdOf({ datasetId: 'ds_lab' }, [{ id: 'prj_1', datasetId: 'ds_other' }]), 'ds_lab',
  'un fichier qui dit son dataset l’emporte sur ce que disent ses projets');
eq(targetIdOf({ datasetId: '' }, [{ id: 'prj_1', datasetId: 'ds_lab' }]), 'ds_lab',
  'un fichier qui ne le dit pas tient son origine de ses PROJETS (sauvegarde ancienne)');
eq(P.fileDatasetIdOf([]), '', 'un fichier sans projet ne désigne aucun dataset');
eq(P.fileDatasetIdOf(null), '', '…et une liste absente ne fait pas échouer la relecture');
eq(P.fileDatasetIdOf([{ id: 'prj_1' }, { id: 'prj_2' }]), '',
  'des projets historiques (sans étiquette) ne désignent aucun dataset — on ne devine pas');
eq(P.fileDatasetIdOf([{ id: 'prj_1', datasetId: 'ds_lab' }, { id: 'prj_2', datasetId: '' }]), 'ds_lab',
  'un projet sans étiquette ne brouille pas l’origine du fichier');
eq(P.fileDatasetIdOf([{ id: 'prj_1', datasetId: 'ds_lab' }, { id: 'prj_2', datasetId: 'ds_other' }]), '',
  'deux origines dans le même fichier : AUCUNE n’est choisie au hasard');

/* ── 2. LA DÉCISION, rejouée sur le module pur ─────────────────────────────
      `planProjectImport` ne touche à rien : il rend la liste à écrire, les
      projets adoptés et ceux qu'une tombe a écartés. C'est donc vérifiable ici,
      sans navigateur — ce qui est la raison d'être de ce module. */
const FILE = [
  { id: 'prj_1', name: 'Pepper viruses', datasetId: 'ds_lab' },
  { id: 'prj_2', name: 'Aphids', datasetId: 'ds_lab' }
];

/* ① L'adoption : le cœur de la réparation. */
const adopt = P.planProjectImport({
  store: [], tombstones: [], fileProjects: FILE, targetDatasetId: 'ds_new', replace: true
});
eq(adopt.adopted.map((p) => `${p.datasetId}/${p.id}`), ['ds_new/prj_1', 'ds_new/prj_2'],
  'les projets du fichier sont ADOPTÉS par le dataset qui les reçoit (ils prennent SON étiquette)');
eq(adopt.list, adopt.adopted, 'le magasin étant vide, la liste à écrire est exactement celle des adoptés');
eq(adopt.skippedDeleted, [], 'aucun projet écarté : il n’y a aucune tombe');
eq(adopt.target, 'ds_new', 'le plan dit où il a écrit');

/* ② Une seule copie par projet : l'ancienne étiquette est REMPLACÉE, jamais
      doublée (sinon la copie périmée reviendrait à la faveur d'un tri). */
const replaced = P.planProjectImport({
  store: [{ id: 'prj_1', name: 'Pepper viruses', datasetId: 'ds_lab' }],
  tombstones: [], fileProjects: [{ id: 'prj_1', name: 'Pepper viruses', datasetId: 'ds_lab' }],
  targetDatasetId: 'ds_new', replace: true
});
eq(replaced.list.map((p) => `${p.datasetId}/${p.id}`), ['ds_new/prj_1'],
  'le magasin ne garde qu’UNE copie par projet (la copie d’origine est remplacée)');

/* ③ Remplacer = le fichier est la nouvelle liste DE CE DATASET, et de lui seul. */
const remplacer = P.planProjectImport({
  store: [
    { id: 'prj_9', name: 'Other dataset project', datasetId: 'ds_other' },
    { id: 'prj_1', name: 'Old copy of this dataset', datasetId: 'ds_new' }
  ],
  tombstones: [], fileProjects: FILE, targetDatasetId: 'ds_new', replace: true
});
eq(remplacer.list.map((p) => `${p.datasetId}/${p.id}`), ['ds_other/prj_9', 'ds_new/prj_1', 'ds_new/prj_2'],
  'remplacer : les projets des AUTRES datasets restent en place, un projet de CE dataset absent du fichier s’en va');

/* ④ Ajouter = on n'ajoute que ce qui manque ; ce que le dataset a DÉJÀ garde SA
      version (le travail fait ici n'est pas écrasé par une vieille sauvegarde). */
const ajouter = P.planProjectImport({
  store: [{ id: 'prj_1', name: 'Pepper viruses (edited here)', datasetId: 'ds_new' }],
  tombstones: [], fileProjects: FILE, targetDatasetId: 'ds_new', replace: false
});
eq(ajouter.adopted.map((p) => p.id), ['prj_2'],
  'ajouter : seul le projet qui manquait est adopté');
eq(ajouter.list.map((p) => p.name), ['Pepper viruses (edited here)', 'Aphids'],
  '…et la version du dataset reste intacte, à sa place (aucun écrasement)');

/* ⑤ LA TOMBE SE LIT SUR L'ÉTIQUETTE D'ORIGINE — l'ordre est délibéré : une fois
      le projet ré-étiqueté, sa tombe (posée sous son ANCIEN dataset) ne le
      reconnaîtrait plus, et la restauration le RESSUSCITERAIT. C'est le piège
      exact de « Import everything » sur un projet supprimé. */
const TOMB = [{ id: 'prj_1', datasetId: 'ds_lab', deletedAt: 10 }];
const mort = P.planProjectImport({
  store: [], tombstones: TOMB, fileProjects: FILE, targetDatasetId: 'ds_new', replace: true
});
eq(mort.adopted.map((p) => p.id), ['prj_2'], 'un projet supprimé n’est PAS ré-adopté');
eq(mort.skippedDeleted.map((p) => p.id), ['prj_1'],
  '…et il est RENDU à l’appelant (une restauration muette laisserait croire à une panne)');
eq(visibleIn(mort.list, 'ds_new'), ['prj_2'],
  'le projet supprimé ne réapparaît pas, ré-étiqueté, dans le dataset qui reçoit');

/* ⑥ Une tombe d'un AUTRE dataset ne supprime pas ce projet-ci (même id, autre
      dataset) : la règle d'identité est celle de isProjectDeleted. */
const jumeau = P.planProjectImport({
  store: [], tombstones: [{ id: 'prj_1', datasetId: 'ds_other', deletedAt: 5 }],
  fileProjects: [{ id: 'prj_1', name: 'Pepper viruses', datasetId: 'ds_lab' }],
  targetDatasetId: 'ds_new', replace: true
});
eq(jumeau.adopted.map((p) => p.id), ['prj_1'],
  'la suppression d’un homonyme d’un autre dataset ne supprime pas ce projet-ci');

/* ⑦ UN FICHIER QUI N'APPORTE RIEN N'EFFACE RIEN. Deux temps : le plan n'adopte
      aucun projet, et le module n'écrit pas (le second est ce qui protège le
      magasin — vérifié aussi sur la source, plus bas, à l'étape 4). */
const AUTRE = [{ id: 'prj_9', name: 'Other dataset project', datasetId: 'ds_other' }];
const vide = P.planProjectImport({
  store: AUTRE, tombstones: [], fileProjects: [], targetDatasetId: 'ds_new', replace: true
});
eq(vide.adopted, [], 'un élément « Projets » VIDE n’adopte rien…');
const tousMorts = P.planProjectImport({
  store: AUTRE,
  tombstones: [{ id: 'prj_1', datasetId: 'ds_lab', deletedAt: 1 }, { id: 'prj_2', datasetId: 'ds_lab', deletedAt: 2 }],
  fileProjects: FILE, targetDatasetId: 'ds_new', replace: true
});
eq(tousMorts.adopted, [], '…un fichier dont TOUS les projets ont une tombe non plus');
eq(tousMorts.list, AUTRE, '…et le magasin reste TEL QUEL (rien n’arrive → rien ne change)');

/* ⑧ Sans dataset ouvert (vue globale), les projets gardent leur étiquette :
      les ré-étiqueter à vide les rendrait visibles partout et nulle part. */
const globale = P.planProjectImport({
  store: [], tombstones: [], fileProjects: FILE, targetDatasetId: '', replace: true
});
eq(globale.adopted.map((p) => `${p.datasetId}/${p.id}`), ['ds_lab/prj_1', 'ds_lab/prj_2'],
  'sans dataset de destination, les projets gardent leur dataset d’origine');
eq(globale.target, '', '…et le plan le dit');

/* ── 3. LE SCÉNARIO RAPPORTÉ, bout en bout ─────────────────────────────────
      〰 Un poste où `ds_lab` contient deux projets. « Save HTML » est pris : le
      fichier emporte les projets ET l'id de leur dataset. 〰 L'utilisateur ouvre
      un dataset NEUF (`ds_new`, ce que faisait « Import everything » tant que le
      fichier ne disait pas son origine) et recharge la sauvegarde. */
const dsLab = 'ds_lab';
const fileProjects = [
  { id: 'prj_1', name: 'Pepper viruses', datasetId: dsLab },
  { id: 'prj_2', name: 'Aphids', datasetId: dsLab }
];
const store = fileProjects.map((p) => ({ ...p }));   // le magasin du poste, tel quel

/* ① La sauvegarde dit d'où elle vient : la restauration écrit DANS ce dataset
      (`s.id = fileDatasetId`), donc les projets arrivent là où ils sont lus —
      et les expériences, qui vivent dans l'état du dataset, reviennent avec. */
const cible = targetIdOf({ datasetId: dsLab, title: 'Pepper' }, fileProjects);
eq(cible, dsLab, 'la sauvegarde désigne son dataset d’origine');
const apres = P.planProjectImport({
  store, tombstones: [], fileProjects, targetDatasetId: cible, replace: true
});
eq(visibleIn(apres.list, dsLab), ['prj_1', 'prj_2'],
  'après « Import everything », les projets sont VISIBLES dans le dataset où ils appartiennent — le défaut réparé');
eq(visibleIn(apres.list, 'ds_new'), [],
  '…et ils ne sont pas non plus dupliqués dans un dataset neuf');

/* ② La contre-épreuve, qui décrit exactement l'ancien comportement : les
      projets écrits TELS QUELS (étiquette d'origine) alors que l'écran venait
      d'ouvrir `ds_new`. Présents sur le poste, invisibles ici — « rien ne se
      passe » alors que tout avait été écrit. */
const ecritsTelsQuels = fileProjects.map((p) => ({ ...p }));
eq(visibleIn(ecritsTelsQuels, 'ds_new'), [],
  'écrits sans adoption, les mêmes projets restaient INVISIBLES dans le dataset qui venait de les recevoir');

/* ③ Une sauvegarde ANCIENNE (sans id de dataset) ne recrée plus un dataset
      neuf : ses projets désignent `ds_lab`, et c'est là que l'import écrit. */
eq(targetIdOf({ datasetId: '' }, fileProjects), dsLab,
  'une sauvegarde ancienne retrouve son dataset par ses projets (plus de dataset neuf à chaque rechargement)');

/* ── 4. LES BRANCHEMENTS — une règle juste que personne n'appelle ne répare
      rien. On vérifie donc que le code réel emprunte bien ce chemin-là. */
has(APP, "import { fileDatasetIdOf } from './utils/projectImport';",
  'App.jsx importe la relecture de l’origine du fichier');
has(APP, 'importProjectsFromFile', 'App.jsx importe l’adoption des projets');

has(APP, 'const buildBackupHtml = (title, subtitle, payload, datasetId) => {',
  'la sauvegarde emporte l’id du dataset d’où elle vient (buildBackupHtml)');
has(APP, "datasetId: datasetId || '',", '…écrit dans le blob, à côté du titre et de la date');
has(APP, 'buildBackupHtml(title, subtitle, payload, dset.id);',
  'la sauvegarde hebdomadaire passe l’id du dataset qu’elle sauvegarde');
has(APP, "datasetId: currentDatasetId || '',", 'le téléchargement local (« Save HTML ») aussi');

has(APP, 'const fileDatasetId = dataBlob.datasetId || fileDatasetIdOf(s.projects);',
  'à l’import, l’origine est relue : ce que le fichier dit, sinon ce que disent ses projets');
has(APP, 'if (fileDatasetId) s.id = fileDatasetId;',
  '…et elle devient le dataset de DESTINATION (donc « Import everything » écrit dans SON dataset)');
has(APP, "targetId = s.id || 'ds_' + Date.now();",
  '« remplacer » écrit dans le dataset du fichier (et seulement à défaut en crée un neuf)');
has(APP, 'const restore = importProjectsFromFile(s.projects, { datasetId: targetId, replace: true });',
  'remplacer : les projets du fichier sont adoptés par ce dataset');
has(APP, 'restore = importProjectsFromFile(s.projects, { datasetId: targetId, replace: false });',
  'ajouter : mêmes adoptions, sans écraser ce que le dataset garde déjà');

/* Le trait de fond : `saveProjects` écrivait la liste du fichier telle quelle,
   avec l'étiquette d'origine — c'est LUI qui rendait les projets restaurés
   invisibles. confirmLoad ne doit plus passer par là. */
const confirmStart = APP.indexOf('const confirmLoad = (mode, pickedIds) => {');
const confirmEnd = APP.indexOf("const createNewDataset = async (kind = 'scientific') => {", confirmStart);
ok(confirmStart > 0 && confirmEnd > confirmStart, 'confirmLoad et la suite de la restauration sont localisables');
const CONFIRM = APP.slice(confirmStart, confirmEnd);
ok(!/\bsaveProjects\s*\(/.test(CONFIRM),
  'confirmLoad n’écrit plus la liste des projets par saveProjects (l’écriture qui perdait l’étiquette du dataset)');
ok(CONFIRM.includes('importProjectsFromFile('), '…il passe par l’adoption (importProjectsFromFile)');
has(APP, 'projectRestoreNote = describeProjectRestore(s.projects) || projectRestoreNote;',
  'ce qui n’est pas arrivé est DIT (projets absents, tombes) au lieu d’un import muet');
eq(APP.split('describeProjectWriteRefusal(restore) || projectRestoreNote').length - 1, 2,
  'un refus du magasin est dit dans les DEUX modes (remplacer ET ajouter)');


/* `filterLoadState` (utils/loadSelection) garde toujours `id` : c'est ce qui
   permet à l'origine du fichier de survivre à une sélection partielle
   (« Restore projects only ») — sans quoi la fenêtre d'import retomberait sur un
   dataset neuf et le défaut reviendrait par la porte de derrière. */
has(SEL, 'if (isPresent(src.id)) out.id = src.id;',
  'la sélection partielle conserve le dataset de destination (filterLoadState garde `id`)');
has(SEL, "keys: ['projects']", 'l’élément « Projets » du fichier est bien proposé à la coche');

has(PROJECTS, "import { planProjectImport } from '../../utils/projectImport';",
  'projectsModule importe la règle d’adoption');
has(PROJECTS, 'export const importProjectsFromFile = (fileProjects, { datasetId, replace = false } = {}) => {',
  'importProjectsFromFile est la porte d’entrée de l’adoption');
has(PROJECTS, 'store: readRawProjects(),', '…elle travaille sur le magasin RÉEL de ce navigateur');
has(PROJECTS, 'tombstones: readDeletedProjects(),', '…et sur les tombes RÉELLES');
has(PROJECTS, "if (!adopted.length) return { ok: true, error: '', adopted, skippedDeleted };",
  'RIEN N’ARRIVE → RIEN NE S’ÉCRIT : un fichier qui n’apporte aucun projet ne peut pas vider la liste du dataset');
has(PROJECTS, 'return { ok: written.ok, error: written.error, adopted, skippedDeleted };',
  'le refus du magasin REMONTE à l’appelant (une écriture refusée ne passe plus pour un fichier vide)');
const garde = PROJECTS.indexOf("if (!adopted.length) return { ok: true, error: '', adopted, skippedDeleted };");
const ecriture = PROJECTS.indexOf('const written = writeRawProjects(list);');
ok(garde > 0 && ecriture > garde,
  '…et cette garde est bien AVANT l’écriture du magasin (l’ordre EST la protection)');

console.log(`_load_html_projects_test.mjs — ${passed} assertions OK (📂 Load HTML : les projets d’une sauvegarde sont adoptés par le dataset qui les reçoit — visibles, jamais ressuscités, jamais écrasés)`);

