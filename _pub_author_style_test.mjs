/* =========================================================================
   _pub_author_style_test.mjs — format de citation des publications.

   Le module RÉEL est importé (src/components/pubCitation.js, sans React) :
   toutes les règles qui comptent pour le laboratoire sont vérifiées ici.

   Règle annoncée : TOUS les auteurs d'un article restent cités — la seule règle
   qui raccourcit la liste est le « et al. » après N auteurs — et le format
   choisit seulement le STYLE des membres du laboratoire : chacun peut être
   souligné (U), en gras (B) ou laissé normal (Aa), partout où son nom apparaît
   dans la liste des auteurs.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

/* Les sources de src/ s'importent sans extension (résolues par Vite) : le
   crochet rend le module RÉEL importable par node (voir _esm_test_hook.mjs). */
register('./_esm_test_hook.mjs', import.meta.url);
const {
  AUTHOR_STYLES, AUTHOR_STYLE_IDS, IN_TEXT_STYLES, IN_TEXT_STYLE_IDS, PUB_FORMAT_KEY, PUB_FORMAT_PRESETS,
  PUB_FONTS, PUB_LAYOUT_PARTS, PUB_LAYOUT_PART_IDS, PUB_TEXT_ALIGNMENTS,
  authorMatchesCandidate, authorStyleOf, buildPubFormat, buildPubLayout, labMemberOf,
  loadPubFormat, matchCoauthors, normalizeInTextStyle, normalizePubFormat, normalizePubLayout,
  pubCitationData, pubCitationHtml, pubCitationText, pubDoiKey, pubDoiUrl, pubFieldValue,
  pubLayoutCss, pubOriginOf, pubPmidKey, pubTextStyleIsSet, renderAuthorNames,
  sanitizeScientistStyles, scientistStyleOf
} = await import('./src/components/pubCitation.js');

/* LE MOTEUR DE COMPLÉTION DES RÉFÉRENCES (src/utils/referenceEnrich.js) : c'est
   lui qui sait qu'une liste d'auteurs VIDE ou coupée par un « et al. » n'est
   pas une liste remplie, et qui va la chercher — pot commun du laboratoire puis
   Crossref. Les trois listes de papiers s'en servent (voir section 15). */
const { authorsIncomplete } = await import('./src/utils/referenceEnrich.js');

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};

/* ── 1. Jeu de données : trois membres du laboratoire parmi sept auteurs ─── */
/* « Rossi M », « Bianchi A » et « Ramos MJ » ont un compte (liste des
   scientifiques) ; Smith, Verdi, Müller et Costa ne sont PAS du laboratoire. */
const scientists = ['Rossi M', 'Bianchi A', 'Ramos MJ'];
const pub = {
  authors: 'Rossi M, Smith J, Bianchi A, Verdi G, Müller K, Ramos MJ, Costa L',
  year: '2024', title: 'Antimicrobial peptides in lipid bilayers',
  journal: 'J. Biol. Chem.', volume: '300', pages: '105678', doi: '10.1016/j.jbc.2024.105678'
};
const ALL = 'Rossi M, Smith J, Bianchi A, Verdi G, Müller K, Ramos MJ, Costa L';
const fmt = (patch = {}) => ({ ...buildPubFormat('nature'), ...patch });

eq(labMemberOf('Rossi M', scientists), 'Rossi M', 'auteur reconnu comme membre du laboratoire');
eq(labMemberOf('Smith J', scientists), '', 'auteur extérieur : aucun membre reconnu');
eq(authorMatchesCandidate('Bianchi A', 'Bianchi A'), true, 'comparaison nom ↔ compte utilisateur');
eq(matchCoauthors(pub.authors, scientists, 'Rossi M'), ['Bianchi A', 'Ramos MJ'],
  'les co-auteurs du laboratoire sont retrouvés (hors titulaire)');

/* ── 2. Tous les auteurs sont cités : rien n'est jamais retiré ──────────── */
eq(renderAuthorNames(pub, fmt(), scientists).text, ALL,
  'sans « et al. » : les 7 auteurs, dont 4 extérieurs, restent tous cités');
eq(renderAuthorNames(pub, fmt({ etAlLimit: 3 }), scientists).text, 'Rossi M, Smith J, Bianchi A, et al.',
  '« et al. » après 3 auteurs : règle inchangée');
eq(renderAuthorNames(pub, fmt({ etAlLimit: 3, alwaysShowScientists: true }), scientists).text,
  'Rossi M, Smith J, Bianchi A, Ramos MJ, et al.',
  '« toujours afficher les membres » : Ramos MJ (6e auteur) est conservé');
eq(renderAuthorNames(pub, fmt({ etAlLimit: 3, scientistStyles: { 'Ramos MJ': 'bold' } }), scientists).text,
  'Rossi M, Smith J, Bianchi A, et al.',
  'un membre stylé mais coupé par le « et al. » n’apparaît pas pour autant');
eq(renderAuthorNames(pub, fmt(), []).text, ALL, 'aucun membre connu ⇒ liste complète inchangée');
ok(pubCitationText(pub, fmt(), scientists).startsWith(`${ALL} `),
  'la citation complète commence par la liste intégrale des auteurs');

/* ── 3. Le membre du laboratoire est souligné ou en gras, seul ──────────── */
const html = (patch) => renderAuthorNames(pub, fmt(patch), scientists).html;
ok(html({ scientistStyles: { 'Rossi M': 'underline' } }).includes('<u>Rossi M</u>'),
  'U sur Rossi M : son nom est souligné');
ok(!html({ scientistStyles: { 'Rossi M': 'underline' } }).includes('<u>Bianchi A</u>'),
  'U sur Rossi M : les autres membres ne sont pas soulignés');
ok(html({ scientistStyles: { 'Bianchi A': 'bold' } }).includes('<b>Bianchi A</b>'),
  'B sur Bianchi A : son nom est en gras');
ok(!html({ scientistStyles: { 'Bianchi A': 'bold' } }).includes('<b>Rossi M</b>'),
  'B sur Bianchi A : les autres membres ne sont pas en gras');
const three = html({ scientistStyles: { 'Rossi M': 'bold', 'Bianchi A': 'underline', 'Ramos MJ': 'bold' } });
ok(three.includes('<b>Rossi M</b>') && three.includes('<u>Bianchi A</u>') && three.includes('<b>Ramos MJ</b>'),
  'trois membres, styles indépendants : gras / souligné / gras');
eq((html({ scientistStyles: { 'Rossi M': 'bold', 'Bianchi A': 'underline', 'Ramos MJ': 'none' } })
  .match(/<(u|b)>/g) || []).length, 2,
  'deux balises de style seulement : « none » n’ajoute rien');
ok(html({ scientistStyles: { 'Rossi M': 'bold' } }).includes('Smith J') &&
   !/<\/?[ub]>[^<]*Smith[^<]*<\/(u|b)>/.test(html({ scientistStyles: { 'Rossi M': 'bold' } })),
  'un auteur extérieur au laboratoire n’est jamais stylé');
ok(pubCitationHtml(pub, fmt({ scientistStyles: { 'Rossi M': 'bold' } }), scientists).includes('<b>Rossi M</b>'),
  'la citation HTML complète applique le style du membre');
ok(pubCitationText(pub, fmt({ scientistStyles: { 'Rossi M': 'bold' } }), scientists).includes('<') === false,
  'la citation texte reste sans balise (style HTML uniquement)');

/* ── 4. Ancien réglage « souligner leurs noms » conservé, mais surchargé ── */
ok(html({ underlineScientists: true }).includes('<u>Rossi M</u>') &&
   html({ underlineScientists: true }).includes('<u>Bianchi A</u>') &&
   html({ underlineScientists: true }).includes('<u>Ramos MJ</u>'),
  'format existant « souligner tout le laboratoire » : rendu identique à avant');
eq(scientistStyleOf('Rossi M', fmt({ underlineScientists: true })), 'underline',
  'sans choix explicite, l’ancien réglage sert de défaut');
eq(scientistStyleOf('Rossi M', fmt({ underlineScientists: true, scientistStyles: { 'Rossi M': 'bold' } })), 'bold',
  'un choix explicite remplace l’ancien réglage');
eq(scientistStyleOf('Rossi M', fmt({ underlineScientists: true, scientistStyles: { 'Rossi M': 'none' } })), 'none',
  '« normal » explicite neutralise l’ancien réglage (cas du bouton Aa)');
eq(authorStyleOf('Smith J', fmt({ underlineScientists: true }), scientists), 'none',
  'un auteur hors du laboratoire n’est jamais stylé, même avec l’ancien réglage');
eq(authorStyleOf('Rossi M', fmt({ underlineScientists: true }), scientists), 'underline',
  'un membre du laboratoire, lui, suit l’ancien réglage');
ok(!html({ underlineScientists: true, scientistStyles: { 'Rossi M': 'bold', 'Bianchi A': 'none' } }).includes('<u>Rossi M</u>'),
  'mélange : le style explicite gagne pour Rossi M');
ok(html({ underlineScientists: true, scientistStyles: { 'Rossi M': 'bold', 'Bianchi A': 'none' } }).includes('<u>Ramos MJ</u>'),
  'mélange : Ramos MJ (aucun choix) reste souligné par l’ancien réglage');

/* ── 5. Formats déjà enregistrés / de projet : lecture tolérante ────────── */
eq(sanitizeScientistStyles({ 'Rossi M': 'bold', ' ': 'underline', X: 'junk', Y: 3 }), { 'Rossi M': 'bold' },
  'styles inconnus ou noms vides ignorés');
eq(sanitizeScientistStyles(null), {}, 'aucun style enregistré ⇒ objet vide');
const legacy = normalizePubFormat({
  preset: 'acs', etAlLimit: '4', underlineScientists: true, alwaysShowScientists: 1,
  fields: [{ id: 'authors', enabled: true, order: 0, style: 'normal' }]
});
eq([legacy.etAlLimit, legacy.underlineScientists, legacy.alwaysShowScientists, legacy.scientistStyles],
  [4, true, true, {}], 'ancien format (sans styles) relu sans perte : « et al. » 4 + souligné');
eq(normalizePubFormat({ etAlLimit: -3 }).etAlLimit, 0, '« et al. » négatif ramené à « jamais »');
const dflt = loadPubFormat();
ok(dflt && dflt.preset === 'nature' && Array.isArray(dflt.fields) && dflt.scientistStyles && Object.keys(dflt.scientistStyles).length === 0,
  'format par défaut : Nature, aucune personne stylée');
eq(AUTHOR_STYLE_IDS, ['none', 'underline', 'bold'], 'trois styles : normal, souligné, gras');
eq(AUTHOR_STYLES.map((s) => s.label), ['Aa', 'U', 'B'], 'libellés des boutons du panneau');
ok(PUB_FORMAT_KEY.includes('pubFormat') && !!PUB_FORMAT_PRESETS[dflt.preset],
  'clé de stockage et presets journal exposés par le module');

/* ── 6. Reste du moteur (champs, DOI, échappement) inchangé ────────────── */
eq(pubFieldValue({ title: 'T' }, 'title'), 'T', 'lecture d’un champ');
eq(pubFieldValue({ title: 'T' }, 'inconnu'), '', 'champ inconnu ⇒ vide');
eq(pubDoiUrl('10.1016/j.bcp.2024.1'), 'https://doi.org/10.1016/j.bcp.2024.1', 'DOI transformé en lien');
eq(pubDoiUrl('https://doi.org/10.1/x'), 'https://doi.org/10.1/x', 'URL déjà complète conservée');
const apa = pubCitationHtml(pub, buildPubFormat('apa'), scientists);
ok(apa.includes('class="pub-doi-link"') && apa.includes('https://doi.org/10.1016/j.jbc.2024.105678'),
  'preset APA : le DOI reste un lien cliquable');
ok(pubCitationHtml({ ...pub, authors: 'Rossi & Cie <b>' }, fmt(), scientists).includes('Rossi &amp; Cie &lt;b&gt;'),
  'les noms sont échappés (pas d’injection HTML dans la citation)');

/* ── 7. Câblage de l'écran « Publication format » (Publications.jsx) ───── */
const src = readFileSync(new URL('./src/components/Publications.jsx', import.meta.url), 'utf8');
const mod = readFileSync(new URL('./src/components/pubCitation.js', import.meta.url), 'utf8');
const pdm = readFileSync(new URL('./src/components/AppModules/projectDetailModule.jsx', import.meta.url), 'utf8');

ok(/from '\.\/pubCitation';/.test(src), 'Publications.jsx importe le moteur depuis ./pubCitation');
ok(/const citationScientists = useMemo\(/.test(src), 'les membres cités = scientifiques + noms ajoutés à la main');
ok(/\(extraScientists \|\| \[\]\)\.forEach/.test(src), 'les scientifiques ajoutés manuellement sont inclus');
eq((src.match(/pubCitationHtml\(p, pubFormat, citationScientists\)/g) || []).length, 1,
  'le tableau des publications rend la citation avec ces membres');
eq((src.match(/pubCitationHtml\(samplePub, activeFormat, citationScientists\)/g) || []).length, 1,
  'l’aperçu du format utilise ces mêmes membres');
ok(/AUTHOR_STYLES\.map/.test(src), 'le panneau itère sur les styles (boutons Aa / U / B)');
ok(/pubSetScientistStyle\(name, s\.id\)/.test(src) && /pubSetAllScientistStyles\(s\.id\)/.test(src),
  'choix par membre et « Set all to » branchés');
ok(/scientistStyleOf\(name, activeFormat\)/.test(src), 'le style effectif de chaque membre est affiché');
ok(/scientistStyles: \{ \.\.\.\(activeFormat\.scientistStyles \|\| \{\}\) \}/.test(src),
  'les styles sont conservés à chaque modification du format');
ok(!/underlineScientists: e\.target\.checked/.test(src), 'l’ancienne case « Underline their names » est retirée du panneau');
ok(/The old “Underline their names” setting of this format is still on/.test(src),
  'un format existant souligné est signalé, sans être réécrit en douce');
ok(!/renderAuthorNames|PUB_FORMAT_PRESETS = \{|const buildPubFormat/.test(src),
  'le moteur n’est plus dupliqué dans Publications.jsx');
ok(/export \{\r?\n  AUTHOR_STYLES/.test(src) && /\} from '\.\/pubCitation';/.test(src),
  'Publications.jsx réexporte le moteur (les imports existants continuent de marcher)');
ok(/loadPubFormat, loadRelevantPapers, matchCoauthors, pubCitationData, pubCitationHtml/.test(pdm) &&
   /from '\.\.\/Publications';/.test(pdm),
  'la bibliographie des projets importe le moteur (+ les Relevant papers) depuis Publications');
ok(!/from 'react'/.test(mod), 'le moteur ne dépend pas de React (testable hors navigateur)');
/* ── 8. Co-auteurs dans les projets : les entrées de bibliographie sont
   complétées par la publication d’origine. C’est le cas du papier importé AVANT
   que les auteurs ne soient recopiés dans la bibliographie : la citation ne
   montrait alors que le titulaire du projet. ─────────────────────────────── */
const storedPub = { id: 'pub_1', ...pub, scientist: 'Rossi M' };
const legacyBib = { id: 'pb_1', title: pub.title, link: '', scientist: 'Rossi M', comments: '' };

eq(pubOriginOf(legacyBib, [storedPub]), storedPub, 'publication d’origine retrouvée par le titre');
eq(pubOriginOf({ ...legacyBib, sourceId: 'pub_1', title: 'titre corrigé' }, [storedPub]), storedPub,
  'publication d’origine retrouvée par sourceId, même si le titre a été corrigé');
eq(pubOriginOf(legacyBib, [{ ...storedPub, title: 'Autre papier' }]), null, 'titre différent ⇒ aucune correspondance');
eq(pubOriginOf(legacyBib, []), null, 'sans liste de publications ⇒ rien (pas de plantage)');
eq(pubCitationData(legacyBib, [storedPub]).authors, ALL,
  'entrée ancienne sans auteurs ⇒ liste COMPLÈTE des auteurs du papier (laboratoire + extérieurs)');
eq(pubCitationData({ ...legacyBib, authors: 'Rossi M et al.' }, [storedPub]).authors, 'Rossi M et al.',
  'une correction manuelle des auteurs n’est jamais écrasée');
eq(pubCitationData({ ...legacyBib, year: '2025' }, [storedPub]).year, '2025', 'champ propre prioritaire');
eq(pubCitationData({ id: 'pb_2', title: 'Papier inconnu' }, [storedPub]),
  { authors: '', year: '', title: 'Papier inconnu', journal: '', volume: '', pages: '', doi: '' },
  'papier absent des publications ⇒ entrée reprise telle quelle');
const legacyCitation = pubCitationHtml(pubCitationData(legacyBib, [storedPub]), fmt(), scientists);
ok(legacyCitation.includes('Smith J') && legacyCitation.includes('Costa L'),
  'la citation du projet cite désormais les co-auteurs extérieurs eux aussi');

/* ── 9. Câblage entre Publications et la bibliographie des projets ──────── */
ok(/pubCitationHtml\(citeData\(r\), pubFormat, operatorNames\)/.test(pdm),
  'la bibliographie du document de projet cite les auteurs complets (citeData)');
/* LA MISE EN FORME DE LA PUBLICATION S’APPLIQUE PARTOUT OÙ UNE RÉFÉRENCE
   S’AFFICHE : le document exporté ET la liste numérotée de la page projet
   (l’utilisateur : « le publication format ne modifie pas le format des
   références dans le projet »). */
ok(/const citation = pubCitationHtml\(d, pubFormat, operatorNames\)/.test(pdm),
  'la liste numérotée de la page projet est rendue avec le publication format (champs, styles, et al.)');
ok((pdm.match(/pubCitationHtml\(/g) || []).length >= 3,
  '…comme la bibliographie du document exporté (une seule fonction de rendu partout)');
/* LA « PROJECT BIBLIOGRAPHY » N’EST PLUS RECOPIÉE dans la page projet : elle
   doublonnait la liste numérotée (« only confusing… do not show it »). */
ok(!/Project bibliography papers \(/.test(pdm) && !/No papers labeled with/.test(pdm),
  'la liste « Project bibliography » n’est plus ré-affichée sur la page projet (elle vit dans Publications)');
ok(/The project bibliography papers themselves \(\{projectBib\.length\}\)/.test(pdm),
  '…la page dit seulement où les gérer (Publications → “Project bibliography”)');
ok(!/const addBibPaper/.test(pdm) && !/const showBibForm/.test(pdm),
  '…et le formulaire « + Add paper » de la page projet a disparu avec elle (les références s’importent)');
ok(/const pickerItems = \(list\) => list\.map/.test(pdm) && /items: pickerItems\(projectBib\)/.test(pdm),
  'le sélecteur de références montre lui aussi les co-auteurs');
ok(/authors: pbDraft\.authors\.trim\(\)/.test(src), 'le formulaire « + Add paper » de Publications saisit les auteurs');
ok(/authors: p\.authors \|\| ''/.test(src), 'l’import en bibliographie de projet recopie les auteurs');
ok(!/authors: bibDraft\.authors\.trim\(\)/.test(pdm),
  'la page projet n’a plus de formulaire « + Add paper » (la liste dupliquée a été retirée)');
ok(/\.\.\.pubCitationData\(paper, pubs\),/.test(src),
  'les lignes de la bibliographie de projet sont complétées par la publication d’origine');
ok(/const citeData = \(entry\) => pubCitationData\(entry, citationPool\)/.test(pdm),
  'le projet résout les auteurs via pubCitationData (publications + Relevant papers)');


/* Les « Relevant papers » (recherche PubMed / Crossref) conservent elles aussi
   les auteurs : la chaîne complète recherche → bibliographie de projet →
   citation ne perd plus les co-auteurs. */
ok(/authors: paperDraft\.authors\.trim\(\)/.test(src), '« + Add paper » (Relevant papers) saisit les auteurs');
ok(/scientist, authors: r\.authors \|\| '', journal: r\.journal \|\| ''/.test(src),
  'les résultats de recherche ajoutés aux Relevant papers conservent leurs auteurs');
ok(/const paperCols = \['Labels', 'Title', 'Authors',/.test(src), 'la table des Relevant papers montre les auteurs');


/* ── 10. Une entrée se raccroche à sa publication même quand le TITRE a changé
   (titre retouché à la main, preprint puis article publié, papier importé depuis
   « Relevant papers ») : le DOI et l’identifiant PubMed font le lien, et les
   auteurs complets arrivent enfin dans la citation. ────────────────────────── */
eq(pubDoiKey('https://doi.org/10.1016/j.jbc.2024.105678'), '10.1016/j.jbc.2024.105678',
  'DOI extrait d’un lien doi.org');
eq(pubDoiKey('10.1016/J.JBC.2024.105678.'), '10.1016/j.jbc.2024.105678',
  'DOI normalisé (casse) et ponctuation finale retirée');
eq(pubDoiKey('https://pubmed.ncbi.nlm.nih.gov/12345678/'), '', 'un lien PubMed n’est pas un DOI');
eq(pubPmidKey('https://pubmed.ncbi.nlm.nih.gov/12345678/'), '12345678', 'identifiant PubMed lu dans un lien');
eq(pubPmidKey('12345678'), '12345678', 'identifiant PubMed écrit en clair');
eq(pubPmidKey('10.1016/j.jbc.2024.105678'), '', 'un DOI n’est pas un identifiant PubMed');

const doiPub = { id: 'pub_9', ...pub, scientist: 'Rossi M' };
const bibWithDoi = { id: 'pb_9', title: 'Titre corrigé à la main', link: '10.1016/j.jbc.2024.105678', authors: '' };
eq(pubOriginOf(bibWithDoi, [doiPub]), doiPub, 'publication d’origine retrouvée par DOI malgré un titre différent');
eq(pubCitationData(bibWithDoi, [doiPub]).authors, ALL,
  'les auteurs complets (laboratoire + extérieurs) arrivent par le DOI');
const pmidPub = { id: 'pub_10', authors: ALL, year: '2024', title: 'Titre du journal', pmid: '12345678' };
eq(pubOriginOf({ id: 'pb_10', title: 'Titre du carnet', link: 'https://pubmed.ncbi.nlm.nih.gov/12345678/' }, [pmidPub]),
  pmidPub, 'publication d’origine retrouvée par identifiant PubMed');
const linksPub = {
  id: 'pub_11', ...pub, scientist: 'Rossi M',
  links: [{ description: 'DOI', url: 'https://doi.org/10.1016/j.jbc.2024.105678' }]
};
eq(pubOriginOf({ id: 'pb_11', title: 'Titre abrégé', doi: '10.1016/j.jbc.2024.105678' }, [linksPub]),
  linksPub, 'DOI comparé même quand seule une URL de links[] le porte');
eq(pubOriginOf({ id: 'pb_12', title: 'Papier sans identifiant' }, [pmidPub]), null,
  'aucun identifiant commun et titre différent ⇒ rien (jamais de faux positif)');
eq(pubCitationData({ id: 'pb_13', title: 'Papier sans identifiant' }, [pmidPub]),
  { authors: '', year: '', title: 'Papier sans identifiant', journal: '', volume: '', pages: '', doi: '' },
  'un papier introuvable ne reçoit aucun champ inventé');

/* Câblage : la page de projet cherche la publication d’origine dans les DEUX
   listes, reconnaît le titulaire comme co-auteur, et répare les entrées
   anciennes (auteurs recopiés puis sauvegardés). */
ok(/const citationPool = useMemo\(\(\) => \[\.\.\.pubs, \.\.\.loadRelevantPapers\(\)\]/.test(pdm),
  'la page de projet cherche les auteurs dans les publications ET les Relevant papers');
ok(/const coauthors = Array\.isArray\(p\.coauthors\)\r?\n\s*\? p\.coauthors\r?\n\s*: matchCoauthors\(p\.authors \|\| '', operatorNames \|\| \[\], p\.scientist\)/.test(pdm),
  'la liste « Publications of the scientist » retrouve les papiers dont le titulaire n’est QUE co-auteur');
ok(/if \(!canModify \|\| citationPool\.length === 0\) return;/.test(pdm),
  'la réparation des entrées anciennes n’écrit rien pour un lecteur en consultation seule');
ok(/\['authors', 'journal', 'year', 'doi', 'volume', 'pages'\]\.forEach/.test(pdm) &&
   /if \(String\(next\[key\] \|\| ''\)\.trim\(\)\) return;/.test(pdm),
  'la réparation recopie les auteurs, jamais à la place d’une valeur déjà saisie');
ok(/export const loadRelevantPapers/.test(src), 'les Relevant papers sont exposés au reste de l’application');
ok(/sourceId: p\.id \|\| '',\r?\n\s*source: p\.source \|\| '',\r?\n\s*pmid: p\.pmid \|\| '',/.test(src),
  'l’import en bibliographie retient l’identité du papier d’origine (id / source / PMID)');
ok(/⚠ no authors recorded/.test(pdm), 'une entrée sans auteurs est signalée dans la page de projet');


/* ── 11. Import ORCID : le titulaire n’est plus le seul auteur ─────────────
   L’API ORCID publique ne renvoie aucun contributeur (`work-summary`), si bien
   qu’un travail importé depuis un iD ORCID n’avait que le nom du membre du
   laboratoire comme liste d’auteurs. La liste COMPLÈTE est désormais récupérée à
   part (DOI → OpenAlex par lots, PMID → eSummary) avant l’enregistrement, et
   les publications déjà stockées peuvent être complétées d’un clic. ────────── */
eq(authorMatchesCandidate('Marco Rossi', 'Rossi M'), true,
  'nom complet (OpenAlex / Crossref) ↔ « Rossi M » de la liste du laboratoire');
eq(authorMatchesCandidate('Rossi M', 'Marco Rossi'), true, 'et dans l’autre sens');
eq(authorMatchesCandidate('Anna Bianchi', 'Bianchi A'), true, 'initiale ↔ prénom écrit en entier');
eq(authorMatchesCandidate('Rossi L', 'Rossi M'), false, 'initiale différente ⇒ autre personne');
eq(authorMatchesCandidate('Michele Rossi', 'Marco Rossi'), false, 'prénom différent ⇒ autre personne');
eq(authorMatchesCandidate('M Rossi', 'Marco Rossi'), true, 'prénom de l’auteur réduit à son initiale');
eq(matchCoauthors('Marco Rossi, Luigi Verdi, Anna Bianchi', scientists, ''), ['Rossi M', 'Bianchi A'],
  'les co-auteurs du laboratoire sont reconnus dans les noms complets importés');

ok(/const lookup = await authorListLookup\(out\)/.test(src) &&
   /authors: lookup\(r\) \|\| r\.authors/.test(src),
  'les travaux ORCID reçoivent la liste complète des auteurs avant d’être proposés');
ok(/https:\/\/api\.openalex\.org\/works\?filter=doi:/.test(src) && /const fetchAuthorsByDoi/.test(src),
  'auteurs récupérés par DOI (OpenAlex, une requête pour 40 DOI)');
ok(/esummary\.fcgi\?db=pubmed&id=/.test(src) && /const fetchAuthorsByPmid/.test(src),
  'auteurs récupérés par identifiant PubMed (eSummary)');
ok(/const refreshPubAuthors/.test(src) && /⟳ Complete author lists/.test(src),
  'les publications déjà enregistrées sont complétables d’un clic');
ok(/authors === String\(p\.scientist \|\| ''\)\.trim\(\)/.test(src),
  'seules les listes vides ou réduites au titulaire sont corrigées');
ok(/coauthors: matchCoauthors\(authors, scientistOptions, p\.scientist\)/.test(src),
  'les co-auteurs du laboratoire sont recalculés après la correction');


/* ── 12. CHANGER LE FORMAT CHANGE AUSSI LES PUBLICATIONS DU PROJET ─────────
   Signalé : « quand je change les paramètres du format de publication, cela
   n'affecte pas le format des publications déjà dans le projet ». Chaque projet
   stocke sa copie du format (`project.pubFormat`, choisie un jour dans
   « Format for: ») et la page de projet l'utilise EN PRIORITÉ :
   `project?.pubFormat || loadPubFormat()`. Changer le format PAR DÉFAUT doit
   donc mettre à jour ces copies — sinon elles restent figées à l'ancienne mise
   en forme et le défaut ne se voit nulle part. Un format de projet, lui, ne
   touche QUE ce projet. */
ok(/const setActiveFormat = \(fmt\) => \{/.test(src), 'le panneau écrit le format par défaut ou celui d’un projet');
ok(/setPbProjects\(\(prev\) => prev\.map\(\(p\) => \(p\.pubFormat \? \{ \.\.\.p, pubFormat: fmt \} : p\)\)\)/.test(src),
  'le format PAR DÉFAUT est recopié dans les projets qui avaient leur propre copie');
ok(/p\.name === pubFormatScope \? \{ \.\.\.p, pubFormat: fmt \} : p/.test(src),
  '…alors qu’un format de PROJET ne change que ce projet');
ok(/project\?\.pubFormat \|\| loadPubFormat\(\)/.test(pdm),
  'la page de projet utilise la copie du projet, sinon le défaut (d’où l’importance de la recopie)');
/* ── 12 bis. LA LISTE DES RÉFÉRENCES SUIT LE FORMAT, MÊME DANS UN DOCUMENT FIGÉ ──
   Signalé ensuite : « le publication format ne modifie toujours pas le format
   des références dans le texte du projet » ET « il n'y a pas de bouton “rebuilt
   from data” ». Deux causes : la bibliographie FIGÉE d'un document enregistré
   (« 💾 Save changes ») était réaffichée telle quelle, et le bouton de
   reconstruction n'apparaissait que dans un cas. Désormais :
     • le document figé est affiché SANS sa bibliographie (withoutBibliographySection)
       et la liste VIVANTE du projet est imprimée à sa place, rendue à chaque
       affichage avec le format courant ;
     • le bouton « ↩️ Rebuild from data » est TOUJOURS dans la barre d'outils du
       document (pour un utilisateur qui peut modifier le projet). */
ok(/withoutBibliographySection\(project\.exportDocHtml\)/.test(pdm),
  'le document figé est affiché sans sa bibliographie vieillie');
ok(/withoutBibliographySection\(project\.docSuggestion\.markedHtml\)/.test(pdm),
  '…idem pour la version proposée (suggestion)');
{
  const frozenAt = pdm.indexOf('withoutBibliographySection(project.exportDocHtml)');
  const bibAt = pdm.indexOf('({refs.length})</h2>');
  ok(frozenAt !== -1 && bibAt > frozenAt && pdm.slice(frozenAt, bibAt).includes('return docOrder.map((id) => blocks[id] || null);'),
    'la liste des références est rendue HORS du texte figé ET APRÈS les blocs ordonnés (donc toujours à jour)');
}
ok(/<li key=\{r\.id\}/.test(pdm) && /pubCitationHtml\(citeData\(r\), pubFormat, operatorNames\)/.test(pdm),
  '…et chaque entrée imprimée passe par le publication format');
ok(/Live preview/.test(src) && /pubCitationHtml\(samplePub, activeFormat, citationScientists\)/.test(src),
  'le panneau montre la liste des références du format COURANT (aperçu vivant) — la phrase explicative, elle, a été retirée (« remove all this explanatory text »)');
ok(/Rebuild from data/.test(pdm),
  'la barre d’outils du document nomme le bouton « Rebuild from data » — la phrase du panneau qui le rappelait a été retirée avec les autres (« remove all this explanatory text »)');
ok(/\{canModify && \(\s*<button onClick=\{rebuildDoc\}/.test(pdm),
  '…et ce bouton est TOUJOURS là (il n’était visible que sur un document déjà figé)');

/* ── 13. LA FORME DES RENVOIS DANS LE TEXTE SUIT LE FORMAT ───────────────────
   « nella sezione publication format, aggiungi la possibilità di controllare
   come i riferimenti bibliografici appaiono nel testo (come apici, tra
   parentesi quadre, tra parentesi tonde o come nome autore seguito da data) ».
   La forme est une propriété du FORMAT : elle suit donc le projet quand il a
   son propre format, et elle est appliquée partout où un renvoi s'affiche (voir
   applyInTextStyle, utils/referenceLinks.js). */
eq(IN_TEXT_STYLE_IDS, ['keep', 'sup', 'bracket', 'paren', 'author-date'],
  'les cinq formes proposées — dont « as written », qui ne réécrit jamais rien');
eq(IN_TEXT_STYLES.map((s) => s.label), ['as written', 'Superscript', 'Square brackets', 'Parentheses', 'Author + year'],
  'les libellés des boutons du panneau');
ok(IN_TEXT_STYLES.every((s) => s.id && s.label && s.title),
  'chaque forme est expliquée (infobulle du bouton)');
eq(buildPubFormat('nature').inTextStyle, 'keep',
  'un format neuf garde l’écriture du document : rien ne change sans le vouloir');
eq(normalizePubFormat({ fields: buildPubFormat('nature').fields, inTextStyle: 'paren' }).inTextStyle, 'paren',
  'une forme connue est gardée (le choix vit dans le format, donc dans le projet)');
eq(normalizePubFormat({ fields: buildPubFormat('nature').fields, inTextStyle: 'nonsense' }).inTextStyle, 'keep',
  'une forme inconnue (localStorage d’une autre version) retombe sur « as written »');
eq(normalizeInTextStyle(undefined), 'keep', 'sans choix enregistré, aucune forme n’est imposée');

/* Le panneau : les boutons, l'exemple rendu par le VRAI moteur, et la forme
   conservée à chaque autre modification du format. */
ok(/IN_TEXT_STYLES\.map/.test(src), 'le panneau itère sur les formes (boutons)');
ok(/pubPatchFormat\(\{ inTextStyle: s\.id \}\)/.test(src), '…et chaque bouton écrit la forme dans le format');
ok(/inTextStyle: normalizeInTextStyle\(activeFormat\.inTextStyle\)/.test(src),
  'la forme choisie survit aux autres modifications du format');
ok(/inTextSample\(activeFormat\.inTextStyle\)/.test(src),
  'l’aperçu du panneau montre la forme choisie');
ok(/import \{ inTextCitationHtml \} from '\.\.\/utils\/referenceLinks';/.test(src),
  '…rendue par le moteur RÉEL (l’aperçu ne peut pas mentir sur le document)');
/* La page projet : la forme est lue dans le format du projet et appliquée à
   l'affichage, à l'impression, à l'export et au document figé. */
ok(/const citeStyle = \(pubFormat && pubFormat\.inTextStyle\) \|\| 'keep';/.test(pdm),
  'la page projet lit la forme du format du projet');
ok(/const linkCitations = \(html, extraRefs = \[\]\) => applyInTextStyle\(/.test(pdm),
  '…et linkCitations l’applique (rendu du document, impression, export)');
ok(/style: citeStyle, refs: \[\.\.\.refs, \.\.\.\(extraRefs \|\| \[\]\)\]/.test(pdm),
  '…avec les références du projet (le libellé auteur-année en a besoin)');
ok(/linkCitations\(repairContentImages\(withoutBibliographySection\(project\.exportDocHtml\)\)\)/.test(pdm),
  'le document FIGÉ reçoit la forme à l’affichage (comme sa liste de références)');

/* ── 14. LA MISE EN FORME DU DOCUMENT : « il formato del testo per le varie
   sezioni … per le figure le stesse cose … dovrebbero applicarsi al progetto,
   come è adesso per le citazioni » ─────────────────────────────────────────
   Police, taille, position (gauche / centré / droite / justifié), style (gras,
   italique, souligné) et couleur de chaque PARTIE du document d'un projet —
   figures comprises. Le choix vit dans le format (`layout`), exactement comme
   la forme des renvois, et il est appliqué par une feuille de style (voir
   pubLayoutCss) : la page du projet, le document imprimé et son PDF — document
   figé compris. Un réglage laissé vide n'écrit RIEN. */
eq(PUB_LAYOUT_PART_IDS, ['title', 'authors', 'affiliations', 'heading', 'body', 'figure', 'bibliography'],
  'chaque partie d’un document a ses réglages (titre, auteurs, affiliations, intitulés, texte, figures, bibliographie)');
eq(PUB_TEXT_ALIGNMENTS.map((a) => a.id), ['left', 'center', 'right', 'justify'],
  'les quatre positions demandées : gauche, centré, droite, justifié');
ok(PUB_TEXT_ALIGNMENTS.every((a) => a.label && a.title), '…chacune expliquée (infobulle du bouton)');
ok(PUB_FONTS.length >= 5 && PUB_FONTS[0].id === '',
  'des polices sont proposées, la première étant « comme le programme » (aucune règle écrite)');
ok(PUB_LAYOUT_PARTS.every((p) => p.label && Array.isArray(p.selectors) && p.selectors.length),
  'chaque partie a un nom lisible et les sélecteurs qui la visent');
eq(PUB_LAYOUT_PARTS.filter((p) => p.width).map((p) => p.id), ['figure'],
  'seule la figure a une largeur (c’est une image, pas du texte)');

const freshFmt = buildPubFormat('nature');
eq(pubLayoutCss(freshFmt), '', 'un format neuf n’écrit AUCUNE règle : le document garde l’aspect du programme');
ok(PUB_LAYOUT_PART_IDS.every((id) => freshFmt.layout[id]),
  '…mais les réglages existent, prêts à être choisis (une entrée par partie)');
eq(Object.keys(normalizePubLayout(undefined)).length, PUB_LAYOUT_PART_IDS.length,
  'un format enregistré AVANT cette version n’impose rien non plus (mise en forme vierge)');
eq(normalizePubLayout(undefined).body.align, '', '…son alignement reste « comme le programme »');
eq(normalizePubLayout({}).figure.width, 100, 'et sa figure fait toute la largeur tant qu’on ne dit rien');
eq(normalizePubFormat({ fields: buildPubFormat('nature').fields }).layout.body.align, '',
  'le format relu d’un projet est complété sans rien imposer');

/* Le TEXTE d'une section : police, taille, position, style, couleur. */
const cssBody = pubLayoutCss({
  layout: { body: { font: 'Georgia, serif', size: 11.5, align: 'justify', bold: false, italic: true, underline: false, color: '#123456' } }
});
ok(cssBody.includes('#project-doc-container .pf-body'), 'le texte des sections est visé par sa classe');
ok(cssBody.includes('#project-doc-container p:not(.pf-authors):not(.pf-affiliations):not(.pf-meta):not(.pf-caption)'),
  '…et par ses paragraphes — en excluant l’en-tête, la ligne d’information et les légendes de figure');
ok(cssBody.includes('font-family: Georgia, serif !important;'), 'la police choisie est écrite');
ok(cssBody.includes('font-size: 11.5pt !important;'), 'la taille (en points, pour l’impression) aussi');
ok(cssBody.includes('text-align: justify !important;'), 'la position (justifié) aussi');
ok(cssBody.includes('font-style: italic !important;'), 'l’italique choisi aussi');
ok(cssBody.includes('font-weight: 400 !important;'),
  'un style explicitement RETIRÉ l’est vraiment (un titre écrit en gras redevient normal)');
ok(cssBody.includes('text-decoration: none !important;'), '…comme un souligné retiré');
ok(cssBody.includes('color: #123456 !important;'), '…et la couleur choisie');
ok(pubLayoutCss({ layout: { body: { bold: true } } }).includes('font-weight: 700 !important;'),
  'un style imposé passe devant la feuille du programme (et devant un style en ligne)');
eq((pubLayoutCss(freshFmt).match(/!important/g) || []).length, 0,
  'aucune règle n’est écrite sans un choix de l’utilisateur (pas de !important gratuit)');

/* Les FIGURES : les mêmes réglages — l’alignement place le cadre, la largeur
   dimensionne l’image, et le reste habille la LÉGENDE, le seul texte d’une figure. */
const cssFig = pubLayoutCss({
  layout: { figure: { align: 'center', width: 60, font: 'Arial, sans-serif', size: 9, color: '#777777', italic: true } }
});
ok(cssFig.includes('#project-doc-container .pf-figure, #project-doc-container figure { text-align: center !important; }'),
  'la position choisie pour les figures (ici au centre) est écrite');
ok(/\.pf-figure img[\s\S]*width: 60% !important;/.test(cssFig),
  'la largeur de la figure s’applique à l’IMAGE (60 % de la colonne)');
ok(cssFig.includes('#project-doc-container .pf-caption, #project-doc-container figcaption'),
  'la légende est visée elle aussi');
ok(cssFig.includes('font-size: 9pt !important;') && cssFig.includes('color: #777777 !important;'),
  '…et reçoit la police, la taille, la couleur et le style choisis pour les figures');
ok(!/width: 100%/.test(cssFig), 'une largeur de 100 % n’écrit rien (c’est déjà celle du document)');

/* LE NETTOYAGE : une copie de format venue d'un autre poste (localStorage,
   document d'un collègue) ne peut pas apporter de CSS dans le document. */
const nasty = normalizePubLayout({
  body: { font: 'x; } body { display:none } a {', size: 999, align: 'middle', color: 'red', bold: 'yes', italic: 'true', underline: 'false' },
  figure: { width: 5 }
});
ok(!/[;{}]/.test(nasty.body.font) && nasty.body.font.startsWith('x'),
  'une police ne peut pas porter de CSS (la ponctuation dangereuse est retirée)');
eq(nasty.body.size, 0, 'une taille invraisemblable est ignorée');
eq(nasty.body.align, '', 'une position inconnue est ignorée');
eq(nasty.body.color, '', 'une couleur qui n’est pas un code #rrggbb est ignorée');
eq(nasty.body.bold, null, 'un style illisible laisse le texte tel quel');
eq(nasty.body.italic, true, '…alors qu’un « true » écrit en texte est bien relu (format d’un fichier)');
eq(nasty.body.underline, false, '…et un « false » aussi (le style est retiré, pas oublié)');
eq(nasty.figure.width, 100, 'une largeur hors bornes retombe sur la largeur du document');
ok(pubTextStyleIsSet(nasty.body) && !pubTextStyleIsSet(buildPubLayout().body),
  'un réglage se voit (badge du panneau) et un réglage vierge ne se voit pas');

/* LE PANNEAU : une ligne par partie, l'aperçu vivant — et la mise en forme
   survit à chaque autre modification du format (comme la forme des renvois). */
ok(/PUB_LAYOUT_PARTS\.map/.test(src), 'le panneau itère sur les parties du document');
ok(/pubSetLayout\(part\.id, \{ align: st\.align === a\.id \? '' : a\.id \}\)/.test(src),
  '…un bouton par position, recliquable pour l’enlever');
ok(/pubToggleLayoutStyle\(part\.id, 'bold'\)/.test(src) && /const pubToggleLayoutStyle = \(partId, key\) =>/.test(src),
  '…et gras / italique / souligné à trois états (imposé, retiré, comme le programme)');
ok(/pubTextStyleIsSet\(st\)/.test(src), '…la partie réglée est mise en évidence');
ok(/pubLayoutCss\(activeFormat, '#pub-layout-preview'\)/.test(src),
  'l’aperçu du panneau est rendu par la feuille RÉELLE du document (il ne peut pas mentir)');
eq((src.match(/layout: normalizePubLayout\(activeFormat\.layout\)/g) || []).length >= 1, true,
  'la mise en forme survit aux autres modifications du format (champs, et al., styles des noms)');
ok(/const pubSetPreset = \(presetId\) =>/.test(src) && /pubSetPreset\(e\.target\.value\)/.test(src),
  'changer de preset refait la citation mais GARDE la mise en forme du document');

/* LA PAGE PROJET : la feuille part du format du projet (`project.pubFormat`,
   sinon le défaut) et vaut pour l'affichage — document figé compris — et pour
   l'export imprimé / PDF. */
eq((pdm.match(/pubLayoutCss\(pubFormat, DOC_CONTAINER_SELECTOR\)/g) || []).length, 2,
  'la feuille est écrite deux fois : à l’écran (page et document figé) et dans la page exportée');
ok(/const pubFormat = useMemo\(\(\) => project\?\.pubFormat \|\| loadPubFormat\(\), \[project\]\);/.test(pdm),
  '…depuis le format du projet, sinon le format par défaut');
ok(/<body><div id="\$\{DOC_CONTAINER_ID\}">\$\{bodyHtml\}<\/div><\/body>/.test(pdm),
  'l’export remet le document dans le même conteneur : les règles s’y appliquent (impression / PDF)');
['pf-title', 'pf-authors', 'pf-affiliations', 'pf-heading', 'pf-body', 'pf-figure', 'pf-caption', 'pf-bib']
  .forEach((cls) => ok(pdm.includes(cls), `le document porte la classe .${cls} que la feuille vise`));


/* ── 15. « ⟳ COMPLETE AUTHOR LISTS » DANS LES TROIS LISTES DE PAPIERS ─────────
   Signalé : « relevant paper and project bibliography sections do not find all
   authors of the publication. You could provide a “complete author list” button
   as in the “publication of the scientist” section ». Les deux sections ont donc
   le même bouton, et il travaille avec le moteur de référence du laboratoire
   (utils/referenceEnrich.js) — le seul qui sache qu'une liste coupée par un
   « et al. » n'est PAS une liste remplie, et qui la remplace par la liste
   complète du même article (pot commun, puis Crossref). ──────────────────── */
eq(authorsIncomplete({ authors: '' }), true, 'un papier sans auteurs est à compléter');
eq(authorsIncomplete({}), true, 'un papier qui n’a même pas le champ non plus');
eq(authorsIncomplete({ authors: 'Fumano, et al.' }), true,
  'une liste COUPÉE par un « et al. » est à compléter : c’est le défaut signalé');
eq(authorsIncomplete({ authors: 'Fumano M, and others' }), true, '…« and others » aussi');
eq(authorsIncomplete({ authors: 'Rossi M' }), false,
  'un seul nom écrit SANS marqueur reste une liste voulue (on n’y touche pas)');
eq(authorsIncomplete({ authors: 'Rossi M, Bianchi A, Smith J' }), false,
  'une liste complète n’est jamais retouchée');

ok(/import \{ authorsIncomplete, enrichReferences \} from '\.\.\/utils\/referenceEnrich';/.test(src),
  'Publications importe le moteur de référence (auteurs incomplets)');
ok(/const completePaperAuthors = async \(\) => \{/.test(src) &&
   /const pending = papers\.filter\(authorsIncomplete\);/.test(src),
  'les « Relevant papers » ne cherchent QUE les listes vides ou coupées');
ok(/const res = await enrichReferences\(pending, \{ pool: pubs, all: false, max: 60 \}\);/.test(src),
  '…dans les publications du laboratoire d’abord, puis sur le web (Crossref)');
ok(/if \(byId\.size > 0\) setPapers\(\(prev\) => prev\.map\(\(p\) => \(byId\.has\(p\.id\) \? \{ \.\.\.p, \.\.\.byId\.get\(p\.id\) \} : p\)\)\);/.test(src),
  'les listes trouvées sont ENREGISTRÉES dans les Relevant papers (pas seulement affichées)');
ok(/const completePbAuthorLists = async \(\) => \{/.test(src) &&
   /pool: \[\.\.\.pubs, \.\.\.papers\], all: false, max: 60/.test(src),
  'la bibliographie des projets cherche dans les publications ET les Relevant papers (comme la page projet)');
ok(/if \(authorsIncomplete\(paper\)\) pending\.push\(\{ paper, projectId: prj\.id \}\);/.test(src),
  '…pour chaque entrée du projet dont la liste d’auteurs est incomplète');
ok(/bibliography: \(prj\.bibliography \|\| \[\]\)\.map\(\(b\) => \(byPaper\.has\(b\.id\) \? \{ \.\.\.b, \.\.\.byPaper\.get\(b\.id\) \} : b\)\)/.test(src),
  '…et la liste complétée est écrite dans la bibliographie du projet, entrée par entrée');
eq((src.match(/'⟳ Complete author lists'/g) || []).length, 3,
  'le bouton existe dans les TROIS sections (publications, Relevant papers, bibliographie des projets)');
ok(/onClick=\{completePaperAuthors\}/.test(src) && /onClick=\{completePbAuthorLists\}/.test(src),
  '…chaque section appelle son propre complètement');
ok(/⏳ Fetching authors…/.test(src), '…et le bouton dit qu’il travaille');
ok(/paperAuthorsMsg && <div className="px-4 pt-3 text-xs font-semibold text-emerald-700">/.test(src),
  'les Relevant papers affichent le compte rendu (trouvés, introuvables, « et al. » restants)');
ok(/Every relevant paper already lists all its authors\./.test(src) &&
   /Every project paper already lists all its authors\./.test(src),
  '…et ne font rien quand toutes les listes sont déjà là');

console.log(`_pub_author_style_test: ${passed} passed`);
