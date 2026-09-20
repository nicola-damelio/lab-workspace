/* =========================================================================
   src/utils/readOnly.js
   WHY A PAGE REFUSES WRITES — and the promise that it SAYS so.

   Two INDEPENDENT reasons can make an experiment page read-only:

     • 'project'   the user has view-only rights on the project that decides
                   the access to this experiment (same first-match rule as
                   projectsModule.testProjectAccess) and is neither one of its
                   scientists, nor a superuser, nor the test open/unassigned;
     • 'data-lock' a superuser froze the data of this condition
                   (see src/utils/dataLock.js).

   In both cases the write funnels of activeTestModule (updateActiveTest,
   handleTestNameChange, and the structural buttons) return WITHOUT writing.
   A refusal nobody can SEE is the trap this module exists for: the text the
   user just typed stays on screen — nothing re-renders the stored value back
   — so the value LOOKS saved and is gone at the next load. A lost chemical
   shift then reads as a saving bug, which is exactly how it was reported.
   Whatever the reason, the page must render it (banner + badge).

   Everything here is PURE (no React, no window) so the rule is unit tested
   once and reused by any module.
   ========================================================================= */

/** The access level ('view' | 'modify' | null) that DECIDES the access to a
 *  test, together with the project that grants it. Mirrors the first-match
 *  loop of projectsModule.testProjectAccess: the name is what the read-only
 *  notice shows, so the user knows WHICH project to ask rights on. */
export const decidingProjectAccess = (projectNames, accessMap) => {
  const names = Array.isArray(projectNames) ? projectNames : [];
  for (const name of names) {
    const permission = accessMap ? accessMap[name] : null;
    if (permission) return { project: name, permission };
  }
  return { project: '', permission: null };
};

/**
 * Why THIS user cannot write on THIS page.
 * @param {object}  ctx
 * @param {boolean} ctx.isSuperuser          superuser session (writes everything)
 * @param {boolean} ctx.isAssignedScientist  operator or co-scientist of the test
 * @param {?string} ctx.projectPerm          'view' | 'modify' | null
 * @param {boolean} ctx.isUnlocked           the test is unlocked for this user
 * @param {boolean} ctx.hasOperator          the test has an assigned scientist
 * @param {boolean} ctx.isDataLocked         a superuser froze this condition
 * @returns {{ reason: string, readOnly: boolean, projectViewOnly: boolean, dataReadOnly: boolean }}
 *          `reason` is '' | 'project' | 'data-lock'. The project case wins when
 *          both apply: it is the one the user can act on (asking for rights).
 */
export const experimentReadOnly = ({
  isSuperuser = false,
  isAssignedScientist = false,
  projectPerm = null,
  isUnlocked = false,
  hasOperator = false,
  isDataLocked = false
} = {}) => {
  const projectViewOnly = projectPerm === 'view'
    && !(isSuperuser || isAssignedScientist || isUnlocked || !hasOperator);
  const dataReadOnly = !isSuperuser && !!isDataLocked;
  return {
    projectViewOnly,
    dataReadOnly,
    readOnly: projectViewOnly || dataReadOnly,
    reason: projectViewOnly ? 'project' : (dataReadOnly ? 'data-lock' : '')
  };
};

/** One-line reason, ready for a `title=` or a badge. Empty when writable. */
export const readOnlyLabel = (reason, project = '') => {
  if (reason === 'project') {
    return `View-only rights on ${project ? `project “${project}”` : 'the linked project'}`;
  }
  if (reason === 'data-lock') return 'Data locked by a superuser';
  return '';
};
