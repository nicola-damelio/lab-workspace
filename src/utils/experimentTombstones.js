/* =========================================================================
   src/utils/experimentTombstones.js
   UNE EXPÉRIENCE DISPARUE NE DISPARAÎT PLUS — ET CELLE QU'ON A SUPPRIMÉE
   NE RESSUSCITE PAS.

   LE DÉFAUT RÉPARÉ ICI, dit par le rapport : « le esperienze spariscono dal
   dataset all'enregistrement automatique — sul Drive ci sono ancora le
   cartelle e i .json, ma nel programma non ci sono più ». Rien, à l'écran, ne
   le disait : ni un avertissement, ni une corbeille (il n'y en a pas pour les
   expériences).

   LA CAUSE, en une phrase : la liste des expériences vit ENTIÈRE dans le
   payload du dataset (`tests`) et CHAQUE enregistrement écrit la liste telle
   qu'elle est en mémoire, d'un bloc (`set(..., { merge: true })`). Un poste qui
   a lu une copie plus ANCIENNE du dataset (Firestore injoignable → repli sur la
   copie du Drive, ou sur la sienne), qui ouvre simplement le dataset, publie
   donc une liste PLUS COURTE — et l'ancienne liste du document partagé est
   perdue. L'enregistrement est automatique (1,5 s après la dernière frappe, et
   vidé à la fermeture d'onglet) : personne ne l'a demandé, personne ne l'a vu.

   LA RÉPARATION tient dans les TROIS mêmes idées que pour les projets (voir
   utils/projectTombstones.js — un projet, lui, a déjà son verrou) :

     1. LA LECTURE N'EFFACE PLUS — `mergeExperimentsAddOnly` : ce qu'une copie
        relue apporte est adopté (elle est la plus récente par construction),
        mais ce qu'elle NE PORTE PAS et que ce poste connaît est GARDÉ. Une
        relecture ne peut donc plus vider la mémoire du poste avant que
        l'enregistrement suivant ne publie le vide.
     2. L'ÉCRITURE NE PERD RIEN SANS RECORD — `protectUnrecordedDrops` : avant
        d'écrire, ce que le poste connaissait et que la liste sortante ne porte
        plus est REMIS (et l'écran le dit, voir `describeUnrecordedDrops`).
        Une expérience ne peut donc disparaître que par une SUPPRESSION, jamais
        par un enregistrement.
     3. LA SUPPRESSION EST UNE DONNÉE — `deletedExperiments` : le geste de
        suppression (🗑) écrit un record DATÉ, qui voyage dans le payload du
        dataset et dans `_workspace/state.json`, sinon un autre poste (qui
        détient encore l'expérience) la republierait, et un retour volontaire
        (restauration d'une sauvegarde) doit pouvoir lever ce record — c'est la
        LEVÉE (« revival »), également datée et voyageuse.

   L'IDENTITÉ d'une expérience est son `id` (celle que le lien projet ↔
   expérience porte, `project.experiments[].testId`) ; le NOM ne sert que
   lorsqu'un record — ou l'expérience — n'a pas d'id (une entrée écrite par une
   version ancienne reste comprise, comme pour les tombes de projets).

   Tout est PUR ici (les fonctions reçoivent et rendent des listes) à
   l'exception du bloc « MAGASIN » en fin de fichier, qui ne fait que lire et
   écrire les deux clés localStorage — comme projectsModule.jsx le fait pour
   les tombes de projets. Vérifié par _experiment_vanishing_test.mjs.
   ========================================================================= */

/** Clés localStorage des records (écrites par le magasin de ce module). */
export const DELETED_EXPERIMENTS_KEY = 'labWorkspace_deletedExperiments';
export const REVIVED_EXPERIMENTS_KEY = 'labWorkspace_revivedExperiments';

/** Nombre de records conservés (les plus récents). Une suppression n'est jamais
 *  oubliée à court terme ; la limite n'existe que pour qu'un localStorage ne
 *  grossisse pas indéfiniment sur des années d'usage. */
export const MAX_RECORDS = 500;

const idOf = (x) => {
  if (x && typeof x === 'object') return String(x.id === undefined || x.id === null ? '' : x.id).trim();
  return x === undefined || x === null ? '' : String(x).trim();
};

const nameOf = (x) => (x && typeof x === 'object'
  ? String(x.name === undefined || x.name === null ? '' : x.name).trim()
  : '');

const datasetOf = (x) => String(
  x && typeof x === 'object' && x.datasetId !== undefined && x.datasetId !== null ? x.datasetId : ''
);

/** L'identité d'une EXPÉRIENCE : son id, sinon son nom. Rien de reconnaissable
 *  (ni id ni nom) → '', et une entrée sans identité n'est jamais « supprimée »
 *  ni « remise » : elle n'est pas identifiable. */
export const experimentKey = (test) => {
  const id = idOf(test);
  if (id) return `id:${id}`;
  const name = nameOf(test);
  return name ? `name:${name}` : '';
};

/** La clé d'un RECORD : `<datasetId>::<id>` (ou `<datasetId>::#<nom>` quand le
 *  record n'a pas d'id). L'id seul ne suffit pas — deux datasets peuvent porter
 *  des expériences de même id (copie d'une sauvegarde). */
export const recordKey = (entry) => {
  const id = idOf(entry);
  if (id) return `${datasetOf(entry)}::${id}`;
  const name = nameOf(entry);
  return name ? `${datasetOf(entry)}::#${name}` : '';
};

/** Une liste HORODATÉE propre et utilisable (suppressions comme levées) : les
 *  entrées sans identité sont écartées, deux records de même identité n'en font
 *  qu'un (la date la plus récente gagne) et la liste est bornée à MAX_RECORDS,
 *  la plus récente d'abord. Accepte `['t12']` comme `[{ id, name, deletedAt }]`
 *  — une entrée écrite par une version plus ancienne (ou un payload abîmé)
 *  reste donc comprise — et une liste IMBRIQUÉE, comme le fait déjà
 *  normalizeTombstones pour les projets. */
const normalizeStamped = (list, field) => {
  const flat = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v) flat.push(v);
  };
  walk(list);
  const byKey = new Map();
  flat.forEach((raw) => {
    const entry = {
      id: idOf(raw),
      name: nameOf(raw),
      datasetId: datasetOf(raw),
      [field]: Number(raw && typeof raw === 'object' ? raw[field] : 0) || 0
    };
    const key = recordKey(entry);
    if (!key) return;
    const prev = byKey.get(key);
    if (!prev || entry[field] >= prev[field]) byKey.set(key, entry);
  });
  return Array.from(byKey.values())
    .sort((a, b) => b[field] - a[field])
    .slice(0, MAX_RECORDS);
};

export const normalizeDeletions = (list) => normalizeStamped(list, 'deletedAt');
export const normalizeRevivals = (list) => normalizeStamped(list, 'revivedAt');

/** Enregistrer la suppression d'une expérience (la plus récente en tête). */
export const addDeletion = (deletions, test, deletedAt = Date.now()) => {
  const entry = {
    id: idOf(test),
    name: nameOf(test),
    datasetId: datasetOf(test),
    deletedAt: Number(deletedAt) || Date.now()
  };
  if (!recordKey(entry)) return normalizeDeletions(deletions);
  return normalizeDeletions([entry, ...(Array.isArray(deletions) ? deletions : [])]);
};

/** Enregistrer le RETOUR d'une expérience (levée de suppression, datée). */
export const addRevival = (revivals, test, revivedAt = Date.now()) => {
  const entry = {
    id: idOf(test),
    name: nameOf(test),
    datasetId: datasetOf(test),
    revivedAt: Number(revivedAt) || Date.now()
  };
  if (!recordKey(entry)) return normalizeRevivals(revivals);
  return normalizeRevivals([entry, ...(Array.isArray(revivals) ? revivals : [])]);
};

/** Retirer la levée d'une expérience : une SUPPRESSION postérieure doit
 *  l'emporter (« 🗑 » après une restauration est une vraie suppression). */
export const withoutRevival = (revivals, test) => {
  const wanted = { id: idOf(test), name: nameOf(test), datasetId: datasetOf(test) };
  const key = recordKey(wanted);
  if (!key) return normalizeRevivals(revivals);
  return normalizeRevivals(revivals).filter((r) => recordKey(r) !== key);
};

/** La RÈGLE d'identité d'un record, une seule fois : même id (ou même nom quand
 *  l'un des deux n'a pas d'id), et un dataset absent d'un côté au moins (ou
 *  identique) — un record sans dataset vaut partout. */
const sameStamped = (a, b) => {
  if (!a || !b) return false;
  const aId = idOf(a);
  const bId = idOf(b);
  const sameName = !!nameOf(a) && nameOf(a) === nameOf(b);
  if (!(aId && bId ? aId === bId : sameName)) return false;
  return !a.datasetId || !b.datasetId || a.datasetId === b.datasetId;
};

/** LES SUPPRESSIONS QUI TIENNENT ENCORE : celles qu'aucune levée plus récente
 *  (ou de même date) n'a annulées. C'est la seule lecture des suppressions
 *  d'expériences — lever une suppression est donc vu de partout d'un coup. */
export const withoutRevivedExperiments = (deletions, revivals) => {
  const lifted = normalizeRevivals(revivals);
  const records = normalizeDeletions(deletions);
  if (!lifted.length) return records;
  return records.filter((d) => !lifted.some(
    (r) => sameStamped(r, d) && (Number(r.revivedAt) || 0) >= (Number(d.deletedAt) || 0)
  ));
};

/** Les records tels qu'un PAYLOAD les porte : un record sans dataset appartient
 *  au dataset qui l'a écrit (le payload d'un dataset ne parle que de lui). */
const forDataset = (list, norm, datasetArg) => {
  const datasetId = datasetArg === undefined || datasetArg === null ? '' : String(datasetArg);
  return norm(list).map((r) => (!r.datasetId && datasetId ? { ...r, datasetId } : r));
};

export const deletionsForDataset = (list, datasetArg) => forDataset(list, normalizeDeletions, datasetArg);
export const revivalsForDataset = (list, datasetArg) => forDataset(list, normalizeRevivals, datasetArg);

/* ---------------------------------------------------------------------------
 * 🗑 CE QUI EST SUPPRIMÉ EST SUPPRIMÉ (et ne revient pas par une relecture)
 * ------------------------------------------------------------------------ */

/** Cette expérience a-t-elle une suppression ENREGISTRÉE (et non levée) ? */
export const isExperimentDeleted = (test, deletions) => {
  const key = experimentKey(test);
  if (!key) return false;
  return normalizeDeletions(deletions).some((d) => sameStamped(d, test));
};

/** La liste sans les expériences dont la suppression est enregistrée. */
export const withoutDeletedExperiments = (tests, deletions) => {
  const items = (Array.isArray(tests) ? tests : []).filter(Boolean);
  const records = normalizeDeletions(deletions);
  if (!records.length) return items;
  return items.filter((t) => !isExperimentDeleted(t, records));
};

/* ---------------------------------------------------------------------------
 * ⛔ LE VERROU : « l'enregistrement a failli effacer des expériences »
 *
 * Le même contrat que `protectUntombstoned` pour les projets : ce qui manque à
 * une écriture SANS record de suppression est REMIS. Une suppression reste une
 * suppression (son record est écrit par le geste 🗑) ; une perte accidentelle,
 * elle, ne passe plus.
 * ------------------------------------------------------------------------ */

/** Les expériences qu'une écriture FERAIT DISPARAÎTRE SANS AUCUN RECORD.
 *  C'est la signature d'une perte de données, jamais d'une suppression.
 *  @param {Array} known    ce que ce poste connaît du dataset (voir App.jsx)
 *  @param {Array} outgoing ce que l'appelant s'apprête à écrire
 *  @param {Array} deletions les suppressions enregistrées (déjà sans les levées)
 *  @returns {Array} les expériences à REMETTRE dans la liste écrite
 */
export const unrecordedDrops = (known, outgoing, deletions) => {
  const items = (Array.isArray(known) ? known : []).filter(Boolean);
  const kept = new Set(
    (Array.isArray(outgoing) ? outgoing : []).filter(Boolean).map(experimentKey).filter(Boolean)
  );
  const records = normalizeDeletions(deletions);
  return items.filter((t) => {
    const key = experimentKey(t);
    if (!key) return false;                     // pas identifiable : jamais « remise »
    if (kept.has(key)) return false;            // déjà dans la liste écrite
    return !isExperimentDeleted(t, records);    // …et sans record : elle est REMISE
  });
};

/** La liste à écrire, corrigée : rien de ce qui n'est pas supprimé ne peut
 *  disparaître. Rend `{ tests, rescued, removed }` — `rescued` sont les
 *  expériences remises (l'appelant peut le DIRE au lieu de les avoir perdues),
 *  `removed` celles retirées parce que leur suppression est enregistrée.
 *  L'ordre de la liste écrite est conservé, les expériences remises suivent. */
export const protectUnrecordedDrops = (known, outgoing, deletions) => {
  const list = (Array.isArray(outgoing) ? outgoing : []).filter(Boolean);
  const records = normalizeDeletions(deletions);
  const rescued = unrecordedDrops(known, list, records);
  let out = list;
  if (rescued.length) {
    const seen = new Set(list.map(experimentKey).filter(Boolean));
    out = list.slice();
    rescued.forEach((t) => {
      const key = experimentKey(t);
      if (key && seen.has(key)) return;
      if (key) seen.add(key);
      out.push(t);
    });
  }
  const tests = withoutDeletedExperiments(out, records);
  return { tests, rescued, removed: out.length - tests.length };
};

/** UNE LECTURE N'EFFACE PLUS : la copie relue (`incoming`) est adoptée telle
 *  quelle, et ce que ce poste connaît (`current`) et qu'elle ne porte pas est
 *  AJOUTÉ à la fin. Les suppressions enregistrées s'appliquent aux deux.
 *  Rend `{ tests, added }` — `added` sont les expériences gardées parce que la
 *  copie relue ne les portait pas (à DIRE : c'est le signe qu'un autre poste a
 *  publié une liste plus courte). */
export const mergeExperimentsAddOnly = (current, incoming, deletions) => {
  const list = (Array.isArray(incoming) ? incoming : []).filter(Boolean);
  const records = normalizeDeletions(deletions);
  const seen = new Set(list.map(experimentKey).filter(Boolean));
  const added = [];
  (Array.isArray(current) ? current : []).filter(Boolean).forEach((t) => {
    const key = experimentKey(t);
    if (!key || seen.has(key)) return;
    if (isExperimentDeleted(t, records)) return;
    seen.add(key);
    added.push(t);
  });
  const tests = withoutDeletedExperiments(list.concat(added), records);
  return { tests, added };
};

/* ---------------------------------------------------------------------------
 * 📣 CE QUI S'EST PASSÉ SE DIT (jamais un enregistrement muet)
 * ------------------------------------------------------------------------ */

const namesOf = (list) => (Array.isArray(list) ? list : [])
  .map((t) => nameOf(t) || `#${idOf(t)}`)
  .filter(Boolean)
  .slice(0, 6)
  .join(', ');

/** Le compte-rendu d'un ENREGISTREMENT qui a failli perdre des expériences. */
export const describeUnrecordedDrops = (rescued) => (
  Array.isArray(rescued) && rescued.length
    ? `⚠ The dataset copy that was about to be written did NOT carry ${rescued.length} experiment(s) `
      + `(${namesOf(rescued)}) and no deletion was recorded for them: they were KEPT. `
      + 'This is the signature of a stale copy (another workstation, or an offline read): '
      + 'reopen the dataset there and let it publish again (🔄 Refresh). An experiment you really want gone '
      + 'is deleted in the Experiments page (🗑), so that it is forgotten everywhere.'
    : ''
);

/** Le compte-rendu d'une LECTURE qui a gardé des expériences absentes de la copie relue. */
export const describeKeptExperiments = (added) => (
  Array.isArray(added) && added.length
    ? `⚠ The shared copy did not carry ${added.length} experiment(s) this device already knows `
      + `(${namesOf(added)}): they were KEPT here — a re-read never erases. If the dataset must lose them `
      + 'for good, delete them in the Experiments page (🗑).'
    : ''
);

/** Le compte-rendu des expériences retirées parce que leur suppression est
 *  enregistrée (ici ou sur un autre poste — le record voyage). */
export const describeRemovedExperiments = (count) => (
  Number(count) > 0
    ? `${count} experiment(s) whose deletion is recorded were removed from the saved copy (their 🗑 travels with the dataset).`
    : ''
);

/* ---------------------------------------------------------------------------
 * 💾 MAGASIN — les deux clés localStorage (App.jsx ne fait que l'entrée/sortie)
 * ------------------------------------------------------------------------ */

const storeOf = () => {
  try {
    return typeof globalThis !== 'undefined' && globalThis.localStorage ? globalThis.localStorage : null;
  } catch {
    return null;   // navigation privée : la règle reste en mémoire pour la session
  }
};

const readStored = (key, norm) => {
  const store = storeOf();
  if (!store) return [];
  try {
    return norm(JSON.parse(store.getItem(key) || '[]'));
  } catch {
    return [];
  }
};

const writeStored = (key, list) => {
  const store = storeOf();
  if (!store) return list;
  try { store.setItem(key, JSON.stringify(list)); } catch { /* plein / privé : best-effort */ }
  return list;
};

export const loadExperimentDeletions = () => readStored(DELETED_EXPERIMENTS_KEY, normalizeDeletions);
export const loadExperimentRevivals = () => readStored(REVIVED_EXPERIMENTS_KEY, normalizeRevivals);
export const saveExperimentDeletions = (list) => writeStored(DELETED_EXPERIMENTS_KEY, normalizeDeletions(list));
export const saveExperimentRevivals = (list) => writeStored(REVIVED_EXPERIMENTS_KEY, normalizeRevivals(list));

/** ADOPTER les suppressions portées par une copie (payload du dataset,
 *  `_workspace/state.json`, fichier HTML) : elles s'ajoutent aux nôtres — une
 *  suppression faite sur un autre poste vaut ici aussi, sinon l'expérience
 *  qu'il a supprimée serait republiée par ce poste-ci. */
export const adoptExperimentDeletions = (list) =>
  saveExperimentDeletions([...(Array.isArray(list) ? list : []), ...loadExperimentDeletions()]);

/** ADOPTER les levées portées par une copie (même règle). */
export const adoptExperimentRevivals = (list) =>
  saveExperimentRevivals([...(Array.isArray(list) ? list : []), ...loadExperimentRevivals()]);

/** LE GESTE : tout ce qui a disparu entre `before` et `after` par une ACTION de
 *  l'utilisateur (suppression 🗑, undo/redo…) laisse sa suppression enregistrée
 *  — c'est ce qui distingue une suppression d'une perte. Rend la liste à jour
 *  des suppressions. */
export const recordExperimentDeletions = (before, after, datasetArg, deletedAt = Date.now()) => {
  const still = new Set(
    (Array.isArray(after) ? after : []).filter(Boolean).map(experimentKey).filter(Boolean)
  );
  const gone = (Array.isArray(before) ? before : []).filter((t) => {
    const key = experimentKey(t);
    return !!key && !still.has(key);
  });
  /* Rien n'a disparu (le cas de très loin le plus fréquent : une frappe dans une
     page d'expérience) : on ne réécrit même pas la clé. */
  if (!gone.length) return loadExperimentDeletions();
  const scope = datasetArg === undefined || datasetArg === null ? '' : String(datasetArg);
  let list = loadExperimentDeletions();
  gone.forEach((t) => { list = addDeletion(list, { ...t, datasetId: scope || datasetOf(t) }, deletedAt); });
  return saveExperimentDeletions(list);
};

/** LE RETOUR VOLONTAIRE : une restauration (📂 Load HTML → restauration ciblée
 *  d'une expérience) lève les suppressions des expériences qu'elle ramène, à sa
 *  date — sans quoi le verrou d'écriture reprendrait l'expérience qu'on vient de
 *  restaurer. Rend `{ deletions, revivals }` à jour. */
export const recordExperimentRevivals = (list, datasetArg, revivedAt = Date.now()) => {
  const datasetId = datasetArg === undefined || datasetArg === null ? '' : String(datasetArg);
  const items = (Array.isArray(list) ? list : []).filter(Boolean);
  let revivals = loadExperimentRevivals();
  items.forEach((t) => {
    revivals = addRevival(revivals, { ...t, datasetId: datasetId || datasetOf(t) }, revivedAt);
  });
  saveExperimentRevivals(revivals);
  return { deletions: loadExperimentDeletions(), revivals };
};
