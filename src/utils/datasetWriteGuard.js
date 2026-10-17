/* =========================================================================
   datasetWriteGuard.js — LE DOCUMENT PARTAGÉ S'ÉCRIT SOUS VERROU DE VERSION.

   Le défaut réparé (scénario c du rapport, reproduit dans
   `_firestore_vanishing_test.mjs`) : deux postes enregistrent la MÊME base à
   quelques secondes d'intervalle. Chacun relit la copie partagée AVANT de
   compresser, la fusionne avec la sienne… puis écrit. Entre la relecture et
   l'écriture il y a le temps de la compression (~1 s pour 1 Mo) : le second
   poste écrit la liste qu'il avait relue, et l'expérience créée par le premier
   entre-temps disparaît. Les verrous existants (`protectUnrecordedDrops`,
   `protectDistantDrops`) ne peuvent rien y faire : ils ont lu une copie qui ne
   la portait pas encore.

   La règle ici, à CHAQUE écriture, en trois temps :
     ① RELIRE la copie partagée AU MOMENT d'écrire (pas une seconde avant) et
        REMETTRE ce qu'elle porte et que nous n'avons pas — même règle qu'avant :
        une suppression enregistrée reste une suppression ;
     ② ÉCRIRE dans une TRANSACTION qui refuse la nôtre si le document a changé
        depuis la relecture (champ `rev`) : deux postes ne peuvent plus écrire
        « en même temps » sans que l'un des deux le sache ;
     ③ en cas de refus, RECOMMENCER depuis ① avec la copie fraîche (3 essais) :
        l'expérience de l'autre poste est alors dans la liste qu'on écrit.

   Ce module est PUR de réseau : `read`, `commit` et `rebuild` sont fournis par
   l'appelant (App.jsx les branche sur le SDK Firestore). C'est ce qui permet de
   rejouer la course de deux postes sans navigateur
   (voir `_dataset_write_guard_test.mjs`).
   ========================================================================= */
import { protectDistantDrops, experimentKey } from './experimentTombstones.js';

/** Le champ de version du document partagé (absent des documents d'avant : 0). */
export const DATASET_REV_FIELD = 'rev';

/** Le code d'un refus de transaction dû à une écriture concurrente. */
export const DATASET_WRITE_CONFLICT = 'dataset-write-conflict';

/** Cinq essais : le temps qu'un autre poste finisse sa propre écriture. Chaque
 *  essai relit la copie fraîche, et l'attente est dispersée (voir plus bas) pour
 *  que deux postes en conflit ne se rentrent pas dedans une seconde fois. */
export const DATASET_WRITE_ATTEMPTS = 5;

/** Le refus opposé à l'appelant quand la version du document a changé. */
export class DatasetWriteConflict extends Error {
  constructor(expectedRev, actualRev) {
    super(`dataset document changed while writing (expected rev ${expectedRev}, found ${actualRev})`);
    this.name = 'DatasetWriteConflict';
    this.code = DATASET_WRITE_CONFLICT;
    this.expectedRev = expectedRev;
    this.actualRev = actualRev;
    this.isDatasetWriteConflict = true;
  }
}

/** Ce refus vient-il d'une écriture concurrente (et non d'une vraie panne) ?
 *  On reconnaît le nôtre par sa propriété, son code ou son nom — selon ce que
 *  le SDK laisse passer d'une erreur levée DANS la transaction. */
export const isDatasetWriteConflict = (err) => Boolean(err && (
  err.isDatasetWriteConflict === true
  || err.code === DATASET_WRITE_CONFLICT
  || err.name === 'DatasetWriteConflict'
));

/** Le refus vient-il d'une LECTURE interdite (règles Firestore) et non d'une
 *  panne ou d'une écriture concurrente ? C'est le seul cas où l'on accepte de
 *  renoncer au contrôle de version : on n'a jamais pu lire, donc on ne perd
 *  aucun verrou — sans ce repli, la sauvegarde échouait tout court.
 *  Reconnaît le code du SDK (`permission-denied`), son équivalent gRPC (7) et
 *  le message, car les erreurs levées DANS une transaction arrivent parfois
 *  dépouillées de leur code. */
const READ_DENIED_CODES = new Set(['permission-denied', 'unauthenticated', 7, 16]);
export const isReadDenied = (err) => {
  if (!err) return false;
  const code = err.code !== undefined ? err.code : (err.body && err.body.code);
  if (code !== undefined && code !== null && READ_DENIED_CODES.has(code)) return true;
  if (code !== undefined && code !== null && READ_DENIED_CODES.has(Number(code))) return true;
  return /insufficient permissions|permission[- ]denied|no permission/i.test(String(err.message || ''));
};

/** La version d'un document (`rev`), 0 quand elle n'existe pas encore — c'est le
 *  cas de tous les documents écrits avant ce verrou : la première écriture
 *  versionnée leur donne `rev: 1`. */
export const datasetRevOf = (data) => {
  const raw = data ? data[DATASET_REV_FIELD] : 0;
  const rev = Number(raw);
  return Number.isFinite(rev) && rev > 0 ? Math.floor(rev) : 0;
};

/** Ce que la copie partagée doit rendre à la liste qu'on s'apprête à écrire.
 *  PUR : c'est `protectDistantDrops` — la même règle qu'avant l'écriture — mais
 *  appliquée à la copie relue AU MOMENT d'écrire. Rend `{ tests, rescued }`. */
export const planDatasetWrite = ({ distant = null, tests = [], deletions = [] } = {}) => {
  const outgoing = (Array.isArray(tests) ? tests : []).filter(Boolean);
  if (!Array.isArray(distant) || !distant.length) return { tests: outgoing, rescued: [] };
  const out = protectDistantDrops(distant, outgoing, deletions);
  return { tests: out.tests, rescued: out.rescued };
};

/** L'union des expériences rattrapées, sans jumeau (un même id ne se rapporte
 *  qu'une fois — un rapport qui compte deux fois ferait douter du reste). */
const mergeRescued = (all, more) => {
  const seen = new Set(all.map(experimentKey).filter(Boolean));
  const out = all.slice();
  (Array.isArray(more) ? more : []).forEach((test) => {
    const key = experimentKey(test);
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    out.push(test);
  });
  return out;
};

const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Écrire le document partagé : relire, refusionner, écrire sous version, et
 * recommencer si un autre poste a écrit entre-temps.
 *
 * @param {function(): Promise<{rev:number, tests:Array|null}>} read
 *        relit le document MAINTENANT (`tests: null` = illisible ou absent :
 *        on écrit alors comme avant, la lecture impossible ne bloque rien).
 * @param {function({payload:object, expectedRev:number|null}): Promise<void>} commit
 *        écrit `payload` et LÈVE `DatasetWriteConflict` si `expectedRev` n'est
 *        plus la version du document (`null` = pas de version connue).
 * @param {function({payload:object}): Promise<void>} [commitFallback]
 *        repli utilisé UNIQUEMENT quand on n'a pas pu lire (et que `commit`
 *        échoue pour la même raison, parce que sa transaction relit aussi) :
 *        on écrit alors sans contrôle de version, comme avant ce verrou, et le
 *        résultat porte `unchecked: true`. Sans ce repli, ce cas-là transforme
 *        une sauvegarde qui marchait en erreur visible.
 * @param {object} payload        la charge prête pour `tests` (déjà compressée)
 * @param {Array} tests           la liste que CE poste veut écrire
 * @param {Array} deletions       les suppressions enregistrées (tombes)
 * @param {function(Array): Promise<object>|object} rebuild
 *        reconstruit `payload` pour une liste refondue (obligatoire dès qu'une
 *        expérience est rattrapée : sinon la liste écrite ne serait plus celle
 *        que la charge porte).
 * @returns {Promise<{payload:object, tests:Array, rescued:Array, attempts:number, rev:number|null, unchecked?:boolean}>}
 */
export const guardedDatasetWrite = async ({
  read,
  commit,
  commitFallback = null,
  payload,
  tests = [],
  deletions = [],
  rebuild = null,
  maxAttempts = DATASET_WRITE_ATTEMPTS,
  retryDelay = 300,
  sleep = defaultSleep
}) => {
  if (typeof read !== 'function' || typeof commit !== 'function') {
    throw new TypeError('guardedDatasetWrite needs read() and commit()');
  }
  const attempts = Math.max(1, Number(maxAttempts) || DATASET_WRITE_ATTEMPTS);
  let body = payload;
  let wanted = (Array.isArray(tests) ? tests : []).filter(Boolean);
  let rescued = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let snapshot = null;
    try {
      snapshot = await read();
    } catch (err) {
      /* Une lecture impossible (hors ligne, règles Firestore) ne bloque JAMAIS
         une sauvegarde : on écrit sans version connue, comme avant ce verrou. */
      console.warn('[dataset] shared copy unreadable while writing — writing without a version check:', err && err.message);
      snapshot = null;
    }

    const expectedRev = snapshot ? datasetRevOf({ rev: snapshot.rev }) : null;
    const plan = planDatasetWrite({ distant: snapshot && snapshot.tests, tests: wanted, deletions });
    if (plan.rescued.length) {
      if (typeof rebuild !== 'function') {
        throw new Error('guardedDatasetWrite: rebuild() is required to keep the experiments rescued from the shared copy');
      }
      wanted = plan.tests;
      rescued = mergeRescued(rescued, plan.rescued);
      body = await rebuild(wanted);
    }

    try {
      await commit({ payload: body, expectedRev });
      return {
        payload: body,
        tests: wanted,
        rescued,
        attempts: attempt,
        rev: expectedRev === null ? null : expectedRev + 1
      };
    } catch (err) {
      /* ⓐ a échoué (aucune version connue) ET la transaction est refusée pour la
         même raison : sa propre relecture est interdite. Ce n'est pas un conflit,
         c'est une lecture impossible — et sans repli la sauvegarde échouait
         alors qu'elle partait très bien avant ce verrou. On écrit donc SANS
         contrôle de version, et on le DIT (`unchecked`) pour que l'appelant
         puisse le montrer : la protection n'est pas silencieusement absente. */
      if (typeof commitFallback === 'function' && expectedRev === null && isReadDenied(err)) {
        await commitFallback({ payload: body });
        console.warn('[dataset] shared copy unreadable and transaction refused — saved WITHOUT a version check');
        return {
          payload: body,
          tests: wanted,
          rescued,
          attempts: attempt,
          rev: null,
          unchecked: true
        };
      }
      /* ③ Le document a changé entre la relecture et l'écriture : on recommence
         avec la copie fraîche — c'est ainsi que l'expérience de l'autre poste
         entre dans la liste au lieu de disparaître. L'attente est DISPERSÉE :
         deux postes en conflit qui réessaieraient au même instant se
         rentreraient dedans une seconde fois. */
      if (!isDatasetWriteConflict(err) || attempt === attempts) throw err;
      console.warn(`[dataset] write conflict (attempt ${attempt}/${attempts}) — re-reading the shared copy`);
      const base = Math.max(0, Number(retryDelay) || 0);
      await sleep(base * attempt + Math.floor(Math.random() * (base + 1)));
    }
  }
  /* Inatteignable : la boucle rend ou lève. */
  throw new Error('guardedDatasetWrite: no attempt was made');
};
