/* =========================================================================
   src/utils/driveChunkUpload.js — L'ENVOI DES GROS FICHIERS VERS GOOGLE DRIVE,
   PAR MORCEAUX (session « resumable »).

   Le défaut visé (signalé le 25/09/2026) : une trajectoire MD de plusieurs Go
   n'arrivait PAS sur le Drive. L'arborescence du fichier était bien créée (les
   dossiers se créent AVANT les octets, voir driveUpload.resolveDrivePathFromNames)
   mais le fichier lui-même manquait — sur le Drive, et donc sur tout autre poste,
   où la page MD ne pouvait plus rien recharger.

   La cause : tout envoi passait par UNE seule requête `uploadType=multipart`.
   Une requête unique de plusieurs Go n'a aucun point de reprise : la moindre
   coupure (réseau, onglet fermé, jeton renouvelé en cours de route) fait tout
   perdre, et l'envoi multipart est documenté par Google pour les PETITS fichiers.

   Au-delà de `RESUMABLE_MIN_BYTES`, l'envoi passe donc par une SESSION
   « resumable » de l'API Drive :

       1. POST (nouveau fichier) ou PATCH (fichier remplacé) sur
          /upload/drive/v3/files?uploadType=resumable → l'URL de session, dans
          l'en-tête `Location` ;
       2. PUT de cette URL, un morceau de `RESUMABLE_CHUNK_BYTES` à la fois, avec
          `Content-Range` — Drive répond 308 + `Range` tant que le fichier est
          incomplet, puis 200/201 + la ressource du fichier au dernier morceau ;
       3. un morceau qui échoue est REJOUÉ après avoir demandé à la session où
          elle en est (la requête « ack », voir sessionAckRange) : rien n'est
          renvoyé deux fois pour rien, rien n'est perdu, et le nom / le dossier
          déposés sont EXACTEMENT ceux de l'envoi en une seule requête (même
          métadonnée).

   La logique est PURE : le transport est INJECTÉ (`driveFetch`), donc elle est
   vérifiée hors navigateur par _drive_big_upload_test.mjs — faux Drive compris
   (session, 308, morceau en échec, reprise, fichier assemblé octet par octet).
   Le câblage (quelle taille part par morceaux, quel repli en cas de session
   refusée) vit dans driveUpload.js, à côté de l'envoi multipart qu'il remplace.
   ========================================================================= */

/** Au-delà de cette taille, l'envoi passe par une session « resumable ».
 *  Google documente l'envoi multipart (une seule requête) pour les petits
 *  fichiers, avec une limite de 5 Mio : au-delà, la session par morceaux est la
 *  seule voie qui REPREND après une coupure. */
export const RESUMABLE_MIN_BYTES = 5 * 1024 * 1024;

/** Taille d'un morceau. L'API exige un multiple de 256 Kio (sauf le dernier). */
export const RESUMABLE_CHUNK_BYTES = 8 * 1024 * 1024;

/** Nombre d'essais d'un morceau avant d'abandonner l'envoi (l'erreur remonte
 *  alors à l'appelant, qui dit pourquoi au lieu d'un échec muet). */
export const RESUMABLE_MAX_ATTEMPTS = 3;

/** Vrai quand ce fichier doit passer par la session « resumable ». PUR. */
export const shouldChunkUpload = (bytes) => Number(bytes || 0) >= RESUMABLE_MIN_BYTES;

/** La plage `Content-Range` du morceau qui commence à `sent` — bornes INCLUSES,
 *  comme l'exige l'API (`bytes 0-8388607/20971520`) — et sa longueur en octets.
 *  Le dernier morceau s'arrête au dernier octet du fichier. PUR. */
export const chunkRange = (sent, total, chunkBytes = RESUMABLE_CHUNK_BYTES) => {
  const size = Math.max(0, Number(total || 0));
  const start = Math.min(size, Math.max(0, Number(sent || 0)));
  const step = Math.max(1, Number(chunkBytes || 0) || RESUMABLE_CHUNK_BYTES);
  const end = Math.min(start + step, size) - 1;
  return { start, end, header: `bytes ${start}-${end}/${size}`, length: end - start + 1 };
};

/** Nombre d'octets DÉJÀ reçus d'après l'en-tête `Range` d'une réponse 308
 *  (« bytes=0-1048575 » → 1048576). Un en-tête absent ou illisible rend `sent`
 *  (on ne recule jamais : le morceau est simplement rejoué). PUR. */
export const receivedBytesFromRange = (rangeHeader, sent = 0) => {
  const m = /bytes=(\d+)-(\d+)/i.exec(String(rangeHeader || ''));
  if (!m) return Math.max(0, Number(sent || 0));
  return Number(m[2]) + 1;
};

/** La requête qui demande à la session OÙ elle en est : son `Content-Range` ne
 *  porte QUE la taille totale, sans aucune plage (c'est la forme « ack » de
 *  l'API, à côté de la forme « plage » de chunkRange). PUR. */
export const sessionAckRange = (total) => `bytes */${Number(total || 0)}`;

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Un en-tête de réponse, lu de façon TOLÉRANTE : un faux Drive de test peut
 *  n'offrir qu'un objet simple au lieu d'un objet `Headers`. */
const headerOf = (res, name) => {
  try {
    if (res && res.headers && typeof res.headers.get === 'function') {
      return String(res.headers.get(name) || res.headers.get(name.toLowerCase()) || '');
    }
  } catch { /* ignore */ }
  return '';
};

/** L'URL de session (`Location`) d'une réponse d'ouverture de session. */
const locationOf = (res) => headerOf(res, 'Location');

const rangeOf = (res) => headerOf(res, 'Range');

const statusOf = (res) => Number((res && res.status) || 0);

/** La ressource du fichier telle que la rend un envoi terminé. */
const fileResultOf = (json, fallbackName = '') => (
  json && json.id
    ? {
      id: String(json.id),
      name: String(json.name || fallbackName || ''),
      driveUrl: `https://drive.google.com/file/d/${json.id}/view`
    }
    : null
);

/** Demande à la session les octets déjà reçus (requête « ack » : voir
 *  sessionAckRange) — ou la ressource du fichier si l'envoi s'est terminé
 *  entre-temps. Un Drive muet rend `{ received: 0 }` : le morceau est
 *  simplement rejoué. */
const askSession = async ({ url, total, driveFetch, timeout }) => {
  try {
    const res = await driveFetch(url, {
      method: 'PUT',
      headers: { 'Content-Range': sessionAckRange(total) },
      accept: [200, 201, 308],
      timeout
    });
    const status = statusOf(res);
    if (status >= 200 && status < 300) {
      const json = await res.json().catch(() => null);
      const done = fileResultOf(json, '');
      return done ? { done } : { received: 0 };
    }
    return { received: receivedBytesFromRange(rangeOf(res), 0) };
  } catch { return { received: 0 }; }
};

/**
 * Envoie `blob` PAR MORCEAUX dans le dossier `targetId` (ou remplace le fichier
 * `existingId` s'il existe déjà) — même nom, même type, même dossier que l'envoi
 * en une seule requête : seule la façon de transporter les octets change.
 *
 * @param {object}   opts
 * @param {Blob}     opts.blob            le fichier (Blob/File)
 * @param {string}   opts.name            nom du fichier sur le Drive
 * @param {string}   [opts.mimeType]
 * @param {string}   [opts.targetId]      dossier de destination (nouveau fichier)
 * @param {string}   [opts.existingId]    fichier à REMPLACER (mise à jour)
 * @param {Function} opts.driveFetch      le transport (driveUpload.driveFetch)
 * @param {Function} [opts.onProgress]    (octetsConfirmés, total) → affichage
 * @param {number}   [opts.timeout]       délai par requête
 * @returns {Promise<{id:string,name:string,driveUrl:string}|null>} `null` quand
 *          la SESSION n'a pas pu être ouverte (en-tête `Location` illisible) :
 *          l'appelant garde alors l'envoi en une seule requête.
 * @throws  quand la session est ouverte mais que le transfert échoue vraiment —
 *          l'échec doit se DIRE (et non se replier sur un second envoi complet).
 */
export const uploadBlobInChunks = async ({
  blob, name, mimeType = '', targetId = '', existingId = '', driveFetch,
  chunkBytes = RESUMABLE_CHUNK_BYTES, attempts = RESUMABLE_MAX_ATTEMPTS,
  onProgress = null, timeout = 10 * 60 * 1000
} = {}) => {
  if (typeof driveFetch !== 'function') throw new Error('uploadBlobInChunks: driveFetch is required');
  const size = Number((blob && blob.size) || 0);
  if (!size) throw new Error('uploadBlobInChunks: the file is empty');
  const type = mimeType || (blob && blob.type) || 'application/octet-stream';
  const tries = Math.max(1, Number(attempts) || 1);

  /* 1. OUVRIR LA SESSION. La métadonnée est celle de l'envoi multipart : même
     nom, même type, même `parents` (un fichier remplacé reste dans son dossier,
     donc on ne renvoie PAS `parents` dans ce cas — exactement comme l'envoi en
     une requête). « fields=id,name » : la réponse finale porte la ressource. */
  const open = await driveFetch(
    existingId
      ? `/upload/drive/v3/files/${encodeURIComponent(existingId)}?uploadType=resumable&fields=id,name`
      : '/upload/drive/v3/files?uploadType=resumable&fields=id,name',
    {
      method: existingId ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': type,
        'X-Upload-Content-Length': String(size)
      },
      body: JSON.stringify(existingId
        ? { name, mimeType: type }
        : { name, mimeType: type, parents: [targetId].filter(Boolean) }),
      timeout: 60 * 1000
    }
  );
  const sessionUrl = locationOf(open);
  if (!sessionUrl) return null; // session illisible → l'appelant garde l'envoi en une requête

  /* 2. LES MORCEAUX, dans l'ordre. `sent` = octets CONFIRMÉS par Drive : c'est
     lui qui décide du morceau suivant, donc une reprise après coupure ne renvoie
     jamais un morceau déjà reçu. */
  let sent = 0;
  let fileMeta = null;
  while (sent < size) {
    const { start, end, header } = chunkRange(sent, size, chunkBytes);
    let attempt = 0;
    let settled = false;
    while (!settled) {
      attempt += 1;
      try {
        const res = await driveFetch(sessionUrl, {
          method: 'PUT',
          headers: { 'Content-Range': header },
          body: blob.slice(start, end + 1),
          accept: [200, 201, 308],
          timeout
        });
        const status = statusOf(res);
        if (status >= 200 && status < 300) {
          // Dernier morceau : Drive rend la ressource du fichier.
          const json = await res.json().catch(() => null);
          fileMeta = fileResultOf(json, name);
          if (!fileMeta) throw new Error('Drive ended the upload without a file.');
          sent = size;
        } else {
          // 308 : le morceau est passé — la session dit jusqu'où elle est allée.
          sent = Math.min(size, receivedBytesFromRange(rangeOf(res), end + 1));
        }
        settled = true;
      } catch (err) {
        if (attempt >= tries) throw err;
        await wait(500 * attempt);
        const ack = await askSession({ url: sessionUrl, total: size, driveFetch, timeout });
        if (ack && ack.done) return ack.done;
        if (ack && ack.received) sent = Math.min(size, ack.received);
      }
    }
    if (typeof onProgress === 'function') {
      try { onProgress(sent, size); } catch { /* l'affichage ne casse pas l'envoi */ }
    }
  }

  /* 3. Dernier mot à la session : un dernier morceau qui a rendu 308 (au lieu de
     la ressource) laisse l'envoi terminé mais sans `id` — la requête « ack »
     (sessionAckRange) le rend, sans renvoyer un seul octet. */
  if (!fileMeta) {
    const ack = await askSession({ url: sessionUrl, total: size, driveFetch, timeout });
    fileMeta = (ack && ack.done) || null;
  }
  if (!fileMeta) throw new Error('Drive kept the session open — the upload must be retried.');
  return fileMeta;
};
