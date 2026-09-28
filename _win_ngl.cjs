/* Outil de travail : fenêtres de lecture dans le bundle NGL minifié.
   Usage : node _win_ngl.cjs            → écrit _ngl_windows.txt */
const fs = require('fs');
const s = fs.readFileSync('node_modules/ngl/dist/ngl.esm.js', 'utf8');
const out = [];
const win = (label, needle, before = 900, after = 900) => {
  const i = s.indexOf(needle);
  out.push(`########## ${label} (${needle}) @${i} ##########`);
  out.push(i < 0 ? '(not found)' : s.slice(Math.max(0, i - before), i + after));
  out.push('');
};
win('Representation.build', 'build(){this.dispose', 0, 400);
win('build body alt', 'build(){', 0, 300);
win('getBondData definition', 'getBondData(', 0, 700);
win('ball+stick create', 'class nh extends', 0, 1500);
fs.writeFileSync('_ngl_windows.txt', out.join('\n'), 'utf8');
console.log(`_win_ngl.cjs: wrote ${out.length} blocks -> _ngl_windows.txt`);

