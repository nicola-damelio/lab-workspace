/* =========================================================================
   _builder_recall_test.mjs — « JE ROUVRE LE CANVAS ENREGISTRÉ DANS LE PROJET :
   IL EST ENCORE VIDE ».

   Ce qui a été signalé : le canvas inséré dans un projet se rouvre VIDE depuis
   la page du projet (« ✏️ Modify in Image Builder »), et il ne réapparaît que
   si l'on va dans la bibliothèque cliquer « ⬇ Add missing from Drive ».

   LA CAUSE, dans ImageBuilder.jsx (l'effet qui honore `openCanvasId`) :

     const list = projectId ? readProjectLibrary(projectId) : readLibrary();
     const item = list.find((i) => i.id === openCanvasId && i.canvasData);
     if (item) restoreCanvasFromItem(item, …);     // ← sinon : RIEN, et rien dit

   La réouverture ne lisait QUE la liste de ce navigateur (localStorage, ~5 Mo
   par site) ET exigeait l'entrée AVEC sa composition. Quand cette liste a dû
   être allégée (ou sur un autre ordinateur), l'entrée n'y est plus : la
   condition est sautée, la demande est consommée, et l'éditeur s'ouvre sur un
   canvas vide SANS UN MOT. Les pixels et le sidecar `<image>.meta.json` sont
   pourtant sur le Drive depuis l'insertion — le seul code qui les relit était
   le bouton « ⬇ Add missing from Drive ».

   CE QUI EST VÉRIFIÉ ICI :
     1. le geste qui répare, exercé sur le VRAI module (src/utils/figuresLibrary.js
        + un faux Drive) : un dossier qui contient `Canvas_A.jpg` ET son sidecar
        rend une entrée AVEC `canvasData` — c'est exactement ce que l'éditeur
        recharge ensuite ;
     2. la seconde moitié du cas : l'entrée EXISTE mais sans composition (liste
        reconstruite par une version antérieure) — le sidecar la COMPLÈTE, sans
        créer de doublon ;
     3. l'effet lui-même : la lecture du dossier est le repli (jamais un appel
        réseau quand le canvas est déjà là), elle est ANNONCÉE, la recherche est
        refaite, et l'échec est DIT (bibliothèque ouverte, dossier nommé) au lieu
        d'un canvas vide et muet.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

/* ── un localStorage minimal pour exercer les VRAIS helpers ─────────────── */
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
const IB = readFileSync('./src/components/ImageBuilder.jsx', 'utf8').replace(/\r\n/g, '\n');

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (hay, needle, what) => {
  assert.ok(hay.includes(needle), `${what}\n  fragment absent : ${needle}`);
  passed += 1;
};

/* La composition enregistrée — ce que l'éditeur doit retrouver : la taille du
   canvas, la grille, les panneaux (avec leurs figures) et les flèches. */
const SNAP = {
  canvasW: 120, canvasH: 90, gridCols: 2, gridRows: 1,
  showPanelBorders: true, showGridLines: false, keepAspect: true,
  globalCaption: 'C: the composition', letterStyle: { fontSize: 10, color: '#000000', bold: false },
  objects: [{ id: 'o1', x: 0, y: 0, w: 1, h: 1, letter: 'A', caption: 'A: first', images: [], texts: [] }],
  arrows: [{ id: 'a1', x1: 10, y1: 10, x2: 30, y2: 10 }]
};
const SIDECAR = {
  kind: 'lab-figure-meta', v: 1, label: 'Canvas A', src: null,
  canvasData: SNAP, imageName: 'Canvas_A.jpg'
};
/* Un faux Drive : le dossier du projet, l'image, et le sidecar éditable à côté
   (c'est lui qui porte la composition). */
const driveWith = (imgId, metaId) => ({
  cloud: true,
  resolveDrivePathFromNames: (names) => ({ leafId: `leaf_${(names || []).join('_')}`, path: (names || []).map((nm, i) => ({ name: nm, id: `leaf_${i}` })) }),
  listDriveChildren: () => ([
    { id: `folder_${imgId}`, name: 'images', mimeType: 'application/vnd.google-apps.folder' },
    { id: imgId, name: 'Canvas_A.jpg', mimeType: 'image/jpeg', webViewLink: `https://drive.google.com/file/d/${imgId}/view` },
    { id: metaId, name: 'Canvas_A.jpg.meta.json', mimeType: 'application/json' }
  ]),
  downloadDriveFileText: async (id) => (id === metaId ? JSON.stringify(SIDECAR) : '')
});

/* ── 1. LE POSTE NEUF : la liste du navigateur ne connaît pas ce canvas ──── */
LIB.writeProjectLibrary('P1', []);
globalThis.__driveTestMocks = driveWith('IMG1', 'META1');
const pulled = await LIB.pullLibraryFromDrive({ scope: 'project', projectId: 'P1', projectName: 'Projet 1' });
eq(pulled.folder, 'projects/Projet_1/images', 'le dossier lu est celui du projet (dans celui du dataset)');
eq(pulled.restored, 1, 'le sidecar est relu : la COMPOSITION ÉDITABLE revient avec l’image');
eq(pulled.added, 1, '…et l’image entre dans la liste de ce navigateur');
const back = LIB.readProjectLibrary('P1')[0];
eq(back.id, 'lib_drive_IMG1', 'l’entrée porte l’id DÉTERMINISTE de son fichier (donc pas de doublon)');
ok(!!back.canvasData, 'l’entrée rendue à l’éditeur PORTE la composition — c’était la panne');
eq(back.canvasData.gridCols, 2, '…taille et grille comprises');
eq(back.canvasData.objects.length, 1, '…les panneaux aussi');
eq(back.canvasData.objects[0].caption, 'A: first', '…avec leur sous-titre');
eq(back.canvasData.arrows.length, 1, '…et les flèches');

/* ── 2. L'AUTRE MOITIÉ : l'entrée existe, mais SANS composition ──────────── */
LIB.writeProjectLibrary('P2', [{
  id: 'lib_drive_IMG2', label: 'Canvas A', drive: true,
  url: 'https://lh3.googleusercontent.com/d/IMG2',
  full: 'https://drive.google.com/file/d/IMG2/view',
  canvasData: null
}]);
globalThis.__driveTestMocks = driveWith('IMG2', 'META2');
const filled = await LIB.pullLibraryFromDrive({ scope: 'project', projectId: 'P2', projectName: 'Projet 2' });
eq(filled.added, 0, 'l’image déjà listée n’est pas ajoutée une seconde fois');
eq(filled.restored, 1, 'la composition est COMPLÉTÉE sur l’entrée qui existait déjà');
eq(LIB.readProjectLibrary('P2').length, 1, '…toujours une seule entrée');
eq(LIB.readProjectLibrary('P2')[0].canvasData.objects.length, 1, '…et l’éditeur peut la recharger');

/* ── 3. LA RÉOUVERTURE ELLE-MÊME (l'effet de ImageBuilder) ──────────────── */
const effect = IB.slice(IB.indexOf('const locate = () => {'), IB.indexOf('  }, [openCanvasId]);'));
ok(effect.length > 800, 'le corps de l’effet de réouverture est bien délimité pour l’analyse');
has(IB, 'res = await pullLibraryFromDrive(scopeInfo);',
  'quand le canvas n’est pas dans la liste, la réouverture RELIT le dossier du projet sur le Drive');
has(effect, 'if (here) {', 'la liste du navigateur est essayée d’abord');
ok(effect.indexOf('if (here) {') < effect.indexOf('await pullLibraryFromDrive'),
  '…et un canvas déjà présent ne déclenche AUCUN appel au Drive');
ok(effect.indexOf('const shared = readLibrary().find') > 0,
  'la bibliothèque PARTAGÉE est essayée aussi (canvas enregistré avant le cloisonnement par projet)');
has(effect, 'const after = locate();', '…puis la recherche est REFAIRE après la lecture du dossier');
has(effect, "setLibMsg('✓ The canvas was found on Drive: its panels, figures, captions and grid are back.')",
  'la composition retrouvée est ANNONCÉE (plus de canvas vide et muet)');
has(effect, 'setLibMsg(`⬇ This canvas is not in this browser — reading ',
  'la lecture du Drive est annoncée pendant qu’elle travaille');
has(effect, '⚠ “${openCanvasId}” is not in this browser and not in',
  'introuvable : le canvas est NOMMÉ et l’utilisateur est renvoyé au bon geste');
has(effect, 'setShowLibrary(true);', '…et la fenêtre de bibliothèque s’ouvre sur le dossier concerné');
has(effect, 'restoreCanvasFromItem(after.item, { confirm: false, scopeProjectId: after.scopeProjectId });',
  'la composition rechargée se ré-enregistre dans SA bibliothèque (pas de copie ailleurs)');
has(IB, 'const res = await pullLibraryFromDrive(libScopeInfo());',
  'le bouton « ⬇ Add missing from Drive » garde le même appel (le geste manuel reste)');

globalThis.__driveTestMocks = undefined;
console.log(`\n_builder_recall_test : ${passed} vérifications passées`);
