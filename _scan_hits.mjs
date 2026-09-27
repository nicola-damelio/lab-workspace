// Probe 13: the frame/trajectory + ring-plate machinery, by line number.
import fs from 'fs';
const src = fs.readFileSync('src/components/NMRMoleculeViewer.jsx', 'utf8').split(/\r?\n/);
const pats = {
  component: /export default function|const NMRMoleculeViewer|function NMRMoleculeViewer/,
  jsxReturn: /^  return \(/,
  plates: /addPlates|ringPlate|RingPlate|nucleicRingPlates|trackBase|plate/i,
  frame: /frameChanged|currentFrame|setFrame|frameIndex|trajFrames|useTraj|trajectory/i,
  refs: /useRef\(/,
  effects: /useEffect\(/,
};
const out = [];
out.push('TOTAL ' + src.length);
for (const [k, re] of Object.entries(pats)) {
  out.push('');
  out.push('=== ' + k + ' ===');
  let n = 0;
  src.forEach((l, i) => { if (re.test(l) && n < 90) { out.push((i + 1) + ': ' + l.trim().slice(0, 160)); n += 1; } });
  out.push('(' + n + ' shown)');
}
fs.writeFileSync('_t_hits.txt', out.join('\r\n'), 'utf8');
console.log('ok');
