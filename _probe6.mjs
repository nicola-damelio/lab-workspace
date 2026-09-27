// Probe #6: persistence + page-switch + WIP feature keys. ASCII-only output.
import fs from 'fs';
import path from 'path';
const out = [];
const log = (...a) => out.push(a.join(' '));
const ascii = (s) => s.replace(/[^\x20-\x7E]/g, '');

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(jsx?|mjs|cjs)$/.test(e.name)) acc.push(p);
  }
  return acc;
}
const CORPUS = [...walk('src')];
const read = (p) => fs.readFileSync(p, 'utf8').split(/\r?\n/);

log('########## localStorage keys touched by the viewer/app ##########');
const keys = new Map();
for (const f of CORPUS) {
  read(f).forEach((l, i) => {
    const m = l.match(/localStorage\.(?:getItem|setItem|removeItem)\(\s*['"`]([^'"`]+)['"`]/);
    if (m) {
      if (!keys.has(m[1])) keys.set(m[1], []);
      keys.get(m[1]).push(f + ':' + (i + 1));
    }
    const m2 = l.match(/KEY\s*=\s*['"`]([^'"`]+)['"`]/);
    if (m2) log('  CONST KEY ' + m2[1] + '   @' + f + ':' + (i + 1));
  });
}
[...keys.entries()].sort().forEach(([k, v]) => log('  ' + k.padEnd(42) + ' x' + v.length + '  ' + v.slice(0, 3).join(' ')));

log('');
log('########## patterns ##########');
const PATS = [
  ['sel persistence', /selOverrides|selStyles|persistSel|labViewerSel|selectedResidueColor/],
  ['viewer settings persist', /viewerSettings|saveViewerSettings|loadViewerSettings|sceneSettings|labViewer[A-Za-z]*\b/],
  ['page switch', /hidden page|pageCache|keepMounted|lastPage|prevPage|pageAlive|useMemo\(\(\) => \{|activePage/],
  ['progress bar', /loadProgress|useLoadProgress|progress/],
  ['wheel rework', /StModal|swatch|Wheel/i],
];
for (const [name, re] of PATS) {
  log('');
  log('--- ' + name);
  const seen = new Map();
  for (const f of CORPUS) {
    read(f).forEach((l, i) => {
      if (!re.test(l)) return;
      const k = f + ':' + (i + 1);
      if (seen.size < 45) seen.set(k, '  ' + k + '| ' + ascii(l.trim()).slice(0, 140));
    });
  }
  [...seen.values()].forEach((s) => log(s));
}
fs.writeFileSync('_probe6.txt', out.join('\n'), 'utf8');
console.log('wrote _probe6.txt (' + out.length + ')');
