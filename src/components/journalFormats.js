// src/components/journalFormats.js
/* =========================================================================
   JOURNAL FORMATS — « cambiare giornale di submission velocemente ».

   La demande : « se invio il paper a JACS e viene rifiutato, posso decidere di
   inviarlo a angewandte: l'ordine delle sezioni, il formato della bibliografia,
   il carattere (font e police, stampatello, corsivo etc) delle varie sezioni
   cambierà. Vorrei poter fare questo cambio in automatico. »

   UN GIORNALE È UN PACCHETTO di quattro cose, non un solo réglage:
     1. `preset` → la forma della citazione / della bibliografia: è il
        PUB_FORMAT_PRESETS che il pannello già usa (acs, springer, nature…).
     2. `layout` → IL CARATTERE di ogni parte del documento (font, taille,
        giustificazione, grassetto, corsivo): le sette parti di PUB_LAYOUT_PARTS
        — titolo · autori · affiliazioni · intitoli · testo · figure · bibliografia.
     3. `order`  → L'ORDINE DELLE SEZIONI, come parole chiave degli intitoli
        (« Introduction », « Materials and Methods », « Results and Discussion »,
        « Conclusion », « Funding », « Supporting information », « References »…).
        L'ordine viene SCRITTO nel formato (`docOrder`, `docTitles`: vedere
        pubDocOrderForWords / pubDocTitlesForWords, pubCitation.js), quindi il
        pannello lo MOSTRA (si può ritoccare a mano dopo il cambio) e il documento
        — schermo, stampa, PDF, .docx — lo segue; `reorderDocHtml` lo applica anche
        a un documento già registrato.
     4. `bibLabel` → il titolo della bibliografia (« References », « Bibliography »). Una
        stringa VUOTA è una risposta, non un'assenza: quel giornale NON scrive nessun
        intitolo sopra la sua lista (Science), e il pannello ne deduce `docNoTitle` —
        « if in the style of science references have no title then the title tick must be
        unchecked in the “References (citation & bibliography)” section ».

   La richiesta: « when I select the journal preset, all the elements of the
   publication format must adapt to it, including the order of the sections. »

   Onestà: questi bundle riproducono lo STILE tipico di ciascuna rivista, non sono
   la sua guida per gli autori — che cambia nel tempo e va riletta prima di
   inviare. Tutto resta modificabile a mano dopo il cambio.
   ========================================================================= */
import { PUB_FORMAT_PRESETS, PUB_FONTS, PUB_LAYOUT_PART_IDS, buildPubDocOrder, buildPubDocTitles, buildPubDocNoTitle, normalizePubDocNoTitle, pubDocOrderForWords, pubDocTitlesForWords } from './pubCitation.js';

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

/* LES JOURNAL_FORMATS — le `order` de chacun est l'ordre des sections qu'il demande,
   dans SON vocabulaire. Chaque liste se termine par « funding » et
   « supporting information » (les deux sections de fin d'article, avant la
   bibliographie) : ce sont des sections du document au même titre que les autres
   (voir PUB_DOC_BLOCKS), donc un journal les nomme aussi — sans quoi elles resteraient
   plantées au milieu des autres blocs pendant que les blocs nommés se réordonnent. */
export const JOURNAL_FORMATS = {
  jacs: {
    label: 'JACS (ACS)', preset: 'acs', bibLabel: 'References',
    order: ['abstract', 'introduction', 'materials and methods', 'results and discussion', 'conclusion', 'funding', 'supporting information', 'references'],
    layout: LAY(SERIF, { t: 16, a: 11, af: 9, h: 12, b: 10, f: 9, w: 45 }),
    notes: 'ACS numbered references. The experimental details stay inside Materials and Methods, before the Results.',
  },
  orglett: {
    label: 'Organic Letters (ACS)', preset: 'acs', bibLabel: 'References',
    order: ['abstract', 'introduction', 'results and discussion', 'materials and methods', 'conclusion', 'funding', 'supporting information', 'references'],
    layout: LAY(SERIF, { t: 15, a: 11, af: 9, h: 11, b: 10, f: 9, w: 45 }),
    notes: 'Short communication: Results and Discussion right after the introduction, the experimental details at the end.',
  },
  angewandte: {
    label: 'Angewandte Chemie (Wiley)', preset: 'springer', bibLabel: 'References',
    order: ['abstract', 'introduction', 'results and discussion', 'conclusion', 'experimental section', 'materials and methods', 'funding', 'supporting information', 'references'],
    layout: LAY(GARAMOND, { t: 16, a: 11, af: 9, h: 12, b: 10, f: 9, w: 50 }),
    notes: 'The Experimental Section goes AFTER the Conclusion — the Angewandte convention.',
  },
  chemEurJ: {
    label: 'Chemistry – A European Journal (Wiley)', preset: 'springer', bibLabel: 'References',
    order: ['abstract', 'introduction', 'results and discussion', 'conclusion', 'experimental section', 'materials and methods', 'funding', 'supporting information', 'references'],
    layout: LAY(GARAMOND, { t: 15, a: 11, af: 9, h: 12, b: 10, f: 9, w: 50 }),
    notes: 'Full paper: Results and Discussion, then Conclusion, then the Experimental Section.',
  },
  chemSci: {
    label: 'Chemical Science (RSC)', preset: 'acs', bibLabel: 'References',
    order: ['abstract', 'introduction', 'results and discussion', 'conclusion', 'experimental', 'materials and methods', 'funding', 'supporting information', 'references'],
    layout: LAY(GARAMOND, { t: 15, a: 11, af: 9, h: 11, b: 10, f: 9, w: 50 }),
    notes: 'RSC: Results and Discussion before the Conclusion, then the Experimental part.',
  },
  nature: {
    label: 'Nature', preset: 'nature', bibLabel: 'References',
    order: ['abstract', 'introduction', 'results', 'discussion', 'methods', 'materials and methods', 'funding', 'supporting information', 'references'],
    layout: LAY(SANS, { t: 18, a: 11, af: 9, h: 12, b: 10, f: 9, w: 100 }),
    notes: 'The Methods go at the END, after the discussion (Nature prints them there, in smaller type).',
  },
  science: {
    /* `bibLabel: ''` — SCIENCE NON SCRIVE NESSUN INTITOLO SOPRA LA SUA BIBLIOGRAFIA: la
       lista segue il testo. Il pannello ne deduce `docNoTitle: ['references']` (vedi
       applyJournalFormat), quindi la casella « stampare l'intitolo » della rubrica
       « References (citation & bibliography) » è DECOCCATA, e il documento scrive la
       bibliografia senza il suo `<h2>`. */
    label: 'Science', preset: 'science', bibLabel: '',
    order: ['abstract', 'introduction', 'results', 'discussion', 'materials and methods', 'funding', 'supporting information', 'references'],
    layout: LAY(SERIF, { t: 17, a: 11, af: 9, h: 12, b: 10, f: 9, w: 100 }),
    notes: 'Numbered references, Materials and Methods before the bibliography — and no heading of its own over the reference list.',
  },
  cell: {
    label: 'Cell', preset: 'cell', bibLabel: 'References',
    order: ['abstract', 'introduction', 'results', 'discussion', 'materials and methods', 'conclusion', 'funding', 'supporting information', 'references'],
    layout: LAY(SANS, { t: 16, a: 11, af: 9, h: 12, b: 10, f: 9, w: 100 }),
    notes: 'Author–year style, the experimental procedures after the discussion.',
  },
  pnas: {
    label: 'PNAS', preset: 'pnas', bibLabel: 'References',
    order: ['abstract', 'introduction', 'results', 'discussion', 'materials and methods', 'conclusion', 'funding', 'supporting information', 'references'],
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
 *  cose che il giornale porta — la forma della citazione (`preset`), il carattere
 *  delle parti (`layout`), l'ordine delle sezioni (`order`), il titolo della
 *  bibliografia (`bibLabel`) — più il suo id (`journal`) e L'ORDINE E GLI INTITOLI
 *  DEI BLOCCHI DEL DOCUMENTO CHE NE DISCENDONO (`docOrder` · `docTitles`, vedere
 *  PUB_DOC_BLOCKS). Il testo delle citazioni, gli stili dei nomi dei membri del
 *  laboratorio e la forma dei renvoi nel testo restano quelli dell'utente. Un id
 *  sconosciuto restituisce il formato INTATTO.
 *
 *  ⚠ PERCHÉ IL GIORNALE SCRIVE ANCHE `docOrder`: la richiesta — « when I select the
 *  journal preset, all the elements of the publication format must adapt to it,
 *  including the order of the sections ». L'ordine delle sezioni non è più solo un
 *  vocabolario per l'esportazione: diventa quello del documento, quindi il PANNELLO lo
 *  mostra (si ritocca a mano dopo, e « ↺ As in the app » lo riporta a quello del
 *  programma). Le due regole che lo rendono sicuro sono in pubDocOrderForWords: solo i
 *  blocchi che il giornale NOMINA si spostano, e solo fra le posizioni che l'utente ha
 *  dato loro. */
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
    /* L'INTITOLO DELLA SUA BIBLIOGRAFIA: una stringa VUOTA è una risposta — quel
       giornale non ne scrive nessuno (Science) — e scende in `docNoTitle` (sotto). Un
       giornale che non ne parla lascia quello dell'utente. */
    bibLabel: typeof def.bibLabel === 'string' ? def.bibLabel : (base.bibLabel || 'References'),
    /* L'ORDRE DES SECTIONS DU JOURNAL DEVIENT CELUI DU DOCUMENT (la demande) : les
       blocs qu'il nomme prennent SA séquence, dans les places que l'ordre courant leur
       donne ; la tête du document et les blocs qu'il ne nomme pas ne bougent pas. */
    docOrder: pubDocOrderForWords(def.order, base.docOrder),
    /* …ET LES INTITULÉS QU'IL NOMME AUTREMENT : Angewandte écrit « experimental section »
       là où le programme écrit « Materials and Methods ». Un intitulé que l'utilisateur a
       choisi lui-même est respecté (voir pubDocTitlesForWords). */
    docTitles: pubDocTitlesForWords(def.order, base.docTitles),
    /* …ET GLI INTITOLI CHE NON SCRIVE AFFATTO: un giornale la cui bibliografia non porta
       intitolo lascia il blocco « References » SENZA `<h2>` (la casella della rubrica
       « References (citation & bibliography) » è decoccata, il documento non scrive il
       titolo). Gli altri riprendono in mano quel réglage: un giornale che nomina le sue
       sezioni le nomina tutte. */
    docNoTitle: normalizePubDocNoTitle(def.bibLabel === '' ? ['references'] : []),
    /* Un style enregistré (« My styles ») ne décrit plus ce format : on vient d'en
       choisir un autre. */
    style: '',
  };
};

/** « ↺ As in the app »: il giornale si stacca e i suoi réglages se ne vanno con
 *  lui — il carattere delle parti torna vuoto (`emptyLayout`), l'ordine e gli intitoli
 *  dei blocchi del documento tornano quelli del PROGRAMMA (il giornale li aveva
 *  scritti, vedi applyJournalFormat), quindi il documento si stampa come prima del
 *  cambio. Le citazioni restano quelle scelte a mano: sono un'altra decisione. */
export const clearJournalFormat = (fmt, emptyLayout) => {
  const base = fmt && typeof fmt === 'object' ? fmt : {};
  const out = { ...base };
  delete out.journal;
  delete out.order;
  delete out.bibLabel;
  if (emptyLayout && typeof emptyLayout === 'object') out.layout = { ...emptyLayout };
  out.docOrder = buildPubDocOrder();
  out.docTitles = buildPubDocTitles();
  /* « As in the app » rende anche gli intitoli: il giornale che non ne scriveva uno
     se ne va con lui, il documento torna a scriverli tutti. */
  out.docNoTitle = buildPubDocNoTitle();
  out.style = '';
  return out;
};

/* ---- GLI INTITOLI CHE L'UTENTE SCEGLIE (vedi reorderDocHtml) ---------------- */
// Il testo di un intitolo, scritto TALE E QUALE nel HTML: mai una balise (« < », « > »
// vengono levati all'entrata, vedi normalizePubDocTitles).
const escapeHeading = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** L'intitolo di un blocco sostituito con quello scelto: gli attributi del `<h2>`
 *  restano (`class="pf-heading"`, e con essa la messa in forma del documento), e il
 *  resto del blocco non si tocca — solo il testo fra `<h2>` e `</h2>`. Un titolo VUOTO
 *  è la scelta « questo blocco non porta intitolo » (vedi renameMapOf): il `<h2>` se ne
 *  va, il blocco resta — testo, figure e lista compresi. */
const renameHeading = (blockHtml, text) => {
  const tag = /^<h2\b[^>]*>[\s\S]*?<\/h2>/i.exec(String(blockHtml));
  if (!tag) return blockHtml;
  if (!String(text || '').trim()) return String(blockHtml).slice(tag[0].length);
  const open = /^<h2\b[^>]*>/i.exec(tag[0])[0];
  return `${open}${escapeHeading(text)}</h2>${String(blockHtml).slice(tag[0].length)}`;
};
/** La mappa dei titoli scelti, pronta per la ricerca: chiave = IL MOTORE DELL'ORDINE
 *  (« materials and methods », vedi JOURNAL_FORMATS[id].order), valore = il titolo da
 *  leggere nel documento. Un titolo VUOTO è un ordine anche lui — « nessun intitolo »
 *  (vedi pubDocTitleKeywords, che lo manda per un blocco senza titolo): la chiave c'è,
 *  e renameHeading toglie il `<h2>`. Un valore che non è una stringa, invece, non dice
 *  niente: il documento tiene il suo titolo. */
const renameMapOf = (titles) => {
  const out = {};
  if (!titles || typeof titles !== 'object') return out;
  Object.keys(titles).forEach((k) => {
    const key = String(k || '').toLowerCase().trim();
    const v = titles[k];
    if (key && typeof v === 'string') out[key] = v.replace(/[<>]/g, '').trim();
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
    /* L'INTITOLO SCELTO PRIMA DI OGNI SPOSTAMENTO: il blocco parte con lui. Un titolo
       VUOTO è una scelta anche lui (« nessun intitolo », vedi renameMapOf): il `<h2>`
       se ne va, il blocco resta al suo posto — è così che una bibliografia senza
       intitolo si legge. */
    const wantsTitle = rank >= 0 && Object.prototype.hasOwnProperty.call(renames, vocab[rank]);
    return { at, end, i, rank, html: wantsTitle ? renameHeading(blockHtml, renames[vocab[rank]]) : blockHtml };
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

/* ── LA LIGNE VIDE ENTRE LE TITRE, LES AUTEURS ET LES AFFILIATIONS ─────────────

   La demande, mot pour mot : « In the final document the list of authors must be
   separated by the title with one empty line. an empty line must also separate
   the authors from the affiliations. » — puis, cette fois, la précision : « In the
   formatted paper there must be an empty line after the affiliations. »

   Le document écrit donc la tête comme une revue la présente : le titre, une LIGNE
   VIDE, les auteurs, une LIGNE VIDE, les affiliations, une LIGNE VIDE, la ligne
   d'information du projet (elle ferme la tête : c'est elle qui suit les affiliations,
   donc c'est entre les deux que la troisième ligne vide se pose). La ligne vide
   est un PARAGRAPHE À PART (`pf-empty-line`), pas une marge : elle se voit à
   l'écran, sur la feuille imprimée, dans le PDF ET dans le .docx (Word y lit un
   vrai paragraphe vide, voir htmlToDocxBody), et elle ne se perd pas quand la mise
   en forme du panneau change la taille des textes.

   TROIS ENDROITS, UNE SEULE RÈGLE : la page du projet (les rangées, voir
   `docHeadRows`), le document FIGÉ et ce qui part à l'impression / au .docx (le
   HTML, voir `docHeadSpacedHtml`). */

/** Les blocs de TÊTE du panneau (voir PUB_DOC_BLOCKS, pubCitation.js) : le titre,
 *  les auteurs, les affiliations ET la ligne d'information — ceux qui se lisent sur
 *  des lignes séparées. La ligne d'information en fait partie depuis la demande
 *  « in the formatted paper there must be an empty line after the affiliations » :
 *  elle SUIT les affiliations, donc c'est entre les deux que la ligne vide se pose
 *  (voir docHeadRows / docHeadSpacedHtml). */
export const DOC_HEAD_IDS = ['title', 'authors', 'affiliations', 'meta'];
/** …et les classes avec lesquelles le document les écrit (les mêmes que met en
 *  forme le « Publication format », voir PUB_LAYOUT_PARTS). */
export const DOC_HEAD_CLASSES = ['pf-title', 'pf-authors', 'pf-affiliations', 'pf-meta'];

/** La rangée « LIGNE VIDE » (voir docHeadRows) : `empty-line` est l'identifiant que
 *  la page du projet rend, `pf-empty-line` la classe que le document écrit — et
 *  `DOC_EMPTY_LINE_HTML` le balisage exact que `docHeadSpacedHtml` insère. */
export const DOC_EMPTY_LINE_ID = 'empty-line';
export const DOC_EMPTY_LINE_CLASS = 'pf-empty-line';
export const DOC_EMPTY_LINE_HTML = `<div class="${DOC_EMPTY_LINE_CLASS}" aria-hidden="true">&nbsp;</div>`;

/**
 * LES RANGÉES DU DOCUMENT : les blocs que le projet a vraiment, dans l'ordre choisi
 * au panneau (`docOrder`), avec UNE LIGNE VIDE (`DOC_EMPTY_LINE_ID`) entre deux blocs
 * de tête qui se suivent.
 *
 *  L'ordre reste celui de l'utilisateur : la ligne vide ne sépare jamais que deux
 *  blocs de tête VOISINS — un autre bloc entre eux (la ligne d'information du projet,
 *  une section, les références) sépare déjà —, et elle se place toujours ENTRE les
 *  deux. « Mettre l'auteur avant le titre » (l'exemple de la demande d'origine) se
 *  lit donc avec la même ligne vide, sans réglage à refaire.
 *
 * @param {string[]} order                     l'ordre des blocs (`docOrder`)
 * @param {(id: string) => boolean} [present]  ce que le projet a (voir `blocks`,
 *                                             page du projet) — un bloc absent ne
 *                                             compte pas
 * @returns {string[]} les rangées : des identifiants de bloc et `empty-line`
 */
export const docHeadRows = (order, present) => {
  const has = typeof present === 'function' ? present : () => true;
  const ids = (Array.isArray(order) ? order : []).filter((id) => has(id));
  const rows = [];
  ids.forEach((id, i) => {
    rows.push(id);
    const next = ids[i + 1];
    if (DOC_HEAD_IDS.includes(id) && DOC_HEAD_IDS.includes(next)) rows.push(DOC_EMPTY_LINE_ID);
  });
  return rows;
};

/* Le balisage d'une ligne vide DÉJÀ ÉCRITE (la page, un document enregistré) : la
   classe peut y être accompagnée d'autres classes, entre apostrophes ou guillemets,
   et l'élément peut être celui qu'on veut (`div` pour celui que le programme écrit). */
const EMPTY_LINE_RE = /<(\w+)\b[^>]*\bclass\s*=\s*(?:"[^"]*\bpf-empty-line\b[^"]*"|'[^']*\bpf-empty-line\b[^']*')[^>]*>[\s\S]*?<\/\1>/gi;

/** La fin d'un élément ouvert en `openEnd` (« </p> », « </h1> »…), ou `null`. */
const closeTagOf = (src, openEnd, tag) => {
  const re = new RegExp(`</${tag}\\s*>`, 'gi');
  re.lastIndex = openEnd;
  return re.exec(src);
};

/**
 * LA MÊME RÈGLE, ÉCRITE SUR LE HTML DU DOCUMENT (voir `docHeadRows`) : une ligne
 * vide entre deux blocs de tête qui se suivent.
 *
 *  C'est la fonction que la page du projet, le document FIGÉ (`project.exportDocHtml`,
 *  écrit avant que le programme connaisse cette règle), l'impression, le PDF et
 *  l'export .docx traversent tous (`projectDocBodyHtml`) : un seul endroit à corriger,
 *  et le papier ne peut pas diverger de l'écran.
 *
 *  Les lignes vides DÉJÀ écrites sont retirées puis réécrites à la bonne place :
 *  `reorderDocHtml` déplace des blocs entiers et une ligne vide voyage avec celui qui
 *  la précède — une tête réordonnée à la main (« put the author before the title »)
 *  garde donc ses lignes vides entre les bons blocs, sans doublon ni ligne orpheline.
 *  Deux blocs de tête qui ne se SUIVENT pas (quelque chose entre eux) n'en reçoivent
 *  aucune : il y a déjà de la place.
 *
 *  Un document sans les classes de la tête (écrit à la main, ou enregistré avant que
 *  le programme les écrive) sort IDENTIQUE, au caractère près.
 */
export const docHeadSpacedHtml = (html) => {
  const src = String(html == null ? '' : html);
  if (!DOC_HEAD_CLASSES.some((c) => src.includes(c))) return src;
  const bare = src.replace(EMPTY_LINE_RE, '');
  /* LES DÉBUTS DES BLOCS DE TÊTE, dans l'ordre où le document les écrit (même
     vocabulaire que reorderDocHtml : c'est la classe qui les fait reconnaître). */
  const marks = [];
  const RE = /<(h[1-6]|p|div)\b([^>]*)>/gi;
  let m = RE.exec(bare);
  while (m) {
    const tokens = classOf(m[2]).toLowerCase().split(/\s+/).filter(Boolean);
    if (DOC_HEAD_CLASSES.some((c) => tokens.includes(c))) {
      marks.push({ at: m.index, openEnd: m.index + m[0].length, tag: m[1].toLowerCase() });
    }
    m = RE.exec(bare);
  }
  if (marks.length < 2) return bare;
  let out = '';
  let cut = 0;
  for (let i = 0; i + 1 < marks.length; i += 1) {
    const a = marks[i];
    const b = marks[i + 1];
    const close = closeTagOf(bare, a.openEnd, a.tag);
    if (!close) continue;                                 // un bloc mal fermé : on n'y touche pas
    /* Rien entre les deux (un commentaire, un blanc, un saut de ligne) : la ligne
       vide se pose là. Autre chose (la ligne d'information, une section) : rien. */
    const between = bare.slice(close.index + close[0].length, b.at).replace(/<!--[\s\S]*?-->/g, '');
    if (between.trim()) continue;
    out += bare.slice(cut, b.at) + DOC_EMPTY_LINE_HTML;
    cut = b.at;
  }
  return out + bare.slice(cut);
};
