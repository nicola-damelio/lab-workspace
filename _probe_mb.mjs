// TEMPORARY probe: what a real NGL MeshBuffer looks like right after construction,
// and what the `refreshed` signal really is.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const NGL = require('ngl')
const out = []
const mesh = new NGL.MeshBuffer({
  position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  color: new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]),
  index: new Uint32Array([0, 1, 2]),
}, { opacity: 0.5, side: 'double' })
out.push('keys(geometry.attributes) = ' + Object.keys(mesh.geometry.attributes))
const pa = mesh.geometry.attributes.position
out.push('position attr: ' + (pa && pa.array.constructor.name) + ' len=' + (pa && pa.array.length))
const ia = mesh.geometry.index
out.push('index: ' + (ia && ia.array.constructor.name) + ' len=' + (ia && ia.array.length) + ' drawRange=' + mesh.geometry.drawRange.count)
out.push('has setAttributes: ' + (typeof mesh.setAttributes))
out.push('dynamic: ' + mesh.dynamic + '  params.side=' + mesh.parameters.side + ' opacity=' + mesh.parameters.opacity)
// setAttributes with the same arrays (what refreshRingPlates does) must not throw,
// and must leave the buffers in place.
mesh.setAttributes({ position: new Float32Array([2, 0, 0, 3, 0, 0, 2, 1, 0]), normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), color: new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]), index: new Uint32Array([0, 1, 2]) })
out.push('after setAttributes position = ' + [...mesh.geometry.attributes.position.array].join(','))
out.push('same BufferAttribute object: ' + (mesh.geometry.attributes.position === pa))
out.push('after setAttributes drawRange=' + mesh.geometry.drawRange.count + ' index len=' + mesh.geometry.index.array.length)
out.push('NGL.Signal: ' + (typeof NGL.Signal))
try {
  const s = new NGL.Signal({ signals: {} })
  out.push('Signal proto: ' + Object.getOwnPropertyNames(Object.getPrototypeOf(s)).join(','))
} catch (e) { out.push('new NGL.Signal threw: ' + String(e.message).slice(0, 120)) }
out.push('MeshBuffer proto keys: ' + Object.getOwnPropertyNames(Object.getPrototypeOf(mesh)).join(','))
import { writeFileSync } from 'node:fs'
writeFileSync('_t_mb.txt', out.join('\n'), 'utf8')
console.log('done')
