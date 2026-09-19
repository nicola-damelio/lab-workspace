/* =========================================================================
   _canvas_identity_test.mjs — « LE CANVAS EST SAUVEGARDÉ PÉRIODIQUEMENT MAIS
   PAS ÉCRASÉ : j'ai plusieurs canvas enregistrés dans le projet »

   La sauvegarde automatique de l'Image Builder écrit la composition dans
   l'entrée de bibliothèque de SON canvas et la met à jour SUR PLACE… tant que
   l'éditeur se souvient de son id. Or ce souvenir ne vivait que dans l'état du
   composant : un aller-retour par un autre module, un rechargement de page, un
   autre poste, une liste de bibliothèque allégée — et chaque passage de la
   sauvegarde AJOUTAIT une copie du même canvas dans « 🖼 Saved canvases ».

   Trois verrous, trois groupes de vérifications :

     1. la composition porte désormais SA clé (`canvasData.canvasKey`) et deux
        copies du même canvas fusionnent au lieu de s'empiler
        (canvasKeyOfEntry / libraryEntryIdentity / mergeLibraryList) ;
     2. la sauvegarde RETROUVE son entrée par cette clé quand l'id est perdu
        (saveCanvasSnapshot / publishLibraryFigure / findCanvasEntryByKey), et
        l'Image Builder persiste l'identité avec la composition ;
     3. ce qu'une version précédente a laissé se nettoie en un clic sur la page
        du projet (find/count/removeCanvasDuplicates), en gardant la composition
        la plus récente ET les entrées que les figures référencent.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

/* Les sources de src/ s'importent sans extension (résolues par Vite) et
   driveUpload.js est un module navigateur : le crochet le remplace par un
   bouchon pilotable (voir _esm_test_hook.mjs). */
register('./_esm_test_hook.mjs', import.meta.url);

/* ── localStorage / window / canvas minimaux ──────────────────────────────── */
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

const K1 = 'cv_2026_ab12';
const reset = () => {
  store.clear();
  LIB.writeLibrary([]);
  LIB.writeProjectLibrary('P1', []);
  LIB.writeProjectLibrary('P2', []);
};
const snap = (over = {}) => ({
  canvasW: 180, canvasH: 120, gridCols: 2, gridRows: 1,
  objects: [{ id: 'o1', letter: 'A', imgThumb: 'data:image/png;base64,t' }],
  arrows: [], ...over
});


/* =========================================================================
   1. LA CLÉ DE COMPOSITION (l'identité qui survit à tout)
   ========================================================================= */
{
  eq(LIB.canvasKeyOfEntry({ id: 'e1', canvasData: { canvasKey: K1 } }), K1, 'la clé de composition se lit dans la composition');
  eq(LIB.canvasKeyOfEntry({ id: 'e1' }), '', 'une image sans composition n’a pas de clé');
  eq(LIB.canvasKeyOfEntry({ id: 'e1', canvasData: { canvasKey: '  ' } }), '', 'une clé vide ne compte pas');

  eq(LIB.libraryEntryIdentity({ id: 'e1', canvasData: { canvasKey: K1 } }), `canvas:${K1}`,
    'deux copies du même canvas sont reconnues par leur clé');
  eq(
    LIB.libraryEntryIdentity({ id: 'e1', canvasData: { canvasKey: K1 } }),
    LIB.libraryEntryIdentity({ id: 'e9', canvasData: { canvasKey: K1 } }),
    '…MÊME quand leurs id diffèrent (c’est là que les copies s’empilaient)'
  );
  eq(LIB.libraryEntryIdentity({ id: 'e1' }), 'id:e1', 'sans clé de composition, l’id tranche');

  /* La fusion : le même canvas relu du Drive (autre id) ne crée plus une copie. */
  const merged = LIB.mergeLibraryList(
    [{ id: 'mine', label: 'Canvas 18/09/2026', url: 'data:image/png;base64,mine', canvasData: { canvasKey: K1, canvasW: 180 } }],
    [{ id: 'lib_drive_X', label: 'Canvas 18/09/2026', url: 'https://lh3.googleusercontent.com/d/X', drive: true, canvasData: { canvasKey: K1, canvasW: 180 } }]
  );
  eq(merged.list.length, 1, 'une relecture du dossier Drive ne crée pas une seconde copie du même canvas');
  eq(merged.list[0].id, 'mine', 'l’entrée locale garde son id (les liens des pages de projet continuent de la viser)');
  eq(merged.added, 0, '…et rien n’est « ajouté » à la bibliothèque');

  const other = LIB.mergeLibraryList(
    [{ id: 'mine', canvasData: { canvasKey: K1 } }],
    [{ id: 'lib_drive_Y', canvasData: { canvasKey: 'cv_autre' } }]
  );
  eq(other.list.length, 2, 'un canvas DIFFÉRENT reste une entrée à part');
  eq(other.added, 1, '…et compte comme un ajout');

  /* L'union des listes (miroir des clés / autre poste) suit la même règle. */
  const union = LIB.mergeLibraryLists(
    [{ id: 'mine', canvasData: { canvasKey: K1 } }],
    [{ id: 'lib_drive_Z', canvasData: { canvasKey: K1 } }]
  );
  eq(union.length, 1, 'l’union de deux postes ne garde qu’une entrée par canvas');
}

/* =========================================================================
   2. LA SAUVEGARDE RETROUVE SON ENTRÉE PAR LA CLÉ
   ========================================================================= */
{
  reset();
  const first = LIB.saveCanvasSnapshot({ scope: 'project', projectId: 'P1', label: 'Canvas 18/09/2026', canvasKey: K1, canvasData: snap() });
  ok(first.entry && first.entry.id, 'un canvas jamais sauvegardé obtient une entrée de bibliothèque');
  eq(first.updated, false, 'la première écriture CRÉE l’entrée');
  eq(first.entry.canvasData.canvasKey, K1, 'la composition écrite porte sa clé');
  eq(LIB.findCanvasEntryByKey({ scope: 'project', projectId: 'P1', canvasKey: K1 }).id, first.entry.id,
    'la clé retrouve l’entrée de ce canvas');

  // L’id est PERDU (page rechargée, autre poste) : la passe suivante ne doit pas
  // ajouter une copie.
  const again = LIB.saveCanvasSnapshot({ scope: 'project', projectId: 'P1', label: 'Canvas 18/09/2026', canvasKey: K1, canvasData: snap({ gridRows: 5 }) });
  eq(again.updated, true, 'sans se souvenir de l’id, la sauvegarde MET À JOUR l’entrée du même canvas');
  eq(LIB.readProjectLibrary('P1').length, 1, 'aucune copie n’est empilée');
  eq(LIB.readProjectLibrary('P1')[0].id, first.entry.id, 'l’id de l’entrée ne change pas');
  eq(LIB.readProjectLibrary('P1')[0].canvasData.gridRows, 5, 'la nouvelle composition est bien écrite');

  // Un canvas à la clé DIFFÉRENTE a bien sa propre entrée (aucune confusion).
  const second = LIB.saveCanvasSnapshot({ scope: 'project', projectId: 'P1', label: 'Figure 2', canvasKey: 'cv_autre', canvasData: snap() });
  eq(second.updated, false, 'un autre canvas crée sa propre entrée');
  eq(LIB.readProjectLibrary('P1').length, 2, 'deux canvas, deux entrées');
  eq(second.entry.canvasData.canvasKey, 'cv_autre', '…avec sa clé');

  // La portée compte : la même clé dans une autre bibliothèque est une autre copie.
  eq(LIB.findCanvasEntryByKey({ scope: 'common', canvasKey: K1 }), null, 'la clé de P1 n’est pas dans la bibliothèque du dataset');
  eq(LIB.findCanvasEntryByKey({ scope: 'project', projectId: 'P1', canvasKey: 'inconnue' }), null, 'une clé inconnue ne trouve rien');
  eq(LIB.findCanvasEntryByKey({ scope: 'project', projectId: 'P1', canvasKey: '' }), null, 'sans clé, rien n’est cherché');
}

/* =========================================================================
   3. UNE ENTRÉE HISTORIQUE (SANS CLÉ) REÇOIT LA CLÉ À LA PREMIÈRE SAUVEGARDE
   ========================================================================= */
{
  reset();
  const legacy = LIB.saveCanvasSnapshot({ scope: 'project', projectId: 'P1', label: 'Canvas historique', canvasData: snap() });
  ok(!LIB.canvasKeyOfEntry(legacy.entry), 'une entrée écrite sans clé n’en invente pas');
  const stamped = LIB.saveCanvasSnapshot({ scope: 'project', projectId: 'P1', updateId: legacy.entry.id, label: 'Canvas historique', canvasKey: K1, canvasData: snap() });
  eq(stamped.entry.canvasData.canvasKey, K1, 'la sauvegarde suivante pose la clé de composition');
  eq(LIB.readProjectLibrary('P1').length, 1, '…sans devenir une seconde entrée');
  eq(LIB.findCanvasEntryByKey({ scope: 'project', projectId: 'P1', canvasKey: K1 }).id, legacy.entry.id,
    'à partir de là, la clé retrouve l’entrée historique');

/* =========================================================================
   4. CE QU'UNE VERSION PRÉCÉDENTE A LAISSÉ SE NETTOIE (par libellé, puis par clé)
   ========================================================================= */
const legacyEntry = (id, at, rows, over = {}) => ({
  id,
  label: 'Canvas 18/09/2026',
  url: `data:image/png;base64,${id}`,
  addedAt: at,
  canvasData: { canvasW: 180, gridRows: rows, updatedAt: at },
  ...over
});

{
  // (a) Des copies SANS clé (canvas enregistré avant) : trois copies du même nom.
  reset();
  LIB.writeProjectLibrary('P1', [
    legacyEntry('c1', '2026-09-18T10:00:00.000Z', 1),
    legacyEntry('c2', '2026-09-18T10:05:00.000Z', 2),
    legacyEntry('c3', '2026-09-18T10:09:00.000Z', 3)
  ]);
  eq(LIB.countCanvasDuplicates({ allowedProjectIds: ['P1'] }), 2, 'trois copies du même canvas : deux à retirer');
  const groups = LIB.findCanvasDuplicates({ allowedProjectIds: ['P1'] });
  eq(groups.length, 1, 'elles forment UN groupe');
  eq(groups[0].keepId, 'c3', 'la copie la plus récente est gardée (c’est le travail)');
  eq(groups[0].removeIds.sort(), ['c1', 'c2'], 'les deux autres partent');
  eq(LIB.countCanvasDuplicates({ allowedProjectIds: ['AUTRE'] }), 0,
    'la bibliothèque d’un projet qu’on n’ouvre pas n’est jamais touchée');

  // (b) Deux copies seulement : c’est un travail refait à la main, on n’y touche pas.
  LIB.writeProjectLibrary('P1', [legacyEntry('d1', '2026-09-18T10:00:00.000Z', 1), legacyEntry('d2', '2026-09-18T10:05:00.000Z', 2)]);
  eq(LIB.countCanvasDuplicates({ allowedProjectIds: ['P1'] }), 0, 'deux copies du même nom restent intactes');

  // (c) Le nettoyage : la composition la plus récente survit, l’id gardé ne change
  // pas, et la copie retirée est notée (la fusion ne la ramènera pas).
  reset();
  LIB.writeProjectLibrary('P1', [
    legacyEntry('c1', '2026-09-18T10:00:00.000Z', 1),
    legacyEntry('c2', '2026-09-18T10:05:00.000Z', 2),
    legacyEntry('c3', '2026-09-18T10:09:00.000Z', 3)
  ]);
  const rm = LIB.removeCanvasDuplicates({ allowedProjectIds: ['P1'] });
  eq(rm.removed, 2, 'les deux copies retirées sont comptées');
  eq(LIB.readProjectLibrary('P1').map((i) => i.id), ['c3'], 'une seule entrée reste');
  eq(LIB.readProjectLibrary('P1')[0].canvasData.gridRows, 3, 'la composition la plus récente est celle qui reste');
  eq(LIB.readLibraryTrash('P1').sort(), ['c1', 'c2'], 'les copies retirées sont notées comme supprimées');
  eq(LIB.applyLibraryTrash([legacyEntry('c1', 'x', 1)], LIB.readLibraryTrash('P1')).length, 0,
    '…donc une fusion ne les ressuscite pas');

  // (d) Une entrée qu’une figure référence est GARDÉE (son id EST le lien
  //     « ✏️ Modify in Image Builder ») — et elle reçoit la composition récente.
  reset();
  LIB.writeProjectLibrary('P1', [
    legacyEntry('c1', '2026-09-18T10:00:00.000Z', 1),
    legacyEntry('c2', '2026-09-18T10:05:00.000Z', 2),
    legacyEntry('c3', '2026-09-18T10:09:00.000Z', 3)
  ]);
  const kept = LIB.removeCanvasDuplicates({ allowedProjectIds: ['P1'], keepIds: ['c1'] });
  eq(LIB.readProjectLibrary('P1').map((i) => i.id), ['c1'], 'l’entrée référencée reste');
  eq(LIB.readProjectLibrary('P1')[0].canvasData.gridRows, 3, '…avec la composition la plus récente');
  eq(kept.removed, 2, 'les deux autres partent');

  // (e) Deux copies d’un même canvas PAR LA CLÉ (celui qui a perdu son id) : deux
  //     suffisent, elles sont forcément la même toile.
  reset();
  LIB.writeProjectLibrary('P1', [
    { id: 'k1', label: 'Figure 1', canvasData: { canvasKey: K1, gridRows: 1, updatedAt: '2026-09-18T10:00:00.000Z' } },
    { id: 'k2', label: 'Figure 1', canvasData: { canvasKey: K1, gridRows: 2, updatedAt: '2026-09-18T10:06:00.000Z' } }
  ]);
  eq(LIB.countCanvasDuplicates({ allowedProjectIds: ['P1'] }), 1, 'même clé : une copie de trop, dès deux copies');
  eq(LIB.findCanvasDuplicates({ allowedProjectIds: ['P1'] })[0].keepId, 'k2', 'la plus récente reste');

  // (f) Deux canvas DIFFÉRENTS qui portent le même nom ne sont JAMAIS fusionnés.
  reset();
  LIB.writeProjectLibrary('P1', [
    { id: 'k1', label: 'Figure 1', canvasData: { canvasKey: 'cv_a', gridRows: 1, updatedAt: '2026-09-18T10:00:00.000Z' } },
    { id: 'k2', label: 'Figure 1', canvasData: { canvasKey: 'cv_b', gridRows: 2, updatedAt: '2026-09-18T10:06:00.000Z' } }
  ]);
  eq(LIB.countCanvasDuplicates({ allowedProjectIds: ['P1'] }), 0, 'des clés différentes = des canvas différents, même nom ou pas');

  // (g) Le balayage sans limite couvre aussi la bibliothèque commune du dataset.
  reset();
  LIB.writeLibrary([
    legacyEntry('g1', '2026-09-18T10:00:00.000Z', 1),
    legacyEntry('g2', '2026-09-18T10:05:00.000Z', 2),
    legacyEntry('g3', '2026-09-18T10:09:00.000Z', 3)
  ]);
  eq(LIB.countCanvasDuplicates(), 2, 'la bibliothèque partagée est balayée elle aussi');
  eq(LIB.removeCanvasDuplicates().removed, 2, '…et se nettoie de la même façon');
  eq(LIB.readLibrary().length, 1, 'une seule entrée reste dans la bibliothèque partagée');
  eq(LIB.readProjectLibrary('P1').length, 0, 'le projet voisin n’a pas été touché');
}


/* =========================================================================
   5. L'ÉDITEUR : l'identité de la composition VOYAGE avec elle
   ========================================================================= */
{
  has(IB, 'canvasKey, canvasEntries, canvasHome, canvasLabel };',
    'le payload persisté (localStorage + cache de session) porte l’identité de la composition');
  has(IB, 'const initialCanvasIdentity = useMemo(',
    'l’identité est SEMÉE avant le premier rendu (sinon la première écriture du payload l’effacerait)');
  has(IB, '() => storedCanvasIdentity(storageKey),',
    '…depuis le payload persisté (cache de session puis localStorage)');
  has(IB, "const [canvasKey, setCanvasKey] = useState(() => initialCanvasIdentity.canvasKey || uid('cv'));",
    'la clé de composition est semée avec les états');
  has(IB, 'const [canvasEntries, setCanvasEntries] = useState(() => initialCanvasIdentity.canvasEntries || {});',
    'les entrées de bibliothèque aussi');
  has(IB, 'const identity = canvasIdentityOf(data);',
    'l’effet de restauration reprend la même identité (et la pose quand on change de projet)');
  has(IB, "setCanvasKey(identity.canvasKey || uid('cv'));", '…clé de composition comprise');
  has(IB, 'if (!restoredIdentity) {', 'seul un canvas NEUF repart sans entrée connue');
  has(IB, 'const canvasEntryFor = (scopeProjectId) => {',
    'l’entrée du canvas se retrouve par sa clé quand l’id est oublié');
  ok(IB.split('const known = canvasEntryFor(target);').length - 1 >= 2,
    'la publication ET la passe instantanée s’appuient sur cette recherche');
  has(IB, 'const homeEntry = useMemo(', 'le badge interroge la clé sans relire la bibliothèque à chaque rendu');
  has(IB, 'setCanvasKey(canvasKeyOfEntry(item) || uid(\'cv\'));',
    'rouvrir un canvas lui rend SA clé (une neuve pour un canvas historique)');
  has(IB, 'setCanvasEntries({});\n    setCanvasLabel(\'\');\n    setCanvasKey(uid(\'cv\'));',
    '« ➕ New image » détache ET donne une clé neuve (sinon il écraserait l’ancien canvas)');
  has(IB, 'setCanvasEntries({}); setCanvasLabel(\'\'); setCanvasKey(uid(\'cv\'));',
    '« Clear Canvas » aussi');
  has(IB, 'canvasKey,\n      canvasW, canvasH, gridCols, gridRows, showPanelBorders, showGridLines, keepAspect, globalCaption,',
    'la clé part avec chaque copie de la composition (sauvegarde automatique incluse)');
  has(IB, 'canvasKey,\n        canvasW, canvasH, gridCols, gridRows, showPanelBorders, showGridLines, keepAspect, globalCaption,',
    '…et avec la composition publiée (donc dans le sidecar du Drive)');

  has(LIB_SRC, 'export const canvasKeyOfEntry = (i) =>',
    'figuresLibrary expose la clé de composition');
  has(LIB_SRC, 'const prev = list.find((i) => i.id === updateId) || prevByKey;',
    'une publication dont l’id est perdu met à jour l’entrée qui porte la même composition');
  has(LIB_SRC, 'export const countCanvasDuplicates = (opts = {}) =>',
    'le compte des copies est une fonction pure de figuresLibrary');
  has(LIB_SRC, 'export const removeCanvasDuplicates = (opts = {}) => {',
    'le nettoyage aussi — il n’est appelé que par un clic');
  has(LIB_SRC, 'if (allowed && !allowed(pid)) return;   // la bibliothèque',
    'le balayage ne touche que les projets de l’utilisateur');
}

/* =========================================================================
   6. LA PAGE DU PROJET : voir les copies et les retirer en un clic
   ========================================================================= */
{
  has(PD, 'const referencedCanvasIds = () => {', 'la page projet sait quelles entrées ses figures référencent');
  has(PD, 'const canvasDupCount = useMemo(() => {', 'elle COMPTE les copies du même canvas');
  has(PD, 'countCanvasDuplicates({ allowedProjectIds: [project.id], keepIds: referencedCanvasIds() })',
    '…dans ce projet seulement, en épargnant les entrées référencées');
  has(PD, 'removeCanvasDuplicates({ allowedProjectIds: [project.id], keepIds })',
    'et le clic appelle le nettoyage du projet');
  has(PD, '🧹 Remove {canvasDupCount} duplicate canvas cop', 'un bouton le propose (seulement s’il y en a)');
  has(PD, 'makeUploadImage, uploadFigureToDrive, renameFigureOnDrive,\n  countCanvasDuplicates, removeCanvasDuplicates',
    'les deux fonctions viennent de figuresLibrary (et le renommage sur le Drive aussi)');
}

console.log(`✅ _canvas_identity_test : ${passed} vérifications passées`);

}
