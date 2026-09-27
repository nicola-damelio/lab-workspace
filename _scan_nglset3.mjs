// Probe 11: the EXACT source of Buffer.setAttributes (from the loaded module) + semantics on resize.
import fs from 'fs';
const out = [];
const log = (...a) => out.push(a.join(' '));
const NGL = await import('ngl');
const NB = NGL.MeshBuffer || (NGL.default && NGL.default.MeshBuffer);
const proto2 = Object.getPrototypeOf(Object.getPrototypeOf(new NB({ position: new Float32Array(9), normal: new Float32Array(9), color: new Float32Array(9), index: new Uint16Array([0, 1, 2]) })));
const desc = Object.getOwnPropertyDescriptor(proto2, 'setAttributes');
log('=== SOURCE of Buffer.setAttributes ===');
log(Function.prototype.toString.call(desc.value));
log('');
log('=== addAttributes source ===');
const d2 = Object.getOwnPropertyDescriptor(proto2, 'addAttributes');
log(d2 ? Function.prototype.toString.call(d2.value) : 'none');
log('');
const mk = (n) => {
  const p = new Float32Array(n * 3);
  for (let k = 0; k < n * 3; k++) p[k] = k + 1;
  return new NB({ position: p, normal: new Float32Array(n * 3), color: new Float32Array(n * 3), index: new Uint16Array(Array.from({ length: n }, (_, k) => k)) });
};
log('=== semantics: same length (the real case) ===');
{
  const m = mk(3);
  const attrBefore = m.geometry.attributes.position;
  m.geometry.attributes.position.array.set([9, 9, 9, 8, 8, 8, 7, 7, 7]);
  m.geometry.attributes.position.needsUpdate = true;
  m.setAttributes({ position: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), normal: new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]), color: new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]) });
  const attrAfter = m.geometry.attributes.position;
  log('same obj=' + (attrBefore === attrAfter) + ' pos=' + Array.from(attrAfter.array).join(',') + ' needsUpdate=' + attrAfter.needsUpdate + ' attributeSize=' + m.attributeSize);
}
log('=== semantics: LONGER array (grow) ===');
{
  const m = mk(3);
  const attrBefore = m.geometry.attributes.position;
  try {
    m.setAttributes({ position: new Float32Array(18).fill(2), normal: new Float32Array(18), color: new Float32Array(18) });
    const attrAfter = m.geometry.attributes.position;
    log('same obj=' + (attrBefore === attrAfter) + ' len=' + attrAfter.array.length + ' attributeSize=' + m.attributeSize + ' needsUpdate=' + attrAfter.needsUpdate);
  } catch (e) { log('threw: ' + e.message); }
}
log('=== semantics: SHORTER array (shrink) ===');
{
  const m = mk(3);
  const attrBefore = m.geometry.attributes.position;
  try {
    m.setAttributes({ position: new Float32Array(6).fill(3), normal: new Float32Array(6), color: new Float32Array(6) });
    const attrAfter = m.geometry.attributes.position;
    log('same obj=' + (attrBefore === attrAfter) + ' len=' + attrAfter.array.length + ' attributeSize=' + m.attributeSize + ' vals=' + Array.from(attrAfter.array).join(','));
  } catch (e) { log('threw: ' + (e && e.stack ? e.stack.split('\n')[0] : e)); }
}
log('=== does the count drive the index buffer? ===');
{
  const m = mk(3);
  log('index len before=' + m.geometry.getIndex().array.length + ' drawCount-ish indexSize=' + m.indexSize + ' size=' + m.size);
  m.setAttributes({ position: new Float32Array(18).fill(2), normal: new Float32Array(18), color: new Float32Array(18) });
  log('index len after=' + m.geometry.getIndex().array.length + ' size=' + m.size + ' attributeSize=' + m.attributeSize);
}
fs.writeFileSync('_sp_nglset3.txt', out.join('\r\n'), 'utf8');
console.log('ok', out.length);
