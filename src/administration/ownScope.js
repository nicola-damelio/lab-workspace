/* =========================================================================
   src/administration/ownScope.js
   Attribution des lignes de demande aux personnes qui les ont déposées, pour
   le filtrage « chacun ne voit que ses propres demandes » sur les pages
   « Achats prévus / souhaités » (collection desiderate) et « OM prévus /
   souhaités » (collection om).

   Règle retenue avec l’équipe :
     · le superutilisateur voit TOUTES les lignes (il décide et transfère) ;
     · chaque autre membre ne voit QUE les lignes qu’il a lui-même déposées
       (description + état / statut de ses produits), jamais celles des autres ;
     · une ligne est attribuée par son identifiant de fiche Personnel
       (`demandeurPersonId`, posé à la création — champ libre « demandeur »
       verrouillé sur soi-même pour les membres), sinon par correspondance de
       nom normalisée avec la colonne « demandeur » (anciens imports Google
       Sheets) puis par l’enveloppe d’audit `createdBy`.
   ========================================================================= */

const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Clé de comparaison d’un nom (accents retirés, mots triés : « Nom Prénom »
 *  et « Prénom Nom » sont considérés identiques). */
export const scopeNameKey = (s) => {
  const k = norm(s);
  return k ? k.split(/\s+/).sort().join(' ') : '';
};

/** Deux noms désignent-ils la même personne ? */
export const scopeSameName = (a, b) => !!a && !!b && scopeNameKey(a) === scopeNameKey(b);

/** Noms d’identité du membre connecté : fiche Personnel liée d’abord, nom du
 *  compte opérateur sinon (les deux sont conservés s’ils diffèrent). */
export const scopeMeNames = (access, currentUser) => {
  const out = [];
  const push = (v) => {
    const s = String(v || '').trim();
    if (s && out.indexOf(s) === -1) out.push(s);
  };
  const person = access && access.profile && access.profile.person ? access.profile.person : null;
  if (person) push(person.nom || person.name);
  if (currentUser) push(currentUser.name);
  return out;
};

/** Id de la fiche Personnel du membre connecté (null s’il n’est pas relié). */
export const scopeMePersonId = (access) => {
  const person = access && access.profile && access.profile.person ? access.profile.person : null;
  return person && person.id ? person.id : null;
};

/** Id de la fiche Personnel dont le nom correspond (null si introuvable). */
export const scopePersonIdForName = (personnel, name) => {
  const key = scopeNameKey(name);
  if (!key) return null;
  const list = Array.isArray(personnel) ? personnel : [];
  const found = list.find((p) => {
    const nk = p && (scopeNameKey(p.nom) || scopeNameKey(p.name));
    return nk === key;
  });
  return found && found.id ? found.id : null;
};

/** Ids de fiche Personnel portés par une ligne (champs de liaison possibles). */
export const scopeRecordPersonIds = (rec) => {
  const out = [];
  const push = (v) => {
    if (v === null || v === undefined || String(v).trim() === '') return;
    const id = String(v).trim();
    if (out.indexOf(id) === -1) out.push(id);
  };
  const r = rec || {};
  push(r.demandeurPersonId);
  push(r.demandeurId);
  push(r.personId);
  push(r.createdBy && r.createdBy.personId);
  return out;
};

/** Noms portés par une ligne (demandeur, porteur, créateur…). */
export const scopeRecordNames = (rec) => {
  const out = [];
  const push = (v) => {
    const s = String(v || '').trim();
    if (s && out.indexOf(s) === -1) out.push(s);
  };
  const r = rec || {};
  ['demandeur', 'porteur', 'nom', 'name'].forEach((k) => push(r[k]));
  push(r.createdBy && r.createdBy.name);
  return out;
};

/**
 * La ligne peut-elle être vue par le membre connecté ?
 *  · superutilisateur → toujours oui (approbation / transferts) ;
 *  · sinon → oui si la ligne porte son id de fiche Personnel, ou un de ses
 *    noms d’identité (correspondance de nom normalisée avec la colonne
 *    « demandeur » / l’audit `createdBy`), pour les anciens imports.
 */
export const scopeCanSeeItem = (rec, { isSuper, meNames = [], mePersonId = null } = {}) => {
  if (isSuper) return true;
  const ids = scopeRecordPersonIds(rec);
  if (mePersonId && ids.some((id) => id === String(mePersonId))) return true;
  const mine = meNames.map(scopeNameKey).filter(Boolean);
  if (!mine.length) return false;
  const theirs = scopeRecordNames(rec).map(scopeNameKey).filter(Boolean);
  return theirs.some((k) => mine.indexOf(k) !== -1);
};
