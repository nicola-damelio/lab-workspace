#!/usr/bin/env node
/* Remove "unnecessary dependency" entries flagged by react-hooks/exhaustive-deps.
   Removing an unused dep from a dependency array is behavior-neutral (the value
   is not referenced inside the hook, so its changes never mattered).
   Usage: node scripts/fix-unnecessary-deps.cjs
*/
const fs = require('fs');
const { execSync } = require('child_process');
let out;
try {
  out = execSync('npx oxlint --format json 2>nul', { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
} catch (e) { out = String(e.stdout || ''); }
const d = JSON.parse(out).diagnostics || [];
const targets = d.filter(x => x.code === 'react-hooks(exhaustive-deps)' && x.message.includes('unnecessary dependency'));

const byFile = {};
for (const t of targets) {
  const sp = t.labels && t.labels[0] && t.labels[0].span;
  if (!sp) continue;
  (byFile[t.filename] = byFile[t.filename] || []).push(sp);
}
let removed = 0;
for (const [file, spans] of Object.entries(byFile)) {
  let text = fs.readFileSync(file, 'utf8');
  const edits = spans.sort((a, b) => b.offset - a.offset);
  for (const sp of edits) {
    const before = text.slice(0, sp.offset);
    const after = text.slice(sp.offset + sp.length);
    // strip surrounding whitespace and one comma
    let lead = '';
    let i = before.length - 1;
    while (i >= 0 && /\s/.test(before[i])) { lead = before[i] + lead; i--; }
    let trail = '';
    let j = 0;
    while (j < after.length && /\s/.test(after[j])) { trail += after[j]; j++; }
    let prefix = before.slice(0, i + 1);
    let suffix = after.slice(j);
    if (suffix.startsWith(',')) suffix = suffix.slice(1);
    else if (prefix.endsWith(',')) prefix = prefix.slice(0, -1);
    text = prefix + suffix;
    removed++;
  }
  fs.writeFileSync(file, text);
  console.log('updated ' + file);
}
console.log('removed ' + removed + ' unnecessary deps');
