const ELEMENT_COLORS = {
  C: [176, 184, 194], N: [102, 160, 240], O: [235, 122, 128], H: [226, 230, 235],
  S: [238, 206, 118], P: [192, 158, 230], F: [120, 200, 160], CL: [130, 220, 130],
  BR: [190, 90, 70], NA: [140, 140, 240], MG: [110, 220, 120], K: [150, 150, 210],
  CA: [120, 220, 200], ZN: [150, 160, 180]
};
const ELEMENT_RADIUS = {
  H: 0.28, C: 0.55, N: 0.53, O: 0.53, S: 0.6, P: 0.62, F: 0.5, CL: 0.62,
  BR: 0.7, NA: 0.75, MG: 0.7, K: 0.95, CA: 0.95, ZN: 0.7
};
const BOND_RADIUS = 0.2;
const normV = (a) => {
  const l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

const buildScene = (component, includeHydrogens) => {
  const structure = component && component.structure;
  const spheres = [];
  const bonds = [];
  const seen = new Set();
  try {
    structure.eachAtom((a) => {
      const el = String(a.element || '').toUpperCase() || 'C';
      if (el === 'H' && !includeHydrogens) return;
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(a.z)) return;
      spheres.push({ x: a.x, y: a.y, z: a.z, r: ELEMENT_RADIUS[el] || 0.5, color: ELEMENT_COLORS[el] || [200, 205, 215] });
    });
    structure.eachAtom((a) => {
      const ea = String(a.element || '').toUpperCase();
      if (ea === 'H') return;
      a.eachBondedAtom((b) => {
        const eb = String(b.element || '').toUpperCase();
        if (eb === 'H') return;
        const key = a.index < b.index ? a.index + '|' + b.index : b.index + '|' + a.index;
        if (seen.has(key)) return;
        seen.add(key);
        bonds.push([[a.x, a.y, a.z], [b.x, b.y, b.z]]);
      });
    });
  } catch {}
  const col = [162, 172, 186];
  bonds.forEach(([p0, p1]) => {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const steps = Math.max(1, Math.floor(L / (BOND_RADIUS * 1.2)));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      spheres.push({ x: p0[0] + dx * t, y: p0[1] + dy * t, z: p0[2] + dz * t, r: BOND_RADIUS, color: col });
    }
  });
  const n = spheres.length;
  const center = [0, 0, 0];
  spheres.forEach((s) => { center[0] += s.x; center[1] += s.y; center[2] += s.z; });
  if (n) { center[0] /= n; center[1] /= n; center[2] /= n; }
  let radius = 1;
  spheres.forEach((s) => {
    const d = Math.sqrt((s.x - center[0]) ** 2 + (s.y - center[1]) ** 2 + (s.z - center[2]) ** 2) + s.r;
    if (d > radius) radius = d;
  });
  return { atoms: spheres, center, radius };
};

export const rayTraceStructureToBlob = (
  component,
  { width = 1600, fovDeg = 38, shadowSamples = 8, aoSamples = 4, includeHydrogens = true, onProgress = null } = {}
) => {
  const scene = buildScene(component, includeHydrogens);
  const n = scene.atoms.length;
  if (!n) throw new Error('Ray tracer received no atoms (nothing to render).');
  
  const cap = 6000;
  const effWidth = n > cap ? Math.max(900, Math.round(width * (cap / n))) : width;
  const effHeight = Math.max(600, Math.round((effWidth * 3) / 4));
  const fovRad = (fovDeg * Math.PI) / 180;
  const dist = (scene.radius / Math.tan(fovRad / 2)) * 1.05;
  const dir = normV([1.15, -1.35, 1.0]);
  const eye = [scene.center[0] + dir[0] * dist, scene.center[1] + dir[1] * dist, scene.center[2] + dir[2] * dist];

  // Read settings from the global window object (set by AdvancedRayTracerControls)
  const settings = window.__rayTraceSettings || {
    azimuth: 135, elevation: 30, drama: 0.7, specular: 0.6, shadowSoftness: 0.3
  };

  const job = {
    atoms: scene.atoms.map((a) => ({ x: a.x, y: a.y, z: a.z, r: a.r, color: [a.color[0] / 255, a.color[1] / 255, a.color[2] / 255] })),
    width: effWidth, height: effHeight,
    eye, target: scene.center, up: [0, 0, 1], fovDeg,
    bg: [248, 250, 252],
    shadowSamples, aoSamples,
    settings
  };

  const worker = new Worker(new URL('./advancedRayTracer.worker.js', import.meta.url), { type: 'module' });
  const promise = new Promise((resolve, reject) => {
    worker.onmessage = (ev) => {
      const msg = ev.data;
      if (!msg) return;
      if (msg.type === 'info') { console.info('[ray-tracer] worker:', msg); return; }
      if (msg.type === 'progress') {
        if (onProgress && msg.height) onProgress(msg.y, msg.height);
        return;
      }
      if (msg.type === 'error') { worker.terminate(); reject(new Error(msg.message || 'Ray-tracing failed')); return; }
      if (msg.type === 'done') {
        try {
          if (!msg.hits) { worker.terminate(); reject(new Error('Ray tracer produced no hits.')); return; }
          const data = new Uint8ClampedArray(msg.buffer);
          const canvas = document.createElement('canvas');
          canvas.width = msg.width; canvas.height = msg.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Canvas 2D unavailable');
          ctx.putImageData(new ImageData(data, msg.width, msg.height), 0, 0);
          worker.terminate();
          canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png');
        } catch (err) { worker.terminate(); reject(err); }
      }
    };
    worker.onerror = () => { worker.terminate(); reject(new Error('Ray-tracing worker crashed')); };
    worker.postMessage({ type: 'render', job });
  });

  const cancel = () => {
    try { worker.postMessage({ type: 'cancel' }); } catch {}
    setTimeout(() => { try { worker.terminate(); } catch {} }, 60);
  };

  return { promise, cancel };
};