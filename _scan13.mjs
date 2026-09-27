import fs from 'fs';

const V = 'src/components/NMRMoleculeViewer.jsx';
const lines = fs.readFileSync(V, 'utf8').split(/\r?\n/);
const skel = (s) => s.replace(/[^\x20-\x7e]/g, '.');
const out = [];

out.push(`### file lines: ${lines.length} ###`);

const keys = [
  'MeshBuffer', 'addBufferRepresentation', 'flagMeshShadows', 'requestSceneRepaint',
  'buildSectionReps', 'applyCurrentStyleTo', 'nucleicRingPlates', 'setFrameSafe',
  'setFrame(', 'toActualFrame', 'trajRef', 'dispose', 'nucleicRingPlatesOpts',
];
keys.forEach((k) => {
  const hits = [];
  lines.forEach((ln, i) => { if (ln.includes(k)) hits.push(`${i + 1}| ${skel(ln).slice(0, 170)}`); });
  out.push('');
  out.push(`########## ${k} :: ${hits.length} ##########`);
  hits.slice(0, 45).forEach((h) => out.push(h));
  if (hits.length > 45) out.push(`   ... ${hits.length - 45} more`);
});

out.push('');
out.push('########## interior (case-insensitive) ##########');
lines.forEach((ln, i) => { if (/interior/i.test(ln)) out.push(`${i + 1}| ${skel(ln).slice(0, 170)}`); });

const ranges = [[6090, 6140], [10580, 10720]];
ranges.forEach(([a, b]) => {
  out.push('');
  out.push(`########## viewer ${a}-${b} ##########`);
  for (let i = a; i <= b && i <= lines.length; i++) out.push(`${i}| ${skel(lines[i - 1])}`);
});

fs.writeFileSync('_live_scan13.txt', out.join('\n'), 'utf8');
console.log('ok');
