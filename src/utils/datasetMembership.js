/* =========================================================================
   src/utils/datasetMembership.js
   « À QUI CE DATASET EST-IL OUVERT ? » — LA MÊME RÈGLE, VUE DU CÔTÉ DE LA
   PERSONNE.

   La règle d'accès vit sur CHAQUE document dataset (champ top-level `access`,
   voir utils/datasetAccess.js) et c'est ELLE que l'application applique pour
   ouvrir ou masquer une carte de la page d'accueil (`canUserOpenDataset`).
   Le panneau d'équipe de la page d'accueil se lit dans l'autre sens — « pour
   cette personne, quels datasets ? » — mais il ne crée AUCUNE seconde copie
   de la vérité : tout est calculé à partir du même champ `access`, et les
   gestes de la matrice rendent des PATCHES de ce champ (aucun compte ne
   porte la liste de ses datasets, sinon deux copies divergeraient).

   Deux conséquences, voulues :
     · cocher une personne pour un dataset RESTREINT ce dataset
       (`restricted: true`) — sans quoi « 🌐 visible par tous les comptes »
       contredirait la promesse « ces datasets sont ceux qu'elle voit » ;
     · décocher la dernière personne ne rouvre PAS le dataset (elle retire
       seulement son nom) : rouvrir est un geste explicite
       (`setDatasetRestriction`), jamais un effet de bord d'un décochage.

   Tout est PUR ici (aucune écriture, aucun accès réseau) : les composants ne
   font que l'entrée / sortie, comme partout ailleurs dans ce dépôt. Vérifié
   par _dataset_membership_test.mjs.
   ========================================================================= */
import { datasetAccessOf, normalizeMemberNames, canUserOpenDataset } from './datasetAccess';
import { normalizeOperators } from './auth';

/** Clé de comparaison d'un membre. ⚠️ C'est EXACTEMENT la règle de
 *  utils/datasetAccess.js (majuscules/minuscules et espaces autour ignorés) :
 *  la durcir ici sans la durcir là-bas rendrait la matrice menteuse — un nom
 *  coché qui n'ouvrirait pas le dataset. */
export const memberKey = (name) => String(name === undefined || name === null ? '' : name).trim().toLowerCase();

/** Deux écritures du même membre (casse / espaces près) désignent-elles la
 *  même personne ? (un nom vide ne désigne jamais personne) */
export const sameMember = (a, b) => {
  const ka = memberKey(a);
  return !!ka && ka === memberKey(b);
};

/** Les comptes qui peuvent être MEMBRES d'un dataset : tous sauf les
 *  superutilisateurs (ils ont déjà accès partout) et ceux sans nom (une
 *  entrée sans nom n'est pas une personne). Même liste que l'éditeur
 *  « 👥 Membres » d'un dataset (datasetAccessModal.jsx). */
export const invitableOperators = (operators) =>
  normalizeOperators(operators).filter((op) => !!op.name && op.role !== 'superuser');

/** La personne est-elle déjà membre de ce dataset ? */
export const isMemberOfDataset = (dset, name) =>
  !!(name && String(name).trim()) && datasetAccessOf(dset).memberNames.some((n) => sameMember(n, name));

/** Ajoute un membre à un dataset : la personne est nommée, la liste est
 *  normalisée, et le dataset est RESTREINT (voir l'en-tête du fichier).
 *  `changed` dit si quelque chose bouge vraiment (aucune écriture inutile). */
export const addMember = (dset, name) => {
  const access = datasetAccessOf(dset);
  const clean = String(name || '').trim();
  if (!clean) return { restricted: access.restricted, memberNames: access.memberNames, changed: false };
  const already = access.memberNames.some((n) => sameMember(n, clean));
  if (already && access.restricted) {
    return { restricted: true, memberNames: access.memberNames, changed: false };
  }
  return {
    restricted: true,
    memberNames: normalizeMemberNames([...access.memberNames, clean]),
    changed: true,
  };
};

/** Retire un membre d'un dataset. La restriction est CONSERVÉE : décocher la
 *  dernière personne ne rouvre pas le dataset (geste explicite, voir
 *  setDatasetRestriction). */
export const removeMember = (dset, name) => {
  const access = datasetAccessOf(dset);
  const clean = String(name || '').trim();
  if (!clean) return { restricted: access.restricted, memberNames: access.memberNames, changed: false };
  const kept = access.memberNames.filter((n) => !sameMember(n, clean));
  return {
    restricted: access.restricted,
    memberNames: kept,
    changed: kept.length !== access.memberNames.length,
  };
};

/** Le geste de la matrice pour UNE personne : les patches `access` des
 *  datasets dont l'appartenance change réellement.
 *  @param {Array} datasets tous les datasets connus
 *  @param {string} name le compte (son nom — c'est l'identité des membres)
 *  @param {Iterable<string>} checkedIds identifiants des datasets cochés
 *  @returns {Array<{id:string, access:object}>} à écrire tels quels (les
 *  datasets inchangés ne figurent pas dans le résultat) */
export const memberPatchesForUser = (datasets, name, checkedIds) => {
  const iterable = checkedIds && typeof checkedIds[Symbol.iterator] === 'function' ? [...checkedIds] : [];
  const wanted = new Set(iterable.map((id) => String(id || '').trim()).filter(Boolean));
  const out = [];
  (Array.isArray(datasets) ? datasets : []).forEach((dset) => {
    if (!dset || !dset.id) return;
    const member = isMemberOfDataset(dset, name);
    const want = wanted.has(String(dset.id));
    if (member === want) return;
    const patch = want ? addMember(dset, name) : removeMember(dset, name);
    if (patch.changed) {
      out.push({ id: String(dset.id), access: { restricted: patch.restricted, memberNames: patch.memberNames } });
    }
  });
  return out;
};

/** Le geste « 🌐 visible par tous / 🔒 seulement les membres » d'un dataset.
 *  Les noms de membres sont CONSERVÉS dans les deux sens : rouvrir puis
 *  refermer retrouve la liste d'avant. */
export const setDatasetRestriction = (dset, restricted) => {
  const access = datasetAccessOf(dset);
  return { restricted: !!restricted, memberNames: access.memberNames };
};

/** Les noms listés dans `access.memberNames` qui ne correspondent à AUCUN
 *  compte de l'équipe : une liste de membres peut vieillir (compte renommé
 *  ou retiré) et ces noms-là n'ouvrent le dataset à personne. Le panneau les
 *  affiche — sans quoi une personne « ajoutée » ne verrait rien et personne
 *  ne saurait pourquoi. */
export const unknownMembersOf = (dset, operators) => {
  const team = normalizeOperators(operators);
  return datasetAccessOf(dset).memberNames.filter((n) => !team.some((op) => sameMember(op.name, n)));
};

/** LES DATASETS D'UNE PERSONNE — exactement ceux que l'application lui
 *  ouvrira (c'est `canUserOpenDataset` qui répond, pas une seconde règle). */
export const datasetsOfUser = (datasets, user, opts = {}) =>
  (Array.isArray(datasets) ? datasets : []).filter((d) => canUserOpenDataset(d, user, opts));

/** Le compte-rendu affiché sous la matrice : comptes, datasets, datasets
 *  restreints, noms sans compte. Jamais de chiffres inventés — tout est lu
 *  dans les datasets. */
export const membershipSummary = (datasets, operators) => {
  const list = (Array.isArray(datasets) ? datasets : []).filter((d) => d && d.id);
  const unknown = [];
  let restricted = 0;
  let named = 0;
  list.forEach((d) => {
    const access = datasetAccessOf(d);
    if (access.restricted) restricted += 1;
    if (access.memberNames.length) named += 1;
    unknownMembersOf(d, operators).forEach((n) => {
      if (!unknown.some((u) => sameMember(u, n))) unknown.push(n);
    });
  });
  return {
    datasets: list.length,
    accounts: invitableOperators(operators).length,
    restricted,
    named,
    unknown,
  };
};
