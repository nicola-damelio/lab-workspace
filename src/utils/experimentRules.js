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
