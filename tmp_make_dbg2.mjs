import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync('_workspace_resync_test.mjs', 'utf8');
const cut = src.indexOf('const K = kinds(REPORT);');
const tail = [
  "console.log('datasetFolders');",
  "REPORT.datasets.forEach((d) => console.log('  ', JSON.stringify({ folderName: d.folderName, folderId: d.folderId, id: d.id, slug: d.slug, deleted: d.deleted, listedLocally: d.listedLocally, listedInIndex: d.listedInIndex, mirror: !!d.fromMirror })));",
  "console.log('counts', JSON.stringify(REPORT.counts, null, 1));",
  "console.log('issues');",
  "REPORT.issues.forEach((i) => console.log('  ', JSON.stringify(i).slice(0, 200)));",
  "console.log('recoverable', JSON.stringify(REPORT.recoverable));",
  "console.log('index datasets', JSON.stringify(REPORT.index.datasets));"
].join('\n');
writeFileSync('tmp_dbg2.mjs', src.slice(0, cut) + tail + '\n');
