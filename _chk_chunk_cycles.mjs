/* SONDE — cycles entre CHUNKS du bundle (dist/assets).
   Un cycle de chunks produit exactement « Cannot access 'x' before initialization »
   dans le bundle minifié, jamais dans le source (le source, lui, a 0 cycle :
   voir _chk_cycles.mjs). */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const DIR = join(ROOT, 'dist', 'assets');
const files = readdirSync(DIR).filter((f) => /\.(js|mjs)$/.test(f));
const set = new Set(files);

const graph = new Map();
for (const f of files) {
  const text = readFileSync(join(DIR, f), 'utf8');
  const deps = new Set();
  const re = /(?:from|import)\s*\(?\s*["']\.\/([^"']+\.(?:js|mjs))["']/g;
  let m;
  while ((m = re.exec(text))) if (set.has(m[1])) deps.add(m[1]);
  graph.set(f, [...deps]);
}

let index = 0;
const idx = new Map(), low = new Map(), onStack = new Set(), stack = [], sccs = [];
function strongConnect(v) {
  idx.set(v, index); low.set(v, index); index++;
  stack.push(v); onStack.add(v);
  for (const w of graph.get(v) || []) {
    if (!idx.has(w)) { strongConnect(w); low.set(v, Math.min(low.get(v), low.get(w))); }
    else if (onStack.has(w)) { low.set(v, Math.min(low.get(v), idx.get(w))); }
  }
  if (low.get(v) === idx.get(v)) {
    const comp = [];
    let w;
    do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
    if (comp.length > 1) sccs.push(comp);
  }
}
for (const f of files) if (!idx.has(f)) strongConnect(f);

const lines = [`chunks : ${files.length}`, `arcs   : ${[...graph.values()].reduce((n, d) => n + d.length, 0)}`, `cycles : ${sccs.length}`, ''];
for (const comp of sccs.sort((a, b) => b.length - a.length)) {
  lines.push(`── CYCLE de ${comp.length} chunks :`);
  for (const f of comp.sort()) lines.push(`   ${f} → ${(graph.get(f) || []).filter((d) => comp.includes(d)).join(', ')}`);
  lines.push('');
}
writeFileSync(join(ROOT, '_chk_chunk_cycles.txt'), lines.join('\r\n'), 'utf8');
console.log(lines.join('\n'));
console.log('dist/assets' + relative(ROOT, DIR).slice(0, 0));
