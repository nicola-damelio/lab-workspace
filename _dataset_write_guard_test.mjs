/* =========================================================================
   _dataset_write_guard_test.mjs — LA CORSA FRA DUE POSTI NON PERDE PIÙ NULLA.

   Lo scenario (c) del banco (`_firestore_vanishing_test.mjs`), qui trasformato
   in una regola: due posti salvano la STESSA base a pochi secondi di distanza.
   Ognuno rilegge la copia condivisa PRIMA di comprimere, la fonde con la sua…
   e poi scrive. Fra la rilettura e la scrittura c'è il tempo della compressione
   (~1 s per 1 MB): il secondo scrive la lista che aveva riletto, e l'esperienza
   creata dal primo nel frattempo sparisce. I verrou esistenti non possono farci
   nulla: hanno letto una copia che non la portava ancora.

   Qui si verifica `src/utils/datasetWriteGuard.js` con un documento finto che
   applica DAVVERO il confronto di versione (`rev`): due client veri, nessun
   browser. Il controllo 0 mostra il difetto (scrittura senza verro), i
   controlli 1-6 mostrano che con il verro non si perde nulla.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const G = await import('./src/utils/datasetWriteGuard.js');
const APP = readFileSync('./src/App.jsx', 'utf8').replace(/\r\n/g, '\n');

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => {
  assert.ok(String(src).includes(needle), `${what}\n  frammento assente : ${needle}`);
  passed += 1;
};

const T = (id, extra = {}) => ({ id, name: `Test ${id}`, date: '2026-10-16', ...extra });
const ids = (list) => (Array.isArray(list) ? list : []).map((t) => String(t.id));
const sortIds = (list) => ids(list).sort();

/* ── Un documento condiviso con la versione (`rev`) e una latenza vera ──── */
const makeStore = ({ delay = 4 } = {}) => {
  const doc = { exists: false, rev: 0, tests: [], writes: 0 };
  const wait = () => new Promise((resolve) => { setTimeout(resolve, delay); });
  return {
    doc,
    /* La rilettura del client (ⓐ di guardedDatasetWrite). */
    async get() {
      await wait();
      return { rev: doc.rev, tests: doc.tests.map((t) => ({ ...t })) };
    },
    /* La scrittura transazionale: rilegge e RIFIUTA se la versione non è quella
       attesa — è ciò che fa `db.runTransaction` in App.jsx. */
    async commit({ payload, expectedRev }) {
      await wait();                       // la finestra in cui l'altro posto scrive
      if (expectedRev !== null && doc.rev !== expectedRev) {
        throw new G.DatasetWriteConflict(expectedRev, doc.rev);
      }
      doc.rev += 1;
      doc.exists = true;
      doc.tests = payload.tests.map((t) => ({ ...t }));
      doc.writes += 1;
    }
  };
};

/* Il client: legge, fonde, riscrive — esattamente il percorso di App.jsx. */
const save = (store, mine, opts = {}) => G.guardedDatasetWrite({
  read: () => store.get(),
  commit: (args) => store.commit(args),
  payload: { tests: mine },
  tests: mine,
  rebuild: (tests) => ({ tests }),
  retryDelay: 1,
  ...opts
});

/* ── 0. LA PROVA DEL DIFETTO: senza verro, uno dei due sparisce ─────────── */
/* La scrittura di prima: rilegge, comprime (l'attesa), scrive SENZA guardare
   la versione. È il `set(payload, { merge: true })` di prima del verro. */
const legacySave = async (store, mine) => {
  await store.get();                                  // riletto prima di comprimere
  await new Promise((resolve) => { setTimeout(resolve, 6); }); // la compressione
  store.doc.rev += 1;
  store.doc.exists = true;
  store.doc.tests = mine.slice();
  store.doc.writes += 1;
};

const legacy = makeStore();
await Promise.all([
  legacySave(legacy, [T('84')]),
  legacySave(legacy, [T('85')])
]);
eq(legacy.doc.tests.length, 1,
  '0. senza verro di versione, due salvataggi simultanei ne perdono uno (il difetto osservato)');

/* ── 1. Due posti insieme: le DUE esperienze restano ───────────────────── */
const race = makeStore();
const [a, b] = await Promise.all([
  save(race, [T('84')]),
  save(race, [T('85')])
]);
eq(sortIds(race.doc.tests), ['84', '85'], '1. due posti in corsa: NESSUNA delle due esperienze si perde');
eq(race.doc.writes, 2, '1b. …e il documento è stato scritto due volte (una per posto)');
ok(a.attempts >= 1 && b.attempts >= 1, '1c. ciascuno ha scritto (con un nuovo tentativo se la versione era cambiata)');

/* ── 2. Sei posti insieme: sei esperienze, e nessuna doppia ────────────── */
const crowd = makeStore({ delay: 2 });
const many = await Promise.all(
  ['86', '89', '90', '91'].map((id) => save(crowd, [T(id)]))
);
eq(sortIds(crowd.doc.tests), ['86', '89', '90', '91'], '2. quattro posti in corsa: quattro esperienze, tutte presenti');
eq(crowd.doc.rev, 4, '2b. la versione è avanzata di uno per ogni scrittura (rien ne s’écrase)');
ok(many.some((r) => r.attempts > 1), '2c. au moins un poste a dû relire et rejouer (c’est le verrou qui a parlé)');

/* ── 3. La refusion est DITE, et l’expérience rattrapée est dans la liste ─ */
/* B relit AVANT que A n’écrive : sa liste ne porte pas l’expérience de A.
   Sans refusion au moment d’écrire, elle disparaîtrait — c’est exactement le
   scénario (c). Ici B doit la RATTRAPER et le DIRE (`rescued`). */
const late = makeStore({ delay: 3 });
const [first, second] = await Promise.all([
  save(late, [T('86')]),
  save(late, [T('89')])
]);
const catcher = first.rescued.length ? first : second;
eq(catcher.rescued.length, 1,
  '3. la expérience de l’autre poste est RATTRAPÉE et rapportée (jamais un sauvetage muet)');
eq(ids(catcher.rescued), [ids(catcher.tests).includes('86') ? '86' : '89'],
  '3b. …c’est bien celle que l’autre poste venait d’écrire');
eq(sortIds(late.doc.tests), ['86', '89'], '3c. les deux expériences sont dans le document partagé');
ok(ids(catcher.tests).includes('86') && ids(catcher.tests).includes('89'),
  '3d. la liste écrite par le poste qui a rattrapé porte bien les deux');

/* ── 4. Una 🗑 registrata resta una 🗑 ─────────────────────────────────── */
/* La copia partagée porte encore « 90 », ma soppressione è registrata: la
   refusion ne doit PAS la ressusciter. */
const tomb = makeStore();
tomb.doc.exists = true;
tomb.doc.rev = 1;
tomb.doc.tests = [T('90'), T('91')];
const buried = await save(tomb, [T('91')], { deletions: [{ id: '90', datasetId: 'ds1', deletedAt: 7 }] });
eq(sortIds(tomb.doc.tests), ['91'], '4. une suppression enregistrée n’est jamais annulée par la refusion');
eq(buried.rescued.length, 0, '4b. …et rien n’est rapporté comme « sauvé » à tort');

/* ── 5. Une lecture impossible ne bloque PAS la sauvegarde ─────────────── */
const blind = makeStore();
const blindSave = await G.guardedDatasetWrite({
  read: async () => { throw new Error('Missing or insufficient permissions'); },
  commit: (args) => blind.commit(args),
  payload: { tests: [T('84')] },
  tests: [T('84')],
  rebuild: (tests) => ({ tests }),
  retryDelay: 1
});
eq(sortIds(blind.doc.tests), ['84'], '5. copia condivisa illeggibile (403): la scrittura parte lo stesso, come prima');
eq(blindSave.rev, null, '5b. …sans version connue (le verrou local reste le filet)');

/* ── 6. Cinq conflits d’affilée : on s’arrête et on le DIT ─────────────── */
let reads = 0;
let conflicts = 0;
const stubborn = {
  doc: { rev: 9, tests: [] },
  async get() { reads += 1; return { rev: 9, tests: [] }; },
  async commit() { conflicts += 1; throw new G.DatasetWriteConflict(9, 10); }
};
await assert.rejects(
  () => save(stubborn, [T('84')], { retryDelay: 0 }),
  (err) => G.isDatasetWriteConflict(err),
  '6. une fois les essais épuisés, l’écriture échoue AVEC le refus (elle ne perd rien en silence)'
);
eq(reads, G.DATASET_WRITE_ATTEMPTS, '6b. une relecture par essai (pas une boucle infinie)');
eq(conflicts, G.DATASET_WRITE_ATTEMPTS, '6c. autant de tentatives d’écriture, pas plus');

/* ── 7. Le câblage : App.jsx écrit par ce chemin, aux DEUX portes ──────── */
has(APP, "import {\n  guardedDatasetWrite, datasetRevOf, DatasetWriteConflict, DATASET_REV_FIELD\n} from './utils/datasetWriteGuard';",
  '7. App.jsx importe le verrou de version');
has(APP, 'const writeSharedDatasetDocument = async ({ docRef, payload, tests, datasetId, rebuild }) => {',
  '7b. un seul point d’entrée pour l’écriture sous version');
has(APP, 'const written = await writeSharedDatasetDocument({',
  '7c. l’enregistrement automatique passe par lui');
ok((APP.match(/await writeSharedDatasetDocument\(\{/g) || []).length === 2,
  '7d. …et la sortie du dataset aussi (deux portes : enregistrement et sortie)');
has(APP, 'return db.runTransaction(async (tx) => {',
  '7e. l’écriture est bien une TRANSACTION (pas un set qui écrase)');
has(APP, 'if (expectedRev !== null && now !== expectedRev) throw new DatasetWriteConflict(expectedRev, now);',
  '7f. la transaction REFUSE une charge bâtie sur une version périmée');
has(APP, '[DATASET_REV_FIELD]: now + 1',
  '7g. chaque écriture avance la version du document');
has(APP, 'rebuild: async (mergedTests) => ({',
  '7h. la charge est RECONSTRUITE pour la liste refondue (sinon la liste et le payload divergeraient)');
has(APP, 'payload: await compressDatasetForSave({ ...rawData, tests: mergedTests }, urgent)',
  '7i. …avec le même budget de taille qu’un enregistrement normal');
has(APP, "if (!silent && written.rescued.length) {",
  '7j. un sauvetage au moment d’écrire est DIT à l’écran (et versé dans la mémoire du poste)');
has(APP, 'rememberExperiments(targetId, written.tests);',
  '7k. …et retenu, pour que l’enregistrement suivant ne le perde pas à son tour');
has(APP, 'setDialog((prev) => prev || {',
  '7l. le message est le même que celui du verrou d’avant écriture');
has(APP, "console.warn('[experiments] shared copy unreadable while writing",
  '7m. une lecture impossible est dite, et ne bloque pas la sauvegarde');
has(APP, 'commitFallback: ({ payload: body }) => docRef.set(body, { merge: true })',
  '7n. …et si la transaction ne peut pas lire non plus, un repli explicite écrit comme avant (au lieu d’une erreur)');
has(APP, 'if (written.unchecked) {',
  '7o. …et ce repli-là est DIT dans les journaux (la protection absente ne passe pas inaperçue)');

/* ── 8. Le repli : lecture ET transaction refusées (403) ────────────────── */
/* Cas réel : les règles refusent la relecture ; la transaction relit donc elle
   aussi et se fait refuser. Sans repli, la sauvegarde devenait une ERREUR alors
   qu’elle partait très bien avant ce verrou. */
const makeLockedStore = () => ({
  doc: { rev: 0, tests: [], writes: 0 },
  async get() { throw new Error('Missing or insufficient permissions'); },
  async commit() {
    const err = new Error('Missing or insufficient permissions');
    err.code = 'permission-denied';
    throw err;
  }
});

const locked = makeLockedStore();
let fallbackWrites = 0;
const uncheckedSave = await G.guardedDatasetWrite({
  read: () => locked.get(),
  commit: (args) => locked.commit(args),
  commitFallback: async ({ payload }) => {
    fallbackWrites += 1;
    locked.doc.writes += 1;
    locked.doc.tests = payload.tests.map((t) => ({ ...t }));
  },
  payload: { tests: [T('91')] },
  tests: [T('91')],
  rebuild: (tests) => ({ tests }),
  retryDelay: 1
});
eq(fallbackWrites, 1, '8. lecture ET transaction refusées : le repli écrit quand même (la sauvegarde ne devient pas une erreur)');
eq(sortIds(locked.doc.tests), ['91'], '8b. …et la liste de CE poste est bien écrite');
eq(uncheckedSave.unchecked, true, '8c. le résultat DIT que le contrôle de version n’a pas pu jouer (pas de silence)');
eq(uncheckedSave.rev, null, '8d. aucune version n’est avancée (on n’a rien lu)');

/* Sans repli fourni, le refus remonte : comportement d’avant, jamais silencieux. */
const bare = makeLockedStore();
await assert.rejects(
  () => G.guardedDatasetWrite({
    read: () => bare.get(),
    commit: (args) => bare.commit(args),
    payload: { tests: [T('91')] },
    tests: [T('91')],
    rebuild: (tests) => ({ tests }),
    retryDelay: 1
  }),
  (err) => G.isReadDenied(err),
  '8e. sans repli, le refus est RENDU à l’appelant (aucune perte silencieuse)'
);
eq(bare.doc.writes, 0, '8f. …et rien n’a été écrit');

/* Une vraie panne ne doit PAS être masquée par le repli. */
let masked = 0;
const brokenStore = {
  doc: { rev: 0, tests: [], writes: 0 },
  async get() { throw new Error('Missing or insufficient permissions'); },
  async commit() { const e = new Error('internal error'); e.code = 'internal'; throw e; }
};
await assert.rejects(
  () => G.guardedDatasetWrite({
    read: () => brokenStore.get(),
    commit: (args) => brokenStore.commit(args),
    commitFallback: async () => { masked += 1; },
    payload: { tests: [T('91')] },
    tests: [T('91')],
    rebuild: (tests) => ({ tests }),
    retryDelay: 1
  }),
  /internal error/,
  '8g. une panne qui n’est pas un refus de lecture n’est PAS masquée par le repli'
);
eq(masked, 0, '8h. …le repli n’est pas appelé du tout');

/* ── Bilan ───────────────────────────────────────────────────────────────── */
console.log(`✅ ${passed} vérifications passées (deux postes qui écrivent ensemble ne perdent plus d’expérience)`);
