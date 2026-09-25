/* =========================================================================
   _pub_doc_head_order_test.mjs — LA TÊTE DU DOCUMENT SUIT L'ORDRE DU PANNEAU.

   Le rapport, mot pour mot : « changing the order of sections in publication format
   still does not affect the structure of the final document ».

   Quatre des huit rangées du panneau « Publication format » — Title · Authors ·
   Affiliations · Project line — portent sur des blocs qui n'ont PAS d'intitulé : le
   document les écrit avec une classe que le programme pose lui-même (`pf-title`,
   `pf-authors`, `pf-affiliations`, `pf-meta`) et, dans un document ENREGISTRÉ
   (« 💾 Save changes » → `project.exportDocHtml`), `reorderDocHtml` ne regardait que
   les `<h2>`. Le titre, les auteurs, les affiliations et la ligne d'information ne
   bougeaient donc JAMAIS — ni à l'écran, ni à l'impression, qui recopie ce document —
   et « mettre l'auteur avant le titre » (l'exemple de la demande d'origine) restait
   sans effet.

   Ce qui est mesuré ici, sur le code livré :
     §1 LE VOCABULAIRE : les classes des quatre blocs de tête entrent dans les mots
        d'ordre (`pubDocOrderKeywords`), à la place que l'utilisateur leur a donnée ;
     §2 LE DOCUMENT ENREGISTRÉ, EXÉCUTÉ : `reorderDocHtml` déplace maintenant ces
        blocs — et ne touche à RIEN quand l'ordre est celui du programme ;
     §3 LE DOCUMENT SANS LES CLASSES (écrit à la main, ou enregistré avant que le
        programme les écrive) : comportement d'avant, au caractère près ;
     §4 L'IMPRESSION : le vocabulaire de l'écran est celui du papier ;
     §5 LE CÂBLAGE : les classes que la page écrit sont celles du vocabulaire.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// Les sources de src/ s'importent sans extension (résolues par Vite) — même crochet
// que _pub_doc_sections_test.mjs / _journal_formats_test.mjs.
register('./_esm_test_hook.mjs', import.meta.url);
const {
  PUB_LAYOUT_PARTS, buildPubDocOrder, pubDocOrderMoved, pubDocOrderKeywords,
  pubDocTitleKeywords, pubDocTitleOf
} = await import('./src/components/pubCitation.js');
const { reorderDocHtml } = await import('./src/components/journalFormats.js');
const { PROJECT_TEXT_SECTIONS } = await import('./src/utils/manuscriptImport.js');

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const PROJ = read('./src/components/AppModules/projectDetailModule.jsx');
const has = (hay, needle, what) => ok(String(hay).includes(needle), `${what}\n  introuvable : ${needle}`);

/* ══ 1. LE VOCABULAIRE : LES QUATRE BLOCS DE TÊTE PAR LEUR CLASSE ═════════════ */
const SECTIONS = PROJECT_TEXT_SECTIONS.map((s) => s.label);
const PROGRAM = buildPubDocOrder();
const classWords = pubDocOrderKeywords(PROGRAM, SECTIONS).filter((w) => w.startsWith('pf-'));
eq(classWords, ['pf-title', 'pf-authors', 'pf-affiliations', 'pf-meta'],
  'le vocabulaire nomme les quatre blocs de tête par la classe que la page leur écrit');
eq(pubDocOrderKeywords(PROGRAM, SECTIONS).slice(0, 4), classWords,
  '…et il les met EN TÊTE quand l’ordre du programme les met en tête');
eq(pubDocOrderKeywords(['methods', 'title', 'authors', 'affiliations', 'meta', 'sections', 'experiments', 'references'], SECTIONS)[0],
  'materials and methods',
  'un bloc déplacé en tête passe devant : la place dans le vocabulaire est celle que l’utilisateur a réglée');
eq(pubDocOrderKeywords(PROGRAM, SECTIONS).includes('pf-heading'), false,
  'le vocabulaire ne nomme jamais une classe de paragraphe (pf-heading, pf-body…) : rien de la page ne peut être pris pour une section');


/* ══ 2. LE DOCUMENT ENREGISTRÉ, EXÉCUTÉ ═════════════════════════════════════════
   Le balisage est celui que la page écrit VRAIMENT (classes recopiées du JSX, voir
   §5) : c'est exactement ce que « 💾 Save changes » enregistre (`el.innerHTML`). */
const TITLE = '<h1 class="pf-title text-2xl font-black text-slate-900 mb-1">Kinetics of the reaction</h1>';
const AUTHORS = '<p class="pf-authors text-sm font-semibold text-slate-800 mb-1">A. Rossi, B. Bianchi</p>';
const AFFIL = '<p class="pf-affiliations text-[11px] text-slate-500 italic whitespace-pre-line mb-2">University of X, Y</p>';
const META = '<p class="pf-meta text-xs text-slate-500 mb-6">Project: P · Scientist: S · Created: 1/1/2026</p>';
const H = (t) => `<h2 class="pf-heading text-base font-black text-slate-800 border-b border-slate-200 pb-1 mb-2">${t}</h2>`;
const SEC = (t, body) => `${H(t)}<div class="pf-body text-sm leading-relaxed"><p>${body}</p></div>`;
const BG = SEC('Scientific background', 'the context of the work');
const DISC = SEC('Results and Discussion', 'what the experiments show');
const CONCL = SEC('Conclusions', 'what we conclude');
const MM = SEC('Materials and Methods', 'how it was done');
const EXP = SEC('Experiments (2)', 'the tests, their figures and tables');
const REFS = `${H('References (5)')}<ol class="pf-bib"><li>Paper one</li></ol>`;
// Le document enregistré, dans l'ordre du programme.
const DOC = [TITLE, AUTHORS, AFFIL, META, BG, DISC, CONCL, MM, EXP, REFS].join('');
eq(DOC.indexOf('Materials and Methods') > DOC.indexOf('Conclusions'), true,
  'le document témoin part bien de l’ordre du programme (MM après les conclusions)');

const programWords = pubDocOrderKeywords(PROGRAM, SECTIONS);
eq(reorderDocHtml(DOC, programWords), DOC,
  'ordre du programme : le document enregistré sort IDENTIQUE, octet pour octet (rien ne bouge tout seul)');
eq(reorderDocHtml(DOC, programWords, pubDocTitleKeywords({})), DOC,
  '…et aucun intitulé choisi n’y change quoi que ce soit');

/* 2a. L'EXEMPLE DE LA DEMANDE : « mettre l'auteur avant le titre ». */
const authorsFirst = pubDocOrderMoved(PROGRAM, 'authors', -1);
eq(authorsFirst, ['authors', 'title', 'affiliations', 'meta', 'sections', 'conclusions', 'funding', 'supporting', 'methods', 'experiments', 'references'],
  'la rangée « Authors » remonte d’un cran dans le panneau');
const swapped = reorderDocHtml(DOC, pubDocOrderKeywords(authorsFirst, SECTIONS));
eq(swapped, [AUTHORS, TITLE, AFFIL, META, BG, DISC, CONCL, MM, EXP, REFS].join(''),
  'les auteurs passent DEVANT le titre dans le document ENREGISTRÉ (c’était l’exemple de la demande)');
eq(swapped.length, DOC.length, '…sans rien couper, dupliquer ni réécrire');
ok(swapped.indexOf('<p class="pf-authors') === 0, '…le bloc des auteurs ouvre le document');
ok(swapped.indexOf('the context of the work') > swapped.indexOf('Kinetics of the reaction'),
  '…et le texte de l’auteur est resté à sa place, derrière la tête');

/* 2b. La ligne d'information aussi, et le titre peut descendre. */
const titleLast = (() => { let o = PROGRAM; for (let i = 0; i < 3; i += 1) o = pubDocOrderMoved(o, 'title', 1); return o; })();
eq(titleLast.slice(0, 4), ['authors', 'affiliations', 'meta', 'title'], 'trois ▼ emmènent le titre après la ligne d’information');
eq(reorderDocHtml(DOC, pubDocOrderKeywords(titleLast, SECTIONS)),
  [AUTHORS, AFFIL, META, TITLE, BG, DISC, CONCL, MM, EXP, REFS].join(''),
  '…et le document suit exactement cet ordre-là');

/* 2c. Les sections se déplacent TOUJOURS (le correctif précédent ne régresse pas). */
const methodsLast = pubDocOrderMoved(pubDocOrderMoved(PROGRAM, 'methods', 1), 'methods', 1);
eq(reorderDocHtml(DOC, pubDocOrderKeywords(methodsLast, SECTIONS)),
  [TITLE, AUTHORS, AFFIL, META, BG, DISC, CONCL, EXP, REFS, MM].join(''),
  '« Materials and Methods » après « Experiments » (le panneau, pas seulement le journal)');
const sectionsLast = (() => { let o = PROGRAM; for (let i = 0; i < 3; i += 1) o = pubDocOrderMoved(o, 'sections', 1); return o; })();
eq(reorderDocHtml(DOC, pubDocOrderKeywords(sectionsLast, SECTIONS)),
  [TITLE, AUTHORS, AFFIL, META, CONCL, BG, DISC, MM, EXP, REFS].join(''),
  'la rangée « Text sections » descend le contexte et les résultats SANS emporter les trois sections qui ont leur rengée à elles (c’est le sens de la demande : chacune se règle)');
const sectionsFirst = (() => { let o = PROGRAM; for (let i = 0; i < 4; i += 1) o = pubDocOrderMoved(o, 'sections', -1); return o; })();
eq(sectionsFirst.slice(0, 4), ['sections', 'title', 'authors', 'affiliations'], 'quatre ▲ amènent les sections avant le titre');
eq(reorderDocHtml(DOC, pubDocOrderKeywords(sectionsFirst, SECTIONS)),
  [BG, DISC, TITLE, AUTHORS, AFFIL, META, CONCL, MM, EXP, REFS].join(''),
  '…et la tête suit les sections, entière et dans son ordre (les conclusions suivent la tête : elles ont leur propre rangée)');

/* 2d. UN INTITULÉ CHOISI PART AVEC SON BLOC, quel que soit le côté de la tête. */
const renamed = reorderDocHtml(DOC, pubDocOrderKeywords(authorsFirst, SECTIONS),
  pubDocTitleKeywords({ docTitles: { methods: 'Experimental section' } }));
ok(renamed.includes('<h2 class="pf-heading text-base font-black text-slate-800 border-b border-slate-200 pb-1 mb-2">Experimental section</h2>'),
  'l’intitulé choisi s’écrit sur le texte enregistré, attributs du `<h2>` compris');
ok(!renamed.includes('Materials and Methods'), '…et l’ancien intitulé a disparu');
eq(renamed.indexOf('Experimental section') > renamed.indexOf('Kinetics'), true,
  '…le tout en gardant les auteurs devant le titre');
eq(pubDocTitleOf({ methods: 'Experimental section' }, 'methods'), 'Experimental section',
  'l’intitulé du panneau est celui que le document doit écrire');
eq(pubDocTitleOf({ methods: '  ' }, 'methods'), 'Materials and Methods',
  '…et un champ vidé rend l’intitulé du programme');

/* 2e. RIEN DE CE QUE L'AUTEUR A ÉCRIT N'EST PRIS POUR UN BLOC. */
const withTrap = DOC.replace('what we conclude', '<h2>My own methods</h2><p>a paragraph the author wrote</p>');
const trapped = reorderDocHtml(withTrap, pubDocOrderKeywords(authorsFirst, SECTIONS));
ok(trapped.includes('<h2>My own methods</h2><p>a paragraph the author wrote</p>'),
  'un `<h2>` de l’auteur reste intact et ne reçoit aucun intitulé du programme');
ok(trapped.includes('Kinetics of the reaction') && trapped.startsWith('<p class="pf-authors'),
  '…et le déplacement des blocs du programme se fait quand même');
eq(reorderDocHtml(DOC, pubDocOrderKeywords(authorsFirst, SECTIONS), { 'pf-title': 'Pirate' }),
  reorderDocHtml(DOC, pubDocOrderKeywords(authorsFirst, SECTIONS)),
  'un « intitulé » qui viserait une classe de tête ne réécrit rien (on ne renomme que des <h2>)');

/* ══ 3. UN DOCUMENT SANS LES CLASSES : COMPORTEMENT D'AVANT, AU CARACTÈRE PRÈS ═
   Écrit à la main, importé d'un .docx, ou enregistré avant que le programme écrive
   ses classes : il n'a que des `<h2>`. La tête ne peut pas s'y déplacer — c'est
   exactement ce qu'elle faisait, et rien d'autre ne doit changer. */
const OLD = ['<h1>Titre</h1>', '<p>Rossi M</p>', BG, DISC, CONCL, MM, EXP, REFS].join('');
eq(reorderDocHtml(OLD, programWords), OLD, 'sans classes : l’ordre du programme ne bouge rien');
eq(reorderDocHtml(OLD, pubDocOrderKeywords(authorsFirst, SECTIONS)), OLD,
  '…et les ▲▼ de la tête n’y déplacent rien (aucun bloc à reconnaître : voir §5)');
eq(reorderDocHtml(OLD, pubDocOrderKeywords(methodsLast, SECTIONS)),
  ['<h1>Titre</h1>', '<p>Rossi M</p>', BG, DISC, CONCL, EXP, REFS, MM].join(''),
  '…alors que les <h2>, eux, s’y déplacent comme avant');
eq(reorderDocHtml('', programWords), '', 'une chaîne vide sort vide');
eq(reorderDocHtml(DOC, [], {}), DOC, 'sans ordre ni intitulé, l’HTML sort intact');
eq(reorderDocHtml(DOC, [], { 'materials and methods': 'Experimental section' }).includes('Experimental section'), true,
  'un intitulé choisi s’écrit même sans ordre (renommer n’est pas réordonner)');

/* ══ 4. L'IMPRESSION COPIE CE DOCUMENT : LES MÊMES MOTS D'ORDRE ════════════════
   `printProjectDoc` prend `docEl.innerHTML` — le document DÉJÀ réordonné par l'écran
   — et le réordonne avec `docOrderWords(pubFormat)` : appliquer l'ordre deux fois ne
   doit rien déplacer une seconde fois, et l'ordre du papier est celui de l'écran. */
const once = reorderDocHtml(DOC, pubDocOrderKeywords(authorsFirst, SECTIONS));
eq(reorderDocHtml(once, pubDocOrderKeywords(authorsFirst, SECTIONS)), once,
  'réordonner deux fois ne rebouge rien (l’écran et le papier montrent le même document)');
eq(reorderDocHtml(reorderDocHtml(DOC, programWords), pubDocOrderKeywords(authorsFirst, SECTIONS)), once,
  '…et l’ordre demandé s’applique aussi à un HTML déjà passé une fois par le programme');
has(PROJ, 'bodyHtml = reorderDocHtml(bodyHtml, docOrderWords(pubFormat), pubDocTitleKeywords(pubFormat));',
  'l’impression / le PDF réordonne avec les mêmes mots d’ordre que l’écran');
has(PROJ, 'const docOrderWords = (fmt) => {',
  '…par la même liste de mots (docOrderWords, écrite une seule fois dans la page)');
has(PROJ, 'fmt && fmt.docOrder,', '…lue dans `docOrder` du format, comme le document vivant');
has(PROJ, '__html: docHeadSpacedHtml(reorderDocHtml(',
  'le document ENREGISTRÉ affiché est réordonné lui aussi — et reçoit ses lignes vides de tête (voir _pub_doc_head_lines_test.mjs)');

/* ══ 5. LE CÂBLAGE : LES CLASSES DU VOCABULAIRE SONT CELLES QUE LA PAGE ÉCRIT ══
   C'est le maillon faible : une classe renommée dans la page ferait retomber les
   quatre blocs de tête dans le silence, sans qu'aucune autre suite ne le voie. */
has(PROJ, 'className="pf-title text-2xl font-black text-slate-900 mb-1"', 'la page écrit la classe du titre');
has(PROJ, 'className="pf-authors text-sm font-semibold text-slate-800 mb-1"', '…celle des auteurs');
has(PROJ, 'className="pf-affiliations text-[11px] text-slate-500 italic whitespace-pre-line mb-2"', '…celle des affiliations');
has(PROJ, 'className="pf-meta text-xs text-slate-500 mb-6"', '…et celle de la ligne d’information');
classWords.forEach((w) => has(PROJ, `className="${w} `,
  `la classe « ${w} » du vocabulaire est bien celle que la page écrit (sinon la rangée du panneau ne déplacerait rien)`));
const layoutText = JSON.stringify(PUB_LAYOUT_PARTS);
classWords.forEach((w) => eq(layoutText.includes(`.${w}`), true,
  `« ${w} » est une classe que le « Publication format » connaît déjà (pubLayoutCss : mise en forme, ou exclusion du texte)`));

console.log(`_pub_doc_head_order_test.mjs — ${passed} assertions OK (la tête du document suit l’ordre du panneau)`);

