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
  getDriveFileRegistry,
  findDriveFileByName,
  resolveDrivePathFromNames,
  moveDriveFile,
  renameDriveFile,
  registerDriveFile,
  trashEmptyFolderChain,
  uploadLocalFile
} from './driveUpload';
import { driveFolderPath, suggestDriveFileName, sanitizeSlug } from './driveNaming';

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

/** Anchor texts that do not make a meaningful file title (fall back to the
 *  downloaded file's real name / "Attachment N"). */
const TRIVIAL_LINK_TITLES = new Set([
  '', 'link', 'here', 'download', 'open', 'file', 'attach', 'attachment',
  'attached', 'attached file', 'view', 'open file', 'download file', 'click here'
]);

/** Title for a test document: its name without the extension, minus a trailing
 *  "<scientist>" suffix (uploaded documents already carry it) so we never end
 *  up with "<name>_<scientist>_<scientist>.pdf". */
const docTitleFromName = (name, scientist) => {
  let base = String(name || '').trim().replace(/\.[a-zA-Z0-9]{1,10}$/, '');
  const sciSlug = sanitizeSlug(String(scientist || '').trim());
  if (sciSlug) {
    try {
      base = base.replace(new RegExp('_?' + sciSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'), '');
    } catch { /* keep the name as-is */ }
  }
  return base.trim();
};

/** Instances are grouped by test name. An instance with NO instanceName is an
 *  UNNAMED instance — give it a real name ("instance1", "instance2", …) based
 *  on its position among the unnamed siblings (same order the app uses:
 *  instanceOrder first, then date), so every instance maps to its own Drive
 *  folder (<test>/<instance>/Report/…). */
export const effectiveInstanceName = (test, allTests) => {
  if (!test) return '';
  const own = String(test.instanceName || '').trim();
  if (own) return own;
  const siblings = (Array.isArray(allTests) ? allTests : [])
    .filter((t) => t && String(t.name || '') === String(test.name || '') && String(t.name || '').trim() !== '');
  const ordered = siblings.slice().sort((a, b) => {
    const oa = a.instanceOrder;
    const ob = b.instanceOrder;
    const hasA = Number.isFinite(oa);
    const hasB = Number.isFinite(ob);
    if (hasA && hasB) return oa - ob;
    if (hasA) return -1;
    if (hasB) return 1;
    return (a.date || '').localeCompare(b.date || '');
  });
  const unnamed = ordered.filter((t) => !t.instanceName || !String(t.instanceName).trim());
  const idx = unnamed.findIndex((t) => t.id === test.id);
  return `instance${idx >= 0 ? idx + 1 : unnamed.length + 1}`;
};

/** Collect every Drive-linked FILE reference of one test — figures/images,
 *  ⭐ starred items, attached documents (PDFs etc.) and every <img>/<a> that
 *  points at a Drive file inside rich-text HTML.
 *  `allTests` (optional) is used to name unnamed instances ("instance1", …).
 *  @returns [{ where, url, fileId, title, ctx }] */
export const collectTestImageRefs = (test, allTests) => {
  const refs = [];
  if (!test || typeof test !== 'object') return refs;

  const ctx = {
    project: (test.projectNames || [])[0] || '',
    test: test.name || '',
    // Instances are grouped by test name; each instance keeps its own label
    // (instanceName). Unnamed instances get a real name ("instance1", …) so
    // every instance maps to its own Drive folder.
    instance: effectiveInstanceName(test, allTests),
    scientist: test.operator || '',
    section: TEST_IMAGE_SECTION
  };

  const addRef = (where, url, title) => {
    const fileId = extractDriveFileId(url);
    if (!fileId) return;
    refs.push({ where, url: String(url), fileId, title: String(title || '').trim(), ctx: { ...ctx } });
  };

  // 1) Image arrays (figures grid on the Report page).
  Object.keys(test).forEach((key) => {
    if (!IMAGE_ARRAY_RE.test(key)) return;
    const arr = test[key];
    if (!Array.isArray(arr)) return;
    arr.forEach((url, index) => addRef({ field: key, index }, url, `Figure ${index + 1}`));
  });

  // 2) Starred items (⭐ "Import into the project document") with a Drive URL.
  (Array.isArray(test.starredItems) ? test.starredItems : []).forEach((s, index) => {
    if (!s || !s.url) return;
    addRef({ field: 'starredItems', index }, s.url, (s.label || '').trim() || `Figure ${index + 1}`);
  });

  // 3) Attached documents (PDFs, data sheets, …) — Report → Documents.
  (Array.isArray(test.documents) ? test.documents : []).forEach((doc, index) => {
    if (!doc || !doc.data) return;
    addRef(
      { field: 'documents', index },
      doc.data,
      docTitleFromName(doc.name, ctx.scientist) || `Document ${index + 1}`
    );
  });

  // 4) <img> and <a href> pointing at Drive files inside rich-text HTML.
  Object.keys(test).forEach((key) => {
    const val = test[key];
    if (typeof val !== 'string') return;
    if (!/drive\.google\.com|lh3\.googleusercontent\.com/.test(val)) return;

    const imgRe = /<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi;
    let m;
    while ((m = imgRe.exec(val)) !== null) {
      const url = m[1];
      if (!extractDriveFileId(url)) continue;
      const alt = /alt=["']([^"']*)["']/i.exec(m[0]);
      let title = alt ? alt[1].replace(/&nbsp;|&amp;|&quot;|&lt;|&gt;/g, ' ').trim() : '';
      if (!title) title = `Figure ${refs.length + 1}`;
      addRef({ field: key, html: true }, url, title);
    }

    const aRe = /<a\b[^>]*?\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = aRe.exec(val)) !== null) {
      const url = m[1];
      if (!extractDriveFileId(url)) continue;
      const text = String(m[2] || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;|&amp;|&quot;|&lt;|&gt;/g, ' ')
        .replace(/\s+/g, ' ').trim();
      addRef({ field: key, html: true, link: true }, url, TRIVIAL_LINK_TITLES.has(text.toLowerCase()) ? '' : text);
    }
  });

  return refs;
};

/** Count the Drive-linked file references of a test (for the UI). */
export const countTestImageRefs = (tests) =>
  (Array.isArray(tests) ? tests : [])
    .reduce((n, t) => n + collectTestImageRefs(t, tests).length, 0);

/** DRY-RUN preview — shows, for every test with Drive-linked files, the exact
 *  target Drive folder and the instance name the migration will use. Nothing
 *  is touched on Drive. Lets the user verify the <project>/<test>/<instance>/
 *  <section> layout (and spot empty instance names) before running. */
export const previewTestDriveFiles = (tests) =>
  (Array.isArray(tests) ? tests : [])
    .map((t) => {
      const refs = collectTestImageRefs(t, tests);
      if (refs.length === 0) return null;
      const ctx = refs[0].ctx;
      const named = Boolean(t.instanceName && String(t.instanceName).trim());
      return {
        test: t.name || '(untitled)',
        id: t.id || '',
        instanceName: effectiveInstanceName(t, tests),
        autoNamed: !named,
        folder: ['Lab Workspace', '<dataset>', ...driveFolderPath(ctx)].join('/'),
        files: refs.map((r) => ({ title: r.title || '(link)', url: r.url }))
      };
    })
    .filter(Boolean);


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

/** Apply the rewritten URL to one reference inside `test` (mutates test).
 *  Copy-on-write for arrays, so the original test objects (and the undo
 *  history) are never touched. */
const applyRewrite = (test, ref, fileId, newUrl) => {
  const where = ref.where || {};
  if (where.html) {
    const current = typeof test[where.field] === 'string' ? test[where.field] : '';
    test[where.field] = replaceDriveUrlInText(current, fileId, newUrl);
    return;
  }
  if (where.field === 'starredItems') {
    const arr = (Array.isArray(test.starredItems) ? test.starredItems : []).slice();
    if (arr[where.index]) arr[where.index] = { ...arr[where.index], url: newUrl };
    test.starredItems = arr;
    return;
  }
  if (where.field === 'documents') {
    const arr = (Array.isArray(test.documents) ? test.documents : []).slice();
    if (arr[where.index] && typeof arr[where.index] === 'object') {
      arr[where.index] = { ...arr[where.index], data: newUrl };
    }
    test.documents = arr;
    return;
  }
  const arr = (Array.isArray(test[where.field]) ? test[where.field] : []).slice();
  if (typeof arr[where.index] === 'string') arr[where.index] = newUrl;
  test[where.field] = arr;
};

/** Extension → MIME type (used when re-uploading an image copied from Drive). */
const EXT_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  '.ico': 'image/x-icon', '.heic': 'image/heic', '.pdf': 'application/pdf'
};
/** Reverse map: MIME type → extension (fallback when Drive sends no filename). */
const MIME_EXT = Object.entries(EXT_MIME).reduce((acc, [ext, mime]) => {
  if (!acc[mime]) acc[mime] = ext;
  return acc;
}, {});

/** Candidate download URLs, most likely to work first. `uc` gives the real
 *  filename but is often CORS-blocked; `drive.usercontent.google.com` and
 *  `lh3.googleusercontent.com` are the CORS-friendly endpoints (the same pair
 *  the rest of the app uses for pulse-sequence and image downloads). */
const driveDownloadCandidates = (fileId) => [
  `https://drive.google.com/uc?export=download&id=${fileId}`,
  `https://drive.usercontent.google.com/download?id=${fileId}&export=download`,
  `https://lh3.googleusercontent.com/d/${fileId}`
];

/** Download the bytes of a publicly-shared Drive file by trying every known
 *  download endpoint. Throws with an actionable message when the file is not
 *  publicly downloadable (private, or sharing "Anyone with the link" is off). */
export const downloadDriveFileBytes = async (fileId) => {
  let lastError = null;
  for (const url of driveDownloadCandidates(fileId)) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }
      const contentType = String(res.headers.get('content-type') || '').split(';')[0].trim();
      if (contentType === 'text/html') {
        lastError = new Error('login page (file is private)');
        continue;
      }
      const bytes = await res.arrayBuffer();
      if (!bytes || bytes.byteLength === 0) {
        lastError = new Error('empty response');
        continue;
      }
      const cd = String(res.headers.get('content-disposition') || '');
      const m = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(cd);
      const name = m ? decodeURIComponent(m[1].replace(/"/g, '')).trim() : '';
      return { bytes, mimeType: contentType || 'application/octet-stream', name: name || '' };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('download failed');
};





/**
 * Move every Drive-linked test image into its correct folder and rename it
 * per the current rules. Files not created by the app (drive.file scope) are
 * downloaded and re-uploaded as app files into the same folder. Returns the
 * updated tests (URLs normalised to the canonical /file/d/<id>/view form)
 * and a run summary.
 *
 * @param {{ tests: Array, onProgress?: Function }} options
 * @returns {Promise<{ nextTests: Array, summary: { moved, copied, skipped, failed, details } }>}
 */
export const migrateTestDriveImages = async ({ tests, onProgress = () => {} } = {}) => {
  const list = Array.isArray(tests) ? tests : [];

  // 1) Work on a shallow copy; image arrays / starredItems get fresh arrays.
  const nextTests = list.map((t) => ({
    ...t,
    starredItems: Array.isArray(t.starredItems) ? t.starredItems.slice() : t.starredItems
  }));

  // 1b) UNNAMED instances get a real name ("instance1", "instance2", … in the
  // sibling order) so every instance maps to its own Drive folder
  // (<test>/<instance>/Report/…). Applied to ALL tests, even without files,
  // so future app uploads land in the same folder too.
  nextTests.forEach((t, i) => {
    if (!t.instanceName || !String(t.instanceName).trim()) {
      nextTests[i] = { ...t, instanceName: effectiveInstanceName(t, nextTests) };
    }
  });

  // 2) Collect all references (one per file occurrence).
  const allRefs = [];
  nextTests.forEach((test, ti) => {
    collectTestImageRefs(test, nextTests).forEach((r) => allRefs.push({ test, ti, ...r }));
  });

  const summary = { moved: 0, copied: 0, skipped: 0, failed: 0, details: [] };
  if (allRefs.length === 0) return { nextTests, summary };

  if (!getDriveToken()) {
    throw new Error('Google Drive is not connected — connect it from the sidebar first.');
  }

  // 3) Group by Drive file id (one file may be referenced several times).
  const groups = new Map();
  allRefs.forEach((ref) => {
    if (!groups.has(ref.fileId)) groups.set(ref.fileId, []);
    groups.get(ref.fileId).push(ref);
  });

  const usedNames = new Map();
  const total = groups.size;
  let done = 0;

  for (const [fileId, refs] of groups) {
    const first = refs[0];
    const ctx = first.ctx;
    const testName = (first.test && first.test.name) || '';
    const folderPath = driveFolderPath(ctx);
    const folderLabel = folderPath.join('/');
    let newUrl = '';
    let status = '';
    let finalName = '';

    // 5a) Fast path — the file was created by the app: move + rename in place.
    // The target folder is created ONLY once we know the file is real, so
    // skipped/deleted files never leave empty folders behind on Drive.
    try {
      const meta = await getDriveFileMeta(fileId);
      const curName = meta.name || '';
      const extMatch = /(\.[a-zA-Z0-9]{1,10})$/.exec(curName);
      const ext = extMatch ? extMatch[1] : '';
      // Fall back to the file's own name when the reference has no title
      // (e.g. an <a href> link with a generic anchor text).
      const curBase = curName.replace(/\.[a-zA-Z0-9]{1,10}$/, '');
      const base = suggestDriveFileName({ ...ctx, title: first.title || curBase });
      const resolved = await resolveDrivePathFromNames(folderPath);
      finalName = await pickUniqueName(resolved.leafId, base + ext, usedNames, fileId);
      const oldPath = (getDriveFileRegistry()[fileId] || {}).path || null;
      await moveDriveFile(fileId, resolved.leafId);
      if (finalName !== curName) await renameDriveFile(fileId, finalName);
      // Register WITH the title so future project/test renames recompute the
      // same <title>_<scientist> name (instead of falling back to "File").
      registerDriveFile(fileId, finalName, { ...ctx, title: first.title || curBase }, resolved.path);
      // The folder the file just left may now be empty (e.g. an instance-less
      // <test>/Report from an earlier run) — trash it so Drive stays tidy.
      if (Array.isArray(oldPath) && oldPath.length > 0) {
        try { await trashEmptyFolderChain(oldPath); } catch { /* keep going */ }
      }
      newUrl = `https://drive.google.com/file/d/${fileId}/view`;
      status = 'moved';
    } catch {
      // 5b) Fallback — not app-created (drive.file scope cannot move it): copy
      // the public bytes into a NEW app-created file in the correct folder.
      // The download happens FIRST; the folder is created only afterwards, so
      // un-downloadable files are skipped WITHOUT leaving empty folders.
      try {
        const dl = await downloadDriveFileBytes(fileId);
        const dlNameExt = dl.name ? /(\.[a-zA-Z0-9]{1,10})$/.exec(dl.name) : null;
        const ext = dlNameExt
          ? dlNameExt[1]
          : (MIME_EXT[dl.mimeType] || '');
        const mime = (ext && EXT_MIME[ext.toLowerCase()]) || dl.mimeType || 'application/octet-stream';
        // Prefer a meaningful reference title; otherwise use the real file name
        // Google sent back with the download.
        const dlBase = (dl.name || '').replace(/\.[a-zA-Z0-9]{1,10}$/, '');
        const base = suggestDriveFileName({ ...ctx, title: first.title || dlBase });
        const resolved = await resolveDrivePathFromNames(folderPath);
        finalName = await pickUniqueName(resolved.leafId, base + ext, usedNames, '');
        const drive = await uploadLocalFile({
          name: finalName,
          mimeType: mime,
          file: new Blob([dl.bytes], { type: mime }),
          ctx: { ...ctx, title: first.title || dlBase }
        });
        // uploadLocalFile already registered the file — re-register WITH title
        // so future renames keep the <title>_<scientist> name.
        registerDriveFile(drive.id, finalName, { ...ctx, title: first.title || dlBase }, resolved.path);
        newUrl = drive.driveUrl;
        status = 'copied';
      } catch (copyErr) {
        summary.skipped += 1;
        summary.details.push({
          fileId, test: testName, status: 'skipped',
          reason: `cannot be downloaded (${copyErr && copyErr.message || 'unknown'}). ` +
                  `Open the file on Google Drive and set sharing to "Anyone with the link", then run again.`
        });
        onProgress({ fileId, status: 'skipped' });
        continue;
      }
    }

    // 6) Normalise every stored reference to the (new) canonical share URL.
    refs.forEach((ref) => applyRewrite(nextTests[ref.ti], ref, fileId, newUrl));
    summary[status] += 1;
    summary.details.push({
      fileId, test: testName, status,
      folder: folderLabel, name: finalName
    });

    done += 1;
    onProgress({ fileId, status, done, total });
  }

  return { nextTests, summary };
};
