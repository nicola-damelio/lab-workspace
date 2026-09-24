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
        the GPU) — become a set of PROXY SPHERES, each one as THICK AS THE STROKE
        ITS OWN REPRESENTATION DRAWS (the vdW radius for sphere / spacefill /
        surface, the bond radius for ball+stick / licorice, a thin tube for
        cartoon / ribbon / tube — PROXY_STROKE_BY_TYPE below). A molecule
        that has been hidden draws nothing, so it casts nothing: without this the
        shadow of an invisible bilayer appeared in the still (the report « I see a
        projected membrane, while the membrane is hidden in the program »);
     2. those spheres are rasterised once through the CAMERA's own clip matrix
        (the projection matrix read from the live NGL camera, so the mask is
        pixel-aligned with the still) — that gives, per pixel, the world point of
        the visible surface;
     3. the same spheres are rasterised from the KEY LIGHT of the rig
        (utils/viewerLightRig.js — the Azimuth / Elevation the ◐ Shadows menu
        drives) into an orthographic depth map whose frustum is FITTED TO THE
        MOLECULE'S OWN BOX — the PyMOL shadow camera: the eight corners of the
        molecule's bounding box are transformed into the lamp's own space and
        left / right / top / bottom / near / far are read off them (with a hair
        of slack, `fitMargin`), so the depth map spends its whole [−1, 1] range
        on the molecule instead of on empty space (shadowRigOf below);
     4. a pixel is IN SHADOW when its surface point is deeper, along the light,
        than the first atom the light met — the textbook shadow-map test, run on
        the CPU, with a CONTACT-sized bias, a PCF disc of taps whose radius grows
        with the occluder-to-receiver gap (PCSS: the soft, PyMOL-like penumbra,
        deep in a crevice as well as at the silhouette) and a final blur;
     5. the mask multiplies the RGB of the still (alpha untouched), so the
        transparent-background option keeps its transparent background.

   WHAT IT IS, HONESTLY. The proxy is drawn from ATOM SPHERES: a cartoon casts
   the shadow of the atoms it is built from (a body-like shadow, not a
   ribbon-exact outline). It is the shadow of the MOLECULE, it follows the
   light, and it is deterministic — no GPU feature, no extension, no second
   engine. A stage with no atoms, a canvas that refuses its pixels or a browser
   without `createImageBitmap` leaves the still exactly as NGL drew it (every
   entry point is best-effort and returns what it was given).

   WHY IT LOOKED « DETACHED AND FLAT » — and what a rig does about it. Three
   things made the shadow a smudge lying NEXT TO the molecule instead of ON it,
   and all three are gone:

     · THE PROXY WAS FATTER THAN THE DRAWING. Every atom donated a 1.7 Å vdW
       sphere whatever the representation drew, so a thin ribbon carried a
       shadow volume three times its own thickness: the ribbon went dark where
       the REAL ribbon stood in the light. The proxy radius now follows the
       REPRESENTATION'S OWN STROKE (PROXY_STROKE_BY_TYPE below — the vdW sphere
       for sphere / spacefill / surface, the bond radius for ball+stick /
       licorice, a thin tube for cartoon / ribbon / tube / trace / backbone, a
       hair for line). The receiver and the caster are the SAME stroke, so what
       is drawn is what receives and what casts;
     · THE LAMP'S FRUSTUM WAS A CUBE AROUND THE BOUNDING SPHERE with its near
       plane at 0.01 Å — thousands of ångströms of empty depth for every real
       surface, and a body-sized square where a molecule is not a cube. The
       fitted shadow camera (shadowRigOf) spends that range on the molecule;
     · THE BIAS WAS 0.9 Å, i.e. three bond lengths of cancelled self-shadowing,
       so a crevice — two atoms 0.5 Å apart along the light — could never go
       dark. It is a contact bias now (0.35 Å), and the PCF disc turns what is
       left into a penumbra instead of a stipple.

   SELF-SHADOWING ON THE MOLECULE ITSELF. The mask is built from the surface
   point of the pixel, so it darkens the MOLECULE — the receive side of a
   shadow-map test — exactly where the molecule blocks its own light: atoms in a
   pocket, the far side of the silhouette against the lamp, the ring that a
   neighbour shades. The background has no surface point (the camera pass never
   hit it), so nothing is ever painted off the molecule (see shadowMaskOf).

   WHAT A SHADOW CANNOT DO IN NGL 2.4 — and it is not this module's fault. The
   interactive canvas keeps NGL's own shading: NGL 2.4 ships no shadow-map pass
   and no post-processing, so there is no place to inject a projected shadow or
   an SSAO term into its materials (forcing `renderer.shadowMap` on its custom
   shaders breaks the scene — the note above `flagMeshShadows` in
   NMRMoleculeViewer.jsx records the attempt). The canvas therefore keeps the
   rig's own light and the mesh's castShadow / receiveShadow flags, and the
   still gets the shadow-map rig built here. The Mol* side of the same rig
   (utils/viewerLightRig.js: `postprocessing.occlusion` — the SSAO pass — and
   `postprocessing.shadow`) is how the swappable engine draws both.

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
     through the coarse polygonisation of the proxy. It is a CONTACT bias: two
     atoms half an ångström apart along the lamp must still shade each other
     (the crevice of a pocket), so it is well under a bond length — the coarse
     polygonisation is handled by the penumbra, not by cancelling the contact. */
  bias: 0.35,
  /* Multiplier on the proxy radii: > 1 fattens the shadow of a coarse
     structure, < 1 thins it. (The radii themselves follow the representation's
     own stroke — see PROXY_STROKE_BY_TYPE.) */
  sphereScale: 1,
  /* Safety valve: a million-atom system is strided down to this many proxies. */
  maxAtoms: 300000,
  /* ---- The shadow CAMERA (the fitted rig) ---------------------------------
     The lamp's orthographic frustum is fitted to the molecule's bounding box:
     the eight corners of the box are transformed into the lamp's space and the
     six planes are taken from them. `fitMargin` is the slack left around that
     fit, in the box's own units: 1 = the box touches all four sides exactly,
     1.06 = six percent of body-sized air, which is what keeps a sphere of a
     slightly thicker atom from being cut by the map's border. */
  fitMargin: 1.06,
  /* ---- The PENUMBRA (soft shadows: PCF, widened by PCSS) ------------------
     A shadow map gives one depth per texel; a real penumbra is the lamp's own
     width seen through a gap. `pcfTaps` is the number of samples of the disc
     taken around the receiver (1 = the hard single tap of a plain shadow map),
     `softness` its base radius in pixels OF THE MASK, and `penumbra` grows that
     radius by this many pixels per ångström of occluder-to-receiver gap — a
     contact shadow stays tight, a shadow cast from far away spreads —
     `penumbraMax` being the cap that keeps a distant occluder from washing the
     whole model grey. */
  pcfTaps: 8,
  penumbra: 1.5,
  penumbraMax: 8,
});

/* The options a caller may pass, normalised: anything missing falls back on the
   defaults, a strength of 0 … 1 is clamped. */
export const rayShadowOptions = (options = {}) => {
  const d = RAY_SHADOW_DEFAULTS;
  const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  const span = (v, fallback, lo, hi) => Math.min(hi, Math.max(lo, num(v, fallback)));
  return {
    strength: span(options.strength, d.strength, 0, 1),
    softness: Math.max(0, num(options.softness, d.softness)),
    maskMaxWidth: Math.max(64, Math.round(num(options.maskMaxWidth, d.maskMaxWidth))),
    bias: num(options.bias, d.bias),
    sphereScale: Math.max(0.1, num(options.sphereScale, d.sphereScale)),
    maxAtoms: Math.max(1, Math.round(num(options.maxAtoms, d.maxAtoms))),
    fitMargin: span(options.fitMargin, d.fitMargin, 1, 2),
    pcfTaps: span(Math.round(num(options.pcfTaps, d.pcfTaps)), d.pcfTaps, 1, 32),
    penumbra: Math.max(0, num(options.penumbra, d.penumbra)),
    penumbraMax: Math.max(0, num(options.penumbraMax, d.penumbraMax)),
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

/* The PCF disc: `taps` offsets spread over a unit disc, to be scaled by the
   penumbra radius. A Fibonacci spiral is used because it fills a disc evenly for
   ANY number of taps (1 … 32) without a table, and because the sequence of radii
   is what makes 8 taps look like 8 samples of an area light instead of 8 points
   of a ring. One tap is the centre — the plain, hard shadow-map test. */
export const pcfDiscOf = (taps) => {
  const n = Math.max(1, Math.round(Number(taps) || 1));
  const out = new Float32Array(n * 2);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i += 1) {
    const r = n === 1 ? 0 : Math.sqrt((i + 0.5) / n);
    const a = i * golden;
    out[i * 2] = Math.cos(a) * r;
    out[i * 2 + 1] = Math.sin(a) * r;
  }
  return out;
};

/* A per-pixel angle, from the pixel's own coordinates: the disc is ROTATED so its
   taps never line up with the mask's grid (unrotated taps show as rings and
   staircases). A hash of the position, nothing more. */
export const pcfRotationOf = (x, y) => {
  const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return (h - Math.floor(h)) * Math.PI * 2;
};

/* The shadow test itself: every camera pixel that HIT an atom takes its world
   point, the light projects it into its own depth map, and the pixel is in
   shadow when it is deeper than what the light met there. `biasNdc` is the bias
   expressed in the light's NDC depth (buildRayShadowMask works it out from the
   orthogonal frustum), which is what keeps a sphere from shadowing itself while
   still letting a crevice go dark.

   THE PENUMBRA — soft shadows, in two steps that a shadow-map pass does in one:
   the pixel takes `taps` samples of the disc around itself (PCF) and the disc's
   RADIUS grows with the gap between the receiver and the occluder the lamp met
   (PCSS): a contact shadow stays sharp, a shadow thrown from far away spreads by
   `penumbra` pixels per ångström, up to `penumbraMax`. `softness` is the disc's
   base radius, so `softness: 0` gives the plain hard test back — one tap, mask
   0 or 1 (the tests pin that, and it is what a caller asking for a crisp shadow
   gets). The disc softens BOTH sides of a shadow's edge — a receiver standing
   just outside a silhouette is partly occluded by it — and the blur of
   `softness` (softenMask) finishes the gradient. */
export const shadowMaskOf = ({
  camera, light, width, height, biasNdc = 0, softness = 0,
  taps = 1, penumbra = 0, penumbraMax = 0, depthScale = 0,
}) => {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const mask = new Float32Array(w * h);
  const disc = taps > 1 ? pcfDiscOf(taps) : null;
  const invTaps = disc ? 1 / (disc.length / 2) : 1;
  const base = Math.max(0, Number(softness) || 0);
  const grow = Math.max(0, Number(penumbra) || 0);
  const cap = Math.max(0, Number(penumbraMax) || 0);
  const perAngstrom = Number(depthScale) > 0 ? 1 / Number(depthScale) : 0;
  const clipX = (x) => Math.min(w - 1, Math.max(0, x));
  const clipY = (y) => Math.min(h - 1, Math.max(0, y));
  const clipPt = new Array(4);
  const scr = new Array(3);
  let shadowed = 0;
  let penumbraRadius = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const idx = y * w + x;
      if (!camera.hit[idx]) continue;
      const p = clipToScreen(mat4TransformPoint(light.clip, [
        camera.world[idx * 3], camera.world[idx * 3 + 1], camera.world[idx * 3 + 2],
      ], clipPt), w, h, scr);
      if (!p) continue;
      const lx = clipX(Math.floor(p[0]));
      const ly = clipY(Math.floor(p[1]));
      const nearest = light.depth[ly * w + lx];
      const met = nearest < 2;                       // the lamp met something here
      const gap = met ? p[2] - nearest : 0;          // NDC: > 0 → behind what it met
      // The disc's radius: the softness asked for, plus what the GAP deserves. A
      // centre the lamp did not meet (the receiver stands at the edge of a
      // silhouette) keeps the base radius — its shadow lives in the taps.
      const radius = base > 0 && disc
        ? Math.min(cap, base + (gap > 0 ? grow * gap * perAngstrom : 0))
        : 0;
      if (!(radius > 0)) {                           // the plain, hard shadow map
        if (met && p[2] > nearest + biasNdc) {
          mask[idx] = 1;
          shadowed += 1;
        }
        continue;
      }
      if (radius > penumbraRadius) penumbraRadius = radius;
      const rot = pcfRotationOf(x, y);
      const cs = Math.cos(rot);
      const sn = Math.sin(rot);
      let occluded = 0;
      for (let t = 0; t < disc.length; t += 2) {
        const ox = disc[t] * radius;
        const oy = disc[t + 1] * radius;
        const sx = clipX(Math.round(lx + ox * cs - oy * sn));
        const sy = clipY(Math.round(ly + ox * sn + oy * cs));
        const d = light.depth[sy * w + sx];
        if (d < 2 && p[2] > d + biasNdc) occluded += invTaps;
      }
      if (occluded > 0) {
        mask[idx] = occluded;
        if (occluded >= 0.5) shadowed += 1;
      }
    }
  }
  return {
    mask: softenMask(mask, w, h, base),
    width: w,
    height: h,
    shadowed,
    taps: disc ? disc.length / 2 : 1,
    penumbraRadius,
  };
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
   the user's « Å » is worth in the numbers the depth maps are written with.
   Given the frustum's own near / far planes (what shadowRigOf returns) it is
   exact; given only the lamp's distance and the scene's radius it falls back on
   the cube that used to cover the whole bounding sphere. */
export const lightDepthScale = ({ distance, radius, near, far } = {}) => {
  const n = Number.isFinite(Number(near)) ? Number(near) : 0.01;
  const f = Number.isFinite(Number(far))
    ? Number(far)
    : Math.max(0.02, Number(distance) * 2 + Number(radius) * 2);
  return 2 / Math.max(1e-6, f - n);
};

/* The axis-aligned box of a flat xyz array — the molecule the lamp must cover. */
export const boundsBoxOf = (positions, count) => {
  const n = Math.max(0, Math.min(count || positions.length / 3, positions.length / 3));
  if (!n) return { min: [-1, -1, -1], max: [1, 1, 1] };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      const v = positions[i * 3 + c];
      if (!Number.isFinite(v)) continue;
      if (v < min[c]) min[c] = v;
      if (v > max[c]) max[c] = v;
    }
  }
  for (let c = 0; c < 3; c += 1) {
    if (!Number.isFinite(min[c]) || !Number.isFinite(max[c])) { min[c] = -1; max[c] = 1; }
  }
  return { min, max };
};

/* The eight corners of a box, in world space — what the shadow camera is fitted
   to. */
export const boxCornersOf = ({ min, max } = {}, out = []) => {
  const lo = min || [-1, -1, -1];
  const hi = max || [1, 1, 1];
  for (let i = 0; i < 8; i += 1) {
    if (!out[i]) out[i] = [0, 0, 0];
    out[i][0] = i & 1 ? hi[0] : lo[0];
    out[i][1] = i & 2 ? hi[1] : lo[1];
    out[i][2] = i & 4 ? hi[2] : lo[2];
  }
  return out;
};

/* THE SHADOW CAMERA — the PyMOL rig's own piece. The lamp is parked at
   `distance` from the centre of the scene and looks back at it; its frustum is
   ORTHOGRAPHIC (the rig stands a hundred bounding boxes away, so its rays are
   parallel « sun » rays — utils/viewerLightRig.js) and it is FITTED TO THE
   MOLECULE: the eight corners of the molecule's box are pushed through the
   lamp's view matrix and the six planes are read off their extent — the tightest
   box that still holds every atom, with `margin` of slack. A fitting camera is
   not a detail: the frustum used to be a cube around the bounding SPHERE with
   its near plane at 0.01 Å, so a molecule occupied a small square of the map and
   every real surface sat in one narrow slab of depth — the surest way to make a
   shadow read as a smudge instead of a form. Without a box (a caller that only
   knows a sphere) that sphere's own cube is fitted, which is still tight in the
   two lateral axes.

   Returns the matrices AND the numbers they came from, so a test — or the Ray
   message — can prove the fit instead of trusting it. */
export const shadowRigOf = ({
  dir, bounds = null, center = [0, 0, 0], radius = 1, distance = null,
  margin = RAY_SHADOW_DEFAULTS.fitMargin,
} = {}) => {
  const z = normalize3(dir || [0, 0, 1]);         // FROM the scene TO the lamp
  const box = bounds && bounds.min && bounds.max ? bounds : null;
  const c = box
    ? [
      (box.min[0] + box.max[0]) / 2,
      (box.min[1] + box.max[1]) / 2,
      (box.min[2] + box.max[2]) / 2,
    ]
    : [Number(center[0]) || 0, Number(center[1]) || 0, Number(center[2]) || 0];
  const r = Math.max(1e-3, Number(radius) || 1);
  const d = Math.max(1e-3, Number.isFinite(Number(distance)) ? Number(distance) : r * 100);
  const eye = [c[0] + z[0] * d, c[1] + z[1] * d, c[2] + z[2] * d];
  // An up vector that is never parallel to the light.
  const up = Math.abs(z[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const view = mat4LookAt(eye, c, up);
  const corners = box
    ? boxCornersOf(box)
    : boxCornersOf({ min: [c[0] - r, c[1] - r, c[2] - r], max: [c[0] + r, c[1] + r, c[2] + r] });
  let left = Infinity;
  let right = -Infinity;
  let bottom = Infinity;
  let top = -Infinity;
  let near = Infinity;
  let far = -Infinity;
  const p = new Array(4);
  for (let i = 0; i < 8; i += 1) {
    const v = mat4TransformPoint(view, corners[i], p);
    if (v[0] < left) left = v[0];
    if (v[0] > right) right = v[0];
    if (v[1] < bottom) bottom = v[1];
    if (v[1] > top) top = v[1];
    const depth = -v[2];                          // the lamp looks along −z
    if (depth < near) near = depth;
    if (depth > far) far = depth;
  }
  // A degenerate axis (a flat molecule seen edge-on) must not divide by zero.
  if (!(right > left)) right = left + 1e-3;
  if (!(top > bottom)) top = bottom + 1e-3;
  // The slack: the same hair on the four sides and in depth, so a proxy sphere
  // that pokes a little out of the box is still inside the map. A floor of two
  // percent of the largest span keeps a DEGENERATE axis (a planar molecule seen
  // along its plane, a box with no extent in one direction) from collapsing to a
  // line: the PCF disc needs a map, not a column.
  const m = Math.min(2, Math.max(1, Number(margin) || 1));
  const spanMax = Math.max(right - left, top - bottom, far - near, 1e-3);
  const padFloor = spanMax * 0.02;
  const padX = Math.max(padFloor, ((right - left) * (m - 1)) / 2);
  const padY = Math.max(padFloor, ((top - bottom) * (m - 1)) / 2);
  const padZ = Math.max(padFloor, (padX + padY) / 2);
  const nz = Math.max(1e-3, near - padZ);
  const fz = Math.max(nz + 1e-3, far + padZ);
  const l = left - padX;
  const rt = right + padX;
  const bt = bottom - padY;
  const tp = top + padY;
  const proj = mat4Orthographic(l, rt, bt, tp, nz, fz);
  return {
    view,
    proj,
    clip: mat4Multiply(proj, view),
    left: l,
    right: rt,
    bottom: bt,
    top: tp,
    near: nz,
    far: fz,
    width: rt - l,
    height: tp - bt,
    depthScale: 2 / (fz - nz),
    center: c,
    radius: r,
    distance: d,
    margin: m,
  };
};

/* The lamp's matrices — the whole rig under the name the mask pass has always
   called it by. `clip` is the one matrix that pass multiplies by (= proj · view);
   `view` is kept so the rasteriser can measure a sphere along the light's OWN up
   axis. */
export const lightMatricesOf = (setup) => shadowRigOf(setup);

/* THE WHOLE SHADOW, from the proxies to the mask: one camera pass (where the
   visible surface is) and one light pass (what the lamp sees first), compared
   pixel by pixel. The light pass runs through the FITTED shadow camera of the
   rig — `light.bounds` (the molecule's box) makes the frustum hug it — and the
   comparison is a PCF disc whose radius follows the occluder gap (PCSS), so the
   mask has a penumbra instead of an edge. Returns the blurred mask plus the
   numbers the Ray message reports, and never throws — a shadow that cannot be
   built is no shadow. */
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
  // The bias in the units the depth map is written with: the fitted near / far
  // planes when the caller passed a rig, the old bounding cube otherwise.
  const depthScale = Number(light.depthScale) > 0 ? light.depthScale : lightDepthScale(light);
  const out = shadowMaskOf({
    camera: cameraPass,
    light: { clip: light.clip, depth: lightPass.depth },
    width: mw, height: mh,
    biasNdc: o.bias * depthScale,
    softness: o.softness,
    taps: o.pcfTaps,
    penumbra: o.penumbra,
    penumbraMax: o.penumbraMax,
    depthScale,
  });
  return {
    mask: out.mask,
    maskWidth: mw,
    maskHeight: mh,
    shadowed: out.shadowed,
    spheres: cameraPass.count,
    strength: o.strength,
    // The rig itself, for the message: the surface the shadow camera really
    // covers, in ångströms, and the disc that softens it.
    rig: Number.isFinite(Number(light.width)) && Number.isFinite(Number(light.height))
      ? { width: light.width, height: light.height, depth: light.far - light.near }
      : null,
    penumbra: { taps: out.taps, radius: o.softness, grow: o.penumbra, reached: out.penumbraRadius },
  };
};



/* (lightMatricesOf / shadowRigOf live with the maths above — see shadowRigOf.) */

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

/* ---- WHAT A REPRESENTATION REALLY DRAWS -----------------------------------
   The report that made this table necessary: « the shadow looks like a flat
   smudge lying next to the molecule instead of a shadow OF the molecule ». Every
   atom used to donate a 1.7 Å vdW sphere to the proxy whatever the
   representation drew, so a cartoon — a ribbon a few tenths of an ångström
   thick — carried a shadow volume several times its own thickness, and the
   ribbon went dark where the REAL ribbon stood in the light. The proxy radius
   therefore follows the STROKE the representation asks the GPU for: the vdW
   sphere when the drawing IS the vdW sphere, the bond radius for the stick
   representations, a thin tube along the backbone for the cartoon family, a hair
   for the wireframe. That ONE radius both receives the shadow and casts it, so a
   thin ribbon casts and receives a thin shadow.

   `vdw` is the fraction of the atom's own vdW radius an atom BALL of that
   representation uses (ball+stick draws a small ball at every atom); `min` is
   the stroke in ångströms when the drawing is not an atom ball at all (a tube
   has no vdW radius of its own). */
export const PROXY_STROKE_BY_TYPE = Object.freeze({
  sphere: { vdw: 1, min: 0 },
  spacefill: { vdw: 1, min: 0 },
  surface: { vdw: 1, min: 0 },
  'ball+stick': { vdw: 0.3, min: 0.3 },
  ballstick: { vdw: 0.3, min: 0.3 },
  // Licorice draws STICKS ONLY (NGL gives its atom balls a scale of 0): its
  // stroke is the bond radius, floored at 0.3 Å so a thin stick still casts.
  licorice: { vdw: 0, min: 0.3 },
  line: { vdw: 0, min: 0.15 },
  wireframe: { vdw: 0, min: 0.15 },
  backbone: { vdw: 0, min: 0.35 },
  rope: { vdw: 0, min: 0.3 },
  cartoon: { vdw: 0, min: 0.45 },
  ribbon: { vdw: 0, min: 0.45 },
  tube: { vdw: 0, min: 0.45 },
  trace: { vdw: 0, min: 0.35 },
});

/* The proxy radius of ONE representation, in ångströms: the table above, refined
   by the representation's OWN parameters when they are numbers (`scale` of the
   sphere family, the `radius` of a bond or of a cartoon). `null` means « this
   representation says nothing about its stroke » — the caller then keeps the
   atom's vdW radius, exactly as this module did before the table existed. */
export const proxyRadiusOf = (rep, vdwRadius = 1.7) => {
  const params = (rep && rep.parameters) || null;
  if (!params) return null;
  const stroke = PROXY_STROKE_BY_TYPE[String(params.type || '').toLowerCase()];
  if (!stroke) return null;
  const vdw = Math.max(0.1, Number(vdwRadius) || 1.7);
  const radius = Number(params.radius);
  const scale = Number(params.scale);
  let r = Math.max(stroke.min, vdw * stroke.vdw);
  if (stroke.vdw >= 1) {
    // The drawing IS the atom ball: `sphere_scale` — or a numeric radius —
    // decides its size, exactly as the PyMOL `set sphere_scale` the viewer's own
    // script panel accepts does.
    if (Number.isFinite(scale) && scale > 0) r = vdw * scale;
    if (Number.isFinite(radius) && radius > 0) r = radius;
  } else if (Number.isFinite(radius) && radius > 0) {
    // A bond radius (0.15 … 0.4) or a cartoon radius (0.4 … 0.8).
    r = Math.max(r, radius);
  }
  return Math.max(0.05, r);
};

/* The proxy radius of EVERY atom the component draws, index by index: a Float32
   array parallel to the structure's atoms, `NaN` where no visible representation
   covers the atom. `null` (not an empty array) means « the component says
   nothing about its representations » — an older NGL, a test stub — and the
   caller keeps the vdW radii it always used. */
export const drawnProxyRadiiOf = (comp, atomCount, vdw = null) => {
  const list = comp && comp.reprList;
  if (!Array.isArray(list)) return null;
  const out = new Float32Array(Math.max(0, Math.round(Number(atomCount) || 0)));
  if (!out.length) return out;
  out.fill(NaN);
  list.forEach((el) => {
    try {
      const rep = (el && (el.repr || el)) || null;
      if (!rep || rep.visible === false) return;
      const sv = rep.structureView;
      if (!sv || typeof sv.getAtomIndices !== 'function') return;
      const idx = sv.getAtomIndices();
      if (!idx || !idx.length) return;
      for (let i = 0; i < idx.length; i += 1) {
        const a = idx[i];
        if (!(a >= 0 && a < out.length)) continue;
        const per = proxyRadiusOf(rep, vdw ? vdw[a] : 1.7);
        if (per == null) continue;
        // The FATTEST visible drawing of an atom is what the eye sees, so it is
        // what the shadow must use.
        if (!(out[a] >= per)) out[a] = per;
      }
    } catch { /* a representation that cannot list its atoms draws nothing */ }
  });
  return out;
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
      // …and, for the atoms it does draw, the STROKE of each representation (null
      // = « says nothing »: the atom then keeps its vdW radius).
      const surface = drawn ? drawnProxyRadiiOf(comp, n, data.radius) : null;
      parts.push({ comp, data, n, drawn, surface });
      total += drawn ? drawn.length : n;
    } catch { /* a component that cannot report its atoms casts nothing */ }
  });
  const stride = total > maxAtoms ? Math.ceil(total / maxAtoms) : 1;
  const capacity = Math.ceil(total / stride);
  const out = new Float32Array(capacity * 3);
  const radii = new Float32Array(capacity);
  let k = 0;
  parts.forEach(({ comp, data, n, drawn, surface }) => {
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
      const vdw = rad && Number.isFinite(rad[i]) ? rad[i] : 1.7;
      const stroke = surface ? surface[i] : NaN;
      // The drawing's own stroke when its representation gave one, the atom's own
      // vdW radius otherwise — and never a fat sphere around a thin ribbon.
      radii[k] = Number.isFinite(stroke) && stroke > 0 ? stroke : vdw;
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
   so the shadow of the still and the shading of the canvas come from ONE lamp.
   The shadow CAMERA is the rig fitted to the molecule: `boundsBoxOf` gives the
   box the lamp must cover and `shadowRigOf` turns it into the six planes. */
export const rayShadowInputsOf = (stage, { lightDir = [0, 0, 1], options = {} } = {}) => {
  const o = rayShadowOptions(options);
  const viewer = stage && stage.viewer;
  const atoms = atomsFromStage(stage, o.maxAtoms);
  if (!atoms.count) throw new Error('no atoms to cast a shadow from');
  const camera = cameraFromViewer(viewer);
  const { center, radius } = boundsOf(atoms.positions, atoms.count);
  const bounds = boundsBoxOf(atoms.positions, atoms.count);
  const dir = normalize3(lightDir);
  // The rig parks the lamp a hundred bounding boxes away: parallel « sun » rays.
  const distance = radius * 100;
  const light = {
    dir,
    center,
    radius,
    distance,
    bounds,
    ...shadowRigOf({ dir, bounds, center, radius, distance, margin: o.fitMargin }),
  };
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
  // The fitted shadow camera, in ångströms: the proof that the rig hugged the
  // molecule instead of the whole cube around its bounding sphere.
  const rig = shadow.rig && Number.isFinite(Number(shadow.rig.width))
    ? ` · rig ${Math.round(shadow.rig.width)}×${Math.round(shadow.rig.height)} Å`
    : '';
  return `· cast shadows ${pct}%${covered == null ? '' : ` (${covered}% of the pixels)`}`
    + `${spheres ? ` · ${spheres} atom proxies` : ''}${rig}`;
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
