import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  readLibrary, readProjectLibrary, readVisibleProjectLibrary, moveLibraryItem, reorderLibraryItem,
  renameLibraryItem, removeLibraryItem, renameProjectLibraryItem, removeProjectLibraryItem,
  blobToDataUrl, publishLibraryFigure, resolveImageToDataUrl, localStorageHealthy,
  countRecaptureDuplicates, removeRecaptureDuplicates,
  pushLibraryToDrive, pullLibraryFromDrive, localOnlyLibraryItems, mergeLibraryFromSnapshot
} from '../utils/figuresLibrary';
import {
  freeRectOf, isFreeLayout, pinRectOf, freeSlotFor, RECT_MIN, RECT_MAX, moveFigureInList
} from '../utils/figureLayout';
import {
  firstFreeCellIn, buildCopyPayload, parseCopyPayload, pastePanels
} from '../utils/objectClipboard';
import {
  moveSelectionPatches, moveFiguresPatches, resizedBox, resizeSelectionPatches,
  figureResizeFactor, resizeFiguresPatches
} from '../utils/panelSelection';
import {
  ERASE_SIZE_MIN, ERASE_SIZE_MAX, ERASE_DEFAULT_SIZE, clampEraseSize,
  eraseStrokesOf, mmStrokeHits, pushStrokePoint, mmStrokeToSource, maskStrokesMm, eraseMaskId
} from '../utils/figureErase';
import LZString from 'lz-string';
import { backupFigureCount, figuresFromBackupHtml } from '../utils/referenceImport';
import { loadProjects, saveProjects, genProjectId, projectAccessFor, visibleProjectsFor } from './AppModules/projectsModule';
import { getDriveRootName } from '../utils/driveUpload';
import { projectImagesFolderLabel } from '../utils/driveNaming';
import { queuePendingFigureScroll } from '../utils/pendingFigureScroll';
import { figureStyleTag } from '../utils/figureStyle';
import {
  queueFigureRecaptures, figureRecaptureSummary, subscribeFigureRecapture, hasFreshFigureRecapture,
  stopFigureRecaptures
} from '../utils/figureRecapture';
import { useFigureStyleProfile } from './FigureStyleTools';
import { ShadowControls, ArrowPropertiesPanel } from './FigureArrowPanel';
import {
  newArrow, normalizeArrow, arrowGeometry, arrowHeadPath, shadowSpec, shadowFilterId,
  figureShadowFilterId, DEFAULT_SHADOW
} from '../utils/figureArrows';

const ptToMm = (pt) => pt * 0.352778;
const PX_PER_MM = 96 / 25.4; // CSS: 1 mm ≈ 3.78 px

// In-memory session cache of the Image Builder state (keyed like the
// localStorage entry). The canvas is persisted to localStorage too, but large
// full-resolution figures can blow past the quota and make setItem silently
// fail — the in-memory copy always survives, so navigating to the original
// graph and back NEVER loses the user's edits within this session.
// Every entry holds TWO copies of one canvas:
//   • payload — the lightweight one (the small thumbnails instead of the
//     full-resolution dataURLs); it is what gets written to localStorage.
//   • live    — the objects EXACTLY as they are on screen, full-resolution
//     pixels included. It is never serialized, so it cannot blow the quota,
//     and it is what the builder restores when the user comes back from the
//     original experiment (same browser session): the panels keep the pixels
//     they were showing.
// Re-resolving the panels from the image library instead drops every figure
// back to its ≤240 px LOCAL THUMBNAIL and then depends on a live Google Drive /
// Nextcloud fetch to bring the full copy back. When that fetch fails (expired
// token, offline, provider hiccup) the raster figures (📷 captures, composite
// panels) stayed blurry while the vector (SVG) ones kept their sharpness —
// exactly the “some images lost their resolution” bug. See the restore effect
// below, which prefers `live` over the library resolution.
const imageBuilderSessionCache = new Map();

// How many canvases keep their full-resolution pixels in memory (one canvas can
// hold several MB of base64). The canvas being edited plus the few the user
// switched between are plenty; anything older simply loses its `live` copy and
// falls back to the library resolution + the background hydrate pass.
const LIVE_CACHE_MAX = 6;

// Remember a canvas for the rest of the session: its lightweight payload (for
// localStorage) and its live objects (for the pixels). The canvas just edited is
// re-inserted last, so the map is in most-recently-edited order and the entries
// beyond the cap only lose their `live` copy (they keep working, thumbnail-first).
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

// ---- figures of an object + their natural aspect ratio ---------------------
// Every object can hold SEVERAL figures in one lettered panel (`images[]`); the
// legacy single-image fields mirror the FIRST one. (Hoisted to module scope so
// the aspect-ratio hook below can use it without re-subscribing on every render.)
const getObjImagesOf = (obj) => {
  if (Array.isArray(obj.images) && obj.images.length) return obj.images;
  if (obj && obj.imgSrc) return [{ imgSrc: obj.imgSrc, imgThumb: obj.imgThumb, libId: obj.libId, libScope: obj.libScope, libProjectId: obj.libProjectId, src: obj.src }];
  return [];
};

// Persisted / undo-snapshot copy of an object: keep only the small thumbnails so
// the canvas never exceeds the localStorage quota. Module scope as well, so the
// persistence effect below only depends on real values (no recreated function).
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

// Library scope of a saved canvas: 'dataset' is the shared image library (no
// project), anything else is a project id. A canvas can be stored in SEVERAL
// scopes at once (composed in one project and inserted into another), so the
// library entries are tracked PER SCOPE — see canvasEntries below.
const canvasScopeKey = (scopeProjectId) => scopeProjectId || 'dataset';

// ---- panel letters (A, B, C, …) --------------------------------------------
// The letters label the panels in reading order (top→bottom, left→right — see
// `renumberLetters`), and the figure caption at the bottom lists the
// sub-captions in that very order: A first, then B, … So the caption is built
// from the LETTERS, never from the order the panels happen to be stored in
// (placing panel C before A used to make the caption read “C: … · A: …”).
// Past Z the label falls back to a number (1, 2, …); a custom label sorts last.
const panelLetterRank = (letter) => {
  const s = String(letter == null ? '' : letter).trim();
  if (/^[A-Za-z]$/.test(s)) return [0, s.toUpperCase().charCodeAt(0), ''];
  if (/^\d+$/.test(s)) return [1, Number(s), ''];
  return [2, 0, s.toUpperCase()];
};
const comparePanelLetters = (a, b) => {
  const ra = panelLetterRank(a);
  const rb = panelLetterRank(b);
  return (ra[0] - rb[0]) || (ra[1] - rb[1]) || (ra[2] < rb[2] ? -1 : ra[2] > rb[2] ? 1 : 0);
};

// Size of the panel letters (pt) when a canvas has no letter at all yet.
const DEFAULT_LETTER_PT = 14;

// « 1st, 2nd, 3rd… » — the rank of a panel inside a MULTI-SELECTION. The FIRST
// selected panel is the reference: the properties panel shows it, it carries the
// resize handle, and it is whose size every other selected panel takes.
const ORDINALS = ['1st', '2nd', '3rd'];
const ordinalOf = (k) => ORDINALS[k] || `${k + 1}th`;

// Natural width/height ratio of every figure already measured, keyed by source
// (data URL / Drive URL). The canvas "🔒 Keep aspect ratio" option draws each
// figure with its own ratio inside its panel, so the ratio has to be known
// before the geometry can be computed.
const imageAspectCache = new Map();
// Natural PIXEL size of every measured figure, keyed by source. Together with
// the style tag the figure was captured with (`src.styleTag`, written by
// ChartStarLayer) it lets the builder tell how big the characters of a figure
// really are — see the "⚖️ Character size" audit of the toolbar.
const imagePxCache = new Map();
const IMAGE_ASPECT_CACHE_MAX = 300; // forget ratios if a session imports a huge library

/**
 * Measure the natural width/height ratio of every figure on the canvas.
 * Returns a tick that changes once the ratios are known, so the canvas can
 * re-render with the aspect-corrected geometry. Sources that cannot be loaded
 * (offline Drive copies) simply keep the ratio they already had.
 */
const useImageAspects = (objects) => {
  const [tick, setTick] = useState(0);
  const srcs = useMemo(() => {
    const set = new Set();
    (objects || []).forEach((o) => getObjImagesOf(o).forEach((im) => { if (im && im.imgSrc) set.add(im.imgSrc); }));
    return [...set];
  }, [objects]);
  useEffect(() => {
    if (imageAspectCache.size > IMAGE_ASPECT_CACHE_MAX) imageAspectCache.clear();
    const pending = srcs.filter((s) => !imageAspectCache.has(s));
    if (!pending.length) return undefined;
    let cancelled = false;
    let left = pending.length;
    const settle = (src, aspect, pxW = 0, pxH = 0) => {
      imageAspectCache.set(src, aspect);
      if (pxW > 0 && pxH > 0) imagePxCache.set(src, { w: Math.round(pxW), h: Math.round(pxH) });
      left -= 1;
      if (!cancelled && left === 0) setTick((t) => t + 1);
    };
    pending.forEach((src) => {
      const img = new Image();
      img.onload = () => settle(src, img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0,
        img.naturalWidth, img.naturalHeight);
      img.onerror = () => settle(src, 0);
      img.src = src;
    });
    return () => { cancelled = true; };
  }, [srcs]);
  return tick;
};

/* ─────────────────────────────────────────────────────────────────────────────
   FIGURE STYLE AUDIT — "are the characters of these figures the same size?"

   Every 📷 capture stamps the figure library entry with the style profile it
   was RENDERED with (`src.styleTag` = fs16-lb16-rot0, see ChartStarLayer) and
   with its pixel size (`src.pxW/pxH`). Two figures of the same canvas can
   therefore come from two pages styled differently — the audit lists them and
   sends the user back to the exact graph ("↗ Open original graph") to apply the
   🎨 profile and capture again.
   ──────────────────────────────────────────────────────────────────────────── */
/* The badge of one audited figure: 'same' / 'other style' / 'no stamp' / 'canvas'. */
const STYLE_BADGE = {
  match: { text: 'same style', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  mismatch: { text: 'other style', cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
  untagged: { text: 'no stamp', cls: 'bg-slate-100 text-slate-500 border border-slate-200' },
  canvas: { text: 'canvas', cls: 'bg-indigo-50 text-indigo-600 border border-indigo-200' }
};

// `projectVisible` (optional) answers "may the current user open this project?".
// The figures of a project are private to its team (project library), so an
// inaccessible project library is never searched: the figure is reported as
// untagged / unlinked instead of being read out of somebody else's project.
const libItemOf = (im, fallbackProjectId = null, projectVisible = null) => {
  if (!im || !im.libId) return null;
  const scope = im.libScope === 'project' ? 'project' : 'common';
  const pid = im.libProjectId || fallbackProjectId;
  try {
    if (scope === 'project' && typeof projectVisible === 'function' && !projectVisible(pid)) return null;
    const list = scope === 'project' ? readProjectLibrary(pid) : readLibrary();
    return (list || []).find((x) => x.id === im.libId) || null;
  } catch { return null; }
};

export const figureStyleAudit = (objects, currentTag, fallbackProjectId = null, projectVisible = null) => {
  const rows = [];
  (objects || []).forEach((o) => {
    const imgs = getObjImagesOf(o);
    imgs.forEach((im, idx) => {
      const item = libItemOf(im, fallbackProjectId, projectVisible);
      const src = (item && item.src) || (im && im.src) || null;
      const px = (im && im.imgSrc && imagePxCache.get(im.imgSrc)) || null;
      const tag = (src && src.styleTag) || '';
      const isCanvas = !!(item && item.canvasData);
      const elementKey = (src && src.elementKey) || '';
      const libId = (im && im.libId) || '';
      rows.push({
        key: `${o.id}:${idx}`,
        objId: o.id,
        letter: o.letter || '',
        label: (item && item.label) || (src && src.elementLabel) || `Panel ${o.letter || ''}`.trim(),
        origin: [src && src.testName, src && src.instanceName].filter(Boolean).join(' — '),
        src,
        tag,
        // Where the figure lives + which chart of which page it came from: the
        // automatic re-capture needs BOTH (the library entry to replace and the
        // `data-figure-origin` stamp of the element to snapshot).
        libId,
        libScope: (im && im.libScope) || (fallbackProjectId ? 'project' : 'common'),
        libProjectId: (im && im.libProjectId) || fallbackProjectId || null,
        elementKey,
        canRecapture: !!libId && !!elementKey && !isCanvas,
        pxW: Number(src && src.pxW) || 0,
        pxH: Number(src && src.pxH) || 0,
        renderedW: px ? px.w : 0,
        renderedH: px ? px.h : 0,
        status: isCanvas ? 'canvas' : (!tag ? 'untagged' : (tag === currentTag ? 'match' : 'mismatch'))
      });
    });
  });
  return rows;
};
export const ImageBuilder = ({ projectId, jumpToTest, openCanvasId = null, onCanvasOpened, onBackToProject, currentUser = null }) => {
  const storageKey = `labImageBuilder_${projectId || 'global'}`;
  const svgRef = useRef(null);
  const svgFsRef = useRef(null);    // fullscreen SVG — kept SEPARATE from the normal one so
                                    // exiting fullscreen never leaves the drag ref null
  const dragState = useRef(null);
  const fsAreaRef = useRef(null);   // fullscreen canvas area (measured for "zoom on object")
  const textEditRef = useRef(null);  // inline free-text editor
  const capEditRef = useRef(null);   // inline global-caption editor
  const objCapRef = useRef(null);    // floating panel sub-caption editor
  const initialZoomRef = useRef(1.5);        // zoom when fullscreen was entered ("↩ Initial zoom")
  const undoStack = useRef([]);     // undo history of the canvas objects
  const [histTick, setHistTick] = useState(0);
  // Global "Figure style" profile (Settings → Figure style) — read-only here:
  // the audit below compares it with the style each figure was CAPTURED with.
  const styleProfile = useFigureStyleProfile();
  const [styleAuditOpen, setStyleAuditOpen] = useState(false);

  const [canvasW, setCanvasW] = useState(180);
  const [canvasH, setCanvasH] = useState(120);
  const [gridCols, setGridCols] = useState(4);
  const [gridRows, setGridRows] = useState(5);
  // Panel delimiter lines. They live in the composition (not in the selection
  // UI), so every export path — Export PNG, Save canvas and Insert into project
  // — honours whatever the user picked here.
  const [showPanelBorders, setShowPanelBorders] = useState(true); // thin frame around each panel
  const [showGridLines, setShowGridLines] = useState(true);       // cell divider guides across the canvas
  const [objects, setObjects] = useState([]);
  // MULTI-SÉLECTION DES PANNEAUX. La liste est ORDONNÉE : l'élément 0 est le
  // PREMIER panneau sélectionné — la RÉFÉRENCE de la sélection. C'est lui que
  // montrent les propriétés, lui qui porte les poignées, et SA taille que
  // prennent les autres quand on le redimensionne (« resize them all as the
  // first selected » : voir startResize / resizeSelectionPatches).
  // Une sélection simple reste `[id]`, et `selectedId` garde son nom PARTOUT
  // ailleurs : le sélecteur ci-dessous ramène la multi-sélection à un seul
  // panneau, donc « je sélectionne ceci » (une figure de la bibliothèque, un
  // texte du canvas, un clic dans le vide…) veut toujours dire un seul panneau,
  // exactement comme avant.
  const [selectedIds, setSelectedIds] = useState([]);
  const selectedId = selectedIds[0] || null;
  const setSelectedId = (id) => setSelectedIds(id ? [id] : []);
  // ARROW ANNOTATIONS — arrows live OUTSIDE `objects` on purpose: a panel is a
  // letter + a grid cell + a figure, an arrow is none of those. It is a plain
  // canvas-level list in millimetres (the SVG viewBox space), drawn on top of
  // the panels, so adding / moving / deleting one never disturbs the panels'
  // letters, their cells or their figures. See utils/figureArrows for the
  // geometry and the three shapes (straight, curved, double-ended).
  const [arrows, setArrows] = useState([]);
  const [selectedArrowId, setSelectedArrowId] = useState(null);
  const [hydrateTick, setHydrateTick] = useState(0); // bumped to async-fetch Drive-backed images onto the canvas
  const objectsRef = useRef(objects);
  objectsRef.current = objects;

  const [showLibrary, setShowLibrary] = useState(false);
  const [pickMode, setPickMode] = useState('replace'); // 'replace' | 'add' — how a library click affects the selected object
  const [libraryTab, setLibraryTab] = useState('project');
  const [libVersion, setLibVersion] = useState(0); // forces a re-read of the library lists after a transfer
  const [libProjectId, setLibProjectId] = useState(null); // which project's library to browse (null = the active one)
  const [libMsg, setLibMsg] = useState('');       // transient feedback after a PC upload / transfer
  const [libOver, setLibOver] = useState('');     // library card under the pointer while DRAGGING one
  const libDragRef = useRef(null);                // library card being dragged: { id, scope, projectId }
  const [libDriveBusy, setLibDriveBusy] = useState(false); // ☁ / ⬇ library ⇄ Drive in progress
  const libFileRef = useRef(null);                // hidden <input type=file> for uploading images from the PC
  const libRecoverFileRef = useRef(null);         // hidden <input type=file> for ♻️ recovering the library from a backup
  // Log of the library entries this canvas is stored as, keyed by scope
  // ('dataset' → the shared library, otherwise that project's library). A canvas
  // can live in SEVERAL scopes at once (composed in one project and inserted
  // into another), so every copy keeps its own entry id: each "💾 Save canvas"
  // and each "📤 Insert into project…" updates the copy of THAT scope in place,
  // which is what keeps the project pages' "🖼 Saved canvases" links pointing at
  // the current composition without piling up duplicates.
  const [canvasEntries, setCanvasEntries] = useState({});
  // Scope touched last — where the "💾 Save canvas" dialog proposes to save.
  const [canvasHome, setCanvasHome] = useState(projectId || null);
  const [canvasLabel, setCanvasLabel] = useState('');
  // "💾 Save canvas" dialog: name of the canvas + the library it goes into
  // ('' = the shared dataset library, a project id = that project's library).
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDest, setSaveDest] = useState(projectId || '');
  const [saveMsg, setSaveMsg] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [placeTextMode, setPlaceTextMode] = useState(false); // click on the object to add text there
  const [globalCaption, setGlobalCaption] = useState('');     // figure-wide caption at the bottom
  // Size the figure-wide letter-size control falls back to when the canvas holds
  // no panel yet: a size typed before the first panel is added is remembered for
  // it (see setLetterSizeAll / currentLetterPt).
  const [letterPtFallback, setLetterPtFallback] = useState(DEFAULT_LETTER_PT);
  const [editingText, setEditingText] = useState(null);       // { objId, txId, mmX, mmY, value } — type directly on the canvas
  const [editingCaption, setEditingCaption] = useState(false); // edit the figure caption directly at the bottom
  const [editingObjCaption, setEditingObjCaption] = useState(null); // objId — floating sub-caption editor (opened from the properties panel)
  const [insertOpen, setInsertOpen] = useState(false);        // "insert into project section" modal
  const [insertTarget, setInsertTarget] = useState({ projectId: projectId || '', section: 'background' });
  const [insertMsg, setInsertMsg] = useState('');
  // Inserted figures store the saved canvas they were made from, so the project
  // page can show a "✏️ Modify in Image Builder" link back to this composition.
  const [insertLink, setInsertLink] = useState(true);

  const allProjects = loadProjects();
  const activeLibProjectId = libProjectId || projectId; // project library scope currently browsed

  // ---- which project library is the user's to see -----------------------------
  // The figures of a project live in THAT project's library (Image Library →
  // Project tab) and are private to its team: only the projects this user may
  // OPEN (owner / coworker / superuser) are offered here — in the browser, in
  // the canvas save dialog, in “Insert into project…” and in the style audit.
  // A coworker with 'view' permission keeps READING them but cannot write into
  // that project (upload, save a canvas, rename, delete, transfer), exactly like
  // the project page itself (its canModify).
  const myName = (currentUser && currentUser.name) || '';
  const isSuper = !!(currentUser && currentUser.role === 'superuser');
  const myProjects = visibleProjectsFor(allProjects, myName, isSuper);
  const myProjectIds = myProjects.map((p) => p.id);
  // Same list as a STRING: its value is stable across renders, so it can sit in
  // an effect's dependency array without re-running the effect every time.
  const myProjectIdsKey = myProjectIds.join('|');
  // 'modify' | 'view' | null — 'modify' for the shared dataset library (no project).
  const libProjectAccess = (pid) => (pid
    ? projectAccessFor(allProjects.find((p) => p.id === pid) || null, myName, isSuper)
    : 'modify');
  const canSeeLibProject = (pid) => libProjectAccess(pid) !== null;
  const canWriteLibProject = (pid) => libProjectAccess(pid) === 'modify';
  const myWritableProjects = myProjects.filter((p) => canWriteLibProject(p.id));

  // A project the user cannot open must never stay selected in the library
  // browser (e.g. a selection left over from another user of this browser).
  useEffect(() => {
    if (libProjectId && !canSeeLibProject(libProjectId)) setLibProjectId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libProjectId, myName, isSuper]);

  // ---- which library entry this canvas is, per scope --------------------------
  const canvasEntryIn = (scopeProjectId) => canvasEntries[canvasScopeKey(scopeProjectId)] || null;
  const canvasScopeName = (scopeProjectId) => (scopeProjectId
    ? String((allProjects.find((p) => p.id === scopeProjectId) || {}).name || 'project')
    : 'the dataset library');
  // Record that this canvas is stored as `entry` in that scope (and as the scope
  // touched last), so the next save updates that very entry.
  const rememberCanvasEntry = (scopeProjectId, entry) => {
    if (!entry || !entry.id) return;
    const key = canvasScopeKey(scopeProjectId);
    const label = entry.label || canvasLabel || 'Canvas';
    setCanvasEntries((m) => ({ ...m, [key]: { id: entry.id, label } }));
    setCanvasHome(scopeProjectId || null);
    setCanvasLabel(label);
  };
  const homeEntry = canvasEntryIn(canvasHome);
  const storedScopeCount = Object.keys(canvasEntries).length;

  // Clear transient library feedback whenever the modal is closed.
  useEffect(() => {
    if (!showLibrary) setLibMsg('');
  }, [showLibrary]);

  // ---- multi-figure objects -------------------------------------------------
  // Every object can hold SEVERAL figures in one lettered panel (`images[]`).
  // The legacy single-image fields (imgSrc/imgThumb/libId/libScope/libProjectId/src)
  // mirror the FIRST image, so all existing code keeps working.
  const getObjImages = getObjImagesOf;

  // Canvas option "🔒 Keep aspect ratio" (on by default): every figure is drawn
  // with its OWN width/height ratio inside its panel, so changing the number of
  // panels (grid) or the canvas dimensions only RESCALES the figures — it never
  // stretches them. `void aspectTick` keeps the re-render triggered by freshly
  // measured figure ratios (see useImageAspects above).
  const [keepAspect, setKeepAspect] = useState(true);
  const aspectTick = useImageAspects(objects);

  // Persist the natural pixel size of every measured figure on its object
  // (`imgPxW/imgPxH`), so "how big were the characters of this figure really"
  // is answered even before the sources are loaded again. The write only
  // happens when the value CHANGED, so this cannot loop.
  useEffect(() => {
    if (!objects || !objects.length) return;
    let dirty = false;
    const next = objects.map((o) => {
      const src = o.imgSrc || (o.images && o.images[0] && o.images[0].imgSrc);
      const px = src ? imagePxCache.get(src) : null;
      if (!px) return o;
      if (Number(o.imgPxW) === px.w && Number(o.imgPxH) === px.h) return o;
      dirty = true;
      return { ...o, imgPxW: px.w, imgPxH: px.h };
    });
    if (dirty) setObjects(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspectTick, objects]);

  // Audit of the figure styles placed on the canvas (computed only while the
  // ⚖️ panel is open): a figure captured with another profile than the current
  // one is what makes two graphs of one slide look different.
  const styleTag = figureStyleTag(styleProfile);
  const styleRows = styleAuditOpen ? figureStyleAudit(objects, styleTag, projectId, canSeeLibProject) : [];
  const styleBad = styleRows.filter((r) => r.status === 'mismatch' || r.status === 'untagged');
  void aspectTick;

  // Build an object that stores `images` (and mirrors the first one into the
  // legacy single-image fields).
  const withImages = (obj, images) => {
    const arr = (images || []).filter(Boolean);
    const first = arr[0] || {};
    return {
      ...obj,
      images: arr,
      imgSrc: first.imgSrc || obj.imgSrc || null,
      imgThumb: first.imgThumb || obj.imgThumb || null,
      libId: first.libId || obj.libId || null,
      libScope: first.libScope || obj.libScope || null,
      libProjectId: first.libProjectId || obj.libProjectId || null,
      src: first.src || obj.src || null
    };
  };

  // `thumbnailsOf` (persisted / undo-snapshot copy, module scope above) keeps the
  // canvas small enough for localStorage.

  // Resolve the copy of a library image that the canvas can DISPLAY (the canvas
  // persists only thumbnails / libId). The full-resolution pixels now live on
  // Google Drive for Drive-backed items: use the small local thumbnail for
  // instant display and remember the source so the async "hydrate" pass below
  // can fetch the crisp Drive copy. Searches every scope the image could live
  // in — the project it was picked from (libProjectId), the currently-active
  // project, then the common library.
  const resolveLibImage = (im) => {
    if (!im || !im.libId) return im;
    try {
      const scopes = [];
      if (im.libScope === 'project') {
        if (im.libProjectId) scopes.push(['project', im.libProjectId]);
        scopes.push(['project', projectId], ['common', null]);
      } else {
        scopes.push(['common', null], ['project', im.libProjectId || projectId]);
      }
      for (const [scope, pid] of scopes) {
        // Never resolve pixels out of a project library this user may not open.
        if (scope === 'project' && !canSeeLibProject(pid)) continue;
        const lib = scope === 'project' ? readProjectLibrary(pid) : readLibrary();
        const it = lib.find((x) => x.id === im.libId);
        if (it) {
          // `full` may be a Google Drive URL (image stored on Drive): keep the
          // local thumbnail as the display source and let the hydrate pass
          // upgrade to the full-resolution data URL in the background.
          const fullData = it.full && String(it.full).startsWith('data:') ? it.full : null;
          return { ...im, imgSrc: fullData || it.url || it.full, imgThumb: it.url || it.full, _srcHint: it.full && !String(it.full).startsWith('data:') ? it.full : null };
        }
      }
    } catch { /* keep as-is */ }
    return im;
  };

  const resolveObj = (o) => {
    const images = getObjImages(o).map(resolveLibImage);
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

  // The figure-wide caption at the bottom is built from every object's
  // sub-caption (merged), unless the user typed a custom one directly on the
  // canvas. The panels are listed in ALPHABETICAL LETTER order — A, B, C … —
  // i.e. the order the letters read on the figure, whatever order the panels
  // were created / pasted in (see `comparePanelLetters`).
  const autoGlobalCaption = (objects || []).filter((o) => String(o.caption || '').trim())
    .sort((a, b) => comparePanelLetters(a.letter, b.letter) || (a.y - b.y) || (a.x - b.x))
    .map((o) => `${o.letter || '?'}: ${String(o.caption).trim()}`).join(' · ');
  const effectiveGlobalCaption = String(globalCaption || '').trim() ? globalCaption : autoGlobalCaption;
  const captionH = (effectiveGlobalCaption.trim() || editingCaption) ? 14 : 0; // reserved caption band (mm)

  // The SVG that is actually visible (fullscreen overlay when open).
  const activeSvgEl = () => (isFullScreen ? svgFsRef : svgRef).current;

  // Where the pointer is, in CANVAS MILLIMETRES. The viewBox carries the
  // caption band (`canvasH + captionH`), so the vertical scale uses it: the
  // eraser has to land exactly under the cursor (the historical drag math only
  // used `canvasH` — a gesture tolerates that, a brush does not).
  const mmAtPointer = (clientX, clientY, svgEl = activeSvgEl()) => {
    if (!svgEl) return null;
    const r = svgEl.getBoundingClientRect();
    return {
      x: (clientX - r.left) * (canvasW / Math.max(1, r.width)),
      y: (clientY - r.top) * ((canvasH + captionH) / Math.max(1, r.height))
    };
  };

  // Fullscreen & Zoom states
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [zoom, setZoom] = useState(1.5); // Start at 150% for better visibility
  // The viewport SCROLLS (see the sizer in the fullscreen markup): there is no
  // pan offset to keep — the scrollbars / wheel move the canvas.
  const [focusObjId, setFocusObjId] = useState(null); // object zoomed on (persisted so "◀ Back" restores it)

  // Load persisted state — the in-memory session cache (freshest, immune to the
  // localStorage quota) wins; localStorage is the fallback / cross-reload source.
  useEffect(() => {
    try {
      const cached = imageBuilderSessionCache.get(storageKey) || null;
      const saved = (cached && cached.payload) || (() => {
        try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { return null; }
      })();
      // Same session → the canvas is still in memory WITH its pixels: restore
      // the objects EXACTLY as they were instead of re-resolving them from the
      // image library (which would put every panel back on its ≤240 px thumbnail
      // and lose the resolution of the figures whose full copy cannot be fetched
      // again — the bug this cache exists for, see its comment at the top).
      const live = (cached && Array.isArray(cached.live)) ? cached.live : null;
      if (saved) {
        const data = saved;
        if (data.canvasW) setCanvasW(data.canvasW);
        if (data.canvasH) setCanvasH(data.canvasH);
        if (data.gridCols) setGridCols(data.gridCols);
        if (data.gridRows) setGridRows(data.gridRows);
        if (data.showPanelBorders !== undefined) setShowPanelBorders(!!data.showPanelBorders);
        if (data.showGridLines !== undefined) setShowGridLines(!!data.showGridLines);
        // Canvases saved before this option existed default to keeping the
        // figures in their own aspect ratio (the behaviour the option adds).
        if (data.keepAspect !== undefined) setKeepAspect(!!data.keepAspect);
        if (data.objects) {
          // The LIVE copy wins: the panels keep the pixels they were showing —
          // nothing to re-resolve, nothing to fetch. It is only missing on a
          // canvas this session has not opened yet (first visit after a page
          // reload, or an entry dropped by the LRU cap): then — and only then —
          // the persisted thumbnail is all we have, so re-resolve the
          // full-resolution image from its library entry (the async "hydrate"
          // pass below fetches the Drive/Nextcloud copy in the background, and
          // the object never "disappears"). Works for both the legacy
          // single-image objects and the new multi-figure `images[]`.
          setObjects(live || (data.objects || []).map((o) => {
            if (!o.libId && !(o.images || []).some((im) => im && im.libId)) return o;
            return resolveObj(o);
          }));
          setHydrateTick((t) => t + 1);
        }
        if (data.globalCaption !== undefined) setGlobalCaption(data.globalCaption);
        // Arrow annotations: they hold no pixels, so the persisted list IS the
        // live one — nothing to re-resolve. A canvas saved before arrows
        // existed simply has no value here and keeps the empty list.
        if (data.arrows) setArrows((data.arrows || []).map(normalizeArrow));
        // Restore the view the user left — e.g. when returning from the original
        // graph via the test page's ◀ Back button.
        if (data.isFullScreen) setIsFullScreen(true);
        if (data.focusObjId && data.objects && data.objects.some((o) => o.id === data.focusObjId)) {
          setFocusObjId(data.focusObjId);
          setIsFullScreen(true);
        }
      }
    } catch {}
    // The canvas bookkeeping is per CANVAS, not per session: this component
    // instance is reused when the user switches project, so the library entries
    // (and the name) of the previous composition must not leak into the next one.
    setCanvasEntries({});
    setCanvasHome(projectId || null);
    setCanvasLabel('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Open a saved canvas requested by the project page ("🖼 Saved canvases" →
  // "Open in Image Builder"): App.jsx passes the library entry id here and the
  // module remounts, so this runs after the session-cache restore above and
  // wins. The request is consumed right away, so visiting the Image Builder
  // afterwards keeps whatever the user was working on.
  useEffect(() => {
    if (!openCanvasId) return;
    // A saved canvas that lives in the library of a project this user may not
    // open is not theirs to load: say so instead of reading that project.
    if (projectId && !canSeeLibProject(projectId)) {
      setLibraryTab('project');
      setLibMsg('🔒 That project’s figures are private to its team — this canvas cannot be opened here.');
      setShowLibrary(true);
      if (typeof onCanvasOpened === 'function') onCanvasOpened(openCanvasId);
      return;
    }
    const list = projectId ? readProjectLibrary(projectId) : readLibrary();
    const item = list.find((i) => i.id === openCanvasId && i.canvasData);
    if (item) restoreCanvasFromItem(item, { confirm: false, scopeProjectId: projectId || null });
    if (typeof onCanvasOpened === 'function') onCanvasOpened(openCanvasId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCanvasId]);

  useEffect(() => {
    try {
      // Persist a lightweight copy (the small thumbnail instead of the
      // full-resolution dataURL) so the layout always re-opens after
      // navigating away and back.
      const persisted = (objects || []).map(thumbnailsOf);
      const payload = { canvasW, canvasH, gridCols, gridRows, showPanelBorders, showGridLines, keepAspect, objects: persisted, arrows, focusObjId, globalCaption, isFullScreen };
      // Always keep the freshest copy in memory (survives module remounts even
      // when localStorage is full), then best-effort write localStorage:
      // rememberSessionCanvas keeps BOTH the lightweight payload AND the live
      // objects — the pixels the canvas is showing — so coming back from the
      // original experiment cannot drop a figure to its local thumbnail.
      rememberSessionCanvas(storageKey, payload, objects || []);
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch { /* localStorage may be full — the session cache above still holds the state */ }
  }, [canvasW, canvasH, gridCols, gridRows, showPanelBorders, showGridLines, keepAspect, objects, arrows, focusObjId, globalCaption, isFullScreen, storageKey]);

  // Async "hydrate" pass — after objects are (re)loaded from a persisted canvas
  // or an undo snapshot, their images may reference Google Drive (the real
  // pixels of library figures are stored there). The small local thumbnail is
  // shown immediately; this effect fetches the full-resolution copy from Drive
  // (via the API token) and replaces the thumbnail so zoom/export stay crisp.
  useEffect(() => {
    const list = objectsRef.current || [];
    if (!list.length) return;
    const targets = [];
    const seen = new Set();
    list.forEach((o) => {
      const imgs = getObjImages(o);
      for (let i = 0; i < imgs.length; i++) {
        const im = imgs[i];
        const src = im && (im._srcHint || im.imgSrc || im.imgThumb);
        if (!src || String(src).startsWith('data:') || seen.has(src)) continue;
        seen.add(src);
        targets.push({ oid: o.id, idx: i, src: String(src) });
      }
    });
    if (!targets.length) return;
    let alive = true;
    Promise.all(targets.map(({ src }) =>
      resolveImageToDataUrl(src).then((r) => ({ src, r })).catch(() => ({ src, r: src }))
    )).then((results) => {
      if (!alive) return;
      const bySrc = new Map(results.map((x) => [x.src, x.r]));
      const changed = targets.filter((t) => bySrc.get(t.src) && bySrc.get(t.src) !== t.src);
      if (!changed.length) return;
      setObjects((prev) => prev.map((o) => {
        const imgs = getObjImages(o);
        let any = false;
        const next = imgs.map((im, idx) => {
          const hit = changed.find((c) => c.oid === o.id && c.idx === idx);
          if (!hit) return im;
          const resolved = bySrc.get(hit.src);
          if (!resolved) return im;
          any = true;
          return { ...im, imgSrc: resolved, imgThumb: im.imgThumb && String(im.imgThumb).startsWith('data:') ? im.imgThumb : resolved, _srcHint: null };
        });
        return any ? withImages(o, next) : o;
      }));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrateTick]);

  const cellW = canvasW / gridCols;
  const cellH = canvasH / gridRows;

  // ---- undo history -------------------------------------------------------
  // Snapshots keep only thumbnails (full-res dataURLs are re-resolved from the
  // library on undo) so the stack stays light even with large captured images.
  // The ARROWS ride along in the same snapshot: undoing a change puts the
  // annotations back exactly as they were (they hold no pixels at all).
  const commitHistory = () => {
    try {
      const snap = {
        objects: JSON.parse(JSON.stringify((objects || []).map(thumbnailsOf))),
        arrows: JSON.parse(JSON.stringify(arrows || []))
      };
      undoStack.current.push(snap);
      if (undoStack.current.length > 40) undoStack.current.shift();
      setHistTick((t) => t + 1);
    } catch { /* ignore */ }
  };
  const undo = () => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    const objs = Array.isArray(prev) ? prev : (prev.objects || []);   // a snapshot taken before the arrows existed
    setObjects(objs.map(resolveObj));
    if (!Array.isArray(prev)) setArrows((prev.arrows || []).map(normalizeArrow));
    setSelectedId(null);
    setSelectedArrowId(null);
    setHistTick((t) => t + 1);
    setHydrateTick((t) => t + 1);
  };

  // Re-assign the A, B, C panel letters by position (top→bottom, left→right)
  // and update each object's sub-caption so the letter always matches the panel.
  const renumberLetters = () => {
    setObjects(prev => {
      const sorted = [...prev].sort((a, b) => (a.y - b.y) || (a.x - b.x));
      const letterOf = {};
      sorted.forEach((o, i) => { letterOf[o.id] = i < 26 ? String.fromCharCode(65 + i) : `${i + 1}`; });
      return prev.map(o => {
        const L = letterOf[o.id];
        if (!L || o.letter === L) return o;
        let caption = o.caption || '';
        if (o.letter && caption) {
          const re = new RegExp('^' + o.letter + '\\s*[.:-]?\\s*');
          if (re.test(caption)) {
            const m = caption.match(re)[0];
            const sep = /[.:-]/.test(m) ? m.match(/[.:-]/)[0] + ' ' : ' ';
            caption = L + sep + caption.slice(m.length);
          }
        }
        return { ...o, letter: L, caption };
      });
    });
  };

  // ---- SÉLECTION MULTIPLE + COPIER / COLLER ----------------------------------
  // A click on the canvas selects ONE panel (exactly as before); Ctrl/Cmd + click
  // (or a chip of the “Panels” strip of the properties panel) ADDS / REMOVES a
  // panel, so several can be moved and resized as one. The FIRST selected panel
  // stays the REFERENCE — see startResize and utils/panelSelection.
  const toggleSelectedId = (id) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const makeReference = (id) => setSelectedIds((prev) => [id, ...prev.filter((x) => x !== id)]);
  // For a command driven by ONE handle: the whole selection when the panel held
  // is part of it (it IS the reference), else that panel alone — grabbing a
  // handle must never act on panels the user did not select.
  const selectionWith = (id) => (selectedIds.includes(id) ? selectedIds : [id]);
  const boxesOf = (ids) => {
    const out = {};
    (ids || []).forEach((i) => {
      const o = (objects || []).find((x) => x.id === i);
      if (o) out[i] = { x: o.x, y: o.y, w: o.w, h: o.h };
    });
    return out;
  };
  // A panel that was deleted (or undone away) must never stay “selected”.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (!prev.length) return prev;
      const next = prev.filter((id) => (objects || []).some((o) => o.id === id));
      return next.length === prev.length ? prev : next;
    });
  }, [objects]);

  // ── COPIER / COLLER UN PANNEAU (Ctrl+C / Ctrl+V) ────────────────────────────
  // The copy carries the figures AND the free texts of the panel (see
  // utils/objectClipboard), so an identical panel comes back in one gesture —
  // its letters re-numbered by the position, exactly like an added panel.
  const clipboardRef = useRef(null);
  const [clipCount, setClipCount] = useState(0);   // panels in the clipboard (“📋 Paste” button)
  const copySelection = (ids = selectedIds) => {
    const list = (objects || []).filter((o) => ids.includes(o.id));
    if (!list.length) return null;
    // TWO copies of the same panel:
    //  • the INTERNAL one (an in-memory variable) keeps the full-resolution
    //    pixels, so pasting inside this tab loses nothing;
    //  • the one handed to the BROWSER clipboard only carries the thumbnails —
    //    megabytes of data-URL have no place in a system clipboard, and the
    //    sharpness comes back through `libId` (resolveLibImage) exactly as it
    //    does for a reloaded canvas.
    clipboardRef.current = buildCopyPayload(list, { thumbnails: false });
    const payload = buildCopyPayload(list);
    setClipCount(payload.objects.length);
    return payload;
  };
  const pastePayload = (payload) => {
    const res = pastePanels(objects, payload, { gridCols, gridRows, seed: Date.now() });
    if (!res.added.length) {
      window.alert('The grid has no free cell left for the copied panel: increase “Grid Cols” / “Grid Rows” (canvas format) or delete a panel — pasting never covers a panel that is already there.');
      return 0;
    }
    commitHistory();
    setObjects(res.objects);
    setSelectedArrowId(null);
    setSelectedIds(res.ids);      // the copies are selected: ready to be placed / resized together
    setActiveFig(null);
    setFigGroup({ objId: null, idxs: [] });
    renumberLetters();
    return res.added.length;
  };
  const pasteClipboard = () => {
    if (!clipboardRef.current) {
      window.alert('Nothing to paste yet: copy a panel first (Ctrl+C on the canvas, or the “⧉ Copy” button of the object properties).');
      return 0;
    }
    return pastePayload(clipboardRef.current);
  };
  const deleteSelection = () => {
    const ids = selectedIds.length ? selectedIds : (selectedId ? [selectedId] : []);
    if (!ids.length) return;
    commitHistory();
    setObjects(objects.filter((o) => !ids.includes(o.id)));
    setSelectedIds([]);
    setActiveFig(null);
    setFigGroup({ objId: null, idxs: [] });
    renumberLetters();
  };
  // The copy / paste EVENTS of the browser are the only clipboard route that
  // needs NO permission: they carry our JSON both ways, so a copy made in another
  // tab (or before a reload) pastes here. The internal copy above is what the
  // “📋 Paste” button uses, and the fallback when the system clipboard cannot be
  // read. The handlers run the LAST version of these commands (a ref, like the
  // Ctrl+Z effect above), so this effect subscribes once and never goes stale.
  const clipActions = useRef({});
  clipActions.current = { copySelection, pastePayload };
  useEffect(() => {
    // A field being edited (a sub-caption, a text of the canvas…) keeps the
    // BROWSER copy / paste: Ctrl+C / Ctrl+V are never stolen from someone typing.
    const typing = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    const onCopy = (e) => {
      if (typing(e.target)) return;
      const payload = clipActions.current.copySelection();
      if (!payload || !e.clipboardData) return;
      try {
        e.clipboardData.setData('text/plain', JSON.stringify(payload));
        e.preventDefault();          // the copy is OURS, not the page selection
      } catch { /* clipboard refused: the internal copy still works */ }
    };
    const onPaste = (e) => {
      if (typing(e.target)) return;
      const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
      const fromClipboard = parseCopyPayload(text);
      if (fromClipboard) {
        // Our own copy is in the clipboard: paste the INTERNAL copy when this tab
        // has it (same copy, full-resolution pixels), else the one that travelled
        // through the clipboard (another tab, or a fresh page).
        e.preventDefault();
        clipActions.current.pastePayload(clipboardRef.current || fromClipboard);
        return;
      }
      if (String(text || '').trim()) return;   // text from elsewhere: not our copy, leave it alone
      if (clipboardRef.current) { e.preventDefault(); clipActions.current.pastePayload(clipboardRef.current); }
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onPaste);
    };
  }, []);

  // A brand-new EMPTY panel — a letter (A, B, …) plus the figure-wide letter
  // size, no figure yet. ONE factory for both creation paths: "+ Add Object"
  // (one more panel of the figure being built) and "➕ New image" (a new figure
  // starts with this single panel, ready for its first 📷 capture).
  // It comes with the top-left cell (0, 0) — the right home for the FIRST panel
  // of a canvas; "+ Add Object" moves it to the first free cell (firstFreeCell),
  // so a panel added to a figure already in progress never covers another one.
  const blankObject = (letter) => ({
    id: `obj_${Date.now()}`,
    x: 0, y: 0, w: 1, h: 1,
    letter: letter || 'A',
    letterStyle: { fontSize: currentLetterPt(), color: '#000000', bold: true },
    caption: '',
    captionStyle: { fontSize: 10, color: '#000000', bold: false }, // kept for canvases saved before the panel caption was hidden (never drawn)
    imgSrc: null, imgFit: 'contain', imgScale: 1, imgPadding: 2,
    imgOffsetX: 0, imgOffsetY: 0,  // shift the image inside the object frame (mm)
    imgRotate: 0,                   // image rotation (degrees)
    shadow: null,                   // drop shadow of THIS panel — { dx, dy, blur, color, opacity } (mm)
    texts: [],                      // free text overlays [{ id, x, y, text, fontSize, color, bold, italic }]
    src: null,                      // { testId, testName, elementLabel } — link back to the original graph
    images: [],                     // extra figures inside this same object/panel (multi-figure montage)
    imgCols: 2                      // grid columns when the object holds several figures
  });

  // Where a NEW panel goes: the FIRST FREE CELL of the grid, scanned in the very
  // order the panel letters follow (row by row, left→right — see
  // `renumberLetters`). "+ Add Object" used to drop every panel on the top-left
  // cell, i.e. right on top of panel A: the new panel hid the figure underneath
  // and the user had to drag it away (often grabbing the wrong panel instead).
  // The new panel now lands in the first EMPTY space — beside the panels already
  // there, or in a gap left by a deleted / moved panel.
  // `w` / `h` are the panel size IN CELLS (1 × 1 for a new panel) and every cell
  // the panel would occupy is tested, so it can never half-cover an existing one.
  // Returns null when the grid has no free cell left: the caller must not stack
  // the panel on an occupied cell, it reports the full grid instead (addObject).
  // ONE implementation of that rule for the whole app: the pure helper of
  // utils/objectClipboard is what “+ Add Object” and “📋 Paste” (Ctrl+V) both
  // ask — a pasted panel lands exactly where an added one would, and neither can
  // ever cover a panel that is already there.
  const firstFreeCell = (list, w = 1, h = 1) => {
    return firstFreeCellIn(list, gridCols, gridRows, w, h);
  };

  const addObject = () => {
    // The new panel takes the first free cell — never the top-left cell, which
    // usually holds panel A. A grid with no free cell cannot host one: say so
    // and change nothing (stacking it would simply hide a figure).
    const spot = firstFreeCell(objects);
    if (!spot) {
      window.alert(`The ${gridCols} × ${gridRows} grid is full: a new panel would cover an existing one. Increase “Grid Cols” or “Grid Rows” in the canvas format, or delete a panel, to make room.`);
      return;
    }
    commitHistory();
    const nextLetter = objects.length < 26 ? String.fromCharCode(65 + objects.length) : `${objects.length + 1}`;
    const newObj = blankObject(nextLetter);
    newObj.x = spot.x;               // the first free cell of the grid…
    newObj.y = spot.y;               // …instead of the factory's default (0, 0)
    setObjects([...objects, newObj]);
    setSelectedId(newObj.id);
    renumberLetters();
  };

  // ---- start a NEW image -----------------------------------------------------
  // The editor had no CREATE button: it re-opens the canvas it was left on, and
  // the only way to empty it was the red "Clear Canvas" — which reads as "you
  // are about to lose your work" (and it forgets which library entry the canvas
  // came from). This is its positive sibling:
  //   • the figure that was open stays in the image library EXACTLY as it was
  //     last saved (its "↩ Load" in the library restores it any time), and
  //   • the next "💾 Save canvas" CREATES a new image in the library instead of
  //     overwriting it, so two figures of one project never collide.
  // The canvas FORMAT is kept (width/height, grid, borders, grid lines, aspect
  // ratio, letter size): a new image is a new figure in the same format. It
  // starts with one empty panel (A), selected, ready for a capture.
  const startNewImage = () => {
    const hasWork = (objects || []).length > 0 || String(globalCaption || '').trim();
    if (hasWork) {
      const savedLabel = canvasLabel || (homeEntry && homeEntry.label) || '';
      const msg = savedLabel
        ? `Start a new image? “${savedLabel}” stays in the image library as it was last saved — only the editor is emptied.`
        : 'Start a new image? The current canvas was never saved to the image library, so it will be lost.';
      if (!window.confirm(msg)) return;
    }
    commitHistory();                 // the canvas that was open stays one Ctrl+Z away
    const first = blankObject('A');
    setObjects([first]);
    setArrows([]);                   // a NEW image starts with no annotation either
    setSelectedArrowId(null);
    setSelectedId(first.id);
    renumberLetters();               // a single panel is always "A"
    setEditingText(null);
    setEditingObjCaption(null);
    setEditingCaption(false);
    setPlaceTextMode(false);
    setGlobalCaption('');
    setFocusObjId(null);
    // Detach from the stored canvas: with no known entry the next "💾 Save
    // canvas" adds a NEW image to the library (the one that was open is left
    // untouched) while the save dialog still proposes the same destination.
    setCanvasEntries({});
    setCanvasLabel('');
    setCanvasHome(projectId || null);
    setPickMode('replace');
    setShowLibrary(false);
    setInsertOpen(false);
    setRecapNote(null);
  };

  // Ctrl+Z undoes the last canvas change.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && String(e.key).toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The inline editors close on a REAL click outside (mousedown), NOT on blur —
  // an internal re-render (e.g. the caption text updating on every keystroke)
  // must never blur/close the editor, otherwise typing a sub-caption would lose
  // focus after the very first letter and force a re-click each time.
  useEffect(() => {
    if (!editingText) return;
    const onDown = (e) => {
      const el = textEditRef.current;
      if (el && e.target && el !== e.target && !el.contains(e.target)) stopEditing();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingText]);
  useEffect(() => {
    if (!editingCaption) return;
    const onDown = (e) => {
      const el = capEditRef.current;
      if (el && e.target && el !== e.target && !el.contains(e.target)) setEditingCaption(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [editingCaption]);
  useEffect(() => {
    if (!editingObjCaption) return;
    const onDown = (e) => {
      const el = objCapRef.current;
      if (el && e.target && el !== e.target && !el.contains(e.target)) setEditingObjCaption(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [editingObjCaption]);

  const updateObj = (patch) => {
    setObjects(prev => prev.map(o => o.id === selectedId ? { ...o, ...patch } : o));
  };

  // Update ONE object's sub-caption directly by id (used by the inline editor,
  // which must not depend on the currently-selected object).
  const setObjCaption = (objId, caption) => {
    setObjects(prev => prev.map(o => o.id === objId ? { ...o, caption } : o));
  };

  // ── letter size: ONE size for EVERY panel letter (A, B, C …) ───────────────
  // The letters of a figure always read alike, so the size is a FIGURE setting,
  // not a per-panel one: the controls (toolbar, canvas options, "Labels &
  // Captions") write the new size to ALL the objects at once — the user never
  // has to repeat it panel by panel. Colour and bold stay per panel, so a
  // single panel can still be highlighted.
  const setLetterSizeAll = (pt) => {
    const size = Number(pt);
    if (!Number.isFinite(size) || size <= 0) return; // empty / invalid field → keep the current size
    setLetterPtFallback(size); // remembered for an empty canvas / a new panel
    setObjects(prev => prev.map(o => ({ ...o, letterStyle: { ...(o.letterStyle || {}), fontSize: size } })));
  };
  // Size shown by those controls: once the figure-wide control is used every
  // panel holds the same value; before that (a canvas whose letters were set
  // panel by panel) the selected panel's size is shown, else the first panel's,
  // else the size typed last (a canvas that has no panel left to show).
  const currentLetterPt = () => {
    const sel = (objects || []).find((o) => o.id === selectedId);
    const s = sel && sel.letterStyle ? Number(sel.letterStyle.fontSize) : 0;
    if (Number.isFinite(s) && s > 0) return s;
    const first = (objects || []).find((o) => o && o.letterStyle && Number(o.letterStyle.fontSize) > 0);
    return first ? Number(first.letterStyle.fontSize) : letterPtFallback;
  };

  // Replace-mode click: the object shows exactly this one figure (also clears
  // any previously-added extra figures). With keepOpen=true the window stays
  // open (used after a PC upload so the Drive/storage confirmation stays
  // visible); ordinary library clicks close it as before.
  const handlePickImage = async (item, keepOpen = false) => {
    commitHistory();
    if (!selectedObj) {
      // The modal was opened from the toolbar (library management / import
      // without an object selected): keep it open and guide the user instead
      // of silently closing with nothing placed.
      setLibMsg('Add an object first (+ Add Object), select it, then click a library image to place it — or use ⬆ Upload from PC to store images here.');
      return;
    }
    // Library figures are stored on Google Drive — fetch the real pixels into a
    // dataURL (fast when it is already a dataURL) before drawing them on canvas.
    // Offline / no token: keep the local thumbnail so the panel still shows.
    const fullSrc = item.full || item.url;
    const resolved = await resolveImageToDataUrl(fullSrc).catch(() => fullSrc);
    const src = String(resolved || '').startsWith('data:')
      ? resolved
      : (item.url && String(item.url).startsWith('data:') ? item.url : resolved);
    setObjects(prev => prev.map(o => o.id === selectedId ? withImages(o, [{
      imgSrc: src,
      imgThumb: (item.url && String(item.url).startsWith('data:')) ? item.url : src,
      libScope: libraryTab,
      libProjectId: libraryTab === 'project' ? activeLibProjectId : null,
      libId: item.id,
      src: item.src || null,
      dx: 0, dy: 0, scale: 1
    }]) : o));
    if (!keepOpen) setShowLibrary(false);
  };

  // Import image file(s) from the PC into the library currently shown in the
  // modal — the Project library (Project tab → selected project) or the
  // general dataset library (Dataset Library tab). The REAL image is stored on
  // Google Drive (only a small local preview + metadata stay in the browser).
  // A single upload with an object selected is also placed on that panel.
  const handleLibUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    const scope = libraryTab; // 'project' | 'common'
    const scopeName = scope === 'project' ? 'project' : 'general (dataset)';
    // Uploading into a project library writes to that project: edit access is
    // required (the shared dataset library has no owner to restrict).
    if (scope === 'project' && !canWriteLibProject(activeLibProjectId)) {
      setLibMsg('🔒 That project’s figures are private to its team — you cannot add images here.');
      return;
    }
    const driveProject = scope === 'project' && activeLibProjectId
      ? (allProjects.find((p) => p.id === activeLibProjectId) || null)
      : null;
    const driveProjectName = driveProject ? String(driveProject.name || '') : '';
    const driveFolderLabel = projectImagesFolderLabel(driveProjectName, getDriveRootName());
    const imported = [];
    const failed = [];
    let driveOk = 0;
    for (const f of files) {
      if (!f.type || !String(f.type).startsWith('image/')) { failed.push(f.name || 'unknown file'); continue; }
      setLibMsg(`📤 Importing ${f.name || 'image'}…`);
      try {
        const dataUrl = await blobToDataUrl(f);
        const label = (f.name || 'Image').replace(/\.[^.]+$/, '') || 'Image';
        // publishLibraryFigure uploads the real image to Drive and keeps only a
        // small local preview — the library list itself is memory-first, so a
        // full localStorage quota can never block an import again.
        const { entry, drive } = await publishLibraryFigure({
          scope,
          projectId: scope === 'project' ? activeLibProjectId : null,
          projectName: driveProjectName,
          dataUrl,
          label,
          src: null
        });
        if (!entry) { failed.push(f.name || 'unknown file'); continue; }
        if (drive && drive.id) driveOk++;
        imported.push(entry);
      } catch (err) {
        console.warn('Image import failed:', err);
        failed.push(f.name || 'unknown file');
      }
    }
    if (imported.length) setLibVersion((v) => v + 1);
    if (!imported.length) {
      const lsNote = localStorageHealthy()
        ? ''
        : '\n\nThe browser storage is full: connect Google Drive and retry so the image is kept there (the list also works for this session).';
      window.alert(`⚠️ ${failed.length || files.length} image(s) could not be stored in the ${scopeName} library.${lsNote}`);
      return;
    }

    // Place a single imported image on the selected panel, but keep the window
    // open so the storage/Drive confirmation below stays visible.
    const first = imported[0];
    if (selectedObj && imported.length === 1 && first) {
      if (pickMode === 'add') handleAddImage(first);
      else handlePickImage(first, true);
    }

    let msg = `✅ ${imported.length} image${imported.length > 1 ? 's' : ''} stored in the ${scopeName} library`;
    if (driveOk === imported.length) msg += ` · stored on your cloud (${driveFolderLabel})`;
    else if (driveOk > 0) msg += ` · cloud copy saved for ${driveOk} of ${imported.length}`;
    else if (!localStorageHealthy()) msg += ' · browser storage full — connect Google Drive or Nextcloud so images are kept there (the list works for this session)';
    else msg += ' · cloud storage not connected — browser copy only';
    if (selectedObj && imported.length === 1) msg += ' · placed on the selected panel';
    else msg += ' · click a thumbnail to place it';
    if (failed.length) msg += ` · ${failed.length} failed`;
    setLibMsg(msg);
  };

  /* ── MULTI-FIGURE PANELS: FREEZING the figures already there ────────────────
     See utils/figureLayout.js. A figure that carries `im.rect` (fractions of
     the panel) keeps exactly the box it shows on screen: adding a figure to a
     panel used to RE-FLOW every figure already there (they shrank and jumped
     into a grid cell) and all the layout work had to be redone. `freezeFigures`
     writes that rectangle on every figure of the panel, so the newcomer
     disturbs nobody. */
  const panelBoxOf = (obj) => ({ x: obj.x * cellW, y: obj.y * cellH, w: obj.w * cellW, h: obj.h * cellH });
  const freezeFigures = (obj, imgs) => {
    const box = panelBoxOf(obj);
    return (imgs || []).map((im, i) => {
      if (freeRectOf(im)) return im;                       // already free: untouched
      const g = objFigureGeom(obj, i);
      return {
        ...im,
        rect: pinRectOf({ x: g.vX, y: g.vY, w: g.vW, h: g.vH }, box),
        scale: 1, dx: 0, dy: 0                             // baked into the rectangle
      };
    });
  };
  /* “⊞ Grid layout”: forget the free rectangles and lay the figures out in the
     panel grid again (obj.imgCols columns) — the historical behaviour, now a
     deliberate choice instead of the side effect of adding a figure. */
  const relayoutInGrid = (obj) => {
    if (!obj) return;
    commitHistory();
    setObjects(prev => prev.map(o => (o.id === obj.id
      ? withImages(o, getObjImages(o).map((im) => ({ ...im, rect: null })))
      : o)));
    setCropMode(null);
    setEraseMode(false);
  };

  // Add mode: append another figure to the selected object — the figures already
  // in the panel are FROZEN first (each keeps its own rectangle), so none of
  // them moves or shrinks; the new one lands in the biggest free space left.
  const handleAddImage = async (item) => {
    const obj = objects.find((o) => o.id === selectedId);
    if (!obj) { setLibMsg('Select a panel first (click it), then add a figure to it.'); return; }
    commitHistory();
    const fullSrc = item.full || item.url;
    const resolved = await resolveImageToDataUrl(fullSrc).catch(() => fullSrc);
    const src = String(resolved || '').startsWith('data:')
      ? resolved
      : (item.url && String(item.url).startsWith('data:') ? item.url : resolved);
    const wasCount = getObjImages(obj).length;
    setObjects(prev => prev.map(o => {
      if (o.id !== obj.id) return o;
      const pinned = freezeFigures(o, getObjImages(o));
      const slot = freeSlotFor(pinned.map(freeRectOf));
      return withImages(o, [...pinned, {
        imgSrc: src,
        imgThumb: (item.url && String(item.url).startsWith('data:')) ? item.url : src,
        libScope: libraryTab,
        libProjectId: libraryTab === 'project' ? activeLibProjectId : null,
        libId: item.id,
        src: item.src || null,
        dx: 0, dy: 0, scale: 1,
        rect: slot                                        // the new figure's own box
      }]);
    }));
    // The new figure is the ACTIVE one: its handles are right there to drag it.
    setActiveFig({ objId: obj.id, idx: wasCount });
    setLibMsg(wasCount
      ? `✅ Figure added — the ${wasCount} figure${wasCount === 1 ? '' : 's'} already in panel ${obj.letter || ''} kept their exact place (each one has its own rectangle now) and the new figure is selected: drag or resize it. “⊞ Lay the figures out in a grid” (properties panel) re-flows the panel side by side if you prefer.`
      : `✅ Figure placed on panel ${obj.letter || ''}.`);
    // The library modal stays open so several figures can be added in a row.
  };

  // Remove one figure from the selected multi-figure object.
  const removeObjImage = (idx) => {
    commitHistory();
    setObjects(prev => prev.map(o => o.id === selectedId ? withImages(o, getObjImages(o).filter((_, i) => i !== idx)) : o));
  };

  // ── STACKING ORDER (« laquelle est par-dessus les autres ») ────────────────
  // The figures of a panel are PAINTED in the order of `images[]`, so the LAST
  // one is the one on top: it is what you see where two figures overlap, and
  // the one a click grabs first (the clickable zones and the click-cycling
  // below start from it). Moving a figure inside the list therefore re-layers
  // it — and because the moved figure keeps being the ACTIVE one, its handles
  // must follow it (`index` below): re-laying a figure must never make the
  // handles jump to another picture.
  const moveFigure = (objId, idx, to) => {
    const obj = (objects || []).find((o) => o.id === objId);
    if (!obj) return;
    const res = moveFigureInList(getObjImages(obj), idx, to);
    if (!res.changed) return;          // already there: nothing to undo, nothing to write
    commitHistory();
    setObjects(prev => prev.map(o => (o.id === objId ? withImages(o, res.list) : o)));
    setActiveFig({ objId, idx: res.index });
  };

  // Shadow of ONE figure (`obj.images[idx].shadow`, see utils/figureArrows):
  // the same record a panel and an arrow write, but drawn from the PIXELS of
  // that figure — the filter sits on a group ABOVE the image, so a PNG with a
  // transparent background casts a shadow around its content and the parts the
  // 🧽 eraser removed cast nothing. Unlike the panel shadow (which follows the
  // white frame), this one hugs the picture itself.
  const setFigureShadow = (objId, idx, value) => {
    if (idx < 0) return;
    commitHistory();
    setObjects(prev => prev.map(o => (o.id !== objId ? o
      : withImages(o, getObjImages(o).map((im, i) => (i === idx ? { ...im, shadow: value } : im))))));
  };
  // “Same shadow on every figure of this panel” — ONE click gives every figure
  // of the panel the shadow described by the active one, a second click takes it
  // off them all (mirrors “Same shadow on every panel” for the panels).
  const panelFigures = selectedId ? getObjImages((objects || []).find((o) => o.id === selectedId) || {}) : [];
  const figuresShadowed = panelFigures.some((im) => !!shadowSpec(im && im.shadow));
  const toggleFiguresShadow = () => {
    if (!selectedId || !panelFigures.length) return;
    commitHistory();
    const on = !figuresShadowed;
    const model = panelFigures.map((im) => shadowSpec(im && im.shadow)).find(Boolean) || DEFAULT_SHADOW;
    setObjects(prev => prev.map(o => (o.id !== selectedId ? o
      : withImages(o, getObjImages(o).map((im) => ({ ...im, shadow: on ? { ...model } : null }))))));
  };

  // ---- Multi-figure selection inside overlapping figures ---------------------
  // Figures of one object are laid out in a grid but can be dragged out of their
  // cell (dx/dy) and OVERLAP. SVG hit-testing always grabs the top figure, so a
  // dedicated "active figure" + click-cycling lets the user reach the one
  // underneath: each click on an overlapping spot moves the active figure to the
  // next one below. Only the active figure shows the move/resize handles, drawn
  // ON TOP so it is always grabbable.
  const [activeFig, setActiveFig] = useState(null); // { objId, idx }
  // SÉLECTION MULTIPLE DE FIGURES — « resize them all as the first selected »
  // vaut aussi DANS un panneau : la figure qui porte les poignées (l'ACTIVE, donc
  // la première sélectionnée) est la référence, et les figures cochées « ☑ » dans
  // la liste « Figures in this panel » prennent SA taille quand on la
  // redimensionne (elles suivent aussi ses déplacements), chacune à SA place.
  // Voir startFigureResize / utils/panelSelection.
  const [figGroup, setFigGroup] = useState({ objId: null, idxs: [] });
  const suppressCycleRef = useRef(false);           // a drag just happened → the trailing click must NOT cycle
  // A crop drag also ends with a click on the canvas; that click must not
  // DESELECT the object (which would close the crop panel mid-work).
  const suppressSelectRef = useRef(false);

  // ── image CROP ─────────────────────────────────────────────────────────────
  // A crop belongs to ONE figure (a lettered panel can hold several figures) and
  // is stored in SOURCE-relative units — x1/y1 = top-left, x2/y2 = bottom-right,
  // 0 = the edge of the original image, 1 = the other edge — so it survives a
  // change of panel size, grid or canvas dimensions. `cropMode` remembers the
  // object + figure being cropped: while it is on, dragging on the canvas draws
  // the new window (released mouse = applied).
  const [cropMode, setCropMode] = useState(null);   // { objId, idx }
  const [cropDraft, setCropDraft] = useState(null); // live rectangle { x1, y1, x2, y2 }
  const CROP_MIN = 0.02;                            // smallest window: 2 % of the source

  // ── ERASER ─────────────────────────────────────────────────────────────────
  // « Remove parts » with a round brush whose SIZE is adjustable — the brush
  // takes pixels off the figures it is dragged over. The strokes are stored in
  // the coordinates of each figure (`im.erase`, see utils/figureErase.js) and
  // painted as an SVG mask: the erased parts are really TRANSPARENT (in the
  // composition and in every export), they survive a reload (the canvas only
  // persists thumbnails) and they follow the figure when it is resized. The
  // whole canvas is the drawing area while the eraser is armed, and the brush
  // cursor shows the exact diameter.
  const [eraseMode, setEraseMode] = useState(false);
  const [eraseSize, setEraseSize] = useState(ERASE_DEFAULT_SIZE); // brush diameter (mm)
  const [eraseDraft, setEraseDraft] = useState(null);             // stroke being drawn (canvas mm)
  const [eraseCursor, setEraseCursor] = useState(null);           // { x, y } mm — brush preview

  // The strokes to paint on figure `i`: the stored ones PLUS the stroke being
  // drawn right now (instant feedback, before it is dropped on the figures).
  const eraseStrokesFor = (obj, i) => {
    const stored = eraseStrokesOf(getObjImages(obj)[i]);
    if (!eraseDraft) return stored;
    const geom = objFigureGeom(obj, i);
    if (!mmStrokeHits(eraseDraft, { x: geom.iX, y: geom.iY, w: geom.iW, h: geom.iH })) return stored;
    const live = mmStrokeToSource(eraseDraft, geom);
    return live ? [...stored, live] : stored;
  };
  // Drop a finished stroke: EVERY figure the brush went over is erased (a
  // rubber removes what is under it), each one in its own coordinates.
  const applyEraseStroke = (stroke) => {
    setObjects(prev => prev.map(o => {
      const imgs = getObjImages(o);
      if (!imgs.length) return o;
      let touched = false;
      const next = imgs.map((im, i) => {
        if (!im || !im.imgSrc) return im;
        const src = mmStrokeToSource(stroke, objFigureGeom(o, i));
        if (!src) return im;
        touched = true;
        return { ...im, erase: [...eraseStrokesOf(im), src] };
      });
      return touched ? withImages(o, next) : o;
    }));
  };
  // « ⟲ Clear erasures » — put the pixels of ONE figure back.
  const clearErase = (objId, idx) => {
    if (idx < 0) return;
    commitHistory();
    setObjects(prev => prev.map(o => {
      if (o.id !== objId) return o;
      return withImages(o, getObjImages(o).map((im, i) => (i === idx ? { ...im, erase: [] } : im)));
    }));
  };

  // Valid crop window of a figure (null when the figure is not cropped).
  const cropOf = (im) => {
    const c = im && im.crop;
    if (!c) return null;
    const nums = ['x1', 'y1', 'x2', 'y2'].map((k) => Math.max(0, Math.min(1, Number(c[k]))));
    if (nums.some((v) => !Number.isFinite(v))) return null;
    const [x1, y1, x2, y2] = nums;
    if (!(x2 - x1 >= CROP_MIN && y2 - y1 >= CROP_MIN)) return null;
    // A window that covers the whole image is NOT a crop: the figure is drawn
    // by the historical path (browser aspect fitting) again.
    if (x1 <= 0 && y1 <= 0 && x2 >= 1 && y2 >= 1) return null;
    return { x1, y1, x2, y2 };
  };

  // Geometry (mm, absolute on the canvas) of ONE figure inside an object.
  const objFigureGeom = (obj, i) => {
    const imgs = getObjImages(obj);
    const im = imgs[i] || {};
    const single = imgs.length === 1;
    const cols = single ? 1 : Math.max(1, obj.imgCols || 2);
    const rows = single ? 1 : Math.ceil(imgs.length / cols);
    const cw = (obj.w * cellW) / cols;
    const ch = (obj.h * cellH) / rows;
    const pad = obj.imgPadding || 0;
    /* FREE LAYOUT — see utils/figureLayout.js. A figure carrying an `im.rect`
       keeps THAT box (fractions of the panel): neither the number of figures in
       the panel, nor the grid columns, nor a panel resize moves it any more.
       `➕ Add figure` writes it on the figures ALREADY there (baked from what
       they occupy on screen), so adding a figure never disturbs them — it used
       to re-flow the whole panel and everything had to be laid out again.
       The rect IS the visible box: no padding, no panel scale and no per-figure
       shift are applied on top of it (all of them were baked into it). */
    const rect = freeRectOf(im);
    const baseX = rect ? (obj.x * cellW) + rect.x * obj.w * cellW : obj.x * cellW + (i % cols) * cw + pad;
    const baseY = rect ? (obj.y * cellH) + rect.y * obj.h * cellH : obj.y * cellH + Math.floor(i / cols) * ch + pad;
    const baseW = rect ? rect.w * obj.w * cellW : cw - pad * 2;
    const baseH = rect ? rect.h * obj.h * cellH : ch - pad * 2;
    const figScale = rect ? 1 : (obj.imgScale || 1) * (im.scale || 1);
    const crop = cropOf(im);
    const cropW = crop ? crop.x2 - crop.x1 : 1;
    const cropH = crop ? crop.y2 - crop.y1 : 1;
    let iW = baseW * figScale;
    let iH = baseH * figScale;
    /* Canvas option "🔒 Keep aspect ratio": the figure is drawn with its OWN
       width/height ratio inside its panel instead of being stretched to the
       panel cell — so changing the number of panels (grid) or the canvas
       dimensions only rescales it. When the ratio is not known yet (figure
       still loading / unreachable) the cell is used, which is harmless because
       the <image> is rendered with preserveAspectRatio="meet" anyway.
       A CROPPED figure is fitted on the ratio of its CROP WINDOW (the window
       replaces the figure: it fills the panel, the rest of the source stays
       hidden around it). */
    const natAspect = keepAspect || crop ? (imageAspectCache.get(im.imgSrc) || 0) : 0;
    const boxAspect = natAspect > 0 && (keepAspect || crop)
      ? (obj.imgFit === 'stretch' && crop ? 0 : natAspect * (cropW / cropH))
      : 0;
    if (boxAspect > 0 && iW > 0 && iH > 0) {
      if (iW / iH > boxAspect) iW = iH * boxAspect;
      else iH = iW / boxAspect;
    }
    // The VISIBLE window (what the user sees, clicks and drags): the figure is
    // centred in its box, then shifted by the panel-wide offset and its own
    // (both zero for a free-layout figure — they were baked into its rect).
    const vX = baseX + (baseW - iW) / 2 + (rect ? 0 : (obj.imgOffsetX || 0) + (im.dx || 0));
    const vY = baseY + (baseH - iH) / 2 + (rect ? 0 : (obj.imgOffsetY || 0) + (im.dy || 0));
    if (!crop) {
      return { iX: vX, iY: vY, iW, iH, vX, vY, vW: iW, vH: iH, crop: null };
    }
    // The FULL image is drawn AROUND that window (bigger, offset) and clipped to
    // it, so the crop window lands exactly on the visible box.
    const dW = iW / cropW;
    const dH = iH / cropH;
    return {
      iX: vX - crop.x1 * dW,
      iY: vY - crop.y1 * dH,
      iW: dW,
      iH: dH,
      vX, vY, vW: iW, vH: iH,
      crop
    };
  };

  // Figure index a per-figure command (crop, resize…) applies to: the single
  // figure, else the active one, else the topmost.
  const activeFigIdx = (obj) => {
    const imgs = getObjImages(obj);
    if (!imgs.length) return -1;
    if (imgs.length === 1) return 0;
    return (activeFig && activeFig.objId === obj.id && activeFig.idx >= 0 && activeFig.idx < imgs.length)
      ? activeFig.idx : imgs.length - 1;
  };

  // ── sélection multiple de FIGURES (dans un même panneau) ────────────────────
  // The figures ticked “☑” in the “Figures in this panel” list are the ones that
  // follow the ACTIVE figure (the reference). This helper is what the two drag
  // handlers ask — an empty list simply means “the active figure alone”.
  const figGroupOf = (objId) => (figGroup.objId === objId ? figGroup.idxs : []);
  const toggleFigGroup = (objId, idx) => setFigGroup((prev) => {
    const cur = prev.objId === objId ? prev.idxs : [];
    return { objId, idxs: cur.includes(idx) ? cur.filter((i) => i !== idx) : [...cur, idx] };
  });
  // The snapshot of every figure involved in a drag (the one held + the ticked
  // ones), taken when the mouse goes down: the geometry is then written in
  // ABSOLUTE values, so a long drag cannot accumulate rounding, and releasing
  // then grabbing again starts from the same base.
  const figureSnapshot = (obj, refIdx) => {
    const imgs = getObjImages(obj);
    const idxs = [refIdx, ...figGroupOf(obj.id).filter((i) => i !== refIdx)];
    return idxs.filter((i) => i >= 0 && i < imgs.length).map((i) => ({
      idx: i,
      rect: freeRectOf(imgs[i]),
      scale: Number(imgs[i] && imgs[i].scale) || 1,
      dx: Number(imgs[i] && imgs[i].dx) || 0,
      dy: Number(imgs[i] && imgs[i].dy) || 0
    }));
  };
  // Selecting another panel (or deleting one) resets the figure selection: its
  // indices only mean something inside the panel they were taken in.
  useEffect(() => {
    setFigGroup((prev) => (prev.objId && prev.objId !== selectedId ? { objId: null, idxs: [] } : prev));
  }, [selectedId]);

  // Figure indices whose bounds contain the point (mm, absolute), topmost first.
  const figuresAt = (obj, xMm, yMm) => {
    const imgs = getObjImages(obj);
    const hits = [];
    imgs.forEach((im, i) => {
      if (!im || !im.imgSrc) return;
      const g = objFigureGeom(obj, i);
      if (xMm >= g.vX && xMm <= g.vX + g.vW && yMm >= g.vY && yMm <= g.vY + g.vH) hits.push(i);
    });
    return hits.reverse(); // last rendered = topmost
  };

  // Cycle the active figure under the mouse point (click on an overlapping spot).
  const cycleFigureAt = (obj, e) => {
    const svgEl = activeSvgEl();
    if (!svgEl || !obj) return;
    const r = svgEl.getBoundingClientRect();
    const xMm = (e.clientX - r.left) * (canvasW / Math.max(1, r.width));
    const yMm = (e.clientY - r.top) * (canvasH / Math.max(1, r.height));
    const hits = figuresAt(obj, xMm, yMm);
    if (!hits.length) return;
    setActiveFig(prev => {
      const cur = (prev && prev.objId === obj.id) ? prev.idx : -1;
      const at = hits.indexOf(cur);
      // Already on the topmost hit → move to the next one underneath.
      if (at === 0) return { objId: obj.id, idx: hits.length > 1 ? hits[1] : hits[0] };
      return { objId: obj.id, idx: hits[0] };
    });
  };

  // Move an image between a project library and the common (dataset) library.
  // The destination project is the one picked in the modal's project list
  // (`libProjectId`, defaulting to the project this editor was opened with) — the
  // same choice the library browse uses. It is NEVER an implicit fallback: a
  // builder opened without a project used to send the image to the unassigned
  // scope, which no project page and no Project tab ever lists again (the image
  // looked lost). Leaving a project needs write access to the project the entry
  // is taken OUT of; entering one needs it on the project it goes INTO.
  const transferItem = (item) => {
    const from = libraryTab; // 'project' | 'common'
    const to = from === 'project' ? 'common' : 'project';
    const srcProjectId = activeLibProjectId;                  // scope left behind
    const destProjectId = libProjectId || projectId || null;   // scope written to
    if (to === 'project') {
      if (!destProjectId) {
        setLibMsg('📁 Pick the project this image goes to in the “Move into” list, then click ⇄ again.');
        return;
      }
      if (!canWriteLibProject(destProjectId)) {
        setLibMsg('🔒 You do not have edit access to that project’s image library.');
        return;
      }
    } else if (!canWriteLibProject(srcProjectId)) {
      setLibMsg('🔒 You do not have edit access to that project’s image library.');
      return;
    }
    moveLibraryItem(from, to, to === 'project' ? destProjectId : srcProjectId, item.id);
    setLibMsg(to === 'project'
      ? `✅ “${item.label || 'Image'}” is now in the “${canvasScopeName(destProjectId)}” project library (Project tab — and that project page’s “🖼 Saved canvases”).`
      : `✅ “${item.label || 'Image'}” is now in the shared dataset library.`);
    setLibVersion((v) => v + 1);
  };

  /* ---- DÉPLACER UNE IMAGE DANS LA BIBLIOTHÈQUE (glisser-déposer) ------------
     The ORDER of the library list is what the pickers show, and the ⇄ button
     moves an entry between the project library and the shared dataset one. The
     mouse now does both, exactly like the figures on a project page:
       • drop a thumbnail on ANOTHER one  → it takes that place in the list;
       • drop it on the OTHER TAB         → it moves into that library. */
  const libScopeOf = () => (libraryTab === 'project' ? 'project' : 'common');
  const libScopeProjectId = () => (libraryTab === 'project' ? activeLibProjectId : null);
  const dropOnLibCard = (item) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const d = libDragRef.current;
    libDragRef.current = null;
    setLibOver('');
    if (!d || !item || d.id === item.id) return;
    const scope = libScopeOf();
    const pid = libScopeProjectId();
    if (d.scope !== scope || d.projectId !== pid) {
      // Came from the other library: it lands HERE, at the dropped place.
      moveLibraryItem(d.scope, scope, activeLibProjectId, d.id);
    }
    if (reorderLibraryItem(scope, pid, d.id, item.id)) setLibVersion((v) => v + 1);
    setLibMsg(`↔ “${item.label || 'Image'}” changed place in the library.`);
  };
  const dropOnLibTab = (scope) => (e) => {
    e.preventDefault();
    const d = libDragRef.current;
    libDragRef.current = null;
    setLibOver('');
    if (!d || d.scope === scope) return;
    const label = (libraryItems.find((x) => x.id === d.id) || {}).label || 'Image';
    moveLibraryItem(d.scope, scope, activeLibProjectId, d.id);
    setLibraryTab(scope);
    setLibVersion((v) => v + 1);
    setLibMsg(scope === 'project'
      ? `⇄ “${label}” moved into the “${canvasScopeName(activeLibProjectId)}” project library (its Project tab — and that project page’s “🖼 Saved canvases”).`
      : `⇄ “${label}” moved into the shared dataset library.`);
  };

  // Rename / delete a library image.
  const renameLib = (id) => {
    if (libraryTab === 'project' && !canWriteLibProject(activeLibProjectId)) {
      setLibMsg('🔒 You do not have edit access to that project’s image library.');
      return;
    }
    const current = (libraryTab === 'project' ? readProjectLibrary(activeLibProjectId) : readLibrary()).find((i) => i.id === id);
    const name = window.prompt('Image label:', (current && current.label) || '');
    if (name && name.trim()) {
      if (libraryTab === 'project') renameProjectLibraryItem(activeLibProjectId, id, name.trim());
      else renameLibraryItem(id, name.trim());
      setLibVersion((v) => v + 1);
    }
  };
  const deleteLib = (id) => {
    if (libraryTab === 'project' && !canWriteLibProject(activeLibProjectId)) {
      setLibMsg('🔒 You do not have edit access to that project’s image library.');
      return;
    }
    if (!window.confirm('Delete this image from the library?')) return;
    if (libraryTab === 'project') removeProjectLibraryItem(activeLibProjectId, id);
    else removeLibraryItem(id);
    setLibVersion((v) => v + 1);
  };

  /* ---- ☁ ⇄ La bibliothèque et le Drive (le geste qui manquait) --------------
     « Mes images ne sont pas sur le Drive » a deux causes, et une réponse pour
     chacune :
       • ☁ Save to Drive → les images de CETTE portée dont les pixels ne vivent
         encore que dans ce navigateur (base64) partent dans
         <dataset>/projects/<projet>/images ; leur copie locale devient le lien
         Drive (sans cela elles ne suivent pas sur un autre ordinateur).
       • ⬇ Add missing   → relit ce dossier et AJOUTE les fichiers qu'il contient
         mais que cette liste n'affiche pas (liste perdue sur ce poste, autre
         navigateur) ; « ♻️ Recover » fait de même depuis un fichier de
         sauvegarde, qui est le seul endroit où voyage la LISTE.
     Les trois sont ADDITIFS : rien n'est supprimé ni écrasé. Ils n'existaient
     que dans le panneau « Image library » de Figures & Slides — un écran que
     l'on n'ouvre jamais depuis l'Image Builder — donc ils sont ICI aussi, dans
     la fenêtre de bibliothèque que l'on a sous les yeux. */
  const libScopeInfo = () => ({
    scope: libraryTab === 'project' ? 'project' : 'common',
    projectId: libraryTab === 'project' ? activeLibProjectId : null,
    projectName: libraryTab === 'project' && activeLibProjectId ? canvasScopeName(activeLibProjectId) : ''
  });
  const libWriteDenied = () => {
    if (libraryTab === 'project' && !canWriteLibProject(activeLibProjectId)) {
      setLibMsg('🔒 You do not have edit access to that project’s image library.');
      return true;
    }
    return false;
  };

  const libSaveToDrive = async () => {
    if (libDriveBusy || libWriteDenied()) return;
    setLibDriveBusy(true);
    setLibMsg('☁ Sending to Drive the images that are still only in this browser…');
    try {
      const res = await pushLibraryToDrive(libScopeInfo());
      setLibVersion((v) => v + 1);
      setLibMsg(res.total === 0
        ? '✓ Every image of this library is already on Drive.'
        : res.failed === 0
          ? `✓ ${res.uploaded} image${res.uploaded === 1 ? '' : 's'} saved to ${res.folder}.`
          : `⚠ ${res.uploaded} saved to ${res.folder} · ${res.failed} failed — check the connection and try again.`);
    } catch (err) {
      setLibMsg(`⚠ ${(err && err.message) || 'Could not save the images to Drive'}`);
    }
    setLibDriveBusy(false);
  };

  const libAddMissingFromDrive = async () => {
    // Reading the folder only ADDS entries to this browser's list (the Drive
    // folder itself is never touched), so a read-only coworker may do it too —
    // it is how they see on this computer the figures the others uploaded.
    if (libDriveBusy) return;
    if (libraryTab === 'project' && activeLibProjectId && !canSeeLibProject(activeLibProjectId)) {
      setLibMsg('🔒 That project’s figures are private to its team.');
      return;
    }
    setLibDriveBusy(true);
    setLibMsg('⬇ Reading this library’s folder on Drive…');
    try {
      const res = await pullLibraryFromDrive(libScopeInfo());
      setLibVersion((v) => v + 1);
      setLibMsg(res.error
        ? `⚠ ${res.error}`
        : res.found === 0
          ? `No image found in ${res.folder} (nothing has been uploaded there yet — use ☁ Save to Drive first).`
          : res.added === 0
            ? `✓ ${res.found} image${res.found === 1 ? '' : 's'} in ${res.folder} — all already listed here.`
            : `✓ ${res.added} image${res.added === 1 ? '' : 's'} added from ${res.folder} (${res.found} file${res.found === 1 ? '' : 's'} in the folder).`);
    } catch (err) {
      setLibMsg(`⚠ ${(err && err.message) || 'Could not read the Drive folder'}`);
    }
    setLibDriveBusy(false);
  };

  // ♻️ Recover the library FROM A BACKUP: only its image list is read out
  // (`_figuresLibrary` / `_figuresLibraryProjects`), everything else in the file
  // is ignored, and the merge only ADDS / COMPLETES entries.
  const libRecoverFromBackup = async (file) => {
    if (!file) return;
    setLibMsg(`Reading ${file.name}…`);
    try {
      const text = await file.text();
      const figures = figuresFromBackupHtml(text, (s) => LZString.decompressFromUTF16(s));
      if (!figures) {
        setLibMsg('⚠ This file is not a Lab Workspace backup (no saved-data block inside).');
        return;
      }
      const counts = backupFigureCount(figures);
      if (!counts.total) {
        setLibMsg('⚠ This backup contains no image library — it was written by a version that did not embed it yet.');
        return;
      }
      const res = mergeLibraryFromSnapshot({ common: figures.common, projects: figures.projects });
      setLibVersion((v) => v + 1);
      setLibMsg(`✓ Backup read: ${res.added} image${res.added === 1 ? '' : 's'} added, ${res.filled} completed`
        + `${counts.projectCount ? ` · ${counts.projectCount} project librar${counts.projectCount === 1 ? 'y' : 'ies'} (${counts.projectItems} image${counts.projectItems === 1 ? '' : 's'})` : ''}`
        + '. Nothing was deleted — the images themselves stay on Drive.');
    } catch (err) {
      setLibMsg(`⚠ ${(err && err.message) || 'Could not read this file'}`);
    }
  };

  // Publish the CURRENT composition as a canvas entry of the image library.
  // `targetProjectId` decides the scope: that project's library (the one the
  // project page reads for its "🖼 Saved canvases" list AND for the figures
  // inserted into its sections), or the common library when null.
  // The copy of THAT scope is UPDATED in place when it already exists
  // (`updateId`): ids never change, so project-page links keep working and no
  // scope fills up with duplicates of the same composition. Copies in other
  // scopes are left untouched — a canvas composed in project A and inserted into
  // project B becomes one entry in EACH library. Returns { entry, drive, updated }
  // or null. Shared by "💾 Save canvas" and by "📤 Insert into project…" (which
  // stores the returned entry id on the inserted figure → "✏️ Modify in Image
  // Builder").
  const publishCanvas = async ({ label, targetProjectId = projectId || null, dataUrl = null }) => {
    const target = targetProjectId || null;
    // Publishing a canvas into a project library writes to that project, so it
    // needs edit access to it (a 'view' coworker may read it, not write).
    if (target && !canWriteLibProject(target)) return null;
    const img = dataUrl || await renderToDataUrl(Math.max(3, 1800 / Math.max(1, canvasW)));
    if (!img) return null;
    const driveProject = target ? (allProjects.find((p) => p.id === target) || null) : null;
    const known = canvasEntryIn(target);
    const { entry, drive, updated } = await publishLibraryFigure({
      scope: target ? 'project' : 'common',
      projectId: target,
      projectName: driveProject ? String(driveProject.name || '') : '',
      dataUrl: img,
      label: String(label || 'Canvas').trim(),
      src: null,
      updateId: known ? known.id : null,
      canvasData: {
        canvasW, canvasH, gridCols, gridRows, showPanelBorders, showGridLines, keepAspect, globalCaption,
        objects: (objects || []).map(thumbnailsOf),
        arrows: arrows || []
      }
    });
    if (!entry) return null;
    // This entry is one of the canvas' copies now (and the scope touched last),
    // so a later save of this scope updates it in place.
    rememberCanvasEntry(target, entry);
    setLibVersion((v) => v + 1);
    return { entry, drive, updated };
  };

  // Open the "💾 Save canvas" dialog. Its DESTINATION is the point of it: the
  // canvas can be stored in ANY project's library (Image Library → Project tab +
  // that project page's "🖼 Saved canvases") — not only in the project this
  // editor was opened with — and in the shared dataset library. It proposes the
  // place the canvas was stored last (or the project of this editor).
  const openSaveDialog = () => {
    const fallback = canvasLabel || (globalCaption && String(globalCaption).trim()
      ? `Figure — ${String(globalCaption).trim().slice(0, 60)}`
      : `Canvas ${new Date().toLocaleDateString()}`);
    setSaveName(fallback);
    setSaveDest(storedScopeCount ? (canvasHome || '') : (projectId || ''));
    // The dialog only offers the projects this user may WRITE to, so a project
    // they cannot edit must not stay proposed: fall back to the shared library.
    const proposed = storedScopeCount ? (canvasHome || '') : (projectId || '');
    if (!canWriteLibProject(proposed)) setSaveDest('');
    setSaveMsg('');
    setSaveOpen(true);
  };

  // Save / re-save the WHOLE canvas (composition) in the chosen library. The
  // rendered image is uploaded to the cloud (same <project>/images path as every
  // other figure); only a small local preview + the editable canvas snapshot are
  // kept in the browser, so a full localStorage quota never blocks a save.
  const doSaveCanvas = async () => {
    const label = String(saveName || '').trim();
    if (!label) { setSaveMsg('⚠️ Give the canvas a name first.'); return; }
    const destProjectId = saveDest || null;
    setSaveBusy(true);
    setSaveMsg('📤 Saving the canvas…');
    try {
      const pub = await publishCanvas({ label, targetProjectId: destProjectId, dataUrl: null });
      if (!pub || !pub.entry) {
        setSaveMsg(destProjectId && !canWriteLibProject(destProjectId)
          ? '🔒 You do not have edit access to that project’s image library — save into the shared dataset library instead.'
          : '⚠️ Could not save the canvas in the library.');
        return;
      }
      const what = pub.updated ? 'updated' : 'saved';
      const where = destProjectId
        ? `in the “${canvasScopeName(destProjectId)}” image library (Image Library → Project tab — and on that project page under “🖼 Saved canvases”, where it reopens here)`
        : 'in the shared dataset image library (Image Library → Dataset tab)';
      const folderLabel = projectImagesFolderLabel(destProjectId ? canvasScopeName(destProjectId) : '', getDriveRootName());
      let detail;
      if (pub.drive && pub.drive.id) detail = `☁ cloud copy in ${folderLabel}`;
      else if (!localStorageHealthy()) detail = '⚠️ browser storage full — connect Google Drive or Nextcloud so it is kept there (this session still works)';
      else detail = '💾 browser copy only (no cloud storage connected)';
      // Show the user WHERE it landed: the library opens on that very tab.
      setLibraryTab(destProjectId ? 'project' : 'common');
      setLibProjectId(destProjectId);
      setShowLibrary(true);
      setLibMsg(`✅ Canvas ${what} ${where} · ${detail}`);
      setSaveOpen(false);
      setSaveMsg('');
    } catch (err) {
      console.warn('Canvas save failed:', err && err.message);
      setSaveMsg('⚠️ Could not save the canvas — please connect Google Drive and try again.');
    } finally {
      setSaveBusy(false);
    }
  };

  // Recall a saved canvas from the library: replace the current canvas with the
  // saved snapshot (all objects, positions, captions, size and grid). `confirm`
  // is skipped when the project page itself asked for this canvas (the user
  // already clicked "Open in Image Builder"). `opts.scopeProjectId` is the
  // library the canvas was opened FROM (null = the shared dataset library), so
  // saving it again updates that very entry — not a copy in another scope.
  const restoreCanvasFromItem = (item, opts = {}) => {
    if (!item || !item.canvasData) return;
    // Defence in depth: a canvas living in the library of a project this user
    // may not open is never restored, whoever calls this.
    const fromProject = opts.scopeProjectId || null;
    if (fromProject && !canSeeLibProject(fromProject)) {
      setLibMsg('🔒 That project’s figures are private to its team.');
      return;
    }
    if (opts.confirm !== false && !window.confirm(`Replace the current canvas with “${item.label}”?`)) return;
    commitHistory();
    const cd = item.canvasData;
    if (cd.canvasW) setCanvasW(cd.canvasW);
    if (cd.canvasH) setCanvasH(cd.canvasH);
    if (cd.gridCols) setGridCols(cd.gridCols);
    if (cd.gridRows) setGridRows(cd.gridRows);
    // Saved canvases written before the delimiter switches existed keep the
    // current choice (they simply have no value stored).
    if (cd.showPanelBorders !== undefined) setShowPanelBorders(!!cd.showPanelBorders);
    if (cd.showGridLines !== undefined) setShowGridLines(!!cd.showGridLines);
    if (cd.keepAspect !== undefined) setKeepAspect(!!cd.keepAspect);
    if (cd.globalCaption !== undefined) setGlobalCaption(cd.globalCaption);
    setObjects((cd.objects || []).map((o) => resolveObj(o)));
    // The saved canvas carries its own annotations (an older canvas has none).
    setArrows((cd.arrows || []).map(normalizeArrow));
    setSelectedId(null);
    setSelectedArrowId(null);
    setEditingObjCaption(null);
    setEditingCaption(false);
    setShowLibrary(false);
    setHydrateTick((t) => t + 1);
    // Remember which library entry (in which scope) this canvas IS: the next
    // "💾 Save canvas" updates it (ids never change), so the links that open this
    // composition keep working.
    rememberCanvasEntry(
      opts.scopeProjectId !== undefined ? opts.scopeProjectId : (projectId || null),
      item
    );
  };

  // Open the original experiment — on the very CONDITION (instance) the figure
  // was captured on — AND scroll to the exact chart/spectrum it was taken from.
  //
  // The request is queued in utils/pendingFigureScroll so the experiment page
  // can act on it: ChartStarLayer marks every chart with `data-figure-origin`
  // and brings the captured one into view (opening the closed sections when it
  // is hidden inside one), while the page's own scroll memory stands down so it
  // cannot put the user back where they were instead of at the graph. Passing
  // the whole `src` stamp to jumpToTest also lets App reclaim the SAME
  // condition when the experiment was rebuilt in between (new ids).
  const openOriginalGraph = (src) => {
    if (!src || !src.testId) return;
    queuePendingFigureScroll({
      key: src.elementKey,
      label: src.elementLabel,
      testId: src.testId,
      testName: src.testName,
      instanceName: src.instanceName,
      date: src.date
    });
    if (jumpToTest) jumpToTest(src.testId, src);
  };

  /* ── AUTOMATIC RE-CAPTURE ─────────────────────────────────────────────────
     "The figures of this canvas were captured with another style": instead of
     sending the user to each experiment to press 🎨 then 📷, the builder QUEUES
     the figures (library entry + the exact chart element, see
     utils/figureRecapture) and opens the first experiment. The experiment page
     applies the profile, re-captures each queued element and REPLACES its
     library entry in place, then reopens this builder — whose canvas objects
     are refreshed from the library below. Nothing to do by hand. */
  const [recapNote, setRecapNote] = useState(null);   // summary of the last run
  const recapAppliedAt = useRef(0);

  const recaptureFigures = (rows) => {
    const usable = (rows || []).filter((r) => r && r.canRecapture);
    if (!usable.length) return 0;
    // ONE item per FIGURE: the same library entry can sit on the canvas twice
    // (the same capture placed in two panels) — capturing it twice would only
    // write the same pixels again.
    const seen = new Set();
    const items = [];
    usable.forEach((r) => {
      const key = `${r.libId}|${r.elementKey}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push({
        figId: r.libId,
        scope: r.libScope,
        projectId: r.libProjectId,
        label: r.label,
        elementKey: r.elementKey,
        styleTag: r.tag,
        origin: r.src || {}
      });
    });
    // A run travels through EVERY experiment of the list, so a stray click on a
    // canvas holding dozens of figures is worth one question. (The experiment
    // page has a ⏹ Stop button too, see ChartStarLayer.)
    if (items.length > 4 && typeof window !== 'undefined'
      && !window.confirm(`Re-capture ${items.length} figures automatically?\n\nThe app opens each experiment, re-renders its charts with the current figure style and replaces the saved figures in the image library. A ⏹ Stop button appears on the experiment page while the run is going.`)) {
      return 0;
    }
    // Two runs must never capture at the same time: whatever is still pending
    // from a previous request is closed first (nothing new is written).
    stopFigureRecaptures('replaced by a new re-capture request');
    queueFigureRecaptures(items, {
      origin: 'image-builder',
      return: { module: 'image-builder', projectId: projectId || null }
    });
    setRecapNote(null);
    const first = items[0];
    if (jumpToTest && first.origin && first.origin.testId) jumpToTest(first.origin.testId, first.origin);
    return items.length;
  };

  // Coming back from the experiments: show what was done and pull the NEW
  // pixels of every re-captured figure into the canvas (the objects keep a
  // thumbnail + the library id, so re-resolving them is enough).
  useEffect(() => {
    const sync = () => {
      const sum = figureRecaptureSummary();
      if (!sum || sum.at === recapAppliedAt.current) return;
      recapAppliedAt.current = sum.at;
      // The report banner is only shown for a run that just happened — the
      // canvas refresh below is done whenever a run is recorded, so a figure
      // re-captured earlier still shows its NEW pixels here.
      if (hasFreshFigureRecapture(5 * 60 * 1000)) setRecapNote(sum);
      setObjects((objs) => objs.map((o) => ((o.libId || (o.images || []).some((im) => im && im.libId)) ? resolveObj(o) : o)));
      setHydrateTick((t) => t + 1);
    };
    sync();
    return subscribeFigureRecapture(sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, storageKey]);

  // How many figure(s) of the canvas can be redone automatically? (A figure
  // captured before the element stamp existed — or a saved canvas — cannot.)
  const recapturableCount = styleBad.filter((r) => r.canRecapture).length;

  // 🧹 Copies a runaway re-capture left in the image library (see
  // figuresLibrary.findRecaptureDuplicates): the count is shown while the audit
  // panel is open and the copies go away only on an explicit click.
  const [dupInfo, setDupInfo] = useState({ count: 0, msg: '' });
  useEffect(() => {
    if (!styleAuditOpen) return;
    // Only the libraries of the projects this user may open are counted/cleaned:
    // a maintenance click must not touch another team's project. (The allow-list
    // is rebuilt from its string form so it can be an effect dependency.)
    try {
      const ids = myProjectIdsKey ? myProjectIdsKey.split('|') : [];
      setDupInfo((d) => ({ ...d, count: countRecaptureDuplicates({ allowedProjectIds: ids }) }));
    } catch { /* ignore */ }
  }, [styleAuditOpen, objects, recapNote, myProjectIdsKey]);
  const cleanRecaptureCopies = () => {
    const res = removeRecaptureDuplicates({ allowedProjectIds: myProjectIds });
    let left = 0;
    try { left = countRecaptureDuplicates({ allowedProjectIds: myProjectIds }); } catch { left = 0; }
    setDupInfo({
      count: left,
      msg: res.removed ? `${res.removed} duplicate cop${res.removed === 1 ? 'y' : 'ies'} removed` : 'no duplicate left'
    });
    setObjects((objs) => objs.map((o) => ((o.libId || (o.images || []).some((im) => im && im.libId)) ? resolveObj(o) : o)));
  };

  // Human-readable origin of a figure: "experiment — condition · chart".
  const originLabelOf = (src) => [src.testName, src.instanceName].filter(Boolean).join(' — ');

  // Drag & Resize Logic
  const startDrag = (e, id) => {
    e.stopPropagation();
    commitHistory();
    const obj = objects.find(o => o.id === id);
    if (!obj) return;
    // Hold Shift while dragging the object frame to SHIFT the image instead.
    if (e.shiftKey && obj.imgSrc) {
      dragState.current = { type: 'imgShift', id, startX: e.clientX, startY: e.clientY, origX: obj.imgOffsetX || 0, origY: obj.imgOffsetY || 0 };
      window.addEventListener('mousemove', onDrag);
      window.addEventListener('mouseup', endDrag);
      return;
    }
    // MULTI-SELECTION: the panel being dragged is the REFERENCE (the first
    // selected one) and every selected panel follows by the same offset — the
    // snapshot of each box is taken now, so the drag writes absolute cells.
    dragState.current = { type: 'move', id, startX: e.clientX, startY: e.clientY, origX: obj.x, origY: obj.y, orig: boxesOf(selectionWith(id)) };
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', endDrag);
  };

  const startResize = (e, id) => {
    e.stopPropagation();
    commitHistory();
    const obj = objects.find(o => o.id === id);
    // MULTI-SELECTION: the handle belongs to the FIRST selected panel (the
    // reference) and EVERY selected panel takes its size (“resize them all as
    // the first selected”, see utils/panelSelection). The box of each one is
    // snapshotted now: the drag then writes absolute sizes.
    dragState.current = { type: 'resize', id, startX: e.clientX, startY: e.clientY, origW: obj.w, origH: obj.h, origX: obj.x, origY: obj.y, orig: boxesOf(selectionWith(id)) };
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', endDrag);
  };

  const onDrag = (e) => {
    if (!dragState.current) return;
    const { type, id, imgIdx, textId, startX, startY, origX, origY, origW, origH, origScale } = dragState.current;
    const svgEl = activeSvgEl();
    if (!svgEl) return;

    const rect = svgEl.getBoundingClientRect();
    const scaleX = canvasW / rect.width;
    const scaleY = canvasH / rect.height;

    const dxMm = (e.clientX - startX) * scaleX;
    const dyMm = (e.clientY - startY) * scaleY;
    if (Math.abs(dxMm) > 0.05 || Math.abs(dyMm) > 0.05) {
      if (dragState.current) dragState.current.moved = true;
    }

    // ── CROP: drag a rectangle over the figure being cropped ──────────────────
    // The pointer is converted into SOURCE units (0…1 of the original image)
    // through the DRAWN rect (iX/iW) — the rect that maps the whole source — and
    // the window is kept inside the window that was already there (a crop can
    // only ever be refined, never re-opened on the parts already cropped away).
    if (type === 'crop') {
      const st = dragState.current;
      const g = st.geom;
      const nx = g && g.iW ? Math.max(0, Math.min(1, ((e.clientX - rect.left) * scaleX - g.iX) / g.iW)) : 0;
      const ny = g && g.iH ? Math.max(0, Math.min(1, ((e.clientY - rect.top) * scaleY - g.iY) / g.iH)) : 0;
      const { base, from } = st;
      const draft = {
        x1: Math.max(base.x1, Math.min(from.x, nx)),
        y1: Math.max(base.y1, Math.min(from.y, ny)),
        x2: Math.min(base.x2, Math.max(from.x, nx)),
        y2: Math.min(base.y2, Math.max(from.y, ny))
      };
      st.draft = draft;
      setCropDraft(draft);
      return;
    }

    // ── ERASER: the pointer paints a stroke with the brush of the chosen size ──
    // The points are kept in canvas millimetres; they are turned into the
    // coordinates of every figure the brush crosses when the mouse is released
    // (and, live, by `eraseStrokesFor` so the hole appears while drawing).
    if (type === 'erase') {
      const st = dragState.current;
      const pt = mmAtPointer(e.clientX, e.clientY, svgEl);
      if (pt && st.stroke) {
        const next = pushStrokePoint(st.stroke, pt.x, pt.y);
        if (next !== st.stroke) {
          st.stroke = next;
          st.moved = true;
          setEraseDraft(next);
        }
      }
      setEraseCursor(pt);
      return;
    }

    // Move the figures of a panel: the one HELD (the active figure — the first
    // selected) and the ticked ones follow the same offset, each in ITS own
    // coordinate — a free box in fractions of the panel, a grid figure in dx/dy
    // millimetres (see utils/panelSelection).
    if (type === 'figMove') {
      const st = dragState.current;
      setObjects(prev => prev.map(o => {
        if (o.id !== id || !Array.isArray(o.images)) return o;
        const figs = (st && st.figs) || [{ idx: imgIdx, rect: freeRectOf(getObjImages(o)[imgIdx]), dx: origX, dy: origY, scale: origScale }];
        const patches = moveFiguresPatches(figs, { dxMm, dyMm, panelWmm: o.w * cellW, panelHmm: o.h * cellH });
        return { ...o, images: o.images.map((im, i) => (patches[i] ? { ...im, ...patches[i] } : im)) };
      }));
      return;
    }

    // Resize the figure whose handle was grabbed (the ACTIVE figure — the first
    // selected one): the ticked figures of the panel take ITS size, each one
    // keeping its own place (“resize them all as the first selected”, see
    // resizeFiguresPatches). A figure still laid out in the panel grid has no
    // box of its own: it grows by the same factor.
    if (type === 'figResize') {
      const st = dragState.current;
      setObjects(prev => prev.map(o => {
        if (o.id !== id || !Array.isArray(o.images)) return o;
        const figs = (st && st.figs) || [{ idx: imgIdx, rect: freeRectOf(getObjImages(o)[imgIdx]), scale: origScale }];
        const ref = figs.find((f) => f.idx === imgIdx) || figs[0];
        const factor = figureResizeFactor(ref, { dxMm, cellW, panelW: o.w, imgCols: o.imgCols });
        const patches = resizeFiguresPatches(figs, imgIdx, factor);
        return { ...o, images: o.images.map((im, i) => (patches[i] ? { ...im, ...patches[i] } : im)) };
      }));
      return;
    }

    // Dragging an ARROW annotation: the whole arrow (both ends follow), or ONE
    // end. Positions are absolute (the snapshot of the ends is kept in the drag
    // state), so a long drag cannot accumulate rounding.
    if (type === 'arrowMove') {
      const st = dragState.current;
      setArrows(prev => prev.map(a => a.id !== id ? a : {
        ...a,
        x1: +(st.a1x + dxMm).toFixed(2), y1: +(st.a1y + dyMm).toFixed(2),
        x2: +(st.a2x + dxMm).toFixed(2), y2: +(st.a2y + dyMm).toFixed(2)
      }));
      return;
    }
    if (type === 'arrowEnd') {
      const st = dragState.current;
      const grabbingStart = st.end === 'start';
      setArrows(prev => prev.map(a => a.id !== id ? a : (grabbingStart
        ? { ...a, x1: +(st.a1x + dxMm).toFixed(2), y1: +(st.a1y + dyMm).toFixed(2) }
        : { ...a, x2: +(st.a2x + dxMm).toFixed(2), y2: +(st.a2y + dyMm).toFixed(2) })));
      return;
    }

    // Dragging the image inside its frame → shift it (mouse pan).
    if (type === 'imgShift') {
      setObjects(prev => prev.map(o => {
        if (o.id !== id) return o;
        // FREE layout: the panel holds a single figure which keeps its own
        // rectangle (it was frozen before) — the pan moves THAT rectangle.
        const imgs = getObjImages(o);
        const r = freeRectOf(imgs[0]);
        if (r && imgs.length === 1) {
          const px = origX + dxMm / Math.max(1e-6, o.w * cellW);
          const py = origY + dyMm / Math.max(1e-6, o.h * cellH);
          return withImages(o, [{
            ...imgs[0],
            rect: {
              ...r,
              x: +Math.max(RECT_MIN - r.w, Math.min(1 - RECT_MIN, px)).toFixed(4),
              y: +Math.max(RECT_MIN - r.h, Math.min(1 - RECT_MIN, py)).toFixed(4)
            }
          }]);
        }
        return { ...o, imgOffsetX: +(origX + dxMm).toFixed(2), imgOffsetY: +(origY + dyMm).toFixed(2) };
      }));
      return;
    }

    // Dragging the image resize handle → resize the image by drag & drop.
    if (type === 'imgResize') {
      setObjects(prev => prev.map(o => {
        if (o.id !== id) return o;
        const imgs = getObjImages(o);
        const r = freeRectOf(imgs[0]);
        if (r && imgs.length === 1) {
          const base = Math.max(2, r.w * o.w * cellW);
          const f = Math.max(0.1, Math.min(6, (base + dxMm) / base));
          return withImages(o, [{
            ...imgs[0],
            rect: {
              ...r,
              w: +Math.max(RECT_MIN, Math.min(RECT_MAX, r.w * f)).toFixed(4),
              h: +Math.max(RECT_MIN, Math.min(RECT_MAX, r.h * f)).toFixed(4)
            }
          }]);
        }
        const baseW = Math.max(1, (o.w * cellW) - (o.imgPadding || 0) * 2);
        const factor = Math.max(0.1, Math.min(5, (baseW + dxMm) / baseW));
        return { ...o, imgScale: +(origScale * factor).toFixed(3) };
      }));
      return;
    }

    // Dragging a free text overlay → move it by millimetres inside the object.
    if (type === 'text') {
      setObjects(prev => prev.map(o => {
        if (o.id !== id || !Array.isArray(o.texts)) return o;
        return { ...o, texts: o.texts.map(tx => tx.id === textId ? { ...tx, x: +(origX + dxMm).toFixed(2), y: +(origY + dyMm).toFixed(2) } : tx) };
      }));
      return;
    }

    const dCols = Math.round(dxMm / cellW);
    const dRows = Math.round(dyMm / cellH);

    // One gesture for the WHOLE selection: the reference (the panel whose frame
    // was grabbed) gives the measure, the others follow — the same offset for a
    // move, its size for a resize. Nobody may leave the grid: the offset is
    // clamped by the most constrained panel of the group, and a panel that the
    // new size would push out is moved back in (see utils/panelSelection). A
    // single selection lands exactly on the old formula.
    const orig = (dragState.current && dragState.current.orig) || { [id]: { x: origX, y: origY, w: origW, h: origH } };
    const patches = type === 'move'
      ? moveSelectionPatches(orig, dCols, dRows, gridCols, gridRows)
      : resizeSelectionPatches(orig, id, resizedBox(orig[id], dCols, dRows, gridCols, gridRows), gridCols, gridRows);
    setObjects(prev => prev.map(o => (patches[o.id] ? { ...o, ...patches[o.id] } : o)));
  };

  const endDrag = () => {
    const st = dragState.current;
    const type = st && st.type;
    const moved = st && st.moved;
    dragState.current = null;
    window.removeEventListener('mousemove', onDrag);
    window.removeEventListener('mouseup', endDrag);
    // A figure drag ends with a click event — that click must NOT cycle the
    // active figure, so remember the drag happened and swallow the next click.
    if (moved && (type === 'figMove' || type === 'figResize')) suppressCycleRef.current = true;
    // Re-order the A/B/C panel letters after an object is moved/resized.
    if (type === 'move' || type === 'resize') renumberLetters();
    // Releasing the mouse APPLIES the crop window that was just drawn.
    if (type === 'crop') {
      setCropDraft(null);
      // The click that follows this release must not deselect the object (the
      // crop commands of the properties panel would vanish mid-work).
      suppressSelectRef.current = true;
      const d = st.draft;
      // `moved` is deliberately NOT required: a draft only exists while the
      // mouse really was dragged, and a zero-size window is refused below.
      if (d && (d.x2 - d.x1) >= CROP_MIN && (d.y2 - d.y1) >= CROP_MIN) {
        applyCropRect(st.id, st.imgIdx, {
          x1: +d.x1.toFixed(4), y1: +d.y1.toFixed(4),
          x2: +d.x2.toFixed(4), y2: +d.y2.toFixed(4)
        });
      }
    }
    // Releasing the mouse DROPS the eraser stroke on every figure it crossed.
    if (type === 'erase') {
      setEraseDraft(null);
      // The click that follows this release must not deselect the panel (the
      // eraser commands would vanish mid-work).
      suppressSelectRef.current = true;
      if (st.stroke && st.stroke.pts.length) applyEraseStroke(st.stroke);
    }
  };

  // Start dragging a free text overlay (millimetre coordinates inside the object).
  const startTextDrag = (e, objId, txId) => {
    e.stopPropagation();
    commitHistory();
    const obj = objects.find(o => o.id === objId);
    const tx = ((obj && obj.texts) || []).find(t => t.id === txId);
    if (!tx) return;
    dragState.current = { type: 'text', id: objId, textId: txId, startX: e.clientX, startY: e.clientY, origX: tx.x, origY: tx.y };
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', endDrag);
  };

  // Start dragging the IMAGE inside its frame (mouse pan).
  const startImageShift = (e, objId) => {
    e.stopPropagation();
    commitHistory();
    const obj = objects.find(o => o.id === objId);
    if (!obj || !obj.imgSrc) return;
    // A single figure that keeps its own rectangle (FREE layout) is panned by
    // its rectangle: same gesture, same numbers.
    const free = getObjImages(obj).length === 1 ? freeRectOf(getObjImages(obj)[0]) : null;
    dragState.current = { type: 'imgShift', id: objId, startX: e.clientX, startY: e.clientY, origX: free ? free.x : (obj.imgOffsetX || 0), origY: free ? free.y : (obj.imgOffsetY || 0) };
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', endDrag);
  };

  // Start dragging the IMAGE RESIZE handle (bottom-right corner of the image).
  const startImageResize = (e, objId) => {
    e.stopPropagation();
    commitHistory();
    const obj = objects.find(o => o.id === objId);
    if (!obj || !obj.imgSrc) return;
    dragState.current = { type: 'imgResize', id: objId, startX: e.clientX, startY: e.clientY, origScale: obj.imgScale || 1 };
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', endDrag);
  };

  // Write / clear a crop window (source units) on ONE figure of an object.
  // `history` is turned OFF for the numeric % fields: every keystroke would
  // otherwise push a snapshot and fill the undo stack.
  const writeCrop = (objId, idx, rect, history = true) => {
    if (idx < 0) return;
    if (history) commitHistory();
    setObjects(prev => prev.map(o => {
      if (o.id !== objId) return o;
      const imgs = getObjImages(o).map((im, i) => (i === idx ? { ...im, crop: rect } : im));
      return withImages(o, imgs);
    }));
  };
  const applyCropRect = (objId, idx, rect) => writeCrop(objId, idx, rect, true);
  const resetCropRect = (objId, idx) => writeCrop(objId, idx, null, true);

  // Turn the crop mode on / off for one figure (the "✂️ Crop" button).
  const toggleCropMode = (objId, idx) => {
    if (idx < 0) return;
    setSelectedId(objId);
    setCropDraft(null);
    setEraseMode(false);   // the two drawing tools never fight for the mouse
    setEraseCursor(null);
    setCropMode(prev => (prev && prev.objId === objId && prev.idx === idx ? null : { objId, idx }));
  };

  // Arm / disarm the ERASER. It works on the whole canvas (a rubber takes off
  // what is under it, whatever panel that is), so it only needs a selection to
  // have something to work on — and the properties panel shows its brush size.
  const toggleEraseMode = () => {
    setEraseMode(v => {
      if (!v) { setCropMode(null); setCropDraft(null); }
      else setEraseCursor(null);
      return !v;
    });
  };

  // Start a gomme stroke at the pointer (canvas mm). The stroke grows with
  // `pushStrokePoint` while the mouse moves; releasing it writes it on the
  // figures (see applyEraseStroke).
  const startEraseDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const pt = mmAtPointer(e.clientX, e.clientY);
    if (!pt) return;
    commitHistory();
    const stroke = { sizeMm: clampEraseSize(eraseSize), pts: [[+pt.x.toFixed(3), +pt.y.toFixed(3)]] };
    dragState.current = { type: 'erase', stroke };
    setEraseDraft(stroke);
    setEraseCursor(pt);
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', endDrag);
  };

  // One edge of the numeric crop fields (value in % of the original image).
  const setCropEdge = (objId, idx, edge, pct) => {
    const obj = objects.find(o => o.id === objId);
    const cur = cropOf(obj && getObjImages(obj)[idx]) || { x1: 0, y1: 0, x2: 1, y2: 1 };
    const v = Math.max(0, Math.min(100, Number(pct) || 0)) / 100;
    const next = { ...cur, [edge]: v };
    if (edge === 'x1') next.x1 = Math.min(v, next.x2 - CROP_MIN);
    if (edge === 'y1') next.y1 = Math.min(v, next.y2 - CROP_MIN);
    if (edge === 'x2') next.x2 = Math.max(v, next.x1 + CROP_MIN);
    if (edge === 'y2') next.y2 = Math.max(v, next.y1 + CROP_MIN);
    writeCrop(objId, idx, {
      x1: +next.x1.toFixed(4), y1: +next.y1.toFixed(4),
      x2: +next.x2.toFixed(4), y2: +next.y2.toFixed(4)
    }, false);
  };

  // Start a crop window on the figure being cropped (drag on the canvas).
  const startCropDrag = (e, objId, idx) => {
    e.preventDefault();
    e.stopPropagation();
    const obj = objects.find(o => o.id === objId);
    if (!obj) return;
    // `idx` normally is the active figure; falling back to it keeps the command
    // working when the caller could not resolve one (single-figure panels).
    const figIdx = idx >= 0 ? idx : activeFigIdx(obj);
    const im = figIdx >= 0 ? getObjImages(obj)[figIdx] : null;
    if (!im) return;
    const svgEl = activeSvgEl();
    if (!svgEl) return;
    const r = svgEl.getBoundingClientRect();
    const geom = objFigureGeom(obj, figIdx);
    const toSrc = (clientX, clientY) => ({
      x: Math.max(0, Math.min(1, ((clientX - r.left) * (canvasW / Math.max(1, r.width)) - geom.iX) / Math.max(1e-6, geom.iW))),
      y: Math.max(0, Math.min(1, ((clientY - r.top) * (canvasH / Math.max(1, r.height)) - geom.iY) / Math.max(1e-6, geom.iH)))
    });
    const start = toSrc(e.clientX, e.clientY);
    const base = cropOf(im) || { x1: 0, y1: 0, x2: 1, y2: 1 };
    const from = {
      x: Math.min(Math.max(start.x, base.x1), base.x2),
      y: Math.min(Math.max(start.y, base.y1), base.y2)
    };
    const draft = { x1: from.x, y1: from.y, x2: from.x, y2: from.y };
    setActiveFig({ objId, idx: figIdx });
    dragState.current = { type: 'crop', id: objId, imgIdx: figIdx, geom, base, from, draft };
    setCropDraft(draft);
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', endDrag);
  };

  // Move ONE figure of a multi-figure object independently (drag the figure) —
  // or the whole ticked group when the figure held is the reference.
  const startFigureDrag = (e, objId, imgIdx) => {
    e.stopPropagation();
    commitHistory();
    const obj = objects.find(o => o.id === objId);
    const im = obj && getObjImages(obj)[imgIdx];
    if (!im) return;
    const free = freeRectOf(im);
    dragState.current = {
      type: 'figMove', id: objId, imgIdx, startX: e.clientX, startY: e.clientY,
      origX: free ? free.x : (im.dx || 0), origY: free ? free.y : (im.dy || 0),
      figs: figureSnapshot(obj, imgIdx)
    };
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', endDrag);
  };

  // Resize ONE figure of a multi-figure object (drag its corner handle) — or the
  // whole ticked group, whose figures then take ITS size.
  const startFigureResize = (e, objId, imgIdx) => {
    e.stopPropagation();
    commitHistory();
    const obj = objects.find(o => o.id === objId);
    const im = obj && getObjImages(obj)[imgIdx];
    if (!im) return;
    dragState.current = {
      type: 'figResize', id: objId, imgIdx, startX: e.clientX, startY: e.clientY,
      origScale: im.scale || 1,
      figs: figureSnapshot(obj, imgIdx)
    };
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', endDrag);
  };

  // ---- free text overlays --------------------------------------------------
  // Add a text at a given position (mm inside the object) — used by the
  // "+ Add Text" button (centre) and by "Place by click" (mouse position).
  const addTextAt = (obj, xMm, yMm) => {
    commitHistory();
    const id = `txt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const tx = {
      id,
      x: +Math.max(1, Math.min((obj.w * cellW) - 1, xMm)).toFixed(1),
      y: +Math.max(4, Math.min((obj.h * cellH) - 4, yMm)).toFixed(1),
      text: 'Text', fontSize: 12, color: '#000000', bold: false, italic: false
    };
    setObjects(prev => prev.map(o => o.id === obj.id ? { ...o, texts: [...(o.texts || []), tx] } : o));
    setPlaceTextMode(false);
    // Start typing directly on the canvas at the placed position.
    setEditingText({ objId: obj.id, txId: id, mmX: obj.x * cellW + tx.x, mmY: obj.y * cellH + tx.y, value: tx.text });
  };
  const setTextValue = (objId, txId, value) => {
    setObjects(prev => prev.map(o => o.id === objId ? { ...o, texts: (o.texts || []).map(t => t.id === txId ? { ...t, text: value } : t) } : o));
    setEditingText(prev => (prev && prev.txId === txId ? { ...prev, value } : prev));
  };
  const stopEditing = () => setEditingText(null);
  const addText = () => {
    if (!selectedId) return;
    const obj = objects.find(o => o.id === selectedId);
    if (!obj) return;
    addTextAt(obj, (obj.w * cellW) / 2, (obj.h * cellH) / 2);
  };
  const updateText = (txId, patch) => {
    const obj = objects.find(o => o.id === selectedId);
    if (!obj) return;
    updateObj({ texts: (obj.texts || []).map(tx => tx.id === txId ? { ...tx, ...patch } : tx) });
  };
  const deleteText = (txId) => {
    const obj = objects.find(o => o.id === selectedId);
    if (!obj) return;
    commitHistory();
    updateObj({ texts: (obj.texts || []).filter(tx => tx.id !== txId) });
  };

  // ---- ARROW ANNOTATIONS ---------------------------------------------------
  // One arrow = two ends in mm + how it is drawn (straight / curved, one head /
  // double). The geometry lives in utils/figureArrows (arrowGeometry) so the
  // canvas, the export and the tests all draw the same thing. An arrow is
  // canvas-level: "+ Add arrow" drops a default one across the middle of the
  // canvas, selected, and the user drags it / its end handles.
  const addArrow = () => {
    commitHistory();
    const id = `arr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const a = newArrow(id, {
      x1: +(canvasW * 0.4).toFixed(1), y1: +(canvasH * 0.5).toFixed(1),
      x2: +(canvasW * 0.62).toFixed(1), y2: +(canvasH * 0.5).toFixed(1)
    });
    setArrows(prev => [...prev, a]);
    // One selection at a time: the arrow panel replaces the panel properties.
    setSelectedId(null);
    setSelectedArrowId(id);
  };
  const updateArrow = (patch) => setArrows(prev => prev.map(a => a.id === selectedArrowId ? { ...a, ...patch } : a));
  const removeArrow = (id = selectedArrowId) => {
    if (!id) return;
    commitHistory();
    setArrows(prev => prev.filter(a => a.id !== id));
    setSelectedArrowId(null);
  };
  // "Shadow every panel" (toolbar + properties panel): ONE click gives the whole
  // figure the publication drop shadow, a second click takes it off again.
  const panelsShadowed = (objects || []).some((o) => !!shadowSpec(o && o.shadow));
  const togglePanelsShadow = () => {
    if (!(objects || []).length) return;
    commitHistory();
    const on = !panelsShadowed;
    setObjects(prev => prev.map(o => ({ ...o, shadow: on ? { ...DEFAULT_SHADOW } : null })));
  };
  // Drag an arrow (no `end`) or ONE of its ends ('start' | 'end').
  const startArrowDrag = (e, id, end = null) => {
    e.stopPropagation();
    commitHistory();
    const a = (arrows || []).find(x => x.id === id);
    if (!a) return;
    setSelectedId(null);
    setSelectedArrowId(id);
    dragState.current = end
      ? { type: 'arrowEnd', id, end, startX: e.clientX, startY: e.clientY, a1x: a.x1, a1y: a.y1, a2x: a.x2, a2y: a.y2 }
      : { type: 'arrowMove', id, startX: e.clientX, startY: e.clientY, a1x: a.x1, a1y: a.y1, a2x: a.x2, a2y: a.y2 };
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', endDrag);
  };

  // ---- zoom fullscreen onto the selected object ----------------------------
  const zoomToObject = (id) => {
    if (!objects.some(o => o.id === id)) return;
    setSelectedId(id);
    setFocusObjId(id);
    setZoom(1.5);
    setIsFullScreen(true);
  };

  // ── FULLSCREEN VIEWPORT: SCROLL, not a transform ──────────────────────────
  // The canvas is drawn at `zoom` inside a "sizer" box that really IS
  // (canvas × zoom) big (see the fullscreen markup below). A CSS transform does
  // not change the layout, so the old `translate(...) scale(...)` version left
  // nothing to scroll: zooming on one element trapped the view on a fragment of
  // the figure, with only the arrow buttons to move. With the sizer the browser
  // draws its own scrollbars and the wheel / trackpad / bars all work.
  const SCROLL_PAD = 32;                       // p-8 of the fullscreen area (px)
  const scrollAreaTo = (x, y) => {
    const area = fsAreaRef.current;
    if (!area) return;
    area.scrollLeft = Math.max(0, Number(x) || 0);
    area.scrollTop = Math.max(0, Number(y) || 0);
  };
  const nudgeArea = (dx, dy) => {
    const area = fsAreaRef.current;
    if (!area) return;
    area.scrollLeft = Math.max(0, area.scrollLeft + dx);
    area.scrollTop = Math.max(0, area.scrollTop + dy);
  };
  // Put the point (xMm, yMm) of the canvas in the MIDDLE of the viewport. The
  // scaled box only exists after React re-renders, so the scroll is reapplied on
  // the next frame (scrollHeight of a too-small box clamps the first attempt).
  const centerOnMm = (xMm, yMm, z) => {
    const area = fsAreaRef.current;
    if (!area) return;
    const run = () => scrollAreaTo(
      xMm * PX_PER_MM * z + SCROLL_PAD - area.clientWidth / 2,
      yMm * PX_PER_MM * z + SCROLL_PAD - area.clientHeight / 2
    );
    run();
    // The scaled box only exists once React has committed the new zoom, and
    // scrollHeight of the still-small box clamps the first attempt: retry on the
    // next frame (twice — the second frame also covers a scrollbar appearing).
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => { run(); requestAnimationFrame(run); });
    }
  };

  // Zoom change that keeps the point at the centre of the viewport where it is
  // (a plain setZoom would jump to another corner of a big canvas).
  const setZoomKeepingCenter = (nextZ) => {
    const area = fsAreaRef.current;
    const z = Number(nextZ);
    if (!area || !Number.isFinite(z) || z <= 0) { setZoom(z); return; }
    const prev = Number(zoom) || z;
    setZoom(z);
    if (prev === z) return;
    const factor = z / prev;
    const cx = (area.scrollLeft + area.clientWidth / 2 - SCROLL_PAD) * factor + SCROLL_PAD;
    const cy = (area.scrollTop + area.clientHeight / 2 - SCROLL_PAD) * factor + SCROLL_PAD;
    const run = () => scrollAreaTo(cx - area.clientWidth / 2, cy - area.clientHeight / 2);
    run();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  };

  // Centre the focused object in the fullscreen canvas area (measured live so
  // it fits any screen size).
  const recenterFocus = () => {
    const area = fsAreaRef.current;
    if (!area || !focusObjId) return;
    const obj = objects.find(o => o.id === focusObjId);
    if (!obj) return;
    const aw = Math.max(120, area.clientWidth - 64); // p-8 padding
    const ah = Math.max(120, area.clientHeight - 64);
    const oxMm = obj.x * cellW, oyMm = obj.y * cellH;
    const owMm = Math.max(12, obj.w * cellW), ohMm = Math.max(12, obj.h * cellH);
    // The canvas is styled in CSS millimetres (≈3.78 px/mm): convert the object
    // size to pixels so the WHOLE object fits the viewport (with a small margin)
    // instead of being over-zoomed to a fragment of it. The rest of the canvas
    // stays reachable: the viewport scrolls.
    const owPx = owMm * PX_PER_MM, ohPx = ohMm * PX_PER_MM;
    const scale = Math.max(0.05, Math.min((aw - 24) / owPx, (ah - 24) / ohPx));
    // The object-fit view is the "initial" view of this fullscreen session.
    initialZoomRef.current = scale;
    setZoom(scale);
    centerOnMm(oxMm + owMm / 2, oyMm + ohMm / 2, scale);
  };

  // Centre the whole canvas in the fullscreen viewport (no focused object).
  const centerCanvasAt = (z) => centerOnMm(canvasW / 2, (canvasH + captionH) / 2, z);
  const centerCanvas = () => centerCanvasAt(zoom);

  // Restore the zoom (and centring) that was active when fullscreen was entered.
  const restoreInitialZoom = () => {
    const z = initialZoomRef.current;
    setZoom(z);
    if (focusObjId) {
      const obj = objects.find(o => o.id === focusObjId);
      if (obj) centerOnMm(obj.x * cellW + (obj.w * cellW) / 2, obj.y * cellH + (obj.h * cellH) / 2, z);
      return;
    }
    centerCanvasAt(z);
  };

  useEffect(() => {
    if (!isFullScreen) return;
    if (focusObjId) recenterFocus();
    else centerCanvas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullScreen, focusObjId]);

  // Render the composition (without selection UI) to a PNG data URL.
  // Rasterizes any SVG image source to PNG first so the composite SVG loads
  // reliably as an image (SVG-inside-SVG often refuses to rasterize).
  // NOTE: screen-only decoration (the blue selected-panel square, the resize
  // handles, the active figure's dashed outline) MUST carry
  // data-selection-ui="true" to be dropped from the clone below — anything else
  // drawn in renderSvg also ends up in Export PNG, "Save canvas" and
  // "Insert into project".
  const renderToDataUrl = (outScale = 11.8) => new Promise((resolve) => {
    const svgEl = activeSvgEl();
    if (!svgEl) { resolve(null); return; }
    const clone = svgEl.cloneNode(true);
    clone.querySelectorAll('[data-selection-ui="true"]').forEach(el => el.remove());

    const toPng = (src) => new Promise((res) => {
      if (!src || !String(src).startsWith('data:image/svg+xml')) { res(src); return; }
      const im = new Image();
      const done = (v) => { clearTimeout(t); res(v); };
      const t = setTimeout(() => done(src), 1500);
      im.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = im.naturalWidth || 800;
          c.height = im.naturalHeight || 600;
          c.getContext('2d').drawImage(im, 0, 0);
          done(c.toDataURL('image/png'));
        } catch { done(src); }
      };
      im.onerror = () => done(src);
      im.src = src;
    });

    const finish = (svgData) => {
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(canvasW * outScale);
          canvas.height = Math.round((canvasH + captionH) * outScale);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL('image/png'));
        } catch (err) { URL.revokeObjectURL(url); console.warn('Composition render failed:', err && err.message); resolve(null); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    };

    const images = Array.from(clone.querySelectorAll('image'));
    const tasks = images.map((im) => {
      const src = im.getAttribute('href') || im.getAttribute('xlink:href');
      return toPng(src).then((png) => { im.setAttribute('href', png); im.removeAttribute('xlink:href'); });
    });
    Promise.all(tasks).then(() => finish(new XMLSerializer().serializeToString(clone)));
  });

  // Export to 300 DPI PNG
  const exportPng = async () => {
    const dataUrl = await renderToDataUrl(11.8);
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `figure_${Date.now()}.png`;
    a.click();
  };

  const selectedObj = objects.find(o => o.id === selectedId);
  // The size every panel letter is drawn at — the value shown by the letter-size
  // controls of the toolbar and of "Labels & Captions" (see setLetterSizeAll).
  const letterPt = currentLetterPt();
  void libVersion; // re-read the library lists on every transfer (the bump triggers a re-render)
  // The Project tab only ever lists libraries of the projects this user may open
  // (readVisibleProjectLibrary returns [] otherwise: the entries are not ours to
  // show, and they are left untouched).
  const libraryItems = libraryTab === 'project'
    ? readVisibleProjectLibrary(activeLibProjectId, myProjectIds)
    : readLibrary();
  const libProjectBlocked = libraryTab === 'project' && !!activeLibProjectId && !canSeeLibProject(activeLibProjectId);

  // Helper to render the SVG content (shared between normal and fullscreen)
  const renderSvg = (svgElRef, svgId = 'in') => (
    <svg ref={svgElRef} viewBox={`0 0 ${canvasW} ${canvasH + captionH}`} width="100%" height="100%" onClick={(e) => {
      e.stopPropagation();
      // The click that follows a crop drag must not deselect the panel (the crop
      // commands of the properties panel would disappear while cropping).
      if (suppressSelectRef.current) { suppressSelectRef.current = false; return; }
      setSelectedId(null);
      setSelectedArrowId(null);
    }}>
      {/* Grid lines (the cell divider guides between the panels) — switched off
          with the "Grid lines" checkbox, on the canvas and in every export. */}
      {Array.from({ length: showGridLines ? gridCols - 1 : 0 }).map((_, i) => (
        <line key={`v${i}`} x1={(i + 1) * cellW} y1={0} x2={(i + 1) * cellW} y2={canvasH} stroke="#e2e8f0" strokeWidth={0.2} />
      ))}
      {Array.from({ length: showGridLines ? gridRows - 1 : 0 }).map((_, i) => (
        <line key={`h${i}`} x1={0} y1={(i + 1) * cellH} x2={canvasW} y2={(i + 1) * cellH} stroke="#e2e8f0" strokeWidth={0.2} />
      ))}

      {/* Objects */}
      <defs>
        {objects.map(obj => (
          <clipPath key={`cp-${obj.id}`} id={`clip-${obj.id}`}>
            <rect x={obj.x * cellW} y={obj.y * cellH} width={obj.w * cellW} height={obj.h * cellH} />
          </clipPath>
        ))}
        {/* Crop windows: one clip per CROPPED figure (the full image is drawn
            around the window and clipped to it — see objFigureGeom). */}
        {objects.map(obj => getObjImages(obj).map((im, i) => {
          const g = objFigureGeom(obj, i);
          if (!g.crop) return null;
          return (
            <clipPath key={`fcp-${obj.id}-${i}`} id={`figclip-${obj.id}-${i}`}>
              <rect x={g.vX} y={g.vY} width={g.vW} height={g.vH} />
            </clipPath>
          );
        }))}
        {/* ERASE masks (the 🧽 eraser) — one per figure that carries gomme
            strokes, or that is being erased right now. White keeps the pixel,
            black removes it: the hole is TRANSPARENT everywhere, at screen
            resolution as well as at 300 DPI, because the mask is part of the
            composition. `svgId` keeps the two SVGs of the screen (normal view
            and fullscreen are mounted together) from sharing an id. */}
        {objects.map(obj => getObjImages(obj).map((im, i) => {
          const g = objFigureGeom(obj, i);
          const painted = maskStrokesMm(eraseStrokesFor(obj, i), g);
          if (!painted.length) return null;
          return (
            <mask key={`fem-${obj.id}-${i}`} id={eraseMaskId(svgId, obj.id, i)} maskUnits="userSpaceOnUse"
              x={g.iX} y={g.iY} width={g.iW} height={g.iH}>
              <rect x={g.iX} y={g.iY} width={g.iW} height={g.iH} fill="#ffffff" />
              {painted.map((st, k) => (
                <path key={`p${k}`} d={st.d} stroke="#000000" strokeWidth={st.w} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              ))}
            </mask>
          );
        }))}
        {/* SHADOW filters — one <feDropShadow> per shadowed PANEL and per
            shadowed ARROW, referenced from its group with filter="url(#…)".
            The filter lives in the composition itself, so Export PNG, Save
            canvas and Insert into project keep the shadow (they rasterize this
            very SVG); the region is widened so a large offset / blur is not
            clipped. Offsets and blur are in millimetres (userSpaceOnUse). */}
        {objects.map(obj => {
          const sp = shadowSpec(obj.shadow);
          if (!sp) return null;
          return (
            <filter key={`fsp-${obj.id}`} id={shadowFilterId(obj.id)} x="-25%" y="-25%" width="150%" height="150%">
              <feDropShadow dx={sp.dx} dy={sp.dy} stdDeviation={sp.blur} floodColor={sp.color} floodOpacity={sp.opacity} />
            </filter>
          );
        })}
        {arrows.map(a => {
          const sp = shadowSpec(a.shadow);
          if (!sp) return null;
          return (
            <filter key={`fsa-${a.id}`} id={shadowFilterId(a.id)} x="-25%" y="-25%" width="150%" height="150%">
              <feDropShadow dx={sp.dx} dy={sp.dy} stdDeviation={sp.blur} floodColor={sp.color} floodOpacity={sp.opacity} />
            </filter>
          );
        })}
        {/* …and one per SHADOWED FIGURE of a panel (`obj.images[i].shadow`) —
            the shadow asked for the picture ITSELF, not its frame: the filter is
            applied to a group WRAPPING the <image> (see the figure layer below),
            so <feDropShadow> works from the pixels of the figure — its own
            alpha — and not from a bounding box. A PNG screenshot of a molecule
            on a transparent background therefore gets a shadow around the
            molecule, and the parts taken off with the 🧽 eraser (whose mask is
            applied INSIDE the group) cast no shadow at all. A JPEG — a picture
            with an opaque background — can only cast the shadow of its
            rectangle: no filter can invent a transparency the file has not. */}
        {objects.map(obj => getObjImages(obj).map((im, i) => {
          const sp = shadowSpec(im.shadow);
          if (!sp) return null;
          return (
            <filter key={`fsf-${obj.id}-${i}`} id={figureShadowFilterId(obj.id, i)} x="-25%" y="-25%" width="150%" height="150%">
              <feDropShadow dx={sp.dx} dy={sp.dy} stdDeviation={sp.blur} floodColor={sp.color} floodOpacity={sp.opacity} />
            </filter>
          );
        }))}
      </defs>
      {objects.map(obj => {
        const isSelected = obj.id === selectedId;      // THE REFERENCE: properties, handles, crop, texts
        const selRank = selectedIds.indexOf(obj.id);   // 0 = the FIRST selected (the reference)
        const inSelection = selRank >= 0;              // any panel of the (multi-)selection
        // Crop mode belongs to ONE object: the dimmed window + the drag catcher
        // below are drawn only for that one.
        const cropOn = !!cropMode && cropMode.objId === obj.id;
        const ox = obj.x * cellW;
        const oy = obj.y * cellH;
        const ow = obj.w * cellW;
        const oh = obj.h * cellH;
        // Drop shadow of THIS panel (null when the panel has none) — the whole
        // panel group below is wrapped in the filter when it is set.
        const panelShadow = shadowSpec(obj.shadow);

        return (
          <g key={obj.id} onClick={(e) => {
            e.stopPropagation();
            setSelectedArrowId(null);   // one selection at a time (arrow ↔ panel)
            // MULTI-SELECTION: Ctrl/Cmd + click (or a chip of the “Panels” strip
            // of the properties panel) ADDS / REMOVES this panel — the FIRST
            // selected stays the reference, so resizing it gives the others its
            // size. A plain click keeps meaning “this panel, and only this one”.
            if (e.ctrlKey || e.metaKey) toggleSelectedId(obj.id); else setSelectedId(obj.id);
            // Selecting another object resets the active (draggable) figure.
            setActiveFig(prev => (prev && prev.objId === obj.id) ? prev : null);
            // "Place by click": add a text exactly where the user clicked.
            if (placeTextMode && activeSvgEl()) {
              const r = activeSvgEl().getBoundingClientRect();
              const xMm = (e.clientX - r.left) * (canvasW / r.width) - ox;
              const yMm = (e.clientY - r.top) * (canvasH / r.height) - oy;
              addTextAt(obj, xMm, yMm);
            }
          }}>
            {/* Panel frame + figure + letter + texts, wrapped in the panel's
                drop shadow when it has one (screen AND export: the filter is
                part of the composition, only the selection UI below is
                screen-only). */}
            <g filter={panelShadow ? `url(#${shadowFilterId(obj.id)})` : undefined}>
            {/* Panel frame. Its styling must NOT depend on the selection: the
                exported PNG (Export PNG / Save canvas / Insert into project)
                rasterizes this very SVG and only strips the elements tagged
                `data-selection-ui`, so the blue "selected panel" square lives in
                its own overlay rect further down (screen only). */}
            <rect x={ox} y={oy} width={ow} height={oh} fill="white" stroke={showPanelBorders ? '#cbd5e1' : 'none'} strokeWidth={0.2} onMouseDown={(e) => startDrag(e, obj.id)} style={{ cursor: 'move' }} />

            {(() => {
              // Multi-figure object: every figure in `images[]` is laid out in a
              // grid (cols = obj.imgCols) inside the same lettered panel. A
              // single-figure object renders exactly as before.
              const imgs = getObjImages(obj);
              if (!imgs.length) return null;
              const single = imgs.length === 1;
              const fit = obj.imgFit;
              const rot = obj.imgRotate || 0;
              // The figure that owns the drag/resize handles (multi-figure: the
              // active one, defaulting to the topmost).
              const activeIdx = single ? 0
                : (activeFig && activeFig.objId === obj.id && activeFig.idx >= 0 && activeFig.idx < imgs.length
                  ? activeFig.idx : imgs.length - 1);
              const activeGeom = objFigureGeom(obj, activeIdx);
              return (
                <g clipPath={`url(#clip-${obj.id})`}>
                  {imgs.map((im, i) => {
                    const src = im.imgSrc;
                    if (!src) return null;
                    const g = objFigureGeom(obj, i);
                    // The 🧽 eraser mask of THIS figure (undefined when nothing
                    // was erased: the image is then drawn exactly as before).
                    const eraseMask = eraseStrokesFor(obj, i).length ? `url(#${eraseMaskId(svgId, obj.id, i)})` : undefined;
                    const par = keepAspect ? 'xMidYMid meet' : fit === 'cover' ? 'xMidYMid slice' : fit === 'stretch' ? 'none' : 'xMidYMid meet';
                    const center = `${g.iX + g.iW / 2} ${g.iY + g.iH / 2}`;
                    /* The shadow OF THIS FIGURE (null when it has none): the
                       filter goes on a group WRAPPING the image, never on the
                       image itself, so that
                         • the shadow follows the PIXELS of the picture (its own
                           transparent background) instead of a bounding box;
                         • the 🧽 eraser mask — a property of the image — is
                           applied BEFORE the filter, so what was erased casts
                           no shadow;
                         • the rotation of the figure stays on the image, so
                           dx/dy keep pointing down-right on the CANVAS and are
                           not turned with the picture. */
                    const figShadow = shadowSpec(im.shadow);
                    /* CROPPED figure: the FULL image is drawn around the window
                       with an exact pixel mapping (hence preserveAspectRatio
                       "none") and clipped to it. The rotation wraps both so the
                       clip rotates with the figure, like the uncropped image. */
                    if (g.crop) {
                      return (
                        <g key={im.libId || i} filter={figShadow ? `url(#${figureShadowFilterId(obj.id, i)})` : undefined}>
                          <g transform={rot ? `rotate(${rot} ${center})` : undefined}>
                            <image href={src}
                              x={g.iX} y={g.iY} width={g.iW} height={g.iH}
                              preserveAspectRatio="none"
                              clipPath={`url(#figclip-${obj.id}-${i})`}
                              mask={eraseMask}
                              style={{ pointerEvents: 'none' }}
                            />
                          </g>
                        </g>
                      );
                    }
                    return (
                      <g key={im.libId || i} filter={figShadow ? `url(#${figureShadowFilterId(obj.id, i)})` : undefined}>
                        <image href={src}
                          x={g.iX} y={g.iY} width={g.iW} height={g.iH}
                          transform={rot ? `rotate(${rot} ${center})` : undefined}
                          preserveAspectRatio={par}
                          mask={eraseMask}
                          style={{ pointerEvents: 'none' }}
                        />
                      </g>
                    );
                  })}
                  {/* Single figure: classic shift + small resize handle. */}
                  {isSelected && single && (
                    <g data-selection-ui="true">
                      <rect x={Math.max(ox, activeGeom.iX)} y={Math.max(oy, activeGeom.iY)} width={Math.min(ow, activeGeom.iW)} height={Math.min(oh, activeGeom.iH)} fill="transparent"
                        style={{ cursor: 'move' }} onMouseDown={(e) => startImageShift(e, obj.id)}
                        title="Drag to shift the image inside the frame (or hold Shift while dragging anywhere on the object)" />
                      <rect x={Math.max(ox, activeGeom.iX) + Math.min(ow, activeGeom.iW) - 3} y={Math.max(oy, activeGeom.iY) + Math.min(oh, activeGeom.iH) - 3} width={3} height={3} fill="#3b82f6"
                        style={{ cursor: 'nwse-resize' }} onMouseDown={(e) => startImageResize(e, obj.id)}
                        title="Drag to resize the image" />
                    </g>
                  )}
                  {/* Multi-figure: a clickable zone for EVERY figure (click picks
                      it / cycles through overlapping figures) + the ACTIVE figure's
                      move/resize handles rendered ON TOP so they are always
                      grabbable even in overlap regions. */}
                  {isSelected && !single && imgs.map((im, i) => {
                    if (!im.imgSrc) return null;
                    const g = objFigureGeom(obj, i);
                    return (
                      <g key={`fsel${i}`}>
                        <rect data-selection-ui="true" x={g.iX} y={g.iY} width={g.iW} height={g.iH} fill="transparent"
                          style={{ cursor: 'pointer' }}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); setSelectedId(obj.id); cycleFigureAt(obj, e); }}
                          title="Click to select this figure — click an overlapping spot again to cycle to the figure underneath" />
                        {i === activeIdx && (
                          <g>
                            <rect data-selection-ui="true" x={g.iX} y={g.iY} width={g.iW} height={g.iH} fill="transparent" stroke="#3b82f6" strokeWidth={0.2} strokeDasharray="1.4,1.4"
                              style={{ cursor: 'move' }} onMouseDown={(e) => startFigureDrag(e, obj.id, i)}
                              onClick={(e) => { e.stopPropagation(); setSelectedId(obj.id); if (!suppressCycleRef.current) cycleFigureAt(obj, e); else suppressCycleRef.current = false; }}
                              title="Drag to move this figure within the panel" />
                            <rect data-selection-ui="true" x={g.iX + g.iW - 3} y={g.iY + g.iH - 3} width={3} height={3} fill="#3b82f6"
                              style={{ cursor: 'nwse-resize' }} onMouseDown={(e) => startFigureResize(e, obj.id, i)}
                              onClick={(e) => e.stopPropagation()}
                              title="Drag to resize this figure" />
                          </g>
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })()}

            {obj.letter && (
              <text x={ox + 1.5} y={oy + ptToMm(obj.letterStyle.fontSize) + 1} fontSize={ptToMm(obj.letterStyle.fontSize)} fill={obj.letterStyle.color} fontWeight={obj.letterStyle.bold ? 'bold' : 'normal'} style={{ pointerEvents: 'none' }}>
                {obj.letter}
              </text>
            )}

            {/* The panel sub-caption is deliberately NOT drawn inside the panel:
                it is only merged into the figure caption at the bottom of the
                canvas (see `autoGlobalCaption`), so it never shows up in the
                composition, in Export PNG or in Insert into project. It stays
                editable in the properties panel and in the floating caption
                editor ("✎ Edit in place"). */}

            {/* Free text overlays — draggable anywhere inside the object; double-click to edit in place */}
            {(obj.texts || []).map(tx => {
              const isEditing = editingText && editingText.txId === tx.id;
              return (
                <text
                  key={tx.id}
                  x={ox + tx.x}
                  y={oy + tx.y}
                  fontSize={ptToMm(tx.fontSize || 12)}
                  fill={tx.color || '#000000'}
                  fontWeight={tx.bold ? 'bold' : 'normal'}
                  fontStyle={tx.italic ? 'italic' : 'normal'}
                  opacity={isEditing ? 0 : 1}
                  style={{ pointerEvents: isSelected ? 'auto' : 'none', cursor: isSelected ? 'move' : 'default' }}
                  onMouseDown={isSelected && !isEditing ? (e) => startTextDrag(e, obj.id, tx.id) : undefined}
                  onDoubleClick={isSelected ? () => setEditingText({ objId: obj.id, txId: tx.id, mmX: obj.x * cellW + tx.x, mmY: obj.y * cellH + tx.y, value: tx.text }) : undefined}
                >{tx.text}</text>
              );
            })}
            </g>
            {/* — end of the shadowed panel content — */}

            {isSelected && (
              <rect data-selection-ui="true" x={ox + ow - 2} y={oy + oh - 2} width={2} height={2} fill="#3b82f6" style={{ cursor: 'nwse-resize' }} onMouseDown={(e) => startResize(e, obj.id)} />
            )}

            {/* Blue square marking the selected panel — screen only: it carries
                data-selection-ui, so renderToDataUrl drops it from Export PNG,
                "Save canvas" and "Insert into project". Drawn last (on top of the
                figure) and transparent to the mouse, so the panel frame below
                keeps receiving the drag. EVERY selected panel gets one: solid
                blue for the REFERENCE (the first selected — the one whose size
                the others take), dashed indigo for the ones that follow it. */}
            {inSelection && (
              <rect data-selection-ui="true" x={ox} y={oy} width={ow} height={oh} fill="none"
                stroke={isSelected ? '#3b82f6' : '#6366f1'} strokeWidth={isSelected ? 0.5 : 0.35}
                strokeDasharray={isSelected ? undefined : '1.6,1.2'} style={{ pointerEvents: 'none' }} />
            )}
            {/* Rank in the selection (screen only): the FIRST selected panel is
                the reference — it is whose size is written on the others. */}
            {inSelection && selectedIds.length > 1 && (
              <text data-selection-ui="true" x={ox + ow - 1.2} y={oy + 3} fontSize={2.6} textAnchor="end"
                fill={isSelected ? '#1d4ed8' : '#4f46e5'} fontWeight="bold" style={{ pointerEvents: 'none' }}>
                {selRank === 0 ? '🎯 1st' : ordinalOf(selRank)}
              </text>
            )}

            {/* CROP (screen only): the dimmed bands show what the crop removes,
                the dashed rectangle is the window being drawn. Everything is
                tagged data-selection-ui, so exports never contain it. */}
            {isSelected && cropOn && (() => {
              const idx = activeFigIdx(obj);
              const g = idx < 0 ? null : objFigureGeom(obj, idx);
              const imgs = getObjImages(obj);
              if (!g || !imgs[idx]) return null;
              const d = cropDraft || cropOf(imgs[idx]) || { x1: 0, y1: 0, x2: 1, y2: 1 };
              const x1 = g.iX + d.x1 * g.iW;
              const x2 = g.iX + d.x2 * g.iW;
              const y1 = g.iY + d.y1 * g.iH;
              const y2 = g.iY + d.y2 * g.iH;
              const dim = 'rgba(15,23,42,0.5)';
              return (
                <g data-selection-ui="true" clipPath={`url(#clip-${obj.id})`} style={{ pointerEvents: 'none' }}>
                  <rect x={g.iX} y={g.iY} width={Math.max(0, x1 - g.iX)} height={g.iH} fill={dim} />
                  <rect x={x2} y={g.iY} width={Math.max(0, g.iX + g.iW - x2)} height={g.iH} fill={dim} />
                  <rect x={x1} y={g.iY} width={Math.max(0, x2 - x1)} height={Math.max(0, y1 - g.iY)} fill={dim} />
                  <rect x={x1} y={y2} width={Math.max(0, x2 - x1)} height={Math.max(0, g.iY + g.iH - y2)} fill={dim} />
                  <rect x={x1} y={y1} width={Math.max(0, x2 - x1)} height={Math.max(0, y2 - y1)} fill="none"
                    stroke="#f59e0b" strokeWidth={0.4} strokeDasharray="1.4,1.2" />
                  <text x={x1 + 1} y={Math.max(y1 - 1, g.iY + 3)} fontSize={3} fill="#b45309" fontWeight="bold">
                    ✂ {Math.round(d.x1 * 100)}–{Math.round(d.x2 * 100)} % × {Math.round(d.y1 * 100)}–{Math.round(d.y2 * 100)} %
                  </text>
                </g>
              );
            })()}
            {/* Transparent catcher that turns a drag into the crop window. */}
            {isSelected && cropOn && (
              <rect data-selection-ui="true" x={ox} y={oy} width={ow} height={oh} fill="transparent"
                style={{ cursor: 'crosshair' }}
                onMouseDown={(e) => startCropDrag(e, obj.id, activeFigIdx(obj))}
                title="Drag to set the crop window — releasing the mouse applies it" />
            )}

            {/* Link back to the original graph lives in the properties panel
                ("↗ Open original graph") — no on-canvas arrow needed. */}
          </g>
        );
      })}
      {/* ARROW ANNOTATIONS — drawn ON TOP of the panels (an arrow may point from
          one panel to another) and BELOW the figure caption. The shaft and the
          heads carry no `data-selection-ui`, so Export PNG, Save canvas and
          Insert into project keep the arrow; only the two end handles are
          screen-only. The geometry comes from arrowGeometry (utils/figureArrows),
          which is also what the tests exercise. */}
      {arrows.map(a => {
        const g = arrowGeometry(a);
        const sp = shadowSpec(a.shadow);
        const isArrowsSelected = a.id === selectedArrowId;
        return (
          <g key={a.id}
            filter={sp ? `url(#${shadowFilterId(a.id)})` : undefined}
            onClick={(e) => { e.stopPropagation(); setSelectedId(null); setSelectedArrowId(a.id); }}
            title="Arrow — drag it to move it, drag a blue end handle to aim it, or use “Arrow properties”">
            <path d={g.path} fill="none" stroke={g.arrow.color} strokeWidth={g.arrow.width}
              strokeLinecap="butt"
              strokeDasharray={g.arrow.dash ? `${+(g.arrow.width * 3).toFixed(2)} ${+(g.arrow.width * 2).toFixed(2)}` : undefined} />
            {g.heads.map((h, i) => (
              <path key={`ah${i}`} d={arrowHeadPath(h.tip, h.dir, g.arrow.headSize)} fill={g.arrow.color} />
            ))}
            {/* Invisible but WIDE shaft: an arrow drawn as a hairline is almost
                impossible to grab, so a transparent stroke takes the mouse. */}
            <path d={g.path} fill="none" stroke="transparent" strokeWidth={Math.max(4, g.arrow.width * 3)}
              pointerEvents="stroke" style={{ cursor: 'move' }}
              onMouseDown={(e) => startArrowDrag(e, a.id)} />
            {isArrowsSelected && (
              <g data-selection-ui="true">
                <circle cx={g.p0.x} cy={g.p0.y} r={1.6} fill="#3b82f6" stroke="white" strokeWidth={0.3}
                  style={{ cursor: 'crosshair' }} onMouseDown={(e) => startArrowDrag(e, a.id, 'start')}
                  title="Drag to move this end of the arrow" />
                <circle cx={g.p2.x} cy={g.p2.y} r={1.6} fill="#3b82f6" stroke="white" strokeWidth={0.3}
                  style={{ cursor: 'crosshair' }} onMouseDown={(e) => startArrowDrag(e, a.id, 'end')}
                  title="Drag to move this end of the arrow (the head follows the tangent of the curve)" />
              </g>
            )}
          </g>
        );
      })}
      {captionH > 0 && (
        <text x={canvasW / 2} y={canvasH + captionH - 4} fontSize={ptToMm(12)} fill="#1f2937" textAnchor="middle" fontWeight="bold"
          style={{ cursor: 'text', pointerEvents: 'auto' }}
          title="Click to edit the caption — it merges every object's sub-caption"
          onClick={(e) => { e.stopPropagation(); setSelectedId(null); setEditingCaption(true); }}
        >{effectiveGlobalCaption}</text>
      )}
      {/* 🧽 ERASER — while it is armed the WHOLE canvas becomes the drawing
          area (a rubber takes off whatever is under it, whichever panel that
          is). Screen-only: `data-selection-ui` keeps it out of every export. */}
      {eraseMode && (
        <g data-selection-ui="true">
          <rect x={0} y={0} width={canvasW} height={canvasH + captionH} fill="transparent"
            style={{ cursor: 'crosshair' }}
            onMouseDown={startEraseDrag}
            onMouseMove={(e) => setEraseCursor(mmAtPointer(e.clientX, e.clientY, svgElRef.current))}
            onMouseLeave={() => setEraseCursor(null)}
            title={`Eraser — press and drag over the figure to remove what is under the brush (${clampEraseSize(eraseSize)} mm). Set the brush size in “🧽 Eraser” of the properties panel; click the eraser button again to leave the tool.`} />
          {/* The brush itself: a circle of the exact diameter, at the pointer. */}
          {eraseCursor && (
            <circle cx={eraseCursor.x} cy={eraseCursor.y} r={clampEraseSize(eraseSize) / 2}
              fill="none" stroke="#0284c7" strokeWidth={0.25} pointerEvents="none" />
          )}
        </g>
      )}
    </svg>
  );

  // ── crop, as shown in the properties panel ─────────────────────────────────
  // The commands act on ONE figure: the active one (picked in the list below /
  // on the canvas), so a multi-figure panel can be cropped figure by figure.
  const cropPanelIdx = selectedObj ? activeFigIdx(selectedObj) : -1;
  const cropPanelOn = !!cropMode && !!selectedObj && cropMode.objId === selectedObj.id;
  const cropPanelRect = selectedObj && cropPanelIdx >= 0 ? cropOf(getObjImages(selectedObj)[cropPanelIdx]) : null;
  const cropPct = (v) => Math.round((Number(v) || 0) * 1000) / 10; // 0.825 → 82.5
  // FREE layout of the selected panel (see utils/figureLayout.js): as soon as
  // ONE of its figures keeps its own rectangle, the grid columns and the
  // panel-wide scale / padding no longer act on it — the commands below are
  // then explained and disabled instead of silently doing nothing.
  const selectedImgs = selectedObj ? getObjImages(selectedObj) : [];
  const selectedFreeLayout = isFreeLayout(selectedImgs);
  // Gomme : nombre de traits déjà posés sur la figure active (le bouton
  // « ⟲ Clear erasures » ne s'active que s'il y a quelque chose à reprendre).
  const erasePanelCount = (cropPanelIdx >= 0 ? eraseStrokesOf(selectedImgs[cropPanelIdx]).length : 0);

  // The selected ARROW annotation. A panel and an arrow are never selected at
  // the same time — one properties panel is shown, for whichever the user
  // clicked last.
  const selectedArrow = (arrows || []).find((a) => a.id === selectedArrowId) || null;

  // Properties Panel Component (reused in normal and fullscreen)
  const PropertiesPanel = ({ isFloating = false }) => (
    <div className={`bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col gap-3 ${isFloating ? 'shadow-2xl max-h-[calc(100vh-8rem)] overflow-y-auto custom-scrollbar' : ''}`}>
      {/* MULTI-SELECTION + COPY / PASTE. The chips are the panels of the canvas:
          click one to add / remove it from the selection, the “🎯” chip of a
          selected panel makes it the FIRST selected — the REFERENCE whose size
          the others take (Ctrl+click on the canvas does the same, without coming
          back here). The “📋” pair copies the selection and pastes it into the
          first free cell of the grid; Ctrl+C / Ctrl+V work anywhere on the page. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border border-slate-200 rounded-lg bg-white px-2 py-1.5">
        <span className="text-[10px] font-bold text-slate-500 uppercase shrink-0">Panels</span>
        {objects.map((o, i) => {
          const rank = selectedIds.indexOf(o.id);
          const label = o.letter || (i + 1);
          return (
            <span key={o.id} className="inline-flex items-center">
              <button type="button" onClick={() => toggleSelectedId(o.id)}
                className={`font-bold text-[10px] px-2 py-0.5 border ${rank === 0 ? 'bg-blue-600 text-white border-blue-700 rounded' : (rank > 0 ? 'bg-indigo-50 text-indigo-800 border-indigo-300 rounded-l' : 'bg-white text-slate-600 border-slate-300 rounded hover:bg-slate-50')}`}
                title={rank === 0
                  ? 'The FIRST selected panel — the reference: resizing it gives EVERY selected panel its size, and moving it moves them all. Click to remove it from the selection.'
                  : (rank > 0
                    ? `Selected (${ordinalOf(rank)}): it follows the first selected one — click to take it out of the selection.`
                    : `Add panel ${label} to the selection. The FIRST one selected is the reference (the “🎯” chip): its size is what the others take. Ctrl+click on the canvas does the same.`)}>
                {label}{rank === 0 ? ' 🎯' : ''}
              </button>
              {rank > 0 && (
                <button type="button" onClick={() => makeReference(o.id)}
                  className="font-bold text-[10px] px-1 py-0.5 border border-l-0 border-indigo-300 bg-white text-indigo-700 rounded-r hover:bg-indigo-50"
                  title="Make it the FIRST selected — the reference whose size every other selected panel takes">🎯</button>
              )}
            </span>
          );
        })}
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={() => copySelection()}
            className="font-bold text-[10px] bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 px-2 py-0.5 rounded"
            title="Copy the selected panel(s) — figures, texts and shadows included. Ctrl+C does the same, and “📋 Paste” brings an identical panel back.">📋 Copy</button>
          <button type="button" onClick={() => pasteClipboard()}
            className="font-bold text-[10px] bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 px-2 py-0.5 rounded"
            title={`Paste the copied panel(s) into the FIRST FREE cell of the grid (never on top of a panel that is already there) — Ctrl+V does the same${clipCount ? ` (${clipCount} panel${clipCount === 1 ? '' : 's'} in the clipboard)` : ' (nothing copied yet)'}`}>
            📋 Paste{clipCount ? ` (${clipCount})` : ''}
          </button>
          {selectedIds.length > 1 && (
            <button type="button" onClick={() => setSelectedId(selectedId)}
              className="font-bold text-[10px] bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 px-2 py-0.5 rounded"
              title="Keep only the first selected panel: the others leave the selection">✕ Others</button>
          )}
        </div>
      </div>
      <div className="flex justify-between items-center gap-2">
        <h4 className="font-bold text-slate-700">
          Object Properties ({selectedObj.letter || 'No Letter'})
          {selectedIds.length > 1 ? <span className="font-normal text-slate-500"> — {selectedIds.length} panels selected</span> : null}
        </h4>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={() => copySelection()} className="text-xs bg-white text-slate-700 border border-slate-300 px-2 py-1 rounded font-bold hover:bg-slate-100"
            title="Copy this panel — its figure(s), its texts and its shadows — Ctrl+C does the same">⧉ Copy</button>
          <button onClick={deleteSelection} className="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-1 rounded font-bold hover:bg-red-100"
            title={selectedIds.length > 1 ? `Delete the ${selectedIds.length} selected panels` : 'Delete this panel'}>
            {selectedIds.length > 1 ? `Delete ${selectedIds.length} panels` : 'Delete'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => zoomToObject(selectedObj.id)} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1">⛶ Zoom Fullscreen on Object</button>
        {selectedObj.src && selectedObj.src.testId && (
          <button onClick={() => openOriginalGraph(selectedObj.src)}
            className="bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-300 font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1"
            title={`Open ${originLabelOf(selectedObj.src) || 'the original experiment'} right on the graph this image was captured from${selectedObj.src.elementLabel ? ` (${selectedObj.src.elementLabel})` : ''}`}>
            ↗ Open original graph{originLabelOf(selectedObj.src) ? ` · ${originLabelOf(selectedObj.src)}` : ''}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <h5 className="text-xs font-bold text-slate-500 uppercase">Image & Layout</h5>

          {/* Multi-figure panel: list every figure in this object, import a new
              one (replace or add) and remove single figures. */}
          <div className="flex gap-2">
            <button onClick={() => { setPickMode('replace'); setShowLibrary(true); }} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-2 rounded-lg text-xs flex-1">Import Image (High-Res)</button>
            <button onClick={() => { setPickMode('add'); setShowLibrary(true); }} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-2 rounded-lg text-xs" title="Add another figure to this same object/panel: the figures already there are FROZEN (each one keeps exactly the place and size it has now) and the new one lands in the biggest free space — nothing has to be laid out again. “⊞ Lay the figures out in a grid” re-flows the panel side by side if you prefer.">➕ Add figure</button>
          </div>

          {getObjImages(selectedObj).length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-500">
                Figures in this panel: {getObjImages(selectedObj).length}
                {getObjImages(selectedObj).length > 1 && <span className="font-normal text-slate-400"> — the list is the stacking: the last one is ON TOP of the others (⤒ ⬆ ⬇ ⤓ re-layer a figure)</span>}
              </span>
              {getObjImages(selectedObj).map((im, i) => (
                <div key={im.libId || i} onClick={() => setActiveFig({ objId: selectedObj.id, idx: i })}
                  className={`flex flex-wrap items-center gap-x-2 gap-y-1 border rounded-lg px-2 py-1 cursor-pointer ${cropPanelIdx === i && getObjImages(selectedObj).length > 1 ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200'}`}
                  title="Click to make this figure the active one (crop / resize / eraser / shadow commands apply to the active figure)">
                  {im.imgThumb || im.imgSrc
                    ? <img src={im.imgThumb || im.imgSrc} alt="" className="w-8 h-8 shrink-0 object-contain rounded border border-slate-100 bg-slate-50" />
                    : <span className="w-8 h-8 shrink-0 rounded bg-slate-100" />}
                  {/* SÉLECTION MULTIPLE DE FIGURES — « resize them all as the
                      first selected » vaut AUSSI dans le panneau : la figure
                      ACTIVE (celle qui porte les poignées, marquée 🎯) est la
                      référence, et chaque figure cochée « ☑ » prend SA taille
                      quand on la redimensionne (elle suit aussi ses
                      déplacements), chacune à sa propre place. */}
                  {getObjImages(selectedObj).length > 1 && (() => {
                    const isRefFig = i === activeFigIdx(selectedObj);
                    const ticked = isRefFig || figGroupOf(selectedObj.id).includes(i);
                    return (
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); if (!isRefFig) toggleFigGroup(selectedObj.id, i); }}
                        disabled={isRefFig}
                        className={`shrink-0 text-[10px] font-bold border rounded px-1 ${isRefFig ? 'bg-blue-600 text-white border-blue-700' : (ticked ? 'bg-indigo-50 text-indigo-800 border-indigo-300' : 'text-slate-400 border-slate-200 hover:bg-slate-100')}`}
                        title={isRefFig
                          ? 'The ACTIVE figure — the first selected: it carries the handles, and every ticked figure takes ITS size when you resize it.'
                          : (ticked
                            ? 'This figure follows the active one: it takes its size when you resize it (click to untick).'
                            : 'Tick this figure to resize it WITH the active one — it then takes the active figure’s size, keeping its own place.')}>
                        {isRefFig ? '🎯 1st' : (ticked ? '☑' : '☐')}
                      </button>
                    );
                  })()}
                  <span className="text-[10px] font-bold text-slate-600 flex-1 min-w-0 truncate">{im.src && im.src.elementLabel ? im.src.elementLabel : `Figure ${i + 1}`}</span>
                  {/* Stacking: the list below is painted last → on top, and a
                      click grabs the topmost figure first. */}
                  {getObjImages(selectedObj).length > 1 && (
                    <span className="flex items-center gap-0.5 shrink-0" title="Stacking order inside the panel: the last figure of the list is drawn ON TOP of the others (and is the one a click grabs first where two figures overlap)">
                      <button type="button" onClick={(e) => { e.stopPropagation(); moveFigure(selectedObj.id, i, 'front'); }} disabled={i === getObjImages(selectedObj).length - 1}
                        className="text-[10px] font-bold text-slate-500 border border-slate-200 rounded px-1 disabled:opacity-30 hover:bg-slate-100"
                        title="Bring this figure to the front (on top of every other figure of the panel)">⤒</button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); moveFigure(selectedObj.id, i, 'up'); }} disabled={i === getObjImages(selectedObj).length - 1}
                        className="text-[10px] font-bold text-slate-500 border border-slate-200 rounded px-1 disabled:opacity-30 hover:bg-slate-100"
                        title="One step up in the stacking (a little less hidden by the figures above it)">⬆</button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); moveFigure(selectedObj.id, i, 'down'); }} disabled={i === 0}
                        className="text-[10px] font-bold text-slate-500 border border-slate-200 rounded px-1 disabled:opacity-30 hover:bg-slate-100"
                        title="One step down in the stacking (goes behind the figure just below it)">⬇</button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); moveFigure(selectedObj.id, i, 'back'); }} disabled={i === 0}
                        className="text-[10px] font-bold text-slate-500 border border-slate-200 rounded px-1 disabled:opacity-30 hover:bg-slate-100"
                        title="Send this figure to the back (behind every other figure of the panel)">⤓</button>
                    </span>
                  )}
                  {getObjImages(selectedObj).length > 1 && i === getObjImages(selectedObj).length - 1 && (
                    <span className="text-[9px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1 shrink-0" title="This figure is on top of the others">on top</span>
                  )}
                  {/* Shadow of THIS figure only — the picture itself, not the
                      panel frame (see the “Figure shadow” block below). */}
                  <button type="button"
                    onClick={(e) => { e.stopPropagation(); setActiveFig({ objId: selectedObj.id, idx: i }); setFigureShadow(selectedObj.id, i, im.shadow ? null : { ...DEFAULT_SHADOW }); }}
                    className={`text-[10px] font-bold shrink-0 border rounded px-1 ${im.shadow ? 'bg-slate-800 text-white border-slate-800' : 'text-slate-500 border-slate-200 hover:bg-slate-100'}`}
                    title={im.shadow ? 'This figure casts its own drop shadow (click to take it off this figure only)' : 'Give THIS figure only its own drop shadow — the shadow of the picture itself, not of the panel frame'}>🌓</button>
                  {im.src && im.src.testId && (
                    <button type="button" onClick={() => openOriginalGraph(im.src)}
                      className="text-[10px] font-bold text-sky-700 hover:underline shrink-0 border border-sky-200 bg-sky-50 rounded px-1.5 py-0.5"
                      title={`Open ${originLabelOf(im.src) || 'the original experiment'} right on the graph this figure was captured from${im.src.elementLabel ? ` (${im.src.elementLabel})` : ''}`}>
                      ↗ Open
                    </button>
                  )}
                  <button type="button" onClick={() => removeObjImage(i)} className="text-[10px] font-bold text-red-400 hover:text-red-600 shrink-0 border border-transparent hover:border-red-200 rounded px-1" title="Remove this figure from the panel">✕</button>
                </div>
              ))}
              {/* La règle de la sélection multiple, dite là où on la déclenche :
                  la figure ACTIVE est la première sélectionnée, donc c'est SA
                  taille que prennent les figures cochées. */}
              {getObjImages(selectedObj).length > 1 && figGroupOf(selectedObj.id).length > 0 && (
                <span className="text-[10px] font-bold text-indigo-800 bg-indigo-50 border border-indigo-200 rounded px-2 py-1">
                  🎯 {figGroupOf(selectedObj.id).length + 1} figures selected — the ACTIVE one is the first selected: resizing it gives EVERY selected figure its size (each one keeps its own place), and dragging it moves them all.
                </span>
              )}
              {getObjImages(selectedObj).length > 1 && !selectedFreeLayout && (
                <label className="text-[10px] font-bold text-slate-500">Grid columns
                  <select value={selectedObj.imgCols || 2} onChange={e => updateObj({ imgCols: Number(e.target.value) })} className="w-full border rounded p-1 text-xs">
                    {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              )}
              {/* FREE layout: the figures of this panel each keep their own
                  rectangle (that is what “➕ Add figure” writes, so adding a
                  figure never moves the ones already there). The panel-wide
                  scale / padding / grid columns no longer act on them — the
                  banner explains it and offers the way back to the grid. */}
              {selectedFreeLayout && (
                <div className="flex flex-col gap-1 bg-indigo-50 border border-indigo-200 rounded-lg p-2">
                  <span className="text-[10px] font-bold text-indigo-800">
                    ⊞ Free layout — every figure of this panel keeps its own place (drag or resize it on the canvas).
                  </span>
                  <span className="text-[9px] text-indigo-700">
                    That is why adding a figure no longer moves the ones already here. Scale, padding and grid columns act on the GRID layout only.
                  </span>
                  <button type="button" onClick={() => relayoutInGrid(selectedObj)}
                    className="self-start bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-100 font-bold px-2.5 py-1 rounded text-[10px]"
                    title="Forget the free rectangles and lay the figures out side by side in the panel grid again (obj “Grid columns” columns)">
                    ⊞ Lay the figures out in a grid
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] font-bold text-slate-500">Fit
              <select value={keepAspect ? 'contain' : selectedObj.imgFit} disabled={keepAspect} onChange={e => updateObj({ imgFit: e.target.value })}
                className={`w-full border rounded p-1 text-xs ${keepAspect ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : ''}`}
                title={keepAspect ? 'The canvas option “🔒 Keep aspect ratio” is on: every figure is fitted with its own width/height ratio. Untick it to choose Contain / Cover / Stretch per panel.' : 'How the figure fills its panel cell: Contain / Cover / Stretch'}>
                <option value="contain">Contain</option>
                <option value="cover">Cover</option>
                <option value="stretch">Stretch</option>
              </select>
            </label>
            <label className="text-[10px] font-bold text-slate-500">Scale (%)
              <input type="number" min="10" max="500" disabled={selectedFreeLayout} value={Math.round((selectedObj.imgScale || 1) * 100)} onChange={e => updateObj({ imgScale: Number(e.target.value) / 100 })}
                className={`w-full border rounded p-1 text-xs ${selectedFreeLayout ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : ''}`}
                title={selectedFreeLayout ? 'This panel is in FREE layout: every figure keeps its own rectangle, so the panel-wide scale no longer moves it — drag the figure’s corner handle on the canvas (or “⊞ Lay the figures out in a grid”).' : 'Scale of the figure inside its cell (grid layout).'} />
            </label>
            <label className="text-[10px] font-bold text-slate-500">Padding (mm)
              <input type="number" min="0" max="20" step="0.5" disabled={selectedFreeLayout} value={selectedObj.imgPadding} onChange={e => updateObj({ imgPadding: Number(e.target.value) })}
                className={`w-full border rounded p-1 text-xs ${selectedFreeLayout ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : ''}`}
                title={selectedFreeLayout ? 'This panel is in FREE layout: the padding of the panel grid no longer applies — the rectangle of every figure is its own box.' : 'Margin kept around the figure inside its cell.'} />
            </label>
            {/* CROP — the "Shift X / Shift Y" number commands were removed: the
                image is shifted by DRAGGING it on the canvas (or Shift+drag
                anywhere on the object), which is the natural gesture. Cropping
                replaces them as the precise command. */}
            <div className="col-span-2 flex flex-col gap-1 bg-amber-50 border border-amber-200 rounded-lg p-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold text-amber-800 flex-1">
                  ✂️ Crop{cropPanelIdx >= 0 && getObjImages(selectedObj).length > 1 ? ` — figure ${cropPanelIdx + 1}` : ''}
                </span>
                <button type="button" onClick={() => toggleCropMode(selectedObj.id, cropPanelIdx)}
                  disabled={cropPanelIdx < 0}
                  className={`font-bold px-2.5 py-1 rounded text-[10px] border ${cropPanelIdx < 0 ? 'bg-slate-100 border-slate-200 text-slate-300' : cropPanelOn ? 'bg-amber-500 text-white border-amber-600' : 'bg-white border-amber-300 text-amber-700 hover:bg-amber-100'}`}
                  title="Turn crop mode on, then drag a rectangle on the canvas over this figure — releasing the mouse applies the crop">
                  {cropPanelOn ? '✂️ Crop mode ON — click to exit' : '✂️ Crop'}
                </button>
                <button type="button" onClick={() => resetCropRect(selectedObj.id, cropPanelIdx)}
                  disabled={!cropPanelRect}
                  className={`font-bold px-2.5 py-1 rounded text-[10px] border ${cropPanelRect ? 'bg-white border-slate-300 text-slate-600 hover:bg-slate-100' : 'bg-slate-100 border-slate-200 text-slate-300'}`}
                  title="Show the whole original image again">⟲ Reset crop</button>
              </div>
              {cropPanelOn ? (
                <span className="text-[10px] font-bold text-amber-700">
                  Drag a rectangle on the canvas over the figure — the mouse release applies it — or type the four % below.
                  A crop only ever keeps what is left, so the parts already removed never come back.
                </span>
              ) : (
                <span className="text-[10px] text-slate-500 italic">
                  {cropPanelRect
                    ? `Kept: ${cropPct(cropPanelRect.x1)}–${cropPct(cropPanelRect.x2)} % × ${cropPct(cropPanelRect.y1)}–${cropPct(cropPanelRect.y2)} % of the original image.`
                    : 'No crop — the whole figure is shown. Set the four % below or turn ✂️ Crop mode on and drag on the canvas.'}
                </span>
              )}
              {/* The numeric window is ALWAYS available: crop never depends on a
                  drag landing on the figure, and typing an edge crops at once
                  (Left/Right/Top/Bottom in % of the original image). */}
              {cropPanelIdx >= 0 && (
                <div className="grid grid-cols-4 gap-1">
                  {[['x1', 'Left'], ['x2', 'Right'], ['y1', 'Top'], ['y2', 'Bottom']].map(([edge, label]) => {
                    const cur = cropPanelRect || { x1: 0, y1: 0, x2: 1, y2: 1 };
                    return (
                      <label key={edge} className="text-[9px] font-bold text-slate-500">{label} (%)
                        <input type="number" min="0" max="100" step="0.5" value={cropPct(cur[edge])}
                          onChange={(e) => setCropEdge(selectedObj.id, cropPanelIdx, edge, e.target.value)}
                          onWheel={(e) => e.target.blur()}
                          className="w-full border rounded p-0.5 text-[10px]" />
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
            {/* 🧽 ERASER — remove PARTS of a figure with a round brush whose
                size is adjustable (a rubber, not a crop: the stroke removes
                whatever it touches). The strokes live on the figure, in ITS
                coordinates (utils/figureErase.js), and are painted as an SVG
                mask: the hole is transparent in the composition AND in every
                export, it follows the figure when it is resized, and it
                survives a reload (a raster retouch would be lost: the canvas
                only persists thumbnails). */}
            <div className="col-span-2 flex flex-col gap-1 bg-sky-50 border border-sky-200 rounded-lg p-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold text-sky-900 flex-1">
                  🧽 Eraser{erasePanelCount ? ` — ${erasePanelCount} stroke${erasePanelCount === 1 ? '' : 's'} on this figure` : ''}
                </span>
                <button type="button" onClick={toggleEraseMode} disabled={cropPanelIdx < 0}
                  className={`font-bold px-2.5 py-1 rounded text-[10px] border ${cropPanelIdx < 0 ? 'bg-slate-100 border-slate-200 text-slate-300' : eraseMode ? 'bg-sky-600 text-white border-sky-700' : 'bg-white border-sky-300 text-sky-700 hover:bg-sky-100'}`}
                  title="Remove parts of the figure — a round brush of the size below; press and drag on the canvas and everything the brush touches is taken off (the erasing of the panel above is armed; Ctrl+Z undoes a stroke)">
                  {eraseMode ? '🧽 Eraser ON — click to exit' : '🧽 Eraser'}
                </button>
                <button type="button" onClick={() => clearErase(selectedObj.id, cropPanelIdx)} disabled={!erasePanelCount}
                  className={`font-bold px-2.5 py-1 rounded text-[10px] border ${erasePanelCount ? 'bg-white border-slate-300 text-slate-600 hover:bg-slate-100' : 'bg-slate-100 border-slate-200 text-slate-300'}`}
                  title="Put the pixels removed from this figure back (the eraser strokes are forgotten)">
                  ⟲ Clear erasures
                </button>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[9px] font-bold text-slate-500 flex-1">Brush size (mm) — {clampEraseSize(eraseSize)} mm
                  <input type="range" min={ERASE_SIZE_MIN} max={ERASE_SIZE_MAX} step="0.5" value={eraseSize}
                    onChange={(e) => setEraseSize(clampEraseSize(e.target.value))} className="w-full accent-sky-600" />
                </label>
                <input type="number" min={ERASE_SIZE_MIN} max={ERASE_SIZE_MAX} step="0.5" value={eraseSize}
                  onChange={(e) => setEraseSize(clampEraseSize(e.target.value))}
                  className="w-16 border rounded p-0.5 text-[10px]"
                  title="Diameter of the brush in millimetres of the canvas (0.5 to 30 mm)" />
              </div>
              <span className={`text-[10px] italic ${eraseMode ? 'font-bold text-sky-800' : 'text-slate-600'}`}>
                {eraseMode
                  ? 'Drag on the canvas: everything the round brush touches is removed — one stroke = one Ctrl+Z. Click the button again to leave the tool.'
                  : 'Turn the eraser on, then drag over the figure: the round brush takes off what is under it (the size above is regulated with the slider or the number).'}
              </span>
            </div>
            {/* 🌓 SHADOW OF THE FIGURE ITSELF — the shadow asked for: the one
                that follows the PICTURE, not the (white) frame of the panel.
                The record is the same one panels and arrows write, the filter is
                its own (`figureShadowFilterId`) and it is applied to a group
                ABOVE the <image>, so the shadow is built from the pixels of the
                figure — its own transparency — and from nothing that the 🧽
                eraser removed. A JPEG (opaque background) can only cast the
                shadow of its rectangle: no filter invents a transparency the
                file does not have — erase the background with the eraser, or use
                a PNG, to get a shadow that hugs the object. The panel's own
                shadow is the one of its FRAME: switch it off (block “Shadow”
                below) to keep only the figures'. */}
            <div className="col-span-2 flex flex-col gap-1.5 bg-slate-50 border border-slate-300 rounded-lg p-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold text-slate-700 flex-1">
                  🌓 Figure shadow{getObjImages(selectedObj).length > 1 && cropPanelIdx >= 0 ? ` — figure ${cropPanelIdx + 1} of ${getObjImages(selectedObj).length}` : ''}
                </span>
                <button type="button" onClick={toggleFiguresShadow} disabled={!getObjImages(selectedObj).length}
                  className={`font-bold px-2.5 py-1 rounded text-[10px] border ${getObjImages(selectedObj).length ? 'bg-white border-slate-300 text-slate-600 hover:bg-slate-100' : 'bg-slate-100 border-slate-200 text-slate-300'}`}
                  title="Give EVERY figure of this panel the same shadow — click again to take it off all of them">
                  🌓 {figuresShadowed ? 'Remove the shadow from every figure' : 'Same shadow on every figure'}
                </button>
              </div>
              {cropPanelIdx >= 0 ? (
                <ShadowControls value={shadowSpec(getObjImages(selectedObj)[cropPanelIdx].shadow)}
                  onChange={(v) => setFigureShadow(selectedObj.id, cropPanelIdx, v)}
                  hint="The FIGURE casts this shadow — its pixels, so a PNG on a transparent background is shadowed around its content and what the 🧽 eraser removed casts nothing. It is drawn in the composition and kept by every export. (The “Shadow” block below is the one of the whole PANEL: its frame, figure, letter and texts.)" />
              ) : (
                <span className="text-[10px] text-slate-400 italic">Import a figure into this panel to give it its own shadow.</span>
              )}
            </div>
            <label className="text-[10px] font-bold text-slate-500">Rotate (°)
              <div className="flex gap-1">
                <input type="number" min="-360" max="360" step="1" value={selectedObj.imgRotate || 0} onChange={e => updateObj({ imgRotate: Number(e.target.value) })} className="w-full border rounded p-1 text-xs" title="Rotate the image" />
                <button type="button" onClick={() => updateObj({ imgRotate: ((selectedObj.imgRotate || 0) + 90) % 360 })} className="bg-slate-100 border border-slate-300 rounded px-1.5 text-xs font-bold hover:bg-slate-200 shrink-0" title="Rotate 90°">↻90°</button>
              </div>
            </label>
            <span className="col-span-2 text-[9px] text-slate-400 italic">Drag the image directly on the canvas to shift it (or hold Shift + drag the object frame); drag its corner to resize it. With several panels selected (Ctrl+click on the canvas, or the “Panels” chips above), the FIRST selected is the reference: dragging its handle gives every selected panel its size, and dragging its frame moves them all.</span>
            {keepAspect && (
              <span className="col-span-2 text-[9px] font-bold text-emerald-700">
                🔒 Keep aspect ratio is on (canvas option): the figure keeps its own width/height ratio, whatever the number of panels or the canvas size.
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h5 className="text-xs font-bold text-slate-500 uppercase">Labels & Captions</h5>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] font-bold text-slate-500">Letter
              <input type="text" value={selectedObj.letter} onChange={e => updateObj({ letter: e.target.value })} className="w-full border rounded p-1 text-xs" />
            </label>
            <label className="text-[10px] font-bold text-slate-500" title="The letter size belongs to the FIGURE, not to a single panel: changing it rescales every panel letter (A, B, C …) at once — no need to set it panel by panel. New panels adopt it automatically.">Letter Size — all panels (pt)
              <input type="number" min="4" max="48" value={letterPt} onChange={e => setLetterSizeAll(e.target.value)} className="w-full border rounded p-1 text-xs" />
            </label>
            <div className="col-span-2 flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold text-slate-500">Caption (sub-caption — merged into the figure caption at the bottom, never drawn inside the panel)</span>
                <button type="button" onClick={() => setEditingObjCaption(selectedObj.id)}
                  className="shrink-0 bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 font-bold px-2 py-0.5 rounded text-[10px]"
                  title="Open the floating caption editor">✎ Edit in place</button>
              </div>
              <textarea rows={2} value={selectedObj.caption} onChange={e => updateObj({ caption: e.target.value })} placeholder={`Sub-caption for panel ${selectedObj.letter || ''} — merged into the figure caption at the bottom`} className="w-full border rounded p-1 text-xs" />
            </div>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <label className="text-[10px] font-bold text-slate-500" title="Colour of THIS panel's letter (colour and bold stay per panel — the size above is shared by every panel).">Letter Color
              <input type="color" value={selectedObj.letterStyle.color} onChange={e => updateObj({ letterStyle: { ...selectedObj.letterStyle, color: e.target.value } })} className="w-8 h-6 rounded border cursor-pointer" />
            </label>
            <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500" title="Bold for THIS panel's letter.">
              <input type="checkbox" checked={selectedObj.letterStyle.bold} onChange={e => updateObj({ letterStyle: { ...selectedObj.letterStyle, bold: e.target.checked } })} /> Bold
            </label>
            <span className="text-[9px] text-slate-400 italic">Letter size is shared by every panel; colour and bold are per panel.</span>
          </div>
        </div>
      </div>

      {/* DROP SHADOW of THIS panel — the same control block the arrows use, so
          both write the same record and both are rendered by the same
          <feDropShadow> filter. “Same shadow on every panel” applies it to the
          whole figure in one click (the toolbar has the same shortcut).
          This one shadows the whole PANEL — its frame included, hence the
          rectangular shadow of a white box. The “🌓 Figure shadow” block of the
          object properties shadows each FIGURE separately (its pixels): switch
          this one off when only the pictures should cast a shadow. */}
      <div className="flex flex-col gap-2 border-t border-slate-200 pt-3">
        <h5 className="text-xs font-bold text-slate-500 uppercase" title="Shadow of the whole PANEL — its white frame, the figure, the letter and the texts. One panel at a time; for the shadow of each FIGURE inside it see the “🌓 Figure shadow” block above.">Shadow <span className="font-normal normal-case text-slate-400">(panel frame)</span></h5>
        <ShadowControls value={shadowSpec(selectedObj.shadow)} onChange={(v) => updateObj({ shadow: v })}
          hint="The whole panel (frame, figure, letter, texts) casts a drop shadow — in the composition and in every export. For a shadow that follows the PICTURE instead of the frame, use “🌓 Figure shadow” in the object properties above." />
        <div className="flex">
          <button type="button" onClick={togglePanelsShadow}
            className="bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 font-bold px-2.5 py-1 rounded text-[10px]"
            title="Give EVERY panel of the figure the same shadow — click again to take it off all of them">
            🌓 {panelsShadowed ? 'Remove the shadow from every panel' : 'Same shadow on every panel'}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-slate-200 pt-3">
        <div className="flex items-center justify-between">
          <h5 className="text-xs font-bold text-slate-500 uppercase">Free Text (anywhere in the object)</h5>
          <div className="flex gap-1.5">
            <button onClick={addText} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-2.5 py-1 rounded text-[10px]">+ Add Text</button>
            <button onClick={() => setPlaceTextMode(v => !v)}
              className={`font-bold px-2.5 py-1 rounded text-[10px] border ${placeTextMode ? 'bg-amber-500 text-white border-amber-600' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}
              title="Click on the object to place text exactly where you click">✏️ Place by click</button>
          </div>
        </div>
        {placeTextMode && <p className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">Click anywhere on the selected object to add a text there.</p>}
        {(selectedObj.texts || []).length === 0 && <p className="text-[10px] text-slate-400 italic">Add a text with “+ Add Text” or “✏️ Place by click”, then drag it directly on the object to move it.</p>}
        {(selectedObj.texts || []).map((tx, i) => (
          <div key={tx.id} className="border border-slate-200 rounded-lg p-2 bg-white flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-black text-slate-400 w-4">{i + 1}</span>
              <input type="text" value={tx.text} onChange={e => updateText(tx.id, { text: e.target.value })} className="flex-1 border rounded p-1 text-xs min-w-0" />
              <button onClick={() => deleteText(tx.id)} className="text-red-400 hover:text-red-600 font-bold text-xs px-1" title="Delete text">✕</button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              <label className="text-[9px] font-bold text-slate-500">X (mm)
                <input type="number" step="0.5" value={tx.x} onChange={e => updateText(tx.id, { x: Number(e.target.value) })} className="w-full border rounded p-0.5 text-[10px]" />
              </label>
              <label className="text-[9px] font-bold text-slate-500">Y (mm)
                <input type="number" step="0.5" value={tx.y} onChange={e => updateText(tx.id, { y: Number(e.target.value) })} className="w-full border rounded p-0.5 text-[10px]" />
              </label>
              <label className="text-[9px] font-bold text-slate-500">Size (pt)
                <input type="number" min="4" max="96" value={tx.fontSize} onChange={e => updateText(tx.id, { fontSize: Number(e.target.value) })} className="w-full border rounded p-0.5 text-[10px]" />
              </label>
              <label className="text-[9px] font-bold text-slate-500">Color
                <input type="color" value={tx.color} onChange={e => updateText(tx.id, { color: e.target.value })} className="w-full h-6 rounded border cursor-pointer" />
              </label>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
                <input type="checkbox" checked={tx.bold} onChange={e => updateText(tx.id, { bold: e.target.checked })} /> Bold
              </label>
              <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
                <input type="checkbox" checked={tx.italic} onChange={e => updateText(tx.id, { italic: e.target.checked })} /> Italic
              </label>
              <span className="text-[9px] text-slate-400 italic ml-auto">drag on the object to move</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <>
      {/* Main Component UI */}
      <div className="flex flex-col gap-4 bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <div className="flex justify-between items-center gap-2 flex-wrap">
          <h3 className="text-lg font-black text-slate-800">🖼️ Image Builder (Publication Quality)</h3>
          <div className="flex gap-2 items-center flex-wrap">
            {homeEntry && (
              <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-1"
                    title={`Saved canvas — “💾 Save canvas” updates this entry in place, so every link that opens it (project page “🖼 Saved canvases”, “↩ Load” in the image library) always gets the latest version. Stored ${canvasHome ? `in the “${canvasScopeName(canvasHome)}” image library` : 'in the shared dataset image library'}${storedScopeCount > 1 ? ` (and in ${storedScopeCount - 1} other ${storedScopeCount - 1 === 1 ? 'library' : 'libraries'})` : ''}.`}>
                🖼 {canvasLabel || homeEntry.label || 'saved canvas'} · {canvasHome ? `📁 ${canvasScopeName(canvasHome)}` : '🌐 dataset'}
              </span>
            )}
            {projectId && typeof onBackToProject === 'function' && (
              <button onClick={onBackToProject}
                      className="text-xs bg-slate-100 border border-slate-300 text-slate-700 px-3 py-1.5 rounded-lg font-bold hover:bg-slate-200"
                      title="Back to the project page — its “🖼 Saved canvases” section links back to this canvas">
                📁 Project page
              </button>
            )}
            <button onClick={() => { initialZoomRef.current = zoom; setIsFullScreen(true); }} className="text-xs bg-slate-800 text-white border border-slate-800 px-3 py-1.5 rounded-lg font-bold hover:bg-slate-700 flex items-center gap-1">
              🔍 Full Screen
            </button>
            <button onClick={startNewImage}
                    className="text-xs bg-amber-500 hover:bg-amber-600 text-white border border-amber-500 px-3 py-1.5 rounded-lg font-bold"
                    title="Create a NEW image — a new figure, not a wipe: the editor starts on a blank canvas with one empty panel (A) ready for its first capture, and the next “💾 Save canvas” adds a NEW image to the image library. The figure you were working on stays in the library exactly as it was last saved (its “↩ Load” brings it back). The canvas format — size, grid, borders, aspect ratio, letter size — is kept.">
              ➕ New image
            </button>
            <button onClick={() => { if(window.confirm('Clear the entire canvas?')) { commitHistory(); setObjects([]); setArrows([]); setSelectedId(null); setSelectedArrowId(null); setCanvasEntries({}); setCanvasLabel(''); } }} className="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-1 rounded font-bold hover:bg-red-100">Clear Canvas</button>
          </div>
        </div>

        {/* Automatic re-capture report — the figures were redone on their own
            experiment page and this canvas already shows the new pixels. */}
        {recapNote && (recapNote.done > 0 || recapNote.failed > 0) ? (
          <div className={`rounded-xl border px-3 py-2 text-xs flex flex-wrap items-center gap-x-2 gap-y-1 ${
            recapNote.failed ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-emerald-50 border-emerald-300 text-emerald-800'}`}>
            <span className="font-bold">
              {recapNote.stopped ? '⏹' : recapNote.failed ? '⚠️' : '✅'} Automatic re-capture
            </span>
            <span>
              {recapNote.done} figure{recapNote.done === 1 ? '' : 's'} replaced in the image library
              {recapNote.failed ? ` · ${recapNote.failed} could not be redone` : ''}
              {recapNote.stopped ? ' · stopped by you' : ''}.
            </span>
            {recapNote.failed ? (
              <span className="text-[11px] text-amber-700">
                {recapNote.results.filter((r) => r.status === 'failed').slice(0, 3)
                  .map((r) => `${r.label}${r.message ? ` (${r.message})` : ''}`).join(' · ')}
                {' '}— use ↗ Open original graph for those.
              </span>
            ) : null}
            <span className="text-[10px] text-slate-500">The canvas below already shows the new figures.</span>
            {recapNote.pending ? (
              <button type="button"
                onClick={() => { stopFigureRecaptures('stopped from the Image Builder'); setRecapNote(figureRecaptureSummary()); }}
                className="font-bold text-red-700 bg-red-50 border border-red-300 rounded-md px-2 py-0.5 hover:bg-red-100"
                title="This run is not finished: stop it now, so no other figure is captured and nothing else is written to the image library.">
                ⏹ Stop ({recapNote.pending} to go)
              </button>
            ) : null}
            <button type="button" onClick={() => setRecapNote(null)}
              className="ml-auto font-bold text-slate-500 hover:text-slate-800" title="Dismiss">✕</button>
          </div>
        ) : null}

        {/* Toolbar */}
        <div className="flex flex-wrap gap-3 items-end bg-slate-50 border border-slate-200 rounded-lg p-3">
          <label className="text-[10px] font-bold text-slate-500 flex flex-col">Width (mm)
            <input type="number" min="50" max="500" value={canvasW} onChange={e => setCanvasW(Number(e.target.value))} className="border rounded p-1 text-xs w-20" />
          </label>
          <label className="text-[10px] font-bold text-slate-500 flex flex-col">Height (mm)
            <input type="number" min="50" max="500" value={canvasH} onChange={e => setCanvasH(Number(e.target.value))} className="border rounded p-1 text-xs w-20" />
          </label>
          <label className="text-[10px] font-bold text-slate-500 flex flex-col">Grid Cols
            <input type="number" min="1" max="20" value={gridCols} onChange={e => setGridCols(Number(e.target.value))} className="border rounded p-1 text-xs w-16" />
          </label>
          <label className="text-[10px] font-bold text-slate-500 flex flex-col">Grid Rows
            <input type="number" min="1" max="20" value={gridRows} onChange={e => setGridRows(Number(e.target.value))} className="border rounded p-1 text-xs w-16" />
          </label>
          <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500 pb-2 cursor-pointer"
            title="Draw a thin frame around every panel. It is part of the composition, so Export PNG, Save canvas and Insert into project follow this choice.">
            <input type="checkbox" checked={showPanelBorders} onChange={e => setShowPanelBorders(e.target.checked)} /> Panel borders
          </label>
          <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500 pb-2 cursor-pointer"
            title="Draw the cell divider guides across the canvas (layout guides). They are part of the composition, so Export PNG, Save canvas and Insert into project follow this choice.">
            <input type="checkbox" checked={showGridLines} onChange={e => setShowGridLines(e.target.checked)} /> Grid lines
          </label>
          <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500 pb-2 cursor-pointer"
            title="Canvas option: every figure keeps its own width/height ratio inside its panel, so changing the number of panels or the canvas width/height only rescales the figures instead of stretching them. It overrides the per-object “Fit → Stretch” choice.">
            <input type="checkbox" checked={keepAspect} onChange={e => setKeepAspect(e.target.checked)} /> 🔒 Keep aspect ratio
          </label>
          <label className="text-[10px] font-bold text-slate-500 flex flex-col" title="Size of the panel letters (A, B, C …). It is a FIGURE setting: changing it rescales every letter of the canvas at once, and the panels added later adopt it — you never set it panel by panel.">
            Letter size (pt)
            <input type="number" min="4" max="48" value={letterPt} onChange={e => setLetterSizeAll(e.target.value)} className="border rounded p-1 text-xs w-20" />
          </label>
          <label className="text-[10px] font-bold text-slate-500 flex flex-col flex-1 min-w-[220px]" title="The caption written at the bottom of the figure. By default it merges the panel sub-captions in LETTER order (A: … · B: … · C: …), whatever order the panels were created in.">Global caption (click to edit — merges the object sub-captions in letter order)
            <span className="border border-slate-200 rounded p-1 text-xs bg-slate-50 text-slate-600 truncate hover:border-blue-400 hover:bg-blue-50 cursor-text" title={effectiveGlobalCaption} onClick={() => { setSelectedId(null); setEditingCaption(true); }}>{effectiveGlobalCaption || 'Merges the object sub-captions (A: …, B: …)'}</span>
          </label>
          <button onClick={addObject} title="Add a panel — it takes the FIRST FREE cell of the grid, so it never lands on a panel that is already there (a full grid is reported instead of covering a figure)." className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs">+ Add Object</button>
          <button onClick={addArrow} title="Add an ARROW annotation on top of the panels — drag it to place it, drag a blue end handle to aim it; straight or curved, one head or heads at BOTH ends, with its own colour and drop shadow (“Arrow properties”)." className="bg-rose-600 hover:bg-rose-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs">↗ Add arrow{arrows.length ? ` (${arrows.length})` : ''}</button>
          <button onClick={togglePanelsShadow} disabled={!objects.length} title="Drop shadow on every panel of the figure in one click — click again to take it off. One panel at a time: the “Shadow” block of its properties." className={`font-bold px-3 py-1.5 rounded-lg text-xs border disabled:opacity-40 ${panelsShadowed ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}>🌓 Shadow panels</button>
          {/* COLLER (Ctrl+V) : la copie d'un panneau revient telle quelle — ses
              figures, ses textes et ses ombres — dans la première case libre. */}
          <button onClick={() => pasteClipboard()}
            title={`Paste a copied panel (Ctrl+V): its figures, its texts and its shadows come back, and its letter is re-numbered by position. It lands in the FIRST FREE cell of the grid — never on top of a panel that is there.${clipCount ? ` (${clipCount} panel${clipCount === 1 ? '' : 's'} copied)` : ' Copy a panel first: Ctrl+C on the canvas, or “⧉ Copy” in the object properties.'}`}
            className={`font-bold px-3 py-1.5 rounded-lg text-xs border ${clipCount ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50' : 'bg-slate-100 border-slate-200 text-slate-400'}`}>📋 Paste{clipCount ? ` (${clipCount})` : ''}</button>
          <button onClick={undo} disabled={!undoStack.current.length || histTick < 0} className="bg-slate-100 border border-slate-300 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-slate-200 disabled:opacity-40" title="Undo last change (Ctrl+Z)">↩ Undo</button>
          <button onClick={() => selectedId && zoomToObject(selectedId)} disabled={!selectedId} title={selectedId ? 'Zoom fullscreen on the selected object' : 'Select an object first'}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-bold px-3 py-1.5 rounded-lg text-xs">⛶ Zoom Object</button>
          <button onClick={exportPng} title="300 DPI PNG of the composition — the blue selection square and resize handles are never included; panel borders and grid lines follow the checkboxes." className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs">Export PNG (300 DPI)</button>
          <button onClick={openSaveDialog} title="Save the whole canvas in the image library — the dialog asks WHERE: a project's library (its Project tab + that project page's “🖼 Saved canvases”, where it can be reopened in this editor) or the shared dataset library. Re-saving a canvas updates the copy of the place you pick; nothing is duplicated."
            className="bg-amber-500 hover:bg-amber-600 text-white font-bold px-3 py-1.5 rounded-lg text-xs">💾 Save canvas</button>
          <button onClick={() => { setPickMode('replace'); setShowLibrary(true); }}
            title="Open the image library — browse images or upload new ones from your computer (Project or Dataset library)"
            className="bg-teal-600 hover:bg-teal-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs">🖼 Image Library</button>
          <button onClick={() => { setInsertTarget({ projectId: (canWriteLibProject(projectId) ? projectId : '') || (myWritableProjects[0] && myWritableProjects[0].id) || '', section: 'background' }); setInsertMsg(''); setInsertOpen(true); }}
            title="Render this composition into a project section (Background / Discussion / Conclusions). The inserted figure keeps a link back to this canvas, so the project page can reopen it here with “✏️ Modify in Image Builder”."
            className="bg-violet-600 hover:bg-violet-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs">📤 Insert into project…</button>
          <button onClick={() => setStyleAuditOpen((v) => !v)}
            title="Check that every figure on this canvas was captured with the SAME character size (Settings → Figure style). Figures captured with another style are listed with a link back to their original graph, where the 🎨 button re-applies the profile."
            className={`font-bold px-3 py-1.5 rounded-lg text-xs border ${styleAuditOpen ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
            ⚖️ Character sizes
          </button>

          {styleAuditOpen && (
            <div className="w-full bg-white border border-slate-300 rounded-lg p-3 flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h5 className="text-xs font-bold text-slate-700">⚖️ Figure style audit</h5>
                <span className="text-[10px] font-mono text-slate-400">current style: {styleTag}</span>
                <span className={`text-[11px] font-bold ${styleBad.length ? 'text-amber-700' : 'text-emerald-700'}`}>
                  {styleRows.length === 0
                    ? 'No figure on the canvas yet.'
                    : (styleBad.length
                      ? `⚠ ${styleBad.length} of ${styleRows.length} figure(s) were not captured with the current style — characters may look bigger / smaller in the same slide.`
                      : `✅ All ${styleRows.length} figure(s) share the current style.`)}
                </span>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {dupInfo.count > 0 ? (
                    <button type="button" onClick={cleanRecaptureCopies}
                      className="bg-white border border-amber-300 text-amber-800 hover:bg-amber-50 font-bold px-2.5 py-1 rounded-md text-[11px]"
                      title="Copies of the SAME figure that a previous automatic re-capture left in the image library (each retry whose entry could no longer be found added one). Keeps the newest copy of every figure and deletes the older ones — only figures with 3+ copies written within a few minutes are touched, and only when you click.">
                      🧹 Remove {dupInfo.count} duplicate cop{dupInfo.count === 1 ? 'y' : 'ies'}
                    </button>
                  ) : null}
                  {recapturableCount > 0 ? (
                    <button type="button" onClick={() => recaptureFigures(styleBad)}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-2.5 py-1 rounded-md text-[11px]"
                      title="One click: the app opens the experiment(s), applies the CURRENT Figure style to the charts and replaces the saved figures in the image library — then it comes back to this canvas on its own. A ⏹ Stop button appears on the experiment page while it works.">
                      🔄 Recapture automatically ({recapturableCount})
                    </button>
                  ) : null}
                </div>
              </div>
              {dupInfo.msg ? <div className="text-[10px] font-bold text-emerald-700">{dupInfo.msg}</div> : null}
              {styleRows.length > 0 && (
                <ul className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
                  {styleRows.map((r) => {
                    const badge = STYLE_BADGE[r.status] || STYLE_BADGE.untagged;
                    return (
                      <li key={r.key} className="flex items-center gap-2 border border-slate-200 rounded-md px-2 py-1.5">
                        <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${badge.cls}`}>{badge.text}</span>
                        <span className="min-w-0 flex-1 truncate">
                          <b>{r.letter ? `${r.letter}: ` : ''}{r.label}</b>
                          {r.origin ? <span className="text-slate-400"> · {r.origin}</span> : null}
                          <span className="text-slate-400">
                            {' · '}{r.tag || 'no style stamp'}
                            {r.pxW ? ` · ${r.pxW}×${r.pxH} px` : (r.renderedW ? ` · ${r.renderedW}×${r.renderedH} px` : '')}
                          </span>
                        </span>
                        {r.status !== 'match' && r.status !== 'canvas' ? (
                          <>
                            {r.canRecapture ? (
                              <button type="button" onClick={() => recaptureFigures([r])}
                                className="shrink-0 text-[10px] font-bold text-indigo-600 hover:underline"
                                title="Re-render THIS graph with the current Figure style and replace the saved figure automatically — the app opens the experiment for you.">
                                🔄 Recapture
                              </button>
                            ) : null}
                            {r.src && r.src.testId ? (
                              <button type="button" onClick={() => openOriginalGraph(r.src)}
                                className="shrink-0 text-[10px] font-bold text-blue-600 hover:underline"
                                title="Open the experiment and the exact graph this figure was captured from — apply the 🎨 Figure style there, then capture again.">
                                ↗ Open original graph
                              </button>
                            ) : null}
                          </>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="text-[10px] text-slate-400 leading-relaxed">
                A 📷 figure keeps the style it was rendered with: apply the 🎨 Figure style on the experiment page
                <i> before</i> capturing, then the figures of different experiments line up here.
              </p>
            </div>
          )}
        </div>

        {/* SVG Canvas (Normal View) */}
        <div className="border border-slate-300 rounded-lg bg-slate-100 p-2 flex justify-center overflow-auto">
          <div style={{ width: '100%', maxWidth: '800px', aspectRatio: `${canvasW} / ${canvasH + captionH}` }} className="bg-white shadow-md">
            {renderSvg(svgRef, 'in')}
          </div>
        </div>

        {/* Properties Panel (Normal View) */}
        {/* Properties Panel (Normal View) — the selected PANEL, or the selected
            ARROW annotation. The two are never selected at the same time: one
            properties panel is shown, for whatever the user clicked last. */}
        {selectedObj && <PropertiesPanel />}
        {!selectedObj && selectedArrow && (
          <ArrowPropertiesPanel arrow={selectedArrow} onChange={updateArrow} onDelete={() => removeArrow()} />
        )}
      </div>

      {/* Inline text editor — type directly on the canvas at the placed position */}
      {editingText && activeSvgEl() && (() => {
        const r = activeSvgEl().getBoundingClientRect();
        const x = r.left + (editingText.mmX / canvasW) * r.width;
        const y = r.top + (editingText.mmY / (canvasH + captionH)) * r.height;
        return createPortal(
          <input
            ref={textEditRef}
            value={editingText.value}
            autoFocus
            onChange={(e) => setTextValue(editingText.objId, editingText.txId, e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') stopEditing(); }}
            style={{ position: 'fixed', left: x, top: y - 18, zIndex: 999999, minWidth: 140, fontSize: 14 }}
            className="border-2 border-blue-500 rounded px-1.5 py-0.5 outline-none bg-white shadow-lg"
          />,
          document.body
        );
      })()}

      {/* Inline caption editor — write the figure caption directly at the bottom */}
      {editingCaption && activeSvgEl() && (() => {
        const r = activeSvgEl().getBoundingClientRect();
        const y = r.top + ((canvasH + captionH - 4) / (canvasH + captionH)) * r.height;
        return createPortal(
          <input
            ref={capEditRef}
            value={globalCaption}
            autoFocus
            placeholder={autoGlobalCaption || 'Type the figure caption here…'}
            onChange={(e) => setGlobalCaption(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditingCaption(false); }}
            style={{ position: 'fixed', left: r.left + r.width * 0.08, top: y - 20, width: r.width * 0.84, zIndex: 999999, fontSize: 14 }}
            className="border-2 border-blue-500 rounded px-1.5 py-0.5 outline-none bg-white shadow-lg"
          />,
          document.body
        );
      })()}

      {/* Inline PANEL sub-caption editor — opened with “✎ Edit in place” in the
          object properties (the caption is no longer drawn on the canvas).
          Closes on Enter / Escape or a real click outside — never on an
          internal re-render. */}
      {editingObjCaption && activeSvgEl() && (() => {
        const obj = objects.find(o => o.id === editingObjCaption);
        if (!obj) return null;
        const r = activeSvgEl().getBoundingClientRect();
        const xMm = (obj.x * cellW) + (obj.w * cellW) / 2;
        const yMm = (obj.y * cellH) + (obj.h * cellH) - 2;
        const left = r.left + (xMm / canvasW) * r.width;
        const top = r.top + (yMm / (canvasH + captionH)) * r.height;
        return createPortal(
          <textarea
            ref={objCapRef}
            value={obj.caption || ''}
            autoFocus
            rows={2}
            placeholder={`Sub-caption for panel ${obj.letter || '?'}`}
            onChange={(e) => setObjCaption(obj.id, e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) setEditingObjCaption(null); }}
            style={{ position: 'fixed', left: Math.max(8, Math.min(window.innerWidth - 380, left - 160)), top: Math.max(8, top - 48), width: 320, zIndex: 999999, fontSize: 13 }}
            className="border-2 border-blue-500 rounded px-2 py-1 outline-none bg-white shadow-lg"
          />,
          document.body
        );
      })()}

      {/* FULL SCREEN OVERLAY */}
      {isFullScreen && (
        <div className="fixed inset-0 z-[99999] bg-slate-100 flex flex-col">
          {/* Top Toolbar */}
          <div className="bg-white border-b border-slate-200 px-3 md:px-4 py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 shadow-sm z-10 shrink-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h3 className="font-bold text-slate-800">Image Builder</h3>
              <div className="flex flex-wrap items-center gap-2 bg-slate-100 rounded-lg px-3 py-1.5"
                title="Zoom of the fullscreen view. The canvas is drawn on a real, bigger sheet, so the scrollbars at the right / bottom (and the wheel) move it.">
                <button onClick={() => setZoomKeepingCenter(Math.max(0.1, +(zoom - 0.1).toFixed(1)))} className="w-6 h-6 flex items-center justify-center bg-white border border-slate-300 rounded text-slate-600 hover:bg-slate-50 font-bold">-</button>
                <input
                  type="range"
                  min="0.1"
                  max="8"
                  step="0.1"
                  value={zoom}
                  onChange={e => setZoomKeepingCenter(Number(e.target.value))}
                  className="w-24 md:w-32 accent-blue-600"
                />
                <button onClick={() => setZoomKeepingCenter(Math.min(8, +(zoom + 0.1).toFixed(1)))} className="w-6 h-6 flex items-center justify-center bg-white border border-slate-300 rounded text-slate-600 hover:bg-slate-50 font-bold">+</button>
                <span className="text-xs font-bold text-slate-600 w-12 text-center">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoomKeepingCenter(1)} className="text-xs font-bold text-blue-600 hover:underline ml-2">Reset</button>
                <button onClick={restoreInitialZoom} className="text-xs font-bold text-indigo-600 hover:underline ml-1" title="Zoom out to the initial zoom of this fullscreen session">↩ Initial zoom</button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => (focusObjId ? recenterFocus() : centerCanvas())}
                  className="text-xs font-bold px-2.5 py-1.5 rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                  title={focusObjId ? 'Re-centre the zoomed object in the viewport' : 'Centre the canvas in the viewport'}>
                  ◎ Center
                </button>
                <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg px-1.5 py-1" title="Scroll the canvas — exactly like the scrollbars and the mouse wheel">
                  <button onClick={() => nudgeArea(-30, 0)} className="w-5 h-5 bg-white border border-slate-300 rounded text-slate-600 hover:bg-slate-50 text-[10px]">←</button>
                  <button onClick={() => nudgeArea(0, -30)} className="w-5 h-5 bg-white border border-slate-300 rounded text-slate-600 hover:bg-slate-50 text-[10px]">↑</button>
                  <button onClick={() => nudgeArea(0, 30)} className="w-5 h-5 bg-white border border-slate-300 rounded text-slate-600 hover:bg-slate-50 text-[10px]">↓</button>
                  <button onClick={() => nudgeArea(30, 0)} className="w-5 h-5 bg-white border border-slate-300 rounded text-slate-600 hover:bg-slate-50 text-[10px]">→</button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                 <button onClick={addObject} title="Add a panel — it takes the FIRST FREE cell of the grid, so it never lands on a panel that is already there (a full grid is reported instead of covering a figure)." className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs">+ Add Object</button>
                 <button onClick={addArrow} title="Add an ARROW annotation on top of the panels — drag it to place it, drag a blue end handle to aim it; straight or curved, one head or heads at BOTH ends, with its own colour and drop shadow (“Arrow properties”)." className="bg-rose-600 hover:bg-rose-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs">↗ Add arrow{arrows.length ? ` (${arrows.length})` : ''}</button>
                 <button onClick={() => pasteClipboard()}
                   title={`Paste a copied panel (Ctrl+V): its figures, its texts and its shadows come back, into the FIRST FREE cell of the grid.${clipCount ? ` (${clipCount} panel${clipCount === 1 ? '' : 's'} copied)` : ' Copy a panel first: Ctrl+C on the canvas, or “⧉ Copy” in the object properties.'}`}
                   className={`font-bold px-3 py-1.5 rounded-lg text-xs border ${clipCount ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50' : 'bg-slate-100 border-slate-200 text-slate-400'}`}>📋 Paste{clipCount ? ` (${clipCount})` : ''}</button>
                 <button onClick={togglePanelsShadow} disabled={!objects.length} title="Drop shadow on every panel of the figure in one click — click again to take it off." className={`font-bold px-3 py-1.5 rounded-lg text-xs border disabled:opacity-40 ${panelsShadowed ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}>🌓 Shadow panels</button>
                 <button onClick={undo} disabled={!undoStack.current.length || histTick < 0} className="bg-slate-100 border border-slate-300 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-slate-200 disabled:opacity-40" title="Undo last change (Ctrl+Z)">↩ Undo</button>
                 <button onClick={() => { setPickMode('replace'); setShowLibrary(true); }}
                   title="Open the image library — browse or upload new images from your computer, and keep it in sync with Google Drive (☁ Save to Drive · ⬇ Add missing from Drive · ♻️ Recover)"
                   className="bg-teal-600 hover:bg-teal-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs">🖼 Library</button>
                 <label className="flex items-center gap-1 text-[11px] font-bold text-slate-600 bg-slate-100 rounded-lg px-2 py-1.5 cursor-pointer"
                   title="Draw a thin frame around every panel (composition setting — exports follow it).">
                   <input type="checkbox" checked={showPanelBorders} onChange={e => setShowPanelBorders(e.target.checked)} /> Borders
                 </label>
                 <label className="flex items-center gap-1 text-[11px] font-bold text-slate-600 bg-slate-100 rounded-lg px-2 py-1.5 cursor-pointer"
                   title="Canvas option: every figure keeps its own width/height ratio inside its panel (grid/canvas changes only rescale it, never stretch it). It overrides “Fit → Stretch”.">
                   <input type="checkbox" checked={keepAspect} onChange={e => setKeepAspect(e.target.checked)} /> 🔒 Ratio
                 </label>
                 <label className="flex items-center gap-1 text-[11px] font-bold text-slate-600 bg-slate-100 rounded-lg px-2 py-1.5 cursor-pointer"
                   title="Draw the cell divider guides across the canvas (composition setting — exports follow it).">
                   <input type="checkbox" checked={showGridLines} onChange={e => setShowGridLines(e.target.checked)} /> Grid
                 </label>
                 <label className="flex items-center gap-1 text-[11px] font-bold text-slate-600 bg-slate-100 rounded-lg px-2 py-1.5"
                   title="Size of the panel letters (A, B, C …). It is a FIGURE setting: it rescales every letter of the canvas at once — not one panel at a time.">
                   Letters
                   <input type="number" min="4" max="48" value={letterPt} onChange={e => setLetterSizeAll(e.target.value)} className="border border-slate-300 rounded px-1 py-0.5 text-[11px] w-14 bg-white font-normal" />
                   pt
                 </label>
                 <button onClick={exportPng} title="PNG of the composition — the blue selection square and resize handles are never included; panel borders and grid lines follow the checkboxes." className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs">Export PNG</button>
              </div>
            </div>
            <button onClick={() => { setFocusObjId(null); setIsFullScreen(false); }} className="shrink-0 bg-slate-800 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-slate-700 flex items-center gap-2">
              ✕ Exit Full Screen
            </button>
          </div>

          {/* Canvas Area — a REAL scrollable sheet: the inner box is canvas × zoom
              big, so the browser draws its own scrollbars (and the wheel works)
              instead of a transform that leaves nothing to scroll. */}
          <div ref={fsAreaRef} className="flex-1 min-h-0 overflow-auto relative bg-slate-200 p-8" onClick={() => { setSelectedId(null); setSelectedArrowId(null); }}>
            <div
              style={{
                width: `calc(${canvasW}mm * ${zoom})`,
                height: `calc(${canvasH + captionH}mm * ${zoom})`
              }}
              className="relative"
            >
              <div
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: '0 0',
                  width: `${canvasW}mm`,
                  height: `${canvasH + captionH}mm`
                }}
                className="absolute top-0 left-0 shadow-2xl bg-white"
              >
                {renderSvg(svgFsRef, 'fs')}
              </div>
            </div>
          </div>

          {/* Floating Properties Panel — of the selected panel, or of the
              selected arrow annotation. */}
          {(selectedObj || selectedArrow) && (
            <div className="absolute right-4 bottom-4 md:top-16 md:bottom-4 w-80 z-20 max-h-[55vh] overflow-y-auto custom-scrollbar md:max-h-none md:overflow-visible">
              {selectedObj
                ? <PropertiesPanel isFloating />
                : <ArrowPropertiesPanel arrow={selectedArrow} isFloating onChange={updateArrow} onDelete={() => removeArrow()} />}
            </div>
          )}
        </div>
      )}

      {/* Library Modal */}
      {showLibrary && (
        <div className="fixed inset-0 bg-black/50 z-[100000] flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col">
            <div className="p-4 border-b flex justify-between items-center">
              <h3 className="font-bold text-lg">{selectedObj ? `Select Image — ${pickMode === 'add' ? `add another figure${selectedObj.letter ? ` (panel ${selectedObj.letter})` : ''}` : 'replace figure'}` : 'Image Library'}</h3>
              <button onClick={() => setShowLibrary(false)}>✕</button>
            </div>
            <div className="p-4 border-b flex flex-wrap gap-3 items-center">
              <div className="flex gap-2">
                <button className={`px-3 py-1 rounded font-bold text-xs ${libraryTab === 'project' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}
                  onDragOver={(e) => { if (libDragRef.current && libDragRef.current.scope !== 'project') { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
                  onDrop={dropOnLibTab('project')}
                  title="The project library — and a DROP TARGET: drag a thumbnail from the Dataset Library onto this tab to move that image into the project library"
                  onClick={() => { setLibraryTab('project'); setLibMsg(''); }}>Project Library</button>
                <button className={`px-3 py-1 rounded font-bold text-xs ${libraryTab === 'common' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}
                  onDragOver={(e) => { if (libDragRef.current && libDragRef.current.scope !== 'common') { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
                  onDrop={dropOnLibTab('common')}
                  title="The shared dataset library — and a DROP TARGET: drag a thumbnail from the Project Library onto this tab to move that image into the shared library"
                  onClick={() => { setLibraryTab('common'); setLibMsg(''); }}>Dataset Library</button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => libFileRef.current && libFileRef.current.click()}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded text-xs flex items-center gap-1"
                  title="Import image file(s) from your computer into the library currently shown (Project or Dataset)."
                >
                  ⬆ Upload from PC
                </button>
                <input ref={libFileRef} type="file" accept="image/*,.svg" multiple className="hidden" onChange={handleLibUpload} />
                <button
                  type="button"
                  onClick={startNewImage}
                  className="bg-amber-500 hover:bg-amber-600 text-white font-bold px-3 py-1.5 rounded text-xs flex items-center gap-1"
                  title="Nothing in the library fits? Close it and start a NEW image (a blank canvas with one empty panel). The figure you were working on stays in the library as it was last saved, and the next “💾 Save canvas” creates a new library entry."
                >
                  ➕ New image
                </button>
              </div>
              {/* ☁ ⇄ ♻️ the library against Drive / a backup — the three ADDITIVE
                  gestures. They used to live only in the “Image library” panel of
                  Figures & Slides, which nobody opens from here: “my images are
                  not on Drive” had no button anywhere in this window. */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={libSaveToDrive}
                  disabled={libDriveBusy}
                  className="bg-sky-50 border border-sky-300 text-sky-700 hover:bg-sky-100 font-bold px-3 py-1.5 rounded text-xs disabled:opacity-50"
                  title="Send to Google Drive the images of the library currently shown whose pixels are still only in this browser (they would not follow you on another computer). Nothing is deleted."
                >
                  ☁ Save to Drive{localOnlyLibraryItems(libraryItems).length ? ` (${localOnlyLibraryItems(libraryItems).length})` : ''}
                </button>
                <button
                  type="button"
                  onClick={libAddMissingFromDrive}
                  disabled={libDriveBusy}
                  className="bg-emerald-50 border border-emerald-300 text-emerald-700 hover:bg-emerald-100 font-bold px-3 py-1.5 rounded text-xs disabled:opacity-50"
                  title="Read this library’s images folder on Google Drive and ADD the figures it contains but this list does not show (e.g. after switching computer). Nothing is replaced."
                >
                  {libDriveBusy ? '⏳ Working…' : '⬇ Add missing from Drive'}
                </button>
                <button
                  type="button"
                  onClick={() => libRecoverFileRef.current && libRecoverFileRef.current.click()}
                  className="bg-amber-50 border border-amber-300 text-amber-700 hover:bg-amber-100 font-bold px-3 py-1.5 rounded text-xs"
                  title="Images missing on this computer? The image files are on Drive, but the LIST that shows them lives in the browser. Read a backup file here to add the missing images back — only the image list is read, nothing is deleted."
                >
                  ♻️ Recover
                </button>
                <input ref={libRecoverFileRef} type="file" accept=".html,.htm,.json,.txt" className="hidden"
                  onChange={(e) => { const f = (e.target.files || [])[0]; e.target.value = ''; libRecoverFromBackup(f); }} />
              </div>
              {selectedObj && (
                <div className="flex gap-1 ml-auto" title="Replace: the selected object shows only this figure. Add: appends the figure to the selected object so several figures share one panel.">
                  <button className={`px-3 py-1 rounded font-bold text-xs ${pickMode === 'replace' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`} onClick={() => setPickMode('replace')}>↺ Replace</button>
                  <button className={`px-3 py-1 rounded font-bold text-xs ${pickMode === 'add' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`} onClick={() => setPickMode('add')}>➕ Add</button>
                </div>
              )}
              {/* The project list is shown in BOTH tabs: on the Project tab it picks
                  the library being browsed, on the Dataset tab the project the ⇄ of
                  a dataset image moves the figure INTO. Without it the transfer had
                  to guess (the project this editor was opened with, or the
                  unassigned scope when there is none) and the figure vanished. */}
              <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500"
                title={libraryTab === 'project'
                  ? 'Only the projects of your team are listed: the figures of a project are visible to the people who have access to that project (its owner and its authorized people). “Current / no project” browses the figures stored without a project.'
                  : 'The project an image of the dataset library is moved into with ⇄ — its Project tab and that project page’s “🖼 Saved canvases”. A project you may only read is marked 🔒 and refuses the move.'}>
                {libraryTab === 'project' ? 'Project' : 'Move into'}
                <select value={activeLibProjectId || 'global'} onChange={(e) => setLibProjectId(e.target.value === 'global' ? null : e.target.value)}
                  className="border border-slate-300 rounded px-2 py-1 text-xs bg-white max-w-[240px]">
                  <option value="global">{libraryTab === 'project' ? 'Current / no project' : '— pick a project —'}</option>
                  {myProjects.map((p) => <option key={p.id} value={p.id}>{p.name}{canWriteLibProject(p.id) ? '' : ' 🔒 read-only'}</option>)}
                </select>
              </label>
              {pickMode === 'add' && (
                <span className="text-[10px] font-bold text-indigo-700">Click figures to add them to this panel — the window stays open so you can add several. The figures already in the panel keep exactly their place.</span>
              )}
              <span className="w-full text-[10px] text-slate-400">
                Drag a thumbnail onto <b>another one</b> to change its place in the library, or onto the <b>other library tab</b> (Project Library ⇄ Dataset Library) to move the image into that library.
              </span>
              {libMsg && (
                <div className="w-full text-[11px] font-bold text-emerald-700">{libMsg}</div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-4 grid grid-cols-3 md:grid-cols-4 gap-4 min-h-0">
              {libraryItems.length === 0 && (
                <p className="col-span-full text-center text-slate-400 italic">
                  {libProjectBlocked
                    ? '🔒 This project’s figures are private to its team.'
                    : 'No images in this library yet.'}
                  {!libProjectBlocked && (
                    <span className="block mt-1 not-italic text-[11px] text-slate-400">
                      The image files are on Google Drive (<code>projects/&lt;project&gt;/images</code>) — this LIST lives in
                      this browser and travels inside every backup file. Use <b>⬇ Add missing from Drive</b> above to fetch
                      the figures this list does not show yet, <b>☁ Save to Drive</b> for the ones only in this browser, or
                      <b> ♻️ Recover</b> to read a backup file.
                    </span>
                  )}
                </p>
              )}
              {libraryItems.map(item => (
                <div key={item.id} draggable
                  onDragStart={(e) => {
                    libDragRef.current = { id: item.id, scope: libScopeOf(), projectId: libScopeProjectId() };
                    e.dataTransfer.effectAllowed = 'move';
                    try { e.dataTransfer.setData('text/plain', item.id); } catch { /* browser without dataTransfer */ }
                    setLibOver('');
                  }}
                  onDragEnd={() => { libDragRef.current = null; setLibOver(''); }}
                  onDragOver={(e) => {
                    if (!libDragRef.current || libDragRef.current.id === item.id) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (libOver !== item.id) setLibOver(item.id);
                  }}
                  onDragLeave={() => { if (libOver === item.id) setLibOver(''); }}
                  onDrop={dropOnLibCard(item)}
                  className={`border rounded-lg p-2 cursor-pointer flex flex-col items-center transition-all ${libOver === item.id ? 'border-blue-600 ring-2 ring-blue-200 bg-blue-50' : 'hover:border-blue-500 hover:shadow-md'}`}
                  title="Click to place this image on the selected panel • drag it onto another thumbnail to change its place in the list, or onto the other library tab to move it there"
                  onClick={() => (pickMode === 'add' ? handleAddImage(item) : handlePickImage(item))}>
                  <img src={item.url} alt={item.label} className="w-full h-24 object-contain bg-slate-50 rounded" />
                  <span className="text-xs mt-1 truncate w-full text-center font-bold">{item.label}</span>
                  {item.canvasData && (
                    <span className="text-[9px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5 mt-0.5" title="This library item is a saved Image Builder canvas — click ↩ Load to restore it into the editor (clicking the image still adds it as a figure)">
                      🖼 canvas
                    </span>
                  )}
                  <div className="flex items-center gap-1 mt-0.5 flex-wrap justify-center">
                    {item.canvasData && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); restoreCanvasFromItem(item, { scopeProjectId: libraryTab === 'project' ? activeLibProjectId : null }); }}
                        className="text-[9px] font-bold text-amber-700 hover:text-amber-900 border border-amber-300 rounded px-1.5 py-0.5 hover:bg-amber-50"
                        title="Load this saved canvas into the editor (replaces the current canvas) — it stays linked to this library entry, so saving it again updates it here">
                        ↩ Load
                      </button>
                    )}
                    <button type="button" onClick={(e) => { e.stopPropagation(); renameLib(item.id); }}
                      className="text-[9px] font-bold text-slate-500 hover:text-blue-600 border border-slate-200 rounded px-1.5 py-0.5 hover:border-blue-300" title="Rename this image">✎</button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); deleteLib(item.id); }}
                      className="text-[9px] font-bold text-red-400 hover:text-red-600 border border-slate-200 rounded px-1.5 py-0.5 hover:border-red-300" title="Delete this image from the library">🗑</button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); transferItem(item); }}
                      className="text-[9px] font-bold text-slate-500 hover:text-blue-600 border border-slate-200 rounded px-1.5 py-0.5 hover:border-blue-300"
                      title={libraryTab === 'project'
                        ? 'Move this image to the shared dataset library (Image Library → Dataset tab)'
                        : activeLibProjectId
                          ? `Move this image into the “${canvasScopeName(activeLibProjectId)}” project library (its Project tab — and that project page’s “🖼 Saved canvases”)`
                          : 'Pick a project in the “Move into” list above, then click ⇄ to store this image in that project’s library'}>
                      ⇄
                    </button>
                  </div>
                  <span className="text-[8px] text-emerald-600 font-bold">High-Res</span>
                  {item.src && item.src.testName && <span className="text-[8px] text-sky-500 truncate w-full text-center">↗ {item.src.testName}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* Insert composition into a project text subsection */}
      {insertOpen && (
        <div className="fixed inset-0 bg-black/50 z-[100000] flex items-center justify-center p-4" onClick={() => setInsertOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md flex flex-col gap-3 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-lg">📤 Insert composition into a project section</h3>
              <button onClick={() => setInsertOpen(false)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <label className="text-[10px] font-bold text-slate-500 flex flex-col gap-1">Project
              <select value={insertTarget.projectId} onChange={(e) => setInsertTarget({ ...insertTarget, projectId: e.target.value })}
                className="border border-slate-300 rounded px-2 py-1.5 text-xs bg-white">
                {myWritableProjects.length === 0 && <option value="">No project you can edit</option>}
                {myWritableProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="text-[10px] font-bold text-slate-500 flex flex-col gap-1">Text subsection
              <select value={insertTarget.section} onChange={(e) => setInsertTarget({ ...insertTarget, section: e.target.value })}
                className="border border-slate-300 rounded px-2 py-1.5 text-xs bg-white">
                <option value="background">Background</option>
                <option value="discussion">Results and Discussion</option>
                <option value="conclusions">Conclusions</option>
                <option value="funding">Funding</option>
                <option value="supporting">Supporting information</option>
              </select>
            </label>
            <label className="text-[10px] font-bold text-slate-500 flex flex-col gap-1">Caption (written at the bottom of the image)
              <span className="border border-slate-200 rounded px-2 py-1.5 text-xs bg-slate-50 text-slate-600">{effectiveGlobalCaption || '— click the caption at the bottom of the canvas to write it —'}</span>
            </label>
            <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded p-2">
              The composition is inserted <span className="font-bold">as an image</span>: it stays visible in that section on
              the project page (and in the exported document) exactly like any other figure — nothing is replaced by a link.
              The canvas itself is also kept in <span className="font-bold">that project's image library</span> (🖼 Image
              Library → Project tab, and the project page's 🖼 Saved canvases) so the composition can be reopened in this
              editor later.
            </p>
            <label className="text-[10px] font-bold text-slate-500 flex items-start gap-2 cursor-pointer"
                   title="Additionally stores this composition as a canvas of that project's image library (Image Library → Project tab + project page “🖼 Saved canvases”) and links the inserted image to it, so the project page can offer “✏️ Modify in Image Builder” to reopen this very composition (re-saving it updates that same library entry). Uncheck to insert the picture only.">
              <input type="checkbox" className="mt-0.5" checked={insertLink} onChange={(e) => setInsertLink(e.target.checked)} />
              <span>🔗 Also keep this canvas in that project's image library and link the inserted image to it (adds “✏️ Modify in Image Builder” on the project page) — uncheck to insert the picture only</span>
            </label>
            {insertMsg && <p className={`text-xs font-bold ${insertMsg.startsWith('✅') ? 'text-green-600' : 'text-red-500'}`}>{insertMsg}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setInsertOpen(false)} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">Cancel</button>
              <button
                onClick={async () => {
                  if (!insertTarget.projectId) { setInsertMsg('⚠️ Choose a project first.'); return; }
                  // Inserting writes a figure into that project (and, when the link
                  // is on, a canvas into its image library): edit access required.
                  if (!canWriteLibProject(insertTarget.projectId)) { setInsertMsg('🔒 You do not have edit access to that project.'); return; }
                  const dataUrl = await renderToDataUrl(Math.max(3, 1800 / canvasW));
                  if (!dataUrl) { setInsertMsg('⚠️ Could not render the composition.'); return; }
                  const projects = loadProjects();
                  const prj = projects.find((p) => p.id === insertTarget.projectId);
                  if (!prj) { setInsertMsg('⚠️ Project not found.'); return; }
                  const sec = insertTarget.section || 'background';
                  // The image is what the project keeps (it is pushed below as a
                  // normal figure, so it stays visible in that section and in the
                  // exported document). ADDITIONALLY the composition is published
                  // as a canvas of the TARGET project's image library (the one
                  // the project page reads) and the figure stores that entry id,
                  // so the page can offer “✏️ Modify in Image Builder”.
                  // Re-saving the canvas updates that same entry — and inserting
                  // the same composition twice into one project reuses it instead
                  // of adding a second copy to that library.
                  let link = null;
                  if (insertLink) {
                    try {
                      const label = canvasLabel || (effectiveGlobalCaption && String(effectiveGlobalCaption).trim()
                        ? `Figure — ${String(effectiveGlobalCaption).trim().slice(0, 60)}`
                        : `Canvas ${new Date().toLocaleDateString()}`);
                      const pub = await publishCanvas({ label, targetProjectId: prj.id, dataUrl });
                      if (pub && pub.entry) {
                        link = { canvasId: pub.entry.id, builderProjectId: prj.id, canvasLabel: pub.entry.label || label };
                      }
                    } catch (err) {
                      console.warn('Canvas link failed:', err && err.message);
                    }
                  }
                  prj.figures = prj.figures || {};
                  prj.figures[sec] = prj.figures[sec] || [];
                  prj.figures[sec].push({
                    id: genProjectId(),
                    url: dataUrl,
                    caption: effectiveGlobalCaption || `Image Builder composition (${new Date().toLocaleDateString()})`,
                    addedAt: new Date().toISOString(),
                    source: 'image-builder',
                    ...(link || {})
                  });
                  saveProjects(projects);
                  setInsertMsg(link
                    ? `✅ The image is now shown in "${prj.name}" → ${sec} (it stays there). 🔗 Its canvas was stored in that project's image library, so the project page offers “✏️ Modify in Image Builder” to reopen this composition.`
                    : `✅ The image is now shown in "${prj.name}" → ${sec} (it stays there). No canvas link was stored (the checkbox is off).`);
                }}
                className="bg-violet-600 hover:bg-violet-700 text-white font-bold px-4 py-1.5 rounded-lg text-xs"
              >Insert</button>
            </div>
          </div>
        </div>
      )}

      {/* Save the composition in the image library — the dialog asks WHERE, so a
          canvas can be stored in the project section of the library even when
          the Image Builder was opened without a project (or in another one). */}
      {saveOpen && (
        <div className="fixed inset-0 bg-black/50 z-[100001] flex items-center justify-center p-4"
             onClick={() => { if (!saveBusy) setSaveOpen(false); }}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md flex flex-col gap-3 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-lg">💾 Save canvas in the image library</h3>
              <button onClick={() => setSaveOpen(false)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <label className="text-[10px] font-bold text-slate-500 flex flex-col gap-1">Canvas name
              <input value={saveName} onChange={(e) => setSaveName(e.target.value)} autoFocus
                className="border border-slate-300 rounded px-2 py-1.5 text-xs font-normal text-slate-700 outline-none focus:border-amber-500"
                placeholder="Figure — …" />
            </label>
            <label className="text-[10px] font-bold text-slate-500 flex flex-col gap-1">Save in
              <select value={saveDest} onChange={(e) => { setSaveDest(e.target.value); setSaveMsg(''); }}
                className="border border-slate-300 rounded px-2 py-1.5 text-xs bg-white font-normal text-slate-700">
                <option value="">🌐 Dataset library — shared by every project (Image Library → Dataset tab)</option>
                {myWritableProjects.map((p) => <option key={p.id} value={p.id}>📁 {p.name} — its Project tab + “🖼 Saved canvases”</option>)}
              </select>
            </label>
            <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded p-2">
              {saveDest
                ? <>The whole composition is stored as an image in <span className="font-bold">“{canvasScopeName(saveDest)}”</span>'s library
                    (<span className="font-bold">Image Library → Project</span> tab) and listed on that project page under
                    <span className="font-bold"> “🖼 Saved canvases”</span>, where it reopens in this editor. Figures inserted into that
                    project's sections keep showing the image itself.</>
                : <>The composition is stored as an image in the <span className="font-bold">shared dataset library</span>
                    (<span className="font-bold">Image Library → Dataset</span> tab), available to every project.</>}
            </p>
            {homeEntry && canvasScopeKey(saveDest) !== canvasScopeKey(canvasHome) && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                ⚠️ This canvas is already saved in {canvasScopeName(canvasHome)}. Saving it here stores a
                <span className="font-bold"> copy</span> in the new place; each place keeps its own entry, and “💾 Save canvas”
                always updates the copy of the destination you pick.
              </p>
            )}
            {saveMsg && <p className={`text-xs font-bold ${saveMsg.startsWith('✅') ? 'text-green-600' : 'text-slate-600'}`}>{saveMsg}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setSaveOpen(false)} disabled={saveBusy}
                className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40">Cancel</button>
              <button onClick={doSaveCanvas} disabled={saveBusy}
                className="bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white font-bold px-4 py-1.5 rounded-lg text-xs">
                {saveBusy ? '⏳ Saving…' : '💾 Save canvas'}
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
};