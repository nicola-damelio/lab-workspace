/* =========================================================================
   src/components/publicationFormatFromPdf.js
   « UN PDF DE REVUE → LE FORMAT DE CETTE REVUE. »

   La demande, mot pour mot : « In the publication format, I would like to have
   a function that extracts format information by uploading a pdf. For example,
   if I want to define the style of a new journal without having to go through
   all the descriptions of the format and put it one by one in the publication
   format, I could just upload a pdf of a publication in that journal and the
   program would fill in the parameters such as the presence, order and the
   names of the sections, the font, police and style of each section, the style
   of the references in the text and in the final reference list and the way
   authors are listed. »

   CE MODULE EST LE DÉTECTEUR — pur (aucun React, aucune lecture de fichier) :
   les lignes du PDF lui arrivent de utils/pdfTextTokens.js et il rend un PAQUET
   DE FORMAT, de la même forme que ceux de journalFormats.js (preset · bibLabel ·
   names · inText · etAl · order · layout · bibFieldsOff) avec ses PREUVES :
   « body: Times 10 pt, justified », « sections: Introduction → Results and
   Discussion → Materials and Methods → References », « in-text: superscript »…
   Le pannello applique le paquet par applyJournalBundle (journalFormats.js) —
   exactement comme un journal de sa liste — et l'utilisateur retouche, ou le
   sauve sous un nom (« User defined »).

   HONNÊTETÉ : un PDF est une image de texte, pas une déclaration de style. Ce
   qui se lit sûrement — la présence d'une section, sa place, la famille et la
   taille de son caractère, la forme des renvois dans le texte, l'ordre des
   champs d'une référence — est lu ; le reste (une police embarquée qui ne dit
   pas son nom, une liste sans intitulé) est SIGNALÉ dans `warnings`, jamais
   inventé. Chaque valeur porte sa preuve, et tout reste modifiable à la main
   dans le pannello après l'application.
   ========================================================================= */
import { PUB_FORMAT_PRESETS, PUB_DOC_BLOCK_WORDS, IN_TEXT_STYLES, NAME_STYLES } from './pubCitation.js';
import { pubFontOfTypeface } from '../utils/pdfTextTokens.js';

/** Un nom court pour une suite de caractères, tel qu'il s'écrit dans les
 *  preuves (« Times bold italic »). */
export const fontLabelOf = (face) => {
  const name = (face && (face.family || face.name)) || 'face not named in the PDF';
  return name + (face && face.bold ? ' bold' : '') + (face && face.italic ? ' italic' : '');
};

const labelOf = (list, id, fallback) => {
  const found = (list || []).find((x) => x.id === id);
  return found ? found.label : fallback;
};

/** Les mots de section connus, du plus long au plus court : « materials and
 *  methods » gagne sur « methods », « results and discussion » sur « results ». */
const DOC_KEYWORDS = Object.keys(PUB_DOC_BLOCK_WORDS)
  .reduce((all, id) => all.concat(PUB_DOC_BLOCK_WORDS[id].map((w) => [w, id])), [])
  .sort((a, b) => b[0].length - a[0].length);

/** Un intitulé, nu : « 2. Materials and Methods. » → « materials and methods ». */
export const headingKey = (text) => String(text || '')
  .replace(/^\s*[([]?\d+(?:[.)]\d+)*[.)\]]?\s*/, '')   // « 2. », « 2.1 », « [3] »
  .replace(/[\s.:;·•\u2013-]+$/, '')
  .replace(/\s+/g, ' ')
  .trim();

/** Le mot d'une section : celui du vocabulaire quand l'intitulé y répond, sinon
 *  l'intitulé lui-même (pubDocOrderForWords ne reconnaît que le vocabulaire, ce
 *  qui est sans danger : un mot inconnu ne déplace rien). */
export const isKnownSectionKey = (key) => DOC_KEYWORDS.some(([w]) =>
  key === w || key.startsWith(w + ' ') || key.endsWith(' ' + w));

export const sectionWordOf = (heading) => {
  const key = headingKey(heading).toLowerCase();
  if (!key) return '';
  const found = DOC_KEYWORDS.find(([w]) => key === w || key.startsWith(w + ' ') || key.endsWith(' ' + w));
  return found ? found[0] : key;
};

/** La classe typographique dominante — celle qui écrit le plus de caractères :
 *  c'est le TEXTE de l'article (et sa taille, la taille du corps). */
export const dominantFace = (lines) => {
  const by = new Map();
  (lines || []).forEach((l) => {
    const name = (l.face && l.face.name) || '';
    const key = name + '|' + l.size;
    const e = by.get(key) || { name, size: l.size, face: l.face, chars: 0, n: 0 };
    e.chars += l.chars || 0;
    e.n += 1;
    by.set(key, e);
  });
  return Array.from(by.values()).sort((a, b) => b.chars - a.chars)[0] || null;
};

/** Justifié ou à gauche : la FIN des lignes du corps le dit — toutes au même
 *  endroit, c'est une justification ; libres, c'est un fer à gauche. */
export const bodyAlign = (bodyLines) => {
  const ends = (bodyLines || []).map((l) => l.xEnd).filter((x) => x > 0);
  if (ends.length < 6) return 'left';
  const max = Math.max.apply(null, ends);
  const straight = ends.filter((e) => Math.abs(e - max) < max * 0.012).length;
  return straight >= ends.length * 0.6 ? 'justify' : 'left';
};

/** La forme d'un nom d'auteur telle qu'elle est IMPRIMÉE — les identifiants de
 *  NAME_STYLES (utils/authorNames.js) : « Smith, J. A. » · « Smith J. A. » ·
 *  « J. A. Smith » · « Smith JA ». Une liste que rien ne permet de classer rend
 *  '' (le format garde la sienne, voir applyJournalBundle). */
export const nameStyleOfList = (raw) => {
  const s = String(raw || '').trim();
  if (s.length < 3) return '';
  if (/^\p{Lu}[\p{L}'\u2019.-]*,\s*\p{Lu}\.?(\s*\p{Lu}\.?)*/u.test(s)) return 'family-comma-initials';  // Smith, J. A.
  if (/^(?:\p{Lu}\.\s*){1,3}\p{Lu}[\p{L}'\u2019-]+/u.test(s)) return 'initials-family';                // J. A. Smith
  if (/^\p{Lu}[\p{L}'\u2019-]+\s+(?:\p{Lu}\.\s*){1,3}(?:\s|,|$)/u.test(s)) return 'family-dot-initials'; // Smith J. A.
  if (/^\p{Lu}[\p{L}'\u2019-]+\s+\p{Lu}{1,3}(?:\s|,|$)/u.test(s)) return 'family-initials';            // Smith JA
  return '';
};

/** La taille des caractères d'un passage, bornée : une taille de titre lue sur un
 *  PDF est en points, le pannello accepte 4 – 96 (voir normalizePubLayout). */
const pt = (n) => Math.max(4, Math.min(96, Math.round(Number(n) || 0)));

/* ---- LA TÊTE D'UNE PAGE DE REVUE : ce qui n'est pas une section ------------ */

/* LES LIGNES DE SERVICE d'une page de revue — celles qu'aucune section n'est
   jamais : la ligne de journal (« Contents lists available at ScienceDirect »), son
   adresse, un DOI, un ISSN, et le texte ESPACÉ d'une étiquette ou d'un titre de
   page (« j o u r n a l h o m e p a g e : w w w . e l s e v i e r . c o m / … »,
   « a r t i c l e i n f o »). Un PDF d'Elsevier en est plein, et sans ce filtre la
   ligne de journal qui suit le titre du journal se lisait comme le texte d'une
   section — c'est ainsi que la tête entière d'un article entrait dans la liste des
   « sections » (mesuré sur Analytical Biochemistry). */
const FRONT_JUNK = [
  /^\s*(?:contents lists available|journal homepage|journal home page|available online at|see front matter|full length article|short communication|original (?:research )?article)\b/i,
  /^\s*(?:https?:\/\/|www\.|doi\s*:|https:\/\/doi\.org)/i,
  /\b(?:issn|isbn|elsevier|springer|wiley|taylor\s*&\s*francis)\b/i,
];
const LETTERSPACED = /^(?:[\p{L}\d.&/]\s+){4,}[\p{L}\d.&/]\.?$/u;

/** Une ligne qui n'appartient jamais à une section : trop courte, texte espacé,
 *  adresse de revue, DOI, ISSN. */
export const isFrontMatterJunk = (line) => {
  const t = String((line && line.text) || '').replace(/\s+/g, ' ').trim();
  if (t.length < 4) return true;
  if (LETTERSPACED.test(t)) return true;
  if (/^[\p{L}\d.&/]\s[\p{L}\d.&/]\s[\p{L}\d.&/]\s[\p{L}\d.&/]\s[\p{L}\d.&/]/u.test(t)
    && t.replace(/[\s.]/g, '').length <= t.length * 0.55) return true;
  return FRONT_JUNK.some((re) => re.test(t));
};

/* ---- LES SECTIONS : leur présence, leur ordre, leurs intitulés --------------- */

/** Une ligne qui a l'AIR d'un intitulé : plus grosse que le corps, ou en gras à
 *  la taille du corps, ou en ITALIQUE à la taille du corps (un sous-titre
 *  s'imprime ainsi : « Quantification of peptide translocation »), courte, sans
 *  ponctuation finale. */
export const headingCandidates = (lines, body) => {
  const size = (body && body.size) || 10;
  return (lines || []).filter((l) => {
    if (!l.text || l.chars > 110 || isFrontMatterJunk(l)) return false;
    const big = l.size >= size * 1.04;
    const bold = !!(l.face && l.face.bold) && l.size >= size * 0.96;
    const italic = !!(l.face && l.face.italic) && l.size >= size * 0.96;
    if (!big && !bold && !italic) return false;
    const words = l.text.split(/\s+/).length;
    if (words < 1 || words > 9) return false;
    /* UN INTITULÉ COMMENCE : par une majuscule ou un numéro de section. C'est le
       trait qui écarte les PROLONGEMENTS d'une phrase — « when low
       extravesicular concentrations … », « to RL9 », « spectra » — que la taille
       ou l'italique faisaient passer pour des intitulés sur un vrai PDF. */
    if (!/^(?:[([]?\d|[\p{Lu}])/u.test(l.text)) return false;
    return !/[.,;:]$/.test(l.text);
  });
};

/** LA LIGNE SUIVANTE QUI COMPTE : la première ligne substantielle après `line`,
 *  les lignes de service écartées. C'est elle qui dit si un intitulé ouvre une
 *  section. */
export const nextContentLine = (lines, line, minChars = 25) => {
  const at = (lines || []).indexOf(line);
  for (let i = at + 1; i < lines.length; i++) {
    if ((lines[i].chars || 0) >= minChars && !isFrontMatterJunk(lines[i])) return lines[i];
  }
  return null;
};

/** LE TEXTE D'UNE SECTION : une ligne du corps du texte, ou la première entrée
 *  d'une liste de références (une liste suit son intitulé, pas du texte). */
export const isSectionText = (line, body) => {
  if (!line) return false;
  const name = (line.face && line.face.name) || '';
  const sameFace = !body || !body.name || name === body.name;
  if (sameFace && body && Math.abs((line.size || 0) - body.size) <= Math.max(0.3, body.size * 0.05)
    && (line.chars || 0) >= 40) return true;
  return /^\s*\[?\d{1,3}[.)\]]?\s+\p{Lu}/u.test(line.text || '')
    || /\b(?:19|20)\d\d\b/.test(line.text || '')
    || /\bdoi\b|\bet al\b|\b\d{1,4}\s*[\u2013-]\s*\d{1,4}\b/i.test(line.text || '');
};

/** LES SECTIONS, dans l'ordre où elles s'impriment : chaque intitulé reconnu,
 *  avec son mot de vocabulaire (sectionWordOf) et son intitulé imprimé.
 *
 *  UN INTITULÉ OUVRE UNE SECTION : le mot du vocabulaire le dit (voir
 *  PUB_DOC_BLOCK_WORDS : « introduction », « references »…) ou, quand le mot est
 *  inconnu, la ligne qui le suit — du texte de section. C'est ce second trait qui
 *  écarte la TÊTE de l'article : le titre est suivi d'une ligne d'auteurs, la
 *  ligne d'auteurs de ses affiliations, l'étiquette d'un résumé du résumé. Sans
 *  lui, la tête d'une page d'Elsevier entrait entière dans l'ordre des sections,
 *  et le VRAI ordre (« Introduction » → « Results and discussion » → …) n'y était
 *  plus. */
export const sectionHeadings = (lines, body) => headingCandidates(lines, body)
  .filter((l) => isKnownSectionKey(headingKey(l.text).toLowerCase())
    || isSectionText(nextContentLine(lines, l), body))
  .map((l) => ({
    line: l,
    title: headingKey(l.text),
    key: headingKey(l.text).toLowerCase(),
    word: sectionWordOf(l.text),
  }));

/* Les intitulés qui NOMMENT la liste des références : le vocabulaire de
   PUB_DOC_BLOCK_WORDS plus les tournures qu'il ne connaît pas. */
const REFERENCE_HEADINGS = ['references', 'bibliography', 'reference list', 'literature cited', 'references cited', 'cited literature', 'references and notes'];

/** L'intitulé qui NOMME la liste des références (voir REFERENCE_HEADINGS) : c'est
 *  par lui, et non par sa forme, que la liste se trouve (voir referenceRegionOf) —
 *  les revues l'impriment en gras, ou pas du tout. */
export const isReferenceWord = (key) => REFERENCE_HEADINGS.includes(String(key || '').toLowerCase());

/** LES ENTRÉES d'une liste de références : une entrée commence à un numéro
 *  (« [12] », « 12. ») ou, sans numérotation, à une ligne qui repart de la MARGE
 *  (les lignes suivantes sont en retrait — le retrait négatif des listes). */
export const referenceEntries = (lines) => {
  const body = (lines || []).filter((l) => l.chars >= 25);
  if (body.length < 3) return [];
  const left = Math.min.apply(null, body.map((l) => l.x));
  const atMargin = (l) => l.x <= left + 2.5;
  const numbered = body.filter((l) => /^\s*\[?\d{1,3}[.)\]]?\s+\p{Lu}/u.test(l.text)).length
    >= Math.max(3, body.length * 0.25);
  const starts = (l) => (numbered
    ? /^\s*\[?\d{1,3}[.)\]]?\s+\p{Lu}/u.test(l.text)
    : atMargin(l));
  const entries = [];
  let cur = null;
  const push = () => {
    if (cur && cur.text.trim().length >= 25 && /\d/.test(cur.text)) entries.push(cur);
    cur = null;
  };
  body.forEach((l, i) => {
    const prev = i > 0 ? body[i - 1] : null;
    const begins = starts(l) && (!prev || numbered || !atMargin(prev));
    if (begins) { push(); cur = { text: l.text, lines: [l] }; }
    else if (cur) { cur.text += ' ' + l.text; cur.lines.push(l); }
    else cur = { text: l.text, lines: [l] };
  });
  push();
  return entries;
};

/* ---- LA LISTE : OÙ ELLE EST, ET L'ORDRE DE SES CHAMPS ---------------------- */

/* LA MARQUE D'UNE LIGNE DE RÉFÉRENCES : une année, un « et al. », un DOI, une
   étendue de pages. C'est le test dont se sert la queue d'un document quand la
   revue n'imprime AUCUN intitulé (Science). */
const REFERENCE_MARKS = /\((?:19|20)\d\d\)|\bet al\.|\bdoi\b|doi\.org|\b\d{1,4}\s*[\u2013-]\s*\d{1,4}\b/;

/* LES LIGNES D'UNE LISTE, sans les EN-TÊTES DE PAGE : un article réimprime son titre
   abrégé et sa référence en tête de chaque page (« 10 Quantification of CPP direct
   translocation into liposomes / A. Walrant et al. / Anal. Biochem. 438 (2013)
   1–10 »). Ces lignes-là se glissaient dans la liste — une « entrée » de plus par
   page — et faussaient ses traits : une année entre parenthèses et un « et al. » qui
   n'appartiennent à aucune référence (mesuré : 22 entrées sur 41 « à année entre
   parenthèses » sur un article qui n'en imprime aucune). */
export const isPageHeaderLine = (text) => {
  const t = String(text || '');
  return /\bet al\b/i.test(t) && /[,;/]/.test(t)
    && /\((?:19|20)\d\d\)/.test(t) && /\b\d{1,4}\s*[\u2013-]\s*\d{1,4}\b/.test(t);
};

/** LA LISTE DES RÉFÉRENCES, son intitulé et ses entrées — trouvée PAR LE TEXTE.
 *
 *  L'intitulé est cherché tel qu'il est ÉCRIT, sans exiger qu'il ait l'air d'un
 *  intitulé : Elsevier imprime « References » à la taille du corps et sans gras
 *  (mesuré : 7,97 pt, en « AdvGulliv-R »), donc aucun détecteur d'intitulé ne le
 *  voit — et la liste n'était alors pas trouvée du tout (« No reference list was
 *  recognised in this PDF » sur un article qui en a 70). La DERNIÈRE ligne qui
 *  nomme une liste et qui a plusieurs entrées après elle gagne : le mot revient
 *  dans le corps (« as shown in the references ») comme dans un en-tête de page.
 *
 *  Rend { line, region, entries } — `line` est null quand la revue n'imprime
 *  aucun intitulé (Science) et que la liste se reconnaît à sa seule forme. */
export const referenceRegionOf = (lines) => {
  const named = [];
  (lines || []).forEach((l, i) => {
    if (!isReferenceWord(headingKey(l.text).toLowerCase())) return;
    const region = lines.slice(i + 1).filter((x) => !isPageHeaderLine(x.text));
    const entries = referenceEntries(region);
    if (entries.length >= 2) named.push({ line: l, region, entries });
  });
  if (named.length) return named[named.length - 1];
  const all = (lines || []).filter((l) => !isPageHeaderLine(l.text));
  const tail = all.slice(Math.floor(all.length * 0.55));
  const marks = tail.filter((l) => REFERENCE_MARKS.test(l.text || '')).length;
  if (tail.length > 6 && marks >= tail.length * 0.3) {
    const entries = referenceEntries(tail);
    if (entries.length >= 2) return { line: null, region: tail, entries };
  }
  return null;
};

/* ---- LE STYLE DES RÉFÉRENCES : champs présents, ordre, caractère ------------ */

/** Le premier run en ITALIQUE d'une entrée qui a l'air d'un titre de revue
 *  (des lettres, au moins trois caractères) : c'est ce que la revue met en
 *  italique, et le seul endroit où « journal » se lit. */
const italicRunOf = (entry) => (entry.lines || []).reduce((found, l) => found
  || (l.runs || []).find((r) => r.face && r.face.italic && String(r.text || '').trim().length >= 3 && /[A-Za-z]{2}/.test(r.text))
  || null, null);

/** Un run en GRAS fait surtout de chiffres (le volume d'une revue). */
const boldNumberRunOf = (entry) => (entry.lines || []).reduce((found, l) => found
  || (l.runs || []).find((r) => r.face && r.face.bold && /\d/.test(String(r.text)) && String(r.text).trim().length <= 5)
  || null, null);

/** LA COUPE « et al. » : la valeur que PLUSIEURS entrées montrent — la plus
 *  fréquente, et jamais une seule. Un article à un seul auteur s'écrit « Smith et
 *  al. », et sa seule entrée suffisait à faire couper TOUTES les listes du format
 *  après un nom (mesuré : un PDF d'Elsevier donnait « author list cut after 1 »).
 *  Aucun accord, aucune coupe : le format garde le réglage de l'utilisateur. */
export const etAlOf = (counts) => {
  const ranked = Array.from((counts || new Map()).entries())
    .filter(([, times]) => times >= 2)
    .sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  return ranked.length ? ranked[0][0] : 0;
};

/** Ce qu'une liste de références MONTRE, compté sur ses entrées. */
export const referenceTraits = (entries) => {
  const list = entries || [];
  const t = {
    entries: list.length, yearInParens: 0, journalItalic: 0, volumeBold: 0,
    doi: 0, pages: 0, title: 0, numbered: 0, etAl: 0, etAls: new Map(),
    yearThenVolume: 0, names: new Map(),
  };
  list.forEach((e) => {
    const text = e.text;
    if (/\((?:19|20)\d\d\)/.test(text)) t.yearInParens += 1;
    const italic = italicRunOf(e);
    const boldNum = boldNumberRunOf(e);
    if (italic) t.journalItalic += 1;
    if (boldNum) t.volumeBold += 1;
    if (/doi|https?:\/\/doi\.org/i.test(text)) t.doi += 1;
    if (/\b\d{1,4}\s*[\u2013-]\s*\d{1,4}\b/.test(text)) t.pages += 1;
    /* L'ANNÉE AVANT LE VOLUME (« 2019, 41 ») : le trait qui sépare « année, volume,
       pages » (ACS, Science) de « volume (année) pages » (Elsevier, Springer). Il se
       lit sur les POSITIONS (voir volumePositionOf) : l'ancien motif ne connaissait
       que « année, chiffres » et comptait donc zéro pour toute une revue d'Elsevier,
       qui écrit « Biochem. J. 407 (2007) 285–292 ». */
    const yearAt = text.search(/\b(?:19|20)\d\d\b/);
    const volumeAt = volumePositionOf(text, boldNum ? boldNum.text : '');
    if (yearAt >= 0 && volumeAt >= 0 && yearAt < volumeAt) t.yearThenVolume += 1;
    if (/^\s*\[?\d{1,3}[.)\]]?\s+\p{Lu}/u.test(text)) t.numbered += 1;
    /* LE TITRE DE L'ARTICLE : un morceau de phrase (plusieurs mots, des mots en
       minuscules) placé avant la revue — Science ne l'imprime pas, et c'est
       exactement ce que bibFieldsOff éteint. */
    const head = italic ? text.slice(0, Math.max(0, text.indexOf(italic.text))) : text;
    const segs = head.split(/\.\s+/).map((s) => s.trim()).filter(Boolean).slice(1);
    if (segs.some((s) => s.split(/\s+/).length >= 4 && (s.match(/\b[a-z]{3,}\b/g) || []).length >= 2)) t.title += 1;
    /* LES NOMS : « et al. » dans la liste dit où le journal la coupe, et la forme
       du premier nom est celle que le format adoptera pour toutes. */
    const first = text.replace(/^\s*\[?\d{1,3}[.)\]]?\s+/, '').split(/\s{2,}|\.\s/)[0] || '';
    const form = nameStyleOfList(first.split(/\s+et al/)[0]);
    if (form) t.names.set(form, (t.names.get(form) || 0) + 1);
    const cut = /^(.*?)\bet al\b/i.exec(text.replace(/^\s*\[?\d{1,3}[.)\]]?\s+/, ''));
    if (cut) {
      const printed = cut[1].split(/\s*(?:,|&|and)\s*/).filter((x) => x.trim().length > 1 && !/^\(?(?:19|20)\d\d/.test(x.trim())).length;
      if (printed > 0) t.etAls.set(printed, (t.etAls.get(printed) || 0) + 1);
    }
  });
  t.etAl = etAlOf(t.etAls);
  return t;
};

/* LES CHAMPS D'UNE RÉFÉRENCE, dans l'ordre où les presets les écrivent (voir
   PUB_FORMAT_PRESETS). C'est L'ORDRE DES CHAMPS qui fait un style de références —
   « auteurs. titre. revue, année, volume, pages » (ACS) et « auteurs (année).
   titre. revue, volume, pages » (cell) portent les mêmes champs et ne se
   ressemblent pourtant pas — et cet ordre se LIT sur la page. */
export const REFERENCE_FIELDS = ['authors', 'year', 'title', 'journal', 'volume', 'pages', 'doi'];

/** OÙ COMMENCE LE VOLUME : le numéro en GRAS quand la revue le met en gras (ACS,
 *  Science), sinon celui qui PRÉCÈDE l'année (« 683(2011) », « 407 (2007) » — le
 *  style d'Elsevier et de Springer), sinon celui qui SUIT une année sans
 *  parenthèses (« 2019, 41 » — le style de l'ACS). -1 quand aucun ne le montre :
 *  un livre n'a pas de volume. */
export const volumePositionOf = (text, boldRun) => {
  const t = String(text || '');
  if (boldRun) { const at = t.indexOf(boldRun); if (at >= 0) return at; }
  const before = /\b(\d{1,4})\s*\(?\s*(?:19|20)\d\d\)?/.exec(t);
  if (before) return before.index;
  const after = /(?:^|[^\d(])(?:19|20)\d\d[,;]?\s+(\d{1,4})\b/.exec(t);
  return after ? t.indexOf(after[1], after.index) : -1;
};

/** OÙ COMMENCE LE TITRE de l'article : le morceau de PHRASE (des mots en
 *  minuscules) qui suit le premier point de la référence, quand la revue s'imprime
 *  avant lui. -1 quand aucun morceau n'en a l'air (Science ne l'imprime pas). */
const titlePositionOf = (text, journalAt) => {
  const head = journalAt > 0 ? text.slice(0, journalAt) : text;
  const segs = head.split(/\.\s+/).map((s) => s.trim()).filter(Boolean);
  for (let i = 1; i < segs.length; i++) {
    if (segs[i].split(/\s+/).length >= 4 && (segs[i].match(/\b[a-z]{3,}\b/g) || []).length >= 2) {
      return text.indexOf(segs[i]);
    }
  }
  return -1;
};

/** L'ORDRE DES CHAMPS d'UNE entrée, tel qu'il s'imprime : rangés par la POSITION
 *  où chacun commence dans le texte — l'année, le titre de l'article, la revue (le
 *  run en italique), le volume (le numéro en gras), les pages, le DOI. Les auteurs
 *  ouvrent la référence dans tous les presets : leur rang réel n'est donc pas
 *  comparé, ils restent en tête. */
export const referenceFieldPositions = (entry) => {
  const text = String((entry && entry.text) || '');
  const at = (re) => { const m = re.exec(text); return m ? m.index : -1; };
  const lines = (entry && entry.lines) || [];
  const italic = italicRunOf({ lines });
  const bold = boldNumberRunOf({ lines });
  const journal = italic ? text.indexOf(italic.text) : -1;
  const positions = {
    authors: 0,
    year: at(/\b(?:19|20)\d\d\b/),
    title: titlePositionOf(text, journal),
    journal,
    volume: volumePositionOf(text, bold ? bold.text : ''),
    pages: at(/\b\d{1,4}\s*[\u2013-]\s*\d{1,4}\b/),
    doi: at(/\bdoi\b|https:\/\/doi\.org/i),
  };
  return REFERENCE_FIELDS
    .map((id, i) => ({ id, at: positions[id], i }))
    .filter((f) => f.at >= 0 && f.id !== 'authors')
    .sort((a, b) => a.at - b.at || a.i - b.i)
    .map((f) => f.id);
};

/** LA PART DE PAIRES DE CHAMPS que deux ordres rangent de la même façon — 1 quand
 *  ils disent la même chose, 0 quand ils disent l'inverse. C'est ainsi qu'un ordre
 *  LU sur la page est comparé à l'ordre d'un PRESET (voir bestPresetFor). */
export const orderConcordance = (order, reference) => {
  const present = (reference || []).filter((f) => (order || []).includes(f));
  const pairs = [];
  present.forEach((a, i) => present.slice(i + 1).forEach((b) => pairs.push([a, b])));
  if (!pairs.length) return 1;
  const kept = pairs.filter(([a, b]) => order.indexOf(a) < order.indexOf(b)).length;
  return kept / pairs.length;
};

/** L'ORDRE DES CHAMPS DE LA LISTE : celui sur lequel les entrées S'ACCORDENT (la
 *  position médiane de chaque champ) et la part d'entrées qui le suivent —
 *  `agreed` bas veut dire que la liste n'a pas d'ordre lisible (des styles
 *  mélangés, un PDF recomposé), et le pannello le dit alors au lieu d'en tirer un
 *  preset. */
export const referenceFieldOrder = (entries) => {
  const list = (entries || []).filter((e) => /[A-Za-z]/.test((e && e.text) || ''));
  if (!list.length) return { order: [], agreed: 0, entries: 0 };
  const ranked = list.map(referenceFieldPositions);
  const seen = REFERENCE_FIELDS.filter((id) => id !== 'authors')
    .map((id) => {
      const positions = ranked.map((o) => o.indexOf(id)).filter((at) => at >= 0).sort((a, b) => a - b);
      return { id, at: positions.length ? positions[Math.floor(positions.length / 2)] : -1, n: positions.length };
    })
    .filter((f) => f.n > 0)
    .sort((a, b) => a.at - b.at || REFERENCE_FIELDS.indexOf(a.id) - REFERENCE_FIELDS.indexOf(b.id));
  const order = ['authors'].concat(seen.map((f) => f.id));
  const agreed = ranked.length
    ? ranked.reduce((sum, o) => sum + orderConcordance(order, ['authors'].concat(o)), 0) / ranked.length
    : 0;
  return { order, agreed: Number(agreed.toFixed(2)), entries: list.length };
};

/** LE PRESET DE RÉFÉRENCE le plus proche (PUB_FORMAT_PRESETS) : l'ordre des champs
 *  et le caractère de chacun, comparés à ce que la liste montre. Le second est
 *  rendu aussi, pour que le pannello puisse dire « j'ai choisi X, Y était
 *  proche » — l'utilisateur tranche. */
export const bestPresetFor = (traits, fieldOrder) => {
  const n = traits.entries || 1;
  const share = (v) => v / n;
  const read = (fieldOrder && fieldOrder.order) || [];
  /* L'ORDRE N'EST CRU QUE S'IL EST LISIBLE : trois champs au moins, et des entrées
     qui s'accordent (voir referenceFieldOrder). */
  const usable = read.length >= 3 && (fieldOrder.agreed || 0) >= 0.6;
  const ranked = Object.keys(PUB_FORMAT_PRESETS).map((id) => {
    const defs = PUB_FORMAT_PRESETS[id].defs;
    const style = new Map(defs.map((d) => [d[0], d[1]]));
    const idx = (f) => defs.findIndex((d) => d[0] === f);
    let score = 0;
    /* L'ORDRE DES CHAMPS, lu sur la liste : le signal le plus sûr (deux styles
       peuvent imprimer les mêmes champs dans un ordre inverse). ±4 points, soit
       le poids des traits de caractère réunis. */
    if (usable) score += Math.round((orderConcordance(read, defs.map((d) => d[0])) - 0.5) * 8);
    if (idx('year') === 1) score += share(traits.yearInParens) >= 0.6 ? 3 : -1;
    else if (idx('year') > idx('title')) score += share(traits.yearInParens) < 0.4 ? 1 : -1;
    if (style.get('journal') === 'italic') score += share(traits.journalItalic) >= 0.5 ? 2 : -2;
    if (style.get('volume') === 'bold') score += share(traits.volumeBold) >= 0.4 ? 2 : -2;
    if (style.get('title') === 'italic') score += share(traits.title) < 0.5 ? 1 : 0;
    if (defs.some((d) => d[0] === 'doi')) score += share(traits.doi) >= 0.3 ? 1 : -1;
    if (idx('year') >= 0 && idx('volume') >= 0) {
      const yearFirst = idx('year') < idx('volume');
      score += (yearFirst === (share(traits.yearThenVolume) >= 0.5)) ? 2 : -2;
    }
    return { id, score };
  }).sort((a, b) => b.score - a.score);
  return ranked[0] || { id: 'nature', score: 0 };
};

/* ---- LES RENVOIS DANS LE TEXTE --------------------------------------------- */

const SURNAME = "\\p{Lu}[\\p{L}'\u2019-]+";
const AUTHOR_DATE_RE = new RegExp(
  `\\(\\s*(${SURNAME}(?:\\s*(?:&|and|,)\\s*${SURNAME})*)(?:\\s+et al\\.?)?\\s*,?\\s*(?:19|20)\\d\\d[a-z]?\\s*\\)`, 'u');

/** LA FORME DES RENVOIS DANS LE TEXTE, comptée sur le corps de l'article :
 *  exposant (un run plus petit, fait de chiffres), [12], (12), ou
 *  (Smith et al., 2019). Le seuil « et al. » vient du NOMBRE DE NOMS imprimés
 *  avant « et al. » — c'est la même grandeur que etAlLimit du format. */
export const inTextStyleOf = (bodyLines) => {
  const counts = { sup: 0, bracket: 0, paren: 0, 'author-date': 0 };
  const etAls = new Map();
  (bodyLines || []).forEach((l) => {
    const text = l.text || '';
    if (l.sup) counts.sup += 1;
    if (/\[\d{1,3}(?:\s*[,\u2013-]\s*\d{1,3})*\]/.test(text)) counts.bracket += 1;
    if (/\(\d{1,3}(?:\s*[,\u2013-]\s*\d{1,3})*\)/.test(text)) counts.paren += 1;
    const ad = AUTHOR_DATE_RE.exec(text);
    if (ad) {
      counts['author-date'] += 1;
      const printed = String(ad[1] || '').split(/\s*(?:&|and|,)\s*/).filter((x) => x.trim().length > 1).length;
      if (/et al/i.test(ad[0]) && printed > 0) etAls.set(printed, (etAls.get(printed) || 0) + 1);
    }
  });
  const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const total = counts[best] || 0;
  /* La coupe « et al. » ne se lit que si PLUSIEURS renvois la montrent (voir etAlOf). */
  return { style: total > 0 ? best : 'keep', counts, etAl: etAlOf(etAls) };
};

/* ---- LE CARACTÈRE DE CHAQUE PARTIE (voir PUB_LAYOUT_PARTS) ------------------ */

/** Le réglage d'une partie du format, à partir de la ligne qui la montre : la
 *  même forme qu'emptyPubTextStyle (pubCitation.js) — font · size · align ·
 *  bold · italic · underline · color. */
export const styleOfLine = (line, extra) => ({
  font: pubFontOfTypeface(line && line.face),
  size: pt(line && line.size),
  align: 'left',
  bold: !!(line && line.face && line.face.bold),
  italic: !!(line && line.face && line.face.italic),
  underline: null,
  color: '',
  ...(extra || {}),
});

/** LE NOM DE LA REVUE, s'il est imprimé : la ligne de tête répétée d'une page à
 *  l'autre (le « running head »), ou celle qui nomme une revue dès la première
 *  page. Rien d'inventé : sans indice, ''. */
export const journalNameOf = (pages) => {
  const first = (pages && pages[0] && pages[0].lines) || [];
  const later = (pages || []).slice(1).reduce((all, p) => all.concat(p.lines || []), []).map((l) => l.text);
  const candidate = first.slice(0, 6).find((l) => l.text.length >= 4 && l.text.length <= 60
    && (/^(?:the\s+)?(?:journal|j\.|proc\.|nature|science|cell|angew|chems?|anal\.|biochem|elife|plos|pnas|acs|rsc|wiley|elsevier|springer)/i.test(l.text)
      || later.filter((t) => t === l.text).length > 0));
  return candidate ? candidate.text.replace(/\s+/g, ' ').trim() : '';
};

/** LE NOMBRE DE COLONNES DE LA PAGE, tel qu'il se voit : la part des lignes du
 *  texte qui appartiennent à une DEUXIÈME colonne (linesOfPage les compte, voir
 *  utils/pdfTextTokens.js). Une revue s'imprime souvent sur deux colonnes, et
 *  c'est la seule chose que ce détecteur en puisse dire — le style « deux
 *  colonnes » du format en découle (pubCitation.js, PUB_PAGE_COLUMNS : la page,
 *  l'impression, le PDF et l'export suivent tous la même feuille). Un PDF qui
 *  s'imprime sur une colonne ne dit rien : le format garde alors son réglage. */
export const columnsOf = (pages) => {
  const lines = (pages || []).reduce((all, p) => all.concat(p.lines || []), []);
  const text = lines.filter((l) => (l.chars || 0) >= 25);
  const second = text.filter((l) => l.column === 1).length;
  return (second >= 3 && second >= text.length * 0.15) ? 2 : 1;
};

/* ---- LA TÊTE DE L'ARTICLE : le titre, les auteurs, les affiliations --------- */

/* UN MORCEAU D'UNE LISTE D'AUTEURS : « Smith », « J. A. », « Astrid Walrant »,
   « Isabel D. Alves », « U. Langel » — un à quatre mots capitalisés, suivis au
   plus d'un signe d'appel (« Walrant a,b », « Tunnemann* », « Jones2 »). */
const CAP_WORD = "\\p{Lu}[\\p{L}'’.-]*";
const PERSON_PIECE_RE = new RegExp(
  '^(?:' + CAP_WORD + ')(?:\\s+' + CAP_WORD + '){0,3}(?:\\s*[a-z\\d†*‡§¶,]{1,3})?$', 'u');

/** LA LIGNE D'AUTEURS, vue de loin : au moins deux noms séparés par une virgule,
 *  un « & » ou un « and », et au moins six morceaux sur dix qui ont la FORME d'un
 *  nom. C'est ce test qui écarte les affiliations — « UMR 7203 CNRS, ENS,
 *  Laboratoire des Biomolécules, UPMC–Université Paris 06, 75005 Paris, France »
 *  n'a que deux morceaux qui y répondent.
 *
 *  « et » n'est PAS une séparation : « Biochimica et Biophysica Acta » (le titre
 *  d'une revue, imprimé en gros au-dessus du titre de l'article) se lisait alors
 *  comme deux noms et passait pour la ligne d'auteurs d'un vrai PDF. Une liste
 *  française (« A. Dupont, B. Martin et C. Rossi ») reste reconnue — par la forme
 *  du nom, plus bas. */
export const looksLikeAuthorLine = (text) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length < 6 || t.length > 400) return false;
  const pieces = t.split(/\s*(?:,|;|&|\band\b)\s*/i).map((s) => s.trim()).filter((s) => s.length > 1);
  if (!pieces.length) return false;
  const people = pieces.filter((p) => PERSON_PIECE_RE.test(p));
  if (people.length >= 2 && people.length >= pieces.length * 0.6) return true;
  return people.length === 1 && pieces.length <= 2 && !!nameStyleOfList(t);
};

/** LA TÊTE DE LA PREMIÈRE PAGE : le titre, la ligne d'auteurs, les affiliations.
 *
 *  Elle se lit À PARTIR DE LA LIGNE D'AUTEURS, parce que c'est la seule des trois
 *  qui soit reconnaissable en soi (une liste de noms) : le titre est le bloc de
 *  lignes qui la surmonte dans la même taille, les affiliations ce qui la suit —
 *  plus petit ou en italique. Chercher le titre d'abord ne tient pas : sur une
 *  page d'Elsevier, la plus grosse ligne du haut est le TITRE DE LA REVUE, et la
 *  ligne d'auteurs annoncée était alors l'adresse de la revue, à la taille du
 *  corps (mesuré : 8 pt annoncés, 11 pt imprimés).
 *
 *  Rien n'est deviné : sans ligne d'auteurs reconnue, il n'y a pas de tête et le
 *  détecteur le dit (voir les avertissements de detectPublicationFormat). */
export const frontMatterOf = (pages, body) => {
  const page = (pages && pages[0]) || null;
  const all = (page && page.lines) || [];
  const height = (page && page.height) || 0;
  const inBand = (l) => !height || (l.y || 0) >= height * 0.5;
  /* LA LIGNE D'AUTEURS SE TROUVE SOUS SON TITRE : parmi les lignes au-dessus d'elle
     (au plus trois, les lignes de service écartées), il y en a une de PLUS GRANDE.
     C'est ce trait qui la sépare du TITRE DE LA REVUE, imprimé en gros sur la même
     page (« Biochimica et Biophysica Acta » se lisait comme une liste de noms, et la
     tête entière de l'article était alors lue de travers). */
  const hasTitleAbove = (l) => {
    const at = all.indexOf(l);
    let seen = 0;
    for (let i = at - 1; i >= 0 && seen < 3; i--) {
      const up = all[i];
      if (isFrontMatterJunk(up) || (up.chars || 0) < 4) continue;
      seen += 1;
      if ((up.size || 0) >= (l.size || 0) * 1.05) return true;
    }
    return false;
  };
  const byline = all.slice(0, 25).find((l) => inBand(l) && !isFrontMatterJunk(l)
    && (l.chars || 0) >= 6 && (l.size || 0) >= (body.size || 10) * 0.85
    && looksLikeAuthorLine(l.text) && hasTitleAbove(l)) || null;
  const titleLines = [];
  if (byline) {
    const at = all.indexOf(byline);
    for (let i = at - 1; i >= 0; i--) {
      const l = all[i];
      if (isFrontMatterJunk(l) || !l.text) break;
      if ((l.chars || 0) < 4 || (l.size || 0) < (body.size || 10) * 1.05) break;
      titleLines.unshift(l);
    }
  }
  const titleLine = titleLines.length
    ? titleLines.reduce((best, l) => (l.size > best.size ? l : best), titleLines[0])
    : null;
  const after = byline ? all.slice(all.indexOf(byline) + 1) : [];
  const affilLine = after.find((l) => (l.chars || 0) >= 10 && !isFrontMatterJunk(l)
    && ((l.size || 0) < (byline.size || 0) * 0.98 || !!(l.face && l.face.italic))) || null;
  return { titleLine, authorsLine: byline, affilLine, titleLines };
};

/* =========================================================================
   LA DÉTECTION : UN PAQUET DE FORMAT, AVEC SES PREUVES
   ========================================================================= */

/** `doc` = ce que rend pdfTextLines (utils/pdfTextTokens.js).
 *  Rend { bundle, evidence, warnings, confidence, journalName, sections } —
 *  `bundle` a la forme d'un paquet de journalFormats.js, donc applyJournalBundle
 *  l'applique comme un journal de la liste, et le pannello peut le sauver sous
 *  un nom (il apparaît alors dans « User defined »). */
export const detectPublicationFormat = (doc, { label = '' } = {}) => {
  const pages = (doc && doc.pages) || [];
  const lines = pages.reduce((all, p) => all.concat(p.lines || []), []);
  const evidence = [];
  const warnings = [];
  if (!lines.length) {
    return {
      bundle: null, evidence, sections: [], journalName: '', confidence: 0,
      warnings: ['No text in this PDF — a scanned page is an image, and an image has no fonts to read. Upload a PDF with a text layer.'],
    };
  }

  /* 1. LE CORPS DU TEXTE : la classe typographique qui écrit le plus de
     caractères. C'est elle qui donne la taille de référence — un corps de
     10 pt, un intitulé de 12 pt. */
  const substantial = lines.filter((l) => l.chars >= 25);
  const body = dominantFace(substantial) || dominantFace(lines) || { size: 10, face: null, name: '' };
  const bodyKey = (body.name || '') + '|' + body.size;
  const bodyLines = substantial.filter((l) => ((l.face && l.face.name) || '') + '|' + l.size === bodyKey);
  const align = bodyAlign(bodyLines);
  evidence.push('body: ' + fontLabelOf(body.face) + ' ' + pt(body.size) + ' pt, ' + (align === 'justify' ? 'justified' : 'left-aligned'));

  /* 2. LA TÊTE DE L'ARTICLE : le titre, la ligne d'auteurs, les affiliations.
     Elle n'est pas une SECTION (voir sectionHeadings) mais son CARACTÈRE se lit
     là, et c'est la demande : « the character size of authors ». */
  const front = frontMatterOf(pages, body);
  const titleLine = front.titleLine;
  const authorsLine = front.authorsLine;
  const affilLine = front.affilLine;
  if (titleLine) {
    evidence.push('title: ' + fontLabelOf(titleLine.face) + ' ' + pt(titleLine.size) + ' pt'
      + (titleLine.face && titleLine.face.bold ? ', bold' : ''));
  }
  if (authorsLine) evidence.push('authors: ' + fontLabelOf(authorsLine.face) + ' ' + pt(authorsLine.size) + ' pt');
  else if (titleLine) warnings.push('The line of authors was not recognised: the authors take the body character (the byline may be set apart from the title, or built with names the program cannot tell from an affiliation).');

  /* 3. LES SECTIONS : leur ordre et leurs intitulés imprimés (voir sectionHeadings
     — un intitulé OUVRE une section, et la tête de l'article n'en ouvre aucune). */
  const headings = sectionHeadings(lines, body);
  const printedTitles = headings.map((s) => s.title).filter(Boolean);
  if (printedTitles.length) evidence.push('sections, in the order printed: ' + printedTitles.join(' → '));
  else warnings.push('No section heading was recognised: the PDF may be a manuscript without headings, or its headings are neither larger nor bold nor italic.');

  /* 4. LA LISTE DES RÉFÉRENCES, trouvée par le TEXTE de son intitulé (ou par sa
     seule forme quand la revue n'en imprime aucun) — voir referenceRegionOf. */
  const refs = referenceRegionOf(lines);
  /* L'INTITULÉ de la liste, quand la revue en imprime un : il devient le titre
     choisi par le format (« References », « Bibliography »…), et son absence est
     une réponse — Science imprime sa liste sans intitulé (voir bibLabel). */
  const refHeading = (refs && refs.line)
    ? { line: refs.line, title: headingKey(refs.line.text), key: headingKey(refs.line.text).toLowerCase() }
    : null;
  const region = (refs && refs.region) || [];
  const entries = (refs && refs.entries) || [];
  const traits = referenceTraits(entries);
  if (!entries.length) warnings.push('No reference list was recognised in this PDF: the citation style of the shown format stays yours.');
  else if (!refHeading) warnings.push('The reference list carries no heading of its own — Science prints it that way, so the format is set to print none either (“References” keeps no title).');

  /* LE CARACTÈRE DE LA LISTE EST CELUI DE SES ENTRÉES, pas de son intitulé : un
     intitulé s'imprime en gras et plus gros que la liste qu'il surmonte (mesuré :
     « References » à 12 pt au-dessus d'entrées à 9 pt), et la liste héritait de
     lui. La classe dominante des ENTRÉES est celle du texte de la liste. */
  const refFace = dominantFace(entries.reduce((all, e) => all.concat((e.lines || []).filter((l) => (l.chars || 0) >= 25)), []))
    || dominantFace(region.filter((l) => (l.chars || 0) >= 25));
  const refLine = refFace ? { face: refFace.face, size: refFace.size } : null;
  const captionLine = lines.find((l) => /^\s*(?:fig(?:ure)?|table|scheme)\s*\.?\s*\d/i.test(l.text) && l.chars >= 20) || null;
  const headingLine = headings.length ? headings[0].line : null;
  const headingFace = dominantFace(headings.map((s) => s.line)) || headingLine;
  const journalName = journalNameOf(pages);

  /* 5. LES RENVOIS DANS LE TEXTE (« come appaiono i riferimenti bibliografici
     nel testo ») et la coupe de la liste d'auteurs. */
  const inText = inTextStyleOf(bodyLines);
  const etAl = inText.etAl || traits.etAl || 0;
  evidence.push('in-text citations: ' + labelOf(IN_TEXT_STYLES, inText.style, inText.style)
    + (etAl ? ' (author list cut after ' + etAl + ')' : ''));

  /* 6. LA FORME DES NOMS D'AUTEURS, L'ORDRE DES CHAMPS DE LA LISTE ET LE PRESET. */
  const nameCounts = Array.from(traits.names.entries()).sort((a, b) => b[1] - a[1]);
  const bylineNames = nameStyleOfList((authorsLine && authorsLine.text) || '');
  const names = ((nameCounts[0] && nameCounts[0][1] >= 2) ? nameCounts[0][0] : '') || bylineNames || '';
  /* L'ORDRE DES CHAMPS, lu sur les entrées (voir referenceFieldOrder) : c'est lui
     qui départage deux styles qui impriment les mêmes champs dans un autre ordre. */
  const fieldOrder = referenceFieldOrder(entries);
  const preset = bestPresetFor(traits, fieldOrder);
  const presetId = PUB_FORMAT_PRESETS[preset.id] ? preset.id : 'nature';
  const titleShare = traits.entries ? traits.title / traits.entries : 0;
  const bibFieldsOff = (traits.entries >= 4 && titleShare <= 0.3) ? ['title'] : [];
  if (names) evidence.push('author names: ' + labelOf(NAME_STYLES, names, names));
  if (entries.length) {
    evidence.push('references: ' + (traits.numbered >= entries.length * 0.6 ? 'numbered' : 'author–year')
      + (fieldOrder.order.length >= 2 ? ', fields printed ' + fieldOrder.order.join(' › ') : '')
      + ', closest preset “' + (PUB_FORMAT_PRESETS[presetId].label || presetId) + '”'
      + (bibFieldsOff.length ? ' — the article title is not printed' : ''));
    if (fieldOrder.order.length >= 3 && fieldOrder.agreed < 0.6) {
      warnings.push('The reference entries do not agree on the order of their fields (some may be books, or the list may mix two styles): the citation style is the closest preset, and every line of it is yours to change.');
    }
  }

  /* 7. L'ORDRE DES SECTIONS, tel qu'il est imprimé. */
  const order = [];
  headings.forEach((s) => { if (s.word && order.indexOf(s.word) === -1) order.push(s.word); });
  if (entries.length >= 3 && order.indexOf('references') === -1) order.push('references');

  /* 8. LE CARACTÈRE DE CHAQUE PARTIE (font · taille · alignement · gras · italique),
     ET LE NOMBRE DE COLONNES DE LA PAGE — le style « deux colonnes » des revues,
     qu'une page de revue MONTRE (voir pubCitation.js, PUB_PAGE_COLUMNS). */
  const columns = columnsOf(pages);
  const layout = {
    title: styleOfLine(titleLine || body, { bold: titleLine ? !!(titleLine.face && titleLine.face.bold) : true }),
    authors: styleOfLine(authorsLine || body),
    affiliations: styleOfLine(affilLine || body, { italic: affilLine ? !!(affilLine.face && affilLine.face.italic) : true }),
    heading: styleOfLine(headingLine || headingFace || body, { bold: headingLine ? !!(headingLine.face && headingLine.face.bold) : true }),
    body: styleOfLine(body, { align }),
    figure: { ...styleOfLine(captionLine || body), width: 100 },
    bibliography: styleOfLine(refLine || body),
  };
  if (columns === 2) {
    layout.page = { columns };
    evidence.push('the page prints in two columns — the format takes the two-column page, and the head lines (title, authors, affiliations) bar across it');
  }
  if (refLine && refHeading) {
    evidence.push('the reference list itself: ' + fontLabelOf(refLine.face) + ' ' + pt(refLine.size) + ' pt (its heading is not its text)');
  }
  const families = {};
  ['title', 'body', 'bibliography'].forEach((part) => { families[layout[part].font] = true; });
  if (Object.keys(families).length > 1) {
    warnings.push('More than one font family was read in this PDF (a journal often prints its title and its text in different faces): each part of the format takes the one it prints.');
  }
  if (!captionLine) warnings.push('No figure caption was recognised: the caption character is the body one.');

  const bundle = {
    label: String(label || journalName || 'Detected from a PDF').slice(0, 60),
    preset: presetId,
    bibLabel: refHeading ? refHeading.title : (entries.length >= 3 ? '' : 'References'),
    names,
    inText: inText.style,
    etAl,
    order,
    layout,
    bibFieldsOff,
    /* L'ORDRE DES CHAMPS DE LA LISTE, tel qu'il a été LU (voir referenceFieldOrder) :
       le pannello le montre à côté du preset choisi, pour que la comparaison soit
       visible. Ce n'est pas un réglage du format — il ne part donc pas avec lui
       (applyJournalBundle ne garde que les clés qu'il connaît). */
    bibFieldOrder: fieldOrder.order,
    notes: 'Read from a PDF' + (journalName ? ' of ' + journalName : '') + ': '
      + evidence.slice(0, 4).join(' · ') + '. Everything stays editable in the panel below.',
  };

  /* 8. LA CONFIANCE : ce qui a été VU, compté — rien de plus. */
  let confidence = 0;
  if (headings.length >= 3) confidence += 1;
  if (entries.length >= 4) confidence += 1;
  if (inText.style !== 'keep') confidence += 1;
  if (names) confidence += 1;
  if (preset.score > 0) confidence += 1;
  if (doc && doc.truncated) {
    warnings.push('Only the first ' + pages.length + ' pages were read (the format and the reference list are there): a section printed later is not in the list.');
  }

  return { bundle, evidence, warnings, confidence, journalName, sections: printedTitles };
};




