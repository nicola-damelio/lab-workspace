/* =========================================================================
   _scan17.mjs — CE QUE LE NGL INSTALLÉ FAIT VRAIMENT quand la frame change
   (pour répondre à : « les plaques de cycles suivent-elles les atomes
   intérieurs quand on bouge le curseur de frame ? ») → _live_scan17.txt

   Aucune sortie console (le shell mange l'UTF-8) : tout va dans le fichier.
   ========================================================================= */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const O = [];
const w = (s = '') => O.push(s);
const rd = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

w(`node ${process.version}`);
const pkg = JSON.parse(rd('node_modules/ngl/package.json'));
w(`ngl ${pkg.version} · main=${pkg.main} · module=${pkg.module || '-'}`);

const dir = 'node_modules/ngl/dist';
w('\n-- node_modules/ngl/dist --');
for (const f of readdirSync(dir)) w(`   ${f}  ${statSync(join(dir, f)).size} o`);

const pick = ['ngl.js', 'ngl.mjs', 'ngl.esm.js', 'ngl.min.js']
  .map((f) => join(dir, f)).find((p) => existsSync(p));
w(`\nbundle lu : ${pick}`);
const DIST = rd(pick);
const L = DIST.split('\n');
w(`lignes : ${L.length}`);

/* ── extraction d'une classe (corps par appariement d'accolades) ────────── */
const braceBlock = (src, at) => {
  const open = src.indexOf('{', at);
  if (open < 0) return null;
  let d = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') d += 1;
    else if (src[i] === '}') { d -= 1; if (d === 0) return src.slice(at, i + 1); }
  }
  return null;
};
const classBody = (src, name) => {
  const at = src.indexOf(`class ${name} `);
  return at < 0 ? null : braceBlock(src, at);
};
const methodBody = (body, name) => {
  const re = new RegExp(`(^|\\n)\\s*(?:async\\s+)?${name}\\s*\\(([^)]*)\\)\\s*\\{`, 'm');
  const m = body.match(re);
  if (!m) return null;
  const at = body.indexOf(m[0]) + m[0].length - 1;
  return braceBlock(body, at);
};
const head = (b, n = 24) => b.split('\n').slice(0, n).map((l) => '    ' + l.slice(0, 190)).join('\n');

for (const cls of ['Representation', 'BufferRepresentation', 'StructureRepresentation', 'StructureComponent', 'Trajectory']) {
  const body = classBody(DIST, cls);
  w(`\n===== class ${cls} : ${body ? `${body.split('\n').length} lignes` : 'INTROUVABLE'} =====`);
  if (!body) continue;
  const names = [...body.matchAll(/(?:^|\n)\s{2}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
  w(`  méthodes : ${[...new Set(names)].join(', ')}`);
  for (const m of ['update', 'build', 'make', 'create', 'updatePosition', 'updateRepresentations', 'setFrame']) {
    const mb = methodBody(body, m);
    if (mb) { w(`  --- ${m}() ---`); w(head(mb)); }
  }
}

w('\n===== toute ligne parlant de « refreshed » =====');
L.forEach((l, i) => {
  if (l.includes('refreshed')) w(`${String(i + 1).padStart(6)}: ${l.trim().slice(0, 190)}`);
});

w('\n===== setFrame / updatePosition / refreshPosition =====');
L.forEach((l, i) => {
  if (/setFrame\s*\(|updatePosition\s*\(|refreshPosition/.test(l)) w(`${String(i + 1).padStart(6)}: ${l.trim().slice(0, 190)}`);
});

/* ── git : ce que l'arbre VIVANT a de modifié / non suivi ──────────────── */
const git = (args) => {
  const r = spawnSync('git', ['--no-pager', ...args], { encoding: 'utf8' });
  return (r.stdout || '') + (r.stderr || '');
};
w('\n===== git status --porcelain =====');
w(git(['status', '--porcelain']).trim());
w('\n===== git diff --numstat =====');
w(git(['diff', '--numstat']).trim());

/* ── taille des artefacts de la session ────────────────────────────────── */
w('\n===== artefacts =====');
for (const f of ['_live_viewer_diff.txt', '_live_viewer_added.txt', '_live_other_diff.txt',
  '_live_scan11.txt', '_live_scan13.txt', '_live_scan14.txt', '_live_scan15.txt', '_run_tail.txt']) {
  w(`   ${f}  ${existsSync(f) ? `${rd(f).split('\n').length} lignes / ${statSync(f).size} o` : 'absent'}`);
}

writeFileSync('_live_scan17.txt', O.join('\n'), 'utf8');
console.log('_live_scan17.txt written', O.length, 'sections');
