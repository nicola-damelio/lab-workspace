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
