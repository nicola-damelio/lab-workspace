/* =========================================================================
   src/utils/manuscriptImport.js
   Transférer un MANUSCRIT écrit ailleurs (Google Docs exporté en .docx ou en
   page Web .html, fichier Word, texte copié) DANS un projet du programme :

     1. le TEXTE est découpé en sections par ses titres (« Introduction »,
        « Discussion », « Conclusions »…) et chaque section rejoint la section
        correspondante de la page projet (Scientific background / Discussion /
        Conclusions) — en ajout ou en remplacement, au choix ;
     2. la BIBLIOGRAPHIE de fin de document (« References » / « Bibliography »,
        telle que Paperpile l'écrit) est analysée par referenceImport et ses
        entrées rejoignent la « Project bibliography » du projet — donc aussi
        Publications → « Project bibliography » ;
     3. les CITATIONS dans le texte ([12], [3,4], [5-7], (Rossi et al., 2018),
        (Smith & Bianchi 2020)…) sont converties en références NUMÉROTÉES du
        programme ([1], [2]…) : c'est exactement ce que fait « 📚 + Reference »
        à la main (project.references + marqueur [n]).

   Tout est ICI en fonctions PURES (testables hors navigateur) ; la page projet
   ne fait que lire le fichier, afficher l'aperçu et appliquer ce qui a été coché.
   Aucune dépendance nouvelle : un .docx est un ZIP dont le texte vit dans
   word/document.xml (fflate, déjà utilisé par referenceImport).
   ========================================================================= */

import {
  normalizeText, readReferenceDocument, parseReferences, entryKeys, mergeReferenceEntries, projectBibEntry
} from './referenceImport';

/** Extensions acceptées par le champ de fichier de l'interface. */
export const MANUSCRIPT_FILE_ACCEPT = '.docx,.html,.htm,.txt,.md';

/* ── 1. Le texte → une suite de BLOCS (une ligne = un paragraphe ou un titre) ─ */

/** Un titre est une ligne COURTE, sans ponctuation de fin de phrase, qui
 *  ressemble à un intitulé : « 1. Introduction », « INTRODUCTION »,
 *  « Materials and Methods », « References »… Une phrase comme « Le virus a été
 *  purifié. » n'en est donc pas un. */
export const isHeadingLine = (line) => {
  const s = String(line || '').trim();
  if (!s || s.length > 90) return false;
  if (/[.;:,]$/.test(s)) return false;
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

/** Texte d'un document choisi par l'utilisateur (.docx → ZIP, .html → page,
 *  le reste → texte brut). Réutilise le lecteur éprouvé de referenceImport. */
export const readManuscriptText = async (file) => normalizeText(await readReferenceDocument(file));

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
  { id: 'conclusions', label: 'Conclusions' }
];

/** Mots qui, dans un titre de manuscrit, désignent une section du projet. */
const SECTION_WORDS = [
  { id: 'background', words: ['introduction', 'background', 'abstract', 'summary', 'résumé', 'resume', 'context', 'state of the art', 'literature review'] },
  { id: 'discussion', words: ['discussion', 'interpretation'] },
  { id: 'conclusions', words: ['conclusion', 'conclusions', 'concluding remarks', 'perspectives', 'outlook', 'future work', 'take-home'] }
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

/** Découpe le CORPS du manuscrit en groupes menés par un titre : chaque groupe
 *  est une partie du texte, avec la section du projet devinée. Les blocs qui
 *  précèdent le premier titre forment un groupe sans titre (chapeau / résumé) :
 *  `id` reste vide et l'utilisateur tranche dans la fenêtre d'import. */
export const groupManuscriptParts = (blocks) => {
  const parts = [];
  let current = null;
  (Array.isArray(blocks) ? blocks : []).forEach((b) => {
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




