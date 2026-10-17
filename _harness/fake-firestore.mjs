/* fake-firestore.mjs — UN DOCUMENT PARTAGÉ QUI SE COMPORTE COMME FIRESTORE.
 *
 * Ce que le vrai fait et que ce faux refait :
 *   · un seul document, dont la TAILLE TOTALE (tous champs) est plafonnée à
 *     1 Mio : au-delà, l'écriture est refusée (`resource-exhausted`) ;
 *   · `set(data, {merge:true})` fusionne les CHAMPS de premier niveau — un champ
 *     absent du payload n'est pas effacé, un champ présent est REMPLACÉ en bloc
 *     (c'est ce qui fait qu'un `payload` plus court écrase le plus long) ;
 *   · lecture et écriture ont une LATENCE (le désordre des deux postes vient de
 *     là, pas d'un bricolage du test) ;
 *   · les pannes sont SEMÉES : on rejoue les mêmes tirages, donc un rouge est
 *     reproductible (`seed`) ;
 *   · un refus de LECTURE (`denyReads`, code 403) est un état à part : c'est
 *     celui du vrai document pour un client non autorisé, et c'est lui qui rend
 *     un garde-fou muet.
 *
 * Aucune dépendance, aucun réseau, aucun fichier : tout est en mémoire.
 */

export const DOC_LIMIT_BYTES = 1024 * 1024; // 1 Mio — limite d'un document Firestore

/** Générateur déterministe (mulberry32) : même graine, même scénario. */
export const makeRng = (seed) => {
  let a = (Number(seed) || 1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/** Erreur typée, comme le SDK : `code` porte le verdict (403, 429, 500…). */
export class FirestoreError extends Error {
  constructor(code, message) {
    super(message || `firestore/${code}`);
    this.code = String(code);
  }
}

export class FakeFirestoreDoc {
  /**
   * @param {object} opts
   * @param {number} opts.seed          graine des latences et des pannes
   * @param {Array}  opts.latencyMs     [min,max] latence d'un aller-retour
   * @param {number} opts.errorRate     0..1 — part des appels qui échouent (429/500)
   * @param {boolean} opts.denyReads    refus de lecture systématique (403, règles)
   * @param {boolean} opts.denyWrites   refus d'écriture systématique (403, règles)
   * @param {object} opts.initial       champs initiaux du document
   */
  constructor(opts = {}) {
    this.rng = makeRng(opts.seed || 1);
    this.latencyMs = Array.isArray(opts.latencyMs) ? opts.latencyMs : [40, 220];
    this.errorRate = Number(opts.errorRate) || 0;
    this.denyReads = !!opts.denyReads;
    this.denyWrites = !!opts.denyWrites;
    this.doc = { ...(opts.initial || {}) };
    this.version = 1;
    this.stats = { reads: 0, writes: 0, refusedSize: 0, refusedAuth: 0, lostUpdates: 0, writers: [] };
  }

  /** Taille réelle du document, en octets (comme Firestore la compte). */
  get sizeBytes() {
    return Buffer.byteLength(JSON.stringify(this.doc), 'utf8');
  }

  /** Le champ `payload` est une chaîne compressée : on la décompresse ici pour
   *  que les scénarios parlent d'EXPÉRIENCES, pas de texte compressé. */
  readTests(decompress) {
    const raw = this.doc && typeof this.doc.payload === 'string' ? this.doc.payload : null;
    if (!raw) return [];
    try {
      /* `decompress` peut rendre soit le texte JSON, soit l'objet déjà analysé. */
      const out = decompress(raw);
      const parsed = typeof out === 'string' ? JSON.parse(out) : out;
      if (Array.isArray(parsed)) return parsed;
      return Array.isArray(parsed && parsed.tests) ? parsed.tests : [];
    } catch { return []; }
  }

  /** Lecture : rend un instantané (payload + version) ou lève une erreur typée. */
  async read() {
    this.stats.reads += 1;
    await sleep(this.latencyMs[0] + this.rng() * (this.latencyMs[1] - this.latencyMs[0]));
    if (this.denyReads) { this.stats.refusedAuth += 1; throw new FirestoreError(403, 'Missing or insufficient permissions.'); }
    if (this.errorRate && this.rng() < this.errorRate) {
      const code = this.rng() < 0.5 ? 429 : 500;
      throw new FirestoreError(code, code === 429 ? 'Quota exceeded.' : 'Internal error.');
    }
    return { payload: this.doc.payload, version: this.version, sizeBytes: this.sizeBytes };
  }

  /** Écriture `set(data, {merge})` : fusion des champs de premier niveau,
   *  plafond de taille, latence, pannes semées. */
  async set(data, options = {}, writer = '?') {
    this.stats.writes += 1;
    await sleep(this.latencyMs[0] + this.rng() * (this.latencyMs[1] - this.latencyMs[0]));
    if (this.denyWrites) { this.stats.refusedAuth += 1; throw new FirestoreError(403, 'Missing or insufficient permissions.'); }
    if (this.errorRate && this.rng() < this.errorRate) {
      const code = this.rng() < 0.5 ? 429 : 500;
      throw new FirestoreError(code, code === 429 ? 'Quota exceeded.' : 'Internal error.');
    }
    const merge = !!(options && options.merge);
    /* Contrôle de version (compare-and-swap) : la correction prévue de la fetta 2.
       Refusé si le document a bougé depuis la lecture qui a servi à construire le
       payload — c'est ce refus qui empêche d'écraser ce qu'on n'a pas vu. */
    if (options && options.expectedVersion !== undefined && options.expectedVersion !== null
        && Number(options.expectedVersion) !== this.version) {
      this.stats.lostUpdates += 1;
      throw new FirestoreError('aborted', `Version mismatch: read ${options.expectedVersion}, now ${this.version}`);
    }
    const next = merge ? { ...this.doc } : {};
    Object.keys(data || {}).forEach((k) => { next[k] = data[k]; });
    const bytes = Buffer.byteLength(JSON.stringify(next), 'utf8');
    if (bytes > DOC_LIMIT_BYTES) {
      this.stats.refusedSize += 1;
      throw new FirestoreError('resource-exhausted', `Document too large: ${bytes} > ${DOC_LIMIT_BYTES}`);
    }
    /* Ce qui était dans le document et que ce payload ne porte plus : c'est la
       perte que le test compte (le `payload` est écrasé EN BLOC). */
    this.doc = next;
    this.version += 1;
    this.stats.writers.push({ writer, version: this.version, bytes });
    return { version: this.version, sizeBytes: bytes };
  }
}
