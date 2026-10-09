/* SONDE — où vit l'identifiant `dr` ? Sondage BRUT des bundles et des fichiers
   servis (dist + vendor), et recherche du message d'erreur lui-même. */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const out = [];
const RE = /\bdr\b/g;

function walk(dir, out2 = []) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out2; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', '.git'].includes(e.name)) walk(p, out2); }
    else if (/\.(js|mjs|cjs|jsx|html|json)$/.test(e.name)) out2.push(p);
  }
  return out2;
}

const ZONES = ['dist', 'public', 'src', '_render_smoke', '_glsl', '_nglsrc', '_ngl_full', '_ngl_src', 'scripts', 'server'];
const files = [];
for (const z of ZONES) if (statSync(join(ROOT, z), { throwIfNoEntry: false })) walk(join(ROOT, z), files);

out.push(`fichiers sondés : ${files.length}`);
for (const f of files) {
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  RE.lastIndex = 0;
  const hits = [];
  let m;
  while ((m = RE.exec(text))) {
    const line = text.slice(0, m.index).split(/\r?\n/).length;
    const ctx = text.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\r?\n/g, ' ⏎ ');
    hits.push(`    L${line}  …${ctx}…`);
    if (hits.length >= 6) break;
  }
  if (hits.length) out.push(`${relative(ROOT, f)}  (${hits.length}${hits.length >= 6 ? '+' : ''} occurrences)\n${hits.join('\n')}`);
}
writeFileSync(join(ROOT, '_chk_dr.txt'), out.join('\r\n'), 'utf8');
console.log(out.join('\n'));
