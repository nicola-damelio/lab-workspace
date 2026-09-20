/* =========================================================================
   src/utils/driveRestore.js — RESTAURATION AUTOMATIQUE DEPUIS LE CLOUD.

   Règle générale de l'application (TOUS les modules) : le Drive (ou le
   Nextcloud) est la SEULE copie de référence d'une donnée lourde ; le
   navigateur n'est qu'un ACCÉLÉRATEUR. Une donnée trop grosse pour le
   document du dataset (Firestore ~1 Mo) ou pour la mémoire doit donc :

     1. ÉCRITURE — au moment où elle est produite (spectre importé, événements
        FCS, trajectoire MD, PDB de docking, vidéo…), être archivée sur le
        cloud dans le dossier canonique de l'expérience, en JSON gzip, et le
        test ne garde qu'un POINTEUR minuscule (`{ id, name, url }`, ~80
        octets) qui voyage avec le dataset et arrive donc sur n'importe quel
        poste :
            archiveRestoreJson({ kind, stem, data, ctx, path })
              → { id, name, url, driveUrl, at } | null
     2. LECTURE — à l'ouverture de la page, si la donnée manque (absente,
        vide, remplacée par le marqueur « […] omitted » posé par
        compressDatasetForSave, ou présente sans sa copie plein format), être
        re-téléchargée du cloud puis réinjectée dans le test et dans la cache :
            restoreJsonFor({ kind, stems, ctx, pointer })
              → { data, file, id, name, source } | null

   Aucune de ces deux étapes ne dépend de la cache du navigateur : la cache
   IndexedDB / localStorage ne sert qu'à ÉVITER un téléchargement, jamais à
   justifier une absence de données (changer de poste doit tout retrouver).

   Recherche du fichier, dans l'ordre (chaque candidat est essayé jusqu'à un
   téléchargement réussi) :
     a) le POINTEUR du test (id exact — insensible au renommage du fichier) ;
     b) le REGISTRE local des envois (rapide, mais VIDE sur un autre poste) ;
     c) une recherche par NOM sur le cloud : le nom du fichier archive le
        « stem » déclaré (`<stem>_<suffix>_restore.json.gz`), c'est ce qui fait
        marcher la restauration sur un poste où ni cache ni registre n'existent.

   La logique pure (nommage, prédicats de manque, portillon « une fois par
   session ») est testée hors navigateur — voir _drive_restore_test.mjs.
   ========================================================================= */

import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate';
import { sanitizeSlug } from './driveNaming';
import { getCloudProvider, nextcloudConfigured, ncFetchBlob } from './nextcloud';
import {
  driveFetch, getDriveFileRegistry, getDriveToken, uploadLocalFile, untrashDriveFile
} from './driveUpload';

/** Version du format des fichiers de restauration (un fichier d'une version
 *  inconnue est refusé plutôt que mal interprété). */
export const RESTORE_VERSION = 1;

/** Suffixe commun des fichiers de restauration (`<stem>_<tag>_restore.json.gz`). */
export const RESTORE_FILE_TAG = '_restore';

/** Extensions acceptées pour un fichier de restauration. */
export const RESTORE_EXTS = ['.json.gz', '.json'];

/* ── 1. LES PRÉDICATS DE MANQUE ────────────────────────────────────────────
   compressDatasetForSave (App.jsx) remplace une valeur lourde par un TEXTE
   (« [nmr1dSpectrum omitted — kept in browser cache / Drive or re-uploadable] »)
   — parfois par `null` (structureFileData). Ces deux formes veulent dire
   « la donnée n'est PLUS là », et c'est exactement ce que la restauration doit
   détecter : un marqueur laissé tel quel casserait le rendu (un `atob()` sur du
   texte, un `.xs` sur une chaîne…). */

/** Le marqueur texte posé par compressDatasetForSave. */
export const isOmittedValue = (value) => (
  typeof value === 'string' && /^\[[^\]]*omitted[^\]]*\]$/.test(value.trim())
);

/** Vide au sens « rien à afficher » : absent, null, chaîne vide, tableau vide,
 *  objet sans clé. */
export const isEmptyValue = (value) => {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
};

/** Vrai quand la valeur doit être restaurée : absente OU remplacée par un
 *  marqueur d'omission. */
export const isMissingValue = (value) => isEmptyValue(value) || isOmittedValue(value);

/** Cas des colonnes de spectres (CD, ssNMR) : un TABLEAU de `{ data }` dont
 *  chaque colonne peut avoir été vidée, ou le tableau entier remplacé par un
 *  marqueur. */
export const isMissingColumns = (columns) => {
  if (isMissingValue(columns)) return true;
  if (!Array.isArray(columns)) return false;
  return !columns.some((column) => {
    if (!column) return false;
    const data = (typeof column === 'object' && 'data' in column) ? column.data : column;
    return !isMissingValue(data);
  });
};


/* ── 2. NOMMAGE DES FICHIERS DE RESTAURATION ───────────────────────────────
   Le nom est DÉTERMINISTE : `<stem>_<tag>_restore.json.gz`, où `stem` est le
   nom déclaré de l'instance (celui que l'utilisateur voit) et `tag` le type de
   donnée (`nmr1d`, `ssnmr1d`, `cdspectra`, `docking`, `md`, `fcsevents`, …).
   C'est ce nom qui rend la recherche par nom possible sur un autre poste. */

/** Slug du « tag » d'un type de donnée ('' → 'data'). */
export const restoreTag = (kind = '', suffix = '') => (
  sanitizeSlug(suffix || kind) || 'data'
);

/** Le « stem » d'un nom de fichier, extension (et `.json`/`.gz`) retirés :
 *  « Sample_1_nmr1d_restore.json.gz » → « Sample_1_nmr1d_restore ». */
export const fileStem = (name = '') => {
  let stem = String(name || '');
  stem = stem.replace(/\.gz$/i, '');
  stem = stem.replace(/\.[^/.]+$/, '');
  return stem;
};

/** Nom du fichier de restauration d'un type de donnée. */
export const restoreFileName = ({ stem = '', kind = '', suffix = '' } = {}) => (
  `${sanitizeSlug(stem) || 'data'}_${restoreTag(kind, suffix)}${RESTORE_FILE_TAG}.json.gz`
);

/** Le nom attendu (sans extension) : « <stem slugé>_<tag>_restore ». */
export const restoreNameStem = ({ stem = '', kind = '', suffix = '' } = {}) => (
  `${sanitizeSlug(stem) || 'data'}_${restoreTag(kind, suffix)}${RESTORE_FILE_TAG}`
);

/** Vrai quand `name` est le fichier de restauration de `stem` pour ce type de
 *  donnée. Tolérant : accepte `.json` non compressé et les noms produits par
 *  une version antérieure (préfixe identique). */
export const isRestoreFileName = (name, { stem = '', kind = '', suffix = '' } = {}) => {
  const raw = String(name || '').toLowerCase();
  if (!/\.json(\.gz)?$/i.test(raw)) return false;
  const want = restoreNameStem({ stem, kind, suffix }).toLowerCase();
  return raw === `${want}.json` || raw === `${want}.json.gz` || raw.startsWith(want);
};

/** Liste de « stems » à chercher, normalisés et dédoublonnés (les noms de
 *  fichiers sources perdent leur extension : « Sample 1.1r » → « Sample_1 »). */
export const restoreStems = (...names) => {
  const out = [];
  names.forEach((name) => {
    const raw = String(name || '').replace(/\.([a-zA-Z0-9]{1,6})$/, '');
    const slug = sanitizeSlug(raw);
    if (slug && !out.includes(slug)) out.push(slug);
  });
  return out;
};

/* ── 3. LE PORTILLON « UNE FOIS PAR SESSION » ──────────────────────────────
   La restauration démarre toute seule à l'ouverture d'une page : sans garde,
   chaque rendu (ou chaque bascule d'onglet) relancerait des requêtes Drive.
   La clé est `kind:testId` — donc une seule tentative par donnée et par
   expérience, tant que la page n'est pas rechargée. Si le Drive n'était pas
   connecté au premier essai, RIEN n'est réservé : l'événement
   « lab:drive-connected » peut alors la déclencher (voir useDriveAutoRestore). */
const restoresClaimed = new Set();

export const restoreGateKey = (kind = '', testId = '') => `${kind || 'data'}:${testId || 'global'}`;

/** Réserve la restauration ; false quand elle a déjà été tentée. */
export const claimRestore = (kind, testId) => {
  const key = restoreGateKey(kind, testId);
  if (restoresClaimed.has(key)) return false;
  restoresClaimed.add(key);
  return true;
};

/** Libère la réservation (le prochain affichage pourra réessayer). */
export const releaseRestore = (kind, testId) => {
  restoresClaimed.delete(restoreGateKey(kind, testId));
};

/** Oublie toutes les réservations (tests, « essayer encore » global). */
export const forgetRestores = () => { restoresClaimed.clear(); };

/* ── 3 bis. LES POINTEURS EN ATTENTE DE LEUR PAGE ─────────────────────────
   L'archivage est asynchrone : il se termine parfois APRÈS que l'utilisateur a
   changé d'onglet / de condition. Écrire le pointeur tout de suite le poserait
   sur la page devenue active — il décrirait alors la mauvaise donnée. Il attend
   donc que SA page revienne. Au pire, la recherche par nom retrouve le fichier :
   un pointeur en attente n'est jamais une donnée perdue. */
const pendingRestorePointers = new Map();

/** Pose le pointeur d'une archive sur la donnée qu'il décrit : tout de suite si
 *  c'est encore elle qui est affichée (`activeKey === key`), sinon en attente
 *  (voir takePendingRestorePointer). `field` est le champ du test qui porte le
 *  pointeur (`nmr1dDrive`, `ssnmrDrive`, `cdDrive`…), `key` identifie la page
 *  (expérience, instance, condition).
 *  @param {{ field:string, pointer:object, key:string, activeKey:string, patch:Function }} opts
 *  @returns {boolean} true quand le pointeur a été posé tout de suite */
export const placeRestorePointer = ({
  field = '', pointer = null, key = '', activeKey = '', patch = null
} = {}) => {
  if (!field || !pointer || !key || typeof patch !== 'function') return false;
  const updates = { [field]: pointer };
  if (activeKey === key) {
    patch(updates);
    return true;
  }
  pendingRestorePointers.set(restoreGateKey(field, key), updates);
  return false;
};

/** Le pointeur qui attendait cette page — et le consomme (null s'il n'y en a
 *  pas). À appeler quand la page redevient active : le patch rendu est écrit tel
 *  quel (`{ ssnmrDrive: … }`). */
export const takePendingRestorePointer = ({ field = '', key = '' } = {}) => {
  if (!field || !key) return null;
  const mapKey = restoreGateKey(field, key);
  const updates = pendingRestorePointers.get(mapKey);
  if (!updates) return null;
  pendingRestorePointers.delete(mapKey);
  return updates;
};

/** Oublie les pointeurs en attente (tests, changement de dataset). */
export const forgetRestorePointers = () => { pendingRestorePointers.clear(); };

/* ── 4. LE CLOUD EST-IL ACCESSIBLE ? ───────────────────────────────────────
   Deux fournisseurs existent (nextcloud.js) : Google Drive (jeton OAuth) et
   Nextcloud (URL + utilisateur + mot de passe d'application). Un module ne
   doit jamais décider tout seul lequel est actif. */
export const hasCloudAccess = () => {
  try {
    if (getCloudProvider() === 'nextcloud') return nextcloudConfigured();
    return !!getDriveToken();
  } catch { return false; }
};

/* ── 5. ÉCRITURE — ARCHIVER LA COPIE DE RÉFÉRENCE ───────────────────────────
   `data` est le contenu MÉTIER (le plus souvent l'objet complet, tel que le
   module veut le retrouver : `{ spectrum }`, `{ columns }`, `{ structures }`…),
   jamais un état d'écran : la restauration doit rendre EXACTEMENT ce qui avait
   été importé. Le JSON est compressé (gzip) : un spectre de 64 k points passe
   de ~2,5 Mo à quelques centaines de Ko sur le Drive. */
export const archiveRestoreJson = async ({
  kind, suffix = '', stem = '', data, ctx = {}, path = null
} = {}) => {
  try {
    if (!data || typeof data !== 'object') return null;
    if (!hasCloudAccess()) return null;
    const body = JSON.stringify({
      kind: String(kind || 'data'),
      version: RESTORE_VERSION,
      archivedAt: new Date().toISOString(),
      ...data
    });
    const bytes = gzipSync(strToU8(body));
    const name = restoreFileName({ stem, kind, suffix });
    const mimeType = 'application/gzip';
    const file = new Blob([bytes], { type: mimeType });
    const res = await uploadLocalFile({ name, mimeType, file, ctx, ...(path ? { path } : {}) });
    if (!res || (!res.id && !res.url)) return null;
    return {
      id: String(res.id || ''),
      name: String(res.name || name),
      url: String(res.url || ''),
      driveUrl: String(res.driveUrl || ''),
      at: Date.now()
    };
  } catch (err) {
    // Une archive ratée ne doit jamais casser un import : le fichier reste
    // dans la cache du navigateur (et dans la file de reprise des envois).
    console.warn('Drive restore archive failed:', err && err.message);
    return null;
  }
};

/* ── 6. LECTURE — TROUVER LES CANDIDATS ────────────────────────────────────
   Trois sources, essayées dans cet ordre : pointeur, registre local, recherche
   par nom sur le cloud. Aucune ne dépend de la cache pour être COMPLÈTE : c'est
   la recherche par nom qui sauve un poste vierge. */
export const findRestoreCandidates = async ({
  kind = '', suffix = '', stems = [], ctx = {}, pointer = null, searchCloud = true
} = {}) => {
  const out = [];
  const seen = new Set();
  const add = (id, name, source, extra = {}) => {
    const key = String(id || '');
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ id: key, name: String(name || ''), source, ...extra });
  };

  // a) Le pointeur du test : l'id exact, même si le fichier a été renommé.
  if (pointer && pointer.id) add(pointer.id, pointer.name, 'pointer');

  // b) Le registre local des envois (vide sur un autre poste).
  try {
    const reg = getDriveFileRegistry();
    Object.entries(reg).forEach(([id, entry]) => {
      if (!entry || entry.deleted) return;
      if (ctx.test && String(entry.ctx?.test || '') !== String(ctx.test)) return;
      if (ctx.subsection && String(entry.ctx?.subsection || '') !== String(ctx.subsection)) return;
      if (!stems.some((stem) => isRestoreFileName(entry.name, { stem, kind, suffix }))) return;
      add(id, entry.name, 'registry', { trashed: !!entry.trashed });
    });
  } catch { /* registre illisible : la recherche par nom prend le relais */ }

  // c) Recherche par NOM sur le cloud — ce qui fait marcher un autre poste.
  if (searchCloud && hasCloudAccess() && stems.length) {
    const tag = restoreTag(kind, suffix);
    for (const stem of stems) {
      const slug = sanitizeSlug(stem);
      if (!slug || slug.length < 3) continue; // trop court : matcherait tout
      try {
        const term = `${slug}_${tag}${RESTORE_FILE_TAG}`;
        const q = encodeURIComponent(`name contains '${term.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);
        const res = await driveFetch(`/drive/v3/files?q=${q}&fields=files(id,name,trashed)&pageSize=50`);
        if (!res || !res.ok) continue;
        const json = await res.json();
        (json.files || []).forEach((file) => {
          if (!file || !file.id) return;
          if (!isRestoreFileName(file.name, { stem, kind, suffix })) return;
          add(file.id, file.name, 'search', { trashed: !!file.trashed });
        });
      } catch { /* un terme qui échoue ne doit pas annuler les autres */ }
    }
  }

  return out;
};

/** Télécharge un fichier du cloud par son id (ou son URL Nextcloud). Un fichier
 *  mis à la corbeille est d'abord remis en place : ses octets sont intacts et
 *  c'est exactement ce que fait la restauration FCS. */
export const downloadCloudFile = async (candidate, { name = '' } = {}) => {
  try {
    if (!hasCloudAccess()) return null;
    if (getCloudProvider() === 'nextcloud') {
      const url = (candidate && (candidate.url || candidate.driveUrl)) || '';
      if (!url) return null;
      const blob = await ncFetchBlob(url);
      if (!blob || !blob.size) return null;
      return name ? new File([blob], name, { type: blob.type || 'application/octet-stream' }) : blob;
    }
    const id = candidate && candidate.id;
    if (!id) return null;
    if (candidate.trashed) {
      await untrashDriveFile(id).catch(() => false);
      candidate.trashed = false;
    }
    let res;
    try {
      res = await driveFetch(`/drive/v3/files/${encodeURIComponent(id)}?alt=media`);
    } catch (err) {
      if (err && err.code === 'TOKEN_EXPIRED') return null;
      const back = await untrashDriveFile(id).catch(() => false);
      if (!back) return null;
      try { res = await driveFetch(`/drive/v3/files/${encodeURIComponent(id)}?alt=media`); }
      catch { return null; }
    }
    if (!res || !res.ok) return null;
    const blob = await res.blob();
    if (!blob || !blob.size) return null;
    return name ? new File([blob], name, { type: blob.type || 'application/octet-stream' }) : blob;
  } catch { return null; }
};

/** Décompresse (gzip) et analyse un fichier de restauration. */
export const readRestoreJson = async (file) => {
  try {
    if (!file) return null;
    const buffer = new Uint8Array(await file.arrayBuffer());
    const gz = /\.gz$/i.test(file.name || '') || (buffer[0] === 0x1f && buffer[1] === 0x8b);
    const text = strFromU8(gz ? gunzipSync(buffer) : buffer);
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
};

/** Toute la lecture en un appel : trouve puis télécharge la copie de
 *  référence. `null` = aucune copie utilisable (l'appelant le DIT à
 *  l'utilisateur au lieu de laisser la page vide). */
export const restoreJsonFor = async ({
  kind = '', suffix = '', stems = [], ctx = {}, pointer = null, searchCloud = true
} = {}) => {
  const candidates = await findRestoreCandidates({ kind, suffix, stems, ctx, pointer, searchCloud });
  for (const candidate of candidates) {
    const name = candidate.name || restoreFileName({ stem: stems[0] || '', kind, suffix });
    const file = await downloadCloudFile(candidate, { name });
    if (!file) continue;
    const data = await readRestoreJson(file);
    if (!data) continue;
    if (kind && data.kind && String(data.kind) !== String(kind)) continue;
    return { data, file, id: candidate.id, name, source: candidate.source };
  }
  return null;
};

/* ── 7. LIRE UN FICHIER BRUT (un média) ────────────────────────────────────
   Certaines données lourdes ne sont pas des séries de nombres mais des
   FICHIERS : les vidéos de microscopie, dont le document du dataset ne porte
   que la liste des noms (`msVideos`, `msMovies`). En archiver « une copie
   JSON » n'aurait aucun sens — un clip de plusieurs centaines de Mo en base64
   serait absurde — : la copie de RÉFÉRENCE est le fichier lui-même, déjà
   envoyé au Drive à l'import. On cherche donc le même trio pointeur →
   registre → nom, mais le nom n'est pas `<stem>_<tag>_restore.json.gz` : c'est
   le nom du média tel qu'il a été déposé (`<titre>_<scientifique>.mp4`), et
   c'est son RADICAL qui fait foi. */

/** Radical comparable d'un nom de média : « clip final.mp4 » → « clip_final ».
 *  Le slugage est celui des noms déposés sur le Drive (sanitizeSlug), donc le
 *  radical du nom d'origine et celui du fichier Drive coïncident — c'est ce qui
 *  rend la recherche par nom fiable depuis un poste vierge. */
export const rawStemOf = (name = '') =>
  sanitizeSlug(String(name || '').replace(/\.[A-Za-z0-9]{1,6}$/, '')).toLowerCase();

/** Extension comparable ('' quand il n'y en a pas). */
export const rawExtOf = (name = '') => {
  const m = String(name || '').match(/\.([A-Za-z0-9]{1,6})$/);
  return m ? m[1].toLowerCase() : '';
};

/** Vrai quand `candidate` est le média décrit par un des `names` : même
 *  radical, et même extension quand les deux en ont une (le .mp4 converti
 *  n'est donc pas pris pour le .wmv d'origine). */
export const matchesRawName = (candidate = '', names = []) => {
  const stem = rawStemOf(candidate);
  if (!stem) return false;
  const ext = rawExtOf(candidate);
  return (Array.isArray(names) ? names : [names]).some((name) => {
    if (rawStemOf(name) !== stem) return false;
    const want = rawExtOf(name);
    return !want || !ext || want === ext;
  });
};

/** Candidats d'un média : pointeur → registre local → nom sur le cloud. */
export const findRawCandidates = async ({
  pointer = null, ctx = {}, names = [], searchCloud = true
} = {}) => {
  const wanted = (Array.isArray(names) ? names : [names]).filter(Boolean);
  const out = [];
  const seen = new Set();
  const add = (id, name, source, extra = {}) => {
    const key = String(id || '');
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ id: key, name: String(name || ''), source, ...extra });
  };

  // a) Le pointeur du média : l'id exact (Nextcloud : l'URL), donc insensible
  //    au renommage du fichier sur le Drive.
  if (pointer && (pointer.id || pointer.url || pointer.driveUrl)) {
    const url = String(pointer.url || pointer.driveUrl || '');
    const name = pointer.name || wanted[0] || '';
    if (pointer.id) add(pointer.id, name, 'pointer', { url });
    else if (url) add(url, name, 'pointer', { url });
  }

  // b) Le registre local des envois (vide sur un autre poste).
  try {
    const reg = getDriveFileRegistry();
    Object.entries(reg).forEach(([id, entry]) => {
      if (!entry || entry.deleted) return;
      if (ctx.test && String(entry.ctx?.test || '') !== String(ctx.test)) return;
      if (ctx.subsection && String(entry.ctx?.subsection || '') !== String(ctx.subsection)) return;
      if (!matchesRawName(entry.name, wanted)) return;
      add(id, entry.name, 'registry', { trashed: !!entry.trashed });
    });
  } catch { /* registre illisible : la recherche par nom prend le relais */ }

  // c) Recherche par NOM sur le cloud — ce qui fait marcher un autre poste.
  if (searchCloud && hasCloudAccess() && wanted.length) {
    const stems = [];
    wanted.forEach((name) => {
      const stem = rawStemOf(name);
      if (stem && stem.length >= 3 && !stems.includes(stem)) stems.push(stem);
    });
    for (const stem of stems) {
      try {
        // `stem` sort de sanitizeSlug : ni guillemet ni antislash à échapper.
        const q = encodeURIComponent(`name contains '${stem}'`);
        const res = await driveFetch(`/drive/v3/files?q=${q}&fields=files(id,name,trashed)&pageSize=50`);
        if (!res || !res.ok) continue;
        const json = await res.json();
        (json.files || []).forEach((file) => {
          if (!file || !file.id) return;
          if (!matchesRawName(file.name, wanted)) return;
          add(file.id, file.name, 'search', { trashed: !!file.trashed });
        });
      } catch { /* un terme qui échoue ne doit pas annuler les autres */ }
    }
  }

  return out;
};

/** Toute la lecture d'un média en un appel : `{ file, id, name, source }`.
 *  `null` = aucun fichier utilisable — l'appelant le DIT à l'utilisateur au
 *  lieu de laisser une vignette vide. */
export const restoreRawFileFor = async ({
  pointer = null, ctx = {}, names = [], mimeType = '', searchCloud = true
} = {}) => {
  const wanted = (Array.isArray(names) ? names : [names]).filter(Boolean);
  const candidates = await findRawCandidates({ pointer, ctx, names: wanted, searchCloud });
  for (const candidate of candidates) {
    const name = candidate.name || wanted[0] || 'media';
    const file = await downloadCloudFile(candidate, { name });
    if (!file || !file.size) continue;
    return {
      file: mimeType ? new File([file], name, { type: mimeType }) : file,
      id: candidate.id,
      name,
      source: candidate.source
    };
  }
  return null;
};
