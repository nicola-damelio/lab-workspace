// src/components/pubCitation.js
/* =========================================================================
   PUBLICATION FORMAT — how a publication citation is rendered: order of the
   fields, style of each field, presence/absence of each field, and presets
   reproducing the reference formats of important journals.

   Kept in this React-free module so that (a) the engine can be checked by node
   (see _pub_author_style_test.mjs) and (b) both consumers share one renderer:
     • PublicationsSection → the « Formatted citation » of every paper;
     • projectDetailModule → the « References » of a project document.

   EVERY author of the paper is listed: the only rule that shortens the list is
   the “et al.” cutoff (etAlLimit). What the format chooses on top of that is
   the STYLE of the lab members' names: each scientist of the user list can be
   underlined, bold or left as typed, wherever their name appears in the author
   list (see AUTHOR_STYLES / scientistStyles).

   ET, DEPUIS LE SIGNALEMENT « il programma non distingue tra nome e cognome
   degli autori… la parte di autori rimane nel formato del giornale dove è stato
   pubblicato », LA FORME DE L'ÉCRITURE DES NOMS EST UNE DÉCISION DU FORMAT
   (`nameStyle`) — plus jamais celle de la revue d'origine. Le découpage
   nom / prénom, le nettoyage des listes et les quatre écritures vivent dans
   utils/authorNames.js, partagé avec l'import (utils/referenceImport.js,
   utils/referenceEnrich.js) : une seule règle, donc un seul résultat, que la
   liste vienne de PubMed (« Smith JA »), de Crossref (« John A. Smith ») ou
   d'un « AU - » d'un fichier RIS (« Smith, John A. »).
   ========================================================================= */
import { formatAuthorName, normalizeNameStyle, splitAuthorNames } from '../utils/authorNames.js';

/* La forme des noms d'auteurs est ré-exportée ici : le panneau « Publication
   format » n'importe que ce module (voir Publications.jsx). */
export { NAME_STYLES, NAME_STYLE_IDS, normalizeNameStyle } from '../utils/authorNames.js';

export const PUB_FORMAT_KEY = 'labWorkspace_pubFormat';

export const PUB_FORMAT_PRESETS = {
  nature: { label: 'Nature', defs: [['authors', 'normal', '', ''], ['title', 'italic', '', '. '], ['journal', 'normal', '', ', '], ['volume', 'bold', '', ', '], ['pages', 'normal', '', ''], ['year', 'normal', '(', ')']] },
  science: { label: 'Science', defs: [['authors', 'normal', '', ''], ['title', 'normal', '', '. '], ['journal', 'italic', '', ', '], ['volume', 'bold', '', ', '], ['pages', 'normal', '', ''], ['year', 'normal', '(', ')']] },
  cell: { label: 'Cell', defs: [['authors', 'normal', '', ''], ['year', 'normal', '(', ')'], ['title', 'normal', '', '. '], ['journal', 'italic', '', ', '], ['volume', 'normal', '', ', '], ['pages', 'normal', '', '.']] },
  apa: { label: 'APA', defs: [['authors', 'normal', '', ''], ['year', 'normal', '(', ')'], ['title', 'italic', '', '. '], ['journal', 'italic', '', ', '], ['volume', 'italic', '', ''], ['pages', 'normal', '', ', '], ['doi', 'normal', 'https://doi.org/', '']] },
  pnas: { label: 'PNAS', defs: [['authors', 'normal', '', ''], ['year', 'normal', '(', ')'], ['title', 'normal', '', '. '], ['journal', 'italic', '', ''], ['volume', 'bold', '', ', '], ['pages', 'normal', '', '']] },
  acs: { label: 'ACS', defs: [['authors', 'normal', '', ''], ['title', 'normal', '', '. '], ['journal', 'italic', '', ''], ['year', 'normal', '', ', '], ['volume', 'bold', '', ', '], ['pages', 'normal', '', '.'], ['doi', 'normal', 'DOI: ', '']] },
  springer: { label: 'Springer', defs: [['authors', 'normal', '', ''], ['year', 'normal', '(', ')'], ['title', 'normal', '', '. '], ['journal', 'italic', '', ''], ['volume', 'normal', '', ':'], ['pages', 'normal', '', '']] },
  harvard: { label: 'Harvard', defs: [['authors', 'normal', '', ''], ['year', 'normal', '(', ')'], ['title', 'italic', '‘', '’'], ['journal', 'italic', '', ', '], ['volume', 'normal', '', ', '], ['pages', 'normal', '', 'pp. ', '']] }
};

/* Style of a lab member's name in the citation. 'none' is a real, explicit
   choice — it overrides the legacy « underline every lab scientist » flag — so
   this list drives the panel buttons, the sanitizer and the renderer alike. */
export const AUTHOR_STYLES = [
  { id: 'none', label: 'Aa', title: 'Normal — the name is left as typed' },
  { id: 'underline', label: 'U', title: 'Underline this scientist’s name' },
  { id: 'bold', label: 'B', title: 'Bold this scientist’s name' }
];
export const AUTHOR_STYLE_IDS = AUTHOR_STYLES.map((s) => s.id);

/* LA FORME DES RENVOIS DANS LE TEXTE (« come appaiono I riferimenti
   bibliografici nel testo »). Le choix est stocké dans le format lui-même
   (`format.inTextStyle`) et appliqué partout où un renvoi s'affiche : le
   document du projet, sa version imprimée, son PDF et son export (voir
   applyInTextStyle dans utils/referenceLinks.js).
     • « keep »  — le renvoi garde l'écriture du document (¹², [12], (12)) ;
     • « sup »   — exposant, la forme de Nature / Science ;
     • « bracket » — crochets, la forme de Paperpile / Zotero ;
     • « paren »  — parenthèses, la forme d'EndNote / Word ;
     • « author-date » — le nom des auteurs et l'année, la forme APA / Harvard. */
export const IN_TEXT_STYLES = [
  { id: 'keep', label: 'as written', title: 'Keep the citation as the document wrote it (¹², [12], (12)) — nothing is rewritten' },
  { id: 'sup', label: 'Superscript', title: 'Exponent — “as shown previously¹²” (Nature, Science…)' },
  { id: 'bracket', label: 'Square brackets', title: 'Square brackets — “as shown previously [12]” (Paperpile, Zotero…)' },
  { id: 'paren', label: 'Parentheses', title: 'Parentheses — “as shown previously (12)” (EndNote / Word)' },
  { id: 'author-date', label: 'Author + year', title: 'Author and year — “as shown previously (Rossi & Bianchi, 2018)” (APA, Harvard…)' }
];
export const IN_TEXT_STYLE_IDS = IN_TEXT_STYLES.map((s) => s.id);

/** Une forme de renvoi inconnue (localStorage, document d'un autre poste) vaut
 *  « keep » : le renvoi garde l'écriture du document, rien n'est inventé. */
export const normalizeInTextStyle = (value) =>
  (IN_TEXT_STYLE_IDS.includes(value) ? value : 'keep');

/* ── LA MISE EN FORME DU DOCUMENT D'UN PROJET ───────────────────────────────

   « nella parte publication format, si può implementare il formato del testo
   per le varie sezioni? vorrei poter scegliere font, police, posizione
   (giustificato, centrato, a sinistra, a destra), stile (grassetto, corsivo,
   sottolineato), colore. Per le figure vorrei poter scegliere le stesse cose.
   Una volta implementate nel publication format dovrebbero applicarsi al
   progetto, come è adesso per le citazioni. »

   C'est exactement le même principe que la forme des renvois (`inTextStyle`) :
   le choix vit DANS le format (`format.layout`), il ne réécrit jamais le texte
   de l'auteur, et il est appliqué à l'AFFICHAGE — la page du projet, le
   document imprimé et son PDF — par `pubLayoutCss` (la feuille de style du
   document, voir projectDetailModule). Changer le format change donc tout de
   suite ce que le projet montre, document figé compris, et un projet qui a sa
   PROPRE copie du format (`project.pubFormat`) garde la sienne.

   Chaque PARTIE du document a ses réglages — les mêmes qu'une feuille de styles
   de traitement de texte : titre, auteurs, affiliations, intitulés de section,
   texte des sections, figures et légendes, bibliographie. Un réglage absent
   (« As in the app », taille vide, style non touché) ne produit AUCUNE règle :
   sans choix de l'utilisateur, le document s'affiche comme avant. */

export const PUB_TEXT_ALIGNMENTS = [
  { id: 'left', label: 'Left', title: 'Align this part to the left' },
  { id: 'center', label: 'Center', title: 'Centre this part' },
  { id: 'right', label: 'Right', title: 'Align this part to the right' },
  { id: 'justify', label: 'Justified', title: 'Justify this part (both margins)' }
];
export const PUB_ALIGNMENT_IDS = PUB_TEXT_ALIGNMENTS.map((a) => a.id);

/* Les polices proposées : des familles que tout poste a déjà (aucun
   téléchargement, aucun appel réseau — le document s'imprime et s'exporte
   partout pareil). « As in the app » = aucune règle écrite, on garde la police
   du programme. */
export const PUB_FONTS = [
  { id: '', label: 'As in the app' },
  { id: 'Georgia, "Times New Roman", serif', label: 'Georgia' },
  { id: '"Times New Roman", Times, serif', label: 'Times New Roman' },
  { id: 'Garamond, Georgia, serif', label: 'Garamond' },
  { id: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { id: 'Helvetica, Arial, sans-serif', label: 'Helvetica' },
  { id: '"Segoe UI", Roboto, sans-serif', label: 'Segoe UI' },
  { id: 'Calibri, Carlito, sans-serif', label: 'Calibri' },
  { id: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
  { id: '"Courier New", monospace', label: 'Courier New' }
];

/* Les parties du document, dans l'ordre où elles s'impriment. `selectors` = ce
   que la feuille de style vise : une CLASSE que le programme pose lui-même
   (`.pf-…`, toujours présente dans le document vivant) et, en repli, la BALISE
   du document — un document figé avant cette version n'a pas les classes, la
   balise le rattrape. `caption` (figures seulement) = la légende, et `width` =
   la largeur de l'image (pourcentage de la colonne). */
export const PUB_LAYOUT_PARTS = [
  { id: 'title', label: 'Title', selectors: ['.pf-title', 'h1'] },
  { id: 'authors', label: 'Authors', selectors: ['.pf-authors'] },
  { id: 'affiliations', label: 'Affiliations', selectors: ['.pf-affiliations'] },
  { id: 'heading', label: 'Section headings', selectors: ['.pf-heading', 'h2'] },
  {
    id: 'body',
    label: 'Section text',
    /* Le texte d'une section : ses paragraphes, où qu'ils soient (le HTML d'un
       manuscrit importé n'a pas de classe), plus le cadre `.pf-body` pour ce qui
       HÉRITE de la mise en forme. Les lignes de l'en-tête, la ligne
       d'information et les légendes de figure sont EXCLUES : elles ont leur
       propre partie. */
    selectors: ['.pf-body',
      'p:not(.pf-authors):not(.pf-affiliations):not(.pf-meta):not(.pf-caption)']
  },
  {
    id: 'figure',
    label: 'Figures & captions',
    selectors: ['.pf-figure', 'figure'],
    caption: ['.pf-caption', 'figcaption'],
    width: true
  },
  { id: 'bibliography', label: 'References', selectors: ['.pf-bib', '.pf-bib li'] }
];
export const PUB_LAYOUT_PART_IDS = PUB_LAYOUT_PARTS.map((p) => p.id);

/* ══ LES BLOCS DU DOCUMENT D'UN PROJET, DANS L'ORDRE OÙ ILS S'IMPRIMENT ══════
   La demande : « In the publication format I cannot change the order of the sections
   nor change the titles of the subsections. I want to be able for example to put the
   author before the title or change the name of “materials and methods” into
   “experimental section” or whatever. »

   Le document d'un projet est une SUITE DE BLOCS — le titre, les auteurs, les
   affiliations, la ligne d'information, les sections de texte de l'auteur,
   « Materials and Methods », « Experiments », « References » — écrits jusqu'ici dans un
   ordre FIXE par la page du projet (components/AppModules/projectDetailModule.jsx).
   Ce format les NOMME, pour que
     • l'ORDRE soit réglable (▲▼ du panneau « Publication format ») → `docOrder` ;
     • l'INTITULÉ d'un bloc qui en porte un soit réglable → `docTitles` : c'est le seul
       texte du document que le programme écrit lui-même (« Materials and Methods »,
       « Experiments », « References ») — jamais celui de l'auteur, qui garde ses
       propres intitulés de sections.
   Un bloc sans intitulé propre (le titre de l'article EST le titre, les auteurs et les
   affiliations sont du texte, la ligne d'information aussi) n'en porte pas : la liste
   le dit (`titled: false`) et le panneau n'affiche alors qu'une explication.
   `fixed: true` = le bloc ne se déplace pas : la liste VIVANTE des références du projet
   est imprimée à la fin du document (elle est rendue hors du texte, pour suivre le
   format courant — voir projectDetailModule.jsx) ; son intitulé, lui, se règle. */
export const PUB_DOC_BLOCKS = [
  { id: 'title', label: 'Title', hint: 'the paper title (or the folder name)' },
  { id: 'authors', label: 'Authors', hint: 'the author line' },
  { id: 'affiliations', label: 'Affiliations', hint: 'the affiliations line' },
  { id: 'meta', label: 'Project line', hint: 'project · scientist · date' },
  /* ── LES DEUX SECTIONS DE TEXTE QUI N'AVAIENT PAS DE RANGÉE ──────────────────
     La demande : « the “Document sections (order & titles)” section should contain
     “scientific background” and “Results and discussion”. As “Material and method” I
     must be able to edit their names. »
     Le contexte et les résultats vivaient dans UN SEUL bloc générique (« Text
     sections »), sous l'intitulé que l'auteur avait écrit : on ne pouvait donc ni les
     déplacer l'un par rapport à l'autre, ni écrire leur intitulé, ni les appeler comme
     le fait le journal choisi (« Introduction » chez Science). Chacune a maintenant SA
     rangée et SON champ, exactement comme « Materials and Methods » — et le bloc
     générique disparaît, parce que PLUS AUCUNE section de texte du projet (voir
     PROJECT_TEXT_SECTIONS, utils/manuscriptImport.js) n'a besoin de lui.
     `title` = l'intitulé que la page du projet écrit aujourd'hui (le libellé de la
     section) : le champ du panneau le remplace, ↺ le rend, donc un document imprimé
     avant cette version ne change pas d'un caractère tant que rien n'est réglé. */
  { id: 'background', label: 'Scientific background', titled: true, title: 'Scientific background', section: 'background' },
  { id: 'discussion', label: 'Results and discussion', titled: true, title: 'Results and Discussion', section: 'discussion' },
  /* ── LES TROIS SECTIONS DE FIN D'ARTICLE ─────────────────────────────────────
     « Conclusions », « Funding » et « Supporting information » s'imprimaient DANS le
     bloc « Text sections » : elles n'avaient donc AUCUNE rangée au panneau — on ne
     pouvait ni les déplacer, ni régler leur intitulé, ni les mettre dans l'ordre d'un
     journal. La demande : « Note that conclusions, funding and supporting informations
     are at present not included in the sections of the publication format and they
     should. » Chacune a donc sa rangée, comme « Materials and Methods ».
     `section` = L'ID DE LA SECTION DE TEXTE DU PROJET qu'elle imprime (voir
     PROJECT_TEXT_SECTIONS, utils/manuscriptImport.js) : c'est ce qui permet à l'intitulé
     choisi ici d'être écrit à la place du titre de la section (voir pubDocTitleKeywords).
     Les cinq sections de texte du projet ont maintenant leur rangée à elles. */
  { id: 'conclusions', label: 'Conclusions', titled: true, title: 'Conclusions', section: 'conclusions' },
  { id: 'funding', label: 'Funding', titled: true, title: 'Funding', section: 'funding' },
  { id: 'supporting', label: 'Supporting information', titled: true, title: 'Supporting information', section: 'supporting' },
  { id: 'methods', label: 'Materials and Methods', titled: true, title: 'Materials and Methods' },
  { id: 'experiments', label: 'Experiments', titled: true, title: 'Experiments' },
  { id: 'references', label: 'References', titled: true, title: 'References', fixed: true }
];
export const PUB_DOC_BLOCK_IDS = PUB_DOC_BLOCKS.map((b) => b.id);
// Les blocs dont le programme écrit l'intitulé, et les blocs qui ne se déplacent pas.
export const PUB_DOC_TITLED_IDS = PUB_DOC_BLOCKS.filter((b) => b.titled).map((b) => b.id);
export const PUB_DOC_FIXED_IDS = PUB_DOC_BLOCKS.filter((b) => b.fixed).map((b) => b.id);
/* Les blocs qui IMPRIMENT une section de texte du projet (`section` = son id). */
export const PUB_DOC_SECTION_BLOCKS = PUB_DOC_BLOCKS.filter((b) => b.section);
export const PUB_DOC_SECTION_IDS = PUB_DOC_SECTION_BLOCKS.map((b) => b.section);
/* LES QUATRE BLOCS DE TÊTE — ceux qui se lisent sur des lignes séparées et que le
   document écrit avec une CLASSE (`pf-title`, `pf-authors`, `pf-affiliations`,
   `pf-meta`), jamais avec un intitulé. Un ordre de journal ne les concerne pas : ils
   restent la tête du document (voir pubDocOrderForWords). */
export const PUB_DOC_HEAD_IDS = ['title', 'authors', 'affiliations', 'meta'];
export const pubDocBlockOf = (id) => PUB_DOC_BLOCKS.find((b) => b.id === id) || null;
/** LA RANGÉE D'UNE SECTION DE TEXTE du projet, ou null : « conclusions » → le bloc
 *  « Conclusions », « background » → « Scientific background », « discussion » →
 *  « Results and discussion ». Les cinq sections de PROJECT_TEXT_SECTIONS en ont une. */
export const pubDocBlockOfSection = (sectionId) => {
  const key = String(sectionId || '');
  return PUB_DOC_SECTION_BLOCKS.find((b) => b.section === key) || null;
};

/** L'ordre du programme : celui que la page du projet a toujours suivi. */
export const buildPubDocOrder = () => PUB_DOC_BLOCK_IDS.slice();

/* LES BLOCS QU'UNE VERSION A RETIRÉS, ET CE QUI LES REMPLACE. « sections » (le bloc
   générique « Text sections ») portait le contexte et les résultats : depuis que ces
   deux sections ont leur rangée (background · discussion), il n'a plus rien à porter.
   Un ordre ENREGISTRÉ AVANT ce changement le nomme encore : ses deux remplaçantes
   prennent donc sa place, au lieu d'être renvoyées à la fin du document — le contexte
   et les résultats restent là où l'utilisateur les avait mis. */
const RETIRED_DOC_BLOCKS = { sections: ['background', 'discussion'] };

/** Un ordre relu d'un enregistrement (localStorage, document d'un autre poste, copie
 *  d'un projet) : seuls les blocs CONNUS et sans doublon passent, un bloc RETIRÉ est
 *  remplacé par ce qui en descend (voir RETIRED_DOC_BLOCKS), et tout bloc que l'ordre
 *  oublie est REMIS À SA PLACE du programme — un format écrit avant cette version (ou à
 *  la main) ne peut donc ni faire disparaître une section, ni l'envoyer au bout du
 *  document. */
export const normalizePubDocOrder = (raw) => {
  const out = [];
  const push = (id) => { if (PUB_DOC_BLOCK_IDS.includes(id) && !out.includes(id)) out.push(id); };
  (Array.isArray(raw) ? raw : []).forEach((id) => {
    const key = String(id || '');
    const replaced = RETIRED_DOC_BLOCKS[key];
    if (replaced) { replaced.forEach(push); return; }
    push(key);
  });
  PUB_DOC_BLOCK_IDS.forEach(push);
  return out;
};

/** Les intitulés du programme, tels qu'ils sont écrits aujourd'hui. */
export const buildPubDocTitles = () => {
  const out = {};
  PUB_DOC_BLOCKS.forEach((b) => { if (b.titled) out[b.id] = b.title; });
  return out;
};

/** Les intitulés relus : du TEXTE, jamais du HTML (`<` et `>` sont retirés — un titre
 *  de section ne peut pas apporter de balise au document), coupé à 120 caractères. Une
 *  chaîne vide = « l'intitulé du programme » (voir pubDocTitleOf). */
export const normalizePubDocTitles = (raw) => {
  const out = buildPubDocTitles();
  if (!raw || typeof raw !== 'object') return out;
  PUB_DOC_TITLED_IDS.forEach((id) => {
    const v = raw[id];
    if (typeof v === 'string') out[id] = v.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  });
  return out;
};

/* ══ LES INTITULÉS QUE LE DOCUMENT NE DOIT PAS ÉCRIRE ═════════════════════════════
   La demande : « If in the style of science references have no title then the title
   tick must be unchecked in the “References (citation & bibliography)” section. »

   Un style peut donc dire qu'une de ses sections N'A PAS d'intitulé : Science imprime
   sa bibliographie sans son titre, la liste suit le texte. La case du panneau se lit
   sur cette liste (`docNoTitle`), et le document écrit alors le bloc SANS son `<h2>` :
   il garde son texte, ses figures et sa place (voir pubDocTitleKeywords, qui envoie un
   titre VIDE à reorderDocHtml, et le titre vide de reorderDocHtml, qui retire le
   `<h2>` sans toucher au reste).

   Seuls les blocs dont le PROGRAMME écrit l'intitulé (PUB_DOC_TITLED_IDS) peuvent entrer
   ici : le titre de l'article EST le titre, les auteurs, les affiliations et la ligne
   d'information sont du texte — ils n'ont pas d'intitulé qui se décoche. Une liste vide
   (le cas de tous les formats neufs) = « le programme écrit ses intitulés ». */
export const buildPubDocNoTitle = () => [];

/** La liste relue d'un enregistrement (localStorage, document d'un autre poste, copie
 *  d'un projet) : seuls les blocs CONNUS passent, sans doublon. Un format écrit avant
 *  cette version n'en porte pas — la liste vide veut dire « aucun intitulé caché », donc
 *  le document s'imprime comme avant. */
export const normalizePubDocNoTitle = (raw) => {
  const out = [];
  (Array.isArray(raw) ? raw : []).forEach((id) => {
    const key = String(id || '');
    if (PUB_DOC_TITLED_IDS.includes(key) && !out.includes(key)) out.push(key);
  });
  return out;
};

/** CET INTITULÉ EST-IL CACHÉ pour ce format ? (une case décochée au panneau, ou un style
 *  qui n'écrit pas ce titre — voir normalizePubDocNoTitle). */
export const pubDocTitleHidden = (fmt, id) => normalizePubDocNoTitle(fmt && fmt.docNoTitle).includes(String(id || ''));

/** L'intitulé que le document écrit pour un bloc : celui choisi par l'utilisateur, ou
 *  celui du programme quand il est vide (ou quand le bloc n'en porte pas). */
export const pubDocTitleOf = (titles, id) => {
  const block = pubDocBlockOf(id);
  if (!block || !block.titled) return '';
  const own = titles && typeof titles === 'object' ? titles[id] : '';
  const text = typeof own === 'string' ? own.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim() : '';
  return text || block.title;
};

/** Un bloc déplacé d'un cran (▲▼ du panneau). Un bloc FIXE ne bouge pas, un cran hors
 *  de la liste ne fait rien : l'ordre rendu est toujours l'ordre normalisé. */
export const pubDocOrderMoved = (order, id, dir) => {
  const list = normalizePubDocOrder(order);
  if (PUB_DOC_FIXED_IDS.includes(id)) return list;
  const i = list.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const tmp = list[i];
  list[i] = list[j];
  list[j] = tmp;
  return list;
};

/** Un bloc déplacé PAR GLISSER-DÉPOSER (le panneau n'a plus de ▲▼) : le bloc `id`
 *  PREND LA PLACE du bloc `targetId` — il se pose à son index, les autres se
 *  décalent d'un cran (glisser « a » sur « b » dans [a, b, c] donne [b, a, c]).
 *  Un bloc FIXE ne se prend pas et ne se vise pas (la liste vivante des références
 *  reste en dernier) ; un geste sur soi-même, ou une cible inconnue, ne change rien. */
export const pubDocOrderDropped = (order, id, targetId) => {
  const list = normalizePubDocOrder(order);
  if (!id || !targetId || id === targetId) return list;
  if (PUB_DOC_FIXED_IDS.includes(id) || PUB_DOC_FIXED_IDS.includes(targetId)) return list;
  const from = list.indexOf(id);
  const to = list.indexOf(targetId);
  if (from < 0 || to < 0) return list;
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  return list;
};

/* Les mots avec lesquels un DOCUMENT écrit nomme les blocs dont le programme écrit
   l'intitulé : « Materials and Methods » se lit « Methods » chez Nature, et un
   manuscrit importé peut l'avoir écrit « Experimental part » · « Experimental
   procedures ». Ce sont ces mots que reorderDocHtml reconnaît (voir son troisième
   argument), donc ceux qui doivent porter le titre choisi par l'utilisateur. */
/* LES MOTS DONT UN DOCUMENT NOMME CHAQUE BLOC — un seul vocabulaire pour trois
   usages : RECONNAÎTRE un bloc dans un document déjà écrit (`reorderDocHtml`, par le
   texte de son `<h2>`), ÉCRIRE l'intitulé choisi sur ce bloc (pubDocTitleKeywords), et
   TRADUIRE l'ordre d'un journal (pubDocOrderForWords — les revues parlent en mots,
   « materials and methods », « experimental section », « conclusion »…).
   Chaque liste commence par le mot que le programme écrit lui-même ; les suivants sont
   les synonymes qu'un manuscrit importé ou une revue emploient. */
export const PUB_DOC_BLOCK_WORDS = {
  conclusions: ['conclusions', 'conclusion', 'concluding remarks', 'perspectives'],
  funding: ['funding', 'funding statement', 'acknowledgements', 'acknowledgments', 'financial support'],
  supporting: ['supporting information', 'supplementary information', 'supporting material', 'supplementary material', 'supplementary data'],
  methods: ['materials and methods', 'methods', 'experimental section', 'experimental part', 'experimental procedures'],
  experiments: ['experiments'],
  references: ['references', 'bibliography'],
  /* LE CONTEXTE ET LES RÉSULTATS du projet — les deux sections qui viennent d'avoir
     leur rangée (voir PUB_DOC_BLOCKS). Leurs mots servent aux TROIS usages du
     vocabulaire : RECONNAÎTRE la section dans un document venu d'ailleurs
     (« Introduction », « Background » : un manuscrit importé l'écrit ainsi), ÉCRIRE
     l'intitulé choisi sur elle, et SAVOIR OÙ UN JOURNAL LA MET — c'est ce qui empêche
     « materials and methods » de passer devant l'introduction, qu'aucune revue ne fait.
     Le mot d'un journal devient l'intitulé : « introduction » → la rangée « Scientific
     background » s'appelle alors « Introduction » (voir pubDocTitlesForWords). C'est la
     demande, mot pour mot : « if in the journal science the scientific background is
     called introduction, this must change in the “Document sections (order & titles)”
     section. »
     « abstract » n'appartient à AUCUN bloc : un résumé n'est pas une section du document
     (le programme n'en imprime pas), donc un journal qui le nomme ne déplace rien et ne
     renomme rien — l'ordre des autres n'en dépend pas moins (voir pubDocOrderForWords). */
  background: ['scientific background', 'introduction', 'background'],
  discussion: ['results and discussion', 'results', 'discussion']
};
const DOC_TITLE_KEYWORDS = Object.keys(PUB_DOC_BLOCK_WORDS).map((id) => [id, PUB_DOC_BLOCK_WORDS[id]]);

/** LE BLOC qu'un mot de journal désigne, ou '' : le premier bloc dont la liste de mots
 *  contient exactement ce mot (voir PUB_DOC_BLOCK_WORDS). « experimental section » →
 *  « methods », « conclusion » → « conclusions », « introduction » → « background »,
 *  « abstract » → '' (aucun bloc : un résumé n'est pas une section du document). */
export const docBlockOfWord = (word) => {
  const w = String(word == null ? '' : word).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!w) return '';
  return Object.keys(PUB_DOC_BLOCK_WORDS).find((id) => PUB_DOC_BLOCK_WORDS[id].includes(w)) || '';
};

/** LES TITRES CHOISIS, PRÊTS POUR `reorderDocHtml(html, order, titles)` : mot du
 *  document → titre à lire. Un intitulé laissé au programme n'y est PAS (le document
 *  écrit déjà le sien) : seuls les titres VRAIMENT choisis se propagent au texte déjà
 *  écrit — un document figé avant le changement de nom suit donc le nouveau titre. */
export const pubDocTitleKeywords = (fmt) => {
  const titles = normalizePubDocTitles(fmt && fmt.docTitles);
  const hidden = normalizePubDocNoTitle(fmt && fmt.docNoTitle);
  const out = {};
  DOC_TITLE_KEYWORDS.forEach(([id, words]) => {
    const block = pubDocBlockOf(id);
    if (!block || !block.titled) return;
    /* UN INTITULÉ QUE LE FORMAT NE VEUT PAS : le bloc sort SANS son `<h2>` (le titre
       vide est le signal — voir reorderDocHtml). C'est ainsi qu'une bibliographie sans
       intitulé se lit : « in the style of science references have no title ». */
    if (hidden.includes(id)) { words.forEach((w) => { out[w] = ''; }); return; }
    const text = pubDocTitleOf(titles, id);
    if (!text || text.toLowerCase() === String(block.title).toLowerCase()) return;
    words.forEach((w) => { out[w] = text; });
  });
  return out;
};

/* Les quatre blocs de TÊTE — le titre, les auteurs, les affiliations, la ligne
   d'information — n'ont pas d'INTITULÉ : le document les écrit avec une CLASSE que le
   programme pose lui-même (`pf-title`, `pf-authors`, `pf-affiliations`, `pf-meta` —
   les mêmes classes que met en forme pubLayoutCss, voir PUB_LAYOUT_PARTS). C'est donc
   la CLASSE, et non un mot du texte, qui les fait reconnaître par `reorderDocHtml`,
   qui les déplace comme les autres blocs. Sans cela, quatre des huit rangées du
   panneau — dont « mettre l'auteur avant le titre », l'exemple de la demande
   d'origine, mot pour mot : « I want to be able for example to put the author before
   the title » — ne changeaient RIEN à un document déjà enregistré, ni à ce qui
   s'imprime à partir de lui. */
const DOC_CLASS_KEYWORDS = [
  ['title', 'pf-title'],
  ['authors', 'pf-authors'],
  ['affiliations', 'pf-affiliations'],
  ['meta', 'pf-meta']
];

/* Les SECTIONS DE TEXTE du projet (voir PROJECT_TEXT_SECTIONS) telles que l'appelant
   les donne : leur id et leur intitulé quand il les connaît (la page du projet), ou
   leur seul intitulé (un appelant qui n'a que les libellés — le panneau, un test). */
const sectionEntriesOf = (sections) => (Array.isArray(sections) ? sections : []).map((s) => (
  s && typeof s === 'object'
    ? { id: String(s.id || ''), label: String(s.label || '') }
    : { id: '', label: String(s == null ? '' : s) }
));

/** Cette section a-t-elle SA RANGÉE au panneau ? Par son id quand l'appelant le
 *  connaît, sinon par son intitulé — les rangées des trois sections dédiées portent
 *  exactement l'intitulé de la section qu'elles impriment (voir PUB_DOC_SECTION_BLOCKS). */
const sectionHasOwnBlock = (entry) => (entry.id
  ? !!pubDocBlockOfSection(entry.id)
  : !!PUB_DOC_SECTION_BLOCKS.find((b) => String(b.title).toLowerCase() === entry.label.toLowerCase()));

/** L'ORDRE CHOISI, TRADUIT DANS LES MOTS QUE LE DOCUMENT ÉCRIT — le vocabulaire
 *  qu'attend `reorderDocHtml(html, order, titles)`.
 *
 *  L'ordre du panneau parle en BLOCS (`docOrder` : « methods », « experiments »,
 *  « sections », « references »…), le document se lit en INTITULÉS de `<h2>`
 *  (« Materials and Methods », « Experiments », « Results and Discussion »…) et, pour
 *  les blocs de tête, en CLASSES (`pf-title`…) : cette fonction passe de l'un à
 *  l'autre, DANS L'ORDRE CHOISI, et c'est ce vocabulaire qui fait suivre au document
 *  la place que l'utilisateur a donnée à chaque bloc — sur la page du projet comme
 *  dans un document déjà enregistré et à l'impression. La demande, mot pour mot :
 *  « In the publication format even if I change the order of the sections they do not
 *  affect the document in the project. »
 *
 *  `sections` (facultatif) = LES INTITULÉS DES SECTIONS DE TEXTE du projet
 *  (« Scientific background », « Results and Discussion »…), que la page du projet
 *  connaît : le bloc « sections » se déplace donc avec eux, et deux sections du
 *  même genre gardent l'ordre de l'auteur. Un bloc de tête ne pèse sur ce vocabulaire
 *  que par sa CLASSE : deux sections du même genre gardent leur ordre, et un titre,
 *  des auteurs ou une ligne d'information ne peuvent pas être pris pour une section.
 */
export const pubDocOrderKeywords = (order, sections) => {
  const out = [];
  const push = (word) => {
    const k = String(word == null ? '' : word).toLowerCase().replace(/\s+/g, ' ').trim();
    if (k && !out.includes(k)) out.push(k);
  };
  const sectionEntries = sectionEntriesOf(sections);
  normalizePubDocOrder(order).forEach((id) => {
    if (id === 'sections') {
      /* LE BLOC GÉNÉRIQUE NE PORTE QUE LES SECTIONS SANS RANGÉE À ELLES : le contexte
         et les résultats (les trois autres — conclusions, financement, informations
         supplémentaires — sont des blocs à part entière depuis qu'elles ont leur
         rangée ; les pousser ici les placerait DEUX fois dans le vocabulaire). */
      sectionEntries.filter((s) => !sectionHasOwnBlock(s)).forEach((s) => push(s.label));
      return;
    }
    const block = pubDocBlockOf(id);
    if (block && block.section) {
      /* LA SECTION QUE CE BLOC IMPRIME, par son intitulé : c'est le mot que la page du
         projet écrit dans le `<h2>`, donc celui qu'un document enregistré porte. Ses
         synonymes suivent, plus bas (`DOC_TITLE_KEYWORDS`) : un manuscrit importé peut
         l'avoir titrée « Conclusion » ou « Acknowledgements ». */
      const own = sectionEntries.find((s) => (s.id
        ? s.id === block.section
        : s.label.toLowerCase() === String(block.title).toLowerCase()));
      if (own) push(own.label);
    }
    const hit = DOC_TITLE_KEYWORDS.find(([bid]) => bid === id);
    if (hit) hit[1].forEach(push);
    const cls = DOC_CLASS_KEYWORDS.find(([bid]) => bid === id);
    if (cls) push(cls[1]);
  });
  return out;
};

/* ── L'ORDRE DES SECTIONS QU'UN JOURNAL DEMANDE ──────────────────────────────
   La demande : « when I select the journal preset, all the elements of the publication
   format must adapt to it, including the order of the sections. »

   Les revues parlent en MOTS (`JOURNAL_FORMATS[id].order` : « abstract »,
   « introduction », « materials and methods », « experimental section »,
   « conclusion », « references »…) et le document en BLOCS. `docBlockOfWord` traduit
   les mots (voir PUB_DOC_BLOCK_WORDS), et l'ordre obtenu s'écrit dans le format
   (`docOrder`) : le panneau le MONTRE donc, et l'utilisateur peut le régler ensuite.

   LA RÈGLE, choisie pour ne jamais détruire un document :
     • les blocs que le journal NOMME prennent la séquence qu'il donne ;
     • ils le font DANS LES PLACES que l'ordre courant leur donne — un bloc que le
       journal ne nomme pas ne bouge pas d'une rangée (c'est exactement ce que
       `reorderDocHtml` fait à un document : « un bloc que le journal ne nomme pas ne
       bouge pas et fait d'ancre »). Concrètement : les rangées des blocs nommés sont
       réordonnées ENTRE ELLES, les autres restent où elles sont ;
     • la TÊTE (titre, auteurs, affiliations, ligne d'information) n'appartient jamais à
       un ordre de sections : elle reste la tête du document (voir PUB_DOC_HEAD_IDS) ;
     • moins de deux blocs nommés : l'ordre courant est rendu INTACT. */
export const pubDocOrderForWords = (words, currentOrder) => {
  const order = normalizePubDocOrder(currentOrder);
  const rank = new Map();
  (Array.isArray(words) ? words : []).forEach((word) => {
    const id = docBlockOfWord(word);
    if (!id || rank.has(id) || PUB_DOC_HEAD_IDS.includes(id)) return;
    rank.set(id, rank.size);
  });
  if (rank.size < 2) return order;
  const slots = [];
  order.forEach((id, i) => { if (rank.has(id)) slots.push(i); });
  if (slots.length < 2) return order;
  const sorted = slots.map((i) => order[i]).sort((a, b) => rank.get(a) - rank.get(b));
  const out = order.slice();
  slots.forEach((slot, k) => { out[slot] = sorted[k]; });
  return out;
};

/** LES INTITULÉS QU'UN JOURNAL IMPOSE — ceux des mots par lesquels il nomme un bloc :
 *  Angewandte écrit « experimental section » là où le programme écrit « Materials and
 *  Methods », RSC « experimental », Cell « conclusion ». Le mot du journal devient
 *  l'intitulé du bloc (première lettre de chaque mot en majuscule, la façon dont les
 *  revues les impriment), et un mot qui est DÉJÀ l'intitulé du programme ne change rien
 *  (« materials and methods » → « Materials and Methods », intact). */
const titleCase = (s) => String(s || '').split(/\s+/).filter(Boolean)
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export const pubDocTitlesForWords = (words, currentTitles) => {
  const titles = normalizePubDocTitles(currentTitles);
  (Array.isArray(words) ? words : []).forEach((word) => {
    const id = docBlockOfWord(word);
    const block = pubDocBlockOf(id);
    if (!block || !block.titled) return;
    const wanted = titleCase(word);
    if (wanted.toLowerCase() === String(block.title).toLowerCase()) return;   // le mot du programme
    if (titles[id] && titles[id].toLowerCase() !== String(block.title).toLowerCase()) return; // un choix de l'utilisateur
    titles[id] = wanted;
  });
  return titles;
};

/** Un réglage vierge : aucun style imposé, le document s'affiche comme avant.
 *  `bold` / `italic` / `underline` sont à TROIS états — `null` = laissé tel
 *  quel, `true` = imposé, `false` = explicitement retiré (utile pour un titre,
 *  que le programme écrit en gras). */
export const emptyPubTextStyle = () => ({
  font: '', size: 0, align: '', bold: null, italic: null, underline: null, color: ''
});

/** Les réglages d'un format neuf : une entrée vierge par partie du document. */
export const buildPubLayout = () => {
  const out = {};
  PUB_LAYOUT_PARTS.forEach((part) => {
    out[part.id] = { ...emptyPubTextStyle(), ...(part.width ? { width: 100 } : {}) };
  });
  return out;
};

/* Les valeurs d'un format enregistré (localStorage, document d'un autre poste,
   copie d'un projet) sont NETTOYÉES avant de devenir une feuille de style :
   seule une valeur connue passe. Une police ne peut pas apporter de CSS (ni
   « ; », ni « { »), une taille reste entre 4 et 96 pt, une couleur est un code
   #rrggbb, un alignement est dans la liste, un style est vrai / faux / non
   touché, une largeur reste entre 10 et 100 %. */
const cleanPubFont = (v) => String(v || '').replace(/[^\w\s,"'.-]/g, '').trim().slice(0, 120);
const cleanPubSize = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 4 && n <= 96 ? Math.round(n * 10) / 10 : 0;
};
const cleanPubAlign = (v) => (PUB_ALIGNMENT_IDS.includes(v) ? v : '');
const cleanPubColor = (v) => {
  const s = String(v || '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(s) ? s : '';
};
const cleanPubTri = (v) => {
  if (v === true || v === false) return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
};
const cleanPubWidth = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 10 && n <= 100 ? Math.round(n) : 100;
};

const cleanPubTextStyle = (raw, { width = false } = {}) => {
  const st = raw && typeof raw === 'object' ? raw : {};
  return {
    font: cleanPubFont(st.font),
    size: cleanPubSize(st.size),
    align: cleanPubAlign(st.align),
    bold: cleanPubTri(st.bold),
    italic: cleanPubTri(st.italic),
    underline: cleanPubTri(st.underline),
    color: cleanPubColor(st.color),
    ...(width ? { width: cleanPubWidth(st.width) } : {})
  };
};

/** La mise en forme d'un format, telle qu'elle est relue d'un enregistrement :
 *  chaque partie connue est gardée, tout le reste est ignoré. Un format sans
 *  mise en forme (enregistré avant cette version) donne les réglages vierges —
 *  le document d'un projet ne change donc pas tout seul. */
export const normalizePubLayout = (raw) => {
  const out = buildPubLayout();
  PUB_LAYOUT_PARTS.forEach((part) => {
    out[part.id] = cleanPubTextStyle(raw && raw[part.id], { width: !!part.width });
  });
  return out;
};

/** Cette partie a-t-elle un réglage ? (badge « ✎ » du panneau, tests). */
export const pubTextStyleIsSet = (style) => !!style && (
  !!style.font || Number(style.size) > 0 || !!style.align
  || style.bold !== null || style.italic !== null || style.underline !== null
  || !!style.color || (Number(style.width) > 0 && Number(style.width) !== 100)
);

const cssTri = (value, on, off) => {
  if (value === true) return `${on} !important;`;
  if (value === false) return `${off} !important;`;
  return '';
};

/** Les déclarations d'une partie : chaque réglage CHOISI devient une règle,
 *  `!important` compris — le choix de l'utilisateur doit passer devant la
 *  feuille du programme et devant le style en ligne d'une figure importée d'un
 *  .docx. Un réglage vide n'écrit rien du tout. */
const pubTextStyleCss = (style) => {
  const st = style || {};
  const out = [];
  if (st.font) out.push(`font-family: ${st.font} !important;`);
  if (Number(st.size) > 0) out.push(`font-size: ${Number(st.size)}pt !important;`);
  if (st.align) out.push(`text-align: ${st.align} !important;`);
  const b = cssTri(st.bold, 'font-weight: 700', 'font-weight: 400');
  if (b) out.push(b);
  const i = cssTri(st.italic, 'font-style: italic', 'font-style: normal');
  if (i) out.push(i);
  const u = cssTri(st.underline, 'text-decoration: underline', 'text-decoration: none');
  if (u) out.push(u);
  if (st.color) out.push(`color: ${st.color} !important;`);
  return out.join(' ');
};

/**
 * LA FEUILLE DE STYLE DU DOCUMENT D'UN PROJET, écrite d'après le « Publication
 * format ». Rien n'est écrit pour un format sans mise en forme : la feuille est
 * alors VIDE et le document s'affiche exactement comme avant.
 *
 * Toutes les règles sont portées par le conteneur du document
 * (`#project-doc-container`) : elles valent donc pour le document affiché, pour
 * le document FIGÉ (le texte enregistré, rendu dans le même conteneur) et pour
 * la page imprimée de l'export, qui remet ce même conteneur (voir
 * projectDetailModule). Les parties du document y sont repérées par les classes
 * `.pf-…` que le programme pose lui-même, et par leur balise en repli.
 *
 * @param {object} fmt    le « Publication format » (project.pubFormat ou défaut)
 * @param {string} [scope] sélecteur du conteneur (défaut #project-doc-container)
 * @returns {string} le CSS (chaîne vide quand rien n'a été choisi)
 */
export const pubLayoutCss = (fmt, scope = '#project-doc-container') => {
  const layout = normalizePubLayout(fmt && fmt.layout);
  const rules = [];
  const rule = (selectors, body) => {
    if (!body) return;
    const list = (selectors || []).filter(Boolean).map((s) => `${scope} ${s}`).join(', ');
    if (list) rules.push(`${list} { ${body} }`);
  };
  PUB_LAYOUT_PARTS.forEach((part) => {
    const st = layout[part.id];
    if (part.id === 'figure') {
      /* LA FIGURE : l'alignement va au cadre (la figure se place à gauche, au
         centre…), la largeur à l'IMAGE — et tout le reste à la LÉGENDE, le seul
         texte d'une figure. */
      if (st.align) rule(part.selectors, `text-align: ${st.align} !important;`);
      if (Number(st.width) > 0 && Number(st.width) !== 100) {
        rule([...(part.selectors || []), ...(part.caption || [])].map((s) => `${s} img`),
          `width: ${Number(st.width)}% !important;`);
      }
      rule(part.caption, pubTextStyleCss(st));
      return;
    }
    rule(part.selectors, pubTextStyleCss(st));
  });
  return rules.join('\n');
};

/* `format.scientistStyles` = { "Rossi M": "underline" | "bold" | "none" } :
   unknown names/values coming from localStorage or a project document are
   dropped here, and the name is trimmed so it matches the user list. */
export const sanitizeScientistStyles = (raw) => {
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    Object.keys(raw).forEach((name) => {
      const key = String(name || '').trim();
      if (key && AUTHOR_STYLE_IDS.includes(raw[name])) out[key] = raw[name];
    });
  }
  return out;
};

export const buildPubFormat = (presetId) => {
  const preset = PUB_FORMAT_PRESETS[presetId] || PUB_FORMAT_PRESETS.nature;
  return {
    preset: presetId,
    etAlLimit: 0,                   // after how many authors to truncate with "et al." (0 = never)
    alwaysShowScientists: false,    // keep the lab scientists (user list) even past the cutoff
    underlineScientists: false,     // legacy: underline EVERY lab scientist (see scientistStyles)
    scientistStyles: {},            // per lab member: 'none' | 'underline' | 'bold'
    inTextStyle: 'keep',            // in-text citation form (see IN_TEXT_STYLES)
    /* LA FORME DES NOMS D'AUTEURS (voir utils/authorNames.js) : « asis » = le
       nom tel qu'il a été importé — le comportement d'avant ce choix, donc un
       format qui n'a jamais rien décidé ne change pas. Un format de JOURNAL, lui,
       en porte une (voir components/journalFormats.js), et le panneau la montre. */
    nameStyle: 'asis',
    layout: buildPubLayout(),       // font / size / align / style / colour of each part (see pubLayoutCss)
    docOrder: buildPubDocOrder(),   // the blocks of the project document, in the order they print (see PUB_DOC_BLOCKS)
    docTitles: buildPubDocTitles(), // the headings the PROGRAM writes for them (« Materials and Methods » → the user's name)
    docNoTitle: buildPubDocNoTitle(), // the headings the format does NOT want (« Science » prints no title over its reference list)
    fields: preset.defs.map((def, i) => ({
      id: def[0], enabled: true, order: i, style: def[1], prefix: def[2], suffix: def[3]
    }))
  };
};

/* A stored format (localStorage or a project document) can predate the
   per-scientist styles: normalize it once instead of guessing at render time. */
export const normalizePubFormat = (parsed) => {
  const n = parseInt(parsed && parsed.etAlLimit, 10);
  return {
    preset: (parsed && parsed.preset) || 'custom',
    /* LE NOM DU STYLE ENREGISTRÉ dont ce format vient (le groupe « User defined » de la
       liste, voir loadPubStyles) : il voyage avec le format pour que la liste sache
       lequel est actif, et il disparaît dès qu'un autre choix est fait (un journal). */
    style: normalizePubStyleName(parsed && parsed.style),
    etAlLimit: Number.isFinite(n) && n >= 0 ? n : 0,
    alwaysShowScientists: !!(parsed && parsed.alwaysShowScientists),
    underlineScientists: !!(parsed && parsed.underlineScientists),
    scientistStyles: sanitizeScientistStyles(parsed && parsed.scientistStyles),
    inTextStyle: normalizeInTextStyle(parsed && parsed.inTextStyle),
    /* Un format enregistré avant que ce choix existe n'a pas de `nameStyle` :
       « asis » — ses citations sortent donc exactement comme avant. */
    nameStyle: normalizeNameStyle(parsed && parsed.nameStyle),
    layout: normalizePubLayout(parsed && parsed.layout),
    docOrder: normalizePubDocOrder(parsed && parsed.docOrder),
    docTitles: normalizePubDocTitles(parsed && parsed.docTitles),
    docNoTitle: normalizePubDocNoTitle(parsed && parsed.docNoTitle),
    fields: (parsed && parsed.fields) || buildPubFormat('nature').fields
  };
};

export const loadPubFormat = () => {
  try {
    const raw = localStorage.getItem(PUB_FORMAT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.fields)) return normalizePubFormat(parsed);
    }
  } catch { /* ignore malformed */ }
  return buildPubFormat('nature');
};

/* ── LES STYLES QUE L'UTILISATEUR SAUVEGARDE (« Custom », à rappeler) ─────────
   La demande : « when I click on custom I will be able to define other styles that I
   must be able to save and recall. »

   Un STYLE est un FORMAT ENTIER mis de côté sous un nom : citation et bibliographie,
   caractère de chaque partie du document, ordre ET intitulés des sections, forme des
   renvois dans le texte, styles des noms du laboratoire. Son nom apparaît dans la liste
   « Journal preset », sous le groupe « User defined » ; le choisir REMET tout le format
   d'un coup, et 💾 le réécrit — sauver sous un AUTRE nom ajoute une entrée de plus, à
   côté des autres (la demande : « I must be able to save new settings with a different
   name and this name must appear in the drop-down menu under a subsection: user
   defined »). Ils vivent dans `labWorkspace_pubStyles` : le préfixe « lab » les fait
   partir sur le Drive avec le reste (utils/workspaceKeyStore.js) — ils suivent donc
   d'un poste à l'autre et survivent à un navigateur vidé, comme le format lui-même. */
export const PUB_STYLES_KEY = 'labWorkspace_pubStyles';
export const PUB_STYLE_NAME_MAX = 40;

/** Un nom de style NETTOYÉ : du texte, jamais du HTML, jamais un nom vide. */
export const normalizePubStyleName = (name) => String(name == null ? '' : name)
  .replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, PUB_STYLE_NAME_MAX);

/** Les styles relus d'un enregistrement : `{ nom: format }`, chaque format nettoyé
 *  (`normalizePubFormat`) et marqué de son nom (`style`), les entrées abîmées ou sans
 *  liste de champs IGNORÉES — un style qui ne rappellerait rien n'a pas à être proposé. */
export const normalizePubStyles = (raw) => {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  Object.keys(src).forEach((key) => {
    const name = normalizePubStyleName(key);
    const fmt = src[key];
    if (!name || !fmt || typeof fmt !== 'object' || Array.isArray(fmt)) return;
    if (!Array.isArray(fmt.fields)) return;
    out[name] = { ...normalizePubFormat(fmt), style: name };
  });
  return out;
};

export const loadPubStyles = () => {
  try {
    const raw = localStorage.getItem(PUB_STYLES_KEY);
    return raw ? normalizePubStyles(JSON.parse(raw)) : {};
  } catch { return {}; }
};

/** Écrire la liste (best-effort, comme le format : un quota plein ne casse rien). */
export const writePubStyles = (styles) => {
  const clean = normalizePubStyles(styles);
  try { localStorage.setItem(PUB_STYLES_KEY, JSON.stringify(clean)); } catch { /* quota */ }
  return clean;
};

/** SAUVEGARDER un format sous un nom — le format est nettoyé et marqué du nom, pour que
 *  la liste sache lequel est actif. Un nom déjà pris est REMPLACÉ (c'est ce que
 *  l'utilisateur demande en le tapant à nouveau) ; un nom NOUVEAU ajoute une entrée de
 *  plus dans le groupe « User defined ». Rend la liste complète. */
export const savePubStyle = (name, format) => {
  const key = normalizePubStyleName(name);
  if (!key) return loadPubStyles();
  const styles = loadPubStyles();
  styles[key] = { ...normalizePubFormat(format), style: key };
  return writePubStyles(styles);
};

/** OUBLIER un style (le nom ne doit plus rien rappeler). Rend la liste restante. */
export const removePubStyle = (name) => {
  const key = normalizePubStyleName(name);
  const styles = loadPubStyles();
  if (key && styles[key]) delete styles[key];
  return writePubStyles(styles);
};

export const pubFieldValue = (pub, id) => {
  switch (id) {
    case 'authors': return pub.authors || '';
    case 'year': return pub.year || '';
    case 'title': return pub.title || '';
    case 'journal': return pub.journal || '';
    case 'volume': return pub.volume || '';
    case 'pages': return pub.pages || '';
    case 'doi': return pub.doi || '';
    default: return '';
  }
};

// Build the link to the paper page from a raw DOI value. Accepts a bare DOI
// ("10.xxxx/…") or a value that is already a full http(s) URL.
export const pubDoiUrl = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return `https://doi.org/${s}`;
};

/* ── Retrouver la publication d’origine d’une entrée enregistrée ──────────
   Une entrée de bibliographie de projet (ou une référence numérotée d’un
   document) est une COPIE du papier : elle ne stockait autrefois que son titre
   et le nom du titulaire du projet, si bien que la citation ne montrait aucun
   co-auteur. Les champs sont désormais recopiés à l’import, et pour les entrées
   plus anciennes la publication d’origine est retrouvée ici, par identifiant
   (`sourceId`, posé par les références numérotées), par DOI, par identifiant
   PubMed, ou enfin par titre — c’est ce que fait `pubCitationData` avant chaque
   rendu. */

/** Titre normalisé pour rapprocher deux entrées (casse, ponctuation, espaces). */
const pubTitleKey = (s) => String(s || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

/** DOI contenu dans une valeur : « 10.1000/xyz », « https://doi.org/10.1000/xyz »
 *  ou n’importe quel lien qui le porte (doi.org / éditeur / PubMed Central). */
export const pubDoiKey = (value) => {
  const m = String(value || '').match(/10\.\d{4,9}\/[^\s"'<>()]+/);
  return m ? m[0].toLowerCase().replace(/[.,;:]+$/, '') : '';
};

/** Identifiant PubMed contenu dans une valeur : numéro nu ou lien
 *  « pubmed.ncbi.nlm.nih.gov/12345678 ». */
export const pubPmidKey = (value) => {
  const s = String(value || '').trim();
  const m = s.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i) || s.match(/^(\d{5,9})$/);
  return m ? m[1] : '';
};

/* Les identifiants d’une entrée NE vivent PAS toujours dans le même champ : une
   entrée de bibliographie garde son DOI dans `doi` (copié de la publication) ou
   dans `link`, une publication importée dans `doi` ou dans `links[].url`. Ces
   deux lecteurs cherchent donc partout, dans le même ordre. */
const pubFirstOf = (entry, keys, reader) => {
  const sources = [entry && entry[keys[0]], entry && entry[keys[1]]];
  (((entry && entry.links) || [])).forEach((l) => sources.push(l && l.url));
  const found = sources.map(reader).find(Boolean);
  return found || '';
};

const pubDoiOf = (entry) => pubFirstOf(entry, ['doi', 'link'], pubDoiKey);
const pubPmidOf = (entry) => pubFirstOf(entry, ['pmid', 'link'], pubPmidKey);

/** Publication d’origine d’une entrée : par `sourceId`, sinon par DOI, sinon par
 *  identifiant PubMed, sinon par titre exact. Le DOI et le PMID sont décisifs
 *  quand les titres diffèrent (titre retouché à la main, preprint puis version
 *  publiée) : l’entrée montre alors enfin la liste complète des auteurs. */
export const pubOriginOf = (entry, pubs = []) => {
  const list = Array.isArray(pubs) ? pubs : [];
  if (!entry || !list.length) return null;
  if (entry.sourceId) {
    const byId = list.find((p) => p && p.id === entry.sourceId);
    if (byId) return byId;
  }
  const doi = pubDoiOf(entry);
  if (doi) {
    const byDoi = list.find((p) => p && pubDoiOf(p) === doi);
    if (byDoi) return byDoi;
  }
  const pmid = pubPmidOf(entry);
  if (pmid) {
    const byPmid = list.find((p) => p && pubPmidOf(p) === pmid);
    if (byPmid) return byPmid;
  }
  const key = pubTitleKey(entry.title);
  if (!key) return null;
  return list.find((p) => p && pubTitleKey(p.title) === key) || null;
};

/** Données de citation d’une entrée de bibliographie / référence : ses propres
 *  champs, complétés par ceux de la publication d’origine. Les valeurs de
 *  l’entrée gagnent toujours (une correction manuelle n’est jamais écrasée) ;
 *  `authors` en particulier redevient la liste COMPLÈTE des auteurs du papier,
 *  co-auteurs du laboratoire et auteurs extérieurs compris. */
export const pubCitationData = (entry, pubs = []) => {
  const own = entry || {};
  const origin = pubOriginOf(own, pubs) || {};
  const pick = (id) => own[id] || origin[id] || '';
  return {
    authors: pick('authors'),
    year: pick('year'),
    title: pick('title'),
    journal: pick('journal'),
    volume: pick('volume'),
    pages: pick('pages'),
    doi: pick('doi')
  };
};

const pubWrap = (val, style) => {
  if (style === 'bold') return `<b>${val}</b>`;
  if (style === 'italic') return `<i>${val}</i>`;
  if (style === 'underline') return `<u>${val}</u>`;
  if (style === 'bolditalic') return `<b><i>${val}</i></b>`;
  return val;
};

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]));

/* Co-author matching: given a raw authors string and a list of candidate names,
   return the candidates that appear among the authors (so shared papers are
   found when filtering by any user of the app).
   TWO conventions coexist in the app: « Rossi M » (the lab user list, PubMed)
   and « Marco Rossi » (Crossref / OpenAlex / ORCID, which give full names).
   The surname is therefore located first (a trailing token of 3+ letters, else
   a leading one), then the given names are checked — written out in both names,
   or as the initial of a short author token: « Rossi M » ↔ « Marco Rossi »
   matches, « Rossi M » ↔ « Rossi L » and « Marco Rossi » ↔ « Michele Rossi »
   do not. */
export const authorMatchesCandidate = (author, candidate) => {
  const tok = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const split = (s) => String(s || '').split(/[\s,]+/).map(tok).filter(Boolean);
  const cToks = split(candidate);
  const aToks = split(author);
  if (!cToks.length || !aToks.length) return false;

  // 1. Same name written the same way (case / punctuation may vary).
  const full = tok(candidate);
  if (full && tok(author).includes(full)) return true;

  // 2. Surname first, then the given names (see the rule above).
  const last = cToks[cToks.length - 1];
  const surname = last.length >= 3 ? last : (cToks[0].length >= 3 ? cToks[0] : '');
  if (!surname || !aToks.includes(surname)) return false;
  const given = cToks.filter((t) => t !== surname);
  return given.every((g) => aToks.some((t) =>
    t === g                                // same spelling on both sides
    || (g.length <= 2 && t.startsWith(g))  // initial ↔ the author's given name
    || (t.length <= 2 && g.startsWith(t)))); // given name ↔ the author's initial
};

export const matchCoauthors = (authorStr, candidates, excludeName) => {
  const out = [];
  const authors = String(authorStr || '').split(',').map((s) => s.trim()).filter(Boolean);
  const surnameOf = (n) => String(n || '').trim().split(/[\s,]+/).pop()?.toLowerCase().replace(/[^a-z]/g, '') || '';
  const exSurname = surnameOf(excludeName);
  for (const cand of candidates || []) {
    const c = String(cand).trim();
    if (!c || c === excludeName) continue;
    // Same surname as the owner ⇒ same person (e.g. "Maria Ramos" vs "Ramos")
    if (exSurname && surnameOf(c) === exSurname) continue;
    if (authors.some((a) => authorMatchesCandidate(a, c))) out.push(c);
  }
  return out;
};

// Split a raw authors string (“Rossi M, Bianchi A and Smith J, et al.”) into a
// clean list of author names, dropping any existing “et al.” marker, WITHOUT
// cutting a name in two: “Smith, John A.” is ONE author (see
// utils/authorNames.js, splitAuthorNames — la seule règle de l'application).
const parseAuthorList = (raw) => splitAuthorNames(raw);

// Which lab member (name of the user list) is this author, if any? The matched
// name is returned so it can be looked up in the format's `scientistStyles`.
export const labMemberOf = (author, scientists) => {
  const list = Array.isArray(scientists) ? scientists : [];
  for (const s of list) {
    if (s && authorMatchesCandidate(author, s)) return String(s).trim();
  }
  return '';
};

export const isLabAuthor = (author, scientists) => !!labMemberOf(author, scientists);

// Effective style of a lab member's name — this helper is only asked about
// scientists that ARE lab members (the panel lists them): the explicit
// per-scientist choice wins, the legacy « underline every lab scientist » flag
// is only a default. Use authorStyleOf() for an author coming from a paper: it
// checks the user list first and never styles anybody else.
export const scientistStyleOf = (name, fmt) => {
  const key = String(name || '').trim();
  const explicit = fmt && fmt.scientistStyles ? fmt.scientistStyles[key] : undefined;
  if (AUTHOR_STYLE_IDS.includes(explicit)) return explicit;
  return fmt && fmt.underlineScientists ? 'underline' : 'none';
};

export const authorStyleOf = (author, fmt, scientists) => {
  const member = labMemberOf(author, scientists);
  return member ? scientistStyleOf(member, fmt) : 'none';
};

const wrapAuthor = (escaped, style) => {
  if (style === 'underline') return `<u>${escaped}</u>`;
  if (style === 'bold') return `<b>${escaped}</b>`;
  return escaped;
};

// Build the author-name section of a citation, honouring the format's
// “et al.” cutoff, the “always show the lab scientists” option, the
// per-scientist styles (underline / bold) AND the WRITING of the names
// (`nameStyle`, voir utils/authorNames.js) : la forme de l'écriture est une
// décision du format, donc deux listes venues de deux revues différentes
// s'écrivent ici de la même façon. Returns { html, text }. Every author of the
// paper is listed — only the cutoff can shorten the list.
export const renderAuthorNames = (pub, fmt, scientists) => {
  const authors = parseAuthorList(pub.authors);
  if (authors.length === 0) return null;
  const limit = fmt.etAlLimit > 0 ? fmt.etAlLimit : null;
  let shown = authors;
  let etAl = false;
  if (limit && authors.length > limit) {
    const rest = authors.slice(limit);
    // Lab scientists past the cutoff are kept (in their original order),
    // everything else is replaced by "et al."
    const forced = fmt.alwaysShowScientists ? rest.filter((a) => isLabAuthor(a, scientists)) : [];
    shown = [...authors.slice(0, limit), ...forced];
    etAl = true;
  }
  /* Le style du nom (underline / bold) est cherché sur le nom TEL QU'IL A ÉTÉ
     ENREGISTRÉ — c'est lui qui reconnaît le membre du laboratoire —, la FORME
     écrite, elle, suit le format. */
  const nameStyle = normalizeNameStyle(fmt && fmt.nameStyle);
  const html = shown
    .map((a) => wrapAuthor(escapeHtml(formatAuthorName(a, nameStyle)), authorStyleOf(a, fmt, scientists)))
    .join(', ') + (etAl ? ', et al.' : '');
  const text = shown.map((a) => formatAuthorName(a, nameStyle)).join(', ') + (etAl ? ', et al.' : '');
  return { html, text };
};

export const pubCitationHtml = (pub, fmt, scientists) => {
  const ordered = [...fmt.fields].sort((a, b) => a.order - b.order).filter((f) => f.enabled);
  const parts = [];
  ordered.forEach((f) => {
    if (f.id === 'authors') {
      const names = renderAuthorNames(pub, fmt, scientists);
      if (!names) return;
      parts.push(`${f.prefix || ''}${pubWrap(names.html, f.style)}${f.suffix || ''}`);
      return;
    }
    const val = pubFieldValue(pub, f.id);
    if (!val) return;
    if (f.id === 'doi') {
      // The DOI is always a link to the paper page. When linkText is set
      // (e.g. the literal word "doi"), show that instead of the DOI value.
      const href = pubDoiUrl(val);
      const link = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="pub-doi-link">`;
      if (f.linkText) {
        // "doi" label option: render just the linked word, ignoring prefix/suffix
        parts.push(pubWrap(`${link}${escapeHtml(f.linkText)}</a>`, f.style));
      } else {
        // Wrap the whole field (prefix + value + suffix) in the link
        const display = `${escapeHtml(f.prefix || '')}${escapeHtml(val)}${escapeHtml(f.suffix || '')}`;
        parts.push(pubWrap(`${link}${display}</a>`, f.style));
      }
      return;
    }
    parts.push(`${f.prefix || ''}${pubWrap(val, f.style)}${f.suffix || ''}`);
  });
  return parts.join(' ');
};

// Plain-text citation (exports, clipboard): the per-scientist styles only exist
// in the HTML flavour, the author list itself is identical.
export const pubCitationText = (pub, fmt, scientists) => {
  const ordered = [...fmt.fields].sort((a, b) => a.order - b.order).filter((f) => f.enabled);
  const parts = [];
  ordered.forEach((f) => {
    if (f.id === 'authors') {
      const names = renderAuthorNames(pub, fmt, scientists);
      if (!names) return;
      parts.push(`${f.prefix || ''}${names.text}${f.suffix || ''}`);
      return;
    }
    const val = pubFieldValue(pub, f.id);
    if (!val) return;
    if (f.id === 'doi') {
      if (f.linkText) {
        // "doi" label option: render just the word, ignoring prefix/suffix
        parts.push(f.linkText);
      } else {
        parts.push(`${f.prefix || ''}${val}${f.suffix || ''}`);
      }
      return;
    }
    parts.push(`${f.prefix || ''}${val}${f.suffix || ''}`);
  });
  return parts.join(' ');
};
