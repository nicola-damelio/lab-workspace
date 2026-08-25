#!/usr/bin/env node
/* One-off tidy tool: remove unused imports and unused catch params flagged by
   oxlint's eslint(no-unused-vars). Conservative — never touches function
   parameters (destructure/alias edge cases are handled manually per file).
   Usage: node scripts/fix-unused-declarations.js  (then re-run oxlint + build)
*/
const fs = require('fs');
const { execSync } = require('child_process');

const out = execSync('npx oxlint --format json 2>nul', { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const diags = JSON.parse(out).diagnostics || [];

const byFile = {};
for (const d of diags) {
  if (d.code !== 'eslint(no-unused-vars)') continue;
  if (!(d.message.includes('imported but never used') || d.message.includes('Catch parameter'))) continue;
  (byFile[d.filename] = byFile[d.filename] || []).push(d.message);
}

const ident = (msg) => { const m = msg.match(/['"]\s*([A-Za-z_$][\w$]*)\s*['"]/); return m ? m[1] : null; };

let importRemoved = 0, catchFixed = 0;

for (const [file, msgs] of Object.entries(byFile)) {
  let text = fs.readFileSync(file, 'utf8');
  let changed = false;
  for (const msg of msgs) {
    const id = ident(msg);
    if (!id) continue;
    if (msg.includes('imported but never used')) {
      // Named import: import { a, b as c } from 'x'  OR  import React, { a, b } from 'x'
      const namedRe = new RegExp('import\\s*(?:[A-Za-z_$][\\w$]*\\s*,)?\\s*\\{([^}]*)\\}\\s*from\\s*[\'\"][^\'\"]+[\'\"]\\s*;?', 'g');
      let done = false;
      text = text.replace(namedRe, (full, names) => {
        if (done) return full;
        const parts = names.split(',').map(s => s.trim());
        const keep = parts.filter(p => {
          const bits = p.split(/\s+as\s+/);
          const base = bits[0].trim();
          const alias = bits.length > 1 ? bits[1].trim() : base;
          return base !== id && alias !== id;
        });
        if (keep.length === parts.length) return full; // not this import
        done = true; importRemoved++;
        if (keep.length === 0) { changed = true; return ''; } // remove whole statement
        return full.replace(names, keep.join(', '));
      });
      if (done) { changed = true; continue; }
      // Default import: import X from 'x'
      const before = text;
      text = text.replace(new RegExp('import\\s+' + id + '\\s+from\\s*[\'\"][^\'\"]+[\'\"]\\s*;?', 'g'), () => { importRemoved++; return ''; });
      if (text !== before) { changed = true; }
      continue;
    }
    if (msg.includes('Catch parameter')) {
      const before = text;
      text = text.replace(new RegExp('catch\\s*\\(\\s*' + id + '\\s*\\)', 'g'), 'catch');
      if (text !== before) { changed = true; catchFixed++; }
    }
  }
  if (changed) { fs.writeFileSync(file, text); console.log('updated ' + file); }
}
console.log('done — imports removed: ' + importRemoved + ', catch bindings: ' + catchFixed);

