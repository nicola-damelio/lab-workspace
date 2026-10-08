/* =========================================================================
   src/utils/driveListPages.js — ÉNUMÉRER UN DOSSIER DU DRIVE EN ENTIER.

   Le défaut réparé : la liste des enfants d'un dossier se lisait en UNE page
   (1000 entrées) et s'arrêtait là. Un dossier `projects/` un peu fourni, ou un
   dossier de dataset qui a accumulé des milliers de Figures, dépassait la
   première page : tout ce qui suivait n'existait PAS pour le programme. C'est
   ainsi qu'un projet parfaitement présent sur le Drive « disparaissait » de la
   liste affichée — et qu'un dossier paraissait « vide ».

   Ici vit la partie PURE : la boucle qui suit `nextPageToken` jusqu'au bout,
   avec une borne de sécurité (`maxPages`) et l'AVEU de la troncature. Le seul
   geste réseau est `fetchPage`, fourni par l'appelant — driveUpload.js le
   branche sur le vrai Drive (`listDriveChildren` / `listDriveChildrenDetailed`).

   RÈGLE : une lecture partielle ne passe JAMAIS pour une liste complète. Une
   page qui échoue rend ce qui a déjà été lu avec `truncated: true` et le compte
   des erreurs, jamais un silence.

   Vérifié hors navigateur par _workspace_resync_test.mjs.
   ========================================================================= */

/** Combien de pages une énumération suit avant de s'arrêter : cet espace de
 *  travail n'atteint pas 20 000 enfants dans un dossier, et une boucle doit
 *  avoir une borne (une page = 1000 entrées côté Drive). */
export const MAX_DRIVE_LIST_PAGES = 20;

/** Énumère TOUTES les pages d'un dossier.
 *
 *  `fetchPage(pageToken)` rend une page BRUTE du Drive (`{ files, nextPageToken }`)
 *  ou une promesse de celle-ci ; `pageToken` est vide pour la première page.
 *
 *  Rend `{ files, pages, truncated, token, pageTokens, errors }` :
 *    • `files`       — tout ce qui a été lu, dans l'ordre des pages ;
 *    • `pages`       — le nombre de pages RÉELLEMENT lues ;
 *    • `truncated`   — vrai si l'énumération s'est arrêtée AVANT la fin (borne
 *                      atteinte ou page en échec) : l'appelant peut le DIRE ;
 *    • `token`       — le `nextPageToken` restant, s'il y en a un ;
 *    • `pageTokens`  — les jetons demandés (les tests et le journal s'y accrochent) ;
 *    • `errors`      — le nombre de pages qui ont échoué.
 *
 *  PUR : rien d'autre que `fetchPage` ne touche au réseau, et cette fonction ne
 *  lève jamais. */
export const collectDrivePages = async (fetchPage, { maxPages = MAX_DRIVE_LIST_PAGES } = {}) => {
  const cap = Math.max(1, Number(maxPages) || MAX_DRIVE_LIST_PAGES);
  const files = [];
  const pageTokens = [];
  let pages = 0;
  let errors = 0;
  let token = '';
  let stopped = false;
  if (typeof fetchPage !== 'function') return { files, pages, truncated: false, token, pageTokens, errors };
  for (let i = 0; i < cap; i += 1) {
    pageTokens.push(token);
    let page = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      page = await fetchPage(token);
    } catch { errors += 1; stopped = true; break; }
    pages += 1;
    const got = page && Array.isArray(page.files) ? page.files : [];
    got.forEach((f) => files.push(f));
    token = String((page && (page.nextPageToken || page.next)) || '');
    if (!token) break;
  }
  return { files, pages, truncated: !!token || stopped, token, pageTokens, errors };
};
