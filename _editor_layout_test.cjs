/* =========================================================================
   _editor_layout_test.cjs — la largeur de la page projet ne bouge plus toute
   seule, et un clic sur une commande ne se perd plus.

   Ce que l'utilisateur signale :
     « le plus agaçant, c'est que cliquer sur les commandes change sans arrêt la
       largeur de la page, en alternant étroit / élargi. Je dois toujours
       cliquer deux fois pour avoir une commande. »

   La cause : la page passait de `max-w-5xl` à `max-w-none` sur chaque FOCUS de
   l'éditeur et revenait en arrière sur chaque BLUR. Or cliquer sur un bouton
   (barre d'outils, export, ☁ Drive, 🔗 liens…) fait perdre le focus : la page
   se rétrécissait PENDANT le clic, le bouton se décalait sous le curseur et le
   clic était perdu — d'où le double clic et l'alternance permanente.

   Correctif vérifié ici :
     • la largeur ne change QUE par le bouton « ⤢ Wide editing / ⤡ Normal
       width » (aucun `onEditFocusChange` ne la pilote plus) ;
     • les boutons de la barre d'outils de l'éditeur gardent le focus
       (`onMouseDown` → preventDefault) : la commande part au premier clic et
       l'insertion se fait au curseur.
   ========================================================================= */
const assert = require('assert');
const fs = require('fs');

const PROJ = fs.readFileSync('src/components/AppModules/projectDetailModule.jsx', 'utf8');
const RTE = fs.readFileSync('src/components/RichTextEditor.jsx', 'utf8');

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const not = (hay, needle, what) => { ok(!hay.includes(needle), what); };

/* ── 1. La largeur de la page ne change plus sur focus / blur ─────────────── */
not(PROJ, 'onEditFocusChange={setTextEditing}',
  'l’éditeur ne pilote plus la largeur de la page (c’était la cause du double clic)');
not(PROJ, 'setTextEditing', 'plus aucune bascule automatique de largeur ne subsiste');
ok(PROJ.includes('const [wideLayout, setWideLayout] = useState(false)'),
  'la largeur est un état choisi par l’utilisateur (wideLayout)');
ok(PROJ.includes("wideLayout ? 'max-w-none' : 'max-w-5xl'"),
  'la largeur de la page suit ce seul état');
ok(PROJ.includes('onClick={() => setWideLayout((v) => !v)}'),
  'un bouton explicite bascule la largeur (comme « ◧ Hide sidebar » ailleurs dans le programme)');
ok(PROJ.includes("'⤢ Wide editing'") && PROJ.includes("'⤡ Normal width'"),
  'le bouton dit dans quel sens il va changer la largeur');

/* ── 2. Un bouton de la barre d'outils ne vole pas le focus ──────────────── */
ok(RTE.includes('const keepFocus = (e) => e.preventDefault();'),
  'l’éditeur garde le focus (et la sélection) quand on clique une commande');
const guarded = (RTE.match(/onMouseDown=\{keepFocus\}/g) || []).length;
ok(guarded >= 10,
  `toutes les commandes de la barre d’outils gardent le focus (${guarded} boutons) — gras/italique, listes, 🔗 Link, 🖼️ Figure, 📄 Word text, les boutons « extra » des sections (📚 + Reference…), ▴/▾`);
ok(/toolbarExtra\.map\([\s\S]{0,240}?onMouseDown=\{keepFocus\}/.test(RTE),
  'les boutons ajoutés par la page projet (📚 + Reference, ▦ + Std Table…) en font partie');

console.log(`_editor_layout_test.cjs — ${passed} assertions passed`);
