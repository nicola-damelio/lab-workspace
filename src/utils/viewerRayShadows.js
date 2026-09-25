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
        atoms of its visible representations, in the SCENE frame the camera really
        looks at (the Structure's own atom data, moved by the component's matrix
        AND by the viewer's own groups: NGL's camera never moves, the molecule
        does — see viewerMatrixOf) — become a set of PROXY SPHERES, each one as
        THICK AS THE STROKE
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

   WHAT IT IS, HONESTLY. The proxy is drawn from the atoms AND from what their
   representation draws BETWEEN them: a stick, a tube, a ribbon is a CONTINUOUS
   line, so the proxies that fill it are part of the geometry (LINKED_KINDS —
   without them a thin drawing shadows NOTHING, which is measured in the tests),
   while a ball stays the atom it is.

   …AND THAT LINE IS FILLED ALONG THE STRUCTURE'S OWN BONDS, not from one atom of
   the list to the next. The report « the shadow is a string of separate round
   blobs, about one per residue, with a solid black disc where one of them lies
   along the light » is what « link the atom AFTER this one » gives on a molecule
   whose side chains are drawn too: the list holds every atom the tube and the
   licorice strips draw (they share one selection), so the atom after a backbone
   oxygen is a side-chain carbon — the peptide bond C(i)–N(i+1) that makes the
   ribbon continuous falls between two atoms that are never neighbours there. Each
   residue filled a tidy cluster of its own and nothing bridged to the next:
   blobs. Measured on the 3-residue peptide with its side chains (tests): the
   neighbour rule filled 5 links that are not bonds, left BOTH peptide bonds and
   every side-chain bond open, and drew a phantom link from a side chain to the
   next residue's backbone (that one, seen end-on, saturates the mask: the black
   disc). The structure's own graph fills all 15 real bonds and leaves nothing
   phantom, and NGL exposes it (`structure.eachBond` → atomIndex1 / atomIndex2,
   built from the residue templates AND from the distance-checked peptide bond —
   see drawnBondsOf below), so that is what the fill walks. A structure that
   declares no topology at all (`inferBonds: 'none'`, a hand-built stage) keeps
   the neighbour pairs this module always used, so nothing that used to be filled
   goes dark.

   It is the shadow of the MOLECULE, it follows
   the light, and it is deterministic — no GPU feature, no extension, no second
   engine. A stage with no atoms, a canvas that refuses its pixels or a browser
   without `createImageBitmap` leaves the still exactly as NGL drew it (every
   entry point is best-effort and returns what it was given).

   WHY IT LOOKED « DETACHED AND FLAT » — and what a rig does about it. Four
   things made the shadow a smudge lying NEXT TO the molecule instead of ON it,
   and all four are gone:

     · THE MASK WAS READ FROM A CAMERA THAT WAS INSIDE A TILE OF THE STILL.
       `makeImage` renders the still tile by tile, each tile through
       `camera.setViewOffset(…)`, and it leaves the camera's projection matrix in
       the LAST TILE's frame (`_finalize()` clears `camera.view` but never calls
       `updateProjectionMatrix()` — ngl 2.4, verified in the installed dist).
       The mask was therefore computed for a 1/n × 1/n sub-window of the image —
       magnified n× (n = factor, doubled by the antialias pass) and thrown into
       that tile's corner: the detached blob, whatever the proxies weighed. The
       rig is now read BEFORE the still (captureRayImage) and refuses a camera
       that is mid-tile (cameraFromViewer);
     · THE PROXY WAS FATTER THAN THE DRAWING. Every atom donated a 1.7 Å vdW
       sphere whatever the representation drew, so a thin ribbon carried a
       shadow volume three times its own thickness: the ribbon went dark where
       the REAL ribbon stood in the light. The proxy radius now follows the
       REPRESENTATION'S OWN STROKE (PROXY_STROKE_BY_TYPE below — the vdW sphere
       for sphere / spacefill / surface, the bond radius for ball+stick /
       licorice, a thin tube for cartoon / ribbon / tube / trace / backbone, a
       hair for line). The receiver and the caster are the SAME stroke, so what
       is drawn is what receives and what casts. …AND EVERY STROKE ANSWERS FOR
       THE ATOMS IT DRAWS: the tube and the licorice of a protein share ONE
       selection (see BACKBONE_ONLY_KINDS), so the side chains the tube merely
       LISTS keep the stick's stroke instead of borrowing the tube's — without
       that, each of them cast a sphere twice the radius NGL draws it with, and
       a ring or a branch merged into one round blob (the report « in the ray
       button of the molecular viewer I have spheric shadows for bonds »);
     · THE LAMP'S FRUSTUM WAS A CUBE AROUND THE BOUNDING SPHERE with its near
       plane at 0.01 Å — thousands of ångströms of empty depth for every real
       surface, and a body-sized square where a molecule is not a cube. The
       fitted shadow camera (shadowRigOf) spends that range on the molecule;
     · THE BIAS WAS 0.9 Å, i.e. three bond lengths of cancelled self-shadowing,
       so a crevice — two atoms 0.5 Å apart along the light — could never go
       dark. It is a contact bias now (0.35 Å), and the PCF disc turns what is
       left into a penumbra instead of a stipple.

   SELF-SHADOWING ON THE MOLECULE ITSELF. The mask is built from the surface the
   pixel SHOWS — the visible proxy's centre AND its width in pixels (`reach`), so
   the test asks what a shadow map really asks: « is there an occluder anywhere
   within my own surface, along the lamp? ». A point-like test (the centre ray
   alone) is what made a thin drawing cast nothing at all. The background has no
   surface (the camera pass never hit it), so nothing is ever painted off the
   molecule (see shadowMaskOf).

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
     whole model grey.
     ⚠ The disc is ALWAYS at least as wide as the receiver's own footprint (the
     pixels its surface covers, `camera.reach`): a shadow is cast by a surface, not
     by a point, and a footprint wider than `pcfTaps` samples gets more of them
     automatically (SHADOW_TAPS_PER_PIXEL, capped at SHADOW_MAX_TAPS). */
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
   hit (3 floats per pixel), `hit` the flag array and — when `needReach` is asked
   for — `reach` the PIXEL RADIUS of the sphere that won that pixel (the width of
   the surface the pixel shows: the shadow test needs it, see shadowMaskOf).
   Each sphere covers the square around its projected centre, so a few hundred
   thousand overlapping spheres write the silhouette a shadow map stores. */
export const rasterizeSpheres = ({
  positions, radii, count = 0, clip, width, height,
  radiusScale = 1, axisUp = [0, 1, 0], needWorld = true, needReach = false,
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
  const reach = needReach
    ? (out.reach && out.reach.length === w * h ? out.reach : new Float32Array(w * h))
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
        if (reach) reach[idx] = rad;
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

/* ---- The taps of the shadow test ---------------------------------------- */
/* A proxy sphere covers a handful of mask pixels, and the lamp's rays through
   those pixels span that width: the disc that tests a receiver must be at least
   its own footprint, or an occluder would have to sit on one exact line to cast
   anything (see shadowMaskOf). The disc is built with the caller's `pcfTaps` at
   least, and with enough samples that its own cells stay under ~1/2 px — these
   two numbers are that rule. 64 taps is the ceiling: past it the cost per
   receiver pixel is what the still pays for nothing (the disc is already
   sampled finer than the footprints it looks for). */
export const SHADOW_TAPS_PER_PIXEL = 2.5;
export const SHADOW_MAX_TAPS = 64;

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
  const base = Math.max(0, Number(softness) || 0);
  const grow = Math.max(0, Number(penumbra) || 0);
  const cap = Math.max(0, Number(penumbraMax) || 0);
  const perAngstrom = Number(depthScale) > 0 ? 1 / Number(depthScale) : 0;
  /* ⚠ THE RECEIVER'S OWN FOOTPRINT IS SAMPLED TOO, AND THAT IS NOT A SOFTNESS.
     `camera.reach` is the PIXEL RADIUS of the surface the pixel shows (what
     rasterizeSpheres writes when `needReach` is asked for). A proxy sphere is
     only a few mask pixels wide, so the lamp's rays through the pixels it covers
     span that width: testing the CENTRE ray alone (radius 0) asks an occluder to
     sit within a fraction of an ångström of one line — and a thin drawing then
     casts NOTHING AT ALL. That is the report « the ray doesn't do anything »,
     measured: 30 CA atoms of a 0.5 Å tube, the lamp of the rig (az 25 / el 28),
     a grazing lamp, hard or soft — ZERO shadowed pixels, where the same scene
     with 1.7 Å balls gave thousands (the old detached blob). Sampling the
     footprint turns the test into what a shadow map really asks: « is there an
     occluder anywhere within my own surface, along the lamp? ». The disc the
     caller asks for (`softness`, grown by the gap — PCSS) is added ON TOP of
     that footprint. A caller that hands a `camera` with no `reach` (a
     hand-written coverage map, the older tests) keeps the exact old behaviour:
     the centre ray, 0 or 1. */
  const reach = camera.reach || null;
  const discCache = new Map();
  const discOf = (n) => {
    let d = discCache.get(n);
    if (!d) { d = pcfDiscOf(n); discCache.set(n, d); }
    return d;
  };
  const discTaps = Math.max(1, Math.round(Number(taps) || 1));
  const clipX = (x) => Math.min(w - 1, Math.max(0, x));
  const clipY = (y) => Math.min(h - 1, Math.max(0, y));
  const clipPt = new Array(4);
  const scr = new Array(3);
  let shadowed = 0;
  let penumbraRadius = 0;
  let maxTaps = 0;
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
      const footprint = reach ? Math.max(0, Number(reach[idx]) || 0) : 0;
      // The disc's radius: the receiver's OWN footprint (the surface the pixel
      // shows — never a softness), plus the softness the caller asked for, plus
      // what the GAP deserves. A centre the lamp did not meet (the receiver
      // stands at the edge of a silhouette) keeps the footprint alone — its
      // shadow lives in the taps.
      const grown = base > 0
        ? Math.min(cap, base + (gap > 0 ? grow * gap * perAngstrom : 0))
        : 0;
      const radius = footprint + grown;
      if (!(radius > 0)) {                           // the plain, hard shadow map
        if (met && p[2] > nearest + biasNdc) {
          mask[idx] = 1;
          shadowed += 1;
        }
        continue;
      }
      if (radius > penumbraRadius) penumbraRadius = radius;
      // The taps: the caller's count at least, and enough of them that the
      // disc's own cells stay under ~2 px — 8 Fibonacci taps over a 12 px
      // footprint would leave holes one footprint wide and the shadow would come
      // back as a stipple of dots.
      const need = Math.min(SHADOW_MAX_TAPS, Math.max(discTaps, Math.ceil(radius * SHADOW_TAPS_PER_PIXEL)));
      const disc = discOf(need);
      const invTaps = 1 / need;
      if (need > maxTaps) maxTaps = need;
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
    // `taps` is the count the caller asked for; `tapsMax` is the widest disc that
    // was really used (a footprint, or a grown penumbra, can need more of them —
    // see SHADOW_TAPS_PER_PIXEL).
    taps: discTaps,
    tapsMax: maxTaps,
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
    // The PIXEL RADIUS of the sphere each pixel shows: the shadow test needs it
    // (the lamp's rays through those pixels span that width — see shadowMaskOf).
    needReach: true,
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
    // How many of those proxies exist to FILL a drawn stroke (a stick, a tube):
    // without them a thin drawing casts nothing (see LINKED_KINDS).
    filled: Number(atoms && atoms.filled) || 0,
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

/* ---- THE FRAME THE CAMERA REALLY LOOKS AT (the scene, not the file) -------
   THE REPORT THAT WAS STILL WAITING FOR THIS: « l'ombre est une tache plate
   posée À CÔTÉ de la molécule » — and, in the ray stills, no cast shadow at all.
   NGL's camera NEVER MOVES: it is parked at `cameraZ` (Viewer's own parameter,
   −80) looking at the ORIGIN of the scene, and it is the MOLECULE that is moved
   under it by two groups of the viewer (read in the installed build,
   `Viewer._initScene`):

       scene → rotationGroup → translationGroup → modelGroup → component.group

   The centring / `autoView` writes `translationGroup.position`, the mouse writes
   `rotationGroup.matrix`, and NGL applies that very chain wherever it needs an
   atom's place on screen — `getPositionOnCanvas(p)` is
   `p.add(translationGroup.position).applyMatrix4(rotationGroup.matrix)
   .project(camera)`, and the pick of the transform controls is
   `…applyMatrix4(component.matrix); ….add(translationGroup.position);
   ….applyMatrix4(rotationGroup.matrix)`. A `Component.matrix`
   (`Component.updateMatrix()`) is only the component's OWN place in its file: it
   carries neither the centring nor the rotation of the view.

   The proxies must therefore be built in the SCENE frame:

       world = R · T · M_comp · atom      (R = rotationGroup.matrix, T = the
                                           translation of translationGroup.position)

   ⚠ WITHOUT THIS EVERYTHING IS OFF AS SOON AS THE MOLECULE IS NOT ALREADY
   CENTRED ON THE ORIGIN — which is exactly what `autoView` guarantees it never
   is. Measured on this module, a molecule whose file centre is (12, −7, 25) Å:
   the proxies covered 0 % of the pixels of the real drawing before and 100 %
   after (the §15 case of the test file); the mask was either a smudge beside the
   molecule or — off the frustum — nothing at all, which is the report « there is
   no cast shadow » with the mask built and empty.

   A stub viewer that has neither group (every older test, a hand-built stage) is
   the identity and keeps the path this module always had. */
export const viewerMatrixOf = (stage) => {
  const viewer = stage && stage.viewer;
  if (!viewer) return null;
  const rot = elements16Of(viewer.rotationGroup && viewer.rotationGroup.matrix);
  const pos = viewer.translationGroup && viewer.translationGroup.position;
  const tx = pos ? Number(pos.x) || 0 : 0;
  const ty = pos ? Number(pos.y) || 0 : 0;
  const tz = pos ? Number(pos.z) || 0 : 0;
  if (!rot && !tx && !ty && !tz) return null;      // nothing to add: the old path
  const t = mat4Identity();
  t[12] = tx;
  t[13] = ty;
  t[14] = tz;
  return rot ? mat4Multiply(rot, t) : t;           // translate first, then rotate
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
   thick — carried a shadow volume several times its own thickness: the mask went
   dark NEXT TO the ribbon, and the ribbon stayed lit where it should have been in
   the shade. The proxy radius therefore follows the STROKE the representation
   asks the GPU for. That ONE radius both receives the shadow and casts it, so a
   thin ribbon casts and receives a thin shadow.

   ⚠ THE FIRST VERSION OF THIS TABLE NEVER FIRED. It took the type from
   `rep.parameters.type` and the stroke from `rep.parameters.radius`. Read in the
   INSTALLED ngl 2.4 build (dist/ngl.esm.js), a Representation keeps the VALUES on
   the INSTANCE — `this.type = "cartoon"`, `this.radiusScale = .7`,
   `this.radiusSize`, `this.aspectRatio`, `this.bondScale` — while
   `this.parameters` holds only the DESCRIPTORS of those values
   (`radiusScale: { type: "number", … }`) and carries no `type` key at all.
   `Number({ type: "number" })` is NaN, so EVERY real representation read as
   « unknown » and every atom kept its vdW radius: the fix was invisible in the
   app while the tests passed — they fed a `parameters.type` no NGL ever produces
   (the REAL SHAPE cases of the test file now pin the honest shape).

   The type is read where the viewer itself reads it: `addRepresentation()`
   returns a RepresentationElement and `reprList` holds THOSE (ngl 2.4
   component.ts), the element's `name` is `repr.type`
   (`super(stage, Object.assign({ name: repr.type }, params))`), its own `type` is
   the constant 'representation', and `getType()` returns `this.repr.type`. So
   `repTypeOf` tries `rep.type`, the element's `name`, the element's
   `getType()`, and only then the legacy `parameters.type` of a hand-built object.

   The stroke itself, in the units the viewer's sliders use (the RADIUS block of
   NMRMoleculeViewer.jsx documents the same mapping):

     kind 'vdw'    the drawing IS the atom ball (spacefill / sphere / surface):
                   NGL draws it at `radiusScale` × the atom's vdW radius, or at
                   `radiusSize` Å when `radiusType` is 'size' (`setRadius(2.4)`).
     kind 'ball'   the ball+stick family: NGL's `getAtomRadius` is
                   `aspectRatio × core`, the core being `radiusSize` (0.15 Å by
                   default) — NOT the atom's vdW radius.
     kind 'bond'   the sticks (licorice / base / backbone): the stroke IS
                   `radiusSize` — 0.25 Å for the licorice of this app, 0.3 Å for a
                   base, NGL's own 0.15 Å for the bonds of a ball+stick.
     kind 'spline' the cartoon family: `radiusScale` against NGL's own default for
                   that rep (cartoon 0.7, tube 2, ribbon 4), so a ribbon drawn
                   thicker casts a thicker shadow while a menu nobody touched
                   keeps its baseline.
     kind 'hair'   a wireframe / line: `linewidth` counts PIXELS, so the proxy is
                   the hair-thin floor.

   `min` is the floor of a stroke, in ångströms: a proxy too thin to cover a
   pixel would stop casting altogether. */
export const PROXY_STROKE_BY_TYPE = Object.freeze({
  sphere: { kind: 'vdw', min: 0.12 },
  spacefill: { kind: 'vdw', min: 0.12 },
  surface: { kind: 'vdw', min: 0.12 },
  'ball+stick': { kind: 'ball', core: 0.15, aspect: 2, min: 0.2 },
  ballstick: { kind: 'ball', core: 0.15, aspect: 2, min: 0.2 },
  hyperball: { kind: 'ball', core: 0.15, aspect: 2, min: 0.2 },
  // Licorice draws STICKS ONLY (NGL pins its aspectRatio at 1): its stroke is
  // the bond radius, `radiusSize` — 0.25 Å in this app.
  licorice: { kind: 'bond', core: 0.25, min: 0.2 },
  base: { kind: 'bond', core: 0.3, min: 0.2 },
  backbone: { kind: 'bond', core: 0.15, min: 0.2 },
  line: { kind: 'hair', min: 0.15 },
  wireframe: { kind: 'hair', min: 0.15 },
  cartoon: { kind: 'spline', base: 0.45, scale: 0.7, min: 0.3 },
  ribbon: { kind: 'spline', base: 0.45, scale: 4, min: 0.3 },
  // A TUBE IS A ROUND STICK along the backbone, not a ribbon. ngl 2.4's
  // TubeRepresentation IS the cartoon spline with `aspectRatio: 1`, and its
  // radius is ONE ångström value: `radius` — the shorthand NGL turns into
  // radiusType 'size' + radiusSize (StructureRepresentation#setRadius, verified
  // in the installed build: `init(t){… this.setRadius(e.radius, e); this.radiusType
  // = nt(e.radiusType, "vdw"); this.radiusSize = nt(e.radiusSize, 1)}`) — or an
  // explicit radiusType 'size' + radiusSize. The viewer draws it exactly that way
  // (`radius: TUBE_RADIUS × the R— knob`, see NMRMoleculeViewer.jsx), so the proxy
  // of a tube IS that radius: the tube the user regulates is the tube in the
  // shadow. `base` only serves a hand-written tube that gave no radius at all —
  // deliberately thin, never the 1.7 Å vdW ball of the fat blob.
  tube: { kind: 'tube', base: 0.5, min: 0.2 },
  rope: { kind: 'spline', base: 0.3, scale: 1, min: 0.2 },
  trace: { kind: 'spline', base: 0.35, scale: 1, min: 0.2 },
});

/* The TYPE of a representation, from the objects NGL really hands out: the rep's
   own `type`, the element's `name` (= `repr.type`), the element's `getType()`
   (= `this.repr.type`), and only then the legacy `parameters.type` of a
   hand-built object (a stub of a test — see the long table note above). */
export const repTypeOf = (rep, el = null) => {
  let fromEl = '';
  if (el) {
    fromEl = el.name || (typeof el.getType === 'function' ? el.getType() : '');
  }
  const raw = (rep && rep.type) || fromEl || (rep && rep.parameters && rep.parameters.type) || '';
  return String(raw).toLowerCase();
};

/* The KIND of a representation's stroke — what the table above says it draws
   (`vdw` · `ball` · `bond` · `spline` · `tube` · `hair`), '' when it says
   nothing. atomsFromStage uses it to know which drawings are a CONTINUOUS line
   between two atoms (see LINKED_KINDS). */
export const repKindOf = (rep, el = null) => {
  const stroke = PROXY_STROKE_BY_TYPE[repTypeOf(rep, el)];
  return stroke ? stroke.kind : '';
};

/* WHICH DRAWINGS ARE A LINE BETWEEN TWO ATOMS, and must therefore be cast as
   ONE CONTINUOUS PROXY instead of a dust of separate balls:

     spline / tube / bond / ball — a cartoon / tube / ribbon walks the chain as a
                            tube, the sticks are cylinders between bonded atoms, and
                            a ball+stick draws both: the drawing between two atoms
                            is a solid line. The proxy has to FILL it (see the
                            link walk in atomsFromStage), or the shadow of a thin
                            drawing is measured at ZERO — verified on the rig's
                            own scene: 30 CA atoms of a 0,5 Å tube lit at
                            az 25 / el 28 shadowed 0 pixels out of 3655, and the
                            same atoms with the gaps filled shadowed 3160 out of
                            12247 (13 % of the light lost);
     vdw / hair          — a ball IS one atom and a line is hair-thin, so there is
                            nothing to fill: the atoms' own spheres are the
                            drawing. */
export const LINKED_KINDS = Object.freeze({ spline: 1, tube: 1, bond: 1, ball: 1 });

/* WHICH STROKES ARE THE CHAIN ITSELF — and therefore draw ONLY its backbone.

   A cartoon, a ribbon, a tube, a rope, a trace is a line ALONG THE POLYMER: NGL
   builds that line from the residue types' own backbone atoms and walks from one
   residue to the next, so a side-chain atom the representation's StructureView
   happens to list is NOT drawn by it. And NGL's StructureView LISTS THE WHOLE
   SELECTION: `getAtomIndices()` is `structure.getAtomIndices(selection)` (ngl
   2.4, verified in the installed dist), so the viewer's Tube — `sele: sels.protein`
   — hands us every side-chain atom of the protein as well, and « the fattest
   visible drawing wins » below then gave each of them the TUBE's stroke instead
   of the 0.25 Å stick the Licorice actually draws them with. Measured on the
   shared list: CB / CG1 / CG2 projected as 0.5 Å spheres, twice their real
   radius — enough for a ring or a branch, whose atoms sit one bond apart, to
   merge into one round blob instead of resolving into the sticks NGL draws.
   That is the report « in the ray button of the molecular viewer I have spheric
   shadows for bonds ».

   The question asked here is NGL's own: `AtomProxy#isBackbone()` reads
   `residueType.backboneIndexList` — the list the cartoon / tube geometry is
   built from (verified on the installed build: N · CA · C · O answer true, CB ·
   CG1 · CG2 false). See the gate in drawnProxyRadiiOf: the filter applies to a
   representation only when its OWN atom list really holds backbone atoms. A tube
   a PyMOL script puts on a ligand-only selection has none, and NGL does draw
   those atoms — filtering there would put its stroke back to nothing, i.e. the
   « a thin drawing casts no shadow » regression the link walk exists to fix. */
export const BACKBONE_ONLY_KINDS = Object.freeze({ spline: 1, tube: 1 });

/* ONE number of a representation: the INSTANCE value first (that is where ngl 2.4
   keeps it: `rep.radiusScale`, `rep.radiusSize`, `rep.aspectRatio` …), then the
   same key on the element's own parameters (what `el.setParameters()` writes),
   then the legacy keys a hand-built object may carry. Only a positive, finite
   number counts — the DESCRIPTORS of `rep.parameters` (`{ type: 'number' }`) are
   objects, so they are skipped here, exactly as they must be. */
const repNumber = (rep, el, ...keys) => {
  const sources = [rep, el && el.parameters, rep && rep.parameters];
  for (let s = 0; s < sources.length; s += 1) {
    const source = sources[s];
    if (!source) continue;
    for (let k = 0; k < keys.length; k += 1) {
      const v = Number(source[keys[k]]);
      if (Number.isFinite(v) && v > 0) return v;
    }
  }
  return 0;
};

/* The proxy radius of ONE representation, in ångströms: the table above, filled
   with the rep's OWN numbers. `null` means « this representation says nothing
   about its stroke » — the caller then keeps the atom's vdW radius, exactly as
   this module did before the table existed. `el` is the RepresentationElement
   that wraps the rep (see drawnProxyRadiiOf); it is optional, because the tests
   and the older callers hand the rep alone. */
export const proxyRadiusOf = (rep, vdwRadius = 1.7, el = null) => {
  const stroke = PROXY_STROKE_BY_TYPE[repTypeOf(rep, el)];
  if (!stroke) return null;
  const vdw = Math.max(0.1, Number(vdwRadius) || 1.7);
  // `scale` / `sphereScale` are the legacy names of the sphere slider (the PyMOL
  // script panel and the styling menus of this viewer pass `radiusScale`, and
  // `scale` as well for the spacefill styles).
  const radiusScale = repNumber(rep, el, 'radiusScale', 'sphereScale', 'scale');
  const radiusSize = repNumber(rep, el, 'radiusSize', 'radius');
  const aspect = repNumber(rep, el, 'aspectRatio');
  const radiusType = String((rep && rep.radiusType) || '').toLowerCase();
  const sizeType = radiusType === '' || radiusType === 'size';
  // The atom-sized core NGL would use for this rep: its own `radiusSize` when the
  // rep measures radii in ångströms ('size' is what a numeric radius switches to),
  // the scaled vdW radius when it measures them in vdW radii.
  const core = (fallback) => {
    if (radiusSize > 0 && (sizeType || radiusScale <= 0)) return radiusSize;
    if (radiusScale > 0) return vdw * radiusScale;
    return fallback;
  };
  let r;
  switch (stroke.kind) {
    case 'vdw':      // the drawing IS the atom ball
      r = core(vdw);
      break;
    case 'ball':     // ball+stick: NGL draws the atom ball at aspectRatio × core
      r = core(stroke.core) * (aspect || stroke.aspect);
      break;
    case 'bond':     // the sticks: the stroke itself
      r = core(stroke.core);
      break;
    case 'spline':   // the cartoon family: radiusScale against NGL's own default
      r = radiusScale > 0 ? stroke.base * (radiusScale / stroke.scale) : stroke.base;
      if (radiusSize > 0 && sizeType) r = Math.max(r, radiusSize);
      break;
    case 'tube':     // the round tube along the backbone: an ångström radius
      // radiusType 'size' — which is what `radius: 0.5` gives — means radiusSize
      // IS the tube the user sees, so the proxy takes it as it stands. A tube
      // measuring its radius another way (a hand-written rep) keeps the thin
      // baseline scaled by its own radiusScale: no vdW ball, ever.
      r = sizeType && radiusSize > 0
        ? radiusSize
        : (radiusScale > 0 ? stroke.base * radiusScale : stroke.base);
      break;
    default:         // 'hair': a line counts its width in pixels, not in ångströms
      r = stroke.min;
  }
  return Math.max(0.05, Math.max(stroke.min, r));
};

/* THE STRUCTURE'S OWN AtomProxy, or `null` when the object at hand cannot answer
   (an older NGL, a hand-built stage, a test stub): the question below is then
   simply NOT asked and the representation keeps every atom it lists — never the
   other way round, because a drawing that stops casting is a disappearing shadow,
   not a thin one. ONE proxy serves a whole walk: `ap.index = a` re-reads the
   residue the atom belongs to (NGL's index setter refreshes residueIndex /
   residueAtomOffset, and `isBackbone()` reads `residueType.backboneIndexList`
   through them — verified on the installed 2.4 build, round-trips included). */
const atomProxyOf = (structure) => {
  try {
    if (!structure || typeof structure.getAtomProxy !== 'function') return null;
    const ap = structure.getAtomProxy();
    return ap && typeof ap.isBackbone === 'function' ? ap : null;
  } catch { return null; }
};

/* DOES THIS REPRESENTATION WALK A CHAIN? True as soon as its own atom list holds
   one backbone atom — the gate of BACKBONE_ONLY_KINDS (see drawnProxyRadiiOf). An
   exception from the proxy, or no proxy at all, answers NO: no filtering. */
const drawsBackboneOf = (ap, idx) => {
  if (!ap) return false;
  try {
    for (let i = 0; i < idx.length; i += 1) {
      const a = idx[i];
      if (!(a >= 0)) continue;
      ap.index = a;
      if (ap.isBackbone()) return true;
    }
  } catch { return false; }
  return false;
};

/* The proxy radius of EVERY atom the component draws, index by index: a Float32
   array parallel to the structure's atoms, `NaN` where no visible representation
   covers the atom. `null` (not an empty array) means « the component says
   nothing about its representations » — an older NGL, a test stub — and the
   caller keeps the vdW radii it always used.
   `links` (optional, a Uint8Array of the same length) is filled with 1 for the
   atoms whose drawing CONTINUES to its neighbour — a stick, a tube, a ribbon —
   and 0 for an atom that is a ball on its own: atomsFromStage fills the gaps of
   the first kind so the proxy is the drawn line, not a dust of balls.
   A representation of a CHAIN kind answers for its backbone atoms ONLY
   (BACKBONE_ONLY_KINDS, gated by the AtomProxy above) — the other atoms of the
   list it shares with the sticks are drawn by the sticks, at THEIR stroke. */
export const drawnProxyRadiiOf = (comp, atomCount, vdw = null, links = null) => {
  const list = comp && comp.reprList;
  if (!Array.isArray(list)) return null;
  const out = new Float32Array(Math.max(0, Math.round(Number(atomCount) || 0)));
  if (!out.length) return out;
  out.fill(NaN);
  // The structure's own AtomProxy, read ONCE (see atomProxyOf): the chain kinds
  // ask it, atom by atom, whether the representation draws here at all.
  const ap = atomProxyOf(comp && comp.structure);
  list.forEach((el) => {
    try {
      const rep = (el && (el.repr || el)) || null;
      if (!rep || rep.visible === false) return;
      const sv = rep.structureView;
      if (!sv || typeof sv.getAtomIndices !== 'function') return;
      const idx = sv.getAtomIndices();
      if (!idx || !idx.length) return;
      const kind = repKindOf(rep, el);
      const linked = LINKED_KINDS[kind] === 1;
      // ⚠ The chain filter applies to THIS representation only when it really
      // walks a chain (see BACKBONE_ONLY_KINDS): a tube / a trace on a
      // ligand-only selection has no backbone atom to keep, and NGL does draw
      // what it lists there — its stroke then stays, exactly as before.
      const chainOnly = BACKBONE_ONLY_KINDS[kind] === 1 && drawsBackboneOf(ap, idx);
      for (let i = 0; i < idx.length; i += 1) {
        const a = idx[i];
        if (!(a >= 0 && a < out.length)) continue;
        if (chainOnly) {
          ap.index = a;
          if (!ap.isBackbone()) continue;    // the spline does not draw here
        }
        const per = proxyRadiusOf(rep, vdw ? vdw[a] : 1.7, el);
        if (per == null) continue;
        // The FATTEST visible drawing of an atom is what the eye sees, so it is
        // what the shadow must use. A bond is a bond whatever else is drawn on
        // top of it, so the link is an OR.
        if (!(out[a] >= per)) out[a] = per;
        if (linked && links) links[a] = 1;
      }
    } catch { /* a representation that cannot list its atoms draws nothing */ }
  });
  return out;
};

/* ---- THE PROXIES: the atoms, AND THE LINES THAT JOIN THEM ----------------- */
/* A drawn line is a stroke BETWEEN TWO BONDED ATOMS (a stick along a bond, a tube
   or a ribbon walking the bonds of the backbone): it is cast by the proxies that
   FILL it, one every `step` ångströms so consecutive spheres overlap and the line
   has no hole, at the stroke's own radius, lerped between its two ends (the stroke
   of a lipstick changes along a chain). `step` is half the thinnest of the two
   strokes, floored at LINK_STEP_MIN; a link longer than LINK_MAX is not a drawing
   between bonded neighbours (a chain break, a jump between two molecules) and
   stays open. WHICH pairs are links is the STRUCTURE'S OWN BOND GRAPH, never the
   order of the atom list — see drawnBondsOf. */
const LINK_STEP_MIN = 0.3;
const LINK_MAX = 4.2;
const linkStepOf = (ra, rb) => Math.max(LINK_STEP_MIN, 0.5 * Math.min(ra, rb));

/* THE REAL BONDS of the structure between two atoms a drawing runs through — what
   the link walk fills. NGL keeps the topology it built (the residue templates,
   plus the peptide bond between two consecutive residues, distance-checked, plus
   the parser's own CONECT records — PdbParser) on the structure, and `eachBond`
   hands every BondProxy its `atomIndex1` / `atomIndex2`. THAT is the graph of the
   drawn lines: a stick lies along a bond and a tube walks the bonds of the
   backbone, so the fill must walk them too. The atoms of the drawn LIST are not
   that graph — that is the « separate round blobs, one per residue » report: the
   peptide bond C(i)–N(i+1) has a side-chain atom between its two ends in the list,
   so it was never filled, while a link was filled from a side chain straight to
   the next residue's backbone (the phantom line that reads as a solid black disc
   when it happens to run along the light).

   `links[i] === 1` (see drawnProxyRadiiOf) means the drawing CONTINUES from atom
   i, so a bond is a link only when BOTH of its atoms are drawn that way: a bond
   that reaches an atom nothing draws is not on screen. Duplicates are dropped —
   a file that carries CONECT records AND has its bonds inferred reports the same
   pair twice (measured on the probe peptide: 17 bonds for 15 real ones), and the
   same link filled twice would only spend the budget twice.

   `null` — « this structure declares NO topology » — is a DIFFERENT answer from
   « its topology says these two atoms are not bonded »: the caller falls back on
   the neighbour pairs for the first (a raw ensemble, a hand-built stage: better a
   filled line than none) and never for the second, because that fallback IS the
   phantom links of the report. `[]` — nothing here is a line, or nothing bonded
   is drawn — therefore means « fill nothing », not « use the list order ». */
const drawnBondsOf = (structure, links, n) => {
  if (!structure || typeof structure.eachBond !== 'function') return null;
  const declared = Number(structure.bondCount);
  if (!(Number.isFinite(declared) && declared > 0)) return null;
  let linked = false;
  for (let i = 0; i < n && !linked; i += 1) linked = links[i] === 1;
  if (!linked) return [];
  const out = [];
  const seen = new Set();
  try {
    structure.eachBond((bond) => {
      const a = bond.atomIndex1;
      const b = bond.atomIndex2;
      if (!(a >= 0 && a < n && b >= 0 && b < n) || a === b) return;
      if (links[a] !== 1 || links[b] !== 1) return;
      const key = a < b ? a * n + b : b * n + a;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(a, b);
    });
  } catch { /* what was read is real: keep those bonds rather than guess */ }
  return out;
};

/* One part, laid out in world space: the atoms it emits (the drawn ones, strided
   when the budget is tight) with their stroke, whether their drawing CONTINUES
   from them, and the LINES to fill — the real bonds between those atoms, or the
   neighbour pairs this module always used when the structure declares no topology
   at all. Links are kept as SLOT pairs, because a slot is what the fills
   interpolate. */
const layOut = (part, stride) => {
  const slotOf = new Map();
  const own = elements16Of(part.comp.matrix);
  /* The component's OWN matrix first, then the viewer's groups ON TOP of it — the
     chain NGL gives the GPU (see viewerMatrixOf: a molecule joined to its
     centre is moved by `translationGroup.position`, the mouse rotation lives in
     `rotationGroup.matrix`, and neither is in `comp.matrix`). A component the
     styling bar moved / rotated keeps that too: it IS `comp.matrix`. The
     `group.matrixWorld` fallback stays for an object that carries no `matrix`
     of its own (a hand-built stub). */
  const m = own
    ? (part.viewerM ? mat4Multiply(part.viewerM, own) : own)
    : elements16Of(part.comp.group && part.comp.group.matrixWorld);
  const pos = part.data.position;
  const rad = part.data.radius;
  const surface = part.surface;
  const links = part.links;
  const count = part.drawn ? part.drawn.length : part.n;
  const len = Math.max(0, Math.ceil(count / stride));
  const wpos = new Float32Array(Math.max(1, len) * 3);
  const wrad = new Float32Array(Math.max(1, len));
  const wlink = new Uint8Array(Math.max(1, len));
  let e = 0;
  for (let c = 0; c < count && e < len; c += stride) {
    const i = part.drawn ? part.drawn[c] : c;
    if (!(i >= 0 && i < part.n)) continue;
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    if (m) {
      wpos[e * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
      wpos[e * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      wpos[e * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    } else {
      wpos[e * 3] = x;
      wpos[e * 3 + 1] = y;
      wpos[e * 3 + 2] = z;
    }
    const vdw = rad && Number.isFinite(rad[i]) ? rad[i] : 1.7;
    const stroke = surface ? surface[i] : NaN;
    const drawn = Number.isFinite(stroke) && stroke > 0;
    // The drawing's own stroke when its representation gave one, the atom's own
    // vdW radius otherwise — and never a fat sphere around a thin ribbon.
    wrad[e] = drawn ? stroke : vdw;
    wlink[e] = drawn && links && links[i] === 1 ? 1 : 0;
    slotOf.set(i, e);
    e += 1;
  }
  /* THE LINKS, as slot pairs. `part.bonds` is the structure's bond graph between
     the atoms a drawing continues from (drawnBondsOf): a bond whose atom the
     budget's stride dropped has no slot and cannot be filled — the proxy is
     coarser then, which is what a stride means. `null` is « no topology »: the
     neighbour pairs, which is what this module did before the graph existed, and
     they are as useless now as they were then when nothing here is a line. */
  const maxPairs = part.bonds ? part.bonds.length / 2 : Math.max(0, e - 1);
  const edges = new Int32Array(Math.max(0, maxPairs) * 2);
  let p = 0;
  if (part.bonds) {
    for (let b = 0; b + 1 < part.bonds.length; b += 2) {
      const sa = slotOf.get(part.bonds[b]);
      const sb = slotOf.get(part.bonds[b + 1]);
      if (sa === undefined || sb === undefined) continue;
      edges[p] = sa;
      edges[p + 1] = sb;
      p += 2;
    }
  } else {
    for (let s = 0; s + 1 < e; s += 1) {
      if (!wlink[s] || !wlink[s + 1]) continue;
      edges[p] = s;
      edges[p + 1] = s + 1;
      p += 2;
    }
  }
  return {
    wpos,
    wrad,
    wlink,
    len: e,
    edges: p === edges.length ? edges : edges.subarray(0, p),
    fills: new Int32Array(Math.max(1, p / 2)),
  };
};

/* How many proxies fill each LINK, at `scale` times the nominal step (scale 1 =
   the drawn geometry; a bigger one = a tighter budget; Infinity = no filling at
   all). Writes the counts into `lay.fills` — one per link, in the order of
   `lay.edges` — and returns their sum. */
const countFills = (lay, scale) => {
  const edges = lay.edges;
  let cost = 0;
  for (let k = 0; k + 1 < edges.length; k += 2) {
    const a = edges[k];
    const b = edges[k + 1];
    let n = 0;
    if (lay.wlink[a] && lay.wlink[b]) {
      const dx = lay.wpos[b * 3] - lay.wpos[a * 3];
      const dy = lay.wpos[b * 3 + 1] - lay.wpos[a * 3 + 1];
      const dz = lay.wpos[b * 3 + 2] - lay.wpos[a * 3 + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (Number.isFinite(d) && d > 0 && d <= LINK_MAX) {
        const step = linkStepOf(lay.wrad[a], lay.wrad[b]) * scale;
        n = Math.max(0, Math.ceil(d / step) - 1);
        if (!Number.isFinite(n)) n = 0;
      }
    }
    lay.fills[k / 2] = n;
    cost += n;
  }
  return cost;
};

/* The flat arrays the mask pass reads: every emitted atom of every part, then the
   proxies that fill EVERY link between them — each one lerped between its own two
   atoms, so a branch (two bonds leaving one atom) is filled as well as a chain. */
const fillDrawnLinks = (parts, stride, maxAtoms) => {
  const layouts = parts.map((part) => layOut(part, stride));
  const slots = layouts.reduce((a, lay) => a + lay.len, 0);
  let scale = 1;
  let cost = layouts.reduce((a, lay) => a + countFills(lay, scale), 0);
  if (cost > 0 && slots + cost > maxAtoms) {
    // One shot at the scale that would just fit, then « no filling at all » if
    // even that is too much (the atoms alone are what this module always used).
    scale = Math.max(1, (slots + cost) / Math.max(1, maxAtoms));
    cost = layouts.reduce((a, lay) => a + countFills(lay, scale), 0);
    if (slots + cost > maxAtoms) {
      cost = layouts.reduce((a, lay) => a + countFills(lay, Infinity), 0);
    }
  }
  const capacity = Math.max(1, slots + cost);
  const out = new Float32Array(capacity * 3);
  const radii = new Float32Array(capacity);
  let k = 0;
  layouts.forEach((lay) => {
    // The atoms of THIS part first (they ARE the drawing), then its links: the
    // capacity is slots + the fills of every link, so nothing is ever crowded out.
    for (let e = 0; e < lay.len && k < capacity; e += 1) {
      out[k * 3] = lay.wpos[e * 3];
      out[k * 3 + 1] = lay.wpos[e * 3 + 1];
      out[k * 3 + 2] = lay.wpos[e * 3 + 2];
      radii[k] = lay.wrad[e];
      k += 1;
    }
    // …then the proxies that fill each link, between its two own atoms.
    const edges = lay.edges;
    for (let p = 0; p + 1 < edges.length && k < capacity; p += 2) {
      const fills = lay.fills[p / 2];
      if (!fills) continue;
      const a = edges[p];
      const b = edges[p + 1];
      const ax = lay.wpos[a * 3];
      const ay = lay.wpos[a * 3 + 1];
      const az = lay.wpos[a * 3 + 2];
      const bx = lay.wpos[b * 3];
      const by = lay.wpos[b * 3 + 1];
      const bz = lay.wpos[b * 3 + 2];
      const ra = lay.wrad[a];
      const rb = lay.wrad[b];
      for (let f = 1; f <= fills && k < capacity; f += 1) {
        const u = f / (fills + 1);
        out[k * 3] = ax + (bx - ax) * u;
        out[k * 3 + 1] = ay + (by - ay) * u;
        out[k * 3 + 2] = az + (bz - az) * u;
        radii[k] = ra + (rb - ra) * u;
        k += 1;
      }
    }
  });
  return { positions: out, radii, count: k, filled: cost };
};

/* World space: NGL stores the atoms in the structure's OWN frame and gives the
   GPU the component's matrix (`component.matrix`, kept up to date by
   `updateMatrix()` — the « Move X · Y · Z » of the styling bar writes it) UNDER
   the viewer's own groups (`rotationGroup`, `translationGroup` — see
   viewerMatrixOf: the camera never moves, the molecule does). The shadow must
   live in the frame the camera projects, so the same chain is applied here —
   `R · T · component.matrix`. Invisible components are skipped, and of a visible
   one only the atoms its VISIBLE representations draw (see drawnAtomIndicesOf):
   what is not on screen must not cast anything.

   THE PROXY IS THE DRAWN GEOMETRY, NOT A DUST OF BALLS. Two atoms a drawing
   CONTINUES from (a stick, a tube, a ribbon — LINKED_KINDS) are joined by proxies
   that fill the gap every `step` ångströms at the stroke's own radius — and they
   are joined ALONG THE STRUCTURE'S OWN BONDS (drawnBondsOf), because the atom
   after a backbone oxygen in the drawn list is a side-chain carbon as soon as the
   side chains are drawn too: filling by list order gave every residue its own tidy
   cluster and left BOTH peptide bonds — the links that make the ribbon continuous
   — open, which is the « string of separate round blobs » of the report. The tube
   a cartoon draws is continuous, and a proxy made of its atoms
   alone leaves holes ångströms wide that no ray can hit: measured on the rig's
   own scene, that filling is the whole shadow — 30 CA atoms of a 0,5 Å tube lit
   at az 25 / el 28 shadowed 0 pixels of 3655 without it, 3160 of 12247 (13 % of
   the light lost) with it. The filling is BUDGETED by `maxAtoms` (the proxies
   really produced): a huge system widens the step, and when there is no room at
   all the proxy falls back on the atoms alone — exactly what this module always
   did. */
export const atomsFromStage = (stage, maxAtoms = RAY_SHADOW_DEFAULTS.maxAtoms) => {
  const comps = (stage && stage.compList) || [];
  // The viewer's own groups, read ONCE for every component (see viewerMatrixOf):
  // NGL's camera never moves, so the centring and the mouse rotation are HERE.
  const viewerM = viewerMatrixOf(stage);
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
      // = « says nothing »: the atom then keeps its vdW radius), plus which of
      // those atoms the drawing CONTINUES from (a stick / a tube, see
      // LINKED_KINDS — the links the proxy has to fill).
      // ⚠ The stroke table must run even when `drawn` is null (« every atom: no
      // filtering to do »): a single cartoon covering the whole chain is the
      // COMMON case, and gating the stroke table on `drawn` is what kept 1,7 Å
      // spheres around every ribbon there. drawnProxyRadiiOf itself returns null
      // when the component says nothing about its representations.
      const links = new Uint8Array(n);
      const surface = drawnProxyRadiiOf(comp, n, data.radius, links);
      // …and THE TOPOLOGY of those atoms: the real bonds the fill runs along
      // (drawnBondsOf). `null` = « this structure declares no graph »: the link
      // walk then keeps the neighbour pairs of the list, as it always did.
      const bonds = drawnBondsOf(structure, links, n);
      parts.push({ comp, data, n, drawn, surface, links, viewerM, bonds });
      total += drawn ? drawn.length : n;
    } catch { /* a component that cannot report its atoms casts nothing */ }
  });
  const stride = total > maxAtoms ? Math.ceil(total / maxAtoms) : 1;
  return { ...fillDrawnLinks(parts, stride, maxAtoms), stride, total };
};

/* The CAMERA of the live viewer, as the two matrices the mask needs: the
   projection NGL itself uses (so the mask lands on the very pixels the still
   has — the Ray keeps `trim: false`, which is what makes the aspect identical)
   and the view, kept for the sphere measurement.

   ⚠ A CAMERA THAT IS INSIDE A TILE OF A STILL MUST NEVER BE READ. `makeImage`
   renders the still tile by tile and pushes the camera into each tile's own
   sub-frustum (`camera.setViewOffset(fullWidth, fullHeight, offsetX, offsetY,
   tileWidth, tileHeight)` — ngl 2.4, the TiledRenderer class of the installed
   dist), and its `_finalize()` only clears `camera.view` WITHOUT calling
   `updateProjectionMatrix()`: the projection matrix therefore still holds the
   LAST TILE's off-centre frustum until the next render. A mask built from it is
   the mask of a 1/n × 1/n sub-window of the still, MAGNIFIED n× and thrown into
   that tile's corner — the « flat smudge lying next to the molecule » of the
   report, which no proxy radius could ever cure. The caller reads the camera
   BEFORE `makeImage` (see captureRayImage); this guard makes the mistake
   impossible instead of silent. */
export const cameraFromViewer = (viewer) => {
  const cam = (viewer && (viewer.camera || viewer.perspectiveCamera || viewer.orthographicCamera)) || null;
  /* ⚠ `cam.view` IS NOT « WE ARE INSIDE A TILE ». It is a plain object three.js
     creates on the FIRST `setViewOffset` and NEVER removes: its
     `clearViewOffset()` only sets `view.enabled = false` (read in the installed
     three — Camera#clearViewOffset). And NGL super-samples on its own: the
     `__renderSuperSample` pass (asked for by the ◐ Shadows rig, `sampleLevel` 2,
     and run again at level 3 on every idle frame) calls `setViewOffset` once per
     sample and `clearViewOffset()` when it is done. So after the FIRST rendered
     frame every live camera carries a truthy `cam.view` whose `enabled` is false
     — and refusing on its PRESENCE threw on every real click of ✨ Ray:
     `rayShadowInputsOf` threw with it, `captureRayImage` swallowed the error and
     the still came back WITHOUT any shadow and WITHOUT a word about it. That is
     the report « there is no cast shadow », and the note is the shape of the bug:
     a test that fed a camera with no `view` at all could never catch it.
     The guard therefore asks the question three's own `updateProjectionMatrix`
     asks — `view !== null && view.enabled` — so a camera left in a TILE is still
     refused, while a view the super-sampler disabled is inert (`projectionMatrix`
     is the full-frame projection the still is a crop of) and is read normally. */
  const viewOffset = cam && cam.view;
  if (viewOffset && viewOffset.enabled === true) {
    throw new Error('the camera is inside a tile of a ✨ Ray still (setViewOffset) — read it before the render');
  }
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
  } catch (err) {
    /* A plain still is a normal outcome, never an error — but the reason is kept
       ON the shadow and traced, so the Ray message can say why: a feature that
       vanishes without a word is exactly what « the ray doesn't do anything »
       was (see captureRayImage and rayShadowNote). */
    shadow.failed = (err && err.message) || 'the still could not be shadowed';
    console.warn('✨ Ray: no cast shadows —', shadow.failed);
    return blob;
  }
};

/* One line for the Ray message: what the shadow cost and how much of the
   molecule it really reached. Given a `reason` and NO shadow (the still could not
   be shadowed at all), it says so instead of saying nothing — see the module doc
   of captureRayImage: a shadow that disappears without a word is what the users
   kept reporting as « the ray doesn't do anything ». */
export const rayShadowNote = (shadow, reason = '') => {
  if (!shadow || !shadow.mask) {
    return reason ? `· no cast shadows — ${reason}` : '';
  }
  // A mask that was built but never made it onto the still (see
  // addCastShadowsToBlob): the note says the reason, not a coverage nobody had.
  if (shadow.failed) return `· no cast shadows — ${shadow.failed}`;
  const pct = Math.round((Number(shadow.strength) || 0) * 100);
  /* ⚠ 0 % IS A RESULT, NOT « NO DATA ». `reachedPixels === 0` means the mask WAS
     built and touched no pixel of the still — the honest diagnostic of a proxy
     set that misses the drawing (or of an off-frustum one). Only an unknown
     count (a caller that never applied the mask) is left out of the line. */
  const px = Number(shadow.reachedPixels);
  const covered = Number.isFinite(px) && shadow.imageWidth && shadow.imageHeight
    ? Math.round((px / (shadow.imageWidth * shadow.imageHeight)) * 100)
    : null;
  const spheres = Number(shadow.spheres) || 0;
  const filled = Number(shadow.filled) || 0;
  // The fitted shadow camera, in ångströms: the proof that the rig hugged the
  // molecule instead of the whole cube around its bounding sphere.
  const rig = shadow.rig && Number.isFinite(Number(shadow.rig.width))
    ? ` · rig ${Math.round(shadow.rig.width)}×${Math.round(shadow.rig.height)} Å`
    : '';
  return `· cast shadows ${pct}%${covered == null ? '' : ` (${covered}% of the pixels)`}`
    + `${spheres ? ` · ${spheres} proxies${filled ? ` (${filled} filling the drawn strokes)` : ''}` : ''}${rig}`;
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
