/* =========================================================================
   src/utils/migrateTestImages.js

   One-off maintenance tool: test images that were attached as plain Google
   Drive LINKS (uploaded before the folder/naming conventions existed) are
   moved + renamed on Drive so they follow the CURRENT rules:

       <Lab Workspace>/<dataset>/<project>/<test>/<instance>/Report/<title>_<scientist>.<ext>

   What is scanned (images only — never raw data files):
     • every test image array  (images, nmrSpectraImages, dosyImages, gelImages,
       mdImages, dockingImages, …)  → title "Figure N", section Report
     • test.starredItems[].url      (⭐ figures imported into the project doc)
     • <img src="drive.google.com/..."> inside rich-text HTML (comments, notes)

   The file keeps the SAME Drive id, so every existing link keeps working; the
   URLs stored in the test are normalised to https://drive.google.com/file/d/ID/view
   and the file is registered in the app's Drive file registry so future
   project/test renames update its folder automatically.

   Only files the app created can be moved (drive.file OAuth scope): images
   uploaded to Drive manually are reported as "skipped" and left untouched.
   ========================================================================= */
import {
  getDriveToken,
  getDriveFileMeta,
  findDriveFileByName,
  resolveDrivePathFromNames,
  moveDriveFile,
  renameDriveFile,
  registerDriveFile
} from './driveUpload';
import { driveFolderPath, suggestDriveFileName } from './driveNaming';

/** Matches every Google-Drive URL form the app stores, capturing the file id.
 *  Consumes the scheme + any query/trailing junk (up to a quote/space) so the
 *  whole matched span is exactly the URL that must be replaced. */
const DRIVE_URL_RE = /(?:https?:\/\/)?(?:www\.)?drive\.google\.com\/(?:file\/d\/([a-zA-Z0-9_-]{8,})[^\s"'>]*|open\?[^\s"'>]*?id=([a-zA-Z0-9_-]{8,})[^\s"'>]*|uc\?[^\s"'>]*?id=([a-zA-Z0-9_-]{8,})[^\s"'>]*|thumbnail\?[^\s"'>]*?id=([a-zA-Z0-9_-]{8,})[^\s"'>]*)|(?:https?:\/\/)?lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]{8,})[^\s"'>]*/g;

/** Extract the Drive file id from a single URL ('' when it is not a Drive link). */
export const extractDriveFileId = (url) => {
  const s = String(url || '');
  DRIVE_URL_RE.lastIndex = 0;
  const m = DRIVE_URL_RE.exec(s);
  return m ? (m[1] || m[2] || m[3] || m[4] || m[5] || '') : '';
};

/** Replace every occurrence of the Drive file `fileId` inside `text` with the
 *  canonical share URL (other Drive files are left untouched). */
export const replaceDriveUrlInText = (text, fileId, newUrl) => {
  if (!text || typeof text !== 'string') return text;
  if (!/drive\.google\.com|lh3\.googleusercontent\.com/.test(text)) return text;
  return text.replace(DRIVE_URL_RE, (full, a, b, c, d, e) => {
    const id = a || b || c || d || e;
    return id === fileId ? newUrl : full;
  });
};

/** Image arrays on a test: images, nmrSpectraImages, dosyImages, gelImages,
 *  mdImages, dockingImages, … (any field whose name ends with "images",
 *  case-insensitively — the generic figures array is lowercase "images"). */
const IMAGE_ARRAY_RE = /images$/i;

/** The Drive folder section used for test figures / report images. */
export const TEST_IMAGE_SECTION = 'Report';

/** Collect every Drive-linked IMAGE reference of one test.
 *  @returns [{ where, url, fileId, title, ctx }] */
export const collectTestImageRefs = (test) => {
  const refs = [];
  if (!test || typeof test !== 'object') return refs;

  const ctx = {
    project: (test.projectNames || [])[0] || '',
    test: test.name || '',
    instance: test.instanceName || '',
    scientist: test.operator || '',
    section: TEST_IMAGE_SECTION
  };

  // 1) Image arrays (figures grid on the Report page).
  Object.keys(test).forEach((key) => {
    if (!IMAGE_ARRAY_RE.test(key)) return;
    const arr = test[key];
    if (!Array.isArray(arr)) return;
    arr.forEach((url, index) => {
      const fileId = extractDriveFileId(url);
      if (!fileId) return;
      refs.push({
        where: { field: key, index },
        url: String(url),
        fileId,
        title: `Figure ${index + 1}`,
        ctx: { ...ctx }
      });
    });
  });

  // 2) Starred items (⭐ "Import into the project document") with a Drive URL.
  (Array.isArray(test.starredItems) ? test.starredItems : []).forEach((s, index) => {
    if (!s || !s.url) return;
    const fileId = extractDriveFileId(s.url);
    if (!fileId) return;
    refs.push({
      where: { field: 'starredItems', index },
      url: String(s.url),
      fileId,
      title: (s.label || '').trim() || `Figure ${index + 1}`,
      ctx: { ...ctx }
    });
  });

  // 3) <img> tags inside rich-text HTML (comments, notes, …).
  Object.keys(test).forEach((key) => {
    const val = test[key];
    if (typeof val !== 'string') return;
    if (!/drive\.google\.com|lh3\.googleusercontent\.com/.test(val)) return;
    const imgRe = /<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi;
    let m;
    while ((m = imgRe.exec(val)) !== null) {
      const url = m[1];
      const fileId = extractDriveFileId(url);
      if (!fileId) continue;
      const alt = /alt=["']([^"']*)["']/i.exec(m[0]);
      let title = alt ? alt[1].replace(/&nbsp;|&amp;|&quot;|&lt;|&gt;/g, ' ').trim() : '';
      if (!title) title = `Figure ${refs.length + 1}`;
      refs.push({
        where: { field: key, html: true },
        url,
        fileId,
        title,
        ctx: { ...ctx }
      });
    }
  });

  return refs;
};

/** Count the Drive-linked image references of a test (for the UI). */
export const countTestImageRefs = (tests) =>
  (Array.isArray(tests) ? tests : [])
    .reduce((n, t) => n + collectTestImageRefs(t).length, 0);


/** Pick a folder-unique file name (within this run), avoiding clobbering an
 *  existing different Drive file with the same name. */
const pickUniqueName = async (folderId, desired, usedNames, ownId) => {
  let set = usedNames.get(folderId);
  if (!set) { set = new Set(); usedNames.set(folderId, set); }
  const bump = (n) => {
    const m = /^(.*?)(\.\w+)?$/.exec(desired);
    return `${m ? m[1] : desired}-${n}${m && m[2] ? m[2] : ''}`;
  };
  let name = desired;
  let n = 2;
  while (set.has(name)) { name = bump(n); n += 1; }
  try {
    const existingId = await findDriveFileByName(name, folderId);
    if (existingId && existingId !== ownId) { name = bump(n); n += 1; }
  } catch { /* ignore */ }
  while (set.has(name)) { name = bump(n); n += 1; }
  set.add(name);
  return name;
};

/** Apply the rewritten URL to one reference inside `test` (mutates test). */
const applyRewrite = (test, ref, fileId, newUrl) => {
  const where = ref.where || {};
  if (where.html) {
    const current = typeof test[where.field] === 'string' ? test[where.field] : '';
    test[where.field] = replaceDriveUrlInText(current, fileId, newUrl);
    return;
  }
  if (where.field === 'starredItems') {
    const arr = Array.isArray(test.starredItems) ? test.starredItems : [];
    if (arr[where.index]) arr[where.index] = { ...arr[where.index], url: newUrl };
    return;
  }
  const arr = Array.isArray(test[where.field]) ? test[where.field] : [];
  if (typeof arr[where.index] === 'string') arr[where.index] = newUrl;
};



/**
 * Move every Drive-linked test image into its correct folder and rename it
 * per the current rules. Returns the updated tests (URLs normalised to the
 * canonical /file/d/<id>/view form) and a run summary.
 *
 * @param {{ tests: Array, onProgress?: Function }} options
 * @returns {Promise<{ nextTests: Array, summary: { moved, skipped, failed, details } }>}
 */
export const migrateTestDriveImages = async ({ tests, onProgress = () => {} } = {}) => {
  const list = Array.isArray(tests) ? tests : [];

  // 1) Collect all references (one per image occurrence).
  const allRefs = [];
  list.forEach((test, ti) => {
    collectTestImageRefs(test).forEach((r) => allRefs.push({ test, ti, ...r }));
  });

  const summary = { moved: 0, skipped: 0, failed: 0, details: [] };
  if (allRefs.length === 0) return { nextTests: list, summary };

  if (!getDriveToken()) {
    throw new Error('Google Drive is not connected — connect it from the sidebar first.');
  }

  // 2) Group by Drive file id (one file may be referenced several times).
  const groups = new Map();
  allRefs.forEach((ref) => {
    if (!groups.has(ref.fileId)) groups.set(ref.fileId, []);
    groups.get(ref.fileId).push(ref);
  });

  // 3) Work on a shallow copy; image arrays / starredItems get fresh arrays.
  const nextTests = list.map((t) => ({
    ...t,
    starredItems: Array.isArray(t.starredItems) ? t.starredItems.slice() : t.starredItems
  }));

  const usedNames = new Map();
  const total = groups.size;
  let done = 0;

  for (const [fileId, refs] of groups) {
    const first = refs[0];
    const ctx = first.ctx;
    const testName = (first.test && first.test.name) || '';

    // 4) The file must be app-created to be moved (drive.file scope).
    let meta;
    try {
      meta = await getDriveFileMeta(fileId);
    } catch {
      summary.skipped += 1;
      summary.details.push({
        fileId, test: testName, status: 'skipped',
        reason: 'file was not created by the app (or Drive access expired) — link left unchanged'
      });
      onProgress({ fileId, status: 'skipped' });
      continue;
    }

    const curName = meta.name || '';
    const extMatch = /(\.[a-zA-Z0-9]{1,10})$/.exec(curName);
    const ext = extMatch ? extMatch[1] : '';
    const base = suggestDriveFileName({ ...ctx, title: first.title });

    // 5) Target folder: <project>/<test>/<instance>/Report (created as needed).
    let resolved;
    try {
      resolved = await resolveDrivePathFromNames(driveFolderPath(ctx));
    } catch (err) {
      summary.failed += 1;
      summary.details.push({ fileId, test: testName, status: 'failed', reason: err && err.message });
      onProgress({ fileId, status: 'failed', error: err && err.message });
      continue;
    }

    // 6) Move + rename (collision-safe), then remember the naming context.
    try {
      const finalName = await pickUniqueName(resolved.leafId, base + ext, usedNames, fileId);
      await moveDriveFile(fileId, resolved.leafId);
      if (finalName !== curName) await renameDriveFile(fileId, finalName);
      // Register WITH the title so future project/test renames recompute the
      // same <title>_<scientist> name (instead of falling back to "File").
      registerDriveFile(fileId, finalName, { ...ctx, title: first.title }, resolved.path);
      summary.moved += 1;
      summary.details.push({
        fileId, test: testName, status: 'moved',
        folder: driveFolderPath(ctx).join('/'), name: finalName
      });
    } catch (err) {
      summary.failed += 1;
      summary.details.push({ fileId, test: testName, status: 'failed', reason: err && err.message });
      onProgress({ fileId, status: 'failed', error: err && err.message });
      continue;
    }

    // 7) Normalise every stored reference to the canonical share URL.
    const newUrl = `https://drive.google.com/file/d/${fileId}/view`;
    refs.forEach((ref) => applyRewrite(nextTests[ref.ti], ref, fileId, newUrl));

    done += 1;
    onProgress({ fileId, status: 'moved', done, total });
  }

  return { nextTests, summary };
};
