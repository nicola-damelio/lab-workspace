/* ============================================================================
   FIGURE SHAPES — lines, rectangles and circles for the Image Builder canvas.

   An arrow (utils/figureArrows.js) is a POINTER: it says “look here”. A figure
   also very often needs a plain GEOMETRY overlay — a LINE to show a trend or cut
   a region off, a RECTANGLE to box a set of points, a CIRCLE to ring one peak.
   None of those existed: `objects[]` are PANELS (a letter + a grid cell + a
   figure) and could not host them.

   A shape is therefore the arrow's sibling: a canvas-level record in
   millimetres on the same space as the SVG viewBox (`x1,y1` – `x2,y2` are two
   OPPOSITE CORNERS, whatever the kind), so it takes no letter, occupies no cell
   and never disturbs the panel numbering. Every shape carries its own
   `{ stroke, width, dash, fill, shadow }` and is edited like an arrow: drag the
   body to move it, drag a corner handle to resize it.

   Everything here is PURE (no React, no DOM) and is imported by BOTH
   src/components/ImageBuilder.jsx and the scratch test _builder_shapes_test.mjs,
   so the geometry that is verified is exactly the geometry that is drawn.
   ========================================================================= */

import { shadowFilterId } from './figureArrows';

/** The three kinds of shape the object window offers. */
export const SHAPE_KINDS = ['line', 'rect', 'ellipse'];

/** Human labels, in the order of the buttons (object window → Objects). */
export const SHAPE_LABELS = { line: 'Line', rect: 'Rectangle', ellipse: 'Circle' };

/**
 * Defaults of a NEW shape: a red outline of 0.7 mm (the arrow's pen), no fill —
 * a rectangle or a circle is a FRAME unless the user asks for a tint. `curve`
 * is the bow of a LINE (mm) and `style` its switch, exactly like an arrow's.
 */
export const DEFAULT_SHAPE = {
  stroke: '#e11d48',
  width: 0.7,
  dash: false,
  fill: 'none',        // 'none' | a colour: the tint inside a rectangle / circle
  fillOpacity: 0.18,   // opacity of that tint (0…1)
  style: 'straight',   // 'straight' | 'curved' (a LINE only)
  curve: 0,            // bow of a curved line, in mm
  shadow: null         // { dx, dy, blur, color, opacity } — same record as arrows
};

/** Smallest side a shape can be dragged to, in mm (keeps handles apart). */
export const SHAPE_MIN_MM = 1.5;

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const r3 = (v) => Math.round(Number(v) * 1000) / 1000;
const clamp = (v, lo, hi, fallback) => Math.max(lo, Math.min(hi, num(v, fallback)));
const color = (v, fallback) => ((typeof v === 'string' && v.trim()) ? v.trim() : fallback);

/** A brand-new shape. `kind` is 'line' | 'rect' | 'ellipse', `patch` overrides. */
export const newShape = (kind, id, patch = {}) => ({
  id: String(id == null ? '' : id),
  kind: SHAPE_KINDS.includes(kind) ? kind : 'rect',
  x1: 0, y1: 0, x2: 0, y2: 0,
  ...DEFAULT_SHAPE,
  ...(patch && typeof patch === 'object' ? patch : {})
});

/**
 * The usable shape of a record — every field filled and clamped, so a record
 * typed by hand (or written by a later version) can never produce a NaN in the
 * SVG attributes, which would silently drop the whole shape.
 */
export const normalizeShape = (s) => {
  const src = s || {};
  const kind = SHAPE_KINDS.includes(src.kind) ? src.kind : 'rect';
  const fill = color(src.fill, DEFAULT_SHAPE.fill);
  return {
    id: String(src.id == null ? '' : src.id),
    kind,
    x1: num(src.x1, 0), y1: num(src.y1, 0),
    x2: num(src.x2, 0), y2: num(src.y2, 0),
    stroke: color(src.stroke, DEFAULT_SHAPE.stroke),
    width: clamp(src.width, 0.05, 6, DEFAULT_SHAPE.width),
    dash: !!src.dash,
    fill: fill === 'none' ? 'none' : fill,
    fillOpacity: clamp(src.fillOpacity, 0, 1, DEFAULT_SHAPE.fillOpacity),
    style: kind === 'line' && src.style === 'curved' ? 'curved' : 'straight',
    curve: clamp(src.curve, -200, 200, 0),
    shadow: src.shadow || null
  };
};

/** The bounding box of the two corners, in mm — always positive w/h. */
export const shapeBox = (s) => {
  const sh = normalizeShape(s);
  const x = Math.min(sh.x1, sh.x2), y = Math.min(sh.y1, sh.y2);
  return {
    x, y, w: Math.abs(sh.x2 - sh.x1), h: Math.abs(sh.y2 - sh.y1),
    cx: (sh.x1 + sh.x2) / 2, cy: (sh.y1 + sh.y2) / 2
  };
};

/** Id of the `<filter>` of a shape's shadow — its own, like a panel / an arrow. */
export const shapeShadowFilterId = (id) => shadowFilterId(`shape-${id == null ? '' : id}`);

/** The dash pattern of a shape, in mm — proportional to the pen, like arrows. */
export const shapeDashArray = (s) => {
  const sh = normalizeShape(s);
  return sh.dash ? `${+(sh.width * 3).toFixed(2)} ${+(sh.width * 2).toFixed(2)}` : undefined;
};

/**
 * Control point of a bowed line: the middle of the chord, pushed `curve` mm to
 * the side — a negative bow goes the other way. (figureArrows' `quadPoint`
 * draws the curve; this only places the control.)
 */
export const curveControl = (p0, p1, bow) => {
  const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return { x: mx, y: my };
  const k = (2 * num(bow, 0)) / len;       // ×2: the curve reaches half the bow
  return { x: r3(mx - dy * k), y: r3(my + dx * k) };
};

/**
 * The geometry the canvas draws — the same contract as `arrowGeometry`: the two
 * corners, the bounding box, the centre, and the LINE path (a `curved` line is a
 * quadratic whose bulge is `curve` mm; a rectangle or a circle is drawn from the
 * box, so `path` is only meaningful for a line).
 */
export const shapeGeometry = (raw) => {
  const shape = normalizeShape(raw);
  const box = shapeBox(shape);
  const p0 = { x: shape.x1, y: shape.y1 };
  const p1 = { x: shape.x2, y: shape.y2 };
  const chord = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const curved = shape.kind === 'line' && shape.style === 'curved' && Math.abs(shape.curve) > 0.01 && chord > 0;
  const pc = curved ? curveControl(p0, p1, shape.curve) : { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const path = curved
    ? `M ${r3(p0.x)} ${r3(p0.y)} Q ${r3(pc.x)} ${r3(pc.y)} ${r3(p1.x)} ${r3(p1.y)}`
    : `M ${r3(p0.x)} ${r3(p0.y)} L ${r3(p1.x)} ${r3(p1.y)}`;
  return { shape, box, p0, p1, pc, chord, curved, straight: !curved, path };
};

/** The LINE path of a shape (see shapeGeometry). */
export const shapePathData = (s) => shapeGeometry(s).path;

/** The tint inside a rectangle / circle — `null` when the shape is a frame. */
export const shapeFillOf = (s) => {
  const sh = normalizeShape(s);
  return sh.fill === 'none' ? null : sh.fill;
};

/** The two corners that carry the resize handles — the two stored corners. */
export const shapeHandles = (s) => {
  const sh = normalizeShape(s);
  return [{ key: 'p0', x: sh.x1, y: sh.y1 }, { key: 'p1', x: sh.x2, y: sh.y2 }];
};

/** A shape is “drawable” once it has a size — a click without a drag is not. */
export const isDrawnShape = (s) => {
  const sh = normalizeShape(s);
  const b = shapeBox(sh);
  return sh.kind === 'line' ? b.w >= SHAPE_MIN_MM / 2 || b.h >= SHAPE_MIN_MM / 2 : (b.w >= SHAPE_MIN_MM / 2 && b.h >= SHAPE_MIN_MM / 2);
};

/**
 * Where a NEW shape is dropped, for a given kind: a sensible default rectangle
 * in the middle of the canvas (a quarter of it), so the user can immediately
 * drag it instead of having to draw one blind — exactly like “↗ Add arrow”
 * drops a default arrow across the middle.
 */
export const defaultShapeRect = (kind, canvasW, canvasH) => {
  const w = Math.max(SHAPE_MIN_MM, num(canvasW, 100) * 0.25);
  const h = Math.max(SHAPE_MIN_MM, num(canvasH, 100) * 0.3);
  const x = (num(canvasW, 100) - w) / 2;
  const y = (num(canvasH, 100) - h) / 2;
  const k = SHAPE_KINDS.includes(kind) ? kind : 'rect';
  return k === 'line'
    ? { x1: +x.toFixed(1), y1: +(y + h / 2).toFixed(1), x2: +(x + w).toFixed(1), y2: +(y + h / 2).toFixed(1) }
    : { x1: +x.toFixed(1), y1: +y.toFixed(1), x2: +(x + w).toFixed(1), y2: +(y + h).toFixed(1) };
};

/**
 * The corners of a shape after a resize gesture: the grabbed corner (handle
 * `p0` or `p1`) follows the pointer by (dx, dy) mm and the OPPOSITE corner stays
 * exactly where it is. A rectangle / circle never goes below SHAPE_MIN_MM on
 * either side (so a hand can always grab the handle again); a LINE is free — a
 * perfectly horizontal or vertical line is a legitimate drawing.
 */
export const resizedShapeCorners = (s, key, dx, dy) => {
  const sh = normalizeShape(s);
  const held = key === 'p1' ? 'p1' : 'p0';
  const grab = held === 'p1' ? { x: sh.x2, y: sh.y2 } : { x: sh.x1, y: sh.y1 };
  const anchor = held === 'p1' ? { x: sh.x1, y: sh.y1 } : { x: sh.x2, y: sh.y2 };
  const next = { x: grab.x + num(dx, 0), y: grab.y + num(dy, 0) };
  if (sh.kind !== 'line') {
    const away = (v, a) => (Math.abs(v - a) < SHAPE_MIN_MM ? a + (v >= a ? SHAPE_MIN_MM : -SHAPE_MIN_MM) : v);
    next.x = away(next.x, anchor.x);
    next.y = away(next.y, anchor.y);
  }
  // Les deux coins sont rendus dans l'ORDRE des poignées (le tenu garde son nom :
  // le glissement suivant repart du même coin).
  const p0 = r3coord(held === 'p1' ? anchor.x : next.x, held === 'p1' ? anchor.y : next.y);
  const p1 = r3coord(held === 'p1' ? next.x : anchor.x, held === 'p1' ? next.y : anchor.y);
  return { x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y };
};
const r3coord = (x, y) => ({ x: r3(x), y: r3(y) });
