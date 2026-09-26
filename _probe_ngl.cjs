// Probe the INSTALLED ngl bundle for the transparency / dither decision.
// Output goes to _ngl_key_ctx.txt (the terminal capture is unreliable here).
const fs = require('fs');

const t = fs.readFileSync('node_modules/ngl/dist/ngl.js', 'utf8');
const out = [`bundle chars=${t.length}`];

const ctx = (key, before, after, max) => {
  let i = -1; let n = 0;
  while ((i = t.indexOf(key, i + 1)) >= 0 && n < max) {
    n += 1;
    out.push(`\n### ${key} @${i}\n${t.slice(Math.max(0, i - before), i + after)}`);
  }
  out.push(`\n### ${key}: ${t.split(key).length - 1} occurrence(s), shown ${n}`);
};

ctx('screendoor', 700, 700, 6);
ctx('forceTransparent', 500, 500, 6);
ctx('opaqueBack', 400, 400, 4);

// Which SOURCE FILE holds the screendoor logic? Look in the sourcemap contents.
const map = JSON.parse(fs.readFileSync('node_modules/ngl/dist/ngl.js.map', 'utf8'));
const hits = [];
(map.sourcesContent || []).forEach((src, i) => {
  if (src && src.indexOf('screendoor') >= 0) hits.push(`${map.sources[i]}  (${src.length} chars)`);
});
out.push(`\n### sources containing screendoor:\n${hits.join('\n') || '(none)'}`);
fs.writeFileSync('_ngl_key_ctx.txt', out.join('\n'));
console.log('WROTE _ngl_key_ctx.txt');


