/* =========================================================================
   src/utils/localStoreRoom.js

   LA PLACE DU NAVIGATEUR — MESURÉE, PAS SUPPOSÉE.

   Tout ce que la page garde sur ce poste (le payload des datasets, les projets,
   les listes de figures…) vit dans le magasin du navigateur : ~5 Mo PAR SITE,
   partagés par tous les datasets de la machine. Google Drive et Firestore en
   gardent une COPIE — mais une copie ne rend pas un octet à ce magasin, d'où
   le message « This browser refused to save… » qu'aucune sauvegarde cloud ne
   fait disparaître.

   Ce module ne libère rien tout seul : il MESURE (clé par clé) pour que le
   message dise la vérité (« labWorkspace_projects occupe 2,4 Mo ») et pour que
   l'allègement (projectsModule.saveProjectsRescued) ait un chiffre réel à
   montrer, avant et après.

   ⚠ L'UNITÉ. Les navigateurs comptent ce quota en CARACTÈRES (~5 Mo ≈
   5 000 000 caractères) : c'est donc la longueur de la chaîne stockée qui est
   mesurée ici, et elle est présentée en Mo/kB — la même unité que le « ~5 Mo
   par site » annoncé partout dans l'application.
   ========================================================================= */

/** Le magasin à lire : localStorage en vrai, un faux (avec quota) dans les tests. */
const storeOf = (storage) => {
  if (storage) return storage;
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
};

/**
 * L'occupation du magasin, clé par clé, du plus lourd au plus léger.
 * @returns {{ total:number, keys:Array<{key:string, bytes:number}> }}
 *          `total` = tout ce que le site occupe (c'est lui qui décide si une
 *          écriture passe, pas le poids du seul objet qu'on écrit).
 */
export const readLocalStoreUsage = (storage) => {
  const ls = storeOf(storage);
  const keys = [];
  let total = 0;
  if (!ls) return { total, keys };
  try {
    for (let i = 0; i < ls.length; i += 1) {
      const key = ls.key(i);
      if (key == null) continue;
      const bytes = String(ls.getItem(key) || '').length;
      total += bytes;
      keys.push({ key: String(key), bytes });
    }
  } catch { /* magasin inaccessible (navigation privée, quota déjà plein) */ }
  keys.sort((a, b) => (b.bytes - a.bytes) || a.key.localeCompare(b.key));
  return { total, keys };
};

/** Octets → « 2,4 Mo » / « 640 ko » / « 12 o » (l'unité du quota, voir l'entête). */
export const formatStoreSize = (bytes) => {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * LA PHRASE QUI DIT OÙ EST PASSÉ L'ESPACE : « labWorkspace_projects 2.4 MB ·
 * labFiguresLibrary 1.1 MB · … ». Les clés techniques sont nommées comme
 * l'utilisateur les connaît (projets, figures, datasets) : une mesure qu'on ne
 * comprend pas ne sert à rien.
 */
export const LOCAL_STORE_LABELS = {
  labWorkspace_projects: 'projects (this browser)',
  labWorkspace_deletedProjects: 'deleted projects',
  labFiguresLibrary: 'dataset figure list',
  lab_datasets_local_v2: 'datasets kept on this device',
  labWorkspace_publications: 'papers',
  labWorkspace_datasets: 'dataset list'
};
/** Libellé lisible d'une clé (les clés de figures sont par projet). */
export const localStoreLabel = (key) => {
  const k = String(key || '');
  if (LOCAL_STORE_LABELS[k]) return LOCAL_STORE_LABELS[k];
  if (k.startsWith('labFiguresLib_')) return 'project figure list';
  if (k.startsWith('labFiguresDeck_')) return 'slide deck';
  return k;
};

/** @returns {string} « projects (this browser) 2.4 MB · dataset figure list 1.1 MB » */
export const describeTopConsumers = (usage, top = 4) => {
  const keys = (usage && Array.isArray(usage.keys) ? usage.keys : []).slice(0, Math.max(1, top));
  return keys.map((row) => `${localStoreLabel(row.key)} ${formatStoreSize(row.bytes)}`).join(' · ');
};

/* ---------------------------------------------------------------------------
 * LES DEUX PHRASES DU MAGASIN DU NAVIGATEUR.
 * Une écriture sauvée (de la place a été faite) et un échec VRAI ne se disent
 * pas de la même façon : le premier est une bonne nouvelle à expliquer, le
 * second doit donner la MESURE de ce qui occupe la place et la marche à suivre.
 * Elles vivent ICI, avec la mesure, pour que la LISTE DES PROJETS et la PAGE
 * PROJET racontent exactement la même chose du magasin.
 * ------------------------------------------------------------------------- */

/** Ce qu'une écriture SAUVÉE a coûté, calmement et sans jargon. */
export const storageFreedText = (res) => [
  res.linked
    ? `${res.linked} high-resolution image copy(ies) now read from their Drive file instead of being kept here — nothing was lost`
    : '',
  res.droppedImages
    ? `${res.droppedImages} image copy(ies) that existed only in this browser were left out of the project copy — every figure keeps its place, its name, its caption and its spot in the printed document; press ☁ Save figures to Drive (or import them again) to get the pixels back`
    : '',
  res.forgotten
    ? `${res.forgotten} figure-list entr${res.forgotten === 1 ? 'y' : 'ies'} whose files are already on Drive were forgotten on this device — “⬇ Add missing from Drive” brings them back`
    : ''
].filter(Boolean).join(' · ');

/** L'ÉCHEC VRAI : rien n'a pu être écrit — la mesure, puis ce qui libère. */
export const storageRefusedText = (res) => {
  const usage = res.usage || { total: 0, keys: [] };
  const consumers = describeTopConsumers(usage, 4);
  const tried = [
    res.linked ? `${res.linked} image copy(ies) linked to their Drive file` : '',
    res.droppedImages ? `${res.droppedImages} local image copy(ies) dropped` : '',
    res.forgotten ? `${res.forgotten} recoverable figure-list entry(ies) forgotten` : ''
  ].filter(Boolean).join(', ');
  return `⚠ This browser refused the write and no room could be freed (${res.error}). `
    + 'Your work is still on this page — nothing is lost while it stays open — but it is NOT stored on this device yet. '
    + `What occupies the browser’s own store: ${formatStoreSize(usage.total)}`
    + (consumers ? ` — ${consumers}. ` : '. ')
    + 'Drive and Firestore hold a COPY of the dataset, but a copy never returns room to this store. '
    + (tried ? `Tried automatically: ${tried}. ` : '')
    + 'To free room for real: in “Figures & slides”, press ☁ Save to Drive so the images leave this store, '
    + 'or delete from this device a dataset you no longer need.';
};
