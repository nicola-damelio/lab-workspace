/* =========================================================================
   _reference_import_test.mjs — import de références & récupération de papiers.

   Le module RÉEL est importé (src/utils/referenceImport.js, sans React) :
    - un .docx est construit ici même (fflate) avec une bibliographie Paperpile
      (dont un code de champ ADDIN qui ne doit JAMAIS apparaître dans le texte) ;
    - RIS, BibTeX et bibliographie « texte » (APA / Nature / « Auteur (Année) »)
      sont analysés ;
    - la fusion ne doit jamais supprimer ni écraser : elle ajoute et complète ;
    - un fichier de sauvegarde (.html, LZString) ne rend QUE ses papiers.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import LZString from 'lz-string';

import {
  BACKUP_BLOB_RE, backupFigureCount, backupPaperCount, bibliographyBlockToEntry, docxTextFromBytes,
  entryKey, extractDoi, extractPmid, extractYear, figuresFromBackupHtml, figuresFromBackupState,
  formatAuthor, formatAuthors, isAuthorListTitle, isMarkerTitle, looksLikeAffiliationEntry, looksLikeReference, mergePaperLists, mergeProjectBibliographies,
  mergeReferenceEntries, normalizeAuthorList, papersFromBackupHtml, paperKey,
  parseReferences, parseRisRecords, projectBibEntry, readReferenceDocument,
  referenceScore, rotateJournalFirst, splitReferenceBlocks
} from './src/utils/referenceImport.js';
/* Le moteur de citation RÉEL (sans React) : une référence importée doit
   s'afficher comme n'importe quelle référence du projet. */
import { buildPubFormat, matchCoauthors, pubCitationData, pubCitationHtml } from './src/components/pubCitation.js';

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};


/* ── 1. Un .docx (Paperpile dans Google Docs / Word) → texte ────────────── */
/* `w:instrText` porte le JSON de la citation Paperpile : il est retiré, sinon
   le « texte » de la bibliographie serait pollué par des données machine. */
const docxXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>Introduction of the manuscript, not a reference.</w:t></w:r></w:p>
<w:p><w:r><w:instrText xml:space="preserve"> ADDIN CSL_CITATION {"citationID":"abc","title":"Should never leak"}</w:instrText></w:r><w:r><w:t>1.</w:t></w:r><w:r><w:t xml:space="preserve"> Smith, J., Rossi, M. (2020). Membrane dynamics of antimicrobial peptides. J. Biol. Chem. 295(3), 1234-1256. https://doi.org/10.1016/j.jbc.2020.012345</w:t></w:r></w:p>
<w:p><w:r><w:t>2. Verdi, G., &amp; Costa, L. Antimicrobial resistance in biofilms. Nature 580, 45-49 (2019). doi:10.1038/s41586-019-1234-5</w:t></w:r></w:p>
</w:body></w:document>`;
const docxBytes = zipSync({ 'word/document.xml': strToU8(docxXml) });
const docxText = docxTextFromBytes(docxBytes);

ok(docxText.includes('1. Smith, J., Rossi, M.'), 'le texte du .docx contient la 1re référence');
ok(!docxText.includes('ADDIN CSL_CITATION') && !docxText.includes('Should never leak'),
  'les codes de champ Paperpile (JSON ADDIN) sont supprimés du texte');
eq(docxText.split('\n').length, 3, 'un paragraphe = une ligne (bibliographie Paperpile)');
eq(docxText.split('\n')[0], 'Introduction of the manuscript, not a reference.',
  'le texte du corps du document reste présent (il sera filtré à l’analyse)');

/* `readReferenceDocument` choisit le bon lecteur selon l'extension. */
const fakeDocx = { name: 'paper.docx', arrayBuffer: async () => docxBytes.buffer.slice(docxBytes.byteOffset, docxBytes.byteOffset + docxBytes.byteLength) };
const fromDocx = await readReferenceDocument(fakeDocx);
ok(fromDocx.includes('Antimicrobial resistance in biofilms'), 'readReferenceDocument lit un .docx déposé');
const fromTxt = await readReferenceDocument({ name: 'refs.txt', text: async () => 'R1 ligne' });
eq(fromTxt, 'R1 ligne', 'readReferenceDocument lit un fichier texte');

/* ── 2. Analyse : le corps du document est ignoré, les références gardées ─ */
const fromDocxParsed = parseReferences(docxText);
eq(fromDocxParsed.length, 2, 'seules les 2 références sont retenues (pas la phrase d’introduction)');

const apa = fromDocxParsed[0];
eq(apa.title, 'Membrane dynamics of antimicrobial peptides', 'titre (style APA : année après les auteurs)');
eq(apa.authors, 'Smith J, Rossi M', 'auteurs normalisés « Nom Initiales » (style APA)');
eq(apa.journal, 'J. Biol. Chem.', 'journal (le point abrégé fait partie du nom)');
eq(apa.year, '2020', 'année');
eq(apa.volume, '295', 'volume');
eq(apa.pages, '1234-1256', 'pages');
eq(apa.doi, '10.1016/j.jbc.2020.012345', 'DOI');
eq(apa.link, 'https://doi.org/10.1016/j.jbc.2020.012345', 'lien direct du DOI');

const nature = fromDocxParsed[1];
eq(nature.title, 'Antimicrobial resistance in biofilms', 'titre (style Nature : année à la fin)');
eq(nature.authors, 'Verdi G, Costa L', '« & » converti en liste d’auteurs');
eq(nature.journal, 'Nature', 'journal (style Nature)');
eq(nature.volume, '580', 'volume (style Nature)');
eq(nature.pages, '45-49', 'pages (style Nature)');
eq(nature.year, '2019', 'année à la fin de la référence');
eq(nature.doi, '10.1038/s41586-019-1234-5', 'DOI collé au préfixe « doi: »');

/* ── 3. Format « Auteur (Année) » de Paperpile, avec volume:pages ───────── */
const paperpile = parseReferences('1. Rossi M, Bianchi A (2018). Peptide-membrane interactions in model bilayers. Biochim. Biophys. Acta 1860:1234-1245. doi:10.1016/j.bbamem.2018.01.001');
eq(paperpile.length, 1, 'une référence « Auteur (Année) » est reconnue');
eq(paperpile[0].authors, 'Rossi M, Bianchi A', 'auteurs « Nom Initiales » conservés');
eq(paperpile[0].title, 'Peptide-membrane interactions in model bilayers', 'titre sans le point final');
eq(paperpile[0].journal, 'Biochim. Biophys. Acta', 'journal suivi de volume:pages');
eq(paperpile[0].volume, '1860', 'volume après le journal');
eq(paperpile[0].pages, '1234-1245', 'pages « début-fin »');

/* ── 4. RIS (ce que Paperpile exporte) ─────────────────────────────────── */
const ris = `TY  - JOUR
AU  - Rossi, Marco
AU  - Bianchi, Anna
AU  - Smith, John A.
TI  - Voltage-dependent gating of a membrane channel
JO  - Journal of Molecular Biology
PY  - 2021
VL  - 433
IS  - 12
SP  - 166789
EP  - 166799
DO  - 10.1016/j.jmb.2021.166789
AN  - 33901542
UR  - https://www.sciencedirect.com/science/article/pii/S0022283621002015
ER  - 
`;
const risEntries = parseRisRecords(ris);
eq(risEntries.length, 1, 'un bloc RIS = une référence');
eq(risEntries[0].authors, 'Rossi M, Bianchi A, Smith JA', 'auteurs RIS « Nom Prénom » → « Nom Initiales »');
eq(risEntries[0].title, 'Voltage-dependent gating of a membrane channel', 'titre RIS');
eq(risEntries[0].journal, 'Journal of Molecular Biology', 'journal RIS (JO)');
eq(risEntries[0].year, '2021', 'année RIS (PY)');
eq(risEntries[0].volume, '433', 'volume RIS (VL)');
eq(risEntries[0].pages, '166789-166799', 'pages RIS (SP/EP)');
eq(risEntries[0].pmid, '33901542', 'l’identifiant PubMed (AN) est conservé — il permet de retrouver les auteurs');
eq(parseReferences(ris).length, 1, 'parseReferences détecte le format RIS tout seul');

/* ── 5. BibTeX ─────────────────────────────────────────────────────────── */
const bibtex = `@article{rossi2022,
  author = {Rossi, Marco and Bianchi, Anna and M{\\"u}ller, Klaus},
  title = {A {NMR} study of {AMP} aggregation},
  journal = {Nature Communications},
  year = {2022},
  volume = {13},
  pages = {1--9},
  doi = {10.1038/s41467-022-12345-6},
  url = {https://www.nature.com/articles/s41467-022-12345-6}
}`;
const bibEntries = parseReferences(bibtex);
eq(bibEntries.length, 1, 'une entrée BibTeX = une référence');
eq(bibEntries[0].authors, 'Rossi M, Bianchi A, Müller K', 'auteurs BibTeX séparés par « and »');
eq(bibEntries[0].title, 'A NMR study of AMP aggregation', 'accolades de protection BibTeX retirées du titre');
eq(bibEntries[0].journal, 'Nature Communications', 'journal BibTeX');
eq(bibEntries[0].pages, '1-9', 'pages BibTeX « -- » → « - »');
eq(bibEntries[0].doi, '10.1038/s41467-022-12345-6', 'DOI BibTeX');

/* ── 6. Utilitaires de champs & de découpage ───────────────────────────── */
eq(extractDoi('… https://doi.org/10.1002/bip.22345.'), '10.1002/bip.22345', 'DOI nettoyé du point final');
eq(extractDoi('10.1038/s41586-019-1234-5'), '10.1038/s41586-019-1234-5', 'DOI nu accepté');
eq(extractPmid('PubMed 12345678'), '12345678', 'identifiant PubMed reconnu');
eq(extractYear('Smith (2019a) Title'), '2019', 'année entre parenthèses (suffixe a ignoré)');
eq(formatAuthor('Rossi, Marco'), 'Rossi M', 'auteur « Nom, Prénom »');
eq(formatAuthor('Anna Bianchi'), 'Bianchi A', 'auteur « Prénom Nom »');
eq(formatAuthors(['Rossi, Marco', 'Bianchi, Anna']), 'Rossi M, Bianchi A', 'liste d’auteurs RIS');
eq(normalizeAuthorList('Smith, J., Rossi, M., & Costa, L.'), 'Smith J, Rossi M, Costa L', 'auteurs APA convertis');
eq(normalizeAuthorList('Rossi M, Bianchi A'), 'Rossi M, Bianchi A', 'liste déjà au bon format laissée intacte');
ok(referenceScore('Smith, J., Rossi, M. (2020). A title. J 12, 3-9. doi:10.1/abc') >= 4,
  'une référence typique obtient un score élevé');
ok(referenceScore('Introduction') === 0, 'un mot isolé n’est pas une référence');
ok(looksLikeReference('Rossi M, Bianchi A (2018). Peptide-membrane interactions in model bilayers. BBA 1860:1234-1245.'),
  'une référence sans DOI mais avec année/volume/pages est reconnue');

/* Le découpage recolle une référence coupée en deux par un retour à la ligne. */
const wrapped = splitReferenceBlocks('1. Rossi M (2020). A very long title that was wrapped by the\njournal layout. J. Mol. Biol. 432(1), 12-19.');
eq(wrapped.length, 1, 'une référence coupée en deux lignes reste UNE référence');
ok(wrapped[0].includes('wrapped by the journal layout'), 'la 2e ligne est recollée');
ok(bibliographyBlockToEntry('Résumé', {}).title && referenceScore('Résumé') === 0,
  'une ligne isolée du corps du texte n’est pas retenue par le score');


/* ── 7. Fusion : on ajoute et on complète, on n’écrase JAMAIS ──────────── */
const existingBib = [
  { id: 'b1', title: 'Peptide-membrane interactions in model bilayers', authors: '', year: '', doi: '' },
  { id: 'b2', title: 'Another paper', authors: 'Verdi G', year: '2015', doi: '10.1/other' }
];
const merged = mergeReferenceEntries(existingBib, [
  /* Même papier que b1 : reconnu par son TITRE (aucun DOI enregistré). */
  { title: 'Peptide–membrane interactions in model bilayers', authors: 'Rossi M, Bianchi A', journal: 'BBA', year: '2018', doi: '10.1016/j.bbamem.2018.01.001', volume: '1860', pages: '1234-1245', link: '' },
  /* Nouveau papier. */
  { title: 'Brand new paper', authors: 'Smith J', year: '2023', doi: '10.1/new' },
  /* b2, mais avec une année DIFFÉRENTE : l’année saisie à la main est gardée. */
  { title: 'Another paper', authors: 'Verdi G', year: '1999', doi: '10.1/other', journal: 'Nature' }
]);
eq(merged.added, 1, 'une seule référence réellement ajoutée');
eq(merged.filled, 2, 'deux entrées existantes complétées');
eq(merged.list.length, 3, 'rien n’est supprimé');
eq(merged.list[0].authors, 'Rossi M, Bianchi A', 'les auteurs manquants sont recopiés');
eq(merged.list[0].doi, '10.1016/j.bbamem.2018.01.001', 'le DOI manquant est recopié');
eq(merged.list[1].year, '2015', 'une valeur déjà saisie n’est jamais écrasée');
eq(merged.list[1].journal, 'Nature', 'un champ vide est complété sans toucher au reste');
eq(merged.list[2].title, 'Brand new paper', 'la nouvelle référence est ajoutée à la fin');

/* Le même papier deux fois (DOI nu puis URL de DOI) : un seul exemplaire. */
const twice = mergeReferenceEntries([], [
  { title: 'Paper X', doi: '10.1000/xyz' },
  { title: 'Paper X (preprint)', doi: 'https://doi.org/10.1000/xyz' }
]);
eq(twice.list.length, 1, 'le DOI sert de clé de doublon (URL et forme nue identiques)');
eq(entryKey({ title: 'Paper X', doi: 'https://doi.org/10.1000/XYZ' }), 'doi:10.1000/xyz', 'clé de doublon en minuscules');
eq(entryKey({ title: 'Titre accentué : les peptides', authors: 'X' }), 'title:titre accentue les peptides', 'clé de repli : le titre normalisé');

/* ── 8. Entrée de « Project bibliography » & listes de papiers ─────────── */
const entry = projectBibEntry(
  { title: 'Peptide work', authors: 'Rossi M', journal: 'BBA', year: '2018', doi: '10.1/x', pmid: '12345678', volume: '1860', pages: '12-19' },
  { scientist: 'Rossi M' }, 'bib_test_1');
eq(entry.id, 'bib_test_1', 'identifiant fourni à l’entrée');
eq(entry.scientist, 'Rossi M', 'l’entrée est rattachée au titulaire du projet');
eq(entry.link, 'https://doi.org/10.1/x', 'le lien est déduit du DOI');
eq(entry.comments, '', 'pas de commentaire à l’import');
ok(!('raw' in entry), 'aucun déchet d’analyse (texte brut) n’est enregistré dans le projet');
ok(projectBibEntry({ title: 'X' }).id.startsWith('bib_'), 'un identifiant est créé quand aucun n’est fourni');

const pubMerge = mergePaperLists(
  [{ id: 'pub1', scientist: 'Rossi M', title: 'My paper', authors: '', year: '2020' }],
  [{ id: 'pub1', scientist: 'Rossi M', title: 'My paper', authors: 'Rossi M, Bianchi A', journal: 'BBA' },
   { id: 'pub2', scientist: 'Bianchi A', title: 'Other paper' }]
);
eq(pubMerge.list.length, 2, 'les publications sont fusionnées par identifiant');
eq(pubMerge.list[0].authors, 'Rossi M, Bianchi A', 'les auteurs manquants d’une publication sont complétés');
eq(pubMerge.added, 1, 'une publication ajoutée');
eq(pubMerge.filled, 1, 'une publication complétée');
eq(paperKey({ id: 'pub9' }), 'id:pub9', 'clé d’un papier par identifiant');

const bibMerge = mergeProjectBibliographies(
  [{ id: 'p1', name: 'AMPs', scientist: 'Rossi M', bibliography: [{ id: 'b1', title: 'Kept paper' }] }],
  [{ id: 'p1', name: 'AMPs', bibliography: [{ id: 'b1', title: 'Kept paper' }, { id: 'b9', title: 'Recovered paper', doi: '10.1/rec' }] },
   { id: 'pX', name: 'Unknown project', bibliography: [{ id: 'bx', title: 'Orphan' }] }]
);
eq(bibMerge.added, 1, 'la référence perdue est récupérée');
eq(bibMerge.projectsTouched, 1, 'seul le projet existant est modifié');
eq(bibMerge.projects[0].bibliography.length, 2, 'la bibliographie du projet existant grandit');
eq(bibMerge.projects[0].bibliography[0].title, 'Kept paper', 'les papiers actuels du projet sont conservés');
ok(!bibMerge.projects.some((p) => p.name === 'Unknown project'), 'aucun projet fantôme n’est créé');


/* ── 9. Un fichier de sauvegarde ne rend QUE ses papiers ───────────────── */
const backupState = {
  tests: [{ id: 't1', name: 'Experiment that must NOT be touched' }],
  datasetTitle: 'Old dataset',
  projects: [{
    id: 'p1', name: 'AMPs', scientist: 'Rossi M',
    bibliography: [{ id: 'old1', title: 'Lost paper about membranes', doi: '10.1/lost', authors: 'Rossi M' }]
  }],
  _publications: [{ id: 'pub1', scientist: 'Rossi M', title: 'My publication' }],
  _relevantPapers: [{ id: 'rel1', title: 'Relevant lost paper' }],
  _relevantSubjects: ['NMR'],
  /* Bibliothèque d'images : les images sont sur le Drive, la LISTE qui les
     affiche vit dans le navigateur — elle voyage donc aussi dans le fichier. */
  _figuresLibrary: [{ id: 'img1', label: 'CD spectra', url: 'data:image/png;base64,aa' }],
  _figuresLibraryProjects: { p1: [{ id: 'img2', label: 'Canvas', url: 'data:image/png;base64,bb' }] },
  storages: [{ id: 's1', name: 'Freezer -80 #3' }]
};
const backupHtml = '<!DOCTYPE html><html><body><h2>backup</h2>'
  + '<script type="application/json" id="saved-data-blob">'
  + JSON.stringify({
    payload: LZString.compressToUTF16(JSON.stringify(backupState)),
    isCompressed: true, title: 'Old dataset', savedAt: 1700000000000
  }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  + '</script></body></html>';

ok(BACKUP_BLOB_RE.test(backupHtml), 'le bloc de données de la sauvegarde est reconnu');
const recovered = papersFromBackupHtml(backupHtml, (s) => LZString.decompressFromUTF16(s));
eq(recovered.publications.length, 1, 'les publications de la sauvegarde sont lues');
eq(recovered.relevantPapers.length, 1, 'les « Relevant papers » de la sauvegarde sont lus');
eq(recovered.projects[0].bibliography[0].title, 'Lost paper about membranes', 'la bibliographie du projet est lue');
eq(recovered.title, 'Old dataset', 'le titre du dataset sauvegardé est disponible');
ok(!('storages' in recovered) && !('tests' in recovered),
  'aucune autre section du fichier (expériences, stockage…) n’est reprise');
eq(backupPaperCount(recovered),
  { publications: 1, relevantPapers: 1, projectBib: 1, projects: 1 },
  'l’aperçu compte les papiers trouvés');
eq(papersFromBackupHtml('<html><body>pas une sauvegarde</body></html>', (s) => s), null,
  'un fichier étranger est refusé proprement');

/* La BIBLIOTHÈQUE D'IMAGES du même fichier : elle est lue séparément des papiers
   (aucune autre section n'est reprise) et son compte-rendu sert à la fenêtre
   « ♻️ Recover » de la page Figures & Slides. */
const figures = figuresFromBackupHtml(backupHtml, (s) => LZString.decompressFromUTF16(s));
eq(figures.common.map((i) => i.id), ['img1'], 'la bibliothèque d’images commune du fichier est lue');
eq(Object.keys(figures.projects), ['p1'], 'les bibliothèques d’images de projet sont lues');
eq(figures.projects.p1[0].label, 'Canvas', 'les images d’un projet gardent leur libellé');
eq(backupFigureCount(figures), { common: 1, projectCount: 1, projectItems: 1, total: 2 },
  'l’aperçu compte les images trouvées (commune + projets)');
eq(figuresFromBackupState({}), { common: [], projects: {} }, 'un état sans images rend des listes vides');
eq(figuresFromBackupHtml('<html><body>pas une sauvegarde</body></html>', (s) => s), null,
  'un fichier étranger ne rend aucune bibliothèque');

/* La sauvegarde d'un ANCIEN dataset (sans les listes de publications — c'était
   le cas avant que ces listes n'entrent dans le fichier) rend quand même les
   bibliographies de projets : c'est là que sont les papiers perdus. */
const legacyState = {
  tests: [],
  projects: [{ id: 'p1', name: 'AMPs', scientist: 'Rossi M', bibliography: [{ id: 'old1', title: 'Lost paper' }] }]
};
const legacyHtml = '<script type="application/json" id="saved-data-blob">'
  + JSON.stringify({
    payload: LZString.compressToUTF16(JSON.stringify(legacyState)), isCompressed: true, title: 'Legacy'
  })
  + '</script>';
const legacy = papersFromBackupHtml(legacyHtml, (s) => LZString.decompressFromUTF16(s));
eq(legacy.publications, [], 'une sauvegarde ancienne n’a pas de liste de publications (listes vides)');
eq(backupPaperCount(legacy), { publications: 0, relevantPapers: 0, projectBib: 1, projects: 1 },
  'la bibliographie du projet reste récupérable depuis une sauvegarde ancienne');

/* ── 10. Câblage dans l'application (aucune régression silencieuse) ─────── */
const pdm = readFileSync('src/components/AppModules/projectDetailModule.jsx', 'utf8');
const pubsSrc = readFileSync('src/components/Publications.jsx', 'utf8');
const appSrc = readFileSync('src/App.jsx', 'utf8');
const selSrc = readFileSync('src/utils/loadSelection.js', 'utf8');
const driveSrc = readFileSync('src/utils/driveUpload.js', 'utf8');

/* Page de projet : « 📄 Import from a paper » */
ok(/REFERENCE_FILE_ACCEPT/.test(pdm) && /readReferenceDocument\(file\)/.test(pdm),
  'la page de projet lit un document déposé (.docx / RIS / BibTeX / texte)');
ok(/const parsed = parseReferences\(text, \{ split: src\.onePerLine \? 'line' : 'auto' \}\)/.test(pdm),
  'la page de projet analyse le texte avec le module de références');
ok(/bibliography: res\.list/.test(pdm),
  'les références cochées sont FUSIONNÉES dans la bibliographie du projet (rien n’est remplacé)');
ok(/Import references — \{project\.name\}/.test(pdm) && /\{renderBibImport\(\)\}/.test(pdm),
  'la fenêtre d’import est rendue par la page');
ok(/onClick=\{\(\) => \{ openBibImport\(\); \}\}/.test(pdm) && /📄 Import references from a paper/.test(pdm),
  'le bouton « 📄 Import references from a paper » ouvre la fenêtre');
ok(/entryKeys\(e\)\.some\(\(k\) => existing\.has\(k\)\)/.test(pdm),
  'l’aperçu signale les références déjà présentes dans le projet');

/* App.jsx : les papiers entrent dans la sauvegarde et sont relus en FUSION */
ok(/_publications: readPublications\(\)/.test(appSrc)
  && /_relevantPapers: loadRelevantPapers\(\)/.test(appSrc)
  && /_relevantSubjects: readRelevantSubjects\(\)/.test(appSrc)
  && /_excludedPubs: readExcludedPubs\(\)/.test(appSrc),
  'les sauvegardes HTML embarquent enfin les listes de papiers (elles n’existaient que dans le navigateur)');
ok(/applyPapersRecovery\(papersFromFile\)/.test(appSrc) && /papersFromFile/.test(appSrc),
  '« Load HTML » relit les papiers du fichier en fusion');
ok(!/writePublicationsList|writeRelevantPapersList|writeExcludedPubs/.test(appSrc),
  'App.jsx ne REMPLACE jamais une liste de papiers (aucun écrasement possible au chargement)');

/* Le panneau d’import partiel propose les papiers */
ok(/\['_publications'\]/.test(selSrc) && /\['_relevantPapers'\]/.test(selSrc)
  && /\['_relevantSubjects'\]/.test(selSrc),
  '« Load HTML » peut restaurer les seuls papiers (publications, Relevant papers, étiquettes)');

/* Publications : fenêtre de récupération + accès aux sauvegardes Drive */
ok(/export const applyPapersRecovery/.test(pubsSrc) && /export const readPublications/.test(pubsSrc),
  'Publications expose la récupération de papiers au reste de l’application');
ok(/papersFromBackupHtml\(text, \(s\) => LZString\.decompressFromUTF16\(s\)\)/.test(pubsSrc)
  && /applyPapersRecovery\(recovState\.papers, \{ \.\.\.recovState\.parts, excluded: false \}\)/.test(pubsSrc),
  'la fenêtre « Recover papers » relit une sauvegarde et applique la fusion');
ok(/♻️ Recover papers/.test(pubsSrc) && /List this dataset’s Drive backups/.test(pubsSrc),
  'le bouton « ♻️ Recover papers » et la liste des sauvegardes Drive sont présents');
ok(/mergeProjectBibliographies\(loadProjects\(\), src\.projects\)/.test(pubsSrc),
  'les bibliographies de projets sont fusionnées, jamais remplacées');
ok(/export const listDatasetBackups/.test(driveSrc) && /export const downloadDriveFileText/.test(driveSrc),
  'les sauvegardes Drive du dataset courant peuvent être listées et relues');

/* ── 11. Bout en bout : une référence importée devient une citation du projet,
   avec TOUS ses auteurs et les membres du laboratoire reconnus et stylés ─── */
const fmt = buildPubFormat('apa');           // « apa » cite aussi le DOI
fmt.scientistStyles = { 'Marco Rossi': 'bold' };
const imported = projectBibEntry(risEntries[0], { scientist: 'Rossi M' }, 'bib_e2e');
const citation = pubCitationHtml(pubCitationData(imported, []), fmt, ['Marco Rossi']);
ok(citation.includes('Voltage-dependent gating of a membrane channel'),
  'le titre importé apparaît dans la bibliographie du projet');
ok(citation.includes('Bianchi A') && citation.includes('Smith JA'),
  'TOUS les auteurs sont cités (co-auteurs du laboratoire et auteurs extérieurs)');
ok(citation.includes('<b>Rossi M</b>'),
  'le membre du laboratoire est reconnu dans la liste importée et reçoit son style');
ok(citation.includes('10.1016/j.jmb.2021.166789'), 'le DOI importé est cité');
ok(citation.includes('Journal of Molecular Biology'), 'le journal importé est cité');

/* ── 12. « et al. » est un MARQUEUR D'AUTEURS, jamais un titre ───────────────
   Style « Nom, Initiales » (Paperpile / EndNote) : la liste d'auteurs se
   termine par « et al. » et le titre commence juste après. Ce marqueur se
   retrouvait à la tête du reste du texte : la référence importée s'appelait
   « , et al » — ou « , et al. (2018) » — et son VRAI titre tombait dans le
   champ journal. Ce que l'utilisateur constate : « dans certaines le titre
   était “et al.” ». */
const etAl1 = parseReferences(
  'Rossi, M., Bianchi, A., et al. Characterization of a potyvirus infecting pepper. J Virol. 2018;12(3):345-356.',
  { split: 'line', keepAll: true }
)[0];
eq(etAl1.title, 'Characterization of a potyvirus infecting pepper', 'le titre suit le marqueur « et al. »');
eq(etAl1.authors, 'Rossi M, Bianchi A, et al.', '« et al. » reste dans la liste des auteurs (marqueur conservé)');
eq(etAl1.journal.replace(/\.$/, ''), 'J Virol', 'le journal ne contient plus l’année (ni la date)');
eq(etAl1.volume, '12', 'volume');
eq(etAl1.pages, '345-356', 'pages');
eq(etAl1.year, '2018', 'année');

const etAl2 = parseReferences(
  'Rossi, M., Bianchi, A., Costa, L., et al. (2018). Characterization of a potyvirus infecting pepper. Journal of Virology, 12(3), 345-356.',
  { split: 'line', keepAll: true }
)[0];
eq(etAl2.title, 'Characterization of a potyvirus infecting pepper', 'année entre parenthèses APRÈS « et al. » : elle ne devient pas le titre');
eq(etAl2.authors, 'Rossi M, Bianchi A, Costa L, et al.', 'tous les auteurs gardent le marqueur');
eq(etAl2.journal, 'Journal of Virology', 'le journal perd sa virgule finale');
eq(etAl2.volume, '12', 'volume (style « Journal, 12(3), 345-356 »)');
eq(etAl2.pages, '345-356', 'pages');

const etAl3 = parseReferences(
  'Esposito, S., et al. Cucumber mosaic virus in tomato fields. J Gen Virol (2021) 102:45-52.',
  { split: 'line', keepAll: true }
)[0];
eq(etAl3.title, 'Cucumber mosaic virus in tomato fields', 'un seul auteur + « et al. » : le titre reste le titre');
eq(etAl3.authors, 'Esposito S, et al.', 'auteurs + marqueur');
eq(etAl3.journal, 'J Gen Virol', 'journal');
eq(etAl3.year, '2021', 'année entre parenthèses dans le journal');

/* Style « Nom Initiales » (sans virgule) : le marqueur est normalisé. */
const etAl4 = parseReferences(
  'Bianchi A, Rossi M, et al. A new approach to virus purification. Virology (2020) 540:12-20.',
  { split: 'line', keepAll: true }
)[0];
eq(etAl4.title, 'A new approach to virus purification', 'style « Nom Initiales » : le titre est reconnu');
eq(etAl4.authors, 'Bianchi A, Rossi M, et al.', '…et le marqueur reste dans les auteurs');
eq(etAl4.pages, '12-20', 'pages');

/* Un titre réduit à un marqueur (ou sans une seule lettre) est repéré. */
ok(isMarkerTitle(', et al'), 'un titre réduit à « et al. » est un marqueur');
ok(isMarkerTitle('(2018)'), '…une année seule aussi');
ok(!isMarkerTitle('Characterization of a potyvirus'), 'un vrai titre n’est pas un marqueur');

/* Deux autres sorties réelles qui abîmaient le titre :
   — bibliographie « virgules » de Word / EndNote (aucune phrase ne se termine) ;
   — un DOI resté devant le titre (export Paperpile). */
const endNote = parseReferences(
  'Rossi, M., Bianchi, A., et al., 2019, Characterization of a potyvirus, Journal of Virology, 12, 345-356.',
  { split: 'line', keepAll: true }
)[0];
eq(endNote.title, 'Characterization of a potyvirus', 'style EndNote « Nom, Initiales, Année, Titre, Journal… » : le titre est isolé');
eq(endNote.journal, 'Journal of Virology', '…le journal aussi');
eq(endNote.volume, '12', '…le volume');
eq(endNote.pages, '345-356', '…et les pages');
eq(endNote.authors, 'Rossi M, Bianchi A, et al.', '…sans perdre le marqueur « et al. »');

const doiFirst = parseReferences(
  'Rossi, M., Bianchi, A., et al. doi:10.1016/j.virol.2019.01.001 Characterization of a potyvirus. J Virol 12:345-356.',
  { split: 'line', keepAll: true }
)[0];
eq(doiFirst.title, 'Characterization of a potyvirus', 'un DOI resté devant le titre n’entre pas dans le titre');
eq(doiFirst.doi, '10.1016/j.virol.2019.01.001', '…il est bien enregistré comme DOI');

/* Et le marqueur ne perturbe pas la citation du projet : les auteurs listés
   restent les vrais auteurs, « et al. » marque seulement la troncature. */
const etAlBib = projectBibEntry(etAl1, { scientist: 'Rossi M' }, 'bib_etal');
eq(etAlBib.title, 'Characterization of a potyvirus infecting pepper', 'l’entrée de bibliographie porte le bon titre');
eq(matchCoauthors(etAlBib.authors, ['Anna Bianchi'], 'Marco Rossi'), ['Anna Bianchi'],
  'les co-auteurs sont reconnus malgré le marqueur « et al. »');

/* ── 13. LES FORMES DE BIBLIOGRAPHIE QUI DONNAIENT UN TITRE FAUX ─────────────
   Quatre écritures réelles mettaient autre chose que le titre dans le champ
   titre (le plus visible des défauts restants de l'import) :
     • revue EN PREMIER (PubMed / Vancouver) : « J Virol. 2018;12:345-356.
       Rossi M, et al. Titre. » → le titre était « Rossi M, et al » ;
     • titre entre guillemets : le point est AVANT le guillemet fermant, donc
       l'entrée ENTIÈRE devenait le titre ;
     • auteur COLLECTIF (« EPPO. Aphid transmission… ») → le titre était « EPPO » ;
     • queue « APA » avec pp. : « Journal of Virology, 2018, 12(3), pp. 345-356 »
       → la revue avalait l'année, le volume et les pages. */
const pubmedFirst = parseReferences(
  'J Virol. 2018;12:345-356. Rossi M, et al. Characterization of a potyvirus.',
  { split: 'line', keepAll: true }
)[0];
eq(pubmedFirst.title, 'Characterization of a potyvirus', 'revue en tête (PubMed) : le titre est reconnu');
eq(pubmedFirst.authors, 'Rossi M, et al.', '…et les auteurs aussi');
eq(pubmedFirst.journal.replace(/\.$/, ''), 'J Virol', '…la revue garde son nom (sans l’année)');
eq([pubmedFirst.volume, pubmedFirst.pages], ['12', '345-356'], '…avec volume et pages');
eq(rotateJournalFirst('Rossi M. Titre. J Virol 2018;12:345-356.'),
  'Rossi M. Titre. J Virol 2018;12:345-356.',
  'une référence DÉJÀ dans le bon ordre n’est pas touchée');

const quotedTitle = parseReferences(
  'Rossi M, Bianchi A. "Characterization of a potyvirus." J Virol 2018;12:345-356.',
  { split: 'line', keepAll: true }
)[0];
eq(quotedTitle.title, 'Characterization of a potyvirus', 'un titre entre guillemets est reconnu (entier, sans guillemets)');
eq(quotedTitle.authors, 'Rossi M, Bianchi A', '…et la revue, le volume et les pages restent à leur place');
eq([quotedTitle.journal, quotedTitle.volume, quotedTitle.pages], ['J Virol', '12', '345-356'], '…journal / volume / pages');

const groupAuthor = parseReferences(
  'EPPO. Aphid transmission of potyviruses. EPPO Bulletin 2018; 12: 345-356.',
  { split: 'line', keepAll: true }
)[0];
eq(groupAuthor.title, 'Aphid transmission of potyviruses', 'un auteur collectif (« EPPO. ») n’est pas le titre');
eq(groupAuthor.authors, 'EPPO', '…il est enregistré comme auteur');
eq(groupAuthor.journal, 'EPPO Bulletin', '…et la revue est lue sans l’année');

const apaTail = parseReferences(
  'Rossi M, Bianchi A. Characterization of a potyvirus. Journal of Virology, 2018, 12(3), pp. 345-356.',
  { split: 'line', keepAll: true }
)[0];
eq(apaTail.journal, 'Journal of Virology', 'queue « APA » : la revue est la revue (ni année ni pages)');
eq([apaTail.volume, apaTail.pages], ['12', '345-356'], '…et « pp. » n’entre pas dans les pages');

const pubmedDate = parseReferences(
  'Rossi M, Bianchi A. Characterization of a potyvirus. J Virol. 2018 Dec 1;12(3):345-56. Epub 2018 Nov 3.',
  { split: 'line', keepAll: true }
)[0];
eq(pubmedDate.journal, 'J Virol', 'la date complète (« 2018 Dec 1; ») et « Epub … » sortent du journal');
eq([pubmedDate.volume, pubmedDate.pages], ['12', '345-56'], '…volume et pages restent justes');

const thesis = parseReferences(
  'Rossi M. Characterization of a potyvirus. PhD thesis, University of Naples, 2018.',
  { split: 'line', keepAll: true }
)[0];
eq(thesis.journal, 'PhD thesis, University of Naples', '« PhD » n’est pas amputé par le préfixe de pages');
eq(thesis.volume, '', '…et l’année n’est pas prise pour un volume');

/* ── 14. LE NOM D'UN AUTEUR N'EST JAMAIS UN TITRE ───────────────────────────
   Signalé par l'utilisateur : « parfois je trouve un nom d'auteur importé
   comme titre ». Quatre écritures réelles le provoquaient — la liste d'auteurs
   était coupée en deux et le morceau restant (un nom) devenait le TITRE :
     • « Rossi M., Bianchi A., Costa L. Titre… »  (initiales pointées) ;
     • « Rossi M. Bianchi A. Titre… »             (auteurs séparés par un POINT) ;
     • « M. Rossi, A. Bianchi, L. Costa. Titre… » (prénoms en tête, Elsevier) ;
     • « Rossi M, Bianchi, A. Costa L. Titre… »   (écritures mélangées).
   Les quatre donnent maintenant les AUTEURS et le vrai titre. */
const dottedInitials = parseReferences(
  'Rossi M., Bianchi A., Costa L. Characterization of a potyvirus infecting pepper. J Virol. 2018;12:345-356.',
  { split: 'line', keepAll: true }
)[0];
eq(dottedInitials.title, 'Characterization of a potyvirus infecting pepper', 'initiales pointées : le titre reste le titre');
eq(dottedInitials.authors, 'Rossi M, Bianchi A, Costa L', '…et l’auteur pointé n’en sort pas');

const dotSeparated = parseReferences(
  'Rossi M. Bianchi A. Costa L. Characterization of a potyvirus. J Virol 2018;12:345-356.',
  { split: 'line', keepAll: true }
)[0];
eq(dotSeparated.title, 'Characterization of a potyvirus', 'auteurs séparés par des points : le titre est reconnu');
eq(dotSeparated.authors, 'Rossi M, Bianchi A, Costa L', '…les trois auteurs sont réunis (et non « Rossi M » + un titre « Bianchi A »)');

const givenNameFirst = parseReferences(
  'M. Rossi, A. Bianchi, L. Costa. Characterization of a potyvirus. J Virol 2018;12:345-356.',
  { split: 'line', keepAll: true }
)[0];
eq(givenNameFirst.title, 'Characterization of a potyvirus', 'prénoms en tête (Elsevier) : le titre est reconnu');
eq(givenNameFirst.authors, 'Rossi M, Bianchi A, Costa L', '…et les initiales passent APRÈS le nom (convention du labo)');

const mixedList = parseReferences(
  'Rossi M, Bianchi, A. Costa L. Characterization of a potyvirus. J Virol 2018;12:345-356.',
  { split: 'line', keepAll: true }
)[0];
eq([mixedList.title, mixedList.authors], ['Characterization of a potyvirus', 'Rossi M, Bianchi A, Costa L'],
  'écritures mélangées dans une même liste : titre et auteurs restent justes');

/* Même quand la liste d'auteurs n'est pas reconnue d'un bloc (« van der Berg »,
   un nom composé), le morceau tombé dans le titre lui est rendu. */
const particleName = parseReferences(
  'van der Berg J. Costa L. Characterization of a potyvirus. J Virol 2018;12:345-356.',
  { split: 'line', keepAll: true }
)[0];
eq(particleName.title, 'Characterization of a potyvirus', 'nom composé + liste coupée : le vrai titre est retrouvé');
eq(particleName.authors, 'van der Berg J, Costa L', '…et les deux auteurs sont réunis');

ok(isAuthorListTitle('Costa L'), 'une liste d’auteurs seule est reconnue comme telle (jamais un titre)');
ok(isAuthorListTitle('Rossi, M., Bianchi, A.'), '…quelle que soit l’écriture');
ok(!isAuthorListTitle('Note on CMV'), 'un vrai titre court n’est pas pris pour une liste d’auteurs');
ok(!isAuthorListTitle('Aphid transmission of potyviruses'), 'un titre sans nom d’auteur non plus');
eq(normalizeAuthorList('M. Rossi, A. Bianchi'), 'Rossi M, Bianchi A', 'liste « Initiales Nom » → convention du labo');
eq(normalizeAuthorList('Rossi M. Bianchi A.'), 'Rossi M, Bianchi A', 'liste séparée par des points → convention du labo');


console.log(`✅ ${passed} tests passés (import de références)`);
/* ── 15. LE TITRE NE DOIT PAS AVALER LA REVUE ───────────────────────────────
   Un titre qui finit par « ? » n'a pas de point : la phrase ne se coupait
   jamais et la REVUE entrait dans le titre (le papier perdait sa revue). */
const questionTitle = parseReferences(
  'Rossi M. Does virus X infect pepper? J Virol 2018;12:345-356.',
  { split: 'line', keepAll: true }
)[0];
eq(questionTitle.title, 'Does virus X infect pepper', 'un titre en « ? » est reconnu tel quel');
eq(questionTitle.journal, 'J Virol', '…et la revue sort du titre');
eq([questionTitle.volume, questionTitle.pages], ['12', '345-356'], '…volume et pages aussi');

const questionTitle2 = parseReferences(
  'Rossi M, Bianchi A. Is CMV a model for virus evolution? J Virol 2018;12:345-356.',
  { split: 'line', keepAll: true }
)[0];
eq([questionTitle2.title, questionTitle2.journal], ['Is CMV a model for virus evolution', 'J Virol'],
  'lettre « Is » : ce n’est pas un auteur (l’ancien lecteur lisait « auteur Is + initiales CMV »)');

const preprint = parseReferences(
  'Rossi M, Bianchi A. Characterization of a potyvirus infecting pepper. bioRxiv 2018:345-356.',
  { split: 'line', keepAll: true }
)[0];
eq([preprint.title, preprint.journal], ['Characterization of a potyvirus infecting pepper', 'bioRxiv'],
  'préprint (« bioRxiv 2018:345-356 ») : la revue au nom en minuscules sort du titre');

/* ── 16. REVUE / VOLUME / PAGES DES FORMES MODERNES ─────────────────────────
   Numéro d'article et date complète : la revue avalait la date et le volume
   devenait « 0123 » (les pages doivent accepter une lettre : « e01234-18 »). */
const vancouverFull = parseReferences(
  '12. Rossi M, Bianchi A, Costa L. Characterization of a potyvirus infecting pepper. J Virol. 2018 Dec 1;92(23):e01234-18. doi:10.1128/JVI.01234-18. Epub 2018 Sep 12.',
  { split: 'line', keepAll: true }
)[0];
eq(vancouverFull.journal, 'J Virol', 'date complète (« 2018 Dec 1; ») : elle sort du nom de la revue');
eq(vancouverFull.volume, '92', '…le volume est le volume');
eq(vancouverFull.pages, 'e01234-18', '…et le numéro d’article est gardé entier');
eq(vancouverFull.number, 12, 'le numéro de la bibliographie est conservé (lien avec les « [12] » du texte)');
eq(vancouverFull.doi, '10.1128/JVI.01234-18', '…le DOI aussi');

const apaNumber = parseReferences(
  'Rossi, M., & Bianchi, A. (2018). Characterization of a potyvirus infecting pepper. Journal of Virology, 92(23), e01234. https://doi.org/10.1128/JVI.01234-18',
  { split: 'line', keepAll: true }
)[0];
eq(apaNumber.journal, 'Journal of Virology', 'APA avec numéro d’article : la revue est la revue');
eq(apaNumber.volume, '92', '…le volume est 92 (et non « e01234 »)');
eq(apaNumber.pages, 'e01234', '…et le numéro d’article va dans les pages');

/* Une entrée NUMÉROTÉE ne doit jamais être jetée par le score : c'est ainsi
   qu'un article court et sans année « n'était pas reconnu » à l'import. */
const shortNumbered = parseReferences('12. EPPO. Aphid transmission of potyviruses. EPPO Bulletin.',
  { split: 'line' });
eq(shortNumbered.length, 1, 'une référence numérotée est gardée même si son score est faible');
eq(shortNumbered[0].number, 12, '…avec son numéro (utile pour les citations du texte)');
eq(shortNumbered[0].journal, 'EPPO Bulletin', '…et sa revue, même sans année ni volume');



/* ── 17. LES INITIALES COMPOSÉES (« W.-J. ») : TITRE ET AUTEURS ──────────────
   La référence signalée — « Lu, W.-J. et al. Mortalin-p53 interaction in cancer
   cells… Cell Death Differ 18, 1046-1056 (2011). » — arrivait SANS TITRE (le
   « -J. » resté en tête était pris pour lui) et avec des auteurs tronqués
   (« Lu W »). Le trait d'union d'« W.-J. » relie deux initiales du MÊME auteur :
   la liste d'auteurs ne doit donc jamais s'arrêter avant lui. */
const luStyle = parseReferences(
  '\tLu, W.-J. et al. Mortalin-p53 interaction in cancer cells is stress '
  + 'dependent and constitutes a selective target for cancer therapy. '
  + 'Cell Death Differ 18, 1046\u20131056 (2011).',
  { split: 'line', keepAll: true }
)[0];
eq(luStyle.title,
  'Mortalin-p53 interaction in cancer cells is stress dependent and constitutes a selective target for cancer therapy',
  'style Nature / Cell : le TITRE de « Lu, W.-J. et al. … » est trouvé');
eq(luStyle.authors, 'Lu W-J, et al.', '…et ses AUTEURS sont là (« W.-J. » entier, marqueur « et al. » gardé)');
eq([luStyle.journal, luStyle.volume, luStyle.pages, luStyle.year],
  ['Cell Death Differ', '18', '1046-1056', '2011'],
  '…avec la revue, le volume, les pages et l’année');

const luApa = parseReferences(
  'Lu, W.-J., Lee, N.-P., & Kaul, S. C. (2011). Mortalin-p53 interaction in cancer cells. Cell Death Differ, 18(6), 1046-1056.',
  { split: 'line', keepAll: true }
)[0];
eq(luApa.title, 'Mortalin-p53 interaction in cancer cells', 'style APA : le titre est trouvé, lui aussi');
ok(luApa.authors.startsWith('Lu W-J'), '…et la liste d’auteurs commence par « Lu W-J »');

/* La convention du labo conserve le trait d'union, et ne réunit JAMAIS deux
   auteurs : c'est la ligne de crête de ce correctif. */
eq(normalizeAuthorList('Lu, W.-J.'), 'Lu W-J', '« Lu, W.-J. » → « Lu W-J »');
eq(formatAuthor('Lu, W.-J.'), 'Lu W-J', 'formatAuthor garde le trait d’union');
eq(formatAuthor('Rossi, J.-P.'), 'Rossi J-P', 'initiales en tête : « Rossi, J.-P. » → « Rossi J-P »');
eq(normalizeAuthorList('Rossi M, Bianchi A'), 'Rossi M, Bianchi A', 'deux auteurs restent deux auteurs');
eq(normalizeAuthorList('Lu WJ, Lee NP, Kaul SC, et al.'), 'Lu WJ, Lee NP, Kaul SC, et al.',
  'style Vancouver (initiales sans points) : la liste complète est gardée');


/* ── 18. LES RÉFÉRENCES ÉCRITES PARTIELLEMENT ───────────────────────────────
   Une bibliographie réelle est rarement complète : il manque un titre, un ou
   plusieurs auteurs, la revue… Tout ce qui est ÉCRIT est lu — rien n'est
   inventé — et une entrée SANS TITRE n'est plus jetée quand elle porte un
   NUMÉRO : c'est le « [12] » du texte qui doit pouvoir être lié (sinon le
   bouton « 🔗 Link citations » répond « Nothing to link »). */
const noTitle = parseReferences(
  '12. Smith J, Rossi M. 2019. J Virol 92, 345-356. doi:10.1128/JVI.01234-18',
  { split: 'line' }
)[0];
eq([noTitle.number, noTitle.title, noTitle.journal, noTitle.volume, noTitle.pages, noTitle.year],
  [12, '', 'J Virol', '92', '345-356', '2019'],
  'sans titre : la revue, le volume, les pages et l’année écrits sont reconstruits — le titre, lui, n’est pas inventé');
eq(noTitle.doi, '10.1128/JVI.01234-18', '…et le DOI est gardé');

const titleOnly = parseReferences('Membrane dynamics of antimicrobial peptides (2019).', { split: 'line' })[0];
eq([titleOnly.title, titleOnly.authors, titleOnly.year],
  ['Membrane dynamics of antimicrobial peptides', '', '2019'],
  'sans auteurs : le titre reste le TITRE (il partait dans les auteurs, et l’entrée entière était jetée)');

const etAlOnly = parseReferences('5. Lu W-J, et al. (2011).', { split: 'line' });
eq([etAlOnly.length, etAlOnly[0].number, etAlOnly[0].title, etAlOnly[0].year], [1, 5, '', '2011'],
  'une entrée numérotée SANS TITRE est importée : le « [5] » du texte pourra être lié');
ok(/^Lu W-J/.test(etAlOnly[0].authors) && /et\s*al/i.test(etAlOnly[0].authors),
  '…avec les auteurs écrits (marqueur « et al. » compris)');

const authorsOnly = parseReferences('Rossi M, Bianchi A. (2019).', { split: 'line' });
eq([authorsOnly.length, authorsOnly[0].title, authorsOnly[0].authors], [1, '', 'Rossi M, Bianchi A'],
  'auteurs + année seuls : l’entrée est gardée, son titre (absent de la source) reste vide et se complète à la main');

/* Ce qui n'est PAS une référence ne le devient pas : sans titre, la note exigée
   est plus haute — une phrase du corps du texte reste ignorée. */
eq(parseReferences('Aphid transmission of a potyvirus in pepper crops.', { split: 'line' }).length, 0,
  'une phrase du texte (ni titre reconnu, ni numéro) n’est pas importée');

const partialJournal = parseReferences(
  '3. Bianchi A, et al. Characterization of a new potyvirus. J Gen Virol 102(4), 001234. 2021.',
  { split: 'line' }
)[0];
eq([partialJournal.journal, partialJournal.volume, partialJournal.pages, partialJournal.year],
  ['J Gen Virol', '102', '001234', '2021'],
  'revue + volume(issue) + numéro d’article : l’année en fin de queue ne les avale plus');


/* ── 19. « Kussie, P. H. et al. … » : DES INITIALES SÉPARÉES PAR UNE ESPACE ─
   La SECONDE référence signalée : « P. H. » = initiale, POINT, espace, initiale.
   La liste d'auteurs s'arrêtait après « P. » — « H. et al » devenait le TITRE du
   papier et la phrase du vrai titre partait dans la REVUE (« Structure of the
   MDM2 oncoprotein… Science »). La même phrase s'écrit partout dans une
   bibliographie : dès que « et al. » suit les auteurs, le titre suit. */
const kussie = parseReferences(
  'Kussie, P. H. et al. Structure of the MDM2 oncoprotein bound to the p53 tumor '
  + 'suppressor transactivation domain. Science 274, 948\u2013953 (1996).',
  { split: 'line', keepAll: true }
)[0];
eq(kussie.title, 'Structure of the MDM2 oncoprotein bound to the p53 tumor suppressor transactivation domain',
  'les initiales espacées (« P. H. ») n’arrêtent plus la liste : le TITRE suit « et al. »');
eq(kussie.authors, 'Kussie PH, et al.', '…et les auteurs sont complets (« Kussie PH »)');
eq([kussie.journal, kussie.volume, kussie.pages, kussie.year], ['Science', '274', '948-953', '1996'],
  '…avec la revue, le volume, les pages et l’année');
ok(!/Kussie|Structure/.test(kussie.journal), 'le titre ne part plus dans la REVUE');


/* ── 20. UNE AFFILIATION NUMÉROTÉE N'EST JAMAIS UNE RÉFÉRENCE ───────────────
   « S'il y a un numéro dans les affiliations, ce n'est JAMAIS une référence ».
   Importer les références d'un document qui contient aussi son en-tête (une page
   copiée d'un PDF, un manuscrit entier) faisait entrer « 1 Dipartimento di
   Agraria, Università di Napoli, Portici, Italy » dans la bibliographie : le
   numéro du laboratoire devenait celui d'un papier, et le « [1] » du texte
   pointait vers une adresse. */
const affilBlock = [
  '1 Dipartimento di Agraria, Universita di Napoli Federico II, Portici, Italy',
  '2 INRAE, UMR Biologie du Fruit, Villenave d Ornon, France',
  '3 Department of Plant Pathology, 2015 Upper Street, Raleigh, NC 27695, USA',
  '* Corresponding author: mario.rossi@unina.it'
].join('\n');
eq(parseReferences(affilBlock, { split: 'line', keepAll: true }).length, 0,
  'aucune adresse d’affiliation n’est importée comme référence, même NUMÉROTÉE');
ok(affilBlock.split('\n').every((l) => looksLikeAffiliationEntry(l)),
  '…la lecture le dit ligne par ligne (adresse, code postal, e-mail)');
eq(bibliographyBlockToEntry('1 Dipartimento di Agraria, Universita di Napoli, Portici, Italy'), null,
  'une adresse numérotée ne produit AUCUNE entrée');
/* Ce qui reste une référence : les mêmes mots AVEC une année, des pages, un DOI. */
const numberedRef = parseReferences('1. Rossi M, Bianchi A. A new potyvirus. J Virol 92, 345-356 (2018).',
  { split: 'line' })[0];
eq([numberedRef.number, numberedRef.year, numberedRef.pages], [1, '2018', '345-356'],
  'une référence numérotée à côté d’une adresse reste une référence');
ok(!looksLikeAffiliationEntry('12. Smith J, Rossi M. 2019. J Virol 92, 345-356. doi:10.1128/JVI.01234-18'),
  '…et une entrée sans titre (année + pages + DOI) n’est pas prise pour une adresse');

console.log(`✅ ${passed} tests passés (import de références)`);


