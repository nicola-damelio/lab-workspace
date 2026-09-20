/* =========================================================================
   src/utils/datasetCopyMirror.js
   LA COPIE DRIVE DU CONTENU D'UN DATASET : EN DIFFÉRÉ, MAIS SANS PERDRE LA
   DERNIÈRE MINUTE.

   App.jsx dépose le contenu d'un dataset dans
     Lab Workspace/_workspace/datasets/ds_<id>.json
   ~8 s après la dernière modification (une requête, pas cinquante) : c'est ce
   fichier qui rend un dataset lisible sur un poste neuf — et qui porte les
   calculs de solution (`calculationEntries`), les définitions, les
   bibliothèques… Deux trous en découlaient pourtant :

     • une modification suivie d'une fermeture d'onglet avant les 8 s
       n'atteignait JAMAIS le Drive : le calcul venait d'être enregistré, mais
       l'autre poste ne le voyait pas ;
     • l'écriture était « best-effort » et silencieuse : rien ne distinguait
       « rien à écrire » de « écriture perdue ».

   Cette fabrique isole la mécanique — regroupement, empreinte (« un contenu
   identique n'est jamais renvoyé ») et VIDAGE FORCÉ — pour qu'elle soit
   testable hors navigateur et appelée telle quelle depuis App.jsx :

       const mirror = createDatasetCopyMirror({ write: writeDatasetCopy });
       mirror.schedule(id, payload);   // à chaque sauvegarde (différé)
       mirror.flush();                 // fermeture d'onglet / arrière-plan

   `flush()` envoie IMMÉDIATEMENT ce qui est en attente (et annule la
   minuterie) ; il ne lève jamais : Firestore et l'instantané HTML restent la
   référence si le Drive ne répond pas.

   Vérifié hors navigateur par _dataset_copy_mirror_test.mjs.
   ========================================================================= */

/** Délai de calme avant l'écriture (documenté dans docs/DRIVE-MIRROR.md). */
export const DATASET_COPY_DELAY_MS = 8000;

const text = (v) => (v === undefined || v === null ? '' : String(v));

/**
 * @param {object} options
 * @param {(record:object)=>any} options.write  écriture réelle (writeDatasetCopy…)
 * @param {number} [options.delay]              délai de calme (ms)
 * @param {()=>number} [options.now]            horloge des `updatedAt` (injectable)
 * @param {Function} [options.setTimer]         minuterie (injectable pour les tests)
 * @param {Function} [options.clearTimer]
 */
export const createDatasetCopyMirror = ({
  write,
  delay = DATASET_COPY_DELAY_MS,
  now = () => Date.now(),
  setTimer,
  clearTimer
} = {}) => {
  const startTimer = typeof setTimer === 'function' ? setTimer : (fn, ms) => setTimeout(fn, ms);
  const cancelTimer = typeof clearTimer === 'function' ? clearTimer : (t) => clearTimeout(t);
  let timer = null;
  let lastFingerprint = '';
  let pending = null;
  let stopped = false;

  /** L'empreinte ne dépend QUE de ce qui partirait sur le Drive. */
  const fingerprintOf = (id, payload) => JSON.stringify({ ...payload, id });

  /** Envoie ce qui est en attente. `true` = une écriture a été lancée. */
  const send = () => {
    timer = null;
    const job = pending;
    pending = null;
    if (!job || typeof write !== 'function') return false;
    try {
      write({ ...job.payload, id: job.id, updatedAt: now() });
      lastFingerprint = job.fingerprint;
      return true;
    } catch {
      return false; // best-effort : Firestore et l'instantané HTML restent la référence
    }
  };

  /** Programme l'écriture du contenu courant (un contenu identique est ignoré). */
  const schedule = (id, payload) => {
    if (stopped) return false;
    const key = text(id);
    if (!key || !payload || typeof payload !== 'object') return false;
    const fingerprint = fingerprintOf(key, payload);
    if (fingerprint === lastFingerprint) return false; // rien de neuf : aucun envoi
    pending = { id: key, payload, fingerprint };
    if (timer) cancelTimer(timer);
    timer = startTimer(send, Math.max(0, Number(delay) || 0));
    return true;
  };

  /** Fermeture d'onglet / passage en arrière-plan : on n'attend PAS le délai. */
  const flush = () => {
    if (timer) { cancelTimer(timer); timer = null; }
    return send();
  };

  /** Abandonner (démontage) : plus rien ne partira tout seul. */
  const stop = () => {
    stopped = true;
    if (timer) { cancelTimer(timer); timer = null; }
    pending = null;
  };

  return {
    schedule,
    flush,
    stop,
    hasPending: () => !!pending,
    fingerprint: () => lastFingerprint
  };
};
