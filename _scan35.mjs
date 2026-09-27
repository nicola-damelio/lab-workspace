/* _scan35.mjs — what the INSTALLED NGL says about a buffer representation and a frame. */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const NGL = require('ngl');
const proto = NGL.BufferRepresentation.prototype;
const parent = Object.getPrototypeOf(proto);
const out = {
  version: require('ngl/package.json').version,
  typeofRepresentation: typeof NGL.Representation,
  bufferOwnProps: Object.getOwnPropertyNames(proto),
  parentOwnProps: Object.getOwnPropertyNames(parent).filter((n) => ['update', 'build', 'make', 'create', 'attach', 'init', 'dispose'].includes(n)),
  parentName: parent.constructor ? parent.constructor.name : null,
  updateSrc: String(parent.update),
  buildSrc: String(parent.build),
  createSrc: String(proto.create).slice(0, 300),
};

const probe = {};
try { parent.build.call(probe); out.buildTouches = Object.keys(probe); } catch (e) { out.buildThrew = String(e && e.message); }
const calls = [];
try {
  parent.update.call({ build: (...a) => calls.push(a) }, { position: true });
  out.calls = JSON.stringify(calls);
} catch (e) { out.updateThrew = String(e && e.message); out.callsSoFar = JSON.stringify(calls); }
out.updateCallsBuildArg = calls.length === 1 && calls[0].length === 0 ? 'build() sans argument' : 'inattendu';
writeFileSync('_live_ngl_probe.txt', JSON.stringify(out, null, 1));
console.log('_live_ngl_probe.txt written');
