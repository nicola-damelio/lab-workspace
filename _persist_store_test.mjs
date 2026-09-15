/* =========================================================================
   _persist_store_test.mjs — « J'IMPORTE, JE FERME LE PROJET, JE LE ROUVRE :
   LE TEXTE A DISPARU. »

   Ce test ne relit PAS le code source : il EXÉCUTE le magasin de projets RÉEL
   (src/components/AppModules/projectsModule.jsx) dans Node, branché sur un
   localStorage qui a un QUOTA, et il rejoue le scénario entier :

     1. quota large    → l'import s'écrit, se relit, texte + références + liens ;
     2. quota PLEIN    → l'écriture ÉCHOUE. `saveProjects` l'avalait : la page
        annonçait « ✓ 3 section(s) filled · 12 numbered reference(s) » et le
        projet relu n'avait RIEN — c'est exactement le « le texte a disparu »
        signalé. Il le dit maintenant, `saveProjectsChecked` le PROUVE
        (ok:false + champ manquant), et l'import réessaie en allégeant les
        figures : le TEXTE et les RÉFÉRENCES arrivent quand même ;
     3. quota impossible → l'échec reste rapporté (la page affiche « NOT SAVED »
        au lieu d'un faux succès).

   Le bundle est construit avec le Vite du dépôt (build SSR) : ce sont donc bien
   les modules réels, pas des copies.
   ========================================================================= */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = '.tmp_persist';
const CONFIG = `${DIR}/vite.config.mjs`;
const OUT = `${DIR}/out`;
/* Le Vite du dépôt, lancé sans passer par un shell (npx + shell:true déclenche
   un avertissement de sécurité à chaque exécution). */
const VITE_BIN = fileURLToPath(new URL('./node_modules/vite/bin/vite.js', import.meta.url));

/* Le localStorage du test : un quota en octets, comme un vrai navigateur. */
const FAKE_SRC = [
  'export const store = new Map();',
  'let quota = Infinity;',
  'export const setQuota = (n) => { quota = n; };',
  'export const used = () => { let t = 0; store.forEach((v) => { t += String(v).length; }); return t; };',
  'globalThis.localStorage = {',
  '  get length() { return store.size; },',
  '  key: (i) => Array.from(store.keys())[i] || null,',
  '  getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),',
  '  removeItem: (k) => { store.delete(String(k)); },',
  '  clear: () => store.clear(),',
  '  setItem: (k, v) => {',
  '    const next = String(v);',
  "    const without = used() - String(store.get(String(k)) || '').length;",
  '    if (without + next.length > quota) {',
  "      const err = new Error('quota exceeded');",
  "      err.name = 'QuotaExceededError';",
  '      throw err;',
  '    }',
  '    store.set(String(k), next);',
  '  }',
  '};'
].join('\n');

const CONFIG_SRC = [
  "import react from '@vitejs/plugin-react';",
  'export default {',
  '  plugins: [react()],',
  "  logLevel: 'error',",
  '  build: {',
  "    ssr: '.tmp_persist/harness.mjs',",
  "    outDir: '.tmp_persist/out',",
  '    emptyOutDir: true,',
  '    minify: false,',
  "    target: 'node20',",
  "    rollupOptions: { output: { format: 'es', entryFileNames: 'harness.mjs' } }",
  '  }',
  '};'
].join('\n');
/* Le scénario, joué sur le module RÉEL (chaque ligne est écrite telle quelle). */
const HARNESS_SRC = [
  "import { setQuota } from './fake-ls.mjs';",
  'import {',
  '  loadProjects, saveProjects, saveProjectsChecked, lightenProjectForStorage,',
  '  projectFootprint, setProjectDatasetScope, PROJECTS_KEY',
  "} from '../src/components/AppModules/projectsModule.jsx';",
  '',
  'let checks = 0;',
  "const ok = (cond, what) => { if (!cond) throw new Error('FAIL — ' + what); checks += 1; };",
  'const eq = (a, b, what) => {',
  '  if (JSON.stringify(a) !== JSON.stringify(b)) {',
  "    throw new Error('FAIL ' + what + ' / attendu : ' + JSON.stringify(b) + ' / obtenu : ' + JSON.stringify(a));",
  '  }',
  '  checks += 1;',
  '};',
  '',
  "setProjectDatasetScope('ds1');",
  "const LINKED = '<p>Aphids transmit potyviruses'",
  "  + ' <a class=\"cite-ref\" href=\"#ref-1\" data-ref=\"1\" title=\"Rossi 2018\">[1]</a>.</p>';",
  "const REFS = [{ id: 'r1', number: 1, title: 'Rossi 2018', authors: 'Rossi M' }];",
  'const project = {',
  "  id: 'p1', name: 'Potyvirus', datasetId: 'ds1',",
  "  background: LINKED, references: REFS, bibliography: [{ id: 'b1', title: 'Rossi 2018' }]",
  '};',
  '',
  '/* 1. Quota large : l import s écrit POUR DE VRAI et se relit. */',
  'setQuota(Infinity);',
  'const first = saveProjectsChecked([project], {',
  "  projectId: 'p1', fields: { background: LINKED, references: REFS }",
  '});',
  "ok(first.ok, 'écriture normale : saveProjectsChecked confirme (relecture du magasin)');",
  "eq(loadProjects().length, 1, 'le projet est dans le magasin');",
  "eq(loadProjects()[0].background, LINKED, 'le TEXTE importé est relu tel quel');",
  'ok(String(loadProjects()[0].background).includes(' + "'" + 'data-ref="1"' + "'" + '),',
  "  '…et la citation reste LIÉE à sa référence après relecture');",
  "eq(loadProjects()[0].references.map((r) => r.number), [1], 'les références numérotées sont relues');",
  '',
  '/* 2. Quota PLEIN : l écriture échoue — et le dit. */',
  'setQuota(400);',
  "const heavyText = LINKED + 'x'.repeat(4000);",
  'const refused = saveProjects([{ ...project, background: heavyText }]);',
  'ok(refused && refused.ok === false,',
  "  'saveProjects dit que le navigateur a REFUSÉ (avant : aucun retour, donc « tout va bien »)');",
  "ok(!!refused.error, '…avec la raison');",
  'const checked = saveProjectsChecked([{ ...project, background: heavyText }], {',
  "  projectId: 'p1', fields: { background: heavyText }",
  '});',
  "ok(!checked.ok, 'saveProjectsChecked PROUVE que le texte n’est PAS dans le magasin');",
  "ok(checked.missing.indexOf('background') !== -1, '…et nomme le champ manquant');",
  'eq(loadProjects()[0].background, LINKED,',
  "  'le magasin garde l’ANCIENNE version : c’est l’import qui aurait « disparu » à la réouverture');",
  '',
  "/* 3. Le MÊME import avec ses figures : l'allègement rend l'écriture possible. */",
  'setQuota(Infinity);',
  "const DATA_URL = 'data:image/png;base64,' + 'A'.repeat(2000000);",
  'const withFigures = {',
  '  ...project,',
  '  figures: {',
  "    background: [{ id: 'f1', url: DATA_URL, full: DATA_URL, name: 'image1.png',",
  "                  caption: 'Figure 1', anchor: 'Aphids transmit' }]",
  '  }',
  '};',
  'const fullSize = projectFootprint(withFigures);',
  "ok(fullSize > 900000, 'un import avec ses figures dépasse le budget d’allègement (octets : ' + fullSize + ')');",
  'setQuota(1000000);',
  "ok(!saveProjects([withFigures]).ok, 'la version complète ne rentre pas dans ce quota');",
  'const light = lightenProjectForStorage(withFigures);',
  "ok(light.dropped.length > 0, 'lightenProjectForStorage annonce ce qu’il a allégé');",
  "eq(light.project.background, LINKED, 'l’allègement ne touche JAMAIS le texte');",
  "eq(light.project.references, REFS, '…ni les références numérotées');",
  "eq(light.project.figures.background[0].name, 'image1.png', '…la figure garde sa place et son nom');",
  'eq(light.project.figures.background[0].pixelsMissing, true,',
  "  '…et dit que ses pixels ne sont pas gardés dans ce navigateur');",
  "ok(projectFootprint(light.project) < fullSize, 'la copie allégée est plus légère');",
  'const savedLight = saveProjectsChecked([light.project], {',
  "  projectId: 'p1', fields: { background: LINKED, references: REFS }",
  '});',
  "ok(savedLight.ok, 'la version allégée s’écrit ET se vérifie');",
  'const reread = loadProjects()[0];',
  "eq(reread.background, LINKED, 'après réouverture du projet, le TEXTE est toujours là');",
  "eq(reread.references.length, 1, '…et la référence numérotée aussi');",
  'ok(String(reread.background).includes(' + "'" + 'href="#ref-1"' + "'" + '),',
  "  '…et le lien de citation n’a pas été perdu');",
  '',
  "/* 4. Quota minuscule : l'échec reste rapporté (la page affiche « NOT SAVED »). */",
  'setQuota(20);',
  "const hopeless = saveProjectsChecked([{ ...project, background: 'y'.repeat(5000) }], {",
  "  projectId: 'p1', fields: { background: 'y'.repeat(5000) }",
  '});',
  "ok(!hopeless.ok, 'quota impossible : l’échec est rapporté, jamais transformé en succès');",
  "ok(!!hopeless.error, '…avec la raison à montrer à l’utilisateur');",
  "ok(!!PROJECTS_KEY, 'la clé du magasin est bien celle des projets');",
  '',
  "console.log('HARNESS OK ' + checks);"
].join('\n');

mkdirSync(DIR, { recursive: true });
writeFileSync(`${DIR}/fake-ls.mjs`, FAKE_SRC, 'utf8');
writeFileSync(`${DIR}/harness.mjs`, HARNESS_SRC, 'utf8');
writeFileSync(CONFIG, CONFIG_SRC, 'utf8');

try {
  /* Le bundle SSR (Vite du dépôt) : les modules RÉELS, pas des copies. */
  if (existsSync(VITE_BIN)) {
    execFileSync(process.execPath, [VITE_BIN, 'build', '--config', CONFIG], { stdio: 'pipe' });
  } else {
    execFileSync('npx', ['vite', 'build', '--config', CONFIG], { stdio: 'pipe', shell: true });
  }
  const out = execFileSync(process.execPath, [`${OUT}/harness.mjs`], { encoding: 'utf8' });
  const found = /HARNESS OK (\d+)/.exec(out);
  if (!found) throw new Error(`sortie du harnais inattendue : ${out.slice(-1500)}`);
  console.log(`✅ ${found[1]} tests passés (import : écriture vérifiée, quota plein, allègement des figures)`);
} catch (err) {
  console.error(`${(err && err.stdout) || ''}${(err && err.stderr) || ''}${(err && err.message) || err}`);
  process.exitCode = 1;
} finally {
  rmSync(DIR, { recursive: true, force: true });
}
