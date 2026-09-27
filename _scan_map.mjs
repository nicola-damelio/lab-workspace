import fs from 'fs';
const V = 'src/components/NMRMoleculeViewer.jsx';
const v = fs.readFileSync(V, 'utf8').split(/\r?\n/);
const out = [];
out.push('--- top-level declarations (col 0) 7200..12200 ---');
v.forEach((l, i) => {
  const n = i + 1;
  if (n < 7200 || n > 12200) return;
  if (/^(const|function|export|class)\s+[A-Za-z_$][\w$]*/.test(l)) out.push(`${n}: ${l.slice(0, 120)}`);
});
out.push('--- refs / useRef / useState 7200..12200 ---');
v.forEach((l, i) => {
  const n = i + 1;
  if (n < 7200 || n > 12200) return;
  if (/useRef\(|Ref\.current\s*=|useState\(/.test(l) && /^\s{0,4}(const|let)\s/.test(l)) out.push(`${n}: ${l.trim().slice(0, 120)}`);
});
out.push('--- nucleicRingPlates walk 4554..4620 ---');
out.push(...v.slice(4553, 4620).map((l, k) => `${4554 + k}: ${l}`));
fs.writeFileSync('_t_map.txt', out.join('\n'));
console.log('ok', out.length);
