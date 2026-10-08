import { register } from 'node:module';
register('./_esm_test_hook.mjs', import.meta.url);
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
  setItem: (k, v) => store.set(String(k), String(v)),
  removeItem: (k) => store.delete(String(k))
};
const W = await import('./src/utils/workspaceDrive.js');
const R = await import('./src/utils/workspaceResync.js');
const folder = (id, name) => ({ id, name, mimeType: 'application/vnd.google-apps.folder' });
const doc = (id, name) => ({ id, name, mimeType: 'application/json' });
const TREE = new Map([
  ['WS', [folder('WSDIR', '_workspace'), folder('TWIN', '_workspace'), folder('DS1', 'Pepper viruses')]],
  ['WSDIR', [doc('STATE', 'state.json'), folder('COPIES', 'datasets')]],
  ['TWIN', [folder('COPIES2', 'datasets')]],
  ['DS1', [folder('P1', 'projects')]],
  ['P1', []]
]);
const STATE = W.workspaceStateJson(W.buildWorkspaceState({
  datasets: [{ id: 'ds1', title: 'Pepper viruses' }],
  projects: [{ id: 'p1', name: 'Alpha', datasetId: 'ds1' }],
  at: '2026-01-02T00:00:00.000Z'
}));
console.log('state json head:', STATE.slice(0, 120));
console.log('no-hook parse:', !!W.parseWorkspaceState(STATE), W.parseWorkspaceState(STATE).savedAt);
const spy = { list: [], download: [] };
const adapter = {
  available: async () => true,
  findWorkspaceFolder: async () => 'WS',
  listChildren: async (id) => { spy.list.push(String(id)); return TREE.get(String(id)) || []; },
  downloadText: async (id) => { spy.download.push(String(id)); return id === 'STATE' ? STATE : ''; }
};
const rep = await R.sweepWorkspaceDrive({ adapter, known: { datasets: [{ id: 'ds1', title: 'Pepper viruses' }], projects: [] }, mirror: {} });
console.log('reason', rep.reason, 'ws', rep.workspaceFolderId);
console.log('index', rep.index.savedAt, rep.index.datasets.length, rep.index.projects.length);
console.log('kinds', rep.issues.map((i) => i.kind));
console.log('spy', spy);
