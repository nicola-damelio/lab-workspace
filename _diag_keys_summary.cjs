// _diag_keys_summary.cjs — READ-ONLY: summarize the downloaded _diag_keys.json
// (a copy of Drive's Lab Workspace/_workspace/keys.json) so we know exactly what
// the app persisted for the image library / canvases.
//
// Le dump n'est PAS versionné (5 Mo de keys.json du Drive) : il se télécharge à
// la demande avec `pwsh -File _diag_keys.ps1`. Sans lui ce diagnostic n'a rien à
// résumer — ce n'est pas un échec de l'application, donc on sort en 0.
const fs = require('fs');

if (!fs.existsSync('_diag_keys.json')) {
  console.log('_diag_keys.json absent — lance d\'abord : pwsh -File _diag_keys.ps1');
  console.log('(diagnostic non lancé : le dump du Drive n\'est pas versionné)');
  process.exit(0);
}

const raw = fs.readFileSync('_diag_keys.json', 'utf8');
const state = JSON.parse(raw);
console.log('kind =', state.kind, '| at =', state.at, '| bytes =', raw.length);

const keys = state.keys || {};
const names = Object.keys(keys);
console.log('total keys:', names.length);

const localOnly = (i) => i && !i.drive && typeof i.full === 'string' && i.full.startsWith('data:');

let totalCanvas = 0;
let totalLocalOnly = 0;
let totalFigures = 0;

const rows = [];
for (const k of names) {
  if (!/^labFigures(Lib|Library)/.test(k)) continue;
  const v = keys[k].v;
  const list = Array.isArray(v) ? v : (typeof v === 'string' ? JSON.parse(v) : []);
  const canvases = list.filter((i) => i && i.canvasData);
  const figs = list.filter((i) => i && !i.canvasData);
  totalCanvas += canvases.length;
  totalFigures += figs.length;
  totalLocalOnly += list.filter(localOnly).length;
  rows.push({
    key: k,
    at: keys[k].at ? new Date(keys[k].at).toISOString() : '',
    entries: list.length,
    canvases: canvases.length,
    onDrive: list.filter((i) => i && i.drive).length,
    localOnly: list.filter(localOnly).length,
    biggest: list.reduce((n, i) => Math.max(n, JSON.stringify(i).length), 0)
  });
}
rows.sort((a, b) => b.canvases - a.canvases || b.entries - a.entries);
for (const r of rows) {
  console.log(`${r.key}  at=${r.at}  entries=${r.entries}  canvases=${r.canvases}  drive=${r.onDrive}  localOnly=${r.localOnly}  biggestEntry=${r.biggest}B`);
}
console.log(`TOTALS: figures=${totalFigures} canvases=${totalCanvas} entriesWithoutCloudPixels=${totalLocalOnly}`);

// What are the canvases (labels + scope + whether they carry an editable snapshot)?
for (const k of names) {
  if (!/^labFigures(Lib|Library)/.test(k)) continue;
  const v = keys[k].v;
  const list = Array.isArray(v) ? v : (typeof v === 'string' ? JSON.parse(v) : []);
  const canvases = list.filter((i) => i && i.canvasData);
  if (!canvases.length) continue;
  console.log(`\n== ${k} — ${canvases.length} canvas(es)`);
  for (const c of canvases) {
    const objs = (c.canvasData && c.canvasData.objects) || [];
    const imgs = objs.reduce((n, o) => n + ((o.images || []).length || (o.imgSrc ? 1 : 0)), 0);
    console.log(`   • "${c.label}" drive=${!!c.drive} pxObjects=${objs.length} images=${imgs} thumbnailsOnly=${objs.every((o) => (o.images || [o]).every((im) => !im || !im.imgSrc || String(im.imgSrc).startsWith('data:')))} addedAt=${c.addedAt || ''} updatedAt=${c.updatedAt || ''}`);
  }
}
