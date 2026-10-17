/* =========================================================================
   _harness/fake-drive.mjs — UN FAUX GOOGLE DRIVE EN MÉMOIRE, pour la FASE 0
   de l'assainissement de la synchronisation.

   CE QUI EST FIDÈLE (et pourquoi le code RÉEL tourne dessus) :
     • le module `src/utils/driveUpload.js` est importé TEL QUEL (voir le
       drapeau `globalThis.__driveUseRealUpload` du crochet _esm_test_hook.mjs) :
       ce sont donc ses vraies requêtes (`driveFetch` : en-têtes, `q`, `fields`,
       `pageSize`, `pageToken`, reprise 401, retry réseau) qui passent ici ;
     • l'API v3 STRIKE d'un sous-ensemble : `files.list` (pageSize +
       nextPageToken), `files.create` (métadonnées ET multipart/related),
       `files.update` (nom, `trashed`, `addParents`/`removeParents`,
       `appProperties`), `files.delete` (destruction DÉFINITIVE — comptée, voir
       `stats.permanentDeletes`), `files.generateIds`, `files.get`
       (`alt=media` compris), `files/{id}/permissions`, `about.user` ;
     • les NOMS DOUBLES sont permis dans un même parent (c'est le défaut qu'on
       veut reproduire) ;
     • le DÉLAI DE COHÉRENCE : un élément créé ou renommé n'est pas visible à
       la RECHERCHE PAR NOM avant `coherenceMs` ; `files.get` par identifiant
       est toujours cohérent ;
     • les ERREURS (401/403/429/5xx) et la LATENCE sont injectées avec un
       tirage SEMÉ, donc reproductible ;
     • `onFolderTrash` : 'cascade' (les enfants passent à la corbeille eux
       aussi) ou 'mark-parent-only' (les enfants gardent `trashed=false` et
       restent listables par leur parent) — LES DEUX variantes existent parce
       que la documentation officielle ne dit pas la même chose partout ; le
       test dit laquelle est utilisée.

   SOURCES — CE QUI EST VÉRIFIÉ SUR LA DOCUMENTATION, ET CE QUI EST UNE
   HYPOTHÈSE DÉCLARÉE (vérifié le 16/10/2026) :
     • catalogue officiel de l'API v3 (discovery `drive:v3`, révision 20261011) :
         – `File.trashed` : « Whether the file has been trashed, either
           explicitly or from a trashed parent folder. Only the owner may trash
           a file… » → la variante 'cascade' est la lecture DOCUMENTÉE ;
         – `File.parents` : « A file can only have one parent folder; specifying
           multiple parents isn't supported. … Update requests must use the
           `addParents` and `removeParents` parameters » ;
         – `files.list.pageSize` : min 1, défaut 100, « The maximum value is
           1000; values above 1000 will be coerced to 1000 » ;
         – `files.list.orderBy` : « A comma-separated list of sort keys »
           (`createdTime`, `folder`, `modifiedTime`, `name`, `name_natural`, …) ;
         – `files.list.corpora` / `driveId` / `includeItemsFromAllDrives` /
           `supportsAllDrives` / `spaces` : le vocabulaire des Drives partagés ;
         – `File.name` : « This isn't necessarily unique within a folder » → les
           JUMEAUX de nom sont légitimes côté API (c'est le défaut de l'app).
     • guide « Search query terms and operators » : `fullText contains` cherche
       dans le TEXTE (exemple : « if the fullText of a document contains the
       string “HelloWorld”… ») ; une phrase entre guillemets est exacte.
     • HYPOTHÈSES DÉCLARÉES (paramètres du TEST, pas des mesures de Google) :
       la FORME du délai de cohérence (recherche par nom retardée, lecture par
       identifiant immédiate) ; les seuils 0,2 s / 0,5 s ; l'ordre rendu SANS
       `orderBy` (l'API ne garantit rien : « the items are returned
       arbitrarily » ; le faux rend l'ordre de création).

   CE QUI N'EST PAS FIDÈLE (dit franchement) :
     • les délais sont ceux du TEST (horloge virtuelle : `advance(ms)`), pas
       ceux de Google ; ce ne sont pas des statistiques du Drive réel ;
     • deux onglets d'un même processus Node ne peuvent pas émettre en même
       temps : la « simultanéité » est reproduite par la fenêtre de cohérence
       (l'un ne voit pas l'écriture de l'autre), qui est le mécanisme réel du
       défaut — voir _harness/two-pc.mjs ;
     • les 401 viennent d'un jeton marqué « expiré » par le test
       (`pc.expireToken()`), pas d'une vraie expiration Google ;
     • l'ORDRE RENDU SANS `orderBy` n'est pas celui de Google : l'API ne garantit
       aucun ordre (« the items are returned arbitrarily »), le faux rend
       toujours l'ordre de création (createdTime, puis n° d'écriture). Un test
       qui compte sur l'ordre pose un `orderBy` (clés triées : createdTime,
       modifiedTime, name) ;
     • `fullText contains` est APPROXIMÉ : l'API cherche dans le texte indexé
       (nom et contenu), le faux dans le nom ET dans le corps qu'il a écrit ;
     • AUCUNE CLAUSE N'EST JAMAIS IGNORÉE (16/10/2026) : le lecteur de `q`
       REFUSE toute clause inconnue ou mal formée, toute `orderBy` qu'il ne sait
       pas trier, tout `pageSize` hors 1..1000, tout `pageToken` qu'il n'a pas
       émis, `alt=media` sur un dossier, et — parce qu'il ne les modélise pas —
       `corpora`/`driveId`/`supportsAllDrives`/`spaces` (Drives partagés). Les
       refus sont visibles (`stats.unsupportedQueries`, `listParamsNotModelled`) :
       un faux Drive qui devine rend tous les résultats faux.
   ========================================================================= */

export const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Tirage pseudo-aléatoire SEMÉ (mulberry32) : deux exécutions d'un même seed
 *  produisent exactement les mêmes requêtes, erreurs et dossiers. */
export const makeRng = (seed) => {
  let s = (Number(seed) >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const ISO = (ms) => new Date(ms).toISOString();
const unescapeQ = (s) => String(s).replace(/\\(.)/g, '$1');

/** Découpe une requête sur les ` and ` de PREMIER niveau (hors guillemets et
 *  hors accolades `appProperties has { … }`) : un `and` dans une valeur ne
 *  sépare rien. */
const splitClauses = (q) => {
  const out = [];
  let cur = '';
  let inQ = false;
  let depth = 0;
  for (let i = 0; i < q.length; i += 1) {
    const ch = q[i];
    if (ch === '\\') { cur += ch + (q[i + 1] || ''); i += 1; continue; }
    if (ch === "'") inQ = !inQ;
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (!inQ && depth === 0 && /\s/.test(ch) && /^\s+and\s+/i.test(q.slice(i))) {
      out.push(cur.trim());
      cur = '';
      /* ⚠ SANS `String(…)` : `i += String(5 - 1)` fait `i + "4"` — i devient la
         CHAÎNE « 174 » et la boucle s'arrête là. Toutes les clauses APRÈS la
         première étaient donc perdues (constaté le 16/10/2026 sur
         `name='_meta.json' and '<dossier>' in parents and trashed=false` :
         le dossier était ignoré — le faux Drive rendait « le premier du nom »
         n'importe où, et l'adoption par identité pouvait lire la description
         d'un AUTRE dossier. Les résultats d'alors sont refaits depuis.) */
      i += q.slice(i).match(/^\s+and\s+/i)[0].length - 1;
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  /* ⚠ PAS de `.filter(Boolean)` : une partie VIDE est une requête MAL FORMÉE
     (« and » en trop, requête coupée) et le lecteur la REFUSE explicitement.
     La filtrer en silence, c'est répondre à une AUTRE question que celle
     posée — même famille que le défaut `i += String(…)` ci-dessus. */
  return out;
};

/** Le lecteur de `q` de l'API — SEULEMENT les clauses que l'app emploie.
 *  RÈGLE (demandée le 16/10/2026) : une clause INCONNUE n'est JAMAIS ignorée,
 *  elle est COLLECTÉE (`unsupported`) et `files.list` REFUSE la requête ; une
 *  clause mal formée (partie vide) est refusée de même. Un `q` VIDE (l'app
 *  interroge l'API sans `q` pour savoir si elle répond) reste légitime : il ne
 *  porte aucune clause. */
export const parseDriveQuery = (q) => {
  const out = {
    name: null, nameContains: null, fullText: null, parentsOf: null, trashed: null,
    mimeTypeEquals: null, mimeTypeNotEquals: null, folderOnly: false,
    appKey: null, appValue: null, unsupported: []
  };
  const whole = String(q || '').trim();
  if (!whole) return out;
  for (const part of splitClauses(whole)) {
    const c = String(part).trim();
    let m;
    if (!c) { out.unsupported.push('(partie vide : « and » en trop, ou requête coupée)'); continue; }
    if ((m = /^name\s*=\s*'((?:[^'\\]|\\.)*)'$/.exec(c))) { out.name = unescapeQ(m[1]); continue; }
    if ((m = /^name\s+contains\s+'((?:[^'\\]|\\.)*)'$/.exec(c))) { out.nameContains = unescapeQ(m[1]); continue; }
    /* `fullText contains` : l'API cherche dans le TEXTE INDEXÉ du fichier (nom
       et contenu) ; le faux Drive n'a que le nom et le corps qu'il a écrits et
       cherche donc dans les DEUX (APPROXIMATION DÉCLARÉE — jamais un silence). */
    if ((m = /^fullText\s+contains\s+'((?:[^'\\]|\\.)*)'$/.exec(c))) { out.fullText = unescapeQ(m[1]); continue; }
    if ((m = /^'([^']+)'\s+in\s+parents$/.exec(c))) { out.parentsOf = m[1]; continue; }
    if ((m = /^trashed\s*=\s*(true|false)$/.exec(c))) { out.trashed = m[1] === 'true'; continue; }
    /* ⚠ `mimeType = 'X'` FILTRAIT AUTREFOIS SEULEMENT QUAND X ÉTAIT LE TYPE
       DOSSIER : pour tout autre type la clause était SILENCIEUSEMENT perdue
       (on rendait aussi les dossiers). Maintenant tout type est comparé, et
       `!=` est comparé aussi. */
    if ((m = /^mimeType\s*=\s*'((?:[^'\\]|\\.)*)'$/.exec(c))) {
      out.mimeTypeEquals = unescapeQ(m[1]);
      out.folderOnly = out.mimeTypeEquals === FOLDER_MIME;
      continue;
    }
    if ((m = /^mimeType\s*!=\s*'((?:[^'\\]|\\.)*)'$/.exec(c))) { out.mimeTypeNotEquals = unescapeQ(m[1]); continue; }
    if ((m = /^appProperties\s+has\s*\{\s*key\s*=\s*'([^']+)'\s+and\s+value\s*=\s*'([^']*)'\s*\}$/.exec(c))) {
      out.appKey = m[1]; out.appValue = m[2]; continue;
    }
    out.unsupported.push(c);
  }
  return out;
};

/* LES CLÉS DE TRI QUE LE FAUX DRIVE SAIT TRIER. L'API en accepte davantage
   (`folder`, `modifiedByMeTime`, `recency`, `viewedByMeTime`, `starred`,
   `name_natural`…) : elles sont REFUSÉES — pas ignorées — tant qu'un test n'en
   a pas besoin (voir la description de `orderBy` dans l'API v3). */
const FAKE_ORDER_KEYS = new Set(['createdTime', 'modifiedTime', 'name']);
/** `orderBy` → liste de { key, desc }. Toute clé inconnue va dans `unsupported`
 *  (donc la requête entière est refusée), jamais dans l'oubli. */
export const parseDriveOrderBy = (raw, unsupported = []) => {
  const out = [];
  for (const piece of String(raw || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^([A-Za-z_]+)(?:\s+(asc|desc))?$/i.exec(piece);
    if (!m || !FAKE_ORDER_KEYS.has(m[1])) {
      unsupported.push(`orderBy=${piece}${m && m[1] ? ' (clé que le faux Drive ne trie pas)' : ''}`);
      continue;
    }
    out.push({ key: m[1], desc: String(m[2] || '').toLowerCase() === 'desc' });
  }
  return out;
};

/* ── LE FAUX DRIVE ────────────────────────────────────────────────────────
   Horloge VIRTUELLE : `advance(ms)` fait avancer le temps sans dormir ; les
   délais (latence, cohérence) sont donc reproductibles et instantanés. */
export const createFakeDrive = ({
  seed = 1,
  latencyMs = 0,
  coherenceMs = 0,
  listLagMs = 0,
  errorRate = 0,
  networkErrorRate = 0,
  errorStatuses = [429, 500, 503],
  errorMethods = null,
  onFolderTrash = 'cascade',
  pageSizeLimit = 1000,
  defaultPageSize = 100
} = {}) => {
  const rnd = makeRng(seed);
  const nodes = new Map();
  const log = [];
  const tokens = new Map();   // jeton → { label, expired }
  const reserved = new Set(); // ids rendus par generateIds, pas encore écrits
  const time = { t: 0 };
  let seq = 0;
  const stats = {
    calls: 0, errors: 0, errorsByStatus: {}, byMethod: {}, pages: 0, uploads: 0,
    permanentDeletes: 0, hardDeleteIds: [], unsupportedQueries: [], unrouted: [],
    searchByName: 0, searchByNameWithoutTrashedFalse: 0, listRequests: 0, tokenMints: 0,
    networkErrors: 0,
    /* Ce que le faux Drive REFUSE faute de le modéliser (jamais un silence) :
       les paramètres de Drives partagés, et le téléchargement d'un dossier. */
    listParamsNotModelled: [], folderDownloads: 0, orderByRequests: 0
  };
  const nextId = (p) => `${p}${(++seq).toString(36)}${seed}`;
  const stamp = (ms) => ISO(1700000000000 + ms);

  const mkNode = ({
    id = '', name, mimeType = FOLDER_MIME, parent = '', text = '', appProperties = null
  }) => {
    const nid = id || nextId('fd');
    const node = {
      id: nid, name, mimeType, parent, text: String(text ?? ''), trashed: false,
      appProperties: { ...(appProperties || {}) },
      size: Buffer.byteLength(String(text ?? ''), 'utf8'),
      createdTime: stamp(time.t), modifiedTime: stamp(time.t), seq: ++seq,
      searchAt: time.t + latencyMs + coherenceMs,
      listAt: time.t + latencyMs + listLagMs
    };
    nodes.set(nid, node);
    log.push({ op: 'create', id: nid, name, parent, at: time.t });
    return nid;
  };
  const mkFolder = (name, parent = '', extra = {}) => mkNode({ name, parent, ...extra });
  const mkFile = ({ name, parent = '', text = '', mimeType = 'application/json', appProperties = null }) =>
    mkNode({ name, parent, text, mimeType, appProperties });

  const shape = (n) => ({
    id: n.id, name: n.name, mimeType: n.mimeType, trashed: n.trashed,
    parents: n.parent ? [n.parent] : [], createdTime: n.createdTime, modifiedTime: n.modifiedTime,
    size: String(n.size), appProperties: { ...n.appProperties }
  });

  /** Les enfants d'un dossier, dans l'ordre du Drive (createdTime, puis n°). */
  const childrenOf = (parentId, { includeTrashed = false } = {}) => [...nodes.values()]
    .filter((n) => n.parent === parentId && (includeTrashed || !n.trashed))
    .sort((a, b) => (a.createdTime === b.createdTime ? a.seq - b.seq : a.createdTime.localeCompare(b.createdTime)));

  const pathOf = (id) => {
    const segs = [];
    let n = nodes.get(id);
    while (n) {
      segs.unshift(n.name);
      n = n.parent ? nodes.get(n.parent) : null;
    }
    return segs;
  };
  const byPath = (path, { root = '' } = {}) => {
    let parent = root;
    let node = null;
    /* `path` peut être un tableau de segments OU une chaîne « a/b/c » : les
       deux formes servent aux tests, et les confondre faisait chercher un
       dossier nommé « a,b,c » (constaté le 15/10/2026). */
    const segs = Array.isArray(path) ? path : String(path).split('/');
    for (const raw of segs) {
      const seg = String(raw).trim();
      if (!seg) continue;
      node = childrenOf(parent).find((n) => n.name === seg) || null;
      if (!node) return null;
      parent = node.id;
    }
    return node;
  };

  /* ── CORBEILLE (jamais une destruction) ───────────────────────────────────
     `PATCH { trashed: true }`. La documentation v3 du champ `trashed` dit :
     « Whether the file has been trashed, EITHER EXPLICITLY OR FROM A TRASHED
     PARENT FOLDER » — d'où la variante par défaut 'cascade' (les enfants
     passent aussi à la corbeille). La variante 'mark-parent-only' existe pour
     vérifier l'autre lecture (les enfants gardent `trashed=false` et restent
     listables par l'identifiant de leur parent) : le test dit laquelle sert. */
  const trashNode = (id, { cascade = onFolderTrash === 'cascade' } = {}) => {
    const n = nodes.get(id);
    if (!n) return false;
    n.trashed = true;
    n.modifiedTime = stamp(time.t);
    log.push({ op: 'trash', id, name: n.name, at: time.t });
    if (cascade && n.mimeType === FOLDER_MIME) {
      for (const c of [...nodes.values()]) if (c.parent === id && !c.trashed) trashNode(c.id, { cascade: true });
    }
    return true;
  };
  const untrashNode = (id) => {
    const n = nodes.get(id);
    if (!n) return false;
    n.trashed = false;
    n.modifiedTime = stamp(time.t);
    log.push({ op: 'untrash', id, name: n.name, at: time.t });
    return true;
  };
  /** `DELETE …/files/:id` = destruction DÉFINITIVE. L'app ne doit JAMAIS
   *  l'employer : le test le vérifie sur `stats.permanentDeletes`. */
  const hardDelete = (id) => {
    const n = nodes.get(id);
    if (!n) return false;
    stats.permanentDeletes += 1;
    stats.hardDeleteIds.push(id);
    log.push({ op: 'hardDelete', id, name: n.name, at: time.t });
    const kill = (x) => {
      for (const c of [...nodes.values()]) if (c.parent === x) kill(c.id);
      nodes.delete(x);
    };
    kill(id);
    return true;
  };

  /* ── LA RECHERCHE, avec son retard de cohérence ─────────────────────────── */
  /** Comparateur d'une clé de tri (`FAKE_ORDER_KEYS`) : `name` et
   *  `modifiedTime` se comparent comme l'API les décrit (alphabétique pour
   *  `name`), et `createdTime` avec le n° d'écriture en départage. */
  const cmpOf = (key) => {
    if (key === 'name') return (a, b) => String(a.name).localeCompare(String(b.name));
    if (key === 'modifiedTime') return (a, b) => String(a.modifiedTime).localeCompare(String(b.modifiedTime));
    return (a, b) => (a.createdTime === b.createdTime ? a.seq - b.seq : String(a.createdTime).localeCompare(String(b.createdTime)));
  };
  const matches = (n, p, { forSearch = false } = {}) => {
    if (forSearch ? n.searchAt > time.t : n.listAt > time.t) return false;
    const wantTrashed = p.trashed === null ? false : p.trashed;
    if (!!n.trashed !== wantTrashed) return false;
    if (p.parentsOf !== null && n.parent !== p.parentsOf) return false;
    if (p.name !== null && n.name !== p.name) return false;
    if (p.nameContains !== null && !n.name.includes(p.nameContains)) return false;
    /* `fullText` = nom OU corps (approximation déclarée, voir parseDriveQuery). */
    if (p.fullText !== null && !(n.name.includes(p.fullText) || String(n.text || '').includes(p.fullText))) return false;
    if (p.mimeTypeEquals !== null && n.mimeType !== p.mimeTypeEquals) return false;
    if (p.mimeTypeNotEquals !== null && n.mimeType === p.mimeTypeNotEquals) return false;
    if (p.appKey && String(n.appProperties[p.appKey] ?? '') !== p.appValue) return false;
    return true;
  };

  const listFiles = ({ q, pageSize, pageToken, orderBy }) => {
    const p = parseDriveQuery(q || '');
    /* `orderBy` est validé AVANT le refus : une clé que le faux Drive ne sait
       pas trier doit se retrouver dans `unsupported` (donc refusée), jamais
       ignorée en silence. */
    const order = parseDriveOrderBy(orderBy, p.unsupported);
    if (order.length) stats.orderByRequests += 1;
    if (p.unsupported.length) {
      stats.unsupportedQueries.push(q);
      throw new Error(`requête non reconnue par le faux Drive : « ${p.unsupported.join(' · ')} » (q=${q})`);
    }
    const forSearch = p.name !== null || p.nameContains !== null || p.fullText !== null;
    if (forSearch) {
      stats.searchByName += 1;
      if (!/trashed\s*=\s*false/.test(String(q || ''))) stats.searchByNameWithoutTrashedFalse += 1;
    } else if (p.parentsOf !== null) {
      stats.listRequests += 1;
    }
    /* Sans clause, l'API ne rend PAS la corbeille : c'est le défaut, et le
       test peut le constater (voir stats.searchByNameWithoutTrashedFalse). */
    const rows = [...nodes.values()].filter((n) => matches(n, p, { forSearch }));
    /* SANS `orderBy`, l'API ne garantit AUCUN ordre (« the items are returned
       arbitrarily ») ; le faux Drive rend, lui, l'ordre de CRÉATION
       (createdTime puis n° d'écriture) — COMMODITÉ DÉCLARÉE, pas une promesse
       de Google. Les clés triables sont dans `FAKE_ORDER_KEYS`. */
    rows.sort((a, b) => (a.createdTime === b.createdTime ? a.seq - b.seq : a.createdTime.localeCompare(b.createdTime)));
    for (let i = order.length - 1; i >= 0; i -= 1) {
      const { key, desc } = order[i];
      const base = cmpOf(key);
      rows.sort((a, b) => (desc ? -base(a, b) : base(a, b)));
    }
    /* `pageSize` : l'API demande un ENTIER 1..1000 (« values above 1000 will be
       coerced to 1000 »). Un `pageSize` absurde était absorbé par
       `Number(pageSize) || défaut` — une page vide que l'app relisait sans fin ;
       maintenant la requête est REFUSÉE. */
    const asked = (pageSize === null || pageSize === undefined || pageSize === '') ? defaultPageSize : Number(pageSize);
    if (!Number.isInteger(asked) || asked < 1) {
      stats.unsupportedQueries.push(`pageSize=${pageSize}`);
      throw new Error(`pageSize invalide : « ${pageSize} » — l'API demande un entier entre 1 et ${pageSizeLimit} ; le faux Drive refuse au lieu d'inventer une page.`);
    }
    const size = Math.min(asked, pageSizeLimit);
    /* Le jeton de page du faux Drive est un OFFSET ; tout autre jeton est
       rejeté — l'API rejette elle aussi un jeton qu'elle n'a pas émis. */
    const start = pageToken ? Number(pageToken) : 0;
    if (pageToken && (!Number.isInteger(start) || start < 0)) {
      stats.unsupportedQueries.push(`pageToken=${pageToken}`);
      throw new Error(`pageToken invalide : « ${pageToken} » — le faux Drive n'émet que des offsets ; tout autre jeton est refusé comme l'API refuse les siens.`);
    }
    stats.pages += 1;
    const page = rows.slice(start, start + size);
    const nextPageToken = start + size < rows.length ? String(start + size) : '';
    return { files: page.map(shape), nextPageToken };
  };

  /* ── RÉPONSES ET CORPS MULTIPART ────────────────────────────────────────── */
  const res = (json, status = 200, text = null) => ({
    ok: status < 400,
    status,
    json: async () => json,
    text: async () => (text === null ? JSON.stringify(json) : text),
    headers: { get: (h) => (String(h).toLowerCase() === 'location' ? (json && json.__location) || null : null) }
  });
  const err = (status, message) => res({ error: { code: status, message } }, status);
  const safeJson = (raw) => { try { return JSON.parse(String(raw)); } catch { return {}; } };

  /** Le corps d'un envoi est un `Blob` `multipart/related` (première partie :
   *  les métadonnées JSON, seconde : les octets). Voir driveUpload.js:1838. */
  const parseMultipart = async (init, headers) => {
    const ctype = String(headers['Content-Type'] || headers['content-type'] || '');
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype);
    const boundary = m ? String(m[1] || m[2]).trim() : '';
    const body = init.body;
    const raw = typeof body === 'string' ? body
      : (body && typeof body.text === 'function' ? await body.text() : '');
    if (!boundary) return { meta: safeJson(raw), media: raw, size: Buffer.byteLength(raw, 'utf8') };
    let meta = {};
    let media = '';
    let first = true;
    for (const part of raw.split(`--${boundary}`)) {
      const cut = part.indexOf('\r\n\r\n');
      if (cut < 0) continue;
      const head = part.slice(0, cut);
      const content = part.slice(cut + 4).replace(/\r\n$/, '');
      /* ⚠ LES DEUX PARTIES PEUVENT PORTER `Content-Type: application/json` :
         les métadonnées de l'envoi ET le contenu d'un `_meta.json`. C'est la
         PREMIÈRE partie qui décrit l'envoi — prendre la dernière écrasait la
         description du fichier par son contenu, et le nœud créé prenait l'id du
         DOSSIER décrit (constaté le 15/10/2026 sur la sonde de FASE 0). */
      if (first && !/boundary/i.test(head)) { meta = safeJson(content); first = false; continue; }
      first = false;
      if (content) media += content;
    }
    return { meta, media, size: Buffer.byteLength(media, 'utf8') };
  };

  const maybeError = (method) => {
    if (!(errorRate > 0)) return 0;
    if (Array.isArray(errorMethods) && !errorMethods.includes(method)) return 0;
    if (rnd() >= errorRate) return 0;
    const s = errorStatuses[Math.floor(rnd() * errorStatuses.length)] || 500;
    stats.errors += 1;
    stats.errorsByStatus[s] = (stats.errorsByStatus[s] || 0) + 1;
    return s;
  };

  /* Le PC dont le jeton est en cours de renouvellement (un processus Node ne
     peut pas servir deux postes à la fois : voir le bandeau du fichier). */
  let mintFor = '';
  /* Le serveur de jetons peut être ÉTEINT : c'est alors le chemin « jeton
     expiré sans renouvellement possible » (l'app doit le DIRE, pas se taire). */
  let tokenServerDown = false;

  const fetchFn = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = String(init.method || 'GET').toUpperCase();
    const headers = init.headers || {};
    stats.calls += 1;
    stats.byMethod[method] = (stats.byMethod[method] || 0) + 1;
    log.push({ op: 'call', method, url: `${u.host}${u.pathname}${u.search}`, at: time.t });

    /* Le serveur de jetons (tout hôte qui n'est pas l'API Drive) : il rend un
       jeton neuf pour le poste courant — c'est le chemin « espace partagé »,
       le seul qui puisse se renouveler sans navigateur. */
    if (u.host !== 'www.googleapis.com') {
      stats.tokenMints += 1;
      if (tokenServerDown) return err(503, 'le serveur de jetons est éteint (scénario du test)');
      const label = mintFor || 'PC';
      const token = `tok_${label.replace(/\W+/g, '')}_${stats.tokenMints}`;
      tokens.set(token, { label, expired: false });
      return res({ access_token: token, expires_in: 3600 });
    }

    const token = String(headers.Authorization || headers.authorization || '').replace(/^Bearer\s+/i, '');
    const who = tokens.get(token);
    if (!who) return err(401, 'Invalid Credentials');
    if (who.expired) return err(401, 'Invalid Credentials (jeton expiré)');
    const injected = maybeError(method);
    if (injected) return err(injected, `erreur semée (${injected})`);
    /* UNE PANNE RÉSEAU, CE N'EST PAS UNE RÉPONSE : `fetch` REJETTE. C'est le
       seul cas que le vrai `driveFetch` réessaie (une fois, avec un jeton
       frais) — voir son `catch` autour de l'appel (driveUpload.js:272). */
    if (networkErrorRate > 0 && rnd() < networkErrorRate) {
      stats.networkErrors += 1;
      throw new TypeError('fetch failed (panne réseau semée)');
    }

    const p = u.pathname;
    const qp = u.searchParams;

    if (p === '/drive/v3/about') return res({ user: { emailAddress: `${who.label.replace(/\W+/g, '.')}@test` } });

    if (p === '/drive/v3/files/generateIds') {
      const count = Math.max(1, Number(qp.get('count')) || 1);
      const ids = [];
      for (let i = 0; i < count; i += 1) {
        const id = nextId('gen');
        reserved.add(id);
        ids.push(id);
      }
      return res({ space: qp.get('space') || 'drive', ids });
    }

    if (p === '/drive/v3/files' && method === 'GET') {
      /* LES PARAMÈTRES QUE LE FAUX DRIVE NE MODÉLISE PAS SONT REFUSÉS, PAS
         IGNORÉS : `corpora`/`driveId` restreignent la recherche à un Drive
         partagé (ou à un autre corpus) — les ignorer rendrait TOUT l'univers du
         faux, c'est-à-dire une réponse fausse qui aurait l'air juste. L'app
         n'ouvre pas les Drives partagés (voir _drive_sync_repro_test.mjs, Q8 :
         `supportsAllDrives` absent du module) : le jour où elle les ouvrira,
         c'est ICI qu'il faudra les modéliser, et le test le dira. */
      const unmodelled = [
        qp.get('corpora') && qp.get('corpora') !== 'user' ? `corpora=${qp.get('corpora')}` : '',
        qp.get('driveId') ? `driveId=${qp.get('driveId')}` : '',
        qp.get('includeItemsFromAllDrives') ? `includeItemsFromAllDrives=${qp.get('includeItemsFromAllDrives')}` : '',
        qp.get('supportsAllDrives') ? `supportsAllDrives=${qp.get('supportsAllDrives')}` : '',
        qp.get('spaces') && qp.get('spaces') !== 'drive' ? `spaces=${qp.get('spaces')}` : ''
      ].filter(Boolean);
      if (unmodelled.length) {
        stats.listParamsNotModelled.push(unmodelled.join(' '));
        throw new Error(`le faux Drive ne modélise pas « ${unmodelled.join(' · ')} » (Drives partagés / autres espaces) : il refuse au lieu de rendre tout l'univers.`);
      }
      return res(listFiles({
        q: qp.get('q') || '', pageSize: qp.get('pageSize'), pageToken: qp.get('pageToken'),
        orderBy: qp.get('orderBy') || ''
      }));
    }

    /* ── files.create (métadonnées) ── */
    if (p === '/drive/v3/files' && method === 'POST') {
      const body = safeJson(typeof init.body === 'string' ? init.body : '');
      log.push({ op: 'createRequest', body: JSON.stringify(body).slice(0, 220), ctype: String(headers['Content-Type'] || ''), at: time.t });
      const wanted = String(body.id || '');
      if (wanted && nodes.has(wanted)) {
        return res({ error: { code: 409, message: `File already exists: ${wanted}` } }, 409);
      }
      const id = mkNode({
        id: wanted, name: body.name, mimeType: body.mimeType || FOLDER_MIME,
        parent: (body.parents || [])[0] || '', appProperties: body.appProperties || null
      });
      reserved.delete(wanted);
      return res(shape(nodes.get(id)));
    }

    /* ── upload/drive/v3/files[/:id] (multipart) ── */
    if (p === '/upload/drive/v3/files' || /^\/upload\/drive\/v3\/files\/[^/]+$/.test(p)) {
      const existing = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(p);
      const { meta, media, size } = await parseMultipart(init, headers);
      stats.uploads += 1;
      log.push({ op: 'uploadRequest', method, url: `${p}${u.search}`, meta: JSON.stringify(meta).slice(0, 220), mediaBytes: size, at: time.t });
      if (existing) {
        const node = nodes.get(decodeURIComponent(existing[1]));
        if (!node) return err(404, 'File not found');
        node.text = media;
        node.size = size;
        node.modifiedTime = stamp(time.t);
        log.push({ op: 'overwrite', id: node.id, name: node.name, at: time.t });
        return res({ id: node.id, name: node.name });
      }
      const id = mkNode({
        id: String(meta.id || ''), name: meta.name || 'sans-nom',
        mimeType: meta.mimeType || 'application/octet-stream',
        parent: (meta.parents || [])[0] || '', text: media, appProperties: meta.appProperties || null
      });
      nodes.get(id).size = size;
      return res({ id, name: nodes.get(id).name });
    }

    if (/^\/drive\/v3\/files\/[^/]+\/permissions$/.test(p) && method === 'POST') return res({ id: 'perm' });

    /* ── files/:id ── */
    const byId = /^\/drive\/v3\/files\/([^/]+)$/.exec(p);
    if (byId) {
      const id = decodeURIComponent(byId[1]);
      if (method === 'DELETE') return hardDelete(id) ? res({}, 204) : err(404, 'File not found');
      const node = nodes.get(id);
      if (!node) return err(404, 'File not found');
      if (method === 'GET' && qp.get('alt') === 'media') {
        /* `alt=media` SUR UN DOSSIER : l'API refuse de télécharger un dossier.
           Le faux Drive rendait une chaîne VIDE — que `JSON.parse` transformait
           en `{}` : un silence qui pouvait passer pour une réponse. */
        if (node.mimeType === FOLDER_MIME) {
          stats.folderDownloads += 1;
          return err(400, 'cannot download a folder (refus du faux Drive, comme l’API)');
        }
        return res({}, 200, node.text);
      }
      if (method === 'PATCH') {
        const body = safeJson(typeof init.body === 'string' ? init.body : '');
        if (body.name !== undefined) {
          node.name = String(body.name);
          node.searchAt = time.t + latencyMs + coherenceMs;
          log.push({ op: 'rename', id, name: node.name, at: time.t });
        }
        if (body.trashed !== undefined) { if (body.trashed) trashNode(id); else untrashNode(id); }
        if (body.appProperties) node.appProperties = { ...node.appProperties, ...body.appProperties };
        const add = qp.get('addParents');
        const remove = qp.get('removeParents');
        if (add || remove !== null) {
          if (remove !== null) node.parent = '';
          if (add) node.parent = String(add).split(',').filter(Boolean)[0] || '';
          node.listAt = time.t + latencyMs + listLagMs;
          log.push({ op: 'move', id, name: node.name, parent: node.parent, at: time.t });
        }
        node.modifiedTime = stamp(time.t);
        return res(shape(node));
      }
      if (method === 'GET') return res(shape(node));
    }
    stats.unrouted.push(`${method} ${p}`);
    throw new Error(`le faux Drive ne connaît pas « ${method} ${p} » — l'app a demandé autre chose que ce qu'il sait servir.`);
  };

  /* ── CE QUE LE TEST REGARDE ─────────────────────────────────────────────── */
  const live = () => [...nodes.values()].filter((n) => !n.trashed);
  /** LES JUMEAUX : deux nœuds VIVANTS du même type, sous le même parent, du
   *  même nom — c'est le symptôme nº 1 (invariant I1). */
  const twins = ({ foldersOnly = true } = {}) => {
    const groups = new Map();
    for (const n of live()) {
      if (foldersOnly && n.mimeType !== FOLDER_MIME) continue;
      const key = `${n.parent}|${n.name}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(n);
    }
    return [...groups.values()].filter((g) => g.length > 1)
      .map((g) => ({ parent: g[0].parent, name: g[0].name, ids: g.map((n) => n.id), path: pathOf(g[0].id) }));
  };
  /** Les enfants VIVANTS dont le parent est parti à la corbeille (ou n'existe
   *  plus) : avec la variante 'mark-parent-only', ce sont les orphelins du
   *  scénario E de la FASE 0. */
  const orphansOfTrashedParent = () => live().filter((n) => {
    if (!n.parent) return false;
    const parent = nodes.get(n.parent);
    return !parent || parent.trashed;
  });
  const textOf = (id) => String((nodes.get(id) || {}).text || '');

  return {
    seed, nodes, log, stats, time, FOLDER_MIME,
    fetch: fetchFn,
    mkFolder, mkFile, trashNode, untrashNode, hardDelete,
    node: (id) => nodes.get(id) || null,
    shape, childrenOf, pathOf, byPath, live, twins, orphansOfTrashedParent, textOf,
    advance: (ms) => { time.t += Number(ms) || 0; },
    registerToken: (token, label = 'PC') => { tokens.set(token, { label, expired: false }); return token; },
    expireToken: (token) => { const t = tokens.get(token); if (t) t.expired = true; return !!t; },
    revokeToken: (token) => tokens.delete(token),
    setMintFor: (label) => { mintFor = label; },
    setTokenServer: (mode) => { tokenServerDown = mode === 'down'; return !tokenServerDown; },
    foldersNamed: (name, parentId) => childrenOf(parentId).filter((n) => n.mimeType === FOLDER_MIME && n.name === name),
    filesNamed: (name, parentId) => childrenOf(parentId).filter((n) => n.mimeType !== FOLDER_MIME && n.name === name),
    foldersIn: (parentId) => childrenOf(parentId).filter((n) => n.mimeType === FOLDER_MIME),
    filesIn: (parentId) => childrenOf(parentId).filter((n) => n.mimeType !== FOLDER_MIME),
    /** Le journal, filtré : `ops('rename')`, `ops('trash')`, … */
    ops: (op) => log.filter((e) => e.op === op),
    calls: () => log.filter((e) => e.op === 'call')
  };
};
