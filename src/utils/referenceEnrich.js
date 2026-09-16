/* =========================================================================
   src/utils/referenceEnrich.js
   COMPLÉTER UNE RÉFÉRENCE INCOMPLÈTE.

   Ce que l'utilisateur demande : « l'information incomplète de la référence
   (auteurs, titre manquants…) n'est pas reconstruite quand j'importe les
   références ». Une bibliographie de fin d'article, un export RIS tronqué, un
   copier-coller de PDF donnent souvent une entrée à qui il manque les AUTEURS
   ou le TITRE — et une entrée sans auteurs ne s'imprime pas.

   Deux sources, dans cet ordre, JAMAIS destructives (elles ne remplissent que
   les champs VIDES, comme fillMissingFields) :

     1. LE POT COMMUN DU LABORATOIRE (publications du scientifique, « Relevant
        papers ») : hors ligne, instantané. Une entrée reconnue par sa
        publication d'origine (sourceId, DOI, identifiant PubMed, sinon titre
        exact) récupère la liste COMPLÈTE de ses auteurs et ses références
        bibliographiques — c'est pubCitationData qui tranche, la même règle que
        le rendu des citations ;
     2. CROSSREF (api.crossref.org, sans clé, CORS ouvert) quand il manque
        toujours les auteurs ou le titre : par DOI quand l'entrée en a un,
        sinon par recherche bibliographique sur le titre. Le titre trouvé doit
        correspondre (titre normalisé identique, ou l'un contient l'autre) —
        jamais une entrée inventée, jamais un autre papier.

   Rien n'est jamais écrasé : un champ déjà rempli (corrigé à la main, choisi
   dans une liste) reste tel quel. Une panne de réseau n'empêche rien : les
   recherches en ligne s'arrêtent après deux échecs et la référence rentre
   simplement telle qu'elle était.

   Tout est PUR et injectable (`fetchImpl`, `pool`) : _reference_complete_test.mjs
   vérifie le même code sans réseau.
   ========================================================================= */

import { fillMissingFields } from './referenceImport.js';
import { pubCitationData } from '../components/pubCitation.js';

/** Les champs qui rendent une citation utilisable, dans l'ordre d'importance. */
export const REFERENCE_COMPLETION_FIELDS = [
  'authors', 'title', 'journal', 'year', 'volume', 'pages', 'doi', 'pmid'
];

const value = (entry, key) => String((entry && entry[key]) || '').trim();

/** Les champs VIDES d'une référence (dans l'ordre ci-dessus). */
export const referenceGaps = (entry) => REFERENCE_COMPLETION_FIELDS.filter((k) => !value(entry, k));

/** Une référence a-t-elle besoin d'être complétée ? Par défaut « il manque les
 *  AUTEURS ou le TITRE » — les deux champs sans lesquels la citation ne dit
 *  rien. Le bouton « ✨ Complete missing fields » demande TOUS les champs vides
 *  (`all: true`). */
export const referenceNeedsCompletion = (entry, { all = false } = {}) => {
  if (!entry || typeof entry !== 'object') return false;
  if (all) return referenceGaps(entry).length > 0;
  return !value(entry, 'authors') || !value(entry, 'title');
};

/** Deux titres parlent-ils du même papier ? (casse, ponctuation, HTML, accents
 *  HTML ignorés ; un titre plus long reconnu quand il contient l'autre). */
export const sameTitle = (a, b) => {
  const key = (s) => String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .toLowerCase()
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const ka = key(a);
  const kb = key(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  if (ka.length < 24 || kb.length < 24) return false;
  return ka.includes(kb) || kb.includes(ka);
};

/** Le nom de famille de la PREMIÈRE autrice d'une liste (« Rossi M, Bianchi A »
 *  → « rossi », « Marco Rossi » → « marco »). */
const firstSurname = (authors) => {
  const words = String(authors || '')
    .split(/\s*[,;]\s*/)[0]
    .split(/\s+/)
    .map((w) => w.replace(/[.]/g, ''))
    .filter(Boolean);
  const long = words.filter((w) => w.length >= 3);
  return (long[0] || words[0] || '').toLowerCase();
};

/* ── 1. Le pot commun du laboratoire (hors ligne) ─────────────────────────── */

/**
 * Complète une entrée depuis les publications du laboratoire / « Relevant
 * papers » (voir pubCitationData : identifiant, DOI, identifiant PubMed, titre).
 * @returns {{ entry:object, filled:string[] }} `filled` = champs remplis (vide
 *          quand rien n'était trouvable — rien n'est inventé).
 */
export const completeFromPool = (entry, pool = []) => {
  const list = (Array.isArray(pool) ? pool : []).filter((p) => p && typeof p === 'object');
  if (!entry || typeof entry !== 'object' || list.length === 0) return { entry, filled: [] };
  const data = pubCitationData(entry, list);
  const next = fillMissingFields(entry, data, REFERENCE_COMPLETION_FIELDS);
  const filled = REFERENCE_COMPLETION_FIELDS.filter((k) => !value(entry, k) && value(next, k));
  return { entry: filled.length ? next : entry, filled };
};

/* ── 2. Crossref (en ligne) ───────────────────────────────────────────────── */

/** Un « work » Crossref → la forme des références du programme (la même que
 *  searchCrossref de Publications.jsx : « Prénom Nom », liste complète). */
export const crossrefReference = (item) => {
  const it = item || {};
  const year = it.issued?.['date-parts']?.[0]?.[0];
  return {
    title: (it.title && it.title[0]) || '',
    authors: (it.author || [])
      .map((a) => `${a.given || ''} ${a.family || ''}`.trim())
      .filter(Boolean)
      .join(', '),
    journal: (it['container-title'] && it['container-title'][0]) || '',
    year: year ? String(year) : '',
    volume: it.volume || '',
    pages: it.page || '',
    doi: it.DOI || ''
  };
};

const CROSSREF_SELECT = 'DOI,title,author,container-title,issued,volume,page,type';

/** La requête Crossref qui doit répondre à cette entrée : le DOI quand elle en
 *  a un (réponse exacte), sinon une recherche bibliographique sur le titre.
 *  PUR : rend `{ url, pick(json) }` — `pick` ne rend JAMAIS un autre papier. */
export const crossrefRequestFor = (entry) => {
  const e = entry || {};
  const doi = String(e.doi || '').trim() || (/10\.\d{4,9}\/\S+/.exec(String(e.link || '')) || [])[0] || '';
  if (doi) {
    return {
      url: `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
      pick: (json) => {
        const item = json && json.message;
        return item && (item.DOI || item.title) ? crossrefReference(item) : null;
      }
    };
  }
  const title = String(e.title || '').trim();
  if (!title) return null;
  return {
    url: `https://api.crossref.org/works?rows=5&select=${CROSSREF_SELECT}`
      + `&query.bibliographic=${encodeURIComponent(title)}`,
    pick: (json) => {
      const items = (json && json.message && json.message.items) || [];
      const wanted = firstSurname(e.authors);
      const hits = items.map(crossrefReference).filter((r) => r.title && sameTitle(r.title, title));
      if (!hits.length) return null;
      /* À titre égal, celui dont le premier auteur est celui de l'entrée : le
         même titre existe en preprint, en erratum et en version publiée. */
      const preferred = wanted ? hits.find((r) => firstSurname(r.authors) === wanted) : null;
      return preferred || hits[0];
    }
  };
};

/** Les champs que Crossref est appelé à remplir pour cette entrée. */
const crossrefFields = (entry) => REFERENCE_COMPLETION_FIELDS.filter((k) => !value(entry, k));

/** Le service n'a pas répondu à temps : sans cela un import resterait bloqué
 *  sur un réseau lent. */
const withTimeout = (promise, ms) => {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('the bibliographic service did not answer in time')), ms);
    })
  ]).finally(() => clearTimeout(timer));
};

/**
 * Complète une entrée depuis Crossref (par DOI, sinon par titre).
 * @returns {{ entry:object, filled:string[], failed:boolean }} `failed` = le
 *          service n'a pas répondu (réseau coupé) : l'appelant peut arrêter.
 */
export const completeFromCrossref = async (entry, { fetchImpl = null, timeoutMs = 8000 } = {}) => {
  const request = crossrefRequestFor(entry);
  if (!request || !crossrefFields(entry).length) return { entry, filled: [], failed: false };
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return { entry, filled: [], failed: true };
  try {
    const res = await withTimeout(doFetch(request.url, {
      headers: { Accept: 'application/json' }
    }), timeoutMs);
    if (!res || res.ok === false) return { entry, filled: [], failed: false };
    const json = await res.json();
    const found = request.pick(json);
    if (!found) return { entry, filled: [], failed: false };
    const next = fillMissingFields(entry, found, REFERENCE_COMPLETION_FIELDS);
    const filled = crossrefFields(entry).filter((k) => value(next, k));
    return { entry: filled.length ? next : entry, filled, failed: false };
  } catch {
    return { entry, filled: [], failed: true };
  }
};

/* ── 3. Le travail complet, entrée par entrée ─────────────────────────────── */

/**
 * Complète UNE référence : pot commun du laboratoire d'abord (hors ligne),
 * Crossref ensuite s'il manque encore les auteurs ou le titre.
 * @returns {{ entry:object, filled:string[], sources:string[], failed:boolean }}
 */
export const enrichReference = async (entry, {
  pool = [], online = true, fetchImpl = null, timeoutMs = 8000
} = {}) => {
  const fromPool = completeFromPool(entry, pool);
  const filled = [...fromPool.filled];
  const sources = fromPool.filled.length ? ['the lab publications'] : [];
  let next = fromPool.entry;
  let failed = false;
  if (online && referenceNeedsCompletion(next)) {
    const web = await completeFromCrossref(next, { fetchImpl, timeoutMs });
    failed = web.failed;
    if (web.filled.length) {
      /* Les champs déjà remplis par le pot commun gardent leur valeur. */
      web.filled.forEach((k) => { if (filled.indexOf(k) === -1) filled.push(k); });
      sources.push('Crossref');
      next = web.entry;
    }
  }
  return { entry: next, filled, sources, failed };
};

/**
 * Complète une LISTE de références (séquentiellement : les services
 * bibliographiques n'aiment pas les rafales).
 *
 * @param {Array} entries
 * @param {object} opts
 *   • `pool`   — publications du laboratoire / « Relevant papers » ;
 *   • `online` — false = hors ligne seulement ;
 *   • `all`    — true = combler TOUS les champs vides (bouton manuel) ; false =
 *                seulement les entrées auxquelles il manque les auteurs ou le
 *                titre (ce que fait un import tout seul) ;
 *   • `max`    — nombre maximum d'entrées complétées en une fois (12 par
 *                défaut : un import ne doit pas attendre indéfiniment).
 * @returns {{ list:Array, completed:number, filled:Object, sources:Array,
 *             skipped:number, offline:boolean }}
 */
export const enrichReferences = async (entries, {
  pool = [], online = true, all = false, max = 12, fetchImpl = null, timeoutMs = 8000
} = {}) => {
  const list = Array.isArray(entries) ? entries.map((e) => e) : [];
  const filled = {};
  const sources = new Set();
  let completed = 0;
  let skipped = 0;
  let attempts = 0;
  let failures = 0;
  let offline = false;
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i];
    if (!referenceNeedsCompletion(entry, { all })) { skipped += 1; continue; }
    if (attempts >= max) { skipped += 1; continue; }
    attempts += 1;
    // eslint-disable-next-line no-await-in-loop
    const res = await enrichReference(entry, {
      pool, online: online && !offline, fetchImpl, timeoutMs
    });
    if (res.failed) {
      failures += 1;
      /* Deux échecs de réseau d'affilée : hors ligne — on n'attend pas 12 fois. */
      if (failures >= 2) offline = true;
    }
    if (!res.filled.length) continue;
    list[i] = res.entry;
    completed += 1;
    res.filled.forEach((k) => { filled[k] = (filled[k] || 0) + 1; });
    res.sources.forEach((s) => sources.add(s));
  }
  return { list, completed, filled, sources: [...sources], skipped, offline };
};

/** Le compte rendu en une phrase du travail d'enrichReferences (une seule
 *  formulation pour l'import, le bouton et les tests). '' quand rien n'a été
 *  complété — l'appelant dit alors ce qu'il veut à la place. */
export const enrichReport = (result) => {
  const r = result || {};
  if (!r.completed) return '';
  const fields = Object.keys(r.filled || {})
    .sort((a, b) => (r.filled[b] || 0) - (r.filled[a] || 0))
    .slice(0, 4)
    .map((k) => `${k} (${r.filled[k]})`);
  return `✨ ${r.completed} reference(s) completed${fields.length ? ` — ${fields.join(', ')}` : ''}`
    + (r.sources && r.sources.length ? ` from ${r.sources.join(' + ')}` : '');
};
