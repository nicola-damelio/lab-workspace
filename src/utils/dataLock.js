/* =========================================================================
   src/utils/dataLock.js
   Per-instance DATA LOCK (freeze) — "this experiment is finished, nobody
   changes it any more, except a superuser".

   A superuser freezes the data of one condition (or of every condition of an
   experiment) with the 🔒 button in the experiment header. For every other
   user the page stays fully readable — every section, plot and result is still
   shown — but nothing can be written any more: the write funnels of
   activeTestModule (updateActiveTest / updateInstance / setTests) drop any
   modification and restore the stored value of the frozen instance.
   The way out offered to a scientist who needs a DIFFERENT analysis is to
   COPY the data into a new instance (the + copy button / the banner button);
   a copy is never locked, so it can be edited freely.

   The three fields travel with the dataset (plain properties of the instance
   object, JSON-serializable, ignored by every other module):
     dataLocked    true when the data of this instance is frozen
     dataLockedBy  name of the superuser who froze it (shown in the banner)
     dataLockedAt  epoch ms of the freeze

   Everything here is PURE (no React, no window) so the rules can be unit
   tested and reused by any module (activeTestModule, testsModule, reports…).
   ========================================================================= */

/** True when this instance's data is frozen by a superuser. */
export const isDataLocked = (test) => !!test && test.dataLocked === true;

/** True when `scope` (id or object) is frozen, given a Set of locked ids. */
export const isIdLocked = (lockedIds, id) =>
  !!lockedIds && typeof lockedIds.has === 'function' && lockedIds.has(id);

/** Ids of the frozen instances of a list. @returns {Set<string>} */
export const lockedIdSet = (tests) => {
  const out = new Set();
  (Array.isArray(tests) ? tests : []).forEach((t) => {
    if (isDataLocked(t) && t.id) out.add(t.id);
  });
  return out;
};

/** Short human label, e.g. "Data locked by Nicola D. on 12/09/2026". */
export const dataLockLabel = (test) => {
  if (!isDataLocked(test)) return '';
  const who = test.dataLockedBy ? ` by ${test.dataLockedBy}` : '';
  let when = '';
  if (test.dataLockedAt) {
    try {
      const d = new Date(test.dataLockedAt);
      if (!Number.isNaN(d.getTime())) when = ` on ${d.toLocaleDateString()}`;
    } catch { /* invalid timestamp — keep the label without a date */ }
  }
  return `Data locked${who}${when}`;
};

/** Set or clear the lock fields on ONE instance (returns a new object). */
export const withDataLock = (test, locked, by = '', at = 0) => {
  if (!test) return test;
  const next = { ...test };
  if (locked) {
    next.dataLocked = true;
    next.dataLockedBy = by || test.dataLockedBy || '';
    next.dataLockedAt = at || test.dataLockedAt || Date.now();
  } else {
    delete next.dataLocked;
    delete next.dataLockedBy;
    delete next.dataLockedAt;
  }
  return next;
};

/** Same as withDataLock(…, false): used on the copies so a copy is editable. */
export const clearDataLock = (test) => withDataLock(test, false);

/**
 * Freeze (or unfreeze) every instance whose id is in `ids`.
 * Returns the SAME array reference when nothing has to change, so callers can
 * skip a state update when the lock is already in the wanted state.
 * @param {Array} tests full tests array
 * @param {Set<string>|string[]} ids target instance ids
 * @param {boolean} locked true = freeze, false = reopen
 * @param {string} by name of the superuser performing the change
 * @param {number} at epoch ms
 */
export const applyDataLock = (tests, ids, locked, by = '', at = 0) => {
  const list = Array.isArray(tests) ? tests : [];
  const set = ids instanceof Set ? ids : new Set(ids || []);
  if (!set.size) return list;
  let changed = false;
  const next = list.map((t) => {
    if (!t || !set.has(t.id)) return t;
    const updated = withDataLock(t, locked, by, at);
    if (updated !== t) changed = true;
    return updated;
  });
  return changed ? next : list;
};

/**
 * Guard for the write funnels. Given the stored array (`prev`) and what a
 * non-superuser tried to write (`next`), it puts every frozen instance back to
 * its stored value and re-adds the frozen ones the updater tried to delete —
 * so no analysis can modify or remove frozen data. Two things stay possible:
 *   • brand-new instances (ids not present in `prev`) — i.e. the copies,
 *   • any change to the instances that are NOT frozen.
 * Returns `next` when nothing had to be blocked (same reference → cheap).
 */
export const guardLockedInstances = (prev, next, lockedIds) => {
  if (!Array.isArray(prev) || !Array.isArray(next)) return next;
  if (!lockedIds || lockedIds.size === 0) return next;
  const before = new Map(prev.map((t) => (t && t.id ? [t.id, t] : [null, null])));
  const seen = new Set();
  let blocked = false;
  const out = next.map((t) => {
    if (!t || !t.id) return t;
    seen.add(t.id);
    const old = before.get(t.id);
    if (old && lockedIds.has(t.id) && old !== t) { blocked = true; return old; }
    return t;
  });
  prev.forEach((t) => {
    if (t && t.id && lockedIds.has(t.id) && !seen.has(t.id)) {
      out.push(t); // deleting a frozen instance is not allowed either
      blocked = true;
    }
  });
  return blocked ? out : next;
};

/** How many instances of a list are frozen (used for the header buttons). */
export const countLocked = (tests) => lockedIdSet(tests).size;
