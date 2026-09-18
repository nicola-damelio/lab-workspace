/* =========================================================================
   _canvas_autosave_test.mjs — « MES CANVAS D'IMAGE BUILDER DISPARAISSENT »

   Ce que le labo a vécu : une composition est faite dans l'Image Builder,
   insérée dans un projet… et plus rien pour la rouvrir. Le message affiché
   (« Drive upload failed — browser copy only ») ne disait pas non plus si le
   travail était gardé quelque part.

   Trois causes, trois verrous — c'est ce que ce fichier vérifie :

     1. la composition ÉDITABLE ne vivait que dans la liste du navigateur
        (localStorage, ~5 Mo PARTAGÉS avec le dataset) : magasin plein → entrée
        en MÉMOIRE SEULEMENT, donc rien après un rechargement.
          → `saveCanvasSnapshot()` écrit la composition SANS rendu ni envoi, et
            l'Image Builder l'appelle tout seul (2,5 s après la dernière
            modification ET au moment où l'on quitte la page) ;
     2. même arrivée sur le Drive, une image ne se rouvre pas dans l'éditeur :
        il faut sa composition.
          → chaque publication dépose un sidecar `<image>.meta.json` à côté de
            l'image, et « ⬇ Add missing from Drive » le relit (le canvas revient
            ÉDITABLE, pas seulement affichable) ;
     3. `_workspace/keys.json` (la mémoire partagée des clés) était écrit avec
        la SEULE photographie locale : un poste pauvre écrasait la liste riche.
          → la clé d'une bibliothèque est fusionnée ENTRÉE PAR ENTRÉE (union),
            et l'écriture relit le Drive avant d'envoyer.

   Plus : le compte-rendu d'une capture dit désormais « en file de reprise »
   quand c'est le cas, au lieu d'un « échec » indistinct.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

/* Les sources de src/ s'importent sans extension (résolues par Vite) et
   driveUpload.js est un module navigateur : le crochet le remplace par un
   bouchon pilotable (globalThis.__driveTestMocks — voir _esm_test_hook.mjs). */
register('./_esm_test_hook.mjs', import.meta.url);

/* ── localStorage / window minimal ─────────────────────────────────────────── */
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

/* ── navigateur de dessin minimal : `publishLibraryFigure` RÉDUIT l'image et
      mesure sa transparence — sans ces bouchons il lèverait hors navigateur. ── */
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
const KEYS = await import('./src/utils/workspaceKeyStore.js');
const CON = await import('./src/data/constants.js');
const LIB_SRC = readFileSync('./src/utils/figuresLibrary.js', 'utf8');
const IB = readFileSync('./src/components/ImageBuilder.jsx', 'utf8');
const CSL = readFileSync('./src/components/ChartStarLayer.jsx', 'utf8');
const WKS = readFileSync('./src/utils/workspaceKeyStore.js', 'utf8');
const DU = readFileSync('./src/utils/driveUpload.js', 'utf8');

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

const reset = () => {
  store.clear();
  LIB.writeLibrary([]);
  LIB.writeProjectLibrary('P1', []);
};
const snap = (over = {}) => ({
  canvasW: 180, canvasH: 120, gridCols: 2, gridRows: 1,
  objects: [{ id: 'o1', letter: 'A', imgThumb: 'data:image/png;base64,t' }],
  arrows: [], ...over
});

/* =========================================================================
   1. LA COMPOSITION S'ÉCRIT SANS RENDU : `saveCanvasSnapshot`
   ========================================================================= */
{
  reset();
  const created = LIB.saveCanvasSnapshot({ scope: 'project', projectId: 'P1', label: 'Canvas du jour', canvasData: snap() });
  ok(created.entry && created.entry.id, 'un canvas jamais sauvegardé obtient une entrée de bibliothèque');
  eq(created.updated, false, 'la première écriture CRÉE l’entrée');
  const entry = LIB.readProjectLibrary('P1')[0];
  ok(!!entry.canvasData, 'la composition éditable est dans l’entrée');
  eq(entry.canvasData.gridCols, 2, 'la composition est celle du canvas');
  ok(!!entry.canvasData.updatedAt, 'la composition porte sa date (deux canvas du même nom s’arbitrent par elle)');
  ok(!entry.drive, 'aucun envoi cloud n’a eu lieu : c’est la passe « instantanée »');
  // Le même id, mis à jour sur place : les liens des pages de projet continuent
  // de viser CETTE entrée.
  const again = LIB.saveCanvasSnapshot({ scope: 'project', projectId: 'P1', updateId: entry.id, label: 'Canvas du jour', canvasData: snap({ gridRows: 3 }) });
  eq(again.updated, true, 'la seconde écriture MET À JOUR l’entrée existante');
  eq(LIB.readProjectLibrary('P1').length, 1, 'aucune copie n’est empilée dans la bibliothèque');
  eq(LIB.readProjectLibrary('P1')[0].id, entry.id, 'l’id de l’entrée ne change jamais');
  eq(LIB.readProjectLibrary('P1')[0].canvasData.gridRows, 3, 'la nouvelle composition est bien écrite');
  // Aperçu et copie cloud DÉJÀ connus : ils ne sont pas effacés par une passe
  // « instantanée » (sinon la vignette disparaîtrait en attendant le rendu).
  LIB.writeProjectLibrary('P1', [{
    ...LIB.readProjectLibrary('P1')[0],
    url: 'data:image/png;base64,thumb',
    full: 'https://drive.google.com/file/d/abc/view',
    drive: true,
    driveUrl: 'https://drive.google.com/file/d/abc/view'
  }]);
  const third = LIB.saveCanvasSnapshot({ scope: 'project', projectId: 'P1', updateId: entry.id, label: 'Canvas du jour', canvasData: snap() });
  eq(third.entry.url, 'data:image/png;base64,thumb', 'l’aperçu existant est conservé');
  eq(third.entry.drive, true, 'la marque « copie cloud » est conservée');
  eq(third.entry.driveUrl, 'https://drive.google.com/file/d/abc/view', 'le lien de la copie cloud est conservé');
  eq(LIB.saveCanvasSnapshot({ scope: 'project', projectId: 'P1', label: 'x', canvasData: null }).entry, null,
    'sans composition, rien n’est écrit (un canvas vide ne remplit pas la bibliothèque)');
}

/* =========================================================================
   2. LE SIDECAR ÉDITABLE
   ========================================================================= */
{
  eq(LIB.sidecarNameOfImageName('Canvas_18092026.jpg'), 'Canvas_18092026.jpg.meta.json',
    'le sidecar porte le nom EXACT de l’image (+ .meta.json)');
  eq(LIB.imageNameOfSidecarName('Canvas_18092026.jpg.meta.json'), 'Canvas_18092026.jpg', 'la paire image/sidecar se relit');
  eq(LIB.imageNameOfSidecarName('Canvas_18092026.jpg'), '', 'une image n’est pas un sidecar');
  ok(LIB.isFigureMetaFileName('Fig1.meta.json'), 'un sidecar est reconnu');
  ok(!LIB.isFigureMetaFileName('Fig1.meta.png'), '…et pas une image qui finit par .png');
  const meta = LIB.buildFigureMeta({ label: 'Canvas A', canvasData: snap(), src: { testId: 't1' }, imageName: 'Canvas_A.jpg' });
  eq(meta.kind, LIB.FIGURE_META_KIND, 'le sidecar est marqué (un fichier étranger n’est jamais confondu)');
  eq(meta.imageName, 'Canvas_A.jpg', 'le sidecar dit à quelle image il appartient');
  eq(LIB.buildFigureMeta({ label: 'Capture' }), null, 'une image sans composition ni origine n’a pas besoin de sidecar');
  eq(LIB.parseFigureMeta(JSON.stringify(meta)).canvasData.gridCols, 2, 'le sidecar se relit');
  eq(LIB.parseFigureMeta('pas du json'), null, 'un sidecar illisible ne casse rien');
  eq(LIB.parseFigureMeta(''), null, 'un sidecar vide ne casse rien');
}

/* =========================================================================
   3. LA LISTE DU DOSSIER DRIVE : les sidecars ne sont PAS des images, mais ils
      sont signalés sur l'image qu'ils décrivent
   ========================================================================= */
{
  const listing = [
    { id: 'IMG1', name: 'Canvas_A.jpg', mimeType: 'image/jpeg' },
    { id: 'META1', name: 'Canvas_A.jpg.meta.json', mimeType: 'application/json' },
    { id: 'IMG2', name: 'Capture.png', mimeType: 'image/png' }
  ];
  const items = LIB.libraryItemsFromDriveListing(listing);
  eq(items.length, 2, 'seules les IMAGES deviennent des entrées de bibliothèque');
  eq(items.map((i) => i.metaName), ['Canvas_A.jpg.meta.json', null],
    'l’image qui a un sidecar le sait — les autres non');
  eq(items[0].canvasData, null, 'la composition, elle, viendra du sidecar (relu à la demande)');
}

/* =========================================================================
   4. « ⬇ ADD MISSING FROM DRIVE » RAMÈNE LE CANVAS ÉDITABLE
   ========================================================================= */
{
  reset();
  const sidecar = JSON.stringify(LIB.buildFigureMeta({ label: 'Canvas A', canvasData: snap({ gridRows: 4 }), imageName: 'Canvas_A.jpg' }));
  globalThis.__driveTestMocks = {
    cloud: true,
    resolveDrivePathFromNames: async () => ({ leafId: 'IMG_FOLDER', path: [] }),
    listDriveChildren: async () => ([
      { id: 'IMG1', name: 'Canvas_A.jpg', mimeType: 'image/jpeg', webViewLink: 'https://drive.google.com/file/d/IMG1/view' },
      { id: 'META1', name: 'Canvas_A.jpg.meta.json', mimeType: 'application/json' },
      { id: 'IMG2', name: 'Capture.png', mimeType: 'image/png', webViewLink: 'https://drive.google.com/file/d/IMG2/view' }
    ]),
    downloadDriveFileText: async (id) => (id === 'META1' ? sidecar : '')
  };
  const pulled = await LIB.pullLibraryFromDrive({ scope: 'project', projectId: 'P1', projectName: 'P1' });
  eq(pulled.added, 2, 'les deux images du dossier sont ajoutées');
  eq(pulled.restored, 1, 'le canvas est REPÉRÉ comme restauré (avec sa composition)');
  const canvasEntry = LIB.readProjectLibrary('P1').find((i) => i.canvasData);
  ok(!!canvasEntry, 'l’entrée du canvas revient AVEC sa composition éditable');
  eq(canvasEntry.canvasData.gridRows, 4, '…celle du sidecar, pas une composition vide');
  eq(canvasEntry.metaName, 'Canvas_A.jpg.meta.json', 'l’entrée sait où est son sidecar');
  ok(!!LIB.readProjectLibrary('P1').find((i) => !i.canvasData), 'les images sans sidecar restent de simples images');

  /* Une entrée DÉJÀ présente mais SANS composition (liste reconstruite depuis le
     Drive par une version précédente) est COMPLÉTÉE — c'est le cas du labo. */
  reset();
  LIB.writeProjectLibrary('P1', [{
    id: 'lib_drive_IMG1',
    label: 'Canvas A',
    url: 'https://lh3.googleusercontent.com/d/IMG1',
    full: 'https://drive.google.com/file/d/IMG1/view',
    drive: true,
    driveUrl: 'https://drive.google.com/file/d/IMG1/view',
    src: null,
    canvasData: null,
    addedAt: '2026-09-18T00:00:00.000Z'
  }]);
  const filled = await LIB.pullLibraryFromDrive({ scope: 'project', projectId: 'P1', projectName: 'P1' });
  eq(filled.added, 1, 'l’image encore inconnue est ajoutée');
  eq(filled.restored, 1, 'la composition de l’entrée existante est récupérée');
  const repaired = LIB.readProjectLibrary('P1').find((i) => i.id === 'lib_drive_IMG1');
  ok(!!repaired.canvasData, 'l’entrée existante redevient ÉDITABLE (elle ne reste pas une image)');
  eq(LIB.readProjectLibrary('P1').filter((i) => i.canvasData).length, 1, 'aucun doublon de canvas n’est créé');
  delete globalThis.__driveTestMocks;
}

/* =========================================================================
   5. LA PUBLICATION DÉPOSE LE SIDECAR ET DIT CE QUI S'EST PASSÉ
   ========================================================================= */
{
  reset();
  const uploads = [];
  globalThis.__driveTestMocks = {
    cloud: true,
    uploadLocalFile: async ({ name, mimeType }) => {
      uploads.push({ name, mimeType });
      return { id: `FID_${uploads.length}`, name, driveUrl: `https://drive.google.com/file/d/FID_${uploads.length}/view` };
    },
    takeLastUploadQueueInfo: () => ({ queued: false, reason: 'uploaded' })
  };
  const pub = await LIB.publishLibraryFigure({
    scope: 'project', projectId: 'P1', projectName: 'Projet 1',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    label: 'Canvas A', canvasData: snap()
  });
  eq(uploads.length, 2, 'l’image ET son sidecar partent (deux fichiers)');
  ok(/^Canvas_A\./.test(uploads[0].name), 'l’image garde le nom du libellé');
  eq(uploads[1].name, `${uploads[0].name}.meta.json`, 'le sidecar est nommé d’après l’image');
  eq(uploads[1].mimeType, 'application/json', 'le sidecar est un JSON');
  ok(!!pub.entry.canvasData, 'l’entrée garde la composition éditable de ce poste');
  eq(pub.entry.metaName, `${uploads[0].name}.meta.json`, 'l’entrée retient le nom de son sidecar');
  eq(pub.driveError, '', 'un envoi réussi ne rapporte aucune erreur');

  /* L'envoi échoue mais le fichier part en FILE DE REPRISE : ce n'est pas un
     échec définitif, et le compte-rendu doit le dire. */
  reset();
  globalThis.__driveTestMocks = {
    cloud: true,
    uploadLocalFile: async () => { throw new Error('Cannot reach Google Drive (network error).'); },
    takeLastUploadQueueInfo: () => ({ queued: true, reason: 'error' })
  };
  const failed = await LIB.publishLibraryFigure({
    scope: 'common', projectId: null, projectName: '',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=', label: 'Capture', src: { testId: 't1' }
  });
  eq(failed.drive, null, 'aucune copie cloud n’est rapportée');
  eq(failed.driveQueued, true, '…mais elle est EN FILE DE REPRISE (rien n’est perdu)');
  eq(failed.entry.canvasData, null, 'une capture n’a pas de composition');
  ok(!!failed.entry, 'l’entrée de bibliothèque existe quand même (affichage immédiat)');
  delete globalThis.__driveTestMocks;
}

/* =========================================================================
   6. LA LISTE D'UNE BIBLIOTHÈQUE SE FUSIONNE ENTRÉE PAR ENTRÉE
   ========================================================================= */
{
  const rich = {
    id: 'c1', label: 'Canvas A', url: 'data:image/png;base64,thumb', full: 'https://drive.google.com/file/d/c1/view',
    drive: true, driveUrl: 'https://drive.google.com/file/d/c1/view', src: null,
    canvasData: snap(), metaName: 'Canvas_A.jpg.meta.json', addedAt: '2026-09-18T00:00:00.000Z'
  };
  const poor = {
    id: 'c1', label: 'Canvas A', url: 'https://lh3.googleusercontent.com/d/c1',
    full: 'https://drive.google.com/file/d/c1/view', drive: true, canvasData: null,
    addedAt: '2026-09-18T00:10:00.000Z'
  };
  const pair = LIB.mergeLibraryEntryPair(poor, rich);
  ok(!!pair.canvasData, 'la fusion GARDE la composition, même si l’autre copie est plus récente');
  eq(pair.id, 'c1', 'l’id local est conservé (les liens des pages de projet pointent dessus)');
  eq(pair.metaName, 'Canvas_A.jpg.meta.json', 'les champs de la copie riche sont repris');
  // À richesse égale, la copie LOCALE est gardée (la fusion ne réécrit jamais un
  // libellé de ce poste) ; deux COMPOSITIONS concurrentes, elles, s'arbitrent par
  // leur date — c'est la plus récente que l'on garde.
  const sameRichness = LIB.mergeLibraryEntryPair(
    { id: 'c2', label: 'libellé de ce poste', addedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'c2', label: 'libellé du Drive', addedAt: '2026-09-01T00:00:00.000Z' }
  );
  eq(sameRichness.label, 'libellé de ce poste', 'à richesse égale, la copie locale est conservée');
  const twoCanvases = LIB.mergeLibraryEntryPair(
    { id: 'c3', label: 'Canvas', canvasData: snap({ gridRows: 1, updatedAt: '2026-09-01T00:00:00.000Z' }) },
    { id: 'c3', label: 'Canvas', canvasData: snap({ gridRows: 9, updatedAt: '2026-09-18T00:00:00.000Z' }) }
  );
  eq(twoCanvases.canvasData.gridRows, 9, 'deux compositions concurrentes : la plus récente gagne');
  const olderWins = LIB.mergeLibraryEntryPair(
    { id: 'c4', label: 'Canvas', canvasData: snap({ gridRows: 7, updatedAt: '2026-09-18T00:00:00.000Z' }) },
    { id: 'c4', label: 'Canvas', canvasData: snap({ gridRows: 1, updatedAt: '2026-09-01T00:00:00.000Z' }) }
  );
  eq(olderWins.canvasData.gridRows, 7, '…et la copie plus ancienne ne l’écrase pas');

  const local = [rich, { id: 'x', label: 'Autre', addedAt: '2026-09-17T00:00:00.000Z' }];
  const remote = [
    { id: 'c1', label: 'Canvas A', drive: true, full: 'https://drive.google.com/file/d/c1/view', canvasData: null, addedAt: '2026-09-18T00:10:00.000Z' },
    { id: 'lib_drive_ZZZ', label: 'Capture du Drive', url: 'https://lh3.googleusercontent.com/d/ZZZ', full: 'https://drive.google.com/file/d/ZZZ/view', drive: true, canvasData: null, addedAt: '2026-09-15T00:00:00.000Z' }
  ];
  const merged = LIB.mergeLibraryLists(local, remote);
  eq(merged.map((i) => i.id), ['c1', 'x', 'lib_drive_ZZZ'], 'union : ordre local d’abord, nouveautés à la fin');
  ok(!!merged[0].canvasData, 'l’entrée fusionnée garde la composition');
  const byDrive = LIB.mergeLibraryLists(
    [{ id: 'lib_mine', label: 'Canvas', full: 'https://drive.google.com/file/d/SAME/view', drive: true, canvasData: null }],
    [{ id: 'lib_drive_SAME', label: 'Canvas', full: 'https://drive.google.com/file/d/SAME/view', drive: true, canvasData: snap() }]
  );
  eq(byDrive.length, 1, 'une même figure vue sous deux id n’est pas dupliquée');
  ok(!!byDrive[0].canvasData, '…et sa composition est récupérée');
}

/* =========================================================================
   7. LA CLÉ DU NAVIGATEUR PORTE L'UNION (pas la copie la plus récente)
   ========================================================================= */
{
  ok(LIB.isLibraryListKey('labFiguresLibrary'), 'la bibliothèque commune est une clé de liste');
  ok(LIB.isLibraryListKey('labFiguresLib_prj_1'), 'chaque bibliothèque de projet aussi');
  ok(!LIB.isLibraryListKey('labFiguresDeck_prj_1'), 'les diapositives gardent la règle d’horodatage');
  const localJson = JSON.stringify([{ id: 'c1', label: 'Canvas A', canvasData: snap(), addedAt: '2026-09-18T00:00:00.000Z' }]);
  const remoteJson = JSON.stringify([
    { id: 'c1', label: 'Canvas A', url: 'https://lh3.googleusercontent.com/d/c1', drive: true, canvasData: null, addedAt: '2026-09-18T00:10:00.000Z' },
    { id: 'capture', label: 'Capture', url: 'https://lh3.googleusercontent.com/d/zz', drive: true, addedAt: '2026-09-17T00:00:00.000Z' }
  ]);
  const union = JSON.parse(LIB.mergeLibraryKeyValues('labFiguresLib_P1', localJson, remoteJson));
  eq(union.length, 2, 'l’union des deux listes est écrite');
  ok(!!union[0].canvasData, 'le canvas local n’est pas perdu');
  ok(!!union[1].drive, 'l’image que seul le Drive connaissait est conservée');
  eq(LIB.mergeLibraryKeyValues('labFiguresLib_P1', 'pas du json', remoteJson), remoteJson,
    'une valeur illisible retombe sur la copie du Drive');
  eq(LIB.mergeLibraryKeyValues('labWorkspace_operators', '["a"]', '["b"]'), '',
    'une clé qui n’est pas une liste de bibliothèque n’a pas de fusion par contenu');
}

/* ── Le miroir des clés utilise cette fusion ───────────────────────────────── */
{
  const local = KEYS.buildKeyState({
    values: { labFiguresLib_P1: JSON.stringify([{ id: 'c1', canvasData: snap() }]) },
    meta: { labFiguresLib_P1: 2000 }
  });
  const remote = KEYS.buildKeyState({
    values: { labFiguresLib_P1: JSON.stringify([{ id: 'drive1', label: 'du Drive', drive: true, addedAt: '2026-09-01T00:00:00.000Z' }]) },
    meta: { labFiguresLib_P1: 1000 }
  });
  const { state } = KEYS.mergeKeyStates({ local, remote });
  const published = JSON.parse(state.keys.labFiguresLib_P1.v);
  eq(published.length, 2, 'la clé publiée est l’UNION — la copie locale « plus récente » n’écrase plus l’autre');
  ok(published.some((i) => i.canvasData), 'le canvas local est publié');
  ok(published.some((i) => i.id === 'drive1'), 'l’entrée du Drive est publiée');
  const stamp = KEYS.mergeKeyStates({
    local: KEYS.buildKeyState({ values: { labSetting: 'vieux' }, meta: { labSetting: 1000 } }),
    remote: KEYS.buildKeyState({ values: { labSetting: 'neuf' }, meta: { labSetting: 2000 } })
  });
  eq(stamp.adopt.labSetting, 'neuf', 'un réglage suit toujours « la copie la plus récente gagne »');
}

/* =========================================================================
   7 bis. SUPPRIMER EST UN GESTE EXPLICITE : la fusion ne le défait pas
   ========================================================================= */
{
  reset();
  ok(LIB.isLibraryTrashKey('labFiguresTrash_P1'), 'la liste des suppressions est une clé à part');
  eq(LIB.libraryTrashKey('P1'), 'labFiguresTrash_P1', 'une liste par portée');
  const gone = { id: 'lib_1', label: 'Capture', full: 'https://drive.google.com/file/d/FID9/view', drive: true };
  eq(LIB.trashIdsOfEntry(gone).sort(), ['d:FID9', 'lib_1'], 'on note l’id ET le fichier cloud de l’image supprimée');
  eq(LIB.trashIdsOfEntry({ id: 'lib_2', canvasData: null }).length, 1, 'sans fichier cloud, seul l’id est noté');

  // Une suppression à la main écrit les deux côtés (liste + pierre tombale).
  LIB.writeProjectLibrary('P1', [gone, { id: 'lib_2', label: 'à garder', drive: true, full: 'https://drive.google.com/file/d/KEEP/view' }]);
  LIB.removeProjectLibraryItem('P1', 'lib_1');
  eq(LIB.readProjectLibrary('P1').map((i) => i.id), ['lib_2'], 'l’image quitte la liste');
  ok(LIB.readLibraryTrash('P1').includes('lib_1'), '…et la suppression est notée');

  // L'union ne la ramène pas : la copie du Drive contient encore l'entrée.
  const localJson = localStorage.getItem('labFiguresLib_P1');
  const remoteJson = JSON.stringify([gone, { id: 'lib_2', label: 'à garder', drive: true, full: 'https://drive.google.com/file/d/KEEP/view' }]);
  const union = JSON.parse(LIB.mergeLibraryKeyValues('labFiguresLib_P1', localJson, remoteJson));
  eq(union.map((i) => i.id), ['lib_2'], 'la fusion ne ressuscite pas une image supprimée');
  eq(LIB.mergeLibraryTrashValues('labFiguresTrash_P1', '["a"]', '["b"]'), '["a","b"]',
    'les suppressions des deux postes s’additionnent');
  eq(LIB.mergeLibraryTrashValues('labFiguresTrash_P1', '', '["b"]'), '["b"]', '…et une liste absente est reprise');
  eq(LIB.applyLibraryTrash([gone, { id: 'lib_3' }], ['d:FID9']).map((i) => i.id), ['lib_3'],
    'le fichier cloud suffit à écarter l’image supprimée, même sous un autre id');

  /* « ⬇ Add missing from Drive » ne la ramène pas non plus. */
  reset();
  LIB.rememberLibraryTrash('P1', ['d:IMG1']);
  globalThis.__driveTestMocks = {
    cloud: true,
    resolveDrivePathFromNames: async () => ({ leafId: 'IMG_FOLDER', path: [] }),
    listDriveChildren: async () => ([
      { id: 'IMG1', name: 'Image retiree.jpg', mimeType: 'image/jpeg', webViewLink: 'https://drive.google.com/file/d/IMG1/view' },
      { id: 'IMG2', name: 'Autre.png', mimeType: 'image/png', webViewLink: 'https://drive.google.com/file/d/IMG2/view' }
    ]),
    downloadDriveFileText: async () => ''
  };
  const afterDelete = await LIB.pullLibraryFromDrive({ scope: 'project', projectId: 'P1', projectName: 'P1' });
  eq(afterDelete.found, 2, 'le dossier contient bien deux fichiers');
  eq(afterDelete.added, 1, 'seul celui qui n’a PAS été supprimé est ajouté');
  eq(LIB.readProjectLibrary('P1').map((i) => i.label), ['Autre'], 'l’image retirée ne revient pas dans la liste');
  delete globalThis.__driveTestMocks;
}

/* =========================================================================
   8. LES SOURCES : les gestes que l'utilisateur voit
   ========================================================================= */
{
  // (a) l'Image Builder sauvegarde TOUT SEUL, et au moment de quitter la page
  has(IB, 'AUTO_SNAPSHOT_MS = 2500', 'la composition s’écrit peu après la dernière modification');
  has(IB, 'AUTO_PUBLISH_QUIET_MS = 8000', '…et l’image part au cloud une fois le canvas calme');
  has(IB, 'AUTO_PUBLISH_MS = 60000', 'au plus un envoi cloud par minute (pas de rendu pour une frappe)');
  has(IB, "window.addEventListener('pagehide', flush);", 'quitter la page écrit la composition');
  has(IB, "document.addEventListener('visibilitychange', onHide);", '…et passer sur un autre onglet aussi');
  has(IB, 'saveCanvasSnapshot({', 'la passe instantanée écrit la composition éditable, sans rendu');
  has(IB, 'updateId: known ? known.id : null,', 'elle MET À JOUR l’entrée connue (aucune copie empilée)');
  has(IB, 'rememberCanvasEntry(target, res.entry);', 'l’entrée créée devient celle du canvas');
  has(IB, 'const autoSaveScope = () => {', 'la destination est choisie (canvas repris › projet › RIEN : jamais le dataset pour un canvas neuf)');
  has(IB, 'autoSaveBadgeInfo', 'l’utilisateur VOIT que la composition est sauvegardée');
  has(IB, '⏳ cloud transfer queued', '…y compris quand l’envoi est en attente de reprise');
  has(IB, "setAutoSaveNote(pub.drive && pub.drive.id ? 'cloud' : (pub.driveQueued ? 'queued' : 'browser'));",
    'la pastille est mise à jour après un envoi cloud');
  has(IB, 'res.restored', '« Add missing from Drive » annonce les canvas récupérés');
  // (b) côté figures : le sidecar, la raison d'un échec, la relecture
  has(LIB_SRC, 'await uploadFigureMetaToDrive({', 'la publication dépose le sidecar éditable');
  has(LIB_SRC, 'export const saveCanvasSnapshot = ({', 'la composition s’écrit sans rendu ni envoi');
  has(LIB_SRC, 'takeLastUploadQueueInfo()', 'la publication sait si le fichier est en file de reprise');
  has(LIB_SRC, 'driveError, driveQueued', 'le compte-rendu de publication porte la raison');
  has(LIB_SRC, 'const meta = await fetchFigureMetaFromDrive(fileId)', '« Add missing » relit les sidecars');
  has(LIB_SRC, 'registerKeyValueMerger(isLibraryListKey, mergeLibraryKeyValues);',
    'la fusion par contenu est enregistrée auprès du miroir des clés');
  // (c) le miroir des clés relit le Drive AVANT d'écrire
  has(WKS, 'const remote = await readKeyState();', 'l’écriture des clés relit le Drive d’abord');
  has(WKS, 'state = mergeKeyStates({ local, remote }).state;', '…et publie l’union, jamais sa seule copie');
  has(WKS, 'export const registerKeyValueMerger = (matcher, merge) => {', 'les fusionneurs par contenu sont enregistrables');
  // (d) driveUpload retient le sort d'un envoi échoué
  has(DU, 'export const takeLastUploadQueueInfo = () => {', 'le sort d’un upload est exposé à l’appelant');
  has(DU, "reason: last ? 'uploaded' : (deletedTarget ? 'path_deleted' : 'not_queued'),", '…et il est renseigné sur le chemin nominal');
  // (e) la capture d'un graphique d'expérience dit enfin POURQUOI
  has(CSL, 'driveQueued', 'le message de capture distingue « en attente » d’un échec');
  has(CSL, 'it uploads by itself as soon as Drive answers, nothing is lost', '…et rassure : rien n’est perdu');
  has(CSL, 'kept in this browser (Google Drive / Nextcloud not connected)', 'le cas « cloud non connecté » est nommé');
  ok(!CSL.includes('Drive upload failed — browser copy only'), 'l’ancien message trompeur a disparu');
  // (f) la vignette d'une entrée de bibliothèque est TOUJOURS dessinable :
  //     `url` (copie locale) et `full` (copie cloud) peuvent manquer l'une OU
  //     l'autre, et un lien de partage Drive ne s'affiche pas dans un <img>.
  has(IB, '{libThumbOf(item)',
    'la carte prend la copie locale, sinon la copie cloud RENDUE AFFICHABLE');
  has(IB, 'const libThumbOf = (item) => getRenderableDriveUrl(',
    '…par le même réécrivain d’URL que toute l’appli, et avec le panneau de la composition en dernier recours');
  has(IB, 'item.url || item.full || canvasPreviewFromComposition(item.canvasData)',
    '…(un canvas restauré de son fichier n’a QUE sa composition à montrer)');
  has(IB, 'findCanvasEntryByKey, canvasPreviewFromComposition',
    'l’Image Builder importe l’aperçu de composition');
  has(IB, '"No preview yet', '…et sans rien à dessiner, un cadre neutre (jamais une vignette cassée)');
  has(IB, '💾 Save now forces it right now', '…qui dit comment forcer le rendu tout de suite');
  has(IB, '⏳ image on its way', 'une composition pas encore rendue le DIT aussi');
  has(IB, "{item.drive ? 'High-Res' : 'this browser'}", '…et la carte dit si la haute résolution est au cloud ou ici');
  has(IB, "import { getRenderableDriveUrl } from '../data/constants';",
    'l’Image Builder réutilise le réécrivain d’URL de toute l’appli');
  has(IB, 'const shown = getRenderableDriveUrl(it.url || it.full);',
    'une figure posée dont la vignette locale a disparu se dessine depuis le cloud');
  // …et la règle elle-même, éprouvée sur des cas réels (pas seulement le source)
  eq(CON.getRenderableDriveUrl('https://drive.google.com/file/d/ABC123/view?usp=sharing'),
    'https://lh3.googleusercontent.com/d/ABC123', 'un lien de partage Drive devient une URL affichable');
  eq(CON.getRenderableDriveUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA',
    'une vignette locale reste INCHANGÉE (le cas normal n’est pas touché)');
  eq(CON.getRenderableDriveUrl(null), '', 'sans aucune copie, il n’y a rien à dessiner (cadre neutre)');
}

/* =========================================================================
   9. LES CANVAS VIVENT DANS UN PROJET — ET SE REMONTENT TOUT SEULS
      « Canvases should not be saved in the library but only in the associated
        project and should be available without clicking on “restore from the
        drive” button » — les deux moitiés de la demande :
      9a. un canvas NEUF n'est plus écrit dans la bibliothèque PARTAGÉE du
          dataset : sa place est la bibliothèque du projet qui le porte ;
      9b. « 💾 Save now » sauve TOUT DE SUITE (image + copie éditable) au lieu
          d'attendre la passe automatique (2,5 s de calme, puis 8 s, puis au
          plus un envoi par minute) ;
      9c. la page du projet relit son dossier d'images d'elle-même quand un
          canvas est attendu et manque : plus besoin de cliquer
          « ⬇ Add missing figures from Drive » pour VOIR ses compositions.
   ========================================================================= */
{
  const PD = readFileSync('./src/components/AppModules/projectDetailModule.jsx', 'utf8').replace(/\r\n/g, '\n');
  // ── 9a. plus de canvas neuf dans la bibliothèque partagée ────────────────
  has(IB, 'if (!target && !canvasEntryFor(null)) {',
    'sans projet, la sauvegarde automatique n’écrit RIEN dans la bibliothèque partagée');
  has(IB, "setAutoSaveNote('noproject');", '…la pastille dit que le canvas n’a pas encore de projet');
  has(IB, '🗂 no project yet', '…et invite à en choisir un');
  has(IB, 'is never stored in the shared dataset library',
    '« Save now » sans projet le DIT au lieu d’écrire ailleurs en douce');
  has(IB, 'Project that owns it', 'le dialogue de sauvegarde demande LE PROJET');
  ok(!IB.includes('🌐 Dataset library — shared by every project'),
    '…et la bibliothèque du dataset n’est plus proposée comme destination d’un canvas');
  has(IB, "setLibraryTab('project');", 'après un enregistrement, la bibliothèque s’ouvre sur l’onglet du projet');
  has(IB, 'canvas HISTORIQUE du dataset', 'un canvas DÉJÀ stocké dans le dataset continue d’être mis à jour là où il est');
  // ── 9b. un bouton qui n’attend pas ──────────────────────────────────────
  has(IB, '>💾 Save now{saveBusy ?', 'la barre d’outils porte « 💾 Save now »');
  has(IB, 'without waiting for the automatic save', '…dont l’infobulle dit qu’il n’attend PAS la passe automatique');
  has(IB, 'Saving the canvas (image + editable copy, right now)',
    '…et qui annonce le rendu + l’envoi immédiats');
  // ── 9c. les compositions reviennent sans rien cliquer ───────────────────
  has(PD, 'const autoCanvasPullRef = useRef(new Set());',
    'la page du projet relit le dossier d’images UNE fois par projet et par session');
  has(PD, 'const missing = expected.filter((id) => !known.has(id));',
    '…quand un canvas est ATTENDU (une figure de la page porte son canvasId) et manque');
  has(PD, 'if (!missing.length && known.size) return;',
    '…ou quand la bibliothèque du projet n’a AUCUN canvas (poste neuf, navigateur vidé)');
  has(PD, 'const res = await pullLibraryFromDrive(figDriveScope());',
    '…avec la MÊME lecture additive que « ⬇ Add missing figures from Drive »');
  has(PD, 'nothing to click.', '…et le résultat est annoncé sans rien demander à l’utilisateur');
}

console.log(`✅ _canvas_autosave_test : ${passed} vérifications passées`);




