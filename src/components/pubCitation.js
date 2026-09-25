// src/components/pubCitation.js
/* =========================================================================
   PUBLICATION FORMAT — how a publication citation is rendered: order of the
   fields, style of each field, presence/absence of each field, and presets
   reproducing the reference formats of important journals.

   Kept in this React-free module so that (a) the engine can be checked by node
   (see _pub_author_style_test.mjs) and (b) both consumers share one renderer:
     • PublicationsSection → the « Formatted citation » of every paper;
     • projectDetailModule → the « References » of a project document.

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

/* LA FORME DES RENVOIS DANS LE TEXTE (« come appaiono I riferimenti
   bibliografici nel testo »). Le choix est stocké dans le format lui-même
   (`format.inTextStyle`) et appliqué partout où un renvoi s'affiche : le
   document du projet, sa version imprimée, son PDF et son export (voir
   applyInTextStyle dans utils/referenceLinks.js).
     • « keep »  — le renvoi garde l'écriture du document (¹², [12], (12)) ;
     • « sup »   — exposant, la forme de Nature / Science ;
     • « bracket » — crochets, la forme de Paperpile / Zotero ;
     • « paren »  — parenthèses, la forme d'EndNote / Word ;
     • « author-date » — le nom des auteurs et l'année, la forme APA / Harvard. */
export const IN_TEXT_STYLES = [
  { id: 'keep', label: 'as written', title: 'Keep the citation as the document wrote it (¹², [12], (12)) — nothing is rewritten' },
  { id: 'sup', label: 'Superscript', title: 'Exponent — “as shown previously¹²” (Nature, Science…)' },
  { id: 'bracket', label: 'Square brackets', title: 'Square brackets — “as shown previously [12]” (Paperpile, Zotero…)' },
  { id: 'paren', label: 'Parentheses', title: 'Parentheses — “as shown previously (12)” (EndNote / Word)' },
  { id: 'author-date', label: 'Author + year', title: 'Author and year — “as shown previously (Rossi & Bianchi, 2018)” (APA, Harvard…)' }
];
export const IN_TEXT_STYLE_IDS = IN_TEXT_STYLES.map((s) => s.id);

/** Une forme de renvoi inconnue (localStorage, document d'un autre poste) vaut
 *  « keep » : le renvoi garde l'écriture du document, rien n'est inventé. */
export const normalizeInTextStyle = (value) =>
  (IN_TEXT_STYLE_IDS.includes(value) ? value : 'keep');

/* ── LA MISE EN FORME DU DOCUMENT D'UN PROJET ───────────────────────────────

   « nella parte publication format, si può implementare il formato del testo
   per le varie sezioni? vorrei poter scegliere font, police, posizione
   (giustificato, centrato, a sinistra, a destra), stile (grassetto, corsivo,
   sottolineato), colore. Per le figure vorrei poter scegliere le stesse cose.
   Una volta implementate nel publication format dovrebbero applicarsi al
   progetto, come è adesso per le citazioni. »

   C'est exactement le même principe que la forme des renvois (`inTextStyle`) :
   le choix vit DANS le format (`format.layout`), il ne réécrit jamais le texte
   de l'auteur, et il est appliqué à l'AFFICHAGE — la page du projet, le
   document imprimé et son PDF — par `pubLayoutCss` (la feuille de style du
   document, voir projectDetailModule). Changer le format change donc tout de
   suite ce que le projet montre, document figé compris, et un projet qui a sa
   PROPRE copie du format (`project.pubFormat`) garde la sienne.

   Chaque PARTIE du document a ses réglages — les mêmes qu'une feuille de styles
   de traitement de texte : titre, auteurs, affiliations, intitulés de section,
   texte des sections, figures et légendes, bibliographie. Un réglage absent
   (« As in the app », taille vide, style non touché) ne produit AUCUNE règle :
   sans choix de l'utilisateur, le document s'affiche comme avant. */

export const PUB_TEXT_ALIGNMENTS = [
  { id: 'left', label: 'Left', title: 'Align this part to the left' },
  { id: 'center', label: 'Center', title: 'Centre this part' },
  { id: 'right', label: 'Right', title: 'Align this part to the right' },
  { id: 'justify', label: 'Justified', title: 'Justify this part (both margins)' }
];
export const PUB_ALIGNMENT_IDS = PUB_TEXT_ALIGNMENTS.map((a) => a.id);

/* Les polices proposées : des familles que tout poste a déjà (aucun
   téléchargement, aucun appel réseau — le document s'imprime et s'exporte
   partout pareil). « As in the app » = aucune règle écrite, on garde la police
   du programme. */
export const PUB_FONTS = [
  { id: '', label: 'As in the app' },
  { id: 'Georgia, "Times New Roman", serif', label: 'Georgia' },
  { id: '"Times New Roman", Times, serif', label: 'Times New Roman' },
  { id: 'Garamond, Georgia, serif', label: 'Garamond' },
  { id: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { id: 'Helvetica, Arial, sans-serif', label: 'Helvetica' },
  { id: '"Segoe UI", Roboto, sans-serif', label: 'Segoe UI' },
  { id: 'Calibri, Carlito, sans-serif', label: 'Calibri' },
  { id: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
  { id: '"Courier New", monospace', label: 'Courier New' }
];

/* Les parties du document, dans l'ordre où elles s'impriment. `selectors` = ce
   que la feuille de style vise : une CLASSE que le programme pose lui-même
   (`.pf-…`, toujours présente dans le document vivant) et, en repli, la BALISE
   du document — un document figé avant cette version n'a pas les classes, la
   balise le rattrape. `caption` (figures seulement) = la légende, et `width` =
   la largeur de l'image (pourcentage de la colonne). */
export const PUB_LAYOUT_PARTS = [
  { id: 'title', label: 'Title', selectors: ['.pf-title', 'h1'] },
  { id: 'authors', label: 'Authors', selectors: ['.pf-authors'] },
  { id: 'affiliations', label: 'Affiliations', selectors: ['.pf-affiliations'] },
  { id: 'heading', label: 'Section headings', selectors: ['.pf-heading', 'h2'] },
  {
    id: 'body',
    label: 'Section text',
    /* Le texte d'une section : ses paragraphes, où qu'ils soient (le HTML d'un
       manuscrit importé n'a pas de classe), plus le cadre `.pf-body` pour ce qui
       HÉRITE de la mise en forme. Les lignes de l'en-tête, la ligne
       d'information et les légendes de figure sont EXCLUES : elles ont leur
       propre partie. */
    selectors: ['.pf-body',
      'p:not(.pf-authors):not(.pf-affiliations):not(.pf-meta):not(.pf-caption)']
  },
  {
    id: 'figure',
    label: 'Figures & captions',
    selectors: ['.pf-figure', 'figure'],
    caption: ['.pf-caption', 'figcaption'],
    width: true
  },
  { id: 'bibliography', label: 'References', selectors: ['.pf-bib', '.pf-bib li'] }
];
export const PUB_LAYOUT_PART_IDS = PUB_LAYOUT_PARTS.map((p) => p.id);

/* ══ LES BLOCS DU DOCUMENT D'UN PROJET, DANS L'ORDRE OÙ ILS S'IMPRIMENT ══════
   La demande : « In the publication format I cannot change the order of the sections
   nor change the titles of the subsections. I want to be able for example to put the
   author before the title or change the name of “materials and methods” into
   “experimental section” or whatever. »

   Le document d'un projet est une SUITE DE BLOCS — le titre, les auteurs, les
   affiliations, la ligne d'information, les sections de texte de l'auteur,
   « Materials and Methods », « Experiments », « References » — écrits jusqu'ici dans un
   ordre FIXE par la page du projet (components/AppModules/projectDetailModule.jsx).
   Ce format les NOMME, pour que
     • l'ORDRE soit réglable (▲▼ du panneau « Publication format ») → `docOrder` ;
     • l'INTITULÉ d'un bloc qui en porte un soit réglable → `docTitles` : c'est le seul
       texte du document que le programme écrit lui-même (« Materials and Methods »,
       « Experiments », « References ») — jamais celui de l'auteur, qui garde ses
       propres intitulés de sections.
   Un bloc sans intitulé propre (le titre de l'article EST le titre, les auteurs et les
   affiliations sont du texte, la ligne d'information aussi) n'en porte pas : la liste
   le dit (`titled: false`) et le panneau n'affiche alors qu'une explication.
   `fixed: true` = le bloc ne se déplace pas : la liste VIVANTE des références du projet
   est imprimée à la fin du document (elle est rendue hors du texte, pour suivre le
   format courant — voir projectDetailModule.jsx) ; son intitulé, lui, se règle. */
export const PUB_DOC_BLOCKS = [
  { id: 'title', label: 'Title', hint: 'the paper title (or the folder name)' },
  { id: 'authors', label: 'Authors', hint: 'the author line' },
  { id: 'affiliations', label: 'Affiliations', hint: 'the affiliations line' },
  { id: 'meta', label: 'Project line', hint: 'project · scientist · date' },
  { id: 'sections', label: 'Text sections', hint: 'your text sections, in the order you wrote them' },
  { id: 'methods', label: 'Materials and Methods', titled: true, title: 'Materials and Methods' },
  { id: 'experiments', label: 'Experiments', titled: true, title: 'Experiments' },
  { id: 'references', label: 'References', titled: true, title: 'References', fixed: true }
];
export const PUB_DOC_BLOCK_IDS = PUB_DOC_BLOCKS.map((b) => b.id);
// Les blocs dont le programme écrit l'intitulé, et les blocs qui ne se déplacent pas.
export const PUB_DOC_TITLED_IDS = PUB_DOC_BLOCKS.filter((b) => b.titled).map((b) => b.id);
export const PUB_DOC_FIXED_IDS = PUB_DOC_BLOCKS.filter((b) => b.fixed).map((b) => b.id);
export const pubDocBlockOf = (id) => PUB_DOC_BLOCKS.find((b) => b.id === id) || null;

/** L'ordre du programme : celui que la page du projet a toujours suivi. */
export const buildPubDocOrder = () => PUB_DOC_BLOCK_IDS.slice();

/** Un ordre relu d'un enregistrement (localStorage, document d'un autre poste, copie
 *  d'un projet) : seuls les blocs CONNUS et sans doublon passent, et tout bloc que
 *  l'ordre oublie est REMIS À SA PLACE du programme — un format écrit avant cette
 *  version (ou à la main) ne peut donc pas faire disparaître une section. */
export const normalizePubDocOrder = (raw) => {
  const out = [];
  (Array.isArray(raw) ? raw : []).forEach((id) => {
    const key = String(id || '');
    if (PUB_DOC_BLOCK_IDS.includes(key) && !out.includes(key)) out.push(key);
  });
  PUB_DOC_BLOCK_IDS.forEach((id) => { if (!out.includes(id)) out.push(id); });
  return out;
};

/** Les intitulés du programme, tels qu'ils sont écrits aujourd'hui. */
export const buildPubDocTitles = () => {
  const out = {};
  PUB_DOC_BLOCKS.forEach((b) => { if (b.titled) out[b.id] = b.title; });
  return out;
};

/** Les intitulés relus : du TEXTE, jamais du HTML (`<` et `>` sont retirés — un titre
 *  de section ne peut pas apporter de balise au document), coupé à 120 caractères. Une
 *  chaîne vide = « l'intitulé du programme » (voir pubDocTitleOf). */
export const normalizePubDocTitles = (raw) => {
  const out = buildPubDocTitles();
  if (!raw || typeof raw !== 'object') return out;
  PUB_DOC_TITLED_IDS.forEach((id) => {
    const v = raw[id];
    if (typeof v === 'string') out[id] = v.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  });
  return out;
};

/** L'intitulé que le document écrit pour un bloc : celui choisi par l'utilisateur, ou
 *  celui du programme quand il est vide (ou quand le bloc n'en porte pas). */
export const pubDocTitleOf = (titles, id) => {
  const block = pubDocBlockOf(id);
  if (!block || !block.titled) return '';
  const own = titles && typeof titles === 'object' ? titles[id] : '';
  const text = typeof own === 'string' ? own.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim() : '';
  return text || block.title;
};

/** Un bloc déplacé d'un cran (▲▼ du panneau). Un bloc FIXE ne bouge pas, un cran hors
 *  de la liste ne fait rien : l'ordre rendu est toujours l'ordre normalisé. */
export const pubDocOrderMoved = (order, id, dir) => {
  const list = normalizePubDocOrder(order);
  if (PUB_DOC_FIXED_IDS.includes(id)) return list;
  const i = list.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const tmp = list[i];
  list[i] = list[j];
  list[j] = tmp;
  return list;
};

/* Les mots avec lesquels un DOCUMENT écrit nomme les blocs dont le programme écrit
   l'intitulé : « Materials and Methods » se lit « Methods » chez Nature, et un
   manuscrit importé peut l'avoir écrit « Experimental part » · « Experimental
   procedures ». Ce sont ces mots que reorderDocHtml reconnaît (voir son troisième
   argument), donc ceux qui doivent porter le titre choisi par l'utilisateur. */
const DOC_TITLE_KEYWORDS = [
  ['methods', ['materials and methods', 'methods', 'experimental part', 'experimental procedures']],
  ['experiments', ['experiments']],
  ['references', ['references', 'bibliography']]
];

/** LES TITRES CHOISIS, PRÊTS POUR `reorderDocHtml(html, order, titles)` : mot du
 *  document → titre à lire. Un intitulé laissé au programme n'y est PAS (le document
 *  écrit déjà le sien) : seuls les titres VRAIMENT choisis se propagent au texte déjà
 *  écrit — un document figé avant le changement de nom suit donc le nouveau titre. */
export const pubDocTitleKeywords = (fmt) => {
  const titles = normalizePubDocTitles(fmt && fmt.docTitles);
  const out = {};
  DOC_TITLE_KEYWORDS.forEach(([id, words]) => {
    const block = pubDocBlockOf(id);
    if (!block || !block.titled) return;
    const text = pubDocTitleOf(titles, id);
    if (!text || text.toLowerCase() === String(block.title).toLowerCase()) return;
    words.forEach((w) => { out[w] = text; });
  });
  return out;
};

/** Un réglage vierge : aucun style imposé, le document s'affiche comme avant.
 *  `bold` / `italic` / `underline` sont à TROIS états — `null` = laissé tel
 *  quel, `true` = imposé, `false` = explicitement retiré (utile pour un titre,
 *  que le programme écrit en gras). */
export const emptyPubTextStyle = () => ({
  font: '', size: 0, align: '', bold: null, italic: null, underline: null, color: ''
});

/** Les réglages d'un format neuf : une entrée vierge par partie du document. */
export const buildPubLayout = () => {
  const out = {};
  PUB_LAYOUT_PARTS.forEach((part) => {
    out[part.id] = { ...emptyPubTextStyle(), ...(part.width ? { width: 100 } : {}) };
  });
  return out;
};

/* Les valeurs d'un format enregistré (localStorage, document d'un autre poste,
   copie d'un projet) sont NETTOYÉES avant de devenir une feuille de style :
   seule une valeur connue passe. Une police ne peut pas apporter de CSS (ni
   « ; », ni « { »), une taille reste entre 4 et 96 pt, une couleur est un code
   #rrggbb, un alignement est dans la liste, un style est vrai / faux / non
   touché, une largeur reste entre 10 et 100 %. */
const cleanPubFont = (v) => String(v || '').replace(/[^\w\s,"'.-]/g, '').trim().slice(0, 120);
const cleanPubSize = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 4 && n <= 96 ? Math.round(n * 10) / 10 : 0;
};
const cleanPubAlign = (v) => (PUB_ALIGNMENT_IDS.includes(v) ? v : '');
const cleanPubColor = (v) => {
  const s = String(v || '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(s) ? s : '';
};
const cleanPubTri = (v) => {
  if (v === true || v === false) return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
};
const cleanPubWidth = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 10 && n <= 100 ? Math.round(n) : 100;
};

const cleanPubTextStyle = (raw, { width = false } = {}) => {
  const st = raw && typeof raw === 'object' ? raw : {};
  return {
    font: cleanPubFont(st.font),
    size: cleanPubSize(st.size),
    align: cleanPubAlign(st.align),
    bold: cleanPubTri(st.bold),
    italic: cleanPubTri(st.italic),
    underline: cleanPubTri(st.underline),
    color: cleanPubColor(st.color),
    ...(width ? { width: cleanPubWidth(st.width) } : {})
  };
};

/** La mise en forme d'un format, telle qu'elle est relue d'un enregistrement :
 *  chaque partie connue est gardée, tout le reste est ignoré. Un format sans
 *  mise en forme (enregistré avant cette version) donne les réglages vierges —
 *  le document d'un projet ne change donc pas tout seul. */
export const normalizePubLayout = (raw) => {
  const out = buildPubLayout();
  PUB_LAYOUT_PARTS.forEach((part) => {
    out[part.id] = cleanPubTextStyle(raw && raw[part.id], { width: !!part.width });
  });
  return out;
};

/** Cette partie a-t-elle un réglage ? (badge « ✎ » du panneau, tests). */
export const pubTextStyleIsSet = (style) => !!style && (
  !!style.font || Number(style.size) > 0 || !!style.align
  || style.bold !== null || style.italic !== null || style.underline !== null
  || !!style.color || (Number(style.width) > 0 && Number(style.width) !== 100)
);

const cssTri = (value, on, off) => {
  if (value === true) return `${on} !important;`;
  if (value === false) return `${off} !important;`;
  return '';
};

/** Les déclarations d'une partie : chaque réglage CHOISI devient une règle,
 *  `!important` compris — le choix de l'utilisateur doit passer devant la
 *  feuille du programme et devant le style en ligne d'une figure importée d'un
 *  .docx. Un réglage vide n'écrit rien du tout. */
const pubTextStyleCss = (style) => {
  const st = style || {};
  const out = [];
  if (st.font) out.push(`font-family: ${st.font} !important;`);
  if (Number(st.size) > 0) out.push(`font-size: ${Number(st.size)}pt !important;`);
  if (st.align) out.push(`text-align: ${st.align} !important;`);
  const b = cssTri(st.bold, 'font-weight: 700', 'font-weight: 400');
  if (b) out.push(b);
  const i = cssTri(st.italic, 'font-style: italic', 'font-style: normal');
  if (i) out.push(i);
  const u = cssTri(st.underline, 'text-decoration: underline', 'text-decoration: none');
  if (u) out.push(u);
  if (st.color) out.push(`color: ${st.color} !important;`);
  return out.join(' ');
};

/**
 * LA FEUILLE DE STYLE DU DOCUMENT D'UN PROJET, écrite d'après le « Publication
 * format ». Rien n'est écrit pour un format sans mise en forme : la feuille est
 * alors VIDE et le document s'affiche exactement comme avant.
 *
 * Toutes les règles sont portées par le conteneur du document
 * (`#project-doc-container`) : elles valent donc pour le document affiché, pour
 * le document FIGÉ (le texte enregistré, rendu dans le même conteneur) et pour
 * la page imprimée de l'export, qui remet ce même conteneur (voir
 * projectDetailModule). Les parties du document y sont repérées par les classes
 * `.pf-…` que le programme pose lui-même, et par leur balise en repli.
 *
 * @param {object} fmt    le « Publication format » (project.pubFormat ou défaut)
 * @param {string} [scope] sélecteur du conteneur (défaut #project-doc-container)
 * @returns {string} le CSS (chaîne vide quand rien n'a été choisi)
 */
export const pubLayoutCss = (fmt, scope = '#project-doc-container') => {
  const layout = normalizePubLayout(fmt && fmt.layout);
  const rules = [];
  const rule = (selectors, body) => {
    if (!body) return;
    const list = (selectors || []).filter(Boolean).map((s) => `${scope} ${s}`).join(', ');
    if (list) rules.push(`${list} { ${body} }`);
  };
  PUB_LAYOUT_PARTS.forEach((part) => {
    const st = layout[part.id];
    if (part.id === 'figure') {
      /* LA FIGURE : l'alignement va au cadre (la figure se place à gauche, au
         centre…), la largeur à l'IMAGE — et tout le reste à la LÉGENDE, le seul
         texte d'une figure. */
      if (st.align) rule(part.selectors, `text-align: ${st.align} !important;`);
      if (Number(st.width) > 0 && Number(st.width) !== 100) {
        rule([...(part.selectors || []), ...(part.caption || [])].map((s) => `${s} img`),
          `width: ${Number(st.width)}% !important;`);
      }
      rule(part.caption, pubTextStyleCss(st));
      return;
    }
    rule(part.selectors, pubTextStyleCss(st));
  });
  return rules.join('\n');
};

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
    inTextStyle: 'keep',            // in-text citation form (see IN_TEXT_STYLES)
    layout: buildPubLayout(),       // font / size / align / style / colour of each part (see pubLayoutCss)
    docOrder: buildPubDocOrder(),   // the blocks of the project document, in the order they print (see PUB_DOC_BLOCKS)
    docTitles: buildPubDocTitles(), // the headings the PROGRAM writes for them (« Materials and Methods » → the user's name)
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
    inTextStyle: normalizeInTextStyle(parsed && parsed.inTextStyle),
    layout: normalizePubLayout(parsed && parsed.layout),
    docOrder: normalizePubDocOrder(parsed && parsed.docOrder),
    docTitles: normalizePubDocTitles(parsed && parsed.docTitles),
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
