// Validates the FIX "going to the original experiment and coming back keeps the
// pixels of the canvas".
//
// WHAT WENT WRONG
// The canvas only keeps a SMALL display copy of every figure locally: a library
// figure is stored as a ≤240 px thumbnail (`url`) plus the real pixels on Google
// Drive / Nextcloud (`full`). The Image Builder draws the real pixels, and the
// lightweight payload written to localStorage deliberately holds the THUMBNAIL
// only (a full-resolution figure would blow the storage quota).
//
// So every time the builder was (re)mounted — which is exactly what happens when
// the user leaves for the experiment page ("↗ Open original graph", the automatic
// re-capture run, the test page's ◀ Back…) — the restore used to re-resolve the
// objects from the image library: every panel went back to its ≤240 px thumbnail
// and a background "hydrate" fetch had to bring the full copy back. When that
// fetch failed (expired token, offline, provider hiccup) the raster figures — 📷
// captures, composite panels — stayed blurry while the vector (SVG) ones kept
// their sharpness, because a SVG library entry carries its full copy locally.
// That is the "some images lost their resolution" bug.
//
// THE FIX
// The in-memory session cache (module scope) now keeps TWO copies of every
// canvas it has seen: the lightweight `payload` (localStorage) AND `live` — the
// objects EXACTLY as they are on screen, full-resolution pixels included. The
// restore prefers `live`, so coming back cannot change the pixels at all; the
// library resolution + hydrate path only runs for a canvas this session has not
// opened yet (first visit after a reload, or an entry the LRU cap dropped).
//
// The component cannot be imported here (JSX module), so the rules under test
// are mirrored verbatim from src/components/ImageBuilder.jsx — keep both in sync:
//   * getObjImagesOf / thumbnailsOf   — the lightweight persisted copy
//   * resolveLibImage / resolveObj    — the library resolution (thumbnail+hint)
//   * rememberSessionCanvas           — the live copy + the LRU cap
//   * the restore effect's precedence — `live` first, library resolution else
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const IB = read('src/components/ImageBuilder.jsx');

const results = [];
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push({ name, got: String(got), want: String(want), ok });
  return ok;
};
const checkTrue = (name, got) => check(name, !!got, true);
const frag = (name, hay, needle) => checkTrue(`${name}: ${needle.slice(0, 44)}…`, hay.includes(needle));

// ---- mirrors of the ImageBuilder helpers under test ------------------------
// (the library the component reads — readProjectLibrary / readLibrary — is
//  passed in as a flat item list here)
const getObjImagesOf = (obj) => {
  if (Array.isArray(obj.images) && obj.images.length) return obj.images;
  if (obj && obj.imgSrc) return [{ imgSrc: obj.imgSrc, imgThumb: obj.imgThumb, libId: obj.libId, libScope: obj.libScope, libProjectId: obj.libProjectId, src: obj.src }];
  return [];
};
const thumbnailsOf = (obj) => {
  const images = getObjImagesOf(obj).map((im) => ({ ...im, imgSrc: im.imgThumb || im.imgSrc }));
  const first = images[0] || {};
  return {
    ...obj,
    images,
    imgSrc: first.imgSrc || obj.imgThumb || obj.imgSrc || null,
    imgThumb: first.imgThumb || first.imgSrc || obj.imgThumb || null
  };
};

const LIVE_CACHE_MAX = 6;
const imageBuilderSessionCache = new Map();
const rememberSessionCanvas = (key, payload, live) => {
  const entry = imageBuilderSessionCache.get(key) || {};
  entry.payload = payload;
  entry.live = live;
  imageBuilderSessionCache.delete(key);
  imageBuilderSessionCache.set(key, entry);
  let kept = 0;
  const older = [];
  imageBuilderSessionCache.forEach((e, k) => {
    if (!e || !e.live) return;
    kept += 1;
    if (k !== key) older.push(k);
  });
  while (kept > LIVE_CACHE_MAX && older.length) {
    const e = imageBuilderSessionCache.get(older.shift());
    if (e && e.live) { e.live = null; kept -= 1; }
  }
};

const resolveLibImage = (im, libItems) => {
  if (!im || !im.libId) return im;
  const it = (libItems || []).find((x) => x.id === im.libId);
  if (!it) return im;
  // `full` may be a Google Drive URL (image stored on Drive): keep the local
  // thumbnail as the display source and let the hydrate pass upgrade to the
  // full-resolution data URL in the background.
  const fullData = it.full && String(it.full).startsWith('data:') ? it.full : null;
  return { ...im, imgSrc: fullData || it.url || it.full, imgThumb: it.url || it.full, _srcHint: it.full && !String(it.full).startsWith('data:') ? it.full : null };
};
const resolveObj = (o, libItems) => {
  const images = getObjImagesOf(o).map((im) => resolveLibImage(im, libItems));
  const first = images[0] || {};
  return {
    ...o,
    images,
    imgSrc: first.imgSrc || o.imgSrc || null,
    imgThumb: first.imgThumb || o.imgThumb || null,
    libId: first.libId || o.libId || null,
    libScope: first.libScope || o.libScope || null,
    libProjectId: first.libProjectId || o.libProjectId || null,
    src: first.src || o.src || null
  };
};

// Mirror of the restore effect's object choice: `live` wins, the library
// resolution is the fallback for a canvas this session has not opened yet.
const restoreObjects = (cached, payload, libItems) => {
  if (!payload || !payload.objects) return null;
  const live = (cached && Array.isArray(cached.live)) ? cached.live : null;
  return live || payload.objects.map((o) => (
    (!o.libId && !(o.images || []).some((im) => im && im.libId)) ? o : resolveObj(o, libItems)
  ));
};
// ===========================================================================
// 0) Sample figures
// ===========================================================================
const THUMB = 'data:image/jpeg;base64,THUMB-240px';   // figureThumb (≤240 px)
const FULL  = 'data:image/jpeg;base64,FULL-2000px';   // the hi copy, still local
const DRIVE = 'https://drive.google.com/file/d/LIBFILE/view?usp=drivesdk';
const SVG   = 'data:image/svg+xml;base64,PHN2Zy8+';    // vector capture

// A raster figure captured with 📷: the real copy lives on Drive, only the
// 240 px thumbnail stays in the browser.
const rasterObj = {
  id: 'obj1', x: 0, y: 0, w: 1, h: 1, letter: 'A',
  imgSrc: FULL, imgThumb: THUMB, libId: 'lib1', libScope: 'project', libProjectId: 'P1',
  images: [{ imgSrc: FULL, imgThumb: THUMB, libId: 'lib1', libScope: 'project', libProjectId: 'P1', dx: 0, dy: 0, scale: 1 }],
  texts: []
};
const RASTER_LIB = [{ id: 'lib1', label: 'EPR spectrum', url: THUMB, full: DRIVE, src: { testId: 't1' } }];

// The same panel, but the cloud upload failed: the full copy stayed local.
const LOCAL_LIB = [{ id: 'lib2', label: 'local copy', url: THUMB, full: FULL }];

// A vector figure: url === full === the SVG itself, so it never needed Drive.
const svgObj = { ...rasterObj, id: 'obj3', imgSrc: SVG, imgThumb: SVG, libId: 'lib3', images: [{ imgSrc: SVG, imgThumb: SVG, libId: 'lib3' }] };
const SVG_LIB = [{ id: 'lib3', label: 'svg chart', url: SVG, full: SVG }];

// A figure with no library link at all.
const bareObj = { id: 'obj4', x: 1, y: 0, w: 1, h: 1, letter: 'B', imgSrc: FULL, imgThumb: THUMB, images: [{ imgSrc: FULL, imgThumb: THUMB }], texts: [] };

// ===========================================================================
// 1) The fix is wired in the component
// ===========================================================================
frag('[ImageBuilder] the session cache is module scope (survives a module remount)', IB, 'const imageBuilderSessionCache = new Map();');
frag('[ImageBuilder] the live copy is capped', IB, 'const LIVE_CACHE_MAX = 6;');
frag('[ImageBuilder] one entry holds both copies', IB, 'const rememberSessionCanvas = (key, payload, live) => {');
frag('[ImageBuilder] ...the lightweight payload', IB, 'entry.payload = payload;');
frag('[ImageBuilder] ...and the live objects', IB, 'entry.live = live;');
frag('[ImageBuilder] the canvas just edited becomes the most recent', IB, 'imageBuilderSessionCache.delete(key);');
frag('[ImageBuilder] the oldest canvases drop their live copy first', IB, 'while (kept > LIVE_CACHE_MAX && older.length) {');
frag('[ImageBuilder] ...and keep working from their payload', IB, 'if (e && e.live) { e.live = null; kept -= 1; }');

frag('[ImageBuilder] the restore reads the cache entry', IB, 'const cached = imageBuilderSessionCache.get(storageKey) || null;');
frag('[ImageBuilder] the payload is what localStorage holds', IB, 'const saved = (cached && cached.payload) || (() => {');
frag('[ImageBuilder] the live objects are read when this session has them', IB, 'const live = (cached && Array.isArray(cached.live)) ? cached.live : null;');
frag('[ImageBuilder] the live objects WIN over the library resolution', IB, 'setObjects(live || (data.objects || []).map((o) => {');
frag('[ImageBuilder] every canvas edit refreshes the live copy', IB, 'rememberSessionCanvas(storageKey, payload, objects || []);');

check('the cache is no longer overwritten with the payload alone (that would drop `live`)',
  IB.includes('imageBuilderSessionCache.set(storageKey, payload);'), false);
check('the restore no longer re-resolves the canvas unconditionally (the old bug)',
  IB.includes('setObjects((data.objects || []).map((o) => {'), false);

// ---- anchor: the samples and the wiring are done ---------------------------

// ===========================================================================
// 2) What the persisted payload really holds (why `live` has to exist)
// ===========================================================================
const persistedRaster = thumbnailsOf(rasterObj);
check('the persisted copy of a cloud-backed figure is the THUMBNAIL',
  [persistedRaster.imgSrc === THUMB, persistedRaster.images[0].imgSrc === THUMB], [true, true]);
check('...the full-resolution pixels are NOT in localStorage',
  [persistedRaster.imgSrc === FULL, persistedRaster.imgSrc === DRIVE], [false, false]);
check('the figure keeps its library link (that is what allows re-resolution)',
  persistedRaster.images[0].libId, 'lib1');

const payload = { canvasW: 180, canvasH: 120, objects: [persistedRaster, thumbnailsOf(svgObj), thumbnailsOf(bareObj)] };

// ===========================================================================
// 3) COLD restore (no live copy) — the bug, and why only SOME images lost it
// ===========================================================================
const coldLib = [...RASTER_LIB, ...LOCAL_LIB, ...SVG_LIB];
const cold = restoreObjects(null, payload, coldLib);
check('[cold] a cloud-backed raster figure falls back to its 240 px thumbnail (RESOLUTION LOST)',
  cold[0].imgSrc, THUMB);
check('[cold] ...and is left depending on a cloud fetch', cold[0].images[0]._srcHint, DRIVE);
check('[cold] the vector figure keeps its own locally stored copy — it never lost resolution',
  cold[1].imgSrc, SVG);
check('[cold] a figure with no library link also drops to its thumbnail (same bug)',
  cold[2].imgSrc, THUMB);

// A LOCAL library figure (the cloud upload failed) survives the cold restore:
// its `full` copy is a dataURL. That is the other half of "only SOME images".
const coldLocal = restoreObjects(null, { objects: [thumbnailsOf({ ...rasterObj, id: 'q', libId: 'lib2', images: [{ imgSrc: FULL, imgThumb: THUMB, libId: 'lib2' }] })] }, LOCAL_LIB);
check('[cold] a figure whose full copy stayed local is restored at full resolution',
  coldLocal[0].imgSrc, FULL);

// ===========================================================================
// 4) WARM restore (same session) — the fix: the pixels do not move at all
// ===========================================================================
const liveObjects = [rasterObj, svgObj, bareObj];
rememberSessionCanvas('labImageBuilder_P1', payload, liveObjects);
const entry = imageBuilderSessionCache.get('labImageBuilder_P1');
check('the cache keeps the payload AND the live objects',
  [!!entry.payload, entry.live === liveObjects], [true, true]);

const warm = restoreObjects(entry, entry.payload, RASTER_LIB);
check('[warm] the canvas is restored EXACTLY as it was (same objects, same pixels)',
  [warm === liveObjects, warm[0].imgSrc === FULL], [true, true]);
check('[warm] a cloud-backed figure is NOT downgraded to its thumbnail',
  [warm[0].imgSrc === THUMB, warm[0].images[0].imgSrc === FULL], [false, true]);
check('[warm] no cloud fetch is needed to bring the resolution back',
  [warm[0].images[0]._srcHint, warm[0].images[0].imgSrc !== FULL], [undefined, false]);
check('[warm] the figure keeps its own pixels as well',
  warm[0].images[0].imgSrc, FULL);
check('[warm] cropping / scaling / caption of the figure are preserved too',
  [warm[0].images[0].dx, warm[0].images[0].scale, warm[0].letter], [0, 1, 'A']);
check('[warm] the figure with no library link keeps its pixels as well',
  warm[2].imgSrc, FULL);

// Coming back twice in a row (experiment → builder → experiment → builder)
// changes nothing: the live copy is what the canvas was showing.
const backAgain = restoreObjects(imageBuilderSessionCache.get('labImageBuilder_P1'), payload, RASTER_LIB);
check('[warm] a second round trip is pixel-identical too', backAgain[0].imgSrc, FULL);

// A canvas whose live copy was dropped still restores (thumbnail-first), and it
// is the ONLY case that goes through the library resolution again.
const dropped = restoreObjects({ payload, live: null }, payload, coldLib);
check('a canvas without a live copy still restores its layout',
  [dropped.length, dropped[0].imgSrc === THUMB, dropped[1].imgSrc === SVG], [3, true, true]);

// ---- anchor: the cold / warm restores are done -----------------------------

// ===========================================================================
// 5) The LRU cap: memory stays bounded, the edited canvas never loses its copy
// ===========================================================================
imageBuilderSessionCache.clear();
for (let i = 1; i <= 8; i++) {
  const obj = {
    ...rasterObj, id: `keyObj${i}`, imgSrc: `${FULL}#${i}`, imgThumb: THUMB,
    images: [{ imgSrc: `${FULL}#${i}`, imgThumb: THUMB, libId: 'lib1' }]
  };
  rememberSessionCanvas(`labImageBuilder_C${i}`, { objects: [thumbnailsOf(obj)] }, [obj]);
}
const liveKeys = [...imageBuilderSessionCache.entries()].filter(([, e]) => !!(e && e.live)).map(([k]) => k);
check('at most LIVE_CACHE_MAX canvases keep their pixels', liveKeys.length, LIVE_CACHE_MAX);
check('the canvases that keep them are the most recently edited ones',
  liveKeys.map((k) => k.replace('labImageBuilder_', '')), ['C3', 'C4', 'C5', 'C6', 'C7', 'C8']);
check('the older canvases keep their payload (they still re-open)',
  [...imageBuilderSessionCache.values()].filter((e) => !!e.payload).length, 8);
const oldEntry = imageBuilderSessionCache.get('labImageBuilder_C1');
check('...and their restored resolution is the thumbnail fallback',
  restoreObjects(oldEntry, oldEntry.payload, RASTER_LIB)[0].imgSrc, THUMB);

// Editing an older canvas again must bring its pixels back into the cache.
rememberSessionCanvas('labImageBuilder_C1', { objects: [] }, [{ ...rasterObj, imgSrc: `${FULL}#1new` }]);
check('re-editing an old canvas makes it the most recent again',
  [...imageBuilderSessionCache.keys()].pop(), 'labImageBuilder_C1');
check('...so its pixels are kept again',
  imageBuilderSessionCache.get('labImageBuilder_C1').live[0].imgSrc, `${FULL}#1new`);
check('...and the least recently edited canvases are the ones that lost them',
  [...imageBuilderSessionCache.entries()].filter(([, e]) => !(e && e.live)).map(([k]) => k), ['labImageBuilder_C2', 'labImageBuilder_C3']);
check('the cap still holds after the re-edit',
  [...imageBuilderSessionCache.values()].filter((e) => !!(e && e.live)).length, LIVE_CACHE_MAX);
check('no canvas was dropped from the cache (all 8 still re-open)',
  imageBuilderSessionCache.size, 8);

console.table(results);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `❌ ${failed.length} check(s) failed` : `✅ ${results.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);




