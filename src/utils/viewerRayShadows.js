/* =========================================================================
   src/utils/viewerRayShadows.js
   CAST SHADOWS for the « ✨ Ray » still — the shadow the report could not find.

   THE REPORT: « the ray button only takes a snapshot of the image but does not
   introduce casted shadows ». True, and it is a fact about NGL 2.4, not about
   the button: `Stage.makeImage` re-renders the SAME scene with the SAME
   materials, so a still can only show what the interactive canvas shows — and
   the interactive canvas shows shade, not shadow (see the note in
   NMRMoleculeViewer.jsx above `flagMeshShadows`: NGL's meshes carry
   castShadow / receiveShadow flags that NGL's own shaders never read, because
   NGL 2.4 ships no shadow-map pass at all; forcing `renderer.shadowMap` breaks
   the scene, which a previous attempt proved).

   WHY THE SHADOW IS COMPUTED HERE, ON THE PIXELS. The scene is drawn by NGL and
   cannot be drawn by a second engine (the ring plates, the per-atom tables, the
   editable palettes — see the module doc of viewerRayImage.js). What CAN be
   computed outside NGL is the one thing a shadow map needs: the GEOMETRY. So
   the shadow is built from the atoms themselves:

     1. the atoms of every visible component AS THEY ARE DRAWN — the union of the
        atoms of its visible representations, in WORLD space (the Structure's own
        atom data, moved by the component's matrix — the very transform NGL gives
        the GPU) — become a set of PROXY SPHERES (their vdW radius). A molecule
        that has been hidden draws nothing, so it casts nothing: without this the
        shadow of an invisible bilayer appeared in the still (the report « I see a
        projected membrane, while the membrane is hidden in the program »);
     2. those spheres are rasterised once through the CAMERA's own clip matrix
        (the projection matrix read from the live NGL camera, so the mask is
        pixel-aligned with the still) — that gives, per pixel, the world point of
        the visible surface;
     3. the same spheres are rasterised from the KEY LIGHT of the rig
        (utils/viewerLightRig.js — the Azimuth / Elevation the ◐ Shadows menu
        drives) into an orthographic depth map covering the scene;
     4. a pixel is IN SHADOW when its surface point is deeper, along the light,
        than the first atom the light met — the textbook shadow-map test, run on
        the CPU, with a small bias and a blurred mask for a soft penumbra;
     5. the mask multiplies the RGB of the still (alpha untouched), so the
        transparent-background option keeps its transparent background.

   WHAT IT IS, HONESTLY. The proxy is drawn from ATOM SPHERES: a cartoon casts
   the shadow of the atoms it is built from (a body-like shadow, not a
   ribbon-exact outline). It is the shadow of the MOLECULE, it follows the
   light, and it is deterministic — no GPU feature, no extension, no second
   engine. A stage with no atoms, a canvas that refuses its pixels or a browser
   without `createImageBitmap` leaves the still exactly as NGL drew it (every
   entry point is best-effort and returns what it was given).

   NOTHING HERE TOUCHES THE VIEWER: no representation, no material, no camera
   and no light of the interactive canvas is written. The module only READS.
   ========================================================================= */

/* ---- The tunables of a shadow -------------------------------------------- */
/* A still above this many pixels is left WITHOUT cast shadows: the pass decodes
   the PNG, walks every one of its pixels on the CPU and encodes it again, and the
   follow-up report is exactly that hang (« il rendering non finisce mai e non
   arrivo a vedere l'immagine »). The budget of a still (RAY_MAX_PIXELS, 16 Mpx in
   viewerRayImage.js) is BELOW it, so this only bites for a caller that asks for a
   bigger one. */
export const RAY_SHADOW_MAX_PIXELS = 20e6;
export const RAY_SHADOW_DEFAULTS = Object.freeze({
  /* How dark the shadow gets at its core: 0 = no shadow at all, 1 = black. The
     value the Ray panel offers is a percentage of this. */
  strength: 0.55,
  /* Penumbra, in pixels OF THE MASK (the mask is smaller than the image and is
     sampled bilinearly, so 1–2 px of mask is a few pixels on the still). */
  softness: 1.6,
  /* The mask is computed at most this wide, then upsampled to the image: the
     cost of the feature is quadratic in this number and the shadow is a
     low-frequency signal — the atoms' own shading carries the detail. */
  maskMaxWidth: 1400,
  /* Depth bias (Å, along the light) that keeps a surface from shadowing itself
     through the coarse polygonisation of the proxy. */
  bias: 0.9,
  /* Multiplier on the vdW radii of the proxy spheres: > 1 fattens the shadow of
     a coarse structure, < 1 thins it. */
  sphereScale: 1,
  /* Safety valve: a million-atom system is strided down to this many proxies. */
  maxAtoms: 300000,
});

/* The options a caller may pass, normalised: anything missing falls back on the
   defaults, a strength of 0 … 1 is clamped. */
export const rayShadowOptions = (options = {}) => {
  const d = RAY_SHADOW_DEFAULTS;
  const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  return {
    strength: Math.min(1, Math.max(0, num(options.strength, d.strength))),
    softness: Math.max(0, num(options.softness, d.softness)),
    maskMaxWidth: Math.max(64, Math.round(num(options.maskMaxWidth, d.maskMaxWidth))),
    bias: num(options.bias, d.bias),
    sphereScale: Math.max(0.1, num(options.sphereScale, d.sphereScale)),
    maxAtoms: Math.max(1, Math.round(num(options.maxAtoms, d.maxAtoms))),
  };
};

/* The mask size for an image of `width × height`: the image's OWN aspect (the
   shadow must land on the right pixel) and at most `maskMaxWidth` wide. */
export const rayShadowMaskSize = (width, height, options = {}) => {
  const o = rayShadowOptions(options);
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const scale = Math.min(1, o.maskMaxWidth / Math.max(1, w));
  return {
    width: Math.max(2, Math.round(w * scale)),
    height: Math.max(2, Math.round(h * scale)),
    scale,
  };
};

/* ---- Small vector / matrix maths (column-major, like three.js) ------------ */
export const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const length3 = (a) => Math.sqrt(dot3(a, a));
export const normalize3 = (a) => {
  const l = length3(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1];
};

/* `out = a · b`, column-major: the result applies `b` first, exactly like
   three's `multiplyMatrices`. Written out by hand so the module has NO
   dependency of its own. */
export const mat4Multiply = (a, b, out = new Array(16)) => {
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      out[c * 4 + r] = a[r] * b[c * 4]
        + a[4 + r] * b[c * 4 + 1]
        + a[8 + r] * b[c * 4 + 2]
        + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
};

/* `out = m · p`, with the w component kept so callers can divide by it. */
export const mat4TransformPoint = (m, p, out = new Array(4)) => {
  out[0] = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  out[1] = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  out[2] = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
  out[3] = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return out;
};

/* Clip → screen: `x` in [0, width), `y` from the TOP (the image coordinates of
   a 2D canvas read with `getImageData`, not the GL ones) and `z` the NDC depth
   (smaller = nearer). Returns null BEHIND the eye or outside the frustum, so
   the caller skips it instead of drawing a phantom. */
export const clipToScreen = (clip, width, height, out = new Array(3)) => {
  if (!(Math.abs(clip[3]) > 1e-9)) return null;
  const x = clip[0] / clip[3];
  const y = clip[1] / clip[3];
  const z = clip[2] / clip[3];
  if (!(z >= -1.001 && z <= 1.001)) return null;
  out[0] = (x * 0.5 + 0.5) * width;
  out[1] = (0.5 - y * 0.5) * height;
  out[2] = z;
  return out;
};



/* The world-space axes of a view matrix (its rows): what a sphere must be
   offset along to measure how many PIXELS wide it is on screen. */
export const viewAxesOf = (view) => ({
  right: [view[0], view[4], view[8]],
  up: [view[1], view[5], view[9]],
  back: [view[2], view[6], view[10]],
});

/* The proxy spheres → a depth map through ONE clip matrix.
   `depth` holds the NDC depth (smaller = nearer) of the nearest sphere per
   pixel and is filled with 2 = « nothing here »; `world` the world point of that
   hit (3 floats per pixel) and `hit` the flag array. Each sphere covers the
   square around its projected centre, so a few hundred thousand overlapping
   spheres write the silhouette a shadow map stores. */
export const rasterizeSpheres = ({
  positions, radii, count = 0, clip, width, height,
  radiusScale = 1, axisUp = [0, 1, 0], needWorld = true,
}, out = {}) => {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const n = Math.max(0, Math.min(count || Math.floor(positions.length / 3), Math.floor(positions.length / 3)));
  const depth = out.depth && out.depth.length === w * h ? out.depth : new Float32Array(w * h);
  depth.fill(2);
  const hit = out.hit && out.hit.length === w * h ? out.hit : new Uint8Array(w * h);
  hit.fill(0);
  const world = needWorld
    ? (out.world && out.world.length === w * h * 3 ? out.world : new Float32Array(w * h * 3))
    : null;
  const clipPt = new Array(4);
  const scr = new Array(3);
  const scrEdge = new Array(3);
  const maxRadius = Math.max(w, h) * 2;
  for (let i = 0; i < n; i += 1) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const r = Math.max(0.1, (radii ? radii[i] : 1.7) * radiusScale);
    const c = clipToScreen(mat4TransformPoint(clip, [x, y, z], clipPt), w, h, scr);
    if (!c) continue;
    // The pixel radius: the same sphere centre pushed `r` Å along the camera's
    // own up axis, projected — so a perspective AND an orthographic frustum are
    // both measured by the projection itself, never by a formula of ours.
    let rad = 1;
    const edge = clipToScreen(mat4TransformPoint(clip, [
      x + axisUp[0] * r, y + axisUp[1] * r, z + axisUp[2] * r,
    ], clipPt), w, h, scrEdge);
    if (edge) {
      const dx = scrEdge[0] - c[0];
      const dy = scrEdge[1] - c[1];
      rad = Math.sqrt(dx * dx + dy * dy);
    }
    rad = Math.max(1, Math.min(rad, maxRadius));
    const cx = c[0];
    const cy = c[1];
    const cz = c[2];
    const x0 = Math.max(0, Math.floor(cx - rad));
    const x1 = Math.min(w - 1, Math.ceil(cx + rad));
    const y0 = Math.max(0, Math.floor(cy - rad));
    const y1 = Math.min(h - 1, Math.ceil(cy + rad));
    const r2 = rad * rad;
    for (let py = y0; py <= y1; py += 1) {
      const dy = py + 0.5 - cy;
      const row = py * w;
      for (let px = x0; px <= x1; px += 1) {
        const dx = px + 0.5 - cx;
        if (dx * dx + dy * dy > r2) continue;
        const idx = row + px;
        if (cz >= depth[idx]) continue;
        depth[idx] = cz;
        hit[idx] = 1;
        if (world) {
          world[idx * 3] = x;
          world[idx * 3 + 1] = y;
          world[idx * 3 + 2] = z;
        }
      }
    }
  }
  return { depth, hit, world, width: w, height: h, count: n };
};

/* A separable triangular blur of the mask — the PENUMBRA. A shadow map gives a
   hard edge; a real still has a few pixels of softness, and the mask is smaller
   than the image, so one or two pixels here are several on the still. */
export const softenMask = (mask, width, height, radius) => {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const r = Number(radius) || 0;
  if (!(r > 0)) return mask;
  const far = Math.max(1, Math.round(r));
  const weights = [];
  let sum = 0;
  for (let i = -far; i <= far; i += 1) {
    const k = Math.max(0, 1 - Math.abs(i) / (r + 1));
    weights.push(k);
    sum += k;
  }
  const tmp = new Float32Array(mask.length);
  const out = new Float32Array(mask.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let acc = 0;
      for (let i = -far; i <= far; i += 1) {
        const sx = Math.min(w - 1, Math.max(0, x + i));
        acc += mask[y * w + sx] * weights[i + far];
      }
      tmp[y * w + x] = acc / sum;
    }
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let acc = 0;
      for (let i = -far; i <= far; i += 1) {
        const sy = Math.min(h - 1, Math.max(0, y + i));
        acc += tmp[sy * w + x] * weights[i + far];
      }
      out[y * w + x] = acc / sum;
    }
  }
  return out;
};

/* The shadow test itself: every camera pixel that HIT an atom takes its world
   point, the light projects it into its own depth map, and the pixel is in
   shadow when it is deeper than what the light met there. `biasNdc` is the bias
   expressed in the light's NDC depth (buildRayShadowMask works it out from the
   orthogonal frustum), which is what keeps a sphere from shadowing itself. */
export const shadowMaskOf = ({
  camera, light, width, height, biasNdc = 0, softness = 0,
}) => {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const mask = new Float32Array(w * h);
  const clipPt = new Array(4);
  const scr = new Array(3);
  let shadowed = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const idx = y * w + x;
      if (!camera.hit[idx]) continue;
      const p = clipToScreen(mat4TransformPoint(light.clip, [
        camera.world[idx * 3], camera.world[idx * 3 + 1], camera.world[idx * 3 + 2],
      ], clipPt), w, h, scr);
      if (!p) continue;
      const lx = Math.min(w - 1, Math.max(0, Math.floor(p[0])));
      const ly = Math.min(h - 1, Math.max(0, Math.floor(p[1])));
      const nearest = light.depth[ly * w + lx];
      if (!(nearest < 2)) continue;                 // the light saw nothing here
      if (p[2] > nearest + biasNdc) {
        mask[idx] = 1;
        shadowed += 1;
      }
    }
  }
  return { mask: softenMask(mask, w, h, softness), width: w, height: h, shadowed };
};

/* One sample of the mask, bilinearly — the mask is SMALLER than the image (see
   rayShadowMaskSize), so this is what makes the shadow follow the atoms at the
   still's own resolution instead of stepping in mask-sized blocks. */
export const sampleMaskBilinear = (mask, mw, mh, nx, ny) => {
  const width = Math.max(1, Math.round(mw));
  const height = Math.max(1, Math.round(mh));
  const mx = Math.min(width - 1, Math.max(0, nx * width - 0.5));
  const my = Math.min(height - 1, Math.max(0, ny * height - 0.5));
  const x0 = Math.floor(mx);
  const y0 = Math.floor(my);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = mx - x0;
  const fy = my - y0;
  const a = mask[y0 * width + x0];
  const b = mask[y0 * width + x1];
  const c = mask[y1 * width + x0];
  const d = mask[y1 * width + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
};

/* The mask MULTIPLIED into the pixels of the still: the RGB of a shadowed pixel
   is darkened towards `1 − strength`, its ALPHA is left alone (a transparent
   background stays transparent, and the shadow never leaks outside the
   molecule). Returns how many pixels the shadow really reached. */
export const applyShadowToPixels = (data, width, height, mask, maskWidth, maskHeight, strength) => {
  const s = Math.min(1, Math.max(0, Number(strength) || 0));
  if (!(s > 0) || !data || !mask) return 0;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  let touched = 0;
  for (let y = 0; y < h; y += 1) {
    const ny = (y + 0.5) / h;
    for (let x = 0; x < w; x += 1) {
      const m = sampleMaskBilinear(mask, maskWidth, maskHeight, (x + 0.5) / w, ny);
      if (!(m > 0.002)) continue;
      const f = 1 - s * m;
      const i = (y * w + x) * 4;
      const r = Math.round(data[i] * f);
      const g = Math.round(data[i + 1] * f);
      const b = Math.round(data[i + 2] * f);
      if (r === data[i] && g === data[i + 1] && b === data[i + 2]) continue;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      touched += 1;
    }
  }
  return touched;
};

/* The NDC depth the light's ORTHOGRAPHIC frustum spans per ångström: the bias
   the user's « Å » is worth in the numbers the depth maps are written with. */
export const lightDepthScale = ({ distance, radius }) => {
  const near = 0.01;
  const far = Math.max(0.02, Number(distance) * 2 + Number(radius) * 2);
  return 2 / (far - near);
};

/* THE WHOLE SHADOW, from the proxies to the mask: one camera pass (where the
   visible surface is) and one light pass (what the lamp sees first), compared
   pixel by pixel. Returns the blurred mask plus the numbers the Ray message
   reports, and never throws — a shadow that cannot be built is no shadow. */
export const buildRayShadowMask = ({ atoms, camera, light, width, height, options = {} }) => {
  const o = rayShadowOptions(options);
  const { width: mw, height: mh } = rayShadowMaskSize(width, height, o);
  const cameraAxes = viewAxesOf(camera.view || mat4Identity());
  const lightAxes = viewAxesOf(light.view || mat4Identity());
  const cameraPass = rasterizeSpheres({
    positions: atoms.positions, radii: atoms.radii, count: atoms.count,
    clip: camera.clip, width: mw, height: mh,
    radiusScale: o.sphereScale, axisUp: cameraAxes.up, needWorld: true,
  });
  const lightPass = rasterizeSpheres({
    positions: atoms.positions, radii: atoms.radii, count: atoms.count,
    clip: light.clip, width: mw, height: mh,
    radiusScale: o.sphereScale, axisUp: lightAxes.up, needWorld: false,
  });
  const out = shadowMaskOf({
    camera: cameraPass,
    light: { clip: light.clip, depth: lightPass.depth },
    width: mw, height: mh,
    biasNdc: o.bias * lightDepthScale(light),
    softness: o.softness,
  });
  return {
    mask: out.mask,
    maskWidth: mw,
    maskHeight: mh,
    shadowed: out.shadowed,
    spheres: cameraPass.count,
    strength: o.strength,
  };
};



/* The LIGHT's matrices: the lamp is parked at `distance` from the centre of the
   scene, looking back at it, with an ORTHOGRAPHIC frustum whose half-width is
   the bounding radius — a parallel « sun », like the rig's own
   hundred-bounding-box lamp distance (utils/viewerLightRig.js). `clip` is the
   one matrix the mask pass multiplies by (= proj · view); `view` is kept so the
   rasteriser can measure a sphere along the light's OWN up axis. */
export const lightMatricesOf = ({ dir, center, radius, distance }) => {
  const z = normalize3(dir);                      // FROM the scene TO the lamp
  const d = Math.max(1e-3, Number(distance) || 1);
  const eye = [
    center[0] + z[0] * d,
    center[1] + z[1] * d,
    center[2] + z[2] * d,
  ];
  // An up vector that is never parallel to the light.
  const up = Math.abs(z[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const view = mat4LookAt(eye, center, up);
  const r = Math.max(1e-3, Number(radius) || 1);
  const proj = mat4Orthographic(-r, r, -r, r, 0.01, d * 2 + r * 2);
  return { view, proj, clip: mat4Multiply(proj, view) };
};

export const mat4Identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/* The one matrix the mask pass needs, for a caller that only wants that. */
export const lightClipMatrix = (setup) => lightMatricesOf(setup).clip;

/* ---- The scene, read from the LIVE NGL stage (read-only) ------------------ */
/* A Matrix4 of three.js is `{ elements: number[16] }`; anything else (a missing
   transform, an unknown matrix-like) is the identity. */
const elements16Of = (matrix) => {
  const e = matrix && matrix.elements ? matrix.elements : matrix;
  if (!e || typeof e.length !== 'number' || e.length !== 16) return null;
  return Array.from(e);
};

/* WHICH ATOMS A COMPONENT REALLY DRAWS — the fix of the phantom shadow.
   The report: « in the ray images there IS a projected image, but I see it as a
   projected membrane, while the membrane is NOT visible in the program (it has
   been hidden) ». The atoms of a hidden molecule are still in its Structure, and
   a whole molecule is hidden in this viewer by NOT building its representations
   (a section unticked / a look set to « hide ») — the component itself stays
   `visible`, so reading the structure's atoms made the hidden bilayer cast a
   full, very visible shadow of something nobody can see on screen.
   The only honest source of a shadow is therefore what is DRAWN: the union of
   the atoms of the component's VISIBLE representations, each taken from its own
   `StructureView` (so a representation restricted to a selection casts only
   those atoms, and one that was removed or switched off casts nothing).
   Returns `null` when the component says nothing about its representations (an
   older NGL, a test stub): the caller then keeps the whole structure, exactly
   as before. An EMPTY result means « this component draws no atom at all » —
   not « unknown » — and such a component casts nothing. */
const drawnAtomIndicesOf = (comp, atomCount) => {
  const list = comp && comp.reprList;
  if (!Array.isArray(list)) return null;
  const set = new Set();
  list.forEach((el) => {
    try {
      const rep = (el && (el.repr || el)) || null;
      if (!rep || rep.visible === false) return;
      const sv = rep.structureView;
      if (!sv || typeof sv.getAtomIndices !== 'function') return;
      const idx = sv.getAtomIndices();
      if (!idx || !idx.length) return;
      for (let i = 0; i < idx.length; i += 1) set.add(idx[i]);
    } catch { /* a representation that cannot list its atoms draws no shadow */ }
  });
  if (set.size && atomCount && set.size >= atomCount) return null; // everything: no filtering to do
  return [...set].sort((a, b) => a - b);
};

/* World space: NGL stores the atoms in the structure's OWN frame and gives the
   GPU the component's matrix (`component.matrix`, kept up to date by
   `updateMatrix()` — the « Move X · Y · Z » of the styling bar writes it). The
   shadow must live in the same world the camera does, so the same matrix is
   applied here. Invisible components are skipped, and of a visible one only the
   atoms its VISIBLE representations draw (see drawnAtomIndicesOf): what is not
   on screen must not cast anything. */
export const atomsFromStage = (stage, maxAtoms = RAY_SHADOW_DEFAULTS.maxAtoms) => {
  const comps = (stage && stage.compList) || [];
  const parts = [];
  let total = 0;
  comps.forEach((comp) => {
    try {
      if (!comp || comp.visible === false) return;
      const structure = comp.structure;
      if (!structure || typeof structure.getAtomData !== 'function') return;
      const data = structure.getAtomData({ what: { position: true, radius: true } });
      if (!data || !data.position || !data.position.length) return;
      const n = Math.floor(data.position.length / 3);
      if (!n) return;
      const drawn = drawnAtomIndicesOf(comp, structure.atomCount || n);
      if (drawn && !drawn.length) return;      // nothing is drawn here: no shadow
      parts.push({ comp, data, n, drawn });
      total += drawn ? drawn.length : n;
    } catch { /* a component that cannot report its atoms casts nothing */ }
  });
  const stride = total > maxAtoms ? Math.ceil(total / maxAtoms) : 1;
  const capacity = Math.ceil(total / stride);
  const out = new Float32Array(capacity * 3);
  const radii = new Float32Array(capacity);
  let k = 0;
  parts.forEach(({ comp, data, n, drawn }) => {
    const m = elements16Of(comp.matrix) || elements16Of(comp.group && comp.group.matrixWorld);
    const pos = data.position;
    const rad = data.radius;
    const count = drawn ? drawn.length : n;
    for (let c = 0; c < count; c += stride) {
      const i = drawn ? drawn[c] : c;
      if (!(i >= 0 && i < n)) continue;
      if (k * 3 + 2 >= out.length) break;
      const x = pos[i * 3];
      const y = pos[i * 3 + 1];
      const z = pos[i * 3 + 2];
      if (m) {
        out[k * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
        out[k * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        out[k * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      } else {
        out[k * 3] = x;
        out[k * 3 + 1] = y;
        out[k * 3 + 2] = z;
      }
      radii[k] = rad && Number.isFinite(rad[i]) ? rad[i] : 1.7;
      k += 1;
    }
  });
  return { positions: out, radii, count: k, stride, total };
};

/* The CAMERA of the live viewer, as the two matrices the mask needs: the
   projection NGL itself uses (so the mask lands on the very pixels the still
   has — the Ray keeps `trim: false`, which is what makes the aspect identical)
   and the view, kept for the sphere measurement. */
export const cameraFromViewer = (viewer) => {
  const cam = (viewer && (viewer.camera || viewer.perspectiveCamera || viewer.orthographicCamera)) || null;
  const proj = cam ? elements16Of(cam.projectionMatrix) : null;
  const view = cam ? elements16Of(cam.matrixWorldInverse) : null;
  if (!proj || !view) throw new Error('the viewer has no camera to cast a shadow from');
  return { projection: proj, view, clip: mat4Multiply(proj, view), type: (cam && cam.type) || 'Camera' };
};

/* EVERYTHING a shadow needs, read from the stage in one call. `lightDir` is the
   unit vector FROM the molecule TOWARD the lamp — exactly what
   `nglKeyLightDirection(az, el)` of the rig returns (utils/viewerLightRig.js),
   so the shadow of the still and the shading of the canvas come from ONE lamp. */
export const rayShadowInputsOf = (stage, { lightDir = [0, 0, 1], options = {} } = {}) => {
  const o = rayShadowOptions(options);
  const viewer = stage && stage.viewer;
  const atoms = atomsFromStage(stage, o.maxAtoms);
  if (!atoms.count) throw new Error('no atoms to cast a shadow from');
  const camera = cameraFromViewer(viewer);
  const { center, radius } = boundsOf(atoms.positions, atoms.count);
  const dir = normalize3(lightDir);
  // The rig parks the lamp a hundred bounding boxes away: parallel « sun » rays.
  const distance = radius * 100;
  const light = { dir, center, radius, distance, ...lightMatricesOf({ dir, center, radius, distance }) };
  return { atoms, camera, light, options: o };
};

/* ---- The DOM half: decode the still, darken it, encode it back ------------ */
/* Both halves are injectable so the feature can be exercised (and tested)
   without a browser; the defaults are the browser's own. Everything is
   best-effort: an image that cannot be read, a canvas that refuses to exist or a
   blob that cannot be encoded returns the ORIGINAL blob — a plain still is a
   normal outcome, never an error. */
const defaultDecode = async (blob) => {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  if (typeof document === 'undefined') throw new Error('no decoder for the still');
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = document.createElement('img');
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('the still could not be decoded'));
      el.src = url;
    });
    return img;
  } finally {
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* ignore */ } }, 4000);
  }
};

const canvasOf = (width, height) => {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (typeof document === 'undefined') throw new Error('no canvas to write the still on');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const toPngBlob = (canvas) => new Promise((resolve, reject) => {
  if (typeof canvas.convertToBlob === 'function') {
    canvas.convertToBlob({ type: 'image/png' }).then(resolve, reject);
    return;
  }
  canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the still could not be encoded'))), 'image/png');
});

/* The mask applied to the pixels of ONE still: the whole DOM-free half, so a
   test can hand it a plain `{ data, width, height }`. Returns the number of
   pixels the shadow reached (0 = the still is left alone). */
export const shadowImageData = (imageData, shadow) => {
  if (!imageData || !shadow || !shadow.mask) return 0;
  return applyShadowToPixels(
    imageData.data, imageData.width, imageData.height,
    shadow.mask, shadow.maskWidth, shadow.maskHeight, shadow.strength,
  );
};

/* Render the shadow ONTO a still: `blob` comes from NGL (`Stage.makeImage`), the
   inputs come from `rayShadowInputsOf` (or from the caller, which is what the
   tests do). Returns the new PNG blob, or the input blob when there is nothing
   to do. The shadow object is marked (`applied`) and told how many pixels it
   really reached, so the Ray message can report it. */
export const addCastShadowsToBlob = async (blob, {
  shadow, decode = null, encode = null,
} = {}) => {
  if (!blob || !shadow || !shadow.mask || shadow.applied) return blob;
  try {
    const decodeImage = decode || defaultDecode;
    const canvasWriter = encode || null;
    const src = await decodeImage(blob);
    const width = shadow.imageWidth || (src && (src.width || 0));
    const height = shadow.imageHeight || (src && (src.height || 0));
    if (!width || !height) return blob;
    const canvas = canvasOf(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.drawImage(src, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    const hit = shadowImageData(imageData, shadow);
    shadow.reachedPixels = hit;
    if (!hit) return blob;
    ctx.putImageData(imageData, 0, 0);
    const out = canvasWriter ? await canvasWriter(canvas) : await toPngBlob(canvas);
    if (src && typeof src.close === 'function') src.close();
    shadow.applied = true;
    return out || blob;
  } catch {
    return blob;                                    // a plain still, never an error
  }
};

/* One line for the Ray message: what the shadow cost and how much of the
   molecule it really reached. */
export const rayShadowNote = (shadow) => {
  if (!shadow || !shadow.mask) return '';
  const pct = Math.round((Number(shadow.strength) || 0) * 100);
  const covered = shadow.reachedPixels && shadow.imageWidth && shadow.imageHeight
    ? Math.round((shadow.reachedPixels / (shadow.imageWidth * shadow.imageHeight)) * 100)
    : null;
  const spheres = Number(shadow.spheres) || 0;
  return `· cast shadows ${pct}%${covered == null ? '' : ` (${covered}% of the pixels)`}`
    + `${spheres ? ` · ${spheres} atom proxies` : ''}`;
};



/* A right-handed look-at, column-major (three's `Matrix4.lookAt` layout). */
export const mat4LookAt = (eye, target, up) => {
  const zAxis = normalize3(sub3(eye, target));       // eye → target is −z
  const xAxis = normalize3(cross3(up, zAxis));
  const yAxis = cross3(zAxis, xAxis);
  return [
    xAxis[0], yAxis[0], zAxis[0], 0,
    xAxis[1], yAxis[1], zAxis[1], 0,
    xAxis[2], yAxis[2], zAxis[2], 0,
    -dot3(xAxis, eye), -dot3(yAxis, eye), -dot3(zAxis, eye), 1,
  ];
};

export const mat4Orthographic = (left, right, bottom, top, near, far) => [
  2 / (right - left), 0, 0, 0,
  0, 2 / (top - bottom), 0, 0,
  0, 0, -2 / (far - near), 0,
  -(right + left) / (right - left),
  -(top + bottom) / (top - bottom),
  -(far + near) / (far - near),
  1,
];

/* The bounding sphere of a flat xyz array — the scene the shadow must cover. */
export const boundsOf = (positions, count) => {
  const n = Math.max(0, Math.min(count || positions.length / 3, positions.length / 3));
  if (!n) return { center: [0, 0, 0], radius: 1 };
  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const center = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const radius = Math.max(
    1e-3,
    0.5 * Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2 + (maxZ - minZ) ** 2),
  );
  return { center, radius };
};
