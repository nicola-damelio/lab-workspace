/* =========================================================================
   _scan18.mjs — les FAITS NGL, lus dans le bundle NON minifié
   (node_modules/ngl/dist/ngl.esm.js) → _live_scan18.txt

   Question : quand la frame d'une trajectoire change, quelles
   représentations sont reconstruites ? Les MeshBuffer des plaques de
   cycles (BufferRepresentation) suivent-ils les atomes ?
   ========================================================================= */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const O = [];
const w = (s = '') => O.push(s);
const rd = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const n = (s, x) => (x ? s.split(x).length - 1 : 0);

const CAND = ['node_modules/ngl/dist/ngl.esm.js', 'node_modules/ngl/dist/ngl.umd.js', 'node_modules/ngl/dist/ngl.js'];
w('-- comptes par bundle --');
const B = {};
for (const p of CAND) {
  if (!existsSync(p)) continue;
  const s = rd(p);
  B[p] = s;
  w(`${p} : ${s.split('\n').length} lignes · « class Representation »=${n(s, 'class Representation')}`
    + ` · BufferRepresentation=${n(s, 'BufferRepresentation')} · refreshed=${n(s, 'refreshed')}`
    + ` · updateRepresentations=${n(s, 'updateRepresentations')} · setFrame=${n(s, 'setFrame')}`);
}
const SRC = Object.entries(B).sort((a, b) => n(b[1], 'class Representation') - n(a[1], 'class Representation'))[0];
w(`\n>>> bundle retenu : ${SRC[0]}`);
const DIST = SRC[1];
const L = DIST.split('\n');

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
  const m = body.match(new RegExp(`(^|\\n)\\s*(?:async\\s+)?${name}\\s*\\(([^)]*)\\)\\s*\\{`, 'm'));
  if (!m) return null;
  return braceBlock(body, body.indexOf(m[0]) + m[0].length - 1);
};
const head = (b, k = 26) => b.split('\n').slice(0, k).map((l) => '    ' + l.slice(0, 190)).join('\n');

for (const cls of ['Representation', 'BufferRepresentation', 'StructureRepresentation', 'StructureComponent', 'Trajectory', 'Structure']) {
  const body = classBody(DIST, cls);
  w(`\n===== class ${cls} : ${body ? `${body.split('\n').length} lignes` : 'INTROUVABLE'} =====`);
  if (!body) continue;
  const names = [...body.matchAll(/(?:^|\n)\s{2}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
  w(`  méthodes : ${[...new Set(names)].join(', ')}`);
  const want = cls === 'BufferRepresentation'
    ? ['update', 'build', 'make', 'create', 'dispose']
    : ['update', 'build', 'make', 'updatePosition', 'updateRepresentations', 'setFrame'];
  for (const m of want) {
    const mb = methodBody(body, m);
    if (mb) { w(`  --- ${m}() ---`); w(head(mb, cls === 'BufferRepresentation' && m === 'create' ? 40 : 26)); }
  }
}

w('\n===== « refreshed » : chaque ligne, avec 3 lignes de contexte =====');
L.forEach((l, i) => {
  if (l.includes('refreshed')) {
    w(`  ligne ${i + 1} :`);
    w(L.slice(Math.max(0, i - 3), i + 4).map((x, k) => `  ${String(Math.max(1, i - 3) + k + 1).padStart(6)}: ${x.trim().slice(0, 170)}`).join('\n'));
  }
});

w('\n===== setFrame / updatePosition / refreshPosition (contexte 3) =====');
L.forEach((l, i) => {
  if (/\bsetFrame\s*\(|\bupdatePosition\s*\(\s*coords|refreshPosition\s*\(/.test(l)) {
    w(`  ligne ${i + 1} :`);
    w(L.slice(Math.max(0, i - 3), i + 4).map((x, k) => `  ${String(Math.max(1, i - 3) + k + 1).padStart(6)}: ${x.trim().slice(0, 170)}`).join('\n'));
  }
});

writeFileSync('_live_scan18.txt', O.join('\n'), 'utf8');
console.log('_live_scan18.txt written');
