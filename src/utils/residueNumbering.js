/* =========================================================================
   src/utils/residueNumbering.js
   LE NUMÉRO AFFICHÉ D'UN RÉSIDU — une seule règle pour toute l'application.

   Le viewer 3D RENUMÉROTE une structure (bouton 🔢 : une saisie par résidu, ou
   « Renumber from N » qui numérote tout d'un coup) et range le résultat sur la
   condition : `resRenumber` = { numéro d'origine → nouveau numéro }.

   Le numéro d'ORIGINE d'un résidu est celui que la STRUCTURE porte (celui des
   étiquettes 3D et de la bande de résidus du viewer), c'est-à-dire sa position
   1-based dans la séquence PLUS le décalage `residueOffset` de la condition :
   c'est la table de correspondance entre la séquence tapée et la structure
   chargée.

   Tout panneau qui ÉCRIT un numéro de résidu doit passer par ici — sinon la
   renumérotation n'atteint qu'une partie de l'écran. La table des déplacements,
   la bande de séquence de la sous-section « Sequence and structure », les
   étiquettes Cys et les ponts disulfure, les étiquettes 3D : le MÊME numéro
   partout.

   Le module est PUR (aucun import, aucun React) : les trois pages (NMR, MD,
   Docking), NMRData.jsx et les tests l'utilisent tel quel.

   Règles :
     • pas de `resRenumber`, ou pas d'entrée pour ce résidu → le numéro
       d'origine (position + décalage) ;
     • une entrée vide ('') ou illisible (NaN) → le numéro d'origine aussi :
       effacer la case d'un résidu dans le panneau 🔢 restaure son numéro ;
     • 0 est un numéro VALIDE (une renumérotation peut commencer à 0).
   ========================================================================= */

/** Le décalage de structure d'une condition — jamais NaN, jamais une chaîne. */
export const residueOffsetOf = (test) => {
  const off = Number(test && test.residueOffset);
  return Number.isFinite(off) ? off : 0;
};

/** Le numéro d'ORIGINE d'un résidu donné par son index 0-based de séquence. */
export const originalResidueNumber = (idx, residueOffset = 0) => {
  const off = Number(residueOffset);
  return idx + 1 + (Number.isFinite(off) ? off : 0);
};

/** La table de renumérotation d'une condition — `null` quand elle n'en a pas
 *  (table absente, nulle ou d'un autre type). */
export const renumberMapOf = (test) => {
  const map = test && test.resRenumber;
  return map && typeof map === 'object' ? map : null;
};

/** LE numéro à écrire pour le résidu d'index 0-based `idx`. C'est la règle :
 *  le numéro d'origine, remplacé par celui que le viewer lui a donné. */
export const residueNumberOf = (test, idx) => {
  const orig = originalResidueNumber(idx, residueOffsetOf(test));
  const map = renumberMapOf(test);
  if (!map) return orig;
  const raw = map[String(orig)];
  if (raw == null || raw === '') return orig;
  const n = Number(raw);
  return Number.isFinite(n) ? n : orig;
};

/** Le MÊME résolveur, prêt pour les composants : lu une fois par rendu puis
 *  appliqué à un index (`residueNo={(i) => noOf(i)}`) ou à une liste. */
export const residueNumberResolver = (test) => {
  const offset = residueOffsetOf(test);
  const map = renumberMapOf(test);
  return (idx) => {
    const orig = originalResidueNumber(idx, offset);
    if (!map) return orig;
    const raw = map[String(orig)];
    if (raw == null || raw === '') return orig;
    const n = Number(raw);
    return Number.isFinite(n) ? n : orig;
  };
};
