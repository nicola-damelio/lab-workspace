/* =========================================================================
   fcsBlobStore.js — IndexedDB persistence for raw .fcs files.

   The parsed FCS data lives in the in-memory globalFcsCache (fast) and, for
   small files, is also serialized onto the test object (fcParsed). Files
   larger than ~600 KB are kept ONLY in memory and would be lost on a page
   reload; storing the raw file in IndexedDB makes it survive reloads on the
   same browser. Google Drive remains the cross-device backup ("Restore from
   Drive").

   This file is intentionally small and lives in utils/ so that test-deletion
   code (testsModule / activeTestModule) can clean up blobs without importing
   the heavy FlowCytometrySections chunk.
   ========================================================================= */

import { blobStore } from './blobStore';

export const fcsBlobKey = (id) => `fcs_${id}`;

/** @returns {Promise<boolean>} */
export const saveFcsFile = async (id, file) => {
  if (!id || !file) return false;
  return blobStore.save(fcsBlobKey(id), { filename: file.name || 'fcs', file });
};

/** @returns {Promise<{ filename: string, file: Blob|File }|null>} */
export const loadFcsFile = async (id) => {
  if (!id) return null;
  return blobStore.load(fcsBlobKey(id));
};

/** @returns {Promise<void>} */
export const removeFcsFile = async (id) => {
  if (!id) return;
  await blobStore.remove(fcsBlobKey(id));
};

/** Remove the IndexedDB copies for a test's FCS files (main + extras). */
export const removeTestFcsBlobs = async (test = {}) => {
  if (!test || typeof test !== 'object' || !test.id) return;
  await removeFcsFile(test.id);
  (test.fcExtraFiles || []).forEach((f) => { if (f && f.id) removeFcsFile(f.id); });
};
