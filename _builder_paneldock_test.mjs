/* =========================================================================
   _builder_paneldock_test.mjs — « it would be nice to be able to move the object
   window from the bottom to the top or to the sides ».

   La fenêtre de l'objet vivait SOUS le canvas, et nulle part ailleurs. Elle se
   pose maintenant où l'utilisateur la veut : en bas (sa place historique), en
   haut, ou d'un côté — où elle devient une colonne étroite et défilante, le
   canvas gardant le reste de la largeur et la fenêtre toute la hauteur.

   DEUX POINTS COMPTENT autant que le déplacement lui-même :
     • c'est un réglage d'ÉCRAN, pas de figure. La place est gardée PAR
       NAVIGATEUR (localStorage, comme l'échelle d'affichage — utils/uiScale.js)
       et n'est écrite dans AUCUN fichier : la composition, le sidecar du Drive
       et les documents de projet ne changent pas d'un octet ;
     • la fenêtre n'est écrite QU'UNE FOIS (`objectWindowNormal` /
       `fullscreenObjectWindow`) et simplement POSÉE à l'endroit demandé : les
       deux affichages ne peuvent pas diverger, et rien n'est dupliqué.

   Vérifié ici sur le module RÉEL (utils/objectWindowDock.js — les quatre places,
   la relecture, une valeur inconnue, un navigateur sans stockage) puis sur
   ImageBuilder.jsx (les boutons, la place dans les deux affichages, et le fait
   que la barre absolue qui recouvrait le canvas a bien disparu).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const DOCK = await import('./src/utils/objectWindowDock.js');
const IB = readFileSync('./src/components/ImageBuilder.jsx', 'utf8').replace(/\r\n/g, '\n');

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (hay, needle, what) => {
  assert.ok(String(hay).includes(needle), `${what}\n  fragment absent : ${needle}`);
  passed += 1;
};

/* ══ 1. LES QUATRE PLACES, ET LEUR VOCABULAIRE ═══════════════════════════ */
eq(DOCK.OBJECT_WINDOW_DOCKS, ['bottom', 'top', 'left', 'right'], 'les quatre places offertes');
eq(DOCK.OBJECT_WINDOW_DOCK_DEFAULT, 'bottom', 'la place historique reste le bas');
eq(DOCK.OBJECT_WINDOW_DOCK_KEY, 'labObjectWindowDock', 'la clé est celle du NAVIGATEUR (rien dans les fichiers)');
eq(DOCK.OBJECT_WINDOW_DOCK_CHOICES.map((c) => c.id), DOCK.OBJECT_WINDOW_DOCKS,
  'les boutons proposent les quatre places, dans cet ordre');
ok(DOCK.OBJECT_WINDOW_DOCK_CHOICES.every((c) => c.icon && c.label && c.hint),
  'chaque place a une flèche, un nom et une infobulle (le bouton reste court)');
eq(DOCK.normalizeObjectWindowDock('LEFT'), 'left', 'la casse n’a pas d’importance');
eq(DOCK.normalizeObjectWindowDock('  top '), 'top', '…ni les espaces');
eq([DOCK.normalizeObjectWindowDock('nope'), DOCK.normalizeObjectWindowDock(''), DOCK.normalizeObjectWindowDock(null)],
  ['bottom', 'bottom', 'bottom'], 'une valeur inconnue (ou un stockage d’une autre version) retombe sur le bas');
eq([DOCK.objectWindowDockIsSide('left'), DOCK.objectWindowDockIsSide('right'),
  DOCK.objectWindowDockIsSide('bottom'), DOCK.objectWindowDockIsSide('top'),
  DOCK.objectWindowDockIsSide('  RIGHT '), DOCK.objectWindowDockIsSide('nope')],
  [true, true, false, false, true, false],
  'un CÔTÉ = une colonne ; le haut et le bas = une barre sur toute la largeur');
eq([DOCK.objectWindowDockIsBar('top'), DOCK.objectWindowDockIsBar('bottom'), DOCK.objectWindowDockIsBar('left')],
  [true, true, false], 'le pendant exact de objectWindowDockIsSide');
eq([DOCK.objectWindowDockLabel('right'), DOCK.objectWindowDockLabel('zzz')], ['Right', 'Bottom'],
  'un libellé existe même pour une place illisible');

/* ══ 2. CE QUI EST GARDÉ, ET OÙ ══════════════════════════════════════════ */
{
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = new Map();
  const withStore = (impl) => Object.defineProperty(globalThis, 'localStorage', { value: impl, configurable: true, writable: true });
  withStore({
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  });
  eq(DOCK.readObjectWindowDock(), 'bottom', 'rien de gardé → la fenêtre reste en bas');
  eq(DOCK.saveObjectWindowDock('right'), 'right', 'save rend la place réellement retenue (utilisable comme état)');
  eq(store.get(DOCK.OBJECT_WINDOW_DOCK_KEY), 'right', '…et l’écrit sous la clé du navigateur');
  eq(DOCK.readObjectWindowDock(), 'right', '…donc elle est relue au rendu suivant');
  eq(DOCK.saveObjectWindowDock('  NOPE  '), 'bottom', 'une place invalide est remplacée, jamais écrite telle quelle');
  eq(store.get(DOCK.OBJECT_WINDOW_DOCK_KEY), 'bottom', '…et c’est la place VALIDE qui est gardée');
  // Mode privé / stockage refusé : la place historique convient toujours et
  // l'écriture ne doit pas faire planter la fenêtre.
  withStore({ getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
  eq(DOCK.readObjectWindowDock(), 'bottom', 'un stockage qui refuse la lecture → la place historique');
  eq(DOCK.saveObjectWindowDock('left'), 'left', 'un stockage qui refuse l’écriture ne casse rien (la place vaut pour la session)');
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else delete globalThis.localStorage;
  eq(DOCK.readObjectWindowDock(), 'bottom', 'sans localStorage du tout (poste de test), la place historique');
}

/* ══ 3. LE BRANCHEMENT DANS L'IMAGE BUILDER ══════════════════════════════ */
has(IB, 'const [panelDock, setPanelDock] = useState(() => readObjectWindowDock());',
  'la place est relue au premier rendu (état du COMPOSANT, donc les deux affichages la partagent)');
has(IB, 'const choosePanelDock = (dock) => setPanelDock(saveObjectWindowDock(dock));',
  'un seul geste change ET garde la place');
has(IB, 'const dockIsSide = objectWindowDockIsSide(panelDock);',
  'un côté change la mise en page (colonne) et la forme de la fenêtre (`bar`)');
has(IB, 'Where the object window sits: bottom (its historical place, under the canvas), top, or a side of the canvas',
  'la raison est dite dans l’infobulle du groupe de boutons');

/* Les quatre boutons vivent dans l'EN-TÊTE de la fenêtre — donc dans les deux
   affichages, et à côté du pli. */
ok(IB.indexOf("{panelOpen ? '▾' : '▸'} Object window") < IB.indexOf('{OBJECT_WINDOW_DOCK_CHOICES.map((c) => ('),
  'les boutons sont dans l’en-tête, juste après le pli de la fenêtre');
has(IB, 'onClick={() => choosePanelDock(c.id)}', '…et chacun déplace vraiment la fenêtre');
has(IB, "className={`w-5 h-5 leading-none rounded border text-[11px] shrink-0 ${panelDock === c.id ?",
  'la place courante est marquée (celle où la fenêtre est)');
has(IB, "' — this is where the window is now.'", '…et l’infobulle le dit aussi');

/* ══ 4. LA VUE NORMALE : LA FENÊTRE SE POSE AUTOUR DU CANVAS ═════════════ */
has(IB, "dockIsSide ? 'flex-row flex-wrap xl:flex-nowrap items-start' : 'flex-col'",
  'un côté met le canvas et la fenêtre CÔTE À CÔTE ; le haut / le bas les empilent');
has(IB, "{panelDock === 'top' && <div className=\"w-full min-w-0\">{objectWindowNormal}</div>}",
  'en haut : la fenêtre AVANT le canvas');
has(IB, "{panelDock === 'bottom' && <div className=\"w-full min-w-0\">{objectWindowNormal}</div>}",
  'en bas : la fenêtre APRÈS le canvas (la place historique, inchangée)');
has(IB, "className=\"w-[22rem] max-w-full shrink-0 max-h-[70vh] overflow-y-auto custom-scrollbar border border-slate-200 rounded-lg p-2\"",
  'un côté : une colonne large de 22 rem, défilante, qui ne dépasse jamais l’écran');
ok(IB.indexOf("{panelDock === 'left' && (") < IB.indexOf("className={dockIsSide ? 'flex-1 min-w-0' : 'w-full min-w-0'}"),
  'à gauche : la colonne est posée AVANT le canvas');
ok(IB.indexOf("{panelDock === 'right' && (") > IB.indexOf("className={dockIsSide ? 'flex-1 min-w-0' : 'w-full min-w-0'}"),
  'à droite : APRÈS le canvas');
has(IB, "className={dockIsSide ? 'flex-1 min-w-0' : 'w-full min-w-0'}", 'le canvas garde tout l’espace qui reste');

/* ══ 5. LE PLEIN ÉCRAN SUIT LA MÊME PLACE ════════════════════════════════ */
has(IB, "dockIsSide ? 'flex-row' : 'flex-col'", 'le plein écran empile ou met côte à côte, comme la vue normale');
has(IB, "{panelDock === 'top' && (", 'en haut : la barre AU-DESSUS du canvas');
has(IB, "{panelDock === 'bottom' && (", 'en bas : la barre SOUS le canvas');
has(IB, "{panelDock === 'left' && (", 'à gauche : une colonne');
has(IB, "{panelDock === 'right' && (", '…comme à droite');
has(IB, 'w-[26rem] max-w-[45vw] shrink-0 overflow-y-auto custom-scrollbar border-r border-slate-300 bg-white/95 px-2 py-1.5',
  'la colonne de gauche défile et porte son filet sur son bord droit');
has(IB, 'w-[26rem] max-w-[45vw] shrink-0 overflow-y-auto custom-scrollbar border-l border-slate-300 bg-white/95 px-2 py-1.5',
  'celle de droite porte le filet sur son bord gauche');
has(IB, 'shrink-0 border-t border-slate-300 bg-white/95 shadow-2xl max-h-[38vh] overflow-y-auto custom-scrollbar px-2 py-1.5',
  'la barre du bas garde sa hauteur bornée (le canvas ne disparaît jamais)');
has(IB, "className=\"shrink-0 border-b border-slate-300 bg-white/95 shadow-2xl max-h-[38vh] overflow-y-auto custom-scrollbar px-2 py-1.5\"",
  '…et celle du haut est son miroir, sous la barre d’outils du plein écran');
has(IB, '? PropertiesPanel({ bar: !dockIsSide })',
  'en barre (haut / bas) les trois sections sont côte à côte ; sur un côté elles s’empilent (la colonne est étroite)');
ok(!IB.includes('absolute inset-x-0 bottom-0 z-20'),
  'la barre ABSOLUE qui recouvrait le bas du canvas a disparu (la fenêtre prend sa place)');

/* ══ 6. LA FENÊTRE EST ÉCRITE UNE SEULE FOIS ═════════════════════════════ */
eq([IB.split('const objectWindowNormal = (').length - 1, IB.split('const fullscreenObjectWindow = (').length - 1],
  [1, 1], 'chaque affichage a SA variable, écrite une fois');
eq([IB.split('{objectWindowNormal}').length - 1, IB.split('{fullscreenObjectWindow}').length - 1], [4, 4],
  '…et posée dans les quatre emplacements (haut, gauche, droite, bas) de chacun');
ok(IB.indexOf('const objectWindowNormal = (') < IB.indexOf('  return (\n    <>'),
  'les deux variables sont écrites avant le rendu, donc utilisables partout');
{
  /* Comme `PropertiesPanel`, ces variables ne portent AUCUN hook : les appeler
     depuis l'arbre du parent est ce qui garde le focus dans un champ pendant
     qu'on tape (voir la note du panneau d'objet). */
  const body = IB.slice(IB.indexOf('const objectWindowNormal = ('), IB.indexOf('  return (\n    <>'));
  ok(body.length > 500, 'le corps des deux variables est bien délimité pour l’analyse');
  eq((body.match(/\buse(State|Effect|Ref|Memo|Callback|Reducer)\(/g) || []).length, 0,
    'aucun hook : poser la fenêtre ailleurs ne remonte rien');
  has(body, '// Le plein écran : la fenêtre en BARRE', '…et la raison est écrite à côté');
}
ok(IB.indexOf("{panelTitle('Figures')}") < IB.indexOf('const objectWindowNormal = ('),
  'les trois piles (donc le contenu de la fenêtre) sont toujours écrites dans PropertiesPanel, que la variable ne fait que POSER');

console.log(`_builder_paneldock_test.mjs — ${passed} assertions OK`);

