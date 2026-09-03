let cancelled = false;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = (a) => Math.sqrt(dot(a, a));
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

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

const renderMolScene = (job) => {
  cancelled = false;
  const { atoms, width, height, eye, target, up, fovDeg = 38, bg = [248, 250, 252], shadowSamples = 8, aoSamples = 4, settings = {} } = job;
  const { azimuth = 135, elevation = 30, drama = 0.7, specular = 0.6, shadowSoftness = 0.3 } = settings;

  // 1. Calculate Light Direction from UI settings
  const azRad = (azimuth * Math.PI) / 180;
  const elRad = (elevation * Math.PI) / 180;
  const lightDir = norm([Math.cos(elRad) * Math.sin(azRad), Math.cos(elRad) * Math.cos(azRad), Math.sin(elRad)]);

  // 2. Drama controls ambient light (flatness) and shadow contrast
  const ambient = 0.15 + (1 - drama) * 0.35; 
  const shadowContrast = 0.4 + drama * 0.6;  
  
  const data = new Uint8ClampedArray(width * height * 4);
  const n = atoms.length;
  let hitCount = 0;

  const f = norm(sub(target || [0, 0, 0], eye));
  const r0 = norm(cross(f, up || [0, 0, 1]));
  const u0 = cross(f, r0);
  const aspect = width / height;
  const halfH = Math.tan(((fovDeg * Math.PI) / 180) / 2);
  const halfW = halfH * aspect;

  // 3. Jitters for soft shadows
  const jitters = [];
  const sCount = Math.max(1, shadowSamples);
  const spread = 0.05 + shadowSoftness * 0.25;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let s = 0; s < sCount; s++) {
    const y = 1 - (s / sCount) * 2;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * s;
    jitters.push(norm(add(lightDir, scale([Math.cos(th) * rr, y, Math.sin(th) * rr], spread))));
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
      // FIX: Pass coordinate array [x,y,z] instead of the object
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
        // FIX: Pass coordinate array [x,y,z]
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
      const viewDir = norm(sub(eye, p));
      const halfDir = norm(add(lightDir, viewDir));

      const ndl = Math.max(0, dot(nrm, lightDir)); // Diffuse
      const ndh = Math.max(0, dot(nrm, halfDir));
      const spec = Math.pow(ndh, 64) * specular; // Specular (Blinn-Phong)

      let visible = 0;
      // FIX: Bias along the normal to prevent shadow acne
      const o = add(p, scale(nrm, A.r * 0.01 + 0.05)); 
      for (let s = 0; s < jitters.length; s++) {
        if (!rayBlocked(o, jitters[s])) visible++;
      }
      const shadowFactor = (visible / jitters.length) * shadowContrast + (1 - shadowContrast);

      let ao = 1;
      if (aoDirs.length) {
        let occ = 0;
        for (const d of aoDirs) {
          const rot = norm(add(scale(nrm, dot(nrm, d)), add(scale(r0, dot(r0, d)), scale(u0, dot(u0, d)))));
          if (rayBlocked(add(p, scale(rot, 0.1)), rot)) occ++;
        }
        ao = 1 - (occ / aoDirs.length) * 0.6;
      }

      // Additive lighting model (much more realistic than multiplicative)
      const k = ambient + (ndl * shadowFactor * ao) * (1 - ambient) + spec;
      
      data[out] = Math.min(255, A.color[0] * 255 * k);
      data[out + 1] = Math.min(255, A.color[1] * 255 * k);
      data[out + 2] = Math.min(255, A.color[2] * 255 * k);
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
    self.postMessage({ type: 'done', buffer: result.data.buffer, width: result.width, height: result.height, hits: result.hits }, [result.data.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: (err && err.message) || 'Ray-tracing failed' });
  }
};