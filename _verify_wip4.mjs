// Charset-proof verification probe (v4). Writes ASCII-only reports, never stdout.
import fs from 'fs';
import path from 'path';

const OUT = [];
const log = (...a) => OUT.push(a.join(' '));
const W = (name, lines) => fs.writeFileSync(name, lines.join('\n'), 'utf8');

const ascii = (s) => s.replace(/[^\x20-\x7E]/g, '');

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.git')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(jsx?|mjs|cjs)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const SRC = walk('src');
// live files only (exclude scratch _*/ render outputs)
const ROOT_TESTS = fs.readdirSync('.').filter((f) => /\.(mjs|cjs|jsx?)$/.test(f) && !f.startsWith('_') && fs.statSync(f).isFile());
const CORPUS = [...SRC, ...ROOT_TESTS];
log('CORPUS files: ' + CORPUS.length);

const cache = new Map();
function linesOf(p) {
  if (!cache.has(p)) cache.set(p, fs.readFileSync(p, 'utf8').split(/\r?\n/));
  return cache.get(p);
}

// ---------- 1. file inventory ----------
log('');
log('########## 1. INVENTORY ##########');
log('src/utils: ' + fs.readdirSync('src/utils').join(', '));
log('src root: ' + fs.readdirSync('src').join(', '));
log('src/components count: ' + fs.readdirSync('src/components').length);
log('loadProgress.js exists: ' + fs.existsSync('src/utils/loadProgress.js'));
if (fs.existsSync('src/utils/loadProgress.js')) {
  const L = linesOf('src/utils/loadProgress.js');
  log('loadProgress.js lines: ' + L.length);
  L.forEach((l, i) => { if (/export|^\s*(begin|phase|progress|end|subscribe|snapshot)\s*\(/.test(l)) log('   ' + (i + 1) + '| ' + ascii(l.trim())); });
}

// ---------- 2. keyword sweep ----------
const PATTERNS = [
  ['lipid coloring', /LIPID_CLASS_COLORS|LIPID_|lipidClass|defineLipidGroupsScheme|lipidType/i],
  ['styling wheel', /onWheel|handleWheel|wheelDelta|WheelEvent|addEventListener\(.\s*wheel/i],
  ['sel persistence', /labViewerSel|VIEWER_SEL|selectionStore|persistSel|selPersist/i],
  ['page switch defer', /startTransition|useDeferredValue|requestIdleCallback|deferSwitch|pageSwitch|switchPage/i],
  ['viewer settings persist', /LAB_VIEWER|labViewer(?!Sel)|viewerSettings|VIEWER_SETTINGS|viewerPrefs/i],
  ['styling window all/none', /\bAll\b|>None<|applyToAll|copySectionsToAll|setAllStyles/i],
  ['fit selected', /fitSelected|Fit selected|Fit the selected|fitToSelection|fitOnSelection/i],
  ['per-molecule move/rotate', /rotateMolecule|moveMolecule|extraMolPosition|setMainPosition|worldDeltaForScreen|applyTransformToAll/i],
  ['Sequence and structure', /Sequence and structure/],
  ['ring plates', /RingPlate|ringPlate|nucleicRingPlates|stylizedRing|StylizedRing/i],
  ['section reps', /buildSectionReps|sectionRepsRef|sectionEpoch|setSectionLooks/i],
  ['frame wiring', /setFrameSafe|frameChanged|onFrameChange|currentFrame|\[frame\]/],
  ['shift axis fields', /Shift X|Shift Y|Shift Z|Move X|Move Y|Move Z|Translate X/i],
];

for (const [name, re] of PATTERNS) {
  const hits = [];
  for (const f of CORPUS) {
    const L = linesOf(f);
    for (let i = 0; i < L.length; i++) if (re.test(L[i])) hits.push(f + ':' + (i + 1) + ': ' + ascii(L[i].trim()).slice(0, 150));
  }
  log('');
  log('########## PATTERN: ' + name + '  (' + hits.length + ' hits) ##########');
  hits.slice(0, 40).forEach((h) => log('  ' + h));
  if (hits.length > 40) log('  ... ' + (hits.length - 40) + ' more');
}

// ---------- 3. ring plate / frame blocks in the viewer ----------
const VIEWER = 'src/components/NMRMoleculeViewer.jsx';
const V = linesOf(VIEWER);
log('');
log('########## 3. VIEWER ring-plate / frame blocks (' + VIEWER + ', ' + V.length + ' lines) ##########');
const marks = [];
V.forEach((l, i) => { if (/RingPlate|ringPlate|nucleicRingPlates|stylizedRing/i.test(l)) marks.push(i); });
log('ring-plate line numbers: ' + marks.map((m) => m + 1).join(', '));
// contiguous clusters -> print each block
const blocks = [];
for (const m of marks) {
  const last = blocks[blocks.length - 1];
  if (last && m - last[last.length - 1] <= 40) last.push(m); else blocks.push([m]);
}
for (const b of blocks) {
  log('');
  log('--- BLOCK lines ' + (b[0] + 1) + '-' + (b[b.length - 1] + 1) + ' ---');
  const from = Math.max(0, b[0] - 6), to = Math.min(V.length, b[b.length - 1] + 7);
  for (let i = from; i < to; i++) log(String(i + 1).padStart(6) + '| ' + ascii(V[i]));
}

// effects that mention frame / setFrame + their dep arrays
log('');
log('########## 3b. useEffect with currentFrame in scope (deps arrays) ##########');
V.forEach((l, i) => { if (/^\s*\}, \[/.test(l) && /currentFrame|frameIdx|frame\b/.test(l)) log('   ' + (i + 1) + '| ' + ascii(l.trim())); });
V.forEach((l, i) => { if (/setFrameSafe|\.setFrame\(/.test(l)) log('   setFrame@' + (i + 1) + ': ' + ascii(l.trim()).slice(0, 160)); });

// ---------- 4. snapshot removed shift-field hunks ----------
log('');
log('########## 4. SNAPSHOT removed lines: shift / axis / rotate ##########');
for (const f of ['_wip_src.diff']) {
  if (!fs.existsSync(f)) { log('missing ' + f); continue; }
  const L = fs.readFileSync(f, 'latin1').split(/\r?\n/).map(ascii);
  let hunk = '';
  for (let i = 0; i < L.length; i++) {
    if (/^@@/.test(L[i])) hunk = L[i];
    if (/^-[^-]/.test(L[i]) && /shift|Shift|Move X|Move Y|Move Z|Translate|rotate|Rotate|axis|Axis/.test(L[i])) {
      log('  ' + hunk);
      for (let k = Math.max(0, i - 2); k <= Math.min(L.length - 1, i + 2); k++) log('      ' + L[k].slice(0, 140));
      log('');
    }
  }
}

W('_verify_wip4.txt', OUT);
console.log('wrote _verify_wip4.txt (' + OUT.length + ' lines)');
