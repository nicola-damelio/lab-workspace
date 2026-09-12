/* =========================================================================
   src/utils/conditionInstance.js
   Build a NEW condition ("date / condition" tab) of an existing experiment.

   An experiment is a GROUP of instances sharing the same `name`, and the
   "+ Add Date/Condition" button of the Date/Conditions row adds one more.
   That new condition must open on a VIRGIN page: the blank defaults of its
   experiment type (createEmptyTest: empty plate, no spectrum, no fit, no
   comment, no image, no document, no storage slot, no linked protocol…) and
   NOTHING else — a new measurement is not a copy of the previous one.

   Only the EXPERIMENT-LEVEL context travels to the new condition:
     name                              group key of the Date/Condition tabs
     testCategory / secondaryCategory  classification of the experiment
     projectNames                      projects it belongs to (access + Drive
                                       tree projects/<project>/…)
     operator / coScientists           the scientists of the experiment
   Everything else keeps the value createEmptyTest produced: comments, images,
   documents, measured values, fits, molecule, phase / calibration, gating,
   storage slot, plan, best-measurement flag, data lock…

   Used by activeTestModule's "+ Add Date/Condition" button. The "⧉ Copy the
   data to a new instance" button of the data-lock banner does the OPPOSITE (it
   copies the data on purpose) and does not go through this helper.

   Pure (no React, no window) so the rule can be unit tested.
   ========================================================================= */

/** Label of the new condition: "New Instance 2", "New Instance 3"…
 *  `siblingCount` = number of conditions the experiment already has. */
export const blankConditionName = (siblingCount) =>
  `New Instance ${(Number.isFinite(Number(siblingCount)) ? Number(siblingCount) : 0) + 1}`;

/**
 * Copy the experiment-level context of `source` (the condition the button was
 * pressed on) onto a brand-new blank condition `blank`, and return the result.
 * `blank` is never mutated, nor are the arrays of `source`.
 * @param {object} blank fresh instance coming from createEmptyTest(id, num, type)
 * @param {object} source instance whose "+ Add Date/Condition" button was used
 * @param {{instanceName?: string}} [opts] label of the new condition
 */
export const withExperimentContext = (blank, source, opts = {}) => {
  const out = { ...(blank || {}) };
  const src = source || {};
  out.name = src.name || out.name || '';
  out.instanceName = opts.instanceName || out.instanceName || '';
  out.testCategory = src.testCategory || out.testCategory || '';
  out.secondaryCategory = src.secondaryCategory || out.secondaryCategory || '';
  out.projectNames = Array.isArray(src.projectNames) ? [...src.projectNames] : [];
  out.operator = src.operator || out.operator || '';
  out.coScientists = Array.isArray(src.coScientists) ? [...src.coScientists] : [];
  return out;
};
