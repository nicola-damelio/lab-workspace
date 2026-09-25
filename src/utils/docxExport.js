/* =========================================================================
   src/utils/docxExport.js
   LE DOCUMENT FINAL EN .docx (Word).

   La demande, mot pour mot : « add a export to docx button to the final
   document ». Le document du projet s'imprime déjà (« 🖨️ Print / Save as
   PDF », voir printProjectDoc dans projectDetailModule.jsx) : il en manquait
   la version WORD — celle que le co-auteur, l'éditeur ou le reviewer ouvre et
   corrige.

   Ce module ÉCRIT un vrai .docx (OOXML / WordprocessingML, c'est-à-dire un
   simple ZIP) avec la boîte à outils que l'IMPORT de .docx utilise déjà
   (fflate, voir docxImport.js) : aucune dépendance nouvelle, et le fichier
   s'ouvre dans Word, LibreOffice et Google Docs — ce n'est ni du HTML
   renommé, ni un « .doc » que Word refuse.

   CE QUI PART DANS LE FICHIER : exactement le HTML du document final (le même
   que l'impression : sections réparées, citations liées, ordre et intitulés du
   « Publication format ») — titres, paragraphes, gras / italique / souligné /
   barré, exposants et indices, liens, listes, tableaux, figures (leurs PIXELS
   entrent dans `word/media/`), légendes, et les marques d'une suggestion
   (`.doc-ins` en vert, `.doc-del` en rouge barré), comme la feuille imprimée.
   Les citations « [12] » RESTENT cliquables : chaque `id` du document devient
   un signet Word et chaque lien interne un renvoi (voir bookmarkName).

   CE QUI NE PART PAS : ce que la feuille imprimée cache (`no-print` : boutons
   et aides de l'application), les scripts et les styles, et les images dont
   les pixels ne se laissent pas lire — une figure illisible laisse sa LÉGENDE
   dans le texte au lieu de faire échouer l'export, et `warnings` le dit.

   RIEN N'EST FAIT EN DOUCE : le module ne parle jamais au réseau de lui-même
   (`loadDocImages` reçoit son `fetchImpl`) et tout ce qui écrit du XML est
   PUR, donc mesuré hors navigateur (voir _docx_export_test.mjs).
   ========================================================================= */

import { zipSync, strToU8 } from 'fflate';
import { dataUrlToBytes, splitDataUrl, dataUrlMime } from './dataUrlBytes';

export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/* ── les espaces de noms du format (tels quels : Word les lit par leur URI) ── */
const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const NS_CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REL_OFFICE_DOC =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const REL_CORE_PROPS =
  'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties';
const REL_APP_PROPS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties';
const REL_IMAGE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const REL_HYPERLINK =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
const REL_STYLES =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

/* La largeur utile d'une page A4 (21 cm) moins 2 × 2 cm de marge ≈ 15,24 cm ;
   1 pixel CSS = 9525 EMU (1 pouce = 914400 EMU = 96 px). Une image n'est JAMAIS
   plus large que la colonne de texte, comme la feuille imprimée
   (`img { max-width: 100% }`). */
const CONTENT_WIDTH_EMU = 5486400;
const EMU_PER_PX = 9525;
/** Sans taille connue (hors navigateur), une figure garde ce rapport. */
const DEFAULT_ASPECT = 3 / 4;
/** Le corps de la feuille imprimée : Georgia serif, 11 pt. */
const BODY_FONT = 'Georgia';

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

/* ── ce qu'on ne lit jamais, et ce qui EST un paragraphe ──────────────────── */
const SKIP_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'iframe', 'svg', 'canvas',
  'video', 'audio', 'input', 'select', 'textarea', 'option', 'head', 'meta',
  'link', 'title'
]);
const VOID_TAGS = new Set([
  'br', 'img', 'hr', 'input', 'meta', 'link', 'col', 'base', 'wbr', 'source',
  'area', 'embed', 'param', 'track'
]);
/** Les éléments dont les enfants SONT des paragraphes (une `<div>` qui ne
 *  contient que du texte est un paragraphe, voir blocksOf). */
const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'main', 'header', 'footer', 'aside',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead',
  'tbody', 'tr', 'figure', 'figcaption', 'blockquote', 'pre', 'hr', 'dl',
  'dt', 'dd', 'form', 'fieldset'
]);
const HEADING_LEVELS = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };
/** L'alignement suit la classe du document : c'est ainsi que la feuille
 *  imprimée centre un titre, et le .docx doit se lire pareil. */
const ALIGNMENTS = [
  ['text-center', 'center'], ['text-right', 'right'],
  ['text-left', 'left'], ['text-justify', 'both']
];

/* =========================================================================
   1. Le texte
   ========================================================================= */

/** Un caractère interdit par XML 1.0 (Word refuse le fichier entier pour un
 *  seul `\u0000`) est retiré ; la tabulation, le saut de ligne et tout ce qui
 *  est imprimable — emoji compris, dont les paires d'octets sont gardées —
 *  restent. Une boucle plutôt qu'une expression : la plage est LISIBLE ici, et
 *  c'est la règle exacte du format (XML 1.0, Char). */
const stripIllegalXml = (s) => {
  const text = String(s == null ? '' : s);
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 9 || code === 10 || code === 13 || (code >= 0x20 && code !== 0xFFFE && code !== 0xFFFF)) {
      out += text[i];
    }
  }
  return out;
};

/** Le texte tel qu'il doit s'écrire dans le XML (« < » et « & » nus cassent le
 *  fichier, pas seulement l'affichage). */
export const escapeXml = (s) => stripIllegalXml(s == null ? '' : s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

/* Les entités que le document contient VRAIMENT (innerHTML les écrit ainsi) :
 * les cinq de base, l'espace insécable, les tirets et les points de suspension.
 * Les entités NUMÉRIQUES sont décodées aussi (« &#8217; ») : un import peut en
 * laisser. Mêmes règles que referenceImport.js, étendues aux nombres. */
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0',
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', times: '\u00D7',
  deg: '\u00B0', micro: '\u00B5', plusmn: '\u00B1', laquo: '\u00AB',
  raquo: '\u00BB', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201C',
  rdquo: '\u201D', shy: '\u00AD'
};

/** « &amp; » → « & » (un seul passage : `&amp;lt;` reste `&lt;`, comme le
 *  navigateur l'a lu). Une entité inconnue reste telle quelle. */
export const decodeEntities = (s) => String(s == null ? '' : s).replace(
  /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g,
  (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10FFFF) return whole;
      try { return String.fromCodePoint(code); } catch { return whole; }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? whole : named;
  }
);

/** `<nom>.docx` : les caractères qu'aucun système de fichiers n'accepte sont
 *  retirés, les espaces restent (un nom lisible), et le nom ne peut pas être
 *  vide. Un nom est un NOM DE FICHIER, pas du texte : les caractères interdits
 *  par XML le sont aussi ici, et une barre oblique ne doit pas créer un dossier. */
export const docxFileName = (title, fallback = 'project') => {
  const cleaned = stripIllegalXml(title)
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim();
  return `${cleaned || fallback}.docx`;
};

/** Le nom d'un signet Word : il commence par une lettre, ne contient que des
 *  lettres, des chiffres et « _ », et tient en 40 caractères — l'ancre
 *  « ref-12 » d'une référence du document devient « b_ref12 ». */
export const bookmarkName = (id) => {
  const cleaned = String(id == null ? '' : id).replace(/[^A-Za-z0-9_]/g, '');
  if (!cleaned) return '';
  return `b_${cleaned}`.slice(0, 40);
};

/* =========================================================================
   2. Le HTML du document → un arbre (sans DOM)
   ========================================================================= */

/* Le document part d'`innerHTML` (le navigateur l'a écrit : balises fermées,
 * attributs cités), mais rien ne garantit qu'il reste bien formé après un
 * import ou une correction manuelle. Le lecteur ci-dessous est donc TOLÉRANT :
 * une balise de fermeture qui ne correspond à aucune balise ouverte est
 * ignorée, une balise restée ouverte est fermée à la fin. Le texte et les
 * attributs passent par decodeEntities : « &amp; » arrive ici en « & ». */

const TAG_RE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/?[a-zA-Z][^>]*>|[^<]+/g;
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** Les attributs d'une balise, en minuscules, valeurs décodées. */
const attrMap = (raw) => {
  const out = {};
  ATTR_RE.lastIndex = 0;
  let m = ATTR_RE.exec(raw);
  while (m) {
    const value = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : ''));
    out[m[1].toLowerCase()] = decodeEntities(value);
    m = ATTR_RE.exec(raw);
  }
  return out;
};

const newNode = (tag, attrs) => ({ tag, attrs: attrs || {}, children: [] });

/**
 * Le document HTML → un arbre `{ tag, attrs, children }`, `#root` à la racine.
 * Aucun DOM, aucun navigateur : c'est ce qui rend le tout mesurable hors
 * navigateur (voir _docx_export_test.mjs).
 */
export const parseHtmlTree = (html) => {
  const root = newNode('#root');
  const stack = [root];
  const src = String(html == null ? '' : html);
  TAG_RE.lastIndex = 0;
  let m = TAG_RE.exec(src);
  while (m) {
    const token = m[0];
    m = TAG_RE.exec(src);
    if (token[0] !== '<') {
      if (token) stack[stack.length - 1].children.push({ text: decodeEntities(token) });
      continue;
    }
    if (token.startsWith('<!')) continue;                 // commentaire, doctype
    const name = (/^<\/?\s*([a-zA-Z][-a-zA-Z0-9]*)/.exec(token) || [])[1];
    if (!name) continue;
    const tag = name.toLowerCase();
    if (token[1] === '/') {
      /* On ferme jusqu'à la balise correspondante SI elle est ouverte ; sinon
         la fermeture ne veut rien dire pour nous et elle est ignorée (le
         document reste lisible au lieu d'être abandonné). */
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      continue;
    }
    const attrs = attrMap(token.replace(/^<\s*[a-zA-Z][-a-zA-Z0-9]*/, '').replace(/\/?>$/, ''));
    const el = newNode(tag, attrs);
    stack[stack.length - 1].children.push(el);
    if (!VOID_TAGS.has(tag) && !/\/>$/.test(token)) stack.push(el);
  }
  return root;
};

/** Les classes d'un élément (`class="a b"` ou `className`). */
export const classList = (attrs) =>
  String((attrs && (attrs.class || attrs.classname)) || '').split(/\s+/).filter(Boolean);

/** Un élément que la feuille imprimée CACHE (`.no-print` : boutons et aides de
 *  l'application) — il ne part pas dans le Word non plus. */
const isSkipped = (el) => SKIP_TAGS.has(el.tag) || classList(el.attrs).includes('no-print');

/** L'alignement demandé par la classe (`text-center`) ou le style. */
export const alignOf = (attrs) => {
  const classes = classList(attrs);
  const byClass = ALIGNMENTS.find(([token]) => classes.includes(token));
  if (byClass) return byClass[1];
  const style = String((attrs && attrs.style) || '');
  const m = /text-align\s*:\s*(left|right|center|justify)/i.exec(style);
  if (!m) return '';
  return m[1].toLowerCase() === 'justify' ? 'both' : m[1].toLowerCase();
};

/* =========================================================================
   3. Les « runs » : un morceau de texte avec SA mise en forme
   ========================================================================= */

/* Le document est du HTML de navigateur : `<b>`, `<i>`, `<u>`, `<sup>`, `<a>`,
   `<span class="doc-ins">`… Chacun devient un morceau de texte (un « run »
   Word), et deux morceaux voisins de MÊME mise en forme n'en font qu'un (le
   fichier reste lisible et Word garde les corrections groupées). */

const TAG_STYLE = {
  b: { bold: true }, strong: { bold: true },
  i: { italic: true }, em: { italic: true },
  u: { underline: true }, ins: { underline: true },
  s: { strike: true }, strike: { strike: true }, del: { strike: true },
  sup: { sup: true }, sub: { sub: true },
  code: { mono: true }, kbd: { mono: true }, samp: { mono: true },
  tt: { mono: true }, pre: { mono: true },
  mark: { highlight: 'yellow' },
  small: { small: true }
};

/** La suggestion d'un relecteur : la feuille imprimée écrit `.doc-ins` en vert
 *  et `.doc-del` en rouge barré (voir printPostDoc) — le Word les écrit pareil,
 *  pour qu'une suggestion se lise sans le navigateur. */
const suggestionStyle = (el) => {
  const classes = classList(el.attrs);
  if (classes.includes('doc-ins')) return { color: '166534' };
  if (classes.includes('doc-del')) return { color: '991B1B', strike: true };
  return null;
};

const mergeable = (a, b) => {
  if (a.br || b.br || a.image || b.image) return false;
  const keys = ['bold', 'italic', 'underline', 'strike', 'sup', 'sub', 'mono', 'small', 'color', 'highlight', 'href', 'anchor'];
  return keys.every((k) => (a[k] || '') === (b[k] || ''));
};

/** Ajoute un morceau à la liste, en fusionnant avec le précédent si sa mise en
 *  forme est identique. Un texte vide ne compte pas. */
const pushRun = (out, run) => {
  if (run.text !== undefined && run.text === '') return;
  const prev = out[out.length - 1];
  if (prev && prev.text !== undefined && run.text !== undefined && mergeable(prev, run)) {
    prev.text += run.text;
    return;
  }
  out.push(run);
};

/** Un espace insécable reste, les autres blancs se réduisent à une espace (le
 *  HTML n'en a qu'un sens) — sauf dans un `<pre>`, où tout est gardé. */
const normalizeText = (text, keep) => {
  const s = String(text == null ? '' : text);
  if (keep) return s;
  return s.replace(/[\t\r\n ]+/g, ' ');
};

/**
 * Les morceaux de texte d'un nœud, dans l'ordre du document.
 * @param {object} node le nœud (arbre de parseHtmlTree)
 * @param {object} style la mise en forme héritée
 * @param {Array} out la liste à remplir
 * @param {object} [opts] `keepWhitespace` pour un `<pre>`
 */
export const runsOf = (node, style = {}, out = [], opts = {}) => {
  if (!node) return out;
  if (node.text !== undefined) {
    pushRun(out, { ...style, text: normalizeText(node.text, opts.keepWhitespace) });
    return out;
  }
  if (isSkipped(node)) return out;
  if (node.tag === 'br') { pushRun(out, { br: true }); return out; }
  if (node.tag === 'img') {
    const src = String(node.attrs.src || '').trim();
    if (src) pushRun(out, { image: src, alt: String(node.attrs.alt || '') });
    return out;
  }
  let next = style;
  const byTag = TAG_STYLE[node.tag];
  if (byTag) next = { ...next, ...byTag };
  const suggestion = suggestionStyle(node);
  if (suggestion) next = { ...next, ...suggestion };
  if (node.tag === 'a') {
    const href = String(node.attrs.href || '').trim();
    if (href) {
      next = href.startsWith('#')
        ? { ...next, anchor: bookmarkName(href.slice(1)) }
        : { ...next, href };
    }
    /* Une citation « [12] » du document (`.cite-ref`, voir referenceLinks.js) est
       bleue et grasse dans la feuille imprimée : elle reste bleue et grasse dans
       le Word, sinon le lecteur ne voit plus que c'est un renvoi. */
    if (classList(node.attrs).includes('cite-ref')) next = { ...next, color: '2563EB', bold: true };
  }
  if (node.tag === 'span' || node.tag === 'font') {
    const color = /color\s*:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})/.exec(String(node.attrs.style || ''));
    if (color) next = { ...next, color: color[1].replace('#', '').toUpperCase() };
  }
  (node.children || []).forEach((child) => runsOf(child, next, out, opts));
  return out;
};

/* =========================================================================
   4. Le document → les BLOCS (titre, paragraphe, liste, tableau, figure)
   ========================================================================= */

/* Un bloc = ce que Word appelle un paragraphe (ou un tableau, ou une figure).
   La feuille imprimée cache `.no-print` : ces éléments ne deviennent JAMAIS un
   bloc. Un conteneur dont les enfants sont des blocs descend dedans (une
   `<div class="grid">` pleine de `<figure>` ne devient pas un paragraphe) ;
   un conteneur qui ne porte que du texte EST un paragraphe. */

const appendRuns = (dest, runs) => runs.forEach((r) => pushRun(dest, r));

/** L'ancre d'un élément (`id="ref-12"`) → le signet Word correspondant. */
const anchorOf = (el) => bookmarkName(String((el.attrs && el.attrs.id) || '').trim());

const hasBlockChildren = (el) =>
  (el.children || []).some((c) => !c.text && c.tag && BLOCK_TAGS.has(c.tag));

/** Les `<figure>` d'une figure (ou d'un conteneur) : ses images et sa légende.
 *  Un `<a>` qui emballe une image, un `<div>` de grille, un `<span>` : on
 *  descend, l'image est trouvée. */
const collectFigure = (el, images, caption) => {
  (el.children || []).forEach((child) => {
    if (child.text !== undefined) {
      if (child.text.trim()) appendRuns(caption, runsOf(child, {}, []));
      return;
    }
    if (isSkipped(child)) return;
    if (child.tag === 'img') {
      const src = String(child.attrs.src || '').trim();
      if (src) images.push({ src, alt: String(child.attrs.alt || '') });
      return;
    }
    if (child.tag === 'figcaption') { appendRuns(caption, runsOf(child, {}, [])); return; }
    if (child.tag === 'hr' || child.tag === 'br') return;
    collectFigure(child, images, caption);
  });
};

/** Une figure : ses images ET sa légende. La légende ne part pas dans une image
 *  (Word ne la lirait pas) : elle est le paragraphe qui suit, en petit et en
 *  italique — comme la feuille imprimée. */
const figureBlock = (el, anchor) => {
  const images = [];
  const caption = [];
  collectFigure(el, images, caption);
  return { type: 'figure', images, caption, anchor };
};

/** Les lignes d'un tableau : `<tr>` directs, ou rangés dans thead/tbody/tfoot.
 *  Un tableau IMBRIQUÉ dans une cellule n'est pas confondu avec celui-ci (on ne
 *  descend que d'un niveau). */
const rowsOf = (table) => {
  const rows = [];
  (table.children || []).forEach((child) => {
    if (!child.tag) return;
    if (child.tag === 'tr') { rows.push(child); return; }
    if (child.tag === 'thead' || child.tag === 'tbody' || child.tag === 'tfoot') {
      (child.children || []).forEach((r) => { if (r.tag === 'tr') rows.push(r); });
    }
  });
  return rows;
};

/** Les morceaux d'une CELLULE : ses paragraphes se suivent, séparés par un saut
 *  de ligne (un tableau de valeurs doit se lire ligne à ligne). */
const cellRuns = (cell) => {
  const blocks = (cell.children || []).filter((c) => !c.text && c.tag && BLOCK_TAGS.has(c.tag));
  if (!blocks.length) return runsOf(cell, {}, []);
  const runs = [];
  blocks.forEach((b, i) => {
    if (i) pushRun(runs, { br: true });
    appendRuns(runs, runsOf(b, {}, []));
  });
  return runs;
};

const tableBlock = (el, anchor) => ({
  type: 'table',
  anchor,
  rows: rowsOf(el).map((tr) => ({
    cells: (tr.children || [])
      .filter((c) => c.tag === 'td' || c.tag === 'th')
      .map((cell) => ({
        header: cell.tag === 'th',
        align: alignOf(cell.attrs),
        colspan: Math.max(1, Math.min(20, parseInt(cell.attrs.colspan, 10) || 1)),
        runs: cellRuns(cell)
      }))
  })).filter((row) => row.cells.length > 0)
});

/** Une liste (`<ul>` / `<ol>`) : chaque `<li>` est un paragraphe à puce ou
 *  numéroté, et une liste IMBRIQUÉE dans un `<li>` est une puce de plus, en
 *  retrait. Le repère (« • », « 3. ») est ÉCRIT dans le texte : la puce est
 *  ainsi la même dans Word, dans LibreOffice et dans Google Docs, sans dépendre
 *  des définitions de numérotation du document. */
const listOf = (el, out, depth) => {
  const ordered = el.tag === 'ol';
  let n = parseInt(el.attrs.start, 10) || 1;
  (el.children || []).forEach((li) => {
    if (!li.tag || li.tag !== 'li') return;
    const runs = [];
    const nested = [];
    (li.children || []).forEach((child) => {
      if (!child.text && (child.tag === 'ul' || child.tag === 'ol')) { nested.push(child); return; }
      appendRuns(runs, runsOf(child, {}, []));
    });
    if (runs.length) {
      out.push({
        type: 'list',
        ordered,
        depth,
        marker: ordered ? `${n}.` : '\u2022',
        runs,
        anchor: anchorOf(li)
      });
    }
    n += 1;
    nested.forEach((sub) => listOf(sub, out, depth + 1));
  });
  return out;
};

/** L'encre d'un bloc de texte : ses morceaux, alignés comme le document. */
const textBlock = (el, extra = {}) => ({
  type: 'para',
  runs: runsOf(el, {}, [], { keepWhitespace: el.tag === 'pre' }),
  align: alignOf(el.attrs),
  anchor: anchorOf(el),
  ...extra
});

const blockOf = (el, out) => {
  if (el.text !== undefined) {
    /* Un texte seul sur sa ligne (les blancs entre deux balises du document)
       n'est pas un paragraphe : sans cette règle, Word s'ouvrirait sur des
       lignes vides venues de l'indentation du HTML. */
    const runs = runsOf(el, {}, []);
    if (runs.some((r) => (r.text || '').trim())) out.push({ type: 'para', runs });
    return;
  }
  if (isSkipped(el)) return;
  const tag = el.tag;
  if (HEADING_LEVELS[tag]) {
    out.push({
      type: 'heading',
      level: HEADING_LEVELS[tag],
      runs: runsOf(el, {}, []),
      align: alignOf(el.attrs),
      anchor: anchorOf(el)
    });
    return;
  }
  if (tag === 'hr') { out.push({ type: 'hr' }); return; }
  if (tag === 'table') {
    const block = tableBlock(el, anchorOf(el));
    if (block.rows.length) out.push(block);
    return;
  }
  if (tag === 'figure') { out.push(figureBlock(el, anchorOf(el))); return; }
  if (tag === 'img') {
    const src = String(el.attrs.src || '').trim();
    if (src) out.push({ type: 'figure', images: [{ src, alt: String(el.attrs.alt || '') }], caption: [], anchor: anchorOf(el) });
    return;
  }
  if (tag === 'figcaption') { out.push({ type: 'caption', runs: runsOf(el, {}, []), anchor: anchorOf(el) }); return; }
  if (tag === 'ul' || tag === 'ol') { listOf(el, out, 0); return; }
  if (tag === 'blockquote') {
    if (hasBlockChildren(el)) {
      const before = out.length;
      blocksOf(el.children, out, { indent: 720 });
      if (out[before]) out[before].indent = (out[before].indent || 0) + 720;
      return;
    }
    out.push(textBlock(el, { indent: 720 }));
    return;
  }
  if (hasBlockChildren(el)) {
    /* Un conteneur (div, section, li isolé) : on descend, et l'ancre du
       conteneur s'accroche au premier bloc qu'il a produit. */
    const before = out.length;
    blocksOf(el.children, out);
    const anchor = anchorOf(el);
    if (anchor && out[before] && !out[before].anchor) out[before].anchor = anchor;
    return;
  }
  out.push(textBlock(el));
};

const blocksOf = (children, out, extra = {}) => {
  (children || []).forEach((child) => {
    const before = out.length;
    blockOf(child, out);
    if (extra.indent) {
      /* `<blockquote><p>…</p></blockquote>` : le retrait se pose sur TOUT ce
         que le conteneur a produit. */
      for (let i = before; i < out.length; i += 1) {
        out[i].indent = (out[i].indent || 0) + extra.indent;
      }
    }
  });
  return out;
};

/** LE DOCUMENT → ses blocs. C'est le point d'entrée du module : le HTML du
 *  document final (celui que l'impression copie) entre ici, et un tableau de
 *  blocs en sort (titres, paragraphes, listes, tableaux, figures). */
export const parseDocHtml = (html) => {
  const blocks = blocksOf(parseHtmlTree(html).children, []);
  /* Un paragraphe vide (une ligne blanche) n'est pas du texte : il est retiré
     pour que le Word ne s'ouvre pas sur une page de blancs. Les figures, elles,
     restent (une légende seule est encore une figure). */
  return blocks.filter((b) => b.type !== 'para' || (b.runs && b.runs.length > 0));
};

/** Les sources d'images du document, dans l'ordre et SANS doublon : ce que
 *  `loadDocImages` va chercher, et ce que la note de fin dénombre. */
export const collectImageSources = (blocks) => {
  const out = [];
  (blocks || []).forEach((b) => {
    const add = (src) => { if (src && !out.includes(src)) out.push(src); };
    if (b.type === 'figure') (b.images || []).forEach((im) => add(im.src));
    if (b.runs) b.runs.forEach((r) => { if (r.image) add(r.image); });
    if (b.rows) b.rows.forEach((row) => row.cells.forEach((c) => (c.runs || []).forEach((r) => { if (r.image) add(r.image); })));
  });
  return out;
};

/* =========================================================================
   5. Les blocs → WordprocessingML (le corps de word/document.xml)
   ========================================================================= */

/* `ctx` est le carnet du document : les relations (styles, images, liens), les
   images écrites, et les compteurs de Word (rId, id de signet, id de dessin).
   Il est créé À CHAQUE appel — donc l'écriture est pure : deux fois le même
   document donnent deux fois le même fichier.
   LA PREMIÈRE RELATION EST TOUJOURS `styles.xml` : c'est par elle que le
   document trouve ses styles (Word l'écrit ainsi, et sans elle une partie du
   fichier n'est reliée à rien). */
const createCtx = (images) => ({
  images: images || {},
  rels: [{ id: 'rId1', type: REL_STYLES, target: 'styles.xml', external: false }],
  relSeq: 1,
  docId: 0,
  bookmarkSeq: 0
});

/** Une relation du document (une image, un lien). La MÊME cible réutilise la
 *  même relation : le fichier reste petit et Word ne bronche pas. */
const addRel = (ctx, type, target, external = false) => {
  const found = ctx.rels.find((r) => r.type === type && r.target === target && r.external === external);
  if (found) return found.id;
  ctx.relSeq += 1;
  const id = `rId${ctx.relSeq}`;
  ctx.rels.push({ id, type, target, external });
  return id;
};

const runPropertiesXml = (run) => {
  const parts = [];
  if (run.mono) parts.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>');
  if (run.bold) parts.push('<w:b/>');
  if (run.italic) parts.push('<w:i/>');
  if (run.strike) parts.push('<w:strike/>');
  if (run.underline) parts.push('<w:u w:val="single"/>');
  if (run.sup) parts.push('<w:vertAlign w:val="superscript"/>');
  else if (run.sub) parts.push('<w:vertAlign w:val="subscript"/>');
  if (run.small) parts.push('<w:sz w:val="18"/><w:szCs w:val="18"/>');
  if (run.color) parts.push(`<w:color w:val="${escapeXml(run.color)}"/>`);
  if (run.highlight) parts.push(`<w:highlight w:val="${escapeXml(run.highlight)}"/>`);
  return parts.length ? `<w:rPr>${parts.join('')}</w:rPr>` : '';
};

/** Un texte → ses `<w:t>`, un saut de ligne → `<w:br/>`, une tabulation →
 *  `<w:tab/>`. `xml:space="preserve"` est OBLIGATOIRE : sans lui Word mange
 *  l'espace de fin d'un morceau et les mots se collent. */
const textXml = (text) => {
  let out = '';
  String(text == null ? '' : text).split(/([\n\t])/).forEach((part) => {
    if (part === '\n') out += '<w:br/>';
    else if (part === '\t') out += '<w:tab/>';
    else if (part) out += `<w:t xml:space="preserve">${escapeXml(part)}</w:t>`;
  });
  return out;
};

/** La taille d'une image DANS le document : sa taille réelle si on la connaît
 *  (le navigateur la mesure, voir loadDocImages), jamais plus large que la
 *  colonne de texte — comme la feuille imprimée (`max-width: 100%`). */
export const imageSizeEmu = (media) => {
  const w = Number(media && media.width) > 0 ? Number(media.width) : 0;
  const h = Number(media && media.height) > 0 ? Number(media.height) : 0;
  let cx = w ? Math.round(w * EMU_PER_PX) : CONTENT_WIDTH_EMU;
  let cy = h ? Math.round(h * EMU_PER_PX) : Math.round(cx * DEFAULT_ASPECT);
  if (cx > CONTENT_WIDTH_EMU) {
    cy = Math.round((cy * CONTENT_WIDTH_EMU) / cx);
    cx = CONTENT_WIDTH_EMU;
  }
  return { cx: Math.max(1, cx), cy: Math.max(1, cy) };
};

/** Le texte de remplacement d'une image qui n'a pas pu être lue : le mot le dit
 *  (aucune figure ne disparaît en silence). */
export const missingImageText = (alt) =>
  (String(alt || '').trim() ? `[${String(alt).trim()} — image not embedded]` : '[image not embedded]');

const drawingXml = (ctx, src, alt) => {
  const media = ctx.images[src];
  const rid = addRel(ctx, REL_IMAGE, media.partName);
  const { cx, cy } = imageSizeEmu(media);
  ctx.docId += 1;
  const id = ctx.docId;
  const name = String(media.partName || 'image').split('/').pop();
  return '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
    + `<wp:extent cx="${cx}" cy="${cy}"/>`
    + `<wp:docPr id="${id}" name="Picture ${id}" descr="${escapeXml(alt || name)}"/>`
    + `<a:graphic><a:graphicData uri="${NS_PIC}"><pic:pic>`
    + `<pic:nvPicPr><pic:cNvPr id="${id}" name="${escapeXml(name)}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + '<pic:spPr><a:xfrm><a:off x="0" y="0"/>'
    + `<a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
    + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';
};

const singleRunXml = (ctx, run) => {
  if (run.br) return '<w:r><w:br/></w:r>';
  if (run.image) {
    if (!ctx.images[run.image]) {
      return `<w:r>${runPropertiesXml({ italic: true, color: '808080' })}${textXml(missingImageText(run.alt))}</w:r>`;
    }
    return `<w:r>${drawingXml(ctx, run.image, run.alt)}</w:r>`;
  }
  return `<w:r>${runPropertiesXml(run)}${textXml(run.text)}</w:r>`;
};

/** Les morceaux d'un paragraphe. Les morceaux d'UN MÊME lien se suivent dans un
 *  seul `<w:hyperlink>` : le « [12] » d'une citation reste UN lien cliquable.
 *  Un lien interne (`#ref-12`) devient un renvoi au signet correspondant — il
 *  n'a pas de relation à lui, Word le résout dans le document même. */
const runsXml = (ctx, runs, opts = {}) => {
  const list = opts.bold
    ? runs.map((r) => (r.text === undefined || r.bold ? r : { ...r, bold: true }))
    : runs;
  let out = '';
  let i = 0;
  while (i < list.length) {
    const run = list[i];
    const key = run.href ? `h:${run.href}` : (run.anchor ? `a:${run.anchor}` : '');
    if (!key) { out += singleRunXml(ctx, run); i += 1; continue; }
    let j = i + 1;
    while (j < list.length) {
      const next = list[j];
      const nextKey = next.href ? `h:${next.href}` : (next.anchor ? `a:${next.anchor}` : '');
      if (nextKey !== key) break;
      j += 1;
    }
    const inner = list.slice(i, j).map((r) => singleRunXml(ctx, {
      ...r,
      href: '',
      anchor: '',
      color: r.color || '1155CC',
      underline: true
    })).join('');
    out += run.href
      ? `<w:hyperlink r:id="${addRel(ctx, REL_HYPERLINK, run.href, true)}">${inner}</w:hyperlink>`
      : `<w:hyperlink w:anchor="${escapeXml(run.anchor)}">${inner}</w:hyperlink>`;
    i = j;
  }
  return out;
};

/** Un paragraphe. Un signet (`anchor`) s'ouvre AVANT ses morceaux et se ferme
 *  après : c'est ainsi que Word écrit un signet, et c'est ce qui rend une
 *  citation « [12] » cliquable dans le .docx. */
const paragraphXml = (ctx, runs, opts = {}) => {
  const pPr = [];
  if (opts.style) pPr.push(`<w:pStyle w:val="${opts.style}"/>`);
  if (opts.indent) pPr.push(`<w:ind w:left="${opts.indent}"/>`);
  if (opts.align) pPr.push(`<w:jc w:val="${opts.align}"/>`);
  if (opts.keepNext) pPr.push('<w:keepNext/>');
  if (opts.border) {
    pPr.push('<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr>');
  }
  let open = '';
  let close = '';
  if (opts.anchor) {
    ctx.bookmarkSeq += 1;
    const id = ctx.bookmarkSeq;
    open = `<w:bookmarkStart w:id="${id}" w:name="${escapeXml(opts.anchor)}"/>`;
    close = `<w:bookmarkEnd w:id="${id}"/>`;
  }
  return `<w:p>${pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : ''}`
    + `${open}${runsXml(ctx, runs || [], opts)}${close}</w:p>`;
};

const tableBordersXml = '<w:tblBorders>'
  + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`)
    .join('')
  + '</w:tblBorders>';

/** Un tableau. La grille tient dans la colonne de texte (9360 twips = A4 moins
 *  2 × 2 cm), et EN Word un tableau doit être suivi d'un paragraphe : l'appelant
 *  en pose un vide après (sinon Word en invente un à sa façon). */
const tableXml = (ctx, block) => {
  const cols = Math.max(1, ...block.rows.map((row) => row.cells.reduce((n, c) => n + c.colspan, 0)));
  const width = Math.floor(9360 / cols);
  const grid = `<w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>`;
  const rows = block.rows.map((row) => {
    const cells = row.cells.map((cell) => {
      const tcPr = '<w:tcPr>'
        + `<w:tcW w:w="${width * cell.colspan}" w:type="dxa"/>`
        + (cell.colspan > 1 ? `<w:gridSpan w:val="${cell.colspan}"/>` : '')
        + (cell.header ? '<w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/>' : '')
        + '</w:tcPr>';
      const runs = cell.runs.length ? cell.runs : [{ text: '' }];
      return `<w:tc>${tcPr}${paragraphXml(ctx, runs, { align: cell.align, bold: cell.header })}</w:tc>`;
    }).join('');
    return `<w:tr>${cells}</w:tr>`;
  }).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/>${tableBordersXml}</w:tblPr>${grid}${rows}</w:tbl>`;
};

/** Une figure : ses images centrées (celles dont les pixels sont là), puis SA
 *  LÉGENDE en petit italique — la même place que dans la feuille imprimée. Une
 *  image illisible laisse son texte (« [image not embedded] ») au lieu de
 *  disparaître : le lecteur du Word voit qu'il manque quelque chose. */
const figureXml = (ctx, block) => {
  const tasks = [];
  (block.images || []).forEach((im) => {
    tasks.push(ctx.images[im.src]
      ? { runs: [{ image: im.src, alt: im.alt }], opts: { align: 'center', keepNext: true } }
      : { runs: [{ text: missingImageText(im.alt), italic: true, color: '808080' }], opts: { align: 'center' } });
  });
  if (block.caption && block.caption.length) {
    tasks.push({ runs: block.caption, opts: { style: 'Caption', align: 'center' } });
  }
  return tasks.map((t, i) => paragraphXml(
    ctx,
    t.runs,
    i === 0 && block.anchor ? { ...t.opts, anchor: block.anchor } : t.opts
  )).join('');
};

/** LES BLOCS → le corps de `word/document.xml`, plus le carnet du document
 *  (relations, images écrites). C'est la fonction que `buildDocx` appelle. */
export const blocksToBodyXml = (blocks, options = {}) => {
  const ctx = createCtx(options.images);
  const parts = [];
  (blocks || []).forEach((block) => {
    switch (block.type) {
      case 'heading':
        parts.push(paragraphXml(ctx, block.runs, {
          style: `Heading${Math.min(6, Math.max(1, block.level || 1))}`,
          align: block.align,
          anchor: block.anchor,
          keepNext: true
        }));
        break;
      case 'caption':
        parts.push(paragraphXml(ctx, block.runs, { style: 'Caption', anchor: block.anchor }));
        break;
      case 'list':
        parts.push(paragraphXml(ctx, [
          { text: `${block.marker} ` },
          ...(block.runs || [])
        ], {
          indent: 360 + (block.depth || 0) * 360,
          align: block.align,
          anchor: block.anchor
        }));
        break;
      case 'hr':
        parts.push(paragraphXml(ctx, [], { border: true }));
        break;
      case 'table':
        parts.push(tableXml(ctx, block));
        parts.push(paragraphXml(ctx, []));       // Word exige un paragraphe après un tableau
        break;
      case 'figure':
        parts.push(figureXml(ctx, block));
        break;
      default:
        parts.push(paragraphXml(ctx, block.runs, {
          align: block.align,
          indent: block.indent,
          anchor: block.anchor
        }));
    }
  });
  /* Le corps finit par la mise en page (A4, marges de 2 cm) : sans `sectPr`,
     Word ouvre le document sur une page de dimensions par défaut. */
  const sectPr = '<w:sectPr>'
    + '<w:pgSz w:w="11906" w:h="16838"/>'
    + '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/>'
    + '</w:sectPr>';
  return { bodyXml: parts.join('') + sectPr, ctx };
};

/* =========================================================================
   6. Le paquet .docx — les parties du ZIP
   ========================================================================= */

/* Un .docx est un ZIP de parties XML. Celles que Word EXIGE :
   `[Content_Types].xml`, `_rels/.rels`, `word/document.xml` ; et
   `word/_rels/document.xml.rels` dès qu'une image ou un lien entre dans le
   document. `word/styles.xml` et les propriétés (titre, auteur) sont là pour
   que le fichier s'ouvre avec la bonne allure partout (Word, LibreOffice,
   Google Docs) au lieu d'un Times New Roman de 12 pt. */

/** Les extensions d'image que Word connaît, avec leur type MIME. Une extension
 *  inconnue garde son type (le navigateur a déjà converti ce qu'il pouvait —
 *  voir loadDocImages —, et un type honnête vaut mieux qu'un type faux). */
const IMAGE_MIME = {
  png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', gif: 'image/gif',
  bmp: 'image/bmp', tiff: 'image/tiff', tif: 'image/tiff', webp: 'image/webp',
  emf: 'image/x-emf', wmf: 'image/x-wmf', svg: 'image/svg+xml'
};

const contentTypesXml = (media) => {
  const exts = Array.from(new Set(Object.values(media).map((m) => m.ext)));
  const defaults = ['<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>']
    .concat(exts.map((ext) => `<Default Extension="${escapeXml(ext)}" ContentType="${IMAGE_MIME[ext] || 'application/octet-stream'}"/>`));
  const overrides = [
    ['/word/document.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'],
    ['/word/styles.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml'],
    ['/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'],
    ['/docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml']
  ].map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`);
  return `<Types xmlns="${NS_CT}">${defaults.join('')}${overrides.join('')}</Types>`;
};

/** `_rels/.rels` : le paquet dit à Word où est le document, et où sont ses
 *  propriétés. */
const packageRelsXml = () => {
  const rels = [
    ['rId1', REL_OFFICE_DOC, 'word/document.xml'],
    ['rId2', REL_CORE_PROPS, 'docProps/core.xml'],
    ['rId3', REL_APP_PROPS, 'docProps/app.xml']
  ].map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`);
  return `<Relationships xmlns="${NS_PKG_REL}">${rels.join('')}</Relationships>`;
};

/** `word/_rels/document.xml.rels` : les images (`word/media/…`, cible RELATIVE
 *  au dossier `word/`) et les liens, qui, eux, sortent du fichier — donc
 *  `TargetMode="External"`. */
const documentRelsXml = (rels) => `<Relationships xmlns="${NS_PKG_REL}">${rels.map((r) => {
  const target = r.type === REL_IMAGE ? r.target.replace(/^word\//, '') : r.target;
  return `<Relationship Id="${r.id}" Type="${r.type}" Target="${escapeXml(target)}"`
    + (r.external ? ' TargetMode="External"' : '') + '/>';
}).join('')}</Relationships>`;

const documentXml = (bodyXml) =>
  `<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:wp="${NS_WP}" xmlns:a="${NS_A}" xmlns:pic="${NS_PIC}">`
  + `<w:body>${bodyXml}</w:body></w:document>`;

/** Les propriétés : le titre du document et qui l'a produit. La date est PASSÉE
 *  (jamais lue de l'horloge) : deux exports du même document donnent le même
 *  fichier, et un test peut le vérifier. */
const coreXml = ({ title = '', creator = '', dateIso = '' } = {}) => {
  const when = /^\d{4}-\d{2}-\d{2}T/.test(String(dateIso)) ? String(dateIso) : '';
  return '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"'
    + ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"'
    + ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + `<dc:title>${escapeXml(title)}</dc:title>`
    + `<dc:creator>${escapeXml(creator)}</dc:creator>`
    + `<cp:lastModifiedBy>${escapeXml(creator)}</cp:lastModifiedBy>`
    + (when ? `<dcterms:created xsi:type="dcterms:W3CDTF">${when}</dcterms:created>`
      + `<dcterms:modified xsi:type="dcterms:W3CDTF">${when}</dcterms:modified>` : '')
    + '</cp:coreProperties>';
};

const appXml = () =>
  '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"'
  + ' xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
  + '<Application>Lab Workspace</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>'
  + '</Properties>';

/** `word/styles.xml` : l'allure du document (Georgia 11 pt, titres, légendes,
 *  liens). Sans lui, Word ouvre le fichier en Times New Roman 12 pt et les
 *  `pStyle` du document ne veulent rien dire — le .docx ne ressemblerait plus à
 *  la feuille imprimée. */
const stylesXml = () => {
  const style = (id, name, extra) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/>`
    + '<w:next w:val="Normal"/><w:qFormat/>'
    + `<w:pPr>${extra.pPr || ''}</w:pPr><w:rPr>${extra.rPr || ''}</w:rPr></w:style>`;
  const heading = (id, name, sz, outline, before) => style(id, name, {
    pPr: `<w:keepNext/><w:spacing w:before="${before}" w:after="120"/>`
      + '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="CBD5E1"/></w:pBdr>'
      + `<w:outlineLvl w:val="${outline}"/>`,
    rPr: `<w:b/><w:color w:val="1E293B"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`
  });
  return '<w:styles xmlns:w="' + NS_W + '">'
    + '<w:docDefaults><w:rPrDefault><w:rPr>'
    + `<w:rFonts w:ascii="${BODY_FONT}" w:hAnsi="${BODY_FONT}" w:cs="${BODY_FONT}"/>`
    + '<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>'
    + '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>'
    + '</w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + style('Title', 'Title', {
      pPr: '<w:spacing w:before="0" w:after="120"/>',
      rPr: `<w:b/><w:color w:val="0F172A"/><w:sz w:val="36"/><w:szCs w:val="36"/>`
    })
    + heading('Heading1', 'heading 1', 32, 0, 320)
    + heading('Heading2', 'heading 2', 26, 1, 280)
    + heading('Heading3', 'heading 3', 24, 2, 240)
    + style('Caption', 'caption', {
      pPr: '<w:spacing w:before="40" w:after="200"/>',
      rPr: '<w:i/><w:color w:val="475569"/><w:sz w:val="18"/><w:szCs w:val="18"/>'
    })
    + '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/>'
    + '<w:rPr><w:color w:val="1155CC"/><w:u w:val="single"/></w:rPr></w:style>'
    + '</w:styles>';
};

/* =========================================================================
   7. buildDocx : les blocs + les pixels → le fichier
   ========================================================================= */

/** Les images qui partent vraiment : une source sans pixels (fetch refusé par
 *  le navigateur, CORS, image absente) n'entre pas dans le paquet ; la figure
 *  garde son texte de remplacement (voir missingImageText). Les parties sont
 *  numérotées dans l'ordre du document : `word/media/image1.png`, etc. */
const normalizeImages = (blocks, images) => {
  const out = {};
  let n = 0;
  collectImageSources(blocks).forEach((src) => {
    const raw = images && images[src];
    if (!raw || !raw.bytes || !raw.bytes.length) return;
    const ext = IMAGE_MIME[String(raw.ext || '').toLowerCase()] ? String(raw.ext).toLowerCase() : 'png';
    n += 1;
    out[src] = {
      partName: `word/media/image${n}.${ext}`,
      ext,
      bytes: raw.bytes instanceof Uint8Array ? raw.bytes : new Uint8Array(raw.bytes),
      width: Number(raw.width) || 0,
      height: Number(raw.height) || 0
    };
  });
  return out;
};

/**
 * LE .docx DU DOCUMENT.
 * @param {object} input
 * @param {Array}  input.blocks  les blocs (voir parseDocHtml)
 * @param {object} [input.images] les pixels, par source d'image (voir loadDocImages)
 * @param {string} [input.title] le titre (nom du fichier ET propriété du document)
 * @param {string} [input.creator] l'auteur du fichier
 * @param {string} [input.dateIso] la date des propriétés (jamais l'horloge)
 * @returns {{ bytes:Uint8Array, fileName:string, embedded:number, missing:string[], parts:string[] }}
 */
export const buildDocx = ({ blocks, images, title = '', creator = '', dateIso = '' } = {}) => {
  const list = blocks || [];
  const media = normalizeImages(list, images);
  const { bodyXml, ctx } = blocksToBodyXml(list, { images: media });
  const parts = {
    '[Content_Types].xml': contentTypesXml(media),
    '_rels/.rels': packageRelsXml(),
    'word/document.xml': documentXml(bodyXml),
    'word/styles.xml': stylesXml(),
    /* Le document est TOUJOURS relié à ses styles (voir createCtx) : le fichier
       de relations existe donc dès qu'il y a un style — c'est-à-dire toujours. */
    'word/_rels/document.xml.rels': documentRelsXml(ctx.rels),
    'docProps/core.xml': coreXml({ title, creator, dateIso }),
    'docProps/app.xml': appXml()
  };
  const zip = {};
  Object.keys(parts).forEach((name) => { zip[name] = strToU8(XML_DECL + parts[name]); });
  Object.keys(media).forEach((src) => { zip[media[src].partName] = media[src].bytes; });
  return {
    bytes: zipSync(zip, { level: 6 }),
    fileName: docxFileName(title),
    embedded: Object.keys(media).length,
    missing: collectImageSources(list).filter((src) => !media[src]),
    parts: Object.keys(zip)
  };
};

/* =========================================================================
   8. Les pixels des figures, puis le téléchargement
   ========================================================================= */

/* Les figures du document sont soit une capture en data:URL (le cas local),
   soit une adresse Drive (`lh3.googleusercontent.com`, voir
   getRenderableDriveUrl) : il faut les DEUX. Le réseau passe par `fetchImpl`
   (jamais un `fetch` implicite) et la mesure/la conversion par `measure` /
   `rasterize` (des fonctions injectables) : hors navigateur, le module ne
   touche donc à rien et un test peut tout simuler. */

export const imageExtFromMime = (mime, fallback = '') => {
  const m = String(mime || '').toLowerCase();
  if (m.includes('svg')) return 'svg';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpeg';
  if (m.includes('png')) return 'png';
  if (m.includes('gif')) return 'gif';
  if (m.includes('bmp')) return 'bmp';
  if (m.includes('webp')) return 'webp';
  if (m.includes('tiff')) return 'tiff';
  if (m.includes('emf')) return 'emf';
  if (m.includes('wmf')) return 'wmf';
  return fallback;
};

/** L'extension lue dans l'ADRESSE (« …/fig1.png?x=1 » → png), quand l'en-tête
 *  du serveur ne dit rien (un Drive qui répond `application/octet-stream`). */
export const imageExtFromUrl = (url) => {
  const m = /\.(png|jpe?g|gif|bmp|webp|tiff?|svg)(?:[?#]|$)/i.exec(String(url || ''));
  if (!m) return '';
  const ext = m[1].toLowerCase();
  if (ext === 'jpg') return 'jpeg';
  return ext === 'tif' ? 'tiff' : ext;
};

/** Les formats que Word ne lit pas tous les jours (ou pas du tout) : le
 *  navigateur les convertit en PNG avant l'écriture (voir browserRasterize). */
const RASTER_EXTS = new Set(['svg', 'webp', 'tiff', 'bmp']);

/** Le dessin dans un `<canvas>` → PNG. C'est ce qui fait entrer une figure
 *  vectorielle (SVG : les courbes recharts) dans un .docx que Word lit, avec un
 *  fond blanc (le fond de la feuille imprimée). */
const browserRasterize = async (bytes, ext) => {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
  const url = (() => {
    try { return URL.createObjectURL(new Blob([bytes], { type: IMAGE_MIME[ext] || 'image/png' })); }
    catch { return ''; }
  })();
  if (!url) return null;
  try {
    const img = await new Promise((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = url;
    });
    if (!img || !img.naturalWidth) return null;
    const width = Math.min(2000, img.naturalWidth);
    const height = Math.max(1, Math.round((img.naturalHeight || 1) * (width / img.naturalWidth)));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise((resolve) => {
      if (typeof canvas.toBlob !== 'function') { resolve(null); return; }
      canvas.toBlob(resolve, 'image/png');
    });
    if (!blob) return null;
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: 'png', width, height };
  } catch {
    return null;
  } finally {
    try { URL.revokeObjectURL(url); } catch { /* rien */ }
  }
};

/** La taille réelle d'une image (pour que le Word la pose comme l'écran : la
 *  feuille imprimée ne la déforme jamais). `null` hors navigateur — le document
 *  prend alors la largeur de la colonne et un rapport de 4/3. */
const browserMeasure = async (bytes, ext) => {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
  const url = (() => {
    try { return URL.createObjectURL(new Blob([bytes], { type: IMAGE_MIME[ext] || 'image/png' })); }
    catch { return ''; }
  })();
  if (!url) return null;
  try {
    const img = await new Promise((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = url;
    });
    if (!img || !img.naturalWidth) return null;
    return { width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    return null;
  } finally {
    try { URL.revokeObjectURL(url); } catch { /* rien */ }
  }
};

/** Les pixels d'une figure distante (Drive, lh3…). Un refus (CORS, 403, réseau
 *  coupé) lève : l'appelant le note et n'oublie pas la figure (sa légende reste). */
const fetchImageBytes = async (src, fetchImpl) => {
  if (typeof fetchImpl !== 'function') throw new Error('no fetch available');
  const res = await fetchImpl(src);
  if (!res || res.ok === false) throw new Error(`image request failed${res && res.status ? ` (${res.status})` : ''}`);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (!bytes.length) throw new Error('empty image');
  const type = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-type') : '';
  return { bytes, ext: imageExtFromMime(type) || imageExtFromUrl(src) || 'png' };
};

/**
 * LES PIXELS DES FIGURES DU DOCUMENT.
 * @param {Array} blocks les blocs (voir parseDocHtml)
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] le fetch à utiliser (par défaut `fetch`,
 *   `null` hors navigateur) — jamais un appel implicite
 * @param {Function} [options.measure]  (bytes, ext) → { width, height } | null
 * @param {Function} [options.rasterize] (bytes, ext) → { bytes, ext, … } | null
 *   (convertit un SVG / WebP / BMP en PNG quand le navigateur sait le faire)
 * @returns {Promise<{ images:object, warnings:Array, sources:string[] }>}
 *   `images` est une table source → { bytes, ext, width, height } ; `warnings`
 *   dit, pour chaque figure laissée de côté, POURQUOI (l'utilisateur doit le
 *   savoir sans ouvrir la console).
 */
export const loadDocImages = async (blocks, options = {}) => {
  const fetchImpl = options.fetchImpl !== undefined
    ? options.fetchImpl
    : (typeof fetch === 'function' ? fetch : null);
  const measure = options.measure !== undefined ? options.measure : browserMeasure;
  const rasterize = options.rasterize !== undefined ? options.rasterize : browserRasterize;
  const sources = collectImageSources(blocks);
  const images = {};
  const warnings = [];
  /* Une par une : le Drive limite les requêtes, et une figure de 4 Mo n'a pas
     besoin d'un jumeau en mémoire. */
  for (const src of sources) {
    try {
      let got = null;
      if (splitDataUrl(src)) {
        got = { bytes: dataUrlToBytes(src), ext: imageExtFromMime(dataUrlMime(src)) || imageExtFromUrl(src) || 'png' };
      } else if (/^https?:/i.test(src)) {
        got = await fetchImageBytes(src, fetchImpl);
      } else {
        warnings.push({ src, reason: 'unsupported image address' });
        continue;
      }
      if (!got || !got.bytes || !got.bytes.length) {
        warnings.push({ src, reason: 'empty image' });
        continue;
      }
      let { bytes, ext } = got;
      let size = null;
      if (RASTER_EXTS.has(ext) && typeof rasterize === 'function') {
        const raster = await rasterize(bytes, ext);
        if (raster && raster.bytes && raster.bytes.length) {
          bytes = raster.bytes instanceof Uint8Array ? raster.bytes : new Uint8Array(raster.bytes);
          ext = raster.ext || 'png';
          size = { width: Number(raster.width) || 0, height: Number(raster.height) || 0 };
        } else if (ext === 'svg') {
          /* Word ne sait pas dessiner un SVG : plutôt qu'une image cassée, la
             figure laisse son texte et la note le dit. */
          warnings.push({ src, reason: 'vector image — the printed PDF and the HTML page keep it' });
          continue;
        }
      }
      if (!size && typeof measure === 'function') size = await measure(bytes, ext);
      images[src] = {
        bytes,
        ext,
        width: size && Number(size.width) > 0 ? Number(size.width) : 0,
        height: size && Number(size.height) > 0 ? Number(size.height) : 0
      };
    } catch (e) {
      warnings.push({ src, reason: (e && e.message) ? e.message : 'image could not be read' });
    }
  }
  return { images, warnings, sources };
};

/** LE FICHIER TÉLÉCHARGÉ. Le .docx part par un lien `download` (le même geste
 *  qu'un export CSV : aucune fenêtre, aucun aller-retour serveur). */
export const downloadDocxFile = ({ bytes, fileName } = {}) => {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !bytes || !bytes.length) return false;
  const url = URL.createObjectURL(new Blob([bytes], { type: DOCX_MIME }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || docxFileName('');
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* rien */ } }, 4000);
  return true;
};

/** Ce que le bandeau du document dit après un export : ce qui est entré dans le
 *  fichier, et ce qui n'a pas pu suivre. Une note muette laisserait croire que
 *  TOUT est parti. */
export const docxReport = (file) => {
  if (!file) return '⚠️ Word: nothing to export';
  const left = (file.missing ? file.missing.length : 0) + (file.warnings ? file.warnings.length : 0);
  const many = file.embedded === 1 ? 'figure' : 'figures';
  return `⬇️ Word (.docx): ${file.embedded || 0} ${many} embedded`
    + (left ? ` — ${left} not readable here (their caption stays; 🖨️ Print keeps them)` : '');
};

/**
 * LE GESTE COMPLET : le HTML du document final → ses blocs → les pixels des
 * figures → le .docx → le fichier dans les « Téléchargements ».
 * @returns {Promise<{ ok:boolean, reason?:string, bytes?:Uint8Array, fileName?:string, report?:string }>}
 */
export const exportProjectDocx = async ({ html, title = '', creator = '', dateIso = '', ...options } = {}) => {
  const blocks = parseDocHtml(html);
  if (!blocks.length) return { ok: false, reason: 'the document is empty', report: '⚠️ Word: the document is empty' };
  const { images, warnings } = await loadDocImages(blocks, options);
  const file = buildDocx({ blocks, images, title, creator, dateIso });
  downloadDocxFile(file);
  return { ok: true, ...file, warnings, report: docxReport({ ...file, warnings }) };
};











