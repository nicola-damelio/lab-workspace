/* =========================================================================
   src/utils/teamAccounts.js
   LA LISTE DES COMPTES EST PARTAGÉE : UN POSTE QUI GARDAIT UNE COPIE PLUS
   ANCIENNE N'EFFACE PLUS SES COLLÈGUES.

   LE DÉFAUT RÉPARÉ ICI, dit par le rapport : un compte créé sur un poste a
   disparu, et « les mots de passe des collègues ne marchaient plus ». La liste
   des comptes vit ENTIÈRE dans un seul champ du document partagé
   (`appConfig/global.operators`) et chaque poste l'écrit d'un bloc. Un poste
   resté sur une copie plus ancienne (onglet ouvert depuis le matin, cache
   local, lecture cloud en échec) publie donc une liste PLUS COURTE : le
   collègue ajouté entre-temps n'y est pas, et la liste partagée est remplacée.
   Le garde-fou existant (App.jsx) ne se déclenche que lorsque la liste locale
   est VIDE : une liste ancienne mais non vide passait sans un mot.

   LA RÉPARATION tient dans les TROIS mêmes idées que pour les projets et les
   expériences (utils/projectTombstones.js, utils/experimentTombstones.js) :

     1. L'ÉCRITURE FUSIONNE — `mergeOperators(local, distant, removed)` : la
        copie PARTAGÉE, relue juste avant d'écrire, fait foi pour les comptes
        qu'elle porte ; ceux que ce poste a et qu'elle ne porte pas sont AJOUTÉS.
        Un compte ne peut donc disparaître que par une suppression.
     2. L'IDENTITÉ D'UN COMPTE EST LA PERSONNE, pas l'id : deux postes qui
        créent le même collègue fabriquent deux id différents. L'identité est
        donc le nom, accents et ordre des mots ignorés (`opNameKey`, la règle
        déjà utilisée par l'identité de session dans utils/auth.js) — sans elle,
        la fusion fabriquerait des doublons au lieu de retrouver la personne.
     3. LA SUPPRESSION EST UNE DONNÉE — `removedOperators` : le geste « × »
        écrit un record DATÉ, qui voyage avec la liste (document partagé) et sur
        lequel la fusion s'appuie — sinon un autre poste, qui détient encore le
        compte, le republierait. Recréer la personne LÈVE le record.

   Tout est PUR ici, à l'exception du bloc « MAGASIN » en fin de fichier (les
   mêmes deux lignes de lecture / écriture localStorage que les autres verrous).
   Vérifié par _team_accounts_test.mjs.
   ========================================================================= */
import { normalizeOperators, opNameKey } from './auth';

/** Clé localStorage des records de suppression. */
export const REMOVED_OPERATORS_KEY = 'labWorkspace_removedOperators';
/** Nombre de records conservés (les plus récents) : une suppression ne doit pas
 *  être oubliée à court terme, mais un localStorage ne grossit pas sans fin. */
export const MAX_REMOVED_OPERATORS = 200;

const idOf = (x) => String(x && typeof x === 'object' && x.id !== undefined && x.id !== null ? x.id : '').trim();
const nameOf = (x) => String(x && typeof x === 'object' && x.name !== undefined && x.name !== null ? x.name : '').trim();

/** L'identité d'une PERSONNE : son nom (accents et ordre des mots ignorés), son
 *  id seulement quand il n'y a pas de nom. C'est ELLE qui empêche deux postes
 *  de créer deux fois le même collègue. */
export const personKey = (op) => opNameKey(nameOf(op)) || (idOf(op) ? `id:${idOf(op)}` : '');

/** L'identité d'un COMPTE tel qu'il est écrit : `id:<id>`, sinon `name:<nom>`. */
export const operatorKey = (op) => {
  const id = idOf(op);
  if (id) return `id:${id}`;
  const key = opNameKey(nameOf(op));
  return key ? `name:${key}` : '';
};

/** Deux entrées désignent-elles la même personne ? */
export const samePerson = (a, b) => {
  const key = personKey(a);
  return !!key && key === personKey(b);
};

/* ---------------------------------------------------------------------------
 * 🗑 LES RECORDS DE SUPPRESSION (le geste « × » les écrit AVANT la liste)
 * ------------------------------------------------------------------------ */

/** Une entrée de record, quelle que soit sa forme : une chaîne est un NOM
 *  (c'est ainsi qu'une version ancienne écrivait un opérateur). */
const entryOf = (raw) => (typeof raw === 'string'
  ? { id: '', name: raw.trim() }
  : { id: idOf(raw), name: nameOf(raw) });

/** Une liste de records propre et utilisable : les entrées sans identité sont
 *  écartées, deux records de la même personne n'en font qu'un (le plus récent),
 *  la liste est bornée, la plus récente d'abord. Une liste imbriquée (ou un
 *  payload abîmé) reste comprise, comme pour les autres verrous. */
export const normalizeRemovedOperators = (list) => {
  const flat = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v) flat.push(v);
  };
  walk(list);
  const byKey = new Map();
  flat.forEach((raw) => {
    const base = entryOf(raw);
    const entry = {
      id: base.id,
      name: base.name,
      key: personKey(base),
      removedAt: Number(raw && typeof raw === 'object' ? raw.removedAt : 0) || 0
    };
    if (!entry.key) return;
    const prev = byKey.get(entry.key);
    if (!prev || entry.removedAt >= prev.removedAt) byKey.set(entry.key, entry);
  });
  return Array.from(byKey.values())
    .sort((a, b) => b.removedAt - a.removedAt)
    .slice(0, MAX_REMOVED_OPERATORS);
};

/** Enregistrer la suppression d'un compte (la plus récente en tête). */
export const addRemovedOperator = (list, op, removedAt = Date.now()) => {
  const entry = { id: idOf(op), name: nameOf(op), removedAt: Number(removedAt) || Date.now() };
  if (!personKey(entry)) return normalizeRemovedOperators(list);
  return normalizeRemovedOperators([entry, ...(Array.isArray(list) ? list : [])]);
};

/** La liste SANS le record de cette personne (une recréation, une
 *  restauration : le retour volontaire lève la suppression). */
export const withoutRemovedOperator = (list, op) => {
  const key = personKey(op);
  if (!key) return normalizeRemovedOperators(list);
  return normalizeRemovedOperators(list).filter((r) => r.key !== key);
};

/** Ce compte est-il supprimé (et non recréé depuis) ? */
export const isOperatorRemoved = (op, removed) => {
  const key = personKey(op);
  if (!key) return false;
  return normalizeRemovedOperators(removed).some((r) => r.key === key);
};

/** ADOPTER les records portés par une copie (document partagé) : ils s'ajoutent
 *  aux nôtres — une suppression faite sur un autre poste vaut ici aussi, sinon
 *  ce poste republierait le compte supprimé. */
export const mergeRemovedOperators = (a, b) => normalizeRemovedOperators([
  ...(Array.isArray(b) ? b : []),
  ...(Array.isArray(a) ? a : [])
]);

/* ---------------------------------------------------------------------------
 * ⛔ LA FUSION — « la liste partagée qu'on s'apprête à écraser »
 * ------------------------------------------------------------------------ */

/** Forme canonique d'une liste d'équipe : sert à comparer deux listes sans être
 *  trompé par l'ordre (le tri d'affichage n'est pas une donnée de l'équipe). */
const canonical = (list) => normalizeOperators(list)
  .map((op) => ({
    id: op.id,
    name: op.name,
    role: op.role,
    passwordHash: op.passwordHash,
    personnelId: op.personnelId
  }))
  .sort((a, b) => (personKey(a) < personKey(b) ? -1 : personKey(a) > personKey(b) ? 1 : 0));

/** Deux listes désignent-elles la même équipe (mêmes personnes, mêmes rôles,
 *  mêmes mots de passe, même liaison de fiche) ? Sert à ne RIEN écrire — et à
 *  ne rien annoncer — quand la fusion ne change rien. */
export const sameTeamList = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** LA LISTE À PUBLIER.
 *
 *  @param {Array} local   la liste de ce poste (ce qu'il s'apprêtait à écrire)
 *  @param {Array} distant la liste de la copie PARTAGÉE (relue avant d'écrire)
 *  @param {Array} removed les records de suppression (les tombes)
 *  @returns {{list:Array, saved:Array, added:Array, changed:boolean}}
 *    · `list`    la liste fusionnée, triée par nom ;
 *    · `saved`   les comptes que la copie partagée portait et que ce poste
 *                n'avait PAS — l'enregistrement allait les effacer (à DIRE) ;
 *    · `added`   les comptes que ce poste apporte et que la copie partagée ne
 *                portait pas encore (un ajout normal, rien à signaler) ;
 *    · `changed` vrai quand publier change vraiment quelque chose.
 *
 *  La copie partagée fait foi pour les comptes qu'elle porte (c'est elle que
 *  tout le monde lit) : un poste ne renverse donc pas un mot de passe plus
 *  récent posé ailleurs — le même choix que le garde-fou existant
 *  (« le cloud fait foi », App.jsx). */
export const mergeOperators = (local, distant, removed = []) => {
  const localList = normalizeOperators(local).filter(Boolean);
  const distantList = normalizeOperators(distant).filter(Boolean);
  const isRemoved = (op) => isOperatorRemoved(op, removed);
  const localKeys = new Set(localList.map(personKey).filter(Boolean));
  const distantKeys = new Set(distantList.map(personKey).filter(Boolean));
  const seen = new Set();
  const kept = [];
  distantList.forEach((op) => {
    const key = personKey(op);
    if (!key || seen.has(key) || isRemoved(op)) return;
    seen.add(key);
    kept.push(op);
  });
  const added = [];
  localList.forEach((op) => {
    const key = personKey(op);
    if (!key || seen.has(key) || isRemoved(op)) return;
    seen.add(key);
    added.push(op);
  });
  const list = kept.concat(added)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  return {
    list,
    saved: distantList.filter((op) => {
      const key = personKey(op);
      return !!key && !localKeys.has(key) && !isRemoved(op);
    }),
    added: added.filter((op) => !distantKeys.has(personKey(op))),
    changed: !sameTeamList(list, localList)
  };
};

/** Le compte-rendu d'une fusion qui a SAUVÉ des comptes (jamais un
 *  enregistrement muet — même règle que pour les projets et les expériences). */
export const describeTeamMerge = ({ saved = [] } = {}) => (
  Array.isArray(saved) && saved.length
    ? `⚠ The SHARED team list carried ${saved.length} account(s) this browser did not have `
      + `(${saved.map((op) => op.name).filter(Boolean).slice(0, 6).join(', ')}): they were KEPT and `
      + 'republished with your list. This is the signature of a stale copy (another workstation, or an '
      + 'old tab): the team is merged, never replaced — an account disappears only when it is removed '
      + 'here (×) and that removal is published.'
    : ''
);

/* ---------------------------------------------------------------------------
 * 💾 MAGASIN — la clé localStorage des records (App.jsx ne fait que l'entrée/sortie)
 * ------------------------------------------------------------------------ */

const storeOf = () => {
  try {
    return globalThis.localStorage ? globalThis.localStorage : null;
  } catch {
    return null;   // navigation privée : la règle reste en mémoire pour la session
  }
};

export const loadRemovedOperators = () => {
  const store = storeOf();
  if (!store) return [];
  try {
    return normalizeRemovedOperators(JSON.parse(store.getItem(REMOVED_OPERATORS_KEY) || '[]'));
  } catch {
    return [];
  }
};

export const saveRemovedOperators = (list) => {
  const out = normalizeRemovedOperators(list);
  const store = storeOf();
  if (!store) return out;
  try { store.setItem(REMOVED_OPERATORS_KEY, JSON.stringify(out)); } catch { /* plein / privé */ }
  return out;
};

/** Adopter (et enregistrer) les records d'une copie : le point d'entrée du
 *  document partagé. */
export const adoptRemovedOperators = (list) => saveRemovedOperators(mergeRemovedOperators(loadRemovedOperators(), list));

/** LE GESTE de suppression, en une fonction : la tombe d'abord (l'appelant
 *  écrit la liste ensuite — l'ordre compte, comme pour les projets). */
export const removeOperatorRecord = (op, removedAt = Date.now()) =>
  saveRemovedOperators(addRemovedOperator(loadRemovedOperators(), op, removedAt));

/** LE RETOUR VOLONTAIRE : recréer (ou rééditer) la personne lève sa tombe —
 *  sans quoi le prochain enregistrement d'un autre poste, qui ne connaît que la
 *  tombe, laisserait le compte de côté. */
export const reviveOperator = (op) =>
  saveRemovedOperators(withoutRemovedOperator(loadRemovedOperators(), op));
