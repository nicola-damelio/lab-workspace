// Temporary probe #2: same as _dump_ngl_src.cjs but keeps the WHOLE ngl source
// path in the file name, so two files that end with the same name never collide.
// Usage: node _dump2.cjs buffer.ts doublesided-buffer.ts ...
const fs = require('fs');
const SLASH = String.fromCharCode(47);
const map = JSON.parse(fs.readFileSync('node_modules/ngl/dist/ngl.js.map', 'utf8'));
const wanted = process.argv.slice(2);
fs.mkdirSync('_ngl_full', { recursive: true });
map.sources.forEach((n, i) => {
  if (!wanted.some((w) => n.endsWith(SLASH + w))) return;
  const out = '_ngl_full/' + n.split(SLASH).join('__');
  fs.writeFileSync(out, (map.sourcesContent || [])[i] || '');
  console.log('WROTE', out);
});
