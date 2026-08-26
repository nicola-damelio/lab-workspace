// scripts/verify-xtc-decoder.mjs
// Temp validation: compare the native XTC decoder against NGL 2.4.0's real
// XtcParser on real GROMACS XTC fixtures.
import fs from 'fs';
import { createRequire } from 'module';
import { readXtcFrames, countXtcFrames } from '../src/utils/xtcDecoder.js';

const require = createRequire(import.meta.url);
const NGL = require('../node_modules/ngl/dist/ngl.js');

const file = process.argv[2];
const raw = fs.readFileSync(file);
const ab = new Uint8Array(raw).buffer; // exact-size copy

// ---- Reference: NGL's real parser ----
const XtcParser = NGL.ParserRegistry.get('xtc');
const parser = new XtcParser(
  { data: ab, read: () => Promise.resolve() },
  { name: file, path: file }
);
const ref = await parser.parse();
const refCoords = ref.coordinates;
const refBoxes = ref.boxes;
const refTimes = ref.times;

// ---- Mine ----
const { totalFrames } = countXtcFrames(ab);
const mine = [];
for await (const fr of readXtcFrames(ab)) mine.push(fr);

// ---- Compare ----
let maxCoordErr = 0;
let maxBoxErr = 0;
let anyMismatch = false;
const report = (msg) => { console.log(msg); anyMismatch = true; };

console.log('file:', file);
console.log('NGL frames:', refCoords.length, '| mine frames:', mine.length, '| countXtcFrames:', totalFrames);
if (refCoords.length !== mine.length) report(`FRAME COUNT MISMATCH: NGL=${refCoords.length} mine=${mine.length}`);

const n = Math.min(refCoords.length, mine.length);
for (let i = 0; i < n; i++) {
  const rc = refCoords[i];
  const mc = mine[i].coords;
  if (!rc || !mc) continue;
  if (rc.length !== mc.length) {
    report(`frame ${i} coord length: NGL=${rc.length} mine=${mc.length}`);
    continue;
  }
  for (let k = 0; k < rc.length; k++) {
    const e = Math.abs(rc[k] - mc[k]);
    if (e > maxCoordErr) maxCoordErr = e;
    if (e > 0.02) { report(`frame ${i} coord[${k}]: NGL=${rc[k]} mine=${mc[k]}`); break; }
  }
  const rb = refBoxes[i];
  const mb = mine[i].box;
  if (rb && mb) {
    for (let k = 0; k < 9; k++) {
      const e = Math.abs(rb[k] - mb[k]);
      if (e > maxBoxErr) maxBoxErr = e;
      if (e > 0.02) { report(`frame ${i} box[${k}]: NGL=${rb[k]} mine=${mb[k]}`); break; }
    }
  }
  if (refTimes[i] !== mine[i].time) report(`frame ${i} time: NGL=${refTimes[i]} mine=${mine[i].time}`);
}

console.log('max coord diff:', maxCoordErr.toFixed(5), '| max box diff:', maxBoxErr.toFixed(5));
console.log('first mine coords:', Array.from(mine[0] ? mine[0].coords.slice(0, 6) : []));
console.log('first NGL coords :', Array.from(refCoords[0] ? refCoords[0].slice(0, 6) : []));
console.log('NGL frame0 full  :', Array.from(refCoords[0] || []).join(','));
console.log('NGL frame1 full  :', Array.from(refCoords[1] || []).join(','));

// ---- raw trace for frame 0 (nm, before *10) ----
{
  const view = new DataView(ab);
  let f = 0;
  const natoms = view.getInt32(f + 4); f += 12;
  f += 4; // time
  for (let k = 0; k < 9; k++) f += 4; // box
  f += 4; // csize
  const scale = view.getFloat32(f); f += 4;
  const mm = [];
  for (let k = 0; k < 6; k++) mm.push(view.getInt32(f + 4 * k));
  f += 24;
  const intIndex = view.getInt32(f); f += 4;
  const rawBytes = view.getInt32(f); f += 4;
  console.log('trace: natoms=', natoms, 'scale=', scale, 'minmax=', mm.join(','), 'intIndex=', intIndex, 'rawBytes=', rawBytes);
}


console.log(anyMismatch ? 'RESULT: MISMATCH' : 'RESULT: MATCH');
