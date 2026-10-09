/* SONDE — qui a DÉJÀ vu « before initialization » ? (logs, json, txt, sorties de
   sonde : le message exact, avec la pile, vaut mieux que toute déduction). */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SKIP = new Set(['node_modules', '.git', 'dist', 'public']);
const EXT = /\.(txt|json|log|md|mjs|cjs|js|jsx|html|out)$/;
const NEEDLE = 'before initialization';
const hits = [];
let scanned = 0;

function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!EXT.test(e.name)) continue;
    let text;
    try { text = readFileSync(p, 'utf8'); } catch { continue; }
    scanned += 1;
    if (!text.includes(NEEDLE)) continue;
    const lines = text.split(/\r?\n/);
    lines.forEach((l, i) => {
      if (l.includes(NEEDLE)) hits.push(`${relative(ROOT, p)}:${i + 1}  ${l.trim().slice(0, 220)}`);
    });
  }
}
walk(ROOT);

const out = [`fichiers lus : ${scanned}`, `occurrences de « ${NEEDLE} » : ${hits.length}`, '', ...hits];
writeFileSync(join(ROOT, '_chk_seen.txt'), out.join('\r\n'), 'utf8');
console.log(out.slice(0, 60).join('\n'));
