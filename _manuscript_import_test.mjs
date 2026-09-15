/* =========================================================================
   _manuscript_import_test.mjs — importer un MANUSCRIT Google Docs / Word
   (citations Paperpile) DANS un projet.

   Ce que l'utilisateur demande :
     « transférer le TEXTE du document dans les sous-sections du projet, avec
       les références Paperpile converties en références du programme, rangées
       dans la page Publications → “Project bibliography” »
   Donc, et c'est ce qui est vérifié ici avec le module RÉEL
   (src/utils/manuscriptImport.js) :
     • le texte est découpé par ses TITRES et chaque partie sait quelle section
       du projet elle vise (Background / Discussion / Conclusions) ;
     • la bibliographie de fin de document est analysée par referenceImport et
       AJOUTÉE à la « Project bibliography » (rien n'est écrasé) ;
     • les citations du texte ([1,2], (Rossi et al., 2018)…) deviennent les
       références NUMÉROTÉES du programme — la numérotation du PROJET, pas
       celle du document ; une citation sans papier correspondant reste telle
       quelle (rien n'est inventé).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const MS = await import('./src/utils/manuscriptImport.js');
const PROJ = readFileSync('./src/components/AppModules/projectDetailModule.jsx', 'utf8');
const RTE = readFileSync('./src/components/RichTextEditor.jsx', 'utf8');

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

/* ── 1. Blocs : un titre n'est pas une phrase ─────────────────────────────── */
ok(MS.isHeadingLine('1. Introduction'), 'une ligne numérotée courte est un titre');
ok(MS.isHeadingLine('REFERENCES'), 'une ligne en majuscules est un titre');
ok(MS.isHeadingLine('Materials and Methods'), 'un intitulé court est un titre');
ok(!MS.isHeadingLine('Le virus a été purifié puis conservé à -80 °C.'), 'une phrase n’est PAS un titre');
ok(!MS.isHeadingLine('https://doi.org/10.1016/j.bbamem.2018.01.001'), 'un DOI n’est pas un titre');
eq(MS.headingLabel('2. Discussion'), 'Discussion', 'un titre perd sa numérotation');
eq(MS.blocksFromText('Titre\n\nUn paragraphe.').map((b) => b.kind), ['heading', 'paragraph'],
  'le texte devient des blocs titre / paragraphe');

/* ── 2. Le manuscrit se coupe avant sa bibliographie ─────────────────────── */
const DOC = [
  'Aphid transmission of plant viruses',
  '',
  '1. Introduction',
  'Aphids transmit many plant viruses (Rossi et al., 2018), as shown before [1,2].',
  '',
  '2. Discussion',
  'Our data agree with (Smith & Bianchi, 2020) but not with (Lefèvre, 2019).',
  'A remaining point is unresolved (Unknown, 2030).',
  '',
  '3. Conclusions',
  'Further work is needed [3].',
  '',
  'References',
  '1. Rossi M, Bianchi A (2018). Peptide-membrane interactions. BBA 1860:1234-1245. doi:10.1016/j.bbamem.2018.01.001',
  '2. Smith J, Bianchi A (2020). Aphid vectors of plant viruses. J Virol 94:e00123.',
  '3. Lefèvre C (2019). Transmission efficiency. Phytopathology 109:1-10.'
].join('\n');

const blocks = MS.blocksFromText(DOC);
const manuscript = MS.splitManuscript(blocks);
eq(manuscript.referencesHeading, 'References', 'la bibliographie de fin de document est reconnue');
eq(manuscript.referencesText.split('\n').length, 3, '…et ses 3 références isolées');
ok(!manuscript.body.some((b) => /Peptide-membrane/.test(b.text)), 'le corps du texte ne contient plus la bibliographie');

/* ── 3. Chaque partie vise une section du projet ─────────────────────────── */
const parts = MS.groupManuscriptParts(manuscript.body);
eq(parts.map((p) => p.heading), ['', 'Introduction', 'Discussion', 'Conclusions'],
  'le chapeau (titre du document) puis les parties titrées');
eq(parts.map((p) => p.id), ['', 'background', 'discussion', 'conclusions'],
  'les titres du manuscrit sont associés aux sections du projet');
ok(parts[0].text.includes('Aphid transmission'), 'ce qui précède le premier titre reste dans une partie à part');
eq(parts[1].text.includes('Aphids transmit many plant viruses'), true, 'le texte de chaque partie est disponible');
eq(MS.guessSectionForHeading('Materials and Methods'), '', 'une section sans équivalent n’est PAS devinée');
eq(MS.PROJECT_TEXT_SECTIONS.map((s) => s.id), ['background', 'discussion', 'conclusions'],
  'les sections cibles sont celles de la page projet');

/* ── 4. Les citations trouvées dans le texte ─────────────────────────────── */
const found = MS.collectCitations(parts.map((p) => p.text).join('\n\n'));
eq(found.map((c) => c.raw), ['(Rossi et al., 2018)', '[1,2]', '(Smith & Bianchi, 2020)', '(Lefèvre, 2019)', '(Unknown, 2030)', '[3]'],
  'les citations numériques ET auteur-année sont repérées, dans l’ordre');
eq(MS.numericCitationNumbers('5-7'), [5, 6, 7], 'une plage [5-7] est développée');
eq(MS.numericCitationNumbers('1, 4'), [1, 4], 'une liste [1,4] est séparée');
eq(MS.authorYearKeyOf('Rossi et al., 2018'), 'rossi2018', 'la clé d’une citation auteur-année est le 1er auteur + l’année');
eq(MS.authorYearKeyOf('Smith & Bianchi, 2020'), 'smith2020', '…même avec deux auteurs');
eq(MS.authorYearKeyOf('Annexe sans année'), '', 'sans année, aucune clé');

/* ── 5. Le plan : la numérotation du PROJET, pas celle du document ───────── */
const plan = MS.buildManuscriptPlan(manuscript, { existingReferences: [] });
eq(plan.entries.length, 3, 'les 3 références de la bibliographie du document sont analysées');
eq(plan.entries.map((e) => e.number), [1, 2, 3], 'elles reçoivent les numéros 1, 2, 3 (document vide)');
eq(plan.entries.map((e) => e.isNew), [true, true, true], '…et sont toutes nouvelles pour le projet');
eq(plan.unresolved.length, 1, 'la citation sans papier correspondant reste non résolue');
eq(plan.unresolved[0].raw, '(Unknown, 2030)', '…et c’est bien celle-là');

// Un projet qui a DÉJÀ ses références : le document se numérote APRÈS, et un
// papier déjà cité (même DOI) garde SON numéro.
const existing = [
  { id: 'r1', number: 7, title: 'Peptide-membrane interactions', doi: '10.1016/j.bbamem.2018.01.001' },
  { id: 'r2', number: 1, title: 'Un autre papier', doi: '10.1/other' }
];
const plan2 = MS.buildManuscriptPlan(manuscript, { existingReferences: existing });
eq(plan2.entries.map((e) => e.number), [7, 8, 9], 'un papier déjà référencé garde son numéro, les autres suivent');
eq(plan2.entries.map((e) => e.isNew), [false, true, true], '…et le projet sait lesquelles sont nouvelles');
eq(MS.lookupNumber(plan2.numberByKey, '#1'), 7, '« [1] » du document devient le n° 7 du projet');
eq(MS.lookupNumber(plan2.numberByKey, 'lefèvre2019'), 9, '« (Lefèvre, 2019) » devient le n° 9');
eq(MS.lookupNumber(plan2.numberByKey, 'inconnu2099'), 0, 'une citation inconnue ne reçoit aucun numéro');

/* ── 6. La réécriture des citations ──────────────────────────────────────── */
const converted = MS.convertCitationsInText(
  'See [1,2] and (Rossi et al., 2018) plus (Unknown, 2030).',
  plan2.numberByKey
);
eq(converted.text, 'See [7,8] and [7] plus (Unknown, 2030).',
  'les citations deviennent les marqueurs [n] du programme, les autres sont intactes');
eq(converted.replaced, 2, 'deux citations converties');
eq(converted.unresolved, ['(Unknown, 2030)'], '…et la citation inconnue est signalée');
eq(MS.convertCitationsInText('Nothing to cite here.', plan2.numberByKey).text, 'Nothing to cite here.',
  'un texte sans citation n’est pas modifié');

/* ── 7. Le texte importé est échappé puis mis en paragraphes ─────────────── */
eq(MS.htmlFromText('Un <script>alert(1)</script> dangereux\n\nDeuxième paragraphe.'),
  '<p>Un &lt;script&gt;alert(1)&lt;/script&gt; dangereux</p>\n<p>Deuxième paragraphe.</p>',
  'le texte devient des <p> — et le HTML extérieur ne peut pas entrer dans le projet');

/* ── 8. La « Project bibliography » est COMPLÉTÉE, jamais écrasée ────────── */
const bib = MS.mergeManuscriptBibliography(
  [{ id: 'b1', title: 'Peptide-membrane interactions', doi: '10.1016/j.bbamem.2018.01.001', authors: '', year: '' }],
  plan.entries.map((e) => e.entry),
  { project: { name: 'CD project', scientist: 'Nicolas' } }
);
eq(bib.list.length, 3, 'les 3 papiers du document rejoignent la bibliographie du projet');
eq(bib.added, 2, 'celui qui y était déjà (même DOI) n’est pas dupliqué');
ok(bib.list[0].id === 'b1', 'l’entrée existante garde son id (donc ses liens)');
ok(!!bib.list[0].authors, '…et ses champs vides sont complétés par le document');

/* ── 9. Les sources : l'import est bien branché dans la page projet ──────── */
has(PROJ, 'blocksFromText, splitManuscript, groupManuscriptParts',
  'la page projet importe les fonctions du module (aucune logique dupliquée)');
has(PROJ, '📥 Import a manuscript', 'un bouton « 📥 Import a manuscript » est offert à côté des papiers');
has(PROJ, 'onClick={() => openManuscriptImport()}', 'l’en-tête de la page projet porte le bouton (toujours visible)');
has(PROJ, "{ label: '📥 Import a manuscript', title:", 'chaque section de texte en a un aussi — juste à côté du bouton « 📄 Word » de l’éditeur');
has(PROJ, 'onClick: () => openManuscriptImport(id)', '…et il vise la section d’où il est lancé');
has(PROJ, 'bibliography: true', 'la section Bibliography est ouverte d’emblée (sinon les boutons d’import restent cachés en bas de page)');
has(PROJ, 'focusSection', 'la section de départ est mémorisée et rappelée dans la fenêtre');
has(RTE, 'References are NOT imported here',
  'le bouton « 📄 Word » de l’éditeur prévient qu’il ne prend PAS les références (il renvoie à l’import de manuscrit)');
has(PROJ, 'onClick={() => { openManuscriptImport(); }}', '…et ouvre la fenêtre d’import');
has(PROJ, 'const renderManuscriptImport = () => {', 'la fenêtre existe');
has(PROJ, '{renderManuscriptImport()}', '…et est montée dans la page');
has(PROJ, 'const plan = buildManuscriptPlan(manuscript, { existingReferences: refs });',
  'le plan est calculé avec les références DÉJÀ numérotées du projet');
has(PROJ, 'const converted = convertCitationsInText(p.text, numbers);',
  'le texte écrit dans la section a ses citations converties');
has(PROJ, 'const merged = mergeManuscriptBibliography(projectBib, pickedEntries, { project });',
  'la bibliographie du document rejoint la « Project bibliography » (Publications → Project bibliography)');
has(PROJ, 'references: added.length ? [...refs, ...added] : refs',
  'les papiers cités reçoivent leur numéro dans project.references (comme « 📚 + Reference »)');
has(PROJ, 'patch[p.dest] = p.mode === \'replace\'', 'chaque partie peut remplacer — ou seulement compléter — sa section');
has(PROJ, 'No file is uploaded to Drive.', 'la fenêtre dit que RIEN n’est envoyé au Drive (le texte reste dans le projet)');

/* ── 10. L'EN-TÊTE du document : titre / auteurs / affiliations ─────────────
   Un article commence par son titre, ses auteurs et leurs affiliations. Ces
   lignes ressemblent à des titres (courtes, capitalisées…) : prises pour des
   sections, elles disparaissaient et la numérotation des parties n'avait plus
   ni titre ni sens. Elles sont maintenant reconnues ET rangées dans le projet
   (section « 🧾 Title, authors & affiliations »). */
const HEADER_DOC = [
  'Aphid transmission of a new potyvirus infecting pepper crops in Italy',
  'Mario Rossi1, Anna Bianchi1, Jean Dupont2',
  '1 Dipartimento di Agraria, Universita di Napoli Federico II, Portici, Italy',
  '2 INRAE, UMR Biologie du Fruit, Villenave d Ornon, France',
  '',
  'Abstract',
  'A new potyvirus was isolated from pepper plants showing mosaic symptoms.',
  '',
  'Introduction',
  'Pepper crops are affected by many viruses (Rossi et al., 2018).',
  '',
  'References',
  '[1] Rossi M, Bianchi A, et al. Characterization of a potyvirus. J Virol 2018;12:345-356.'
].join('\n');
const headerBlocks = MS.blocksFromText(HEADER_DOC);
const headerManuscript = MS.splitManuscript(headerBlocks);
const header = MS.parseManuscriptHeader(headerManuscript.body);
eq(header.title, 'Aphid transmission of a new potyvirus infecting pepper crops in Italy', 'le TITRE du document est reconnu');
eq(header.authors, 'Mario Rossi1, Anna Bianchi1, Jean Dupont2', '…la liste des auteurs');
eq(header.affiliations.split('\n').length, 2, '…et les deux affiliations');
ok(header.affiliations.includes('Dipartimento') && header.affiliations.includes('INRAE'),
  'chaque affiliation garde son texte (une ligne par affiliation)');
eq(header.blocks.length, 4, 'les 4 lignes d’en-tête sont consommées');

/* Les lignes d'en-tête ne sont plus prises pour des SECTIONS du document. */
ok(!MS.isHeadingLine('Mario Rossi1, Anna Bianchi1, Jean Dupont2'), 'une liste d’auteurs n’est pas un titre de section');
ok(!MS.isHeadingLine('1 Dipartimento di Agraria, Universita di Napoli Federico II, Portici, Italy'),
  'une affiliation non plus');
ok(MS.isHeadingLine('Materials and Methods'), 'un vrai intitulé reste un titre');
ok(MS.isHeadingLine('Introduction') && MS.isHeadingLine('Abstract'), 'les titres de section sont intacts');
eq(headerManuscript.body.filter((b) => b.kind === 'heading').map((b) => b.text), ['Abstract', 'Introduction'],
  'le corps du document ne commence qu’aux vraies sections');

/* …et elles ne sont pas non plus importées comme du TEXTE. */
const headerParts = MS.groupManuscriptParts(headerManuscript.body, { header });
eq(headerParts.map((p) => p.heading), ['Abstract', 'Introduction'], 'l’en-tête disparaît des parties à importer');
ok(!JSON.stringify(headerParts).includes('Mario Rossi1'), 'aucune partie ne recolle la liste des auteurs');
ok(!JSON.stringify(headerParts).includes('Dipartimento'), '…ni les affiliations');
eq(headerParts[0].id, 'background', 'Abstract → Scientific background');

/* Style « Nom Initiales » + titre capitalisé (une « section » pour le module) :
   le titre est reconnu quand même, et les auteurs en position d'auteurs aussi. */
const header2 = MS.parseManuscriptHeader(MS.splitManuscript(MS.blocksFromText([
  'A new potyvirus from pepper',
  'Anna Bianchi, Jean Dupont',
  'Dipartimento di Agraria, Universita di Napoli, Portici, Italy',
  '',
  'Introduction',
  'Pepper crops are affected (Rossi et al., 2018).'
].join('\n'))).body);
eq(header2.title, 'A new potyvirus from pepper', 'titre court et capitalisé reconnu');
eq(header2.authors, 'Anna Bianchi, Jean Dupont', 'auteurs sans exposant reconnus (position après le titre)');
eq(header2.affiliations, 'Dipartimento di Agraria, Universita di Napoli, Portici, Italy', 'affiliation reconnue');

/* Rien n'est inventé : un document sans en-tête ne rend aucun champ. */
eq(MS.parseManuscriptHeader(MS.blocksFromText('Introduction\nDu texte.').slice(1)),
  { title: '', authors: '', affiliations: '', blocks: [] },
  'sans en-tête lisible, les trois champs restent vides');
eq(MS.parseManuscriptHeader(MS.blocksFromText('Aphid transmission of plant viruses\n1. Introduction\nAphids transmit many plant viruses.').slice(0, 1)).title,
  'Aphid transmission of plant viruses', 'un titre sans auteurs est reconnu seul');

/* ── 11. Câblage : l'en-tête entre dans le PROJET, pas dans une section ───── */
has(PROJ, 'const header = parseManuscriptHeader(manuscript.body);',
  'la page projet lit l’en-tête du document');
has(PROJ, 'const parts = groupManuscriptParts(manuscript.body, { header }).map((p, i) => ({',
  '…et le retire des parties importées');
has(PROJ, 'header: null, headerPicks: null,',
  'la fenêtre d’import part sans en-tête : il est lu à l’analyse du document');
has(PROJ, 'const defaultHeaderPicks = {',
  '…et un champ DÉJÀ rempli dans le projet n’est pas coché d’office (rien n’est écrasé)');
has(PROJ, 'Document header → project (title · authors · affiliations)',
  'l’en-tête reconnu est montré dans la fenêtre (modifiable, coché/décoché)');
has(PROJ, 'toggleManuscriptHeaderPick', 'chaque champ peut être coché ou décoché avant l’import');
has(PROJ, 'paperTitle', 'le titre est enregistré dans le projet');
has(PROJ, 'paperAuthors', 'les auteurs aussi');
has(PROJ, 'paperAffiliations', 'les affiliations aussi');
has(PROJ, '🧾 Title, authors & affiliations', 'la page projet a une section « Title, authors & affiliations »');
has(PROJ, 'openSections.article', '…ouverte d’emblée (elle est en haut de la page)');
has(PROJ, 'placeholder="Title of the paper — filled by “📥 Import a manuscript”"',
  'le titre stocké est modifiable à la main');
has(PROJ, '{project.paperTitle ? project.paperTitle : `📁 ${project.name}`}',
  'le document exporté prend le titre du papier (le nom du projet reste en repli)');
has(PROJ, '{project.paperAffiliations && (', '…et il imprime aussi les affiliations');

console.log(`✅ ${passed} tests passés (manuscrit — blocs / parties / en-tête)`);

