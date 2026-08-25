const fs = require('fs');
const { execSync } = require('child_process');
let out;
try {
  out = execSync('npx oxlint --format json src/components/MDSections.jsx', { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
} catch (e) { out = String(e.stdout || ''); }
const d = JSON.parse(out).diagnostics || [];
const un = d.filter(x => x.code === 'react-hooks(exhaustive-deps)');
const txt = fs.readFileSync('src/components/MDSections.jsx', 'utf8');
console.log('total exhaustive-deps: ' + un.length);
for (const x of un.slice(0, 8)) {
  const sp = x.labels && x.labels[0] && x.labels[0].span;
  const t = sp ? txt.slice(sp.offset, sp.offset + sp.length) : '?';
  console.log((sp ? 'line ' + sp.line + ' col ' + sp.column + ' len ' + sp.length + ' [' + t + ']' : 'no-span') + ' :: ' + x.message.slice(0, 80));
}
