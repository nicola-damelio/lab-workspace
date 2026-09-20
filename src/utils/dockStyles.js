/* =============================================================================
   dockStyles.js — « 🧬 Docking » : DÉFINITION des styles de rôles.

   Quand le mode « 🧬 Docking » est actif, chaque résultat d'amarrage (cluster ou
   pose) est rendu avec les MÊMES styles : une partie PROTÉINE et une partie
   LIGAND. Historiquement ces styles étaient capturés silencieusement sur ce qui
   était visible au moment où le bouton passait à ON — impossible donc de CHOISIR
   le look d'amarrage (le style affiché changeait au lieu d'être défini).

   Ils sont désormais un RÉGLAGE du viewer, défini par l'utilisateur (deux menus
   + 📸 « copier la vue » + ↺ « défaut ») et conservé d'une page à l'autre dans
   localStorage. Le tout premier usage (aucun réglage enregistré) continue de
   copier la vue, pour ne rien changer au geste historique.
   ============================================================================= */

// Jetons de style acceptés — les mêmes que les menus de style de l'application.
export const DOCK_STYLE_TOKENS = ['cartoon', 'ribbon', 'tube', 'ball+stick', 'sticks', 'lines', 'spheres', 'surface'];

export const DOCK_STYLE_LABELS = {
  cartoon: 'Cartoon',
  ribbon: 'Ribbon',
  tube: 'Tube',
  'ball+stick': 'Ball & Stick',
  sticks: 'Sticks',
  lines: 'Lines',
  spheres: 'Spheres',
  surface: 'Surface'
};

// Look d'amarrage par défaut : ruban pour la protéine, bâtonnets-boules pour le
// ligand (le classique d'une figure de docking).
export const DOCK_STYLE_DEFAULT = Object.freeze({ protein: 'ribbon', ligand: 'ball+stick' });

// Clé localStorage (le viewer range déjà ses préférences « labViewer… »).
export const DOCK_STYLE_KEY = 'labViewerDockStyle';

const isToken = (t) => DOCK_STYLE_TOKENS.includes(t);

// Storage par défaut = celui du navigateur. On passe par `window` pour ne pas
// toucher au `localStorage` désactivé que Node expose sans --localstorage-file
// (le lire déclenche un avertissement expérimental et lève à l'usage).
const defaultStorage = () => {
  try { return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null; } catch { return null; }
};

/* Normalise un réglage lu/écrit { protein, ligand } :
   - les jetons inconnus retombent sur le défaut du rôle ;
   - `defined` dit si l'utilisateur a DÉJÀ choisi un style : seul un réglage
     inexistant (ou vide) laisse le mode « 🧬 Docking » capturer la vue. */
export const normalizeDockRoleStyles = (raw) => {
  const src = raw && typeof raw === 'object' ? raw : {};
  const protein = isToken(src.protein) ? src.protein : '';
  const ligand = isToken(src.ligand) ? src.ligand : '';
  if (!protein && !ligand) return { ...DOCK_STYLE_DEFAULT, defined: false };
  return {
    protein: protein || DOCK_STYLE_DEFAULT.protein,
    ligand: ligand || DOCK_STYLE_DEFAULT.ligand,
    defined: true
  };
};

// Lit le réglage enregistré (localStorage) ; sans réglage : défaut + defined:false.
export const loadDockRoleStyles = (storage) => {
  const store = storage || defaultStorage();
  if (!store) return { ...DOCK_STYLE_DEFAULT, defined: false };
  try {
    return normalizeDockRoleStyles(JSON.parse(store.getItem(DOCK_STYLE_KEY) || 'null'));
  } catch {
    return { ...DOCK_STYLE_DEFAULT, defined: false };
  }
};

// Enregistre le réglage (sans le drapeau `defined`, recalculé à la lecture).
// Un réglage SANS aucun jeton valide n'est jamais écrit — et la clé est retirée
// s'il en existait une : une valeur illisible ne doit pas se transformer en
// « look défini » (elle laisserait le mode Docking appliquer le défaut au lieu
// de copier la vue au premier passage à ON).
export const saveDockRoleStyles = (styles, storage) => {
  const store = storage || defaultStorage();
  const s = normalizeDockRoleStyles(styles);
  if (!store) return s;
  try {
    if (s.defined) store.setItem(DOCK_STYLE_KEY, JSON.stringify({ protein: s.protein, ligand: s.ligand }));
    else if (typeof store.removeItem === 'function') store.removeItem(DOCK_STYLE_KEY);
  } catch { /* quota plein / mode privé : le réglage reste en mémoire */ }
  return s;
};

// Les mêmes styles, mais pris comme « définis » : c'est ce qu'on écrit quand
// l'utilisateur choisit lui-même (menu, 📸, ↺) ou quand on capture la vue.
export const dockRoleStylesFromCapture = (captured) => ({ ...normalizeDockRoleStyles(captured), defined: true });
