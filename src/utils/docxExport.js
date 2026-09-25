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
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*) *=/g,
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
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)(\/?)|([^<]+)/g;
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

  }
  return root;
};
