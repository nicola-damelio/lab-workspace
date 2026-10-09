/* =========================================================================
   src/utils/experimentRules.js
   Data-model rules for the experiment ↔ project relationship.

   New rule (enforced from the app shell):
     - Every experiment (test) MUST belong to at least one project.
     - Experiments are many-to-many: a test can be linked to several projects;
       its Google-Drive tree is then duplicated under every linked project
       directory (projects/<project>/<experiment>/<instance>/<page section>…).
   ========================================================================= */

/** Unique, non-empty project names of an experiment. */
export const experimentProjects = (test) => {
  const names = []
    .concat(Array.isArray(test && test.projectNames) ? test.projectNames : [])
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  return [...new Set(names)];
};

/**
 * The NAME of the test an experiment entry points at ('' when it cannot be
 * resolved: an entry whose test no longer exists, or one created before the
 * test itself). Every rule below groups entries by this name, exactly like the
 * project page does (`experimentsGrouped`).
 */
const entryTestName = (entry, tests) => {
  const id = entry && entry.testId;
  if (!id) return '';
  const found = (Array.isArray(tests) ? tests : [])
    .find((t) => t && String(t.id) === String(id));
  return found ? String(found.name || '').trim() : '';
};

/**
 * MOVE an experiment from one project to another one — the data-model rule,
 * pure and testable (request: « allow me to move an experiment from one project
 * to another »).
 *
 * An experiment is a TEST — with every condition instance of it — and a project
 * links it through one entry per instance (`project.experiments[]`). A move
 * therefore:
 *   1. takes EVERY entry of the source project that belongs to the same test
 *      (same name: the grouping rule the project page already uses) and gives
 *      them to the target project, keeping their id, their `includeInDocument`
 *      flag and their `addedAt` — a move does not create a new experiment, and
 *      a half-moved experiment (some instances here, some there) cannot exist;
 *   2. leaves out the entries the target already has for the same `testId`
 *      (the experiment was linked there too): nothing is duplicated;
 *   3. makes the target the experiment's MAIN project: its `projectNames`
 *      becomes `[target, …the other projects it is still linked to]` with the
 *      source name removed. The main project is the one the Drive path is built
 *      from (`driveNaming.projectNamesOf`) and the one that decides a user's
 *      rights on the experiment (`projectsModule.testProjectAccess`).
 *
 * @param {Array} projects every project (the page's LIVE list, `projectsRef`)
 * @param {Array} tests every test (the application's list)
 * @param {{ expId: string, toProjectId: string }} opts `expId` identifies the
 *        experiment inside the source project (any one of its entries),
 *        `toProjectId` is the project it moves to.
 * @returns {{ ok: boolean, reason?: string, projects: Array, tests: Array,
 *            name: string, from: string, to: string,
 *            moved: number, arrivals: number, duplicates: number }}
 *        `moved` = entries that travelled, `arrivals` = entries actually added
 *        to the target, `duplicates` = entries left out because the target
 *        already linked that test. When `ok` is false
 *        ('unknown-experiment' | 'unknown-project' | 'same-project') the INPUTS
 *        are returned untouched, so the caller writes nothing — and `tests` is
 *        returned as it is whenever no test needed a patch, so a page that writes
 *        the result never churns the list for nothing.
 */
export const moveExperimentBetweenProjects = (projects, tests, { expId, toProjectId } = {}) => {
  const list = Array.isArray(projects) ? projects : [];
  const experimentsOf = (p) => (Array.isArray(p && p.experiments) ? p.experiments : []);
  const source = list.find((p) => experimentsOf(p).some((e) => e && String(e.id) === String(expId)));
  const target = list.find((p) => p && String(p.id) === String(toProjectId));
  const refuse = (reason) => ({
    ok: false, reason, projects: list, tests,
    name: '', from: '', to: '', moved: 0, arrivals: 0, duplicates: 0
  });
  if (!source) return refuse('unknown-experiment');
  if (!target) return refuse('unknown-project');
  if (String(source.id) === String(target.id)) return refuse('same-project');

  const entries = experimentsOf(source);
  const entry = entries.find((e) => e && String(e.id) === String(expId));
  const name = entryTestName(entry, tests);
  /* THE GROUP — every condition instance of the same experiment. An entry whose
     test cannot be resolved travels ALONE: without a name there is no group. */
  const group = entries.filter((e) => (name ? entryTestName(e, tests) === name : !!e && e.id === expId));

  const travelling = new Set(group.map((e) => String(e && e.id)));
  const arrivalIds = new Set(experimentsOf(target).map((e) => String(e && e.testId)));
  const arrivals = group.filter((e) => !arrivalIds.has(String(e && e.testId)));
  const duplicates = group.length - arrivals.length;

  const nextProjects = list.map((p) => {
    if (p === source) {
      return { ...p, experiments: entries.filter((e) => !travelling.has(String(e && e.id))) };
    }
    if (p === target) {
      return { ...p, experiments: [...experimentsOf(target), ...arrivals.map((e) => ({ ...e }))] };
    }
    return p;
  });

  /* THE TEST ITSELF — the target project comes FIRST (it is the main project
     now), the projects the experiment is still linked to keep their place. */
  const fromName = String(source.name || '').trim();
  const toName = String(target.name || '').trim();
  const instanceIds = new Set(group.map((e) => String(e && e.testId)));
  let testsChanged = false;
  const nextTests = (Array.isArray(tests) ? tests : []).map((t) => {
    if (!t || !toName) return t;
    const isIt = instanceIds.has(String(t.id))
      || (!!name && String(t.name || '').trim() === name);
    if (!isIt) return t;
    const rest = experimentProjects(t).filter((n) => n !== fromName && n !== toName);
    const projectNames = [toName, ...rest];
    if (projectNames.length === (t.projectNames || []).length
      && projectNames.every((n, i) => n === (t.projectNames || [])[i])) return t;
    testsChanged = true;
    return { ...t, projectNames };
  });

  return {
    ok: true, projects: nextProjects, tests: testsChanged ? nextTests : tests,
    name, from: fromName, to: toName,
    moved: group.length, arrivals: arrivals.length, duplicates
  };
};

/** True when the experiment is linked to at least one project. */
export const experimentHasProject = (test) =>
  !!(test && experimentProjects(test).length > 0);

/** Test types that are NOT experiments — e.g. sample-storage boxes created by
 *  the Storage module. They are exempt from the "must belong to a project"
 *  rule (a box is a location, not an experiment). */
const STORAGE_BOX_TYPES = new Set(['plate-9x9box']);

export const isExperimentTest = (test) =>
  !!test && !STORAGE_BOX_TYPES.has(String(test.type || '').trim());

/** Returns every EXPERIMENT that currently has NO project (they must be
 *  assigned before they can be created or saved). Storage boxes are ignored. */
export const experimentsWithoutProjects = (tests) =>
  (Array.isArray(tests) ? tests : [])
    .filter((t) => isExperimentTest(t) && !experimentHasProject(t));

/** Assign `projectName` to every EXPERIMENT that has no project yet
 *  (storage boxes are skipped). Returns a NEW array (or the same reference
 *  when nothing changed). */
export const assignUnassignedExperimentsToProject = (tests, projectName) => {
  const name = String(projectName || '').trim();
  if (!name || !Array.isArray(tests)) return tests;
  let changed = false;
  const next = tests.map((t) => {
    if (!isExperimentTest(t) || experimentHasProject(t)) return t;
    changed = true;
    return { ...t, projectNames: experimentProjects(t).concat(name) };
  });
  return changed ? next : tests;
};

/** Validate a test right before it is persisted / saved to Drive.
 *  Storage boxes (plate-9x9box) are not experiments and are always accepted.
 *  @returns {{ ok: boolean, error?: string, test: object }}
 *  When ok is false the caller must abort the save and show `error`. */
export const validateExperimentForSave = (test) => {
  if (!test) return { ok: false, error: 'Experiment is missing.' };
  if (!isExperimentTest(test)) return { ok: true, test };
  const name = String(test.name || '').trim();
  if (!name) return { ok: false, error: 'Give the experiment a name before saving.' };
  if (!experimentHasProject(test)) {
    return {
      ok: false,
      error: 'Every experiment must be linked to at least one Project. Open the experiment inside a Project (or link one) before saving it to Google Drive.'
    };
  }
  return { ok: true, test };
};

/** Validation + repair over a whole dataset payload (used before cloud saves /
 *  weekly backups / HTML exports). Experiments without a project cannot be
 *  mirrored on Drive; this function reports them so the UI can either link a
 *  project or keep the experiment local-only. */
export const validateDatasetExperiments = (payload = {}) => {
  const tests = Array.isArray(payload.tests) ? payload.tests : [];
  const missing = experimentsWithoutProjects(tests);
  return {
    ok: missing.length === 0,
    total: tests.length,
    missing,
    message: missing.length
      ? `${missing.length} experiment${missing.length > 1 ? 's' : ''} without a Project — link each one to a Project (or delete it) before its files can be mirrored on Google Drive.`
      : 'All experiments are linked to a Project.'
  };
};

/* =========================================================================
   LE LIEN test ↔ projet, ÉCRIT DES DEUX CÔTÉS.

   Le rapport, mot pour mot : « quando creo un esperimento esso viene forzato ad
   essere associato ad un progetto ma quando vado nella pagina dei progetti leggo
   0 esperimenti associati. é come se l'esperimento sa di essere associato al
   progetto ma il progetto non sa di avere l'esperimento associato a meno che non
   lo si definisca a mano. »

   C'est EXACTEMENT ce que le modèle permettait. Le lien vit des DEUX côtés :
     • le TEST porte `projectNames`   — l'expérience « sait » à qui elle est ;
     • le PROJET porte une entrée par instance dans `experiments[]` — c'est
       cette liste que la page Projets compte (`🧪 n experiments`) et que la page
       du projet affiche, avec la ligne du bouton ⇄ Move.
   Le geste de création forcée (Experiments → « + NMR » → « Choose a project… »)
   n'écrivait que le PREMIER côté : l'expérience appartenait bien à un projet,
   et elle était INTROUVABLE dans ce projet (compte à 0, liste vide, donc rien à
   déplacer non plus — les deux symptômes du rapport ont cette seule cause).

   Les règles ci-dessous écrivent le SECOND côté, et rien d'autre :
     • `linkExperimentToProject`  — lier UN test à UN projet ;
     • `reconcileExperimentLinks` — remettre d'aplomb TOUTE la liste d'un coup.
   Les deux sont en AJOUT SEUL : ce qui est déjà lié n'est jamais réécrit, aucune
   entrée n'est jamais retirée (retirer une expérience d'un projet, c'est le ✕ de
   la page projet — `removeExperiment`), et aucune autre clé du projet n'est
   touchée. La réparation est donc IDEMPOTENTE : on peut la relancer à chaque
   changement de page (c'est ce que fait App.jsx) sans jamais rien dégrader.
   ========================================================================= */

/** Identifiant d'une entrée `project.experiments[]` — la MÊME forme que
 *  `projectsModule.genProjectId`, pour qu'une entrée écrite ici soit
 *  indiscernable d'une entrée écrite par le bouton « + NMR » de la page projet. */
export const genExperimentEntryId = () =>
  `prj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * L'ENTRÉE qu'un projet doit porter pour ce test : la forme exacte de
 * `+ NMR` de la page projet — `{ id, testId, type, label, includeInDocument,
 * addedAt }` — pour que la ligne s'affiche (badge du type, nom du test, coche
 * « Include », ⭐) comme une entrée créée à la main.
 *
 * @param {object} test l'expérience
 * @param {{ makeId?:Function, labelOf?:Function }} [opts]
 *        `makeId`  — le générateur d'identifiant (la page passe `genProjectId`) ;
 *        `labelOf` — le libellé lisible d'un type (la page passe `testTypeLabel`,
 *                    sans quoi le type brut sert de libellé).
 */
export const experimentEntryFor = (test, opts = {}) => {
  const makeId = typeof opts.makeId === 'function' ? opts.makeId : genExperimentEntryId;
  const type = String((test && test.type) || '').trim() || 'plate-96';
  const label = String((typeof opts.labelOf === 'function' ? opts.labelOf(type) : '') || type);
  return {
    id: makeId(),
    testId: test && test.id,
    type,
    label,
    includeInDocument: false,
    addedAt: new Date().toISOString()
  };
};

/**
 * LIER un test à un projet — le côté qui manquait. AJOUT SEUL.
 *
 * @returns {{ projects:Array, entry:object|null, changed:boolean,
 *            reason:''|'invalid'|'unknown-project'|'already-linked' }}
 *   `projects` est une liste NEUVE quand quelque chose a changé (sinon la liste
 *   reçue, telle quelle — l'appelant peut comparer les références), `reason` dit
 *   pourquoi rien n'a été écrit : une boîte de stockage (`plate-9x9box`) n'est
 *   pas une expérience, un projet que la liste ne porte pas n'existe pas, et ce
 *   qui est déjà lié ne l'est jamais deux fois.
 */
export const linkExperimentToProject = (projects, test, projectName, opts = {}) => {
  const list = Array.isArray(projects) ? projects : [];
  const unchanged = (reason) => ({ projects: list, entry: null, changed: false, reason });
  const name = String(projectName || '').trim();
  if (!name || !test || !test.id || !isExperimentTest(test)) return unchanged('invalid');
  const index = list.findIndex((p) => p && String(p.name || '').trim() === name);
  if (index < 0) return unchanged('unknown-project');
  const already = (list[index].experiments || [])
    .some((e) => e && String(e.testId) === String(test.id));
  if (already) return unchanged('already-linked');
  const entry = experimentEntryFor(test, opts);
  const next = list.map((p, i) => (i === index
    ? { ...p, experiments: [...(p.experiments || []), entry], updatedAt: new Date().toISOString() }
    : p));
  return { projects: next, entry, changed: true, reason: '' };
};

/**
 * REMETTRE D'APLOMB TOUS LES LIENS : ce que `projectNames` annonce, les
 * `experiments[]` des projets doivent le porter. C'est la réparation de fond du
 * rapport (« le projet ne sait pas ») — AJOUT SEUL et IDEMPOTENTE : le premier
 * passage écrit ce qui manque, les suivants ne font rien (d'où `added === 0`).
 *
 * @returns {{ projects:Array, added:number, changed:boolean, linked:number,
 *            unpaired:Array<{ testId:string, test:string, projectName:string }> }}
 *   `added`   = entrées réellement écrites, `linked` = liens déjà en place,
 *   `unpaired`= noms de projets qu'AUCUN projet de la liste ne porte : le lien
 *   reste dans le vide (projet renommé ou supprimé). Rien n'est écrit — une
 *   entrée que personne ne lirait ne réparerait rien — et l'appelant le dit.
 */
export const reconcileExperimentLinks = (projects, tests, opts = {}) => {
  let list = Array.isArray(projects) ? projects : [];
  const known = new Set();
  list.forEach((p) => {
    const n = String((p && p.name) || '').trim();
    if (n) known.add(n);
  });
  let added = 0;
  let linked = 0;
  const unpaired = [];
  (Array.isArray(tests) ? tests : []).forEach((test) => {
    if (!isExperimentTest(test)) return;
    experimentProjects(test).forEach((projectName) => {
      if (!known.has(projectName)) {
        unpaired.push({ testId: test.id, test: String(test.name || ''), projectName });
        return;
      }
      const res = linkExperimentToProject(list, test, projectName, opts);
      if (res.changed) { list = res.projects; added += 1; } else if (res.reason === 'already-linked') linked += 1;
    });
  });
  return { projects: list, added, changed: added > 0, linked, unpaired };
};

/**
 * LES EXPÉRIENCES D'UN PROJET, telles que les pages doivent les COMPTER : les
 * entrées de `project.experiments[]` **∪** les tests dont `projectNames` nomme
 * ce projet, groupés par NOM de test (une expérience = un test avec ses
 * instances de condition — exactement la règle de `experimentsGrouped`, la page
 * du projet).
 *
 * L'UNION est là pour que le compte ne puisse plus MENTIR : même si une seule
 * moitié du lien a été écrite (le cas du rapport), le compte ne dit plus « 0 »
 * alors que l'expérience dit appartenir au projet. Une entrée qui ne résout
 * aucun test compte pour une expérience (clé `#<id>`, comme la page projet).
 *
 * @returns {Array<{ name:string, testIds:string[] }>}
 */
export const experimentNamesOfProject = (project, tests) => {
  const projectName = String((project && project.name) || '').trim();
  const list = Array.isArray(tests) ? tests : [];
  const byId = new Map(list.filter((t) => t && t.id).map((t) => [String(t.id), t]));
  const groups = new Map();
  const add = (key, testId) => {
    const group = groups.get(key) || { name: key.startsWith('#') ? '' : key, testIds: [] };
    if (testId != null && !group.testIds.includes(String(testId))) group.testIds.push(String(testId));
    groups.set(key, group);
  };
  /* 1. Ce que le PROJET porte (une entrée par instance). */
  ((project && project.experiments) || []).forEach((e) => {
    if (!e) return;
    const t = e.testId ? byId.get(String(e.testId)) : null;
    const name = t ? String(t.name || '').trim() : '';
    add(name || `#${e.id || e.testId || 'entry'}`, e.testId);
  });
  /* 2. ∪ Ce que les TESTS annoncent (l'autre moitié du lien). */
  if (projectName) {
    list.forEach((t) => {
      if (!t || !t.id || !isExperimentTest(t)) return;
      if (!experimentProjects(t).includes(projectName)) return;
      add(String(t.name || '').trim() || `#${t.id}`, t.id);
    });
  }
  return Array.from(groups.values());
};

/** Le nombre d'expériences d'un projet — ce que les cartes de la page Projets
 *  affichent (`🧪 n experiments`), et rien d'autre. */
export const countExperimentsOfProject = (project, tests) =>
  experimentNamesOfProject(project, tests).length;
