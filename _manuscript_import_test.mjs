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
const RL = await import('./src/utils/referenceLinks.js');
const PROJ = readFileSync('./src/components/AppModules/projectDetailModule.jsx', 'utf8');
const IMGB = readFileSync('./src/components/ImageBuilder.jsx', 'utf8');
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
/* « … » doit venir AVANT « … » (l'ordre compte pour un texte mis en page). */
const between = (hay, before, after, what) => {
  const i = String(hay).indexOf(before);
  const j = String(hay).indexOf(after);
  assert.ok(i !== -1 && j !== -1 && i < j, `${what}\n  « ${before} » doit précéder « ${after} »`);
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
eq(MS.PROJECT_TEXT_SECTIONS.map((s) => s.id), ['background', 'discussion', 'conclusions', 'funding', 'supporting'],
  'les sections cibles sont celles de la page projet (Funding et Supporting information comprises)');
eq(MS.PROJECT_TEXT_SECTIONS.find((s) => s.id === 'discussion').label, 'Results and Discussion',
  'la section « Discussion » s’appelle désormais « Results and Discussion »');
eq(MS.guessSectionForHeading('Results and Discussion'), 'discussion',
  'un manuscrit intitulé « Results and Discussion » rejoint cette section');
eq(MS.guessSectionForHeading('3. Results and discussion'), 'discussion',
  '…même numéroté et en minuscules (le titre perd sa numérotation)');

/* ── 4. Les citations trouvées dans le texte ─────────────────────────────── */
const found = MS.collectCitations(parts.map((p) => p.text).join('\n\n'));
eq(found.map((c) => c.raw), ['(Rossi et al., 2018)', '[1,2]', '(Smith & Bianchi, 2020)', '(Lefèvre, 2019)', '(Unknown, 2030)', '[3]'],
  'les citations numériques ET auteur-année sont repérées, dans l’ordre');
eq(MS.numericCitationNumbers('5-7'), [5, 6, 7], 'une plage [5-7] est développée');
eq(MS.numericCitationNumbers('1, 4'), [1, 4], 'une liste [1,4] est séparée');
eq(MS.authorYearKeyOf('Rossi et al., 2018'), 'rossi2018', 'la clé d’une citation auteur-année est le 1er auteur + l’année');
eq(MS.authorYearKeyOf('Smith & Bianchi, 2020'), 'smith2020', '…même avec deux auteurs');
eq(MS.authorYearKeyOf('Annexe sans année'), '', 'sans année, aucune clé');

/* ── 4 bis. Les TROIS écritures d'une citation, et les exposants qui n'en sont
   pas. Un article écrit pour une revue au style EndNote/Word ne met jamais de
   crochets : son renvoi est « (12) » ou un exposant — « previously¹² », ou la
   même chose en HTML quand le texte vient d'un document enrichi. Ces formes
   doivent entrer dans le plan d'import comme les « [12] », et les exposants
   d'unité (« m² », « 10⁻² »), les appels de fonction (« sin(2) ») et les années
   (« (2021) ») doivent rester ce qu'ils sont : du texte. */
const FORMES = 'cité (2), puis ³, puis <sup>4</sup>, puis [5] — mais 10⁻², m², sin(2) et (2021) n’en sont pas.';
const formFound = MS.collectCitations(FORMES);
eq(formFound.map((c) => c.raw), ['(2)', '³', '<sup>4</sup>', '[5]'],
  'parenthèses (EndNote), exposant Unicode et exposant HTML sont des citations, au même titre que les crochets');
eq(formFound.map((c) => c.form), ['paren', 'sup', 'sup-html', 'bracket'], '…et chaque forme est nommée');
eq(formFound.map((c) => c.keys), [['#2'], ['#3'], ['#4'], ['#5']], '…avec les numéros qu’elles citent');
eq(MS.findNumericCitations('m² 10⁻² sin(2) (2021)').length, 0,
  'les exposants d’unité, les puissances, les fonctions et les années ne sont PAS des citations');
eq([...MS.citedNumbersInText('see (5-7) and ¹², not [x]')], [5, 6, 7, 12],
  'la lecture des numéros cités comprend les parenthèses, les plages et les exposants');
const formConv = MS.convertCitationsInText(FORMES, new Map([['#2', 1], ['#3', 2], ['#4', 3], ['#5', 4]]));
eq(formConv.text, 'cité [1], puis [2], puis [3], puis [4] — mais 10⁻², m², sin(2) et (2021) n’en sont pas.',
  'à l’import, les trois écritures deviennent le SEUL marqueur [n] du programme');
eq(formConv.replaced, 4, 'les quatre citations sont comptées');
eq(formConv.unresolved, [], '…et rien n’est resté non résolu');
eq(MS.convertCitationsInText('voir (9)', new Map([['#2', 1]])).unresolved, ['(9)'],
  'un renvoi que la bibliographie n’explique pas est laissé tel quel (rien n’est inventé)');

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
has(PROJ, '📥 Import a manuscript', 'un bouton « 📥 Import a manuscript » est offert en haut de la page projet');
has(PROJ, 'onClick={() => openManuscriptImport()}', 'l’en-tête de la page projet porte le bouton (toujours visible)');
ok(!PROJ.includes("{ label: '📥 Import a manuscript'"),
  'aucune barre d’outil de section ne le répète : une seule porte d’entrée, en haut de la page');
ok(!PROJ.includes('onClick={() => { openManuscriptImport(); }}'),
  'ni la section Bibliography (le bouton y a été retiré lui aussi)');
eq((PROJ.match(/openManuscriptImport\(/g) || []).length, 1,
  'un seul bouton dans toute la page — celui de l’en-tête');
has(PROJ, 'bibliography: true', 'la section Bibliography est ouverte d’emblée (elle est en bas d’une longue page)');
has(PROJ, 'focusSection', 'la section de départ reste mémorisée et rappelée dans la fenêtre');
has(RTE, 'References are NOT imported here',
  'le bouton « 📄 Word » de l’éditeur prévient qu’il ne prend PAS les références (il renvoie à l’import de manuscrit)');
has(PROJ, 'const renderManuscriptImport = () => {', 'la fenêtre existe');
has(PROJ, '{renderManuscriptImport()}', '…et est montée dans la page');
has(PROJ, 'const plan = buildManuscriptPlan(manuscript, { existingReferences: refs });',
  'le plan est calculé avec les références DÉJÀ numérotées du projet');
has(PROJ, 'const converted = convertCitationsInText(p.text, numbers);',
  'le texte écrit dans la section a ses citations converties');
has(PROJ, 'const merged = mergeManuscriptBibliography(projectBib, pickedEntries.map(completedOf), { project });',
  'la bibliographie du document rejoint la « Project bibliography » (Publications → Project bibliography)');
has(PROJ, 'const completion = await enrichReferences(toComplete, { pool: citationPool, all: true, max: 60 });',
  'chaque entrée du document est COMPLÉTÉE avant d’entrer — TOUS les champs manquants (co-auteurs d’un « et al. », DOI, volume, revue… — voir utils/referenceEnrich.js)');
has(PROJ, "'✨ Completing the references (authors, titles, journals, DOIs…)'",
  '…et la fenêtre dit qu’elle cherche ces informations');
has(PROJ, "const kept = d.plan.entries.filter((e, i) => (",
  'TOUTES les entrées retenues de la bibliographie reçoivent un numéro —')
has(PROJ, '|| entryKeys(e.entry).some((k) => inProjectBib.has(k))',
  '…cochées, déjà numérotées, ou déjà rangées dans la bibliographie du projet (cas du second import)');
has(PROJ, 'const numbered = numberImportedReferences(keptEntries.map(completedOf), refs, {',
  '…par le MÊME chemin que « 📄 Import references » (numberImportedReferences, qui garde le numéro du document)');
has(PROJ, 'const references = numbered.list;',
  'la liste numérotée remplace project.references (plus de référence citée mais absente du projet)');
has(PROJ, "patch[c.dest] = c.mode === 'replace' ? html : [previous, html].filter(Boolean).join('\\n');",
  'chaque partie peut remplacer — ou seulement compléter — sa section (et deux parties qui visent la même section s’ajoutent)');
has(PROJ, 'so it also lives on Drive, not only in this browser.',
  'la fenêtre dit que le TEXTE importé est déposé dans le dossier Drive du projet (le navigateur n’est qu’un cache)');
has(PROJ, '<b>&lt;dataset&gt;/projects/&lt;project&gt;/&lt;project&gt;_document.json</b>',
  '…et elle en donne le chemin exact (dossier du projet dans le dataset)');

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
/* Le champ « Authors » est une liste de noms qui GARDE la mise en forme du
   document : les numéros d'affiliation deviennent de VRAIS exposants
   (« Mario Rossi¹ »), comme dans l'article — l'utilisateur refuse de perdre les
   exposants de la liste des auteurs (« c'est dommage de perdre la mise en
   forme »). Les crochets disparaissent au passage (« Rossi[1] » → « Rossi¹ ») :
   un exposant ne se lit jamais comme un renvoi de citation. Les affiliations
   gardent leur numérotation : c'est là qu'on lit la correspondance. */
eq(header.authors, 'Mario Rossi\u00b9, Anna Bianchi\u00b9, Jean Dupont\u00b2',
  '…la liste des auteurs, avec ses exposants d’affiliation');
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
eq(
  (({ title, authors, affiliations, blocks }) => ({ title, authors, affiliations, blocks }))(
    MS.parseManuscriptHeader(MS.blocksFromText('Introduction\nDu texte.').slice(1))
  ),
  { title: '', authors: '', affiliations: '', blocks: [] },
  'sans en-tête lisible, les trois champs restent vides'
);
eq(MS.parseManuscriptHeader(MS.blocksFromText('Aphid transmission of plant viruses\n1. Introduction\nAphids transmit many plant viruses.').slice(0, 1)).title,
  'Aphid transmission of plant viruses', 'un titre sans auteurs est reconnu seul');

/* ── 10 bis. LES AUTEURS SONT ENTRE LE TITRE ET LES AFFILIATIONS ────────────
   « Je ne comprends pas pourquoi vous ne reconnaissez pas la section des
   auteurs : elle est ENTRE le titre (que vous reconnaissez) et les affiliations
   (que vous reconnaissez) ». Quatre écritures d'éditeur ne l'étaient pas :
     • le marqueur d'affiliation est une LETTRE (« Mario Rossi a, Anna
       Bianchi b », Elsevier / Springer / Wiley) ;
     • le marqueur est un astérisque collé (« Rossi b,* » = correspondant) ;
     • l'exposant d'un .docx est devenu « [1] » avant la lecture du texte
       (voir markDocxSuperscriptCitations) ;
     • aucun marqueur du tout — c'est alors la POSITION qui tranche.
   Et l'adresse de l'auteur CORRESPONDANT (l'e-mail) est rangée à la FIN des
   affiliations, comme un article l'imprime. */
const authorsOf = (lines) => MS.parseManuscriptHeader(MS.blocksFromText(lines.join('\n')));

const lettersHeader = authorsOf([
  'Aphid transmission of a new potyvirus in pepper',
  'Mario Rossi a, Anna Bianchi b,*, Jean Dupont c',
  'a Dipartimento di Agraria, Universita di Napoli, Italy',
  'b INRAE, Villenave d Ornon, France',
  '* Corresponding author: mario.rossi@unina.it'
]);
eq(lettersHeader.authors, 'Mario Rossi\u1d43, Anna Bianchi\u1d47,*, Jean Dupont\u1d9c',
  'les AUTEURS sont reconnus quand le marqueur d’affiliation est une LETTRE (lettres en exposant)');
eq(lettersHeader.affiliations.split('\n').length, 3, '…et leurs deux adresses + l’auteur correspondant');
eq(lettersHeader.affiliations.split('\n')[2], '* Corresponding author: mario.rossi@unina.it',
  'l’e-mail du correspondant est la DERNIÈRE ligne des affiliations');
ok(MS.classifyHeaderLine('mario.rossi@unina.it') === 'affiliations',
  'une adresse e-mail seule est une affiliation (elle était « consommée » sans être gardée)');
ok(MS.classifyHeaderLine('Correspondence: mario.rossi@unina.it') === 'affiliations',
  '…comme la ligne « Correspondence: … »');

const noMarkHeader = authorsOf([
  'Aphid transmission of a new potyvirus in pepper crops',
  'Mario Rossi, Anna Bianchi, Jean Dupont',
  'Dipartimento di Agraria, Universita di Napoli, Portici, Italy',
  'INRAE, Villenave d Ornon, France'
]);
eq(noMarkHeader.authors, 'Mario Rossi, Anna Bianchi, Jean Dupont',
  'sans AUCUN marqueur, la place entre le titre et les adresses désigne les auteurs');
eq(noMarkHeader.affiliations.split('\n').length, 2, '…et les affiliations suivent');

const docxMarkHeader = authorsOf([
  'Aphid transmission of a new potyvirus in pepper crops',
  'Mario Rossi[1], Anna Bianchi[1], Jean Dupont[2]',
  '1 Dipartimento di Agraria, Universita di Napoli, Portici, Italy',
  '2 INRAE, Villenave d Ornon, France'
]);
eq(docxMarkHeader.authors, 'Mario Rossi\u00b9, Anna Bianchi\u00b9, Jean Dupont\u00b2',
  'les exposants d’un .docx (« Rossi[1] ») deviennent des exposants du champ Authors');
eq(docxMarkHeader.title, 'Aphid transmission of a new potyvirus in pepper crops', '…et le titre reste le titre');

/* Les marqueurs partent, les INITIALES restent : « Rossi B » est un auteur. */
eq(MS.stripAffilMarks('Mario Rossi1'), 'Mario Rossi', '« Rossi1 » → « Rossi »');
eq(MS.stripAffilMarks('Anna Bianchi [1,2]'), 'Anna Bianchi', '« Bianchi [1,2] » → « Bianchi »');
eq(MS.stripAffilMarks('Jean Dupont (3)'), 'Jean Dupont', '« Dupont (3) » → « Dupont »');
eq(MS.stripAffilMarks('Rossi B'), 'Rossi B', 'une INITIALE (« Rossi B ») n’est jamais retirée');
eq(MS.cleanAuthorLine('Rossi M, Bianchi A, Costa L'), 'Rossi M, Bianchi A, Costa L',
  'la convention « Nom Initiales » du laboratoire reste intacte');
/* La mise en forme d'un nom est GARDÉE, en vrais exposants : c'est la demande de
   l'utilisateur (« dommage de perdre les exposants de la liste des auteurs »). */
eq(MS.cleanAuthorLine('Mario Rossi1, Anna Bianchi1, Jean Dupont2'),
  'Mario Rossi\u00b9, Anna Bianchi\u00b9, Jean Dupont\u00b2', '« Rossi1 » → « Rossi¹ »');
eq(MS.cleanAuthorLine('Mario Rossi [1,2], Anna Bianchi (3)'),
  'Mario Rossi\u00b9,\u00b2, Anna Bianchi\u00b3', 'les numéros multiples et entre parenthèses aussi');
eq(MS.cleanAuthorLine('Mario Rossi a, Anna Bianchi b'),
  'Mario Rossi\u1d43, Anna Bianchi\u1d47', 'une lettre de laboratoire devient un exposant');
eq(MS.cleanAuthorLine('Rossi B, Bianchi A'), 'Rossi B, Bianchi A',
  '…mais une INITIALE en majuscule n’est jamais touchée');
eq(MS.cleanAuthorLine('Mario Rossi1*, Anna Bianchi2'), 'Mario Rossi\u00b9*, Anna Bianchi\u00b2',
  'l’astérisque de l’auteur correspondant reste avec son numéro');

/* ── 11. Câblage : l'en-tête entre dans le PROJET, pas dans une section ───── */
has(PROJ, 'const header = parseManuscriptHeader(manuscript.body);',
  'la page projet lit l’en-tête du document');
has(PROJ, 'const parts = withDocumentSections(groupManuscriptParts(manuscript.body, { header })).map((p, i) => ({',
  '…et le retire des parties importées, en donnant à chacune sa SECTION par sa position');
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

/* ── 12. L'EN-TÊTE des documents RÉELS ───────────────────────────────────────
   Aucun manuscrit réel ne commence par un bloc « titre puis auteurs » propre : un
   DOI, une date de soumission, le nom du fichier exporté (« … - Google Docs »),
   le nom de la revue, « Research Article », les mots-clés s'intercalent, et les
   auteurs occupent souvent plusieurs lignes. Ce sont ces formes-là qui étaient
   ratées — et tout l'en-tête partait alors dans la première section. */
/** Le document analysé d'un coup : en-tête ET parties (les mêmes blocs — c'est
 *  leur IDENTITÉ que groupManuscriptParts retire, exactement comme la page). */
const parseDoc = (lines) => {
  const ms = MS.splitManuscript(MS.blocksFromText(lines.join('\n')));
  const header = MS.parseManuscriptHeader(ms.body);
  return { ms, header, parts: MS.groupManuscriptParts(ms.body, { header }) };
};
const headerOf = (lines) => parseDoc(lines).header;
const TITLE = 'Aphid transmission of a new potyvirus';
const AFF1 = '1 Dipartimento di Agraria, Universita di Napoli, Italy';
const AFF2 = '2 INRAE, Villenave d Ornon, France';
const TAIL = ['', 'Introduction', 'Pepper crops are affected (Rossi et al., 2018).'];

/* Un auteur par ligne : l'export Google Docs / Word coupe la liste. */
const dB = parseDoc([TITLE, 'Anna Bianchi1', 'Mario Rossi2', AFF1, AFF2, ...TAIL]);
const hB = dB.header;
eq(hB.title, TITLE, 'un auteur par ligne : le titre reste le titre');
eq(hB.authors, 'Anna Bianchi\u00b9, Mario Rossi\u00b2', '…et les deux auteurs sont réunis (leurs n° d’affiliation en exposant)');
eq(hB.affiliations.split('\n').length, 2, '…avec leurs deux affiliations');
eq(dB.parts.map((p) => p.heading), ['Introduction'], 'seule la vraie section reste à importer');
ok(!JSON.stringify(dB.parts).includes('Bianchi'), 'les auteurs ne retombent pas dans les sections');

/* Exposants entre parenthèses : « Anna Bianchi (1), Mario Rossi (2) ». La ligne
   est bien une liste d'AUTEURS ; le numéro de laboratoire devient un exposant du
   nom (il reste aussi, en clair, dans les affiliations). */
eq(headerOf([TITLE, 'Anna Bianchi (1), Mario Rossi (2), Jean Dupont (1)', AFF1, AFF2, ...TAIL]).authors,
  'Anna Bianchi\u00b9, Mario Rossi\u00b2, Jean Dupont\u00b9', 'les exposants entre parenthèses sont des auteurs');

/* Deux auteurs SANS initiale pointée ni exposant : c'est la position qui tranche. */
const dD = parseDoc([TITLE, 'Anna Bianchi, Mario Rossi',
  'Dipartimento di Agraria, Universita di Napoli, Portici, Italy', ...TAIL]);
eq(dD.header.authors, 'Anna Bianchi, Mario Rossi', 'deux noms nus sous le titre sont les auteurs');
eq(dD.header.affiliations, 'Dipartimento di Agraria, Universita di Napoli, Portici, Italy', '…et l’affiliation suit');

/* Journal + type d'article AVANT le titre. */
const hE = headerOf(['Journal of General Virology', 'Research Article',
  'Aphid transmission of a new potyvirus infecting pepper crops',
  'Anna Bianchi1, Mario Rossi2', AFF1, AFF2, ...TAIL]);
eq(hE.title, 'Aphid transmission of a new potyvirus infecting pepper crops',
  '« Journal of… » et « Research Article » ne sont pas pris pour le titre');
eq(hE.authors, 'Anna Bianchi\u00b9, Mario Rossi\u00b2', '…les auteurs restent reconnus (numéros d’affiliation en exposant)');

/* DOI + date de soumission avant le titre : ils ne sont plus importés non plus. */
const DOI_DOC = ['https://doi.org/10.1099/jgv.0.001234', 'Received: 12 January 2024',
  TITLE, 'Anna Bianchi1, Mario Rossi2', AFF1, ...TAIL];
const dF = parseDoc(DOI_DOC);
eq(dF.header.title, TITLE, 'le DOI et la date ne cachent plus le titre');
eq(dF.header.authors, 'Anna Bianchi\u00b9, Mario Rossi\u00b2', '…ni les auteurs');
eq(dF.parts.map((p) => p.heading), ['Introduction'], 'DOI et date ne sont pas importés comme du texte');

/* Métadonnées APRÈS les affiliations : elles ne deviennent pas une section. */
const META_DOC = [TITLE, 'Anna Bianchi1, Mario Rossi2', AFF1,
  '', 'Correspondence: anna.bianchi@unina.it', 'Keywords: potyvirus, aphid', ...TAIL];
const dH = parseDoc(META_DOC);
eq(dH.header.authors, 'Anna Bianchi\u00b9, Mario Rossi\u00b2', 'les métadonnées après les affiliations ne cassent pas l’en-tête');
eq(dH.header.affiliations.split('\n').length, 2,
  'l’e-mail de correspondance reste une AFFILIATION (il n’est plus jeté comme métadonnée)');
eq(dH.parts.map((p) => p.heading), ['Introduction'], '« Correspondence » et « Keywords » sont écartés de l’import');

/* Style Paperpile « Bianchi, A., Rossi, M., Dupont, J. » et « Bianchi A, et al. ». */
eq(headerOf([TITLE, 'Bianchi, A., Rossi, M., Dupont, J.',
  'Dipartimento di Agraria, Universita di Napoli, Portici, Italy', ...TAIL]).authors,
  'Bianchi, A., Rossi, M., Dupont, J.', 'une liste d’initiales pointées est une liste d’auteurs');
eq(headerOf([TITLE, 'Bianchi A, et al.',
  'Dipartimento di Agraria, Universita di Napoli, Portici, Italy', ...TAIL]).authors,
  'Bianchi A, et al.', 'un auteur suivi de « et al. » est reconnu');

/* Exposants COLLÉS par l'export : « Bianchi1* », « Dupont1,2 », « 1Dipartimento… ». */
const hK = headerOf([TITLE, 'Anna Bianchi1*, Mario Rossi2, Jean Dupont1,2',
  '1Dipartimento di Agraria, Universita di Napoli, Italy', '2INRAE, Villenave d Ornon, France', ...TAIL]);
eq(hK.authors, 'Anna Bianchi\u00b9*, Mario Rossi\u00b2, Jean Dupont\u00b9,\u00b2', 'exposants collés et doubles (« 1,2 ») reconnus, puis écrits en exposant');
eq(hK.affiliations.split('\n').length, 2, 'une affiliation collée à son marqueur reste une affiliation');

/* Titre en MAJUSCULES (très fréquent) : ce n'est pas un intitulé de section. */
eq(headerOf(['APHID TRANSMISSION OF A NEW POTYVIRUS INFECTING PEPPER', 'Anna Bianchi1, Mario Rossi2', AFF1, ...TAIL]).title,
  'APHID TRANSMISSION OF A NEW POTYVIRUS INFECTING PEPPER', 'un titre en majuscules est reconnu');
eq(MS.classifyHeaderLine('Abstract'), 'section', 'un vrai intitulé de section arrête l’en-tête');
eq(MS.classifyHeaderLine('Research Article'), 'ignore', 'un type d’article est une métadonnée');
eq(MS.looksLikeAuthorList('Anna Bianchi, Mario Rossi'), true, 'une liste de noms nus est reconnue…');
eq(MS.looksLikeAuthorList('Statistical Analysis'), false, '…mais pas un intitulé de méthode');

/* LA CORRECTION À LA MAIN : les rôles des lignes d'en-tête (fenêtre d'import). */
const hManual = MS.headerFromLineRoles(
  dD.ms.body,
  dD.header.lines.map((l) => (l.role === 'authors' ? { ...l, role: 'ignore' } : l))
);
eq(hManual.authors, '', 'décocher les auteurs les retire du champ…');
ok(hManual.blocks.length >= 1, '…et la ligne reste hors du texte importé (rien n’est inventé)');
eq(MS.HEADER_ROLES.map((r) => r.id), ['ignore', 'title', 'authors', 'affiliations', 'keep'],
  'les rôles proposés à la main (… et « keep », qui rend la ligne au texte)');
ok(MS.HEADER_ROLES[MS.HEADER_ROLES.length - 1].label.includes('keep in the section text'),
  'le dernier rôle dit clairement que la ligne retourne dans le texte de sa section');

/* ── 13. FUNDING et SUPPORTING INFORMATION ──────────────────────────────────
   Deux sections qui manquaient à un article complet : le financement (bourses,
   contrats, remerciements) et le matériel supplémentaire (figures et tables S1…).
   Le manuscrit importé les remplit quand il porte ces titres, et le document
   exporté les imprime — mais seulement si elles sont écrites. */
eq(MS.guessSectionForHeading('Funding'), 'funding', '« Funding » vise la section Funding');
eq(MS.guessSectionForHeading('Acknowledgements'), 'funding', '« Acknowledgements » aussi (bourses et remerciements)');
eq(MS.guessSectionForHeading('Financial support'), 'funding', '…comme « Financial support »');
eq(MS.guessSectionForHeading('Supporting information'), 'supporting', '« Supporting information » vise la section du même nom');
eq(MS.guessSectionForHeading('Supplementary Material'), 'supporting', '…comme « Supplementary Material »');
eq(MS.guessSectionForHeading('Additional file'), 'supporting', '…comme « Additional file »');
const FUND_DOC = [
  TITLE, 'Anna Bianchi1, Mario Rossi2', AFF1, '',
  'Introduction', 'Pepper crops are affected (Rossi et al., 2018).', '',
  'Funding', 'This work was supported by PRIN 2022 grant 12345.', '',
  'Supporting information', 'Table S1. Aphid species tested.', '',
  'References', '[1] Rossi M, et al. Characterization of a potyvirus. J Virol 2018;12:345-356.'
].join('\n');
const FUND_MS = MS.splitManuscript(MS.blocksFromText(FUND_DOC));
const fundParts = MS.groupManuscriptParts(FUND_MS.body, { header: MS.parseManuscriptHeader(FUND_MS.body) });
eq(fundParts.map((p) => p.id), ['background', 'funding', 'supporting'],
  'le texte de financement et de matériel supplémentaire vise leurs sections');
ok(fundParts[1].text.includes('PRIN 2022 grant'), 'le texte de financement est conservé');
has(PROJ, "textSection('funding', '💰 Funding'", 'la page projet a une section Funding');
has(PROJ, "textSection('supporting', '📎 Supporting information'", '…et une section Supporting information');
has(PROJ, 'updateProject({ funding: val })', '…enregistrée dans le projet (project.funding)');
has(PROJ, 'updateProject({ supporting: val })', '…et project.supporting');
has(PROJ, 'funding: true, supporting: true', 'les deux sections sont ouvertes d’emblée');
has(PROJ, "{ id: 'funding', title: 'Funding', html: project.funding || '', optional: true }",
  'le document exporté imprime le financement');
has(PROJ, "{ id: 'supporting', title: 'Supporting information', html: project.supporting || '', optional: true }",
  '…et le matériel supplémentaire');
has(PROJ, "funding: 'Funding',", 'les figures de ces sections reçoivent un nom lisible');
ok(IMGB.includes('<option value="funding">Funding</option>')
  && IMGB.includes('<option value="supporting">Supporting information</option>'),
'A composition can be inserted into the two new sections');

/* ── 14. LES CITATIONS DU TEXTE DEVIENNENT DES LIENS ────────────────────────
   Le défaut le plus visible de l'import : la bibliographie arrivait bien, mais
   les « [12] » du texte restaient des NOMBRES MORTS — impossible de savoir à quel
   papier ils renvoyaient. La page pose maintenant le lien à l'import, sait le
   reposer sur un texte déjà importé (« 🔗 Link citations to references ») et le
   document exporté ancre chaque référence (#ref-12) pour que le lien aboutisse. */
has(PROJ, "from '../../utils/referenceLinks'", 'la page projet utilise le module de liens de citation');
has(PROJ, 'const numberSet = referenceNumbers(references);',
  'les numéros de TOUTES les références retenues comptent comme des références valides');
has(PROJ, 'linkCitationNumbers(c.html || htmlFromText(c.text)',
  'à l’import, chaque [n] du texte devient un lien (avec la mise en forme du document quand elle est connue)');
has(PROJ, '🔗 Link citations to references', '…et un bouton rattrape les textes déjà importés');
has(PROJ, 'const res = linkCitationsInSections(', '…en repassant sur TOUTES les sections de texte');
has(PROJ, 'citation(s) linked to their reference', 'l’import annonce combien de citations ont été liées');
has(PROJ, 'id={number ? citationAnchorId(number) : undefined}',
  'chaque référence du document exporté porte son ancre #ref-n');
has(PROJ, 'value={number || undefined}', '…et son numéro réel (même si les numéros ne se suivent pas)');
has(PROJ, '.cite-ref { color: #2563eb;', 'les citations liées sont visibles dans le document exporté');
has(PROJ, 'patchManuscriptHeaderRole', 'la fenêtre d’import laisse corriger le rôle de chaque ligne d’en-tête');
has(PROJ, 'HEADER_ROLES.map', '…avec les rôles du module (titre / auteurs / affiliation / non importé)');

/* ── 15. LE BOUT EN BOUT : le manuscrit complet d'un article ────────────────
   Le même chemin que la page projet (analyser → convertir → écrire), en
   fonctions pures : en-tête, sections (Introduction / Funding / Supporting
   information), bibliographie et citations LIÉES. C'est ce que l'utilisateur
   voit dans une section après « ✓ Import into this project ». */
const FULL_DOC = [
  'Aphid transmission of a new potyvirus infecting pepper crops',
  'Anna Bianchi1, Mario Rossi2',
  '1 Dipartimento di Agraria, Universita di Napoli, Italy',
  '2 INRAE, Villenave d Ornon, France',
  '',
  'Introduction',
  'Aphids transmit potyviruses [1] and this was confirmed later [1,2].',
  '',
  'Funding',
  'This work was supported by PRIN 2022.',
  '',
  'Supporting information',
  'Table S1. Aphid species.',
  '',
  'References',
  '[1] Rossi M, et al. Characterization of a potyvirus. J Virol 2018;12:345-356.',
  '[2] Dupont J. Aphid transmission of viruses. J Virol 2020;13:1-9.'
].join('\n');
const pageMs = MS.splitManuscript(MS.blocksFromText(FULL_DOC));
const pageHeader = MS.parseManuscriptHeader(pageMs.body);
eq([pageHeader.title, pageHeader.authors, pageHeader.affiliations.split('\n').length],
  ['Aphid transmission of a new potyvirus infecting pepper crops', 'Anna Bianchi\u00b9, Mario Rossi\u00b2', 2],
  'l’en-tête de l’article est reconnu (titre / auteurs / affiliations)');
const pagePlan = MS.buildManuscriptPlan(pageMs, { existingReferences: [] });
eq(pagePlan.entries.length, 2, 'les deux références de la bibliographie sont lues');
eq(pagePlan.unresolved.length, 0, 'les citations du texte sont toutes résolues');
const pageParts = MS.groupManuscriptParts(pageMs.body, { header: pageHeader })
  .map((p, i) => ({ key: `part${i}`, heading: p.heading, text: p.text, dest: p.id, mode: 'append' }));
eq(pageParts.map((p) => [p.heading, p.dest]),
  [['Introduction', 'background'], ['Funding', 'funding'], ['Supporting information', 'supporting']],
  'chaque partie du manuscrit vise la bonne section (finances et SI comprises)');
/* Ce que fait applyManuscriptImport : convertir les citations ([12] du document
   → [n] du projet) PUIS les lier à leur référence. */
const pageRefs = pagePlan.entries.map((e) => ({
  id: `r${e.number}`, number: e.number, title: e.entry.title, authors: e.entry.authors, year: e.entry.year
}));
const pageHtml = pageParts.map((p) => RL.linkCitationNumbers(
  MS.htmlFromText(MS.convertCitationsInText(p.text, pagePlan.numberByKey).text),
  { numbers: RL.referenceNumbers(pageRefs), hrefFor: (n) => `#${RL.citationAnchorId(n)}`, titleFor: RL.citationTitleGetter(pageRefs) }
));
ok(pageHtml[0].includes('href="#ref-1"') && pageHtml[0].includes('data-ref="2"'),
  'les [1] et [2] du texte importé deviennent des liens cliquables');
ok(pageHtml[0].includes('title="Rossi M, et al. · Characterization of a potyvirus (2018)"'),
  '…et l’infobulle rappelle la référence (auteurs · titre (année))');
eq(pageHtml[1].includes('data-ref='), false, 'la section Funding, sans citation, n’est pas réécrite');

/* ── 16. LES FIGURES DU DOCUMENT ─────────────────────────────────────────────
   Le défaut signalé : « les figures ne sont pas importées ». Un manuscrit
   (.docx, ou son export « page Web ») contient ses images : elles arrivent
   maintenant avec le texte, MAIS PAS dans le texte éditable — elles deviennent
   les figures de LEUR section (la liste que remplit aussi « 📤 Insert into
   project… » de l'Image Builder) et l'ancre gardée sur chacune les remet à
   leur place dans le document exporté (utils/figurePlacement.js). */
const { zipSync, strToU8 } = await import('fflate');

/* Un .docx minimal fabriqué en mémoire : deux sections, une image après le
   premier paragraphe et sa légende juste en dessous. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const DOCX = zipSync({
  'word/document.xml': strToU8([
    '<?xml version="1.0" encoding="UTF-8"?><w:document><w:body>',
    '<w:p><w:r><w:t>Introduction</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>Aphids transmit potyviruses [1].</w:t></w:r></w:p>',
    '<w:p><w:r><w:drawing><a:blip r:embed="rId9"/></w:drawing></w:r></w:p>',
    '<w:p><w:r><w:t>Figure 1. Transmission rates of the virus.</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>Discussion</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>The rates agree with the literature [2].</w:t></w:r></w:p>',
    '</w:body></w:document>'
  ].join('')),
  'word/_rels/document.xml.rels': strToU8(
    '<Relationships><Relationship Id="rId9" Type="image" Target="media/image1.png"/></Relationships>'),
  'word/media/image1.png': PNG
});
const docxDoc = MS.docxManuscriptFromBytes(DOCX);
eq(docxDoc.figures.length, 1, 'l’image du .docx est trouvée');
eq(docxDoc.figures[0].name, 'image1.png', '…avec son nom dans le ZIP');
eq(docxDoc.figures[0].mime, 'image/png', '…et son type');
eq(docxDoc.figures[0].bytes.length, PNG.length, '…et ses pixels (ils partiront au Drive, comme « 📄 Word text »)');
eq(docxDoc.figures[0].caption, 'Figure 1. Transmission rates of the virus.',
  'la légende sous l’image devient la légende de la figure');
ok(docxDoc.text.includes('[[FIGURE 1]]'), 'le TEXTE garde la place de l’image (marqueur [[FIGURE n]])');
eq(docxDoc.text.includes('Figure 1. Transmission rates'), false, '…et la légende ne reste pas dans le texte');
ok(MS.figureDataUrl(docxDoc.figures[0]).startsWith('data:image/png;base64,'),
  'les pixels d’un .docx se transforment en data URL (ce que la page envoie au Drive)');

/* ── 16 bis. LES CITATIONS EN EXPOSANT D'UN .docx (Word, Google Docs, EndNote)
   Le renvoi existe SEULEMENT dans la mise en forme du run
   (`<w:vertAlign w:val="superscript"/>`) : la lecture du texte la perdait, le
   renvoi arrivait en nombre nu collé au mot — rien à lier, d'où le « Nothing to
   link » d'un article Word. Le run exposant devient donc son marqueur [n] DANS
   le XML, et rien d'autre (units, ordinaux, runs normaux) n'est touché.      */
const SUPER_DOCX = zipSync({
  'word/document.xml': strToU8([
    '<?xml version="1.0" encoding="UTF-8"?><w:document><w:body>',
    '<w:p><w:r><w:t>Aphids transmit potyviruses</w:t></w:r>',
    '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>12</w:t></w:r>',
    '<w:r><w:t> as shown before</w:t></w:r>',
    '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>3,4</w:t></w:r>',
    '<w:r><w:t>.</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>Area in m</w:t></w:r>',
    '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>2</w:t></w:r>',
    '<w:r><w:t> and the 2</w:t></w:r>',
    '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>nd</w:t></w:r>',
    '<w:r><w:t> time, diluted 10</w:t></w:r>',
    '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>-3</w:t></w:r>',
    '<w:r><w:t>.</w:t></w:r></w:p>',
    '</w:body></w:document>'
  ].join(''))
});
const superDoc = MS.docxManuscriptFromBytes(SUPER_DOCX);
ok(superDoc.text.includes('Aphids transmit potyviruses[12] as shown before[3,4].'),
  'un renvoi en exposant d’un .docx devient son marqueur [n] — le nombre n’est plus perdu dans le texte');
eq(superDoc.text.includes('m[2]'), false,
  '« m2 » (exposant d’unité) reste du texte : le marqueur n’est pas mis au milieu d’un mot');
eq(superDoc.text.includes('2[nd]'), false, '« 2nd » (ordinal) n’est pas un renvoi');
ok(superDoc.text.includes('diluted 10-3.'), 'une puissance « 10-3 » reste une puissance');
const superRun = MS.markDocxSuperscriptCitations(
  '<w:p><w:r><w:t>shown</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>'
  + '<w:t>7</w:t></w:r></w:p>'
);
ok(superRun.includes('<w:t>[7]</w:t>'), 'le marqueur remplace le texte du run (le reste du XML est intact)');
ok(superRun.includes('<w:t>shown</w:t>'), '…et le run normal voisin n’est pas touché');

/* Une image LIÉE (relation externe, courante dans les exports Google Docs /
   Word) n'a pas de fichier dans le ZIP : son URL est gardée telle quelle. */
const LINKED_DOCX = zipSync({
  'word/document.xml': strToU8('<w:document><w:body><w:p><w:r><w:drawing><a:blip r:link="rId7"/></w:drawing></w:r></w:p></w:body></w:document>'),
  'word/_rels/document.xml.rels': strToU8(
    '<Relationships><Relationship Id="rId7" Type="image" Target="https://lh7-rt.googleusercontent.com/docsz/XYZ" TargetMode="External"/></Relationships>')
});
const linkedDoc = MS.docxManuscriptFromBytes(LINKED_DOCX);
eq(linkedDoc.figures[0].src, 'https://lh7-rt.googleusercontent.com/docsz/XYZ',
  'une image liée (r:link) garde son URL au lieu d’être perdue');
eq(linkedDoc.figures[0].missing, false, '…et elle n’est pas marquée « manquante »');

/* Le marqueur n'est NI un titre NI un candidat de l'en-tête. */
eq(MS.isHeadingLine('[[FIGURE 1]]'), false, 'la ligne d’un marqueur n’est jamais un titre');
eq(MS.blocksFromText('Aphids are vectors.\n\n[[FIGURE 1]]\n\nDiscussion').map((b) => b.kind),
  ['paragraph', 'paragraph', 'heading'], 'le marqueur reste un bloc de texte, entre deux paragraphes');
eq(MS.parseManuscriptHeader(MS.blocksFromText('[[FIGURE 1]]\n\nAphid transmission of a potyvirus')).title,
  'Aphid transmission of a potyvirus', 'une image en tête de document ne devient pas le titre');

/* Le même chemin que applyManuscriptImport : la figure rejoint la section de
   la partie qui la porte, avec l'ancre du paragraphe qui la précédait. */
const figDoc = MS.splitManuscript(MS.blocksFromText(docxDoc.text));
const figHeader = MS.parseManuscriptHeader(figDoc.body);
const figParts = MS.groupManuscriptParts(figDoc.body, { header: figHeader })
  .map((p, i) => ({ key: `part${i}`, heading: p.heading, text: p.text, dest: p.id }));
const figPlacements = figParts
  .filter((p) => p.dest)
  .flatMap((p) => MS.figureMarksIn(p.text).map((mk) => ({ section: p.dest, index: mk.index, anchor: mk.anchor })));
eq(figPlacements, [{ section: 'background', index: 1, anchor: 'Aphids transmit potyviruses [1].' }],
  'la figure vise la section du paragraphe qui la portait, avec ce paragraphe comme ancre');
eq(figParts[0].text.includes('[[FIGURE'), true, 'la partie contient bien le marqueur (avant import)');
eq(MS.stripFigureMarks(figParts[1].text).includes('[[FIGURE'), false,
  'le texte écrit dans la section n’a plus AUCUN marqueur (rien d’invisible ne reste)');
/* Deux images à la suite (panneaux a et b d'une même figure) partagent le
   paragraphe d'ancre : elles seront imprimées l'une derrière l'autre. */
eq(MS.figureMarksIn('Text before.\n\n[[FIGURE 1]]\n\n[[FIGURE 2]]').map((m) => [m.index, m.anchor]),
  [[1, 'Text before.'], [2, 'Text before.']], 'deux images à la suite gardent la même ancre, dans l’ordre');

/* ── 16 ter. AUCUNE FIGURE PERDUE (la plainte : « avant, l’import importait les
   figures, maintenant elles sont perdues ») ────────────────────────────────────
   Deux chemins les faisaient disparaître EN SILENCE :
     • une partie sans destination (« — do not import — », ou le chapeau d'un
       document qui commence sans titre) était sautée avec ses figures ;
     • une figure dont le marqueur était tombé dans une ligne de l'en-tête (ces
       blocs sortent du texte) n'était plus vue du tout.
   manuscriptFigurePlacements regarde le document ENTIER : la figure va dans la
   section de sa partie, sinon dans la section la plus proche, sinon dans la
   première section de texte — et le compte rendu le dit (rerouted/orphans). */
const partsOf = (text, { dest = null, focus = '' } = {}) => MS.manuscriptFigurePlacements(
  MS.withDocumentSections(MS.groupManuscriptParts(MS.blocksFromText(text), {}))
    .map((p) => ({ heading: p.heading, text: p.text, dest: dest ? dest(p) : p.id })),
  [], { focusSection: focus }
);
eq(partsOf('Aphid transmission of a potyvirus\n\n[[FIGURE 1]]\n\nIntroduction\n\nAphids [1].\n\nConclusions\n\nControl.').placements,
  [{ section: 'background', index: 1, anchor: 'Aphid transmission of a potyvirus' }],
  'une figure dans le CHAPEAU (partie sans destination) est attachée à la section la plus proche — plus perdue');
eq(partsOf('Introduction\n\nAphids [1].\n\n[[FIGURE 1]]\n\nResults\n\nRates [2].').placements,
  [{ section: 'background', index: 1, anchor: 'Aphids [1].' }],
  'une figure de l’Introduction reste dans « Scientific background »');
/* Une partie « Matériel et méthodes » : le champ du projet est du TEXTE, la
   figure va donc dans « Results and Discussion » (elle y reste modifiable). */
eq(partsOf('Introduction\n\nA [1].\n\nMaterials and Methods\n\nPlants.\n\n[[FIGURE 1]]\n\nResults\n\nR [2].').placements,
  [{ section: 'discussion', index: 1, anchor: 'Plants.' }],
  'une figure du Matériel et méthodes devient une figure de « Results and Discussion »');
/* Une partie redirigée vers un champ d'en-tête (« 🧾 Authors ») ne peut pas
   imprimer d'image : la figure va dans la section que son intitulé visait. */
{
  const res = MS.manuscriptFigurePlacements([
    { heading: 'Aphids in pepper', text: 'Aphids in pepper\n\n[[FIGURE 1]]', dest: 'paperAuthors', guessed: 'background' },
    { heading: 'Conclusions', text: 'Control.', dest: 'conclusions' }
  ], [], {});
  eq(res.placements, [{ section: 'background', index: 1, anchor: 'Aphids in pepper' }],
    'une figure d’une partie envoyée dans l’en-tête ne disparaît pas (elle va dans la section visée)');
  eq(res.rerouted, 0, '…et elle n’est pas comptée comme « reclassée »');
}
eq(MS.manuscriptFigurePlacements([], [{ index: 1, name: 'image1.png' }], {}).placements,
  [{ section: 'background', index: 1, anchor: '' }],
  'une figure dont le marqueur a disparu du texte est posée quand même (aucun pixel perdu)');
eq(MS.manuscriptFigurePlacements([], [{ index: 2 }], {}).orphans, 1, '…et elle est signalée comme orpheline');
{
  const res = MS.manuscriptFigurePlacements(
    [{ heading: '', text: 'Chapeau.\n\n[[FIGURE 1]]', dest: '' }, { heading: 'Results', text: 'R.', dest: 'discussion' }],
    [{ index: 1 }, { index: 2 }], { focusSection: 'conclusions' }
  );
  eq(res.placements.map((p) => [p.section, p.index]), [['discussion', 1], ['conclusions', 2]],
    'sans destination, la figure suit la section la plus proche ; une orpheline prend la section de départ');
  eq(res.rerouted, 2, 'les deux sont signalées (jamais perdues en silence)');
}

/* ── 17. LA PAGE HTML (export Google Docs « page Web ») ────────────────────── */
const htmlDoc = MS.htmlManuscriptFromHtml([
  '<h1>Aphid transmission of a potyvirus</h1>',
  '<p>Aphids transmit potyviruses [1].</p>',
  '<img src="https://lh7-rt.googleusercontent.com/docsz/ABC123" alt="Figure 1">',
  '<p>Figure 1. Transmission rates of the virus.</p>',
  '<p>Discussion</p>',
  '<p>The rates agree with the literature [2].</p>',
  '<img src="https://example.com/spacer.gif" width="1" height="1">'
].join(''));
eq(htmlDoc.figures.length, 1, 'les images de la page sont trouvées (le pixel de mise en page est ignoré)');
eq(htmlDoc.figures[0].src, 'https://lh7-rt.googleusercontent.com/docsz/ABC123',
  'une image de page garde son URL telle quelle (rien n’est retéléchargé)');
eq(htmlDoc.figures[0].caption, 'Figure 1. Transmission rates of the virus.', 'sa légende est reprise');
ok(htmlDoc.text.includes('[[FIGURE 1]]'), 'et sa place est marquée dans le texte');
eq(MS.htmlManuscriptFromHtml('<p>Aphids.</p>').figures.length, 0, 'une page sans image n’a aucune figure');

/* ── 18. LE CÂBLAGE DANS LA PAGE PROJET ────────────────────────────────────── */
has(PROJ, 'readManuscriptDocument(file)', 'la page lit le document AVEC ses figures');
has(PROJ, 'figRes = await attachManuscriptFigures(d.figures, figurePlacements);',
  'à l’import, les figures sont attachées à leurs sections (une figure en échec n’emporte ni le texte ni les références)');
has(PROJ, 'const figPlan = manuscriptFigurePlacements(',
  'la place de CHAQUE figure est calculée sur le document entier (figure du chapeau, de l’en-tête, partie non importée)');
has(PROJ, 'convertedTextByKey[p.key] = converted.text;',
  '…et l’ancre d’une figure vient du texte CONVERTI : elle se retrouve dans la section [1] du projet (pas [12] du document)');
has(PROJ, 'image = await figureImageFor(fig, label);',
  '…et une figure dont l’envoi échoue n’emporte plus les autres (essai par figure)');
has(PROJ, 'failed.push(name || label);', '…elle est comptée comme non conservée');
has(PROJ, 'figure(s) had no section of their own', '…et le compte rendu de l’import le dit');
has(PROJ, "source: 'manuscript-import'", '…et gardent leur origine (des figures de l’article)');
has(PROJ, 'addProjectLibraryItem(project.id',
  '…et rejoignent la bibliothèque d’images du projet (Image Builder → Project Library)');
has(PROJ, 'uploadFigureToDrive({ full: dataUrl, label, projectName: project.name',
  'leurs pixels partent au Drive, avec un repli local (comme « 📄 Word text »)');
has(PROJ, 'const split = splitAnchoredFigures(linkCitations(repairContentImages(s.html',
  'le document exporté réinsère chaque figure après son paragraphe');
has(PROJ, 'citedNumbersInText(converted.text).forEach((n) => citedInText.add(n));',
  'l’import retient les numéros cités — plages [5-7] comprises — par l’expression PARTAGÉE citedNumbersInText');
has(PROJ, '{renderFigures(s.restFigures || [])}',
  'les figures sans place retrouvée restent affichées après la section (rien n’est perdu)');
has(PROJ, '“📄 Export document” prints them where the document had them', 'l’import dit où les figures apparaîtront');
has(PROJ, '📄 printed in “📄 Export document” after:', 'la page montre après quel paragraphe chaque figure sera imprimée');

/* ── 19. LA FIGURE REVIENT DANS LE TEXTE DU DOCUMENT EXPORTÉ ───────────────── */
const FP = await import('./src/utils/figurePlacement.js');
/* LE HTML DE LA SECTION TEL QUE L'IMPORT L'ÉCRIT VRAIMENT (htmlFromManuscriptPart) :
   c'est ce chemin-là qui perdait les sauts de ligne (des lignes nues, sans <p>)
   et envoyait TOUTES les figures à la fin de la section, faute de « </p> » pour
   arrêter l'insertion. Le test passait à côté parce qu'il appelait htmlFromText. */
const introHtml = RL.linkCitationNumbers(
  MS.htmlFromManuscriptPart(figParts[0].text, { numbers: new Map([['#1', 1]]) }),
  { numbers: new Set([1]), hrefFor: (n) => `#ref-${n}` }
);
const exported = FP.splitAnchoredFigures(introHtml, [{
  id: 'fig1',
  url: 'https://lh3.googleusercontent.com/d/abc',
  caption: docxDoc.figures[0].caption,
  anchor: figPlacements[0].anchor
}]);
eq(exported.placed.length, 1, 'la figure importée retrouve son paragraphe dans la section exportée');
eq(exported.rest.length, 0, '…et n’est pas répétée après la section');
ok(exported.html.includes('href="#ref-1"'), 'les citations du texte restent des liens cliquables');
between(exported.html, 'transmit potyviruses', '<figure', 'la figure est imprimée APRÈS ce paragraphe');
has(exported.html, 'Transmission rates of the virus.', '…et sa légende l’accompagne');
eq(exported.html.includes('[[FIGURE'), false, 'aucun marqueur n’apparaît dans le document exporté');
/* LE REPÈRE DE L'ANCRE EST LE BLOC (`</p>`), PAS LA FIN DE LA SECTION : c'est ce
   que l'import écrit désormais, et c'est ce qui manquait aux sections importées
   avant le 17/09/2026 (voir _figure_placement_test.mjs, « section héritée »). */
has(introHtml, '<p>', 'la section importée est faite de PARAGRAPHES (un HTML de lignes nues s’affiche collé)');
eq(introHtml.trim().endsWith('</p>'), true, '…chaque paragraphe est un bloc fermé');
between(exported.html, '</p>', '<figure', 'la figure s’insère APRÈS le bloc de son ancre');

/* ── 20. LES AUTEURS QUE LE DOCUMENT MET AILLEURS QU'EN TÊTE ─────────────────
   Le cas rapporté : les auteurs et les affiliations n'étaient pas reconnus et
   retombaient dans la section « Background » — l'utilisateur ne pouvait les
   rediriger que vers une SECTION, jamais vers les champs
   « 🧾 Title, authors & affiliations » du projet. Deux corrections :
     • le programme va CHERCHER les lignes qui ressemblent à des noms / à une
       adresse juste après la fenêtre d'en-tête (repli) et il les propose ;
     • à défaut, chaque partie peut être REDIRIGÉE vers un champ d'en-tête
       (HEADER_DESTS) au lieu d'une section.
   Rien n'est écrit sans être montré : la fenêtre d'import liste les lignes avec
   leur rôle, et « keep in the section text » les rend au texte. */
eq(MS.HEADER_DESTS.map((d) => d.id), ['paperTitle', 'paperAuthors', 'paperAffiliations'],
  'les trois champs d’en-tête du projet sont des destinations possibles');
eq(MS.HEADER_DESTS.map((d) => d.short), ['title', 'authors', 'affiliations'],
  '…et le compte rendu les nomme comme les champs devinés du document');
ok(MS.isHeaderDest('paperAuthors') && !MS.isHeaderDest('background') && !MS.isHeaderDest(''),
  'une section du projet n’est PAS un champ d’en-tête');

/* Le texte d'une partie redirigée prend la forme du champ visé. */
eq(MS.headerTextFor('paperAuthors', 'Mario Rossi\nAnna Bianchi'), 'Mario Rossi, Anna Bianchi',
  'un auteur par ligne devient la liste du champ Authors');
eq(MS.headerTextFor('paperAuthors', 'Jean Dupont', { previous: 'Mario Rossi' }), 'Mario Rossi, Jean Dupont',
  '…et s’ajoute à la suite des auteurs déjà là');
eq(MS.headerTextFor('paperAffiliations', '1 Dipartimento, Portici\n2 INRAE, Villenave', { previous: '0 CNR, Bari' }),
  '0 CNR, Bari\n1 Dipartimento, Portici\n2 INRAE, Villenave',
  'les affiliations gardent une ligne chacune');
eq(MS.headerTextFor('paperTitle', 'Un titre\nsur deux lignes', { previous: 'Ancien titre' }),
  'Ancien titre Un titre sur deux lignes', 'un titre tient sur une ligne');
eq(MS.headerTextFor('paperTitle', 'Le bon titre', { previous: 'Ancien titre', mode: 'replace' }),
  'Le bon titre', '…et « replace » remplace le champ au lieu de s’ajouter');
eq(MS.headerTextFor('paperAuthors', '   ', { previous: 'Mario Rossi' }), 'Mario Rossi',
  'une partie vide ne touche pas au champ');

/* LE REPLI : le document imprime ses auteurs SOUS le résumé. */
const LATE_DOC = [
  'Aphid transmission of a new potyvirus infecting pepper crops',
  'Abstract',
  'A new potyvirus was isolated from pepper plants showing mosaic symptoms.',
  'Anna Bianchi1, Mario Rossi2',
  '1 Dipartimento di Agraria, Universita di Napoli Federico II, Portici, Italy',
  "2 INRAE, UMR Biologie du Fruit, Villenave d'Ornon, France",
  '',
  'Introduction',
  'Pepper crops are affected by many viruses (Rossi et al., 2018).'
].join('\n');
const LATE_MS = MS.splitManuscript(MS.blocksFromText(LATE_DOC));
const lateHeader = MS.parseManuscriptHeader(LATE_MS.body);
eq(lateHeader.title, 'Aphid transmission of a new potyvirus infecting pepper crops', 'le titre reste reconnu');
eq(lateHeader.authors, 'Anna Bianchi\u00b9, Mario Rossi\u00b2', 'les auteurs sous le résumé sont retrouvés (repli)');
eq(lateHeader.affiliations.split('\n').length, 2, '…avec leurs deux affiliations');
ok(lateHeader.lines.some((l) => l.role === 'authors' && l.text.includes('Mario Rossi')),
  'la ligne des auteurs est PROPOSÉE dans la fenêtre d’import (rôle compris)');
const lateParts = MS.groupManuscriptParts(LATE_MS.body, { header: lateHeader });
ok(!JSON.stringify(lateParts).includes('Mario Rossi1'),
  'elle n’est plus importée dans une section (le « Background » ne l’avale plus)');
ok(lateParts[0].text.includes('showing mosaic symptoms'),
  '…et le texte de la section reste intact à côté');
eq(lateParts[1].id, 'background', 'l’introduction vise toujours sa section');

/* Un article à UN SEUL auteur : la ligne de noms seule, juste sous le titre,
   suffit — elle n'était pas reconnue du tout auparavant. */
const SOLO = MS.splitManuscript(MS.blocksFromText([
  'Aphid transmission of a new potyvirus infecting pepper crops',
  'Anna Bianchi',
  'Dipartimento di Agraria, Universita di Napoli Federico II, Portici, Italy',
  '',
  'Introduction',
  'Pepper crops are affected by many viruses (Rossi et al., 2018).'
].join('\n')));
const soloHeader = MS.parseManuscriptHeader(SOLO.body);
eq(soloHeader.authors, 'Anna Bianchi', 'un auteur SEUL en position d’auteur est reconnu');
eq(soloHeader.affiliations, 'Dipartimento di Agraria, Universita di Napoli Federico II, Portici, Italy',
  '…et son affiliation suit');
eq(MS.groupManuscriptParts(SOLO.body, { header: soloHeader }).map((p) => p.heading), ['Introduction'],
  'le début du document n’est plus une partie à importer');

/* « keep » rend une ligne au texte : elle repart dans sa partie, et le champ
   d'en-tête redevient vide. */
const KEPT_TEXT = (dD.header.lines.find((l) => l.role === 'authors') || {}).text || '';
const keepHeader = MS.headerFromLineRoles(
  dD.ms.body,
  dD.header.lines.map((l) => (l.role === 'authors' ? { ...l, role: 'keep' } : l))
);
eq(keepHeader.authors, '', 'une ligne d’auteurs rendue au texte quitte le champ Authors');
ok(KEPT_TEXT && !keepHeader.blocks.some((b) => b.text === KEPT_TEXT), '…et n’est plus consommée par l’en-tête');
/* Elle retourne dans le texte : comme paragraphe de sa partie si elle reste une
   ligne de noms (elle n’est jamais un titre de section, voir isHeadingLine),
   comme intitulé sinon — dans les deux cas elle est bien ré-importée. */
ok(MS.groupManuscriptParts(dD.ms.body, { header: keepHeader })
  .some((p) => p.text.includes(KEPT_TEXT) || p.heading === KEPT_TEXT),
  '…elle se retrouve bien dans une partie du texte');

/* Le câblage : la fenêtre d'import propose ces destinations et les applique. */
has(PROJ, "{ label: '🧾 Project header (title · authors · affiliations)', options: HEADER_DESTS }",
  'le menu d’une partie propose les champs d’en-tête');
has(PROJ, "{ label: 'Sections of this page', options: PROJECT_TEXT_SECTIONS }",
  '…puis les sections de la page (deux groupes lisibles)');
has(PROJ, "<optgroup key={g.label} label={g.label}>", '…affichés en groupes');
has(PROJ, "{isHeaderDest(p.dest) ? 'replace the field' : 'replace the section'}",
  '« replace » dit exactement ce qu’il remplace');
has(PROJ, 'if (isHeaderDest(p.dest)) {', 'à l’import, une partie redirigée ne part pas dans une section');
has(PROJ, 'headerTexts.push({ field: p.dest, text: stripFigureMarks(converted.text), mode: p.mode });',
  '…son texte est mis en forme pour le champ (voir headerTextFor)');
has(PROJ, 'headerTextFor(dest.id, h.text, { previous: value, mode: h.mode })',
  '…et s’ajoute au contenu déjà reconnu en tête du document');
has(PROJ, 'taken from the text — check “🧾 Title, authors & affiliations”',
  'le compte rendu dit quels champs viennent du texte (et où les relire)');
has(PROJ, 'destLabel(p.dest)', 'le compte rendu nomme les champs d’en-tête comme les sections');
has(PROJ, 'guessed: p.id || \'\'', 'chaque partie garde la section que son titre visait (repli des figures)');

/* ── 21. LES TROIS DÉFAUTS SIGNALÉS, RÉPARÉS ───────────────────────────────--
   « quand je clique “Import a manuscript” la fenêtre doit disparaître quand
     l'opération est finie, sinon l'utilisateur continue d'importer et le texte
     est importé plusieurs fois » ;
   « quand le texte est importé, je ferme le projet et je le rouvre : le texte a
     disparu » ;
   « les références ne sont toujours pas correctement importées et elles ne sont
     pas liées au texte ».

   Les trois avaient une racine commune côté données — rien n'était écrit quand
   le magasin était plein (voir _import_persist_test.mjs, qui le prouve sur le
   module RÉEL) — et deux défauts propres à l'import : la fenêtre restait
   ouverte (donc le bouton restait actif), et les références ne venaient que des
   entrées CITÉES du texte. */
has(PROJ, 'setMsImport(null);   // la fenêtre se ferme',
  'la fenêtre d’import se ferme d’elle-même dès que l’import est écrit');
has(PROJ, '{msResult && (', 'le compte rendu (et le verdict du magasin) s’affiche en haut de la page projet');
has(PROJ, '📥 Manuscript import — {msResult.ok ? \'done\' : \'NOT SAVED\'}',
  '…et il dit si l’import a ÉTÉ ENREGISTRÉ');
has(PROJ, '↩︎ Undo import', '…avec un retour en arrière immédiat');
has(PROJ, 'const saved = commitProjectVerified(fullPatch, { lighten: true });',
  'l’import écrit par le chemin VÉRIFIÉ (écriture puis relecture du magasin)');
has(PROJ, 'res: saveProjectsChecked(list, { projectId: project.id, fields: extra })',
  'commitProjectVerified relit le projet et compare les champs écrits');
has(PROJ, 'const light = lightenProjectForStorage({ ...project, ...patch });',
  'si le navigateur refuse (quota plein), une seconde écriture allège les figures : le TEXTE passe en premier');
has(PROJ, 'if (msBusyRef.current) return;   // deux clics = un seul import',
  'deux clics sur « Import » ne font qu’un seul import');
has(PROJ, 'const previous = previousImportOf(project, hash);',
  'un document DÉJÀ importé est reconnu (empreinte du texte rangée dans le projet)');
has(PROJ, '|| (!!msImport.previous && !msImport.confirmRepeat && !msImport.figuresOnly)}',
  '…et le second import exige une confirmation explicite (sauf en « figures seules », qui n’écrit aucun texte)');
/* 🖼 RATTRAPER LES FIGURES D'UN DOCUMENT DÉJÀ IMPORTÉ : le document déjà
   importé est justement celui dont on cherche les figures — on ne recolle donc
   PAS son texte. */
has(PROJ, '🖼 Figures only (recover the images — the text is left as it is)',
  'la fenêtre d’import offre « 🖼 Figures only »');
has(PROJ, 'if (d.figuresOnly) {', '…et l’import suit un chemin à part');
has(PROJ, 'figures: res.figures }, { lighten: true }',
  '…qui n’écrit QUE les figures (texte, références et bibliographie intacts)');
has(PROJ, 'the text, the references and the', '…et le compte rendu le dit');
has(PROJ, 'msImports: [...history.filter((it) => !it || it.hash !== receipt.hash), receipt].slice(-20)',
  'l’import laisse son empreinte dans le projet (jamais deux fois la même)');
has(PROJ, "const [storageWarning, setStorageWarning] = useState('');",
  'une écriture refusée par le navigateur se dit aussi dans la page');

/* L'empreinte d'un document est stable, et deux documents ne se confondent pas. */
const FIX_DOC = [
  'Introduction',
  'Aphids transmit potyviruses [1]. Another path [3] was proposed.',
  '',
  'References',
  '1. Rossi M, Bianchi A (2018). Characterization of a potyvirus. J Gen Virol 99:1-9.',
  '2. Dupont J (2020). A paper the text never cites. Virology 500:1-8.',
  '3. Bianchi A (2021). Vector biology of potyviruses. Viruses 13:55.'
].join('\n');
eq(MS.manuscriptFingerprint(FIX_DOC), MS.manuscriptFingerprint(FIX_DOC),
  'l’empreinte d’un document est stable');
ok(MS.manuscriptFingerprint(FIX_DOC) !== MS.manuscriptFingerprint(`${FIX_DOC}\n\n\n`),
  '…et un autre document a une autre empreinte');
eq([...MS.citedNumbersInText('see [5-7] and [12], not [x]')], [5, 6, 7, 12],
  'citedNumbersInText rend les numéros cités, plages comprises');
eq((MS.previousImportOf({ msImports: [{ hash: MS.manuscriptFingerprint(FIX_DOC) }] },
  MS.manuscriptFingerprint(FIX_DOC)) || {}).hash, MS.manuscriptFingerprint(FIX_DOC),
  'previousImportOf retrouve l’import du même document');
eq(MS.previousImportOf({ msImports: [] }, 'inconnu'), null,
  '…et rien (null) pour un document jamais importé');

/* LES RÉFÉRENCES : toutes les entrées retenues sont numérotées — y compris
   celle que le texte ne cite jamais (elle doit figurer dans la bibliographie
   imprimée) — et les citations du texte tombent toujours sur une référence. */
const fixMs = MS.splitManuscript(MS.blocksFromText(FIX_DOC));
const fixPlan = MS.buildManuscriptPlan(fixMs, { existingReferences: [] });
eq(fixPlan.entries.length, 3, 'les trois entrées de la bibliographie sont lues');
ok(['#1', '#2', '#3'].every((k) => fixPlan.numberByKey.has(k)),
  'chaque entrée est repérée par SON numéro de document (« 3. Bianchi… » → #3)');
const fixNumbered = RL.numberImportedReferences(fixPlan.entries.map((e) => e.entry), [], {
  hints: fixPlan.entries.map((e) => e.number)
});
eq(fixNumbered.created.length, 3,
  'les TROIS entrées deviennent des références numérotées — même celle que le texte ne cite pas');
eq(fixNumbered.list.map((r) => r.number), [1, 2, 3], '…avec les numéros du document');
const fixText = MS.convertCitationsInText(
  MS.stripFigureMarks(fixMs.body.map((b) => b.text).join('\n')), fixPlan.numberByKey
).text;
const fixLinked = RL.linkCitationNumbers(MS.htmlFromText(fixText), {
  numbers: RL.referenceNumbers(fixNumbered.list), titleFor: RL.citationTitleGetter(fixNumbered.list)
});
ok(fixLinked.includes('data-ref="1"') && fixLinked.includes('data-ref="3"'),
  'les « [1] » et « [3] » du texte sont liés à LEURS références');
eq([...RL.linkedCitationNumbers(fixLinked)].sort(), [1, 3], '…sans lien de trop');

/* DEUXIÈME IMPORT DU MÊME DOCUMENT : plus rien n'est coché (tout est déjà dans
   la bibliographie du projet) et le plan ne voit plus d'entrée nouvelle — c'est
   exactement le cas où AUCUNE référence n'était créée et où les liens du texte
   n'avaient plus de cible. */
const againPlan = MS.buildManuscriptPlan(fixMs, { existingReferences: fixNumbered.list.map((r) => ({ ...r })) });
const againKept = againPlan.entries.filter((e) => !!e.existing);
eq(againKept.length, 3, 'au second import, les trois entrées sont reconnues comme déjà référencées');
const againNumbered = RL.numberImportedReferences(
  againKept.map((e) => e.entry), fixNumbered.list.map((r) => ({ ...r })),
  { hints: againKept.map((e) => e.number) }
);
eq(againNumbered.created.length, 0, 'aucune référence dupliquée');
eq(againNumbered.list.map((r) => r.number), [1, 2, 3], '…et les numéros du projet sont conservés');
ok(RL.linkCitationNumbers(MS.htmlFromText(fixText), {
  numbers: RL.referenceNumbers(againNumbered.list)
}).includes('data-ref="1"'), 'le texte du second import se lie lui aussi à ses références');

/* Un numéro cité que la bibliographie du document n'explique pas ne reçoit AUCUN
   lien (jamais de lien mort) et l'import le dit. */
eq(RL.linkCitationNumbers(MS.htmlFromText('See [9].'), {
  numbers: RL.referenceNumbers(fixNumbered.list)
}).includes('data-ref'), false, 'un « [9] » sans référence reste un simple nombre');
has(PROJ, 'citation number(s) have no reference in this project',
  '…et le compte rendu les liste (avec la marche à suivre)');

/* ── 22. LES AUTEURS QU'ON NE RECONNAISSAIT TOUJOURS PAS ──────────────────────
   « les auteurs ne sont toujours pas reconnus à l'import du manuscrit ». Quatre
   écritures réelles qui laissaient le champ « Authors » VIDE — un champ vide ne
   dit rien à personne, et la liste disparaissait même du texte importé. */

/* (a) une image de la page de titre entre le titre et les auteurs : la ligne
   n'est plus la suivante IMMÉDIATE du titre. */
const GAP_DOC = [
  TITLE,
  '[[FIGURE 1]]',
  'Mario Rossi, Anna Bianchi',
  'Dipartimento di Agraria, Universita di Napoli, Portici, Italy',
  ...TAIL
];
const gapHeader = MS.parseManuscriptHeader(MS.blocksFromText(GAP_DOC.join('\n')));
eq(gapHeader.authors, 'Mario Rossi, Anna Bianchi',
  'une image entre le titre et les auteurs ne fait plus perdre les auteurs');

/* (b) « M. Rossi, A. Bianchi » (initiale AVANT le nom, style Nature) : les trois
   lecteurs stricts la refusent, le repli de position la PROPOSE. */
const iniHeader = MS.parseManuscriptHeader(MS.blocksFromText([TITLE, 'M. Rossi, A. Bianchi', AFF1, AFF2, ...TAIL].join('\n')));
eq(iniHeader.authors, 'M. Rossi, A. Bianchi', '« M. Rossi, A. Bianchi » est reconnue (initiale avant le nom)');
ok(iniHeader.lines.some((l) => l.role === 'authors' && l.text.includes('M. Rossi')),
  '…et la ligne est bien proposée avec le rôle « Authors » dans la fenêtre');

/* (c) tout en majuscules : « ROSSI M, BIANCHI A ». */
eq(MS.parseManuscriptHeader(MS.blocksFromText([TITLE, 'ROSSI M, BIANCHI A', AFF1, ...TAIL].join('\n'))).authors,
  'ROSSI M, BIANCHI A', 'une liste d’auteurs en majuscules est reconnue');

/* (d) le TITRE n'est pas reconnu : les auteurs ne doivent pas être perdus pour
   autant (avant, un titre manquant vidait aussi le champ « Authors »). */
const noTitleHeader = MS.parseManuscriptHeader(MS.blocksFromText(
  ['Mario Rossi, Anna Bianchi', AFF1, AFF2, ...TAIL].join('\n')
));
ok(noTitleHeader.authors.includes('Mario Rossi'), 'sans titre reconnu, les auteurs sont quand même reconnus');

/* Ce que le repli REFUSE : une seconde ligne de titre (mots de liaison), un
   intitulé de section, une adresse, une phrase. */
ok(!MS.looksLikeLooseAuthorLine('A New Virus Species in the Family Potyviridae'),
  'une seconde ligne de titre (mots de liaison) n’est pas une liste d’auteurs');
ok(!MS.looksLikeLooseAuthorLine('Statistical analysis'), 'un intitulé de méthode non plus');
ok(!MS.looksLikeLooseAuthorLine('Dipartimento di Agraria, Universita di Napoli, Portici, Italy'),
  'une adresse non plus');
ok(!MS.looksLikeLooseAuthorLine('Plants were grown in a greenhouse at 22 degrees.'), 'une phrase non plus');
ok(MS.looksLikeLooseAuthorLine('van der Berg, Anna Rossi'), 'mais « van der Berg, Anna Rossi » en est une');

/* (e) AUCUNE ligne d'en-tête reconnue : la fenêtre montre les premières lignes
   (en « keep ») pour que l'utilisateur désigne lui-même le titre / les auteurs. */
const noWindowHeader = MS.parseManuscriptHeader(MS.blocksFromText(
  ['Aphids transmit potyviruses [1]. Pepper crops are affected.', '', 'Introduction', 'More text.'].join('\n')
));
eq([noWindowHeader.title, noWindowHeader.authors], ['', ''], 'un document sans en-tête donne trois champs vides');
ok(noWindowHeader.lines.length > 0 && noWindowHeader.lines.every((l) => l.role === MS.KEEP_ROLE),
  '…mais ses premières lignes sont MONTRÉES (rôle « keep ») : l’utilisateur peut les désigner');

/* ── 23. « ENTRE L'INTRODUCTION ET LES CONCLUSIONS : RESULTS AND DISCUSSION,
   SAUF LE MATÉRIEL ET MÉTHODES » ─────────────────────────────────────────── */
const RULE_DOC = [
  'Abstract',
  'Aphids transmit potyviruses.',
  '',
  'Introduction',
  'Potyviruses are a large genus.',
  '',
  'Materials and Methods',
  'Aphids were reared on pepper plants.',
  '',
  'Statistical analysis',
  'Data were analysed with R.',
  '',
  'Results',
  'The virus was detected in 40% of the samples.',
  '',
  'Results and discussion',
  'Our data agree with Rossi et al.',
  '',
  'Funding',
  'PRIN 2022.',
  '',
  'Conclusions',
  'Potyviruses spread through aphids.',
  '',
  'References',
  '[1] Rossi M. Characterization of a potyvirus. J Virol 2018;12:345-356.'
].join('\n');
const RULE_MS = MS.splitManuscript(MS.blocksFromText(RULE_DOC));
const ruleParts = MS.withDocumentSections(
  MS.groupManuscriptParts(RULE_MS.body, { header: MS.parseManuscriptHeader(RULE_MS.body) })
);
eq(ruleParts.map((p) => [p.heading, p.id]), [
  ['Abstract', 'background'],
  ['Introduction', 'background'],
  ['Materials and Methods', MS.METHODS_DEST.id],
  ['Statistical analysis', MS.METHODS_DEST.id],
  ['Results', 'discussion'],
  ['Results and discussion', 'discussion'],
  ['Funding', 'funding'],
  ['Conclusions', 'conclusions']
], 'les parties reçoivent la section que leur POSITION implique (M&M à part)');
eq(ruleParts.find((p) => p.heading === 'Results').autoSection, 'discussion',
  '…et la partie sait que c’est la règle de position qui l’a décidée (montrée dans la fenêtre)');
ok(ruleParts.find((p) => p.heading === 'Statistical analysis').id === MS.METHODS_DEST.id,
  'une sous-section de méthodes reste avec les méthodes (elle n’est pas des « résultats »)');

/* Les intitulés de Matériel et méthodes, anglais et français. */
ok(['Materials and Methods', 'Methods', 'Experimental part', 'Experimental procedures',
  'Partie expérimentale', 'Statistical analysis', 'DNA extraction'].every((h) => MS.METHODS_HEADING_RE.test(h)),
  'les intitulés de Matériel et méthodes sont reconnus (anglais et français)');
ok(!MS.METHODS_HEADING_RE.test('Results') && !MS.METHODS_HEADING_RE.test('Discussion'),
  '« Results » et « Discussion » n’en sont pas');
eq(MS.METHODS_DEST.id, 'materialsAndMethods',
  'le Matériel et méthodes vise le champ « Materials and Methods » du projet');

/* Rien n'est deviné HORS de la zone : après les Conclusions, une partie qui ne
   dit rien à personne reste à choisir (dest « — do not import — »). */
const afterConc = MS.withDocumentSections(MS.groupManuscriptParts(
  MS.splitManuscript(MS.blocksFromText([
    'Introduction', 'Text.', '', 'Results', 'Text.', '', 'Conclusions', 'Text.', '', 'Additional experiments', 'Text.'
  ].join('\n'))).body, {}
));
eq(afterConc.map((p) => [p.heading, p.id]),
  [['Introduction', 'background'], ['Results', 'discussion'], ['Conclusions', 'conclusions'], ['Additional experiments', '']],
  'après les Conclusions, aucune section n’est devinée');
/* Un chapeau sans intitulé (le résumé imprimé avant le premier titre) n'est
   JAMAIS versé dans « Results and discussion » : la fenêtre demande. */
const leadPart = MS.withDocumentSections(MS.groupManuscriptParts(
  MS.splitManuscript(MS.blocksFromText(['Aphids transmit potyviruses.', '', 'Introduction', 'Text.'].join('\n'))).body, {}
));
eq(leadPart.map((p) => [p.heading, p.id]), [['', ''], ['Introduction', 'background']],
  'le chapeau sans intitulé reste à choisir (il n’est pas « Results and discussion »)');

/* ── 23 ter. L'EN-TÊTE ET LES INTITULÉS, DANS L'ÉCRITURE D'UN VRAI MANUSCRIT ──
   Quatre défauts signalés par l'utilisateur sur son propre article :
     « la liste des auteurs, juste après le titre et avant les affiliations,
       n'est toujours pas reconnue » ;
     « le texte commençant par Materials and Methods n'est pas allé dans
       Matériel et méthodes » ;
     « la ligne des auteurs correspondants (avec les e-mails) n'est pas allée à
       la fin des affiliations » ;
     « l'Introduction n'est pas allée dans Scientific background ».
   Les causes, chacune vérifiée ici :
     • les exposants d'affiliation UNICODE (« Rossi¹ », « Rossi¹² ») n'étaient
       relus par AUCUN lecteur d'en-tête — la ligne d'auteurs restait vide ;
     • un intitulé PONCTUÉ (« 2. Materials and Methods. ») ou en MAJUSCULES
       précédé d'un numéro romain (« II. MATERIALS AND METHODS ») n'était pas un
       titre (il passait même pour une liste d'auteurs) : son texte se collait à
       la partie précédente ;
     • une métadonnée intercalée (« Keywords: … ») coupait la liste des
       affiliations : l'e-mail du correspondant était « consommé » sans être
       gardé ;
     • une partie déclarée « Introduction » / « Abstract » était retournée en
       « Results and discussion » par la règle de position. */
const AUTHOR_SHAPES = [
  'Mario Rossi1, Anna Bianchi1, Jean Dupont2',
  'Maria Grazia Rossi1, Anna Bianchi1',
  'Mario Rossi\u00b9, Anna Bianchi\u00b9\u00b2, Jean Dupont\u00b2',
  'Mario Rossi\u1d43, Anna Bianchi\u1d47',
  'Jan van der Berg1, Anna de la Cruz2',
  'Jean-Luc Dupont1, Anna O\u2019Brien2',
  '1 Mario Rossi, 2 Anna Bianchi',
  'Mario Rossi[1], Anna Bianchi[1,2]',
  'Mario Rossi, Anna Bianchi',
  'M. Rossi, A. Bianchi',
  'ROSSI, M., BIANCHI, A.',
  'Rossi M, Bianchi A, et al.',
  'Mario Rossi a, Anna Bianchi b',
  'Mario Rossi (1), Anna Bianchi (2)'
];
const authorShapeFails = AUTHOR_SHAPES.filter((line) => {
  const h = MS.parseManuscriptHeader(MS.blocksFromText([
    'Aphid transmission of a new potyvirus in pepper crops',
    line,
    '1 Dipartimento di Agraria, Universita di Napoli, Portici, Italy',
    '*Corresponding author: mario.rossi@unina.it'
  ].join('\n')));
  return !h.authors || h.affiliations.split('\n').length !== 2;
});
eq(authorShapeFails, [],
  'toutes les écritures d’une liste d’auteurs sont reconnues (exposants Unicode, numéros en tête, crochets du .docx)');
eq(MS.stripAffilMarks('Mario Rossi\u00b9'), 'Mario Rossi', '« Rossi¹ » → « Rossi » (exposant Unicode)');
eq(MS.stripAffilMarks('Mario Rossi\u00b9,\u00b2'), 'Mario Rossi', '…et ses deux exposants');

const UNI_HEADER = MS.parseManuscriptHeader(MS.blocksFromText([
  'Aphid transmission of a new potyvirus infecting pepper crops',
  'Mario Rossi\u00b9, Anna Bianchi\u00b9\u00b2, Jean Dupont\u00b2',
  '\u00b9 Dipartimento di Agraria, Universita di Napoli, Portici, Italy',
  '\u00b2 INRAE, Villenave d\u2019Ornon, France',
  '*Corresponding authors: mario.rossi@unina.it; jean.dupont@inrae.fr',
  'Abstract',
  'The potyvirus was transmitted by aphids.'
].join('\n')));
eq(UNI_HEADER.authors, 'Mario Rossi\u00b9, Anna Bianchi\u00b9\u00b2, Jean Dupont\u00b2',
  'la liste d’auteurs en exposants Unicode est reconnue (elle était VIDE)');
eq(UNI_HEADER.affiliations.split('\n').length, 3, '…avec ses deux adresses + l’auteur correspondant');
eq(UNI_HEADER.affiliations.split('\n')[2], '*Corresponding authors: mario.rossi@unina.it; jean.dupont@inrae.fr',
  'l’e-mail du correspondant est la DERNIÈRE ligne des affiliations');

const KW_HEADER = MS.parseManuscriptHeader(MS.blocksFromText([
  'Aphid transmission of a new potyvirus infecting pepper crops',
  'Mario Rossi1, Anna Bianchi1',
  '1 Dipartimento di Agraria, Universita di Napoli, Portici, Italy',
  'Keywords: potyvirus, aphids, pepper',
  '*Corresponding authors: mario.rossi@unina.it',
  'Abstract',
  'The potyvirus was transmitted by aphids.'
].join('\n')));
eq(KW_HEADER.affiliations.split('\n'),
  ['1 Dipartimento di Agraria, Universita di Napoli, Portici, Italy',
    '*Corresponding authors: mario.rossi@unina.it'],
  'une métadonnée intercalée ne fait plus perdre la ligne de l’auteur correspondant');
ok(!KW_HEADER.affiliations.includes('Keywords'), '…et les mots-clés ne deviennent pas une affiliation');

/* Les INTITULÉS tels qu'un manuscrit les écrit : ponctués, numérotés, en
   majuscules, avec une puce. */
ok(MS.isHeadingLine('2. Materials and Methods.'), 'un intitulé ponctué est un titre');
ok(MS.isHeadingLine('1. Introduction.'), '…même en tête de document');
ok(MS.isHeadingLine('II. MATERIALS AND METHODS'), 'un intitulé en majuscules numéroté est un titre');
ok(MS.isHeadingLine('• Results'), '…et une puce ne l’empêche pas');
ok(!MS.isHeadingLine('Discussion and conclusions follow.'), 'une PHRASE qui commence comme un intitulé reste du texte');
ok(!MS.isHeadingLine('Materials were harvested in 2024.'), '…et un intitulé suivi d’un verbe n’en est pas un');
eq(MS.sectionHeadingKey('2. Materials and Methods.'), 'Materials and Methods',
  'la clé d’un intitulé perd numérotation, puce et ponctuation');

const PUNCT_MS = MS.splitManuscript(MS.blocksFromText([
  'Aphid transmission of a new potyvirus infecting pepper crops',
  'Mario Rossi1, Anna Bianchi1',
  '1 Dipartimento di Agraria, Universita di Napoli, Portici, Italy',
  'Correspondence: mario.rossi@unina.it',
  '1. Introduction.',
  'Pepper crops are affected by several viruses [1].',
  '2. Materials and Methods.',
  'Plants were grown in a greenhouse.',
  '3. Results and Discussion.',
  'Aphids transmitted the virus efficiently.',
  '4. Conclusions.',
  'The new potyvirus spreads in southern Italy.'
].join('\n')));
eq(MS.withDocumentSections(
  MS.groupManuscriptParts(PUNCT_MS.body, { header: MS.parseManuscriptHeader(PUNCT_MS.body) })
).map((p) => [p.heading, p.id]), [
  ['Introduction.', 'background'],
  ['Materials and Methods.', MS.METHODS_DEST.id],
  ['Results and Discussion.', 'discussion'],
  ['Conclusions.', 'conclusions']
], 'un document aux intitulés PONCTUÉS va dans les bonnes sections (et non dans une seule partie)');

const CAPS_MS = MS.splitManuscript(MS.blocksFromText([
  'APHID TRANSMISSION OF A NEW POTYVIRUS IN PEPPER CROPS',
  'MARIO ROSSI1, ANNA BIANCHI1',
  '1 DIPARTIMENTO DI AGRARIA, UNIVERSITA DI NAPOLI, PORTICI, ITALY',
  'I. INTRODUCTION',
  'PEPPER CROPS ARE AFFECTED BY SEVERAL VIRUSES [1].',
  'II. MATERIALS AND METHODS',
  'PLANTS WERE GROWN IN A GREENHOUSE.',
  'III. RESULTS AND DISCUSSION',
  'APHIDS TRANSMITTED THE VIRUS EFFICIENTLY.',
  'IV. CONCLUSIONS',
  'THE NEW POTYVIRUS SPREADS IN SOUTHERN ITALY.'
].join('\n')));
eq(MS.withDocumentSections(
  MS.groupManuscriptParts(CAPS_MS.body, { header: MS.parseManuscriptHeader(CAPS_MS.body) })
).map((p) => [p.heading, p.id]), [
  ['INTRODUCTION', 'background'],
  ['MATERIALS AND METHODS', MS.METHODS_DEST.id],
  ['RESULTS AND DISCUSSION', 'discussion'],
  ['CONCLUSIONS', 'conclusions']
], 'les intitulés en MAJUSCULES numérotés (I., II.) ne sont pas pris pour des listes d’auteurs');

/* Une partie qui DIT « Introduction » / « Abstract » garde la section
   « Scientific background » même quand un intitulé la précède : la règle de
   position ne s'applique qu'aux parties qui ne disent rien. */
eq(MS.withDocumentSections(MS.groupManuscriptParts(
  MS.splitManuscript(MS.blocksFromText([
    'Highlights', 'A new potyvirus was found.', '', 'Introduction', 'Text.',
    '', 'Materials and Methods', 'Text.'
  ].join('\n'))).body, {}
)).map((p) => [p.heading, p.id]), [
  ['Highlights', 'discussion'],
  ['Introduction', 'background'],
  ['Materials and Methods', MS.METHODS_DEST.id]
], 'l’Introduction garde Scientific background, même précédée d’un autre intitulé');

/* …et la liste à numéros EN TÊTE ne prend jamais un intitulé numéroté pour une
   liste de noms (« 2. Statistical analysis » se coupe en deux « noms »). */
eq(MS.parseManuscriptHeader(MS.blocksFromText([
  'Aphid transmission of a new potyvirus in pepper crops',
  '2. Statistical analysis',
  'Data were analysed with R.'
].join('\n'))).authors, '',
  'un intitulé de méthode numéroté n’est pas pris pour une liste d’auteurs');


const FMT_DOCX = zipSync({
  'word/document.xml': strToU8([
    '<?xml version="1.0" encoding="UTF-8"?><w:document><w:body>',
    '<w:p><w:r><w:t>Introduction</w:t></w:r></w:p>',
    '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r>',
    '<w:r><w:t xml:space="preserve"> and </w:t></w:r>',
    '<w:r><w:rPr><w:i/></w:rPr><w:t>italics</w:t></w:r>',
    '<w:r><w:t>, H</w:t></w:r>',
    '<w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t>2</w:t></w:r>',
    '<w:r><w:t>O, 10</w:t></w:r>',
    '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>9</w:t></w:r>',
    '<w:r><w:t> virions as shown before</w:t></w:r>',
    '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>12</w:t></w:r>',
    '<w:r><w:t>.</w:t></w:r></w:p>',
    '</w:body></w:document>'
  ].join(''))
});
const fmtDoc = MS.docxManuscriptFromBytes(FMT_DOCX);
const fmtLine = 'Bold and italics, H2O, 109 virions as shown before[12].';
eq(fmtDoc.text, `Introduction\n\n${fmtLine}`,
  'le renvoi en exposant devient son marqueur [12] (comme avant), le reste du texte est intact');
ok(fmtDoc.htmlByText && fmtDoc.htmlByText.get(fmtLine),
  '…et la MISE EN FORME du paragraphe est gardée à part (htmlByText)');
eq(fmtDoc.htmlByText.get(fmtLine)[0],
  '<strong>Bold</strong> and <em>italics</em>, H<sub>2</sub>O, 10<sup>9</sup> virions as shown before[12].',
  'gras, italique, indice et exposant sont conservés — la citation reste « [12] », pas un exposant');
ok(!fmtDoc.htmlByText.get(fmtLine)[0].includes('<sup>[12]</sup>'),
  'la citation ne redevient pas un exposant : le lien vers la référence doit rester lisible');

/* Le HTML d'une partie : marqueurs de figure retirés, mise en forme reprise,
   citations converties dans les numéros du PROJET — et CHAQUE LIGNE DANS SON
   PARAGRAPHE (`<p>…</p>`) : sans ce bloc, les sauts de ligne du document
   s'affichaient collés et l'ancre d'une figure ne trouvait plus sa fin. */
eq(MS.htmlFromManuscriptPart(`[[FIGURE 1]]\n${fmtLine}`,
  { htmlByText: fmtDoc.htmlByText, numbers: new Map([['#12', 5]]) }),
'<p><strong>Bold</strong> and <em>italics</em>, H<sub>2</sub>O, 10<sup>9</sup> virions as shown before[5].</p>',
'la partie garde sa typographie, perd son marqueur de figure et prend le numéro du projet');
/* Un document sans mise en forme (texte collé) : texte échappé, mêmes blocs. */
eq(MS.htmlFromManuscriptPart('H2O and [12].\n\nSecond paragraphe.', { numbers: new Map([['#12', 5]]) }),
  '<p>H2O and [5].</p>\n<p>Second paragraphe.</p>',
  'sans mise en forme connue, le texte est échappé — et chaque ligne reste un PARAGRAPHE');

/* Un paragraphe coupé par un SAUT DE LIGNE FORCÉ (`<w:br>` → « \n » dans le
   texte, « <br> » dans le HTML) : ses lignes entrent une à une dans la table de
   mise en forme, sinon elles ressortaient en texte nu (gras et italique perdus). */
const brMap = MS.htmlByTextFromRecords([
  { text: 'Ligne A\nLigne B', html: '<strong>Ligne A</strong><br><em>Ligne B</em>' }
]);
eq(brMap.get('Ligne A'), ['<strong>Ligne A</strong>'], 'la 1ʳᵉ ligne d’un paragraphe coupé par un <br> garde sa mise en forme');
eq(brMap.get('Ligne B'), ['<em>Ligne B</em>'], '…et la 2ᵉ garde la sienne');
eq(MS.htmlByTextFromRecords([{ text: 'A\nB\nC', html: '<b>A</b>' }]).get('A\nB\nC'), ['<b>A</b>'],
  'des découpes qui ne correspondent pas (3 lignes contre 1 morceau) laissent la table telle quelle');

/* Les blocs portent leur HTML : c'est lui qui traverse le découpage. */
const fmtBlocks = MS.blocksFromText(fmtDoc.text, { htmlByText: fmtDoc.htmlByText });
eq(fmtBlocks.map((b) => [b.text.slice(0, 9), !!b.html]), [['Introduct', false], ['Bold and ', true]],
  'seul le paragraphe mis en forme porte son HTML');

/* ── 25. CÂBLAGE : sections par position, Matériel et méthodes, typographie ── */
has(PROJ, 'withDocumentSections(groupManuscriptParts', 'la page projet donne aux parties leur section par position');
has(PROJ, 'const headerMissing = [\'title\', \'authors\', \'affiliations\'].filter',
  'la fenêtre d’import dit ce qui N’A PAS été reconnu');
has(PROJ, 'no ${headerMissing.join(\' / no \')} recognised',
  '…et elle dit où le reprendre à la main');
has(PROJ, 'METHODS_DEST.id', 'le Matériel et méthodes a sa destination propre');
has(PROJ, 'mmPatch.materialsAndMethods = {',
  'son texte va dans le champ « 📋 Materials and Methods » du projet');
has(PROJ, 'imported: true', '…et il est marqué comme venu d’un manuscrit (jamais écrasé en douce)');
has(PROJ, 'html: htmlFromManuscriptPart(p.text, { htmlByText: d.htmlByText, numbers })',
  'le texte importé reprend la typographie du document');
has(PROJ, 'analyseManuscript(doc.text, file.name, doc.figures, undefined, doc.htmlByText)',
  '…et le .docx transmet sa mise en forme à l’analyse');
has(PROJ, 'No {row.label.toLowerCase()} recognised in the document — set the role of the right line',
  'un champ d’en-tête vide est signalé dans la fenêtre, avec la marche à suivre');

console.log(`✅ ${passed} tests passés (manuscrit — blocs / parties / en-tête / sections / liens / figures)`);

