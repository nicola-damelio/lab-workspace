import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

/* 1. Lancer la suite et consigner la sortie telle quelle (encodage utf8 préservé). */
const r = spawnSync(process.execPath, ['_workspace_resync_ui_test.mjs'], {
  cwd: process.cwd(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
});
writeFileSync('tmp_ui_result.txt',
  `exit=${r.status}\n--- STDOUT ---\n${r.stdout || ''}\n--- STDERR ---\n${r.stderr || ''}\n`, 'utf8');

/* 2. Contrôle préalable : chaque chaîne cherchée par `has(...)` existe-t-elle
      VRAIMENT dans la source visée ? (évite de découvrir un désaccord dans un
      message d'assertion au lieu de la cause). */
const files = {
  RESYNC_SRC: 'src/utils/workspaceResync.js',
  PANEL_SRC: 'src/components/WorkspaceResyncPanel.jsx',
  SETTINGS_SRC: 'src/components/AppModules/settingsModule.jsx',
  APP_SRC: 'src/App.jsx',
  BTN: 'src/components/WorkspaceResyncPanel.jsx'
};
const srcs = {};
for (const [k, p] of Object.entries(files)) srcs[k] = readFileSync(p, 'utf8');

const test = readFileSync('_workspace_resync_ui_test.mjs', 'utf8');
const out = [];
const re = /has\((RESYNC_SRC|PANEL_SRC|SETTINGS_SRC|APP_SRC|BTN),\s*'((?:[^'\\]|\\.)*)'/g;
let m;
while ((m = re.exec(test))) {
  const key = m[1];
  const needle = m[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  const hit = srcs[key].includes(needle);
  out.push(`${hit ? 'OK  ' : 'MISS'} ${key}  ${JSON.stringify(needle)}`);
}
writeFileSync('tmp_needles.txt', out.join('\n') + '\n', 'utf8');
