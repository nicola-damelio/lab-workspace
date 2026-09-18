/* =========================================================================
   _project_section_editing_test.mjs — le travail dans une section d'un projet,
   tel qu'il a été demandé :

     1. « nel progetto rinomina la sezione bibliography in “references” » :
        l'INTITULÉ devient « References » — la carte de la page projet, le titre
        imprimé dans le document et la partie du « Publication format » — alors
        que les CLÉS INTERNES ne bougent pas (`openSections.bibliography`, l'id
        `bibliography`, la classe `.pf-bib`) : un projet enregistré reste
        lisible, et un document FIGÉ avant le renommage garde sa liste complétée
        puis retirée comme avant (voir BIB_LIST_RE, _reference_links_test.mjs).

     2. « la dimensione del carattere è espresso in size (small, normal, large)
        ma preferisco il font e la dimensione del carattere (police in
        numeri) » : la barre d'outils n'offre plus Small / Normal / Large / Huge
        — les tailles 1…7 d'execCommand — mais la LISTE DES POLICES du
        Publication format et une taille en POINTS, écrite en chiffres. Les
        règles partent en style EN LIGNE (ce que le document du projet relit) et
        la sélection est conservée d'un réglage à l'autre.

     3. « nella parte dove ci sono le figure permettimi di scambiarne la
        posizione con il mouse » : les cartes de figures d'une section se
        prennent à la souris. Le déplacement lui-même est un util PUR
        (moveFigureTo, utils/figurePlacement.js) — vérifié ici sans DOM — et son
        résultat est l'ORDRE du document exporté.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const PAGE = readFileSync('./src/components/AppModules/projectDetailModule.jsx', 'utf8');
const RTE = readFileSync('./src/components/RichTextEditor.jsx', 'utf8');
const { PUB_LAYOUT_PARTS } = await import('./src/components/pubCitation.js');
const FP = await import('./src/utils/figurePlacement.js');

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

/* ── 1. BIBLIOGRAPHY → REFERENCES (l'intitulé, pas les clés) ─────────────── */
has(PAGE, 'title="📚 References"', 'la carte de la page projet s’appelle « 📚 References »');
ok(!PAGE.includes('📚 Bibliography'), '…et l’ancien intitulé n’est plus nulle part');
has(PAGE, 'open={openSections.bibliography}',
  'la CLÉ de la section reste « bibliography » (l’état plié/déplié n’est pas perdu)');
has(PAGE, 'References ({refs.length})</h2>',
  'le titre imprimé dans le document du projet est « References (n) »');
{
  const part = PUB_LAYOUT_PARTS.find((p) => p.id === 'bibliography');
  eq(part.label, 'References', 'la partie du Publication format s’appelle « References »');
  eq(part.selectors, ['.pf-bib', '.pf-bib li'],
    '…mais elle vise toujours la classe `.pf-bib` (une mise en forme enregistrée garde son effet)');
}

/* ── 2. POLICE + TAILLE EN CHIFFRES dans la barre d'outils ───────────────── */
const TOOLBAR_START = '{!readOnly && toolbarOpen && (';
const TOOLBAR_END = '{pasteNotice && (';
const toolbar = RTE.slice(RTE.indexOf(TOOLBAR_START), RTE.indexOf(TOOLBAR_END));
ok(toolbar.length > 500, 'la barre d’outils est bien localisée dans RichTextEditor');
has(toolbar, 'PUB_FONTS.map((f) => (', 'la barre d’outils propose la LISTE DES POLICES du Publication format');
has(toolbar, '{f.label}</option>', 'chaque famille est nommée comme dans le Publication format');
has(toolbar, 'type="number"', 'la taille est un CHAMP DE NOMBRE (des chiffres, pas des mots)');
has(toolbar, 'min="4" max="96" step="0.5"', 'bornes et pas de la taille (4 à 96, au demi-point près)');
has(toolbar, '>pt</span>', '…et son unité est le POINT');
has(toolbar, 'applyFontSize(e.target.value)', 'changer la taille l’applique tout de suite');
has(toolbar, 'applyTextStyle({ fontFamily: e.target.value })', 'changer la police aussi');
ok(!RTE.includes("execCmd('fontSize'"), 'l’ancien menu de tailles execCommand (1…7) a disparu');
ok(!/>Small</.test(RTE) && !/>Normal</.test(RTE) && !/>Large</.test(RTE) && !/>Huge</.test(RTE),
  'plus aucun libellé Small / Normal / Large / Huge');

/* Le moteur de style : comment la règle est posée (et retirée). */
has(RTE, 'const styleRange = (el, range, styles) => {', 'le texte réglé passe dans un `<span>` (style EN LIGNE)');
has(RTE, 'set.forEach((p) => span.style.setProperty(p, styles[p]));', '…qui porte `font-family` / `font-size`');
has(RTE, 'const frag = range.extractContents();', 'la sélection est déplacée dans ce `<span>` (rien n’est perdu)');
has(RTE, 'props.forEach((p) => node.style.removeProperty(p))',
  'la règle déjà posée est RETIRÉE avant d’en poser une autre (pas deux tailles contradictoires)');
has(RTE, 'if (range.intersectsNode(n)) props.forEach((p) => n.style.removeProperty(p));',
  '…y compris sur les éléments que la sélection traverse');
has(RTE, 'if (!set.length || range.collapsed) return null;',
  'un choix vide (« As in the app ») enlève la règle au lieu d’en écrire une vide');
has(RTE, "Array.from(el.querySelectorAll('span[style]')).forEach((n) => {",
  'un `<span>` sans règle est déballé : le texte enregistré ne se remplit pas de balises vides');
has(RTE, 'const block = blocks.find((ch) => ch === range.startContainer || ch.contains(range.startContainer));',
  'un curseur sans sélection vise le PARAGRAPHE où l’on écrit');
has(RTE, 'whole.selectNodeContents(block);', '…tout le paragraphe, comme dans un traitement de texte');
has(RTE, 'const wasCaret = range.collapsed;', '…sans oublier qu’il n’y avait PAS de sélection');
has(RTE, 'after.setStart(range.startContainer, range.startOffset);',
  'le curseur revient à sa place (une sélection du paragraphe entier effacerait le texte à la première touche)');
has(RTE, '} else if (blocks.length > 1) {', 'une sélection sur plusieurs paragraphes est traitée BLOC PAR BLOC');
has(RTE, 'part.selectNodeContents(block);', '…pour ne jamais imbriquer un `<p>` dans un `<span>`');
has(RTE, 'selRef.current = after.cloneRange();',
  'la sélection est mémorisée après le réglage (on peut enchaîner police puis taille)');
has(RTE, "if ('fontFamily' in styles) clean.fontFamily = String(styles.fontFamily || '');",
  'la police et la taille sont les deux règles posées par ce moteur');
has(RTE, "if ('fontSize' in styles) clean.fontSize = String(styles.fontSize || '');", '…l’autre moitié');
has(RTE, "Number.isFinite(v) && v > 0 ? `${v}pt` : ''", 'la taille écrite est en points (ex. « 11pt »)');
has(RTE, "const [fontSizePt, setFontSizePt] = useState('');", 'la taille choisie est retenue par la barre d’outils');

/* ── 3. DÉPLACER UNE FIGURE À LA SOURIS ─────────────────────────────────── */
const fig = (id) => ({ id, caption: id, url: `https://example.org/${id}.png` });
const A = fig('f1');
const B = fig('f2');
const C = fig('f3');
const LISTS = { background: [A, B, C], conclusions: [fig('f9')] };

eq(FP.moveFigureTo(LISTS, { from: 'background', to: 'background', id: 'f3', before: 'f1' })
  .background.map((f) => f.id), ['f3', 'f1', 'f2'], 'une figure se dépose DEVANT celle qui la reçoit');
eq(FP.moveFigureTo(LISTS, { from: 'background', to: 'background', id: 'f1', before: '' })
  .background.map((f) => f.id), ['f2', 'f3', 'f1'], 'déposée dans le vide, elle va à la fin de la section');
eq(FP.moveFigureTo(LISTS, { from: 'background', to: 'background', id: 'f1', before: 'f1' }), LISTS,
  'la déposer sur elle-même ne change RIEN (même objet : aucune écriture)');
eq(FP.moveFigureTo(LISTS, { from: 'background', to: 'background', id: 'f3', before: '' }), LISTS,
  '…pas plus que la déposer à la place qu’elle occupe déjà');
eq(FP.moveFigureTo(LISTS, { from: 'background', to: 'background', id: 'inconnue', before: 'f1' }), LISTS,
  'une figure inconnue ne casse rien');
eq(FP.moveFigureTo(LISTS, { from: 'background', to: '', id: 'f1', before: '' }), LISTS,
  'sans section d’arrivée, rien ne bouge');
{
  const moved = FP.moveFigureTo(LISTS, { from: 'background', to: 'conclusions', id: 'f1', before: 'f9' });
  eq(moved.background.map((f) => f.id), ['f2', 'f3'], 'une figure déposée sur une AUTRE section la quitte');
  eq(moved.conclusions.map((f) => f.id), ['f1', 'f9'], '…et arrive devant la figure qui l’a reçue, avec sa légende');
  eq(LISTS.background.length, 3, 'les listes reçues ne sont jamais modifiées (l’util ne travaille que sur des copies)');
  eq(LISTS.conclusions.length, 1, '…dans aucune section');
}
eq(FP.moveFigureTo(LISTS, { from: 'background', to: 'funding', id: 'f2', before: '' }).funding.map((f) => f.id),
  ['f2'], 'une section encore vide (ou absente) reçoit quand même la figure');
eq(FP.moveFigureTo(LISTS, { from: 'background', to: 'funding', id: 'f2', before: 'pas-là' }).funding.map((f) => f.id),
  ['f2'], 'une cible introuvable range la figure à la fin, elle n’est jamais perdue');
eq(FP.moveFigureTo(undefined, { from: 'background', to: 'background', id: 'f1' }), {},
  'un projet sans figure ne casse rien');

/* Le câblage dans la page projet. */
has(PAGE, "import { moveFigureTo, splitAnchoredFigures } from '../../utils/figurePlacement';",
  'la page projet utilise le déplacement d’util');
has(PAGE, 'const dropFigure = (sec, beforeId) => {', '…par un lâcher : dropFigure(section, figure visée)');
has(PAGE, 'const next = moveFigureTo(current, { from: held.sec, to: sec, id: held.id, before: beforeId });',
  '…qui réécrit `project.figures` (l’ordre du document exporté)');
has(PAGE, 'if (next === current) return;', 'un dépôt sans effet n’écrit rien dans le projet');
has(PAGE, 'const [figDrag, setFigDrag] = useState(null);', 'la figure TENUE est suivie pendant le glissement');
has(PAGE, "const [figOver, setFigOver] = useState('');", '…et celle qui est DESSOUS est montrée à l’utilisateur');
has(PAGE, 'draggable={canModify}', 'les cartes ne se prennent à la souris que si l’utilisateur peut modifier le projet');
has(PAGE, 'setFigDrag({ sec: id, id: fig.id });', 'le glissement part de la carte de la figure, avec sa section');
has(PAGE, 'onDragOver={(e) => {', '…la carte sous le pointeur accepte le dépôt');
has(PAGE, "onDragLeave={() => { if (figOver === fig.id) setFigOver(''); }}", 'et l’indication disparaît quand on ressort');
has(PAGE, 'onDrop={(e) => { e.preventDefault(); dropFigure(id, fig.id); }}', 'le dépôt écrit la nouvelle place');
has(PAGE, 'drag a figure to change its place', 'le geste est annoncé à l’écran (sinon personne ne le devine)');
has(PAGE, '⋮⋮', '…avec une poignée sur chaque figure');

console.log(`_project_section_editing_test.mjs — ${passed} assertions passed`);


