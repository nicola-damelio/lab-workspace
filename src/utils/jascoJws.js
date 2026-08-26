/* =========================================================================
   src/utils/jascoJws.js
   Parser for native JASCO Spectra Manager .jws files (CD / UV-Vis spectra).

   Two formats are supported (mirroring the Python jwsProcessor / jwsConverter
   reference implementations):
     1. Legacy "v1.5" flat binary: magic bytes "L~S " (0x4C 0x7E 0x53 0x20),
        a fixed 0x740-byte header and float32 channel data at offset 0x740.
     2. Modern OLE2 compound-document format: magic D0 CF 11 E0, with a
        "DataInfo" stream (axis metadata) and a "Y-Data" stream (float32
        samples, little-endian).

   The returned object matches the shape used by the CD page's applyJasco():
   { xs, ys, nPoints, title, meta }.
   ========================================================================= */

const CFB_ENDOFCHAIN = 0xfffffffe;
const CFB_FREESECT = 0xffffffff;

const dvOf = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const u32 = (dv, off) => dv.getUint32(off, true);
const f64 = (dv, off) => dv.getFloat64(off, true);
const f32 = (dv, off) => dv.getFloat32(off, true);

/* =========================================================================
   Minimal OLE2 / Compound File Binary (CFB) reader
   ========================================================================= */
export function parseCfb(data) {
  const dv = dvOf(data);
  if (data.length < 512 || u32(dv, 0) !== 0xe011cfd0) {
    throw new Error('Not an OLE2 / CFB file');
  }

  const major = dv.getUint16(0x1a, true);
  const sectorShift = dv.getUint16(0x1e, true);
  const sectorSize = sectorShift ? 1 << sectorShift : major === 4 ? 4096 : 512;
  const miniSectorSize = 1 << dv.getUint16(0x20, true);
  const firstDirSector = u32(dv, 0x30);
  const miniCutoff = u32(dv, 0x38);
  const firstMiniFatSector = u32(dv, 0x3c);
  const numMiniFatSectors = u32(dv, 0x40);
  const firstDifatSector = u32(dv, 0x44);
  const numDifatSectors = u32(dv, 0x48);

  // ---- DIFAT: ordered list of FAT sector indices -------------------------
  const difat = [];
  for (let i = 0; i < 109; i++) {
    const v = u32(dv, 0x4c + i * 4);
    if (v === CFB_FREESECT) break;
    difat.push(v);
  }
  if (numDifatSectors > 0 && firstDifatSector !== CFB_ENDOFCHAIN) {
    const perSector = sectorSize / 4;
    let sector = firstDifatSector;
    for (let d = 0; d < numDifatSectors && sector >= 0 && sector !== CFB_ENDOFCHAIN; d++) {
      const off = (sector + 1) * sectorSize;
      for (let i = 0; i < perSector - 1; i++) {
        const v = u32(dv, off + i * 4);
        if (v === CFB_FREESECT) break;
        difat.push(v);
      }
      sector = u32(dv, off + (perSector - 1) * 4);
    }
  }

  // ---- FAT -----------------------------------------------------------------
  const fat = [];
  for (const s of difat) {
    if (s === CFB_FREESECT || s === CFB_ENDOFCHAIN) continue;
    const off = (s + 1) * sectorSize;
    for (let i = 0; i < sectorSize / 4; i++) fat.push(u32(dv, off + i * 4));
  }
  if (!fat.length) throw new Error('Empty FAT');

  // Read a chain of full sectors (returns concatenated bytes).
  const readChain = (startSector) => {
    const chunks = [];
    let s = startSector;
    let guard = 0;
    while (s !== CFB_ENDOFCHAIN && s !== CFB_FREESECT && s >= 0 && guard++ < 10000000) {
      chunks.push(data.subarray((s + 1) * sectorSize, (s + 2) * sectorSize));
      s = fat[s] === undefined ? CFB_ENDOFCHAIN : fat[s];
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of chunks) {
      out.set(c, p);
      p += c.length;
    }
    return out;
  };


  // ---- Directory -----------------------------------------------------------
  const dirBytes = readChain(firstDirSector);
  const entries = [];
  for (let off = 0; off + 128 <= dirBytes.length; off += 128) {
    const ddv = dvOf(dirBytes.subarray(off, off + 128));
    const nameLen = ddv.getUint16(0x40, true);
    let name = '';
    if (nameLen >= 2) {
      try {
        name = new TextDecoder('utf-16le').decode(dirBytes.subarray(off, off + nameLen - 2));
      } catch {
        name = '';
      }
    }
    const type = dirBytes[off + 0x42];
    const startSector = ddv.getUint32(0x74, true);
    const size = Number(ddv.getBigUint64(0x78, true));
    entries.push({ name, type, startSector, size });
  }

  const root = entries.find((e) => e.type === 5);
  if (!root) throw new Error('CFB root entry not found');

  // The root entry's stream is the mini-stream container.
  const miniStream = readChain(root.startSector).subarray(0, root.size);

  // ---- MiniFAT --------------------------------------------------------------
  const miniFAT = [];
  if (numMiniFatSectors > 0 && firstMiniFatSector !== CFB_ENDOFCHAIN) {
    const mfBytes = readChain(firstMiniFatSector);
    const mfdv = dvOf(mfBytes);
    for (let i = 0; i + 4 <= mfBytes.length; i += 4) miniFAT.push(mfdv.getUint32(i, true));
  }

  // Read a named stream (handles both mini and regular streams).
  const readStream = (entry) => {
    if (entry.size < miniCutoff) {
      const out = new Uint8Array(entry.size);
      let s = entry.startSector;
      let pos = 0;
      let guard = 0;
      while (s !== CFB_ENDOFCHAIN && s !== CFB_FREESECT && s >= 0 && guard++ < 10000000) {
        const chunk = Math.min(miniSectorSize, entry.size - pos);
        const base = s * miniSectorSize;
        for (let i = 0; i < chunk; i++) out[pos + i] = miniStream[base + i] || 0;
        pos += chunk;
        if (pos >= entry.size) break;
        s = miniFAT[s] === undefined ? CFB_ENDOFCHAIN : miniFAT[s];
      }
      return out.subarray(0, entry.size);
    }
    return readChain(entry.startSector).subarray(0, entry.size);
  };

  const getStream = (name) => {
    const e = entries.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return e ? readStream(e) : null;
  };

  return { getStream, entries };
}

/* =========================================================================
   JASCO .jws — legacy v1.5 flat format
   Header layout (from jwslib.py JWS_150_HEADER_FORMAT):
     [0] uint32  magic            @ 0x00
     [2] uint16  nChannels        @ 0x82 (130)
     [3] uint32  nPoints          @ 0x84 (132)
     [4] float64 xFirst           @ 0x8C (140)
     [5] float64 xLast            @ 0x94 (148)
     [6] float64 xIncrement       @ 0x9C (156)
     [12] int32  dataSize (bytes) @ 0xC8 (200)
   Channel data starts at 0x740, float32 little-endian, nPoints per channel.
   ========================================================================= */
function parseJasco150(data) {
  const dv = dvOf(data);
  if (data.length < 0x740) throw new Error('Invalid JWS v1.5 file (too small)');
  const nChannels = dv.getUint16(130, true);
  const nPoints = dv.getUint32(132, true);
  const xFirst = f64(dv, 140);
  const xLast = f64(dv, 148);
  const xInc = f64(dv, 156);
  const dataSize = dv.getInt32(200, true);
  if (!(nPoints > 0 && nPoints < 10000000 && nChannels > 0 && nChannels < 100)) {
    throw new Error('Invalid JWS v1.5 header values');
  }
  if (dataSize !== nPoints * nChannels * 4) {
    throw new Error('JWS v1.5 data size mismatch');
  }
  if (data.length < 0x740 + dataSize) throw new Error('JWS v1.5 file truncated');

  const channels = [];
  for (let c = 0; c < nChannels; c++) {
    const off = 0x740 + c * nPoints * 4;
    const arr = new Float64Array(nPoints);
    for (let i = 0; i < nPoints; i++) arr[i] = f32(dv, off + i * 4);
    channels.push(arr);
  }

  const xs = new Float64Array(nPoints);
  for (let i = 0; i < nPoints; i++) xs[i] = xFirst + i * xInc;

  return {
    xs: Array.from(xs),
    ys: Array.from(channels[0]),
    nPoints,
    title: '',
    meta: { format: 'jws-v1.5', xFirst, xLast, xIncrement: xInc }
  };
}

/* =========================================================================
   JASCO .jws — modern OLE2 format
   DataInfo stream (DATAINFO_FMT '<LLLLLLdddLLLLdddd', little-endian):
     [3] uint32  nChannels  @ 0x0C
     [5] uint32  nPoints    @ 0x14
     [6] float64 xFirst     @ 0x18
     [7] float64 xLast      @ 0x20
     [8] float64 xIncrement @ 0x28
   Y-Data stream: nChannels x nPoints float32 (little-endian).
   ========================================================================= */
function parseJascoOle(data) {
  const cfb = parseCfb(data);
  const infoStream = cfb.getStream('DataInfo');
  const yStream = cfb.getStream('Y-Data');
  if (!infoStream || !yStream) throw new Error('Missing DataInfo / Y-Data streams');

  const idv = dvOf(infoStream);
  if (infoStream.length < 96) throw new Error('DataInfo stream too short');
  const nChannels = idv.getUint32(0x0c, true);
  const nPoints = idv.getUint32(0x14, true);
  const xFirst = idv.getFloat64(0x18, true);
  const xLast = idv.getFloat64(0x20, true);
  const xInc = idv.getFloat64(0x28, true);
  if (!(nPoints > 0 && nPoints < 10000000 && nChannels > 0 && nChannels < 100)) {
    throw new Error('Invalid DataInfo header values');
  }

  const expectedBytes = nPoints * nChannels * 4;
  if (yStream.length < expectedBytes) throw new Error('Y-Data stream shorter than expected');

  const ydv = dvOf(yStream);
  const channels = [];
  for (let c = 0; c < nChannels; c++) {
    const off = c * nPoints * 4;
    const arr = new Float64Array(nPoints);
    for (let i = 0; i < nPoints; i++) arr[i] = ydv.getFloat32(off + i * 4, true);
    channels.push(arr);
  }

  // X axis: linear ramp from xFirst to xLast (matches the reference tools).
  const xs = new Float64Array(nPoints);
  for (let i = 0; i < nPoints; i++) {
    xs[i] = nPoints > 1 ? xFirst + (xLast - xFirst) * (i / (nPoints - 1)) : xFirst;
  }

  return {
    xs: Array.from(xs),
    ys: Array.from(channels[0]),
    nPoints,
    title: '',
    meta: { format: 'jws-ole', xFirst, xLast, xIncrement: xInc }
  };
}

/**
 * Parse a native JASCO .jws file (binary ArrayBuffer) into the
 * { xs, ys, nPoints, title, meta } shape used by the CD page importer.
 */
export function parseJascoJwsBinary(arrayBuffer) {
  const data = new Uint8Array(arrayBuffer);
  if (data.length < 4) throw new Error('File too small');
  if (data[0] === 0x4c && data[1] === 0x7e && data[2] === 0x53 && data[3] === 0x20) {
    return parseJasco150(data);
  }
  if (data[0] === 0xd0 && data[1] === 0xcf && data[2] === 0x11 && data[3] === 0xe0) {
    return parseJascoOle(data);
  }
  throw new Error('Unrecognized .jws format (not JASCO v1.5 or OLE2 compound document)');
}

/** True if the file starts with a recognised JASCO .jws binary signature. */
export function isJascoJwsBinary(arrayBuffer) {
  const b = new Uint8Array(arrayBuffer);
  return (
    b.length >= 4 &&
    ((b[0] === 0x4c && b[1] === 0x7e && b[2] === 0x53 && b[3] === 0x20) ||
      (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0))
  );
}

