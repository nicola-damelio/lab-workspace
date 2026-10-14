/* ============================================================================
   src/utils/backgroundWork.js — « SAUVEGARDE, OUI — MAIS PAS DEVANT MOI ».

   LE RAPPORT, mot pour mot : « quando clicco su un test non si apre subito
   perché aspetta il salvataggio globale che potrebbe essere fatto in background.
   anche l'apertura della pagina "lab notebook" è molto lenta ».

   CE QUI A ÉTÉ MESURÉ (fil principal, même machine, 2026-10-14 — voir
   `_save_in_background_test.mjs`) : la compression d'un dataset avant envoi
   (`JSON.stringify` + `LZString.compressToUTF16`) coûte 0,9 s pour 6 Mo et
   davantage au-delà ; les comparaisons de `setTests` coûtaient 41–125 ms. Ces
   tâches arrivent SANS PRÉVENIR, souvent à l'instant où l'utilisateur clique :
   le navigateur ne peut pas peindre la page demandée avant qu'elles finissent.
   Ce n'est pas un `await` dans la navigation — c'est le fil principal occupé.

   CE MODULE DONNE LES DEUX GESTES QUI MANQUAIENT :

     · `yieldToPaint()` — rendre la main jusqu'à la PROCHAINE PEINTURE. Le clic
       est déjà commité par React ; ce geste laisse la page s'afficher AVANT que
       le travail lourd ne commence. Repli par minuterie : dans un onglet caché,
       `requestAnimationFrame` ne vient jamais.

     · `runInBackground(work)` — lancer ce que PERSONNE n'attend au moment où le
       navigateur n'a rien d'autre à faire (`requestIdleCallback`), avec une
       échéance (`timeout`) pour qu'un poste très occupé ne remette jamais la
       sauvegarde indéfiniment. Sans `requestIdleCallback`, une minuterie à 0 ms.

   RÈGLE DE SÛRETÉ : ces gestes ne servent QU'AU travail différé. Ce qui part à la
   fermeture de l'onglet ou en quittant un dataset (`flushPendingSave`,
   `saveLeavingDataset`) reste IMMÉDIAT : là, attendre une peinture serait perdre
   la dernière minute du travail. Les deux fonctions acceptent donc un `scope`
   (l'objet `window`) pour que la règle soit vérifiable sous node.
   ========================================================================= */

/** Échéance d'un travail d'arrière-plan (ms) : il part même si le poste est occupé. */
export const BACKGROUND_IDLE_TIMEOUT_MS = 2000;
/** Délai de repli de `yieldToPaint` quand aucune peinture ne vient (onglet caché). */
export const PAINT_FALLBACK_MS = 120;

const scopeOf = (scope) => scope || (typeof window !== 'undefined' ? window : null);
/* `setTimeout` est EXTRAIT de son objet pour être gardé : dans un navigateur, un
   `window.setTimeout` appelé sans son `this` lève « Illegal invocation ». On le
   lie donc à sa fenêtre — la sonde `_save_in_background_test.mjs` a trouvé ce
   défaut avant le navigateur. */
const timerOf = (scope) => {
  const win = scopeOf(scope);
  return win && typeof win.setTimeout === 'function' ? win.setTimeout.bind(win) : setTimeout;
};

/** Vrai quand l'environnement sait exécuter du travail « quand il n'a rien à faire ». */
export const canRunInIdleTime = (scope = null) => {
  const win = scopeOf(scope);
  return !!(win && typeof win.requestIdleCallback === 'function');
};

/**
 * Rend la main APRÈS la prochaine peinture. `requestAnimationFrame` arrive avant
 * la peinture de sa propre image : on y ajoute donc une minuterie à 0 ms, et un
 * repli par minuterie au cas où aucune image ne viendrait (onglet caché, fenêtre
 * réduite). PUR vis-à-vis du navigateur (aucune variable globale lue sans `scope`).
 * @returns {Promise<void>}
 */
export const yieldToPaint = (scope = null, { fallbackMs = PAINT_FALLBACK_MS } = {}) => new Promise((resolve) => {
  const win = scopeOf(scope);
  const after = timerOf(win);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    resolve();
  };
  if (win && typeof win.requestAnimationFrame === 'function') {
    win.requestAnimationFrame(() => after(finish, 0));
  }
  after(finish, fallbackMs);
});

/**
 * Lance `work` quand le fil principal est libre (ou au plus tard après `timeout`).
 * Rend la fonction d'ANNULATION — un effet React peut ainsi ne rien laisser
 * derrière lui.
 * @returns {() => void}
 */
export const runInBackground = (work, { scope = null, timeout = BACKGROUND_IDLE_TIMEOUT_MS } = {}) => {
  const fn = typeof work === 'function' ? work : () => {};
  const win = scopeOf(scope);
  if (win && typeof win.requestIdleCallback === 'function') {
    const handle = win.requestIdleCallback(() => fn(), { timeout });
    return () => {
      try { win.cancelIdleCallback(handle); } catch { /* rien à annuler */ }
    };
  }
  const timer = timerOf(win)(fn, 0);
  return () => {
    try { clearTimeout(timer); } catch { /* rien à annuler */ }
  };
};

export default { yieldToPaint, runInBackground, canRunInIdleTime };
