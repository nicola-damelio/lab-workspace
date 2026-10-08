import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync('_workspace_resync_test.mjs', 'utf8');
const cut = src.indexOf('const noMirror = await R.sweepWorkspaceDrive(');
const tail = [
  "const noMirror = await R.sweepWorkspaceDrive({ adapter: fakeDrive(), known: KNOWN, mirror: {} });",
  "const dump = (tag, rep) => {",
  "  console.log(tag, 'reason', rep.reason || '-');",
  "  console.log(tag, 'datasets', JSON.stringify((rep.datasets || []).map((d) => ({ f: d.folderName, id: d.id, slug: d.slug }))));",
  "  console.log(tag, 'recoverable', JSON.stringify(rep.recoverable));",
  "  (rep.issues || []).forEach((i) => console.log(tag, '  ', i.kind, '|folder:', i.folder || i.datasetFolder || '-', '|project:', i.projectName || '-', '|scope:', i.scope || '-', '|folderId:', i.folderId || '-', '|container:', i.container || '-'));",
  "};",
  "dump('MIRROR', REPORT);",
  "dump('NOMIRROR', noMirror);"
].join('\n');
writeFileSync('tmp_dbg3.mjs', src.slice(0, cut) + tail + '\n');
