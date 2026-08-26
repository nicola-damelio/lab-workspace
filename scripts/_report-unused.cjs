const fs = require('fs');
const { execSync } = require('child_process');
let out;
try {
  out = execSync('npx oxlint --format json 2>nul', { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
} catch (e) {
  out = String(e.stdout || '');
}
const d = JSON.parse(out).diagnostics || [];
const uv = d.filter(x => x.code === 'eslint(no-unused-vars)');
const cache = {};
for (const x of uv) {
  const f = x.filename;
  if (!cache[f]) cache[f] = fs.readFileSync(f, 'utf8').split('\n');
  const sp = x.labels && x.labels[0] && x.labels[0].span;
  const line = sp ? (cache[f][sp.line - 1] || '').trim().slice(0, 88) : '?';
  const idm = x.message.match(/[A-Za-z_$][\w$]*/);
  const kind = x.message.includes('Parameter') ? 'P' : (x.message.includes('assigned') ? 'A' : 'V');
  console.log(kind + ' ' + (f.replace(/.*src\//, '')) + ':' + (sp ? sp.line : '?') + ' ' + (idm ? idm[0] : '?') + ' => ' + line);
}
