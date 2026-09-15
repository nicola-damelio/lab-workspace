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
     4. les CITATIONS dans le texte ([12], [3,4], [5-7], (Rossi et al., 2018),
        (Smith & Bianchi 2020)…) deviennent les références NUMÉROTÉES du
        programme ([1], [2]…) : c'est exactement ce que fait « 📚 + Reference »
        à la main (project.references + marqueur [n]). C'est ensuite
        utils/referenceLinks.js qui transforme chaque marqueur du texte en LIEN
        vers sa référence (ancre #ref-n du document exporté).
     5. les FIGURES du document ne se perdent plus : elles rejoignent les
        figures de LEUR section sur la page projet (la liste dans laquelle
        « 📤 Insert into project… » de l'Image Builder range les compositions,
        et que le document exporté imprime). Elles n'entrent PAS dans le texte
        de la section — elles y resteraient figées et partiraient dans tous les
        exports : chaque figure garde à la place l'ANCRE du paragraphe qui la
        précédait et le document exporté la remet à cet endroit
        (utils/figurePlacement.js).

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

/** Marqueur d'affiliation en tête de ligne : « 1 … », « 1Dipartimento… » (un
 *  exposant COLLÉ par l'export Google Docs / Word), « * … », « a) … ». */
export const AFFILIATION_MARK_RE = new RegExp([
  '^\\s*\\d{1,2}[.)\\]]?\\s*\\S',                 // « 1 » / « 1. » / « 1Dipartimento… »
  '^\\s*(?:[a-e]|[ivx]{1,4})[.)\\]]\\s*\\S',      // « a) » / « a. » / « iv) »
  '^\\s*(?:[a-e]|[ivx]{1,4})\\s+(?=\\p{Lu})',     // « a Dipartimento »
  '^\\s*[*\\u2020\\u2021\\u00a7\\u00b6]\\s*\\S'    // « * » / « † » / « ‡ » / « § »
].join('|'), 'iu');

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

/* Un morceau de nom : « Rossi », « Mario Rossi1 », « Dupont1,2 », « Bianchi1* »,
   « A. » — jamais une phrase (« plant viruses » ne passe pas : minuscule
   initiale). Les chiffres/symboles qui suivent sont les exposants d'affiliation
   et peuvent se suivre (« 1,2 ») ou se cumuler (« 1* » = affiliation + auteur
   correspondant). */
const NAME_PART_RE = /^[\p{Lu}][\p{L}'\u2019.-]*(?:\s+(?:[\p{Lu}]|[\p{Lu}][\p{L}'\u2019.-]*))?\.?\s*(?:(?:\d{1,2}|[*\u2020\u2021\u00a7\u00b6])+(?:\s*[,&]\s*(?:\d{1,2}|[*\u2020\u2021\u00a7\u00b6])+)*)?$/u;

/** Un exposant tout seul : le « 2 » de « Dupont1,2 » (deux affiliations). */
const EXPONENT_ONLY_RE = /^(?:\d{1,2}|[*\u2020\u2021])+$/;

/** Un intitulé de section n'est JAMAIS un nom de personne, même en position
 *  d'auteur : « Materials and Methods » suit parfois le titre de très près. */
const SECTION_WORD_RE = /^(?:abstract|introduction|background|materials?|methods?|results?|discussion|conclusions?|acknowledg\w*|funding|references?|bibliography|supplementary|supporting|appendix|keywords?|author contributions?|conflicts? of interest|data availability|figures?|tables?|legends?|highlights)\b/i;

/** Les morceaux d'une liste de noms, exposants recollés : dans
 *  « Bianchi1,2, Rossi, M. » le « 2 » qui suit la virgule est la SECONDE
 *  affiliation du même auteur, pas un auteur ; « et al. » n'est pas un nom. */
export const authorLineParts = (line) => {
  const cleaned = String(line || '').trim()
    .replace(/\s*[;,]?\s*\bet\s+al\.?\s*$/i, '')
    .replace(/\s*&\s*$/, '')
    .replace(/\((\d{1,2}(?:\s*,\s*\d{1,2})*)\)/g, ' $1 '); // « Bianchi (1) » → « Bianchi 1 »
  const merged = [];
  cleaned.split(/\s*(?:,|;|\band\b|&)\s*/i).map((p) => p.trim()).filter(Boolean).forEach((part) => {
    const prev = merged[merged.length - 1];
    if (prev && EXPONENT_ONLY_RE.test(part) && /(?:\d|[*\u2020\u2021])$/.test(prev)) {
      merged[merged.length - 1] = `${prev},${part}`;
      return;
    }
    merged.push(part);
  });
  return merged;
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
  if (!s || s.length > 400) return false;
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
  if (initials || exponent || parts.length >= 3) return true;
  return !!alone && parts.length >= 1 && s.split(/\s+/).length <= 6;
};

/** Un titre est une ligne COURTE, sans ponctuation de fin de phrase, qui
 *  ressemble à un intitulé : « 1. Introduction », « INTRODUCTION »,
 *  « Materials and Methods », « References »… Une phrase comme « Le virus a été
 *  purifié. » n'en est donc pas un. */
export const isHeadingLine = (line) => {
  const s = String(line || '').trim();
  if (!s || s.length > 90) return false;
  if (/[.;:,]$/.test(s)) return false;
  /* La ligne d'un MARQUEUR de figure (voir plus bas) n'est jamais un titre :
     sinon l'image de l'article deviendrait un intitulé de section. */
  if (isFigureMark(s)) return false;
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

/** Un bloc = un paragraphe (ou un titre) du manuscrit. */
export const blocksFromText = (text) => normalizeText(text)
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => ({ kind: isHeadingLine(line) ? 'heading' : 'paragraph', text: line }));

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

/** Les légendes deviennent les `caption` des figures et SORTENT du texte (elles
 *  sont déjà sous l'image dans le document exporté) — comme le fait
 *  « 📄 Word text ». La légende est cherchée SOUS le marqueur (le cas normal),
 *  puis AU-DESSUS (certaines revues impriment la légende avant l'image).
 *  @returns {{ text: string, figures: Array }} */
export const figuresWithCaptionsFromText = (text, figures) => {
  const list = (Array.isArray(figures) ? figures : []).map((f) => ({ ...f }));
  const lines = normalizeText(text).split('\n');
  const take = (i) => {
    const t = String(lines[i] || '').trim();
    if (!t || isFigureMark(t) || t.length > 400 || !FIGURE_LEGEND_RE.test(t)) return null;
    lines[i] = '';
    return t;
  };
  lines.forEach((line, i) => {
    if (!isFigureMark(line)) return;
    const fig = list.find((f) => f.index === figureMarkIndex(line));
    if (!fig || fig.caption) return;
    let caption = null;
    for (let j = i + 1; j < lines.length && j <= i + 3 && !caption; j += 1) {
      if (!String(lines[j] || '').trim()) continue;
      caption = take(j);
    }
    if (!caption) caption = take(i - 1);
    if (caption) fig.caption = caption;
  });
  return { text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), figures: list };
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

/** Les paragraphes d'un `word/document.xml`, dans l'ordre, chacun avec le rId
 *  de l'image qu'il contient (`''` quand il n'y en a pas). PUR : ni DOM ni
 *  navigateur, ce qui permet au test de fabriquer un .docx en mémoire. */
export const docxParagraphsWithImages = (xml) => {
  const clean = String(xml || '')
    .replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g, '')
    .replace(/<w:delText\b[^>]*>[\s\S]*?<\/w:delText>/g, '')
    .replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, '');
  const out = [];
  const re = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let m;
  while ((m = re.exec(clean))) {
    const chunk = m[0];
    const blip = /<(?:a:)?blip\b[^>]*r:(?:embed|link)="([^"]+)"/i.exec(chunk);
    const imagedata = /<(?:v:)?imagedata\b[^>]*r:id="([^"]+)"/i.exec(chunk);
    out.push({
      rid: (blip && blip[1]) || (imagedata && imagedata[1]) || '',
      text: paragraphTextFromDocxXml(chunk).trim()
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
  const lines = [];
  docxParagraphsWithImages(xml).forEach((p) => {
    const text = String(p.text || '').trim();
    if (!p.rid) { if (text) lines.push(text); return; }
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
    if (text) lines.push(text);
    lines.push(figureMark(figures.length));
  });
  return figuresWithCaptionsFromText(lines.join('\n\n'), figures);
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
 *  texte brut) → `{ text, figures }`. `text` porte les marqueurs de figure
 *  `[[FIGURE n]]` (voir plus haut) ; `figures[n-1]` décrit l'image n. */
export const readManuscriptDocument = async (file) => {
  if (!file) return { text: '', figures: [] };
  const name = String(file.name || '').toLowerCase();
  if (name.endsWith('.docx')) {
    const buf = await file.arrayBuffer();
    return docxManuscriptFromBytes(new Uint8Array(buf));
  }
  const raw = await file.text();
  if (name.endsWith('.html') || name.endsWith('.htm')) return htmlManuscriptFromHtml(raw);
  return { text: normalizeText(raw), figures: [] };
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
  { id: 'discussion', label: 'Discussion' },
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
  if (!s || s.length > 300) return false;
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

/** La ligne de noms EN POSITION d'auteur (juste sous le titre) : un nom SEUL y
 *  suffit — c'est le cas « un auteur par ligne », fréquent dans un article à un
 *  seul auteur, que la seule liste de noms ne reconnaissait pas. */
const isAuthorLineAtPosition = (text) => isAuthorish(text)
  || looksLikeAuthorLine(text, { alone: true });

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
 *  sont dans les premières lignes du document, jamais au milieu de l'article. */
const HEADER_EXTRA_SCAN = 12;
const HEADER_EXTRA_BODY_MAX = 2;

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
    if (isBodyParagraph(s)) {
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
    if (role === 'authors' || looksLikeAuthorList(s)) {
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
 *  (« keep ») sont la seule exception : elles restent dans leur partie. */
export const headerFromLineRoles = (blocks, lines) => {
  const list = Array.isArray(blocks) ? blocks : [];
  const rows = (Array.isArray(lines) ? lines : []).filter((r) => r && typeof r.at === 'number' && list[r.at]);
  const texts = (role) => rows.filter((r) => r.role === role)
    .map((r) => String(r.text || '').trim()).filter(Boolean);
  return {
    title: texts('title')[0] || '',
    authors: texts('authors').join(', '),
    affiliations: texts('affiliations').join('\n'),
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
    if (role !== 'heading' && isBodyParagraph(s)) break;
    window.push({ at: i, text: s, role });
  }
  if (!window.length) return empty;
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
     trahit (« Anna Bianchi, Mario Rossi », deux noms nus), c'est leur POSITION —
     juste sous le titre — qui les désigne. */
  let firstAuthors = explicitAuthors;
  if (firstAuthors === -1 && titleIdx >= 0 && window[titleIdx + 1]
    && window[titleIdx + 1].at === window[titleIdx].at + 1
    && window[titleIdx + 1].role !== 'affiliations'
    && isAuthorLineAtPosition(window[titleIdx + 1].text)) {
    firstAuthors = titleIdx + 1;
  }

  const authorIdxs = [];
  if (firstAuthors !== -1) {
    for (let i = firstAuthors; i < window.length; i += 1) {
      const first = i === firstAuthors;
      if (roles[i] === 'authors') { authorIdxs.push(i); continue; }
      /* La position seule désigne la PREMIÈRE ligne de noms ; les suivantes
         doivent être adjacentes et ressembler encore à des noms. */
      if (!authorIdxs.length && !(first && explicitAuthors === -1)) break;
      if (isCand(roles[i]) && (first || window[i - 1].at === window[i].at - 1)
        && (first ? isAuthorLineAtPosition(window[i].text) : isAuthorish(window[i].text))) {
        authorIdxs.push(i); continue;
      }
      break;
    }
  }

  /* 4. Les AFFILIATIONS : à la suite des auteurs (les métadonnées qui
     s'intercalent — « Correspondence: … » — sont sautées, pas arrêtées). */
  const affIdxs = [];
  if (authorIdxs.length) {
    let started = false;
    for (let i = authorIdxs[authorIdxs.length - 1] + 1; i < window.length; i += 1) {
      if (roles[i] === 'affiliations') { affIdxs.push(i); started = true; continue; }
      if (!started) continue;
      if (roles[i] === 'text' && window[i].at === window[i - 1].at + 1
        && looksLikeAddressLine(window[i].text)) { affIdxs.push(i); continue; }
      break;
    }
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

/* ── 5. Les citations du texte → les références NUMÉROTÉES du programme ───── */

/** Citation numérique : [12], [3,4], [5-7], [1;2] — espaces tolérés. */
export const NUMERIC_CITATION_RE = /\[\s*(\d{1,4}(?:\s*(?:[,;]|-|–|—|to)\s*\d{1,4})*)\s*\]/g;

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
 *  (Rossi et al., 2018)). */
export const collectCitations = (text) => {
  const s = String(text || '');
  const out = [];
  s.replace(NUMERIC_CITATION_RE, (raw, group, offset) => {
    out.push({ kind: 'numeric', raw, offset, keys: numericCitationNumbers(group).map((n) => `#${n}`) });
    return raw;
  });
  s.replace(AUTHOR_YEAR_CITATION_RE, (raw, inner, offset) => {
    const key = authorYearKeyOf(inner);
    out.push({ kind: 'author-year', raw, offset, keys: key ? [key] : [] });
    return raw;
  });
  return out.sort((a, b) => a.offset - b.offset);
};

/** Réécrit un texte pour que ses citations deviennent les marqueurs [n] du
 *  programme. Les citations NON résolues sont laissées telles quelles (rien
 *  n'est inventé) et renvoyées dans `unresolved`. */
export const convertCitationsInText = (text, numberByKey) => {
  let replaced = 0;
  const unresolved = [];
  let out = String(text || '');
  out = out.replace(NUMERIC_CITATION_RE, (raw, group) => {
    const nums = numericCitationNumbers(group).map((n) => lookupNumber(numberByKey, `#${n}`)).filter(Boolean);
    if (!nums.length) { unresolved.push(raw); return raw; }
    replaced += 1;
    return `[${nums.join(',')}]`;
  });
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
    numberByKey.set(`#${index + 1}`, number);
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




