/* =========================================================================
   src/utils/manuscriptImport.js
   Transférer un MANUSCRIT écrit ailleurs (Google Docs exporté en .docx ou en
   page Web .html, fichier Word, texte copié) DANS un projet du programme :

     1. le TEXTE est découpé en sections par ses titres (« Introduction »,
        « Discussion », « Conclusions », « Funding », « Supporting information »…)
        et chaque section rejoint la section correspondante de la page projet
        (Scientific background / Discussion / Conclusions / Funding / Supporting
        information) — en ajout ou en remplacement, au choix ;
     2. son EN-TÊTE (titre, liste des auteurs, affiliations) est reconnu même
        quand le document commence par un DOI, une date, le nom du fichier
        exporté ou le type d'article, et quand les auteurs occupent plusieurs
        lignes : ces trois champs vont dans « 🧾 Title, authors & affiliations »
        (voir parseManuscriptHeader / headerFromLineRoles) ;
     3. la BIBLIOGRAPHIE de fin de document (« References » / « Bibliography »,
        telle que Paperpile l'écrit) est analysée par referenceImport et ses
        entrées rejoignent la « Project bibliography » du projet — donc aussi
        Publications → « Project bibliography » ;
     4. les CITATIONS dans le texte ([12], [3,4], [5-7], (12) du style EndNote/
        Word, l'EXPOSANT ¹² ou <sup>12</sup>, et (Rossi et al., 2018),
        (Smith & Bianchi 2020)) deviennent les références NUMÉROTÉES du
        programme ([1], [2]…) : c'est exactement ce que fait « 📚 + Reference »
        à la main (project.references + marqueur [n]). Un renvoi en exposant d'un
        .docx est repéré SUR LE XML (`w:vertAlign`) : la mise en forme est sinon
        perdue par la lecture du texte, et le renvoi arrivait en nombre nu —
        indiscernable d'un « 12 » ordinaire, donc jamais lié (voir
        markDocxSuperscriptCitations). C'est ensuite utils/referenceLinks.js qui
        transforme chaque marqueur du texte en LIEN vers sa référence (ancre
        #ref-n du document exporté).
     5. les FIGURES du document ne se perdent plus : elles rejoignent les
        figures de LEUR section sur la page projet (la liste dans laquelle
        « 📤 Insert into project… » de l'Image Builder range les compositions,
        et que le document exporté imprime). Elles n'entrent PAS dans le texte
        de la section — elles y resteraient figées et partiraient dans tous les
        exports : chaque figure garde à la place l'ANCRE du paragraphe qui la
        précédait et le document exporté la remet à cet endroit
        (utils/figurePlacement.js) ;
     6. le TEXTE écrit dans une section est fait de PARAGRAPHES (`<p>…</p>`,
        voir htmlFromManuscriptPart) : un HTML dont les lignes ne sont séparées
        que par des « \n » s'affiche COLLÉ dans le navigateur (les sauts de
        ligne y sont avalés) et empêchait l'ancre d'une figure de retrouver son
        paragraphe — les figures finissaient toutes à la fin de la section.

   Tout est ICI en fonctions PURES (testables hors navigateur) ; la page projet
   ne fait que lire le fichier, afficher l'aperçu et appliquer ce qui a été coché.
   Aucune dépendance nouvelle : un .docx est un ZIP dont le texte vit dans
   word/document.xml (fflate, déjà utilisé par referenceImport).
   ========================================================================= */

import {
  normalizeText, htmlToText, paragraphTextFromDocxXml,
  parseReferences, entryKeys, mergeReferenceEntries, projectBibEntry
} from './referenceImport';
import { unzipSync, strFromU8 } from 'fflate';

/** Extensions acceptées par le champ de fichier de l'interface. */
export const MANUSCRIPT_FILE_ACCEPT = '.docx,.html,.htm,.txt,.md';

/* ── 1. Le texte → une suite de BLOCS (une ligne = un paragraphe ou un titre) ─ */

/* ── L'EN-TÊTE d'un manuscrit : titre, auteurs, affiliations ─────────────────
   Un article commence par son titre, la liste de ses auteurs et leurs
   affiliations. Ces lignes ressemblent à des titres (courtes, capitalisées…)
   mais elles ne DÉCOUPENT pas le document : prises pour des sections, elles
   disparaissaient de l'import et le titre se retrouvait noyé dans la première
   partie. Les reconnaître sert à deux choses :
     • `isHeadingLine` refuse de les appeler « section » ;
     • `parseManuscriptHeader` les range dans les champs Title / Authors /
       Affiliations du projet (voir la page projet, section « 🧾 Title, authors
       & affiliations »). */

/* Les exposants Unicode : les chiffres (« ¹²³ ») et les lettres a–h d'un
   marqueur d'affiliation Wiley / Springer (« ᵃᵇʰ »). Ce sont les caractères que
   superscriptAffilMark ÉCRIT — la lecture doit savoir les relire (voir
   SUP_MARK_CLASS ci-dessous). */
const SUP_LETTERS = { a: '\u1d43', b: '\u1d47', c: '\u1d9c', d: '\u1d48', e: '\u1d49', f: '\u1da0', g: '\u1d4d', h: '\u02b0' };
const SUP_DIGIT_CHARS = '\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079';

/* Un marqueur d'affiliation écrit en EXPOSANT UNICODE — « Mario Rossi¹ »,
   « Anna Bianchi¹,² », « Jean Dupontᵃ ». C'est l'écriture d'un PDF, d'un texte
   collé d'un Google Docs, ou de la liste d'auteurs que le programme écrit
   LUI-MÊME (voir superscriptAffilMark, qui produit exactement ces caractères :
   la lecture doit savoir les relire). Sans cette classe, aucun des trois
   lecteurs d'en-tête ne reconnaissait « Mario Rossi¹, Anna Bianchi¹², Jean
   Dupont² » : la liste d'auteurs restait hors du champ « Authors », les
   affiliations qui la suivaient étaient perdues avec elle, et le tout
   retombait dans la première section du projet (signalé par l'utilisateur :
   « la liste des auteurs, juste après le titre et avant les affiliations,
   n'est toujours pas reconnue »). */
const SUP_MARK_CLASS = `${SUP_DIGIT_CHARS}${Object.values(SUP_LETTERS).join('')}`;

/** Marqueur d'affiliation en tête de ligne : « 1 … », « 1Dipartimento… » (un
 *  exposant COLLÉ par l'export Google Docs / Word), « * … », « a) … »,
 *  « ¹ Dipartimento… » (exposant Unicode). */
export const AFFILIATION_MARK_RE = new RegExp([
  '^\\s*\\d{1,2}[.)\\]]?\\s*\\S',                 // « 1 » / « 1. » / « 1Dipartimento… »
  /* « [1] Dipartimento… » : l'exposant d'un .docx devient « [1] » avant la
     lecture du texte (voir markDocxSuperscriptCitations) — le marqueur
     d'affiliation doit donc être reconnu dans cette écriture aussi. */
  '^\\s*\\[\\s*\\d{1,2}\\s*\\](?:\\s*[,;&-]\\s*\\d{1,2}\\s*\\]*)?\\s*\\S',
  '^\\s*(?:[a-e]|[ivx]{1,4})[.)\\]]\\s*\\S',      // « a) » / « a. » / « iv) »
  '^\\s*(?:[a-e]|[ivx]{1,4})\\s+(?=\\p{Lu})',     // « a Dipartimento »
  '^\\s*[*\\u2020\\u2021\\u00a7\\u00b6]\\s*\\S',    // « * » / « † » / « ‡ » / « § »
  /* « ¹ Dipartimento… » : le MÊME exposant, écrit en UNICODE (un PDF, un texte
     collé d'un Google Docs, une liste d'auteurs recopiée du projet). */
  '^\\s*[' + SUP_MARK_CLASS + ']+\\s*\\S'
].join('|'), 'iu');

/** Une adresse e-mail dans une ligne : c'est TOUJOURS l'auteur correspondant
 *  (« Correspondence: mario.rossi@unina.it », « E-mail: … »), donc une ligne
 *  d'AFFILIATION — jamais une métadonnée à jeter. Elle est rangée à la FIN des
 *  affiliations (voir headerFromLineRoles) : c'est là qu'un article l'imprime. */
export const EMAIL_IN_LINE_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;

/** Métadonnées d'un article — jamais un titre, jamais une section, jamais une
 *  affiliation : DOI, dates de soumission, adresse de correspondance, mots-clés,
 *  type d'article, nom du fichier exporté (« … - Google Docs »)… Les ignorer est
 *  ce qui permet de trouver le VRAI titre quand le document commence par eux. */
export const HEADER_META_RE = new RegExp([
  '^\\s*(?:https?://|www\\.)',
  '^\\s*10\\.\\d{4,9}/',
  '^\\s*doi\\s*[:=]',
  '^\\s*(?:received|accepted|published|revised|submitted|available online|first published)\\b',
  '^\\s*(?:correspondence|corresponding author|e-?mail|contact)\\b',
  '^\\s*\\S+@\\S+\\.\\S+',                        // une adresse seule
  '^\\s*(?:key ?words?|abbreviations?|running (?:head|title)|author contributions?'
    + '|conflicts? of interest|competing interests?|data availability|ethics statement'
    + '|consent|editor|edited by|reviewed by|article type|type of article'
    + '|original (?:article|research)|research article|review article|short communication'
    + '|brief communication|technical note|case report|editorial|perspective|commentary|preprint)\\b',
  '^\\s*(?:copyright|\\u00a9|all rights reserved|issn|isbn)\\b',
  '^\\s*[Jj]ournal\\s',
  '^\\s*(?:document\\d*|untitled|without title|sans titre|manuscript\\d*|draft\\d*|brouillon\\d*)\\b',
  '(?:-|\\u2013)\\s*Google (?:Docs|Drive)\\s*$',
  '^\\s*(?:supplementary|supporting) (?:movie|video|file)\\b'
].join('|'), 'i');

/** Mots qui trahissent une affiliation (institution, laboratoire, adresse). */
export const AFFILIATION_WORDS_RE = /(?:universit|university|dipartimento|department|d[ée]partement|dipartimenti|laborator|laboratoire|faculty|facolt|school of|college|academy|research (?:group|unit|centre|center|institute)|institut|institute|hospital|umr\b|cnrs\b|cnr\b|inserm\b|inrae\b|csic\b|max planck|campus|p\.?o\.? box)/i;

/** Pays / code postal : la fin typique d'une adresse d'affiliation. */
export const AFFILIATION_PLACE_RE = /\b(?:italy|france|germany|spain|portugal|netherlands|belgium|switzerland|austria|denmark|sweden|norway|poland|greece|united kingdom|england|scotland|ireland|\busa\b|\bcanada\b|\bbrazil\b|\bchina\b|\bjapan\b|\bindia\b|\baustralia\b)\b|\b\d{5}\b/i;

/** LA LONGUEUR MAXIMALE D'UNE LIGNE D'AUTEURS. Elle était plafonnée à 300
 *  caractères (400 pour la lecture par marqueurs) : au-delà, un consortium
 *  entier — dix-huit noms et leurs exposants — n'était reconnu par AUCUN
 *  lecteur, et la ligne, jugée « paragraphe de corps de texte », n'entrait même
 *  pas dans la fenêtre de l'en-tête : le champ « Authors » restait vide alors
 *  que les auteurs sont exactement à leur place, entre le titre et les
 *  affiliations (défaut signalé : « la lista degli autori non viene
 *  riconosciuta »). Les lecteurs, eux, ne se relâchent pas — chaque morceau doit
 *  rester un NOM — donc allonger la limite n'ouvre pas la porte à un paragraphe
 *  de corps de texte. */
const AUTHOR_LINE_MAX = 800;

/** Une ligne d'affiliation : un mot d'institution (université, laboratoire…,
 *  souvent signalée par « 1 », « * »…) ou une adresse postale. Le nom d'un pays
 *  ne suffit PAS : « … infecting pepper crops in Italy » est un titre. */
export const looksLikeAffiliationLine = (line) => {
  const s = String(line || '').trim();
  if (!s || s.length > 400) return false;
  if (/^(?:https?:|www\.|doi:|10\.\d)/i.test(s)) return false;
  const marked = AFFILIATION_MARK_RE.test(s);
  const commas = s.split(',').length;
  if (AFFILIATION_WORDS_RE.test(s)) return marked || commas >= 2 || s.length >= 30;
  if (AFFILIATION_PLACE_RE.test(s)) return (marked || s.length <= 120) && commas >= 2;
  return false;
};

/* Un marqueur d'affiliation, tel qu'un éditeur l'écrit APRÈS un nom :
     « Rossi1 », « Rossi 1,2 »     exposant numérique (Nature, Cell…) ;
     « Rossi a », « Rossi b,* »    Wiley / Springer : une LETTRE, et l'astérisque
                                   de l'auteur correspondant ;
     « Rossi* », « Rossi† »        auteur correspondant ;
     « Rossi[1] », « Rossi[1,2] »  l'exposant d'un .docx, que l'import transforme
                                   en « [1] » avant de lire le texte.
   Une LETTRE n'est un marqueur que si elle est SEULE (« a », « B ») : « Rossia »
   ou « Mario » ne se coupent jamais. C'est ce qui manquait : une liste d'auteurs
   écrite « Mario Rossi a, Anna Bianchi b » (Elsevier / Springer) n'était pas
   reconnue du tout — les auteurs restaient hors du champ « Authors » alors que
   le titre, lui, était trouvé (demande utilisateur : « l'en-tête est ENTRE le
   titre et les affiliations »). */
const AFFIL_MARK = '(?:(?<![\\p{L}\\u2019])[A-H](?![\\p{L}\\u2019])|(?<![\\p{L}\\u2019])[a-h](?![\\p{L}\\u2019])|\\d{1,2}|[*\\u2020\\u2021\\u00a7\\u00b6]'
  + `|[${SUP_MARK_CLASS}]+)`;
/* LE SÉPARATEUR entre deux marqueurs du même nom : « Rossi¹,² », « Rossi1,2 »,
   « Rossi 1-2 », « Rossi1/2 », « Rossi¹·² » (le point médian d'un PDF),
   « Rossi*† » (auteur correspondant ET affiliation). Il manquait : une liste
   d'auteurs écrite « Mario Rossi¹·², Anna Bianchi² » n'était reconnue par AUCUN
   lecteur d'en-tête — les auteurs restaient hors du champ « Authors » alors
   qu'ils étaient bien entre le titre et les affiliations (le défaut signalé par
   l'utilisateur : « la lista degli autori », qui est entre les deux). */
const AFFIL_MARK_SEP = '[,;&*/\\u2020\\u2021\\u00a7\\u00b6\\u00b7-]';
const AFFIL_MARK_BRACKETED = `(?:\\[\\s*${AFFIL_MARK}(?:\\s*${AFFIL_MARK_SEP}\\s*${AFFIL_MARK})*\\s*\\]|\\(\\s*${AFFIL_MARK}(?:\\s*${AFFIL_MARK_SEP}\\s*${AFFIL_MARK})*\\s*\\))`;
/* Un marqueur d'affiliation COLLÉ au nom (ou séparé par UNE espace) : « Rossi1 »,
   « Rossi¹ », « Rossi* », « Rossi[1] », « Rossi 1 ». C'est la marque qui dit
   « ce nombre est le numéro de mon laboratoire » — jamais un renvoi de citation
   (voir isAuthorMarkLine, relu par utils/referenceLinks.js). */
const AFFIL_MARK_IN_LINE_RE = new RegExp(
  `\\p{L}\\s?(?:\\d{1,2}|[*\\u2020\\u2021\\u00a7\\u00b6]|[${SUP_MARK_CLASS}]+|\\[\\s*\\d{1,2})`, 'u');
/* Le même marqueur, mais SANS les lettres MAJUSCULES : « Rossi B » est une
   écriture d'auteur (nom + initiale), jamais un marqueur à retirer — au
   contraire de « Rossi b », « Rossi1 », « Rossi[2] », « Rossi (3) ». */
const AFFIL_MARK_TAIL_RE = new RegExp(
  `(?:\\s*${AFFIL_MARK_SEP}?\\s*(?:${AFFIL_MARK_BRACKETED}|\\d{1,2}|[*\\u2020\\u2021\\u00a7\\u00b6]|(?<![\\p{L}\\u2019])[a-h](?![\\p{L}\\u2019])`
  + `|[${SUP_MARK_CLASS}]+))+\\s*$`, 'u');

/** Un MORCEAU de nom, débarrassé de ses marqueurs d'affiliation :
 *  « Rossi b,* » → « Rossi », « Anna Bianchi (2) » → « Anna Bianchi »,
 *  « Jean Dupont[3] » → « Jean Dupont ». Les marqueurs sont les NUMÉROS de
 *  laboratoire du document : ils n'ont rien à faire dans une liste de noms (et
 *  un « [1] » resté collé à un nom se lit comme un renvoi de citation — ce que
 *  l'utilisateur refuse dans l'en-tête). Les initiales sont intactes :
 *  « Rossi B, Bianchi A » ne bouge pas. */
export const stripAffilMarks = (part) => {
  let s = String(part || '').trim();
  for (let i = 0; i < 6; i += 1) {
    const next = s.replace(AFFIL_MARK_TAIL_RE, '').trim();
    if (next === s) break;
    s = next;
  }
  return s;
};

/** Un marqueur d'affiliation écrit en EXPOSANT : « 1,2 » → « ¹,² », « [3] » →
 *  « ³ », « a » → « ᵃ », « * » → « * » (les crochets et parenthèses du document
 *  disparaissent : un « [1] » collé à un nom se lirait comme un renvoi de
 *  citation). Les caractères produits sont relus par SUP_MARK_CLASS (voir plus
 *  haut). */
export const superscriptAffilMark = (mark) => String(mark || '')
  .replace(/[()[\]{}]/g, '')
  .replace(/\d/g, (d) => SUP_DIGIT_CHARS[Number(d)])
  .replace(/[a-h]/g, (c) => SUP_LETTERS[c] || c);

/** Le marqueur d'affiliation de la FIN d'un morceau de nom, écrit en exposant :
 *  « Mario Rossi 1,2 » → « Mario Rossi ¹,² », « Anna Bianchi [1,2] » →
 *  « Anna Bianchi ¹,² », « Jean Dupont b » → « Jean Dupont ᵇ ». Les initiales
 *  (« Rossi M », « Rossi B ») ne bougent jamais : un marqueur n'est fait que de
 *  chiffres, de symboles ou d'une lettre MINUSCULE seule (voir
 *  AFFIL_MARK_TAIL_RE). */
export const superscriptAffilMarkTail = (part) => {
  let s = String(part || '').trim();
  for (let i = 0; i < 6; i += 1) {
    const m = AFFIL_MARK_TAIL_RE.exec(s);
    if (!m) break;
    const next = `${s.slice(0, m.index)}${superscriptAffilMark(m[0].trim())}`.trim().replace(/\s{2,}/g, ' ');
    if (next === s) break;
    s = next;
  }
  return s;
};



/* Un morceau de nom : « Rossi », « Mario Rossi1 », « Dupont1,2 », « Bianchi a »,
   « A. » — jamais une phrase (« plant viruses » ne passe pas : minuscule
   initiale). Les chiffres/symboles/lettres qui suivent sont les exposants
   d'affiliation et peuvent se suivre (« 1,2 ») ou se cumuler (« 1* » = 
   affiliation + auteur correspondant). */
const NAME_PART_RE = new RegExp(
  `^[\\p{Lu}][\\p{L}'\\u2019.-]*(?:\\s+(?:[\\p{Lu}]|[\\p{Lu}][\\p{L}'\\u2019.-]*))?\\.?`
  + `\\s*(?:(?:${AFFIL_MARK_BRACKETED}|${AFFIL_MARK})+(?:\\s*${AFFIL_MARK_SEP}\\s*(?:${AFFIL_MARK_BRACKETED}|${AFFIL_MARK})+)*)?$`, 'u');

/** Un exposant tout seul : le « 2 » de « Dupont1,2 » (deux affiliations), en
 *  chiffres ASCII (« 1,2 ») comme en EXPOSANTS Unicode (« Rossi¹,² » — la
 *  virgule du document coupe la marque en deux morceaux, qui se recollent). */
const EXPONENT_ONLY_RE = new RegExp(`^(?:\\d{1,2}|[*\\u2020\\u2021]|[${SUP_MARK_CLASS}]+)+$`, 'u');

/** Un marqueur collé au bout d'un nom déjà lu (« …Rossi b » puis « ,* »). */
const MARK_TAIL_IN_NAME_RE = new RegExp(`(?:\\d|[*\\u2020\\u2021]|[a-h](?![\\p{L}])|[${SUP_MARK_CLASS}])$`, 'u');

/** Un intitulé de section n'est JAMAIS un nom de personne, même en position
 *  d'auteur : « Materials and Methods » suit parfois le titre de très près. */
const SECTION_WORD_RE = /^(?:abstract|introduction|background|materials?|methods?|results?|discussion|conclusions?|acknowledg\w*|funding|references?|bibliography|supplementary|supporting|appendix|keywords?|author contributions?|conflicts? of interest|data availability|figures?|tables?|legends?|highlights)\b/i;

/** Les morceaux d'une liste de noms, exposants recollés : dans
 *  « Bianchi1,2, Rossi, M. » le « 2 » qui suit la virgule est la SECONDE
 *  affiliation du même auteur, pas un auteur ; « et al. » n'est pas un nom. */
export const authorLineParts = (line) => {
  /* Les marqueurs entre CROCHETS et PARENTHÈSES sont OUVERTS AVANT le
     découpage : sans cela « Anna Bianchi[1,2] » se coupait en deux morceaux
     (« Anna Bianchi[1 » et « 2] ») et la ligne d'auteurs n'était PAS reconnue —
     c'est pourtant l'écriture d'un .docx, où l'import transforme lui-même
     l'exposant d'affiliation en « [1] » (voir markDocxSuperscriptCitations). */
  const cleaned = String(line || '').trim()
    /* Le SYMBOLE qui suit un marqueur (« Rossi[1,2]* » : l'auteur
       correspondant) est emporté AVEC lui : sinon l'astérisque restait seul et
       devenait un auteur à part entière. */
    .replace(/\[\s*([^[\]]{1,20}?)\s*\]\s*([*\u2020\u2021\u00a7\u00b6]?)/g, ' $1$2 ')
    .replace(/\s*[;,]?\s*\bet\s+al\.?\s*$/i, '')
    .replace(/\s*&\s*$/, '')
    .replace(/\(\s*(\d{1,2}(?:\s*,\s*\d{1,2})*)\s*\)\s*([*\u2020\u2021\u00a7\u00b6]?)/g, ' $1$2 '); // « Bianchi (1) » → « Bianchi 1 »
  const merged = [];
  cleaned.split(/\s*(?:,|;|\band\b|&)\s*/i).map((p) => p.trim()).filter(Boolean).forEach((part) => {
    const prev = merged[merged.length - 1];
    /* « Rossi b » puis « ,* » : le second morceau n'est pas un auteur, c'est le
       second marqueur du même nom (auteur correspondant). */
    if (prev && EXPONENT_ONLY_RE.test(part) && MARK_TAIL_IN_NAME_RE.test(prev)) {
      merged[merged.length - 1] = `${prev},${part}`;
      return;
    }
    merged.push(part);
  });
  return merged;
};

/** Une ligne d'AUTEURS prête pour le champ « Authors » du projet : la liste
 *  reste une liste séparée par des virgules et la MISE EN FORME du document est
 *  GARDÉE — les exposants d'affiliation deviennent de vrais exposants
 *  (« Mario Rossi¹, Anna Bianchi¹, Jean Dupont² »), comme dans l'article.
 *  L'utilisateur ne veut pas les perdre (« c'est dommage de perdre la mise en
 *  forme, les exposants de la liste des auteurs ») : ils sont conservés, mais
 *  jamais sous la forme « [1] » d'un renvoi de citation, et les initiales
 *  (« Rossi M, Bianchi A ») ne bougent pas. Les exposants détachés par la
 *  virgule du document (« Rossi 1,2 ») sont recollés au nom (même règle que
 *  authorLineParts) au lieu de devenir un auteur « 2 ». */
export const cleanAuthorLine = (line) => {
  /* Les marqueurs entre CROCHETS et PARENTHÈSES sont ouverts AVANT le découpage
     par virgules : sans cela « Mario Rossi [1,2] » se coupait en deux
     « auteurs » (« Mario Rossi [1 » et « 2] »). */
  const cleaned = String(line || '')
    /* Le SYMBOLE qui suit un marqueur (« Rossi[1,2]* » : l'auteur
       correspondant) est emporté AVEC lui : sinon l'astérisque restait seul et
       devenait un auteur à part entière. */
    .replace(/\[\s*([^\][]{1,20}?)\s*\]\s*([*\u2020\u2021\u00a7\u00b6]?)/g, ' $1$2 ')
    .replace(/\(\s*(\d{1,2}(?:\s*,\s*\d{1,2})*)\s*\)\s*([*\u2020\u2021\u00a7\u00b6]?)/g, ' $1$2 ');
  const merged = [];
  cleaned.split(/\s*(?:,|;|\band\b|&)\s*/i).map((p) => p.trim()).filter(Boolean).forEach((part) => {
    const prev = merged[merged.length - 1];
    /* « Rossi b » puis « ,* » : le second morceau est le SECOND marqueur du même
       auteur, pas un auteur — comme le « 2 » de « Dupont 1,2 ». */
    if (prev && EXPONENT_ONLY_RE.test(part) && MARK_TAIL_IN_NAME_RE.test(prev)) {
      merged[merged.length - 1] = `${prev},${part}`;
      return;
    }
    merged.push(part);
  });
  /* « et al. » est GARDÉ : la liste du document est peut-être tronquée, et le
     lecteur de l'article doit le voir (l'import ne devine pas les auteurs
     manquants). */
  return merged.map((p) => superscriptAffilMarkTail(p)).filter(Boolean).join(', ');
};

/** Une ligne de noms : « Mario Rossi1, Anna Bianchi1, Jean Dupont2 »,
 *  « Bianchi, A., Rossi, M. », « Rossi M, Bianchi A, et al. »,
 *  « Anna Bianchi (1), Mario Rossi (2) ». Sans autre indice il faut un marqueur
 *  d'auteur (initiale pointée, exposant, « et al. ») ou au moins trois noms :
 *  « Materials and Methods » n'est donc jamais prise pour une liste d'auteurs.
 *  `alone` = la ligne est EN POSITION d'auteur (juste sous le titre) : un nom
 *  seul y suffit — c'est le cas « un auteur par ligne ». */
export const looksLikeAuthorLine = (line, { alone = false } = {}) => {
  const s = String(line || '').trim();
  if (!s || s.length > AUTHOR_LINE_MAX) return false;
  if (HEADER_META_RE.test(s) || SECTION_WORD_RE.test(s)) return false;
  const etAl = /\bet\s+al\.?/i.test(s);
  const parts = authorLineParts(s);
  if (!parts.length || !parts.every((p) => NAME_PART_RE.test(p))) return false;
  /* Une phrase se termine par un point ; une LISTE de noms aussi, quand son
     dernier nom est une initiale (« … Dupont, J. »). */
  if (/[;:!?]$/.test(s)) return false;
  if (/\.$/.test(s) && !etAl && !/(?:^|\s)\p{Lu}\.$/u.test(parts[parts.length - 1])) return false;
  if (etAl) return true;
  const initials = /(?:^|[\s,;&])\p{Lu}\.(?:\s|,|;|$|\d)/u.test(s)
    || /\b\p{Lu}\.\s*\p{Lu}\./u.test(s);
  const exponent = /\p{L}\d{1,2}(?=[\s,;&*]|$)/u.test(s) || /[*\u2020\u2021]/u.test(s);
  /* Le marqueur écrit EN EXPOSANT (« Mario Rossi¹, Anna Bianchi² ») ou COLLÉ
     entre crochets (« Rossi[1] », l'écriture d'un .docx juste avant la lecture
     du texte) : c'est la marque d'auteur la plus courante dans un article, et
     sans elle une liste de DEUX noms n'était pas reconnue (défaut signalé :
     « la lista degli autori non viene riconosciuta »). */
  const supMark = new RegExp(`\\p{L}[${SUP_MARK_CLASS}]`, 'u').test(s);
  const gluedBracket = /\p{L}\[\s*\d{1,2}/u.test(s);
  /* « Mario Rossi a, Anna Bianchi b » : le marqueur est une LETTRE (Wiley /
     Springer). Sans cette écriture, la ligne d'auteurs n'était pas reconnue et
     restait hors du champ « Authors ». */
  const letterMark = /(?:^|[\s,;&])\[?\s*[a-h](?:\s*[\]),;&]|\s*$)/u.test(s)
    || /(?:^|[\s,;&])\[\s*\d{1,2}(?:\s*[,;&-]\s*\d{1,2})*\s*\]/u.test(s);
  if (initials || exponent || supMark || gluedBracket || letterMark || parts.length >= 3) return true;
  return !!alone && parts.length >= 1 && s.split(/\s+/).length <= 6;
};

/** Un intitulé de section écrit EN MINUSCULES après son premier mot — « Results
 *  and discussion », « Materials and methods », « Conclusions and
 *  perspectives », « Résultats et discussion » : c'est ainsi qu'un manuscrit les
 *  écrit, et sans cette reconnaissance leur texte se COLLAIT à la partie
 *  précédente (le « Results and discussion » d'un article partait alors avec le
 *  Matériel et méthodes). */
const SECTION_HEADING_FIRST_RE = /^(?:abstract|summary|introduction|background|materials?|methods?|methodology|results?|findings|discussion|conclusions?|concluding remarks|acknowledg\w*|funding|references?|bibliography|supplementary|supporting|appendix|keywords?|perspectives?|outlook|limitations?|r[ée]sum[ée]|mat[ée]riel|m[ée]thodes?|protocole|exp[ée]rimental|r[ée]sultats?)\b/i;

/** …mais une PHRASE qui commence par le même mot n'est pas un intitulé :
 *  « Results were analysed with R. » reste du texte. */
const SECTION_SENTENCE_RE = /^(?:results?|findings|methods?|materials?|conclusions?|discussion|introduction|background)\s+(?:were|was|are|is|show|shows|showed|indicate|indicated|reveal|revealed|suggest|suggested|demonstrate|demonstrated|confirm|confirmed|cannot|can|may|might|must|did|do|does|had|has|have|will|would|remain|remained|come|came|give|gave|differ|differed)\b/i;

/** La PUCE ou le tiret qui précède un intitulé (« • Results », « - Methods »). */
const SECTION_MARK_PREFIX_RE = /^\s*[-–—•*·▪◦]\s*/;

/** Un intitulé de section, prêt à être comparé : numérotation, puce et
 *  ponctuation finale retirées — « I. INTRODUCTION », « 2. Materials and
 *  Methods. », « • Results: » deviennent « INTRODUCTION », « Materials and
 *  Methods », « Results ».
 *
 *  POURQUOI ce nettoyage : un manuscrit écrit ses intitulés AINSI (« I. »,
 *  « 2. », un point final, un deux-points). Sans lui, la ligne échouait à TOUS
 *  les tests de titre — un intitulé ponctué n'était pas un titre, et un
 *  intitulé en majuscules précédé d'un numéro romain passait même pour une
 *  LISTE D'AUTEURS. Son texte se collait alors à la partie précédente et
 *  partait dans la mauvaise section du projet (signalé par l'utilisateur :
 *  « le texte commençant par Materials and Methods n'est pas allé dans
 *  Matériel et méthodes », « l'Introduction n'est pas allée dans Scientific
 *  background »). */
export const sectionHeadingKey = (heading) => headingLabel(heading)
  .replace(SECTION_MARK_PREFIX_RE, '')
  .replace(/[.;:,]+$/, '')
  .replace(/\s+/g, ' ')
  .trim();

/** Le DERNIER mot d'un intitulé ponctué : « Materials and Methods. » finit par
 *  « Methods », « Conclusions. » par « Conclusions » — alors qu'une PHRASE qui
 *  commence comme un intitulé finit par son verbe (« Discussion and conclusions
 *  follow. »). C'est ce qui permet de tolérer la ponctuation finale d'un vrai
 *  intitulé sans prendre la phrase pour un titre. */
const SECTION_TAIL_WORD_RE = /\b(?:abstract|summary|materials?|methods?|methodology|results?|findings|discussion|conclusions?|remarks|introduction|background|funding|acknowledg\w*|references?|bibliography|supplementary|supporting|information|appendix|keywords?|perspectives?|outlook|limitations?|aims?|objectives?|r[eé]sum[eé]|mat[eé]riel|m[eé]thodes?|protocole|exp[eé]rimental|r[eé]sultats?)$/i;

/** La ligne EST-ELLE l'intitulé d'une section (court, reconnu, pas une
 *  phrase) ? « Materials and Methods. » en fait partie, « Materials were
 *  harvested in 2024. » non. */
const isSectionHeadingLine = (s) => {
  const raw = String(s || '').trim();
  const key = sectionHeadingKey(raw);
  if (!key || key.split(' ').length > 4) return false;
  if (!SECTION_HEADING_FIRST_RE.test(key) || SECTION_SENTENCE_RE.test(key)) return false;
  /* Un intitulé PONCTUÉ est accepté (« Materials and Methods. ») — mais il doit
     finir sur un mot d'intitulé, jamais sur un verbe. */
  if (/[.;:,]$/.test(raw) && !SECTION_TAIL_WORD_RE.test(key)) return false;
  return true;
};

/** Un titre est une ligne COURTE, sans ponctuation de fin de phrase, qui
 *  ressemble à un intitulé : « 1. Introduction », « INTRODUCTION »,
 *  « Materials and Methods », « References »… Une phrase comme « Le virus a été
 *  purifié. » n'en est donc pas un.
 *
 *  L'INTITULÉ D'UNE SECTION passe AVANT tout le reste : reconnu par son seul
 *  mot (« Materials and Methods. », « II. MATERIALS AND METHODS », « • Results »),
 *  il est un titre même ponctué ou numéroté — et il n'est jamais pris pour une
 *  liste d'auteurs (une liste de noms ne commence pas par « Materials »). */
export const isHeadingLine = (line) => {
  const s = String(line || '').trim();
  if (!s || s.length > 90) return false;
  /* La ligne d'un MARQUEUR de figure (voir plus bas) n'est jamais un titre :
     sinon l'image de l'article deviendrait un intitulé de section. */
  if (isFigureMark(s)) return false;
  if (isSectionHeadingLine(s)) return true;
  if (/[.;:,]$/.test(s)) return false;
  /* L'en-tête (auteurs, affiliations) n'est JAMAIS une section : sinon il
     disparaît du document importé (voir parseManuscriptHeader). Une liste de
     noms NUS (« Anna Bianchi, Mario Rossi ») en fait partie : sans marqueur,
     elle ressemble à un intitulé, mais ce n'en est pas un — et la prendre pour
     un titre faisait une partie vide (donc perdue) de la ligne. */
  if (looksLikeAuthorLine(s) || looksLikeAuthorList(s) || looksLikeAffiliationLine(s)) return false;
  if (/^(https?:|www\.|doi:|10\.\d)/i.test(s)) return false;
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length > 12) return false;
  const numbered = /^([0-9]+(\.[0-9]+)*|[IVXLC]+)[.)]?\s+\S/.test(s);
  const letters = s.replace(/[^A-Za-zÀ-ÿ]/g, '');
  const allCaps = letters.length > 3 && letters === letters.toUpperCase();
  const titleCase = words.length <= 8 && words.filter((w) => /^[A-ZÀ-Þ]/.test(w)).length >= Math.ceil(words.length / 2);
  return numbered || allCaps || titleCase;
};

/** Un bloc = un paragraphe (ou un titre) du manuscrit.
 *  `htmlByText` (facultatif) porte la MISE EN FORME du document (voir
 *  htmlByTextFromRecords) : chaque paragraphe reçoit alors son `html`, ce qui
 *  permet d'importer l'article sans perdre ses exposants, ses indices, ses
 *  italiques. Le texte reste la référence pour TOUT le reste (titres, citations,
 *  en-tête) : les heuristiques ne lisent jamais le HTML. */
export const blocksFromText = (text, { htmlByText = null } = {}) => {
  const htmlFor = lineHtmlReader(htmlByText);
  return normalizeText(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const block = { kind: isHeadingLine(line) ? 'heading' : 'paragraph', text: line };
      const html = htmlFor(line);
      if (html && html !== escapeHtml(line)) block.html = html;
      return block;
    });
};

/** Titre d'un bloc, débarrassé de sa numérotation : « 2. Discussion » → « Discussion ». */
export const headingLabel = (text) => String(text || '')
  .replace(/^\s*(?:[0-9]+(\.[0-9]+)*|[IVXLC]+)[.)]?\s+/i, '')
  .replace(/^\s*#{1,6}\s*/, '')
  .trim();

/* ── 1 bis. Les FIGURES du document ─────────────────────────────────────────
   Un manuscrit, ce n'est pas que du texte : ses figures arrivent avec lui.
   Deux règles, apprises des aller-retours avec l'utilisateur :

     • elles ne sont PAS écrites dans le texte de la section (elles y
       resteraient figées — plus modifiables, plus déplaçables, et elles
       partiraient dans tous les exports) : elles rejoignent les FIGURES de
       leur section sur la page projet — la liste `project.figures[section]`,
       exactement là où « 📤 Insert into project… » de l'Image Builder range
       les compositions — et la bibliothèque d'images du projet, que l'Image
       Builder affiche ;
     • le document exporté les REMET À LEUR PLACE, dans le texte, grâce à
       l'ANCRE conservée avec chaque figure (le paragraphe qui la précédait) :
       voir utils/figurePlacement.js.

   Comment une figure traverse le texte : chaque image du document devient une
   ligne à part, `[[FIGURE n]]` (n = son rang dans le document, 1, 2, 3…). Cette
   ligne n'est jamais un titre, jamais une citation, et elle est RETIRÉE du
   texte au moment de l'import : rien d'invisible ne reste dans la section. Le
   lecteur place ce marqueur là où l'image se trouvait dans le document, donc la
   figure suit le paragraphe qui la porte et change de section avec lui. */

/** Le marqueur de position d'une figure : `[[FIGURE 3]]`. */
export const figureMark = (n) => `[[FIGURE ${Math.max(1, Math.trunc(Number(n) || 1))}]]`;

const FIGURE_MARK_ONE_RE = /^\s*\[\[\s*figure\s+(\d{1,3})\s*\]\]\s*$/i;

/** La ligne est-elle le marqueur d'une figure (comparaison sur UNE ligne) ? */
export const isFigureMark = (line) => FIGURE_MARK_ONE_RE.test(String(line || ''));

/** Le rang de la figure portée par un marqueur (0 quand ce n'en est pas un). */
export const figureMarkIndex = (line) => {
  const m = FIGURE_MARK_ONE_RE.exec(String(line || ''));
  return m ? Number(m[1]) : 0;
};

/** Les figures MARQUÉES dans un texte, dans l'ordre, chacune avec son ANCRE =
 *  le texte du paragraphe qui la précède (`''` quand la figure ouvre la
 *  partie : elle est alors imprimée après le texte de la section). */
export const figureMarksIn = (text) => {
  const lines = normalizeText(text).split('\n');
  const out = [];
  lines.forEach((line, i) => {
    if (!isFigureMark(line)) return;
    let anchor = '';
    for (let j = i - 1; j >= 0; j -= 1) {
      const t = String(lines[j] || '').trim();
      if (!t || isFigureMark(t)) continue;
      anchor = t;
      break;
    }
    out.push({ index: figureMarkIndex(line), anchor });
  });
  return out;
};

/** Le texte SANS les marqueurs de figure : ce qui est écrit dans la section. */
export const stripFigureMarks = (text) => normalizeText(text)
  .split('\n')
  .filter((line) => !isFigureMark(line))
  .join('\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

/** Une LÉGENDE de figure : « Figure 1. … », « Fig. 2: … », « Figure 3 — … ».
 *  Le séparateur est OBLIGATOIRE : une phrase de corps de texte qui commence
 *  par « Figure 2 shows that… » n'est PAS une légende et reste dans le texte. */
export const FIGURE_LEGEND_RE = /^fig(?:ure)?\.?\s*\d{1,3}\s*[.:\-–—]\s*\S/i;

/** Les lignes d'un document, avec leur HTML quand on le connaît : une entrée de
 *  `records` = un paragraphe (`{ text, html }`, `html` vide = texte simple). */
export const recordsFromText = (text) => normalizeText(text).split('\n').map((line) => ({ text: line, html: '' }));

/** Le texte d'un document ET le HTML de chacune de ses lignes : `htmlByText`
 *  associe un texte de paragraphe au HTML de ses runs (voir docxParagraphHtml),
 *  ce qui permet à l'import d'écrire la mise en forme de l'article dans la
 *  section — gras, italique, exposants, indices. `null` quand le document n'en
 *  a pas (texte collé, .txt, .md). */
export const htmlByTextFromRecords = (records) => {
  const map = new Map();
  const add = (text, html) => {
    if (!text || !html) return;
    if (!map.has(text)) map.set(text, []);
    map.get(text).push(html);
  };
  (Array.isArray(records) ? records : []).forEach((r) => {
    const text = String((r && r.text) || '').trim();
    const html = String((r && r.html) || '').trim();
    if (!text || !html) return;
    /* UN PARAGRAPHE À SAUT DE LIGNE FORCÉ arrive ici avec PLUSIEURS lignes de
       texte (`<w:br>` du .docx → « \n » dans le texte, → « <br> » dans le
       HTML) : les heuristiques d'import, elles, travaillent LIGNE PAR LIGNE
       (voir blocksFromText). Sans cette découpe, la table n'avait pas de clé
       pour ces lignes et leur mise en forme (gras, italique, exposants) était
       perdue. Les deux découpes se correspondent une à une. */
    const lines = text.split('\n').map((l) => l.trim());
    const pieces = html.split(/<br\b[^>]*>/i).map((p) => p.trim());
    if (lines.length > 1 && pieces.length === lines.length) {
      lines.forEach((lineText, i) => add(lineText, pieces[i]));
      return;
    }
    add(text, html);
  });
  return map.size ? map : null;
};

/** Les paragraphes non vides d'un document → son texte + `htmlByText`. */
export const textWithHtmlRecords = (records) => {
  const kept = (Array.isArray(records) ? records : [])
    .map((r) => ({ text: String((r && r.text) || '').trim(), html: String((r && r.html) || '').trim() }))
    .filter((r) => r.text);
  return { text: kept.map((r) => r.text).join('\n\n'), htmlByText: htmlByTextFromRecords(kept) };
};

/** Un lecteur de HTML de ligne : chaque texte de paragraphe est servi UNE fois
 *  (deux paragraphes identiques gardent chacun leur mise en forme), puis le
 *  suivant. Renvoie `''` quand la ligne n'a pas de HTML connu. */
export const lineHtmlReader = (htmlByText) => {
  const used = new Map();
  return (line) => {
    const key = String(line || '').trim();
    const list = htmlByText && htmlByText.get ? htmlByText.get(key) : null;
    if (!list || !list.length) return '';
    const at = used.get(key) || 0;
    used.set(key, at + 1);
    return list[at] || list[list.length - 1] || '';
  };
};

/** Les légendes deviennent les `caption` des figures et SORTENT du texte (elles
 *  sont déjà sous l'image dans le document exporté) — comme le fait
 *  « 📄 Word text ». La légende est cherchée SOUS le marqueur (le cas normal),
 *  puis AU-DESSUS (certaines revues impriment la légende avant l'image).
 *  Même chose que figuresWithCaptionsFromText, mais sur les paragraphes
 *  { text, html } : la ligne retirée l'est aussi en HTML. */
export const figuresWithCaptionsFromRecords = (records, figures) => {
  const list = (Array.isArray(records) ? records : [])
    .map((r) => ({ text: String((r && r.text) || ''), html: String((r && r.html) || '') }));
  const caps = (Array.isArray(figures) ? figures : []).map((f) => ({ ...f }));
  const at = (i) => String((list[i] || {}).text || '').trim();
  const take = (i) => {
    const t = at(i);
    if (!t || isFigureMark(t) || t.length > 400 || !FIGURE_LEGEND_RE.test(t)) return null;
    list[i] = { text: '', html: '' };
    return t;
  };
  list.forEach((r, i) => {
    if (!isFigureMark(r.text)) return;
    const fig = caps.find((f) => f.index === figureMarkIndex(r.text));
    if (!fig || fig.caption) return;
    let caption = null;
    for (let j = i + 1; j < list.length && j <= i + 3 && !caption; j += 1) {
      if (!at(j)) continue;
      caption = take(j);
    }
    if (!caption) caption = take(i - 1);
    if (caption) fig.caption = caption;
  });
  return { records: list, figures: caps };
};

/** Les légendes des figures d'un TEXTE (compatibilité : voir
 *  figuresWithCaptionsFromRecords). */
export const figuresWithCaptionsFromText = (text, figures) => {
  const res = figuresWithCaptionsFromRecords(recordsFromText(text), figures);
  return {
    text: res.records.map((r) => r.text).join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    figures: res.figures
  };
};

/* ── .docx / page HTML → le texte AVEC ses marqueurs + ses figures ─────────── */

const mimeOfExt = (ext) => ({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  bmp: 'image/bmp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff',
  webp: 'image/webp', ico: 'image/x-icon', emf: 'image/emf', wmf: 'image/wmf'
}[String(ext || '').toLowerCase()] || 'image/png');

const extOfPath = (path) => {
  const m = /\.([a-z0-9]{2,5})$/i.exec(String(path || ''));
  return m ? m[1].toLowerCase() : 'png';
};

/** Le chemin dans le ZIP d'une cible de relation (`media/image1.png`). */
const docxMediaPath = (target) => {
  const t = String(target || '').replace(/^\.\//, '').replace(/^\//, '');
  if (!t) return '';
  if (t.startsWith('word/')) return t;
  if (t.startsWith('media/')) return `word/${t}`;
  return `word/${t}`;
};

/** Les relations d'un `word/_rels/document.xml.rels` : `{ rId: Target }`. */
export const docxRelsFromXml = (relsXml) => {
  const out = {};
  const re = /<Relationship\b([^>]*)\/?>/gi;
  let m;
  while ((m = re.exec(String(relsXml || '')))) {
    const id = /\bId="([^"]+)"/i.exec(m[1]);
    const target = /\bTarget="([^"]+)"/i.exec(m[1]);
    if (id && target) out[id[1]] = target[1];
  }
  return out;
};

/** Le TEXTE VISIBLE d'un morceau de XML `.docx` : ses `<w:t>`, ses tabulations
 *  et ses sauts de ligne. Sert à juger le CONTEXTE d'un exposant (voir
 *  markDocxSuperscriptCitations) — aucun autre nettoyage ici. */
const docxRunText = (xml) => String(xml || '')
  .replace(/<w:tab\b[^>]*\/?>/g, ' ')
  .replace(/<w:(?:br|cr)\b[^>]*\/?>/g, '\n')
  .replace(/<[^>]+>/g, '');

/** Le texte VISIBLE qui SUIT un run, dans son PARAGRAPHE seulement : au-delà,
 *  c'est le paragraphe suivant — et une citation en fin de paragraphe serait
 *  alors jugée sur le premier mot du suivant (voir citationContextOkAfter). */
const docxRestText = (source, from) => {
  const s = String(source || '');
  const stop = s.indexOf('</w:p>', from);
  return docxRunText(s.slice(from, stop === -1 ? s.length : stop));
};

/** Un run (`<w:r>`) est-il mis en EXPOSANT ? (`<w:vertAlign w:val="superscript"/>`) */
const isSuperscriptRun = (runXml) =>
  /<w:vertAlign\b[^>]*w:val\s*=\s*"superscript"/i.test(String(runXml || ''));

/** Le run, son texte remplacé par `[n]` quand c'est un renvoi en exposant ;
 *  sinon le run inchangé. `before` / `after` = le texte visible qui l'entoure
 *  (les garde-fous de contexte en ont besoin : « 13C » est un isotope). */
const superscriptRunMarker = (runXml, before, after) => {
  if (!isSuperscriptRun(runXml)) return runXml;
  const m = /^\s*(\d{1,4}(?:\s*(?:[,;]|-|–|—|to)\s*\d{1,4})*)\s*$/.exec(docxRunText(runXml));
  if (!m) return runXml;
  const nums = numericCitationNumbers(m[1]);
  if (!nums.length) return runXml;
  /* « m2 », « 10-3 » : exposant d'unité ou de puissance ; « 13C » : un ISOTOPE —
     l'exposant y ouvre un mot, un renvoi ne le fait jamais. */
  if (!citationPassesGuards(before, after, { form: 'sup-html', nums })) return runXml;
  let first = true;
  return runXml.replace(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g, () => {
    if (!first) return '';
    first = false;
    return `<w:t>[${m[1]}]</w:t>`;
  });
};

/**
 * LES CITATIONS EN EXPOSANT D'UN `.docx` DEVIENNENT LEURS MARQUEURS `[n]`.
 *
 * C'est LE défaut qui rendait « 🔗 Link citations » inutile sur un article
 * écrit pour une revue : Word, Google Docs et EndNote sèment leurs renvois en
 * EXPOSANT — « …as shown previously12 » avec le 12 en petit et en haut. Cette
 * information n'existe QUE dans la mise en forme du run
 * (`<w:vertAlign w:val="superscript"/>`) : la lecture du texte la perd, et le
 * renvoi arrivait comme un nombre NU collé au mot — indiscernable d'un « 12 »
 * ordinaire, donc jamais converti au numéro du projet ni lié à sa référence
 * (le texte n'offrait plus rien à lier : « Nothing to link »).
 *
 * Ici le run exposant qui ne porte QU'un numéro devient `[12]` DANS le XML : le
 * reste du chemin d'import (numérotation de la bibliographie → numéros du
 * projet → liens `#ref-n`) travaille ensuite exactement comme pour un « [12] »
 * écrit à la main. Rien d'autre n'est touché : ni les exposants de lettres, ni
 * les ordinaux (« 2nd »), ni les unités (« m2 »), ni une puissance (« 10-3 »),
 * ni les runs normaux — le texte de l'auteur reste son texte.
 */
export const markDocxSuperscriptCitations = (xml) => {
  const source = String(xml || '');
  const re = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(source))) {
    out += source.slice(last, m.index);
    last = re.lastIndex;
    out += superscriptRunMarker(m[0], docxRunText(out), docxRestText(source, re.lastIndex));
  }
  return out + source.slice(last);
};

/** Ce qui ne doit jamais entrer dans le texte : les CODES DE CHAMP (Paperpile /
 *  EndNote y rangent le JSON de la citation) et le texte SUPPRIMÉ (révisions
 *  Word restées dans le fichier). */
const stripDocxNoise = (xml) => String(xml || '')
  .replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g, '')
  .replace(/<w:delText\b[^>]*>[\s\S]*?<\/w:delText>/g, '')
  .replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, '');

/** Un attribut de mise en forme d'un run est-il ACTIF ? Word écrit « <w:b/> »
 *  pour gras et « <w:b w:val="0"/> » pour « plus gras » : le second ne compte
 *  pas. */
const docxFlagOn = (rPr, name) => new RegExp(
  `<w:${name}\\b(?![^>]*w:val\\s*=\\s*"(?:0|false|none|nil)")[^>]*/?>`, 'i'
).test(String(rPr || ''));

/** Le texte VISIBLE d'un run, avec ses sauts de ligne et ses tabulations. */
const docxRunHtmlText = (runXml) => {
  let out = '';
  const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:(?:tab|br|cr)\b[^>]*\/?>/gi;
  let m;
  while ((m = re.exec(String(runXml || '')))) {
    if (m[1] !== undefined) out += m[1];
    else if (/<w:tab\b/i.test(m[0])) out += ' ';
    else out += '<br>';
  }
  return out;
};

/** UN RUN (.docx) → son HTML : gras, italique, souligné, exposant, indice.
 *  C'est la MISE EN FORME du document que l'utilisateur refuse de perdre
 *  (« dommage de perdre la mise en forme… partout dans le texte ») : H₂O garde
 *  son indice, « 10⁹ » son exposant, les noms d'espèces leur italique.
 *
 *  SEULE EXCEPTION : l'exposant qui ne porte qu'un RENVOI (« [12] », déjà
 *  marqué par markDocxSuperscriptCitations) n'est pas remis en exposant — le
 *  programme écrit ses citations « [12] », son style, et le lien vers la
 *  référence doit rester lisible dans la phrase. */
const docxRunHtml = (runXml) => {
  const text = docxRunHtmlText(runXml);
  if (!text) return '';
  const rPr = (/<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/i.exec(String(runXml || '')) || [])[1] || '';
  let html = text;
  if (docxFlagOn(rPr, 'b')) html = `<strong>${html}</strong>`;
  if (docxFlagOn(rPr, 'i')) html = `<em>${html}</em>`;
  if (docxFlagOn(rPr, 'u')) html = `<u>${html}</u>`;
  const citationOnly = /^\[\s*\d{1,4}(?:\s*[,;]\s*\d{1,4})*\s*\]$/.test(text.trim());
  if (!citationOnly && docxFlagOn(rPr, 'vertAlign') && /superscript/i.test(rPr)) html = `<sup>${html}</sup>`;
  else if (!citationOnly && docxFlagOn(rPr, 'vertAlign') && /subscript/i.test(rPr)) html = `<sub>${html}</sub>`;
  return html;
};

/** Un PARAGRAPHE `.docx` → son HTML (ses runs mis bout à bout). */
export const docxParagraphHtml = (xml) => {
  const clean = stripDocxNoise(xml);
  const out = [];
  const re = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
  let m;
  while ((m = re.exec(clean))) {
    const html = docxRunHtml(m[0]);
    if (html) out.push(html);
  }
  return out.join('').trim();
};

/** Les paragraphes d'un `word/document.xml`, dans l'ordre, chacun avec le rId
 *  de l'image qu'il contient (`''` quand il n'y en a pas), son texte et son
 *  HTML. PUR : ni DOM ni navigateur, ce qui permet au test de fabriquer un
 *  .docx en mémoire. */
export const docxParagraphsWithImages = (xml) => {
  const clean = stripDocxNoise(xml);
  const out = [];
  const re = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let m;
  while ((m = re.exec(clean))) {
    const chunk = m[0];
    const blip = /<(?:a:)?blip\b[^>]*r:(?:embed|link)="([^"]+)"/i.exec(chunk);
    const imagedata = /<(?:v:)?imagedata\b[^>]*r:id="([^"]+)"/i.exec(chunk);
    const marked = markDocxSuperscriptCitations(chunk);
    out.push({
      rid: (blip && blip[1]) || (imagedata && imagedata[1]) || '',
      text: paragraphTextFromDocxXml(marked).trim(),
      html: docxParagraphHtml(marked)
    });
  }
  return out;
};

/** Un .docx (ses OCTETS) → son texte avec les marqueurs de figure + la liste
 *  des figures (`bytes` = les pixels du fichier `word/media/…`). */
export const docxManuscriptFromBytes = (bytes) => {
  let files;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('Not a valid .docx file (it could not be unzipped).');
  }
  const xml = strFromU8(files['word/document.xml'] || new Uint8Array());
  if (!xml.trim()) throw new Error('The .docx contains no readable text.');
  const rels = docxRelsFromXml(strFromU8(files['word/_rels/document.xml.rels'] || new Uint8Array()));

  const figures = [];
  const records = [];
  docxParagraphsWithImages(xml).forEach((p) => {
    const text = String(p.text || '').trim();
    const html = String(p.html || '').trim();
    if (!p.rid) { if (text) records.push({ text, html }); return; }
    /* Une image = une figure, MÊME quand ses octets manquent dans le ZIP (image
       LIÉE plutôt qu'incorporée, relation cassée) : le rang des figures
       suivantes ne doit pas se décaler. Une cible externe (http…, data:) est
       gardée telle quelle, comme une image de page HTML. */
    const target = rels[p.rid] || '';
    const external = /^(?:https?:|data:)/i.test(String(target)) ? String(target) : '';
    const path = external ? '' : docxMediaPath(target);
    const data = path ? files[path] : null;
    const name = external ? nameOfSrc(external) : (path.split('/').pop() || `figure${figures.length + 1}.png`);
    const ext = extOfPath(name);
    figures.push({
      index: figures.length + 1,
      name,
      ext,
      mime: external ? mimeOfSrc(external) : mimeOfExt(ext),
      ...(external ? { src: external } : {}),
      bytes: !external && data && data.length ? data : null,
      missing: !external && !(data && data.length)
    });
    if (text) records.push({ text, html });
    records.push({ text: figureMark(figures.length), html: '' });
  });
  const withCaptions = figuresWithCaptionsFromRecords(records, figures);
  return { ...textWithHtmlRecords(withCaptions.records), figures: withCaptions.figures };
};

/** Le `src` d'une balise `<img …>` d'une page HTML. */
const imgSrcOfTag = (tag) => {
  const m = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(String(tag || ''));
  return m ? String(m[1] || m[2] || m[3] || '').trim() : '';
};

const mimeOfSrc = (src) => {
  const m = /^data:([^;,]+)/i.exec(String(src || ''));
  if (m) return String(m[1]).toLowerCase();
  if (/\.svg(\?|$)/i.test(src)) return 'image/svg+xml';
  if (/\.jpe?g(\?|$)/i.test(src)) return 'image/jpeg';
  if (/\.gif(\?|$)/i.test(src)) return 'image/gif';
  if (/\.webp(\?|$)/i.test(src)) return 'image/webp';
  return 'image/png';
};

const nameOfSrc = (src) => {
  const s = String(src || '');
  if (s.startsWith('data:')) {
    const ext = mimeOfSrc(s).replace(/^image\//, '').replace('+xml', '');
    return `figure.${ext === 'jpeg' ? 'jpg' : ext || 'png'}`;
  }
  const clean = s.split('?')[0].split('#')[0];
  const leaf = clean.split('/').pop() || '';
  try { return decodeURIComponent(leaf) || 'figure'; } catch { return leaf || 'figure'; }
};

/** Une page HTML (export Google Docs « page Web », article enregistré) → son
 *  texte avec les marqueurs de figure + la liste des figures. Les `<img>` sont
 *  gardées par leur URL telle quelle (Google, Drive, `data:`…) : rien n'est
 *  retéléchargé. Les images techniques (spacer, pixel de 1 px) sont ignorées. */
export const htmlManuscriptFromHtml = (html) => {
  const figures = [];
  const withMarks = String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const src = imgSrcOfTag(tag);
      if (!src) return '';
      if (/spacer\.gif|pixel\.gif|blank\.gif|[?&](?:w|width)=1\b/i.test(src)) return '';
      const name = nameOfSrc(src);
      figures.push({ index: figures.length + 1, name, ext: extOfPath(name), mime: mimeOfSrc(src), src });
      return `\n${figureMark(figures.length)}\n`;
    });
  return figuresWithCaptionsFromText(htmlToText(withMarks), figures);
};

/** Le document choisi par l'utilisateur (.docx → ZIP, .html → page, le reste →
 *  texte brut) → `{ text, figures, htmlByText }`. `text` porte les marqueurs de
 *  figure `[[FIGURE n]]` (voir plus haut) ; `figures[n-1]` décrit l'image n ;
 *  `htmlByText` porte la MISE EN FORME des paragraphes quand le document en a
 *  une (un .docx : gras, italique, exposants, indices — voir
 *  docxParagraphHtml) et `null` sinon. */
export const readManuscriptDocument = async (file) => {
  if (!file) return { text: '', figures: [], htmlByText: null };
  const name = String(file.name || '').toLowerCase();
  if (name.endsWith('.docx')) {
    const buf = await file.arrayBuffer();
    return docxManuscriptFromBytes(new Uint8Array(buf));
  }
  const raw = await file.text();
  if (name.endsWith('.html') || name.endsWith('.htm')) return { ...htmlManuscriptFromHtml(raw), htmlByText: null };
  return { text: normalizeText(raw), figures: [], htmlByText: null };
};

/** (compatibilité) Le TEXTE du document — marqueurs de figure compris. */
export const readManuscriptText = async (file) => normalizeText((await readManuscriptDocument(file)).text);

/** Les PIXELS d'une figure sous forme de `data:` URL (un .docx ne contient que
 *  des octets) — c'est elle que la page projet envoie au Drive, comme le fait
 *  « 📄 Word text ». Une figure déjà décrite par un `src` le garde tel quel. */
export const figureDataUrl = (fig) => {
  const f = fig || {};
  if (f.src) return String(f.src);
  const bytes = f.bytes;
  if (!bytes || !bytes.length) return '';
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return `data:${f.mime || mimeOfExt(f.ext)};base64,${btoa(binary)}`;
};

/* ── 2. Découpage : corps du texte vs bibliographie de fin ─────────────────── */

/** Titres qui annoncent la bibliographie de fin de document. */
export const REFERENCE_HEADING_RE = /^(references|reference list|bibliography|bibliographie|literature cited|works cited|références|référence)\b/i;

/** Le manuscrit en { body, referencesText } : tout ce qui suit le titre
 *  « References » (ou « Bibliography »…) est la bibliographie. */
export const splitManuscript = (blocks) => {
  const list = Array.isArray(blocks) ? blocks : [];
  const at = list.findIndex((b) => b.kind === 'heading' && REFERENCE_HEADING_RE.test(headingLabel(b.text)));
  if (at !== -1) {
    return {
      body: list.slice(0, at),
      referencesText: list.slice(at + 1).map((b) => b.text).join('\n'),
      referencesHeading: headingLabel(list[at].text)
    };
  }
  return { body: list, referencesText: '', referencesHeading: '' };
};

/* ── 3. Les sections du projet et le titre qui y mène ─────────────────────── */

/** Sections TEXTE de la page projet (elles portent un RichTextEditor) —
 *  les mêmes que projectDetailModule.textSection(). */
export const PROJECT_TEXT_SECTIONS = [
  { id: 'background', label: 'Scientific background' },
  { id: 'discussion', label: 'Results and Discussion' },
  { id: 'conclusions', label: 'Conclusions' },
  { id: 'funding', label: 'Funding' },
  { id: 'supporting', label: 'Supporting information' }
];

/** Mots qui, dans un titre de manuscrit, désignent une section du projet. */
const SECTION_WORDS = [
  { id: 'background', words: ['introduction', 'background', 'abstract', 'summary', 'résumé', 'resume', 'context', 'state of the art', 'literature review'] },
  { id: 'discussion', words: ['discussion', 'interpretation'] },
  { id: 'conclusions', words: ['conclusion', 'conclusions', 'concluding remarks', 'perspectives', 'outlook', 'future work', 'take-home'] },
  /* Financement : les remerciements d'un article sont le plus souvent le même
     paragraphe que le financement (bourses, contrats, laboratoire d'accueil). */
  { id: 'funding', words: ['funding', 'funding statement', 'financial support', 'financial disclosure', 'funding information', 'support statement', 'grant', 'acknowledg'] },
  { id: 'supporting', words: ['supporting information', 'supporting material', 'supporting data', 'supplementary information', 'supplementary material', 'supplementary data', 'supplementary figure', 'supplementary table', 'supplementary file', 'additional file', 'appendix', 'online resource'] }
];

/** Section du projet visée par un titre de manuscrit ('' quand aucune ne
 *  correspond : « Materials and Methods », « Results »… n'ont pas d'équivalent
 *  dans la page projet — l'utilisateur choisit alors lui-même). */
export const guessSectionForHeading = (heading) => {
  const s = String(heading || '').toLowerCase();
  if (!s) return '';
  const found = SECTION_WORDS.find((entry) => entry.words.some((w) => s.includes(w)));
  return found ? found.id : '';
};

/* ── 3 ter. « Tout ce qui est entre l'Introduction et les Conclusions est le
   Résultat / Discussion, sauf le Matériel et méthodes » ───────────────────────

   L'utilisateur l'a demandé en clair : « après l'introduction et avant les
   conclusions, tout sauf le matériel et méthodes (parfois appelé partie
   expérimentale) doit aller dans Results and discussion ». Un manuscrit écrit
   pour une revue n'a pas les intitulés de la page projet : il a « Results »,
   « Results and discussion », « M&M », « Statistical analysis », « Experimental
   part »… Laisser ces parties sans destination (dest « — do not import — »)
   revenait à ne PAS importer la moitié de l'article. */

/** Le champ « Matériel et méthodes » du projet : sa destination propre — le
 *  texte des manipulations n'a rien à faire dans « Results and discussion ». */
export const METHODS_DEST = { id: 'materialsAndMethods', label: '🧪 Materials & Methods (project)' };

/** Les intitulés de MATÉRIEL ET MÉTHODES (anglais et français) : « Materials and
 *  Methods », « Methods », « Experimental part » / « Experimental procedures »,
 *  « Partie expérimentale », « Protocole », « Statistical analysis »… Comme ce
 *  sont les SOUS-SECTIONS d'un même chapitre, tout ce qui les suit appartient
 *  encore à cette zone (voir withDocumentSections) jusqu'à « Results ». */
const METHODS_HEADING_RES = [
  String.raw`^(?:plant|bacterial|fungal|viral)?\s*materials?\b`,
  String.raw`^materials?\s*(?:and|&|,)\s*methods?\b`,
  String.raw`^methods?\b`,
  String.raw`^methodology\b`,
  String.raw`^experimental\b`,
  String.raw`^protocols?\b`,
  String.raw`^(?:statistical|data)\s+(?:analys\w*|collection|processing|treatment)\b`,
  String.raw`^reagents?\b`,
  String.raw`^chemicals?\b`,
  String.raw`^(?:bacterial|fungal|viral|plant)\s+(?:strains?|isolates?|material)\b`,
  String.raw`^(?:strains?|bacteria|media)\b`,
  String.raw`^(?:growth|culture)\s+conditions\b`,
  String.raw`^(?:dna|rna|protein|plasmid)\s+(?:extraction|isolation|analysis|sequencing|amplification|cloning)\b`,
  String.raw`^(?:extraction|isolation|cloning|sequencing)\s+of\b`,
  String.raw`^(?:sampling|sample collection|field (?:experiments?|trials?|work))\b`,
  String.raw`^(?:molecular|biochemical|microbiological)\s+(?:methods|techniques|analysis|assays?|characteri\w*)\b`,
  String.raw`^(?:enzyme|antimicrobial|cytotoxicity|viability)\s+assays?\b`,
  String.raw`^assays?\b`,
  /* Les manuscrits français du laboratoire écrivent la même chose autrement. */
  String.raw`^(?:mat[ée]riel|m[ée]thodes?|protocoles?)\b`,
  String.raw`^(?:partie|section|proc[ée]dures?)\s+exp[ée]rimentales?\b`,
  String.raw`^exp[ée]rimental\b`,
  String.raw`^analyses?\s+statistiques?\b`
];
export const METHODS_HEADING_RE = new RegExp(METHODS_HEADING_RES.join('|'), 'i');

/** Les intitulés qui OUVRENT le corps de l'article (« Results », « Findings ») :
 *  ils sortent de la zone Matériel et méthodes. */
export const RESULTS_HEADING_RE = /^(?:results?|findings|observations|r[ée]sultats?)\b/i;

/** Un intitulé d'INTRODUCTION (ou de résumé) : la zone « Results and
 *  discussion » commence APRÈS le dernier d'entre eux. */
const INTRO_HEADING_RE = /^(?:abstract|summary|r[ée]sum[ée]|introduction|background|context|state of the art|literature review)\b/i;

/**
 * Donne à chaque partie la SECTION du projet que le document implique, en
 * lisant SA POSITION et pas seulement son intitulé :
 *
 *   • les parties qui précèdent le corps (résumé, introduction) ne bougent pas ;
 *   • entre la fin de l'Introduction et les Conclusions, TOUT va dans
 *     « Results and discussion » — « Results », « Results and discussion »,
 *     « Discussion », « Statistical analysis »… — SAUF le Matériel et méthodes
 *     (voir METHODS_HEADING_RE), qui vise le champ « 🧪 Materials & Methods »
 *     du projet, et sauf Financement / Supporting information, qui gardent leur
 *     section ;
 *   • les sous-sections d'un chapitre Matériel et méthodes (« Statistical
 *     analysis », « DNA extraction »…) restent avec lui jusqu'à « Results » ;
 *   • au-delà des Conclusions, rien n'est deviné : « Perspectives »,
 *     « Funding », une annexe… gardent ce que leur intitulé dit (ou restent à
 *     choisir quand il ne dit rien).
 *
 * Les parties SANS intitulé (le chapeau / résumé imprimé avant le premier titre)
 * ne sont jamais touchées : c'est la fenêtre d'import qui demande.
 *
 * @param {Array} parts  le résultat de groupManuscriptParts
 * @returns {Array} les mêmes parties, `id` rempli par la règle de position
 */
export const withDocumentSections = (parts) => {
  const list = (Array.isArray(parts) ? parts : []).map((p) => ({ ...p }));
  /* L'INTITULÉ D'UNE PARTIE, prêt à être comparé : numérotation, puce et
     ponctuation finale retirées (voir sectionHeadingKey) — « I. INTRODUCTION »,
     « 2. Materials and Methods. » et « • Results: » se lisent donc comme les
     intitulés du projet. Sans ce nettoyage, un chapitre ponctué ou numéroté
     gardait une section vide de sens (son texte partait dans « Results and
     discussion » au lieu de « Matériel et méthodes », par exemple). */
  const label = (p) => sectionHeadingKey((p && p.heading) || '');
  /* 1. Où commence le CORPS : après la suite d'intitulés « résumé /
        introduction » du début (le dernier d'entre eux). */
  let startAt = 0;
  for (let i = 0; i < list.length; i += 1) {
    if (!label(list[i])) continue;
    const guess = guessSectionForHeading(label(list[i]));
    if (guess === 'background' || INTRO_HEADING_RE.test(label(list[i]))) { startAt = i + 1; continue; }
    startAt = i;
    break;
  }
  /* 2. Où il s'arrête : les CONCLUSIONS (au-delà, chaque partie garde ce que son
        intitulé dit). */
  let stopAt = list.length;
  for (let i = startAt; i < list.length; i += 1) {
    if (guessSectionForHeading(label(list[i])) === 'conclusions') { stopAt = i; break; }
  }
  /* 3. La zone du corps. */
  let inMethods = false;
  for (let i = startAt; i < stopAt; i += 1) {
    const p = list[i];
    const head = label(p);
    if (!head) continue;
    if (METHODS_HEADING_RE.test(head)) {
      inMethods = true;
      if (!p.id) p.id = METHODS_DEST.id;
      p.autoSection = METHODS_DEST.id;
      continue;
    }
    if (RESULTS_HEADING_RE.test(head)) {
      inMethods = false;
      if (!p.id || p.id === 'background') p.id = 'discussion';
      p.autoSection = 'discussion';
      continue;
    }
    const guess = guessSectionForHeading(head);
    if (guess && guess !== 'background') {   // Funding, Supporting information…
      inMethods = false;
      if (!p.id) p.id = guess;
      p.autoSection = guess;
      continue;
    }
    if (inMethods) {   // « Statistical analysis », « DNA extraction »… du chapitre
      if (!p.id) p.id = METHODS_DEST.id;
      p.autoSection = METHODS_DEST.id;
      continue;
    }
    /* Une partie qui ne dit RIEN va dans « Results and discussion » (règle de
       POSITION). Mais un intitulé qui DIT « Abstract » / « Introduction » /
       « Background » n'est pas retourné en discussion : c'est la section
       « Scientific background » du projet. Le forcer là était le défaut
       signalé (« l'Introduction n'est pas allée dans Scientific background ») :
       dès qu'une ligne d'en-tête mal lue passait pour un titre AVANT
       l'Introduction, la règle de position s'appliquait à elle aussi. */
    if (!p.id) {
      p.id = 'discussion';
      p.autoSection = 'discussion';
    }
  }
  return list;
};

/* ── 3 bis. L'EN-TÊTE du document : titre, auteurs, affiliations ──────────── */

/** Un titre ne se termine pas par une ponctuation de phrase — sauf quand la
 *  ligne suivante est une liste d'auteurs (le titre a alors un point final). */
const isTitleCandidate = (line, nextLine) => {
  const s = String(line || '').trim();
  if (!s || s.length < 8 || s.length > 300) return false;
  if (/^(?:https?:|www\.|doi:|10\.\d)/i.test(s)) return false;
  if (/^(?:abstract|introduction|references|bibliography|keywords|acknowledg)/i.test(s)) return false;
  if (s.split(/\s+/).filter(Boolean).length < 2) return false;
  if (/[.;:,]$/.test(s)) {
    return !!nextLine && (looksLikeAuthorLine(nextLine) || looksLikeAffiliationLine(nextLine));
  }
  return true;
};

/** Une LISTE de noms, même sans le moindre marqueur d'auteur (pas d'initiale
 *  pointée, pas d'exposant) : c'est le nombre de noms qui la distingue d'un
 *  intitulé de section — « Anna Bianchi, Mario Rossi » est une liste, « Materials
 *  and Methods » ou « Statistical Analysis » n'en sont pas. */
export const looksLikeAuthorList = (line) => {
  const s = String(line || '').trim();
  if (!s || s.length > AUTHOR_LINE_MAX) return false;
  if (looksLikeAuthorLine(s)) return true;
  /* Un intitulé commençant par un mot de section (« Results And Discussion »,
     « Introduction and aims ») n'est PAS une liste de noms, même s'il se coupe
     en deux comme une liste (« and » est un séparateur d'auteurs). */
  if (SECTION_WORD_RE.test(s)) return false;
  const parts = authorLineParts(s);
  if (parts.length < 2 || !parts.every((p) => NAME_PART_RE.test(p))) return false;
  if (/[.;:!?]$/.test(s)) return false;
  return s.split(/\s+/).length <= 12;
};

/** Liste de noms « en position d'auteurs » (juste après le titre) : elle n'a
 *  pas besoin de porter des exposants — « Anna Bianchi, Jean Dupont » suffit. */
const isAuthorish = looksLikeAuthorList;

/** Le mot d'un nom, particule comprise : « Rossi », « Mario », « W.-J. »,
 *  « van der Berg ». Écrit en CHAÎNE (et non en RegExp) : une expression
 *  composée à partir d'un objet RegExp collerait ses barres obliques dans le
 *  motif (« /…/u »), et la liste de noms ne serait jamais reconnue. */
const NAME_WORD = '(?:(?:van|von|de|den|der|del|della|di|da|dos|du|la|le|ter|ten|bin|ben|el|al)\\s+)?'
  + "[\\p{Lu}][\\p{L}'\\u2019.-]*\\.?";
const NAME_ONLY_RE = new RegExp(`^${NAME_WORD}(?:\\s+${NAME_WORD})*$`, 'u');

/** UNE LIGNE DE NOMS, jugée sur la POSITION plus que sur les marqueurs : les
 *  noms y sont séparés par des virgules (ou « and » / « & »), chacun fait un ou
 *  deux mots capitalisés, ses marqueurs d'affiliation sont retirés
 *  (« Mario Rossi a », « Anna Bianchi[2] » → des noms nus).
 *
 *  Pourquoi une seconde lecture, plus permissive : dans un article, l'en-tête
 *  est écrit DANS UN ORDRE — le titre, PUIS les auteurs, PUIS les affiliations.
 *  Le titre est reconnu, les adresses sont reconnues (elles portent un mot
 *  d'institution), et la ligne qui se trouve ENTRE les deux ne peut donc être
 *  qu'une liste d'auteurs — même quand le marqueur est une lettre (« Rossi a »),
 *  une croix, ou absent. C'était le défaut signalé : « je ne comprends pas
 *  pourquoi vous ne reconnaissez pas la section des auteurs alors qu'elle est
 *  entre le titre et les affiliations ». */
export const looksLikeNameListLine = (line) => {
  const s = String(line || '').trim();
  if (!s || s.length > AUTHOR_LINE_MAX) return false;
  if (HEADER_META_RE.test(s) || SECTION_WORD_RE.test(s)) return false;
  if (looksLikeAffiliationLine(s)) return false;
  if (isBodyParagraph(s)) return false;
  const parts = s.split(/\s*[,;]\s*|\s+&\s+|\s+and\s+/i)
    .map((p) => stripAffilMarks(p))
    .filter(Boolean);
  if (!parts.length || parts.length > 40) return false;
  if (!parts.every((p) => NAME_ONLY_RE.test(p) && p.split(/\s+/).length <= 5)) return false;
  /* Un nom SEUL est accepté (article à un seul auteur), mais pas une phrase. */
  if (parts.length === 1) return s.split(/\s+/).length <= 4;
  return true;
};

/** La ligne SUIVANTE d'une liste de noms (positions 2, 3… d'un en-tête) : un
 *  marqueur d'auteur, ou la même lecture par position que la première ligne —
 *  dans l'écriture « un marqueur par nom » il faut AU MOINS DEUX morceaux, pour
 *  qu'un intitulé numéroté (« 3 Statistical analysis ») ne devienne pas un
 *  auteur. */
const isNameLineContinuing = (text) => isAuthorish(text) || looksLikeNameListLine(text)
  || looksLikeHeadMarkedNameList(text, { minParts: 2 });

/** La ligne de noms EN POSITION d'auteur (juste sous le titre) : un nom SEUL y
 *  suffit — c'est le cas « un auteur par ligne », fréquent dans un article à un
 *  seul auteur, que la seule liste de noms ne reconnaissait pas. Et quand aucun
 *  marqueur d'auteur n'est reconnu (« Mario Rossi a, Anna Bianchi b »), la
 *  POSITION tranche : voir looksLikeNameListLine. */
const isAuthorLineAtPosition = (text) => isAuthorish(text)
  || looksLikeAuthorLine(text, { alone: true })
  || looksLikeNameListLine(text);

/** LA LIGNE EST-ELLE UNE LIGNE D'AUTEURS ? (titre et intitulé de section mis à
 *  part). C'est la même question que se pose le rattachement des citations : les
 *  exposants d'une liste de noms sont les numéros des AFFILIATIONS, jamais des
 *  renvois bibliographiques (voir isAuthorMarkLine). */
export const isAuthorLine = (line) => isAuthorLineAtPosition(String(line || '').trim());

/**
 * Cette ligne est-elle une ligne d'AUTEURS QUI PORTE SES MARQUEURS D'AFFILIATION
 * (« Mario Rossi¹, Anna Bianchi² », « Rossi M1, Bianchi A2 », « Rossi[1], … ») ?
 *
 * Ces marqueurs sont des NUMÉROS DE LABORATOIRE : ils n'ont jamais le sens d'un
 * renvoi (« Questi apici non sono mai riferimenti bibliografici ma si
 * riferiscono alle affiliazioni »). La question est donc posée AVANT de convertir
 * ou de lier la moindre citation d'un texte (voir utils/referenceLinks.js) :
 * sans elle, la ligne d'auteurs gardée dans le texte (« keep in the section
 * text ») ressortait en « Mario Rossi[1], Anna Bianchi[2] » — le défaut signalé.
 */
export const isAuthorMarkLine = (line) => {
  const s = String(line || '').trim();
  if (!s || !AFFIL_MARK_IN_LINE_RE.test(s)) return false;
  return isAuthorLine(s);
};

/** Les particules d'un nom (« van der Berg ») : seuls mots en minuscules qui
 *  peuvent apparaître DANS une liste de noms. Un titre, lui, contient des mots
 *  de liaison (« in », « of », « the »…) — c'est ce qui le distingue. */
const NAME_PARTICLE_RE = /^(?:van|von|de|den|der|del|della|di|da|dos|du|la|le|ter|ten|bin|ben|el|al)$/i;
const WORD_CAPS_RE = /^\p{Lu}[\p{L}'\u2019.-]*$/u;
const WORD_ALLCAPS_RE = /^[A-Z\u00c0-\u00de]{1,5}\.?$/;

/** DERNIER REPLI de la lecture par position : la ligne qui suit le titre, quand
 *  elle est écrite comme une liste de noms mais qu'AUCUN des trois lecteurs
 *  ci-dessus ne la reconnaît — « M. Rossi, A. Bianchi » (initiale AVANT le nom,
 *  style Nature), « ROSSI M, BIANCHI A » (tout en majuscules), « Mario Rossi »
 *  seul… Elle est alors PROPOSÉE comme liste d'auteurs dans la fenêtre
 *  d'import, où l'utilisateur la voit et corrige son rôle d'un clic.
 *
 *  Ce repli existe parce qu'un champ « Authors » vide ne dit rien à personne :
 *  l'utilisateur ne comprend pas pourquoi sa liste d'auteurs n'est pas reconnue
 *  alors qu'elle est exactement à sa place dans le document. Mieux vaut une
 *  ligne PROPOSÉE — visible, corrigeable, jamais écrite en douce — que trois
 *  noms perdus. Ce qui est écarté reste écarté : une phrase (un mot de liaison,
 *  une minuscule initiale), une adresse, une métadonnée, un intitulé de section,
 *  une ligne trop longue. */
export const looksLikeLooseAuthorLine = (line) => {
  const s = String(line || '').trim();
  if (!s || s.length > 160) return false;
  if (HEADER_META_RE.test(s) || SECTION_WORD_RE.test(s)) return false;
  if (looksLikeAffiliationLine(s) || isBodyParagraph(s)) return false;
  if (/[;:!?]$/.test(s)) return false;
  if (/\.$/.test(s) && !/\p{Lu}\.$/u.test(s)) return false;
  const parts = s.split(/\s*[,;]\s*|\s+&\s+|\s+and\s+/i)
    .map((p) => stripAffilMarks(p))
    .filter(Boolean);
  if (!parts.length || parts.length > 30) return false;
  /* Chaque morceau est un nom : des mots capitalisés, une initiale, une
     particule — jamais un mot de liaison, jamais une phrase. */
  return parts.every((p) => {
    const words = p.split(/\s+/).filter(Boolean);
    if (!words.length || words.length > 5 || p.length > 40) return false;
    return words.every((w) => WORD_CAPS_RE.test(w) || WORD_ALLCAPS_RE.test(w) || NAME_PARTICLE_RE.test(w));
  });
};

/** Le MARQUEUR de TÊTE d'un nom — « 1 Mario Rossi », « ²Anna Bianchi »,
 *  « [1] M. Rossi » : le numéro de laboratoire écrit AVANT le nom (style de
 *  quelques éditeurs, et écriture d'un .docx dont l'exposant devient « [1] »).
 *  Ce n'est JAMAIS une initiale : « M. Rossi » n'est pas touché. */
const NAME_HEAD_MARK_RE = new RegExp(
  `^\\s*\\[?\\s*(?:[${SUP_MARK_CLASS}]+|\\d{1,2}|[*\\u2020\\u2021\\u00a7\\u00b6]|[a-e])\\s*[)\\].]?\\s*`, 'u');

/** Les morceaux d'une liste dont chaque nom porte son marqueur EN TÊTE :
 *  crochets ouverts, exposants détachés par la virgule recollés au nom
 *  (comme authorLineParts), marqueur de tête et de queue retirés. Chaque
 *  morceau rendu est un nom NU. */
const headMarkedNameParts = (line) => {
  const opened = String(line || '').trim()
    /* Le SYMBOLE qui suit un marqueur (« Rossi[1,2]* » : l'auteur
       correspondant) est emporté AVEC lui : sinon l'astérisque restait seul et
       devenait un auteur à part entière. */
    .replace(/\[\s*([^[\]]{1,20}?)\s*\]\s*([*\u2020\u2021\u00a7\u00b6]?)/g, ' $1$2 ')
    .replace(/\(\s*(\d{1,2}(?:\s*,\s*\d{1,2})*)\s*\)\s*([*\u2020\u2021\u00a7\u00b6]?)/g, ' $1$2 ');
  const merged = [];
  opened.split(/\s*(?:,|;|\band\b|&)\s*/i).map((p) => p.trim()).filter(Boolean).forEach((part) => {
    const prev = merged[merged.length - 1];
    if (prev && EXPONENT_ONLY_RE.test(part) && MARK_TAIL_IN_NAME_RE.test(prev)) {
      merged[merged.length - 1] = `${prev},${part}`;
      return;
    }
    merged.push(part);
  });
  return merged.map((p) => stripAffilMarks(p.replace(NAME_HEAD_MARK_RE, ''))).filter(Boolean);
};

/** Une LISTE DE NOMS dont le marqueur de laboratoire est écrit EN TÊTE :
 *  « 1 Mario Rossi, 2 Anna Bianchi », « ¹Mario Rossi, ²Anna Bianchi ». Le
 *  marqueur de tête retiré, les morceaux se lisent comme des noms — un numéro
 *  n'est pas un prénom. `minParts` = 2 pour une ligne de CONTINUATION, afin de
 *  ne jamais prendre un intitulé numéroté (« 3 Statistical analysis ») pour un
 *  auteur. */
const looksLikeHeadMarkedNameList = (line, { minParts = 1 } = {}) => {
  const s = String(line || '').trim();
  if (!s || s.length > AUTHOR_LINE_MAX) return false;
  if (HEADER_META_RE.test(s) || SECTION_WORD_RE.test(s)) return false;
  /* Un INTITULÉ n'est jamais une liste de noms, même numéroté : après retrait du
     numéro, « 2. Materials and Methods. » se coupe en « Materials » +
     « Methods » et « 2. Statistical analysis » ressemble à un nom — ce sont des
     titres de section (voir METHODS_HEADING_RE / RESULTS_HEADING_RE). */
  const key = sectionHeadingKey(s);
  if (isSectionHeadingLine(s) || SECTION_WORD_RE.test(key)
    || METHODS_HEADING_RE.test(key) || RESULTS_HEADING_RE.test(key) || INTRO_HEADING_RE.test(key)) return false;
  if (looksLikeAffiliationLine(s) || isBodyParagraph(s)) return false;
  if (/[;:!?]$/.test(s)) return false;
  const parts = headMarkedNameParts(s);
  if (parts.length < minParts || parts.length > 40) return false;
  return parts.every((p) => NAME_ONLY_RE.test(p) && p.split(/\s+/).length <= 5);
};

/** La ligne EN POSITION d'auteur (celle qui suit le titre) : elle est acceptée
 *  par l'un des lecteurs qui ont servi à la DÉSIGNER — les trois lectures par
 *  position, le repli souple (voir looksLikeLooseAuthorLine) et la liste à
 *  marqueurs de tête. Sans cela, une ligne reconnue au PREMIER pas (elle
 *  désigne la liste d'auteurs) était REFUSÉE au second — et la liste, pourtant
 *  entre le titre et les affiliations, restait vide (défaut signalé par
 *  l'utilisateur : « les auteurs ne sont toujours pas reconnus »). */
const isFirstAuthorLine = (text) => isAuthorLineAtPosition(text)
  || looksLikeLooseAuthorLine(text)
  || looksLikeHeadMarkedNameList(text);

/** Combien de blocs sont examinés en tête de document. */
const HEADER_SCAN = 14;

/** Un long paragraphe de corps de texte : l'en-tête s'arrête avant lui. */
const isBodyParagraph = (s) => {
  const t = String(s || '');
  if (t.length > 200) return true;
  return t.length > 90 && (t.match(/[.!?]\s/g) || []).length >= 2;
};

/** Rôle deviné d'une ligne examinée en tête de document :
 *    'ignore'       → métadonnées (DOI, date, mots-clés, nom du fichier exporté…)
 *    'affiliations' → adresse d'institution
 *    'authors'      → liste de noms portant un marqueur d'auteur
 *    'section'      → intitulé de section du projet : l'en-tête est terminé
 *    'heading'      → ligne courte et capitalisée : elle peut être un TITRE, une
 *                     liste de noms sans marqueur (« Anna Bianchi, Mario Rossi »)
 *                     ou un intitulé inconnu (« Statistical analysis »)
 *    'text'         → tout le reste (candidat TITRE)
 *  Un intitulé COURT et connu (SECTION_WORD_RE : « Introduction », « Results »,
 *  « Funding », « Supporting information »…) est une section ; une ligne longue
 *  en majuscules (un titre de papier s'écrit souvent comme ça) reste un
 *  candidat titre. */
export const classifyHeaderLine = (line) => {
  const s = String(line || '').trim();
  if (!s) return 'ignore';
  /* UNE ADRESSE E-MAIL EST UNE AFFILIATION : c'est l'auteur correspondant
     (« Correspondence: … », « E-mail: … », l'adresse seule). Elle était rangée
     dans les métadonnées — donc CONSOMMÉE mais jamais gardée : le projet
     perdait l'adresse de correspondance du papier. Elle rejoint la liste des
     affiliations, en DERNIÈRE ligne (voir headerFromLineRoles). */
  if (EMAIL_IN_LINE_RE.test(s)) return 'affiliations';
  if (HEADER_META_RE.test(s)) return 'ignore';
  if (looksLikeAffiliationLine(s)) return 'affiliations';
  if (looksLikeAuthorLine(s)) return 'authors';
  if (isHeadingLine(s)) {
    const words = s.split(/\s+/).filter(Boolean).length;
    if (words > 4 || s.length > 60) return 'text';
    return SECTION_WORD_RE.test(s) ? 'section' : 'heading';
  }
  return 'text';
};

/** Les rôles qu'un utilisateur peut donner à une ligne d'en-tête. « keep » rend
 *  la ligne au TEXTE du document : elle reste dans la partie — donc dans la
 *  section — qui la portait. C'est le rôle par défaut des lignes proposées en
 *  repli (voir parseManuscriptHeader), et il défait un rôle deviné à tort. */
export const HEADER_ROLES = [
  { id: 'ignore', label: '— not imported —' },
  { id: 'title', label: 'Title' },
  { id: 'authors', label: 'Authors' },
  { id: 'affiliations', label: 'Affiliation' },
  { id: 'keep', label: '— keep in the section text —' }
];

/** Le rôle qui n'appartient PAS à l'en-tête : la ligne reste dans le texte. */
export const KEEP_ROLE = 'keep';

/** Les trois CHAMPS d'en-tête du projet, destinations possibles d'une PARTIE du
 *  manuscrit (voir la fenêtre d'import, « Text → project sections ») : quand le
 *  document imprime ses auteurs ailleurs qu'en tête (sous le résumé, dans un
 *  encadré…), l'utilisateur REDIRIGE le paragraphe vers le champ au lieu de le
 *  laisser tomber dans « Background ». `id` = le champ du projet lui-même
 *  (paperTitle / paperAuthors / paperAffiliations, section « 🧾 Title, authors &
 *  affiliations »), `short` = ce qu'en dit le compte rendu d'import. */
export const HEADER_DESTS = [
  { id: 'paperTitle', label: '🧾 Title (project header)', short: 'title' },
  { id: 'paperAuthors', label: '🧾 Authors (project header)', short: 'authors' },
  { id: 'paperAffiliations', label: '🧾 Affiliations (project header)', short: 'affiliations' }
];

export const isHeaderDest = (id) => HEADER_DESTS.some((d) => d.id === id);

export const headerDestLabel = (id) => (HEADER_DESTS.find((d) => d.id === id) || {}).short || '';

/** Le texte d'une PARTIE redirigée vers un champ d'en-tête, tel qu'il entre dans
 *  « 🧾 Title, authors & affiliations » :
 *    • le titre tient sur UNE ligne (les retours sont repliés) ;
 *    • les auteurs forment UNE liste séparée par des virgules (un auteur par
 *      ligne dans le document devient « Rossi M, Bianchi A ») ;
 *    • les affiliations gardent une ligne chacune (le champ est une liste).
 *  `mode` = 'replace' remplace le champ, sinon le texte s'AJOUTE à la suite. */
export const headerTextFor = (field, text, { previous = '', mode = 'append' } = {}) => {
  const lines = normalizeText(text).split('\n').map((l) => l.trim()).filter(Boolean);
  const before = String(previous || '').trim();
  if (!lines.length) return before;
  const sep = field === 'paperAffiliations' ? '\n' : field === 'paperTitle' ? ' ' : ', ';
  const joined = lines.join(sep);
  if (mode === 'replace' || !before) return joined;
  return `${before}${sep}${joined}`;
};

/** Une adresse SANS marqueur qui continue une liste d'affiliations :
 *  « INRAE, UMR Biologie du Fruit, Villenave d'Ornon, France ». */
export const looksLikeAddressLine = (line) => {
  const s = String(line || '').trim();
  if (!s || s.length > 200) return false;
  if (looksLikeAuthorLine(s) || looksLikeAffiliationLine(s)) return false;
  if (/[.;:!?]$/.test(s)) return false;
  return s.split(',').length >= 2 && s.split(/\s+/).length <= 25;
};

/** Combien de blocs sont examinés APRÈS la fenêtre d'en-tête par le REPLI, et
 *  après combien de paragraphes de corps de texte il s'arrête : les auteurs
 *  sont dans les premières lignes du document, jamais au milieu de l'article.
 *  QUATRE paragraphes de corps : un résumé de trois paragraphes est courant, et
 *  ses auteurs — imprimés SOUS le résumé — étaient auparavant hors d'atteinte
 *  du repli (il s'arrêtait après deux). */
const HEADER_EXTRA_SCAN = 12;
const HEADER_EXTRA_BODY_MAX = 4;

/** Les premières lignes du document, proposées telles quelles (« keep » : elles
 *  restent dans le texte) quand AUCUNE ligne d'en-tête n'a été reconnue : la
 *  fenêtre d'import doit toujours pouvoir montrer à l'utilisateur les lignes
 *  qu'il peut désigner lui-même comme titre / auteurs / affiliations. */
const firstHeaderLines = (list) => {
  const out = [];
  for (let i = 0; i < Math.min(list.length, 6); i += 1) {
    const s = String((list[i] && list[i].text) || '').trim();
    if (!s || isFigureMark(s)) continue;
    out.push({ at: i, text: s, role: KEEP_ROLE });
  }
  return out;
};

/** Les lignes qui SUIVENT la fenêtre d'en-tête et qui ressemblent à des noms —
 *  ou à une adresse venant juste après eux — avec le rôle deviné. Elles sont
 *  proposées à l'utilisateur au lieu de retomber dans la première section
 *  (voir parseManuscriptHeader, point 6). Les intitulés de section sont sautés :
 *  un document peut imprimer ses auteurs sous le résumé. Une adresse n'est
 *  reconnue qu'À LA SUITE d'une liste de noms (elle la suit toujours). */
const extraHeaderLines = (list, window) => {
  const from = (window.length ? window[window.length - 1].at : -1) + 1;
  const out = [];
  let bodies = 0;
  let names = false;
  for (let i = from; i < Math.min(list.length, from + HEADER_EXTRA_SCAN); i += 1) {
    const s = String((list[i] && list[i].text) || '').trim();
    if (!s || isFigureMark(s)) continue;
    /* Même jugement pour le repli : une longue liste de noms n'est pas un
       paragraphe de corps de texte — elle compte comme une liste d'auteurs
       (voir le point 3 de parseManuscriptHeader). */
    if (isBodyParagraph(s) && !isAuthorLineAtPosition(s)) {
      bodies += 1;
      names = false;
      if (bodies >= HEADER_EXTRA_BODY_MAX) break;
      continue;
    }
    const role = classifyHeaderLine(s);
    /* Un intitulé de section (« Results And Discussion », « Materials and
       Methods »…) n'est pas une liste d'auteurs, même s'il se lit comme deux
       noms : c'est le texte de la section, il reste où il est. */
    if (role === 'section' || guessSectionForHeading(headingLabel(s))) {
      names = false;
      continue;
    }
    if (role === 'authors' || looksLikeAuthorList(s) || looksLikeLooseAuthorLine(s)) {
      out.push({ at: i, text: s, role: 'authors' });
      names = true;
      continue;
    }
    if (role === 'affiliations') {
      out.push({ at: i, text: s, role: 'affiliations' });
      continue;
    }
    if (names && role !== 'ignore' && looksLikeAddressLine(s)) {
      out.push({ at: i, text: s, role: 'affiliations' });
      continue;
    }
    names = false;
  }
  return out;
};

/** Les trois champs de l'en-tête à partir des rôles (voir HEADER_ROLES).
 *  `lines` = [{ at, text, role }] : `at` = index du bloc dans `blocks`.
 *  TOUTE la zone d'en-tête est consommée — y compris les lignes « ignore »
 *  (métadonnées, ou ce que l'utilisateur ne veut pas importer) : elle ne doit
 *  jamais retomber dans une section du projet. Les lignes rendues au texte
 *  (« keep ») sont la seule exception : elles restent dans leur partie.
 *
 *  DEUX MISES EN FORME, apprises de l'utilisateur :
 *    • le champ « Authors » est une liste de NOMS : les marqueurs d'affiliation
 *      du document (« Mario Rossi1 », « Anna Bianchi b », « Jean Dupont[3] »)
 *      sont retirés — un « [1] » collé à un nom se lirait comme un renvoi de
 *      citation, et le document imprimé montrerait « Rossi[1] » au lieu de
 *      « Rossi » (voir cleanAuthorLine) ;
 *    • l'adresse de l'auteur CORRESPONDANT (l'e-mail) est la DERNIÈRE ligne des
 *      affiliations : c'est là qu'un article l'imprime, même quand le document
 *      la place entre les auteurs et les adresses. L'ordre des affiliations
 *      elles-mêmes est celui du document. */
export const headerFromLineRoles = (blocks, lines) => {
  const list = Array.isArray(blocks) ? blocks : [];
  const rows = (Array.isArray(lines) ? lines : []).filter((r) => r && typeof r.at === 'number' && list[r.at]);
  const texts = (role) => rows.filter((r) => r.role === role)
    .map((r) => String(r.text || '').trim()).filter(Boolean);
  const affiliations = texts('affiliations');
  const emails = affiliations.filter((t) => EMAIL_IN_LINE_RE.test(t));
  const addresses = affiliations.filter((t) => !EMAIL_IN_LINE_RE.test(t));
  return {
    title: texts('title')[0] || '',
    authors: texts('authors').map(cleanAuthorLine).filter(Boolean).join(', '),
    affiliations: [...addresses, ...emails].join('\n'),
    blocks: rows.filter((r) => r.role !== KEEP_ROLE).map((r) => list[r.at])
  };
};

/**
 * L'EN-TÊTE d'un manuscrit — le titre, les auteurs et leurs affiliations, tels
 * qu'ils sont écrits en tête du document :
 *
 *   Aphid transmission of a new potyvirus infecting pepper crops in Italy
 *   Mario Rossi1, Anna Bianchi1, Jean Dupont2
 *   1 Dipartimento di Agraria, Università di Napoli Federico II, Portici, Italy
 *   2 INRAE, UMR Biologie du Fruit, Villenave d'Ornon, France
 *
 * @param {Array} blocks  le corps du document (blocksFromText / splitManuscript)
 * @returns {{ title: string, authors: string, affiliations: string,
 *             blocks: Array, lines: Array }}  `affiliations` garde une ligne par
 *             affiliation, `blocks` = les blocs consommés (à NE PAS réimporter
 *             comme texte) et `lines` = la zone d'en-tête telle qu'elle a été
 *             comprise ({ at, text, role }) — c'est elle que la fenêtre
 *             d'import affiche pour laisser CORRIGER les rôles à la main
 *             (voir headerFromLineRoles). Rien n'est deviné au hasard : sans
 *             ligne reconnaissable, les trois champs restent vides. Quand il
 *             MANQUE le titre ou les auteurs, `lines` va plus loin que la
 *             fenêtre et propose les lignes qui ressemblent à des noms / à une
 *             adresse (voir extraHeaderLines) : c'est ce qui rattrape les
 *             documents qui impriment leurs auteurs sous le résumé, au lieu de
 *             les laisser tomber dans « Background ».
 */
export const parseManuscriptHeader = (blocks) => {
  const list = Array.isArray(blocks) ? blocks : [];
  const empty = { title: '', authors: '', affiliations: '', blocks: [], lines: [] };

  /* 1. La FENÊTRE : les premières lignes, jusqu'à la première vraie section. */
  const window = [];
  for (let i = 0; i < Math.min(list.length, HEADER_SCAN); i += 1) {
    const s = String((list[i] && list[i].text) || '').trim();
    if (!s) continue;
    /* Une FIGURE (« [[FIGURE 1]] ») est INVISIBLE pour l'en-tête : elle n'est
       ni un titre ni une ligne à importer, et elle reste à sa place dans le
       texte (voir la section « Les FIGURES du document »). */
    if (isFigureMark(s)) continue;
    const role = classifyHeaderLine(s);
    const label = headingLabel(s);
    if (role === 'section' || guessSectionForHeading(label) || REFERENCE_HEADING_RE.test(label)) break;
    /* UNE LONGUE LISTE D'AUTEURS N'ARRÊTE PAS L'EN-TÊTE. « Paragraphe de corps
       de texte » se juge à la LONGUEUR (plus de 200 caractères) : une liste de
       dix-huit auteurs et de leurs exposants la dépasse, et la fenêtre
       s'arrêtait AVANT elle — la ligne n'était donc jamais examinée, et le
       champ « Authors » restait vide (défaut signalé). Ce qui est vraiment du
       corps de texte, lui, ne passe pas les lecteurs d'auteurs : chaque
       morceau doit être un NOM (voir isAuthorLineAtPosition). */
    if (role !== 'heading' && isBodyParagraph(s) && !isAuthorLineAtPosition(s)) break;
    window.push({ at: i, text: s, role });
  }
  if (!window.length) {
    /* AUCUNE ligne d'en-tête reconnue (le document commence par un paragraphe
       de corps de texte ou par un intitulé de section) : les premières lignes
       sont quand même MONTRÉES, en « keep » — elles restent dans le texte, mais
       l'utilisateur peut désigner d'un clic celles qui sont le titre, les
       auteurs ou les affiliations. Une fenêtre vide ne lui laissait rien à
       faire. */
    return { ...empty, lines: firstHeaderLines(list) };
  }
  const roles = window.map((w) => w.role);
  const isCand = (r) => r === 'text' || r === 'heading';

  /* 2. Le TITRE : la DERNIÈRE ligne candidate avant les auteurs (un export met
     volontiers le nom du fichier ou la date avant le vrai titre) ; quand aucune
     liste d'auteurs n'est reconnue, la PREMIÈRE candidate — les métadonnées
     (DOI, dates, mots-clés) ne sont jamais candidates. */
  const explicitAuthors = roles.indexOf('authors');
  const textIdx = roles.map((r, i) => (isCand(r) ? i : -1)).filter((i) => i !== -1);
  const asTitle = (i) => i >= 0 && isTitleCandidate(window[i].text, (window[i + 1] || {}).text);
  let titleIdx = -1;
  if (explicitAuthors !== -1) {
    const before = textIdx.filter((i) => i < explicitAuthors);
    for (let i = before.length - 1; i >= 0 && titleIdx === -1; i -= 1) if (asTitle(before[i])) titleIdx = before[i];
  } else {
    for (let i = 0; i < textIdx.length && titleIdx === -1; i += 1) if (asTitle(textIdx[i])) titleIdx = textIdx[i];
  }

  /* 3. Les AUTEURS : les lignes de noms à la suite du titre (un auteur par
     ligne quand l'export coupe la liste). Quand aucun marqueur d'auteur ne les
     trahit (« Anna Bianchi, Mario Rossi », deux noms nus) — ou que le marqueur
     est une LETTRE (« Mario Rossi a, Anna Bianchi b », Elsevier / Springer) —
     c'est leur POSITION, entre le titre et les affiliations, qui les désigne
     (voir looksLikeNameListLine).
     TROIS rattrapages, appris des documents réels où « les auteurs ne sont
     toujours pas reconnus » :
       • la ligne qui suit le titre n'a plus besoin d'être IMMÉDIATEMENT la
         suivante (une image de page de titre, une ligne sautée la séparaient) ;
       • le repli de position lit aussi les écritures que les trois lecteurs
         stricts refusent — « M. Rossi, A. Bianchi », « ROSSI M, BIANCHI A »
         (voir looksLikeLooseAuthorLine) ;
       • même SANS titre reconnu, une vraie ligne d'auteurs est retenue : un
         document dont le titre est mal écrit ne doit pas faire perdre les
         auteurs. */
  let firstAuthors = explicitAuthors;
  /* La ligne qui SUIT le titre est reconnue par les mêmes lecteurs par position
     que ceux qui la garderont ensuite (voir isFirstAuthorLine) : les marqueurs
     d'auteur, la liste de noms NUS, le repli souple (« M. Rossi, A. Bianchi »,
     « ROSSI M, BIANCHI A ») et la liste dont chaque nom porte son numéro en
     tête (« 1 Mario Rossi, 2 Anna Bianchi »). Une ligne d'ADRESSE ou un
     intitulé de section n'est jamais une liste d'auteurs. */
  if (firstAuthors === -1 && titleIdx >= 0 && window[titleIdx + 1]
    && window[titleIdx + 1].role !== 'affiliations'
    && window[titleIdx + 1].role !== 'section'
    && isFirstAuthorLine(window[titleIdx + 1].text)) {
    firstAuthors = titleIdx + 1;
  }
  if (firstAuthors === -1 && titleIdx === -1) {
    const i = roles.findIndex((r, k) => (r === 'authors' || r === 'heading' || r === 'text')
      && isAuthorLineAtPosition(window[k].text));
    if (i !== -1) firstAuthors = i;
  }
  /* UNE LISTE DE NOMS N'EST PAS UN TITRE : quand la ligne prise pour le titre
     EST une liste de noms et que la suivante est une adresse, cette ligne est la
     liste des AUTEURS — un titre suivi directement d'adresses, sans auteurs, ne
     se rencontre pas. Sans ce retournement, « Mario Rossi, Anna Bianchi » en tête
     de document devenait le TITRE du papier et le champ « Authors » restait vide.
     Le titre, lui, reste vide : l'utilisateur le désigne dans la fenêtre (mieux
     vaut un champ à remplir qu'un titre faux). */
  if (firstAuthors === -1 && titleIdx >= 0
    && looksLikeNameListLine(window[titleIdx].text)
    && window[titleIdx + 1] && window[titleIdx + 1].role === 'affiliations') {
    firstAuthors = titleIdx;
    titleIdx = -1;
  }

  const authorIdxs = [];
  if (firstAuthors !== -1) {
    for (let i = firstAuthors; i < window.length; i += 1) {
      const first = i === firstAuthors;
      if (roles[i] === 'authors') { authorIdxs.push(i); continue; }
      /* La position seule désigne la PREMIÈRE ligne de noms ; les suivantes
         doivent être adjacentes et ressembler encore à des noms. La première
         est jugée par le MÊME lecteur qui l'a désignée (voir
         isFirstAuthorLine) : elle ne peut pas être reconnue puis refusée. */
      if (!authorIdxs.length && !(first && explicitAuthors === -1)) break;
      if (isCand(roles[i]) && (first || window[i - 1].at === window[i].at - 1)
        && (first ? isFirstAuthorLine(window[i].text) : isNameLineContinuing(window[i].text))) {
        authorIdxs.push(i); continue;
      }
      break;
    }
  }

  /* 4. Les AFFILIATIONS : TOUTES les lignes d'adresse et d'e-mail de
     l'en-tête, dans l'ordre du document — et l'e-mail de l'auteur correspondant
     en DERNIER (voir headerFromLineRoles).
     POURQUOI on scanne toute la fenêtre au lieu de s'arrêter à la première
     ligne qui n'est pas une adresse : les métadonnées qui s'intercalent
     (« Keywords: … », « Correspondence to: … ») coupaient la suite, et la ligne
     de l'auteur correspondant — celle qui porte les e-mails — se retrouvait
     consommée en « non importé » : le projet perdait l'adresse de
     correspondance du papier (signalé par l'utilisateur : « la ligne des
     auteurs correspondants n'est pas allée à la fin des affiliations »).
     Une adresse SANS mot d'institution (« 2015 Upper Street, Raleigh, NC
     27695, USA ») continue l'affiliation qui la précède — elle n'est jamais
     prise ailleurs, le corps du texte vient après l'en-tête. */
  const affIdxs = [];
  const affFrom = titleIdx >= 0 ? titleIdx : 0;
  for (let i = affFrom; i < window.length; i += 1) {
    if (roles[i] === 'affiliations') { affIdxs.push(i); continue; }
    if (!affIdxs.length || window[i].at !== window[i - 1].at + 1) continue;
    if (roles[i] === 'text' && looksLikeAddressLine(window[i].text)) affIdxs.push(i);
  }

  /* 5. La ZONE consommée : jusqu'à la dernière ligne d'en-tête, en emportant les
     métadonnées qui la suivent (« Keywords: », « Correspondence: ») — elles ne
     sont pas du texte de section. */
  const assigned = [titleIdx, ...authorIdxs, ...affIdxs].filter((i) => i >= 0);
  const roleOf = (i) => (i === titleIdx ? 'title'
    : authorIdxs.includes(i) ? 'authors'
      : affIdxs.includes(i) ? 'affiliations' : 'ignore');

  /* 5 bis. RIEN de reconnu (ni titre, ni auteurs, ni affiliations) : on ne
     consomme AUCUNE ligne — elles disparaîtraient de l'import — et on les
     propose telles quelles, en « keep » (elles restent dans le texte tant que
     l'utilisateur ne les reclasse pas). */
  if (!assigned.length) {
    return {
      ...empty,
      lines: [
        ...window.map((w) => ({ at: w.at, text: w.text, role: KEEP_ROLE })),
        ...extraHeaderLines(list, window)
      ]
    };
  }
  let end = Math.max(...assigned);
  while (window[end + 1] && roles[end + 1] === 'ignore') end += 1;

  const lines = window.slice(0, end + 1).map((w, i) => ({
    at: w.at,
    text: w.text,
    role: roleOf(i)
  }));

  /* 6. Le REPLI : quand il MANQUE le titre ou les auteurs, les lignes qui
     ressemblent à des noms — ou à une adresse juste après eux — et qui viennent
     APRÈS la zone consommée sont proposées elles aussi, avec leur rôle deviné.
     C'est le document qui imprime ses auteurs sous le résumé, ou une liste de
     noms sans marqueur : sans ce repli, ces lignes retombaient dans la première
     section (« Background »). Rien n'est écrit en douce — la fenêtre d'import
     les montre une par une, et « keep in the section text » les rend au texte. */
  const found = headerFromLineRoles(list, lines);
  const more = (found.title && found.authors) ? [] : extraHeaderLines(list, window);
  return more.length
    ? { ...headerFromLineRoles(list, [...lines, ...more]), lines: [...lines, ...more] }
    : { ...found, lines };
};

/** Découpe le CORPS du manuscrit en groupes menés par un titre : chaque groupe
 *  est une partie du texte, avec la section du projet devinée. Les blocs qui
 *  précèdent le premier titre forment un groupe sans titre (chapeau / résumé) :
 *  `id` reste vide et l'utilisateur tranche dans la fenêtre d'import.
 *  `header` (voir parseManuscriptHeader) retire de ces parties les lignes du
 *  titre / des auteurs / des affiliations : elles vont dans les champs
 *  « Title, authors & affiliations » du projet, jamais dans une section. */
export const groupManuscriptParts = (blocks, { header = null } = {}) => {
  const skip = new Set(header && Array.isArray(header.blocks) ? header.blocks : []);
  const parts = [];
  let current = null;
  (Array.isArray(blocks) ? blocks : []).forEach((b) => {
    if (skip.has(b)) return;
    if (b.kind === 'heading') {
      const heading = headingLabel(b.text);
      if (REFERENCE_HEADING_RE.test(heading)) return;
      current = { heading, id: guessSectionForHeading(heading), blocks: [] };
      parts.push(current);
      return;
    }
    if (!current) { current = { heading: '', id: '', blocks: [] }; parts.push(current); }
    current.blocks.push(b);
  });
  return parts
    .filter((p) => p.blocks.length > 0)
    .map((p) => ({ ...p, text: p.blocks.map((b) => b.text).join('\n\n') }));
};

/* ── 3 quater. OÙ VA CHAQUE FIGURE DU DOCUMENT ────────────────────────────────

   La plainte : « avant, l'import du manuscrit importait les figures, maintenant
   elles sont perdues ». Deux chemins les faisaient disparaître SANS LE DIRE :

     • une partie que l'utilisateur n'a pas dirigée vers une section (« — do not
       import — », ou le chapeau d'un document sans titre) était sautée en
       entier — sa figure avec elle : `if (!p.dest) return` ;
     • une figure dont le marqueur était tombé dans une ligne de l'EN-TÊTE
       (titre / auteurs / affiliations, ces blocs sont retirés du texte) n'était
       plus vue du tout : son rang restait dans `figures`, sans place.

   Ici, la place de CHAQUE figure est calculée sur le document entier : la
   section de la partie qui la porte quand elle en a une (l'en-tête et le champ
   « Matériel et méthodes », eux, ne peuvent pas afficher d'image : la figure va
   alors dans la section que sa partie visait, sinon dans la première section de
   texte), et à défaut la section de la partie la plus proche. Rien n'est jamais
   perdu en silence : `rerouted` compte les figures ainsi replacées et
   l'utilisateur le lit dans le compte rendu de l'import.

   @returns {{ placements:Array<{section,index,anchor}>, rerouted:number,
               orphans:number, sections:Array<string> }}
              `orphans` = figures du document dont le marqueur n'existe plus
              dans le texte (elles sont posées quand même).
*/
export const manuscriptFigurePlacements = (parts, figures = [], { focusSection = '' } = {}) => {
  const list = Array.isArray(parts) ? parts : [];
  const textSections = PROJECT_TEXT_SECTIONS.map((s) => s.id);
  const fallback = String(focusSection || '').trim() || textSections[0];
  /* La section qui peut VRAIMENT afficher cette partie : l'en-tête est un champ
     de texte, « Matériel et méthodes » aussi — la figure va dans la section que
     la partie visait, ou dans la première section de texte. */
  const sectionOf = (part) => {
    const dest = String((part && part.dest) || '').trim();
    if (!dest) return '';
    if (isHeaderDest(dest)) return String((part && part.guessed) || '').trim() || fallback;
    if (dest === METHODS_DEST.id) return 'discussion';
    return dest;
  };
  const perPart = list.map((p) => ({ part: p, section: sectionOf(p), marks: figureMarksIn((p && p.text) || '') }));
  const placements = [];
  perPart.forEach(({ section, marks }, i) => {
    marks.forEach((m) => placements.push({ section, index: m.index, anchor: m.anchor, at: i }));
  });
  const placed = new Set(placements.map((p) => p.index));
  /* Une figure dont le marqueur a disparu du texte (ligne avalée par l'en-tête,
     document recollé) est posée quand même : on ne perd pas des pixels. */
  const orphans = (Array.isArray(figures) ? figures : [])
    .map((f) => Number(f && f.index) || 0)
    .filter((n) => n > 0 && !placed.has(n));
  orphans.forEach((n) => placements.push({ section: '', index: n, anchor: '', at: -1 }));
  const nearestSection = (at) => {
    if (at < 0) return '';
    for (let i = at + 1; i < perPart.length; i += 1) if (perPart[i].section) return perPart[i].section;
    for (let i = at - 1; i >= 0; i -= 1) if (perPart[i].section) return perPart[i].section;
    return '';
  };
  let rerouted = 0;
  placements.forEach((p) => {
    if (p.section) return;
    p.section = nearestSection(p.at) || fallback;
    rerouted += 1;
  });
  return {
    placements: placements.map(({ section, index, anchor }) => ({ section, index, anchor })),
    rerouted,
    orphans: orphans.length,
    sections: [...new Set(placements.map((p) => p.section))]
  };
};

/* ── 4. HTML écrit dans la section du projet ──────────────────────────────── */

/** Échappe le texte destiné au contenu riche : un .docx / une page Web ne
 *  doivent jamais apporter leurs scripts ni leur mise en page au projet. */
export const escapeHtml = (s) => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Le texte d'une partie → HTML simple (un <p> par paragraphe). Les citations
 *  doivent avoir été remplacées AVANT (voir convertCitationsInText). */
export const htmlFromText = (text) => String(text || '')
  .split(/\n{2,}|\n/)
  .map((p) => p.trim())
  .filter(Boolean)
  .map((p) => `<p>${escapeHtml(p)}</p>`)
  .join('\n');

/**
 * Le HTML d'une PARTIE du manuscrit, tel qu'il entre dans la section du projet :
 *
 *   • les marqueurs de figure sortent (la figure rejoint les figures de la
 *     section, voir figureMarksIn) ;
 *   • chaque paragraphe reprend la MISE EN FORME du document quand elle est
 *     connue (`htmlByText`, un .docx : gras, italique, exposants, indices) ;
 *     sinon le texte est simplement échappé ;
 *   • CHAQUE LIGNE DEVIENT UN PARAGRAPHE (`<p>…</p>`). C'est indispensable :
 *     un HTML où les paragraphes ne sont séparés que par des « \n » s'affiche
 *     COLLÉ (le navigateur avale les sauts de ligne) — la plainte « les sauts
 *     de ligne sont perdus à l'import » — et, comme aucun `</p>` ne suivait
 *     l'ancre d'une figure, TOUTES les figures du document se retrouvaient à
 *     la fin de la section dans le document exporté (voir utils/figurePlacement.js,
 *     blockEndAfter) au lieu de rester à l'endroit où elles étaient dans
 *     l'article ;
 *   • les citations sont converties dans les numéros du PROJET si `numbers` est
 *     fourni (c'est le même travail que sur le texte, mais dans le HTML).
 *
 * Les heuristiques (titres, citations, en-tête) continuent de lire le TEXTE :
 * ce HTML ne sert qu'à écrire la section. */
export const htmlFromManuscriptPart = (text, { htmlByText = null, numbers = null } = {}) => {
  const htmlFor = lineHtmlReader(htmlByText);
  const html = normalizeText(stripFigureMarks(text))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${htmlFor(line) || escapeHtml(line)}</p>`)
    .join('\n');
  return numbers ? convertCitationsInText(html, numbers).text : html;
};

/* ── 5. Les citations du texte → les références NUMÉROTÉES du programme ───── */

/** Citation numérique : [12], [3,4], [5-7], [1;2] — espaces tolérés. */
export const NUMERIC_CITATION_RE = /\[\s*(\d{1,4}(?:\s*(?:[,;]|-|–|—|to)\s*\d{1,4})*)\s*\]/g;

/** Citation numérique entre PARENTHÈSES — le style EndNote/Word : (12), (3,4),
 *  (5-7). 1 à 3 chiffres SEULEMENT : une année — « (2021) » — n'est donc jamais
 *  prise pour la référence n° 2021 (aucun numéro de référence n'a 4 chiffres). */
export const PAREN_CITATION_RE = /\(\s*(\d{1,3}(?:\s*(?:[,;]|-|–|—|to)\s*\d{1,3})*)\s*\)/g;

/** Les chiffres EXPOSANTS Unicode (« ¹² ») — ce qu'un copier-coller depuis
 *  Word, un PDF ou un export EndNote en exposant laisse dans le texte. */
const SUP_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** Citation en EXPOSANT : « …as shown previously¹² », « …see⁵⁻⁷ ». */
export const SUPERSCRIPT_CITATION_RE = new RegExp(
  `([${SUP_DIGITS}]+(?:[⁻-][${SUP_DIGITS}]+)?(?:\\s*[,;]\\s*[${SUP_DIGITS}]+(?:[⁻-][${SUP_DIGITS}]+)?)*)`,
  'g'
);

/** Citation en exposant écrite en HTML (texte enrichi) : « previously<sup>12</sup> ». */
export const HTML_SUPERSCRIPT_CITATION_RE =
  /<sup\b[^>]*>\s*(\d{1,4}(?:\s*(?:[,;]|-|–|—|to)\s*\d{1,4})*)\s*<\/sup>/gi;

/** « ¹² » → « 12 », « ⁵⁻⁷ » → « 5-7 » : l'exposant redevient un nombre lisible. */
export const superscriptToDigits = (s) => String(s || '')
  .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => String(SUP_DIGITS.indexOf(c)))
  .replace(/\u207B/g, '-');

/** L'inverse : « 12 » → « ¹² » — pour qu'un lien de citation garde l'EXPOSANT
 *  que l'auteur avait écrit (le nombre reste lisible, à sa place). */
export const digitsToSuperscript = (s) => String(s == null ? '' : s)
  .replace(/\d/g, (d) => SUP_DIGITS[Number(d)])
  .replace(/-/g, '\u207B');

/** Citation auteur-année : (Rossi et al., 2018) ; (Smith & Bianchi 2020a).
 *  Volontairement bornée (160 caractères, pas de parenthèse imbriquée) pour ne
 *  jamais avaler un paragraphe entier. */
export const AUTHOR_YEAR_CITATION_RE = /\(([^()\n]{1,160}?(?:19|20)\d{2}[a-z]?)\)/g;

const NUMERIC_RANGE_RE = /^(\d{1,4})\s*(?:-|–|—|to)\s*(\d{1,4})$/;

/** Numéros cités par une citation numérique, dans l'ordre ([5-7] → 5, 6, 7). */
export const numericCitationNumbers = (group) => {
  const out = [];
  String(group || '').split(/\s*[,;]\s*/).forEach((chunk) => {
    const s = String(chunk).trim();
    const range = s.match(NUMERIC_RANGE_RE);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (to >= from && to - from <= 50) { for (let i = from; i <= to; i += 1) out.push(i); }
      else { out.push(from); out.push(to); }
      return;
    }
    if (/^\d{1,4}$/.test(s)) out.push(Number(s));
  });
  return out;
};

/* Ce qui, JUSTE AVANT une citation, trahit autre chose qu'une citation : un mot
   court ou un nombre collé (« m² », « 10⁻³ », « Ca²⁺ »), un appel de fonction
   (« f(3) », « sin(2) »), un degré. Un manuscrit en est plein : sans ce
   garde-fou, « m2 » deviendrait « m[2] » et « sin(2) » un lien vers la
   référence 2. Une vraie citation est précédée d'un mot long, d'une espace ou
   d'une ponctuation (« …shown previously(12) », « …the data (12) »).
   Limite assumée : une parenthèse DÉTACHÉE qui n'est pas un renvoi — « as in Eq
   (3) », « from Fig. (2) » — passe ce garde-fou et est liée si le projet a une
   référence 3 ou 2. Aucun indice textuel ne permet de trancher, et le lien est
   bénin : le numéro reste visible, à sa place, et se retire en éditant la
   section. */
/* Les LETTRES d'un mot : latin (accents compris), grec, cyrillique. Les
   exposants Unicode (« ¹³ », « ᵃ ») n'en font pas partie, et une écriture sans
   espace entre les mots (chinois, japonais) non plus : là, rien ne distinguerait
   un isotope d'un renvoi collé au mot suivant. */
const WORD_LETTER = 'A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF';
const UNIT_BEFORE_RE = new RegExp(`(?:^|[^${WORD_LETTER}])(?:[${WORD_LETTER}]{1,3}|\\d+(?:[.,]\\d+)?|°)$`);
/** Le dernier caractère d'un MOT : une lettre, un chiffre ou « _ ». */
const WORD_TAIL_RE = new RegExp(`[${WORD_LETTER}\\d_]$`);
/** Un caractère qui OUVRE un mot — « ¹³C NMR », « ¹H » (voir
 *  citationContextOkAfter : un renvoi ne précède jamais le mot qu'il cite). */
const OPENS_WORD_RE = new RegExp(`^[${WORD_LETTER}]`);
/** Un opérateur — la signature d'un CALCUL (« x + y », « m·s⁻¹ »). */
const MATH_OPERATOR_RE = /[=+\-×÷·*/^<>≈≤≥±→]/;
/** Trois lettres suivies : un MOT (donc pas une expression). */
const WORDY_RE = new RegExp(`[${WORD_LETTER}]{3,}`);

/** L'indice de l'ouvrante qui correspond à la FERMANTE finale, ou -1 :
 *  « (x + y) » → l'indice de sa parenthèse (même paire seulement). */
const matchingOpenIndex = (s) => {
  const text = String(s == null ? '' : s);
  const close = text[text.length - 1];
  const open = { ')': '(', ']': '[', '}': '{' }[close];
  if (!open) return -1;
  let depth = 0;
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (text[i] === close) depth += 1;
    else if (text[i] === open) { depth -= 1; if (!depth) return i; }
  }
  return -1;
};

/** L'exposant ferme-t-il une EXPRESSION entre parenthèses — « (x + y)² » ?
 *  Le groupe doit être un CALCUL (un opérateur y suffit) ou ne contenir aucun
 *  mot (« (2) ») ; « (see the review)¹² » reste donc une citation. */
const closesMathGroup = (before) => {
  const s = String(before == null ? '' : before);
  const close = s[s.length - 1];
  if (close !== ')' && close !== ']' && close !== '}') return false;
  const open = matchingOpenIndex(s);
  if (open === -1) return false;
  const inner = s.slice(open + 1, -1);
  return MATH_OPERATOR_RE.test(inner) || !WORDY_RE.test(inner);
};

/** Le moins exposant Unicode (« 10⁻³ »). */
const SUP_MINUS = '\u207B';

/** Le texte écrit AVANT la citation permet-il d'en faire une ? (voir ci-dessus) */
export const citationContextOkBefore = (before) => {
  const raw = String(before == null ? '' : before);
  /* « 10⁻³ » : le moins exposant annonce une puissance, jamais une citation. */
  if (raw.endsWith(SUP_MINUS)) return false;
  const s = superscriptToDigits(raw); // les exposants redeviennent des chiffres
  if (!WORD_TAIL_RE.test(s)) return true;
  return !UNIT_BEFORE_RE.test(s);
};

/**
 * Le texte écrit APRÈS la citation permet-il d'en faire une ?
 *
 * Un renvoi vient APRÈS le mot qu'il documente — « …as shown previously¹² and
 * elsewhere » — et JAMAIS avant. Un exposant suivi d'une LETTRE ouvre donc un
 * mot, et non un renvoi : « ¹³C NMR », « ¹H », « ³¹P », « ¹⁹F », « ¹³C-labelled »
 * sont des ISOTOPES (le petit nombre y est le nombre de MASSE), « ²H₂O » un
 * composé. Les lier écrivait « [13]C NMR » dans le texte de l'auteur — le défaut
 * signalé. Aucun style bibliographique n'écrit un renvoi AVANT le mot qu'il
 * documente : la lettre qui suit est donc un veto. (Suivi d'une espace, d'une
 * ponctuation, d'un chiffre ou de la fin du texte, l'exposant reste une
 * citation : « previously¹²,¹³ », « previously¹². », « previously ¹² at ».)
 */
export const citationContextOkAfter = (after) => !OPENS_WORD_RE.test(String(after == null ? '' : after));

/** Un EXPOSANT — la seule écriture d'un renvoi qui puisse être autre chose :
 *  un isotope (« ¹³C »), un exposant d'unité (« m² ») ou de formule (« χ² »). */
export const isSuperscriptForm = (form) => form === 'sup' || form === 'sup-html';

/**
 * LES GARDE-FOUS DE CONTEXTE RÉUNIS : ce renvoi en est-il vraiment un ?
 * `before` = le texte qui précède la citation, `after` = celui qui la suit
 * (voir citationContextOkBefore et citationContextOkAfter ci-dessus).
 *
 * Ils ne s'appliquent qu'aux EXPOSANTS qui ne portent qu'UN SEUL nombre (voir
 * citationGuardApplies) : un « [12] » entre crochets n'est jamais un isotope, et
 * « …see³,¹² » est une citation sans discussion.
 */
export const citationPassesGuards = (before, after, { form = '', nums = [] } = {}) => {
  if (!citationGuardApplies(form, nums)) return true;
  if (!citationContextOkBefore(before)) return false;
  if (!isSuperscriptForm(form)) return true;
  /* Les deux pièges de l'exposant : il FERME une formule (« (x + y)² ») ou il
     OUVRE un mot (« ¹³C »). */
  if (closesMathGroup(before)) return false;
  return citationContextOkAfter(after);
};

/** Idem, à partir du texte entier, de la position et de la LONGUEUR du renvoi. */
export const citationContextOk = (text, index, length, form, nums) => {
  const s = String(text == null ? '' : text);
  const from = Math.max(0, Number(index) || 0);
  const to = from + Math.max(0, Number(length) || 0);
  return citationPassesGuards(s.slice(0, from), s.slice(to), { form, nums });
};

/** Le garde-fou de contexte s'applique-t-il ? Une unité (« m² », « 10⁻³ »), une
 *  charge (« Ca²⁺ ») ou un ordinal (« 5th ») n'ont qu'UN SEUL nombre : un exposant
 *  qui en porte plusieurs (« …see³,¹² ») est donc une citation sans discussion. */
export const citationGuardApplies = (form, nums) =>
  !((form === 'sup' || form === 'sup-html') && (Array.isArray(nums) ? nums.length : 0) > 1);

/** Les numéros cités par une citation, QUELLE QUE SOIT sa forme
 *  (« sup » = exposant Unicode, à décoder d'abord). */
export const numbersOfCitation = (form, group) =>
  numericCitationNumbers(form === 'sup' ? superscriptToDigits(group) : group);

/** TOUTES les citations NUMÉRIQUES d'un texte, dans l'ordre d'apparition, avec
 *  leur FORME : 'bracket' [12], 'paren' (12), 'sup' ¹², 'sup-html' <sup>12</sup>.
 *  Brique commune au plan d'import et au texte enrichi des sections. */
export const findNumericCitations = (text) => {
  const s = String(text || '');
  const out = [];
  const scan = (re, form) => {
    const rx = new RegExp(re.source, re.flags);
    let m = rx.exec(s);
    while (m) {
      const nums = numbersOfCitation(form, m[1]);
      if (!citationContextOk(s, m.index, m[0].length, form, nums)) { m = rx.exec(s); continue; }
      out.push({ raw: m[0], group: m[1], offset: m.index, form });
      m = rx.exec(s);
    }
  };
  scan(NUMERIC_CITATION_RE, 'bracket');
  scan(PAREN_CITATION_RE, 'paren');
  scan(HTML_SUPERSCRIPT_CITATION_RE, 'sup-html');
  scan(SUPERSCRIPT_CITATION_RE, 'sup');
  return out.sort((a, b) => a.offset - b.offset);
};

/** Nom de famille du PREMIER auteur d'une liste (« Rossi M, Bianchi A » →
 *  « rossi »). C'est la clé de correspondance la plus robuste entre la
 *  bibliographie d'un manuscrit et un programme qui n'a pas les mêmes
 *  identifiants que Paperpile. */
export const firstSurnameOf = (authors) => {
  const first = String(authors || '')
    .split(/[,;]|\band\b|&/i)
    .map((s) => s.trim())
    .filter(Boolean)[0] || '';
  const m = first.match(/[A-Za-zÀ-ÿ'’-]{2,}/);
  return m ? m[0].toLowerCase() : '';
};

/** Clé auteur-année d'une citation (« Rossi et al., 2018 » → « rossi2018 ») —
 *  aussi utilisée pour une entrée de bibliographie (« Rossi M, Bianchi A » +
 *  2018 → « rossi2018 »). '' quand aucun nom ou aucune année n'est lisible. */
export const authorYearKeyOf = (text) => {
  const s = normalizeText(text || '');
  const years = s.match(/(19|20)\d{2}[a-z]?/g) || [];
  if (!years.length) return '';
  const year = String(years[years.length - 1]).toLowerCase();
  const idx = s.toLowerCase().lastIndexOf(year);
  const surname = firstSurnameOf(idx > 0 ? s.slice(0, idx) : '');
  return surname ? `${surname}${year}` : '';
};

/* ── 6. Le plan d'import : ce qui sera écrit, calculé AVANT toute écriture ── */

/** Cherche un numéro dans une Map OU un objet simple, en tolérant la lettre de
 *  l'année (« smith2020a » → « smith2020 »). 0 = non résolu. */
export const lookupNumber = (map, key) => {
  if (!map || !key) return 0;
  const get = (k) => (typeof map.get === 'function' ? map.get(k) : map[k]);
  const tries = [key, String(key).replace(/[a-z]$/, '')];
  for (const k of tries) {
    const v = get(k);
    if (typeof v === 'number' && v > 0) return v;
    if (v && typeof v.number === 'number' && v.number > 0) return v.number;
  }
  return 0;
};

/** TOUTES les citations d'un texte, dans l'ordre d'apparition, avec les clés
 *  qui serviront à les résoudre (« #3 » pour [3], « rossi2018 » pour
 *  (Rossi et al., 2018)) et leur forme (« bracket », « paren », « sup »). */
export const collectCitations = (text) => {
  const s = String(text || '');
  const out = findNumericCitations(s).map((c) => ({
    kind: 'numeric',
    form: c.form,
    raw: c.raw,
    offset: c.offset,
    keys: numbersOfCitation(c.form, c.group).map((n) => `#${n}`)
  }));
  s.replace(AUTHOR_YEAR_CITATION_RE, (raw, inner, offset) => {
    const key = authorYearKeyOf(inner);
    out.push({ kind: 'author-year', raw, offset, keys: key ? [key] : [] });
    return raw;
  });
  return out.sort((a, b) => a.offset - b.offset);
};

/** Réécrit un texte pour que ses citations deviennent les marqueurs [n] du
 *  programme — CROCHETS, PARENTHÈSES (« (12) », style EndNote) et EXPOSANTS
 *  (« ¹² », « <sup>12</sup> ») confondus. Les citations NON résolues sont
 *  laissées telles quelles (rien n'est inventé) et renvoyées dans `unresolved`. */
export const convertCitationsInText = (text, numberByKey) => {
  let replaced = 0;
  const unresolved = [];
  let out = String(text || '');
  /* UNE LIGNE D'AUTEURS N'EST PAS DU TEXTE CITÉ : ses exposants sont les numéros
     des AFFILIATIONS (« Mario Rossi¹, Anna Bianchi² »). Quand l'utilisateur la
     garde dans la section (« keep in the section text »), la convertir écrivait
     « Mario Rossi[1], Anna Bianchi[2] » — jamais ce que l'auteur a écrit. Elle
     ressort donc telle quelle, quel que soit le numéro de référence en face. */
  if (isAuthorMarkLine(out)) return { text: out, replaced, unresolved };
  const convertForm = (re, form) => {
    out = out.replace(new RegExp(re.source, re.flags), (raw, group, offset) => {
      const cited = numbersOfCitation(form, group);
      /* « m² », « f(3) », « 10⁻³ », « (x + y)² », « ¹³C » ne sont pas des
         citations (voir les garde-fous de contexte ci-dessus). */
      if (!citationContextOk(out, offset, raw.length, form, cited)) return raw;
      const nums = cited.map((n) => lookupNumber(numberByKey, `#${n}`)).filter(Boolean);
      if (!nums.length) { unresolved.push(raw); return raw; }
      replaced += 1;
      return `[${nums.join(',')}]`;
    });
  };
  convertForm(NUMERIC_CITATION_RE, 'bracket');
  convertForm(PAREN_CITATION_RE, 'paren');
  convertForm(HTML_SUPERSCRIPT_CITATION_RE, 'sup-html');
  convertForm(SUPERSCRIPT_CITATION_RE, 'sup');
  out = out.replace(AUTHOR_YEAR_CITATION_RE, (raw, inner) => {
    const key = authorYearKeyOf(inner);
    const num = key ? lookupNumber(numberByKey, key) : 0;
    if (!num) { unresolved.push(raw); return raw; }
    replaced += 1;
    return `[${num}]`;
  });
  return { text: out, replaced, unresolved };
};

/**
 * LE PLAN COMPLET, calculé avant TOUTE écriture :
 *   • entries   — les références reconnues dans la bibliographie du document,
 *                 chacune avec le numéro qu'elle recevra (une entrée déjà citée
 *                 dans le projet garde SON numéro) ;
 *   • numberByKey — { '#3' → 5, 'rossi2018' → 6 } : la table de conversion des
 *                 citations ;
 *   • citations — toutes les citations du corps du texte, résolues ou non ;
 *   • unresolved — celles qu'aucune entrée de la bibliographie n'explique
 *                 (rien n'est inventé : elles restent telles quelles).
 * `existingReferences` = project.references (les références déjà numérotées).
 */
export const buildManuscriptPlan = (manuscript, { existingReferences = [] } = {}) => {
  const refs = Array.isArray(existingReferences) ? existingReferences : [];
  const entries = parseReferences(String((manuscript && manuscript.referencesText) || ''), { split: 'auto' });
  const known = new Map();
  refs.forEach((r) => entryKeys(r).forEach((k) => { if (!known.has(k)) known.set(k, r); }));
  let next = refs.reduce((max, r) => Math.max(max, Number(r && r.number) || 0), 0) + 1;
  const numberByKey = new Map();
  const planned = entries.map((entry, index) => {
    const already = entryKeys(entry).map((k) => known.get(k)).find(Boolean) || null;
    const number = already ? (Number(already.number) || next) : next;
    if (!already) next += 1;
    /* Le numéro que le DOCUMENT donnait à cette entrée (« 12. Rossi… » → 12) est
       celui que le texte CITE : c'est donc la clé à enregistrer. Le plan
       retombait sur la POSITION de l'entrée dans la bibliographie
       (`#index + 1`) : juste tant qu'une bibliographie commence à 1 et se suit,
       faux pour une bibliographie numérotée 10…40 (article révisé, extrait,
       bibliographie à trous) où chaque « [12] » désignait alors la 12e entrée.
       Sans numéro dans le document (auteur-année, RIS, BibTeX), la position
       reste le seul repère : elle est gardée. */
    const docNumber = Number(entry && entry.number) > 0 ? Number(entry.number) : index + 1;
    numberByKey.set(`#${docNumber}`, number);
    const ay = authorYearKeyOf(`${(entry && entry.authors) || ''} ${(entry && entry.year) || ''}`);
    if (ay && !numberByKey.has(ay)) numberByKey.set(ay, number);
    return { index, entry, number, isNew: !already, existing: already };
  });
  const blocks = ((manuscript && manuscript.body) || []).filter((b) => b && b.kind !== 'heading');
  const text = blocks.map((b) => b.text).join('\n\n');
  const citations = collectCitations(text).map((c) => ({
    ...c,
    numbers: c.keys.map((k) => lookupNumber(numberByKey, k)).filter(Boolean)
  }));
  return {
    entries: planned,
    numberByKey,
    citations,
    unresolved: citations.filter((c) => !c.numbers.length),
    nextNumber: next
  };
};

/** La « Project bibliography » après import : les entrées analysées sont
 *  AJOUTÉES (mergeReferenceEntries), rien n'est écrasé ni dupliqué. */
export const mergeManuscriptBibliography = (projectBib, entries, { project = {} } = {}) =>
  mergeReferenceEntries(
    Array.isArray(projectBib) ? projectBib : [],
    (Array.isArray(entries) ? entries : []).map((e) => projectBibEntry(e, project))
  );

/* ── 7. Reconnaître un document DÉJÀ importé (et compter ce qu'il cite) ───── */

/**
 * EMPREINTE d'un manuscrit (texte normalisé → une chaîne courte et stable).
 *
 * Elle est rangée dans le projet (`project.msImports`). Importer DEUX FOIS le
 * même document collait deux fois tout le texte des sections : la fenêtre
 * d'import restait ouverte après le premier import et le bouton « ✓ Import »
 * demeurait actif. Cette empreinte permet de prévenir et de refuser le doublon
 * au lieu de laisser l'utilisateur découvrir son texte en double.
 */
export const manuscriptFingerprint = (text) => {
  const s = normalizeText(text || '');
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  }
  return `ms${s.length.toString(36)}-${h.toString(36)}`;
};

/** Un import déjà enregistré dans le projet qui correspond à cette empreinte. */
export const previousImportOf = (project, fingerprint) => {
  const list = (project && Array.isArray(project.msImports)) ? project.msImports : [];
  return list.find((it) => it && it.hash === fingerprint) || null;
};

/** Les numéros cités par un texte ([12] → 12 ; [3,4] → 3, 4 ; [5-7] → 5, 6, 7 ;
 *  « (12) » et un exposant « ¹² » compris). Sert à DIRE ce qui n'a pas pu être
 *  lié à une référence. */
export const citedNumbersInText = (text) => {
  const out = new Set();
  findNumericCitations(String(text || ''))
    .forEach((c) => numbersOfCitation(c.form, c.group).forEach((n) => out.add(n)));
  return out;
};




