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

   Ce qui est repris du document : la STRUCTURE (h1 → h6, paragraphes, listes à
   puces / numérotées, tableaux, légendes), le TEXTE et sa mise en forme courante
   (gras, italique, souligné, barré, exposant, indice, code) et les LIENS. Les
   IMAGES ne sont pas embarquées : leurs pixels vivent dans le Drive, pas dans le
   HTML — « 🖨️ Print / Save as PDF » les emporte, lui. Rien n'est envoyé nulle
   part : le fichier est fabriqué et téléchargé dans le navigateur.

   Aucune dépendance nouvelle : fflate (déjà utilisé par tous les imports .docx du
   projet) zippe les parties, le reste est du XML écrit ici — le module tourne donc
   aussi sous node (voir _pub_docx_export_test.mjs).
   ========================================================================= */

import { zipSync, strToU8 } from 'fflate';

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
 *  strike, color, sz, u, vertAlign). */
const run = (text, fmt) => {
  const f = fmt || {};
  const body = String(text == null ? '' : text);
  if (!body) return '';
  const rpr = [];
  if (f.link) rpr.push('<w:rStyle w:val="Hyperlink"/>');
  if (f.mono) rpr.push('<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>');
  if (f.bold) rpr.push('<w:b/>');
  if (f.italic) rpr.push('<w:i/>');
  if (f.strike) rpr.push('<w:strike/>');
  if (f.color) rpr.push(`<w:color w:val="${esc(f.color)}"/>`);
  if (f.size) rpr.push(`<w:sz w:val="${Math.round(f.size)}"/><w:szCs w:val="${Math.round(f.size)}"/>`);
  if (f.underline) rpr.push('<w:u w:val="single"/>');
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

/* ── 4. LE RENDU : HTML → XML DU DOCUMENT ─────────────────────────────────── */

/** Le contexte d'un rendu : les liens rencontrés (chaque `href` devient une relation
 *  du .docx — `rId1` est réservé à la feuille de styles, voir relsXml). */
const newDocxContext = () => {
  const links = [];
  return {
    links,
    addLink: (href) => {
      const id = `rId${links.length + 2}`;
      links.push({ id, href });
      return id;
    }
  };
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
  if (t === 'img' || t === 'script' || t === 'style' || t === 'input' || t === 'svg') return '';
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

/** Un tableau HTML → un vrai tableau Word (bordures simples, en-tête en gras). */
const renderTable = (node, ctx) => {
  const rows = [];
  const walk = (n) => (n.children || []).forEach((c) => {
    if (c.tag === 'tr') rows.push(c);
    else if (c.tag === 'thead' || c.tag === 'tbody' || c.tag === 'tfoot') walk(c);
  });
  walk(node);
  const grid = rows.map((tr) => (tr.children || [])
    .filter((c) => c.tag === 'td' || c.tag === 'th')
    .map((cell) => ({ runs: inlineChildren(cell, ctx, cell.tag === 'th' ? { bold: true } : null) })));
  if (!grid.length) return '';
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((s) => `<w:${s} w:val="single" w:sz="6" w:space="0" w:color="999999"/>`).join('');
  const cells = grid
    .map((row) => `<w:tr>${row.map((c) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${para(c.runs)}</w:tc>`).join('')}</w:tr>`)
    .join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${borders}</w:tblBorders></w:tblPr>${cells}</w:tbl>`;
};

const renderNodes = (nodes, ctx) => (nodes || []).map((n) => renderBlock(n, ctx)).join('');

/** Un nœud de BLOC → un ou plusieurs paragraphes (ou un tableau). */
const renderBlock = (node, ctx) => {
  const t = node.tag;
  if (t === '#text') {
    const text = String(node.text || '').replace(/\s+/g, ' ').trim();
    return text ? para(run(text, null)) : '';
  }
  if (t === 'script' || t === 'style' || t === 'head' || t === 'img' || t === 'svg' || t === 'input') return '';
  if (isScreenOnly(node)) return '';
  if (t === 'hr') return para('', { rule: 'AAAAAA' });
  if (/^h[1-6]$/.test(t)) {
    const level = Math.min(Number(t[1]), 3);
    return para(inlineChildren(node, ctx, { bold: true }), { style: `Heading${level}`, keepNext: true });
  }
  if (t === 'p') return para(inlineChildren(node, ctx, null));
  if (t === 'figcaption') return para(inlineChildren(node, ctx, { italic: true, color: '555555', size: 18 }));
  if (t === 'blockquote') return para(inlineChildren(node, ctx, null), { indent: 720 });
  if (t === 'pre') return para(inlineChildren(node, ctx, { mono: true }));
  if (t === 'ul' || t === 'ol') {
    const items = (node.children || []).filter((c) => c.tag === 'li');
    return items.map((li, i) => para(
      run(t === 'ul' ? '•  ' : `${i + 1}.  `, null) + inlineChildren(li, ctx, null),
      { indent: 720, hanging: 360 }
    )).join('');
  }
  if (t === 'li') return para(run('•  ', null) + inlineChildren(node, ctx, null), { indent: 720, hanging: 360 });
  if (t === 'table') return renderTable(node, ctx);
  if (t === 'tr' || t === 'td' || t === 'th' || t === 'thead' || t === 'tbody' || t === 'tfoot') {
    return renderNodes(node.children, ctx);
  }
  // Les conteneurs (div, section, figure…). Ceux qui portent des blocs les rendent
  // tels quels, et leur texte direct devient un paragraphe ; les autres (un simple
  // `<span>` autour d'une phrase) sont UN paragraphe.
  const kids = node.children || [];
  if (kids.some((c) => BLOCK_TAGS.has(c.tag))) {
    let out = '';
    let pending = [];
    const flush = () => {
      const runs = pending.map((c) => renderInline(c, ctx, null)).join('');
      if (runs) out += para(runs);
      pending = [];
    };
    kids.forEach((c) => {
      if (BLOCK_TAGS.has(c.tag)) { flush(); out += renderBlock(c, ctx); }
      else pending.push(c);
    });
    flush();
    return out;
  }
  return para(kids.map((c) => renderInline(c, ctx, null)).join(''));
};

/** `html` → `{ xml, links }` : le corps du document Word et les liens à déclarer. */
export const htmlToDocxBody = (html) => {
  const ctx = newDocxContext();
  const xml = renderNodes(parseHtmlTree(html).children, ctx);
  return { xml, links: ctx.links.slice() };
};

/* ── 5. LE PAQUET .DOCX (les cinq parties qu'un lecteur attend) ───────────── */

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';

const CONTENT_TYPES = `${XML_HEAD}
<Types xmlns="${CT_NS}">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const ROOT_RELS = `${XML_HEAD}
<Relationships xmlns="${PKG_REL_NS}">
<Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const headingStyle = (n) => {
  const sz = n === 1 ? 34 : n === 2 ? 26 : 24;
  return `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/>`
    + '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>'
    + `<w:pPr><w:keepNext/><w:spacing w:before="${n === 1 ? 0 : 320}" w:after="140"/></w:pPr>`
    + `<w:rPr><w:b/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr></w:style>`;
};

const STYLES_XML = `${XML_HEAD}
<w:styles xmlns:w="${W_NS}">
<w:docDefaults>
<w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
${[1, 2, 3].map(headingStyle).join('\n')}
</w:styles>`;

/** Les relations du document : la feuille de styles (rId1) puis les liens externes. */
const relsXml = (links) => `${XML_HEAD}
<Relationships xmlns="${PKG_REL_NS}">
<Relationship Id="rId1" Type="${R_NS}/styles" Target="styles.xml"/>
${links.map((l) => `<Relationship Id="${esc(l.id)}" Type="${R_NS}/hyperlink" Target="${esc(l.href)}" TargetMode="External"/>`).join('\n')}
</Relationships>`;

/** Le document lui-même : le corps rendu, plus la feuille (A4, marges de 2 cm).
 *  Word n'aime pas qu'un tableau termine le corps : un paragraphe vide le suit. */
const documentXml = (body) => `${XML_HEAD}
<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}">
<w:body>${body}${body.trim().endsWith('</w:tbl>') ? '<w:p/>' : ''}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body>
</w:document>`;

/** Le .docx (un `Uint8Array`) du document HTML donné. */
export const buildDocxBytes = (html) => {
  const { xml, links } = htmlToDocxBody(html);
  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/document.xml': strToU8(documentXml(xml)),
    'word/styles.xml': strToU8(STYLES_XML),
    'word/_rels/document.xml.rels': strToU8(relsXml(links))
  }, { level: 6 });
};

/** Le téléchargement dans le navigateur (le seul geste qui touche au DOM) : `name`
 *  est le nom du document, sans extension — « Aphid project » → « Aphid project.docx ». */
export const downloadDocx = (html, name) => {
  const bytes = buildDocxBytes(html);
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
