import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  readLibrary, readProjectLibrary, moveLibraryItem,
  renameLibraryItem, removeLibraryItem, renameProjectLibraryItem, removeProjectLibraryItem,
  blobToDataUrl, publishLibraryFigure, resolveImageToDataUrl, localStorageHealthy
} from '../utils/figuresLibrary';
import { loadProjects, saveProjects, genProjectId } from './AppModules/projectsModule';
import { queuePendingFigureScroll } from '../utils/pendingFigureScroll';

const ptToMm = (pt) => pt * 0.352778;
const PX_PER_MM = 96 / 25.4; // CSS: 1 mm ≈ 3.78 px

// In-memory session cache of the Image Builder state (keyed like the
// localStorage entry). The canvas is persisted to localStorage too, but large
// full-resolution figures can blow past the quota and make setItem silently
// fail — the in-memory copy always survives, so navigating to the original
// graph and back NEVER loses the user's edits within this session.
const imageBuilderSessionCache = new Map();

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

// Natural width/height ratio of every figure already measured, keyed by source
// (data URL / Drive URL). The canvas "🔒 Keep aspect ratio" option draws each
// figure with its own ratio inside its panel, so the ratio has to be known
// before the geometry can be computed.
const imageAspectCache = new Map();
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
    const settle = (src, aspect) => {
      imageAspectCache.set(src, aspect);
      left -= 1;
      if (!cancelled && left === 0) setTick((t) => t + 1);
    };
    pending.forEach((src) => {
      const img = new Image();
      img.onload = () => settle(src, img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0);
      img.onerror = () => settle(src, 0);
      img.src = src;
    });
    return () => { cancelled = true; };
  }, [srcs]);
  return tick;
};

export const ImageBuilder = ({ projectId, jumpToTest, openCanvasId = null, onCanvasOpened, onBackToProject }) => {
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
  const initialPanRef = useRef({ x: 0, y: 0 });
  const undoStack = useRef([]);     // undo history of the canvas objects
  const [histTick, setHistTick] = useState(0);

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
  const [selectedId, setSelectedId] = useState(null);
  const [hydrateTick, setHydrateTick] = useState(0); // bumped to async-fetch Drive-backed images onto the canvas
  const objectsRef = useRef(objects);
  objectsRef.current = objects;

  const [showLibrary, setShowLibrary] = useState(false);
  const [pickMode, setPickMode] = useState('replace'); // 'replace' | 'add' — how a library click affects the selected object
  const [libraryTab, setLibraryTab] = useState('project');
  const [libVersion, setLibVersion] = useState(0); // forces a re-read of the library lists after a transfer
  const [libProjectId, setLibProjectId] = useState(null); // which project's library to browse (null = the active one)
  const [libMsg, setLibMsg] = useState('');       // transient feedback after a PC upload / transfer
  const libFileRef = useRef(null);                // hidden <input type=file> for uploading images from the PC
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
  // sub-caption (merged), unless the user typed a custom one directly on the canvas.
  const autoGlobalCaption = (objects || []).filter((o) => String(o.caption || '').trim())
    .map((o) => `${o.letter || '?'}: ${String(o.caption).trim()}`).join(' · ');
  const effectiveGlobalCaption = String(globalCaption || '').trim() ? globalCaption : autoGlobalCaption;
  const captionH = (effectiveGlobalCaption.trim() || editingCaption) ? 14 : 0; // reserved caption band (mm)

  // The SVG that is actually visible (fullscreen overlay when open).
  const activeSvgEl = () => (isFullScreen ? svgFsRef : svgRef).current;

  // Fullscreen & Zoom states
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [zoom, setZoom] = useState(1.5); // Start at 150% for better visibility
  const [panX, setPanX] = useState(0);   // fullscreen canvas pan (px) — used by "zoom on object"
  const [panY, setPanY] = useState(0);
  const [focusObjId, setFocusObjId] = useState(null); // object zoomed on (persisted so "◀ Back" restores it)

  // Load persisted state — the in-memory session cache (freshest, immune to the
  // localStorage quota) wins; localStorage is the fallback / cross-reload source.
  useEffect(() => {
    try {
      const saved = imageBuilderSessionCache.get(storageKey) || (() => {
        try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { return null; }
      })();
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
          // Only the small thumbnail is persisted; re-resolve the full-resolution
          // image from its library entry so the canvas never exceeds the
          // localStorage quota (and the object does not "disappear" after the
          // user navigates to the original graph and back). Works for both the
          // legacy single-image objects and the new multi-figure `images[]`.
          setObjects((data.objects || []).map((o) => {
            if (!o.libId && !(o.images || []).some((im) => im && im.libId)) return o;
            return resolveObj(o);
          }));
          setHydrateTick((t) => t + 1);
        }
        if (data.globalCaption !== undefined) setGlobalCaption(data.globalCaption);
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
      const payload = { canvasW, canvasH, gridCols, gridRows, showPanelBorders, showGridLines, keepAspect, objects: persisted, focusObjId, globalCaption, isFullScreen };
      // Always keep the freshest copy in memory (survives module remounts even
      // when localStorage is full), then best-effort write localStorage.
      imageBuilderSessionCache.set(storageKey, payload);
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch { /* localStorage may be full — the session cache above still holds the state */ }
  }, [canvasW, canvasH, gridCols, gridRows, showPanelBorders, showGridLines, keepAspect, objects, focusObjId, globalCaption, isFullScreen, storageKey]);

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
  const commitHistory = () => {
    try {
      const snap = JSON.parse(JSON.stringify((objects || []).map(thumbnailsOf)));
      undoStack.current.push(snap);
      if (undoStack.current.length > 40) undoStack.current.shift();
      setHistTick((t) => t + 1);
    } catch { /* ignore */ }
  };
  const undo = () => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    setObjects(prev.map(resolveObj));
    setSelectedId(null);
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

  const addObject = () => {
    const id = `obj_${Date.now()}`;
    commitHistory();
    const nextLetter = objects.length < 26 ? String.fromCharCode(65 + objects.length) : `${objects.length + 1}`;
    const newObj = {
      id, x: 0, y: 0, w: 1, h: 1,
      letter: nextLetter,
      letterStyle: { fontSize: 14, color: '#000000', bold: true },
      caption: '',
      captionStyle: { fontSize: 10, color: '#000000', bold: false }, // kept for canvases saved before the panel caption was hidden (never drawn)
      imgSrc: null, imgFit: 'contain', imgScale: 1, imgPadding: 2,
      imgOffsetX: 0, imgOffsetY: 0,  // shift the image inside the object frame (mm)
      imgRotate: 0,                   // image rotation (degrees)
      texts: [],                      // free text overlays [{ id, x, y, text, fontSize, color, bold, italic }]
      src: null,                      // { testId, testName, elementLabel } — link back to the original graph
      images: [],                     // extra figures inside this same object/panel (multi-figure montage)
      imgCols: 2                      // grid columns when the object holds several figures
    };
    setObjects([...objects, newObj]);
    setSelectedId(id);
    renumberLetters();
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
    const driveProject = scope === 'project' && activeLibProjectId
      ? (allProjects.find((p) => p.id === activeLibProjectId) || null)
      : null;
    const driveProjectName = driveProject ? String(driveProject.name || '') : '';
    const driveFolderLabel = driveProjectName ? `projects/${driveProjectName.trim()}/images` : 'projects/_unassigned/images';
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

  // Add mode: append another figure to the selected object — every figure
  // already in the panel is kept, so several figures share one lettered panel.
  const handleAddImage = async (item) => {
    commitHistory();
    const fullSrc = item.full || item.url;
    const resolved = await resolveImageToDataUrl(fullSrc).catch(() => fullSrc);
    const src = String(resolved || '').startsWith('data:')
      ? resolved
      : (item.url && String(item.url).startsWith('data:') ? item.url : resolved);
    setObjects(prev => prev.map(o => {
      if (o.id !== selectedId) return o;
      return withImages(o, [...getObjImages(o), {
        imgSrc: src,
        imgThumb: (item.url && String(item.url).startsWith('data:')) ? item.url : src,
        libScope: libraryTab,
        libProjectId: libraryTab === 'project' ? activeLibProjectId : null,
        libId: item.id,
        src: item.src || null,
        dx: 0, dy: 0, scale: 1
      }]);
    }));
    // The library modal stays open so several figures can be added in a row.
  };

  // Remove one figure from the selected multi-figure object.
  const removeObjImage = (idx) => {
    commitHistory();
    setObjects(prev => prev.map(o => o.id === selectedId ? withImages(o, getObjImages(o).filter((_, i) => i !== idx)) : o));
  };

  // ---- Multi-figure selection inside overlapping figures ---------------------
  // Figures of one object are laid out in a grid but can be dragged out of their
  // cell (dx/dy) and OVERLAP. SVG hit-testing always grabs the top figure, so a
  // dedicated "active figure" + click-cycling lets the user reach the one
  // underneath: each click on an overlapping spot moves the active figure to the
  // next one below. Only the active figure shows the move/resize handles, drawn
  // ON TOP so it is always grabbable.
  const [activeFig, setActiveFig] = useState(null); // { objId, idx }
  const suppressCycleRef = useRef(false);           // a drag just happened → the trailing click must NOT cycle

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
    const figScale = (obj.imgScale || 1) * (im.scale || 1);
    let iW = (cw - pad * 2) * figScale;
    let iH = (ch - pad * 2) * figScale;
    /* Canvas option "🔒 Keep aspect ratio": the figure is drawn with its OWN
       width/height ratio inside its panel instead of being stretched to the
       panel cell — so changing the number of panels (grid) or the canvas
       dimensions only rescales it. When the ratio is not known yet (figure
       still loading / unreachable) the cell is used, which is harmless because
       the <image> is rendered with preserveAspectRatio="meet" anyway. */
    const aspect = keepAspect ? (imageAspectCache.get(im.imgSrc) || 0) : 0;
    if (aspect > 0 && iW > 0 && iH > 0) {
      if (iW / iH > aspect) iW = iH * aspect;
      else iH = iW / aspect;
    }
    const cellX = obj.x * cellW + (i % cols) * cw;
    const cellY = obj.y * cellH + Math.floor(i / cols) * ch;

    return {
      iX: cellX + pad + (cw - pad * 2 - iW) / 2 + (obj.imgOffsetX || 0) + (im.dx || 0),
      iY: cellY + pad + (ch - pad * 2 - iH) / 2 + (obj.imgOffsetY || 0) + (im.dy || 0),
      iW, iH
    };
  };

  // Figure indices whose bounds contain the point (mm, absolute), topmost first.
  const figuresAt = (obj, xMm, yMm) => {
    const imgs = getObjImages(obj);
    const hits = [];
    imgs.forEach((im, i) => {
      if (!im || !im.imgSrc) return;
      const g = objFigureGeom(obj, i);
      if (xMm >= g.iX && xMm <= g.iX + g.iW && yMm >= g.iY && yMm <= g.iY + g.iH) hits.push(i);
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
  const transferItem = (item) => {
    const from = libraryTab; // 'project' | 'common'
    const to = from === 'project' ? 'common' : 'project';
    moveLibraryItem(from, to, libraryTab === 'project' ? activeLibProjectId : projectId, item.id);
    setLibVersion((v) => v + 1);
  };

  // Rename / delete a library image.
  const renameLib = (id) => {
    const current = (libraryTab === 'project' ? readProjectLibrary(activeLibProjectId) : readLibrary()).find((i) => i.id === id);
    const name = window.prompt('Image label:', (current && current.label) || '');
    if (name && name.trim()) {
      if (libraryTab === 'project') renameProjectLibraryItem(activeLibProjectId, id, name.trim());
      else renameLibraryItem(id, name.trim());
      setLibVersion((v) => v + 1);
    }
  };
  const deleteLib = (id) => {
    if (!window.confirm('Delete this image from the library?')) return;
    if (libraryTab === 'project') removeProjectLibraryItem(activeLibProjectId, id);
    else removeLibraryItem(id);
    setLibVersion((v) => v + 1);
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
    const img = dataUrl || await renderToDataUrl(Math.max(3, 1800 / Math.max(1, canvasW)));
    if (!img) return null;
    const target = targetProjectId || null;
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
        objects: (objects || []).map(thumbnailsOf)
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
      if (!pub || !pub.entry) { setSaveMsg('⚠️ Could not save the canvas in the library.'); return; }
      const what = pub.updated ? 'updated' : 'saved';
      const where = destProjectId
        ? `in the “${canvasScopeName(destProjectId)}” image library (Image Library → Project tab — and on that project page under “🖼 Saved canvases”, where it reopens here)`
        : 'in the shared dataset image library (Image Library → Dataset tab)';
      const folderLabel = destProjectId ? `projects/${canvasScopeName(destProjectId).trim()}/images` : 'projects/_unassigned/images';
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
    setSelectedId(null);
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
    dragState.current = { type: 'move', id, startX: e.clientX, startY: e.clientY, origX: obj.x, origY: obj.y };
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', endDrag);
  };

  const startResize = (e, id) => {
    e.stopPropagation();
    commitHistory();
    const obj = objects.find(o => o.id === id);
    dragState.current = { type: 'resize', id, startX: e.clientX, startY: e.clientY, origW: obj.w, origH: obj.h, origX: obj.x, origY: obj.y };
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

    // Move ONE figure of a multi-figure object independently (drag the figure).
    if (type === 'figMove') {
      setObjects(prev => prev.map(o => {
        if (o.id !== id || !Array.isArray(o.images)) return o;
        return { ...o, images: o.images.map((im, i) => i === imgIdx ? { ...im, dx: +(origX + dxMm).toFixed(2), dy: +(origY + dyMm).toFixed(2) } : im) };
      }));
      return;
    }

    // Resize ONE figure of a multi-figure object (drag its corner handle).
    if (type === 'figResize') {
      setObjects(prev => prev.map(o => {
        if (o.id !== id || !Array.isArray(o.images)) return o;
        const figW = Math.max(10, (o.w * cellW) / Math.max(1, o.imgCols || 2));
        const factor = Math.max(0.3, Math.min(4, 1 + dxMm / figW));
        return { ...o, images: o.images.map((im, i) => i === imgIdx ? { ...im, scale: +(origScale * factor).toFixed(3) } : im) };
      }));
      return;
    }

    // Dragging the image inside its frame → shift it (mouse pan).
    if (type === 'imgShift') {
      setObjects(prev => prev.map(o => {
        if (o.id !== id) return o;
        return { ...o, imgOffsetX: +(origX + dxMm).toFixed(2), imgOffsetY: +(origY + dyMm).toFixed(2) };
      }));
      return;
    }

    // Dragging the image resize handle → resize the image by drag & drop.
    if (type === 'imgResize') {
      setObjects(prev => prev.map(o => {
        if (o.id !== id) return o;
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

    setObjects(prev => prev.map(o => {
      if (o.id !== id) return o;
      if (type === 'move') {
        return { ...o, x: Math.max(0, Math.min(gridCols - o.w, origX + dCols)), y: Math.max(0, Math.min(gridRows - o.h, origY + dRows)) };
      } else {
        return { ...o, w: Math.max(1, Math.min(gridCols - origX, origW + dCols)), h: Math.max(1, Math.min(gridRows - origY, origH + dRows)) };
      }
    }));
  };

  const endDrag = () => {
    const type = dragState.current && dragState.current.type;
    const moved = dragState.current && dragState.current.moved;
    dragState.current = null;
    window.removeEventListener('mousemove', onDrag);
    window.removeEventListener('mouseup', endDrag);
    // A figure drag ends with a click event — that click must NOT cycle the
    // active figure, so remember the drag happened and swallow the next click.
    if (moved && (type === 'figMove' || type === 'figResize')) suppressCycleRef.current = true;
    // Re-order the A/B/C panel letters after an object is moved/resized.
    if (type === 'move' || type === 'resize') renumberLetters();
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
    dragState.current = { type: 'imgShift', id: objId, startX: e.clientX, startY: e.clientY, origX: obj.imgOffsetX || 0, origY: obj.imgOffsetY || 0 };
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

  // Move ONE figure of a multi-figure object independently (drag the figure).
  const startFigureDrag = (e, objId, imgIdx) => {
    e.stopPropagation();
    commitHistory();
    const obj = objects.find(o => o.id === objId);
    const im = obj && getObjImages(obj)[imgIdx];
    if (!im) return;
    dragState.current = { type: 'figMove', id: objId, imgIdx, startX: e.clientX, startY: e.clientY, origX: im.dx || 0, origY: im.dy || 0 };
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', endDrag);
  };

  // Resize ONE figure of a multi-figure object (drag its corner handle).
  const startFigureResize = (e, objId, imgIdx) => {
    e.stopPropagation();
    commitHistory();
    const obj = objects.find(o => o.id === objId);
    const im = obj && getObjImages(obj)[imgIdx];
    if (!im) return;
    dragState.current = { type: 'figResize', id: objId, imgIdx, startX: e.clientX, startY: e.clientY, origScale: im.scale || 1 };
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

  // ---- zoom fullscreen onto the selected object ----------------------------
  const zoomToObject = (id) => {
    if (!objects.some(o => o.id === id)) return;
    setSelectedId(id);
    setFocusObjId(id);
    setZoom(1.5);
    setIsFullScreen(true);
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
    // instead of being over-zoomed to a fragment of it.
    const owPx = owMm * PX_PER_MM, ohPx = ohMm * PX_PER_MM;
    const scale = Math.max(0.05, Math.min((aw - 24) / owPx, (ah - 24) / ohPx));
    const px = (aw - owPx * scale) / 2 - oxMm * PX_PER_MM * scale;
    const py = (ah - ohPx * scale) / 2 - oyMm * PX_PER_MM * scale;
    // The object-fit view is the "initial" view of this fullscreen session.
    initialZoomRef.current = scale;
    initialPanRef.current = { x: px, y: py };
    setZoom(scale);
    setPanX(px);
    setPanY(py);
  };

  // Centre the whole canvas in the fullscreen viewport (no focused object).
  const centerCanvasAt = (z) => {
    const area = fsAreaRef.current;
    if (!area) return;
    const aw = Math.max(120, area.clientWidth - 64); // p-8 padding
    const ah = Math.max(120, area.clientHeight - 64);
    const cw = canvasW * PX_PER_MM * z;
    const ch = (canvasH + captionH) * PX_PER_MM * z;
    setPanX(Math.max(0, (aw - cw) / 2));
    setPanY(Math.max(0, (ah - ch) / 2));
  };
  const centerCanvas = () => centerCanvasAt(zoom);

  // Restore the zoom (and centring) that was active when fullscreen was entered.
  const restoreInitialZoom = () => {
    setZoom(initialZoomRef.current);
    if (focusObjId) {
      setPanX(initialPanRef.current.x);
      setPanY(initialPanRef.current.y);
    } else {
      centerCanvasAt(initialZoomRef.current);
    }
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
  void libVersion; // re-read the library lists on every transfer (the bump triggers a re-render)
  const libraryItems = libraryTab === 'project' ? readProjectLibrary(activeLibProjectId) : readLibrary();

  // Helper to render the SVG content (shared between normal and fullscreen)
  const renderSvg = (svgElRef) => (
    <svg ref={svgElRef} viewBox={`0 0 ${canvasW} ${canvasH + captionH}`} width="100%" height="100%" onClick={(e) => { e.stopPropagation(); setSelectedId(null); }}>
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
      </defs>
      {objects.map(obj => {
        const isSelected = obj.id === selectedId;
        const ox = obj.x * cellW;
        const oy = obj.y * cellH;
        const ow = obj.w * cellW;
        const oh = obj.h * cellH;

        return (
          <g key={obj.id} onClick={(e) => {
            e.stopPropagation();
            setSelectedId(obj.id);
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
                    return (
                      <image key={im.libId || i}
                        href={src}
                        x={g.iX} y={g.iY} width={g.iW} height={g.iH}
                        transform={rot ? `rotate(${rot} ${g.iX + g.iW / 2} ${g.iY + g.iH / 2})` : undefined}
                        preserveAspectRatio={keepAspect ? 'xMidYMid meet' : fit === 'cover' ? 'xMidYMid slice' : fit === 'stretch' ? 'none' : 'xMidYMid meet'}
                        style={{ pointerEvents: 'none' }}
                      />
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

            {isSelected && (
              <rect data-selection-ui="true" x={ox + ow - 2} y={oy + oh - 2} width={2} height={2} fill="#3b82f6" style={{ cursor: 'nwse-resize' }} onMouseDown={(e) => startResize(e, obj.id)} />
            )}

            {/* Blue square marking the selected panel — screen only: it carries
                data-selection-ui, so renderToDataUrl drops it from Export PNG,
                "Save canvas" and "Insert into project". Drawn last (on top of the
                figure) and transparent to the mouse, so the panel frame below
                keeps receiving the drag. */}
            {isSelected && (
              <rect data-selection-ui="true" x={ox} y={oy} width={ow} height={oh} fill="none" stroke="#3b82f6" strokeWidth={0.5} style={{ pointerEvents: 'none' }} />
            )}

            {/* Link back to the original graph lives in the properties panel
                ("↗ Open original graph") — no on-canvas arrow needed. */}
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
    </svg>
  );

  // Properties Panel Component (reused in normal and fullscreen)
  const PropertiesPanel = ({ isFloating = false }) => (
    <div className={`bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col gap-3 ${isFloating ? 'shadow-2xl max-h-[calc(100vh-8rem)] overflow-y-auto custom-scrollbar' : ''}`}>
      <div className="flex justify-between items-center">
        <h4 className="font-bold text-slate-700">Object Properties ({selectedObj.letter || 'No Letter'})</h4>
        <button onClick={() => { commitHistory(); setObjects(objects.filter(o => o.id !== selectedObj.id)); setSelectedId(null); renumberLetters(); }} className="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-1 rounded font-bold hover:bg-red-100">Delete</button>
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
            <button onClick={() => { setPickMode('add'); setShowLibrary(true); }} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-2 rounded-lg text-xs" title="Add another figure to this same object/panel (they are laid out side by side)">➕ Add figure</button>
          </div>

          {getObjImages(selectedObj).length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-500">Figures in this panel: {getObjImages(selectedObj).length}</span>
              {getObjImages(selectedObj).map((im, i) => (
                <div key={im.libId || i} className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-white border border-slate-200 rounded-lg px-2 py-1">
                  {im.imgThumb || im.imgSrc
                    ? <img src={im.imgThumb || im.imgSrc} alt="" className="w-8 h-8 shrink-0 object-contain rounded border border-slate-100 bg-slate-50" />
                    : <span className="w-8 h-8 shrink-0 rounded bg-slate-100" />}
                  <span className="text-[10px] font-bold text-slate-600 flex-1 min-w-0 truncate">{im.src && im.src.elementLabel ? im.src.elementLabel : `Figure ${i + 1}`}</span>
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
              {getObjImages(selectedObj).length > 1 && (
                <label className="text-[10px] font-bold text-slate-500">Grid columns
                  <select value={selectedObj.imgCols || 2} onChange={e => updateObj({ imgCols: Number(e.target.value) })} className="w-full border rounded p-1 text-xs">
                    {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
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
              <input type="number" min="10" max="500" value={Math.round((selectedObj.imgScale || 1) * 100)} onChange={e => updateObj({ imgScale: Number(e.target.value) / 100 })} className="w-full border rounded p-1 text-xs" />
            </label>
            <label className="text-[10px] font-bold text-slate-500">Padding (mm)
              <input type="number" min="0" max="20" step="0.5" value={selectedObj.imgPadding} onChange={e => updateObj({ imgPadding: Number(e.target.value) })} className="w-full border rounded p-1 text-xs" />
            </label>
            <label className="text-[10px] font-bold text-slate-500">Shift X (mm)
              <input type="number" min="-200" max="200" step="0.5" value={selectedObj.imgOffsetX || 0} onChange={e => updateObj({ imgOffsetX: Number(e.target.value) })} className="w-full border rounded p-1 text-xs" title="Shift the image horizontally inside the object frame" />
            </label>
            <label className="text-[10px] font-bold text-slate-500">Shift Y (mm)
              <input type="number" min="-200" max="200" step="0.5" value={selectedObj.imgOffsetY || 0} onChange={e => updateObj({ imgOffsetY: Number(e.target.value) })} className="w-full border rounded p-1 text-xs" title="Shift the image vertically inside the object frame" />
            </label>
            <label className="text-[10px] font-bold text-slate-500">Rotate (°)
              <div className="flex gap-1">
                <input type="number" min="-360" max="360" step="1" value={selectedObj.imgRotate || 0} onChange={e => updateObj({ imgRotate: Number(e.target.value) })} className="w-full border rounded p-1 text-xs" title="Rotate the image" />
                <button type="button" onClick={() => updateObj({ imgRotate: ((selectedObj.imgRotate || 0) + 90) % 360 })} className="bg-slate-100 border border-slate-300 rounded px-1.5 text-xs font-bold hover:bg-slate-200 shrink-0" title="Rotate 90°">↻90°</button>
              </div>
            </label>
            <span className="col-span-2 text-[9px] text-slate-400 italic">Drag the image directly on the canvas to shift it (or hold Shift + drag the object frame); drag its corner to resize it.</span>
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
            <label className="text-[10px] font-bold text-slate-500">Letter Size (pt)
              <input type="number" min="4" max="48" value={selectedObj.letterStyle.fontSize} onChange={e => updateObj({ letterStyle: { ...selectedObj.letterStyle, fontSize: Number(e.target.value) } })} className="w-full border rounded p-1 text-xs" />
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
            <label className="text-[10px] font-bold text-slate-500">Letter Color
              <input type="color" value={selectedObj.letterStyle.color} onChange={e => updateObj({ letterStyle: { ...selectedObj.letterStyle, color: e.target.value } })} className="w-8 h-6 rounded border cursor-pointer" />
            </label>
            <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
              <input type="checkbox" checked={selectedObj.letterStyle.bold} onChange={e => updateObj({ letterStyle: { ...selectedObj.letterStyle, bold: e.target.checked } })} /> Bold
            </label>
          </div>
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
            <button onClick={() => { if(window.confirm('Clear the entire canvas?')) { commitHistory(); setObjects([]); setSelectedId(null); setCanvasEntries({}); setCanvasLabel(''); } }} className="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-1 rounded font-bold hover:bg-red-100">Clear Canvas</button>
          </div>
        </div>

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
          <label className="text-[10px] font-bold text-slate-500 flex flex-col flex-1 min-w-[220px]">Global caption (click to edit — merges the object sub-captions)
            <span className="border border-slate-200 rounded p-1 text-xs bg-slate-50 text-slate-600 truncate hover:border-blue-400 hover:bg-blue-50 cursor-text" title={effectiveGlobalCaption} onClick={() => { setSelectedId(null); setEditingCaption(true); }}>{effectiveGlobalCaption || 'Merges the object sub-captions (A: …, B: …)'}</span>
          </label>
          <button onClick={addObject} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs">+ Add Object</button>
          <button onClick={undo} disabled={!undoStack.current.length || histTick < 0} className="bg-slate-100 border border-slate-300 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-slate-200 disabled:opacity-40" title="Undo last change (Ctrl+Z)">↩ Undo</button>
          <button onClick={() => selectedId && zoomToObject(selectedId)} disabled={!selectedId} title={selectedId ? 'Zoom fullscreen on the selected object' : 'Select an object first'}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-bold px-3 py-1.5 rounded-lg text-xs">⛶ Zoom Object</button>
          <button onClick={exportPng} title="300 DPI PNG of the composition — the blue selection square and resize handles are never included; panel borders and grid lines follow the checkboxes." className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs">Export PNG (300 DPI)</button>
          <button onClick={openSaveDialog} title="Save the whole canvas in the image library — the dialog asks WHERE: a project's library (its Project tab + that project page's “🖼 Saved canvases”, where it can be reopened in this editor) or the shared dataset library. Re-saving a canvas updates the copy of the place you pick; nothing is duplicated."
            className="bg-amber-500 hover:bg-amber-600 text-white font-bold px-3 py-1.5 rounded-lg text-xs">💾 Save canvas</button>
          <button onClick={() => { setPickMode('replace'); setShowLibrary(true); }}
            title="Open the image library — browse images or upload new ones from your computer (Project or Dataset library)"
            className="bg-teal-600 hover:bg-teal-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs">🖼 Image Library</button>
          <button onClick={() => { setInsertTarget({ projectId: projectId || (allProjects[0] && allProjects[0].id) || '', section: 'background' }); setInsertMsg(''); setInsertOpen(true); }}
            title="Render this composition into a project section (Background / Discussion / Conclusions). The inserted figure keeps a link back to this canvas, so the project page can reopen it here with “✏️ Modify in Image Builder”."
            className="bg-violet-600 hover:bg-violet-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs">📤 Insert into project…</button>
        </div>

        {/* SVG Canvas (Normal View) */}
        <div className="border border-slate-300 rounded-lg bg-slate-100 p-2 flex justify-center overflow-auto">
          <div style={{ width: '100%', maxWidth: '800px', aspectRatio: `${canvasW} / ${canvasH + captionH}` }} className="bg-white shadow-md">
            {renderSvg(svgRef)}
          </div>
        </div>

        {/* Properties Panel (Normal View) */}
        {selectedObj && <PropertiesPanel />}
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
              <div className="flex flex-wrap items-center gap-2 bg-slate-100 rounded-lg px-3 py-1.5">
                <button onClick={() => setZoom(z => Math.max(0.1, +(z - 0.1).toFixed(1)))} className="w-6 h-6 flex items-center justify-center bg-white border border-slate-300 rounded text-slate-600 hover:bg-slate-50 font-bold">-</button>
                <input
                  type="range"
                  min="0.1"
                  max="8"
                  step="0.1"
                  value={zoom}
                  onChange={e => setZoom(Number(e.target.value))}
                  className="w-24 md:w-32 accent-blue-600"
                />
                <button onClick={() => setZoom(z => Math.min(8, +(z + 0.1).toFixed(1)))} className="w-6 h-6 flex items-center justify-center bg-white border border-slate-300 rounded text-slate-600 hover:bg-slate-50 font-bold">+</button>
                <span className="text-xs font-bold text-slate-600 w-12 text-center">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom(1)} className="text-xs font-bold text-blue-600 hover:underline ml-2">Reset</button>
                <button onClick={restoreInitialZoom} className="text-xs font-bold text-indigo-600 hover:underline ml-1" title="Zoom out to the initial zoom of this fullscreen session">↩ Initial zoom</button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => (focusObjId ? recenterFocus() : centerCanvas())}
                  className="text-xs font-bold px-2.5 py-1.5 rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                  title={focusObjId ? 'Re-centre the zoomed object in the viewport' : 'Centre the canvas in the viewport'}>
                  ◎ Center
                </button>
                <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg px-1.5 py-1" title="Pan the canvas">
                  <button onClick={() => setPanX(p => p - 30)} className="w-5 h-5 bg-white border border-slate-300 rounded text-slate-600 hover:bg-slate-50 text-[10px]">←</button>
                  <button onClick={() => setPanY(p => p - 30)} className="w-5 h-5 bg-white border border-slate-300 rounded text-slate-600 hover:bg-slate-50 text-[10px]">↑</button>
                  <button onClick={() => setPanY(p => p + 30)} className="w-5 h-5 bg-white border border-slate-300 rounded text-slate-600 hover:bg-slate-50 text-[10px]">↓</button>
                  <button onClick={() => setPanX(p => p + 30)} className="w-5 h-5 bg-white border border-slate-300 rounded text-slate-600 hover:bg-slate-50 text-[10px]">→</button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                 <button onClick={addObject} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs">+ Add Object</button>
                 <button onClick={undo} disabled={!undoStack.current.length || histTick < 0} className="bg-slate-100 border border-slate-300 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-slate-200 disabled:opacity-40" title="Undo last change (Ctrl+Z)">↩ Undo</button>
                 <button onClick={() => { setPickMode('replace'); setShowLibrary(true); }}
                   title="Open the image library — browse or upload new images from your computer"
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
                 <button onClick={exportPng} title="PNG of the composition — the blue selection square and resize handles are never included; panel borders and grid lines follow the checkboxes." className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs">Export PNG</button>
              </div>
            </div>
            <button onClick={() => { setFocusObjId(null); setIsFullScreen(false); }} className="shrink-0 bg-slate-800 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-slate-700 flex items-center gap-2">
              ✕ Exit Full Screen
            </button>
          </div>

          {/* Canvas Area */}
          <div ref={fsAreaRef} className="flex-1 min-h-0 overflow-auto relative bg-slate-200 p-8" onClick={() => setSelectedId(null)}>
            <div
              style={{
                transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
                transformOrigin: '0 0',
                width: `${canvasW}mm`,
                height: `${canvasH + captionH}mm`
              }}
              className="shadow-2xl bg-white"
            >
              {renderSvg(svgFsRef)}
            </div>
          </div>

          {/* Floating Properties Panel */}
          {selectedObj && (
            <div className="absolute right-4 bottom-4 md:top-16 md:bottom-4 w-80 z-20 max-h-[55vh] overflow-y-auto custom-scrollbar md:max-h-none md:overflow-visible">
              <PropertiesPanel isFloating />
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
                <button className={`px-3 py-1 rounded font-bold text-xs ${libraryTab === 'project' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`} onClick={() => { setLibraryTab('project'); setLibMsg(''); }}>Project Library</button>
                <button className={`px-3 py-1 rounded font-bold text-xs ${libraryTab === 'common' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`} onClick={() => { setLibraryTab('common'); setLibMsg(''); }}>Dataset Library</button>
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
              </div>
              {selectedObj && (
                <div className="flex gap-1 ml-auto" title="Replace: the selected object shows only this figure. Add: appends the figure to the selected object so several figures share one panel.">
                  <button className={`px-3 py-1 rounded font-bold text-xs ${pickMode === 'replace' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`} onClick={() => setPickMode('replace')}>↺ Replace</button>
                  <button className={`px-3 py-1 rounded font-bold text-xs ${pickMode === 'add' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`} onClick={() => setPickMode('add')}>➕ Add</button>
                </div>
              )}
              {libraryTab === 'project' && (
                <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
                  Project
                  <select value={activeLibProjectId || 'global'} onChange={(e) => setLibProjectId(e.target.value === 'global' ? null : e.target.value)}
                    className="border border-slate-300 rounded px-2 py-1 text-xs bg-white max-w-[240px]">
                    <option value="global">Current / no project</option>
                    {allProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              )}
              {pickMode === 'add' && (
                <span className="text-[10px] font-bold text-indigo-700">Click figures to add them to this panel — the window stays open so you can add several.</span>
              )}
              {libMsg && (
                <div className="w-full text-[11px] font-bold text-emerald-700">{libMsg}</div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-4 grid grid-cols-3 md:grid-cols-4 gap-4 min-h-0">
              {libraryItems.length === 0 && <p className="col-span-full text-center text-slate-400 italic">No images in this library yet.</p>}
              {libraryItems.map(item => (
                <div key={item.id} className="border rounded-lg p-2 cursor-pointer hover:border-blue-500 flex flex-col items-center hover:shadow-md transition-all" onClick={() => (pickMode === 'add' ? handleAddImage(item) : handlePickImage(item))}>
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
                      title={`Move this image to the ${libraryTab === 'project' ? 'common (dataset)' : 'project'} library`}>
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
                {allProjects.length === 0 && <option value="">No projects yet</option>}
                {allProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="text-[10px] font-bold text-slate-500 flex flex-col gap-1">Text subsection
              <select value={insertTarget.section} onChange={(e) => setInsertTarget({ ...insertTarget, section: e.target.value })}
                className="border border-slate-300 rounded px-2 py-1.5 text-xs bg-white">
                <option value="background">Background</option>
                <option value="discussion">Discussion</option>
                <option value="conclusions">Conclusions</option>
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
                {allProjects.map((p) => <option key={p.id} value={p.id}>📁 {p.name} — its Project tab + “🖼 Saved canvases”</option>)}
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