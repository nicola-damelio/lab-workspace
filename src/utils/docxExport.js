// src/utils/docxExport.js
/* =========================================================================
   EXPORT EN .DOCX (Word) DU DOCUMENT D'UN PROJET.

   « In the document of the project there must be a export to docx button. »

   Le document d'un projet vit en HTML (`#project-doc-container` : titre, auteurs,
   affiliations, intitulés de section, paragraphes, listes, tableaux, légendes de
   figure, bibliographie). Un .docx est un ZIP de XML OOXML : ce module écrit le
   minimum qu'un lecteur (Word, LibreOffice, Google Docs) ouvre sans broncher —

     [Content_Types].xml · _rels/.rels · word/document.xml
     word/styles.xml · word/_rels/document.xml.rels
     … plus une PARTIE PAR IMAGE (word/media/imageN.png), quand il y en a

   Ce qui est repris du document : la STRUCTURE (h1 → h6, paragraphes, listes à
   puces / numérotées, tableaux, légendes), le TEXTE et sa mise en forme courante
   (gras, italique, souligné, barré, exposant, indice, code) et les LIENS. La MISE
   EN FORME DU DOCUMENT suit, elle aussi : la police, la taille, l'alignement, le
   gras / l'italique / le souligné et la couleur choisis dans le « Publication
   format » pour chaque partie (titre, auteurs, affiliations, intitulés de section,
   texte, figures, bibliographie) deviennent celles du fichier Word — même choix,
   même règle que l'impression, voir docxStyleOf. Les IMAGES sont EMBARQUÉES dans
   le fichier (`word/media/…`) : les pixels d'une figure insérée sont déjà dans le
   HTML, ceux d'une figure du Drive sont rapatriés par la page juste avant l'export
   (voir resolveDocxImages). Rien n'est envoyé nulle part : le fichier est fabriqué
   et téléchargé dans le navigateur.

   Aucune dépendance nouvelle : fflate (déjà utilisé par tous les imports .docx du
   projet) zippe les parties, le reste est du XML écrit ici — le module tourne donc
   aussi sous node (voir _pub_docx_export_test.mjs).
   ========================================================================= */

import { zipSync, strToU8 } from 'fflate';
/* LA MISE EN FORME DU DOCUMENT (« Publication format ») : ses parties et leurs
   sélecteurs sont la SEULE définition de ce qu'est « le titre », « une figure »…
   (voir pubLayoutCss) — l'export .docx les relit au lieu de les réécrire. */
import { PUB_LAYOUT_PARTS, normalizePubLayout } from '../components/pubCitation.js';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Un nom de fichier sûr pour le .docx (« … project document.docx »). */
export const docxFileName = (name) => {
  const raw = String(name == null ? '' : name)
    .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${raw || 'Project document'}.docx`;
};

/* ── 1. LE NETTOYAGE DU TEXTE ─────────────────────────────────────────────── */

/** Le texte lu d'un document HTML : les entités y sont écrites (`&amp;`, `&#233;`)
 *  et le XML du .docx ne peut pas les garder telles quelles. */
const decodeEntities = (s) => String(s == null ? '' : s)
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&nbsp;/gi, ' ')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&apos;/gi, "'")
  .replace(/&amp;/gi, '&');

/** Le contraire : le texte qui part dans le XML (les caractères que Word refuse —
 *  ceux de contrôle, sauf la tabulation et le saut de ligne — sont retirés). */
const stripControlChars = (s) => Array.from(String(s == null ? '' : s))
  .filter((ch) => {
    const c = ch.codePointAt(0);
    return c === 9 || c === 10 || c === 13 || c >= 32;
  })
  .join('');

const esc = (s) => stripControlChars(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

/* ── 2. LE LECTEUR DE HTML (arbre, sans DOM : le module tourne aussi sous node) ── */

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);
// Les balises qui ouvrent une « ligne » du document (voir renderNode).
const BLOCK_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'figcaption', 'blockquote', 'pre',
  'table', 'tr', 'td', 'th', 'ul', 'ol', 'figure', 'div', 'section', 'article', 'header', 'main', 'hr'
]);

/* Ce que la FEUILLE D'IMPRESSION cache n'a rien à faire dans le fichier Word non
   plus : la classe « no-print » (les boutons et les aides qui ne vivent qu'à
   l'écran — « ✏️ », l'éditeur de légende… voir projectDetailModule) est retirée. */
const isScreenOnly = (node) => /(^|\s)no-print(\s|$)/
  .test(String((node.attrs && (node.attrs.class || node.attrs.className)) || ''));

const parseAttrs = (raw) => {
  const out = {};
  String(raw || '').replace(
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g,
    (_, k, dq, sq, bare) => { out[k.toLowerCase()] = decodeEntities(dq != null ? dq : (sq != null ? sq : bare)); return ''; }
  );
  return out;
};

/** `html` → un arbre `{ tag, attrs, children }` (les scripts, les styles et l'en-tête
 *  sont retirés : un document de projet n'en apporte jamais au .docx). */
export const parseHtmlTree = (html) => {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const src = String(html == null ? '' : html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)(\/?)>|([^<]+)/g;
  let m = re.exec(src);
  while (m) {
    const [, close, tag, attrs, selfClose, text] = m;
    if (text != null) {
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push({ tag: '#text', text: decodeEntities(text) });
    } else {
      const name = String(tag).toLowerCase();
      if (close) {
        for (let i = stack.length - 1; i > 0; i -= 1) {
          if (stack[i].tag === name) { stack.length = i; break; }
        }
      } else {
        const node = { tag: name, attrs: parseAttrs(attrs), children: [] };
        stack[stack.length - 1].children.push(node);
        if (!VOID_TAGS.has(name) && !selfClose) stack.push(node);
      }
    }
    m = re.exec(src);
  }
  return root;
};

/* ── 3. LES BRIQUES XML DU .DOCX ──────────────────────────────────────────── */

/** Un « run » (un morceau de texte avec sa mise en forme). Les enfants de `w:rPr`
 *  sont écrits dans l'ORDRE que le schéma OOXML impose (rStyle, rFonts, b, i,
 *  strike, color, sz, u, vertAlign).
 *  `f` porte aussi les réglages du « Publication format » (voir docxStyleOf) :
 *  `font` = le nom de la police, et `bold` / `italic` / `underline` à TROIS états
 *  — `true` impose, `false` RETIRE explicitement (le titre d'un document est en
 *  gras par défaut : un choix « non gras » doit pouvoir le défaire, comme le
 *  `font-weight: 400 !important` de la feuille d'impression). */
const run = (text, fmt) => {
  const f = fmt || {};
  const body = String(text == null ? '' : text);
  if (!body) return '';
  const rpr = [];
  if (f.link) rpr.push('<w:rStyle w:val="Hyperlink"/>');
  if (f.mono) rpr.push('<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>');
  else if (f.font) rpr.push(`<w:rFonts w:ascii="${esc(f.font)}" w:hAnsi="${esc(f.font)}" w:cs="${esc(f.font)}"/>`);
  if (f.bold === true) rpr.push('<w:b/>');
  else if (f.bold === false) rpr.push('<w:b w:val="0"/>');
  if (f.italic === true) rpr.push('<w:i/>');
  else if (f.italic === false) rpr.push('<w:i w:val="0"/>');
  if (f.strike) rpr.push('<w:strike/>');
  if (f.color) rpr.push(`<w:color w:val="${esc(f.color)}"/>`);
  if (f.size) rpr.push(`<w:sz w:val="${Math.round(f.size)}"/><w:szCs w:val="${Math.round(f.size)}"/>`);
  if (f.underline === true) rpr.push('<w:u w:val="single"/>');
  else if (f.underline === false) rpr.push('<w:u w:val="none"/>');
  if (f.vert) rpr.push(`<w:vertAlign w:val="${f.vert}"/>`);
  const lines = body.split('\n');
  const texts = lines
    .map((p, i) => `${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(p)}</w:t>`)
    .join('');
  return `<w:r>${rpr.length ? `<w:rPr>${rpr.join('')}</w:rPr>` : ''}${texts}</w:r>`;
};

/** Un paragraphe. Les enfants de `w:pPr` sont écrits dans l'ordre du schéma
 *  (pStyle, keepNext, pBdr, spacing, ind, jc). */
const para = (runs, opt) => {
  const o = opt || {};
  const pr = [];
  if (o.style) pr.push(`<w:pStyle w:val="${o.style}"/>`);
  if (o.keepNext) pr.push('<w:keepNext/>');
  if (o.rule) pr.push(`<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="${o.rule}"/></w:pBdr>`);
  if (o.before || o.after) pr.push(`<w:spacing${o.before ? ` w:before="${o.before}"` : ''}${o.after ? ` w:after="${o.after}"` : ''}/>`);
  if (o.indent || o.hanging) pr.push(`<w:ind${o.indent ? ` w:left="${o.indent}"` : ''}${o.hanging ? ` w:hanging="${o.hanging}"` : ''}/>`);
  if (o.align) pr.push(`<w:jc w:val="${o.align}"/>`);
  return `<w:p>${pr.length ? `<w:pPr>${pr.join('')}</w:pPr>` : ''}${runs || ''}</w:p>`;
};

/** Le texte d'un nœud, sans balise (pour l'infobulle d'un lien, le repli d'une image). */
export const nodeText = (node) => {
  if (!node) return '';
  if (node.tag === '#text') return String(node.text || '');
  return (node.children || []).map(nodeText).join('');
};

/* ── 3 bis. LA MISE EN FORME DU DOCUMENT (« Publication format ») ───────────
   « the export to docx does not reflect the style of the document, everything is
   different: police, alignement, font, color. » Le fichier Word suivait la
   STRUCTURE du document et ignorait sa mise en forme : il repartait de sa propre
   feuille (Georgia 11 pt, tout à gauche). Le format du projet
   (`project.pubFormat`) est donc relu ici, exactement comme pubLayoutCss le fait
   pour l'écran, l'impression et le PDF : chaque PARTIE du document est reconnue
   par sa CLASSE (`pf-title`, `pf-heading`, `pf-body`… — les sélecteurs de
   PUB_LAYOUT_PARTS, donc une seule définition) et ses réglages — police, taille,
   alignement, gras / italique / souligné, couleur — deviennent la mise en forme
   des paragraphes et des runs correspondants. Un réglage ABSENT n'écrit rien :
   sans mise en forme choisie, le fichier est celui d'avant. */

/** La partie qu'une CLASSE désigne (« pf-title » → « title »). La LÉGENDE est le
 *  seul cas particulier : elle prend le texte de la partie « figure » (voir
 *  pubLayoutCss, qui met la légende en forme avec les réglages de la figure). */
const PART_BY_CLASS = (() => {
  const map = {};
  PUB_LAYOUT_PARTS.forEach((part) => {
    (part.selectors || []).forEach((s) => { if (s.startsWith('.')) map[s.slice(1)] = part.id; });
    (part.caption || []).forEach((s) => { if (s.startsWith('.')) map[s.slice(1)] = 'caption'; });
  });
  return map;
})();

/* La ligne d'information (« projet · scientifique · date ») est EXCLUE du texte
   des sections par la feuille du document (`p:not(.pf-meta)`) : elle ne reçoit
   donc aucun réglage ici non plus — et ses enfants non plus (la partie « - »
   n'existe dans aucun format). */
const UNSTYLED_CLASS = 'pf-meta';

/** Le repli d'une BALISE, quand aucune classe ne nomme la partie : c'est celui
 *  de pubLayoutCss (un titre sans `.pf-title` reste un titre, un `h2` une
 *  section, une légende une légende, un `<p>` du texte). */
const PART_BY_TAG = {
  h1: 'title', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
  p: 'body', figcaption: 'caption'
};

const classNamesOf = (node) => String((node.attrs && (node.attrs.class || node.attrs.className)) || '')
  .split(/\s+/).filter(Boolean);

/** La partie d'un nœud d'après ses classes : une partie connue, `'caption'` pour
 *  une légende, `'-'` pour la ligne d'information, `''` quand aucune classe ne
 *  la nomme (la balise décide alors, voir PART_BY_TAG). */
const partOfClasses = (node) => {
  const names = classNamesOf(node);
  if (names.includes(UNSTYLED_CLASS)) return '-';
  for (let i = 0; i < names.length; i += 1) if (PART_BY_CLASS[names[i]]) return PART_BY_CLASS[names[i]];
  return '';
};

/** La police : la PREMIÈRE famille de la liste CSS (« Georgia, "Times New
 *  Roman", serif » → « Georgia »), sans guillemets — le nom que Word attend. */
const fontNameOf = (css) => String(css || '').split(',')[0].trim().replace(/^["']|["']$/g, '').trim();

const JC_OF_ALIGN = { left: 'left', center: 'center', right: 'right', justify: 'both' };
const COLOR_RE = /^#[0-9a-f]{6}$/i;

/** Les réglages d'une partie, ramenés à ce que Word attend : taille en
 *  DEMI-POINTS, couleur `RRGGBB` sans dièse, alignement en `w:jc`. Rien n'est
 *  inventé : un réglage absent reste absent (voir pubTextStyleCss, même règle),
 *  et `null` = « aucune mise en forme » — le .docx d'un document sans format
 *  choisi reste donc exactement celui d'avant. */
const docxStyleOf = (layout, partId) => {
  const st = (layout && layout[partId]) || null;
  if (!st || typeof st !== 'object') return null;
  const out = {};
  const font = fontNameOf(st.font);
  if (font) out.font = font;
  if (Number(st.size) > 0) out.size = Math.round(Number(st.size) * 2);
  if (st.bold === true || st.bold === false) out.bold = st.bold;
  if (st.italic === true || st.italic === false) out.italic = st.italic;
  if (st.underline === true || st.underline === false) out.underline = st.underline;
  if (COLOR_RE.test(String(st.color || ''))) out.color = String(st.color).slice(1).toUpperCase();
  if (JC_OF_ALIGN[st.align]) out.align = JC_OF_ALIGN[st.align];
  const width = Number(st.width);
  if (width > 0 && width !== 100) out.width = Math.min(100, Math.max(10, Math.round(width)));
  return Object.keys(out).length ? out : null;
};

/* ── 3 ter. LES IMAGES (les pixels entrent DANS le fichier) ─────────────────
   « furthermore images are missing. » Un .docx ne va rien chercher sur le
   réseau : les pixels doivent être une PARTIE du ZIP (`word/media/imageN.ext`).
   Une image d'un document est une `data:` URL (une figure insérée, un canvas) ou
   un lien Drive : la page rapatrie les secondes juste avant l'export et les passe
   ici (voir resolveDocxImages). Une image qu'on n'a pas su lire est laissée de
   côté — sa légende, elle, reste dans le texte. */

const IMAGE_MIME = {
  png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp',
  webp: 'image/webp', tif: 'image/tiff'
};

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Le base64 d'une `data:` URL → ses octets. Décodé ici plutôt qu'avec `atob` :
 *  ce module tourne aussi sous node (voir _pub_docx_export_test.mjs). */
const base64Bytes = (raw) => {
  const s = String(raw || '').replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array((s.length * 3) >> 2);
  let acc = 0;
  let bits = 0;
  let n = 0;
  for (let i = 0; i < s.length; i += 1) {
    const v = B64_ALPHABET.indexOf(s[i]);
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out[n] = (acc >> bits) & 0xff; n += 1; }
  }
  return out.slice(0, n);
};

const be16 = (b, i) => (b[i] << 8) | b[i + 1];
const be32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

/** La taille EN PIXELS d'une image, lue dans ses premiers octets (PNG, GIF,
 *  JPEG) : elle sert à garder le rapport de la figure. Illisible = `null`, et un
 *  cadre 4:3 est alors supposé. */
const imagePixels = (b) => {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { w: be32(b, 16), h: be32(b, 20) };  // PNG
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49) return { w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) }; // GIF
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {                                            // JPEG
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i += 1; continue; }
      const marker = b[i + 1];
      const len = be16(b, i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { w: be16(b, i + 7), h: be16(b, i + 5) };
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
      i += 2 + len;
    }
  }
  return null;
};

/** Une image → ses octets, son extension et sa taille. `null` quand ce n'est pas
 *  une image en base64 (une URL, un SVG : Word attend des pixels, et les
 *  rasteriser n'est pas du ressort de ce module). */
const pictureOf = (dataUrl) => {
  const m = /^data:image\/([a-z0-9.+-]+);base64,([\s\S]*)$/i.exec(String(dataUrl || ''));
  if (!m) return null;
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  if (!IMAGE_MIME[ext]) return null;
  const bytes = base64Bytes(m[2]);
  if (!bytes.length) return null;
  const px = imagePixels(bytes) || { w: 800, h: 600 };
  return { bytes, ext, mime: IMAGE_MIME[ext], w: px.w, h: px.h };
};

const EMU_PER_PX = 9525;      // 914 400 EMU par pouce, à 96 pixels par pouce
const CONTENT_EMU = 6126624;  // 17,01 cm : une page A4 moins ses marges de 2 cm

/** Un `<w:drawing>` : l'image à l'échelle de la page (une figure plus large que
 *  la colonne de texte est réduite, son rapport gardé) et à la LARGEUR choisie
 *  dans le format pour les figures (`width` = % de la colonne, voir pubLayoutCss). */
const drawingXml = (pic, widthPct) => {
  const max = Math.round(CONTENT_EMU * (widthPct ? widthPct / 100 : 1));
  let cx = Math.round(pic.w * EMU_PER_PX);
  let cy = Math.round(pic.h * EMU_PER_PX);
  if (cx > max) { cy = Math.round((cy * max) / cx); cx = max; }
  return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
    + `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${pic.id}" name="Picture ${pic.id}"/>`
    + `<a:graphic><a:graphicData uri="${PIC_URI}">`
    + `<pic:pic xmlns:pic="${PIC_NS}"><pic:nvPicPr>`
    + `<pic:cNvPr id="${pic.id}" name="${esc(pic.name)}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${pic.rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + '<pic:spPr><a:xfrm><a:off x="0" y="0"/>'
    + `<a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
    + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
};

/* ── 4. LE RENDU : HTML → XML DU DOCUMENT ─────────────────────────────────── */

/** Le contexte d'un rendu : les RELATIONS rencontrées (chaque `href` devient un
 *  lien, chaque image une PARTIE du fichier — `rId1` reste la feuille de styles,
 *  voir relsXml), la table des images rapatriées par l'appelant
 *  (`options.images` : `src` → `data:` URL) et la mise en forme du document
 *  (`options.format`, le « Publication format » du projet). */
const newDocxContext = (options) => {
  const o = options || {};
  const layout = normalizePubLayout(o.format && o.format.layout);
  const images = o.images || null;
  const rels = [];
  const media = [];
  const pictures = new Map();
  const styles = new Map();
  /** Une relation de plus. Son `rId` suit l'ORDRE DU DOCUMENT (liens et images
   *  ensemble) : tout ce que le corps cite existe donc dans relsXml. */
  const addRel = (type, target, external) => {
    const id = `rId${rels.length + 2}`;
    rels.push({ id, type, target, external: !!external });
    return id;
  };
  return {
    rels,
    media,
    images,
    addLink: (href) => addRel('hyperlink', href, true),
    /** Une image → `{ rid, name, w, h, id }`, ou `null` quand ses pixels sont
     *  introuvables (une URL que la page n'a pas su rapatrier). Une même image
     *  citée deux fois n'est écrite qu'UNE fois dans le fichier. */
    addPicture: (dataUrl, src) => {
      const key = String(src || dataUrl);
      if (pictures.has(key)) return pictures.get(key);
      const pic = pictureOf(dataUrl);
      let made = null;
      if (pic) {
        const name = `image${media.length + 1}.${pic.ext}`;
        const rid = addRel('image', `media/${name}`, false);
        media.push({ name, bytes: pic.bytes, mime: pic.mime, ext: pic.ext });
        made = { rid, name, w: pic.w, h: pic.h, id: media.length };
      }
      pictures.set(key, made);
      return made;
    },
    /** Les réglages d'une partie du document, calculés UNE fois (voir
     *  docxStyleOf). La légende prend ceux de la figure (pubLayoutCss). */
    styleOf: (partId) => {
      if (!partId) return null;
      if (!styles.has(partId)) styles.set(partId, docxStyleOf(layout, partId === 'caption' ? 'figure' : partId));
      return styles.get(partId);
    }
  };
};

/** Une image → le run qui la porte. Ses pixels viennent de la `data:` URL du
 *  document lui-même, ou de la table rapatriée par la page (`ctx.images`). Sans
 *  pixels il n'y a rien à écrire : Word n'affiche pas une URL — la légende de la
 *  figure, elle, reste dans le texte. */
const renderPicture = (node, ctx, fmt) => {
  const src = String((node.attrs && node.attrs.src) || '').trim();
  if (!src) return '';
  const dataUrl = (ctx.images && ctx.images[src]) || (/^data:image\/[a-z0-9.+-]+;base64,/i.test(src) ? src : '');
  if (!dataUrl) return '';
  const pic = ctx.addPicture(dataUrl, src);
  return pic ? drawingXml(pic, fmt && fmt.width) : '';
};

/** Les enfants d'un nœud « en ligne » (gras, italique, lien…) → des runs. Un enfant
 *  qui ouvre un bloc passe à la ligne au lieu de disparaître. */
const inlineChildren = (node, ctx, fmt) => (node.children || [])
  .map((c, i) => (i && BLOCK_TAGS.has(c.tag) ? '<w:br/>' : '') + renderInline(c, ctx, fmt))
  .join('');

const renderInline = (node, ctx, fmt) => {
  const f = fmt || {};
  if (node.tag === '#text') return run(String(node.text || '').replace(/\s+/g, ' '), f);
  if (isScreenOnly(node)) return '';
  const t = node.tag;
  if (t === 'br') return '<w:br/>';
  if (t === 'img') return renderPicture(node, ctx, f);
  if (t === 'script' || t === 'style' || t === 'input' || t === 'svg') return '';
  if (t === 'strong' || t === 'b') return inlineChildren(node, ctx, { ...f, bold: true });
  if (t === 'em' || t === 'i' || t === 'cite' || t === 'var') return inlineChildren(node, ctx, { ...f, italic: true });
  if (t === 'u' || t === 'ins') return inlineChildren(node, ctx, { ...f, underline: true });
  if (t === 's' || t === 'del' || t === 'strike') return inlineChildren(node, ctx, { ...f, strike: true });
  if (t === 'sup') return inlineChildren(node, ctx, { ...f, vert: 'superscript' });
  if (t === 'sub') return inlineChildren(node, ctx, { ...f, vert: 'subscript' });
  if (t === 'code' || t === 'kbd' || t === 'samp' || t === 'tt') return inlineChildren(node, ctx, { ...f, mono: true });
  if (t === 'a') {
    const href = String((node.attrs && node.attrs.href) || '').trim();
    // Un renvoi interne (« #ref-12 ») ne mène nulle part hors du navigateur : son
    // texte part, sans relation.
    if (href && !href.startsWith('#') && /^[a-z][a-z0-9+.-]*:/i.test(href)) {
      const id = ctx.addLink(href);
      const text = nodeText(node) || href;
      return `<w:hyperlink r:id="${id}">${run(text, { ...f, link: true, underline: true, color: '0563C1' })}</w:hyperlink>`;
    }
    return inlineChildren(node, ctx, f);
  }
  return inlineChildren(node, ctx, f);
};

/** Un tableau HTML → un vrai tableau Word (bordures simples, en-tête en gras).
 *  `base` = les réglages de la partie d'où vient le tableau (voir docxStyleOf). */
const renderTable = (node, ctx, base) => {
  const rows = [];
  const walk = (n) => (n.children || []).forEach((c) => {
    if (c.tag === 'tr') rows.push(c);
    else if (c.tag === 'thead' || c.tag === 'tbody' || c.tag === 'tfoot') walk(c);
  });
  walk(node);
  const grid = rows.map((tr) => (tr.children || [])
    .filter((c) => c.tag === 'td' || c.tag === 'th')
    .map((cell) => ({ runs: inlineChildren(cell, ctx, cell.tag === 'th' ? { ...(base || {}), bold: true } : base) })));
  if (!grid.length) return '';
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((s) => `<w:${s} w:val="single" w:sz="6" w:space="0" w:color="999999"/>`).join('');
  const cells = grid
    .map((row) => `<w:tr>${row.map((c) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${para(c.runs)}</w:tc>`).join('')}</w:tr>`)
    .join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${borders}</w:tblBorders></w:tblPr>${cells}</w:tbl>`;
};

const renderNodes = (nodes, ctx, part) => (nodes || []).map((n) => renderBlock(n, ctx, part)).join('');

/** Un nœud de BLOC → un ou plusieurs paragraphes (ou un tableau). `part` = la
 *  PARTIE du document d'où l'on vient : un conteneur `.pf-body` la donne à ses
 *  paragraphes, un `.pf-figure` à sa légende (voir docxStyleOf). */
const renderBlock = (node, ctx, part) => {
  const t = node.tag;
  const own = partOfClasses(node);
  const pid = own || part || PART_BY_TAG[t] || '';
  const base = ctx.styleOf(pid);
  /* L'alignement est une affaire de PARAGRAPHE (voir para), le reste va aux runs
     — exactement la répartition de la feuille du document. */
  const popt = (extra) => ({ ...(base && base.align ? { align: base.align } : {}), ...extra });
  if (t === '#text') {
    const text = String(node.text || '').replace(/\s+/g, ' ').trim();
    return text ? para(run(text, base), popt()) : '';
  }
  if (t === 'script' || t === 'style' || t === 'head' || t === 'svg' || t === 'input') return '';
  if (t === 'img') {
    const drawing = renderPicture(node, ctx, base);
    return drawing ? para(drawing, popt()) : '';
  }
  if (isScreenOnly(node)) return '';
  if (t === 'hr') return para('', popt({ rule: 'AAAAAA' }));
  if (/^h[1-6]$/.test(t)) {
    const level = Math.min(Number(t[1]), 3);
    /* Un intitulé est en gras comme le programme l'écrit — sauf si le format dit
       le contraire (`bold: false` le retire, voir run). */
    const fmt = { ...(base || {}), bold: base && base.bold !== undefined ? base.bold : true };
    return para(inlineChildren(node, ctx, fmt), popt({
      style: `Heading${level}`, keepNext: true, ...(level === 2 ? { rule: 'BBBBBB' } : {})
    }));
  }
  if (t === 'p') return para(inlineChildren(node, ctx, base), popt());
  if (t === 'figcaption') {
    /* Une légende que le format ne règle pas garde sa mise en forme de légende
       (italique, grise, petite) ; chaque réglage choisi la remplace. */
    const fmt = { italic: true, color: '555555', size: 18, ...(base || {}) };
    return para(inlineChildren(node, ctx, fmt), popt());
  }
  if (t === 'blockquote') return para(inlineChildren(node, ctx, base), popt({ indent: 720 }));
  if (t === 'pre') return para(inlineChildren(node, ctx, { ...(base || {}), mono: true }), popt());
  if (t === 'ul' || t === 'ol') {
    const items = (node.children || []).filter((c) => c.tag === 'li');
    return items.map((li, i) => para(
      run(t === 'ul' ? '•  ' : `${i + 1}.  `, base) + inlineChildren(li, ctx, base),
      popt({ indent: 720, hanging: 360 })
    )).join('');
  }
  if (t === 'li') return para(run('•  ', base) + inlineChildren(node, ctx, base), popt({ indent: 720, hanging: 360 }));
  if (t === 'table') return renderTable(node, ctx, base);
  if (t === 'tr' || t === 'td' || t === 'th' || t === 'thead' || t === 'tbody' || t === 'tfoot') {
    return renderNodes(node.children, ctx, pid);
  }
  // Les conteneurs (div, section, figure…). Ceux qui portent des blocs les rendent
  // tels quels, et leur texte direct devient un paragraphe ; les autres (un simple
  // `<span>` autour d'une phrase) sont UN paragraphe.
  const kids = node.children || [];
  if (kids.some((c) => BLOCK_TAGS.has(c.tag))) {
    let out = '';
    let pending = [];
    const flush = () => {
      const runs = pending.map((c) => renderInline(c, ctx, base)).join('');
      if (runs) out += para(runs, popt());
      pending = [];
    };
    kids.forEach((c) => {
      if (BLOCK_TAGS.has(c.tag)) { flush(); out += renderBlock(c, ctx, pid); }
      else pending.push(c);
    });
    flush();
    return out;
  }
  return para(kids.map((c) => renderInline(c, ctx, base)).join(''), popt());
};

/** `html` → `{ xml, links, rels, media }` : le corps du document Word, les liens
 *  à déclarer, TOUTES ses relations (liens et images) et les parties binaires que
 *  les images apportent (`word/media/…`). `options.format` = le « Publication
 *  format » du projet (voir docxStyleOf), `options.images` = les pixels rapatriés
 *  par la page (`src` → `data:` URL, voir resolveDocxImages). */
export const htmlToDocxBody = (html, options) => {
  const ctx = newDocxContext(options);
  const xml = renderNodes(parseHtmlTree(html).children, ctx, '');
  return {
    xml,
    links: ctx.rels.filter((r) => r.type === 'hyperlink').map((r) => ({ id: r.id, href: r.target })),
    rels: ctx.rels.slice(),
    media: ctx.media.slice()
  };
};

/* ── 4 bis. LES PIXELS DU DOCUMENT, AVANT L'EXPORT ──────────────────────────
   Un .docx n'ouvre pas d'URL : les figures d'un document (une image insérée, un
   canvas, une figure posée sur le Drive) doivent être LÀ au moment de la
   fabrication. La page va donc les chercher AVANT — c'est le seul geste
   asynchrone de l'export, et il reste dans le navigateur (voir
   resolveImageToDataUrl : Drive, Nextcloud, ou un simple fetch). */

/** Les `src` d'images d'un document, dans l'ordre et sans doublon. */
export const imageSourcesIn = (html) => {
  const out = [];
  const seen = new Set();
  const visit = (nodes) => (nodes || []).forEach((n) => {
    if (n.tag === 'img') {
      const src = String((n.attrs && n.attrs.src) || '').trim();
      if (src && !seen.has(src)) { seen.add(src); out.push(src); }
    }
    visit(n.children);
  });
  visit(parseHtmlTree(html).children);
  return out;
};

/** `{ src → data: URL }` des images d'un document : `resolve` va chercher les
 *  pixels d'une image qui n'est pas déjà dans le HTML (les `data:` URL le sont) et
 *  n'est appelé que pour celles-là. Une image qu'aucun des deux ne sait lire est
 *  simplement absente de la table — elle n'entrera pas dans le fichier, sa
 *  légende si. */
export const resolveDocxImages = async (html, resolve) => {
  const out = {};
  await Promise.all(imageSourcesIn(html).map(async (src) => {
    if (/^data:image\//i.test(src)) { out[src] = src; return; }
    if (typeof resolve !== 'function') return;
    try {
      const got = await resolve(src);
      if (typeof got === 'string' && /^data:image\//i.test(got)) out[src] = got;
    } catch { /* pas de pixels : la légende reste */ }
  }));
  return out;
};

/* ── 5. LE PAQUET .DOCX (les parties qu'un lecteur attend) ───────────────────
   [Content_Types].xml · _rels/.rels · word/document.xml · word/styles.xml ·
   word/_rels/document.xml.rels, plus une PARTIE PAR IMAGE (word/media/…). */

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
/* Le dessin (une image) a ses propres espaces de noms : le dessin lui-même
   (`wp`), le graphique (`a`) et la photo (`pic`). */
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

/** Les types du paquet : ceux qu'un lecteur attend, plus l'extension de chaque
 *  image embarquée (sans quoi Word refuse d'ouvrir le fichier). */
const contentTypesXml = (media) => {
  const exts = Array.from(new Set((media || []).map((m) => m.ext))).sort();
  return `${XML_HEAD}
<Types xmlns="${CT_NS}">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${exts.map((e) => `<Default Extension="${e}" ContentType="${IMAGE_MIME[e]}"/>`).join('\n')}
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
};

const ROOT_RELS = `${XML_HEAD}
<Relationships xmlns="${PKG_REL_NS}">
<Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="word/document.xml"/>
</Relationships>`;

/* Les tailles des intitulés suivent celles de la feuille imprimée (un h1 de
   24 px, un h2 de 16 px, un h3 de 14 px — en demi-points : 36 / 24 / 21). */
const headingStyle = (n) => {
  const sz = n === 1 ? 36 : n === 2 ? 24 : 21;
  return `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/>`
    + '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>'
    + `<w:pPr><w:keepNext/><w:spacing w:before="${n === 1 ? 0 : 320}" w:after="140"/></w:pPr>`
    + `<w:rPr><w:b/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr></w:style>`;
};

/** La feuille du document : les intitulés, le lien, et les DÉFAUTS DU TEXTE.
 *  Ceux-ci suivent la partie « texte des sections » quand le format en choisit
 *  une (police et taille) ; sans choix, ce sont ceux du programme — Georgia
 *  11 pt — et le fichier est celui d'avant. */
const stylesXml = (format) => {
  const body = docxStyleOf(normalizePubLayout(format && format.layout), 'body') || {};
  const font = body.font || 'Georgia';
  const sz = body.size || 22;
  return `${XML_HEAD}
<w:styles xmlns:w="${W_NS}">
<w:docDefaults>
<w:rPrDefault><w:rPr><w:rFonts w:ascii="${esc(font)}" w:hAnsi="${esc(font)}" w:cs="${esc(font)}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
${[1, 2, 3].map(headingStyle).join('\n')}
</w:styles>`;
};

/** Les relations du document : la feuille de styles (rId1), puis les liens
 *  externes et les images — chaque image est une PARTIE du fichier
 *  (`word/media/…`, que `contentTypesXml` déclare aussi). */
const relsXml = (rels) => `${XML_HEAD}
<Relationships xmlns="${PKG_REL_NS}">
<Relationship Id="rId1" Type="${R_NS}/styles" Target="styles.xml"/>
${(rels || []).map((r) => (r.type === 'image'
    ? `<Relationship Id="${esc(r.id)}" Type="${R_NS}/image" Target="${esc(r.target)}"/>`
    : `<Relationship Id="${esc(r.id)}" Type="${R_NS}/hyperlink" Target="${esc(r.target)}" TargetMode="External"/>`)).join('\n')}
</Relationships>`;

/** Le document lui-même : le corps rendu, plus la feuille (A4, marges de 2 cm).
 *  Word n'aime pas qu'un tableau termine le corps : un paragraphe vide le suit.
 *  Les espaces de noms du DESSIN sont déclarés ici, une fois (voir drawingXml). */
const documentXml = (body) => `${XML_HEAD}
<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:wp="${WP_NS}" xmlns:a="${A_NS}">
<w:body>${body}${body.trim().endsWith('</w:tbl>') ? '<w:p/>' : ''}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body>
</w:document>`;

/** Le .docx (un `Uint8Array`) du document HTML donné. `options` :
 *  `{ format, images }` — le « Publication format » et les pixels des images
 *  (voir htmlToDocxBody). */
export const buildDocxBytes = (html, options) => {
  const o = options || {};
  const { xml, rels, media } = htmlToDocxBody(html, o);
  const files = {
    '[Content_Types].xml': strToU8(contentTypesXml(media)),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/document.xml': strToU8(documentXml(xml)),
    'word/styles.xml': strToU8(stylesXml(o.format)),
    'word/_rels/document.xml.rels': strToU8(relsXml(rels))
  };
  media.forEach((m) => { files[`word/media/${m.name}`] = m.bytes; });
  return zipSync(files, { level: 6 });
};

/** Le téléchargement dans le navigateur (le seul geste qui touche au DOM) : `name`
 *  est le nom du document, sans extension — « Aphid project » → « Aphid project.docx ». */
export const downloadDocx = (html, name, options) => {
  const bytes = buildDocxBytes(html, options);
  const blob = new Blob([bytes], { type: DOCX_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = docxFileName(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return bytes.length;
};
