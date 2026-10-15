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

/** L'ID seul d'une expérience ('' quand elle n'en a pas) — l'identité qui TRAVERSE
 *  les renommages : l'objet du Drive garde l'id d'une expérience pendant que son
 *  nom change. Exporté pour que l'écran (➕ App.jsx) et la fenêtre d'import
 *  (`experimentRowChoices`) n'aient pas leur propre variante de la règle : une
 *  identité, un seul endroit — c'est exactement la divergence nom/id qui laissait
 *  une expérience reprise repartir en silence. */
export const experimentId = (test) => idOf(test);

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
 *  disparaître. Rend `{ tests, rescued, removed, collapsed }` — `rescued` sont les
 *  expériences remises (l'appelant peut le DIRE au lieu de les avoir perdues),
 *  `removed` celles retirées parce que leur suppression est enregistrée, et
 *  `collapsed` les jumeaux (même id, deux noms) qu'une version antérieure avait
 *  laissés s'écrire : la copie qui part n'en porte plus deux.
 *  L'ordre de la liste écrite est conservé, les expériences remises suivent. */
export const protectUnrecordedDrops = (known, outgoing, deletions) => {
  /* ❗ CE QUI PART EST SANS JUMEAUX : le payload voyage ENTIER, donc publier deux
     lignes pour un id publie le jumeau que la relecture suivante effacera — une
     des deux lignes, en silence. L'effondrement se DIT (voir
     `describeCollapsedExperiments`) : ce n'est pas une perte, c'est une ligne de
     trop pour une même expérience. */
  const { tests: list, collapsed } = collapseExperimentTwins(outgoing);
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
  return { tests, rescued, removed: out.length - tests.length, collapsed };
};

/** ⛔ LE MÊME VERROU, VU DE L'AUTRE CÔTÉ DU FIL — « la copie PARTAGÉE qu'on
 *  s'apprête à écraser ».
 *
 *  `protectUnrecordedDrops` protège ce que CE poste connaît. Reste le cas du
 *  rapport : une expérience créée sur un AUTRE poste pendant que celui-ci
 *  gardait une copie plus ancienne. Ce poste-ci ne l'a jamais vue, donc sa
 *  mémoire ne peut pas la reprendre… alors que l'enregistrement l'effacerait
 *  quand même du document partagé (le payload voyage ENTIER : le vider de ce
 *  qu'on ne connaît pas est exactement ce qu'aucun enregistrement n'a le droit
 *  de faire).
 *
 *  D'où ce second verrou, appliqué AVANT d'écrire (App.jsx,
 *  `guardDistantExperiments`) : la copie DISTANTE — le document partagé — est
 *  relue, et ce qu'elle porte et que nous n'avons pas est REMIS, tant qu'aucune
 *  suppression n'est enregistrée pour lui (une 🗑 faite ailleurs reste une 🗑).
 *
 *  @param {Array} distant  les expériences de la copie partagée (relue)
 *  @param {Array} outgoing la liste que ce poste s'apprête à écrire
 *  @param {Array} deletions les suppressions enregistrées (déjà sans les levées)
 *  @returns {{tests:Array, rescued:Array, removed:number, collapsed:Array}}
 */
export const protectDistantDrops = (distant, outgoing, deletions) => {
  const { tests: list, collapsed } = collapseExperimentTwins(outgoing);
  const { tests: distantList, collapsed: distantCollapsed } = collapseExperimentTwins(distant);
  const records = normalizeDeletions(deletions);
  const rescued = unrecordedDrops(distantList, list, records);
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
  return { tests, rescued, removed: out.length - tests.length, collapsed: collapsed.concat(distantCollapsed) };
};

/** L'id d'une entrée SANS id : le seul cadeau que ce module se permet
 *  (l'écran en donnait un, chacun de son côté — c'est la même formule). */
const defaultFreshId = () => 't' + Math.random().toString(36).substr(2, 9) + Date.now();

/** UN ID, UNE LIGNE — l'effondrement des JUMEAUX écrits par une version
 *  antérieure du programme : deux lignes (ou plus) portant le MÊME `id` sous des
 *  noms DIFFÉRENTS. C'est le cas des fichiers de reprise : l'objet du Drive garde
 *  l'id de l'expérience À TRAVERS SES RENOMMAGES (« Test 87 » ≡ « pdb_ » ≡
 *  « pdb_CDK2_CyclinA »), donc la même expérience y apparaît sous plusieurs noms
 *  — et une lecture qui identifie par le NOM en garde deux.
 *
 *  La PREMIÈRE ligne gagne (l'ordre de l'écran, celui du payload : rien ne se
 *  réordonne sous les yeux de l'utilisateur), les autres sont rendues dans
 *  `collapsed` — `{ kept, copy }` — pour être DITES : un effondrement muet serait
 *  exactement le défaut que ce module répare.
 *
 *  @returns {{tests:Array, collapsed:Array<{kept:object, copy:object}>}}
 */
export const collapseExperimentTwins = (tests) => {
  const list = (Array.isArray(tests) ? tests : []).filter(Boolean);
  const out = [];
  const byId = new Map();
  const collapsed = [];
  list.forEach((t) => {
    const id = idOf(t);
    if (!id) { out.push(t); return; }            // sans id : rien à effondrer
    const kept = byId.get(id);
    if (!kept) { byId.set(id, t); out.push(t); return; }
    collapsed.push({ kept, copy: t });
  });
  return { tests: out, collapsed };
};

/** CE QUI ENTRE À L'ÉCRAN QUAND ON APPLIQUE UNE COPIE (➕ « Add the selected
 *  elements », fenêtre d'import) — la règle d'identité du programme, UNE fois :
 *  une expérience que ce dataset porte DÉJÀ — MÊME ID ou MÊME NOM — n'est jamais
 *  empilée.
 *
 *  ❗ L'ID D'ABORD : c'est lui qui traverse les renommages. Une reprise du Drive
 *  ramène l'expérience sous son nom d'aujourd'hui avec l'id qu'elle a toujours
 *  eu ; l'anti-jumeau qui ne comparait que des NOMS (l'écran avait sa règle, le
 *  verrou la sienne) en empilait une SECONDE ligne, et la relecture suivante —
 *  elle, ID-keyée — effaçait l'une des deux sans un mot.
 *
 *  Entre les lignes du MÊME fichier, le nom ne sépare rien : deux conditions d'un
 *  même essai portent le même nom et des ids différents, et c'est l'essai ENTIER
 *  qui doit revenir. Le nom ne sépare que de ce que le dataset PORTE DÉJÀ.
 *
 *  Rend `{ tests, skipped }` : les lignes à ajouter (avec leur id d'origine ; une
 *  entrée sans id en reçoit un, sinon rien ne pourrait plus la reconnaître) et
 *  celles écartées — `{ test, twin, by }`, `by` valant `'id'` ou `'name'` — pour
 *  que l'appelant le DISE (voir `describeSkippedAdditions`).
 */
export const experimentsToAdd = (current, incoming, makeId) => {
  const screen = (Array.isArray(current) ? current : []).filter(Boolean);
  const ids = new Set(screen.map(idOf).filter(Boolean));
  const names = new Set(screen.map(nameOf).filter(Boolean));
  const newId = typeof makeId === 'function' ? makeId : defaultFreshId;
  const tests = [];
  const skipped = [];
  (Array.isArray(incoming) ? incoming : []).forEach((raw) => {
    const row = raw && typeof raw === 'object' ? raw : { name: String(raw === undefined || raw === null ? '' : raw) };
    const id = idOf(row);
    const name = nameOf(row);
    /* ❗ L'ID D'ABORD, ET PARTOUT : dans le dataset ET dans ce que ce même geste
       vient d'ajouter. Deux entrées d'un même fichier qui portent le même id
       sont une seule expérience (c'est la règle « un id, une ligne » que la
       relecture applique, elle) : les empiler ferait la ligne de trop que la
       relecture suivante effacerait en silence. */
    const twin = id && ids.has(id)
      ? (screen.find((t) => idOf(t) === id) || tests.find((t) => idOf(t) === id))
      : (name && names.has(name) ? screen.find((t) => nameOf(t) === name) : null);
    if (twin) { skipped.push({ test: row, twin, by: id && idOf(twin) === id ? 'id' : 'name' }); return; }
    if (id) ids.add(id);
    if (name) names.add(name);
    tests.push(id ? { ...row } : { ...row, id: newId() });
  });
  return { tests, skipped };
};

/** UNE LECTURE N'EFFACE PLUS : la copie relue (`incoming`) est adoptée telle
 *  quelle, et ce que ce poste connaît (`current`) et qu'elle ne porte pas est
 *  AJOUTÉ à la fin. Les suppressions enregistrées s'appliquent aux deux.
 *
 *  ❗ UN ID, UNE LIGNE — ET L'AUTRE NOM SE DIT. L'id est l'identité qui TRAVERSE
 *  les renommages : la copie relue peut donc porter NOTRE id sous un AUTRE nom (un
 *  poste a renommé l'expérience, ou la reprise du Drive l'a ramenée sous son nom
 *  d'aujourd'hui). Deux lignes pour un même id était le jumeau que la relecture
 *  SUIVANTE, elle, efface par id — la ligne reprise repartait alors sans un mot.
 *  Ici la ligne DE L'ÉCRAN reste (« l'ancien nom ne bouge pas » : l'utilisateur ne
 *  voit rien changer sous ses yeux) et l'autre nom est rendu dans `aliases` pour
 *  être DIT — jamais recopié en silence.
 *
 *  Rend `{ tests, added, aliases, collapsed }` :
 *   · `added` — expériences gardées parce que la copie relue ne les portait pas
 *     (le signe qu'un autre poste a publié une liste plus courte) ;
 *   · `aliases` — `{ kept, copy }` : même id, deux noms (le nom gardé est celui de
 *     l'écran, l'autre est son alias) ;
 *   · `collapsed` — lignes en double DÉJÀ écrites par une version antérieure du
 *     programme (même id, autres noms) effondrées en une seule : rien ne s'efface
 *     en silence, l'effondrement se dit (voir `describeCollapsedExperiments`).
 */
export const mergeExperimentsAddOnly = (current, incoming, deletions) => {
  const records = normalizeDeletions(deletions);
  const mine = (Array.isArray(current) ? current : []).filter(Boolean);
  const fresh = [];
  const collapsed = [];
  (Array.isArray(incoming) ? incoming : []).forEach((t) => {
    const id = idOf(t);
    const name = nameOf(t);
    /* Le nom d'abord (deux entrées sans id sont deux expériences), puis l'id : le
       survivant garde SA ligne, et un autre nom pour le même id est un alias. */
    const twin = id
      ? fresh.find((k) => idOf(k) === id)
      : fresh.find((k) => !!name && nameOf(k) === name);
    if (!twin) { fresh.push(t); return; }
    if ((nameOf(twin) || '') !== (name || '')) collapsed.push({ kept: twin, copy: t });
  });
  const seen = new Set();
  const added = [];
  const aliases = [];
  mine.forEach((t) => {
    const id = idOf(t);
    const name = nameOf(t);
    const key = experimentKey(t);
    /* ❗ RECONNUE PAR L'ID D'ABORD : c'est la clé de la relecture et celle du
       verrou d'écriture. La garder EN PLUS de la ligne relue posait deux lignes
       pour un id — le jumeau que la relecture suivante effaçait. */
    const twin = id
      ? fresh.find((k) => idOf(k) === id)
      : (key ? fresh.find((k) => experimentKey(k) === key) : null);
    if (twin) {
      /* ❗ MÊME ID, DEUX NOMS : LA LIGNE DE L'ÉCRAN NE BOUGE PAS. C'est elle que
         l'utilisateur regarde, et c'est la reprise qu'elle porte ; l'autre nom est
         rendu comme ALIAS pour être DIT. (Adopter la ligne de la copie faisait
         disparaître la reprise de l'écran — son id étant « déjà là » via l'autre
         nom, aucun verrou ne bronchait : c'était la fuite ④ du diagnostic.)
         MÊME NOM, lui, n'est pas un renommage : c'est la MÊME expérience, et la
         copie relue fait foi (elle est la plus récente par construction) — une
         valeur fraîche ne se remplace pas par la nôtre. */
      const renamed = (nameOf(twin) || '') !== (name || '');
      if (id && renamed) {
        const at = fresh.indexOf(twin);
        aliases.push({ kept: t, copy: twin });
        if (at >= 0) fresh[at] = t;
      }
      return;
    }
    if (!key || seen.has(key)) return;
    if (isExperimentDeleted(t, records)) return;
    seen.add(key);
    added.push(t);
    fresh.push(t);
  });
  const tests = withoutDeletedExperiments(fresh, records);
  return { tests, added, aliases, collapsed };
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

/** Le compte-rendu du verrou à DISTANCE : la copie partagée portait des
 *  expériences que ce poste n'avait JAMAIS vues (un collègue les a créées entre
 *  deux enregistrements, sur un autre poste). Elles sont REMISES : un
 *  enregistrement ne les efface plus. */
export const describeDistantRescue = (rescued) => (
  Array.isArray(rescued) && rescued.length
    ? `⚠ The SHARED copy of this dataset carried ${rescued.length} experiment(s) this device had `
      + `never seen (${namesOf(rescued)}): a save was about to erase them from the document everyone `
      + 'reads. They were KEPT and written back with your copy. This is what a colleague working on '
      + 'the same dataset from another workstation looks like — reopen the dataset here (🔄 Refresh) '
      + 'to see their experiments.'
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

/** Le compte-rendu d'un AJOUT qui a ÉCARTÉ des lignes — « ➕ n'a rien fait » ne
 *  doit jamais ressembler à une panne : une expérience déjà portée par le
 *  dataset (même id, même nom) est nommée, et un MÊME ID sous un autre nom est
 *  dit pour ce qu'il est — la MÊME expérience, renommée (l'objet du Drive garde
 *  l'id à travers les renommages). Sans cette phrase, la reprise paraissait
 *  ignorée alors qu'elle était déjà là. */
export const describeSkippedAdditions = (skipped) => {
  const list = Array.isArray(skipped) ? skipped.filter((s) => s && s.test) : [];
  if (!list.length) return '';
  const renamed = list.filter((s) => s.by === 'id');
  const same = list.length - renamed.length;
  const parts = [];
  if (renamed.length) {
    parts.push(`${renamed.length} experiment(s) in the file carry an id this dataset ALREADY holds under another name `
      + `(${renamed.slice(0, 6).map((s) => `« ${nameOf(s.test)} » = « ${nameOf(s.twin)} »`).join(', ')}): `
      + 'the SAME experiment was renamed, so nothing was added — a load never stacks twins.');
  }
  if (same) parts.push(`${same} experiment(s) were already in this dataset under the same name.`);
  return `${list.length} experiment(s) of this file were LEFT ALONE: ${parts.join(' ')}`;
};

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
  const beforeList = (Array.isArray(before) ? before : []).filter(Boolean);
  const afterList = (Array.isArray(after) ? after : []).filter(Boolean);
  /* ❗ CE QUI A QUITTÉ L'ÉCRAN, VU PAR IDENTITÉ *ET* PAR LIGNE.
     L'id seul ne suffit pas : il TRAVERSE les renommages, donc il survit aussi
     bien à un renommage (rien n'a été supprimé) qu'à la suppression d'UNE des
     deux lignes d'un même id (une vraie suppression, invisible autrement :
     « l'id est encore là » via le jumeau, et le verrou d'écriture reprenait
     l'expérience que l'utilisateur venait de supprimer).
     La différence est le NOMBRE de lignes de cet id : un renommage le laisse
     pareil, une suppression le fait baisser. */
  const afterKeys = new Set();
  const afterById = new Map();
  afterList.forEach((t) => {
    const key = experimentKey(t);
    if (key) afterKeys.add(key);
    const id = idOf(t);
    if (!id) return;
    const entry = afterById.get(id) || { count: 0, names: new Set() };
    entry.count += 1;
    const name = nameOf(t);
    if (name) entry.names.add(name);
    afterById.set(id, entry);
  });
  const beforeById = new Map();
  beforeList.forEach((t) => {
    const id = idOf(t);
    if (id) beforeById.set(id, (beforeById.get(id) || 0) + 1);
  });
  const gone = beforeList.filter((t) => {
    const key = experimentKey(t);
    if (!key) return false;                     // pas identifiable : jamais « supprimée »
    const id = idOf(t);
    if (!id) return !afterKeys.has(key);        // sans id, le nom EST l'identité
    const entry = afterById.get(id);
    if (!entry) return true;                    // l'identité a disparu
    const name = nameOf(t);
    if (name && entry.names.has(name)) return false;   // cette ligne-ci est toujours là
    /* L'id survit sous un autre nom : renommage — donc rien à enregistrer — SAUF
       si une ligne de cet id a bel et bien quitté l'écran. */
    return entry.count < (beforeById.get(id) || 0);
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
  const targets = items.map((t) => ({ ...t, datasetId: datasetId || datasetOf(t) }));
  /* ❗ LE GESTE LOCAL L'EMPORTE SUR L'HORLOGE DES POSTES.
     La levée est écrite par CE poste, MAINTENANT, pour une expérience qu'il vient
     de ramener : or la suppression qu'elle défait a été datée par un AUTRE poste,
     dont l'horloge peut avancer (60 s d'avance suffisaient à la faire gagner).
     Comparer deux horloges de postes décidait donc à la place de l'utilisateur :
     la suppression tenait, l'enregistrement suivant publiait la copie SANS
     l'expérience reprise, et le verrou d'écriture la reprenait — elle repartait
     en silence, exactement le défaut réparé ici.
     La levée est donc datée APRÈS la suppression que ce poste CONNAÎT (celle
     qu'elle défait délibérément). Une suppression réellement postérieure — un
     autre poste a supprimé depuis — reste plus récente, donc elle tient : c'est
     « supprimer après avoir restauré supprime pour de bon ». */
  const standing = loadExperimentDeletions().filter((d) => targets.some((t) => sameStamped(d, t)));
  const latest = standing.reduce((max, d) => Math.max(max, Number(d.deletedAt) || 0), 0);
  const when = latest >= (Number(revivedAt) || 0) ? latest + 1 : revivedAt;
  let revivals = loadExperimentRevivals();
  targets.forEach((t) => {
    revivals = addRevival(revivals, t, when);
  });
  saveExperimentRevivals(revivals);
  return { deletions: loadExperimentDeletions(), revivals };
};
