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

console.log(`✅ ${passed} tests passés (manuscrit — blocs / parties)`);

