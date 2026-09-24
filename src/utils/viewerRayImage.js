/* =========================================================================
   src/utils/viewerRayImage.js
   The « ✨ Ray » STILL of the 3D viewer — ONE high-resolution PNG of EXACTLY
   what is on screen, written by the very engine that drew it.

   WHY THE NGL RENDERER, AND NOT A SECOND ENGINE. The scene the user styles is
   an NGL 2.4 WebGL canvas: its own representation set, the editable palettes of
   the ⚙ wheel, the ⚡ ESP overlays, the trajectory frame on screen, the
   clipping plane, the fog, the light rig of §3 (utils/viewerLightRig.js) and
   the filled ring plates the viewer builds itself as MeshBuffer objects. A
   second engine cannot DRAW that scene: it could only REBUILD it from a
   translation of our looks, and every translation loses something (the ring
   plates have no equivalent, the per-atom tables are ours, the frame moves).
   NGL can draw IT — and it can draw it BIGGER: `makeImage` is its own
   supersampling path, which re-renders the same scene tile by tile at `factor`
   times the canvas and averages the tiles into one PNG. That is the honest
   « ray » of this viewer, pixel-for-pixel the picture on screen.

   WHAT THE INSTALLED ngl 2.4.0 REALLY OFFERS (read in the package):
     · dist/declarations/viewer/viewer-utils.d.ts —
         ImageParameters = { trim, factor, antialias, transparent, onProgress }
         makeImage(viewer, params): Promise<Blob>   ← a PROMISE, never a canvas
     · dist/ngl.js, the SHIPPED defaults —
         { trim: false, factor: 1, antialias: false, transparent: false }
       so `factor` is written explicitly here: left alone, the « ray » would be
       a plain 1× screenshot.
     · the same code builds its output canvas as
         antialias ? width*factor/2 : width*factor        (_factor doubled when
       antialias is on → 4·factor² tiles, averaged), i.e. THE OUTPUT IS ALWAYS
       `canvasPixels × factor`, and resolves with `toBlob(cb, 'image/png')`.
     · while it renders, `makeImage` scales every `linewidth` and every uniform
       `size` by the factor, so the sticks and the labels keep the thickness
       they have on screen instead of vanishing in a bigger picture, and it
       restores the viewer's sampling AND the clear alpha when it is done — a
       transparent background never leaks into the interactive canvas.

   WHICH FACTOR IS HONEST (the follow-up: « se clicco su ray, anche per un piccolo
   peptide il rendering non finisce mai e non arrivo a vedere l'immagine »). The
   still is not only RENDERED by NGL: its pixels are walked a second time for the
   cast shadows and the PNG is decoded and encoded once more (see
   viewerRayShadows.js) — all of it O(output pixels), and the output is
   `canvasPixels × factor`. On a HiDPI / large canvas that used to reach a
   hundred megapixels: minutes inside getImageData / toBlob and gigabytes of
   canvas memory, while the button still said « Rendering… ». What the whole chain
   can afford is therefore FIXED here (RAY_MAX_PIXELS), the antialias pass — the
   only knob that multiplies the RENDER, 4·factor² tiles instead of factor² — is
   asked for only while the tiles stay few (RAY_ANTIALIAS_MAX_FACTOR; from 3× up
   every tile IS a supersample of the canvas), the shadow pass has its own budget
   (RAY_SHADOW_MAX_PIXELS) and every step reports itself — `onProgress` for the
   tiles, `onStatus` for the rest — so a click on ✨ Ray always ends with an image.

   THIS MODULE PUBLISHES NOTHING: it WRITES A FILE on the computer (the request),
   and the 📷 button that fed the Figure library has been removed from the viewer
   (the follow-up: « il pulsante figure é ridondante »). Nothing here is stateful:
   every function takes the stage it reads from.

   THE CAST SHADOWS. The report: « the ray button only takes a snapshot of the
   image but does not introduce casted shadows ». NGL 2.4 has no shadow-map pass
   at all (see the long note in NMRMoleculeViewer.jsx above `flagMeshShadows`),
   so the shadow of the still is computed from the ATOMS, on the CPU, in
   utils/viewerRayShadows.js: the same camera NGL just rendered with, the same
   key light of the rig, the same pixels. `shadows: false` (or no `lightDir`)
   gives the plain supersampled still; a shadow that cannot be built for any
   reason falls back on that same plain still, never on an error.
   ========================================================================= */

import { addCastShadowsToBlob, buildRayShadowMask, rayShadowInputsOf, rayShadowNote, RAY_SHADOW_MAX_PIXELS } from './viewerRayShadows.js';

/* The supersampling factors the bar offers — the honest NGL knob, expressed
   against the canvas the user is looking at (`factor × canvas pixels`). 3× is
   the default: a 1600×900 canvas becomes 4800×2700 px, which is a publication
   still, and the 9 tiles it costs render in a couple of seconds. */
export const RAY_FACTORS = Object.freeze([2, 3, 4, 6]);
export const RAY_DEFAULT_FACTOR = 3;
/* The output budget — THE guarantee that a « ray » comes back. The PNG is decoded,
   its pixels walked once for the cast shadows and encoded again, so the old 40 Mpx
   (a 200 MB RGBA canvas, three times over) was minutes and gigabytes on a big —
   HiDPI — canvas: the follow-up report « il rendering non finisce mai e non arrivo
   a vedere l'immagine ». A still of this viewer is a publication figure at 12–16
   Mpx, and that is what the whole chain can afford on any machine. */
export const RAY_MAX_PIXELS = 16e6;
export const RAY_MAX_FACTOR = 8;
/* From this factor up the antialias pass is NOT asked for: NGL's own supersampling
   already renders every tile as a 1/factor window at the canvas resolution, so the
   3× still IS a 3× supersample, while the extra pass multiplies the render by four
   (4·factor² tiles). */
export const RAY_ANTIALIAS_MAX_FACTOR = 2;
/* What the Ray message says when the still was too big for its shadow pass. */
export const RAY_SHADOW_SKIP_NOTE = '· cast shadows skipped (the still is too big)';
// Used when the WebGL limits cannot be read (no context yet, a probe): NGL
// renders its tiles into a canvas of `canvasPixels × factor`.
export const RAY_DIM_LIMIT_FALLBACK = 8192;

/* ---- The canvas NGL draws into, and its real pixel size ------------------- */
const canvasOfViewer = (viewer) => {
  try {
    if (!viewer) return null;
    const renderer = viewer.renderer;
    if (renderer && renderer.domElement) return renderer.domElement;
    return viewer.canvas || null;
  } catch { return null; }
};

/* The size NGL will really render — THE numbers `makeImage` multiplies. NGL's
   tiled renderer (ngl 2.4, the TiledRenderer of the installed dist: `this._width
   = this._viewer.width`, `canvas.width = this._width * this._factor`) reads
   `viewer.width` / `viewer.height` — the CSS size NGL keeps in `Viewer.setSize`
   (`container.getBoundingClientRect()`, called by `handleResize`, which this
   viewer calls on every layout change) — and produces a still of
   `width × factor`.
   ⚠ The canvas's own `width` is the DRAWING BUFFER, not that number:
   `Viewer.setSize` also calls `renderer.setPixelRatio(window.devicePixelRatio)`,
   so on any HiDPI screen the buffer is `devicePixelRatio ×` the still (1.25× on a
   scaled Windows display, 2× on a Retina one). Reading it made the shadow's mask
   1.25× too big for the image, made the PNG the shadow pass writes the still
   UPSCALED by that factor (soft for no reason, and bigger than the factor asked
   for) and made the size in the message and in the file name wrong. NGL's own
   numbers are read first; the canvas only answers when the viewer cannot (a stub
   of a test, another engine). */
export const viewerPixelsOf = (stage) => {
  const viewer = stage && stage.viewer;
  const fw = Number(viewer && viewer.width);
  const fh = Number(viewer && viewer.height);
  if (Number.isFinite(fw) && fw > 0 && Number.isFinite(fh) && fh > 0) return { width: fw, height: fh };
  const canvas = canvasOfViewer(viewer);
  const w = canvas ? Number(canvas.width) : 0;
  const h = canvas ? Number(canvas.height) : 0;
  if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) return { width: w, height: h };
  return { width: 0, height: 0 };
};

/* The WebGL context already in use, asked for with the types a canvas can
   answer: a canvas that owns a 'webgl' context returns it for 'webgl' and
   `null` for 'webgl2' — asking again never creates a second context. */
export const glOfViewer = (stage) => {
  const canvas = canvasOfViewer(stage && stage.viewer);
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  try {
    return canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl') || null;
  } catch { return null; }
};

/* The largest dimension the GPU accepts for a texture / renderbuffer / viewport
   — the smallest of the three, since NGL's tile canvas is a texture-backed
   drawing surface. Falls back on RAY_DIM_LIMIT_FALLBACK. */
export const rayDimLimitOf = (stage) => {
  const gl = glOfViewer(stage);
  if (!gl || typeof gl.getParameter !== 'function') return RAY_DIM_LIMIT_FALLBACK;
  const nums = [];
  const push = (v) => { const n = Number(v); if (Number.isFinite(n) && n > 0) nums.push(n); };
  try {
    push(gl.getParameter(gl.MAX_TEXTURE_SIZE));
    push(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    if (vp && vp.length >= 2) { push(vp[0]); push(vp[1]); }
  } catch { /* a lost context → the fallback */ }
  if (!nums.length) return RAY_DIM_LIMIT_FALLBACK;
  let min = nums[0];
  nums.forEach((n) => { if (n < min) min = n; });
  return min;
};

const clampFactorValue = (factor) => {
  const n = Math.round(Number(factor));
  if (!Number.isFinite(n)) return RAY_DEFAULT_FACTOR;
  return Math.min(RAY_MAX_FACTOR, Math.max(1, n));
};

/* What a factor WOULD produce on this canvas — the size the bar writes in its
   list, so the user reads the pixels before paying for the render. */
export const rayPixelsOf = (stage, factor) => {
  const f = clampFactorValue(factor);
  const { width, height } = viewerPixelsOf(stage);
  return { factor: f, width: width * f, height: height * f, pixels: width * f * height * f };
};

/* The factor really usable on this canvas: clamped to the budget and to what
   the GPU accepts. A canvas that is not laid out yet (no size) keeps the
   requested factor — the render itself then fails with a clear message. */
export const clampRayFactor = (stage, factor) => {
  const wanted = clampFactorValue(factor);
  const { width, height } = viewerPixelsOf(stage);
  if (!width || !height) return wanted;
  const limit = rayDimLimitOf(stage);
  let out = wanted;
  while (out > 1 && (width * out * height * out > RAY_MAX_PIXELS || width * out > limit || height * out > limit)) out -= 1;
  return out;
};

/* The tiles NGL really renders for a factor: `factor²` normally, 4·factor² with the
   antialias pass (TiledRenderer doubles its own factor). It is the honest number of
   renders behind one still — what the progress line counts, and what the ✨ Ray
   title shows BEFORE the click. */
export const rayTilesOf = (factor, antialias = false) => {
  const f = clampFactorValue(factor) * (antialias ? 2 : 1);
  return f * f;
};

/* Is the antialias pass worth asking for at this factor? (see
   RAY_ANTIALIAS_MAX_FACTOR). This is the DEFAULT rule of captureRayImage, exported
   so the bar can show it; an explicit `antialias` from a caller always wins. */
export const rayAntialiasFor = (factor) => clampFactorValue(factor) <= RAY_ANTIALIAS_MAX_FACTOR;

/* EVERYTHING the ✨ Ray title needs for ONE factor on THIS canvas: the size the
   selector announces, whether that factor is granted as it stands (budget AND GPU
   limits), the factor that really reaches NGL, the size THAT one produces, whether
   the antialias pass is asked for, and the tiles NGL will render. Pure — the panel
   reads it on every render, so the cost of a factor is visible before the click
   (« the rendering never finishes » cannot be a surprise any more). */
export const rayPlanOf = (stage, factor) => {
  const size = rayPixelsOf(stage, factor);
  const best = clampRayFactor(stage, factor);
  const real = rayPixelsOf(stage, best);
  const antialias = rayAntialiasFor(best);
  return {
    ...size,
    best,
    allowed: !size.width || best === size.factor,
    realWidth: real.width,
    realHeight: real.height,
    realPixels: real.pixels,
    antialias,
    tiles: rayTilesOf(best, antialias),
  };
};

/* The list the resolution selector shows: every factor WITH the pixels it
   produces here, and whether this machine can afford it as it stands (`best`
   is the factor NGL will really be asked for — a GPU that cannot take the
   requested size gets the largest one it can, never a failed render). */
export const rayFactorOptions = (stage) => RAY_FACTORS.map((factor) => {
  const size = rayPixelsOf(stage, factor);
  const best = clampRayFactor(stage, factor);
  const known = size.width > 0 && size.height > 0;
  return {
    ...size,
    best,
    allowed: !known || best === size.factor,
    label: known ? `${size.factor}× · ${size.width}×${size.height} px` : `${size.factor}×`,
  };
});

/* The progress line, from NGL's own onProgress(done, total, isDone). NGL
   over-reports the last tile (onFinish() sends total + 1), hence the clamp. */
export const rayProgressText = (done, total) => {
  const t = Math.max(1, Math.round(Number(total) || 1));
  const d = Math.min(t, Math.max(0, Math.round(Number(done) || 0)));
  return `✨ Rendering the ray still… ${d}/${t} tiles`;
};

/* ---- THE RENDER ---------------------------------------------------------- */
/* `stage` is the NGL Stage of the viewer. Resolves to the PNG Blob plus the
   size that was really produced, whether the background is transparent and the
   shadow that was really cast (null when none was asked for or when it could
   not be built). Everything NGL needs is passed EXPLICITLY (trim, factor,
   antialias, transparent): the shipped defaults would silently give a 1×
   screenshot. `shadows: true` + `lightDir` add the cast shadows of
   utils/viewerRayShadows.js on top of the very same render. */
export const captureRayImage = async (stage, options = {}) => {
  if (!stage || typeof stage.makeImage !== 'function') throw new Error('this viewer has no NGL renderer to render with');
  const { width, height } = viewerPixelsOf(stage);
  if (!width || !height) throw new Error('the 3D canvas has no size yet — load a structure first');
  const factor = clampRayFactor(stage, options.factor);
  const transparent = !!options.transparent;
  // The antialias pass — 4·factor² tiles — is asked for by DEFAULT while the tiles
  // stay few (RAY_ANTIALIAS_MAX_FACTOR): a 6× still is already a 6× supersample of
  // the canvas, and paying four times the render for it is what made the button
  // look stuck. An explicit `antialias` from the caller always wins.
  const antialias = options.antialias === undefined ? rayAntialiasFor(factor) : !!options.antialias;
  const tiles = rayTilesOf(factor, antialias);
  const status = typeof options.onStatus === 'function' ? options.onStatus : null;
  /* ── THE CAST SHADOWS: WHAT THEY ARE, AND *WHEN* THE RIG IS READ ──────────
     NGL cannot cast them (no shadow-map pass in 2.4), so they are computed from
     the atoms with the SAME camera and the SAME key light and multiplied into the
     very pixels NGL writes (utils/viewerRayShadows.js). Best-effort: a shadow that
     cannot be built leaves the plain still, never an error — and a still above the
     shadow budget is left WITHOUT them, with a note in the message: the decode /
     walk / encode of a still that big is exactly what the user described as « the
     rendering never finishes ».

     ⚠ THE RIG IS READ *BEFORE* THE STILL, AND THAT ORDER IS THE FIX OF THE
     DETACHED BLOB. `makeImage` renders the still TILE BY TILE and drives the
     camera into each tile's own sub-frustum
     (`camera.setViewOffset(fullWidth, fullHeight, offsetX, offsetY, w, h)`), and
     when it is done it clears `camera.view` WITHOUT calling
     `updateProjectionMatrix()` (ngl 2.4, TiledRenderer#_finalize — verified in the
     installed dist). The camera it leaves behind is therefore still the LAST TILE's
     off-centre frustum, and a shadow read from it is the mask of a 1/n × 1/n
     sub-window of the image — magnified n× (n = factor, doubled by the antialias
     pass) and thrown into that tile's corner. That is the report's « flat smudge
     lying next to the molecule », in every light direction, whatever the proxies
     weigh. Read here, the rig sees the camera the still really has: `setViewOffset`
     narrows the FRUSTUM of one tile, it never moves the full-frame camera the still
     is a crop of. The MASK itself is still built after the still (it is the
     expensive half) — from these inputs. `cameraFromViewer` refuses a camera that is
     mid-tile, so the mistake can never come back silently. */
  const pixels = width * factor * height * factor;
  const shadowBudget = Number.isFinite(Number(options.shadowMaxPixels)) ? Number(options.shadowMaxPixels) : RAY_SHADOW_MAX_PIXELS;
  const wantsShadow = options.shadows !== false && !!options.lightDir;
  const shadowTooBig = wantsShadow && pixels > shadowBudget;
  let inputs = null;
  if (wantsShadow && !shadowTooBig) {
    try {
      inputs = rayShadowInputsOf(stage, {
        lightDir: options.lightDir,
        options: options.shadow || {},
      });
    } catch { inputs = null; }                     // no atoms / no camera: no shadow
  }
  let blob = await stage.makeImage({
    trim: false,
    factor,
    // NGL's antialias is the 4·factor² tiles average: what makes the still
    // smooth where the interactive canvas is one sample per pixel.
    antialias,
    transparent,
    onProgress: typeof options.onProgress === 'function' ? options.onProgress : undefined,
  });
  if (!blob) throw new Error('NGL returned no image');
  let shadow = null;
  if (inputs) {
    if (status) status('✨ Casting the shadows of the still…');
    try {
      shadow = {
        ...buildRayShadowMask({
          ...inputs,
          width: width * factor,
          height: height * factor,
          options: options.shadow || {},
        }),
        imageWidth: width * factor,
        imageHeight: height * factor,
      };
      blob = await addCastShadowsToBlob(blob, { shadow });
    } catch { shadow = null; }
  }
  return {
    blob,
    factor,
    antialias,
    tiles,
    width: width * factor,
    height: height * factor,
    pixels,
    transparent,
    shadow,
    // The note of the message: what the shadow cost, or WHY there is none.
    shadowNote: shadow ? rayShadowNote(shadow) : (shadowTooBig ? RAY_SHADOW_SKIP_NOTE : ''),
  };
};

/* ---- The name of the file ------------------------------------------------ */
const pad2 = (n) => String(n).padStart(2, '0');
export const rayStamp = (date = new Date()) => {
  const d = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}`;
};
/* `Ray_<structure>_<w>x<h>[_transparent]_<date>.<ext>` — the size and the DATE
   are in the name, so two rays of the same molecule never overwrite each other
   and a figure can be traced back to the resolution it was rendered at.
   Everything a file name cannot carry (spaces, accents, `/ \ : * ? " < > |`)
   becomes `_`. */
export const rayFileName = ({ label, width, height, transparent = false, date = new Date(), ext = 'png' } = {}) => {
  const raw = String(label == null ? '' : label)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_')
    .slice(0, 60) || 'structure';
  const size = `${Math.round(Number(width) || 0)}x${Math.round(Number(height) || 0)}`;
  return `Ray_${raw}_${size}${transparent ? '_transparent' : ''}_${rayStamp(date)}.${ext}`;
};

/* ---- The file itself ----------------------------------------------------- */
/* Writing the file is the ONLY side effect of the whole feature: a blob URL, a
   hidden anchor, one click, then the URL is released. Guarded so the module can
   be imported — and its pure functions executed — where there is no DOM. */
export const downloadBlob = (blob, fileName) => {
  if (!blob || typeof document === 'undefined' || !document.body) return false;
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  } finally {
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* ignore */ } }, 4000);
  }
};

/* Render + download in one call — what the ✨ Ray button runs. */
export const saveRayImage = async (stage, options = {}) => {
  const out = await captureRayImage(stage, options);
  const fileName = rayFileName({
    label: options.label,
    width: out.width,
    height: out.height,
    transparent: out.transparent,
    date: options.date,
  });
  const saved = downloadBlob(out.blob, fileName);
  return { ...out, fileName, saved };
};
