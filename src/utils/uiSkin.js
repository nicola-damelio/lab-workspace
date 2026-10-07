/* =========================================================================
   src/utils/uiSkin.js
   Interface SKINS — one palette for the whole program, chosen in Settings.

   Tailwind v4 does not inline its colours: `bg-slate-800` compiles to
   `background-color: var(--color-slate-800)` and `text-white` to
   `color: var(--color-white)`. src/index.css therefore only has to RESTATE
   those variables under `[data-skin="…"]` for every page, modal, badge and
   button to follow — not one component is touched, not one class edited.

   `data-skin` is set on <html> (by main.jsx, before the first paint) and may
   be set on ANY element: custom properties are inherited, so Settings shows a
   LIVE miniature of the interface by wrapping a small demo in the attribute.

   OWNED BY THE OPERATOR (see « À QUI APPARTIENT LA PEAU » below): how the
   program looks follows the SIGNED-IN OPERATOR — on a shared computer, signing
   in as somebody else repaints the program with HIS skin, and the skin travels
   with him to another computer (the `labWorkspace_uiSkin*` keys ride along with
   the other browser keys, see utils/workspaceKeyStore.js). It is still never
   part of the dataset or of the Doc, and EVERY user sees the control (like the
   display scale, see utils/uiScale.js).

   The default skin is the shipped palette itself: applying it REMOVES the
   attribute (nothing is restated for it, so it can never drift away from
   Tailwind's own values).
   ========================================================================= */

import { opNameKey } from './auth.js';

export const UI_SKIN_KEY = 'labWorkspace_uiSkin';

/* The reference — the colours the program ships with: no override at all. */
export const UI_SKIN_DEFAULT = 'slate';

/* LA PEAU PERSONNALISÉE — son id est déclaré ICI parce que le registre ci-dessous
   le référence (voir la section « LA PEAU PERSONNALISÉE », plus bas, pour tout le
   reste : l'accent, la famille neutre, la dérivation des onze crans). */
export const UI_SKIN_CUSTOM = 'custom';

/* ── À QUI APPARTIENT LA PEAU ───────────────────────────────────────────────
   « the skin must be associated to the operator as each operator must be able
   to choose his own preferred skin » : la peau n'est donc plus celle du POSTE,
   mais celle de l'OPÉRATEUR qui l'a choisie.

   DEUX ÉTAGES, parce qu'il y a deux échelles :
     · `labWorkspace_uiSkin_<propriétaire>` — la peau de CET opérateur ;
     · `labWorkspace_uiSkin` — celle du POSTE : ce qu'on voit quand personne
       n'est connecté (écran d'entrée, session fermée), ET la valeur de départ
       d'un opérateur qui n'a encore rien choisi — un poste neuf ne change donc
       pas de couleur sous les yeux de celui qui s'assied devant.

   Le PROPRIÉTAIRE est l'identifiant de l'opérateur (`currentUser.id`, celui de
   la liste des comptes) ou, tant qu'il n'y en a pas, son nom replié (opNameKey,
   voir utils/auth.js) : l'appariement des identités de ce programme se fait par
   le NOM (`operatorForName`, `memberIdentity`), donc ce repli désigne le même
   opérateur d'un chemin de connexion à l'autre. */
export const uiSkinOwnerOf = (operator) => {
  const op = operator && typeof operator === 'object' ? operator : {};
  const id = String(op.id == null ? '' : op.id).trim();
  return id || opNameKey(op.name);
};

/** La clé du navigateur qui porte la peau d'un opérateur — celle du POSTE quand
 *  on n'en connaît aucun. `base` nomme le réglage (la peau, son accent…) : le
 *  suffixe du propriétaire est le même pour tous. PUR. */
export const uiSkinKeyOf = (operator = null, base = UI_SKIN_KEY) => {
  const owner = uiSkinOwnerOf(operator);
  return owner ? `${base}_${owner}` : base;
};

/* ── The skins ──────────────────────────────────────────────────────────────
   `kind` is how the palette is derived, and the probe test holds each kind to
   its own rule: a `hue` skin SWAPS one accent family with another (so it may
   never move a stop by more than 4 points of OKLCH lightness), a `tone` skin
   restates a ramp stop for stop (`dim`, `contrast`) or borrows another neutral
   family (`graphite`, `warm`), and a `night` skin TURNS THE PALETTE OVER —
   the page goes dark and the ink goes light (see « NUIT » in src/index.css),
   so its ramps ASCEND where every other skin's descend.
   `swatch` is only the picture of the four chips shown in Settings (page ·
   ink · chrome · accent) — the colours that PAINT the program live in
   src/index.css, one block per skin id. */
export const UI_SKINS = [
  { id: UI_SKIN_DEFAULT, kind: 'tone', label: 'Slate & blue', hint: 'the shipped look', swatch: ['#f8fafc', '#314158', '#1d293d', '#155dfc'] },
  { id: 'graphite', kind: 'tone', label: 'Graphite', hint: 'pure greys', swatch: ['#fafafa', '#3f3f46', '#27272a', '#155dfc'] },
  { id: 'warm', kind: 'tone', label: 'Warm paper', hint: 'warm neutrals', swatch: ['#fafaf9', '#44403b', '#292524', '#155dfc'] },
  { id: 'indigo', kind: 'hue', label: 'Indigo', hint: 'indigo accents', swatch: ['#f8fafc', '#314158', '#1d293d', '#4f39f6'] },
  { id: 'violet', kind: 'hue', label: 'Violet', hint: 'violet accents', swatch: ['#f8fafc', '#314158', '#1d293d', '#7f22fe'] },
  { id: 'purple', kind: 'hue', label: 'Purple', hint: 'purple accents', swatch: ['#fafafc', '#3b3355', '#241a3d', '#9810fa'] },
  { id: 'red', kind: 'hue', label: 'Red', hint: 'red accents', swatch: ['#faf7f6', '#4a3230', '#2b1b1a', '#e7000b'] },
  { id: 'rose', kind: 'hue', label: 'Rose', hint: 'rose accents', swatch: ['#fbf7f7', '#4a2f33', '#2c1a1d', '#ec003f'] },
  { id: 'dim', kind: 'tone', label: 'Dimmed', hint: 'softer light', swatch: ['#e8ebef', '#2b394d', '#172336', '#295dc4'] },
  { id: 'contrast', kind: 'tone', label: 'High contrast', hint: 'bolder ink', swatch: ['#fbfcfd', '#0c192a', '#030b1c', '#003dce'] },
  /* ── LES PEAUX SOMBRES ─────────────────────────────────────────────────────
     « the skins do not change the background color. for dark color the writing
     must change color to allow visibility » : les dix peaux ci-dessus déplacent
     la teinte ou l'encre, jamais la LUMIÈRE — la page reste claire sous toutes.
     Celles-ci RETOURNENT la palette (voir « NUIT » dans src/index.css) : le fond
     de page, les cartes, les panneaux et les bordures deviennent sombres, et
     l'encre qui s'écrivait dessus devient claire — par la même opération, pour
     chaque famille, donc sans qu'aucun composant n'ait à s'en occuper. */
  { id: 'night', kind: 'night', label: 'Night', hint: 'dark pages, light ink', swatch: ['#0a0b0c', '#b0c3df', '#c8d9f3', '#7aa7ff'] },
  { id: 'carbon', kind: 'night', label: 'Carbon', hint: 'dark, pure greys', swatch: ['#070707', '#babac3', '#d2d2d7', '#679aff'] },
  /* ── LA PEAU QUE L'UTILISATEUR POSSÈDE ─────────────────────────────────────
     La demande de cette session : « the skins in the setup are all too similar
     and NOT customizable ». Celle-ci répond aux deux : l'accent est CELUI QUE
     L'UTILISATEUR CHOISIT (huit propositions + une pipette libre) et la famille
     neutre se choisit aussi (celle du programme, le gris pur, le chaud). Les
     onze crans de l'accent sont DÉRIVÉS d'une seule couleur (voir
     uiSkinCustomRamp) : la palette garde la forme de celle du programme. */
  { id: UI_SKIN_CUSTOM, kind: 'hue', label: 'Custom…', hint: 'your accent, your page', swatch: ['#f8fafc', '#314158', '#1d293d', '#009689'] }
];

/* ── LA PEAU PERSONNALISÉE ────────────────────────────────────────────────── */

/* (`UI_SKIN_CUSTOM` est déclaré plus haut, avec la référence : le registre le
   référence.) Ses onze crans d'accent ne vivent PAS dans index.css — ils sont
   écrits EN LIGNE par `applyUiSkin`, à partir d'UNE couleur (voir
   uiSkinCustomRamp). */

/** Clé localStorage du réglage — par OPÉRATEUR, comme la peau elle-même (voir
 *  uiSkinKeyOf) : deux opérateurs peuvent donc avoir chacun SON accent. */
export const UI_CUSTOM_KEY = 'labWorkspace_uiSkinCustom';

/** La clé qui porte l'accent + la famille neutre d'un opérateur (celle du POSTE
 *  quand on n'en connaît aucun). PUR. */
export const uiCustomSkinKeyOf = (operator = null) => uiSkinKeyOf(operator, UI_CUSTOM_KEY);

/** L'accent livré : le bleu du programme, pour qu'une peau personnalisée jamais
 *  réglée ressemble à la référence. */
export const UI_CUSTOM_ACCENT_DEFAULT = '#155dfc';

/** Le cran qui REÇOIT la couleur choisie. */
export const UI_CUSTOM_ACCENT_STOP = 600;

/** Les huit accents proposés — les hexadécimaux EXACTS des crans 600 de la
 *  palette que Tailwind livre (relevés dans son thème, pas inventés). */
export const UI_CUSTOM_ACCENTS = [
  { id: 'blue', label: 'Blue', color: '#155dfc' },
  { id: 'teal', label: 'Teal', color: '#009689' },
  { id: 'emerald', label: 'Emerald', color: '#009966' },
  { id: 'cyan', label: 'Cyan', color: '#0092b8' },
  { id: 'purple', label: 'Purple', color: '#9810fa' },
  { id: 'rose', label: 'Rose', color: '#ec003f' },
  { id: 'orange', label: 'Orange', color: '#f54900' },
  { id: 'pink', label: 'Pink', color: '#e60076' }
];

/** Les familles NEUTRES empruntables : celle du programme, le gris pur (les
 *  valeurs de la peau Graphite) et le chaud (celles de Warm paper). Le choix
 *  pose `data-tone` sur <html>, et index.css porte les valeurs. */
export const UI_CUSTOM_NEUTRALS = [
  { id: 'slate', label: 'Slate (shipped)' },
  { id: 'zinc', label: 'Zinc (pure grey)' },
  { id: 'stone', label: 'Stone (warm)' }
];
export const UI_CUSTOM_NEUTRAL_DEFAULT = 'slate';

/* ── LA PAGE : LE JOUR OU LA NUIT ───────────────────────────────────────────
   « la pagina resta molto chiara » : la peau personnalisée ne savait peindre
   que des pages CLAIRES. Le réglage ci-dessous ajoute le second régime — et il
   n'invente rien : la page sombre reprend la PROFONDEUR des peaux livrées
   (`night`, `carbon`, voir « NUIT » dans src/index.css), l'encre du motif passe
   du côté clair, et la palette neutre retournée est CELLE DE CES PEAUX,
   réutilisée par index.css (aucun nombre écrit deux fois).
   `day` est le défaut : le réglage ne pose alors aucun attribut. */
export const UI_BG_PAGE_MODES = [
  { id: 'day', label: 'Day pages', hint: 'the light pages the program ships' },
  { id: 'night', label: 'Night pages', hint: 'dark pages, light ink' }
];
export const UI_BG_PAGE_MODE_DEFAULT = 'day';
export const UI_BG_PAGE_MODE_DARK = 'night';

/* LA BANDE SOMBRE D'UNE PAGE CHOISIE — la bande claire [95.5, 99] ramenée dans
   [12, 16], plus l'écart de son cran 100 (3.5) : les nombres de la peau Night.
   La page livrée (slate-50) y tombe à 15.3 % contre 15.0 pour Night, et le cran
   qui la suit à 18.8 contre 18.5 — mesuré par la sonde. Une couleur choisie
   plus sombre que la bande claire donne la page la plus sombre de la bande
   sombre, jamais une page grise au point de perdre l'encre claire. */
export const UI_BG_DARK_LO = 12;
export const UI_BG_DARK_HI = 16;
export const UI_BG_DARK_GAP = 3.5;
export const UI_BG_DARK_CAP = 0.06;

/* LA RECETTE SOMBRE D'UN ACCENT — les deux bandes de la palette NUIT : ses
   surfaces de couleur (29 → 45) puis ses encres (57 → 100). Au bleu livré,
   elle redonne le bleu de la peau `night` cran pour cran, et la sonde le
   compare plutôt que de le croire. */
export const UI_DARK_COLOUR_SURFACES = [29, 45];
export const UI_DARK_COLOUR_INKS = [57, 100];

/** Une bande : la valeur `v` d'une rampe source ramenée LINÉAIREMENT de
 *  `[from, to]` vers `[lo, hi]`. C'est la seule opération de la recette sombre,
 *  et c'est elle que la sonde rejoue. PUR. */
export const bandOf = (v, from, to, lo, hi) => lo + (hi - lo) * (v - from) / (to - from);

/** LA FORME DU DÉGRADÉ LIVRÉ — les onze crans de bleu (L et C de chacun). C'est
 *  cette forme que la couleur choisie recolore : un accent personnalisé garde
 *  donc la STRUCTURE de luminosité de la référence, contraste compris. */
const BLUE_SHAPE = [
  [50, 97.0, 0.014], [100, 93.2, 0.032], [200, 88.2, 0.059], [300, 80.9, 0.105],
  [400, 70.7, 0.165], [500, 62.3, 0.214], [600, 54.6, 0.245], [700, 48.8, 0.243],
  [800, 42.4, 0.199], [900, 37.9, 0.146], [950, 28.2, 0.091]
];

/** sRGB hex → OKLCH (Ottosson) : l'inverse exact de ce qu'index.css écrit.
 *  `null` quand ce n'est pas une couleur hexadécimale à six chiffres. PUR. */
export const hexToOklch = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * mm - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * mm + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * mm - 0.8086757660 * s;
  return { L: L * 100, C: Math.sqrt(A * A + B * B), H: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
};

/** LES ONZE CRANS d'une couleur d'accent. En clair : le cran 600 EST la couleur
 *  choisie, et les dix autres gardent la forme du dégradé livré. De NUIT : la
 *  même forme RETOURNÉE par la recette des peaux sombres — les quatre crans de
 *  surface dans `UI_DARK_COLOUR_SURFACES`, les sept crans d'encre dans
 *  `UI_DARK_COLOUR_INKS` —, avec le chroma ramené dans le gamut sRGB quand la
 *  lumière descend (comme le fait le moteur, CSS Color 4) : une couleur jamais
 *  écrite ne peut donc pas être une couleur jamais peinte. PUR. */
export const uiSkinCustomRamp = (accent = UI_CUSTOM_ACCENT_DEFAULT, pageMode = UI_BG_PAGE_MODE_DEFAULT) => {
  const okl = hexToOklch(accent) || hexToOklch(UI_CUSTOM_ACCENT_DEFAULT);
  const dL = okl.L - 54.6;
  const k = okl.C / 0.245;
  const dark = pageMode === UI_BG_PAGE_MODE_DARK;
  const out = {};
  BLUE_SHAPE.forEach(([stop, l, c], i) => {
    /* la lumière : la forme livrée décalée avec la couleur choisie, ou — de
       nuit — les deux bandes de la palette NUIT, appliquées à la forme livrée
       (au bleu livré, c'est donc le bleu de la peau `night`, cran pour cran). */
    const L = dark
      ? bandOf(l,
        i < 4 ? BLUE_SHAPE[0][1] : BLUE_SHAPE[4][1],
        i < 4 ? BLUE_SHAPE[3][1] : BLUE_SHAPE[10][1],
        ...(i < 4 ? UI_DARK_COLOUR_SURFACES : UI_DARK_COLOUR_INKS))
      : Math.max(6, Math.min(99, l + dL));
    const C = dark
      ? sRGBChroma({ L, C: c * k, H: okl.H })
      : Math.max(0, c * k);
    out[`--color-blue-${stop}`] = `oklch(${L.toFixed(1)}% ${C.toFixed(3)} ${okl.H.toFixed(1)})`;
  });
  return out;
};

/* ── LE FOND DES PAGES — LA COULEUR CHOISIE, ET SON MOTIF ────────────────────
   « let the user choose the background color, with sober patterns ». Le fond
   vit ICI, à côté de l'accent, et pas dans index.css : la couleur dépend d'un
   CHOIX, donc c'est `applyUiSkin` qui l'écrit EN LIGNE sur <html>, exactement
   comme les onze crans de l'accent. Le MOTIF, lui, est une affaire de feuille
   (src/index.css, `[data-pattern="…"]`) : le même appel pose l'attribut.

   CHAQUE COULEUR EST RAMENÉE DANS UNE BANDE (c'est le garde-fou de cette
   section). Une page peut prendre n'importe quelle TEINTE, jamais n'importe
   quelle LUMIÈRE : les deux paires que le programme écrit SUR une page —
   `text-slate-700` sur `bg-slate-50` (le titre d'une carte, 7 281 fois) et
   `text-slate-800` sur `bg-slate-100` (les panneaux posés sur la page) —
   doivent garder au pire 1.5 cran de contraste de moins que ce que la palette
   livrée donne ; c'est la règle que la sonde impose déjà à toute peau.
   En OKLCH c'est une bande simple : la luminosité reste entre 95.5 et 99, le
   chroma sous 0.03 — et, parce qu'un chroma élevé sur une page aussi claire
   sortirait du gamut sRGB (le moteur le réduirait lui-même, et la page ne
   serait plus la couleur qu'on a mesurée), le chroma est RAMENÉ DANS LE GAMUT
   par dichotomie, comme le fait le CSS Color 4. Toutes les teintes passent, y
   compris les pastels qu'on attend d'un fond de page ; aucune ne descend sous
   le plancher de lisibilité.

   LE SECOND CRAN DE LA PAGE (le 100 : les panneaux, les entêtes de tableau)
   est DÉRIVÉ du premier — même teinte, même chroma, 1.6 point de luminosité en
   moins, l'écart exact que la palette livrée a entre ses deux crans. */

/** Le fond de page LIVRÉ (slate-50, la référence) : ce que le réglage vide veut
 *  dire, et la valeur de repli d'une couleur illisible. */
export const UI_BG_SHIPPED_OKLCH = { L: 98.4, C: 0.003, H: 247.858 };

/* LA BANDE — les valeurs que la sonde mesure. Le PLANCHER est celui des trois
   familles neutres que le programme sait servir, pas seulement de l'ardoise :
   une page rose vif (le pire cas possible, L=50 ramené au plancher, chroma au
   plafond) coûte 1.56 cran de contraste sur la paire des panneaux avec le gris
   CHAUD (stone, dont l'encre et les crans 100/800 donnent la paire la plus
   serrée), donc 95 ne suffisait pas — 95.5 ramène le pire cas à 1.37. Les
   changer sans les remesurer casserait la garantie. */
export const UI_BG_FLOOR = 95.5;  /* L minimum d'une page choisie */
export const UI_BG_CEIL = 99;     /* L maximum (100 = blanc pur, aveuglant) */
export const UI_BG_CAP = 0.03;    /* chroma maximum — un pastel, jamais plus */
export const UI_BG_GAP = 1.6;     /* l'écart livré entre la page et son cran 100 */

/** Le réglage vide : « la page de la famille neutre choisie ». Rien n'est
 *  écrit, donc le cran 50 du thème livré — ou celui du `data-tone` — reste en
 *  place, et changer de famille neutre change AUSSI la page. */
export const UI_BG_DEFAULT = '';

/** LES VINGT MOTIFS — tous des dégradés CSS répétés (aucune image, aucun octet
 *  à charger, et rien à l'impression : voir `@media screen`, index.css).
 *
 *  DEUX FAMILLES, parce que « i motivi sono sempre linee » : douze Trames de
 *  papier (des filets, des points — des repères pour écrire) et huit MOTIFS
 *  DESSINÉS (des vagues, des écailles, un nid d'abeille, un zigzag, un damier,
 *  un tartan, des bulles, des confettis) qui courbent la ligne ou se peignent
 *  en PLUSIEURS couleurs.
 *
 *  LA GÉOMÉTRIE N'EST PAS ICI : elle vit dans index.css (un bloc par motif,
 *  `[data-pattern="…"]`), et c'est la même règle qui peint une page entière ET
 *  la pastille de ⚙ Settings — une pastille ne peut donc pas mentir. Ici on ne
 *  garde que ce qui se CHOISIT : le nom, la famille, ce qu'il montre, et ses
 *  deux réglages — la FORCE de l'encre (`UI_BG_PATTERN_INKS`) et l'ÉCHELLE de
 *  la trame (`UI_BG_PATTERN_SCALES`), deux variables écrites EN LIGNE par
 *  `applyUiSkin`, que la feuille multiplie à sa propre géométrie. Les motifs
 *  dessinés, eux, lisent en plus les trois ENCRES (`--lab-page-ink*`), elles
 *  aussi écrites en ligne : le filet neutre, la teinte de l'accent choisi, et
 *  le complémentaire de cette teinte (voir `uiBgInkRgb`).
 *
 *  `none` est le défaut, et ne pose donc rien. */
export const UI_BG_PATTERNS = [
  { id: 'none', label: 'None', hint: 'the plain page', group: 'texture' },
  { id: 'grid', label: 'Grid', hint: 'hairline squares', group: 'texture' },
  { id: 'fine', label: 'Fine grid', hint: 'a fine graph paper', group: 'texture' },
  { id: 'graph', label: 'Graph paper', hint: 'fine squares, one in five bolder', group: 'texture' },
  { id: 'dots', label: 'Dots', hint: 'a dotted sheet', group: 'texture' },
  { id: 'dense', label: 'Dense dots', hint: 'a tighter dotted sheet', group: 'texture' },
  { id: 'rules', label: 'Ruled', hint: 'lines to write on', group: 'texture' },
  { id: 'diagonal', label: 'Diagonal', hint: 'slanted hairlines', group: 'texture' },
  { id: 'cross', label: 'Hatch', hint: 'crossed hairlines', group: 'texture' },
  { id: 'weave', label: 'Weave', hint: 'a linen texture', group: 'texture' },
  { id: 'herringbone', label: 'Herringbone', hint: 'a two-way zigzag', group: 'texture' },
  { id: 'triangles', label: 'Triangles', hint: 'an isometric lattice', group: 'texture' },
  { id: 'waves', label: 'Waves', hint: 'a running line that curves', group: 'motif' },
  { id: 'scales', label: 'Scales', hint: 'fish scales, two colours', group: 'motif' },
  { id: 'zigzag', label: 'Chevrons', hint: 'teeth of two colours', group: 'motif' },
  { id: 'honeycomb', label: 'Honeycomb', hint: 'a woven hexagon lattice', group: 'motif' },
  { id: 'bubbles', label: 'Bubbles', hint: 'round dots of three sizes and colours', group: 'motif' },
  { id: 'confetti', label: 'Confetti', hint: 'three colours, scattered', group: 'motif' },
  { id: 'checker', label: 'Checker', hint: 'a two-colour chessboard', group: 'motif' },
  { id: 'plaid', label: 'Plaid', hint: 'bands of two colours crossing', group: 'motif' }
];
export const UI_BG_PATTERN_DEFAULT = 'none';

/** Les deux familles du catalogue, dans l'ordre où ⚙ Settings les montre : les
 *  Trames de papier d'abord (des repères discrets), les motifs DESSINÉS
 *  ensuite. PUR. */
export const UI_BG_PATTERN_GROUPS = [
  { id: 'texture', label: 'Paper' },
  { id: 'motif', label: 'Drawn' }
];

/** LA FORCE DE L'ENCRE DU MOTIF — un seul facteur, l'alpha du filet. Le motif
 *  reste un repère de papier : même « Bold » ne descend pas sous le quart de
 *  l'encre du texte le plus pâle de la page (un filet à 0.11 d'alpha sur une
 *  page à 95.5 % de luminosité reste à plus de 1.1:1 de la page, mesuré par
 *  `_ui_skin_test.cjs`), donc il décore sans jamais gêner une lecture. */
export const UI_BG_PATTERN_INKS = [
  { id: 'faint', label: 'Faint', hint: 'barely there', alpha: 0.035 },
  { id: 'standard', label: 'Standard', hint: 'the sober default', alpha: 0.06 },
  { id: 'bold', label: 'Bold', hint: 'clearly drawn', alpha: 0.11 }
];
export const UI_BG_INK_DEFAULT = 'standard';

/** L'ÉCHELLE DE LA TRAME — un facteur multiplicateur, appliqué par la feuille à
 *  SES propres pas (`calc(24px * var(--lab-page-scale, 1))`) : aucun nombre
 *  n'est donc écrit deux fois, et la pastille montre exactement la page. */
export const UI_BG_PATTERN_SCALES = [
  { id: 'fine', label: 'Fine', hint: 'a tight trame', factor: 0.6 },
  { id: 'standard', label: 'Standard', hint: 'the shipped trame', factor: 1 },
  { id: 'broad', label: 'Broad', hint: 'a wide trame', factor: 1.6 }
];
export const UI_BG_SCALE_DEFAULT = 'standard';

/** L'alpha retenu pour un nom de force (le défaut livré si le nom est inconnu).
 *  PUR. */
export const uiBgPatternAlpha = (id) => {
  const ink = UI_BG_PATTERN_INKS.find((i) => i.id === id);
  return (ink || UI_BG_PATTERN_INKS.find((i) => i.id === UI_BG_INK_DEFAULT)).alpha;
};

/** Le facteur retenu pour un nom d'échelle (le défaut livré si le nom est
 *  inconnu). PUR. */
export const uiBgPatternScale = (id) => {
  const scale = UI_BG_PATTERN_SCALES.find((s) => s.id === id);
  return (scale || UI_BG_PATTERN_SCALES.find((s) => s.id === UI_BG_SCALE_DEFAULT)).factor;
};

/** OKLCH → sRGB LINÉAIRE : le retour exact de `hexToOklch` (mêmes matrices,
 *  inversées). Sert à savoir si une couleur TIENT dans le gamut sRGB. PUR. */
export const oklchToLin = ({ L, C, H }) => {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L / 100 + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L / 100 - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L / 100 - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  ];
};

/** Le chroma le plus élevé qui TIENT dans le gamut sRGB à cette lumière et
 *  cette teinte (dichotomie, comme la réduction de chroma du CSS Color 4),
 *  ARRONDI VERS LE BAS au millième : c'est le nombre de décimales que la chaîne
 *  écrite porte (`C.toFixed(3)`), donc la valeur ÉCRITE ne peut pas sortir du
 *  gamut d'un millième de trop — entre une couleur écrite et une couleur peinte,
 *  il n'y a pas de place pour un doute. PUR. */
export const sRGBChroma = (col) => {
  const inside = (c) => oklchToLin({ ...col, C: c }).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  if (inside(col.C)) return col.C;
  let lo = 0, hi = col.C;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (inside(mid)) lo = mid; else hi = mid;
  }
  return Math.floor(lo * 1000) / 1000;
};

/** OKLCH → hexadécimal sRGB : le chemin inverse de `hexToOklch`, pour les
 *  pastilles de ⚙ Settings (chaque canal est écrêté, comme le fait le
 *  moteur). PUR. */
export const oklchToHex = (col) => `#${oklchToLin(col).map((v) => {
  const c = Math.min(1, Math.max(0, v));
  const g = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(255 * g).toString(16).padStart(2, '0');
}).join('')}`;

/** Un OKLCH écrit comme index.css l'écrit — donc relu tel quel par la sonde et
 *  compris tel quel par le moteur. PUR. */
export const oklchCss = ({ L, C, H }) => `oklch(${L.toFixed(1)}% ${C.toFixed(3)} ${H.toFixed(1)})`;

/** LES FONDS PROPOSÉS — les crans 50 de la palette que Tailwind livre (relevés
 *  dans son thème, pas inventés), donc TOUS déjà dans la bande : ce que la
 *  pastille montre est exactement ce que la page prendra. */
export const UI_BG_PRESETS = [
  { id: 'slate', label: 'Slate', oklch: UI_BG_SHIPPED_OKLCH },
  { id: 'zinc', label: 'Zinc', oklch: { L: 98.5, C: 0, H: 0 } },
  { id: 'stone', label: 'Stone', oklch: { L: 98.5, C: 0.001, H: 106.423 } },
  { id: 'sky', label: 'Sky', oklch: { L: 97.7, C: 0.013, H: 236.62 } },
  { id: 'emerald', label: 'Emerald', oklch: { L: 97.9, C: 0.021, H: 166.113 } },
  { id: 'amber', label: 'Amber', oklch: { L: 98.7, C: 0.022, H: 95.277 } },
  { id: 'rose', label: 'Rose', oklch: { L: 96.9, C: 0.015, H: 12.422 } },
  { id: 'violet', label: 'Violet', oklch: { L: 96.9, C: 0.016, H: 293.756 } }
].map((p) => ({ ...p, hex: oklchToHex(p.oklch) }));

/** LES DEUX CRANS D'UNE PAGE CHOISIE — la couleur ramenée dans la bande, et le
 *  cran 100 DÉRIVÉ (même teinte, même chroma, `UI_BG_GAP` de luminosité en
 *  moins). Une couleur illisible retombe sur la page livrée ; le réglage vide
 *  (`UI_BG_DEFAULT`) rend donc, lui aussi, la page livrée.
 *  DE NUIT, la même couleur tombe dans LA BANDE SOMBRE (voir plus haut) : le
 *  cran 100, lui, monte cet coup-ci (`UI_BG_DARK_GAP`) — sur une page sombre,
 *  c'est le panneau qui est PLUS CLAIR que la page, comme dans les peaux
 *  livrées. PUR. */
export const uiBgStops = (hex, pageMode = UI_BG_PAGE_MODE_DEFAULT) => {
  const pick = hexToOklch(hex) || UI_BG_SHIPPED_OKLCH;
  if (pageMode === UI_BG_PAGE_MODE_DARK) {
    /* où tombe la couleur choisie DANS la bande des pages claires : la page
       livrée (98.4 %) est presque au sommet, une page sombre choisie est au
       plancher — et c'est cette position qui est reportée dans la bande sombre,
       donc aucune couleur ne peut éclairer la page au point de perdre l'encre. */
    const t = Math.min(1, Math.max(0, (pick.L - UI_BG_FLOOR) / (UI_BG_CEIL - UI_BG_FLOOR)));
    const L = UI_BG_DARK_LO + (UI_BG_DARK_HI - UI_BG_DARK_LO) * t;
    const C = sRGBChroma({ L, C: Math.min(UI_BG_DARK_CAP, pick.C), H: pick.H });
    return { page: { L, C, H: pick.H }, card: { L: L + UI_BG_DARK_GAP, C, H: pick.H } };
  }
  const L = Math.min(UI_BG_CEIL, Math.max(UI_BG_FLOOR, pick.L));
  const C = sRGBChroma({ L, C: Math.min(UI_BG_CAP, pick.C), H: pick.H });
  return { page: { L, C, H: pick.H }, card: { L: L - UI_BG_GAP, C, H: pick.H } };
};

/* ── LES TROIS ENCRES D'UN MOTIF ────────────────────────────────────────────
   « i motivi sono sempre linee » : les motifs DESSINÉS (vagues, écailles,
   damier, tartan, bulles, confettis…) ne se contentent plus d'un filet. Ils
   lisent TROIS couleurs — et ces trois couleurs ne sont pas un catalogue de
   plus : elles se DÉRIVENT de l'accent que l'opérateur a choisi, exactement
   comme les onze crans de sa peau.
     · l'encre du filet : le neutre de la page (slate-900 au jour, slate-200 de
       nuit) — le motif reste donc un repère, même colorié ;
     · la teinte de l'accent (`UI_BG_INK_TURNS[0]`, soit 0°) ;
     · son complémentaire (`UI_BG_INK_TURNS[1]`, soit +150°, le « split
       complement » des nuanciers) — d'où le multicolore, et il suit la peau.
   Les deux teintes sont posées à la MÊME LUMIÈRE que le filet neutre (44 % au
   jour, 84 % de nuit, un chroma de pastel ramené dans le gamut sRGB) : changer
   d'accent change les couleurs du motif sans changer son poids sur la page —
   c'est ce que la sonde mesure, à l'alpha près. */
export const UI_BG_INK_DAY = '15 23 42';       /* l'encre livrée des filets */
export const UI_BG_INK_NIGHT = '226 232 240';  /* la même, claire, de nuit */
export const UI_BG_INK_TINT = { day: { L: 44, C: 0.13 }, night: { L: 84, C: 0.075 } };
export const UI_BG_INK_TURNS = [0, 150];

/** Un hexadécimal de six chiffres écrit comme `rgb()` l'attend : « 42 78 153 »,
 *  ce que `rgb(var(--lab-page-ink) / 0.06)` recopie tel quel. PUR. */
export const rgbTriplet = (hex) => [1, 3, 5]
  .map((i) => parseInt(String(hex).slice(i, i + 2), 16))
  .join(' ');

/** LES TROIS ENCRES retenues pour un accent et un régime de page — dans l'ordre
 *  où la feuille les lit (`--lab-page-ink`, `-2`, `-3`). PUR. */
export const uiBgInkRgb = (accent, pageMode = UI_BG_PAGE_MODE_DEFAULT) => {
  const okl = hexToOklch(accent) || hexToOklch(UI_CUSTOM_ACCENT_DEFAULT);
  const night = pageMode === UI_BG_PAGE_MODE_DARK;
  const tint = night ? UI_BG_INK_TINT.night : UI_BG_INK_TINT.day;
  return [
    night ? UI_BG_INK_NIGHT : UI_BG_INK_DAY,
    ...UI_BG_INK_TURNS.map((turn) => {
      const H = (okl.H + turn) % 360;
      return rgbTriplet(oklchToHex({ L: tint.L, C: sRGBChroma({ L: tint.L, C: tint.C, H }), H }));
    })
  ];
};

/** Le réglage retenu, toujours utilisable (une couleur illisible, une famille ou
 *  un motif inconnus retombent sur le défaut livré). PUR. */
export const uiCustomSkinOf = (raw) => ({
  accent: (raw && /^#[0-9a-f]{6}$/i.test(String(raw.accent || '')))
    ? String(raw.accent).toLowerCase() : UI_CUSTOM_ACCENT_DEFAULT,
  neutral: UI_CUSTOM_NEUTRALS.some((n) => n.id === (raw && raw.neutral))
    ? raw.neutral : UI_CUSTOM_NEUTRAL_DEFAULT,
  /* le régime des pages — le jour (livré) ou la nuit. Il ne sert à rien sans
     couleur de page ni motif, mais il se garde, comme le reste du réglage. */
  pageMode: UI_BG_PAGE_MODES.some((m) => m.id === (raw && raw.pageMode))
    ? raw.pageMode : UI_BG_PAGE_MODE_DEFAULT,
  bg: (raw && /^#[0-9a-f]{6}$/i.test(String(raw.bg || '')))
    ? String(raw.bg).toLowerCase() : UI_BG_DEFAULT,
  pattern: UI_BG_PATTERNS.some((p) => p.id === (raw && raw.pattern))
    ? raw.pattern : UI_BG_PATTERN_DEFAULT,
  /* les deux réglages du motif : la force de son encre et l'échelle de sa
     trame. Ils ne servent à rien sans motif — mais ils se gardent, comme la
     couleur de page se garde pendant qu'on regarde une autre peau. */
  ink: UI_BG_PATTERN_INKS.some((i) => i.id === (raw && raw.ink))
    ? raw.ink : UI_BG_INK_DEFAULT,
  scale: UI_BG_PATTERN_SCALES.some((s) => s.id === (raw && raw.scale))
    ? raw.scale : UI_BG_SCALE_DEFAULT
});

/** Les variables d'une peau personnalisée : les onze crans de l'accent (ceux du
 *  RÉGIME de page choisi — de jour la couleur reste la couleur, de nuit elle se
 *  retourne par la recette des peaux sombres), plus `--lab-tone` (la famille
 *  neutre, pour la miniature ET pour <html>), plus — quand un fond a été choisi
 *  — LES DEUX CRANS DE LA PAGE, ramenés dans la bande du régime (utils :
 *  `uiBgStops`), plus — quand un motif a été choisi — la force de son encre
 *  (`--lab-page-alpha`), l'échelle de sa trame (`--lab-page-scale`) ET SES TROIS
 *  ENCRES (`--lab-page-ink`, `-2`, `-3` : le filet neutre puis les deux teintes
 *  tirées de l'accent, voir `uiBgInkRgb`).
 *  Écrites EN LIGNE, donc au-dessus du bloc de la famille neutre : un fond
 *  choisi l'emporte sur le `tone` qu'on lit à côté.
 *  Le NOM du motif, lui, n'est pas une variable : c'est l'attribut `data-pattern`
 *  — et le RÉGIME des pages, lui non plus : c'est `data-pagemode`. PUR. */
export const uiSkinCustomVars = (raw) => {
  const custom = uiCustomSkinOf(raw);
  const vars = { ...uiSkinCustomRamp(custom.accent, custom.pageMode), '--lab-tone': custom.neutral };
  if (custom.bg) {
    const { page, card } = uiBgStops(custom.bg, custom.pageMode);
    vars['--color-slate-50'] = oklchCss(page);
    vars['--color-slate-100'] = oklchCss(card);
  }
  /* La feuille multiplie SES pas par ces deux nombres : la géométrie des vingt
     motifs n'est donc écrite qu'une fois (index.css). Sans motif, rien n'est
     écrit — une variable qui ne sert à rien ne doit pas traîner sur <html>. */
  if (custom.pattern !== UI_BG_PATTERN_DEFAULT) {
    vars['--lab-page-alpha'] = String(uiBgPatternAlpha(custom.ink));
    vars['--lab-page-scale'] = String(uiBgPatternScale(custom.scale));
    const inks = uiBgInkRgb(custom.accent, custom.pageMode);
    vars['--lab-page-ink'] = inks[0];
    vars['--lab-page-ink-2'] = inks[1];
    vars['--lab-page-ink-3'] = inks[2];
  }
  return vars;
};

/** Le réglage stocké (localStorage indisponible ⇒ le défaut livré) — celui de
 *  CET opérateur, sinon celui du POSTE, comme pour la peau elle-même. */
export const readUiCustomSkin = (operator = null) => {
  try {
    const own = uiCustomSkinKeyOf(operator);
    const raw = localStorage.getItem(own);
    if (raw !== null) return uiCustomSkinOf(JSON.parse(raw || 'null'));
    if (own !== UI_CUSTOM_KEY) return uiCustomSkinOf(JSON.parse(localStorage.getItem(UI_CUSTOM_KEY) || 'null'));
    return uiCustomSkinOf(null);
  } catch { return uiCustomSkinOf(null); }
};

/* ── LA PEAU EN SERVICE — celle qu'`applyUiSkin` a posée en dernier ──────────
   `saveUiCustomSkin` s'en sert pour décider s'il doit appliquer, et c'est la
   bonne question à poser : « la peau personnalisée est-elle celle en service ? »
   RE-LIRE le stockage pour y répondre serait faux — et c'est le défaut que ce
   bloc corrige. L'écriture peut être REFUSÉE (quota dépassé, navigation privée),
   la clé peut porter une valeur que le module ne reconnaît pas (une peau écrite
   par une autre version, ou par la synchronisation entre postes), ou la clé
   d'opérateur peut n'être pas la même au moment du clic : dans les trois cas la
   relecture ne dit pas « custom », et le réglage qu'on vient de choisir
   demeurait sans effet. C'est très exactement le symptôme rapporté — « les peaux
   livrées marchent, mais si je clique sur Custom et que je change les couleurs,
   rien ne se passe » : une peau livrée, elle, n'a rien à relire (saveUiSkin). */
let appliedSkinId = null;

/** La peau qu'`applyUiSkin` a posée en dernier (null tant qu'aucune ne l'a été).
 *  PUR — et la seule réponse honnête à « qu'est-ce qui est en service ? ». */
export const appliedUiSkinId = () => appliedSkinId;

/** Écrire le réglage — et APPLIQUER tout de suite quand la peau personnalisée
 *  est celle en service (sinon le réglage resterait sans effet). On applique CE
 *  QU'ON VIENT DE CHOISIR, jamais ce qu'on relit : c'est ce que le clic veut
 *  dire, et c'est vrai même si le stockage a refusé d'en garder la trace. */
export const saveUiCustomSkin = (raw, operator = null) => {
  const custom = uiCustomSkinOf(raw);
  try { localStorage.setItem(uiCustomSkinKeyOf(operator), JSON.stringify(custom)); } catch { /* le stockage peut refuser : le choix s'applique quand même */ }
  if (appliedSkinId === UI_SKIN_CUSTOM || readUiSkin(operator) === UI_SKIN_CUSTOM) {
    applyUiSkin(UI_SKIN_CUSTOM, operator, custom);
  }
  return custom;
};

/* The skin an id names, or the reference — so a name written by an older (or
   newer) build can never leave the program unstyled. */
export const uiSkinById = (id) => UI_SKINS.find((s) => s.id === id) || UI_SKINS[0];

/* The stored skin, always usable: anything unreadable or unknown falls back to
   the reference (localStorage may be unavailable — private mode).

   `operator` = the operator whose skin we want. When he has never chosen one,
   the COMPUTER's skin is the starter value (a machine that was already painted
   stays painted the same way the first time somebody signs in on it); without
   any operator at all, this IS the computer's skin. */
export const readUiSkin = (operator = null) => {
  try {
    const own = uiSkinKeyOf(operator);
    const raw = localStorage.getItem(own);
    if (raw !== null) return uiSkinById(raw).id;
    if (own !== UI_SKIN_KEY) {
      const device = localStorage.getItem(UI_SKIN_KEY);
      if (device !== null) return uiSkinById(device).id;
    }
    return UI_SKIN_DEFAULT;
  } catch {
    return UI_SKIN_DEFAULT;
  }
};

/* `id` = the reference ⇒ the attribute is REMOVED (the shipped palette comes
   back exactly as Tailwind defines it). The custom skin is the one case whose
   accent ramp — and the page colour the user chose — is NOT in the stylesheet:
   its eleven stops depend on a colour the user picked, so they are written
   INLINE on <html> — and cleared for every other skin, or they would outlive
   the choice. The PATTERN is the stylesheet's job (index.css): here we only
   raise or drop `data-pattern` on <html>, which paints every page at once.
   `operator` : l'accent lu (peau personnalisée) est celui de CET opérateur.
   `custom` : le réglage qu'on vient d'écrire, quand on le connaît — le poser
   tel quel évite de relire un stockage qui a pu REFUSER l'écriture (voir
   `saveUiCustomSkin`). Il est retenu : c'est « la peau en service ». */
export const applyUiSkin = (id, operator = null, custom = null) => {
  if (typeof document === 'undefined') return; // unit tests (node) have no DOM
  const root = document.documentElement;
  if (!root) return;
  const skin = uiSkinById(id);
  if (!root.dataset) return;
  /* les clés à effacer : TOUTE la rampe d'accent, `--lab-tone`, les deux crans
     de la page, le régime des pages et les réglages du motif — qu'un fond ou un
     motif aient été choisis ou non (sinon un fond posé hier survivrait au
     passage à une autre peau). */
  const customKeys = [
    ...Object.keys(uiSkinCustomRamp(UI_CUSTOM_ACCENT_DEFAULT)),
    '--lab-tone', '--color-slate-50', '--color-slate-100',
    '--lab-page-alpha', '--lab-page-scale',
    '--lab-page-ink', '--lab-page-ink-2', '--lab-page-ink-3'
  ];
  const clearCustom = () => {
    if (root.style) customKeys.forEach((k) => root.style.removeProperty(k));
    delete root.dataset.tone;
    delete root.dataset.pattern;
    delete root.dataset.pagemode;
  };
  if (skin.id === UI_SKIN_CUSTOM) {
    const settings = uiCustomSkinOf(custom || readUiCustomSkin(operator));
    /* ON EFFACE D'ABORD : un fond qu'on vient de retirer (ou l'accent d'un autre
       opérateur) doit disparaître des variables en ligne, sinon l'écriture qui
       suit ne ferait qu'ajouter le réglage courant À l'ancien — la page
       resterait peinte avec la couleur qu'on vient d'abandonner. */
    clearCustom();
    if (root.style) Object.entries(uiSkinCustomVars(settings)).forEach(([k, v]) => root.style.setProperty(k, v));
    root.dataset.tone = settings.neutral;
    /* le régime des pages : « day » (le défaut) n'écrit AUCUN attribut — la
       feuille garde alors ses pages claires, et l'attribut ne traîne pas dans
       le DOM. De nuit, c'est index.css qui retourne la palette (la sienne, celle
       des peaux livrées) : le JavaScript n'en écrit pas un seul cran. */
    if (settings.pageMode === UI_BG_PAGE_MODE_DEFAULT) delete root.dataset.pagemode;
    else root.dataset.pagemode = settings.pageMode;
    /* le motif : « none » (le défaut) n'écrit AUCUN attribut, donc la feuille
       ne peint rien et l'attribut ne traîne pas dans le DOM. */
    if (settings.pattern === UI_BG_PATTERN_DEFAULT) delete root.dataset.pattern;
    else root.dataset.pattern = settings.pattern;
    root.dataset.skin = UI_SKIN_CUSTOM;
    appliedSkinId = UI_SKIN_CUSTOM;
    return;
  }
  clearCustom();
  if (skin.id === UI_SKIN_DEFAULT) delete root.dataset.skin;
  else root.dataset.skin = skin.id;
  appliedSkinId = skin.id;
};

/* Écrire la peau — celle de CET opérateur quand on en connaît un, celle du
   POSTE sinon (et c'est celle-ci qui sert de départ à tout opérateur : c'est
   donc aussi le geste de l'écran d'entrée, avant toute connexion). */
export const saveUiSkin = (id, operator = null) => {
  const skin = uiSkinById(id);
  try { localStorage.setItem(uiSkinKeyOf(operator), skin.id); } catch { /* ignore */ }
  applyUiSkin(skin.id, operator);
};

/* L'identité de l'onglet telle qu'App.jsx la mémorise (sessionStorage) : la peau
   de l'opérateur connecté peut donc être posée AVANT le premier rendu, sans
   attendre React — sinon un rechargement peindrait d'abord la palette du poste
   avant de revenir à la sienne. */
export const SESSION_OPERATOR_KEY = 'labCurrentUser';

/** L'opérateur de CETTE session, tel que l'application l'a mémorisé (null quand
 *  personne n'est connecté, ou quand la mémoire est illisible). Ne lit que
 *  sessionStorage — aucun effet de bord. */
export const sessionOperator = () => {
  try {
    const raw = sessionStorage.getItem(SESSION_OPERATOR_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
};

/* Called once by main.jsx, before React renders — with the operator of the tab
   session when there is one. */
export const applyStoredUiSkin = (operator = null) => applyUiSkin(readUiSkin(operator), operator);

/* …et l'appel de main.jsx : la peau de l'opérateur de la session, sinon celle du
   poste. */
export const applyStoredUiSkinForSession = () => applyStoredUiSkin(sessionOperator());
