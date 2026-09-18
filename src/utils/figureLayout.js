/* =========================================================================
   src/utils/figureLayout.js
   LA PLACE DES FIGURES DANS UN PANNEAU QUI EN CONTIENT PLUSIEURS.

   Un panneau (un « object » de l'Image Builder) peut porter PLUSIEURS figures
   (`images[]`). Elles étaient jusqu'ici rangées dans une GRILLE — `obj.imgCols`
   colonnes — recalculée à chaque rendu à partir du NOMBRE de figures : ajouter
   une figure à un panneau qui en contenait déjà une RE-FLOWAIT tout. La figure
   déjà réglée (échelle, décalages, recadrage) changeait de taille et de place,
   et tout le travail de mise en page était à refaire — c'était la plainte
   « j'ajoute une figure dans un objet qui en contient déjà et je dois tout
   refaire ».

   D'où la GÉOMÉTRIE LIBRE : une figure peut porter un rectangle
   `im.rect = { x, y, w, h }` exprimé en FRACTIONS du panneau (0 = bord
   gauche/haut, 1 = bord droit/bas). Quand il est là, ce rectangle EST la boîte
   visible de la figure : ni le nombre de figures, ni la grille, ni un
   changement de taille du panneau ne la déplacent ou ne la redimensionnent
   autrement qu'en la faisant suivre le panneau.

   « ➕ Add figure » GÈLE donc les figures déjà présentes — chacune reçoit le
   rectangle exact de ce qu'elle occupe à l'écran, au millième près : elles ne
   bougent pas d'un pixel — et pose la NOUVELLE dans le plus grand espace
   LIBRE restant ; s'il n'y en a aucun (la première figure remplit le panneau),
   la nouvelle se pose au centre, par-dessus, prête à être tirée.

   Tout est PUR (aucun DOM, aucun React) : ImageBuilder.jsx s'en sert à l'écran
   et _builder_montage_test.mjs vérifie exactement ce code-ci.
   ========================================================================= */

/** Le plus petit côté d'une figure libre : 2 % du panneau (une figure plus
 *  petite serait impossible à reprendre à la souris). */
export const RECT_MIN = 0.02;

/** Le plus grand côté : 4 × le panneau. Une figure peut DÉPASSER son panneau —
 *  c'est ainsi qu'on en cache une partie (le décalage d'image le faisait déjà) —
 *  mais pas le quitter totalement. */
export const RECT_MAX = 4;

/** Tolérance des tests de chevauchement : deux bords qui se TOUCHENT ne se
 *  chevauchent pas (deux figures côte à côte restent côte à côte). */
const EPS = 0.002;

/** Rectangle d'une figure qui se pose par-dessus (espace libre = aucun) :
 *  centré, 40 % du panneau. */
export const OVERLAY_RECT = { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };

/** Borne un rectangle libre : nombres finis, côtés dans [RECT_MIN, RECT_MAX].
 *  `x` et `y` peuvent sortir de 0…1 : la figure qui dépasse son panneau est le
 *  cas NORMAL (un décalage négatif, une échelle > 100 %) et le panneau la
 *  découpe de toute façon — la borner dans le panneau ferait revenir la partie
 *  que l'utilisateur venait justement de pousser hors du cadre.
 *  @returns {{x:number,y:number,w:number,h:number}|null} */
export const normFreeRect = (raw) => {
  if (!raw) return null;
  const [x, y, w, h] = ['x', 'y', 'w', 'h'].map((k) => Number(raw[k]));
  if ([x, y, w, h].some((v) => !Number.isFinite(v))) return null;
  const width = Math.max(RECT_MIN, Math.min(RECT_MAX, w));
  const height = Math.max(RECT_MIN, Math.min(RECT_MAX, h));
  return {
    x: +x.toFixed(4),
    y: +y.toFixed(4),
    w: +width.toFixed(4),
    h: +height.toFixed(4)
  };
};

/** La PART du rectangle qui tombe dans le panneau (0…1 × 0…1). C'est elle qui
 *  entre dans la recherche d'espace libre : ce qui déborde n'occupe aucune place
 *  supplémentaire, puisqu'il est découpé. Accepte une FIGURE (`im.rect`) comme un
 *  rectangle déjà nu — les deux formes se rencontrent dans l'appelant. */
export const panelClipRect = (raw) => {
  const r = freeRectOf(raw) || normFreeRect(raw);
  if (!r) return null;
  const x1 = Math.max(0, r.x);
  const y1 = Math.max(0, r.y);
  const x2 = Math.min(1, r.x + r.w);
  const y2 = Math.min(1, r.y + r.h);
  if (x2 - x1 <= EPS || y2 - y1 <= EPS) return null;   // entièrement hors du panneau
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
};

/** Le rectangle libre PORTÉ PAR une figure (`im.rect`), ou null quand la
 *  figure est encore rangée par la grille du panneau. */
export const freeRectOf = (im) => normFreeRect(im && im.rect);

/** Un panneau est en « géométrie libre » dès qu'UNE de ses figures porte un
 *  rectangle : la grille ne le range plus, ses figures gardent leur place. */
export const isFreeLayout = (imgs) => (Array.isArray(imgs) ? imgs : []).some((im) => !!freeRectOf(im));

/** Le rectangle FRACTIONNAIRE (relatif au panneau) d'une boîte ABSOLUE en mm —
 *  c'est la conversion que fait « geler les figures déjà là » : la boîte
 *  visible de la figure devient son rectangle, à la fraction près.
 *  @param {{x,y,w,h}} box    boîte visible de la figure (mm, canvas)
 *  @param {{x,y,w,h}} panel  boîte du panneau (mm, canvas)
 *  @returns {{x,y,w,h}} fractions du panneau */
export const pinRectOf = (box, panel) => normFreeRect({
  x: panel.w ? (box.x - panel.x) / panel.w : 0,
  y: panel.h ? (box.y - panel.y) / panel.h : 0,
  w: panel.w ? box.w / panel.w : 1,
  h: panel.h ? box.h / panel.h : 1
}) || { x: 0, y: 0, w: 1, h: 1 };


/** Où poser une NOUVELLE figure d'un panneau qui en contient déjà.
 *
 *  On cherche le plus grand espace libéré par les figures déjà posées
 *  (`rects` = leurs rectangles libres, en fractions du panneau) : les quatre
 *  bandes qu'elles laissent sur les côtés, les quatre moitiés et les quatre
 *  quarts du panneau. Le plus grand qui ne chevauche RIEN est retenu — la
 *  nouvelle figure se range donc à côté des autres quand il y a la place.
 *  Aucun espace libre (la première figure remplit le panneau) : OVERLAY_RECT,
 *  une vignette centrale posée par-dessus, sans jamais toucher aux autres.
 *  @param {Array} rects rectangles libres déjà occupés
 *  @returns {{x,y,w,h}} fractions du panneau */
export const freeSlotFor = (rects) => {
  /* Seule la partie de chaque figure qui TOMBE dans le panneau occupe une
     place : une figure qui déborde est découpée (voir panelClipRect). */
  const taken = (Array.isArray(rects) ? rects : []).map(panelClipRect).filter(Boolean);
  if (!taken.length) return { x: 0, y: 0, w: 1, h: 1 };   // panneau vide : toute la place
  const overlaps = (a) => taken.some((r) => (
    a.x + a.w > r.x + EPS && r.x + r.w > a.x + EPS
    && a.y + a.h > r.y + EPS && r.y + r.h > a.y + EPS
  ));
  const right = +(1 - Math.max(...taken.map((r) => r.x + r.w))).toFixed(4);
  const below = +(1 - Math.max(...taken.map((r) => r.y + r.h))).toFixed(4);
  const left = +Math.min(...taken.map((r) => r.x)).toFixed(4);
  const above = +Math.min(...taken.map((r) => r.y)).toFixed(4);
  const candidates = [
    right >= RECT_MIN ? { x: +(1 - right).toFixed(4), y: 0, w: right, h: 1 } : null,  // bande droite
    below >= RECT_MIN ? { x: 0, y: +(1 - below).toFixed(4), w: 1, h: below } : null,  // bande basse
    left >= RECT_MIN ? { x: 0, y: 0, w: left, h: 1 } : null,                          // bande gauche
    above >= RECT_MIN ? { x: 0, y: 0, w: 1, h: above } : null,                        // bande haute
    { x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 },
    { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    { x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.5 },
    { x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }
  ].filter(Boolean).map(normFreeRect).filter(Boolean).filter((r) => !overlaps(r));
  if (!candidates.length) return normFreeRect(OVERLAY_RECT);
  candidates.sort((a, b) => (b.w * b.h) - (a.w * a.h));
  return candidates[0];
};
