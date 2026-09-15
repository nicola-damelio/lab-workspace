// src/components/pubCitation.js
/* =========================================================================
   PUBLICATION FORMAT — how a publication citation is rendered: order of the
   fields, style of each field, presence/absence of each field, and presets
   reproducing the reference formats of important journals.

   Kept in this React-free module so that (a) the engine can be checked by node
   (see _pub_author_style_test.mjs) and (b) both consumers share one renderer:
     • PublicationsSection → the « Formatted citation » of every paper;
     • projectDetailModule → the « Bibliography » of a project document.

   EVERY author of the paper is listed: the only rule that shortens the list is
   the “et al.” cutoff (etAlLimit). What the format chooses on top of that is
   the STYLE of the lab members' names: each scientist of the user list can be
   underlined, bold or left as typed, wherever their name appears in the author
   list (see AUTHOR_STYLES / scientistStyles).
   ========================================================================= */
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
    etAlLimit: Number.isFinite(n) && n >= 0 ? n : 0,
    alwaysShowScientists: !!(parsed && parsed.alwaysShowScientists),
    underlineScientists: !!(parsed && parsed.underlineScientists),
    scientistStyles: sanitizeScientistStyles(parsed && parsed.scientistStyles),
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

// Split a raw authors string ("Rossi M, Bianchi A and Smith J, et al.") into a
// clean list of author names, dropping any existing "et al." marker.
const parseAuthorList = (raw) => String(raw || '')
  .split(/\s*[,;]+\s*|\s+and\s+/i)
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((s) => !/^et\s*al\.?$/i.test(s));

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
// "et al." cutoff, the "always show the lab scientists" option and the
// per-scientist styles (underline / bold). Returns { html, text }. Every author
// of the paper is listed — only the cutoff can shorten the list.
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
  const html = shown
    .map((a) => wrapAuthor(escapeHtml(a), authorStyleOf(a, fmt, scientists)))
    .join(', ') + (etAl ? ', et al.' : '');
  const text = shown.join(', ') + (etAl ? ', et al.' : '');
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
