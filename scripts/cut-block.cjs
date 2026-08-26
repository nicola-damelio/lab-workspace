#!/usr/bin/env node
/* Cut a complete top-level JS statement starting at the line whose trimmed
   text begins with <startPattern>. Uses brace/paren/bracket counting to find
   the exact end (must land on a line ending with ; or } or ]). Then removes
   the statement plus one trailing blank line. Exits 2 if boundaries look off.
   Usage: node scripts/cut-block.cjs <file> "<startPattern>"
*/
const fs = require('fs');
const file = process.argv[2];
const pat = new RegExp(process.argv[3]);
const lines = fs.readFileSync(file, 'utf8').split('\n');
let start = -1;
for (let i = 0; i < lines.length; i++) {
  if (pat.test(lines[i].trim())) { start = i; break; }
}
if (start < 0) { console.error('start not found'); process.exit(2); }
let depth = 0; let end = -1;
for (let i = start; i < lines.length; i++) {
  const line = lines[i];
  const stripped = line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '');
  for (const ch of stripped) {
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') depth--;
  }
  if (depth === 0 && i > start) {
    const t = line.trim();
    if (t === '}' || t === '};' || t === '];' || t.endsWith(';')) { end = i; break; }
  }
}
if (end < 0) { console.error('end not found'); process.exit(2); }
// confirm the start/end look like a complete statement
const block = lines.slice(start, end + 1).join('\n');
const close = block.trimEnd().endsWith(';') || block.trimEnd().endsWith('}') || block.trimEnd().endsWith(']');
if (!close) { console.error('block does not close cleanly'); process.exit(2); }
const out = lines.slice(0, start).concat(lines.slice(end + 1));
// collapse double blank lines left behind
const final = [];
for (let i = 0; i < out.length; i++) {
  if (i > 0 && out[i].trim() === '' && out[i - 1].trim() === '') continue;
  final.push(out[i]);
}
fs.writeFileSync(file, final.join('\n'));
console.log('cut ' + (end - start + 1) + ' lines from line ' + (start + 1) + ' in ' + file);
