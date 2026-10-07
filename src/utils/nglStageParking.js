/* =========================================================================
   src/utils/nglStageParking.js
   ⏸ MISE EN VEILLE D'UN ÉTAGE NGL QUAND PERSONNE NE LE REGARDE.

   LA MESURE DE CETTE SESSION — le rapport : « the gradient does not work and
   the program is slow even if it does not have processes to do ».

   Un viewer MONTÉ ne demande RIEN au repos : mesuré sur le vrai composant
   (`_viewer_bg_live_test.cjs`, Chrome headless, 2,5 s de repos) — 0
   `requestRender`, 0 mutation du DOM, 0 tâche longue, et React ne re-rend pas
   une seule fois. Et pourtant la page ne dort jamais : **deux boucles
   `requestAnimationFrame` d'NGL 2.4 se relancent d'elles-mêmes
   indéfiniment** —
     · `Viewer.animate` : `this.frameRequest = window.requestAnimationFrame(this.animate)`
       est la DERNIÈRE ligne de la fonction (_ngl_src/viewer__viewer.ts:1015) :
       rien ne l'arrête jamais ;
     · `MouseControls._listen` : la même chose pour le survol (le délai de
       survol, le double-clic), relancée par la même ligne.
   Soit **~120 images demandées par seconde et par étage**, pour toujours — y
   compris quand la page n'est plus à l'écran. Or l'application garde en vie
   CHAQUE page quittée (« page parking » d'App.jsx, en `display: none`) : un
   étage déjà monté continue donc de tourner pour personne, et deux ou trois
   viewer ouverts (page NMR + page MD + docking) font trois de ces boucles.
   C'est le « slow even if it does not have processes to do » : le travail n'est
   pas dans nos règles, il est dans la boucle du moteur.

   NGL ne sait pas se mettre en veille — mais il sait DÉJÀ s'arrêter : ses deux
   `dispose()` font exactement `window.cancelAnimationFrame(this.frameRequest)`
   (dist 2.4 : `dispose(){this.renderer.dispose(),window.cancelAnimationFrame(this.frameRequest)}`
   et, pour le survol, `…removeEventListener("touchmove",…),window.cancelAnimationFrame(this.frameRequest)`).
   `parkNglStage` reprend donc CE geste — le seul que le moteur reconnaisse — et
   `wakeNglStage` reprend les deux entrées que NGL emploie lui-même pour
   (re)démarrer : `viewer.animate()` (la boucle de rendu) et
   `viewer.requestRender()` (l'image tout de suite), plus `_listen()` pour le
   survol. Le réveil rend donc la vue EXACTEMENT telle qu'elle était.

   LA DÉCISION EST PURE (`nglStageParkingDecision`), donc testée sous node ; les
   deux gestes ne touchent au moteur que par ce qu'NGL expose, toujours sous
   garde (`typeof`), et ne jettent jamais : une vue qui ne se met pas en veille
   est un défaut de confort, jamais une vue cassée.
   ========================================================================= */

/** Les raisons de parquer, dans l'ordre où elles se lisent (la première vraie gagne). */
export const STAGE_PARKING_REASONS = ['onglet caché', 'vue repliée', 'hors écran'];

/** LA RÈGLE, pure : faut-il parquer l'étage ?
 *  `tabHidden` — l'onglet n'est plus au premier plan (`document.hidden`) ;
 *  `collapsed` — la vue est repliée par l'utilisateur (0 px de haut : rien à
 *                peindre, et NGL garderait pourtant sa boucle) ;
 *  `onScreen`  — la boîte est visible dans la page. ⚠ C'est ce témoin qui
 *                attrape le « page parking » : une page quittée est en
 *                `display: none`, donc plus rien de sa boîte n'est à l'écran —
 *                l'`IntersectionObserver` du viewer le dit. */
export const nglStageParkingDecision = ({ tabHidden = false, collapsed = false, onScreen = true } = {}) => {
  if (tabHidden) return { park: true, why: 'onglet caché' };
  if (collapsed) return { park: true, why: 'vue repliée' };
  if (!onScreen) return { park: true, why: 'hors écran' };
  return { park: false, why: '' };
};

/** LES BOUCLES D'UN ÉTAGE, avec l'image en attente de chacune :
 *  `frameRequest` est LE nom qu'NGL donne à ce qu'il annule dans ses
 *  `dispose()` — c'est donc la prise par laquelle on l'arrête.
 *  ⚠⚠ LA BOUCLE DU SURVOL N'EST PAS SUR `mouseControls` : mesuré dans le
 *  navigateur, la pile de la seconde boucle est `_listen` — le relevé de survol
 *  et de double-clic d'NGL — qui vit sur **`stage.mouseObserver`** ;
 *  `mouseControls`, lui, porte les ACTIONS de souris (`run('clickPick', …)`).
 *  Les deux sont regardés : celui qui a une image en attente est celui qui
 *  tourne. */
export const stageLoopsOf = (stage) => {
  const viewer = stage && stage.viewer;
  const observer = (stage && (stage.mouseObserver || stage.mouseControls)) || null;
  const actions = stage && stage.mouseControls;
  const loops = [
    { loop: 'rendu', owner: viewer, id: viewer && viewer.frameRequest, restart: 'animate' },
    { loop: 'survol', owner: observer, id: observer && observer.frameRequest, restart: 'listen' },
  ];
  if (actions && actions !== observer) {
    loops.push({ loop: 'souris', owner: actions, id: actions.frameRequest, restart: 'listen' });
  }
  return loops;
};

/** QUELLE BOUCLE TOURNE ENCORE — pour les tests et les relevés (jamais une
 *  exception : un étage sans `frameRequest` est simplement « pas de boucle »). */
export const stageLoopState = (stage) => {
  const out = {};
  stageLoopsOf(stage).forEach((l) => { out[l.loop] = !!(l.owner && l.id != null); });
  return out;
};

/** ⏸ ARRÊTER LES BOUCLES. Rend la liste de celles qui tournaient vraiment
 *  (donc de ce qui a été arrêté) — vide si l'étage est déjà en veille, si
 *  l'hôte n'a pas `cancelAnimationFrame`, ou si l'étage n'existe pas.
 *  ⚠ ON REMET `frameRequest` À `null` : c'est ce qui dit « en veille », et ce
 *  qui empêche `wakeNglStage` de démarrer une SECONDE boucle au réveil.
 *  L'hôte de `cancelAnimationFrame` est `window` dans un navigateur, `globalThis`
 *  partout ailleurs (c'est ce qui rend le geste mesurable sous node, sur des
 *  étages factices — voir _viewer_stage_parking_test.mjs). */
export const parkNglStage = (stage) => {
  const stopped = [];
  if (!stage) return stopped;
  const host = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null);
  if (!host || typeof host.cancelAnimationFrame !== 'function') return stopped;
  stageLoopsOf(stage).forEach((l) => {
    if (!l.owner || l.id == null) return;
    try {
      host.cancelAnimationFrame(l.id);
      l.owner.frameRequest = null;
      stopped.push(l.loop);
    } catch { /* un moteur qui refuse : on n'a rien arrêté, et on le dit */ }
  });
  return stopped;
};

/** ▶ RÉVEILLER L'ÉTAGE — les deux entrées qu'NGL emploie lui-même : `animate()`
 *  relance la boucle de rendu (SEULEMENT si elle ne tourne plus), `_listen()`
 *  celle du survol, et `requestRender()` fait peindre l'image TOUT DE SUITE,
 *  pour que la vue ne montre pas l'image d'avant le sommeil. Rend ce qui a été
 *  relancé. */
export const wakeNglStage = (stage) => {
  const woken = [];
  if (!stage) return woken;
  const viewer = stage.viewer;
  if (viewer && typeof viewer.animate === 'function' && viewer.frameRequest == null) {
    try { viewer.animate(); woken.push('rendu'); } catch { /* l'image ci-dessous suffira */ }
  }
  if (viewer && typeof viewer.requestRender === 'function') {
    try { viewer.requestRender(); woken.push('image'); } catch { /* la vue garde son image */ }
  }
  const controls = stage.mouseObserver || stage.mouseControls;
  if (controls && typeof controls._listen === 'function' && controls.frameRequest == null) {
    try { controls._listen(); woken.push('survol'); } catch { /* le survol reviendra au premier geste */ }
  }
  return woken;
};
