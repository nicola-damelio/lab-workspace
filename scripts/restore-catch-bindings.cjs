#!/usr/bin/env node
/* Restore catch bindings that were stripped (catch (e) -> catch) but whose
   bodies still reference the binding name. Only touches catch blocks whose
   line-range contains an eslint(no-undef) flag for `e`/`err`.
   Usage: node scripts/restore-catch-bindings.cjs
*/
const fs = require('fs');
const { execSync } = require('child_process');

function strip(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\r\n]*/g, ' ')
    .replace(/`(?:[^`\\]|\\.)*`/g, ' ')
    .replace(/"(?:[^"\\]|\\.)*"/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, ' ');
}

let out;
try {
  out = execSync('npx oxlint --format json 2>nul', { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
} catch (e) { out = String(e.stdout || ''); }
const d = JSON.parse(out).diagnostics || [];
const flagged = {}; // file -> Set of lines to fix
for (const x of d) {
  if (x.code !== 'eslint(no-undef)') continue;
  const idm = x.message.match(/'([A-Za-z_$][\w$]*)'/);
  const id = idm ? idm[1] : null;
  if (id !== 'e' && id !== 'err') continue;
  const lbl = x.labels && x.labels[0] && x.labels[0].span;
  if (!lbl) continue;
  (flagged[x.filename] = flagged[x.filename] || new Set()).add(lbl.line);
}

let fixed = 0;
for (const [file, flagLines] of Object.entries(flagged)) {
  let text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/catch\s*\{/);
    if (!m) continue;
    // find the catch block extent: start depth=1 at the catch `{`, then count
    // braces AFTER it on the same line and all following lines.
    let depth = 1;
    let bodyEnd = -1;
    const afterBrace = strip(line.slice(line.indexOf('{', m.index) + 1));
    for (const ch of afterBrace) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    for (let j = i + 1; j < lines.length; j++) {
      const l = strip(lines[j]);
      for (const ch of l) {
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
      }
      if (depth === 0) { bodyEnd = j; break; }
    }
    if (bodyEnd < 0) continue;
    // does this block contain any flagged line (1-based) for e/err?
    let id = null;
    for (let ln = i + 2; ln <= bodyEnd + 1; ln++) {
      if (flagLines.has(ln)) {
        const body = strip(lines.slice(i + 1, bodyEnd).join('\n'));
        id = /\berr\b/.test(body) ? 'err' : 'e';
        break;
      }
    }
    if (!id) continue;
    lines[i] = line.replace(/(catch)\s*\{/, '$1 (' + id + ') {');
    fixed++;
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(file, lines.join('\n'));
    console.log('updated ' + file.split('\\').pop());
  }
}
console.log('restored ' + fixed + ' catch bindings');
