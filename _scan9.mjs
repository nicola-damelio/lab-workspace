import fs from 'fs';

const V = 'src/components/NMRMoleculeViewer.jsx';
const src = fs.readFileSync(V, 'utf8');
const lines = src.split(/\r?\n/);
const ascii = (s) => s.replace(/[^\x20-\x7E]/g, '.');

const pats = [
  'setExtraMolPosition', 'setMainPosition', 'resetExtraMolPosition', 'resetMainPosition',
  'type="number"', 'type=\'number\'',
  'addRingPlates', 'frameChanged', 'signals.refreshed', 'updatePosition(',
  'buildSectionReps', 'applyCurrentStyleTo', 'MeshBuffer', 'nucleicRingPlates',
  'trajectory.signals', 'onFrame', 'currentFrame', 'setFrameSafe', 'setFrame(',
  'position: !0', 'updateRepresentations'
];

let out = [];
out.push('### counts (live src/components/NMRMoleculeViewer.jsx) ###');
for (const p of pats) {
  const hits = [];
  lines.forEach((ln, i) => { if (ln.includes(p)) hits.push(i + 1); });
  out.push(`${p} :: ${hits.length} :: ${hits.slice(0, 60).join(',')}`);
}

out.push('');
out.push('### contexts ###');
const want = [
  'setExtraMolPosition', 'setMainPosition', 'type="number"', 'type=\'number\'',
  'frameChanged', 'signals.refreshed', 'updatePosition(', 'addRingPlates',
  'nucleicRingPlates', 'setFrameSafe', 'setFrame(', 'updateRepresentations'
];
lines.forEach((ln, i) => {
  if (want.some((p) => ln.includes(p))) out.push(`${i + 1}| ${ascii(ln).slice(0, 190)}`);
});

out.push('');
out.push('### total lines ###');
out.push(String(lines.length));

fs.writeFileSync('_live_scan9.txt', out.join('\n'), 'utf8');
console.log('ok');
