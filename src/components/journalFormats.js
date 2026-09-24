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
        del giornale sul documento esportato / stampato.

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
 *  sconosciuto restituisce il formato INTATTO. */
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

/** L'ORDINE DELLE SEZIONI SU UN DOCUMENTO GIÀ SCRITTO.
 *
 *  Il documento vive in `#project-doc-container` e si esporta copiandone l'HTML:
 *  questa funzione prende quell'HTML e riporta gli intitoli `<h2>` riconosciuti
 *  nell'ordine del giornale. Le regole, per non rovinare mai il testo dell'autore:
 *    • si spostano INTERI blocchi (un `<h2>` e tutto ciò che segue fino al
 *      prossimo `<h2>`), quindi nessun paragrafo viene tagliato;
 *    • un blocco che il giornale non nomina NON si muove e fa da ancora: i blocchi
 *      riconosciuti si riordinano FRA LE LORO posizioni;
 *    • due sezioni dello stesso rango (o due « References ») tengono l'ordine in
 *      cui l'autore le ha scritte.
 *  Senza ordine, con meno di due intitoli, o senza alcun intitolo riconosciuto,
 *  l'HTML esce identico a com'è entrato. */
export const reorderDocHtml = (html, order) => {
  const src = String(html == null ? '' : html);
  const keys = (Array.isArray(order) ? order : [])
    .map((k) => String(k || '').toLowerCase().trim())
    .filter(Boolean);
  if (!keys.length) return src;
  const marks = [...src.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
  if (marks.length < 2) return src;
  const textOf = (s) => String(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const blocks = marks.map((m, i) => {
    const at = m.index;
    const end = i + 1 < marks.length ? marks[i + 1].index : src.length;
    return { at, end, i, rank: keys.findIndex((k) => textOf(m[1]).includes(k)), html: src.slice(at, end) };
  });
  const known = blocks.filter((b) => b.rank >= 0);
  if (!known.length) return src;                     // nulla di riconosciuto: intatto
  const sorted = known.slice().sort((a, b) => (a.rank - b.rank) || (a.i - b.i));
  let next = 0;
  const slots = blocks.map((b) => (b.rank >= 0 ? sorted[next++] : b));
  return src.slice(0, blocks[0].at) + slots.map((b) => b.html).join('');
};
