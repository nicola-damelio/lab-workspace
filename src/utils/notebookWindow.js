/* ============================================================================
   src/utils/notebookWindow.js — LE CAHIER SE DÉPLIE PAR TRANCHES.

   LE RAPPORT : « anche l'apertura della pagina "lab notebook" è molto lenta ».

   LA CAUSE, DANS LE CODE : `LabNotebook` montait **tout d'un coup** —
   `filteredTests.map((test) => <NotebookTestItem … />)` — c'est-à-dire, pour
   chaque expérience du dataset, sa fiche complète : conditions, formule 2D,
   tableau NMR, rapport HTML, images, graphes d'analyse (recharts / chart.js)…
   Vingt expériences font vingt rapports à peindre avant la première image
   visible, et le nombre de nœuds DOM double avec la taille du cahier.

   LA RÈGLE (pure, donc vérifiée sous node — `_notebook_window_test.mjs`) : on
   monte une TRANCHE, et le bas de page en demande une autre. Rien n'est perdu :
   le défilement continue de tout montrer, un bouton permet de tout déplier d'un
   geste, et l'IMPRESSION déplie l'ensemble AVANT que le navigateur ne
   photographie la page (voir `lab:before-print` dans `App.jsx` et
   `LabNotebook`) — sinon le PDF ne porterait que les fiches du moment.

   Ces fonctions ne connaissent ni React ni le DOM : elles prennent des nombres
   et rendent des nombres, ce qui permet de les mesurer en une ligne.
   ========================================================================= */

/** Ce que montre un cahier qui vient de s'ouvrir. */
export const NOTEBOOK_WINDOW_FIRST = 4;
/** Ce que le bas de page ajoute à chaque fois. */
export const NOTEBOOK_WINDOW_STEP = 4;

const wholeCount = (total) => {
  const n = Math.floor(Number(total));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Combien d'expériences sont MONTÉES : la tranche demandée, bornée par la liste.
 * `showAll` (impression, bouton « tout déplier ») rend toute la liste. PUR.
 */
export const notebookVisibleCount = (total, rendered, { showAll = false, first = NOTEBOOK_WINDOW_FIRST } = {}) => {
  const n = wholeCount(total);
  if (showAll) return n;
  const asked = Math.floor(Number(rendered));
  const start = Number.isFinite(asked) ? asked : Math.floor(Number(first) || 0);
  return Math.max(0, Math.min(n, start));
};

/**
 * La tranche suivante quand le bas de la page entre à l'écran. Le pas ne peut
 * jamais être nul (sinon le défilement ne montrerait jamais rien de plus). PUR.
 */
export const notebookGrownCount = (total, rendered, { showAll = false, step = NOTEBOOK_WINDOW_STEP, first = NOTEBOOK_WINDOW_FIRST } = {}) => {
  const n = wholeCount(total);
  if (showAll) return n;
  const current = notebookVisibleCount(n, rendered, { first });
  const by = Math.max(1, Math.floor(Number(step) || 0));
  return Math.min(n, current + by);
};

/** Les expériences montrées, dans l'ordre — la règle qui précède, appliquée. PUR. */
export const notebookWindowSlice = (list, rendered, options = {}) => {
  const all = Array.isArray(list) ? list : [];
  return all.slice(0, notebookVisibleCount(all.length, rendered, options));
};

/** Ce qui reste à monter (pour le DIRE, jamais pour le cacher). PUR. */
export const notebookHiddenCount = (total, shown) => Math.max(0, wholeCount(total) - Math.max(0, Math.floor(Number(shown)) || 0));

/** La phrase de la tranche : « 4 of 31 experiments shown ». PUR. */
export const notebookWindowLabel = (shown, total) => {
  const n = wholeCount(total);
  const s = Math.max(0, Math.min(n, Math.floor(Number(shown)) || 0));
  if (n === 0) return '0 experiment';
  return `${s} of ${n} experiment(s) shown`;
};

export default { notebookVisibleCount, notebookGrownCount, notebookWindowSlice };
