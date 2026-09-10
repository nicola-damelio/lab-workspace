/* =========================================================================
   src/utils/datasetAccess.js
   Accès par dataset : chaque dataset n’est visible QUE par les utilisateurs
   définis dedans (liste de membres gérée par le superutilisateur).

   Modèle — champ top-level du document dataset (Firestore ou localStorage) :
     access: { restricted: boolean, memberNames: string[] }

   Règles :
   • `restricted: true`  → seuls les membres listés + le superutilisateur
                           peuvent voir / ouvrir le dataset.
   • `restricted: false` ou document sans champ `access` (datasets créés
     avant cette fonction) → reste ouvert à tous les comptes, par
     compatibilité ; le superutilisateur peut restreindre depuis la carte.
   • Bootstrap (aucun compte scientifique OU aucun superutilisateur encore
     défini) → tout le monde peut ouvrir, pour permettre la création de la
     première équipe.
   • Les NOUVEAUX datasets sont créés en `restricted: false` (visibles par
     TOUS les comptes de l’équipe) ; le superutilisateur peut ensuite les
     restreindre depuis « 👥 Membres » (le créateur y est pré-rempli).
   L’identité d’un « utilisateur défini dans le dataset » est le nom du
   compte opérateur (celui utilisé pour se connecter à l’app).
   ========================================================================= */

const norm = (s) => String(s || '').trim().toLowerCase();

/** Normalise une liste de noms de membres (dédupliquée, insensible à la
 *  casse, conservation de la première casse rencontrée). */
export const normalizeMemberNames = (names) => {
  if (!Array.isArray(names)) return [];
  const seen = new Set();
  const out = [];
  names.forEach((n) => {
    const name = String(n || '').trim();
    const key = norm(name);
    if (name && !seen.has(key)) {
      seen.add(key);
      out.push(name);
    }
  });
  return out;
};

/** Lecture normalisée du champ `access` d’un document dataset. */
export const datasetAccessOf = (dset) => {
  const a = dset && dset.access && typeof dset.access === 'object' ? dset.access : {};
  return {
    restricted: !!a.restricted,
    memberNames: normalizeMemberNames(a.memberNames),
  };
};

export const isDatasetRestricted = (dset) => datasetAccessOf(dset).restricted;

/** Compte superutilisateur : toujours autorisé sur tous les datasets. */
export const isSuperuserAccess = (currentUser) =>
  !!currentUser && currentUser.role === 'superuser';

/**
 * Décide si `currentUser` peut voir / ouvrir `dset`.
 * @param {object} dset document dataset (champ top-level `access`)
 * @param {object|null} currentUser compte connecté ({ name, role })
 * @param {{bootstrap?: boolean}} [opts] bootstrap d’équipe : aucun compte ou
 *   aucun superutilisateur défini (toute la gestion d’équipe est ouverte)
 */
export const canUserOpenDataset = (dset, currentUser, { bootstrap = false } = {}) => {
  // Bootstrap : l’équipe n’est pas encore configurée — tout le monde peut
  // ouvrir (indispensable pour créer le premier superutilisateur).
  if (bootstrap) return true;
  if (!currentUser) return false; // comptes configurés : connexion requise
  if (isSuperuserAccess(currentUser)) return true;
  const access = datasetAccessOf(dset);
  if (!access.restricted) return true; // dataset non restreint (héritage)
  const me = norm(currentUser.name);
  return access.memberNames.some((n) => norm(n) === me);
};
