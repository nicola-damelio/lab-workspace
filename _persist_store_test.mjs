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
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
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
  "import { setQuota, used } from './fake-ls.mjs';",
  'import {',
  '  loadProjects, saveProjects, saveProjectsChecked, lightenProjectForStorage,',
  '  saveProjectsRescued, linkProjectFiguresToDrive, dropOneFigurePixels,',
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
  "/* 5. UN IMPORT ÉCRIT DEUX FOIS : le texte (et ses figures), PUIS la référence",
  "      du document que l'archivage vient de déposer sur le Drive. Ces deux",
  "      écritures sont séparées par l'envoi (un `await`) : la seconde repartait de",
  "      la liste des projets capturée AVANT l'import, donc elle réécrivait l'ancien",
  "      projet — le texte DISPARAISSAIT de l'écran comme du magasin (« après",
  "      l'import, tout disparaît… je dois cliquer Load the Drive copy »), et les",
  "      figures devaient être reprises par un second import « Figures only ».",
  "      Le correctif : toute écriture repart de la liste VIVANTE. Les deux bases",
  "      sont rejouées ici, sur le magasin RÉEL. */",
  'setQuota(Infinity);',
  "const DRIVE = { id: 'doc-1', name: 'Potyvirus_document.json', folder: 'Lab/Pepper/projects/Potyvirus' };",
  'const imported = {',
  '  ...project, background: LINKED, references: REFS,',
  "  figures: { background: [{ id: 'f1', name: 'image1.png' }] }",
  '};',
  'ok(saveProjectsChecked([imported], {',
  "  projectId: 'p1', fields: { background: LINKED, references: REFS }",
  "}).ok, 'l’import écrit le texte, ses références et ses figures — et le VÉRIFIE');",
  "eq(loadProjects()[0].background, LINKED, '…le magasin a bien l’import');",
  '',
  "/* ✗ LA BASE PÉRIMÉE (le défaut d'origine) : le second commit reconduit l'ancien",
  "   projet, et il ne reste RIEN de l'import. */",
  "const stale = { ...project, background: '', references: [], figures: {} };",
  'saveProjectsChecked([{ ...stale, driveDocument: DRIVE }], {',
  "  projectId: 'p1', fields: { driveDocument: DRIVE }",
  '});',
  "eq(loadProjects()[0].background, '',",
  "  '…avec la base périmée, la seconde écriture EFFACE l’import (c’était exactement le défaut)');",
  '',
  "/* ✓ LA BASE VIVANTE (le correctif) : on repart de ce que la première écriture a",
  "   laissé — texte, références et figures survivent au second commit. */",
  "saveProjectsChecked([imported], { projectId: 'p1', fields: { background: LINKED } });",
  'const live = loadProjects()[0];',
  'const second = saveProjectsChecked([{ ...live, driveDocument: DRIVE }], {',
  "  projectId: 'p1', fields: { driveDocument: DRIVE }",
  '});',
  "ok(second.ok, 'la référence du document Drive s’écrit à son tour (et se vérifie)');",
  'const finalProject = loadProjects()[0];',
  "eq(finalProject.background, LINKED, 'le TEXTE importé est TOUJOURS là après la seconde écriture');",
  "eq(finalProject.references.map((r) => r.number), [1], '…ses références numérotées aussi');",
  "eq((finalProject.figures.background || []).map((f) => f.name), ['image1.png'],",
  "  '…et ses FIGURES : le second import « Figures only » n’a plus lieu d’être');",
  "eq(finalProject.driveDocument, DRIVE, '…et la référence du fichier Drive est bien gardée');",
  '',
  "/* ======================================================================",
  "   5. LE NAVIGATEUR EST PLEIN : L'ÉCRITURE EST SAUVÉE (plus de cul-de-sac).",
  "   Le magasin du navigateur (~5 Mo par site, partagé par tous les datasets)",
  "   était plein : CHAQUE modification était refusée et la page se contentait",
  "   d'avertir. saveProjectsRescued refait de la place DANS le magasin et",
  "   réessaie — texte et références d'abord, images ensuite, du moins coûteux au",
  "   plus coûteux, et le strict minimum.",
  "   ====================================================================== */",
  "localStorage.clear();",
  'setQuota(Infinity);',
  "const DRIVE_FIG = {",
  "  id: 'f1', name: 'image1.png', caption: 'Figure 1', anchor: 'Aphids transmit',",
  "  url: 'data:image/png;base64,' + 'B'.repeat(300000),",
  "  full: 'data:image/png;base64,' + 'C'.repeat(300000),",
  "  driveUrl: 'https://drive.google.com/file/d/AAA/view'",
  '};',
  "const LOCAL_FIG = {",
  "  id: 'f2', name: 'image2.png', caption: 'Figure 2',",
  "  url: 'data:image/png;base64,' + 'D'.repeat(300000),",
  "  full: 'data:image/png;base64,' + 'E'.repeat(300000)",
  '};',
  "const withFigs = { ...project, figures: { background: [DRIVE_FIG, LOCAL_FIG] } };",
  "ok(saveProjects([withFigs]).ok, 'la version complète est écrite tant que le magasin a de la place');",
  "const heavy = LINKED + 'x'.repeat(200000);",
  'setQuota(1000000);',
  "ok(!saveProjects([{ ...withFigs, background: heavy }]).ok,",
  "  'le magasin plein REFUSE la version complète (c’est le cas signalé)');",
  "const rescued = saveProjectsRescued([{ ...withFigs, background: heavy }],",
  "  { projectId: 'p1', fields: { background: heavy } });",
  "ok(rescued.ok, 'saveProjectsRescued ÉCRIT quand même : l’échec n’est plus un cul-de-sac');",
  "eq(rescued.linked, 1, 'la figure dont le Drive a le fichier est LIÉE (aucune perte)');",
  "eq(rescued.droppedImages, 0, '…et AUCUNE image n’est jetée quand le lien suffit');",
  "eq(rescued.list[0].figures.background[0].url, 'https://drive.google.com/file/d/AAA/view',",
  "  '…le lien remplace l’image encodée dans le magasin');",
  "eq(rescued.list[0].figures.background[0].pixelsMissing, undefined,",
  "  '…sans être marquée « pixels perdus » : l’image est sur le Drive');",
  "eq(rescued.list[0].figures.background[1].pixelsMissing, undefined,",
  "  '…et l’image qui n’a pas de copie Drive est gardée telle quelle');",
  "eq(loadProjects()[0].background, heavy, 'le TEXTE est bien dans le magasin après l’allègement');",
  "eq(rescued.list[0].references, REFS, '…et les références numérotées sont intactes');",
  '',
  "/* 5b. Sans aucune copie Drive : le STRICT MINIMUM est jeté, pas tout. */",
  'localStorage.clear();',
  'setQuota(Infinity);',
  "const F1 = { id: 'g1', name: 'gel1.png', caption: 'Gel 1', url: 'data:image/png;base64,' + 'G'.repeat(300000), full: 'data:image/png;base64,' + 'H'.repeat(300000) };",
  "const F2 = { id: 'g2', name: 'gel2.png', caption: 'Gel 2', url: 'data:image/png;base64,' + 'I'.repeat(300000), full: 'data:image/png;base64,' + 'J'.repeat(300000) };",
  "const twoFigs = { ...project, figures: { results: [F1, F2] } };",
  "ok(saveProjects([twoFigs]).ok, 'les deux figures sont écrites tant qu’il y a de la place');",
  'setQuota(1000000);',
  "const minimal = saveProjectsRescued([{ ...twoFigs, background: LINKED + 'q'.repeat(1000) }]);",
  "ok(minimal.ok, 'deux figures sans copie Drive : l’écriture passe quand même');",
  "eq(minimal.droppedImages, 1, '…en jetant UNE seule image (la plus lourde), pas les deux');",
  "eq(minimal.list[0].figures.results[0].pixelsMissing, true, 'la première image dit que ses pixels ne sont plus gardés');",
  "eq(minimal.list[0].figures.results[0].name, 'gel1.png', '…elle garde sa place et son nom');",
  "eq(minimal.list[0].figures.results[0].caption, 'Gel 1', '…et sa légende');",
  "eq(minimal.list[0].figures.results[1].pixelsMissing, undefined, 'et la SECONDE garde ses pixels (c’est le strict minimum)');",
  "eq(minimal.list[0].figures.results[1].url.startsWith('data:image/png'), true, '…ses pixels sont toujours là');",
  '',
  "/* 5c. Les listes de figures dont les fichiers sont DÉJÀ sur le cloud : le",
  "   dernier poste qu'on peut rendre sans rien perdre (« ⬇ Add missing from",
  "   Drive » les relit). Une image qui n'existe QUE dans ce navigateur, elle,",
  "   n'est JAMAIS oubliée : elle serait perdue pour de bon. */",
  'localStorage.clear();',
  'setQuota(Infinity);',
  'const libItem = (id, drive) => ({',
  "  id, label: id, addedAt: '2026-01-01T00:00:00.000Z',",
  "  url: 'data:image/png;base64,' + 'K'.repeat(300000),",
  "  full: 'data:image/png;base64,' + 'L'.repeat(300000),",
  "  drive, driveUrl: drive ? 'https://drive.google.com/file/d/BBB/view' : null",
  '});',
  "localStorage.setItem('labFiguresLibrary', JSON.stringify([libItem('cloud1', true), libItem('local1', false)]));",
  "saveProjects([{ ...project, background: LINKED }]);",
  "const libBytes = String(localStorage.getItem('labFiguresLibrary')).length;",
  'setQuota(used() + 400000);',
  "const prunedLib = saveProjectsRescued([{ ...project, background: LINKED + 'p'.repeat(700000) }]);",
  "ok(prunedLib.ok, 'magasin plein : l’écriture passe après avoir oublié les listes dont les fichiers sont sur le cloud');",
  "ok(prunedLib.forgotten >= 1, '…et l’allègement DIT ce qu’il a oublié');",
  "eq(JSON.parse(localStorage.getItem('labFiguresLibrary')).map((i) => i.id), ['local1'],",
  "  '…l’image qui n’existe QUE dans ce navigateur est gardée');",
  "ok(String(localStorage.getItem('labFiguresLibrary')).length < libBytes, '…et le magasin a réellement perdu du poids');",
  '',
  "/* 5d. Plus rien à libérer : l'échec reste rapporté — AVEC LA MESURE. */",
  'localStorage.clear();',
  'setQuota(Infinity);',
  'saveProjects([project]);',
  'setQuota(50);',
  "const stuck = saveProjectsRescued([{ ...project, background: LINKED + 'z'.repeat(500000) }]);",
  "ok(!stuck.ok, 'quand rien ne peut être libéré, l’écriture échoue — et le dit');",
  "ok(!!stuck.error, '…avec la raison donnée par le navigateur');",
  "eq(stuck.scopedChanged, false,",
  "  '…et un échec n’annonce AUCUN changement de liste (sinon la page ré-adopterait la liste et boucherait)');",
  'ok(stuck.usage.total > 0 && stuck.usage.keys.length > 0,',
  "  '…et la MESURE du magasin, clé par clé (le message nomme ce qui occupe la place)');",
  'eq(stuck.usage.keys[0].key, PROJECTS_KEY, \'…en commençant par le plus lourd\');',
  "eq(stuck.list[0].background, LINKED + 'z'.repeat(500000),",
  "  'la liste rendue est celle DONNÉE : rien n’a été écrit, la page garde ce qu’elle a');",
  "eq(loadProjects()[0].background, LINKED, '…et le magasin garde l’ancienne version (jamais d’écriture à moitié)');",
  '',
  "/* 5e. LE POIDS EST DANS UN AUTRE DATASET — c'est la SOMME qui doit rentrer,",
  "   pas seulement la part du projet ouvert : sinon l'écriture échouerait pour",
  "   toujours en conseillant de supprimer un dataset (le cul-de-sac signalé). */",
  'localStorage.clear();',
  'setQuota(Infinity);',
  "setProjectDatasetScope('ds2');",
  "saveProjects([{ id: 'p2', name: 'Autre', datasetId: 'ds2', background: LINKED,",
  '  figures: { background: [LOCAL_FIG] } }]);',
  'setProjectDatasetScope(\'ds1\');',
  "saveProjects([{ ...project, background: LINKED }]);",
  'setQuota(used() + 300000);',
  "const otherDs = saveProjectsRescued([{ ...project, background: LINKED + 'o'.repeat(400000) }]);",
  "ok(otherDs.ok, 'l’écriture passe en allégeant AUSSI les projets des autres datasets');",
  "eq(otherDs.droppedImages, 1, '…et elle dit ce qui a été jeté, où que ce soit');",
  "eq(otherDs.scopedChanged, false, '…sans toucher la liste du dataset ouvert (aucun de ses projets n’a changé)');",
  "eq(loadProjects()[0].background, LINKED + 'o'.repeat(400000), '…et le texte écrit est celui du dataset ouvert');",
  "eq(loadProjects('ds2')[0].figures.background[0].pixelsMissing, true,",
  "  '…le projet de l’autre dataset, lui, est allégé (ses pixels se réimportent, son texte reste)');",
  "eq(loadProjects('ds2')[0].background, LINKED, '…son texte est intact');",
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

  /* Les GARDE-FOUS que ces scénarios protègent : le code doit les garder. */
  const src = (p) => readFileSync(p, 'utf8');
  const PROJ_SRC = src('src/components/AppModules/projectsModule.jsx');
  const PAGE_SRC = src('src/components/AppModules/projectDetailModule.jsx');
  const ROOM_SRC = src('src/utils/localStoreRoom.js');
  const LIB_SRC = src('src/utils/figuresLibrary.js');
  const guards = [
    [PROJ_SRC.includes('export const saveProjectsRescued = (list, { projectId = \'\', fields = {} } = {}) => {'),
      'le magasin sait écrire malgré un magasin plein (saveProjectsRescued)'],
    [PROJ_SRC.includes('export const linkProjectFiguresToDrive = (project) => {'),
      'la copie déjà sur le Drive devient un LIEN, sans rien perdre'],
    [PROJ_SRC.includes('export const dropOneFigurePixels = (project, section, index) => {'),
      'l’urgence jette les pixels UNE figure à la fois (le strict minimum)'],
    [PROJ_SRC.includes('pruneRecoverableLibraryCaches()'),
      'les listes de figures déjà sur le cloud sont le dernier poste rendu'],
    [PAGE_SRC.includes('const res = saveProjectsRescued(projects);'),
      'la page projet ÉCRIT au lieu de se contenter d’avertir'],
    [PAGE_SRC.includes("const [storageWarning, setStorageWarning] = useState('');"),
      'un échec définitif reste affiché'],
    [PAGE_SRC.includes('const storageRefusedText = (res) => {')
      && PAGE_SRC.includes('describeTopConsumers(usage, 4)'),
      '…et il MESURE le magasin au lieu de répéter « ~5 Mo »'],
    [PAGE_SRC.includes('fig.pixelsMissing &&'),
      'une figure dont les pixels ne sont plus gardés le dit à l’écran'],
    [ROOM_SRC.includes('export const readLocalStoreUsage = (storage) => {'),
      'localStoreRoom mesure le magasin, clé par clé'],
    [LIB_SRC.includes('export const pruneRecoverableLibraryCaches = ({ storage } = {}) => {')
      && LIB_SRC.includes('i.drive === true && driveIdOfLibraryItem(i)'),
      'seules les entrées dont les pixels sont sur le cloud sont oubliées']
  ];
  const missingGuards = guards.filter(([cond]) => !cond).map(([, what]) => what);
  if (missingGuards.length) throw new Error(`garde-fou manquant : ${missingGuards.join(' · ')}`);

  console.log(`✅ ${Number(found[1]) + guards.length} tests passés (écriture vérifiée, quota plein, allègement des figures, écriture sauvée sans place libre, garde-fous du code)`);
} catch (err) {
  console.error(`${(err && err.stdout) || ''}${(err && err.stderr) || ''}${(err && err.message) || err}`);
  process.exitCode = 1;
} finally {
  rmSync(DIR, { recursive: true, force: true });
}
