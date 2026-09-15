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

/* ── un localStorage minimal pour exercer les VRAIS helpers ────────────────── */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
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
has(FIG, '♻️ Recover them from a backup</button>', '…et une phrase explique où vivent les images');
has(FIG, 'const res = mergeLibraryFromSnapshot({', 'la fenêtre passe par la même fusion additive');
has(FIG, 'loadRecoveryFile(e.target.files && e.target.files[0])', 'un fichier de sauvegarde local peut être choisi');
has(FIG, 'onClick={loadRecoveryBackups}', 'les sauvegardes Drive peuvent être listées');
has(FIG, 'onClick={() => loadRecoveryBackup(b)}', '…et relues une par une');
has(FIG, 'setLibrary(readLibrary());', 'les panneaux sont rafraîchis après la fusion');
has(FIG, 'if (res.common.added > 0) setLibTab(\'common\');', 'la bibliothèque s’ouvre là où les images sont arrivées');
has(IB, 'Publications → Figures &amp; Slides → ♻️ Recover',
  'l’éditeur d’images dit OÙ récupérer la liste quand elle est vide sur ce poste');

console.log(`✅ ${passed} tests passés (bibliothèque d’images ↔ sauvegarde)`);
