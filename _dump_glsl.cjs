// Temporary probe: extract the GLSL sources NGL inlines in dist/ngl.js so the
// transparency of a surface can be READ instead of guessed. Usage:
//   node _dump_glsl.cjs            -> writes _glsl/<name>.glsl for every shader
//   node _dump_glsl.cjs surface    -> only the names containing "surface"
// (No backslash is written literally in this file on purpose: the editor escapes
// them, so every one is built with String.fromCharCode.)
const fs = require('fs');
const BS = String.fromCharCode(92);
const LF = String.fromCharCode(10);
const TB = String.fromCharCode(9);
const QUOTE = String.fromCharCode(34);
const t = fs.readFileSync('node_modules/ngl/dist/ngl.js', 'utf8');
const filter = (process.argv[2] || '').toLowerCase();
const NEEDLE = 'add(' + QUOTE + 'shader/';
fs.mkdirSync('_glsl', { recursive: true });
const unescape = (src) => src
  .split(BS + 'n').join(LF)
  .split(BS + 't').join(TB)
  .split(BS + 'r').join('')
  .split(BS + QUOTE).join(QUOTE);
let from = 0;
let n = 0;
for (;;) {
  const at = t.indexOf(NEEDLE, from);
  if (at < 0) break;
  from = at + NEEDLE.length;
  const keyEnd = t.indexOf(QUOTE, from);
  const key = t.slice(from, keyEnd);
  if (filter && !key.toLowerCase().includes(filter)) continue;
  const start = t.indexOf(QUOTE, keyEnd + 1) + 1;
  let i = start;
  let raw = '';
  while (i < t.length) {
    const c = t[i];
    if (c.charCodeAt(0) === 92) { raw += t.slice(i, i + 2); i += 2; continue; }
    if (c === QUOTE) break;
    raw += c;
    i += 1;
  }
  const out = '_glsl/' + key.replace(/[/]/g, '__');
  fs.writeFileSync(out, unescape(raw));
  console.log('WROTE', out, raw.length);
  n += 1;
}
console.log('total', n);
