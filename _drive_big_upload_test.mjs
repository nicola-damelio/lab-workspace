/* =========================================================================
   _drive_big_upload_test.mjs — LES GROS FICHIERS ARRIVENT SUR LE DRIVE.

   Le défaut visé (signalé le 25/09/2026) : une trajectoire MD de plusieurs Go
   n'était PAS sur le Drive. Ses dossiers y étaient (ils se créent avant les
   octets) mais pas le fichier — donc rien à recharger sur un autre poste, et
   rien qui le dise : l'échec n'était qu'un `console.warn`.

   Vérifié ici, sur le VRAI module (src/utils/driveChunkUpload.js — logique pure,
   transport injecté) et sur les SOURCES branchées :
     1. les calculs de morceaux (`Content-Range`, bornes incluses, dernier
        morceau plus court, en-tête `Range` d'une réponse 308) ;
     2. le seuil : au-delà de `RESUMABLE_MIN_BYTES`, envoi par morceaux ; en
        dessous, l'envoi en une seule requête ne change pas ;
     3. une session complète sur un FAUX Drive : ouverture, 308 intermédiaires,
        fichier ASSEMBLÉ octet par octet, dernier morceau qui rend la ressource ;
     4. un morceau qui ÉCHOUE une fois : il est rejoué, la session dit où elle en
        est, et le fichier arrive quand même (aucun octet perdu, aucun doublon) ;
     5. une session refusée (`Location` illisible) : `null` — le repli « une seule
        requête » de driveUpload.js reste en place ;
     6. les câblages : driveUpload passe par là au-delà du seuil, `driveFetch`
        accepte un chemin ABSOLU et le statut 308, `archiveFileToDriveWithPointer`
        rend le POURQUOI d'un échec, et la page MD l'affiche (avec l'avancement).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };

const CHUNK = await import('./src/utils/driveChunkUpload.js');
const UPLOAD = readFileSync('src/utils/driveUpload.js', 'utf8');
const MD = readFileSync('src/components/MDSections.jsx', 'utf8');

/* ── 1. Les morceaux ─────────────────────────────────────────────────────── */
eq(CHUNK.shouldChunkUpload(CHUNK.RESUMABLE_MIN_BYTES - 1), false,
  'juste en dessous du seuil : l’envoi en une seule requête est gardé');
eq(CHUNK.shouldChunkUpload(CHUNK.RESUMABLE_MIN_BYTES), true, 'au seuil : envoi par morceaux');
eq(CHUNK.shouldChunkUpload(0) || CHUNK.shouldChunkUpload(undefined), false,
  'une taille inconnue ne bascule pas la façon d’envoyer');
eq(CHUNK.RESUMABLE_CHUNK_BYTES % (256 * 1024), 0,
  'la taille d’un morceau est un multiple de 256 Kio (exigence de l’API)');
eq(CHUNK.RESUMABLE_MIN_BYTES, 5 * 1024 * 1024,
  'le seuil est la limite annoncée de l’envoi multipart (5 Mio)');

eq(CHUNK.chunkRange(0, 20 * 1024 * 1024), { start: 0, end: 8388607, header: 'bytes 0-8388607/20971520', length: 8388608 },
  'la 1re plage : bornes INCLUSES, longueur du morceau');
eq(CHUNK.chunkRange(8388608, 20 * 1024 * 1024).header, 'bytes 8388608-16777215/20971520',
  'la 2e plage commence où la 1re s’arrête (aucun octet sauté)');
eq(CHUNK.chunkRange(16777216, 20 * 1024 * 1024), { start: 16777216, end: 20971519, header: 'bytes 16777216-20971519/20971520', length: 4194304 },
  'le DERNIER morceau est plus court que les autres');
eq(CHUNK.chunkRange(0, 1000).header, 'bytes 0-999/1000',
  'un fichier plus petit qu’un morceau part en une seule plage');
eq(CHUNK.chunkRange(500, 100).start, 100, 'une position au-delà de la fin est ramenée à la fin');

eq(CHUNK.receivedBytesFromRange('bytes=0-8388607', 0), 8388608,
  'l’en-tête `Range` d’une réponse 308 dit les octets DÉJÀ reçus');
eq(CHUNK.receivedBytesFromRange('', 4096), 4096,
  'sans en-tête : on ne recule pas (le morceau sera rejoué)');
eq(CHUNK.receivedBytesFromRange('n’importe quoi', 4096), 4096,
  'un en-tête illisible ne fait pas reculer la session non plus');
eq(CHUNK.sessionAckRange(20 * 1024 * 1024), 'bytes */20971520',
  'la requête « ack » ne porte que la taille totale');

/* ── 2. Un FAUX DRIVE : session, 308, ressource finale ────────────────────── */
/** Un faux Drive qui SE SOUVIENT des morceaux reçus : il assemble le fichier,
 *  répond 308 tant qu'il est incomplet (avec l'en-tête `Range`), et rend la
 *  ressource au dernier morceau. `failChunkAttempt` fait tomber UN essai de
 *  morceau (une coupure réseau), `hideLocation` refuse la session (CORS), et
 *  `keepOpen` laisse la session ouverte même une fois le fichier complet. */
const makeDrive = ({ failChunkAttempt = 0, hideLocation = false, keepOpen = false } = {}) => {
  const sessions = new Map();
  const calls = [];
  let seq = 0;
  let chunkAttempts = 0;
  let failedOnce = false;
  /** Le corps d'une requête (`Blob` en vrai, tableau d'octets dans un test). */
  const bytesOfBody = async (body) => (
    body && typeof body.arrayBuffer === 'function'
      ? new Uint8Array(await body.arrayBuffer())
      : new Uint8Array(body || [])
  );
  const res = (status, body, headers = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => headers[n] || headers[n.toLowerCase()] || '' },
    json: async () => body
  });
  const receivedOf = (session) => session.chunks.reduce((n, c) => n + c.length, 0);
  const driveFetch = async (path, opts = {}) => {
    const url = String(path);
    const range = String((opts.headers || {})['Content-Range'] || '');
    calls.push({ url, method: String(opts.method || 'GET'), range, body: opts.body });
    if (url.indexOf('uploadType=resumable') !== -1) {
      seq += 1;
      const id = `F${seq}`;
      const meta = JSON.parse(String(opts.body || '{}'));
      sessions.set(id, { id, name: meta.name || '', chunks: [], total: 0, done: false });
      return res(200, {}, hideLocation ? {} : {
        Location: `https://upload.example.googleapis.com/session/${id}`
      });
    }
    const id = url.split('/').pop();
    const session = sessions.get(id);
    if (!session) throw new Error(`unknown session ${id}`);
    if (range.indexOf('*/') !== -1) {
      // « ack » : où en est la session ? (et la ressource, si c'est terminé)
      if (session.done) return res(200, { id, name: session.name });
      const got = receivedOf(session);
      return res(308, {}, got ? { Range: `bytes=0-${got - 1}` } : {});
    }
    chunkAttempts += 1;
    if (failChunkAttempt && chunkAttempts === failChunkAttempt && !failedOnce) {
      failedOnce = true;
      throw new Error('Failed to fetch (network)');
    }
    const parts = range.split('/');
    session.total = Number(parts[1]) || session.total;
    session.chunks.push(await bytesOfBody(opts.body));
    const got = receivedOf(session);
    if (got < session.total) return res(308, {}, { Range: `bytes=0-${got - 1}` });
    session.done = true;
    // `keepOpen` : Drive garde la session ouverte même le fichier complet (c'est
    // alors la requête « ack » qui rend la ressource).
    if (keepOpen) return res(308, {}, { Range: `bytes=0-${got - 1}` });
    return res(200, { id, name: session.name });
  };
  const bytesOf = (id) => {
    const session = sessions.get(id);
    if (!session) return new Uint8Array();
    const out = new Uint8Array(receivedOf(session));
    let at = 0;
    session.chunks.forEach((c) => { out.set(c, at); at += c.length; });
    return out;
  };
  const chunkCalls = () => calls.filter((c) => c.range && c.range.indexOf('*/') === -1);
  const ackCalls = () => calls.filter((c) => c.range.indexOf('*/') !== -1);
  return { driveFetch, calls, bytesOf, chunkCalls, ackCalls, ids: () => [...sessions.keys()] };
};

/** Des octets RECONNAISSABLES (octet[i] = i % 251) : l'ordre se vérifie en
 *  comparant les tableaux, donc un morceau mal placé ne peut pas passer. */
const payloadOf = (size) => new Uint8Array(Array.from({ length: size }, (_, i) => i % 251));

/* ── 3. Une session complète : le fichier arrive ENTIER ───────────────────── */
const MIO = 1024 * 1024;
const bytes = payloadOf(MIO * 2 + 5000);
const blob = new Blob([bytes], { type: 'chemical/x-xtc' });

const drive = makeDrive();
const progress = [];
const done = await CHUNK.uploadBlobInChunks({
  blob, name: 'run1_Nicolas.xtc', mimeType: 'chemical/x-xtc', targetId: 'dirTraj',
  driveFetch: drive.driveFetch, chunkBytes: MIO,
  onProgress: (sent, total) => progress.push([sent, total])
});
eq(done, { id: 'F1', name: 'run1_Nicolas.xtc', driveUrl: 'https://drive.google.com/file/d/F1/view' },
  'l’envoi par morceaux rend la MÊME chose que l’envoi en une seule requête');
eq(drive.chunkCalls().map((c) => c.range), [
  `bytes 0-${MIO - 1}/${bytes.length}`,
  `bytes ${MIO}-${2 * MIO - 1}/${bytes.length}`,
  `bytes ${2 * MIO}-${bytes.length - 1}/${bytes.length}`
], 'trois morceaux contigus, le dernier plus court (bornes incluses)');
eq([...drive.bytesOf('F1')], [...bytes],
  'le fichier déposé est EXACTEMENT le fichier choisi, octet par octet');
eq(drive.calls[0].method, 'POST', 'un NOUVEAU fichier ouvre une session POST');
eq(JSON.parse(drive.calls[0].body).parents, ['dirTraj'],
  'la métadonnée porte le dossier (« parents ») comme l’envoi multipart');
eq(drive.calls[0].url.indexOf('uploadType=resumable') !== -1, true,
  '…et c’est bien une session « resumable » qui est ouverte');
eq(progress.at(-1), [bytes.length, bytes.length],
  'l’avancement va jusqu’au dernier octet et se compte en octets sur le total');

/* ── 4. Un fichier REMPLACÉ : même session, sans « parents » ──────────────── */
const drive2 = makeDrive();
const done2 = await CHUNK.uploadBlobInChunks({
  blob, name: 'run1_Nicolas.xtc', existingId: 'OLD', driveFetch: drive2.driveFetch, chunkBytes: MIO
});
eq(drive2.calls[0].method, 'PATCH', 'un fichier REMPLACÉ ouvre une session PATCH');
eq(drive2.calls[0].url.indexOf('/upload/drive/v3/files/OLD?uploadType=resumable') === 0, true,
  '…sur l’identifiant du fichier existant');
eq(Object.keys(JSON.parse(drive2.calls[0].body)), ['name', 'mimeType'],
  '…sans « parents » : le fichier remplacé RESTE dans son dossier');
eq(done2.id, 'F1', 'le remplacement aboutit comme le nouveau fichier');

/* ── 5. Un morceau qui TOMBE : il est rejoué, rien n’est perdu ───────────── */
const drive3 = makeDrive({ failChunkAttempt: 2 });
const done3 = await CHUNK.uploadBlobInChunks({
  blob, name: 'r.xtc', targetId: 'd', driveFetch: drive3.driveFetch, chunkBytes: MIO
});
eq(drive3.ackCalls().length, 1, 'le morceau tombé demande d’abord à la session où elle en est');
eq(drive3.ackCalls()[0].range, `bytes */${bytes.length}`, '…avec la requête « ack »');
eq(drive3.chunkCalls().map((c) => c.range), [
  `bytes 0-${MIO - 1}/${bytes.length}`,
  `bytes ${MIO}-${2 * MIO - 1}/${bytes.length}`,
  `bytes ${MIO}-${2 * MIO - 1}/${bytes.length}`,
  `bytes ${2 * MIO}-${bytes.length - 1}/${bytes.length}`
], 'le morceau tombé est REJOUÉ, et aucun autre n’est renvoyé deux fois');
eq([...drive3.bytesOf('F1')], [...bytes],
  'après la coupure, le fichier arrive quand même — et entier');
eq(done3.id, 'F1', 'la reprise aboutit');

/* ── 6. Une session qui reste ouverte : la ressource vient de l’« ack » ──── */
const drive4 = makeDrive({ keepOpen: true });
const done4 = await CHUNK.uploadBlobInChunks({
  blob, name: 'k.xtc', targetId: 'd', driveFetch: drive4.driveFetch, chunkBytes: MIO
});
eq(done4.id, 'F1', 'un dernier morceau qui rend 308 laisse l’envoi aboutir par l’« ack »');
eq(drive4.ackCalls().length, 1, '…une seule requête de plus, sans renvoyer un octet');
eq([...drive4.bytesOf('F1')], [...bytes], '…et le fichier est complet');

/* ── 7. Une session REFUSÉE : le repli « une seule requête » reste ──────── */
const drive5 = makeDrive({ hideLocation: true });
const refused = await CHUNK.uploadBlobInChunks({
  blob, name: 'x.xtc', targetId: 'd', driveFetch: drive5.driveFetch, chunkBytes: MIO
});
eq(refused, null, 'sans URL de session, rien n’est envoyé et l’appelant garde son repli');
eq(drive5.chunkCalls().length, 0, '…aucun morceau n’est poussé dans le vide');

/* ── 8. Le câblage (sources) ─────────────────────────────────────────────── */
ok(UPLOAD.includes("import { shouldChunkUpload, uploadBlobInChunks } from './driveChunkUpload';"),
  'driveUpload branche le module d’envoi par morceaux');
ok(UPLOAD.includes('if (shouldChunkUpload(blob.size)) {'), '…au-delà du seuil seulement');
ok(UPLOAD.includes('blob, name, mimeType: type, targetId, existingId, driveFetch, onProgress'),
  '…avec le dossier, le fichier remplacé et l’avancement');
ok(UPLOAD.includes('if (!fileMeta) {'), '…et garde l’envoi en une seule requête comme repli');
ok(UPLOAD.includes("const isAbsolute = typeof path === 'string' && /^https?:\\/\\//i.test(path);"),
  'driveFetch accepte le CHEMIN ABSOLU d’une session (il porte un upload_id)');
ok(UPLOAD.includes('accept = null, ...rest } = opts;'), '…et un `accept` de statuts non-ok');
ok(UPLOAD.includes('if (!res.ok && !accepted.includes(res.status)) {'),
  '…dont le 308 d’un envoi en cours (sinon il serait converti en erreur)');
ok(UPLOAD.includes('export const archiveFileToDriveWithPointer = async ({ file, ctx = {}, title = \'\', suffix = \'file\', onProgress = null }) => {'),
  'l’archivage rend un POINTEUR, un AVANCEMENT et une RAISON');
ok(UPLOAD.includes('error: tooLarge'), '…il DIT pourquoi un envoi n’a pas abouti');
ok(UPLOAD.includes('MAX_SINGLE_BYTES / 1048576'), '…en nommant la limite de la file de reprise');
ok(MD.includes('const { name: driveName, pointer, error } = await archiveFileToDriveWithPointer({'),
  'la page MD lit la raison de l’échec');
ok(MD.includes('onProgress') && MD.includes('to Google Drive… ${pct}%'),
  '…et affiche l’avancement : l’attente d’une trajectoire de plusieurs Go est visible');
ok(MD.includes('but the Drive upload failed${error ? ` — ${error}` : \'\'}'),
  '…et un échec ne peut plus passer pour un archivage réussi');

console.log(`_drive_big_upload_test: ${passed} passed`);
