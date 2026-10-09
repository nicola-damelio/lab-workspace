/* SONDE — les CYCLES d'import de `src/**`.
   Un cycle est inoffensif tant que les modules restent séparés (dev), mais le
   bundle minifié les CONCATÈNE dans une seule portée : le module évalué en
   premier lit alors un binding encore dans sa zone morte
   (« Cannot access 'x' before initialization »). */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, extname, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p, out); continue; }
    if (/\.(js|jsx|mjs|ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const known = new Set(files.map((f) => f.toLowerCase()));
const INDEXES = ['', '.js', '.jsx', '.mjs', '.ts', '.tsx', '/index.js', '/index.jsx', '/index.ts', '/index.tsx'];

function resolveSpec(fromFile, spec) {
  if (!spec.startsWith('.')) return null; // paquet : hors sujet
  const base = resolve(dirname(fromFile), spec);
  for (const ext of INDEXES) {
    const cand = base + ext;
    if (known.has(cand.toLowerCase()) && statSync(cand).isFile()) return cand;
  }
  return null;
}

const RE_IMPORT = /(?:^|[\s;}])(?:import|export)\b[\s\S]*?from\s*['"]([^'"]+)['"]/g;
const RE_BARE = /(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g;

const graph = new Map();
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const deps = new Set();
  for (const re of [RE_IMPORT, RE_BARE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const t = resolveSpec(f, m[1]);
      if (t) deps.add(t);
    }
  }
  graph.set(f, [...deps]);
}

/* ── Tarjan : composantes fortement connexes de taille > 1 = cycles ────────── */
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

const rel = (p) => relative(ROOT, p).split('\\').join('/');
const lines = [];
lines.push(`fichiers analysés : ${files.length}`);
lines.push(`arcs d'import      : ${[...graph.values()].reduce((n, d) => n + d.length, 0)}`);
lines.push(`cycles (SCC > 1)   : ${sccs.length}`);
lines.push('');
for (const comp of sccs.sort((a, b) => b.length - a.length)) {
  lines.push(`── CYCLE de ${comp.length} modules :`);
  for (const f of comp.sort()) {
    const inside = (graph.get(f) || []).filter((d) => comp.includes(d)).map(rel);
    lines.push(`   ${rel(f)}` + (inside.length ? `   → ${inside.join(', ')}` : ''));
  }
  lines.push('');
}
writeFileSync(join(ROOT, '_chk_cycles.txt'), lines.join('\r\n'), 'utf8');
console.log(lines.slice(0, 40).join('\n'));
console.log(`\n(écrit dans _chk_cycles.txt — ${sccs.length} cycles)`);
