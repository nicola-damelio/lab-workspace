/* =========================================================================
   src/utils/viewerHydrogenFilter.js
   ☐ « HIDE EVERY HYDROGEN, IN EVERY MOLECULE » — the tick of the styling window.

   LA DEMANDE : « In the styling window add a tick allowing to hide all hydrogens
   in all molecules. » A tick, not a per-row style: a hydrogen is noise in a
   figure (it hides the heavy atoms the question is about) and hiding it must not
   mean editing every row of every molecule.

   COMMENT ON LE FAIT — UNE SEULE CLAUSE. Every representation the styling window
   builds carries a `sele` (a row's expression, its part, its kind); NGL draws
   exactly that set of atoms. Hiding every hydrogen is therefore a SECOND CLAUSE
   appended to it, never a rebuild: `(<sele>) and not hydrogen`.

   ⚠ `hydrogen` EST BIEN LE MOT-CLÉ DE NGL — MESURÉ, PAS SUPPOSÉ. Le mot-clé a été
   essayé sur le paquet installé (`ngl`), en soumettant à `Selection#test` un proxy
   d'atome d'hydrogène et un de carbone :
       « hydrogen »     → H true,  C false
       « not hydrogen » → H false, C true
       « _H »           → idem (l'ancien nom court de NGL)
       « not .H »       → H true,  C true   ← N'EST PAS un filtre d'hydrogène
       « elem H »       → H false, C false  ← n'existe pas
   `not .H` is the trap: it reads like « no hydrogen » and matches every atom that
   is not literally named « H » (HB2, H1', HG… all survive). C'est pourquoi la
   clause vit ici, avec la mesure qui la justifie, et pas dans le JSX.

   CE MODULE EST PUR (aucun NGL, aucun DOM) : il ne fabrique que des sélections, et
   la sonde _viewer_hide_hydrogens_test.mjs l'exécute sous node.
   ========================================================================= */

/** Le mot-clé d'hydrogène de NGL (mesuré — voir l'en-tête). */
export const HYDROGEN_SELECTION = 'hydrogen';

/** La clause qui retire TOUT hydrogène d'une représentation. */
export const HIDDEN_HYDROGEN_SELECTION = `not ${HYDROGEN_SELECTION}`;

/**
 * `sele` moins ses hydrogènes. Une sélection vide ou « all » devient la clause
 * seule (NGL : `all and not hydrogen` est valide, mais la forme courte est plus
 * lisible dans un titre de rangée) ; la sélection d'origine est GARDÉE entre
 * parenthèses, sans quoi un `or` d'une rangée de membrane changerait de sens
 * (`a or b and not hydrogen` ne se lit pas comme `(a or b) and not hydrogen`).
 * @param {string} sele l'expression de la rangée (peut être vide)
 * @returns {string} l'expression à donner à NGL
 */
export const withoutHydrogensSele = (sele) => {
  const text = (typeof sele === 'string' ? sele : '').trim();
  if (!text || text === 'all') return HIDDEN_HYDROGEN_SELECTION;
  return `(${text}) and ${HIDDEN_HYDROGEN_SELECTION}`;
};

/**
 * Les paramètres d'une représentation, hydrogènes retirés — un NOUVEL objet : les
 * paramètres d'une rangée sont partagés entre les allers-retours du constructeur,
 * et une mutation les ferait disparaître des autres rangées.
 * @param {object} params les paramètres donnés à `addRepresentation`
 * @param {boolean} hide le tick de la fenêtre de styling
 */
export const withoutHydrogensParams = (params, hide) => {
  if (!hide) return params || {};
  const out = { ...(params || {}) };
  out.sele = withoutHydrogensSele(out.sele);
  return out;
};
