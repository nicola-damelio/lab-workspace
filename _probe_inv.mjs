// Temporary probe: feature inventory for the viewer UX batch.
// Writes _probe_inv.txt (shell output capture is unreliable in this env).
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const out = [];
const log = (...a) => out.push(a.join(' '));

const read = (p) => {
  try { return fs.readFileSync(path.join(root, p), 'utf8'); }
  catch (e) { return null; }
};

const scan = (file, patterns, label) => {
  const src = read(file);
  if (src == null) { log(`### ${label} — FILE MISSING: ${file}`); return; }
  const lines = src.split(/\r?\n/);
  log(`### ${label}  (${file} — ${lines.length} lines)`);
  for (const p of patterns) {
    const re = new RegExp(p, 'g');
    const hits = [];
    lines.forEach((l, i) => { if (re.test(l)) hits.push(`${i + 1}: ${l.trim().slice(0, 160)}`); });
    log(`--- /${p}/ : ${hits.length} hit(s)`);
    hits.slice(0, 25).forEach((h) => log('   ' + h));
  }
  log('');
};

scan('src/components/NMRMoleculeViewer.jsx', [
  'ringRepsRef', 'nucleicRingPlates', 'RingPlate', 'stylizedRing|StylizedRing',
  'defineLipidGroupsScheme', 'LIPID_CLASS_COLORS',
  'selStyles', 'LAB_VIEWER_SEL|labViewerSel',
  'fitSelected|Fit selected|Fit the selected',
  'Show every structure', 'Show only the main',
  'Move X|Move Y|Move Z|Shift X|Translate X',
  'draggedMol|dragMove', 'setExtraMolRotation|rotateExtraMol',
  'onFrame|frameIndex|structure\\.signals',
], 'NMRMoleculeViewer');

scan('src/App.jsx', [
  'viewerSettings|ViewerSettings|visualisation|visualization',
  'page|Page', 'cached|keepMounted|memo\\(',
  'localStorage',
], 'App');

for (const f of ['src/utils/loadProgress.js', 'src/utils/structureFit.js']) {
  const src = read(f);
  log(`### ${f} — ${src == null ? 'MISSING' : src.split(/\r?\n/).length + ' lines'}`);
  log('');
}

// enumerate src/utils + components listing with mtimes
for (const dir of ['src/utils', 'src/components', 'src']) {
  try {
    const entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
    log(`### ls ${dir} : ${entries.filter((e) => e.isFile()).map((e) => e.name).join(', ')}`);
  } catch (e) { log(`### ls ${dir} : error ${e.message}`); }
}

fs.writeFileSync(path.join(root, '_probe_inv.txt'), out.join('\n'), 'utf8');
console.log('wrote _probe_inv.txt', out.join('\n').length, 'chars');
