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
        mais sur la figure ACTIVE seulement (un bouton 🌓 dans la colonne
        « Modify image », ses réglages JUSTE SOUS ce bouton), jamais en pastille
        sur chaque ligne.

     6) LA FENÊTRE NE MANGE PLUS LA MOITIÉ DE L'ÉCRAN (« the object window is
        not enough compacted, it takes up half of the screen! ») : trois lignes
        courtes toujours visibles (le panneau, ses figures, sa légende / ses
        textes), chaque OUTIL SOUS SON BOUTON (le détourage, l'ombre de la
        figure, l'ombre du cadre — qui a remplacé « ⛶ Fullscreen on object »,
        inutile ici), et derrière « ▾ More options » ce qui n'est PAS une
        commande : la disposition libre et les longs rappels. Aucune phrase
        d'explication à l'écran : « the explanation by hovering ».
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
has(IB, '? PropertiesPanel({ bar: !dockIsSide })', '…idem en plein écran : en mode barre en haut / en bas, en colonne sur un côté');
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
ok(!IB.includes('FIGURE_RESIZE_GAIN'),
  'la poignée d’une figure ne prend plus la MOITIÉ du geste : le coin suit le pointeur (la plainte « it goes too slow » succède à « it goes too fast », et 🎯 Precision est là pour ça)');
has(IB, 'const fineDrag = !!(fineModeRef.current || e.shiftKey);',
  'le mode fin se lit en direct (un glissement survit à un rendu)');
has(IB, 'const gridQuantised = type === \'move\' || type === \'resize\';',
  'un PANNEAU reste à la case entière : la réduction ne le rendrait que plus dur à bouger');
has(IB, 'const dxMm = gain === 1 ? mmX : +(mmX * gain).toFixed(3);', 'le déplacement écrit est celui du gain');
has(IB, 'const gain = gridQuantised ? 1 : (fineDrag ? FINE_GAIN : 1);',
  '…et le gain s’applique à tout le reste (figure, recadrage, texte, flèche, décalage d’image), SANS ralentir la figure');
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

/* ══ 4. PLEIN ÉCRAN : TROIS PILES INDÉPENDANTES, ET LA FENÊTRE SE PLIE ═══ */
has(IB, 'const PropertiesPanel = ({ bar = false } = {}) => (', 'le panneau sait se présenter en barre');
has(IB, "? 'grid grid-cols-1 md:grid-cols-3 items-start gap-x-4 gap-y-2'",
  '…en TROIS COLONNES : les trois sections sont côte à côte, séparées par un filet');
has(IB, "const panelColCls = (bar, first = false) => `flex flex-col gap-1.5 min-w-0${bar && !first ? ' md:border-l md:border-slate-200 md:pl-3' : ''}`;",
  '…et chaque section est SA PROPRE PILE (`flex flex-col`) : rien de ce qui grandit dans une colonne ne décale les autres (dans une grille, une ligne est PARTAGÉE — c’est ce qui laissait du vide et décalait « Modify image » à chaque figure ajoutée)');
has(IB, "'flex flex-col gap-1.5 border-t border-slate-200 pt-1.5'",
  '…tandis que la vue normale reste une colonne');
has(IB, "<div className={panelColCls(bar, true)}>", '…la première pile (FIGURES) n’a pas de filet à sa gauche');
eq(times(IB, /<div className=\{panelColCls\(bar/g), 3, '…trois piles, une par section');
has(IB, "{panelTitle('Figures')}", '…la colonne FIGURES est titrée');
has(IB, "{panelTitle('Modify image')}", '…la colonne MODIFY IMAGE');
has(IB, "{panelTitle('Panels & objects')}", '…et la colonne PANELS & OBJECTS (le panneau + ce qui est posé dessus)');
ok(!IB.includes("bar ? 'order-"), '…et plus AUCUN `order-*` : l’ordre est celui des piles, plus celui du source');
ok(!/panelCellCls\(bar, bar \?/.test(IB), '…ni de ligne qui déclare sa colonne à la main');
/* LA FENÊTRE EST DOCKABLE : en bas (la place historique), en haut, ou d'un côté.
   La place est celle de `panelDock` (utils/objectWindowDock.js) et le plein
   écran la suit — la barre du bas n'est plus une barre ABSOLUE collée au bas de
   la fenêtre (elle recouvrait le bas du canvas) : elle prend sa place dans le
   flux, et le canvas garde tout le reste. */
has(IB, "{panelDock === 'bottom' && (", 'en bas : la fenêtre se pose sous le canvas');
has(IB, "className=\"shrink-0 border-t border-slate-300 bg-white/95 shadow-2xl max-h-[38vh] overflow-y-auto custom-scrollbar px-2 py-1.5\"",
  '…en barre sur toute la largeur, défilante au besoin (jamais la moitié de l’écran)');
has(IB, "{panelDock === 'top' && (", 'en haut : la même barre AU-DESSUS du canvas');
has(IB, "{panelDock === 'left' && (", 'à gauche : une colonne le long du canvas');
has(IB, "{panelDock === 'right' && (", '…comme à droite');
has(IB, "{OBJECT_WINDOW_DOCK_CHOICES.map((c) => (", 'les quatre places sont offertes par l’en-tête de la fenêtre');
has(IB, 'const choosePanelDock = (dock) => setPanelDock(saveObjectWindowDock(dock));',
  '…et le choix est GARDÉ par le navigateur (jamais écrit dans une figure)');
has(IB, 'const [panelDock, setPanelDock] = useState(() => readObjectWindowDock());',
  'la place est relue au premier rendu');
has(IB, 'const dockIsSide = objectWindowDockIsSide(panelDock);',
  'un côté change la mise en page (colonne) et la forme de la fenêtre (`bar`)');
/* LA FENÊTRE SE PLIE : son titre est le bouton (▾ / ▸) — repliée elle ne laisse
   qu’une ligne, et le canvas garde toute la hauteur. */
has(IB, 'const [panelOpen, setPanelOpen] = useState(true);', 'la fenêtre de l’objet sait se replier (état du COMPOSANT)');
has(IB, 'onClick={() => setPanelOpen((v) => !v)}', '…et son titre EST le pli');
has(IB, "{panelOpen ? '▾' : '▸'} Object window", '…qui dit d’un coup d’œil si elle est ouverte');
ok(IB.indexOf('{panelOpen && (') < IB.indexOf("{panelTitle('Figures'"),
  'repliée : ni colonnes ni titres — une seule ligne reste');
ok(!IB.includes('absolute right-4 bottom-4 md:top-16 md:bottom-4 w-80 z-20'), 'l’ancienne fenêtre flottante à droite a disparu');
has(IB, '<ArrowPropertiesPanel arrow={selectedArrow} isFloating onChange={updateArrow} onDelete={() => removeArrow()} />',
  'le panneau des flèches, lui, garde sa forme (quelques champs seulement)');
has(IB, '<ShapePropertiesPanel shape={selectedShape} isFloating onChange={updateShape} onDelete={() => removeShape()} />',
  '…et celui d’une forme (ligne, rectangle, cercle) aussi');

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
has(IB, "letterStyle: letterStyleNow(),",
  'taille + couleur + gras + POLICE des lettres : une définition GÉNÉRALE (options du canvas)');
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

/* ══ 7. LES TROIS SECTIONS — FIGURES · MODIFY IMAGE · PANELS & OBJECTS — ET LA
   LÉGENDE SEULE SUR TOUTE LA LARGEUR, TOUT EN BAS ══════════════════════════
   « it is ok but the first column is almost empty … first column: Figures …
   Second column: Modify image … Third column called objects » — puis « if I add
   a figure the lines of modify images are shifted by one line leaving
   unnecessary blank space ». C'est ce dernier point qui a changé : les trois
   sections ne sont plus LES LIGNES D'UNE MÊME GRILLE (où une ligne, partagée,
   prend la hauteur de son plus haut occupant) mais TROIS PILES : chacune
   grandit, se replie et se lit toute seule. Chaque ligne de commandes n'a donc
   plus de `order-*` ni de `md:col-start-*` — sa place est SA PILE. Le panneau
   lui-même (pastilles A B C, profondeur, suppression, l'ombre du CADRE) a rejoint la
   troisième pile, qui s'appelle « Panels & objects ». La légende du panneau (son
   sous-titre) reste seule à prendre toute la largeur, placée EN DERNIER, et le
   repli « ▾ More options » juste après elle. */
has(IB, 'const [panelMore, setPanelMore] = useState(false);',
  'le repli « More options » est un état du COMPOSANT (jamais un hook du panneau)');
has(IB, "const panelCellCls = (bar) => `flex flex-wrap items-center gap-x-1.5 gap-y-1${bar ? ' min-w-0' : ''}`;",
  'une seule définition de LIGNE (min-w-0 : sans lui une colonne déborde)');
eq(times(IB, /panelCellCls\(bar\)/g), 10,
  'dix lignes de commandes, réparties dans les trois piles (les neuf d’avant, plus LA NOUVELLE ligne des OUTILS DE L’IMAGE : le détourage et les réglages de l’ombre de la figure y sont écrits SOUS leurs boutons — la ligne « OBJECTS · aligner / répartir les PANNEAUX », elle, reste RETIRÉE)');
/* L'ORDRE DE LECTURE EST CELUI DES PILES : on vérifie que chaque ligne de
   commandes tombe ENTRE l'ouverture de sa pile et celle de la suivante. */
{
  const stack1 = IB.indexOf('<div className={panelColCls(bar, true)}>');
  const stack2 = IB.indexOf('<div className={panelColCls(bar)}>');
  const stack3 = IB.indexOf('<div className={panelColCls(bar)}>', stack2 + 1);
  const caption = IB.indexOf('col-span-full border-t');
  ok(stack1 > 0 && stack2 > stack1 && stack3 > stack2 && caption > stack3,
    'les trois piles s’ouvrent l’une après l’autre, la légende pleine largeur vient après la troisième');
  const inside = (mark, from, to) => IB.indexOf(mark) > from && IB.indexOf(mark) < to;
  const rows = [
    ["setPickMode('add')", stack1, stack2, 'la ligne des FIGURES (sa liste, ses ⇹) est dans la PREMIÈRE pile'],
    ['🎨 Transparent background{figBgRecord', stack2, stack3, 'le détourage + l’ombre + l’opacité dans la pile MODIFY IMAGE'],
    ['Tolerance {clampBgTol(bgTol)}', stack2, stack3, '…avec l’OUTIL de détourage SOUS son bouton : l’aperçu, la tolérance, « Remove background », « Auto: the four corners »'],
    ['🌓 Shadow of figure {cropPanelIdx + 1}', stack2, stack3, '…et les réglages de l’ombre de la FIGURE SOUS « 🌓 Figure shadow »'],
    ['🎯 Precision{fineMode', stack2, stack3, 'les outils de la figure (rotation, recadrage, gomme) aussi'],
    ['⟲ Reset crop</button>', stack2, stack3, '…avec la remise à zéro du recadrage'],
    ['H (% of panel)', stack2, stack3, 'la taille exacte et l’ajustement aussi'],
    ['{ADJUST_FIELDS.map((f) => (', stack2, stack3, 'le réglage d’image (contraste, luminosité, couleur) aussi'],
    ['onClick={() => toggleSelectedId(o.id)}', stack3, caption, 'les pastilles A B C DU PANNEAU sont dans la TROISIÈME pile (« Panels & objects »), pas dans « Modify image »'],
    ['⤒ Front', stack3, caption, '…avec la profondeur, la suppression, l’OMBRE DU PANNEAU (à la place du plein écran, déjà dans les deux barres du haut) et « ▾ More options » (dernier mot de la fenêtre)'],
    ['↗ Arrow{arrows.length', stack3, caption, 'la flèche est dans la TROISIÈME pile (les annotations du canvas)'],
    ['onClick={addText}', stack3, caption, '…avec les textes, l’un sous l’autre']
  ];
  rows.forEach(([mark, from, to, what]) => ok(inside(mark, from, to), `…${what}`));
}
ok(!/panelCellCls\(bar, bar \? 'order-3 md:col-start-3'/.test(IB),
  '…et la ligne « OBJECTS · aligner / répartir les PANNEAUX » a bien disparu (les ⇹ rangent les FIGURES et les TEXTES d’un panneau — voir _builder_shapes_test)');
has(IB, "? 'flex flex-wrap items-start gap-x-1.5 gap-y-1 min-w-0 col-span-full border-t border-slate-200 pt-1'",
  '…et la LÉGENDE est la seule à prendre toute la largeur (`col-span-full` : elle est la dernière dans la source, donc plus besoin d’`order-last`)');
eq(times(IB, /min-w-0 col-span-full border-t/g), 1,
  'un SEUL élément pleine largeur dans toute la fenêtre : le sous-titre');
eq(times(IB, /order-last|order-12/g), 0,
  '…et plus aucun `order-*` : la place de chaque bloc est celle de la source');
ok(IB.indexOf('min-w-0 col-span-full border-t') < IB.indexOf('{panelMore && ('),
  '…déclarée avant le repli, donc placée après lui : bien tout en bas');
has(IB, "? 'min-w-0 md:col-span-full'",
  'le repli « More options » prend lui aussi toute la largeur, juste après la légende');
eq(times(IB, /<div className="flex flex-wrap items-center gap-x-1\.5 gap-y-1">/g), 0,
  'plus aucune ligne pleine largeur écrite à la main');
has(IB, "{panelMore ? '▴ Fewer options' : '▾ More options'}",
  'un seul repli, dont le libellé dit ce qu’il cache');
has(IB, 'onClick={() => setPanelMore((v) => !v)}', '…et qui se referme en un clic');
ok(IB.indexOf('<ShadowControls ') < IB.indexOf('{panelMore && ('),
  'les DEUX ombres sont SORTIES du repli : celle du PANNEAU vit dans la section PANELS (elle y a remplacé le plein écran), celle de la FIGURE sous son bouton');
ok(IB.indexOf('<ShadowControls ') < IB.indexOf("{panelTitle('Panels & objects')}"),
  '…et le premier bloc d’ombres du fichier est déjà celui du panneau, dans la troisième pile');
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
