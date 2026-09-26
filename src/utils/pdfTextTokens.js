/* =========================================================================
   src/utils/pdfTextTokens.js
   THE TEXT AND THE TYPEFACES OF A PDF — the reading half of « In the
   publication format, I would like to have a function that extracts format
   information by uploading a pdf: I could just upload a pdf of a publication
   in that journal and the program would fill in the parameters such as the
   presence, order and the names of the sections, the font, police and style of
   each section, the style of the references in the text and in the final
   reference list and the way authors are listed. »

   pdfjs is loaded ON DEMAND — a dynamic import, so it travels in its own chunk
   and is fetched the first time a PDF is uploaded, never for the rest of the
   app — and it runs IN THE BROWSER, like every other library of the app: the
   PDF never leaves the machine, and nothing has to be installed besides the
   npm dependencies the app already builds with (the same as React or NGL).
   utils/publicationFormatFromPdf.js turns what this module returns into a
   publication-format bundle; this module knows nothing about journals.

   What it returns, per page: the LINES of text in reading order — the typeface
   they print (font family, size, bold, italic, serif / sans), their position
   and extent, the column they belong to, and whether the line carries a
   superscript run (an in-text citation) — and nothing more.
   ========================================================================= */

let pdfjsPromise = null;

/* L'adresse des polices standard, résolue UNE fois par `loadPdfjs` (elle dépend
   de l'environnement, voir standardFontDataUrlOf). */
let standardFontDataUrl = null;

/** pdfjs, once: the browser build in the browser, the legacy build under node —
 *  the node suites parse a PDF with the very same code. */
const loadPdfjs = () => {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const inNode = typeof window === 'undefined';
      standardFontDataUrl = standardFontDataUrlOf(inNode);
      const mod = inNode
        ? await import('pdfjs-dist/legacy/build/pdf.mjs')
        : await import('pdfjs-dist/build/pdf.mjs');
      if (!inNode) {
        /* Le worker de pdfjs : Vite l'émet comme un fichier à part et « ?url » en
           donne l'adresse. Sans lui le parseur tourne sur le fil principal — la
           lecture reste juste, l'onglet s'arrête quelques dixièmes de seconde. */
        try {
          const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
          mod.GlobalWorkerOptions.workerSrc = worker.default;
        } catch { /* le fil principal */ }
      }
      return mod;
    })();
  }
  return pdfjsPromise;
};

/* L'ADRESSE DES POLICES STANDARD DE pdfjs (« Helvetica », « Times », « Courier »…).
   Un PDF de revue les cite souvent SANS les embarquer — « Times-Roman » est un
   des quatorze noms que tout lecteur connaît — et pdfjs a alors besoin de ses
   PROPRES fichiers de police pour savoir quelle largeur fait chaque glyphe.
   Sans eux il avertit (« Ensure that the `standardFontDataUrl` API parameter is
   provided. ») et `getTextContent` rend des items à `width` nulle : la taille et
   la famille lues restent justes — elles viennent de la matrice et du nom — mais
   l'étendue des lignes ne l'est plus, donc les colonnes et les coupures se
   lisent de travers. C'est le seul réglage que ce détecteur partage avec pdfjs.

   Le navigateur prend les fichiers DU PAQUET INSTALLÉ : `?url` les émet à côté
   du bundle, comme le worker ci-dessus — rien n'est ajouté au dépôt, rien n'est
   téléchargé, et l'adresse est le DOSSIER qui les contient, car pdfjs colle le
   nom du fichier à la fin (`url = baseUrl + filename`) : le « / » final est donc
   la moitié de l'adresse. Sous node, c'est le dossier du paquet dans
   `node_modules/` — les suites de test lisent le PDF avec le même code. */
const standardFontDataUrlOf = (inNode) => {
  if (inNode) {
    try {
      /* La base est une VARIABLE : Vite ne réécrit que `new URL('littéral',
         import.meta.url)`, et laisserait sinon une adresse node_modules dans le
         bundle du navigateur. */
      const here = import.meta.url;
      const dir = new URL('../../node_modules/pdfjs-dist/standard_fonts/', here);
      /* pdfjs lit ces fichiers avec `fs` : il lui faut un CHEMIN, pas une adresse
         — « file:///C:/… » ne s'ouvre pas (« Unable to load font data at: … ») —
         et un chemin en slashs AVANT terminé par « / » : le « \ » final qu'un
         `path.join` de Windows donnerait est refusé (« Invalid factory url »).
         `pathname` encode les espaces, d'où le décodage ; sur Windows il porte
         une barre oblique devant la lettre de lecteur, que pdfjs n'attend pas. */
      return decodeURIComponent(dir.pathname).replace(/^\/([A-Za-z]:\/)/, '$1');
    } catch { return null; }
  }
  try {
    const emitted = import.meta.glob('/node_modules/pdfjs-dist/standard_fonts/*', {
      eager: true, query: '?url', import: 'default',
    });
    const keys = Object.keys(emitted || {});
    const first = keys.length ? String(emitted[keys[0]] || '') : '';
    /* Le dossier commun des fichiers émis : « /assets/FoxitSerif-a1b2.pfb » →
       « /assets/ ». Vite les range tous ensemble, en développement comme après
       la construction. */
    return first ? first.slice(0, first.lastIndexOf('/') + 1) : null;
  } catch { return null; }
};

/** Le préfixe d'un sous-ensemble de police (« ABCDEF+Times-Roman »). */
const SUBSET_PREFIX = /^[A-Z]{6}\+/;

/* LES FAMILLES RECONNUES, par leur nom embarqué. Un PDF dit « Helvetica-Bold »,
   « TimesNewRomanPSMT », « ABCDEE+AdvPSR42 » : on en tire la famille, le gras et
   l'italique, et rien de plus — un nom inconnu reste « sans serif », ce que le
   pannello peut corriger d'un clic (la famille n'est qu'un réglage). */
const SERIF_RE = /(times|serif|garamond|georgia|minion|charter|palatino|cambria|baskerville|century|schoolbook|book|roman|cmr|lmroman|lmr|nimbus rom|liberation serif|dejavu serif|pt serif|source serif|noto serif)/;
const SANS_RE = /(helv|arial|roboto|calibri|verdana|segoe|lato|open sans|liberation sans|nimbus sans|dejavu sans|futura|univers|frutiger|gill|avant|tahoma|trebuchet|noto sans|source sans|pt sans|sans)/;
const BOLD_RE = /(bold|black|heavy|semibold|semi bold|demi|blk|extrabold|ultrabold)/;
const ITALIC_RE = /(italic|oblique|slanted|inclined|cursive)/;

/* LA LETTRE DE STYLE D'UNE POLICE RENOMMÉE — « OFMPPN+AdvGulliv-R », « …-B »,
   « …-I », « …-BI ». Un grand éditeur donne à ses polices le nom de son choix
   (« AdvGulliv » pour Advantage Gulliver, « AdvP4C4E51 » pour une police de
   tableau) et cache le nom d'origine : la seule chose qui reste LISIBLE est la
   LETTRE du style, collée après le tiret. Sans elle, l'intitulé d'une section en
   gras se lit comme du texte ordinaire — et une page de revue se couvre alors de
   « sections » qui n'en sont pas (mesuré sur un PDF d'Elsevier : les intitulés
   sont en « AdvGulliv-B », la liste des références en « AdvGulliv-R »). Le mot
   entier (« bold », « italic ») est déjà reconnu par BOLD_RE / ITALIC_RE ; ce qui
   suit ne lit QUE la lettre isolée, et seulement en dernier mot du nom. */
const STYLE_LETTER_BOLD = /^(?:b|bd|bk|bi|ib|bold|black|heavy)$/;
const STYLE_LETTER_ITALIC = /^(?:i|it|bi|ib|italic|oblique|slanted)$/;

/** « ABCDEF+TimesNewRoman-BoldItalic » → { name, family, bold, italic, serif }.
 *
 *  `fallbackName` (facultatif) = CE QUE pdfjs DIT DE LA POLICE quand son nom ne
 *  dit rien : « serif », « sans-serif », « monospace ». pdfjs tient sa propre
 *  table des polices renommées et y répond mieux que ce module ne peut le faire
 *  par le nom (« AdvGulliv-R » → « serif », « AdvP4C4E51 » → « sans-serif ») :
 *  c'est donc lui qu'on croit quand le nom ne porte aucun mot connu — sinon un
 *  texte en Times se serait lu « Arial » parce que sa famille s'appelle
 *  « AdvGulliv ». Rien d'inventé pour autant : sans nom reconnu ni réponse de
 *  pdfjs, la famille reste celle du programme. */
export const typefaceOf = (rawName, fallbackName) => {
  const raw = String(rawName || '').replace(SUBSET_PREFIX, '');
  const name = raw.replace(/[,\-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const lower = name.toLowerCase();
  const sans = SANS_RE.test(lower);
  /* Le DERNIER mot du nom, quand il ne dit que le style : « … Gulliv B », et aussi
     « AdvTT28000ce1.B » (le point sépare la lettre du nom de la police — c'est la
     forme qu'emploie un PDF d'Elsevier, dont les intitulés en gras n'étaient donc
     pas lus comme gras). Il faut qu'un nom de famille le précède — un nom d'un seul
     mot (« AdvP4C4E51 ») ne dit rien. */
  const words = raw.split(/[,\s\-_.]+/).filter(Boolean);
  const last = String(words[words.length - 1] || '').toLowerCase();
  const before = String(words[words.length - 2] || '');
  const letter = words.length > 1 && /^[a-z]{1,7}$/.test(last) && /[a-z]{2}/i.test(before);
  const bold = BOLD_RE.test(lower) || (letter && STYLE_LETTER_BOLD.test(last));
  const italic = ITALIC_RE.test(lower) || (letter && STYLE_LETTER_ITALIC.test(last));
  const fallback = String(fallbackName || '');
  const serifByName = SERIF_RE.test(lower);
  /* La réponse de pdfjs ne parle que si le nom est muet : une famille reconnue
     (« Times », « Arial ») garde ce que son nom dit. */
  const serifByClass = !serifByName && !sans && /^serif$/i.test(fallback);
  return {
    name,
    family: (letter ? words.slice(0, -1).join(' ') : name)
      .replace(/\s*(bold|black|heavy|semi ?bold|demi ?bold|extrabold|ultrabold|italic|oblique|regular|roman|normal|mt|psmt|ps|pro|std)\s*/gi, ' ').trim(),
    bold,
    italic,
    serif: !sans && (serifByName || serifByClass),
    fallback,
  };
};

/* LES POLICES DE L'APPLICATION (voir PUB_FONTS, pubCitation.js) : la famille
   lue dans le PDF est ramenée à la plus proche de la liste — c'est ce que le
   pannello sait afficher, et l'utilisateur peut en choisir une autre. */
export const pubFontOfTypeface = (face) => {
  const f = String((face && face.name) || '').toLowerCase();
  if (/garamond/.test(f)) return 'Garamond, Georgia, serif';
  if (/georgia/.test(f)) return 'Georgia, "Times New Roman", serif';
  if (/(courier|mono)/.test(f)) return '"Courier New", monospace';
  if (/segoe/.test(f)) return '"Segoe UI", Roboto, sans-serif';
  if (/(calibri|carlito)/.test(f)) return 'Calibri, Carlito, sans-serif';
  if (/verdana/.test(f)) return 'Verdana, Geneva, sans-serif';
  if (/(helv|arial|roboto|lato|open sans|futura|univers|frutiger|gill|tahoma|trebuchet)/.test(f)) return 'Arial, Helvetica, sans-serif';
  if (/(times|serif|minion|charter|palatino|cambria|baskerville|century|roman|cmr|lmr|book)/.test(f)) return '"Times New Roman", Times, serif';
  /* Le nom de la famille ne dit rien (un éditeur l'a renommée) : la classe que
     pdfjs connaît prend le relais (voir typefaceOf). */
  if (/mono/i.test(String((face && face.fallback) || ''))) return '"Courier New", monospace';
  return face && face.serif === false ? 'Arial, Helvetica, sans-serif' : '"Times New Roman", Times, serif';
};

/** UNE LIGNE, à partir des runs qui la composent : son texte, sa taille (celle
 *  du plus grand run), sa police dominante (celle qui écrit le plus de
 *  caractères) et sa géométrie. `sup` dit qu'un run en indice/exposant s'y
 *  trouve : un appel de référence en exposant est un run plus petit, fait de
 *  chiffres — c'est ainsi qu'on reconnaît un renvoi « ¹² » d'un renvoi « [12] ». */
export const lineOf = (items, fallbackY = 0) => {
  const list = (items || []).filter((it) => it && it.str !== '');
  if (!list.length) return null;
  const text = list.map((it) => it.str).join('');
  if (!text.trim()) return null;
  const sized = list.filter((it) => String(it.str).trim().length);
  const pool = sized.length ? sized : list;
  const dominant = pool.reduce((best, it) => (
    String(it.str).trim().length > String(best.str).trim().length ? it : best
  ), pool[0]);
  /* LA TAILLE DE LA LIGNE EST CELLE DE SON RUN DOMINANT — le plus de caractères —
     et non la plus grande des runs : un seul glyphe venu d'une autre police (le
     « μ » d'un « μM », un appel en exposant d'une police à part) montait la ligne
     entière à 9,4 pt alors que son texte est à 7,97, et une ligne de corps de
     texte se lisait alors « plus grosse que le corps » — donc comme un intitulé
     (mesuré sur un PDF d'Elsevier : des phrases entières de la Discussion
     entraient dans l'ordre des sections). */
  const size = Number((dominant.size || Math.max.apply(null, list.map((it) => it.size || 0))).toFixed(2));
  const x = Math.min.apply(null, list.map((it) => it.x));
  const xEnd = Math.max.apply(null, list.map((it) => it.x + (it.width || 0)));
  const sup = list.some((it) => it.size > 0 && it.size < size * 0.78
    && /\d/.test(String(it.str)) && /^[\d,\s\u2013-]{1,12}$/.test(String(it.str)));
  /* Les RUNS de la ligne, groupés par police : c'est là que se lit le caractère
     d'un morceau — le titre d'une revue en italique, son volume en gras. */
  const runs = [];
  list.forEach((it) => {
    const name = (it.face && it.face.name) || '';
    const last = runs[runs.length - 1];
    if (last && last.name === name) last.text += it.str;
    else runs.push({ name, text: String(it.str), face: it.face });
  });
  return {
    text: text.replace(/\s+/g, ' ').trim(),
    size: Number(size.toFixed(2)),
    face: dominant.face,
    x: Number(x.toFixed(2)),
    xEnd: Number(xEnd.toFixed(2)),
    y: Number((list[0].y != null ? list[0].y : fallbackY).toFixed(2)),
    sup,
    runs,
    chars: sized.reduce((n, it) => n + String(it.str).trim().length, 0),
  };
};

/** LES RUNS D'UNE PAGE → SES LIGNES, dans l'ordre de lecture.
 *  pdfjs donne un run par morceau typographique et marque la fin de ligne
 *  (`eol`) : c'est la seule coupure fiable (un paragraphe du PDF n'est pas une
 *  ligne, et une ligne n'est pas un paragraphe).
 *  Une colonne se reconnaît à sa MARGE DE GAUCHE : les revues s'impriment sur
 *  deux colonnes, et lire les lignes dans l'ordre du fichier y mélangerait la
 *  colonne de gauche et celle de droite. Les lignes pleine largeur (le titre,
 *  le résumé) restent en tête. */
export const linesOfPage = (items) => {
  const lines = [];
  let bucket = [];
  const flush = () => { const line = lineOf(bucket); if (line) lines.push(line); bucket = []; };
  (items || []).forEach((it) => {
    if (bucket.length) {
      const prev = bucket[bucket.length - 1];
      /* Même ligne = même hauteur ET le texte avance : `eol` n'est PAS exigé —
         beaucoup de PDF marquent une fin de ligne à chaque opérateur de texte, et
         un run posé à la main (un appel de référence en exposant) y serait coupé
         de sa phrase. Un vrai passage à la ligne descend (y plus petit), un saut
         de colonne recule (x plus petit) : les deux sont déjà écartés. */
      /* LA TOLÉRANCE SE MESURE SUR LE PLUS GRAND DES DEUX RUNS, pas sur le plus
         petit : un marqueur d'affiliation posé EN EXPOSANT (« Walrant a,b ») monte
         de ~0,45 fois la taille de la ligne, donc au-delà de la tolérance d'un
         petit run — et la ligne d'auteurs d'un PDF d'Elsevier se coupait alors en
         trois « lignes », ce qui faisait lire la mauvaise taille d'auteurs (8 pt
         au lieu de 11 pt, mesuré). Un vrai interligne, lui, vaut plus d'une fois
         la taille du texte : la marge reste donc franche. */
      const sameLine = Math.abs((it.y || 0) - (prev.y || 0))
        <= Math.max(1.5, Math.max(it.size || 0, prev.size || 0) * 0.45)
        && (it.x || 0) >= (prev.x || 0) - 1;
      if (!sameLine) flush();
    }
    bucket.push(it);
    if (it.eol) flush();
  });
  flush();

  const wide = lines.filter((l) => l.chars >= 40);
  const span = lines.reduce((m, l) => Math.max(m, l.xEnd), 0) - lines.reduce((m, l) => Math.min(m, l.x), Infinity);
  const edges = new Map();
  wide.forEach((l) => { const k = Math.round(l.x / 5) * 5; edges.set(k, (edges.get(k) || 0) + 1); });
  const ranked = Array.from(edges.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const left = ranked.length ? ranked[0][0] : 0;
  const second = ranked.slice(1).find(([k, n]) => (k - left) > span * 0.2 && n >= Math.max(3, wide.length * 0.15));
  const two = !!second;
  lines.forEach((l) => {
    l.full = (l.xEnd - l.x) > span * 0.75;
    l.column = (!two || l.full) ? 0 : (l.x >= second[0] - 6 ? 1 : 0);
  });
  const sorted = lines.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  if (!two) return sorted;
  const firstColumn = sorted.find((l) => !l.full);
  const top = firstColumn ? sorted.filter((l) => l.full && l.y >= firstColumn.y) : [];
  const rest = sorted.filter((l) => top.indexOf(l) === -1);
  return top.concat(rest.filter((l) => l.column === 0), rest.filter((l) => l.column === 1));
};

/** Le fichier (File, Blob, ArrayBuffer, Uint8Array, URL) en octets pour pdfjs. */
const toBytes = async (source) => {
  if (!source) throw new Error('No PDF given');
  if (typeof source === 'string') {
    const res = await fetch(source);
    if (!res || !res.ok) throw new Error('Cannot read ' + source);
    return new Uint8Array(await res.arrayBuffer());
  }
  if (typeof ArrayBuffer !== 'undefined' && source instanceof ArrayBuffer) return new Uint8Array(source);
  if (source.buffer instanceof ArrayBuffer && source.byteLength != null) {
    const off = source.byteOffset || 0;
    return new Uint8Array(source.buffer.slice(off, off + source.byteLength));
  }
  if (typeof source.arrayBuffer === 'function') return new Uint8Array(await source.arrayBuffer());
  throw new Error('Unsupported PDF source');
};

/** LA LECTURE : les lignes de chaque page, avec leur typeface.
 *
 *  `maxPages` borne le travail : la mise en forme d'une revue se lit sur les
 *  premières pages (les sections, leurs intitulés, le caractère de chacune) et
 *  la liste des références est prise à la fin du document, donc les deux
 *  extrémités suffisent — un PDF de 40 pages n'a pas besoin d'être lu en entier,
 *  et `truncated` le dit à l'appelant (le détecteur le signale).
 *
 *  Ne lève jamais pour un PDF illisible : l'erreur remonte (le pannello
 *  l'affiche), mais rien n'est inventé. */
export const pdfTextLines = async (source, { maxPages = 10 } = {}) => {
  const pdfjs = await loadPdfjs();
  const data = await toBytes(source);
  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    disableFontFace: true,
    /* Les polices standard de pdfjs (voir standardFontDataUrlOf) : sans elles un
       PDF qui cite « Times-Roman » sans l'embarquer perd la largeur de ses
       glyphes, donc l'étendue de ses lignes. */
    ...(standardFontDataUrl ? { standardFontDataUrl } : null),
  }).promise;
  const total = doc.numPages || 0;
  const limit = Math.min(total, Math.max(1, maxPages));
  const pages = [];
  for (let p = 1; p <= limit; p++) {
    const page = await doc.getPage(p);
    /* getOperatorList remplit les objets de police de la page : sans lui,
       `commonObjs` ne connaît pas encore les fontName des items de texte et la
       famille resterait un identifiant interne (« g_d0_f1 »). */
    try { await page.getOperatorList(); } catch { /* la famille reste l'id */ }
    const view = page.getViewport({ scale: 1 });
    const faces = new Map();
    const faceOf = (id) => {
      const key = String(id || '');
      if (!faces.has(key)) {
        let name = key;
        let fallback = '';
        try {
          const store = page.commonObjs;
          const f = store && typeof store.get === 'function' && (typeof store.has !== 'function' || store.has(key))
            ? store.get(key)
            : (page.objs && typeof page.objs.get === 'function' ? page.objs.get(key) : null);
          if (f) {
            name = f.name || f.fallbackName || name;
            /* Ce que pdfjs dit de la POLICE elle-même (voir typefaceOf) : la
               famille peut être renommée par l'éditeur, mais pdfjs garde la classe
               de la police d'origine (« serif », « sans-serif »). */
            fallback = f.fallbackName || '';
          }
        } catch { /* l'identifiant, alors */ }
        faces.set(key, typefaceOf(name, fallback));
      }
      return faces.get(key);
    };
    const content = await page.getTextContent();
    const items = (content.items || []).map((it) => {
      const t = it.transform || [1, 0, 0, 1, 0, 0];
      const size = Math.hypot(t[2], t[3]) || Math.abs(t[3]) || Math.abs(t[0]) || 10;
      return {
        str: String(it.str == null ? '' : it.str),
        x: t[4], y: t[5], width: it.width || 0, size,
        eol: !!it.hasEOL, face: faceOf(it.fontName),
      };
    }).filter((it) => it.str !== '');
    pages.push({ page: p, width: view.width, height: view.height, lines: linesOfPage(items) });
  }
  try { doc.destroy(); } catch { /* déjà fermé */ }
  return { pages, pageCount: total, truncated: total > pages.length };
};
