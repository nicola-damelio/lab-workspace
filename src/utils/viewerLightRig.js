/* =========================================================================
   src/utils/viewerLightRig.js
   The 3D viewer's LIGHT RIG — one single source of truth.

   It was EXTRACTED from NMRMoleculeViewer.jsx (§3 Scene → « ◐ Shadows »,
   « 🌑 Darkness », « 💡 Light »), where those numbers used to be written inline
   in the two branches of applyShadowSettings() and in installShadowLightRig().
   They are the reference look — « perfect, do not lose it » :

     lightColor 0xffffff · ambientColor 0xffffff        (never tints a colour)
     Shadows OFF : lightIntensity 1.15 · ambientIntensity 0.34 · sampleLevel 0
     Shadows ON  : lightIntensity 1.3 + 0.7·dark        → 1.3 … 2.0
                   ambientIntensity max(0.12, 0.34 − 0.22·dark) → 0.34 … 0.12
                   sampleLevel 2
     direction   : unit vector FROM the molecule TOWARD the key light, built from
                   the Azimuth / Elevation sliders, the lamp parked at 100× the
                   bounding box distance (effectively parallel « sun » rays).
                   Shadows OFF keeps NGL's own camera-linked headlight.

   The SAME rig is translated below for Mol* (Molstar), the engine that can draw
   the projected shadows and the cavity ambient-occlusion shading that NGL 2.4
   cannot. Every API fact used here was read in the installed molstar 4.18.0:

     mol-gl/renderer.js         RendererParams.light = ObjectList({ inclination,
                                azimuth, color, intensity }) + ambientColor +
                                ambientIntensity — the same two terms as NGL.
     mol-math/…/vec3.js         directionFromSpherical(incl, az, r) =
                                (r·cos az·sin incl, r·sin az·sin incl, r·cos incl)
                                so molstarSphericalFromDirection() below inverts it
                                exactly (proved in _viewer_light_rig_test.mjs
                                against Mol*'s OWN function).
     mol-gl/shader/chunks/apply-light-color.glsl.js
                                dot(geometry.normal, uLightDirection) → the vector
                                points FROM the surface TOWARD the lamp: NGL's
                                `directionalLight.position` convention, no flip.
     mol-canvas3d/passes/postprocessing.js
                                postprocessing.occlusion = the SSAO pass (Mol*'s own
                                default is already 'on'), postprocessing.shadow =
                                the projected-shadow pass (default 'off').
   ========================================================================= */

// ---- The rig itself (NGL numbers, frozen) --------------------------------
export const LIGHT_RIG = Object.freeze({
  // Both lights are pure white: a colour here would tint every element colour.
  keyColor: 0xffffff,
  ambientColor: 0xffffff,
  // Shadows OFF — NGL's even, camera-linked lighting.
  off: Object.freeze({
    lightIntensity: 1.15,
    ambientIntensity: 0.34,
    sampleLevel: 0,
  }),
  // Shadows ON — one fixed key light; Darkness only moves the dark-vs-light
  // contrast: the key gets brighter while the ambient fill gets dimmer, and the
  // fill is floored so the shadow side never goes fully black.
  on: Object.freeze({
    lightIntensity: 1.3,
    lightIntensitySpread: 0.7,      // 1.3 → 2.0
    ambientIntensity: 0.34,
    ambientIntensityDrop: 0.22,     // 0.34 → 0.12
    ambientIntensityFloor: 0.12,
    sampleLevel: 2,
  }),
  // The lamp stands ~100 bounding boxes away → parallel rays (crisp sun).
  lampDistanceInBoundingBoxes: 100,
});

// Darkness is a 0…1 slider; anything else is clamped rather than trusted.
export const clampDarkness = (darkness) => {
  const d = Number(darkness);
  return Number.isFinite(d) ? Math.min(1, Math.max(0, d)) : 0;
};

// Key-light intensity of the current mode (NGL's lightIntensity).
export const keyLightIntensity = (shadowOn, darkness) => (
  shadowOn
    ? LIGHT_RIG.on.lightIntensity + clampDarkness(darkness) * LIGHT_RIG.on.lightIntensitySpread
    : LIGHT_RIG.off.lightIntensity
);

// Ambient fill of the current mode (NGL's ambientIntensity).
export const ambientIntensity = (shadowOn, darkness) => (
  shadowOn
    ? Math.max(
      LIGHT_RIG.on.ambientIntensityFloor,
      LIGHT_RIG.on.ambientIntensity - clampDarkness(darkness) * LIGHT_RIG.on.ambientIntensityDrop,
    )
    : LIGHT_RIG.off.ambientIntensity
);

/* ---- The key-light DIRECTION (the « 💡 Light » sliders) --------------------
   Unit vector FROM the molecule centre TOWARD the key light, in NGL's world
   space: NGL's default camera sits at z = -80 looking along +z, so z < 0 is the
   near (camera) side, x > 0 is screen-left and y > 0 is up. az = 0 puts the lamp
   behind the camera (flat look); turning it swings the shade across the model.
   el = 0 is the horizon, el > 0 lifts the lamp above the model. */
export const nglKeyLightDirection = (az, el) => {
  const azRad = (((Number(az) || 0) * Math.PI) / 180);
  const elRad = (((Number(el) || 0) * Math.PI) / 180);
  const ce = Math.cos(elRad);
  const x = ce * Math.sin(azRad);
  const y = Math.sin(elRad);
  const z = -ce * Math.cos(azRad);
  const inv = 1 / Math.sqrt(x * x + y * y + z * z + 1e-12);
  return { x: x * inv, y: y * inv, z: z * inv };
};

// Camera-linked headlight of the Shadows-OFF mode: NGL parks its directional
// light on the camera, i.e. the lamp direction is the camera position seen from
// the molecule centre. Mol*'s light is world-fixed, so the swapped viewer must
// re-derive this on every camera move to keep that exact look.
export const molstarHeadlightFromCamera = (cameraPosition, center = { x: 0, y: 0, z: 0 }) => {
  const p = cameraPosition || {};
  const x = (Number(p.x) || 0) - (Number(center.x) || 0);
  const y = (Number(p.y) || 0) - (Number(center.y) || 0);
  const z = (Number(p.z) || 0) - (Number(center.z) || 0);
  const inv = 1 / Math.sqrt(x * x + y * y + z * z + 1e-12);
  return molstarSphericalFromDirection({ x: x * inv, y: y * inv, z: z * inv });
};

/* ---- NGL's `stage.setParameters` payload of the current mode --------------
   Byte-for-byte what the viewer applied before this module existed (the unit
   test pins it), so the refactor cannot change the look by a single unit. */
export const nglLightParams = ({ shadowOn = false, darkness = 0 } = {}) => ({
  lightColor: LIGHT_RIG.keyColor,
  ambientColor: LIGHT_RIG.ambientColor,
  lightIntensity: keyLightIntensity(shadowOn, darkness),
  ambientIntensity: ambientIntensity(shadowOn, darkness),
  sampleLevel: sampleLevel(shadowOn),
});

/* ---- Mol* translation ------------------------------------------------------ */

// Mol* speaks spherical coordinates, in DEGREES, for its lamps. Inverse of
// Vec3.directionFromSpherical (mol-math/linear-algebra/3d/vec3.js):
//   dir = (cos az·sin incl, sin az·sin incl, cos incl)  with r = 1
export const molstarSphericalFromDirection = ({ x = 0, y = 0, z = 0 } = {}) => {
  const len = Math.sqrt(x * x + y * y + z * z) || 1;
  const inclination = (Math.acos(Math.min(1, Math.max(-1, z / len))) * 180) / Math.PI;
  const azimuth = ((Math.atan2(y / len, x / len) * 180) / Math.PI + 360) % 360;
  return { inclination, azimuth };
};

// NGL's own default camera (0, 0, -80) looking along +z: the headlight of the
// Shadows-OFF mode therefore points (0, 0, -1) → inclination 180°, azimuth 0°.
// Mol*'s own default is 150° / 320° (a fixed three-quarter light), hence the
// explicit values below: they are what makes the OFF mode look like NGL again.
export const MOLSTAR_HEADLIGHT = Object.freeze(
  molstarSphericalFromDirection({ x: 0, y: 0, z: -1 }),
);

// Supersampling level of the current mode (NGL's stage sampleLevel, -1 … 5).
export const sampleLevel = (shadowOn) => (
  shadowOn ? LIGHT_RIG.on.sampleLevel : LIGHT_RIG.off.sampleLevel
);

/* ---- Supersampling: the same NAME, NOT the same meaning --------------------
   Both engines call it `sampleLevel`, and that is where the resemblance stops.
   Read in mol-canvas3d/passes/multi-sample.js of molstar 4.18.0:

     MultiSampleParams.mode          = PD.Select('temporal', [off, on, temporal])
     MultiSampleParams.sampleLevel   = PD.Numeric(2, 0…5, 'Take level² samples.')
     MultiSampleParams.reduceFlicker = PD.Boolean(true)   // 'temporal' only
     MultiSampleParams.reuseOcclusion= PD.Boolean(true)   // faster, some artefacts
     numSamplesPerFrame              = 2^max(0, sampleLevel − 2)      (line 191)

   • 'temporal' spreads the samples over FRAMES while the camera stands still
     (1 per frame at level 2, i.e. 4 total) and drops the history on the next
     movement: that is what NGL does, and it is the only mode fit for a viewer
     you drag around.
   • 'on' takes the whole set in ONE frame — the still-image mode, and the one
     that multiplies a single frame's cost by the number of samples.
   • 'off' skips the pass.

   Mol*'s default happens to be 'temporal' today, and that is precisely why the
   old one-line translation (« same name, same meaning ») looked right while
   actually saying nothing: a library default is not a decision. Both modes are
   written down here, so the interactive rig keeps 'temporal' even if Mol* ever
   flips its default to 'on'. */
export const MOLSTAR_MULTISAMPLE_INTERACTIVE = Object.freeze({
  mode: 'temporal',
  sampleLevel: LIGHT_RIG.on.sampleLevel,  // the rig's level, shadows on
  reduceFlicker: true,                    // Mol*'s own defaults, pinned
  reuseOcclusion: true,
});

// The still-image counterpart used by the off-screen ray pass: level² samples
// in a single deterministic frame. There is no « next frame » to accumulate, so
// level 3 (9 samples) is affordable; reuseOcclusion is off because it trades
// accuracy for speed and a still image can wait.
export const MOLSTAR_MULTISAMPLE_STILL = Object.freeze({
  mode: 'on',
  sampleLevel: 3,
  reduceFlicker: false,
  reuseOcclusion: false,
});

/* The `multiSample` block of Mol*'s canvas. `still: true` is the ONLY way to
   get 'on' — the interactive path cannot reach the expensive mode by accident. */
export const molstarMultiSampleProps = ({ still = false, sampleLevelOverride = null } = {}) => {
  const base = still ? MOLSTAR_MULTISAMPLE_STILL : MOLSTAR_MULTISAMPLE_INTERACTIVE;
  return {
    ...base,
    sampleLevel: sampleLevelOverride == null ? base.sampleLevel : sampleLevelOverride,
  };
};

/* Ambient occlusion (`postprocessing.occlusion`) — the SSAO pass, i.e. the
   cavity shading PyMOL's ray-traced mode paints inside pockets and grooves.
   The values are Mol*'s OWN defaults (mol-canvas3d/passes/ssao.js), pinned here
   so the look is reproducible and so a panel can expose them later. */
export const MOLSTAR_OCCLUSION_PARAMS = Object.freeze({
  samples: 32,                              // 1 … 256
  multiScale: { name: 'off', params: {} },  // 'on' = coarse-to-fine, slower
  radius: 5,                                // final occlusion radius is 2^5 = 32 px
  bias: 0.8,
  blurKernelSize: 15,
  blurDepthBias: 0.5,
  resolutionScale: 1,
  color: 0x000000,                          // the crevice is darkened toward black
  transparentThreshold: 0.4,
});

/* Projected shadows (`postprocessing.shadow`) — a screen-space depth pass (Mol*
   calls it « simplistic shadows »): the directional shadows asked for. Mol*'s
   own default is steps 1 / maxDistance 3 / tolerance 1.0, i.e. barely a hint of
   contact shading; `pymolRay` walks far enough into the structure to darken a
   real cavity, which is the look wanted here. */
export const MOLSTAR_SHADOW_PRESETS = Object.freeze({
  molstarDefault: Object.freeze({ steps: 1, maxDistance: 3, tolerance: 1 }),
  pymolRay: Object.freeze({ steps: 16, maxDistance: 12, tolerance: 1 }),
  sharp: Object.freeze({ steps: 32, maxDistance: 20, tolerance: 1 }),
});

/* The `renderer` block for Mol*'s canvas: the two light terms of the rig, the
   scene colour and the exposure (pinned to 1 — NGL has no exposure, so any other
   value would change the reference look). */
export const molstarRendererProps = ({
  shadowOn = true,
  darkness = 0,
  az = 0,
  el = 0,
  backgroundColor = null,
  lampDirection = null,
} = {}) => {
  // Shadows ON → the aimed key light; OFF → NGL's camera-linked headlight.
  const spherical = shadowOn
    ? molstarSphericalFromDirection(lampDirection || nglKeyLightDirection(az, el))
    : { ...MOLSTAR_HEADLIGHT };
  const props = {
    light: [{
      inclination: spherical.inclination,
      azimuth: spherical.azimuth,
      color: LIGHT_RIG.keyColor,
      intensity: keyLightIntensity(shadowOn, darkness),
    }],
    ambientColor: LIGHT_RIG.ambientColor,
    ambientIntensity: ambientIntensity(shadowOn, darkness),
    exposure: 1,
  };
  if (backgroundColor != null) props.backgroundColor = hexToInt(backgroundColor);
  return props;
};

/* `postprocessing` block: ambient occlusion ON and projected shadows ON, both
   asked for explicitly (`occlusion.name = 'on'` is Mol*'s mapping key), the
   outline pass OFF (NGL drew none — an outline would change the reference look). */
export const molstarPostprocessingProps = ({
  occlusionOn = true,
  shadowOn = true,
  shadowPreset = 'pymolRay',
  occlusionParams = null,
} = {}) => {
  const preset = MOLSTAR_SHADOW_PRESETS[shadowPreset] || MOLSTAR_SHADOW_PRESETS.pymolRay;
  return {
    occlusion: occlusionOn
      ? { name: 'on', params: { ...MOLSTAR_OCCLUSION_PARAMS, ...(occlusionParams || {}) } }
      : { name: 'off', params: {} },
    shadow: shadowOn
      ? { name: 'on', params: { steps: preset.steps, maxDistance: preset.maxDistance, tolerance: preset.tolerance } }
      : { name: 'off', params: {} },
    outline: { name: 'off', params: {} },
  };
};

/* The whole block to hand to Mol*'s canvas:
     plugin.canvas3d.setProps(molstarCanvasProps({…}))
   — or, exactly as Mol*'s own apps do it (apps/docking-viewer/viewport.js):
     PluginCommands.Canvas3D.SetSettings(plugin, { settings: molstarCanvasProps({…}) })
   which is also how the existing 🌑 Darkness and 💡 Light sliders will drive Mol*.
   `renderer` and `postprocessing` are SIBLING groups of Mol*'s Canvas3DParams
   (postprocessing is NOT nested inside renderer: verified with PD.merge on the
   real Canvas3DParams — the wrong nesting makes postprocessing disappear). */
export const molstarCanvasProps = (options = {}) => {
  const { shadowOn = true, sampleLevelOverride = null } = options;
  return {
    renderer: molstarRendererProps({ shadowOn, ...options }),
    postprocessing: molstarPostprocessingProps({ shadowOn, ...options }),
    // NGL's `sampleLevel` (supersampling while the shadows rig is on, 0 when off)
    // travels into Mol*'s multiSample group, but the two engines agree on the
    // NUMBER only: the mode is written down explicitly here (see
    // MOLSTAR_MULTISAMPLE_INTERACTIVE) instead of being inherited from a library
    // default, so the interactive viewer can never land in 'on' — the mode that
    // pays every sample in a single frame.
    multiSample: molstarMultiSampleProps({
      sampleLevelOverride: sampleLevelOverride == null ? sampleLevel(shadowOn) : sampleLevelOverride,
    }),
  };
};

/* ---- Small colour helpers ------------------------------------------------- */
// '#f8fafc' / '#fff' / 0xf8fafc → 0xf8fafc (what PD.Color normalizes to).
export const hexToInt = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value >>> 0;
  const s = String(value == null ? '' : value).trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    return parseInt(s.split('').map((c) => c + c).join(''), 16) >>> 0;
  }
  if (/^[0-9a-fA-F]{6}$/.test(s)) return parseInt(s, 16) >>> 0;
  return 0xffffff;
};
