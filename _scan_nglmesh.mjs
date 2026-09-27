// Probe 10: what class is a MeshBuffer really (runtime + bundle), and does it expose setAttributes?
import fs from 'fs';
const out = [];
const log = (...a) => out.push(a.join(' '));
const b = fs.readFileSync('node_modules/ngl/dist/ngl.esm.js', 'utf8');
let i = -1, n = 0;
while ((i = b.indexOf('isMesh=!0', i + 1)) !== -1 && n < 4) {
  n++;
  log('');
  log('--- isMesh=!0 @' + i);
  log(b.slice(Math.max(0, i - 220), i + 700).replace(/\n/g, ' '));
}
log('');
log('=== declarations: which class declares setAttributes ===');
['buffer/buffer.d.ts', 'buffer/mesh-buffer.d.ts'].forEach((f) => {
  try {
    const d = fs.readFileSync('node_modules/ngl/dist/declarations/' + f, 'utf8');
    log('--- ' + f);
    log(d.split(/\r?\n/).map((l, k) => (/setAttributes|class |extends |isMesh|attributeSize/.test(l) ? (k + 1) + '| ' + l.trim() : null)).filter(Boolean).join(' ~ '));
  } catch (e) { log('MISSING ' + f + ' ' + e.message); }
});
log('');
log('=== package.json ngl entry ===');
try {
  const p = JSON.parse(fs.readFileSync('node_modules/ngl/package.json', 'utf8'));
  log('main=' + p.main + ' module=' + p.module + ' exports=' + JSON.stringify(p.exports));
} catch (e) { log('ERR ' + e.message); }
log('');
log('=== runtime probe ===');
try {
  const NGL = await import('ngl');
  const NB = NGL.MeshBuffer || (NGL.default && NGL.default.MeshBuffer);
  log('MeshBuffer from ' + (NGL.MeshBuffer ? 'named' : 'default'));
  const mesh = new NB({
    position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    color: new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]),
    index: new Uint16Array([0, 1, 2]),
  });
  log('isMesh=' + mesh.isMesh + ' attributeSize=' + mesh.attributeSize);
  log('typeof mesh.setAttributes = ' + typeof mesh.setAttributes);
  log('proto = ' + Object.getOwnPropertyNames(Object.getPrototypeOf(mesh)).join(','));
  const p2 = Object.getPrototypeOf(Object.getPrototypeOf(mesh));
  log('proto2 = ' + (p2 ? Object.getOwnPropertyNames(p2).join(',') : 'none'));
  log('geometry attrs = ' + Object.keys(mesh.geometry.attributes).join(','));
  log('pos array len = ' + mesh.geometry.attributes.position.array.length + ' needsUpdate=' + mesh.geometry.attributes.position.needsUpdate);
  log('index = ' + (mesh.geometry.getIndex() ? mesh.geometry.getIndex().array.join(',') : 'none'));
  // The real test: does a direct copy into the same arrays work?
  const next = new Float32Array([0, 0, 5, 1, 0, 5, 0, 1, 5]);
  mesh.geometry.attributes.position.array.set(next);
  mesh.geometry.attributes.position.needsUpdate = true;
  log('after copy = ' + Array.from(mesh.geometry.attributes.position.array).join(','));
  log('computeBoundingSphere? ' + typeof mesh.geometry.computeBoundingSphere + ' frustumCulled=' + mesh.geometry.boundingSphere);
  if (typeof mesh.setAttributes === 'function') {
    try { mesh.setAttributes({ position: next, normal: next, color: next }); log('setAttributes ran OK -> ' + Array.from(mesh.geometry.attributes.position.array).join(',')); }
    catch (e) { log('setAttributes threw: ' + e.message); }
  }
} catch (e) { log('IMPORT/RUNTIME FAILED: ' + (e && e.stack ? e.stack.split('\n')[0] : e)); }
fs.writeFileSync('_sp_nglmesh.txt', out.join('\r\n'), 'utf8');
console.log('ok', out.length);
