/* =========================================================================
   _viewer_style_recall_test.mjs — LE STYLE QU'UNE EXPÉRIENCE RETIENT.

   La demande : « when an experiment opens, after bringing back to live its files
   (pdb, trajectory etc) it should remember also the style file (called snapshot or
   in its absence the cumulative) of the viewer and apply it automatically. »

   CE QUI EST VÉRIFIÉ ICI EST EXÉCUTÉ :

     · le FICHIER — ses deux noms canoniques, la reconnaissance d'un nom renommé à
       la main, et LA RÈGLE DE LA DEMANDE (le snapshot de l'expérience gagne, le
       cumulatif s'applique EN SON ABSENCE) ;
     · son CONTENU — écrit puis relu (le format du ⬇ Export du viewer), et ce qui
       n'est PAS un style est refusé (`null`) : un autre .json du dossier ne peut
       pas être appliqué par erreur ;
     · la MÉMOIRE par instance — la clé, l'écriture, la lecture, et le repli quand
       le style qu'elle nomme a été supprimé depuis ;
     · LES DEUX GESTES DU VIEWER, sortis de la source et exécutés avec des
       doublures : `rememberViewerStyle` (mémoire + fichier du dossier de
       l'expérience, sous le nom canonique du mode ; sans Drive, la mémoire locale
       reste et rien n'est promis) et `recallViewerStyle` (la mémoire du poste
       d'abord — AUCUNE requête ; le fichier du dossier ensuite, snapshot gagnant ;
       un style déjà choisi par l'utilisateur n'est jamais écrasé).

   Le reste (l'effet d'ouverture, les appels depuis 💾 / 📂 / ⬆) est lu dans la
   source, comme les autres garde-fous du viewer, qui est un .jsx et ne s'importe
   pas sous Node.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};

/* ── Un localStorage de poche : la mémoire du module est EXÉCUTÉE pour de vrai,
   sans magasin partagé avec un autre garde-fou. ──────────────────────────── */
const fakeStore = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: {
    getItem: (k) => (fakeStore.has(String(k)) ? fakeStore.get(String(k)) : null),
    setItem: (k, v) => fakeStore.set(String(k), String(v))
  }
});
const FILES = await import('./src/utils/viewerStyleFile.js');

const SRC = process.env.VIEWER_SRC || new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url);
const VIEW = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
const countOf = (re) => (VIEW.match(re) || []).length;

/* ── Extraction : `const name = (…) => { … };` (le `async` est accepté). ─── */
const sliceFn = (src, name) => {
  const head = [`const ${name} = async (`, `const ${name} = (`].find((h) => src.includes(h));
  assert.ok(head, `fonction ${name} introuvable`);
  const start = src.indexOf(head);
  const arrow = src.indexOf('=>', start);
  const offset = src.slice(arrow + 2).search(/\S/);
  const body = arrow + 2 + offset;
  let depth = 0;
  for (let i = body; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return `${src.slice(start, i + 1)};`;
    }
  }
  throw new Error(`${name} : corps non terminé`);
};

/* ══ 1. LE FICHIER — les deux noms, la reconnaissance, LA PRÉFÉRENCE ════════ */
eq(FILES.viewerStyleFileName('snapshot'), 'viewer-style-snapshot.json', 'le snapshot a son nom canonique');
eq(FILES.viewerStyleFileName('theme'), 'viewer-style-cumulative.json', 'le cumulatif a le sien');
eq(FILES.viewerStyleFileName('peu importe'), 'viewer-style-snapshot.json',
  'un mode inconnu retombe sur le snapshot : jamais de troisième nom');
eq(FILES.VIEWER_STYLE_PREFERENCE, ['snapshot', 'theme'], 'l’ordre de la demande est écrit noir sur blanc');
eq(FILES.VIEWER_STYLE_EXT, 'json', 'c’est un .json que la lecture du dossier cherche');

eq(FILES.viewerStyleModeOfName('viewer-style-snapshot.json'), 'snapshot', 'le nom canonique du snapshot se reconnaît');
eq(FILES.viewerStyleModeOfName('viewer-style-cumulative.json'), 'theme', 'celui du cumulatif aussi');
eq(FILES.viewerStyleModeOfName('Viewer style snapshot (2026).json'), 'snapshot',
  'un fichier RENOMMÉ à la main reste reconnu (séparateurs et majuscules neutralisés)');
eq(FILES.viewerStyleModeOfName('viewer-style-snapshot-2.json'), 'snapshot', 'un suffixe ajouté ne le cache pas');
eq(FILES.viewerStyleModeOfName('viewer-theme-My_theme.json'), '',
  'un fichier du ⬇ Export du viewer (viewer-theme-…) n’est PAS un fichier d’expérience');
eq(FILES.viewerStyleModeOfName('ms_struct_7.pdb'), '', 'un .pdb n’en est pas un');
eq(FILES.viewerStyleModeOfName('run3.xtc'), '', 'une trajectoire non plus');
eq(FILES.viewerStyleModeOfName(''), '', 'un nom vide ne dit rien');
ok(FILES.isViewerStyleFile(FILES.VIEWER_STYLE_FILE_NAMES.theme), 'isViewerStyleFile suit la même règle');

/* LA RÈGLE DE LA DEMANDE, exécutée : « the style file (called snapshot or in its
   absence the cumulative) ». */
const snap = { id: 'S', name: 'viewer-style-snapshot.json', modifiedTime: '2026-01-01T10:00:00Z' };
const cumuOld = { id: 'C1', name: 'viewer-style-cumulative.json', modifiedTime: '2026-01-01T09:00:00Z' };
const cumuNew = { id: 'C2', name: 'viewer-style-cumulative.json', modifiedTime: '2026-02-01T09:00:00Z' };
eq(FILES.pickViewerStyleFile([cumuNew, snap]).id, 'S', 'LE SNAPSHOT GAGNE, même quand le cumulatif est plus récent');
eq(FILES.pickViewerStyleFile([cumuOld, cumuNew]).id, 'C2', 'en l’ABSENCE de snapshot, c’est le cumulatif');
eq(FILES.pickViewerStyleFile([cumuNew, cumuOld]).id, 'C2', '…et le plus récent gagne dans un même mode');
eq(FILES.pickViewerStyleFile([{ id: 'X', name: 'structure.pdb' }, { id: 'Y', name: 'notes.json' }]), null,
  'aucun fichier de style → rien à appliquer (jamais un autre .json)');
eq(FILES.pickViewerStyleFile([]), null, 'un dossier vide ne propose rien');
eq(FILES.viewerStyleModeOfName(FILES.pickViewerStyleFile([cumuOld]).name), 'theme',
  '…et le repli ne se fait jamais passer pour un snapshot');

/* ══ 2. LE CONTENU — ce qui s'écrit et ce qui se relit ═════════════════════ */
const entry = { v: 1, name: 'Membrane · POPC', savedAt: '2026-01-05T08:00:00Z', global: {}, sections: { 'protein|A': { tree: {} } } };
const payload = FILES.viewerStyleFilePayload({
  mode: 'snapshot', name: 'Membrane · POPC', entry, instance: 'cond_7', savedAt: '2026-01-05T09:00:00Z'
});
eq(payload.app, FILES.VIEWER_STYLE_APP, 'le fichier dit ce qu’il est');
eq(payload.mode, 'snapshot', '…son mode');
eq(payload.instance, 'cond_7', '…et la condition qui l’a déposé (pour un humain qui ouvre le dossier)');
eq(payload.entry, entry, 'l’entrée du viewer voyage TELLE QUELLE (aucune perte)');
eq(FILES.viewerStyleFilePayload({ mode: 'inconnu', name: 'x', entry }).mode, 'snapshot', 'un mode inconnu s’écrit en snapshot');
eq(FILES.viewerStyleFilePayload({ mode: 'snapshot', name: 'x', entry: null }).entry, null, 'une entrée absente ne se maquille pas');
eq(FILES.parseViewerStyleFile(JSON.stringify(payload)), { mode: 'snapshot', name: 'Membrane · POPC', entry },
  'l’ALLER-RETOUR par le fichier rend exactement le style écrit');
eq(FILES.parseViewerStyleFile(JSON.stringify({ mode: 'theme', name: 'Protéines', entry: { classes: { protein: {} } } })).mode,
  'theme', 'un fichier de thème se relit comme thème');
eq(FILES.parseViewerStyleFile(JSON.stringify({ name: 'Nue', classes: { protein: {} } })).mode, 'theme',
  'une entrée NUE (la forme qu’accepte le ⬆ Import) est reconnue');
eq(FILES.parseViewerStyleFile(JSON.stringify({ name: 'Nue', sections: { a: {} } })).mode, 'snapshot',
  '…et une scène nue est un snapshot');
eq(FILES.parseViewerStyleFile('{"a":1}'), null, 'un .json étranger est REFUSÉ (on ne devine pas)');
eq(FILES.parseViewerStyleFile('pas du json'), null, 'un fichier illisible ne casse rien');
eq(FILES.parseViewerStyleFile(''), null, 'un fichier vide non plus');
eq(FILES.parseViewerStyleFile(JSON.stringify({ mode: 'snapshot', entry })).name, 'Snapshot',
  'un fichier sans nom en reçoit un, plutôt que de rester anonyme');

/* ══ 3. LA MÉMOIRE PAR INSTANCE ════════════════════════════════════════════ */
eq(FILES.viewerStyleMemoryKey(''), 'labViewerStyle', 'sans instance connue, la clé générale reste');
eq(FILES.viewerStyleMemoryKey('GEC_Mutant_X'), 'labViewerStyle::GEC_Mutant_X',
  'une expérience nommée porte SA clé (le repère de la session 🧪)');
ok(FILES.viewerStyleMemoryKey('a') !== FILES.viewerStyleMemoryKey('b'), 'deux expériences ne partagent jamais une mémoire');
eq(FILES.viewerStyleMemoryOf({ mode: 'snapshot', name: '' }), null, 'sans nom, aucune mémoire n’est écrite');
eq(FILES.viewerStyleMemoryOf({ name: 'x' }).mode, 'snapshot', 'un mode absent vaut snapshot');
const written = FILES.viewerStyleMemoryOf({ mode: 'theme', name: ' Protéines ' });
eq(written.name, 'Protéines', 'la mémoire garde le nom NETTOYÉ');
ok(!!written.at, '…et l’horodatage du geste (lisible pour un humain)');

const key = FILES.viewerStyleMemoryKey('exp_7');
eq(FILES.loadViewerStyleMemory(key), null, 'une mémoire jamais écrite ne se lit pas');
FILES.saveViewerStyleMemory(key, { mode: 'theme', name: 'Protéines' });
eq(FILES.loadViewerStyleMemory(key).name, 'Protéines', '…et une mémoire écrite se relit (c’est elle qui rend le rappel instantané)');
eq(FILES.loadViewerStyleMemory(key).mode, 'theme', 'avec son mode — le cumulatif, donc rien à préférer à un snapshot');
fakeStore.set(key, 'pas du json');
eq(FILES.loadViewerStyleMemory(key), null, 'une mémoire illisible est ignorée (aucun rappel cassé)');
fakeStore.set(key, JSON.stringify({ mode: 'snapshot', name: '' }));
eq(FILES.loadViewerStyleMemory(key), null, 'une mémoire sans nom ne rappelle rien');
eq(FILES.saveViewerStyleMemory(key, { name: '' }), null, '…et l’écriture d’un nom vide est refusée');

// La mémoire qui nomme un style SUPPRIMÉ depuis ne rappelle rien : le fichier du
// dossier aura donc sa chance.
eq(FILES.viewerStyleEntryOf({ mode: 'snapshot', name: 'Gone' }, { snapshots: ['Kept'], themes: [] }), null,
  'une mémoire qui désigne un style supprimé depuis ne rappelle rien');
eq(FILES.viewerStyleEntryOf({ mode: 'snapshot', name: 'Kept' }, { snapshots: ['Kept'], themes: [] }),
  { mode: 'snapshot', name: 'Kept' }, '…et celle qui existe vraiment est rendue telle quelle');
eq(FILES.viewerStyleEntryOf({ mode: 'theme', name: 'T' }, { snapshots: [], themes: ['T'] }), { mode: 'theme', name: 'T' },
  'un thème est cherché dans SON magasin (et pas dans les snapshots)');
eq(FILES.viewerStyleEntryOf({ mode: 'theme', name: 'T' }, { snapshots: ['T'], themes: [] }), null,
  '…donc un thème absent des thèmes n’est pas pris pour un snapshot du même nom');
eq(FILES.viewerStyleEntryOf(null, { snapshots: ['T'] }), null, 'aucune mémoire → aucun rappel');

/* ══ 4. LE GESTE DU VIEWER — rememberViewerStyle, EXÉCUTÉ ══════════════════ */
/* Les fonctions sont sorties de la source et exécutées avec des doublures : on
   regarde CE QUI EST ÉCRIT (la mémoire, le fichier, son nom, son contenu) et CE QUI
   EST DIT — sans navigateur ni Drive. */
const buildRemember = () => new Function(
  'driveNaming', 'instanceKey', 'getDriveToken', 'uploadLocalFile', 'flashSetupMsg',
  'saveViewerStyleMemory', 'styleMemoryKeyRef', 'styleTouchedRef',
  'viewerStyleFileName', 'viewerStyleFilePayload',
  [
    sliceFn(VIEW, 'pymolSessionInstanceSlug'),
    sliceFn(VIEW, 'archiveViewerStyle'),
    sliceFn(VIEW, 'rememberViewerStyle'),
    'return { archiveViewerStyle, rememberViewerStyle };'
  ].join('\n')
);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const drive = { project: 'GEC', test: 'Mutant X', instance: '2026-01-05', scientist: 'Nico', section: 'Data', subsection: 'Structure' };
const uploads = [];
const msgs = [];
const memories = [];
const makeRemember = ({ token = () => 'tok', naming = drive, instance = 'cond_7', touched = { current: false } } = {}) => {
  const api = buildRemember()(
    naming, instance, token,
    async (arg) => { uploads.push(arg); return { id: 'F1', name: arg.name }; },
    (message) => msgs.push(message),
    (k, v) => { memories.push([k, v]); return v; },
    { current: 'labViewerStyle::GEC_Mutant_X' },
    touched,
    FILES.viewerStyleFileName, FILES.viewerStyleFilePayload
  );
  return { ...api, touched };
};

const online = makeRemember();
online.rememberViewerStyle('snapshot', 'Membrane · POPC', entry);
eq(online.touched.current, true, 'le geste clôt le rappel automatique (le style de l’utilisateur gagne toujours)');
eq(memories.at(-1), ['labViewerStyle::GEC_Mutant_X', { mode: 'snapshot', name: 'Membrane · POPC' }],
  'la mémoire du poste est écrite SOUS LA CLÉ DE L’EXPÉRIENCE (rappel instantané à la prochaine ouverture)');
await tick();
eq(uploads.length, 1, '…et le style est déposé sur le Drive : UN fichier');
eq(uploads[0].name, 'viewer-style-snapshot.json', '…sous le nom canonique de SON mode');
eq(uploads[0].ctx, drive, '…dans le dossier de l’expérience (le contexte de la page, celui des .pdb)');
eq(uploads[0].mimeType, 'application/json', '…annoncé comme un JSON (lisible par le ⬆ Import ET par un humain)');
const body = JSON.parse(await uploads[0].file.text());
eq(body.app, FILES.VIEWER_STYLE_APP, 'le corps du fichier dit ce qu’il est');
eq(body.mode, 'snapshot', '…son mode');
eq(body.instance, 'cond_7', '…et la condition qui l’a déposé');
eq(body.entry, entry, '…et l’entrée du viewer ENTIÈRE (le style ne perd rien en chemin)');
ok(msgs.some((m) => m.includes('remembered for this experiment') && m.includes('viewer-style-snapshot.json')),
  'le message DIT ce qui a été fait, et sous quel nom');

const offline = makeRemember({ token: () => '' });
uploads.length = 0;
msgs.length = 0;
offline.rememberViewerStyle('theme', 'Protéines', { classes: { protein: {} } });
await tick();
eq(uploads.length, 0, 'sans Drive connecté, AUCUN envoi n’est tenté');
eq(memories.at(-1), ['labViewerStyle::GEC_Mutant_X', { mode: 'theme', name: 'Protéines' }],
  '…mais la mémoire du poste est écrite : le rappel marche déjà ici');
eq(msgs.length, 0, '…et rien n’est promis à l’écran (aucun fichier annoncé)');

const adHoc = makeRemember({ naming: null, instance: null });
uploads.length = 0;
adHoc.rememberViewerStyle('snapshot', 'Solo', entry);
await tick();
eq(uploads.length, 0, 'un viewer monté HORS d’une expérience n’a rien à qui l’attacher : aucun fichier semé');
eq(memories.at(-1), ['labViewerStyle::GEC_Mutant_X', { mode: 'snapshot', name: 'Solo' }],
  '…mais la mémoire du poste est écrite quand même : le style reste retenu localement');

/* ══ 5. LE RAPPEL — recallViewerStyle, EXÉCUTÉ SUR UN FAUX DRIVE ═══════════ */
/* C'est le cœur de la demande : « when an experiment opens, after bringing back to
   live its files … it should remember also the style file … and apply it
   automatically ». */
const buildRecall = () => new Function(
  'styleTouchedRef', 'styleMemoryKeyRef', 'styleMemoryKeysRef', 'loadViewerStyleMemory',
  'viewerStyleEntryOf', 'viewerSnaps', 'viewerThemes', 'applyThemeEntry', 'applySnapshotEntry',
  'flashSetupMsg', 'driveNaming', 'getDriveToken', 'listExperimentFiles', 'pickViewerStyleFile',
  'downloadDriveFileText', 'parseViewerStyleFile', 'adoptViewerStyleEntry', 'saveViewerStyleMemory',
  'VIEWER_STYLE_EXT',
  [sliceFn(VIEW, 'recallViewerStyle'), 'return recallViewerStyle;'].join('\n')
);
const runRecall = ({
  memory = null, files = [], texts = {}, token = () => 'tok', touched = false, snaps = {}, themes = {}
} = {}) => {
  const seen = { listed: [], downloads: [], adopted: [], applied: [], messages: [], saved: [] };
  if (memory) fakeStore.set('labViewerStyle::GEC_Mutant_X', JSON.stringify(memory));
  else fakeStore.delete('labViewerStyle::GEC_Mutant_X');
  const recall = buildRecall()(
    { current: touched },
    { current: 'labViewerStyle::GEC_Mutant_X' },
    { current: ['labViewerStyle::GEC_Mutant_X', 'labViewerStyle'] },
    FILES.loadViewerStyleMemory,
    FILES.viewerStyleEntryOf,
    snaps, themes,
    (e, n) => seen.applied.push(['theme', n, e]),
    (e, n) => seen.applied.push(['snapshot', n, e]),
    (message) => seen.messages.push(message),
    drive,
    token,
    async (arg) => { seen.listed.push(arg); return { files }; },
    FILES.pickViewerStyleFile,
    async (id) => { seen.downloads.push(id); return texts[id] || ''; },
    FILES.parseViewerStyleFile,
    (mode, name, e) => seen.adopted.push([mode, name, e]),
    (k, v) => seen.saved.push([k, v]),
    FILES.VIEWER_STYLE_EXT
  );
  return { seen, recall };
};

/* 5a. LA MÉMOIRE DU POSTE D'ABORD — instantanée, et AUCUNE requête. */
const snapEntry = { v: 1, name: 'Snap A', sections: { 'protein|A': { tree: {} } } };
const a = runRecall({ memory: { mode: 'snapshot', name: 'Snap A' }, snaps: { 'Snap A': snapEntry } });
eq(await a.recall(), { mode: 'snapshot', name: 'Snap A', from: 'browser' },
  'ce que CE poste a retenu est appliqué tel quel');
eq(a.seen.applied, [['snapshot', 'Snap A', snapEntry]], '…avec l’entrée du magasin, pas une copie approximative');
eq(a.seen.listed.length, 0, '…et le Drive n’est MÊME PAS interrogé (le rappel est instantané)');
ok(a.seen.messages.some((m) => m.includes('the style this experiment remembers')), '…et l’écran le dit');

/* 5b. LE FICHIER DU DOSSIER ENSUITE — c'est lui qui sauve un poste vierge. */
const payloadSnap = JSON.stringify(FILES.viewerStyleFilePayload({ mode: 'snapshot', name: 'Snap B', entry: snapEntry }));
const payloadCumu = JSON.stringify(FILES.viewerStyleFilePayload({ mode: 'theme', name: 'Cumu B', entry: { classes: { protein: {} } } }));
const b = runRecall({
  memory: { mode: 'snapshot', name: 'Supprimé depuis' }, snaps: {},
  files: [cumuNew, snap], texts: { S: payloadSnap, C2: payloadCumu }
});
eq(await b.recall(), { mode: 'snapshot', name: 'Snap B', from: 'drive' },
  `la mémoire ne désigne plus rien → LE FICHIER DU DOSSIER est appliqué, et c’est LE SNAPSHOT (vu : ${JSON.stringify(b.seen)})`);
eq(b.seen.downloads, ['S'], '…un seul téléchargement : le snapshot a gagné sans lire le cumulatif');
eq(b.seen.listed[0].ctx, drive, '…le dossier cherché est celui de l’expérience (le contexte de la page)');
eq(b.seen.listed[0].ctxs, [{ ...drive, section: 'Setup' }], '…et la branche Setup de la page est regardée aussi');
eq(b.seen.listed[0].exts, ['json'], '…seuls les .json sont listés');
eq(b.seen.adopted, [['snapshot', 'Snap B', snapEntry]], 'le fichier lu est ADOPTÉ dans son magasin (le ⬆ Import, sans le geste)');
eq(b.seen.saved, [['labViewerStyle::GEC_Mutant_X', { mode: 'snapshot', name: 'Snap B' }]],
  '…et la mémoire du poste est écrite : la PROCHAINE ouverture ne touchera plus le Drive');

/* 5c. « or in its absence the cumulative ». */
const c = runRecall({ files: [cumuNew], texts: { C2: payloadCumu } });
eq(await c.recall(), { mode: 'theme', name: 'Cumu B', from: 'drive' },
  'sans snapshot, LE CUMULATIF s’applique — la seconde moitié de la demande');
eq(c.seen.downloads, ['C2'], '…et c’est bien le cumulatif qui a été téléchargé');

/* 5d. Rien, ou un .json étranger : on ne devine pas. */
eq(await runRecall({ files: [] }).recall(), null, 'un dossier sans fichier de style → aucune application');
eq(await runRecall({ token: () => '' }).recall(), null, 'sans Drive connecté et sans mémoire → rien (aucun échec)');
const foreign = runRecall({ files: [{ id: 'J', name: 'dataset_backup.json', modifiedTime: '2026-03-01T00:00:00Z' }] });
eq(await foreign.recall(), null, 'un autre .json du dossier n’est JAMAIS pris pour un style');
eq(foreign.seen.downloads.length, 0, '…et il n’est même pas téléchargé');

/* 5e. L'UTILISATEUR A DÉJÀ CHOISI : le rappel se tait. */
const e = runRecall({ touched: true, memory: { mode: 'snapshot', name: 'Snap A' }, snaps: { 'Snap A': snapEntry } });
eq(await e.recall(), null, 'un style chargé/enregistré à la main n’est JAMAIS écrasé par le rappel');
eq(e.seen.applied.length, 0, '…rien n’est appliqué');
eq(e.seen.listed.length, 0, '…et le Drive n’est pas interrogé non plus');

/* ══ 6. LE CÂBLAGE DANS LE VIEWER ══════════════════════════════════════════ */

has("import {\n  VIEWER_STYLE_EXT, loadViewerStyleMemory, parseViewerStyleFile, pickViewerStyleFile,",
  'le viewer importe les règles du module (une seule source de vérité)');
has("import { listExperimentFiles } from '../utils/driveExperimentFiles';",
  '…et la LECTURE DU DOSSIER de l’expérience, le geste déjà offert par les boutons « 📂 … from Drive folder »');
has("import { archiveFileToDrive, downloadDriveFileText, getDriveToken, uploadLocalFile } from '../utils/driveUpload';",
  '…et l’écriture / la lecture d’un fichier de Drive');
has('const slugs = [pymolSessionExperimentSlug(driveNaming), pymolSessionInstanceSlug(instanceKey, driveNaming)]',
  'la mémoire est portée par l’EXPÉRIENCE (projet · nom), la condition venant ensuite');
has("const VIEWER_STYLE_RECALL_DELAY_MS = 400;", 'le rappel laisse la scène se poser (les molécules annexes arrivent après)');
has("if (status !== 'ready') return;", '…il attend que les FICHIERS soient là (« after bringing back to live its files »)');
has('if (!Object.keys(sectionCatalog || {}).length) return;', '…et que la scène ait ses sections (un snapshot se rejoue SUR elles)');
has('}, [status, instanceKey, sectionEpoch, sectionCatalog]);', '…et se relance quand une molécule arrive (l’échéance est repoussée)');
eq(countOf(/styleRecallRef\.current = true/g), 1, 'le rappel n’a lieu qu’UNE fois par montage — donc une fois par expérience ouverte');
eq(countOf(/const recallViewerStyle = /g), 1, 'un seul rappel');
eq(countOf(/const rememberViewerStyle = /g), 1, 'un seul geste d’enregistrement');
eq(countOf(/const loadViewerStyleMemory\(/g), 0, 'la mémoire n’est pas réécrite ici : son lecteur vient du module');
eq(countOf(/loadViewerStyleMemory\(/g), 1, '…et la mémoire n’est LUE qu’à un seul endroit du viewer (dans le rappel)');
eq(countOf(/saveViewerStyleMemory\(/g), 2, 'elle est écrite aux deux endroits voulus : le geste, et le rappel qui vient d’adopter un fichier');
eq(countOf(/const viewerStyleFileName = /g), 0, 'les noms de fichiers ne sont pas réécrits dans le viewer (ils vivent dans le module)');
eq(countOf(/'viewer-style-snapshot\.json'|'viewer-style-cumulative\.json'/g), 0,
  '…et aucun nom de fichier n’est codé en dur ici');

// Les gestes qui RETIENNENT le style : les deux 📂 (charger) et les deux 💾 (enregistrer).
has('if (applyThemeEntry(th, name)) rememberViewerStyle(\'theme\', name, th);',
  '📂 charger un thème pour cette expérience le fait RETENIR');
has('if (applySnapshotEntry(sn, name)) rememberViewerStyle(\'snapshot\', name, sn);',
  '📂 charger un snapshot aussi');
has("rememberViewerStyle('snapshot', name, map[name]);", '💾 enregistrer un snapshot le retient (mémoire + fichier du dossier)');
has("rememberViewerStyle('theme', name, map[name]);", '💾 enregistrer un thème cumulatif aussi');
has('rememberViewerStyle(store.tag, name, entry);', '…et ⬆ importer un fichier de style le retient également');
has("if (store.tag === 'theme') applyThemeEntry(entry, name);",
  '⬆ l’entrée importée s’applique DIRECTEMENT (le magasin n’a pas encore ce nom dans cet état)');
has('const archiveViewerStyle = async (mode, name, entry) => {', 'l’écriture du fichier de l’expérience est un geste nommé, donc testable');
has('found = pickViewerStyleFile(listed.files);', 'le rappel applique LA règle de préférence du module (snapshot, sinon cumulatif)');
has('const parsed = parseViewerStyleFile(text);', '…et ne lit que des fichiers de style (le module refuse le reste)');
has('ctxs: [{ ...driveNaming, section: \'Setup\' }],', 'les deux branches de dossier d’une page (Data et Setup) sont regardées');
eq(countOf(/applyThemeEntry\(/g) >= 3 && countOf(/applySnapshotEntry\(/g) >= 3, true,
  'les corps des deux modes servent aux trois chemins : charger, adopter depuis le Drive, appliquer au rappel');
eq(countOf(/const loadTheme = \(name\)/g), 1, 'un seul loadTheme (le rappel ne le double pas)');
eq(countOf(/const loadSnapshot = \(name\)/g), 1, 'un seul loadSnapshot non plus');
has('flashSetupMsg(`✓ snapshot “${name}” applied', 'le message d’application des snapshots est conservé');
has('flashSetupMsg(`✓ theme “${name}” applied', '…et celui des thèmes');

console.log(`_viewer_style_recall_test.mjs — ${passed} assertions OK (le style retenu par une expérience : fichier, mémoire, rappel)`);




