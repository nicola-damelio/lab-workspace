/* =========================================================================
   _project_experiment_move_test.mjs — DÉPLACER UNE EXPÉRIENCE D'UN PROJET À UN
   AUTRE.

   Demande, mot pour mot : « allow me to move an experiment from one project to
   another ».

   Une expérience = un TEST avec ses instances de condition ; un projet la lie
   par une ENTRÉE par instance (`project.experiments[]`). « Déplacer » veut donc
   dire : le projet quitté n'en garde AUCUNE entrée, le projet visé les reçoit à
   l'identique, et le test devient celui du projet visé — sans être jamais
   dupliqué, et sans qu'un test encore lié à un AUTRE projet soit dérangé (le
   modèle est many-to-many).

   Vérifié ici :
     1. LA RÈGLE, en pur (utils/experimentRules.moveExperimentBetweenProjects) :
        le groupe entier voyage (id, « Include » et date compris), le projet
        visé devient le projet PRINCIPAL du test (projectNames), un test déjà
        lié au projet visé n'y est pas écrit deux fois, un refus (expérience,
        projet, même projet) ne touche RIEN ;
     2. LA PAGE (projectDetailModule.jsx) : le bouton ⇄ de la liste des
        expériences, la liste des projets VISÉS (droit de modification), la
        seule écriture (les deux projets ensemble + le magasin), et le dossier
        Drive qui suit — sortie du projet quitté PUIS entrée dans le projet visé,
        dans cet ordre ;
     3. LES DEUX GESTES DRIVE réutilisés (utils/driveUpload.js).
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

/* Les fichiers sont lus en NORMALISANT les fins de ligne (le dépôt est en CRLF
   sous Windows) : les vérifications peuvent alors porter sur un fragment de
   plusieurs lignes — l'ordre des deux gestes Drive, par exemple. */
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const PAGE = read('./src/components/AppModules/projectDetailModule.jsx');
const UPLOAD = read('./src/utils/driveUpload.js');
const RULES = await import('./src/utils/experimentRules.js');
const { moveExperimentBetweenProjects } = RULES;

/* ══ 1. LA RÈGLE : LE GROUPE ENTIER DÉMÉNAGE, À L'IDENTIQUE ════════════════ */
const entry = (id, testId, label, include, addedAt) =>
  ({ id, testId, type: 'nmr', label, includeInDocument: include, addedAt });
const testsFixture = () => ([
  { id: 't1', name: 'Exp 1', projectNames: ['A'] },
  { id: 't2', name: 'Exp 1', projectNames: ['A'] },
  { id: 't3', name: 'Exp 2', projectNames: ['A', 'C'] },
  { id: 't4', name: 'Exp 3', projectNames: ['A'] }
]);
/* A porte DEUX instances de « Exp 1 » (t1, t2), une de « Exp 2 » (t3, partagée
   avec C) et une boîte de stockage (t4) ; B est vide. */
const projectsFixture = () => ([
  {
    id: 'pA', name: 'A', scientist: 'Nicolas',
    experiments: [
      entry('e1', 't1', 'NMR', true, '2026-01-01T10:00:00.000Z'),
      entry('e2', 't2', 'NMR', false, '2026-01-02T10:00:00.000Z'),
      entry('e3', 't3', 'CD', true, '2026-01-03T10:00:00.000Z'),
      entry('e4', 't4', 'Box', false, '2026-01-04T10:00:00.000Z')
    ]
  },
  { id: 'pB', name: 'B', scientist: 'Nicolas', experiments: [] },
  { id: 'pC', name: 'C', scientist: 'Chiara', experiments: [entry('e9', 't3', 'CD', false, '2026-02-01T10:00:00.000Z')] }
]);

{
  const projects = projectsFixture();
  const tests = testsFixture();
  const srcEntry = projects[0].experiments[0];
  const res = moveExperimentBetweenProjects(projects, tests, { expId: 'e1', toProjectId: 'pB' });

  ok(res.ok, 'déplacer une expérience d’un projet à un autre est accepté');
  eq(res.reason, undefined, '…sans raison de refus');
  eq([res.name, res.from, res.to], ['Exp 1', 'A', 'B'],
    'le compte rendu nomme l’expérience et les deux projets');
  eq([res.moved, res.arrivals, res.duplicates], [2, 2, 0],
    'les DEUX instances de condition de « Exp 1 » voyagent (une expérience = un test)');

  eq(res.projects[0].experiments.map((e) => e.id), ['e3', 'e4'],
    'le projet quitté ne garde AUCUNE entrée de l’expérience partie (ses autres entrées restent)');
  eq(res.projects[1].experiments.map((e) => e.id), ['e1', 'e2'],
    'le projet visé reçoit les deux entrées, dans l’ordre');
  eq(res.projects[1].experiments.map((e) => e.testId), ['t1', 't2'], '…avec leurs tests');
  eq(res.projects[1].experiments.map((e) => e.includeInDocument), [true, false],
    'la coche « Include » de chaque instance est CONSERVÉE');
  eq(res.projects[1].experiments.map((e) => e.addedAt),
    ['2026-01-01T10:00:00.000Z', '2026-01-02T10:00:00.000Z'],
    '…et sa date : c’est un DÉPLACEMENT, pas une nouvelle expérience');
  eq([res.projects[1].experiments[0].type, res.projects[1].experiments[0].label], ['nmr', 'NMR'],
    'le type et l’étiquette de l’entrée suivent aussi');
  ok(res.projects[1].experiments[0] !== srcEntry,
    'l’entrée reçue est une COPIE (les deux projets ne partagent pas le même objet)');
  eq(res.projects[1].name, 'B', 'le reste du projet visé est intact');
  ok(res.projects[2] === projects[2], 'un projet qui n’est ni la source ni la cible n’est pas recopié');

  eq(res.tests.find((t) => t.id === 't1').projectNames, ['B'],
    'le test lui-même appartient désormais au projet visé');
  eq(res.tests.find((t) => t.id === 't2').projectNames, ['B'],
    '…ses autres instances aussi (le groupe entier)');
  eq(res.tests.find((t) => t.id === 't3').projectNames, ['A', 'C'],
    'un test d’une AUTRE expérience n’est pas touché');
  eq(res.tests.find((t) => t.id === 't4').projectNames, ['A'], '…ni une boîte de stockage');
  eq(projects[0].experiments.length, 4, 'la liste d’origine n’est jamais modifiée en place');
}

/* ── Déjà lié au projet visé : rien n’y est dupliqué ─────────────────────── */
{
  const projects = projectsFixture();
  const tests = testsFixture();
  projects[1].experiments = [entry('eb', 't1', 'NMR', false, '2026-03-01T10:00:00.000Z')];
  tests[0].projectNames = ['A', 'B'];
  const res = moveExperimentBetweenProjects(projects, tests, { expId: 'e1', toProjectId: 'pB' });
  ok(res.ok, 'un test déjà lié au projet visé peut encore être déplacé');
  eq([res.moved, res.arrivals, res.duplicates], [2, 1, 1],
    'les deux entrées voyagent : celle dont le test est DÉJÀ là n’est pas ajoutée, l’autre l’est');
  eq(res.projects[1].experiments.map((e) => e.id), ['eb', 'e2'],
    'le projet visé garde SON entrée et ne reçoit pas de doublon de t1');
  eq(res.projects[0].experiments.map((e) => e.id), ['e3', 'e4'],
    'le projet quitté perd quand même l’expérience (le geste est un déplacement)');
  eq(res.tests.find((t) => t.id === 't1').projectNames, ['B'],
    'le nom du projet visé n’est jamais écrit deux fois dans projectNames');
}

/* ── Un refus ne touche RIEN (même référence : rien à écrire) ────────────── */
{
  const projects = projectsFixture();
  const tests = testsFixture();
  const unknownExp = moveExperimentBetweenProjects(projects, tests, { expId: 'nope', toProjectId: 'pB' });
  eq([unknownExp.ok, unknownExp.reason], [false, 'unknown-experiment'],
    'une entrée inconnue est refusée');
  ok(unknownExp.projects === projects && unknownExp.tests === tests,
    '…et rend les listes telles quelles (aucune écriture)');

  const unknownProject = moveExperimentBetweenProjects(projects, tests, { expId: 'e1', toProjectId: 'nope' });
  eq([unknownProject.ok, unknownProject.reason], [false, 'unknown-project'],
    'un projet visé inconnu est refusé');
  ok(unknownProject.projects === projects, '…sans rien écrire');

  const sameProject = moveExperimentBetweenProjects(projects, tests, { expId: 'e1', toProjectId: 'pA' });
  eq([sameProject.ok, sameProject.reason], [false, 'same-project'],
    '« déplacer » vers le projet où l’on est déjà est refusé');
  ok(sameProject.projects === projects, '…sans rien écrire');

  const nothing = moveExperimentBetweenProjects(undefined, undefined, {});
  eq([nothing.ok, nothing.reason], [false, 'unknown-experiment'],
    'des listes absentes ne font pas planter la règle');
  eq([nothing.moved, nothing.arrivals, nothing.duplicates], [0, 0, 0], '…et le compte rendu reste vide');
}

/* ── Le projet visé devient le projet PRINCIPAL du test ──────────────────── */
{
  const projects = projectsFixture();
  const tests = testsFixture();
  const res = moveExperimentBetweenProjects(projects, tests, { expId: 'e3', toProjectId: 'pB' });
  eq(res.tests.find((t) => t.id === 't3').projectNames, ['B', 'C'],
    'le projet visé passe EN PREMIER (projet principal : droits de l’utilisateur et chemin Drive)');
  eq(res.projects[2].experiments.map((e) => e.id), ['e9'],
    'le troisième projet lié garde son entrée (many-to-many : il n’est pas délié)');
}

/* ══ 2. LA PAGE : LE BOUTON ⇄, LA CIBLE, UNE SEULE ÉCRITURE ═══════════════ */
has(PAGE, "import { moveExperimentBetweenProjects } from '../../utils/experimentRules';",
  'la page emploie la règle PURE (elle ne réimplémente pas le déplacement)');
has(PAGE, 'const [moveExp, setMoveExp] = useState(null);',
  'le volet « Move to project: » est l’état d’UNE ligne ({ expId, targetId })');
has(PAGE, 'const [moveReport, setMoveReport] = useState(\'\');',
  'le déplacement laisse un compte rendu dans la page');

/* La liste des projets VISÉS : tous sauf celui-ci, et seulement ceux que
   l'utilisateur a le droit de MODIFIER (un déplacement écrit chez eux). */
has(PAGE, '.filter((p) => p && p.id !== project?.id && projectAccessFor(p, myName, isSuper) === \'modify\')',
  'la liste ne propose que les autres projets MODIFIABLES par l’utilisateur');
has(PAGE, '.sort((a, b) => String(a.name || \'\').localeCompare(String(b.name || \'\'))),',
  '…triés par nom (la liste se lit, elle ne bouge pas d’un rendu à l’autre)');

/* Le geste lui-même : la règle pure, puis UNE écriture, puis le Drive. */
has(PAGE, 'const res = moveExperimentBetweenProjects(projectsRef.current, tests, { expId, toProjectId });',
  'le déplacement part de la liste VIVANTE des projets');
has(PAGE, 'const moveExperimentToProject = (expId, toProjectId) => {\n    if (!canModify) return;',
  'la page en lecture seule ne déplace rien');
has(PAGE, 'replaceProjects(res.projects);',
  'les DEUX projets s’écrivent ensemble (jamais l’expérience nulle part)');
has(PAGE, 'saveProjects(projectsRef.current);', '…et le magasin suit tout de suite');
has(PAGE, 'setTests(res.tests);', 'les tests gagnent le nouveau projet principal');
eq(PAGE.split('setProjects(').length - 1, 1,
  'la liste des projets ne s’écrit QUE par replaceProjects() (aucune écriture à côté du ref)');

/* ── Une entrée orpheline (test disparu) voyage seule ───────────────────── */
{
  const projects = projectsFixture();
  const tests = testsFixture();
  projects[0].experiments = [entry('e5', '', 'NMR', false, '2026-01-05T10:00:00.000Z')];
  const res = moveExperimentBetweenProjects(projects, tests, { expId: 'e5', toProjectId: 'pB' });
  ok(res.ok, 'une entrée sans test résolvable peut être déplacée');
  eq(res.projects[1].experiments.map((e) => e.id), ['e5'], '…seule (sans nom, il n’y a pas de groupe)');
  eq(res.name, '', 'le compte rendu n’invente pas de nom');
  ok(res.tests === tests, '…et la liste des tests n’est pas recopiée pour rien');
}

/* Le dossier Drive suit : sortie du projet quitté PUIS entrée dans le visé. */
has(PAGE, 'moveTestFolderOutOfProject({ testName, projectName: project.name }).catch(() => {});',
  '…sans jamais bloquer la page (le geste reste « au mieux »)');
has(PAGE, '    moveTestFolderOutOfProject({ testName, projectName: project.name })\n        .then(() => moveTestFolderIntoProject({ testName, projectName: targetName }))',
  'le dossier sort du projet quitté PUIS entre dans le projet visé (dans cet ordre)');
{
  const handler = PAGE.indexOf('const moveExperimentToProject = (expId, toProjectId) => {');
  const out = PAGE.indexOf('moveTestFolderOutOfProject({ testName, projectName: project.name })\n        .then(', handler);
  const into = PAGE.indexOf('moveTestFolderIntoProject({ testName, projectName: targetName })', handler);
  ok(handler > 0 && out > handler && into > out,
    'l’entrée dans le projet visé ne part qu’APRÈS la sortie du projet quitté (un dossier encore chez A n’est pas « hors projet »)');
}

/* Le bouton et le volet, dans la liste « 🧪 Experiments in this project ». */
has(PAGE, '{canModify && moveTargets.length > 0 && (',
  'le ⇄ n’apparaît que s’il existe un projet où aller');
has(PAGE, 'title="Move this experiment to another project — the experiment (all its condition instances), its files and its Google-Drive folder leave this project for the chosen one.">',
  'le ⇄ dit ce qu’il déplace');
has(PAGE, 'setMoveExp((prev) => (prev && prev.expId === exp.id',
  'un clic ouvre le volet de CETTE ligne, un second clic le referme');
has(PAGE, '⇄ Move “{test?.name || group.name || \'this experiment\'}” to project:',
  'le volet nomme l’expérience et la question posée');
has(PAGE, '<option value="">Choose a project…</option>', '…et propose les projets (aucun n’est présélectionné)');
has(PAGE, '{moveTargets.map((p) => (', '…depuis la liste des projets visés');
has(PAGE, 'disabled={!moveExp.targetId}', 'déplacer sans avoir choisi de projet est impossible');
has(PAGE, 'onClick={() => moveExperimentToProject(exp.id, moveExp.targetId)}',
  'le bouton « ⇄ Move » fait le déplacement de l’entrée de cette ligne');
has(PAGE, 'onClick={() => setMoveExp(null)}', '« Cancel » referme sans rien écrire');
has(PAGE, 'title="Remove from project">', 'le ✕ (retirer du projet) existe toujours — déplacer n’est pas supprimer');
has(PAGE, 'the experiment (all its condition instances), its files and its', 'le volet dit ce qui part');
has(PAGE, '{moveReport && (', 'le compte rendu s’affiche dans la carte des expériences');
has(PAGE, 'onClick={() => setMoveReport(\'\')}', '…et se referme');
has(PAGE, 'Demande : « allow me to move an experiment from one project to another ».',
  'la demande est citée dans le code, à l’endroit du geste');

/* ══ 3. LES DEUX GESTES DRIVE RÉUTILISÉS ══════════════════════════════════ */
has(UPLOAD, 'export const moveTestFolderOutOfProject = async ({ testName, projectName }) => {',
  'le dossier se sort du projet quitté avec le geste déjà testé du programme');
has(UPLOAD, 'export const moveTestFolderIntoProject = async ({ testName, projectName }) => {',
  '…et se range dans le projet visé avec l’autre');
eq(UPLOAD.split('if (!getDriveToken() || !testName || !projectName) return 0;').length - 1, 2,
  'les deux gestes ne font rien sans Drive connecté (le déplacement des données, lui, a déjà eu lieu)');
has(UPLOAD, 'rels.push(`projects/${DEFAULT_PROJECT_NAME}/${testSlug}`);',
  'le bac des expériences sans projet est bien l’endroit où le dossier sorti est retrouvé');

/* La règle appartient au MODÈLE, pas à la page : elle reste exportée. */
ok(typeof RULES.moveExperimentBetweenProjects === 'function',
  'la règle du déplacement est exportée par utils/experimentRules.js');

console.log(`_project_experiment_move_test.mjs — ${passed} assertions OK (déplacement d'une expérience entre deux projets)`);

