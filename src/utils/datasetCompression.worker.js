/* =========================================================================
   utils/datasetCompression.worker.js — LE FIL QUI COMPRESSE.

   CE QU'IL FAIT : il reçoit `{ id, json }` et rend `{ id, ok: true, payload }`
   (ou `{ id, ok: false, error }`). Il ne connaît RIEN du dataset : du texte
   JSON entre, du LZString UTF-16 sort — la sortie EXACTE de
   `LZString.compressToUTF16`, celle que l'application relit depuis Firestore,
   depuis les fichiers HTML et depuis le Drive. Aucun format ne change ici : on
   ne fait que déplacer le calcul hors du fil principal (voir
   `datasetCompression.js`, et la mesure dans `_dataset_compression_test.mjs`).

   POURQUOI CE FICHIER SÉPARE LE CORPS DU FIL : `compressRequest` (le calcul) et
   `handleCompressionMessage` (la conversation) sont des fonctions pures,
   exécutées TELLES QUELLES par la sonde `_dataset_compression_test.mjs` — la
   compression rendue est donc comparée à celle de la version synchrone, sans
   navigateur. Le branchement sur `self` n'a lieu QUE dans un vrai worker.
   ========================================================================= */
import LZString from 'lz-string';

/** Le corps d'une demande. Ne lève jamais : un échec est DIT au fil principal,
    qui a de quoi se replier (compresser ici, plus lentement mais sûrement). */
export const compressRequest = (request) => {
  const id = request && request.id;
  try {
    const json = request && request.json;
    const text = typeof json === 'string' ? json : JSON.stringify(json === undefined ? null : json);
    return { id, ok: true, payload: LZString.compressToUTF16(text == null ? '' : text) };
  } catch (error) {
    return { id, ok: false, error: String((error && error.message) || error) };
  }
};

/** La conversation d'un fil : une demande sans identifiant est ignorée (elle ne
    pourrait pas être rendue à son auteur), tout le reste reçoit une réponse. */
export const handleCompressionMessage = (event, scope) => {
  const postMessage = scope && typeof scope.postMessage === 'function' ? scope.postMessage : null;
  if (!postMessage) return null;
  const request = (event && event.data) || {};
  if (request.id === undefined || request.id === null) return null;
  const reply = compressRequest(request);
  postMessage.call(scope, reply);
  return reply;
};

/* Uniquement DANS un worker : `self` n'existe pas dans un test Node, et ce
   module s'y importe quand même (c'est ainsi que sa sortie est vérifiée). */
if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('message', (event) => handleCompressionMessage(event, self));
}
