// Temporary probe: dump the NGL 2.4 TypeScript sources we need to READ (never
// shipped) out of node_modules/ngl/dist/ngl.js.map into _ngl_src/.
const fs = require('fs');
const map = JSON.parse(fs.readFileSync('node_modules/ngl/dist/ngl.js.map', 'utf8'));
const wanted = process.argv.slice(2);
fs.mkdirSync('_ngl_src', { recursive: true });
for (let i = 0; i < map.sources.length; i++) {
  const n = map.sources[i];
  const hit = wanted.find((w) => n.endsWith('/' + w) || n === 'src/' + w || n.endsWith(w));
  if (!hit) continue;
  const src = (map.sourcesContent || [])[i] || '';
  const out = '_ngl_src/' + hit.replace(/\//g, '__');
  fs.writeFileSync(out, src);
  console.log('WROTE', out, src.length);
}
