/* =========================================================================
src/utils/viewerRayShadows.js
CAST SHADOWS for the « ✨ Ray » still.
========================================================================= */
export const RAY_SHADOW_MAX_PIXELS = 20e6;
export const RAY_SHADOW_DEFAULTS = Object.freeze({
  strength: 0.55,
  softness: 1.6,
  maskMaxWidth: 1400,
  bias: 0.35,
  sphereScale: 1,
  maxAtoms: 300000,
  fitMargin: 1.06,
  pcfTaps: 8,
  penumbra: 1.5,
  penumbraMax: 8,
  blur: 1,
});
export const SHADOW_TAPS_PER_PIXEL = 2.5;
export const SHADOW_MAX_TAPS = 64;
export const SHADOW_BLUR_REF = 20;
export const SHADOW_BLUR_MIN = 0.25;
export const SHADOW_BLUR_STROKE_FRACTION = 0.6;
export const SHADOW_AMBIENT_FAR_RADIUS_ANGSTROM = 4.0;
export const SHADOW_AMBIENT_FAR_WEIGHT = 0.85;
export const SHADOW_AMBIENT_FAR_RADIUS_PX_FALLBACK = 24;
export const SHADOW_AMBIENT_NEAR_RADIUS_FRACTION = 2.4;
export const SHADOW_AMBIENT_NEAR_WEIGHT = 0.85;
export const SHADOW_AMBIENT_NEAR_RADIUS_PX_FALLBACK = 8;
export const INVISIBLE_OPACITY = 0.02;
export const PROXY_STROKE_BY_TYPE = Object.freeze({
  sphere: { kind: 'vdw', min: 0.12 },
  spacefill: { kind: 'vdw', min: 0.12 },
  surface: { kind: 'vdw', min: 0.12 },
  'ball+stick': { kind: 'ball', core: 0.15, aspect: 2, min: 0.2 },
  ballstick: { kind: 'ball', core: 0.15, aspect: 2, min: 0.2 },
  hyperball: { kind: 'ball', core: 0.15, aspect: 2, min: 0.2 },
  licorice: { kind: 'bond', core: 0.25, min: 0.2 },
  base: { kind: 'bond', core: 0.3, min: 0.2 },
  backbone: { kind: 'bond', core: 0.15, min: 0.2 },
  line: { kind: 'hair', min: 0.15 },
  wireframe: { kind: 'hair', min: 0.15 },
  cartoon: { kind: 'spline', base: 0.45, scale: 0.7, min: 0.3 },
  ribbon: { kind: 'spline', base: 0.45, scale: 4, min: 0.3 },
  tube: { kind: 'tube', base: 0.5, min: 0.2 },
  rope: { kind: 'spline', base: 0.3, scale: 1, min: 0.2 },
  trace: { kind: 'spline', base: 0.35, scale: 1, min: 0.2 },
});
export const LINKED_KINDS = Object.freeze({ spline: 1, tube: 1, bond: 1, ball: 1 });
export const BACKBONE_ONLY_KINDS = Object.freeze({ spline: 1, tube: 1 });
export const FLAT_STROKE_BY_TYPE = Object.freeze({ cartoon: 1, ribbon: 1 });
export const BAND_MAX_ACROSS = 6;
export const BAND_MAX_ALONG = 8;
export const BAND_MAX_PROXIES = 60000;
const BAND_MIN_THICKNESS = 0.15;
const BAND_TAPER = 1.6;
const LINK_STEP_MIN = 0.3;
const LINK_MAX = 4.2;

// ============================================================================
// 1. MATH UTILITIES
// ============================================================================
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
export const mat4TransformPoint = (m, p, out = new Array(4)) => {
  out[0] = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  out[1] = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  out[2] = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
  out[3] = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return out;
};
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
export const viewAxesOf = (view) => ({
  right: [view[0], view[4], view[8]],
  up: [view[1], view[5], view[9]],
  back: [view[2], view[6], view[10]],
});
export const mat4Identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export const mat4LookAt = (eye, target, up) => {
  const zAxis = normalize3(sub3(eye, target));
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
export const boundsOf = (positions, count) => {
  const n = Math.max(0, Math.min(count || positions.length / 3, positions.length / 3));
  if (!n) return { center: [0, 0, 0], radius: 1 };
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const center = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const radius = Math.max(1e-3, 0.5 * Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2 + (maxZ - minZ) ** 2));
  return { center, radius };
};
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

// ============================================================================
// 2. RASTERIZATION & SHADOW TESTING
// ============================================================================
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
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const r = Math.max(0.1, (radii ? radii[i] : 1.7) * radiusScale);
    const c = clipToScreen(mat4TransformPoint(clip, [x, y, z], clipPt), w, h, scr);
    if (!c) continue;
    let rad = 1;
    const edge = clipToScreen(mat4TransformPoint(clip, [
      x + axisUp[0] * r, y + axisUp[1] * r, z + axisUp[2] * r,
    ], clipPt), w, h, scrEdge);
    if (edge) {
      const dx = scrEdge[0] - c[0], dy = scrEdge[1] - c[1];
      rad = Math.sqrt(dx * dx + dy * dy);
    }
    rad = Math.max(1, Math.min(rad, maxRadius));
    const cx = c[0], cy = c[1], cz = c[2];
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
export const pcfRotationOf = (x, y) => {
  const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return (h - Math.floor(h)) * Math.PI * 2;
};
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
  let shadowed = 0, penumbraRadius = 0, maxTaps = 0;
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
      const met = nearest < 2;
      const gap = met ? p[2] - nearest : 0;
      const footprint = reach ? Math.max(0, Number(reach[idx]) || 0) : 0;
      const grown = base > 0
        ? Math.min(cap, base + (gap > 0 ? grow * gap * perAngstrom : 0))
        : 0;
      const radius = footprint + grown;
      if (!(radius > 0)) {
        if (met && p[2] > nearest + biasNdc) {
          mask[idx] = 1;
          shadowed += 1;
        }
        continue;
      }
      if (radius > penumbraRadius) penumbraRadius = radius;
      const need = Math.min(SHADOW_MAX_TAPS, Math.max(discTaps, Math.ceil(radius * SHADOW_TAPS_PER_PIXEL)));
      const disc = discOf(need);
      const invTaps = 1 / need;
      if (need > maxTaps) maxTaps = need;
      const rot = pcfRotationOf(x, y);
      const cs = Math.cos(rot), sn = Math.sin(rot);
      let occluded = 0;
      for (let t = 0; t < disc.length; t += 2) {
        const ox = disc[t] * radius, oy = disc[t + 1] * radius;
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
    mask: softenMask(mask, w, h, base), width: w, height: h, shadowed,
    taps: discTaps, tapsMax: maxTaps, penumbraRadius,
  };
};
export const sampleMaskBilinear = (mask, mw, mh, nx, ny) => {
  const width = Math.max(1, Math.round(mw));
  const height = Math.max(1, Math.round(mh));
  const mx = Math.min(width - 1, Math.max(0, nx * width - 0.5));
  const my = Math.min(height - 1, Math.max(0, ny * height - 0.5));
  const x0 = Math.floor(mx), y0 = Math.floor(my);
  const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const fx = mx - x0, fy = my - y0;
  const a = mask[y0 * width + x0], b = mask[y0 * width + x1];
  const c = mask[y1 * width + x0], d = mask[y1 * width + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
};
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
      data[i] = r; data[i + 1] = g; data[i + 2] = b;
      touched += 1;
    }
  }
  return touched;
};

// ============================================================================
// 3. LIGHT RIG & SCENE PARSING
// ============================================================================
export const lightDepthScale = ({ distance, radius, near, far } = {}) => {
  const n = Number.isFinite(Number(near)) ? Number(near) : 0.01;
  const f = Number.isFinite(Number(far)) ? Number(far) : Math.max(0.02, Number(distance) * 2 + Number(radius) * 2);
  return 2 / Math.max(1e-6, f - n);
};
export const shadowRigOf = ({
  dir, bounds = null, center = [0, 0, 0], radius = 1, distance = null,
  margin = RAY_SHADOW_DEFAULTS.fitMargin,
} = {}) => {
  const z = normalize3(dir || [0, 0, 1]);
  const box = bounds && bounds.min && bounds.max ? bounds : null;
  const c = box
    ? [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2]
    : [Number(center[0]) || 0, Number(center[1]) || 0, Number(center[2]) || 0];
  const r = Math.max(1e-3, Number(radius) || 1);
  const d = Math.max(1e-3, Number.isFinite(Number(distance)) ? Number(distance) : r * 100);
  const eye = [c[0] + z[0] * d, c[1] + z[1] * d, c[2] + z[2] * d];
  const up = Math.abs(z[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const view = mat4LookAt(eye, c, up);
  const corners = box
    ? boxCornersOf(box)
    : boxCornersOf({ min: [c[0] - r, c[1] - r, c[2] - r], max: [c[0] + r, c[1] + r, c[2] + r] });
  let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
  let near = Infinity, far = -Infinity;
  const p = new Array(4);
  for (let i = 0; i < 8; i += 1) {
    const v = mat4TransformPoint(view, corners[i], p);
    if (v[0] < left) left = v[0]; if (v[0] > right) right = v[0];
    if (v[1] < bottom) bottom = v[1]; if (v[1] > top) top = v[1];
    const depth = -v[2];
    if (depth < near) near = depth; if (depth > far) far = depth;
  }
  if (!(right > left)) right = left + 1e-3;
  if (!(top > bottom)) top = bottom + 1e-3;
  const m = Math.min(2, Math.max(1, Number(margin) || 1));
  const spanMax = Math.max(right - left, top - bottom, far - near, 1e-3);
  const padFloor = spanMax * 0.02;
  const padX = Math.max(padFloor, ((right - left) * (m - 1)) / 2);
  const padY = Math.max(padFloor, ((top - bottom) * (m - 1)) / 2);
  const padZ = Math.max(padFloor, (padX + padY) / 2);
  const nz = Math.max(1e-3, near - padZ);
  const fz = Math.max(nz + 1e-3, far + padZ);
  const l = left - padX, rt = right + padX, bt = bottom - padY, tp = top + padY;
  const proj = mat4Orthographic(l, rt, bt, tp, nz, fz);
  return {
    view, proj, clip: mat4Multiply(proj, view),
    left: l, right: rt, bottom: bt, top: tp, near: nz, far: fz,
    width: rt - l, height: tp - bt, depthScale: 2 / (fz - nz),
    center: c, radius: r, distance: d, margin: m,
  };
};
export const lightMatricesOf = (setup) => shadowRigOf(setup);
export const lightClipMatrix = (setup) => lightMatricesOf(setup).clip;
const elements16Of = (matrix) => {
  const e = matrix && matrix.elements ? matrix.elements : matrix;
  if (!e || typeof e.length !== 'number' || e.length !== 16) return null;
  return Array.from(e);
};
export const viewerMatrixOf = (stage) => {
  const viewer = stage && stage.viewer;
  if (!viewer) return null;
  const rot = elements16Of(viewer.rotationGroup && viewer.rotationGroup.matrix);
  const pos = viewer.translationGroup && viewer.translationGroup.position;
  const tx = pos ? Number(pos.x) || 0 : 0;
  const ty = pos ? Number(pos.y) || 0 : 0;
  const tz = pos ? Number(pos.z) || 0 : 0;
  if (!rot && !tx && !ty && !tz) return null;
  const t = mat4Identity();
  t[12] = tx; t[13] = ty; t[14] = tz;
  return rot ? mat4Multiply(rot, t) : t;
};
const drawnAtomIndicesOf = (comp, atomCount) => {
  const list = comp && comp.reprList;
  if (!Array.isArray(list)) return null;
  const set = new Set();
  list.forEach((el) => {
    try {
      const rep = (el && (el.repr || el)) || null;
      if (!rep || rep.visible === false) return;
      if (opacityOf(rep, el) <= INVISIBLE_OPACITY) return;
      const sv = rep.structureView;
      if (!sv || typeof sv.getAtomIndices !== 'function') return;
      const idx = sv.getAtomIndices();
      if (!idx || !idx.length) return;
      for (let i = 0; i < idx.length; i += 1) set.add(idx[i]);
    } catch { }
  });
  if (set.size && atomCount && set.size >= atomCount) return null;
  return [...set].sort((a, b) => a - b);
};
export const repTypeOf = (rep, el = null) => {
  let fromEl = '';
  if (el) {
    fromEl = el.name || (typeof el.getType === 'function' ? el.getType() : '');
  }
  const raw = (rep && rep.type) || fromEl || (rep && rep.parameters && rep.parameters.type) || '';
  return String(raw).toLowerCase();
};
export const repKindOf = (rep, el = null) => {
  const stroke = PROXY_STROKE_BY_TYPE[repTypeOf(rep, el)];
  return stroke ? stroke.kind : '';
};
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
export const proxyRadiusOf = (rep, vdwRadius = 1.7, el = null) => {
  const stroke = PROXY_STROKE_BY_TYPE[repTypeOf(rep, el)];
  if (!stroke) return null;
  const vdw = Math.max(0.1, Number(vdwRadius) || 1.7);
  const radiusScale = repNumber(rep, el, 'radiusScale', 'sphereScale', 'scale');
  const radiusSize = repNumber(rep, el, 'radiusSize', 'radius');
  const aspect = repNumber(rep, el, 'aspectRatio');
  const radiusType = String((rep && rep.radiusType) || '').toLowerCase();
  const sizeType = radiusType === '' || radiusType === 'size';
  const core = (fallback) => {
    if (radiusSize > 0 && (sizeType || radiusScale <= 0)) return radiusSize;
    if (radiusScale > 0) return vdw * radiusScale;
    return fallback;
  };
  let r;
  switch (stroke.kind) {
    case 'vdw': r = core(vdw); break;
    case 'ball': r = core(stroke.core) * (aspect || stroke.aspect); break;
    case 'bond': r = core(stroke.core); break;
    case 'spline':
      r = radiusScale > 0 ? stroke.base * (radiusScale / stroke.scale) : stroke.base;
      if (radiusSize > 0 && sizeType) r = Math.max(r, radiusSize);
      break;
    case 'tube':
      r = sizeType && radiusSize > 0 ? radiusSize : (radiusScale > 0 ? stroke.base * radiusScale : stroke.base);
      break;
    default: r = stroke.min;
  }
  return Math.max(0.05, Math.max(stroke.min, r));
};
const atomProxyOf = (structure) => {
  try {
    if (!structure || typeof structure.getAtomProxy !== 'function') return null;
    const ap = structure.getAtomProxy();
    return ap && typeof ap.isBackbone === 'function' ? ap : null;
  } catch { return null; }
};
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
export const drawnProxyRadiiOf = (comp, atomCount, vdw = null, links = null) => {
  const list = comp && comp.reprList;
  if (!Array.isArray(list)) return null;
  const out = new Float32Array(Math.max(0, Math.round(Number(atomCount) || 0)));
  if (!out.length) return out;
  out.fill(NaN);
  const ap = atomProxyOf(comp && comp.structure);
  list.forEach((el) => {
    try {
      const rep = (el && (el.repr || el)) || null;
      if (!rep || rep.visible === false) return;
      const op = opacityOf(rep, el);
      if (op <= INVISIBLE_OPACITY) return;
      const sv = rep.structureView;
      if (!sv || typeof sv.getAtomIndices !== 'function') return;
      const idx = sv.getAtomIndices();
      if (!idx || !idx.length) return;
      const kind = repKindOf(rep, el);
      const linked = LINKED_KINDS[kind] === 1;
      const chainOnly = BACKBONE_ONLY_KINDS[kind] === 1 && drawsBackboneOf(ap, idx);
      for (let i = 0; i < idx.length; i += 1) {
        const a = idx[i];
        if (!(a >= 0 && a < out.length)) continue;
        if (chainOnly) {
          ap.index = a;
          if (!ap.isBackbone()) continue;
        }
        const per = proxyRadiusOf(rep, vdw ? vdw[a] : 1.7, el);
        if (per == null) continue;
        const seen = op < 1 ? per * op : per;
        if (!(out[a] >= seen)) out[a] = seen;
        if (linked && links) links[a] = 1;
      }
    } catch { }
  });
  return out;
};
export const opacityOf = (rep, el = null) => {
  const sources = [rep, el && el.parameters, rep && rep.parameters];
  for (let s = 0; s < sources.length; s += 1) {
    const source = sources[s];
    if (!source) continue;
    const v = Number(source.opacity);
    if (Number.isFinite(v)) return Math.min(1, Math.max(0, v));
  }
  return 1;
};
const geometryOfRep = (rep) => {
  const list = rep && rep.bufferList;
  if (!Array.isArray(list)) return null;
  for (let i = 0; i < list.length; i += 1) {
    const g = list[i] && list[i].geometry;
    const arr = g && g.attributes && g.attributes.position && g.attributes.position.array;
    if (arr && arr.length >= 12) return g;
  }
  return null;
};
export const bandSectionsOf = (rep, el = null) => {
  const kind = repTypeOf(rep, el);
  if (!FLAT_STROKE_BY_TYPE[kind]) return null;
  const geo = geometryOfRep(rep);
  if (!geo) return null;
  const A = geo.attributes;
  const pos = A.position && A.position.array;
  if (!pos) return null;
  
  // Both cartoon and ribbon use 12 floats per segment (4 vertices × 3 coords)
  const stride = 12;
  if (pos.length % stride !== 0) return null;
  const points = pos.length / stride;
  if (points < 2) return null;
  
  const sizeArr = A.size && A.size.array;
  const dirArr = A.dir && A.dir.array;
  const norArr = A.normal && A.normal.array;
  const aspect = repNumber(rep, el, 'aspectRatio') || 5;
  
  const sub = (arr, i) => [arr[i], arr[i + 1], arr[i + 2]];
  const sections = [];
  
  // Sample every 3rd section to reduce density
  const sampleRate = Math.max(1, Math.floor(points / 200));
  
  for (let v = 0; v < points; v += sampleRate) {
    const p = sub(pos, v * stride);
    
    // Use a reasonable default size for cartoon
    let s = 0.8;
    if (sizeArr) {
      const sizeIdx = v * 4;
      if (sizeArr[sizeIdx] != null && sizeArr[sizeIdx] > 0) {
        s = Number(sizeArr[sizeIdx]);
      }
    }
    if (!(s > 0)) s = 0.8;
    
    // Direction from neighbors
    let d = dirArr && dirArr.length >= points * stride 
      ? normalize3(sub(dirArr, v * stride)) 
      : null;
    if (!d || !(length3(d) > 0.5)) {
      const next = sub(pos, Math.min(points - 1, v + sampleRate) * stride);
      const prev = sub(pos, Math.max(0, v - sampleRate) * stride);
      const t = normalize3(sub3(next, prev));
      const n = norArr && norArr.length >= points * stride 
        ? normalize3(sub(norArr, v * stride)) 
        : null;
      d = n ? normalize3(cross3(n, t)) : t;
      if (!d || !(length3(d) > 0.5)) d = [0, 0, 1];
    }
    
    const w = kind === 'ribbon' ? s : s * aspect;
    const t = Math.max(0.5, kind === 'ribbon' ? Math.min(0.5, w * 0.3) : s * 0.4);
    sections.push({ p, d, w, t });
  }
  
  return sections.length >= 2 ? sections : null;
};

const bandBrushOf = (sections, opacity = 1) => {
  const outPositions = [], outRadii = [];
  const push = (x, y, z, r) => { 
    if (outRadii.length >= BAND_MAX_PROXIES) return;
    outPositions.push(x, y, z); 
    outRadii.push(r); 
  };
  
  for (let v = 0; v + 1 < sections.length; v += 1) {
    if (outRadii.length >= BAND_MAX_PROXIES) break;
    const a = sections[v], b = sections[v + 1];
    const dx = b.p[0] - a.p[0], dy = b.p[1] - a.p[1], dz = b.p[2] - a.p[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(len > 0) || !(len <= LINK_MAX * 3)) continue;
    
    // Use larger minimum thickness for better shadow coverage
    const r0 = Math.max(0.5, Math.min(a.t, b.t), len * 0.05);
    
    // Target ~70% overlap between spheres
    const stepTarget = r0 * 0.6;
    const along = Math.min(BAND_MAX_ALONG, Math.max(1, Math.ceil(len / stepTarget)));
    
    for (let i = 0; i <= along; i += 1) {
      if (outRadii.length >= BAND_MAX_PROXIES) break;
      const u = i / (along + 1);
      const px = a.p[0] + dx * u, py = a.p[1] + dy * u, pz = a.p[2] + dz * u;
      const dir = normalize3([
        a.d[0] + (b.d[0] - a.d[0]) * u,
        a.d[1] + (b.d[1] - a.d[1]) * u,
        a.d[2] + (b.d[2] - a.d[2]) * u,
      ]);
      const half = a.w + (b.w - a.w) * u;
      if (!(half > 0) || !(length3(dir) > 0.5)) continue;
      
      const across = Math.min(BAND_MAX_ACROSS, Math.max(1, Math.ceil((2 * half) / stepTarget)));
      const step = (2 * half) / across;
      const r = Math.max(r0, step * 0.8);
      
      for (let j = 0; j < across; j += 1) {
        if (outRadii.length >= BAND_MAX_PROXIES) break;
        const off = -half + (j + 0.5) * step;
        push(px + dir[0] * off, py + dir[1] * off, pz + dir[2] * off, r);
      }
    }
  }
  
  const count = outRadii.length;
  const positions = new Float32Array(outPositions);
  const radii = new Float32Array(outRadii);
  if (opacity < 1) for (let i = 0; i < count; i += 1) radii[i] *= opacity;
  return { positions, radii, count };
};
export const bandProxiesOf = (comp) => {
  const empty = { positions: new Float32Array(0), radii: new Float32Array(0), count: 0, reps: 0, debug: '' };
  const list = comp && comp.reprList;
  if (!Array.isArray(list)) return { ...empty, debug: 'no reprList' };
  const brushes = [];
  let total = 0;
  let debug = '';
  let foundFlat = false;
  list.forEach((el) => {
    try {
      const rep = (el && (el.repr || el)) || null;
      if (!rep || rep.visible === false) return;
      const kind = repTypeOf(rep, el);
      if (!FLAT_STROKE_BY_TYPE[kind]) return;
      foundFlat = true;
      const op = opacityOf(rep, el);
      if (op <= INVISIBLE_OPACITY) { if (!debug) debug = `type '${kind}' transparent`; return; }
      const geo = geometryOfRep(rep);
      if (!geo) { if (!debug) debug = `type '${kind}' has no geometry buffer`; return; }
      const sections = bandSectionsOf(rep, el);
      if (!sections) { if (!debug) debug = `type '${kind}' sections failed`; return; }
      const brush = bandBrushOf(sections, op);
      if (!brush.count) { if (!debug) debug = `type '${kind}' brush empty`; return; }
      brushes.push(brush);
      total += brush.count;
      debug = '';
    } catch (e) { if (!debug) debug = `error: ${e.message}`; }
  });
  if (!foundFlat && !debug) debug = 'no flat representations found';
  if (!brushes.length) return { ...empty, debug };
  const positions = new Float32Array(total * 3);
  const radii = new Float32Array(total);
  let at = 0;
  brushes.forEach((b) => {
    positions.set(b.positions, at * 3);
    radii.set(b.radii, at);
    at += b.count;
  });
  return { positions, radii, count: total, reps: brushes.length, debug: '' };
};
const linkStepOf = (ra, rb) => Math.max(LINK_STEP_MIN, 0.5 * Math.min(ra, rb));
const drawnBondsOf = (structure, links, n) => {
  if (!structure || typeof structure.eachBond !== 'function') return [];
  let linked = false;
  for (let i = 0; i < n && !linked; i += 1) linked = links[i] === 1;
  if (!linked) return [];
  const out = [];
  const seen = new Set();
  const addBond = (a, b) => {
    if (!(a >= 0 && a < n && b >= 0 && b < n) || a === b) return;
    if (links[a] !== 1 || links[b] !== 1) return;
    const key = a < b ? a * n + b : b * n + a;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(a, b);
  };
  try {
    structure.eachBond((bond) => { addBond(bond.atomIndex1, bond.atomIndex2); });
  } catch { }
  if (out.length === 0) {
    try {
      if (typeof structure.eachPolymer === 'function') {
        structure.eachPolymer((p) => {
          let prevTrace = -1;
          p.eachResidue((r) => {
            const trace = r.traceAtomIndex;
            if (trace !== undefined && trace >= 0) {
              if (prevTrace >= 0) addBond(prevTrace, trace);
              prevTrace = trace;
            }
          });
        });
      }
    } catch { }
  }
  return out;
};
const layOut = (part, stride) => {
  const slotOf = new Map();
  const own = elements16Of(part.comp.matrix);
  const m = own
    ? (part.viewerM ? mat4Multiply(part.viewerM, own) : own)
    : elements16Of(part.comp.group && part.comp.group.matrixWorld);
  const pos = part.data.position, rad = part.data.radius;
  const surface = part.surface, links = part.links;
  const bandIn = part.bands && part.bands.count ? part.bands : null;
  let band = null;
  if (bandIn) {
    const bp = new Float32Array(bandIn.count * 3);
    const br = new Float32Array(bandIn.count);
    for (let i = 0; i < bandIn.count; i += 1) {
      const x = bandIn.positions[i * 3], y = bandIn.positions[i * 3 + 1], z = bandIn.positions[i * 3 + 2];
      if (m) {
        bp[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
        bp[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        bp[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      } else {
        bp[i * 3] = x; bp[i * 3 + 1] = y; bp[i * 3 + 2] = z;
      }
      br[i] = bandIn.radii[i];
    }
    band = { positions: bp, radii: br, count: bandIn.count };
  }
  let measurable = false;
  if (surface) {
    for (let i = 0; i < surface.length && !measurable; i += 1) {
      measurable = Number.isFinite(surface[i]) && surface[i] > 0;
    }
  }
  const count = part.drawn ? part.drawn.length : part.n;
  const len = Math.max(0, Math.ceil(count / stride));
  const wpos = new Float32Array(Math.max(1, len) * 3);
  const wrad = new Float32Array(Math.max(1, len));
  const wlink = new Uint8Array(Math.max(1, len));
  let e = 0;
  for (let c = 0; c < count && e < len; c += stride) {
    const i = part.drawn ? part.drawn[c] : c;
    if (!(i >= 0 && i < part.n)) continue;
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (m) {
      wpos[e * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
      wpos[e * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      wpos[e * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    } else {
      wpos[e * 3] = x; wpos[e * 3 + 1] = y; wpos[e * 3 + 2] = z;
    }
    const vdw = rad && Number.isFinite(rad[i]) ? rad[i] : 1.7;
    const stroke = surface ? surface[i] : NaN;
    if (surface && measurable && !(Number.isFinite(stroke) && stroke > 0)) continue;
    const drawn = Number.isFinite(stroke) && stroke > 0;
    wrad[e] = drawn ? stroke : vdw;
    wlink[e] = drawn && links && links[i] === 1 ? 1 : 0;
    slotOf.set(i, e);
    e += 1;
  }
  const maxPairs = part.bonds ? part.bonds.length / 2 : 0;
  const edges = new Int32Array(Math.max(0, maxPairs) * 2);
  let p = 0;
  if (part.bonds) {
    for (let b = 0; b + 1 < part.bonds.length; b += 2) {
      const sa = slotOf.get(part.bonds[b]);
      const sb = slotOf.get(part.bonds[b + 1]);
      if (sa === undefined || sb === undefined) continue;
      edges[p] = sa; edges[p + 1] = sb;
      p += 2;
    }
  }
  return {
    wpos, wrad, wlink, len: e,
    edges: p === edges.length ? edges : edges.subarray(0, p),
    fills: new Int32Array(Math.max(1, p / 2)),
    band,
    bandDebug: part.bandDebug || '',
  };
};
const countFills = (lay, scale) => {
  const edges = lay.edges;
  let cost = 0;
  for (let k = 0; k + 1 < edges.length; k += 2) {
    const a = edges[k], b = edges[k + 1];
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
const fillDrawnLinks = (parts, stride, maxAtoms) => {
  const layouts = parts.map((part) => layOut(part, stride));
  const slotsOf = (list) => list.reduce((a, lay) => a + lay.len + (lay.band ? lay.band.count : 0), 0);
  let slots = slotsOf(layouts);
  if (slots > maxAtoms) {
    layouts.forEach((lay) => { lay.band = null; });
    slots = slotsOf(layouts);
  }
  let scale = 1;
  let cost = layouts.reduce((a, lay) => a + countFills(lay, scale), 0);
  if (cost > 0 && slots + cost > maxAtoms) {
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
    for (let e = 0; e < lay.len && k < capacity; e += 1) {
      out[k * 3] = lay.wpos[e * 3];
      out[k * 3 + 1] = lay.wpos[e * 3 + 1];
      out[k * 3 + 2] = lay.wpos[e * 3 + 2];
      radii[k] = lay.wrad[e];
      k += 1;
    }
    const edges = lay.edges;
    for (let p = 0; p + 1 < edges.length && k < capacity; p += 2) {
      const fills = lay.fills[p / 2];
      if (!fills) continue;
      const a = edges[p], b = edges[p + 1];
      const ax = lay.wpos[a * 3], ay = lay.wpos[a * 3 + 1], az = lay.wpos[a * 3 + 2];
      const bx = lay.wpos[b * 3], by = lay.wpos[b * 3 + 1], bz = lay.wpos[b * 3 + 2];
      const ra = lay.wrad[a], rb = lay.wrad[b];
      for (let f = 1; f <= fills && k < capacity; f += 1) {
        const u = f / (fills + 1);
        out[k * 3] = ax + (bx - ax) * u;
        out[k * 3 + 1] = ay + (by - ay) * u;
        out[k * 3 + 2] = az + (bz - az) * u;
        radii[k] = ra + (rb - ra) * u;
        k += 1;
      }
    }
    if (lay.band) {
      for (let i = 0; i < lay.band.count && k < capacity; i += 1) {
        out[k * 3] = lay.band.positions[i * 3];
        out[k * 3 + 1] = lay.band.positions[i * 3 + 1];
        out[k * 3 + 2] = lay.band.positions[i * 3 + 2];
        radii[k] = lay.band.radii[i];
        k += 1;
      }
    }
  });
  let bandDebug = '';
  layouts.forEach((lay) => {
    if (lay.bandDebug && !bandDebug) bandDebug = lay.bandDebug;
  });
  return {
    positions: out, radii, count: k, filled: cost,
    bands: layouts.reduce((a, lay) => a + (lay.band ? lay.band.count : 0), 0),
    bandDebug,
  };
};
export const atomsFromStage = (stage, maxAtoms = RAY_SHADOW_DEFAULTS.maxAtoms) => {
  const comps = (stage && stage.compList) || [];
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
      if (drawn && !drawn.length) return;
      const links = new Uint8Array(n);
      const surface = drawnProxyRadiiOf(comp, n, data.radius, links);
      const bands = bandProxiesOf(comp);
      const bonds = drawnBondsOf(structure, links, n);
      parts.push({ comp, data, n, drawn, surface, links, viewerM, bonds, bands, bandDebug: bands.debug });
      total += drawn ? drawn.length : n;
    } catch { }
  });
  const stride = total > maxAtoms ? Math.ceil(total / maxAtoms) : 1;
  return { ...fillDrawnLinks(parts, stride, maxAtoms), stride, total };
};
export const cameraFromViewer = (viewer) => {
  const cam = (viewer && (viewer.camera || viewer.perspectiveCamera || viewer.orthographicCamera)) || null;
  const viewOffset = cam && cam.view;
  if (viewOffset && viewOffset.enabled === true) {
    throw new Error('the camera is inside a tile of a ✨ Ray still (setViewOffset) — read it before the render');
  }
  const proj = cam ? elements16Of(cam.projectionMatrix) : null;
  const view = cam ? elements16Of(cam.matrixWorldInverse) : null;
  if (!proj || !view) throw new Error('the viewer has no camera to cast a shadow from');
  return { projection: proj, view, clip: mat4Multiply(proj, view), type: (cam && cam.type) || 'Camera' };
};
export const rayShadowInputsOf = (stage, { lightDir = [0, 0, 1], options = {} } = {}) => {
  const o = rayShadowOptions(options);
  const viewer = stage && stage.viewer;
  const atoms = atomsFromStage(stage, o.maxAtoms);
  if (!atoms.count) throw new Error('no atoms to cast a shadow from');
  const camera = cameraFromViewer(viewer);
  const { center, radius } = boundsOf(atoms.positions, atoms.count);
  const bounds = boundsBoxOf(atoms.positions, atoms.count);
  const dir = normalize3(lightDir);
  const distance = radius * 100;
  const light = {
    dir, center, radius, distance, bounds,
    ...shadowRigOf({ dir, bounds, center, radius, distance, margin: o.fitMargin }),
  };
  return { atoms, camera, light, options: o };
};

// ============================================================================
// 4. OPTIONS, BLUR SCALING & DOM INTEGRATION
// ============================================================================
export const rayShadowOptions = (options = {}) => {
  const d = RAY_SHADOW_DEFAULTS;
  const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  const span = (v, fallback, lo, hi) => Math.min(hi, Math.max(lo, num(v, fallback)));
  const blur = span(options.blur, d.blur, 0, 4);
  const soft = (v, fallback) => (v == null ? fallback * blur : num(v, fallback * blur));
  return {
    strength: span(options.strength, d.strength, 0, 1),
    softness: Math.max(0, soft(options.softness, d.softness)),
    maskMaxWidth: Math.max(64, Math.round(num(options.maskMaxWidth, d.maskMaxWidth))),
    bias: num(options.bias, d.bias),
    sphereScale: Math.max(0.1, num(options.sphereScale, d.sphereScale)),
    maxAtoms: Math.max(1, Math.round(num(options.maxAtoms, d.maxAtoms))),
    fitMargin: span(options.fitMargin, d.fitMargin, 1, 2),
    pcfTaps: span(Math.round(num(options.pcfTaps, d.pcfTaps)), d.pcfTaps, 1, 32),
    penumbra: Math.max(0, soft(options.penumbra, d.penumbra)),
    penumbraMax: Math.max(0, soft(options.penumbraMax, d.penumbraMax)),
    blur,
  };
};
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
export const shadowBlurScale = (pxPerAngstrom, minStrokeRadius) => {
  const px = Number(pxPerAngstrom);
  const base = (!Number.isFinite(px) || px <= 0) ? 1 : Math.min(1, Math.max(SHADOW_BLUR_MIN, px / SHADOW_BLUR_REF));
  const r = Number(minStrokeRadius);
  if (!(r > 0) || !(px > 0)) return base;
  const refPx = (RAY_SHADOW_DEFAULTS.softness + RAY_SHADOW_DEFAULTS.penumbraMax) * base;
  if (!(refPx > 0)) return base;
  const capPx = r * SHADOW_BLUR_STROKE_FRACTION * px;
  return base * Math.min(1, capPx / refPx);
};
const minStrokeRadiusOf = (atoms) => {
  const radii = atoms && atoms.radii;
  const n = Math.max(0, Math.min(Number(atoms && atoms.count) || 0, radii ? radii.length : 0));
  let min = Infinity;
  for (let i = 0; i < n; i += 1) {
    const v = radii[i];
    if (v > 0 && v < min) min = v;
  }
  return Number.isFinite(min) ? min : 0;
};
export const maskScalePerAngstrom = ({ clip, view, bounds, width, height } = {}) => {
  if (!clip || !view) return 0;
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const corners = boxCornersOf(bounds);
  let pxMinX = Infinity, pxMaxX = -Infinity, pxMinY = Infinity, pxMaxY = -Infinity;
  let vMinX = Infinity, vMaxX = -Infinity, vMinY = Infinity, vMaxY = -Infinity;
  let seen = 0;
  for (let i = 0; i < 8; i += 1) {
    const c = corners[i];
    const world = [c[0], c[1], c[2], 1];
    const v = mat4TransformPoint(view, world);
    if (v[0] < vMinX) vMinX = v[0]; if (v[0] > vMaxX) vMaxX = v[0];
    if (v[1] < vMinY) vMinY = v[1]; if (v[1] > vMaxY) vMaxY = v[1];
    const s = clipToScreen(mat4TransformPoint(clip, world), w, h);
    if (!s) continue;
    if (s[0] < pxMinX) pxMinX = s[0]; if (s[0] > pxMaxX) pxMaxX = s[0];
    if (s[1] < pxMinY) pxMinY = s[1]; if (s[1] > pxMaxY) pxMaxY = s[1];
    seen += 1;
  }
  if (seen < 2) return 0;
  const sx = vMaxX - vMinX > 1e-6 ? (pxMaxX - pxMinX) / (vMaxX - vMinX) : Infinity;
  const sy = vMaxY - vMinY > 1e-6 ? (pxMaxY - pxMinY) / (vMaxY - vMinY) : Infinity;
  const scale = Math.min(sx, sy);
  return Number.isFinite(scale) && scale > 0 ? scale : 0;
};
export const proxyStrokeSummary = (radii, count, max = 4) => {
  const n = Math.max(0, Math.min(Math.round(Number(count) || 0), radii ? radii.length : 0));
  const bins = new Map();
  for (let i = 0; i < n; i += 1) {
    const r = Number(radii[i]);
    if (!(r > 0)) continue;
    const key = Math.round(r * 100) / 100;
    bins.set(key, (bins.get(key) || 0) + 1);
  }
  const all = [...bins.entries()].map(([radius, hits]) => ({ radius, hits })).sort((a, b) => (b.hits - a.hits) || (a.radius - b.radius));
  const cap = Math.max(1, Math.round(Number(max) || 1));
  return {
    list: all.slice(0, cap),
    rest: all.slice(cap).reduce((s, e) => s + e.hits, 0),
    count: n,
  };
};
export const buildRayShadowMask = ({ atoms, camera, light, width, height, options = {} }) => {
  const o = rayShadowOptions(options);
  const { width: mw, height: mh } = rayShadowMaskSize(width, height, o);
  const pxPerAngstrom = maskScalePerAngstrom({
    clip: camera.clip, view: camera.view, bounds: light.bounds, width: mw, height: mh,
  });
  const blurScale = shadowBlurScale(pxPerAngstrom, minStrokeRadiusOf(atoms));
  const blurOf = (name, value) => (options && options[name] !== undefined ? value : value * blurScale);
  const blur = {
    scale: blurScale, pxPerAngstrom,
    softness: blurOf('softness', o.softness),
    penumbra: blurOf('penumbra', o.penumbra),
    penumbraMax: blurOf('penumbraMax', o.penumbraMax),
  };
  const minStrokeRadius = minStrokeRadiusOf(atoms);
  const farRadiusPx = pxPerAngstrom > 0 ? SHADOW_AMBIENT_FAR_RADIUS_ANGSTROM * pxPerAngstrom : SHADOW_AMBIENT_FAR_RADIUS_PX_FALLBACK;
  const nearRadiusPx = pxPerAngstrom > 0 && minStrokeRadius > 0
    ? SHADOW_AMBIENT_NEAR_RADIUS_FRACTION * minStrokeRadius * pxPerAngstrom
    : SHADOW_AMBIENT_NEAR_RADIUS_PX_FALLBACK;
  const cameraAxes = viewAxesOf(camera.view || mat4Identity());
  const lightAxes = viewAxesOf(light.view || mat4Identity());
  const cameraPass = rasterizeSpheres({
    positions: atoms.positions, radii: atoms.radii, count: atoms.count,
    clip: camera.clip, width: mw, height: mh,
    radiusScale: o.sphereScale, axisUp: cameraAxes.up, needWorld: true, needReach: true,
  });
  const lightPass = rasterizeSpheres({
    positions: atoms.positions, radii: atoms.radii, count: atoms.count,
    clip: light.clip, width: mw, height: mh,
    radiusScale: o.sphereScale, axisUp: lightAxes.up, needWorld: false,
  });
  const depthScale = Number(light.depthScale) > 0 ? light.depthScale : lightDepthScale(light);
  const out = shadowMaskOf({
    camera: cameraPass,
    light: { clip: light.clip, depth: lightPass.depth },
    width: mw, height: mh,
    biasNdc: o.bias * depthScale,
    softness: blur.softness, taps: o.pcfTaps,
    penumbra: blur.penumbra, penumbraMax: blur.penumbraMax, depthScale,
  });
  const nearMask = softenMask(out.mask, mw, mh, nearRadiusPx);
  const farMask = softenMask(out.mask, mw, mh, farRadiusPx);
  const blended = new Float32Array(out.mask.length);
  for (let i = 0; i < blended.length; i += 1) {
    const fine = out.mask[i];
    const near = nearMask[i] * SHADOW_AMBIENT_NEAR_WEIGHT;
    const far = farMask[i] * SHADOW_AMBIENT_FAR_WEIGHT;
    let v = fine;
    if (near > v) v = near;
    if (far > v) v = far;
    blended[i] = v;
  }
  return {
    mask: blended, maskWidth: mw, maskHeight: mh,
    shadowed: out.shadowed, spheres: cameraPass.count,
    filled: Number(atoms && atoms.filled) || 0,
    strength: o.strength,
    bands: Number(atoms && atoms.bands) || 0,
    bandDebug: atoms && atoms.bandDebug ? atoms.bandDebug : '',
    strokes: proxyStrokeSummary(atoms && atoms.radii, atoms && atoms.count),
    blur,
    rig: Number.isFinite(Number(light.width)) && Number.isFinite(Number(light.height))
      ? { width: light.width, height: light.height, depth: light.far - light.near }
      : null,
    penumbra: { taps: out.taps, radius: blur.softness, grow: blur.penumbra, reached: out.penumbraRadius },
  };
};
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
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch { } }, 4000);
  }
};
const canvasOf = (width, height) => {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (typeof document === 'undefined') throw new Error('no canvas to write the still on');
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return canvas;
};
const toPngBlob = (canvas) => new Promise((resolve, reject) => {
  if (typeof canvas.convertToBlob === 'function') {
    canvas.convertToBlob({ type: 'image/png' }).then(resolve, reject);
    return;
  }
  canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the still could not be encoded'))), 'image/png');
});
export const shadowImageData = (imageData, shadow) => {
  if (!imageData || !shadow || !shadow.mask) return 0;
  return applyShadowToPixels(
    imageData.data, imageData.width, imageData.height,
    shadow.mask, shadow.maskWidth, shadow.maskHeight, shadow.strength,
  );
};
export const addCastShadowsToBlob = async (blob, { shadow, decode = null, encode = null } = {}) => {
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
    shadow.failed = (err && err.message) || 'the still could not be shadowed';
    console.warn('✨ Ray: no cast shadows —', shadow.failed);
    return blob;
  }
};
export const rayShadowNote = (shadow, reason = '') => {
  if (!shadow || !shadow.mask) {
    return reason ? `· no cast shadows — ${reason}` : '';
  }
  if (shadow.failed) return `· no cast shadows — ${shadow.failed}`;
  const pct = Math.round((Number(shadow.strength) || 0) * 100);
  const px = Number(shadow.reachedPixels);
  const covered = Number.isFinite(px) && shadow.imageWidth && shadow.imageHeight
    ? Math.round((px / (shadow.imageWidth * shadow.imageHeight)) * 100)
    : null;
  const spheres = Number(shadow.spheres) || 0;
  const filled = Number(shadow.filled) || 0;
  const bands = Number(shadow.bands) || 0;
  const bandDebug = shadow.bandDebug ? `· ⚠ ribbon debug: ${shadow.bandDebug}` : '';
  const st = shadow.strokes;
  const strokes = st && st.list && st.list.length
    ? `· strokes ${st.list.map((e) => `${e.radius.toFixed(2)} Å×${e.hits}`).join(' · ')}${st.rest ? ` · +${st.rest}` : ''}`
    : '';
  const rig = shadow.rig && Number.isFinite(Number(shadow.rig.width))
    ? `· rig ${Math.round(shadow.rig.width)}×${Math.round(shadow.rig.height)} Å`
    : '';
  return `· cast shadows ${pct}%${covered == null ? '' : ` (${covered}% of the pixels)`}`
    + `${spheres ? ` · ${spheres} proxies${filled ? `(${filled} filling the drawn strokes)` : ''}` : ''}`
    + `${bands ? ` · ${bands} in the ribbon bands` : ''}${bandDebug}${strokes}${rig}`;
};