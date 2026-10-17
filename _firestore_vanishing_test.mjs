/* _firestore_vanishing_test.mjs — LA PERTE, REJOUÉE DANS UN BANC D'ESSAI.
 *
 * Ce que ce test fait : il prend les DEUX GARDE-FOUS RÉELS
 * (`protectUnrecordedDrops`, `protectDistantDrops` — src/utils/experimentTombstones.js)
 * et les branche dans une RÉPLIQUE LITTÉRALE du chemin d'enregistrement de
 * l'application, sur le faux document de `_harness/fake-firestore.mjs`.
 *
 * Ce qui est RÉEL : les deux garde-fous, la forme du document (un seul champ
 * `payload` compressé, `set(..., {merge:true})`), la limite de 1 Mio.
 * Ce qui est RÉPLIQUÉ (et déclaré comme tel, avec les lignes de App.jsx) :
 *   · `rememberExperiments`      — App.jsx 2010-2019 (union par identité) ;
 *   · `guardExperimentsForWrite` — App.jsx ~2083-2105 (garde locale) ;
 *   · `guardDistantExperiments`  — App.jsx ~2157-2176 (relecture distante ;
 *                                  `null` si la lecture échoue → aucun secours) ;
 *   · l'enregistrement           — App.jsx 4100-4128 (`set` avec `merge`).
 *
 * Le test AFFIRME « rien ne se perd ». Deux parties, deux rôles :
 *   · la RÉPLIQUE (en haut) montre le défaut d'origine : elle reste ROUGE sur
 *     la partie « sans protection », et c'est voulu — c'est la preuve que le
 *     banc mord. En particulier la partie « relecture RÉFUSÉE (403) » ne peut
 *     pas être verte : sans lire, personne ne peut refusionner, aucun code
 *     client n'y arrivera jamais ;
 *   · le CODE EXPÉDIÉ (en bas, `makeGuardedClient` →
 *     src/utils/datasetWriteGuard.js, branché TEL QUEL) doit être VERT.
 *
 * Sortie : 0 = tout est protégé ; 1 = perte reproduite par la réplique
 *          (attendu, rouge de référence) ; 3 = LE CODE EXPÉDIÉ PERD ENCORE
 *          (alarme : ne pas distribuer).
 */
import LZString from 'lz-string';
import { FakeFirestoreDoc } from './_harness/fake-firestore.mjs';
import { protectUnrecordedDrops, protectDistantDrops } from './src/utils/experimentTombstones.js';
import { guardedDatasetWrite } from './src/utils/datasetWriteGuard.js';

const SEEDS = [1, 2, 3, 4, 5, 6];
const LATENCY = [20, 120];
const OWNER = 'nicola';

const mkTests = (n, from = 1, owner = OWNER) => Array.from({ length: n }, (_, i) => ({
  id: `t${from + i}`, name: `Test ${from + i}`, date: '2026-09-20', owner,
}));

const compress = (tests) => LZString.compressToUTF16(JSON.stringify({ tests }));
const decompress = (payload) => {
  if (typeof payload !== 'string' || !payload) return [];
  try {
    const parsed = JSON.parse(LZString.decompressFromUTF16(payload));
    return Array.isArray(parsed && parsed.tests) ? parsed.tests : [];
  } catch { return []; }
};
const ids = (list) => new Set((Array.isArray(list) ? list : []).map((t) => t.id).filter(Boolean));
const missing = (expected, got) => [...expected].filter((id) => !got.has(id));

/** UN POSTE — réplique du chemin d'enregistrement (voir en-tête). */
const makeClient = ({ doc, name, screen, deletions = [], guards = true, cas = false }) => {
  const memory = new Map();          // knownExperimentsRef, dataset par dataset
  const st = { screen: screen.slice() };

  // App.jsx 2010-2019 : union, rien ne s'efface
  const remember = (list) => {
    (Array.isArray(list) ? list : []).forEach((t) => { const k = t && t.id; if (k) memory.set(k, t); });
  };
  remember(st.screen);               // App.jsx ~2180 : l'écran sème la mémoire

  const publish = async () => {
    remember(st.screen);
    let tests = st.screen.slice();
    if (guards) {
      // App.jsx 2083-2105 : ce que CE poste connaît ne peut pas disparaître
      tests = protectUnrecordedDrops([...memory.values()], tests, deletions).tests;
    }
    const attempts = cas ? 4 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      // App.jsx 2157-2176 : relecture du document partagé, AVANT d'écrire.
      // Une lecture qui échoue (403) rend `null` → AUCUN secours, en silence.
      let distant = null;
      let version = null;
      try {
        const snap = await doc.read();
        distant = decompress(snap.payload);
        version = snap.version;
      } catch { distant = null; }
      let out = tests;
      if (guards && Array.isArray(distant) && distant.length) {
        out = protectDistantDrops(distant, out, deletions).tests;
      }
      try {
        await doc.set({
          title: 'Dataset', testCount: out.length, payload: compress(out), isCompressed: true, updatedAt: Date.now(),
        }, { merge: true, ...(cas && version !== null ? { expectedVersion: version } : {}) }, name);
        return out;
      } catch (e) {
        // Fetta 2 : le document a bougé depuis notre lecture → on refusionne et on
        // réessaie, jamais on n'écrase en silence.
        if (!cas || e.code !== 'aborted') throw e;
        tests = out;
      }
    }
    throw new Error(`${name}: rimedio CAS, troppi tentativi`);
  };

  return {
    name,
    publish,
    add: (t) => { st.screen.push(t); },
    openFrom: (list) => { st.screen = list.slice(); remember(st.screen); },
    screen: () => st.screen.slice(),
  };
};

/* ---------------------------------------------------------------------------
 * LE CODE EXPÉDIÉ — src/utils/datasetWriteGuard.js, branché tel quel.
 * Rien n'est répliqué ici : si ce bloc perd une expérience, c'est le programme
 * qui la perd. (La réplique ci-dessus ne sert qu'à montrer le défaut d'origine.)
 * ------------------------------------------------------------------------ */

/** Un poste qui enregistre AVEC le verrou de version du programme. */
const makeGuardedClient = ({ doc, name, screen, deletions = [], retryDelay = 15 }) => {
  const memory = new Map();
  const st = { screen: screen.slice() };
  const remember = (list) => {
    (Array.isArray(list) ? list : []).forEach((t) => { const k = t && t.id; if (k) memory.set(k, t); });
  };
  remember(st.screen);

  const build = (list) => ({
    title: 'Dataset', testCount: list.length, payload: compress(list), isCompressed: true, updatedAt: Date.now(),
  });

  const publish = async () => {
    remember(st.screen);
    /* Le verrou LOCAL reste : ce que ce poste connaît ne peut pas disparaître
       (App.jsx, `guardExperimentsForWrite`). */
    const tests = protectUnrecordedDrops([...memory.values()], st.screen.slice(), deletions).tests;
    const written = await guardedDatasetWrite({
      payload: build(tests),
      tests,
      deletions,
      rebuild: (merged) => build(merged),
      retryDelay,
      read: async () => {
        const snap = await doc.read();
        return { rev: snap.version, tests: decompress(snap.payload) };
      },
      commit: async ({ payload, expectedRev }) => {
        try {
          await doc.set(payload, { merge: true, expectedVersion: expectedRev }, name);
        } catch (e) {
          /* Le faux document refuse exactement comme Firestore : `aborted`
             quand la version a changé. On le dit au module dans SON langage. */
          if (e && e.code === 'aborted') {
            const conflict = new Error(`version conflict (expected ${expectedRev})`);
            conflict.code = 'dataset-write-conflict';
            conflict.isDatasetWriteConflict = true;
            throw conflict;
          }
          throw e;
        }
      }
    });
    st.screen = written.tests.slice();
    return written.tests;
  };

  return {
    name,
    publish,
    add: (t) => { st.screen.push(t); },
    openFrom: (list) => { st.screen = list.slice(); remember(st.screen); },
    screen: () => st.screen.slice(),
  };
};

const seedDoc = (tests, seed = 7) => new FakeFirestoreDoc({
  seed, latencyMs: LATENCY,
  initial: { title: 'Dataset', testCount: tests.length, payload: compress(tests), isCompressed: true, updatedAt: 1 },
});

/* ---------------------------------------------------------------------------
 * LES QUATRE SCÉNARIOS
 * ------------------------------------------------------------------------ */

/** (a) Un poste qui garde un élenco vecchio enregistre par-dessus un plus récent. */
const scenarioA = async ({ denyReads, guards = true, cas = false, seed = 1, make = makeClient }) => {
  const base = mkTests(88);
  const doc = seedDoc(base, seed);
  doc.denyReads = denyReads;
  const A = make({ doc, name: 'A (vecchio)', screen: base, guards, cas });
  const B = make({ doc, name: 'B (nuovo)', screen: base, guards, cas });
  B.add({ id: 't89', name: 'Test 89', date: '2026-10-16', owner: OWNER });
  const afterB = await B.publish();
  const afterA = await A.publish();
  const final = ids(doc.readTests(decompress));
  return { expected: ids(afterB), final, lost: missing(ids(afterB), final) };
};

/** (b) La mémoire semée par l'écran : un scientifique non-superutilisateur ne
 *  voit que SES expériences ; l'écran sème la mémoire avec ce sous-ensemble. */
const scenarioB = async ({ denyReads, guards = true, cas = false, seed = 1, make = makeClient }) => {
  const all = mkTests(88);
  all.slice(20).forEach((t) => { t.owner = 'autre'; });
  const doc = seedDoc(all, seed);
  doc.denyReads = denyReads;
  const mine = all.filter((t) => t.owner === OWNER);         // 20 vues
  const A = make({ doc, name: 'A (non-super)', screen: mine, guards, cas });
  A.add({ id: 't89', name: 'Test 89', date: '2026-10-16', owner: OWNER });
  const after = await A.publish();
  const final = ids(doc.readTests(decompress));
  const expected = new Set([...ids(all), 't89']);
  return { expected, final, lost: missing(expected, final) };
};

/** (c) Deux postes qui enregistrent EN MÊME TEMPS (même seconde). */
const scenarioC = async ({ denyReads, guards = true, cas = false, seed = 1, make = makeClient }) => {
  const base = mkTests(88);
  const doc = seedDoc(base, seed);
  doc.denyReads = denyReads;
  const A = make({ doc, name: 'A', screen: base, guards, cas });
  const B = make({ doc, name: 'B', screen: base, guards, cas });
  A.add({ id: 't89', name: 'Test 89', date: '2026-10-16', owner: OWNER });
  B.add({ id: 't90', name: 'Test 90', date: '2026-10-16', owner: OWNER });
  const both = await Promise.all([A.publish(), B.publish()]);
  const final = ids(doc.readTests(decompress));
  const expected = new Set([...ids(base), 't89', 't90']);
  return { expected, final, lost: missing(expected, final) };
};

/** (d) Un poste neuf ouvre une copie Drive EN RETARD (3 h), le partagé a bougé. */
const scenarioD = async ({ denyReads, guards = true, cas = false, seed = 1, make = makeClient }) => {
  const copy = mkTests(88);                                   // la copie Drive, 15:28
  const shared = copy.slice();
  ['t89', 't90', 't91'].forEach((id, i) => shared.push({ id, name: `Test ${89 + i}`, date: '2026-10-16', owner: OWNER }));
  const doc = seedDoc(shared, seed);                          // le partagé, 3 h plus tard
  doc.denyReads = denyReads;
  const C = make({ doc, name: 'C (nuovo, copia vecchia)', screen: copy, guards, cas });
  C.add({ id: 't92', name: 'Test 92', date: '2026-10-16', owner: OWNER });
  const after = await C.publish();
  const final = ids(doc.readTests(decompress));
  const expected = new Set([...ids(shared), 't92']);
  return { expected, final, lost: missing(expected, final) };
};

/* ---------------------------------------------------------------------------
 * EXÉCUTION ET VERDICT
 * ------------------------------------------------------------------------ */

const rows = [];
const record = (label, ok, detail) => { rows.push({ label, ok, detail }); };

const run = async (label, fn, opts) => {
  const lostTotal = new Set();
  const lostSeeds = [];
  let expectedCount = 0;
  const seeds = opts.multiSeed ? SEEDS : [1];
  for (const seed of seeds) {
    const r = await fn({ ...opts, seed });
    expectedCount = r.expected.size;
    r.lost.forEach((id) => lostTotal.add(id));
    if (r.lost.length) lostSeeds.push(seed);
  }
  const ok = lostTotal.size === 0;
  const detail = ok
    ? `${expectedCount} esperienze, niente perso`
    : `${lostTotal.size} perse (${[...lostTotal].slice(0, 4).join(', ')}${lostTotal.size > 4 ? '...' : ''}) in ${lostSeeds.length}/${seeds.length} prove`;
  record(label, ok, detail);
  return ok;
};

const flush = (prefix) => {
  const out = rows.splice(0);
  out.forEach((r) => console.log(`   ${r.ok ? 'OK   ' : 'PERSO'} ${prefix}${r.label} -> ${r.detail}`));
  return out;
};

const main = async () => {
  console.log('Banco di prova - la perdita di esperienze, quattro scenari');
  console.log(`protezioni REALI (experimentTombstones) - documento finto 1 MiB - latenza ${LATENCY[0]}-${LATENCY[1]} ms\n`);

  // Controllo: senza protezioni la perdita deve apparire (prova che il banco morde).
  const control = [];
  control.push(await run('(a) elenco vecchio sopra uno nuovo', scenarioA, { guards: false, denyReads: false }));
  control.push(await run('(b) memoria seminata dallo schermo', scenarioB, { guards: false, denyReads: false }));
  control.push(await run('(c) due poste che salvano insieme', scenarioC, { guards: false, denyReads: false, multiSeed: true }));
  control.push(await run('(d) poste nuovo da una copia in ritardo', scenarioD, { guards: false, denyReads: false }));
  console.log('- CONTROLLO, senza protezioni (se non perde, il banco non prova nulla):');
  flush('');

  console.log('\n- la rilettura del documento condiviso RISPONDE:');
  const withRead = [];
  withRead.push(await run('(a) elenco vecchio sopra uno nuovo', scenarioA, { denyReads: false }));
  withRead.push(await run('(b) memoria seminata dallo schermo', scenarioB, { denyReads: false }));
  withRead.push(await run('(c) due poste che salvano insieme', scenarioC, { denyReads: false, multiSeed: true }));
  withRead.push(await run('(d) poste nuovo da una copia in ritardo', scenarioD, { denyReads: false }));
  flush('');

  console.log('\n- la rilettura e RIFIUTATA (403, la condizione vera di oggi):');
  const noRead = [];
  noRead.push(await run('(a) elenco vecchio sopra uno nuovo', scenarioA, { denyReads: true }));
  noRead.push(await run('(b) memoria seminata dallo schermo', scenarioB, { denyReads: true }));
  noRead.push(await run('(c) due poste che salvano insieme', scenarioC, { denyReads: true, multiSeed: true }));
  noRead.push(await run('(d) poste nuovo da una copia in ritardo', scenarioD, { denyReads: true }));
  flush('');

  console.log('\n- RIMEDIO PREVISTO (fetta 2), provato solo nel banco: controllo di versione prima di scrivere, rilettura permessa:');
  const remedy = [];
  remedy.push(await run('(a) elenco vecchio sopra uno nuovo', scenarioA, { denyReads: false, cas: true }));
  remedy.push(await run('(b) memoria seminata dallo schermo', scenarioB, { denyReads: false, cas: true }));
  remedy.push(await run('(c) due poste che salvano insieme', scenarioC, { denyReads: false, cas: true, multiSeed: true }));
  remedy.push(await run('(d) poste nuovo da una copia in ritardo', scenarioD, { denyReads: false, cas: true }));
  flush('');

  /* ── LE CODE EXPÉDIÉ ────────────────────────────────────────────────────────
     Ici on ne réplique RIEN : `makeGuardedClient` appelle
     src/utils/datasetWriteGuard.js tel quel. Ce bloc doit être VERT, et il est
     le seul de ce fichier dont un rouge interdit la mise en ligne. */
  console.log('\n- CODE EXPÉDIÉ (src/utils/datasetWriteGuard.js), relecture permise — DOIT être vert :');
  const real = [];
  real.push(await run('(a) elenco vecchio sopra uno nuovo', scenarioA, { denyReads: false, make: makeGuardedClient }));
  real.push(await run('(b) memoria seminata dallo schermo', scenarioB, { denyReads: false, make: makeGuardedClient }));
  real.push(await run('(c) due poste che salvano insieme', scenarioC, { denyReads: false, make: makeGuardedClient, multiSeed: true }));
  real.push(await run('(d) poste nuovo da una copia in ritardo', scenarioD, { denyReads: false, make: makeGuardedClient }));
  flush('');

  console.log('\n- CODE EXPÉDIÉ, relecture RÉFUSÉE (403) — ce qu\'il fait quand il ne peut pas lire (informatif) :');
  const realDenied = [];
  realDenied.push(await run('(a) elenco vecchio sopra uno nuovo', scenarioA, { denyReads: true, make: makeGuardedClient }));
  realDenied.push(await run('(b) memoria seminata dallo schermo', scenarioB, { denyReads: true, make: makeGuardedClient }));
  realDenied.push(await run('(c) due poste che salvano insieme', scenarioC, { denyReads: true, make: makeGuardedClient, multiSeed: true }));
  realDenied.push(await run('(d) poste nuovo da una copia in ritardo', scenarioD, { denyReads: true, make: makeGuardedClient }));
  flush('');

  const bites = control.some((ok) => ok === false);
  const realGreen = real.every(Boolean);
  const green = bites && withRead.every(Boolean) && noRead.every(Boolean) && realGreen;
  console.log('\nVERDETTO');
  console.log(`  il banco morde (senza protezioni si perde) : ${bites ? 'si' : 'NO'}`);
  console.log(`  rilettura permessa :  ${withRead.every(Boolean) ? 'tutto protetto' : 'PERDITA'}`);
  console.log(`  rilettura rifiutata:  ${noRead.every(Boolean) ? 'tutto protetto' : 'PERDITA'}`);
  console.log(`  rimedio fetta 2 (nel banco) : ${remedy.every(Boolean) ? 'tiene tutti e quattro' : 'NON basta'}`);
  console.log(`  CODICE VERO (datasetWriteGuard) : ${realGreen ? 'tiene tutti e quattro' : 'PERDE — NON DISTRIBUIRE'}`);
  console.log(`  codice vero, lettura rifiutata : ${realDenied.every(Boolean) ? 'tiene' : 'PERDE (atteso: senza lettura non c\'e fusione)'}`);
  if (!realGreen) {
    console.log('  ALLARME : il codice spedito perde ancora — non si distribuisce.');
    process.exit(3);
  }
  console.log(green
    ? '  ESITO : VERDE - i quattro scenari non perdono piu nulla.'
    : '  ESITO : ROSSO - il banco resta rosso per la sua parte "senza protezione" (voluto):\n           la perdita e riprodotta, e il codice vero la tiene.');
  process.exit(green ? 0 : 1);
};

main().catch((e) => { console.error('errore del banco :', e); process.exit(2); });

