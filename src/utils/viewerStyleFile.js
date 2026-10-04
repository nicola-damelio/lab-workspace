/* =========================================================================
   src/utils/viewerStyleFile.js — LE STYLE QU'UNE EXPÉRIENCE A RETENU.

   La demande de cette session : « when an experiment opens, after bringing back to
   live its files (pdb, trajectory etc) it should remember also the style file
   (called snapshot or in its absence the cumulative) of the viewer and apply it
   automatically. »

   Les deux styles du viewer — 🎨 CUMULATIVE (un dictionnaire de styles par CLASSE
   moléculaire) et 📷 SNAPSHOT (la photographie d'UNE scène, clé par section) —
   vivaient jusqu'ici dans le navigateur SEUL (`labViewerThemes` /
   `labViewerSnapshots`, voir NMRMoleculeViewer.jsx). Les fichiers, eux, revenaient
   du Drive (nom déclaré + pointeur, voir utils/driveRestore.js et
   utils/driveExperimentFiles.js) : la même expérience rouverte sur un autre poste
   rendait donc l'image BRUTE — bon .pdb, bon .xtc, style perdu.

   Ce module donne au style le même voyage qu'aux fichiers :

     · UN FICHIER JSON déposé dans le dossier Drive de l'expérience, à côté des
       .pdb et des .xtc, sous un nom CANONIQUE par mode
       (`viewer-style-snapshot.json` / `viewer-style-cumulative.json`). Le contenu
       est celui du ⬇ Export du viewer (`{ mode, name, entry }`) : le ⬆ Import le
       relit tel quel, et un humain aussi ;
     · UNE MÉMOIRE par instance (`labViewerStyle::<slug>`), qui rend le rappel
       instantané et HORS LIGNE : à l'ouverture on applique ce que CE poste a
       retenu, le dossier n'est lu que si la mémoire ne suffit pas ;
     · LA RÈGLE DE PRÉFÉRENCE DE LA DEMANDE : le SNAPSHOT de l'expérience gagne,
       le CUMULATIF s'applique EN SON ABSENCE (voir VIEWER_STYLE_PREFERENCE).

   Rien n'est fabriqué quand il n'y a rien : une expérience sans fichier de style
   n'est ni écrite, ni annoncée, et le viewer garde son style de base.

   AUCUN IMPORT : les règles sont pures (et EXÉCUTÉES par
   _viewer_style_recall_test.mjs), les deux seules lignes qui touchent le stockage
   sont la lecture et l'écriture de la mémoire ci-dessous.
   ========================================================================= */

/* ── 1. LE FICHIER ───────────────────────────────────────────────────────── */

/** Ce qui dit qu'un JSON est un style du viewer (et non un autre .json du dossier). */
export const VIEWER_STYLE_APP = 'lab-viewer-style';
export const VIEWER_STYLE_FILE_VERSION = 1;
/** L'extension cherchée dans le dossier de l'expérience. */
export const VIEWER_STYLE_EXT = 'json';
/* LES DEUX NOMS CANONIQUES — fixes, donc UN fichier par mode dans le dossier : un
   `uploadLocalFile` du même nom REMPLACE le contenu (il ne sème pas de doublon),
   et le mode se choisit en lisant la LISTE, sans rien télécharger. */
export const VIEWER_STYLE_FILE_STEMS = {
  snapshot: 'viewer-style-snapshot',
  theme: 'viewer-style-cumulative'
};
export const VIEWER_STYLE_FILE_NAMES = {
  snapshot: `${VIEWER_STYLE_FILE_STEMS.snapshot}.json`,
  theme: `${VIEWER_STYLE_FILE_STEMS.theme}.json`
};
/* L'ORDRE DE PRÉFÉRENCE (la demande, mot pour mot) : « the style file (called
   snapshot or in its absence the cumulative) » — le snapshot d'abord. */
export const VIEWER_STYLE_PREFERENCE = ['snapshot', 'theme'];

/** Le nom de fichier d'un mode. Un mode inconnu retombe sur le SNAPSHOT : aucun
 *  troisième nom ne peut apparaître. PUR. */
export const viewerStyleFileName = (mode) => VIEWER_STYLE_FILE_NAMES[mode === 'theme' ? 'theme' : 'snapshot'];

/** La forme COMPARABLE d'un nom de fichier : sans extension, en minuscules, tout
 *  séparateur ramené au tiret. Un fichier renommé à la main (« Viewer style
 *  snapshot (2026).json ») reste donc reconnu. PUR. */
export const viewerStyleStem = (name = '') => String(name || '')
  .replace(/\.[A-Za-z0-9]{1,8}$/, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

/** LES NOMS QUE LE VIEWER DONNE LUI-MÊME À SES EXPORTS (⬇ Export de la bande
 *  🎨 Styles) : `viewer-snapshot-<nom>.json` / `viewer-theme-<nom>.json` (voir
 *  exportActiveEnv dans NMRMoleculeViewer.jsx). Un style EXPORTÉ puis DÉPOSÉ
 *  dans le dossier de l'expérience est donc reconnu par le rappel automatique —
 *  c'est le cas signalé : « the styles file is not read automatically ». */
export const VIEWER_STYLE_EXPORT_STEMS = { snapshot: 'viewer-snapshot', theme: 'viewer-theme' };

/** LE MODE d'un fichier d'après SON NOM — '' quand ce n'est pas un fichier de
 *  style du viewer. Les DEUX noms canoniques, un nom renommé à la main qui les
 *  commence, ET les deux noms d'export du viewer. PUR. */
export const viewerStyleModeOfName = (name = '') => {
  const stem = viewerStyleStem(name);
  if (!stem) return '';
  for (const mode of VIEWER_STYLE_PREFERENCE) {
    const known = VIEWER_STYLE_FILE_STEMS[mode];
    const exported = VIEWER_STYLE_EXPORT_STEMS[mode];
    if (stem === known || stem.startsWith(`${known}-`)) return mode;
    if (stem === exported || stem.startsWith(`${exported}-`)) return mode;
  }
  return '';
};

/** Vrai quand ce nom est celui d'un fichier de style du viewer. PUR. */
export const isViewerStyleFile = (name = '') => !!viewerStyleModeOfName(name);

/** LE FICHIER À APPLIQUER parmi les fichiers d'un dossier : le snapshot de
 *  l'expérience, sinon (en son absence) le cumulatif ; à l'intérieur d'un mode le
 *  plus RÉCENT gagne (le fichier qu'on vient d'y déposer). PUR — c'est la règle de
 *  la demande, exécutable telle quelle. */
export const pickViewerStyleFile = (files = []) => {
  const list = (Array.isArray(files) ? files : []).filter((f) => f && viewerStyleModeOfName(f.name));
  const recent = (subset) => [...subset].sort((a, b) => (
    (Date.parse(b.modifiedTime || '') || 0) - (Date.parse(a.modifiedTime || '') || 0)
  ));
  for (const mode of VIEWER_STYLE_PREFERENCE) {
    const found = recent(list.filter((f) => viewerStyleModeOfName(f.name) === mode))[0];
    if (found) return found;
  }
  return null;
};

/** LE CONTENU D'UN FICHIER DE STYLE : le format du ⬇ Export du viewer, plus ce
 *  qui dit d'où il vient. PUR. */
export const viewerStyleFilePayload = ({ mode, name, entry, instance = '', savedAt = '' } = {}) => ({
  app: VIEWER_STYLE_APP,
  version: VIEWER_STYLE_FILE_VERSION,
  mode: mode === 'theme' ? 'theme' : 'snapshot',
  name: String(name || ''),
  instance: String(instance || ''),
  savedAt: savedAt || new Date().toISOString(),
  entry: (entry && typeof entry === 'object') ? entry : null
});

/** LE LECTEUR d'un fichier de style — la tolérance du ⬆ Import du viewer :
 *  l'enveloppe `{ mode, name, entry }`, une entrée NUE, et `null` quand le fichier
 *  ne porte aucun style (un autre .json du dossier ne peut donc pas être appliqué
 *  par erreur). PUR. */
export const parseViewerStyleFile = (text = '') => {
  let raw = null;
  try { raw = JSON.parse(String(text || '')); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const entry = (raw.entry && typeof raw.entry === 'object')
    ? raw.entry
    : ((raw.classes || raw.sections || raw.global) ? raw : null);
  if (!entry) return null;
  const mode = (raw.mode === 'theme' || raw.mode === 'snapshot')
    ? raw.mode
    : (entry.classes ? 'theme' : 'snapshot');
  const name = String(raw.name || '').trim() || (mode === 'theme' ? 'Theme' : 'Snapshot');
  return { mode, name, entry };
};

/* ── 2. LA MÉMOIRE PAR INSTANCE ──────────────────────────────────────────── */

/** Le préfixe et le séparateur de la mémoire d'une installation : la clé devient
 *  `labViewerStyle::<slug>`, et la clé GÉNÉRALE reste celle d'un viewer monté hors
 *  de toute expérience — le repère EXACT de la session 🧪 (voir
 *  pymolSessionInstanceSlug dans le viewer, qui DÉFINIT le slug : la règle n'est
 *  pas réécrite ici). PUR. */
export const VIEWER_STYLE_MEMORY_KEY = 'labViewerStyle';
export const VIEWER_STYLE_INSTANCE_SEP = '::';
export const viewerStyleMemoryKey = (slug = '') => {
  const s = String(slug || '').trim();
  return s ? `${VIEWER_STYLE_MEMORY_KEY}${VIEWER_STYLE_INSTANCE_SEP}${s}` : VIEWER_STYLE_MEMORY_KEY;
};

/** La mémoire telle qu'on l'écrit — ou `null` quand il n'y a pas de nom (sans nom
 *  il n'y a rien à retenir, et la clé porterait une promesse creuse). PUR. */
export const viewerStyleMemoryOf = ({ mode, name, at = '' } = {}) => {
  const clean = String(name || '').trim();
  if (!clean) return null;
  return { mode: mode === 'theme' ? 'theme' : 'snapshot', name: clean, at: at || new Date().toISOString() };
};

/** La mémoire d'une installation (null si rien / illisible). C'est ICI, et nulle
 *  part ailleurs, que la mémoire est lue. */
export const loadViewerStyleMemory = (key) => {
  try {
    const raw = JSON.parse(localStorage.getItem(String(key || VIEWER_STYLE_MEMORY_KEY)) || 'null');
    if (!raw || typeof raw !== 'object') return null;
    return viewerStyleMemoryOf(raw);
  } catch { return null; }
};

/** Écrire la mémoire (rend l'entrée écrite, ou null). Jamais bloquant : un quota
 *  plein ne casse pas le geste qui l'a demandée. */
export const saveViewerStyleMemory = (key, memory) => {
  const entry = viewerStyleMemoryOf(memory || {});
  if (!entry) return null;
  try { localStorage.setItem(String(key || VIEWER_STYLE_MEMORY_KEY), JSON.stringify(entry)); } catch { /* ignore */ }
  return entry;
};

/** L'ENTRÉE que la mémoire désigne, SI ET SEULEMENT SI elle existe vraiment dans
 *  son magasin (les noms des thèmes et des snapshots du poste) : la mémoire d'un
 *  style qu'on a supprimé depuis ne rappelle rien — et laisse donc la place au
 *  fichier du dossier. PUR. */
export const viewerStyleEntryOf = (memory, { snapshots = [], themes = [] } = {}) => {
  if (!memory || !memory.name) return null;
  const list = memory.mode === 'theme' ? themes : snapshots;
  return (Array.isArray(list) ? list : []).includes(memory.name)
    ? { mode: memory.mode, name: memory.name }
    : null;
};
