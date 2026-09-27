import fs from 'fs';
const src = fs.readFileSync('src/components/NMRMoleculeViewer.jsx', 'utf8');
const lines = src.split(/\r?\n/);
let out = '';
const block = (title, a, b) => {
  out += `\n===== ${title} (${a}..${b}) =====\n`;
  for (let i = a; i <= b && i <= lines.length; i++) out += `${i}: ${lines[i - 1]}\n`;
};
block('setFrameSafe', 6100, 6135);
block('traj player + frame change', 10590, 10740);
block('requestSceneRepaint body', 11405, 11425);
block('addPlates head', 9330, 9405);
block('addPlates call site', 9470, 9530);
block('addRingPlates call site', 9730, 9760);
block('ring plate control', 14725, 14745);
out += '\n===== MeshBuffer / Buffer mentions (dist bundle) =====\n';
fs.writeFileSync('_t_frame4.txt', out);
console.log('ok', out.length);
