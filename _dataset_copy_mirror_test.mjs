/* =========================================================================
   _dataset_copy_mirror_test.mjs — « C'EST ENREGISTRÉ, MAIS PAS SUR LE DRIVE »

   Le contenu d'un dataset (donc les calculs de solution, les définitions, les
   bibliothèques…) voyage depuis longtemps : App.jsx le dépose dans
     Lab Workspace/_workspace/datasets/ds_<id>.json
   ~8 s après la dernière modification — c'est ce fichier qui rend le dataset
   lisible sur un poste neuf quand Firestore ne répond pas, ou pas encore.

   Deux trous rendaient ce dépôt non fiable, et ce sont eux que ce fichier
   verrouille :

     1. l'écriture était DIFFÉRÉE sans rattrapage : un calcul enregistré puis un
        onglet fermé dans les 8 s n'atteignait JAMAIS le Drive — l'autre poste
        affichait « rien » alors que le calcul venait d'être fait.
        → `flush()` envoie immédiatement ce qui attend, et App.jsx l'appelle sur
          `pagehide` (fermeture) et `visibilitychange` (arrière-plan) ;
     2. l'écriture était silencieuse : dépassement de taille ou Drive éteint ne
        se distinguaient pas de « rien à écrire ».
        → le dépassement est ANNONCÉ (workspaceDrive.writeDatasetCopy).

   Ce qui est vérifié : la mécanique réelle (src/utils/datasetCopyMirror.js),
   minuteries et horloge injectées (donc sans attente réelle), plus son câblage
   dans App.jsx. L'écriture d'un contenu identique reste ignorée (empreinte) :
   taper dans un titre ne déclenche pas cinquante envois.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const M = await import('./src/utils/datasetCopyMirror.js');
const APP = readFileSync('./src/App.jsx', 'utf8');
const WS = readFileSync('./src/utils/workspaceDrive.js', 'utf8');

let passed = 0;
const eq = (actual, expected, what) => { assert.deepEqual(actual, expected, what); passed += 1; };
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => ok(src.includes(needle), what);

const PAYLOAD = { title: 'Pepper', payload: 'LZ', calculationEntries: { Pepper: [{ id: 'c1' }] } };

/* ── Un faux « Drive » : on garde ce que la fabrique écrit, et quand ──────── */
const makeHarness = () => {
  const writes = [];
  const timers = new Map();
  let nextTimer = 0;
  const mirror = M.createDatasetCopyMirror({
    delay: 8000,
    write: (body) => { writes.push(body); return Promise.resolve({ id: 'f1' }); },
    now: () => 1_770_000_000_000,
    setTimer: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimer: (id) => { timers.delete(id); }
  });
  /* Déclenche la minuterie en attente, comme le ferait le navigateur. */
  const fire = () => {
    const first = Array.from(timers.entries())[0];
    if (!first) return false;
    timers.delete(first[0]);
    first[1].fn();
    return true;
  };
  return { mirror, writes, timers, fire };
};

/* ── 1. Différé : rien ne part tout de suite, une seule requête après calme ─ */
{
  const h = makeHarness();
  ok(h.mirror.schedule('ds1', PAYLOAD), 'planifier une écriture est accepté');
  eq(h.writes.length, 0, '…et RIEN ne part tout de suite (l’écriture est différée)');
  eq(h.timers.size, 1, '…une seule minuterie en attente');
  ok(h.fire(), '…qui se déclenche après le temps de calme');
  eq(h.writes.length, 1, '…et écrit UNE fois sur le Drive');
  eq(h.writes[0].id, 'ds1', '…avec l’identifiant du dataset');
  eq(h.writes[0].calculationEntries, PAYLOAD.calculationEntries,
    '…le contenu complet (les calculs voyagent avec le dataset)');
  eq(h.writes[0].updatedAt, 1_770_000_000_000, '…et un horodatage (horloge injectée)');
}

/* ── 2. Empreinte : un contenu identique n'est JAMAIS renvoyé ────────────── */
{
  const h = makeHarness();
  h.mirror.schedule('ds1', PAYLOAD);
  h.fire();
  eq(h.mirror.schedule('ds1', PAYLOAD), false, 'replanifier le MÊME contenu est refusé');
  eq(h.timers.size, 0, '…et ne pose même pas de minuterie');
  ok(h.mirror.schedule('ds1', { ...PAYLOAD, title: 'Poivron' }), 'un contenu modifié, lui, est planifié');
  h.fire();
  eq(h.writes.length, 2, '…et part sur le Drive');
  ok(h.mirror.fingerprint().includes('Poivron'), 'l’empreinte suit le dernier contenu écrit');
}

/* ── 3. Rafale de modifications : la DERNIÈRE gagne, en une seule requête ── */
{
  const h = makeHarness();
  h.mirror.schedule('ds1', { ...PAYLOAD, title: 'A' });
  h.mirror.schedule('ds1', { ...PAYLOAD, title: 'B' });
  h.mirror.schedule('ds1', { ...PAYLOAD, title: 'C' });
  eq(h.timers.size, 1, 'trois frappes = une seule minuterie (pas cinquante envois)');
  eq(h.writes.length, 0, '…et aucun envoi intermédiaire');
  h.fire();
  eq(h.writes.length, 1, '…un seul envoi à la fin');
  eq(h.writes[0].title, 'C', '…avec le DERNIER contenu, jamais un état intermédiaire');
}

/* ── 4. flush() : la fermeture de l'onglet n'attend PAS le délai ─────────── */
{
  const h = makeHarness();
  h.mirror.schedule('ds1', PAYLOAD);
  ok(h.mirror.hasPending(), 'un envoi attend');
  ok(h.mirror.flush(), 'flush() envoie TOUT DE SUITE ce qui attend');
  eq(h.writes.length, 1, '…l’écriture a bien eu lieu sans attendre les 8 s');
  eq(h.timers.size, 0, '…et sa minuterie est annulée (aucun doublon plus tard)');
  eq(h.mirror.flush(), false, 'un second flush sans rien en attente n’écrit pas');
  eq(h.writes.length, 1, '…donc aucune requête inutile');
}

/* ── 5. Ce qu'il ne faut JAMAIS faire : lever ou perdre une saisie ──────── */
{
  const h = makeHarness();
  eq(h.mirror.schedule('', PAYLOAD), false, 'un dataset sans identifiant est ignoré');
  eq(h.mirror.schedule('ds1', null), false, 'une charge absente est ignorée');
  eq(h.mirror.schedule('ds1', 'texte'), false, 'une charge qui n’est pas un objet est ignorée');
  eq(h.timers.size, 0, '…et rien n’est planifié pour autant');

  const broken = M.createDatasetCopyMirror({
    write: () => { throw new Error('Drive injoignable'); },
    setTimer: () => 1,
    clearTimer: () => {}
  });
  ok(broken.schedule('ds1', PAYLOAD), 'le dépôt reste best-effort');
  eq(broken.flush(), false, 'un Drive qui lève ne fait pas lever la sauvegarde');

  const h2 = makeHarness();
  h2.mirror.stop();
  eq(h2.mirror.schedule('ds1', PAYLOAD), false, 'après stop(), plus rien n’est planifié (démontage)');
  eq(h2.mirror.hasPending(), false, '…et ce qui attendait est abandonné');
  eq(h2.timers.size, 0, '…minuterie comprise');
}


/* ── 6. Vraies minuteries : le regroupement tient aussi dans le navigateur ─ */
const realTimers = async () => {
  const writes = [];
  const mirror = M.createDatasetCopyMirror({
    delay: 20,
    write: (body) => { writes.push(body); }
  });
  mirror.schedule('ds1', { ...PAYLOAD, title: 'A' });
  mirror.schedule('ds1', { ...PAYLOAD, title: 'B' });
  await new Promise((r) => setTimeout(r, 60));
  eq(writes.length, 1, 'avec de vraies minuteries : un seul envoi pour deux frappes');
  eq(writes[0].title, 'B', '…et c’est le dernier contenu qui part');
};
await realTimers();

/* ── 7. Le câblage dans App.jsx (sinon la mécanique ne sert à rien) ──────── */
has(APP, "import { createDatasetCopyMirror } from './utils/datasetCopyMirror'",
  'App.jsx utilise la fabrique testée');
has(APP, 'write: (body) => writeDatasetCopy(body).catch(() => null)',
  '…avec l’écriture réelle du contenu du dataset');
has(APP, 'datasetCopyMirrorRef.current = createDatasetCopyMirror({',
  '…UNE instance pour toute la session (empreinte et minuterie survivent aux rendus)');
has(APP, 'datasetCopyMirrorRef.current.schedule(id, payload)',
  '…à laquelle chaque sauvegarde est confiée');
has(APP, "window.addEventListener('pagehide', flushDatasetCopy)",
  'la fermeture de l’onglet force l’écriture en attente');
has(APP, "document.addEventListener('visibilitychange', onVisibilityChange)",
  '…et le passage en arrière-plan aussi');
has(APP, "if (document.visibilityState === 'hidden') flushDatasetCopy()",
  '…sans écrire quand l’onglet revient au premier plan');
has(APP, 'datasetCopyMirrorRef.current.flush()', '…par le vidage de la fabrique');
has(WS, 'too large for the Drive mirror',
  'une copie Drive trop lourde est ANNONCÉE, jamais silencieuse');
has(WS, "console.warn('Mirroring the dataset content to Drive failed:'",
  '…et un dépôt qui échoue laisse une trace');

console.log(`✅ ${passed} tests passés (la copie Drive du dataset ne perd plus la dernière minute)`);

