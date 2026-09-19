import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  readLibrary, readProjectLibrary, readVisibleProjectLibrary, moveLibraryItem, reorderLibraryItem,
  renameLibraryItem, removeLibraryItem, renameProjectLibraryItem, removeProjectLibraryItem,
  blobToDataUrl, publishLibraryFigure, resolveImageToDataUrl, localStorageHealthy,
  saveCanvasSnapshot, uploadFigureToDrive,
  countRecaptureDuplicates, removeRecaptureDuplicates,
  pushLibraryToDrive, pullLibraryFromDrive, localOnlyLibraryItems, mergeLibraryFromSnapshot,
  uid, canvasKeyOfEntry, findCanvasEntryByKey, canvasPreviewFromComposition, lastLibraryListWrite,
  figureFileIdentity, renameFigureOnDrive
} from '../utils/figuresLibrary';
import {
  freeRectOf, isFreeLayout, pinRectOf, freeSlotFor, RECT_MIN, RECT_MAX, moveFigureInList
} from '../utils/figureLayout';
import {
  firstFreeCellIn, buildCopyPayload, parseCopyPayload, pastePanels
} from '../utils/objectClipboard';
import {
  moveSelectionPatches, moveFiguresPatches, resizedBox, resizeSelectionPatches,
  figureResizeFactor, resizeFiguresPatches, alignFiguresPatches, distributeFiguresPatches,
  alignGroupPatches, distributeGroupPatches
} from '../utils/panelSelection';
import {
  ERASE_SIZE_MIN, ERASE_SIZE_MAX, ERASE_DEFAULT_SIZE, clampEraseSize,
  eraseStrokesOf, mmStrokeHits, pushStrokePoint, mmStrokeToSource, maskStrokesMm, eraseMaskId
} from '../utils/figureErase';
import {
  BG_DEFAULT_TOL, BG_TOL_MIN, BG_TOL_MAX, clampBgTol, bgPixelSize, bgRecordOf,
  cornerColors, hexToRgb, rgbToHex, removeBackgroundKey, softenBackgroundEdges
} from '../utils/figureBackground';
import LZString from 'lz-string';
import { backupFigureCount, figuresFromBackupHtml } from '../utils/referenceImport';
import { loadProjects, saveProjectsRescued, genProjectId, projectAccessFor, visibleProjectsFor } from './AppModules/projectsModule';
import { getDriveRootName } from '../utils/driveUpload';
import { projectImagesFolderLabel } from '../utils/driveNaming';
import { queuePendingFigureScroll } from '../utils/pendingFigureScroll';
import { figureStyleTag } from '../utils/figureStyle';
import {
  queueFigureRecaptures, figureRecaptureSummary, subscribeFigureRecapture, hasFreshFigureRecapture,
  stopFigureRecaptures
} from '../utils/figureRecapture';
import { useFigureStyleProfile } from './FigureStyleTools';
import { ShadowControls, ArrowPropertiesPanel, ShapePropertiesPanel } from './FigureArrowPanel';
import {
  newArrow, normalizeArrow, arrowGeometry, arrowHeadPath, shadowSpec, shadowFilterId,
  figureShadowFilterId, DEFAULT_SHADOW
} from '../utils/figureArrows';
import {
  SHAPE_KINDS, SHAPE_LABELS, newShape, normalizeShape, shapeGeometry,
  shapeShadowFilterId, shapeDashArray, shapeFillOf, shapeHandles, resizedShapeCorners,
  defaultShapeRect
} from '../utils/figureShapes';
import {
  ADJUST_FIELDS, adjustSpec, adjustRecordOf, adjustFilterId, ADJUST_NEUTRAL
} from '../utils/figureAdjust';
import { getRenderableDriveUrl } from '../data/constants';

const ptToMm = (pt) => pt * 0.352778;
const PX_PER_MM = 96 / 25.4; // CSS: 1 mm ≈ 3.78 px
// Décalage de la COPIE d'un texte (⧉ Copy) : la copie se pose à 3 mm vers le
// bas-droite — assez pour ne pas se cacher sous l'original, assez peu pour
// rester « juste à côté ».
const TEXT_COPY_STEP = 3;

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

/* ── LA VIGNETTE D'UNE ENTRÉE DE BIBLIOTHÈQUE ────────────────────────────────
   `url` (la copie locale) sinon `full` (la copie cloud) — et, ce qui manquait à
   un canvas restauré depuis son fichier : le PREMIER PANNEAU DE SA COMPOSITION
   (`canvasPreviewFromComposition`), parce que le sidecar ne porte que la
   composition et que sa vignette restait un cadre neutre alors que ses panneaux
   sont là. Un lien de partage Drive est réécrit en lien affichable. PUR. */
const libThumbOf = (item) => getRenderableDriveUrl(
  (item && (item.url || item.full || canvasPreviewFromComposition(item.canvasData))) || ''
);

/* ── L'IDENTITÉ D'UN CANVAS EST SEMÉE AVANT LE PREMIER RENDU ─────────────────
   Le payload persisté (cache de session puis localStorage) porte, avec la
   composition, l'identité de son canvas : sa clé de composition
   (`canvasData.canvasKey`) et les entrées de bibliothèque où il est déjà
   enregistré. La lire dès l'initialisation des états est NÉCESSAIRE : l'effet qui
   écrit ce payload tourne au montage, avec l'état encore à ses valeurs initiales.
   Sans ce semis il écrivait une identité VIDE, et React.StrictMode — qui monte,
   démonte et remonte chaque composant en développement — faisait alors perdre à
   la composition l'entrée de bibliothèque qu'elle venait de retrouver : une copie
   de plus dans le projet à chaque aller-retour. */
const canvasIdentityOf = (payload) => {
  const p = payload && typeof payload === 'object' ? payload : {};
  return {
    canvasKey: String(p.canvasKey || '').trim(),
    canvasEntries: p.canvasEntries && typeof p.canvasEntries === 'object' ? p.canvasEntries : null,
    canvasHome: p.canvasHome !== undefined ? (p.canvasHome || null) : undefined,
    canvasLabel: String(p.canvasLabel || '')
  };
};
const storedCanvasIdentity = (storageKey) => {
  try {
    const cached = imageBuilderSessionCache.get(storageKey) || null;
    const payload = (cached && cached.payload) || (() => {
      try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { return null; }
    })();
    return canvasIdentityOf(payload);
  } catch { return canvasIdentityOf(null); }
};

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
  /* LES FORMES GÉOMÉTRIQUES — lignes, rectangles, cercles. Même famille que les
     flèches : une liste de CANVAS en millimètres (`x1,y1` – `x2,y2` = deux coins
     opposés), donc aucune lettre, aucune cellule, et jamais un panneau dérangé.
     La géométrie et le modèle vivent dans utils/figureShapes.js (purs), le
     panneau de la forme choisie dans FigureArrowPanel.jsx. */
  const [shapes, setShapes] = useState([]);
  const [selectedShapeId, setSelectedShapeId] = useState(null);
  const [hydrateTick, setHydrateTick] = useState(0); // bumped to async-fetch Drive-backed images onto the canvas
  const objectsRef = useRef(objects);
  objectsRef.current = objects;

  const [showLibrary, setShowLibrary] = useState(false);
  const [pickMode, setPickMode] = useState('replace'); // 'replace' | 'add' | 'swap' — how a library click affects the selected object / figure
  const [libraryTab, setLibraryTab] = useState('project');
  const [libVersion, setLibVersion] = useState(0); // forces a re-read of the library lists after a transfer
  const [libProjectId, setLibProjectId] = useState(null); // which project's library to browse (null = the active one)
  const [libMsg, setLibMsg] = useState('');       // transient feedback after a PC upload / transfer
  const [canvasNameMsg, setCanvasNameMsg] = useState(''); // feedback of the toolbar “✏️ Rename”
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
  // L'identité du canvas est SEMÉE depuis le payload persisté, AVANT le premier
  // rendu (voir storedCanvasIdentity) : l'effet de persistance écrit ce payload
  // dès le montage et ne peut donc pas effacer la clé de composition stockée.
  const initialCanvasIdentity = useMemo(
    () => storedCanvasIdentity(storageKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [canvasEntries, setCanvasEntries] = useState(() => initialCanvasIdentity.canvasEntries || {});
  // La CLÉ DE COMPOSITION de ce canvas : l'identité que la composition porte
  // elle-même (`canvasData.canvasKey`, donc la copie éditable du Drive aussi).
  // Elle survit à un rechargement de page, à un autre ordinateur et à une liste
  // de navigateur allégée — c'est elle qui rend l'entrée de bibliothèque à ce
  // canvas, sinon la sauvegarde automatique en ajoutait une copie à chaque
  // passage (« plusieurs canvas dans le projet »). Voir canvasEntryFor.
  const [canvasKey, setCanvasKey] = useState(() => initialCanvasIdentity.canvasKey || uid('cv'));
  // Scope touched last — where the "💾 Save canvas" dialog proposes to save.
  const [canvasHome, setCanvasHome] = useState(() => (
    initialCanvasIdentity.canvasHome === undefined ? (projectId || null) : initialCanvasIdentity.canvasHome
  ));
  const [canvasLabel, setCanvasLabel] = useState(() => initialCanvasIdentity.canvasLabel);
  // "💾 Save canvas" dialog: name of the canvas + the library it goes into
  // ('' = the shared dataset library, a project id = that project's library).
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDest, setSaveDest] = useState(projectId || '');
  const [saveMsg, setSaveMsg] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [placeTextMode, setPlaceTextMode] = useState(false); // click on the object to add text there
  // LA FENÊTRE DE L'OBJET EST REPLIÉE PAR DÉFAUT au strict nécessaire (trois
  // lignes : le panneau, sa figure, sa légende / ses textes). Tout le reste —
  // l'ombre du panneau, la disposition libre, la taille du pinceau de la gomme
  // et les longues explications — vit derrière « ▾ More options ». L'état est
  // gardé ICI, au niveau du composant, et surtout PAS dans `PropertiesPanel` :
  // ce dernier est appelé comme une fonction (voir plus bas) et ne doit porter
  // aucun hook.
  const [panelMore, setPanelMore] = useState(false);
  // LA FENÊTRE DE L'OBJET SE PLIE ENTIÈREMENT : `panelOpen` est son titre-bouton
  // (▾ / ▸). Repliée, elle ne laisse qu'une ligne — le canvas garde toute la
  // hauteur — et la composition affichée n'est pas modifiée pour autant.
  const [panelOpen, setPanelOpen] = useState(true);
  const [globalCaption, setGlobalCaption] = useState('');     // figure-wide caption at the bottom
  // Size the figure-wide letter-size control falls back to when the canvas holds
  // no panel yet: a size typed before the first panel is added is remembered for
  // it (see setLetterSizeAll / currentLetterPt).
  const [letterPtFallback, setLetterPtFallback] = useState(DEFAULT_LETTER_PT);
  // Colour and bold of the panel letters are a GENERAL definition too (see
  // setLetterColorAll / setLetterBoldAll): they apply to every panel at once —
  // the object window no longer carries them, the canvas options do.
  const [letterStyleDefaults, setLetterStyleDefaults] = useState({ color: '#000000', bold: true });
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
  // L'entrée de bibliothèque de CE canvas dans cette portée : celle dont l'éditeur
  // se souvient, sinon celle que sa CLÉ DE COMPOSITION retrouve dans la
  // bibliothèque. Le second cas est celui qui manquait : après un rechargement de
  // page — ou sur un autre poste — l'id était oublié et la sauvegarde automatique
  // ajoutait une copie du même canvas à chaque passage.
  const canvasEntryFor = (scopeProjectId) => {
    const known = canvasEntryIn(scopeProjectId);
    if (known) return known;
    if (!canvasKey) return null;
    const found = findCanvasEntryByKey({
      scope: scopeProjectId ? 'project' : 'common',
      projectId: scopeProjectId || null,
      canvasKey
    });
    return found ? { id: found.id, label: found.label || canvasLabel || 'Canvas' } : null;
  };
  // Record that this canvas is stored as `entry` in that scope (and as the scope
  // touched last), so the next save updates that very entry.
  const rememberCanvasEntry = (scopeProjectId, entry) => {
    if (!entry || !entry.id) return;
    const key = canvasScopeKey(scopeProjectId);
    const label = entry.label || canvasLabel || 'Canvas';
    setCanvasEntries((m) => ({ ...m, [key]: { id: entry.id, label } }));
    setCanvasHome(scopeProjectId || null);
    setCanvasLabel(label);
    // La composition reprise apporte SA clé (un canvas enregistré avant elle n'en
    // a pas : il en reçoit une) — c'est elle qui le reliera à cette entrée.
    const k = canvasKeyOfEntry(entry);
    if (k) setCanvasKey(k);
  };
  // Le badge de l'éditeur nomme l'entrée du canvas : il n'interroge la clé (une
  // lecture de bibliothèque) que quand le carnet d'adresses ne sait rien, et on
  // garde le résultat tant que rien de tout cela ne change.
  const homeEntry = useMemo(
    () => canvasEntryIn(canvasHome) || (canvasKey ? canvasEntryFor(canvasHome) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canvasEntries, canvasKey, canvasHome, libVersion, projectId]
  );
  const storedScopeCount = Object.keys(canvasEntries).length;

  /* ── ✏️ RENOMMER CE CANVAS — LE CRAYON QUI MANQUAIT ──────────────────────────
     Signalé tel quel : « the rename function does not work. there is no pencil ».
     Le nom d'une toile ne se changeait que depuis la modale 🖼 Library (bouton ✎
     sur une vignette) — jamais LÀ où l'on travaille, sur le canvas ouvert. Le nom
     vit à deux endroits, on écrit donc les deux :
       • dans l'éditeur (`canvasLabel`) : c'est lui que porte la composition et
         que la prochaine sauvegarde (💾 Save now / la passe automatique) enverra
         au Drive, donc le nom du fichier de l'image ;
       • dans CHAQUE entrée de bibliothèque déjà écrite pour ce canvas (le carnet
         d'adresses `canvasEntries` : une entrée par portée). L'id, la composition
         et la clé de canvas ne bougent pas — les liens « ✏️ Modify in Image
         Builder » de la page projet continuent de viser la même entrée.
     Le navigateur peut REFUSER l'écriture (magasin plein) : on le DIT alors
     franchement, au lieu de laisser croire que le renommage a marché. */
  const renameThisCanvas = () => {
    const current = canvasLabel || (homeEntry && homeEntry.label) || '';
    const typed = window.prompt('Canvas name:', current || `Canvas ${new Date().toLocaleDateString()}`);
    if (typed === null) return;                       // annulé
    const label = String(typed || '').trim();
    if (!label || label === current) return;
    setCanvasLabel(label);
    const scopes = Object.keys(canvasEntries || {});
    let renamed = 0;
    let refused = 0;
    /* Les portées de ce canvas, pour le RENOMMAGE DU FICHIER SUR LE CLOUD plus
       bas : c'est l'entrée de bibliothèque qui porte son lien Drive. */
    const cloudScopes = [];
    scopes.forEach((k) => {
      const id = (canvasEntries[k] || {}).id;
      if (!id) return;
      const kept = k === 'dataset'
        ? renameLibraryItem(id, label)
        : renameProjectLibraryItem(k, id, label);
      if (kept === false) refused += 1; else renamed += 1;
      cloudScopes.push({
        scope: k === 'dataset' ? 'common' : 'project',
        projectId: k === 'dataset' ? null : k,
        projectName: k === 'dataset' ? '' : String((allProjects.find((p) => p.id === k) || {}).name || ''),
        id
      });
    });
    if (renamed) {
      setCanvasEntries((m) => {
        const next = { ...m };
        Object.keys(next).forEach((k) => {
          if (next[k] && next[k].id) next[k] = { ...next[k], label };
        });
        return next;
      });
      setLibVersion((v) => v + 1);
    }
    /* Le NOM est gardé même quand la liste ne rentre pas (voir
       rememberCanvasName) : « kept » veut dire « il survit au rafraîchissement ».
       Ce qui reste à dire, c'est si le magasin est PLEIN — sinon l'avertissement
       ferait croire que le renommage a échoué. */
    const full = lastLibraryListWrite().kept === false;
    setCanvasNameMsg((scopes.length && !renamed)
      ? `⚠️ “${label}” could not be written anywhere (this browser’s store refused even the small name record): that name lives in this session only. Free some room (☁ Save figures to Drive, or delete images you no longer need), then rename again.`
      : (full
        ? `✏️ “${current || 'Canvas'}” is now called “${label}”${scopes.length ? ` — ${renamed} library ${renamed === 1 ? 'entry' : 'entries'} renamed in place` : ''}, and the name is remembered (it survives a refresh). ⚠️ This browser’s store is FULL, though: the image lists themselves could not be rewritten — free some room with “☁ Save figures to Drive” before adding more.`
        : (scopes.length
          ? `✏️ “${current || 'Canvas'}” is now called “${label}” — ${renamed} library ${renamed === 1 ? 'entry' : 'entries'} renamed in place.`
          : `✏️ This canvas will be called “${label}”. It has no library entry yet: press “💾 Save now” to store it under that name.`)));
    /* LE NOM DU FICHIER SUR LE DRIVE SUIT — c'est ce qui manquait : on cherchait
       la toile dans le dossier sous un nom que le Drive ne portait pas, et la
       sauvegarde suivante, le nom ayant changé, ne retrouvait plus le fichier à
       écraser : elle en déposait un SECOND. Ici le fichier est renommé SUR PLACE
       (même identifiant de fichier) et son sidecar de composition avec lui, donc
       les liens « ✏️ Modify in Image Builder » continuent de fonctionner. */
    cloudScopes.forEach((s) => {
      renameFigureOnDrive({ ...s, label })
        .then((r) => {
          if (!r || !r.ok || r.unchanged) return;
          setCanvasNameMsg((m) => `${m} 📁 On Drive, “${r.from}” is now “${r.name}” — same file (its link and its composition sidecar follow it).`);
        })
        .catch(() => {});
    });
  };

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
          // …but when the local thumbnail is gone (the figure was placed from
          // another workstation, or this browser's copy was cleaned) the Drive
          // SHARE LINK is all that is left — and the canvas draws its figures
          // with <image href>, which cannot show a drive.google.com/file/d/…
          // page. Rewrite it into a displayable URL, like every other module
          // that shows a library figure (FiguresSlides, RichTextEditor…).
          const shown = getRenderableDriveUrl(it.url || it.full);
          return { ...im, imgSrc: fullData || shown, imgThumb: shown, _srcHint: it.full && !String(it.full).startsWith('data:') ? it.full : null };
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
    // L'identité de la composition (clé de canvas + entrées de bibliothèque)
    // voyage AVEC elle : elle vient du payload, il n'y a donc rien à remettre à
    // zéro — sauf pour un canvas NEUF (aucun payload), qui repart de rien.
    let restoredIdentity = false;
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
        // existed simply has no value here and keeps the empty list. The SHAPES
        // (lines, rectangles, circles) are exactly the same kind of record.
        if (data.arrows) setArrows((data.arrows || []).map(normalizeArrow));
        if (data.shapes) setShapes((data.shapes || []).map(normalizeShape));
        // Restore the view the user left — e.g. when returning from the original
        // graph via the test page's ◀ Back button.
        if (data.isFullScreen) setIsFullScreen(true);
        if (data.focusObjId && data.objects && data.objects.some((o) => o.id === data.focusObjId)) {
          setFocusObjId(data.focusObjId);
          setIsFullScreen(true);
        }
        // L'identité de CE canvas : sa clé de composition et les entrées de
        // bibliothèque où il est déjà enregistré. Elle est REPRISE du payload —
        // c'est ce qui fait qu'un aller-retour par un autre module (ou un
        // rechargement de page) n'oublie plus l'entrée du canvas, donc ne laisse
        // plus la sauvegarde automatique en créer une copie à chaque séjour.
        // Les états en sont déjà semés au premier rendu (voir initialCanvasIdentity) ;
        // cet effet tourne AUSSI quand on change de projet (storageKey) : il pose
        // alors celle de CE payload-ci.
        const identity = canvasIdentityOf(data);
        setCanvasKey(identity.canvasKey || uid('cv'));
        setCanvasEntries(identity.canvasEntries || {});
        setCanvasLabel(identity.canvasLabel);
        if (identity.canvasHome !== undefined) setCanvasHome(identity.canvasHome);
        restoredIdentity = true;
      }
    } catch {}
    // Ce que le payload ne portait PAS appartient à un canvas NEUF : aucune entrée
    // connue, le projet de l'éditeur comme destination, une clé de composition
    // neuve (l'identité d'un canvas ne se réutilise jamais). This component
    // instance is reused when the user switches project, so the bookkeeping of the
    // previous composition must not leak into the next one.
    if (!restoredIdentity) {
      setCanvasEntries({});
      setCanvasHome(projectId || null);
      setCanvasLabel('');
      setCanvasKey(uid('cv'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Open a saved canvas requested by the project page ("🖼 Saved canvases" or
  // "✏️ Modify in Image Builder" on a figure inserted from the editor): App.jsx
  // passes the library entry id here and the module remounts, so this runs after
  // the session-cache restore above and wins. The request is consumed at the end,
  // so visiting the Image Builder afterwards keeps whatever the user was working
  // on.
  //
  // ⛔ CE QUI ÉTAIT SIGNALÉ (« je rouvre le canvas enregistré dans le projet, il
  //    est ENCORE VIDE ; il ne réapparaît que si je vais dans la bibliothèque
  //    cliquer ⬇ Add missing from Drive »). Cette ouverture ne lisait QUE la
  //    liste de CE navigateur (`readProjectLibrary` : mémoire → localStorage,
  //    ~5 Mo par site partagés avec les projets et les figures) ET exigeait
  //    l'entrée AVEC sa composition (`i.canvasData`). Quand la liste avait dû
  //    être allégée — ou sur un autre poste — l'entrée n'était plus là : le
  //    `if (item)` était simplement SAUTÉ, la demande consommée, et l'éditeur
  //    s'ouvrait sur un canvas VIDE sans rien dire. Les pixels et le sidecar
  //    éditable `<image>.meta.json` étaient pourtant sur le Drive depuis
  //    l'insertion : la seule lecture qui les ramène est celle du bouton.
  // ✅ La réouverture se RÉPARE donc elle-même, en trois temps :
  //    1. la liste du navigateur (portée du projet, puis bibliothèque partagée) ;
  //    2. sinon, on relit le dossier d'images du projet sur le Drive — le MÊME
  //       appel que « ⬇ Add missing figures from Drive », sidecars compris ;
  //    3. on cherche de nouveau, et si la composition reste introuvable on le
  //       DIT (fenêtre de bibliothèque ouverte sur le bon onglet, dossier nommé)
  //       au lieu de laisser un canvas vide et muet.
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
    const consume = () => { if (typeof onCanvasOpened === 'function') onCanvasOpened(openCanvasId); };
    /* Where the canvas IS, in this browser: it comes from the project's library —
       or, for a canvas saved before the projects were scoped, from the shared
       dataset library. The scope travelled back with it: re-saving the canvas
       updates THAT entry (see restoreCanvasFromItem). */
    const locate = () => {
      const own = (projectId ? readProjectLibrary(projectId) : readLibrary())
        .find((i) => i && i.id === openCanvasId && i.canvasData);
      if (own) return { item: own, scopeProjectId: projectId || null };
      const shared = readLibrary().find((i) => i && i.id === openCanvasId && i.canvasData);
      return shared ? { item: shared, scopeProjectId: null } : null;
    };
    const here = locate();
    if (here) {
      restoreCanvasFromItem(here.item, { confirm: false, scopeProjectId: here.scopeProjectId });
      consume();
      return;
    }
    // Not listed here (or listed without its composition) → read the images
    // folder on Drive ONCE — it also re-reads the `.meta.json` sidecars, which
    // is exactly what makes an editable canvas come back — then look again.
    let alive = true;
    const scopeInfo = {
      scope: projectId ? 'project' : 'common',
      projectId: projectId || null,
      projectName: projectId ? canvasScopeName(projectId) : ''
    };
    (async () => {
      setLibDriveBusy(true);
      setLibMsg(`⬇ This canvas is not in this browser — reading ${scopeInfo.scope === 'project' ? 'the project’s' : 'the dataset’s'} images folder on Drive…`);
      let res = null;
      try {
        res = await pullLibraryFromDrive(scopeInfo);
      } catch (err) {
        res = { error: (err && err.message) || 'Could not read the Drive folder', folder: '' };
      }
      if (!alive) return;
      setLibDriveBusy(false);
      setLibVersion((v) => v + 1);
      const after = locate();
      if (after) {
        restoreCanvasFromItem(after.item, { confirm: false, scopeProjectId: after.scopeProjectId });
        setLibMsg('✓ The canvas was found on Drive: its panels, figures, captions and grid are back.');
        consume();
        return;
      }
      // Nothing anywhere: SAY it, with the folder that was read — a silent empty
      // canvas is what made this look like a lost composition.
      const where = (res && res.folder) || (scopeInfo.scope === 'project' ? 'this project’s images folder' : 'the dataset images folder');
      setLibMsg(res && res.error
        ? `⚠ ${res.error} — “${openCanvasId}” could not be reopened here. Check Settings → cloud storage, then “⬇ Add missing from Drive”.`
        : `⚠ “${openCanvasId}” is not in this browser and not in ${where}: that canvas was never saved to the cloud. Re-insert the composition with “📤 Insert into project…” (it uploads the image FIRST) and it will always come back; “⬇ Add missing from Drive” re-reads the folder right now.`);
      if (projectId) setLibProjectId(projectId);
      setLibraryTab(scopeInfo.scope);
      setShowLibrary(true);
      consume();
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCanvasId]);

  useEffect(() => {
    try {
      // Persist a lightweight copy (the small thumbnail instead of the
      // full-resolution dataURL) so the layout always re-opens after
      // navigating away and back.
      const persisted = (objects || []).map(thumbnailsOf);
      // Le payload porte aussi l'IDENTITÉ de la composition (clé de canvas, nom,
      // entrées de bibliothèque où ce canvas est enregistré) : sans elle, revenir
      // sur la page faisait oublier l'entrée et la sauvegarde automatique en
      // ajoutait une copie — « j'ai plusieurs canvas enregistrés dans le projet ».
      const payload = { canvasW, canvasH, gridCols, gridRows, showPanelBorders, showGridLines, keepAspect, objects: persisted, arrows, shapes, focusObjId, globalCaption, isFullScreen, canvasKey, canvasEntries, canvasHome, canvasLabel };
      // Always keep the freshest copy in memory (survives module remounts even
      // when localStorage is full), then best-effort write localStorage:
      // rememberSessionCanvas keeps BOTH the lightweight payload AND the live
      // objects — the pixels the canvas is showing — so coming back from the
      // original experiment cannot drop a figure to its local thumbnail.
      rememberSessionCanvas(storageKey, payload, objects || []);
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch { /* localStorage may be full — the session cache above still holds the state */ }
  }, [canvasW, canvasH, gridCols, gridRows, showPanelBorders, showGridLines, keepAspect, objects, arrows, shapes, focusObjId, globalCaption, isFullScreen, canvasKey, canvasEntries, canvasHome, canvasLabel, storageKey]);

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
  // The ARROWS and the SHAPES ride along in the same snapshot: undoing a change
  // puts the annotations back exactly as they were (they hold no pixels at all).
  const commitHistory = () => {
    try {
      const snap = {
        objects: JSON.parse(JSON.stringify((objects || []).map(thumbnailsOf))),
        arrows: JSON.parse(JSON.stringify(arrows || [])),
        shapes: JSON.parse(JSON.stringify(shapes || []))
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
    if (!Array.isArray(prev)) setShapes((prev.shapes || []).map(normalizeShape));
    setSelectedId(null);
    setSelectedArrowId(null);
    setSelectedShapeId(null);
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
    letterStyle: { fontSize: currentLetterPt(), color: currentLetterColor(), bold: currentLetterBold() },
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
    setShapes([]);                   // …nor a line / rectangle / circle
    setSelectedArrowId(null);
    setSelectedShapeId(null);
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
    // Une CLÉ de composition NEUVE va avec : sans elle, la sauvegarde
    // reconnaîtrait ce canvas neuf comme… l'ancien, et l'écraserait.
    setCanvasEntries({});
    setCanvasLabel('');
    setCanvasKey(uid('cv'));
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

  // ── letter style: size / colour / bold are FIGURE settings ─────────────────
  // The letters of a figure always read alike, so the size is a FIGURE setting,
  // not a per-panel one: the controls (canvas options + fullscreen toolbar) write
  // the new size to ALL the objects at once — the user never has to repeat it
  // panel by panel. Colour and bold follow the very same rule: they are general
  // definitions of the figure too (the object window no longer offers them), so
  // no panel can be left looking different from its neighbours by accident.
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
  // Colour and bold of the letters — the same “ONE definition for every panel”
  // rule as the size, with the same fallbacks: this canvas › the selected panel ›
  // the first panel › the value typed last (a canvas with no panel left).
  const currentLetterColor = () => {
    const sel = (objects || []).find((o) => o.id === selectedId);
    const c = sel && sel.letterStyle ? String(sel.letterStyle.color || '').trim() : '';
    if (c) return c;
    const first = (objects || []).find((o) => o && o.letterStyle && String(o.letterStyle.color || '').trim());
    return first ? String(first.letterStyle.color) : letterStyleDefaults.color;
  };
  const currentLetterBold = () => {
    const sel = (objects || []).find((o) => o.id === selectedId);
    if (sel && sel.letterStyle && sel.letterStyle.bold !== undefined) return !!sel.letterStyle.bold;
    const first = (objects || []).find((o) => o && o.letterStyle && o.letterStyle.bold !== undefined);
    return first ? !!first.letterStyle.bold : letterStyleDefaults.bold;
  };
  const setLetterColorAll = (color) => {
    const c = String(color || '').trim() || '#000000';
    setLetterStyleDefaults((prev) => ({ ...prev, color: c }));
    setObjects(prev => prev.map(o => ({ ...o, letterStyle: { ...(o.letterStyle || {}), color: c } })));
  };
  const setLetterBoldAll = (bold) => {
    const b = !!bold;
    setLetterStyleDefaults((prev) => ({ ...prev, bold: b }));
    setObjects(prev => prev.map(o => ({ ...o, letterStyle: { ...(o.letterStyle || {}), bold: b } })));
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
    //
    // `fresh: true` = les pixels d'AUJOURD'HUI : une figure réécrite SUR PLACE
    // sur le Drive garde son identifiant, donc la même URL, et le navigateur peut
    // en avoir une copie d'avant. La vignette cliquée doit être l'image
    // OBTENUE — sans quoi on croit insérer un graphe et on en insère un autre.
    const fullSrc = item.full || item.url;
    const resolved = await resolveImageToDataUrl(fullSrc, { fresh: true }).catch(() => fullSrc);
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
        // Deux fichiers différents portent souvent le même nom (« Capture.png ») :
        // l'identité est donc celle du FICHIER (nom + taille + date), pour que le
        // second import ne remplace pas les pixels du premier dans le cloud, et
        // pour qu'un ré-import du même fichier réécrive bien le sien.
        const identity = `${f.name || ''}|${f.size || 0}|${f.lastModified || 0}`;
        // publishLibraryFigure uploads the real image to Drive and keeps only a
        // small local preview — the library list itself is memory-first, so a
        // full localStorage quota can never block an import again.
        const { entry, drive } = await publishLibraryFigure({
          scope,
          projectId: scope === 'project' ? activeLibProjectId : null,
          projectName: driveProjectName,
          dataUrl,
          label,
          src: null,
          identity
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
      else if (pickMode === 'swap') handleSwapImage(first);
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
    // `fresh: true` : la vignette cliquée est l'image INSÉRÉE (voir handlePickImage).
    const fullSrc = item.full || item.url;
    const resolved = await resolveImageToDataUrl(fullSrc, { fresh: true }).catch(() => fullSrc);
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

  // ── 🗂 WHICH PANEL IS ON TOP OF THE OTHERS ────────────────────────────────
  // The panels are PAINTED in the order of the `objects` list (see `objects.map`
  // in renderSvg): the LAST one covers the others wherever they overlap — which
  // happens as soon as a figure sticks out of its panel (free geometry). “⤒
  // Front” / “⤓ Back” move the selected panel inside that list. The letters
  // (A, B, C …) are assigned by POSITION (see renumberLetters), never by the
  // order of the list, so changing the depth never renames a panel.
  //
  // Two shadows exist and they are independent: the PANEL's (“Shadow (panel
  // frame)”, the whole group) and, per FIGURE, the picture's own (the 🌓 button
  // of the figure line / “Shadow of this figure” in the fold — it follows the
  // pixels of the image, see the figure-shadow filters of renderSvg).
  const moveObjInStack = (objId, to) => {
    const i = (objects || []).findIndex((o) => o.id === objId);
    if (i < 0) return;
    const dst = to === 'front' ? objects.length - 1 : 0;
    if (dst === i) return;   // already there: nothing to undo, nothing to write
    commitHistory();
    setObjects(prev => {
      const from = prev.findIndex((o) => o.id === objId);
      if (from < 0) return prev;
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      next.splice(Math.min(dst, next.length), 0, moved);
      return next;
    });
  };

  /* ── LA TAILLE EXACTE D'UNE FIGURE, AU CLAVIER ───────────────────────────────
     La poignée d'angle ne peut pas être précise sur une figure de quelques
     millimètres à l'écran (voir 🎯 Precision) : la figure ACTIVE peut donc aussi
     être réglée au pourcentage de son panneau, « W % / H % ». Seule une figure
     qui porte son propre rectangle (géométrie libre, c'est-à-dire après
     « ➕ Add figure ») a une boîte à taper ; une figure encore rangée par la grille
     se règle avec « Scale (%) » du panneau. */
  const writeFigureRect = (objId, idx, rect) => {
    if (idx < 0) return;
    setObjects(prev => prev.map(o => (o.id !== objId ? o
      : withImages(o, getObjImages(o).map((im, i) => (i === idx ? { ...im, rect } : im))))));
  };
  const setActiveFigBox = (patch) => {
    if (!selectedObj || cropPanelIdx < 0) return;
    const rect = freeRectOf(getObjImages(selectedObj)[cropPanelIdx]);
    if (!rect) return;
    const side = (v, fallback) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return fallback;
      return Math.max(RECT_MIN, Math.min(RECT_MAX, +(n / 100).toFixed(4)));
    };
    writeFigureRect(selectedObj.id, cropPanelIdx, {
      ...rect,
      w: side(patch.w, rect.w),
      h: side(patch.h, rect.h)
    });
  };
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
  /* SÉLECTION MULTIPLE DE TEXTES — même grammaire que pour les figures : les
     textes cochés « ☑ » d'un panneau rejoignent le groupe que les commandes ⇹
     rangent (avec les figures sélectionnées du MÊME panneau). L'outil
     d'alignement sert donc aux FIGURES et aux TEXTES d'un panneau — jamais aux
     PANNEAUX eux-mêmes : une grille de panneaux se règle en les déplaçant ou en
     les redimensionnant, pas en les alignant (voir utils/panelSelection.js,
     alignGroupPatches / distributeGroupPatches). */
  const [textGroup, setTextGroup] = useState({ objId: null, ids: [] });
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

  // ── 🎯 MOUSE PRECISION ─────────────────────────────────────────────────────
  // Sizing a figure or drawing a crop window by mouse is meant to land on the
  // exact tenth of a millimetre, but the pointer only moves in screen pixels —
  // whatever the zoom — and a small figure grows a lot from a small movement of
  // the hand. “🎯 Precision” (or holding SHIFT during the gesture) divides every
  // mouse delta by four, and a FIGURE handle follows only HALF of the pointer
  // (FIGURE_RESIZE_GAIN) so a twitch no longer flings the corner across the
  // panel. The exact size stays reachable at the keyboard: the “W % / H %”
  // fields of the active figure in the object window.
  const FINE_GAIN = 0.25;            // ÷4 while 🎯 Precision (or Shift) is on
  const FIGURE_RESIZE_GAIN = 0.5;    // a figure’s corner follows ½ of the pointer
  const [fineMode, setFineMode] = useState(false);
  // `onDrag` is a closure captured when the drag starts: a ref keeps the switch
  // readable live, so flipping it (or pressing Shift) hones the gesture already
  // under way.
  const fineModeRef = useRef(false);
  const toggleFineMode = () => { fineModeRef.current = !fineModeRef.current; setFineMode(fineModeRef.current); };

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

  // ── FOND TRANSPARENT D'UNE FIGURE ──────────────────────────────────────────
  // « Remove the background » : la couleur du fond (celle qu'on clique sur
  // l'aperçu, ou les quatre coins) devient TRANSPARENTE — un vrai travail sur
  // les pixels (utils/figureBackground.js), écrit sur la figure elle-même
  // (`im.imgSrc` + `im.imgThumb`, donc aussi la vignette persistée). Ctrl+Z
  // remet l'image d'origine : une seule étape d'historique.
  const [bgTol, setBgTol] = useState(BG_DEFAULT_TOL); // tolérance (unités de distance RGB)
  const [bgMode, setBgMode] = useState('flood');      // 'flood' = le fond touchant les bords · 'all' = partout
  const [bgKey, setBgKey] = useState('');             // la couleur choisie sur l'aperçu
  const [bgBusy, setBgBusy] = useState(false);
  const [bgMsg, setBgMsg] = useState('');
  const bgPixelsRef = useRef(null);                   // { src, pixels } — les pixels déjà lus (relecture inutile)

  // ── LE TEXTE CHOISI DANS LE PANNEAU ────────────────────────────────────────
  // Cliquer un texte sur le canvas (ou son numéro dans la liste) le CHOISIT :
  // il est encadré à l'écran, sa ligne s'allume, et « ⧉ Copy » le duplique juste
  // à côté — prêt à être modifié et déplacé.
  const [activeText, setActiveText] = useState(null); // { objId, txId }

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

  /* ── L'ÉCRITURE D'UNE FIGURE (n'importe quel champ) ─────────────────────────
     Un seul chemin d'écriture, comme writeFigureRect : les pixels (fond
     transparent), l'ombre de la figure, les références de bibliothèque après un
     échange d'image… tout passe par ici, donc tout survit à la copie persistée
     (withImages remet la première figure dans les champs historiques). */
  const patchFigure = (objId, idx, patch) => {
    if (idx < 0) return;
    setObjects(prev => prev.map(o => (o.id !== objId ? o
      : withImages(o, getObjImages(o).map((im, i) => (i === idx ? { ...im, ...patch } : im))))));
  };

  /* ── 🌓 L'OMBRE DE LA FIGURE (l'image, pas le cadre) ────────────────────────
     Le dessin existait déjà (filtre <feDropShadow> posé sur un groupe qui
     ENVELOPPE l'image : l'ombre suit les pixels — donc l'alpha — de la figure,
     pas son rectangle, ce que le 🎨 détourage rend enfin visible sur un JPEG).
     Il ne manquait que la commande : elle vit sur la ligne des figures (le
     bouton 🌓, un seul clic) et dans « ▾ More options » (tous les réglages).
     Le réglage est PAR FIGURE — un panneau peut montrer une molécule détourée
     avec son ombre à côté d'un graphe qui n'en a pas. */
  const toggleActiveFigureShadow = () => {
    if (!selectedObj || cropPanelIdx < 0) return;
    const im = getObjImages(selectedObj)[cropPanelIdx];
    if (!im) return;
    commitHistory();
    patchFigure(selectedObj.id, cropPanelIdx, { shadow: shadowSpec(im.shadow) ? null : { ...DEFAULT_SHADOW } });
  };

  /* ── 🎨 LE FOND D'UNE FIGURE DEVIENT TRANSPARENT ────────────────────────────
     See utils/figureBackground.js. On ne peut pas détourer une image en SVG :
     c'est un vrai travail sur les PIXELS, fait ici une fois pour toutes :
       1. les pixels de la source sont lus dans un canvas (borné) et GARDÉS : la
          tolérance se règle après avoir cliqué le fond, on ne relit pas l'image
          à chaque cran ;
       2. les pixels de la couleur visée passent à alpha 0 (le fond connexe aux
          bords, ou partout) et le bord est adouci ;
       3. le canvas est ré-exporté en PNG — c'est ce PNG qui devient l'image de
          la figure (`imgSrc` ET `imgThumb`, donc aussi la vignette persistée) ;
       4. Ctrl+Z remet l'image d'origine. */
  const loadImagePixels = (src) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const { width, height } = bgPixelSize(img.naturalWidth, img.naturalHeight);
        const cv = document.createElement('canvas');
        cv.width = width;
        cv.height = height;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, width, height);
        resolve({ data: ctx.getImageData(0, 0, width, height).data, width, height });
      } catch { resolve(null); }        // canvas « tainted » : image d'un autre site
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
  // Les pixels d'une figure, du côté SOURCE (le plein format : une vignette ne
  // dit rien d'une couleur de fond) — relus seulement quand la source change.
  const bgPixelsOf = async (src) => {
    const cached = bgPixelsRef.current;
    if (cached && cached.src === src && cached.pixels) return cached.pixels;
    const full = await resolveImageToDataUrl(src).catch(() => src);
    const pixels = await loadImagePixels(full);
    bgPixelsRef.current = pixels ? { src, pixels } : null;
    return pixels;
  };
  const bgFigSrcOf = (im) => (im && (im.imgSrc || im.imgThumb)) || '';
  const bgActiveFig = () => {
    if (!selectedObj || cropPanelIdx < 0) return { obj: null, idx: -1, im: null };
    return { obj: selectedObj, idx: cropPanelIdx, im: getObjImages(selectedObj)[cropPanelIdx] || null };
  };
  const bgUnreadableMsg = () => '⚠️ These pixels cannot be read one by one — the image is served by another site. Store the figure in your image library (🖼 Image Library → ⬆ Upload from PC, or a capture) and remove the background from that copy.';
  const keyHex = (k) => { const rgb = hexToRgb(k); return rgbToHex(rgb || k); };

  // Cliquer le FOND sur l'aperçu : la couleur sous le curseur devient la clé.
  const pickBackgroundAt = async (e) => {
    const { idx, im } = bgActiveFig();
    const src = bgFigSrcOf(im);
    if (idx < 0 || !src) return;
    const box = e.currentTarget.getBoundingClientRect();
    const pixels = await bgPixelsOf(src);
    if (!pixels) { setBgMsg(bgUnreadableMsg()); return; }
    const x = Math.max(0, Math.min(pixels.width - 1, Math.floor(((e.clientX - box.left) * pixels.width) / Math.max(1, box.width))));
    const y = Math.max(0, Math.min(pixels.height - 1, Math.floor(((e.clientY - box.top) * pixels.height) / Math.max(1, box.height))));
    const off = (y * pixels.width + x) * 4;
    const hex = rgbToHex([pixels.data[off], pixels.data[off + 1], pixels.data[off + 2]]);
    setBgKey(hex);
    setBgMsg(`🎯 Background colour ${hex} — “🎨 Remove background” takes it off (tolerance ${bgTol}).`);
  };

  // « 🎨 Remove background » : la couleur visée (ou les quatre coins) s'en va.
  const removeFigureBackground = async (auto = false) => {
    const { obj, idx, im } = bgActiveFig();
    const src = bgFigSrcOf(im);
    if (!obj || idx < 0 || !src) return;
    setBgBusy(true);
    try {
      const pixels = await bgPixelsOf(src);
      if (!pixels) { setBgMsg(bgUnreadableMsg()); return; }
      const keys = auto ? cornerColors(pixels) : (bgKey ? [bgKey] : []);
      if (!keys.length) {
        setBgMsg(auto
          ? 'This figure already has transparent corners — nothing to remove automatically: click the background colour on the picture above.'
          : '🎯 Click the background colour on the picture above first (or “Auto: the four corners”).');
        return;
      }
      const { removed, mask } = removeBackgroundKey({ ...pixels, key: keys, tol: bgTol, mode: bgMode });
      if (!removed) {
        setBgMsg('Nothing matched that colour on this figure — raise the tolerance, or click the background again.');
        return;
      }
      const soft = softenBackgroundEdges({ ...pixels, key: keys, tol: bgTol, mask });
      const cv = document.createElement('canvas');
      cv.width = pixels.width;
      cv.height = pixels.height;
      cv.getContext('2d').putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
      const out = cv.toDataURL('image/png');
      commitHistory();
      patchFigure(obj.id, idx, {
        imgSrc: out,
        imgThumb: out,                                   // la vignette persistée porte le détourage
        bg: { color: keyHex(keys[0]), tol: bgTol, mode: bgMode }
      });
      // Les pixels du NOUVEAU fichier sont ceux qu'on vient d'écrire : la clé
      // suivante se clique sans relire l'image.
      bgPixelsRef.current = { src: out, pixels };
      setBgMsg(`✅ Background removed — ${removed} pixel${removed === 1 ? '' : 's'} became transparent${soft ? `, ${soft} softened along the edge` : ''} (${keyHex(keys[0])}, tolerance ${bgTol}, ${bgMode === 'all' ? 'everywhere' : 'the background touching the borders'}). Place, size, crop and shadow are untouched; Ctrl+Z puts the original image back.`);
    } catch (err) {
      setBgMsg(`⚠️ The background could not be removed: ${(err && err.message) || 'unknown error'}`);
    } finally {
      setBgBusy(false);
    }
  };

  /* ── ↔ ÉCHANGER L'IMAGE D'UNE FIGURE (même place, même taille) ──────────────
     « ↺ Replace » remplace TOUT le panneau (une seule figure, remise à
     l'échelle du cadre) : ce n'est pas ce qu'on veut quand la figure est déjà
     réglée. « ↔ Swap » ne change QUE les pixels : le CADRE de la figure (son
     rectangle libre, ou la cellule de la grille) ne bouge pas — on SUBSTITUE
     l'image, on ne refait pas le panneau. En revanche tout ce qui décrivait les
     ANCIENS pixels est oublié : la fenêtre de recadrage, le décalage, l'échelle,
     les traits de gomme et le détourage. Les garder montrait un MORCEAU de la
     nouvelle image, décalé, ou gommé ailleurs — c'est le « l'aperçu ne
     correspond pas à ce qui est inséré dans l'objet » signalé. La nouvelle image
     s'affiche donc entière, dans le même cadre, avec ses propres proportions.
     L'ombre de la figure et son réglage d'image (contraste, saturation…)
     restent : ce sont des réglages esthétiques, ils ne décrivent pas les
     pixels. */
  const handleSwapImage = async (item) => {
    const obj = (objects || []).find((o) => o.id === selectedId);
    const idx = obj ? activeFigIdx(obj) : -1;
    if (!obj || idx < 0) { setLibMsg('Select a panel and one of its figures first, then ↔ Swap replaces that figure’s image.'); return; }
    commitHistory();
    // `fresh: true` : la vignette cliquée est l'image INSÉRÉE (voir handlePickImage).
    const fullSrc = item.full || item.url;
    const resolved = await resolveImageToDataUrl(fullSrc, { fresh: true }).catch(() => fullSrc);
    const src = String(resolved || '').startsWith('data:')
      ? resolved
      : (item.url && String(item.url).startsWith('data:') ? item.url : resolved);
    patchFigure(obj.id, idx, {
      imgSrc: src,
      imgThumb: (item.url && String(item.url).startsWith('data:')) ? item.url : src,
      libScope: libraryTab,
      libProjectId: libraryTab === 'project' ? activeLibProjectId : null,
      libId: item.id,
      src: item.src || null,
      /* Seule la figure change de pixels (voir le commentaire de la commande) :
         le CADRE reste, mais tout ce qui décrivait les ANCIENS pixels s'en va.
         `crop` : la fenêtre de recadrage de l'ancienne image ne veut plus rien
         dire — la garder montrait un MORCEAU de la nouvelle (c'est exactement
         « l'aperçu ne correspond pas à ce qui est inséré »).
         `dx` / `dy` / `scale` : le décalage et le zoom de l'ancienne image.
         `erase` : les traits de gomme sont en coordonnées de l'ANCIENNE image,
         ils gommeraient n'importe où.
         `bg` (détourage) : il décrivait la couleur de fond de l'ancienne. */
      crop: null,
      dx: 0, dy: 0, scale: 1,
      erase: null,
      bg: null
    });
    bgPixelsRef.current = null;
    setLibMsg(`↔ Figure ${idx + 1} of panel ${obj.letter || ''} now shows “${item.label || 'the new image'}” — same frame (place and size kept), and the crop window, the shift/zoom and the eraser strokes of the OLD picture were cleared, so you see the WHOLE new image with its own proportions (Ctrl+Z puts the old image back). The window stays open: swap another figure, or pick “➕ Add” / “↺ Replace”.`);
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
  /* Les TEXTES cochés « ☑ » du panneau : même forme que la sélection de
     figures, autre liste (l'id d'un texte, pas son index). */
  const textGroupOf = (objId) => (textGroup.objId === objId ? textGroup.ids : []);
  const toggleTextGroup = (objId, txId) => setTextGroup((prev) => {
    const cur = prev.objId === objId ? prev.ids : [];
    return { objId, ids: cur.includes(txId) ? cur.filter((t) => t !== txId) : [...cur, txId] };
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
  // indices only mean something inside the panel they were taken in. The TEXT
  // chosen in the panel follows the same rule (its id belongs to that panel).
  useEffect(() => {
    setFigGroup((prev) => (prev.objId && prev.objId !== selectedId ? { objId: null, idxs: [] } : prev));
    setTextGroup((prev) => (prev.objId && prev.objId !== selectedId ? { objId: null, ids: [] } : prev));
    setActiveText((prev) => (prev && prev.objId !== selectedId ? null : prev));
  }, [selectedId]);

  /* ── ⇹ ALIGNER / RÉPARTIR LES ÉLÉMENTS SÉLECTIONNÉS ─────────────────────────
     « Align them horizontally, vertically or center them » et « distribute them
     horizontally or vertically » : les éléments COCHÉS « ☑ » se rangent les uns
     par rapport aux autres — les figures cochées (la figure ACTIVE l'est
     d'office, elle en sort d'un clic) ET les textes cochés. Le groupe peut donc
     être fait de plusieurs textes sans figure, de plusieurs figures, ou des deux.

     Deux points que le code doit dire :

       • l'alignement se fait sur la BOÎTE DU GROUPE (le bord le plus à gauche de
         tous, son milieu…) : l'extrême ne bouge pas, et la commande est
         symétrique — aligner à gauche puis à droite ramène les figures
         exactement où elles étaient (voir utils/panelSelection.js) ;
       • une figure encore rangée par la GRILLE n'a pas de boîte : tout le
         panneau est donc GELÉ d'abord (freezeFigures — chacune reçoit la boîte
         exacte qu'elle montre). Aligner ne doit pas être le moment où le panneau
         se re-flowe : rien ne bouge, on ne fait que rendre les boîtes réglables.
         « ⊞ Lay the figures out in a grid » remet la grille quand on veut. */
  const figGroupIdxs = (obj) => figGroupOf(obj.id)
    .filter((i) => Number.isInteger(i) && i >= 0 && i < getObjImages(obj).length);
  /* Ce que les commandes ⇹ rangent dans ce panneau : les TEXTES cochés « ☑ »
     qui existent encore (un texte supprimé ne doit pas rester dans le groupe) et,
     avec eux, les figures COCHÉES. Un groupe peut donc être fait de figures
     seules, de textes seuls, ou des deux — c'est la demande : « il peut aussi
     s'agir de plusieurs textes sans figure, ou de plusieurs figures ». */
  const selectedTextGroup = (obj) => (obj
    ? textGroupOf(obj.id).filter((id) => (obj.texts || []).some((tx) => tx.id === id))
    : []);
  const layoutGroupSize = (obj) => (obj ? figGroupIdxs(obj).length + selectedTextGroup(obj).length : 0);
  /* LA FIGURE ACTIVE EST COCHÉE D'OFFICE — mais elle PEUT être décochée. Sans
     cela, un panneau qui porte une figure ne pouvait jamais ranger ses TEXTES
     seuls : la figure active était d'office du groupe, donc un « 1 figure et 1
     texte » qu'on ne pouvait pas défaire. Elle reste la référence des poignées
     (🎯), elle sort seulement du groupe que ⇹ range. */
  useEffect(() => {
    const obj = (objectsRef.current || []).find((o) => o.id === selectedId);
    if (!obj) return;
    const ref = activeFigIdx(obj);
    if (ref < 0) return;
    setFigGroup((prev) => {
      const cur = prev.objId === obj.id ? prev.idxs : [];
      if (cur.includes(ref)) return prev;
      return { objId: obj.id, idxs: [...cur, ref] };
    });
    // Le panneau tenu ou la référence changent SEULS : c'est ce qui (re)met la
    // figure active dans le groupe. Dépendre de `objects` la remettrait à chaque
    // déplacement — impossible alors de la sortir du groupe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, activeFig && activeFig.objId, activeFig && activeFig.idx]);
  /* La boîte d'un TEXTE, en fractions du panneau — le MÊME repère que le
     rectangle libre d'une figure : `x` / `y` sont les millimètres du texte dans
     le panneau, la largeur est ESTIMÉE (le navigateur garde la mesure pour lui,
     exactement comme pour le cadre de sélection du texte : 0,58 × le corps par
     caractère) et la hauteur est celle de la ligne (corps × 1,3). Un texte se
     range donc avec des figures sans rien mesurer. */
  const textBoxOf = (obj, tx) => {
    const panelW = Math.max(1, obj.w * cellW);
    const panelH = Math.max(1, obj.h * cellH);
    const fs = ptToMm(tx.fontSize || 12);
    const estW = Math.max(4, String(tx.text || '').length * fs * 0.58);
    return {
      x: (Number(tx.x) || 0) / panelW,
      y: ((Number(tx.y) || 0) - fs) / panelH,
      w: estW / panelW,
      h: (fs * 1.3) / panelH
    };
  };
  /* Les boîtes du groupe mixte d'un panneau : les figures (gelées au passage,
     donc chacune porte la boîte exacte qu'elle montre) et les textes cochés.
     L'identifiant dit de quoi il s'agit : `f3` = figure 3, `t<id>` = texte. */
  const layoutItemsOf = (obj, pinned, group, texts) => {
    const items = [];
    group.forEach((i) => {
      const r = freeRectOf(pinned[i]);
      if (r) items.push({ id: `f${i}`, box: r });
    });
    const byId = new Map((obj.texts || []).map((tx) => [tx.id, tx]));
    texts.forEach((id) => {
      const tx = byId.get(id);
      if (tx) items.push({ id: `t${id}`, box: textBoxOf(obj, tx) });
    });
    return items;
  };
  const applyFigureLayout = (kind, mode) => {
    const obj = selectedObj;
    if (!obj) return;
    const group = figGroupIdxs(obj);
    const texts = selectedTextGroup(obj);
    if (group.length + texts.length < 2) return;
    /* ── FIGURES SEULES : le chemin historique, inchangé. Tout le panneau est
       d'abord GELÉ (une figure encore rangée par la grille reçoit la boîte
       exacte qu'elle montre) : aligner n'est jamais le moment où le panneau se
       re-flowe. ── */
    if (!texts.length) {
      const patchesOn = (list) => {
        const figs = group.map((i) => ({ idx: i, rect: freeRectOf(list[i]) })).filter((f) => f.rect);
        return kind === 'align' ? alignFiguresPatches(figs, mode) : distributeFiguresPatches(figs, mode);
      };
      // Déjà rangées → ni écriture, ni étape d'historique (comme ⬆ / ⬇ de
      // l'empilement : une commande sans effet ne doit rien coûter).
      if (!Object.keys(patchesOn(freezeFigures(obj, getObjImages(obj)))).length) return;
      commitHistory();
      setObjects(prev => prev.map((o) => {
        if (o.id !== obj.id) return o;
        const pinned = freezeFigures(o, getObjImages(o));
        const patches = patchesOn(pinned);
        if (!Object.keys(patches).length) return o;
        return withImages(o, pinned.map((im, i) => (patches[i] ? { ...im, ...patches[i] } : im)));
      }));
      return;
    }
    /* ── FIGURES **ET** TEXTES (ou textes seuls) : toutes les boîtes dans le
       même repère, puis les MÊMES commandes pures que pour les figures seules
       (utils/panelSelection → alignGroupPatches / distributeGroupPatches). ── */
    let changed = false;
    const next = (objects || []).map((o) => {
      if (o.id !== obj.id) return o;
      const pinned = freezeFigures(o, getObjImages(o));
      const patches = kind === 'align'
        ? alignGroupPatches(layoutItemsOf(o, pinned, group, texts), mode)
        : distributeGroupPatches(layoutItemsOf(o, pinned, group, texts), mode);
      if (!Object.keys(patches).length) return o;
      changed = true;
      const panelW = Math.max(1, o.w * cellW);
      const panelH = Math.max(1, o.h * cellH);
      // Les figures reçoivent x / y du patch (leur taille ne change pas).
      const images = pinned.map((im, i) => {
        const p = patches[`f${i}`];
        return p ? { ...im, rect: { ...freeRectOf(im), ...p } } : im;
      });
      // Les textes repassent en millimètres : y est le HAUT de leur boîte, or un
      // texte se pose par sa LIGNE DE BASE (la même que le canvas dessine).
      const nextTexts = (o.texts || []).map((tx) => {
        const p = patches[`t${tx.id}`];
        if (!p) return tx;
        const fs = ptToMm(tx.fontSize || 12);
        return { ...tx, x: +(p.x * panelW).toFixed(1), y: +((p.y * panelH) + fs).toFixed(1) };
      });
      return { ...withImages(o, images), texts: nextTexts };
    });
    if (!changed) return;
    commitHistory();
    setObjects(next);
  };

  /* ── DÉPLACER LE GROUPE TOUT ENTIER, PAR PETITS PAS (clavier) ────────────────
     « Quand ils sont sélectionnés et alignés, j'aimerais pouvoir les déplacer
     progressivement, tous ensemble. » Les flèches du clavier décalent de la MÊME
     quantité TOUT ce que ⇹ range — les figures cochées ET les textes cochés — de
     0,5 mm par appui (5 mm avec Shift). L'écart posé par l'alignement est donc
     conservé pendant le déplacement, que l'on peut faire « au millimètre près »
     au lieu de tout re-glisser à la souris. Chaque appui est une étape
     d'historique (Ctrl+Z revient d'un cran).
     Les fonctions pures de utils/panelSelection font le calcul, exactement comme
     le glissement groupé à la souris : une figure libre reçoit son rectangle, une
     figure encore en grille son décalage en millimètres. */
  const NUDGE_MM = 0.5;
  const NUDGE_MM_COARSE = 5;
  const nudgeFigureGroup = (dxMm, dyMm) => {
    const obj = selectedObj;
    if (!obj || dragState.current) return false;          // jamais pendant un glissement
    const group = figGroupIdxs(obj);
    const texts = selectedTextGroup(obj);
    // Moins de deux éléments : il n'y a pas de groupe à déplacer « ensemble » —
    // le clavier reste alors au reste de la page.
    if (group.length + texts.length < 2) return false;
    commitHistory();
    setObjects((prev) => prev.map((o) => {
      if (o.id !== obj.id) return o;
      const imgs = getObjImages(o);
      const figs = group
        .filter((i) => i >= 0 && i < imgs.length)
        .map((i) => ({
          idx: i,
          rect: freeRectOf(imgs[i]),
          dx: Number(imgs[i] && imgs[i].dx) || 0,
          dy: Number(imgs[i] && imgs[i].dy) || 0
        }));
      const patches = figs.length
        ? moveFiguresPatches(figs, { dxMm, dyMm, panelWmm: o.w * cellW, panelHmm: o.h * cellH })
        : {};
      const moved = withImages(o, imgs.map((im, i) => (patches[i] ? { ...im, ...patches[i] } : im)));
      if (!texts.length) return moved;
      // Un texte se déplace en millimètres, comme sous la souris (type « text »).
      return {
        ...moved,
        texts: (o.texts || []).map((tx) => (texts.includes(tx.id)
          ? { ...tx, x: +((Number(tx.x) || 0) + dxMm).toFixed(2), y: +((Number(tx.y) || 0) + dyMm).toFixed(2) }
          : tx))
      };
    }));
    return true;
  };
  // Le clavier du groupe : installé avec l'état qu'il lit (sélection, groupe,
  // panneau tenu), donc un appui agit toujours sur ce qui est à l'écran. Jamais
  // pendant une saisie (un champ, un texte en cours d'édition) : les flèches y
  // déplacent le curseur.
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;      // Ctrl+Z & co. restent à eux
      const step = e.shiftKey ? NUDGE_MM_COARSE : NUDGE_MM;
      const dxMm = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dyMm = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      if (!dxMm && !dyMm) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (editingText || editingObjCaption || editingCaption) return;
      if (!nudgeFigureGroup(dxMm, dyMm)) return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objects, selectedIds, figGroup, textGroup, activeFig, editingText, editingObjCaption, editingCaption]);

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
    const label = String(name || '').trim();
    if (label) {
      // Le refus du navigateur (magasin plein) se DIT : sinon le libellé paraît
      // changé puis revient tout seul au rechargement suivant.
      const kept = libraryTab === 'project'
        ? renameProjectLibraryItem(activeLibProjectId, id, label)
        : renameLibraryItem(id, label);
      setLibVersion((v) => v + 1);
      setLibMsg(kept === false
        ? `⚠️ “${label}” is kept in this session only: this browser’s store is full, so the new name would be lost on a refresh. Free room (☁ Save figures to Drive, or delete images you no longer need), then rename again.`
        : `✏️ Renamed to “${label}”.`);
      /* LE NOM DU FICHIER SUR LE DRIVE SUIT ce renommage (voir
         renameFigureOnDrive) : une image déjà sur le cloud est renommée SUR
         PLACE — même fichier, donc aucun lien ne casse et aucune copie ne reste
         dans le dossier sous l’ancien nom. */
      const cloudScope = libraryTab === 'project'
        ? {
          scope: 'project',
          projectId: activeLibProjectId,
          projectName: String((allProjects.find((p) => p.id === activeLibProjectId) || {}).name || '')
        }
        : { scope: 'common', projectId: null, projectName: '' };
      renameFigureOnDrive({ ...cloudScope, id, label })
        .then((r) => {
          if (!r || !r.ok || r.unchanged) return;
          setLibMsg((m) => `${m} 📁 On Drive, “${r.from}” is now “${r.name}” (same file — its link and its composition follow it).`);
        })
        .catch(() => {});
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
        : res.failed === 0 && res.queued === 0
          ? `✓ ${res.uploaded} image${res.uploaded === 1 ? '' : 's'} saved to ${res.folder}.`
          : `${res.failed ? '⚠' : '⏳'} ${[
            res.uploaded ? `${res.uploaded} image${res.uploaded === 1 ? '' : 's'} saved to ${res.folder}` : '',
            res.queued ? `${res.queued} queued for ${res.folder} — they upload by themselves as soon as Drive answers, nothing is lost` : '',
            res.failed ? `${res.failed} failed — check the connection and try again` : ''
          ].filter(Boolean).join(' · ')}.`);
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
      const restoredNote = res.restored
        ? ` · 🖼 ${res.restored} canvas${res.restored === 1 ? '' : 'es'} recovered with their editable composition (reopen them here with “↩ Load”, or from the project page)`
        : '';
      setLibMsg(res.error
        ? `⚠ ${res.error}`
        : res.found === 0
          ? `No image found in ${res.folder} (nothing has been uploaded there yet — use ☁ Save to Drive first).`
          : res.added === 0
            ? `✓ ${res.found} image${res.found === 1 ? '' : 's'} in ${res.folder} — all already listed here${restoredNote || '.'}`
            : `✓ ${res.added} image${res.added === 1 ? '' : 's'} added from ${res.folder} (${res.found} file${res.found === 1 ? '' : 's'} in the folder)${restoredNote || '.'}`);
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
    // L'entrée de CE canvas dans cette portée (souvenir, sinon clé de composition
    // — voir canvasEntryFor) : la publication la met à jour sur place.
    const known = canvasEntryFor(target);
    const { entry, drive, updated } = await publishLibraryFigure({
      scope: target ? 'project' : 'common',
      projectId: target,
      projectName: driveProject ? String(driveProject.name || '') : '',
      dataUrl: img,
      label: String(label || 'Canvas').trim(),
      src: null,
      updateId: known ? known.id : null,
      canvasData: {
        // La clé de composition part avec la composition (et donc dans le
        // sidecar `.meta.json` du Drive) : c'est l'identité qui permet de la
        // retrouver — une copie, jamais deux.
        canvasKey,
        canvasW, canvasH, gridCols, gridRows, showPanelBorders, showGridLines, keepAspect, globalCaption,
        // La définition GÉNÉRALE des lettres (taille, couleur, gras) fait partie
        // du canvas : un canvas rouvert — même vide — retrouve ses lettres.
        letterStyle: { fontSize: currentLetterPt(), color: currentLetterColor(), bold: currentLetterBold() },
        objects: (objects || []).map(thumbnailsOf),
        arrows: arrows || [],
        shapes: shapes || []
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
    /* QUEL PROJET — il n'y a plus d'autre destination : un canvas vit dans le
       projet qui le porte (demande : « les canvas ne doivent pas être
       enregistrés dans la bibliothèque, mais seulement dans le projet
       associé »). On propose, dans l'ordre, le projet qui porte DÉJÀ ce canvas,
       celui avec lequel l'éditeur a été ouvert, celui d'une copie enregistrée
       ailleurs, puis le premier projet où l'on peut écrire. Seuls les projets
       MODIFIABLES sont proposés : un projet en lecture seule ne reçoit rien. */
    const own = [canvasHome, projectId, ...Object.keys(canvasEntries || {})]
      .filter((id) => id && id !== 'dataset');
    const proposed = own.find((id) => canWriteLibProject(id))
      || ((myWritableProjects[0] && myWritableProjects[0].id) || '');
    setSaveDest(proposed);
    setSaveMsg('');
    setSaveOpen(true);
  };

  // Save / re-save the WHOLE canvas (composition) in ONE destination. The
  // rendered image is uploaded to the cloud (same <project>/images path as every
  // other figure); only a small local preview + the editable canvas snapshot are
  // kept in the browser, so a full localStorage quota never blocks a save.
  // Shared by the dialog (“▾ Choose where…” → “💾 Save now”) and by the
  // one-click “💾 Save now” into the canvas' own project (saveCanvasNow).
  // ⛔ SANS PROJET, RIEN N'EST ÉCRIT : le canvas n'a plus de destination
  //    « bibliothèque partagée du dataset » (voir le commentaire de
  //    openSaveDialog) — on le dit, on ne l'écrit pas ailleurs en douce.
  const finishCanvasSave = async (destProjectId, label) => {
    if (!destProjectId) {
      setSaveMsg('📁 Choose the PROJECT that owns this canvas first: a canvas is stored in a project’s image library (its Project tab, that project page’s “🖼 Saved canvases”, and the cloud) — it is never stored in the shared dataset library.');
      return;
    }
    setSaveBusy(true);
    setSaveMsg('📤 Saving the canvas (image + editable copy, right now)…');
    try {
      const pub = await publishCanvas({ label, targetProjectId: destProjectId, dataUrl: null });
      if (!pub || !pub.entry) {
        setSaveMsg(destProjectId && !canWriteLibProject(destProjectId)
          ? '🔒 You do not have edit access to that project’s image library — pick another project (a canvas lives in a project).'
          : '⚠️ Could not save the canvas in that project’s library.');
        return;
      }
      const what = pub.updated ? 'updated' : 'saved';
      const where = `in the “${canvasScopeName(destProjectId)}” image library (Image Library → Project tab — and on that project page under “🖼 Saved canvases”, where it reopens here)`;
      const folderLabel = projectImagesFolderLabel(canvasScopeName(destProjectId), getDriveRootName());
      // Où la copie cloud a abouti — et sinon POURQUOI, en distinguant « mis en
      // file d'attente » (l'image repartira toute seule) d'un échec définitif :
      // un « browser copy only » muet ne dit pas si le travail est en sécurité.
      let detail;
      if (pub.drive && pub.drive.id) detail = `☁ cloud copy in ${folderLabel} (with its editable copy, so it reopens on any computer)`;
      else if (pub.driveQueued) detail = `⏳ cloud copy not sent yet (${pub.driveError || 'cloud unreachable'}) — it is QUEUED and will be uploaded automatically; nothing is lost`;
      else if (!localStorageHealthy()) detail = `⚠️ browser storage full and no cloud copy${pub.driveError ? ` (${pub.driveError})` : ''} — connect Google Drive or Nextcloud so it is kept there (this session still works)`;
      else detail = `💾 browser copy only${pub.driveError ? ` — ${pub.driveError}` : ''} (connect Google Drive or Nextcloud so it follows you to another computer)`;
      // Show the user WHERE it landed: the library opens on that project's tab.
      setLibraryTab('project');
      setLibProjectId(destProjectId);
      setShowLibrary(true);
      setLibMsg(`✅ Canvas ${what} right now ${where} · ${detail}`);
      setSaveOpen(false);
      setSaveMsg('');
    } catch (err) {
      console.warn('Canvas save failed:', err && err.message);
      setSaveMsg('⚠️ Could not save the canvas — please connect Google Drive and try again.');
    } finally {
      setSaveBusy(false);
    }
  };

  /* ── « 💾 Save canvas » : LE BOUTON QUI SAUVE DANS LE PROJET ──────────────────
     La composition appartient à un PROJET : elle porte déjà son entrée (le badge
     « 🖼 … » en haut de l'éditeur) ou l'éditeur a été ouvert depuis un projet. Le
     bouton la sauve LÀ, en un clic — pas de dialogue à passer pour un geste qu'on
     répète. Quand il n'y a PAS de projet à qui l'écrire (le builder s'ouvre aussi
     sans projet, et un projet où l'on n'a pas le droit d'écrire ne compte pas), le
     dialogue s'ouvre et demande LEQUEL : c'est la seule façon de sauver, jamais
     une écriture silencieuse dans un endroit que l'utilisateur n'a pas choisi. */
  const canvasSaveProject = () => {
    if (canvasHome && canWriteLibProject(canvasHome)) return canvasHome;
    if (projectId && canWriteLibProject(projectId)) return projectId;
    const stored = Object.keys(canvasEntries || {}).find((k) => k !== 'dataset');
    if (stored && canWriteLibProject(stored)) return stored;
    return null;
  };
  const saveCanvasNow = async () => {
    const dest = canvasSaveProject();
    if (!dest) { openSaveDialog(); return; }   // no project yet → which one?
    await finishCanvasSave(dest, canvasLabel || autoSaveLabel());
  };
  // The dialog's own button: the destination is what the dialog is for, so the
  // name is read there and the chosen place is honoured (dataset library too).
  const doSaveCanvas = async () => {
    const label = String(saveName || '').trim();
    if (!label) { setSaveMsg('⚠️ Give the canvas a name first.'); return; }
    await finishCanvasSave(saveDest || null, label);
  };

  /* ── SAUVEGARDE AUTOMATIQUE DU CANVAS ────────────────────────────────────────
     Une composition ne doit pas dépendre du souvenir de cliquer « 💾 Save
     canvas » : on travaille, on insère dans le projet, on quitte — et la
     composition doit rester dans la bibliothèque d'images (donc sur la page du
     projet, sous « 🖼 Saved canvases », et dans la bibliothèque d'images) ET
     sur le Drive, pour être ROUVERTE et modifiée plus tard.

     Deux passes, pour ne jamais payer un rendu pour une frappe :
       • instantanée (2,5 s après la dernière modification, et au moment où l'on
         quitte la page) : la composition ÉDITABLE est écrite dans l'entrée de
         bibliothèque — celle du canvas s'il en a une, sinon celle du projet
         ouvert (quand on peut y écrire). Sans projet : RIEN n'est écrit dans la
         bibliothèque partagée du dataset (les canvas vivent dans un projet) —
         la composition reste dans ce navigateur et la pastille le dit.
         Aucun rendu, aucun envoi : rien à attendre, rien à perdre si l'on ferme.
       • cloud (au plus une fois par minute, après 8 s de calme) : la MÊME
         entrée est publiée par le chemin de « 💾 Save canvas » — l'image part
         dans projects/<projet>/images avec sa copie éditable `.meta.json` (voir
         figuresLibrary), ce qui rend le canvas rouvrable même depuis un autre
         ordinateur, ou après avoir vidé le navigateur.

     `canvasEntries` reste la source de vérité : la première passe retient
     l'entrée créée, les suivantes la mettent à jour EN PLACE — les liens
     « ✏️ Modify in Image Builder » des pages de projet continuent de la viser
     et aucune bibliothèque ne se remplit de copies. */
  const AUTO_SNAPSHOT_MS = 2500;      // calme avant d'écrire la composition
  const AUTO_PUBLISH_QUIET_MS = 8000; // calme avant d'envoyer l'image au cloud
  const AUTO_PUBLISH_MS = 60000;      // intervalle minimum entre deux envois
  const [autoSaveAt, setAutoSaveAt] = useState('');
  const [autoSaveNote, setAutoSaveNote] = useState('');   // 'draft' | 'cloud' | 'queued' | 'browser'
  const autoSaveRef = useRef(null);
  const lastPublishAtRef = useRef(0);
  const autoSaveKeyRef = useRef('');

  // Où cette composition doit vivre : l'entrée qu'elle a déjà (un canvas est
  // « chez lui » là où on l'a repris — y compris un canvas HISTORIQUE du dataset,
  // dont l'entrée continue d'être mise à jour là où elle est), sinon le projet de
  // l'éditeur, sinon RIEN : un canvas NEUF n'est jamais écrit dans la
  // bibliothèque partagée du dataset (voir le garde de autoSaveRef.current).
  const autoSaveScope = () => {
    if (canvasEntryFor(canvasHome)) return canvasHome;
    const first = Object.keys(canvasEntries)[0];
    if (first) return first === 'dataset' ? null : first;
    return (projectId && canWriteLibProject(projectId)) ? projectId : null;
  };
  const autoSaveLabel = () => (canvasLabel || (effectiveGlobalCaption && String(effectiveGlobalCaption).trim()
    ? `Figure — ${String(effectiveGlobalCaption).trim().slice(0, 60)}`
    : `Canvas ${new Date().toLocaleDateString()}`));
  // Aperçu de secours : la première vignette posée sur le canvas, le temps que
  // la passe « cloud » dépose le vrai rendu (une entrée sans image s'afficherait
  // cassée dans la bibliothèque d'images).
  const autoSavePreview = () => {
    for (const o of (objects || [])) {
      const im = getObjImages(o)[0];
      if (im && (im.imgThumb || im.imgSrc)) return im.imgThumb || im.imgSrc;
    }
    return null;
  };

  // Le geste lui-même. `publish` (rendu + envoi) est la seule passe lourde ;
  // `force` écrit même si la composition n'a pas changé (on quitte la page).
  autoSaveRef.current = async ({ publish = false, force = false } = {}) => {
    if (!objectsRef.current || !objectsRef.current.length) return null;
    const target = autoSaveScope();
    /* ⛔ UN CANVAS NEUF NE VA PLUS DANS LA BIBLIOTHÈQUE PARTAGÉE DU DATASET
       (demande : « les canvas ne doivent pas être enregistrés dans la
       bibliothèque, mais seulement dans le projet associé »). Sans projet — le
       builder s'ouvre aussi sans projet — RIEN n'est écrit dans la
       bibliothèque : la composition reste dans le navigateur (localStorage +
       cache de session) et la pastille dit quoi faire. Un canvas HISTORIQUE du
       dataset (target === null mais son entrée existe déjà) est le seul cas qui
       continue d'être mis à jour là où il est : on ne l'abandonne pas. */
    if (!target && !canvasEntryFor(null)) {
      setAutoSaveNote('noproject');
      setAutoSaveAt(new Date().toISOString());
      return null;
    }
    if (target && !canWriteLibProject(target)) return null;
    const label = autoSaveLabel();
    const canvasData = {
      // La clé de composition part avec chaque copie de la composition.
      canvasKey,
      canvasW, canvasH, gridCols, gridRows, showPanelBorders, showGridLines, keepAspect, globalCaption,
      // La définition GÉNÉRALE des lettres (taille, couleur, gras) voyage avec la
      // composition : elle se retrouve à la réouverture (voir restoreCanvasFromItem).
      letterStyle: { fontSize: currentLetterPt(), color: currentLetterColor(), bold: currentLetterBold() },
      objects: (objects || []).map(thumbnailsOf),
      arrows: arrows || [],
      shapes: shapes || [],
      updatedAt: new Date().toISOString()
    };
    const key = `${target || 'dataset'}|${label}|${JSON.stringify(canvasData)}`;
    if (!force && !publish && key === autoSaveKeyRef.current) return null;
    if (publish) {
      const pub = await publishCanvas({ label, targetProjectId: target, dataUrl: null });
      if (!pub || !pub.entry) return null;
      autoSaveKeyRef.current = key;
      setAutoSaveAt(new Date().toISOString());
      setAutoSaveNote(pub.drive && pub.drive.id ? 'cloud' : (pub.driveQueued ? 'queued' : 'browser'));
      return pub;
    }
    const known = canvasEntryFor(target);
    const res = saveCanvasSnapshot({
      scope: target ? 'project' : 'common',
      projectId: target,
      label,
      updateId: known ? known.id : null,
      canvasKey,
      canvasData,
      url: autoSavePreview()
    });
    if (!res || !res.entry) return null;
    rememberCanvasEntry(target, res.entry);
    setLibVersion((v) => v + 1);
    autoSaveKeyRef.current = key;
    setAutoSaveAt(new Date().toISOString());
    setAutoSaveNote((prev) => (prev === 'cloud' ? prev : 'draft'));
    return res;
  };

  // Passe instantanée : 2,5 s après la dernière modification.
  useEffect(() => {
    const t = setTimeout(() => { try { if (autoSaveRef.current) autoSaveRef.current({}); } catch { /* ignore */ } }, AUTO_SNAPSHOT_MS);
    return () => clearTimeout(t);
  }, [objects, arrows, canvasW, canvasH, gridCols, gridRows, showPanelBorders, showGridLines, keepAspect, globalCaption, canvasLabel, canvasHome, canvasEntries, canvasKey, projectId]);

  // Passe cloud : après 8 s de calme, et au plus une fois par minute.
  useEffect(() => {
    const t = setTimeout(() => {
      if (Date.now() - lastPublishAtRef.current < AUTO_PUBLISH_MS) return;
      lastPublishAtRef.current = Date.now();
      try { if (autoSaveRef.current) autoSaveRef.current({ publish: true }); } catch { /* ignore */ }
    }, AUTO_PUBLISH_QUIET_MS);
    return () => clearTimeout(t);
  }, [objects, arrows, canvasW, canvasH, gridCols, gridRows, showPanelBorders, showGridLines, keepAspect, globalCaption, canvasLabel, canvasHome, canvasEntries, canvasKey, projectId]);

  // On quitte (autre module, rechargement, onglet fermé) : la dernière
  // composition est écrite TOUT DE SUITE — la passe différée ne partirait
  // jamais. C'est exactement le geste qui manquait.
  useEffect(() => {
    const flush = () => { try { if (autoSaveRef.current) autoSaveRef.current({ force: true }); } catch { /* ignore */ } };
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, []);

  // Pastille de la barre d'outils : où en est la sauvegarde automatique (une
  // composition « sauvée » que l'on ne peut pas voir est une composition que
  // l'on croit perdue).
  const autoSaveBadgeInfo = (() => {
    if (!autoSaveAt) return null;
    const time = new Date(autoSaveAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const where = canvasHome ? `the “${canvasScopeName(canvasHome)}” library` : 'the dataset image library';
    if (autoSaveNote === 'cloud') {
      return {
        text: `🖼 auto-saved ${time} · ☁ in ${where} + Drive`,
        tone: 'ok',
        title: `Saved automatically ${time} — the composition is in ${where} (project page “🖼 Saved canvases”) and its image + editable copy are on the cloud. Reopen it any time with “↩ Load”, or from the project page.`
      };
    }
    if (autoSaveNote === 'noproject') {
      return {
        text: `🖼 kept in this browser ${time} · 🗂 no project yet`,
        tone: 'warn',
        title: `The composition is safe in this browser (it comes back when you reopen the Image Builder), but it is NOT stored in any image library: canvases belong to a PROJECT. Press “💾 Save now” and pick the project it belongs to — it is then listed on that project page under “🖼 Saved canvases”, in its Image Library → Project tab, and it goes to the cloud.`
      };
    }
    if (autoSaveNote === 'queued') {
      return {
        text: `🖼 auto-saved ${time} · ⏳ cloud transfer queued`,
        tone: 'warn',
        title: `Saved automatically ${time} into ${where}. The image could not be uploaded right now, but it is QUEUED and will be sent as soon as Google Drive answers again — nothing is lost.`
      };
    }
    if (autoSaveNote === 'browser') {
      return {
        text: `🖼 auto-saved ${time} · 💾 in this browser only`,
        tone: 'warn',
        title: `Saved automatically ${time} into ${where}, but the cloud copy failed (cloud storage not connected?). Connect Google Drive/Nextcloud in the sidebar so the image and its editable copy travel.`
      };
    }
    return {
      text: `🖼 auto-saved ${time}`,
      tone: 'ok',
      title: `The composition is written into ${where} automatically — no need to press “💾 Save now” to be able to reopen it.`
    };
  })();

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
    // La composition reprise apporte sa CLÉ de composition — sinon elle en reçoit
    // une NEUVE (canvas enregistré avant cette clé) : l'entrée qui vient d'être
    // reconnue reste la sienne et la sauvegarde suivante l'y met à jour.
    setCanvasKey(canvasKeyOfEntry(item) || uid('cv'));
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
    // The canvas-wide LETTER definition (size / colour / bold) is part of the
    // saved canvas: it comes back with the panels, and a canvas saved with no
    // panel left still remembers it.
    if (cd.letterStyle && Number(cd.letterStyle.fontSize) > 0) setLetterPtFallback(Number(cd.letterStyle.fontSize));
    if (cd.letterStyle) setLetterStyleDefaults((prev) => ({
      color: String(cd.letterStyle.color || prev.color),
      bold: cd.letterStyle.bold === undefined ? prev.bold : !!cd.letterStyle.bold
    }));
    setObjects((cd.objects || []).map((o) => resolveObj(o)));
    // The saved canvas carries its own annotations (an older canvas has none).
    setArrows((cd.arrows || []).map(normalizeArrow));
    setShapes((cd.shapes || []).map(normalizeShape));
    setSelectedId(null);
    setSelectedArrowId(null);
    setSelectedShapeId(null);
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

    const mmX = (e.clientX - startX) * scaleX;
    const mmY = (e.clientY - startY) * scaleY;
    // 🎯 PRECISION: “🎯 Precision” (or Shift held) divides the movement by four,
    // and a FIGURE handle follows only half of the pointer (FIGURE_RESIZE_GAIN):
    // a small figure is then sized to the tenth of a millimetre instead of
    // jumping. A PANEL still lands on WHOLE grid cells, so the gain would only
    // make it harder to move — it is left untouched.
    const gridQuantised = type === 'move' || type === 'resize';
    const fineDrag = !!(fineModeRef.current || e.shiftKey);
    const gain = gridQuantised ? 1 : (fineDrag ? FINE_GAIN : 1) * (type === 'figResize' ? FIGURE_RESIZE_GAIN : 1);
    const dxMm = gain === 1 ? mmX : +(mmX * gain).toFixed(3);
    const dyMm = gain === 1 ? mmY : +(mmY * gain).toFixed(3);
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
      const rawX = g && g.iW ? Math.max(0, Math.min(1, ((e.clientX - rect.left) * scaleX - g.iX) / g.iW)) : 0;
      const rawY = g && g.iH ? Math.max(0, Math.min(1, ((e.clientY - rect.top) * scaleY - g.iY) / g.iH)) : 0;
      // 🎯 PRECISION: the corner of the window follows the pointer ONE-TO-ONE by
      // default — on a figure a few millimetres wide on screen that is a whole
      // percent of the image per pixel. With 🎯 Precision (or Shift) the corner
      // only takes a QUARTER of the movement from where the drag started: the
      // anchor stays exactly under the pointer and the window is drawn to the
      // tenth of a percent.
      const nx = fineDrag ? st.from.x + (rawX - st.from.x) * FINE_GAIN : rawX;
      const ny = fineDrag ? st.from.y + (rawY - st.from.y) * FINE_GAIN : rawY;
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

    // Dragging a SHAPE (line / rectangle / circle): the whole shape (both corners
    // follow) or ONE corner — the opposite one stays put (resizedShapeCorners).
    // Positions are absolute (the snapshot of the corners is kept in the drag
    // state), so a long drag cannot accumulate rounding, exactly like an arrow.
    if (type === 'shapeMove') {
      const st = dragState.current;
      setShapes(prev => prev.map(sh => sh.id !== id ? sh : {
        ...sh,
        x1: +(st.sh.x1 + dxMm).toFixed(2), y1: +(st.sh.y1 + dyMm).toFixed(2),
        x2: +(st.sh.x2 + dxMm).toFixed(2), y2: +(st.sh.y2 + dyMm).toFixed(2)
      }));
      return;
    }
    if (type === 'shapeCorner') {
      const st = dragState.current;
      const corners = resizedShapeCorners(st.sh, st.corner, dxMm, dyMm);
      setShapes(prev => prev.map(sh => sh.id !== id ? sh : { ...sh, ...corners }));
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
  // The history is committed ONCE per command: a crop is drawn with the mouse
  // and dropped when the button is released (see the ✂️ Crop mode), so a single
  // window never fills the undo stack.
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

  // ✂️ CROPPING IS A MOUSE GESTURE: the “Left / Right / Top / Bottom (%)”
  // number fields were removed on purpose — a crop is drawn on the canvas (the
  // ✂️ Crop mode), refining a window is what the mouse is for, and 🎯 Precision
  // (or Shift) gives it the tenth of a percent. The object window only reports
  // the window that is kept.
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
    setActiveText((prev) => (prev && prev.txId === txId ? null : prev));
  };
  /* ⧉ COPIER UN TEXTE, JUSTE À CÔTÉ — la copie devient le texte CHOISI : on
     modifie son contenu dans sa ligne (ou en le double-cliquant sur le canvas) et
     on la tire où on veut, sans avoir à retrouver la mise en forme d'origine :
     taille, couleur, gras et italique sont recopiés. Elle se pose 3 mm vers le
     bas-droite, donc jamais cachée sous l'original. */
  const duplicateText = (txId) => {
    const obj = objects.find(o => o.id === selectedId);
    if (!obj) return;
    const src = (obj.texts || []).find(tx => tx.id === txId);
    if (!src) return;
    commitHistory();
    const id = `txt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const copy = {
      ...src,
      id,
      x: +Math.max(1, Math.min((obj.w * cellW) - 1, (Number(src.x) || 0) + TEXT_COPY_STEP)).toFixed(1),
      y: +Math.max(4, Math.min((obj.h * cellH) - 4, (Number(src.y) || 0) + TEXT_COPY_STEP)).toFixed(1)
    };
    setObjects(prev => prev.map(o => (o.id === obj.id ? { ...o, texts: [...(o.texts || []), copy] } : o)));
    setActiveText({ objId: obj.id, txId: id });
  };
  // Le texte CHOISI d'un panneau : celui que « ⧉ Copy » duplique, celui que le
  // canvas encadre et dont la ligne s'allume (null quand il n'existe plus).
  const activeTextOf = (obj) => {
    if (!activeText || !obj || activeText.objId !== obj.id) return null;
    return (obj.texts || []).find(tx => tx.id === activeText.txId) || null;
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
    /* ⛔ LE BOUTON « Delete » DU PANNEAU DES FLÈCHES NE POUVAIT PAS SUPPRIMER.
       `onClick={onDelete}` passait l'ÉVÉNEMENT DE CLIC en premier argument :
       `id` devenait un objet React (toujours vrai, donc jamais le `return`
       ci-dessous), et `a.id !== id` était vrai pour TOUTES les flèches — le
       panneau se refermait, la flèche restait. On n'accepte donc qu'un
       identifiant RÉEL (une chaîne) : tout le reste retombe sur la sélection. */
    const target = typeof id === 'string' ? id : selectedArrowId;
    if (!target) return;
    commitHistory();
    setArrows(prev => prev.filter(a => a.id !== target));
    setSelectedArrowId(null);
  };

  /* ── LES FORMES : LIGNE, RECTANGLE, CERCLE ─────────────────────────────────
     Même famille que les flèches (voir utils/figureShapes) : un objet de CANVAS
     en millimètres, sans lettre ni cellule — ajouter une forme ne renumérote
     aucun panneau. « ▭ Rectangle » (et « ◯ Circle ») déposent une forme
     sélectionnée au milieu du canvas, que l'on déplace et dont on tire les deux
     coins ; « ╱ Line » dépose un segment horizontal. Le panneau de la forme
     choisie (FigureArrowPanel.jsx → ShapePropertiesPanel) porte couleur,
     épaisseur, pointillés, remplissage, courbure et ombre. */
  const addShape = (kind) => {
    const k = SHAPE_KINDS.includes(kind) ? kind : 'rect';
    commitHistory();
    const id = `shp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const sh = newShape(k, id, defaultShapeRect(k, canvasW, canvasH));
    setShapes(prev => [...prev, sh]);
    // Une seule sélection à la fois : le panneau de la forme remplace celui du
    // panneau / de la flèche.
    setSelectedId(null);
    setSelectedArrowId(null);
    setSelectedShapeId(id);
  };
  const updateShape = (patch) => setShapes(prev => prev.map(sh => (sh.id === selectedShapeId ? { ...sh, ...patch } : sh)));
  const removeShape = (id = selectedShapeId) => {
    // Comme pour les flèches : le bouton du panneau passe parfois l'ÉVÉNEMENT de
    // clic — un identifiant RÉEL (une chaîne) est seul accepté, sinon la sélection.
    const target = typeof id === 'string' ? id : selectedShapeId;
    if (!target) return;
    commitHistory();
    setShapes(prev => prev.filter(sh => sh.id !== target));
    setSelectedShapeId(null);
  };
  // Glisser une forme (sans `corner`) ou L'UN de ses deux coins.
  const startShapeDrag = (e, id, corner = null) => {
    e.stopPropagation();
    commitHistory();
    const sh = (shapes || []).find(x => x.id === id);
    if (!sh) return;
    setSelectedId(null);
    setSelectedArrowId(null);
    setSelectedShapeId(id);
    dragState.current = {
      type: corner ? 'shapeCorner' : 'shapeMove',
      id,
      corner,
      startX: e.clientX,
      startY: e.clientY,
      sh: { x1: sh.x1, y1: sh.y1, x2: sh.x2, y2: sh.y2, kind: sh.kind }
    };
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', endDrag);
  };

  /* ⛔ LES COMMANDES ⇹ DES PANNEAUX ONT ÉTÉ RETIRÉES (demande : « l'outil
     d'alignement et de répartition ne doit pas servir aux panneaux, mais aux
     figures ou aux textes d'un panneau »). Aligner une grille de panneaux se
     fait autrement, et mieux : Ctrl+clic pour en sélectionner plusieurs, puis le
     PREMIER tient la référence — le déplacer les déplace tous du même écart, le
     redimensionner leur donne SA taille (voir moveSelectionPatches /
     resizeSelectionPatches). Les commandes ⇹ vivent maintenant dans la colonne
     FIGURES et rangent les figures ET les textes du panneau sélectionné
     (applyFigureLayout → alignGroupPatches / distributeGroupPatches).
     Les fonctions pures alignBoxesPatches / distributeBoxesPatches restent dans
     utils/panelSelection.js : elles restent testées et disponibles, simplement
     plus branchées sur un bouton. */
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
      setSelectedShapeId(null);
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
        {/* ── L'OMBRE D'UNE FORME (ligne, rectangle, cercle) ──────────────────
            La même primitive que les panneaux, les flèches et les figures : une
            forme projette SA propre ombre, décrite par le même enregistrement et
            définie dans la composition — donc présente dans chaque export. */}
        {shapes.map((sh) => {
          const sp = shadowSpec(sh.shadow);
          if (!sp) return null;
          return (
            <filter key={`fss-${sh.id}`} id={shapeShadowFilterId(sh.id)} x="-25%" y="-25%" width="150%" height="150%">
              <feDropShadow dx={sp.dx} dy={sp.dy} stdDeviation={sp.blur} floodColor={sp.color} floodOpacity={sp.opacity} />
            </filter>
          );
        })}
        {/* ── LE RÉGLAGE D'IMAGE D'UNE FIGURE (contraste, luminosité, couleur) ─
            Voir utils/figureAdjust.js : la teinte et la saturation par des
            <feColorMatrix>, le contraste (pivot au gris moyen) et la luminosité
            par <feComponentTransfer>, et la teinte (un <feFlood> détouré sur
            les pixels de la figure) fusionnée par-dessus la source. Le filtre
            est posé sur l'IMAGE elle-même : il travaille les PIXELS, jamais le
            cadre du panneau. Pas de réglage → pas de filtre du tout. */}
        {objects.map(obj => getObjImages(obj).map((im, i) => {
          const adj = adjustSpec(adjustRecordOf(im));
          if (!adj) return null;
          return (
            <filter key={`fadj-${obj.id}-${i}`} id={adjustFilterId(obj.id, i)} x="-10%" y="-10%" width="120%" height="120%">
              {adj.saturation !== 1 ? <feColorMatrix type="saturate" values={adj.saturate} /> : null}
              {adj.hueRotate ? <feColorMatrix type="hueRotate" values={adj.hueRotate} /> : null}
              <feComponentTransfer>
                <feFuncR type="linear" slope={adj.slope} intercept={adj.intercept} />
                <feFuncG type="linear" slope={adj.slope} intercept={adj.intercept} />
                <feFuncB type="linear" slope={adj.slope} intercept={adj.intercept} />
              </feComponentTransfer>
              {adj.tint && adj.tintAmount > 0 ? (
                <>
                  <feFlood floodColor={adj.tint} floodOpacity={adj.tintAmount} result="adjTint" />
                  <feComposite in="adjTint" in2="SourceGraphic" operator="in" result="adjTintClipped" />
                  <feMerge>
                    <feMergeNode in="SourceGraphic" />
                    <feMergeNode in="adjTintClipped" />
                  </feMerge>
                </>
              ) : null}
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
                    /* LE RÉGLAGE D'IMAGE (contraste, luminosité, saturation,
                       teinte) : son `<filter>` est posé sur l'IMAGE elle-même —
                       il travaille les pixels de la figure et suit donc son
                       alpha, son recadrage, sa rotation et sa gomme. `undefined`
                       quand rien n'est demandé : le SVG est alors exactement
                       celui d'avant. */
                    const figAdjust = adjustSpec(adjustRecordOf(im));
                    const adjustFilter = figAdjust ? `url(#${adjustFilterId(obj.id, i)})` : undefined;
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
                              filter={adjustFilter}
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
                          filter={adjustFilter}
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
                  onClick={isSelected ? (e) => { e.stopPropagation(); setActiveText({ objId: obj.id, txId: tx.id }); } : undefined}
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

            {/* THE TEXT CHOSEN IN THIS PANEL (screen only): the dashed box shows
                WHICH text is selected — the one its row in the object window
                lights up and the one “⧉ Copy” duplicates. Drawn OUTSIDE the
                panel's shadow group: a selection mark must not cast a shadow.
                The width is ESTIMATED from the length of the text (the browser
                keeps that knowledge to itself): it is a marker, not a measure. */}
            {isSelected && activeTextOf(obj) && (() => {
              const tx = activeTextOf(obj);
              const fs = ptToMm(tx.fontSize || 12);
              const wMm = Math.max(4, String(tx.text || '').length * fs * 0.58);
              return (
                <rect data-selection-ui="true" x={ox + tx.x - 1} y={oy + tx.y - fs - 0.8}
                  width={wMm + 2} height={fs * 1.3 + 1.6} fill="none"
                  stroke="#0ea5e9" strokeWidth={0.25} strokeDasharray="1.2,1"
                  style={{ pointerEvents: 'none' }} />
              );
            })()}

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
      {/* SHAPES — lines, rectangles, circles. Same family as the arrows: canvas
          level, in millimetres, drawn ON TOP of the panels and BELOW the arrows
          (“a shape frames a region, an arrow points at it”). The shape carries no
          `data-selection-ui`, so Export PNG / Save canvas / Insert into project
          keep it; only the corner handles are screen-only. The geometry comes
          from shapeGeometry (utils/figureShapes), which is also what the tests
          exercise. */}
      {shapes.map(sh => {
        const g = shapeGeometry(sh);
        const sp = shadowSpec(sh.shadow);
        const isShapeSelected = sh.id === selectedShapeId;
        const tint = shapeFillOf(g.shape);
        const strokeProps = {
          stroke: g.shape.stroke,
          strokeWidth: g.shape.width,
          strokeDasharray: shapeDashArray(g.shape)
        };
        return (
          <g key={sh.id}
            filter={sp ? `url(#${shapeShadowFilterId(sh.id)})` : undefined}
            onClick={(e) => { e.stopPropagation(); setSelectedId(null); setSelectedArrowId(null); setSelectedShapeId(sh.id); }}
            title={`${SHAPE_LABELS[g.shape.kind] || 'Shape'} — drag it to move it, drag a blue corner handle to resize it, or use “Shape properties”`}>
            {g.shape.kind === 'line' && (
              <path d={g.path} fill="none" strokeLinecap="butt" {...strokeProps} />
            )}
            {g.shape.kind === 'rect' && (
              <rect x={g.box.x} y={g.box.y} width={g.box.w} height={g.box.h}
                fill={tint || 'none'} fillOpacity={tint ? g.shape.fillOpacity : undefined} {...strokeProps} />
            )}
            {g.shape.kind === 'ellipse' && (
              <ellipse cx={g.box.cx} cy={g.box.cy} rx={g.box.w / 2} ry={g.box.h / 2}
                fill={tint || 'none'} fillOpacity={tint ? g.shape.fillOpacity : undefined} {...strokeProps} />
            )}
            {/* Invisible but WIDE outline: a hairline is almost impossible to grab
                (the same trick as the arrows' shaft). An unfilled shape is grabbed
                by its OUTLINE only, so it never steals a click from a panel below. */}
            {g.shape.kind === 'line' ? (
              <path d={g.path} fill="none" stroke="transparent" strokeWidth={Math.max(4, g.shape.width * 3)}
                pointerEvents="stroke" style={{ cursor: 'move' }}
                onMouseDown={(e) => startShapeDrag(e, sh.id)} />
            ) : (
              <rect x={g.box.x} y={g.box.y} width={g.box.w} height={g.box.h} fill="transparent"
                stroke="transparent" strokeWidth={Math.max(4, g.shape.width * 3)}
                pointerEvents={tint ? 'all' : 'stroke'} style={{ cursor: 'move' }}
                onMouseDown={(e) => startShapeDrag(e, sh.id)} />
            )}
            {isShapeSelected && (
              <g data-selection-ui="true">
                <rect x={g.box.x} y={g.box.y} width={g.box.w} height={g.box.h} fill="none" stroke="#3b82f6"
                  strokeWidth={0.2} strokeDasharray="1 1" pointerEvents="none" />
                {shapeHandles(g.shape).map((h) => (
                  <circle key={h.key} cx={h.x} cy={h.y} r={1.6} fill="#3b82f6" stroke="white" strokeWidth={0.3}
                    style={{ cursor: 'crosshair' }} onMouseDown={(e) => startShapeDrag(e, sh.id, h.key)}
                    title="Drag to move this corner of the shape (the opposite corner stays where it is)" />
                ))}
              </g>
            )}
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
  // Ombre de la figure ACTIVE (l'image, pas le cadre — voir toggleActiveFigureShadow) :
  // le bouton 🌓 de la ligne des figures dit d'un coup d'œil si elle en a une.
  const figShadowOn = cropPanelIdx >= 0 && !!shadowSpec((selectedImgs[cropPanelIdx] || {}).shadow);
  // Détourage déjà fait sur la figure active (`im.bg`, voir utils/figureBackground.js) :
  // sa couleur, sa tolérance et son mode sont relus dans « ▾ More options ».
  const figBgRecord = cropPanelIdx >= 0 ? bgRecordOf(selectedImgs[cropPanelIdx]) : null;
  // Le réglage d'IMAGE de la figure active (contraste, luminosité, saturation,
  // teinte) : `null` quand rien n'est demandé — aucun `<filter>` n'est alors
  // dessiné, le SVG reste celui d'avant. Voir utils/figureAdjust.js.
  const activeAdjust = cropPanelIdx >= 0 ? ((selectedImgs[cropPanelIdx] || {}).adjust || null) : null;
  const activeAdjustSpec = adjustSpec(activeAdjust);
  // Écrire un réglage : le bouton « ↺ Reset » remet la fiche NEUTRE (les six
  // champs à zéro), que `adjustSpec` traduit en « pas de filtre ».
  const setFigAdjust = (patch) => {
    if (cropPanelIdx < 0) return;
    patchFigure(selectedObj.id, cropPanelIdx, { adjust: { ...ADJUST_NEUTRAL, ...(activeAdjust || {}), ...patch } });
  };
  // L'aperçu cliquable du détourage : les pixels de la figure active (c'est la
  // SOURCE qui est affichée, pas la vignette — on clique une couleur exacte).
  const figBgSrc = cropPanelIdx >= 0 ? bgFigSrcOf(selectedImgs[cropPanelIdx]) : '';

  // The selected ARROW annotation. A panel and an arrow are never selected at
  // the same time — one properties panel is shown, for whichever the user
  // clicked last.
  const selectedArrow = (arrows || []).find((a) => a.id === selectedArrowId) || null;
  // La FORME sélectionnée (ligne, rectangle, cercle) — sa fenêtre remplace celle
  // du panneau exactement comme celle d'une flèche, et jamais en même temps.
  const selectedShape = (shapes || []).find((sh) => sh.id === selectedShapeId) || null;

  /* ── LE PANNEAU D'OBJET (barre de commandes du panneau sélectionné) ──────────
     NORMAL VIEW : une barre COMPACTE sous le canvas.
     FULL SCREEN  : la MÊME barre, à l'horizontale, collée en bas de la fenêtre
     (`bar` — voir l'appel dans le plein écran).

     ⚠️ IL EST APPELÉ COMME UNE FONCTION — `PropertiesPanel({ bar: true })` — et
     JAMAIS écrit `<PropertiesPanel />`. Déclaré DANS ce composant, il change
     d'identité à chaque rendu : React y verrait un AUTRE composant, DéMONTERAIT
     tout le sous-arbre et le remonterait… à chaque caractère tapé et à chaque clic
     dans un champ. C'est exactement ce qui faisait perdre le focus (il fallait
     recliquer le champ à chaque lettre) et « sauter » la fenêtre. Appelé
     directement, ses éléments font partie de l'arbre du parent : rien n'est
     remonté, la saisie et le défilement restent où ils sont. (Même remède que
     `renderSvg`, dont le contenu partage tout le contexte du composant.) */
  /* ── LA FENÊTRE DE L'OBJET : TROIS COLONNES TITRÉES (voir `bar`) ───────────
     FIGURES · MODIFY IMAGE · OBJECTS. En plein écran la fenêtre est une GRILLE
     DE TROIS COLONNES, et non plus six cellules d'autant de groupes (elles
     laissaient la première colonne presque vide sur un écran moyen) :

       FIGURES           MODIFY IMAGE                  OBJECTS
       ➕ Add figure      🎨 Transparent background      Arrow · Line · Rectangle · Circle
       ↔ Swap image      🌓 Shadow (figure)             ⇹ Align · Distribute
       ⊞ Lay in a grid   ✂ Crop · ↻ Rotate · 🧽 Eraser  + Add text · ✏️ Place by click
       la liste des      Contrast / Brightness /        la liste des textes, l'un
       figures           Saturation / Hue · Tint         sous l'autre
                         PANELS : A B C · Copy · Paste · Delete

     L'ORDRE VISUEL NE DÉPEND PAS DE L'ORDRE DU SOURCE : chaque élément porte sa
     COLONNE (`md:col-start-1|2|3`) et son RANG (`order-*`), et la grille se
     remplit en « dense » — les commandes ont donc été regroupées PAR SUJET sans
     déplacer d'énormes blocs de JSX. La LÉGENDE (sous-titre du panneau) reste le
     seul élément de TOUTE la largeur, placé EN DERNIER, et « ▾ More options »
     vient après elle.
     `min-w-0` est indispensable : sans lui une colonne refuse de descendre sous
     la largeur de son contenu et la fenêtre déborde. Les deux LISTES (figures et
     textes) défilent chez elles (`max-h-… overflow-y-auto`) : une liste longue
     n'étire donc jamais la ligne qu'elle partage avec les autres colonnes.
     Le TITRE de la fenêtre EST son pli (`panelOpen`) : repliée, elle ne laisse
     qu'une ligne et le canvas garde toute la hauteur. */
  const panelCellCls = (bar, extra = '') => `flex flex-wrap items-center gap-x-1.5 gap-y-1 ${extra}${bar ? ' min-w-0' : ''}`;
  // Le titre d'une colonne ; `where` = sa colonne et son rang en plein écran.
  const panelTitle = (text, where) => (
    <h5 className={`text-[10px] font-black uppercase tracking-wide text-slate-500 shrink-0 ${where || ''}`}>{text}</h5>
  );

  const PropertiesPanel = ({ bar = false } = {}) => (
    <div className={bar ? 'flex flex-col gap-1.5' : 'flex flex-col gap-1.5 border-t border-slate-200 pt-1.5'}>
      {/* ── LE TITRE EST LE PLI DE LA FENÊTRE (▾ ouverte / ▸ repliée) ────────── */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button type="button" onClick={() => setPanelOpen((v) => !v)}
          className={`font-black text-[11px] px-1.5 py-0.5 rounded border shrink-0 ${panelOpen ? 'bg-slate-700 text-white border-slate-700' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'}`}
          title={panelOpen
            ? 'Fold the whole object window away — the canvas keeps all the height (this same click brings it back, with its state)'
            : 'Show the object window: the figures of this panel, the image tools, the panels and the objects'}>
          {panelOpen ? '▾' : '▸'} Object window
        </button>
        <span className="text-[11px] font-bold text-slate-700 shrink-0"
          title="The selected panel. Its letter is assigned by its position in the grid and re-numbered automatically — it is never typed in.">
          Panel {selectedObj.letter || '—'}
        </span>
        {selectedIds.length > 1 ? (
          <span className="text-[10px] font-normal text-slate-500 shrink-0">— {selectedIds.length} panels selected</span>
        ) : null}
        {!panelOpen && (
          <span className="text-[10px] text-slate-500 truncate min-w-0" title={selectedObj.caption || ''}>
            {selectedObj.caption ? `· ${selectedObj.caption}` : '· no sub-caption yet'}
          </span>
        )}
      </div>
      {panelOpen && (
      <div className={bar
        ? 'grid grid-cols-1 md:grid-cols-3 grid-flow-row-dense items-start gap-x-4 gap-y-1.5'
        : 'flex flex-col gap-1.5'}>
      {/* ── LES TROIS TITRES DE COLONNE ───────────────────────────────────────── */}
      {panelTitle('Figures', bar ? 'order-1 md:col-start-1' : '')}
      {panelTitle('Modify image', bar ? 'order-1 md:col-start-2' : '')}
      {panelTitle('Objects', bar ? 'order-1 md:col-start-3' : '')}
      {/* ── OBJECTS · LIGNE 1 : LES FORMES ──────────────────────────────────────
          Une FLÈCHE, une LIGNE, un RECTANGLE et un CERCLE : quatre objets de
          canvas (en millimètres, sans lettre ni cellule) posés PAR-DESSUS les
          panneaux. Chacun arrive sélectionné au milieu du canvas, avec sa
          poignée de déplacement et ses deux coins ; ses réglages — couleur,
          épaisseur, pointillés, remplissage, courbure, ombre — sont dans
          « Shape properties », exactement comme ceux d'une flèche.
          C'est ICI que « ↗ Arrow » vit désormais : il a quitté la barre du haut
          (et celle du plein écran), avec « 🌓 Shadow panels ». */}
      <div className={panelCellCls(bar, bar ? 'order-2 md:col-start-3' : '')}>
        <button type="button" onClick={addArrow}
          className="bg-rose-600 hover:bg-rose-700 text-white font-bold px-1.5 py-0.5 rounded text-[10px] shrink-0"
          title="Add an ARROW annotation on top of the panels — drag it to place it, drag a blue end handle to aim it; straight or curved, one head or heads at BOTH ends, with its own colour and drop shadow (“Arrow properties”).">
          ↗ Arrow{arrows.length ? ` (${arrows.length})` : ''}
        </button>
        {SHAPE_KINDS.map((k) => (
          <button key={k} type="button" onClick={() => addShape(k)}
            className="bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 font-bold px-1.5 py-0.5 rounded text-[10px] shrink-0"
            title={`Add a ${SHAPE_LABELS[k].toLowerCase()} on top of the panels — drag it to place it, drag a blue corner handle to resize it, or use “Shape properties” (colour, thickness, dashed, fill, curve, shadow). It takes no panel letter and never disturbs the panels' numbering.`}>
            {k === 'line' ? '╱ Line' : k === 'rect' ? '▭ Rectangle' : '◯ Circle'}
          </button>
        ))}
        {shapes.length > 0 && (
          <span className="text-[9px] font-bold text-slate-600 bg-slate-100 border border-slate-200 rounded px-1 shrink-0"
            title="The shapes of this canvas are drawn on top of the panels. Click one on the canvas to select it: its “Shape properties” replace this window, exactly like an arrow's.">
            ⇱ {shapes.length} shape{shapes.length === 1 ? '' : 's'} — click one on the canvas
          </span>
        )}
      </div>
      {/* ⛔ OBJECTS · LIGNE 2 ALIGNAIT LES PANNEAUX — RETIRÉ (demande : l'outil
          d'alignement doit servir aux FIGURES ou aux TEXTES d'un panneau, pas
          aux panneaux). Plusieurs panneaux se règlent toujours au Ctrl+clic :
          le premier sélectionné est la référence, le déplacer les déplace tous du
          même écart, le redimensionner leur donne sa taille. Les commandes ⇹
          sont dans la colonne FIGURES, juste à côté de la liste des figures, et
          elles rangent EXACTEMENT ce qui est coché « ☑ » — figures, textes, ou
          les deux (décocher la figure 🎯 1st pour ranger les textes seuls) ; les
          flèches du clavier déplacent ensuite tout le groupe par pas de 0,5 mm
          (5 mm avec Shift), voir nudgeFigureGroup. */}
      {/* ── MODIFY IMAGE · LIGNE 1 : le fond et l'ombre de LA FIGURE ────────────
          « 🎨 Transparent background » mène à l'outil de détourage de la figure
          ACTIVE (son aperçu cliquable, la tolérance et « les quatre coins » sont
          dans « ▾ More options », que ce bouton ouvre) ; « 🌓 Figure shadow »
          donne et retire l'ombre de l'IMAGE — jamais celle du cadre du panneau,
          qui a la sienne dans le repli. Ces deux commandes étaient au milieu des
          outils de la figure : elles ouvrent maintenant la colonne. */}
      <div className={panelCellCls(bar, bar ? 'order-2 md:col-start-2' : '')}>
        <button type="button" onClick={() => setPanelMore(true)} disabled={cropPanelIdx < 0}
          className={`font-bold px-1.5 py-0.5 rounded text-[10px] border shrink-0 ${cropPanelIdx < 0 ? 'bg-slate-100 border-slate-200 text-slate-300' : (figBgRecord ? 'bg-teal-600 text-white border-teal-700' : 'bg-white border-teal-300 text-teal-700 hover:bg-teal-100')}`}
          title={cropPanelIdx < 0
            ? 'Add a figure to this panel first: a background is removed from a PICTURE.'
            : 'Make the background of the active figure transparent — click the colour on the preview, then “🎨 Remove background”; the preview, the tolerance and “Auto: the four corners” sit in “▾ More options”, which this click opens.'}>
          🎨 Transparent background{figBgRecord ? ' ✓' : ''}
        </button>
        <button type="button" onClick={toggleActiveFigureShadow} disabled={cropPanelIdx < 0}
          className={`font-bold px-1.5 py-0.5 rounded text-[10px] border shrink-0 ${cropPanelIdx < 0 ? 'bg-slate-100 border-slate-200 text-slate-300' : (figShadowOn ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100')}`}
          title={cropPanelIdx < 0
            ? 'Add a figure to this panel first: the shadow is a setting of a PICTURE.'
            : (figShadowOn
              ? 'Take the shadow off this figure — the panel keeps its own shadow (a panel shadow is a separate setting).'
              : 'Give the ACTIVE figure its own drop shadow — the picture, not the panel frame: it follows the pixels of the figure, so a cut-out background gives the shadow OF WHAT THE IMAGE SHOWS instead of a rectangle. Offsets, blur and colour: “▾ More options”.')}>
          🌓 {figShadowOn ? 'Figure shadow ✓' : 'Figure shadow'}
        </button>
      </div>
      {/* ── MODIFY IMAGE · LIGNE 3 : LE RÉGLAGE D'IMAGE ─────────────────────────
          Contraste, luminosité, saturation, teinte et coloration : le réglage
          porte sur les PIXELS de la figure ACTIVE (utils/figureAdjust.js) et
          voyage avec elle — sauvegarde du canvas, annulation, Export PNG,
          Insert into project (le `<filter>` est dans la composition).
          « ↺ Reset » ramène tout à zéro : le filtre disparaît alors du SVG,
          exactement comme avant. */}
      <div className={panelCellCls(bar, bar ? 'order-6 md:col-start-2' : '')}>
        {cropPanelIdx < 0 ? (
          <span className="text-[10px] text-slate-400 italic shrink-0">Add a figure to this panel to adjust contrast, brightness, colours…</span>
        ) : (
          <>
            {ADJUST_FIELDS.map((f) => (
              <label key={f.key} className="flex items-center gap-1 text-[10px] font-bold text-slate-500 shrink-0"
                title={`${f.label} of the ACTIVE figure (figure ${cropPanelIdx + 1}) — the PICTURE, not the panel frame. It is part of the composition, so every export keeps it.`}>
                {f.label}
                <input type="range" min={f.min} max={f.max} step={f.step} value={Number((activeAdjust || {})[f.key]) || 0}
                  onChange={(e) => setFigAdjust({ [f.key]: Number(e.target.value) })}
                  className="w-16 accent-slate-600" />
                <input type="number" min={f.min} max={f.max} step={f.step} value={Number((activeAdjust || {})[f.key]) || 0}
                  onChange={(e) => setFigAdjust({ [f.key]: Number(e.target.value) })}
                  className="w-11 border rounded px-0.5 py-px text-[10px]" />
              </label>
            ))}
            <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500 shrink-0"
              title="Recolour the figure: this colour is merged over its pixels at the amount on the right (0 = not at all, 0.4 = a clear tint) — the usual way to bring a scheme back onto the colour of the caption.">
              Tint
              <input type="color" value={(activeAdjust && activeAdjust.tint) || '#ffcc00'}
                onChange={(e) => setFigAdjust({ tint: e.target.value })}
                className="w-6 h-5 rounded border cursor-pointer shrink-0" />
              <input type="number" min="0" max="1" step="0.05" value={Number((activeAdjust || {}).tintAmount) || 0}
                onChange={(e) => setFigAdjust({ tintAmount: Number(e.target.value) })}
                className="w-11 border rounded px-0.5 py-px text-[10px]" />
            </label>
            <button type="button" onClick={() => setFigAdjust({ ...ADJUST_NEUTRAL })} disabled={!activeAdjustSpec}
              className={`font-bold px-1.5 py-0.5 rounded text-[10px] border shrink-0 ${activeAdjustSpec ? 'bg-white border-slate-300 text-slate-600 hover:bg-slate-100' : 'bg-slate-100 border-slate-200 text-slate-300'}`}
              title="Back to the original pixels of this figure (contrast, brightness, saturation, hue and tint at zero) — Ctrl+Z undoes it like any other command">
              ↺ Reset
            </button>
          </>
        )}
      </div>
      {/* ── PANELS : CE QUI AGIT SUR LE PANNEAU LUI-MÊME ────────────────────────
          Les pastilles « A B C … » (sélection multiple), copier / coller /
          supprimer, la profondeur (devant / derrière), le plein écran sur
          l'objet et le retour au graphe d'origine : tout ce qui vise LE panneau,
          et non sa figure. Dernière section de la colonne « Modify image »,
          juste avant la légende. */}
      <div className={panelCellCls(bar, bar ? 'order-9 md:col-start-2' : '')}>
        <span className="w-px h-4 bg-slate-300 shrink-0" />
        {/* MULTI-SELECTION. The chips are the panels of the canvas: click one to
            add / remove it from the selection, the “🎯” chip of a selected panel
            makes it the FIRST selected — the REFERENCE whose size the others
            take (Ctrl+click on the canvas does the same, without coming back
            here). The “📋” pair copies the selection and pastes it into the
            first free cell of the grid; Ctrl+C / Ctrl+V work anywhere. */}
        {objects.map((o, i) => {
          const rank = selectedIds.indexOf(o.id);
          const label = o.letter || (i + 1);
          return (
            <span key={o.id} className="inline-flex items-center">
              <button type="button" onClick={() => toggleSelectedId(o.id)}
                className={`font-bold text-[10px] px-1.5 py-0.5 border ${rank === 0 ? 'bg-blue-600 text-white border-blue-700 rounded' : (rank > 0 ? 'bg-indigo-50 text-indigo-800 border-indigo-300 rounded-l' : 'bg-white text-slate-600 border-slate-300 rounded hover:bg-slate-50')}`}
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
        <button type="button" onClick={() => copySelection()}
          className="font-bold text-[10px] bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 px-1.5 py-0.5 rounded shrink-0"
          title="Copy the selected panel(s) — figures, texts and shadows included. Ctrl+C does the same, and “📋 Paste” brings an identical panel back.">📋 Copy</button>
        <button type="button" onClick={() => pasteClipboard()}
          className="font-bold text-[10px] bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 px-1.5 py-0.5 rounded shrink-0"
          title={`Paste the copied panel(s) into the FIRST FREE cell of the grid (never on top of a panel that is already there) — Ctrl+V does the same${clipCount ? ` (${clipCount} panel${clipCount === 1 ? '' : 's'} in the clipboard)` : ' (nothing copied yet)'}`}>
          📋 Paste{clipCount ? ` (${clipCount})` : ''}
        </button>
        {selectedIds.length > 1 && (
          <button type="button" onClick={() => setSelectedId(selectedId)}
            className="font-bold text-[10px] bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 px-1.5 py-0.5 rounded shrink-0"
            title="Keep only the first selected panel: the others leave the selection">✕ Others</button>
        )}
        <span className="w-px h-4 bg-slate-300 shrink-0" />
      </div>
      {/* ── PANELS (suite) · PROFONDEUR, SUPPRESSION, VUE ───────────────────────
          Où ce panneau se trouve dans la pile, les copies, la suppression, le
          plein écran sur l'objet, le retour au graphe d'origine et le repli
          « ▾ More options ». */}
      <div className={panelCellCls(bar, bar ? 'order-10 md:col-start-2' : '')}>
        {/* 🗂 QUEL PANNEAU EST AU-DESSUS — les panneaux sont peints dans l'ordre
            de la liste : ces deux commandes font passer ce panneau devant ses
            voisins (ou le rangent derrière). Les lettres (A, B, C …) sont
            attribuées par POSITION et ne bougent pas. */}
        <button type="button" onClick={() => moveObjInStack(selectedObj.id, 'front')}
          disabled={objects.indexOf(selectedObj) === objects.length - 1}
          className="text-[10px] bg-white text-slate-700 border border-slate-300 px-1.5 py-0.5 rounded font-bold hover:bg-slate-100 disabled:opacity-40 shrink-0"
          title="Put this panel ON TOP of the others — wherever two panels overlap (a figure sticking out of its panel), this one covers its neighbour. The letters are not renumbered.">⤒ Front</button>
        <button type="button" onClick={() => moveObjInStack(selectedObj.id, 'back')}
          disabled={objects.indexOf(selectedObj) === 0}
          className="text-[10px] bg-white text-slate-700 border border-slate-300 px-1.5 py-0.5 rounded font-bold hover:bg-slate-100 disabled:opacity-40 shrink-0"
          title="Put this panel BEHIND the others — its neighbour covers it wherever they overlap. The letters are not renumbered.">⤓ Back</button>
        <button onClick={() => copySelection()} className="text-[10px] bg-white text-slate-700 border border-slate-300 px-1.5 py-0.5 rounded font-bold hover:bg-slate-100 shrink-0"
          title="Copy this panel — its figure(s), its texts and its shadows — Ctrl+C does the same">⧉ Copy</button>
        <button onClick={deleteSelection} className="text-[10px] bg-red-50 text-red-600 border border-red-200 px-1.5 py-0.5 rounded font-bold hover:bg-red-100 shrink-0"
          title={selectedIds.length > 1 ? `Delete the ${selectedIds.length} selected panels` : 'Delete this panel'}>
          {selectedIds.length > 1 ? `Delete ${selectedIds.length} panels` : 'Delete'}
        </button>
        <span className="w-px h-4 bg-slate-300 shrink-0" />
        <button onClick={() => zoomToObject(selectedObj.id)} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-1.5 py-0.5 rounded text-[10px] shrink-0"
          title="Zoom the canvas on this panel alone — a full screen view of this object, nothing else">⛶ Fullscreen on object</button>
        {selectedObj.src && selectedObj.src.testId && (
          <button onClick={() => openOriginalGraph(selectedObj.src)}
            className="bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-300 font-bold px-1.5 py-0.5 rounded text-[10px] shrink-0"
            title={`Open ${originLabelOf(selectedObj.src) || 'the original experiment'} right on the graph this image was captured from${selectedObj.src.elementLabel ? ` (${selectedObj.src.elementLabel})` : ''}`}>
            ↗ Open original graph{originLabelOf(selectedObj.src) ? ` · ${originLabelOf(selectedObj.src)}` : ''}
          </button>
        )}
        <button type="button" onClick={() => setPanelMore((v) => !v)}
          className={`font-bold px-1.5 py-0.5 rounded text-[10px] border shrink-0 ${panelMore ? 'bg-slate-700 text-white border-slate-700' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-100'}`}
          title={panelMore
            ? 'Fold the rarely used settings away again (panel shadow, free layout, eraser brush size, the long hints)'
            : 'Show the rarely used settings: the panel SHADOW, the free layout, the eraser brush size and the long hints — everything else is already here'}>
          {panelMore ? '▴ Fewer options' : '▾ More options'}
        </button>
      </div>
      {/* ── FIGURES : LES FIGURES DU PANNEAU, ET CE QU'ON LEUR FAIT ─────────────
          Ajouter / échanger / remettre en grille, la liste des figures (la
          dernière est AU-DESSUS ; elle défile au-delà de quelques lignes pour
          qu'une longue liste n'étire pas la fenêtre), la sélection multiple de
          figures et les commandes ⇹ qui les alignent et les répartissent entre
          elles. La TAILLE exacte et l'ajustement sont dans « Modify image » ; les
          outils de la figure (rotation, recadrage, gomme, réglage d'image,
          ombre) aussi. « 🖼 Import » a été retiré : « ➕ Add figure » et
          « ↔ Swap image » font les deux gestes (ajouter une figure / changer les
          pixels de celle qui est là), et la bibliothèque garde son « ↺ Replace »
          pour recommencer un panneau avec une seule figure. */}
      <div className={panelCellCls(bar, bar ? 'order-3 md:col-start-1' : '')}>
        <button onClick={() => { setPickMode('add'); setShowLibrary(true); }}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-2 py-0.5 rounded text-[10px] shrink-0"
          title="Add another figure to this same object/panel: the figures already there are FROZEN (each one keeps exactly the place and size it has now) and the new one lands in the biggest free space — nothing has to be laid out again. “⊞ Lay the figures out in a grid” re-flows the panel side by side if you prefer.">➕ Add figure</button>
        {/* ↔ SUBSTITUER L'IMAGE D'UNE FIGURE (même cadre, mêmes dimensions) :
            seule la figure ACTIVE change de pixels — son cadre (rectangle libre
            ou cellule) et sa place restent, mais le recadrage, le décalage,
            l'échelle, les traits de gomme et le détourage de l'ANCIENNE image
            sont oubliés (ils décrivaient ses pixels — voir handleSwapImage).
            L'ombre et le réglage d'image restent : réglages esthétiques. */}
        <button type="button" onClick={() => { setPickMode('swap'); setShowLibrary(true); }} disabled={cropPanelIdx < 0}
          className={`font-bold px-2 py-0.5 rounded text-[10px] shrink-0 ${cropPanelIdx < 0 ? 'bg-slate-100 text-slate-300' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}`}
          title="SUBSTITUTE the image of the active figure: the frame — its place and its dimensions — does not move, only the pixels change, and the crop window, the shift/zoom and the eraser strokes of the old picture are cleared so the new image is shown whole with its own proportions (a capture redone with better settings, the same curve on another condition…). “↺ Replace” in the library is the other command: it starts the panel over with a single full-panel figure.">↔ Swap image</button>
        {getObjImages(selectedObj).length > 1 && !selectedFreeLayout && (
          <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500 shrink-0"
            title="Grid layout: how many columns the figures of this panel are laid out in">
            Cols
            <select value={selectedObj.imgCols || 2} onChange={e => updateObj({ imgCols: Number(e.target.value) })} className="border rounded px-0.5 py-px text-[10px]">
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        {/* La disposition LIBRE : les figures de ce panneau gardent chacune leur
            rectangle (c'est ce qu'écrit « ➕ Add figure », donc ajouter une figure
            ne déplace jamais celles qui sont déjà là). Le réglage d'échelle et
            les colonnes de grille n'agissent plus sur elles : le retour à la
            grille est donc ICI, à côté, toujours atteignable. */}
        {selectedFreeLayout && (
          <button type="button" onClick={() => relayoutInGrid(selectedObj)}
            className="bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-100 font-bold px-1.5 py-0.5 rounded text-[10px] shrink-0"
            title="⊞ Lay the figures out in a grid — forget the free rectangles and lay the figures out side by side in the panel grid again (as many columns as “Cols”)">
            ⊞ Lay the figures out in a grid
          </button>
        )}
        {getObjImages(selectedObj).length > 0 && <span className="w-px h-4 bg-slate-300 shrink-0" />}
        {/* LA LISTE DES FIGURES — une par ligne, dans son propre bloc DÉFILANT :
            une figure = une vignette, son libellé, la sélection 🎯/☑, l'empilement
            ⤒ ⬆ ⬇ ⤓, le lien ↗ vers le graphe d'origine et ✕ pour la retirer.
            Elle défile au-delà de quelques lignes (`max-h-[8rem]`) : une longue
            liste ne peut donc pas étirer la ligne que cette colonne partage avec
            les deux autres. */}
        <div className="basis-full flex flex-wrap items-center gap-x-1.5 gap-y-1 max-h-[8rem] overflow-y-auto custom-scrollbar min-w-0">
        {getObjImages(selectedObj).map((im, i) => (
          <span key={im.libId || i} onClick={() => setActiveFig({ objId: selectedObj.id, idx: i })}
            className={`inline-flex items-center gap-x-1 border rounded px-1 py-0.5 cursor-pointer shrink-0 ${cropPanelIdx === i && getObjImages(selectedObj).length > 1 ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200'}`}
            title="Click to make this figure the active one (crop / resize / eraser / shadow commands apply to the active figure)">
            {im.imgThumb || im.imgSrc
              ? <img src={im.imgThumb || im.imgSrc} alt="" className="w-5 h-5 shrink-0 object-contain rounded border border-slate-100 bg-slate-50" />
              : <span className="w-5 h-5 shrink-0 rounded bg-slate-100" />}
            {/* SÉLECTION MULTIPLE DE FIGURES — « resize them all as the first
                selected » vaut AUSSI dans le panneau : la figure ACTIVE (celle
                qui porte les poignées, marquée 🎯) est la référence, et chaque
                figure cochée « ☑ » prend SA taille quand on la redimensionne.
                Depuis, « ⇹ » range ce qui est COCHÉ : la figure active l'est
                d'office, mais elle peut en SORTIR d'un clic — c'est ainsi qu'un
                panneau qui porte une figure range ses TEXTES seuls. */}
            {(() => {
              const isRefFig = i === activeFigIdx(selectedObj);
              const ticked = figGroupOf(selectedObj.id).includes(i);
              return (
                <button type="button"
                  onClick={(e) => { e.stopPropagation(); toggleFigGroup(selectedObj.id, i); }}
                  className={`shrink-0 text-[10px] font-bold border rounded px-1 ${ticked && isRefFig ? 'bg-blue-600 text-white border-blue-700' : (ticked ? 'bg-indigo-50 text-indigo-800 border-indigo-300' : 'text-slate-400 border-slate-200 hover:bg-slate-100')}`}
                  title={isRefFig
                    ? (ticked
                      ? 'The ACTIVE figure — the first selected: it carries the handles, every ticked figure takes ITS size when you resize it, and it is part of the ⇹ Align / Distribute group. Click to take it OUT of that group — the ⇹ commands then range only the texts you ticked (it keeps the handles).'
                      : 'The ACTIVE figure — it carries the handles but it is OUT of the ⇹ Align / Distribute group. Click to put it back in (every ticked figure follows it, and takes its size when you resize it).')
                    : (ticked
                      ? 'This figure is in the ⇹ Align / Distribute group (and it takes the active figure’s size when you resize it). Click to take it out.'
                      : 'Tick this figure to range it with ⇹ Align / Distribute — and to have it take the active figure’s size when you resize it, keeping its own place.')}>
                  {isRefFig ? (ticked ? '🎯 1st' : '🎯 out') : (ticked ? '☑' : '☐')}
                </button>
              );
            })()}
            <span className="text-[10px] font-bold text-slate-600 max-w-[7rem] truncate">{im.src && im.src.elementLabel ? im.src.elementLabel : `Figure ${i + 1}`}</span>
            {/* 🗂 STACKING — TOUJOURS VISIBLE. Les quatre commandes n'apparais-
                saient qu'à partir de la DEUXIÈME figure : c'est pourquoi « mettre
                la figure sélectionnée par-dessus les autres » restait
                introuvable. Elles sont maintenant là dès qu'un panneau porte des
                figures (inactives quand il n'y en a qu'une : il n'y a alors rien
                à empiler). */}
            <span className="flex items-center shrink-0"
              title="Stacking order inside the panel — the list is the stacking: the last one is ON TOP of the others (⤒ ⬆ ⬇ ⤓ re-layer a figure) — with one figure alone there is nothing to stack — ⤒ ⬆ ⬇ ⤓ re-layer it as soon as the panel holds several">
              <button type="button" onClick={(e) => { e.stopPropagation(); moveFigure(selectedObj.id, i, 'front'); }} disabled={i === getObjImages(selectedObj).length - 1}
                className="text-[10px] font-bold text-slate-500 border border-slate-200 rounded px-0.5 disabled:opacity-30 hover:bg-slate-100"
                title="Bring this figure to the front (on top of every other figure of the panel)">⤒</button>
              <button type="button" onClick={(e) => { e.stopPropagation(); moveFigure(selectedObj.id, i, 'up'); }} disabled={i === getObjImages(selectedObj).length - 1}
                className="text-[10px] font-bold text-slate-500 border border-slate-200 rounded px-0.5 disabled:opacity-30 hover:bg-slate-100"
                title="One step up in the stacking (a little less hidden by the figures above it)">⬆</button>
              <button type="button" onClick={(e) => { e.stopPropagation(); moveFigure(selectedObj.id, i, 'down'); }} disabled={i === 0}
                className="text-[10px] font-bold text-slate-500 border border-slate-200 rounded px-0.5 disabled:opacity-30 hover:bg-slate-100"
                title="One step down in the stacking (goes behind the figure just below it)">⬇</button>
              <button type="button" onClick={(e) => { e.stopPropagation(); moveFigure(selectedObj.id, i, 'back'); }} disabled={i === 0}
                className="text-[10px] font-bold text-slate-500 border border-slate-200 rounded px-0.5 disabled:opacity-30 hover:bg-slate-100"
                title="Send this figure to the back (behind every other figure of the panel)">⤓</button>
            </span>
            {getObjImages(selectedObj).length > 1 && i === getObjImages(selectedObj).length - 1 && (
              <span className="text-[9px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1 shrink-0" title="This figure is on top of the others">on top</span>
            )}
            {im.src && im.src.testId && (
              <button type="button" onClick={() => openOriginalGraph(im.src)}
                className="text-[9px] font-bold text-sky-700 hover:underline shrink-0 border border-sky-200 bg-sky-50 rounded px-1"
                title={`Open ${originLabelOf(im.src) || 'the original experiment'} right on the graph this figure was captured from${im.src.elementLabel ? ` (${im.src.elementLabel})` : ''}`}>
                ↗ Open
              </button>
            )}
            <button type="button" onClick={() => removeObjImage(i)} className="text-[11px] font-bold text-red-400 hover:text-red-600 shrink-0 rounded px-0.5" title="Remove this figure from the panel">✕</button>
          </span>
        ))}
        </div>
        {figGroupIdxs(selectedObj).length > 1 && (
          <span className="text-[10px] font-bold text-indigo-800 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5 shrink-0"
            title={`${figGroupIdxs(selectedObj).length} figures ticked « ☑ » — the ACTIVE one (🎯 1st) is the first selected: resizing it gives EVERY ticked figure its size (each one keeps its own place), and dragging it moves them all. The ⇹ commands beside it align and spread them (together with the ticked texts).`}>
            🎯 {figGroupIdxs(selectedObj).length} figures ticked
          </span>
        )}
        {/* LES TEXTES COCHÉS « ☑ » rejoignent le groupe que ⇹ range : l'outil
            d'alignement sert aux FIGURES **et** aux TEXTES d'un panneau (jamais
            aux panneaux — voir la note de la colonne OBJECTS). Un groupe peut
            donc être fait de textes SEULS (la figure active sort du groupe d'un
            clic sur 🎯 1st), de figures seules, ou des deux. */}
        {textGroupOf(selectedObj.id).length > 0 && (
          <span className="text-[10px] font-bold text-sky-800 bg-sky-50 border border-sky-200 rounded px-1.5 py-0.5 shrink-0"
            title={`${textGroupOf(selectedObj.id).length} text${textGroupOf(selectedObj.id).length === 1 ? '' : 's'} ticked — the ⇹ commands beside them align and spread them TOGETHER WITH the figures ticked in this panel (untick the 🎯 figure to range the TEXTS alone). Only the POSITION of a text is set: its size (the number of characters × its pt size) is its own.`}>
            ☑ {textGroupOf(selectedObj.id).length} text{textGroupOf(selectedObj.id).length === 1 ? '' : 's'} ticked
          </span>
        )}
        {layoutGroupSize(selectedObj) >= 2 && (() => {
          const n = layoutGroupSize(selectedObj);
          const nf = figGroupIdxs(selectedObj).length;
          const nt = selectedTextGroup(selectedObj).length;
          const what = nt && nf
            ? `${nf} figure${nf === 1 ? '' : 's'} and ${nt} text${nt === 1 ? '' : 's'}`
            : nt ? `${nt} text${nt === 1 ? '' : 's'}` : `${nf} figures`;
          const glyph = 'text-[10px] font-bold text-indigo-700 border border-indigo-200 bg-white rounded px-0.5 disabled:opacity-30 hover:bg-indigo-100 shrink-0';
          const free = 'Aligned on the BOXES they have now: a figure still on the grid is FROZEN first (it keeps exactly the place and size it shows — nothing is re-flowed) and a text counts as a box of its own (its estimated width × its line height), so figures and texts line up together. “⊞ Lay the figures out in a grid” puts the grid back whenever you want.';
          const picked = nt && nf
            ? 'The group is exactly what is TICKED: the figures carrying ☑ and the texts carrying ☑. Untick the figure marked 🎯 1st to range the TEXTS ALONE; tick several figures with no text to range the FIGURES alone.'
            : nt
              ? 'The group is exactly what is TICKED: here the ticked TEXTS alone (no figure of this panel is ticked — the 🎯 figure is out of the group).'
              : 'The group is exactly what is TICKED: here the ticked FIGURES alone (no text of this panel is ticked).';
          return (
            <span className="inline-flex items-center gap-x-0.5 border border-indigo-200 bg-indigo-50 rounded px-1 py-0.5 shrink-0"
              title={`⇹ Align and spread the ${what} selected in this panel. ${picked} ${free}`}>
              <span className="text-[9px] font-black text-indigo-700 shrink-0">⇹ {n}</span>
              <button type="button" onClick={() => applyFigureLayout('align', 'left')} className={glyph}
                title={`Align the ${what} on the LEFT edge of the selection (their left edges on one vertical line). The leftmost of them does not move.`}>⬅</button>
              <button type="button" onClick={() => applyFigureLayout('align', 'hcenter')} className={glyph}
                title={`Centre the ${what} HORIZONTALLY: their middles land on one vertical line through the centre of the selection.`}>⬌</button>
              <button type="button" onClick={() => applyFigureLayout('align', 'right')} className={glyph}
                title={`Align the ${what} on the RIGHT edge of the selection (their right edges on one vertical line). The rightmost of them does not move.`}>➡</button>
              <button type="button" onClick={() => applyFigureLayout('align', 'top')} className={glyph}
                title={`Align the ${what} on the TOP edge of the selection (their tops on one horizontal line). The highest of them does not move.`}>⬆</button>
              <button type="button" onClick={() => applyFigureLayout('align', 'vcenter')} className={glyph}
                title={`Centre the ${what} VERTICALLY: their middles land on one horizontal line through the centre of the selection.`}>⬍</button>
              <button type="button" onClick={() => applyFigureLayout('align', 'bottom')} className={glyph}
                title={`Align the ${what} on the BOTTOM edge of the selection (their bottoms on one horizontal line). The lowest of them does not move.`}>⬇</button>
              <button type="button" onClick={() => applyFigureLayout('distribute', 'h')} disabled={n < 3} className={glyph}
                title={n < 3
                  ? 'Distributing needs three items at least (with two there is only one gap to set).'
                  : `Distribute the ${what} HORIZONTALLY: the same gap between neighbours, left to right — the two extremes keep their place.`}>↔</button>
              <button type="button" onClick={() => applyFigureLayout('distribute', 'v')} disabled={n < 3} className={glyph}
                title={n < 3
                  ? 'Distributing needs three items at least (with two there is only one gap to set).'
                  : `Distribute the ${what} VERTICALLY: the same gap between neighbours, top to bottom — the two extremes keep their place.`}>↕</button>
              {/* LE DÉPLACEMENT DU GROUPE, PAR PETITS PAS : une fois rangés, les
                  éléments s'avancent ENSEMBLE — au clavier, 0,5 mm par appui
                  (5 mm avec Shift) — sans rien re-glisser à la souris, et le
                  décalage posé par l'alignement est conservé. */}
              <span className="text-[9px] font-bold text-indigo-500 shrink-0 cursor-help px-0.5"
                title={`Arrow keys move the ${what} GRADUALLY, ALL TOGETHER: one press = 0.5 mm (Shift = 5 mm), keeping exactly the alignment you have just set. Each press is one undo step (Ctrl+Z). Click the canvas or a figure first, so the keyboard is not in a text field.`}>⌨ ←↑→↓</span>
            </span>
          );
        })()}
      </div>
      {/* ── MODIFY IMAGE · LIGNE 4 : LA TAILLE EXACTE ET L'AJUSTEMENT ───────────
          La largeur / hauteur tapables (en % du panneau) et la façon dont la
          figure remplit sa case (Fit / Scale). */}
      <div className={panelCellCls(bar, bar ? 'order-7 md:col-start-2' : '')}>
        {cropPanelIdx >= 0 && (() => {
          /* 🎯 EXACT SIZE OF THE ACTIVE FIGURE (keyboard) — see setActiveFigBox:
             on a small figure the corner handle is quicker than the hand, so the
             box is also typeable as a % of the panel. Only a figure that carries
             its own rectangle (free geometry: “➕ Add figure”) has a box to type
             into; one still laid out by the panel grid uses “Scale (%)”. */
          const box = freeRectOf(getObjImages(selectedObj)[cropPanelIdx]);
          const pct = (v) => Math.round(v * 1000) / 10;
          const fieldCls = `w-14 border rounded px-0.5 py-px text-[10px] ${box ? '' : 'bg-slate-100 text-slate-400'}`;
          return (
            <>
              <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500 shrink-0">
                W (% of panel)
                <input type="number" min="2" max="400" step="0.5" disabled={!box}
                  value={box ? pct(box.w) : ''}
                  onFocus={() => commitHistory()}
                  onChange={(e) => setActiveFigBox({ w: e.target.value })}
                  className={fieldCls}
                  title="Exact WIDTH of the active figure, in % of its panel — the keyboard answer to a corner handle that is too quick on a small figure (one snapshot per edit, Ctrl+Z undoes it)." />
              </label>
              <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500 shrink-0">
                H (% of panel)
                <input type="number" min="2" max="400" step="0.5" disabled={!box}
                  value={box ? pct(box.h) : ''}
                  onFocus={() => commitHistory()}
                  onChange={(e) => setActiveFigBox({ h: e.target.value })}
                  className={fieldCls}
                  title="Exact HEIGHT of the active figure, in % of its panel." />
              </label>
              {!box && (
                <span className="text-[9px] text-slate-400 italic shrink-0" title="This figure is still laid out by the panel grid — “➕ Add figure” gives every figure its own box, and the panel-wide “Scale (%)” is what sizes it today.">
                  (grid layout: “Scale (%)”)
                </span>
              )}
            </>
          );
        })()}
        <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500 shrink-0"
          title={keepAspect ? 'The canvas option “🔒 Keep aspect ratio” is on: every figure is fitted with its own width/height ratio. Untick it to choose Contain / Cover / Stretch per panel.' : 'How the figure fills its panel cell: Contain / Cover / Stretch'}>
          Fit
          <select value={keepAspect ? 'contain' : selectedObj.imgFit} disabled={keepAspect} onChange={e => updateObj({ imgFit: e.target.value })}
            className={`border rounded px-0.5 py-px text-[10px] ${keepAspect ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : ''}`}>
            <option value="contain">Contain</option>
            <option value="cover">Cover</option>
            <option value="stretch">Stretch</option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500 shrink-0"
          title={selectedFreeLayout ? 'This panel is in FREE layout: every figure keeps its own rectangle, so the panel-wide scale no longer moves it — drag the figure’s corner handle on the canvas (or “⊞ Lay the figures out in a grid”).' : 'Scale of the figure inside its cell (grid layout).'}>
          Scale (%)
          <input type="number" min="10" max="500" disabled={selectedFreeLayout} value={Math.round((selectedObj.imgScale || 1) * 100)} onChange={e => updateObj({ imgScale: Number(e.target.value) / 100 })}
            className={`w-14 border rounded px-0.5 py-px text-[10px] ${selectedFreeLayout ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : ''}`} />
        </label>
      </div>
      {/* ── MODIFY IMAGE · LIGNE 2 : LES OUTILS DE LA FIGURE ───────────────────
          Rotation, 🎯 Precision (le geste de la souris au quart), recadrage et
          gomme — et les ⟲ qui remettent le recadrage ou les gommages à zéro.
          C'est l'IMAGE elle-même, jamais le cadre du panneau (dont l'ombre vit
          dans « ▾ More options »). L'ombre de la FIGURE et le détourage ont leur
          bouton en tête de colonne. */}
      <div className={panelCellCls(bar, bar ? 'order-5 md:col-start-2' : '')}>
        <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500 shrink-0" title="Turn the figure inside its panel (°) — ↻90° does a quarter turn">
          Rotate (°)
          <input type="number" min="-360" max="360" step="1" value={selectedObj.imgRotate || 0} onChange={e => updateObj({ imgRotate: Number(e.target.value) })} className="w-14 border rounded px-0.5 py-px text-[10px]" />
          <button type="button" onClick={() => updateObj({ imgRotate: ((selectedObj.imgRotate || 0) + 90) % 360 })} className="bg-slate-100 border border-slate-300 rounded px-1 text-[10px] font-bold hover:bg-slate-200 shrink-0" title="Rotate 90°">↻90°</button>
        </label>
        {/* 🎯 PRÉCISION — le réglage qui manquait : la souris est divisée par
            quatre (figure ET fenêtre de recadrage), et Shift fait la même chose
            sans quitter le clavier. */}
        <button type="button" onClick={toggleFineMode}
          className={`font-bold px-1.5 py-0.5 rounded text-[10px] border shrink-0 ${fineMode ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-100'}`}
          title="Halve the mouse: the corner of a figure and the crop window then follow only a QUARTER of the pointer movement, so a small figure is sized / cropped to the tenth of a millimetre. Holding SHIFT during a gesture does exactly the same, without leaving the keyboard.">
          🎯 Precision{fineMode ? ' ON' : ''}
        </button>
        {/* ✂️ CROP — À LA SOURIS. Les champs numériques « Left / Right / Top /
            Bottom (%) » ont été retirés : on recadre en traçant un rectangle sur
            le canvas (c'est le geste naturel), et 🎯 Precision (ou Shift) donne
            le dixième de pourcent. La barre ne fait que dire ce qui est gardé. */}
        <button type="button" onClick={() => toggleCropMode(selectedObj.id, cropPanelIdx)}
          disabled={cropPanelIdx < 0}
          className={`font-bold px-1.5 py-0.5 rounded text-[10px] border shrink-0 ${cropPanelIdx < 0 ? 'bg-slate-100 border-slate-200 text-slate-300' : cropPanelOn ? 'bg-amber-500 text-white border-amber-600' : 'bg-white border-amber-300 text-amber-700 hover:bg-amber-100'}`}
          title="Turn crop mode on, then drag a rectangle on the canvas over this figure — releasing the mouse applies the crop">
          {cropPanelOn ? '✂️ Crop mode ON — click to exit' : '✂️ Crop'}
        </button>
        <button type="button" onClick={() => resetCropRect(selectedObj.id, cropPanelIdx)}
          disabled={!cropPanelRect}
          className={`font-bold px-1.5 py-0.5 rounded text-[10px] border shrink-0 ${cropPanelRect ? 'bg-white border-slate-300 text-slate-600 hover:bg-slate-100' : 'bg-slate-100 border-slate-200 text-slate-300'}`}
          title={cropPanelRect ? `Show the whole original image again — kept: ${cropPct(cropPanelRect.x1)}–${cropPct(cropPanelRect.x2)} % × ${cropPct(cropPanelRect.y1)}–${cropPct(cropPanelRect.y2)} % of the original` : 'Show the whole original image again'}>⟲ Reset crop</button>
        {cropPanelOn && (
          <span className="text-[9px] font-bold text-amber-700 shrink-0">
            ✂️ figure {cropPanelIdx + 1}: drag a rectangle on the canvas, the mouse release applies the crop
          </span>
        )}
        {!cropPanelOn && cropPanelRect && (
          <span className="text-[9px] text-slate-400 shrink-0">
            kept {cropPct(cropPanelRect.x1)}–{cropPct(cropPanelRect.x2)} % × {cropPct(cropPanelRect.y1)}–{cropPct(cropPanelRect.y2)} %
          </span>
        )}
        {/* 🧽 ERASER — remove PARTS of a figure with a round brush whose size is
            adjustable (a rubber, not a crop: the stroke removes whatever it
            touches). The strokes live on the figure, in ITS coordinates
            (utils/figureErase.js), and are painted as an SVG mask: the hole is
            transparent in the composition AND in every export. */}
        <button type="button" onClick={toggleEraseMode} disabled={cropPanelIdx < 0}
          className={`font-bold px-1.5 py-0.5 rounded text-[10px] border shrink-0 ${cropPanelIdx < 0 ? 'bg-slate-100 border-slate-200 text-slate-300' : eraseMode ? 'bg-sky-600 text-white border-sky-700' : 'bg-white border-sky-300 text-sky-700 hover:bg-sky-100'}`}
          title="Remove parts of the figure — a round brush of the size on the right; press and drag on the canvas and everything the brush touches is taken off (the erasing of the panel above is armed; Ctrl+Z undoes a stroke)">
          {eraseMode ? '🧽 Eraser ON — click to exit' : '🧽 Eraser'}
        </button>
        <button type="button" onClick={() => clearErase(selectedObj.id, cropPanelIdx)} disabled={!erasePanelCount}
          className={`font-bold px-1.5 py-0.5 rounded text-[10px] border shrink-0 ${erasePanelCount ? 'bg-white border-slate-300 text-slate-600 hover:bg-slate-100' : 'bg-slate-100 border-slate-200 text-slate-300'}`}
          title={erasePanelCount ? `Put the pixels removed from this figure back (its ${erasePanelCount} eraser stroke${erasePanelCount === 1 ? '' : 's'} are forgotten)` : 'Put the pixels removed from this figure back (this figure carries no eraser stroke)'}>
          ⟲ Clear erasures
        </button>
        <label className="flex items-center gap-1 text-[10px] font-bold text-sky-800 shrink-0"
          title="Size of the eraser brush, in millimetres of the canvas — the circle that follows the cursor shows the exact diameter">
          🧽 {clampEraseSize(eraseSize)} mm
          <input type="range" min={ERASE_SIZE_MIN} max={ERASE_SIZE_MAX} step="0.5" value={eraseSize}
            onChange={(e) => setEraseSize(clampEraseSize(e.target.value))} className="w-24 accent-sky-600" />
          <input type="number" min={ERASE_SIZE_MIN} max={ERASE_SIZE_MAX} step="0.5" value={eraseSize}
            onChange={(e) => setEraseSize(clampEraseSize(e.target.value))}
            className="w-12 border rounded px-0.5 py-px text-[10px]"
            title="Diameter of the brush in millimetres of the canvas (0.5 to 30 mm)" />
        </label>
        {/* 🌓 L'OMBRE DE LA FIGURE a son bouton EN TÊTE DE COLONNE (à côté de
            « 🎨 Transparent background ») : elle y est un geste d'un clic, et
            ses réglages fins restent dans « ▾ More options ». La ligne des
            outils ne la répète donc pas. */}
      </div>
      {/* ── LA LÉGENDE DU PANNEAU — LA SEULE COLONNE DE TOUTE LA LARGEUR ────────
          Elle est placée EN DERNIER, tout en bas de la fenêtre (`order-last
          col-span-full` en plein écran) : c'est le seul élément qui a besoin de
          toute la largeur — un sous-titre s'écrit — et le mettre en bas laisse la
          ligne du haut aux commandes. Le nom de la lettre n'est plus ici : il est
          attribué AUTOMATIQUEMENT par la position du panneau (renumberLetters), et
          sa taille — comme sa couleur et son gras — est une définition GÉNÉRALE du
          canvas, réglée une fois pour tous les panneaux dans les options du canvas
          (barre d'outils de l'éditeur, et barre du plein écran). */}
      <div className={bar
        ? 'flex flex-wrap items-start gap-x-1.5 gap-y-1 min-w-0 order-last col-span-full border-t border-slate-200 pt-1'
        : 'flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-slate-200 pt-1'}>
        <span className="text-[10px] font-bold text-slate-500 uppercase shrink-0"
          title={`Caption of panel ${selectedObj.letter || '—'} — a SUB-caption: it is never drawn inside the panel, it is merged into the figure caption at the bottom. The letter itself is automatic (by position) · size / colour / bold: canvas options.`}>
          Caption {selectedObj.letter || '—'}
        </span>
        <textarea rows={1} value={selectedObj.caption} onChange={e => updateObj({ caption: e.target.value })}
          placeholder={`Sub-caption for panel ${selectedObj.letter || ''} — merged into the figure caption at the bottom`}
          className="flex-1 min-w-[12rem] border rounded px-1 py-0.5 text-[11px] resize-y"
          title="Caption of this panel: written at the bottom of the figure, never inside the panel. “✎ Edit in place” opens it as a floating editor; the box can also be dragged taller." />
        <button type="button" onClick={() => setEditingObjCaption(selectedObj.id)}
          className="shrink-0 bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 font-bold px-1.5 py-0.5 rounded text-[10px]"
          title="Open the floating caption editor">✎ Edit in place</button>
      </div>
      {/* ── OBJECTS · LES OUTILS ET LA LISTE DES TEXTES ─────────────────────────
          « + Add Text » pose un texte au milieu du panneau, « ✏️ Place by click »
          le pose exactement où l'on clique ; chaque texte ajouté apparaît ensuite
          dans la liste, l'un sous l'autre, avec SES réglages (contenu, X / Y en
          mm, corps, couleur, gras, italique, ⧉ Copy, ✕). La liste défile
          au-delà de quelques lignes, pour ne pas étirer la fenêtre. */}
      <div className={panelCellCls(bar, bar ? 'order-4 md:col-start-3' : '')}>
        <button onClick={addText} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-1.5 py-0.5 rounded text-[10px] shrink-0"
          title="Add a text in the middle of the panel — then drag it on the object where you want it">+ Add Text</button>
        <button onClick={() => setPlaceTextMode(v => !v)}
          className={`font-bold px-1.5 py-0.5 rounded text-[10px] border shrink-0 ${placeTextMode ? 'bg-amber-500 text-white border-amber-600' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}
          title="Click on the object to place text exactly where you click">✏️ Place by click</button>
        {placeTextMode && <span className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 shrink-0">now click where the text should go</span>}
        {(selectedObj.texts || []).length === 0 && (
          <span className="text-[9px] text-slate-400 italic">“+ Add Text” (or “✏️ Place by click”), then drag it on the object</span>
        )}
        <div className="basis-full flex flex-wrap items-center gap-x-1.5 gap-y-1 max-h-[8rem] overflow-y-auto custom-scrollbar min-w-0">
        {(selectedObj.texts || []).map((tx, i) => (
          <span key={tx.id} className={`inline-flex flex-wrap items-center gap-x-1 border rounded px-1 py-0.5 ${activeText && activeText.txId === tx.id ? 'border-sky-400 ring-1 ring-sky-300 bg-sky-50' : 'border-slate-200 bg-white'}`}>
            {/* ☑ CE TEXTE REJOINT LE GROUPE DES COMMANDES ⇹ (avec les figures
                sélectionnées du même panneau) : un texte coché avec une figure
                suffit à les aligner l'un sur l'autre. Seule la POSITION est
                réglée — la taille d'un texte est la sienne (nombre de
                caractères × son corps). */}
            <button type="button"
              onClick={(e) => { e.stopPropagation(); toggleTextGroup(selectedObj.id, tx.id); }}
              className={`shrink-0 text-[10px] font-bold border rounded px-1 ${textGroupOf(selectedObj.id).includes(tx.id) ? 'bg-indigo-50 text-indigo-800 border-indigo-300' : 'text-slate-400 border-slate-200 hover:bg-slate-100'}`}
              title={textGroupOf(selectedObj.id).includes(tx.id)
                ? 'This text is ticked: the ⇹ Align / Distribute commands of the Figures column range it too (click to untick).'
                : 'Tick this text so the ⇹ Align / Distribute commands of the Figures column include it — together with the figures selected in this panel (only its position is set).'}>
              {textGroupOf(selectedObj.id).includes(tx.id) ? '☑' : '☐'}
            </button>
            <button type="button" onClick={() => setActiveText({ objId: selectedObj.id, txId: tx.id })}
              className="text-[9px] font-black text-slate-400 hover:text-sky-600 w-3 text-center shrink-0"
              title="Select THIS text — it is boxed on the canvas and its row lights up; “⧉ Copy” duplicates that one. A click on the text itself, on the canvas, does the same.">{i + 1}</button>
            <input type="text" value={tx.text} onChange={e => updateText(tx.id, { text: e.target.value })}
              className="flex-1 min-w-[7rem] border rounded px-1 py-0.5 text-[11px]" title="The text itself — drag it on the object to move it" />
            <label className="flex items-center gap-0.5 text-[9px] font-bold text-slate-500 shrink-0" title="Position of the text inside the panel, in millimetres">X
              <input type="number" step="0.5" value={tx.x} onChange={e => updateText(tx.id, { x: Number(e.target.value) })} className="w-12 border rounded px-0.5 py-px text-[10px]" />
            </label>
            <label className="flex items-center gap-0.5 text-[9px] font-bold text-slate-500 shrink-0" title="Position of the text inside the panel, in millimetres">Y
              <input type="number" step="0.5" value={tx.y} onChange={e => updateText(tx.id, { y: Number(e.target.value) })} className="w-12 border rounded px-0.5 py-px text-[10px]" />
            </label>
            <label className="flex items-center gap-0.5 text-[9px] font-bold text-slate-500 shrink-0" title="Size of the text, in points">
              pt
              <input type="number" min="4" max="96" value={tx.fontSize} onChange={e => updateText(tx.id, { fontSize: Number(e.target.value) })} className="w-11 border rounded px-0.5 py-px text-[10px]" />
            </label>
            <input type="color" value={tx.color} onChange={e => updateText(tx.id, { color: e.target.value })} className="w-6 h-5 rounded border cursor-pointer shrink-0" title="Colour of this text" />
            <label className="flex items-center gap-0.5 text-[9px] font-bold text-slate-500 shrink-0" title="Bold"><input type="checkbox" checked={tx.bold} onChange={e => updateText(tx.id, { bold: e.target.checked })} />B</label>
            <label className="flex items-center gap-0.5 text-[9px] font-bold text-slate-500 shrink-0" title="Italic"><input type="checkbox" checked={tx.italic} onChange={e => updateText(tx.id, { italic: e.target.checked })} />I</label>
            <button onClick={() => duplicateText(tx.id)}
              className="font-bold text-[10px] text-indigo-700 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 rounded px-1 shrink-0"
              title="Copy THIS text just next to it (3 mm down-right): the copy becomes the selected text — edit it in its own row (or double-click it on the canvas) and drag it where you want. Size, colour, bold and italic are kept. Ctrl+Z undoes the copy.">⧉ Copy</button>
            <button onClick={() => deleteText(tx.id)} className="text-red-400 hover:text-red-600 font-bold text-[11px] px-0.5 shrink-0" title="Delete text">✕</button>
          </span>
        ))}
        </div>
      </div>
      {panelMore && (
        /* Le repli ne prend pas toute la largeur non plus : en plein écran il
           occupe DEUX colonnes (la légende reste le seul élément pleine largeur). */
        <div className={`flex flex-wrap items-start gap-x-4 gap-y-1.5 ${bar ? 'min-w-0 order-12 md:col-span-full' : 'border-t border-slate-200 pt-1.5'}`}>
          {/* L'OMBRE DU PANNEAU — un PANNEAU projette une ombre (cadre, figure,
              lettre, textes) : « 🌓 Same shadow on every panel » l'applique à
              toute la figure en un clic, et le même bloc de contrôles sert aux
              flèches (même enregistrement, même filtre <feDropShadow>). La
              FIGURE a la sienne, juste à côté : c'est une autre commande (l'image
              seule, et son ombre suit ses pixels — voir 🌓 sur la ligne des
              figures). */}
          <div className="flex flex-col gap-1 shrink-0">
            <h5 className="text-xs font-bold text-slate-500 uppercase" title="Shadow of the whole PANEL — its white frame, the figure, the letter and the texts. The PICTURE can have its own too (“Shadow (figure)”, right below): the two are independent settings.">Shadow <span className="font-normal normal-case text-slate-400">(panel frame)</span></h5>
            <ShadowControls value={shadowSpec(selectedObj.shadow)} onChange={(v) => updateObj({ shadow: v })}
              hint="The whole panel (frame, figure, letter, texts) casts a drop shadow — in the composition and in every export." />
            <div className="flex">
              <button type="button" onClick={togglePanelsShadow}
                className="bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 font-bold px-2.5 py-1 rounded text-[10px]"
                title="Give EVERY panel of the figure the same shadow — click again to take it off all of them">
                🌓 {panelsShadowed ? 'Remove the shadow from every panel' : 'Same shadow on every panel'}
              </button>
            </div>
          </div>
          {/* ── LA FIGURE ACTIVE : SON OMBRE ET SON FOND ────────────────────────
              Deux réglages qui portent sur l'IMAGE (l'active, celle qui porte les
              poignées et le 🎯), pas sur le panneau. Ils vivent dans le repli —
              le bouton d'UN clic (🌓 Figure shadow) reste sur la ligne des
              figures — et le détourage a besoin de place : un aperçu large, une
              tolérance, deux boutons. */}
          {cropPanelIdx >= 0 && (
            <div className="flex flex-col gap-1.5 shrink-0 max-w-[24rem]">
              <h5 className="text-xs font-bold text-slate-500 uppercase"
                title={`Settings of FIGURE ${cropPanelIdx + 1} of this panel — the 🎯 chip in the figure list changes which one is active. Everything here belongs to the picture itself (its pixels, its shadow), never to the panel frame.`}>
                Figure {cropPanelIdx + 1} <span className="font-normal normal-case text-slate-400">(image itself)</span>
              </h5>
              {/* 🌓 L'OMBRE DE LA FIGURE — le filtre <feDropShadow> est posé sur un
                  groupe qui ENVELOPPE l'image : l'ombre suit les pixels de la
                  figure, donc son alpha (une image détourée projette l'ombre de
                  ce qu'elle MONTRE, pas celle de son rectangle). */}
              <div className="flex flex-col gap-1 border border-slate-200 rounded px-2 py-1 bg-white">
                <span className="text-[10px] font-bold text-slate-600 flex items-center gap-1">
                  🌓 Shadow of this figure
                  <button type="button" onClick={toggleActiveFigureShadow}
                    className="ml-auto font-bold text-[10px] border border-slate-300 rounded px-1.5 py-px text-slate-600 hover:bg-slate-50 shrink-0"
                    title={figShadowOn ? 'Take the shadow off this figure' : 'Give this figure the standard shadow (1.5 mm down-right, 1.2 mm blur)'}>
                    {figShadowOn ? '✕ remove' : '+ add'}
                  </button>
                </span>
                <ShadowControls value={shadowSpec((selectedImgs[cropPanelIdx] || {}).shadow)}
                  onChange={(v) => patchFigure(selectedObj.id, cropPanelIdx, { shadow: v })}
                  hint="The PICTURE casts its own drop shadow — it follows its pixels (a cut-out background gives the shadow of what the image shows, not of its rectangle) and it comes out in the composition and in every export." />
                {!figShadowOn && (
                  <span className="text-[9px] text-slate-400 italic">
                    No shadow on this figure yet — “+ add” puts the standard one on it, and the panel keeps its own.
                  </span>
                )}
              </div>
              {/* 🎨 LE FOND DEVIENT TRANSPARENT — un vrai travail sur les PIXELS
                  (utils/figureBackground.js) : on clique la couleur du fond sur
                  l'aperçu (c'est la SOURCE qui est montrée, pas la vignette), la
                  tolérance absorbe le bruit du JPEG, et le PNG ré-écrit sur la
                  figure rend le fond transparent — le panneau passe au travers et
                  l'ombre de la figure épouse enfin ce qu'elle montre. */}
              <div className="flex flex-col gap-1 border border-slate-200 rounded px-2 py-1 bg-white">
                <span className="text-[10px] font-bold text-slate-600">🎨 Transparent background</span>
                <div className="flex items-start gap-2">
                  {figBgSrc ? (
                    <img src={figBgSrc} alt="" onClick={pickBackgroundAt}
                      className="w-[7.5rem] h-[7.5rem] object-contain border border-slate-300 rounded cursor-crosshair shrink-0"
                      style={{ backgroundImage: 'repeating-conic-gradient(#e2e8f0 0% 25%, #ffffff 0% 50%)', backgroundSize: '12px 12px' }}
                      title="Click the colour that must disappear — the background of this figure. Click in a corner of the image: those pixels (and everything of that colour reachable from the borders) become transparent. The chequered background shows what “transparent” means." />
                  ) : (
                    <span className="text-[9px] text-slate-400 italic shrink-0 w-[7.5rem]">No pixels to show — put a figure in this panel first.</span>
                  )}
                  <div className="flex flex-col gap-1 min-w-[10rem]">
                    <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500"
                      title="How far from the clicked colour a pixel still counts as “background” (0 = the exact colour only). A JPEG shifts the background by a few units: 20–45 is the usual range. Raise it and the light greys next to the background go too.">
                      Tolerance {clampBgTol(bgTol)}
                      <input type="range" min={BG_TOL_MIN} max={BG_TOL_MAX} step="1" value={bgTol}
                        onChange={(e) => setBgTol(clampBgTol(e.target.value))} className="w-20 accent-teal-600" />
                      <input type="number" min={BG_TOL_MIN} max={BG_TOL_MAX} value={bgTol}
                        onChange={(e) => setBgTol(clampBgTol(e.target.value))} className="w-12 border rounded px-0.5 py-px text-[10px]" />
                    </label>
                    <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500"
                      title="“Touching the borders”: the colour goes only where it is REACHABLE from an edge — a white label inside a drawing is kept (the usual case). “Everywhere”: every pixel of that colour goes, even inside the drawing — for a background made of several pieces.">
                      What goes
                      <select value={bgMode} onChange={(e) => setBgMode(e.target.value)} className="border rounded px-0.5 py-px text-[10px]">
                        <option value="flood">touching the borders</option>
                        <option value="all">everywhere</option>
                      </select>
                    </label>
                    <div className="flex flex-wrap items-center gap-1">
                      <button type="button" onClick={() => removeFigureBackground(false)} disabled={bgBusy || !figBgSrc}
                        className={`font-bold px-1.5 py-0.5 rounded text-[10px] border shrink-0 ${bgBusy || !figBgSrc ? 'bg-slate-100 border-slate-200 text-slate-300' : 'bg-teal-600 text-white border-teal-700 hover:bg-teal-700'}`}
                        title="Take the clicked colour off this figure: those pixels become TRANSPARENT (a PNG is written in their place) — the panel shows through, and the figure's shadow then follows what the picture shows. Ctrl+Z puts the original image back.">
                        {bgBusy ? '⏳ Working…' : '🎨 Remove background'}
                      </button>
                      <button type="button" onClick={() => removeFigureBackground(true)} disabled={bgBusy || !figBgSrc}
                        className="font-bold px-1.5 py-0.5 rounded text-[10px] border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 shrink-0"
                        title="Automatic: the colours found in the four CORNERS are taken off in one go — a graph saved on a white background has them all. Nothing happens on an image whose background is not clear.">
                        Auto: the four corners
                      </button>
                    </div>
                    {(bgKey || figBgRecord) && (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-slate-600">
                        {bgKey && (
                          <>
                            <span className="w-4 h-4 rounded border border-slate-300 shrink-0" style={{ background: bgKey }} />
                            <code className="text-[10px]">{bgKey}</code>
                          </>
                        )}
                        {figBgRecord && (
                          <span className="text-[9px] font-bold text-teal-700" title="What these pixels carry: the figure keeps this mark, and Ctrl+Z undoes the whole cut-out.">
                            🎨 cut out · {figBgRecord.color} ±{figBgRecord.tol} · {figBgRecord.mode === 'all' ? 'everywhere' : 'borders'}
                          </span>
                        )}
                      </span>
                    )}
                    {bgMsg && <span className="text-[9px] font-bold text-slate-600">{bgMsg}</span>}
                    <span className="text-[9px] text-slate-400 italic">
                      Click the background on the picture, then “🎨 Remove background”. Place, size, crop, erasures and shadow are untouched — Ctrl+Z restores the original image (one step).
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
          {/* LA DISPOSITION LIBRE, LES AVERTISSEMENTS ET LES EXPLICATIONS : hors
              du chemin, ici. Rien n'a été retiré — seulement rangé. */}
          <div className="flex flex-col gap-1 min-w-[18rem] flex-1">
            {selectedFreeLayout && (
              <div className="flex flex-col gap-1 bg-indigo-50 border border-indigo-200 rounded px-2 py-1">
                <span className="text-[10px] font-bold text-indigo-800">⊞ Free layout — every figure of this panel keeps its own place (drag or resize it on the canvas).</span>
                <span className="text-[9px] text-indigo-700">
                  That is why adding a figure no longer moves the ones already here. Scale and grid columns act on the GRID layout only —
                  “⊞ Lay the figures out in a grid”, on the figure line just above, re-flows the panel when you want it back.
                </span>
              </div>
            )}
            <span className="text-[9px] text-slate-400 italic">
              Drag the figure on the canvas to shift it, drag its corner to resize it — 🎯 Precision (or Shift) makes both finer. With several panels selected (Ctrl+click), the first selected is the reference.
            </span>
            {keepAspect && (
              <span className="text-[9px] font-bold text-emerald-700">
                🔒 Keep aspect ratio is on (canvas option): the figure keeps its own width/height ratio, whatever the number of panels or the canvas size.
              </span>
            )}
            {cropPanelOn && (
              <span className="text-[9px] font-bold text-amber-700">
                Drag a rectangle on the canvas over the figure — the mouse release applies it (Shift or 🎯 Precision for the tenth of a percent). A crop only ever keeps what is left, so the parts already removed never come back.
              </span>
            )}
            {eraseMode && (
              <span className="text-[9px] font-bold text-sky-800">
                Drag on the canvas: everything the round brush touches is removed — one stroke = one Ctrl+Z. Click the eraser button again to leave the tool.
              </span>
            )}
          </div>
        </div>
      )}
      </div>
      )}
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
                    title={`Saved canvas — “💾 Save now” updates this entry in place, so every link that opens it (project page “🖼 Saved canvases”, “↩ Load” in the image library) always gets the latest version. Stored ${canvasHome ? `in the “${canvasScopeName(canvasHome)}” image library` : 'in the shared dataset image library — a LEGACY canvas: it keeps being updated there, but new canvases are stored in a project'}${storedScopeCount > 1 ? ` (and in ${storedScopeCount - 1} other ${storedScopeCount - 1 === 1 ? 'library' : 'libraries'})` : ''}.`}>
                🖼 {canvasLabel || homeEntry.label || 'saved canvas'} · {canvasHome ? `📁 ${canvasScopeName(canvasHome)}` : '🗂 dataset (kept as it was)'}
              </span>
            )}
            {/* ✏️ LE CRAYON. Toujours là — sur une toile jamais encore enregistrée
                il nomme le canvas pour la prochaine sauvegarde ; sur une toile
                déjà dans une bibliothèque il renomme SON entrée sur place. */}
            <button onClick={renameThisCanvas}
                    className="text-xs bg-white border border-slate-300 text-slate-700 px-3 py-1.5 rounded-lg font-bold hover:bg-slate-50"
                    title="Rename this canvas (the name shown on the badge here, in the image library, on the project page under “🖼 Saved canvases” and in the “✏️ Modify in Image Builder” links). Every library entry that already holds this composition is renamed in place — the figures that point at it follow. The file on Drive is renamed with it — SAME file, so its link and its composition sidecar follow and nothing is left behind under the old name (if the cloud is not connected, the next “💾 Save now” names it). If the browser store is full the new name is kept for this session only, and the message says so.">
              ✏️ Rename
            </button>
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
                    title="Create a NEW image — a new figure, not a wipe: the editor starts on a blank canvas with one empty panel (A) ready for its first capture, and the next “💾 Save now” adds a NEW image to the image library. The figure you were working on stays in the library exactly as it was last saved (its “↩ Load” brings it back). The canvas format — size, grid, borders, aspect ratio, letter size — is kept.">
              ➕ New image
            </button>
            <button onClick={() => { if(window.confirm('Clear the entire canvas?')) { commitHistory(); setObjects([]); setArrows([]); setSelectedId(null); setSelectedArrowId(null); setShapes([]); setSelectedShapeId(null); setCanvasEntries({}); setCanvasLabel(''); setCanvasKey(uid('cv')); } }} className="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-1 rounded font-bold hover:bg-red-100">Clear Canvas</button>
          </div>
        </div>

        {/* ✏️ Ce que le renommage a donné — le magasin plein se dit ici, jamais
            en silence (« le renommage ne marche pas »). */}
        {canvasNameMsg && (
          <p className={`text-[11px] font-bold rounded-lg border px-3 py-2 ${canvasNameMsg.includes('⚠️') ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-emerald-700 bg-emerald-50 border-emerald-200'}`}>
            {canvasNameMsg}
          </p>
        )}

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
            title="Draw a thin frame around every panel. It is part of the composition, so Export PNG, Save now and Insert into project follow this choice.">
            <input type="checkbox" checked={showPanelBorders} onChange={e => setShowPanelBorders(e.target.checked)} /> Panel borders
          </label>
          <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500 pb-2 cursor-pointer"
            title="Draw the cell divider guides across the canvas (layout guides). They are part of the composition, so Export PNG, Save now and Insert into project follow this choice.">
            <input type="checkbox" checked={showGridLines} onChange={e => setShowGridLines(e.target.checked)} /> Grid lines
          </label>
          <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500 pb-2 cursor-pointer"
            title="Canvas option: every figure keeps its own width/height ratio inside its panel, so changing the number of panels or the canvas width/height only rescales the figures instead of stretching them. It overrides the per-object “Fit → Stretch” choice.">
            <input type="checkbox" checked={keepAspect} onChange={e => setKeepAspect(e.target.checked)} /> 🔒 Keep aspect ratio
          </label>
          <label className="text-[10px] font-bold text-slate-500 flex flex-col" title="Size of the panel letters (A, B, C …). It is a FIGURE setting: changing it rescales every panel letter (A, B, C …) at once — no need to set it panel by panel, and the panels added later adopt it.">
            Letter size (pt)
            <input type="number" min="4" max="48" value={letterPt} onChange={e => setLetterSizeAll(e.target.value)} className="border rounded p-1 text-xs w-20" />
          </label>
          {/* LA DÉFINITION GÉNÉRALE DES LETTRES EST ICI (taille, couleur, gras) et
              non plus dans la fenêtre de l'objet : elle vaut pour TOUS les panneaux
              d'un coup, et chaque panneau ajouté ensuite l'adopte. Une figure est
              une planche : ses lettres (A, B, C …) se lisent ensemble, elles se
              règlent donc ensemble. */}
          <label className="text-[10px] font-bold text-slate-500 flex flex-col" title="Colour of the panel letters — a FIGURE setting, like the size: it applies to every panel (A, B, C …) at once, never to one panel alone.">
            Letter colour
            <input type="color" value={currentLetterColor()} onChange={e => setLetterColorAll(e.target.value)} className="border rounded w-20 h-7 cursor-pointer" />
          </label>
          <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500 pb-2 cursor-pointer" title="Bold for the panel letters — a FIGURE setting, like the size: it applies to every panel at once.">
            <input type="checkbox" checked={currentLetterBold()} onChange={e => setLetterBoldAll(e.target.checked)} /> Letters bold
          </label>
          <label className="text-[10px] font-bold text-slate-500 flex flex-col flex-1 min-w-[220px]" title="The caption written at the bottom of the figure. By default it merges the panel sub-captions in LETTER order (A: … · B: … · C: …), whatever order the panels were created in.">Global caption (click to edit — merges the object sub-captions in letter order)
            <span className="border border-slate-200 rounded p-1 text-xs bg-slate-50 text-slate-600 truncate hover:border-blue-400 hover:bg-blue-50 cursor-text" title={effectiveGlobalCaption} onClick={() => { setSelectedId(null); setEditingCaption(true); }}>{effectiveGlobalCaption || 'Merges the object sub-captions (A: …, B: …)'}</span>
          </label>
          {/* « ↗ Add arrow » et « 🌓 Shadow panels » ONT QUITTÉ CETTE BARRE : les
              deux commandes vivent maintenant dans la FENÊTRE DE L'OBJET, où
              elles se trouvaient déjà — « ↗ Arrow · ╱ Line · ▭ Rectangle ·
              ◯ Circle » ouvre la colonne OBJETS, et l'ombre des panneaux est
              dans « ▾ More options » (la barre de plein écran les a perdus de la
              même façon). Une seule porte d'entrée par commande, au même endroit
              quel que soit l'affichage. */}
          <button onClick={addObject} title="Add a panel — it takes the FIRST FREE cell of the grid, so it never lands on a panel that is already there (a full grid is reported instead of covering a figure)." className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs">+ Add Object</button>
          {/* ⛶ PLEIN ÉCRAN SUR L'OBJET — c'est le bouton qui REMPLACE
              « 📋 Paste » dans cette barre : coller un panneau vit dans la
              fenêtre de l'objet (section PANELS → « 📋 Paste ») et Ctrl+V marche
              partout, alors que passer en plein écran sur un panneau n'était
              atteignable que par « ⛶ Zoom Object », plus loin dans la même
              ligne. Un seul bouton, à la place demandée. */}
          <button onClick={() => selectedId && zoomToObject(selectedId)} disabled={!selectedId}
            title={selectedId
              ? 'Full screen on the selected object — the canvas zooms on that panel alone; “✕ Exit Full Screen” brings the whole figure back'
              : 'Select a panel first (Ctrl+click selects several)'}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-bold px-3 py-1.5 rounded-lg text-xs">⛶ Fullscreen on object</button>
          <button onClick={undo} disabled={!undoStack.current.length || histTick < 0} className="bg-slate-100 border border-slate-300 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-slate-200 disabled:opacity-40" title="Undo last change (Ctrl+Z)">↩ Undo</button>
          <button onClick={exportPng} title="300 DPI PNG of the composition — the blue selection square and resize handles are never included; panel borders and grid lines follow the checkboxes." className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs">Export PNG (300 DPI)</button>
          <button onClick={saveCanvasNow} disabled={saveBusy}
            title={canvasSaveProject()
              ? `Save this canvas NOW, without waiting for the automatic save: the rendered image (300 DPI) and its editable copy are written immediately into “${canvasScopeName(canvasSaveProject() || '')}” — that project's image library (Image Library → Project tab) and its project page under “🖼 Saved canvases”, where it reopens in this editor. Re-saving UPDATES that entry in place: nothing is duplicated, and every link that opens the canvas shows the latest version.`
              : 'Save this canvas NOW, without waiting for the automatic save — it has no project yet, so the dialog opens and asks WHICH project it belongs to (a canvas is always stored in a project’s image library). Re-saving updates that same entry in place; nothing is duplicated.'}
            className="bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white font-bold px-3 py-1.5 rounded-lg text-xs">💾 Save now{saveBusy ? '…' : ''}</button>
          {/* Le même enregistrement, mais en choisissant LE PROJET : c'est le
              dialogue qui porte le choix (un autre projet que celui du canvas) —
              le bouton au-dessus, lui, sauve dans le projet du canvas. */}
          <button onClick={openSaveDialog} title="Save the whole canvas now and choose WHICH PROJECT owns it — a canvas is stored in a project's image library (its Project tab + that project page's “🖼 Saved canvases”, where it can be reopened in this editor) and uploaded to that project's images folder on the cloud. Re-saving a canvas updates that same entry; nothing is duplicated."
            className="bg-white border border-amber-300 text-amber-700 hover:bg-amber-50 font-bold px-3 py-1.5 rounded-lg text-xs">▾ Save in another project…</button>
          {/* Où en est la sauvegarde AUTOMATIQUE (elle rend le canvas rouvable
              même si l'on oublie « 💾 Save now ») : l'écrire ici évite de
              croire qu'une composition a été perdue. */}
          {autoSaveBadgeInfo && (
            <span title={autoSaveBadgeInfo.title}
              className={`text-[10px] font-bold px-2 py-1 rounded border ${autoSaveBadgeInfo.tone === 'warn' ? 'bg-amber-50 text-amber-800 border-amber-300' : 'bg-emerald-50 text-emerald-700 border-emerald-300'}`}>
              {autoSaveBadgeInfo.text}
            </span>
          )}
          <button onClick={() => { setPickMode('replace'); setShowLibrary(true); }}
            title="Open the image library — browse images or upload new ones from your computer (Project or Dataset library)"
            className="bg-teal-600 hover:bg-teal-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs">🖼 Image Library</button>
          {/* « 📤 Insert into project… » a QUITTÉ cette barre : les deux gestes
              se confondaient (« je clique Insérer et le canvas n'est pas
              sauvé »). Sauver la composition et l'INSÉRER dans une section d'un
              projet sont deux choses différentes ; le bouton qui sauve est
              maintenant « 💾 Save canvas » ci-dessus, et l'insertion s'ouvre
              depuis le dialogue de sauvegarde (▾ Choose where…), qui est
              justement l'écran où l'on choisit le projet. */}
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
        {selectedObj && PropertiesPanel({})}
        {!selectedObj && selectedArrow && (
          <ArrowPropertiesPanel arrow={selectedArrow} onChange={updateArrow} onDelete={() => removeArrow()} />
        )}
        {!selectedObj && !selectedArrow && selectedShape && (
          <ShapePropertiesPanel shape={selectedShape} onChange={updateShape} onDelete={() => removeShape()} />
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
                 {/* « ↗ Add arrow » et « 🌓 Shadow panels » ont quitté cette
                     barre comme celle de la vue normale : les deux commandes
                     sont dans la fenêtre de l'objet (colonne OBJETS / « ▾ More
                     options »), au même endroit dans les deux affichages. */}
                 <button onClick={() => selectedId && zoomToObject(selectedId)} disabled={!selectedId}
                   title={selectedId
                     ? 'Re-centre and zoom the full screen view on the selected object'
                     : 'Select a panel first (Ctrl+click selects several)'}
                   className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-bold px-3 py-1.5 rounded-lg text-xs">⛶ Fullscreen on object</button>
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
                   title="The LETTERS of the figure: size (pt), colour and bold. All three are FIGURE settings — they apply to every panel letter (A, B, C …) at once, never to one panel alone.">
                   Letters
                   <input type="number" min="4" max="48" value={letterPt} onChange={e => setLetterSizeAll(e.target.value)} className="border border-slate-300 rounded px-1 py-0.5 text-[11px] w-14 bg-white font-normal" />
                   pt
                   <input type="color" value={currentLetterColor()} onChange={e => setLetterColorAll(e.target.value)} className="w-7 h-5 rounded border border-slate-300 bg-white cursor-pointer" title="Colour of every panel letter (figure setting)" />
                   <input type="checkbox" checked={currentLetterBold()} onChange={e => setLetterBoldAll(e.target.checked)} title="Bold for every panel letter (figure setting)" />
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
          <div ref={fsAreaRef} className="flex-1 min-h-0 overflow-auto relative bg-slate-200 p-8" onClick={() => { setSelectedId(null); setSelectedArrowId(null); setSelectedShapeId(null); }}>
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

          {/* LA BARRE DU BAS (plein écran) — le panneau d'objet devient une barre
              d'outils HORIZONTALE collée en bas de la fenêtre : les figures se
              règlent sur toute la largeur, juste sous le canvas, et rien ne
              recouvre plus la moitié droite de l'écran. Le panneau des flèches
              garde sa forme (quelques champs seulement). */}
          {(selectedObj || selectedArrow || selectedShape) && (
            <div className={`absolute inset-x-0 bottom-0 z-20 border-t border-slate-300 bg-white/95 shadow-2xl max-h-[38vh] overflow-y-auto custom-scrollbar px-2 py-1.5 ${selectedObj ? '' : 'flex justify-end'}`}>
              {selectedObj
                ? PropertiesPanel({ bar: true })
                : <div className="w-80 max-h-[48vh] overflow-y-auto custom-scrollbar">
                    {selectedArrow
                      ? <ArrowPropertiesPanel arrow={selectedArrow} isFloating onChange={updateArrow} onDelete={() => removeArrow()} />
                      : <ShapePropertiesPanel shape={selectedShape} isFloating onChange={updateShape} onDelete={() => removeShape()} />}
                  </div>}
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
                  title="Nothing in the library fits? Close it and start a NEW image (a blank canvas with one empty panel). The figure you were working on stays in the library as it was last saved, and the next “💾 Save now” creates a new library entry."
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
                <div className="flex gap-1 ml-auto" title="Replace: the selected object shows only this figure. Add: appends the figure to the selected object so several figures share one panel. Swap: only the ACTIVE figure’s pixels change — its place, size, crop and shadow stay.">
                  <button className={`px-3 py-1 rounded font-bold text-xs ${pickMode === 'replace' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`} onClick={() => setPickMode('replace')}>↺ Replace</button>
                  <button className={`px-3 py-1 rounded font-bold text-xs ${pickMode === 'add' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`} onClick={() => setPickMode('add')}>➕ Add</button>
                  <button className={`px-3 py-1 rounded font-bold text-xs ${pickMode === 'swap' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}`} onClick={() => setPickMode('swap')}>↔ Swap</button>
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
              {pickMode === 'swap' && (
                <span className="text-[10px] font-bold text-emerald-700">Click the image that SUBSTITUTES the ACTIVE figure: its frame — place and size — does not move, only the pixels change, and the crop window, shift, zoom and eraser strokes of the old picture are cleared so the new one is shown whole (its own proportions, in the same frame). Pick the figure to change first (🎯 in “Figures”, or click it on the canvas).</span>
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
                  onClick={() => (pickMode === 'add' ? handleAddImage(item) : (pickMode === 'swap' ? handleSwapImage(item) : handlePickImage(item)))}>
                  {/* La vignette montre ce que CE navigateur sait DESSINER : `url`
                      (copie locale) sinon `full` (copie cloud) — mais un lien de
                      partage Drive ne s'affiche pas tel quel, on le réécrit. Sans
                      rien à dessiner (composition pas encore rendue), un cadre
                      neutre remplace la vignette cassée. */}
                  {libThumbOf(item)
                    ? <img src={libThumbOf(item)} alt={item.label}
                        className="w-full h-24 object-contain bg-slate-50 rounded" />
                    : <span className="w-full h-24 flex items-center justify-center bg-slate-50 rounded text-slate-300 text-3xl"
                        title="No preview yet — the image is written on the next cloud pass (💾 Save now forces it right now)">🖼</span>}
                  <span className="text-xs mt-1 truncate w-full text-center font-bold">{item.label}</span>
                  {item.canvasData && (
                    <span className="text-[9px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5 mt-0.5" title="This library item is a saved Image Builder canvas — click ↩ Load to restore it into the editor (clicking the image still adds it as a figure)">
                      🖼 canvas
                    </span>
                  )}
                  {/* Une composition écrite par la sauvegarde AUTOMATIQUE n'a pas
                      encore de rendu : on le dit, plutôt que d'afficher une
                      vignette cassée ou un « High-Res » qui n'existe pas. */}
                  {item.canvasData && !item.drive && (
                    <span className="text-[8px] text-amber-600 font-bold" title="The editable composition is here; the rendered image is written on the next cloud pass (💾 Save now forces it right now).">⏳ image on its way</span>
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
                      className="text-[9px] font-bold text-slate-500 hover:text-blue-600 border border-slate-200 rounded px-1.5 py-0.5 hover:border-blue-300" title="Rename this image — if it is already on Drive the file there is renamed too (same file: its link and its composition sidecar follow it, so no copy is left under the old name)">✎</button>
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
                  <span className={`text-[8px] font-bold ${item.drive ? 'text-emerald-600' : 'text-amber-600'}`} title={item.drive ? 'The high-resolution copy is in the cloud' : 'No cloud copy yet — the pixels live in this browser only'}>{item.drive ? 'High-Res' : 'this browser'}</span>
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
                  const label = canvasLabel || (effectiveGlobalCaption && String(effectiveGlobalCaption).trim()
                    ? `Figure — ${String(effectiveGlobalCaption).trim().slice(0, 60)}`
                    : `Canvas ${new Date().toLocaleDateString()}`);
                  /* ── LES PIXELS PARTENT AU DRIVE *AVANT* D'ÊTRE ÉCRITS ICI ───────
                     ⛔ LE DÉFAUT (cinquième signalement : « je sauve, je quitte,
                        mes images n'y sont plus »). La composition était écrite
                        dans le document du projet SOUS FORME D'IMAGE ENCODÉE
                        (plusieurs mégaoctets) et SEULEMENT là : le magasin du
                        navigateur (~5 Mo par site, partagé avec les listes de
                        figures) ne pouvait pas la garder. L'écriture d'urgence
                        (saveProjectsRescued) faisait alors de la place en
                        remplaçant les pixels par leur lien Drive… un lien que
                        cette figure n'avait JAMAIS eu : `url` devenait vide. La
                        page du projet montrait donc l'emplacement de la figure
                        sans son image, et il fallait la réimporter à la main
                        depuis le Drive.
                     ✅ La copie cloud est faite d'abord : la figure insérée
                        garde `driveUrl`, donc (a) la page la remonte du Drive si
                        les pixels locaux ont dû partir, (b) l'allègement devient
                        SANS PERTE (l'étape 1 de saveProjectsRescued transforme
                        l'image en lien, elle ne jette rien). Si le cloud n'est
                        pas connecté, on continue comme avant — mais on le DIT. */
                  let cloud = null;
                  try {
                    // Même nom que « 💾 Save canvas » pour CETTE composition (clé de
                    // canvas) : la figure insérée et l'entrée de bibliothèque
                    // partagent leur fichier, et deux canvas du même libellé ne
                    // s'écrasent pas (voir « UNE FIGURE = UN FICHIER »).
                    cloud = await uploadFigureToDrive({
                      full: dataUrl,
                      label,
                      projectName: prj.name || '',
                      identity: figureFileIdentity({ canvasData: { canvasKey } })
                    });
                  } catch (err) {
                    console.warn('Project insert → Drive failed:', err && err.message);
                    cloud = null;
                  }
                  const cloudUrl = (cloud && (cloud.driveUrl || cloud.url)) || '';
                  if (insertLink) {
                    try {
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
                    // Le lien de la copie cloud : c'est lui qui rend la figure
                    // indestructible (voir le commentaire ci-dessus).
                    ...(cloudUrl ? { drive: true, driveUrl: cloudUrl, full: cloudUrl } : {}),
                    ...(link || {})
                  });
                  /* ⛔ L'ÉCRITURE SE VÉRIFIE. `saveProjects()` rendait un
                     { ok:false } que personne ne lisait : le dialogue annonçait
                     « The image is now shown in … » alors que RIEN n'avait été
                     écrit. saveProjectsRescued écrit, vérifie, et fait de la
                     place DANS le navigateur si le magasin refuse — en gardant
                     alors le lien Drive (aucune perte). */
                  const saved = saveProjectsRescued(projects, { projectId: prj.id, fields: {} });
                  const where = `"${prj.name}" → ${sec}`;
                  if (!saved.ok) {
                    setInsertMsg(`⚠️ This browser refused to store the project (${saved.error || 'the store is full'}): the image is in ${where} on this page only and would NOT survive a reload. Free some room (💾 Save now, or delete a dataset you no longer need) and insert again.`);
                  } else if (saved.droppedImages) {
                    setInsertMsg(`✅ The image is in ${where}. ⚠️ This browser's store was FULL: ${saved.droppedImages} locally kept image copy(ies) were replaced by their Drive link — the picture is still shown (it is read from Drive), and the figure keeps its place, its name and its caption.`);
                  } else if (!cloudUrl) {
                    setInsertMsg(`✅ The image is in ${where}. ⚠️ No cloud copy could be made (Google Drive / Nextcloud not connected): the pixels live in this browser only — connect the cloud from the sidebar so the picture follows you.`);
                  } else if (link) {
                    setInsertMsg(`✅ The image is now shown in ${where} (it stays there), and it is kept on Drive. 🔗 Its canvas was stored in that project's image library, so the project page offers “✏️ Modify in Image Builder” to reopen this composition.`);
                  } else {
                    setInsertMsg(`✅ The image is now shown in ${where} (it stays there), and it is kept on Drive. No canvas link was stored (the checkbox is off).`);
                  }
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
              <h3 className="font-bold text-lg">💾 Save canvas — which project?</h3>
              <button onClick={() => setSaveOpen(false)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <label className="text-[10px] font-bold text-slate-500 flex flex-col gap-1">Canvas name
              <input value={saveName} onChange={(e) => setSaveName(e.target.value)} autoFocus
                className="border border-slate-300 rounded px-2 py-1.5 text-xs font-normal text-slate-700 outline-none focus:border-amber-500"
                placeholder="Figure — …" />
            </label>
            <label className="text-[10px] font-bold text-slate-500 flex flex-col gap-1">Project that owns it
              <select value={saveDest} onChange={(e) => { setSaveDest(e.target.value); setSaveMsg(''); }}
                className="border border-slate-300 rounded px-2 py-1.5 text-xs bg-white font-normal text-slate-700">
                {!myWritableProjects.length && <option value="">— no project you may write to —</option>}
                {myWritableProjects.map((p) => <option key={p.id} value={p.id}>📁 {p.name} — its Project tab + “🖼 Saved canvases”</option>)}
              </select>
            </label>
            <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded p-2">
              {saveDest
                ? <>The whole composition is stored as an image in <span className="font-bold">“{canvasScopeName(saveDest)}”</span>'s library
                    (<span className="font-bold">Image Library → Project</span> tab) and listed on that project page under
                    <span className="font-bold"> “🖼 Saved canvases”</span>, where it reopens in this editor. Figures inserted into that
                    project's sections keep showing the image itself.</>
                : <>A canvas lives in <span className="font-bold">a project</span>'s image library — it is never stored in the shared dataset
                    library any more ({' '}<span className="font-bold">Image Library → Project</span> tab, and the project page under
                    <span className="font-bold"> “🖼 Saved canvases”</span>).{myWritableProjects.length
                      ? ' Pick a project above.'
                      : ' No project you may write to was found: create one (or ask its owner for “modify” access) and save again.'}</>}
            </p>
            {homeEntry && canvasScopeKey(saveDest) !== canvasScopeKey(canvasHome) && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                ⚠️ This canvas is already saved in {canvasScopeName(canvasHome)}. Saving it here stores a
                <span className="font-bold"> copy</span> in the new project; each project keeps its own entry, and “💾 Save now”
                always updates the copy of the project you pick.
              </p>
            )}
            {saveMsg && <p className={`text-xs font-bold ${saveMsg.startsWith('✅') ? 'text-green-600' : 'text-slate-600'}`}>{saveMsg}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              {/* L'insertion dans une section d'un projet se fait DEPUIS ici :
                  c'est le seul écran où le projet est déjà choisi, et cela sépare
                  « sauver ma composition » de « poser cette image dans une
                  section du projet ». */}
              <button type="button"
                onClick={() => {
                  setSaveOpen(false);
                  setInsertTarget({ projectId: (canWriteLibProject(saveDest) ? saveDest : '') || (myWritableProjects[0] && myWritableProjects[0].id) || '', section: 'background' });
                  setInsertMsg('');
                  setInsertOpen(true);
                }}
                disabled={saveBusy}
                title="Render this composition into a project section (Background / Discussion / Conclusions). The inserted figure keeps a link back to this canvas, so the project page can reopen it here with “✏️ Modify in Image Builder”."
                className="mr-auto bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white font-bold px-3 py-1.5 rounded-lg text-xs">📤 Insert into a project section…</button>
              <button onClick={() => setSaveOpen(false)} disabled={saveBusy}
                className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40">Cancel</button>
              <button onClick={doSaveCanvas} disabled={saveBusy}
                className="bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white font-bold px-4 py-1.5 rounded-lg text-xs">
                {saveBusy ? '⏳ Saving…' : '💾 Save now'}
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
};