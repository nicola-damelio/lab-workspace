/* =========================================================================
   src/utils/objectClipboard.js
   COPIER / COLLER UN PANNEAU DE L'IMAGE BUILDER (Ctrl+C / Ctrl+V).

   Un « object » du canvas — un panneau lettré, avec SA figure (ou ses figures)
   et SES textes libres — se copie et se colle comme un tout : refaire deux fois
   la même mise en page (deux conditions présentées pareil, un panneau témoin…)
   ne demande plus de réimporter l'image ni de retaper le texte.

   Le presse-papiers est du TEXTE JSON, marqué par un `kind` propre : l'événement
   `copy` / `paste` du navigateur est la seule voie SANS autorisation, et il
   transporte donc la copie d'un onglet à l'autre (elle survit même à un
   rechargement, et « 📋 Paste » la reprend quand le presse-papiers système n'est
   pas lisible).

   Ce qui part dans le presse-papiers du NAVIGATEUR ne garde que les pixels
   LÉGERS — la vignette (`imgThumb`) : la data-URL pleine résolution d'une
   capture pèse des mégaoctets et n'a pas sa place dans un presse-papiers. Rien
   n'est perdu pour autant : `libId` voyage avec, donc le collage retrouve la
   pleine résolution dans la bibliothèque d'images (resolveLibImage côté
   builder), exactement comme un canvas rechargé. La copie INTERNE du builder
   (une variable en mémoire, jamais sérialisée) garde, elle, la pleine
   résolution : `buildCopyPayload(list, { thumbnails: false })`.

   Le collage pose les copies dans la PREMIÈRE PLACE LIBRE de la grille — la
   règle même de « + Add Object » (firstFreeCellIn) : coller ne recouvre JAMAIS
   un panneau déjà présent. Un lot de plusieurs panneaux garde sa disposition
   relative (sa boîte englobante cherche une place à sa taille, chaque copie
   reprend son écart), et si la boîte n'entre nulle part, chaque panneau cherche
   sa propre place libre. Les lettres (A, B, C …) sont ensuite redistribuées par
   la POSITION, comme pour un panneau ajouté (renumberLetters côté builder).

   Tout est PUR (aucun DOM, aucun React) : ImageBuilder.jsx s'en sert à l'écran
   et _builder_copy_paste_test.mjs vérifie exactement ce code-ci.
   ========================================================================= */

/** Marqueur de la charge utile : un texte qui ne porte pas ce `kind` n'est pas
 *  notre copie, et le builder laisse alors le collage au navigateur. */
export const OBJECT_COPY_KIND = 'lab-image-builder/objects';

/** Version du format. Un `version` PLUS GRAND vient d'une version plus récente
 *  de l'app : il est refusé (on n'invente pas le sens des champs). */
export const OBJECT_COPY_VERSION = 1;

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const int = (v, d = 1) => Math.max(1, Math.round(num(v, d)));

/** La première case LIBRE d'une grille `gridCols × gridRows` pour un bloc de
 *  `w × h` cases, en lecture ligne par ligne (de gauche à droite) — l'ordre des
 *  lettres A, B, C… — ou `null` quand le bloc n'entre plus nulle part.
 *  Les cases recouvertes par un panneau déjà posé comptent comme occupées, et
 *  c'est la taille du bloc qui est testée : un panneau ne se pose jamais à
 *  moitié sur un autre.
 *  @returns {{x:number, y:number}|null} */
export const firstFreeCellIn = (list, gridCols, gridRows, w = 1, h = 1) => {
  const cols = int(gridCols, 1);
  const rows = int(gridRows, 1);
  const bw = int(w, 1);
  const bh = int(h, 1);
  const occupied = (x, y) => (list || []).some((o) => {
    if (!o) return false;
    const ox = num(o.x), oy = num(o.y);
    const ow = Math.max(1, num(o.w, 1)), oh = Math.max(1, num(o.h, 1));
    return x < ox + ow && x + bw > ox && y < oy + oh && y + bh > oy;
  });
  for (let y = 0; y + bh <= rows; y++) {
    for (let x = 0; x + bw <= cols; x++) {
      if (!occupied(x, y)) return { x, y };
    }
  }
  return null;
};

/** Les figures d'un panneau, qu'elles soient dans `images[]` ou dans les champs
 *  hérités d'une figure unique (même règle que getObjImagesOf du builder). */
const imagesOf = (obj) => {
  if (obj && Array.isArray(obj.images) && obj.images.length) return obj.images;
  if (obj && obj.imgSrc) {
    return [{
      imgSrc: obj.imgSrc, imgThumb: obj.imgThumb, libId: obj.libId,
      libScope: obj.libScope, libProjectId: obj.libProjectId, src: obj.src
    }];
  }
  return [];
};

/**
 * La copie d'un panneau : tout ce qui le décrit (case, lettre, textes, ombres,
 * figures, recadrages, gomme, décorations…) avec, par défaut, la VIGNETTE comme
 * pixels (`thumbnails: true` — la copie qui part dans le presse-papiers du
 * navigateur ne peut pas transporter des mégaoctets de data-URL).
 * `thumbnails: false` garde les pixels pleine résolution : c'est la copie
 * INTERNE du builder (une variable en mémoire), donc coller dans le même onglet
 * ne perd aucune finesse.
 * Le résultat est un objet JSON autonome — rien n'est partagé avec le panneau
 * VIVANT, donc éditer le canvas après la copie ne modifie pas la copie.
 * @returns {object} un enregistrement de panneau, prêt pour JSON.stringify
 */
export const lightweightPanel = (obj, { thumbnails = true } = {}) => {
  const source = obj || {};
  const images = imagesOf(source).map((im) => {
    const record = { ...(im || {}) };
    if (thumbnails) {
      record.imgSrc = record.imgThumb || record.imgSrc || null;  // la vignette devient les pixels
      record._srcHint = null;                                     // pas d'URL de Drive à re-résoudre
    }
    return record;
  });
  const first = images[0] || {};
  return JSON.parse(JSON.stringify({
    ...source,
    images,
    imgSrc: first.imgSrc || source.imgThumb || source.imgSrc || null,
    imgThumb: first.imgThumb || first.imgSrc || source.imgThumb || null
  }));
};

/** La charge utile du presse-papiers pour les panneaux `list`.
 *  @param {object} [opts] `{ thumbnails }` — false pour garder la pleine
 *         résolution (copie INTERNE du builder, jamais sérialisée). */
export const buildCopyPayload = (list, opts = {}) => ({
  kind: OBJECT_COPY_KIND,
  version: OBJECT_COPY_VERSION,
  objects: (Array.isArray(list) ? list : []).filter(Boolean).map((o) => lightweightPanel(o, opts))
});

/**
 * Relit une charge utile : le TEXTE du presse-papiers, ou l'objet déjà lu.
 * @returns {object|null} la charge utile validée, ou `null` quand ce n'est pas
 *          une copie de panneaux (texte venu d'ailleurs, JSON cassé, version
 *          inconnue) — l'appelant laisse alors le collage au navigateur au lieu
 *          de deviner.
 */
export const parseCopyPayload = (raw) => {
  let data = raw;
  if (typeof raw === 'string') {
    const txt = raw.trim();
    if (!txt || txt[0] !== '{') return null;      // un texte quelconque : pas pour nous
    try { data = JSON.parse(txt); } catch { return null; }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (data.kind !== OBJECT_COPY_KIND) return null;
  const version = num(data.version, 0);
  if (version < 1 || version > OBJECT_COPY_VERSION) return null;
  const objects = (Array.isArray(data.objects) ? data.objects : [])
    .filter((o) => o && typeof o === 'object' && !Array.isArray(o));
  if (!objects.length) return null;
  return { kind: OBJECT_COPY_KIND, version, objects };
};

/** La boîte englobante d'un lot de panneaux copiés, en CASES de grille.
 *  @returns {{x:number, y:number, w:number, h:number}} */
export const payloadBounds = (records) => {
  const list = (Array.isArray(records) ? records : []).filter(Boolean);
  if (!list.length) return { x: 0, y: 0, w: 1, h: 1 };
  const xs = list.map((r) => num(r.x));
  const ys = list.map((r) => num(r.y));
  const rights = list.map((r) => num(r.x) + Math.max(1, num(r.w, 1)));
  const bottoms = list.map((r) => num(r.y) + Math.max(1, num(r.h, 1)));
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(1, Math.max(...rights) - x), h: Math.max(1, Math.max(...bottoms) - y) };
};


/** Un enregistrement de panneau collé : cases entières, taille bornée à la
 *  grille (le format du canvas a pu changer depuis la copie), identifiants
 *  NEUFS — un panneau collé n'est jamais « le même » que son original, c'est ce
 *  qui permet de le déplacer, de le supprimer ou de le redimensionner sans
 *  toucher à l'autre — et les textes libres ré-identifiés comme lui. */
const copyRecord = (record, { x, y, cols, rows, seed, k }) => {
  const src = record || {};
  const images = (Array.isArray(src.images) ? src.images : []).filter(Boolean).map((im) => ({ ...im }));
  const texts = (Array.isArray(src.texts) ? src.texts : []).filter(Boolean)
    .map((tx, j) => ({ ...tx, id: `txt_cp_${seed}_${k}_${j}` }));
  const first = images[0] || {};
  return {
    ...src,
    id: `obj_cp_${seed}_${k}`,
    x: Math.round(num(x)),
    y: Math.round(num(y)),
    w: Math.min(cols, Math.max(1, Math.round(num(src.w, 1)))),
    h: Math.min(rows, Math.max(1, Math.round(num(src.h, 1)))),
    images,
    texts,
    imgSrc: first.imgSrc || src.imgSrc || null,
    imgThumb: first.imgThumb || src.imgThumb || null
  };
};

/**
 * Colle une charge utile dans la liste des panneaux du canvas.
 *
 * Le lot entier cherche d'abord une place à SA taille (les copies gardent alors
 * leur disposition d'origine) ; à défaut, chaque panneau prend la première place
 * libre de sa propre taille, et ceux qui n'en trouvent pas sont comptés dans
 * `skipped` — jamais posés les uns sur les autres.
 *
 * @param {Array} list            les panneaux actuels (`objects`)
 * @param {object|string} payload la charge utile (buildCopyPayload, presse-papiers)
 * @param {{gridCols:number, gridRows:number, seed:number|string}} opts
 *        `seed` rend les identifiants uniques d'un collage à l'autre
 * @returns {{objects:Array, added:Array, ids:Array, skipped:number}}
 *          `objects` est la MÊME liste (même référence) quand rien n'a pu être
 *          collé : l'appelant ne doit alors ni écrire ni pousser d'historique.
 */
export const pastePanels = (list, payload, { gridCols, gridRows, seed = 0 } = {}) => {
  const parsed = parseCopyPayload(payload);
  if (!parsed) return { objects: list, added: [], ids: [], skipped: 0 };
  const cols = int(gridCols, 1);
  const rows = int(gridRows, 1);
  const current = (Array.isArray(list) ? list : []).slice();
  const records = parsed.objects.map((r) => ({ ...r }));
  const added = [];
  const ids = [];
  let skipped = 0;
  // 1) Le LOT entier : sa place est cherchée à la taille de sa boîte, donc les
  //    copies reprennent leurs écarts (deux panneaux collés côte à côte le
  //    restent).
  const box = payloadBounds(records);
  const spot = records.length > 1 ? firstFreeCellIn(current, cols, rows, box.w, box.h) : null;
  if (spot) {
    records.forEach((r, k) => {
      const copy = copyRecord(r, {
        x: spot.x + (num(r.x) - box.x), y: spot.y + (num(r.y) - box.y), cols, rows, seed, k
      });
      current.push(copy);
      added.push(copy);
      ids.push(copy.id);
    });
    return { objects: current, added, ids, skipped };
  }
  // 2) Place libre par place libre (un seul panneau, ou un lot qui n'entre plus
  //    d'un bloc — la grille a changé depuis la copie). `current` s'allonge au
  //    fur et à mesure : deux copies ne peuvent pas viser la même case.
  records.forEach((r, k) => {
    const w = Math.min(cols, Math.max(1, Math.round(num(r.w, 1))));
    const h = Math.min(rows, Math.max(1, Math.round(num(r.h, 1))));
    const at = firstFreeCellIn(current, cols, rows, w, h);
    if (!at) { skipped += 1; return; }
    const copy = copyRecord(r, { x: at.x, y: at.y, cols, rows, seed, k });
    current.push(copy);
    added.push(copy);
    ids.push(copy.id);
  });
  return { objects: added.length ? current : list, added, ids, skipped };
};

