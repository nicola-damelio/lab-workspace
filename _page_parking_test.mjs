/* =========================================================================
   _page_parking_test.mjs — LA PAGE QUITTÉE RESTE VIVANTE (une seule à la fois).

   La demande, mot pour mot : « Sometimes loading of files is very long and in the
   meantime i could do something else. can the loading be done in background while
   I change page to work elsewhere? » — et le choix retenu :
   « Keep alive EVERY page I leave (one at a time, hidden): nothing ever reloads
   when I come back — loading or not (more memory kept) ».

   POURQUOI LE DÉFAUT EXISTAIT. Changer de page rendait un autre module et
   DÉMONTAIT celui qu'on quittait : le viewer 3D détruisait sa scène
   (`stage.dispose()`) et son chargement en cours s'arrêtait, si bien qu'une
   longue structure — ou une trajectoire — repartait de ZÉRO au retour.

   CE QUI EST VÉRIFIÉ ICI :

     §1 LES TROIS RÈGLES PURES, EXÉCUTÉES (extraites de src/App.jsx) :
        `parkedAfter`   — la page à garder quand on quitte celle-ci ;
        `pageSlotIds`   — les places à monter, la page AFFICHÉE en tête ;
        `pageSlotClass` — `contents` (affichée) / `hidden` (gardée).
        C'est l'ORDRE de `pageSlotIds` qui fait vivre le mécanisme : avec
        `key={id}`, une page qui change d'index entre ses frères est DÉPLACÉE par
        React, pas reconstruite.
     §2 LE MÉCANISME, dans App.jsx : l'état `parkedModule` (UN SEUL identifiant,
        écrasé à chaque départ), l'effet sur `currentModule`, l'événement
        `resize` redonné à la page qui revient (NGL n'écoute QUE lui), et la
        construction des places.
     §3 CHAQUE PAGE A SA PLACE — les quatorze pages de la zone principale,
        nommément : une page sans place ne serait jamais gardée vivante.
     §4 LES EXCEPTIONS, et elles sont voulues : les deux pages « storage »
        (StorageModule est monté EN PERMANENCE : le garder ferait une seconde
        page storage) ne sont ni gardées ni placées.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu : ${JSON.stringify(a)}`);
  passed += 1;
};

const APP = readFileSync(new URL('./src/App.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const maskOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
const MASK = maskOf(APP);
const has = (needle, what) => ok(APP.includes(needle), `${what}\n  introuvable : ${needle}`);
const lacks = (needle, what) => ok(!APP.includes(needle), `${what}\n  TROUVÉ (ne devrait pas) : ${needle}`);

/* Extraction : `const name = (…) => …;` (le `export` éventuel reste dehors). */
const sliceDecl = (src, name) => {
  const head = `const ${name} = `;
  const start = src.indexOf(head);
  assert.ok(start >= 0, `déclaration ${name} introuvable`);
  let depth = 0;
  for (let i = start + head.length; i < src.length; i += 1) {
    const c = MASK[i];
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') depth -= 1;
    else if (c === ';' && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`${name} : déclaration non terminée`);
};

/* ══ §1. LES TROIS RÈGLES, EXÉCUTÉES ═════════════════════════════════════════ */
const RULES = new Function([
  sliceDecl(APP, 'parkedAfter'),
  sliceDecl(APP, 'pageSlotIds'),
  sliceDecl(APP, 'pageSlotClass'),
  'return { parkedAfter, pageSlotIds, pageSlotClass };',
].join('\n'))();
const { parkedAfter, pageSlotIds, pageSlotClass } = RULES;

eq(parkedAfter('library'), 'library', 'la page qu’on quitte est gardée telle quelle');
eq(parkedAfter('active-test'), 'active-test', '…y compris une page d’expérience (le viewer qui charge)');
eq(parkedAfter('image-builder'), 'image-builder', '…et l’Image Builder (une toile en cours d’édition)');
eq(parkedAfter(null), null, 'sans page quittée, rien à garder');
eq(parkedAfter(''), null, '…et une valeur vide ne garde rien');
eq(parkedAfter(undefined), null, '…ni une valeur absente');
eq(parkedAfter('storage'), null,
  'les deux pages « storage » NE sont pas gardées : StorageModule est déjà monté en permanence');
eq(parkedAfter('storage-detail'), null, '…ni sa page de détail');

eq(pageSlotIds('tests', null), ['tests'], 'une seule place quand rien n’est gardé');
eq(pageSlotIds('tests', 'library'), ['tests', 'library'],
  'la page AFFICHÉE vient en tête, la page gardée ensuite (c’est cet ordre qui fait le déplacement)');
eq(pageSlotIds('library', 'tests'), ['library', 'tests'],
  '…et au retour c’est l’ordre inverse : les deux places échangent leur rang, elles ne disparaissent pas');
eq(pageSlotIds('library', 'library'), ['library'],
  'jamais deux fois la même page (la page gardée qui redevient affichée n’est montée qu’une fois)');
eq(pageSlotIds('', null), ['dashboard'], 'sans page connue, la place par défaut est l’accueil');
eq(pageSlotIds(null, 'tests'), ['dashboard', 'tests'], '…la page gardée reste gardée à côté d’elle');

eq(pageSlotClass('tests', 'tests'), 'contents',
  'la page affichée est en `display: contents` : sa boîte ne compte pas dans la mise en page');
eq(pageSlotClass('library', 'tests'), 'hidden',
  'la page gardée est en `display: none` : invisible, mais toujours MONTÉE');
eq(pageSlotClass('library', 'library'), 'contents', 'la page gardée qui redevient affichée se réaffiche');

/* ══ §2. LE MÉCANISME (src/App.jsx) ══════════════════════════════════════════ */
has('const [parkedModule, setParkedModule] = useState(null);',
  'l’état de la page gardée existe');
/* LE POINT QUI FAIT TOUT : l’ajustement se fait PENDANT LE RENDU. Dans un effet,
   il s’exécuterait après : pendant UN rendu la page quittée ne serait ni
   affichée ni gardée, React la démonterait, et le rendu suivant la remonterait
   vide. La sonde _page_parking_render_test.cjs mesure ce piège pour de vrai. */
has('const [shownSeen, setShownSeen] = useState(currentModule);',
  'on retient la page affichée du dernier rendu, pour savoir LAQUELLE on vient de quitter');
has('if (shownSeen !== currentModule) {',
  'le changement de page est rattrapé DANS le rendu (pas dans un effet)');
has('setShownSeen(currentModule);', '…et les deux états sont ajustés d’un coup');
has('setParkedModule(parkedAfter(shownSeen));',
  '…la page quittée REMPLACE la page gardée (une seule à la fois — jamais un ensemble qui grossit)');
lacks('shownModuleRef', '…aucun effet ne s’en mêle : l’état ne passe jamais par un rendu intermédiaire');
lacks('parkedModules', '…et il n’y a pas de collection de pages gardées');
/* La page qui revient était `display: none` : NGL n'écoute QUE `resize`. */
has("window.dispatchEvent(new Event('resize'))",
  'la page qui revient reçoit un `resize` : une toile mesurée à zéro resterait blanche');
has('}, [currentModule]);', '…au moment où la page change, donc juste après être redevenue visible');
has('const pageSlots = pageSlotIds(currentModule, parkedModule);',
  'les places rendues viennent de la règle pure');
has('const pageSlot = (id, render) => {', 'chaque page est rendue par UNE place');
/* ⚠ LA PAGE GARDÉE NE SE RE-REND PLUS À CHAQUE RENDU D'App — le correctif de l'enquête
   « le programme est devenu très lent » : son ÉLÉMENT est gardé dans une ref et redonné
   tel quel, donc React saute tout le sous-arbre. La page AFFICHÉE, elle, rend toujours
   frais, et le cache est jeté dès que la place gardée change. Ce que la place garantit
   par ailleurs (sa `key`, son rang, sa classe) ne bouge pas. */
has('const parkedElRef = useRef(null);', 'l’élément de la page gardée est RETENU dans une ref');
has('parkedElRef.current = render();', '…capturé quand la page devient la page gardée');
has('{parkedElRef.current}', '…et redonné TEL QUEL tant qu’elle est cachée (React saute le sous-arbre)');
has('if (id === currentModule) {', 'la page AFFICHÉE rend toujours frais (aucun cache pour elle)');
has('if (parkedIdRef.current && parkedIdRef.current !== parkedModule) {',
  '…et le cache est jeté dès que la place gardée change : l’élément de l’ancienne ne vaut plus rien');
has('pageSlots.includes(id)',
  '…et cette place ne monte QUE les pages listées : aucune autre page n’est montée (sinon les quatorze vivraient)');
has('<div key={id} data-page={id} className={pageSlotClass(id, currentModule)}>{render()}</div>',
  'la place garde SA `key` et sa position : React réutilise donc l’arbre au lieu de le reconstruire');
has('règle des clés de React', '…et le code DIT pourquoi la `key` est là');

/* ══ §3. CHAQUE PAGE DE LA ZONE PRINCIPALE A SA PLACE ════════════════════════ */
/* Une page oubliée ne serait jamais gardée vivante : ses chargements en cours
   repartiraient de zéro au retour, exactement le défaut d'origine. */
const PAGE_SLOTS = [
  ['dashboard', 'DashboardModule'], ['projects', 'ProjectsModule'],
  ['project-detail', 'ProjectDetailModule'], ['library', 'LibraryModule'],
  ['settings', 'SettingsModule'], ['agenda', 'AgendaModule'],
  ['tests', 'TestsModule'], ['protocols', 'ProtocolsModule'],
  ['active-test', 'ActiveTestModule'], ['notebook', 'NotebookModule'],
  ['calculations', 'CalculationsModule'], ['publications', 'PublicationsModule'],
  ['image-builder', 'ImageBuilderModule'], ['administration', 'AdministrationModule'],
];
for (const [id, component] of PAGE_SLOTS) {
  ok(APP.includes(`{pageSlot('${id}', () => (<`) && APP.includes(component),
    `la page « ${id} » est montée par une place, et cette place monte bien ${component}`);
}
lacks("{currentModule === '",
  'aucune page n’est plus conditionnée par `currentModule` en clair (tout passe par les places)');

/* ══ §4. LES EXCEPTIONS, VOULUES ═════════════════════════════════════════════ */
has('            <StorageModule\n              currentModule={currentModule} tests={tests}',
  'StorageModule reste monté en permanence, hors des places (son état ne meurt jamais)');
lacks("pageSlot('storage'", '…et n’a donc aucune place : le garder ferait une SECONDE page storage');
lacks("pageSlot('storage-detail'", '…ni sa page de détail');

/* ── Bilan ──────────────────────────────────────────────────────────────── */
console.log(`_page_parking_test.mjs — ${passed} assertions OK (la page quittée reste vivante, une seule à la fois)`);
