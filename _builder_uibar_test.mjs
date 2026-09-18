/* =========================================================================
   _builder_uibar_test.mjs — LA BARRE DE COMMANDES DE L'IMAGE BUILDER, telle
   qu'elle a été réorganisée :

     1) LA FENÊTRE NE SAUTE PLUS. Le panneau d'objet était écrit
        `{selectedObj && <PropertiesPanel />}` alors que `PropertiesPanel` est
        DÉCLARÉ DANS le composant : son identité change à chaque rendu, React y
        voit un AUTRE composant, démonte le sous-arbre et le remonte — à chaque
        caractère tapé et à chaque clic dans un champ (le focus partait, le
        défilement revenait en haut : « the window jumps away and I have to go
        back to the text or to the size button »). Il est maintenant APPELÉ comme
        une fonction (comme `renderSvg`), donc rien n'est remonté.

     2) « 💾 Save canvas » SAUVE DANS SON PROJET — un clic, pas de dialogue à
        passer pour un geste qu'on répète ; et quand le canvas n'a pas encore de
        projet (ou pas un projet où l'on peut écrire), le dialogue s'ouvre et
        demande LEQUEL. « 📤 Insert into project… » a quitté la barre du haut :
        les deux gestes se confondaient.

     3) 🎯 PRECISION : « resizing figures or cropping them by mouse goes too fast
        and I cannot be precise ». Poignée de figure = la moitié du pointeur,
        🎯 (ou Shift) = le quart, et la taille exacte se tape au clavier.

     4) PLEIN ÉCRAN : la fenêtre d'objet devient une barre HORIZONTALE collée en
        bas de la fenêtre.

     5) MOINS D'ÉCRITURES : plus de padding, plus de champs numériques de
        recadrage, plus de nom / taille de lettre. L'ombre de la FIGURE est là —
        mais sur la figure ACTIVE seulement (un bouton 🌓 sur la ligne des
        figures, ses réglages dans le repli), jamais en pastille sur chaque ligne.

     6) LA FENÊTRE NE MANGE PLUS LA MOITIÉ DE L'ÉCRAN (« the object window is
        not enough compacted, it takes up half of the screen! ») : trois lignes
        courtes toujours visibles (le panneau, ses figures, sa légende / ses
        textes) et tout le reste — l'ombre, la disposition libre, la taille du
        pinceau de la gomme, les longues explications — derrière « ▾ More
        options ».
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
const times = (hay, re) => (String(hay).match(re) || []).length;

/* ══ 1. LA FENÊTRE NE SE REMONTE PLUS (le focus tient) ════════════════════ */
ok(!IB.includes('&& <PropertiesPanel'), 'le panneau d’objet n’est plus rendu comme un élément JSX (vue normale)');
ok(!IB.includes('<PropertiesPanel isFloating'), '…ni en plein écran');
has(IB, '{selectedObj && PropertiesPanel({})}', 'il est APPELÉ (vue normale) : ses éléments font partie de l’arbre du parent');
has(IB, '? PropertiesPanel({ bar: true })', '…idem en plein écran, en mode barre');
has(IB, 'const PropertiesPanel = ({ bar = false } = {}) => (', 'la signature porte le mode barre');
ok(IB.indexOf('⚠️ IL EST APPELÉ COMME UNE FONCTION') > 0, 'la raison est écrite là où on lira la prochaine fois');
has(IB, 'JAMAIS écrit `<PropertiesPanel />`', '…et le piège est nommé');
{
  // La raison pour laquelle l'appeler est SÛR : il ne contient aucun hook. Ses
  // éléments sont donc évalués dans l'arbre du parent, sans cycle de vie à lui.
  const body = IB.slice(IB.indexOf('const PropertiesPanel = '), IB.indexOf('  return (\n    <>'));
  ok(body.length > 1000, 'le corps du panneau est bien délimité pour l’analyse');
  eq(times(body, /\buse(State|Effect|Ref|Memo|Callback|Reducer)\(/g), 0,
    'le panneau d’objet ne porte AUCUN hook : l’appeler comme une fonction ne casse rien');
}

/* ══ 2. « 💾 SAVE CANVAS » SAUVE DANS SON PROJET ══════════════════════════ */
has(IB, 'const canvasSaveProject = () => {', 'la destination du clic est calculée');
has(IB, 'const saveCanvasNow = async () => {', '…et le geste « un clic » existe');
has(IB, 'if (!dest) { openSaveDialog(); return; }   // no project yet → which one?',
  'sans projet, c’est le dialogue qui demande LEQUEL (jamais une écriture silencieuse)');
has(IB, 'await finishCanvasSave(dest, canvasLabel || autoSaveLabel());', 'avec un projet, la sauvegarde part tout de suite');
has(IB, 'const finishCanvasSave = async (destProjectId, label) => {', 'le dialogue et le clic partagent le MÊME enregistrement');
has(IB, 'onClick={saveCanvasNow}', 'le bouton de la barre du haut');
has(IB, '▾ Choose where…', '…et le bouton qui ouvre le dialogue (choisir un autre projet / le dataset)');
has(IB, '📤 Insert into a project section…', 'l’insertion dans une section s’est déplacée DANS le dialogue de sauvegarde');
ok(!IB.includes('>📤 Insert into project…</button>'), '…et a quitté la barre du haut (les deux gestes ne se confondent plus)');

// Miroir de canvasSaveProject : l'ordre des candidats, et le cas « aucun ».
// (`Object.keys(...)[0]` ne suffisait pas : la première entrée peut être celle
// du DATASET alors qu'une autre vient d'un projet — d'où le `.find`.)
const canvasSaveProjectM = ({ canvasHome, projectId, canvasEntries = {}, writable = () => true }) => {
  if (canvasHome && writable(canvasHome)) return canvasHome;
  if (projectId && writable(projectId)) return projectId;
  const stored = Object.keys(canvasEntries || {}).find((k) => k !== 'dataset');
  if (stored && writable(stored)) return stored;
  return null;
};
eq(canvasSaveProjectM({ canvasHome: 'P', projectId: 'Q' }), 'P', 'le canvas rejoint le projet où il vit déjà');
eq(canvasSaveProjectM({ canvasHome: null, projectId: 'Q' }), 'Q', 'sinon le projet de l’éditeur');
has(IB, "const stored = Object.keys(canvasEntries || {}).find((k) => k !== 'dataset');",
  'la reprise dans un autre projet compte, même quand le dataset est cité en premier');
eq(canvasSaveProjectM({ canvasHome: null, projectId: null, canvasEntries: { dataset: {}, R: {} } }), 'R',
  'sinon la bibliothèque où la composition a été reprise');
eq(canvasSaveProjectM({ canvasHome: null, projectId: null, canvasEntries: { dataset: {} } }), null,
  'aucun projet → null (le dialogue demande lequel)');
eq(canvasSaveProjectM({ canvasHome: 'P', projectId: 'Q', writable: (id) => id === 'Q' }), 'Q',
  'un projet où l’on n’a pas le droit d’écrire ne compte pas');
eq(canvasSaveProjectM({ canvasHome: null, projectId: null, canvasEntries: { dataset: {}, R: {} }, writable: (id) => id !== 'R' }), null,
  'idem pour une entrée reprise dans un projet fermé à l’écriture');

/* ══ 3. 🎯 PRECISION (la souris ne va plus trop vite) ════════════════════ */
has(IB, 'const FINE_GAIN = 0.25;            // ÷4 while 🎯 Precision (or Shift) is on',
  '🎯 Precision (ou Shift) divise le geste par quatre');
has(IB, 'const FIGURE_RESIZE_GAIN = 0.5;    // a figure’s corner follows ½ of the pointer',
  'la poignée d’une figure ne suit que la MOITIÉ du pointeur (la plainte « goes too fast »)');
has(IB, 'const fineDrag = !!(fineModeRef.current || e.shiftKey);',
  'le mode fin se lit en direct (un glissement survit à un rendu)');
has(IB, "const gridQuantised = type === 'move' || type === 'resize';",
  'un PANNEAU reste à la case entière : la réduction ne le rendrait que plus dur à bouger');
has(IB, 'const gain = gridQuantised ? 1 : (fineDrag ? FINE_GAIN : 1) * (type === \'figResize\' ? FIGURE_RESIZE_GAIN : 1);',
  '…et le gain s’applique à tout le reste (figure, recadrage, texte, flèche, décalage d’image)');
has(IB, 'const dxMm = gain === 1 ? mmX : +(mmX * gain).toFixed(3);', 'le déplacement écrit est celui du gain');
has(IB, 'const nx = fineDrag ? st.from.x + (rawX - st.from.x) * FINE_GAIN : rawX;',
  'le recadrage prend le quart du mouvement, ancré là où le glissement a commencé');
has(IB, 'onClick={toggleFineMode}', 'le bouton « 🎯 Precision » de la fenêtre de l’objet');
has(IB, "🎯 Precision{fineMode ? ' ON' : ''}", '…qui dit s’il est allumé');
has(IB, 'Holding SHIFT during a gesture does exactly the same', '…et rappelle que Shift fait pareil');
// La taille exacte au clavier : le recours quand la souris ne suffit pas.
has(IB, 'const setActiveFigBox = (patch) => {', 'la figure active a une taille EXACTE tapable');
has(IB, 'W (% of panel)', '…« W (% of panel) »');
has(IB, 'H (% of panel)', '…et « H (% of panel) »');
has(IB, 'onChange={(e) => setActiveFigBox({ w: e.target.value })}', '…écrite dans le rectangle de la figure');
has(IB, 'onChange={(e) => setActiveFigBox({ h: e.target.value })}', '…dans les deux sens');
has(IB, 'const writeFigureRect = (objId, idx, rect) => {', 'l’écriture passe par une seule fonction');
has(IB, 'onFocus={() => commitHistory()}', 'un Ctrl+Z par session d’édition (jamais un par caractère)');
has(IB, 'This figure is still laid out by the panel grid', '…et une figure encore en grille dit pourquoi le champ est vide');

/* ══ 4. PLEIN ÉCRAN : UNE GRILLE DE 6 COLONNES EN BAS ════════════════════ */
has(IB, 'const PropertiesPanel = ({ bar = false } = {}) => (', 'le panneau sait se présenter en barre');
has(IB, "'grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 items-start gap-x-3 gap-y-1.5'",
  '…en GRILLE DE 6 COLONNES (et non en colonne)');
has(IB, "'flex flex-col gap-1 border-t border-slate-200 pt-1.5'",
  '…tandis que la vue normale reste une colonne');
has(IB, 'absolute inset-x-0 bottom-0 z-20 border-t border-slate-300 bg-white/95 shadow-2xl',
  '…collée en BAS de la fenêtre, sur toute la largeur');
has(IB, 'max-h-[38vh] overflow-y-auto custom-scrollbar px-2 py-1.5', '…et défilante au besoin (jamais la moitié de l’écran)');
has(IB, '? PropertiesPanel({ bar: true })', 'le plein écran utilise la barre');
ok(!IB.includes('absolute right-4 bottom-4 md:top-16 md:bottom-4 w-80 z-20'), 'l’ancienne fenêtre flottante à droite a disparu');
has(IB, '<ArrowPropertiesPanel arrow={selectedArrow} isFloating onChange={updateArrow} onDelete={() => removeArrow()} />',
  'le panneau des flèches, lui, garde sa forme (quelques champs seulement)');

/* ══ 5. MOINS D'ÉCRITURES : CE QUI A QUITTÉ LA FENÊTRE D'OBJET ═══════════ */
ok(!IB.includes('>Padding (mm)'), 'le RÉGLAGE « Padding (mm) » a disparu de la fenêtre (un commentaire le mentionne encore : c’est voulu)');
ok(!IB.includes("['x1', 'Left'], ['x2', 'Right']"), 'plus de champs numériques Left / Right / Top / Bottom du recadrage');
ok(!IB.includes('Letter Size — all panels (pt)'), 'plus de taille de lettre par panneau (elle est générale)');
ok(!IB.includes('>Letter\n              <input type="text" value={selectedObj.letter}'), 'plus de nom de lettre à saisir (il est automatique)');
ok(!IB.includes('setFigureShadow(selectedObj.id, i, im.shadow'),
  'pas de pastille 🌓 sur chaque ligne de figure — l’ombre de figure vise la figure ACTIVE');
has(IB, "🌓 {figShadowOn ? 'Figure shadow ✓' : 'Figure shadow'}",
  '…d’un seul bouton, sur la ligne des figures');
has(IB, 'Panel {selectedObj.letter || \'—\'}', 'l’en-tête est court : « Panel A », pas trois lignes');
ok(!IB.includes('Object Properties'), '…et l’ancien titre « Object Properties » a disparu');
has(IB, "letterStyle: { fontSize: currentLetterPt(), color: currentLetterColor(), bold: currentLetterBold() },",
  'taille + couleur + gras des lettres : une définition GÉNÉRALE (options du canvas)');
has(IB, 'Letter colour', '…régée dans les options du canvas');
has(IB, 'onChange={e => setLetterBoldAll(e.target.checked)} /> Letters bold', '…avec le gras juste à côté');

/* ══ 6. CE QUI DEVAIT RESTER RESTE ════════════════════════════════════════ */
has(IB, '⤒ Front', '« mettre ce panneau par-dessus les autres »');
has(IB, '⤓ Back', '…et derrière');
has(IB, "moveFigure(selectedObj.id, i, 'front')", 'l’empilement des FIGURES est toujours là');
has(IB, 'onClick={() => toggleCropMode(selectedObj.id, cropPanelIdx)}', 'le recadrage à la souris');
has(IB, '⟲ Reset crop', '…avec sa remise à zéro');
has(IB, 'toggleEraseMode', 'la gomme');
has(IB, 'togglePanelsShadow', 'l’ombre des panneaux');
has(IB, 'onClick={addText}', 'le texte libre');
has(IB, '📤 Insert into a project section…', '…et l’insertion dans une section de projet, depuis le dialogue de sauvegarde');

/* ══ 7. SIX COLONNES, LA LÉGENDE SEULE SUR TOUTE LA LARGEUR, TOUT EN BAS ══
   « you divided the space in two columns but you must use 6 columns … the only
   element that should take the full horizontal width is the sub-caption space.
   It should go at the very bottom. » Chaque groupe de commandes occupe donc UNE
   colonne — leur hauteur ne s'additionne plus (c'est l'espace vertical rendu au
   canevas) — et la légende du panneau (son sous-titre) est seule à prendre
   toute la largeur, placée EN DERNIER. Le reste des réglages rares vit toujours
   derrière « ▾ More options ». Rien n'a été supprimé : seulement rangé. */
has(IB, 'const [panelMore, setPanelMore] = useState(false);',
  'le repli « More options » est un état du COMPOSANT (jamais un hook du panneau)');
has(IB, "const panelCellCls = (bar, extra = '') => `flex flex-wrap items-center gap-x-1.5 gap-y-1 ${extra}${bar ? ' min-w-0' : ''}`;",
  'une seule définition de colonne (min-w-0 : sans lui la grille déborde)');
eq(times(IB, /panelCellCls\(bar\)/g), 6,
  'six colonnes de commandes : panneau, vue, figures, taille, outils de la figure, textes');
['COLONNE 1', 'COLONNE 2', 'COLONNE 3', 'COLONNE 4', 'COLONNE 5', 'COLONNE 6'].forEach((mark) => {
  has(IB, mark, `…${mark} est nommée (la fenêtre se lit comme une grille)`);
});
has(IB, "? 'flex flex-wrap items-start gap-x-1.5 gap-y-1 min-w-0 order-last col-span-full border-t border-slate-200 pt-1'",
  '…et la LÉGENDE est la seule à prendre toute la largeur (order-last col-span-full)');
eq(times(IB, /min-w-0 order-last col-span-full border-t/g), 1,
  'un SEUL élément pleine largeur dans toute la fenêtre : le sous-titre');
ok(IB.indexOf('min-w-0 order-last col-span-full border-t') < IB.indexOf('{panelMore && ('),
  '…déclarée avant le repli, donc placée après lui : bien tout en bas');
has(IB, "? 'min-w-0 xl:col-span-2'", 'le repli « More options » reste une colonne (deux de large au plus)');
eq(times(IB, /<div className="flex flex-wrap items-center gap-x-1\.5 gap-y-1">/g), 0,
  'plus aucune ligne pleine largeur écrite à la main');
has(IB, "{panelMore ? '▴ Fewer options' : '▾ More options'}",
  'un seul repli, dont le libellé dit ce qu’il cache');
has(IB, 'onClick={() => setPanelMore((v) => !v)}', '…et qui se referme en un clic');
ok(IB.indexOf('{panelMore && (') > 0 && IB.indexOf('{panelMore && (') < IB.indexOf('<ShadowControls '),
  'l’ombre du panneau est DANS le repli (un réglage qu’on pose une fois)');
has(IB, '🧽 {clampEraseSize(eraseSize)} mm', 'la taille du pinceau dit sa valeur en clair');
ok(!IB.includes('grid grid-cols-1 md:grid-cols-2 gap-4'),
  'plus de grille à deux colonnes : la fenêtre n’est plus une page');
ok(!IB.includes('<h5 className="text-xs font-bold text-slate-500 uppercase">Image & Layout</h5>'),
  'plus de titre « Image & Layout » (les commandes sont dans la ligne)');
ok(!IB.includes('<h5 className="text-xs font-bold text-slate-500 uppercase">Caption</h5>'),
  'plus de titre « Caption »');
ok(!IB.includes('<h5 className="text-xs font-bold text-slate-500 uppercase">Text</h5>'),
  'plus de titre « Text »');
ok(!IB.includes('Figures in this panel:'), 'plus de ligne « Figures in this panel: » (la liste est la ligne)');

console.log(`_builder_uibar_test.mjs — ${passed} assertions OK`);
