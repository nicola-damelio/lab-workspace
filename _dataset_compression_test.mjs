/* =========================================================================
   _dataset_compression_test.mjs — « LA COMPRESSION DANS UN FIL ».

   La demande, mot pour mot : « non capisco molto di quello che dici ma se il
   punto 4 farebbe il programma piu veloce allora fallo ». Le point 4 était la
   compression LZString déplacée dans un **web worker**.

   CE QUI ÉTAIT MESURÉ (fil principal, 2026-10-14, voir
   `_save_in_background_test.mjs`) :

     | ce qui tournait | payload | coût |
     |---|---|---|
     | `JSON.stringify` + `LZString.compressToUTF16` (la sauvegarde) | 6,0 Mo | **884 ms** |
     | `LZString.compressToUTF16` seul | 6,0 Mo | **3 815 ms** |

   RE-MESURÉ POUR CE MODULE (6,2 Mo de JSON, même machine) : `JSON.stringify` **72 ms**,
   `LZString.compressToUTF16` **3 226 ms**, les deux à la suite **3 449 ms** — c'est ce
   dernier chiffre que le fil principal ne paie plus.

   CE QUI EST VÉRIFIÉ ICI, en EXÉCUTANT le code réel (pas en le relisant) :

     1. **Le corps du worker rend EXACTEMENT l'ancienne charge.** `compressRequest`
        et `handleCompressionMessage` (les deux fonctions que le fil exécute) sont
        appelées ici, sous node, et leur sortie est comparée à
        `LZString.compressToUTF16` — c'est ce qui garantit que Firestore, les
        fichiers HTML et le Drive relisent la MÊME chose qu'avant.
     2. **Le fil principal ne compresse plus rien.** Avec un fil factice et une
        compression « synchrone » qui occupe 200 ms, le geste rend la main en
        quelques millisecondes et la charge arrive par le fil : la preuve est un
        CHRONOMÈTRE, pas une intention.
     3. **Une sauvegarde ne se perd jamais** (le repli, dans tous ses états) :
        fil indisponible, création refusée, réponse illisible, `{ok:false}`, mort
        du fil (`error`), silence complet (échéance), `dispose()`. Dans CHACUN de
        ces cas la promesse rend la charge correcte — ou ne rejette que si la
        compression synchrone elle-même échoue (elle ne peut plus échouer
        silencieusement).
     4. **`App.jsx` passe bien par là** : la sauvegarde automatique (et la base
        d'administration) compresse hors du fil principal, la fermeture d'onglet
        garde le geste SYNCHRONE (plus d'écran à protéger, plus le temps d'un
        aller-retour), et plus une seule mesure d'étape ne tourne sur le fil.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import LZString from 'lz-string';
import {
  compressPayloadSync,
  compressPayloadInBackground,
  canUseCompressionWorker,
  createDatasetCompressor,
  datasetCompressor,
  COMPRESSION_WORKER_DEADLINE_MS
} from './src/utils/datasetCompression.js';
import { compressRequest, handleCompressionMessage } from './src/utils/datasetCompression.worker.js';

const APP = readFileSync('./src/App.jsx', 'utf8').replace(/\r\n/g, '\n');
const CLIENT = readFileSync('./src/utils/datasetCompression.js', 'utf8').replace(/\r\n/g, '\n');
const WORKER = readFileSync('./src/utils/datasetCompression.worker.js', 'utf8').replace(/\r\n/g, '\n');

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => {
  assert.ok(String(src).includes(needle), `${what}\n  fragment absent : ${needle}`);
  passed += 1;
};
const lacks = (src, needle, what) => {
  assert.ok(!String(src).includes(needle), `${what}\n  fragment présent : ${needle}`);
  passed += 1;
};
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/* Un fil factice : il enregistre ce qu'on lui envoie, sait répondre (dans
   l'ordre qu'on veut), tomber (`error`) ou rester muet. */
const makeFakeWorker = () => {
  const listeners = new Map();
  const sent = [];
  const worker = {
    sent,
    terminated: 0,
    postMessage(message) { sent.push(message); },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    terminate() { worker.terminated += 1; },
    emit(type, event) { (listeners.get(type) || []).forEach((fn) => fn(event)); },
    answer(index) { worker.emit('message', { data: { id: sent[index].id, ok: true, payload: `fil:${sent[index].json}` } }); },
    reply(index, data) { worker.emit('message', { data: { id: sent[index].id, ...data } }); }
  };
  return worker;
};

const spySync = (reference = compressPayloadSync) => {
  const calls = [];
  const spy = (json) => { calls.push(json); return reference(json); };
  spy.calls = calls;
  return spy;
};

/* ══ 1. LE CORPS DU WORKER REND EXACTEMENT L'ANCIENNE CHARGE ═══════════════ */

{
  const SAMPLES = [
    { a: 1 },
    { tests: [] },
    ['x', 'y', 'z'],
    { nested: { deep: { value: 42 } }, flag: true, none: null },
    { comments: 'naïve ✓ 日本語 – em—dash <p>data:image/png;base64,iVBORw0KGgo=</p>' },
    { data: 'A'.repeat(20000) }, // une charge qui compresse vraiment (FCS, image)
    null,
    'simple chaîne'
  ];
  SAMPLES.forEach((sample, i) => {
    const json = JSON.stringify(sample);
    const reference = LZString.compressToUTF16(json);
    eq(compressPayloadSync(json), reference, `la version synchrone reste celle de lz-string (cas ${i})`);
    const reply = compressRequest({ id: i + 1, json });
    eq(reply.id, i + 1, `la réponse porte l’identifiant de la demande (cas ${i})`);
    eq(reply.ok, true, `le corps du worker dit qu’il a réussi (cas ${i})`);
    eq(reply.payload, reference,
      `le corps du worker rend la MÊME charge que l’ancien geste (cas ${i}) — Firestore/HTML/Drive relisent à l’identique`);
    eq(JSON.stringify(JSON.parse(LZString.decompressFromUTF16(reference))), json,
      `…et cette charge se relit en JSON valide (cas ${i})`);
  });

  /* Le worker sait aussi recevoir un OBJET (il stringifie lui-même) : la
     sauvegarde, elle, envoie du TEXTE (c'est mesuré plus bas). */
  eq(compressRequest({ id: 9, json: { a: 1 } }).payload, LZString.compressToUTF16('{"a":1}'),
    'un objet confié au worker est stringifié puis compressé (même charge)');
  eq(compressRequest({ id: 10 }).payload, LZString.compressToUTF16('null'),
    'une charge absente devient « null » : le worker ne lève pas');

  /* Un échec de stringification est DIT, jamais avalé : le fil principal a de
     quoi se replier (garantie ③). */
  const broken = { toJSON() { throw new Error('charge impossible'); } };
  eq(compressRequest({ id: 11, json: broken }), { id: 11, ok: false, error: 'charge impossible' },
    'un échec de compression est rendu au fil principal au lieu d’être silencieux');

  /* La conversation : ce qui est posté est exactement ce qui est rendu. */
  const posted = [];
  const scope = { postMessage(message) { posted.push(message); } };
  const reply = handleCompressionMessage({ data: { id: 21, json: '{"a":1}' } }, scope);
  eq(posted.length, 1, 'une demande valide reçoit UNE réponse');
  eq(posted[0], reply, 'la réponse postée est celle que la fonction rend (même objet)');
  eq(posted[0].payload, LZString.compressToUTF16('{"a":1}'), '…avec la charge attendue');
  eq(handleCompressionMessage({ data: { json: 'x' } }, scope), null, 'une demande sans identifiant est ignorée');
  eq(handleCompressionMessage({}, scope), null, 'un événement vide est ignoré');
  eq(handleCompressionMessage({ data: { id: 22, json: 'x' } }, null), null, 'sans fil pour répondre, rien n’est posté');
  eq(posted.length, 1, '…et rien n’a été posté entre-temps');

  /* Le module s'importe hors d'un worker (c'est ce que fait cette sonde) : le
     branchement sur `self` n'a lieu QUE dans un vrai fil. */
  has(WORKER, "import LZString from 'lz-string';", 'le fil compresse avec le MÊME LZString que l’application');
  has(WORKER, "if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {",
    'le corps du fil n’est branché sur `self` que dans un vrai worker (importable sous node)');
  lacks(WORKER, 'document.', 'le fil ne touche pas au DOM (un worker n’en a pas)');
  lacks(WORKER, 'React', '…et ne dépend d’aucun état React');
}

/* ══ 2. LE FIL PRINCIPAL NE COMPRESSE PLUS RIEN — CHRONOMÈTRÉ ══════════════ */

{
  const SLOW_MS = 200;
  const slowSync = (json) => {
    const until = Date.now() + SLOW_MS;
    // eslint-disable-next-line no-empty
    while (Date.now() < until) { /* occupe le fil, comme LZString sur 6 Mo */ }
    return `lent:${json}`;
  };

  /* ① AVEC un fil : le geste rend la main tout de suite. */
  const worker = makeFakeWorker();
  const slowSpy = spySync(slowSync);
  const withThread = createDatasetCompressor({ workerFactory: () => worker, sync: slowSpy });
  const t0 = Date.now();
  const pending = withThread.compress('{"payload":"6 Mo"}');
  const handBack = Date.now() - t0;
  ok(pending instanceof Promise, 'la compression d’arrière-plan REND une promesse');
  ok(handBack < 50,
    `le geste rend la main en ${handBack} ms alors que la compression coûte ${SLOW_MS} ms : le fil principal ne l’a pas payée`);
  eq(worker.sent.length, 1, 'la demande est bien partie dans le fil');
  eq(worker.sent[0].json, '{"payload":"6 Mo"}',
    'c’est le TEXTE qui part dans le fil (JSON.stringify reste ici : 40 ms pour 6 Mo, mesuré)');
  eq(slowSpy.calls.length, 0, 'la compression synchrone de secours n’a pas été appelée : c’est le fil qui travaille');
  worker.answer(0);
  eq(await pending, 'fil:{"payload":"6 Mo"}', '…et la charge revient du fil');
  ok(withThread.usesWorker, 'le compresseur dit qu’il travaille dans un fil');

  /* ② SANS fil (page servie depuis un fichier, politique de sécurité, vieux
     navigateur) : le repli compresse ICI. Plus lent, mais la sauvegarde a
     LIEU — c’est la garantie ①. */
  const noThread = createDatasetCompressor({ workerFactory: () => null, sync: slowSync });
  const t1 = Date.now();
  await noThread.compress('x');
  const blocked = Date.now() - t1;
  ok(blocked >= SLOW_MS - 20,
    `sans fil, le repli occupe le fil ${blocked} ms (mesuré) — plus lent, mais rien n’est perdu`);
  ok(noThread.usesMainThread, '…et le compresseur le dit (il a renoncé au fil)');
}

/* ══ 3. LE REPLI, DANS TOUS SES ÉTATS : AUCUNE SAUVEGARDE PERDUE ═══════════ */

{
  const json = JSON.stringify({ tests: [{ id: 'a' }] });
  const reference = compressPayloadSync(json);

  /* ① Deux demandes en vol, réponses DANS LE DÉSORDRE. */
  {
    const worker = makeFakeWorker();
    const compressor = createDatasetCompressor({ workerFactory: () => worker });
    const first = compressor.compress('{"n":1}');
    const second = compressor.compress('{"n":2}');
    worker.answer(1); // la seconde d'abord
    worker.answer(0);
    eq(await first, 'fil:{"n":1}', 'une réponse arrivée après une autre retrouve SA demande');
    eq(await second, 'fil:{"n":2}', '…et l’autre la sienne');
  }

  /* ② Le fil dit non (mémoire) : on finit ici. */
  {
    const worker = makeFakeWorker();
    const compressor = createDatasetCompressor({ workerFactory: () => worker });
    const pending = compressor.compress(json);
    worker.reply(0, { ok: false, error: 'mémoire' });
    eq(await pending, reference, 'un « ok: false » du fil est rattrapé ici : la sauvegarde passe');
  }

  /* ③ Réponse illisible (charge absente, ou pas une chaîne). */
  for (const brokenReply of [{ ok: true }, { ok: true, payload: 42 }, { ok: 'oui', payload: null }]) {
    const worker = makeFakeWorker();
    const compressor = createDatasetCompressor({ workerFactory: () => worker });
    const pending = compressor.compress(json);
    worker.reply(0, brokenReply);
    eq(await pending, reference, `une réponse illisible (${JSON.stringify(brokenReply)}) est rattrapée ici`);
  }

  /* ④ Le fil MEURT (`error`) : ce qui attendait finit ici, et il n'est pas
     relancé en boucle. */
  {
    let created = 0;
    const worker = makeFakeWorker();
    const compressor = createDatasetCompressor({ workerFactory: () => { created += 1; return worker; } });
    const pending = compressor.compress(json);
    worker.emit('error', { message: 'le fil est tombé' });
    eq(await pending, reference, 'un fil mort ne perd pas la sauvegarde en cours');
    eq(worker.terminated, 1, '…et il est lâché (terminate)');
    eq(await compressor.compress(json), reference, 'les compressions suivantes se font ici');
    eq(created, 1, '…sans recréer un fil qui vient de mourir');
    ok(compressor.usesMainThread, '…et le compresseur le dit');
  }

  /* ⑤ Silence complet : l'échéance reprend la demande. */
  {
    const worker = makeFakeWorker();
    const compressor = createDatasetCompressor({ workerFactory: () => worker, deadlineMs: 20 });
    const pending = compressor.compress(json);
    eq(await pending, reference, 'un fil qui ne répond JAMAIS est rattrapé à l’échéance');
    eq(worker.terminated, 1, '…et lâché');
  }

  /* ⑥ Le fil ne peut pas être créé : la fabrique lève (politique de sécurité),
     ou il n'y a pas de `Worker` du tout. */
  {
    const refused = createDatasetCompressor({ workerFactory: () => { throw new Error('worker interdit'); } });
    eq(await refused.compress(json), reference, 'une fabrique de fil qui lève → repli synchrone');
    ok(refused.usesMainThread, '…et le compresseur renonce au fil');
  }

  /* ⑦ `postMessage` qui lève (fil cassé juste après sa création). */
  {
    const worker = { postMessage() { throw new Error('fil cassé'); }, addEventListener() {}, terminate() {} };
    const compressor = createDatasetCompressor({ workerFactory: () => worker });
    eq(await compressor.compress(json), reference, 'un postMessage qui lève → repli synchrone, charge correcte');
  }

  /* ⑧ `dispose()` : ce qui attendait finit ici. */
  {
    const worker = makeFakeWorker();
    const compressor = createDatasetCompressor({ workerFactory: () => worker });
    const pending = compressor.compress(json);
    compressor.dispose();
    eq(await pending, reference, 'dispose() reprend la demande en cours ici');
    eq(worker.terminated, 1, '…et lâche le fil');
  }

  /* ⑨ Sous node (cette sonde), il n'y a PAS de web worker : le module le dit,
     et le compresseur partagé par l'application compresse ici sans planter. */
  eq(canUseCompressionWorker(), false, 'sous node il n’y a pas de web worker');
  ok(datasetCompressor.usesMainThread, '…et le compresseur de l’application se replie proprement');
  eq(await compressPayloadInBackground(json), reference, 'compressPayloadInBackground rend la même charge, même sans fil');
  ok(compressPayloadInBackground(json) instanceof Promise, '…et rend TOUJOURS une promesse');

  /* ⑩ Le seul échec qui remonte est celui de la compression synchrone : il ne
     peut plus être avalé en silence (avant ce module, elle était appelée
     directement — un échec remontait de la même façon). */
  {
    const failing = createDatasetCompressor({
      workerFactory: () => null,
      sync: () => { throw new Error('mémoire épuisée'); }
    });
    let outcome = '';
    await failing.compress(json).then(() => { outcome = 'RÉSOLU'; }, (error) => { outcome = error.message; });
    eq(outcome, 'mémoire épuisée', 'un échec de la compression synchrone remonte, il n’est pas avalé');
  }
}

/* ══ 4. App.jsx : LA SAUVEGARDE PASSE PAR LE FIL, L'URGENCE RESTE SYNC ══════ */

{
  const atFunction = APP.indexOf('const compressDatasetForSave = async (raw, urgent = false) => {');
  ok(atFunction > 0, 'la compression de sauvegarde est ASYNCHRONE et connaît l’urgence');
  const BLOCK = APP.slice(atFunction, APP.indexOf('useEffect(() => {', atFunction));
  has(BLOCK, 'return urgent ? compressPayloadSync(json) : compressPayloadInBackground(json);',
    'elle choisit le fil ordinaire… ou le geste synchrone quand il n’y a plus d’écran à protéger');
  has(BLOCK, 'const json = JSON.stringify(data);',
    'JSON.stringify reste sur le fil principal (c’est le prix du texte : 72 ms pour 6,2 Mo, mesuré)');
  eq((BLOCK.match(/\(await sizeOf\(/g) || []).length, 8,
    'les 8 mesures d’étape sont ATTENDUES (5 conditions + 3 boucles d’élagage)');
  lacks(BLOCK, 'if (sizeOf(', '…plus une seule mesure n’échappe à l’attente');
  lacks(BLOCK, 'while (sizeOf(', '…y compris les boucles d’élagage');
  lacks(BLOCK, 'LZString.compressToUTF16', '…et la fonction ne compresse plus elle-même sur le fil principal');

  has(APP, "import { compressPayloadInBackground, compressPayloadSync } from './utils/datasetCompression';",
    'elle passe par le module dédié, importé une fois');
  has(APP, 'const compressedPayload = await compressDatasetForSave(rawData, urgent);',
    'l’enregistrement automatique l’attend EN TRANSMETTANT son urgence (datasets de plusieurs Mo)');
  has(APP, "const compressedPayload = isAdmin ? '' : await compressDatasetForSave(rawData);",
    'la sortie d’un dataset aussi (la page d’arrivée, elle, est déjà peinte)');
  has(APP, 'payload: await compressPayloadInBackground(JSON.stringify({ administration: adminContent })),',
    'la base d’administration se compresse hors du fil principal');
  has(APP, 'payload: await compressPayloadInBackground(JSON.stringify({ administration: adminContent || createAdministrationSeed() })),',
    '…et sa sortie de dataset aussi');

  /* LA FERMETURE D'ONGLET N'ATTEND PERSONNE : `urgent = true` → compression
     SYNCHRONE. Il n'y a plus de peinture à protéger, mais la dernière minute du
     travail, si — une promesse n'aurait pas le temps d'aboutir. */
  const atFlush = APP.indexOf('const flushPendingSave = () => {');
  const FLUSH = APP.slice(atFlush, APP.indexOf('const onVisibilityChange', atFlush));
  has(FLUSH, 'pendingDatasetSaveRef.current(true);', 'le vidage d’onglet (pagehide / onglet caché) réclame l’urgent');
  lacks(FLUSH, 'yieldToPaint', '…et n’attend aucune peinture');

  /* LES AUTRES CHARGES GARDENT LEUR GESTE — et c'est VOULU : « Save HTML », la
     sauvegarde hebdomadaire et la création d'un dataset ne partent pas d'une
     frappe. Le FORMAT, lui, est le même partout (LZString UTF-16). */
  has(APP, 'const getCompressedPayload = () =>', 'la charge complète garde son constructeur (Save HTML / sauvegarde hebdomadaire)');
  has(APP, "import LZString from 'lz-string';", '…et App.jsx garde LZString pour ces chemins-là');
  has(APP, 'LZString.decompressFromUTF16(', 'la relecture des charges n’a pas bougé d’un caractère');

  /* Vite ne peut embarquer le fil que s'il voit CETTE forme : c'est la ligne qui
     fait exister le worker dans le build (module worker). */
  has(CLIENT, "new Worker(new URL('./datasetCompression.worker.js', import.meta.url), { type: 'module' })",
    'le fil est créé par la forme que Vite sait embarquer');
  has(CLIENT, 'export const datasetCompressor = createDatasetCompressor();',
    'l’application partage UN fil, créé à la première sauvegarde');
  eq(COMPRESSION_WORKER_DEADLINE_MS, 20000, 'l’échéance de reprise (20 s) est celle qui est écrite ici');
}

console.log(`_dataset_compression_test.mjs — ${passed} assertions OK`);
