/* =========================================================================
   _library_restore_test.mjs — la BIBLIOTHÈQUE D'IMAGES face à une sauvegarde.

   « J'ai plus d'images au labo qu'au travail » : les IMAGES sont sur le Drive
   (<dataset>/projects/<projet>/images) mais la LISTE qui les affiche — quelles
   images, leurs libellés, leur ordre, la bibliothèque commune et celles des
   projets — vit dans le NAVIGATEUR (localStorage `labFiguresLibrary` /
   `labFiguresLib_<projet>`) et ne voyage que dans les fichiers de sauvegarde.

   Le module RÉEL est importé (src/utils/figuresLibrary.js, localStorage
   bouchonné, driveUpload remplacé par le crochet _esm_test_hook) et les règles
   vérifiées sont celles qui ont coûté des images :
     • l'import REMPLAÇAIT la liste → charger la sauvegarde d'un poste (liste
       vide) effaçait les images des autres postes ;
     • il n'existe AUCUN index de secours dans le Drive pour les retrouver.
   L'import doit donc être ADDITIF : il ajoute, complète, ne supprime jamais.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import LZString from 'lz-string';

/* Les sources de src/ s'importent sans extension (résolues par Vite) et
   driveUpload.js est un module navigateur : le crochet rend le module RÉEL
   importable par node (voir _esm_test_hook.mjs). */
register('./_esm_test_hook.mjs', import.meta.url);

/* ── un localStorage minimal pour exercer les VRAIS helpers ──────────────────
   …avec un QUOTA, comme un vrai navigateur : c'est lui qui refusait les
   écritures des listes de figures quand le magasin du poste était plein (voir
   la dernière section). `Infinity` par défaut : les autres sections ne le
   sentent pas. */
const store = new Map();
let quota = Infinity;
const setQuota = (n) => { quota = n; };
const usedBytes = () => { let t = 0; store.forEach((v) => { t += String(v).length; }); return t; };
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => {
    const next = String(v);
    const without = usedBytes() - String(store.get(k) || '').length;
    if (without + next.length > quota) {
      const err = new Error('quota exceeded');
      err.name = 'QuotaExceededError';
      throw err;
    }
    store.set(k, next);
  },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i] ?? null
};
globalThis.window = { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} };
globalThis.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } };

const LIB = await import('./src/utils/figuresLibrary.js');
const RI = await import('./src/utils/referenceImport.js');
const LIB_SRC = readFileSync('./src/utils/figuresLibrary.js', 'utf8');
const APP = readFileSync('./src/App.jsx', 'utf8');
const SEL = readFileSync('./src/utils/loadSelection.js', 'utf8');
const FIG = readFileSync('./src/components/FiguresSlides.jsx', 'utf8');
const IB = readFileSync('./src/components/ImageBuilder.jsx', 'utf8');
const DRIVE = readFileSync('./src/utils/driveUpload.js', 'utf8');
const NAMING = readFileSync('./src/utils/driveNaming.js', 'utf8');
const PROJ = readFileSync('./src/components/AppModules/projectDetailModule.jsx', 'utf8');
const NAMING_MOD = await import('./src/utils/driveNaming.js');

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const has = (hay, needle, what) => {
  assert.ok(hay.includes(needle), `${what}\n  fragment absent : ${needle}`);
  passed += 1;
};

/* ── fabriques d'entrées de bibliothèque (comme publishLibraryFigure) ─────── */
const COMMON_KEY = 'labFiguresLibrary';
const projectKey = (pid) => `labFiguresLib_${pid}`;
const item = (id, over = {}) => ({
  id, label: `Figure ${id}`,
  url: `data:image/png;base64,thumb-${id}`,
  full: `https://drive.google.com/file/d/${id}/view`,
  drive: true, driveUrl: `https://drive.google.com/file/d/${id}/view`,
  src: null, canvasData: null, addedAt: '2026-01-01T00:00:00.000Z',
  ...over
});

const reset = () => {
  store.clear();
  LIB.writeLibrary([]);
  LIB.writeProjectLibrary('P1', []);
  LIB.writeProjectLibrary('P2', []);
};

/* ── 1. Une sauvegarde SANS bibliothèque n'efface jamais rien ─────────────── */
reset();
LIB.writeLibrary([item('a'), item('b'), item('c')]);
LIB.writeProjectLibrary('P1', [item('p1a'), item('p1b')]);
const empty = LIB.mergeLibraryFromSnapshot({ common: [], projects: { P1: [], P2: [] } });
eq(empty.added, 0, 'une sauvegarde sans image n’ajoute rien');
eq(empty.filled, 0, '…et ne complète rien');
eq(LIB.readLibrary().map((i) => i.id), ['a', 'b', 'c'],
  'les images du poste sont TOUJOURS là (l’import n’efface plus)');
eq(LIB.readProjectLibrary('P1').map((i) => i.id), ['p1a', 'p1b'],
  'la bibliothèque de projet non plus');
eq(LIB.mergeLibraryFromSnapshot(null).added, 0, 'un snapshot null ne fait rien');
eq(JSON.parse(localStorage.getItem(COMMON_KEY)).length, 3,
  'les trois images sont toujours dans le localStorage du poste');

/* ── 2. Le fichier ajoute les images MANQUANTES (à la fin, ordre conservé) ── */
reset();
LIB.writeLibrary([item('a'), item('b')]);
const merged = LIB.mergeLibraryFromSnapshot({
  common: [item('a'), item('b'), item('d'), item('e')],
  projects: {}
});
eq(merged.added, 2, 'deux images absentes sont ajoutées');
eq(merged.filled, 0, 'les images déjà présentes ne sont pas « complétées »');
eq(LIB.readLibrary().map((i) => i.id), ['a', 'b', 'd', 'e'],
  'l’ordre du poste est conservé et les nouvelles arrivent à la fin');
eq(JSON.parse(localStorage.getItem(COMMON_KEY)).map((i) => i.id), ['a', 'b', 'd', 'e'],
  'la liste écrite dans le navigateur contient les images récupérées');

/* ── 3. Une image DÉJÀ présente n'est jamais écrasée, seulement complétée ─── */
reset();
LIB.writeLibrary([{ id: 'a', label: 'Mon libellé', url: 'data:image/png;base64,old', drive: false }]);
const filled = LIB.mergeLibraryFromSnapshot({
  common: [{ id: 'a', label: 'Autre libellé', url: 'data:image/png;base64,new', full: 'drive-full', drive: true, driveUrl: 'drive-link' }]
});
eq(filled.added, 0, 'aucune image ajoutée');
eq(filled.filled, 1, 'l’image existante est complétée');
const kept = LIB.readLibrary()[0];
eq(kept.label, 'Mon libellé', 'le libellé du poste n’est PAS écrasé');
eq(kept.url, 'data:image/png;base64,old', 'la vignette du poste n’est PAS écrasée');
eq(kept.full, 'drive-full', 'le champ VIDE `full` est complété par la sauvegarde');
eq(kept.drive, true, 'la copie cloud retrouvée est notée (drive: false → true)');
eq(kept.driveUrl, 'drive-link', 'le lien Drive vide est complété');

/* ── 4. Les bibliothèques de PROJET suivent les mêmes règles ─────────────── */
reset();
LIB.writeProjectLibrary('P1', [item('p1a')]);
const perProject = LIB.mergeLibraryFromSnapshot({
  common: [],
  projects: { P1: [item('p1a'), item('p1c')], P2: [item('p2a')], P3: [] }
});
eq(perProject.projectCount, 2, 'deux projets du fichier ont réellement des images');
eq(perProject.perProject.P1, { added: 1, filled: 0 }, 'le projet existant reçoit son image manquante');
eq(perProject.perProject.P2, { added: 1, filled: 0 }, 'un projet connu seulement du fichier est restauré sous son id');
eq(perProject.added, 2, 'total des images ajoutées, tous scopes confondus');
eq(LIB.readProjectLibrary('P1').map((i) => i.id), ['p1a', 'p1c'], 'la bibliothèque du projet est complétée');
eq(LIB.readProjectLibrary('P2').map((i) => i.id), ['p2a'], 'l’autre projet est restauré de son côté');
eq(JSON.parse(localStorage.getItem(projectKey('P1'))).length, 2, 'le projet est écrit dans le navigateur');
eq(LIB.readLibrary().length, 0, 'la bibliothèque commune n’est pas touchée par une fusion « projets »');
eq(JSON.parse(localStorage.getItem(COMMON_KEY)).length, 0, '…et le localStorage commun non plus');

/* ── 5. Réimporter DEUX FOIS la même sauvegarde ne duplique rien ─────────── */
reset();
const snapshot = { common: [item('a'), item('b')], projects: {} };
const first = LIB.mergeLibraryFromSnapshot(snapshot);
const second = LIB.mergeLibraryFromSnapshot(snapshot);
eq(first.added, 2, 'le premier import ajoute les deux images');
eq(second.added, 0, 'le second n’ajoute plus rien (mêmes ids)');
eq(second.filled, 0, '…et ne « complète » rien non plus');
eq(LIB.readLibrary().length, 2, 'la bibliothèque contient exactement deux images');

/* ── 6. Le fichier de sauvegarde réel (LZString) est lu ──────────────────── */
const backupState = {
  tests: [],
  _figuresLibrary: [item('home1'), item('home2')],
  _figuresLibraryProjects: { P1: [item('homep1')], P2: [] },
  _publications: [{ id: 'pub1', title: 'A paper' }],
  projects: [{ id: 'P1', name: 'AMPs', bibliography: [{ id: 'b1', title: 'Ref' }] }]
};
const backupHtml = '<!DOCTYPE html><html><body><h2>weekly backup</h2>'
  + '<script type="application/json" id="saved-data-blob">'
  + JSON.stringify({
    payload: LZString.compressToUTF16(JSON.stringify(backupState)),
    isCompressed: true, title: 'Lab dataset', savedAt: 1700000000000
  }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  + '</script></body></html>';
const decompress = (s) => LZString.decompressFromUTF16(s);

const figures = RI.figuresFromBackupHtml(backupHtml, decompress);
ok(!!figures, 'un fichier de sauvegarde est reconnu');
eq(figures.common.map((i) => i.id), ['home1', 'home2'], 'les images communes du fichier sont lues');
eq(Object.keys(figures.projects), ['P1'], 'seuls les projets qui ont des images sont retournés');
eq(figures.title, 'Lab dataset', 'le titre du dataset sauvegardé est disponible');
eq(RI.backupFigureCount(figures), { common: 2, projectCount: 1, projectItems: 1, total: 3 },
  'le compte-rendu de la fenêtre ♻️ Recover');
eq(RI.figuresFromBackupState({}), { common: [], projects: {} }, 'un état sans bibliothèque rend des listes vides');
eq(RI.figuresFromBackupState({ _figuresLibrary: 'nope', _figuresLibraryProjects: [] }), { common: [], projects: {} },
  'des valeurs mal formées ne cassent pas la lecture');
ok(RI.figuresFromBackupHtml('<html>not a backup</html>', decompress) === null,
  'un fichier qui n’est pas une sauvegarde est refusé');
eq(RI.papersFromBackupHtml(backupHtml, decompress).publications.length, 1,
  'la lecture des papiers continue de fonctionner (même lecture du fichier)');

/* ── 7. Le scénario « autre poste » : la liste vide se remplit, en un clic ─ */
reset();
const recov = LIB.mergeLibraryFromSnapshot({ common: figures.common, projects: figures.projects });
eq(recov.added, 3, 'les trois images du fichier reviennent sur le poste (liste vide au départ)');
eq(recov.common, { added: 2, filled: 0 }, 'deux dans la bibliothèque commune');
eq(recov.filled, 0, 'rien à compléter : le poste n’avait aucune image');
eq(LIB.readLibrary().map((i) => i.id), ['home1', 'home2'], 'la bibliothèque commune est remplie');
eq(LIB.readProjectLibrary('P1').map((i) => i.id), ['homep1'], 'la bibliothèque du projet aussi');

/* ── 8. Les sources : l'import est branché partout où il faut ─────────────── */
has(LIB_SRC, 'export const mergeLibraryList = (current, incoming) => {',
  'figuresLibrary expose la fusion d’une liste (testable)');
has(LIB_SRC, 'export const mergeLibraryFromSnapshot = (snap) => {',
  'figuresLibrary expose la fusion d’un snapshot');
has(LIB_SRC, 'export const restoreLibraryFromSnapshot = (snap) => mergeLibraryFromSnapshot(snap);',
  'l’ancien nom d’import est devenu un simple alias ADDITIF');
has(LIB_SRC, 'if (isEmptyField(prev[f]) && !isEmptyField(item[f])) { prev[f] = item[f]; touched = true; }',
  'une entrée existante n’est complétée que sur ses champs VIDES');
ok(!/writeLibrary\(snap\.common\)/.test(LIB_SRC),
  'l’ancien REMPLACEMENT de la liste a disparu (c’est lui qui perdait des images)');
has(LIB_SRC, 'const isEmptyField = (v) => v === undefined || v === null || v === \'\' || v === false;',
  'un champ « vide » (y compris `drive: false`) peut être complété');

has(APP, 'const lib = mergeLibraryFromSnapshot({ common: s._figuresLibrary, projects: s._figuresLibraryProjects });',
  'App.jsx fusionne la bibliothèque embarquée dans le fichier chargé');
has(APP, 'if (Array.isArray(s._figuresLibrary) || (s._figuresLibraryProjects && typeof s._figuresLibraryProjects === \'object\')) {',
  '…dès qu’un fichier en contient une');
has(APP, '_figuresLibrary: readLibrary(),', 'la sauvegarde embarque la bibliothèque commune');
has(APP, '_figuresLibraryProjects: readAllProjectLibraries(),', '…et celles des projets');
has(APP, "window.dispatchEvent(new CustomEvent('lab:figures-library-restored'));",
  'les panneaux de la bibliothèque sont rafraîchis après la fusion');
ok(!/restoreLibraryFromSnapshot\(/.test(APP),
  'App.jsx n’appelle plus l’ancien import (remplacement)');

has(SEL, "{ page: 'Figures & Slides', keys: ['_figuresLibrary'], label: 'Bibliothèque d’images (partagée)', unit: 'image' },",
  '« Load HTML » propose la bibliothèque commune à l’import');
has(SEL, "{ page: 'Figures & Slides', keys: ['_figuresLibraryProjects'], label: 'Bibliothèque d’images (par projet)', unit: 'projet' },",
  '…et les bibliothèques de projet');

has(DRIVE, 'export const listDatasetBackups = async () => {', 'les sauvegardes Drive du dataset peuvent être listées');
has(DRIVE, 'export const downloadDriveFileText = async (fileId) => {', '…et relues (fenêtre ♻️ Recover)');

has(FIG, 'const [recovOpen, setRecovOpen] = useState(false);', 'la page Figures & Slides a sa fenêtre de récupération');
has(FIG, '>♻️ Recover</button>', 'un bouton ♻️ Recover est offert dans l’en-tête de la bibliothèque');
has(FIG, '♻️ Recover from a backup</button>', '…et une phrase explique où vivent les images (et par où les récupérer)');
has(FIG, 'const res = mergeLibraryFromSnapshot({', 'la fenêtre passe par la même fusion additive');
has(FIG, 'loadRecoveryFile(e.target.files && e.target.files[0])', 'un fichier de sauvegarde local peut être choisi');
has(FIG, 'onClick={loadRecoveryBackups}', 'les sauvegardes Drive peuvent être listées');
has(FIG, 'onClick={() => loadRecoveryBackup(b)}', '…et relues une par une');
has(FIG, 'setLibrary(readLibrary());', 'les panneaux sont rafraîchis après la fusion');
has(FIG, 'if (res.common.added > 0) setLibTab(\'common\');', 'la bibliothèque s’ouvre là où les images sont arrivées');
has(IB, 'Use <b>⬇ Add missing from Drive</b> above to fetch',
  'l’éditeur d’images dit d’où récupérer la liste quand elle est vide — ICI, plus sur un écran inatteignable');

/* ── 9. LA BIBLIOTHÈQUE ⇄ LE DRIVE ──────────────────────────────────────────
   « Aucune image de la bibliothèque n'est sur le Drive » : soit les images
   n'ont jamais été envoyées (capturées hors connexion → base64 local, perdues
   au changement d'ordinateur), soit elles y sont mais la LISTE a été perdue.
   Les deux gestes qui répondent sont testés ici avec un faux Drive
   (globalThis.__driveTestMocks, voir _esm_test_hook.mjs). */

// 9a. Le contenu d'un dossier Drive → entrées de bibliothèque (fonction PURE).
const listing = [
  { id: 'F1', name: 'CD_spectrum_2026-04.png', mimeType: 'image/png' },
  { id: 'F2', name: 'images', mimeType: 'application/vnd.google-apps.folder' },
  { id: 'F3', name: 'notes.pdf', mimeType: 'application/pdf' },
  { id: 'F4', name: 'Figure_2.svg', mimeType: 'image/svg+xml', webViewLink: 'https://drive.google.com/file/d/F4/view' }
];
const mapped = LIB.libraryItemsFromDriveListing(listing, { addedAt: '2026-01-01T00:00:00.000Z' });
eq(mapped.length, 2, 'seules les IMAGES d’un dossier Drive deviennent des entrées');
eq(mapped.map((i) => i.id), ['lib_drive_F1', 'lib_drive_F4'], 'elles portent un id DÉTERMINISTE (donc pas de doublon)');
eq(mapped[0].label, 'CD spectrum 2026-04', 'le libellé vient du nom du fichier');
eq(mapped[0].drive, true, 'l’entrée sait que ses pixels sont sur le Drive');
eq(mapped[0].full, 'https://drive.google.com/file/d/F1/view', '…et où les relire');
eq(mapped[1].full, 'https://drive.google.com/file/d/F4/view', 'le lien Drive fourni est conservé');
eq(LIB.driveIdOfLibraryItem(mapped[0]), 'F1', 'l’id Drive d’une entrée est retrouvable');
eq(LIB.driveIdOfLibraryItem({ url: 'https://lh3.googleusercontent.com/d/XYZ' }), 'XYZ', '…même depuis une vignette lh3');
eq(LIB.driveIdOfLibraryItem({ url: 'data:image/png;base64,aaa' }), '', 'une entrée purement locale n’a pas d’id Drive');
eq(LIB.driveLibraryItemId('a b/c'), 'lib_drive_abc', 'un id de fichier est nettoyé avant de servir d’id d’entrée');

// 9b. Ce qui n'est PAS encore sur le cloud (ce qui se perd au changement de poste).
eq(LIB.localOnlyLibraryItems([
  { id: 'loc1', full: 'data:image/png;base64,aaa', drive: false },
  { id: 'ok1', full: 'https://drive.google.com/file/d/A/view', drive: true },
  { id: 'loc2', full: 'data:image/jpeg;base64,bbb' }
]).map((i) => i.id), ['loc1', 'loc2'], 'les images dont les pixels ne sont que dans le navigateur sont repérées');

// 9c. ☁ Les envoyer — avec un faux Drive.
LIB.writeLibrary([]);
LIB.writeProjectLibrary('P1', []);
LIB.addProjectLibraryItem('P1', { id: 'loc1', label: 'Local only', url: 'data:image/png;base64,thumb', full: 'data:image/png;base64,big', drive: false, driveUrl: null });
eq(LIB.localOnlyLibraryCount({ scope: 'project', projectId: 'P1' }), 1, '…et comptées par portée');

const listingMock = { cloud: true, dataUrlToBlob: () => ({}),
  uploadLocalFile: async ({ name }) => ({ id: `UP_${name}`, name, driveUrl: `https://drive.google.com/file/d/UP_${name}/view` }),
  resolveDrivePathFromNames: (names) => ({ leafId: `leaf_${(names || []).join('_')}`, path: (names || []).map((n, i) => ({ name: n, id: `leaf_${i}` })) }),
  listDriveChildren: () => listing };
globalThis.__driveTestMocks = listingMock;
const pushed = await LIB.pushLibraryToDrive({ scope: 'project', projectId: 'P1', projectName: 'CD project' });
eq(pushed.total, 1, 'l’envoi ne prend que les images absentes du cloud');
eq(pushed.uploaded, 1, '…et les y envoie');
eq(pushed.failed, 0, 'aucun échec');
eq(pushed.folder, 'projects/CD_project/images', 'le dossier visé est celui du projet, DANS le dossier du dataset');
eq(LIB.readProjectLibrary('P1')[0].drive, true, 'l’entrée sait maintenant que sa copie est sur le Drive');
has(String(LIB.readProjectLibrary('P1')[0].full), '/file/d/UP_', '…et pointe sur le fichier envoyé');
eq(LIB.localOnlyLibraryCount({ scope: 'project', projectId: 'P1' }), 0, 'plus aucune image locale seulement');

// 9d. ⬇ Relire le dossier pour retrouver les images dont la LISTE est perdue.
const pulled = await LIB.pullLibraryFromDrive({ scope: 'common', projectId: null, projectName: '' });
eq(pulled.found, 2, 'les images du dossier sont vues');
eq(pulled.added, 2, '…et ajoutées à la bibliothèque commune (vide ici)');
eq(LIB.readLibrary().map((i) => i.id), ['lib_drive_F1', 'lib_drive_F4'], 'ajoutées sans rien d’autre modifier');
const pulled2 = await LIB.pullLibraryFromDrive({ scope: 'common', projectId: null, projectName: '' });
eq(pulled2.added, 0, 'relire le dossier deux fois n’ajoute aucun doublon');
eq(LIB.readLibrary().length, 2, '…et ne supprime rien');

// Un fichier déjà référencé par une entrée (id local) n'est pas dupliqué.
LIB.writeLibrary([{ id: 'mine', label: 'mienne', url: 'data:image/png;base64,t', full: 'https://drive.google.com/file/d/F1/view', drive: true, driveUrl: 'https://drive.google.com/file/d/F1/view' }]);
const pulled3 = await LIB.pullLibraryFromDrive({ scope: 'common', projectId: null, projectName: '' });
eq(pulled3.added, 1, 'un fichier déjà présent sous un AUTRE id n’est pas dupliqué');
eq(LIB.readLibrary().map((i) => i.id), ['mine', 'lib_drive_F4'], 'l’entrée existante est conservée telle quelle');

// Hors connexion : compte rendu explicite, bibliothèque intacte.
globalThis.__driveTestMocks = { cloud: false };
const before = LIB.readLibrary().length;
const off = await LIB.pullLibraryFromDrive({ scope: 'common' });
ok(!!off.error, 'hors connexion, l’action DIT pourquoi au lieu de ne rien faire');
eq(LIB.readLibrary().length, before, '…et la bibliothèque reste intacte');
eq((await LIB.pushLibraryToDrive({ scope: 'common' })).total, 0, '…de même pour l’envoi');

/* ── 10. Le dossier du dataset fait toujours partie du chemin ─────────────── */
eq(NAMING_MOD.projectSectionFolderPath('CD project', '🔬 Scientific background'),
  ['CD_project', 'Scientific_background'],
  'un document de section va dans <projet>/<section> (la même route que l’envoi)');
eq(NAMING_MOD.projectSectionFolderLabel('CD project', 'Discussion', 'My dataset (2026)'),
  'My_dataset_2026 / CD_project / Discussion',
  'l’étiquette affichée commence par le dossier RÉEL du dataset');
/* Le titre affiché d'une section peut changer (« Discussion » → « Results and
   Discussion ») : le dossier Drive, lui, garde son nom historique — sinon les
   documents déjà envoyés sembleraient avoir disparu (dossier orphelin) et un
   second dossier apparaîtrait. */
eq(NAMING_MOD.projectSectionFolderPath('CD project', 'Results and Discussion'),
  ['CD_project', 'Discussion'],
  'la section renommée « Results and Discussion » range ses documents dans le dossier historique « Discussion »');
eq(NAMING_MOD.projectSectionFolderLabel('CD project', 'Results and Discussion', 'My dataset (2026)'),
  'My_dataset_2026 / CD_project / Discussion',
  '…et l’emplacement affiché est celui du dossier réel (aucun dossier fantôme)');
eq(NAMING_MOD.driveFolderPath({ project: 'CD project', test: 'Exp 1', section: 'Results and Discussion' }),
  ['CD_project', 'Exp_1', 'Results_and_Discussion'],
  'un dossier de TEST n’est pas touché par cet alias (les sections de page gardent leur nom)');
eq(NAMING_MOD.projectImagesFolderLabel('CD project', 'My dataset'),
  'My_dataset / projects / CD_project / images',
  '…et celle de la bibliothèque d’images aussi');
eq(NAMING_MOD.projectImagesFolderPath(''), ['projects', '_unassigned', 'images'],
  'une figure sans projet va dans projects/_unassigned/images');
has(NAMING, 'export const projectSectionFolderPath = (projectName, section) =>',
  'driveNaming expose la route d’un document de section');
has(NAMING, 'export const projectImagesFolderLabel = (projectName, datasetName = \'\') => {',
  '…et l’étiquette d’un dossier d’images');
has(DRIVE, 'const datasetFolderName = () => {', 'le nom du dossier du dataset est centralisé');
has(DRIVE, 'return driveRootId ? `dataset_${sanitizeSlug(driveRootId)}` : \'\';',
  'sans titre connu, un dataset ouvert est ancré sur son id — jamais la racine « Lab Workspace »');
has(FIG, 'const res = await pushLibraryToDrive({', 'Figures & Slides peut envoyer la bibliothèque au cloud');
has(FIG, 'const res = await pullLibraryFromDrive({', '…et la relire depuis le cloud');
has(FIG, '⬇ Add missing</button>', 'un bouton ⬇ Add missing est offert');
has(FIG, '☁ Save to Drive', '…et un bouton ☁ Save to Drive');
has(FIG, 'projectImagesFolderLabel(libProjectName(), getDriveRootName())',
  'l’emplacement Drive affiché inclut le dossier du dataset');

/* ── 11. Les gestes ☁ ⇄ ♻️ là où on les CHERCHE ─────────────────────────────
   Le panneau « Image library » de Figures & Slides n'est monté par AUCUN écran
   (`FiguresSlidesSection` n'est importé nulle part) : ses boutons ☁ / ⬇ / ♻️
   ne pouvaient donc être vus par personne — « I don't even see an add missing
   button ». Les MÊMES gestes doivent être dans la fenêtre de bibliothèque de
   l'Image Builder (celle qu'on a sous les yeux) ET sur la page projet. */
has(IB, "import { backupFigureCount, figuresFromBackupHtml } from '../utils/referenceImport';",
  'l’Image Builder sait relire la bibliothèque d’une sauvegarde');
has(IB, 'const res = await pushLibraryToDrive(libScopeInfo());',
  'la fenêtre de bibliothèque envoie la portée affichée au Drive');
has(IB, 'const res = await pullLibraryFromDrive(libScopeInfo());',
  '…et relit le dossier Drive de cette portée');
has(IB, '⬇ Add missing from Drive', '⬇ Add missing from Drive est dans la fenêtre de bibliothèque');
has(IB, '☁ Save to Drive', '…avec ☁ Save to Drive');
has(IB, '♻️ Recover', '…et ♻️ Recover');
has(IB, 'mergeLibraryFromSnapshot({ common: figures.common, projects: figures.projects })',
  'la récupération est ADDITIVE (fusion, jamais remplacement)');
has(IB, 'const [libDriveBusy, setLibDriveBusy] = useState(false);',
  'les deux gestes Drive ont leur état « en cours » (le bouton dit ⏳ Working…)');
ok(!IB.includes('Publications → Figures &amp; Slides'),
  'plus aucun renvoi vers un écran que personne ne peut ouvrir');

has(PROJ, 'const res = await pullLibraryFromDrive(figDriveScope());',
  'la page projet relit aussi le dossier d’images du projet');
has(PROJ, '⬇ Add missing figures from Drive', '…avec le bouton ⬇ Add missing figures from Drive');
has(PROJ, 'projectImagesFolderLabel(project.name || \'\', getDriveRootName())',
  '…et affiche le dossier Drive réel (dataset inclus)');
has(PROJ, 'const res = await pushLibraryToDrive(figDriveScope());',
  '…et ☁ Save figures to Drive pour les pixels encore locaux');
has(PROJ, 'setOpenSections] = useState({ article: true, background: true, canvases: true,',
  'la section « 🖼 Saved canvases » (qui porte ces boutons) est OUVERTE par défaut');
has(LIB_SRC, 'export const libraryItemsFromDriveListing = (listing, { addedAt = \'\' } = {}) => {',
  'figuresLibrary sait relire un dossier de Drive');
has(LIB_SRC, 'export const driveLibraryItemId = (fileId) => `lib_drive_${String(fileId || \'\').replace(/[^\\w-]/g, \'\')}`;',
  'l’id d’une entrée venue du Drive est déterministe');
has(PROJ, 'const sectionDrivePath = (label) => projectSectionFolderPath(project.name || \'\', label);',
  'la page projet calcule le dossier Drive d’une section avec la MÊME route que l’envoi');
has(PROJ, '📁 Drive location:', '…et l’affiche sous les documents de la section');
has(PROJ, 'verifySectionUpload(label, name);', '…après avoir VÉRIFIÉ que le fichier y est vraiment');
has(PROJ, 'const children = leafId ? await listDriveChildren(leafId) : [];',
  'la vérification relit le dossier Drive (pas seulement « envoyé »)');

/* ══ 7. LE MAGASIN PLEIN NE FAIT PLUS DISPARAÎTRE UNE LISTE ═══════════════════
   « Je sauve, je quitte, mon travail n'y est plus — et pour le retrouver je dois
   aller le chercher depuis le Drive. » Les LISTES de figures vivent dans le
   navigateur (`labFiguresLibrary` / `labFiguresLib_<projet>`) et elles pèsent
   vite des mégaoctets parce qu'une entrée garde ses pixels encodés. Quand le
   magasin du poste (~5 Mo par site, partagé avec le payload des datasets) est
   plein, `setItem` lève — et ce `catch { }` laissait la liste EN MÉMOIRE
   seulement : complète jusqu'au rechargement, puis vide.

   Ce n'est plus un échec muet : la haute résolution des entrées dont le FICHIER
   EST SUR LE CLOUD est d'abord rendue à son lien Drive (le chemin prévu :
   resolveImageToDataUrl les relit avec le jeton OAuth), la liste s'écrit, et
   AUCUNE entrée n'est perdue. Une entrée dont les pixels ne vivent que dans ce
   navigateur n'est jamais touchée. */
const CLOUD_FULL = `data:image/png;base64,${'F'.repeat(40000)}`;
const LOCAL_FULL = `data:image/png;base64,${'L'.repeat(20000)}`;
const CLOUD_ENTRY = {
  id: 'lib_cloud', label: 'Cloud figure', url: 'data:image/png;base64,thumb',
  full: CLOUD_FULL, drive: true, driveUrl: 'https://drive.google.com/file/d/CLOUD1/view',
  canvasData: { objects: [{ id: 'o1' }] }, addedAt: '2026-01-01T00:00:00.000Z'
};
const LOCAL_ENTRY = {
  id: 'lib_local', label: 'Local figure', url: 'data:image/png;base64,thumb2',
  full: LOCAL_FULL, drive: false, driveUrl: null, canvasData: null, addedAt: '2026-01-01T00:00:00.000Z'
};

has(LIB_SRC, 'export const shrinkLibraryEntryPixels = (items, { dropThumbs = false } = {}) => {',
  'figuresLibrary sait alléger une liste sans perdre une seule entrée');
ok(!LIB_SRC.includes('catch { /* quota full — memory keeps the copy */ }'),
  'l’échec muet de l’écriture des listes a disparu');
has(LIB_SRC, 'const slim = shrinkLibraryEntryPixels(items);',
  '…une écriture refusée rend d’abord la haute résolution des entrées du cloud');
has(LIB_SRC, 'const thinner = shrinkLibraryEntryPixels(slim.items, { dropThumbs: true });',
  '…et, en second recours, leur vignette aussi');

const shrunk = LIB.shrinkLibraryEntryPixels([CLOUD_ENTRY, LOCAL_ENTRY]);
eq(shrunk.items.length, 2, 'alléger une liste ne retire AUCUNE entrée');
eq(shrunk.items[0].full, CLOUD_ENTRY.driveUrl, 'la haute résolution d’une entrée du cloud devient son LIEN Drive');
eq(shrunk.items[0].canvasData, CLOUD_ENTRY.canvasData, '…sa composition éditable n’est pas touchée');
eq(shrunk.items[0].url, CLOUD_ENTRY.url, '…ni sa vignette au premier passage');
eq(shrunk.freed, CLOUD_FULL.length, '…et la place rendue est chiffrée (en caractères, l’unité du quota)');
ok(shrunk.items[1] === LOCAL_ENTRY, 'une entrée dont les pixels ne vivent QUE ici est rendue TELLE QUELLE');
eq(LIB.shrinkLibraryEntryPixels([CLOUD_ENTRY], { dropThumbs: true }).items[0].url, CLOUD_ENTRY.driveUrl,
  'en second recours, la vignette se lit du cloud elle aussi');

/* …et la VRAIE écriture, sur un magasin plein : la liste arrive quand même. */
const roomKey = projectKey('prj_room');
LIB.writeProjectLibrary('prj_room', [CLOUD_ENTRY, LOCAL_ENTRY]);
ok(!!store.get(roomKey), 'la liste s’écrit normalement tant qu’il y a de la place');
const bytesBefore = String(store.get(roomKey)).length;
setQuota(usedBytes());   // plein au caractère près : plus une seule écriture ne passe
LIB.writeProjectLibrary('prj_room', [CLOUD_ENTRY, LOCAL_ENTRY, { ...CLOUD_ENTRY, id: 'lib_cloud2' }]);
const stored = JSON.parse(String(store.get(roomKey) || '[]'));
eq(stored.length, 3, 'un magasin PLEIN n’empêche plus la liste de s’écrire');
eq(stored[0].full, CLOUD_ENTRY.driveUrl, '…la copie locale devenue inutile est remplacée par son lien Drive');
eq(stored[0].canvasData, CLOUD_ENTRY.canvasData, '…la composition éditable est intacte');
eq(stored[1].full, LOCAL_FULL, 'et une entrée sans copie cloud garde ses pixels (la toucher serait la perdre)');
ok(stored.every((i) => !!i.label), 'aucune entrée n’est perdue : elles gardent toutes leur libellé');
setQuota(Infinity);

/* ══ 8. UNE FIGURE INSÉRÉE PORTE TOUJOURS SA COPIE CLOUD ═════════════════════
   « Je construis une image, je la sauve dans le projet, je quitte : mes images
   ne sont plus là. » La composition était écrite dans le document du projet
   SOUS FORME D'IMAGE ENCODÉE et SEULEMENT là. Le magasin plein, l'écriture
   d'urgence remplaçait les pixels par leur lien Drive… un lien que la figure
   n'avait jamais eu : `url` vide, donc un cadre sans image sur la page projet.

   L'insertion envoie donc les pixels au Drive AVANT d'écrire la figure, garde
   ce lien sur l'entrée, et VÉRIFIE son écriture. */
has(IB, "cloud = await uploadFigureToDrive({ full: dataUrl, label, projectName: prj.name || '' });",
  'l’Image Builder dépose la composition au Drive avant d’insérer la figure');
has(IB, '...(cloudUrl ? { drive: true, driveUrl: cloudUrl, full: cloudUrl } : {}),',
  '…et la figure insérée garde ce lien (la page peut donc toujours la remontrer)');
has(IB, 'const saved = saveProjectsRescued(projects, { projectId: prj.id, fields: {} });',
  'l’insertion VÉRIFIE son écriture (et fait de la place si le magasin refuse)');
ok(!IB.includes('saveProjects(projects);'),
  'plus d’écriture d’insertion dont le refus est ignoré');
has(IB, 'if (!saved.ok) {', '…et le dialogue dit la VÉRITÉ quand rien n’a pu être écrit');
has(IB, '} else if (saved.droppedImages) {', '…comme quand seul le lien Drive a pu être gardé');
has(IB, '} else if (!cloudUrl) {', '…et quand aucune copie cloud n’a pu être faite');
has(IB, 'No cloud copy could be made (Google Drive / Nextcloud not connected)',
  '…en le disant clairement plutôt qu’en annonçant un succès');

/* ══ 9. LA PAGE PROJET RÉAFFICHE L'IMAGE TOUTE SEULE ═════════════════════════ */
has(PROJ, "export const figureDriveLink = (fig, projectId = '') => {",
  'la page projet sait retrouver le lien Drive d’une figure');
has(PROJ, 'const entry = readProjectLibrary(from).find((i) => i && i.id === fig.canvasId);',
  '…y compris par l’entrée de bibliothèque du canvas dont elle vient');
has(PROJ, 'const link = figureDriveLink(fig, project.id);', '…et s’en sert pour les figures sans pixels');
has(PROJ, 'url: getRenderableDriveUrl(link), full: link, driveUrl: link, pixelsMissing: false',
  '…en posant une URL AFFICHABLE (un lien « view » ne se dessine pas dans un <img>)');
has(PROJ, 'if (hasPixels || restoredFigRef.current.has(fig.id)) return;',
  '…une seule fois par figure (jamais une écriture en boucle)');
has(PROJ, '“⬇ Add missing figures from Drive” above if the picture stays empty',
  '…et l’avis renvoie au bouton qui relit le dossier du Drive');

console.log(`✅ ${passed} tests passés (bibliothèque d’images ↔ sauvegarde)`);
