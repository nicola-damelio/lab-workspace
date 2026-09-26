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

/* ---- LES SECTIONS : leur présence, leur ordre, leurs intitulés --------------- */

/** Une ligne qui a l'AIR d'un intitulé : plus grosse que le corps, ou en gras à
 *  la taille du corps, courte, sans ponctuation finale. */
export const headingCandidates = (lines, body) => {
  const size = (body && body.size) || 10;
  return (lines || []).filter((l) => {
    if (!l.text || l.chars > 110) return false;
    const big = l.size >= size * 1.04;
    const bold = !!(l.face && l.face.bold) && l.size >= size * 0.96;
    if (!big && !bold) return false;
    const words = l.text.split(/\s+/).length;
    if (words < 1 || words > 9) return false;
    return !/[.,;:]$/.test(l.text);
  });
};

/** LES SECTIONS, dans l'ordre où elles s'impriment : chaque intitulé reconnu,
 *  avec son mot de vocabulaire (sectionWordOf) et son intitulé imprimé. */
export const sectionHeadings = (lines, body) => headingCandidates(lines, body).map((l) => ({
  line: l,
  title: headingKey(l.text),
  key: headingKey(l.text).toLowerCase(),
  word: sectionWordOf(l.text),
}));

/* Les intitulés qui NOMMENT la liste des références : le vocabulaire de
   PUB_DOC_BLOCK_WORDS plus les tournures qu'il ne connaît pas. */
const REFERENCE_HEADINGS = ['references', 'bibliography', 'reference list', 'literature cited', 'references cited', 'cited literature', 'references and notes'];

/** L'intitulé qui NOMME la liste des références (voir REFERENCE_HEADINGS) — sert
 *  à arrêter la région des références sur une section qui, elle, n'en fait pas
 *  partie (« Supporting information », imprimée après la liste). */
export const isReferenceWord = (key) => REFERENCE_HEADINGS.includes(String(key || '').toLowerCase());

/** La section des références : son intitulé s'il est imprimé, sinon null — une
 *  revue sans intitulé au-dessus de sa liste (Science) : le détecteur le dit
 *  alors par `bibLabel: ''`, quand la liste se reconnaît à sa forme. */
export const referenceHeadingOf = (sections) =>
  (sections || []).find((s) => REFERENCE_HEADINGS.includes(s.key)) || null;

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

/** Ce qu'une liste de références MONTRE, compté sur ses entrées. */
export const referenceTraits = (entries) => {
  const list = entries || [];
  const t = {
    entries: list.length, yearInParens: 0, journalItalic: 0, volumeBold: 0,
    doi: 0, pages: 0, title: 0, numbered: 0, etAl: 0, yearThenVolume: 0, names: new Map(),
  };
  list.forEach((e) => {
    const text = e.text;
    if (/\((?:19|20)\d\d\)/.test(text)) t.yearInParens += 1;
    const italic = italicRunOf(e);
    if (italic) t.journalItalic += 1;
    if (boldNumberRunOf(e)) t.volumeBold += 1;
    if (/doi|https?:\/\/doi\.org/i.test(text)) t.doi += 1;
    if (/\b\d{1,4}\s*[\u2013-]\s*\d{1,4}\b/.test(text)) t.pages += 1;
    if (/\b(?:19|20)\d\d[,;]?\s+\d{1,4}\b/.test(text)) t.yearThenVolume += 1;
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
      if (printed > 0) t.etAl = t.etAl ? Math.min(t.etAl, printed) : printed;
    }
  });
  return t;
};

/** LE PRESET DE RÉFÉRENCE le plus proche (PUB_FORMAT_PRESETS) : l'ordre des champs
 *  et le caractère de chacun, comparés à ce que la liste montre. Le second est
 *  rendu aussi, pour que le pannello puisse dire « j'ai choisi X, Y était
 *  proche » — l'utilisateur tranche. */
export const bestPresetFor = (traits) => {
  const n = traits.entries || 1;
  const share = (v) => v / n;
  const ranked = Object.keys(PUB_FORMAT_PRESETS).map((id) => {
    const defs = PUB_FORMAT_PRESETS[id].defs;
    const style = new Map(defs.map((d) => [d[0], d[1]]));
    const idx = (f) => defs.findIndex((d) => d[0] === f);
    let score = 0;
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
  let etAl = 0;
  (bodyLines || []).forEach((l) => {
    const text = l.text || '';
    if (l.sup) counts.sup += 1;
    if (/\[\d{1,3}(?:\s*[,\u2013-]\s*\d{1,3})*\]/.test(text)) counts.bracket += 1;
    if (/\(\d{1,3}(?:\s*[,\u2013-]\s*\d{1,3})*\)/.test(text)) counts.paren += 1;
    const ad = AUTHOR_DATE_RE.exec(text);
    if (ad) {
      counts['author-date'] += 1;
      const printed = String(ad[1] || '').split(/\s*(?:&|and|,)\s*/).filter((x) => x.trim().length > 1).length;
      if (/et al/i.test(ad[0]) && printed > 0) etAl = etAl ? Math.min(etAl, printed) : printed;
    }
  });
  const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const total = counts[best] || 0;
  return { style: total > 0 ? best : 'keep', counts, etAl };
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

  /* 2. LES SECTIONS : leur ordre et leurs intitulés imprimés.
     LE TITRE DE L'ARTICLE N'EST PAS UNE SECTION : il est bien plus gros que le
     corps et son mot n'appartient à aucun vocabulaire — le premier candidat qui
     a ces deux traits part, la liste des sections commence après lui. */
  const allHeadings = sectionHeadings(lines, body);
  const headings = (allHeadings.length && !isKnownSectionKey(allHeadings[0].key)
    && allHeadings[0].line.size >= body.size * 1.3) ? allHeadings.slice(1) : allHeadings;
  const refHeading = referenceHeadingOf(headings);
  const printedTitles = headings.map((s) => s.title).filter(Boolean);
  if (printedTitles.length) evidence.push('sections, in the order printed: ' + printedTitles.join(' → '));
  else warnings.push('No section heading was recognised: the PDF may be a manuscript without headings, or its headings are neither larger nor bold.');

  /* 3. LA LISTE DES RÉFÉRENCES : de son intitulé (ou de la queue du document
     quand la revue n'en imprime aucun) jusqu'à la fin. */
  const refIndex = refHeading ? lines.indexOf(refHeading.line) : -1;
  let region = [];
  if (refIndex >= 0) {
    region = lines.slice(refIndex + 1);
    const stop = region.findIndex((l) => !/[.,;:]$/.test(l.text) && l.chars <= 110
      && headingCandidates([l], body).length && !/^\s*\[?\d/.test(l.text)
      && !isReferenceWord(headingKey(l.text).toLowerCase()));
    if (stop > 3) region = region.slice(0, stop);
  } else {
    const tail = lines.slice(Math.floor(lines.length * 0.55));
    const marks = tail.filter((l) => /\((?:19|20)\d\d\)|et al\.|doi\.org|\b\d{1,4}\s*[\u2013-]\s*\d{1,4}\b/.test(l.text)).length;
    if (tail.length > 6 && marks >= tail.length * 0.3) {
      region = tail;
      warnings.push('The reference list carries no heading of its own — Science prints it that way, so the format is set to print none either (“References” keeps no title).');
    }
  }
  const entries = referenceEntries(region);
  const traits = referenceTraits(entries);
  const titleLine = lines.slice(0, 12).reduce((best, l) => (l.chars >= 8 && (!best || l.size > best.size) ? l : best), null);
  const titleAt = titleLine ? lines.indexOf(titleLine) : -1;
  const below = titleAt >= 0 ? lines.slice(titleAt + 1).filter((l) => l.chars >= 6) : [];
  const authorsLine = below.find((l) => l.chars >= 10 && l.size >= body.size * 0.85 && l.size <= (titleLine ? titleLine.size : 99)) || null;
  const afterAuthors = authorsLine ? below.slice(below.indexOf(authorsLine) + 1) : below;
  const affilLine = afterAuthors.find((l) => l.chars >= 10 && (l.size < body.size * 0.95 || !!(l.face && l.face.italic))) || null;
  const captionLine = lines.find((l) => /^\s*(?:fig(?:ure)?|table|scheme)\s*\.?\s*\d/i.test(l.text) && l.chars >= 20) || null;
  const headingLine = headings.length ? headings[0].line : null;
  const refLine = (refHeading && refHeading.line) || region.find((l) => l.chars >= 30) || null;
  const headingFace = dominantFace(headings.map((s) => s.line)) || headingLine;
  const journalName = journalNameOf(pages);

  /* 4. LES RENVOIS DANS LE TEXTE (« come appaiono i riferimenti bibliografici
     nel testo ») et la coupe de la liste d'auteurs. */
  const inText = inTextStyleOf(bodyLines);
  const etAl = inText.etAl || traits.etAl || 0;
  evidence.push('in-text citations: ' + labelOf(IN_TEXT_STYLES, inText.style, inText.style)
    + (etAl ? ' (author list cut after ' + etAl + ')' : ''));

  /* 5. LA FORME DES NOMS D'AUTEURS ET LE PRESET DES RÉFÉRENCES. */
  const nameCounts = Array.from(traits.names.entries()).sort((a, b) => b[1] - a[1]);
  const bylineNames = nameStyleOfList((authorsLine && authorsLine.text) || '');
  const names = ((nameCounts[0] && nameCounts[0][1] >= 2) ? nameCounts[0][0] : '') || bylineNames || '';
  const preset = bestPresetFor(traits);
  const presetId = PUB_FORMAT_PRESETS[preset.id] ? preset.id : 'nature';
  const titleShare = traits.entries ? traits.title / traits.entries : 0;
  const bibFieldsOff = (traits.entries >= 4 && titleShare <= 0.3) ? ['title'] : [];
  if (names) evidence.push('author names: ' + labelOf(NAME_STYLES, names, names));
  if (entries.length) {
    evidence.push('references: ' + (traits.numbered >= entries.length * 0.6 ? 'numbered' : 'author–year')
      + ', closest preset “' + (PUB_FORMAT_PRESETS[presetId].label || presetId) + '”'
      + (bibFieldsOff.length ? ' — the article title is not printed' : ''));
  } else {
    warnings.push('No reference list was recognised in this PDF: the citation style of the shown format stays yours.');
  }

  /* 6. L'ORDRE DES SECTIONS, tel qu'il est imprimé. */
  const order = [];
  headings.forEach((s) => { if (s.word && order.indexOf(s.word) === -1) order.push(s.word); });
  if (entries.length >= 3 && order.indexOf('references') === -1) order.push('references');

  /* 7. LE CARACTÈRE DE CHAQUE PARTIE (font · taille · alignement · gras · italique). */
  const layout = {
    title: styleOfLine(titleLine || body, { bold: titleLine ? !!(titleLine.face && titleLine.face.bold) : true }),
    authors: styleOfLine(authorsLine || body),
    affiliations: styleOfLine(affilLine || body, { italic: affilLine ? !!(affilLine.face && affilLine.face.italic) : true }),
    heading: styleOfLine(headingLine || headingFace || body, { bold: headingLine ? !!(headingLine.face && headingLine.face.bold) : true }),
    body: styleOfLine(body, { align }),
    figure: { ...styleOfLine(captionLine || body), width: 100 },
    bibliography: styleOfLine(refLine || body),
  };
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




