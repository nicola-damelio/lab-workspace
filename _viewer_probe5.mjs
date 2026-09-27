// Probe #5: styling-window rework + frame rebuild wiring. ASCII-only.
import fs from 'fs';
const out = [];
const log = (...a) => out.push(a.join(' '));
const ascii = (s) => s.replace(/[^\x20-\x7E]/g, '');
const P = 'src/components/NMRMoleculeViewer.jsx';
const L = fs.readFileSync(P, 'utf8').split(/\r?\n/);
log('viewer lines: ' + L.length);

// 1. rebuild call sites + the dep array that closes their effect
log('');
log('########## 1. rebuild call sites + closing dep arrays ##########');
const callRe = /rebuildSectionsOf\(|buildSectionReps\(|applyCurrentStyleTo\(|buildMainReps\(/;
L.forEach((l, i) => {
  if (!callRe.test(l)) return;
  let dep = '';
  for (let k = i + 1; k < Math.min(L.length, i + 260); k++) {
    if (/^\s*\}, \[/.test(L[k])) { dep = (k + 1) + '| ' + ascii(L[k].trim()); break; }
    if (/^\s*(const|useEffect)/.test(L[k]) && k > i + 2 && /^\s*useEffect/.test(L[k])) { dep = 'NEW EFFECT at ' + (k + 1); break; }
  }
  log('  call@' + (i + 1) + ': ' + ascii(l.trim()).slice(0, 110));
  log('      ' + dep);
});

// 2. styling window region scan
log('');
log('########## 2. mouse mode / wheel / all-none / fit (whole file) ##########');
const pats = [
  ['mouseMode', /mouseMode/],
  ['wheel', /onWheel|handleWheel|Wheel|wheel/],
  ['fit', /\bfit[A-Z]|\bFit\b|\bfitAll\b/],
  ['visibleMol', /visibleMolKeys|setVisibleMol/],
  ['copySections', /copySectionsToAll|copyRow|applyToAll/],
  ['all-none buttons', />All<|>None<|'All'|'None'|"All"|"None"/],
  ['resetAll', /resetAll|Reset all|setAllLook|allLooks/],
  ['frame in styling', /frame/i],
];
for (const [name, re] of pats) {
  const hits = [];
  L.forEach((l, i) => { if (re.test(l)) hits.push((i + 1) + '| ' + ascii(l.trim()).slice(0, 130)); });
  log('');
  log('--- ' + name + ': ' + hits.length + ' hits');
  hits.slice(0, 30).forEach((h) => log('   ' + h));
}

// 3. the styling window JSX section (heuristic: last 2600 lines)
log('');
log('########## 3. JSX of the styling window tail ##########');
const tail = L.slice(-1600);
tail.forEach((l, i) => {
  if (/setSectionLooks|all|All|none|None|fit|Fit|Wheel|wheel|lookFor|rowLooks|Molecules|molecule/i.test(l) && /<|onClick|onChange|title=/.test(l)) {
    log('  ' + (L.length - 1600 + i + 1) + '| ' + ascii(l.trim()).slice(0, 165));
  }
});

fs.writeFileSync('_viewer_probe5.txt', out.join('\n'), 'utf8');
console.log('wrote _viewer_probe5.txt (' + out.length + ')');
