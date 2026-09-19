/* =========================================================================
   src/utils/objectWindowDock.js
   OÙ VIT LA FENÊTRE DE L'OBJET de l'Image Builder — en BAS (sa place
   historique, sous le canvas), en HAUT, ou d'un des deux CÔTÉS.

   POURQUOI c'est un réglage GARDÉ (localStorage) et pas un état d'écran de
   plus : la place que la fenêtre doit prendre dépend de l'écran de l'utilisateur
   (un portable haut mais étroit veut la fenêtre en bas, un écran large veut la
   garder à droite, une tablette en haut) — exactement comme l'échelle
   d'affichage (voir utils/uiScale.js). C'est donc une propriété du NAVIGATEUR,
   jamais du dataset ni de la composition : elle ne voyage dans aucun fichier.

   `bottom` / `top` : la fenêtre est une BARRE sur toute la largeur (ses trois
   sections côte à côte, `PropertiesPanel({ bar: true })`).
   `left` / `right`  : une COLONNE étroite le long du canvas, où les trois
   sections s'empilent (`bar: false`) — elles n'ont pas la largeur pour se
   ranger côte à côte.
   ========================================================================= */

export const OBJECT_WINDOW_DOCKS = ['bottom', 'top', 'left', 'right'];

/** Clé localStorage : par navigateur, comme UI_SCALE_KEY. */
export const OBJECT_WINDOW_DOCK_KEY = 'labObjectWindowDock';

/** La place historique : la fenêtre est SOUS le canvas. */
export const OBJECT_WINDOW_DOCK_DEFAULT = 'bottom';

/** Les quatre places, dans l'ordre où les boutons les proposent, avec leur
 *  flèche (le bouton est court : c'est l'infobulle qui explique). */
export const OBJECT_WINDOW_DOCK_CHOICES = [
  { id: 'bottom', icon: '⬇', label: 'Bottom', hint: 'Dock the object window UNDER the canvas — its historical place' },
  { id: 'top', icon: '⬆', label: 'Top', hint: 'Dock the object window ABOVE the canvas — useful when the figure is at the bottom of the screen' },
  { id: 'left', icon: '⬅', label: 'Left', hint: 'Dock the object window as a column on the LEFT of the canvas — the window keeps all its height' },
  { id: 'right', icon: '➡', label: 'Right', hint: 'Dock the object window as a column on the RIGHT of the canvas — the window keeps all its height' }
];

/** A valid place, else the historical one (never ''. The value may come from an
 *  older build, or from a localStorage someone edited). */
export const normalizeObjectWindowDock = (v) => {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return OBJECT_WINDOW_DOCKS.includes(s) ? s : OBJECT_WINDOW_DOCK_DEFAULT;
};

/** true for the two places that put the window on a SIDE (a narrow column,
 *  where the three sections stack instead of sitting side by side). */
export const objectWindowDockIsSide = (dock) =>
  normalizeObjectWindowDock(dock) === 'left' || normalizeObjectWindowDock(dock) === 'right';

/** true for the two places where the window is a BAR on the full width (the
 *  three sections side by side — `PropertiesPanel({ bar: true })`). */
export const objectWindowDockIsBar = (dock) => !objectWindowDockIsSide(dock);

/** La place gardée par ce navigateur (toute valeur illisible retombe sur le bas). */
export const readObjectWindowDock = () => {
  try {
    const raw = localStorage.getItem(OBJECT_WINDOW_DOCK_KEY);
    return normalizeObjectWindowDock(raw === null ? OBJECT_WINDOW_DOCK_DEFAULT : raw);
  } catch {
    /* Mode privé / stockage refusé : la place historique convient toujours. */
    return OBJECT_WINDOW_DOCK_DEFAULT;
  }
};

/** Garde une place (rend la place réellement retenue, donc utilisable comme
 *  valeur d'état : `setPanelDock(saveObjectWindowDock(dock))`). */
export const saveObjectWindowDock = (dock) => {
  const d = normalizeObjectWindowDock(dock);
  try { localStorage.setItem(OBJECT_WINDOW_DOCK_KEY, d); } catch { /* ignore */ }
  return d;
};

/** Le libellé d'une place, pour une infobulle (« Bottom » …). */
export const objectWindowDockLabel = (dock) => {
  const d = normalizeObjectWindowDock(dock);
  const found = OBJECT_WINDOW_DOCK_CHOICES.find((c) => c.id === d);
  return found ? found.label : 'Bottom';
};
