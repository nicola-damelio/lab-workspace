/* =========================================================================
   src/utils/workspaceRefresh.js
   « LA PAGE S'OUVRE » — relire l'index du Drive, pas seulement au démarrage.

   Le défaut réparé : l'index partagé (`Lab Workspace/_workspace/state.json`,
   relu par `App.jsx.syncWorkspaceFromDrive`) n'était lu qu'AU DÉMARRAGE — et
   sur le geste explicite « Resync from Drive ». Un poste resté ouvert pendant
   qu'un autre créait (ou supprimait, ou restaurait) un dataset ou un projet
   continuait donc d'afficher sa liste d'alors : les pages qui montrent les
   listes partagées étaient périmées jusqu'à un rechargement de l'onglet, alors
   que la vérité était déjà sur le Drive.

   Ce module porte UNIQUEMENT la DÉCISION (« faut-il relire maintenant ? ») :
   elle est PURE, donc vérifiable hors navigateur (_workspace_open_refresh_test.mjs)
   — c'est ce qui permet de dire la règle sans monter React. App.jsx garde le
   geste : relire (`syncWorkspaceFromDrive`) et remonter les pages si la liste a
   changé (le nonce).

   LES TROIS RÈGLES, et pourquoi :
     1° seulement les pages qui MONTRENT CE QUE L'INDEX PORTE (la liste des
        projets, la page d'un projet, la liste des datasets des Réglages) : une
        page qui ne montre rien de partagé n'a aucune raison de faire relire le
        Drive ;
     2° AU PLUS UNE RELECTURE PAR MINUTE (throttle) : naviguer entre deux pages
        ne doit pas multiplier les lectures du Drive — c'est la navigation qui
        est fréquente, pas la vérité qui change ;
     3° jamais pendant qu'une relecture est EN COURS, ni sans Drive connecté —
        deux relectures simultanées écriraient la même chose en double, et une
        relecture sans Drive ne peut rien apprendre.

   Ce module NE LIT NI N'ÉCRIT RIEN : il ne décide que de l'OPPORTUNITÉ.
   ========================================================================= */

/** Le délai minimal entre deux relectures déclenchées par l'ouverture d'une
 *  page : une minute. Plus court n'apprendrait rien (la vérité partagée change
 *  au rythme des gestes humains), plus long laisserait une page périmée. */
export const OPEN_REFRESH_MS = 60 * 1000;

/* Un module vide, `null` ou un nombre se lisent comme du texte : la décision ne
   doit jamais lever (même expression que workspaceResync.js / datasetListIndex.js). */
const text = (v) => (v === undefined || v === null ? '' : String(v).trim());

/** LES PAGES QUI MONTRENT CE QUE L'INDEX PORTE. Chacune est nommée pour une
 *  raison précise — ce n'est pas « toutes les pages » :
 *    • `projects`       : la liste des projets vient du magasin du navigateur ;
 *    • `project-detail` : la page d'un projet relit ce même magasin ;
 *    • `settings`       : la liste des datasets (Réglages → Workspace) et le
 *                         panneau « Resync from Drive » y vivent.
 *  Une page absente de cette liste ne déclenche jamais de relecture. */
export const OPEN_REFRESH_MODULES = ['projects', 'project-detail', 'settings'];

/** Le module est-il l'une des pages qui montrent les listes partagées ? PUR. */
export const openRefreshCovers = (module) => OPEN_REFRESH_MODULES.includes(text(module));

/** FAUT-IL RELIRE MAINTENANT ? PUR — aucune lecture, aucun effet de bord.
 *
 *  `module`    : le module affiché (`App.jsx.currentModule`) ;
 *  `lastAt`    : l'horodatage de la dernière relecture DÉJÀ faite (0 = jamais) ;
 *  `now`       : l'heure courante (injectable : les tests n'attendent pas) ;
 *  `driveReady`: le Drive est-il joignable dans ce navigateur ;
 *  `busy`      : une relecture est-elle en cours.
 *
 *  Une horloge qui a RECULÉ (`now` avant `lastAt`) est traitée comme un
 *  horodatage incohérent, donc comme une raison de relire : la relecture est en
 *  LECTURE SEULE, relire « pour rien » est sans conséquence, tandis que ne pas
 *  relire laisserait l'écran faux. */
export const shouldRefreshWorkspaceOnOpen = ({
  module: mod = '', lastAt = 0, now = Date.now(), driveReady = true, busy = false
} = {}) => {
  if (!driveReady || busy) return false;
  if (!openRefreshCovers(mod)) return false;
  const last = Number(lastAt) || 0;
  if (!last) return true;
  const elapsed = (Number(now) || 0) - last;
  return !(elapsed >= 0 && elapsed < OPEN_REFRESH_MS);
};

/** Combien de temps reste-t-il à attendre avant que la prochaine ouverture
 *  puisse relire ? 0 = tout de suite. PUR — sert à DIRE la règle (et à la
 *  vérifier) plutôt qu'à la subir. */
export const openRefreshWaitMs = ({ lastAt = 0, now = Date.now() } = {}) => {
  const last = Number(lastAt) || 0;
  if (!last) return 0;
  const elapsed = (Number(now) || 0) - last;
  if (elapsed < 0) return 0;
  return Math.max(0, OPEN_REFRESH_MS - elapsed);
};
