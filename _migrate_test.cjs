// Test: new-instance folder path + embedded <img> in comments recognized by migration.
const fs = require('fs');
const vm = require('vm');

const sandbox = {
  console, Promise, Set, Map, Object, Array, String, RegExp, Math, Date, JSON,
  Error, Symbol, Number, Boolean, parseFloat, parseInt, encodeURIComponent,
  decodeURIComponent, Blob, ArrayBuffer, Uint8Array,
  getDriveToken: () => 'FAKE_TOKEN',
  getDriveFileMeta: async (id) => ({ id, name: 'file_' + id + '.png', trashed: false }),
  getDriveFileRegistry: () => ({ }),
  findDriveFileByName: async () => '',
  resolveDrivePathFromNames: async (names) => ({
    leafId: 'leaf::' + names.join('/'),
    path: (names || []).map((n) => ({ name: n, id: 'id::' + n }))
  }),
  moveDriveFile: async () => true,
  renameDriveFile: async () => true,
  untrashDriveFile: async () => true,
  trashEmptyFolderChain: async () => {},
  registerDriveFile: async () => {},
  uploadLocalFile: async () => ({ id: 'NEW', name: 'x.png', driveUrl: 'https://drive.google.com/file/d/NEW/view' }),
  fetch: async () => ({
    ok: true, headers: new Map([['content-type', 'image/png']]),
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
  })
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

vm.runInContext(fs.readFileSync('src/utils/driveNaming.js', 'utf8').replace(/export\s+/g, '') + '\nglobalThis.__N = { driveFolderPath, sanitizeSlug };', sandbox);
const N = sandbox.__N;

let miSrc = fs.readFileSync('src/utils/migrateTestImages.js', 'utf8');
miSrc = miSrc.replace(/import \{[\s\S]*?\} from '\.\/driveUpload';/, '');
miSrc = miSrc.replace(/import \{[\s\S]*?\} from '\.\/driveNaming';/, '');
miSrc = miSrc.replace(/export\s+/g, '');
miSrc += '\nglobalThis.__M = { effectiveInstanceName, collectTestImageRefs, countTestImageRefs };\n';
vm.runInContext(miSrc, sandbox);
const M = sandbox.__M;

let fail = 0;
const check = (name, cond, extra) => {
  if (!cond) { console.log('FAIL', name, extra || ''); fail++; }
  else console.log('ok  ', name);
};

// 1) Folder path for a NEW instance (duplicate): 'New Instance 4', standalone test
const ctx = { project: '', test: 'Kinetics', instance: 'New Instance 4', scientist: 'Mario', section: 'Report' };
check('folder path = Kinetics/New_Instance_4/Report', JSON.stringify(N.driveFolderPath(ctx)) === '["Kinetics","New_Instance_4","Report"]', JSON.stringify(N.driveFolderPath(ctx)));
const ctxProj = { ...ctx, project: 'Proj' };
check('with project = Proj/Kinetics/New_Instance_4/Report', JSON.stringify(N.driveFolderPath(ctxProj)) === '["Proj","Kinetics","New_Instance_4","Report"]', JSON.stringify(N.driveFolderPath(ctxProj)));

// 2) Image embedded in the comments text box (lh3 URL) IS found by the migration
const t = {
  id: 't1', name: 'Kinetics', instanceName: 'New Instance 4', operator: 'Mario', projectNames: [],
  comments: '<p>text</p><figure><img src="https://lh3.googleusercontent.com/d/LH3ID123" alt="Figure 1"></figure>'
};
const refs = M.collectTestImageRefs(t, [t]);
check('embedded <img> in comments found', refs.length === 1, 'refs=' + refs.length);
check('fileId extracted from lh3', refs.length > 0 && refs[0].fileId === 'LH3ID123', refs.length > 0 ? refs[0].fileId : 'none');
check('ctx.instance = New Instance 4', refs.length > 0 && refs[0].ctx.instance === 'New Instance 4');
check('ctx.section = Report', refs.length > 0 && refs[0].ctx.section === 'Report');
check('countTestImageRefs finds it', M.countTestImageRefs([t]) === 1);

// 3) Data URL (local image) is NOT a Drive ref → migration correctly ignores it
const tLocal = { id: 't2', name: 'Kinetics', instanceName: 'New Instance 4', comments: '<img src="data:image/jpeg;base64,AAAA">' };
check('local dataUrl image NOT counted', M.collectTestImageRefs(tLocal, [tLocal]).length === 0);

console.log(fail === 0 ? '=== ALL PASS ===' : ('=== ' + fail + ' FAILURES ==='));
process.exit(fail === 0 ? 0 : 1);
