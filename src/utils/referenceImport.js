/* =========================================================================
   src/utils/referenceImport.js
   Importer des RÉFÉRENCES dans un projet — depuis le document lui-même.

   Trois besoins, un seul module :

   1. « Import from a paper (Paperpile / Word) » : la bibliographie d'un
      article (Google Docs exporté en .docx, .docx de Word, PDF dont on a copié
      le texte, export RIS/BibTeX de Paperpile/Zotero/EndNote) est transformée en
      entrées de la « Project bibliography » du projet. Cette liste est LA MÊME
      que celle affichée dans Publications → « Project bibliography » : les
      références apparaissent donc automatiquement aux deux endroits, et dans
      les références numérotées des sections du document de projet.

   2. « Recover papers from a backup » : un ancien fichier de sauvegarde (.html,
      écrit par « Save HTML » ou par la sauvegarde hebdomadaire Drive) est relu
      pour n'en extraire QUE les papiers — publications des scientifiques,
      « Relevant papers » et bibliographies de projets. Le reste du fichier
      n'est jamais appliqué : on complète/ajoute, on n'écrase rien.

   3. Les mêmes règles de fusion servent au chargement partiel (« Load HTML ») :
      `mergeReferenceEntries` / `mergePaperLists` n'ajoutent que ce qui manque
      et ne remplissent que les champs VIDES d'une entrée déjà présente.

   4. Le même fichier sait aussi rendre sa BIBLIOTHÈQUE D'IMAGES
      (`figuresFromBackupState` / `figuresFromBackupHtml` + `backupFigureCount`) :
      les images sont sur le Drive, mais la liste qui les affiche (libellés,
      vignettes, ordre) ne vit que dans le navigateur — un autre poste la
      retrouve donc par la sauvegarde.

   Aucune dépendance nouvelle : un .docx est un ZIP dont le texte vit dans
   word/document.xml — fflate (déjà utilisé par l'application) le décompresse.
   ========================================================================= */

import { unzipSync, strFromU8 } from 'fflate';

/** Extensions acceptées par les champs de fichier de l'interface. */
export const REFERENCE_FILE_ACCEPT = '.docx,.txt,.ris,.bib,.nbib,.xml,.html,.htm,.md';

/* ── Normalisation du texte ─────────────────────────────────────────────── */

export const normalizeText = (raw) => String(raw === undefined || raw === null ? '' : raw)
  .replace(/\r\n?/g, '\n')
  .replace(/\u00a0/g, ' ')
  .replace(/[\u2018\u2019\u201b]/g, "'")
  .replace(/[\u201c\u201d]/g, '"')
  .replace(/[\u2010-\u2015]/g, '-');

const decodeEntities = (s) => String(s || '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&mdash;/gi, '—')
  .replace(/&ndash;/gi, '–')
  .replace(/&amp;/gi, '&');

/* ── .docx → texte ──────────────────────────────────────────────────────── */

/**
 * Texte d'un document Word / Google Docs exporté en .docx.
 * Les CODES DE CHAMP (`w:instrText`) sont retirés : Paperpile / EndNote y
 * rangent le JSON de la citation, qui ne doit jamais finir dans le texte.
 * Chaque paragraphe devient une ligne — dans une bibliographie Paperpile, une
 * référence = un paragraphe.
 */
export const paragraphTextFromDocxXml = (xml) => String(xml || '')
  .replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g, '')
  .replace(/<w:delText\b[^>]*>[\s\S]*?<\/w:delText>/g, '')
  .replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, '')
  .replace(/<w:tab\b[^>]*\/?>/g, ' ')
  .replace(/<w:(?:br|cr)\b[^>]*\/?>/g, '\n')
  .replace(/<\/w:p>/g, '\n')
  .replace(/<w:t\b[^>]*>/g, '')
  .replace(/<[^>]+>/g, '')
  .split('\n')
  .map((line) => decodeEntities(line).replace(/\s+/g, ' ').trim())
  .filter(Boolean)
  .join('\n');

/** Texte d'un .docx fourni en octets (le corps + les notes de bas de page). */
export const docxTextFromBytes = (bytes) => {
  if (!bytes || !bytes.length) return '';
  let files = null;
  try {
    files = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  } catch { return ''; }
  const parts = [];
  ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml'].forEach((name) => {
    const entry = files[name];
    if (!entry) return;
    const text = paragraphTextFromDocxXml(strFromU8(entry));
    if (text) parts.push(text);
  });
  return parts.join('\n');
};

/** Texte d'un fichier HTML (page Web, article, citation exportée). */
export const htmlToText = (html) => paragraphTextFromDocxXml(String(html || '')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<br\b[^>]*\/?>/gi, '\n')
  /* Le `<title>` d'un export Google Docs est le NOM DU FICHIER : sans coupure
     après lui, il se collait au premier paragraphe (« Manuscrit v3 - Google
     DocsAphid transmission of… ») et le titre du papier devenait illisible. */
  .replace(/<\/(p|div|li|tr|h[1-6]|section|title|td|th|table|head|header|article|blockquote|figcaption)>/gi, '\n'));

/**
 * Lit un fichier déposé par l'utilisateur et retourne son texte.
 * (.docx → ZIP ; .html → texte de la page ; le reste → texte brut)
 */
export const readReferenceDocument = async (file) => {
  if (!file) return '';
  const name = String(file.name || '').toLowerCase();
  if (name.endsWith('.docx')) {
    const buf = await file.arrayBuffer();
    return normalizeText(docxTextFromBytes(new Uint8Array(buf)));
  }
  const raw = await file.text();
  if (name.endsWith('.html') || name.endsWith('.htm')) return normalizeText(htmlToText(raw));
  return normalizeText(raw);
};

/* ── Champs d'une référence ─────────────────────────────────────────────── */

/** DOI : la forme nue `10.xxxx/yyy` (sans URL, sans ponctuation finale). */
export const extractDoi = (value) => {
  const m = String(value || '').match(/10\.\d{4,9}\/[-._;()/:a-z0-9]+/i);
  return m ? m[0].replace(/[.,;)\]]+$/, '') : '';
};

/** Identifiant PubMed : « PMID: 123 », « PubMed/123 » ou « PubMed 123 ». */
export const extractPmid = (value) => {
  const s = String(value || '');
  const m = s.match(/\bpmid:?\s*(\d{6,9})\b/i)
    || s.match(/\bpubmed\s*(?:\/|:)?\s*(\d{6,9})\b/i);
  return m ? m[1] : '';
};

/** Année de publication : « (2019) » d'abord, sinon le premier 19xx/20xx. */
export const extractYear = (value) => {
  const s = String(value || '');
  const m = s.match(/\((1[89]\d{2}|20\d{2})[a-z]?\)/) || s.match(/\b(1[89]\d{2}|20\d{2})\b/);
  return m ? m[1] : '';
};

export const doiUrl = (doi) => (doi ? `https://doi.org/${doi}` : '');
export const pmidUrl = (pmid) => (pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : '');

const initialsOf = (given) => String(given || '')
  /* « W.-J. » : le trait d'union RELIE deux initiales (« Lu, W.-J. » → « Lu W-J »).
     Tant qu'il était traité comme un simple séparateur, la liste d'auteurs
     s'arrêtait après « W. » : le « -J. » resté en tête de la référence devenait
     le TITRE du papier et les auteurs étaient tronqués — c'est la référence
     « Lu, W.-J. et al. Mortalin-p53 interaction… » signalée. */
  .trim()
  .split(/\s*-\s*/)
  .map((part) => part.split(/[\s.,;]+/).filter(Boolean).map((w) => w[0].toUpperCase()).join(''))
  .filter(Boolean)
  .join('-');

/* Initiales d'un auteur : « J. », « JA », « M.A. », « W.-J. » — mais jamais la
   1re lettre du mot suivant (« Costa, L. Antimicrobial » : le « A » appartient
   au titre). Le TIRET relie deux initiales d'un même auteur (« W.-J. »), il ne
   sépare donc jamais deux auteurs. */
const INITIALS = '(?:[A-Z]\\.\\s*(?:-\\s*)?|[A-Z](?![a-z\\u00e0-\\u00ff])(?:-\\s*)?){1,4}';
const AUTHOR_PAIR = `([A-Z][\\p{L}'’.-]+),\\s*(${INITIALS})`;
const AUTHOR_PAIR_RE = () => new RegExp(AUTHOR_PAIR, 'gu');
/* ── UN AUTEUR, DANS TOUTES LES ÉCRITURES DES ÉDITEURS ───────────────────
   « Rossi M », « Rossi, M. », « Rossi MA », « M. Rossi », « M.A. Rossi »…
   Les initiales n'avalent JAMAIS la première lettre du mot suivant
   (« Costa, L. Antimicrobial » : le « A » commence le titre) ni le nom de
   l'auteur suivant d'une liste séparée par des points (« Rossi M. Bianchi A. »). */
const NAME_INITIALS = '(?:[A-Z]\\.?(?:-\\s*)?(?![a-z\\u00e0-\\u00ff])){1,4}';
const NAME_FAMILY = "[A-Z][\\p{L}'’.-]+";
/* Le nom de famille d'un auteur « Initiales Nom » doit être suivi d'une
   ponctuation, d'un autre auteur, de « et al. » ou de la fin du texte : sans
   cela « EPPO. Aphid transmission… » (auteur collectif) se lirait
   « EPPO. Aphid » et le titre serait amputé du premier mot. */
const INITIALS_FIRST_LOOKAHEAD =
  "(?=[,;.&]|\\s+[A-Z][\\p{L}'’.-]+\\s*[,;.&]|\\s+et\\.?\\s*al\\.?|\\s*$)";
/** Un auteur : « Nom Initiales » (Vancouver / Paperpile). Trois écritures,
 *  de la plus sûre à la plus risquée — sans ces garde-fous, « Is CMV » (début
 *  d'un titre) se lisait « auteur Is + initiales CMV » :
 *   • « Rossi, M. »  (virgule : aucun risque) ;
 *   • « Rossi M. »   (initiales POINTÉES : le point les identifie) ;
 *   • « Rossi M »    (sans point : seulement si la liste se ferme là —
 *     ponctuation, fin du texte ou « et al. »). */
const NAME_INITIALS_DOTTED = '[A-Z]\\.(?:-?\\s*[A-Z]\\.)*(?![a-z\\u00e0-\\u00ff])';
const AUTHOR_CLOSED = '(?=[,;.&]|\\s*$|\\s*\\(\\s*(?:1[89]|20)\\d{2}[a-z]?\\s*\\)|\\s+et\\.?\\s*al\\.?|\\s+(?:and\\s+others|&\\s*others))';
const FAMILY_FIRST_RE = () => new RegExp(
  `(?:${NAME_FAMILY}\\s*[,;]\\s*${NAME_INITIALS}`
  + `|${NAME_FAMILY}\\s+${NAME_INITIALS_DOTTED}`
  + `|${NAME_FAMILY}\\s+${NAME_INITIALS}${AUTHOR_CLOSED})`, 'uy');
/** …ou « Initiales Nom » (Elsevier, Harvard). */
const INITIALS_FIRST_RE = () => new RegExp(
  `${NAME_INITIALS}[,;.]?\\s+${NAME_FAMILY}${INITIALS_FIRST_LOOKAHEAD}`, 'uy');
/** Séparateur entre deux auteurs : ponctuation (virgule, point-virgule,
 *  esperluette, POINT des listes « Rossi M. Bianchi A. »), « and / et », ou
 *  une simple espace. Le point et l'espace ne sont acceptés que si un AUTEUR
 *  suit : un titre n'est donc jamais avalé (voir authorList). */
const AUTHOR_SEP_RE = /^(?:(?:\s*[,;.&]\s*)+|\s*\b(?:and|et)\b\s*|\s+)+/i;
/** Le marqueur de troncature d'une liste d'auteurs. */
const ET_AL_ONLY_RE = /^(?:et\.?\s*al\.?|and\s+others|&\s*others)$/i;
const ET_AL_HEAD_ONLY_RE = /^(?:et\.?\s*al\.?|and\s+others|&\s*others)\b/i;



/** « Smith, John A. » / « John A. Smith » → « Smith JA » (la convention AUTEUR
 *  utilisée partout ailleurs dans l'application : nom, puis initiales). */
export const formatAuthor = (value) => {
  const s = String(value || '').trim().replace(/\.+$/, '');
  if (!s) return '';
  if (s.includes(',')) {
    const idx = s.indexOf(',');
    const family = s.slice(0, idx).trim();
    const ini = initialsOf(s.slice(idx + 1));
    return ini ? `${family} ${ini}` : family;
  }
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 2) return s;
  const family = words.pop();
  const ini = initialsOf(words.join(' '));
  return ini ? `${family} ${ini}` : family;
};

export const formatAuthors = (list) => (Array.isArray(list) ? list : [])
  .map(formatAuthor).filter(Boolean).join(', ');

/**
 * Auteurs d'une bibliographie « texte » → convention du laboratoire
 * (« Smith J, Rossi M, Bianchi A »).
 * « Smith, J., Rossi, M., & Bianchi, A. » est reconnu et converti ; toute forme
 * inattendue (initiale collée, « et al. », mention d'équipe…) est laissée
 * INTACTE : mieux vaut citer la liste telle que l'éditeur l'affiche que la
 * perdre en la reformatant mal.
 */
/**
 * Liste d'auteurs en TÊTE d'un texte → `{ text, names, end }`, ou `null` si
 * le texte ne commence pas par des auteurs. Chaque auteur ajouté doit être
 * suivi d'un SÉPARATEUR **et** d'un auteur (ou de « et al. ») : c'est ce qui
 * garantit qu'un titre n'est jamais avalé — le défaut qui mettait un nom
 * d'auteur dans le champ TITRE (« Rossi M. Bianchi A. Titre… » se lisait
 * « auteurs = Rossi M », « titre = Bianchi A »).
 */
const authorList = (value) => {
  const body = String(value || '');
  const familyFirst = FAMILY_FIRST_RE();
  const initialsFirst = INITIALS_FIRST_RE();
  const names = [];
  let end = 0;
  let pos = 0;
  while (names.length < 40) {
    familyFirst.lastIndex = pos;
    initialsFirst.lastIndex = pos;
    const m = familyFirst.exec(body) || initialsFirst.exec(body);
    if (!m) break;
    /* Un mot TOUT EN MAJUSCULES et SANS POINT n'est jamais un auteur dans un
       texte capitalisé : « CHARACTERIZATION OF », « OF A POTYVIRUS »
       (bibliographie en majuscules) — la liste s'arrête là et l'entrée est
       lue comme avant (auteurs = 1re phrase). Un vrai « ROSSI M. » a un
       point, un vrai « Rossi M » a une minuscule. */
    if (!/[a-z\u00e0-\u00ff]/.test(m[0]) && !m[0].includes('.')) break;
    names.push(m[0]);
    end = pos + m[0].length;
    const sep = body.slice(end).match(AUTHOR_SEP_RE);
    if (!sep) break;
    const next = end + sep[0].length;
    if (ET_AL_HEAD_ONLY_RE.test(body.slice(next))) break;
    pos = next;
  }
  return names.length ? { text: body.slice(0, end), names, end } : null;
};

/** « Rossi, M. » / « M. Rossi » / « Rossi M » → « Rossi M » (convention du
 *  laboratoire : le nom, puis les initiales). */
const canonicalAuthor = (value) => {
  const s = String(value || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s.includes(',')) return formatAuthor(s);
  const words = s.split(' ');
  /* « W.-J. Lu » (initiales pointées reliées par un trait d'union) est reconnu
     comme la forme « initiales Nom » : sans le tiret, le nom restait dans
     l'ordre de l'éditeur et « W.-J. » devenait un TITRE pour les autres. */
  if (words.length > 1 && /^[A-Z](?:\.?-?[A-Z])*\.?$/.test(words[0])) {
    const family = words.slice(1).join(' ').replace(/[.,;]+$/, '');
    return `${family} ${words[0].replace(/\./g, '')}`.trim();
  }
  return s.replace(/[.,;]+$/, '');
};

export const normalizeAuthorList = (raw) => {
  const text = decodeEntities(String(raw || '')).replace(/\s+/g, ' ').trim().replace(/[.,;]+$/, '');
  if (!text) return '';
  /* Les écritures lues par authorList (les deux ordres, avec ou sans virgule)
     sont réécrites dans la convention du laboratoire : « M. Rossi, A. Bianchi »
     → « Rossi M, Bianchi A ». Le marqueur « et al. » est conservé. */
  const list = authorList(text);
  if (list) {
    const tail = text.slice(list.end).replace(/^[\s,;.&]+/, '').replace(/[\s,;.&]+$/, '');
    if (!tail || ET_AL_ONLY_RE.test(tail)) {
      const canonical = list.names.map(canonicalAuthor).filter(Boolean).join(', ');
      if (canonical) return tail ? `${canonical}, et al.` : canonical;
    }
  }
  const pairs = [...text.matchAll(AUTHOR_PAIR_RE())];
  if (!pairs.length) return text;
  const leftovers = text
    .replace(AUTHOR_PAIR_RE(), '')
    .replace(/&/g, '')
    .replace(/\bet\s+al\.?/gi, '')
    .replace(/\b(?:and|et)\b/gi, '')
    .replace(/[\s,;.]+/g, '');
  if (leftovers) return text;
  /* Le trait d'union d'« W.-J. » survit à la conversion « Nom, Initiales » :
     « Lu W-J », jamais « Lu W ». */
  return pairs.map((m) => `${m[1]} ${m[2].replace(/[^A-Za-z-]/g, '').replace(/-$/, '')}`).join(', ');
};

/** Titre nettoyé : sans numérotation d'entrée, sans point final, sans balises. */
export const cleanTitle = (value) => decodeEntities(String(value || ''))
  .replace(/^\s*(?:\[|\()?\d{1,3}[.)\]]?\s+/, '')
  .replace(/<[^>]+>/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/\.$/, '');

const LATEX_ACCENT = {
  '"': '\u0308', "'": '\u0301', '`': '\u0300', '^': '\u0302', '~': '\u0303',
  '=': '\u0304', '.': '\u0307', u: '\u0306', v: '\u030c', H: '\u030b', r: '\u030a'
};

/** BibTeX écrit les accents en LaTeX : « M{\"u}ller » → « Müller ». */
export const decodeLatex = (value) => String(value || '')
  .replace(/\{\\ss\}/g, 'ß')
  .replace(/\{\\(ae|AE|oe|OE|aa|AA|o|O|l|L)\}/g, (m, code) => ({
    ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', aa: 'å', AA: 'Å', o: 'ø', O: 'Ø', l: 'ł', L: 'Ł'
  }[code] || ''))
  .replace(/\\([`'^"~=.])\s*\{?([a-zA-Z])\}?/g, (m, acc, ch) => ch + (LATEX_ACCENT[acc] || ''))
  .replace(/\\([cvuHkr])\s*\{?([a-zA-Z])\}?/g, (m, acc, ch) => ch + (LATEX_ACCENT[acc] || ''))
  .replace(/\{\\[a-zA-Z]+\}/g, '')
  .replace(/[{}]/g, '')
  .normalize('NFC');

/** Une référence normalisée — la forme commune à tous les formats d'entrée. */
const makeEntry = (part) => {
  const doi = extractDoi(part.doi || '') || extractDoi(part.link || '');
  const pmid = part.pmid || extractPmid(part.raw || '');
  return {
    title: cleanTitle(part.title),
    authors: String(part.authors || '').trim(),
    journal: String(part.journal || '').trim(),
    year: String(part.year || '').trim(),
    doi,
    pmid: String(pmid || ''),
    volume: String(part.volume || '').trim(),
    pages: String(part.pages || '').trim(),
    link: String(part.link || '').trim(),
    /* LE NUMÉRO QUE LA BIBLIOGRAPHIE DONNAIT À CETTE RÉFÉRENCE (« 12. Rossi… »
       → 12), 0 quand le format n'en porte pas (RIS, BibTeX). C'est ce numéro
       qui permet de retrouver le « [12] » écrit dans le TEXTE : sans lui, une
       référence importée pourrait recevoir un autre numéro et le lien du texte
       mènerait au mauvais papier (voir utils/referenceLinks.js). */
    number: Number(part.number) || 0,
    /* Texte d'origine : sert seulement à NOTER la référence (sections 1-3 de
       l'analyse) ; `projectBibEntry` ne le recopie jamais dans le projet. */
    raw: String(part.raw || '').trim(),
    source: part.source || 'document'
  };
};

/* ── RIS (Paperpile, Zotero, EndNote, PubMed…) ──────────────────────────── */

const RIS_LINE = /^([A-Z][A-Z0-9])\s{1,2}-\s?(.*)$/;

export const parseRisRecords = (rawText) => {
  const records = [];
  let cur = null;
  normalizeText(rawText).split('\n').forEach((line) => {
    const m = line.match(RIS_LINE);
    if (!m) return;
    const tag = m[1];
    const value = String(m[2] || '').trim();
    if (tag === 'TY') { cur = {}; records.push(cur); return; }
    if (tag === 'ER') { cur = null; return; }
    if (!cur) { cur = {}; records.push(cur); }
    if (tag === 'AU' || tag === 'A1') cur.authorsRaw = [...(cur.authorsRaw || []), value];
    else if (tag === 'TI' || tag === 'T1' || tag === 'BT' || tag === 'CT') cur.title = cur.title || value;
    else if (tag === 'JO' || tag === 'JF' || tag === 'JA' || tag === 'T2' || tag === 'J2') cur.journal = cur.journal || value;
    else if (tag === 'PY' || tag === 'Y1' || tag === 'DA') cur.year = cur.year || extractYear(value);
    else if (tag === 'DO') cur.doi = cur.doi || extractDoi(value) || value;
    else if (tag === 'AN' || tag === 'PMID') { if (/^\d{6,9}$/.test(value)) cur.pmid = cur.pmid || value; }
    else if (tag === 'UR' || tag === 'L1' || tag === 'L2') cur.link = cur.link || value;
    else if (tag === 'VL') cur.volume = cur.volume || value;
    else if (tag === 'IS') cur.issue = cur.issue || value;
    else if (tag === 'SP') cur.startPage = cur.startPage || value;
    else if (tag === 'EP') cur.endPage = cur.endPage || value;
  });
  return records.map((r) => makeEntry({
    title: r.title,
    authors: formatAuthors(r.authorsRaw),
    journal: r.journal,
    year: r.year,
    doi: r.doi,
    pmid: r.pmid,
    volume: r.volume,
    pages: [r.startPage, r.endPage].filter(Boolean).join('-'),
    link: r.link,
    raw: r.link,
    source: 'ris'
  })).filter((e) => e.title);
};

/* ── BibTeX (Paperpile, Zotero, Mendeley…) ──────────────────────────────── */

/** Découpe `s` sur `sep` en ignorant les séparateurs imbriqués ({…}, "(…)", "…").
 *  Les guillemets ne sont pris en compte QU'à l'extérieur des accolades : une
 *  valeur BibTeX échappée (« M{\"u}ller ») n'ouvre jamais une chaîne. */
const splitTopLevel = (s, sep = ',') => {
  const out = [];
  let depth = 0;
  let quote = false;
  let cur = '';
  for (const ch of String(s || '')) {
    if (ch === '"') {
      if (quote) quote = false;
      else if (depth === 0) quote = true;
    }
    if (!quote) {
      if (ch === '{' || ch === '(') depth += 1;
      else if (ch === '}' || ch === ')') depth -= 1;
    }
    if (ch === sep && depth === 0 && !quote) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
};

const stripBraces = (v) => String(v || '').trim()
  .replace(/^[{("]+/, '')
  .replace(/[})"]+$/, '')
  .replace(/[{}]/g, '')
  .trim();

export const parseBibtexRecords = (rawText) => {
  const src = normalizeText(rawText);
  const out = [];
  const re = /@(\w+)\s*[{(]/g;
  while (re.exec(src)) {
    const open = src[re.lastIndex - 1];
    const close = open === '{' ? '}' : ')';
    let depth = 1;
    let i = re.lastIndex;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === open) depth += 1;
      else if (src[i] === close) depth -= 1;
    }
    const body = src.slice(re.lastIndex, i - 1);
    re.lastIndex = i; // les champs imbriqués ne sont jamais relus comme un @type
    const fields = {};
    splitTopLevel(body).forEach((part) => {
      const eq = part.indexOf('=');
      if (eq === -1) return; // 1er morceau = la clé de citation, sans valeur
      fields[part.slice(0, eq).trim().toLowerCase()] = stripBraces(part.slice(eq + 1));
    });
    const entry = makeEntry({
      title: decodeLatex(fields.title),
      authors: formatAuthors(decodeLatex(fields.author || '').split(/\s+and\s+/i)),
      journal: decodeLatex(fields.journal || fields.journaltitle || fields.booktitle || fields.publisher),
      year: fields.year || fields.date,
      doi: fields.doi,
      pmid: fields.pmid,
      volume: fields.volume,
      pages: String(fields.pages || '').replace(/--/g, '-'),
      link: fields.url || '',
      source: 'bibtex'
    });
    if (entry.title) out.push(entry);
  }
  return out;
};

/* ── Bibliographie en TEXTE (Paperpile dans un .docx, copié d'un PDF…) ──── */

const NUMBERED_START = /^\s*(?:\[|\()?\d{1,3}[.)\]]?(?:\s|$)/;

/** Note heuristique d'une ligne « qui ressemble à une référence ». */
export const referenceScore = (line) => {
  const s = String(line || '').trim();
  if (s.length < 25) return 0;
  let score = 0;
  if (extractDoi(s)) score += 2;
  if (extractPmid(s)) score += 2;
  if (/\((?:1[89]\d{2}|20\d{2})[a-z]?\)/.test(s)) score += 2;
  else if (/\b(?:1[89]\d{2}|20\d{2})\b/.test(s)) score += 1;
  if (/\d+\s*[(:]\s*\d+\s*[-–]\s*\d+/.test(s)) score += 1;         // volume/pages
  if (/^[A-Z][\p{L}'’.-]+(?:\s+(?:[A-Z]{1,3}\.?|[A-Z][\p{L}'’.-]+))?\s*,/u.test(s)) score += 1;
  if (s.length >= 40) score += 1;
  return score;
};

export const looksLikeReference = (line, minScore = 2) => referenceScore(line) >= minScore;

/**
 * Découpe le texte en références.
 *  - `split: 'line'`  → une référence par ligne (le plus sûr pour une
 *    bibliographie Paperpile, où chaque référence est un paragraphe Word).
 *  - par défaut → découpage automatique : une nouvelle entrée commence sur une
 *    numérotation, ou sur une ligne complète qui ressemble à une référence.
 */
export const splitReferenceBlocks = (rawText, opts = {}) => {
  const min = Number.isFinite(opts.minScore) ? opts.minScore : 2;
  const onePerLine = opts.split === 'line';
  const lines = normalizeText(rawText).split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
  const blocks = [];
  let buf = '';
  lines.forEach((line) => {
    if (!line) { if (buf) { blocks.push(buf); buf = ''; } return; }
    const previousIsComplete = buf.length > 40 && looksLikeReference(buf, min);
    const fresh = onePerLine || NUMBERED_START.test(line) || (looksLikeReference(line, min) && previousIsComplete);
    if (fresh && buf) { blocks.push(buf); buf = ''; }
    buf = buf ? `${buf} ${line}` : line;
  });
  if (buf) blocks.push(buf);
  return blocks;
};

const firstSentence = (s) => {
  const parts = String(s || '').split(/\.\s+(?=[A-Z0-9])/);
  return { head: parts[0] || '', rest: parts.slice(1).join('. ') };
};

/** « J. Biol. Chem. 295, 1234-1256 » → journal « J. Biol. Chem. », vol 295, pages… */
const journalParts = (s) => {
  const src = String(s || '')
    /* « pp. 345-356 » / « pages 345-356 » : le préfixe de pages n'est pas une
       partie du nom de la revue (il finissait dedans). Le préfixe ne compte que
       devant un nombre — « PhD thesis » n'est pas « p. » + « hD ». */
    .replace(/\b(?:pp?|pages?)\.?\s*(?=[\d(])/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  /* L'ANNÉE peut s'intercaler entre la revue et le volume
     (« Journal of Virology, 2018, 12(3), 345-356 »). Les PAGES peuvent
     commencer par des lettres — c'est un NUMÉRO D'ARTICLE (« e01234-18 »,
     « S1-9 ») : l'ancien « \d+ » laissait toute la queue dans la revue. */
  const yearBetween = /^(.*?)\s*[,;]?\s*(?:(?:1[89]|20)\d{2}[a-z]?)\s*[,;]?\s*(\d{1,4})\s*(?:\((\d{1,3})\))?\s*[,:]?\s*([A-Za-z]{0,3}\d+)\s*[-–]\s*([\w]*(?:[.-][\w]+)*)/;
  const m = src.match(yearBetween) || src.match(/^(.*?)\s*(\d{1,4})\s*(?:\((\d{1,3})\))?\s*[,:]?\s*([A-Za-z]{0,3}\d+)\s*[-–]\s*([\w]*(?:[.-][\w]+)*)/);
  if (!m) {
    /* Sans intervalle de pages : « Journal of Virology, 92(23), e01234. »
       (APA sans année) → revue, volume, numéro ET numéro d'article. */
    const v = src.match(/^(.*?)\s*(\d{1,4})\s*(?:\((\d{1,3})\))?\s*[,:]?\s*([A-Za-z]{0,3}\d+(?:\s*[-–]\s*[\w]+(?:\.[\w]+)*)?)?\s*\.?$/);
    if (!v) {
      /* Aucun volume : quand il ne reste QUE le nom de la revue
         (« Journal of General Virology. », une entrée sans année), il est
         gardé — sinon la citation perdrait sa revue. */
      if (src && !/\d/.test(src) && src.length <= 70 && /[\p{L}]{3}/u.test(src)) {
        return { journal: src.replace(/[.,;:\s]+$/, ''), volume: '', issue: '', pages: '' };
      }
      return { journal: '', volume: '', issue: '', pages: '' };
    }
    /* Un « volume » de quatre chiffres qui EST une année n'en est pas un
       (« PhD thesis, University of Naples, 2018 »). */
    if (/^(?:1[89]|20)\d{2}$/.test(v[2])) return { journal: src.replace(/[,\s]+$/, ''), volume: '', issue: '', pages: '' };
    return { journal: v[1], volume: v[2], issue: v[3] || '', pages: v[4] || '' };
  }
  return { journal: m[1], volume: m[2], issue: m[3] || '', pages: `${m[4]}-${m[5]}` };
};

/* ── Deux formes de référence qui donnaient un TITRE FAUX ────────────────────
   • « J Virol. 2018;12:345-356. Rossi M, et al. Titre. » (PubMed / Vancouver) :
     la revue vient EN PREMIER et le premier bloc devenait le titre ;
   • « Rossi M. "Characterization of a potyvirus." J Virol 2018… » : le point
     final du titre entre guillemets coupe la phrase et l'entrée ENTIÈRE
     finissait dans le champ titre. */

/** Journal + année + volume:pages en tête de référence. */
const JOURNAL_FIRST_RE = /^([^.;]{2,60}[.;]?)\s*((?:1[89]|20)\d{2}[a-z]?(?:\s+[A-Za-z]{3,9}\s+\d{1,2})?\s*[;:]\s*\d{1,4}(?:\(\d{1,3}\))?(?:\s*:\s*[\d\-–.\w]+)?)\s*[.,;:]?\s*(.+)$/;

/** Déplace le bloc « revue + année;volume:pages » de la tête vers la QUEUE de la
 *  référence : le texte redevient « auteurs. titre. revue année;volume:pages. »,
 *  la forme que tout le reste du module sait lire. */
export const rotateJournalFirst = (text) => {
  const s = String(text || '').trim();
  const m = s.match(JOURNAL_FIRST_RE);
  if (!m) return s;
  const head = m[1].trim();
  const citation = m[2].trim();
  const rest = m[3].trim().replace(/[.\s]+$/, '');
  if (!rest || !/\p{L}{2}/u.test(rest)) return s;
  return `${rest}. ${head} ${citation}.`;
};

/** Un titre entre guillemets (doubles ou typographiques — jamais l'apostrophe,
 *  trop fréquente dans les noms). */
const QUOTED_TITLE_RE = /["\u201c\u201d\u00ab\u00bb]([^"\u201c\u201d\u00ab\u00bb]{10,300})["\u201c\u201d\u00ab\u00bb]/;

/**
 * Liste d'auteurs en tête d'une référence, dans TOUTES les écritures que
 * produisent les éditeurs :
 *   « Smith, J., Rossi, M. & Costa, L. »   (APA / Word / EndNote),
 *   « Rossi M, Bianchi A, Costa L. »       (Vancouver / Paperpile),
 *   « Rossi M., Bianchi A., Costa L. »     (initiales pointées),
 *   « M. Rossi, A. Bianchi, L. Costa. »    (Elsevier / Harvard),
 *   « Rossi M. Bianchi A. »                (auteurs séparés par des points).
 * Retourne '' quand la référence ne commence pas par une liste d'auteurs —
 * voir authorList : la liste ne peut jamais se prolonger dans le TITRE.
 *
 * Les INITIALES COMPOSÉES (« W.-J. », « J.-P. », « S.-C. ») appartiennent au
 * même auteur : c'est le style Nature / Cell / Paperpile (« Lu, W.-J. et al.
 * Mortalin-p53 interaction… Cell Death Differ 18, 1046-1056 (2011). »). Sans
 * cette règle, la liste s'arrêtait après « Lu, W. » — le « -J. » resté en tête
 * devenait le TITRE du papier et la référence perdait son titre ET ses auteurs.
 */
const authorPrefix = (s) => {
  const list = authorList(s);
  return list ? list.text : '';
};

/* ── Marqueurs d'auteurs (« et al. », « and others ») ────────────────────────
   Une liste d'auteurs peut se terminer par « et al. ». Quand l'année suit les
   auteurs de près, le style « Nom, Initiales » laisse ce marqueur en TÊTE du
   reste : la référence importée s'appelait alors « , et al. » et son vrai titre
   tombait dans le champ journal. Les deux formes sont donc retirées — fin de la
   liste d'auteurs ET tête du reste — puis remises, normalisées, dans les
   auteurs : « et al. » est un marqueur d'auteurs, jamais un titre. */
const ET_AL_TAIL_RE = /[.,;&]?\s*(?:et\.?\s*al\.?|and\s+others|&\s*others)\s*\.?\s*$/i;
const ET_AL_HEAD_RE = /^\s*[.,;:&]?\s*(?:(?:,|&|\band\b)\s*)?(?:et\.?\s*al\.?|and\s+others|&\s*others)\s*[.,;:]?\s*/i;

/** Un titre qui n'est en fait qu'un marqueur (« et al. », « (2020) »…) ou qui
 *  ne contient plus une seule lettre : ce n'est pas un titre. */
const TITLE_MARKER_RE = /^(?:et\.?\s*al\.?|and\s+others|&\s*others|(?:1[89]|20)\d{2}[a-z]?)[.,;:]?$/i;
export const isMarkerTitle = (text) => {
  const s = String(text || '').replace(/\s+/g, ' ').replace(/^[.,;:\s]+/, '').trim();
  return !s || !/[A-Za-z\u00c0-\u00ff]{2}/.test(s) || TITLE_MARKER_RE.test(s);
};
/** Un « titre » qui n'est en fait QU'une liste d'auteurs (« Costa L »,
 *  « Rossi, M. », « Bianchi A, Costa L ») : beaucoup de bibliographies coupent
 *  la liste d'auteurs en deux (« Rossi M. Bianchi A. Le titre… ») et le
 *  morceau restant finissait dans le TITRE du papier. Ce n'est jamais un
 *  titre : voir bibliographyBlockToEntry, qui rend ces noms aux auteurs et
 *  prend la phrase suivante comme titre. */
export const isAuthorListTitle = (value) => {
  const s = String(value || '').replace(/\s+/g, ' ').trim();
  if (!s) return false;
  const list = authorList(s);
  if (!list || !list.names.length || list.names.length > 6) return false;
  const tail = s.slice(list.end).replace(/^[\s,;.&]+/, '').replace(/[\s,;.&]+$/, '');
  return !tail || ET_AL_ONLY_RE.test(tail);
};



/** Une entrée de bibliographie « texte » → référence structurée. */
export const bibliographyBlockToEntry = (block, _opts = {}) => {
  const raw = String(block || '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const numberMatch = raw.match(/^\s*(?:\[|\()?(\d{1,3})[.)\]]?\s+/);
  /* Notes de statut d'une référence PubMed (« Epub 2018 Nov 3. », « Online ahead
     of print. ») : ni un titre, ni un journal — elles disparaissent. */
  let body = (numberMatch ? raw.slice(numberMatch[0].length) : raw)
    .replace(/\b(?:Epub|Online)\s+(?:ahead of print|first)\b[^.]*\.?\s*/gi, ' ')
    .replace(/\bEpub\b[^.]*\.?\s*/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  /* Revue en tête (PubMed / Vancouver) : déplacée à la fin (voir rotateJournalFirst). */
  body = rotateJournalFirst(body);
  /* Titre entre guillemets (« Rossi M. "Characterization of a potyvirus." J Virol
     2018… ») : le point est AVANT le guillemet fermant, donc la phrase ne se
     termine jamais là et l'entrée ENTIÈRE finissait dans le champ titre. Le titre
     est réécrit en clair à sa place — « … potyvirus. J Virol 2018… » — et tout
     le reste (auteurs, revue, volume, pages) se lit normalement. */
  const quotedMatch = body.match(QUOTED_TITLE_RE);
  const quotedTitle = quotedMatch ? quotedMatch[1].replace(/[.,;\s]+$/, '').trim() : '';
  if (quotedMatch && !isMarkerTitle(quotedTitle)) body = body.replace(QUOTED_TITLE_RE, `${quotedTitle}.`);
  const rawBody = body;
  const yearParen = body.match(/\(((?:1[89]|20)\d{2})[a-z]?\)/);
  /* Position de la 1re fin de phrase : quand l'année suit immédiatement les
     auteurs (« Smith J, Rossi M (2019)… ») elle est DANS la première phrase ;
     dans le style « Nature » elle traîne à la fin (« … 295, 1-9 (2020). »). */
  const sentenceBreak = body.search(/\.\s+(?=[A-Z0-9])/);
  const yearIsEarly = !!yearParen && (sentenceBreak === -1 || yearParen.index <= sentenceBreak + 3);
  let authors = '';
  let rest = body;

  const prefix = authorPrefix(body);
  if (prefix) {
    authors = prefix;
    rest = body.slice(prefix.length);
  } else if (yearIsEarly) {
    authors = body.slice(0, yearParen.index);
    rest = body.slice(yearParen.index + yearParen[0].length);
  } else {
    /* Sans liste d'auteurs reconnaissable, les auteurs sont la 1re phrase
       (« Ross, M. A., Wolf, L. J. Titre. Journal … »). Un SIGLE seul
       (« EPPO. Aphid transmission… ») est un auteur collectif, pas un titre :
       on l'accepte même s'il est court. */
    const { head, rest: after } = firstSentence(body);
    const groupAuthor = /^[\p{Lu}][\p{Lu}0-9&.-]{1,14}$/u.test(head.trim());
    if (after && (head.length >= 6 || groupAuthor)) { authors = head; rest = after; }
  }
  /* « et al. » collé à la fin des auteurs ou en tête du reste : retiré des
     deux côtés (il ne doit jamais devenir le titre), puis remis en clair à la
     fin de la liste d'auteurs — la convention que lit le moteur de citation. */
  let etAl = false;
  const etAlTail = authors.match(ET_AL_TAIL_RE);
  if (etAlTail) { authors = authors.slice(0, etAlTail.index); etAl = true; }
  const etAlHead = rest.match(ET_AL_HEAD_RE);
  if (etAlHead) { rest = rest.slice(etAlHead[0].length); etAl = true; }
  authors = normalizeAuthorList(authors.replace(/[\s,&]+$/, ''));
  if (etAl && authors) authors = `${authors}, et al.`;
  /* Un DOI / une URL resté en tête du reste (« doi:10.1016/… Titre… », sortie
     Paperpile) : il est déjà enregistré dans `doi`, il ne doit pas s'installer
     dans le titre. */
  rest = rest.replace(/^\s*(?:https?:\/\/\S+|doi:?\s*10\.\S+|10\.\d{4,9}\/\S+)\s*[.,;:]?\s*/i, ' ');
  /* Année restée en tête après les auteurs (« (2020). Titre », « 2020. Titre »,
     « 2019, Titre ») : on l'enlève pour que le TITRE ne devienne pas « (2020) ». */
  rest = rest.replace(/^\s*[.,;:]?\s*(?:\(\s*(?:1[89]|20)\d{2}[a-z]?\s*\)|(?:1[89]|20)\d{2}[a-z]?)\s*[.,;:\]]?\s*/, ' ').trim();

  const firstTry = firstSentence(rest.replace(/^[.\s]+/, ''));
  let title = firstTry.head;
  let afterTitle = firstTry.rest;
  /* Un titre réduit à un marqueur (« , et al » sans le point, une année seule…)
     signifie que la VRAIE première phrase est la suivante : on la prend, plutôt
     que d'enregistrer « et al. » comme titre du papier. */
  if (isMarkerTitle(title) && afterTitle) {
    const nextSentence = firstSentence(afterTitle.replace(/^[.\s,;:]+/, ''));
    if (!isMarkerTitle(nextSentence.head)) { title = nextSentence.head; afterTitle = nextSentence.rest; }
  }
  /* Un titre qui n'est QU'une liste d'auteurs : c'est le morceau d'une liste
     coupée en deux (« Rossi M. Bianchi A. Le titre… » — le point après la
     première initiale termine la phrase, le 2e nom devenait le TITRE du
     papier). Les noms sont rendus aux AUTEURS et le vrai titre est la phrase
     suivante : aucun article n'est perdu et aucun auteur n'est pris pour un
     titre. */
  if (isAuthorListTitle(title) && afterTitle) {
    const extra = normalizeAuthorList(title);
    if (extra) {
      const marker = authors.match(/,\s*((?:et\.?\s*al\.?|and\s+others|&\s*others))$/i);
      authors = marker
        ? `${authors.slice(0, marker.index)}, ${extra}, ${marker[1]}`
        : (authors ? `${authors}, ${extra}` : extra);
    }
    const nextSentence = firstSentence(afterTitle.replace(/^[.\s,;:]+/, ''));
    if (!isMarkerTitle(nextSentence.head)) { title = nextSentence.head; afterTitle = nextSentence.rest; }
    else title = '';
  }
  /* Un DOI / une URL resté DANS LA PHRASE du titre (« … pepper. bioRxiv
     2018:345-356. doi:10.1101/345678 ») : le point du DOI n'est pas suivi
     d'une majuscule, la phrase ne se coupe jamais et l'identifiant restait
     dans le titre. Il est déjà enregistré dans `doi` (et dans `link`). */
  title = String(title)
    .replace(/\s*(?:https?:\/\/\S+|\bdoi:?\s*10\.\S+|10\.\d{4,9}\/\S+)\s*[.,;:]?/gi, ' ')
    .replace(/\s+/g, ' ').replace(/[.,;:\s]+$/, '').trim();

  const doi = extractDoi(body);
  const urlMatch = body.match(/https?:\/\/\S+/i);
  const journalSrc = afterTitle
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\bdoi:?\s*10\.\S+/gi, '')
    .replace(/\((?:(?:1[89]|20)\d{2})[a-z]?\)/g, '')
    .replace(/\.\s*$/, '')
    .trim();
  const jp = journalParts(journalSrc);
  /* Quand l'année traînait dans le champ journal (« J Virol. 2018; »,
     « J Virol. 2018 Dec 1; »), elle en est retirée : elle est déjà dans `year`.
     Seuls les séparateurs sont nettoyés — le point abrégé fait partie du nom
     (« J. Biol. Chem. »). */
  jp.journal = jp.journal
    .replace(/[.,;:\s]*(?:1[89]|20)\d{2}[a-z]?(?:\s+[A-Za-z]{3,9}\.?\s*\d{1,2})?[.,;:]?\s*$/, '')
    .replace(/[,\s]+$/, '')
    .trim();
  /* La queue bibliographique restée DANS le titre — la phrase ne se termine
     jamais, donc elle n'a pas pu être séparée plus haut :
       • style « virgules » de Word / EndNote : « … et al., 2019, Titre,
         Journal, 12, 345-356. » ;
       • style « revue année;volume(issue):pages » (« Does CMV infect pepper?
         J Virol 2018;12:345-356. » — un « ? » n'est pas un point : la revue
         restait dans le TITRE ; « … pepper. bioRxiv 2018:345-356. »).
     Ces queues ne sont retirées que si la revue n'a PAS pu être lue
     autrement : le titre passe avant la revue, jamais l'inverse. */
  let tailJournal = '';
  let tailVolume = '';
  let tailPages = '';
  if (!jp.journal && !jp.volume && !jp.pages) {
    const commaTail = String(title).match(/^(.*?),\s*([^,]{2,60}),\s*(\d{1,4})\s*,\s*(\d+\s*[-–]\s*[\w.]+)\s*\.?\s*$/);
    /* La REVUE de cette queue : un nom capitalisé (« J Virol », « Biochim.
       Biophys. Acta ») ou un nom en UN seul mot commençant par une minuscule
       (« bioRxiv », « medRxiv ») — jamais un mot de liaison du titre
       (« in », « and »…), sinon « … in 2018: 12 » amputerait le titre. */
    const queueTail = String(title).match(
      /^(.*?)[.!?]?\s+((?:[A-Z][\p{L}.'’\- ]{1,40}?|(?!(?:and|the|for|with|from|into|that|this|than|then|when|where|which|while|also|both|such|some|any|all|not|but|its|their|our|his|her|they|there|these|those|has|have|had|was|were|are|in|on|at|to|by|of|as|is|an|or)\b)[a-z][\p{L}'’\-]{3,19}))\s+((?:1[89]|20)\d{2}[a-z]?)\s*[;:,]\s*((?:\d{1,4}\s*(?:\(\d{1,3}\))?\s*[;:,]\s*)?[A-Za-z]{0,3}\d+(?:\s*[-–]\s*[\w.]+)?)\s*\.?\s*$/u
    );
    if (commaTail && /[\p{L}]{2}/u.test(commaTail[2])) {
      title = commaTail[1];
      tailJournal = commaTail[2].trim();
      tailVolume = commaTail[3];
      tailPages = commaTail[4].replace(/\.$/, '');
    } else if (queueTail && queueTail[1].length >= 10 && /[\p{L}]{2}/u.test(queueTail[2])) {
      const queue = queueTail[4].split(/\s*[;:,]\s*/).filter(Boolean);
      title = queueTail[1];
      tailJournal = queueTail[2].trim();
      if (queue.length > 1) { tailVolume = queue[0]; tailPages = queue.slice(1).join('-'); }
      else tailPages = queue[0] || '';
    }
  }

  const year = (yearParen && yearParen[1]) || extractYear(body);

  return makeEntry({
    /* Le titre peut être resté un marqueur (« et al. ») : le titre entre
       guillemets, lui, est toujours la vérité — c'est écrit dans la référence. */
    title: isMarkerTitle(title) && quotedTitle ? quotedTitle : title,
    authors,
    journal: jp.journal || tailJournal,
    year,
    doi,
    pmid: extractPmid(body),
    volume: jp.volume || tailVolume,
    pages: jp.pages || tailPages,
    link: urlMatch ? urlMatch[0] : '',
    /* « 12. Rossi… » → la référence 12 : le numéro écrit devant l'entrée, celui
       que le TEXTE cite ([12]) — conservé (voir makeEntry). */
    number: numberMatch ? Number(numberMatch[1]) : 0,
    source: 'text',
    raw: rawBody
  });
};


/* ── Point d'entrée : texte → références ────────────────────────────────── */

export const detectReferenceFormat = (rawText) => {
  const text = normalizeText(rawText);
  if (/^\s*TY\s{0,2}-/m.test(text)) return 'ris';
  if (/^\s*@\w+\s*[{(]/m.test(text)) return 'bibtex';
  return 'text';
};

/**
 * Analyse le texte d'un document (ou d'un export) et retourne les références.
 * @param {string} rawText
 * @param {{ format?: 'auto'|'ris'|'bibtex'|'text', split?: 'auto'|'line',
 *           minScore?: number, keepAll?: boolean }} opts
 */
export const parseReferences = (rawText, opts = {}) => {
  const text = normalizeText(rawText);
  const format = opts.format && opts.format !== 'auto' ? opts.format : detectReferenceFormat(text);
  if (format === 'ris') return parseRisRecords(text);
  if (format === 'bibtex') return parseBibtexRecords(text);
  const min = Number.isFinite(opts.minScore) ? opts.minScore : 2;
  return splitReferenceBlocks(text, opts)
    .map((block) => bibliographyBlockToEntry(block, opts))
    .filter((entry) => entry && entry.title)
    /* Une entrée NUMÉROTÉE par la bibliographie est une référence par
       construction : le score ne doit jamais la jeter, sinon un article
       « n'est pas reconnu » à l'import (« 12. EPPO. Note. » par exemple). */
    .filter((entry) => opts.keepAll || entry.number > 0 || referenceScore(entry.raw || '') >= min);
};

/* ── Doublons & fusion (jamais destructif) ─────────────────────────────── */

/** Clé de comparaison d'un TITRE (accents, ponctuation et casse ignorés). */
export const normalizeTitleKey = (title) => String(title || '')
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** Identité d'une référence : DOI → PMID → titre. '' si rien d'exploitable. */
export const entryKey = (entry) => {
  if (!entry || typeof entry !== 'object') return '';
  const doi = extractDoi(entry.doi || '') || extractDoi(entry.link || '') || extractDoi(entry.url || '');
  if (doi) return `doi:${doi.toLowerCase()}`;
  const pmid = String(entry.pmid || '').replace(/\D/g, '');
  if (pmid) return `pmid:${pmid}`;
  const title = normalizeTitleKey(entry.title);
  return title ? `title:${title}` : '';
};

/** TOUTES les identités d'une référence (DOI, PMID, titre normalisé) : deux
 *  entrées sont le même papier dès qu'UNE de ces clés coïncide — indispensable
 *  quand l'entrée déjà enregistrée n'a qu'un titre et que l'import apporte le
 *  DOI (c'est exactement le cas des papiers perdus d'un ancien projet). */
export const entryKeys = (entry) => {
  if (!entry || typeof entry !== 'object') return [];
  const out = [];
  const doi = extractDoi(entry.doi || '') || extractDoi(entry.link || '') || extractDoi(entry.url || '');
  if (doi) out.push(`doi:${doi.toLowerCase()}`);
  const pmid = String(entry.pmid || '').replace(/\D/g, '');
  if (pmid) out.push(`pmid:${pmid}`);
  const title = normalizeTitleKey(entry.title);
  if (title) out.push(`title:${title}`);
  return out;
};

const REFERENCE_FIELDS = [
  'authors', 'journal', 'year', 'doi', 'pmid', 'volume', 'pages', 'issue', 'link', 'abstract'
];

/** Recopie les champs VIDES de `target` depuis `source` (jamais l'inverse :
 *  une correction saisie à la main reste intacte). Retourne le même objet si
 *  rien ne change — les appels peuvent donc détecter un vrai changement. */
export const fillMissingFields = (target, source, keys = REFERENCE_FIELDS) => {
  if (!target || !source) return target;
  let next = target;
  keys.forEach((key) => {
    if (String(next[key] === undefined || next[key] === null ? '' : next[key]).trim()) return;
    const value = source[key];
    if (value === undefined || value === null || !String(value).trim()) return;
    next = next === target ? { ...target } : next;
    next[key] = value;
  });
  return next;
};

/**
 * Fusion générique, JAMAIS destructive : une entrée déjà là est reconnue par
 * l'une de ses clés (id / DOI / PMID / titre) et seuls ses champs VIDES sont
 * complétés ; sinon elle est ajoutée à la fin.
 */
const mergeByKeys = (current, incoming, keysOf, fillKeys) => {
  const list = (Array.isArray(current) ? current : []).map((e) => ({ ...e }));
  const index = new Map();
  const register = (entry) => {
    keysOf(entry).forEach((k) => { if (k && !index.has(k)) index.set(k, entry); });
  };
  list.forEach(register);
  let added = 0;
  let filled = 0;
  (Array.isArray(incoming) ? incoming : []).forEach((raw) => {
    const entry = raw && typeof raw === 'object' ? { ...raw } : null;
    if (!entry) return;
    const hit = keysOf(entry).map((k) => index.get(k)).find(Boolean);
    if (!hit) {
      list.push(entry);
      register(entry);
      added += 1;
      return;
    }
    const merged = fillMissingFields(hit, entry, fillKeys);
    if (merged !== hit) {
      list[list.indexOf(hit)] = merged;
      index.forEach((value, key) => { if (value === hit) index.set(key, merged); });
      filled += 1;
    }
  });
  return { list, added, filled };
};

/**
 * Fusionne des références importées dans une liste existante.
 * Rien n'est jamais supprimé ni écrasé : une référence déjà là est reconnue
 * (DOI, PMID, sinon titre) et ses champs vides sont complétés.
 */
export const mergeReferenceEntries = (existing, incoming) =>
  mergeByKeys(existing, incoming, entryKeys, REFERENCE_FIELDS);

/** Une référence importée → une entrée de « Project bibliography ». */
export const projectBibEntry = (entry, project = {}, id = '') => ({
  id: id || `bib_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  title: cleanTitle(entry && entry.title),
  link: String((entry && entry.link) || '').trim() || doiUrl(entry && entry.doi),
  authors: String((entry && entry.authors) || '').trim(),
  year: String((entry && entry.year) || '').trim(),
  journal: String((entry && entry.journal) || '').trim(),
  doi: String((entry && entry.doi) || '').trim(),
  pmid: String((entry && entry.pmid) || '').trim(),
  volume: String((entry && entry.volume) || '').trim(),
  pages: String((entry && entry.pages) || '').trim(),
  comments: '',
  scientist: (project && project.scientist) || ''
});


/* ── Listes de papiers (publications / Relevant papers / bibliographies) ── */

const PAPER_FIELDS = [
  ...REFERENCE_FIELDS, 'title', 'labels', 'subject', 'comments', 'scientist',
  'coauthors', 'impactFactor', 'source', 'sourceId', 'addedAt'
];

/** Identité d'un papier d'une liste : son id, sinon DOI/PMID/titre. */
export const paperKey = (paper) => paperKeys(paper)[0] || '';

/**
 * Identités d'un papier : son id, et — seulement entre papiers du MÊME
 * scientifique — le DOI/PMID/titre. Le scientifique fait partie de la clé :
 * deux membres du laboratoire citent légitimement le même article chacun de
 * leur côté, ces deux lignes doivent rester distinctes.
 */
export const paperKeys = (paper) => {
  if (!paper || typeof paper !== 'object') return [];
  const out = [];
  const id = String(paper.id || '').trim();
  if (id) out.push(`id:${id}`);
  const sci = String(paper.scientist || '').trim().toLowerCase();
  entryKeys(paper).forEach((k) => out.push(sci ? `${sci}|${k}` : k));
  return out;
};

/** Fusion d'une liste de papiers (publications, « Relevant papers ») : on
 *  ajoute les papiers absents et on complète les champs vides des présents. */
export const mergePaperLists = (current, incoming) =>
  mergeByKeys(current, incoming, paperKeys, PAPER_FIELDS);

/** Fusionne les BIBLIOGRAPHIES de projets existants (par id, sinon par nom). */
export const mergeProjectBibliographies = (currentProjects, incomingProjects) => {
  const projects = (Array.isArray(currentProjects) ? currentProjects : []).map((p) => ({ ...p }));
  const incoming = Array.isArray(incomingProjects) ? incomingProjects : [];
  let added = 0;
  let filled = 0;
  let projectsTouched = 0;
  incoming.forEach((src) => {
    const bibliography = Array.isArray(src && src.bibliography) ? src.bibliography : [];
    if (!bibliography.length) return;
    const name = String((src && src.name) || '').trim().toLowerCase();
    const target = projects.find((p) => p && (
      (src && src.id && String(p.id) === String(src.id))
      || (name && String(p.name || '').trim().toLowerCase() === name)));
    if (!target) return;
    const res = mergeReferenceEntries(target.bibliography || [], bibliography);
    if (!res.added && !res.filled) return;
    target.bibliography = res.list;
    projectsTouched += 1;
    added += res.added;
    filled += res.filled;
  });
  return { projects, added, filled, projectsTouched };
};

/* ── Lecture d'un ancien fichier de sauvegarde (.html) ─────────────────── */

/** Le bloc JSON embarqué dans un fichier « Save HTML » / sauvegarde Drive. */
export const BACKUP_BLOB_RE = /<script[^>]*id=["']saved-data-blob["'][^>]*>([\s\S]*?)<\/script>/;

/** Les papiers contenus dans l'ÉTAT d'une sauvegarde (aucune autre section). */
export const papersFromBackupState = (state) => {
  const src = state && typeof state === 'object' ? state : {};
  const projects = (Array.isArray(src.projects) ? src.projects : [])
    .map((p) => ({
      id: (p && p.id) || '',
      name: (p && p.name) || '',
      scientist: (p && p.scientist) || '',
      bibliography: Array.isArray(p && p.bibliography) ? p.bibliography : []
    }))
    .filter((p) => p.bibliography.length > 0 || p.name);
  return {
    publications: Array.isArray(src._publications) ? src._publications : [],
    excludedPubs: Array.isArray(src._excludedPubs) ? src._excludedPubs : [],
    relevantPapers: Array.isArray(src._relevantPapers) ? src._relevantPapers : [],
    relevantSubjects: Array.isArray(src._relevantSubjects) ? src._relevantSubjects : [],
    projects
  };
};

/**
 * ÉTAT complet d'un fichier de sauvegarde (« Save HTML » / sauvegarde Drive) :
 * le bloc JSON embarqué, décompressé. Sert aux lecteurs spécialisés ci-dessous
 * (papiers, bibliothèque d'images) — chacun n'exploite QUE ses clés.
 * @returns {null|{state:object, title:string, subtitle:string, savedAt:number}}
 */
export const backupStateFromHtml = (html, decompress) => {
  const match = String(html || '').match(BACKUP_BLOB_RE);
  if (!match) return null;
  let blob = null;
  try { blob = JSON.parse(match[1]); } catch { return null; }
  let payload = blob && blob.payload;
  if (!payload) return null;
  if (blob.isCompressed) {
    const decoded = typeof decompress === 'function' ? decompress(String(payload)) : null;
    if (!decoded) return null;
    payload = decoded;
  }
  let state = null;
  try { state = JSON.parse(payload); } catch { return null; }
  return {
    state,
    title: (blob && blob.title) || '',
    subtitle: (blob && blob.subtitle) || '',
    savedAt: (blob && blob.savedAt) || 0
  };
};

/**
 * Papiers d'un fichier de sauvegarde HTML complet.
 * @param {string} html        contenu du fichier
 * @param {(s:string)=>string} decompress  décompresseur LZString (fourni par
 *        l'appelant : ce module reste ainsi testable hors navigateur)
 * @returns {null|object}      null quand le fichier n'est pas une sauvegarde
 */
export const papersFromBackupHtml = (html, decompress) => {
  const backup = backupStateFromHtml(html, decompress);
  if (!backup) return null;
  return {
    ...papersFromBackupState(backup.state),
    title: backup.title,
    subtitle: backup.subtitle,
    savedAt: backup.savedAt,
    isAdminBase: !!backup.state.administration
  };
};

/* ── Bibliothèque d'images d'un ancien fichier de sauvegarde ───────────────
   Les IMAGES sont sur le Drive (<dataset>/projects/<projet>/images), mais la
   LISTE qui les affiche (libellés, vignettes, ordre, bibliothèque commune et
   bibliothèques de projet) vit dans le navigateur : elle ne voyage que dans les
   fichiers de sauvegarde. Un autre poste, un navigateur réinitialisé ou un
   stockage local vidé retrouve donc ses images par ce chemin — sans toucher au
   reste du fichier (expériences, définitions, stockage, rapport…). */

/** Bibliothèque d'images contenue dans l'ÉTAT d'une sauvegarde (aucune autre
 *  section). `common` = bibliothèque partagée du dataset, `projects` =
 *  { <idProjet>: [images] }. */
export const figuresFromBackupState = (state) => {
  const src = state && typeof state === 'object' ? state : {};
  const projects = src._figuresLibraryProjects && typeof src._figuresLibraryProjects === 'object'
    && !Array.isArray(src._figuresLibraryProjects)
    ? src._figuresLibraryProjects
    : {};
  const out = {};
  Object.entries(projects).forEach(([pid, items]) => {
    if (Array.isArray(items) && items.length > 0) out[pid] = items;
  });
  return {
    common: Array.isArray(src._figuresLibrary) ? src._figuresLibrary : [],
    projects: out
  };
};

/** Bibliothèque d'images d'un fichier de sauvegarde HTML complet. */
export const figuresFromBackupHtml = (html, decompress) => {
  const backup = backupStateFromHtml(html, decompress);
  if (!backup) return null;
  return {
    ...figuresFromBackupState(backup.state),
    title: backup.title,
    savedAt: backup.savedAt,
    isAdminBase: !!backup.state.administration
  };
};

/** Compte-rendu affiché avant/après une récupération d'images. */
export const backupFigureCount = (figures) => {
  const f = figures || {};
  const projects = f.projects && typeof f.projects === 'object' ? f.projects : {};
  const ids = Object.keys(projects);
  const projectItems = ids.reduce((n, pid) => n + (Array.isArray(projects[pid]) ? projects[pid].length : 0), 0);
  const common = Array.isArray(f.common) ? f.common.length : 0;
  return { common, projectCount: ids.length, projectItems, total: common + projectItems };
};

/** Nombre de références trouvées dans une sauvegarde (pour l'aperçu). */
export const backupPaperCount = (papers) => {
  const p = papers || {};
  const bib = (Array.isArray(p.projects) ? p.projects : [])
    .reduce((n, prj) => n + ((prj.bibliography || []).length), 0);
  return {
    publications: (p.publications || []).length,
    relevantPapers: (p.relevantPapers || []).length,
    projectBib: bib,
    projects: (p.projects || []).filter((prj) => (prj.bibliography || []).length).length
  };
};

