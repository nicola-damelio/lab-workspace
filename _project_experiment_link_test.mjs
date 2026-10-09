/* =========================================================================
   _project_experiment_link_test.mjs — « LE PROJET SAIT QUE L'EXPÉRIENCE LUI
   APPARTIENT » (et l'expérience reste déplaçable).

   Le rapport, mot pour mot : « quando creo un esperimento esso viene forzato ad
   essere associato ad un progetto ma quando vado nella pagina dei progetti leggo
   0 esperimenti associati. é come se l'esperimento sa di essere associato al
   progetto ma il progetto non sa di avere l'esperimento associato a meno che non
   lo si definisca a mano. Ci dovrebbe poi essere il modo di spostare un
   esperimenti su un altro progetto (mi sembrava che in passato lo avevi fatto ma
   adesso non riesco); questo deve avere un riflesso su drive ovvero in quel caso
   la cartella dell'esperimento deve migrare (non essere copiata) nella cartella
   del progetto dove è stato spostato. »

   UNE SEULE CAUSE pour les deux premiers symptômes : le lien test ↔ projet vit
   des DEUX côtés — le test porte `projectNames`, le projet porte une entrée par
   instance dans `experiments[]` — et la création forcée d'une expérience
   n'écrivait que le premier. Le projet comptait donc 0, sa page n'affichait rien,
   et le ⇄ Move (qui vit sur cette ligne) était inatteignable. Le troisième point
   (la MIGRATION du dossier) était déjà fait — il est revérifié ici pour qu'il ne
   puisse pas se perdre.

   Vérifié ici :
     1. LES RÈGLES, en pur (utils/experimentRules.js) : l'entrée écrite a la
        forme du bouton « + NMR » ; lier est IDEMPOTENT et n'efface jamais rien ;
        `reconcileExperimentLinks` répare toute la liste en une fois, compte ce
        qu'il a écrit, ne touche pas au reste et SIGNALE les projets inexistants ;
     2. LE COMPTE DES CARTES : `countExperimentsOfProject` compte l'UNION des
        deux moitiés (une expérience = un test avec ses instances) — il ne peut
        donc plus dire « 0 » quand l'expérience nomme le projet ;
     3. LA PAGE PROJETS, LA CRÉATION, LA COQUILLE, LA PAGE DU PROJET : la carte
        compte par la règle, `commitPendingExperiment` écrit les deux côtés,
        App.jsx relance la réparation, la page du projet relit le lien au retour,
        et le ⇄ (avec sa phrase) reste là où il était ;
     4. LE DRIVE : le dossier MIGRE (jamais recopié) — `moveTestFolderBetweenProjects`
        est bien appelé depuis le geste de déplacement (`_experiment_move_drive_test.mjs`
        le vérifie de bout en bout sur un faux Drive).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (hay, needle, what) => {
  assert.ok(String(hay).includes(needle), `${what}\n  fragment absent : ${needle}`);
  passed += 1;
};
const lacks = (hay, needle, what) => {
  assert.ok(!String(hay).includes(needle), `${what}\n  fragment présent : ${needle}`);
  passed += 1;
};

/* Les fichiers sont lus en NORMALISANT les fins de ligne (le dépôt est en CRLF
   sous Windows) : une vérification peut donc porter sur un fragment de plusieurs
   lignes, comme l'écriture des deux côtés dans le geste de création. */
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const APP = read('./src/App.jsx');
const TESTS_PAGE = read('./src/components/AppModules/testsModule.jsx');
const PROJECTS_PAGE = read('./src/components/AppModules/projectsModule.jsx');
const PROJECT_PAGE = read('./src/components/AppModules/projectDetailModule.jsx');
const RULES = await import('./src/utils/experimentRules.js');
const { experimentEntryFor, linkExperimentToProject, reconcileExperimentLinks,
  experimentNamesOfProject, countExperimentsOfProject } = RULES;

/* ══ 1. L'ENTRÉE : LA MÊME FORME QUE LE BOUTON « + NMR » ═══════════════════ */
{
  let n = 0;
  const makeId = () => `id${++n}`;
  const e = experimentEntryFor({ id: 't1', name: 'Exp', type: 'nmr' }, { makeId, labelOf: () => 'NMR' });
  eq(e.testId, 't1', 'l’entrée pointe le TEST (c’est ce que la page résout pour afficher son nom)');
  eq(e.type, 'nmr', '…porte son TYPE (le badge de la ligne)');
  eq(e.label, 'NMR', '…le libellé lisible du type (la page passe `testTypeLabel`)');
  eq(e.includeInDocument, false, '…et n’entre PAS dans le document exporté tant qu’on ne l’a pas coché');
  ok(typeof e.id === 'string' && e.id.length > 0, '…avec un identifiant propre');
  ok(typeof e.addedAt === 'string' && e.addedAt.includes('T'), '…et la date d’ajout de la page projet');
  eq(Object.keys(e).sort(), ['addedAt', 'id', 'includeInDocument', 'label', 'testId', 'type'],
    'aucune autre clé : l’entrée est indiscernable d’une entrée créée à la main');
  /* Le libellé retombe sur le type quand la page n'en fournit pas. */
  eq(experimentEntryFor({ id: 't2', type: 'cd' }, { makeId }).label, 'cd', 'sans libellé, le type brut sert de libellé');
  eq(experimentEntryFor({ id: 't3' }, { makeId }).type, 'plate-96', 'un test sans type est une plaque 96 (le défaut de l’app)');
  ok(/^prj_/.test(experimentEntryFor({ id: 't4', type: 'nmr' }).id),
    'le générateur par défaut écrit la MÊME forme que `genProjectId` (prj_…)');
}

/* ══ 2. LIER UN TEST À UN PROJET — L'AJOUT SEUL, IDEMPOTENT ════════════════ */
const fixture = () => ([
  { id: 'pA', name: 'A', experiments: [
    { id: 'e1', testId: 't1', type: 'nmr', label: 'NMR', includeInDocument: true, addedAt: '2026-01-01T10:00:00.000Z' }
  ] },
  { id: 'pB', name: 'B' }
]);
{
  const projects = fixture();
  const res = linkExperimentToProject(projects, { id: 't2', name: 'Exp 2', type: 'cd' }, 'B',
    { makeId: () => 'e2', labelOf: () => 'CD' });
  ok(res.changed, 'lier un test à un projet qui ne le porte pas ÉCRIT quelque chose');
  eq(res.entry.testId, 't2', '…l’entrée neuve pointe le test');
  eq(res.projects[1].experiments.map((e) => e.id), ['e2'], '…et elle arrive dans le projet VISÉ');
  eq(res.projects[0].experiments.map((e) => e.id), ['e1'], '…sans rien changer au projet d’origine');
  eq(projects[0].experiments.map((e) => e.id), ['e1'], 'la liste reçue n’est jamais modifiée en place');
  ok(res.projects[1] !== projects[1], 'la liste rendue est NEUVE (le projet touché est recopié)');

  /* IDEMPOTENCE : le même lien deux fois n'écrit rien la seconde fois. */
  const again = linkExperimentToProject(res.projects, { id: 't2', name: 'Exp 2', type: 'cd' }, 'B',
    { makeId: () => 'e3' });
  eq([again.changed, again.reason, again.projects], [false, 'already-linked', res.projects],
    'un test DÉJÀ lié n’est pas lié deux fois (et la liste est rendue telle quelle)');

  /* Les refus : ils ne touchent à RIEN. */
  const unknown = linkExperimentToProject(projects, { id: 't9', type: 'nmr' }, 'Nope', { makeId: () => 'e9' });
  eq([unknown.changed, unknown.reason, unknown.projects], [false, 'unknown-project', projects],
    'un projet que la liste ne porte pas n’existe pas : rien n’est écrit');
  const box = linkExperimentToProject(projects, { id: 'b1', type: 'plate-9x9box', name: 'Box' }, 'B');
  eq([box.changed, box.reason], [false, 'invalid'],
    'une BOÎTE de stockage n’est pas une expérience (elle n’entre jamais dans `experiments[]`)');
  eq([linkExperimentToProject(projects, null, 'B').reason,
    linkExperimentToProject(projects, { type: 'nmr' }, 'B').reason,
    linkExperimentToProject(projects, { id: 't2', type: 'nmr' }, '  ').reason],
  ['invalid', 'invalid', 'invalid'], 'un test sans identifiant ou un projet sans nom : rien à lier');
}

/* ══ 3. LA RÉPARATION DE FOND : TOUTE LA LISTE, EN AJOUT SEUL ══════════════ */
{
  /* Le cas du rapport : deux expériences créées avec un projet choisi, dont SEUL
     `projectNames` a été écrit ; plus une expérience d’un projet inexistant. */
  const projects = [
    { id: 'pA', name: 'A', experiments: [] },
    { id: 'pB', name: 'B', experiments: [
      { id: 'eb', testId: 'tb', type: 'md_simulation', label: 'MD Simulations', includeInDocument: true, addedAt: '2026-02-02T10:00:00.000Z' }
    ] },
    { id: 'pC', name: 'C', experiments: [] }
  ];
  const tests = [
    { id: 't1', name: 'Exp 1', type: 'nmr', projectNames: ['A'] },
    { id: 't2', name: 'Exp 1', type: 'nmr', projectNames: ['A'] },
    { id: 'tb', name: 'MD run', type: 'md_simulation', projectNames: ['B'] },
    { id: 't3', name: 'Shared', type: 'cd', projectNames: ['B', 'C'] },
    { id: 't4', name: 'Ghost', type: 'nmr', projectNames: ['Renamed'] },
    { id: 'b1', name: 'Box', type: 'plate-9x9box', projectNames: ['A'] }
  ];
  let n = 0;
  const opts = { makeId: () => `n${++n}`, labelOf: (type) => `L:${type}` };
  const res = reconcileExperimentLinks(projects, tests, opts);
  ok(res.changed, 'la réparation écrit ce que `projectNames` annonce et que les projets ne portent pas');
  eq(res.added, 4, 'quatre entrées manquaient : DEUX instances de « Exp 1 » à A, « Shared » à C, et rien pour le fantôme');
  eq(res.projects[0].experiments.map((e) => e.testId), ['t1', 't2'],
    'les deux instances de la MÊME expérience sont liées (une entrée par instance, comme la page projet)');
  eq(res.projects[1].experiments.map((e) => e.testId), ['tb', 't3'],
    'l’expérience partagée rejoint B, après celle qui y était déjà — sans doublon');
  eq(res.projects[2].experiments.map((e) => e.testId), ['t3'],
    '…et C reçoit SA copie du lien (le modèle est many-to-many)');
  eq(res.projects[1].experiments[0], projects[1].experiments[0],
    'l’entrée qui existait déjà n’est pas réécrite (identifiant, « Include » et date intacts)');
  eq(res.linked, 1, 'un seul lien était déjà en place (MD run)');
  eq(res.unpaired.map((u) => `${u.test}:${u.projectName}`), ['Ghost:Renamed'],
    'un projet qui n’existe plus est SIGNALÉ, pas inventé');
  eq(res.projects.find((p) => p.id === 'pA').experiments.every((e) => e.testId !== 'b1'), true,
    'une boîte de stockage n’est jamais liée, même quand elle nomme un projet');
  eq(res.projects.length, 3, 'aucun projet n’est créé ni retiré par la réparation');

  /* IDEMPOTENCE : relancer ne réécrit rien (c’est ce que fait App.jsx à chaque
     changement de page). */
  const again = reconcileExperimentLinks(res.projects, tests, opts);
  eq([again.changed, again.added], [false, 0], 'relancer la réparation n’écrit plus rien');
  eq(again.projects, res.projects, '…et rend la liste telle quelle');
  eq(again.linked, 5, '…en comptant les cinq liens désormais en place');

  /* Aucune expérience : rien à faire, et surtout aucune écriture. */
  const empty = reconcileExperimentLinks(projects, []);
  eq([empty.changed, empty.added, empty.projects], [false, 0, projects], 'sans expérience, la liste reste intacte');
  const noProjects = reconcileExperimentLinks([], tests, opts);
  eq([noProjects.changed, noProjects.added], [false, 0], 'sans projet, rien n’est inventé');
  eq(noProjects.unpaired.length, 6, '…et les liens restent dans le vide, tous signalés');
}
/* ══ 4. LE COMPTE DES CARTES : L'UNION DES DEUX MOITIÉS DU LIEN ════════════ */
{
  const project = { id: 'pA', name: 'A', experiments: [
    { id: 'e1', testId: 't1', type: 'nmr', label: 'NMR' },
    { id: 'e2', testId: 't2', type: 'nmr', label: 'NMR' },
    { id: 'e3', testId: 'gone', type: 'cd', label: 'CD' }
  ] };
  const tests = [
    { id: 't1', name: 'Exp 1', type: 'nmr', projectNames: ['A'] },
    { id: 't2', name: 'Exp 1', type: 'nmr', projectNames: ['A'] },
    { id: 'g1', name: 'Ghost link', type: 'cd', projectNames: ['A'] },
    { id: 'other', name: 'Elsewhere', type: 'nmr', projectNames: ['B'] },
    { id: 'box', name: 'Box', type: 'plate-9x9box', projectNames: ['A'] }
  ];
  eq(experimentNamesOfProject(project, tests).map((g) => g.name), ['Exp 1', '', 'Ghost link'],
    'groupées par NOM de test : les DEUX instances de « Exp 1 » font UNE expérience, l’entrée qui ne résout aucun test compte à part');
  eq(experimentNamesOfProject(project, tests)[0].testIds, ['t1', 't2'],
    '…et le groupe dit quelles instances il rassemble');
  eq(experimentNamesOfProject(project, tests).map((g) => g.testIds).flat(),
    ['t1', 't2', 'gone', 'g1'], 'les instances comptées sont exactement celles des deux moitiés du lien');
  eq(countExperimentsOfProject(project, tests), 3,
    'le compte d’une carte : Exp 1 (2 instances) + l’entrée orpheline + le lien écrit du seul côté test');
  eq(countExperimentsOfProject({ id: 'pB', name: 'B', experiments: [] }, tests), 1,
    'LE DÉFAUT DU RAPPORT : un projet sans AUCUNE entrée mais nommé par une expérience compte 1, pas 0');
  eq(countExperimentsOfProject({ id: 'pX', name: 'X', experiments: [] }, tests), 0,
    '…et un projet que personne ne nomme reste bien à 0');
  eq(countExperimentsOfProject(project, []), 3,
    'sans la liste des tests, les entrées ne se regroupent plus par nom : chacune compte pour une (comme la page projet)');
  eq(countExperimentsOfProject(null, tests), 0, 'un projet absent ne compte rien (la carte n’existe pas)');
  eq(countExperimentsOfProject({ id: 'pZ', name: '', experiments: [] }, tests), 0,
    'aucune expérience ne peut NOMMER un projet sans nom : le compte reste celui de ses entrées');
}




/* ══ 5. LES GESTES, DANS LE CODE ══════════════════════════════════════════ */
/* ── 5a. La CRÉATION écrit les DEUX côtés, dans le même geste ─────────────── */
has(TESTS_PAGE, "import { linkExperimentToProject } from '../../utils/experimentRules';",
  'la page des expériences emploie la règle PURE (elle ne réimplémente pas le lien)');
has(TESTS_PAGE, 'created.projectNames = [chosen];',
  'la création continue d’écrire le côté TEST (`projectNames`) — le projet choisi est forcé');
has(TESTS_PAGE, 'const linked = linkExperimentToProject(loadProjects(), created, chosen, { labelOf: testTypeLabel });',
  '…et elle écrit le côté PROJET dans le même geste (magasin relu, entrée à la forme du bouton « + NMR »)');
has(TESTS_PAGE, 'if (linked.changed) saveProjects(linked.projects);',
  '…une seule écriture, et seulement si le lien manquait');
{
  const handler = TESTS_PAGE.indexOf('const commitPendingExperiment = () => {');
  const link = TESTS_PAGE.indexOf('linkExperimentToProject(loadProjects(), created, chosen', handler);
  const nav = TESTS_PAGE.indexOf("setCurrentModule('active-test');", handler);
  ok(handler > 0 && link > handler && nav > link,
    'le lien est écrit DANS le geste de création, avant d’ouvrir la page de l’expérience');
}

/* ── 5b. La PAGE PROJETS compte l'UNION, et la réparation vit au magasin ─── */
has(PROJECTS_PAGE, "import { reconcileExperimentLinks, countExperimentsOfProject } from '../../utils/experimentRules';",
  'la page des projets emploie les deux règles pures (compte + réparation)');
has(PROJECTS_PAGE, '🧪 {countExperimentsOfProject(p, tests)} experiments',
  'la carte compte par la règle d’union (elle ne peut plus dire 0 quand l’expérience dit appartenir au projet)');
lacks(PROJECTS_PAGE, '🧪 {(p.experiments || []).length} experiments',
  'l’ANCIEN compte — celui qui ne lisait qu’une moitié du lien — a disparu');
has(PROJECTS_PAGE, 'onRestoreProject, tests = []',
  'la page reçoit la liste des expériences (c’est elle qui porte l’autre moitié du lien)');
has(PROJECTS_PAGE, 'export const reconcileProjectExperiments = (tests, opts = {}) => {',
  'la réparation a SON geste, au niveau du magasin (comme les autres adoptions)');
has(PROJECTS_PAGE, 'const res = reconcileExperimentLinks(projects, tests, options);',
  '…elle passe par la règle pure sur la liste RELUE');
has(PROJECTS_PAGE, 'if (!res.changed) {',
  '…n’écrit rien quand le magasin est déjà d’aplomb (on peut la relancer sans coût)');
has(PROJECTS_PAGE, 'const written = saveProjects(res.projects);',
  '…et réécrit la liste UNE fois quand il manquait quelque chose');
has(PROJECTS_PAGE, 'const options = { labelOf: testTypeLabel, ...(opts || {}) };',
  '…avec le libellé lisible des types, comme la page projet');
has(PROJECTS_PAGE, 'if (!getActiveProjectDataset()) {',
  '…et JAMAIS hors dataset : la vue « globale » porte les projets de tous les datasets, un lien y serait écrit dans le projet homonyme d’un dataset voisin');



/* ── 5c. La COQUILLE relance la réparation ───────────────────────────────── */
has(APP, 'mergeProjectsFromCloud, reconcileProjectExperiments, setProjectDatasetScope',
  'App.jsx importe la réparation');
has(APP, 'try { reconcileProjectExperiments(tests); } catch { /* magasin indisponible : rien de bloquant */ }',
  '…et l’appelle — une écriture du magasin ne peut pas casser la page');
has(APP, 'if (!currentDatasetId) return;',
  '…seulement quand un dataset est ouvert (hors dataset, aucun projet n’est affiché)');
has(APP, '}, [currentDatasetId, currentModule, tests.length]);',
  'déclencheurs GROSSIERS : page, dataset, nombre d’expériences — jamais la frappe');
lacks(APP, '}, [currentDatasetId, currentModule, tests]);',
  '…le tableau `tests` lui-même ne déclenche PAS la réparation (il change à chaque caractère saisi)');
has(APP, 'onRestoreProject={restoreDeletedProject}\n              tests={tests}',
  'la page Projets reçoit les expériences (pour compter l’union)');
has(APP, 'currentModule={currentModule}',
  'la page du projet sait quand elle est LA page affichée (c’est ce qui la fait relire le lien)');

/* ── 5d. La PAGE DU PROJET relit le lien, et dit où est le ⇄ ─────────────── */
has(PROJECT_PAGE, "if (currentModule !== 'project-detail') return;",
  'la page du projet relit le lien … quand elle redevient la page affichée');
has(PROJECT_PAGE, 'const missing = (stored.experiments || [])',
  '…en prenant dans le magasin les seules entrées qui manquent à l’écran');
has(PROJECT_PAGE, 'if (missing.length === 0) return;',
  '…et rien du tout quand il n’en manque aucune');
has(PROJECT_PAGE, '⇄ on a row moves that experiment',
  'la ligne ⇄ est ANNONCÉE dans la liste (le rapport : « adesso non riesco » — le geste existait sans être dit)');
has(PROJECT_PAGE, '{canModify && moveTargets.length > 0 && (',
  'le ⇄ reste exactement là où il était : sur chaque ligne de la liste des expériences du projet');

/* ── 5e. LE DRIVE : le dossier MIGRE, jamais recopié ─────────────────────── */
{
  const UPLOAD = read('./src/utils/driveUpload.js');
  const handler = PROJECT_PAGE.indexOf('const moveExperimentToProject = (expId, toProjectId) => {');
  const call = PROJECT_PAGE.indexOf('moveTestFolderBetweenProjects({', handler);
  ok(handler > 0 && call > handler,
    'le déplacement d’une expérience fait suivre son dossier Drive (appelé là où le lien change)');
  has(PROJECT_PAGE, 'fromProjectName: project.name,\n        toProjectName: target.name',
    '…avec le projet QUITTÉ et le projet VISÉ (un déménagement, pas une copie)');
  has(UPLOAD, 'export const moveTestFolderBetweenProjects = async ({ testName, fromProjectName, toProjectName }) => {',
    'le geste Drive dédié existe toujours');
  has(UPLOAD, 'await moveDriveFile(src.id, toFolderId); // DÉPLACÉ (addParents + removeParents)',
    '…et il DÉPLACE par identifiant (`addParents` + `removeParents`) : « la cartella deve migrare, non essere copiata »');
  has(UPLOAD, 'const mergeFolderInto = async (fromId, toId, depth = 0) => {',
    '…en FUSIONNANT si un dossier du même nom attend déjà dans le projet visé (jamais deux dossiers frères)');
}

console.log(`_project_experiment_link_test.mjs — ${passed} assertions OK (le projet sait que l'expérience lui appartient, et le dossier Drive migre quand elle change de projet)`);
