import fs from 'fs';
const src = fs.readFileSync('src/components/NMRMoleculeViewer.jsx', 'utf8');
const lines = src.split(/\r?\n/);
const pats = [
  ['plate', /plate/i],
  ['frame-change', /currentFrame|setFrameSafe|setFrame\b|frameCount|numFrames/],
  ['catEsp', /catEspRepsRef/],
  ['requestRepaint', /requestSceneRepaint/],
];
let out = '';
for (const [name, re] of pats) {
  out += `\n===== ${name} (${re}) =====\n`;
  lines.forEach((l, i) => {
    if (re.test(l)) out += `${i + 1}: ${l.trimEnd()}\n`;
  });
}
fs.writeFileSync('_t_frame2.txt', out);
console.log('lines', lines.length, 'out', out.length);
