/* =========================================================================
   _clean_dead.cjs — outil TEMPORAIRE de nettoyage du code mort.

   Il enlève EXACTEMENT ce que oxlint signale comme `eslint(no-unused-vars)`
   (aucune devinette : la liste vient du linter) sur les fichiers passés en
   argument : la déclaration ENTIÈRE et le bloc de commentaires qui lui est
   collé au-dessus (une ligne vide suffit à arrêter la remontée, donc un
   commentaire qui documente autre chose n'est jamais emporté).

   La fin de l'instruction est trouvée en comptant parenthèses / crochets /
   accolades HORS chaînes et HORS commentaires jusqu'au `;` de profondeur zéro.
   ========================================================================= */
const { execSync } = require('child_process');
const fs = require('fs');

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node _clean_dead.cjs <file> [file…]'); process.exit(2); }
const lint = JSON.parse(execSync(`npx oxlint ${files.join(' ')} -f json`, { encoding: 'utf8', maxBuffer: 1 << 28 }).replace(/^\uFEFF/, ''));
const byFile = new Map();
for (const d of lint.diagnostics) {
  if (d.code !== 'eslint(no-unused-vars)') continue;
  const name = (d.labels[0].label.match(/'([^']+)'/) || [])[1];
  const line = d.labels[0].span.line;
  if (!name) continue;
  if (!byFile.has(d.filename)) byFile.set(d.filename, []);
  byFile.get(d.filename).push({ line, name });
}

const scanEnd = (text) => {
  let depth = 0; let quote = null; let line = false; let block = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]; const n = text[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; i += 1; } continue; }
    if (quote) { if (c === '\\') { i += 1; continue; } if (c === quote) quote = null; continue; }
    if (c === '/' && n === '/') { line = true; i += 1; continue; }
    if (c === '/' && n === '*') { block = true; i += 1; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') depth -= 1;
    else if (c === ';' && depth === 0) return i + 1;
  }
  return -1;
};
const attachedTop = (lines, idx) => {
  let s = idx;
  while (s > 0) {
    const t = lines[s - 1].trim();
    if (t === '') break;
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.endsWith('*/')) { s -= 1; continue; }
    break;
  }
  return s;
};

let removed = 0;
const seen = new Set();
for (const [file, list] of byFile) {
  const raw = fs.readFileSync(file, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  let lines = raw.split(/\r?\n/);
  for (const { line, name } of list.sort((a, b) => b.line - a.line)) {   // bas → haut
    const key = `${file}:${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const idx = line - 1;
    if (!lines[idx] || !lines[idx].includes(name)) { console.log(`! ${key} introuvable (${name})`); continue; }
    const top = attachedTop(lines, idx);
    const text = lines.slice(top).join(eol);
    const endAt = scanEnd(text);
    if (endAt < 0) { console.log(`! ${key} fin introuvable (${name})`); continue; }
    const count = text.slice(0, endAt).split(eol).length;
    const gone = lines.slice(top, top + count);
    console.log(`- ${file}:${top + 1}-${top + count}  ${gone[0].trim().slice(0, 86)}`);
    const skipBlank = lines[top + count] !== undefined && lines[top + count].trim() === '' ? 1 : 0;
    lines = lines.slice(0, top).concat(lines.slice(top + count + skipBlank));
    removed += 1;
  }
  fs.writeFileSync(file, lines.join(eol));
}
console.log(`\n${removed} declaration(s) removed`);
