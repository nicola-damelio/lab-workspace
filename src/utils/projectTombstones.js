/* =========================================================================
   src/utils/projectTombstones.js
   UN PROJET SUPPRIMÉ RESTE SUPPRIMÉ.

   Le défaut réparé ici : les projets d'un dataset vivent à DEUX endroits —
   dans le navigateur (localStorage `labWorkspace_projects`, voir
   projectsModule.jsx) ET dans le document du dataset (payload cloud /
   sauvegarde HTML, clé `projects`). « Delete project » n'effaçait le projet
   que du navigateur : à la réouverture du dataset, mergeProjectsFromCloud
   ré-adoptait la copie du payload et le projet RESSUSCITAIT — sur le poste
   même où il venait d'être supprimé, et sur tout autre poste ouvrant le
   dataset.

   La réparation tient dans une idée simple : la suppression laisse une
   PIERRE TOMBALE (« tombstone ») — l'id du projet, son dataset et la date —
   écrite à côté des projets (localStorage `labWorkspace_deletedProjects`) et
   portée par le payload du dataset à côté de `projects`. Toute lecture, toute
   écriture et toute fusion de projets l'appliquent : la copie du payload est
   ignorée et la copie locale est effacée. Le projet ne peut donc plus
   revenir, même quand le payload est rechargé, restauré d'une sauvegarde ou
   synchronisé depuis un autre poste (où la tombe voyage avec lui).

   Tout est PUR ici (aucun localStorage, aucun React) : les fonctions
   reçoivent et rendent des listes, projectsModule.jsx ne fait que l'entrée /
   sortie. Vérifié par _deleted_projects_test.mjs.
   ========================================================================= */

/** Clé localStorage des projets supprimés (écrite par projectsModule.jsx). */
export const DELETED_PROJECTS_KEY = 'labWorkspace_deletedProjects';

/** Clé localStorage des projets RESTAURÉS (« levées de tombe », voir plus bas).
 *  Une levée voyage comme une tombe : magasin du navigateur, payload du dataset
 *  et `_workspace/state.json`. */
export const REVIVED_PROJECTS_KEY = 'labWorkspace_revivedProjects';

/** Nombre de tombstones conservées (les plus récentes). Une suppression n'est
 *  jamais oubliée à court terme ; la limite n'existe que pour qu'un
 *  localStorage ne grossisse pas indéfiniment sur des années d'usage. */
export const MAX_TOMBSTONES = 500;

const idOf = (x) => {
  if (x && typeof x === 'object') return String(x.id === undefined || x.id === null ? '' : x.id).trim();
  return x === undefined || x === null ? '' : String(x).trim();
};

const datasetOf = (x) => String(
  x && typeof x === 'object' && x.datasetId !== undefined && x.datasetId !== null ? x.datasetId : ''
);

/** Identité d'une tombe : `<datasetId>::<id>`. L'id seul ne suffit pas — deux
 *  datasets peuvent porter des projets de même id (copie d'une sauvegarde). */
export const tombstoneKey = (entry) => `${datasetOf(entry)}::${idOf(entry)}`;

/** La clé de tombe d'UN projet (celle que addTombstone écrira). */
export const projectTombstoneKey = (project) => tombstoneKey(project);

/**
 * Une liste HORODATÉE propre et utilisable (tombes comme levées de tombe) : les
 * id vides sont écartés, deux entrées de même identité n'en font qu'une (la
 * date la plus récente gagne) et la liste est bornée à MAX_TOMBSTONES, la plus
 * récente d'abord. Accepte aussi bien `['prj_1']` que
 * `[{ id, datasetId, deletedAt }]` : une entrée écrite par une version plus
 * ancienne (ou un payload abîmé) reste donc comprise.
 */
const normalizeStamped = (list, field) => {
  const byKey = new Map();
  /* Une liste peut arriver IMBRIQUÉE : un payload écrit par une version
     antérieure (ou abîmé) rangeait la liste des tombes dans un tableau
     (« deletedProjects: [[…]] »). La perdre en silence ferait RESSUSCITER les
     projets qu'elle supprime — on l'aplatie d'un niveau, jamais plus. */
  (Array.isArray(list) ? list : []).flat(1).forEach((raw) => {
    const id = idOf(raw);
    if (!id) return;
    const entry = {
      id,
      datasetId: datasetOf(raw),
      [field]: Number(raw && typeof raw === 'object' ? raw[field] : 0) || 0
    };
    const key = `${entry.datasetId}::${id}`;
    const prev = byKey.get(key);
    if (!prev || entry[field] >= prev[field]) byKey.set(key, entry);
  });
  return Array.from(byKey.values())
    .sort((a, b) => b[field] - a[field])
    .slice(0, MAX_TOMBSTONES);
};

/** Les tombes : voir le commentaire de `normalizeStamped` (champ `deletedAt`). */
export const normalizeTombstones = (list) => normalizeStamped(list, 'deletedAt');

/** Les LEVÉES de tombe : « ce projet supprimé a été RESTAURÉ ». Même forme et
 *  même unicité qu'une tombe, la date étant celle de la restauration
 *  (`revivedAt`). Voir « une tombe peut être levée » plus bas. */
export const normalizeRevivals = (list) => normalizeStamped(list, 'revivedAt');

/** Deux listes (locale + payload, par exemple) → une seule, sans doublon. */
export const mergeTombstones = (current, incoming) => normalizeTombstones([
  ...(Array.isArray(current) ? current : []),
  ...(Array.isArray(incoming) ? incoming : [])
]);

/** Les tombes telles qu'un PAYLOAD les porte : une tombe sans dataset
 *  appartient au dataset qui l'a écrite (le payload d'un dataset ne parle que
 *  de ses propres projets). */
export const tombstonesForDataset = (list, datasetArg) => {
  const datasetId = datasetArg === undefined || datasetArg === null ? '' : String(datasetArg);
  return normalizeTombstones(list).map((t) => (!t.datasetId && datasetId ? { ...t, datasetId } : t));
};

/** Ce projet a-t-il été supprimé ? Une tombe sans dataset supprime l'id
 *  partout (une suppression faite hors dataset) ; un projet sans dataset
 *  (projet historique pas encore rattaché) est supprimé par n'importe quelle
 *  tombe de son id — c'est le même projet, l'id est unique. */
const tombMatches = (tombes, id, datasetId) =>
  tombes.some((t) => t.id === id && (!t.datasetId || !datasetId || t.datasetId === datasetId));

export const isProjectDeleted = (project, tombstones) => {
  const id = idOf(project);
  if (!id) return false;
  return tombMatches(normalizeTombstones(tombstones), id, datasetOf(project));
};

/** La liste des projets sans ceux qui ont été supprimés (même règle). */
export const withoutDeletedProjects = (projects, tombstones) => {
  const items = (Array.isArray(projects) ? projects : []).filter(Boolean);
  const tombes = normalizeTombstones(tombstones);
  if (!tombes.length) return items;
  return items.filter((p) => {
    const id = idOf(p);
    if (!id) return true;
    return !tombMatches(tombes, id, datasetOf(p));
  });
};

/* ---------------------------------------------------------------------------
 * ⛔ LE DÉFAUT RÉPARÉ ICI : « J'AI SUPPRIMÉ UN PROJET ET TOUS MES PROJETS ONT
 *    DISPARU. »
 *
 * Le geste de suppression est le SEUL chemin qui fait partir un projet du
 * magasin du navigateur : « Delete project » écrit d'abord la tombe du projet
 * visé (`recordProjectDeletion`), puis la liste sans lui. Mais la liste est
 * écrite par des fonctions qui reçoivent un TABLEAU — l'état d'une page, une
 * copie relue du payload, une sauvegarde restaurée. Si ce tableau est plus
 * court que le magasin pour une autre raison qu'une suppression (état périmé
 * après un `await`, portée de dataset, filtre par scientifique, payload qui
 * n'embarque que les projets d'un auteur…), l'écriture EFFAÇAIT des projets
 * que personne n'avait supprimés — et comme le magasin du navigateur est la
 * seule copie que le programme relit, ces projets disparaissaient de l'écran
 * ALORS QU'ILS ÉTAIENT TOUJOURS LÀ (Drive, document du dataset, sauvegarde).
 *
 * La règle ci-dessous rend ce scénario impossible : une écriture ne peut
 * faire disparaître que ce qui a une TOMBE. Toute autre disparition est
 * refusée et les projets concernés sont REMIS dans la liste écrite. Une
 * suppression reste une suppression (sa tombe est écrite avant la liste) ; une
 * perte accidentelle, elle, ne passe plus.
 * ------------------------------------------------------------------------ */

/** Les projets qu'une écriture FERAIT DISPARAÎTRE SANS AUCUNE TOMBE.
 *  C'est la signature d'une perte de données, jamais d'une suppression.
 *  @param {Array} existing  ce que le magasin contient ("projets actuels")
 *  @param {Array} incoming  ce que l'appelant veut écrire
 *  @param {Array} tombstones les tombes (les seules disparitions légitimes)
 *  @returns {Array} les projets à REMETTRE dans la liste écrite
 */
export const untombstonedDrops = (existing, incoming, tombstones) => {
  const items = (Array.isArray(existing) ? existing : []).filter(Boolean);
  const kept = new Set(
    (Array.isArray(incoming) ? incoming : []).filter(Boolean).map(idOf).filter(Boolean)
  );
  const tombes = normalizeTombstones(tombstones);
  return items.filter((p) => {
    const id = idOf(p);
    if (!id) return false;                 // un projet sans id n'est pas identifié
    if (kept.has(id)) return false;        // il est dans la liste écrite
    return !tombMatches(tombes, id, datasetOf(p));  // …et sans tombe : il est REMIS
  });
};

/** La liste à écrire, corrigée : rien de ce qui n'est pas supprimé ne peut
 *  disparaître. Rend `{ list, rescued }` — `rescued` sont les projets remis
 *  (l'appelant peut le DIRE à l'utilisateur au lieu de l'avoir perdu).
 *  L'ordre de la liste écrite est conservé, les projets remis suivent. */
export const protectUntombstoned = (existing, incoming, tombstones) => {
  const list = (Array.isArray(incoming) ? incoming : []).filter(Boolean);
  const rescued = untombstonedDrops(existing, list, tombstones);
  if (!rescued.length) return { list, rescued };
  const seen = new Set(list.map(idOf).filter(Boolean));
  const out = list.slice();
  rescued.forEach((p) => {
    const id = idOf(p);
    if (id && seen.has(id)) return;
    if (id) seen.add(id);
    out.push(p);
  });
  return { list: out, rescued };
};

/** Ajoute la tombe d'un projet supprimé (la plus récente, en tête). */
export const addTombstone = (tombstones, project, deletedAt = Date.now()) => {
  const id = idOf(project);
  if (!id) return normalizeTombstones(tombstones);
  return normalizeTombstones([
    { id, datasetId: datasetOf(project), deletedAt: Number(deletedAt) || Date.now() },
    ...(Array.isArray(tombstones) ? tombstones : [])
  ]);
};

/** Les ids supprimés (Set) — pour écarter des copies par id seulement. */
export const deletedProjectIds = (tombstones) =>
  new Set(normalizeTombstones(tombstones).map((t) => t.id));

/** Retire les tombes d'UN dataset : quand le dataset lui-même est supprimé,
 *  ses projets ET leurs tombes disparaissent (sinon un dataset recréé avec le
 *  même id ne pourrait plus jamais afficher ses projets). */
export const withoutDatasetTombstones = (tombstones, datasetArg) => {
  const datasetId = datasetArg === undefined || datasetArg === null ? '' : String(datasetArg);
  return normalizeTombstones(tombstones).filter((t) => t.datasetId !== datasetId);
};

/* ---------------------------------------------------------------------------
 * ↩ UNE TOMBE PEUT ÊTRE LEVÉE — « le projet supprimé doit revenir ».
 *
 * Le rapport : « there was a project called “tmp” with figures and text. It
 * looks gone. If I reload from HTML and select only to restore projects,
 * nothing happens. » Rien ne se passait — et rien ne POUVAIT se passer : une
 * tombe était définitive. Aucun geste de l'application ne la retirait, et les
 * trois chemins qui ramènent un projet depuis une copie (import d'une
 * sauvegarde HTML, fusion du payload du dataset, ré-adoption de
 * `_workspace/state.json`) appliquent TOUS la tombe : l'import écrivait donc
 * la liste du fichier SANS le projet concerné, en silence.
 *
 * La levée est donc une DONNÉE, comme la tombe : la date à laquelle le projet
 * a été restauré. Elle voyage avec le payload du dataset et avec
 * `_workspace/state.json` (REVIVED_PROJECTS_KEY) — sinon un autre poste, qui
 * garde la tombe, la re-publierait et le projet disparaîtrait une seconde fois.
 *
 * La règle se lit sur les deux dates, la plus RÉCENTE gagne : restaurer puis
 * supprimer à nouveau supprime pour de bon ; restaurer après une suppression
 * l'emporte, y compris sur une tombe d'une version antérieure (date inconnue
 * = 0). Vérifié par _deleted_projects_test.mjs.
 * ------------------------------------------------------------------------ */

/** La RÈGLE d'identité, une seule fois : même id, et un dataset absent d'un
 *  côté au moins (ou identique) — un projet sans dataset est le même projet. */
const sameStamped = (a, b) => !!a && !!b && a.id === b.id
  && (!a.datasetId || !b.datasetId || a.datasetId === b.datasetId);

/** LES TOMBES QUI TIENNENT ENCORE : celles qu'aucune levée plus récente (ou de
 *  même date) n'a annulées. C'est la seule lecture des suppressions de projets
 *  (projectsModule) — lever une tombe est donc vu de partout d'un coup. */
export const withoutRevivedProjects = (tombstones, revivals) => {
  const lifted = normalizeRevivals(revivals);
  const tombes = normalizeTombstones(tombstones);
  if (!lifted.length) return tombes;
  return tombes.filter((t) => !lifted.some(
    (r) => sameStamped(r, t) && (Number(r.revivedAt) || 0) >= (Number(t.deletedAt) || 0)
  ));
};

/** Enregistrer une levée de tombe (la plus récente d'abord). */
export const addRevival = (revivals, target, revivedAt = Date.now()) => {
  const id = idOf(target);
  if (!id) return normalizeRevivals(revivals);
  return normalizeRevivals([
    { id, datasetId: datasetOf(target), revivedAt: Number(revivedAt) || Date.now() },
    ...(Array.isArray(revivals) ? revivals : [])
  ]);
};

/** Retirer la levée d'un projet : une SUPPRESSION postérieure doit l'emporter
 *  (« Delete project » après une restauration est une vraie suppression). */
export const withoutRevival = (revivals, target) => {
  const id = idOf(target);
  if (!id) return normalizeRevivals(revivals);
  const wanted = { id, datasetId: datasetOf(target) };
  return normalizeRevivals(revivals).filter((r) => !sameStamped(r, wanted));
};

/** Les levées telles qu'un PAYLOAD les porte : une levée sans dataset
 *  appartient au dataset qui l'a écrite (le payload ne parle que de lui). */
export const revivalsForDataset = (list, datasetArg) => {
  const datasetId = datasetArg === undefined || datasetArg === null ? '' : String(datasetArg);
  return normalizeRevivals(list).map((r) => (!r.datasetId && datasetId ? { ...r, datasetId } : r));
};
