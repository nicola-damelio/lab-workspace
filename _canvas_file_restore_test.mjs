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

/* =========================================================================
   5. RENOMMER UN CANVAS (« in no places it is possible to rename canvases »)
   ========================================================================= */
{
  has(PD, 'const renameCanvas = (c) => {', 'la page projet sait renommer un canvas');
  has(PD, 'const kept = renameProjectLibraryItem(project.id, c.id, label);',
    '…en réécrivant le libellé de SON entrée, et en gardant la réponse du magasin');
  has(PD, 'setFigDriveMsg(!kept', '…pour DIRE ce qui s’est passé quand rien n’a pu être écrit');
  has(PD, 'this browser’s store refused even the small name record', '…au lieu de laisser croire que le nom est gardé');
  has(PD, 'const full = kept === false || lastLibraryListWrite().kept === false;',
    '…et pour distinguer « magasin plein » de « perdu » (le nom est gardé à part)');
  has(PD, 'if (!label || label === c.label) return;', '…sans écrire pour rien (nom vide ou identique)');
  has(PD, 'return { ...fig, canvasLabel: label };',
    '…et les figures qui renvoient à ce canvas suivent (libellé des liens ✏️ Modify in Image Builder)');
  has(PD, 'if (touched) updateProject({ figures: nextFigures });', 'les figures ne sont enregistrées que si elles changent');
  has(PD, 'onClick={() => renameCanvas(c)}', '…avec son bouton sur la carte du canvas');
  has(PD, 'title="Rename this canvas — the name is what this page, the image library and the “✏️ Modify in Image Builder” links show.',
    '…et une infobulle qui dit ce que le nom change');
  has(PD, 'canvases can also be\n            renamed in the Image Builder — its toolbar’s',
    'le texte d’aide rappelle où renommer ailleurs (la barre de l’éditeur et la modale 🖼 Library)');
  has(PD, '>✏️ Rename</button>', '…et le bouton dit « Rename » au lieu d’un crayon seul');
  has(PD, "renameFigureOnDrive({ scope: 'project', projectId: project.id, projectName: project.name || '', id: c.id, label })",
    '…et le FICHIER DU DRIVE suit le renommage (« I cannot find my renamed canvas in Drive »)');
  has(PD, 'if (!r || !r.ok) return;', '…sans effacer le message local quand le cloud n’a rien pu faire');
  has(PD, '📁 On Drive, “', '…et en DISANT ce que le fichier est devenu (renommé, ou déjà sous ce nom)');
  eq(LIB.figureRenameTarget({ label: 'p53H — histograms', previousName: 'Canvas_18092026.jpg', identity: 'canvas:cv_1' }).name,
    LIB.figureFileName('p53H — histograms', 'jpg', 'canvas:cv_1'),
    'le nom visé = libellé + empreinte, en GARDANT l’extension du fichier déjà déposé (un JPG reste un JPG)');
  eq(LIB.fileNameOfUrl('https://nc/remote.php/dav/files/u/a%20b.svg'), 'a b.svg',
    'le nom d’un fichier Nextcloud se lit dans son URL (le Drive, lui, n’a qu’un id)');

  // La fonction de bibliothèque existe et garde TOUT le reste de l’entrée.
  reset();
  LIB.writeProjectLibrary('P1', [{
    id: 'lib_1', label: 'Canvas 18/09/2026', canvasData: { canvasKey: 'cv_1', objects: [{ id: 'o' }] }, metaName: 'A.jpg.meta.json', url: 'data:image/png;base64,t'
  }]);
  LIB.renameProjectLibraryItem('P1', 'lib_1', 'p53H — histograms');
  const renamed = LIB.readProjectLibrary('P1')[0];
  eq(renamed.label, 'p53H — histograms', 'le libellé est changé');
  eq(renamed.id, 'lib_1', '…sans changer l’id (les liens des figures continuent de le viser)');
  eq(!!renamed.canvasData, true, '…ni perdre la composition');
  eq(LIB.canvasKeyOfEntry(renamed), 'cv_1', '…ni sa clé de canvas');
}

/* =========================================================================
   6. LE CRAYON DE L'ÉDITEUR ET LES APERÇUS DES CARTES
      (« I cannot rename it » + « the preview of the images in the project does
      not work » : même manque des deux côtés — ce que l'écran montrait était
      TOUT ce qu'il y avait. Un canvas restauré depuis son fichier n'a pas de
      rendu — le sidecar ne porte que la composition — et l'éditeur n'offrait
      aucun crayon. On vérifie les deux gestes.)
   ========================================================================= */
{
  has(IB, 'const renameThisCanvas = () => {', 'l’éditeur sait renommer le canvas OUVERT (le crayon qui manquait)');
  has(IB, 'onClick={renameThisCanvas}', '…branché sur un bouton de la barre d’outils');
  has(IB, '✏️ Rename', '…qui se voit (le crayon seul ne se lisait pas)');
  has(IB, '{canvasNameMsg && (', '…et dont le résultat est DIT à l’écran');
  has(IB, 'const [canvasNameMsg, setCanvasNameMsg] = useState(\'\');', 'l’état du message existe');
  has(IB, "const kept = k === 'dataset'", 'le renommage part de l’entrée DU CANVAS, portée par portée');
  has(IB, '? renameLibraryItem(id, label)', '…dans la bibliothèque commune');
  has(IB, ': renameProjectLibraryItem(k, id, label);', '…et dans celle d’un projet');
  has(IB, 'setCanvasLabel(label);',
    'et il écrit AUSSI le nom de l’éditeur (c’est lui que la prochaine sauvegarde envoie au Drive)');
  has(IB, 'const full = lastLibraryListWrite().kept === false;',
    'le renommage distingue « magasin plein » de « rien n’a pu être écrit »');
  has(IB, 'this browser’s store refused even the small name record',
    '…et le dit franchement (« the rename does not work » ne reste plus muet)');
  has(IB, 'renameFigureOnDrive({ ...s, label })',
    'et le fichier de CHAQUE portée est renommé sur le Drive (même fichier, nouveau nom)');
  has(IB, 'renameFigureOnDrive({ ...cloudScope, id, label })',
    'la modale 🖼 Library renomme elle aussi le fichier du Drive — une image renommée se retrouve LÀ-BAS sous son nom');

  // L'aperçu des cartes : le rendu quand il existe, sinon le premier panneau de
  // la composition — sinon on ne peut pas reconnaître SON canvas restauré.
  eq(LIB.canvasPreviewFromComposition({ objects: [{ imgThumb: PIXELS }] }), PIXELS,
    'l’aperçu d’une composition sans rendu est le premier panneau');
  eq(LIB.canvasPreviewFromComposition({ objects: [{ images: [{ imgSrc: 'data:image/png;base64,eA==' }] }] }),
    'data:image/png;base64,eA==', '…y compris une image d’un panneau multi-figures');
  eq(LIB.canvasPreviewFromComposition({ objects: [{ imgThumb: '' }, { imgSrc: 'data:image/jpeg;base64,QQ==' }] }),
    'data:image/jpeg;base64,QQ==', '…le premier panneau QUI a des pixels');
  eq(LIB.canvasPreviewFromComposition(null), '', 'aucune composition → aucun aperçu');
  eq(LIB.canvasPreviewFromComposition({ objects: [] }), '', 'composition sans panneau → aucun aperçu');
  has(PD, 'const canvasPreviewOf = (c) => getRenderableDriveUrl(', 'la carte d’un canvas a son repli d’aperçu');
  has(PD, '{canvasPreviewOf(c)', '…et c’est lui que l’image de la carte affiche');
  ok(!PD.includes('text-slate-400">no preview<'),
    'un canvas restauré n’est plus un cadre vide « no preview »');
  has(PD, 'composition only — 🖼 open it', 'quand rien n’est dessinable, la carte le dit et renvoie au geste');
  has(IB, 'const libThumbOf = (item) => getRenderableDriveUrl(', 'la vignette de la modale 🖼 Library a le même repli');
  has(IB, '{libThumbOf(item)', '…et l’utilise');

  // À l'import aussi : le fichier restauré arrive avec son aperçu.
  reset();
  const res = await LIB.restoreCanvasFromFigureMeta({ text: sidecarText(), fileName: SIDECAR_FILE, projectId: 'P1' });
  ok(String(res.entry.url || '').startsWith('data:image/'),
    'l’entrée restaurée arrive AVEC un aperçu (la carte se reconnaît tout de suite)');
}

/* =========================================================================
   7. UN NOM SURVIT À UN MAGASIN PLEIN (pourquoi « le renommage ne marche pas »)
      Renommer réécrit TOUTE la liste — ici des mégaoctets de pixels — et le
      magasin la refuse : la liste ne vivait que dans cette session, donc le
      prochain rafraîchissement repartait de l'ancien libellé. Un nom pèse
      quelques octets : gardé dans une petite clé, il s'applique à la lecture.
   ========================================================================= */
{
  reset();
  LIB.writeProjectLibrary('P1', [{
    id: 'lib_big', label: 'Canvas 18/09/2026', url: PIXELS,
    canvasData: { canvasKey: 'cv_big', objects: [{ id: 'o', imgThumb: PIXELS }] }
  }]);
  // Un magasin qui refuse tout ce qui est gros (les listes) mais garde le petit
  // (le nom) : c'est exactement le « magasin plein » de l'utilisateur.
  const realSet = globalThis.localStorage.setItem;
  const big = (v) => String(v).length > 400;
  globalThis.localStorage.setItem = (k, v) => {
    if (big(v)) throw new Error('QuotaExceededError');
    return realSet.call(globalThis.localStorage, k, v);
  };
  eq(LIB.renameProjectLibraryItem('P1', 'lib_big', 'p53H — histograms'), true,
    'le renommage est GARDÉ même quand la liste ne rentre pas (le nom tient en quelques octets)');
  eq(LIB.lastLibraryListWrite().kept, false,
    '…et l’appelant SAIT que la liste, elle, n’a pas pu être réécrite (magasin plein)');
  eq(LIB.readProjectLibrary('P1')[0].label, 'p53H — histograms', 'le nom s’applique à la lecture');
  eq(JSON.parse(store.get('labFiguresLib_P1'))[0].label, 'Canvas 18/09/2026',
    '…alors que la liste RANGÉE porte encore l’ancien nom : c’est lui qui revenait au rafraîchissement');

  // Le rafraîchissement : une liste relue DU MAGASIN (jamais lue en mémoire dans
  // cette session) reçoit le nom gardé — c’est très exactement ce qui se passe à
  // l’ouverture suivante, quand la liste revient de localStorage avec l’ancien
  // libellé.
  realSet.call(globalThis.localStorage, 'labFiguresLib_P2',
    JSON.stringify([{ id: 'lib_big', label: 'Canvas 18/09/2026', url: PIXELS }]));
  eq(LIB.readProjectLibrary('P2')[0].label, 'p53H — histograms',
    'une liste relue du magasin reçoit le nom gardé à part (le nom survit au rafraîchissement)');

  // Quand le magasin accepte de nouveau, c’est la LISTE qui fait foi : le nom
  // gardé à part est effacé (aucune ligne qui traîne, aucun doublon).
  globalThis.localStorage.setItem = realSet;
  eq(LIB.renameProjectLibraryItem('P2', 'lib_big', 'Nom rangé'), true, 'le magasin accepte : la liste est écrite');
  eq(JSON.parse(store.get('labFiguresLib_P2'))[0].label, 'Nom rangé', '…avec le nouveau nom dedans');
  eq(Object.keys(JSON.parse(store.get('labCanvasNames') || '{}')).includes('lib_big'), false,
    '…et le nom gardé à part est oublié (la liste prime)');
  eq(LIB.readProjectLibrary('P2')[0].label, 'Nom rangé', 'le nom affiché reste le bon');

  // Une entrée supprimée ne laisse pas son nom à part derrière elle.
  LIB.rememberCanvasName('lib_big', 'Nom fantôme');
  LIB.removeProjectLibraryItem('P2', 'lib_big');
  eq(Object.keys(JSON.parse(store.get('labCanvasNames') || '{}')).includes('lib_big'), false,
    'supprimer l’entrée oublie aussi son nom gardé à part');
}

console.log(`✅ _canvas_file_restore_test : ${passed} vérifications passées`);


