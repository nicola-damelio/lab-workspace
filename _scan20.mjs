/* =========================================================================
   _scan20.mjs — LE VRAI SOURCE de NGL 2.4.0, extrait des source maps du
   paquet installé (node_modules/ngl/dist/ngl.esm.js.map) → _live_scan20.txt

   Question : quand la frame change, quelles représentations sont
   reconstruites ? Un BufferRepresentation (nos plaques de cycles) suit-il ?
   ========================================================================= */
import { readFileSync, writeFileSync } from 'node:fs';

const O = [];
const w = (s = '') => O.push(s);
const rd = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const map = JSON.parse(rd('node_modules/ngl/dist/ngl.esm.js.map'));
w(`source map : ${map.sources.length} sources · sourcesContent : ${map.sourcesContent ? 'présent' : 'ABSENT'}`);
if (!map.sourcesContent) { writeFileSync('_live_scan20.txt', O.join('\n'), 'utf8'); console.log('no content'); process.exit(0); }
const F = new Map(map.sources.map((s, i) => [s.replace(/\\/g, '/'), map.sourcesContent[i]]));
w('quelques chemins :');
for (const s of [...F.keys()].filter((s) => /representation|component|trajectory/.test(s)).slice(0, 40)) w(`  ${s}`);

const norm = (s) => String(s).replace(/\r\n/g, '\n');
const braceBlock = (src, at) => {
  const open = src.indexOf('{', at);
  let d = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') d += 1;
    else if (src[i] === '}') { d -= 1; if (d === 0) return src.slice(at, i + 1); }
  }
  return null;
};
const methodBody = (src, name) => {
  const m = src.match(new RegExp(`(^|\\n)\\s*(?:async\\s+|public\\s+|private\\s+)*${name}\\s*\\(([^)]*)\\)\\s*[:{]`, 'm'));
  if (!m) return null;
  const at = src.indexOf(m[0]) + m[0].length - 1;
  return braceBlock(src, at);
};
const show = (label, body, k = 40) => {
  w(`  --- ${label} ---`);
  w(body ? body.split('\n').slice(0, k).map((l) => '    ' + l.slice(0, 180)).join('\n') : '    (introuvable)');
};

const find = (re) => [...F.entries()].filter(([p]) => re.test(p)).map(([, s]) => norm(s));

const repr = F.get('src/representation/representation.ts') || find(/\/representation\.ts$/)[0];
const buffer = F.get('src/representation/buffer-representation.ts') || find(/buffer-representation\.ts$/)[0];
const structRepr = find(/\/structure-representation\.ts$/)[0];
const structComp = find(/\/structure-component\.ts$/)[0];
const traj = find(/\/trajectory\.ts$/)[0];
const struct = find(/\/structure\.ts$/)[0];

w('\n========== representation.ts ==========');
show('class Representation (entier, 60 l.)', repr && (repr.match(/export class Representation[\s\S]{0,4000}/) || [null])[0], 60);
show('update()', repr && methodBody(repr, 'update'));

w('\n========== buffer-representation.ts ==========');
show('classe entière (80 l.)', buffer && (buffer.match(/export class BufferRepresentation[\s\S]{0,5000}/) || [null])[0], 80);
for (const m of ['update', 'build', 'make', 'create', 'dispose']) show(`${m}()`, buffer && methodBody(buffer, m));

w('\n========== structure-representation.ts ==========');
for (const m of ['update', 'build', 'make', 'create']) show(`${m}()`, structRepr && methodBody(structRepr, m), 30);

w('\n========== structure-component.ts ==========');
for (const m of ['updateRepresentations', 'updateRepresentationsImmediately']) show(`${m}()`, structComp && methodBody(structComp, m), 45);
w('  --- toutes les lignes disant « refreshed » ---');
if (structComp) norm(structComp).split('\n').forEach((l, i) => { if (l.includes('refreshed')) w(`    ${i + 1}: ${l.trim().slice(0, 170)}`); });

w('\n========== trajectory.ts ==========');
show('setFrame()', traj && methodBody(traj, 'setFrame'), 30);

w('\n========== structure.ts ==========');
for (const m of ['updatePosition', 'refreshPosition']) show(`${m}()`, struct && methodBody(struct, m), 25);
w('  --- toutes les lignes disant « refreshed » ---');
if (struct) norm(struct).split('\n').forEach((l, i) => { if (l.includes('refreshed')) w(`    ${i + 1}: ${l.trim().slice(0, 170)}`); });

writeFileSync('_live_scan20.txt', O.join('\n'), 'utf8');
console.log('_live_scan20.txt written');
