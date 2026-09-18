/* =========================================================================
   dataUrlBytes — turn ANY data:URL into raw bytes.

   WHY THIS EXISTS: a data:URL is not always base64.

     • a saved figure of a VECTOR chart (the recharts <svg> plots of the Flow
       Cytometry / NMR / CD pages) is captured as
           'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)
       i.e. a PERCENT-ENCODED payload — there is no ';base64' marker at all;
     • canvas captures (📷, Image Builder), pasted images, .fcs raw data and
       FileReader.readAsDataURL() results ARE base64.

   Code that assumed base64 and called atob() on the payload therefore broke on
   every vector figure with exactly

       Failed to execute 'atob' on 'Window': The string to be decoded is not
       correctly encoded.

   which is what made the cloud copy of those figures fail while the local one
   was written fine ("kept in this browser" instead of "☁ Drive").

   So the decoder reads the data:URL itself instead of guessing:
     • ';base64' present → base64 decode, TOLERANT of what atob() rejects:
       whitespace / line breaks, the URL-safe alphabet ('-', '_') and a missing
       '=' padding;
     • otherwise         → percent-decode → UTF-8 bytes (an isolated '%' cannot
       make the whole image fail: it is repaired first);
     • not a data:URL    → the UTF-8 bytes of the string itself (never throws).

   Pure: no DOM, no network — only Uint8Array / TextEncoder / Blob.
   ========================================================================= */

const hasTextEncoder = typeof TextEncoder !== 'undefined';
const encoder = hasTextEncoder ? new TextEncoder() : null;

/** UTF-8 bytes of a string (TextEncoder when available — the browser case —,
 *  Latin-1 bytes otherwise: only ever reached for ASCII payloads). */
const utf8Bytes = (text) => {
  const s = String(text == null ? '' : text);
  if (encoder) return encoder.encode(s);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

/** Raw byte values of a string whose code units ARE bytes (Latin-1). */
const latin1Bytes = (text) => {
  const s = String(text == null ? '' : text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};


/* ── the base64 alphabet, plus the URL-safe variant ───────────────────────── */
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i += 1) table[B64_ALPHABET.charCodeAt(i)] = i;
  table['-'.charCodeAt(0)] = 62;
  table['_'.charCodeAt(0)] = 63;
  return table;
})();
// Strictly what atob() accepts: 4-character groups, no foreign character.
const STRICT_B64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Split "data:[<mime>][;param=value…][;base64],<payload>" into its parts.
 * @returns {{ mime:string, isBase64:boolean, payload:string }|null} null when the
 *   string is not a data:URL (no "data:" prefix, or no comma).
 */
export const splitDataUrl = (dataUrl) => {
  const s = String(dataUrl == null ? '' : dataUrl);
  if (!/^data:/i.test(s)) return null;
  const comma = s.indexOf(',');
  if (comma < 0) return null;
  const head = s.slice(5, comma);
  const params = head.split(';');
  const mime = (params.shift() || '').trim();
  return {
    mime,
    isBase64: params.some((p) => /^base64$/i.test(p.trim())),
    payload: s.slice(comma + 1)
  };
};

/** MIME type carried by a data:URL ('' when it is not one, or declares none). */
export const dataUrlMime = (dataUrl) => {
  const parts = splitDataUrl(dataUrl);
  return parts ? parts.mime : '';
};

/**
 * Decode a base64 payload into bytes, accepting what atob() refuses: spaces and
 * line breaks, the URL-safe alphabet and missing '=' padding. The native atob()
 * is still used — and is much faster — for the strict case (megabyte captures).
 */
export const base64ToBytes = (b64) => {
  const s = String(b64 == null ? '' : b64);
  if (s.length % 4 === 0 && STRICT_B64.test(s) && typeof atob === 'function') {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c === 61) break;                       // '=' → end of the padding
    if (c > 127) continue;
    const v = B64_LOOKUP[c];
    if (v < 0) continue;                       // whitespace, '\n', stray char
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
};

/** Percent-encoded payload → bytes. An isolated '%' (a truncated URL, or a raw
 *  '%' inside the XML) must not cost the whole image: it is escaped first. */
const percentToBytes = (payload) => {
  const s = String(payload == null ? '' : payload);
  try {
    return utf8Bytes(decodeURIComponent(s));
  } catch { /* isolated '%' */ }
  try {
    return utf8Bytes(decodeURIComponent(s.replace(/%(?![0-9a-fA-F]{2})/g, '%25')));
  } catch { /* not percent-encoded at all */ }
  return latin1Bytes(s);
};

/**
 * Raw bytes of any data:URL (base64 OR percent-encoded). Never throws: a string
 * that is not a data:URL yields its own UTF-8 bytes.
 */
export const dataUrlToBytes = (dataUrl) => {
  const parts = splitDataUrl(dataUrl);
  if (!parts) return utf8Bytes(String(dataUrl == null ? '' : dataUrl));
  return parts.isBase64 ? base64ToBytes(parts.payload) : percentToBytes(parts.payload);
};

/**
 * data:URL → Blob (upload bodies, embedImage, …). `mimeType` overrides the type
 * declared by the data:URL; otherwise that declared type is used, falling back
 * to application/octet-stream exactly like the previous helper did.
 */
export const dataUrlToBlob = (dataUrl, mimeType = '') => {
  const type = mimeType || dataUrlMime(dataUrl) || 'application/octet-stream';
  return new Blob([dataUrlToBytes(dataUrl)], { type });
};

