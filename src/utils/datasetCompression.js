/* =========================================================================
   utils/datasetCompression.js — COMPRIMER SANS GELER LA PAGE.

   MESURÉ (fil principal, 2026-10-14 — voir `_save_in_background_test.mjs`) :

     | ce qui tournait | payload | coût |
     |---|---|---|
     | `JSON.stringify` + `LZString.compressToUTF16` (la sauvegarde) | 6,0 Mo | **884 ms** |
     | `LZString.compressToUTF16` seul | 6,0 Mo | **3 815 ms** |

   RE-MESURÉ POUR CE MODULE (`_probe_timing`, même machine, même jour) :

     | ce qui tourne | payload | coût |
     |---|---|---|
     | `JSON.stringify` seul (ce qui RESTE ici) | 6,2 Mo | **72 ms** |
     | `LZString.compressToUTF16` (ce qui PART dans le fil) | 6,2 Mo | **3 226 ms** |
     | les deux, à la suite (ce que faisait le fil principal) | 6,2 Mo | **3 449 ms** |

   Ces 0,9–3,4 s tournaient SUR LE FIL PRINCIPAL, à l'instant où l'utilisateur
   cliquait : la page demandée ne pouvait pas se peindre avant la fin du calcul.
   Rendre la main *avant* de compresser (voir `backgroundWork.js`) place le
   travail APRÈS la peinture — il ne le rend pas plus court.

   CE MODULE LE DÉPLACE VRAIMENT : le `JSON.stringify` reste ici (c'est le prix
   du texte, 72 ms) et `LZString.compressToUTF16` part dans un **web worker** —
   le fil principal n'attend plus qu'une promesse, et la page reste fluide
   pendant les 3,2 s de calcul. La sortie est **caractère pour caractère** celle
   d'avant (même LZString, même encodage UTF-16) : rien à relire différemment sur
   Firestore, dans les fichiers HTML ou sur le Drive.

   LES TROIS GARANTIES, dans l'ordre d'importance :

     1. **Une sauvegarde ne se perd jamais.** Aucune promesse ne rejette : si le
        fil est mort, indisponible (page servie depuis un fichier, politique de
        sécurité, vieux navigateur), s'il rend une réponse illisible ou s'il ne
        répond pas dans les temps, la compression est REFaite ici, en synchrone.
        Plus lent, jamais perdu.
     2. **Le fil est créé une fois, à la demande.** Aucun worker n'est
        instancié tant qu'aucune sauvegarde n'en a besoin, et un fil perdu
        n'est pas recréé en boucle (on a mesuré le repli, il est bon).
     3. **La fermeture d'onglet n'attend personne.** Les appelants qui n'ont
        plus d'écran à protéger (voir `urgent` dans `App.jsx`) gardent le geste
        synchrone : une promesse n'aurait plus le temps d'aboutir quand l'onglet
        disparaît.
   ========================================================================= */
import LZString from 'lz-string';

/* Le fil n'a pas répondu au bout de 20 s : il est mis de côté et la demande est
   reprise ici. Un worker sain répond en dizaines de millisecondes par mégaoctet
   (3,8 s pour 6 Mo, mesuré) — 20 s ne pardonne qu'un fil réellement bloqué. */
export const COMPRESSION_WORKER_DEADLINE_MS = 20000;

/** La compression de référence : celle d'avant ce module. C'est AUSSI le repli
    de tous les chemins d'erreur, et la sortie que la sonde compare. */
export const compressPayloadSync = (json) => LZString.compressToUTF16(json);

/** Un web worker n'a de sens que dans une page : sous node (les sondes), il n'y
    a pas de `Worker`, et une page ouverte depuis un fichier n'a pas le droit
    d'en créer un. Le repli synchrone s'en charge. */
export const canUseCompressionWorker = () =>
  typeof window !== 'undefined' && typeof Worker === 'function';

/** Le fil réel : Vite reconnaît ce `new URL(..., import.meta.url)` et embarque
    le module worker avec l'application. */
export const defaultCompressionWorkerFactory = () =>
  (canUseCompressionWorker()
    ? new Worker(new URL('./datasetCompression.worker.js', import.meta.url), { type: 'module' })
    : null);


/**
 * Un compresseur d'arrière-plan. Rend TOUJOURS une promesse résolue avec la
 * charge LZString (jamais un rejet : voir la garantie ① — le seul échec qui
 * remonte est celui de la compression synchrone elle-même, comme avant).
 * @param {{ workerFactory?: () => any, sync?: (json: string) => string, deadlineMs?: number }} options
 */
export const createDatasetCompressor = ({
  workerFactory = defaultCompressionWorkerFactory,
  sync = compressPayloadSync,
  deadlineMs = COMPRESSION_WORKER_DEADLINE_MS
} = {}) => {
  let worker = null;
  let workerLost = false;
  let lastId = 0;
  const waiting = new Map(); // id -> { id, json, resolve, reject, timer }

  /** La demande est faite ici, maintenant (repli, ou fin d'une demande dont le
      fil ne s'est pas occupé). */
  const compressHere = (entry) => {
    try {
      entry.resolve(sync(entry.json));
    } catch (error) {
      entry.reject(error);
    }
  };

  const forget = (entry) => {
    if (entry.timer) clearTimeout(entry.timer);
    waiting.delete(entry.id);
  };

  /** Le fil est perdu : on le lâche, et TOUT ce qui attendait est compressé ici.
      Rien n'est abandonné en chemin, et on ne recrée pas un fil qui vient de
      mourir (le repli est correct ; réessayer en boucle ne l'est pas). */
  const loseWorker = () => {
    workerLost = true;
    const dead = worker;
    worker = null;
    if (dead && typeof dead.terminate === 'function') {
      try { dead.terminate(); } catch { /* déjà mort */ }
    }
    const pending = [...waiting.values()];
    pending.forEach(forget);
    pending.forEach(compressHere);
  };

  const onCompressed = (event) => {
    const reply = (event && event.data) || {};
    const entry = waiting.get(reply.id);
    if (!entry) return; // réponse d'une demande déjà reprise ici : on l'ignore
    forget(entry);
    if (reply.ok === true && typeof reply.payload === 'string') entry.resolve(reply.payload);
    else compressHere(entry); // le fil a dit non : on finit ici, la sauvegarde passe
  };

  const ensureWorker = () => {
    if (worker || workerLost) return worker;
    let fresh = null;
    try {
      fresh = workerFactory();
    } catch {
      fresh = null; // pas le droit de créer un worker : repli synchrone
    }
    if (!fresh || typeof fresh.postMessage !== 'function') {
      workerLost = true;
      return null;
    }
    worker = fresh;
    if (typeof worker.addEventListener === 'function') {
      worker.addEventListener('message', onCompressed);
      worker.addEventListener('error', loseWorker);
      worker.addEventListener('messageerror', loseWorker);
    }
    return worker;
  };

  const compress = (json) => {
    const text = typeof json === 'string' ? json : JSON.stringify(json);
    const live = ensureWorker();
    if (!live) return Promise.resolve().then(() => sync(text));

    const id = ++lastId;
    return new Promise((resolve, reject) => {
      const entry = { id, json: text, resolve, reject, timer: null };
      waiting.set(id, entry);
      if (deadlineMs > 0) {
        entry.timer = setTimeout(() => {
          /* Le fil n'a JAMAIS répondu (bloqué, disparu sans `error`) : la
             demande est reprise ici, et le fil mis de côté. */
          if (waiting.get(id) === entry) loseWorker();
        }, deadlineMs);
      }
      try {
        live.postMessage({ id, json: text });
      } catch {
        if (waiting.get(id) === entry) loseWorker();
      }
    });
  };

  return {
    compress,
    /** Lâche le fil (tests, démontage) : ce qui attendait finit ici. */
    dispose: loseWorker,
    /** Vrai quand le calcul part réellement dans un fil. */
    get usesWorker() { return !!worker; },
    /** Vrai quand le module a renoncé au fil pour de bon (il compresse ici). */
    get usesMainThread() { return !worker; }
  };
};

/* LE compresseur de l'application : un seul fil, partagé par la sauvegarde
   automatique, la base d'administration et la sortie d'un dataset. */
export const datasetCompressor = createDatasetCompressor();

/** Compresse une charge JSON SANS occuper le fil principal. À utiliser partout
    où l'utilisateur n'attend pas devant l'écran (voir `urgent` dans App.jsx). */
export const compressPayloadInBackground = (json) => datasetCompressor.compress(json);
