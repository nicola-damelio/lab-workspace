/* =========================================================================
   _figure_placement_test.mjs — les figures d'un manuscrit importé
   réapparaissent À LEUR PLACE dans le document exporté.

   Ce que l'utilisateur demande :
     « les figures ne sont pas importées : elles doivent être ajoutées comme
       figures de l'Image Builder et placées dans le texte seulement quand on
       clique sur le document d'export »

   Donc : la figure vit dans les figures de la SECTION du projet (listes
   éditables, comme « 📤 Insert into project… ») et le document exporté la
   remet dans le texte, juste après le paragraphe qui la précédait dans
   l'article (son ANCRE). Vérifié ici sur le module RÉEL
   (src/utils/figurePlacement.js) : le HTML produit, la position d'insertion,
   les ancres échappées (« & »), les ancres qui traversent un lien de citation,
   et le repli quand l'ancre a disparu.
   ========================================================================= */
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

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
const between = (html, before, after, what) => {
  const i = html.indexOf(before);
  const j = html.indexOf(after);
  assert.ok(i !== -1 && j !== -1 && i < j, `${what}\n  « ${before} » doit précéder « ${after} »\n  ${html}`);
  passed += 1;
};

const FIG = { id: 'f1', url: 'https://lh3.googleusercontent.com/d/abc', caption: 'Figure 1. Aphids transmit viruses.' };

/* ── 1. Le HTML d'une figure ─────────────────────────────────────────────── */
const html = FP.figureHtml(FIG);
has(html, '<figure', 'une figure est un <figure>');
has(html, 'src="https://lh3.googleusercontent.com/d/abc"', 'la figure porte son image');
has(html, '<figcaption', 'une légende accompagne la figure');
has(html, 'Figure 1. Aphids transmit viruses.', 'la légende est reprise');
has(html, 'break-inside:avoid', 'la feuille de style d’export sait couper la page proprement');
eq(FP.figureHtml({ url: '' }), '', 'sans image, il n’y a rien à insérer');
ok(FP.figureHtml({ url: 'a"b' }).includes('src="a&quot;b"'), 'un guillemet dans l’URL ne casse pas l’attribut');
ok(FP.figureHtml({ url: 'x', caption: 'A & B <c>' }).includes('A &amp; B &lt;c&gt;'), 'la légende est échappée');

/* ── 2. La figure reprend sa place APRÈS son paragraphe ──────────────────── */
const SECTION = [
  '<p>Introduction. Aphids are vectors.</p>',
  '<p>The virus was purified from infected plants.</p>',
  '<p>Conclusions. The results agree with the literature.</p>'
].join('\n');

const one = FP.splitAnchoredFigures(SECTION, [{ ...FIG, anchor: 'The virus was purified from infected plants.' }]);
eq(one.placed.length, 1, 'la figure est placée dans le texte');
eq(one.rest.length, 0, 'il ne reste rien à afficher après la section');
between(one.html, 'The virus was purified from infected plants.</p>', '<figure', 'la figure vient APRÈS son paragraphe');
between(one.html, '<figure', 'Conclusions. The results agree with the literature.', 'la figure ne coupe pas la suite du texte');

/* L'ancre passe par un LIEN de citation : « [12] » est devenu [<a …>12</a>]. */
const LINKED = '<p>As shown before [<a href="#ref-12" class="cite-ref">12</a>].</p>\n<p>Next paragraph.</p>';
const cited = FP.splitAnchoredFigures(LINKED, [{ ...FIG, anchor: 'As shown before [12].' }]);
eq(cited.placed.length, 1, 'une ancre dont la citation est devenue un lien est retrouvée');
between(cited.html, '[<a href="#ref-12" class="cite-ref">12</a>].</p>', '<figure', 'la figure suit le paragraphe lié');

/* Une ancre échappée (« & » du texte → « &amp; » du HTML). */
const AMP = '<p>Growth &amp; yield were measured.</p>\n<p>Then.</p>';
eq(FP.splitAnchoredFigures(AMP, [{ ...FIG, anchor: 'Growth & yield were measured.' }]).placed.length, 1,
  'une ancre contenant « & » est retrouvée');

/* Dans une liste, la figure sort APRÈS l'élément. */
const LIST = '<ul><li>Aphids feed on phloem.</li><li>They transmit luteoviruses.</li></ul>\n<p>Text.</p>';
const listed = FP.splitAnchoredFigures(LIST, [{ ...FIG, anchor: 'Aphids feed on phloem.' }]);
between(listed.html, '<li>Aphids feed on phloem.</li>', '<figure', 'la figure sort après l’élément de liste');

/* ── 4. Une section HÉRITÉE : lignes nues, SANS aucune balise de bloc ─────── */
/* Ce que l'import d'un manuscrit écrivait dans les sections avant le
   17/09/2026 : `htmlFromManuscriptPart` mettait les paragraphes côte à côte,
   séparés par des « \n », sans <p>. Comme aucun « </p> » ne suivait l'ancre,
   blockEndAfter rendait la FIN DE LA SECTION : toutes les figures du document
   s'y empilaient — la plainte « avant, les figures étaient à leur place ». */
const LEGACY = [
  'Aphids transmit potyviruses [1].',
  'The virus was purified from infected plants.',
  'Figure 1. Transmission rates.'
].join('\n');
const legacy = FP.splitAnchoredFigures(LEGACY, [
  { ...FIG, id: 'a', anchor: 'Aphids transmit potyviruses [1].' },
  { ...FIG, id: 'b', anchor: 'The virus was purified from infected plants.' }
]);
eq(legacy.placed.map((f) => f.id), ['a', 'b'], 'sans bloc, les figures restent placées dans l’ordre du document');
eq(legacy.rest.length, 0, '…aucune n’est renvoyée après la section');
between(legacy.html, 'Aphids transmit potyviruses [1].', '<figure', 'la première suit SON paragraphe');
between(legacy.html, '<figure', 'The virus was purified from infected plants.', '…et la seconde suit le sien (ordre du document)');
eq((legacy.html.match(/<figure/g) || []).length, 2, 'les deux figures sont dans le texte');
eq(legacy.html.trimEnd().endsWith('Figure 1. Transmission rates.'), true,
  'la dernière ligne reste la dernière : la section n’est plus une pile de figures');

/* Un `<br>` (section écrite à la main ou texte collé) est aussi une fin de ligne. */
const brLegacy = FP.splitAnchoredFigures('Ligne une<br>Ligne deux<br>', [{ ...FIG, anchor: 'Ligne une' }]);
between(brLegacy.html, 'Ligne une<br>', '<figure', 'le <br> sert de repère quand il n’y a pas de bloc');
eq(brLegacy.rest.length, 0, '…et la figure n’est pas renvoyée à la fin');

/* ── 5. Repli : ancre disparue, figure sans ancre, ordre conservé ────────── */
const lost = FP.splitAnchoredFigures(SECTION, [{ ...FIG, anchor: 'A paragraph that was rewritten since.' }]);
eq(lost.placed.length, 0, 'une ancre introuvable n’insère rien');
eq(lost.html, SECTION, 'le texte de la section est alors inchangé');
eq(lost.rest.map((f) => f.id), [FIG.id], 'la figure est rendue APRÈS la section (rien n’est perdu)');

const noAnchor = FP.splitAnchoredFigures(SECTION, [{ ...FIG }]);
eq(noAnchor.rest.length, 1, 'une figure sans ancre reste après la section');
eq(noAnchor.html, SECTION, 'et le texte reste intact');

const two = FP.splitAnchoredFigures(SECTION, [
  { ...FIG, id: 'a', anchor: 'Introduction. Aphids are vectors.' },
  { ...FIG, id: 'b', anchor: 'Introduction. Aphids are vectors.' }
]);
eq(two.placed.map((f) => f.id), ['a', 'b'], 'deux figures de même ancre sont posées dans l’ordre');
between(two.html, 'Introduction. Aphids are vectors.</p>', '<figure', 'la première suit le paragraphe');
ok((two.html.match(/<figure/g) || []).length === 2, 'les deux figures sont dans le texte');

eq(FP.figureInsertIndex('', 'x'), -1, 'sans HTML, pas d’insertion');
eq(FP.figureInsertIndex('<p>a</p>', ''), -1, 'sans ancre, pas d’insertion');
eq(FP.anchoredFigureCount([{ anchor: 'x' }, { anchor: '' }, {}]), 1, 'seules les figures ancrées sont comptées');

console.log(`_figure_placement_test.mjs — ${passed} assertions passed`);
