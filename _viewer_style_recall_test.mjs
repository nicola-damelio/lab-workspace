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
/* Le module du FOND, EXÉCUTÉ lui aussi : c'est LUI qui transforme l'entrée qu'un
   viewer rejoue en la `backgroundImage` que le canvas d'NGL reçoit réellement
   (voir applyBackgroundGradient dans le viewer). Un test du style qui s'arrête à
   l'objet rejoué ne prouve pas ce que l'écran peint ; celui-ci va jusqu'au CSS. */
const BG = await import('./src/utils/viewerBackground.js');

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
eq(FILES.VIEWER_STYLE_EXPORT_STEMS.snapshot, 'viewer-snapshot', 'les noms que le viewer donne à ses exports sont écrits noir sur blanc');
eq(FILES.VIEWER_STYLE_EXPORT_STEMS.theme, 'viewer-theme', '…les deux');
eq(FILES.viewerStyleModeOfName('viewer-theme-My_theme.json'), 'theme',
  'un fichier du ⬇ Export du viewer (viewer-theme-…) EST reconnu — c’est le défaut signalé : « the styles file is not read automatically »');
eq(FILES.viewerStyleModeOfName('viewer-snapshot-My scene.json'), 'snapshot', '…et un snapshot exporté aussi');
eq(FILES.isViewerStyleFile('viewer-theme-My_theme.json'), true, 'isViewerStyleFile suit la même règle');
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
  'definedStyleSlug', 'DEFINED_STYLE_BASE',
  'VIEWER_STYLE_EXT',
  [sliceFn(VIEW, 'recallViewerStyle'), 'return recallViewerStyle;'].join('\n')
);
/* ⚠ `slug` EST L'INSTANCE (le repère de sa mémoire), `memories` les mémoires D'AUTRES
   instances déjà déposées dans le même `localStorage` (le magasin est commun à tout
   le poste : c'est le décor du défaut rapporté, voir 5f), et `memoryKeys` la liste que
   le viewer interroge — l'INSTANCE d'abord, l'expérience ensuite, la générale en
   dernier recours (voir styleMemoryKeysRef). */
const runRecall = ({
  memory = null, memories = {}, files = [], texts = {}, token = () => 'tok', touched = false,
  snaps = {}, themes = {}, slug = 'GEC_Mutant_X', memoryKeys = null, touchDuringDownload = false
} = {}) => {
  const seen = { listed: [], downloads: [], adopted: [], applied: [], messages: [], saved: [] };
  const key = FILES.viewerStyleMemoryKey(slug);
  const seeded = { ...memories };
  if (memory) seeded[key] = memory;
  else if (!(key in seeded)) seeded[key] = null;
  Object.keys(seeded).forEach((k) => {
    if (seeded[k]) fakeStore.set(k, JSON.stringify(seeded[k]));
    else fakeStore.delete(k);
  });
  const touchedRef = { current: touched };
  const recall = buildRecall()(
    touchedRef,
    { current: key },
    { current: memoryKeys || [key, 'labViewerStyle'] },
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
    async (id) => {
      seen.downloads.push(id);
      /* ⚠ LE GESTE PENDANT LE TÉLÉCHARGEMENT — c'est le trou du rapport « it has
         worked for some seconds » : l'utilisateur presse ⬚ Gradient pendant que le
         fichier de style descend. Le rappel doit relire le drapeau APRÈS la
         descente et renoncer (voir la ré-lecture dans recallViewerStyle). */
      if (touchDuringDownload) touchedRef.current = true;
      return texts[id] || '';
    },
    FILES.parseViewerStyleFile,
    (mode, name, e) => seen.adopted.push([mode, name, e]),
    (k, v) => seen.saved.push([k, v]),
    slug,
    'Defined style',
    FILES.VIEWER_STYLE_EXT
  );
  return { seen, recall, key };
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

/* ══ 5f. LE STYLE DÉFINI D'UNE INSTANCE NE PART PLUS DANS SA VOISINE ═══════
   Le défaut rapporté : « If I select a certain light orientation in one instance and
   click on define style, then I go to another instance of the same experiment and I
   change the direction of the light and I click define style, when I go back to the
   first instance the direction of the light is like in the second instance ; the
   gradient of the background still does not work. »

   La mémoire était déjà par instance, mais le MAGASIN des snapshots est GLOBAL (UNE
   clé localStorage pour tout le poste, voir VIEWER_SNAPSHOT_KEY) : un nom réservé
   FIXE — « Defined style » — faisait écrire les DEUX conditions dans la MÊME entrée,
   la seconde écrasant la première, et la mémoire de la première (pourtant juste, elle)
   reposait le style de la seconde. La lampe ◐ Shadows (azimut, élévation) et le FOND
   (sa couleur, sa rampe) voyagent dans l'environnement global d'un snapshot : ils
   partaient donc avec. Le nom porte maintenant le slug de l'instance. Ce qui suit
   EXÉCUTE la construction réelle de ce nom (les trois lignes de la source, avec la
   VRAIE règle de slug du viewer) puis le rappel — deux instances, un seul magasin. */
const DEFINED_BLOCK = VIEW.slice(
  VIEW.indexOf("const DEFINED_STYLE_BASE = 'Defined style';"),
  VIEW.indexOf('const defineInstanceStyle = () => {')
);
const buildDefinedName = () => new Function(
  'instanceKey', 'driveNaming',
  [
    sliceFn(VIEW, 'pymolSessionInstanceSlug'),
    DEFINED_BLOCK,
    'return { DEFINED_STYLE_BASE, definedStyleSlug, DEFINED_STYLE_NAME };'
  ].join('\n')
);
const definedNameOf = (instanceKey, naming) => buildDefinedName()(instanceKey, naming);
const namedA = definedNameOf('cond_A', drive);
const namedB = definedNameOf('cond_B', drive);
eq(namedA.DEFINED_STYLE_BASE, 'Defined style', 'le nom réservé de base est écrit noir sur blanc');
eq(namedA.definedStyleSlug, 'cond_A', 'le slug du style défini est CELUI DE SA MÉMOIRE (pymolSessionInstanceSlug, la règle du viewer)');
eq(namedA.DEFINED_STYLE_NAME, 'Defined style · cond_A', '…donc le nom du style défini porte L’INSTANCE');
ok(namedA.DEFINED_STYLE_NAME !== namedB.DEFINED_STYLE_NAME,
  'DEUX INSTANCES NE PARTAGENT PLUS UN NOM : le magasin peut garder les deux styles');
eq(definedNameOf(null, drive).DEFINED_STYLE_NAME, 'Defined style · GEC_Mutant_X_2026-01-05',
  'sans instanceKey, le slug vient du contexte Drive (projet · expérience · condition)');
eq(definedNameOf(null, null).DEFINED_STYLE_NAME, 'Defined style',
  'un viewer monté HORS expérience garde le nom nu : il n’y a qu’un viewer, aucune ambiguïté');

/* Le décor : la mémoire de A ET celle de B sont dans le même poste, et le magasin
   porte LES DEUX entrées — ce que le nom partagé d’avant rendait impossible.
   ⚠ B DÉFINIT SON STYLE AVEC LA RAMPE ÉTEINTE : c’est le cas même du rapport
   (« …the gradient of the background still does not work »). Avant le correctif,
   l’entrée de B — sans rampe — écrasait celle de A dans le magasin commun, et en
   revenant dans A la rampe de A était donc ÉTEINTE : le dégradé « ne marchait
   plus ». Il doit revenir ALLUMÉ, et celui de A ne doit pas se répandre dans B. */
const lampFond = (az, bg, to, on) => ({
  shadows: { on: true, darkness: 0.5, az, el: 12, color: '#ffffff' },
  background: bg, backgroundGradient: { on, to, angle: 90, midOn: false }
});
const definedA = { v: 1, name: namedA.DEFINED_STYLE_NAME, global: lampFond(95, '#0b1f33', '#123456', true), sections: { 'protein|A': { tree: { radius: 1 } } } };
const definedB = { v: 1, name: namedB.DEFINED_STYLE_NAME, global: lampFond(250, '#331f0b', '#654321', false), sections: { 'protein|A': { tree: { radius: 2 } } } };
const sharedStore = { [namedA.DEFINED_STYLE_NAME]: definedA, [namedB.DEFINED_STYLE_NAME]: definedB };

const backInA = runRecall({
  slug: 'cond_A',
  memory: { mode: 'snapshot', name: namedA.DEFINED_STYLE_NAME },
  memories: { 'labViewerStyle::cond_B': { mode: 'snapshot', name: namedB.DEFINED_STYLE_NAME } },
  memoryKeys: ['labViewerStyle::cond_A', 'labViewerStyle'],
  snaps: sharedStore
});
eq(await backInA.recall(), { mode: 'snapshot', name: 'Defined style · cond_A', from: 'browser' },
  'en revenant dans A, c’est LE style de A qui est reposé (« when I go back to the first instance … »)');
eq(backInA.seen.applied.map((c) => c[1]), ['Defined style · cond_A'], '…son entrée, pas celle de B');
eq(backInA.seen.applied[0][2], definedA, '…l’entrée du magasin, telle quelle');
eq(backInA.seen.applied[0][2].global.shadows.az, 95, '…la LAMPE de A (◐ Shadows : son azimut), pas les 250° de B');
eq(backInA.seen.applied[0][2].global.background, '#0b1f33', '…et SON fond');
eq(backInA.seen.applied[0][2].global.backgroundGradient.on, true, '…sa rampe allumée, comme il l’avait définie');
eq(backInA.seen.listed.length, 0, '…sans même interroger le Drive (la mémoire de l’instance suffit)');
/* ⬚ LE DÉGRADÉ, JUSQU’AU CSS QUE LE CANVAS REÇOIT. Le rejeu réel de la source
   passe par `bgGradientOf(global.backgroundGradient)` puis par
   `backgroundCss(backgroundSpecOf(background, gradient))` (applyViewerSetup, puis
   applyBackgroundGradient) : les trois fonctions du MODULE sont exécutées ci-dessous
   sur l’entrée que A vient de rejouer — l’assertion porte donc sur la
   `backgroundImage` posée sur le canvas d’NGL, pas sur un objet intermédiaire. */
const cssOf = (entry) => {
  const g = BG.bgGradientOf(entry.global.backgroundGradient);
  return BG.backgroundCss(BG.backgroundSpecOf(entry.global.background, g));
};
eq(cssOf(backInA.seen.applied[0][2]), 'linear-gradient(90deg, #0b1f33 0%, #123456 100%)',
  '…et le canvas d’A reçoit SA rampe (de son fond vers sa couleur B, à SON angle)');
eq(BG.bgGradientOf(backInA.seen.applied[0][2].global.backgroundGradient),
  { on: true, to: '#123456', angle: 90, mid: BG.BG_GRADIENT_DEFAULT_MID, midOn: false, light: true },
  '…relue par le VALIDATEUR du module, exactement comme le fait applyViewerSetup (et un style d’hier suit donc la LAMPE : le champ absent veut dire « comme le viewer sait le faire »)');

const backInB = runRecall({
  slug: 'cond_B',
  memory: { mode: 'snapshot', name: namedB.DEFINED_STYLE_NAME },
  memories: { 'labViewerStyle::cond_A': { mode: 'snapshot', name: namedA.DEFINED_STYLE_NAME } },
  memoryKeys: ['labViewerStyle::cond_B', 'labViewerStyle'],
  snaps: sharedStore
});
eq(await backInB.recall(), { mode: 'snapshot', name: 'Defined style · cond_B', from: 'browser' },
  '…et B retrouve le sien : deux instances, DEUX styles définis, aucun vol');
eq(backInB.seen.applied[0][2].global.shadows.az, 250, '…avec SA lumière');
eq(backInB.seen.applied[0][2].global.background, '#331f0b', '…et SON fond');
eq(backInB.seen.applied[0][2].global.backgroundGradient.on, false, '…et SA rampe, qu’il avait laissée éteinte');
eq(cssOf(backInB.seen.applied[0][2]), '', '…d’où un canvas sans `backgroundImage` : la couleur d’NGL reste seule');
ok(cssOf(backInA.seen.applied[0][2]) !== cssOf(backInB.seen.applied[0][2]),
  'LES DEUX INSTANCES PEIGNENT DEUX FONDS DIFFÉRENTS : la rampe de l’une n’est pas celle de l’autre');

/* 5g. LA MÉMOIRE DE L'ANCIEN NOM NU EST AMBIGUË — on ne devine pas. Le poste garde
   ce qu'a écrit la version d'avant (une mémoire qui nomme « Defined style »), et le
   magasin l'entrée que la SECONDE condition y a laissée : le viewer ne peut pas
   savoir à qui elle appartenait, donc il l'ignore — la mémoire suivante puis le
   fichier du dossier DE CETTE CONDITION ont la parole. */
eq(FILES.viewerStyleEntryOf({ mode: 'snapshot', name: 'Defined style' }, { snapshots: ['Defined style'] }),
  { mode: 'snapshot', name: 'Defined style' }, 'le module, lui, rend bien l’entrée que la mémoire nomme…');
const legacyMemory = runRecall({
  slug: 'cond_A',
  memory: { mode: 'snapshot', name: 'Defined style' },
  memories: { 'labViewerStyle::cond_B': { mode: 'snapshot', name: 'Defined style' } },
  memoryKeys: ['labViewerStyle::cond_A', 'labViewerStyle'],
  snaps: { 'Defined style': definedB, [namedA.DEFINED_STYLE_NAME]: definedA },
  files: [snap],
  texts: { S: JSON.stringify(FILES.viewerStyleFilePayload({ mode: 'snapshot', name: namedA.DEFINED_STYLE_NAME, entry: definedA })) }
});
eq(await legacyMemory.recall(), { mode: 'snapshot', name: 'Defined style · cond_A', from: 'drive' },
  '…mais pour une INSTANCE le viewer l’ignore (ce nom nu ne dit pas de quelle condition il vient) → le fichier du dossier de CETTE condition');
eq(legacyMemory.seen.applied.map((c) => c[1]), ['Defined style · cond_A'],
  '…et c’est le style de A qui revient, jamais celui de sa voisine');
eq(legacyMemory.seen.downloads, ['S'], '…un seul fichier lu, celui de la condition');
const generalViewer = runRecall({
  slug: '', memory: { mode: 'snapshot', name: 'Defined style' }, snaps: { 'Defined style': definedA }
});
eq(await generalViewer.recall(), { mode: 'snapshot', name: 'Defined style', from: 'browser' },
  'hors expérience (aucun slug), le nom nu reste légitime : il n’y a qu’un viewer');

/* 5h. UN GESTE PENDANT QUE LE STYLE DESCEND — LE RAPPEL RENONCE (le trou du
   « it has worked for some seconds » : le fichier du dossier met un temps réel à
   arriver, et ce qui descendait recouvrait ce que l'utilisateur venait de choisir). */
const midFlight = runRecall({
  memory: { mode: 'snapshot', name: 'Supprimé depuis' }, snaps: {},
  files: [snap], texts: { S: payloadSnap }, touchDuringDownload: true
});
eq(await midFlight.recall(), null,
  '⚠⚠ le style du dossier n’est PAS appliqué si l’utilisateur a tranché pendant qu’il descendait');
eq(midFlight.seen.applied, [], '…rien n’est donc reposé par-dessus son geste (la rampe qu’il vient d’allumer reste)');
eq(midFlight.seen.downloads, ['S'], '…le fichier avait bien été lu : c’est bien APRÈS la lecture que le rappel renonce');
eq(midFlight.seen.adopted, [], '…et il n’est même pas adopté dans le magasin (aucune trace d’un style refusé)');

/* ══ 6bis. UN GESTE SUR LA SCÈNE CLÔT LE RAPPEL — la règle, EXÉCUTÉE ═══════
   LE RAPPORT DE CETTE SESSION : « the gradient does not work and the program is slow
   even if it does not have processes to do ». Le fond MARCHE (mesuré dans le
   navigateur : le canvas reçoit sa rampe et le navigateur la compose —
   _viewer_bg_live_test.cjs) ; ce qui l'ÉTEIGNAIT, c'est ce drapeau. Le rappel automatique
   repose le style retenu par l'instance 400 ms après que la scène est prête, et il
   ne s'arrête que si `styleTouchedRef` est vrai — or ce drapeau n'était posé que par
   💾 / 📌 / ↩ / ⬆. Un ⬚ Gradient pressé JUSTE APRÈS l'ouverture était donc reposé par
   le rappel : la rampe s'allumait puis s'éteignait toute seule (reproduit dans Chrome :
   « linear-gradient(…) » à +250 ms, « none » à +2 s — et l'interrupteur revenu à
   `aria-pressed="false"`).

   ⚠⚠ ET LE SECOND RAPPORT — « the gradient still does not work … now nothing happens,
   only uniform background » — a ajouté la seconde moitié de la règle : un effet se
   rejoue sans qu'aucune VALEUR ait changé (`applyFog` renaît dès que ses propres
   dépendances bougent, et le tableau de dépendances est évalué au rendu). Compter ces
   passages-là comme des gestes clôturait le rappel TOUT SEUL, à l'ouverture : le style
   retenu par l'instance ne revenait plus jamais, et le fond restait donc uni — la
   rampe que l'instance avait enregistrée ne revenait pas. Le registre garde donc la
   VALEUR de chaque réglage, et c'est un changement de valeur qui tranche. */
const GESTURE_SRC = (() => {
  const a = VIEW.indexOf('const sceneSeenRef = useRef(null);');
  assert.ok(a > 0, 'sceneSeenRef introuvable (le registre du montage)');
  const b = VIEW.indexOf('styleTouchedRef.current = true;', a);
  assert.ok(b > a, 'sceneGesture n’écrit pas le drapeau');
  return VIEW.slice(a, VIEW.indexOf('\n};', b) + 3);
})();
const makeGesture = () => {
  const touched = { current: false };
  const gesture = new Function('useRef', 'styleTouchedRef', `${GESTURE_SRC}\nreturn sceneGesture;`)(
    (value) => ({ current: value }), touched
  );
  return { gesture, touched };
};
const mount = makeGesture();
mount.gesture('bgGradient', 'on|#94a3b8|180');
eq(mount.touched.current, false,
  '⚠ le PREMIER passage d’un effet (celui du MONTAGE) n’est pas un geste : le rappel peut encore parler');
mount.gesture('bgGradient', 'on|#94a3b8|180');
eq(mount.touched.current, false,
  '⚠⚠ …et une RÉ-EXÉCUTION du même effet (même VALEUR, objet d’état recréé) n’en est pas un non plus : le rappel ne se clôt pas tout seul — c’est ce qui ramenait le style de l’instance « pour quelques secondes »');
mount.gesture('bgGradient', 'off|#94a3b8|142');
eq(mount.touched.current, true,
  '…et le CHANGEMENT qui suit — le ⬚ Gradient pressé juste après l’ouverture — CLÔT le rappel');
const many = makeGesture();
['bg', 'bgGradient', 'fog', 'clip', 'shadows', 'light', 'shadowAz', 'shadowEl'].forEach((k, i) => many.gesture(k, i));
eq(many.touched.current, false,
  'au montage, React exécute TOUS les effets de la scène : chacun a droit à son premier passage muet');
['bg', 'bgGradient', 'fog', 'clip', 'shadows', 'light', 'shadowAz', 'shadowEl'].forEach((k, i) => many.gesture(k, i));
eq(many.touched.current, false,
  '…et les huit rejoués à l’identique ne tranchent RIEN (huit ré-exécutions, zéro geste)');
many.gesture('fog', 99);
eq(many.touched.current, true, '…et le premier qui change vraiment clôt le rappel, quel qu’il soit');

for (const key of ['bg', 'bgGradient', 'fog', 'clip', 'shadows', 'light', 'shadowAz', 'shadowEl']) {
  has(`sceneGesture('${key}', `, `l’écriture de « ${key} » le dit au rappel AVEC SA VALEUR (une ré-exécution ne compte pas)`);
}
has('const sceneGesture = (key, value) => {', 'la règle est UNE fonction nommée (aucune copie au fil des contrôles)');
has('if (seen.get(key) === value) return;                    // ⚠ une ré-exécution non plus',
  '…et c’est bien la COMPARAISON DE VALEUR qui décide (jamais l’identité de l’objet)');
has('const bgGradientSignature = `${bgGradient.on}|${bgGradient.to}|${bgGradient.angle}|${bgGradient.mid}|${bgGradient.midOn}|${bgGradient.light}`;',
  'la rampe est comparée par ce qu’elle EST — une chaîne, pas l’objet que chaque geste recrée');
eq(countOf(/styleTouchedRef\.current = true;/g), 2,
  'le drapeau n’est écrit qu’à DEUX endroits : le geste d’enregistrement, et le geste de la scène');
ok(VIEW.indexOf("sceneGesture('bgGradient', bgGradientSignature)") < VIEW.indexOf("localStorage.setItem(BG_GRADIENT_KEY"),
  '…et il est bien posé par l’effet du RÉGLAGE lui-même (la rampe), pas ailleurs');
ok(VIEW.indexOf("sceneGesture('shadowAz', shadowAz)") < VIEW.indexOf("localStorage.setItem('labViewerShadowAz'"),
  '…idem pour l’orientation de la lampe, que le rapport d’avant voyait revenir seule');
/* ⚠ LA RÉ-EXÉCUTION N'EST PAS UNE THÉORIE : `applyFog` (entre autres) change
   d'IDENTITÉ dès que son propre tableau de dépendances bouge, donc deux effets
   rejouaient leur geste sans qu'aucune valeur ait changé — le rappel était clos
   tout seul et le style retenu par l'instance ne revenait jamais. Le registre
   garde donc la valeur de chaque réglage (voir le commentaire de sceneGesture). */
has('const seen = sceneSeenRef.current;\n  if (!seen.has(key)) { seen.set(key, value); return; }',
  'le registre du montage ENREGISTRE la valeur du premier passage (il la comparera ensuite)');

/* ══ 6ter. LE CÂBLAGE DANS LE VIEWER ══════════════════════════════════════════════ */

has("import {\n  VIEWER_STYLE_EXT, loadViewerStyleMemory, parseViewerStyleFile, pickViewerStyleFile,",
  'le viewer importe les règles du module (une seule source de vérité)');
has("import { listExperimentFiles } from '../utils/driveExperimentFiles';",
  '…et la LECTURE DU DOSSIER de l’expérience, le geste déjà offert par les boutons « 📂 … from Drive folder »');
has("import { archiveFileToDrive, downloadDriveFileText, getDriveToken, uploadLocalFile } from '../utils/driveUpload';",
  '…et l’écriture / la lecture d’un fichier de Drive');
has('const slugs = [pymolSessionInstanceSlug(instanceKey, driveNaming), pymolSessionExperimentSlug(driveNaming)]',
  '⚠ LA MÉMOIRE DE STYLE EST PORTÉE PAR L’INSTANCE D’ABORD (projet · nom · condition) — chaque condition garde SON style, l’expérience entière venant ensuite (les mémoires d’avant restent lisibles)');
has("const DEFINED_STYLE_BASE = 'Defined style';",
  '…et le style DÉFINI d’une instance a UN nom réservé (📌 Define style / ↩ Revert to defined)');
has('const definedStyleSlug = pymolSessionInstanceSlug(instanceKey, driveNaming);',
  '⚠⚠ …nom qui PORTE LE SLUG DE L’INSTANCE : le magasin des snapshots est GLOBAL (un nom fixe faisait écrire toutes les conditions dans la même entrée — la lampe ◐ Shadows et la rampe du fond d’une instance revenaient dans sa voisine, le défaut rapporté)');
has('const DEFINED_STYLE_NAME = definedStyleSlug ? `${DEFINED_STYLE_BASE} · ${definedStyleSlug}` : DEFINED_STYLE_BASE;',
  '…donc un nom propre à l’instance, le nom nu restant réservé au viewer monté hors expérience');
has('if (definedStyleSlug && target.mode === \'snapshot\' && target.name === DEFINED_STYLE_BASE) continue;',
  '…et une mémoire de l’ANCIEN nom nu est ignorée (elle ne dit pas de quelle condition elle vient) : le fichier du dossier de CETTE condition prend la relève');
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

/* ⚠ LE GESTE MANUEL A ÉTÉ RETIRÉ — la demande de cette session, mot pour mot :
   « Style from folder should not be there. The last file style should be read
   automatically. » Le RAPPEL AUTOMATIQUE ci-dessus est donc le SEUL lecteur du
   style du dossier, et rien n'a été perdu : ce que la picker faisait de plus
   (désigner un fichier) n'existe plus, mais la règle de préférence du module
   reste la sienne (pickViewerStyleFile), et le fichier CANONIQUE qu'elle
   appliquait est réécrit par CHAQUE geste qui retient un style — le dossier porte
   donc toujours « simply the last that was used ». */
ok(!VIEW.includes('label="📂 Style from folder"'),
  'plus de bouton 📂 Style from folder dans la rangée des fichiers du viewer');
ok(!VIEW.includes('const pickStyleFileFromFolder'),
  '…ni de gestionnaire « fichier choisi à la main » : aucun code mort');
ok(!VIEW.includes("import { DriveExperimentFilePicker"),
  '…et le viewer n’importe même plus la picker (une seule définition, celle des pages)');
has('if (!parsed) return null;', 'le rappel refuse toujours un .json qui n’est pas un style (rien n’est deviné)');
has('exts: [VIEWER_STYLE_EXT]', '…et c’est LUI qui liste les .json de l’expérience (la même extension qu’avant)');
has('adoptViewerStyleEntry(parsed.mode, parsed.name, parsed.entry);',
  'un fichier adopté du dossier entre dans le magasin du poste SOUS SON NOM (sinon les lecteurs ne le trouveraient pas)');
has('saveViewerStyleMemory(key, { mode: parsed.mode, name: parsed.name });',
  '…et la mémoire du poste est écrite pour l’ouverture suivante (hors ligne d’abord)');
has('flashSetupMsg(`✓ ${parsed.mode === \'theme\' ? \'cumulative theme\' : \'snapshot\'} “${parsed.name}” applied — brought back from this experiment\'s Drive folder (${found.name})`);',
  '…et le message nomme le fichier lu dans le dossier : le rappel n’est jamais muet');
eq(countOf(/applyThemeEntry\(/g) >= 3 && countOf(/applySnapshotEntry\(/g) >= 3, true,
  'les corps des deux modes servent aux trois chemins : charger, adopter depuis le Drive, appliquer au rappel');
eq(countOf(/const loadTheme = \(name\)/g), 1, 'un seul loadTheme (le rappel ne le double pas)');
eq(countOf(/const loadSnapshot = \(name\)/g), 1, 'un seul loadSnapshot non plus');
has('flashSetupMsg(`✓ snapshot “${name}” applied', 'le message d’application des snapshots est conservé');
has('flashSetupMsg(`✓ theme “${name}” applied', '…et celui des thèmes');

console.log(`_viewer_style_recall_test.mjs — ${passed} assertions OK (le style retenu par une expérience : fichier, mémoire, rappel)`);




