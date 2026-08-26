/* =========================================================================
   xtcDecoder.js
   Native, incremental XTC (GROMACS compressed trajectory) reader.

   This is a faithful port of the GROMACS "3dfcoord" decoder bundled inside
   NGL 2.4.0's XtcParser (xdrfile), rewritten so a trajectory can be decoded
   frame by frame on the main thread. The UI can therefore show a live
   "N / total frames loaded" counter while a large .xtc file streams in —
   NGL's own parse is all-or-nothing and reports no per-frame progress.

   Output conventions match NGL's XtcParser exactly:
     - coordinates : Float32Array(3*natoms), ANGSTROM (raw nm * 10)
     - box         : Float32Array(9), ANGSTROM
     - time        : ps (float, as stored in the file)
   ========================================================================= */

// GROMACS "magicints[]" lookup table (xdrfile.c) — the set of interesting
// compression thresholds. `intIndex` selects the current size-of-int level.
const MAGIC_INTS = new Uint32Array([
  0, 0, 0, 0, 0, 0, 0, 0, 0,
  8, 10, 12, 16, 20, 25, 32, 40, 50, 64, 80, 101, 128, 161, 203, 256, 322,
  406, 512, 645, 812, 1024, 1290, 1625, 2048, 2580, 3250, 4096, 5060, 6501,
  8192, 10321, 13003, 16384, 20642, 26007, 32768, 41285, 52015, 65536, 82570,
  104031, 131072, 165140, 208063, 262144, 330280, 416127, 524287, 660561,
  832255, 1048576, 1321122, 1664510, 2097152, 2642245, 3329021, 4194304,
  5284491, 6658042, 8388607, 10568983, 13316085, 16777216,
]);

// Number of bits needed to represent any value in [0, n].
const bitLength = (n) => {
  let bits = 0;
  let t = 1;
  for (; n >= t && bits < 32; ) { bits++; t <<= 1; }
  return bits;
};

// Base-256 (limb) scratch for packedBits / readMixedRadix.
const LIMBS = new Uint8Array(32);

// Total number of bits needed to store one mixed-radix group for the given
// per-dimension ranges (= ceil(log2(product of ranges))).
const packedBits = (ranges) => {
  LIMBS[0] = 1;
  let limbCount = 1;
  for (let d = 0; d < ranges.length; d++) {
    let carry = 0;
    for (let k = 0; k < limbCount; k++) {
      carry += LIMBS[k] * ranges[d];
      LIMBS[k] = carry & 0xff;
      carry >>>= 8;
    }
    for (; carry !== 0; ) {
      LIMBS[limbCount++] = carry & 0xff;
      carry >>>= 8;
    }
  }
  const top = limbCount - 1;
  let extra = 0;
  let base = 1;
  for (; LIMBS[top] >= base; ) { extra++; base *= 2; }
  return extra + 8 * top;
};

// MSB-first bit reader over `bytes`.
// `state` = [byteOffset, bitPos, accumulator] (persists between calls).
// Mirrors NGL 2.4.0's `uM` exactly (int32 arithmetic via `>>`).
const readBits = (state, bytes, nbits) => {
  const mask = (1 << nbits) - 1;
  let s = state[1];
  let a = state[2];
  let o = state[0];
  let l = 0;
  for (; nbits >= 8; ) {
    a = (a << 8) | bytes[o++];
    l |= (a >> s) << (nbits - 8);
    nbits -= 8;
  }
  if (nbits > 0) {
    if (s < nbits) {
      s += 8;
      a = (a << 8) | bytes[o++];
    }
    s -= nbits;
    l |= (a >> s) & ((1 << nbits) - 1);
  }
  l &= mask;
  state[0] = o;
  state[1] = s;
  state[2] = a;
  return l;
};

// Read one mixed-radix integer group (3 values) encoded in `nbits` bits and
// split it using the per-dimension `ranges` (mixed radix). Outputs to `out`.
const readMixedRadix = (state, bytes, nbits, ranges, out) => {
  let o = 0;
  LIMBS[1] = 0; LIMBS[2] = 0; LIMBS[3] = 0;
  for (; nbits > 8; ) {
    LIMBS[o++] = readBits(state, bytes, 8);
    nbits -= 8;
  }
  if (nbits > 0) LIMBS[o++] = readBits(state, bytes, nbits);
  for (let dim = 2; dim > 0; dim--) {
    let t = 0;
    for (let i = o - 1; i >= 0; i--) {
      t = ((t << 8) | LIMBS[i]);
      const n = (t / ranges[dim]) | 0;
      LIMBS[i] = n;
      t -= n * ranges[dim];
    }
    out[dim] = t;
  }
  out[0] = LIMBS[0] | (LIMBS[1] << 8) | (LIMBS[2] << 16) | (LIMBS[3] << 24);
};

/**
 * Walk the frame headers of an XTC buffer WITHOUT decompressing coordinates.
 * @param {Uint8Array|ArrayBuffer} data
 * @param {(frameIndex:number, natoms:number) => void} onFrame called for every complete frame
 * @returns {number} number of bytes consumed by complete frames
 */
const walkXtcHeaders = (data, onFrame) => {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const len = u8.byteLength;
  let f = 0;
  let lastComplete = 0;
  let frameIdx = 0;
  while (f + 12 <= len) {
    const natoms = view.getInt32(f + 4);       // XDR = big-endian
    if (natoms <= 0) break;
    f += 12;                                   // magic + natoms + step
    if (f + 4 > len) break;                    // time
    f += 4;
    if (f + 36 > len) break;                   // box (9 floats)
    f += 36;
    if (natoms <= 9) {
      f += natoms * 3 * 4;                     // uncompressed floats
      if (f > len) break;
    } else {
      if (f + 4 > len) break;                  // csize (unused)
      f += 4;
      if (f + 4 > len) break;                  // precision scale
      f += 4;
      if (f + 24 > len) break;                 // minint/maxint
      f += 24;
      if (f + 4 > len) break;                  // size_of_int
      f += 4;
      if (f + 4 > len) break;                  // compressed byte count
      const cbytes = view.getInt32(f);
      f += 4;
      f += 4 * Math.ceil(cbytes / 4);          // padded to 4 bytes
      if (f > len) break;
    }
    if (onFrame) onFrame(frameIdx, natoms);
    frameIdx++;
    lastComplete = f;
    if (f >= len) break;
  }
  return lastComplete;
};


/**
 * Count the frames in an XTC file already read into memory (fast header scan,
 * no coordinate decompression).
 */
export const countXtcFrames = (buffer) => {
  let totalFrames = 0;
  let natoms = 0;
  walkXtcHeaders(buffer, (_i, n) => { totalFrames++; natoms = n; });
  return { totalFrames, natoms };
};

/**
 * Count the frames of an XTC File by reading it in chunks (memory-safe for
 * multi-GB trajectories — only frame headers are inspected).
 */
export const countXtcFramesInFile = async (file, onChunk) => {
  const CHUNK = 1024 * 1024;
  const size = file.size;
  let offset = 0;
  let carry = new Uint8Array(0);
  let totalFrames = 0;
  let natoms = 0;
  while (offset < size) {
    const blob = file.slice(offset, Math.min(size, offset + CHUNK));
    const chunk = new Uint8Array(await blob.arrayBuffer());
    offset += chunk.length;
    const buf = new Uint8Array(carry.length + chunk.length);
    buf.set(carry);
    buf.set(chunk, carry.length);
    const consumed = walkXtcHeaders(buf, (_i, n) => { totalFrames++; natoms = n; });
    carry = buf.slice(consumed);
    if (onChunk) onChunk(totalFrames);
    if (offset >= size && carry.length === 0) break;
    if (consumed === 0 && carry.length > 0 && offset >= size) break; // truncated last frame
  }
  return { totalFrames, natoms };
};


/**
 * Decode an XTC buffer frame by frame (async generator). Yields after every
 * frame so the caller can update the UI and/or check for abort signals.
 *
 * @param {ArrayBuffer} buffer
 * @yields {{ coords: Float32Array, box: Float32Array, time: number, natoms: number }}
 *   coords/box in ANGSTROM (nm * 10), matching NGL's XtcParser output.
 */
export async function* readXtcFrames(buffer) {
  const view = new DataView(buffer);
  const len = buffer.byteLength;
  let f = 0;
  const minmax = new Int32Array(6);
  const range = new Int32Array(3);
  const perDimBits = new Int32Array(3);
  const bitState = new Uint32Array(3);
  const u = new Uint32Array(3);
  const h = new Float32Array(3);
  const d = new Float32Array(3);

  while (true) {
    if (f + 12 > len) break;
    const natoms = view.getInt32(f + 4);       // XDR = big-endian
    if (natoms <= 0) break;
    f += 12;                                   // magic + natoms + step
    if (f + 4 > len) break;
    const time = view.getFloat32(f);
    f += 4;
    if (f + 36 > len) break;
    const boxRaw = new Float32Array(9);
    for (let k = 0; k < 9; k++) { boxRaw[k] = view.getFloat32(f); f += 4; }

    let coords;
    if (natoms <= 9) {
      // Small systems are stored as uncompressed floats (3 per atom).
      if (f + natoms * 3 * 4 > len) break;
      coords = new Float32Array(natoms * 3);
      for (let k = 0; k < natoms * 3; k++) { coords[k] = view.getFloat32(f); f += 4; }
    } else {
      // ---- 3dfcoord-compressed block ----
      if (f + 4 > len) break;
      f += 4;                                  // csize (unused)
      if (f + 4 > len) break;
      const scale = view.getFloat32(f);
      f += 4;
      if (f + 24 > len) break;
      minmax[0] = view.getInt32(f);      minmax[1] = view.getInt32(f + 4);
      minmax[2] = view.getInt32(f + 8);  minmax[3] = view.getInt32(f + 12);
      minmax[4] = view.getInt32(f + 16); minmax[5] = view.getInt32(f + 20);
      f += 24;
      range[0] = minmax[3] - minmax[0] + 1;
      range[1] = minmax[4] - minmax[1] + 1;
      range[2] = minmax[5] - minmax[2] + 1;
      let radixBits = 0;
      let useRadix = false;
      if ((range[0] | range[1] | range[2]) > 16777215) {
        perDimBits[0] = bitLength(range[0]);
        perDimBits[1] = bitLength(range[1]);
        perDimBits[2] = bitLength(range[2]);
      } else {
        radixBits = packedBits(range);
        useRadix = true;
      }
      if (f + 4 > len) break;
      let intIndex = view.getInt32(f);   // size_of_int (index into MAGIC_INTS)
      f += 4;
      if (f + 4 > len) break;
      const rawBytes = view.getInt32(f);
      f += 4;
      const blockBytes = 4 * Math.ceil(rawBytes / 4);
      if (f + blockBytes > len) break;
      const bytes = new Uint8Array(buffer, f, blockBytes);
      const w = 1 / scale;
      let y = intIndex - 1;
      y = y > 9 ? y : 9;
      let v = MAGIC_INTS[y] >>> 1;
      let b = MAGIC_INTS[intIndex] >>> 1;
      u[0] = u[1] = u[2] = MAGIC_INTS[intIndex];
      bitState[0] = bitState[1] = bitState[2] = 0;
      h[0] = h[1] = h[2] = 0;
      coords = new Float32Array(natoms * 3);
      let outIdx = 0;
      let extra = 0;
      let mcount = 0;
      let t = 0;
      for (; mcount < natoms; ) {
        if (useRadix) {
          readMixedRadix(bitState, bytes, radixBits, range, h);
        } else {
          h[0] = readBits(bitState, bytes, perDimBits[0]);
          h[1] = readBits(bitState, bytes, perDimBits[1]);
          h[2] = readBits(bitState, bytes, perDimBits[2]);
        }
        mcount++;
        h[0] += minmax[0]; h[1] += minmax[1]; h[2] += minmax[2];
        d[0] = h[0]; d[1] = h[1]; d[2] = h[2];
        t = 0;
        if (readBits(bitState, bytes, 1) === 1) {
          extra = readBits(bitState, bytes, 5);
          t = extra % 3;
          extra -= t;
          t--;
        }
        if (extra > 0) {
          h[0] = h[1] = h[2] = 0;
          for (let k = 0; k < extra; k += 3) {
            readMixedRadix(bitState, bytes, intIndex, u, h);
            mcount++;
            h[0] += d[0] - b; h[1] += d[1] - b; h[2] += d[2] - b;
            if (k === 0) {
              let tmp = h[0]; h[0] = d[0]; d[0] = tmp;
              tmp = h[1]; h[1] = d[1]; d[1] = tmp;
              tmp = h[2]; h[2] = d[2]; d[2] = tmp;
              coords[outIdx++] = d[0] * w;
              coords[outIdx++] = d[1] * w;
              coords[outIdx++] = d[2] * w;
            } else {
              d[0] = h[0]; d[1] = h[1]; d[2] = h[2];
            }
            coords[outIdx++] = h[0] * w;
            coords[outIdx++] = h[1] * w;
            coords[outIdx++] = h[2] * w;
          }
        } else {
          coords[outIdx++] = h[0] * w;
          coords[outIdx++] = h[1] * w;
          coords[outIdx++] = h[2] * w;
        }
        intIndex += t;
        if (t < 0) {
          b = v;
          v = intIndex > 9 ? MAGIC_INTS[intIndex - 1] >>> 1 : 0;
        } else if (t > 0) {
          v = b;
          b = MAGIC_INTS[intIndex] >>> 1;
        }
        u[0] = u[1] = u[2] = MAGIC_INTS[intIndex];
        if (u[0] === 0) throw new Error('Invalid XTC coordinate block (xdrfile error).');
      }
      f += blockBytes;
    }

    // nm -> Angstrom (matches NGL's XtcParser output; the PDB structure is in Angstrom too).
    for (let k = 0; k < coords.length; k++) coords[k] *= 10;
    const box = new Float32Array(9);
    for (let k = 0; k < 9; k++) box[k] = boxRaw[k] * 10;
    yield { coords, box, time, natoms };
    if (f >= len) break;
  }
}

