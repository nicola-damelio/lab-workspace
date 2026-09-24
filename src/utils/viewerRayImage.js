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

   THE 📷 FIGURE BUTTON IS NOT TOUCHED, and this module does not publish to the
   Figure library: ✨ Ray only WRITES A FILE on the computer (the request).
   Nothing here is stateful: every function takes the stage it reads from.

   THE CAST SHADOWS. The report: « the ray button only takes a snapshot of the
   image but does not introduce casted shadows ». NGL 2.4 has no shadow-map pass
   at all (see the long note in NMRMoleculeViewer.jsx above `flagMeshShadows`),
   so the shadow of the still is computed from the ATOMS, on the CPU, in
   utils/viewerRayShadows.js: the same camera NGL just rendered with, the same
   key light of the rig, the same pixels. `shadows: false` (or no `lightDir`)
   gives the plain supersampled still; a shadow that cannot be built for any
   reason falls back on that same plain still, never on an error.
   ========================================================================= */

import { addCastShadowsToBlob, buildRayShadowMask, rayShadowInputsOf, rayShadowNote } from './viewerRayShadows.js';

/* The supersampling factors the bar offers — the honest NGL knob, expressed
   against the canvas the user is looking at (`factor × canvas pixels`). 3× is
   the default: a 1600×900 canvas becomes 4800×2700 px, which is a publication
   still, and the 9 tiles it costs render in a couple of seconds. */
export const RAY_FACTORS = Object.freeze([2, 3, 4, 6]);
export const RAY_DEFAULT_FACTOR = 3;
// The output budget. A 40 MP RGBA canvas is already ~160 MB, and NGL renders
// factor² tiles ON TOP of it, so the factor actually offered to the user is
// clamped to this budget and to the WebGL limits below.
export const RAY_MAX_PIXELS = 40e6;
export const RAY_MAX_FACTOR = 8;
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

/* The device-pixel size of the LIVE canvas — what `factor` multiplies. Read
   from the canvas itself (NGL's Viewer.width/height are the same numbers) and
   never from CSS, so a HiDPI screen is accounted for exactly once. */
export const viewerPixelsOf = (stage) => {
  const viewer = stage && stage.viewer;
  const canvas = canvasOfViewer(viewer);
  const w = canvas ? Number(canvas.width) : 0;
  const h = canvas ? Number(canvas.height) : 0;
  if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) return { width: w, height: h };
  const fw = Number(viewer && viewer.width);
  const fh = Number(viewer && viewer.height);
  if (Number.isFinite(fw) && fw > 0 && Number.isFinite(fh) && fh > 0) return { width: fw, height: fh };
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
  let blob = await stage.makeImage({
    trim: false,
    factor,
    // NGL's antialias is the 4·factor² tiles average: what makes the still
    // smooth where the interactive canvas is one sample per pixel.
    antialias: options.antialias !== false,
    transparent,
    onProgress: typeof options.onProgress === 'function' ? options.onProgress : undefined,
  });
  if (!blob) throw new Error('NGL returned no image');
  // ── THE CAST SHADOWS ────────────────────────────────────────────────────
  // NGL cannot cast them (no shadow-map pass in 2.4), so they are computed from
  // the atoms with the SAME camera and the SAME key light, and multiplied into
  // the very pixels NGL just wrote (utils/viewerRayShadows.js). Best-effort: a
  // shadow that cannot be built leaves the plain still, never an error.
  let shadow = null;
  if (options.shadows !== false && options.lightDir) {
    try {
      const inputs = rayShadowInputsOf(stage, {
        lightDir: options.lightDir,
        options: options.shadow || {},
      });
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
    width: width * factor,
    height: height * factor,
    pixels: width * factor * height * factor,
    transparent,
    shadow,
    shadowNote: shadow ? rayShadowNote(shadow) : '',
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
