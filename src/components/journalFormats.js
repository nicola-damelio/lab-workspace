// src/components/journalFormats.js
/* =========================================================================
   JOURNAL FORMATS — « cambiare giornale di submission velocemente ».

   La demande : « se invio il paper a JACS e viene rifiutato, posso decidere di
   inviarlo a angewandte: l'ordine delle sezioni, il formato della bibliografia,
   il carattere (font e police, stampatello, corsivo etc) delle varie sezioni
   cambierà. Vorrei poter fare questo cambio in automatico. »

   UN GIORNALE È UN PACCHETTO di tre cose, non un solo réglage:
     1. `preset` → la forma della citazione / della bibliografia: è il
        PUB_FORMAT_PRESETS che il pannello già usa (acs, springer, nature…).
     2. `layout` → IL CARATTERE di ogni parte del documento (font, taille,
        giustificazione, grassetto, corsivo): le sette parti di PUB_LAYOUT_PARTS
        — titolo · autori · affiliazioni · intitoli · testo · figure · bibliografia.
     3. `order`  → L'ORDINE DELLE SEZIONI, come parole chiave degli intitoli
        (« Introduction », « Materials and Methods », « Results and Discussion »,
        « Conclusion », « References »…): `reorderDocHtml` le riporta nell'ordine
        del giornale sul documento esportato / stampato — e, con il suo terzo
        argomento, scrive sull'intitolo riconosciuto IL TITOLO CHE L'UTENTE VUOLE
        LEGGERE (« Materials and Methods » → « Experimental section »).

   Onestà: questi bundle riproducono lo STILE tipico di ciascuna rivista, non sono
   la sua guida per gli autori — che cambia nel tempo e va riletta prima di
   inviare. Tutto resta modificabile a mano dopo il cambio.
   ========================================================================= */
import { PUB_FORMAT_PRESETS, PUB_FONTS, PUB_LAYOUT_PART_IDS } from './pubCitation.js';

// Le famiglie di caratteri del pannello (senza « As in the app »: un giornale un
// carattere ce l'ha).
const FONT = {};
PUB_FONTS.forEach((f) => { if (f.label) FONT[f.label] = f.id; });
const SERIF = FONT['Times New Roman'] || 'serif';
const GARAMOND = FONT.Garamond || SERIF;
const SANS = FONT.Helvetica || 'sans-serif';

/* Un réglage di parte: solo le chiavi scelte vengono scritte, così una parte che
   il giornale non nomina resta « As in the app » (nessuna regola). */
const st = (font, size, align, extra) => ({
  font, size, align: align || '',
  bold: null, italic: null, underline: null, color: '',
  ...(extra || {}),
});
// `width` esiste solo per la parte figure (vedi PUB_LAYOUT_PARTS).
const fig = (font, size, align, width, extra) => ({ ...st(font, size, align, extra), width });
/* Le sette parti di un giornale da sette numeri: t titolo · a autori · af
   affiliazioni · h intitoli · b testo · f didascalie e bibliografia · w larghezza
   delle figure (percentuale della colonna). */
const LAY = (font, n) => ({
  title: st(font, n.t, 'left', { bold: true }),
  authors: st(font, n.a, 'left'),
  affiliations: st(font, n.af, 'left', { italic: true }),
  heading: st(font, n.h, 'left', { bold: true }),
  body: st(font, n.b, 'justify'),
  figure: fig(font, n.f, 'left', n.w),
  bibliography: st(font, n.f, 'left'),
});

export const JOURNAL_FORMATS = {
  jacs: {
    label: 'JACS (ACS)', preset: 'acs', bibLabel: 'References',
    order: ['abstract', 'introduction', 'materials and methods', 'results and discussion', 'conclusion', 'references'],
    layout: LAY(SERIF, { t: 16, a: 11, af: 9, h: 12, b: 10, f: 9, w: 45 }),
    notes: 'ACS numbered references. The experimental details stay inside Materials and Methods, before the Results.',
  },
  orglett: {
    label: 'Organic Letters (ACS)', preset: 'acs', bibLabel: 'References',
    order: ['abstract', 'introduction', 'results and discussion', 'materials and methods', 'conclusion', 'references'],
    layout: LAY(SERIF, { t: 15, a: 11, af: 9, h: 11, b: 10, f: 9, w: 45 }),
    notes: 'Short communication: Results and Discussion right after the introduction, the experimental details at the end.',
  },
  angewandte: {
    label: 'Angewandte Chemie (Wiley)', preset: 'springer', bibLabel: 'References',
    order: ['abstract', 'introduction', 'results and discussion', 'conclusion', 'experimental section', 'materials and methods', 'references'],
    layout: LAY(GARAMOND, { t: 16, a: 11, af: 9, h: 12, b: 10, f: 9, w: 50 }),
    notes: 'The Experimental Section goes AFTER the Conclusion — the Angewandte convention.',
  },
  chemEurJ: {
    label: 'Chemistry – A European Journal (Wiley)', preset: 'springer', bibLabel: 'References',
    order: ['abstract', 'introduction', 'results and discussion', 'conclusion', 'experimental section', 'materials and methods', 'references'],
    layout: LAY(GARAMOND, { t: 15, a: 11, af: 9, h: 12, b: 10, f: 9, w: 50 }),
    notes: 'Full paper: Results and Discussion, then Conclusion, then the Experimental Section.',
  },
  chemSci: {
    label: 'Chemical Science (RSC)', preset: 'acs', bibLabel: 'References',
    order: ['abstract', 'introduction', 'results and discussion', 'conclusion', 'experimental', 'materials and methods', 'references'],
    layout: LAY(GARAMOND, { t: 15, a: 11, af: 9, h: 11, b: 10, f: 9, w: 50 }),
    notes: 'RSC: Results and Discussion before the Conclusion, then the Experimental part.',
  },
  nature: {
    label: 'Nature', preset: 'nature', bibLabel: 'References',
    order: ['abstract', 'introduction', 'results', 'discussion', 'methods', 'materials and methods', 'references'],
    layout: LAY(SANS, { t: 18, a: 11, af: 9, h: 12, b: 10, f: 9, w: 100 }),
    notes: 'The Methods go at the END, after the discussion (Nature prints them there, in smaller type).',
  },
  science: {
    label: 'Science', preset: 'science', bibLabel: 'References',
    order: ['abstract', 'introduction', 'results', 'discussion', 'materials and methods', 'references'],
    layout: LAY(SERIF, { t: 17, a: 11, af: 9, h: 12, b: 10, f: 9, w: 100 }),
    notes: 'Numbered references, Materials and Methods before the bibliography.',
  },
  cell: {
    label: 'Cell', preset: 'cell', bibLabel: 'References',
    order: ['abstract', 'introduction', 'results', 'discussion', 'materials and methods', 'conclusion', 'references'],
    layout: LAY(SANS, { t: 16, a: 11, af: 9, h: 12, b: 10, f: 9, w: 100 }),
    notes: 'Author–year style, the experimental procedures after the discussion.',
  },
  pnas: {
    label: 'PNAS', preset: 'pnas', bibLabel: 'References',
    order: ['abstract', 'introduction', 'results', 'discussion', 'materials and methods', 'conclusion', 'references'],
    layout: LAY(SERIF, { t: 15, a: 11, af: 9, h: 11, b: 10, f: 9, w: 100 }),
    notes: 'Numbered references, Results and Discussion may be printed as one section.',
  },
};

export const JOURNAL_IDS = Object.keys(JOURNAL_FORMATS);
export const journalLabelOf = (id) => (JOURNAL_FORMATS[id] || {}).label || '';
export const journalOf = (fmt) => (fmt && fmt.journal && JOURNAL_FORMATS[fmt.journal] ? fmt.journal : '');
export const journalSectionOrder = (fmt) => {
  const id = journalOf(fmt);
  return id ? JOURNAL_FORMATS[id].order.slice() : [];
};

/** I réglages di un giornale pronti a essere fusi in un formato. Una parte che il
 *  giornale non descrive — o che una versione futura non conosce più — non viene
 *  scritta: resta quello che l'utente aveva. */
export const journalLayoutPatches = (id) => {
  const def = JOURNAL_FORMATS[id];
  if (!def) return {};
  const out = {};
  Object.keys(def.layout || {}).forEach((part) => {
    if (!PUB_LAYOUT_PART_IDS.includes(part)) return;
    out[part] = { ...def.layout[part] };
  });
  return out;
};

/** APPLICARE UN GIORNALE A UN FORMATO — la funzione che chiama il pannello.
 *  Il formato dell'utente è COPIATO, mai inventato: sopra vengono scritte solo le
 *  tre cose che il giornale porta — la forma della citazione (`preset`), il
 *  carattere delle parti (`layout`) e l'ordine delle sezioni (`order`) — più il
 *  suo id (`journal`). Il testo delle citazioni, gli stili dei nomi dei membri del
 *  laboratorio e la forma dei renvoi nel testo restano quelli dell'utente. Un id
 *  sconosciuto restituisce il formato INTATTO. L'ORDINE E GLI INTITOLI DEI BLOCCHI
 *  DEL DOCUMENTO (`docOrder` · `docTitles`, vedere PUB_DOC_BLOCKS) NON appartengono
 *  al giornale: sono decisioni dell'utente sul SUO documento — passano intatti da
 *  qui, e « ↺ As in the app » li tocca tanto poco quanto il resto del formato. */
export const applyJournalFormat = (fmt, id) => {
  const def = JOURNAL_FORMATS[id];
  const base = fmt && typeof fmt === 'object' ? fmt : {};
  if (!def) return base;
  const layout = { ...(base.layout || {}) };
  const patch = journalLayoutPatches(id);
  Object.keys(patch).forEach((part) => { layout[part] = { ...(layout[part] || {}), ...patch[part] }; });
  return {
    ...base,
    journal: id,
    preset: PUB_FORMAT_PRESETS[def.preset] ? def.preset : (base.preset || 'nature'),
    layout,
    order: def.order.slice(),
    bibLabel: def.bibLabel || base.bibLabel || 'References',
  };
};

/** « ↺ As in the app »: il giornale si stacca e i suoi réglages se ne vanno con
 *  lui — il carattere delle parti torna vuoto (`emptyLayout`), quindi il documento
 *  si stampa come prima del cambio. Le citazioni restano quelle scelte a mano:
 *  sono un'altra decisione. */
export const clearJournalFormat = (fmt, emptyLayout) => {
  const base = fmt && typeof fmt === 'object' ? fmt : {};
  const out = { ...base };
  delete out.journal;
  delete out.order;
  delete out.bibLabel;
  if (emptyLayout && typeof emptyLayout === 'object') out.layout = { ...emptyLayout };
  return out;
};

/* ---- GLI INTITOLI CHE L'UTENTE SCEGLIE (vedi reorderDocHtml) ---------------- */
// Il testo di un intitolo, scritto TALE E QUALE nel HTML: mai una balise (« < », « > »
// vengono levati all'entrata, vedi normalizePubDocTitles).
const escapeHeading = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** L'intitolo di un blocco sostituito con quello scelto: gli attributi del `<h2>`
 *  restano (`class="pf-heading"`, e con essa la messa in forma del documento), e il
 *  resto del blocco non si tocca — solo il testo fra `<h2>` e `</h2>`. */
const renameHeading = (blockHtml, text) => {
  const tag = /^<h2\b[^>]*>[\s\S]*?<\/h2>/i.exec(String(blockHtml));
  if (!tag) return blockHtml;
  const open = /^<h2\b[^>]*>/i.exec(tag[0])[0];
  return `${open}${escapeHeading(text)}</h2>${String(blockHtml).slice(tag[0].length)}`;
};
/** La mappa dei titoli scelti, pronta per la ricerca: chiave = IL MOTORE DELL'ORDINE
 *  (« materials and methods », vedi JOURNAL_FORMATS[id].order), valore = il titolo da
 *  leggere nel documento. Un titolo vuoto non c'è: il documento tiene il suo. */
const renameMapOf = (titles) => {
  const out = {};
  if (!titles || typeof titles !== 'object') return out;
  Object.keys(titles).forEach((k) => {
    const key = String(k || '').toLowerCase().trim();
    const v = titles[k];
    if (key && typeof v === 'string' && v.replace(/[<>]/g, '').trim()) {
      out[key] = v.replace(/[<>]/g, '').trim();
    }
  });
  return out;
};

/** La CLASSE con cui un blocco di testa si fa riconoscere (« pf-authors » …) e che
 *  resta tale e quale nello spostamento: è la classe che pubLayoutCss mette in forma
 *  (vedi PUB_LAYOUT_PARTS). Un attributo assente — o scritto a mano con apici
 *  diversi — dà una stringa vuota: il blocco non è riconoscibile, come prima. */
const classOf = (attrs) => {
  const m = /\bclass\s*=\s*("([^"]*)"|'([^']*)')/i.exec(String(attrs || ''));
  return m ? String(m[2] || m[3] || '') : '';
};

/** L'ORDINE DELLE SEZIONI SU UN DOCUMENTO GIÀ SCRITTO.
 *
 *  Il documento vive in `#project-doc-container` e si esporta copiandone l'HTML:
 *  questa funzione prende quell'HTML e riporta i blocchi riconosciuti nell'ordine
 *  del giornale (o in quello scelto al panneau, vedere pubDocOrderKeywords). Le
 *  regole, per non rovinare mai il testo dell'autore:
 *    • si spostano INTERI blocchi (un inizio di blocco e tutto ciò che segue fino
 *      al prossimo), quindi nessun paragrafo viene tagliato;
 *    • un blocco che il giornale non nomina NON si muove e fa da ancora: i blocchi
 *      riconosciuti si riordinano FRA LE LORO posizioni;
 *    • due sezioni dello stesso rango (o due « References ») tengono l'ordine in
 *      cui l'autore le ha scritte.
 *  DUE SPECIE DI BLOCCHI si riconoscono: un `<h2>` per il suo INTITOLATO (una
 *  sezione, come sempre) e un elemento per la sua CLASSE quando questa è nel
 *  vocabolario (« pf-title », « pf-authors », « pf-affiliations », « pf-meta »,
 *  vedere DOC_CLASS_KEYWORDS in pubCitation.js): senza la classe, il titolo, gli
 *  autori, le affiliazioni e la linea d'informazione — quattro delle otto righe del
 *  pannello — non si spostavano MAI in un documento già registrato (« changing the
 *  order of sections … does not affect the structure of the final document »), né
 *  in quello stampato, che è copiato da lui. Un documento che non porta quelle
 *  classi (scritto a mano, o registrato prima che il programma le scrivesse) non ha
 *  che dei `<h2>`: per lui tutto è come prima, al carattere preciso.
 *  Senza ordine, con meno di due inizi di blocco, o senza alcun blocco riconosciuto,
 *  l'HTML esce identico a com'è entrato.
 *    • un blocco che il giornale non nomina NON si muove e fa da ancora: i blocchi
 *      riconosciuti si riordinano FRA LE LORO posizioni;
 *    • due sezioni dello stesso rango (o due « References ») tengono l'ordine in
 *      cui l'autore le ha scritte.
 *  Senza ordine, con meno di due intitoli, o senza alcun intitolo riconosciuto,
 *  l'HTML esce identico a com'è entrato.
 *
 *  `titles` (facoltativo) = L'INTITOLO CHE L'UTENTE VUOLE LEGGERE: una mappa dal
 *  motore dell'ordine (« materials and methods ») al titolo scelto (« Experimental
 *  section »). La richiesta: « In the publication format I cannot change … the
 *  titles of the subsections … change the name of “materials and methods” into
 *  “experimental section” ». Il titolo si scrive sull'intitolo del blocco
 *  riconosciuto — gli attributi del `<h2>` (la classe `pf-heading`, e con essa la
 *  messa in forma del « Publication format ») restano quelli — e il blocco parte
 *  con il suo nuovo titolo. Un titolo senza ordine rientra lo stesso: rinominare
 *  non è riordinare, e un documento già scritto deve poter seguire il titolo
 *  scelto anche quando nessun giornale è stato scelto. */
export const reorderDocHtml = (html, order, titles) => {
  const src = String(html == null ? '' : html);
  const keys = (Array.isArray(order) ? order : [])
    .map((k) => String(k || '').toLowerCase().trim())
    .filter(Boolean);
  const renames = renameMapOf(titles);
  const renameWords = Object.keys(renames);
  if (!keys.length && !renameWords.length) return src;
  /* La fermeture d'un `<h2>` — la casse n'y change rien, comme avant — cherchée
     DANS la source : aucun indice ne vient d'une copie du document. */
  const CLOSE_H2 = /<\/h2>/gi;
  const closeOf = (at) => {
    CLOSE_H2.lastIndex = at;
    const hit = CLOSE_H2.exec(src);
    return hit ? hit.index : -1;
  };
  /* IL VOCABOLARIO DELLA RICERCA: l'ordine del giornale quando c'è, e in mancanza i
     moti dell'intitolo scelto — così « Materials and Methods » → « Experimental
     section » si applica a un documento già scritto anche quando NESSUN giornale è
     stato scelto. */
  const vocab = keys.length ? keys : renameWords;
  /* GLI INIZI DI BLOCCO. Un `<h2>` come sempre (un intitolo) E OGNI ELEMENTO CHE
     PORTA UNA CLASSE del vocabolario: il titolo, gli autori, le affiliazioni e la
     linea d'informazione si spostano di lì (vedi DOC_CLASS_KEYWORDS,
     pubCitation.js) — non sono degli `<h2>` e non hanno un intitolo da leggere. */
  const classWords = vocab.filter((k) => k.startsWith('pf-'));
  const marks = [...src.matchAll(/<(h1|h2|h3|h4|h5|h6|p)\b([^>]*)>/gi)]
    .map((m) => {
      const tag = m[1].toLowerCase();
      const cls = classOf(m[2]).toLowerCase();
      return { at: m.index, tag, cls, tokens: cls.split(/\s+/).filter(Boolean) };
    })
    .filter((m) => (m.tag === 'h2'
      // Un `<h2>` senza chiusura non era un intitolo prima: non lo è adesso.
      ? closeOf(m.at) >= 0
      : m.tokens.some((w) => classWords.includes(w))));
  if (!marks.length) return src;
  // RIORDINARE vuole un ORDINE ma vuole anche DUE intitoli; RINOMINARE no: un titolo
  // scelto senza giornale si scrive lo stesso (rinominare non è riordinare).
  const canReorder = keys.length > 0 && marks.length >= 2;
  if (!canReorder && !renameWords.length) return src;
  const textOf = (s) => String(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  /* IL TESTO DI UN INTITOLO: quel che sta fra `<h2>` e `</h2>`. Un blocco di testa
     non ne ha — si riconosce con la sua classe, e la sua classe non può farlo
     passare per una sezione qualunque (i due vocabolari non si mescolano). */
  const headingOf = (m) => {
    if (m.tag !== 'h2') return '';
    const end = closeOf(m.at);
    return end < 0 ? '' : textOf(src.slice(m.at, end));
  };
  const rankOf = (m) => {
    const heading = headingOf(m);
    for (let i = 0; i < vocab.length; i += 1) {
      const w = vocab[i];
      if (w.startsWith('pf-')) { if (m.tokens.includes(w)) return i; }
      else if (heading.includes(w)) return i;
    }
    return -1;
  };
  const blocks = marks.map((m, i) => {
    const at = m.at;
    const end = i + 1 < marks.length ? marks[i + 1].at : src.length;
    const rank = rankOf(m);
    const blockHtml = src.slice(at, end);
    // L'INTITOLO SCELTO PRIMA DI OGNI SPOSTAMENTO: il blocco parte con lui.
    const wanted = rank >= 0 ? renames[vocab[rank]] : '';
    return { at, end, i, rank, html: wanted ? renameHeading(blockHtml, wanted) : blockHtml };
  });
  const known = blocks.filter((b) => b.rank >= 0);
  if (!known.length) return src;                     // nulla di riconosciuto: intatto
  // Niente da spostare (un solo intitolo, o nessun ordine): l'HTML esce con i titoli
  // scelti e nient'altro di cambiato.
  if (!canReorder) return src.slice(0, blocks[0].at) + blocks.map((b) => b.html).join('');
  const sorted = known.slice().sort((a, b) => (a.rank - b.rank) || (a.i - b.i));
  let next = 0;
  const slots = blocks.map((b) => (b.rank >= 0 ? sorted[next++] : b));
  return src.slice(0, blocks[0].at) + slots.map((b) => b.html).join('');
};
