import fs from 'fs';
const src = fs.readFileSync('src/components/NMRMoleculeViewer.jsx', 'utf8');
const lines = src.split(/\r?\n/);
let out = '';
const block = (title, a, b) => {
  out += `\n===== ${title} (${a}..${b}) =====\n`;
  for (let i = a; i <= b && i <= lines.length; i++) out += `${i}: ${lines[i - 1]}\n`;
};
out += '===== plate call sites =====\n';
lines.forEach((l, i) => {
  if (/nucleicRingPlates|addBufferRepresentation|setBuffer|BufferRepresentation|MeshBuffer|ringPlate|addPlates|platesRef|plateReps/i.test(l)) {
    out += `${i + 1}: ${l.trimEnd()}\n`;
  }
});
block('scenerepaint', 11400, 11700);
block('catEspZone', 9640, 9720);
fs.writeFileSync('_t_frame3.txt', out);
console.log('ok', out.length);
