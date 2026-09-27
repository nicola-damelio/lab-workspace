/* =========================================================================
   _scan21.mjs — le source NGL BRUT des deux classes qui décident →
   _live_scan21.txt (representation.ts, buffer-representation.ts, le listener
   « refreshed » de structure-component.ts, updateData de
   structure-representation.ts, updateRepresentations de component.ts)
   ========================================================================= */
import { readFileSync, writeFileSync } from 'node:fs';

const O = [];
const w = (s = '') => O.push(s);
const map = JSON.parse(readFileSync('node_modules/ngl/dist/ngl.esm.js.map', 'utf8'));
const F = new Map(map.sources.map((s, i) => [s.replace(/\\/g, '/'), String(map.sourcesContent[i]).replace(/\r\n/g, '\n')]));
const get = (re) => { const hit = [...F.entries()].find(([p]) => re.test(p)); return hit ? hit[1] : null; };

const full = (label, src) => {
  w(`\n================= ${label} (${src ? src.split('\n').length : 0} lignes) =================`);
  w(src ? src : 'INTROUVABLE');
};

full('src/representation/representation.ts', get(/\/representation\.ts$/));
full('src/representation/buffer-representation.ts', get(/buffer-representation\.ts$/));

const range = (label, src, from, to) => {
  w(`\n================= ${label} =================`);
  if (!src) { w('INTROUVABLE'); return; }
  const L = src.split('\n');
  L.slice(from - 1, to).forEach((l, i) => w(`${String(from + i).padStart(5)}: ${l}`));
};
const around = (label, src, needle, before = 4, after = 22) => {
  w(`\n================= ${label} =================`);
  if (!src) { w('INTROUVABLE'); return; }
  const L = src.split('\n');
  L.forEach((l, i) => {
    if (l.includes(needle)) {
      w(`  ── ligne ${i + 1} ──`);
      L.slice(Math.max(0, i - before), i + after).forEach((x, k) => w(`  ${String(Math.max(1, i - before) + k + 1).padStart(5)}: ${x}`));
    }
  });
};

around('structure-component.ts : abonnement « refreshed »', get(/structure-component\.ts$/), 'refreshed', 6, 12);
around('structure-representation.ts : updateData', get(/structure-representation\.ts$/), 'updateData (', 2, 30);
around('component.ts : updateRepresentations', get(/\/component\/component\.ts$/), 'updateRepresentations (', 2, 20);
around('component.ts : addRepresentation / hasRepresentation', get(/\/component\/component\.ts$/), 'addRepresentation (', 2, 14);
around('structure.ts : setPosition / getPosition', get(/\/structure\/structure\.ts$/), 'setPosition (', 2, 12);

writeFileSync('_live_scan21.txt', O.join('\n'), 'utf8');
console.log('_live_scan21.txt written');
