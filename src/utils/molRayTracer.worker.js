/* =========================================================================
   src/utils/molRayTracer.worker.js
   Software ray tracer for molecular scenes (atom spheres + stick bonds).

   Every output pixel shoots a REAL primary ray through the scene; shadow
   rays toward a key light are shot from every surface point and blocked by
   the OTHER molecules/atoms (e.g. helix A casting its silhouette onto
   helix B). Optional hemisphere ambient-occlusion rays approximate PyMOL's
   depth/AO look. Runs inside a Web Worker.
   ========================================================================= */

let cancelled = false;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = (a) => Math.sqrt(dot(a, a));
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Ray vs sphere intersection — nearest t or -1. */
const raySphere = (o, d, center, r) => {
  const oc = sub(o, center);
  const b = dot(oc, d);
  const c = dot(oc, oc) - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  let t = -b - sq;
  if (t < 1e-4) t = -b + sq;
  return t < 1e-4 ? -1 : t;
};

/** Render one molecular scene from `job`.
 *  @param {object} job {
 *    atoms: [{x,y,z,r,color:[r,g,b]}],  // all spheres (bonds pre-expanded)
 *    width, height, eye, target, up, fovDeg,
 *    lightDir:[x,y,z], bg:[r,g,b],
 *    shadowSamples, aoSamples
 *  } */
const renderMolScene = (job) => {
  cancelled = false;
  const {
    atoms, width, height, eye, target, up, fovDeg = 38,
    lightDir: rawLight, bg = [248, 250, 252],
    shadowSamples = 6, aoSamples = 0
  } = job;

  const lightDir = norm(rawLight || [-0.55, -0.7, -0.45]);
  const data = new Uint8ClampedArray(width * height * 4);
  const n = atoms.length;
  let hitCount = 0;
  const f = norm(sub(target || [0, 0, 0], eye));
  const r0 = norm(cross(f, up || [0, 0, 1]));
  const u0 = cross(f, r0);
  const aspect = width / height;
  const halfH = Math.tan(((fovDeg * Math.PI) / 180) / 2);
  const halfW = halfH * aspect;
  self.postMessage({ type: 'info', atoms: n, width, height, eye, target: target || [0, 0, 0], radiusBox: null });

  // Deterministic jitter set → soft shadows (area-light approximation).
  const jitters = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const sCount = Math.max(1, shadowSamples);
  for (let s = 0; s < sCount; s++) {
    const y = 1 - (s / sCount) * 2;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * s;
    jitters.push(norm(add(lightDir, scale([Math.cos(th) * rr, y, Math.sin(th) * rr], 0.18))));
  }
  const aoDirs = [];
  for (let s = 0; s < Math.max(0, aoSamples); s++) {
    const y = 1 - (s / Math.max(1, aoSamples)) * 2;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * s;
    aoDirs.push(norm([Math.cos(th) * rr, y + 0.25, Math.sin(th) * rr]));
  }

  const rayBlocked = (o, d) => {
    for (let i = 0; i < n; i++) {
      const a = atoms[i];
      if (raySphere(o, d, [a.x, a.y, a.z], a.r) >= 0) return true;
    }
    return false;
  };

  for (let y = 0; y < height; y++) {
    if (cancelled) break;
    for (let x = 0; x < width; x++) {
      const px = ((x + 0.5) / width) * 2 - 1;
      const py = 1 - ((y + 0.5) / height) * 2;
      const dir = norm(add(add(scale(f, 1), scale(r0, px * halfW)), scale(u0, py * halfH)));
      let hitT = Infinity;
      let hitIdx = -1;
      for (let i = 0; i < n; i++) {
        const a = atoms[i];
        const t = raySphere(eye, dir, [a.x, a.y, a.z], a.r);
        if (t >= 0 && t < hitT) { hitT = t; hitIdx = i; }
      }
      const out = ((y * width) + x) * 4;
      if (hitIdx < 0) {
        data[out] = bg[0]; data[out + 1] = bg[1]; data[out + 2] = bg[2]; data[out + 3] = 255;
        continue;
      }
      const A = atoms[hitIdx];
      hitCount++;
      const p = add(eye, scale(dir, hitT));
      const nrm = norm(sub(p, [A.x, A.y, A.z]));
      const ndl = dot(nrm, lightDir);

      // REAL shadow rays toward the light: every other atom/bond sphere can
      // block them, so one helix casts its shadow onto the other.
      let visible = 0;
      const o = add(p, scale(lightDir, A.r * 1.4 + 0.2));
      for (let s = 0; s < jitters.length; s++) {
        if (!rayBlocked(o, jitters[s])) visible++;
      }
      const shadow = visible / jitters.length;

      // Optional ambient occlusion (hemisphere visibility).
      let ao = 1;
      if (aoDirs.length) {
        let occ = 0;
        for (const d of aoDirs) {
          const rot = norm(add(scale(nrm, dot(nrm, d)),
            add(scale(r0, dot(r0, d)), scale(u0, dot(u0, d)))));
          if (rayBlocked(add(p, scale(rot, 0.12)), rot)) occ++;
        }
        ao = 1 - (occ / aoDirs.length) * 0.85;
      }

      const k = (0.42 + Math.max(0, ndl) * 0.95) * Math.min(1, shadow + 0.06) * Math.min(1, ao + 0.08);
      data[out] = Math.min(255, A.color[0] * k);
      data[out + 1] = Math.min(255, A.color[1] * k);
      data[out + 2] = Math.min(255, A.color[2] * k);
      data[out + 3] = 255;
    }
    if (y % 40 === 0) self.postMessage({ type: 'progress', y, height });
  }
  return { data, width, height, hits: hitCount };
};

self.onmessage = (ev) => {
  const msg = ev && ev.data;
  if (!msg) return;
  if (msg.type === 'cancel') { cancelled = true; return; }
  if (msg.type !== 'render') return;
  try {
    const result = renderMolScene(msg.job);
    self.postMessage(
      { type: 'done', buffer: result.data.buffer, width: result.width, height: result.height, hits: result.hits },
      [result.data.buffer]
    );
  } catch (err) {
    self.postMessage({ type: 'error', message: (err && err.message) || 'Ray-tracing failed' });
  }
};

