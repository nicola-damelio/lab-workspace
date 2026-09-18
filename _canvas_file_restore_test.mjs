/* =========================================================================
   _canvas_file_restore_test.mjs — « j'ai fait un rafraîchissement forcé et
   j'ai perdu mon canvas, et je venais de le finir »

   La composition d'un canvas part ENTIÈRE dans la bibliothèque (les pixels de
   chaque panneau, écrits plusieurs fois : `imgSrc`, `imgThumb` et `images[]`),
   et le magasin du navigateur est plafonné : quand elle ne rentre pas, l'entrée
   ne vit qu'en mémoire et le rafraîchissement l'emporte. Le seul exemplaire
   complet qui reste est le sidecar `<image>.meta.json` posé à côté de l'image
   sur le Drive — et « ⬇ Add missing from Drive » ne suffit pas toujours (une
   copie fusionnée par le nettoyage y a laissé une pierre tombale).

   Ce que l'on vérifie ici :
     1. la composition se relit d'UN FICHIER, sans jeton, liste ni horodatage
        (canvasDataOfFigureMeta) ;
     2. elle est ALLÉGÉE avant d'être rangée, en gardant chaque image une fois
        (lightenCanvasDataPixels) ;
     3. la restauration crée une VRAIE entrée de canvas — clé de composition,
        libellé, sidecar — la met à jour si on réimporte le même fichier, et
        EFFACE ses pierres tombales (un geste explicite de l'utilisateur) ;
     4. la page projet offre le geste (bouton + sélecteur de fichier).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

/* ── localStorage / window / canvas minimaux ─────────────────────────────── */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i] ?? null
};
globalThis.window = {
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
  location: { search: '' }
};
globalThis.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } };
globalThis.Image = class Image {
  constructor() { this.width = 40; this.height = 30; this.naturalWidth = 40; this.naturalHeight = 30; }
  set src(v) { this._src = v; if (typeof this.onload === 'function') this.onload(); }
  get src() { return this._src; }
};
globalThis.document = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      drawImage() {},
      fillRect() {},
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)).fill(255) })
    }),
    toDataURL: () => 'data:image/jpeg;base64,dGh1bWI='
  })
};

const LIB = await import('./src/utils/figuresLibrary.js');
const LIB_SRC = readFileSync('./src/utils/figuresLibrary.js', 'utf8').replace(/\r\n/g, '\n');
const PD = readFileSync('./src/components/AppModules/projectDetailModule.jsx', 'utf8').replace(/\r\n/g, '\n');

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

// Les pixels d'un panneau : ce que le sidecar porte réellement (des centaines de
// Ko en base64, écrits trois fois dans la composition).
const PIXELS = `data:image/jpeg;base64,${'A'.repeat(6000)}`;
const SIDECAR_FILE = 'Canvas_18092026.jpg.meta.json';
const sidecarText = ({ canvasData = {}, ...over } = {}) => JSON.stringify({
  kind: 'lab-workspace/figure-meta',
  v: 1,
  label: 'Canvas 18/09/2026',
  src: null,
  imageName: 'Canvas_18092026.jpg',
  savedAt: '2026-09-18T22:01:45.074Z',
  canvasData: {
    canvasW: 240, canvasH: 300, gridCols: 8, gridRows: 8,
    objects: [{
      id: 'obj_1', x: 0, y: 0, w: 4, h: 2, letter: 'A', caption: '',
      imgSrc: PIXELS, imgThumb: PIXELS,
      images: [{ imgSrc: PIXELS, imgThumb: PIXELS, libId: 'lib_1' }]
    }],
    arrows: [{ id: 'ar_1' }],
    shapes: [],
    ...canvasData
  },
  ...over
});

const reset = () => {
  store.clear();
  LIB.writeLibrary([]);
  LIB.writeProjectLibrary('P1', []);
};


/* =========================================================================
   1. LA COMPOSITION SE RELIT D'UN FICHIER (sans rien d'autre)
   ========================================================================= */
{
  eq(LIB.canvasDataOfFigureMeta(null), null, 'un fichier illisible ne donne pas de composition');
  eq(LIB.canvasDataOfFigureMeta({ kind: 'lab-workspace/figure-meta' }), null,
    'un sidecar de simple figure n’est pas un canvas');
  const cd = LIB.canvasDataOfFigureMeta(JSON.parse(sidecarText()));
  eq(cd.objects.length, 1, 'les panneaux du fichier sont repris');
  const armed = LIB.canvasDataOfFigureMeta({ canvasData: { canvasW: 10 } });
  eq([armed.objects, armed.arrows, armed.shapes], [[], [], []],
    'une composition ancienne sans listes les reçoit vides (l’Image Builder compte dessus)');
}

/* =========================================================================
   2. LES PIXELS SONT ALLÉGÉS (chaque image UNE fois, jamais dégradée pour rien)
   ========================================================================= */
{
  reset();
  const cd = LIB.canvasDataOfFigureMeta(JSON.parse(sidecarText()));
  const before = JSON.stringify(cd).length;
  const light = await LIB.lightenCanvasDataPixels(cd);
  ok(light.changed, 'une composition de plusieurs Mo est allégée');
  ok(light.bytes < before / 5, `l’allègement est net (${before} → ${light.bytes} caractères)`);
  const o = light.canvasData.objects[0];
  eq(o.images[0].imgSrc, o.imgSrc, 'l’image du panneau est la même dans `images[]` et `imgSrc`');
  eq(o.images[0].imgThumb, o.images[0].imgSrc, '…et la vignette ne garde plus une SECONDE copie des pixels');
  ok(o.imgSrc.length < PIXELS.length, 'les pixels du panneau ont bien été recompressés');

  const svg = 'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E';
  const keep = await LIB.lightenCanvasDataPixels({ objects: [{ id: 'o', imgSrc: svg }] });
  eq(keep.canvasData.objects[0].imgSrc, svg, 'un SVG reste vectoriel (on ne le rastérise pas)');
  const none = await LIB.lightenCanvasDataPixels(null);
  eq([none.canvasData, none.changed], [null, false], 'sans composition, rien à alléger');
}

/* =========================================================================
   3. LA RESTAURATION (entrée de canvas, clé, sidecar, pierres tombales)
   ========================================================================= */
{
  reset();
  const bad = await LIB.restoreCanvasFromFigureMeta({ text: '{"kind":"lab-workspace/figure-meta"}', fileName: SIDECAR_FILE, projectId: 'P1' });
  eq(bad.ok, false, 'un fichier sans composition est REFUSÉ (et le dit)');
  ok(/no canvas composition/.test(bad.error), '…avec la raison en clair');
  eq(LIB.readProjectLibrary('P1').length, 0, '…et rien n’est écrit');

  const res = await LIB.restoreCanvasFromFigureMeta({ text: sidecarText(), fileName: SIDECAR_FILE, projectId: 'P1' });
  eq(res.ok, true, 'un sidecar de canvas est restauré');
  eq(res.created, true, '…en créant son entrée');
  eq(res.lightened, true, '…allégée pour tenir dans le magasin du navigateur');
  eq(res.entry.label, 'Canvas 18/09/2026', 'le libellé vient du fichier');
  eq(res.entry.metaName, SIDECAR_FILE, 'l’entrée sait de quel sidecar elle vient');
  eq(res.entry.addedAt, '2026-09-18T22:01:45.074Z', 'la date du fichier est gardée (c’est quand le travail a été fait)');
  ok(String(res.entry.canvasData.canvasKey).startsWith('cv_'),
    'la composition restaurée porte une clé : « 💾 Save now » mettra à jour CETTE entrée');
  eq(res.entry.canvasData.objects.length, 1, 'les panneaux sont là');
  eq(res.entry.canvasData.arrows.length, 1, 'les flèches aussi');
  eq(LIB.readProjectLibrary('P1').length, 1, 'l’entrée est dans la bibliothèque du projet');
  eq(LIB.canvasKeyOfEntry(LIB.readProjectLibrary('P1')[0]), res.entry.canvasData.canvasKey,
    '…et sa clé de composition se relit de l’entrée (l’identité est posée)');
  ok(res.bytes > 0 && res.bytes < JSON.stringify(LIB.canvasDataOfFigureMeta(JSON.parse(sidecarText()))).length,
    'ce qui a été rangé est bien plus léger que le fichier');
  eq(res.persisted, true, '…et l’appelant sait que c’est VRAIMENT rangé dans le magasin (pas seulement en mémoire)');

  // Réimporter le MÊME fichier : mise à jour, jamais une seconde copie.
  const again = await LIB.restoreCanvasFromFigureMeta({ text: sidecarText(), fileName: SIDECAR_FILE, projectId: 'P1' });
  eq(again.entry.id, res.entry.id, 'réimporter le même fichier retrouve SON entrée (par son sidecar)');
  eq(again.created, false, '…et la met à jour');
  eq(LIB.readProjectLibrary('P1').length, 1, 'aucune copie n’est empilée');
  eq(LIB.readProjectLibrary('P1')[0].canvasData.canvasKey, again.entry.canvasData.canvasKey,
    'la clé de composition ne change pas d’un import à l’autre');

  // Une pierre tombale du NETTOYAGE ne doit plus cacher un canvas que
  // l'utilisateur demande explicitement à retrouver.
  reset();
  LIB.rememberLibraryTrash('P1', ['lib_old', 'd:FILE_TOMB', 'lib_drive_keep']);
  const back = await LIB.restoreCanvasFromFigureMeta({ text: sidecarText(), fileName: SIDECAR_FILE, projectId: 'P1' });
  const trash = LIB.readLibraryTrash('P1');
  ok(!trash.includes(back.entry.id), 'la restauration EFFACE la pierre tombale de l’entrée qu’elle ramène');
  eq(trash.includes('lib_old'), true, '…sans toucher aux autres suppressions');
  const tomb = LIB.forgetLibraryTrash('P1', ['lib_old']);
  eq(tomb.includes('lib_old'), false, 'forgetLibraryTrash sait enlever des ids précis');
  eq(tomb.includes('d:FILE_TOMB'), true, '…et laisse les autres');

  // Deux postes : la copie du Drive porte la même clé → UNE seule entrée.
  const local = LIB.readProjectLibrary('P1');
  const drive = { id: 'lib_drive_ZZ', label: 'Canvas 18/09/2026', url: 'https://lh3.googleusercontent.com/d/ZZ', drive: true,
    canvasData: { ...local[0].canvasData } };
  const merged = LIB.mergeLibraryLists(local, [drive]);
  eq(merged.length, 1, 'la copie relue du Drive fusionne avec le canvas restauré (même clé)');
  eq(merged[0].id, local[0].id, '…et le canvas garde l’id de son entrée (les liens de la page projet continuent de le viser)');

  // Portée partagée : le même geste, sans projet.
  reset();
  const common = await LIB.restoreCanvasFromFigureMeta({ text: sidecarText(), fileName: '', scope: 'common', label: 'Canvas retrouvé' });
  eq(common.ok, true, 'la portée partagée se restaure aussi (sans nom de fichier)');
  eq(common.entry.label, 'Canvas retrouvé', 'un libellé peut être imposé');
  eq(LIB.readLibrary().length, 1, 'l’entrée est dans la bibliothèque commune');
  eq(LIB.readProjectLibrary('P1').length, 0, '…et pas dans un projet');
}

/* =========================================================================
   4. LE GESTE EST OFFERT SUR LA PAGE DU PROJET
   ========================================================================= */
{
  has(LIB_SRC, 'export const restoreCanvasFromFigureMeta = async ({', 'figuresLibrary expose la restauration');
  has(LIB_SRC, 'export const canvasDataOfFigureMeta = (meta) => {', '…la lecture du fichier');
  has(LIB_SRC, 'export const lightenCanvasDataPixels = async (canvasData,', '…et l’allègement');
  has(LIB_SRC, 'export const forgetLibraryTrash = (scopeKey, ids) => {', '…et l’effacement des pierres tombales');
  has(PD, 'restoreCanvasFromFigureMeta', 'la page projet appelle la restauration');
  has(PD, '📥 Restore a canvas file', '…avec son bouton');
  has(PD, 'if (typeof openImageBuilder === \'function\') openImageBuilder(project.id, c.id);',
    '…et le lien qui rouvre le canvas restauré dans l’éditeur');
  has(PD, '<input ref={canvasFileRef} type="file" accept=".json,application/json" className="hidden"',
    '…un sélecteur de fichier (le sidecar du Drive)');
  has(PD, "const res = await restoreCanvasFromFigureMeta({\n        text, fileName: file.name || '', scope: 'project', projectId: project.id\n      });",
    '…qui restaure dans la bibliothèque de CE projet');
  has(PD, 'this browser’s store is FULL', '…et qui AVERTIT quand le magasin du navigateur est plein (rien n’est perdu en silence)');
  has(PD, 'setCanvasLibVersion((v) => v + 1);', 'la liste des canvases est rafraîchie juste après');
}

console.log(`✅ _canvas_file_restore_test : ${passed} vérifications passées`);

