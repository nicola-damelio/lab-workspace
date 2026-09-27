// Probe 14: module-level declarations (column 0) — component boundaries.
import fs from 'fs';
const src = fs.readFileSync('src/components/NMRMoleculeViewer.jsx', 'utf8').split(/\r?\n/);
const out = [];
src.forEach((l, i) => {
  if (/^(export )?(default )?(async )?(function|const|let|var|class)\s/.test(l)) out.push((i + 1) + ': ' + l.trim().slice(0, 140));
});
fs.writeFileSync('_t_toplevel.txt', out.join('\r\n'), 'utf8');
console.log('ok', out.length);
