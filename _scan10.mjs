import fs from 'fs';

const V = 'src/components/NMRMoleculeViewer.jsx';
const src = fs.readFileSync(V, 'utf8');
const lines = src.split(/\r?\n/);
const ascii = (s) => s.replace(/[^\x20-\x7E]/g, '.');

const pats = [
  'signals', 'setCurrentFrame', 'currentFrame', 'requestAnimationFrame',
  'trajectoryRef', 'trajRef', 'atomIndices', 'interior', 'frameIndex',
  'frameOf', 'setFrameSafe', 'toActualFrame'
];

let out = [];
out.push('### counts ###');
for (const p of pats) {
  const hits = [];
  lines.forEach((ln, i) => { if (ln.includes(p)) hits.push(i + 1); });
  out.push(`${p} :: ${hits.length} :: ${hits.slice(0, 80).join(',')}`);
}

out.push('');
out.push('### signals contexts ###');
lines.forEach((ln, i) => {
  if (ln.includes('signals')) out.push(`${i + 1}| ${ascii(ln).slice(0, 180)}`);
});

out.push('');
out.push('### atomIndices contexts ###');
lines.forEach((ln, i) => {
  if (ln.includes('atomIndices')) out.push(`${i + 1}| ${ascii(ln).slice(0, 180)}`);
});

fs.writeFileSync('_live_scan10.txt', out.join('\n'), 'utf8');
console.log('ok');
