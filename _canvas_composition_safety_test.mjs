/* =========================================================================
   _canvas_composition_safety_test.mjs — « mes canvas disparaissent ENCORE »

   Le sidecar `<image>.meta.json` est le seul exemplaire durable de la copie
   ÉDITABLE d'un canvas (voir buildFigureMeta / uploadFigureMetaToDrive). Deux
   trous le laissaient disparaître sans un mot :

     1. le nettoyage d'urgence du magasin (pruneRecoverableLibraryCaches, appelé
        quand une écriture de projet ne rentre plus) oubliait TOUTE entrée dont
        les pixels étaient sur le Drive — y compris un canvas dont le sidecar
        n'était jamais monté. Or une entrée ré-ajoutée par « ⬇ Add missing from
        Drive » ne reprend que ce que son sidecar lui rend : la composition
        n'existait plus qu'ici, et elle était effacée. Le Drive ne gardait que
        l'image, et « Add missing » la ramenait comme une simple photo.

     2. l'éditeur annonçait « ☁ cloud copy … (with its editable copy …) » dès
        que l'IMAGE était partie — et marquait la version « faite »
        (`autoSaveKeyRef`), si bien que le sidecar raté n'était JAMAIS réessayé :
        la composition restait dans ce navigateur seul, à la merci de (1).

   Et le bouton « 📥 Restore a canvas file » doit DIRE ce qu'est le fichier qu'on
   lui donne (un sidecar de CAPTURE ne porte aucune composition) au lieu de
   laisser l'utilisateur chercher un canvas dans un graphe aplati.

   Ce que l'on vérifie ici :
     a. le nettoyage n'oublie QUE ce qui revient vraiment du Drive ;
     b. la lecture du dossier du Drive DIT combien d'images reviennent sans
        copie éditable (`noComposition`) ;
     c. l'éditeur ne dit « + Drive » que si la copie éditable y est, réessaie
        sinon, et le badge le montre ;
     d. le refus d'un fichier de capture explique ce que c'est.
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
      drawImage() {}, fillRect() {},
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)).fill(255) })
    }),
    toDataURL: () => 'data:image/jpeg;base64,dGh1bWI='
  })
};

const LIB = await import('./src/utils/figuresLibrary.js');
const IB = readFileSync('./src/components/ImageBuilder.jsx', 'utf8').replace(/\r\n/g, '\n');
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
const hasNot = (hay, needle, what) => {
  assert.ok(!hay.includes(needle), `${what}\n  fragment inattendu : ${needle}`);
  passed += 1;
};


/* =========================================================================
   a. LE NETTOYAGE N'OUBLIE QUE CE QUI REVIENT VRAIMENT DU DRIVE
   ========================================================================= */
{
  const link = (id) => `https://drive.google.com/file/d/${id}/view`;
  const canvasOnDrive = {
    id: 'cv_on_drive', label: 'Canvas sur Drive', drive: true, driveUrl: link('D1'), full: link('D1'),
    url: 'https://lh3.googleusercontent.com/d/D1',
    canvasData: { canvasKey: 'cv_1', canvasW: 180, canvasH: 120, objects: [], arrows: [], shapes: [] },
    metaName: 'Canvas_sur_Drive.jpg.meta.json'
  };
  const canvasLocalOnly = {
    id: 'cv_local_only', label: 'Canvas sans sidecar', drive: true, driveUrl: link('D2'), full: link('D2'),
    url: 'https://lh3.googleusercontent.com/d/D2',
    canvasData: { canvasKey: 'cv_2', canvasW: 180, canvasH: 120, objects: [], arrows: [], shapes: [] },
    metaName: null
  };
  const captureLocalOnly = {
    id: 'capture_local_only', label: 'Capture sans sidecar', drive: true, driveUrl: link('D3'), full: link('D3'),
    url: 'https://lh3.googleusercontent.com/d/D3',
    src: { elementKey: '1D Histogram (Data Analysis) · Chart · 2', testName: 'flow_cyt_p53H_p53R' },
    canvasData: null,
    metaName: ''
  };
  const plainOnDrive = {
    id: 'photo', label: 'Photo', drive: true, driveUrl: link('D4'), full: link('D4'),
    url: 'https://lh3.googleusercontent.com/d/D4', canvasData: null, src: null, metaName: null
  };
  const localOnly = {
    id: 'local_only', label: 'Seulement ici', drive: false, full: 'data:image/png;base64,aaa',
    url: 'data:image/png;base64,aaa', canvasData: null, src: null, metaName: null
  };
  store.clear();
  LIB.writeLibrary([canvasOnDrive, canvasLocalOnly, captureLocalOnly, plainOnDrive, localOnly]);
  const out = LIB.pruneRecoverableLibraryCaches();
  eq(out.forgotten, 2, 'seules les entrées dont TOUT est sur le Drive sont oubliées (le canvas avec son sidecar, la photo)');
  eq(out.left, 3, 'les trois autres restent');
  eq(LIB.readLibrary().map((i) => i.id), ['cv_local_only', 'capture_local_only', 'local_only'],
    'le canvas sans sidecar et la capture sans sidecar sont CONSERVÉS : leur composition / origine n’existe que dans ce navigateur');
  eq(JSON.parse(store.get('labFiguresLibrary')).map((i) => i.id), ['cv_local_only', 'capture_local_only', 'local_only'],
    '…et le magasin écrit est celui-là (la mémoire suit)');

  // Un canvas dont le sidecar EST sur le Drive reste, lui, récupérable : il est
  // oublié sans remords (« Add missing from Drive » le ramène complet).
  store.clear();
  LIB.writeLibrary([canvasOnDrive]);
  eq(LIB.pruneRecoverableLibraryCaches().forgotten, 1,
    'un canvas dont la copie éditable EST sur le Drive s’oublie (il revient par la relecture du dossier)');
}

/* =========================================================================
   b. LA RELECTURE DU DOSSIER DIT CE QUI REVIENT SANS COPIE ÉDITABLE
   ========================================================================= */
{
  const SIDECAR = JSON.stringify({
    kind: 'lab-workspace/figure-meta',
    v: 1,
    label: 'Canvas avec sidecar',
    src: null,
    canvasData: {
      canvasKey: 'cv_keep', canvasW: 240, canvasH: 300, gridCols: 8, gridRows: 8,
      objects: [{ id: 'obj_1', x: 0, y: 0, w: 4, h: 2, letter: 'A', imgSrc: null, images: [], texts: [] }],
      arrows: [], shapes: []
    },
    imageName: 'Canvas_avec_sidecar.jpg',
    savedAt: '2026-09-19T09:00:00.000Z'
  });
  const listing = [
    { id: 'IMG1', name: 'Canvas_avec_sidecar.jpg', mimeType: 'image/jpeg' },
    { id: 'META1', name: 'Canvas_avec_sidecar.jpg.meta.json', mimeType: 'application/json' },
    { id: 'IMG2', name: 'Graphe_sans_sidecar.svg', mimeType: 'image/svg+xml' }
  ];
  globalThis.__driveTestMocks = {
    cloud: true,
    driveToken: 'tok',
    resolveDrivePathFromNames: () => ({ leafId: 'leaf_images', path: [] }),
    /* Le dossier est CHERCHÉ, pas créé (voir utils/figuresFolder.js) : le faux
       Drive le retrouve par son nom, comme le vrai. */
    findFolderByName: async (name) => (name === 'images' ? 'leaf_images' : `DIR_${name}`),
    getDriveFileMeta: async () => ({ id: '', name: '', trashed: true }),
    listDriveChildren: () => listing,
    downloadDriveFileText: async (id) => (id === 'META1' ? SIDECAR : '')
  };
  store.clear();
  LIB.writeProjectLibrary('P1', []);
  const res = await LIB.pullLibraryFromDrive({ scope: 'project', projectId: 'P1', projectName: 'P1' });
  eq(res.added, 2, 'les deux images du dossier sont ajoutées');
  eq(res.restored, 1, 'celle qui a un sidecar revient AVEC sa composition');
  eq(res.noComposition, 1, '…et l’autre est comptée comme « rien à rouvrir » (aucun sidecar)');
  const back = LIB.readProjectLibrary('P1');
  const withComp = back.find((i) => i.label.startsWith('Canvas avec sidecar')) || {};
  eq(LIB.canvasKeyOfEntry(withComp), 'cv_keep', 'la composition revenue porte sa clé de canvas');
  eq(withComp.metaName, 'Canvas_avec_sidecar.jpg.meta.json', '…et sait où est son sidecar');
  const withoutComp = back.find((i) => i.label.startsWith('Graphe sans sidecar')) || {};
  eq([withoutComp.canvasData, withoutComp.src], [null, null], 'l’image sans sidecar n’a ni composition ni origine');
  globalThis.__driveTestMocks = null;
}

/* =========================================================================
   c. L'ÉDITEUR NE DIT « + DRIVE » QUE SI LA COPIE ÉDITABLE Y EST
   ========================================================================= */
{
  has(IB, 'metaName: metaName || entry.metaName || null,', 'publishCanvas rapporte le nom du sidecar déposé');
  has(IB, 'compositionOnDrive: !!(metaName || entry.metaName)', '…et dit si la copie éditable est sur le Drive');
  has(IB, 'if (pub.drive && pub.drive.id && pub.compositionOnDrive) detail =',
    '« 💾 Save now » n’annonce la copie cloud AVEC sa copie éditable que si elle y est');
  has(IB, 'but its EDITABLE copy (.meta.json) did not reach Drive',
    '…sinon il le DIT (au lieu de rassurer à tort)');
  has(IB, 'const onDrive = !!(pub.drive && pub.drive.id);', 'la sauvegarde automatique distingue image et composition');
  has(IB, 'if (onDrive && pub.compositionOnDrive) autoSaveKeyRef.current = key;',
    'elle ne marque la version « faite » que si la composition est à l’abri — sinon la passe suivante RÉESSAIE le sidecar');
  has(IB, "(pub.compositionOnDrive ? 'cloud' : 'image-only')", 'un état propre existe pour « image partie, composition non »');
  has(IB, "if (autoSaveNote === 'image-only')", '…et le badge le montre');
  has(IB, 'editable copy not on Drive yet', '…en clair, dans la barre d’outils');
  has(IB, "// 'draft' | 'cloud' | 'image-only' | 'queued' | 'browser' | 'noproject'",
    'les états possibles sont documentés');
  // La relecture automatique du dossier du projet et le bouton « Add missing »
  // disent ce qui est revenu sans rien à rouvrir.
  has(PD, 'came back WITHOUT an editable copy', 'la page projet le dit quand elle relit le dossier d’elle-même');
  has(PD, 'have NO editable copy on Drive', '…et quand on clique « ⬇ Add missing figures from Drive »');
}

/* =========================================================================
   d. UN FICHIER DE CAPTURE DIT CE QU'IL EST
   ========================================================================= */
{
  const captureText = JSON.stringify({
    kind: 'lab-workspace/figure-meta',
    v: 1,
    label: '1D Histogram (Data Analysis) flow_cyt_p53H_p53R',
    src: {
      testId: 't1788095504762', testName: 'flow_cyt_p53H_p53R', instanceName: 'p53 H_H2_H02',
      date: '2026-08-30', elementLabel: '1D Histogram (Data Analysis)',
      elementKey: '1D Histogram (Data Analysis) · Chart · 2'
    },
    canvasData: null,
    imageName: '1D_Histogram_Data_Analysis_flow_cyt_p53H_p53R-1pszh79.svg',
    savedAt: '2026-09-19T11:30:18.664Z'
  });
  const res = await LIB.restoreCanvasFromFigureMeta({
    text: captureText, fileName: '1D_Histogram_Data_Analysis_flow_cyt_p53H_p53R-1pszh79.svg.meta.json',
    scope: 'project', projectId: 'P1'
  });
  eq(res.ok, false, 'un sidecar de capture n’est PAS un canvas : il est refusé');
  ok(/no canvas composition/.test(res.error), '…en disant qu’il n’y a pas de composition');
  ok(/CAPTURED FIGURE/.test(res.error), '…et en disant CE QUE LE FICHIER EST (une capture)');
  ok(/1D Histogram \(Data Analysis\)/.test(res.error), '…avec la figure dont il vient');
  ok(/flow_cyt_p53H_p53R/.test(res.error), '…et l’expérience');
  ok(/2026-09-19 11:30/.test(res.error), '…et quand il a été écrit');
  // Un fichier sans composition décrite garde une raison tout aussi claire.
  const bad = await LIB.restoreCanvasFromFigureMeta({
    text: '{"kind":"lab-workspace/figure-meta"}', fileName: 'x.meta.json', scope: 'project', projectId: 'P1'
  });
  eq(bad.ok, false, 'un fichier sans composition est refusé');
  ok(/no canvas composition/.test(bad.error), '…avec la raison en clair, même sans `src`');
  hasNot(bad.error, 'CAPTURED FIGURE', '…sans inventer une capture qui n’est pas décrite');
}

console.log(`✅ _canvas_composition_safety_test : ${passed} vérifications passées`);

