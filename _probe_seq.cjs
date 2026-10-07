// Dump the requested code ranges to a text file (avoiding shell-output limits).
const fs = require('fs');
const out = [];
const dump = (file, from, to, label) => {
  out.push('===== ' + (label || file) + ' [' + from + '-' + to + '] =====');
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = from - 1; i < Math.min(to, lines.length); i += 1) out.push(String(i + 1).padStart(5) + '| ' + lines[i]);
  out.push('');
};
const grep = (files, re, label) => {
  out.push('===== grep ' + label + ' =====');
  files.forEach((f) => {
    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
    lines.forEach((l, i) => { if (re.test(l)) out.push(`${f}:${i + 1}: ${l.trim()}`); });
  });
  out.push('');
};
dump('src/utils/sequenceCharge.js', 50, 190);
grep(['src/components/NMRData.jsx', 'src/components/MDData.jsx', 'src/components/DockingData.jsx'], /rawSequence|parseSequence|analyzeProteinSequence|seqNaturesNote/, 'derived data');
const found = [];
const walk = (dir) => {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = dir + '/' + e.name;
    if (e.isDirectory()) { if (!/node_modules|\.git|dist|_\w/.test(e.name)) walk(p); } else if (/cloningUtils/.test(e.name)) found.push(p);
  });
};
walk('src');
out.push('===== cloningUtils path: ' + JSON.stringify(found) + ' =====');
found.forEach((f) => dump(f, 1, 120, f));
fs.writeFileSync('_probe_seq.txt', out.join('\n'), 'utf8');
console.log('ok');
