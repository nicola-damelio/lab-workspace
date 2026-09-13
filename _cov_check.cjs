// Scratch checker: every `new Chart(` canvas site in src/ should be rendered
// inside a <ChartJsInspector> so double-click-to-edit is available everywhere.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(jsx?|tsx?)$/.test(e.name)) files.push(p);
  }
})(SRC);

const count = (s, needle) => s.split(needle).length - 1;

// Read-only Lab Notebook previews are intentionally NOT wired: LabNotebook
// renders them from a notebook snapshot (`localTest`) and passes only a
// read-only `chartCfg`, so there is no setter to persist a style edit into.
const READ_ONLY_PREVIEWS = new Set(['src/components/notebookPreviews.jsx']);

let chartSites = 0;
let inspectorSites = 0;
const unwired = [];
const wiredFiles = [];
const skipped = [];

for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  const charts = count(s, 'new Chart(');
  const inspectors = count(s, '<ChartJsInspector');
  if (!charts && !inspectors) continue;
  const rel = path.relative(__dirname, f).split(path.sep).join('/');
  if (READ_ONLY_PREVIEWS.has(rel)) { skipped.push(`${rel}  new Chart(${charts})  read-only`); continue; }
  chartSites += charts;
  inspectorSites += inspectors;
  if (charts > inspectors) unwired.push(`${rel}  new Chart(${charts})  ChartJsInspector(${inspectors})`);
  else if (inspectors) wiredFiles.push(`${rel}  new Chart(${charts})  ChartJsInspector(${inspectors})`);
}

console.log(`editable new Chart( sites ....... ${chartSites}`);
console.log(`<ChartJsInspector> sites ......... ${inspectorSites}`);
console.log('');
console.log(`WIRED (${wiredFiles.length} file(s)):`);
for (const w of wiredFiles) console.log(`  ok  ${w}`);
console.log('');
console.log(`SKIPPED - read-only notebook previews (${skipped.length} file(s)):`);
for (const s of skipped) console.log(`  --  ${s}`);
console.log('');
if (unwired.length) {
  console.log(`UNWIRED (${unwired.length} file(s)):`);
  for (const u of unwired) console.log(`  !!  ${u}`);
  process.exitCode = 1;
} else {
  console.log('UNWIRED: none - every editable new Chart( site is wrapped in ChartJsInspector.');
}
