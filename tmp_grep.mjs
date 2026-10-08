/* Grep réutilisable (search_codebase ne renvoie rien ici). Fichier TEMPORAIRE.
   Usage : node tmp_grep.mjs "<regex>" [racine]  → stdout + tmp_grep_result.txt */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const pattern = new RegExp(process.argv[2] || '.', 'i');
const root = process.argv[3] || '.';
const skip = new Set(['node_modules', '.git', 'dist', 'build', '.vite']);
const out = [];
const scan = (full) => {
  let src = '';
  try { src = readFileSync(full, 'utf8'); } catch { return; }
  src.split(/\r?\n/).forEach((line, i) => {
    if (pattern.test(line)) out.push(`${full.replace(/\\/g, '/')}:${i + 1}: ${line.trim().slice(0, 200)}`);
  });
};
const walk = (dir) => {
  if (/\.(mjs|js|jsx|ts|tsx|html|css|json)$/i.test(dir)) { scan(dir); return; }
  let entries = [];
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    if (skip.has(entry)) continue;
    const full = join(dir, entry);
    let st = null;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) { walk(full); continue; }
    if (!/\.(mjs|js|jsx|ts|tsx|html|css|json)$/i.test(entry)) continue;
    if (/^tmp_/.test(entry)) continue;
    scan(full);
  }
};
walk(root);
const outFile = process.argv[4] || 'tmp_grep_result.txt';
writeFileSync(outFile, out.join('\r\n') || '(no match)', 'utf8');
console.log(out.length ? out.slice(0, 200).join('\n') : '(no match)');
