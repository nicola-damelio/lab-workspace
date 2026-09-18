/* =========================================================================
   src/utils/figurePlacement.js
   REMET une figure À SA PLACE dans le document exporté.

   Les figures d'un manuscrit importé ne sont pas écrites dans le texte de la
   section (voir utils/manuscriptImport.js) : elles sont rangées dans les
   FIGURES de la section du projet — `project.figures[section]`, la même liste
   que « 📤 Insert into project… » de l'Image Builder remplit — et chaque
   figure garde l'ANCRE du paragraphe qui la précédait dans l'article. Au
   moment d'exporter, la figure est réinsérée dans le texte JUSTE APRÈS le bloc
   qui contient cette ancre : elle réapparaît donc là où elle était dans le
   manuscrit, sans avoir jamais été figée dans le texte éditable.

   Une ancre introuvable (paragraphe réécrit depuis l'import) n'empêche rien :
   la figure est alors imprimée APRÈS la section, comme une figure ajoutée à la
   main. Rien n'est jamais perdu.

   La figure se pose à la fin du BLOC de son ancre (`</p>`, `</li>`…) ou, quand
   la section n'en a aucun, à la fin de la LIGNE (voir LINE_END_RE /
   blockEndAfter) : c'est ce repli qui remet à leur place les figures d'un
   document importé avant le 17/09/2026, dont les sections sont des lignes nues.

   Tout est PUR (aucun DOM, aucun React) : la page projet s'en sert à l'export
   et le test _figure_placement_test.mjs vérifie exactement le même code.
   ========================================================================= */

const TEXT_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

/** Échappe du TEXTE pour du HTML (le contenu d'un `<figcaption>`). */
export const escapeFigureText = (s) => String(s ?? '').replace(/[&<>]/g, (c) => TEXT_ESCAPES[c]);

/** Échappe une VALEUR d'attribut (le guillemet doit en sortir). */
export const escapeFigureAttr = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** La fin d'un bloc (un élément de niveau bloc) — la figure s'insère après. */
const BLOCK_CLOSE_RE = /<\/(?:p|div|li|h[1-6]|figure|figcaption|table|blockquote|section|article|td|th|dd|dt|pre)\s*>/gi;

/** La fin d'une LIGNE : un vrai saut de ligne, ou le `<br>` qui le remplace à
 *  l'écran. C'est le repère de REPLI quand la section n'a aucun élément de
 *  niveau bloc — le cas des sections écrites par l'import d'un manuscrit
 *  jusqu'au 17/09/2026 : `htmlFromManuscriptPart` y mettait ses paragraphes
 *  côte à côte séparés par « \n », sans `<p>`. Le texte S'AFFICHAIT donc collé
 *  (le HTML avale les sauts de ligne) et, comme aucun `</p>` ne suivait
 *  l'ancre, TOUTES les figures du document partaient à la fin de la section —
 *  la plainte « avant, les figures étaient à leur place » (voir
 *  _figure_placement_test.mjs, « section héritée »). */
const LINE_END_RE = /(?:\n|<br\b[^>]*>)/gi;

/** La fin de la ligne qui contient la position `from` (-1 = fin du texte). */
const lineEndAfter = (html, from) => {
  LINE_END_RE.lastIndex = from;
  const m = LINE_END_RE.exec(html);
  return m ? m.index + m[0].length : -1;
};

/** Les zones de TEXTE d'un HTML, dans l'ordre, avec leur position d'origine.
 *  Chercher l'ancre sur ce texte (et non sur le HTML brut) est indispensable :
 *  le « [12] » du manuscrit est devenu `[<a …>12</a>]` dans la section, et
 *  l'ancre reste alors trouvable. */
const textRunsOf = (html) => {
  const runs = [];
  let plain = '';
  let last = 0;
  const re = /<[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m.index > last) {
      const text = html.slice(last, m.index);
      runs.push({ at: last, text });
      plain += text;
    }
    last = m.index + m[0].length;
  }
  if (last < html.length) {
    const text = html.slice(last);
    runs.push({ at: last, text });
    plain += text;
  }
  return { runs, plain };
};

/** La position du TEXTE `plainIndex` dans le HTML d'origine. */
const htmlIndexOfPlain = (runs, plainIndex) => {
  let acc = 0;
  for (const r of runs) {
    if (plainIndex <= acc + r.text.length) return r.at + (plainIndex - acc);
    acc += r.text.length;
  }
  return -1;
};

/* Le curseur de recherche se garde en coordonnées TEXTE (voir
   findFigureAnchor) : c'est ce qui laisse deux figures partager une ancre. */


/** La fin du bloc qui contient la position `from` (une ancre est toujours dans
 *  un paragraphe : la figure s'insère derrière ce paragraphe entier).
 *
 *  DEUX REPÈRES, le plus PROCHE des deux : la balise qui ferme le bloc
 *  (`</p>`, `</li>`…) et la fin de la ligne (`\n`, `<br>`). Le second est ce
 *  qui remet une figure à sa place dans une section SANS balises de bloc (voir
 *  LINE_END_RE) : sans lui, `blockEndAfter` rendait la fin de la section et
 *  toutes les figures s'y empilaient. */
const blockEndAfter = (html, from) => {
  BLOCK_CLOSE_RE.lastIndex = from;
  const m = BLOCK_CLOSE_RE.exec(html);
  const blockEnd = m ? m.index + m[0].length : -1;
  const lineEnd = lineEndAfter(html, from);
  if (blockEnd === -1) return lineEnd === -1 ? html.length : lineEnd;
  if (lineEnd === -1) return blockEnd;
  return Math.min(blockEnd, lineEnd);
};

/** Le DÉBUT de l'ancre suffit : la fin du paragraphe a pu changer (un lien de
 *  citation, une correction). Assez long pour rester unique. */
const ANCHOR_PROBE = 48;

/** Trouve l'ANCRE d'une figure dans un HTML.
 *  @returns {{ plainAt:number, insertAt:number }|null} `plainAt` = position de
 *           l'ancre dans le TEXTE (la recherche suivante repart de là, ce qui
 *           laisse deux figures partager un même paragraphe) et `insertAt` =
 *           position d'insertion dans le HTML. */
export const findFigureAnchor = (html, anchor, plainFrom = 0) => {
  const full = String(anchor || '').trim();
  if (!full || !html) return null;
  const text = String(html);
  const { runs, plain } = textRunsOf(text);
  const probe = full.length > ANCHOR_PROBE ? full.slice(0, ANCHOR_PROBE) : full;
  /* L'ancre vient du TEXTE du document : dans le HTML elle a pu être échappée
     (« & » → « &amp; »). */
  const candidates = [...new Set([probe, escapeFigureText(probe), full, escapeFigureText(full)])];
  for (const needle of candidates) {
    const at = plain.indexOf(needle, Math.max(0, plainFrom || 0));
    if (at === -1) continue;
    const htmlAt = htmlIndexOfPlain(runs, at + needle.length);
    if (htmlAt === -1) continue;
    return { plainAt: at, insertAt: blockEndAfter(text, htmlAt) };
  }
  return null;
};

/** Où insérer la figure dont l'ancre est ce paragraphe ?
 *  @returns {number} la position d'insertion dans `html` (-1 = ancre
 *                    introuvable : la figure sera imprimée après la section) */
export const figureInsertIndex = (html, anchor, plainFrom = 0) => {
  const found = findFigureAnchor(html, anchor, plainFrom);
  return found ? found.insertAt : -1;
};

/** Le HTML d'une figure — mêmes balises que les figures ajoutées à la main, et
 *  déjà prévues par la feuille de style du document exporté (`figure`,
 *  `figcaption`, `page-break-inside: avoid`). */
export const figureHtml = (fig) => {
  const f = fig || {};
  const src = String(f.url || '').trim();
  if (!src) return '';
  const caption = String(f.caption || '').trim();
  const img = `<img src="${escapeFigureAttr(src)}" alt="${escapeFigureAttr(caption || 'figure')}"`
    + ' style="display:block;margin:0 auto;max-width:100%;height:auto;border:1px solid #e2e8f0;'
    + 'border-radius:8px;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,0.08);"/>';
  const cap = caption
    ? `<figcaption style="font-size:12px;color:#475569;margin-top:4px;">${escapeFigureText(caption)}</figcaption>`
    : '';
  return `<figure style="margin:14px 0;text-align:center;break-inside:avoid;">${img}${cap}</figure>`;
};

/** Le HTML d'une section AVEC ses figures à leur place.
 *  @returns {{ html:string, rest:Array, placed:Array }}
 *           `rest` = les figures dont l'ancre est introuvable : l'appelant les
 *           affiche après la section (rendu habituel des figures de section). */
export const splitAnchoredFigures = (html, figures) => {
  const source = String(html || '');
  const rest = [];
  const placed = [];
  /* Les insertions sont calculées sur le HTML D'ORIGINE (les positions ne
     bougent pas), puis appliquées de gauche à droite : deux figures qui
     partagent le même paragraphe d'ancre restent donc dans l'ordre. */
  const slots = new Map();
  let plainCursor = 0;
  (Array.isArray(figures) ? figures : []).forEach((fig) => {
    if (!fig) return;
    const markup = figureHtml(fig);
    const anchor = String(fig.anchor || '').trim();
    if (!markup || !anchor) { rest.push(fig); return; }
    const found = findFigureAnchor(source, anchor, plainCursor);
    if (!found) { rest.push(fig); return; }
    slots.set(found.insertAt, [...(slots.get(found.insertAt) || []), markup]);
    placed.push(fig);
    /* La recherche suivante repart de CETTE ancre : une figure qui suit
       immédiatement une autre (panneaux a et b d'une même légende) se pose
       derrière elle. */
    plainCursor = found.plainAt;
  });
  let out = source;
  let shift = 0;
  [...slots.keys()].sort((a, b) => a - b).forEach((at) => {
    const chunk = slots.get(at).join('');
    out = out.slice(0, at + shift) + chunk + out.slice(at + shift);
    shift += chunk.length;
  });
  return { html: out, rest, placed };
};

/** Combien de figures ont une ancre (donc une place à retrouver dans le
 *  texte) — utilisé par l'aperçu de l'import. */
export const anchoredFigureCount = (figures) => (Array.isArray(figures) ? figures : [])
  .filter((f) => f && String(f.anchor || '').trim()).length;

/* ── DÉPLACER UNE FIGURE (le glisser-déposer de la page projet) ─────────────
   L'ORDRE de `project.figures[section]` est celui dans lequel le document
   exporté imprime les figures de la section (voir splitAnchoredFigures : les
   figures ancrées reprennent leur place dans le texte, celles qui suivent
   s'impriment dans cet ordre). C'est donc cette liste que la souris réécrit
   quand on fait glisser une figure — dans sa section, ou vers une autre. */

/** Le déplacement demandé, appliqué aux listes de figures d'un projet.
 *  @param {object} lists  `project.figures` : `{ section: [figures] }`
 *  @param {object} move   `{ from, to, id, before }` — `from`/`to` = section
 *                         d'origine / d'arrivée, `id` = la figure déplacée,
 *                         `before` = la figure DEVANT laquelle elle se pose
 *                         ('' = à la fin de la liste d'arrivée)
 *  @returns {object} les listes d'après déplacement. Rien n'est modifié sur
 *           place, et l'objet REÇU est renvoyé tel quel quand le déplacement ne
 *           change rien (même figure, même place) : l'appelant peut donc
 *           comparer les références et n'écrire que si c'est utile.
 *  Pur (aucun DOM) : _project_section_editing_test.mjs vérifie ce code-ci. */
export const moveFigureTo = (lists, { from = '', to = '', id = '', before = '' } = {}) => {
  const all = lists || {};
  const source = Array.isArray(all[from]) ? all[from] : [];
  const at = source.findIndex((f) => f && f.id === id);
  if (at < 0 || !to || (to === from && before === id)) return all;
  const moved = source[at];
  const rest = source.filter((f) => f !== moved);
  const out = { ...all };
  if (to === from) {
    const dest = before ? rest.findIndex((f) => f && f.id === before) : -1;
    rest.splice(dest < 0 ? rest.length : dest, 0, moved);
    if (rest.length === source.length && rest.every((f, i) => f === source[i])) return all;
    out[from] = rest;
    return out;
  }
  out[from] = rest;
  const target = Array.isArray(all[to]) ? [...all[to]] : [];
  const dest = before ? target.findIndex((f) => f && f.id === before) : -1;
  target.splice(dest < 0 ? target.length : dest, 0, moved);
  out[to] = target;
  return out;
};
